"use strict";

/**
 * pi.htp.sh — Raspberry Pi 4B Dashboard
 * HTP midnight terminal theme with live stats
 */

const $ = (id) => document.getElementById(id);
const now = () => Math.floor(Date.now() / 1000);

// Color palette
const INK = {
  blue: "#2563eb",
  green: "#3ed678",
  greenBright: "#6aff9f",
  cyan: "#5ce1e6",
  amber: "#e8c547",
  red: "#ff5a6e",
  rule: "#e9ebef"
};

/* Formatting */
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
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ago`;
}

function fmtNum(value) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US");
}

function fmtRate(kbs) {
  if (!Number.isFinite(kbs)) return "—";
  if (kbs < 1) return "0 KB/s";
  if (kbs < 1024) return `${kbs < 10 ? kbs.toFixed(1) : kbs.toFixed(0)} KB/s`;
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

/* Sparkline */
function spark(el, series, opts = {}) {
  const W = 300, H = 60, PAD = 4;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (all.length < 2) {
    el.innerHTML = `<line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="${INK.rule}" stroke-width="1"/>`;
    return;
  }

  const baseline = (H - PAD).toFixed(1);
  const rule = `<line x1="${PAD}" y1="${baseline}" x2="${W - PAD}" y2="${baseline}" stroke="${INK.rule}" stroke-width="1"/>`;

  const lo = Number.isFinite(opts.min) ? opts.min : Math.min(...all);
  let hi = Number.isFinite(opts.max) ? opts.max : Math.max(...all);
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
    const last = points[points.length - 1][0].toFixed(1);
    const first = points[0][0].toFixed(1);
    markup += `<path d="${line} L${last} ${baseline} L${first} ${baseline} Z" fill="${s.fill}"/>`;
    markup += `<path d="${line}" fill="none" stroke="${s.stroke}" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  el.innerHTML = markup;
}

/* Render stats */
function renderStats(stats) {
  $("uptime").textContent = fmtDur(stats.uptime_s);
  $("booted").textContent = `booted ${fmtAgo(stats.boot_ts)}`;

  $("cpu").textContent = `${stats.cpu.pct}%`;
  $("cores").textContent = `${stats.cpu.cores} cores`;

  $("mem").textContent = `${stats.mem.used_mb} MB`;
  $("mem-free").textContent = `of ${stats.mem.total_mb} MB`;

  $("temp").textContent = stats.cpu.temp_c === null ? "—" : `${stats.cpu.temp_c}°C`;
  $("throttle-sub").textContent = stats.throttled.now
    ? "throttling now"
    : stats.throttled.ever
      ? "throttled before"
      : "no throttling";

  $("cpu-now").textContent = `${stats.cpu.pct}%`;
  $("net-now").textContent = `↓ ${fmtRate(stats.net.rx_kbps)}  ↑ ${fmtRate(stats.net.tx_kbps)}`;

  $("mem-bar-label").textContent = `${stats.mem.pct}% used`;
  $("mem-bar").style.width = `${Math.min(100, stats.mem.pct)}%`;

  $("disk-bar-label").textContent = `${stats.disk.used_pct}% used`;
  $("disk-bar").style.width = `${Math.min(100, stats.disk.used_pct)}%`;

  $("load").textContent = stats.cpu.load.map((n) => n.toFixed(2)).join(" / ");

  const iface = (stats.net && stats.net.iface) || "";
  const wireless = iface.indexOf("wl") === 0;
  $("wifi").textContent = stats.wifi ? `${stats.wifi.quality_pct}%` : wireless ? "—" : "n/a";
  $("net-total").textContent = `↓ ${fmtSize(stats.net.rx_total_mb)}  ↑ ${fmtSize(stats.net.tx_total_mb)}`;
  $("swap-used").textContent = stats.mem.swap_total_mb
    ? `${stats.mem.swap_used_mb} / ${stats.mem.swap_total_mb} MB`
    : "none";

  if (stats.procs) {
    $("procs").textContent = fmtNum(stats.procs.total);
  }

  if (stats.concurrent) {
    const live = Math.max(Number(stats.concurrent.now) || 0, 1);
    $("here-now").textContent = fmtNum(live);
  }

  // Sparklines
  const history = stats.history || {};
  const cpuHistory = history.cpu || [];
  const cpuPeak = cpuHistory.length ? Math.max(...cpuHistory) : 0;
  spark($("spark-cpu"), [{ values: cpuHistory, stroke: INK.cyan, fill: "rgba(92,225,230,.12)" }], {
    min: 0,
    max: Math.max(5, cpuPeak * 1.25)
  });
  spark($("spark-net"), [
    { values: history.rx || [], stroke: INK.cyan, fill: "rgba(92,225,230,.10)" },
    { values: history.tx || [], stroke: INK.green, fill: "rgba(62,214,120,.10)" }
  ]);

  renderServices(stats.services || []);
}

function renderServices(list) {
  const el = $("services");
  if (!list.length) {
    el.innerHTML = '<li class="service-item">no services</li>';
    return;
  }
  const t = now();
  el.innerHTML = list.map((s) => {
    const ok = s.state === "active";
    let when = "";
    if (s.since) {
      const up = t - s.since;
      when = up > 30 ? fmtDur(up) : ok ? "starting" : "stopped";
    } else {
      when = ok ? "running" : "stopped";
    }
    return `<li class="service-item">${s.name} — ${when}</li>`;
  }).join("");
}

/* Date math for availability/hits charts */
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

