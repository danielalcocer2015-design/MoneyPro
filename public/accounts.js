// Cuentas por defecto de MoneyPro (se copian a la cuenta de cada usuario
// al crearla — ver app.js seedDefaultAccounts). Cada usuario puede
// después agregar, renombrar o borrar las suyas desde Cuentas.
//
// Dos grupos: "corriente" (efectivo, débito, ahorro — dinero que tienes)
// y "credito" (tarjetas de crédito — dinero que debes). El saldo de
// ambas se calcula igual (saldoInicial + ingresos - gastos + transferencias
// entrantes - salientes); para "credito" la UI muestra -saldo como deuda,
// ya que gastar en una tarjeta baja el saldo interno hacia negativo.

export const DEFAULT_ACCOUNTS = {
  corriente: [
    { id: 'efectivo', name: 'Efectivo', icon: '💵', kind: 'corriente', initialBalance: 0 },
  ],
  credito: [],
};

export function defaultAccountDoc() {
  return {
    corriente: DEFAULT_ACCOUNTS.corriente.map((a) => ({ ...a })),
    credito: DEFAULT_ACCOUNTS.credito.map((a) => ({ ...a })),
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

export function allAccounts(doc) {
  if (!doc) return [];
  return [...(doc.corriente || []), ...(doc.credito || [])];
}

export function findAccount(doc, id) {
  return allAccounts(doc).find((a) => a.id === id) || null;
}

export function defaultAccountId(doc) {
  const list = allAccounts(doc);
  const marked = list.find((a) => a.isDefault);
  return (marked || list[0] || null)?.id || null;
}
