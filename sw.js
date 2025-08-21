// Service Worker – cache-first do "app shell" para funcionar offline
// >> Para forçar atualização, só incremente a versão abaixo.
const SW_VERSION = 'v4';
const CACHE = `geocam-utm-${SW_VERSION}`;
const BASE = self.registration.scope; // ex.: https://arvoengenharia.github.io/camera/

// Arquivos essenciais para rodar offline
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './proj4.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
].map(p => new URL(p, BASE).toString());

// Instalação: pré-cache do "app shell"
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Ativação: limpa caches antigos e assume o controle imediatamente
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: estratégia cache-first para requisições GET do mesmo domínio
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Só aplica cache para recursos do mesmo origin/escopo
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin) {
    // Para terceiros (CDNs etc.), deixa passar direto
    return; // cai no comportamento normal do browser
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(res => {
        // Evita cachear respostas inválidas/opacas
        if (!res || res.status !== 200 || res.type !== 'basic') {
          return res;
        }

        const copy = res.clone();
        caches.open(CACHE)
          .then(c => c.put(req, copy))
          .catch(() => {});
        return res;
      }).catch(() => {
        // Fallback para navegação offline
        if (req.mode === 'navigate') {
          return caches.match(new URL('./index.html', BASE).toString());
        }
      });
    })
  );
});
