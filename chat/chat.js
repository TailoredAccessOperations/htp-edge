/**
 * HTP ZERO/CHAT — page logic. Session-only thread (sessionStorage), burn after read,
 * structured rendering via chat-parser, client-side keygen.
 */
import { detectStructured, planJson, planXml, planText, renderNode, apiFailureReason } from './chat-parser.js';
import { toWireMessages } from './chat-messages.js';
import { createSseParser } from './sse-parse.js';

const $ = (id) => document.getElementById(id);
const el = {
  room: $('chat-room'), thread: $('chat-thread'), form: $('chat-form'), input: $('chat-input'),
  send: $('chat-send'), burn: $('chat-burn'), copy: $('chat-copy'), count: $('chat-count'),
  engine: $('chat-engine'), mode: $('tui-mode'), status: $('tui-status'), inputHint: $('chat-input-hint'),
  tabs: [...document.querySelectorAll('.chat-tab')],
  panels: [...document.querySelectorAll('.chat-tabpanel')],
  paste: $('paste-input'), pasteStyle: $('paste-style'), pasteRaw: $('paste-raw'), pasteOut: $('paste-output'),
  keygen: $('keygen-grid'),
};

const HISTORY_KEY = 'htp.chat.input-history';
const inputHistory = (() => { try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } })();
let historyIndex = inputHistory.length;
const COMMANDS = {
  '/help': 'Commands: /help /clear /burn /copy /status /model /json <object> · /dispatch <task> runs a worker inline · /task toggles TASK mode (every message dispatches) · /agents lists workers',
  '/clear': 'Cleared the visible thread. Session history remains until /burn.',
  '/status': () => `ROOM ${room.toUpperCase()} · ${thread.length} messages · ${activeAbort ? 'streaming' : 'ready'}`,
  '/model': () => el.engine.textContent.replace(/^ENGINE:\s*/, '') || 'model unavailable',
};

function setStatus(text) { if (el.status) el.status.textContent = text; }
function saveInputHistory() { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(inputHistory.slice(-80))); }
function localDevReply(prompt) {
  const text = String(prompt || '').trim();
  if (/^(ping|hello|hi)$/i.test(text)) return 'LOCAL TUI ONLINE\n\nThe browser shell is working, but the static server has no /chat/api/ask POST handler. Start Wrangler to connect Workers AI.';
  return `LOCAL TUI MODE\n\nReceived: ${text}\n\nNo model backend is attached to this static server. Start Wrangler or use the production Worker for live WIRE responses.`;
}
let taskMode = sessionStorage.getItem('htp.chat.taskmode') === '1';
function syncMode() { if (el.mode) el.mode.textContent = 'MODE: ' + (taskMode ? 'TASK/DISPATCH' : 'CHAT'); }
function localCommand(text) {
  const [command, ...rest] = text.trim().split(/\s+/);
  if (command === '/task') { taskMode = !taskMode; sessionStorage.setItem('htp.chat.taskmode', taskMode ? '1' : '0'); syncMode(); thread.push({ role: 'ai', text: 'TASK mode ' + (taskMode ? 'ON — messages route through /chat/api/dispatch' : 'OFF — back to WIRE chat'), engine: 'local' }); save(); renderAll(); return true; }
  if (command === '/agents') {
    fetch('/chat/api/dispatch').then((r) => r.json()).then((d) => {
      thread.push({ role: 'ai', text: (d.categories || []).map((c) => `P${c.priority} ${c.id} → ${c.agent} [${c.action}]`).join('\n') + '\nfallback → ' + d.fallback, engine: 'dispatch' }); save(); renderAll();
    }).catch((e) => setStatus('ERROR ' + e.message));
    return true;
  }
  if (command === '/clear') { el.thread.replaceChildren(); setStatus('CLEARED'); return true; }
  if (command === '/burn') { burn(); return true; }
  if (command === '/copy') { copyLog(); setStatus('COPIED'); return true; }
  if (command === '/json' && rest.length) { el.paste.value = rest.join(' '); el.pasteStyle.click(); setStatus('STYLED JSON'); return true; }
  if (COMMANDS[command]) { const value = typeof COMMANDS[command] === 'function' ? COMMANDS[command]() : COMMANDS[command]; thread.push({ role: 'ai', text: value, engine: 'local' }); save(); renderAll(); setStatus('LOCAL COMMAND'); return true; }
  return false;
}


const ROOM_KEY = 'htp.chat.room';
const THREAD_KEY = 'htp.chat.thread';
const room = (sessionStorage.getItem(ROOM_KEY) || (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 12));
sessionStorage.setItem(ROOM_KEY, room);
const thread = (() => {
  try { return JSON.parse(sessionStorage.getItem(THREAD_KEY) || '[]'); }
  catch { return []; }
})();

