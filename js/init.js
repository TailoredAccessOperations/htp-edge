// Shared first-gesture arbiter + no-JS/JS class bookkeeping.
//
// Autoplay policy: a keypress is NOT a user-activation gesture in Chrome, so
// keying media startup off "keydown" only produced churn (and fired a 14.5MB
// video + two audio tracks the moment the visitor typed their first terminal
// command). One real pointer/tap gesture arms exactly one media start.
//
// Loaded first (defer, in <head>) so window.__htpMedia exists before the
// playlist / love / malware modules evaluate.
(function () {
  "use strict";

  var root = document.documentElement;
  var claimed = false;
  var pending = [];

  // A real gesture: pointerdown, touchstart, or click. Not keydown.
  function realGesture() {
    if (claimed) return;
    claimed = true;
    var waiters = pending;
    pending = [];
    for (var i = 0; i < waiters.length; i++) {
      try {
        waiters[i]();
      } catch (e) {
        /* a broken media starter must not block the rest */
      }
    }
  }

  function onGesture(fn) {
    if (claimed) {
      fn();
      return;
    }
    pending.push(fn);
  }

  var EVENTS = ["pointerdown", "touchstart", "click"];

  function arm() {
    for (var i = 0; i < EVENTS.length; i++) {
      document.addEventListener(EVENTS[i], realGesture, {
        capture: true,
        passive: true,
        once: true,
      });
    }
  }

  window.__htpMedia = { onGesture: onGesture, armed: arm, done: function () { return claimed; } };

  // Both classes are swapped in one synchronous pass. A deferred script runs
  // after the document is parsed, so <body> already exists here — the previous
  // version waited for DOMContentLoaded, which left `.js` on <html> (hiding the
  // static fallback) while `no-js` was still on <body> (hiding the live tty),
  // so the terminal was a blank box for a frame.
  root.classList.add("js");
  root.classList.remove("no-js");
  if (document.body) {
    document.body.classList.add("js");
    document.body.classList.remove("no-js");

    // The tap-to-start splash ships `hidden` and is only revealed here, once we
    // know JS is live. Unhiding it any earlier would trap a no-JS visitor
    // behind a gate that nothing can dismiss. playlist.js hides it again on
    // the first gesture, which is also what unlocks media playback.
    var boot = document.getElementById("htp-boot");
    if (boot) boot.hidden = false;
  }
})();
