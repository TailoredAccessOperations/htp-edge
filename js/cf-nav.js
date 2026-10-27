/* ============================================================================
   HTP top banner — shared behaviour
   ----------------------------------------------------------------------------
   One controller for the .cf-nav banner that sits at the top of every
   navigable page (/, /money, /osint, /chat). Extracted from cf-connect.js,
   which used to own this alongside the homepage-only Connect islands.

   Depends on public/htp-nav.css for every class it touches.

   ## Why this is delegation-only, and why that is load-bearing

   js/htp-nav.js performs *partial navigation*: on /chat -> /osint it does
   `document.body.innerHTML = incoming.innerHTML` rather than a real document
   load. That destroys the banner element and builds a brand new one.

   The obvious implementation — grab .cf-nav once, then attach listeners to it
   and to the links inside it — silently dies at that point. The listeners stay
   bound to the detached old node, so the swapped-in banner renders with a
   full set of dead controls: the dropdown will not open, the hamburger will
   not open the mobile menu, the sliding hover pill never moves. Nothing
   throws, so nothing in the console points at the cause.

   Every handler here is therefore attached once to `document` and resolves its
   target per event. The controller holds no reference to any banner element,
   so it cannot go stale. The only per-element state is the initial ARIA reset,
   which `mount()` re-applies after a swap.
   ========================================================================== */

