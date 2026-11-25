#include "estimator.h"
#include <float.h>
#include <math.h>
#include <stddef.h>

typedef struct { Position xy; Field field; } Mark;
typedef struct {
    Position a, b, c;
    Field origin, ab, ac;
    float bb, bc, cc, inverse_det;
} Triangle;
typedef struct {
    Position a, b;
    Field origin, direction;
    float inverse_length_squared;
} Edge;
#include "tables.h"
#define COUNT(a) (sizeof(a)/sizeof((a)[0]))

Position estimate_knn(Field field) {
    float distances[COUNT(marks)], nearest[4] = {FLT_MAX, FLT_MAX, FLT_MAX, FLT_MAX};
    Position sum = {0}, exact = {0};
    unsigned matches = 0;
    for (size_t i = 0; i < COUNT(marks); ++i) {
        Field d = minus(field, marks[i].field);
        float value = distances[i] = dot(d,d);
        if (value == 0) {
            exact.x += marks[i].xy.x;
            exact.y += marks[i].xy.y;
            ++matches;
        }
        for (size_t j = 0; j < 4; ++j) {
            if (value < nearest[j]) {
                float displaced = nearest[j];
                nearest[j] = value;
                value = displaced;
            }
        }
    }
    if (matches) return (Position){exact.x / matches, exact.y / matches};
    float total = 0;
    for (size_t i = 0; i < COUNT(marks); ++i) {
        if (distances[i] <= nearest[3]) {
            float weight = 1.0f / sqrtf(distances[i]);
            total += weight;
            sum.x += weight * marks[i].xy.x;
            sum.y += weight * marks[i].xy.y;
        }
    }
    return (Position){sum.x / total, sum.y / total};
}

Position estimate_mesh(Field field) {
    Position best = {0};
    float best_error = FLT_MAX;
    for (size_t i = 0; i < COUNT(triangles); ++i) {
        const Triangle *t = &triangles[i];
        Field d = minus(field, t->origin);
        float along_b = dot(d, t->ab), along_c = dot(d, t->ac);
        float u = (t->cc*along_b - t->bc*along_c) * t->inverse_det;
        float v = (t->bb*along_c - t->bc*along_b) * t->inverse_det;
        if (u < 0 || v < 0 || u+v > 1) continue;
        Field residual = {d.x-u*t->ab.x-v*t->ac.x, d.y-u*t->ab.y-v*t->ac.y, d.z-u*t->ab.z-v*t->ac.z};
        float error = dot(residual, residual);
        if (error < best_error) {
            best_error = error;
            best.x = t->a.x + u*(t->b.x-t->a.x) + v*(t->c.x-t->a.x);
            best.y = t->a.y + u*(t->b.y-t->a.y) + v*(t->c.y-t->a.y);
        }
    }
    for (size_t i = 0; i < COUNT(edges); ++i) {
        const Edge *e = &edges[i];
        Field d = minus(field, e->origin);
        float t = fminf(1, fmaxf(0, dot(d, e->direction)*e->inverse_length_squared));
        Field residual = {d.x-t*e->direction.x, d.y-t*e->direction.y, d.z-t*e->direction.z};
        float error = dot(residual, residual);
        if (error < best_error) {
            best_error = error;
            best.x = e->a.x + t*(e->b.x-e->a.x);
            best.y = e->a.y + t*(e->b.y-e->a.y);
        }
    }
    return best;
}
