'use strict';

/* Mappe riassuntive e flashcard, costruite direttamente dalla dispensa:
   capitoli (h1) → sezioni (h2) → riquadri colorati (h4: definizioni, teoremi/formule,
   osservazioni, esempi). Si aggiornano da sole quando la dispensa cambia. */

const TIPI = {
  def: { nome: 'Definizione', classe: 'c-def' },
  thm: { nome: 'Teorema', classe: 'c-thm' },
  obs: { nome: 'Osservazione', classe: 'c-obs' },
  ex: { nome: 'Esempio', classe: 'c-ex' },
  proof: { nome: 'Dimostrazione', classe: 'c-proof' },
};
const vistaStudioAttiva = () => !!document.querySelector('.vista-studio');

function dividiTitolo(testo, tipo) {
  const m = testo.match(/^([^—–:]{2,40}?)\s*[—–:]\s+(.+)$/) || testo.match(/^([^-]{2,30}?)\s+-\s+(.+)$/);
  if (m) return { etichetta: m[1].trim(), nome: m[2].trim() };
  return { etichetta: TIPI[tipo].nome, nome: testo };
}

const strutture = new Map();
async function strutturaDispensa(d) {
  const html = await cacheGet(d.file);
  if (!html) return null;
  const salvata = strutture.get(d.file);
  if (salvata && salvata.html === html) return salvata.s;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const s = { capitoli: [], doc };
  let cap = null, sez = null;
  for (const el of doc.body.querySelectorAll('h1, h2, h4')) {
    if (el.tagName === 'H1') {
      if (!el.id) continue; // il titolo della dispensa
      cap = { id: el.id, titolo: testoTitolo(el), sezioni: [], concetti: [] };
      s.capitoli.push(cap); sez = null;
    } else if (el.tagName === 'H2') {
      if (!cap) { cap = { id: '', titolo: '', sezioni: [], concetti: [] }; s.capitoli.push(cap); }
      sez = { id: el.id, titolo: testoTitolo(el), concetti: [] };
      cap.sezioni.push(sez);
    } else {
      const tipo = Object.keys(TIPI).find((t) => el.classList.contains(t));
      if (!tipo) continue;
      const { etichetta, nome } = dividiTitolo(testoTitolo(el), tipo);
      const c = { el, tipo, etichetta, nome, id: el.id || '', vai: el.id || (sez && sez.id) || (cap && cap.id) || '', capitolo: cap ? cap.titolo : '', capId: cap ? cap.id : '' };
      c.chiave = c.id || (c.capId + ':' + nome).slice(0, 120);
      if (!cap) { cap = { id: '', titolo: '', sezioni: [], concetti: [] }; s.capitoli.push(cap); }
      (sez ? sez.concetti : cap.concetti).push(c);
    }
  }
  strutture.set(d.file, { html, s });
  return s;
}

function topbarStudio(m, d, sopra, titolo, altro) {
  return `<header class="topbar"><a class="icon-btn" href="#/m/${enc(m.id)}" aria-label="Indietro">${ico.back}</a>
    <div class="title"><div class="over">${esc(sopra)}</div><div class="main">${esc(titolo)}</div></div>
    <a class="chip-btn" href="#/d/${enc(m.id)}/${enc(d.id)}">Dispensa</a>${altro || ''}</header>`;
}

/* ---------- Mappa ---------- */
async function showMappa(mId, dId) {
  const { m, d } = trova(mId, dId);
  if (!d || !d.file) return showHome();
  document.title = 'Mappa · ' + d.titolo;
  const colore = coloreSicuro(m.colore);
  app.innerHTML = `<div class="vista-studio" style="--accent:${colore}">${topbarStudio(m, d, 'Mappa riassuntiva', d.titolo,
    `<a class="chip-btn" href="#/flash/${enc(m.id)}/${enc(d.id)}">Flashcard</a>`)}<main class="page mappa"><div class="loading">Preparo la mappa…</div></main></div>`;
  const s = await strutturaDispensa(d);
  const main = $('.mappa');
  if (!main) return;
  if (!s) { main.innerHTML = '<div class="empty">Questa dispensa non è ancora salvata sul dispositivo.</div>'; return; }
  const link = (id) => `#/d/${enc(m.id)}/${enc(d.id)}/${enc(id)}`;
  const chip = (c) => `<a class="concetto ${TIPI[c.tipo].classe}" href="${link(c.vai)}" title="${esc(c.etichetta)}">${esc(c.nome)}</a>`;
  const visibili = (c) => c.tipo !== 'proof';
  const capitoli = s.capitoli.filter((c) => c.sezioni.length || c.concetti.length);
  const totale = capitoli.reduce((n, c) => n + c.concetti.filter(visibili).length + c.sezioni.reduce((k, x) => k + x.concetti.filter(visibili).length, 0), 0);
  main.innerHTML = `
    <div class="mappa-radice"><div class="mappa-titolo">${esc(d.titolo)}</div>
      <div class="legenda"><span class="concetto c-def">Definizione</span><span class="concetto c-thm">Teorema / formula</span><span class="concetto c-obs">Osservazione / attenzione</span><span class="concetto c-ex">Esempio</span></div>
      <p class="muted small">${capitoli.length} capitoli · ${totale} concetti chiave · tocca un elemento per aprirlo nella dispensa</p></div>
    <div class="mappa-grid">${capitoli.map((c, i) => `
      <section class="mappa-cap">
        <a class="mappa-cap-t" href="${link(c.id)}"><span class="num">${i + 1}</span>${esc(c.titolo.replace(/^\d+\.\s*/, ''))}</a>
        ${c.concetti.filter(visibili).length ? `<div class="chips">${c.concetti.filter(visibili).map(chip).join('')}</div>` : ''}
        ${c.sezioni.map((x) => `<div class="mappa-sez"><a class="mappa-sez-t" href="${link(x.id)}">${esc(x.titolo)}</a>
          ${x.concetti.filter(visibili).length ? `<div class="chips">${x.concetti.filter(visibili).map(chip).join('')}</div>` : ''}</div>`).join('')}
      </section>`).join('')}</div>`;
  renderMatematica(main);
}

