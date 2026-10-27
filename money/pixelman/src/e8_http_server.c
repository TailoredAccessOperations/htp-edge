/*
 * e8_http_server.c — E8 lattice HTTP server.
 *
 * A small, fast JSON/visualisation server for the 240 E8 roots.
 * Runs behind nginx (which load-balances across 4 instances on ports
 * 8081-8084) and answers: /health, /api/roots, /api/roots/:id,
 * /api/nearest, /api/log, /api/cmatrix/:id, /api/pixel/:id,
 * /api/overlap, /api/stats.
 *
 * Design (ties to the optimisation list supplied with this task)
 * ------------------------------------------------------------------
 *  - Fixed worker pool (no thread-per-request): several threads call
 *    accept() on one listening socket; the kernel hands each open
 *    connection to the next free worker. Bounded, zero per-request
 *    allocation of threads, lightweight context switches.
 *  - HTTP/1.1 keep-alive loop per connection so nginx's pooled
 *    upstream connections are reused instead of torn down each request.
 *  - Static responses (root list, overlap table, per-root details) are
 *    rendered ONCE at startup and served from memory — no repeated
 *    formatting under traffic.
 *  - Single writev() per response (header + body in one syscall).
 *  - "Locality of reference": roots live in one compact 48-byte
 *    struct each; the coords array is contiguous so the nearest-root
 *    inner loop stays in a few cache lines.
 *  - MSG_NOSIGNAL / SIGPIPE ignored so a client disconnecting mid
 *    response can never kill the server.
 *  - Graceful shutdown on SIGINT/SIGTERM (close listener, join workers).
 */

#include <arpa/inet.h>
#include <errno.h>
#include <inttypes.h>
#include <math.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

#include "e8.h"

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

#define REQ_BUF          8192    /* large enough for any request head   */
#define MAX_LOG          10000   /* ring cap − matches the original API */
#define LISTEN_BACKLOG   SOMAXCONN
#define MAX_WORKERS      64
#define MIN_WORKERS      4
#define KEEPALIVE_MS     2000    /* idle keep-alive timeout             */
#define FIRST_READ_MS    30000   /* client must send its first byte     */
#define MAX_REQS_PER_CONN 1000   /* guard against request-loop abuse    */

static E8Root g_roots[E8_NUM_ROOTS];          /* generated once         */
static int    g_n_int, g_n_half;              /* precomputed counts     */

/* Build once, serve many — the hot JSON bodies. */
static char  *g_roots_body    = NULL;
static size_t g_roots_len     = 0;
static char  *g_overlap_body  = NULL;
static size_t g_overlap_len   = 0;
static char  *g_detail[E8_NUM_ROOTS];
static size_t g_detail_len[E8_NUM_ROOTS];

static const char *JSON_400  = "{\"error\":\"Bad Request\"}";
static const char *JSON_404  = "{\"error\":\"Not found\"}";
static const char *JSON_413  = "{\"error\":\"Request too large\"}";
static const char *JSON_500  = "{\"error\":\"Internal error\"}";
static const char *HEALTH    = "{\"status\":\"ok\",\"service\":\"e8-lattice\","
                               "\"roots\":240,\"dimension\":8}";

/* Request log (thread-safe). */
typedef struct {
    char ts[32];
    char ip[64];
    char endpoint[40];
    int  root_id;
} LogEntry;
static LogEntry            g_log[MAX_LOG];
static size_t              g_log_n = 0;
static pthread_mutex_t     g_log_mu = PTHREAD_MUTEX_INITIALIZER;

static volatile sig_atomic_t g_stop = 0;
static int                   g_listener_fd = -1;

/* ------------------------------------------------------------------ */
/* Growable JSON builder (power-of-two capacity growth)               */
/* ------------------------------------------------------------------ */

typedef struct { char *s; size_t len, cap; } Jb;

static void jb_reset(Jb *b) { b->s = NULL; b->len = 0; b->cap = 0; }

static int jb_reserve(Jb *b, size_t extra) {
    size_t need = b->len + extra + 1;
    if (need <= b->cap && b->s) return 0;
    size_t ncap = b->cap ? b->cap : 256;
    while (ncap < need) ncap <<= 1;
    char *ns = realloc(b->s, ncap);
    if (!ns) return -1;
    b->s = ns;
    b->cap = ncap;
    return 0;
}

