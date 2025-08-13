// ====== Service Worker com cache versionado e update automático ======

// Atualize a versão em cada deploy
const VERSION = 'v3';
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './proj4.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fotos/obras.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS.map(u => new Request(u, { cache: 'reload' })))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => {
        if (k !== STATIC_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req, { ignoreVary: true, ignoreSearch: true });
  return cached || fetch(req);
}

async function networkFirst(req, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req, { ignoreVary: true });
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });
  const net = fetch(req).then(res => { cache.put(req, res.clone()); return res; }).catch(()=>null);
  return cached || net || fetch(req);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navegação -> tenta rede e cai para index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match('./index.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // JSON de obras: network-first
  if (sameOrigin && url.pathname.endsWith('/fotos/obras.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Estáticos: css/js/manifest/icons -> cache-first
  if (sameOrigin && (
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.webmanifest') ||
      url.pathname.startsWith('/icons/')
    )) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Imagens em geral -> SWR
  if (req.destination === 'image') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Demais GETs -> network-first
  event.respondWith(networkFirst(req));
});

// Mensagem para “pular espera” quando nova versão estiver pronta
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
