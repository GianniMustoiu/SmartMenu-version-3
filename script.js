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
  standard: { nome: 'Standard', prezzo: 159, periodo: 'anno', maxCasse: 1 },
  pro: { nome: 'Pro', prezzo: 189, periodo: 'anno', maxCasse: Infinity },
  // alias legacy (vecchi record in DB)
  base: { nome: 'Standard', prezzo: 159, periodo: 'anno', maxCasse: 1 },
  enterprise: { nome: 'Pro', prezzo: 189, periodo: 'anno', maxCasse: Infinity }
};

function normalizzaPiano(id) {
  if (id === 'base' || id === 'standard') return 'standard';
  if (id === 'enterprise' || id === 'pro') return 'pro';
  return id === 'pro' ? 'pro' : 'standard';
}

function maxCassePerPiano(id) {
  const p = PIANI[normalizzaPiano(id)] || PIANI.standard;
  return p.maxCasse;
}

function updateRistSidebarAbbonamento(r) {
  const el = document.getElementById('rist-piano-sidebar');
  if (!el) return;
  const rist = r || currentRistorante;
  if (!rist) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  const pianoId = normalizzaPiano(rist.id_piano);
  const piano = PIANI[pianoId] || PIANI.standard;
  const prezzo = piano.prezzo != null ? piano.prezzo : 0;
  const periodo = piano.periodo === 'anno' ? '/anno' : '/mese';
  let scaduto = false;
  if (rist.scadenza) {
    const d = new Date(rist.scadenza);
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    if (!isNaN(d.getTime()) && d < oggi) scaduto = true;
  }
  el.className = 'rist-piano-badge piano-' + (scaduto ? 'scaduto' : pianoId);
  el.classList.remove('hidden');
  const label = scaduto
    ? ('Scaduto · era ' + (piano.nome || pianoId))
    : ((piano.nome || pianoId) + ' · €' + prezzo + periodo);
  el.innerHTML = '<i class="fas fa-crown" style="font-size:10px"></i> ' + label;
  if (rist.scadenza && !scaduto) {
    el.title = 'Scade il ' + formatDataItLong(rist.scadenza);
  } else if (scaduto && rist.scadenza) {
    el.title = 'Scaduto il ' + formatDataItLong(rist.scadenza);
  } else {
    el.title = 'Abbonamento ' + (piano.nome || pianoId);
  }
}


const LANGS = ['it', 'en', 'es', 'de', 'fr', 'zh'];
let clienteLang = 'it';
let currentMenuId = null;

const UI_I18N = {
  it: {
    cart: 'Carrello', stato: 'Stato ordine', totale: 'Totale', note: 'Messaggio / richieste (es. togli formaggio)',
    notePh: 'Allergie, modifiche, richieste speciali...',
    paga: 'Metodo di pagamento', invia: 'Invia ordine', menu: 'Menu', aggiungi: 'Aggiungi',
    scelto: 'Cosa hai scelto', vuoto: 'Il carrello è vuoto.', tavolo: 'Tavolo',
    carta: 'Carta', cassa: 'Pago in cassa', indietro: 'Indietro',
    ricevuta: 'Ricevuta ordine', pagamento: 'Pagamento', codice: 'Codice',
    sessione: 'Sessione attiva · scade tra', sessioneScaduta: 'Sessione scaduta',
    sessioneHint: 'Per sicurezza puoi ordinare solo entro 30 minuti dalla scansione del QR.',
    riscansione: 'Inquadra di nuovo il codice QR sul tavolo per continuare.',
    ordiniValidi: 'Gli ordini già inviati restano validi: il ristorante li vede comunque.',
    tutti: 'Tutti', nessunPiatto: 'Nessun piatto disponibile.',
    aPunto: 'A che punto è il tuo ordine', tornaMenu: 'Torna al menu',
    scaricaRicevuta: 'Scarica ricevuta'
  },
  en: {
    cart: 'Cart', stato: 'Order status', totale: 'Total', note: 'Notes / requests (e.g. no cheese)',
    notePh: 'Allergies, changes, special requests...',
    paga: 'Payment method', invia: 'Place order', menu: 'Menu', aggiungi: 'Add',
    scelto: 'Your selection', vuoto: 'Your cart is empty.', tavolo: 'Table',
    carta: 'Card', cassa: 'Pay at counter', indietro: 'Back',
    ricevuta: 'Order receipt', pagamento: 'Payment', codice: 'Code',
    sessione: 'Session active · expires in', sessioneScaduta: 'Session expired',
    sessioneHint: 'For security you can only order within 30 minutes of scanning the QR.',
    riscansione: 'Scan the table QR code again to continue.',
    ordiniValidi: 'Orders already sent remain valid: the restaurant still sees them.',
    tutti: 'All', nessunPiatto: 'No dishes available.',
    aPunto: 'Where is your order', tornaMenu: 'Back to menu',
    scaricaRicevuta: 'Download receipt'
  },
  es: {
    cart: 'Carrito', stato: 'Estado del pedido', totale: 'Total', note: 'Notas / peticiones (ej. sin queso)',
    notePh: 'Alergias, cambios, peticiones especiales...',
    paga: 'Método de pago', invia: 'Enviar pedido', menu: 'Menú', aggiungi: 'Añadir',
    scelto: 'Tu selección', vuoto: 'El carrito está vacío.', tavolo: 'Mesa',
    carta: 'Tarjeta', cassa: 'Pago en caja', indietro: 'Atrás',
    ricevuta: 'Recibo del pedido', pagamento: 'Pago', codice: 'Código',
    sessione: 'Sesión activa · caduca en', sessioneScaduta: 'Sesión caducada',
    sessioneHint: 'Por seguridad solo puedes pedir en los 30 minutos tras escanear el QR.',
    riscansione: 'Escanea de nuevo el código QR de la mesa para continuar.',
    ordiniValidi: 'Los pedidos ya enviados siguen siendo válidos.',
    tutti: 'Todos', nessunPiatto: 'No hay platos disponibles.',
    aPunto: 'Estado de tu pedido', tornaMenu: 'Volver al menú',
    scaricaRicevuta: 'Descargar recibo'
  },
  de: {
    cart: 'Warenkorb', stato: 'Bestellstatus', totale: 'Gesamt', note: 'Hinweise / Wünsche (z.B. ohne Käse)',
    notePh: 'Allergien, Änderungen, Sonderwünsche...',
    paga: 'Zahlungsart', invia: 'Bestellung senden', menu: 'Menü', aggiungi: 'Hinzufügen',
    scelto: 'Ihre Auswahl', vuoto: 'Der Warenkorb ist leer.', tavolo: 'Tisch',
    carta: 'Karte', cassa: 'An der Kasse zahlen', indietro: 'Zurück',
    ricevuta: 'Bestellbeleg', pagamento: 'Zahlung', codice: 'Code',
    sessione: 'Sitzung aktiv · endet in', sessioneScaduta: 'Sitzung abgelaufen',
    sessioneHint: 'Aus Sicherheitsgründen können Sie nur 30 Minuten nach dem QR-Scan bestellen.',
    riscansione: 'Scannen Sie den QR-Code am Tisch erneut.',
    ordiniValidi: 'Bereits gesendete Bestellungen bleiben gültig.',
    tutti: 'Alle', nessunPiatto: 'Keine Gerichte verfügbar.',
    aPunto: 'Status Ihrer Bestellung', tornaMenu: 'Zurück zum Menü',
    scaricaRicevuta: 'Beleg herunterladen'
  },
  fr: {
    cart: 'Panier', stato: 'État de la commande', totale: 'Total', note: 'Notes / demandes (ex. sans fromage)',
    notePh: 'Allergies, modifications, demandes spéciales...',
    paga: 'Mode de paiement', invia: 'Envoyer la commande', menu: 'Menu', aggiungi: 'Ajouter',
    scelto: 'Votre sélection', vuoto: 'Le panier est vide.', tavolo: 'Table',
    carta: 'Carte', cassa: 'Payer au comptoir', indietro: 'Retour',
    ricevuta: 'Reçu de commande', pagamento: 'Paiement', codice: 'Code',
    sessione: 'Session active · expire dans', sessioneScaduta: 'Session expirée',
    sessioneHint: 'Pour votre sécurité, commande possible uniquement dans les 30 minutes après le QR.',
    riscansione: 'Scannez à nouveau le QR de la table pour continuer.',
    ordiniValidi: 'Les commandes déjà envoyées restent valides.',
    tutti: 'Tous', nessunPiatto: 'Aucun plat disponible.',
    aPunto: 'Où en est votre commande', tornaMenu: 'Retour au menu',
    scaricaRicevuta: 'Télécharger le reçu'
  },
  zh: {
    cart: '购物车', stato: '订单状态', totale: '合计', note: '备注 / 要求（例如不要芝士）',
    notePh: '过敏、修改、特殊要求...',
    paga: '支付方式', invia: '提交订单', menu: '菜单', aggiungi: '添加',
    scelto: '已选菜品', vuoto: '购物车是空的。', tavolo: '桌号',
    carta: '银行卡', cassa: '到柜台付款', indietro: '返回',
    ricevuta: '订单收据', pagamento: '支付', codice: '编号',
    sessione: '会话有效 · 剩余', sessioneScaduta: '会话已过期',
    sessioneHint: '为安全起见，扫码后 30 分钟内可下单。',
    riscansione: '请重新扫描桌上的二维码继续。',
    ordiniValidi: '已提交的订单仍然有效。',
    tutti: '全部', nessunPiatto: '暂无菜品。',
    aPunto: '订单进度', tornaMenu: '返回菜单',
    scaricaRicevuta: '下载收据'
  }
};

function tUI(key) {
  const pack = UI_I18N[clienteLang] || UI_I18N.it;
  return pack[key] || UI_I18N.it[key] || key;
}

function piattoLabel(p, field) {
  // field: 'nome' | 'descrizione'
  if (!p) return '';
  if (clienteLang === 'it') return p[field] || '';
  const tr = p.traduzioni || {};
  const lang = tr[clienteLang] || {};
  return lang[field] || p[field] || '';
}

function menusStorageKey(rid) {
  return 'menupro_menus_' + rid;
}

