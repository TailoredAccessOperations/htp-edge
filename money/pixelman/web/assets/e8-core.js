/* e8-core.js — browser port of the PixelMan shared E8 core (src/e8.c).
 *
 * Single source of truth for the E8 mathematics, byte-for-byte compatible
 * with the C core so the CLI, the HTTP server and this page all agree:
 *
 *   240 roots in 8 dimensions
 *     112 integer roots      permutations of (±1,±1,0,0,0,0,0,0)
 *     128 half-integer roots permutations of (±1/2 ×8) with even # of −
 *     norm² = 2 for every root · kissing number 240
 *   hex encoding: byte = 0x80 + 2·coord   →  −1:0x7e −½:0x7f 0:0x80 +½:0x81 +1:0x82
 *   pixel fold (site-wide colour rule): bytes 0–1→R 2–3→G 4–5→B,
 *     channel = (avg(byteA,byteB) − 0x7e) · 64, stretched to {00 40 80 C0 FF}
 *   fnv-1a: 64-bit digest over the 8 hex bytes (offset 0x14650fb0739d0383,
 *     the src/e8.c constant — a variant of the standard FNV-1a basis)
 *
 * The reference order matches e8_generate_roots in src/e8.c exactly:
 * the 112 integer roots first, then the 128 half-integer roots in sign-mask
 * order (0..255, even popcount only).
 *
 * Loaded two ways:
 *   - classic <script src="assets/e8-core.js">  → window.PixelManE8
 *   - ES module  import "/money/pixelman/web/assets/e8-core.js" (side effect)
 * The UMD wrapper below makes both work.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.PixelManE8 = factory();
})(
  typeof self !== "undefined" ? self
    : typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis
    : this,
  function () {
  "use strict";

  const DIM = 8;
  const NUM_ROOTS = 240;
  const NORM2 = 2;
  const WEYL_GROUP_ORDER = 696729600;

  const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const DERIVATION_SALT = "akula:e8:btc-genesis:v1";
  const GENESIS_ANCHOR = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";

  function popcount(x) {
    let c = 0;
    x = x >>> 0;
    while (x) { x &= x - 1; c++; }
    return c;
  }

  function coordsToHex(coords) {
    let s = "";
    for (let k = 0; k < DIM; k++) {
      const b = 0x80 + 2 * coords[k];
      s += (b < 16 ? "0" : "") + b.toString(16);
    }
    return s;
  }

  /* e8_generate_roots / e8_validate — identical generation + reference order. */
  function generateRoots() {
    const roots = [];
    for (let i = 0; i < DIM; i++) {
      for (let j = i + 1; j < DIM; j++) {
        for (let si = 0; si < 2; si++) {
          for (let sj = 0; sj < 2; sj++) {
            const coords = new Float64Array(DIM);
            coords[i] = si ? 1 : -1;
            coords[j] = sj ? 1 : -1;
            roots.push({ id: roots.length, is_half: 0, coords, hex: coordsToHex(coords) });
          }
        }
      }
    }
    for (let mask = 0; mask < (1 << DIM) && roots.length < NUM_ROOTS; mask++) {
      if (popcount(mask) & 1) continue; /* odd minus-sign count -> skip */
      const coords = new Float64Array(DIM);
      for (let k = 0; k < DIM; k++) coords[k] = (mask & (1 << k)) ? -0.5 : 0.5;
      roots.push({ id: roots.length, is_half: 1, coords, hex: coordsToHex(coords) });
    }
    return roots;
  }

  function validate(roots) {
    const all = roots || generateRoots();
    if (all.length !== NUM_ROOTS) return -1;
    let nInt = 0, nHalf = 0;
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      let norm2 = 0;
      for (let k = 0; k < DIM; k++) norm2 += r.coords[k] * r.coords[k];
      if (Math.abs(norm2 - NORM2) > 1e-6) return -1;
      if (r.id !== i) return -1;
      if (r.is_half) nHalf++; else nInt++;
    }
    if (nInt !== 112 || nHalf !== 128) return -1;
    return 0;
  }

  /* e8_pixel_channel — one RGB channel from a coord pair, exactly as C. */
  function pixelChannel(a, b) {
    const byteA = Math.round(128 + 2 * a);
    const byteB = Math.round(128 + 2 * b);
    const avg = (byteA + byteB) >> 1; /* integer avg, matches C x/2 */
    let v = (avg - 0x7e) * 64;
    if (v < 0) v = 0;
    if (v > 0xff) v = 0xff;
    return v;
  }

  /* Pixel fold over the 16-hex-digit signature (bytes 0..5), README rule. */
  function pixelFold(hex) {
    const pairAvg = (start) => {
      const a = parseInt(hex.substring(start, start + 2), 16);
      const b = parseInt(hex.substring(start + 2, start + 4), 16);
      return (a + b) >> 1;
    };
    const stretch = (avg) => Math.max(0, Math.min(255, (avg - 126) * 64));
    return [stretch(pairAvg(0)), stretch(pairAvg(4)), stretch(pairAvg(8))];
  }

  function pixelRgb(hex) {
    const [r, g, b] = pixelFold(hex);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  /* FNV-1a 64-bit over the 8 encoded bytes (e8_hash_str core).
   * NOTE: offset basis matches src/e8.c exactly (1469598103934665603,
   * a variant of the standard FNV-1a 64 basis) so hashes agree with the
   * C core byte-for-byte. */
  const FNV_OFFSET = 0x14650fb0739d0383n;
  const FNV_PRIME = 1099511628211n;
  const MASK64 = 0xffffffffffffffffn;

  function fnv1aBytes(bytes) {
    let h = FNV_OFFSET;
    for (let i = 0; i < bytes.length; i++) {
      h = (h ^ BigInt(bytes[i])) & MASK64;
      h = (h * FNV_PRIME) & MASK64;
    }
    return h;
  }

  /* 16 hex digits. */
  function fnv1aHex(bytes) {
    return fnv1aBytes(bytes).toString(16).padStart(16, "0");
  }

  /* 64 hex digits exactly as src/e8.c e8_hash_str emits: the 16 hash hex
   * digits followed by 48 zero digits (the C loop shifts past the value). */
  function hash64Hex(bytes) {
    return fnv1aHex(bytes) + "0".repeat(48);
  }

  function hexRootToBytes(hex) {
    if (hex.length !== 16) return [];
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  /* e8_find_nearest — brute force over the 240 roots. */
  function nearest(v, roots) {
    const all = roots || generateRoots();
    let bestSq = Infinity, best = -1;
    for (let i = 0; i < all.length; i++) {
      const c = all[i].coords;
      let sq = 0;
      for (let k = 0; k < DIM; k++) { const d = v[k] - c[k]; sq += d * d; }
      if (sq < bestSq) { bestSq = sq; best = i; }
    }
    return { id: best, distance: Math.sqrt(bestSq) };
  }

  /* Project a 32-byte digest into the E8 root space: each 32-bit word is
   * normalised to [-1,1) as word/2^31 − 1, then matched to its nearest root. */
  function projectDigest(bytes32) {
    const v = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) {
      let word = 0;
      for (let b = 0; b < 4; b++) word = word * 256 + bytes32[i * 4 + b];
      v[i] = word / 0x7fffffff - 1;
    }
    return v;
  }

  /* BigInteger helpers shared by the page modules. */
  function bigintToBytes(value, length) {
    const out = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
      out[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return out;
  }

  function bytesToBigintBE(bytes) {
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    return v;
  }

  return {
    DIM,
    NUM_ROOTS,
    NORM2,
    WEYL_GROUP_ORDER,
    SECP256K1_ORDER,
    DERIVATION_SALT,
    GENESIS_ANCHOR,
    generateRoots,
    validate,
    pixelChannel,
    pixelFold,
    pixelRgb,
    fnv1aHex,
    hash64Hex,
    hexRootToBytes,
    nearest,
    projectDigest,
    bigintToBytes,
    bytesToBigintBE,
    coordsToHex,
  };
});