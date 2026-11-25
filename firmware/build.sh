#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sdk="${CUBE_L4_DIR:-$HOME/STM32Cube/Repository/STM32Cube_FW_L4_V1.18.2}"
lab="${BLUE_LAB_DIR:-../../../Lab4/lab4_ble_acc}"
cc="${ARM_CC:-arm-none-eabi-gcc}"
if ! command -v "$cc" >/dev/null && [[ -z "${ARM_CC:-}" ]]; then
    installed=("$HOME"/.local/share/stm32cube/bundles/gnu-tools-for-stm32/*/bin/arm-none-eabi-gcc)
    cc="${installed[-1]}"
fi
mkdir -p build
python3 -B export_data.py "${MAGPAD_CALIBRATION:-../grid-5x5-run1.csv}" build
"${HOST_CC:-cc}" -O2 -Wall -Wextra -Werror -Ibuild -DHOST_VERIFY benchmark.c estimator.c -lm -o build/verify
build/verify
bsp="$sdk/Drivers/BSP/B-L475E-IOT01"
hal="$sdk/Drivers/STM32L4xx_HAL_Driver"
cmsis="$sdk/Drivers/CMSIS"
dev="$cmsis/Device/ST/STM32L4xx"
rt="$sdk/Middlewares/Third_Party/FreeRTOS/Source"
flags=(-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard -DSTM32L475xx -DUSE_HAL_DRIVER
       -O2 -g -ffunction-sections -fdata-sections -Werror=implicit-function-declaration -I. -Ibuild
       -I"$sdk/Projects/B-L475E-IOT01A/Examples/BSP/Inc" -I"$bsp" -I"$hal/Inc" -I"$cmsis/Include" -I"$dev/Include")
common=(board.c estimator.c "$dev/Source/Templates/system_stm32l4xx.c" "$dev/Source/Templates/gcc/startup_stm32l475xx.s"
        "$bsp/stm32l475e_iot01.c")
for mod in cortex gpio i2c i2c_ex uart uart_ex rcc rcc_ex pwr pwr_ex dma; do
    common+=("$hal/Src/stm32l4xx_hal_$mod.c")
done
common+=("$hal/Src/stm32l4xx_hal.c")
link=(-T STM32L475XX_FLASH.ld --specs=nano.specs --specs=nosys.specs -Wl,--gc-sections -lm)
"$cc" "${flags[@]}" benchmark.c "${common[@]}" "${link[@]}" -o build/benchmark.elf
rtflags=(-DLIVE -I"$rt/include" -I"$rt/portable/GCC/ARM_CM4F" -I"$rt/CMSIS_RTOS_V2")
case "${LIVE_ESTIMATOR:-mesh}" in
    mesh) ;;
    knn) rtflags+=(-DLIVE_KNN) ;;
    *) echo "LIVE_ESTIMATOR must be mesh or knn" >&2; exit 2 ;;
esac
live=(live.c tracker.c "$bsp/stm32l475e_iot01_magneto.c" "$sdk/Drivers/BSP/Components/lis3mdl/lis3mdl.c"
      "$rt"/{tasks,queue,list,timers,event_groups}.c "$rt/CMSIS_RTOS_V2/cmsis_os2.c"
      "$rt/portable/GCC/ARM_CM4F/port.c" "$rt/portable/MemMang/heap_4.c")
"$cc" "${flags[@]}" "${rtflags[@]}" "${live[@]}" "${common[@]}" "${link[@]}" -o build/live.elf
blue="$lab/Middlewares/ST/BlueNRG-MS"
target="$lab/BlueNRG_MS/Target"
bus="$lab/Drivers/BSP/B-L475E-IOT01A1"
bleflags=(-DWITH_BLE -I. -I"$lab/Core/Inc" -I"$blue/includes"
          -I"$blue/utils" -I"$blue/hci/hci_tl_patterns/Basic" -I"$target" -I"$bus" -I"$lab/Core/Inc")
# Adapt only the vendor HCI wait loop to poll the radio without blocking the shared EXTI vector.
"$cc" "${bleflags[@]}" "${flags[@]}" -Dhci_tl_lowlevel_init=magpad_hci_bus_init \
    -DHAL_GetTick=magpad_hci_tick -c "$blue/hci/hci_tl_patterns/Basic/hci_tl.c" -o build/hci_tl.o
ble=(radio.c build/hci_tl.o "$blue/utils/ble_list.c" "$blue/hci/hci_le.c"
     "$blue"/hci/controller/bluenrg_{gap,gatt,hal}_aci.c "$target/hci_tl_interface.c"
     "$bus/b_l475e_iot01a1_bus.c" "$hal"/Src/stm32l4xx_hal_{exti,spi,spi_ex}.c)
"$cc" "${bleflags[@]}" "${flags[@]}" "${rtflags[@]}" "${live[@]}" "${ble[@]}" "${common[@]}" "${link[@]}" -o build/live-ble.elf
