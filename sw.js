const CACHE = 'geocam-utm-v1';
const ASSETS = [
  '/',              // se seu servidor devolver o index na raiz
  '/index.html',
  '/manifest.webmanifest',
  '/sw.js',
  '/proj4.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Cache-first para tudo que faz parte do app
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // cacheia respostas navegáveis/opacas também (útil se houver CDNs)
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => {
        // opcional: retornar index offline para navegação
        if (req.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