function loadMenusLocal(rid) {
  try {
    const v = JSON.parse(localStorage.getItem(menusStorageKey(rid)) || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}
  return null;
}

function saveMenusLocal(rid, menus) {
  try {
    localStorage.setItem(menusStorageKey(rid), JSON.stringify(menus || []));
  } catch (e) {}
}

function ensureMenus(r) {
  if (!r) return [{ id: 'default', nome: 'Menu principale' }];
  if (Array.isArray(r.menus) && r.menus.length) {
    saveMenusLocal(r.id, r.menus);
    return r.menus;
  }
  const local = r.id ? loadMenusLocal(r.id) : null;
  if (local && local.length) {
    r.menus = local;
    return r.menus;
  }
  r.menus = [{ id: 'default', nome: 'Menu principale' }];
  if (r.id) saveMenusLocal(r.id, r.menus);
  return r.menus;
}

function getCurrentMenuId(r) {
  const menus = ensureMenus(r);
  if (currentMenuId && menus.some(m => String(m.id) === String(currentMenuId))) {
    return currentMenuId;
  }
  currentMenuId = menus[0].id;
  return currentMenuId;
}

function menuPubblicoStorageKey(rid) {
  return 'menupro_menu_pubblico_' + rid;
}

/** Menu che vedono i clienti dopo il QR */
function getMenuPubblicoId(r) {
  if (!r) return 'default';
  const menus = ensureMenus(r);
  let id = r.menu_pubblico_id;
  if (!id && r.id) {
    try { id = localStorage.getItem(menuPubblicoStorageKey(r.id)); } catch (e) {}
  }
  if (id && menus.some(m => String(m.id) === String(id))) return String(id);
  // fallback: primo menu
  return String(menus[0].id);
}

async function setMenuPubblicoId(r, menuId, { silent } = {}) {
  if (!r || !menuId) return;
  const menus = ensureMenus(r);
  if (!menus.some(m => String(m.id) === String(menuId))) return;
  r.menu_pubblico_id = String(menuId);
  try { localStorage.setItem(menuPubblicoStorageKey(r.id), String(menuId)); } catch (e) {}
  try { cacheSet('rist_' + r.id, stripSecrets(r)); } catch (e) {}
  if (sb) {
    const { error } = await sb.from('ristoranti').update({ menu_pubblico_id: String(menuId) }).eq('id', r.id);
    if (error) console.warn('menu_pubblico_id non salvato su DB:', error.message || error);
  }
  const nome = (menus.find(m => String(m.id) === String(menuId)) || {}).nome || menuId;
  if (!silent) toast('Clienti QR: menu «' + nome + '»');
  // sincronizza eventuali select UI
  populateMenuPubblicoSelects();
}

function piattiDelMenu(r, menuId) {
  const all = (r && r.menu) || [];
  const mid = String(menuId || getCurrentMenuId(r));
  return all.filter(p => {
    const pid = String(p.id_menu || 'default');
    return pid === mid;
  });
}

function uidMenu() {
  return 'm_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36));
}


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
    allergeni: p.allergeni || [],
    traduzioni: p.traduzioni || {},
    id_menu: p.id_menu || 'default'
  }));
  r.menus = Array.isArray(r.menus) && r.menus.length
    ? r.menus
    : (loadMenusLocal(r.id) || [{ id: 'default', nome: 'Menu principale' }]);
  if (!r.menu_pubblico_id) {
    try {
      const mp = localStorage.getItem(menuPubblicoStorageKey(r.id));
      if (mp) r.menu_pubblico_id = mp;
    } catch (e) {}
  }
  if (!r.menu_pubblico_id) r.menu_pubblico_id = (r.menus[0] && r.menus[0].id) || 'default';
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
  try { updateRistSidebarAbbonamento(currentRistorante); } catch (e) {}
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
  try { updateRistSidebarAbbonamento(currentRistorante); } catch (e) {}
  updateRistSidebarAbbonamento(currentRistorante || r);
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
  try { updateRistSidebarAbbonamento(currentRistorante); } catch (e) {}
  updateRistSidebarAbbonamento(r);
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
      'rist-loyalty': 'Loyalty card',
      'rist-chiusura': 'Chiusura fiscale'
    };
    $('#rist-page-title').textContent = titles[page] || page;
    if (page === 'rist-dashboard') await renderRistDashboard();
    if (page === 'rist-menu') await renderMenuTable();
    if (page === 'rist-ordini') await renderOrdiniKanban();
    if (page === 'rist-tavoli') await renderTavoli();
    if (page === 'rist-loyalty') await renderLoyaltyAdmin();
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
      <td><span class="badge badge-${normalizzaPiano(r.id_piano)}">${(PIANI[normalizzaPiano(r.id_piano)]||{}).nome || r.id_piano}</span></td>
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
  d.setFullYear(d.getFullYear() + 1);
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
async function createCasse(ristoranteId, nomeRist, nCasse, passwordDefault = 'cassa123', pianoId) {
  let n = Math.max(0, Math.min(50, parseInt(nCasse) || 0));
  const maxC = maxCassePerPiano(pianoId || currentRistorante?.id_piano);
  if (Number.isFinite(maxC) && n > maxC) n = maxC;
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
    id_piano: normalizzaPiano($('#id_piano').value),
    pagamenti_accettati: $('#metodi_pagamento')?.value || 'entrambi',
    scadenza: $('#scadenza').value || null,
    sale,
    indirizzo_fatturazione: ($('#indirizzo_fatturazione')?.value || '').trim() || null,
    piva: ($('#piva_rist')?.value || '').trim().replace(/\s/g, '') || null,
    pec: ($('#pec_rist')?.value || '').trim() || null
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
    let nCasseEdit = parseInt($('#n_casse')?.value) || 0;
    const maxCEdit = maxCassePerPiano(data.id_piano);
    if (Number.isFinite(maxCEdit) && nCasseEdit > maxCEdit) {
      toast(`Piano Standard: massimo ${maxCEdit} cassa.`);
      nCasseEdit = maxCEdit;
    }
    if (nCasseEdit > 0) {
      const emailsCasse = await createCasse(id, nomeRist, nCasseEdit, 'cassa123', data.id_piano);
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

    let inserted, error;
    ({ data: inserted, error } = await sb.from('ristoranti').insert({
      ...data,
      password: password || null
    }).select().single());

    if (error && /column|piva|pec|indirizzo|ultimo_numero/i.test(String(error.message || ''))) {
      const { piva, pec, indirizzo_fatturazione, ultimo_numero_fattura, ...base } = data;
      ({ data: inserted, error } = await sb.from('ristoranti').insert({
        ...base,
        password: password || null
      }).select().single());
      if (!error) toast('Ristorante creato (dati fiscali non salvati: aggiungi le colonne in Supabase)');
    }

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

    let nCasse = parseInt($('#n_casse')?.value) || 0;
    const maxC = maxCassePerPiano(data.id_piano);
    if (Number.isFinite(maxC) && nCasse > maxC) {
      toast(`Piano Standard: massimo ${maxC} cassa. Verrà creata solo 1 cassa.`);
      nCasse = maxC;
    }
    if (nCasse > 0) {
      const emailsCasse = await createCasse(inserted.id, nomeRist, nCasse, 'cassa123', data.id_piano);
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
  if ($('#indirizzo_fatturazione')) $('#indirizzo_fatturazione').value = r.indirizzo_fatturazione || '';
  if ($('#piva_rist')) $('#piva_rist').value = r.piva || '';
  if ($('#pec_rist')) $('#pec_rist').value = r.pec || '';
  $('#email').value = r.email;
  $('#password').value = '';
  $('#password').type = 'password';
  $('#password').required = false;
  $('#toggle-pass i').className = 'fas fa-eye';
  $('#id_piano').value = normalizzaPiano(r.id_piano);
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
  const ok = await chiediConfermaStato(
    'Eliminare questo <strong>ristorante</strong> e, se non ha altri locali, anche l\'utente collegato?',
    'L\'operazione non si può annullare. Menu, tavoli e ordini del locale verranno rimossi.',
    { title: 'Elimina ristorante', confirmLabel: 'Sì, elimina', confirmIcon: 'fas fa-trash', danger: true }
  );
  if (!ok) return;

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
  try { updateRistSidebarAbbonamento(currentRistorante); } catch (e) {}
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
        <td><span class="badge badge-${normalizzaPiano(r.id_piano)}">${(PIANI[normalizzaPiano(r.id_piano)]||{}).nome || r.id_piano}</span></td>
        <td class="${scadClass}">${scadText}</td>
        <td><span class="badge ${statoClass}">${statoLabel}</span></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="estendiAbbonamento('${r.id}')">
            <i class="fas fa-plus"></i> +1 anno
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
  d.setFullYear(d.getFullYear() + 1);
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
  if ($('#cliente-auth-rist-nome')) $('#cliente-auth-rist-nome').textContent = r.nome || 'Benvenuto';
  if ($('#cliente-auth-tavolo')) $('#cliente-auth-tavolo').textContent = tavolo;
  await restoreLoyaltySession();
  if (currentLoyalty) {
    showClienteAuthGate(false);
    showClienteView('menu');
    renderClienteMenu();
  } else {
    showClienteAuthGate(true);
  }
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
  const prevMenus = currentRistorante.menus;
  const prevMenuId = currentMenuId;
  const loaded = await loadRistoranteFull(currentRistorante.id);
  if (loaded) {
    // non perdere i menu locali se il DB non ha ancora la colonna
    if (!(Array.isArray(loaded.menus) && loaded.menus.length) && Array.isArray(prevMenus) && prevMenus.length) {
      loaded.menus = prevMenus;
    }
    currentRistorante = loaded;
  }
  ensureMenus(currentRistorante);
  if (prevMenuId) currentMenuId = prevMenuId;
  populateMenuSwitcher();
  const mid = getCurrentMenuId(currentRistorante);
  let menu = piattiDelMenu(currentRistorante, mid);

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
    menu = menu.filter(p => (p.nome || '').toLowerCase().includes(q));
  }

  const sel = $('#piatto-categoria');
  if (sel) {
    sel.innerHTML = (currentRistorante.categorie || []).map(c =>
      `<option value="${c}">${c}</option>`
    ).join('');
  }

  const body = $('#menu-body');
  if (!menu.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">Nessun piatto in questo menu. Aggiungine uno!</td></tr>`;
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
      <td>${formatPrice(p.prezzo)}<br><span style="font-size:11px;color:var(--muted)">IVA ${p.iva != null ? p.iva : 10}%</span></td>
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
  if ($('#piatto-iva')) $('#piatto-iva').value = '10';
  ['en','es','de','fr','zh'].forEach(lang => {
    const n = $('#piatto-nome-' + lang);
    const d = $('#piatto-desc-' + lang);
    if (n) n.value = '';
    if (d) d.value = '';
  });
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

  const ivaRaw = ($('#piatto-iva')?.value ?? '10').toString().trim();
  const ivaNum = parseInt(ivaRaw, 10);
  const iva = [0, 4, 5, 10, 22].includes(ivaNum) ? ivaNum : 10;

  const traduzioni = {};
  ['en','es','de','fr','zh'].forEach(lang => {
    const nome = ($('#piatto-nome-' + lang)?.value || '').trim();
    const descrizione = ($('#piatto-desc-' + lang)?.value || '').trim();
    if (nome || descrizione) traduzioni[lang] = { nome, descrizione };
  });

  const data = {
    id_ristorante: currentRistorante.id,
    nome: $('#piatto-nome').value.trim(),
    descrizione: $('#piatto-desc').value.trim(),
    categoria: $('#piatto-categoria').value,
    prezzo: parseFloat($('#piatto-prezzo').value) || 0,
    iva,
    disponibile: $('#piatto-disponibile').checked,
    allergeni,
    immagine,
    traduzioni,
    id_menu: getCurrentMenuId(currentRistorante)
  };

  async function savePiatto(payload) {
    if (id) return sb.from('piatti').update(payload).eq('id', id);
    return sb.from('piatti').insert(payload);
  }
  let { error } = await savePiatto(data);
  if (error) {
    // rimuovi campi opzionali se colonne assenti
    const optional = ['iva', 'traduzioni', 'id_menu'];
    let payload = { ...data };
    for (const key of optional) {
      if (!error) break;
      if (!new RegExp(key + '|column', 'i').test(String(error.message || '') + String(error.details || ''))) continue;
      const { [key]: _drop, ...rest } = payload;
      payload = rest;
      ({ error } = await savePiatto(payload));
      if (!error) console.warn('Colonna piatti.' + key + ' assente — aggiungila in Supabase');
    }
    if (!error && optional.some(k => !(k in payload))) {
      toast('Piatto salvato; alcune colonne (iva/traduzioni/menu) mancano nel DB');
    }
  }
  if (error) { toast('Errore: ' + (error.message || 'salvataggio')); console.error(error); return; }
  // aggiorna anche in memoria locale così il menu mostra subito l'IVA corretta
  if (currentRistorante) {
    currentRistorante = await loadRistoranteFull(currentRistorante.id) || currentRistorante;
  }
  toast(id ? 'Piatto aggiornato' : 'Piatto aggiunto');
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
  if ($('#piatto-iva')) {
    const iv = (p.iva != null && p.iva !== '') ? String(p.iva) : '10';
    $('#piatto-iva').value = ['0','4','5','10','22'].includes(iv) ? iv : '10';
  }
  ['en','es','de','fr','zh'].forEach(lang => {
    const tr = (p.traduzioni && p.traduzioni[lang]) || {};
    const n = $('#piatto-nome-' + lang);
    const d = $('#piatto-desc-' + lang);
    if (n) n.value = tr.nome || '';
    if (d) d.value = tr.descrizione || '';
  });
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
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onPdf = async () => { await scaricaPdfChiusura(ymd, stats); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    btnOk?.addEventListener('click', onOk);
    btnNo?.addEventListener('click', onNo);
    btnX?.addEventListener('click', onNo);
    btnPdf?.addEventListener('click', onPdf);
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
  try { populateMenuPubblicoSelects(); } catch (e) {}
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
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onSi = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    btnSi?.addEventListener('click', onSi);
    btnNo?.addEventListener('click', onNo);
    btnX?.addEventListener('click', onNo);
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
    // dopo qualsiasi drag, ignora il click "fantasma" per 200ms
    _kanbanJustDragged = true;
    setTimeout(() => { _kanbanJustDragged = false; }, 200);
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

  // click su card → dettaglio; dopo un drag non aprire
  board.addEventListener('click', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    if (_kanbanJustDragged) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const oid = card.dataset.ordineId;
    if (oid) {
      e.stopPropagation();
      apriDettaglioOrdine(oid);
    }
  });
}

window.apriDettaglioOrdine = async function(ordineId) {
  if (!ordineId) return;
  if (!currentRistorante) {
    toast('Nessun ristorante selezionato');
    return;
  }
  const idStr = String(ordineId);
  let o = (currentRistorante.ordini || []).find(x => String(x.id) === idStr);
  // se non in memoria, ricarica
  if (!o && sb) {
    try {
      const { data } = await sb.from('ordini').select('*').eq('id', ordineId).maybeSingle();
      if (data) {
        o = {
          ...data,
          items: data.items || [],
          createdAt: data.created_at || data.createdAt
        };
        currentRistorante.ordini = currentRistorante.ordini || [];
        currentRistorante.ordini.push(o);
      }
    } catch (e) { console.warn(e); }
  }
  if (!o) {
    toast('Ordine non trovato');
    return;
  }
  // assicura lista piatti (items o ordine_riga)
  let items = o.items || [];
  if ((!items || !items.length) && sb) {
    try {
      const { data: righe } = await sb.from('ordine_riga').select('*').eq('id_ordine', o.id);
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
  const titleEl = $('#ordine-detail-title');
  if (titleEl) titleEl.textContent = `Ordine #${o.codice || '—'} – Tavolo ${o.tavolo}`;
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
  actions += `<button class="btn btn-secondary" onclick="apriFattura('${o.id}')"><i class="fas fa-file-invoice"></i> Fattura</button>`;
  const nextPag = { in_attesa: 'pagato', pagato: 'non_pagato', non_pagato: 'in_attesa' }[ps] || 'pagato';
  const pagBtnLabel = { pagato: 'Segna pagato', non_pagato: 'Segna non pagato', in_attesa: 'Segna in attesa' }[nextPag];
  actions += `<button class="btn btn-secondary" onclick="togglePagamento('${o.id}')"><i class="fas fa-money-bill-wave"></i> ${pagBtnLabel}</button>`;
  if (o.stato !== 'chiuso') {
    actions += `<button class="btn btn-danger" onclick="chiudiConto('${o.id}')"><i class="fas fa-lock"></i> Chiudi conto</button>`;
  }
  actions += `<button class="btn btn-secondary close-modal" data-modal="modal-ordine">Chiudi</button>`;
  const actionsEl = $('#ordine-detail-actions');
  if (actionsEl) {
    actionsEl.innerHTML = actions;
    actionsEl.querySelector('.close-modal')?.addEventListener('click', () => {
      $('#modal-ordine')?.classList.add('hidden');
    });
  }
  const modal = $('#modal-ordine');
  if (modal) {
    modal.classList.remove('hidden');
  } else {
    toast('Errore: modal ordine non trovato');
  }
};

window.cambiaStato = async function(ordineId, nuovoStato) {
  await sb.from('ordini').update({ stato: nuovoStato }).eq('id', ordineId);
  // aggiorna occupato tavolo
  const o = (currentRistorante.ordini || []).find(x => String(x.id) === String(ordineId));
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
  const o = (currentRistorante.ordini || []).find(x => String(x.id) === String(ordineId));
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
  const o = (currentRistorante.ordini || []).find(x => String(x.id) === String(ordineId));
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
  const pubId = getMenuPubblicoId(currentRistorante);
  const menu = piattiDelMenu(currentRistorante, pubId).filter(p => p.disponibile !== false);
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
    list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px">' + tUI('nessunPiatto') + '</p>';
    return;
  }
  list.innerHTML = filtered.map(p => {
    const inCart = cart.find(c => c.id === p.id);
    const qty = inCart ? inCart.qty : 0;
    const all = (p.allergeni || []).length ? `<div class="allergeni-tags">⚠ ${(p.allergeni).join(', ')}</div>` : '';
    const nome = piattoLabel(p, 'nome') || p.nome;
    const desc = piattoLabel(p, 'descrizione');
    return `
      <div class="menu-item-card">
        ${p.immagine ? `<img src="${p.immagine}" class="piatto-img" alt="" onerror="this.style.display='none'"/>` : ''}
        <div class="menu-item-info" style="flex:1">
          <h4>${nome}</h4>
          ${desc ? `<p>${desc}</p>` : ''}
          <span class="prezzo">${formatPrice(p.prezzo)}</span>
          ${all}
        </div>
        <div class="menu-item-actions">
          ${qty > 0 ? `
            <button class="qty-btn" onclick="changeQty('${p.id}',-1)">−</button>
            <span class="qty-num">${qty}</span>
            <button class="qty-btn" onclick="changeQty('${p.id}',1)">+</button>
          ` : `
            <button class="btn btn-primary btn-sm" onclick="changeQty('${p.id}',1)"><i class="fas fa-plus"></i> ${tUI('aggiungi')}</button>
          `}
        </div>
      </div>
    `;
    }).join('');
  applyClienteChromeI18n();
}

function applyClienteChromeI18n() {
  const cartBtn = $('#cliente-carrello-btn');
  if (cartBtn) cartBtn.title = tUI('cart');
  const statoBtn = $('#cliente-stato-btn');
  if (statoBtn) statoBtn.innerHTML = `<i class="fas fa-info-circle"></i> ${tUI('stato')}`;

  const h2 = document.querySelector('#cliente-carrello-view h2');
  if (h2) h2.textContent = tUI('scelto');
  const totLabel = document.querySelector('#cliente-carrello-view .carrello-totale > span');
  if (totLabel) totLabel.textContent = tUI('totale');

  const labels = document.querySelectorAll('#cliente-carrello-view .form-group > label');
  if (labels[0]) labels[0].textContent = tUI('note');
  if (labels[1]) labels[1].textContent = tUI('paga');
  const noteTa = $('#ordine-note');
  if (noteTa) noteTa.placeholder = tUI('notePh');

  // payment option labels
  document.querySelectorAll('input[name="pagamento"]').forEach(inp => {
    const lab = inp.closest('label');
    if (!lab) return;
    const icon = lab.querySelector('i');
    const iconHtml = icon ? icon.outerHTML + ' ' : '';
    if (inp.value === 'carta') lab.innerHTML = `${inp.outerHTML} ${iconHtml}${tUI('carta')}`;
    if (inp.value === 'cassa') lab.innerHTML = `${inp.outerHTML} ${iconHtml}${tUI('cassa')}`;
  });

  const invia = $('#btn-invia-ordine');
  if (invia) invia.innerHTML = `<i class="fas fa-paper-plane"></i> ${tUI('invia')}`;

  const tavoloNum = $('#cliente-tavolo-num')?.textContent || '';
  const tavoloP = document.querySelector('.cliente-header p');
  if (tavoloP) tavoloP.innerHTML = `${tUI('tavolo')} <strong id="cliente-tavolo-num">${tavoloNum}</strong>`;

  // empty cart message if present
  const cartItems = $('#carrello-items');
  if (cartItems && !(cart && cart.length) && cartItems.querySelector('p')) {
    cartItems.innerHTML = `<p style="color:var(--muted);text-align:center">${tUI('vuoto')}</p>`;
  }

  // category chips "tutti"
  document.querySelectorAll('#cliente-categorie .cat-chip').forEach(chip => {
    if (chip.dataset.cat === 'tutti') chip.textContent = tUI('tutti');
  });

  // session banner
  const banner = document.getElementById('qr-session-banner');
  if (banner) {
    const timer = document.getElementById('qr-session-timer');
    const t = timer ? timer.textContent : '';
    banner.innerHTML = `<i class="fas fa-clock"></i> <span>${tUI('sessione')} <strong id="qr-session-timer">${t}</strong></span>`;
  }
  const expCard = document.querySelector('.qr-expired-card');
  if (expCard) {
    const h2e = expCard.querySelector('h2');
    if (h2e) h2e.textContent = tUI('sessioneScaduta');
    const ps = expCard.querySelectorAll('p');
    if (ps[0]) ps[0].textContent = tUI('sessioneHint');
    if (ps[1]) ps[1].textContent = tUI('riscansione');
    if (ps[2]) ps[2].textContent = tUI('ordiniValidi');
  }

  // ricevuta / stato headings
  const ricH = document.querySelector('#cliente-ricevuta-view h2, .ricevuta-header h2');
  // leave dynamic codes
  const statoH = document.querySelector('#cliente-stato-view h2');
  if (statoH) statoH.textContent = tUI('aPunto');
  const torna = $('#btn-torna-da-stato');
  if (torna) torna.textContent = tUI('tornaMenu');
  const scarica = $('#btn-scarica-ricevuta');
  if (scarica) scarica.innerHTML = `<i class="fas fa-download"></i> ${tUI('scaricaRicevuta')}`;
  const indietro = document.querySelectorAll('.btn-back');
  indietro.forEach(b => {
    if (b.id === 'btn-indietro-pagamento' || b.id === 'btn-torna-menu' || b.id === 'btn-indietro-stato') {
      b.innerHTML = `<i class="fas fa-arrow-left"></i> ${tUI('indietro')}`;
    }
  });
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
    cart.push({ id: p.id, nome: p.nome, prezzo: p.prezzo, iva: (p.iva != null ? p.iva : 10), qty: 1 });
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
    el.innerHTML = '<p style="color:var(--muted);text-align:center">' + tUI('vuoto') + '</p>';
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
    items: cart.map(c => ({ id: c.id, nome: c.nome, prezzo: c.prezzo, qty: c.qty, iva: c.iva != null ? c.iva : 10 }))
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
    items: cart.map(c => ({ id: c.id, nome: c.nome, prezzo: c.prezzo, qty: c.qty, iva: c.iva != null ? c.iva : 10 }))
  }).select().single());

  // se fallisce per colonna items o circuito_pagamento, riprova senza
  if (error && String(error.message || '').toLowerCase().includes('items')) {
    ({ data: inserted, error } = await sb.from('ordini').insert(ordineBase).select().single());
  }
  if (error && String(error.message || '').toLowerCase().includes('circuito')) {
    const { circuito_pagamento, ...senzaCirc } = ordineBase;
    ({ data: inserted, error } = await sb.from('ordini').insert({
      ...senzaCirc,
      items: cart.map(c => ({ id: c.id, nome: c.nome, prezzo: c.prezzo, qty: c.qty, iva: c.iva != null ? c.iva : 10 }))
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

  // Loyalty: punti se pagamento online e cliente registrato
  try {
    if (typeof currentLoyalty !== 'undefined' && currentLoyalty && pagamento === 'carta') {
      const pts = await accreditaPuntiLoyalty(currentLoyalty, totale);
      if (pts > 0) toast('+' + pts + ' punti loyalty (totale ' + currentLoyalty.punti + ' pt)');
      simulaEmailRicevuta(currentLoyalty, { codice, totale });
    }
  } catch (e) { console.warn('loyalty punti', e); }

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
    items: cart.map(i => ({ qty: i.qty, nome: i.nome, prezzo: i.prezzo, iva: i.iva != null ? i.iva : 10 })),
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
  _qrExpireTimer = setInterval(async () => {
    updateQrSessionUI();
    if (currentUser && currentUser.fromQR && !isQrSessionValid()) {
      // lascia l'overlay visibile
    }
    // aggiorna menu pubblico (se il ristorante ha cambiato menu pranzo/cena)
    if (currentUser && currentUser.role === 'cliente' && currentRistorante && sb && navigator.onLine) {
      try {
        const prevPub = getMenuPubblicoId(currentRistorante);
        const fresh = await loadRistoranteFull(currentRistorante.id);
        if (fresh) {
          currentRistorante = fresh;
          const nextPub = getMenuPubblicoId(currentRistorante);
          if (nextPub !== prevPub) {
            menuFilterCat = 'tutti';
            if (!$('#cliente-menu-view')?.classList.contains('hidden')) renderClienteMenu();
            toast('Menu aggiornato dal ristorante');
          }
        }
      } catch (e) {}
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

    // Loyalty: ospite / accedi / registrati
    if ($('#cliente-auth-rist-nome')) $('#cliente-auth-rist-nome').textContent = r.nome || 'Benvenuto';
    if ($('#cliente-auth-tavolo')) $('#cliente-auth-tavolo').textContent = t;

    await restoreLoyaltySession();

    // Mostra ricevuta solo se c'è ancora un ordine APERTO a questo tavolo
    if (!cart.length && lastOrdineId) {
      showClienteAuthGate(false);
      await loadClienteOrdineById(lastOrdineId);
    } else if (currentLoyalty) {
      showClienteAuthGate(false);
      showClienteView('menu');
      renderClienteMenu();
    } else {
      showClienteAuthGate(true);
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

// =====================================================
// FATTURA (persona fisica / giuridica) – con scorporo IVA
// =====================================================
let _fatturaOrdineId = null;
let _fatturaTipo = 'pf'; // pf | pg

function stampaAreaHtml(html) {
  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = html;
  area.classList.add('printing');
  const cleanup = () => {
    area.classList.remove('printing');
    area.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 1500);
  }, 80);
}

function setFatturaTipo(tipo) {
  _fatturaTipo = tipo === 'pg' ? 'pg' : 'pf';
  $$('.fattura-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === _fatturaTipo));
  $('#fattura-pf')?.classList.toggle('hidden', _fatturaTipo !== 'pf');
  $('#fattura-pg')?.classList.toggle('hidden', _fatturaTipo !== 'pg');
}

$$('.fattura-tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => setFatturaTipo(btn.dataset.tipo));
});

function resetFatturaForm() {
  ['fat-nome','fat-cognome','fat-nascita','fat-indirizzo-pf','fat-cf',
   'fat-ragione','fat-indirizzo-pg','fat-piva','fat-pec','fat-sdi'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  setFatturaTipo('pf');
  if ($('#fattura-stampa')) $('#fattura-stampa').checked = true;
}

window.apriFattura = function(ordineId) {
  const o = (currentRistorante?.ordini || []).find(x => x.id === ordineId);
  if (!o) { toast('Ordine non trovato'); return; }
  _fatturaOrdineId = ordineId;
  $('#fattura-ordine-id').value = ordineId;
  $('#fattura-meta').textContent =
    `Ordine #${o.codice || ''} · Tavolo ${o.tavolo} · Totale ${formatPrice(o.totale || 0)}`;
  resetFatturaForm();
  if (o.fattura && typeof o.fattura === 'object') {
    const f = o.fattura;
    setFatturaTipo(f.tipo === 'pg' ? 'pg' : 'pf');
    if (f.tipo === 'pg') {
      if ($('#fat-ragione')) $('#fat-ragione').value = f.ragione_sociale || '';
      if ($('#fat-indirizzo-pg')) $('#fat-indirizzo-pg').value = f.indirizzo || '';
      if ($('#fat-piva')) $('#fat-piva').value = f.piva || '';
      if ($('#fat-pec')) $('#fat-pec').value = f.pec || '';
      if ($('#fat-sdi')) $('#fat-sdi').value = f.codice_destinatario || '';
    } else {
      if ($('#fat-nome')) $('#fat-nome').value = f.nome || '';
      if ($('#fat-cognome')) $('#fat-cognome').value = f.cognome || '';
      if ($('#fat-nascita')) $('#fat-nascita').value = f.data_nascita || '';
      if ($('#fat-indirizzo-pf')) $('#fat-indirizzo-pf').value = f.indirizzo || '';
      if ($('#fat-cf')) $('#fat-cf').value = f.cf || '';
    }
  }
  $('#modal-ordine')?.classList.add('hidden');
  $('#modal-fattura')?.classList.remove('hidden');
};

function chiudiModalFattura() {
  $('#modal-fattura')?.classList.add('hidden');
  _fatturaOrdineId = null;
}
$('#btn-fattura-annulla')?.addEventListener('click', chiudiModalFattura);
$('#btn-fattura-x')?.addEventListener('click', chiudiModalFattura);
// non chiudere al click sullo sfondo: solo X / Annulla

function raccogliDatiFattura() {
  if (_fatturaTipo === 'pf') {
    const nome = ($('#fat-nome')?.value || '').trim();
    const cognome = ($('#fat-cognome')?.value || '').trim();
    const data_nascita = ($('#fat-nascita')?.value || '').trim();
    const indirizzo = ($('#fat-indirizzo-pf')?.value || '').trim();
    const cf = ($('#fat-cf')?.value || '').trim().toUpperCase().replace(/\s/g, '');
    if (!nome || !cognome) return { error: 'Inserisci nome e cognome' };
    if (!data_nascita) return { error: 'Inserisci la data di nascita' };
    if (!indirizzo) return { error: 'Inserisci l\'indirizzo di fatturazione' };
    if (!/^[A-Z0-9]{16}$/i.test(cf)) return { error: 'Codice fiscale non valido (16 caratteri)' };
    return {
      tipo: 'pf',
      nome, cognome, data_nascita, indirizzo, cf,
      intestazione: `${nome} ${cognome}`
    };
  }
  const ragione_sociale = ($('#fat-ragione')?.value || '').trim();
  const indirizzo = ($('#fat-indirizzo-pg')?.value || '').trim();
  const piva = ($('#fat-piva')?.value || '').trim().replace(/\s/g, '');
  const pec = ($('#fat-pec')?.value || '').trim();
  const codice_destinatario = ($('#fat-sdi')?.value || '').trim().toUpperCase();
  if (!ragione_sociale) return { error: 'Inserisci la ragione sociale' };
  if (!indirizzo) return { error: 'Inserisci l\'indirizzo di fatturazione' };
  if (!/^\d{11}$/.test(piva)) return { error: 'Partita IVA non valida (11 cifre)' };
  if (!pec && !codice_destinatario) {
    return { error: 'Inserisci almeno la PEC oppure il codice destinatario (SDI)' };
  }
  if (codice_destinatario && !/^[A-Z0-9]{6,7}$/i.test(codice_destinatario)) {
    return { error: 'Codice destinatario non valido (6-7 caratteri)' };
  }
  if (pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pec)) {
    return { error: 'Indirizzo PEC non valido' };
  }
  return {
    tipo: 'pg',
    ragione_sociale, indirizzo, piva, pec, codice_destinatario,
    intestazione: ragione_sociale
  };
}

/** Prezzo menu = IVA inclusa. Scorporto: imponibile = lordo/(1+aliq/100) */
function scorporaIva(lordo, aliquota) {
  const L = Math.round((Number(lordo) || 0) * 100) / 100;
  const a = Number(aliquota) || 0;
  if (a <= 0) return { imponibile: L, iva: 0, lordo: L, aliquota: 0 };
  const imponibile = Math.round((L / (1 + a / 100)) * 100) / 100;
  const iva = Math.round((L - imponibile) * 100) / 100;
  return { imponibile, iva, lordo: L, aliquota: a };
}

function aliquotaPiatto(item) {
  if (item && item.iva != null && item.iva !== '') return Number(item.iva);
  const menu = (currentRistorante && currentRistorante.menu) || [];
  if (item && item.id) {
    const p = menu.find(x => x.id === item.id);
    if (p && p.iva != null) return Number(p.iva);
  }
  if (item && item.nome) {
    const p = menu.find(x => (x.nome || '').toLowerCase() === String(item.nome).toLowerCase());
    if (p && p.iva != null) return Number(p.iva);
  }
  // default ristorazione
  return 10;
}

function calcolaFatturaRighe(o) {
  const items = o.items || [];
  const righe = items.map(i => {
    const qty = Number(i.qty) || 1;
    const unitLordo = Number(i.prezzo) || 0;
    const totLordo = Math.round(unitLordo * qty * 100) / 100;
    const aliq = aliquotaPiatto(i);
    const sc = scorporaIva(totLordo, aliq);
    return {
      nome: i.nome || i.piatto || 'Piatto',
      qty,
      unitLordo,
      totLordo,
      aliquota: sc.aliquota,
      imponibile: sc.imponibile,
      iva: sc.iva
    };
  });
  // se nessun prezzo riga, usa totale ordine come unica riga generica
  if (!righe.length || righe.every(r => r.totLordo === 0)) {
    const tot = Number(o.totale) || 0;
    if (tot > 0) {
      const sc = scorporaIva(tot, 10);
      return [{
        nome: 'Consumazione / ordine #' + (o.codice || ''),
        qty: 1,
        unitLordo: tot,
        totLordo: tot,
        aliquota: 10,
        imponibile: sc.imponibile,
        iva: sc.iva
      }];
    }
  }
  return righe;
}

function riepilogoIva(righe) {
  const map = {};
  righe.forEach(r => {
    const k = String(r.aliquota);
    if (!map[k]) map[k] = { aliquota: r.aliquota, imponibile: 0, iva: 0 };
    map[k].imponibile = Math.round((map[k].imponibile + r.imponibile) * 100) / 100;
    map[k].iva = Math.round((map[k].iva + r.iva) * 100) / 100;
  });
  return Object.values(map).sort((a, b) => a.aliquota - b.aliquota);
}


/** Prossimo numero fattura progressivo per ristorante (1, 2, 3… senza buchi di sessione). */
async function allocaNumeroFattura(ristId) {
  const lsKey = 'menupro_fat_seq_' + ristId;
  let maxN = 0;

  // 1) contatore su ristorante (se colonna presente)
  try {
    if (sb && ristId) {
      const { data: r } = await sb.from('ristoranti')
        .select('ultimo_numero_fattura')
        .eq('id', ristId)
        .maybeSingle();
      if (r && r.ultimo_numero_fattura != null) {
        maxN = Math.max(maxN, parseInt(r.ultimo_numero_fattura, 10) || 0);
      }
    }
  } catch (e) { /* colonna assente */ }

  // 2) massimo già assegnato sulle fatture in memoria / DB
  try {
    const ordini = (currentRistorante && currentRistorante.ordini) || [];
    ordini.forEach(o => {
      const n = o.fattura && o.fattura.numero;
      if (n != null) maxN = Math.max(maxN, parseInt(n, 10) || 0);
    });
    if (sb && ristId) {
      const { data: rows } = await sb.from('ordini')
        .select('fattura')
        .eq('id_ristorante', ristId)
        .not('fattura', 'is', null)
        .limit(500);
      (rows || []).forEach(row => {
        const n = row.fattura && row.fattura.numero;
        if (n != null) maxN = Math.max(maxN, parseInt(n, 10) || 0);
      });
    }
  } catch (e) {}

  // 3) localStorage di sicurezza (offline / colonna assente)
  try {
    const ls = parseInt(localStorage.getItem(lsKey) || '0', 10) || 0;
    maxN = Math.max(maxN, ls);
  } catch (e) {}

  const next = maxN + 1;

  try { localStorage.setItem(lsKey, String(next)); } catch (e) {}
  try {
    if (sb && ristId) {
      await sb.from('ristoranti').update({ ultimo_numero_fattura: next }).eq('id', ristId);
    }
  } catch (e) { /* colonna assente: ok, resta localStorage */ }

  if (currentRistorante && currentRistorante.id === ristId) {
    currentRistorante.ultimo_numero_fattura = next;
  }
  return next;
}

function formatDataItLong(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate || Date.now());
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildFatturaHtml(o, fat) {
  const r = currentRistorante || {};
  const nomeRist = r.nome || 'Ristorante';
  const titolare = r.titolare || '';
  const citta = r.citta || '';
  const indCed = r.indirizzo_fatturazione || '';
  const pivaCed = r.piva || '';
  const pecCed = r.pec || '';

  const righe = calcolaFatturaRighe(o);
  const riep = riepilogoIva(righe);
  const totImponibile = Math.round(riep.reduce((s, x) => s + x.imponibile, 0) * 100) / 100;
  const totIva = Math.round(riep.reduce((s, x) => s + x.iva, 0) * 100) / 100;
  const totDoc = Math.round((totImponibile + totIva) * 100) / 100;

  const linesHtml = righe.map(row => `
    <tr>
      <td>${row.nome}</td>
      <td class="ctr">${row.qty}</td>
      <td class="num">${formatPrice(row.unitLordo)}</td>
      <td class="ctr">${row.aliquota}%</td>
      <td class="num">${formatPrice(row.imponibile)}</td>
      <td class="num">${formatPrice(row.iva)}</td>
    </tr>`).join('');

  const riepHtml = riep.map(row => `
    <tr>
      <td>${row.aliquota}%</td>
      <td class="num">${formatPrice(row.imponibile)}</td>
      <td class="num">${formatPrice(row.iva)}</td>
    </tr>`).join('') || '<tr><td colspan="3">—</td></tr>';

  let clienteHtml = '';
  if (fat.tipo === 'pf') {
    const dn = (fat.data_nascita || '').split('-').reverse().join('/');
    clienteHtml = `
      <div><strong>${fat.nome} ${fat.cognome}</strong></div>
      <div>C.F. ${fat.cf}</div>
      <div>Data di nascita: ${dn}</div>
      <div>${fat.indirizzo}</div>`;
  } else {
    clienteHtml = `
      <div><strong>${fat.ragione_sociale}</strong></div>
      <div>P.IVA ${fat.piva}</div>
      ${fat.pec ? `<div>PEC: ${fat.pec}</div>` : ''}
      ${fat.codice_destinatario ? `<div>Codice destinatario: ${fat.codice_destinatario}</div>` : ''}
      <div>${fat.indirizzo}</div>`;
  }

  const num = fat.numero != null ? fat.numero : '—';
  const dataEm = fat.data_emissione
    ? formatDataItLong(fat.data_emissione)
    : formatDataItLong(new Date());

  return `
    <div class="fattura-doc">
      <div class="fd-top">
        <div>
          <p class="fd-doc-title">FATTURA</p>
          <div style="font-size:12px;color:#555;margin-top:6px">Documento gestionale</div>
        </div>
        <div class="fd-doc-num">
          <div>N. progressivo <strong>${num}</strong></div>
          <div>Data di emissione: <strong>${dataEm}</strong></div>
          <div>Rif. ordine: #${o.codice || '—'} · Tavolo ${o.tavolo}</div>
        </div>
      </div>
      <div class="fd-grid">
        <div class="fd-box">
          <h3>Cedente / prestatore</h3>
          <div><strong>${nomeRist}</strong></div>
          ${titolare ? `<div>${titolare}</div>` : ''}
          ${indCed ? `<div>${indCed}</div>` : (citta ? `<div>${citta}</div>` : '')}
          ${pivaCed ? `<div>P.IVA ${pivaCed}</div>` : ''}
          ${pecCed ? `<div>PEC: ${pecCed}</div>` : ''}
        </div>
        <div class="fd-box">
          <h3>Cessionario / committente</h3>
          ${clienteHtml}
        </div>
      </div>
      <table class="fd-lines">
        <thead>
          <tr>
            <th>Descrizione</th>
            <th class="ctr">Qtà</th>
            <th class="num">Prezzo (IVA incl.)</th>
            <th class="ctr">Aliq.</th>
            <th class="num">Imponibile</th>
            <th class="num">IVA</th>
          </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
      </table>
      <div class="fd-bottom">
        <div class="fd-riepilogo">
          <table class="fd-iva">
            <thead>
              <tr><th>Riepilogo IVA</th><th class="num">Imponibile</th><th class="num">Imposta</th></tr>
            </thead>
            <tbody>${riepHtml}</tbody>
          </table>
        </div>
        <div class="fd-totali">
          <div class="row"><span>Totale imponibile</span><span>${formatPrice(totImponibile)}</span></div>
          <div class="row"><span>Totale IVA</span><span>${formatPrice(totIva)}</span></div>
          <div class="row grand"><span>Totale documento</span><span>${formatPrice(totDoc)}</span></div>
        </div>
      </div>
      <p class="fd-note">
        I prezzi di listino sono da intendersi IVA inclusa; l’imposta è stata scorporata per aliquota.
        Documento emesso da MenuPro a scopo gestionale/informativo.
        Non sostituisce la fattura elettronica trasmessa al Sistema di Interscambio (SdI)
        né lo scontrino fiscale del registratore di cassa certificato, ove previsto.
      </p>
    </div>`;
}

async function confermaFattura() {
  if (!_fatturaOrdineId || !currentRistorante) return;
  const dati = raccogliDatiFattura();
  if (dati.error) { toast(dati.error); return; }

  const o = (currentRistorante.ordini || []).find(x => x.id === _fatturaOrdineId);
  if (!o) { toast('Ordine non trovato'); return; }

  // riusa numero se già emessa, altrimenti alloca progressivo
  let numero = (o.fattura && o.fattura.numero != null) ? parseInt(o.fattura.numero, 10) : null;
  if (!numero || !Number.isFinite(numero)) {
    numero = await allocaNumeroFattura(currentRistorante.id);
  }
  const data_emissione = (o.fattura && o.fattura.data_emissione)
    ? o.fattura.data_emissione
    : new Date().toISOString().slice(0, 10);

  const payload = {
    ...dati,
    numero,
    data_emissione
  };

  if (sb) {
    let { error } = await sb.from('ordini').update({ fattura: payload }).eq('id', o.id);
    if (error) {
      try {
        const notaFat = (o.note ? o.note + ' | ' : '') +
          `Fattura n.${numero} del ${data_emissione}: ` + dati.intestazione;
        await sb.from('ordini').update({ note: notaFat }).eq('id', o.id);
      } catch (e) {}
    }
  }
  o.fattura = payload;

  const doPrint = $('#fattura-stampa')?.checked !== false;
  chiudiModalFattura();

  if (doPrint) {
    if (!(o.items && o.items.length) && sb) {
      try {
        const { data: righe } = await sb.from('ordine_riga').select('*').eq('id_ordine', o.id);
        if (righe && righe.length) {
          o.items = righe.map(r => ({
            nome: r.piatto || r.nome || 'Piatto',
            qty: r.qty_piatti || r.qty || 1,
            prezzo: r.prezzo_pagato != null ? (Number(r.prezzo_pagato) / (r.qty_piatti || r.qty || 1)) : 0,
            id: r.id_piatto || null,
            iva: r.iva != null ? r.iva : undefined
          }));
        }
      } catch (e) {}
    }
    stampaAreaHtml(buildFatturaHtml(o, payload));
  }
  toast(`Fattura n. ${numero} emessa per ${dati.intestazione}`);
}

$('#btn-fattura-ok')?.addEventListener('click', () => { confermaFattura(); });

$('#fat-cf')?.addEventListener('input', (e) => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase();
  try { e.target.setSelectionRange(pos, pos); } catch (err) {}
});
$('#fat-sdi')?.addEventListener('input', (e) => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase();
  try { e.target.setSelectionRange(pos, pos); } catch (err) {}
});


// =====================================================
// MULTI-MENU + LINGUA CLIENTE
// =====================================================
function populateMenuSwitcher() {
  const sel = document.getElementById('menu-switcher');
  if (!sel || !currentRistorante) return;
  const menus = ensureMenus(currentRistorante);
  // allinea menu in modifica al menu pubblico se non ancora scelto
  if (!currentMenuId) currentMenuId = getMenuPubblicoId(currentRistorante);
  const mid = String(getCurrentMenuId(currentRistorante));
  sel.innerHTML = menus.map(m =>
    `<option value="${m.id}" ${String(m.id) === mid ? 'selected' : ''}>${m.nome || 'Menu'}</option>`
  ).join('');
  populateMenuPubblicoSelects();
}

function populateMenuPubblicoSelects() {
  if (!currentRistorante) return;
  const menus = ensureMenus(currentRistorante);
  const pub = String(getMenuPubblicoId(currentRistorante));
  const selOrd = document.getElementById('menu-pubblico-ordini');
  if (selOrd) {
    selOrd.innerHTML = menus.map(m =>
      `<option value="${m.id}" ${String(m.id) === pub ? 'selected' : ''}>${m.nome || 'Menu'}</option>`
    ).join('');
  }
  const sel = document.getElementById('menu-switcher');
  if (sel && sel.value !== pub && document.activeElement !== sel) {
    // non forzare se l'utente sta modificando un altro menu in editor:
    // solo allinea se currentMenuId === pubblico
  }
}

async function salvaMenusSuDb() {
  if (!currentRistorante) return;
  const menus = ensureMenus(currentRistorante);
  saveMenusLocal(currentRistorante.id, menus);
  try {
    cacheSet('rist_' + currentRistorante.id, stripSecrets(currentRistorante));
  } catch (e) {}
  if (!sb) return;
  const { error } = await sb.from('ristoranti').update({ menus }).eq('id', currentRistorante.id);
  if (error) {
    console.warn('menus non salvati su DB (colonna assente?):', error.message || error);
  }
}

document.getElementById('menu-switcher')?.addEventListener('change', (e) => {
  currentMenuId = e.target.value;
  menuFilterCat = 'tutti';
  // il menu scelto dal ristoratore è anche quello pubblicato ai clienti QR
  if (currentRistorante) setMenuPubblicoId(currentRistorante, currentMenuId, { silent: false });
  // non ricaricare tutto dal DB: filtra subito
  const mid = currentMenuId;
  let list = piattiDelMenu(currentRistorante, mid);
  if (menuFilterCat !== 'tutti') list = list.filter(p => p.categoria === menuFilterCat);
  const filter = ($('#search-menu')?.value || '').toLowerCase();
  if (filter) list = list.filter(p => (p.nome || '').toLowerCase().includes(filter));
  // ridisegna tabella senza await full reload
  const body = $('#menu-body');
  if (body) {
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px">Nessun piatto in questo menu. Aggiungine uno!</td></tr>`;
    } else {
      body.innerHTML = list.map(p => `
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
          <td>${formatPrice(p.prezzo)}<br><span style="font-size:11px;color:var(--muted)">IVA ${p.iva != null ? p.iva : 10}%</span></td>
          <td style="font-size:12px">${(p.allergeni || []).join(', ') || '—'}</td>
          <td><span class="badge ${p.disponibile !== false ? 'badge-pro' : 'badge-base'}">${p.disponibile !== false ? 'Sì' : 'No'}</span></td>
          <td class="actions">
            <button class="btn btn-secondary btn-sm" onclick="editPiatto('${p.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deletePiatto('${p.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `).join('');
    }
  }
  const chips = $('#categorie-chips');
  if (chips) {
    const cats = ['tutti', ...(currentRistorante.categorie || [])];
    chips.innerHTML = cats.map(c =>
      `<button class="cat-chip ${c === menuFilterCat ? 'active' : ''}" data-cat="${c}">${c === 'tutti' ? 'Tutti' : c}</button>`
    ).join('');
    chips.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        menuFilterCat = chip.dataset.cat;
        document.getElementById('menu-switcher')?.dispatchEvent(new Event('change'));
      });
    });
  }
});

