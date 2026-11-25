#include "estimator.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#ifndef HOST_VERIFY
#include "board.h"
#endif

typedef struct { Field field; Position knn, mesh; } Sample;
#include "samples.h"
enum { SAMPLE_COUNT = sizeof(samples) / sizeof(samples[0]) };

#ifndef HOST_VERIFY
static uint32_t cycles[SAMPLE_COUNT];
static int compare_cycles(const void *a, const void *b) {
    uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b;
    return (x > y) - (x < y);
}
#endif

static unsigned replay(const char *name, Position (*estimate)(Field), int mesh) {
    unsigned mismatches = 0;
    float largest = 0;
    for (unsigned i = 0; i < SAMPLE_COUNT; ++i) {
        Field field = samples[i].field;
#ifndef HOST_VERIFY
        uint32_t start = DWT->CYCCNT;
#endif
        Position result = estimate(field);
#ifndef HOST_VERIFY
        cycles[i] = DWT->CYCCNT - start;
#endif
        Position expected = mesh ? samples[i].mesh : samples[i].knn;
        float error = hypotf(result.x-expected.x, result.y-expected.y);
        if (!(error <= 0.01f)) ++mismatches;
        largest = fmaxf(error, largest);
    }
    char line[180];
    snprintf(line, sizeof line, "%s samples=%u mismatches=%u max_difference_um=%lu",
             name, SAMPLE_COUNT, mismatches, (unsigned long)ceilf(largest*1000));
#ifdef HOST_VERIFY
    puts(line);
#else
    board_print(line);
    qsort(cycles, SAMPLE_COUNT, sizeof cycles[0], compare_cycles);
    uint32_t median = (cycles[(SAMPLE_COUNT-1)/2]+cycles[SAMPLE_COUNT/2])/2;
    snprintf(line, sizeof line, " median_cycles=%lu max_cycles=%lu clock_Hz=%lu\r\n",
             (unsigned long)median, (unsigned long)cycles[SAMPLE_COUNT-1], (unsigned long)SystemCoreClock);
    board_print(line);
#endif
    return mismatches;
}

int main(void) {
#ifndef HOST_VERIFY
    board_init();
    uint32_t before = DWT->CYCCNT;
    __DSB();
    __ISB();
    if (DWT->CYCCNT == before) {
        for (;;) {
            board_print("ERROR DWT cycle counter did not start\r\n");
            HAL_Delay(3000);
        }
    }
    for (;;) {
#endif
        unsigned failures = replay("knn", estimate_knn, 0);
        failures += replay("mesh", estimate_mesh, 1);
#ifdef HOST_VERIFY
        return failures != 0;
#else
        board_print(failures ? "REPLAY FAIL\r\n" : "REPLAY PASS\r\n");
        HAL_Delay(3000);
    }
#endif
}
