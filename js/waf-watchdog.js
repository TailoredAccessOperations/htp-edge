/**
 * htp WAF watchdog — hidden page (/waf). Polls /api/waf/status and runs the
 * /api/waf/self-test probe. External file on purpose: the site CSP has no
 * 'unsafe-inline', only 'self' for scripts.
 */
const el = (id) => document.getElementById(id);

async function loadStatus() {
  try {
    const res = await fetch('/api/waf/status');
    const s = await res.json();
    el('engine').textContent = s.engine;
    el('enabled').textContent = s.enabled ? 'ON' : 'OFF';
    el('enabled').className = s.enabled ? 'ok' : 'bad';
    el('block-status').textContent = String(s.config.blockStatus);
    el('cc').textContent = `${String(s.config.cc.ratePerMinute)} / min`;
    el('mode').textContent = s.config.monitor ? 'monitor' : 'block';
    el('mode').className = s.config.monitor ? 'bad' : 'ok';
    const tbody = el('rules').querySelector('tbody');
    tbody.textContent = '';
    for (const [cls, n] of Object.entries(s.rules)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${cls}</td><td style="text-align:right">${String(n)}</td>`;
      tbody.appendChild(tr);
    }
    el('c-blocked').textContent = String(s.counters.blocked);
    el('c-cc').textContent = String(s.counters.cc429);
    el('c-passed').textContent = String(s.counters.passed);
  } catch (err) {
    el('engine').textContent = 'status fetch failed';
  }
}

async function runSelfTest() {
  const out = el('selftest-out');
  out.textContent = 'running…';
  out.className = '';
  try {
    const res = await fetch('/api/waf/self-test');
    const s = await res.json();
    if (s.ok && s.blocked) {
      out.textContent = `OK blocked (${s.rule}) → ${s.status}`;
      out.className = 'ok';
    } else {
      out.textContent = 'NOT blocked — monitor mode?';
      out.className = 'bad';
    }
  } catch (err) {
    out.textContent = 'error';
    out.className = 'bad';
  }
}

el('selftest').addEventListener('click', runSelfTest);
loadStatus();
setInterval(loadStatus, 10000);