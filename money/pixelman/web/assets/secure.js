"use strict";

/**
 * Secure Infrastructure Monitor
 * E8 Lattice & BTC Mempool Frontend Logic
 */

const $ = (id) => document.getElementById(id);

const API = {
  e8Roots: "/api/e8/roots",
  btc: "/api/btc/",
};

const SECP256K1_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const DERIVATION_SALT = "akula:e8:btc-genesis:v1";
const GENESIS_ANCHOR = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bigintToBytes(value, length) {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

function rootType(root) {
  const nonZero = (root.coords || []).filter((c) => c !== 0).length;
  return nonZero >= 8 ? "half-integer" : "integer";
}

/**
 * Utility for fetching JSON data with timeout and error handling
 */
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

/**
 * Terminal-like logger for the principle log
 */
function log(msg) {
  const term = $("termBody");
  if (!term) return;
  const entry = document.createElement("div");
  entry.style.marginBottom = "4px";
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  term.appendChild(entry);
  term.scrollTop = term.scrollHeight;
}

/**
 * Pixel fold — the site's one colour rule (README.md).
 * Bytes 0–1 average into R, 2–3 into G, 4–5 into B, each stretched to
 * the crisp 5-level set: (avg − 0x7e) * 64 → {00, 40, 80, C0, FF}.
 * Everything visible reads its colour from this same rule.
 */
function pixelFold(hex) {
  if (!hex || hex.length < 12) return [0, 0, 0];
  const pairAvg = (start) => {
    const a = parseInt(hex.substring(start, start + 2), 16);
    const b = parseInt(hex.substring(start + 2, start + 4), 16);
    return (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
  };
  const stretch = (avg) => Math.max(0, Math.min(255, (avg / 2 - 126) * 64));
  return [stretch(pairAvg(0)), stretch(pairAvg(4)), stretch(pairAvg(8))];
}

/**
 * Converts an encoded hex signature to its folded RGB color
 */
function hexToRgb(hex) {
  const [r, g, b] = pixelFold(hex);
  return `rgb(${r},${g},${b})`;
}

/**
 * E8 Root System Logic
 */
async function initE8() {
  log("Connecting to E8 server...");
  const data = await getJSON(API.e8Roots);
  let roots = data && Array.isArray(data.roots) ? data.roots : null;
  if (!roots) {
    if (window.PixelManE8) {
      log("E8 API offline — generating lattice from the static core (e8-core.js).");
      roots = window.PixelManE8.generateRoots().map((r) => ({
        id: r.id,
        hex: r.hex,
        coords: Array.prototype.slice.call(r.coords),
        type: r.is_half ? "half-integer" : "integer",
      }));
    } else {
      log("E8 server connection failed.");
      return;
    }
  } else {
    log("E8 root system synced.");
  }

  const mosaic = $("mosaic");
  if (!mosaic) return;
  mosaic.innerHTML = "";

  let intCount = 0;
  let halfCount = 0;

  roots.forEach((root) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.backgroundColor = hexToRgb(root.hex);

    root.type = rootType(root);
    if (root.type === "integer") intCount++;
    else if (root.type === "half-integer") halfCount++;

    cell.onclick = () => selectRoot(root, cell);
    mosaic.appendChild(cell);
  });

  $("stRoots").textContent = roots.length;
  $("stInt").textContent = intCount;
  $("stHalf").textContent = halfCount;
}

function selectRoot(root, cell) {
  document.querySelectorAll(".cell").forEach(c => c.classList.remove("sel"));
  cell.classList.add("sel");

  $("inspSel").textContent = `Root selected: ${root.id}`;
  $("iRoot").textContent = root.id;
  $("iType").textContent = root.type;
  $("iHex").textContent = root.hex;
  $("iCoords").textContent = root.coords.join(", ");
  $("iPxHex").textContent = pixelFold(root.hex)
    .map(v => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  const deriveBtn = $("btnDerive");
  if (deriveBtn) deriveBtn.disabled = false;

  const sig = $("iSig");
  if (!sig) return;
  sig.innerHTML = "";
  
  for (let i = 0; i < 8; i++) {
    const byteHex = root.hex.substring(i * 2, (i * 2) + 2);
    if (!byteHex) break;
    const val = parseInt(byteHex, 16) || 0;
    
    const swatch = document.createElement("div");
    swatch.style.width = "14px";
    swatch.style.height = "14px";
    swatch.style.border = "1px solid rgba(255,255,255,0.1)";
    
    const colors = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
      [0, 255, 255], [255, 0, 255], [128, 128, 128], [255, 255, 255]
    ];
    const base = colors[i];
    swatch.style.backgroundColor = `rgb(${Math.floor(val * base[0]/255)}, ${Math.floor(val * base[1]/255)}, ${Math.floor(val * base[2]/255)})`;
    
    sig.appendChild(swatch);
  }

  log(`Root [${root.id}] selected`);
}

/**
 * BTC Mempool Integration Logic
 */
function setBtcStats(globals) {
  const priceEl = $("btc-price");
  const heightEl = $("btc-height");
  const setValue = (el, text) => {
    if (!el) return;
    const b = el.querySelector("b");
    if (b) b.textContent = text;
  };

  if (!globals) {
    setValue(priceEl, "—");
    setValue(heightEl, "—");
    return;
  }

  const price = globals.price_usd;
  setValue(
    priceEl,
    typeof price === "number" && price > 0
      ? "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—"
  );

  const height = globals.block_height;
  setValue(
    heightEl,
    typeof height === "number" && height > 0 ? height.toLocaleString("en-US") : "—"
  );
}

async function updateMempool() {
  const status = $("mempoolStatus");
  if (status) status.textContent = "Syncing mempool...";

  const data = await getJSON(API.btc);
  if (!data) {
    if (status) status.textContent = "Mempool backend unavailable.";
    setBtcStats(null);
    return;
  }

  const grid = $("mempoolGrid");
  if (grid) {
    grid.innerHTML = "";

    const txs = data.txs || [];
    txs.forEach(tx => {
      const card = document.createElement("div");
      card.className = "tx-card";
      card.innerHTML = `
        <div style="color:var(--gold); font-weight:600; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${tx.id}</div>
        <div style="display:flex; justify-content:space-between;">
          <span>Fee: <b class="phosphor-text">${tx.fee}</b></span>
          <span>Size: <b>${tx.size} vB</b></span>
        </div>
      `;
      grid.appendChild(card);
    });

    if (status) status.textContent = `Mempool synced: ${txs.length} txs`;
  }

  setBtcStats(data.globals);
  log("Mempool synced");
}

/**
 * Akula Lattice Key Derivation
 * k = HMAC-SHA512(Salt, genesisAnchor + rootHex) mod n
 */
async function handleDerivation() {
  const hexEl = $("iHex");
  const addrEl = $("iAddress");
  const btn = $("btnDerive");
  const hex = hexEl && hexEl.textContent;

  if (!hex || hex === "—") {
    log("Select a lattice root to derive a key.");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "DERIVING...";
  }
  try {
    log(`Deriving lattice key from root ${hex}...`);

    const enc = new TextEncoder();
    const material = `${GENESIS_ANCHOR}\n${hex}`;
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(DERIVATION_SALT),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const digest = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(material));
    const scalarBytes = new Uint8Array(digest).subarray(0, 32);
    const k = BigInt("0x" + toHex(scalarBytes)) % SECP256K1_ORDER;
    const keyBytes = bigintToBytes(k, 32);

    if (addrEl) {
      addrEl.textContent = toHex(keyBytes);
      addrEl.title = "k = HMAC-SHA512(salt, anchor + rootHex) mod n";
    }
    log(`Derived key k = ${toHex(keyBytes).slice(0, 16)}… (32 bytes)`);
  } catch (err) {
    log("Key derivation failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    if (btn) {
      btn.textContent = "DERIVE KEY";
      btn.disabled = false;
    }
  }
}

/**
 * Matrix Rain — minimal, no external canvas library
 */
(function matrixRain() {
  const canvas = $("matrix");
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

/**
 * Application Initialization
 */
document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.remove("no-js");
  document.body.classList.add("js");

  // Initial data load
  try {
    await initE8();
  } catch (err) {
    console.warn("initE8 failed:", err);
  }
  try {
    await updateMempool();
  } catch (err) {
    console.warn("updateMempool failed:", err);
  }

  // Event listeners
  const refreshBtn = $("mempoolRefresh");
  if (refreshBtn) {
    refreshBtn.onclick = updateMempool;
  }

  const deriveBtn = $("btnDerive");
  if (deriveBtn) {
    deriveBtn.onclick = handleDerivation;
  }
});