static void jb_printf(Jb *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    va_list ap2;
    va_copy(ap2, ap);
    int need = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (need < 0 || jb_reserve(b, (size_t)need)) { va_end(ap2); return; }
    vsnprintf(b->s + b->len, b->cap - b->len, fmt, ap2);
    b->len += (size_t)need;
    va_end(ap2);
}

/* ------------------------------------------------------------------ */
/* Startup: build the static bodies once                              */
/* ------------------------------------------------------------------ */

static void build_static_bodies(void) {
    Jb jb = {0};

    /* /api/roots */
    jb_printf(&jb, "{\"roots\":[");
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        char hex[E8_HEX_STR_LEN], coords[E8_COORDS_STR_LEN];
        e8_hex_str(&g_roots[i], hex);
        e8_coords_str(&g_roots[i], coords, sizeof(coords));
        if (i) jb_printf(&jb, ",");
        jb_printf(&jb, "{\"id\":%d,\"type\":\"%s\",\"hex\":\"%s\",\"coords\":[%s]}",
                  g_roots[i].id,
                  g_roots[i].is_half ? "half-integer" : "integer",
                  hex, coords);
    }
    jb_printf(&jb, "],\"total\":%d}", E8_NUM_ROOTS);
    g_roots_body = jb.s;
    g_roots_len  = jb.len;
    jb_reset(&jb);

    /* /api/overlap — every nonzero root–root dot product. */
    jb_printf(&jb, "{\"overlaps\":[");
    int emitted = 0;
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        for (size_t j = i + 1; j < E8_NUM_ROOTS; j++) {
            const float *a = g_roots[i].coords, *b = g_roots[j].coords;
            float dot = 0.0f;
            for (int k = 0; k < E8_DIM; k++) dot += a[k] * b[k];
            if (dot == 0.0f) continue;   /* skip the silent majority */
            if (emitted++) jb_printf(&jb, ",");
            jb_printf(&jb, "{\"root1\":%zu,\"root2\":%zu,\"dot\":%.2f}",
                      i, j, (double)dot);
        }
    }
    jb_printf(&jb, "],\"total\":%d}", emitted);
    g_overlap_body = jb.s;
    g_overlap_len  = jb.len;
    jb_reset(&jb);

    /* /api/roots/:id — one tiny pre-rendered JSON per root. */
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        char hex[E8_HEX_STR_LEN], hash[E8_HASH_STR_LEN], coords[E8_COORDS_STR_LEN];
        e8_hex_str(&g_roots[i], hex);
        e8_hash_str(&g_roots[i], hash);
        e8_coords_str(&g_roots[i], coords, sizeof(coords));
        jb_printf(&jb, "{\"id\":%d,\"hex\":\"%s\",\"hash\":\"%s\","
                       "\"coords\":[%s],\"norm2\":2.0}",
                  g_roots[i].id, hex, hash, coords);
        g_detail[i]     = jb.s;
        g_detail_len[i] = jb.len;
        jb_reset(&jb);
    }
}

static void free_static_bodies(void) {
    free(g_roots_body);
    free(g_overlap_body);
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) free(g_detail[i]);
}

/* ------------------------------------------------------------------ */
/* Network helpers                                                    */
/* ------------------------------------------------------------------ */

static int writev_all(int fd, struct iovec *iov, int n) {
    size_t left = 0;
    for (int i = 0; i < n; i++) left += iov[i].iov_len;
    while (left) {
        ssize_t w = writev(fd, iov, n);
        if (w <= 0) return -1;
        left -= (size_t)w;
        while (n && (size_t)w >= iov[0].iov_len) {  /* skip consumed iovs */
            w -= (int)iov[0].iov_len;
            iov++;
            n--;
        }
        if (n && w > 0) {
            iov[0].iov_base = (char *)iov[0].iov_base + w;
            iov[0].iov_len -= (size_t)w;
        }
    }
    return 0;
}

