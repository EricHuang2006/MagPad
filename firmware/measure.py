"""Read the on-board replay benchmark or measure the live USB stream."""
import argparse
import os
from pathlib import Path
import select
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from magpad_serial import open_port


def measure(port, seconds):
    deadline = time.monotonic() + seconds
    buffer = b""
    previous = None
    arrivals, ticks, durations = [], [], []
    losses = discontinuities = faults = 0
    first_drops = None
    reports = {}
    while (remaining := deadline - time.monotonic()) > 0 and select.select([port], [], [], remaining)[0]:
        chunk = os.read(port, 4096)
        if not chunk:
            raise ValueError("Board disconnected")
        lines = (buffer + chunk).split(b"\n")
        buffer = lines.pop()
        for line in lines:
            text = line.decode(errors="replace").strip()
            if text.startswith(("knn samples=", "mesh samples=")):
                reports[text.split()[0]] = text
            if text in ("REPLAY PASS", "REPLAY FAIL") and len(reports) == 2:
                for report in reports.values():
                    print(report)
                print(text)
                return text == "REPLAY PASS"
            if not text.startswith("P,"):
                continue
            try:
                seq, tick, token, state, x, y, drops, usec = map(int, text[2:].split(","))
            except ValueError:
                continue  # Opening a streaming port can split a record.
            if first_drops is None:
                first_drops = drops
            if state == 4:
                faults += 1
                continue
            if previous is not None:
                step = (seq-previous) & 0xffffffff
                dt = (tick-last_tick) & 0xffffffff
                if step == 0 or step > 0x7fffffff or dt > 0x7fffffff:
                    raise ValueError("Sample counter restarted; rerun the measurement")
                losses += step-1
                discontinuities += dt > 19  # 1.5 periods at the planned 80 Hz
                ticks.append(dt)
            previous, last_tick = seq, tick
            arrivals.append(time.monotonic())
            durations.append(usec)
    if len(arrivals) < 2 or not sum(ticks):
        raise ValueError(f"Too few valid samples (sensor error frames: {faults})")
    rate = (len(arrivals)-1)*1000/sum(ticks)
    host_duration = arrivals[-1]-arrivals[0]
    print(f"{len(arrivals)} USB frames, board timestamps {rate:.1f} Hz")
    if host_duration > 0:
        print(f"Host delivery { (len(arrivals)-1)/host_duration:.1f} Hz")
    print(f"Sequence gaps (missing samples): {losses}, intervals above 19 ms: {discontinuities}")
    print(f"Sensor error frames: {faults}, increase in firmware faults/drops: {(drops-first_drops)&0xffffffff}")
    print(f"Data-ready to Comms, microseconds: median {statistics.median(durations):g}, max {max(durations)}")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", default="/dev/ttyACM0")
    parser.add_argument("--seconds", type=float, default=8)
    args = parser.parse_args()
    try:
        with open_port(args.port) as port:
            sys.exit(0 if measure(port, args.seconds) else 1)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Measurement stopped: {exc}\n")
