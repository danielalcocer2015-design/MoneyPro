// Cuentas por defecto de MoneyPro (se copian a la cuenta de cada usuario
// al crearla — ver app.js seedDefaultAccounts). Cada usuario puede
// después agregar, renombrar o borrar las suyas desde Cuentas.
//
// Tres grupos: "corriente" (efectivo, débito, ahorro — dinero que tienes),
// "credito" (tarjetas de crédito — dinero que debes), y "activo" (otros
// activos: coche, casa, terrenos, inversiones — cosas con valor que no
// tienen movimientos, solo un valor que ajustas cuando quieras). El saldo
// de corriente/credito se calcula con sus movimientos (saldoInicial +
// ingresos - gastos + transferencias entrantes - salientes); para
// "credito" la UI muestra -saldo como deuda. Un "activo" nunca recibe
// movimientos — su saldo ES su "saldoInicial" (aquí lo llamamos "Valor"
// en la UI), así que reutiliza exactamente el mismo cálculo sin cambios.
//
// "activo" nunca es seleccionable en el modal de movimiento ni puede ser
// la cuenta predeterminada — ver transactableAccounts/defaultAccountId.

export const DEFAULT_ACCOUNTS = {
  corriente: [
    { id: 'efectivo', name: 'Efectivo', icon: '💵', kind: 'corriente', initialBalance: 0 },
  ],
  credito: [],
  activo: [],
};

export function defaultAccountDoc() {
  return {
    corriente: DEFAULT_ACCOUNTS.corriente.map((a) => ({ ...a })),
    credito: DEFAULT_ACCOUNTS.credito.map((a) => ({ ...a })),
    activo: DEFAULT_ACCOUNTS.activo.map((a) => ({ ...a })),
  };
}

export function slugifyAccount(name) {
  const base = (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `cuenta_${Math.random().toString(36).slice(2, 8)}`;
}

// Cuentas que se pueden elegir en un movimiento o como predeterminada —
// excluye "activo" (no tiene sentido registrar un gasto/ingreso contra tu
// casa o tus acciones).
export function transactableAccounts(doc) {
  if (!doc) return [];
  return [...(doc.corriente || []), ...(doc.credito || [])];
}

// Todas las cuentas, incluidos los activos — para mostrar/buscar por id,
// no para elegir en un movimiento (ver transactableAccounts).
export function allAccounts(doc) {
  if (!doc) return [];
  return [...(doc.corriente || []), ...(doc.credito || []), ...(doc.activo || [])];
}

export function findAccount(doc, id) {
  return allAccounts(doc).find((a) => a.id === id) || null;
}

export function defaultAccountId(doc) {
  const list = transactableAccounts(doc);
  const marked = list.find((a) => a.isDefault);
  return (marked || list[0] || null)?.id || null;
}
