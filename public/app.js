import { firebaseConfig, firebaseEnabled } from './firebase-config.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoriesFor, categoryInfo } from './categories.js';
import { renderDonutChart, renderBarChart } from './charts.js';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.13.0';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  demo: false,
  user: null,
  currency: 'MXN',
  webhookToken: null,
  txs: [],           // { id, amount, type, category, note, date, source }
  view: 'inicio',
  filterMonth: '',
  filterType: '',
  analisisMonth: '',
  editingTxId: null,
  txType: 'expense',
  txCategory: EXPENSE_CATEGORIES[0].id,
};

let fb = null;         // { app, auth, firestore, realtime database modules + instances }
let unsubUser = null;
let unsubTxs = null;
let unsubToken = null;
let generatingToken = false;

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(dateStr) {
  return (dateStr || todayISO()).slice(0, 7);
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function formatMoney(amount) {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: state.currency || 'MXN', maximumFractionDigits: 2 }).format(amount || 0);
  } catch {
    return `$${(amount || 0).toFixed(2)}`;
  }
}
function formatDateShort(dateStr) {
  const d = new Date((dateStr || todayISO()) + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function showSaved(ok = true) {
  const el = $('#saveIndicator');
  $('#saveLabel').textContent = ok ? 'Guardado' : 'Error al guardar';
  el.classList.toggle('error', !ok);
  el.classList.add('show');
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('moneypro_theme', theme);
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️ Claro' : '🌙 Oscuro';
}
function initTheme() {
  const saved = localStorage.getItem('moneypro_theme');
  applyTheme(saved || 'dark');
}

// ---------------------------------------------------------------------
// Firebase (perezoso: solo se carga si hay config real)
// ---------------------------------------------------------------------
async function ensureFirebase() {
  if (fb) return fb;
  const { initializeApp } = await import(`${FIREBASE_SDK}/firebase-app.js`);
  const authMod = await import(`${FIREBASE_SDK}/firebase-auth.js`);
  const fsMod = await import(`${FIREBASE_SDK}/firebase-firestore.js`);
  const rtMod = await import(`${FIREBASE_SDK}/firebase-database.js`);
  const app = initializeApp(firebaseConfig);
  fb = {
    app,
    auth: authMod,
    authInst: authMod.getAuth(app),
    fs: fsMod,
    db: fsMod.getFirestore(app),
    rt: rtMod,
    rtdb: rtMod.getDatabase(app),
  };
  return fb;
}

async function initAuthListener() {
  if (!firebaseEnabled) return;
  await ensureFirebase();
  fb.auth.onAuthStateChanged(fb.authInst, (user) => {
    if (user) startReal(user); else stopReal();
  });
}

async function signIn(email, password) {
  await ensureFirebase();
  await fb.auth.signInWithEmailAndPassword(fb.authInst, email, password);
}
async function signUp(email, password) {
  await ensureFirebase();
  const cred = await fb.auth.createUserWithEmailAndPassword(fb.authInst, email, password);
  await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', cred.user.uid), {
    email, currency: 'MXN', createdAt: fb.fs.serverTimestamp(),
  }, { merge: true });
}
async function signOutUser() {
  await ensureFirebase();
  await fb.auth.signOut(fb.authInst);
}

