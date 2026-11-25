# MagPad firmware

Run the following commands from the project's `main` directory. Building uses the installed CubeL4 v1.18.2 SDK, Arm GCC, a host C compiler and Python 3. The BLE build also reuses the BlueNRG-MS middleware and SPI3 board support in the course's `Lab4/lab4_ble_acc` directory. Override the defaults with `CUBE_L4_DIR`, `ARM_CC`, or `BLUE_LAB_DIR`. Use an absolute path when overriding `MAGPAD_CALIBRATION` with another complete 5×5 CSV.

```sh
./firmware/build.sh
```

The live images default to mesh. To run KNN on the board instead, build with `LIVE_ESTIMATOR=knn ./firmware/build.sh`. The benchmark always measures both.

The build stores the background-corrected calibration and mesh geometry in flash. It replays all 520 non-background samples in the supplied CSV through the native C estimators and checks both against Python within 0.01 mm. The three board images are in `firmware/build/`. Flashing an image replaces the program on the connected board.

## Measure estimator runtime

Connect the ST-LINK USB connector and close other serial monitors. The benchmark repeats its report every three seconds. The board runs each estimator at 80 MHz using single-precision floats. UART output and comparison with Python occur outside the timed call. Divide cycles by 80 to obtain microseconds at that clock rate. A replay pass indicates numerical agreement with Python on these inputs. Physical position accuracy is measured separately at held-out positions.

```sh
./firmware/flash.sh benchmark
python3 firmware/measure.py
```

## Trace over USB

```sh
./firmware/flash.sh live
./live_trace.py --board
```

Move the magnet away and click **Measure background**. The STM32 averages 20 fresh samples and echoes the GUI request token in its progress and completion reports. Return the magnet to the calibrated plane and keep its orientation fixed. **Clear trail** clears the PC drawing. The legacy raw-field viewer is still available with the earlier sensor-test firmware.

Acquire waits on the LIS3MDL PC8 data-ready interrupt, timestamps the sample, and reads I²C2. Estimate subtracts the measured background and runs mesh interpolation. Filter applies a causal three-sample component-wise median to successive valid positions, restarting on a gap or a new baseline. For steady motion this filter adds roughly one sample period. Comms sends the result. Queues are bounded and the counters expose overruns, failed reads, and queue drops. The 80 Hz period is 12.5 ms.

To inspect timing without a competing serial reader, close the GUI after measuring background, move the magnet and run `python3 firmware/measure.py --seconds 10`. Use the sequence gaps, effective rate and maximum board processing time together. The processing interval starts at the data-ready interrupt and ends just before Comms formats the UART line. For motion-to-screen delay, record the slider and screen together at a known frame rate and count the frames between corresponding direction changes.

## Trace over BLE

```sh
./firmware/flash.sh live-ble
bluetoothctl --timeout 15 scan on
./live_trace.py --ble AA:BB:CC:DD:EE:FF
```

Replace the address with the discovered **MagPad** peripheral. The BLE build also reports USB diagnostics. On Linux the viewer uses BlueZ over the system bus. It subscribes to position notifications and writes the background token to the control characteristic. Close the viewer before switching transports.

## Wire format

USB runs at 115200 baud, 8N1. A live line is `P,seq,time_ms,token,state,x_centi_mm,y_centi_mm,faults,processing_us`. State values 0–4 mean waiting for background, measuring, field within background noise, tracking and sensor error respectively. A single nonzero command byte requests a new background. The firmware echoes it in subsequent frames so old queued positions can be discarded.

BLE service `41b00000-9235-4fe6-b605-2651fe3625a1` has stream and control characteristics with first groups `41b00001` and `41b00002`. Each notification is a 20-byte little-endian packet in the same field order as USB (Python struct `<IIBBhhIH`). BLE processing time saturates at 65535 µs and its fault count also includes rejected notification updates. The control characteristic takes the same one-byte command.
