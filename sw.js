// ====== Service Worker com cache versionado ======

// Atualize esta versão sempre que fizer deploy
const VERSION = 'v3';
const CACHE_NAME = `camera-app-${VERSION}`;

// Lista de arquivos para cache inicial
const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './fotos/obras.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Instalação – faz cache inicial
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Pula a fase "waiting"
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

// Ativação – limpa caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Intercepta requests – cache first, fallback para rede
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Salva em cache dinâmico (opcional)
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
        .catch(() => {
          // Pode retornar um fallback offline se quiser
        });
    })
  );
});

// Recebe mensagem para forçar atualização imediata
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
