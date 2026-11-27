'use strict';

/* Lettore avanzato: formule (KaTeX), evidenziazioni, note, "Chiedi a Claude",
   richieste di modifica ed esportazione PDF. */

/* ---------- Formule ---------- */
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
const linkKatex = () => `<link rel="stylesheet" href="${KATEX}katex.min.css" crossorigin="anonymous">`;
let katexPromessa = null;
function caricaKatex() {
  if (window.katex && window.renderMathInElement) return Promise.resolve(true);
  if (katexPromessa) return katexPromessa;
  const script = (src) => new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = ko;
    document.head.appendChild(s);
  });
  katexPromessa = script(KATEX + 'katex.min.js')
    .then(() => script(KATEX + 'contrib/auto-render.min.js'))
    .then(() => {
      if (!document.querySelector('link[data-katex]')) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = KATEX + 'katex.min.css'; l.crossOrigin = 'anonymous'; l.dataset.katex = '1';
        document.head.appendChild(l);
      }
      return true;
    })
    .catch(() => { katexPromessa = null; return false; });
  return katexPromessa;
}
const DELIMITATORI = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
];
// Disegna le formule scritte come \( … \), \[ … \] o $$ … $$ (quelle già disegnate restano come sono).
async function renderMatematica(radice) {
  const el = radice.body || radice;
  if (!/\\\(|\\\[|\$\$/.test(el.textContent)) return;
  if (!(await caricaKatex())) return;
  try { window.renderMathInElement(el, { delimiters: DELIMITATORI, throwOnError: false, ignoredClasses: ['katex'] }); } catch { /* formula non valida: resta il testo */ }
}

/* ---------- Mini Markdown per note e risposte di Claude ---------- */
function md(sorgente) {
  const segnaposti = [];
  const metti = (html) => { segnaposti.push(html); return `\u0000${segnaposti.length - 1}\u0000`; };
  let s = String(sorgente || '').replace(/\r\n?/g, '\n');
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, c) => metti(`<pre><code>${esc(c.replace(/\n$/, ''))}</code></pre>`));
  const tex = (t, display) => {
    if (window.katex) { try { return metti(window.katex.renderToString(t, { displayMode: display, throwOnError: false })); } catch { /* sotto */ } }
    return metti(`<code>${esc(display ? '$$' + t + '$$' : '$' + t + '$')}</code>`);
  };
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => tex(t, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => tex(t, true));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => tex(t, false));
  s = s.replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g, (_, p, t) => p + tex(t, false));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => metti(`<code>${esc(c)}</code>`));
  s = esc(s);
  const inline = (t) => t
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  let out = '', lista = null, para = [];
  const chiudiPara = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
  const chiudiLista = () => { if (lista) { out += `</${lista}>`; lista = null; } };
  for (const r of s.split('\n')) {
    let m;
    if (!r.trim()) { chiudiPara(); chiudiLista(); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(r)) { chiudiPara(); chiudiLista(); out += '<hr>'; continue; }
    if ((m = r.match(/^(#{1,6})\s+(.*)$/))) { chiudiPara(); chiudiLista(); out += `<p class="q-md-titolo"><strong>${inline(m[2])}</strong></p>`; continue; }
    if ((m = r.match(/^\s*[-*•]\s+(.*)$/))) { chiudiPara(); if (lista !== 'ul') { chiudiLista(); out += '<ul>'; lista = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = r.match(/^\s*\d+[.)]\s+(.*)$/))) { chiudiPara(); if (lista !== 'ol') { chiudiLista(); out += '<ol>'; lista = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = r.match(/^&gt;\s?(.*)$/))) { chiudiPara(); chiudiLista(); out += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if (/^\u0000\d+\u0000$/.test(r.trim())) { chiudiPara(); chiudiLista(); out += r.trim(); continue; }
    chiudiLista(); para.push(r);
  }
  chiudiPara(); chiudiLista();
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => segnaposti[+i]);
}

/* ---------- Stile di note ed evidenziazioni (dentro la dispensa) ---------- */
const CSS_ANNOTAZIONI = (colore) => `
  mark.q-evid{color:inherit;border-radius:3px;padding:0 1px;cursor:pointer;-webkit-box-decoration-break:clone;box-decoration-break:clone}
  mark.q-giallo{background:rgba(250,204,21,.38)} mark.q-verde{background:rgba(74,222,128,.32)}
  mark.q-blu{background:rgba(96,165,250,.38)} mark.q-rosa{background:rgba(244,114,182,.38)}
  mark.q-attivo{outline:2px solid ${colore};outline-offset:1px}
  aside.q-nota{display:block;margin:14px 0;padding:10px 14px 12px;border-radius:10px;border-left:4px solid ${colore};
    background:rgba(255,255,255,.05);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  aside.q-nota.q-fonte-claude{border-left-color:#d97757;background:rgba(217,119,87,.09)}
  .q-nota-testa{display:flex;align-items:center;gap:6px;font-size:12px;letter-spacing:.04em;color:#9aa1ad;margin-bottom:4px}
  .q-nota-tipo{flex:1;font-weight:700;text-transform:uppercase}
  .q-nota-azioni button{font:13px -apple-system,BlinkMacSystemFont,sans-serif;background:transparent;border:1px solid rgba(255,255,255,.18);
    color:inherit;border-radius:7px;padding:3px 9px;margin-left:4px;cursor:pointer}
  .q-nota-domanda{font-style:italic;opacity:.85;margin-bottom:6px}
  .q-nota-corpo p{margin:.35em 0} .q-nota-corpo ul,.q-nota-corpo ol{margin:.35em 0;padding-left:1.3em}
  .q-nota-corpo pre{background:rgba(0,0,0,.25);padding:8px 10px;border-radius:6px;overflow-x:auto}
  .q-nota-corpo blockquote{margin:.4em 0;padding-left:10px;border-left:3px solid rgba(255,255,255,.2)}
  @media print{
    mark.q-giallo{background:#fff1a8} mark.q-verde{background:#c9f5d6} mark.q-blu{background:#cfe2ff} mark.q-rosa{background:#ffd3e8}
    mark.q-attivo{outline:0}
    aside.q-nota{background:#f5f6f8;color:#111;border-left-color:#888;break-inside:avoid}
    aside.q-nota.q-fonte-claude{background:#fbefea;border-left-color:#d97757}
    .q-nota-azioni{display:none} .q-nota-testa{color:#555}
    @page{margin:16mm}
  }`;

/* ---------- Modello del testo della dispensa ---------- */
// Tutto il testo visibile in fila, con la posizione di ogni pezzo: serve a ritrovare
// le frasi evidenziate anche dopo che la dispensa è stata aggiornata.
const DA_SALTARE = '.katex-mathml, aside.q-nota, script, style, #TOC, annotation';
function costruisciModello(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === 1) return n.matches(DA_SALTARE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodi = [];
  let testo = '', n;
  while ((n = walker.nextNode())) { nodi.push({ n, i: testo.length }); testo += n.data; }
  return { nodi, testo };
}
function modello() {
  if (!R.modello) R.modello = costruisciModello(R.doc);
  return R.modello;
}
function nodoAOffset(mod, off) {
  let lo = 0, hi = mod.nodi.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mod.nodi[mid].i <= off) lo = mid; else hi = mid - 1; }
  return mod.nodi[lo];
}
function offsetDaRange(mod, range) {
  let a = -1, b = -1;
  for (const { n, i } of mod.nodi) {
    if (!range.intersectsNode(n)) { if (a !== -1) break; continue; }
    const s = n === range.startContainer ? range.startOffset : 0;
    const e = n === range.endContainer ? range.endOffset : n.data.length;
    if (e <= s && a === -1) continue;
    if (a === -1) a = i + s;
    b = i + e;
  }
  return [a, b];
}
function offsetDiElemento(mod, el) {
  for (const { n, i } of mod.nodi) if (el.contains(n)) return i;
  return -1;
}
function sezioneDiOffset(mod, off) {
  const nodo = nodoAOffset(mod, off);
  if (!nodo) return R.heads[0] ? R.heads[0].id : '';
  let cur = R.heads[0] || null;
  for (const h of R.heads) {
    if (h.el.compareDocumentPosition(nodo.n) & Node.DOCUMENT_POSITION_FOLLOWING) cur = h; else break;
  }
  return cur ? cur.id : '';
}
function trovaCitazione(mod, it) {
  const q = it.citazione;
  if (!q) return -1;
  let migliore = -1, punteggio = -1, i = mod.testo.indexOf(q), giri = 0;
  const inizioSez = it.sezione && R.doc.getElementById(it.sezione) ? offsetDiElemento(mod, R.doc.getElementById(it.sezione)) : -1;
  while (i !== -1 && giri++ < 400) {
    let p = 0;
    if (it.prima && mod.testo.slice(Math.max(0, i - it.prima.length), i) === it.prima) p += 2;
    if (it.dopo && mod.testo.slice(i + q.length, i + q.length + it.dopo.length) === it.dopo) p += 2;
    if (inizioSez >= 0 && i >= inizioSez) p += 1 - Math.min(1, (i - inizioSez) / 1e6);
    if (p > punteggio) { punteggio = p; migliore = i; }
    i = mod.testo.indexOf(q, i + 1);
  }
  return migliore;
}
function avvolgi(mod, a, b, crea) {
  const pezzi = [];
  for (const { n, i } of mod.nodi) {
    const fine = i + n.data.length;
    if (fine <= a) continue;
    if (i >= b) break;
    pezzi.push({ n, s: Math.max(a, i) - i, e: Math.min(b, fine) - i });
  }
  for (let k = pezzi.length - 1; k >= 0; k--) {
    let { n, s, e } = pezzi[k];
    if (!n.data.slice(s, e).trim() && n.parentNode && /^(TR|TBODY|THEAD|TABLE|UL|OL)$/.test(n.parentNode.nodeName)) continue;
    if (e < n.data.length) n.splitText(e);
    if (s > 0) n = n.splitText(s);
    const el = crea();
    n.parentNode.insertBefore(el, n);
    el.appendChild(n);
  }
  R.modello = null;
}