document.getElementById('btn-nuovo-menu')?.addEventListener('click', () => {
  const title = document.getElementById('modal-menu-nome-title');
  if (title) title.textContent = 'Nuovo menu';
  const mode = document.getElementById('menu-nome-mode');
  if (mode) mode.value = 'new';
  const inp = document.getElementById('menu-nome-input');
  if (inp) inp.value = '';
  document.getElementById('modal-menu-nome')?.classList.remove('hidden');
  setTimeout(() => inp?.focus(), 40);
});

document.getElementById('btn-rinomina-menu')?.addEventListener('click', () => {
  if (!currentRistorante) { toast('Nessun ristorante selezionato'); return; }
  const mid = getCurrentMenuId(currentRistorante);
  const m = ensureMenus(currentRistorante).find(x => String(x.id) === String(mid));
  const title = document.getElementById('modal-menu-nome-title');
  if (title) title.textContent = 'Rinomina menu';
  const mode = document.getElementById('menu-nome-mode');
  if (mode) mode.value = 'rename';
  const inp = document.getElementById('menu-nome-input');
  if (inp) inp.value = m ? m.nome : '';
  document.getElementById('modal-menu-nome')?.classList.remove('hidden');
  setTimeout(() => inp?.focus(), 40);
});

document.getElementById('form-menu-nome')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRistorante) { toast('Nessun ristorante selezionato'); return; }
  const nome = (document.getElementById('menu-nome-input')?.value || '').trim();
  if (!nome) { toast('Inserisci un nome per il menu'); return; }
  const mode = document.getElementById('menu-nome-mode')?.value || 'new';
  ensureMenus(currentRistorante);
  if (!Array.isArray(currentRistorante.menus)) currentRistorante.menus = [];
  if (mode === 'rename') {
    const mid = getCurrentMenuId(currentRistorante);
    const m = currentRistorante.menus.find(x => String(x.id) === String(mid));
    if (m) m.nome = nome;
  } else {
    const id = uidMenu();
    currentRistorante.menus.push({ id, nome });
    currentMenuId = id;
    await setMenuPubblicoId(currentRistorante, id, { silent: true });
  }
  await salvaMenusSuDb();
  document.getElementById('modal-menu-nome')?.classList.add('hidden');
  populateMenuSwitcher();
  // aggiorna lista piatti del menu corrente
  document.getElementById('menu-switcher')?.dispatchEvent(new Event('change'));
  toast(mode === 'rename' ? 'Menu rinominato' : 'Menu creato: ' + nome);
});

