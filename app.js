'use strict';

/* Quaderno: legge le dispense dall'archivio GitHub privato, le salva sul
   dispositivo per l'uso offline e le mostra con indice e segnalibri. */

const VERSIONE = '0.1.1';
const ARCHIVIO_PREDEFINITO = 'federicovicini08/dispense';
const CACHE_CONTENUTI = 'quaderno-contenuti-v1';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* spazio pieno o storage bloccato */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* niente */ } },
};
const K = { conf: 'q.conf', shas: 'q.shas', meta: 'q.meta', bm: 'q.segnalibri', pos: 'q.posizioni', last: 'q.ultima', side: 'q.indice' };

const params = new URLSearchParams(location.search);
// Modalità di prova sul Mac: legge i file dalla cartella accanto invece che da GitHub.
const LOCALE = params.has('local') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

let conf = store.get(K.conf, null);
let data = null;
const app = $('#app');

/* ---------- Icone ---------- */
const ico = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  toc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  bm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  bmOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* ---------- Messaggi ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}
const fmtData = (ms) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);

/* ---------- Copia offline ---------- */
const memo = new Map();
const cacheKey = (path) => new Request(new URL('./__contenuti__/' + path, location.href).href);
async function cacheGet(path) {
  if (memo.has(path)) return memo.get(path);
  try {
    const c = await caches.open(CACHE_CONTENUTI);
    const r = await c.match(cacheKey(path));
    if (!r) return null;
    const t = await r.text();
    memo.set(path, t);
    return t;
  } catch { return null; }
}
async function cachePut(path, text) {
  memo.set(path, text);
  try {
    const c = await caches.open(CACHE_CONTENUTI);
    await c.put(cacheKey(path), new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  } catch { /* resta in memoria per questa sessione */ }
}

/* ---------- GitHub ---------- */
async function gh(path, raw = false, token = conf && conf.token) {
  const r = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
  return raw ? r.text() : r.json();
}
async function localeGet(path) {
  const r = await fetch('../dispense/' + path, { cache: 'no-store' });
  if (!r.ok) { const e = new Error('Locale ' + r.status); e.status = r.status; throw e; }
  return r.text();
}

/* ---------- Sincronizzazione ---------- */
let syncing = false;
async function sync({ manuale = false } = {}) {
  if (syncing) return;
  syncing = true;
  setSyncUI(true);
  const cambiati = new Set();
  try {
    const shas = store.get(K.shas, {});
    let remoto = null;
    if (!LOCALE) {
      const albero = await gh(`/repos/${conf.repo}/git/trees/HEAD?recursive=1`);
      remoto = {};
      for (const it of albero.tree) if (it.type === 'blob') remoto[it.path] = it.sha;
      if (!remoto['materie.json']) throw new Error('materie.json mancante');
    }
    const scarica = (path) => (LOCALE ? localeGet(path) : gh(`/repos/${conf.repo}/git/blobs/${remoto[path]}`, true));
    const serve = async (path) => LOCALE || shas[path] !== remoto[path] || !(await cacheGet(path));

    if (await serve('materie.json')) {
      const txt = await scarica('materie.json');
      JSON.parse(txt);
      await cachePut('materie.json', txt);
      if (remoto) shas['materie.json'] = remoto['materie.json'];
    }
    data = JSON.parse(await cacheGet('materie.json'));

    let aggiornate = 0, nuove = 0;
    for (const m of data.materie) {
      for (const d of m.dispense) {
        if (!d.file || (remoto && !remoto[d.file])) continue;
        if (!(await serve(d.file))) continue;
        const giaSalvata = !!(await cacheGet(d.file));
        const txt = await scarica(d.file);
        if (LOCALE && memo.get(d.file) === txt) continue;
        await cachePut(d.file, txt);
        if (remoto) shas[d.file] = remoto[d.file];
        cambiati.add(d.file);
        if (giaSalvata) aggiornate++; else nuove++;
      }
    }
    store.set(K.shas, shas);
    store.set(K.meta, { ultimo: Date.now() });
    if (!LOCALE && aggiornate) toast(aggiornate === 1 ? '1 dispensa aggiornata' : `${aggiornate} dispense aggiornate`);
    else if (!LOCALE && nuove) toast(`${nuove} dispense salvate per l'uso offline`);
    else if (manuale) toast('Tutto aggiornato');
  } catch (e) {
    ultimoErrore = descriviErrore(e);
    if (e.status === 401) { showLogin('Il token non è più valido o è scaduto. Collegati di nuovo.'); return; }
    if ((e.status === 403 || e.status === 404) && !LOCALE) { showLogin(MSG_PERMESSI); return; }
    toast(navigator.onLine ? 'Aggiornamento non riuscito: uso la copia salvata' : 'Sei offline: uso la copia salvata');
  } finally {
    syncing = false;
    setSyncUI(false);
  }
  if (!data) {
    const txt = await cacheGet('materie.json');
    if (txt) data = JSON.parse(txt);
  }
  dopoSync(cambiati);
}
function setSyncUI(on) {
  const b = $('#syncBtn');
  if (b) b.classList.toggle('spin', on);
}
let ultimoErrore = '';
const MSG_PERMESSI = 'Il token entra nell\'archivio ma non può leggere i file. Su GitHub apri il token e controlla: Repository access → "dispense" selezionato, e Permissions → Contents → "Read and write". Poi incolla di nuovo il token qui.';
function descriviErrore(e) {
  if (e && e.status) return 'GitHub ha risposto con il codice ' + e.status;
  return (e && (e.name + ': ' + e.message)) || String(e);
}
function dopoSync(cambiati) {
  if (!data) {
    if ($('.login')) return;
    app.innerHTML = `<div class="loading"><div style="max-width:420px;text-align:center;padding:24px">
      <p>Non sono riuscito a scaricare le dispense e su questo dispositivo non c'è ancora una copia salvata.</p>
      ${ultimoErrore ? `<p class="muted" style="font-size:14px">Dettaglio: ${esc(ultimoErrore)}</p>` : ''}
      <button class="primary" id="riprova">Riprova</button>
      <button class="sheet-btn ghost" id="ricollega">Collega di nuovo GitHub</button></div></div>`;
    $('#riprova').onclick = () => { app.innerHTML = '<div class="loading">Scarico le dispense…</div>'; sync({ manuale: true }); };
    $('#ricollega').onclick = () => showLogin();
    return;
  }
  if (R && R.d.file && cambiati.has(R.d.file)) { salvaPosizione(); const { m, d } = R; R = null; showReader(m.id, d.id); return; }
  if (!R) route();
}

/* ---------- Dati ---------- */
const coloreSicuro = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#8ab4ff');
function trova(mId, dId) {
  const m = data && data.materie.find((x) => x.id === mId);
  const d = m && dId != null ? m.dispense.find((x) => x.id === dId) : null;
  return { m, d };
}
const chiave = (m, d) => `${m}/${d}`;

/* ---------- Router ---------- */
function route() {
  const parti = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  if (!LOCALE && !conf) return showLogin();
  if (R && !(parti[0] === 'd' && parti[1] === R.m.id && parti[2] === R.d.id)) { salvaPosizione(); R = null; }
  if (!data) { app.innerHTML = '<div class="loading">Caricamento…</div>'; return; }
  if (parti[0] === 'm') return showMateria(parti[1]);
  if (parti[0] === 'd') return showReader(parti[1], parti[2], parti[3]);
  return showHome();
}
window.addEventListener('hashchange', route);

/* ---------- Home ---------- */
function topbarHome() {
  return `<header class="topbar"><div class="brand">Quaderno</div><div class="spacer"></div>
    <button class="icon-btn${syncing ? ' spin' : ''}" id="syncBtn" aria-label="Aggiorna">${ico.sync}</button>
    <button class="icon-btn" id="menuBtn" aria-label="Menu">${ico.more}</button></header>`;
}
function bindTopbar() {
  $('#syncBtn').onclick = () => sync({ manuale: true });
  $('#menuBtn').onclick = apriMenu;
}
function showHome() {
  document.title = 'Quaderno';
  const ultima = store.get(K.last, null);
  const u = ultima && trova(ultima.m, ultima.d);
  const resume = u && u.d ? `
    <a class="resume" href="#/d/${enc(u.m.id)}/${enc(u.d.id)}" style="--accent:${coloreSicuro(u.m.colore)}">
      <div><div class="label">Riprendi</div><div class="what">${esc(u.d.titolo)}</div>
      <div class="where">${esc(ultima.titolo || u.m.nome)}</div></div>${ico.next}</a>` : '';
  const carte = data.materie.map((m) => {
    const n = m.dispense.length;
    return `<a class="card" href="#/m/${enc(m.id)}" style="--accent:${coloreSicuro(m.colore)}">
      <div class="name">${esc(m.nome)}</div><div class="count">${n === 1 ? '1 dispensa' : n + ' dispense'}</div></a>`;
  }).join('');
  const meta = store.get(K.meta, null);
  app.innerHTML = `${topbarHome()}<main class="page">
    ${resume ? `<h2 class="section-title">Continua</h2>${resume}` : ''}
    <h2 class="section-title">Materie</h2><div class="grid">${carte}</div>
    <h2 class="section-title">Segnalibri</h2>${listaSegnalibri()}
    <p class="foot">${meta ? 'Ultimo aggiornamento: ' + esc(fmtData(meta.ultimo)) : ''}${LOCALE ? ' · modalità di prova' : ''}</p></main>`;
  bindTopbar();
  bindSegnalibri(app);
}
function listaSegnalibri(filtro) {
  const tutti = store.get(K.bm, []).filter((b) => !filtro || filtro(b));
  if (!tutti.length) return '<div class="empty">Nessun segnalibro. Mentre leggi, tocca l\'icona del segnalibro in alto per salvare la sezione.</div>';
  return '<div class="list">' + tutti.map((b) => {
    const { m, d } = trova(b.m, b.d);
    if (!d) return '';
    return `<div class="row" style="--accent:${coloreSicuro(m.colore)}"><span class="bar"></span>
      <a class="txt" href="#/d/${enc(b.m)}/${enc(b.d)}/${enc(b.anchor)}" style="text-decoration:none">
      <div class="t">${esc(b.titolo)}</div><div class="s">${esc(d.titolo)}</div></a>
      <button class="icon-btn" data-del="${esc(b.id)}" aria-label="Elimina segnalibro">${ico.x}</button></div>`;
  }).join('') + '</div>';
}
function bindSegnalibri(root, dopo) {
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      store.set(K.bm, store.get(K.bm, []).filter((b) => b.id !== btn.dataset.del));
      toast('Segnalibro eliminato');
      dopo ? dopo() : route();
    };
  });
}

