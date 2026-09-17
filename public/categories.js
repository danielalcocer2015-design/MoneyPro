// Categorías fijas de MoneyPro. El orden importa: los colores de gráficas
// (public/charts.js) se asignan por posición usando la paleta categórica
// validada del sistema de diseño (8 tonos, orden fijo, nunca ciclado).
// Debe coincidir con EXPENSE_CATEGORIES/INCOME_CATEGORIES en functions/index.js.

export const EXPENSE_CATEGORIES = [
  { id: 'comida', label: 'Comida', icon: '🍔' },
  { id: 'transporte', label: 'Transporte', icon: '🚗' },
  { id: 'vivienda', label: 'Vivienda', icon: '🏠' },
  { id: 'ocio', label: 'Ocio', icon: '🎬' },
  { id: 'salud', label: 'Salud', icon: '💊' },
  { id: 'servicios', label: 'Servicios', icon: '💡' },
  { id: 'compras', label: 'Compras', icon: '🛍️' },
  { id: 'otros', label: 'Otros', icon: '🔧' },
];

export const INCOME_CATEGORIES = [
  { id: 'salario', label: 'Salario', icon: '💼' },
  { id: 'freelance', label: 'Freelance', icon: '💻' },
  { id: 'inversion', label: 'Inversión', icon: '📈' },
  { id: 'regalo', label: 'Regalo', icon: '🎁' },
  { id: 'otros_ingresos', label: 'Otros ingresos', icon: '🔧' },
];

export function categoriesFor(type) {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export function categoryInfo(type, id) {
  const list = categoriesFor(type);
  return list.find((c) => c.id === id) || list[list.length - 1];
}
