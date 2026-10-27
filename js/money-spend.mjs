const REPORT = "/api/money/spend-control";
const WALLET = "/api/money/wallet";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function tone(value) {
  if (value === "PASS" || value === true) return "ok";
  if (value === "NOT_PROVEN" || value === "KEY_ABSENT" || value === "watchonly") return "warn";
  if (value === "FAIL" || value === false) return "err";
  return "";
}

function pill(value) {
  const t = tone(value);
  return `<span class="btc-pill"${t ? ` data-tone="${t}"` : ""}>${esc(value)}</span>`;
}

function row(label, value, raw) {
  const shown = raw ? value : esc(value);
  return `<div class="btc-method" data-tone="${tone(value)}"><span class="btc-method-id">${esc(label)}</span><span></span><span>${shown}</span></div>`;
}

function chainRows(label, chain) {
  if (!chain) return "";
  const bits = [
    ["status", chain.status],
    ["source", chain.source],
    ["tx_count", chain.tx_count],
    ["funded_sats", chain.funded_txo_sum],
    ["spent_sats", chain.spent_txo_sum],
    ["mempool_tx_count", chain.mempool_tx_count],
  ].filter(([, v]) => v !== undefined && v !== null);
  return bits.map(([k, v]) => row(`${label} ${k}`, v)).join("");
}

function explorers(address) {
  if (!address) return "";
  const enc = encodeURIComponent(address);
  return `<div class="links-inline"><a href="https://blockstream.info/address/${enc}" rel="noopener noreferrer" target="_blank">blockstream</a><a href="https://mempool.space/address/${enc}" rel="noopener noreferrer" target="_blank">mempool</a></div>`;
}

async function readJson(url, options) {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json", ...(options?.headers || {}) },
    method: options?.method || "GET",
    body: options?.body,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return { status: res.status, data };
}

function resultBlock(status, data) {
  const mark = data.spend_control || data.accepted || data.error || status;
  return `<p>${pill(data.spend_control || (data.accepted === true ? "PASS" : data.accepted === false ? "FAIL" : status))} <span class="dim">HTTP ${esc(status)}</span></p>
    <pre class="money-json">${esc(JSON.stringify(data, null, 2))}</pre>`;
}

function renderReport(doc) {
  const wallet = doc.wallet || {};
  const legacy = wallet.legacy_signmessage || {};
  const primary = wallet.primary || {};
  const genesis = doc.genesis || {};
  const sigs = Array.isArray(legacy.signatures) ? legacy.signatures : [];
  const sigButtons = sigs.map((sig, i) => `
    <div class="btc-method" data-tone="${tone(sig.result)}">
      <span class="btc-method-id">${esc(sig.name)}</span>
      <span>${pill(sig.result)}</span>
      <span>recovered <code>${esc(sig.recovered_address)}</code>
        <button class="e8-btn" type="button" data-sig="${i}">Verify this signature</button>
      </span>
    </div>`).join("");
  return `
    <div class="btc-methods">
      ${row("schema", doc.schema)}
      ${row("generated", doc.generated_utc)}
      ${row("wallet", wallet.name)}
      ${row("import", wallet.import_mode)}
      ${row("private keys", wallet.private_keys_present ? "present" : "absent")}
      ${row("legacy", legacy.address)}
      ${row("legacy spend", legacy.spend_control)}
      ${row("primary", primary.address)}
      ${row("primary spend", primary.spend_control)}
      ${row("genesis", genesis.address)}
      ${row("genesis imported", genesis.imported ? "yes" : "no")}
      ${row("genesis spend", genesis.spend_control)}
      ${row("keybase claim", genesis.keybase_claim_crypto)}
      ${chainRows("primary", primary.chain)}
      ${chainRows("legacy", legacy.chain)}
      ${chainRows("genesis", genesis.chain)}
    </div>
    ${sigButtons}
    <p class="dim p-xs">${esc(genesis.note || "")}</p>
    <p class="dim p-xs"><code>${esc(wallet.descriptor || "")}</code></p>
    ${explorers(legacy.address)}
    ${explorers(primary.address)}
    <details class="money-raw"><summary>Spend-control JSON</summary><pre class="money-json">${esc(JSON.stringify(doc, null, 2))}</pre></details>`;
}

function renderWallet(doc) {
  const addr = doc.addresses || {};
  return `
    <div class="btc-methods">
      ${row("wallet endpoint", doc.schema)}
      ${row("mode", doc.mode)}
      ${row("private keys", doc.private_keys_present ? "present" : "absent")}
      ${row("keys accepted", doc.private_keys_accepted_by_api ? "yes" : "no")}
      ${row("genesis imported", doc.genesis_imported ? "yes" : "no")}
      ${row("primary address", addr.primary)}
      ${row("legacy address", addr.legacy_signmessage)}
      ${row("taproot", addr.taproot_tracked_only)}
      ${row("change", addr.change_tracked_only)}
      ${row("bitcoin core", doc.bitcoin_core?.method)}
    </div>
    <p class="dim p-xs">${esc(doc.note || "")}</p>
    <details class="money-raw"><summary>Wallet JSON</summary><pre class="money-json">${esc(JSON.stringify(doc, null, 2))}</pre></details>`;
}