// ---------------------------------------------------------------------
// Sesión real (Firestore)
// ---------------------------------------------------------------------
async function startReal(user) {
  state.demo = false;
  state.user = user;
  await ensureFirebase();

  const userRef = fb.fs.doc(fb.db, 'users', user.uid);
  unsubUser?.();
  unsubUser = fb.fs.onSnapshot(userRef, (snap) => {
    const data = snap.data() || {};
    state.currency = data.currency || 'MXN';
    renderSettings();
    renderInicio();
  });

  const txCol = fb.fs.collection(fb.db, 'users', user.uid, 'transactions');
  const q = fb.fs.query(txCol, fb.fs.orderBy('date', 'desc'), fb.fs.orderBy('createdAt', 'desc'));
  unsubTxs?.();
  unsubTxs = fb.fs.onSnapshot(q, (snap) => {
    state.txs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, () => showSaved(false));

  unsubToken?.();
  unsubToken = fb.rt.onValue(fb.rt.ref(fb.rtdb, `userTokens/${user.uid}`), (snap) => {
    state.webhookToken = snap.val() || null;
    if (!state.webhookToken && !generatingToken) regenerateToken();
    renderSettings();
  });

  drainInbox(user.uid);
  showApp();
}

function stopReal() {
  unsubUser?.(); unsubUser = null;
  unsubTxs?.(); unsubTxs = null;
  unsubToken?.(); unsubToken = null;
  state.user = null;
  state.txs = [];
  state.webhookToken = null;
  if (!state.demo) hideApp();
}

// Tolera mayúsculas, espacios y acentos ("Comida", " COMIDA ", "Inversión")
// al hacer coincidir la categoría que llega del atajo con las categorías
// internas de la app (ver categories.js).
function normalizeCategoryInput(str) {
  return (str || '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function newToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function regenerateToken() {
  if (!fb || !state.user) return;
  generatingToken = true;
  try {
    await fb.rt.set(fb.rt.ref(fb.rtdb, `userTokens/${state.user.uid}`), newToken());
  } catch (err) {
    console.error(err);
  } finally {
    generatingToken = false;
  }
}

// Los gastos que llegan por el atajo se guardan primero en un "buzón" en
// Realtime Database (el atajo no tiene sesión, así que no puede escribir
// directo en Firestore). Cada vez que abres sesión, se copian a
// Firestore como movimientos normales y se limpia el buzón.
async function drainInbox(uid) {
  if (!fb) return;
  try {
    const inboxRef = fb.rt.ref(fb.rtdb, `txInbox/${uid}`);
    const snap = await fb.rt.get(inboxRef);
    if (!snap.exists()) return;
    const entries = snap.val();
    const col = fb.fs.collection(fb.db, 'users', uid, 'transactions');
    const cleared = {};
    for (const [key, entry] of Object.entries(entries)) {
      cleared[key] = null;
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const type = entry.type === 'income' ? 'income' : 'expense';
      const validCategoryIds = categoriesFor(type).map((c) => c.id);
      const normalizedCategory = normalizeCategoryInput(entry.category);
      const category = validCategoryIds.includes(normalizedCategory) ? normalizedCategory : (type === 'income' ? 'otros_ingresos' : 'otros');
      const date = entry.ts ? new Date(entry.ts).toISOString().slice(0, 10) : todayISO();
      const note = typeof entry.note === 'string' ? entry.note.slice(0, 120) : '';
      await fb.fs.addDoc(col, { amount, type, category, note, date, source: 'shortcut', createdAt: fb.fs.serverTimestamp() });
    }
    await fb.rt.update(inboxRef, cleared);
  } catch (err) {
    console.error('drainInbox failed', err);
  }
}

// ---------------------------------------------------------------------
// Modo demostración (solo localStorage)
// ---------------------------------------------------------------------
function demoTxs() {
  return JSON.parse(localStorage.getItem('moneypro_demo_txs') || '[]');
}
function saveDemoTxs(txs) {
  localStorage.setItem('moneypro_demo_txs', JSON.stringify(txs));
}
function seedDemoData() {
  const now = new Date();
  const d = (offsetDays) => { const nd = new Date(now); nd.setDate(nd.getDate() - offsetDays); return nd.toISOString().slice(0, 10); };
  const seed = [
    { amount: 18500, type: 'income', category: 'salario', note: 'Nómina', date: d(3) },
    { amount: 245, type: 'expense', category: 'comida', note: 'Supermercado', date: d(1) },
    { amount: 89, type: 'expense', category: 'transporte', note: 'Uber', date: d(2) },
    { amount: 3200, type: 'expense', category: 'vivienda', note: 'Renta', date: d(4) },
    { amount: 560, type: 'expense', category: 'ocio', note: 'Cine y cena', date: d(6) },
    { amount: 1200, type: 'expense', category: 'servicios', note: 'Luz e internet', date: d(9) },
    { amount: 2500, type: 'income', category: 'freelance', note: 'Proyecto web', date: d(12) },
    { amount: 430, type: 'expense', category: 'salud', note: 'Farmacia', date: d(15) },
    { amount: 780, type: 'expense', category: 'compras', note: 'Ropa', date: d(20) },
    { amount: 150, type: 'expense', category: 'comida', note: 'Café', date: d(35) },
    { amount: 17900, type: 'income', category: 'salario', note: 'Nómina', date: d(33) },
    { amount: 2100, type: 'expense', category: 'vivienda', note: 'Renta', date: d(34) },
    { amount: 340, type: 'expense', category: 'transporte', note: 'Gasolina', date: d(40) },
  ];
  const withIds = seed.map((t) => ({ id: uid(), source: 'app', ...t }));
  saveDemoTxs(withIds);
  return withIds;
}
function startDemo() {
  state.demo = true;
  state.user = null;
  state.currency = localStorage.getItem('moneypro_demo_currency') || 'MXN';
  let txs = demoTxs();
  if (!txs.length) txs = seedDemoData();
  state.txs = txs;
  showApp();
  renderAll();
}

// ---------------------------------------------------------------------
// CRUD de movimientos (rama demo o real)
// ---------------------------------------------------------------------
async function saveTransaction(data) {
  if (state.demo) {
    const txs = demoTxs();
    if (state.editingTxId) {
      const idx = txs.findIndex((t) => t.id === state.editingTxId);
      if (idx >= 0) txs[idx] = { ...txs[idx], ...data };
    } else {
      txs.unshift({ id: uid(), source: 'app', ...data });
    }
    saveDemoTxs(txs);
    state.txs = txs;
    renderAll();
    showSaved(true);
    return;
  }
  try {
    if (state.editingTxId) {
      await fb.fs.updateDoc(fb.fs.doc(fb.db, 'users', state.user.uid, 'transactions', state.editingTxId), data);
    } else {
      await fb.fs.addDoc(fb.fs.collection(fb.db, 'users', state.user.uid, 'transactions'), {
        ...data, source: 'app', createdAt: fb.fs.serverTimestamp(),
      });
    }
    showSaved(true);
  } catch (err) {
    console.error(err);
    showSaved(false);
    throw err;
  }
}
async function deleteTransaction(id) {
  if (state.demo) {
    const txs = demoTxs().filter((t) => t.id !== id);
    saveDemoTxs(txs);
    state.txs = txs;
    renderAll();
    showSaved(true);
    return;
  }
  try {
    await fb.fs.deleteDoc(fb.fs.doc(fb.db, 'users', state.user.uid, 'transactions', id));
    showSaved(true);
  } catch (err) {
    console.error(err);
    showSaved(false);
  }
}

// ---------------------------------------------------------------------
// Navegación / visibilidad de la app
// ---------------------------------------------------------------------
function showApp() {
  $('#loginOverlay').classList.remove('open');
  $('#app').hidden = false;
  $('#demoBadge').hidden = !state.demo;
}
function hideApp() {
  $('#app').hidden = true;
  $('#loginOverlay').classList.add('open');
}
function setView(view) {
  state.view = view;
  $$('.view').forEach((el) => { el.hidden = el.dataset.view !== view; });
  $$('.nav-tabs button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  if (view === 'movimientos') renderMovimientos();
  if (view === 'analisis') renderAnalisis();
  if (view === 'ajustes') renderSettings();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// Render: Inicio
// ---------------------------------------------------------------------
function currentMonthKey() { return todayISO().slice(0, 7); }

function totalsForMonth(key) {
  let income = 0, expense = 0;
  for (const t of state.txs) {
    if (monthKey(t.date) !== key) continue;
    if (t.type === 'income') income += t.amount; else expense += t.amount;
  }
  return { income, expense, balance: income - expense };
}

function renderTxRow(t) {
  const info = categoryInfo(t.type, t.category);
  const row = document.createElement('div');
  row.className = 'tx-row';
  row.innerHTML = `
    <div class="tx-icon">${info.icon}</div>
    <div class="tx-info">
      <div class="tx-cat">${info.label}</div>
      <div class="tx-meta">${formatDateShort(t.date)}${t.note ? ' · ' + escapeHtml(t.note) : ''}${t.source === 'shortcut' ? ' · ⚡ atajo' : ''}</div>
    </div>
    <div class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount)}</div>
  `;
  row.addEventListener('click', () => openTxModal(t));
  return row;
}
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderInicio() {
  const key = currentMonthKey();
  const { income, expense, balance } = totalsForMonth(key);
  $('#balancePeriodLabel').textContent = `Balance de ${monthLabel(key)}`;
  $('#balanceAmount').textContent = formatMoney(balance);
  $('#incomeTotal').textContent = formatMoney(income);
  $('#expenseTotal').textContent = formatMoney(expense);

  const sorted = [...state.txs].sort((a, b) => (b.date + (b.createdAtMs || 0)).localeCompare(a.date + (a.createdAtMs || 0)));
  const recent = sorted.slice(0, 6);
  const list = $('#recentTxList');
  list.innerHTML = '';
  recent.forEach((t) => list.appendChild(renderTxRow(t)));
  $('#recentEmptyHint').hidden = state.txs.length > 0;
}

// ---------------------------------------------------------------------
// Render: Movimientos
// ---------------------------------------------------------------------
function distinctMonths() {
  const set = new Set(state.txs.map((t) => monthKey(t.date)));
  set.add(currentMonthKey());
  return Array.from(set).sort().reverse();
}

function renderMovimientos() {
  const monthSel = $('#filterMonth');
  const months = distinctMonths();
  monthSel.innerHTML = '<option value="">Todos los meses</option>' + months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  monthSel.value = state.filterMonth;

  let list = [...state.txs];
  if (state.filterMonth) list = list.filter((t) => monthKey(t.date) === state.filterMonth);
  if (state.filterType) list = list.filter((t) => t.type === state.filterType);
  list.sort((a, b) => b.date.localeCompare(a.date));

  const container = $('#fullTxList');
  container.innerHTML = '';
  list.forEach((t) => container.appendChild(renderTxRow(t)));
  $('#fullEmptyHint').hidden = list.length > 0;
}

// ---------------------------------------------------------------------
// Render: Análisis
// ---------------------------------------------------------------------
function renderAnalisis() {
  const monthSel = $('#analisisMonth');
  const months = distinctMonths();
  if (!state.analisisMonth || !months.includes(state.analisisMonth)) state.analisisMonth = currentMonthKey();
  monthSel.innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  monthSel.value = state.analisisMonth;

  const byCat = {};
  for (const t of state.txs) {
    if (t.type !== 'expense' || monthKey(t.date) !== state.analisisMonth) continue;
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  }
  const donutData = EXPENSE_CATEGORIES
    .map((c, i) => ({ id: c.id, label: c.label, icon: c.icon, value: byCat[c.id] || 0, seriesIndex: i }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  renderDonutChart($('#donutChartWrap'), donutData, formatMoney);

  const months6 = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cursor); d.setMonth(d.getMonth() - i);
    months6.push(d.toISOString().slice(0, 7));
  }
  const barData = months6.map((key) => {
    const t = totalsForMonth(key);
    return { key, label: monthLabel(key).split(' ')[0].slice(0, 3), income: t.income, expense: t.expense };
  });
  renderBarChart($('#barChartWrap'), barData, formatMoney);
}

// ---------------------------------------------------------------------
// Render: Ajustes
// ---------------------------------------------------------------------
function shortcutInboxUrl() {
  const base = firebaseConfig.databaseURL || 'https://TU_PROYECTO-default-rtdb.firebaseio.com';
  const uidPart = state.user?.uid || 'TU_UID';
  return `${base}/txInbox/${uidPart}.json`;
}
function shortcutBodyTemplate(token) {
  return JSON.stringify({
    amount: 0,
    type: 'expense',
    category: 'comida',
    note: '',
    token: token || 'TU_TOKEN',
    ts: { '.sv': 'timestamp' },
  }, null, 2);
}
function maskToken(token) {
  if (!token) return '—';
  if (token.length <= 10) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function renderSettings() {
  $('#accountEmail').textContent = state.demo ? 'Modo demostración' : (state.user?.email || '—');
  $('#logoutBtn').hidden = state.demo;
  $('#demoUpgradeBtn').hidden = !state.demo;
  $('#currencySelect').value = state.currency;

  const tokenAvailable = !state.demo && !!state.webhookToken;
  $('#tokenDisplay').textContent = state.demo ? 'No disponible en modo demo' : maskToken(state.webhookToken);
  $('#copyUrlBtn').disabled = !tokenAvailable;
  $('#copyBodyBtn').disabled = !tokenAvailable;
  $('#regenTokenBtn').disabled = state.demo;
  $('#demoTokenHint').hidden = !state.demo;
}

// ---------------------------------------------------------------------
// Modal de movimiento
// ---------------------------------------------------------------------
function buildCategoryGrid() {
  const grid = $('#txCategoryGrid');
  grid.innerHTML = '';
  categoriesFor(state.txType).forEach((c) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip' + (c.id === state.txCategory ? ' active' : '');
    chip.innerHTML = `<span class="cat-emoji">${c.icon}</span><span class="cat-label">${c.label}</span>`;
    chip.addEventListener('click', () => {
      state.txCategory = c.id;
      $$('.category-chip', grid).forEach((el) => el.classList.remove('active'));
      chip.classList.add('active');
    });
    grid.appendChild(chip);
  });
}

function openTxModal(tx = null) {
  state.editingTxId = tx?.id || null;
  state.txType = tx?.type || 'expense';
  state.txCategory = tx?.category || categoriesFor(state.txType)[0].id;

  $('#txModalTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#txAmount').value = tx ? tx.amount : '';
  $('#txDate').value = tx ? tx.date : todayISO();
  $('#txNote').value = tx?.note || '';
  $('#txError').hidden = true;
  $('#txDelete').hidden = !tx;
  $$('#txTypeToggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.txType));
  buildCategoryGrid();
  $('#txModalOverlay').classList.add('open');
}
function closeTxModal() {
  $('#txModalOverlay').classList.remove('open');
}

async function handleTxSave() {
  const amount = parseFloat($('#txAmount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    $('#txError').textContent = 'Ingresa un monto válido.';
    $('#txError').hidden = false;
    return;
  }
  const date = $('#txDate').value || todayISO();
  const note = $('#txNote').value.trim().slice(0, 120);
  try {
    await saveTransaction({ amount, type: state.txType, category: state.txCategory, date, note });
    closeTxModal();
  } catch {
    $('#txError').textContent = 'No se pudo guardar. Intenta de nuevo.';
    $('#txError').hidden = false;
  }
}

// ---------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------
function renderAll() {
  renderInicio();
  if (state.view === 'movimientos') renderMovimientos();
  if (state.view === 'analisis') renderAnalisis();
  if (state.view === 'ajustes') renderSettings();
}

// ---------------------------------------------------------------------
// Auth form (login/signup)
// ---------------------------------------------------------------------
let authMode = 'login';

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const errEl = $('#authError');
  errEl.hidden = true;
  $('#authSubmit').disabled = true;
  try {
    if (authMode === 'login') await signIn(email, password);
    else await signUp(email, password);
  } catch (err) {
    errEl.textContent = translateAuthError(err?.code);
    errEl.hidden = false;
  } finally {
    $('#authSubmit').disabled = false;
  }
}
function translateAuthError(code) {
  const map = {
    'auth/invalid-email': 'Correo inválido.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Intenta entrar.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  };
  return map[code] || 'Ocurrió un error. Intenta de nuevo.';
}

// ---------------------------------------------------------------------
// Wire-up de eventos
// ---------------------------------------------------------------------
function wireEvents() {
  $$('.nav-tabs button').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $$('[data-nav]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.nav)));

  $('#addFab').addEventListener('click', () => openTxModal());
  $('#txCancel').addEventListener('click', closeTxModal);
  $('#txModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'txModalOverlay') closeTxModal(); });
  $('#txSave').addEventListener('click', handleTxSave);
  $('#txDelete').addEventListener('click', async () => {
    if (state.editingTxId && confirm('¿Eliminar este movimiento?')) {
      await deleteTransaction(state.editingTxId);
      closeTxModal();
    }
  });
  $$('#txTypeToggle button').forEach((b) => b.addEventListener('click', () => {
    state.txType = b.dataset.type;
    state.txCategory = categoriesFor(state.txType)[0].id;
    $$('#txTypeToggle button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    buildCategoryGrid();
  }));

  $('#filterMonth').addEventListener('change', (e) => { state.filterMonth = e.target.value; renderMovimientos(); });
  $('#filterType').addEventListener('change', (e) => { state.filterType = e.target.value; renderMovimientos(); });
  $('#analisisMonth').addEventListener('change', (e) => { state.analisisMonth = e.target.value; renderAnalisis(); });

  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });

  $$('#authTabs button').forEach((b) => b.addEventListener('click', () => {
    authMode = b.dataset.mode;
    $$('#authTabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#authSubmit').textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
    $('#authError').hidden = true;
  }));
  $('#authForm').addEventListener('submit', handleAuthSubmit);
  $('#demoBtn').addEventListener('click', startDemo);
  $('#demoUpgradeBtn').addEventListener('click', () => { stopReal(); state.demo = false; hideApp(); });

  $('#logoutBtn').addEventListener('click', async () => {
    if (state.demo) { hideApp(); return; }
    await signOutUser();
  });

  $('#currencySelect').addEventListener('change', async (e) => {
    state.currency = e.target.value;
    if (state.demo) {
      localStorage.setItem('moneypro_demo_currency', state.currency);
    } else if (fb && state.user) {
      await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', state.user.uid), { currency: state.currency }, { merge: true });
    }
    renderAll();
  });

  $('#copyUrlBtn').addEventListener('click', async () => {
    const url = shortcutInboxUrl();
    try {
      await navigator.clipboard.writeText(url);
      showSaved(true);
      $('#saveLabel').textContent = 'URL copiada';
      setTimeout(() => { $('#saveLabel').textContent = 'Guardado'; }, 1800);
    } catch {
      prompt('Copia esta URL:', url);
    }
  });
  $('#copyBodyBtn').addEventListener('click', async () => {
    const body = shortcutBodyTemplate(state.webhookToken);
    try {
      await navigator.clipboard.writeText(body);
      showSaved(true);
      $('#saveLabel').textContent = 'JSON copiado';
      setTimeout(() => { $('#saveLabel').textContent = 'Guardado'; }, 1800);
    } catch {
      prompt('Copia este JSON:', body);
    }
  });
  $('#regenTokenBtn').addEventListener('click', async () => {
    if (state.demo) return;
    if (!confirm('El atajo actual dejará de funcionar hasta que actualices la URL. ¿Continuar?')) return;
    await regenerateToken();
  });

  $$('#platformTabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#platformTabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#iosSteps').hidden = b.dataset.platform !== 'ios';
    $('#androidSteps').hidden = b.dataset.platform !== 'android';
  }));
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function init() {
  initTheme();
  wireEvents();
  registerServiceWorker();
  $('#firebaseDisabledHint').hidden = firebaseEnabled;
  $('#authForm').hidden = !firebaseEnabled;

  // No bloquea en la carga de Firebase: si el SDK tarda o falla (red
  // lenta, un CDN bloqueado), igual queremos que aparezca la pantalla de
  // acceso con el botón de modo demostración cuanto antes.
  if (firebaseEnabled) {
    initAuthListener().catch((err) => {
      console.error('No se pudo inicializar Firebase', err);
      $('#authError').textContent = 'No se pudo conectar con el servidor. Revisa tu conexión, o usa el modo demostración.';
      $('#authError').hidden = false;
    });
  }
  setTimeout(() => {
    if (!state.user && !state.demo) hideApp();
  }, firebaseEnabled ? 1200 : 0);
}

init();
