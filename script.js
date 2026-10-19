// =====================================================
// MenuPro – Versione collegata a Supabase
// =====================================================

const BUILD = 'build-2026-10-19-pagamenti-v5';
console.info('[MenuPro]', BUILD);
const cfg = window.MENUPRO_CONFIG || {};
let sb = null;
try {
  if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !String(cfg.SUPABASE_ANON_KEY).includes('INCOLLA')) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  } else {
    console.warn('Supabase non configurato correttamente in config.js');
  }
} catch (e) {
  console.error('Errore init Supabase:', e);
}
window.sb = sb; // per debug in console
if (!sb) console.warn('ATTENZIONE: sb è null — controlla config.js');

let currentUser = null;
let currentRistorante = null;
let cart = [];
let currentPeriod = 'oggi';
let currentSala = 0;
let menuFilterCat = 'tutti';
let lastOrdineId = null;
let sessionOrders = []; // { id, codice } ordini del tavolo in questa sessione
function saveOfflineOrder(order) {

  const orders =
    JSON.parse(localStorage.getItem("offline_orders") || "[]");

  orders.push(order);

  localStorage.setItem(
    "offline_orders",
    JSON.stringify(orders)
  );
}
let chartRicaviAdmin = null;
let chartPianiAdmin = null;
let chartIncassiRist = null;
let chartStatiRist = null;

const PIANI = {
  base: { nome: 'Base', prezzo: 29 },
  pro: { nome: 'Pro', prezzo: 59 },
  enterprise: { nome: 'Enterprise', prezzo: 129 }
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2800);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatPrice(n) {
  return '€' + Number(n).toFixed(2).replace('.', ',');
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// =====================================================
// CIRCUITI DI PAGAMENTO (solo tipologia in DB, mai PAN/CVV)
// =====================================================
const CIRCUITI_DEFAULT = [
  { id: 'visa', nome: 'Visa', icona: 'fab fa-cc-visa', tipo: 'carta', posizione: 1 },
  { id: 'mastercard', nome: 'Mastercard', icona: 'fab fa-cc-mastercard', tipo: 'carta', posizione: 2 },
  { id: 'amex', nome: 'American Express', icona: 'fab fa-cc-amex', tipo: 'carta', posizione: 3 },
  { id: 'apple_pay', nome: 'Apple Pay', icona: 'fab fa-apple-pay', tipo: 'wallet', posizione: 4 },
  { id: 'google_pay', nome: 'Google Pay', icona: 'fab fa-google-pay', tipo: 'wallet', posizione: 5 }
];
let circuitiCatalog = CIRCUITI_DEFAULT.slice();
let selectedCircuito = 'visa';

function labelCircuito(id) {
  const c = circuitiCatalog.find(x => x.id === id) || CIRCUITI_DEFAULT.find(x => x.id === id);
  return c ? c.nome : (id || '—');
}

async function loadCircuitiCatalog() {
  if (!sb) { circuitiCatalog = CIRCUITI_DEFAULT.slice(); return circuitiCatalog; }
  try {
    const { data, error } = await sb.from('circuiti_pagamento').select('*').eq('attivo', true).order('posizione');
    if (error) throw error;
    if (data && data.length) circuitiCatalog = data;
    else circuitiCatalog = CIRCUITI_DEFAULT.slice();
  } catch (e) {
    console.warn('circuiti_pagamento non disponibile, uso default:', e.message || e);
    circuitiCatalog = CIRCUITI_DEFAULT.slice();
  }
  return circuitiCatalog;
}

async function circuitiPerRistorante(r) {
  const all = await loadCircuitiCatalog();
  if (!sb || !r || !r.id) return all;
  try {
    const { data, error } = await sb.from('ristorante_circuiti').select('id_circuito').eq('id_ristorante', r.id);
    if (error) throw error;
    if (!data || !data.length) return all; // nessuno configurato = tutti
    const allowed = new Set(data.map(x => x.id_circuito));
    const filtered = all.filter(c => allowed.has(c.id));
    return filtered.length ? filtered : all;
  } catch (e) {
    return all;
  }
}

function renderCircuitoOptions(list) {
  const wrap = $('#circuito-wrap');
  const el = $('#circuito-options');
  if (!el) return;
  const items = list && list.length ? list : CIRCUITI_DEFAULT;
  if (!items.find(c => c.id === selectedCircuito)) selectedCircuito = items[0].id;
  el.innerHTML = items.map(c => `
    <label class="circuito-opt ${c.id === selectedCircuito ? 'selected' : ''}">
      <input type="radio" name="circuito" value="${c.id}" ${c.id === selectedCircuito ? 'checked' : ''} />
      <i class="${c.icona || 'fas fa-credit-card'}"></i>
      <span>${c.nome}</span>
    </label>
  `).join('');
  el.querySelectorAll('input[name="circuito"]').forEach(inp => {
    inp.addEventListener('change', () => {
      selectedCircuito = inp.value;
      el.querySelectorAll('.circuito-opt').forEach(l => l.classList.toggle('selected', l.querySelector('input')?.checked));
    });
  });
}

function toggleCircuitoVisibility() {
  const wrap = $('#circuito-wrap');
  if (!wrap) return;
  const pag = document.querySelector('input[name="pagamento"]:checked')?.value || 'carta';
  wrap.classList.toggle('hidden', pag !== 'carta');
}

async function refreshCircuitiUI() {
  const list = await circuitiPerRistorante(currentRistorante);
  renderCircuitoOptions(list);
  toggleCircuitoVisibility();
}

// =====================================================
// METODI DI PAGAMENTO ACCETTATI (scelti dall'admin per ristorante)
// valori colonna: 'online' | 'banco' | 'entrambi'   ->   radio: 'carta' | 'cassa'
// =====================================================
function metodiAccettati(r) {
  const v = (r && r.pagamenti_accettati) || 'entrambi';
  return { carta: v === 'online' || v === 'entrambi', cassa: v === 'banco' || v === 'entrambi' };
}

function applyPaymentOptions() {
  const m = metodiAccettati(currentRistorante);
  console.info('[MenuPro] pagamenti_accettati =', currentRistorante && currentRistorante.pagamenti_accettati);
  let checkedHidden = false;
  $$('input[name="pagamento"]').forEach(inp => {
    const ok = !!m[inp.value];
    const label = inp.closest('label');
    if (label) {
      label.classList.toggle('hidden', !ok);
      // inline + !important: vince anche su "display:flex !important" del CSS, senza dipendere da style.css
      if (ok) label.style.removeProperty('display');
      else label.style.setProperty('display', 'none', 'important');
    }
    if (!ok && inp.checked) checkedHidden = true;
  });
  // se il metodo selezionato non è più ammesso, seleziona il primo disponibile
  if (checkedHidden || !document.querySelector('input[name="pagamento"]:checked')) {
    const first = [...$$('input[name="pagamento"]')].find(i => m[i.value]);
    if (first) first.checked = true;
  }
  toggleCircuitoVisibility();
  refreshCircuitiUI();
}

// =====================================================
// PERSISTENZA SESSIONE
// =====================================================
const SESSION_KEY = 'menupro_session';
const CLIENT_TTL = 12 * 60 * 60 * 1000; // gli ordini del tavolo si ricordano per 12 ore
const QR_SESSION_MS = 30 * 60 * 1000; // sessione cliente da QR: 30 minuti, poi riscansione
let _qrExpireTimer = null;

function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
function updateSessionPage(page, role) {
  const s = loadSession();
  if (s && s.role === role) { s.page = page; saveSession(s); }
}
function clientKey(r, t) { return 'menupro_cliente_' + r + '_' + t; }
function saveClientState() {
  if (!currentUser || currentUser.role !== 'cliente' || !currentUser.fromQR) return;
  try {
    localStorage.setItem(clientKey(currentUser.ristoranteId, currentUser.tavolo), JSON.stringify({
      ts: Date.now(), orders: sessionOrders, last: lastOrdineId, cart
    }));
  } catch (e) {}
}
function loadClientState(r, t) {
  try {
    const s = JSON.parse(localStorage.getItem(clientKey(r, t)));
    if (s && Date.now() - s.ts < CLIENT_TTL) return s;
  } catch (e) {}
  return {};
}
function clearClientState(r, t) {
  try { localStorage.removeItem(clientKey(r, t)); } catch (e) {}
}
function isOrdineAncoraAperto(stato) {
  return stato && stato !== 'chiuso' && stato !== 'consegnato';
}

/** Dopo chiusura conto: toglie dalla sessione locale gli ordini chiusi/consegnati. */
async function syncClientSessionConDb(rId, tavolo) {
  if (!sb || !sessionOrders.length) {
    // se non c'è DB, non mostrare ricevuta di ordini "fantasma"
    return { activeOrders: sessionOrders, lastActiveId: lastOrdineId };
  }
  try {
    const ids = sessionOrders.map(o => o.id).filter(Boolean);
    let rows = [];
    if (ids.length) {
      const { data } = await sb.from('ordini').select('id,codice,stato').in('id', ids);
      rows = data || [];
    }
    // anche eventuali ordini aperti di questo tavolo non in sessione (altro dispositivo)
    const { data: apertiTavolo } = await sb.from('ordini')
      .select('id,codice,stato')
      .eq('id_ristorante', rId)
      .eq('tavolo', tavolo)
      .or('stato.eq.nuovo,stato.eq.in_preparazione,stato.eq.pronto')
      .order('created_at', { ascending: false })
      .limit(20);
    const byId = {};
    rows.forEach(o => { byId[o.id] = o; });
    (apertiTavolo || []).forEach(o => { byId[o.id] = o; });

    const activeOrders = [];
    const seen = new Set();
    // prima quelli della sessione ancora aperti
    for (const so of sessionOrders) {
      const db = byId[so.id];
      if (db && isOrdineAncoraAperto(db.stato) && !seen.has(so.id)) {
        activeOrders.push({ id: so.id, codice: db.codice || so.codice });
        seen.add(so.id);
      }
    }
    // poi altri aperti al tavolo
    for (const o of (apertiTavolo || [])) {
      if (!seen.has(o.id) && isOrdineAncoraAperto(o.stato)) {
        activeOrders.push({ id: o.id, codice: o.codice });
        seen.add(o.id);
      }
    }

    let lastActiveId = null;
    if (lastOrdineId && byId[lastOrdineId] && isOrdineAncoraAperto(byId[lastOrdineId].stato)) {
      lastActiveId = lastOrdineId;
    } else if (activeOrders.length) {
      lastActiveId = activeOrders[0].id;
    }

    return { activeOrders, lastActiveId };
  } catch (e) {
    console.warn('syncClientSessionConDb', e);
    return { activeOrders: sessionOrders, lastActiveId: lastOrdineId };
  }
}


// =====================================================
// SUPABASE HELPERS
// =====================================================

// ---------- Cache offline ----------
function cacheSet(key, val) {
  try { localStorage.setItem('menupro_cache_' + key, JSON.stringify(val)); } catch (e) {} // quota piena: ignora
}
function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem('menupro_cache_' + key)); } catch (e) { return null; }
}
function cacheDel(key) {
  try { localStorage.removeItem('menupro_cache_' + key); } catch (e) {}
}
function stripSecrets(r) { const { password, ...safe } = r; return safe; } // niente password in locale

let _offlineToastAt = 0;
function offlineNotice() {
  if (currentUser && currentUser.role === 'cliente') return;
  if (document.body.classList.contains('cliente-night')) return;
  if (Date.now() - _offlineToastAt < 15000) return; // evita messaggi ripetuti
  _offlineToastAt = Date.now();
  toast('Connessione assente: mostro gli ultimi dati salvati');
}

async function loadRistoranti() {
  try {
    if (!sb) throw new Error('Supabase non configurato (controlla config.js)');
    let { data, error } = await sb.from('ristoranti').select('*').order('creato', { ascending: false });
    if (error) {
      // es. colonna "creato" assente: riprova senza ordinamento
      console.warn('Query con ordinamento fallita, riprovo:', error);
      ({ data, error } = await sb.from('ristoranti').select('*'));
    }
    if (error) throw error;
    const list = data || [];
    cacheSet('ristoranti', list.map(stripSecrets));
    return list;
  } catch (e) {
    console.error('loadRistoranti errore:', e);
    const cached = cacheGet('ristoranti');
    if (cached) { offlineNotice(); return cached; }
    toast('Errore caricamento ristoranti: ' + (e.message || e.details || 'sconosciuto'));
    return [];
  }
}

async function _fetchRistoranteFull(id) {
  const { data: r, error } = await sb.from('ristoranti').select('*').eq('id', id).single();
  if (error && error.code === 'PGRST116') return null;   // non esiste davvero
  if (error || !r) throw error || new Error('nessuna risposta');

  const [tavoli, piatti, categorie, ordini, pagamenti] = await Promise.all([
    sb.from('tavoli').select('*').eq('id_ristorante', id).order('numero'),
    sb.from('piatti').select('*').eq('id_ristorante', id).order('nome'),
    sb.from('categorie').select('*').eq('id_ristorante', id).order('posizione'),
    sb.from('ordini').select('*').eq('id_ristorante', id).order('created_at', { ascending: false }),
    sb.from('pagamenti_abbonamento').select('*').eq('id_ristorante', id).order('data', { ascending: false })
  ]);
  const failed = [tavoli, piatti, categorie, ordini, pagamenti].find(x => x.error);
  if (failed) throw failed.error;

  r.tavoli = tavoli.data || [];
  r.menu = (piatti.data || []).map(p => ({
    ...p,
    allergeni: p.allergeni || []
  }));
  r.categorie = (categorie.data || []).map(c => c.nome);
  if (!r.categorie.length) r.categorie = ['Antipasti', 'Primi', 'Secondi', 'Dolci', 'Bevande'];
  r.ordini = (ordini.data || []).map(o => ({
    ...o,
    items: o.items || [],
    createdAt: o.created_at
  }));
  // se items vuoti, prova ordine_riga in batch leggero
  const needRows = r.ordini.filter(o => !(o.items && o.items.length));
  if (needRows.length && sb) {
    try {
      const ids = needRows.map(o => o.id);
      const { data: righe } = await sb.from('ordine_riga').select('*').in('id_ordine', ids);
      if (righe && righe.length) {
        const byOrd = {};
        righe.forEach(row => {
          (byOrd[row.id_ordine] = byOrd[row.id_ordine] || []).push({
            nome: row.piatto || row.nome || 'Piatto',
            qty: row.qty_piatti || row.qty || 1,
            prezzo: 0
          });
        });
        r.ordini.forEach(o => {
          if (!(o.items && o.items.length) && byOrd[o.id]) o.items = byOrd[o.id];
        });
      }
    } catch (e) { console.warn('ordine_riga load', e); }
  }
  r.pagamenti = pagamenti.data || [];
  r.sale = r.sale || ['Sala principale'];
  return r;
}

async function loadRistoranteFull(id) {
  try {
    if (!sb) throw new Error('sb null');
    const r = await _fetchRistoranteFull(id);
    if (r) cacheSet('rist_' + id, stripSecrets(r));
    else cacheDel('rist_' + id);          // cancellato davvero dal database
    return r;
  } catch (e) {
    console.warn('loadRistoranteFull offline:', e.message || e);
    const cached = cacheGet('rist_' + id);
    if (cached) { offlineNotice(); return cached; }
    return null;
  }
}

async function getRistorante(id) {
  return loadRistoranteFull(id);
}

// =====================================================
// LOGIN
// =====================================================

async function enterAsAdmin(email) {
  currentUser = { role: 'admin', email: email || 'admin@menupro.it' };
    const prev = loadSession();
  saveSession({ role: 'admin', email: currentUser.email, page: prev && prev.role === 'admin' ? prev.page : 'dashboard' });
  $('#login-screen').classList.add('hidden');
  $('#app-admin').classList.remove('hidden');
  $('#admin-user-email').textContent = currentUser.email;
  try {
    await renderAdminDashboard();
    await renderAdminTable();
    await renderAbbonamenti();
    await renderMieiIncassi();
    await populateIncassiSelect();
  } catch (e) {
    console.error('Errore render admin:', e);
  }
  return true;
}

// =====================================================
// PIÙ LOCALI PER UN UTENTE (stessa email su più ristoranti)
// =====================================================
async function loadRistorantiByEmail(email) {
  if (!sb || !email) return [];
  const { data, error } = await sb.from('ristoranti').select('*')
    .eq('email', String(email).trim().toLowerCase()).order('nome');
  if (error) { console.error('loadRistorantiByEmail:', error); return []; }
  return data || [];
}

function lastRistKey(email) { return 'menupro_last_rist_' + String(email || '').toLowerCase(); }

// entra nell'area ristoratore: se l'utente ha più locali apre l'ultimo usato
async function enterRistoratoreByEmail(email) {
  const list = await loadRistorantiByEmail(email);
  if (!list.length) { toast('Nessun ristorante collegato a questa email'); return false; }
  let lastId = null;
  try { lastId = localStorage.getItem(lastRistKey(email)); } catch (e) {}
  const r = list.find(x => x.id === lastId) || list[0];
  return await enterAsRistoratore(r);
}

async function populateRistSwitcher() {
  const wrap = $('#rist-switcher-wrap');
  const sel = $('#rist-switcher');
  if (!wrap || !sel) return;
  if (!currentUser || currentUser.role !== 'ristoratore' || currentUser.fromAdmin || !currentUser.email) {
    wrap.classList.add('hidden');
    return;
  }
  let list = await loadRistorantiByEmail(currentUser.email);
  if (!list.length && currentRistorante) list = [currentRistorante];   // offline: almeno il locale corrente
  if (list.length < 2) { wrap.classList.add('hidden'); return; }
  sel.innerHTML = list.map(r =>
    `<option value="${r.id}" ${r.id === currentRistorante?.id ? 'selected' : ''}>${r.nome}${r.citta ? ' – ' + r.citta : ''}</option>`
  ).join('');
  wrap.classList.remove('hidden');
}

async function renderRistAll() {
  await renderRistDashboard();
  await renderMenuTable();
  await renderOrdiniKanban();
  await renderTavoli();
}

async function switchRistorante(id) {
  if (!id || !currentUser || currentUser.role !== 'ristoratore') return;
  if (currentRistorante && currentRistorante.id === id) return;
  const r = await loadRistoranteFull(id);
  if (!r) { toast('Impossibile aprire il locale'); await populateRistSwitcher(); return; }
  stopOrdiniWatch();
  currentRistorante = r;
  currentUser.ristoranteId = id;
  currentSala = 0;
  menuFilterCat = 'tutti';
  try { localStorage.setItem(lastRistKey(currentUser.email), id); } catch (e) {}
  const sess = loadSession();
  if (sess && sess.role === 'ristoratore') { sess.ristoranteId = id; saveSession(sess); }
  $('#rist-nome-sidebar').textContent = r.nome || 'Ristorante';
  await renderRistAll();
  startOrdiniWatch();
  toast('Locale: ' + (r.nome || ''));
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'rist-switcher') switchRistorante(e.target.value);
});

async function enterAsRistoratore(r) {
  currentRistorante = await getRistorante(
  r.id || r.ristoranteId
);
  currentUser = { role: 'ristoratore', email: r.email, ristoranteId: r.id || r.ristoranteId };
    const prevR = loadSession();
  saveSession({ role: 'ristoratore', email: r.email, ristoranteId: currentUser.ristoranteId,
                page: prevR && prevR.role === 'ristoratore' ? prevR.page : 'rist-dashboard' });
  $('#login-screen').classList.add('hidden');
  $('#app-ristoratore').classList.remove('hidden');
  $('#rist-nome-sidebar').textContent = (currentRistorante && currentRistorante.nome) || r.nome || 'Ristorante';
  $('#rist-user-email').textContent = r.email;
  try { localStorage.setItem(lastRistKey(r.email), currentUser.ristoranteId); } catch (e) {}
  applyCassaNavRestrictions(false);
  await populateRistSwitcher();
  await renderRistAll();
  startOrdiniWatch();
  return true;
}

/** Pagine permesse agli account cassa */
const CASSA_PAGES = new Set(['rist-ordini', 'rist-tavoli', 'rist-chiusura']);

