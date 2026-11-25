"""Display live LIS3MDL magnetic field readings as signed bars in the terminal."""

import argparse
import csv
import math
import os
import select
import shutil
import sys
import termios
from collections import defaultdict

from grid_check import SAMPLES, capture, mean_field, position_estimator
from magpad_serial import open_port


def load_calibration(path):
    samples = defaultdict(list)
    with open(path, newline="") as stream:
        for row in csv.DictReader(stream):
            if row["pass"] != "1" or row["position"] not in ("background", "calibration"):
                continue
            point = None if row["position"] == "background" else (float(row["x_mm"]), float(row["y_mm"]))
            samples[point].append(tuple(int(row[key]) for key in ("Bx_mG", "By_mG", "Bz_mG")))
    axis = (-30, -15, 0, 15, 30)
    expected = {(x, y) for x in axis for y in axis} | {None}
    if samples.keys() != expected or any(len(rows) != SAMPLES for rows in samples.values()):
        raise ValueError("Expected a complete 5x5 calibration with its first background capture")
    background = mean_field(samples.pop(None))
    return {point: tuple(v - b for v, b in zip(mean_field(rows), background))
            for point, rows in samples.items()}


def bar(value, width):
    length = min(width, round(abs(value) * width / 4000))
    left = ("=" * length if value < 0 else "").rjust(width)
    right = ("=" * length if value > 0 else "").ljust(width)
    return left + "|" + right


def background_profile(samples):
    center = mean_field(samples)
    return center, max(math.dist(sample, center) for sample in samples)


def predict_position(sample, estimate, background, noise):
    field = tuple(v - b for v, b in zip(sample, background))
    if math.hypot(*field) > noise:
        return estimate(field)
    return None


def monitor(port, calibration=None, method="knn"):
    if calibration:
        estimate = position_estimator(calibration, method)
        rows = capture(port, "Move the magnet well away to measure the current background")
        samples = [row[1:] for row in rows]
        background, noise = background_profile(samples)
    interactive = sys.stdout.isatty()
    buffer = b""
    synchronized = False
    if interactive:
        print("\033[?1049h\033[?25l", end="", flush=True)

    def show(message):
        if interactive:
            print("\033[H\033[J" + message, flush=True)
        else:
            print(message, flush=True)

    try:
        show("Waiting for the magnetometer. Press Ctrl+C to stop.")
        while True:
            if not select.select([port], [], [], 2)[0]:
                show("No serial data for 2 seconds. Check the board and serial port.")
                continue
            chunk = os.read(port, 4096)
            if not chunk:
                raise OSError("Serial port disconnected")
            lines = (buffer + chunk).split(b"\n")
            buffer = lines.pop()
            for line in lines:
                if not synchronized:
                    synchronized = True  # The first line may start mid-sample.
                    continue
                try:
                    tick, x, y, z = map(int, line.split(b","))
                except ValueError:
                    show(line.decode(errors="replace").strip())
                    continue
                position = ""
                if calibration:
                    xy = predict_position((x, y, z), estimate, background, noise)
                    if xy is None:
                        position = "Field within background noise"
                    else:
                        px, py = xy
                        position = f"Estimated position: x {px:+.1f} mm, y {py:+.1f} mm"
                if interactive:
                    width = max(1, min(32, (shutil.get_terminal_size().columns - 18) // 2))
                    rows = ["MagPad | -4000 to +4000 mG | center mark = zero | Ctrl+C to stop", ""]
                    for axis, value in zip(("Bx", "By", "Bz"), (x, y, z)):
                        rows.append(f"{axis} {value:+6d} mG  {bar(value, width)}")
                    if position:
                        rows.extend(["", position])
                    show("\n".join(rows))
                else:
                    show(f"{tick} ms   Bx {x:+d}   By {y:+d}   Bz {z:+d} mG  {position}".rstrip())
    finally:
        if interactive:
            print("\033[?25h\033[?1049l", end="", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", default="/dev/ttyACM0")
    parser.add_argument("--calibration", metavar="CSV", help="display estimated x/y from a saved 5x5 grid")
    parser.add_argument("--estimator", choices=("knn", "mesh"), default="knn")
    args = parser.parse_args()
    try:
        calibration = load_calibration(args.calibration) if args.calibration else None
        with open_port(args.port) as port:
            monitor(port, calibration, args.estimator)
    except KeyboardInterrupt:
        pass
    except (OSError, termios.error, ValueError, KeyError, RuntimeError, EOFError) as exc:
        parser.exit(1, f"Live monitor stopped: {exc}\n")


if __name__ == "__main__":
    main()
