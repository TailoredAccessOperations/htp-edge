/* htp.sh — carrier tty + python3 + javascript front-end.
 *
 * Three modes, one prompt:
 *   shell   site commands, then the live terminal for everything else
 *   python  the session on /terminal/execute — functions stay defined
 *   js      window.HTPJavaScript — the in-page runner (/js/js-shell.js)
 *
 * Output is DOM-only (textContent / createElement); no innerHTML anywhere.
 * Public API: window.HTPTerminal { exec, reboot, clear, writeRaw, writeError, prompt, focus, run }
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const term = $("terminal");
  const wrap = $("term-wrap");
  const input = $("cmd");
  const form = $("term-form");
  if (!term || !input) {
    if (term || input) console.warn("[htp terminal] markup incomplete; shell disabled");
    return;
  }

  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = () => motionQuery.matches;
  const MAX_NODES = 4000; // scrollback cap so long sessions don't leak DOM
  const HISTORY_KEY = "htp.term.history.v2";
  const HISTORY_MAX = 100;
  const SESSION_KEY = "htp.term.session";
  const SHELL_PROMPT = "master@htp.sh:~$";
  let pyBuffer = "";
  let runAbort = null;

  function sessionId() {
    let id = "";
    try { id = sessionStorage.getItem(SESSION_KEY) || ""; } catch { id = ""; }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
        .replace(/-/g, "")
        .slice(0, 16);
      try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* private mode still runs */ }
    }
    return id;
  }

  async function remoteExecute(payload) {
    const controller = new AbortController();
    runAbort = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/terminal/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ session: sessionId(), timeout: 30 }, payload)),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok && data && !data.stderr && data.error) data.stderr = data.error;
      return data;
    } finally {
      clearTimeout(timer);
      if (runAbort === controller) runAbort = null;
    }
  }

  /* ---------- tiny rich-text model: [cls, text] segments, never HTML ---------- */
  const seg = (cls, text) => ({ cls, text });
  const t = (text) => seg("", text);
  const line = (...parts) => parts.concat(t("\n"));

  const PAGES = {
    home: "/",
    resources: "/#resources",
    media: "/#media-shelf",
    terminal: "/#term-wrap",
    money: "/money.html",
    lulz: "/lulz/",
    leet: "/1.3.3.7",
    madmonero: "/x.ai/MadMonero",
    bitcoin: "/bitcoin.pdf",
    osint: "/osint/",
    love: "/love.html",
    malware: "/malware.html",
  };

  const RESOURCES = [
    ["/x.ai/MadMonero", "MadMonero raw feed (text/plain)"],
    ["https://ai.htp.sh/v1", "AI gateway (Cloudflare Access)"],
    ["https://github.com/TailoredAccessOperations", "GitHub — TailoredAccessOperations"],
    ["/lulz/", "Lulz stair"],
    ["/money.html", "Money board"],
    ["/bitcoin.pdf", "bitcoin.pdf — the whitepaper"],
  ];

  const DISCONNECT = [seg("gray", "[DISCONNECT]"), t("\nCarrier lost. Good choice.")];

  /* Files the in-page filesystem actually holds, so `ls` is not a lie. */
  const FAKE_FS = {
    "flag.txt": "flag{y0u_4r3_n0t_3l1t3_l0l_jk_w3lc0m3}",
    "backdoor.exe": "MZ... nah. It's a JPEG of a cat. Lulz.",
    "nsa_keylogger.ko": "insmod: ERROR: could not insert module: Operation not permitted (and not real)",
    "resources.txt": null, // dynamic → the loot table
  };

  /** Static responses. Values: string | segment[] */
  const CMDS = {
    whoami: "nobody\nliterally.",
    id: "uid=1337(elite) gid=0(root) groups=0(root),1(bin),666(blackhat),31337(leethe)",
    "uname -a": "Linux htp.sh 6.6.6-htp #1 SMP PREEMPT Thu Oct 13 1987 i686 GNU/Linux\nUp 1337 days, 13:37, 1 user, load average: 0.00, 0.00, 0.00",
    pwd: "/home/nobody (you wish it was /root)",
    sudo: "sudo: command not found... because you don't have permission, meatbag.",
    root: "Nice try, skid.",
    2600: [t("☎ 2600 Hz tone engaged ☎\n"), seg("blink red", "TRUNK SEIZED — ALL CIRCUITS BUSY — ROUTING TO FBI TIP LINE")],
    phreak: "Old-school. Respect.\nWelcome, Captain Crunch.\nHere's your free call: 1-800-OWN-ED",
    hackers: [
      seg("gray", "<BL4D3>"), t(" What do you want?\n"),
      seg("cyan", "<CRASH_0V3RR1D3>"), t(" We come in peace?\n"),
      seg("red", "<AC1D_BURN>"), t(" We need your help.\n"),
      seg("green", "<R4Z0R>"), t(" She's buff. Ballsy.\n"),
      seg("gray", "<BL4D3>"), t(" Let's take her.\n"),
      seg("green", "<R4Z0R>"), t(" Waste the dude.\n"),
      seg("red", "<AC1D_BURN>"), t(" Help us overload the Gibson!\n"),
      seg("green", "<R4Z0R>"), t(" Hackers of the World, Unite!"),
    ],
    nuke: "Launching ICBM in 3... 2... 1...\nJust kidding. Or am I?",
    defcon: [t("DEFCON 1 — ALL SYSTEMS ARMED\n"), seg("blink red", "NORAD reports inbound warheads from 127.0.0.1")],
    master: "master@htp.sh: Permission denied... and you're ugly.",
    warez: "Warez? In 2026? Go touch grass.",
    lulz: "We do it for the lulz. Logic > loud. Masks on, brains on.",
    expect: "We are Anonymous (lab edition). We do not forgive bad TLS. We do not forget to patch. Expect us.",
    ping: "PONG. 0.1337 ms. The carrier is alive.",
    ghost: "boo. 👻  (scroll up to 0x539 — it shape-shifts)",
    q: DISCONNECT,
    exit: DISCONNECT,
    logout: DISCONNECT,
  };

  const HELP = [
    seg("cyan", "carrier tty — commands\n"),
    t("  help  man <cmd>  whoami  id  pwd  uname -a  ls  cat <file>  tree  find  du  df  date  echo <txt>\n"),
    t("  history  clear  resources  feed  open <page>  pages  ping  lulz  expect  ghost\n"),
    t("  sudo  root  2600  phreak  hackers  nuke  defcon  warez  master  exit | q\n"),
    t("  python | py  → python3 REPL      js | node → javascript REPL      shell → back here\n"),
    seg("gray", "keys: Tab complete · ↑/↓ history · Ctrl+L clear · Ctrl+C cancel · Esc leave prompt"),
    seg("gray", "editor: Ctrl/Cmd+Enter runs · Ctrl+. stops · Tab indents (Esc, Tab leaves)"),
  ];

  const MAN = {
    feed: "feed [n] — print the first n (default 12) lines of the live MadMonero raw feed.",
    open: "open <page> — navigate. pages: " + Object.keys(PAGES).join(", "),
    echo: "echo <text> — prints text. Rendered as text; your <script> stays a string.",
    history: "history [-c] — list or clear command history (kept in localStorage).",
    python: "python — switch to the in-page python3 interpreter. No network, step-limited.",
    js: "js — switch to the sandboxed javascript runner. Same no-network rule; let/const/class persist between lines.",
    input: "input(prompt) — returns whatever is currently typed at the prompt. Type the answer first, then run.",
    resources: "resources — curated links (same list as the Loot table).",
    ls: "ls [path] — list files. This shell's filesystem is in memory and starts empty;",
    cat: "cat <file> — print a file from the in-memory filesystem, or a page's decoy.",
    tree: "tree — show the same list as a tree.",
    run: "run [python|js] — run the editor buffer. Defaults to the active language.",
  };

  const INSULTS = ["Access denied.", "GTFO", "You are not 0x539.", "Nice try.", "l0l no", "Go away.", "Logging attempt #42069", "command not found (but your vibe was)"];

  /* ---------- state ---------- */
  let busy = false;
  let disconnected = false;
  let cursorEl = null;
  let mode = "python"; // shell | python | js
  const history = loadHistory();
  let histIdx = history.length;
  let draft = "";

  function loadHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-HISTORY_MAX) : [];
    } catch {
      return [];
    }
  }
  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX))); } catch { /* private mode */ }
  }
  function pushHistory(cmd) {
    if (!cmd || history[history.length - 1] === cmd) { histIdx = history.length; return; }
    history.push(cmd);
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
    histIdx = history.length;
    saveHistory();
  }

  /* ---------- output ---------- */
  const scrollBottom = () => requestAnimationFrame(() => { term.scrollTop = term.scrollHeight; });

  function trim() {
    while (term.childNodes.length > MAX_NODES) term.removeChild(term.firstChild);
  }
  function dropCursor() {
    if (cursorEl) cursorEl.remove();
    cursorEl = null;
  }
  function showCursor() {
    dropCursor();
    cursorEl = document.createElement("span");
    cursorEl.className = "cursor";
    cursorEl.setAttribute("aria-hidden", "true");
    cursorEl.textContent = " ";
    term.appendChild(cursorEl);
  }
  function appendText(text, cls) {
    if (text == null || text === "") return;
    const parts = String(text).split("\n");
    const frag = document.createDocumentFragment();
    const target = cls ? document.createElement("span") : frag;
    if (cls) target.className = cls;
    parts.forEach((p, i) => {
      if (p) target.appendChild(document.createTextNode(p));
      if (i < parts.length - 1) target.appendChild(document.createElement("br"));
    });
    if (cls) frag.appendChild(target);
    term.appendChild(frag);
  }
  function write(content) {
    dropCursor();
    if (Array.isArray(content)) content.forEach((s) => appendText(s.text, s.cls));
    else appendText(content);
    trim();
    scrollBottom();
  }
  function writeLink(href, label) {
    dropCursor();
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    a.className = "term-link";
    if (/^https?:/i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    term.appendChild(a);
  }

  /** Typewriter for plain strings; instant for segments or reduced motion. */
  function typeOut(content) {
    return new Promise((resolve) => {
      if (reducedMotion() || typeof content !== "string" || content.length > 600) {
        write(content);
        write("\n");
        return resolve();
      }
      dropCursor();
      let i = 0;
      const tick = () => {
        if (i >= content.length) { write("\n"); return resolve(); }
        const next = Math.min(i + 4, content.length);
        appendText(content.slice(i, next));
        i = next;
        scrollBottom();
        setTimeout(tick, 6);
      };
      tick();
    });
  }

  /* ---------- engines ---------- */
  const py = () => window.HTPPython || null;
  const js = () => window.HTPJavaScript || null;

  function setPromptLabel() {
    const label = $("term-prompt");
    let text = SHELL_PROMPT;
    if (mode === "python") text = py() && py().pending() ? "..." : ">>>";
    else if (mode === "js") text = js() && js().pending() ? "…" : "›";
    if (label) label.textContent = text;
    input.setAttribute("aria-label", mode === "shell" ? "Shell prompt" : mode === "python" ? "Python prompt" : "JavaScript prompt");
  }
  function promptLine() {
    setPromptLabel();
    input.value = "";
    showCursor();
    scrollBottom();
  }

  /** Reflect the active mode in the IDE chrome: title, filename, badge. */
  function syncChrome() {
    const titleEl = $("term-title");
    const modeEl = $("term-mode");
    const badgeEl = $("lang-badge");
    const lang = mode === "js" ? "js" : "python";
    const names = { shell: ["htp.sh — carrier tty", "tty1"], python: ["htp.sh — python3 IDE", "repl.py"], js: ["htp.sh — javascript IDE", "worker.js"] };
    const [title, file] = names[mode];
    if (titleEl) titleEl.textContent = title;
    if (modeEl) modeEl.textContent = file;
    if (badgeEl) {
      badgeEl.textContent = lang;
      badgeEl.dataset.lang = lang;
    }
    const toggle = $("mode-toggle");
    if (toggle) {
      const next = mode === "shell" ? "python" : mode === "python" ? "js" : "shell";
      toggle.textContent = next;
      toggle.setAttribute("aria-label", "Switch to " + next);
    }
    const ta = $("py-code");
    if (ta) ta.setAttribute("data-lang", mode === "js" ? "js" : "python");
    setPromptLabel();
  }

  function setMode(next) {
    if (next === "js" && !js()) {
      write([seg("red", "js: sandbox failed to load\n")]);
      return false;
    }
    mode = next === "js" ? "js" : next === "shell" ? "shell" : "python";
    if (mode === "shell" && py()) py().setMode("shell");
    if (mode === "python" && py()) { py().setMode("python"); py().resetBuffer(); }
    if (mode === "js" && js()) { js().setMode("js"); js().resetBuffer(); }
    syncChrome();
    return true;
  }

  function bootBanner() {
    term.replaceChildren();
    disconnected = false;
    input.disabled = false;
    if (mode === "python") {
      write([
        seg("cyan", "Python 3 — htp.sh (still-firefly-7b67ebk)\n"),
        seg("gray", "Functions and classes stay defined. ! runs a shell command. Ctrl+Enter runs the editor.\n"),
      ]);
    } else if (mode === "js" && js()) write(js().banner());
    else {
      write([
        seg("blink yellow", "⚡ HTP.SH – PRIVATE PROPERTY – TRESPASSERS WILL BE LULZED ⚡\n"),
        seg("red", "CARRIER DETECTED — 33600 bps — WELCOME TO HELL\n"),
        seg("cyan", "⚡ HTP.SH – LulzBoat ⚡ — SHENRON\n"),
        seg("gray", "type help · python for python3 · js for javascript · Ctrl+D disconnect\n"),
      ]);
    }
    syncChrome();
    promptLine();
  }

  /* ---------- dynamic commands ---------- */
  async function cmdFeed(arg) {
    const n = Math.min(Math.max(parseInt(arg, 10) || 12, 1), 80);
    write([seg("gray", "GET /x.ai/MadMonero …\n")]);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch("/x.ai/MadMonero", { signal: ctl.signal, headers: { accept: "text/plain" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.text();
      const lines = body.split("\n").filter((l) => l.trim()).slice(0, n);
      write(lines.join("\n") + "\n");
      write([seg("gray", "… full feed: ")]);
      writeLink("/x.ai/MadMonero", "/x.ai/MadMonero");
      write("\n");
    } catch (e) {
      write([seg("red", "feed: " + (e.name === "AbortError" ? "timed out" : e.message) + " (it only exists on live htp.sh)\n")]);
    } finally {
      clearTimeout(timer);
    }
  }

  function cmdResources() {
    write([seg("cyan", "loot table:\n")]);
    RESOURCES.forEach(([href, label]) => {
      write("  ");
      writeLink(href, label);
      write("\n");
    });
  }

  function cmdOpen(arg) {
    const key = (arg || "").trim().toLowerCase();
    const href = PAGES[key];
    if (!href) {
      write("open: unknown page. try: " + Object.keys(PAGES).join(" ") + "\n");
      return;
    }
    write([seg("green", "→ " + href + "\n")]);
    if (href.startsWith("/#")) {
      const target = document.querySelector(href.slice(1));
      if (target) { target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" }); return; }
    }
    setTimeout(() => { location.href = href; }, reducedMotion() ? 0 : 250);
  }

  function cmdHistory(arg) {
    if (arg === "-c") {
      history.length = 0;
      histIdx = 0;
      saveHistory();
      write("history cleared\n");
      return;
    }
    write(history.map((h, i) => String(i + 1).padStart(4) + "  " + h).join("\n") + (history.length ? "\n" : ""));
  }

  /** Names the in-page python filesystem currently holds, or the decoy set. */
  function shellFiles() {
    const names = new Set(Object.keys(FAKE_FS));
    const p = py();
    if (p && p.engine && p.engine.rt && p.engine.rt.fs) {
      for (const k of p.engine.rt.fs.keys()) names.add(k.replace(/^\//, ""));
    }
    return [...names].sort();
  }

  function cmdLs(arg) {
    const files = shellFiles();
    if (!files.length) {
      write("nothing here yet — python's `open(\"/notes.txt\",\"w\").write(\"x\")` puts files in this filesystem, and ls sees them.\n");
      return;
    }
    const columns = Math.max(1, Math.min(6, Math.floor((term.clientWidth || 640) / 120)));
    const width = Math.ceil(Math.max(...files.map((f) => f.length)) + 2);
    for (let i = 0; i < files.length; i += columns) {
      write("  " + files.slice(i, i + columns).map((f) => f.padEnd(width)).join("").trimEnd() + "\n");
    }
  }

  function cmdCat(arg) {
    const name = (arg || "").trim().replace(/^\/+/, "");
    if (!name) { write("cat: missing operand\n"); return; }
    if (FAKE_FS[name]) {
      if (name === "resources.txt") { cmdResources(); return; }
      write(FAKE_FS[name] + "\n");
      return;
    }
    const p = py();
    if (p && p.engine && p.engine.rt && p.engine.rt.fs.has("/" + name)) {
      const data = p.engine.rt.fs.get("/" + name);
      write(typeof data === "string" ? data : "[binary]\n");
      return;
    }
    write("cat: " + name + ": No such file in this shell\n");
  }

  function cmdTree() {
    const files = shellFiles();
    write(".\n");
    files.forEach((f, i) => write((i === files.length - 1 ? "└── " : "├── ") + f + "\n"));
  }

  function cmdFind(arg) {
    const needle = (arg || "").toLowerCase();
    const files = shellFiles().filter((f) => !needle || f.toLowerCase().includes(needle));
    write(files.length ? files.map((f) => "/" + f).join("\n") + "\n" : "find: nothing matching " + (needle || "*") + "\n");
  }

  function cmdDf() {
    const p = py();
    const used = p && p.engine && p.engine.rt ? [...p.engine.rt.fs.keys()].length : 0;
    write("filesystem   1K-blocks    used  available  use%  mounted on\n");
    write("in-memory          65536    " + String(used).padStart(5) + "      " + String(Math.max(0, 65536 - used)).padStart(6) + "   " + (used / 655) + "%  /\n");
  }

  function cmdDu(arg) {
    const files = shellFiles();
    const total = files.length;
    write(total + "K\t.\n" + (total ? "8K\t" + files[0] + "\n" : ""));
  }

  /* ---------- dispatcher ---------- */
  async function runShell(raw) {
    const typed = raw.trim();
    const low = typed.toLowerCase();
    const [head, ...rest] = low.split(/\s+/);

    if (!typed) return;
    if (low === "python" || low === "py" || low === "python3") {
      setMode("python"); bootBanner(); return "rebooted";
    }
    if (low === "js" || low === "node" || low === "javascript" || low === "ecmascript") {
      setMode("js"); bootBanner(); return "rebooted";
    }
    if (low === "shell" || low === "sh" || low === "tty" || low === "carrier") {
      setMode("shell"); bootBanner(); return "rebooted";
    }
    if (low === "clear") { bootBanner(); return "rebooted"; }
    if (low === "help" || low === "?") { write(HELP); write("\n"); return; }
    if (head === "man") { write((MAN[rest[0]] || (rest[0] ? "No manual entry for " + rest[0] : "What manual page do you want?")) + "\n"); return; }
    if (head === "history") { cmdHistory(rest[0]); return; }
    if (low === "resources" || low === "cat resources.txt" || low === "loot") { cmdResources(); return; }
    if (head === "feed" || low === "madmonero") { await cmdFeed(rest[0]); return; }
    if (low === "pages") { write(Object.entries(PAGES).map(([k, v]) => "  " + k.padEnd(10) + v).join("\n") + "\n"); return; }
    if (head === "open") { cmdOpen(rest[0]); return; }
    await runRemoteCommand(typed);
  }

  async function runRemoteCommand(typed) {
    try {
      const data = await remoteExecute({ command: typed });
      if (data.stdout) write(data.stdout.endsWith("\n") ? data.stdout : data.stdout + "\n");
      if (data.stderr) write([seg("red", data.stderr.endsWith("\n") ? data.stderr : data.stderr + "\n")]);
      if (!data.stdout && !data.stderr) write([seg("gray", data.ok ? "(no output)\n" : "command failed\n")]);
    } catch (e) {
      write([seg("red", "terminal: " + (e && e.name === "AbortError" ? "stopped" : (e && e.message) || e) + "\n")]);
    }
  }

  async function runPython(raw) {
    const typed = raw.replace(/\s+$/, "");
    write((pyBuffer ? "... " : ">>> ") + typed + "\n");
    if (typed === "shell" || typed === "exit()" || typed === "quit()") {
      pyBuffer = "";
      setMode("shell"); bootBanner(); return "rebooted";
    }
    if (typed === "js" || typed === "node") { pyBuffer = ""; setMode("js"); bootBanner(); return "rebooted"; }
    if (typed === "clear") { pyBuffer = ""; remoteExecute({ reset: true }).catch(() => {}); bootBanner(); return "rebooted"; }
    if (typed.startsWith("!")) {
      await runRemoteCommand(typed.slice(1));
      return undefined;
    }
    const block = pyBuffer ? pyBuffer + "\n" + typed : typed;
    let data;
    try {
      data = await remoteExecute({ mode: "repl", code: block });
    } catch (e) {
      pyBuffer = "";
      write([seg("red", "terminal: " + (e && e.name === "AbortError" ? "stopped" : (e && e.message) || e) + "\n")]);
      return undefined;
    }
    if (data.incomplete) {
      pyBuffer = block;
      write([seg("gray", "... waiting for the rest of the block\n")]);
      return "continued";
    }
    pyBuffer = "";
    if (data.stdout) write(data.stdout.endsWith("\n") ? data.stdout : data.stdout + "\n");
    if (data.stderr) write([seg("red", data.stderr.endsWith("\n") ? data.stderr : data.stderr + "\n")]);
    return undefined;
  }

  /** Async: the realm is a Worker on its own thread and answers by postMessage. */
  async function runJs(raw) {
    const a = js();
    const typed = raw.replace(/\s+$/, "");
    write((a.pending() || a.buffer ? "… " : "› ") + typed + "\n");
    if (typed === "shell" || typed === "exit()" || typed === "quit()") {
      setMode("shell"); bootBanner(); return "rebooted";
    }
    if (typed === "python" || typed === "py") { setMode("python"); bootBanner(); return "rebooted"; }
    if (typed === "clear") { a.resetBuffer(); a.stop(); bootBanner(); return "rebooted"; }
    // pushLine owns the continuation buffer: an unbalanced line is held and the
    // next one is appended to it. Buffering here as well split the two halves.
    // The Stop button is armed for the whole exchange: a javascript run is
    // asynchronous and can be a `while (true) {}` that only terminate() ends,
    // so a REPL-typed runaway needs the same escape hatch as the Run button.
    setStopEnabled(true);
    let res;
    try {
      res = await a.pushLine(typed);
    } catch (e) {
      res = { incomplete: false, output: "", error: "javascript: " + (e && e.message ? e.message : e) + "\n" };
    }
    if (res.incomplete) {
      setStopEnabled(false);
      write([seg("gray", "… waiting for the rest of the block\n")]);
      return "continued";
    }
    setStopEnabled(false);
    if (res.output) write(res.output.endsWith("\n") ? res.output : res.output + "\n");
    if (res.error) write([seg("red", res.error.endsWith("\n") ? res.error : res.error + "\n")]);
    return undefined;
  }

  async function exec(raw) {
    if (busy) return;
    if (disconnected) bootBanner();
    const value = String(raw == null ? "" : raw);
    pushHistory(value.trim());
    busy = true;
    wrap && wrap.setAttribute("aria-busy", "true");
    try {
      if (mode === "python") await runPython(value);
      else if (mode === "js") await runJs(value);
      else {
        write(SHELL_PROMPT + " " + value.trim() + "\n");
        await runShell(value);
      }
    } catch (e) {
      console.error("[htp terminal]", e);
      write([seg("red", "kernel panic (not really): " + (e && e.message ? e.message : e) + "\n")]);
    } finally {
      busy = false;
      wrap && wrap.removeAttribute("aria-busy");
    }
    // bootBanner() and the continuation branch draw their own prompt; drawing
    // again is harmless because promptLine() is idempotent.
    if (!disconnected) promptLine();
  }

  function disconnect(echo = true) {
    if (echo) { write(DISCONNECT); write("\n"); }
    disconnected = true;
    dropCursor();
    const label = $("term-prompt");
    if (label) label.textContent = "[no carrier]";
    input.value = "";
    input.placeholder = "press Enter to redial";
  }

  /* ---------- completion ---------- */
  function completions(cur) {
    if (mode === "python") return py() ? py().complete(cur) : [];
    if (mode === "js") return js() ? js().complete(cur) : [];
    const names = new Set([...Object.keys(CMDS), ...Object.keys(FAKE_FS), "help", "man", "echo", "date", "history",
      "resources", "feed", "open", "pages", "clear", "python", "py", "js", "node", "shell", "ls", "cat", "tree", "find", "df", "du", "run"]);
    const low = cur.toLowerCase();
    if (low.startsWith("open ") || low.startsWith("cd ")) {
      const pfx = low.slice(0, low.indexOf(" ") + 1);
      return Object.keys(PAGES).filter((k) => k.startsWith(low.slice(low.indexOf(" ") + 1))).map((k) => pfx + k);
    }
    if (low.startsWith("cat ")) return shellFiles().filter((f) => f.startsWith(low.slice(4))).map((f) => "cat " + f);
    return [...names].filter((k) => k.startsWith(low.trim())).sort();
  }

  /* ---------- the IDE: editor, run, stop ---------- */
  const editor = () => $("py-code");

  function setStopEnabled(on) {
    const btn = $("py-stop");
    if (btn) {
      btn.disabled = !on;
      // The button ships `hidden` in the markup. Toggling disabled/aria-hidden
      // alone left it invisible forever, so Stop could never be pressed.
      btn.hidden = !on;
      btn.setAttribute("aria-hidden", on ? "false" : "true");
    }
    wrap && wrap.setAttribute("data-running", on ? "1" : "0");
  }

  /** Print a completed run: stdout, then any error, then the timing line. */
  function reportRun(res, { timing = true } = {}) {
    if (res.output) write(res.output.endsWith("\n") ? res.output : res.output + "\n");
    if (res.error) write([seg("red", res.error.endsWith("\n") ? res.error : res.error + "\n")]);
    if (timing && typeof res.ms === "number") {
      write([seg("gray", "— " + res.ms + "ms" + (res.timeout ? " (stopped)" : "") + " —\n")]);
    }
  }

  /** Run whatever is in the editor with the requested engine. */
  async function runEditor(lang) {
    const ta = editor();
    const code = ta ? ta.value : "";
    if (!code.trim()) { write([seg("gray", "nothing to run — the editor is empty\n")]); promptLine(); return; }
    if (busy) { write([seg("yellow", "already running — press Ctrl+. to stop it\n")]); return; }
    const which = lang || (mode === "js" ? "js" : "python");
    if (which === "js" && !js()) {
      write([seg("red", "js: engine not loaded\n")]);
      promptLine();
      return;
    }
    setMode(which);
    write([seg("gray", "— run " + (which === "js" ? "worker.js" : "repl.py") + " —\n")]);
    busy = true;
    wrap && wrap.setAttribute("aria-busy", "true");
    setStopEnabled(true);
    let res;
    try {
      if (which === "js") {
        res = await js().runFile(code);
      } else {
        const data = await remoteExecute({ mode: "file", code: code });
        res = {
          output: data.stdout || "",
          error: data.stderr || "",
          ms: data.duration_ms,
        };
      }
    } catch (e) {
      res = { output: "", error: (e && e.name === "AbortError" ? "stopped\n" : "terminal: " + ((e && e.message) || e) + "\n"), ms: 0 };
    }
    busy = false;
    wrap && wrap.removeAttribute("aria-busy");
    setStopEnabled(false);
    reportRun(res);
    promptLine();
  }

  /** Ctrl+. — cooperative stop for python, frame teardown for javascript. */
  function stopEverything() {
    if (runAbort) runAbort.abort();
    remoteExecute({ cancel: true }).catch(() => {});
    pyBuffer = "";
    if (js()) js().stop();
    if (py()) py().stop();
    write([seg("yellow", "— stopped —\n")]);
    setStopEnabled(false);
    promptLine();
  }

  function gutter() {
    const ta = editor();
    const g = $("py-gutter");
    if (!ta || !g) return;
    const n = ta.value.split("\n").length;
    let text = "";
    for (let i = 1; i <= n; i++) text += String(i) + "\n";
    g.textContent = text;
    g.scrollTop = ta.scrollTop;
  }

  function wireEditor() {
    const ta = editor();
    if (!ta) return;
    ta.addEventListener("input", gutter);
    ta.addEventListener("scroll", gutter);
    let tabEscape = false;
    ta.addEventListener("blur", () => { tabEscape = false; });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { tabEscape = true; return; }
      if (e.key === "Tab" && (tabEscape || e.shiftKey)) { tabEscape = false; return; }
      tabEscape = false;

      // Ctrl/Cmd+Enter runs the editor. This has to be tested BEFORE the plain
      // Enter branch below: that branch matches on e.key alone and returns, so
      // a modifier-bearing Enter used to fall into auto-indent and never run
      // anything at all — the documented shortcut was dead.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        runEditor(mode === "js" ? "js" : "python");
        return;
      }
      if (e.key === "." && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        stopEverything();
        return;
      }

      const isJs = mode === "js";
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        if (s !== en) {
          // Block indent / dedent over the selected lines.
          const startLine = ta.value.lastIndexOf("\n", s - 1) + 1;
          const endLine = ta.value.indexOf("\n", en) === -1 ? ta.value.length : ta.value.indexOf("\n", en);
          const block = ta.value.slice(startLine, endLine);
          const next = e.shiftKey
            ? block.replace(/^ {1,4}/gm, "")
            : block.replace(/^/gm, "    ");
          ta.value = ta.value.slice(0, startLine) + next + ta.value.slice(endLine);
          ta.selectionStart = startLine;
          ta.selectionEnd = startLine + next.length;
        } else {
          ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(en);
          ta.selectionStart = ta.selectionEnd = s + 4;
        }
        gutter();
        return;
      }
      if (e.key === "Enter") {
        // Auto-indent: keep the current line's indent, add one level after ':'.
        const s = ta.selectionStart;
        if (s !== ta.selectionEnd) return;
        const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
        const lineText = ta.value.slice(lineStart, s);
        const indent = (lineText.match(/^[ \t]*/) || [""])[0];
        const extra = isJs ? /[:{[(]\s*$/.test(lineText) : lineText.trimEnd().endsWith(":");
        const insert = "\n" + indent + (extra ? "    " : "");
        e.preventDefault();
        ta.value = ta.value.slice(0, s) + insert + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + insert.length;
        gutter();
        return;
      }
      // Bracket / quote pairs.
      const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
      if (PAIRS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const s = ta.selectionStart;
        if (s === ta.selectionEnd) {
          e.preventDefault();
          ta.value = ta.value.slice(0, s) + e.key + PAIRS[e.key] + ta.value.slice(s);
          ta.selectionStart = ta.selectionEnd = s + 1;
          gutter();
        }
        return;
      }
      if ((e.key === ")" || e.key === "]" || e.key === "}" || (e.key === '"' && !isJs)) && ta.selectionStart === ta.selectionEnd) {
        const s = ta.selectionStart;
        if (ta.value[s] === e.key) {
          e.preventDefault();
          ta.selectionStart = ta.selectionEnd = s + 1;
        }
      }
    });
    gutter();
  }

  /* ---------- input wiring ---------- */
  input.addEventListener("keydown", (e) => {
    const { key } = e;
    if (busy && key === "Enter") { e.preventDefault(); return; }

    // Tab completes only when there's something to complete; otherwise focus moves on (no keyboard trap).
    if (key === "Tab" && !e.shiftKey && input.value.trim()) {
      e.preventDefault();
      const hits = completions(input.value);
      if (hits.length === 1) input.value = hits[0];
      else if (hits.length > 1) { write(hits.join("  ") + "\n"); showCursor(); }
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      const v = input.value;
      input.value = "";
      input.placeholder = "";
      if (disconnected) { bootBanner(); return; }
      exec(v);
      return;
    }
    if (key === "ArrowUp") {
      if (!history.length) return;
      e.preventDefault();
      if (histIdx === history.length) draft = input.value;
      histIdx = Math.max(0, histIdx - 1);
      input.value = history[histIdx] || "";
      return;
    }
    if (key === "ArrowDown") {
      e.preventDefault();
      if (histIdx < history.length - 1) { histIdx++; input.value = history[histIdx]; }
      else { histIdx = history.length; input.value = draft; }
      return;
    }
    if (key === "Escape") { input.blur(); return; }
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "l") { e.preventDefault(); bootBanner(); return; }
      if (k === ".") { e.preventDefault(); stopEverything(); return; }
      if (k === "c" && input.selectionStart === input.selectionEnd) { // with a selection, let copy work
        e.preventDefault();
        if (py()) py().resetBuffer();
        if (js()) js().resetBuffer();
        write("^C\n");
        promptLine();
        return;
      }
      if (k === "d") { e.preventDefault(); disconnect(true); }
    }
  });
  if (form) form.addEventListener("submit", (e) => e.preventDefault());

  // Click on the scrollback focuses the prompt — unless the user is selecting text or hit a control.
  if (wrap) {
    wrap.addEventListener("click", (e) => {
      const tgt = e.target;
      if (!tgt || tgt === input) return;
      if (tgt.closest && tgt.closest("textarea, button, a, input, label, select, .py-editor, .py-status")) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel)) return;
      focus();
    });
  }

  function focus() {
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  }

  // Ghost crew "SHELL MOVES" buttons (rendered by htp-app.js) — delegated, no synthetic key events.
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest(".ghost-cmd[data-cmd]");
    if (!b) return;
    e.preventDefault();
    setMode("shell");
    if (wrap) wrap.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    exec(b.dataset.cmd || "");
    focus();
  });

  // Music link
  const music = $("music-link");
  const bgm = $("bgmusic");
  if (music && bgm) {
    music.addEventListener("click", (e) => {
      e.preventDefault();
      bgm.volume = 0.45;
      if (bgm.paused) bgm.play().catch(() => {});
      else bgm.pause();
    });
  }

  /* ---------- chrome buttons ---------- */
  function on(id, handler) {
    const el = $(id);
    if (el) el.addEventListener("click", handler);
  }
  on("py-run", () => runEditor(mode === "js" ? "js" : "python"));
  on("py-run-js", () => runEditor("js"));
  on("py-stop", stopEverything);
  on("py-clear", () => {
    pyBuffer = "";
    remoteExecute({ reset: true }).catch(() => {});
    if (py()) py().reset();
    if (js()) { js().resetBuffer(); js().stop(); }
    bootBanner();
  });
  on("mode-toggle", () => {
    setMode(mode === "shell" ? "python" : mode === "python" ? "js" : "shell");
    bootBanner();
  });

  /* ---------- boot ---------- */

  /**
   * `input()` is synchronous inside the interpreter, so it cannot block on a
   * promise for the visitor's keystrokes. It reads the prompt field instead:
   * type the answer at >>> first, then run the code that asks for it. Before
   * this hook existed the builtin returned "" unconditionally, so every
   * `name = input("name? ")` program silently stored an empty string.
   */
  function wireInputHook() {
    const p = py();
    if (!p || !p.engine || !p.engine.rt) return;
    p.engine.rt.inputHook = (ask) => {
      const value = input.value;
      if (ask) write([seg("cyan", String(ask))]);
      input.value = "";
      return value;
    };
  }

  term.setAttribute("role", "log");
  term.setAttribute("aria-live", "polite");
  term.setAttribute("aria-relevant", "additions");
  term.setAttribute("aria-label", "Terminal output");
  const staticTerm = $("terminal-static");
  if (staticTerm) staticTerm.hidden = true;
  setStopEnabled(false);
  wireEditor();
  wireInputHook();

  window.HTPTerminal = {
    exec,
    reboot: bootBanner,
    clear: bootBanner,
    runEditor,
    stop: stopEverything,
    setMode,
    getMode: () => mode,
    writeRaw(text) { write(String(text)); },
    writeError(text) { write([seg("red", String(text))]); },
    prompt: promptLine,
    focus,
  };

  bootBanner();
})();
