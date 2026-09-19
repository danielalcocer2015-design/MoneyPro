import { firebaseConfig, firebaseEnabled } from './firebase-config.js';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, FALLBACK_ID, defaultCategoryDoc, slugify, findCategory } from './categories.js';
import { defaultAccountDoc, slugifyAccount, allAccounts, findAccount, defaultAccountId } from './accounts.js';
import { BUDGET_PERIODS, DEFAULT_BUDGET_PERIOD, monthlyEquivalent, defaultBudgetDoc } from './budgets.js';
import { renderDonutChart, renderBarChart } from './charts.js';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.13.0';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  demo: false,
  user: null,
  currency: 'MXN',
  webhookToken: null,
  categories: defaultCategoryDoc(), // { expense: [...], income: [...] } — personalizable por usuario
  accounts: defaultAccountDoc(),    // { corriente: [...], credito: [...] } — personalizable por usuario
  budgets: defaultBudgetDoc(),      // { [categoriaId]: { amount, period } } — presupuesto por categoría de gasto
  txs: [],           // { id, amount, type, category, subcategory, accountId, fromAccountId, toAccountId, note, date, source }
  view: 'inicio',
  selectedAccountId: null, // cuenta que se está viendo en el detalle (vista "cuenta-detalle")
  filterMonth: '',
  filterType: '',
  analisisMonth: '',
  editingTxId: null,
  txType: 'expense',
  txCategory: DEFAULT_EXPENSE_CATEGORIES[0].id,
  txSubcategory: '',
  txAccount: '',
  txFromAccount: '',
  txToAccount: '',
};

let fb = null;         // { app, auth, firestore, realtime database modules + instances }
let unsubUser = null;
let unsubTxs = null;
let unsubToken = null;
let unsubCategories = null;
let unsubAccounts = null;
let unsubBudgets = null;
let generatingToken = false;

// Categorías/subcategorías: leen de state.categories (personalizables),
// con las de categories.js solo como semilla inicial (ver defaultCategoryDoc).
function categoriesFor(type) {
  return state.categories[type === 'income' ? 'income' : 'expense'];
}
function categoryInfo(type, id) {
  return findCategory(categoriesFor(type), id) || { id, label: id || 'Otros', icon: '🔧', subcategories: [] };
}

// Cuentas: leen de state.accounts (personalizables), con las de
// accounts.js solo como semilla inicial (ver defaultAccountDoc).
function accountsList() {
  return allAccounts(state.accounts);
}
function accountInfo(id) {
  return findAccount(state.accounts, id) || { id, name: id ? 'Cuenta eliminada' : 'Sin cuenta', icon: '❔', kind: 'corriente' };
}
function currentDefaultAccountId() {
  return defaultAccountId(state.accounts);
}

// Presupuestos: leen de state.budgets, { [categoriaId]: {amount, period} }.
// budgetSpentForCategory suma los GASTOS de esa categoría en el mes dado
// (misma noción de "mes" que el resto de la app — ver monthKey/currentMonthKey).
function budgetSpentForCategory(categoryId, key) {
  let spent = 0;
  for (const t of state.txs) {
    if (t.type === 'expense' && t.category === categoryId && monthKey(t.date) === key) spent += t.amount;
  }
  return spent;
}

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
  await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', cred.user.uid, 'meta', 'categories'), defaultCategoryDoc());
  const seedAccounts = defaultAccountDoc();
  if (seedAccounts.corriente[0]) seedAccounts.corriente[0].isDefault = true;
  await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', cred.user.uid, 'meta', 'accounts'), seedAccounts);
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

  // Un solo orderBy (sin combinar dos campos) no necesita un índice
  // compuesto de Firestore — la app ya reordena por fecha al renderizar,
  // así que esto alcanza sin depender de crear un índice manualmente.
  const txCol = fb.fs.collection(fb.db, 'users', user.uid, 'transactions');
  const q = fb.fs.query(txCol, fb.fs.orderBy('date', 'desc'));
  unsubTxs?.();
  unsubTxs = fb.fs.onSnapshot(q, (snap) => {
    state.txs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => { console.error('transactions onSnapshot failed', err); showSaved(false); });

  const catRef = fb.fs.doc(fb.db, 'users', user.uid, 'meta', 'categories');
  unsubCategories?.();
  unsubCategories = fb.fs.onSnapshot(catRef, (snap) => {
    const data = snap.data();
    state.categories = (data && data.expense && data.income) ? data : defaultCategoryDoc();
    syncCatListToRtdb();
    renderAll();
  });

  const acctRef = fb.fs.doc(fb.db, 'users', user.uid, 'meta', 'accounts');
  unsubAccounts?.();
  unsubAccounts = fb.fs.onSnapshot(acctRef, (snap) => {
    const data = snap.data();
    state.accounts = (data && data.corriente && data.credito) ? data : defaultAccountDoc();
    syncAccountListToRtdb();
    renderAll();
  });

  const budgetRef = fb.fs.doc(fb.db, 'users', user.uid, 'meta', 'budgets');
  unsubBudgets?.();
  unsubBudgets = fb.fs.onSnapshot(budgetRef, (snap) => {
    const data = snap.data();
    state.budgets = data || defaultBudgetDoc();
    renderAll();
  });

  unsubToken?.();
  unsubToken = fb.rt.onValue(fb.rt.ref(fb.rtdb, `userTokens/${user.uid}`), (snap) => {
    state.webhookToken = snap.val() || null;
    if (!state.webhookToken && !generatingToken) {
      regenerateToken();
    } else {
      syncCatListToRtdb();
      syncAccountListToRtdb();
      if (state.webhookToken) drainInbox(user.uid, state.webhookToken);
    }
    renderSettings();
  });

  showApp();
}

function stopReal() {
  unsubUser?.(); unsubUser = null;
  unsubTxs?.(); unsubTxs = null;
  unsubToken?.(); unsubToken = null;
  unsubCategories?.(); unsubCategories = null;
  unsubAccounts?.(); unsubAccounts = null;
  unsubBudgets?.(); unsubBudgets = null;
  state.user = null;
  state.txs = [];
  state.webhookToken = null;
  if (!state.demo) hideApp();
}

