/**
 * htp-ghost.js — shape-shifting code ghost for htp.sh
 * Inspired by the Ghostty homepage morph, original procedural art (not their frames).
 * home-ghost-0x539 · CRT green · prefers-reduced-motion aware
 */
(function () {
  "use strict";

  const RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const COLS = 72;
  const ROWS = 28;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /** Soft ghost SDF morph targets (normalized -1..1 space). Original shapes. */
  function sdfBlob(px, py, cx, cy, rx, ry) {
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    return Math.sqrt(dx * dx + dy * dy) - 1;
  }

  function sdfGhostA(x, y, t) {
    // Classic sheet ghost: round head + wavy hem
    const body = sdfBlob(x, y, 0, -0.08, 0.55, 0.72);
    const hem =
      Math.sin(x * 9 + t * 2.2) * 0.04 +
      Math.sin(x * 17 - t * 1.4) * 0.02;
    const cut = y - (0.62 + hem);
    const d = Math.max(body, -cut);
    // Eyes (subtract)
    const e1 = sdfBlob(x, y, -0.18, -0.22, 0.09, 0.11);
    const e2 = sdfBlob(x, y, 0.18, -0.22, 0.09, 0.11);
    const mouth = sdfBlob(x, y, 0, 0.05 + Math.sin(t * 3) * 0.02, 0.12, 0.05);
    return Math.min(d, Math.min(e1, e2) * -1 > 0 ? -0.02 : d) -
      (mouth < 0 ? 0.015 : 0);
  }

  function sdfGhostB(x, y, t) {
    // Tall lanky spook
    const body = sdfBlob(x, y + Math.sin(t) * 0.04, 0, -0.05, 0.38, 0.9);
    const head = sdfBlob(x, y, 0, -0.55, 0.32, 0.28);
    const armL = sdfBlob(x, y, -0.55, 0.05, 0.22, 0.1);
    const armR = sdfBlob(x, y, 0.55, 0.05, 0.22, 0.1);
    let d = Math.min(body, head);
    d = Math.min(d, armL, armR);
    const e1 = sdfBlob(x, y, -0.12, -0.55, 0.06, 0.08);
    const e2 = sdfBlob(x, y, 0.12, -0.55, 0.06, 0.08);
    return d + (e1 < 0 || e2 < 0 ? 0.02 : 0);
  }

  function sdfGhostC(x, y, t) {
    // Wide grinning blob
    const body = sdfBlob(x, y, 0, 0, 0.78, 0.55);
    const grin = Math.abs(y - 0.12) - 0.04 + Math.abs(x) * 0.08 - 0.18;
    const e1 = sdfBlob(x, y, -0.28, -0.12, 0.1, 0.08);
    const e2 = sdfBlob(x, y, 0.28, -0.12, 0.1, 0.08);
    let d = body;
    if (grin < 0) d = Math.min(d, grin);
    if (e1 < 0 || e2 < 0) d += 0.025;
    return d + Math.sin(x * 6 + t) * 0.01;
  }

  function sdfGhostD(x, y, t) {
    // Code-spectre: rect body + floating bits
    const body = Math.max(Math.abs(x) - 0.42, Math.abs(y + 0.05) - 0.65);
    const cap = sdfBlob(x, y, 0, -0.55, 0.45, 0.25);
    let d = Math.min(body, cap);
    // floating glyphs as soft holes
    for (let i = 0; i < 5; i++) {
      const fx = Math.sin(t * 0.7 + i * 1.7) * 0.55;
      const fy = Math.cos(t * 0.9 + i * 1.3) * 0.45;
      const bit = sdfBlob(x, y, fx, fy, 0.06, 0.06);
      if (bit < 0) d = Math.min(d, bit + 0.04);
    }
    return d;
  }

  function sampleSDF(x, y, t) {
    // Cycle morph between four original shapes
    const safeTime = Number.isFinite(t) ? t : 0;
    const phase = ((safeTime * 0.18) % 4 + 4) % 4;
    const i0 = Math.min(3, Math.max(0, Math.floor(phase))) ;
    const i1 = (i0 + 1) % 4;
    const u = smoothstep(0, 1, phase - i0);
    const fns = [sdfGhostA, sdfGhostB, sdfGhostC, sdfGhostD];
    const a = fns[i0](x, y, t);
    const b = fns[i1](x, y, t);
    // slight bob
    const bob = Math.sin(t * 1.3) * 0.04;
    const ya = y - bob;
    const a2 = fns[i0](x, ya, t);
    const b2 = fns[i1](x, ya, t);
    return lerp(a2, b2, u);
  }

  function densityAt(col, row, t) {
    const x = (col / (COLS - 1)) * 2 - 1;
    const y = (row / (ROWS - 1)) * 2 - 1;
    // aspect correct-ish
    const xs = x * 1.35;
    const d = sampleSDF(xs, y, t);
    const edge = smoothstep(0.18, -0.05, d);
    const noise = hash2(col * 0.37 + t * 0.2, row * 0.41) * 0.12;
    const glow = Math.exp(-Math.max(d, 0) * 6) * 0.35;
    return clamp(edge * 0.95 + glow + noise * edge, 0, 1);
  }

  function charFor(d, col, row, t) {
    if (d < 0.04) return " ";
    // sprinkle code glyphs inside body for "code ghost"
    if (d > 0.55 && hash2(col + Math.floor(t * 3), row) > 0.82) {
      const glyphs = "{}<>/;|$&#01";
      return glyphs[(col + row + Math.floor(t * 5)) % glyphs.length];
    }
    const idx = Math.floor(d * (RAMP.length - 1));
    return RAMP[idx];
  }

  function boot() {
    const canvas = document.getElementById("htp-ghost-canvas");
    const meta = document.getElementById("htp-ghost-meta");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cellW = 9;
    const cellH = 14;
    const cssW = COLS * cellW;
    const cssH = ROWS * cellH;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "12px \"VT323\", \"Share Tech Mono\", ui-monospace, monospace";
    ctx.textBaseline = "top";

    const reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let start = performance.now();
    let frame = 0;
    let raf = 0;

    function paint(now) {
      const t = reduce ? 1.2 : (now - start) / 1000;
      ctx.clearRect(0, 0, cssW, cssH);

      // phosphor backdrop
      ctx.fillStyle = "rgba(0, 8, 2, 0.85)";
      ctx.fillRect(0, 0, cssW, cssH);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const d = densityAt(c, r, t);
          if (d < 0.04) continue;
          const ch = charFor(d, c, r, t);
          const g = Math.floor(lerp(40, 255, d));
          const a = lerp(0.35, 1, d);
          // acid tint near edge
          if (d > 0.75) {
            ctx.fillStyle = `rgba(212, 255, 0, ${a})`;
          } else if (d < 0.25) {
            ctx.fillStyle = `rgba(0, 240, 255, ${a * 0.7})`;
          } else {
            ctx.fillStyle = `rgba(${Math.floor(g * 0.35)}, ${g}, ${Math.floor(g * 0.45)}, ${a})`;
          }
          ctx.fillText(ch, c * cellW + 1, r * cellH + 1);
        }
      }

      // soft scanline
      ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
      for (let y = 0; y < cssH; y += 3) {
        ctx.fillRect(0, y, cssW, 1);
      }

      frame++;
      if (meta) {
        const morph = ((t * 0.18) % 4).toFixed(2);
        meta.textContent = `frm ${frame} · morph ${morph}/4 · ${COLS}x${ROWS}`;
      }

      if (!reduce) {
        raf = requestAnimationFrame(paint);
      }
    }

    if (reduce) {
      paint(start);
    } else {
      raf = requestAnimationFrame(paint);
    }

    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.hidden) {
          cancelAnimationFrame(raf);
        } else if (!reduce) {
          start = performance.now() - ((performance.now() - start) % 20000);
          raf = requestAnimationFrame(paint);
        }
      },
      { passive: true }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