/* ---------- Disegno di note ed evidenziazioni ---------- */
function applicaAnnotazioni() {
  if (!R || !R.doc) return;
  const doc = R.doc;
  doc.querySelectorAll('aside.q-nota').forEach((x) => x.remove());
  doc.querySelectorAll('mark.q-evid').forEach((m) => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  });
  R.modello = null;
  R.orfani = new Set();
  const elementi = A.note(R.m.id, R.d.id).vivi();
  const mod = modello();
  const posti = elementi.map((it) => ({ it, a: it.citazione ? trovaCitazione(mod, it) : -1 }));
  for (const p of posti) if (p.it.citazione && p.a < 0) R.orfani.add(p.it.id);
  for (const p of posti.filter((x) => x.it.tipo === 'evid' && x.a >= 0)) {
    avvolgi(modello(), p.a, p.a + p.it.citazione.length, () => {
      const m = doc.createElement('mark');
      m.className = 'q-evid q-' + (p.it.colore || 'giallo');
      m.dataset.id = p.it.id;
      return m;
    });
  }
  for (const p of posti.filter((x) => x.it.tipo === 'nota').sort((x, y) => (x.it.creato || 0) - (y.it.creato || 0))) inserisciNota(p.it, p.a);
}

function inserisciNota(it, a) {
  const doc = R.doc;
  const aside = doc.createElement('aside');
  aside.className = 'q-nota' + (it.fonte === 'claude' ? ' q-fonte-claude' : '');
  aside.dataset.id = it.id;
  const tipo = it.fonte === 'claude' ? '✦ Risposta di Claude' : 'La mia nota';
  aside.innerHTML = `<div class="q-nota-testa"><span class="q-nota-tipo">${tipo}</span><span class="q-nota-azioni">
      <button data-azione="modifica-nota" data-id="${esc(it.id)}">Modifica</button><button data-azione="elimina-nota" data-id="${esc(it.id)}">Elimina</button></span></div>
    ${it.domanda ? `<div class="q-nota-domanda">${esc(it.domanda)}</div>` : ''}
    <div class="q-nota-corpo">${md(it.corpo)}</div>`;
  aside.querySelectorAll('a[href]').forEach((x) => x.setAttribute('rel', 'noopener'));

  // Dove metterla: dopo il blocco che contiene la frase; altrimenti in fondo alla sezione.
  if (a >= 0) {
    const mod = modello();
    const nodo = nodoAOffset(mod, a + Math.max(0, it.citazione.length - 1));
    const el = nodo && nodo.n.parentElement;
    if (el) {
      const tabella = el.closest('table');
      if (tabella) { tabella.after(aside); return; }
      const blocco = el.closest('p, pre, blockquote, li, h1, h2, h3, h4, h5, dd');
      if (blocco && blocco.tagName === 'LI') { blocco.appendChild(aside); return; }
      if (blocco && /^H[1-5]$/.test(blocco.tagName) && blocco.nextElementSibling) { blocco.nextElementSibling.after(aside); return; }
      if (blocco) { blocco.after(aside); return; }
    }
  }
  const h = it.sezione && doc.getElementById(it.sezione);
  if (h) {
    const livello = +h.tagName[1] || 6;
    const idx = R.heads.findIndex((x) => x.el === h);
    const prossimo = R.heads.slice(idx + 1).find((x) => x.level <= livello);
    if (prossimo) { prossimo.el.before(aside); return; }
  }
  doc.body.appendChild(aside);
}

