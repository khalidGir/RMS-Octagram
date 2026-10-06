const CACHE_NAME = 'rms-shell-v3';
const SHELL = [
  '/',
  '/login',
  '/offline',
  '/manifest.webmanifest',
  '/icons/app-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
];
const CUSTOMER_PAGE_PREFIXES = ['/r/', '/o/'];
const PUBLIC_API_PREFIX = '/api/v1/public/';
const IMMUTABLE_PATH_PREFIXES = ['/_next/static/', '/icons/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

async function cachePut(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    /* Quota or serialization failure: the live response is still returned. */
  }
}

/** Network-first: fresh data while online, last good response when offline. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await cachePut(request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return Response.error();
  }
}

/** Cache-first for immutable assets (hashed bundles, icons, CDN images). */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cachePut(request, response);
    return response;
  } catch {
    return Response.error();
  }
}

function isCustomerPage(pathname) {
  return CUSTOMER_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function navigationNetworkFirst(request) {
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (response.ok && isCustomerPage(url.pathname)) await cachePut(request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('/offline');
    return offline || Response.error();
  }
}

/**
 * The table-context resolve is the one POST that is read-only: it maps an
 * opaque table token to tenant/branch context. It is keyed by the token (the
 * token already lives in the page URL) so a table menu can be re-opened
 * offline. Every other POST (orders, payments, auth) stays network-only —
 * offline financial mutations are out of scope by design.
 */
async function tableContextCacheUrl(request) {
  try {
    const payload = JSON.parse(await request.clone().text());
    if (typeof payload?.token !== 'string' || !payload.token) return null;
    return new URL(`/__rms_offline/table-context/${encodeURIComponent(payload.token)}`, self.location.origin).href;
  } catch {
    return null;
  }
}

async function tableContextNetworkFirst(request) {
  const cacheKey = await tableContextCacheUrl(request);
  try {
    const response = await fetch(request);
    if (response.ok && cacheKey) await cachePut(new Request(cacheKey), response);
    return response;
  } catch {
    if (cacheKey) {
      const cached = await caches.match(cacheKey);
      if (cached) return cached;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === 'POST') {
    if (url.pathname.endsWith('/public/table-context/resolve')) {
      event.respondWith(tableContextNetworkFirst(request));
    }
    return;
  }
  if (request.method !== 'GET') return;

  if (url.pathname.startsWith(PUBLIC_API_PREFIX)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin !== self.location.origin) {
    if (request.destination === 'image') event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }
  if (IMMUTABLE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isCustomerPage(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || Response.error())));
});
