# E8 Lattice Visualization Web Server

A complete web server stack for visualizing the E8 root lattice (240 roots in 8 dimensions) with:
- **C Backend**: High-performance HTTP servers generating E8 roots, hex representations, and visualizations
- **Nginx Load Balancer**: Distributes requests across 4 backend servers using least-connections algorithm
- **Web Frontend**: Interactive canvas visualization with real-time API data

## Architecture

```
                    ┌─────────────────┐
                    │   Browser       │
                    │   (port 8080)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Nginx LB      │
                    │   (port 8080)   │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌──────────┐        ┌──────────┐        ┌──────────┐
   │ Server 1 │        │ Server 2 │        │ Server 3 │
   │ :8081    │        │ :8082    │        │ :8083    │
   └──────────┘        └──────────┘        └──────────┘
         ▲                   ▲                   ▲
         └───────────────────┼───────────────────┘
                             ▼
                     ┌──────────┐
                     │ Server 4 │
                     │ :8084    │
                     └──────────┘
```

## Quick Start

```bash
# Start the native cluster (4 e8 servers 8081-8084 + nginx on 8080)
./start_server.sh

# Access web UI
open http://localhost:8080

# Stop all servers
./stop_server.sh
```

Docker variant (nginx LB + one e8 server + Rust mempool backend):
`docker compose up --build -d` — served on http://127.0.0.1:8080.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/stats` | Lattice statistics |
| `GET /api/roots` | All 240 roots with hex/coords |
| `GET /api/roots/:id` | Single root details |
| `GET /api/nearest?v=x,y,z...` | Find nearest root to 8D vector |
| `GET /api/log` | Request log (per server) |
| `GET /api/cmatrix/:id` | ASCII/terminal visualization |
| `GET /api/pixel/:id` | PPM pixel data (400x400) |
| `GET /api/overlap` | Non-zero dot products between roots |

## E8 Root System

- **240 roots** in 8 dimensions
- **112 integer roots**: permutations of (±1, ±1, 0, 0, 0, 0, 0, 0)
- **128 half-integer roots**: (±½, ±½, ±½, ±½, ±½, ±½, ±½, ±½) with even number of minus signs
- **Norm² = 2** for all roots
- **Kissing number = 240** (densest sphere packing in 8D)

## Hexadecimal Encoding

Every coordinate is written as one byte offset from neutral:

`byte = 0x80 + 2·coord`

| coordinate | byte | | coordinate | byte |
|---|---|---|---|---|
| −1 | `0x7e` | | +½ | `0x81` |
| −½ | `0x7f` | | +1 | `0x82` |
| 0 | `0x80` | | | |

Example: integer root `[-1, -1, 0, 0, 0, 0, 0, 0]` → `7e7e808080808080`

> The scheme is uniform across both root types — integer roots use even bytes
> `0x7e/0x80/0x82`, half-integer roots use odd bytes `0x7f/0x81`. The C core
> stores true ±1 / ±½ coordinates, so every one of the 240 roots has
> norm² = 2 — and the C API's hex output matches the web frontend byte for
> byte.

### Pixel fold (hex → RGB)

The web frontend derives each root's pixel color from its hex signature.
Bytes 0–1 average into **R**, 2–3 into **G**, 4–5 into **B**, and the result
stretches to the crisp set `00 40 80 C0 FF`:

- root `[-1, -1, 0, 0, 0, 0, 0, 0]` → bytes `7e 7e 80 80 80 80` → `#008080`
- root `[+½ ×8]` → bytes `81 81 81 81 81 81` → `#c0c0c0`

Every pixel on the site — the 240-root bitmap, the live paint field, and the
decoders — uses this one rule, and can be read back to the nearest root.

## CMatrix Visualization

Terminal-based ASCII visualization showing root positions:
```
E8 Root 42 | Hex: 80818080807f8080 | Coords: 0 1 0 0 0 -1 0 0 
                  @           @     @
        .   .   .       .   .   .
            @       @   @
```

## Pixel Generation

400x400 PPM images, one `#RGB` blob per root at the root's 2D projection:
- **Color = pixel fold** of that root's 16-hex-digit signature (the same
  rule as the web mosaic, see above) — every root's blob reads back as its
  own fold colour