static const char *reason_phrase(int status) {
    switch (status) {
        case 200: return "OK";
        case 400: return "Bad Request";
        case 404: return "Not Found";
        case 408: return "Request Timeout";
        case 413: return "Payload Too Large";
        case 500: return "Internal Server Error";
        default:  return "Status";
    }
}

static int respond(int fd, int status, const char *ctype,
                   const char *body, size_t len, int keep_alive) {
    char hdr[512];
    int hn = snprintf(hdr, sizeof(hdr),
                      "HTTP/1.1 %d %s\r\n"
                      "Content-Type: %s\r\n"
                      "Content-Length: %zu\r\n"
                      "Access-Control-Allow-Origin: *\r\n"
                      "Connection: %s\r\n"
                      "\r\n",
                      status, reason_phrase(status), ctype, len,
                      keep_alive ? "keep-alive" : "close");
    if (hn < 0 || (size_t)hn >= sizeof(hdr)) return -1;
    struct iovec iov[2] = {
        { hdr, (size_t)hn },
        { (void *)body, len }
    };
    return writev_all(fd, iov, body && len ? 2 : 1);
}

/* ------------------------------------------------------------------ */
/* Request reading / parsing                                          */
/* ------------------------------------------------------------------ */

/*
 * Read one request head into buf[0..cap). `start` is the number of
 * already-buffered bytes left over from a previous pipelined request.
 * On success returns the total number of buffered bytes and stores the
 * length of the current head (terminator included) in *head_len — the
 * head always begins at buf[0], and any pipelined follow-up bytes sit
 * at buf[head_len..total). Returns 0 on a clean idle timeout, -1 on
 * connection close/error and -2 if the request exceeds the buffer.
 * `first` widens the idle poll for the very first byte of a connection.
 */
static ssize_t read_request(int fd, char *buf, size_t cap, size_t start,
                            size_t *head_len, int first) {
    size_t used = start;
    for (;;) {
        buf[used] = '\0';
        char *end = strstr(buf, "\r\n\r\n");
        size_t tlen = 4;                  /* CRLF terminator = 4 bytes     */
        if (!end) {
            end = strstr(buf, "\n\n");
            tlen = 2;                     /* bare-LF terminator = 2 bytes  */
        }
        if (end) {                        /* complete head already buffered */
            *head_len = (size_t)(end - buf) + tlen;
            return (ssize_t)used;
        }
        if (used >= cap - 1) return used ? -2 : -1;
        int timeout = (first && used == 0) ? FIRST_READ_MS : KEEPALIVE_MS;
        struct pollfd p = { .fd = fd, .events = POLLIN };
        int pr = poll(&p, 1, timeout);
        if (pr <= 0 || !(p.revents & POLLIN))
            return used ? (ssize_t)used : (pr == 0 ? 0 : -1);
        ssize_t n = recv(fd, buf + used, cap - 1 - used, 0);
        if (n <= 0) return used ? (ssize_t)used : -1;
        used += (size_t)n;
    }
}

static int should_keep_alive(const char *head, const char *protocol) {
    int is_11   = strstr(protocol, "HTTP/1.1") != NULL;
    int wants_close = strstr(head, "Connection: close")    != NULL ||
                      strstr(head, "Connection: Close")    != NULL;
    int wants_keep  = strstr(head, "Connection: keep-alive") != NULL ||
                      strstr(head, "Connection: Keep-Alive") != NULL;
    return is_11 ? !wants_close : wants_keep;
}

/* Strict `:id` parser: a full, canonical decimal number with no sign,
 * no whitespace, no trailing garbage and no leading zeros shortcutting.
 * Mirrors the CLI's validation so `/api/roots/42garbage` is a 404, not a
 * guess at root 42. */
static int parse_id(const char *s, size_t *out) {
    if (*s < '0' || *s > '9') return -1;          /* empty, sign, junk     */
    char *end = NULL;
    errno = 0;
    uintmax_t v = strtoumax(s, &end, 10);
    if (end == s || *end != '\0' || v > E8_NUM_ROOTS) return -1;
    *out = (size_t)v;
    return 0;
}

