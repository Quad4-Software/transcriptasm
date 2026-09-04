/* transcriptasm service worker: offline shell, COOP/COEP isolation, auto-update */
const CACHE_VERSION = 'transcriptasm-v0.1.11';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const PRECACHE = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/models.json',
  '/css/app.css',
  '/js/main.js',
  '/js/pwa.js',
  '/js/ui/app.js',
  '/js/ui/wave.js',
  '/js/audio/decode.js',
  '/js/audio/mic.js',
  '/js/audio/resample.js',
  '/js/audio/pcm-buffer.js',
  '/js/engine/registry.js',
  '/js/engine/types.js',
  '/js/engine/whisper-cpp.js',
  '/js/engine/whisper-parse.js',
  '/icons/favicon-16.png',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/fonts/bricolage-700.woff2',
  '/fonts/fraunces-400.woff2',
  '/fonts/fraunces-600.woff2',
  '/vendor/whisper/main.js',
  '/vendor/whisper/main.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('transcriptasm-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source && event.source.postMessage({ type: 'SW_VERSION', version: CACHE_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') {
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === '/sw.js') {
    event.respondWith(networkOnly(req));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL_CACHE, '/index.html'));
    return;
  }

  if (
    url.pathname.startsWith('/models/') ||
    url.pathname.startsWith('/vendor/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/samples/')
  ) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

/**
 * GitHub Pages cannot set COOP/COEP. Inject them so SharedArrayBuffer works.
 * @param {Response} response
 * @returns {Response}
 */
function withIsolationHeaders(response) {
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function networkOnly(req) {
  return fetch(req);
}

async function networkFirst(req, cacheName, fallbackPath) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone());
    }
    return withIsolationHeaders(fresh);
  } catch {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) {
      return withIsolationHeaders(cached);
    }
    if (fallbackPath) {
      const fallback = await cache.match(fallbackPath);
      if (fallback) {
        return withIsolationHeaders(fallback);
      }
    }
    return withIsolationHeaders(new Response('Offline', { status: 503, statusText: 'Offline' }));
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    return withIsolationHeaders(cached);
  }
  const fresh = await fetch(req);
  if (fresh && fresh.ok) {
    cache.put(req, fresh.clone());
  }
  return withIsolationHeaders(fresh);
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((fresh) => {
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    })
    .catch(() => cached);
  const response = cached || (await network);
  return withIsolationHeaders(response);
}
