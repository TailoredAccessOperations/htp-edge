/* ============================================================================
   HTP Connect — registration panel
   ----------------------------------------------------------------------------
   A real HTML5 form that turns into an email send.

   Why mailto and not a POST: this Worker has no transactional mail provider
   bound to it. A POST would either 404 or, worse, land in a generic catch-all
   and look like it worked while silently eating the registration. So the form
   validates, then composes a mailto: and hands it to the visitor's own mail
   client. That is the only version of this that cannot be repurposed into an
   open relay, and it keeps the visitor's data off our origin entirely.

   If a mail provider is ever bound, open()'s last step becomes a fetch() POST
   and the clipboard branch below becomes the fallback. Everything up to that
   point — validation, the readout, the tier pre-fill — is unchanged.

   Depends on public/connect-components.css for every class it touches.
   ========================================================================== */

(function () {
  'use strict';

  /* Where the message is addressed. Kept in sync with the footer's mailto:,
     which is injected by scripts/inject_connect_ui.py. Two copies of one
     address is a maintenance trap, so this reads it off the page instead of
     hardcoding it: if the injected footer mailto changes, the form follows. */
  var ADDRESS = (function () {
    var foot = document.querySelector('.cf-register__mail');
    if (foot) {
      var href = foot.getAttribute('href') || '';
      var m = href.match(/^mailto:([^?]+)/i);
      if (m) return decodeURIComponent(m[1]);
    }
    return '';
  })();

  var SUBJECT = 'HTP access request';

  var form, panel, log, tier, submitBtn, copyBtn;

  /* ── Readout ────────────────────────────────────────────────────────────
     One line at a time, newest last, capped so a user mashing the button
     cannot grow the DOM without bound. Cleared wholesale on each new submit
     rather than appended to, so repeated attempts do not scroll away. */

  function say(line, tone) {
    if (!log) return;
    if (!log.textContent) log.textContent = '';
    var row = document.createElement('span');
    row.className = 'cf-register__line' + (tone ? ' is-' + tone : '');
    row.textContent = line;
    log.appendChild(row);
    while (log.childNodes.length > 8) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function clearLog() {
    if (log) log.textContent = '';
  }

  /* ── Validation ──────────────────────────────────────────────────────────
     Constraint Validation API, not a hand-rolled regex pass. Two reasons: the
     browser's messages are already localised and already correct about
     type="email" edge cases, and the same constraints keep working if JS never
     runs at all — the inputs carry real required/pattern/minlength attributes,
     not data-* that only this script understands.

     novalidate is set on the form so the native bubble UI does not fight the
     panel's own readout; checkValidity() is still called, so the constraints
     are enforced, they just fail silently on their own and loudly in here. */

  function validate() {
    var controls = form.querySelectorAll(
      'input, select, textarea'
    );
    var firstBad = null;

    controls.forEach(function (el) {
      // Skip controls the visitor never engaged with: an empty optional
      // textarea is not an error just because it is listed.
      if (!el.willValidate) return;

      var ok = el.checkValidity();
      el.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (!ok) {
        el.classList.add('is-invalid');
        if (!firstBad) firstBad = el;
      } else {
        el.classList.remove('is-invalid');
      }
    });

    if (firstBad) {
      say('! ' + fieldLabel(firstBad) + ': ' + firstBad.validationMessage, 'bad');
      say('transmission aborted · ' + invalidCount() + ' field(s) rejected',
        'bad');
      // Focus the first offender so a keyboard user is not left guessing.
      firstBad.focus();
      return false;
    }
    return true;
  }

  function invalidCount() {
    var n = 0;
    form.querySelectorAll('[aria-invalid="true"]').forEach(function () {
      n += 1;
    });
    return n;
  }

  function fieldLabel(el) {
    var label = form.querySelector('label[for="' + el.id + '"]');
    if (!label) return el.name || el.id;
    // Strip the decorative $ prompt before showing the label text.
    return label.textContent.replace(/^\s*\$\s*/, '').trim();
  }

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /* ── Compose ────────────────────────────────────────────────────────────
     Built as an RFC 6068 mailto: with a percent-encoded subject and body.
     encodeURIComponent is the correct encoder here — mailto: bodies are
     percent-encoded, not form-encoded, so "+" must stay "+" and newlines must
     survive as %0A. */

  function compose() {
    var handle = value('cf-reg-handle');
    var email = value('cf-reg-email');
    var chosen = tier ? tier.value : 'Observer';
    var note = value('cf-reg-note');

    var body =
      'handle: ' + handle + '\n' +
      'return address: ' + email + '\n' +
      'requested tier: ' + chosen + '\n' +
      (note ? 'pretext: ' + note + '\n' : '') +
      '\n' +
      '--\n' +
      'sent from htp.sh access panel\n' +
      'the visitor read the notice and consented to logging';

    return (
      'mailto:' +
      encodeURIComponent(ADDRESS) +
      '?subject=' +
      encodeURIComponent(SUBJECT) +
      '&body=' +
      encodeURIComponent(body)
    );
  }

  /* ── Clipboard fallback ──────────────────────────────────────────────────
     For the visitor whose "mail client" is a webmail tab in another window they
     have not finished logging into. Same composed text, no navigation. */

  function copyPayload() {
    return compose().replace(/^mailto:[^?]+\?/, '');
  }

  function toClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // execCommand is deprecated and absent on some mobile browsers, but it is
    // the only route left when the async clipboard API is unavailable or was
    // refused because the page is not in a secure context.
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy refused'));
    });
  }

  /* ── Open ───────────────────────────────────────────────────────────────
     tier: optional pre-selected tier name, passed by the tier buttons in the
     Access cards. Empty or absent leaves whatever the visitor had chosen. */

  function open(prefillTier) {
    if (!panel) return;
    if (prefillTier && tier) {
      var match = Array.prototype.some.call(tier.options, function (o) {
        return o.value === prefillTier;
      });
      if (match) tier.value = prefillTier;
    }
    panel.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
    // Move focus so the panel is reachable by keyboard and screen readers
    // announce it; the panel itself is the tabindex="-1" target.
    panel.focus({ preventScroll: true });
    clearLog();
    say('$ access panel ready · fill the fields and transmit', 'dim');
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ── Submit ─────────────────────────────────────────────────────────────
     Validates, then navigates to the composed mailto. The navigation is the
     send: the OS or browser hands it to the visitor's mail client as a
     draft. This cannot confirm delivery, and it does not claim to. */

  function onSubmit(e) {
    e.preventDefault();
    clearLog();

    if (!validate()) return;

    say('$ validating … ok', 'ok');
    say('$ handle   → ' + value('cf-reg-handle'));
    say('$ address  → ' + value('cf-reg-email'));
    say('$ tier     → ' + (tier ? tier.value : '—'));

    // aria-busy rather than disabled. Disabling the button that currently has
    // focus blurs it, and the focus then lands on <body>: a keyboard user who
    // pressed Enter on Transmit is left at the top of the document with no idea
    // where the caret went. aria-busy keeps the button focusable and still
    // announces the in-flight state; the copy button stays live anyway, so
    // there is nothing to protect against a double submit.
    if (submitBtn) {
      submitBtn.setAttribute('aria-busy', 'true');
      say('$ handing message to your mail client …', 'dim');
    }

    var href = compose();
    // location.href rather than window.open: a popup gets blocked, whereas a
    // same-tab mailto is a navigation the browser handles natively.
    window.location.href = href;

    say('✓ draft opened · nothing left your browser but the address above', 'ok');
    say('if no window appeared, use "copy to clipboard"', 'dim');

    if (submitBtn) {
      // Clear on the next tick: the mailto navigation does not unload the page,
      // so without this the button would stay busy for the rest of the session.
      // Focus is re-asserted because some engines still blur on navigation.
      window.setTimeout(function () {
        submitBtn.removeAttribute('aria-busy');
        if (document.activeElement === document.body) submitBtn.focus();
      }, 1200);
    }
  }

  function onCopy() {
    clearLog();
    if (!validate()) return;
    say('$ copying message body …', 'dim');
    toClipboard(copyPayload()).then(
      function () {
        say('✓ copied · paste it into ' + ADDRESS, 'ok');
        if (copyBtn) {
          var span = copyBtn.querySelector('span');
          var was = span ? span.textContent : '';
          if (span) span.textContent = 'Copied';
          window.setTimeout(function () {
            if (span) span.textContent = was;
          }, 1600);
        }
      },
      function () {
        say('! clipboard refused by the browser', 'bad');
        say('write to ' + ADDRESS + ' by hand instead', 'dim');
      }
    );
  }

  /* Live-clearing of the error state. Re-validating on every keystroke would
     scold the visitor mid-address, so a field only sheds its red once it
     becomes valid, and the readout is left alone until the next submit. */
  function onFieldInput(e) {
    var el = e.target;
    if (!el || !el.name) return;
    if (el.getAttribute('aria-invalid') === 'true' && el.checkValidity()) {
      el.setAttribute('aria-invalid', 'false');
      el.classList.remove('is-invalid');
    }
  }

  function mount() {
    form = document.getElementById('cf-register-form');
    if (!form || form.getAttribute('data-cf-register-ready')) return;
    form.setAttribute('data-cf-register-ready', '1');

    panel = document.getElementById('connect-register');
    log = document.getElementById('cf-register-log');
    tier = document.getElementById('cf-reg-tier');
    submitBtn = document.getElementById('cf-register-submit');
    copyBtn = document.getElementById('cf-register-copy');

    form.addEventListener('submit', onSubmit);
    if (copyBtn) copyBtn.addEventListener('click', onCopy);
    form.addEventListener('input', onFieldInput);
    form.addEventListener('change', onFieldInput);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Public surface: cf-connect.js calls open() for the [data-cf-register-open]
  // buttons, and htp-nav.js re-runs it after a body swap.
  //
  // compose() is exposed deliberately. The submit path ends in a
  // `location.href = mailto:` navigation, which cannot be observed from inside
  // the page — Location.href's setter is non-configurable, so it cannot be
  // spied on, and the navigation either leaves or does nothing depending on
  // whether a mail client is registered. Exposing the composer is the only way
  // to assert that the encoded subject and body are correct.
  window.__htpRegister = {
    open: open,
    mount: mount,
    compose: compose,
  };
})();
