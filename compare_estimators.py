"""Compare mesh and KNN position errors on a recorded MagPad 5x5 capture."""

import argparse
import csv
import math
import statistics
from collections import defaultdict

from grid_check import SAMPLES, mean_field, position_estimator
from live_field import load_calibration


def validation_fields(path):
    backgrounds = defaultdict(list)
    placements = defaultdict(list)
    with open(path, newline="") as stream:
        for row in csv.DictReader(stream):
            label = row["position"]
            if label not in ("background", "validation"):
                continue
            field = tuple(int(row[key]) for key in ("Bx_mG", "By_mG", "Bz_mG"))
            trial = row["pass"]
            if label == "background":
                backgrounds[trial].append(field)
            else:
                point = (float(row["x_mm"]), float(row["y_mm"]))
                placements[trial, point].append(field)

    for (trial, point), samples in placements.items():
        if len(samples) != SAMPLES or len(backgrounds[trial]) != SAMPLES:
            raise ValueError(f"Incomplete capture for pass {trial}, point {point}")
        background = mean_field(backgrounds[trial])
        yield point, tuple(v - b for v, b in zip(mean_field(samples), background))


def compare(title, references, placements):
    print(f"\n{title} (calibration marks = {len(references)}, test placements = {len(placements)})")
    if not placements:
        print("No validation placements recorded.")
        return
    print("              Median       P90")
    for method in ("mesh", "knn"):
        estimate = position_estimator(references, method)
        errors = [math.dist(estimate(field), point) for point, field in placements]
        p90 = "     --"
        if len(errors) > 1:
            percentile = statistics.quantiles(errors, n=10, method="inclusive")[8]
            p90 = f"{percentile:6.2f} mm"
        print(f"{method:5}      {statistics.median(errors):6.2f} mm  {p90}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", help="CSV from grid_check.py --grid 5")
    args = parser.parse_args()
    try:
        full = load_calibration(args.capture)
        validation = list(validation_fields(args.capture))
        if any(point in full for point, _ in validation):
            raise ValueError("Validation includes a calibration mark")
        compare("Recorded cell centers", full, validation)

        coarse_axis = {-30, 0, 30}
        coarse = {p: v for p, v in full.items() if all(c in coarse_axis for c in p)}
        withheld = [(p, v) for p, v in full.items() if p not in coarse]
        compare("Withheld grid marks (same calibration pass)", coarse, withheld)
    except (OSError, KeyError, ValueError) as exc:
        parser.exit(1, f"Comparison stopped: {exc}\n")


if __name__ == "__main__":
    main()