function save() { sessionStorage.setItem(THREAD_KEY, JSON.stringify(thread.slice(-40))); }

/** Abort handle for the in-flight generation, or null when idle. */
let activeAbort = null;

// Partial navigation (/chat <-> /osint) tears the page down before swapping in
// new markup. A streaming response that is still decoding into a detached DOM
// would keep the socket, the reader and the parser alive, so release it here.
// window.__htpTeardown is provided by /js/htp-nav.js and is absent on a normal
// full page load, hence the guard.
if (window.__htpTeardown) {
  window.__htpTeardown.add(function () {
    try { activeAbort && activeAbort.abort(); } catch (e) {}
    activeAbort = null;
  });
}

function head(cls, text) {
  const h = document.createElement('h2');
  h.className = 'msg-head ' + cls;
  h.textContent = text;
  return h;
}

function renderMessage(m) {
  const div = document.createElement('article');
  div.className = 'msg msg-' + m.role;
  const bg = head(m.role === 'user' ? 'you' : 'wire · ' + (m.engine || 'ai'), m.role === 'user' ? 'YOU' : (m.route ? 'WORKER · ' + String(m.route.category).toUpperCase() : 'WIRE'));
  if (m.role === 'ai' && m.engine) bg.title = m.engine;
  div.appendChild(bg);
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (m.role === 'ai' && m.structured && m.structured.type !== 'text') {
    body.appendChild(renderNode(m.structured));
    const raw = document.createElement('details');
    raw.className = 'cp-raw';
    const sum = document.createElement('summary');
    sum.textContent = 'raw';
    const pre = document.createElement('pre');
    pre.textContent = m.text;
    raw.append(sum, pre);
    body.appendChild(raw);
  } else {
    body.textContent = m.text;
  }
  div.appendChild(body);
  if (m.truncated && m.role === 'ai') {
    // The worker stops a runaway generation at a character bound; without this
    // note the cut-off text looks like a finished answer.
    const cut = document.createElement('p');
    cut.className = 'msg-truncated';
    cut.textContent = '— stopped at the output length limit —';
    div.appendChild(cut);
  }
  // Handed back so a streaming reply can update its own text node instead of
  // forcing the whole thread to re-render on every delta.
  return { node: div, body };
}

/** Append one message and return its node plus the body to update in place. */
function appendMessage(m) {
  const built = renderMessage(m);
  el.thread.appendChild(built.node);
  el.count.textContent = String(thread.length).padStart(2, '0');
  return built;
}

function renderAll() {
  el.thread.replaceChildren();
  thread.forEach((m) => el.thread.appendChild(renderMessage(m).node));
  el.count.textContent = String(thread.length).padStart(2, '0');
  el.thread.scrollTop = el.thread.scrollHeight;
}

function setRawToggle(hasPlan) {
  el.pasteRaw.disabled = !hasPlan;
}

function structuredPlan(raw) {
  try {
    const d = detectStructured(raw);
    if (!d || !d.kind) return { plan: planText(raw), raw };
    if (d.kind === 'json') {
      const parsed = d.parsed === undefined ? JSON.parse(d.raw) : d.parsed;
      return { plan: planJson(parsed), raw: d.raw };
    }
    const plan = planXml(d.raw);
    return plan ? { plan, raw: d.raw } : { plan: planText(raw), raw };
  } catch (e) {
    return { plan: planText(raw), raw, error: (e && e.message) || String(e) };
  }
}