/* ---------- Flashcard ---------- */
function rispostaDi(c) {
  // Il contenuto del riquadro: gli elementi dopo il titolo, fino al titolo successivo.
  const box = document.createElement('div');
  const raccogli = (da) => {
    let n = da, k = 0;
    while (n && !/^H[1-4]$/.test(n.tagName) && k < 10) {
      box.appendChild(document.importNode(n, true));
      n = n.nextElementSibling; k++;
    }
  };
  raccogli(c.el.nextElementSibling);
  // Se il riquadro non ha testo (es. teorema seguito subito dalla dimostrazione), mostro il riquadro successivo.
  const succ = c.el.nextElementSibling;
  if (!box.textContent.trim() && succ && succ.tagName === 'H4') {
    const t = document.createElement('p');
    t.className = 'flash-sotto';
    t.textContent = testoTitolo(succ);
    box.appendChild(t);
    raccogli(succ.nextElementSibling);
  }
  if (!box.textContent.trim()) box.innerHTML = '<p class="muted">Questo riquadro nella dispensa non ha ancora un testo. Aprilo nella dispensa per vedere il contesto.</p>';
  box.querySelectorAll('script, iframe, object, embed, style, link').forEach((x) => x.remove());
  box.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  box.querySelectorAll('a[href]').forEach((a) => { if (a.getAttribute('href').startsWith('#')) a.removeAttribute('href'); else { a.target = '_blank'; a.rel = 'noopener'; } });
  return box;
}

