"use strict";

/**
 * Secure Infrastructure Monitor
 * OPSEC-hardened: no external calls, random timing, sanitized output
 */

// No external dependencies — everything self-contained
const $ = (id) => document.getElementById(id);
const now = () => Math.floor(Date.now() / 1000);

// Randomize all timing to prevent fingerprinting
const randDelay = (min, max) => Math.floor(Math.random() * (max - min)) + min;

// Randomize request intervals
const INTERVALS = {
  stats: randDelay(8000, 16000),
  uptime: randDelay(45000, 75000),
  speed: randDelay(55000, 90000),
  hits: randDelay(50000, 85000)
};

// Random jitter for fingerprint resistance
function jitterValue(value, percent = 5) {
  const offset = (Math.random() - 0.5) * 2 * (value * percent / 100);
  return Math.max(0, value + offset);
}

// Formatting (same as before)
function fmtDur(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtAgo(ts) {
  if (!ts) return "—";
  const s = Math.max(0, now() - Number(ts));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function fmtNum(value) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US");
}

function fmtRate(kbs) {
  if (!Number.isFinite(kbs)) return "—";
  if (kbs < 1) return "0 KB/s";
  if (kbs < 1024) return `${kbs.toFixed(1)} KB/s`;
  return `${(kbs / 1024).toFixed(1)} MB/s`;
}

function fmtSize(mb) {
  if (!Number.isFinite(mb)) return "—";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function fmtDate(iso) {
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(parts[1]) - 1]} ${Number(parts[2])}`;
}

// Sparkline (no external libraries)
function spark(el, series, opts = {}) {
  if (!el) return;
  const W = 300, H = 60, PAD = 4;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (all.length < 2) return;

  const baseline = (H - PAD).toFixed(1);
  const rule = `<line x1="${PAD}" y1="${baseline}" x2="${W - PAD}" y2="${baseline}" stroke="rgba(122,154,136,0.2)" stroke-width="1"/>`;
  const lo = opts.min !== undefined ? opts.min : Math.min(...all);
  let hi = opts.max !== undefined ? opts.max : Math.max(...all);
  if (!(hi > lo)) hi = lo + 1;

  let markup = rule;
  for (const s of series) {
    const points = [];
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = PAD + i * (W - 2 * PAD) / Math.max(s.values.length - 1, 1);
      const y = H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
      points.push([x, y]);
    });
    if (points.length < 2) return;
    const line = points.map((p, i) => (i ? "L" : "M") + `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const last = points[points.length - 1][0];
    const first = points[0][0];
    markup += `<path d="${line} L${last} ${baseline} L${first} ${baseline} Z" fill="${s.fill}"/>`;
    markup += `<path d="${line}" fill="none" stroke="${s.stroke}" stroke-width="1.5"/>`;
  }
  el.innerHTML = markup;
}

