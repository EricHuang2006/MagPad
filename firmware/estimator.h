#pragma once

typedef struct { float x, y, z; } Field;
typedef struct { float x, y; } Position;

static inline Field minus(Field a, Field b) {
    return (Field){a.x-b.x, a.y-b.y, a.z-b.z};
}

static inline float dot(Field a, Field b) {
    return a.x*b.x + a.y*b.y + a.z*b.z;
}

Position estimate_knn(Field field);
Position estimate_mesh(Field field);