function applyCassaNavRestrictions(isCassa) {
  $$('#app-ristoratore .nav-item').forEach(item => {
    const page = item.getAttribute('data-page');
    if (!page) return;
    if (isCassa && !CASSA_PAGES.has(page)) {
      item.classList.add('hidden');
    } else {
      item.classList.remove('hidden');
    }
  });
  // switcher multi-locale non serve alle casse
  const sw = $('#rist-switcher-wrap');
  if (sw && isCassa) sw.classList.add('hidden');
}

/**
 * Entra come cassa: vede solo Ordini, Tavoli & QR, Chiusura fiscale
 */
async function enterAsCassa(u) {
  const ristId = u.id_ristorante;
  if (!ristId) {
    toast('Questa cassa non è collegata a nessun ristorante. Esegui supabase-casse.sql e ricrea le casse.');
    return false;
  }
  const r = await getRistorante(ristId);
  if (!r) {
    toast('Ristorante della cassa non trovato');
    return false;
  }
  currentRistorante = r;
  currentUser = {
    role: 'cassa',
    email: u.email,
    ristoranteId: ristId,
    nome: u.nome || 'Cassa'
  };
  saveSession({
    role: 'cassa',
    email: u.email,
    ristoranteId: ristId,
    page: 'rist-ordini'
  });
  $('#login-screen').classList.add('hidden');
  $('#app-admin')?.classList.add('hidden');
  $('#app-cliente')?.classList.add('hidden');
  $('#app-ristoratore').classList.remove('hidden');
  $('#rist-nome-sidebar').textContent = (r.nome || 'Ristorante') + ' · Cassa';
  $('#rist-user-email').textContent = u.email;
  applyCassaNavRestrictions(true);

  // mostra solo Ordini come pagina iniziale
  $$('#app-ristoratore .nav-item').forEach(n => n.classList.remove('active'));
  $$('#app-ristoratore .page').forEach(p => p.classList.add('hidden'));
  const ordNav = document.querySelector('#app-ristoratore .nav-item[data-page="rist-ordini"]');
  if (ordNav) ordNav.classList.add('active');
  $('#page-rist-ordini')?.classList.remove('hidden');
  $('#rist-page-title').textContent = 'Ordini';

  await renderOrdiniKanban();
  startOrdiniWatch();
  toast('Accesso cassa: ' + (u.nome || u.email));
  return true;
}

async function doLogin(email, pass) {
  email = (email || '').trim().toLowerCase();
  pass = (pass || '').trim();

  if (!pass) {
    toast('Inserisci la password');
    return false;
  }
    // ========== 0) Supabase Authentication ==========
  if (sb && email) {
    try {
      const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password: pass });
      if (!authErr && auth?.user) {
        const { data: u } = await sb.from('utenti').select('*').eq('email', email).maybeSingle();
        if (u && u.ruolo === 'admin') return await enterAsAdmin(u.email);
        if (u && u.ruolo === 'ristoratore') {
          return await enterRistoratoreByEmail(email);
        }
        if (u && u.ruolo === 'cassa') {
          return await enterAsCassa(u);
        }
        await sb.auth.signOut();
        toast('Utente autenticato ma senza ruolo: aggiungilo nella tabella utenti');
        return false;
      }
    } catch (e) {
      console.warn('Supabase Auth non disponibile:', e.message);
    }
  }

  // ========== 1) API server-side /api/utenti ==========
  try {
    const resp = await fetch('/api/utenti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email, password: pass })
    });
    const json = await resp.json().catch(() => null);
    if (json && json.ok && json.user) {
      if (json.user.ruolo === 'admin') {
        return await enterAsAdmin(json.user.email);
      }
      if (json.user.ruolo === 'ristoratore') {
        // i locali si cercano sempre per email (json.user.id è l'id dell'utente, non del ristorante)
        return await enterRistoratoreByEmail(json.user.email);
      }
      if (json.user.ruolo === 'cassa') {
        return await enterAsCassa(json.user);
      }
    }
  } catch (e) {
    console.warn('API /api/utenti non disponibile, uso fallback client:', e.message);
  }

  // ========== 2) Solo account reali (niente login admin con sola password "admin") ==========
  if (!email) {
    toast('Inserisci email e password');
    return false;
  }

  if (!sb) {
    toast('Configura config.js (ANON_KEY) oppure le env su Vercel');
    return false;
  }

  try {
    // prima cerca in utenti (ristoratore)
    const { data: u } = await sb
      .from('utenti')
      .select('*')
      .eq('email', email)
      .eq('password_hash', pass)
      .maybeSingle();

    if (u && u.ruolo === 'admin') {
      return await enterAsAdmin(u.email);
    }

    if (u && u.ruolo === 'ristoratore') {
      return await enterRistoratoreByEmail(email);
    }

    if (u && u.ruolo === 'cassa') {
      return await enterAsCassa(u);
    }

    // poi cerca direttamente in ristoranti (compatibilità)
    const { data: rr, error } = await sb
      .from('ristoranti')
      .select('id')
      .eq('email', email)
      .eq('password', pass)
      .limit(1);

    if (error) {
      console.error(error);
      toast('Errore database: ' + (error.message || 'controlla config.js'));
      return false;
    }
    if (rr && rr.length) return await enterRistoratoreByEmail(email);
  } catch (e) {
    console.error(e);
    toast('Errore di connessione');
    return false;
  }

  toast('Credenziali non valide');
  return false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await doLogin($('#login-email').value, $('#login-password').value);
});

// =====================================================
// LOGOUT
// =====================================================

$$('.logout-btn').forEach(btn => {
  btn.addEventListener('click', async () => {

    clearSession();
    stopOrdiniWatch();
    $('#rist-switcher-wrap')?.classList.add('hidden');

    try {
      if (sb) {
        await sb.auth.signOut();
      }
    } catch (e) {
      console.warn(e);
    }

    stopOrdineStatusPolling();

    document.body.classList.remove('cliente-night');

    currentUser = null;
    currentRistorante = null;
    cart = [];
    lastOrdineId = null;
    sessionOrders = [];

    $('#app-admin').classList.add('hidden');
    $('#app-ristoratore').classList.add('hidden');
    $('#app-cliente').classList.add('hidden');

    $('#login-screen').classList.remove('hidden');
    $('#login-form')?.reset();
  });
});

// =====================================================
// THEME
// =====================================================
$$('.theme-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    // default = blu notte; light = tema chiaro
    html.setAttribute('data-theme', isLight ? '' : 'light');
    $$('.theme-toggle i').forEach(i => { i.className = isLight ? 'fas fa-sun' : 'fas fa-moon'; });
  });
});

// =====================================================
// NAV ADMIN
// =====================================================
$$('#app-admin .nav-item').forEach(item => {
  item.addEventListener('click', async (e) => {
    e.preventDefault();
    $$('#app-admin .nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    updateSessionPage(page, 'admin');
    $$('#app-admin .page').forEach(p => p.classList.add('hidden'));
    $(`#page-${page}`).classList.remove('hidden');
    const titles = {
      dashboard: 'Panoramica', ristoranti: 'Ristoranti', abbonamenti: 'Abbonamenti',
      'miei-incassi': 'I miei incassi', 'incassi-rist': 'Incassi ristoranti', impostazioni: 'Impostazioni'
    };
    $('#admin-page-title').textContent = titles[page] || page;
    if (page === 'dashboard') await renderAdminDashboard();
    if (page === 'ristoranti') await renderAdminTable();
    if (page === 'abbonamenti') await renderAbbonamenti();
    if (page === 'miei-incassi') await renderMieiIncassi();
    if (page === 'incassi-rist') await populateIncassiSelect();
  });
});

// =====================================================
// NAV RISTORATORE
// =====================================================
$$('#app-ristoratore .nav-item').forEach(item => {
  item.addEventListener('click', async (e) => {
    e.preventDefault();
    const page = item.dataset.page;
    // account cassa: solo ordini, tavoli, chiusura
    if (currentUser && currentUser.role === 'cassa' && !CASSA_PAGES.has(page)) {
      toast('Accesso non consentito per la cassa');
      return;
    }
    $$('#app-ristoratore .nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    updateSessionPage(page, currentUser?.role === 'cassa' ? 'cassa' : 'ristoratore');
    $$('#app-ristoratore .page').forEach(p => p.classList.add('hidden'));
    $(`#page-${page}`)?.classList.remove('hidden');
    const titles = {
      'rist-dashboard': 'Panoramica', 'rist-menu': 'Gestione Menu',
      'rist-ordini': 'Ordini', 'rist-tavoli': 'Tavoli & QR',
      'rist-chiusura': 'Chiusura fiscale'
    };
    $('#rist-page-title').textContent = titles[page] || page;
    if (page === 'rist-dashboard') await renderRistDashboard();
    if (page === 'rist-menu') await renderMenuTable();
    if (page === 'rist-ordini') await renderOrdiniKanban();
    if (page === 'rist-tavoli') await renderTavoli();
    if (page === 'rist-chiusura') await renderChiusuraFiscale();
  });
});

// =====================================================
// CLOSE MODALS
// =====================================================
$$('.close-modal').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.modal;
    if (id) $(`#${id}`).classList.add('hidden');
  });
});

// =====================================================
// TOGGLE PASSWORD
// =====================================================
$('#toggle-pass')?.addEventListener('click', () => {
  const inp = $('#password');
  const icon = $('#toggle-pass i');
  if (inp.type === 'password') {
    inp.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    inp.type = 'password';
    icon.className = 'fas fa-eye';
  }
});

// =====================================================
// ADMIN – DASHBOARD
// =====================================================
async function renderAdminDashboard() {
  const ristoranti = await loadRistoranti();
  const attivi = ristoranti.filter(r => !r.scadenza || new Date(r.scadenza) >= new Date()).length;
  let ricavi = 0;
  ristoranti.forEach(r => {
    const p = PIANI[r.id_piano];
    if (p && (!r.scadenza || new Date(r.scadenza) >= new Date())) ricavi += p.prezzo;
  });
  $('#stat-ristoranti').textContent = ristoranti.length;
  $('#stat-attivi').textContent = attivi;
  $('#stat-ricavi').textContent = formatPrice(ricavi);

  const recent = ristoranti.slice(0, 5);
  const list = $('#recent-list');
  if (!recent.length) {
    list.innerHTML = '<p style="color:var(--muted)">Nessun ristorante ancora creato.</p>';
  } else {
    list.innerHTML = recent.map(r => `
      <div class="recent-item">
        <span><strong>${r.nome}</strong> · ${r.citta || '—'}</span>
        <span class="badge badge-${r.id_piano}">${r.id_piano}</span>
      </div>
    `).join('');
  }
  renderAdminCharts(ristoranti);
}

function renderAdminCharts(ristoranti) {
  if (typeof Chart === 'undefined') return;
  const mesi = [], vals = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    mesi.push(d.toLocaleDateString('it-IT', { month: 'short' }));
    let v = 0;
    // semplificato: mostra solo ricavi del mese corrente se non ci sono pagamenti
    if (i === 0) {
      ristoranti.forEach(r => {
        const plan = PIANI[r.id_piano];
        if (plan && (!r.scadenza || new Date(r.scadenza) >= new Date())) v += plan.prezzo;
      });
    }
    vals.push(v);
  }
  const ctx1 = document.getElementById('chart-ricavi-admin');
  if (ctx1) {
    if (chartRicaviAdmin) chartRicaviAdmin.destroy();
    chartRicaviAdmin = new Chart(ctx1, {
      type: 'bar',
      data: { labels: mesi, datasets: [{ label: '€', data: vals, backgroundColor: 'rgba(59, 130, 246, 0.75)', borderRadius: 6, borderSkipped: false }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '€' + v } }, x: { grid: { display: false } } } }
    });
  }
  const counts = { base: 0, pro: 0, enterprise: 0 };
  ristoranti.forEach(r => { if (counts[r.id_piano] !== undefined) counts[r.id_piano]++; });
  const ctx2 = document.getElementById('chart-piani-admin');
  if (ctx2) {
    if (chartPianiAdmin) chartPianiAdmin.destroy();
    chartPianiAdmin = new Chart(ctx2, {
      type: 'doughnut',
      data: { labels: ['Base', 'Pro', 'Enterprise'], datasets: [{ data: [counts.base, counts.pro, counts.enterprise], backgroundColor: ['#64748b', '#3b82f6', '#818cf8'], borderWidth: 0 }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } } } }
    });
  }
}

