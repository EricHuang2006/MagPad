#include "board.h"
#include "tracker.h"
#include "stm32l475e_iot01_magneto.h"
#include "cmsis_os2.h"
#include <math.h>
#include <stdio.h>
#ifdef WITH_BLE
#include "radio.h"
#endif

enum { DEPTH = 8 };
typedef struct {
    uint32_t seq, tick, start, request;
    Field field;
    int valid;
} Reading;
static osMessageQueueId_t raw_queue, estimated_queue, filtered_queue;
static osSemaphoreId_t ready;
static volatile uint32_t irq_seq, irq_ms, irq_cycles, requested;
static volatile uint32_t acquisition_faults, raw_drops, estimate_drops, filter_drops;

static void fatal(const char *why) {
    board_print(why);
    for (;;) __WFI();
}

void EXTI9_5_IRQHandler(void) {
    if (__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_8)) {
        __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_8);
        irq_ms = HAL_GetTick();
        irq_cycles = DWT->CYCCNT;
        ++irq_seq;
        osSemaphoreRelease(ready);
    }
}

static void init_sensor(void) {
    const uint8_t address = LIS3MDL_MAG_I2C_ADDRESS_HIGH;
    const uint8_t setting = LIS3MDL_MAG_OM_XY_HIGH | LIS3MDL_MAG_ODR_80_HZ;
    if (BSP_MAGNETO_Init() != MAGNETO_OK) fatal("ERROR LIS3MDL init\r\n");
    SENSOR_IO_Write(address, LIS3MDL_MAG_CTRL_REG1, setting);
    if (SENSOR_IO_Read(address, LIS3MDL_MAG_CTRL_REG1) != setting)
        fatal("ERROR LIS3MDL 80 Hz configuration\r\n");
    __HAL_RCC_GPIOC_CLK_ENABLE();
    __HAL_RCC_SYSCFG_CLK_ENABLE();
    GPIO_InitTypeDef gpio = {.Pin=GPIO_PIN_8, .Mode=GPIO_MODE_IT_RISING, .Pull=GPIO_NOPULL};
    HAL_GPIO_Init(GPIOC, &gpio);
    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_8);
    HAL_NVIC_SetPriority(EXTI9_5_IRQn, 6, 0);
    HAL_NVIC_EnableIRQ(EXTI9_5_IRQn);
    // Consume any sample already pending when EXTI was armed, allowing the next edge.
    uint8_t discard[6];
    SENSOR_IO_ReadMultiple(address, LIS3MDL_MAG_OUTX_L | 0x80, discard, 6);
}

static void acquire(void *argument) {
    (void)argument;
    init_sensor();
    uint32_t previous = 0;
    for (;;) {
        osStatus_t status = osSemaphoreAcquire(ready, 100);
        uint32_t mask = __get_PRIMASK();
        __disable_irq();
        Reading r = {.seq=irq_seq, .tick=irq_ms, .start=irq_cycles, .request=requested};
        __set_PRIMASK(mask);
        uint8_t bytes[6];
        const uint8_t addr = LIS3MDL_MAG_I2C_ADDRESS_HIGH;
        uint8_t flags = SENSOR_IO_Read(addr, LIS3MDL_MAG_STATUS_REG);
        if (status == osOK && r.seq == previous) continue;
        if (r.seq-previous > 1) acquisition_faults += r.seq-previous-1;
        previous = r.seq;
        if (flags & 0x80) ++acquisition_faults;
        if ((flags & 8) && SENSOR_IO_ReadMultiple(addr, LIS3MDL_MAG_OUTX_L | 0x80, bytes, 6) == HAL_OK
            && status == osOK) {
            float axes[3];
            for (unsigned i=0; i<3; ++i) {
                int16_t raw = (int16_t)(bytes[2*i] | (uint16_t)bytes[2*i+1]<<8);
                axes[i] = (int)(raw * LIS3MDL_MAG_SENSITIVITY_FOR_FS_4GA);
            }
            r.field = (Field){axes[0], axes[1], axes[2]};
            r.valid = 1;
        } else {
            ++acquisition_faults;
        }
        if (osMessageQueuePut(raw_queue, &r, 0, 0) != osOK) ++raw_drops;
    }
}

static void estimate(void *argument) {
    (void)argument;
    Tracker tracker = {0};
    for (;;) {
        Reading r;
        osMessageQueueGet(raw_queue, &r, NULL, osWaitForever);
        Result out = {.seq=r.seq, .tick=r.tick, .start=r.start, .request=r.request};
        tracker_update(&tracker, &out, r.field, r.valid);
        if (osMessageQueuePut(estimated_queue, &out, 0, 0) != osOK) ++estimate_drops;
    }
}

static void filter(void *argument) {
    (void)argument;
    TraceFilter filter_state = {0};
    for (;;) {
        Result r;
        osMessageQueueGet(estimated_queue, &r, NULL, osWaitForever);
        filter_update(&filter_state, &r);
        if (osMessageQueuePut(filtered_queue, &r, 0, 0) != osOK) ++filter_drops;
    }
}

// Low byte echoes the GUI command; upper bits distinguish successive requests.
static void request_background(uint8_t token) {
    if (token) requested = ((requested & 0xffffff00u) + 256u) | token;
}

static void comms(void *argument) {
    (void)argument;
    for (;;) {
        int byte = board_getchar();
        if (byte > 0) request_background((uint8_t)byte);
#ifdef WITH_BLE
        request_background(radio_poll());
#endif
        Result r;
        if (osMessageQueueGet(filtered_queue, &r, NULL, 2) != osOK || r.request != requested) continue;
        unsigned drops = acquisition_faults + raw_drops + estimate_drops + filter_drops;
        unsigned elapsed_us = (DWT->CYCCNT-r.start)/(SystemCoreClock/1000000);
        int x = (int)lroundf(r.xy.x*100), y = (int)lroundf(r.xy.y*100);
        char line[100];
        snprintf(line, sizeof line, "P,%lu,%lu,%u,%u,%d,%d,%u,%u\r\n",
                 (unsigned long)r.seq, (unsigned long)r.tick, (uint8_t)r.request,
                 r.state, x, y, drops, elapsed_us);
        board_print(line);
#ifdef WITH_BLE
        radio_send(r.seq, r.tick, (uint8_t)r.request, r.state, x, y, drops, elapsed_us);
#endif
    }
}

static void thread(osThreadFunc_t fn, const char *name, osPriority_t priority, unsigned stack) {
    const osThreadAttr_t attr = {.name=name,.priority=priority,.stack_size=stack};
    if (!osThreadNew(fn, NULL, &attr)) fatal("ERROR thread creation\r\n");
}

int main(void) {
    board_init();
#ifdef WITH_BLE
    radio_init();
#endif
    osKernelInitialize();
    ready = osSemaphoreNew(1, 0, NULL);
    raw_queue = osMessageQueueNew(DEPTH, sizeof(Reading), NULL);
    estimated_queue = osMessageQueueNew(DEPTH, sizeof(Result), NULL);
    filtered_queue = osMessageQueueNew(DEPTH, sizeof(Result), NULL);
    if (!ready || !raw_queue || !estimated_queue || !filtered_queue) fatal("ERROR pipeline allocation\r\n");
    thread(acquire, "Acquire", osPriorityHigh, 2048);
    thread(estimate, "Estimate", osPriorityNormal, 3072);
    thread(filter, "Filter", osPriorityNormal, 1536);
    thread(comms, "Comms", osPriorityBelowNormal, 4096);
    osKernelStart();
    fatal("ERROR scheduler start\r\n");
}
