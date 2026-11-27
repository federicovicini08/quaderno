'use strict';

/* Archivio personale: segnalibri, posizioni di lettura, evidenziazioni, note,
   richieste di modifica e progressi delle flashcard. Ogni gruppo è un file JSON
   nella cartella "quaderno/" dell'archivio GitHub privato, così è uguale su tutti
   i dispositivi. Ogni dispositivo tiene anche una copia locale (funziona offline)
   e unisce le modifiche: per ogni elemento vince la versione più recente. */

function b64enc(s) {
  const b = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(s) {
  const bin = atob(String(s).replace(/\s/g, ''));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(b);
}
const percorsoUrl = (p) => p.split('/').map(encodeURIComponent).join('/');

async function ghScrivi(path, testo, sha, messaggio) {
  const corpo = { message: messaggio, content: b64enc(testo) };
  if (sha) corpo.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${conf.repo}/contents/${percorsoUrl(path)}`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + conf.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

const nuovoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

class Archivio {
  constructor(path) {
    this.path = path;
    this.chiave = 'q.arch:' + path;
    const s = store.get(this.chiave, null) || {};
    this.el = s.el || {};
    this.sha = s.sha || null;
    this.sporco = !!s.sporco;
    this.modifiche = 0;
    this.timer = null;
    this.inviando = false;
  }
  salvaLocale() { store.set(this.chiave, { el: this.el, sha: this.sha, sporco: this.sporco }); }
  vivi() { return Object.entries(this.el).filter(([, v]) => !v.del).map(([id, v]) => ({ ...v, id })); }
  get(id) { const v = this.el[id]; return v && !v.del ? { ...v, id } : null; }
  metti(id, val) {
    const v = { ...val, agg: Date.now() };
    delete v.id;
    this.el[id] = v;
    this.cambiato();
  }
  togli(id) {
    if (!this.el[id]) return;
    this.el[id] = { del: true, agg: Date.now() };
    this.cambiato();
  }
  cambiato() {
    this.sporco = true;
    this.modifiche++;
    this.salvaLocale();
    avvisaArchivio(this.path, true);
    this.programma(3000);
  }
  programma(ms) {
    if (LOCALE || !conf) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.invia(), ms);
  }
  unisci(remoti) {
    let cambiato = false;
    for (const [id, v] of Object.entries(remoti || {})) {
      const l = this.el[id];
      if (!l || (v.agg || 0) > (l.agg || 0)) { this.el[id] = v; cambiato = true; }
    }
    return cambiato;
  }
  async scarica() {
    if (LOCALE || !conf) return false;
    let cambiato = false;
    try {
      const j = await gh(`/repos/${conf.repo}/contents/${percorsoUrl(this.path)}`);
      const dati = JSON.parse(b64dec(j.content));
      cambiato = this.unisci(dati.elementi);
      this.sha = j.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
      this.sha = null;
    }
    this.salvaLocale();
    return cambiato;
  }
  async invia() {
    if (LOCALE || !conf || !this.sporco) return;
    if (this.inviando) { this.programma(2000); return; }
    this.inviando = true;
    try {
      for (let tentativo = 0; tentativo < 3; tentativo++) {
        const cambiato = await this.scarica();
        if (cambiato) avvisaArchivio(this.path, false);
        const fotografia = this.modifiche;
        const testo = JSON.stringify({ versione: 1, aggiornato: new Date().toISOString(), elementi: this.el }, null, 1);
        try {
          const r = await ghScrivi(this.path, testo, this.sha, 'Quaderno: aggiorna ' + this.path);
          this.sha = r.content.sha;
          this.sporco = this.modifiche !== fotografia;
          this.salvaLocale();
          if (this.sporco) this.programma(1500);
          return;
        } catch (e) {
          if (e.status === 409 || e.status === 422) continue; // qualcun altro ha scritto nel frattempo: riprovo
          throw e;
        }
      }
    } catch (e) {
      this.programma(30000); // offline o errore: riprovo più tardi
    } finally {
      this.inviando = false;
    }
  }
}

const archivi = new Map();
function archivio(path) {
  if (!archivi.has(path)) archivi.set(path, new Archivio(path));
  return archivi.get(path);
}
const PERCORSI = {
  segnalibri: 'quaderno/segnalibri.json',
  posizioni: 'quaderno/posizioni.json',
  richieste: 'quaderno/richieste.json',
  flashcard: 'quaderno/flashcard.json',
};
const percorsoNote = (m, d) => `quaderno/annotazioni/${m}/${d}.json`;
const A = {
  segnalibri: () => archivio(PERCORSI.segnalibri),
  posizioni: () => archivio(PERCORSI.posizioni),
  richieste: () => archivio(PERCORSI.richieste),
  flashcard: () => archivio(PERCORSI.flashcard),
  note: (m, d) => archivio(percorsoNote(m, d)),
};

const ascoltatoriArchivio = new Set();
function suCambioArchivio(fn) { ascoltatoriArchivio.add(fn); }
function avvisaArchivio(path, locale) { for (const fn of ascoltatoriArchivio) { try { fn(path, locale); } catch (e) { console.error(e); } } }

// Chiamata da sync(): scarica ciò che è cambiato su GitHub e invia ciò che è cambiato qui.
async function sincronizzaPersonali(remoto) {
  if (LOCALE || !conf || !remoto) return;
  const percorsi = new Set(Object.values(PERCORSI));
  for (const p of Object.keys(remoto)) if (p.startsWith('quaderno/annotazioni/')) percorsi.add(p);
  for (const a of archivi.values()) percorsi.add(a.path);
  for (const p of percorsi) {
    const a = archivio(p);
    try {
      if (remoto[p] && remoto[p] !== a.sha) {
        const cambiato = await a.scarica();
        if (cambiato) avvisaArchivio(p, false);
      }
      if (a.sporco) await a.invia();
    } catch (e) { /* riprovo al prossimo aggiornamento */ }
  }
}

// Quando l'app va in secondo piano prova a inviare subito le modifiche in sospeso.
function inviaTuttoOra() {
  for (const a of archivi.values()) if (a.sporco) a.invia();
}

// I segnalibri della versione 0.1 erano solo sul dispositivo: li sposto nell'archivio condiviso.
function migraSegnalibriVecchi() {
  const vecchi = store.get('q.segnalibri', null);
  if (!Array.isArray(vecchi) || !vecchi.length) return;
  const s = A.segnalibri();
  for (const b of vecchi) if (!s.el[b.id]) s.metti(b.id, { m: b.m, d: b.d, anchor: b.anchor, titolo: b.titolo, creato: b.creato });
  store.del('q.segnalibri');
}
