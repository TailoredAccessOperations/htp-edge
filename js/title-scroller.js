/**
 * Title scroller for htp.sh
 *
 * Scrolls a katakana ring through document.title.
 *
 * The previous version serialised the entire document to base64 (~110KB of
 * ciphertext), kept that string alive forever, and rewrote document.title every
 * 100ms. A 109,084-character tab title forces the browser to re-render the tab
 * and window title 10x/second, which starved the rAF matrix rain and the
 * terminal's setTimeout typing animation — the tty would stall mid-output and
 * the page felt frozen. This version is bounded: a fixed 48-char ring, a 450ms
 * cadence, and it stops entirely while the tab is hidden.
 */
(function () {
  "use strict";

  var SEED = "HTP | 1.3.3.7 – Private System Notice";
  var KEY = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0];
  var GLYPHS =
    "アイウエオカキクケコサシスセソタチツテトナニヌネノ" +
    "ハヒフヘホマミムメモヤユヨラリルレロワヲン";
  var RING = 48; // chars kept in the rotating ring
  var TICK_MS = 450;

  // Deterministic katakana ring derived from the seed — no DOM serialization,
  // no multi-hundred-kilobyte intermediate strings retained in memory.
  function buildRing(seed) {
    var out = "";
    for (var i = 0; i < RING; i++) {
      var h = KEY[i % KEY.length];
      for (var j = 0; j < seed.length; j++) h = (h * 31 + seed.charCodeAt(j) + i) & 0xff;
      out += GLYPHS[h % GLYPHS.length];
    }
    return out;
  }

  var ring = buildRing(SEED);
  var offset = 0;
  var timer = null;

  function paint() {
    offset = (offset + 1) % ring.length;
    // A window/OS title longer than a couple hundred chars is unreadable and
    // costs a full title re-layout on every assignment. Cap it.
    document.title = ring.slice(offset) + ring.slice(0, offset) + " · HTP | 1.3.3.7";
  }

  function start() {
    if (timer !== null || document.hidden) return;
    timer = setInterval(paint, TICK_MS);
  }

  function stop() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function init() {
    // Only take the title over once the real one is gone (e.g. another script
    // set a longer, more useful title) — never clobber a non-scrolling title.
    if (document.title && document.title.length > 120) return;
    document.title = ring.slice(0, 16) + " · HTP | 1.3.3.7";
    start();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