async function send() {
  // The composer button doubles as STOP while a reply is streaming. Re-entering
  // send() aborts rather than starting a second generation, so one handler
  // covers both without a second click listener fighting the form's submit.
  if (activeAbort) {
    activeAbort.abort();
    return;
  }
  const text = el.input.value.trim();
  if (!text) return;
  const dispatchMatch = /^\/dispatch\s+([\s\S]+)/i.exec(text);
  const isDispatch = Boolean(dispatchMatch) || (taskMode && !text.startsWith('/'));
  const task = dispatchMatch ? dispatchMatch[1].trim() : text;
  if (!isDispatch && localCommand(text)) { el.input.value = ''; el.count.textContent = String(thread.length).padStart(2, '0'); return; }
  inputHistory.push(text); historyIndex = inputHistory.length; saveInputHistory();
  el.input.value = '';
  el.count.textContent = String(thread.length + 1).padStart(2, '0');
  thread.push({ role: 'user', text });
  save(); renderAll();
  // Stays enabled: it has to remain clickable to work as STOP.
  el.send.textContent = 'STOP';
  el.send.setAttribute('aria-label', 'stop generating');
  setStatus('THINKING');
  el.engine.textContent = 'ENGINE: requesting…';

  // Abort is the cost control: the model bills per output token, so a user who
  // closes the tab should stop the generation rather than pay for the rest.
  const ac = new AbortController();
  activeAbort = ac;

  const entry = { role: 'ai', text: '', engine: isDispatch ? 'dispatch: routing…' : '' };
  thread.push(entry);
  const live = appendMessage(entry);

  // Deltas arrive far faster than the display refreshes. Coalescing them into
  // one paint per frame keeps a long code reply from spending its whole budget
  // in forced layout.
  let pending = '';
  let frame = 0;
  const paint = () => {
    frame = 0;
    live.body.textContent = entry.text;
    el.thread.scrollTop = el.thread.scrollHeight;
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(paint);
  };

  try {
    const res = await fetch(isDispatch ? '/chat/api/dispatch' : '/chat/api/ask', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: isDispatch ? JSON.stringify({ task, stream: true }) : JSON.stringify({
        system: 'You are HTP WIRE. Answer tersely. When structured data is useful, return a fenced ```json``` block.',
        messages: toWireMessages(thread.slice(-20)),
        stream: true,
      }),
    });

    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || !ctype.includes('text/event-stream')) {
      if (res.status === 501 && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
        entry.text = localDevReply(text);
        entry.engine = 'local-static';
        el.engine.textContent = 'ENGINE: local-static';
        setStatus('OFFLINE FALLBACK');
      } else {
        // Non-streaming path: a 4xx/5xx, an edge/WAF HTML block, or an older
        // worker that ignored the stream flag.
        const raw = await res.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        if (!data || typeof data !== 'object') throw new Error(apiFailureReason(res, raw));
        if (!res.ok || data.ok === false) throw new Error((data && data.reason) || (data && data.error) || res.status);
        entry.text = data.reply || '';
        entry.engine = data.engine || '';
        el.engine.textContent = 'ENGINE: ' + (entry.engine || '—');
        setStatus('RECEIVING');
        live.body.textContent = entry.text;
      }
    } else {
      const parser = createSseParser((event, data) => {
        let piece = null;
        if (event === 'route' && data) {
          const kw = [...(data.matched?.keywords || []), ...(data.matched?.files || [])].join(', ') || 'no match';
          entry.engine = `dispatch → ${data.category} (${data.agent}, P${data.priority}, ${data.action})`;
          entry.route = data;
          live.node.querySelector('.msg-head').textContent = 'WORKER · ' + String(data.category).toUpperCase();
          el.engine.textContent = 'ENGINE: ' + entry.engine + ' · matched: ' + kw;
          setStatus('DISPATCHED ' + String(data.category).toUpperCase());
          return;
        }
        if (event === 'delta' && data && typeof data.text === 'string') piece = data.text;
        else if (event === 'message' && data && Array.isArray(data.choices)) {
          // Raw Workers AI chunk (older worker): content only, skip reasoning.
          const d = data.choices[0] && data.choices[0].delta;
          if (d && typeof d.content === 'string') piece = d.content;
          else if (d && d.reasoning) { setStatus('THINKING'); return; }
        } else if (event === 'message' && data && typeof data.response === 'string') piece = data.response;
        if (piece !== null) {
          if (!entry.text) piece = piece.replace(/^\s+/, '');
          if (!piece) return;
          if (!entry.text) setStatus('RECEIVING');
          entry.text += piece;
          schedule();
        } else if (event === 'truncated') {
          // Say so. A silently cut answer reads as complete and gets trusted.
          entry.truncated = true;
          el.engine.textContent = 'ENGINE: stopped at output limit (' + (data?.chars ?? 0) + ' chars)';
        } else if (event === 'done') {
          if (data && data.chars) el.engine.textContent = 'ENGINE: streaming ' + data.chars + ' chars';
        } else if (event === 'error') {
          throw new Error((data && data.reason) || (data && data.error) || 'AI backend failed');
        }
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.feed(decoder.decode());
      parser.flush();

      if (ac.signal.aborted) entry.aborted = true;
      if (!entry.text) throw new Error('empty response from AI backend');
    }

    // Build the structured plan only once the full text is in hand; a partial
    // parse would render a broken card mid-stream.
    entry.structured = structuredPlan(entry.text).plan;
    live.body.replaceChildren();
    const final = renderMessage(entry);
    live.node.replaceWith(final.node);
  } catch (err) {
    if (frame) cancelAnimationFrame(frame);
    if (ac.signal.aborted) {
      entry.text = entry.text || '— aborted by user —';
      entry.aborted = true;
      setStatus('ABORTED');
    } else {
      entry.text = 'TRANSMISSION FAILED: ' + (err && err.message ? err.message : err);
      entry.failed = true;
      setStatus('ERROR');
    }
    live.node.replaceWith(renderMessage(entry).node);
  } finally {
    if (frame) cancelAnimationFrame(frame);
    activeAbort = null;
    el.send.disabled = false;
    el.send.textContent = 'TRANSMIT';
    el.send.setAttribute('aria-label', 'send message');
    setStatus('READY');
    save(); renderAll();
  }
}

