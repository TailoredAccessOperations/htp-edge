import type { ExecutionContext, Fetcher } from '@cloudflare/workers-types';

/**
 * pi.htp.sh Cloudflare Worker
 * - Serves static assets from the `ASSETS` binding (the ./public folder)
 * - Falls back to /index.html for any unknown path (single‑app behaviour)
 * - Adds a set of security‑hardening headers
 */

export interface Env {
  /** Binding to the static site created by the [site] section above */
  ASSETS: Fetcher;
}

/**
 * Main fetch handler
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // ---- Optional: enforce a preferred hostname (uncomment if needed) ----
    // if (url.hostname === 'www.pi.htp.sh') {
    //   url.hostname = 'pi.htp.sh';
    //   return Response.redirect(url.toString(), 301);
    // }

    // ---- Try to serve the requested asset ----
    let response = await env.ASSETS.fetch(request);

    // ---- If not found, serve index.html (lets client-side routing work) ----
    if (response.status === 404) {
      response = await env.ASSETS.fetch(new Request('/', request));
    }

    // ---- Clone the response so we can add headers ----
    const modified = new Response(response.body, response);

    // ---- Security headers -------------------------------------------------
    modified.headers.set('X-Content-Type-Options', 'nosniff');
    modified.headers.set('X-Frame-Options', 'DENY');
    modified.headers.set(
      'Referrer-Policy',
      'strict-origin-when-cross-origin'
    );
    modified.headers.set(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()'
    );

    // Content‑Security‑Policy – tighten as you see fit.
    // This policy allows:
    //   * same‑origin resources
    //   * images from data: and https:
    //   * inline styles & scripts (required by the existing site)
    //   * fonts and connections same‑origin only
    modified.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "img-src 'self' data: https:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; " +
        "font-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'"
    );

    // ---- Optional HSTS (only enable when you are 100% sure the site is served over HTTPS) ----
    // modified.headers.set(
    //   'Strict-Transport-Security',
    //   'max-age=31536000; includeSubDomains; preload'
    // );

    return modified;
  }
};