/* Client IP from the X-Forwarded-For header nginx adds on our behalf. */
static void client_ip(const char *head, char *out, size_t cap) {
    const char *xff = strstr(head, "X-Forwarded-For:");
    if (xff) {
        xff += strlen("X-Forwarded-For:");
        while (*xff == ' ') xff++;
        size_t i = 0;
        while (xff[i] && xff[i] != ',' && xff[i] != '\r' && xff[i] != '\n'
               && i < cap - 1)
            out[i] = xff[i], i++;
        if (i) {
            out[i] = '\0';
            return;
        }
    }
    snprintf(out, cap, "unknown");
}

/* ------------------------------------------------------------------ */
/* Request logging (reentrant)                                        */
/* ------------------------------------------------------------------ */

static void log_request(const char *ip, const char *endpoint, size_t root_id) {
    pthread_mutex_lock(&g_log_mu);
    if (g_log_n < MAX_LOG) {
        LogEntry *e = &g_log[g_log_n++];
        time_t now = time(NULL);
        struct tm tmv;
        localtime_r(&now, &tmv);                  /* reentrant variant   */
        strftime(e->ts, sizeof(e->ts), "%Y-%m-%d %H:%M:%S", &tmv);
        snprintf(e->ip, sizeof(e->ip), "%s", ip);
        snprintf(e->endpoint, sizeof(e->endpoint), "%s", endpoint);
        e->root_id = (int)root_id;
    }
    pthread_mutex_unlock(&g_log_mu);
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

static void h_roots(int fd, const char *ip, int keep) {
    log_request(ip, "/api/roots", 0);
    respond(fd, 200, "application/json", g_roots_body, g_roots_len, keep);
}

static void h_detail(int fd, const char *ip, size_t id, int keep) {
    if (id >= E8_NUM_ROOTS) { respond(fd, 404, "application/json", JSON_404,
                                      strlen(JSON_404), keep); return; }
    log_request(ip, "/api/roots/:id", id);
    respond(fd, 200, "application/json", g_detail[id], g_detail_len[id], keep);
}

static void h_nearest(int fd, const char *path, const char *ip, int keep) {
    float v[E8_DIM] = {0};
    const char *p = strstr(path, "v=");
    if (!p) { respond(fd, 400, "application/json", JSON_400, strlen(JSON_400),
                      keep); return; }
    p += 2;
    size_t got = 0;
    while (got < E8_DIM) {
        char *end = NULL;
        v[got] = strtof(p, &end);
        if (end == p) break;                      /* no digits — stop    */
        got++;
        if (*end == ',') p = end + 1; else break;
    }
    if (!got) { respond(fd, 400, "application/json", JSON_400,
                        strlen(JSON_400), keep); return; }
    for (size_t k = 0; k < got; k++) {
        if (!isfinite(v[k])) {            /* NaN/Inf would poison the      */
            respond(fd, 400, "application/json", JSON_400, /* nearest search */
                    strlen(JSON_400), keep);
            return;
        }
    }

    float dist = 0.0f;
    size_t nearest = e8_find_nearest(g_roots, E8_NUM_ROOTS, v, &dist);
    log_request(ip, "/api/nearest", nearest);

    char hex[E8_HEX_STR_LEN], hash[E8_HASH_STR_LEN];
    e8_hex_str(&g_roots[nearest], hex);
    e8_hash_str(&g_roots[nearest], hash);

    char json[512];                               /* one small snprintf  */
    snprintf(json, sizeof(json),
             "{\"nearest_id\":%zu,\"hex\":\"%s\",\"hash\":\"%s\","
             "\"distance\":%.6f}",
             nearest, hex, hash, (double)dist);
    respond(fd, 200, "application/json", json, strlen(json), keep);
}

static void h_log(int fd, int keep) {
    pthread_mutex_lock(&g_log_mu);
    Jb jb = {0};
    jb_printf(&jb, "{\"requests\":[");
    for (size_t i = 0; i < g_log_n; i++) {
        const LogEntry *e = &g_log[i];
        if (i) jb_printf(&jb, ",");
        jb_printf(&jb, "{\"ip\":\"%s\",\"timestamp\":\"%s\",\"root_id\":%d,"
                        "\"endpoint\":\"%s\"}",
                  e->ip, e->ts, e->root_id, e->endpoint);
    }
    jb_printf(&jb, "],\"total\":%zu}", g_log_n);
    pthread_mutex_unlock(&g_log_mu);

    respond(fd, 200, "application/json", jb.s, jb.len, keep);
    free(jb.s);
}

static void h_cmatrix(int fd, const char *ip, size_t id, int keep) {
    if (id >= E8_NUM_ROOTS) { respond(fd, 404, "application/json", JSON_404,
                                      strlen(JSON_404), keep); return; }
    log_request(ip, "/api/cmatrix/:id", id);

    enum { W = 80, H = 24, WN = W + 1 };      /* +1 '\n' per row      */
    char frame[(size_t)WN * H];
    memset(frame, ' ', sizeof(frame));
    for (int y = 0; y < H; y++) frame[(size_t)y * WN + W] = '\n';

    const int cx = W / 2, cy = H / 2;
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        const float *c = g_roots[i].coords;
        const int x = cx + (int)lroundf(c[0] * 5.0f +
                                        c[1] * 3.0f + c[2] * 2.0f);
        const int y = cy + (int)lroundf(c[3] * 3.0f +
                                        c[4] * 2.0f + c[5] * 1.0f);
        if (x >= 1 && x < W - 1 && y >= 1 && y < H - 1)
            frame[(size_t)y * WN + x] = '.';
    }

    /* Paint the highlight last so no later root can overwrite the '@'. */
    {
        const float *c = g_roots[id].coords;
        const int x = cx + (int)lroundf(c[0] * 5.0f +
                                        c[1] * 3.0f + c[2] * 2.0f);
        const int y = cy + (int)lroundf(c[3] * 3.0f +
                                        c[4] * 2.0f + c[5] * 1.0f);
        if (x >= 1 && x < W - 1 && y >= 1 && y < H - 1)
            frame[(size_t)y * WN + x] = '@';
    }

    /* Header overlays row 0; clamped to the row width so the row's '\n'
     * is never clobbered and no NUL ever lands inside the frame. */
    char hex[E8_HEX_STR_LEN];
    e8_hex_str(&g_roots[id], hex);
    char head[256];
    int hn = snprintf(head, sizeof(head), "E8 Root %zu | Hex: %s | Coords:",
                      id, hex);
    for (int k = 0; k < E8_DIM && hn > 0 && (size_t)hn < sizeof(head); k++)
        hn += snprintf(head + hn, sizeof(head) - (size_t)hn, " %g",
                       (double)g_roots[id].coords[k]);

    if (hn > 0) {
        size_t hlen = (size_t)hn;
        if (hlen > W) hlen = W;
        memcpy(frame, head, hlen);
    }

    respond(fd, 200, "text/plain", frame, sizeof(frame), keep);
}

