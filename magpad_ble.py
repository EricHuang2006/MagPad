"""MagPad GATT client for the GTK viewer using Linux BlueZ and GLib."""
import re
import struct
import time

from gi.repository import Gio, GLib


class BleLink:
    BUS = "org.bluez"
    DEVICE = "org.bluez.Device1"
    CHAR = "org.bluez.GattCharacteristic1"
    STREAM = "41b00001-9235-4fe6-b605-2651fe3625a1"
    CONTROL = "41b00002-9235-4fe6-b605-2651fe3625a1"
    PACKET = struct.Struct("<IIBBhhIH")

    def __init__(self, address, on_frame, on_status):
        if not re.fullmatch(r"(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}", address):
            raise ValueError("Use the Bluetooth address shown by bluetoothctl")
        self.bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        self.frame = on_frame
        self.status = on_status
        self.stream = self.control = None
        self.closed = False
        self.subscribed = False
        self.started_connection = False
        self.cancel = Gio.Cancellable()
        self.device = next((path for path, interfaces in self.objects().items()
                            if interfaces.get(self.DEVICE, {}).get("Address", "").upper() == address.upper()), None)
        if self.device is None:
            raise ValueError("MagPad is unknown to BlueZ. Scan for it with bluetoothctl first.")
        self.signal = self.bus.signal_subscribe(self.BUS, "org.freedesktop.DBus.Properties",
            "PropertiesChanged", None, None, Gio.DBusSignalFlags.NONE, self.changed)
        self.deadline = time.monotonic() + 25
        on_status(False, "Connecting to MagPad…")
        self.timer = GLib.timeout_add(300, self.discover)

    def objects(self):
        result = self.bus.call_sync(self.BUS, "/", "org.freedesktop.DBus.ObjectManager",
                                    "GetManagedObjects", None, None, Gio.DBusCallFlags.NONE, 3000, None)
        return result.unpack()[0]

    def call(self, path, interface, method, args=None, done=None):
        def complete(bus, result):
            try:
                bus.call_finish(result)
                if done and not self.closed:
                    done()
            except GLib.Error as exc:
                if not self.closed:
                    self.status(False, f"{method} failed: {exc.message}. Reopen the viewer to retry.")
        self.bus.call(self.BUS, path, interface, method, args, None, Gio.DBusCallFlags.NONE,
                      20000, self.cancel, complete)

    def discover(self):
        try:
            objects = self.objects()
        except GLib.Error as exc:
            self.status(False, exc.message)
            self.timer = 0
            return False
        props = objects.get(self.device, {}).get(self.DEVICE, {})
        if time.monotonic() > self.deadline:
            self.status(False, "MagPad connection timed out. Check the BLE firmware and reopen the viewer.")
            self.timer = 0
            return False
        if not props.get("Connected") and not self.started_connection:
            self.started_connection = True
            self.call(self.device, self.DEVICE, "Connect")
        if props.get("ServicesResolved"):
            for path, interfaces in objects.items():
                if not path.startswith(self.device + "/"):
                    continue
                uuid = interfaces.get(self.CHAR, {}).get("UUID")
                if uuid == self.STREAM:
                    self.stream = path
                elif uuid == self.CONTROL:
                    self.control = path
            if self.stream and self.control:
                self.call(self.stream, self.CHAR, "StartNotify", done=self.ready)
                self.timer = 0
                return False
        return True

    def ready(self):
        self.subscribed = True
        self.status(True, "BLE connected. Move the magnet away and select Measure background.")

    def changed(self, bus, sender, path, interface, signal, params):
        owner, values, _ = params.unpack()
        if path == self.device and owner == self.DEVICE and values.get("Connected") is False:
            self.status(False, "Bluetooth disconnected. Reopen the viewer to reconnect.")
        if path == self.stream and owner == self.CHAR and "Value" in values:
            data = bytes(values["Value"])
            if len(data) == self.PACKET.size:
                self.frame(*self.PACKET.unpack(data))

    def command(self, token):
        args = GLib.Variant("(aya{sv})", ([token], {"type": GLib.Variant("s", "request")}))
        self.call(self.control, self.CHAR, "WriteValue", args)

    def close(self):
        self.closed = True
        self.cancel.cancel()
        self.bus.signal_unsubscribe(self.signal)
        if self.timer:
            GLib.source_remove(self.timer)
        if self.subscribed:
            self.bus.call(self.BUS, self.stream, self.CHAR, "StopNotify", None, None,
                          Gio.DBusCallFlags.NONE, 2000, None, None)
        if self.started_connection:
            self.bus.call(self.BUS, self.device, self.DEVICE, "Disconnect", None, None,
                          Gio.DBusCallFlags.NONE, 2000, None, None)
