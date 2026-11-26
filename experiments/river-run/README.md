# River Run — Alder Narrows

Steer a motorboat through a 600 m river course. Rocks end the run. The finish banner records your time and the browser keeps your personal best. The fixed course makes repeat runs comparable. Pass the riverfront boathouses, go under the timber footbridge at 300 m, and look for the checkered finish banner.

## Play

From the project’s main directory, start a local static server.

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory experiments/river-run
```

Open **http://localhost:8000** in a desktop browser with WebGL 2. Click **Launch boat**. The left and right arrows steer, up accelerates, down slows, and releasing the speed keys returns to cruise. Press **Escape** or click **Pause** to pause.

## Use the magnetic controller

1. Use the existing USB live firmware and connect the ST-LINK USB cable. Close the trace viewer and other serial monitors. If the board is running the raw sensor test or benchmark, use the project's [firmware guide](../../firmware/README.md#trace-over-usb) to install the live image.
2. Open the game in desktop Chrome or Chromium. Click **Connect MagPad** and select the ST-LINK serial port. The game receives the board's estimated positions directly over Web Serial at 115200 baud.
3. Move the magnet well away and click **Measure background**. After the board finishes, place the magnet at the center of the pad at its calibrated height and orientation. Click **Launch boat** once tracking starts.
4. Slide left or right to position the boat across the river. Positive pad Y (forward) increases speed, negative Y slows it, and center cruises. The mapping uses the calibrated ±30 mm range. The run pauses on lost tracking, stale frames, disconnect, or background measurement. Restore tracking and click **Resume**, or disconnect to switch to the keyboard.

If the page keeps waiting for live frames, check the selected port and firmware. If an open-port error appears, close competing serial readers and check the account's serial-port access. All game assets are local, so the demo can run offline.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css` | Game screen and controls |
| `src/main.js` | Input, game loop, timer and run states |
| `src/course.js` | Course layout, motion and collisions |
| `src/scene.js` | Boat, chase camera, rendering and bank vegetation |
| `src/scenery.js` | Mountain backdrop, boathouses and halfway bridge |
| `src/water.js` | Animated current, shallows and the wake along the boat’s path |
| `src/magpad.js` | USB frames and background command |
| `vendor/three/` | Three.js 0.180.0 browser modules and upstream MIT license |