/* ---------- Materia ---------- */
function showMateria(mId) {
  const { m } = trova(mId);
  if (!m) return showHome();
  document.title = m.nome + ' · Quaderno';
  const righe = m.dispense.map((d) => d.file
    ? `<a class="row" href="#/d/${enc(m.id)}/${enc(d.id)}"><span class="bar"></span><div class="txt"><div class="t">${esc(d.titolo)}</div></div>${ico.next.replace('<svg', '<svg width="20" height="20"')}</a>`
    : `<div class="row disabled"><span class="bar"></span><div class="txt"><div class="t">${esc(d.titolo)}</div><div class="s">La sto ancora convertendo</div></div><span class="badge">In arrivo</span></div>`).join('');
  app.innerHTML = `<div style="--accent:${coloreSicuro(m.colore)}">
    <header class="topbar"><a class="icon-btn" href="#/" aria-label="Indietro">${ico.back}</a>
      <div class="title"><div class="over">Materia</div><div class="main">${esc(m.nome)}</div></div>
      <button class="icon-btn${syncing ? ' spin' : ''}" id="syncBtn" aria-label="Aggiorna">${ico.sync}</button>
      <button class="icon-btn" id="menuBtn" aria-label="Menu">${ico.more}</button></header>
    <main class="page">
      <div class="materia-head"><span class="swatch"></span><h1>${esc(m.nome)}</h1></div>
      <h2 class="section-title">Dispense</h2><div class="list">${righe}</div>
      <h2 class="section-title">Segnalibri di questa materia</h2>${listaSegnalibri((b) => b.m === m.id)}
    </main></div>`;
  bindTopbar();
  bindSegnalibri(app);
}