let F = null; // stato delle flashcard aperte
async function showFlashcard(mId, dId) {
  const { m, d } = trova(mId, dId);
  if (!d || !d.file) return showHome();
  document.title = 'Flashcard · ' + d.titolo;
  const colore = coloreSicuro(m.colore);
  app.innerHTML = `<div class="vista-studio" style="--accent:${colore}">${topbarStudio(m, d, 'Flashcard', d.titolo,
    `<a class="chip-btn" href="#/mappa/${enc(m.id)}/${enc(d.id)}">Mappa</a>`)}<main class="page flash"><div class="loading">Preparo le carte…</div></main></div>`;
  caricaKatex();
  const s = await strutturaDispensa(d);
  const main = $('.flash');
  if (!main) return;
  if (!s) { main.innerHTML = '<div class="empty">Questa dispensa non è ancora salvata sul dispositivo.</div>'; return; }
  const carte = [];
  for (const c of s.capitoli) for (const x of [...c.concetti, ...c.sezioni.flatMap((y) => y.concetti)]) if (['def', 'thm', 'obs'].includes(x.tipo)) carte.push(x);
  if (!carte.length) { main.innerHTML = '<div class="empty">In questa dispensa non ci sono ancora riquadri di definizioni o teoremi da cui creare le carte.</div>'; return; }
  const capitoli = [...new Map(carte.map((c) => [c.capId, c.capitolo])).entries()];
  F = { m, d, carte, capitoli, filtro: store.get('q.flashfiltro:' + chiave(m.id, d.id), ''), coda: [], girata: false, fatte: 0 };
  main.innerHTML = `
    <div class="flash-filtri">
      <select id="capSel" aria-label="Capitolo"><option value="">Tutti i capitoli</option>${capitoli.map(([id, t]) => `<option value="${esc(id)}">${esc(t)}</option>`).join('')}</select>
      <button class="chip-btn" id="soloDaRipassare">Solo da ripassare</button>
    </div>
    <div class="flash-prog"><div class="barra"><span id="progBar"></span></div><span id="progTxt"></span></div>
    <div id="carta"></div>`;
  $('#capSel').value = F.filtro;
  $('#capSel').onchange = (e) => { F.filtro = e.target.value; store.set('q.flashfiltro:' + chiave(m.id, d.id), F.filtro); nuovoGiro(false); };
  $('#soloDaRipassare').onclick = () => nuovoGiro(true);
  nuovoGiro(false);
}
const chiaveCarta = (c) => `${F.m.id}/${F.d.id}/${c.chiave}`;
const livelloDi = (c) => (A.flashcard().get(chiaveCarta(c)) || {}).livello || 0;
function carteFiltrate() { return F.carte.filter((c) => !F.filtro || c.capId === F.filtro); }
function nuovoGiro(soloDifficili) {
  let lista = carteFiltrate();
  if (soloDifficili) lista = lista.filter((c) => livelloDi(c) < 2);
  // Prima quelle che sai meno, mescolate.
  F.coda = lista.map((c) => ({ c, r: Math.random() + livelloDi(c) })).sort((a, b) => a.r - b.r).map((x) => x.c);
  F.fatte = 0;
  F.giro = F.coda.length;
  mostraCarta();
}
function aggiornaProgresso() {
  const lista = carteFiltrate();
  const sapute = lista.filter((c) => livelloDi(c) >= 2).length;
  const bar = $('#progBar'), txt = $('#progTxt');
  if (bar) bar.style.width = (lista.length ? (100 * sapute / lista.length) : 0) + '%';
  if (txt) txt.textContent = `${sapute} su ${lista.length} sapute · ${F.coda.length} ${F.coda.length === 1 ? 'carta rimasta' : 'carte rimaste'} in questo giro`;
}
function mostraCarta() {
  const box = $('#carta');
  if (!box || !F) return;
  aggiornaProgresso();
  const c = F.coda[0];
  if (!c) {
    box.innerHTML = `<div class="flash-fine"><h2>Giro finito!</h2><p class="muted">Ripeti le carte che non sapevi finché non diventano verdi.</p>
      <div class="btn-riga"><button class="sheet-btn" id="rifai">Ricomincia tutte</button><button class="primary" id="difficili">Solo da ripassare</button></div></div>`;
    $('#rifai').onclick = () => nuovoGiro(false);
    $('#difficili').onclick = () => nuovoGiro(true);
    return;
  }
  F.girata = false;
  const liv = livelloDi(c);
  box.innerHTML = `<div class="flash-card" id="fc" role="button" tabindex="0" aria-label="Gira la carta">
      <div class="flash-fronte">
        <span class="concetto ${TIPI[c.tipo].classe}">${esc(c.etichetta)}</span>
        <div class="flash-nome">${esc(c.nome)}</div>
        <div class="flash-cap">${esc(c.capitolo)}</div>
        <div class="flash-livello">${'●'.repeat(Math.min(liv, 5))}${'○'.repeat(5 - Math.min(liv, 5))}</div>
        <div class="flash-hint">Prova a ricordarla, poi tocca la carta</div>
      </div>
      <div class="flash-retro dispensa-stile" hidden></div>
    </div>
    <div class="flash-azioni" hidden>
      <button class="sheet-btn danger" id="noSo">Da ripassare</button>
      <button class="primary" id="so">La sapevo</button>
    </div>
    <p class="flash-link"><a href="#/d/${enc(F.m.id)}/${enc(F.d.id)}/${enc(c.vai)}">Apri nella dispensa</a></p>`;
  const card = $('#fc');
  const gira = async () => {
    if (F.girata) return;
    F.girata = true;
    const retro = card.querySelector('.flash-retro');
    retro.innerHTML = '';
    retro.appendChild(rispostaDi(c));
    retro.hidden = false;
    card.querySelector('.flash-hint').hidden = true;
    card.classList.add('girata');
    $('.flash-azioni').hidden = false;
    renderMatematica(retro);
  };
  card.onclick = gira;
  card.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); gira(); } };
  $('#so').onclick = () => rispondi(c, true);
  $('#noSo').onclick = () => rispondi(c, false);
}
function rispondi(c, sapevo) {
  const k = chiaveCarta(c);
  const liv = livelloDi(c);
  A.flashcard().metti(k, { livello: sapevo ? Math.min(5, liv + 1) : 0, visto: Date.now() });
  F.coda.shift();
  F.fatte++;
  if (!sapevo) F.coda.splice(Math.min(3, F.coda.length), 0, c); // la rivedi tra poco
  mostraCarta();
}