/* ---------- Clic dentro la dispensa ---------- */
function clicNelDocumento(e) {
  const t = e.target;
  const az = t.closest && t.closest('[data-azione]');
  if (az) {
    e.preventDefault();
    if (az.dataset.azione === 'elimina-nota') eliminaElemento(az.dataset.id, 'Eliminare questa nota?');
    if (az.dataset.azione === 'modifica-nota') modificaNota(az.dataset.id);
    return true;
  }
  const mk = t.closest && t.closest('mark.q-evid');
  const sel = R.doc.getSelection();
  if (mk && (!sel || sel.isCollapsed)) { mostraBarraEvidenziazione(mk.dataset.id); return true; }
  if (!sel || sel.isCollapsed) nascondiBarraSelezione();
  return false;
}

/* ---------- Selezione (dito, mouse o Apple Pencil) ---------- */
function collegaSelezione(doc) {
  let t = 0;
  doc.addEventListener('selectionchange', () => { clearTimeout(t); t = setTimeout(leggiSelezione, 220); });
}
function leggiSelezione() {
  if (!R || !R.doc) return;
  const sel = R.doc.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { if (R.barra === 'selezione') nascondiBarraSelezione(); return; }
  const mod = modello();
  const [a, b] = offsetDaRange(mod, sel.getRangeAt(0));
  if (a < 0) return;
  let s = a, e = b;
  while (s < e && /\s/.test(mod.testo[s])) s++;
  while (e > s && /\s/.test(mod.testo[e - 1])) e--;
  if (e - s < 2) return;
  R.selez = {
    citazione: mod.testo.slice(s, e),
    prima: mod.testo.slice(Math.max(0, s - 40), s),
    dopo: mod.testo.slice(e, e + 40),
    sezione: sezioneDiOffset(mod, s),
  };
  mostraBarraSelezione();
}

