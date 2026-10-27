/**
 * HTP partial navigation.
 *
 * Progressive enhancement: with JS off, or for any link outside the supported
 * set, the browser performs a normal full page load. That is the default and it
 * is never second-guessed — this file only ever makes navigation *cheaper*,
 * never different in outcome.
 *
 * ## Why the allowlist is so small
 *
 * These pages are small standalone apps, not fragments of one app. Each owns
 * timers, animation frames, global listeners and media:
 *
 *   /       js/main.js  36 global listeners, 5 rAF loops, 2 intervals,
 *                      plus playlist.js driving a ~160s video state machine
 *   /chat   chat/chat.js  streaming fetch with an AbortController
 *   /osint  osint/osint.js  Leaflet map + a 55ms interval
 *
 * A partial swap replaces markup but does NOT undo anything those scripts
 * started. Re-running them on a revisit would double the matrix rain, the
 * terminal handlers and the playlist, and orphan any in-flight chat stream.
 * So a swap is only allowed when *both* ends are pages that register a teardown
 * and can be torn down cleanly. Anything involving / does a full load, which
 * means the homepage's state machine is never left running behind us.
 *
 * If a swap throws for any reason we fall back to location.assign(), so the
 * worst case is a normal page load, never a half-swapped hybrid.
 */
