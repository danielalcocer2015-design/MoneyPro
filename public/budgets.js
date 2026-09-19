// Presupuestos por categoría de gasto (público/personal de cada usuario —
// ver app.js seedDefaultAccounts para el patrón equivalente de cuentas).
//
// Cada categoría de gasto puede tener un presupuesto en la frecuencia que
// el usuario prefiera (semanal, quincenal, mensual o anual) — la app lo
// convierte solita a su equivalente mensual para poder compararlo contra
// lo gastado en el mes en curso, sin importar en qué frecuencia se haya
// definido ("sincronizados", como pidió el usuario).
//
// "Quincenal" aquí sigue la convención mexicana: dos veces al mes (los
// días 15 y 30), no cada 14 días — por eso el factor es exactamente 2,
// no 52/24.

export const BUDGET_PERIODS = {
  weekly: { label: 'Semanal', toMonthly: 52 / 12 },
  biweekly: { label: 'Quincenal', toMonthly: 2 },
  monthly: { label: 'Mensual', toMonthly: 1 },
  yearly: { label: 'Anual', toMonthly: 1 / 12 },
};

export const DEFAULT_BUDGET_PERIOD = 'monthly';

export function monthlyEquivalent(amount, period) {
  const factor = BUDGET_PERIODS[period]?.toMonthly ?? 1;
  const num = Number(amount);
  return Number.isFinite(num) ? num * factor : 0;
}

export function defaultBudgetDoc() {
  return {}; // { [categoryId]: { amount: number, period: 'weekly'|'biweekly'|'monthly'|'yearly' } }
}