function burn() {
  sessionStorage.removeItem(THREAD_KEY);
  sessionStorage.removeItem(ROOM_KEY);
  thread.length = 0;
  renderAll();
  location.reload();
}

function copyLog() {
  const plain = thread.map((m) => ('[' + m.role + '] ' + m.text)).join('\n\n');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(plain);
}

/* ---- keygen (randomkeygen-style, CSPRNG) ---- */
const cryptoObj = (globalThis.crypto || null);
function randBytes(n) {
  if (!cryptoObj) return Array.from({ length: n }, () => Math.floor(Math.random() * 256));
  const b = new Uint8Array(n);
  cryptoObj.getRandomValues(b);
  return Array.from(b);
}
function fromBytes(bytes, chars) {
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}
const KEYGEN = [
  { name: 'PASSWORD · 16', gen: () => fromBytes(randBytes(16), 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789@#$%^&*!') },
  { name: 'ACTIVATION CODE', gen: () => Array.from({ length: 4 }, () => fromBytes(randBytes(4), 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')).join('-') },
  { name: 'API KEY · hex 64', gen: () => fromBytes(randBytes(32), '0123456789abcdef') },
  { name: 'API KEY · b64 32', gen: () => fromBytes(randBytes(24), 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') },
  { name: 'WPA-PSK', gen: () => fromBytes(randBytes(14), 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~') },
  { name: 'PIN · 6', gen: () => fromBytes(randBytes(4), '0123456789').slice(0, 6) },
  { name: 'UUID v4', gen: () => { const b = randBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); } },
];
function renderKeygen() {
  el.keygen.innerHTML = '';
  KEYGEN.forEach((k) => {
    const card = document.createElement('div');
    card.className = 'keygen-card';
    const name = document.createElement('div');
    name.className = 'keygen-name'; name.textContent = k.name;
    const out = document.createElement('div');
    out.className = 'keygen-out';
    const row = document.createElement('div');
    row.className = 'keygen-row';
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'chat-btn chat-btn-mini'; again.textContent = 'REGEN';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'chat-btn chat-btn-mini'; copy.textContent = 'COPY';
    row.append(again, copy);
    const gen = () => { out.textContent = k.gen(); };
    again.addEventListener('click', gen);
    copy.addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(out.textContent); });
    gen();
    card.append(name, out, row);
    el.keygen.appendChild(card);
  });
}

/* ---- paste & style ---- */
el.pasteStyle.addEventListener('click', () => {
  const raw = el.paste.value;
  if (!raw.trim()) return;
  const { plan } = structuredPlan(raw);
  el.pasteOut.innerHTML = '';
  el.pasteOut.appendChild(renderNode(plan));
  setRawToggle(Boolean(plan && plan.type !== 'text'));
});
el.pasteRaw.addEventListener('click', () => {
  el.pasteOut.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'cp-text';
  pre.textContent = el.paste.value;
  el.pasteOut.appendChild(pre);
});

/* ---- wiring ---- */
el.tabs.forEach((t) => t.addEventListener('click', () => {
  el.tabs.forEach((x) => x.classList.toggle('is-on', x === t));
  el.panels.forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
}));
el.form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
el.burn.addEventListener('click', burn);
el.copy.addEventListener('click', copyLog);
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeAbort) { e.preventDefault(); send(); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); return; }
  if (e.key === 'ArrowUp' && !el.input.value.trim()) { e.preventDefault(); historyIndex = Math.max(0, historyIndex - 1); el.input.value = inputHistory[historyIndex] || ''; }
  if (e.key === 'ArrowDown' && !el.input.value.trim()) { e.preventDefault(); historyIndex = Math.min(inputHistory.length, historyIndex + 1); el.input.value = inputHistory[historyIndex] || ''; }
});
el.input.addEventListener('input', () => el.count.textContent = String(thread.length + (el.input.value ? 1 : 0)).padStart(2, '0'));

el.room.textContent = 'ROOM ' + room.toUpperCase();
renderAll();
syncMode();
renderKeygen();