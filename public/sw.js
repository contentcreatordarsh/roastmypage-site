const CACHE_VERSION = 'v1';
const STATIC_CACHE = `rmlp-static-${CACHE_VERSION}`;
const API_CACHE = `rmlp-api-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/apple-touch-icon.svg'
];

const STATIC_EXTENSIONS = /\.(?:css|js|html|webmanifest|svg|png|jpg|jpeg|gif|webp|ico)$/i;
const STATIC_DESTINATIONS = new Set(['style', 'script', 'image', 'font', 'manifest']);
const ROAST_POST_PATHS = new Set(['/api/roast', '/api/roast-stream', '/api/v1/roast']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('rmlp-') && ![STATIC_CACHE, API_CACHE].includes(cacheName))
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && ROAST_POST_PATHS.has(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname === '/sw.js') {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

function isStaticAssetRequest(request, url) {
  return url.pathname === '/'
    || url.pathname === '/index.html'
    || STATIC_DESTINATIONS.has(request.destination)
    || STATIC_EXTENSIONS.test(url.pathname);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    refreshCache(request, cache);
    return cached;
  }

  const response = await fetch(request);
  await cacheResponse(cache, request, response);
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    await cacheResponse(cache, request, response);
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

function refreshCache(request, cache) {
  fetch(request)
    .then((response) => cacheResponse(cache, request, response))
    .catch(() => undefined);
}

async function cacheResponse(cache, request, response) {
  if (!response || response.status !== 200 || response.type === 'error') return;
  await cache.put(request, response.clone());
}
