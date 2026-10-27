/* money-e8.mjs — E8 ⇄ Bitcoin root-lattice panel for the /money page.
 *
 * Drives the mathematics from the PixelMan project (imported from its asset
 * directory at /money/pixelman/web/assets/e8-core.js — a byte-for-byte JS
 * port of the shared C core src/e8.c):
 *   240-root mosaic (pixel-fold colours),
 *   live root inspector (hex signature, fold, FNV-1a, coords),
 *   Bitcoin whitepaper digest projected into E8 root space,
 *   Akula lattice key k = HMAC-SHA512(salt, genesis + rootHex) mod n.
 */
import "/money/pixelman/web/assets/e8-core.js";

const E8 = globalThis.PixelManE8;
const $ = (id) => document.getElementById(id);
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;

let roots = null;
let selected = -1;

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
  return el;
}

function status(state, label) {
  const el = $("e8-lattice-status");
  if (!el) return;
  el.dataset.state = state;
  el.textContent = label;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function kpi(id, value, tone, label) {
  const el = $(id);
  if (!el) return;
  const div = document.createElement("div");
  div.className = "money-kpi";
  if (tone) div.dataset.tone = tone;
  const v = document.createElement("div");
  v.className = "v";
  v.textContent = value;
  const k = document.createElement("div");
  k.className = "k";
  k.textContent = label;
  div.append(v, k);
  el.append(div);
}

function buildKpis() {
  const row = $("e8-kpis");
  if (!row || !row.childElementCount) {
    kpi("e8-kpis", E8.NUM_ROOTS, "green", "roots · norm²=2");
    kpi("e8-kpis", 112, "cyan", "integer roots");
    kpi("e8-kpis", 128, "cyan", "half-integer roots");
    kpi("e8-kpis", "2", "yellow", "norm² (all)");
    kpi("e8-kpis", "240", "yellow", "kissing number");
    kpi("e8-kpis", "696729600", "yellow", "weyl group order");
  }
}

function buildMosaic() {
  const mosaic = $("e8-mosaic");
  if (!mosaic || !E8) return;
  if (mosaic.childElementCount) return; /* built once */
  roots = E8.generateRoots();

  const frag = document.createDocumentFragment();
  for (let i = 0; i < roots.length; i++) {
    const cell = document.createElement("div");
    cell.className = "e8-cell";
    if (REDUCE) cell.style.transition = "none";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `E8 root ${i} hex ${roots[i].hex}`);
    cell.style.backgroundColor = E8.pixelRgb(roots[i].hex);
    cell.dataset.id = String(i);
    cell.addEventListener("click", () => selectRoot(i));
    frag.appendChild(cell);
  }
  mosaic.appendChild(frag);
  status("ok", "240 roots computed");
}

function selectRoot(i) {
  const mosaic = $("e8-mosaic");
  if (!mosaic) return;
  const prev = mosaic.querySelector(".e8-cell.sel");
  if (prev) prev.classList.remove("sel");
  selected = i;
  const cell = mosaic.querySelector(`.e8-cell[data-id="${i}"]`);
  if (cell) cell.classList.add("sel");

  const r = roots[i];
  if (!r) return;
  text("e8-iRoot", r.id);
  text("e8-iType", r.is_half ? "half-integer" : "integer");
  text("e8-iHex", r.hex);
  const [rr, gg, bb] = E8.pixelFold(r.hex);
  text("e8-iFold",
    `#${[rr, gg, bb].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()} · rgb(${rr},${gg},${bb})`);
  text("e8-iHash", E8.fnv1aHex(E8.hexRootToBytes(r.hex)));
  text("e8-iCoords", Array.from(r.coords, String).join(" "));
  text("e8-iKey", "—");
  const btn = $("e8-btnDerive");
  if (btn) btn.disabled = false;
}

function onDeriveClick() {
  const btn = $("e8-btnDerive");
  if (btn) { btn.disabled = true; btn.textContent = "DERIVING…"; }
  deriveKey()
    .catch(() => text("e8-iKey", "derive failed"))
    .finally(() => {
      const b = $("e8-btnDerive");
      if (b) { b.disabled = false; b.textContent = "DERIVE AKULA KEY"; }
    });
}

/* k = HMAC-SHA512(salt, genesisAnchor + "\n" + rootHex) mod n — the exact
 * derivation from the PixelMan frontend (web/assets/secure.js). */
async function deriveKey() {
  const r = selected >= 0 ? roots[selected] : null;
  if (!r) return;
  const enc = new TextEncoder();
  const material = `${E8.GENESIS_ANCHOR}\n${r.hex}`;
  const hmacKey = await crypto.subtle.importKey(
    "raw", enc.encode(E8.DERIVATION_SALT),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(material));
  const k = E8.bytesToBigintBE(new Uint8Array(digest).subarray(0, 32)) % E8.SECP256K1_ORDER;
  text("e8-iKey", toHex(E8.bigintToBytes(k, 32)));
}

/* SHA-256(bitcoin.pdf) → 8D vector → nearest E8 root. */
async function projectPaper() {
  const btn = $("e8-btnProject");
  const result = $("e8-paper-result");
  const vList = $("e8-paper-v");
  if (!result || !vList || !E8) return;
  if (btn) btn.disabled = true;
  text("e8-paper-status", "hashing bitcoin.pdf…");
  try {
    const res = await fetch("/bitcoin.pdf", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
    const bytes = new Uint8Array(digest);
    const v = E8.projectDigest(bytes);
    const digHex = toHex(bytes);
    vList.innerHTML = "";
    for (let i = 0; i < v.length; i++) {
      const li = document.createElement("li");
      li.innerHTML = `<b>x${i}</b> ${v[i].toFixed(9)}`;
      vList.appendChild(li);
    }
    const near = E8.nearest(v, roots);
    text("e8-paper-status", "projected");
    result.textContent =
      `digest sha256:${digHex}\n` +
      `projected vector → nearest root ${near.id} [${roots[near.id].hex}] · distance ${near.distance.toFixed(9)}`;
    selectRoot(near.id);
  } catch (err) {
    text("e8-paper-status", "failed");
    result.textContent = `projection failed: ${err && err.message ? err.message : String(err)}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function onMosaicKeydown(e) {
  if (selected < 0) return;
  const cols = 24;
  const rows = Math.ceil(roots.length / cols);
  let i = selected;
  const dir = {
    ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols,
    Home: -i, End: rows * cols - 1 - i,
  }[e.key];
  if (dir === undefined) return;
  e.preventDefault();
  let next = i + dir;
  if (next < 0) next = 0;
  if (next >= roots.length) next = roots.length - 1;
  selectRoot(next);
}

export function startE8Panel() {
  if (!E8) {
    status("fail", "PIXELMAN CORE MISSING");
    return;
  }
  const panel = $("e8-lattice-root");
  if (!panel) return;

  buildKpis();
  buildMosaic();

  const deriveBtn = $("e8-btnDerive");
  if (deriveBtn) deriveBtn.addEventListener("click", onDeriveClick);
  const projectBtn = $("e8-btnProject");
  if (projectBtn) projectBtn.addEventListener("click", projectPaper);
  const mosaic = $("e8-mosaic");
  if (mosaic) mosaic.addEventListener("keydown", onMosaicKeydown);
}