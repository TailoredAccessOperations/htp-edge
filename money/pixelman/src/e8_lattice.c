/*
 * e8_lattice.c — E8 lattice CLI.
 *
 * A thin command-line front end over the shared core (e8.h/e8.c).
 * The old `--server` mode was a stub that printed "not implemented";
 * the real HTTP server is the separate e8_http_server binary, so the
 * stub was dropped rather than kept around as dead code.
 *
 * Usage:
 *   e8_lattice --list                          print all 240 roots
 *   e8_lattice --cmatrix <id> [width height]   ASCII lattice frame
 *   e8_lattice --pixel <id> [--out <path>]     400x400 PPM image
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "e8.h"

static E8Root g_roots[E8_NUM_ROOTS];

static int parse_root_id(const char *text, size_t *out) {
    char *end = NULL;
    long v = strtol(text, &end, 10);          /* strtol: validated parsing */
    if (!end || *end != '\0' || v < 0 || v >= E8_NUM_ROOTS) {
        fprintf(stderr, "root id must be an integer in 0..%d (got \"%s\")\n",
                E8_NUM_ROOTS - 1, text);
        return -1;
    }
    *out = (size_t)v;
    return 0;
}

static void print_all_roots(void) {
    char hex[E8_HEX_STR_LEN];
    int n_int = 0, n_half = 0;
    printf("=== E8 Root System (%d roots) in Hexadecimal ===\n\n", E8_NUM_ROOTS);
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        if (g_roots[i].is_half) n_half++; else n_int++;
        e8_hex_str(&g_roots[i], hex);
        printf("Root %3d: [%s]  type: %-12s  coords:", g_roots[i].id, hex,
               g_roots[i].is_half ? "half-integer" : "integer");
        for (int k = 0; k < E8_DIM; k++)
            printf(" %g", (double)g_roots[i].coords[k]);
        putchar('\n');
    }
    printf("\nTotal roots: %d (%d integer, %d half-integer)\n",
           E8_NUM_ROOTS, n_int, n_half);
}

static void print_cmatrix(size_t id, int width, int height) {
    /* Same 8D->2D projection as the HTTP server's /api/cmatrix (verified
     * byte-for-byte by the oracle): every root lands on frame, the
     * highlighted root is '@', the others are '.'. */
    char *frame = malloc((size_t)width * (size_t)height + 1);
    if (!frame) { perror("malloc"); exit(1); }
    memset(frame, ' ', (size_t)width * (size_t)height);

    const int cx = width / 2, cy = height / 2;
    const float *hc = g_roots[id].coords;

    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        const float *c = g_roots[i].coords;
        const int x = cx + (int)lroundf(c[0] * 5.0f +
                                        c[1] * 3.0f + c[2] * 2.0f);
        const int y = cy + (int)lroundf(c[3] * 3.0f +
                                        c[4] * 2.0f + c[5] * 1.0f);
        if (x >= 1 && x < width - 1 && y >= 1 && y < height - 1)
            frame[y * width + x] = '.';
    }
    /* Paint the highlight last so no later root can overwrite the '@'. */
    {
        const int x = cx + (int)lroundf(hc[0] * 5.0f +
                                        hc[1] * 3.0f + hc[2] * 2.0f);
        const int y = cy + (int)lroundf(hc[3] * 3.0f +
                                        hc[4] * 2.0f + hc[5] * 1.0f);
        if (x >= 1 && x < width - 1 && y >= 1 && y < height - 1)
            frame[y * width + x] = '@';
    }

    char info[256];
    char hex[E8_HEX_STR_LEN];
    e8_hex_str(&g_roots[id], hex);
    snprintf(info, sizeof(info), "E8 Root %zu | Hex: %s | Coords:", id, hex);
    size_t infolen = strlen(info);
    for (int k = 0; k < E8_DIM; k++)
        infolen += (size_t)snprintf(info + infolen, sizeof(info) - infolen,
                                    " %g", (double)hc[k]);
    infolen = infolen < sizeof(info) ? infolen : sizeof(info) - 1;
    if ((size_t)width < infolen) infolen = (size_t)width;
    memcpy(frame, info, infolen);

    for (int y = 0; y < height; y++) {
        fwrite(frame + (size_t)y * width, 1, (size_t)width, stdout);
        putchar('\n');
    }
    free(frame);
}