// Rendering
function renderStats(stats) {
  if (!stats) return;
  
  // Randomize slight values for fingerprint evasion
  const cpu = jitterValue(stats.cpu.pct, 3);
  const mem = jitterValue(stats.mem.pct, 3);
  
  $("uptime").textContent = fmtDur(stats.uptime_s);
  $("booted").textContent = `${fmtAgo(stats.boot_ts)}`;
  $("cpu").textContent = `${cpu.toFixed(1)}%`;
  $("cores").textContent = `${stats.cpu.cores} cores`;
  $("mem").textContent = `${stats.mem.used_mb} MB`;
  $("mem-free").textContent = `/ ${stats.mem.total_mb} MB`;
  $("temp").textContent = stats.cpu.temp_c === null ? "—" : `${stats.cpu.temp_c}°C`;
  $("throttle-sub").textContent = stats.throttled.now ? "active" : "nominal";
  $("cpu-now").textContent = `${cpu.toFixed(1)}%`;
  $("net-now").textContent = `⬇ ${fmtRate(stats.net.rx_kbps)} ⬆ ${fmtRate(stats.net.tx_kbps)}`;
  $("mem-bar-label").textContent = `${mem.toFixed(1)}%`;
  $("mem-bar").style.width = `${Math.min(100, mem)}%`;
  $("disk-bar-label").textContent = `${stats.disk.used_pct}%`;
  $("disk-bar").style.width = `${Math.min(100, stats.disk.used_pct)}%`;
  $("load").textContent = stats.cpu.load.slice(0, 2).map((n) => n.toFixed(2)).join(" / ");
  $("wifi").textContent = stats.wifi ? `${stats.wifi.quality_pct}%` : "—";
  $("net-total").textContent = `↓${fmtSize(stats.net.rx_total_mb)} ↑${fmtSize(stats.net.tx_total_mb)}`;
  $("swap-used").textContent = stats.mem.swap_total_mb ? `${stats.mem.swap_used_mb}M` : "—";
  if (stats.procs) $("procs").textContent = fmtNum(stats.procs.total);
  if (stats.concurrent) $("here-now").textContent = fmtNum(stats.concurrent.now || 0);

  // Sparklines
  const history = stats.history || {};
  const cpuData = (history.cpu || []).slice(-60);
  const cpuMax = Math.max(...cpuData, 10);
  spark($("spark-cpu"), [{ values: cpuData, stroke: "#5ce1e6", fill: "rgba(92,225,230,.1)" }], { min: 0, max: cpuMax * 1.1 });
  
  const rxData = (history.rx || []).slice(-60);
  const txData = (history.tx || []).slice(-60);
  const netMax = Math.max(...rxData, ...txData, 1);
  spark($("spark-net"), [
    { values: rxData, stroke: "#5ce1e6", fill: "rgba(92,225,230,.08)" },
    { values: txData, stroke: "#3ed678", fill: "rgba(62,214,120,.08)" }
  ], { min: 0, max: netMax * 1.1 });

  renderServices(stats.services || []);
}

function renderServices(list) {
  const el = $("services");
  if (!list.length || !el) return;
  const t = now();
  el.innerHTML = list.slice(0, 6).map((s) => {
    const ok = s.state === "active";
    const when = ok ? "active" : "idle";
    return `<li class="service-item">${s.name.substring(0, 20)} – ${when}</li>`;
  }).join("");
}

// Date math
function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function windowStart(todayIso, days) {
  const parts = String(todayIso || "").split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return todayIso;
  const cursor = new Date(parts[0], parts[1] - 1, parts[2]);
  cursor.setDate(cursor.getDate() - (days - 1));
  return isoOf(cursor);
}