/* ---------- Lettore ---------- */
let R = null; // stato della dispensa aperta
const largo = () => matchMedia('(min-width: 900px)').matches;

function prepara(html, colore) {
  // Forza il tema scuro già presente nelle dispense e nasconde il loro indice interno.
  let h = html.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, '@media all');
  const css = `<style id="quaderno">
    html{color-scheme:dark;-webkit-text-size-adjust:100%}
    body{background:#121419!important;color:#e6e6e6}
    #TOC{display:none!important}
    h1{border-color:${colore}!important}
    body>h1:first-of-type{color:${colore}!important;border:0!important}
    ::selection{background:${colore}55}
    img,svg,video{max-width:100%;height:auto}
    a{color:${colore}}
  </style>`;
  return /<\/head>/i.test(h) ? h.replace(/<\/head>/i, css + '</head>') : css + h;
}

function showReader(mId, dId, anchor) {
  const { m, d } = trova(mId, dId);
  if (!d) return showHome();
  if (R && R.m.id === mId && R.d.id === dId) { if (anchor && R.doc) vaiA(anchor); return; }
  const colore = coloreSicuro(m.colore);
  R = { m, d, colore, heads: [], active: null, tab: 'indice', doc: null, win: null };
  document.title = d.titolo + ' · Quaderno';
  const aperto = largo() ? store.get(K.side, true) : false;
  app.innerHTML = `<div class="reader${aperto ? ' side-open' : ''}" style="--accent:${colore}">
    <header class="topbar">
      <a class="icon-btn" href="#/m/${enc(m.id)}" aria-label="Indietro">${ico.back}</a>
      <button class="icon-btn" id="tocBtn" aria-label="Indice">${ico.toc}</button>
      <div class="title"><div class="over">${esc(m.nome)}</div><div class="main">${esc(d.titolo)}</div></div>
      <button class="icon-btn" id="bmBtn" aria-label="Aggiungi segnalibro">${ico.bm}</button>
    </header>
    <div class="reader-body">
      <aside class="side" aria-label="Indice e segnalibri">
        <div class="tabs"><button class="tab active" data-tab="indice">Indice</button><button class="tab" data-tab="segnalibri">Segnalibri</button></div>
        <nav class="side-list" id="sideList"></nav>
      </aside>
      <div class="scrim" id="scrim"></div>
      <iframe class="doc" id="doc" title="${esc(d.titolo)}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
    </div></div>`;

  const reader = $('.reader');
  $('#tocBtn').onclick = () => {
    const ora = !reader.classList.contains('side-open');
    reader.classList.toggle('side-open', ora);
    if (largo()) store.set(K.side, ora);
    if (ora) scorriIndiceAttivo();
  };
  $('#scrim').onclick = () => reader.classList.remove('side-open');
  reader.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => { R.tab = t.dataset.tab; reader.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t)); renderSide(); };
  });
  $('#bmBtn').onclick = toggleSegnalibro;

  cacheGet(d.file).then((html) => {
    if (!R || R.d !== d) return;
    if (!html) { $('.reader-body').innerHTML = '<div class="reader-msg">Questa dispensa non è ancora salvata sul dispositivo. Collegati a internet e tocca Aggiorna.</div>'; return; }
    const frame = $('#doc');
    frame.addEventListener('load', () => docPronto(frame, d, anchor), { once: true });
    frame.srcdoc = prepara(html, colore);
  });
  renderSide();
}