$('#cliente-lang')?.addEventListener('change', (e) => {
  clienteLang = e.target.value || 'it';
  try { localStorage.setItem('menupro_cliente_lang', clienteLang); } catch (err) {}
  renderClienteMenu();
  if (!$('#cliente-carrello-view')?.classList.contains('hidden')) renderCarrello();
});

// ripristina lingua cliente
try {
  const savedLang = localStorage.getItem('menupro_cliente_lang');
  if (savedLang && LANGS.includes(savedLang)) {
    clienteLang = savedLang;
    if ($('#cliente-lang')) $('#cliente-lang').value = savedLang;
  }
} catch (e) {}


// =====================================================
// LOYALTY CARD
// =====================================================
let currentLoyalty = null; // { id, nome, cognome, email, punti, codice, id_ristorante }

function loyaltyLocalKey(ristId) {
  return 'menupro_loyalty_' + String(ristId || '');
}
function loyaltySessionKey(ristId) {
  return 'menupro_loy_session_' + String(ristId || '');
}

function defaultLoyaltyConfig() {
  return { euro: 1, punti: 10 };
}

function getLoyaltyConfig(r) {
  const cfg = (r && r.loyalty_config) || null;
  if (cfg && cfg.euro > 0) return { euro: Number(cfg.euro) || 1, punti: Number(cfg.punti) || 0 };
  try {
    const local = JSON.parse(localStorage.getItem('menupro_loy_cfg_' + (r && r.id)) || 'null');
    if (local && local.euro > 0) return local;
  } catch (e) {}
  return defaultLoyaltyConfig();
}