(function () {
  "use strict";

  // Never let a second copy of the router take over: two instances would mean
  // two click handlers and two history pushes per navigation.
  if (window.__htpNav) return;

  /** Pages safe to both leave and enter without a full document reload. */
  var PARTIAL = ["/chat", "/osint"];

  /** Cleanup callbacks registered by the current page's scripts. */
  var teardowns = [];
  var nav = { busy: false, depth: 0 };

  window.__htpTeardown = {
    /** Page scripts call this so their timers/handles can be released. */
    add: function (fn) {
      if (typeof fn === "function") teardowns.push(fn);
    },
  };

  function supports(path) {
    return PARTIAL.indexOf(path) !== -1;
  }

  /** Normalise to a comparable path: no query, no hash, no trailing slash. */
  function norm(pathname) {
    var p = pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  }

  /** Run and clear registered teardowns. Never throws upward. */
  function runTeardowns() {
    var list = teardowns.slice();
    teardowns.length = 0;
    list.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        /* a broken teardown must not block navigation */
      }
    });
  }

  // --- head asset diffing -------------------------------------------------
  // Stylesheets and scripts are tracked per page so that leaving /chat does not
  // leave chat.css in <head> to fight osint.css.
  //
  // Scripts split into two classes. VENDOR are global libraries: they install
  // globals (window.L) and are re-running them pointless, so they are left in
  // <head> untouched and never re-fetched. PAGE are per-page side-effecting
  // bundles that must get a *fresh instance* on every visit.
  //
  // The fresh-instance requirement is not cosmetic: a module script is evaluated
  // at most once per URL, so re-inserting <script src="chat.js"> would leave the
  // new markup with no live handlers. Hence the generation counter, which forces
  // a distinct module record. It is applied only to scripts we actually re-add,
  // so vendor and shared bundles keep their cached copy.

  var VENDOR = ["/osint/vendor/leaflet/leaflet.js", "/chat/chat-parser.js"];

  /**
   * Scripts that belong to the session rather than to a page. The router is on
   * this list for a self-evident reason: if it appeared in `want` it would
   * re-add and re-execute *itself* on every swap, installing a second click and
   * popstate handler, and each navigation would then push two history entries.
   *
   * cf-nav.js is here for a different reason, and it is not optional. The
   * banner is *inside* <body>, so a swap destroys it and builds a new one. A
   * script that bound listeners to the old element is left holding a detached
   * node, and because a module is evaluated at most once per URL, re-adding the
   * tag would be a no-op — the new banner would render with a dropdown that
   * will not open and a hamburger that will not open the menu. It survives
   * instead by listening on document and re-mounting per element; see the
   * header of that file, and runAfterSwap() below.
   */
  var SELF = "/js/htp-nav.js";
  var PERSIST = VENDOR.concat([SELF, "/js/cf-nav.js"]);


  var owned = { link: [], script: [] };
  var gen = 0;

  /**
   * These pages put their <script> tags in <body>, not <head> (the <link> tags
   * are in <head>). So existence checks must scan the whole document — scanning
   * head alone reports every page script as missing and re-adds duplicates.
   */
  function isPresent(sel, url) {
    return Array.prototype.some.call(document.querySelectorAll(sel), function (el) {
      return el.getAttribute("href") === url || el.getAttribute("src") === url;
    });
  }

  function bust(url) {
    gen += 1;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "htpn=" + gen;
  }

  function swapAssets(doc) {
    var wantLinks = Array.prototype.map.call(
      doc.querySelectorAll("link[rel=stylesheet]"),
      function (el) {
        return el.getAttribute("href");
      }
    );
    var wantScripts = Array.prototype.map.call(doc.querySelectorAll("script[src]"), function (el) {
      return el.getAttribute("src");
    });

    // Drop the outgoing page's assets unless the incoming page wants them too.
    owned.link
      .concat(owned.script)
      .forEach(function (el) {
        var url = el.getAttribute("href") || el.getAttribute("src");
        var stillWanted = wantLinks.indexOf(url) !== -1 || wantScripts.indexOf(url) !== -1;
        if (!stillWanted && el.parentNode) el.parentNode.removeChild(el);
      });

    owned.link = [];
    owned.script = [];

    wantLinks.forEach(function (href) {
      if (isPresent("link[rel=stylesheet]", href)) return;
      var el = doc.createElement("link");
      el.rel = "stylesheet";
      el.href = href;
      document.head.appendChild(el);
      owned.link.push(el);
    });

    wantScripts.forEach(function (src) {
      var incoming = doc.querySelector('script[src="' + src + '"]');
      // Copy the load semantics verbatim; guessing type=module is not safe.
      // chat-parser.js is a module, and re-adding it as a classic script is a
      // hard SyntaxError on its `export` line.
      function make() {
        var el = document.createElement("script");
        if (incoming) {
          Array.prototype.forEach.call(incoming.attributes, function (a) {
            if (a.name === "src") return;
            el.setAttribute(a.name, a.value);
          });
        }
        // `defer` is IGNORED on a dynamically inserted script: per spec it
        // defaults to async, so the browser runs each one the moment it
        // finishes loading, in completion order rather than insertion order.
        // That race is fatal for vendor globals — /osint/osint.js calls
        // L.map() at top level, and a cache-hit leaflet.js can land after it,
        // throwing "L is not defined" and leaving the map uninitialised.
        // Setting async=false opts back into ordered execution, so the vendor
        // lib is guaranteed to have run before the page script that uses it.
        el.async = false;
        return el;
      }

      if (PERSIST.indexOf(src) !== -1) {
        // Session-persistent. Install once if absent, but never re-execute and
        // never take ownership, so it survives every swap.
        if (isPresent("script[src]", src)) return;
        var p = make();
        p.src = src;
        document.head.appendChild(p);
        return;
      }
      if (isPresent("script[src]", src)) return;

      var el = make();
      el.src = bust(src);
      document.head.appendChild(el);
      owned.script.push(el);
    });
  }

  /**
   * Claim the assets the *current* document loaded, so leaving the page removes
   * them. Without this, owned starts empty, and the outgoing page's own
   * <script src="chat.js"> — which the router did not add and therefore does
   * not know about — would stay in <head> running against detached DOM.
   */
  function claimCurrent() {
    Array.prototype.forEach.call(document.querySelectorAll("link[rel=stylesheet]"), function (el) {
      owned.link.push(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll("script[src]"), function (el) {
      if (PERSIST.indexOf(el.getAttribute("src")) === -1) owned.script.push(el);
    });
  }

  /**
   * The incoming document's inline scripts are deliberately NOT executed.
   *
   * The site ships a strict CSP (see src/security.js) whose script-src carries a
   * single sha256 and no 'unsafe-inline', so an injected inline script is
   * blocked by the browser. Injecting one would also be a CSP bypass. Every
   * script these pages need is an external src, which swapAssets() handles.
   * A page that genuinely needs inline JS must be given a nonce, not smuggled
   * in through the router.
   */

  function announce(text) {
    var live = document.getElementById("htp-nav-live");
    if (!live) {
      live = document.createElement("div");
      live.id = "htp-nav-live";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      live.className = "htp-visually-hidden";
      live.style.cssText =
        "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
      document.body.appendChild(live);
    }
    live.textContent = text;
  }

  /**
   * Let session scripts re-attach to the freshly swapped-in DOM.
   *
   * PERSIST deliberately prevents a script from re-executing, and that is
   * correct for stateful bundles (re-running a module means re-installing
   * timers) but wrong for anything holding element references: those references
   * were to nodes that innerHTML just threw away. A hook is the seam — the
   * script registers once, the router calls it after every swap, and only the
   * per-element work is repeated.
   *
   * A throwing hook must not abort the navigation, so each is isolated.
   */
  function runAfterSwap() {
    var hooks = window.__htpAfterSwap;
    if (!hooks || typeof hooks.length !== "number") return;
    for (var i = 0; i < hooks.length; i++) {
      try {
        hooks[i]();
      } catch (e) {
        /* a broken hook must not block navigation */
      }
    }
  }

  function applyDoc(doc, url, opts) {
    runTeardowns();

    // Body markup + class (index ships body.no-js; page scripts key off it).
    // Body markup + class (index ships body.no-js; page scripts key off it).
    //
    // The incoming body's <script> tags are stripped before insertion. Assigning
    // innerHTML never executes a script, so leaving them in place would drop
    // inert tags into the document and then make isPresent() think the page's
    // scripts are already there — the page would render with no behaviour at
    // all. swapAssets() re-adds them properly, in order, where they do run.
    var holder = document.createElement("div");
    holder.innerHTML = doc.body.innerHTML;
    Array.prototype.forEach.call(holder.querySelectorAll("script"), function (s) {
      s.parentNode.removeChild(s);
    });

    document.body.className = doc.body.className || "";
    document.body.innerHTML = holder.innerHTML;
    swapAssets(doc);
    runAfterSwap();

    document.title = doc.title;
    if (url !== location.pathname + location.search) {
      history[opts.replace ? "replaceState" : "pushState"]({ htpNav: true }, "", url);
    }

    // Scroll: reset on a new page, honour the browser on back/forward.
    window.scrollTo(0, opts.restore ? (opts.y || 0) : 0);

    // Move focus into the new view so keyboard and screen-reader users are not
    // left focused on a node that no longer exists.
    var main = document.querySelector("main") || document.body;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    announce(document.title.replace(/[|·–-]\s*HTP.*$/i, "").trim() + " loaded");
  }

  function swap(url, opts) {
    if (nav.busy) return;
    nav.busy = true;
    nav.depth += 1;
    document.documentElement.setAttribute("data-htp-nav", "pending");

    fetch(url, { headers: { "X-Requested-With": "htp-nav" }, credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        if (!doc || !doc.body) throw new Error("unparseable document");
        applyDoc(doc, url, opts);
      })
      .catch(function (err) {
        // Fail closed: a normal navigation is always a correct outcome.
        window.location.assign(url);
      })
      .finally(function () {
        nav.busy = false;
        nav.depth -= 1;
        if (!nav.depth) document.documentElement.removeAttribute("data-htp-nav");
      });
  }

  function interceptable(a, ev) {
    if (!a || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
    if (a.target && a.target !== "_self") return false;
    if (a.hasAttribute("download") || a.dataset.noAjax !== undefined) return false;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#") return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    var url;
    try {
      url = new URL(a.href, location.href);
    } catch (e) {
      return false;
    }
    if (url.origin !== location.origin) return false;
    if (!supports(norm(url.pathname))) return false;
    // Current page must also be releasable, or the homepage's timers, rAF loops
    // and playlist would keep running underneath the swapped-in page.
    if (!supports(norm(location.pathname))) return false;
    return true;
  }

  document.addEventListener(
    "click",
    function (ev) {
      var a = ev.target.closest ? ev.target.closest("a[href]") : null;
      if (!interceptable(a, ev)) return;
      ev.preventDefault();
      swap(a.href, { replace: false });
    },
    true
  );

  // Claim this page's own assets before the first swap can happen.
  claimCurrent();

  // Claim the entry we were loaded on. Without this, the first history entry
  // carries no state, so Back into it would skip the popstate handler entirely:
  // the URL would change to /chat while the DOM still showed /osint. Seeding it
  // makes the entry router-owned, so Back swaps the DOM to match the URL.
  if (!history.state || !history.state.htpNav) {
    history.replaceState({ htpNav: true, y: window.scrollY }, "");
  }

  window.addEventListener("popstate", function (ev) {
    if (!ev.state || !ev.state.htpNav) return; // a real back/forward outside us
    swap(location.href, { replace: true, restore: true, y: ev.state.y });
  });

  // Remember scroll per entry so back/forward lands where the user left.
  window.addEventListener(
    "scroll",
    function () {
      if (history.state) history.replaceState({ htpNav: true, y: window.scrollY }, "");
    },
    { passive: true }
  );

  window.__htpNav = { supports: supports, swap: swap };
})();