function docPronto(frame, d, anchor) {
  if (!R || R.d !== d) return;
  const doc = frame.contentDocument, win = frame.contentWindow;
  R.doc = doc; R.win = win;
  R.heads = [...doc.querySelectorAll('h1[id], h2[id], h3[id]')].map((el) => ({
    id: el.id, el, level: +el.tagName[1], text: testoTitolo(el),
  }));

  // Link interni: scorrono nella dispensa. Link esterni: si aprono a parte.
  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    e.preventDefault();
    if (href.startsWith('#')) vaiA(decodeURIComponent(href.slice(1)));
    else window.open(a.href, '_blank', 'noopener');
  });

  let raf = 0;
  win.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; aggiornaAttivo(); salvaPosizioneDopo(); });
  }, { passive: true });

  const pos = store.get(K.pos, {})[chiave(R.m.id, d.id)];
  if (anchor) vaiA(anchor);
  else if (pos) {
    const h = pos.anchor && doc.getElementById(pos.anchor);
    win.scrollTo(0, h ? topDi(h) + (pos.delta || 0) : pos.y || 0);
  }
  aggiornaAttivo();
  renderSide();
  segnaUltima();
}

// Le formule KaTeX contengono il testo due volte (MathML nascosto + versione visibile): tengo solo la seconda.
function testoTitolo(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.katex-mathml, annotation').forEach((n) => n.remove());
  return c.textContent.trim().replace(/\s+/g, ' ');
}

const topDi = (el) => el.getBoundingClientRect().top + R.win.scrollY;

function vaiA(id) {
  const el = R && R.doc && R.doc.getElementById(id);
  if (!el) return;
  R.win.scrollTo({ top: Math.max(0, topDi(el) - 8), behavior: 'auto' });
  aggiornaAttivo();
  salvaPosizioneDopo();
  if (!largo()) $('.reader') && $('.reader').classList.remove('side-open');
}

