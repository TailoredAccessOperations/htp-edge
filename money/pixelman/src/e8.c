/*
 * e8.c — E8 root lattice core.
 *
 * Math notes
 * ----------
 * The E8 root system has 240 roots in 8 real dimensions, split into
 * 112 "integer" roots (permutations of (±1,±1,0,...,0)) and 128
 * "half-integer" roots (permutations of (±1/2,...,±1/2) with an even
 * count of minus signs). Every one of them has norm² = 2 — this is
 * what makes E8 the densest known sphere packing in 8D (kissing
 * number 240). The half-integer enumeration below iterates the 256
 * sign masks and keeps only even popcounts (1+28+70+28+1 = 128).
 *
 * Coordinates are stored as `float` (exactly representable: -1, -1/2,
 * 0, 1/2, 1) so the reported vectors and norms are mathematically
 * true — the previous version pretended ±1 were ±1/2 while printing
 * norm² = 2, which is not the same vector.
 */

#include <ctype.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "e8.h"

size_t e8_generate_roots(E8Root *roots, size_t capacity) {
    if (!roots || capacity < E8_NUM_ROOTS) return 0;

    size_t idx = 0;

    /* 112 integer roots: choose two axes i < j, one +-1 unit on each. */
    for (int i = 0; i < E8_DIM; i++) {
        for (int j = i + 1; j < E8_DIM; j++) {
            for (int si = 0; si < 2; si++) {      /* sign of axis i */
                for (int sj = 0; sj < 2; sj++) {  /* sign of axis j */
                    E8Root *r = &roots[idx];
                    float *c = r->coords;
                    for (int k = 0; k < E8_DIM; k++) c[k] = 0.0f;
                    c[i] = si ? 1.0f : -1.0f;
                    c[j] = sj ? 1.0f : -1.0f;
                    r->id      = (int)idx;
                    r->is_half = 0;
                    for (int k = 0; k < E8_DIM; k++)
                        r->hex[k] = (unsigned char)(0x80 + (int)(2.0f * c[k]));
                    idx++;
                }
            }
        }
    }

    /* 128 half-integer roots: sign mask with an even number of minus signs. */
    for (int mask = 0; mask < (1 << E8_DIM) && idx < E8_NUM_ROOTS; mask++) {
        if (__builtin_popcount((unsigned)mask) & 1) continue;  /* odd -> skip */
        E8Root *r = &roots[idx];
        for (int k = 0; k < E8_DIM; k++) {
            r->coords[k] = (mask & (1 << k)) ? -0.5f : 0.5f;
            r->hex[k]    = (unsigned char)(0x80 + (int)(2.0f * r->coords[k]));
        }
        r->id      = (int)idx;
        r->is_half = 1;
        idx++;
    }
    return idx;
}

int e8_validate(const E8Root *roots, size_t n) {
    if (!roots || n != E8_NUM_ROOTS) return -1;

    int n_int = 0, n_half = 0;
    for (size_t i = 0; i < n; i++) {
        const float *c = roots[i].coords;

        /* norm² == 2 is an exact identity for these coordinates. */
        float norm2 = 0.0f;
        for (int k = 0; k < E8_DIM; k++) norm2 += c[k] * c[k];
        if (fabsf(norm2 - 2.0f) > 1e-6f) return -1;

        /* hex round-trip must reproduce the encoded coordinates. */
        for (int k = 0; k < E8_DIM; k++) {
            int decoded = (int)roots[i].hex[k] - 0x80;
            if (fabsf(2.0f * c[k] - (float)decoded) > 1e-6f) return -1;
        }

        if (roots[i].id != (int)i) return -1;
        if (roots[i].is_half) n_half++; else n_int++;
    }
    if (n_int != 112 || n_half != 128) return -1;

    /* Cosmetic check: every id must be unique (no duplicates). */
    for (size_t i = 0; i < n; i++)
        if (roots[i].id < 0 || (size_t)roots[i].id >= n) return -1;
    return 0;
}

void e8_hex_str(const E8Root *root, char out[E8_HEX_STR_LEN]) {
    static const char *hex = "0123456789abcdef";
    for (int i = 0; i < E8_HEX_BYTES; i++) {
        out[i * 2]     = hex[root->hex[i] >> 4];
        out[i * 2 + 1] = hex[root->hex[i] & 0xF];
    }
    out[E8_HEX_STR_LEN - 1] = '\0';
}

void e8_hash_str(const E8Root *root, char out[E8_HASH_STR_LEN]) {
    /* FNV-1a over the 8 encoded bytes — a stable per-root signature. */
    unsigned long long hash = 1469598103934665603ULL;
    for (int i = 0; i < E8_HEX_BYTES; i++) {
        hash ^= root->hex[i];
        hash *= 1099511628211ULL;
    }
    static const char *hex = "0123456789abcdef";
    for (int i = 0; i < 64; i++) {
        out[i] = hex[(hash >> 60) & 0xF];
        hash <<= 4;
    }
    out[E8_HASH_STR_LEN - 1] = '\0';
}

void e8_coords_str(const E8Root *root, char *out, size_t capacity) {
    size_t used = 0;
    for (int i = 0; i < E8_DIM; i++) {
        /* %.15g keeps 0.5 / -0.5 exact and trims to 0 / 1 / -1. */
        int written = snprintf(out + used, capacity - used,
                               "%s%.15g", i ? "," : "", (double)root->coords[i]);
        if (written < 0 || (size_t)written >= capacity - used) break; /* safety */
        used += (size_t)written;
    }
    out[capacity - 1] = '\0';
}

unsigned char e8_pixel_channel(float a, float b) {
    /* Encode both coords to their hex bytes (0x80 + 2·coord), average the
     * pair, then stretch to the crisp 5-level palette: (avg − 0x7e) * 64. */
    int byte_a = (int)lroundf(128.0f + 2.0f * a);
    int byte_b = (int)lroundf(128.0f + 2.0f * b);
    int avg    = (byte_a + byte_b) / 2;
    int v      = (avg - 0x7e) * 64;
    if (v < 0)       v = 0;
    if (v > 0xFF)    v = 0xFF;
    return (unsigned char)v;
}

/*
 * Nearest root search. 240×8 is tiny, but this loop is written so the
 * compiler can auto-vectorise it: 8 independent dot-product chains,
 * no aliasing (restrict), and the inner body unrolled by hand.
 * (Optimisation list: SIMD/hardware aids, locality of reference.)
 */
size_t e8_find_nearest(const E8Root *restrict roots, size_t n,
                       const float v[restrict E8_DIM],
                       float *out_distance) {
    float best_sq = INFINITY;
    size_t best = SIZE_MAX;

    for (size_t i = 0; i < n; i++) {
        const float *restrict c = roots[i].coords;
        const float d0 = v[0] - c[0], d1 = v[1] - c[1];
        const float d2 = v[2] - c[2], d3 = v[3] - c[3];
        const float d4 = v[4] - c[4], d5 = v[5] - c[5];
        const float d6 = v[6] - c[6], d7 = v[7] - c[7];
        const float sq = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
                       + d4 * d4 + d5 * d5 + d6 * d6 + d7 * d7;
        if (sq < best_sq) {
            best_sq = sq;
            best    = i;
        }
    }

    if (best != SIZE_MAX && out_distance) *out_distance = sqrtf(best_sq);
    return best;
}