// =====================================================
// ADMIN – TABELLA RISTORANTI
// =====================================================
async function renderAdminTable(filter = '') {
  let data = await loadRistoranti();
  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(r =>
      r.nome.toLowerCase().includes(q) ||
      (r.titolare || '').toLowerCase().includes(q) ||
      (r.citta || '').toLowerCase().includes(q)
    );
  }
  const body = $('#ristoranti-body');
  if (!data.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">Nessun ristorante trovato</td></tr>`;
    return;
  }
  body.innerHTML = data.map(r => `
    <tr>
      <td><strong>${r.nome}</strong><br><small style="color:var(--muted)">${r.email || ''}</small></td>
      <td>${r.titolare || '—'}</td>
      <td>${r.citta || '—'}</td>
      <td>${(r.sale || []).length}</td>
      <td><span class="badge badge-${r.id_piano}">${r.id_piano}</span></td>
      <td>${r.scadenza || '—'}</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="editRistorante('${r.id}')" title="Modifica"><i class="fas fa-edit"></i></button>
        <button class="btn btn-secondary btn-sm" onclick="apriResetPassword('${r.id}')" title="Nuova password"><i class="fas fa-key"></i></button>
        <button class="btn btn-secondary btn-sm" onclick="adminApriMenu('${r.id}')" title="Gestisci menu"><i class="fas fa-book-open"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteRistorante('${r.id}')" title="Elimina"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

$('#search-ristoranti')?.addEventListener('input', e => renderAdminTable(e.target.value));

// Nuovo / Modifica ristorante
$('#btn-nuovo')?.addEventListener('click', () => {
  $('#modal-title').textContent = 'Nuovo ristorante';
  $('#form-ristorante').reset();
  $('#edit-id').value = '';
  $('#password').required = false;   // obbligatoria solo se l'utente non esiste (controllo in salvataggio)
  $('#password').type = 'password';
  if ($('#email-hint')) $('#email-hint').textContent = '';
  $('#toggle-pass i').className = 'fas fa-eye';
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  $('#scadenza').value = d.toISOString().slice(0, 10);
  $('#sale').value = 'Sala principale';
  $('#n_tavoli').value = 8;
  if ($('#n_casse')) $('#n_casse').value = 1;
  if ($('#metodi_pagamento')) $('#metodi_pagamento').value = 'entrambi';
  $('#modal-ristorante').classList.remove('hidden');
});


$('#email')?.addEventListener('blur', async () => {
  const hint = $('#email-hint');
  if (!hint || !sb || $('#edit-id').value) return;       // solo per i nuovi locali
  const email = $('#email').value.trim().toLowerCase();
  if (!email) { hint.textContent = ''; return; }
  const { data: u } = await sb.from('utenti').select('ruolo').eq('email', email).maybeSingle();
  if (!u) { hint.textContent = ''; return; }
  hint.textContent = u.ruolo === 'admin'
    ? '⚠ Email di un account admin: non utilizzabile'
    : '✔ Utente già esistente: il locale verrà aggiunto al suo account. Password non necessaria (quella esistente non viene modificata).';
});

async function createDefaultTavoli(ristoranteId, n) {
  const count = Math.max(1, parseInt(n) || 8);
  const rows = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      id_ristorante: ristoranteId,
      numero: i,
      adulti: 4,
      bambini: 0,
      sala: 0,
      occupato: false,
      forma: 'round'
    });
  }
  if (rows.length) await sb.from('tavoli').insert(rows);
}

async function createDefaultCategorie(ristoranteId) {
  const cats = ['Antipasti', 'Primi', 'Secondi', 'Dolci', 'Bevande'];
  await sb.from('categorie').insert(cats.map((nome, i) => ({
    id_ristorante: ristoranteId,
    nome,
    posizione: i
  })));
}

async function createDefaultMenu(ristoranteId) {
  const piatti = [
    { nome: 'Bruschetta al pomodoro', descrizione: 'Pane tostato, pomodoro fresco, basilico', prezzo: 5.50, categoria: 'Antipasti', allergeni: ['glutine'] },
    { nome: 'Spaghetti carbonara', descrizione: 'Guanciale, pecorino, uovo', prezzo: 12.00, categoria: 'Primi', allergeni: ['glutine', 'uova', 'latticini'] },
    { nome: 'Bistecca alla fiorentina', descrizione: 'Manzo, rosmarino, olio EVO', prezzo: 28.00, categoria: 'Secondi', allergeni: [] },
    { nome: 'Tiramisù', descrizione: 'Mascarpone, caffè, cacao', prezzo: 6.50, categoria: 'Dolci', allergeni: ['latticini', 'uova', 'glutine'] },
    { nome: 'Acqua naturale 75cl', descrizione: '', prezzo: 2.50, categoria: 'Bevande', allergeni: [] },
    { nome: 'Vino della casa (calice)', descrizione: '', prezzo: 4.00, categoria: 'Bevande', allergeni: [] }
  ];
  await sb.from('piatti').insert(piatti.map(p => ({
    ...p,
    id_ristorante: ristoranteId,
    disponibile: true
  })));
}

/** Slug sicuro dal nome ristorante (es. "La Trattoria" → "latrattoria") */
function slugifyNome(nome) {
  return String(nome || 'ristorante')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30) || 'ristorante';
}

/**
 * Crea account cassa per un ristorante.
 * Email: {slug}@cassa1.it, {slug}@cassa2.it, …
 * Password predefinita: cassa123
 * Ruolo: 'cassa' + id_ristorante
 */
async function createCasse(ristoranteId, nomeRist, nCasse, passwordDefault = 'cassa123') {
  const n = Math.max(0, Math.min(20, parseInt(nCasse) || 0));
  if (n === 0 || !sb || !ristoranteId) return [];

  const slug = slugifyNome(nomeRist);
  const create = [];

  for (let i = 1; i <= n; i++) {
    const email = `${slug}@cassa${i}.it`;
    const { data: esiste } = await sb.from('utenti').select('id').eq('email', email).maybeSingle();
    if (esiste) continue;
    create.push({
      email,
      password_hash: passwordDefault,
      ruolo: 'cassa',
      nome: `Cassa ${i} – ${nomeRist}`,
      id_ristorante: ristoranteId
    });
  }

  if (!create.length) return [];

  // prova con id_ristorante; se la colonna non esiste ancora, riprova senza
  let { error } = await sb.from('utenti').insert(create);
  if (error && String(error.message || '').toLowerCase().includes('id_ristorante')) {
    console.warn('Colonna id_ristorante assente: esegui supabase-casse.sql. Inserisco senza link.');
    const senza = create.map(({ id_ristorante, ...rest }) => rest);
    ({ error } = await sb.from('utenti').insert(senza));
  }
  if (error) {
    console.error('Errore creazione casse:', error);
    const ok = [];
    for (const u of create) {
      let row = u;
      let { error: e2 } = await sb.from('utenti').insert(row);
      if (e2 && String(e2.message || '').toLowerCase().includes('id_ristorante')) {
        const { id_ristorante, ...rest } = u;
        ({ error: e2 } = await sb.from('utenti').insert(rest));
      }
      if (!e2) ok.push(u.email);
      else console.error('Cassa non creata', u.email, e2);
    }
    return ok;
  }
  return create.map(u => u.email);
}

$('#form-ristorante')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) {
    toast('Database non collegato: controlla config.js (ANON_KEY)');
    return;
  }

  const id = $('#edit-id').value;
  const saleStr = $('#sale').value.trim() || 'Sala principale';
  const sale = saleStr.split(',').map(s => s.trim()).filter(Boolean);
  const nTavoli = parseInt($('#n_tavoli').value) || 8;

  const email = $('#email').value.trim().toLowerCase();
  const password = $('#password').value;
  const nomeRist = $('#nome').value.trim();
  const titolare = $('#titolare').value.trim();

  if (!email) {
    toast('Email ristoratore obbligatoria');
    return;
  }

  const data = {
    nome: nomeRist,
    titolare,
    citta: $('#citta').value.trim(),
    email,
    password: password || undefined,
    id_piano: $('#id_piano').value,
    pagamenti_accettati: $('#metodi_pagamento')?.value || 'entrambi',
    scadenza: $('#scadenza').value || null,
    sale
  };

  if (id) {
    // --- MODIFICA ristorante ---
    if (!data.password) delete data.password;
    const { error } = await sb.from('ristoranti').update(data).eq('id', id);
    if (error) {
      toast('Errore aggiornamento ristorante: ' + error.message);
      console.error(error);
      return;
    }

    // aggiorna/crea anche l'UTENTE ristoratore
    const utenteUpdate = { nome: titolare || nomeRist, ruolo: 'ristoratore' };
    if (password) utenteUpdate.password_hash = password;

    const { data: existingUser } = await sb.from('utenti').select('id').eq('email', email).maybeSingle();
    if (existingUser) {
      const { error: errU } = await sb.from('utenti').update(utenteUpdate).eq('id', existingUser.id);
      if (errU) console.error('Errore update utente:', errU);
    } else if (password) {
      const { error: errU } = await sb.from('utenti').insert({
        email,
        password_hash: password,
        ruolo: 'ristoratore',
        nome: titolare || nomeRist
      });
      if (errU) console.error('Errore create utente:', errU);
    }
    // opzionale: crea altre casse se indicato (non cancella quelle già esistenti)
    const nCasseEdit = parseInt($('#n_casse')?.value) || 0;
    if (nCasseEdit > 0) {
      const emailsCasse = await createCasse(id, nomeRist, nCasseEdit);
      if (emailsCasse.length) {
        toast(`Ristorante aggiornato + ${emailsCasse.length} casse: ${emailsCasse.join(', ')} (pwd: cassa123)`);
      } else {
        toast('Ristorante e utente aggiornati');
      }
    } else {
      toast('Ristorante e utente aggiornati');
    }
  } else {
    // --- NUOVO ristorante + UTENTE ---
    const { data: utenteEsistente } = await sb.from('utenti').select('id,ruolo').eq('email', email).maybeSingle();
    if (utenteEsistente && utenteEsistente.ruolo === 'admin') {
      toast('Questa email appartiene a un account admin: usane un\'altra');
      return;
    }
    if (!utenteEsistente && !password) {
      toast('Password obbligatoria per il nuovo ristoratore');
      return;
    }

    const { data: inserted, error } = await sb.from('ristoranti').insert({
      ...data,
      password: password || null
    }).select().single();

    if (error) {
      toast('Errore creazione ristorante: ' + error.message);
      console.error(error);
      return;
    }

    // crea l'UTENTE ristoratore solo se non esiste già (altrimenti il locale si aggiunge al suo account)
    const { error: errUser } = utenteEsistente ? { error: null } : await sb.from('utenti').insert({
      email,
      password_hash: password,
      ruolo: 'ristoratore',
      nome: titolare || nomeRist
    });

    if (utenteEsistente) {
      toast('Locale aggiunto all\'utente esistente ' + email);
    } else if (errUser) {
      console.error('Errore creazione utente:', errUser);
      toast('Ristorante creato, ma utente non salvato: ' + errUser.message);
    } else {
      toast('Ristorante e utente ristoratore creati');
    }

    await createDefaultTavoli(inserted.id, nTavoli);
    await createDefaultCategorie(inserted.id);

    const nCasse = parseInt($('#n_casse')?.value) || 0;
    if (nCasse > 0) {
      const emailsCasse = await createCasse(inserted.id, nomeRist, nCasse);
      if (emailsCasse.length) {
        toast(`Casse create (${emailsCasse.length}): ${emailsCasse.join(', ')} — password: cassa123`);
      }
    }
  }

  $('#modal-ristorante').classList.add('hidden');
  await renderAdminTable($('#search-ristoranti')?.value || '');
  await renderAdminDashboard();
  await renderAbbonamenti();
});

window.editRistorante = async function(id) {
  const { data: r } = await sb.from('ristoranti').select('*').eq('id', id).single();
  if (!r) return;
  $('#modal-title').textContent = 'Modifica ristorante';
  $('#edit-id').value = r.id;
  $('#nome').value = r.nome;
  $('#titolare').value = r.titolare || '';
  $('#citta').value = r.citta || '';
  $('#email').value = r.email;
  $('#password').value = '';
  $('#password').type = 'password';
  $('#password').required = false;
  $('#toggle-pass i').className = 'fas fa-eye';
  $('#id_piano').value = r.id_piano;
  if ($('#metodi_pagamento')) $('#metodi_pagamento').value = r.pagamenti_accettati || 'entrambi';
  $('#scadenza').value = r.scadenza || '';
  $('#sale').value = (r.sale || []).join(', ');
  const { count } = await sb.from('tavoli').select('*', { count: 'exact', head: true }).eq('id_ristorante', id);
  $('#n_tavoli').value = count || 8;
  // in modifica non ricreiamo le casse (già esistenti); campo a 0
  if ($('#n_casse')) $('#n_casse').value = 0;
  $('#modal-ristorante').classList.remove('hidden');
};

window.deleteRistorante = async function(id) {
  if (!confirm('Eliminare il ristorante e il suo utente? L\'operazione non si può annullare.')) return;

  // leggi l'email PRIMA di cancellare, serve per eliminare l'utente collegato
  const { data: rist } = await sb.from('ristoranti').select('email').eq('id', id).maybeSingle();

  const { error } = await sb.from('ristoranti').delete().eq('id', id);
  if (error) { toast('Errore eliminazione: ' + error.message); console.error(error); return; }

  let altriLocali = 0;
  if (rist && rist.email) {
    const { count } = await sb.from('ristoranti').select('id', { count: 'exact', head: true })
      .eq('email', String(rist.email).trim().toLowerCase());
    altriLocali = count || 0;
  }
  if (rist && rist.email && altriLocali === 0) {
    const { error: errU } = await sb.from('utenti').delete()
      .eq('email', String(rist.email).trim().toLowerCase())
      .eq('ruolo', 'ristoratore');          // mai toccare gli admin
    if (errU) { console.error('Errore eliminazione utente:', errU); toast('Ristorante eliminato, ma utente no: ' + errU.message); }
  }
  await renderAdminTable($('#search-ristoranti')?.value || '');
  await renderAdminDashboard();
  await renderAbbonamenti();
  toast('Ristorante eliminato');
};

window.adminApriMenu = function(id) {
  // richiede conferma password admin
  $('#admin-menu-rist-id').value = id;
  $('#admin-menu-password').value = '';
  $('#modal-admin-menu-login')?.classList.remove('hidden');
  setTimeout(() => $('#admin-menu-password')?.focus(), 100);
};

$('#form-admin-menu-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#admin-menu-rist-id')?.value;
  const pass = ($('#admin-menu-password')?.value || '').trim();
  if (!pass) { toast('Inserisci la password admin'); return; }
  if (!sb) { toast('Database non collegato'); return; }

  // verifica password rispetto all'admin loggato (email corrente)
  const email = (currentUser && currentUser.email) || '';
  let ok = false;
  if (email) {
    const { data: u } = await sb.from('utenti').select('id').eq('email', email).eq('password_hash', pass).eq('ruolo', 'admin').maybeSingle();
    ok = !!u;
  }
  if (!ok) {
    // prova qualsiasi admin con quella password
    const { data: u2 } = await sb.from('utenti').select('id').eq('password_hash', pass).eq('ruolo', 'admin').limit(1).maybeSingle();
    ok = !!u2;
  }
  if (!ok) {
    toast('Password non valida');
    return;
  }

  $('#modal-admin-menu-login').classList.add('hidden');
  const r = await loadRistoranteFull(id);
  if (!r) { toast('Ristorante non trovato'); return; }
  currentRistorante = r;
  currentUser = { role: 'ristoratore', email: r.email, ristoranteId: r.id, fromAdmin: true };
  $('#app-admin').classList.add('hidden');
  $('#app-ristoratore').classList.remove('hidden');
  $('#rist-nome-sidebar').textContent = r.nome + ' (admin)';
  $('#rist-user-email').textContent = 'Gestione menu';
  $$('#app-ristoratore .nav-item').forEach(n => n.classList.remove('active'));
  $$('#app-ristoratore .page').forEach(p => p.classList.add('hidden'));
  const menuNav = $$('#app-ristoratore .nav-item')[1];
  if (menuNav) menuNav.classList.add('active');
  $('#page-rist-menu').classList.remove('hidden');
  $('#rist-page-title').textContent = 'Gestione Menu';
  await renderMenuTable();
  toast('Accesso menu autorizzato');
});

// =====================================================
// ABBONAMENTI
// =====================================================
async function renderAbbonamenti() {
  const ristoranti = await loadRistoranti();
  const body = $('#abbonamenti-body');
  if (!ristoranti.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:30px">Nessun abbonamento</td></tr>`;
    return;
  }
  body.innerHTML = ristoranti.map(r => {
    const scad = r.scadenza ? new Date(r.scadenza) : null;
    const oggi = new Date();
    oggi.setHours(0,0,0,0);
    let statoLabel = 'Senza data';
    let statoClass = 'badge-base';
    let scadClass = '';
    let scadText = '—';
    if (scad) {
      scadText = scad.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
      if (scad < oggi) {
        statoLabel = 'Scaduto';
        scadClass = 'scadenza-late';
      } else {
        const diff = Math.ceil((scad - oggi) / (1000*60*60*24));
        if (diff <= 7) {
          statoLabel = 'In scadenza';
          scadClass = 'scadenza-warn';
        } else {
          statoLabel = 'Attivo';
          statoClass = 'badge-pro';
          scadClass = 'scadenza-ok';
        }
      }
    }
    return `
      <tr>
        <td><strong>${r.nome}</strong></td>
        <td><span class="badge badge-${r.id_piano}">${r.id_piano}</span></td>
        <td class="${scadClass}">${scadText}</td>
        <td><span class="badge ${statoClass}">${statoLabel}</span></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="estendiAbbonamento('${r.id}')">
            <i class="fas fa-plus"></i> +1 mese
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.estendiAbbonamento = async function(id) {
  const { data: r } = await sb.from('ristoranti').select('*').eq('id', id).single();
  if (!r) return;
  let d = r.scadenza ? new Date(r.scadenza) : new Date();
  if (d < new Date()) d = new Date();
  d.setMonth(d.getMonth() + 1);
  const nuovaScad = d.toISOString().slice(0, 10);
  await sb.from('ristoranti').update({ scadenza: nuovaScad }).eq('id', id);
  const prezzo = PIANI[r.id_piano]?.prezzo || 0;
  await sb.from('pagamenti_abbonamento').insert({
    id_ristorante: id,
    importo: prezzo,
    piano: r.id_piano,
    tipo: 'rinnovo'
  });
  await renderAbbonamenti();
  await renderAdminDashboard();
  await renderMieiIncassi();
  toast('Rinnovato fino al ' + new Date(nuovaScad).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }) + ' (+' + formatPrice(prezzo) + ')');
};

// =====================================================
// MIEI INCASSI
// =====================================================
async function renderMieiIncassi() {
  const ristoranti = await loadRistoranti();
  let totale = 0, mese = 0, inAttesa = 0;
  const now = new Date();
  const pagamenti = [];

  for (const r of ristoranti) {
    const { data: pags } = await sb.from('pagamenti_abbonamento').select('*').eq('id_ristorante', r.id);
    (pags || []).forEach(p => {
      totale += Number(p.importo);
      const pd = new Date(p.data);
      if (pd.getMonth() === now.getMonth() && pd.getFullYear() === now.getFullYear()) mese += Number(p.importo);
      pagamenti.push({ ...p, ristorante: r.nome });
    });
    if (r.scadenza) {
      const scad = new Date(r.scadenza);
      const diff = (scad - now) / (1000 * 60 * 60 * 24);
      if (diff >= 0 && diff <= 7) inAttesa += PIANI[r.id_piano]?.prezzo || 0;
    }
  }

  $('#incassi-totale').textContent = formatPrice(totale);
  $('#incassi-mese').textContent = formatPrice(mese);
  $('#incassi-in-attesa').textContent = formatPrice(inAttesa);

  const scadenze = ristoranti
    .filter(r => r.scadenza)
    .map(r => ({ nome: r.nome, scadenza: r.scadenza, piano: r.id_piano }))
    .sort((a, b) => new Date(a.scadenza) - new Date(b.scadenza));

  pagamenti.sort((a, b) => new Date(b.data) - new Date(a.data));
  const list = $('#pagamenti-list');
  let html = '';
  if (scadenze.length) {
    html += '<h4 style="margin:0 0 10px;font-size:14px;color:var(--muted)">Prossime scadenze abbonamento</h4>';
    html += scadenze.map(s => {
      const d = new Date(s.scadenza);
      const oggi = new Date(); oggi.setHours(0,0,0,0);
      const late = d < oggi;
      const warn = !late && (d - oggi) / (1000*60*60*24) <= 7;
      const cls = late ? 'scadenza-late' : (warn ? 'scadenza-warn' : 'scadenza-ok');
      const label = d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
      return `<div class="recent-item">
        <span><strong>${s.nome}</strong> · ${s.piano}</span>
        <span class="${cls}">scade il ${label}</span>
      </div>`;
    }).join('');
    html += '<h4 style="margin:18px 0 10px;font-size:14px;color:var(--muted)">Pagamenti ricevuti</h4>';
  }
  if (!pagamenti.length) {
    html += '<p style="color:var(--muted)">Nessun pagamento ricevuto ancora.</p>';
  } else {
    html += pagamenti.slice(0, 20).map(p => `
      <div class="recent-item">
        <span><strong>${p.ristorante}</strong> · ${p.tipo} (${p.piano})</span>
        <span>${formatPrice(p.importo)} · ${formatTime(p.data)}</span>
      </div>
    `).join('');
  }
  list.innerHTML = html;
}

// =====================================================
// INCASSI RISTORANTI
// =====================================================
async function populateIncassiSelect() {
  const ristoranti = await loadRistoranti();
  const sel = $('#select-rist-incassi');
  sel.innerHTML = '<option value="">— Seleziona —</option>' +
    ristoranti.map(r => `<option value="${r.id}">${r.nome}</option>`).join('');
}

$('#select-rist-incassi')?.addEventListener('change', async () => {
  const id = $('#select-rist-incassi').value;
  const cont = $('#incassi-rist-content');
  if (!id) {
    cont.innerHTML = '<p style="color:var(--muted)">Seleziona un ristorante per vedere i dettagli.</p>';
    return;
  }
  const r = await loadRistoranteFull(id);
  if (!r) return;

  const ordini = r.ordini || [];
  const totale = ordini.reduce((s, o) => s + (Number(o.totale) || 0), 0);
  const oggi = ordini.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString())
    .reduce((s, o) => s + Number(o.totale), 0);

  const counts = {};
  ordini.forEach(o => {
    (o.items || []).forEach(i => {
      counts[i.nome] = (counts[i.nome] || 0) + i.qty;
    });
  });
  let topPiatto = '—', topQty = 0;
  Object.entries(counts).forEach(([nome, qty]) => {
    if (qty > topQty) { topPiatto = nome; topQty = qty; }
  });

  cont.innerHTML = `
    <div class="cards">
      <div class="card">
        <div class="card-icon green"><i class="fas fa-euro-sign"></i></div>
        <div><h3>${formatPrice(totale)}</h3><p>Incasso totale</p></div>
      </div>
      <div class="card">
        <div class="card-icon blue"><i class="fas fa-calendar-day"></i></div>
        <div><h3>${formatPrice(oggi)}</h3><p>Incasso oggi</p></div>
      </div>
      <div class="card">
        <div class="card-icon orange"><i class="fas fa-utensils"></i></div>
        <div><h3>${topPiatto}</h3><p>Piatto più venduto (${topQty}x)</p></div>
      </div>
      <div class="card">
        <div class="card-icon purple"><i class="fas fa-receipt"></i></div>
        <div><h3>${ordini.length}</h3><p>Ordini totali</p></div>
      </div>
    </div>
    <div class="recent-box">
      <h3>Ultimi ordini di ${r.nome}</h3>
      <div class="recent-list">
        ${ordini.length === 0 ? '<p style="color:var(--muted)">Nessun ordine.</p>' :
          ordini.slice(0, 10).map(o => `
            <div class="recent-item">
              <span>Tavolo ${o.tavolo} · ${formatPrice(o.totale)}</span>
              <span class="badge-stato ${o.stato}">${labelStato(o.stato)}</span>
            </div>
          `).join('')}
      </div>
    </div>
  `;
});

// RESET
$('#btn-reset')?.addEventListener('click', async () => {
  await sb.from('pagamenti_abbonamento').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('ordini').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('piatti').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('categorie').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('tavoli').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('ristoranti').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('utenti').delete().eq('ruolo', 'ristoratore');
  await renderAdminTable();
  await renderAdminDashboard();
  await renderAbbonamenti();
  await renderMieiIncassi();
  toast('Dati cancellati');
});

// DEMO UTENTE
$('#btn-demo-utente')?.addEventListener('click', async () => {
  const ristoranti = await loadRistoranti();
  if (!ristoranti.length) { toast('Crea prima un ristorante'); return; }
  const sel = $('#demo-ristorante');
  sel.innerHTML = ristoranti.map(r => `<option value="${r.id}">${r.nome}</option>`).join('');
  $('#modal-demo-utente').classList.remove('hidden');
});

$('#btn-avvia-demo')?.addEventListener('click', async () => {
  const ristId = $('#demo-ristorante').value;
  const tavolo = parseInt($('#demo-tavolo').value) || 1;
  const r = await loadRistoranteFull(ristId);
  if (!r) return;
  currentUser = { role: 'cliente', ristoranteId: ristId, tavolo };
  currentRistorante = r;
  cart = [];
  lastOrdineId = null;
  $('#modal-demo-utente').classList.add('hidden');
  $('#app-admin').classList.add('hidden');
  $('#app-cliente').classList.remove('hidden');
  $('#cliente-rist-nome').textContent = r.nome;
  $('#cliente-tavolo-num').textContent = tavolo;
  document.body.classList.add('cliente-night');
  showClienteView('menu');
  renderClienteMenu();
});

// =====================================================
// RISTORATORE
// =====================================================
function labelStato(s) {
  return { nuovo: 'Nuovo', in_preparazione: 'In preparazione', pronto: 'Pronto', consegnato: 'Consegnato', chiuso: 'Chiuso' }[s] || s;
}
function labelPagamentoStato(s) {
  return { pagato: 'Pagato', in_attesa: 'In attesa', non_pagato: 'Non pagato' }[s] || s || 'In attesa';
}
function defaultPagStato(metodo) {
  return metodo === 'carta' ? 'pagato' : 'in_attesa';
}

function inPeriod(iso, period) {
  const d = new Date(iso);
  const now = new Date();
  if (period === 'oggi') return d.toDateString() === now.toDateString();
  if (period === 'settimana') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return d >= weekAgo;
  }
  if (period === 'mese') {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  return true;
}

$$('.period-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    $$('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    await renderRistDashboard();
  });
});

async function renderRistDashboard() {
  if (!currentRistorante) return;
  currentRistorante = await getRistorante(currentRistorante.id);
  const menu = currentRistorante.menu || [];
  const ordini = currentRistorante.ordini || [];
  const tavoli = currentRistorante.tavoli || [];

  const attivi = ordini.filter(o => o.stato !== 'consegnato' && o.stato !== 'chiuso').length;
  const occupati = tavoli.filter(t => t.occupato).length ||
    new Set(ordini.filter(o => o.stato !== 'consegnato' && o.stato !== 'chiuso').map(o => o.tavolo)).size;
  const incasso = ordini.filter(o => inPeriod(o.createdAt, currentPeriod))
    .reduce((s, o) => s + Number(o.totale), 0);

  $('#rist-stat-piatti').textContent = menu.length;
  $('#rist-stat-tavoli-occ').textContent = occupati;
  $('#rist-stat-ordini-attivi').textContent = attivi;
  $('#rist-stat-incasso').textContent = formatPrice(incasso);

  const nuovi = ordini.filter(o => o.stato === 'nuovo').length;
  updateOrdiniBadge(nuovi);

  const recent = ordini.slice(0, 5);
  const list = $('#rist-recent-ordini');
  if (!recent.length) {
    list.innerHTML = '<p style="color:var(--muted)">Nessun ordine ancora.</p>';
  } else {
    list.innerHTML = recent.map(o => {
      const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
      return `<div class="recent-item">
        <span><strong>Tavolo ${o.tavolo}</strong> · ${formatPrice(o.totale)} · ${formatTime(o.createdAt)}</span>
        <span>
          <span class="badge-stato ${o.stato}">${labelStato(o.stato)}</span>
          <span class="badge-pag ${ps}">${labelPagamentoStato(ps)}</span>
        </span>
      </div>`;
    }).join('');
  }
  renderRistCharts();
}

function renderRistCharts() {
  if (typeof Chart === 'undefined' || !currentRistorante) return;
  const ordini = (currentRistorante.ordini || []).filter(o => inPeriod(o.createdAt, currentPeriod));
  // chart semplificato
  const ctx1 = document.getElementById('chart-incassi-rist');
  if (ctx1) {
    if (chartIncassiRist) chartIncassiRist.destroy();
    const labels = ['Incasso'];
    const data = [ordini.reduce((s, o) => s + Number(o.totale), 0)];
    chartIncassiRist = new Chart(ctx1, {
      type: 'bar',
      data: { labels, datasets: [{ label: '€', data, backgroundColor: 'rgba(59, 130, 246, 0.75)', borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }
  const stati = { nuovo: 0, in_preparazione: 0, pronto: 0, consegnato: 0 };
  ordini.forEach(o => { if (stati[o.stato] !== undefined) stati[o.stato]++; });
  const ctx2 = document.getElementById('chart-stati-rist');
  if (ctx2) {
    if (chartStatiRist) chartStatiRist.destroy();
    chartStatiRist = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Nuovo', 'In prep.', 'Pronto', 'Consegnato'],
        datasets: [{ data: [stati.nuovo, stati.in_preparazione, stati.pronto, stati.consegnato], backgroundColor: ['#d4890f', '#3d6b8c', '#3d7a5a', '#7a6f62'], borderWidth: 0 }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
    });
  }
}

// =====================================================
// MENU
// =====================================================
async function renderMenuTable(filter = '') {
  if (!currentRistorante) return;
  currentRistorante = await loadRistoranteFull(currentRistorante.id);
  let menu = currentRistorante.menu || [];

  // chips categorie
  const chips = $('#categorie-chips');
  if (chips) {
    const cats = ['tutti', ...(currentRistorante.categorie || [])];
    chips.innerHTML = cats.map(c =>
      `<button class="cat-chip ${c === menuFilterCat ? 'active' : ''}" data-cat="${c}">${c === 'tutti' ? 'Tutti' : c}</button>`
    ).join('');
    chips.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        menuFilterCat = chip.dataset.cat;
        renderMenuTable(filter);
      });
    });
  }

  if (menuFilterCat !== 'tutti') menu = menu.filter(p => p.categoria === menuFilterCat);
  if (filter) {
    const q = filter.toLowerCase();
    menu = menu.filter(p => p.nome.toLowerCase().includes(q));
  }

  const sel = $('#piatto-categoria');
  if (sel) {
    sel.innerHTML = (currentRistorante.categorie || []).map(c =>
      `<option value="${c}">${c}</option>`
    ).join('');
  }

  const body = $('#menu-body');
  if (!menu.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">Nessun piatto. Aggiungine uno!</td></tr>`;
    return;
  }
  body.innerHTML = menu.map(p => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${p.immagine ? `<img src="${p.immagine}" class="piatto-img" alt="" onerror="this.style.display='none'"/>` : ''}
          <div>
            <strong>${p.nome}</strong>
            ${p.descrizione ? `<br><small style="color:var(--muted)">${p.descrizione}</small>` : ''}
          </div>
        </div>
      </td>
      <td>${p.categoria || '—'}</td>
      <td>${formatPrice(p.prezzo)}</td>
      <td style="font-size:12px">${(p.allergeni || []).join(', ') || '—'}</td>
      <td><span class="badge ${p.disponibile ? 'badge-pro' : 'badge-base'}">${p.disponibile ? 'Sì' : 'No'}</span></td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="editPiatto('${p.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deletePiatto('${p.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

$('#search-menu')?.addEventListener('input', e => renderMenuTable(e.target.value));

function resetPiattoImage() {
  const prev = $('#piatto-preview');
  const wrap = $('#piatto-preview-wrap');
  const file = $('#piatto-file');
  if (prev) prev.src = '';
  if (wrap) wrap.classList.add('hidden');
  if (file) file.value = '';
  if ($('#piatto-immagine')) $('#piatto-immagine').value = '';
}

function showPiattoPreview(src) {
  const prev = $('#piatto-preview');
  const wrap = $('#piatto-preview-wrap');
  if (!prev || !wrap) return;
  if (src) {
    prev.src = src;
    wrap.classList.remove('hidden');
  } else {
    resetPiattoImage();
  }
}

$('#piatto-file')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    toast('Immagine troppo grande (max 1.5 MB)');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    showPiattoPreview(reader.result);
    if ($('#piatto-immagine')) $('#piatto-immagine').value = '';
  };
  reader.readAsDataURL(file);
});

