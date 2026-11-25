# MagPad user guide

Run the commands below from this directory (`main`). Connect the board through its ST-LINK USB connector. The examples use `/dev/ttyACM0`. Close the viewer before starting another program that reads the same port.

## Daily use

With the USB live firmware installed, start the trace viewer:

```sh
./live_trace.py --board
```

Move the magnet well away, click **Measure background**, and keep it away until the GUI says **Background measured**. Slide it across the grid at the same height and orientation used for calibration. The dot is the STM32’s estimated position in millimeters. **Clear trail** erases the path and keeps the current background.

## When the position looks wrong

1. **Remeasure the background first.** Move the magnet away and click **Measure background** again. The board replaces its baseline with the average of 20 fresh readings. This takes about a quarter second at 80 Hz and requires no reflash. Then check the center and a marked point near an edge.
2. **Check the physical setup.** Align the grid origin over the magnetometer and check the spacer height, magnet face, and board orientation. Restoring the original geometry lets you keep using its calibration.
3. **Recalibrate the grid** if you changed the magnet or mounting geometry, or the error persists at known points. The background is a single three-axis offset in RAM. The grid is a map of field readings to positions stored in firmware flash. Updating that map uses the workflow below.

## Record and install a new grid

**1. Switch to the raw sensor firmware.** Close the GUI. The grid recorder needs timestamped Bx, By, and Bz readings. The live image sends estimated positions. Flashing replaces the running program on the board.

```sh
~/.local/share/stm32cube/bundles/programmer/2.23.0/bin/STM32_Programmer_CLI \
  -c port=SWD -w ../MagPad_sensor_test/magnetometer_test.elf -v -rst
```

**2. Capture and validate.** Mark −30, −15, 0, +15, and +30 mm on both axes. Keep the board fixed and the magnet in its slider. Use a fresh CSV filename for each run.

```sh
python3 grid_check.py --grid 5 --estimator mesh /dev/ttyACM0 grid-5x5-run2.csv
```

Follow the printed coordinates through 25 calibration marks, then 16 cell centers for an independent accuracy check. The project targets are median error below 5 mm and 90th-percentile error below 10 mm. If a range warning leads you to change the magnet or spacer, start a fresh run so every point uses the same geometry.

**3. Install the new map and reopen the viewer.** Use the same CSV filename you recorded above.

```sh
export MAGPAD_CALIBRATION="$PWD/grid-5x5-run2.csv"
./firmware/build.sh && ./firmware/flash.sh live
./live_trace.py --board
```

Measure the background once more after flashing. The new map stays on the board across power cycles. In a new shell, set `MAGPAD_CALIBRATION` again before future builds to keep using this CSV. The build default is `grid-5x5-run1.csv`.

## File reference

| File | What it does |
| --- | --- |
| [live_trace.py](live_trace.py) | Displays the trace. Use `--board` for live USB firmware or `--ble ADDRESS` for BLE firmware. Running without either option uses raw firmware and estimates on the PC. |
| [live_field.py](live_field.py) | Shows raw Bx, By, and Bz with the sensor-test firmware. Use it to check magnet orientation and range. |
| [grid_check.py](grid_check.py) | Records labeled raw samples. The default 3×3 test checks repeatability. `--grid 5` records a calibration map and measures position error at cell centers. |
| [field_mesh.py](field_mesh.py) | Python reference implementation of the mesh estimator. The on-board C implementation is in [estimator.c](firmware/estimator.c). |
| [magpad_serial.py](magpad_serial.py), [magpad_ble.py](magpad_ble.py) | USB serial and Bluetooth helpers used by the PC tools. |
| [grid-5x5-run1.csv](grid-5x5-run1.csv) | Original 5×5 map used by the default build. The two 3×3 CSVs are earlier feasibility runs. |
| [firmware guide](firmware/README.md) | Build and flash commands, USB and BLE setup, benchmark timing, and wire formats. |
| [firmware plan](firmware-plan.md) | Design of the Acquire, Estimate, Filter, and Comms threads. |
