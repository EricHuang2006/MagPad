#include "board.h"
#ifdef LIVE
#include "FreeRTOS.h"
#include "task.h"
extern void xPortSysTickHandler(void);
#endif
#include <string.h>

static UART_HandleTypeDef serial;

void SysTick_Handler(void) {
    HAL_IncTick();
#ifdef LIVE
    if (xTaskGetSchedulerState() != taskSCHEDULER_NOT_STARTED) xPortSysTickHandler();
#endif
}

void board_print(const char *s) {
    HAL_UART_Transmit(&serial, (uint8_t *)s, (uint16_t)strlen(s), 100);
}

static void configure_clock(void) {
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};
    osc.OscillatorType = RCC_OSCILLATORTYPE_MSI;
    osc.MSIState = RCC_MSI_ON;
    osc.MSIClockRange = RCC_MSIRANGE_6;
    osc.MSICalibrationValue = RCC_MSICALIBRATION_DEFAULT;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_MSI;
    osc.PLL.PLLM = 1; osc.PLL.PLLN = 40;
    osc.PLL.PLLR = RCC_PLLR_DIV2; osc.PLL.PLLP = RCC_PLLP_DIV7; osc.PLL.PLLQ = RCC_PLLQ_DIV4;
    if (HAL_RCC_OscConfig(&osc) != HAL_OK) { for (;;) {} }
    clk.ClockType = RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
    clk.APB1CLKDivider = RCC_HCLK_DIV1;
    clk.APB2CLKDivider = RCC_HCLK_DIV1;
    if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_4) != HAL_OK) { for (;;) {} }
}

void board_init(void) {
    HAL_Init();
    configure_clock();
    serial.Instance = DISCOVERY_COM1;
    serial.Init.BaudRate = 115200;
    serial.Init.WordLength = UART_WORDLENGTH_8B;
    serial.Init.StopBits = UART_STOPBITS_1;
    serial.Init.Parity = UART_PARITY_NONE;
    serial.Init.Mode = UART_MODE_TX_RX;
    serial.Init.HwFlowCtl = UART_HWCONTROL_NONE;
    serial.Init.OverSampling = UART_OVERSAMPLING_16;
    BSP_COM_Init(COM1, &serial);

    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

int board_getchar(void) {
    if (__HAL_UART_GET_FLAG(&serial, UART_FLAG_ORE)) __HAL_UART_CLEAR_OREFLAG(&serial);
    if (!__HAL_UART_GET_FLAG(&serial, UART_FLAG_RXNE)) return -1;
    return serial.Instance->RDR & 0xff;
}