$('#piatto-immagine')?.addEventListener('input', (e) => {
  const url = e.target.value.trim();
  if (url) showPiattoPreview(url);
  else if (!$('#piatto-file')?.files?.length) resetPiattoImage();
});

$('#btn-rimuovi-img')?.addEventListener('click', () => resetPiattoImage());

$('#btn-nuovo-piatto')?.addEventListener('click', () => {
  $('#modal-piatto-title').textContent = 'Nuovo piatto';
  $('#form-piatto').reset();
  $('#piatto-edit-id').value = '';
  $('#piatto-disponibile').checked = true;
  resetPiattoImage();
  const sel = $('#piatto-categoria');
  sel.innerHTML = (currentRistorante.categorie || []).map(c => `<option value="${c}">${c}</option>`).join('');
  $$('#allergeni-grid input').forEach(c => c.checked = false);
  $('#modal-piatto').classList.remove('hidden');
});

$('#btn-nuova-categoria')?.addEventListener('click', () => {
  $('#form-categoria').reset();
  $('#modal-categoria').classList.remove('hidden');
});

$('#form-categoria')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = $('#cat-nome').value.trim();
  if (!nome || !currentRistorante) return;
  if (!(currentRistorante.categorie || []).includes(nome)) {
    await sb.from('categorie').insert({
      id_ristorante: currentRistorante.id,
      nome,
      posizione: (currentRistorante.categorie || []).length
    });
    toast('Categoria creata');
  }
  $('#modal-categoria').classList.add('hidden');
  await renderMenuTable();
});

$('#form-piatto')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRistorante) return;
  const id = $('#piatto-edit-id').value;
  const allergeni = [...$$('#allergeni-grid input:checked')].map(c => c.value);
  let immagine = ($('#piatto-immagine')?.value || '').trim();
  const previewSrc = $('#piatto-preview')?.src || '';
  if (!immagine && previewSrc && previewSrc.startsWith('data:')) immagine = previewSrc;
  else if (!immagine && previewSrc && !$('#piatto-preview-wrap')?.classList.contains('hidden')) immagine = previewSrc;

  const data = {
    id_ristorante: currentRistorante.id,
    nome: $('#piatto-nome').value.trim(),
    descrizione: $('#piatto-desc').value.trim(),
    categoria: $('#piatto-categoria').value,
    prezzo: parseFloat($('#piatto-prezzo').value) || 0,
    disponibile: $('#piatto-disponibile').checked,
    allergeni,
    immagine
  };

  if (id) {
    const { error } = await sb.from('piatti').update(data).eq('id', id);
    if (error) { toast('Errore'); console.error(error); return; }
    toast('Piatto aggiornato');
  } else {
    const { error } = await sb.from('piatti').insert(data);
    if (error) { toast('Errore'); console.error(error); return; }
    toast('Piatto aggiunto');
  }
  $('#modal-piatto').classList.add('hidden');
  await renderMenuTable($('#search-menu')?.value || '');
  await renderRistDashboard();
});

window.editPiatto = async function(id) {
  const p = currentRistorante.menu.find(x => x.id === id);
  if (!p) return;
  $('#modal-piatto-title').textContent = 'Modifica piatto';
  $('#piatto-edit-id').value = p.id;
  $('#piatto-nome').value = p.nome;
  $('#piatto-desc').value = p.descrizione || '';
  const sel = $('#piatto-categoria');
  sel.innerHTML = (currentRistorante.categorie || []).map(c =>
    `<option value="${c}" ${c === p.categoria ? 'selected' : ''}>${c}</option>`
  ).join('');
  $('#piatto-prezzo').value = p.prezzo;
  $('#piatto-disponibile').checked = p.disponibile !== false;
  if ($('#piatto-immagine')) $('#piatto-immagine').value = (p.immagine && !p.immagine.startsWith('data:')) ? p.immagine : '';
  if (p.immagine) showPiattoPreview(p.immagine);
  else resetPiattoImage();
  $$('#allergeni-grid input').forEach(c => {
    c.checked = (p.allergeni || []).includes(c.value);
  });
  $('#modal-piatto').classList.remove('hidden');
};

window.deletePiatto = async function(id) {
  await sb.from('piatti').delete().eq('id', id);
  await renderMenuTable($('#search-menu')?.value || '');
  await renderRistDashboard();
  toast('Piatto eliminato');
};

// =====================================================
// AGGIORNAMENTO AUTOMATICO ORDINI (ristoratore / cameriera)
// Realtime Supabase (istantaneo) + controllo ogni 5 s come rete di sicurezza.
// Il controllo è leggero: scarica solo id/stato e ridisegna la schermata solo se qualcosa è cambiato.
// =====================================================
const ORDINI_POLL_MS = 5000;
let _ordiniPoll = null;
let _ordiniChannel = null;
let _ordiniSig = null;
let _knownOrderIds = null;   // null = baseline non ancora stabilita
let _ordiniBusy = false;
let _ordiniPending = false;  // un evento è arrivato mentre un controllo era già in corso
const _titoloOriginale = document.title;

/** Aggiorna il badge rosso accanto a «Ordini» (ristoratore e cassa). */
function updateOrdiniBadge(n) {
  const badge = document.getElementById('badge-ordini');
  if (!badge) return;
  const num = Math.max(0, Number(n) || 0);
  if (num > 0) {
    badge.textContent = String(num);
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

function beepNuovoOrdine() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 700);
  } catch (e) {}          // il browser può bloccare l'audio finché non c'è un tocco dell'utente
}

function avvisaNuoviOrdini(n) {
  if (!n || n < 1) return;
  toast(n === 1 ? '🔔 Nuovo ordine!' : '🔔 ' + n + ' nuovi ordini!');
  beepNuovoOrdine();
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
  if (document.hidden) document.title = '🔔 Nuovo ordine – ' + _titoloOriginale;
}

async function checkOrdiniUpdate() {
  // se un controllo è già in corso, segna che va rifatto appena finisce
  if (_ordiniBusy) { _ordiniPending = true; return; }
  // ristoratore e cassa devono entrambi ricevere aggiornamenti in tempo reale
  if (!sb || !currentUser || !currentRistorante) return;
  if (currentUser.role !== 'ristoratore' && currentUser.role !== 'cassa') return;
  if (!navigator.onLine) return;
  _ordiniBusy = true;
  try {
    do {
      _ordiniPending = false;
      const rid = currentRistorante.id;
      const { data, error } = await sb.from('ordini')
        .select('id,stato,stato_pagamento')
        .eq('id_ristorante', rid);
      if (error) throw error;
      if (!currentRistorante || currentRistorante.id !== rid) return;

      const rows = data || [];
      const nNuovi = rows.filter(o => o.stato === 'nuovo').length;
      // badge sempre allineato ai dati leggeri (anche al primo giro e senza ricaricare la pagina)
      updateOrdiniBadge(nNuovi);

      const sig = rows.map(o => o.id + ':' + o.stato + ':' + (o.stato_pagamento || '')).sort().join('|');

      // Baseline: la prima lettura non genera popup (evita avvisi su ordini già presenti al login).
      // Dalla seconda in poi: ogni id nuovo in stato «nuovo» fa scattare notifica + beep.
      if (_knownOrderIds) {
        const arrivati = rows.filter(o => !_knownOrderIds.has(o.id) && o.stato === 'nuovo');
        if (arrivati.length) avvisaNuoviOrdini(arrivati.length);
      }
      _knownOrderIds = new Set(rows.map(o => o.id));

      if (sig !== _ordiniSig) {
        const primaVolta = _ordiniSig === null;
        _ordiniSig = sig;
        // dalla seconda lettura ridisegna sempre; alla prima solo se ci sono già ordini nuovi
        // (es. arrivati tra il render iniziale e il primo poll)
        if (!primaVolta || nNuovi > 0) await refreshSchermataOrdini();
      }
    } while (_ordiniPending);
  } catch (e) {
    console.warn('Aggiornamento ordini non riuscito:', e.message || e);
  } finally {
    _ordiniBusy = false;
    // se durante il finally è arrivato un altro evento
    if (_ordiniPending) {
      _ordiniPending = false;
      setTimeout(() => checkOrdiniUpdate(), 0);
    }
  }
}

async function refreshSchermataOrdini() {
  const visible = (id) => { const el = $(id); return el && !el.classList.contains('hidden'); };
  try {
    if (visible('#page-rist-ordini')) await renderOrdiniKanban();
    else if (visible('#page-rist-dashboard')) await renderRistDashboard();
    else if (visible('#page-rist-tavoli')) await renderTavoli();
    else if (currentRistorante) {
      // altre pagine: ricarica e aggiorna solo il badge
      currentRistorante = await loadRistoranteFull(currentRistorante.id) || currentRistorante;
      const nuovi = ((currentRistorante && currentRistorante.ordini) || []).filter(o => o.stato === 'nuovo').length;
      updateOrdiniBadge(nuovi);
    }
  } catch (e) {
    console.warn('refreshSchermataOrdini:', e.message || e);
  }
}

function startOrdiniWatch() {
  stopOrdiniWatch();
  _ordiniSig = null;
  _knownOrderIds = null;
  _ordiniPending = false;
  checkOrdiniUpdate();                                        // lettura iniziale (stabilisce baseline)
  _ordiniPoll = setInterval(checkOrdiniUpdate, ORDINI_POLL_MS);
  try {
    if (sb && currentRistorante && sb.channel) {
      _ordiniChannel = sb.channel('ordini-' + currentRistorante.id)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'ordini', filter: 'id_ristorante=eq.' + currentRistorante.id },
            () => checkOrdiniUpdate())
        .subscribe();
    }
  } catch (e) { console.warn('Realtime non disponibile, resta il controllo periodico:', e); }
}

function stopOrdiniWatch() {
  if (_ordiniPoll) { clearInterval(_ordiniPoll); _ordiniPoll = null; }
  try { if (_ordiniChannel && sb) sb.removeChannel(_ordiniChannel); } catch (e) {}
  _ordiniChannel = null;
  _ordiniSig = null;
  _knownOrderIds = null;
  _ordiniPending = false;
  document.title = _titoloOriginale;
}

// al rientro nella scheda / al ritorno della rete: controlla subito
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { document.title = _titoloOriginale; checkOrdiniUpdate(); }
});
window.addEventListener('focus', () => { document.title = _titoloOriginale; checkOrdiniUpdate(); });
window.addEventListener('online', () => checkOrdiniUpdate());


// =====================================================
// CHIUSURA FISCALE (ristoratore)
// =====================================================
function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function sameDayLocal(iso, ymd) {
  if (!iso || !ymd) return false;
  const d = new Date(iso);
  return ymdLocal(d) === ymd;
}

function chiusuraStorageKey(ristId) {
  return 'menupro_chiusure_' + ristId;
}

function loadChiusureLocali(ristId) {
  try {
    return JSON.parse(localStorage.getItem(chiusuraStorageKey(ristId)) || '[]');
  } catch (e) { return []; }
}

function saveChiusuraLocale(ristId, record) {
  const list = loadChiusureLocali(ristId).filter(x => x.data_giornata !== record.data_giornata);
  list.unshift(record);
  try { localStorage.setItem(chiusuraStorageKey(ristId), JSON.stringify(list.slice(0, 60))); } catch (e) {}
}

function collectChiusuraStats(ordini, ymd) {
  const delGiorno = (ordini || []).filter(o => sameDayLocal(o.createdAt || o.created_at, ymd));
  let totale = 0, carta = 0, cassa = 0, pagato = 0, inAttesa = 0, nonPagato = 0;
  const perCircuito = {};
  const perStato = {};
  const aperti = [];

  delGiorno.forEach(o => {
    const t = Number(o.totale) || 0;
    totale += t;
    const metodo = o.pagamento === 'cassa' ? 'cassa' : 'carta';
    if (metodo === 'carta') carta += t; else cassa += t;
    const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
    if (ps === 'pagato') pagato += t;
    else if (ps === 'non_pagato') nonPagato += t;
    else inAttesa += t;
    const circ = o.circuito_pagamento || (metodo === 'carta' ? 'non_specificato' : '—');
    if (metodo === 'carta') perCircuito[circ] = (perCircuito[circ] || 0) + t;
    perStato[o.stato || 'nuovo'] = (perStato[o.stato || 'nuovo'] || 0) + 1;
    if (isOrdineAncoraAperto(o.stato)) aperti.push(o);
  });

  return {
    delGiorno,
    n: delGiorno.length,
    totale, carta, cassa, pagato, inAttesa, nonPagato,
    perCircuito, perStato, aperti
  };
}

function renderBreakdown(el, entries, emptyMsg) {
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:13px">' + emptyMsg + '</p>';
    return;
  }
  el.innerHTML = entries.map(([label, val, isMoney]) => `
    <div class="chiusura-row">
      <span class="label">${label}</span>
      <span class="val">${isMoney ? formatPrice(val) : val}</span>
    </div>
  `).join('');
}

async function renderChiusuraFiscale() {
  if (!currentRistorante) return;
  currentRistorante = await loadRistoranteFull(currentRistorante.id);

  const dataInput = $('#chiusura-data');
  if (dataInput && !dataInput.value) dataInput.value = ymdLocal();
  const ymd = (dataInput && dataInput.value) || ymdLocal();

  const stats = collectChiusuraStats(currentRistorante.ordini || [], ymd);

  if ($('#ch-tot-incasso')) $('#ch-tot-incasso').textContent = formatPrice(stats.totale);
  if ($('#ch-n-ordini')) $('#ch-n-ordini').textContent = stats.n;
  if ($('#ch-tot-carta')) $('#ch-tot-carta').textContent = formatPrice(stats.carta);
  if ($('#ch-tot-cassa')) $('#ch-tot-cassa').textContent = formatPrice(stats.cassa);

  const alert = $('#chiusura-alert');
  if (alert) {
    if (stats.aperti.length) {
      alert.className = 'chiusura-alert danger';
      alert.classList.remove('hidden');
      alert.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Ci sono <strong>' +
        stats.aperti.length + '</strong> ordini ancora aperti (nuovo / in preparazione / pronto). ' +
        'Chiudili o consegnali prima della chiusura, oppure la chiusura li segnerà come chiusi.';
    } else if (stats.n === 0) {
      alert.className = 'chiusura-alert';
      alert.classList.remove('hidden');
      alert.innerHTML = '<i class="fas fa-info-circle"></i> Nessun ordine in questa giornata.';
    } else {
      alert.className = 'chiusura-alert ok';
      alert.classList.remove('hidden');
      alert.innerHTML = '<i class="fas fa-check-circle"></i> Tutti gli ordini della giornata risultano chiusi o consegnati. Puoi eseguire la chiusura fiscale.';
    }
  }

  renderBreakdown($('#chiusura-metodi'), [
    ['Carta (online)', stats.carta, true],
    ['Cassa', stats.cassa, true],
    ['Già pagati', stats.pagato, true],
    ['In attesa', stats.inAttesa, true],
    ['Non pagati', stats.nonPagato, true]
  ], 'Nessun dato');

  const circEntries = Object.entries(stats.perCircuito)
    .map(([id, v]) => [labelCircuito(id === 'non_specificato' ? '' : id) || id, v, true])
    .sort((a, b) => b[1] - a[1]);
  renderBreakdown($('#chiusura-circuiti'), circEntries, 'Nessun pagamento con carta');

  const statoEntries = Object.entries(stats.perStato)
    .map(([s, n]) => [labelStato(s), n, false]);
  renderBreakdown($('#chiusura-stati'), statoEntries, 'Nessun ordine');

  const tbody = $('#chiusura-ordini-body');
  if (tbody) {
    if (!stats.delGiorno.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center">Nessun ordine</td></tr>';
    } else {
      const sorted = [...stats.delGiorno].sort((a, b) =>
        new Date(a.createdAt || a.created_at) - new Date(b.createdAt || b.created_at));
      tbody.innerHTML = sorted.map(o => {
        const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
        const metodo = o.pagamento === 'cassa' ? 'Cassa' : 'Carta';
        const circ = o.circuito_pagamento ? labelCircuito(o.circuito_pagamento) : '—';
        return `<tr>
          <td>${formatTime(o.createdAt || o.created_at)}</td>
          <td>#${o.codice || ''}</td>
          <td>${o.tavolo}</td>
          <td><span class="badge-stato ${o.stato}">${labelStato(o.stato)}</span></td>
          <td>${metodo} · <span class="badge-pag ${ps}">${labelPagamentoStato(ps)}</span></td>
          <td>${circ}</td>
          <td><strong>${formatPrice(o.totale)}</strong></td>
        </tr>`;
      }).join('');
    }
  }

  await renderStoricoChiusure(ymd);
}