(function () {
  'use strict';

  // One copy only. Two instances would mean two handlers reacting to the same
  // click and two hover pills fighting over the same inline transform.
  if (window.__htpBanner) return;

  /** Every banner currently in the document. Zero is normal on some pages. */
  function banners() {
    return Array.prototype.slice.call(document.querySelectorAll('.cf-nav'));
  }

  /** The banner an event happened inside, or null. */
  function bannerOf(node) {
    return node && node.closest ? node.closest('.cf-nav') : null;
  }

  /* ── Dropdown panels (desktop "Phone" / "Pages") ──────────────────────────
     A trigger owns the panel named by its own aria-controls, which is how the
     markup stays a valid static island before this script runs. */

  function panelFor(trigger) {
    return document.getElementById(trigger.getAttribute('aria-controls'));
  }

  function setPanelOpen(trigger, panel, open) {
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) panel.setAttribute('data-open', '');
    else panel.removeAttribute('data-open');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    Array.prototype.forEach.call(panel.querySelectorAll('[tabindex]'), function (el) {
      el.setAttribute('tabindex', open ? '0' : '-1');
    });
  }

  function anyPanelOpen() {
    return document.querySelector('.cf-nav__dropdown-trigger[aria-expanded="true"]');
  }

  /* ── Full-screen mobile menu ────────────────────────────────────────────── */

  function setMenuOpen(nav, open) {
    var hamburger = nav.querySelector('.cf-nav__hamburger');
    var menu = nav.querySelector('.cf-nav__menu');
    if (!hamburger || !menu) return;

    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) menu.setAttribute('data-open', '');
    else menu.removeAttribute('data-open');
    nav.classList.toggle('cf-nav--menu-open', open);
    document.documentElement.toggleAttribute('data-nav-menu-open', open);
    Array.prototype.forEach.call(menu.querySelectorAll('[tabindex]'), function (el) {
      el.setAttribute('tabindex', open ? '0' : '-1');
    });
    // Lock scroll behind the full-screen panel. htp-nav.css also covers this
    // from the attribute alone, but the panel animates out, so the lock has to
    // clear before the fade is done or the page jumps.
    document.documentElement.style.overflow = open ? 'hidden' : '';
  }

  /* ── Sliding hover pill ───────────────────────────────────────────────────
     Positioned in viewport pixels against the bar, so it is recomputed from
     live geometry on every move rather than cached across a resize or a swap. */

  function movePill(pill, target) {
    var nav = bannerOf(target);
    if (!pill || !target || !nav) return;
    var navRect = nav.getBoundingClientRect();
    var rect = target.getBoundingClientRect();
    pill.style.width = rect.width + 'px';
    pill.style.transform = 'translateX(' + (rect.left - navRect.left) + 'px)';
  }

  /* ── mount ───────────────────────────────────────────────────────────────
     Per-element setup, re-run after a partial swap. Cheap, and idempotent
     within a page: it only writes the closed-state ARIA that the server-side
     markup already carries, so running it twice is indistinguishable from
     running it once. */

  function mount() {
    banners().forEach(function (nav) {
      var links = nav.querySelectorAll('.cf-nav__link[aria-controls]');
      Array.prototype.forEach.call(links, function (trigger) {
        var panel = panelFor(trigger);
        if (panel) setPanelOpen(trigger, panel, false);
      });

      var subTriggers = nav.querySelectorAll('.cf-nav__menu-trigger');
      Array.prototype.forEach.call(subTriggers, function (trigger) {
        var panel = panelFor(trigger);
        if (!panel) return;
        trigger.setAttribute('aria-expanded', 'false');
        panel.setAttribute('aria-hidden', 'true');
        panel.removeAttribute('data-open');
        Array.prototype.forEach.call(panel.querySelectorAll('[tabindex]'), function (el) {
          el.setAttribute('tabindex', '-1');
        });
      });

      // The pill only exists on the desktop bar, and it is display:none below
      // 900px, so reset it on mount to keep a swap from inheriting the width
      // the outgoing page left on it.
      var pill = nav.querySelector('.cf-nav__hover-pill');
      if (pill) pill.style.width = '0px';
    });
  }

  /* ── Handlers ───────────────────────────────────────────────────────────
     All bound once, to document. See the note at the top about why. */

  document.addEventListener('click', function (e) {
    // Dropdown triggers first: stopPropagation is meaningless under delegation
    // (the handler is already at the document), so the "opened" state is read
    // back instead of inferred from propagation.
    var trigger = e.target.closest
      ? e.target.closest('.cf-nav__dropdown-trigger, .cf-nav__menu-trigger')
      : null;

    if (trigger) {
      var panel = panelFor(trigger);
      if (!panel) return;
      var open = trigger.getAttribute('aria-expanded') !== 'true';
      // Only one dropdown open at a time, across the whole document.
      Array.prototype.forEach.call(
        document.querySelectorAll('.cf-nav__dropdown-trigger, .cf-nav__menu-trigger'),
        function (other) {
          if (other === trigger) return;
          var otherPanel = panelFor(other);
          if (otherPanel) setPanelOpen(other, otherPanel, false);
        }
      );
      setPanelOpen(trigger, panel, open);
      return;
    }

    // Outside a dropdown: close anything open.
    if (anyPanelOpen()) {
      Array.prototype.forEach.call(
        document.querySelectorAll('.cf-nav__dropdown-trigger'),
        function (t) {
          var p = panelFor(t);
          if (p) setPanelOpen(t, p, false);
        }
      );
    }

    var hamburger = e.target.closest ? e.target.closest('.cf-nav__hamburger') : null;
    if (hamburger) {
      var nav = bannerOf(hamburger);
      if (nav) setMenuOpen(nav, hamburger.getAttribute('aria-expanded') !== 'true');
      return;
    }

    // Tapping a leaf in the full-screen panel must close it, or the overlay
    // keeps covering the page the link just navigated to.
    if (e.target.closest && e.target.closest('.cf-nav__menu-link:not(.cf-nav__menu-trigger), .cf-nav__menu-sublink, .cf-btn')) {
      var openNav = bannerOf(e.target);
      if (openNav) setMenuOpen(openNav, false);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;

    // Escape closes the innermost open thing, and only that.
    var openTrigger = document.querySelector('.cf-nav__dropdown-trigger[aria-expanded="true"]');
    if (openTrigger) {
      var p = panelFor(openTrigger);
      if (p) setPanelOpen(openTrigger, p, false);
      openTrigger.focus();
      return;
    }

    var openSub = document.querySelector('.cf-nav__menu-trigger[aria-expanded="true"]');
    if (openSub) {
      var sp = panelFor(openSub);
      if (sp) setPanelOpen(openSub, sp, false);
      openSub.focus();
      return;
    }

    var openHamburger = document.querySelector('.cf-nav__hamburger[aria-expanded="true"]');
    if (openHamburger) {
      setMenuOpen(bannerOf(openHamburger), false);
      openHamburger.focus();
    }
  });

  // Hover pill. pointerover/mouseover rather than mouseenter: mouseenter does
  // not bubble, so it cannot be delegated and would have to be re-bound to
  // every link after each swap.
  document.addEventListener('mouseover', function (e) {
    var link = e.target.closest ? e.target.closest('.cf-nav__links .cf-nav__link') : null;
    if (!link) return;
    var nav = bannerOf(link);
    if (!nav) return;
    var pill = nav.querySelector('.cf-nav__hover-pill');
    if (pill) movePill(pill, link);
  });

  document.addEventListener('focusin', function (e) {
    var link = e.target.closest ? e.target.closest('.cf-nav__links .cf-nav__link') : null;
    if (!link) return;
    var nav = bannerOf(link);
    if (!nav) return;
    var pill = nav.querySelector('.cf-nav__hover-pill');
    if (pill) movePill(pill, link);
  });

  // Leaving the bar entirely collapses the pill.
  document.addEventListener('mouseout', function (e) {
    var bar = e.target.closest ? e.target.closest('.cf-nav__links') : null;
    if (!bar) return;
    if (e.relatedTarget && bar.contains(e.relatedTarget)) return;
    var nav = bannerOf(bar);
    if (!nav) return;
    var pill = nav.querySelector('.cf-nav__hover-pill');
    if (pill) pill.style.width = '0px';
  });

  document.addEventListener('focusout', function (e) {
    var bar = e.target.closest ? e.target.closest('.cf-nav__links') : null;
    if (!bar) return;
    if (e.relatedTarget && bar.contains(e.relatedTarget)) return;
    var nav = bannerOf(bar);
    if (!nav) return;
    var pill = nav.querySelector('.cf-nav__hover-pill');
    if (pill) pill.style.width = '0px';
  });

  // The pill is positioned in viewport pixels, so a resize invalidates it.
  // Re-measuring the hovered link keeps it pinned instead of sliding to a
  // stale offset.
  window.addEventListener('resize', function () {
    banners().forEach(function (nav) {
      var pill = nav.querySelector('.cf-nav__hover-pill');
      if (!pill) return;
      var active = nav.querySelector('.cf-nav__link:hover');
      if (active) movePill(pill, active);
      else pill.style.width = '0px';
    });
  });

  /* ── Over-hero state ─────────────────────────────────────────────────────
     While the Connect hero is under the bar, the bar drops its background and
     recolours to warm white. Implemented with a sentinel inside the hero plus
     an IntersectionObserver.

     The observer is the one thing here that *is* bound to a specific element,
     so it is re-established per hero in mount() and marked done on the hero
     itself. Without that, running the loop over both heroes after a swap would
     leave two observers flipping the same <html> attribute. */

  function watchHero(hero) {
    if (!hero || hero.getAttribute('data-htp-hero-watched')) return;
    hero.setAttribute('data-htp-hero-watched', '1');

    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText =
      'position:absolute;top:0;height:1px;width:1px;pointer-events:none;';
    hero.insertBefore(sentinel, hero.firstChild);

    if (typeof IntersectionObserver !== 'function') return;
    var io = new IntersectionObserver(function (entries) {
      document.documentElement.toggleAttribute('data-over-hero', entries[0].isIntersecting);
    });
    io.observe(sentinel);
  }

  function mountAll() {
    mount();
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-hero-root]'),
      watchHero
    );
  }

  /* ── After-swap hook ────────────────────────────────────────────────────
     js/htp-nav.js replaces <body> wholesale and, by design, does not re-run
     session-persistent scripts: a module is evaluated at most once per URL, so
     re-inserting <script src="cf-nav.js"> would be a no-op and the new banner
     would sit there unhandled. It therefore calls whatever is registered here
     after every swap. The controller is installed exactly once; only the
     per-element work is repeated. */

  window.__htpAfterSwap = window.__htpAfterSwap || [];
  window.__htpAfterSwap.push(mountAll);

  window.__htpBanner = { mount: mountAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