async function saveLoyaltyConfig(r, cfg) {
  if (!r) return;
  r.loyalty_config = cfg;
  try { localStorage.setItem('menupro_loy_cfg_' + r.id, JSON.stringify(cfg)); } catch (e) {}
  if (sb) {
    const { error } = await sb.from('ristoranti').update({ loyalty_config: cfg }).eq('id', r.id);
    if (error) console.warn('loyalty_config non salvata:', error.message);
  }
}

function loadLoyaltyMembersLocal(ristId) {
  try {
    const v = JSON.parse(localStorage.getItem(loyaltyLocalKey(ristId)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function saveLoyaltyMembersLocal(ristId, list) {
  try { localStorage.setItem(loyaltyLocalKey(ristId), JSON.stringify(list || [])); } catch (e) {}
}

function genCodiceCarta() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return 'MP-' + n;
}

function mapLoyaltyRow(m) {
  return {
    id: m.id,
    id_ristorante: m.id_ristorante,
    nome: m.nome || '',
    cognome: m.cognome || '',
    email: String(m.email || '').toLowerCase().trim(),
    telefono: m.telefono || '',
    password: m.password_hash || m.password || '',
    punti: Number(m.punti) || 0,
    codice: m.codice || m.codice_carta || '',
    created_at: m.created_at || m.createdAt || null
  };
}

/** Unisce locale + DB per email (non perde mai i tesserati locali). */
function mergeLoyaltyLists(localList, dbList) {
  const byEmail = new Map();
  (localList || []).forEach(m => {
    const em = String(m.email || '').toLowerCase().trim();
    if (!em) return;
    byEmail.set(em, { ...m, email: em });
  });
  (dbList || []).forEach(raw => {
    const m = mapLoyaltyRow(raw);
    if (!m.email) return;
    const prev = byEmail.get(m.email);
    if (!prev) {
      byEmail.set(m.email, m);
      return;
    }
    // merge: preferisci id UUID da DB, punti max, password se manca
    byEmail.set(m.email, {
      ...prev,
      ...m,
      password: m.password || prev.password || '',
      punti: Math.max(Number(prev.punti) || 0, Number(m.punti) || 0),
      codice: m.codice || prev.codice,
      id: (m.id && !String(m.id).startsWith('local_')) ? m.id : (prev.id || m.id)
    });
  });
  return Array.from(byEmail.values());
}

async function fetchLoyaltyMembers(ristId) {
  if (!ristId) return [];
  const local = loadLoyaltyMembersLocal(ristId);
  let dbList = null;
  if (sb) {
    try {
      const { data, error } = await sb.from('clienti_fedelta')
        .select('*')
        .eq('id_ristorante', ristId);
      if (error) {
        console.warn('clienti_fedelta select:', error.message || error);
      } else if (Array.isArray(data)) {
        dbList = data;
      }
    } catch (e) {
      console.warn('clienti_fedelta', e);
    }
  }
  // Se DB vuoto/errore → tieni i locali. Se DB ha dati → merge.
  const merged = dbList ? mergeLoyaltyLists(local, dbList) : local.slice();
  saveLoyaltyMembersLocal(ristId, merged);
  return merged;
}

async function upsertLoyaltyMember(member) {
  if (!member || !member.id_ristorante) return member;
  const ristId = member.id_ristorante;
  member.email = String(member.email || '').toLowerCase().trim();
  member.password = member.password != null ? String(member.password) : '';
  member.punti = Number(member.punti) || 0;
  if (!member.codice) member.codice = genCodiceCarta();

  // 1) sempre salva in locale (fonte di verità offline)
  let list = loadLoyaltyMembersLocal(ristId);
  const idx = list.findIndex(m =>
    String(m.id) === String(member.id) ||
    (m.email || '').toLowerCase() === member.email
  );
  if (idx >= 0) list[idx] = { ...list[idx], ...member };
  else list.unshift({ ...member });
  saveLoyaltyMembersLocal(ristId, list);

  // 2) prova Supabase (se tabella presente)
  if (sb) {
    const row = {
      id_ristorante: ristId,
      nome: member.nome,
      cognome: member.cognome,
      email: member.email,
      telefono: member.telefono || null,
      password_hash: member.password || null,
      punti: member.punti || 0,
      codice: member.codice
    };
    try {
      if (member.id && !String(member.id).startsWith('local_')) {
        const { error } = await sb.from('clienti_fedelta').update(row).eq('id', member.id);
        if (error) console.warn('update loyalty:', error.message || error);
      } else {
        // evita duplicati email su DB
        const { data: existing } = await sb.from('clienti_fedelta')
          .select('id,punti,codice')
          .eq('id_ristorante', ristId)
          .eq('email', member.email)
          .maybeSingle();
        if (existing && existing.id) {
          member.id = existing.id;
          await sb.from('clienti_fedelta').update(row).eq('id', existing.id);
        } else {
          const { data, error } = await sb.from('clienti_fedelta').insert(row).select().single();
          if (!error && data) {
            member.id = data.id;
          } else if (error) {
            console.warn('insert loyalty (resto su localStorage):', error.message || error);
          }
        }
        // aggiorna id locale se ricevuto da DB
        list = loadLoyaltyMembersLocal(ristId);
        const i2 = list.findIndex(m => (m.email || '').toLowerCase() === member.email);
        if (i2 >= 0) {
          list[i2] = { ...list[i2], ...member };
          saveLoyaltyMembersLocal(ristId, list);
        }
      }
    } catch (e) {
      console.warn('upsert loyalty fallback local:', e);
    }
  }
  return member;
}

function calcolaPuntiDaEuro(euro, cfg) {
  const e = Number(euro) || 0;
  const x = Number(cfg.euro) || 1;
  const z = Number(cfg.punti) || 0;
  if (x <= 0 || z <= 0 || e <= 0) return 0;
  return Math.floor((e / x) * z);
}

function premiLocalKey(ristId) {
  return 'menupro_premi_' + String(ristId || '');
}

function loadPremiLocal(ristId) {
  try {
    const v = JSON.parse(localStorage.getItem(premiLocalKey(ristId)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function savePremiLocal(ristId, list) {
  try { localStorage.setItem(premiLocalKey(ristId), JSON.stringify(list || [])); } catch (e) {}
}

function mergePremiLists(localList, dbList) {
  const byKey = new Map();
  (localList || []).forEach(p => {
    const k = p.id != null ? 'id:' + p.id : 'n:' + String(p.nome || '').toLowerCase();
    byKey.set(k, { ...p });
  });
  (dbList || []).forEach(p => {
    const k = p.id != null ? 'id:' + p.id : 'n:' + String(p.nome || '').toLowerCase();
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...p });
    else {
      byKey.set(k, {
        ...prev,
        ...p,
        id: (p.id && !String(p.id).startsWith('p_')) ? p.id : (prev.id || p.id),
        nome: p.nome || prev.nome,
        descrizione: p.descrizione != null ? p.descrizione : prev.descrizione,
        punti_richiesti: p.punti_richiesti != null ? p.punti_richiesti : prev.punti_richiesti,
        attivo: p.attivo != null ? p.attivo : prev.attivo
      });
    }
  });
  return Array.from(byKey.values()).sort((a, b) => (a.punti_richiesti || 0) - (b.punti_richiesti || 0));
}

async function loadPremi(ristId) {
  if (!ristId) return [];
  const local = loadPremiLocal(ristId);
  let dbList = null;
  if (sb) {
    try {
      const { data, error } = await sb.from('premi_fedelta').select('*').eq('id_ristorante', ristId);
      if (error) console.warn('premi_fedelta select:', error.message || error);
      else if (Array.isArray(data)) dbList = data;
    } catch (e) { console.warn('premi_fedelta', e); }
  }
  const merged = dbList ? mergePremiLists(local, dbList) : local.slice();
  savePremiLocal(ristId, merged);
  return merged;
}

async function savePremio(premio) {
  if (!currentRistorante || !currentRistorante.id) {
    toast('Nessun ristorante');
    return premio;
  }
  const ristId = currentRistorante.id;
  premio = {
    ...premio,
    id_ristorante: ristId,
    nome: String(premio.nome || '').trim(),
    descrizione: String(premio.descrizione || '').trim(),
    punti_richiesti: parseInt(premio.punti_richiesti, 10) || 1,
    attivo: premio.attivo !== false
  };
  if (!premio.nome) {
    toast('Nome premio obbligatorio');
    return premio;
  }

  // 1) sempre locale
  let list = loadPremiLocal(ristId);
  if (premio.id) {
    const i = list.findIndex(p => String(p.id) === String(premio.id));
    if (i >= 0) list[i] = { ...list[i], ...premio };
    else list.push(premio);
  } else {
    premio.id = 'p_' + Date.now();
    list.push(premio);
  }
  savePremiLocal(ristId, list);

  // 2) prova DB
  if (sb) {
    const row = {
      id_ristorante: ristId,
      nome: premio.nome,
      descrizione: premio.descrizione || '',
      punti_richiesti: premio.punti_richiesti,
      attivo: premio.attivo !== false
    };
    try {
      if (premio.id && !String(premio.id).startsWith('p_')) {
        const { error } = await sb.from('premi_fedelta').update(row).eq('id', premio.id);
        if (error) console.warn('update premio:', error.message || error);
      } else {
        const { data, error } = await sb.from('premi_fedelta').insert(row).select().single();
        if (!error && data) {
          const oldId = premio.id;
          premio.id = data.id;
          list = loadPremiLocal(ristId).map(p => String(p.id) === String(oldId) ? { ...p, id: data.id } : p);
          savePremiLocal(ristId, list);
        } else if (error) {
          console.warn('insert premio (resta in localStorage):', error.message || error);
        }
      }
    } catch (e) { console.warn(e); }
  }
  return premio;
}

function showClienteAuthGate(show) {
  const gate = document.getElementById('cliente-auth-gate');
  const form = document.getElementById('cliente-auth-form');
  const content = document.querySelector('.cliente-content');
  const header = document.querySelector('.cliente-header');
  if (show) {
    gate?.classList.remove('hidden');
    form?.classList.add('hidden');
    content?.classList.add('hidden');
    header?.classList.add('hidden');
    document.getElementById('cliente-loyalty-bar')?.classList.add('hidden');
  } else {
    gate?.classList.add('hidden');
    form?.classList.add('hidden');
    content?.classList.remove('hidden');
    header?.classList.remove('hidden');
  }
}

function showClienteAuthForm(mode) {
  document.getElementById('cliente-auth-gate')?.classList.add('hidden');
  const formWrap = document.getElementById('cliente-auth-form');
  formWrap?.classList.remove('hidden');
  document.getElementById('auth-mode').value = mode;
  document.getElementById('cliente-auth-form-title').textContent = mode === 'register' ? 'Registrati' : 'Accedi';
  document.getElementById('btn-auth-submit').textContent = mode === 'register' ? 'Crea account e attiva card' : 'Accedi';
  document.getElementById('auth-register-fields')?.classList.toggle('hidden', mode !== 'register');
  document.getElementById('auth-nome').required = mode === 'register';
  document.getElementById('auth-cognome').required = mode === 'register';
}

function applyLoyaltyBar() {
  const bar = document.getElementById('cliente-loyalty-bar');
  if (!bar) return;
  if (!currentLoyalty) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const nome = (currentLoyalty.nome || '') + ' ' + (currentLoyalty.cognome || '');
  document.getElementById('loy-bar-nome').textContent = nome.trim() || currentLoyalty.email;
  document.getElementById('loy-bar-punti').textContent = (currentLoyalty.punti || 0) + ' pt';
}

function setLoyaltySession(member) {
  currentLoyalty = member;
  if (member && currentRistorante) {
    try {
      localStorage.setItem(loyaltySessionKey(currentRistorante.id), JSON.stringify({
        id: member.id, email: member.email
      }));
    } catch (e) {}
  }
  applyLoyaltyBar();
}

function clearLoyaltySession() {
  currentLoyalty = null;
  if (currentRistorante) {
    try { localStorage.removeItem(loyaltySessionKey(currentRistorante.id)); } catch (e) {}
  }
  applyLoyaltyBar();
}

async function restoreLoyaltySession() {
  if (!currentRistorante) return;
  try {
    const raw = localStorage.getItem(loyaltySessionKey(currentRistorante.id));
    if (!raw) return;
    const s = JSON.parse(raw);
    const members = await fetchLoyaltyMembers(currentRistorante.id);
    const m = members.find(x => String(x.id) === String(s.id) || (x.email || '') === (s.email || '').toLowerCase());
    if (m) setLoyaltySession(m);
  } catch (e) {}
}

async function registraLoyaltyCliente({ nome, cognome, email, telefono, password }) {
  if (!currentRistorante || !currentRistorante.id) {
    return { error: 'Ristorante non disponibile' };
  }
  const ristId = currentRistorante.id;
  const em = String(email || '').toLowerCase().trim();
  if (!em || !password) return { error: 'Email e password obbligatorie' };

  const members = await fetchLoyaltyMembers(ristId);
  const exists = members.find(m => (m.email || '').toLowerCase() === em);
  if (exists) return { error: 'Email già registrata. Accedi invece di registrarti.' };

  const member = {
    id: 'local_' + Date.now(),
    id_ristorante: ristId,
    nome: String(nome || '').trim(),
    cognome: String(cognome || '').trim(),
    email: em,
    telefono: String(telefono || '').trim(),
    password: String(password),
    punti: 0,
    codice: genCodiceCarta(),
    created_at: new Date().toISOString()
  };
  await upsertLoyaltyMember(member);

  // verifica immediata lettura locale
  const check = loadLoyaltyMembersLocal(ristId);
  const ok = check.some(m => (m.email || '').toLowerCase() === em);
  if (!ok) {
    // fallback di emergenza
    saveLoyaltyMembersLocal(ristId, [member, ...check]);
  }
  return { member };
}

async function loginLoyaltyCliente(email, password) {
  if (!currentRistorante) return { error: 'Ristorante non disponibile' };
  const em = String(email || '').toLowerCase().trim();
  const pass = String(password || '');
  // 1) cerca subito in locale (anche se DB fallisce)
  let members = loadLoyaltyMembersLocal(currentRistorante.id);
  let m = members.find(x => (x.email || '').toLowerCase() === em);
  // 2) poi merge con DB
  members = await fetchLoyaltyMembers(currentRistorante.id);
  m = members.find(x => (x.email || '').toLowerCase() === em) || m;
  if (!m) {
    return { error: 'Account non trovato. Controlla email o registrati di nuovo.' };
  }
  const savedPass = m.password != null ? String(m.password) : '';
  // se password vuota (registrato in cassa), accetta al primo accesso e salvala
  if (savedPass && savedPass !== pass) {
    return { error: 'Password errata' };
  }
  if (!savedPass && pass) {
    m.password = pass;
    await upsertLoyaltyMember(m);
  }
  return { member: m };
}

async function accreditaPuntiLoyalty(member, totaleEuro) {
  if (!member || !currentRistorante) return 0;
  const cfg = getLoyaltyConfig(currentRistorante);
  const pts = calcolaPuntiDaEuro(totaleEuro, cfg);
  if (pts <= 0) return 0;
  member.punti = (Number(member.punti) || 0) + pts;
  await upsertLoyaltyMember(member);
  if (currentLoyalty && String(currentLoyalty.id) === String(member.id)) {
    currentLoyalty.punti = member.punti;
    applyLoyaltyBar();
  }
  return pts;
}

function simulaEmailRicevuta(member, ordine) {
  // In produzione: edge function / Resend. Qui log + toast.
  console.info('[Loyalty email]', {
    to: member.email,
    subject: 'Ricevuta ordine #' + (ordine.codice || ''),
    totale: ordine.totale,
    punti: member.punti
  });
  toast('Ricevuta inviata a ' + member.email);
}

// --- UI events auth ---
document.getElementById('btn-auth-ospite')?.addEventListener('click', () => {
  clearLoyaltySession();
  showClienteAuthGate(false);
  showClienteView('menu');
  renderClienteMenu();
});
document.getElementById('btn-auth-login')?.addEventListener('click', () => showClienteAuthForm('login'));
document.getElementById('btn-auth-register')?.addEventListener('click', () => showClienteAuthForm('register'));
document.getElementById('btn-auth-back')?.addEventListener('click', () => showClienteAuthGate(true));

document.getElementById('form-cliente-auth')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = document.getElementById('auth-mode')?.value || 'login';
  const email = (document.getElementById('auth-email')?.value || '').trim().toLowerCase();
  const password = document.getElementById('auth-password')?.value || '';
  if (!email || !password) { toast('Compila email e password'); return; }

  if (mode === 'register') {
    const nome = document.getElementById('auth-nome')?.value || '';
    const cognome = document.getElementById('auth-cognome')?.value || '';
    const tel = document.getElementById('auth-tel')?.value || '';
    if (!nome.trim() || !cognome.trim()) { toast('Inserisci nome e cognome'); return; }
    const res = await registraLoyaltyCliente({ nome, cognome, email, telefono: tel, password });
    if (res.error) { toast(res.error); return; }
    setLoyaltySession(res.member);
    showClienteAuthGate(false);
    showClienteView('menu');
    renderClienteMenu();
    toast('Loyalty card attivata · codice ' + res.member.codice);
    setTimeout(() => openWalletModal(), 400);
  } else {
    const res = await loginLoyaltyCliente(email, password);
    if (res.error) { toast(res.error); return; }
    setLoyaltySession(res.member);
    showClienteAuthGate(false);
    showClienteView('menu');
    renderClienteMenu();
    toast('Accesso loyalty: ' + (res.member.punti || 0) + ' punti');
  }
});

document.getElementById('btn-loy-logout')?.addEventListener('click', () => {
  clearLoyaltySession();
  showClienteAuthGate(true);
  toast('Sei uscito dalla loyalty card');
});

document.getElementById('btn-loy-wallet')?.addEventListener('click', () => openWalletModal());

function openWalletModal() {
  if (!currentLoyalty) { toast('Accedi alla loyalty card'); return; }
  const nome = ((currentLoyalty.nome || '') + ' ' + (currentLoyalty.cognome || '')).trim() || currentLoyalty.email;
  document.getElementById('loy-wc-nome').textContent = nome;
  document.getElementById('loy-wc-code').textContent = currentLoyalty.codice || '—';
  document.getElementById('loy-wc-punti').textContent = (currentLoyalty.punti || 0) + ' punti';
  // QR del codice carta (utile in cassa)
  const qrWrap = document.getElementById('loy-wc-qr');
  if (qrWrap) {
    const code = encodeURIComponent(currentLoyalty.codice || currentLoyalty.email || '');
    qrWrap.innerHTML = '<img alt="QR carta" style="width:140px;height:140px;border-radius:8px;background:#fff;padding:6px" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + code + '" />';
  }
  document.getElementById('modal-loy-wallet')?.classList.remove('hidden');
}

/** Card PNG scaricabile (salvabile in Foto / File e usabile come tessera). */
function downloadLoyaltyCardPng() {
  if (!currentLoyalty) return;
  const nome = ((currentLoyalty.nome || '') + ' ' + (currentLoyalty.cognome || '')).trim() || currentLoyalty.email;
  const rist = (currentRistorante && currentRistorante.nome) || 'MenuPro';
  const codice = currentLoyalty.codice || '—';
  const punti = String(currentLoyalty.punti || 0) + ' punti';

  const w = 680, h = 400;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  // sfondo
  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#1e3a8a');
  grd.addColorStop(1, '#3b82f6');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  // testo
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 18px system-ui,sans-serif';
  ctx.fillText('LOYALTY CARD', 40, 56);
  ctx.fillStyle = '#fff';
  ctx.font = '700 32px system-ui,sans-serif';
  ctx.fillText(rist, 40, 100);
  ctx.font = '600 26px system-ui,sans-serif';
  ctx.fillText(nome, 40, 170);
  ctx.font = '500 20px ui-monospace,monospace';
  ctx.fillText(codice, 40, 220);
  ctx.font = '600 22px system-ui,sans-serif';
  ctx.fillText(punti, 40, 280);
  ctx.font = '14px system-ui,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Mostra questo codice in cassa · MenuPro', 40, 360);

  // prova a disegnare QR se immagine già nel DOM
  const qrImg = document.querySelector('#loy-wc-qr img');
  const finish = () => {
    canvas.toBlob((blob) => {
      if (!blob) { toast('Impossibile generare la card'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'loyalty-' + (currentLoyalty.codice || 'card') + '.png';
      a.click();
      toast('Card salvata come immagine — aprila da Foto e aggiungila ai file preferiti');
    }, 'image/png');
  };
  if (qrImg && qrImg.complete) {
    try { ctx.drawImage(qrImg, w - 180, h - 180, 140, 140); } catch (e) {}
    finish();
  } else if (qrImg) {
    qrImg.onload = () => { try { ctx.drawImage(qrImg, w - 180, h - 180, 140, 140); } catch (e) {} finish(); };
    setTimeout(finish, 800);
  } else finish();
}

document.getElementById('btn-loy-download-card')?.addEventListener('click', () => downloadLoyaltyCardPng());

document.getElementById('btn-loy-copy-code')?.addEventListener('click', async () => {
  if (!currentLoyalty) return;
  try {
    await navigator.clipboard.writeText(currentLoyalty.codice || '');
    toast('Codice copiato: ' + currentLoyalty.codice);
  } catch (e) {
    toast('Codice: ' + (currentLoyalty.codice || ''));
  }
});

// --- Admin loyalty page ---
async function renderLoyaltyAdmin() {
  if (!currentRistorante) return;
  currentRistorante = await loadRistoranteFull(currentRistorante.id) || currentRistorante;
  const cfg = getLoyaltyConfig(currentRistorante);
  const euroEl = document.getElementById('loy-euro');
  const puntiEl = document.getElementById('loy-punti');
  if (euroEl) euroEl.value = cfg.euro;
  if (puntiEl) puntiEl.value = cfg.punti;
  const prev = document.getElementById('loy-config-preview');
  if (prev) prev.textContent = `Ogni €${cfg.euro} → ${cfg.punti} punti (es. conto da €30 → ${calcolaPuntiDaEuro(30, cfg)} pt)`;

  const premi = await loadPremi(currentRistorante.id);
  const isRist = currentUser && currentUser.role === 'ristoratore';
  const listEl = document.getElementById('loyalty-premi-list');
  if (listEl) {
    if (!premi.length) listEl.innerHTML = '<p style="color:var(--muted)">Nessun premio. Creane uno.</p>';
    else listEl.innerHTML = premi.map(pr => `
      <div class="loyalty-premio-item ${pr.attivo === false ? 'inactive' : ''}">
        <div>
          <strong>${pr.nome}</strong>
          ${pr.descrizione ? `<div style="font-size:12px;color:var(--muted)">${pr.descrizione}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-pro">${pr.punti_richiesti} pt</span>
          ${isRist ? `<button class="btn btn-secondary btn-sm" onclick="editPremio('${pr.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-sm" onclick="deletePremio('${pr.id}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>
    `).join('');
  }

  const members = await fetchLoyaltyMembers(currentRistorante.id);
  const q = (document.getElementById('loy-search-admin')?.value || '').toLowerCase();
  const filtered = q ? members.filter(m =>
    (m.nome || '').toLowerCase().includes(q) ||
    (m.cognome || '').toLowerCase().includes(q) ||
    (m.email || '').includes(q) ||
    (m.codice || '').toLowerCase().includes(q)
  ) : members;
  const body = document.getElementById('loyalty-membri-body');
  if (body) {
    if (!filtered.length) body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Nessun tesserato</td></tr>';
    else body.innerHTML = filtered.map(m => `
      <tr>
        <td><strong>${m.nome || ''} ${m.cognome || ''}</strong></td>
        <td>${m.email || '—'}</td>
        <td><code>${m.codice || '—'}</code></td>
        <td><strong>${m.punti || 0}</strong></td>
        <td class="actions">
          <button class="btn btn-secondary btn-sm" onclick="aggiungiPuntiManuali('${m.id}')" title="Aggiungi punti">+ pt</button>
        </td>
      </tr>
    `).join('');
  }
}

document.getElementById('btn-salva-loy-config')?.addEventListener('click', async () => {
  if (!currentRistorante) return;
  if (currentUser && currentUser.role === 'cassa') { toast('Solo il ristoratore può modificare la proporzione'); return; }
  const euro = parseFloat(document.getElementById('loy-euro')?.value) || 1;
  const punti = parseInt(document.getElementById('loy-punti')?.value, 10) || 0;
  await saveLoyaltyConfig(currentRistorante, { euro, punti });
  toast('Proporzione salvata');
  renderLoyaltyAdmin();
});

document.getElementById('loy-search-admin')?.addEventListener('input', () => renderLoyaltyAdmin());

document.getElementById('btn-nuovo-premio')?.addEventListener('click', () => {
  if (currentUser && currentUser.role === 'cassa') { toast('Solo il ristoratore può creare premi'); return; }
  document.getElementById('modal-premio-title').textContent = 'Nuovo premio';
  document.getElementById('premio-edit-id').value = '';
  document.getElementById('premio-nome').value = '';
  document.getElementById('premio-desc').value = '';
  document.getElementById('premio-punti').value = '100';
  document.getElementById('premio-attivo').checked = true;
  document.getElementById('modal-premio')?.classList.remove('hidden');
});

window.editPremio = async function(id) {
  if (currentUser && currentUser.role === 'cassa') return;
  const premi = await loadPremi(currentRistorante.id);
  const pr = premi.find(p => String(p.id) === String(id));
  if (!pr) return;
  document.getElementById('modal-premio-title').textContent = 'Modifica premio';
  document.getElementById('premio-edit-id').value = pr.id;
  document.getElementById('premio-nome').value = pr.nome || '';
  document.getElementById('premio-desc').value = pr.descrizione || '';
  document.getElementById('premio-punti').value = pr.punti_richiesti || 100;
  document.getElementById('premio-attivo').checked = pr.attivo !== false;
  document.getElementById('modal-premio')?.classList.remove('hidden');
};

window.deletePremio = async function(id) {
  if (currentUser && currentUser.role === 'cassa') return;
  const ok = await chiediConfermaStato('Eliminare questo premio?', 'L\'azione non si può annullare.');
  if (!ok) return;
  let list = loadPremiLocal(currentRistorante.id);
  list = list.filter(p => String(p.id) !== String(id));
  savePremiLocal(currentRistorante.id, list);
  if (sb) {
    try { await sb.from('premi_fedelta').delete().eq('id', id); } catch (e) {}
  }
  renderLoyaltyAdmin();
  toast('Premio eliminato');
};

document.getElementById('form-premio')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (currentUser && currentUser.role === 'cassa') {
    toast('Solo il ristoratore può gestire i premi');
    return;
  }
  if (!currentRistorante) { toast('Nessun ristorante'); return; }
  const id = document.getElementById('premio-edit-id')?.value || '';
  const nome = (document.getElementById('premio-nome')?.value || '').trim();
  if (!nome) { toast('Inserisci il nome del premio'); return; }
  const premio = {
    id: id || undefined,
    id_ristorante: currentRistorante.id,
    nome,
    descrizione: (document.getElementById('premio-desc')?.value || '').trim(),
    punti_richiesti: parseInt(document.getElementById('premio-punti')?.value, 10) || 1,
    attivo: document.getElementById('premio-attivo')?.checked !== false
  };
  await savePremio(premio);
  document.getElementById('modal-premio')?.classList.add('hidden');
  await renderLoyaltyAdmin();
  toast('Premio salvato: ' + nome);
});

window.aggiungiPuntiManuali = async function(memberId) {
  if (currentUser && currentUser.role === 'cassa') { toast('Solo il ristoratore può modificare i punti'); return; }
  const raw = prompt('Quanti punti aggiungere? (usa negativo per togliere)', '10');
  if (raw == null) return;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n === 0) return;
  const members = await fetchLoyaltyMembers(currentRistorante.id);
  const m = members.find(x => String(x.id) === String(memberId));
  if (!m) return;
  m.punti = Math.max(0, (Number(m.punti) || 0) + n);
  await upsertLoyaltyMember(m);
  renderLoyaltyAdmin();
  toast('Punti aggiornati: ' + m.punti);
};

// --- Cassa search ---
document.getElementById('btn-loy-cassa')?.addEventListener('click', async () => {
  document.getElementById('modal-loy-cassa')?.classList.remove('hidden');
  document.getElementById('loy-cassa-q').value = '';
  document.getElementById('loy-cassa-results').innerHTML = '';
  const premi = (await loadPremi(currentRistorante.id)).filter(p => p.attivo !== false);
  const el = document.getElementById('loy-cassa-premi');
  if (el) {
    el.innerHTML = premi.length ? premi.map(pr => `
      <div class="loyalty-premio-item">
        <div><strong>${pr.nome}</strong><div style="font-size:12px;color:var(--muted)">${pr.descrizione || ''}</div></div>
        <span class="badge badge-pro">${pr.punti_richiesti} pt</span>
      </div>
    `).join('') : '<p style="color:var(--muted);font-size:13px">Nessun premio attivo</p>';
  }
});

document.getElementById('loy-cassa-q')?.addEventListener('input', async (e) => {
  const q = (e.target.value || '').toLowerCase().trim();
  const box = document.getElementById('loy-cassa-results');
  if (!q || q.length < 2) { box.innerHTML = ''; return; }
  const members = await fetchLoyaltyMembers(currentRistorante.id);
  const found = members.filter(m =>
    (m.nome || '').toLowerCase().includes(q) ||
    (m.cognome || '').toLowerCase().includes(q) ||
    (m.email || '').includes(q) ||
    (m.codice || '').toLowerCase().includes(q)
  ).slice(0, 20);
  box.innerHTML = found.length ? found.map(m => `
    <div class="loy-cassa-row">
      <div>
        <strong>${m.nome || ''} ${m.cognome || ''}</strong><br>
        <span style="color:var(--muted)">${m.email} · ${m.codice}</span>
      </div>
      <strong>${m.punti || 0} pt</strong>
    </div>
  `).join('') : '<p style="color:var(--muted);font-size:13px">Nessun risultato</p>';
});

document.getElementById('form-loy-cassa-reg')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('loy-cassa-nome').value.trim();
  const cognome = document.getElementById('loy-cassa-cognome').value.trim();
  const email = document.getElementById('loy-cassa-email').value.trim().toLowerCase();
  if (!nome || !cognome || !email) return;
  const members = await fetchLoyaltyMembers(currentRistorante.id);
  if (members.some(m => m.email === email)) { toast('Email già registrata'); return; }
  const member = {
    id: 'local_' + Date.now(),
    id_ristorante: currentRistorante.id,
    nome, cognome, email,
    telefono: '',
    password: '',
    punti: 0,
    codice: genCodiceCarta(),
    created_at: new Date().toISOString()
  };
  await upsertLoyaltyMember(member);
  toast('Carta creata: ' + member.codice);
  document.getElementById('form-loy-cassa-reg').reset();
  document.getElementById('loy-cassa-q').value = email;
  document.getElementById('loy-cassa-q').dispatchEvent(new Event('input'));
});