async function renderStoricoChiusure(ymdFocus) {
  const el = $('#chiusura-storico');
  if (!el || !currentRistorante) return;
  let rows = loadChiusureLocali(currentRistorante.id);
  if (sb) {
    try {
      const { data } = await sb.from('chiusure_fiscali')
        .select('*')
        .eq('id_ristorante', currentRistorante.id)
        .order('data_giornata', { ascending: false })
        .limit(30);
      if (data && data.length) {
        // merge prefer DB
        const byDay = {};
        rows.forEach(r => { byDay[r.data_giornata] = r; });
        data.forEach(r => { byDay[r.data_giornata] = r; });
        rows = Object.values(byDay).sort((a, b) => String(b.data_giornata).localeCompare(String(a.data_giornata)));
      }
    } catch (e) { /* tabella assente */ }
  }
  if (!rows.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:13px">Nessuna chiusura registrata ancora.</p>';
    return;
  }
  el.innerHTML = rows.slice(0, 15).map(r => `
    <div class="recent-item">
      <span><strong>${r.data_giornata}</strong> · ${r.n_ordini || 0} ordini
        ${r.data_giornata === ymdFocus ? ' <span class="badge-stato pronto">giornata selezionata</span>' : ''}
      </span>
      <span>${formatPrice(r.totale || 0)}</span>
    </div>
  `).join('');
}

function formatDataIt(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-');
  return d + '/' + m + '/' + y;
}

function chiediConfermaChiusura(ymd, stats) {
  return new Promise((resolve) => {
    const modal = $('#modal-chiusura-fiscale');
    if (!modal) {
      resolve(confirm('Confermi la chiusura fiscale del ' + ymd + '?'));
      return;
    }
    const lead = $('#chiusura-modal-lead');
    if (lead) {
      lead.innerHTML = 'Stai per chiudere la giornata del <strong>' + formatDataIt(ymd) + '</strong>' +
        (currentRistorante && currentRistorante.nome ? ' · ' + currentRistorante.nome : '') + '.';
    }
    const statsEl = $('#chiusura-modal-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="chiusura-stat-pill wide">
          <span class="k">Incasso totale</span>
          <span class="v">${formatPrice(stats.totale)}</span>
        </div>
        <div class="chiusura-stat-pill">
          <span class="k">Ordini</span>
          <span class="v">${stats.n}</span>
        </div>
        <div class="chiusura-stat-pill">
          <span class="k">Già pagati</span>
          <span class="v">${formatPrice(stats.pagato)}</span>
        </div>
        <div class="chiusura-stat-pill">
          <span class="k">Carta</span>
          <span class="v">${formatPrice(stats.carta)}</span>
        </div>
        <div class="chiusura-stat-pill">
          <span class="k">Cassa</span>
          <span class="v">${formatPrice(stats.cassa)}</span>
        </div>`;
    }
    const warn = $('#chiusura-modal-warn');
    if (warn) {
      if (stats.aperti.length) {
        warn.classList.remove('hidden');
        warn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <strong>' +
          stats.aperti.length + ' ordini ancora aperti</strong> verranno segnati come chiusi e pagati.';
      } else {
        warn.classList.add('hidden');
        warn.innerHTML = '';
      }
    }

    const btnOk = $('#btn-chiusura-modal-ok');
    const btnNo = $('#btn-chiusura-modal-annulla');
    const btnX = $('#btn-chiusura-modal-x');
    const btnPdf = $('#btn-chiusura-modal-pdf');

    const cleanup = (val) => {
      modal.classList.add('hidden');
      btnOk?.removeEventListener('click', onOk);
      btnNo?.removeEventListener('click', onNo);
      btnX?.removeEventListener('click', onNo);
      btnPdf?.removeEventListener('click', onPdf);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onPdf = async () => { await scaricaPdfChiusura(ymd, stats); };
    const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    btnOk?.addEventListener('click', onOk);
    btnNo?.addEventListener('click', onNo);
    btnX?.addEventListener('click', onNo);
    btnPdf?.addEventListener('click', onPdf);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    modal.classList.remove('hidden');
    setTimeout(() => btnOk?.focus(), 40);
  });
}

async function eseguiChiusuraFiscale() {
  if (!currentRistorante) return;
  if (!assertNotCliente()) return;
  const ymd = ($('#chiusura-data') && $('#chiusura-data').value) || ymdLocal();
  currentRistorante = await loadRistoranteFull(currentRistorante.id);
  const stats = collectChiusuraStats(currentRistorante.ordini || [], ymd);

  const ok = await chiediConfermaChiusura(ymd, stats);
  if (!ok) return;

  await completaChiusuraFiscale(ymd, stats);
}

async function completaChiusuraFiscale(ymd, stats) {
  if (sb && stats.aperti.length) {
    for (const o of stats.aperti) {
      try {
        await sb.from('ordini').update({ stato: 'chiuso', stato_pagamento: 'pagato' }).eq('id', o.id);
        await sb.from('tavoli').update({ occupato: false })
          .eq('id_ristorante', currentRistorante.id).eq('numero', o.tavolo);
      } catch (e) { console.warn('chiusura ordine', o.id, e); }
    }
  }

  const record = {
    id_ristorante: currentRistorante.id,
    data_giornata: ymd,
    chiuso_at: new Date().toISOString(),
    n_ordini: stats.n,
    totale: Math.round(stats.totale * 100) / 100,
    totale_carta: Math.round(stats.carta * 100) / 100,
    totale_cassa: Math.round(stats.cassa * 100) / 100,
    totale_pagato: Math.round(stats.pagato * 100) / 100,
    totale_in_attesa: Math.round(stats.inAttesa * 100) / 100,
    dettaglio: {
      circuiti: stats.perCircuito,
      stati: stats.perStato,
      aperti_chiusi: stats.aperti.map(o => o.id)
    }
  };

  saveChiusuraLocale(currentRistorante.id, record);

  if (sb) {
    try {
      await sb.from('chiusure_fiscali').upsert(record, { onConflict: 'id_ristorante,data_giornata' });
    } catch (e) {
      console.warn('chiusure_fiscali upsert skip', e.message || e);
    }
  }

  try { await scaricaPdfChiusura(ymd, stats); } catch (e) { console.warn('pdf', e); }

  toast('Chiusura fiscale del ' + formatDataIt(ymd) + ' registrata');
  await renderChiusuraFiscale();
  await renderRistDashboard();
  await renderOrdiniKanban();
}

function ensureJsPdf() {
  return new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
    const existing = document.querySelector('script[data-jspdf]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.jspdf.jsPDF));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    s.dataset.jspdf = '1';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function scaricaPdfChiusura(ymd, stats) {
  if (!currentRistorante) return;
  if (!ymd) ymd = ($('#chiusura-data') && $('#chiusura-data').value) || ymdLocal();
  if (!stats) {
    currentRistorante = await loadRistoranteFull(currentRistorante.id);
    stats = collectChiusuraStats(currentRistorante.ordini || [], ymd);
  }

  let jsPDF;
  try {
    jsPDF = await ensureJsPdf();
  } catch (e) {
    toast('Impossibile caricare il generatore PDF');
    return;
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const nome = currentRistorante.nome || 'Ristorante';
  const margin = 18;
  let y = 20;
  const line = (txt, size = 11, style = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(20);
    doc.text(String(txt), margin, y);
    y += size * 0.45 + 3;
  };
  const rule = () => {
    doc.setDrawColor(180);
    doc.line(margin, y, 210 - margin, y);
    y += 6;
  };

  line('CHIUSURA FISCALE', 18, 'bold');
  line(nome, 13, 'bold');
  line('Giornata: ' + formatDataIt(ymd), 11);
  line('Generato: ' + new Date().toLocaleString('it-IT'), 9);
  y += 2;
  rule();

  line('RIEPILOGO', 12, 'bold');
  line('Ordini totali: ' + stats.n);
  line('Incasso totale: ' + formatPrice(stats.totale), 12, 'bold');
  line('Carta: ' + formatPrice(stats.carta) + '    Cassa: ' + formatPrice(stats.cassa));
  line('Pagati: ' + formatPrice(stats.pagato) + '    In attesa: ' + formatPrice(stats.inAttesa) +
    '    Non pagati: ' + formatPrice(stats.nonPagato));
  y += 2;
  rule();

  line('CIRCUITI CARTA', 12, 'bold');
  const circs = Object.entries(stats.perCircuito);
  if (!circs.length) line('Nessun pagamento con carta');
  else circs.forEach(([id, v]) => line((labelCircuito(id) || id) + ': ' + formatPrice(v)));
  y += 2;
  rule();

  line('STATI ORDINE', 12, 'bold');
  Object.entries(stats.perStato).forEach(([s, n]) => line(labelStato(s) + ': ' + n));
  y += 2;
  rule();

  line('DETTAGLIO ORDINI', 12, 'bold');
  const sorted = [...stats.delGiorno].sort((a, b) =>
    new Date(a.createdAt || a.created_at) - new Date(b.createdAt || b.created_at));
  if (!sorted.length) {
    line('Nessun ordine', 10);
  } else {
    sorted.forEach(o => {
      if (y > 275) { doc.addPage(); y = 20; }
      const ora = formatTime(o.createdAt || o.created_at);
      const met = o.pagamento === 'cassa' ? 'Cassa' : 'Carta';
      const circ = o.circuito_pagamento ? ' · ' + labelCircuito(o.circuito_pagamento) : '';
      const row = ora + '  #' + (o.codice || '') + '  T' + o.tavolo + '  ' + met + circ + '  ' + formatPrice(o.totale);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(20);
      doc.text(row, margin, y);
      y += 5;
    });
  }

  y += 10;
  if (y > 280) { doc.addPage(); y = 20; }
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'Documento gestionale MenuPro. Non sostituisce lo scontrino del registratore di cassa certificato.',
    margin, y, { maxWidth: 174 }
  );

  const filename = 'chiusura-fiscale-' + ymd + '.pdf';
  doc.save(filename);
  toast('PDF scaricato: ' + filename);
}

async function scaricaPdfChiusuraDaUI() {
  if (!currentRistorante) return;
  const ymd = ($('#chiusura-data') && $('#chiusura-data').value) || ymdLocal();
  currentRistorante = await loadRistoranteFull(currentRistorante.id);
  const stats = collectChiusuraStats(currentRistorante.ordini || [], ymd);
  await scaricaPdfChiusura(ymd, stats);
}

function assertNotCliente() {
  return !(currentUser && currentUser.role === 'cliente');
}

function stampaRiepilogoChiusura() {
  if (!currentRistorante) return;
  const ymd = ($('#chiusura-data') && $('#chiusura-data').value) || ymdLocal();
  const stats = collectChiusuraStats(currentRistorante.ordini || [], ymd);
  const circLines = Object.entries(stats.perCircuito)
    .map(([id, v]) => `<div class="chiusura-row"><span>${labelCircuito(id) || id}</span><span>${formatPrice(v)}</span></div>`)
    .join('') || '<div>—</div>';

  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = `
    <div style="font-family:system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:16px">
      <h1 style="font-size:20px;margin:0 0 4px">Chiusura fiscale</h1>
      <p style="margin:0 0 12px;color:#444">${currentRistorante.nome || ''} · Giornata ${ymd}</p>
      <p style="font-size:13px;color:#666">Stampato il ${new Date().toLocaleString('it-IT')}</p>
      <hr/>
      <p><strong>Ordini:</strong> ${stats.n}</p>
      <p><strong>Incasso totale:</strong> ${formatPrice(stats.totale)}</p>
      <p>Carta: ${formatPrice(stats.carta)} · Cassa: ${formatPrice(stats.cassa)}</p>
      <p>Pagati: ${formatPrice(stats.pagato)} · In attesa: ${formatPrice(stats.inAttesa)} · Non pagati: ${formatPrice(stats.nonPagato)}</p>
      <h3 style="font-size:15px;margin:16px 0 8px">Circuiti carta</h3>
      ${circLines}
      <h3 style="font-size:15px;margin:16px 0 8px">Ordini</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;border-bottom:1px solid #ccc">Ora</th>
          <th style="text-align:left;border-bottom:1px solid #ccc">Codice</th>
          <th style="text-align:left;border-bottom:1px solid #ccc">Tav.</th>
          <th style="text-align:left;border-bottom:1px solid #ccc">Pag.</th>
          <th style="text-align:right;border-bottom:1px solid #ccc">Totale</th>
        </tr></thead>
        <tbody>
          ${stats.delGiorno.map(o => `
            <tr>
              <td style="padding:4px 0">${formatTime(o.createdAt || o.created_at)}</td>
              <td>${o.codice || ''}</td>
              <td>${o.tavolo}</td>
              <td>${o.pagamento === 'cassa' ? 'Cassa' : 'Carta'}${o.circuito_pagamento ? ' · ' + labelCircuito(o.circuito_pagamento) : ''}</td>
              <td style="text-align:right">${formatPrice(o.totale)}</td>
            </tr>
          `).join('') || '<tr><td colspan="5">Nessun ordine</td></tr>'}
        </tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;color:#888">Documento di riepilogo gestionale MenuPro (non sostituisce lo scontrino fiscale del registratore di cassa certificato).</p>
    </div>
  `;
  area.classList.add('printing');
  const cleanup = () => { area.classList.remove('printing'); area.innerHTML = ''; };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => { window.print(); setTimeout(cleanup, 1500); }, 100);
}

document.getElementById('btn-chiusura-refresh')?.addEventListener('click', () => renderChiusuraFiscale());
document.getElementById('btn-chiusura-esegui')?.addEventListener('click', () => eseguiChiusuraFiscale());
document.getElementById('btn-chiusura-stampa')?.addEventListener('click', () => stampaRiepilogoChiusura());
document.getElementById('btn-chiusura-pdf')?.addEventListener('click', () => scaricaPdfChiusuraDaUI());
document.getElementById('chiusura-data')?.addEventListener('change', () => renderChiusuraFiscale());


// =====================================================
// ORDINI KANBAN
// =====================================================
async function renderOrdiniKanban() {
  if (!currentRistorante) return;
  currentRistorante = await loadRistoranteFull(currentRistorante.id);
  const ordini = currentRistorante.ordini || [];

  const nuovi = ordini.filter(o => o.stato === 'nuovo');
  const prep = ordini.filter(o => o.stato === 'in_preparazione');
  const pronti = ordini.filter(o => o.stato === 'pronto' || o.stato === 'consegnato');

  $('#count-nuovo').textContent = nuovi.length;
  $('#count-prep').textContent = prep.length;
  $('#count-pronto').textContent = pronti.length;

  function cardHtml(o) {
    const items = (o.items || []).slice(0, 3).map(i => `${i.qty}× ${i.nome}`).join(', ');
    const more = (o.items || []).length > 3 ? '...' : '';
    const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
    // data-stato-origine: per il drag (consegnato resta nella colonna pronto)
    const dragStato = (o.stato === 'consegnato') ? 'pronto' : o.stato;
    return `
      <div class="kanban-card stato-${o.stato}" draggable="true"
           data-ordine-id="${o.id}" data-stato="${dragStato}"
           onclick="apriDettaglioOrdine('${o.id}')">
        <h4>Tavolo ${o.tavolo} · ${formatPrice(o.totale)}</h4>
        <p>${items}${more}</p>
        <div class="pag-row">
          <span style="font-size:11px;color:var(--muted)">${formatTime(o.createdAt)} · #${o.codice}</span>
          <span class="badge-pag ${ps}">${labelPagamentoStato(ps)}</span>
        </div>
      </div>
    `;
  }

  $('#kanban-nuovo').innerHTML = nuovi.length ? nuovi.map(cardHtml).join('') : '<p class="kanban-empty" style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nessun ordine</p>';
  $('#kanban-prep').innerHTML = prep.length ? prep.map(cardHtml).join('') : '<p class="kanban-empty" style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nessun ordine</p>';
  $('#kanban-pronto').innerHTML = pronti.length ? pronti.map(cardHtml).join('') : '<p class="kanban-empty" style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nessun ordine</p>';

  updateOrdiniBadge(nuovi.length);

  setupKanbanDragDrop();
}


/** Dialog di conferma nello stile MenuPro (sostituisce window.confirm).
 *  opts: { title, hint, confirmLabel, confirmIcon, danger }
 */
function chiediConfermaStato(msgHtml, hintText, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const modal = $('#modal-conferma-stato');
    if (!modal) {
      resolve(window.confirm(String(msgHtml).replace(/<[^>]+>/g, '')));
      return;
    }
    const titleEl = modal.querySelector('.modal-header h3');
    const msgEl = $('#conferma-stato-msg');
    const hintEl = document.querySelector('.conferma-stato-hint');
    const btnSi = $('#btn-conferma-stato-si');
    const btnNo = $('#btn-conferma-stato-no');
    const btnX = $('#btn-conferma-stato-x');

    const prevTitle = titleEl ? titleEl.innerHTML : '';
    const prevSi = btnSi ? btnSi.innerHTML : '';
    const prevSiClass = btnSi ? btnSi.className : '';

    if (titleEl) {
      const icon = opts.danger
        ? '<i class="fas fa-lock" style="color:var(--danger);margin-right:8px"></i>'
        : '<i class="fas fa-exclamation-triangle" style="color:var(--warning);margin-right:8px"></i>';
      titleEl.innerHTML = icon + (opts.title || 'Conferma');
    }
    if (msgEl) msgEl.innerHTML = msgHtml;
    if (hintEl) {
      hintEl.textContent = hintText || '';
      hintEl.classList.toggle('hidden', !hintText);
    }
    if (btnSi) {
      const ic = opts.confirmIcon || 'fas fa-check';
      btnSi.innerHTML = '<i class="' + ic + '"></i> ' + (opts.confirmLabel || 'Conferma');
      btnSi.className = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
    }

    const cleanup = (val) => {
      modal.classList.add('hidden');
      if (titleEl) titleEl.innerHTML = prevTitle;
      if (btnSi) {
        btnSi.innerHTML = prevSi;
        btnSi.className = prevSiClass;
      }
      btnSi?.removeEventListener('click', onSi);
      btnNo?.removeEventListener('click', onNo);
      btnX?.removeEventListener('click', onNo);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onSi = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    btnSi?.addEventListener('click', onSi);
    btnNo?.addEventListener('click', onNo);
    btnX?.addEventListener('click', onNo);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    modal.classList.remove('hidden');
    setTimeout(() => btnSi?.focus(), 30);
  });
}

// =====================================================
// DRAG & DROP KANBAN ORDINI
// Conferma solo per salto "grande": da nuovo → pronto
// =====================================================
let _kanbanDrag = null; // { id, fromStato, el }
let _kanbanJustDragged = false;

function setupKanbanDragDrop() {
  const board = document.querySelector('#page-rist-ordini .kanban');
  if (!board || board.dataset.dndBound) return;
  board.dataset.dndBound = '1';

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card || !card.dataset.ordineId) return;
    _kanbanDrag = {
      id: card.dataset.ordineId,
      fromStato: card.dataset.stato,
      el: card
    };
    card.classList.add('kanban-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.ordineId); } catch (_) {}
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card');
    if (card) card.classList.remove('kanban-dragging');
    board.querySelectorAll('.kanban-col.drag-over').forEach(c => c.classList.remove('drag-over'));
    // evita che il click apra il dettaglio subito dopo un drop
    if (_kanbanJustDragged) {
      setTimeout(() => { _kanbanJustDragged = false; }, 50);
    }
    _kanbanDrag = null;
  });

  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.kanban-col');
    if (!col || !_kanbanDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    board.querySelectorAll('.kanban-col.drag-over').forEach(c => {
      if (c !== col) c.classList.remove('drag-over');
    });
    col.classList.add('drag-over');
  });

  board.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.kanban-col');
    if (!col) return;
    // lascia solo se usciamo davvero dalla colonna
    if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });

  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    const col = e.target.closest('.kanban-col');
    board.querySelectorAll('.kanban-col.drag-over').forEach(c => c.classList.remove('drag-over'));
    if (!col || !_kanbanDrag) return;

    const toStato = col.dataset.stato; // nuovo | in_preparazione | pronto
    const { id, fromStato } = _kanbanDrag;
    _kanbanJustDragged = true;
    _kanbanDrag = null;

    if (!toStato || toStato === fromStato) return;

    // Salto "grande": da Nuovo direttamente a Pronto → dialog carino
    if (fromStato === 'nuovo' && toStato === 'pronto') {
      const ok = await chiediConfermaStato(
        'Vuoi segnare questo ordine come <strong>Pronto</strong> saltando la preparazione?',
        'L\'ordine passerà direttamente da Nuovo a Pronto, senza la fase di preparazione.'
      );
      if (!ok) return;
    }

    await cambiaStato(id, toStato);
  });

  // se l'utente ha appena trascinato, non aprire il dettaglio sul click
  board.addEventListener('click', (e) => {
    if (!_kanbanJustDragged) return;
    const card = e.target.closest('.kanban-card');
    if (card) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

window.apriDettaglioOrdine = async function(ordineId) {
  let o = currentRistorante.ordini.find(x => x.id === ordineId);
  if (!o) return;
  // assicura lista piatti (items o ordine_riga)
  let items = o.items || [];
  if ((!items || !items.length) && sb) {
    try {
      const { data: righe } = await sb.from('ordine_riga').select('*').eq('id_ordine', ordineId);
      if (righe && righe.length) {
        items = righe.map(r => ({
          nome: r.piatto || r.nome || 'Piatto',
          qty: r.qty_piatti || r.qty || 1,
          prezzo: 0
        }));
        o.items = items;
      }
    } catch (e) {}
  }
  $('#ordine-detail-title').textContent = `Ordine #${o.codice} – Tavolo ${o.tavolo}`;
  const itemsHtml = (items || []).length
    ? (items || []).map(i =>
        `<div class="r-item prep-line"><span class="prep-qty">${i.qty}×</span> <span class="prep-name">${i.nome}</span></div>`
      ).join('')
    : '<p style="color:var(--muted)">Nessun piatto in questo ordine</p>';
  const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
  const metodo = o.pagamento === 'cassa' ? 'Pago in cassa' : (o.pagamento === 'carta' ? 'Carta' : (o.pagamento || '—'));
  $('#ordine-detail-body').innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span class="badge-stato ${o.stato}">${labelStato(o.stato)}</span>
      <span class="badge-pag ${ps}">${labelPagamentoStato(ps)}</span>
      <span style="color:var(--muted);font-size:13px">${formatTime(o.createdAt)}</span>
    </div>
    <h4 style="font-size:13px;margin:10px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Da preparare</h4>
    <div class="ricevuta-items prep-list">${itemsHtml}</div>
    ${o.note ? `<p style="font-size:13px;color:var(--muted);margin:12px 0"><i class="fas fa-sticky-note"></i> ${o.note}</p>` : ''}
    <p style="font-size:13px;margin:8px 0">Metodo: <strong>${metodo}</strong></p>
    <div class="ricevuta-totale"><span>Totale</span><strong>${formatPrice(o.totale)}</strong></div>
  `;
  let actions = '';
  if (o.stato === 'nuovo') {
    actions = `<button class="btn btn-primary" onclick="cambiaStato('${o.id}','in_preparazione')"><i class="fas fa-fire"></i> Inizia preparazione</button>`;
  } else if (o.stato === 'in_preparazione') {
    actions = `<button class="btn btn-primary" onclick="cambiaStato('${o.id}','pronto')"><i class="fas fa-check"></i> Segna pronto</button>`;
  } else if (o.stato === 'pronto') {
    actions = `<button class="btn btn-primary" onclick="cambiaStato('${o.id}','consegnato')"><i class="fas fa-hand-holding"></i> Consegnato</button>`;
  }
  const nextPag = { in_attesa: 'pagato', pagato: 'non_pagato', non_pagato: 'in_attesa' }[ps] || 'pagato';
  const pagBtnLabel = { pagato: 'Segna pagato', non_pagato: 'Segna non pagato', in_attesa: 'Segna in attesa' }[nextPag];
  actions += `<button class="btn btn-secondary" onclick="togglePagamento('${o.id}')"><i class="fas fa-money-bill-wave"></i> ${pagBtnLabel}</button>`;
  if (o.stato !== 'chiuso') {
    actions += `<button class="btn btn-danger" onclick="chiudiConto('${o.id}')"><i class="fas fa-file-invoice-dollar"></i> Chiudi conto</button>`;
  }
  actions += `<button class="btn btn-secondary close-modal" data-modal="modal-ordine">Chiudi</button>`;
  $('#ordine-detail-actions').innerHTML = actions;
  $('#ordine-detail-actions .close-modal')?.addEventListener('click', () => $('#modal-ordine').classList.add('hidden'));
  $('#modal-ordine').classList.remove('hidden');
};

window.cambiaStato = async function(ordineId, nuovoStato) {
  await sb.from('ordini').update({ stato: nuovoStato }).eq('id', ordineId);
  // aggiorna occupato tavolo
  const o = currentRistorante.ordini.find(x => x.id === ordineId);
  if (o) {
    if (nuovoStato === 'consegnato' || nuovoStato === 'chiuso') {
      await sb.from('tavoli').update({ occupato: false }).eq('id_ristorante', currentRistorante.id).eq('numero', o.tavolo);
    } else {
      await sb.from('tavoli').update({ occupato: true }).eq('id_ristorante', currentRistorante.id).eq('numero', o.tavolo);
    }
  }
  $('#modal-ordine').classList.add('hidden');
  await renderOrdiniKanban();
  await renderRistDashboard();
  toast('Stato aggiornato: ' + labelStato(nuovoStato));
};

window.chiudiConto = async function(ordineId) {
  const o = currentRistorante.ordini.find(x => x.id === ordineId);
  await sb.from('ordini').update({ stato: 'chiuso', stato_pagamento: 'pagato' }).eq('id', ordineId);
  if (o) await sb.from('tavoli').update({ occupato: false }).eq('id_ristorante', currentRistorante.id).eq('numero', o.tavolo);
  $('#modal-ordine').classList.add('hidden');
  await renderOrdiniKanban();
  await renderRistDashboard();
  await renderTavoli();
  toast('Conto chiuso e segnato come pagato');
};

/**
 * Chiude solo le comande già consegnate e pagate → stato "chiuso".
 * Non tocca ordini nuovi, in preparazione, pronti o non pagati.
 */
window.chiudiContiConsegnati = async function() {
  if (!sb || !currentRistorante) {
    toast('Nessun ristorante selezionato');
    return;
  }
  currentRistorante = await loadRistoranteFull(currentRistorante.id) || currentRistorante;
  const daChiudere = (currentRistorante.ordini || []).filter(o => {
    const pag = o.stato_pagamento || defaultPagStato(o.pagamento);
    return o.stato === 'consegnato' && pag === 'pagato';
  });
  if (!daChiudere.length) {
    toast('Nessuna comanda consegnata e pagata da chiudere');
    return;
  }
  const n = daChiudere.length;
  const tavoliUnici = [...new Set(daChiudere.map(o => o.tavolo).filter(t => t != null))];
  const ok = await chiediConfermaStato(
    `Chiudere <strong>${n}</strong> ${n === 1 ? 'conto' : 'conti'} già <strong>consegnati e pagati</strong>?`,
    (tavoliUnici.length
      ? `Coinvolti ${tavoliUnici.length === 1 ? 'il tavolo' : 'i tavoli'} ${tavoliUnici.sort((a,b)=>a-b).join(', ')}. `
      : '') + 'Passeranno allo stato «chiuso» e i tavoli liberi verranno sbloccati. L\'operazione non si può annullare.',
    {
      title: 'Chiudi tutto',
      confirmLabel: n === 1 ? 'Sì, chiudi il conto' : `Sì, chiudi ${n} conti`,
      confirmIcon: 'fas fa-lock',
      danger: true
    }
  );
  if (!ok) return;

  const ids = daChiudere.map(o => o.id);
  const { error } = await sb.from('ordini')
    .update({ stato: 'chiuso' })
    .in('id', ids);
  if (error) {
    toast('Errore chiusura: ' + error.message);
    console.error(error);
    return;
  }

  // libera un tavolo solo se non restano altri ordini aperti su di esso
  const tavoliNum = [...new Set(daChiudere.map(o => o.tavolo).filter(t => t != null))];
  const ancoraAperti = (currentRistorante.ordini || []).filter(o =>
    !ids.includes(o.id) && o.stato !== 'chiuso' && o.stato !== 'consegnato'
  );
  for (const num of tavoliNum) {
    const ancoraSuTavolo = ancoraAperti.some(o => o.tavolo === num);
    if (ancoraSuTavolo) continue;
    try {
      await sb.from('tavoli').update({ occupato: false })
        .eq('id_ristorante', currentRistorante.id)
        .eq('numero', num);
    } catch (e) { console.warn('libero tavolo', num, e); }
  }

  $('#modal-ordine')?.classList.add('hidden');
  await renderOrdiniKanban();
  try { await renderRistDashboard(); } catch (e) {}
  try { await renderTavoli(); } catch (e) {}
  toast(`${daChiudere.length} conti chiusi`);
};

document.getElementById('btn-chiudi-tutto')?.addEventListener('click', () => {
  window.chiudiContiConsegnati();
});

window.togglePagamento = async function(ordineId) {
  const o = currentRistorante.ordini.find(x => x.id === ordineId);
  if (!o) return;
  const cur = o.stato_pagamento || defaultPagStato(o.pagamento);
  const cycle = { in_attesa: 'pagato', pagato: 'non_pagato', non_pagato: 'in_attesa' };
  const next = cycle[cur] || 'pagato';
  await sb.from('ordini').update({ stato_pagamento: next }).eq('id', ordineId);
  await renderOrdiniKanban();
  await renderRistDashboard();
  apriDettaglioOrdine(ordineId);
  toast('Stato pagamento: ' + labelPagamentoStato(next));
};

// Card navigation
document.addEventListener('click', (e) => {
  const card = e.target.closest('.card-tilt');
  if (!card) return;
  const goto = card.dataset.goto;
  const gotoRist = card.dataset.gotoRist;
  if (goto) {
    const nav = document.querySelector('#app-admin .nav-item[data-page="' + goto + '"]');
    if (nav) nav.click();
  }
  if (gotoRist) {
    const nav = document.querySelector('#app-ristoratore .nav-item[data-page="' + gotoRist + '"]');
    if (nav) nav.click();
  }
});
document.addEventListener('pointermove', (e) => {
  const card = e.target.closest('.card-tilt');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
  card.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
});

// =====================================================
// TAVOLI + QR (URL reali)
// =====================================================
function qrData(ristoranteId, tavolo) {
  // Il QR punta al sito da cui lo stai generando, così coincide sempre con la versione che stai usando.
  // SITE_URL di config.js serve solo se lavori in locale (localhost).
  const o = window.location.origin;
  const isLocal = /localhost|127\.0\.0\.1|^file:/.test(o);
  const base = ((isLocal && cfg.SITE_URL) ? cfg.SITE_URL : o).replace(/\/$/, '');
  return `${base}/?r=${ristoranteId}&t=${tavolo}`;
}

async function renderTavoli() {
  if (!currentRistorante) return;
  currentRistorante = await loadRistoranteFull(currentRistorante.id);
  const sale = currentRistorante.sale || ['Sala principale'];
  const tavoli = currentRistorante.tavoli || [];

  const tabs = $('#sale-tabs');
  tabs.innerHTML = sale.map((s, i) =>
    `<button class="sale-tab ${i === currentSala ? 'active' : ''}" data-sala="${i}">${s}</button>`
  ).join('');
  tabs.querySelectorAll('.sale-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentSala = parseInt(tab.dataset.sala);
      renderTavoli();
    });
  });

  const salaTavoli = tavoli.filter(t => (t.sala || 0) === currentSala);
  const piantina = $('#piantina');
  if (!salaTavoli.length) {
    piantina.innerHTML = '<p style="color:var(--muted)">Nessun tavolo in questa sala.</p>';
  } else {
    piantina.innerHTML = salaTavoli.map(t => {
      const label = t.bambini ? `${t.adulti}+${t.bambini}` : `${t.adulti}`;
      return `
        <div class="tavolo-shape ${t.forma === 'round' ? 'round' : ''} ${t.occupato ? 'occupato' : ''}"
             onclick="showQR(${t.numero})" title="Tavolo ${t.numero}">
          <span>T${t.numero}</span>
          <span class="posti">${label} posti</span>
        </div>
      `;
    }).join('');
  }

  const grid = $('#tavoli-grid');
  grid.innerHTML = '';
  salaTavoli.forEach(t => {
    const label = t.bambini ? `${t.adulti} adulti + ${t.bambini} bambini` : `${t.adulti} posti`;
    const card = document.createElement('div');
    card.className = 'tavolo-card';
    card.innerHTML = `
      <h4>Tavolo ${t.numero} ${t.occupato ? '<span class="badge-stato nuovo">Occupato</span>' : ''}</h4>
      <div class="posti-info">${label}</div>
      <div class="qr-mini" id="qr-mini-${t.numero}"></div>
      <div class="tavolo-actions">
        <button class="btn btn-secondary btn-sm" onclick="showQR(${t.numero})"><i class="fas fa-qrcode"></i> QR</button>
        <button class="btn btn-secondary btn-sm" onclick="editTavolo('${t.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteTavolo('${t.id}')"><i class="fas fa-trash"></i></button>
      </div>
    `;
    grid.appendChild(card);
    const data = qrData(currentRistorante.id, t.numero);
    try {
      new QRCode(card.querySelector(`#qr-mini-${t.numero}`), {
        text: data, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M
      });
    } catch {
      card.querySelector(`#qr-mini-${t.numero}`).innerHTML =
        `<img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(data)}" alt="QR"/>`;
    }
  });
}

