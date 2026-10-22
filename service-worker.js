// MenuPro – service worker
// Regola d'oro: Supabase, /api e qualsiasi richiesta non-GET NON vengono mai toccati.
const CACHE = 'menupro-v16';
const APP_FILES = ['/', '/index.html', '/style.css', '/script.js', '/config.js', '/Manuale_MenuPro.pdf'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // un file mancante non deve far fallire l'installazione
      Promise.all(APP_FILES.map((f) => cache.add(f).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // ordini, login, ecc.

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = CDN_HOSTS.includes(url.hostname);

  if (!sameOrigin && !isCdn) return;                      // Supabase e altri: passano diretti
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // Network-first: se la rete c'è prendi la versione nuova, altrimenti la cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) =>
          hit ||
          (req.mode === 'navigate' ? caches.match('/index.html') : null) ||
          new Response('', { status: 504, statusText: 'Offline' })   // risposta valida, mai "Failed to fetch"
        )
      )
  );
});
