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

const CACHE_NAME = 'medication-tracker-cache-' + getScopeKey() + '-v20';

const CORE_ASSETS = [
  './index.html',
  './styles.css',
  './script.js',
  './firebase-config.js',
  './service-worker.js',
  './manifest.webmanifest',
  './icon.svg',
];

const APP_SHELL = new Set(CORE_ASSETS.map((asset) => new URL(asset, self.registration.scope).pathname));

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

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const isAppShellRequest = request.mode === 'navigate' || APP_SHELL.has(url.pathname);

  if (isAppShellRequest) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match('./index.html');
        })
    );
    return;
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
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
