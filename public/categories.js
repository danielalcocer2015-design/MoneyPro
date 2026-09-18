// Categorías por defecto de MoneyPro (se copian a la cuenta de cada
// usuario al crearla — ver app.js seedDefaultCategories). Cada usuario
// puede después agregar, renombrar o borrar las suyas desde Ajustes →
// Categorías; el orden importa: los colores de gráficas (charts.js) se
// asignan por posición usando la paleta categórica validada del sistema
// de diseño (8 tonos, orden fijo, nunca ciclado).
//
// "otros" / "otros_ingresos" son el respaldo: no se pueden borrar (ver
// app.js deleteCategory), así siempre hay dónde caer si el atajo manda
// una categoría que ya no existe.

export const DEFAULT_EXPENSE_CATEGORIES = [
  { id: 'comida', label: 'Comida', icon: '🍔', subcategories: [] },
  { id: 'transporte', label: 'Transporte', icon: '🚗', subcategories: [] },
  { id: 'vivienda', label: 'Vivienda', icon: '🏠', subcategories: [] },
  { id: 'ocio', label: 'Ocio', icon: '🎬', subcategories: [] },
  { id: 'salud', label: 'Salud', icon: '💊', subcategories: [] },
  { id: 'servicios', label: 'Servicios', icon: '💡', subcategories: [] },
  { id: 'compras', label: 'Compras', icon: '🛍️', subcategories: [] },
  { id: 'otros', label: 'Otros', icon: '🔧', subcategories: [] },
];

export const DEFAULT_INCOME_CATEGORIES = [
  { id: 'salario', label: 'Salario', icon: '💼', subcategories: [] },
  { id: 'freelance', label: 'Freelance', icon: '💻', subcategories: [] },
  { id: 'inversion', label: 'Inversión', icon: '📈', subcategories: [] },
  { id: 'regalo', label: 'Regalo', icon: '🎁', subcategories: [] },
  { id: 'otros_ingresos', label: 'Otros ingresos', icon: '🔧', subcategories: [] },
];

export const FALLBACK_ID = { expense: 'otros', income: 'otros_ingresos' };

export function defaultCategoryDoc() {
  return {
    expense: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, subcategories: [] })),
    income: DEFAULT_INCOME_CATEGORIES.map((c) => ({ ...c, subcategories: [] })),
  };
}

// Convierte una etiqueta escrita por el usuario ("Gasolina y peajes") en
// un id estable ("gasolina_y_peajes"): sin acentos, minúsculas, espacios
// y símbolos como "_". Se usa para categorías/subcategorías nuevas.
export function slugify(label) {
  const base = (label || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `cat_${Math.random().toString(36).slice(2, 8)}`;
}

export function findCategory(list, id) {
  return (list || []).find((c) => c.id === id) || (list || [])[list.length - 1] || null;
}
