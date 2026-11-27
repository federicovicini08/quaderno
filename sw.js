/* Service worker: tiene l'app disponibile offline.
   Le dispense sono salvate a parte da app.js (cache "quaderno-contenuti-*"). */
const SHELL = 'quaderno-shell-v1';
const FILES = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter((n) => n.startsWith('quaderno-shell-') && n !== SHELL).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const salvata = await c.match(req, { ignoreSearch: true });
    const rete = fetch(req).then((r) => {
      if (r.ok) c.put(req, r.clone());
      return r;
    }).catch(() => null);
    if (salvata) { e.waitUntil(rete); return salvata; }
    const r = await rete;
    return r || (await c.match('./index.html')) || Response.error();
  })());
});