function drawBars(container, keys, valueOf, titleOf, maxValue, minVisible) {
  container.innerHTML = "";
  const gap = 4;
  const available = container.clientWidth || 300;
  const barMax = Math.max(16, Math.round(container.clientHeight || 60));
  const barWidth = Math.min(barMax, Math.max(14, Math.floor((available - (keys.length - 1) * gap) / Math.max(1, keys.length))));
  const total = keys.length * barWidth + (keys.length - 1) * gap;
  container.style.maxWidth = `${total}px`;
  
  keys.forEach((key) => {
    const value = valueOf(key);
    const wrapper = document.createElement("div");
    wrapper.className = "day";
    wrapper.title = titleOf(key, value);
    const bar = document.createElement("i");
    bar.style.height = (value ? Math.max((value / maxValue) * 100, minVisible) : 0).toFixed(1) + "%";
    wrapper.appendChild(bar);
    container.appendChild(wrapper);
  });
  return total;
}

function renderDays(data) {
  const days = data.days || {};
  const dataKeys = Object.keys(days).sort();
  if (!dataKeys.length) return;
  const today = data.today || dataKeys[dataKeys.length - 1];
  const keys = rangeKeys(windowStart(today, 14), today, 14);
  const overall = Math.min(100, Number(data.pct) || 0);
  $("avail-pct").textContent = `${overall.toFixed(1).replace(/\.0$/, "")}%`;
  if (data.first) $("avail-since").textContent = `since ${fmtDate(data.first)}`;
  drawBars($("days"), keys,
    (key) => {
      const entry = days[key];
      if (!entry) return 0;
      return Math.min(100, ((entry.samples || 0) / Math.max(1, entry.expected || 1)) * 100);
    },
    (key, value) => (days[key]
      ? `${fmtDate(key)}: ${value.toFixed(1)}%`
      : `${fmtDate(key)}: no data`),
    100,
    4
  );
  $("days-first").textContent = fmtDate(keys[0]);
  $("days-last").textContent = keys.length > 1
    ? (keys[keys.length - 1] === today ? "today" : fmtDate(keys[keys.length - 1]))
    : "";
}

function renderSpeed(data) {
  const r = data.last;
  const el = $("speed");
  if (!r || !r.ok) {
    el.innerHTML = '<span class="muted">no result</span>';
    return;
  }
  el.innerHTML =
    `<div class="speed-item"><b>${r.down_mbps}</b><small>Mbps down</small></div>` +
    `<div class="speed-item"><b>${r.up_mbps}</b><small>Mbps up</small></div>` +
    `<div class="speed-item"><b>${r.ping_ms}</b><small>ms latency</small></div>`;
}

function renderHits(data) {
  $("hits-total").textContent = fmtNum(data.views_total);
  $("hits-today").textContent = fmtNum(data.views_today);

  const days = data.days || {};
  const dataKeys = Object.keys(days).sort();
  if (!dataKeys.length) return;
  const today = data.today || dataKeys[dataKeys.length - 1];
  const keys = rangeKeys(windowStart(today, 14), today, 14);
  const max = Math.max(1, ...keys.map((k) => (days[k] && days[k].views) || 0));
  drawBars($("hits-days"), keys,
    (key) => (days[key] && days[key].views) || 0,
    (key, value) => (days[key]
      ? `${fmtDate(key)}: ${fmtNum(value)} views`
      : `${fmtDate(key)}: no views`),
    max,
    4
  );
  $("hits-first").textContent = fmtDate(keys[0]);
  $("hits-last").textContent = keys.length > 1
    ? (keys[keys.length - 1] === today ? "today" : fmtDate(keys[keys.length - 1]))
    : "";
}

/* Fetching */
async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

async function loadStats() {
  try {
    renderStats(await getJSON("/stats.json"));
  } catch (err) {
    console.warn("Stats load failed:", err);
  }
}

async function loadUptime() {
  try {
    renderDays(await getJSON("/uptime.json"));
  } catch (err) {
    console.warn("Uptime load failed:", err);
  }
}

async function loadSpeed() {
  try {
    renderSpeed(await getJSON("/speedtest.json"));
  } catch (err) {
    console.warn("Speed load failed:", err);
  }
}

async function loadHits() {
  try {
    renderHits(await getJSON("/hits.json"));
  } catch (err) {
    console.warn("Hits load failed:", err);
  }
}

/* Matrix rain effect */
(function matrixRain() {
  const c = document.getElementById("matrix");
  if (!c || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const ctx = c.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) return;

  const chars = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメヤユヨラリルレロワヲン";
  const charCount = chars.length;
  const charWidth = 16;

  let width = 0, height = 0, trails = new Float32Array(0), lastTime = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1);
    width = innerWidth | 0;
    height = innerHeight | 0;
    c.width = width * dpr | 0;
    c.height = height * dpr | 0;
    c.style.width = width + "px";
    c.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.max(1, width / charWidth | 0);
    trails = new Float32Array(cols);
    for (let i = 0; i < cols; i++) trails[i] = Math.random() * height / charWidth | 0;
  }

  function frame(time) {
    if (time - lastTime < 66) {
      requestAnimationFrame(frame);
      return;
    }
    lastTime = time;

    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0f0";
    ctx.font = "16px monospace";

    const cols = trails.length;
    for (let i = 0; i < cols; i++) {
      ctx.fillText(chars[Math.random() * charCount | 0], i * charWidth, trails[i] * charWidth);
      if (trails[i] * charWidth > height && Math.random() > 0.975) trails[i] = 0;
      else trails[i]++;
    }

    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
  addEventListener("resize", resize, { passive: true });
})();

/* Init */
document.body.classList.remove("no-js");
document.body.classList.add("js");

loadStats();
loadUptime();
loadSpeed();
loadHits();

setInterval(loadStats, 10_000);
setInterval(loadUptime, 60_000);
setInterval(loadSpeed, 60_000);
setInterval(loadHits, 60_000);
