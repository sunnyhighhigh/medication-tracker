function getScopeKey() {
  try {
    const path = new URL(self.registration.scope).pathname;
    return String(path)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'root';
  } catch {
    return 'root';
  }
}

const CACHE_NAME = 'medication-tracker-cache-' + getScopeKey() + '-v18';

const CORE_ASSETS = [
  './index.html',
  './styles.css',
  './script.js',
  './firebase-config.js',
  './service-worker.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }

  // Avoid caching cross-origin requests (Firebase CDN, etc.).
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
      return;
    }
  } catch {
    // ignore
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