- **Highlighted root: White**

The fold lives in the shared core (`e8_pixel_channel`, `src/e8.c`) so the
CLI's PPM, the HTTP `/api/pixel` and the frontend all agree byte-for-byte.

## Load Balancing

Nginx configured with `least_conn` algorithm:
- Automatic failover (max_fails=3, fail_timeout=30s)
- Keepalive connections (32)
- Health checks via `/health` endpoint

## Project Structure

```
PixelMan/
├── bin/                    # Compiled binaries
│   ├── e8_lattice          # CLI tool
│   └── e8_http_server      # HTTP server
├── src/                    # C source code
│   ├── e8.h / e8.c         # Shared E8 core (generation, hex, nearest, pixel fold) — single truth
│   ├── e8_lattice.c        # CLI front end (thin, over the core)
│   └── e8_http_server.c    # Thread-pooled HTTP server (uses the core too)
├── scripts/
│   └── test_e8.py          # CLI + endpoint verification suite (make test)
├── web/                    # Frontend assets (no build step)
├── nginx/                  # Native load balancer config
├── docker/                 # Docker packaging (e8-server, btc-mempool, nginx)
├── docker-compose.yml      # Docker stack (nginx:8080 + e8 + mempool)
├── docker-compose.prod.yml # Registry-pulled prod variant
├── docker-bake.hcl         # Buildx bake targets
├── projects/btc-mempool/   # Rust mempool.space backend (axum, /api/mempool)
├── logs/                   # Server logs
├── Makefile                # Build, test, sanitize, PGO targets
├── start_server.sh         # Native cluster startup script
└── stop_server.sh          # Native cluster shutdown script
```

## Building from Source

```bash
make            # builds both binaries (O3 + native + LTO)
make test       # verification suite (CLI checks + every HTTP endpoint)
make sanitize   # rebuild with AddressSanitizer + UBSan
make pgo        # profile-guided optimisation pass
```

## CLI Tool Usage

```bash
# List all roots in hex
./bin/e8_lattice --list

# Show cmatrix for root 42
./bin/e8_lattice --cmatrix 42

# Generate pixel PPM for root 42
./bin/e8_lattice --pixel 42
./bin/e8_lattice --pixel 42 --out /tmp/root42.ppm
```

The HTTP server is a separate binary: `./bin/e8_http_server 8081`.

## Web Frontend Features

`web/index.html` + `web/assets/secure.js` — vanilla JS/DOM, zero build
step, no dependencies (nginx serves it statically; all data comes through
the `/api/e8/` and `/api/btc/` proxies).

- **240-root mosaic** — one cell per root, each coloured by the pixel
  fold (README rule); click to inspect, counts update live (112 + 128)
- **Inspector** — root id, type, 16-hex-digit signature, colourised byte
  swatches, coordinates, and the folded `pixel fold` value
- **Akula lattice key derivation** — `k = HMAC-SHA512(salt, genesisAnchor
  + rootHex) mod n` over secp256k1, computed locally via WebCrypto
- **Bitcoin correlation panel** — live mempool data (BTC price, block
  height, recent transactions) proxied to the Rust `btc-mempool` backend
- **Principles log** — terminal-style activity feed + matrix-rain backdrop

All 240 roots (112 integer + 128 half-integer, norm² = 2) come from the
C API, generated once at startup from the shared core.

## Dependencies

- macOS/Linux with gcc
- nginx (via Homebrew: `brew install nginx`)
- cmatrix (optional, for terminal: `brew install cmatrix`)

## Performance

Measured on a M-series MacBook (release build, keep-alive, 4 concurrent):

| Endpoint        | Throughput           |
|-----------------|----------------------|
| `/api/nearest`  | ~80,000 req/s        |
| `/api/roots`    | ~56,000 req/s        |
| 4-server cluster| — (nginx `least_conn`) |

Sub-millisecond latency for root lookups. The static bodies (`/api/roots`,
`/api/overlap`, `/api/roots/:id`) are rendered once at startup and served
from memory; a fixed worker pool + keep-alive replaces the old
thread-per-request model. Request logging uses a mutex-protected ring.

## License

MIT