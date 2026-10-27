#!/usr/bin/env python3
"""
Verification suite for the E8 lattice CLI + HTTP server.

Run after `make`:

    python3 scripts/test_e8.py

It boots the server on a scratch port, hammers every endpoint, checks
JSON validity and mathematical invariants, then exercises the failure
paths that used to be bugs (overflowing overlap body, fabricated
nearest distance, wrong pixel content-length, out-of-range ids).
"""

import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "bin")
PORT = 18101
BASE = f"127.0.0.1:{PORT}"

failures = 0


def check(ok, label):
    global failures
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {label}")
    if not ok:
        failures += 1


def get(path, headers=None):
    conn = http.client.HTTPConnection(BASE, timeout=5)
    conn.request("GET", path, headers=headers or {})
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, dict(resp.getheaders()), body


def as_json(body):
    return json.loads(body.decode("utf-8"))


def hex_of(coords):
    return "".join(f"{(0x80 + int(2 * c)) & 0xFF:02x}" for c in coords)


def expect_overlap(roots):
    """Independent recomputation of the overlap table from the API's coords."""
    pairs = []
    for i in range(len(roots)):
        for j in range(i + 1, len(roots)):
            dot = sum(roots[i][k] * roots[j][k] for k in range(8))
            if dot != 0:
                pairs.append((i, j, round(dot, 6)))
    return pairs


# --------------------------------------------------------------------- CLI

def test_cli():
    print("CLI:")
    cli = os.path.join(BIN, "e8_lattice")

    out = subprocess.run([cli, "--list"], capture_output=True, text=True).stdout
    lines = [l for l in out.splitlines() if l.startswith("Root")]
    check(len(lines) == 240, f"--list prints 240 roots (got {len(lines)})")
    check("112 integer, 128 half-integer" in out, "--list sums 112 + 128")

    r = subprocess.run([cli, "--cmatrix", "240"], capture_output=True)
    check(r.returncode == 2, "--cmatrix 240 (out of range) exits non-zero")

    with tempfile.TemporaryDirectory() as tmp:
        ppm = os.path.join(tmp, "t.ppm")
        r = subprocess.run([cli, "--pixel", "42", "--out", ppm],
                           capture_output=True)
        ok = r.returncode == 0 and os.path.exists(ppm)
        if ok:
            with open(ppm, "rb") as f:
                head = f.readline()
            ok = head == b"P6\n"
        check(ok, "--pixel writes a valid P6 PPM")


# ----------------------------------------------------------------- SERVER

def wait_healthy(proc):
    for _ in range(50):
        try:
            status, _, body = get("/health")
            if status == 200 and b"ok" in body:
                return True
        except OSError:
            pass
        if proc.poll() is not None:
            return False
        time.sleep(0.1)
    return False


