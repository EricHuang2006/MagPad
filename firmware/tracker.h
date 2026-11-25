#pragma once
#include <stdint.h>
#include "estimator.h"

enum TrackingState { IDLE, MEASURING, NO_FIELD, TRACKING, SENSOR_ERROR };
enum { BASELINE_N = 20 };

typedef struct {
    uint32_t request;
    unsigned count;
    Field samples[BASELINE_N], background;
    float noise_squared;
} Tracker;

typedef struct {
    uint32_t seq, tick, start, request;
    uint8_t state;
    Position xy;
} Result;

typedef struct {
    Result last;
    Position older;
    unsigned run;
} TraceFilter;

void tracker_update(Tracker *tracker, Result *result, Field field, int valid);
void filter_update(TraceFilter *filter, Result *result);
