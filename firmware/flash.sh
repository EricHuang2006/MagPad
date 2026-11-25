#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in
    benchmark|live|live-ble) image="build/$1.elf" ;;
    *) echo "Usage: $0 {benchmark|live|live-ble}" >&2; exit 2 ;;
esac
if [[ ! -f "$image" ]]; then echo "Run firmware/build.sh first." >&2; exit 1; fi
programmer="${STM32_PROGRAMMER:-STM32_Programmer_CLI}"
if ! command -v "$programmer" >/dev/null && [[ -z "${STM32_PROGRAMMER:-}" ]]; then
    installed=("$HOME"/.local/share/stm32cube/bundles/programmer/*/bin/STM32_Programmer_CLI)
    programmer="${installed[-1]}"
fi
exec "$programmer" -c port=SWD -w "$image" -v -rst
