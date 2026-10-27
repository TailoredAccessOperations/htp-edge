(function () {
  "use strict";

  // Official embeds only. Topic-channel rows are label audio supplied to
  // YouTube. Fan reuploads are not in this set, and the player refuses
  // any id that is not listed here.
  var ALLOW = {
    "NRWUs0KtB-I": 1,
    "HWMsWO0vPa8": 1,
    "qAP8UpXFhUw": 1,
    "Mb1ZvUDvLDY": 1,
    "Qg0RA0yWmjg": 1,
    "N0VdRLdg2ng": 1,
    "PJWpyKvHZAk": 1,
    "vw-O1JdXcXk": 1,
    "AUf5kXTA8MM": 1,
    "0VGjV8Suyvg": 1,
    "eXvBjCO19QY": 1,
    "jdWXS3BPt_0": 1,
    "931I2WbJHXE": 1
  };

  var SLUG = /^[a-z0-9-]{1,64}$/;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clockTimer = 0;
  var clockButton = null;
  var raf = 0;
  var canvases = [];
  var booted = false;

  function currentSlug() {
    var value = new URLSearchParams(location.search).get("album") || "";
    if (!SLUG.test(value)) return "";
    var node = document.getElementById(value);
    if (!node || !node.classList.contains("plate")) return "";
    return value;
  }

  function waitCopy() {
    var p = document.createElement("p");
    p.className = "player-wait";
    p.textContent = "The player stays empty until you start one picture or one label audio. One plays at a time.";
    return p;
  }

  function restoreWait(player) {
    if (!player) return;
    player.replaceChildren(waitCopy());
    var close = player.parentElement && player.parentElement.querySelector("[data-close]");
    if (close) close.hidden = true;
  }

  function clearOtherPlayers(keep) {
    var nodes = document.querySelectorAll("[data-player]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] !== keep) restoreWait(nodes[i]);
    }
  }

  function mount(button) {
    var id = button.getAttribute("data-yt") || "";
    var label = button.getAttribute("data-label") || "YouTube player";
    if (!ALLOW[id]) return;
    var plate = button.closest(".plate");
    var player = plate && plate.querySelector("[data-player]");
    if (!player) return;
    clearOtherPlayers(player);
    var frame = document.createElement("iframe");
    frame.className = "yt";
    frame.title = label;
    frame.src = "https://www.youtube-nocookie.com/embed/" + id + "?rel=0";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.loading = "lazy";
    player.replaceChildren(frame);
    var close = player.parentElement.querySelector("[data-close]");
    if (close) close.hidden = false;
    var plays = plate.querySelectorAll(".play");
    for (var i = 0; i < plays.length; i++) {
      plays[i].setAttribute("aria-pressed", plays[i] === button ? "true" : "false");
    }
  }

  function stopClock() {
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = 0;
    if (clockButton) {
      clockButton.setAttribute("aria-pressed", "false");
      clockButton.lastElementChild.textContent = "Run";
    }
    clockButton = null;
  }

  function showStation(plate, index) {
    var stations = plate.querySelectorAll(".station");
    if (!stations.length) return;
    var next = (index + stations.length) % stations.length;
    for (var i = 0; i < stations.length; i++) {
      var on = i === next;
      stations[i].classList.toggle("is-now", on);
      if (on) stations[i].setAttribute("aria-current", "step");
      else stations[i].removeAttribute("aria-current");
    }
    plate.dataset.step = String(next);
  }

  function stepPlate(plate, delta) {
    var current = Number(plate.dataset.step || "0");
    if (!plate.querySelector(".station.is-now")) current = 0;
    else current = Number(plate.dataset.step || "0");
    showStation(plate, current + delta);
  }

  function runClock(plate, button) {
    if (clockButton === button && clockTimer) {
      stopClock();
      return;
    }
    stopClock();
    if (reduced) {
      stepPlate(plate, 1);
      return;
    }
    clockButton = button;
    button.setAttribute("aria-pressed", "true");
    button.lastElementChild.textContent = "Stop";
    var hold = Number(plate.getAttribute("data-hold") || "9000");
    if (hold < 4000) hold = 4000;
    clockTimer = window.setInterval(function () {
      stepPlate(plate, 1);
    }, hold);
  }

  function closeNav() {
    document.body.classList.remove("nav-open");
    var menu = document.querySelector(".menu");
    if (menu) menu.setAttribute("aria-expanded", "false");
  }

  function apply(opts) {
    var quiet = opts && opts.quiet;
    stopClock();
    closeNav();
    var slug = currentSlug();
    document.body.classList.toggle("is-focused", Boolean(slug));
    var plates = document.querySelectorAll(".plate");
    var current = null;
    for (var i = 0; i < plates.length; i++) {
      var on = plates[i].id === slug;
      plates[i].classList.toggle("is-current", on);
      if (!on) {
        restoreWait(plates[i].querySelector("[data-player]"));
        var plays = plates[i].querySelectorAll(".play");
        for (var p = 0; p < plays.length; p++) plays[p].setAttribute("aria-pressed", "false");
      } else {
        current = plates[i];
      }
    }
    var base = "Live floor · albums beside the 2011 archive";
    if (current) {
      var title = current.querySelector("h3");
      document.title = (title ? title.textContent : "Album") + " · Live floor";
      if (!quiet) current.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    } else {
      document.title = base;
      if (booted && !quiet) window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
    booted = true;
  }

  function onClick(event) {
    var button = event.target.closest("button");
    if (button) {
      if (button.classList.contains("menu")) {
        var open = document.body.classList.toggle("nav-open");
        button.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      if (button.classList.contains("play")) {
        mount(button);
        return;
      }
      if (button.hasAttribute("data-close")) {
        var player = button.parentElement.querySelector("[data-player]");
        restoreWait(player);
        var plate = button.closest(".plate");
        if (plate) {
          var plays = plate.querySelectorAll(".play");
          for (var i = 0; i < plays.length; i++) plays[i].setAttribute("aria-pressed", "false");
        }
        return;
      }
      var act = button.getAttribute("data-act");
      if (act) {
        var host = button.closest(".plate");
        if (!host) return;
        if (act === "step") {
          stopClock();
          stepPlate(host, 1);
        } else if (act === "clock") {
          runClock(host, button);
        }
        return;
      }
    }

    var link = event.target.closest("a");
    if (!link || link.origin !== location.origin) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    var url = new URL(link.href);
    var path = url.pathname.replace(/\/$/, "") || "/";
    if (path !== "/live") return;
    var album = url.searchParams.get("album") || "";
    if (!album && url.hash) {
      if (!document.body.classList.contains("is-focused")) return;
      event.preventDefault();
      history.pushState(null, "", "/live/" + url.hash);
      apply({ quiet: true });
      var target = document.getElementById(url.hash.slice(1));
      if (target) target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      return;
    }
    event.preventDefault();
    history.pushState(null, "", album ? "/live/?album=" + encodeURIComponent(album) : "/live/");
    apply();
  }

  function bar(ctx, x, y, w, h) {
    var r = Math.min(8, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, Math.max(w, 0), Math.max(h, 0), r);
    else ctx.rect(x, y, Math.max(w, 0), Math.max(h, 0));
    ctx.fill();
  }

  function paint(canvas, t, running) {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.floor(w * dpr);
    var ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var accent = canvas.getAttribute("data-accent") || "#e24a12";
    var mode = canvas.getAttribute("data-mode") || "grid";
    var pulse = Number(canvas.getAttribute("data-pulse") || "900");
    if (pulse < 400) pulse = 400;
    var phase = running ? t / pulse : 0.35;
    var cols = mode === "wide" ? 7 : mode === "mask" ? 18 : mode === "close" ? 5 : 11;
    var gap = mode === "wide" ? 10 : 7;
    var bw = (w - gap * (cols + 1)) / cols;
    for (var i = 0; i < cols; i++) {
      var wave = Math.sin(phase * Math.PI * 2 + i * (mode === "mask" ? 0.9 : 0.5));
      var n = (wave + 1) / 2;
      if (mode === "close") n = 0.25 + n * 0.35;
      if (mode === "mask" && i % 3 !== 0) n *= 0.35;
      var bh = 8 + n * (h - 22);
      ctx.globalAlpha = 0.28 + n * 0.72;
      ctx.fillStyle = (mode === "wide" ? i % 3 === 0 : i % 4 === 0) ? accent : "#f3ecdf";
      bar(ctx, gap + i * (bw + gap), h - 8 - bh, bw, bh);
    }
    ctx.globalAlpha = 1;
  }

  function tick(t) {
    for (var i = 0; i < canvases.length; i++) {
      var item = canvases[i];
      if (!item.seen || document.hidden) continue;
      paint(item.canvas, t, !reduced && item.seen);
    }
    if (!reduced) raf = window.requestAnimationFrame(tick);
  }

  function bindCanvases() {
    var nodes = document.querySelectorAll(".grid-canvas");
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < nodes.length; i++) paint(nodes[i], 0, false);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var canvas = entries[i].target;
        for (var c = 0; c < canvases.length; c++) {
          if (canvases[c].canvas === canvas) canvases[c].seen = entries[i].isIntersecting;
        }
        if (entries[i].isIntersecting) paint(canvas, performance.now(), !reduced);
      }
    }, { rootMargin: "80px", threshold: 0.05 });
    for (var n = 0; n < nodes.length; n++) {
      canvases.push({ canvas: nodes[n], seen: false });
      io.observe(nodes[n]);
      paint(nodes[n], 0, false);
    }
    if (!reduced) raf = window.requestAnimationFrame(tick);
  }

  function bindReveal() {
    var nodes = document.querySelectorAll(".reveal");
    if (reduced || !("IntersectionObserver" in window)) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("is-in");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add("is-in");
        io.unobserve(entries[i].target);
      }
    }, { threshold: 0.12 });
    for (var n = 0; n < nodes.length; n++) io.observe(nodes[n]);
  }

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeNav();
  });
  window.addEventListener("popstate", apply);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopClock();
  });

  bindReveal();
  bindCanvases();
  apply();
})();
