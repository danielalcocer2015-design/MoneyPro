// Gráficas dibujadas a mano en SVG/HTML siguiendo la paleta categórica
// validada (dataviz skill): orden fijo de tonos, nunca ciclado; leyenda
// siempre presente en series >=2; identidad nunca solo por color.

const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------------
// Donut: gastos por categoría de un mes
// data: [{ id, label, icon, value, seriesIndex }] ya ordenado desc
// ---------------------------------------------------------------------
export function renderDonutChart(container, data, formatMoney, opts = {}) {
  const { centerLabel = 'Total gastado', centerValue = null, emptyMessage = 'Sin gastos registrados este mes.' } = opts;
  container.innerHTML = '';
  const total = data.reduce((s, d) => s + d.value, 0);

  if (!total) {
    container.innerHTML = `<p class="chart-empty">${emptyMessage}</p>`;
    return;
  }

  const r = 68, cx = 100, cy = 100, strokeWidth = 26;
  const circumference = 2 * Math.PI * r;
  const gap = 3;
  let cumulative = 0;

  const circles = data.map((d) => {
    const color = `var(${SERIES_VARS[d.seriesIndex % SERIES_VARS.length]})`;
    const frac = d.value / total;
    const segLen = frac * circumference;
    const dash = Math.max(segLen - gap, 1);
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-cumulative}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})">
      <title>${d.label}: ${formatMoney(d.value)} (${Math.round(frac * 100)}%)</title>
    </circle>`;
    cumulative += segLen;
    return el;
  }).join('');

  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  wrap.innerHTML = `
    <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Gastos por categoría">${circles}</svg>
    <div class="donut-center">
      <div class="donut-center-label">${centerLabel}</div>
      <div class="donut-center-value">${formatMoney(centerValue !== null ? centerValue : total)}</div>
    </div>
  `;
  container.appendChild(wrap);

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = data.map((d) => `
    <span class="legend-item">
      <span class="legend-dot" style="background:var(${SERIES_VARS[d.seriesIndex % SERIES_VARS.length]})"></span>
      ${d.icon} ${d.label} <strong>${formatMoney(d.value)}</strong>
    </span>
  `).join('');
  container.appendChild(legend);
}

// ---------------------------------------------------------------------
// Barras: ingresos vs. gastos por mes (últimos 6 meses)
// data: [{ key, label, income, expense }]
// ---------------------------------------------------------------------
export function renderBarChart(container, data, formatMoney) {
  container.innerHTML = '';
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  if (!data.some((d) => d.income || d.expense)) {
    container.innerHTML = '<p class="chart-empty">Aún no hay suficientes movimientos.</p>';
    return;
  }

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `
    <span class="legend-item"><span class="legend-dot" style="background:var(--series-1)"></span>Ingresos</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--series-2)"></span>Gastos</span>
  `;
  container.appendChild(legend);

  const chart = document.createElement('div');
  chart.className = 'bar-chart';
  data.forEach((d) => {
    const incomePct = Math.max((d.income / max) * 100, d.income > 0 ? 2 : 0);
    const expensePct = Math.max((d.expense / max) * 100, d.expense > 0 ? 2 : 0);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-month">${d.label}</div>
      <div class="bar-track" title="Ingresos: ${formatMoney(d.income)}"><div class="bar-fill income" style="width:${incomePct}%"></div></div>
      <div class="bar-track" title="Gastos: ${formatMoney(d.expense)}"><div class="bar-fill expense" style="width:${expensePct}%"></div></div>
    `;
    chart.appendChild(row);
  });
  container.appendChild(chart);
}
