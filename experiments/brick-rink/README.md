# Brick Rink

From the MagPad project's main directory, serve the experiments folder so the game can load the shared USB reader.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory experiments
```

Open **http://localhost:8765/brick-rink/**. Click **Drop puck**. Move the pointer, drag on a touchscreen, or use the arrow keys to move the teal striker on the left. Swipe into the puck to shoot. Aim at an orange brick to open a gap, then shoot through the exposed goal. Bricks stay broken after a goal. Play lasts 90 seconds of match time. A tie clears both walls and puts two pucks in play. The next goal wins.

For the magnetic controller, open the game in desktop Chromium with the [live USB firmware](../../firmware/README.md#trace-over-usb) running and other serial readers closed. Click **Connect MagPad**, select the ST-LINK serial port, move the magnet away and click **Measure background**. When prompted, return the magnet to the calibrated pad and start the match. The ±30 mm range maps to your half of the table. Positive X moves right and positive Y moves up. The game pauses if tracking stops. Restore the signal and press **Resume**, or disconnect to play with the pointer.

Press **Escape** or click **Pause** for a time out.
