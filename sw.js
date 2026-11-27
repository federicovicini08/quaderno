/* Service worker: tiene l'app disponibile offline.
   App: prima prova la rete (così le nuove versioni arrivano subito), se non c'è usa la copia salvata.
   KaTeX (formule): copia salvata, scaricata una volta sola.
   Le dispense sono salvate a parte da app.js (cache "quaderno-contenuti-*"). */
const SHELL = 'quaderno-shell-v4';
const LIBRERIE = 'quaderno-librerie-v1';
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
const FILES = [
  './', './index.html', './styles.css', './app.js', './personale.js', './note.js', './studio.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const KATEX_FILES = ['katex.min.js', 'katex.min.css', 'contrib/auto-render.min.js'].map((f) => KATEX + f);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    try { const l = await caches.open(LIBRERIE); await l.addAll(KATEX_FILES.map((u) => new Request(u, { mode: 'cors' }))); } catch { /* le prendo al primo uso */ }
    await self.skipWaiting();
  })());
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
  if (req.method !== 'GET') return;
  if (req.url.startsWith(KATEX)) {
    e.respondWith((async () => {
      const c = await caches.open(LIBRERIE);
      const salvata = await c.match(req, { ignoreVary: true });
      if (salvata) return salvata;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    })());
    return;
  }
  if (!req.url.startsWith(self.registration.scope)) return;
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
