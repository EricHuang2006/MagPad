#!/usr/bin/env nix-shell
#! nix-shell -i python3 -p gtk3 gobject-introspection "python3.withPackages (ps: [ ps.pygobject3 ps.pycairo ])"
"""Plot the live MagPad position on the calibrated 60 mm square."""

import argparse
from collections import deque
import os
import secrets
import termios
import time

import cairo
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk

from grid_check import SAMPLES, position_estimator
from live_field import background_profile, load_calibration, predict_position
from magpad_serial import open_port


class TraceWindow:
    def __init__(self, port, calibration, method="knn", board=False, ble_address=None):
        self.port = port
        self.on_board = board or bool(ble_address)
        self.estimate = None if self.on_board else position_estimator(calibration, method)
        self.radio = None
        self.token = None
        self.last_token = 0
        self.last_seq = None
        self.trail = deque(maxlen=2400)
        self.profile = None
        self.background_samples = None
        self.buffer = b""
        self.skip_first_line = True
        self.last_sample = time.monotonic()

        source = "STM32" if self.on_board else method.upper()
        self.window = Gtk.Window(title=f"MagPad · Live trace ({source})")
        self.window.set_default_size(760, 780)
        self.window.set_size_request(510, 520)
        panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        panel.set_border_width(18)
        self.window.add(panel)
        header = Gtk.Box(spacing=8)
        panel.pack_start(header, False, False, 0)
        title = Gtk.Label(xalign=0)
        title.set_markup('<span size="xx-large" weight="bold">Live trace</span>')
        header.pack_start(title, True, True, 0)
        self.baseline_button = Gtk.Button(label="Measure background")
        self.baseline_button.connect("clicked", self.start_background)
        header.add(self.baseline_button)
        clear_button = Gtk.Button(label="Clear trail")
        clear_button.connect("clicked", self.clear)
        header.add(clear_button)
        self.canvas = Gtk.DrawingArea()
        self.canvas.connect("draw", self.draw)
        panel.pack_start(self.canvas, True, True, 0)
        self.readout = Gtk.Label(xalign=0)
        self.readout.set_text("X  —     Y  —   mm")
        panel.add(self.readout)
        self.status = Gtk.Label(label="Move the magnet away, then select Measure background.", xalign=0)
        panel.add(self.status)

        self.watch = None
        if ble_address:
            from magpad_ble import BleLink
            self.baseline_button.set_sensitive(False)
            self.radio = BleLink(ble_address, self.board_frame, self.link_status)
        else:
            self.watch = GLib.unix_fd_add_full(
                GLib.PRIORITY_DEFAULT, port, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self.read_serial)
        self.timer = GLib.timeout_add(500, self.check_stream)
        self.window.connect("destroy", self.close)
        self.window.show_all()

    def close(self, widget):
        if self.radio:
            self.radio.close()
        if self.watch:
            GLib.source_remove(self.watch)
        GLib.source_remove(self.timer)
        Gtk.main_quit()

    def clear(self, button=None):
        self.trail.clear()
        self.canvas.queue_draw()

    def start_background(self, button=None):
        if self.on_board:
            self.token = (self.last_token + secrets.randbelow(254)) % 255 + 1
            self.last_token = self.token
            self.clear()
            self.gap("Waiting for the board to measure background. Keep the magnet away.")
            if self.radio:
                self.radio.command(self.token)
            else:
                try:
                    os.write(self.port, bytes([self.token]))
                except OSError as exc:
                    self.gap(str(exc))
            return
        self.profile = None
        self.background_samples = []
        self.clear()
        self.readout.set_text("X  —     Y  —   mm")
        termios.tcflush(self.port, termios.TCIFLUSH)
        self.buffer = b""
        self.skip_first_line = True
        self.status.set_text("Measuring background. Keep the magnet away.")

    def gap(self, message):
        if self.trail and self.trail[-1] is not None:
            self.trail.append(None)
            self.canvas.queue_draw()
        self.readout.set_text("X  —     Y  —   mm")
        self.status.set_text(message)

    def check_stream(self):
        if (self.watch or self.radio) and time.monotonic() - self.last_sample > 2 and (
                self.token is not None or self.profile or self.background_samples is not None):
            self.gap("Waiting for sensor samples…")
        return True

    def read_serial(self, port, condition):
        try:
            chunk = os.read(port, 4096) if condition & GLib.IO_IN else b""
        except OSError:
            chunk = b""
        if not chunk:
            self.watch = None
            self.baseline_button.set_sensitive(False)
            self.gap("Board disconnected. Reconnect and restart the trace.")
            return False
        lines = (self.buffer + chunk).split(b"\n")
        self.buffer = lines.pop()
        for line in lines:
            if self.skip_first_line:
                self.skip_first_line = False
                continue
            if self.on_board:
                try:
                    prefix, *fields = line.split(b",")
                    if prefix != b"P" or len(fields) != 8:
                        raise ValueError()
                    self.board_frame(*(int(value) for value in fields))
                except ValueError:
                    self.gap(line.decode(errors="replace").strip())
                continue
            try:
                _, bx, by, bz = map(int, line.split(b","))
            except ValueError:
                self.gap(line.decode(errors="replace").strip())
                continue
            self.last_sample = time.monotonic()
            sample = (bx, by, bz)
            if self.background_samples is not None:
                self.background_samples.append(sample)
                if len(self.background_samples) == SAMPLES:
                    self.profile = background_profile(self.background_samples)
                    self.background_samples = None
                    self.status.set_text("Background measured. Move the magnet over the grid.")
            elif self.profile is not None:
                xy = predict_position(sample, self.estimate, *self.profile)
                if xy is None:
                    self.gap("Field within background noise.")
                else:
                    self.trail.append(xy)
                    self.readout.set_text(f"X  {xy[0]:+5.1f}     Y  {xy[1]:+5.1f}   mm")
                    self.status.set_text("Tracking")
                    self.canvas.queue_draw()
        return True

    def link_status(self, connected, message):
        self.baseline_button.set_sensitive(connected)
        self.token = None
        self.last_seq = None
        self.gap(message)

    def board_frame(self, seq, tick, token, state, x, y, drops, elapsed_us):
        self.last_sample = time.monotonic()
        if self.token is None:
            self.last_token = token
            return
        if token != self.token:
            if state == 0:
                self.gap("Board needs a background. Move the magnet away and measure again.")
            return
        if self.last_seq is not None and seq != (self.last_seq+1) % (1 << 32):
            self.gap("Sample gap")
        self.last_seq = seq
        if state == 3:
            xy = (x / 100, y / 100)
            self.trail.append(xy)
            self.readout.set_text(f"X  {xy[0]:+5.1f}     Y  {xy[1]:+5.1f}   mm")
            self.status.set_text(f"Tracking · sample {seq} · board {elapsed_us} µs · faults/drops {drops}")
            self.canvas.queue_draw()
        else:
            messages = {0: "Move the magnet away and measure background.",
                        1: "Measuring background. Keep the magnet away.",
                        2: "Background measured. Move the magnet over the grid.",
                        4: "Sensor read failed. Check the board."}
            self.gap(messages.get(state, "Unknown board status"))

    def draw(self, canvas, ctx):
        width, height = canvas.get_allocated_width(), canvas.get_allocated_height()
        cx, cy = width / 2, height / 2
        extent = max(1, min(width - 100, height - 92)) / 2
        scale = extent / 30
        ctx.set_source_rgb(.06, .14, .16)
        ctx.paint()
        ctx.set_line_width(1)
        ctx.set_font_size(13)

        def label(x, y, text):
            ctx.set_source_rgb(.78, .85, .86)
            ctx.move_to(x - ctx.text_extents(text).width / 2, y)
            ctx.show_text(text)

        for tick in (-30, -15, 0, 15, 30):
            x, y = cx + tick * scale, cy - tick * scale
            ctx.set_source_rgb(*((.46, .57, .60) if tick == 0 else (.21, .31, .35)))
            ctx.move_to(x, cy - extent)
            ctx.line_to(x, cy + extent)
            ctx.move_to(cx - extent, y)
            ctx.line_to(cx + extent, y)
            ctx.stroke()
            label(x, cy + extent + 18, str(tick))
            label(cx - extent - 19, y + 4, str(tick))
        label(cx, cy + extent + 37, "X (mm)")
        label(cx - extent, cy - extent - 12, "Y (mm)")

        ctx.set_source_rgb(.36, .90, .76)
        ctx.set_line_width(2.5)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.new_path()
        for point in self.trail:
            if point is None:
                ctx.new_sub_path()
            else:
                x, y = cx + point[0] * scale, cy - point[1] * scale
                if not ctx.has_current_point():
                    ctx.move_to(x, y)
                ctx.line_to(x, y)
        ctx.stroke()
        if self.trail and self.trail[-1] is not None:
            x, y = self.trail[-1]
            ctx.set_source_rgb(1, .96, .78)
            ctx.arc(cx + x * scale, cy - y * scale, 5, 0, 6.283185307)
            ctx.fill()
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", default="/dev/ttyACM0")
    parser.add_argument("--calibration", default="grid-5x5-run1.csv", metavar="CSV")
    parser.add_argument("--estimator", choices=("knn", "mesh"), default="knn",
                        help="position estimator (default: knn)")
    parser.add_argument("--board", action="store_true", help="plot coordinates computed by the STM32 over USB")
    parser.add_argument("--ble", metavar="ADDRESS", help="plot coordinates from a MagPad BLE peripheral")
    args = parser.parse_args()
    try:
        if not Gtk.init_check()[0]:
            parser.exit(1, "Trace stopped: could not open the desktop display.\n")
        if args.ble:
            TraceWindow(None, None, ble_address=args.ble)
            Gtk.main()
        else:
            calibration = None if args.board else load_calibration(args.calibration)
            with open_port(args.port) as port:
                TraceWindow(port, calibration, args.estimator, args.board)
                Gtk.main()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, KeyError, termios.error, GLib.Error) as exc:
        parser.exit(1, f"Trace stopped: {exc}\n")


if __name__ == "__main__":
    main()