$('#btn-nuova-sala')?.addEventListener('click', () => {
  $('#form-sala')?.reset();
  $('#modal-sala')?.classList.remove('hidden');
});

$('#form-sala')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = ($('#sala-nome')?.value || '').trim();
  if (!nome || !currentRistorante) return;
  if (!sb) { toast('Database non collegato'); return; }
  const sale = [...(currentRistorante.sale || []), nome];
  const { error } = await sb.from('ristoranti').update({ sale }).eq('id', currentRistorante.id);
  if (error) { toast('Errore: ' + error.message); return; }
  currentRistorante.sale = sale;
  $('#modal-sala').classList.add('hidden');
  await renderTavoli();
  toast('Sala aggiunta');
});

window.showQR = function(tavolo) {
  if (!currentRistorante) return;
  const container = $('#qrcode-container');
  container.innerHTML = '';
  const data = qrData(currentRistorante.id, tavolo);
  $('#modal-qr-title').textContent = `QR Tavolo ${tavolo}`;
  $('#qr-info').textContent = `${currentRistorante.nome} · Tavolo ${tavolo}`;
  try {
    new QRCode(container, { text: data, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  } catch {
    container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data)}" alt="QR"/>`;
  }
  $('#modal-qr').classList.remove('hidden');
};

$('#btn-demo-ristoratore')?.addEventListener('click', () => {
  if ($('#demo-rist-email')) $('#demo-rist-email').value = '';
  if ($('#demo-rist-password')) $('#demo-rist-password').value = '';
  $('#modal-demo-ristoratore').classList.remove('hidden');
});

$('#btn-avvia-demo-rist')?.addEventListener('click', async () => {
  const email = ($('#demo-rist-email')?.value || '').trim().toLowerCase();
  const pass = ($('#demo-rist-password')?.value || '').trim();
  if (!email || !pass) { toast('Inserisci email e password'); return; }
  $('#modal-demo-ristoratore').classList.add('hidden');
  // riusa il login normale
  const ok = await doLogin(email, pass);
  if (!ok) {
    $('#app-admin').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  } else {
    $('#app-admin').classList.add('hidden');
  }
});

$('#btn-nuovo-tavolo')?.addEventListener('click', () => {
  if (!currentRistorante) return;
  const maxNum = (currentRistorante.tavoli || []).reduce((m, t) => Math.max(m, t.numero || 0), 0);
  $('#modal-tavolo-title').textContent = 'Nuovo tavolo';
  $('#tavolo-edit-id').value = '';
  $('#tavolo-numero').value = maxNum + 1;
  $('#tavolo-adulti').value = 4;
  $('#tavolo-bambini').value = 0;
  $('#tavolo-forma').value = 'round';
  $('#modal-tavolo-edit').classList.remove('hidden');
});

$('#form-tavolo')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRistorante) return;
  const id = $('#tavolo-edit-id').value;
  const data = {
    id_ristorante: currentRistorante.id,
    numero: parseInt($('#tavolo-numero').value) || 1,
    adulti: parseInt($('#tavolo-adulti').value) || 4,
    bambini: parseInt($('#tavolo-bambini').value) || 0,
    sala: currentSala || 0,
    forma: $('#tavolo-forma').value || 'round'
  };
  if (id) {
    await sb.from('tavoli').update(data).eq('id', id);
    toast('Tavolo aggiornato');
  } else {
    data.occupato = false;
    await sb.from('tavoli').insert(data);
    toast('Tavolo aggiunto');
  }
  $('#modal-tavolo-edit').classList.add('hidden');
  await renderTavoli();
});

window.editTavolo = function(id) {
  const t = currentRistorante.tavoli.find(x => x.id === id);
  if (!t) return;
  $('#modal-tavolo-title').textContent = 'Modifica tavolo';
  $('#tavolo-edit-id').value = t.id;
  $('#tavolo-numero').value = t.numero;
  $('#tavolo-adulti').value = t.adulti;
  $('#tavolo-bambini').value = t.bambini || 0;
  $('#tavolo-forma').value = t.forma || 'round';
  $('#modal-tavolo-edit').classList.remove('hidden');
};

window.deleteTavolo = async function(id) {
  await sb.from('tavoli').delete().eq('id', id);
  await renderTavoli();
  toast('Tavolo eliminato');
};

// =====================================================
// CLIENTE
// =====================================================
function showClienteView(view) {
  if (view === 'carrello') applyPaymentOptions();
  ['cliente-menu-view', 'cliente-carrello-view', 'cliente-pagamento-view', 'cliente-ricevuta-view', 'cliente-stato-view'].forEach(id => {
    $(`#${id}`)?.classList.add('hidden');
  });
  $(`#cliente-${view}-view`)?.classList.remove('hidden');
}