export async function bootSpendControl(rootSel = "#spend-api-root") {
  const root = document.querySelector(rootSel);
  if (!root) return;
  const status = root.querySelector("#spend-api-status");
  const out = root.querySelector("#spend-api-out");
  const walletOut = root.querySelector("#wallet-doc");
  const verifyForm = root.querySelector("#spend-verify-form");
  const importForm = root.querySelector("#wallet-import-form");
  const verifyResult = root.querySelector("#spend-verify-result");
  const importResult = root.querySelector("#wallet-import-result");
  let report = null;
  let wallet = null;

  const set = (state, text) => {
    if (!status) return;
    status.dataset.state = state;
    status.textContent = text;
  };

  function fillSignature(sig) {
    if (!verifyForm || !sig) return;
    verifyForm.address.value = sig.address || "";
    verifyForm.message.value = sig.message || "";
    verifyForm.signature.value = sig.signature || "";
  }

  function fillDescriptor(value) {
    if (!importForm) return;
    importForm.descriptor.value = value || "";
  }

  async function load() {
    set("scan", "READING API…");
    const [spend, imported] = await Promise.all([
      readJson(REPORT),
      readJson(WALLET),
    ]);
    if (!spend.data?.wallet) throw new Error(spend.data?.error || `${REPORT} HTTP ${spend.status}`);
    report = spend.data;
    wallet = imported.data;
    const legacy = report.wallet.legacy_signmessage;
    const primary = report.wallet.primary;
    const genesis = report.genesis;
    const sigs = legacy?.signatures || [];
    const ok = sigs.length > 0
      && sigs.every((row) => row.result === "PASS")
      && legacy.spend_control === "PASS"
      && primary?.spend_control === "KEY_ABSENT"
      && report.wallet.private_keys_present === false
      && genesis?.imported === false
      && genesis?.spend_control === "NOT_PROVEN"
      && wallet?.mode === "watchonly";
    set(ok ? "ok" : "fail", ok ? "SIGNATURE PASS · WATCH-ONLY" : "SPEND CONTROL CHECK");
    if (out) out.innerHTML = renderReport(report);
    if (walletOut && wallet?.schema) walletOut.innerHTML = renderWallet(wallet);
    if (verifyForm && !verifyForm.address.value) fillSignature(sigs[0]);
    if (importForm && !importForm.descriptor.value) fillDescriptor(wallet?.descriptor || report.wallet.descriptor);
  }

  if (out && out.dataset.bound !== "1") {
    out.dataset.bound = "1";
    out.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sig]");
      if (!button || !report) return;
      const sig = report.wallet?.legacy_signmessage?.signatures?.[Number(button.dataset.sig)];
      fillSignature(sig);
      verifyForm?.requestSubmit();
    });
  }

  if (verifyForm && verifyForm.dataset.bound !== "1") {
    verifyForm.dataset.bound = "1";
    verifyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (verifyResult) verifyResult.innerHTML = `<p class="dim">POST ${esc(REPORT)}</p>`;
      const { status, data } = await readJson(REPORT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: verifyForm.address.value.trim(),
          message: verifyForm.message.value,
          signature: verifyForm.signature.value.trim(),
        }),
      });
      if (verifyResult) verifyResult.innerHTML = resultBlock(status, data);
    });
  }

  if (importForm && importForm.dataset.bound !== "1") {
    importForm.dataset.bound = "1";
    importForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (importResult) importResult.innerHTML = `<p class="dim">POST ${esc(WALLET)}/import</p>`;
      const { status, data } = await readJson(`${WALLET}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ descriptor: importForm.descriptor.value.trim() }),
      });
      if (importResult) importResult.innerHTML = resultBlock(status, data);
    });
  }

  root.querySelector("#spend-load-published")?.addEventListener("click", () => {
    fillSignature(report?.wallet?.legacy_signmessage?.signatures?.[0]);
  });
  root.querySelector("#wallet-load-published")?.addEventListener("click", () => {
    fillDescriptor(wallet?.descriptor || report?.wallet?.descriptor);
  });
  root.querySelector("#spend-refresh")?.addEventListener("click", () => {
    load().catch((err) => {
      set("fail", "SPEND API FAIL");
      if (out) out.textContent = err.message || String(err);
    });
  });

  try {
    await load();
  } catch (err) {
    set("fail", "SPEND API FAIL");
    if (out) out.textContent = err.message || String(err);
  }
}
