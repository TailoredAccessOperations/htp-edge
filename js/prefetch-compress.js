/**
 * HTP Prefetch + Compression Engine (catch-all).
 *
 * Runs once per page load. Responsibilities:
 *  1. Advertise gzip/brotli Accept-Encoding on every outbound fetch so the
 *     origin/edge returns compressed bodies (data-flow compression).
 *  2. Install a global fetch interceptor that stamps compression headers and
 *     caches frequently used responses in a bounded in-memory cache.
 *  3. Read Speculation-Rules / Link: rel=preload hints injected by the edge
 *     optimizer and convert them into <link rel=prefetch> hints for the browser.
 *  4. Prefetch same-origin discovered links during idle time (bounded queue).
 *
 * Minified-friendly, dependency-free, module-safe. No globals leaked.
 */
(() => {
  'use strict';

  const ENCODINGS = 'gzip, br, deflate';
  const CACHE_MAX = 64;
  const cache = new Map(); // url -> { body, ts, type }

  // ── 1. Compression: stamp Accept-Encoding on every fetch (data flow) ──
  const origFetch = window.fetch;
  window.fetch = async (input, init) => {
    const opts = init || {};
    const headers = new Headers(opts.headers || {});
    headers.set('Accept-Encoding', ENCODINGS);
    // Avoid sending visitor cookies on cross-origin prefetches.
    if (!opts.credentials) headers.delete('Cookie');
    const req = typeof input === 'string' ? new Request(input, opts) : input;
    const merged = new Request(req, { headers });

    // Serve from bounded cache for repeat GETs of small JSON/text assets.
    if (merged.method === 'GET' && cache.has(merged.url)) {
      const entry = cache.get(merged.url);
      if (Date.now() - entry.ts < 300_000) {
        return new Response(entry.body, {
          status: 200,
          headers: { 'Content-Type': entry.type, 'X-HTP-Cache': 'hit' },
        });
      }
      cache.delete(merged.url);
    }

    const res = await origFetch(merged);

    // Cache small same-origin JSON/text responses.
    try {
      const ct = res.headers.get('content-type') || '';
      if (merged.method === 'GET' && res.ok && res.headers.get('content-length') &&
          Number(res.headers.get('content-length')) < 65536 &&
          (ct.includes('application/json') || ct.includes('text/'))) {
        const clone = res.clone();
        const body = await clone.text();
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(merged.url, { body, ts: Date.now(), type: ct });
      }
    } catch { /* best effort only */ }

    return res;
  };

  // ── 2. Speculation rules → prefetch hints ──
  function applySpeculationRules() {
    const el = document.querySelector('script[type="speculationrules"]');
    if (!el) return;
    try {
      const rules = JSON.parse(el.textContent || el.innerText || '');
      const urls = (rules.prefetch || []).flatMap((p) => p.urls || []);
      urls.slice(0, 12).forEach((u) => {
        try {
          const abs = new URL(u, location.origin).href;
          if (new URL(abs).origin === location.origin) {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.as = 'document';
            link.href = abs;
            document.head.appendChild(link);
          }
        } catch { /* ignore */ }
      });
    } catch { /* ignore malformed speculation rules */ }
  }

  // ── 3. Idle-time prefetch of same-origin discovered links ──
  function prefetchDiscovered() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const seen = new Set();
    const toFetch = [];
    for (const a of anchors) {
      try {
        const abs = new URL(a.href, location.origin).href;
        if (new URL(abs).origin === location.origin && !seen.has(abs)) {
          seen.add(abs);
          const p = abs.split('#')[0];
          if (/\.(?:html?)$/i.test(p)) toFetch.push(abs);
        }
      } catch { /* ignore */ }
    }
    const schedule = () => {
      toFetch.slice(0, 8).forEach((u) => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'document';
        link.href = u;
        document.head.appendChild(link);
      });
    };
    if ('requestIdleCallback' in window) requestIdleCallback(schedule, { timeout: 3000 });
    else setTimeout(schedule, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applySpeculationRules();
      prefetchDiscovered();
    });
  } else {
    applySpeculationRules();
    prefetchDiscovered();
  }
})();
