/* Service worker: tiene l'app disponibile offline.
   Prima prova la rete (così le nuove versioni arrivano subito), se non c'è usa la copia salvata.
   Le dispense sono salvate a parte da app.js (cache "quaderno-contenuti-*"). */
const SHELL = 'quaderno-shell-v3';
const FILES = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter((n) => n.startsWith('quaderno-shell-') && n !== SHELL).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function conTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      // Nuova richiesta dall'URL: le richieste di navigazione non accettano opzioni extra.
      const r = await conTimeout(fetch(new Request(req.url, { cache: 'no-cache' })), 4000);
      if (r.ok) c.put(req, r.clone());
      return r;
    } catch {
      const salvata = await c.match(req, { ignoreSearch: true });
      return salvata || (await c.match('./index.html')) || Response.error();
    }
  })());
});