const COLORI = ['giallo', 'verde', 'blu', 'rosa'];
function barraHtml(contenuto) { return `<div class="selbar-inner">${contenuto}</div>`; }
function mostraBarraSelezione() {
  const bar = $('#selbar');
  if (!bar) return;
  R.barra = 'selezione';
  bar.innerHTML = barraHtml(`
    ${COLORI.map((c) => `<button class="dot q-${c}" data-col="${c}" aria-label="Evidenzia in ${c}"></button>`).join('')}
    <span class="sep"></span>
    <button class="sb" data-act="nota">${ico.nota}<span>Nota</span></button>
    <button class="sb" data-act="claude">${ico.claude}<span>Chiedi</span></button>
    <button class="sb" data-act="modifica">${ico.matita}<span>Modifica</span></button>`);
  bar.hidden = false;
  const sel = { ...R.selez };
  bar.querySelectorAll('[data-col]').forEach((b) => { b.onclick = () => evidenzia(sel, b.dataset.col); });
  bar.querySelector('[data-act="nota"]').onclick = () => nuovaNota(sel);
  bar.querySelector('[data-act="claude"]').onclick = () => apriChiedi(sel);
  bar.querySelector('[data-act="modifica"]').onclick = () => nuovaRichiesta(sel);
}
function mostraBarraEvidenziazione(id) {
  const it = A.note(R.m.id, R.d.id).get(id);
  const bar = $('#selbar');
  if (!it || !bar) return;
  R.barra = 'evid';
  R.doc.querySelectorAll('mark.q-attivo').forEach((m) => m.classList.remove('q-attivo'));
  R.doc.querySelectorAll(`mark[data-id="${CSS.escape(id)}"]`).forEach((m) => m.classList.add('q-attivo'));
  const sel = { citazione: it.citazione, prima: it.prima, dopo: it.dopo, sezione: it.sezione };
  bar.innerHTML = barraHtml(`
    ${COLORI.map((c) => `<button class="dot q-${c}${c === it.colore ? ' scelto' : ''}" data-col="${c}" aria-label="Colore ${c}"></button>`).join('')}
    <span class="sep"></span>
    <button class="sb" data-act="nota">${ico.nota}<span>Nota</span></button>
    <button class="sb" data-act="claude">${ico.claude}<span>Chiedi</span></button>
    <button class="sb danger" data-act="elimina">${ico.cestino}<span>Togli</span></button>`);
  bar.hidden = false;
  const arch = A.note(R.m.id, R.d.id);
  bar.querySelectorAll('[data-col]').forEach((b) => { b.onclick = () => { arch.metti(id, { ...arch.get(id), colore: b.dataset.col }); applicaAnnotazioni(); mostraBarraEvidenziazione(id); }; });
  bar.querySelector('[data-act="nota"]').onclick = () => nuovaNota(sel);
  bar.querySelector('[data-act="claude"]').onclick = () => apriChiedi(sel);
  bar.querySelector('[data-act="elimina"]').onclick = () => { arch.togli(id); applicaAnnotazioni(); nascondiBarraSelezione(); toast('Evidenziazione tolta'); };
}
function nascondiBarraSelezione() {
  const bar = $('#selbar');
  if (bar) bar.hidden = true;
  if (R) {
    R.barra = null;
    if (R.doc) R.doc.querySelectorAll('mark.q-attivo').forEach((m) => m.classList.remove('q-attivo'));
  }
}
function pulisciSelezione() {
  try { R.doc.getSelection().removeAllRanges(); } catch { /* niente */ }
  nascondiBarraSelezione();
}

