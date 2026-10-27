/*!
 * js-shell.js — the terminal's JavaScript runner.
 *
 * Public API: window.HTPJavaScript = { run, pushLine, runFile, stop, reset,
 *                                       mode, complete, banner, setMode }
 *
 * EXECUTION MODEL
 *   User code runs in a dedicated Web Worker (/js/js-worker.js) owned by this
 *   file. The Worker has its own thread, so a runaway loop is killable from
 *   outside with `terminate()` while the page keeps painting. This replaced an
 *   iframe that framed an inert same-origin document — which shares the
 *   renderer's main thread with the page, so `while (true) {}` in it froze the
 *   page, and the parent's Stop timer could not fire to rescue it. See the
 *   header of js-worker.js for the full reasoning.
 *
 *   The Worker inherits this site's CSP from its own script response, which is
 *   why that one path is served with 'unsafe-eval' (src/security.js).
 *
 * THREE JOINS
 *
 *   1. Source scanning. `isIncomplete` decides whether a REPL line is still
 *      open, and `scan().hoisted` rewrites top-level `let`/`const`/`class` to
 *      `var` so bindings survive into the realm's global scope between
 *      submissions. Both need a scanner that is not fooled by braces inside
 *      strings, comments, template literals, or regex literals — counting
 *      brackets naively reports `"}"` as an unbalanced brace forever.
 *
 *   2. Deadlines. The realm announces itself with a `ready` message. If the
 *      Worker never starts — blocked by CSP, a 500 on the script, a syntax
 *      error — nothing resolves, so `run()` used to hang forever and the
 *      terminal sat there looking busy with no Stop that worked. Boot is
 *      therefore bounded, and so is each run.
 *
 *   3. Source attribution. Every reply is matched against the request that
 *      asked for it, by id, before it is allowed to resolve a promise.
 */
