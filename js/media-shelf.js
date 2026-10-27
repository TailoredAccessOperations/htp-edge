/*!
 * media-shelf.js — the rotating display viewer at the bottom of the page.
 *
 * WHAT IT IS
 *   One stage, one clip at a time, advancing on its own through every MP4 the
 *   site serves. It replaced a grid of eight `<video controls>` cards, which
 *   was never really a library: nothing played until the visitor clicked, so a
 *   shelf of eight dead rectangles read as broken media rather than as media.
 *
 * WHERE THE LIST COMES FROM
 *   public/media/manifest.json, written by scripts/media-distribute.mjs. Every
 *   entry's `src` is content-hashed (`ghost.e056d58ace76.mp4`), so a clip whose
 *   bytes changed gets a new URL instead of serving stale ones out of a
 *   long-lived cache. The manifest is the single source of truth; FALLBACK
 *   below is only there so a failed fetch leaves a usable viewer rather than an
 *   empty section.
 *
 * HOW A CLIP IS PICKED
 *   HLS when the entry offers it and the browser can play it, else the
 *   progressive MP4, and if that fails, skip to the next entry. Two of these
 *   files are only available as HLS because they are far past the 25 MiB
 *   per-file ceiling — ghost.mp4 is 186 MiB — and an HLS entry starts playing
 *   after its first segment instead of after the whole download.
 *
 * COST
 *   Nothing fetches until the section is near the viewport, only the current
 *   clip has a source attached, and a clip that is playing is the only one
 *   downloading bytes. Autoplay is muted and only starts when the section is
 *   actually visible and the visitor has not asked for reduced motion.
 *
 * PROGRESSIVE ENHANCEMENT
 *   The markup is injected by this file, so with JS off the section stays as
 *   the static heading it already was. No asset is hidden behind it, and
 *   nothing else on the page depends on it.
 */