/* ---------- Azioni ---------- */
function evidenzia(sel, colore) {
  A.note(R.m.id, R.d.id).metti(nuovoId(), { tipo: 'evid', colore, ...sel, creato: Date.now() });
  pulisciSelezione();
  applicaAnnotazioni();
  if (R.tab === 'note') renderSide();
}
function nuovaNota(sel) {
  pulisciSelezione();
  apriEditor({
    titolo: 'Nuova nota', citazione: sel.citazione, aiuto: 'Scrivi la tua nota…',
    onSalva: (corpo) => {
      const id = nuovoId();
      A.note(R.m.id, R.d.id).metti(id, { tipo: 'nota', fonte: 'mia', corpo, ...sel, creato: Date.now() });
      applicaAnnotazioni(); renderSide(); toast('Nota salvata');
    },
  });
}
function modificaNota(id) {
  const arch = A.note(R.m.id, R.d.id);
  const it = arch.get(id);
  if (!it) return;
  apriEditor({
    titolo: it.fonte === 'claude' ? 'Modifica risposta di Claude' : 'Modifica nota', citazione: it.citazione, testo: it.corpo,
    onSalva: (corpo) => { arch.metti(id, { ...it, corpo }); applicaAnnotazioni(); renderSide(); toast('Nota aggiornata'); },
    onElimina: () => eliminaElemento(id, null),
  });
}
function eliminaElemento(id, domanda) {
  if (domanda && !confirm(domanda)) return;
  A.note(R.m.id, R.d.id).togli(id);
  applicaAnnotazioni(); renderSide();
  toast('Eliminata');
}
function titoloSezione(id) {
  const h = R && R.heads.find((x) => x.id === id);
  return h ? h.text : '';
}
function testoSezione(id) {
  const h = R.heads.find((x) => x.id === id);
  if (!h) return '';
  const mod = modello();
  const a = offsetDiElemento(mod, h.el);
  const idx = R.heads.indexOf(h);
  const prossimo = R.heads.slice(idx + 1).find((x) => x.level <= h.level);
  const b = prossimo ? offsetDiElemento(mod, prossimo.el) : mod.testo.length;
  return mod.testo.slice(a, b).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function selezioneDiSezione() {
  const cur = sezioneCorrente();
  return cur ? { sezione: cur.id } : null;
}

/* ---------- Editor (note, richieste, risposte) ---------- */
function apriEditor({ titolo, citazione, testo = '', aiuto = '', etichetta = 'Salva', nota = 'Puoi usare **grassetto**, elenchi con - e formule tra $ … $.', onSalva, onElimina, extra = '' }) {
  const dlg = $('#editor');
  dlg.innerHTML = `<form class="sheet-body" method="dialog">
    <h2>${esc(titolo)}</h2>
    ${citazione ? `<blockquote class="cit">${esc(citazione.length > 320 ? citazione.slice(0, 320) + '…' : citazione)}</blockquote>` : ''}
    ${extra}
    <textarea id="edTesto" rows="8" placeholder="${esc(aiuto)}">${esc(testo)}</textarea>
    ${nota ? `<p class="muted small">${esc(nota)}</p>` : ''}
    <div class="btn-riga"><button type="button" class="sheet-btn ghost" data-annulla>Annulla</button><button type="submit" class="primary">${esc(etichetta)}</button></div>
    ${onElimina ? '<button type="button" class="sheet-btn danger" data-elimina>Elimina</button>' : ''}
  </form>`;
  const ta = dlg.querySelector('#edTesto');
  dlg.querySelector('[data-annulla]').onclick = () => dlg.close();
  if (onElimina) dlg.querySelector('[data-elimina]').onclick = () => { dlg.close(); onElimina(); };
  dlg.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const v = ta.value.trim();
    if (!v) { ta.focus(); return; }
    dlg.close();
    onSalva(v);
  };
  dlg.showModal();
  setTimeout(() => ta.focus(), 60);
  return dlg;
}

