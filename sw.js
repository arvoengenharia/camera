// Service Worker – cache-first do "app shell" para funcionar offline
const CACHE = 'geocam-utm-v3';
const BASE = self.registration.scope; // ex.: https://arvoengenharia.github.io/camera/

const ASSETS = [
  './',
  './index.html',
  './proj4.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
].map(p => new URL(p, BASE).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => {
        // fallback para navegação offline
        if (req.mode === 'navigate') {
          return caches.match(new URL('./index.html', BASE).toString());
        }
      });
    })
  );
});
