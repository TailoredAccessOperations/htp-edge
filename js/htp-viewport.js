/*!
 * htp-viewport.js — viewport measurement + in-app webview integration.
 *
 * TWO JOBS, both of which CSS alone cannot do:
 *
 *   1. Publish the real visible height as --htp-viewport-h.
 *
 *      CSS `100vh` is wrong in three separate cases:
 *        · iOS Safari — vh is the LARGEST viewport, so with a collapsing
 *          browser bar the page is taller than what you can see.
 *        · in-app webviews (Telegram, Discord) — vh includes the host's own
 *          header and footer chrome, which the page cannot paint over.
 *        · Android with a soft keyboard — vh barely changes when the keyboard
 *          opens, so a terminal sized in vh ends up underneath it.
 *
 *      `window.innerHeight` reflects the actual visible box in all three. We
 *      publish it as a custom property and let CSS opt in.
 *
 *   2. Ask an in-app host to expand, when it supports that.
 *
 *      Telegram's WebApp API can expand the webview to its content area.
 *      Calling it is safe to feature-detect and is a no-op everywhere else.
 *
 * NOT progressive section loading. That was considered and deliberately left
 * out: the Worker already minifies and inlines HTML per request, so a static
 * page here is already close to the wire cost of an injected one, and client
 * fetching would trade that for a visible flash of empty section. If section
 * weight ever becomes the real bottleneck, measure it first — do not guess.
 */
(function () {
  'use strict';

  var root = document.documentElement;

  /* -------------------------------------------------------------- *
   * 1. Host detection
   * -------------------------------------------------------------- */

  function detectInApp() {
    var ua = navigator.userAgent || '';

    // Telegram injects its WebApp object; it is the only reliable signal.
    if (typeof window.Telegram !== 'undefined' && window.Telegram.WebApp) return 'telegram';

    // Discord's embedded client sets this on the user agent.
    if (/Discord/i.test(ua)) return 'discord';

    // Slack, LINE, Facebook in-app browsers.
    if (/slack/i.test(ua)) return 'slack';
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
    if (/Line\//i.test(ua)) return 'line';

    // iOS standalone (added to Home Screen) and Android TWA.
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (standalone) return 'standalone';

    // An actual <iframe> — our own "lulz stair" embeds, or a partner page.
    if (window.self !== window.top) return 'iframe';

    return null;
  }

  /* -------------------------------------------------------------- *
   * 2. Telegram expand()
   * -------------------------------------------------------------- */

  function tryExpand(host) {
    if (host !== 'telegram') return;

    var app = window.Telegram && window.Telegram.WebApp;
    if (!app) return;

    try {
      // expand() makes the webview fill the host's content area, so the
      // bottom nav no longer eats vertical space. requestFullscreen is NOT
      // used: it must be triggered by a user gesture and is too aggressive.
      if (typeof app.expand === 'function') app.expand();

      // lockVerticalScroll keeps the page from rubber-banding while a modal
      // is open, which otherwise fights the terminal's own scrolling.
      if (typeof app.setHeaderColor === 'function') {
        app.setHeaderColor('#050a07');
      }
    } catch (e) {
      /* Older clients throw on unsupported calls — not worth surfacing. */
    }
  }

  /* -------------------------------------------------------------- *
   * 3. Publish the visible height
   * -------------------------------------------------------------- */

  function visibleHeight() {
    var h = window.innerHeight;

    // When the soft keyboard is open, visualViewport shrinks but innerHeight
    // does not (on iOS). Prefer the smaller, truer value.
    if (window.visualViewport && window.visualViewport.height) {
      h = Math.min(h, window.visualViewport.height);
    }

    return Math.round(h);
  }

  function publish() {
    var h = visibleHeight();
    if (!h) return;
    root.style.setProperty('--htp-viewport-h', h + 'px');
    root.classList.toggle('keyboard-open', !!(window.visualViewport &&
      window.visualViewport.height < window.innerHeight - 80));
  }

  /* -------------------------------------------------------------- *
   * 4. Init
   * -------------------------------------------------------------- */

  var host = detectInApp();
  if (host) {
    root.classList.add('htp-inapp');
    root.setAttribute('data-htp-host', host);
    tryExpand(host);
  }

  publish();

  // rAF-throttled: scroll fires at frame rate and each handler does a layout
  // read, so running it unthrottled is a measurable jank source.
  var ticking = false;
  function onResize() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      publish();
    });
  }

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize, { passive: true });
  }

  // The keyboard animating open/closed fires resize twice; re-measure after.
  if (document.readyState === 'complete') {
    setTimeout(publish, 300);
  } else {
    window.addEventListener('load', function () { setTimeout(publish, 300); });
  }
})();