/* ---------- Chiedi a Claude ---------- */
const K_DOMANDA = 'q.domanda';
const SUGGERIMENTI = ['Spiegamelo in modo più semplice', 'Fammi un esempio', 'Approfondisci questo argomento', 'Perché è vero?', 'Fammi un esercizio simile da esame'];
function apriChiedi(sel) {
  if (!sel) return;
  pulisciSelezione();
  const titolo = titoloSezione(sel.sezione);
  const dlg = apriEditor({
    titolo: 'Chiedi a Claude',
    citazione: sel.citazione || (titolo ? 'Sezione: ' + titolo : ''),
    aiuto: 'Cosa vuoi sapere?', etichetta: 'Apri Claude', nota: '',
    extra: `<div class="chips">${SUGGERIMENTI.map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('')}</div>`,
    onSalva: (domanda) => inviaAClaude(sel, domanda),
  });
  dlg.querySelectorAll('.chip').forEach((c) => { c.onclick = () => { const ta = dlg.querySelector('#edTesto'); ta.value = c.textContent; ta.focus(); }; });
}
function costruisciPrompt(sel, domanda) {
  const contesto = (sel.citazione || testoSezione(sel.sezione)).slice(0, 4000);
  const sezione = titoloSezione(sel.sezione);
  return `Sto studiando la mia dispensa di ${R.m.nome} ("${R.d.titolo}")${sezione ? `, sezione "${sezione}"` : ''}.\n\nPassaggio:\n"""\n${contesto}\n"""\n\n${domanda}\n\nRispondi in italiano, in modo chiaro e adatto allo studio per l'esame. Usa il Markdown e scrivi le formule in LaTeX tra $...$ (o $$...$$ su riga separata): incollerò la risposta nella mia dispensa.`;
}
async function inviaAClaude(sel, domanda) {
  const prompt = costruisciPrompt(sel, domanda);
  try { await navigator.clipboard.writeText(prompt); } catch { /* non sempre permesso */ }
  store.set(K_DOMANDA, { m: R.m.id, d: R.d.id, domanda, citazione: sel.citazione || '', prima: sel.prima || '', dopo: sel.dopo || '', sezione: sel.sezione || '', quando: Date.now() });
  window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
  toast('Ho aperto Claude con la domanda (è anche negli appunti)');
  mostraBannerClaude();
}
function mostraBannerClaude() {
  const b = $('#banner');
  if (!b || !R) return;
  const p = store.get(K_DOMANDA, null);
  if (!p || p.m !== R.m.id || p.d !== R.d.id) { b.hidden = true; return; }
  b.innerHTML = `<div class="banner-txt"><b>Domanda a Claude in attesa</b><span>${esc(p.domanda)}</span></div>
    <button class="primary small" id="bIncolla">Incolla risposta</button><button class="icon-btn" id="bChiudi" aria-label="Annulla domanda">${ico.x}</button>`;
  b.hidden = false;
  $('#bIncolla').onclick = () => incollaRisposta(p);
  $('#bChiudi').onclick = () => { if (confirm('Annullare la domanda in attesa?')) { store.del(K_DOMANDA); b.hidden = true; } };
}
function incollaRisposta(p) {
  const dlg = apriEditor({
    titolo: 'Salva la risposta di Claude',
    citazione: p.domanda,
    aiuto: 'Incolla qui la risposta di Claude…',
    etichetta: 'Salva nella dispensa',
    nota: 'In Claude tocca "Copia" sotto la risposta, poi incollala qui. Verrà salvata sotto il passaggio da cui sei partito.',
    extra: '<button type="button" class="sheet-btn" id="daAppunti">Incolla dagli appunti</button>',
    onSalva: (corpo) => {
      const id = nuovoId();
      A.note(p.m, p.d).metti(id, { tipo: 'nota', fonte: 'claude', domanda: p.domanda, corpo, citazione: p.citazione, prima: p.prima, dopo: p.dopo, sezione: p.sezione, creato: Date.now() });
      store.del(K_DOMANDA);
      mostraBannerClaude();
      if (R && R.m.id === p.m && R.d.id === p.d) { applicaAnnotazioni(); renderSide(); setTimeout(() => vaiA(id), 50); }
      toast('Risposta salvata nella dispensa');
    },
  });
  dlg.querySelector('#daAppunti').onclick = async () => {
    try { dlg.querySelector('#edTesto').value = await navigator.clipboard.readText(); }
    catch { toast('Tieni premuto nel riquadro e scegli Incolla'); }
  };
}

