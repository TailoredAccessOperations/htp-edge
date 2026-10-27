/**
 * HTP /chat — structured-text parser (JSON/XML → renderable plans).
 * Pure module: no DOM access. Shared by the /chat page and node unit tests.
 */
'use strict';

let __id = 0;
export function newId() { return 'p' + (++__id); }

const scalarKind = (v) => {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return typeof v === 'number' && Number.isFinite(v) ? 'num' : 'nil';
  return typeof v === 'string' ? 'str' : 'obj';
};

const urlLike = (s) => typeof s === 'string' && /^(https?|mailto):\/\//i.test(s);

function planValue(v, key) {
  const k = scalarKind(v);
  if (k === 'obj') return { id: newId(), key, type: 'cards', value: planSlot(v) };
  if (urlLike(v)) return { id: newId(), key, kind: 'str', value: String(v), link: v };
  return { id: newId(), key, kind: k, value: v === null || v === undefined ? '' : String(v) };
}

function planSlot(v, key) {
  const k = scalarKind(v);
  if (k === 'obj' && Array.isArray(v)) {
    if (!v.length) return { id: newId(), key, type: 'list', items: [] };
    const allObj = v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
    if (allObj) return { id: newId(), key, type: 'table', rows: v, keys: [...new Set(v.reduce((a, o) => a.concat(Object.keys(o)), []))] };
    return { id: newId(), key, type: 'list', items: v.map((x) => planValue(x)) };
  }
  if (k === 'obj') {
    const entries = Object.entries(v || {}).map(([ek, ev]) => planValue(ev, ek));
    return { id: newId(), key, type: 'cards', entries };
  }
  return planValue(v, key);
}

export function planJson(parsed) {
  if (parsed === null || parsed === undefined) return { id: newId(), type: 'text', value: 'null' };
  return planSlot(parsed);
}

export function planXml(raw) {
  if (typeof raw !== 'string') return null;
  const doc = xmlDoc(raw);
  if (!doc || !doc.documentElement) return null;
  return { id: newId(), type: 'cards', root: true, entries: nodeEntries(doc.documentElement) };
}

const xmlDoc = (raw) => {
  if (typeof DOMParser === 'undefined') return null; // node: no DOMParser — tests hit planXml only via shape
  try {
    return new DOMParser().parseFromString(raw, 'application/xml');
  } catch {
    return null;
  }
};

const nodeEntries = (el) => {
  const attrs = Array.from(el.attributes || []).map((a) => ({ id: newId(), key: '@' + a.name, kind: 'str', value: a.value }));
  const kids = [];
  for (const ch of el.childNodes || []) {
    if (ch.nodeType === 3) {
      const t = (ch.nodeValue || '').trim();
      if (t) kids.push({ id: newId(), key: kebab(ch.parentNode && ch.parentNode.nodeName), kind: 'str', value: t });
    } else if (ch.nodeType === 1) {
      kids.push({ id: newId(), key: kebab(ch.nodeName), kind: 'obj', node: ch });
    }
  }
  const metas = kids.filter((k) => !k.node).map((k) => ({ id: k.id, key: k.key, kind: k.kind, value: k.value }));
  const nodes = kids.filter((k) => k.node).map((k) => ({ id: k.id, key: k.key, type: 'cards', entries: nodeEntries(k.node) }));
  return attrs.concat(metas).concat(nodes);
};

const kebab = (s) => String(s || '').replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function planText(raw) {
  return { id: newId(), type: 'text', value: String(raw || '') };
}

/**
 * Explain an API response that is not JSON. The worker answers with an HTML
 * page whenever the WAF blocks a request (and Cloudflare's edge errors are HTML
 * too), so an unconditional res.json() surfaced `Unexpected token '<'` and hid
 * both the status and the cause. Takes anything response-shaped: {status,
 * statusText, headers:{get}}.
 */
export function apiFailureReason(res, bodyText) {
  const status = res && res.status ? res.status : 0;
  const statusText = res && res.statusText ? String(res.statusText) : '';
  const get = (k) =>
    res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(k) : null;
  const type = String(get('content-type') || '').split(';')[0].trim();
  const rule = get('x-htp-waf-rule');
  const head = status ? `${status}${statusText ? ' ' + statusText : ''}` : 'no response';
  if (rule) return `${head} — blocked by the site WAF (rule ${rule})`;
  if (type === 'text/html' || /^\s*</.test(String(bodyText || ''))) {
    return `${head} — server returned an HTML page instead of JSON (edge error or challenge page)`;
  }
  const snippet = String(bodyText || '').trim().slice(0, 120);
  return `${head} — expected JSON, got ${type || 'an empty body'}${snippet ? `: ${snippet}` : ''}`;
}