static void h_pixel(int fd, const char *ip, size_t id, int keep) {
    if (id >= E8_NUM_ROOTS) { respond(fd, 404, "application/json", JSON_404,
                                      strlen(JSON_404), keep); return; }
    log_request(ip, "/api/pixel/:id", id);

    enum { PW = 400, PH = 400, SCALE = 20 };
    char head[32];
    int  hn = snprintf(head, sizeof(head), "P6\n%d %d\n255\n", PW, PH);
    size_t body_len = (size_t)hn + (size_t)PW * PH * 3;

    char *body = malloc(body_len);
    if (!body) { respond(fd, 500, "application/json", JSON_500,
                         strlen(JSON_500), keep); return; }
    memcpy(body, head, (size_t)hn);
    unsigned char *px = (unsigned char *)body + hn;
    memset(px, 0, (size_t)PW * PH * 3);

    const int cx = PW / 2, cy = PH / 2;
    for (size_t i = 0; i < E8_NUM_ROOTS; i++) {
        const float *c = g_roots[i].coords;
        const int x = cx + (int)lroundf(c[0] * SCALE + c[2] * (SCALE / 2));
        const int y = cy + (int)lroundf(c[1] * SCALE + c[3] * (SCALE / 2));
        /* Pixel fold: byte pair 0-1 -> R, 2-3 -> G, 4-5 -> B (README rule). */
        int r = e8_pixel_channel(c[0], c[1]);
        int g = e8_pixel_channel(c[2], c[3]);
        int b = e8_pixel_channel(c[4], c[5]);
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                const int px2 = x + dx, py = y + dy;
                if (px2 < 0 || px2 >= PW || py < 0 || py >= PH) continue;
                unsigned char *p = px + ((size_t)py * PW + (size_t)px2) * 3;
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
                const int px2 = x + dx, py = y + dy;
                if (px2 < 0 || px2 >= PW || py < 0 || py >= PH) continue;
                unsigned char *p = px + ((size_t)py * PW + (size_t)px2) * 3;
                p[0] = 255; p[1] = 255; p[2] = 255;
            }
        }
    }

    respond(fd, 200, "image/x-portable-pixmap", body, body_len, keep);
    free(body);
}

