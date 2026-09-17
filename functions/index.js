// OPCIONAL — requiere el plan Blaze (pago por uso; gratis dentro de la
// cuota mensual normal). No está conectado a firebase.json por defecto:
// la app usa un atajo basado en Realtime Database que funciona en el
// plan Spark (ver database.rules.json y public/app.js → drainInbox).
//
// Si más adelante subes a Blaze y quieres el webhook simple por
// query-string (/api/add?token=...&amount=...) en vez del JSON de
// Realtime Database, agrega de nuevo a firebase.json:
//   "functions": [{ "source": "functions", "codebase": "default" }]
//   y en "hosting.rewrites": { "source": "/api/**", "function": "api" }
// luego: cd functions && npm install && cd .. && firebase deploy --only functions,hosting
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';

function newToken() {
  return crypto.randomBytes(18).toString('base64url'); // 24 chars, URL-safe
}

// ---------------------------------------------------------------------
// regenerateToken — callable desde la app (usuario autenticado).
// Crea (o reemplaza) el token privado que usan los atajos de iOS/Android
// para llamar al webhook /api/add sin tener que iniciar sesión.
// ---------------------------------------------------------------------
exports.regenerateToken = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión primero.');

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const oldToken = userSnap.exists ? userSnap.data().webhookToken : null;

  const token = newToken();
  const batch = db.batch();
  if (oldToken) batch.delete(db.collection('webhookTokens').doc(oldToken));
  batch.set(db.collection('webhookTokens').doc(token), { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  batch.set(userRef, { webhookToken: token }, { merge: true });
  await batch.commit();

  return { token };
});

// ---------------------------------------------------------------------
// api — endpoint HTTP que llaman los Atajos de iOS / HTTP Shortcuts en
// Android. Sin sesión: se autentica con el token privado por-usuario.
// ---------------------------------------------------------------------
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const EXPENSE_CATEGORIES = ['comida', 'transporte', 'vivienda', 'ocio', 'salud', 'servicios', 'compras', 'otros'];
const INCOME_CATEGORIES = ['salario', 'freelance', 'inversion', 'regalo', 'otros_ingresos'];

async function resolveUid(token) {
  if (!token || typeof token !== 'string') return null;
  const snap = await db.collection('webhookTokens').doc(token).get();
  if (!snap.exists) return null;
  return snap.data().uid;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// GET o POST /add — parámetros: token, amount (o a), type (o t: income|expense),
// category (o c), note (o n), date. Pensado para "Obtener contenido de URL" en
// Atajos de iOS y para HTTP Shortcuts en Android.
app.all('/add', async (req, res) => {
  const p = { ...req.query, ...req.body };
  const token = p.token || p.tok;
  const uid = await resolveUid(token);
  if (!uid) return res.status(401).json({ ok: false, error: 'Token inválido. Revisa la URL del atajo en Ajustes.' });

  const amount = parseFloat(p.amount ?? p.a);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Falta un monto válido (amount).' });
  }

  const rawType = (p.type ?? p.t ?? 'expense').toString().toLowerCase();
  const type = rawType === 'income' || rawType === 'ingreso' ? 'income' : 'expense';

  let category = (p.category ?? p.c ?? '').toString().trim().toLowerCase();
  const validCategories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!category || !validCategories.includes(category)) category = type === 'income' ? 'otros_ingresos' : 'otros';

  const note = (p.note ?? p.n ?? '').toString().slice(0, 200);
  const dateRaw = (p.date ?? '').toString();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayISO();

  try {
    await db.collection('users').doc(uid).collection('transactions').add({
      amount,
      type,
      category,
      note,
      date,
      source: 'shortcut',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const label = type === 'income' ? 'Ingreso' : 'Gasto';
    return res.status(200).json({ ok: true, message: `${label} de ${amount.toFixed(2)} registrado en ${category}.` });
  } catch (err) {
    logger.error('add failed', err);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el movimiento.' });
  }
});

// GET /balance?token=... — resumen del mes actual, útil para que el atajo
// lea en voz alta el balance con Siri o lo muestre en una notificación.
app.all('/balance', async (req, res) => {
  const token = req.query.token || req.body?.token;
  const uid = await resolveUid(token);
  if (!uid) return res.status(401).json({ ok: false, error: 'Token inválido.' });

  const monthStart = todayISO().slice(0, 7) + '-01';
  try {
    const snap = await db.collection('users').doc(uid).collection('transactions')
      .where('date', '>=', monthStart).get();

    let income = 0, expense = 0;
    snap.forEach((doc) => {
      const t = doc.data();
      if (t.type === 'income') income += t.amount; else expense += t.amount;
    });
    const balance = income - expense;
    return res.status(200).json({
      ok: true,
      income, expense, balance,
      message: `Este mes: ${income.toFixed(2)} en ingresos, ${expense.toFixed(2)} en gastos, balance ${balance.toFixed(2)}.`,
    });
  } catch (err) {
    logger.error('balance failed', err);
    return res.status(500).json({ ok: false, error: 'No se pudo calcular el balance.' });
  }
});

exports.api = onRequest({ region: REGION, cors: true }, app);