function sezioneCorrente() {
  if (!R || !R.heads.length) return null;
  let cur = null;
  for (const h of R.heads) { if (h.el.getBoundingClientRect().top <= 90) cur = h; else break; }
  return cur || R.heads[0];
}

function aggiornaAttivo() {
  const cur = sezioneCorrente();
  const id = cur ? cur.id : null;
  if (id !== R.active) {
    R.active = id;
    if (R.tab === 'indice') {
      $('#sideList').querySelectorAll('.toc-item').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
      scorriIndiceAttivo();
    }
  }
  const bm = $('#bmBtn');
  if (bm) {
    const on = !!trovaSegnalibro(id);
    bm.classList.toggle('on', on);
    bm.innerHTML = on ? ico.bmOn : ico.bm;
    bm.setAttribute('aria-label', on ? 'Rimuovi segnalibro' : 'Aggiungi segnalibro');
  }
}
function scorriIndiceAttivo() {
  const a = $('#sideList .toc-item.active');
  if (a && $('.reader.side-open')) a.scrollIntoView({ block: 'nearest' });
}

function renderSide() {
  const list = $('#sideList');
  if (!list || !R) return;
  if (R.tab === 'indice') {
    if (!R.heads.length) { list.innerHTML = '<div class="side-empty">' + (R.doc ? 'Questa dispensa non ha titoli di sezione.' : 'Caricamento…') + '</div>'; return; }
    list.innerHTML = R.heads.map((h) => `<button class="toc-item l${h.level}${h.id === R.active ? ' active' : ''}" data-id="${esc(h.id)}">${esc(h.text)}</button>`).join('');
    list.querySelectorAll('.toc-item').forEach((b) => { b.onclick = () => vaiA(b.dataset.id); });
  } else {
    const miei = store.get(K.bm, []).filter((b) => b.m === R.m.id && b.d === R.d.id);
    if (!miei.length) { list.innerHTML = '<div class="side-empty">Nessun segnalibro in questa dispensa. Tocca l\'icona del segnalibro in alto per salvare la sezione che stai leggendo.</div>'; return; }
    list.innerHTML = miei.map((b) => `<div class="bm-item"><button class="toc-item" data-id="${esc(b.anchor)}">${esc(b.titolo)}</button>
      <button class="icon-btn" data-del="${esc(b.id)}" aria-label="Elimina segnalibro">${ico.x}</button></div>`).join('');
    list.querySelectorAll('.toc-item').forEach((b) => { b.onclick = () => vaiA(b.dataset.id); });
    bindSegnalibri(list, () => { renderSide(); aggiornaAttivo(); });
  }
}

/* ---------- Segnalibri ---------- */
function trovaSegnalibro(anchor) {
  if (!R || !anchor) return null;
  return store.get(K.bm, []).find((b) => b.m === R.m.id && b.d === R.d.id && b.anchor === anchor) || null;
}
function toggleSegnalibro() {
  const cur = sezioneCorrente();
  if (!cur) { toast('Apri una sezione per salvarla'); return; }
  const tutti = store.get(K.bm, []);
  const esiste = trovaSegnalibro(cur.id);
  if (esiste) {
    store.set(K.bm, tutti.filter((b) => b.id !== esiste.id));
    toast('Segnalibro rimosso');
  } else {
    tutti.unshift({ id: Date.now().toString(36), m: R.m.id, d: R.d.id, anchor: cur.id, titolo: cur.text, creato: Date.now() });
    store.set(K.bm, tutti);
    toast('Segnalibro aggiunto');
  }
  R.active = null;
  aggiornaAttivo();
  if (R.tab === 'segnalibri') renderSide();
}

/* ---------- Posizione di lettura ---------- */
let posT;
function salvaPosizioneDopo() { clearTimeout(posT); posT = setTimeout(salvaPosizione, 400); }
function salvaPosizione() {
  if (!R || !R.win) return;
  const cur = sezioneCorrente();
  const all = store.get(K.pos, {});
  all[chiave(R.m.id, R.d.id)] = cur ? { anchor: cur.id, delta: R.win.scrollY - topDi(cur.el) } : { y: R.win.scrollY };
  store.set(K.pos, all);
  segnaUltima(cur);
}
function segnaUltima(cur = sezioneCorrente()) {
  if (!R) return;
  store.set(K.last, { m: R.m.id, d: R.d.id, titolo: cur ? cur.text : '', quando: Date.now() });
}
window.addEventListener('pagehide', salvaPosizione);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { salvaPosizione(); return; }
  const meta = store.get(K.meta, null);
  if ((conf || LOCALE) && (!meta || Date.now() - meta.ultimo > 60_000)) sync();
});