export function extractBlocks(text) {
  const blocks = [];
  const re = /```(?:json|xml)\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0].replace(/```/g, '').trim().toLowerCase().split(/\s/)[0];
    const raw = m[1].trim();
    if (!raw) continue;
    blocks.push({ kind: tag === 'xml' ? 'xml' : 'json', raw });
  }
  return blocks;
}

export function detectStructured(text) {
  if (typeof text !== 'string') return { kind: null, raw: text };
  const hits = extractBlocks(text);
  if (hits.length) return { kind: hits[0].kind, raw: hits[0].raw };
  const t = text.trim();
  if (t.startsWith('{')) {
    try { return { kind: 'json', raw: t, parsed: JSON.parse(t) }; }
    catch { return { kind: 'json', raw: t, error: 'json parse failed' }; }
  }
  if (t.startsWith('[')) {
    try { return { kind: 'json', raw: t, parsed: JSON.parse(t) }; }
    catch { return { kind: 'json', raw: t, error: 'json parse failed' }; }
  }
  if (/^\s*</.test(t)) {
    const wellFormed = /^\s*<[a-zA-Z][\w.-]*[\s>][\s\S]*<\/[a-zA-Z][\w.-]*>\s*$/.test(t) || /^\s*<[a-zA-Z][\w.-]*\/>\s*$/.test(t);
    if (wellFormed) return { kind: 'xml', raw: t };
    return { kind: 'xml', raw: t, error: 'xml parse failed' };
  }
  return { kind: null, raw: text };
}

// ── DOM renderer (browser only) ─────────────────────────────────────────────
function renderText(node) {
  const p = document.createElement('p');
  p.className = 'cp-text';
  p.textContent = node.value || '';
  return p;
}

function renderCell(v) {
  if (v && v.link) {
    const a = document.createElement('a');
    a.href = v.link; a.rel = 'noopener noreferrer'; a.target = '_blank';
    a.textContent = v.value; a.className = 'cp-link';
    return a;
  }
  const span = document.createElement('span');
  span.className = 'cp-val'; span.dataset.kind = v.kind || '';
  span.textContent = v.value || '';
  return span;
}

function renderCards(node) {
  const col = document.createElement('div');
  col.className = 'cp-cards';
  (node.entries || []).forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'cp-card';
    const head = document.createElement('div');
    head.className = 'cp-key';
    head.textContent = entry.key || '';
    card.append(head);
    if (entry.type === 'cards') card.appendChild(renderNode(entry));
    else card.appendChild(renderCell(entry));
    col.appendChild(card);
  });
  return col;
}

function renderTable(node) {
  const t = document.createElement('table');
  t.className = 'cp-table';
  const keys = node.keys || [];
  const thead = document.createElement('tr');
  keys.forEach((k) => { const th = document.createElement('th'); th.textContent = k; thead.appendChild(th); });
  if (keys.length) { const tr0 = document.createElement('tr'); tr0.append(thead); t.appendChild(tr0); }
  (node.rows || []).forEach((row) => {
    const tr = document.createElement('tr');
    keys.forEach((k) => {
      const td = document.createElement('td');
      const v = row[k];
      tk(td, v);
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  return t;
}

function tk(td, v) {
  if (v === null || v === undefined) { td.textContent = ''; td.dataset.kind = 'nil'; return; }
  if (typeof v === 'object') { td.textContent = '[object]'; td.dataset.kind = 'obj'; return; }
  if (typeof v === 'boolean') { td.textContent = String(v); td.dataset.kind = 'bool'; return; }
  td.textContent = String(v); td.dataset.kind = typeof v;
}

function renderList(node) {
  const ul = document.createElement('ul');
  ul.className = 'cp-list';
  (node.items || []).forEach((it) => { const li = document.createElement('li'); li.appendChild(renderNode(it)); ul.appendChild(li); });
  return ul;
}

export function renderNode(plan) {
  if (!plan) return renderText({ value: '' });
  if (plan.type === 'text') return renderText(plan);
  if (plan.type === 'table') return renderTable(plan);
  if (plan.type === 'cards') return renderCards(plan);
  if (plan.type === 'list') return renderList(plan);
  if (plan.type === 'scalar') { const s = document.createElement('span'); s.className = 'cp-val'; s.textContent = plan.value || ''; return s; }
  return renderText({ value: plan.value || '' });
}