// Tolera mayúsculas, espacios y acentos ("Comida", " COMIDA ", "Inversión")
// al hacer coincidir la categoría que llega del atajo con las categorías
// internas de la app (ver categories.js).
const COMBINING_MARKS_RE = new RegExp(String.fromCharCode(0x5b) + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + String.fromCharCode(0x5d), 'g');
function normalizeCategoryInput(str) {
  return (str || '').toString().trim().toLowerCase().normalize('NFD').replace(COMBINING_MARKS_RE, '');
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
    const oldToken = state.webhookToken;
    // Drena cualquier gasto pendiente del token viejo antes de
    // abandonarlo — si no, quedaría inaccesible (el buzón ahora vive
    // bajo la ruta del token, no del uid).
    if (oldToken) await drainInbox(state.user.uid, oldToken);
    const token = newToken();
    await fb.rt.set(fb.rt.ref(fb.rtdb, `userTokens/${state.user.uid}`), token);
    await syncCatListToRtdb(token);
    await syncAccountListToRtdb(token);
    if (oldToken && oldToken !== token) {
      fb.rt.remove(fb.rt.ref(fb.rtdb, `catList/${oldToken}`)).catch(() => {});
      fb.rt.remove(fb.rt.ref(fb.rtdb, `accountList/${oldToken}`)).catch(() => {});
    }
  } catch (err) {
    console.error(err);
  } finally {
    generatingToken = false;
  }
}

// Copia los nombres de categorías (públicos solo para quien conoce el
// token) a Realtime Database, para que el atajo pueda consultarlos en
// vivo antes de mostrar el menú — ver database.rules.json → catList.
function syncCatListToRtdb(tokenOverride) {
  const token = tokenOverride || state.webhookToken;
  if (!fb || state.demo || !state.user || !token) return Promise.resolve();
  const payload = {
    expense: state.categories.expense.map((c) => c.label),
    income: state.categories.income.map((c) => c.label),
  };
  return fb.rt.set(fb.rt.ref(fb.rtdb, `catList/${token}`), payload).catch((err) => console.error('syncCatListToRtdb failed', err));
}

// Copia los nombres de cuentas (públicos solo para quien conoce el token)
// a Realtime Database, para que el atajo pueda consultarlas en vivo antes
// de mostrar el menú de cuentas — ver database.rules.json → accountList.
function syncAccountListToRtdb(tokenOverride) {
  const token = tokenOverride || state.webhookToken;
  if (!fb || state.demo || !state.user || !token) return Promise.resolve();
  const payload = {
    corriente: state.accounts.corriente.map((a) => a.name),
    credito: state.accounts.credito.map((a) => a.name),
  };
  return fb.rt.set(fb.rt.ref(fb.rtdb, `accountList/${token}`), payload).catch((err) => console.error('syncAccountListToRtdb failed', err));
}

