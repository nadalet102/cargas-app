// sw.js — Cargas Arisac
// Estrategia "network-first": la app intenta SIEMPRE la versión más reciente
// (así las actualizaciones se ven al recargar) y solo usa la caché si no hay red.
const CACHE = 'arisac-v2';

self.addEventListener('install', (e) => {
  // activar de inmediato la nueva versión sin esperar
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // borrar cachés antiguas
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                  // no tocar POST/PUT/PATCH/DELETE
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // no tocar recursos externos
  if (url.pathname.startsWith('/api/')) return;       // la API siempre va a la red

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);                 // primero la red
      try {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());                // guardar copia para offline
      } catch (_) {}
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);         // sin red: usar caché
      if (cached) return cached;
      throw err;
    }
  })());
});
