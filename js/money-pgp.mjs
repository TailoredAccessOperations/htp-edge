const ATTEST_PATH = "/btc/PGP-ATTESTATION.json";
const PUB_PATH = "/btc/easter47-pgp.asc";
const SIG_PATH = "/btc/PGP-ATTESTATION.json.asc";
const KEYBASE_PUB = "https://keybase.io/easter47/pgp_keys.asc";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(bytes) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function armorBody(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const body = [];
  let on = false;
  for (const line of lines) {
    if (line.startsWith("-----BEGIN ")) {
      on = true;
      continue;
    }
    if (line.startsWith("-----END ")) break;
    if (!on || !line || line.includes(": ")) continue;
    body.push(line.trim());
  }
  return body.join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function bindPgpControls(root, rootSel) {
  const filter = root.querySelector("#pgp-file-filter");
  const count = root.querySelector("#pgp-filter-count");
  const apply = () => {
    const q = (filter?.value || "").trim().toLowerCase();
    const rows = [...root.querySelectorAll("#pgp-file-table tbody tr")];
    let shown = 0;
    for (const tr of rows) {
      const hit = !q || tr.textContent.toLowerCase().includes(q);
      tr.hidden = !hit;
      if (hit) shown += 1;
    }
    if (count) count.textContent = q ? `${shown} of ${rows.length}` : `${rows.length} files`;
  };
  if (filter && filter.dataset.bound !== "1") {
    filter.dataset.bound = "1";
    filter.addEventListener("input", apply);
  }
  apply();
  const refresh = root.querySelector("#pgp-refresh");
  if (refresh && refresh.dataset.bound !== "1") {
    refresh.dataset.bound = "1";
    refresh.addEventListener("click", () => {
      const status = root.querySelector("#pgp-verify-status");
      if (status) {
        status.dataset.state = "scan";
        status.textContent = "VERIFYING…";
      }
      bootPgpVerification(rootSel);
    });
  }
}

export async function bootPgpVerification(rootSel = "#pgp-verify-root") {
  const root = document.querySelector(rootSel);
  if (!root) return;
  const status = root.querySelector("#pgp-verify-status");
  const out = root.querySelector("#pgp-verify-out");
  const set = (state, text) => {
    if (!status) return;
    status.dataset.state = state;
    status.textContent = text;
  };

  try {
    const attRes = await fetch(`${ATTEST_PATH}?cb=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    if (!attRes.ok) throw new Error(`${ATTEST_PATH} HTTP ${attRes.status}`);
    const attRaw = new Uint8Array(await attRes.arrayBuffer());
    const att = JSON.parse(new TextDecoder().decode(attRaw));
    const attHash = await sha256(attRaw);

    const [pubRes, sigRes, kbRes] = await Promise.all([
      fetch(`${PUB_PATH}?cb=${Date.now()}`, { cache: "no-store", credentials: "same-origin" }),
      fetch(`${SIG_PATH}?cb=${Date.now()}`, { cache: "no-store", credentials: "same-origin" }),
      fetch(KEYBASE_PUB, { cache: "no-store", mode: "cors" }).catch(() => null),
    ]);
    if (!pubRes.ok) throw new Error(`${PUB_PATH} HTTP ${pubRes.status}`);
    if (!sigRes.ok) throw new Error(`${SIG_PATH} HTTP ${sigRes.status}`);
    const pub = await pubRes.text();
    const sig = await sigRes.text();
    let keyMatch = "SKIP";
    if (kbRes && kbRes.ok) {
      const remote = await kbRes.text();
      keyMatch = armorBody(pub) === armorBody(remote) ? "PASS" : "FAIL";
    }

    const files = Array.isArray(att.files) ? att.files : [];
    const rows = [];
    let hashFail = 0;
    for (const f of files) {
      try {
        const res = await fetch(`${f.path}?cb=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const got = await sha256(bytes);
        const ok = got === f.sha256 && bytes.length === f.bytes;
        if (!ok) hashFail += 1;
        rows.push({ path: f.path, ok, bytes: bytes.length, sha256: got });
      } catch (err) {
        hashFail += 1;
        rows.push({ path: f.path, ok: false, bytes: 0, sha256: err.message || "error" });
      }
    }

    const wallet = att.bitcoin?.operator_wallet?.spend_control || "—";
    const genesis = att.bitcoin?.genesis_coinbase?.spend_control || "—";
    const fp = att.signer?.pgp_fingerprint || "";
    const hashesOk = hashFail === 0 && rows.length > 0;
    const ok = hashesOk && keyMatch !== "FAIL" && wallet === "PASS" && genesis === "NOT_PROVEN";
    set(ok ? "ok" : "fail", ok ? "PGP MANIFEST PASS" : "PGP MANIFEST CHECK");

    const fileRows = rows.map((r) =>
      `<tr><td><code>${esc(r.path)}</code></td><td>${r.ok ? "PASS" : "FAIL"}</td><td>${esc(r.bytes)}</td><td><code>${esc(String(r.sha256).slice(0, 24))}</code></td></tr>`
    ).join("");

    out.innerHTML = `
      <p><span class="k">signer</span> <strong>${esc(att.signer?.keybase_username)}</strong>
        · <code>${esc(fp)}</code></p>
      <p class="dim p-sm">${esc(att.statement || "")}</p>
      <ul class="btc-methods">
        <li>file hashes ${hashesOk ? "PASS" : "FAIL"} (${rows.length - hashFail}/${rows.length})</li>
        <li>attestation sha256 <code>${esc(attHash)}</code></li>
        <li>keybase.io public key ${esc(keyMatch)}</li>
        <li>detached signature loaded ${sig.includes("BEGIN PGP SIGNATURE") ? "PASS" : "FAIL"}</li>
        <li>operator wallet spend control ${esc(wallet)} · ${esc(att.bitcoin?.operator_wallet?.legacy_p2pkh || "")}</li>
        <li>genesis coinbase spend control ${esc(genesis)} · ${esc(att.bitcoin?.genesis_coinbase?.address || "")}</li>
        <li>keybase claim crypto ${esc(att.bitcoin?.genesis_coinbase?.keybase_claim_crypto || "—")}</li>
      </ul>
      <h3 class="btc-subhead">Signed file manifest</h3>
      <table id="pgp-file-table">
        <thead><tr><th>path</th><th>result</th><th>bytes</th><th>sha256</th></tr></thead>
        <tbody>${fileRows}</tbody>
      </table>
      <p class="dim p-xs">The OpenPGP signature covers <code>${esc(ATTEST_PATH)}</code> only.
        Check it with <code>gpg --verify PGP-ATTESTATION.json.asc PGP-ATTESTATION.json</code>
        against fingerprint <code>${esc(fp)}</code>.
        A Keybase claim and this PGP key do not prove the genesis coinbase private key.</p>
      <div class="links-inline">
        <a href="${esc(PUB_PATH)}">easter47-pgp.asc</a>
        <a href="${esc(ATTEST_PATH)}">PGP-ATTESTATION.json</a>
        <a href="${esc(SIG_PATH)}">PGP-ATTESTATION.json.asc</a>
        <a href="https://keybase.io/easter47" rel="noopener noreferrer" target="_blank">keybase.io/easter47</a>
      </div>`;
    bindPgpControls(root, rootSel);
  } catch (err) {
    set("fail", "PGP VERIFY FAIL");
    if (out) out.textContent = err.message || String(err);
  }
}
