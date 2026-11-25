"""Check a 3x3 grid or calibrate on a 5x5 grid and validate at cell centers."""

import argparse
import csv
import math
import os
import select
import statistics
import termios
import time
from functools import partial

from field_mesh import FieldMesh
from magpad_serial import open_port


POINTS = [(x, y) for y in (30, 0, -30) for x in (-30, 0, 30)]
SAMPLES = 20
NEAR_LIMIT_MG = 3800  # Early warning at 95% of the configured +/-4 G range.


def capture(port, prompt):
    input(f"{prompt}. Hold still and press Enter. ")
    termios.tcflush(port, termios.TCIFLUSH)
    deadline = time.monotonic() + 8
    buffer = b""
    rows = []
    discard_partial = True
    diagnostic = "no complete CSV readings"
    while len(rows) < SAMPLES:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([port], [], [], remaining)[0]:
            raise RuntimeError(f"Received {len(rows)}/{SAMPLES} samples: {diagnostic}")
        chunk = os.read(port, 4096)
        if not chunk:
            raise RuntimeError("Serial port disconnected")
        lines = (buffer + chunk).split(b"\n")
        buffer = lines.pop()
        for line in lines:
            if discard_partial:
                discard_partial = False
                continue
            try:
                tick, x, y, z = map(int, line.split(b","))
            except ValueError:
                diagnostic = line.decode(errors="replace").strip()
                continue
            rows.append((tick, x, y, z))
            if len(rows) == SAMPLES:
                break
    return rows


def mean_field(rows):
    return tuple(statistics.mean(column) for column in zip(*rows))


def collect_pass(port, output, trial, points, position_label="grid"):
    writer = csv.writer(output)
    fields = {}
    near_limit = 0
    for index, point in enumerate([None, *points]):
        if point is None:
            prompt = "Move the magnet well away for the background reading"
            label = ("background", "", "")
        else:
            prompt = f"Point {index}/{len(points)}: place the magnet at {point} mm"
            label = (position_label, *point)
        rows = capture(port, prompt)
        writer.writerows((trial, *label, *row) for row in rows)
        output.flush()
        field = mean_field([row[1:] for row in rows])
        peak = max(abs(v) for row in rows for v in row[1:])
        print(f"  Peak absolute axis reading: {peak} mG")
        if peak >= NEAR_LIMIT_MG:
            near_limit += 1
            print("  Near the +/-4 G range limit. Check magnet strength or spacing.")
        if point is None:
            background = field
        else:
            fields[point] = tuple(v - b for v, b in zip(field, background))
    return fields, near_limit


def run_feasibility(port, output):
    prints = {}
    near_limit = 0
    for trial in range(1, 4):
        print(f"\nPass {trial}/3")
        points = POINTS if trial != 2 else list(reversed(POINTS))
        fields, warnings = collect_pass(port, output, trial, points)
        prints.update({(trial, point): field for point, field in fields.items()})
        near_limit += warnings

    correct = 0
    for (trial, point), field in prints.items():
        distances = {}
        for candidate in POINTS:
            reference = mean_field([prints[t, candidate] for t in range(1, 4) if t != trial])
            distances[candidate] = math.dist(field, reference)
        closest = min(distances.values())
        matches = [p for p, d in distances.items() if d == closest]
        if matches == [point]:
            correct += 1
        else:
            print(f"  Pass {trial}, {point} mm: nearest reference(s) {matches}")
    print(f"Held-out placements identified: {correct}/{len(prints)}")
    print(f"Captures near the sensor range limit: {near_limit}/30 (includes backgrounds)")


def estimate_xy(field, calibration):
    neighbors = sorted((math.dist(field, ref), point) for point, ref in calibration.items())
    exact = [point for distance, point in neighbors if distance == 0]
    if exact:
        return mean_field(exact)
    # Include all ties at the fourth neighbor's distance.
    weights = [(1 / d, point) for d, point in neighbors if d <= neighbors[3][0]]
    total = sum(w for w, _ in weights)
    return tuple(sum(w * point[i] for w, point in weights) / total for i in (0, 1))


def position_estimator(calibration, method):
    if method == "mesh":
        return FieldMesh(calibration)
    return partial(estimate_xy, calibration=calibration)


def run_calibration(port, output, method="knn"):
    axis = (-30, -15, 0, 15, 30)
    midpoints = [(a + b) / 2 for a, b in zip(axis, axis[1:])]
    print("Calibration: 25 marks spaced 15 mm apart.")
    references, warnings = collect_pass(port, output, 1,
        [(x, y) for y in reversed(axis) for x in axis], "calibration")
    print("Validation: place the magnet at the center of each square.")
    estimate = position_estimator(references, method)
    validation, more_warnings = collect_pass(port, output, 2,
        [(x, y) for y in reversed(midpoints) for x in midpoints], "validation")
    errors = []
    for point, field in validation.items():
        x, y = estimate(field)
        error = math.dist((x, y), point)
        errors.append(error)
        print(f"  {point} mm: estimated ({x:.1f}, {y:.1f}) mm, error {error:.1f} mm")
    p90 = statistics.quantiles(errors, n=10, method="inclusive")[8]
    print(f"16 held-out positions: median {statistics.median(errors):.1f} mm, P90 {p90:.1f} mm")
    print(f"Captures near the sensor range limit: {warnings + more_warnings}/43 (includes backgrounds)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="ST-LINK serial port, e.g. /dev/ttyACM0")
    parser.add_argument("output", help="new CSV path for raw readings")
    parser.add_argument("--grid", type=int, choices=(3, 5), default=3,
                        help="3 for repeatability (default), 5 for calibration and validation")
    parser.add_argument("--estimator", choices=("knn", "mesh"), default="knn",
                        help="position estimator for 5x5 validation (default: knn)")
    args = parser.parse_args()
    try:
        with open_port(args.port) as port, open(args.output, "x", newline="") as output:
            csv.writer(output).writerow(("pass", "position", "x_mm", "y_mm", "time_ms", "Bx_mG", "By_mG", "Bz_mG"))
            if args.grid == 5:
                run_calibration(port, output, args.estimator)
            else:
                run_feasibility(port, output)
    except (OSError, termios.error, RuntimeError, EOFError) as exc:
        parser.exit(1, f"Grid capture stopped: {exc}\n")


if __name__ == "__main__":
    main()
