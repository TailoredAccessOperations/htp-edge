/* htp.sh — JavaScript execution realm.
 *
 * Loaded by /js/js-shell.js as a dedicated Web Worker:
 *
 *     new Worker("/js/js-worker.js")
 *
 * WHY A WORKER AND NOT AN IFRAME
 *   The first implementation framed an inert same-origin document and destroyed
 *   the frame to stop a runaway loop. That does not work. A same-origin frame
 *   shares the renderer's main thread with the page, so `while (true) {}` inside
 *   it blocks the page too — and with the page blocked, the parent's own Stop
 *   timer cannot fire, so the only thing that can end it is closing the tab.
 *   There is no way to tear down a frame from inside a thread that frame is
 *   occupying.
 *
 *   A dedicated Worker owns its own thread. `terminate()` kills a spinning loop
 *   from outside, immediately, while the page keeps painting and the Stop button
 *   keeps working. That is the whole reason this file exists.
 *
 *   Two consequences of the move, both accepted deliberately:
 *     · there is no DOM in here, so `document.…` one-liners no longer work;
 *     · the worker inherits this site's CSP from its own script response, which
 *       is why /js/js-worker.js is the one path served with 'unsafe-eval'
 *       (see FRAMABLE_PATHS → EVAL_ONLY_PATHS in src/security.js). Turning a
 *       string into code is this file's entire purpose.
 *
 * Job, in order:
 *   1. Cut the realm off from the network before any user code runs. The python
 *      shell already refuses sockets (denyNet in py-shell.js); this is the same
 *      promise for JavaScript. Every egress door is replaced with a thrower.
 *   2. Evaluate what the parent posts, buffer console output plus the completion
 *      value, postMessage both back, and hand control straight back.
 *
 * State persists across submissions because this realm's global scope is the
 * worker's own, and the parent hoists top-level `let`/`const`/`class` to `var`
 * before posting (see hoistDeclarations in js-shell.js) — that is the one thing
 * a global eval drops.
 */
"use strict";

var DENY = "network is disabled in this shell";
function denied(name) {
  return function () {
    throw new Error(DENY + " (blocked " + name + ")");
  };
}

// Replace the constructors AND the instances people reach for indirectly.
try { self.fetch = denied("fetch"); } catch (e) { /* frozen */ }
try { self.XMLHttpRequest = denied("XMLHttpRequest"); } catch (e) { /* frozen */ }
try { self.WebSocket = denied("WebSocket"); } catch (e) { /* frozen */ }
try { self.EventSource = denied("EventSource"); } catch (e) { /* frozen */ }
try { self.importScripts = denied("importScripts"); } catch (e) { /* frozen */ }
try { self.RTCPeerConnection = denied("RTCPeerConnection"); } catch (e) { /* frozen */ }
try { self.Worker = denied("Worker"); } catch (e) { /* frozen */ }
try { self.SharedWorker = denied("SharedWorker"); } catch (e) { /* frozen */ }
try { self.BroadcastChannel = denied("BroadcastChannel"); } catch (e) { /* frozen */ }
try { self.navigator && (self.navigator.sendBeacon = denied("sendBeacon")); } catch (e) { /* frozen */ }

/* ---- output buffering ------------------------------------------------- */
var OUT_MAX = 180000;
var buf = "";

function emit(text) {
  buf += text;
  if (buf.length > OUT_MAX) buf = buf.slice(0, OUT_MAX) + "\n[output truncated]\n";
}

function fmt(value, depth) {
  depth = depth || 0;
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[Function: " + (value.name || "anonymous") + "]";
  if (value instanceof Error) return (value.stack || value.name + ": " + value.message);
  if (depth > 4) return "…";
  if (Array.isArray(value)) {
    if (depth > 1 && value.length > 200) return "[Array(" + value.length + ")]";
    return "[" + value.map(function (v) { return fmt(v, depth + 1); }).join(", ") + "]";
  }
  if (typeof value === "object") {
    var ctor = value.constructor && value.constructor.name;
    var prefix = ctor && ctor !== "Object" ? ctor + " " : "";
    var keys = Object.keys(value);
    if (depth > 1 && keys.length > 40) return prefix + "{… " + keys.length + " keys}";
    return prefix + "{" + keys.map(function (k) { return k + ": " + fmt(value[k], depth + 1); }).join(", ") + "}";
  }
  return String(value);
}

var LEVELS = ["log", "info", "debug", "warn", "error", "trace"];
LEVELS.forEach(function (level) {
  console[level] = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i], 0));
    emit(parts.join(" ") + "\n");
  };
});
console.table = function (value) {
  var rows = [];
  if (Array.isArray(value)) {
    for (var i = 0; i < Math.min(value.length, 50); i++) rows.push(fmt(value[i], 0));
  } else if (value && typeof value === "object") {
    Object.keys(value).slice(0, 50).forEach(function (k) { rows.push(k + ": " + fmt(value[k], 0)); });
  } else rows.push(fmt(value));
  emit(rows.join("\n") + "\n");
};
console.clear = function () { emit("\x1b[2J\x1b[H"); };
console.dir = console.log;
console.group = console.log;
console.groupEnd = function () {};
console.time = function () {};
console.timeEnd = function () {};
console.assert = function (ok, msg) { if (!ok) emit("Assertion failed" + (msg ? ": " + msg : "") + "\n"); };
console.count = function () {};

// `print()` is the shell's alias, matching the python side.
self.print = function () {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i], 0));
  emit(parts.join(" ") + "\n");
};

// `assert(cond, msg)` is a statement-shaped throw, same as python's.
self.assert = function (ok, msg) {
  if (!ok) throw new Error("Assertion failed" + (msg ? ": " + msg : ""));
};

/* ---- run -------------------------------------------------------------- */
// Indirect eval: global scope, so `var`/`function` persist between submissions
// and the return value is the completion value, exactly like a real REPL.
var globalEval = (0, eval);

function run(id, source, token) {
  var started = Date.now();
  var out;
  var value;
  var error = null;
  try {
    value = globalEval(String(source));
  } catch (e) {
    error = (e && e.stack) ? String(e.stack) : String(e);
  }
  out = buf;
  buf = "";
  self.postMessage({
    // `kind` is what the parent dispatches on. It was missing here once, and
    // every reply then fell through the parent's guard as an unrecognised
    // message — the shell showed nothing at all, silently, while the realm was
    // demonstrably working.
    kind: "run",
    id: id,
    token: token,
    ok: !error,
    out: out,
    value: error ? "" : (value === undefined ? "" : fmt(value, 0)),
    error: error,
    ms: Date.now() - started
  });
}

self.addEventListener("message", function (ev) {
  var d = ev.data || {};
  // Echoed back verbatim: it is how the parent attributes a reply to the realm
  // it is currently talking to, and it is not secret — it only has to be unique
  // per realm so a terminated realm's late answer cannot resolve a new run.
  if (d.kind === "run") run(d.id, d.source, d.token);
  if (d.kind === "reset") buf = "";
  if (d.kind === "names") self.postMessage({ kind: "names", id: d.id, token: d.token, names: Object.keys(self).filter(function (k) {
    return !/^[A-Z_]/.test(k);
  }) });
});

// Tell the parent the realm is live before it posts any source.
self.postMessage({ kind: "ready" });