static void h_overlap(int fd, const char *ip, int keep) {
    log_request(ip, "/api/overlap", 0);
    respond(fd, 200, "application/json", g_overlap_body, g_overlap_len, keep);
}

static void h_stats(int fd, const char *ip, int keep) {
    log_request(ip, "/api/stats", 0);
    pthread_mutex_lock(&g_log_mu);
    size_t requests = g_log_n;
    pthread_mutex_unlock(&g_log_mu);

    char json[256];
    snprintf(json, sizeof(json),
             "{\"total_roots\":%d,\"integer_roots\":%d,"
             "\"half_integer_roots\":%d,\"total_requests\":%zu,"
             "\"dimension\":%d,\"kissing_number\":240}",
             E8_NUM_ROOTS, g_n_int, g_n_half, requests, E8_DIM);
    respond(fd, 200, "application/json", json, strlen(json), keep);
}

static void h_health(int fd, int keep) {
    respond(fd, 200, "application/json", HEALTH, strlen(HEALTH), keep);
}

/* ------------------------------------------------------------------ */
/* Routing                                                            */
/* ------------------------------------------------------------------ */

static void route(int fd, char *path, const char *head, int keep) {
    char ip[64];
    client_ip(head, ip, sizeof(ip));

    if (strcmp(path, "/api/roots") == 0) {
        h_roots(fd, ip, keep);
    } else if (strncmp(path, "/api/roots/", 11) == 0) {
        size_t id;
        if (parse_id(path + 11, &id) == 0)
            h_detail(fd, ip, id, keep);
        else
            respond(fd, 404, "application/json", JSON_404, strlen(JSON_404), keep);
    } else if (strncmp(path, "/api/nearest", 12) == 0) {
        h_nearest(fd, path, ip, keep);
    } else if (strcmp(path, "/api/log") == 0) {
        h_log(fd, keep);
    } else if (strncmp(path, "/api/cmatrix/", 13) == 0) {
        size_t id;
        if (parse_id(path + 13, &id) == 0)
            h_cmatrix(fd, ip, id, keep);
        else
            respond(fd, 404, "application/json", JSON_404, strlen(JSON_404), keep);
    } else if (strncmp(path, "/api/pixel/", 11) == 0) {
        size_t id;
        if (parse_id(path + 11, &id) == 0)
            h_pixel(fd, ip, id, keep);
        else
            respond(fd, 404, "application/json", JSON_404, strlen(JSON_404), keep);
    } else if (strcmp(path, "/api/overlap") == 0) {
        h_overlap(fd, ip, keep);
    } else if (strcmp(path, "/api/stats") == 0) {
        h_stats(fd, ip, keep);
    } else if (strcmp(path, "/health") == 0) {
        h_health(fd, keep);
    } else {
        respond(fd, 404, "application/json", JSON_404, strlen(JSON_404), keep);
    }
}

/* ------------------------------------------------------------------ */
/* Connection loop (per client connection)                            */
/* ------------------------------------------------------------------ */

