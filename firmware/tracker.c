#include "tracker.h"
#include <math.h>

void tracker_update(Tracker *t, Result *r, Field sample, int valid) {
    if (t->request != r->request) {
        *t = (Tracker){.request=r->request};
    }
    r->state = IDLE;
    if (!valid) {
        r->state = SENSOR_ERROR;
        return;
    }
    if (!r->request) return;
    if (t->count < BASELINE_N) {
        t->samples[t->count++] = sample;
        t->background.x += sample.x;
        t->background.y += sample.y;
        t->background.z += sample.z;
        r->state = MEASURING;
        if (t->count < BASELINE_N) return;
        t->background.x /= BASELINE_N;
        t->background.y /= BASELINE_N;
        t->background.z /= BASELINE_N;
        for (unsigned i = 0; i < BASELINE_N; ++i) {
            Field d = minus(t->samples[i], t->background);
            t->noise_squared = fmaxf(t->noise_squared, dot(d, d));
        }
        r->state = NO_FIELD;
        return;
    }
    Field field = minus(sample, t->background);
    r->state = NO_FIELD;
    if (dot(field, field) > t->noise_squared) {
        r->state = TRACKING;
#ifdef LIVE_KNN
        r->xy = estimate_knn(field);
#else
        r->xy = estimate_mesh(field);
#endif
    }
}

static float median3(float a, float b, float c) {
    return fmaxf(fminf(a,b), fminf(fmaxf(a,b),c));
}

void filter_update(TraceFilter *f, Result *r) {
    if (r->state != TRACKING || r->request != f->last.request || r->seq != f->last.seq+1)
        f->run = 0;
    Result current = *r;
    if (r->state == TRACKING) {
        if (f->run >= 2) {
            r->xy.x = median3(f->older.x, f->last.xy.x, current.xy.x);
            r->xy.y = median3(f->older.y, f->last.xy.y, current.xy.y);
        }
        if (f->run < 2) ++f->run;
    }
    f->older = f->last.xy;
    f->last = current;
}