(function () {
  "use strict";

  // Version token, for the same reason every other script on this page carries
  // one: /js/*.js is served with `s-maxage=86400`, so an edit to a fixed URL is
  // invisible for a day. The realm is not loaded by a <script src> in the
  // markup, so it cannot pick up the ?v= the page hands its siblings — it has
  // to be spelled here, and bumped here.
  var WORKER_SRC = "/js/js-worker.js?v=1";
  var DEFAULT_TIMEOUT = 5000;
  var BOOT_TIMEOUT = 4000;
  var MAX_OUTPUT = 180000;
  var VERSION = "JavaScript (htp shell) — ES2023 in a worker realm";
  var BANNER =
    "JavaScript " + VERSION + "\n" +
    "Network is off. The same rule as python3: no sockets, no fetch.\n" +
    "Bindings persist between lines, like a real REPL. Run executes the editor.\n" +
    "No DOM in here — this is a worker. Ctrl+. stops a runaway loop instantly.\n" +
    "Type shell for the carrier tty.\n";

  var worker = null;
  var ready = false;
  var realmToken = null;
  var queue = [];
  var seq = 0;
  var pending = null;
  var timer = null;
  var bootTimer = null;
  var buffer = "";
  var mode = "js";
  var onOutput = null;

  /* ------------------------------------------------------------------ scan */

  var OPEN = { "(": ")", "[": "]", "{": "}" };

  /**
   * One pass over `src`, tracking enough lexical state to know where braces
   * really are, and to find top-level `let`/`const`/`class` tokens.
   *
   * Returns { depth, open, incomplete, hoisted, unterminated } where `hoisted`
   * is `src` with those declarations rewritten to `var` (for `class`, to
   * `var X = class X`) so a global eval leaves them on globalThis.
   *
   * Regex-vs-division is the classic ambiguity; it is resolved with the usual
   * "a regex can only start where an operand is expected" rule, so
   * `a / b / c` stays division and `/[{]/g` stays a regex.
   */
  function scan(src) {
    var i = 0;
    var n = src.length;
    var depth = 0;
    var stack = [];
    var out = "";
    var lastCopy = 0;
    // The last significant (non-whitespace, non-comment) character.
    var prev = "";
    // True when a line break separates `prev` from the token being read, which
    // is what makes `a = 1 // note` then `let b = 2` two statements.
    var nlSinceToken = false;

    function operandExpected() {
      if (prev === "") return true;
      if (OPEN[prev] || prev === "," || prev === ";" || prev === ":" ||
          prev === "=" || prev === "!" || prev === "&" || prev === "|" ||
          prev === "?" || prev === "+" || prev === "-" || prev === "*" ||
          prev === "/" || prev === "<" || prev === ">" || prev === "~" ||
          prev === "^" || prev === "%" || prev === "}") return true;
      return false;
    }

    function startsDeclaration(word) {
      // `foo.class` / `foo.let` are legal member reads (reserved words are
      // allowed after a dot), not declarations.
      if (prev === "." || prev === "?") return false;
      if (!operandExpected() && !nlSinceToken) return false;
      // `let:` / `const:` are labels, not declarations.
      var rest = src.slice(i + word.length);
      if (/^\s*:/.test(rest)) return false;
      return /^\s*[A-Za-z_$]/.test(rest);
    }

    var unterminated = null;

    while (i < n) {
      var c = src[i];
      var c2 = src.slice(i, i + 2);

      // ---- line comment
      if (c2 === "//") {
        var nl = src.indexOf("\n", i);
        i = nl === -1 ? n : nl;
        continue;
      }
      // ---- block comment
      if (c2 === "/*") {
        var close = src.indexOf("*/", i + 2);
        if (close === -1) { unterminated = "/*"; i = n; break; }
        if (src.slice(i, close).indexOf("\n") !== -1) nlSinceToken = true;
        i = close + 2;
        continue;
      }
      // ---- strings
      if (c === '"' || c === "'") {
        var qEnd = skipQuote(src, i, c);
        if (qEnd === -1) { unterminated = c; i = n; break; }
        i = qEnd;
        prev = c;
        nlSinceToken = false;
        continue;
      }
      // ---- template literal, with ${} nesting
      if (c === "`") {
        var tEnd = skipTemplate(src, i);
        if (tEnd === -1) { unterminated = "`"; i = n; break; }
        i = tEnd;
        prev = "`";
        nlSinceToken = false;
        continue;
      }
      // ---- regex literal
      if (c === "/" && operandExpected()) {
        var rEnd = skipRegex(src, i);
        if (rEnd !== -1) {
          i = rEnd;
          prev = "/";
          nlSinceToken = false;
          continue;
        }
      }

      // ---- declaration keywords at statement position
      if ((c === "l" && src.startsWith("let", i)) ||
          (c === "c" && (src.startsWith("const", i) || src.startsWith("class", i)))) {
        var word = c === "l" ? "let" : src.startsWith("const", i) ? "const" : "class";
        if (depth === 0 && startsDeclaration(word)) {
          out += src.slice(lastCopy, i);
          if (word === "class") {
            // `class X …` → `var X = class X …`. An anonymous class in statement
            // position is already a syntax error, so leaving it alone is right.
            var m = /^class\s+([A-Za-z_$][\w$]*)/.exec(src.slice(i));
            if (m) {
              out += "var " + m[1] + " = class " + m[1];
              i += m[0].length;
              lastCopy = i;
              i--;
              continue;
            }
          } else {
            out += "var";
            i += word.length;
            lastCopy = i;
            i--;
            continue;
          }
        }
      }

      // ---- braces and parens
      if (OPEN[c]) {
        depth++;
        stack.push(c);
      } else if (c === ")" || c === "]" || c === "}") {
        depth = Math.max(0, depth - 1);
        stack.pop();
      }

      if (!/\s/.test(c)) {
        prev = c;
        nlSinceToken = false;
      } else if (c === "\n") {
        nlSinceToken = true;
      }
      i++;
    }

    out += src.slice(lastCopy);
    return {
      depth: depth,
      open: stack[stack.length - 1] || null,
      incomplete: depth > 0 || !!unterminated,
      hoisted: out,
      unterminated: unterminated
    };
  }

  /* Return the index just past the closing quote, or -1 if it never closes. */
  function skipQuote(src, i, quote) {
    i++;
    while (i < src.length) {
      var c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === quote) return i + 1;
      if (c === "\n") return -1; // a raw newline ends a single-quoted literal
      i++;
    }
    return -1;
  }

  /* Return the index just past the closing backtick, or -1 if it never closes. */
  function skipTemplate(src, i) {
    i++;
    while (i < src.length) {
      var c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") return i + 1;
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        var d = 1;
        while (i < src.length && d > 0) {
          var e = src[i];
          if (e === "{") d++;
          else if (e === "}") d--;
          else if (e === "`") { var t = skipTemplate(src, i); if (t === -1) return -1; i = t - 1; }
          else if (e === '"' || e === "'") { var q = skipQuote(src, i, e); if (q === -1) return -1; i = q - 1; }
          else if (src.slice(i, i + 2) === "//") { var nl = src.indexOf("\n", i); i = nl === -1 ? src.length : nl; }
          else if (src.slice(i, i + 2) === "/*") { var cl = src.indexOf("*/", i + 2); i = cl === -1 ? src.length : cl + 1; }
          i++;
        }
        continue;
      }
      i++;
    }
    return -1;
  }

  function skipRegex(src, i) {
    i++;
    var inClass = false;
    while (i < src.length) {
      var c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n") return -1;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        i++;
        while (i < src.length && /[a-z]/.test(src[i])) i++;
        return i;
      }
      i++;
    }
    return -1;
  }

  /* --------------------------------------------------------------- runtime */

  function teardown(reason) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } }
    worker = null;
    ready = false;
    realmToken = null;
    var p = pending;
    pending = null;
    var waiting = queue.splice(0, queue.length);
    waiting.forEach(function (w) { w.reject(new Error(reason || "realm stopped")); });
    if (p) p.resolve({ output: buffer, error: reason ? reason : null, value: "", ms: 0, timeout: !!reason });
    buffer = "";
  }

  function ensureRealm() {
    if (worker && ready) return Promise.resolve();
    if (worker && !ready) {
      return new Promise(function (resolve, reject) {
        queue.push({ resolve: resolve, reject: reject });
      });
    }
    buffer = "";
    // Every exchange with the realm carries this token, and the realm echoes it
    // back. It is the attribution check: `ev.source` cannot be used, because for
    // a Worker message the browser hands back a DedicatedWorkerGlobalScope
    // proxy that is never `===` the Worker object this file holds — so an
    // identity test there rejects every legitimate reply, and the shell hangs
    // until the boot deadline with no explanation.
    realmToken = "htp-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
    worker = new Worker(WORKER_SRC);
    // Listen on the Worker object, not on `window`.
    //
    // The obvious `window.addEventListener("message", …)` does not work here, and
    // its failure is silent: this browser delivers a DedicatedWorker's messages
    // only to listeners registered on the Worker instance, so a window listener
    // sees the YouTube iframe's postMessage traffic and never the realm's
    // `ready`, and the shell sits there until the boot deadline expires.
    // Listening on the object we created is also strictly more correct: there is
    // no cross-talk from any other frame on the page to filter out.
    var token = realmToken;
    worker.onmessage = function (ev) { handleRealmMessage(ev, token); };
    worker.onerror = function () {
      // A syntax error or a CSP refusal lands here and nowhere else.
      teardown("Error: the javascript realm failed to load (" + WORKER_SRC + ").\n");
    };
    var boot = new Promise(function (resolve, reject) { queue.push({ resolve: resolve, reject: reject }); });
    // Bounded boot. Without this the promise never settles when the Worker is
    // refused, and the terminal hangs with a Stop button that cannot help.
    bootTimer = setTimeout(function () {
      bootTimer = null;
      teardown("TimeoutError: the javascript realm never started.\n");
    }, BOOT_TIMEOUT);
    return boot;
  }

  /**
   * One reply from the realm. Bound to the Worker that produced it, so nothing
   * from any other frame on this page can reach it.
   *
   * `ready` settles every caller waiting on the boot. A run reply resolves only
   * the exchange whose id it answers AND whose token matches the realm that is
   * currently on screen, so a terminated realm's late answer cannot resolve a
   * newer run.
   */
  function handleRealmMessage(ev, token) {
    var d = (ev && ev.data) || {};
    if (!d || typeof d !== "object") return;
    if (d.kind === "ready") {
      if (ready) return;
      ready = true;
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
      var waiting = queue.splice(0, queue.length);
      waiting.forEach(function (w) { w.resolve(); });
      return;
    }
    if (d.kind !== "run" || !pending || d.id !== pending.id) return;
    if (d.token !== token) return;
    var p = pending;
    pending = null;
    if (timer) { clearTimeout(timer); timer = null; }
    var out = (buffer || "") + (d.out || "");
    buffer = "";
    if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT) + "\n[output truncated]\n";
    var error = d.ok ? null : "Uncaught " + (d.error || "error") + "\n";
    if (typeof onOutput === "function") onOutput(out, d.ok ? "stdout" : "stderr");
    p.resolve({ output: out, error: error, value: d.ok ? d.value || "" : "", ms: d.ms || 0, timeout: false });
  }

  /**
   * Run `source` in the realm.
   * Resolves with { output, error, value, ms, timeout }. Never rejects.
   */
  function run(source, options) {
    options = options || {};
    var limit = options.timeout == null ? DEFAULT_TIMEOUT : options.timeout;
    var src = String(source == null ? "" : source);
    var parsed;
    try {
      parsed = scan(src);
    } catch (e) {
      return Promise.resolve({
        output: "",
        error: "SyntaxError: could not scan submission (" + (e && e.message ? e.message : e) + ")\n",
        value: "",
        ms: 0,
        timeout: false
      });
    }
    if (options.allowIncomplete && parsed.incomplete) {
      return Promise.resolve({ output: "", error: null, value: "", ms: 0, timeout: false, incomplete: true });
    }

    return ensureRealm().then(function () {
      return new Promise(function (resolve) {
        seq += 1;
        pending = { id: seq, resolve: resolve };
        buffer = "";
        timer = setTimeout(function () {
          // terminate() is the ONLY way to stop a loop that is already on the
          // stack. It is instant and exact because the realm has its own thread.
          teardown("TimeoutError: execution exceeded " + (limit / 1000) + "s and was stopped.\n");
        }, limit);
        worker.postMessage({ kind: "run", id: seq, source: parsed.hoisted, token: realmToken });
      });
    }).catch(function (e) {
      var msg = e && e.message ? e.message : String(e);
      if (/never started|failed to load/.test(msg)) teardown(null);
      return { output: "", error: "sandbox failed to start: " + msg + "\n", value: "", ms: 0, timeout: false };
    });
  }

  /** Hard-stop whatever is running right now. No-op when idle. */
  function stop() {
    if (pending) teardown("KeyboardInterrupt: stopped.\n");
  }

  var globals = new Set(["console", "print", "assert", "JSON", "Math", "Object", "Array", "String", "Number",
    "Boolean", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Promise", "Symbol", "Error", "TypeError",
    "RangeError", "SyntaxError", "BigInt", "Proxy", "Reflect", "parseInt", "parseFloat", "isNaN", "isFinite",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone", "queueMicrotask",
    "globalThis", "undefined", "NaN", "Infinity", "Intl", "TextEncoder", "TextDecoder", "Uint8Array",
    "Int8Array", "Uint8ClampedArray", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "Float32Array",
    "Float64Array", "ArrayBuffer", "DataView", "Blob", "URL", "URLSearchParams", "AbortController",
    "WeakRef", "FinalizationRegistry"]);

  var api = {
    version: VERSION,
    banner: function () { return BANNER; },
    mode: "js",
    buffer: "",
    pending: function () { return !!pending; },
    setMode: function (m) {
      api.mode = m === "shell" ? "shell" : "js";
    },
    resetBuffer: function () { api.buffer = ""; },
    run: run,
    stop: stop,
    /** Run a file's worth of source, resolving to { output, error, value }. */
    runFile: function (src, opts) { return run(src, opts); },
    /** REPL line. Completion values are echoed the way the python REPL does. */
    pushLine: function (line) {
      var text = api.buffer ? api.buffer + "\n" + line : line;
      if (!text.trim()) { api.buffer = ""; return Promise.resolve({ incomplete: false, output: "", error: null }); }
      if (api.isIncomplete(text)) {
        api.buffer = text;
        return Promise.resolve({ incomplete: true, output: "", error: null });
      }
      api.buffer = "";
      return run(text).then(function (r) {
        var out = r.output || "";
        if (r.value) out += r.value + "\n";
        return { incomplete: false, output: out, error: r.error, timeout: r.timeout };
      });
    },
    /** True when the submission is obviously still open (unbalanced brace or quote). */
    isIncomplete: function (src) {
      try {
        var r = scan(String(src == null ? "" : src));
        return r.depth > 0 || !!r.unterminated;
      } catch (e) {
        return false;
      }
    },
    /** Expose the source scanner for tests and for tools that need to pre-check. */
    scan: scan,
    complete: function (prefix) {
      var p = String(prefix || "");
      var out = [];
      globals.forEach(function (g) { if (g.startsWith(p)) out.push(g); });
      return out.sort();
    },
    /** Called by the IDE so JS output can be coloured like python's. */
    onOutput: function (fn) { onOutput = fn; }
  };

  window.HTPJavaScript = api;
  window.HTPJsShell = api;
})();