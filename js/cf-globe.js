/* Connect globe — WebGL2 sphere + dither compositor.
   Port of Cloudflare's Globe.astro. The worldLow GeoJSON is rasterised to a
   single-channel equirectangular texture, wrapped onto a sphere in a fragment
   shader, and the density field is dithered into a visible dot matrix. */

const GLOBE_W = 1400; // render target, matches the Connect hero bake
const GLOBE_H = 718;
const SPHERE_R = 529; // 1058px sphere
const SPHERE_CX = 700;
const SPHERE_CY = -51; // bottom-up GL; puts the sphere's top at y=240
const TILT_DEG = 12;

const MAP_W = 1024;
const MAP_H = 512;
const SAMPLE_SCALE = 4; // globe is downsampled 4x before the dither reads it

const ROTATION_PERIOD = 30000; // one full turn every 30s, as on Connect
const FRAME_MS = 1000 / 9; // ~9fps: the dither is chunky, higher is wasted

// dither_pixelgrid is a flat cut, not an ordered matrix. 0.42 is CF's value.
const DITHER_CUT = 0.42;
// Live-tunable the way the Connect page does, via window events.
let ditherPixel = 6; // window.__pixelSize
let ditherGap = 2; // window.__pixelGap
// The globe reads as a phosphor terminal rather than Cloudflare's white-on-
// orange: the ink is the site's own green, so it sits inside the HTP theme.
let globeInk = 'rgba(143, 230, 179, 0.9)';

let density = null;
let densW = 0;
let densH = 0;

// Cursor spring. `amp` overshoots toward 1 while the pointer is over the hero
// and decays out when it leaves, which is what makes the dots breathe around
// the pointer instead of tracking it rigidly.
const cursor = { x: 0.5, y: 0.5, amp: 0, ampVel: 0 };
const pointer = { x: 0.5, y: 0.5, hovering: false };
let textRect = null;
let textAmp = 0;

const VERT = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_map;
uniform float u_rotation;
out vec4 color;

const float PI = 3.141592653589793;

// Grayscale field that varies the dot density inside the silhouette, so the
// globe reads as sprayed paint rather than a uniform halftone.
float sprayField(vec2 uv) {
  float wave =
    sin(uv.x * 19.0 + uv.y * 8.0) * 0.18 +
    sin(uv.x * 7.0 - uv.y * 17.0) * 0.12 +
    cos((uv.x + uv.y) * 29.0) * 0.06;
  return clamp(0.52 + (uv.x - 0.5) * 0.42 + wave, 0.0, 1.0);
}

