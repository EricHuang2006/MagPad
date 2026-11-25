#pragma once
#include <stdint.h>

void radio_init(void);
uint8_t radio_poll(void);
void radio_send(uint32_t seq, uint32_t tick, uint8_t token, uint8_t state,
                int16_t x, int16_t y, uint32_t dropped, uint32_t elapsed_us);