// Los gastos que llegan por el atajo se guardan primero en un "buzón" en
// Realtime Database, bajo la ruta del token (no del uid — así el atajo
// solo necesita conocer un valor para todo: ni sabe ni necesita tu uid).
// Cada vez que abres sesión se copian a Firestore como movimientos
// normales y se limpia el buzón.
async function drainInbox(uid, token) {
  if (!fb || !token) return;
  try {
    const inboxRef = fb.rt.ref(fb.rtdb, `txInbox/${token}`);
    const snap = await fb.rt.get(inboxRef);
    if (!snap.exists()) {
      $('#saveLabel').textContent = 'Buzón del atajo: vacío';
      $('#saveIndicator').classList.remove('error');
      $('#saveIndicator').classList.add('show');
      setTimeout(() => { $('#saveIndicator').classList.remove('show'); $('#saveLabel').textContent = 'Guardado'; }, 2500);
      return;
    }
    const entries = snap.val();
    const col = fb.fs.collection(fb.db, 'users', uid, 'transactions');
    const cleared = {};
    let count = 0;
    for (const [key, entry] of Object.entries(entries)) {
      cleared[key] = null;
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const type = entry.type === 'income' ? 'income' : 'expense';
      const list = categoriesFor(type);
      const normalizedInput = normalizeCategoryInput(entry.category);
      const matched = list.find((c) => c.id === normalizedInput || normalizeCategoryInput(c.label) === normalizedInput);
      const category = matched ? matched.id : FALLBACK_ID[type];
      // La cuenta es opcional (atajos ya configurados antes de esta función
      // no la mandan) — si no coincide con ninguna, el movimiento queda
      // sin cuenta asignada (accountId: '') para reasignar a mano.
      const normalizedAccount = typeof entry.account === 'string' ? normalizeCategoryInput(entry.account) : '';
      const matchedAccount = normalizedAccount
        ? accountsList().find((a) => a.id === normalizedAccount || normalizeCategoryInput(a.name) === normalizedAccount)
        : null;
      const accountId = matchedAccount ? matchedAccount.id : '';
      const date = entry.ts ? new Date(entry.ts).toISOString().slice(0, 10) : todayISO();
      const note = typeof entry.note === 'string' ? entry.note.slice(0, 120) : '';
      await fb.fs.addDoc(col, { amount, type, category, accountId, note, date, source: 'shortcut', createdAt: fb.fs.serverTimestamp() });
      count++;
    }
    await fb.rt.update(inboxRef, cleared);
    $('#saveLabel').textContent = `Sincronizados ${count} del atajo`;
    $('#saveIndicator').classList.remove('error');
    $('#saveIndicator').classList.add('show');
    setTimeout(() => { $('#saveIndicator').classList.remove('show'); $('#saveLabel').textContent = 'Guardado'; }, 2500);
  } catch (err) {
    console.error('drainInbox failed', err);
    $('#saveLabel').textContent = 'Error al sincronizar el atajo: ' + (err?.code || err?.message || 'desconocido');
    $('#saveIndicator').classList.add('error', 'show');
    setTimeout(() => { $('#saveIndicator').classList.remove('show', 'error'); $('#saveLabel').textContent = 'Guardado'; }, 4000);
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
function demoCategories() {
  const raw = localStorage.getItem('moneypro_demo_categories');
  if (!raw) return defaultCategoryDoc();
  try {
    const parsed = JSON.parse(raw);
    return (parsed && parsed.expense && parsed.income) ? parsed : defaultCategoryDoc();
  } catch {
    return defaultCategoryDoc();
  }
}
function demoAccounts() {
  const raw = localStorage.getItem('moneypro_demo_accounts');
  if (!raw) {
    const seed = defaultAccountDoc();
    if (seed.corriente[0]) seed.corriente[0].isDefault = true;
    return seed;
  }
  try {
    const parsed = JSON.parse(raw);
    return (parsed && parsed.corriente && parsed.credito) ? parsed : defaultAccountDoc();
  } catch {
    return defaultAccountDoc();
  }
}
function demoBudgets() {
  const raw = localStorage.getItem('moneypro_demo_budgets');
  if (!raw) return defaultBudgetDoc();
  try {
    return JSON.parse(raw) || defaultBudgetDoc();
  } catch {
    return defaultBudgetDoc();
  }
}
function startDemo() {
  state.demo = true;
  state.user = null;
  state.currency = localStorage.getItem('moneypro_demo_currency') || 'MXN';
  state.categories = demoCategories();
  state.accounts = demoAccounts();
  state.budgets = demoBudgets();
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
// CRUD de categorías/subcategorías (rama demo o real)
// ---------------------------------------------------------------------
function currentCategoryList(type) {
  return state.categories[type === 'income' ? 'income' : 'expense'];
}

async function persistCategories(newCategories) {
  state.categories = newCategories;
  if (state.demo) {
    localStorage.setItem('moneypro_demo_categories', JSON.stringify(newCategories));
  } else if (fb && state.user) {
    await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', state.user.uid, 'meta', 'categories'), newCategories);
    await syncCatListToRtdb();
  }
  renderCategoriesAdmin();
  renderAll();
}

async function addCategory(type, label) {
  const trimmed = (label || '').trim();
  if (!trimmed) return;
  const list = currentCategoryList(type);
  const id = slugify(trimmed);
  if (list.some((c) => c.id === id)) { alert('Ya existe una categoría con ese nombre.'); return; }
  const updated = { ...state.categories, [type]: [...list, { id, label: trimmed, icon: '🔧', subcategories: [] }] };
  await persistCategories(updated);
}

async function deleteCategory(type, id) {
  if (id === FALLBACK_ID[type]) { alert('Esta es la categoría de respaldo y no se puede eliminar.'); return; }
  const list = currentCategoryList(type);
  if (list.length <= 1) { alert('Debe quedar al menos una categoría.'); return; }
  if (!confirm('¿Eliminar esta categoría? Tus movimientos existentes con esta categoría no se borran.')) return;
  const updated = { ...state.categories, [type]: list.filter((c) => c.id !== id) };
  await persistCategories(updated);
}

async function renameCategory(type, id, newLabel) {
  const trimmed = (newLabel || '').trim();
  if (!trimmed) return;
  const list = currentCategoryList(type);
  const updated = { ...state.categories, [type]: list.map((c) => (c.id === id ? { ...c, label: trimmed } : c)) };
  await persistCategories(updated);
}

async function addSubcategory(type, categoryId, label) {
  const trimmed = (label || '').trim();
  if (!trimmed) return;
  const list = currentCategoryList(type);
  const updated = {
    ...state.categories,
    [type]: list.map((c) => {
      if (c.id !== categoryId) return c;
      const subId = slugify(trimmed);
      if ((c.subcategories || []).some((s) => s.id === subId)) return c;
      return { ...c, subcategories: [...(c.subcategories || []), { id: subId, label: trimmed }] };
    }),
  };
  await persistCategories(updated);
}

async function deleteSubcategory(type, categoryId, subId) {
  const list = currentCategoryList(type);
  const updated = {
    ...state.categories,
    [type]: list.map((c) => (c.id === categoryId ? { ...c, subcategories: (c.subcategories || []).filter((s) => s.id !== subId) } : c)),
  };
  await persistCategories(updated);
}

// ---------------------------------------------------------------------
// CRUD de cuentas (rama demo o real)
// ---------------------------------------------------------------------
function currentAccountList(kind) {
  return state.accounts[kind === 'credito' ? 'credito' : 'corriente'];
}

async function persistAccounts(newAccounts) {
  state.accounts = newAccounts;
  if (state.demo) {
    localStorage.setItem('moneypro_demo_accounts', JSON.stringify(newAccounts));
  } else if (fb && state.user) {
    await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', state.user.uid, 'meta', 'accounts'), newAccounts);
    await syncAccountListToRtdb();
  }
  renderAccountsAdmin();
  renderAll();
}

async function addAccount(kind, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  const list = currentAccountList(kind);
  const id = slugifyAccount(trimmed);
  if (list.some((a) => a.id === id)) { alert('Ya existe una cuenta con ese nombre.'); return; }
  const hasAnyAccount = accountsList().length > 0;
  const updated = {
    ...state.accounts,
    [kind]: [...list, { id, name: trimmed, icon: kind === 'credito' ? '💳' : '💵', kind, initialBalance: 0, isDefault: !hasAnyAccount }],
  };
  await persistAccounts(updated);
}

async function deleteAccount(kind, id) {
  if (!confirm('¿Eliminar esta cuenta? Tus movimientos existentes con esta cuenta no se borran, solo quedan sin cuenta asignada.')) return;
  const wasDefault = findAccount(state.accounts, id)?.isDefault;
  const updated = { ...state.accounts, [kind]: currentAccountList(kind).filter((a) => a.id !== id) };
  if (wasDefault) {
    const remaining = allAccounts(updated);
    if (remaining[0]) {
      updated.corriente = updated.corriente.map((a) => ({ ...a, isDefault: a.id === remaining[0].id }));
      updated.credito = updated.credito.map((a) => ({ ...a, isDefault: a.id === remaining[0].id }));
    }
  }
  await persistAccounts(updated);
}

async function renameAccount(kind, id, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return;
  const updated = { ...state.accounts, [kind]: currentAccountList(kind).map((a) => (a.id === id ? { ...a, name: trimmed } : a)) };
  await persistAccounts(updated);
}

async function setAccountInitialBalance(kind, id, value) {
  const num = parseFloat(value);
  const balance = Number.isFinite(num) ? num : 0;
  const updated = { ...state.accounts, [kind]: currentAccountList(kind).map((a) => (a.id === id ? { ...a, initialBalance: balance } : a)) };
  await persistAccounts(updated);
}

async function setDefaultAccount(id) {
  const updated = {
    corriente: state.accounts.corriente.map((a) => ({ ...a, isDefault: a.id === id })),
    credito: state.accounts.credito.map((a) => ({ ...a, isDefault: a.id === id })),
  };
  await persistAccounts(updated);
}

// ---------------------------------------------------------------------
// CRUD de presupuestos (rama demo o real)
// ---------------------------------------------------------------------
async function persistBudgets(newBudgets) {
  state.budgets = newBudgets;
  if (state.demo) {
    localStorage.setItem('moneypro_demo_budgets', JSON.stringify(newBudgets));
  } else if (fb && state.user) {
    await fb.fs.setDoc(fb.fs.doc(fb.db, 'users', state.user.uid, 'meta', 'budgets'), newBudgets);
  }
  renderAll();
}

async function setBudget(categoryId, amount, period) {
  const updated = { ...state.budgets, [categoryId]: { amount, period } };
  await persistBudgets(updated);
}

async function clearBudget(categoryId) {
  const updated = { ...state.budgets };
  delete updated[categoryId];
  await persistBudgets(updated);
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
  // El detalle de una cuenta no tiene su propio botón en la barra de
  // abajo — mientras se ve, dejamos "Cuentas" marcada como activa.
  const navMatch = view === 'cuenta-detalle' ? 'cuentas' : view;
  $$('.nav-tabs button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === navMatch));
  // El + agrega un movimiento — no aplica en Cuentas, Presupuesto ni
  // Ajustes (esas pantallas ya tienen sus propios controles), y ahí solo
  // estorbaba tapando el contenido de más abajo.
  $('#addFab').hidden = view === 'cuentas' || view === 'ajustes' || view === 'presupuesto';
  if (view === 'cuenta-detalle') renderAccountDetail();
  if (view === 'cuentas') renderAccountsAdmin();
  if (view === 'presupuesto') renderPresupuesto();
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
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    // Las transferencias mueven dinero entre tus propias cuentas — no son
    // ingreso ni gasto real, así que no cuentan en el balance del mes.
  }
  return { income, expense, balance: income - expense };
}

// Saldo de una cuenta: su saldo inicial + ingresos - gastos registrados en
// ella + transferencias entrantes - salientes. Para tarjetas de crédito
// (kind: 'credito') este mismo número resulta negativo al gastar — la UI
// lo muestra como deuda (ver accountDebtDisplay).
function accountBalance(id) {
  const acct = accountInfo(id);
  let balance = acct.initialBalance || 0;
  for (const t of state.txs) {
    if (t.type === 'transfer') {
      if (t.fromAccountId === id) balance -= t.amount;
      if (t.toAccountId === id) balance += t.amount;
    } else if (t.accountId === id) {
      if (t.type === 'income') balance += t.amount;
      else if (t.type === 'expense') balance -= t.amount;
    }
  }
  return balance;
}

function renderTxRow(t) {
  const row = document.createElement('div');
  row.className = 'tx-row';

  if (t.type === 'transfer') {
    const from = accountInfo(t.fromAccountId);
    const to = accountInfo(t.toAccountId);
    row.innerHTML = `
      <div class="tx-icon">🔁</div>
      <div class="tx-info">
        <div class="tx-cat">${escapeHtml(from.name)} → ${escapeHtml(to.name)}</div>
        <div class="tx-meta">${formatDateShort(t.date)}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
      </div>
      <div class="tx-amount">${formatMoney(t.amount)}</div>
    `;
    row.addEventListener('click', () => openTxModal(t));
    return row;
  }

  const info = categoryInfo(t.type, t.category);
  const sub = t.subcategory ? (info.subcategories || []).find((s) => s.id === t.subcategory) : null;
  const catLabel = sub ? `${info.label} · ${sub.label}` : info.label;
  const acctLabel = t.accountId ? accountInfo(t.accountId).name : '';
  row.innerHTML = `
    <div class="tx-icon">${info.icon}</div>
    <div class="tx-info">
      <div class="tx-cat">${escapeHtml(catLabel)}</div>
      <div class="tx-meta">${formatDateShort(t.date)}${acctLabel ? ' · ' + escapeHtml(acctLabel) : ''}${t.note ? ' · ' + escapeHtml(t.note) : ''}${t.source === 'shortcut' ? ' · ⚡ atajo' : ''}</div>
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
// Render: detalle de cuenta (movimientos de una sola cuenta)
// ---------------------------------------------------------------------
function distinctMonths() {
  const set = new Set(state.txs.map((t) => monthKey(t.date)));
  set.add(currentMonthKey());
  return Array.from(set).sort().reverse();
}

// Los movimientos ya no tienen su propia pestaña — se ven desde adentro
// de cada cuenta (Cuentas → tocar una cuenta), ya que Inicio ya muestra
// los recientes. Una transferencia "pertenece" a una cuenta si es el
// origen o el destino.
function txInvolvesAccount(t, accountId) {
  if (t.type === 'transfer') return t.fromAccountId === accountId || t.toAccountId === accountId;
  return t.accountId === accountId;
}

function openAccountDetail(accountId) {
  state.selectedAccountId = accountId;
  setView('cuenta-detalle');
}

function renderAccountDetail() {
  const acct = accountInfo(state.selectedAccountId);
  $('#acctDetailLabel').textContent = `${acct.icon} ${acct.name}`;
  const balance = accountBalance(state.selectedAccountId);
  $('#acctDetailBalance').textContent = formatMoney(acct.kind === 'credito' ? -balance : balance);

  const monthSel = $('#acctDetailFilterMonth');
  const months = distinctMonths();
  monthSel.innerHTML = '<option value="">Todos los meses</option>' + months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  monthSel.value = state.filterMonth;
  $('#acctDetailFilterType').value = state.filterType;

  let list = state.txs.filter((t) => txInvolvesAccount(t, state.selectedAccountId));
  if (state.filterMonth) list = list.filter((t) => monthKey(t.date) === state.filterMonth);
  if (state.filterType) list = list.filter((t) => t.type === state.filterType);
  list.sort((a, b) => b.date.localeCompare(a.date));

  const container = $('#acctDetailTxList');
  container.innerHTML = '';
  list.forEach((t) => container.appendChild(renderTxRow(t)));
  $('#acctDetailEmptyHint').hidden = list.length > 0;
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
  const donutData = categoriesFor('expense')
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
  const tokenPart = state.webhookToken || 'TU_TOKEN';
  return `${base}/txInbox/${tokenPart}.json`;
}
function shortcutCatListUrl(type = 'expense') {
  const base = firebaseConfig.databaseURL || 'https://TU_PROYECTO-default-rtdb.firebaseio.com';
  const tokenPart = state.webhookToken || 'TU_TOKEN';
  return `${base}/catList/${tokenPart}/${type}.json`;
}
function shortcutAccountListUrl(kind = 'corriente') {
  const base = firebaseConfig.databaseURL || 'https://TU_PROYECTO-default-rtdb.firebaseio.com';
  const tokenPart = state.webhookToken || 'TU_TOKEN';
  return `${base}/accountList/${tokenPart}/${kind}.json`;
}
function shortcutBodyTemplate() {
  // El token ya no va en el cuerpo — ahora es la URL misma
  // (txInbox/TU_TOKEN.json) la que autoriza la escritura. "account" es
  // opcional: si tu atajo no lo manda, el movimiento queda sin cuenta.
  return JSON.stringify({
    amount: 0,
    type: 'expense',
    category: 'comida',
    account: '',
    note: '',
    ts: { '.sv': 'timestamp' },
  }, null, 2);
}
function renderSettings() {
  $('#accountEmail').textContent = state.demo ? 'Modo demostración' : (state.user?.email || '—');
  $('#logoutBtn').hidden = state.demo;
  $('#demoUpgradeBtn').hidden = !state.demo;
  $('#currencySelect').value = state.currency;

  const tokenAvailable = !state.demo && !!state.webhookToken;
  // Token completo (sin enmascarar): hay que poder copiarlo tal cual para
  // pegarlo a mano en el campo "token" del atajo — una versión recortada
  // ahí rompe silenciosamente la escritura (no coincide con el real).
  $('#tokenDisplay').textContent = state.demo ? 'No disponible en modo demo' : (state.webhookToken || 'Generando…');
  $('#copyTokenBtn').disabled = !tokenAvailable;
  $('#copyCatUrlBtn').disabled = !tokenAvailable;
  $('#copyAcctUrlBtn').disabled = !tokenAvailable;
  $('#copyUrlBtn').disabled = !tokenAvailable;
  $('#copyBodyBtn').disabled = !tokenAvailable;
  $('#regenTokenBtn').disabled = state.demo;
  $('#demoTokenHint').hidden = !state.demo;

  renderCategoriesAdmin();
}

const EMOJI_PRESET = ['🍔', '🚗', '🏠', '🎬', '💊', '💡', '🛍️', '📚', '✈️', '🎁', '💼', '💻', '📈', '⛽', '🔧', '💰', '🐾', '🏋️', '🎮', '☕'];

function closeEmojiPicker() {
  $('.emoji-picker')?.remove();
}

function renderCategoryRow(type, cat) {
  const row = document.createElement('div');
  row.className = 'cat-row';

  const head = document.createElement('div');
  head.className = 'cat-row-head';

  const emojiBtn = document.createElement('button');
  emojiBtn.type = 'button';
  emojiBtn.className = 'cat-emoji-btn';
  emojiBtn.textContent = cat.icon;
  emojiBtn.title = 'Cambiar ícono';
  emojiBtn.addEventListener('click', () => {
    const existing = row.querySelector('.emoji-picker');
    closeEmojiPicker();
    if (existing) return; // ya estaba abierto: solo lo cerramos
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    EMOJI_PRESET.forEach((emoji) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = emoji;
      b.addEventListener('click', async () => {
        closeEmojiPicker();
        const list = currentCategoryList(type);
        const updated = { ...state.categories, [type]: list.map((c) => (c.id === cat.id ? { ...c, icon: emoji } : c)) };
        await persistCategories(updated);
      });
      picker.appendChild(b);
    });
    row.appendChild(picker);
  });

  const labelInput = document.createElement('input');
  labelInput.className = 'cat-label-input';
  labelInput.value = cat.label;
  labelInput.maxLength = 30;
  labelInput.addEventListener('change', () => renameCategory(type, cat.id, labelInput.value));

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cat-del-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Eliminar categoría';
  delBtn.addEventListener('click', () => deleteCategory(type, cat.id));

  head.append(emojiBtn, labelInput, delBtn);
  row.appendChild(head);

  const subs = document.createElement('div');
  subs.className = 'cat-subs';
  (cat.subcategories || []).forEach((sub) => {
    const chip = document.createElement('span');
    chip.className = 'sub-chip';
    chip.innerHTML = `${escapeHtml(sub.label)} `;
    const delSub = document.createElement('button');
    delSub.type = 'button';
    delSub.textContent = '✕';
    delSub.addEventListener('click', () => deleteSubcategory(type, cat.id, sub.id));
    chip.appendChild(delSub);
    subs.appendChild(chip);
  });
  const subInput = document.createElement('input');
  subInput.className = 'sub-add-input';
  subInput.placeholder = '+ subcategoría';
  subInput.maxLength = 30;
  subInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && subInput.value.trim()) {
      addSubcategory(type, cat.id, subInput.value);
      subInput.value = '';
    }
  });
  subs.appendChild(subInput);
  row.appendChild(subs);

  return row;
}

function renderCategoriesAdmin() {
  const expenseList = $('#expenseCatList');
  const incomeList = $('#incomeCatList');
  if (!expenseList || !incomeList) return;
  expenseList.innerHTML = '';
  incomeList.innerHTML = '';
  categoriesFor('expense').forEach((c) => expenseList.appendChild(renderCategoryRow('expense', c)));
  categoriesFor('income').forEach((c) => incomeList.appendChild(renderCategoryRow('income', c)));
}

function renderAccountRow(kind, acct) {
  const row = document.createElement('div');
  row.className = 'cat-row';

  const head = document.createElement('div');
  head.className = 'cat-row-head';

  const icon = document.createElement('span');
  icon.className = 'cat-emoji-btn';
  icon.textContent = acct.icon || (kind === 'credito' ? '💳' : '💵');

  const labelInput = document.createElement('input');
  labelInput.className = 'cat-label-input';
  labelInput.value = acct.name;
  labelInput.maxLength = 30;
  labelInput.addEventListener('change', () => renameAccount(kind, acct.id, labelInput.value));

  const balance = accountBalance(acct.id);
  const balanceEl = document.createElement('button');
  balanceEl.type = 'button';
  balanceEl.className = 'acct-row-balance' + (balance < 0 ? ' negative' : '');
  balanceEl.textContent = formatMoney(kind === 'credito' ? -balance : balance);
  balanceEl.title = 'Ver movimientos de esta cuenta';
  balanceEl.addEventListener('click', () => openAccountDetail(acct.id));

  const defaultBtn = document.createElement('button');
  defaultBtn.type = 'button';
  defaultBtn.className = 'acct-default-btn' + (acct.isDefault ? ' active' : '');
  defaultBtn.textContent = '⭐';
  defaultBtn.title = acct.isDefault ? 'Cuenta predeterminada' : 'Marcar como predeterminada';
  defaultBtn.addEventListener('click', () => setDefaultAccount(acct.id));

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cat-del-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Eliminar cuenta';
  delBtn.addEventListener('click', () => deleteAccount(kind, acct.id));

  head.append(icon, labelInput, balanceEl, defaultBtn, delBtn);
  row.appendChild(head);

  const sub = document.createElement('div');
  sub.className = 'acct-row-sub';
  const balLabel = document.createElement('span');
  balLabel.className = 'acct-balance-label';
  balLabel.textContent = kind === 'credito' ? 'Deuda inicial' : 'Saldo inicial';
  const balInput = document.createElement('input');
  balInput.type = 'number';
  balInput.step = '0.01';
  balInput.className = 'acct-balance-input';
  balInput.value = acct.initialBalance || 0;
  balInput.addEventListener('change', () => setAccountInitialBalance(kind, acct.id, balInput.value));
  sub.append(balLabel, balInput);
  row.appendChild(sub);

  return row;
}

function renderAccountsAdmin() {
  const corrienteList = $('#corrienteAcctList');
  const creditoList = $('#creditoAcctList');
  if (!corrienteList || !creditoList) return;
  corrienteList.innerHTML = '';
  creditoList.innerHTML = '';
  currentAccountList('corriente').forEach((a) => corrienteList.appendChild(renderAccountRow('corriente', a)));
  currentAccountList('credito').forEach((a) => creditoList.appendChild(renderAccountRow('credito', a)));

  const corrienteTotal = currentAccountList('corriente').reduce((sum, a) => sum + accountBalance(a.id), 0);
  const creditoTotal = currentAccountList('credito').reduce((sum, a) => sum - accountBalance(a.id), 0);
  $('#corrienteTotal').textContent = formatMoney(corrienteTotal);
  $('#creditoTotal').textContent = formatMoney(creditoTotal);
}

// ---------------------------------------------------------------------
// Render: Presupuesto
// ---------------------------------------------------------------------
// Anillo SVG alrededor del ícono de la categoría: se va llenando según
// % de lo presupuestado (equivalente mensual) que ya se gastó ese mes.
// pct === null significa "sin presupuesto asignado" (anillo vacío, gris).
const BUDGET_RING_RADIUS = 19;
const BUDGET_RING_CIRC = 2 * Math.PI * BUDGET_RING_RADIUS;

function budgetRingColor(pct) {
  if (pct === null) return null;
  if (pct >= 100) return 'var(--danger)';
  if (pct >= 80) return 'var(--series-4)';
  return 'var(--accent)';
}

function buildBudgetRing(icon, pct) {
  const wrap = document.createElement('div');
  wrap.className = 'budget-ring';
  const clamped = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  const offset = BUDGET_RING_CIRC * (1 - clamped / 100);
  const color = budgetRingColor(pct);
  wrap.innerHTML = `
    <svg viewBox="0 0 44 44">
      <circle class="budget-ring-track" cx="22" cy="22" r="${BUDGET_RING_RADIUS}"></circle>
      ${pct !== null ? `<circle class="budget-ring-progress" cx="22" cy="22" r="${BUDGET_RING_RADIUS}" style="stroke:${color};stroke-dasharray:${BUDGET_RING_CIRC};stroke-dashoffset:${offset};"></circle>` : ''}
    </svg>
    <span class="budget-ring-icon">${icon}</span>
  `;
  return wrap;
}

function renderBudgetRow(cat, key) {
  const budget = state.budgets[cat.id];
  const amount = budget?.amount || 0;
  const period = budget?.period || DEFAULT_BUDGET_PERIOD;
  const monthly = monthlyEquivalent(amount, period);
  const spent = budgetSpentForCategory(cat.id, key);
  const pct = monthly > 0 ? Math.round((spent / monthly) * 100) : null;

  const row = document.createElement('div');
  row.className = 'budget-row';

  const head = document.createElement('div');
  head.className = 'budget-row-head';
  head.appendChild(buildBudgetRing(cat.icon, pct));

  const info = document.createElement('div');
  info.className = 'budget-row-info';
  const title = document.createElement('div');
  title.className = 'budget-row-title';
  title.textContent = cat.label;
  info.appendChild(title);
  const sub = document.createElement('div');
  const color = budgetRingColor(pct);
  sub.className = 'budget-row-sub';
  if (color) sub.style.color = color;
  sub.textContent = monthly > 0
    ? `${formatMoney(spent)} de ${formatMoney(monthly)} · ${pct}%`
    : 'Sin presupuesto asignado';
  info.appendChild(sub);
  head.appendChild(info);
  row.appendChild(head);

  const edit = document.createElement('div');
  edit.className = 'budget-row-edit';
  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.step = '0.01';
  amountInput.min = '0';
  amountInput.className = 'acct-balance-input';
  amountInput.placeholder = '0';
  amountInput.value = amount || '';
  const periodSelect = document.createElement('select');
  periodSelect.className = 'select-field budget-period-select';
  Object.entries(BUDGET_PERIODS).forEach(([key2, def]) => {
    const opt = document.createElement('option');
    opt.value = key2;
    opt.textContent = def.label;
    if (key2 === period) opt.selected = true;
    periodSelect.appendChild(opt);
  });
  const apply = () => {
    const num = parseFloat(amountInput.value);
    if (Number.isFinite(num) && num > 0) setBudget(cat.id, num, periodSelect.value);
    else if (budget) clearBudget(cat.id);
  };
  amountInput.addEventListener('change', apply);
  periodSelect.addEventListener('change', apply);
  edit.append(amountInput, periodSelect);
  row.appendChild(edit);

  return row;
}

function renderPresupuesto() {
  const list = $('#budgetList');
  if (!list) return;
  const key = currentMonthKey();
  list.innerHTML = '';
  let totalBudget = 0, totalSpent = 0, anyBudget = false;
  categoriesFor('expense').forEach((cat) => {
    const budget = state.budgets[cat.id];
    if (budget && budget.amount > 0) {
      anyBudget = true;
      totalBudget += monthlyEquivalent(budget.amount, budget.period);
      totalSpent += budgetSpentForCategory(cat.id, key);
    }
    list.appendChild(renderBudgetRow(cat, key));
  });

  $('#budgetSummaryCard').hidden = !anyBudget;
  if (anyBudget) {
    $('#budgetSummaryMonth').textContent = monthLabel(key);
    $('#budgetSummaryAmount').textContent = formatMoney(totalBudget - totalSpent);
    $('#budgetSummarySpent').textContent = `${formatMoney(totalSpent)} / ${formatMoney(totalBudget)}`;
  }
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
      state.txSubcategory = '';
      $$('.category-chip', grid).forEach((el) => el.classList.remove('active'));
      chip.classList.add('active');
      buildSubcategoryGrid();
    });
    grid.appendChild(chip);
  });
}

function buildSubcategoryGrid() {
  const field = $('#txSubcategoryField');
  const grid = $('#txSubcategoryGrid');
  const cat = categoryInfo(state.txType, state.txCategory);
  const subs = cat?.subcategories || [];
  grid.innerHTML = '';
  field.hidden = subs.length === 0;
  if (subs.length === 0) { state.txSubcategory = ''; return; }
  subs.forEach((s) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip' + (s.id === state.txSubcategory ? ' active' : '');
    chip.innerHTML = `<span class="cat-label">${s.label}</span>`;
    chip.addEventListener('click', () => {
      state.txSubcategory = state.txSubcategory === s.id ? '' : s.id;
      $$('.category-chip', grid).forEach((el) => el.classList.remove('active'));
      if (state.txSubcategory) chip.classList.add('active');
    });
    grid.appendChild(chip);
  });
}

function buildAccountGrid() {
  const grid = $('#txAccountGrid');
  grid.innerHTML = '';
  const noneChip = document.createElement('button');
  noneChip.type = 'button';
  noneChip.className = 'category-chip' + (!state.txAccount ? ' active' : '');
  noneChip.innerHTML = '<span class="cat-emoji">❔</span><span class="cat-label">Sin cuenta</span>';
  noneChip.addEventListener('click', () => {
    state.txAccount = '';
    $$('.category-chip', grid).forEach((el) => el.classList.remove('active'));
    noneChip.classList.add('active');
  });
  grid.appendChild(noneChip);
  accountsList().forEach((a) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip' + (a.id === state.txAccount ? ' active' : '');
    chip.innerHTML = `<span class="cat-emoji">${a.icon}</span><span class="cat-label">${a.name}</span>`;
    chip.addEventListener('click', () => {
      state.txAccount = a.id;
      $$('.category-chip', grid).forEach((el) => el.classList.remove('active'));
      chip.classList.add('active');
    });
    grid.appendChild(chip);
  });
}

function buildTransferSideGrid(gridSel, selectedId, onSelect) {
  const grid = $(gridSel);
  grid.innerHTML = '';
  accountsList().forEach((a) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip' + (a.id === selectedId ? ' active' : '');
    chip.innerHTML = `<span class="cat-emoji">${a.icon}</span><span class="cat-label">${a.name}</span>`;
    chip.addEventListener('click', () => {
      onSelect(a.id);
      $$('.category-chip', grid).forEach((el) => el.classList.remove('active'));
      chip.classList.add('active');
    });
    grid.appendChild(chip);
  });
}
function buildTransferGrids() {
  buildTransferSideGrid('#txFromAccountGrid', state.txFromAccount, (id) => { state.txFromAccount = id; });
  buildTransferSideGrid('#txToAccountGrid', state.txToAccount, (id) => { state.txToAccount = id; });
}

function updateTxFieldVisibility() {
  const isTransfer = state.txType === 'transfer';
  $('#txCategoryField').hidden = isTransfer;
  $('#txAccountField').hidden = isTransfer;
  $('#txFromAccountField').hidden = !isTransfer;
  $('#txToAccountField').hidden = !isTransfer;
  if (isTransfer) $('#txSubcategoryField').hidden = true;
}

function openTxModal(tx = null) {
  state.editingTxId = tx?.id || null;
  state.txType = tx?.type || 'expense';
  // Si abres el + desde el detalle de una cuenta, preselecciona esa
  // cuenta en vez de la predeterminada global — es la que más sentido
  // tiene ahí.
  const contextAccountId = (state.view === 'cuenta-detalle' && state.selectedAccountId) || currentDefaultAccountId();

  if (state.txType === 'transfer') {
    state.txFromAccount = tx ? (tx.fromAccountId || '') : (contextAccountId || '');
    state.txToAccount = tx ? (tx.toAccountId || '') : '';
  } else {
    state.txCategory = tx?.category || categoriesFor(state.txType)[0].id;
    state.txSubcategory = tx?.subcategory || '';
    state.txAccount = tx ? (tx.accountId || '') : (contextAccountId || '');
  }

  $('#txModalTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#txAmount').value = tx ? tx.amount : '';
  $('#txDate').value = tx ? tx.date : todayISO();
  $('#txNote').value = tx?.note || '';
  $('#txError').hidden = true;
  $('#txDelete').hidden = !tx;
  $$('#txTypeToggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.txType));
  updateTxFieldVisibility();
  if (state.txType === 'transfer') {
    buildTransferGrids();
  } else {
    buildCategoryGrid();
    buildSubcategoryGrid();
    buildAccountGrid();
  }
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

  let data;
  if (state.txType === 'transfer') {
    if (!state.txFromAccount || !state.txToAccount) {
      $('#txError').textContent = 'Elige la cuenta de origen y destino.';
      $('#txError').hidden = false;
      return;
    }
    if (state.txFromAccount === state.txToAccount) {
      $('#txError').textContent = 'La cuenta de origen y destino no pueden ser la misma.';
      $('#txError').hidden = false;
      return;
    }
    data = { amount, type: 'transfer', fromAccountId: state.txFromAccount, toAccountId: state.txToAccount, date, note };
  } else {
    data = { amount, type: state.txType, category: state.txCategory, subcategory: state.txSubcategory || '', accountId: state.txAccount || '', date, note };
  }

  try {
    await saveTransaction(data);
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
  if (state.view === 'cuenta-detalle') renderAccountDetail();
  if (state.view === 'cuentas') renderAccountsAdmin();
  if (state.view === 'presupuesto') renderPresupuesto();
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
    $$('#txTypeToggle button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    updateTxFieldVisibility();
    if (state.txType === 'transfer') {
      if (!state.txFromAccount) state.txFromAccount = currentDefaultAccountId() || '';
      buildTransferGrids();
    } else {
      state.txCategory = categoriesFor(state.txType)[0].id;
      state.txSubcategory = '';
      if (!state.txAccount) state.txAccount = currentDefaultAccountId() || '';
      buildCategoryGrid();
      buildSubcategoryGrid();
      buildAccountGrid();
    }
  }));

  $('#acctDetailFilterMonth').addEventListener('change', (e) => { state.filterMonth = e.target.value; renderAccountDetail(); });
  $('#acctDetailFilterType').addEventListener('change', (e) => { state.filterType = e.target.value; renderAccountDetail(); });
  $('#acctDetailBack').addEventListener('click', () => setView('cuentas'));
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

  $('#copyTokenBtn').addEventListener('click', async () => {
    const token = state.webhookToken || '';
    try {
      await navigator.clipboard.writeText(token);
      showSaved(true);
      $('#saveLabel').textContent = 'Token copiado';
      setTimeout(() => { $('#saveLabel').textContent = 'Guardado'; }, 1800);
    } catch {
      prompt('Copia este token:', token);
    }
  });
  $('#copyCatUrlBtn').addEventListener('click', async () => {
    const url = shortcutCatListUrl('expense');
    try {
      await navigator.clipboard.writeText(url);
      showSaved(true);
      $('#saveLabel').textContent = 'URL de categorías copiada';
      setTimeout(() => { $('#saveLabel').textContent = 'Guardado'; }, 1800);
    } catch {
      prompt('Copia esta URL:', url);
    }
  });
  $('#copyAcctUrlBtn').addEventListener('click', async () => {
    const url = shortcutAccountListUrl('corriente');
    try {
      await navigator.clipboard.writeText(url);
      showSaved(true);
      $('#saveLabel').textContent = 'URL de cuentas copiada';
      setTimeout(() => { $('#saveLabel').textContent = 'Guardado'; }, 1800);
    } catch {
      prompt('Copia esta URL:', url);
    }
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
    const body = shortcutBodyTemplate();
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

  $('#expenseCatAddBtn').addEventListener('click', () => {
    addCategory('expense', $('#expenseCatInput').value);
    $('#expenseCatInput').value = '';
  });
  $('#expenseCatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#expenseCatAddBtn').click(); });
  $('#incomeCatAddBtn').addEventListener('click', () => {
    addCategory('income', $('#incomeCatInput').value);
    $('#incomeCatInput').value = '';
  });
  $('#incomeCatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#incomeCatAddBtn').click(); });

  $('#corrienteAcctAddBtn').addEventListener('click', () => {
    addAccount('corriente', $('#corrienteAcctInput').value);
    $('#corrienteAcctInput').value = '';
  });
  $('#corrienteAcctInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#corrienteAcctAddBtn').click(); });
  $('#creditoAcctAddBtn').addEventListener('click', () => {
    addAccount('credito', $('#creditoAcctInput').value);
    $('#creditoAcctInput').value = '';
  });
  $('#creditoAcctInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#creditoAcctAddBtn').click(); });

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