/* ---------- Richieste di modifica (le applica Claude Code) ---------- */
function nuovaRichiesta(sel) {
  pulisciSelezione();
  apriEditor({
    titolo: 'Chiedi una modifica', citazione: sel.citazione || (titoloSezione(sel.sezione) ? 'Sezione: ' + titoloSezione(sel.sezione) : ''),
    aiuto: 'Es. "Aggiungi un esempio numerico", "Correggi questa formula", "Riscrivi più semplice"…', etichetta: 'Salva richiesta',
    nota: 'La richiesta resta nell\'elenco finché non mi scrivi "applica le richieste" in Claude Code.',
    onSalva: (testo) => {
      A.richieste().metti(nuovoId(), { m: R.m.id, d: R.d.id, sezione: sel.sezione || '', sezioneTitolo: titoloSezione(sel.sezione), citazione: sel.citazione || '', testo, stato: 'aperta', creato: Date.now() });
      toast('Richiesta salvata');
    },
  });
}
function showRichieste() {
  document.title = 'Richieste di modifica · Quaderno';
  const tutte = A.richieste().vivi().sort((a, b) => (b.creato || 0) - (a.creato || 0));
  const riga = (r) => {
    const { m, d } = trova(r.m, r.d);
    return `<div class="richiesta" style="--accent:${coloreSicuro(m && m.colore)}">
      <div class="r-testa"><span class="bar"></span><div class="txt"><div class="s">${esc(m ? m.nome : r.m)} · ${esc(d ? d.titolo : r.d)}${r.sezioneTitolo ? ' · ' + esc(r.sezioneTitolo) : ''}</div>
      <div class="t">${esc(r.testo)}</div></div></div>
      ${r.citazione ? `<blockquote class="cit">${esc(r.citazione.slice(0, 280))}</blockquote>` : ''}
      ${r.esito ? `<p class="muted small">Esito: ${esc(r.esito)}</p>` : ''}
      <div class="btn-riga">${d && d.file ? `<a class="sheet-btn" href="#/d/${enc(r.m)}/${enc(r.d)}/${enc(r.sezione || '')}">Apri nella dispensa</a>` : ''}
      <button class="sheet-btn danger" data-elimina="${esc(r.id)}">Elimina</button></div></div>`;
  };
  const aperte = tutte.filter((r) => r.stato !== 'fatta'), fatte = tutte.filter((r) => r.stato === 'fatta');
  app.innerHTML = `<header class="topbar"><a class="icon-btn" href="#/" aria-label="Indietro">${ico.back}</a>
      <div class="title"><div class="over">Quaderno</div><div class="main">Richieste di modifica</div></div></header>
    <main class="page">
      <p class="muted">Per applicarle apri l'app Claude sul Mac, scheda <b>Code</b>, nella cartella <b>Dispense App</b>, e scrivi: <i>applica le richieste di modifica</i>. Le applico alle dispense e le segno come fatte.</p>
      <h2 class="section-title">Aperte (${aperte.length})</h2>
      ${aperte.length ? aperte.map(riga).join('') : '<div class="empty">Nessuna richiesta aperta. Mentre leggi, seleziona un passaggio e tocca "Modifica".</div>'}
      ${fatte.length ? `<h2 class="section-title">Fatte (${fatte.length})</h2>${fatte.map(riga).join('')}` : ''}
    </main>`;
  app.querySelectorAll('[data-elimina]').forEach((b) => { b.onclick = () => { if (confirm('Eliminare questa richiesta?')) { A.richieste().togli(b.dataset.elimina); showRichieste(); } }; });
}