function renderClienteMenu() {
  if (!currentRistorante) return;
  const menu = (currentRistorante.menu || []).filter(p => p.disponibile !== false);
  // Ordine categorie come in gestione menu (posizione DB), non casuale
  const ordered = (currentRistorante.categorie || []).filter(Boolean);
  const fromMenu = [...new Set(menu.map(p => p.categoria).filter(Boolean))];
  const orderedCats = [
    ...ordered.filter(c => fromMenu.includes(c)),
    ...fromMenu.filter(c => !ordered.includes(c))
  ];
  const cats = ['tutti', ...orderedCats];
  const catEl = $('#cliente-categorie');
  catEl.innerHTML = cats.map(c =>
    `<button class="cat-chip ${c === menuFilterCat ? 'active' : ''}" data-cat="${c}">${c === 'tutti' ? 'Tutti' : c}</button>`
  ).join('');
  catEl.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => { menuFilterCat = chip.dataset.cat; renderClienteMenu(); });
  });

  let filtered;
  if (menuFilterCat === 'tutti') {
    const rank = {};
    orderedCats.forEach((c, i) => { rank[c] = i; });
    filtered = [...menu].sort((a, b) => (rank[a.categoria] ?? 999) - (rank[b.categoria] ?? 999));
  } else {
    filtered = menu.filter(p => p.categoria === menuFilterCat);
  }
  const list = $('#cliente-menu-list');
  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px">Nessun piatto disponibile.</p>';
    return;
  }
  list.innerHTML = filtered.map(p => {
    const inCart = cart.find(c => c.id === p.id);
    const qty = inCart ? inCart.qty : 0;
    const all = (p.allergeni || []).length ? `<div class="allergeni-tags">⚠ ${(p.allergeni).join(', ')}</div>` : '';
    return `
      <div class="menu-item-card">
        ${p.immagine ? `<img src="${p.immagine}" class="piatto-img" alt="" onerror="this.style.display='none'"/>` : ''}
        <div class="menu-item-info" style="flex:1">
          <h4>${p.nome}</h4>
          ${p.descrizione ? `<p>${p.descrizione}</p>` : ''}
          <span class="prezzo">${formatPrice(p.prezzo)}</span>
          ${all}
        </div>
        <div class="menu-item-actions">
          ${qty > 0 ? `
            <button class="qty-btn" onclick="changeQty('${p.id}',-1)">−</button>
            <span class="qty-num">${qty}</span>
            <button class="qty-btn" onclick="changeQty('${p.id}',1)">+</button>
          ` : `
            <button class="btn btn-primary btn-sm" onclick="changeQty('${p.id}',1)"><i class="fas fa-plus"></i> Aggiungi</button>
          `}
        </div>
      </div>
    `;
    }).join('');
}

function updateCartCount() {
  $('#cart-count').textContent = cart.reduce((s, c) => s + c.qty, 0);
  saveClientState();
}

window.changeQty = function(id, delta) {
  const p = currentRistorante.menu.find(x => x.id === id);
  if (!p) return;
  let item = cart.find(c => c.id === id);
  if (!item && delta > 0) {
    cart.push({ id: p.id, nome: p.nome, prezzo: p.prezzo, qty: 1 });
  } else if (item) {
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter(c => c.id !== id);
  }
  updateCartCount();
  renderClienteMenu();
  if (!$('#cliente-carrello-view').classList.contains('hidden')) renderCarrello();
};

$('#cliente-carrello-btn')?.addEventListener('click', () => {
  renderCarrello();
  showClienteView('carrello');
});
$('#btn-torna-menu')?.addEventListener('click', () => {
  showClienteView('menu');
  renderClienteMenu();
});

function renderCarrello() {
  applyPaymentOptions();
  const el = $('#carrello-items');
  if (!cart.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center">Il carrello è vuoto.</p>';
    $('#carrello-totale').textContent = formatPrice(0);
    return;
  }
  el.innerHTML = cart.map(c => `
    <div class="carrello-item">
      <div>
        <strong>${c.nome}</strong><br>
        <small>${formatPrice(c.prezzo)} × ${c.qty}</small>
      </div>
      <div class="menu-item-actions">
        <button class="qty-btn" onclick="changeQty('${c.id}',-1)">−</button>
        <span class="qty-num">${c.qty}</span>
        <button class="qty-btn" onclick="changeQty('${c.id}',1)">+</button>
      </div>
    </div>
  `).join('');
  $('#carrello-totale').textContent = formatPrice(cart.reduce((s, c) => s + c.prezzo * c.qty, 0));
}

$('#btn-invia-ordine')?.addEventListener('click', async () => {
  if (!cart.length) { toast('Il carrello è vuoto'); return; }
  if (!currentRistorante || !currentUser) {
    toast('Sessione cliente non valida. Riscansiona il QR.');
    return;
  }
  if (!assertQrSessionOrBlock()) return;

  const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value || 'carta';
  if (!metodiAccettati(currentRistorante)[pagamento]) {
    toast('Questo ristorante non accetta il pagamento selezionato');
    applyPaymentOptions();
    return;
  }

  // Carta / wallet → schermata pagamento (salva solo il circuito, non i dati carta)
  if (pagamento === 'carta') {
    const circ = document.querySelector('input[name="circuito"]:checked')?.value || selectedCircuito || 'visa';
    selectedCircuito = circ;
    openPagamentoUI(circ);
    return;
  }

  // Cassa → invio diretto
  await inviaOrdineFinale({ pagamento: 'cassa', circuito: null });
});

function openPagamentoUI(circuitoId) {
  const c = circuitiCatalog.find(x => x.id === circuitoId) || CIRCUITI_DEFAULT.find(x => x.id === circuitoId) || CIRCUITI_DEFAULT[0];
  selectedCircuito = c.id;
  const totale = cart.reduce((s, x) => s + x.prezzo * x.qty, 0);
  const iconEl = $('#pay-circuito-icon');
  if (iconEl) iconEl.className = c.icona || 'fas fa-credit-card';
  if ($('#pay-circuito-nome')) $('#pay-circuito-nome').textContent = 'Paga con ' + c.nome;
  if ($('#pay-totale')) $('#pay-totale').textContent = formatPrice(totale);
  if ($('#pay-btn-totale')) $('#pay-btn-totale').textContent = formatPrice(totale);

  const isWallet = c.tipo === 'wallet';
  $('#pay-form-carta')?.classList.toggle('hidden', isWallet);
  $('#pay-form-wallet')?.classList.toggle('hidden', !isWallet);
  if (isWallet) {
    const wi = $('#pay-wallet-big-icon');
    if (wi) wi.className = c.icona || 'fas fa-mobile-alt';
    if ($('#pay-wallet-hint')) {
      $('#pay-wallet-hint').textContent = c.id === 'apple_pay'
        ? 'Conferma con Face ID / Touch ID sul tuo iPhone.'
        : 'Conferma con Google Pay sul tuo dispositivo.';
    }
  } else {
    // reset campi (restano solo in memoria, non vanno in DB)
    if ($('#pay-intestatario')) $('#pay-intestatario').value = '';
    if ($('#pay-numero')) $('#pay-numero').value = '';
    if ($('#pay-scadenza')) $('#pay-scadenza').value = '';
    if ($('#pay-cvv')) $('#pay-cvv').value = '';
  }
  showClienteView('pagamento');
}

$('#btn-indietro-pagamento')?.addEventListener('click', () => {
  showClienteView('carrello');
  renderCarrello();
  applyPaymentOptions();
});

$('#btn-paga-ora')?.addEventListener('click', async () => {
  if (!assertQrSessionOrBlock()) return;
  const c = circuitiCatalog.find(x => x.id === selectedCircuito) || CIRCUITI_DEFAULT[0];
  if (c.tipo !== 'wallet') {
    const num = ($('#pay-numero')?.value || '').replace(/\s+/g, '');
    const scad = ($('#pay-scadenza')?.value || '').trim();
    const cvv = ($('#pay-cvv')?.value || '').trim();
    const nome = ($('#pay-intestatario')?.value || '').trim();
    if (nome.length < 2) { toast('Inserisci l\'intestatario'); return; }
    if (num.length < 12) { toast('Numero carta non valido'); return; }
    if (!/^\d{2}\/\d{2}$/.test(scad)) { toast('Scadenza nel formato MM/AA'); return; }
    if (cvv.length < 3) { toast('CVV non valido'); return; }
    // I valori restano solo in variabili locali e NON vengono inviati al database
  }
  const btn = $('#btn-paga-ora');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Autorizzazione...'; }
  // Demo: simula autorizzazione PSP (in produzione: Stripe/Adyen/…)
  await new Promise(r => setTimeout(r, 700));
  try {
    await inviaOrdineFinale({ pagamento: 'carta', circuito: selectedCircuito });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock"></i> Paga <span id="pay-btn-totale"></span>';
      const tot = cart.length ? cart.reduce((s, x) => s + x.prezzo * x.qty, 0) : 0;
      // dopo invio cart è vuoto: label già ok
      if ($('#pay-btn-totale')) $('#pay-btn-totale').textContent = '';
    }
  }
});

// Input helpers (solo UX, niente persistenza)
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'pay-numero') {
    let v = e.target.value.replace(/\D/g, '').slice(0, 19);
    e.target.value = v.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }
  if (e.target && e.target.id === 'pay-scadenza') {
    let v = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v;
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.name === 'pagamento') toggleCircuitoVisibility();
});

async function inviaOrdineFinale({ pagamento, circuito }) {
  if (!cart.length) { toast('Il carrello è vuoto'); return; }
  if (!currentRistorante || !currentUser) {
    toast('Sessione cliente non valida. Riscansiona il QR.');
    return;
  }
  if (!sb) {
    toast('Database non collegato: controlla config.js');
    return;
  }

  const totale = cart.reduce((s, c) => s + c.prezzo * c.qty, 0);
  const codice = 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  if (!metodiAccettati(currentRistorante)[pagamento]) {
    toast('Questo ristorante non accetta il pagamento selezionato');
    applyPaymentOptions();
    return;
  }
  const stato_pagamento = defaultPagStato(pagamento);
  const note = ($('#ordine-note')?.value || '').trim();
  const tavoloNum = currentUser.tavolo;
  const circuitoPagamento = (pagamento === 'carta' && circuito) ? circuito : null;

  // Schema nuovo: senza colonna items (usa ordine_riga). Schema vecchio: con items jsonb.
  const ordineBase = {
    id_ristorante: currentRistorante.id,
    codice,
    tavolo: tavoloNum,
    note,
    pagamento,
    stato_pagamento,
    totale,
    stato: 'nuovo',
    // SOLO tipologia circuito (visa, apple_pay, …) — mai numero/CVV
    circuito_pagamento: circuitoPagamento
  };
if (!navigator.onLine) {

  saveOfflineOrder({
    ...ordineBase,
    items: cart.map(c => ({ id: c.id, nome: c.nome, prezzo: c.prezzo, qty: c.qty }))
  });

  toast(
    "Ordine salvato offline. Verrà sincronizzato automaticamente."
  );

  cart = [];
  updateCartCount();

  return;
}
  let inserted = null;
  let error = null;

  // prova con items (schema vecchio)
  ({ data: inserted, error } = await sb.from('ordini').insert({
    ...ordineBase,
    items: cart.map(c => ({ id: c.id, nome: c.nome, prezzo: c.prezzo, qty: c.qty }))
  }).select().single());

  // se fallisce per colonna items o circuito_pagamento, riprova senza
  if (error && String(error.message || '').toLowerCase().includes('items')) {
    ({ data: inserted, error } = await sb.from('ordini').insert(ordineBase).select().single());
  }
  if (error && String(error.message || '').toLowerCase().includes('circuito')) {
    const { circuito_pagamento, ...senzaCirc } = ordineBase;
    ({ data: inserted, error } = await sb.from('ordini').insert({
      ...senzaCirc,
      items: cart.map(c => ({ id: c.id, nome: c.nome, prezzo: c.prezzo, qty: c.qty }))
    }).select().single());
    if (error && String(error.message || '').toLowerCase().includes('items')) {
      ({ data: inserted, error } = await sb.from('ordini').insert(senzaCirc).select().single());
    }
  }

  if (error || !inserted) {
    toast('Errore invio ordine: ' + (error?.message || 'sconosciuto'));
    console.error(error);
    return;
  }

  // salva righe ordine se la tabella esiste
  try {
    const righe = cart.map(c => ({
      id_ordine: inserted.id,
      id_piatto: c.id || null,
      piatto: c.nome,
      qty_piatti: c.qty,
      prezzo_pagato: Number(c.prezzo) * c.qty
    }));
    await sb.from('ordine_riga').insert(righe);
  } catch (e) { console.warn('ordine_riga skip', e); }

  try {
    if (note) await sb.from('messaggio').insert({ id_ordine: inserted.id, testo: note });
  } catch (e) { console.warn('messaggio skip', e); }

  try {
    await sb.from('pagamento').insert({
      id_ordine: inserted.id,
      metodo: pagamento,
      importo: totale,
      circuito: circuitoPagamento
    });
  } catch (e) { console.warn('pagamento skip', e); }


  await sb.from('tavoli').update({ occupato: true })
    .eq('id_ristorante', currentRistorante.id)
    .eq('numero', currentUser.tavolo);

  lastOrdineId = inserted.id;
  if (!sessionOrders.find(x => x.id === inserted.id)) {
    sessionOrders.push({ id: inserted.id, codice });
  }
  updateClienteOrdiniSelect();

  $('#ricevuta-codice').textContent = codice;
  $('#ricevuta-rist').textContent = currentRistorante.nome;
  $('#ricevuta-tavolo').textContent = currentUser.tavolo;
  $('#ricevuta-ora').textContent = formatTime(inserted.created_at);
  $('#ricevuta-pagamento').textContent = pagamento === 'cassa'
    ? 'Pago in cassa'
    : ('Carta' + (circuitoPagamento ? ' · ' + labelCircuito(circuitoPagamento) : ''));
  $('#ricevuta-totale').textContent = formatPrice(totale);
  $('#ricevuta-stato').textContent = 'Nuovo';
  $('#ricevuta-stato').className = 'badge-stato nuovo';
  if ($('#ricevuta-pag-stato')) {
    $('#ricevuta-pag-stato').textContent = labelPagamentoStato(stato_pagamento);
    $('#ricevuta-pag-stato').className = 'badge-pag ' + stato_pagamento;
  }
  const itemsHtml = cart.map(i => `
    <div class="r-item"><span>${i.qty}× ${i.nome}</span><span>${formatPrice(i.prezzo * i.qty)}</span></div>
  `).join('');
  $('#ricevuta-items').innerHTML = itemsHtml;

  // Salva dati ricevuta per download (solo pagamento carta online)
  window._ultimaRicevuta = {
    codice,
    ristorante: currentRistorante.nome,
    tavolo: currentUser.tavolo,
    ora: formatTime(inserted.created_at),
    pagamento,
    circuito: circuitoPagamento,
    totale,
    items: cart.map(i => ({ qty: i.qty, nome: i.nome, prezzo: i.prezzo })),
    note
  };
  const btnScarica = $('#btn-scarica-ricevuta');
  if (btnScarica) {
    if (pagamento === 'carta') btnScarica.classList.remove('hidden');
    else btnScarica.classList.add('hidden');
  }

  cart = [];
  updateCartCount();
  $('#ordine-note').value = '';
  showClienteView('ricevuta');
  $('#cliente-stato-btn').style.display = 'inline-flex';
  startOrdineStatusPolling();
  toast('Ordine inviato!');
}


function updateClienteOrdiniSelect() {
  const sel = $('#select-ordini-cliente');
  if (!sel) return;
  if (!sessionOrders.length) {
    sel.innerHTML = '<option value="">Nessun ordine</option>';
    return;
  }
  sel.innerHTML = sessionOrders.map(o =>
    `<option value="${o.id}">${o.codice}</option>`
  ).join('');
  if (lastOrdineId) sel.value = lastOrdineId;
}

async function loadClienteOrdineById(ordineId) {
  if (!ordineId || !sb) return;
  lastOrdineId = ordineId;
  saveClientState();
  const { data: o } = await sb.from('ordini').select('*').eq('id', ordineId).single();
  if (!o) { toast('Ordine non trovato'); return; }
  // items da jsonb o ordine_riga
  let items = o.items || [];
  if (!items.length) {
    try {
      const { data: righe } = await sb.from('ordine_riga').select('*').eq('id_ordine', ordineId);
      items = (righe || []).map(r => ({
        nome: r.piatto || r.nome,
        qty: r.qty_piatti || r.qty || 1,
        prezzo: r.prezzo_pagato && (r.qty_piatti || r.qty) ? Number(r.prezzo_pagato) / (r.qty_piatti || r.qty) : 0
      }));
    } catch (e) {}
  }
  $('#ricevuta-codice').textContent = o.codice || '';
  $('#ricevuta-rist').textContent = (currentRistorante && currentRistorante.nome) || '';
  $('#ricevuta-tavolo').textContent = o.tavolo;
  $('#ricevuta-ora').textContent = formatTime(o.created_at || o.createdAt);
  $('#ricevuta-pagamento').textContent = o.pagamento === 'cassa' ? 'Pago in cassa' : 'Carta';
  $('#ricevuta-totale').textContent = formatPrice(o.totale || 0);
  $('#ricevuta-stato').textContent = labelStato(o.stato);
  $('#ricevuta-stato').className = 'badge-stato ' + (o.stato || 'nuovo');
  const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
  if ($('#ricevuta-pag-stato')) {
    $('#ricevuta-pag-stato').textContent = labelPagamentoStato(ps);
    $('#ricevuta-pag-stato').className = 'badge-pag ' + ps;
  }
  $('#ricevuta-items').innerHTML = items.length
    ? items.map(i => `<div class="r-item"><span>${i.qty}× ${i.nome}</span><span>${formatPrice((i.prezzo || 0) * (i.qty || 1))}</span></div>`).join('')
    : '<p style="color:var(--muted)">Dettaglio piatti non disponibile</p>';

  window._ultimaRicevuta = {
    codice: o.codice,
    ristorante: (currentRistorante && currentRistorante.nome) || '',
    tavolo: o.tavolo,
    ora: formatTime(o.created_at || o.createdAt),
    pagamento: o.pagamento,
    totale: o.totale || 0,
    items: items.map(i => ({ qty: i.qty || 1, nome: i.nome, prezzo: i.prezzo || 0 })),
    note: o.note || ''
  };
  const btnScarica = $('#btn-scarica-ricevuta');
  if (btnScarica) {
    if (o.pagamento === 'carta') btnScarica.classList.remove('hidden');
    else btnScarica.classList.add('hidden');
  }

  showClienteView('ricevuta');
  startOrdineStatusPolling();
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'select-ordini-cliente') {
    const id = e.target.value;
    if (id) loadClienteOrdineById(id);
  }
});


let _statusPoll = null;
let _lastKnownStato = null;

function stopOrdineStatusPolling() {
  if (_statusPoll) { clearInterval(_statusPoll); _statusPoll = null; }
}

function applyOrdineStatusUI(o) {
  if (!o) return;
  const stato = o.stato || 'nuovo';
  const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
  if ($('#ricevuta-stato')) {
    $('#ricevuta-stato').textContent = labelStato(stato);
    $('#ricevuta-stato').className = 'badge-stato ' + stato;
  }
  if ($('#ricevuta-pag-stato')) {
    $('#ricevuta-pag-stato').textContent = labelPagamentoStato(ps);
    $('#ricevuta-pag-stato').className = 'badge-pag ' + ps;
  }
  // timeline se visibile
  const tl = $('#stato-timeline');
  if (tl && !$('#cliente-stato-view')?.classList.contains('hidden')) {
    const steps = ['nuovo', 'in_preparazione', 'pronto', 'consegnato'];
    const idx = steps.indexOf(stato);
    tl.innerHTML = steps.map((s, i) => {
      let cls = '';
      if (i < idx) cls = 'done';
      else if (i === idx) cls = 'active';
      return `<div class="stato-step ${cls}"><div class="dot"></div><span>${labelStato(s)}</span></div>`;
    }).join('');
  }
  if (_lastKnownStato && _lastKnownStato !== stato) {
    toast('Stato ordine: ' + labelStato(stato));
  }
  _lastKnownStato = stato;

  // Conto chiuso / consegnato: togli dalla sessione e torna al menu (nuovo cliente al tavolo)
  if (!isOrdineAncoraAperto(stato) && currentUser && currentUser.fromQR) {
    sessionOrders = sessionOrders.filter(x => x.id !== (lastOrdineId));
    if (!sessionOrders.length) {
      lastOrdineId = null;
      clearClientState(currentUser.ristoranteId, currentUser.tavolo);
      if ($('#cliente-stato-btn')) $('#cliente-stato-btn').style.display = 'none';
      stopOrdineStatusPolling();
      // non forzare il menu se l'utente sta ancora guardando la ricevuta del "grazie":
      // solo al prossimo scan QR vedrà il menu pulito. Se vuole ordinare ancora, "Ordina ancora" resta.
    } else {
      lastOrdineId = sessionOrders[sessionOrders.length - 1].id;
      saveClientState();
      updateClienteOrdiniSelect();
    }
  }
}