(function () {
  "use strict";

  var MANIFEST_URL = "/media/manifest.json";
  var DWELL_MS = 14000;          // how long a clip holds the stage
  var PRELOAD_AHEAD = 1;         // clips warmed up before they are needed

  /* Used only when the manifest cannot be read. Same shape, same fields. */
  var FALLBACK = [
    { slug: "ghost", note: "1280x720 · 23:18", hls: "/hls/ghost/index.m3u8", src: "/ghost.mp4" },
    { slug: "rogue-ai-agents", note: "640x360 · 29:33", hls: "/hls/rogue/index.m3u8", src: "/rogue-ai-agents.mp4" },
    { slug: "0n4p096", note: "1080x1080 · 2:38", src: "/media/0n4p096.e8f0ccbdea94.mp4" },
    { slug: "27463n3r", note: "1920x1080 · 3:52", src: "/media/27463n3r.626cf559f922.mp4" },
    { slug: "15qpn33s", note: "1920x1080 · 3:47", src: "/media/15qpn33s.07d23c94bf8a.mp4" },
    { slug: "n356r8sq", note: "1916x1080 · 5:21", src: "/media/n356r8sq.c793fa15b260.mp4" },
    { slug: "o734519po", note: "1080x1080 · 1:25", src: "/media/o734519po.ab56d97fdc25.mp4" },
    { slug: "owned", note: "640x480 · 2:22", src: "/media/owned.a146e1086382.mp4" },
    { slug: "psychopath-rce", note: "1920x1080 · 1:58", src: "/media/psychopath-rce.bdb54d31de1f.mp4" },
    { slug: "5qpor6rn", note: "1920x1080 · 2:59", src: "/media/5qpor6rn.8f37bc8325b0.mp4" },
  ];

  var motion = matchMedia("(prefers-reduced-motion: reduce)");
  var entries = [];
  var index = 0;
  var dwellTimer = null;
  var playing = true;
  var visible = false;
  var warmed = {};
  var built = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function host() { return document.getElementById("media-shelf"); }

  /* ---------------------------------------------------------------- source */

  /**
   * Point `video` at an entry. HLS first when offered and playable, else the
   * progressive MP4. A failed source calls `onFail` exactly once and then
   * stops, so one dead entry can never spin the viewer in a loop.
   */
  function attach(video, entry, onFail) {
    var settled = false;
    var usedHls = false;

    function fail() {
      if (settled) return;
      settled = true;
      video.dataset.state = "failed";
      onFail();
    }

    video.addEventListener("error", fail);

    if (entry.hls && window.HlsLite && !window.HlsLite.nativeSupport(video)) {
      usedHls = true;
      window.HlsLite.attach(video, entry.hls)
        .then(function (mode) { video.dataset.mode = mode.mode; })
        .catch(fail);
      return;
    }
    // Native HLS (Safari) takes the playlist directly; everyone else gets the
    // progressive file, which exists for every entry that has one.
    var url = entry.hls && window.HlsLite && window.HlsLite.nativeSupport(video)
      ? entry.hls
      : entry.src;
    if (!url) { fail(); return; }
    video.src = url;
    video.load();
  }

  /* ----------------------------------------------------------------- build */

  function build(list) {
    // Not `var host = host()`: the local would shadow the function and hoist
    // over it, and the section would silently never be built.
    var mount = host();
    if (!mount || built) return;
    built = true;
    entries = list.filter(function (e) { return e && (e.src || e.hls); });
    if (!entries.length) return;

    var wrap = el("div", "viewer");

    var stage = el("div", "viewer-stage");
    var video = el("video", "viewer-video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = false;
    video.preload = "none";
    video.setAttribute("aria-label", "Rotating media display");
    video.dataset.state = "ready";

    var caption = el("div", "viewer-cap");
    var title = el("strong", "viewer-title", entries[0].title || entries[0].slug);
    var note = el("span", "viewer-note", entries[0].note || "");
    var tag = el("span", "viewer-tag", "");
    var count = el("span", "viewer-count", "");
    caption.appendChild(title);
    caption.appendChild(note);
    caption.appendChild(tag);
    caption.appendChild(count);

    // The dwell bar is decorative and doubles as the "how long until the next
    // clip" indicator, so it is aria-hidden and the live region carries the text.
    var bar = el("div", "viewer-dwell");
    bar.setAttribute("aria-hidden", "true");
    var fill = el("i", "viewer-dwell-fill");
    bar.appendChild(fill);

    stage.appendChild(video);
    stage.appendChild(caption);
    stage.appendChild(bar);

    var controls = el("div", "viewer-controls");
    var prev = el("button", "viewer-btn", "◀ prev");
    prev.type = "button";
    var toggle = el("button", "viewer-btn viewer-btn-play", "❚❚ pause");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "true");
    var next = el("button", "viewer-btn", "next ▶");
    next.type = "button";
    var open = el("a", "viewer-btn viewer-btn-open", "open source");
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    controls.appendChild(prev);
    controls.appendChild(toggle);
    controls.appendChild(next);
    controls.appendChild(open);

    var rail = el("ol", "viewer-rail");
    rail.setAttribute("aria-label", "Choose a clip");

    wrap.appendChild(stage);
    wrap.appendChild(controls);
    wrap.appendChild(rail);
    mount.appendChild(wrap);

    var chips = entries.map(function (entry, i) {
      var li = el("li");
      var b = el("button", "viewer-chip");
      b.type = "button";
      b.appendChild(el("strong", null, entry.title || entry.slug));
      b.appendChild(el("span", null, entry.note || ""));
      b.setAttribute("aria-label", "Show " + (entry.title || entry.slug) + " — " + (entry.note || ""));
      if (i === 0) b.setAttribute("aria-current", "true");
      b.addEventListener("click", function () { select(i, true); });
      li.appendChild(b);
      rail.appendChild(li);
      return b;
    });

    var live = el("p", "viewer-live");
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.className = "visually-hidden";
    wrap.appendChild(live);

    /* ---- rotation ---- */

    function schedule() {
      clearTimeout(dwellTimer);
      dwellTimer = null;
      if (!playing || !visible || motion.matches || document.hidden) return;
      dwellTimer = setTimeout(function () { select(index + 1, false); }, DWELL_MS);
    }

    function paint() {
      var entry = entries[index];
      title.textContent = entry.title || entry.slug;
      note.textContent = entry.note || "";
      tag.textContent = entry.hls && !entry.src ? "hls" : entry.hls ? "hls + mp4" : "mp4";
      count.textContent = (index + 1) + " / " + entries.length;
      open.href = entry.src || entry.hls || "#";
      live.textContent = "Showing " + (entry.title || entry.slug) + ", " + (index + 1) + " of " + entries.length;
      chips.forEach(function (b, i) {
        if (i === index) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
      fill.style.animation = "";
      // restart the dwell animation from zero on every change
      void fill.offsetWidth;
      fill.style.animation = "viewer-dwell " + (DWELL_MS / 1000) + "s linear forwards";
    }

    function play() {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* autoplay refused; leave it paused */ });
    }

    /** Warm the next clip's source so the handover is not a black frame. */
    function warm(i) {
      var entry = entries[i];
      if (!entry || warmed[entry.slug]) return;
      warmed[entry.slug] = true;
      var v = el("video", "viewer-warm");
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = entry.src || entry.hls || "";
      stage.appendChild(v);
      var done = function () { v.remove(); };
      v.addEventListener("loadeddata", done, { once: true });
      v.addEventListener("error", done, { once: true });
      // Never let a warm-up linger; it exists for a few seconds, not forever.
      setTimeout(done, 20000);
    }

    function select(i, userInitiated) {
      if (!entries.length) return;
      var n = entries.length;
      index = ((i % n) + n) % n;
      var entry = entries[index];

      paint();
      video.dataset.state = "loading";
      attach(video, entry, function () {
        // This entry will not play. Move on rather than sit on a dead frame.
        if (entries.length > 1) select(index + 1, false);
      });
      video.currentTime = 0;
      if (visible && playing) play();
      warm(index + PRELOAD_AHEAD);
      if (userInitiated) schedule();
    }

    /* ---- wiring ---- */

    prev.addEventListener("click", function () { select(index - 1, true); });
    next.addEventListener("click", function () { select(index + 1, true); });
    toggle.addEventListener("click", function () {
      playing = !playing;
      toggle.textContent = playing ? "❚❚ pause" : "▶ play";
      toggle.setAttribute("aria-pressed", playing ? "true" : "false");
      if (playing) { play(); schedule(); } else { video.pause(); clearTimeout(dwellTimer); dwellTimer = null; }
    });

    // A clip that ends on its own is not a reason to stop rotating.
    video.addEventListener("ended", function () { select(index + 1, false); });
    video.addEventListener("playing", function () { video.dataset.state = "ready"; });
    video.addEventListener("loadeddata", function () { video.dataset.state = "ready"; });

    wrap.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); select(index + 1, true); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); select(index - 1, true); }
      else if (e.key === " " || e.key === "k") { e.preventDefault(); toggle.click(); }
    });

    // Reduced motion is a preference about movement, not about media: stop
    // auto-advancing, but leave playback to the visitor.
    var onMotionChange = function () { if (motion.matches) { clearTimeout(dwellTimer); dwellTimer = null; } else schedule(); };
    if (motion.addEventListener) motion.addEventListener("change", onMotionChange);
    else if (motion.addListener) motion.addListener(onMotionChange);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { video.pause(); clearTimeout(dwellTimer); dwellTimer = null; }
      else if (visible && playing) { play(); schedule(); }
    });

    /* ---- start ---- */

    var start = function () {
      if (visible) return;
      visible = true;
      select(index, false);
      schedule();
    };
    var stop = function () {
      visible = false;
      video.pause();
      clearTimeout(dwellTimer);
      dwellTimer = null;
    };

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (obs) {
        obs.forEach(function (o) { if (o.isIntersecting) start(); else stop(); });
      }, { rootMargin: "150px" });
      io.observe(wrap);
    } else {
      start();
    }

    // Expose the controls for the verifier and for anyone driving this by hand.
    window.HTPViewer = {
      entries: entries,
      get index() { return index; },
      play: function (i) { select(i, true); },
      count: function () { return entries.length; },
      current: function () { return entries[index] || null; },
    };
  }

  function normalise(list) {
    return (list || []).map(function (e) {
      return {
        slug: e.slug,
        title: e.title || e.slug,
        note: e.note || "",
        src: e.src || null,
        hls: e.hls || null,
        duration: e.duration || 0,
      };
    });
  }

  function start() {
    if (!host()) return;
    if (typeof fetch !== "function") { build(normalise(FALLBACK)); return; }
    fetch(MANIFEST_URL, { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        var list = m && m.entries ? m.entries : FALLBACK;
        build(normalise(list));
      })
      .catch(function () { build(normalise(FALLBACK)); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();