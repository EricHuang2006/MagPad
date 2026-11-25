"""Open the MagPad UART at 115200 baud, 8N1 on Linux."""

from contextlib import contextmanager
import termios
import tty


@contextmanager
def open_port(path):
    with open(path, "r+b", buffering=0) as serial:
        port = serial.fileno()
        original = termios.tcgetattr(port)
        try:
            tty.setraw(port)
            settings = termios.tcgetattr(port)
            settings[4:6] = [termios.B115200] * 2
            settings[2] |= termios.CLOCAL | termios.CREAD
            settings[2] &= ~(termios.CRTSCTS | termios.CSTOPB)
            termios.tcsetattr(port, termios.TCSAFLUSH, settings)
            yield port
        finally:
            termios.tcsetattr(port, termios.TCSANOW, original)