/* ---------- Menu ---------- */
function apriMenu() {
  const dlg = $('#menu');
  const meta = store.get(K.meta, null);
  $('#menuInfo').textContent = `Versione ${VERSIONE} · archivio ${LOCALE ? 'locale (prova)' : conf.repo}` + (meta ? ` · aggiornato ${fmtData(meta.ultimo)}` : '');
  dlg.querySelector('[data-act="sync"]').onclick = () => { dlg.close(); sync({ manuale: true }); };
  const out = dlg.querySelector('[data-act="logout"]');
  out.hidden = LOCALE;
  out.onclick = async () => {
    if (!confirm('Scollegare GitHub da questo dispositivo? Le dispense salvate qui verranno cancellate (restano su GitHub).')) return;
    dlg.close();
    [K.conf, K.shas, K.meta].forEach(store.del);
    try { await caches.delete(CACHE_CONTENUTI); } catch { /* niente */ }
    memo.clear(); conf = null; data = null; R = null;
    location.hash = '#/';
    showLogin();
  };
  dlg.showModal();
}

/* ---------- Accesso ---------- */
function showLogin(errore) {
  R = null;
  document.title = 'Collega GitHub · Quaderno';
  const repo = (conf && conf.repo) || ARCHIVIO_PREDEFINITO;
  app.innerHTML = `<main class="login"><div class="login-card">
    <img src="icons/icon-192.png" alt="">
    <h1>Quaderno</h1><p>Le tue dispense su iPad, iPhone e computer.</p>
    ${errore ? `<div class="error">${esc(errore)}</div>` : ''}
    <form id="loginForm">
      <label class="field"><span>Archivio GitHub</span><input id="repo" value="${esc(repo)}" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
      <label class="field"><span>Token di accesso</span><input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" required></label>
      <button class="primary" id="loginBtn">Collega</button>
    </form>
    <details class="help"><summary>Come ottengo il token?</summary><ol>
      <li>Apri <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> e accedi.</li>
      <li>Nome: <b>Quaderno</b>. Scadenza: la più lunga che ti va bene.</li>
      <li>In <b>Repository access</b> scegli <b>Only select repositories</b> e seleziona <b>dispense</b>.</li>
      <li>In <b>Permissions → Repository permissions</b> imposta <b>Contents</b> su <b>Read and write</b>.</li>
      <li>Tocca <b>Generate token</b>, copia il codice e incollalo qui. Il token resta salvato solo su questo dispositivo.</li>
    </ol></details>
  </div></main>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const repoV = $('#repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    const tokenV = $('#token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repoV)) { showLogin('Scrivi l\'archivio nella forma nomeutente/archivio.'); return; }
    btn.disabled = true; btn.textContent = 'Controllo…';
    try {
      await gh(`/repos/${repoV}`, false, tokenV);
      // Controlla subito anche il permesso di leggere i file (Contents).
      try { await gh(`/repos/${repoV}/contents/materie.json`, false, tokenV); }
      catch (err2) { if (err2.status === 403 || err2.status === 404) { showLogin(MSG_PERMESSI); return; } throw err2; }
      conf = { repo: repoV, token: tokenV };
      store.set(K.conf, conf);
      store.del(K.shas);
      app.innerHTML = '<div class="loading">Scarico le dispense…</div>';
      await sync();
    } catch (err) {
      conf = null;
      showLogin(err.status === 401 ? 'Token non valido. Controlla di averlo copiato tutto.'
        : err.status === 404 ? 'Archivio non trovato, oppure il token non ha accesso a questo archivio.'
        : 'Connessione non riuscita. Controlla internet e riprova.');
    }
  };
}

/* ---------- Avvio ---------- */
async function avvio() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Quando arriva una nuova versione dell'app, ricarica una volta per usarla subito.
    const giaControllata = !!navigator.serviceWorker.controller;
    let ricaricata = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!giaControllata || ricaricata) return;
      ricaricata = true;
      salvaPosizione();
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!LOCALE && !conf) return showLogin();
  const txt = await cacheGet('materie.json');
  if (txt) { try { data = JSON.parse(txt); } catch { data = null; } }
  route();
  sync();
}
avvio();