def test_server():
    print("HTTP server:")
    proc = subprocess.Popen(
        [os.path.join(BIN, "e8_http_server"), str(PORT)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        check(wait_healthy(proc), "server reaches /health")

        # /api/roots — structure, counts, hex scheme, norm, real coords
        st, hdrs, body = get("/api/roots")
        data = as_json(body)
        roots = data["roots"]
        check(st == 200 and data["total"] == 240 and len(roots) == 240,
              "/api/roots: 240 roots reported")
        check(sum(r["type"] == "integer" for r in roots) == 112 and
              sum(r["type"] == "half-integer" for r in roots) == 128,
              "/api/roots: 112 integer + 128 half-integer types")

        bad_hex = [r for r in roots if r["hex"] != hex_of(r["coords"])]
        check(not bad_hex, "/api/roots: every hex matches the uniform scheme")

        bad_norm = [r for r in roots
                    if abs(sum(c * c for c in r["coords"]) - 2.0) > 1e-6]
        check(not bad_norm, "/api/roots: every root satisfies norm2 == 2")

        # /api/roots/:id
        st, _, body = get("/api/roots/42")
        d = as_json(body)
        check(st == 200 and d["id"] == 42 and d["hex"] == roots[42]["hex"]
              and d["norm2"] == 2.0,
              "/api/roots/42 returns matching detail")
        st, _, _ = get("/api/roots/999")
        check(st == 404, "/api/roots/999 -> 404")

        # /api/nearest — the distance used to be hardcoded 0.0
        vq = [1.0, -1.0, 9.0, 0, 0, 0, 0, 0]
        st, _, body = get("/api/nearest?v=1.0,-1.0,9.0,0,0,0,0,0")
        d = as_json(body)
        nearest = d["nearest_id"]
        expected_dist = min(
            sum((vq[k] - roots[i]["coords"][k]) ** 2 for k in range(8)) ** 0.5
            for i in range(240))
        check(st == 200 and 0 <= nearest < 240
              and abs(d["distance"] - expected_dist) < 1e-3,
              f"/api/nearest returns the true minimal distance "
              f"({d['distance']:.6f} vs {expected_dist:.6f})")
        st, _, _ = get("/api/nearest?v=abc")
        check(st == 400, "/api/nearest?v=abc -> 400")

        # /api/overlap — this body used to overrun a 100 KB buffer
        st, _, body = get("/api/overlap")
        data = as_json(body)
        pairs = data["overlaps"]
        expected = expect_overlap([r["coords"] for r in roots])
        check(st == 200 and len(pairs) == len(expected) == data["total"],
              f"/api/overlap parses; {len(pairs)} nonzero pairs (independent match)")
        check(set((p["root1"], p["root2"], p["dot"]) for p in pairs) ==
              set(expected),
              "/api/overlap dot products match recomputation")

        # /api/cmatrix — the header used to be NUL-terminated mid-frame,
        # so the art (dots + @) never shipped. Frame must be complete.
        st, _, body = get("/api/cmatrix/42")
        ok = (st == 200 and b"E8 Root 42 | Hex:" in body
              and b"Coords: 0 1 0 0 0 -1 0 0" in body
              and body.count(b".") >= 20 and body.count(b"@") == 1
              and len(body) == (80 + 1) * 24  # 24 rows, trailing '\n' each
              and len(body.split(b"\n")) == 25)
        check(ok, "/api/cmatrix/42 renders dots, one '@' highlight and a full frame")

        # strict :id parsing — "42garbage" etc. must 404, not alias root 42
        bad_ids = ["/api/roots/", "/api/roots/42garbage", "/api/roots/+7",
                   "/api/roots/1.5", "/api/cmatrix/abc", "/api/pixel/12x"]
        got = {b: get(b)[0] for b in bad_ids}
        check(all(st == 404 for st in got.values()),
              "strict :id parsing -> 404 for empty/signed/junk ids")

        # non-finite coords used to hit g_roots[SIZE_MAX]; must 400 now
        st, _, _ = get("/api/nearest?v=nan,1,1")
        check(st == 400, "/api/nearest?v=nan → 400 (no out-of-range root)")

        # bare-LF HTTP terminator used to underflow a memmove and kill the
        # whole server; it must now be served normally and the server
        # must still answer afterwards.
        s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\n\n")
        s.settimeout(3)
        data = b""
        try:
            while data.count(b"HTTP/1.1 200") < 1:
                chunk = s.recv(65536)
                if not chunk:
                    break
                data += chunk
        except socket.timeout:
            pass
        s.close()
        st2, _, _ = get("/health")
        check(data.count(b"HTTP/1.1 200") == 1 and st2 == 200,
              "bare-LF terminator served and the server survives")

        # /api/pixel — colors follow the README pixel fold (bytes 0-1->R, 2-3->G,
        # 4-5->B, each channel stretched to the crisp set 00/40/80/C0/FF).
        st, _, body = get("/api/pixel/200")
        crisps = {0, 64, 128, 192, 255}
        px = body[15:]
        fold = {}
        for r in roots:
            hexs = r["hex"]

            def pair(start):
                return (int(hexs[start:start + 2], 16)
                        + int(hexs[start + 2:start + 4], 16)) / 2

            def stretch(a):
                return max(0.0, min(255.0, (a - 126) * 64))

            fold[tuple(int(stretch(pair(s))) for s in (0, 4, 8))] = r["id"]
        ok = st == 200 and set(px) <= crisps
        check(ok, "/api/pixel: every channel in the crisp fold set 00/40/80/C0/FF")
        check(fold.get((0, 128, 128)) is not None,  # [-1,-1,0,..] -> #008080
              "independent fold rule: [-1,-1,0,...] -> (0,128,128)")
        check(fold.get((192, 192, 192)) is not None,  # [+1/2 x8] -> #c0c0c0
              "independent fold rule: [+1/2 x8] -> (192,192,192)")
        on_screen = {tuple(px[i:i + 3])
                     for i in range(0, len(px), 3)}
        allowed = {(0, 0, 0)} | set(fold) | {(255, 255, 255)}
        check(on_screen <= allowed,  # white = highlight, black = background
              "/api/pixel: every colour on screen is the fold of some root")

        # /api/pixel — content-type/length used to disagree with the body
        st, hdrs, body = get("/api/pixel/42")
        ctype = next(v for k, v in hdrs.items() if k.lower() == "content-type")
        clen = int(next(v for k, v in hdrs.items() if k.lower() == "content-length"))
        check(st == 200 and body.startswith(b"P6\n")
              and ctype == "image/x-portable-pixmap"
              and clen == len(body)
              and clen == 15 + 400 * 400 * 3,
              "/api/pixel/42: correct type and exact content-length")

        # /api/stats
        st, _, body = get("/api/stats")
        d = as_json(body)
        check(d["total_roots"] == 240 and d["integer_roots"] == 112
              and d["half_integer_roots"] == 128,
              "/api/stats reports true 112/128 split")

        # /api/log — dynamic, must parse and be non-empty
        st, _, body = get("/api/log")
        d = as_json(body)
        check(st == 200 and d["total"] == len(d["requests"]) and d["total"] > 0,
              "/api/log parses and records requests")

        # unknown routes
        st, _, _ = get("/api/nope")
        check(st == 404, "/api/nope -> 404")

        # keep-alive: two requests over one TCP connection
        s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        req = ("GET /api/stats HTTP/1.1\r\nHost: x\r\n"
               "Connection: keep-alive\r\n\r\n")
        data = b""
        s.sendall(req.encode() + req.encode())
        s.settimeout(3)
        try:
            while data.count(b"HTTP/1.1 200") < 2:
                chunk = s.recv(65536)
                if not chunk:
                    break
                data += chunk
        except socket.timeout:
            pass
        s.close()
        check(data.count(b"HTTP/1.1 200") == 2,
              "keep-alive serves two requests on one connection")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        check(proc.returncode == 0, "graceful shutdown on SIGTERM")


def main():
    test_cli()
    test_server()
    print()
    if failures:
        print(f"{failures} check(s) FAILED")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()