/**
 * Service Worker - HTP Static Asset Caching
 * Caches CSS, JS, fonts, and images for faster repeat visits
 */

const CACHE_VERSION = 'htp-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/money.html',
  '/htp-critical.css',
  '/js/optimize-assets.js',
  '/favicon.ico'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Partial cache failure is OK
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_VERSION)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for static assets, network-first for dynamic
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== location.origin) return;

  // Static assets: cache-first
  if (/\.(css|js|woff2?|ttf|eot|png|jpg|jpeg|gif|ico|svg)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response && response.status === 200) {
            const cache = caches.open(CACHE_VERSION);
            cache.then(c => c.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML: network-first, fallback to cache
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const cache = caches.open(CACHE_VERSION);
            cache.then(c => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }
});