function rangeKeys(fromIso, toIso, limit) {
  const from = String(fromIso || toIso || "").split("-").map(Number);
  const to = String(toIso || fromIso || "").split("-").map(Number);
  if (from.length !== 3 || to.length !== 3 || !from[0] || !to[0]) return [];
  const start = new Date(from[0], from[1] - 1, from[2]);
  const cursor = new Date(to[0], to[1] - 1, to[2]);
  const keys = [];
  while (cursor >= start && keys.length < limit) {
    keys.push(isoOf(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return keys.reverse();
}

function drawBars(container, keys, valueOf, maxValue) {
  if (!container) return;
  container.innerHTML = "";
  const gap = 4;
  const available = Math.max(200, container.clientWidth || 300);
  const barWidth = Math.max(8, Math.floor((available - (keys.length - 1) * gap) / Math.max(1, keys.length)));
  
  keys.forEach((key) => {
    const value = valueOf(key);
    const wrapper = document.createElement("div");
    wrapper.className = "day";
    const bar = document.createElement("i");
    bar.style.height = (value ? Math.max((value / maxValue) * 100, 5) : 0).toFixed(1) + "%";
    wrapper.appendChild(bar);
    container.appendChild(wrapper);
  });
}

function renderDays(data) {
  if (!data || !data.days) return;
  const days = data.days || {};
  const dataKeys = Object.keys(days).sort();
  if (!dataKeys.length) return;
  const today = data.today || dataKeys[dataKeys.length - 1];
  const keys = rangeKeys(windowStart(today, 14), today, 14);
  const overall = Math.min(100, Number(data.pct) || 0);
  const avail = $(("avail-pct"));
  if (avail) avail.textContent = `${overall.toFixed(0)}%`;
  const since = $("avail-since");
  if (since && data.first) since.textContent = `${fmtDate(data.first)}`;
  
  drawBars($("days"), keys, (key) => {
    const entry = days[key];
    return entry ? Math.min(100, ((entry.samples || 0) / Math.max(1, entry.expected || 1)) * 100) : 0;
  }, 100);
  
  const dFirst = $("days-first");
  const dLast = $("days-last");
  if (dFirst) dFirst.textContent = fmtDate(keys[0]);
  if (dLast) dLast.textContent = keys[keys.length - 1] === today ? "today" : fmtDate(keys[keys.length - 1]);
}

function renderSpeed(data) {
  if (!data || !data.last) return;
  const r = data.last;
  const el = $("speed");
  if (!el) return;
  if (!r.ok) {
    el.innerHTML = '<span class="muted">—</span>';
    return;
  }
  el.innerHTML =
    `<div class="speed-item"><b>${r.down_mbps}</b><small>down</small></div>` +
    `<div class="speed-item"><b>${r.up_mbps}</b><small>up</small></div>` +
    `<div class="speed-item"><b>${r.ping_ms}</b><small>latency</small></div>`;
}

function renderHits(data) {
  if (!data) return;
  $("hits-total").textContent = fmtNum(data.views_total);
  $("hits-today").textContent = fmtNum(data.views_today);
  
  const days = data.days || {};
  const dataKeys = Object.keys(days).sort();
  if (!dataKeys.length) return;
  const today = data.today || dataKeys[dataKeys.length - 1];
  const keys = rangeKeys(windowStart(today, 14), today, 14);
  const max = Math.max(1, ...keys.map((k) => (days[k] && days[k].views) || 0));
  drawBars($("hits-days"), keys, (key) => (days[key] && days[key].views) || 0, max);
  
  const hFirst = $("hits-first");
  const hLast = $("hits-last");
  if (hFirst) hFirst.textContent = fmtDate(keys[0]);
  if (hLast) hLast.textContent = keys[keys.length - 1] === today ? "today" : fmtDate(keys[keys.length - 1]);
}

/* Fetch with timeout and error handling */
async function getJSON(path, timeout = 5000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(path, { 
      cache: "no-store",
      signal: controller.signal,
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Fetch failed: ${path}`);
    return null;
  }
}

async function loadStats() {
  const data = await getJSON("/stats.json");
  if (data) renderStats(data);
  setTimeout(loadStats, INTERVALS.stats);
}

async function loadUptime() {
  const data = await getJSON("/uptime.json");
  if (data) renderDays(data);
  setTimeout(loadUptime, INTERVALS.uptime);
}

async function loadSpeed() {
  const data = await getJSON("/speedtest.json");
  if (data) renderSpeed(data);
  setTimeout(loadSpeed, INTERVALS.speed);
}

async function loadHits() {
  const data = await getJSON("/hits.json");
  if (data) renderHits(data);
  setTimeout(loadHits, INTERVALS.hits);
}

/* Matrix Rain — minimal, no external canvas library */
(function matrixRain() {
  const canvas = document.getElementById("matrix");
  if (!canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const chars = "01█▓▒░";
  const charCount = chars.length;
  const charWidth = 14;
  let width = 0, height = 0, trails = new Float32Array(0), lastTime = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1);
    width = innerWidth;
    height = innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.max(1, width / charWidth | 0);
    trails = new Float32Array(cols);
    for (let i = 0; i < cols; i++) trails[i] = Math.random() * height / charWidth | 0;
  }

  function frame(time) {
    if (time - lastTime < 100) {
      requestAnimationFrame(frame);
      return;
    }
    lastTime = time;
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#3ed678";
    ctx.font = "14px monospace";
    
    for (let i = 0; i < trails.length; i++) {
      ctx.fillText(chars[Math.random() * charCount | 0], i * charWidth, trails[i] * charWidth);
      if (trails[i] * charWidth > height && Math.random() > 0.98) trails[i] = 0;
      else trails[i]++;
    }
    requestAnimationFrame(frame);
  }

  resize();
  addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(frame);
})();

/* Init */
document.body.classList.remove("no-js");
document.body.classList.add("js");

// Stagger initial loads with random delays
setTimeout(loadStats, randDelay(500, 1500));
setTimeout(loadUptime, randDelay(800, 2000));
setTimeout(loadSpeed, randDelay(1000, 2500));
setTimeout(loadHits, randDelay(1200, 3000));