static void handle_connection(int fd) {
    char buf[REQ_BUF];
    size_t pending = 0;        /* pipelined bytes left over from last read */
    size_t served = 0;

    for (;;) {
        if (g_stop) return;
        size_t head_len = 0;
        ssize_t n = read_request(fd, buf, sizeof(buf), pending, &head_len,
                                 served == 0);
        if (n == -2) {
            respond(fd, 413, "application/json", JSON_413, strlen(JSON_413), 0);
            return;
        }
        if (n <= 0) return;    /* idle timeout, EOF or error */
        char saved = buf[head_len];      /* may be a pipelined request's 1st byte */
        buf[head_len] = '\0';

        char method[16], path[256], protocol[16];
        if (sscanf(buf, "%15s %255s %15s", method, path, protocol) != 3) {
            respond(fd, 400, "application/json", JSON_400, strlen(JSON_400), 0);
            return;
        }

        int keep = should_keep_alive(buf, protocol);
        route(fd, path, buf, keep);
        if (!keep || ++served >= MAX_REQS_PER_CONN) return;
        buf[head_len] = saved;           /* put the byte back */

        /* Compact any pipelined follow-up bytes to the front of buf. */
        size_t total = (size_t)n;
        pending = total - head_len;
        if (pending > 0)
            memmove(buf, buf + head_len, pending);
    }
}

/* ------------------------------------------------------------------ */
/* Worker pool + shutdown                                             */
/* ------------------------------------------------------------------ */

static void *worker_main(void *unused) {
    (void)unused;
    struct sockaddr_in client_addr;
    socklen_t client_len;
    for (;;) {
        if (g_stop) return NULL;
        client_len = sizeof(client_addr);
        int cfd = accept(g_listener_fd, (struct sockaddr *)&client_addr,
                         &client_len);
        if (cfd < 0) {
            /* Listener closed by the signal handler → normal exit. */
            if (g_stop || errno == EBADF || errno == EINVAL) return NULL;
            continue;
        }
        handle_connection(cfd);
        close(cfd);
    }
}

static void on_signal(int sig) {
    (void)sig;
    g_stop = 1;
    if (g_listener_fd >= 0) close(g_listener_fd);  /* wakes every worker  */
}

int main(int argc, char **argv) {
    int port = argc > 1 ? atoi(argv[1]) : 8081;

    if (e8_generate_roots(g_roots, E8_NUM_ROOTS) != E8_NUM_ROOTS ||
        e8_validate(g_roots, E8_NUM_ROOTS) != 0) {
        fprintf(stderr, "fatal: E8 root generation failed validation\n");
        return 1;
    }
    for (size_t i = 0; i < E8_NUM_ROOTS; i++)
        if (g_roots[i].is_half) g_n_half++; else g_n_int++;
    build_static_bodies();

    /* Never die to SIGPIPE — clients disconnect all the time. */
    signal(SIGPIPE, SIG_IGN);
    struct sigaction sa = { .sa_handler = on_signal };
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    g_listener_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (g_listener_fd < 0) { perror("socket"); return 1; }

    int one = 1;
    setsockopt(g_listener_fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {
        .sin_family      = AF_INET,
        .sin_addr.s_addr = htonl(INADDR_ANY),
        .sin_port        = htons((uint16_t)port)
    };
    if (bind(g_listener_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        return 1;
    }
    if (listen(g_listener_fd, LISTEN_BACKLOG) < 0) {
        perror("listen");
        return 1;
    }

    long np = sysconf(_SC_NPROCESSORS_ONLN);
    if (np < 1) np = MIN_WORKERS;
    size_t nworkers = (size_t)np * 4;
    if (nworkers < MIN_WORKERS) nworkers = MIN_WORKERS;
    if (nworkers > MAX_WORKERS) nworkers = MAX_WORKERS;

    printf("E8 Lattice HTTP server on port %d (%zu workers)\n", port, nworkers);
    printf("  GET /health | /api/roots | /api/roots/:id | /api/nearest?v=..\n");
    printf("  GET /api/log | /api/cmatrix/:id | /api/pixel/:id\n");
    printf("  GET /api/overlap | /api/stats\n");

    pthread_t *workers = calloc(nworkers, sizeof(pthread_t));
    if (!workers) return 1;
    for (size_t i = 0; i < nworkers; i++)
        pthread_create(&workers[i], NULL, worker_main, NULL);
    for (size_t i = 0; i < nworkers; i++)
        pthread_join(workers[i], NULL);

    close(g_listener_fd);
    free(workers);
    free_static_bodies();
    printf("Server shut down cleanly\n");
    return 0;
}