/* ---------- Pannello "Note" nel lettore ---------- */
function renderListaNote(list) {
  const elementi = A.note(R.m.id, R.d.id).vivi();
  if (!elementi.length) {
    list.innerHTML = '<div class="side-empty">Nessuna nota o evidenziazione. Seleziona del testo (anche con la Apple Pencil) per evidenziarlo, aggiungere una nota o chiedere a Claude.</div>';
    return;
  }
  const ordine = (it) => {
    const el = R.doc && R.doc.querySelector(`[data-id="${CSS.escape(it.id)}"]`);
    return el ? el.getBoundingClientRect().top + R.win.scrollY : 1e12;
  };
  const ordinati = elementi.map((it) => ({ it, o: ordine(it) })).sort((a, b) => a.o - b.o).map((x) => x.it);
  list.innerHTML = ordinati.map((it) => {
    const orfano = R.orfani && R.orfani.has(it.id);
    const testo = it.tipo === 'evid' ? '«' + it.citazione.slice(0, 120) + (it.citazione.length > 120 ? '…' : '') + '»' : (it.corpo || '').slice(0, 140);
    const icona = it.tipo === 'evid' ? `<span class="dot q-${esc(it.colore || 'giallo')}"></span>` : `<span class="nota-ico${it.fonte === 'claude' ? ' claude' : ''}">${it.fonte === 'claude' ? ico.claude : ico.nota}</span>`;
    return `<button class="toc-item nota-item" data-vai="${esc(it.id)}">${icona}<span><span class="nota-testo">${esc(testo)}</span>
      ${orfano ? '<span class="badge">testo cambiato: in fondo alla sezione</span>' : ''}</span></button>`;
  }).join('');
  list.querySelectorAll('[data-vai]').forEach((b) => { b.onclick = () => vaiA(b.dataset.vai); });
}

/* ---------- Strumenti del lettore ---------- */
function apriStrumentiLettore() {
  if (!R) return;
  const m = R.m, d = R.d;
  apriFoglio(d.titolo, [
    { label: 'Mappa riassuntiva', icona: ico.mappa, fn: () => { location.hash = `#/mappa/${enc(m.id)}/${enc(d.id)}`; } },
    { label: 'Flashcard', icona: ico.carte, fn: () => { location.hash = `#/flash/${enc(m.id)}/${enc(d.id)}`; } },
    { label: 'Chiedi a Claude su questa sezione', icona: ico.claude, fn: () => apriChiedi(selezioneDiSezione()) },
    { label: 'Chiedi una modifica a questa sezione', icona: ico.matita, fn: () => nuovaRichiesta(selezioneDiSezione() || {}) },
    { label: 'Esporta PDF', icona: ico.pdf, fn: esportaPDF },
  ], 'Seleziona del testo (anche con la Apple Pencil) per evidenziarlo, scrivere una nota o chiedere a Claude.');
}

/* ---------- PDF ---------- */
// Stampa la dispensa con il tema chiaro originale, formule, evidenziazioni e note.
// Dal foglio di stampa: "Salva come PDF" (Mac) oppure Condividi → Salva su File (iPad/iPhone).
function esportaPDF() {
  if (!R || !R.win) return;
  nascondiBarraSelezione();
  try {
    R.win.focus();
    R.win.print();
  } catch {
    toast('Stampa non disponibile qui: apri Quaderno in Safari e riprova');
  }
}
