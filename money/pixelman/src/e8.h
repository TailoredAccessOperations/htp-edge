/*
 * e8.h — shared core for the E8 lattice tooling.
 *
 * This is the single source of truth for E8 math. Both the CLI
 * (e8_lattice.c) and the HTTP server (e8_http_server.c) build on it,
 * so the 240-root generation, hex encoding, hashing and nearest-neighbour
 * search exist in exactly one place instead of being copy-pasted.
 *
 * Encoding scheme (uniform across integer and half-integer roots):
 *   byte = 0x80 + 2 * coord     →  -1:0x7e  -1/2:0x7f  0:0x80  +1/2:0x81  +1:0x82
 */

#ifndef E8_H
#define E8_H

#include <stddef.h>

#define E8_DIM          8
#define E8_NUM_ROOTS    240       /* 112 integer + 128 half-integer */
#define E8_HEX_BYTES    8         /* one encoded byte per coordinate  */
#define E8_HEX_STR_LEN  17        /* 16 hex digits + NUL              */
#define E8_HASH_STR_LEN 65        /* 64 hex digits + NUL              */
#define E8_COORDS_STR_LEN 160     /* "1,-0.5,0,..." is well under this */

typedef struct {
    float coords[E8_DIM];         /* true coords: -1 -0.5 0 0.5 1        */
    unsigned char hex[E8_HEX_BYTES]; /* uniform byte encoding 0x7e..0x82 */
    int id;                       /* stable index 0..239                 */
    int is_half;                  /* 1 = half-integer, 0 = integer root  */
} E8Root;
/* sizeof(E8Root) == 48 — 8-byte aligned, fits two cache lines per 4 roots */

/* Generate all 240 roots in the reference order: 112 integer roots
 * (permutations of ±1,±1,0,...,0) then 128 half-integer roots
 * (permutations of ±1/2,...,±1/2 with an even number of minus signs). */
size_t  e8_generate_roots(E8Root *roots, size_t capacity);

/* Self-check: every root must satisfy norm² == 2, counts must be
 * 112/128, ids unique, and the hex bytes must round-trip through the
 * uniform scheme. Returns 0 on success, -1 on the first failure. */
int     e8_validate(const E8Root *roots, size_t n);

/* 16-hex-digit signature (the uniform scheme, see header comment). */
void    e8_hex_str(const E8Root *root, char out[E8_HEX_STR_LEN]);

/* 64-hex-digit FNV-1a digest over the 8 encoded bytes. */
void    e8_hash_str(const E8Root *root, char out[E8_HASH_STR_LEN]);

/* Comma-separated decimal coordinates, e.g. "1,-0.5,0,0,0,0,0,0". */
void    e8_coords_str(const E8Root *root, char *out, size_t capacity);

/* Index + Euclidean distance of the root closest to v (brute force over
 * the 240 roots with a vectorizable inner loop). Returns the index on
 * success, SIZE_MAX if n == 0. */
size_t  e8_find_nearest(const E8Root *roots, size_t n,
                        const float v[E8_DIM],
                        float *out_distance);

/* Pixel fold (README: Byte 0–1 -> R, 2–3 -> G, 4–5 -> B, stretched to
 * the crisp set 00 40 80 C0 FF). Takes two coords, returns one channel.
 * Shared by the HTTP server and the CLI so the site-wide colour rule
 * lives in exactly one place. */
unsigned char e8_pixel_channel(float a, float b);

#endif /* E8_H */