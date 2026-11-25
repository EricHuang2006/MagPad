"""Build read-only C tables from the same calibration and estimators as the GUI."""
import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from grid_check import estimate_xy, mean_field
from field_mesh import FieldMesh
from live_field import load_calibration


def initializer(item):
    if isinstance(item, (tuple, list)):
        return "{" + ", ".join(map(initializer, item)) + "}"
    return float(item).hex() + "f"


def table(file, declaration, rows):
    print(f"static const {declaration}[] = {{", file=file)
    for row in rows:
        print("    " + initializer(row) + ",", file=file)
    print("};", file=file)


def export(path, dest):
    calibration = load_calibration(path)
    mesh = FieldMesh(calibration)
    with (dest / "tables.h").open("w") as f:
        table(f, "Mark marks", calibration.items())
        table(f, "Triangle triangles", (
            (a, b, c, origin, ab, ac, bb, bc, cc, 1 / det)
            for a, b, c, origin, ab, ac, bb, bc, cc, det in mesh.triangles))
        table(f, "Edge edges", (
            (a, b, origin, direction, 1 / length if length else 0)
            for (a, b), (origin, direction, length) in mesh.edges.items()))

    with path.open() as f:
        rows = list(csv.DictReader(f))
    def field(row):
        return tuple(int(row[k]) for k in ("Bx_mG", "By_mG", "Bz_mG"))
    backgrounds = defaultdict(list)
    for row in rows:
        if row["position"] == "background":
            backgrounds[row["pass"]].append(field(row))
    centers = {key: mean_field(values) for key, values in backgrounds.items()}
    replay = []
    for row in rows:
        if row["position"] in ("calibration", "validation"):
            corrected = tuple(a-b for a,b in zip(field(row), centers[row["pass"]]))
            replay.append((corrected, estimate_xy(corrected, calibration), mesh(corrected)))
    with (dest / "samples.h").open("w") as f:
        table(f, "Sample samples", replay)


if __name__ == "__main__":
    export(Path(sys.argv[1]), Path(sys.argv[2]))
