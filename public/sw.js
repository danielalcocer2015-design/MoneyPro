// Service worker mínimo: cachea el shell de la app para que abra rápido
// e instale como PWA. No cachea /api/** (los movimientos y el webhook
// siempre deben ir a la red).
//
// Estrategia: red primero, caché solo como respaldo si no hay conexión.
// (La primera versión hacía caché primero, lo que dejaba a la gente
// atascada viendo una versión vieja de la app indefinidamente después
// de cada actualización — súbele el número de CACHE en cada cambio
// importante para forzar que se limpie la caché vieja de quien ya
// tenía la app instalada.)
const CACHE = 'moneypro-shell-v2';
const SHELL = ['./', './index.html', './style.css', './app.js', './categories.js', './charts.js', './firebase-config.js', './manifest.json', './icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