void main() {
  vec2 sourceUv = gl_FragCoord.xy / vec2(${GLOBE_W}.0, ${GLOBE_H}.0);
  float field = sprayField(sourceUv);

  vec2 point = (gl_FragCoord.xy - vec2(${SPHERE_CX}.0, ${SPHERE_CY}.0)) / ${SPHERE_R}.0;
  float radiusSquared = dot(point, point);
  float globeDensity = 0.0;

  if (radiusSquared <= 1.0) {
    float z = sqrt(1.0 - radiusSquared);
    float tilt = radians(${TILT_DEG}.0);
    vec3 globe = vec3(
      point.x,
      point.y * cos(tilt) + z * sin(tilt),
      -point.y * sin(tilt) + z * cos(tilt)
    );
    float longitude = atan(globe.x, globe.z) - u_rotation;
    float latitude = asin(clamp(globe.y, -1.0, 1.0));
    vec2 mapUv = vec2(fract(longitude / (2.0 * PI) + 0.5), 0.5 - latitude / PI);
    float land = texture(u_map, mapUv).r;

    // Ragged painted rim, same 5% band the Connect globe uses.
    float radius = sqrt(radiusSquared);
    float edgeShift = (field - 0.5) * 0.02;
    float paintEdge = 1.0 - smoothstep(0.95 + edgeShift, 1.0 + edgeShift, radius);
    globeDensity = mix(0.08, 1.0, land) * paintEdge;
  }

  float density = globeDensity * mix(0.45, 1.0, field);
  color = vec4(density, density, density, 1.0);
}`;

let geo = null;
let mapCanvas = null;
let gl = null;
let program = null;
let uRotationLoc = null;
let uRotation = null;
let view = null; // visible dither canvas
let vctx = null;
let sample = null; // downsampled density readback
let sctx = null;
let timer = 0;
let running = false;
let started = 0;
let raf = 0;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Rasterise the GeoJSON into a 1024x512 single-channel equirectangular map.
   The map is drawn three times horizontally so the seam stays populated when
   the sphere rotates past 180deg. */
function rasterizeMap() {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';

  const ring = (coords, offset) => {
    if (!coords.length) return;
    let prev = coords[0][0];
    let lon = prev;
    ctx.moveTo(((lon + 180) / 360) * MAP_W + offset, ((90 - coords[0][1]) / 180) * MAP_H);
    for (let i = 1; i < coords.length; i++) {
      for (lon = coords[i][0]; lon - prev > 180; ) lon -= 360;
      for (; lon - prev < -180; ) lon += 360;
      ctx.lineTo(((lon + 180) / 360) * MAP_W + offset, ((90 - coords[i][1]) / 180) * MAP_H);
      prev = lon;
    }
    ctx.closePath();
  };

  for (const feature of geo.features) {
    const g = feature.geometry;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const polygon of polygons) {
      for (const offset of [-MAP_W, 0, MAP_W]) {
        ctx.beginPath();
        for (const r of polygon) ring(r, offset);
        ctx.fill('evenodd');
      }
    }
  }
  return canvas;
}

function compile(gl2, type, source) {
  const shader = gl2.createShader(type);
  if (!shader) throw new Error('unable to create globe shader');
  gl2.shaderSource(shader, source);
  gl2.compileShader(shader);
  if (!gl2.getShaderParameter(shader, gl2.COMPILE_STATUS)) {
    const log = gl2.getShaderInfoLog(shader) || 'globe shader failed';
    gl2.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function initGL(canvas) {
  const gl2 = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    // The dither compositor pulls the density field back out with drawImage.
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!gl2) return null;

  const prog = gl2.createProgram();
  if (!prog) return null;
  gl2.attachShader(prog, compile(gl2, gl2.VERTEX_SHADER, VERT));
  gl2.attachShader(prog, compile(gl2, gl2.FRAGMENT_SHADER, FRAG));
  gl2.linkProgram(prog);
  if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS)) {
    const log = gl2.getProgramInfoLog(prog) || 'globe program failed';
    gl2.deleteProgram(prog);
    console.warn('[globe]', log);
    return null;
  }
  gl2.useProgram(prog);

  const buffer = gl2.createBuffer();
  gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer);
  gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl2.STATIC_DRAW);
  const loc = gl2.getAttribLocation(prog, 'a_position');
  gl2.enableVertexAttribArray(loc);
  gl2.vertexAttribPointer(loc, 2, gl2.FLOAT, false, 0, 0);

  const texture = gl2.createTexture();
  gl2.activeTexture(gl2.TEXTURE0);
  gl2.bindTexture(gl2.TEXTURE_2D, texture);
  gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, gl2.RED, gl2.UNSIGNED_BYTE, mapCanvas);
  gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR);
  gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
  gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.REPEAT);
  gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
  gl2.uniform1i(gl2.getUniformLocation(prog, 'u_map'), 0);

  return { gl: gl2, uRotationLoc: gl2.getUniformLocation(prog, 'u_rotation') };
}

/* Orthographic fallback for browsers without WebGL2. Same projection maths,
   drawn with canvas paths so the globe is never simply missing. */
function paintFallback(ctx, rotation) {
  const w = GLOBE_W;
  const h = GLOBE_H;
  const cx = SPHERE_CX;
  const cy = GLOBE_H - SPHERE_CY;
  const tilt = (TILT_DEG * Math.PI) / 180;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, SPHERE_R, 0, Math.PI * 2);
  ctx.clip();
  for (const feature of geo.features) {
    const g = feature.geometry;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const polygon of polygons) {
      for (const r of polygon) {
        ctx.beginPath();
        let started2 = false;
        for (let i = 0; i < r.length; i++) {
          const lon = ((r[i][0] * Math.PI) / 180) - rotation;
          const lat = (r[i][1] * Math.PI) / 180;
          const cl = Math.cos(lat);
          const x0 = Math.sin(lon) * cl;
          const y0 = Math.sin(lat);
          const z0 = Math.cos(lon) * cl;
          if (z0 < 0) {
            started2 = false;
            continue;
          }
          const x = x0 * Math.cos(tilt) + z0 * Math.sin(tilt);
          const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
          const px = cx + x * SPHERE_R;
          const py = cy - y * SPHERE_R;
          if (!started2) {
            ctx.moveTo(px, py);
            started2 = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* Map a dither cell in view space back into globe render-target space.
   The globe is cover-fitted and anchored to the top of the hero, so the
   sphere's crown stays where the Connect layout puts it. */
function viewToGlobe(viewW, viewH) {
  const scale = Math.max(viewW / GLOBE_W, viewH / GLOBE_H);
  return { scale, offX: (viewW - GLOBE_W * scale) / 2, offY: (viewH - GLOBE_H * scale) / 2 };
}

function resizeView() {
  if (!view || !vctx) return;
  const rect = view.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (view.width !== Math.floor(w * dpr) || view.height !== Math.floor(h * dpr)) {
    view.width = Math.floor(w * dpr);
    view.height = Math.floor(h * dpr);
  }
  vctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* CF's dither pipeline, ported from Hero.astro:
     1. snap the sample point to the centre of its pixel cell
     2. displace that UV by a per-cell hash, weighted by a Gaussian falloff
        around the cursor (mouseRepel) and around the headline (textDisperse)
     3. threshold with dither_pixelgrid: hard gaps, then step(0.42, v)
   The threshold is a flat cut, not an ordered matrix — that flat cut plus the
   cell gaps is what gives Connect its hard-edged pixel-art look. */

function hash21(x, y) {
  let px = (x * 123.34) % 1;
  let py = (y * 456.21) % 1;
  if (px < 0) px += 1;
  if (py < 0) py += 1;
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  let v = (px * py) % 1;
  return v < 0 ? v + 1 : v;
}

// Value noise + fbm, ported from the Connect hero shader. vnoise uses the same
// hash21 as the shader's hash(), so the erosion pattern matches the original.
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

function fbm(x, y) {
  let v = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise(px, py);
    px *= 2.05;
    py *= 2.05;
    amp *= 0.5;
  }
  return v;
}

// Bilinear read of the density field, matching GL_LINEAR on the map texture.
function sampleDensity(u, v) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const fx = u * densW - 0.5;
  const fy = v * densH - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = x0 < 0 ? 0 : x0 >= densW ? densW - 1 : x0;
  const xb = x0 + 1 < 0 ? 0 : x0 + 1 >= densW ? densW - 1 : x0 + 1;
  const ya = y0 < 0 ? 0 : y0 >= densH ? densH - 1 : y0;
  const yb = y0 + 1 < 0 ? 0 : y0 + 1 >= densH ? densH - 1 : y0 + 1;
  const a = density[ya * densW + xa];
  const b = density[ya * densW + xb];
  const c = density[yb * densW + xa];
  const d = density[yb * densW + xb];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

function paintDither() {
  if (!view || !vctx) return;
  const rect = view.getBoundingClientRect();
  const vw = view.width;
  const vh = view.height;
  if (vw < 1 || vh < 1) return;

  const sw = Math.ceil(GLOBE_W / SAMPLE_SCALE);
  const sh = Math.ceil(GLOBE_H / SAMPLE_SCALE);
  sctx.clearRect(0, 0, sw, sh);
  if (gl) sctx.drawImage(gl.canvas, 0, 0, sw, sh);
  else sctx.drawImage(fallbackCanvas, 0, 0, sw, sh);
  const raw = sctx.getImageData(0, 0, sw, sh).data;
  if (densW !== sw || densH !== sh) {
    densW = sw;
    densH = sh;
    density = new Float32Array(sw * sh);
  }
  for (let i = 0; i < density.length; i++) density[i] = raw[i * 4] / 255;

  const cssW = rect.width;
  const cssH = rect.height;
  const dpr = vw / cssW;
  const now = (performance.now() - started) / 1000; // shader time, in seconds
  // u_chunk is CF's device-pixel chunk; everything else is a multiple of it.
  const chunk = Math.max(1, Math.round(dpr));
  const cell = chunk * ditherPixel * dpr;
  const gap = chunk * ditherGap * dpr;
  const dot = Math.max(1, cell - gap);
  const { scale, offX, offY } = viewToGlobe(cssW, cssH);
  const aspect = vw / vh;

  // Mouse: normalised to the view, y flipped so it matches GL's bottom-up UV.
  const mx = cursor.x;
  const my = 1 - cursor.y;
  const amp = cursor.amp;
  const tr = textRect;
  const tamp = textAmp;

  vctx.clearRect(0, 0, vw, vh);
  vctx.fillStyle = globeInk;

  const cols = Math.ceil(vw / cell);
  const rows = Math.ceil(vh / cell);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      // Snap the sample to the cell centre, as the shader does.
      const px = (cx + 0.5) * cell;
      const py = (cy + 0.5) * cell;
      let u = px / vw;
      let vv = py / vh;

      if (amp >= 0.001) {
        const dx = (u - mx) * aspect;
        const dy = vv - my;
        const r = Math.sqrt(dx * dx + dy * dy);
        const infl = Math.exp(-r * 15) * amp;
        if (infl > 0.0005) {
          const jx = hash21(cx, cy) - 0.5;
          const jy = hash21(cx + 7.13, cy + 3.21) - 0.5;
          u += (jx / aspect) * 0.22 * infl;
          vv += jy * 0.22 * infl;
        }
      }
      if (tamp >= 0.001 && tr) {
        const dx = Math.max(tr[0] - px, px - tr[2]);
        const dy = Math.max(tr[1] - py, py - tr[3]);
        const r = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) / vh;
        const infl = Math.exp(-r * 18) * tamp;
        if (infl > 0.0005) {
          const jx = hash21(cx + 17.5, cy + 23.1) - 0.5;
          const jy = hash21(cx + 31.7, cy + 41.3) - 0.5;
          u += (jx / aspect) * 0.1 * infl;
          vv += jy * 0.1 * infl;
        }
      }

      // Displaced view UV -> globe render-target UV (cover fit, top-anchored).
      const gu = (u * cssW - offX) / scale / GLOBE_W;
      const gv = (vv * cssH - offY) / scale / GLOBE_H;
      if (gu < 0 || gu >= 1 || gv < 0 || gv >= 1) continue;

      // The Connect hero modulates the source density with fbm before the
      // pixel-grid threshold. This is what erodes the continents into the
      // sprayed pattern instead of solid blocks, so it is load-bearing.
      const n =
        fbm(u * 5 + now * 0.14, vv * 5 + now * 0.14) * 0.6 +
        fbm(u * 11 - now * 0.1, vv * 11 + now * 0.08) * 0.4;
      if (sampleDensity(gu, gv) * (0.2 + 0.75 * n) < DITHER_CUT) continue;
      vctx.fillRect(cx * cell, cy * cell, dot, dot);
    }
  }
  paintHtpMark(cssW, cssH, dpr);
}

function paintHtpMark(cssW, cssH, dpr) {
  if (!vctx) return;
  const scale = Math.min(cssW / 920, cssH / 420);
  const size = Math.max(22, Math.min(76, 62 * scale)) * dpr;
  const x = (cssW * dpr) / 2;
  const y = cssH * dpr * 0.58;
  vctx.save();
  vctx.textAlign = 'center';
  vctx.textBaseline = 'middle';
  vctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  vctx.fillStyle = 'rgba(106, 255, 159, 0.92)';
  vctx.shadowColor = 'rgba(62, 214, 120, 0.75)';
  vctx.shadowBlur = Math.max(4, size * 0.16);
  vctx.fillText('HTP', x, y);
  vctx.restore();
}

let fallbackCanvas = null;

/* Advance the cursor spring. Mirrors Hero.astro exactly: position eases at 0.2,
   the amplitude overshoots on the way in and decays faster on the way out. */
function stepCursor() {
  cursor.x += (pointer.x - cursor.x) * 0.2;
  cursor.y += (pointer.y - cursor.y) * 0.2;
  if (pointer.hovering) {
    cursor.ampVel += (1 - cursor.amp) * 0.2;
    cursor.ampVel *= 0.72;
    cursor.amp += cursor.ampVel;
  } else {
    cursor.ampVel = 0;
    cursor.amp += (0 - cursor.amp) * 0.35;
  }
}

/* The headline's box, in view-canvas pixels, bottom-up, for textDisperse. */
function measureText() {
  const heading = view.closest('[data-hero-root]')?.querySelector('.cf-hero__title');
  if (!heading) {
    textRect = null;
    textAmp = 0;
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const host = view.getBoundingClientRect();
  const box = heading.getBoundingClientRect();
  textRect = [
    (box.left - host.left) * dpr,
    (host.bottom - box.bottom) * dpr,
    (box.right - host.left) * dpr,
    (host.bottom - box.top) * dpr,
  ];
  textAmp = 1;
}

function render() {
  const elapsed = reduceMotion ? 0 : performance.now() - started;
  if (gl) {
    gl.uniform1f(uRotationLoc, (elapsed / ROTATION_PERIOD) * Math.PI * 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  } else {
    paintFallback(fallbackCtx, (elapsed / ROTATION_PERIOD) * Math.PI * 2);
  }
  paintDither();
  window.__globeFrame = (window.__globeFrame || 0) + 1;
}

let fallbackCtx = null;

function tick() {
  if (!running) return;
  stepCursor();
  measureText();
  render();
  timer = window.setTimeout(tick, FRAME_MS);
}

function start() {
  if (running) return;
  running = true;
  if (!started) started = performance.now();
  // Reduced motion pins rotation to 0, so the field never changes: paint the
  // single static frame and leave the GPU idle.
  if (reduceMotion) {
    measureText();
    render();
    return;
  }
  tick();
}

function stop() {
  running = false;
  window.clearTimeout(timer);
}

function observe(root) {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !document.hidden) start();
      else stop();
    },
    { rootMargin: '200px' }
  );
  io.observe(root);
}

async function init() {
  view = document.querySelector('[data-globe-view]');
  const source = document.querySelector('[data-globe-source]');
  if (!view || !source) return;

  view.width = 1;
  view.height = 1;
  vctx = view.getContext('2d');
  if (!vctx) return;

  fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = GLOBE_W;
  fallbackCanvas.height = GLOBE_H;
  fallbackCtx = fallbackCanvas.getContext('2d');

  sample = document.createElement('canvas');
  sample.width = Math.ceil(GLOBE_W / SAMPLE_SCALE);
  sample.height = Math.ceil(GLOBE_H / SAMPLE_SCALE);
  sctx = sample.getContext('2d', { willReadFrequently: true });
  if (!sctx) return;

  try {
    geo = (await import('/js/world-low.js')).default;
  } catch (err) {
    console.warn('[globe] geodata failed to load', err);
    return;
  }
  if (!geo || !geo.features) return;

  mapCanvas = rasterizeMap();
  if (!mapCanvas) return;

  source.width = GLOBE_W;
  source.height = GLOBE_H;
  try {
    const ctx = initGL(source);
    if (ctx) {
      gl = ctx.gl;
      uRotationLoc = ctx.uRotationLoc;
    } else {
      console.warn('[globe] WebGL2 unavailable, using the orthographic fallback');
    }
  } catch (err) {
    console.warn('[globe]', err);
    gl = null;
  }

  resizeView();

  // Live cursor, matching Connect: only on real hover-capable pointers.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    // The view canvas is pointer-events:none, so track on the hero box.
    const zone = view.closest('[data-hero-root]') || view.parentElement || view;
    const track = (e) => {
      const r = zone.getBoundingClientRect();
      pointer.x = (e.clientX - r.left) / r.width;
      pointer.y = 1 - (e.clientY - r.top) / r.height;
      pointer.hovering = true;
    };
    zone.addEventListener('pointerenter', track);
    zone.addEventListener('pointermove', track);
    zone.addEventListener('pointerleave', () => {
      pointer.hovering = false;
    });
  }

  // Same runtime knobs the Connect page exposes.
  window.addEventListener('pixel-size-change', (e) => {
    ditherPixel = e.detail;
    render();
  });
  window.addEventListener('pixel-gap-change', (e) => {
    ditherGap = e.detail;
    render();
  });
  window.addEventListener('globe-ink-change', (e) => {
    globeInk = e.detail;
    render();
  });

  window.addEventListener('resize', () => {
    resizeView();
    stepCursor();
    measureText();
    render();
  });

  const hero = document.querySelector('[data-hero-root]');
  if (hero) observe(hero);
  else start();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!hero || hero.getBoundingClientRect().bottom > -200) start();
  });

  started = performance.now();
  // Paint immediately so the globe is present at first frame.
  render();
  view.setAttribute('data-globe-ready', '');
  start();
  window.__globeReady = true;
  window.dispatchEvent(new CustomEvent('globe-ready', { detail: source }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