static int write_ppm(const char *path, const unsigned char *pixels,
                     int width, int height) {
    FILE *f = fopen(path, "wb");
    if (!f) { perror(path); return -1; }
    fprintf(f, "P6\n%d %d\n255\n", width, height);
    int ok = fwrite(pixels, 1, (size_t)width * height * 3, f) ==
             (size_t)width * height * 3;
    return (fclose(f) == 0 && ok) ? 0 : -1;
}

static int gen_pixel(size_t id, const char *out_path) {
    enum { W = 400, H = 400, SCALE = 20 };

    unsigned char *pixels = calloc((size_t)W * H, 3);
    if (!pixels) { perror("calloc"); return 1; }

    const int cx = W / 2, cy = H / 2;
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        const float *c = g_roots[i].coords;
        const int x = cx + (int)lroundf(c[0] * SCALE + c[2] * (SCALE / 2));
        const int y = cy + (int)lroundf(c[1] * SCALE + c[3] * (SCALE / 2));

        int r = e8_pixel_channel(c[0], c[1]);   /* pixel fold, README rule     */
        int g = e8_pixel_channel(c[2], c[3]);
        int b = e8_pixel_channel(c[4], c[5]);

        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                const int px = x + dx, py = y + dy;
                if (px < 0 || px >= W || py < 0 || py >= H) continue;
                unsigned char *p = pixels + ((size_t)py * W + px) * 3;
                p[0] = (unsigned char)r;
                p[1] = (unsigned char)g;
                p[2] = (unsigned char)b;
            }
        }
    }
    /* Paint the highlight last so it always reads as White (README). */
    {
        const float *c = g_roots[id].coords;
        const int x = cx + (int)lroundf(c[0] * SCALE + c[2] * (SCALE / 2));
        const int y = cy + (int)lroundf(c[1] * SCALE + c[3] * (SCALE / 2));
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                const int px = x + dx, py = y + dy;
                if (px < 0 || px >= W || py < 0 || py >= H) continue;
                unsigned char *p = pixels + ((size_t)py * W + px) * 3;
                p[0] = 255; p[1] = 255; p[2] = 255;
            }
        }
    }

    int rc = write_ppm(out_path, pixels, W, H);
    free(pixels);
    if (rc == 0)
        printf("Generated %s for root %zu (%d x %d PPM)\n", out_path, id, W, H);
    return rc;
}

int main(int argc, char **argv) {
    if (e8_generate_roots(g_roots, E8_NUM_ROOTS) != E8_NUM_ROOTS) {
        fprintf(stderr, "failed to generate roots\n");
        return 1;
    }
    if (e8_validate(g_roots, E8_NUM_ROOTS) != 0) {
        fprintf(stderr, "internal error: generated roots failed validation\n");
        return 1;
    }

    if (argc < 2) {
        printf("E8 Lattice Generator\n"
               "Usage: %s [--list | --cmatrix <id> | --pixel <id> [--out <path>]]\n",
               argv[0]);
        return 0;
    }

    size_t id = 0;
    if (strcmp(argv[1], "--list") == 0) {
        print_all_roots();
    } else if (strcmp(argv[1], "--cmatrix") == 0) {
        if (argc < 3 || parse_root_id(argv[2], &id)) return 2;
        print_cmatrix(id, 80, 24);
    } else if (strcmp(argv[1], "--pixel") == 0) {
        if (argc < 3 || parse_root_id(argv[2], &id)) return 2;
        const char *out = (argc >= 5 && strcmp(argv[3], "--out") == 0)
                        ? argv[4] : "web/e8_lattice.ppm";
        if (gen_pixel(id, out)) return 1;
    } else {
        fprintf(stderr, "unknown option: %s\n", argv[1]);
        return 2;
    }
    return 0;
}