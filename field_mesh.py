"""Invert a piecewise-linear map from pad coordinates to three-axis field."""

import itertools
import math


def difference(a, b):
    return tuple(x - y for x, y in zip(a, b))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


class FieldMesh:
    def __init__(self, calibration):
        xs = sorted({x for x, _ in calibration})
        ys = sorted({y for _, y in calibration})
        if len(xs) < 2 or len(ys) < 2 or len(calibration) != len(xs) * len(ys):
            raise ValueError("Mesh interpolation requires a complete rectangular calibration grid")
        self.triangles = []
        self.edges = {}
        for x0, x1 in itertools.pairwise(xs):
            for y0, y1 in itertools.pairwise(ys):
                a, c = (x0, y0), (x1, y1)
                for b in ((x1, y0), (x0, y1)):
                    origin = calibration[a]
                    ab = difference(calibration[b], origin)
                    ac = difference(calibration[c], origin)
                    bb, bc, cc = dot(ab, ab), dot(ab, ac), dot(ac, ac)
                    det = bb * cc - bc * bc
                    if det > 0:
                        self.triangles.append((a, b, c, origin, ab, ac, bb, bc, cc, det))
                    for p, q in ((a, b), (b, c), (a, c)):
                        p, q = sorted((p, q))
                        if (p, q) not in self.edges:
                            direction = difference(calibration[q], calibration[p])
                            self.edges[p, q] = calibration[p], direction, dot(direction, direction)

    def __call__(self, field):
        # A triangle's closest point is either its interior projection or on an edge.
        best_error = math.inf
        for a, b, c, origin, ab, ac, bb, bc, cc, det in self.triangles:
            offset = difference(field, origin)
            along_b, along_c = dot(offset, ab), dot(offset, ac)
            u = (cc * along_b - bc * along_c) / det
            v = (bb * along_c - bc * along_b) / det
            if u >= 0 and v >= 0 and u + v <= 1:
                error = sum((d - u * e - v * f) ** 2 for d, e, f in zip(offset, ab, ac))
                if error < best_error:
                    best_error = error
                    xy = tuple(a[i] + u * (b[i] - a[i]) + v * (c[i] - a[i]) for i in (0, 1))
        for (p, q), (origin, direction, length_sq) in self.edges.items():
            offset = difference(field, origin)
            t = min(1, max(0, dot(offset, direction) / length_sq)) if length_sq else 0
            error = sum((d - t * e) ** 2 for d, e in zip(offset, direction))
            if error < best_error:
                best_error = error
                xy = tuple(start + t * (end - start) for start, end in zip(p, q))
        return xy