function startOrdineStatusPolling() {
  stopOrdineStatusPolling();
  _lastKnownStato = null;
  const tick = async () => {
    if (!lastOrdineId || !sb) return;
    try {
      const { data: o } = await sb.from('ordini').select('*').eq('id', lastOrdineId).single();
      if (o) applyOrdineStatusUI(o);
    } catch (e) { console.warn('poll stato', e); }
  };
  tick();
  _statusPoll = setInterval(tick, 4000);
}

// Bottone aggiorna tenuto come opzionale ma non necessario
$('#btn-aggiorna-stato')?.addEventListener('click', async () => {
  if (!lastOrdineId || !sb) return;
  const { data: o } = await sb.from('ordini').select('*').eq('id', lastOrdineId).single();
  if (o) applyOrdineStatusUI(o);
});

$('#btn-nuovo-ordine')?.addEventListener('click', () => {
  cart = [];
  updateCartCount();
  showClienteView('menu');
  renderClienteMenu();
});

$('#cliente-stato-btn')?.addEventListener('click', async () => {
  if (!lastOrdineId) return;
  const { data: o } = await sb.from('ordini').select('*').eq('id', lastOrdineId).single();
  if (!o) return;
  $('#stato-codice').textContent = o.codice;
  const steps = ['nuovo', 'in_preparazione', 'pronto', 'consegnato'];
  const idx = steps.indexOf(o.stato);
  $('#stato-timeline').innerHTML = steps.map((s, i) => {
    let cls = '';
    if (i < idx) cls = 'done';
    else if (i === idx) cls = 'active';
    return `<div class="stato-step ${cls}"><div class="dot"></div><span>${labelStato(s)}</span></div>`;
  }).join('');
  showClienteView('stato');
});

$('#btn-torna-da-stato')?.addEventListener('click', () => {
  showClienteView('menu');
  renderClienteMenu();
});

$('#btn-indietro-stato')?.addEventListener('click', () => {
  if (lastOrdineId) showClienteView('ricevuta');
  else {
    showClienteView('menu');
    renderClienteMenu();
  }
});



// =====================================================
// RESET PASSWORD RISTORATORE
// =====================================================
/* crea admin rimosso: solo da Supabase */

window.apriResetPassword = async function(id) {
  if (!sb) { toast('Database non collegato'); return; }
  const { data: r } = await sb.from('ristoranti').select('*').eq('id', id).single();
  if (!r) return;
  $('#reset-pass-rist-id').value = r.id;
  $('#reset-pass-email').value = r.email;
  $('#reset-pass-nome').value = r.nome + ' (' + r.email + ')';
  $('#reset-pass-value').value = '';
  $('#modal-reset-pass').classList.remove('hidden');
};

$('#btn-genera-pass')?.addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  $('#reset-pass-value').value = s;
});

$('#form-reset-pass')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) { toast('Database non collegato'); return; }
  const id = $('#reset-pass-rist-id').value;
  const email = $('#reset-pass-email').value;
  const nuova = ($('#reset-pass-value')?.value || '').trim();
  if (!nuova || nuova.length < 4) { toast('Password troppo corta'); return; }

  const { error: e1 } = await sb.from('ristoranti').update({ password: nuova }).eq('id', id);
  if (e1) { toast('Errore ristoranti: ' + e1.message); return; }

  const { data: u } = await sb.from('utenti').select('id').eq('email', email).maybeSingle();
  if (u) {
    await sb.from('utenti').update({ password_hash: nuova }).eq('id', u.id);
  } else {
    await sb.from('utenti').insert({
      email,
      password_hash: nuova,
      ruolo: 'ristoratore',
      nome: $('#reset-pass-nome').value
    });
  }

  $('#modal-reset-pass').classList.add('hidden');
  toast('Nuova password salvata: ' + nuova);
});

// =====================================================
// AVVIO: se c'è ?r=...&t=... apri come cliente (QR)
// =====================================================
// =====================================================
// AVVIO 1: QR cliente (?r=...&t=...)
// =====================================================

// =====================================================
// SESSIONE QR (scade dopo 30 minuti → riscansione)
// Ogni apertura del link QR rinnova i 30 minuti.
// =====================================================
function qrExpKey(r, t) {
  return 'menupro_qr_exp_' + r + '_' + t;
}

function renewQrSession(r, t, force = false) {
  // force=true solo se vuoi ripartire da 30 min (es. sessione già scaduta)
  // Al refresh della pagina NON si rinnova: resta il tempo rimanente.
  try {
    if (!force) {
      const existing = parseInt(sessionStorage.getItem(qrExpKey(r, t)) || '0', 10);
      if (existing > Date.now()) return existing;
    }
  } catch (e) {}
  const exp = Date.now() + QR_SESSION_MS;
  try { sessionStorage.setItem(qrExpKey(r, t), String(exp)); } catch (e) {}
  return exp;
}

function getQrExpiresAt(r, t) {
  try {
    const v = parseInt(sessionStorage.getItem(qrExpKey(r, t)) || '0', 10);
    return v || 0;
  } catch (e) { return 0; }
}

function isQrSessionValid() {
  if (!currentUser || currentUser.role !== 'cliente') return true;
  // demo admin senza fromQR: nessun limite
  if (!currentUser.fromQR) return true;
  const exp = getQrExpiresAt(currentUser.ristoranteId, currentUser.tavolo);
  return exp > Date.now();
}

function minutiQrRimanenti() {
  if (!currentUser || !currentUser.fromQR) return null;
  const exp = getQrExpiresAt(currentUser.ristoranteId, currentUser.tavolo);
  const ms = exp - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 60000);
}

function updateQrSessionUI() {
  const banner = document.getElementById('qr-session-banner');
  const overlay = document.getElementById('qr-expired-overlay');
  const timerEl = document.getElementById('qr-session-timer');
  if (!currentUser || !currentUser.fromQR) {
    if (banner) banner.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
    return;
  }
  const valid = isQrSessionValid();
  const min = minutiQrRimanenti();
  if (timerEl && min !== null) {
    timerEl.textContent = valid
      ? (min <= 1 ? 'meno di 1 min' : min + ' min')
      : 'scaduta';
  }
  if (banner) {
    banner.classList.toggle('hidden', !valid);
    banner.classList.toggle('qr-session-warn', valid && min !== null && min <= 5);
  }
  if (overlay) {
    overlay.classList.toggle('hidden', valid);
  }
  // disabilita invio ordine se scaduto
  const btn = document.getElementById('btn-invia-ordine');
  if (btn) {
    btn.disabled = !valid;
    btn.title = valid ? '' : 'Sessione scaduta: riscansione il QR sul tavolo';
  }
}

function startQrSessionWatch() {
  if (_qrExpireTimer) clearInterval(_qrExpireTimer);
  updateQrSessionUI();
  _qrExpireTimer = setInterval(() => {
    updateQrSessionUI();
    if (currentUser && currentUser.fromQR && !isQrSessionValid()) {
      // lascia l'overlay visibile; ferma solo se non serve più
    }
  }, 15000);
}

function assertQrSessionOrBlock() {
  if (isQrSessionValid()) return true;
  updateQrSessionUI();
  toast('Sessione scaduta. Riscansiona il QR sul tavolo per ordinare di nuovo.');
  return false;
}

(async function initFromQR() {
  const params = new URLSearchParams(window.location.search);
  const rId = params.get('r');
  const t = parseInt(params.get('t'), 10);
  if (!rId || !t) return;

  document.documentElement.classList.add('qr-entry');
  const login = $('#login-screen');
  const appC = $('#app-cliente');
  if (login) login.classList.add('hidden');
  if (appC) { appC.classList.remove('hidden'); appC.classList.add('cliente-ui'); }
  document.body.classList.add('cliente-night');
  try { updateNetworkStatus(); } catch (e) {}

  try {
    let r = null;
    if (sb) r = await loadRistoranteFull(rId);
    if (!r) { toast('Ristorante non trovato o database non collegato'); return; }

    currentUser = { role: 'cliente', ristoranteId: rId, tavolo: t, fromQR: true };
    currentRistorante = r;

    // Prima scansione / sessione scaduta → 30 min; refresh → tiene il tempo rimasto
    renewQrSession(rId, t);
    startQrSessionWatch();

    // ripristina carrello e ordini già fatti a questo tavolo
    const saved = loadClientState(rId, t);
    sessionOrders = saved.orders || [];
    cart = saved.cart || [];
    lastOrdineId = saved.last || null;

    // Se il conto è stato chiuso, non mostrare più la ricevuta del vecchio ordine
    const synced = await syncClientSessionConDb(rId, t);
    sessionOrders = synced.activeOrders || [];
    lastOrdineId = synced.lastActiveId || null;
    if (!sessionOrders.length) {
      lastOrdineId = null;
      // tavolo libero: reset sessione locale (evita ricevuta fantasma)
      clearClientState(rId, t);
      cart = cart || []; // tiene solo un eventuale carrello non inviato
    }
    saveClientState();

    if ($('#cliente-rist-nome')) $('#cliente-rist-nome').textContent = r.nome;
    if ($('#cliente-tavolo-num')) $('#cliente-tavolo-num').textContent = t;
    await refreshCircuitiUI();

    if (sessionOrders.length) {
      updateClienteOrdiniSelect();
      $('#cliente-stato-btn').style.display = 'inline-flex';
    } else {
      updateClienteOrdiniSelect();
      if ($('#cliente-stato-btn')) $('#cliente-stato-btn').style.display = 'none';
    }
    updateCartCount();

    // Mostra ricevuta solo se c'è ancora un ordine APERTO a questo tavolo
    if (!cart.length && lastOrdineId) {
      await loadClienteOrdineById(lastOrdineId);
    } else {
      showClienteView('menu');
      renderClienteMenu();
    }
  } catch (e) {
    console.error('QR init error:', e);
    toast('Errore apertura menu da QR');
  }
})();

// =====================================================
// AVVIO 2: ripristino sessione admin / ristoratore
// =====================================================
(async function restoreSession() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('r') && p.get('t')) return; // è un cliente da QR
  const s = loadSession();
  if (!s) return;

  const login = $('#login-screen');
  login.classList.add('hidden'); // evita il lampo della schermata di login

  try {
    if (s.role === 'admin') {
      await enterAsAdmin(s.email);
      if (s.page && s.page !== 'dashboard')
        document.querySelector('#app-admin .nav-item[data-page="' + s.page + '"]')?.click();
      return;
    }
    if (s.role === 'ristoratore') {
      const r = await getRistorante(s.ristoranteId);
      if (!r) throw new Error('Ristorante non trovato');
      await enterAsRistoratore({ id: r.id, email: s.email, nome: r.nome });
      if (s.page && s.page !== 'rist-dashboard')
        document.querySelector('#app-ristoratore .nav-item[data-page="' + s.page + '"]')?.click();
      return;
    }
    if (s.role === 'cassa') {
      const { data: u } = sb
        ? await sb.from('utenti').select('*').eq('email', s.email).eq('ruolo', 'cassa').maybeSingle()
        : { data: null };
      if (!u) throw new Error('Cassa non trovata');
      // allinea id_ristorante dalla sessione se manca sull'utente
      if (!u.id_ristorante && s.ristoranteId) u.id_ristorante = s.ristoranteId;
      await enterAsCassa(u);
      if (s.page && CASSA_PAGES.has(s.page)) {
        document.querySelector('#app-ristoratore .nav-item[data-page="' + s.page + '"]')?.click();
      }
      return;
    }
  } catch (e) {
    console.error('Ripristino sessione fallito:', e);
  }
  // se sei offline NON cancellare la sessione, altrimenti il refresh ti sloggherebbe
  if (navigator.onLine) clearSession();
  login.classList.remove('hidden');
})();
async function syncOfflineOrders() {
  if (!navigator.onLine || !sb) return;
  let orders = [];
  try { orders = JSON.parse(localStorage.getItem("offline_orders") || "[]"); } catch (e) {}
  if (!orders.length) return;

  const rimasti = [];
  let inviati = 0;
  for (const order of orders) {
    const items = order.items || [];
    let { data: ins, error } = await sb.from('ordini').insert(order).select().single();
    if (error && String(error.message || '').toLowerCase().includes('items')) {
      const { items: _omit, ...senzaItems } = order;
      ({ data: ins, error } = await sb.from('ordini').insert(senzaItems).select().single());
    }
    if (error || !ins) { console.error(error); rimasti.push(order); continue; }
    inviati++;
    try {
      if (items.length) await sb.from('ordine_riga').insert(items.map(c => ({
        id_ordine: ins.id, id_piatto: c.id || null, piatto: c.nome,
        qty_piatti: c.qty, prezzo_pagato: Number(c.prezzo) * c.qty
      })));
    } catch (e) { console.warn('ordine_riga sync', e); }
    try {
      await sb.from('tavoli').update({ occupato: true })
        .eq('id_ristorante', order.id_ristorante).eq('numero', order.tavolo);
    } catch (e) {}
  }
  // tieni in coda solo quelli non inviati (nessuna perdita, nessun duplicato)
  if (rimasti.length) localStorage.setItem("offline_orders", JSON.stringify(rimasti));
  else localStorage.removeItem("offline_orders");
  if (inviati) toast(inviati + (inviati === 1 ? " ordine sincronizzato" : " ordini sincronizzati"));
}

window.addEventListener("online", () => {
  // toast solo per admin/ristoratore, non per il cliente al tavolo
  const isCliente = currentUser && currentUser.role === 'cliente';
  if (!isCliente) toast("Connessione ripristinata");
  syncOfflineOrders();
});
function isClienteUI() {
  return !!(currentUser && currentUser.role === 'cliente')
    || document.body.classList.contains('cliente-night')
    || document.documentElement.classList.contains('qr-entry');
}
function updateNetworkStatus() {
  const el = document.getElementById("network-status");
  if (!el) return;
  // Interfaccia cliente: niente indicatore online/offline
  if (isClienteUI()) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  if (navigator.onLine) {
    el.innerHTML = "🟢 Online";
  } else {
    el.innerHTML = "🔴 Offline - salvataggio locale attivo";
  }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

updateNetworkStatus();

// =====================================================
// SCARICA RICEVUTA (cliente – solo pagamento carta)
// =====================================================
function buildRicevutaHtml(r) {
  if (!r) return '';
  const rows = (r.items || []).map(i =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #ddd">
      <span>${i.qty}× ${i.nome}</span><span>${formatPrice(i.prezzo * i.qty)}</span>
    </div>`
  ).join('');
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><title>Ricevuta ${r.codice}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:24px auto;padding:16px;color:#111}
  h1{font-size:20px;margin:0 0 4px} .ok{color:#16a34a;font-size:28px;text-align:center}
  .meta{color:#555;font-size:14px;margin:12px 0;padding:12px 0;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc}
  .tot{display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:12px}
  .foot{margin-top:20px;font-size:12px;color:#888;text-align:center}
</style></head><body>
  <div class="ok">✓</div>
  <h1 style="text-align:center">Ricevuta ordine</h1>
  <p style="text-align:center;margin:0"><strong>${r.codice}</strong></p>
  <div class="meta">
    <div><strong>${r.ristorante || ''}</strong></div>
    <div>Tavolo ${r.tavolo} · ${r.ora || ''}</div>
    <div>Pagamento: Carta (online)${r.circuito ? ' · ' + labelCircuito(r.circuito) : ''}</div>
    ${r.note ? '<div>Note: ' + r.note + '</div>' : ''}
  </div>
  ${rows}
  <div class="tot"><span>Totale</span><span>${formatPrice(r.totale)}</span></div>
  <p class="foot">Pagamento effettuato con carta · MenuPro</p>
</body></html>`;
}

function scaricaRicevuta() {
  const r = window._ultimaRicevuta;
  if (!r || r.pagamento !== 'carta') {
    toast('Ricevuta disponibile solo per pagamenti con carta');
    return;
  }
  const html = buildRicevutaHtml(r);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ricevuta-' + (r.codice || 'ordine') + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Ricevuta scaricata');
}

$('#btn-scarica-ricevuta')?.addEventListener('click', scaricaRicevuta);

// =====================================================
// STAMPA COMANDE (ristoratore – tutte le comande attive)
// =====================================================
function buildComandaTicket(o) {
  const items = (o.items || []).map(i =>
    `<li><span class="cqty">${i.qty || 1}×</span> <span class="cname">${i.nome || i.piatto || 'Piatto'}</span></li>`
  ).join('') || '<li>—</li>';
  const pag = o.pagamento === 'cassa' ? 'CASSA' : (o.pagamento === 'carta' ? 'CARTA' : (o.pagamento || '—'));
  const ps = o.stato_pagamento || defaultPagStato(o.pagamento);
  const nomeRist = (currentRistorante && currentRistorante.nome) ? currentRistorante.nome : '';
  return `
    <div class="comanda-ticket">
      <div class="comanda-cut">✂ — — — taglia qui — — —</div>
      <div class="comanda-body">
        <div class="comanda-brand">${nomeRist}</div>
        <div class="comanda-title">COMANDA</div>
        <div class="comanda-head">
          <span class="comanda-tavolo">Tavolo ${o.tavolo}</span>
          <span class="comanda-codice">#${o.codice || ''}</span>
        </div>
        <div class="meta">
          ${formatTime(o.createdAt || o.created_at)} · ${labelStato(o.stato)}
        </div>
        <div class="meta meta-pag">Pag: ${pag} (${labelPagamentoStato(ps)})</div>
        <div class="comanda-sep">························</div>
        <ul>${items}</ul>
        ${o.note ? '<div class="note">Note: ' + o.note + '</div>' : ''}
        <div class="comanda-sep">························</div>
        <div class="tot">TOTALE ${formatPrice(o.totale || 0)}</div>
      </div>
    </div>`;
}

async function stampaComande() {
  if (!currentRistorante) { toast('Nessun ristorante selezionato'); return; }
  // ricarica dati freschi
  currentRistorante = await loadRistoranteFull(currentRistorante.id);
  const ordini = (currentRistorante.ordini || []).filter(o =>
    o.stato === 'nuovo' || o.stato === 'in_preparazione' || o.stato === 'pronto'
  );
  if (!ordini.length) {
    toast('Nessuna comanda da stampare');
    return;
  }

  // assicura items se mancanti
  for (const o of ordini) {
    if (!(o.items && o.items.length) && sb) {
      try {
        const { data: righe } = await sb.from('ordine_riga').select('*').eq('id_ordine', o.id);
        if (righe && righe.length) {
          o.items = righe.map(row => ({
            nome: row.piatto || row.nome || 'Piatto',
            qty: row.qty_piatti || row.qty || 1,
            prezzo: 0
          }));
        }
      } catch (e) {}
    }
  }

  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  // Una comanda = uno scontrino separato (tagliabile / page-break)
  area.innerHTML = ordini.map(buildComandaTicket).join('');
  area.classList.add('printing');
  const cleanup = () => {
    area.classList.remove('printing');
    area.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    window.print();
    // fallback se afterprint non arriva
    setTimeout(cleanup, 1500);
  }, 100);
}

document.getElementById('btn-stampa-comande')?.addEventListener('click', () => {
  stampaComande();
});
