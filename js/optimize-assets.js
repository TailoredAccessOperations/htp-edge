/**
 * HTP Timed Image Router & Display-Timing Asset Optimizer
 *
 * All images in /imgs/ are served as .webp. This module:
 *  1. REPAIRS content loading — routes every img/source that points into
 *     /imgs/ to the real file that exists (webp), so nothing 404s.
 *  2. DYNAMICALLY ROUTES by display timing — watches the site's own display
 *     clock (carousel rotation) and prefetches each slide's image just-in-time:
 *     the instant one slide is shown, the next one starts loading, so network
 *     work is paced to when the browser actually displays it.
 *  3. Lazily routes below-fold ghost cards and keeps resource hints/preloads
 *     (origin preconnect, critical CSS) tuned for the edges worker origin
 *     (cat.htp.sh).
 */

(function () {
  'use strict';

  if (!window || !window.document) return;

  var d = window.document;
  var head = d.head;
  var deb = window.location.hostname === 'localhost' ||
    window.location.hostname.indexOf('127.0.0.1') === 0;

  // ---- 1. ROUTE: resolve /imgs/ references to the actual served file ----
  var IMGS_RX = /\/?imgs\/[A-Za-z0-9_./-]+\.(jpe?g|png|gif|avif)$/;

  function resolvePath(href) {
    if (!href || typeof href !== 'string') return null;
    var clean = href.split('#')[0].split('?')[0];
    if (IMGS_RX.test(clean)) {
      return clean.replace(/\.(jpe?g|png|gif|avif)$/i, '.webp');
    }
    return clean;
  }

  function routeSources(pic) {
    var srcs = pic.querySelectorAll('source');
    for (var i = 0; i < srcs.length; i++) {
      var s = srcs[i];
      var ss = s.getAttribute('srcset');
      if (ss && /imgs\//.test(ss)) {
        var routed = resolvePath(ss.split(/\s+/)[0]);
        if (routed && routed !== ss) s.setAttribute('srcset', routed);
      }
    }
  }

  function routeImg(img) {
    if (!img || !img.src || !/imgs\//.test(img.src)) return;
    var routed = resolvePath(img.currentSrc || img.src);
    if (routed && routed !== img.currentSrc && routed !== img.src) {
      img.src = routed;
      img.removeAttribute('srcset');
    }
  }

  // ---- 2. DISPLAY-TIMING SCHEDULER ----
  var prefetched = Object.create(null);

  function prefetch(path) {
    if (!path || prefetched[path]) return;
    prefetched[path] = true;
    if (document.hidden) return;
    var l = d.createElement('link');
    l.rel = 'preload';
    l.as = 'image';
    l.href = path;
    l.setAttribute('data-route', 'timed');
    l.onload = l.onerror = function () {
      if (l.parentNode) l.parentNode.removeChild(l);
    };
    head.appendChild(l);
  }

  function pickImage(pic) {
    var src = pic.querySelector('source[type="image/webp"]');
    if (src && src.getAttribute('srcset')) {
      return resolvePath(src.getAttribute('srcset').split(/\s+/)[0]);
    }
    var img = pic.querySelector('img');
    if (img) {
      return resolvePath(img.currentSrc || img.dataset.src || img.src);
    }
    return null;
  }

  function routeCarouselClock() {
    var carousel = d.getElementById('carousel');
    if (!carousel) return;
    var pics = carousel.querySelectorAll('picture');
    if (pics.length < 2) return;

    // Prefetch the very next slide shortly after first paint.
    setTimeout(function () { prefetch(pickImage(pics[1])); }, 900);

    // Slow links: pull two slides ahead so the 5200ms window still suffices.
    var conn = navigator.connection;
    if (conn && /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '')) {
      setTimeout(function () { prefetch(pickImage(pics[2])); }, 1800);
    }

    // From then on, route by the site's own display clock: every time a slide
    // gains .active, start loading the slide that will display next.
    if ('MutationObserver' in window) {
      var timer = null;
      var onActive = function () {
        var cur = -1;
        for (var i = 0; i < pics.length; i++) {
          if (pics[i].classList.contains('active')) { cur = i; break; }
        }
        if (cur < 0) return;
        prefetch(pickImage(pics[(cur + 1) % pics.length]));
        // priority pass: slide being displayed is eager, the rest idle
        for (var j = 0; j < pics.length; j++) {
          var img = pics[j].querySelector('img');
          if (!img) continue;
          img.fetchPriority = j === cur ? 'high' : 'low';
        }
      };
      var mo = new MutationObserver(function () {
        clearTimeout(timer);
        timer = setTimeout(onActive, 0);
      });
      mo.observe(carousel, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
  }

  // ---- 3. LAZY ROUTE below-fold ghost cards ----
  function routeSourcesInPage() {
    var pics = d.querySelectorAll('picture');
    for (var i = 0; i < pics.length; i++) routeSources(pics[i]);
  }

  function routeBelowFold() {
    routeSourcesInPage();
    if (!('IntersectionObserver' in window)) {
      var plain = d.querySelectorAll('img[src*="imgs/"]');
      for (var i = 0; i < plain.length; i++) routeImg(plain[i]);
      return;
    }
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        var img = entry.target;
        routeImg(img);
        img.fetchPriority = entry.isIntersecting ? 'high' : 'low';
        if (entry.isIntersecting) obs.unobserve(img);
      });
    }, { rootMargin: '200px 0px' });
    var lazy = d.querySelectorAll('img[loading="lazy"], img[src*="imgs/"]');
    for (var j = 0; j < lazy.length; j++) io.observe(lazy[j]);
  }

  // ---- 4. RESOURCE HINTS / PRELOADS ----
  function addHint(rel, href, extra) {
    var sel = 'link[rel="' + rel + '"][href="' + href.replace(/"/g, '\\"') + '"]';
    if (head.querySelector(sel)) return;
    var l = d.createElement('link');
    l.rel = rel;
    l.href = href;
    for (var k in (extra || {})) if (extra[k] !== undefined) l[k] = extra[k];
    head.insertBefore(l, head.firstChild);
  }

  function addResourceHints() {
    // Google Fonts is the only third-party subresource this page actually
    // loads, so it is the only origin worth a preconnect. Both of the previous
    // hints were pure cost: cat.htp.sh is only an outbound <a href> (never a
    // subresource) and web.archive.org is not embedded on this page at all, so
    // each one burned a DNS+TCP+TLS handshake to an origin the browser never
    // touches on load.
    addHint('preconnect', 'https://fonts.gstatic.com', { crossOrigin: 'anonymous' });
    addHint('dns-prefetch', 'https://fonts.googleapis.com');
    // htp-inline-theme.css is a plain <link rel=stylesheet> in the markup, so
    // this preload is a real hint (not a duplicate) — it carries the terminal
    // and matrix rules, which are the reason the tty can flash unstyled.
    addHint('preload', '/htp-inline-theme.css', { as: 'style' });
  }

  // ---- 5. METRICS (local only) ----
  function collectMetrics() {
    if (!deb || !('PerformanceObserver' in window)) return;
    var mk = function (type, cb) {
      try {
        new PerformanceObserver(function (list) {
          var es = list.getEntries();
          cb(es[es.length - 1]);
        }).observe({ entryTypes: [type] });
      } catch (_) {}
    };
    mk('largest-contentful-paint', function (e) {
      console.log('[htp-perf] LCP ' + (e.renderTime || e.loadTime).toFixed(1) + 'ms');
    });
    mk('layout-shift', function (e) {
      console.log('[htp-perf] CLS ' + e.value.toFixed(4));
    });
    addEventListener('load', function () {
      var t = performance.getEntriesByType('navigation')[0];
      if (t) console.table({
        ttfb: (t.responseStart - t.startTime).toFixed(1) + 'ms',
        domInteractive: (t.domInteractive - t.startTime).toFixed(1) + 'ms',
        load: (t.loadEventEnd - t.startTime).toFixed(1) + 'ms'
      });
    }, { once: true });
  }

  // Data-saver & reduced-motion: drop video sources entirely (fetch zero video bytes).
  function tameVideos() {
    ['ghostvideo', 'bgvideo'].forEach(function (id) {
      var v = document.getElementById(id);
      if (!v) return;
      v.pause();
      v.removeAttribute('src');
      while (v.firstChild) v.removeChild(v.firstChild);
      v.load();
    });
  }
  if (matchMedia('(prefers-reduced-data: reduce)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tameVideos);
    } else {
      tameVideos();
    }
  }

  // ---- INIT ----
  function init() {
    addResourceHints();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        routeBelowFold();
        routeCarouselClock();
      });
    } else {
      routeBelowFold();
      routeCarouselClock();
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(collectMetrics, { timeout: 5000 });
    } else {
      setTimeout(collectMetrics, 5000);
    }
  }

  init();
})();