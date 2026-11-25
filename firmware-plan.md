# MagPad firmware plan

The live firmware will use the proposal’s four CMSIS-RTOS2 threads on the STM32L475. The first build will be a standalone timing benchmark. Both builds will use the same C estimator functions and the existing STM32CubeL4 board support package. No CubeMX generation step is required.

## First build

Replay the recorded three-axis magnetic readings through four-neighbor KNN and mesh interpolation on the board. Prepare the calibration tables once at startup. Check each estimated coordinate against the Python result for the same input. Use the Cortex-M4 cycle counter to measure each estimate and report median and worst observed runtime over UART after timing. This shows how much of the 12.5 ms sample period each estimator consumes.

## Live firmware

| Thread | Priority | Responsibility |
| --- | --- | --- |
| Acquire | High | Read and timestamp fresh LIS3MDL samples over I²C at 80 Hz. Verify the board’s data-ready interrupt routing before configuring it to release the acquisition semaphore. |
| Estimate | Medium | Subtract the background field and compute an (x, y) estimate using the calibrated estimator. |
| Filter | Medium | Reject outliers and reduce stationary jitter. Measure how much delay filtering adds during motion. |
| Comms | Low | Send filtered coordinates to the PC over BLE at 20 Hz or faster. Use UART for initial bring-up and timing reports. |

Queues connect adjacent threads. Each sample carries its acquisition timestamp and sequence number so we can measure processing time and detect dropped samples under load.

For the integrated test, run all four threads together, check for missed 80 Hz samples, and measure physical motion to screen update against the proposal’s target of under 100 ms.

## PC trace viewer

The Python process on the PC will run the existing trace GUI. Today it converts raw magnetic readings into coordinates. For the live firmware, we will adapt its input to receive the STM32’s filtered coordinates in millimeters, first over the ST-LINK USB serial connection and later over BLE. The viewer will draw the current position and trail, and break the line when the board reports that tracking was lost. During the standalone benchmark, Python serves as the reference for checking the board’s results on recorded inputs.

On connection, the GUI will prompt the user to move the magnet away and click **Measure background**. The button will send a command to the board over USB serial or BLE. The board will pause position reporting, average fresh Bx, By, and Bz samples, and acknowledge completion. The GUI will then prompt the user to return the magnet. The Estimate thread will subtract that baseline from each subsequent reading. The user can repeat the measurement at any time. **Clear trail** will erase the displayed path locally and preserve the baseline.
