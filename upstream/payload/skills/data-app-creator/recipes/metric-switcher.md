# Metric Switcher & Dual-Date KPI Card-Border Comparison

## Use when

Building a **Metric Selector / Timeframe Switcher Data App** where clicking KPI cards switches the primary metric (`selectedMetric`), `Shift+Click` or right-click (`@contextmenu` -> `Compare` / `Remove comparison`) toggles a secondary comparison metric (`compareMetric`), and comparing two metrics layers **two separate lifecycle-date `this.runQuery` queries** onto Left (`yAxis: 0`) and Right (`yAxis: 1`, `opposite: true`) axes that share the exact same scale (`linkedTo: 0`) when units match and peak magnitudes are within `3x`.

## Canonical Lit Snippet

```javascript
import { DataApp, html, formatValue, formatAxisValue, escapeHtml } from '/runtime/data-app.js';

const METRICS = {
  revenue: { label: 'Revenue', measure: 'orders.total_revenue', dateBase: 'orders.created', format: 'usd', polarity: 'higher-better' },
  orders: { label: 'Orders', measure: 'orders.count', dateBase: 'orders.created', format: 'int', polarity: 'higher-better' },
  returns: { label: 'Returns', measure: 'orders.return_count', dateBase: 'orders.returned', format: 'int', polarity: 'lower-better' },
  cancels: { label: 'Cancellations', measure: 'orders.cancel_count', dateBase: 'orders.cancelled', format: 'int', polarity: 'lower-better' },
};
const PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 };
const UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' };

// Declare reactive properties (never write an updated(changed) fetch loop; never render <app-select label="Compare against">):
static properties = {
  ...super.properties,
  period: { type: String },
  periodCount: { type: Number },
  selectedMetric: { type: String },
  compareMetric: { type: String },
  chartType: { type: String },
  chartMenuOpen: { type: Boolean },
  customWindowOpen: { type: Boolean },
  trendRows: { type: Array },
  trendError: { type: String },
};

constructor() {
  super();
  this.lookerModel = 'commerce';
  this.explore = 'orders';
  this.period = 'date';
  this.periodCount = PERIOD_DEFAULTS.date;
  this.selectedMetric = 'revenue';
  this.compareMetric = '';
  this.chartType = 'areaspline';
  this.chartMenuOpen = false;
  this.customWindowOpen = false;
  this.trendRows = null;
  this.trendError = null;
}

connectedCallback() {
  super.connectedCallback();
  this.loadTrendData();
}

willUpdate(changed) {
  super.willUpdate(changed);
  if (this.hasUpdated && (changed.has('dashboardFilters') || changed.has('crossFilters'))) {
    this.onFiltersChanged();
  }
}

onFiltersChanged() {
  this.loadTrendData();
}

onRefresh() {
  this.loadTrendData();
}

async loadTrendData() {
  const seq = (this._trendSeq = (this._trendSeq || 0) + 1);
  if (!this.compareMetric) {
    this.trendRows = null;
    this.trendError = null;
    return;
  }
  this.trendError = null;
  const m1 = METRICS[this.selectedMetric];
  const m2 = METRICS[this.compareMetric];
  const d1 = `${m1.dateBase}_${this.period}`;
  const d2 = `${m2.dateBase}_${this.period}`;
  const win = `${this.periodCount} ${UNITS[this.period]}`;
  const limit = String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)));
  try {
    const [rows1, rows2] = await Promise.all([
      this.runQuery({ explore: this.explore, fields: [d1, m1.measure], filters: this.getEffectiveFilters({ [d1]: win }), sorts: [`${d1} asc`], limit }),
      this.runQuery({ explore: this.explore, fields: [d2, m2.measure], filters: this.getEffectiveFilters({ [d2]: win }), sorts: [`${d2} asc`], limit }),
    ]);
    if (seq !== this._trendSeq) return;
    const map1 = new Map((rows1 || []).map((r) => [String(r[d1] ?? ''), Number(r[m1.measure] ?? 0)]));
    const map2 = new Map((rows2 || []).map((r) => [String(r[d2] ?? ''), Number(r[m2.measure] ?? 0)]));
    const periods = [...new Set([...map1.keys(), ...map2.keys()])].filter(Boolean).sort();
    this.trendRows = periods.map((p) => ({
      period: p,
      [m1.measure]: Number(map1.get(p) ?? 0),
      [m2.measure]: Number(map2.get(p) ?? 0),
    }));
  } catch (err) {
    if (seq === this._trendSeq) this.trendError = err?.message || String(err);
  }
}

setPeriod(nextPeriod) {
  this.period = nextPeriod;
  this.periodCount = PERIOD_DEFAULTS[nextPeriod];
  this.customWindowOpen = false;
  this.loadTrendData();
}

setWindow(nextCount) {
  this.periodCount = Math.max(1, Math.min(1000, Math.round(Number(nextCount) || this.periodCount)));
  this.customWindowOpen = false;
  this.loadTrendData();
}

handleKpiClick(e, key) {
  if (!this.compareMetric) {
    if (e.shiftKey && key !== this.selectedMetric) {
      this.compareMetric = key;
      this.loadTrendData();
    } else if (!e.shiftKey && key !== this.selectedMetric) {
      this.selectedMetric = key;
    }
    return;
  }
  if (e.shiftKey ? key !== this.selectedMetric : key === this.compareMetric) {
    this.compareMetric = '';
    this.loadTrendData();
  }
}

// In full Metric Selector apps, @contextmenu opens a floating menu ("Compare" / "Remove comparison") that applies this transition:
handleKpiContextMenu(e, key) {
  e.preventDefault();
  if (key === this.selectedMetric) return;
  this.compareMetric = this.compareMetric ? '' : key;
  this.loadTrendData();
}

renderTrendSection() {
  const m1 = METRICS[this.selectedMetric];
  const m2 = this.compareMetric ? METRICS[this.compareMetric] : null;
  const d1 = `${m1.dateBase}_${this.period}`;
  const win = `${this.periodCount} ${UNITS[this.period]}`;
  const limit = String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)));

  const rows = this.trendRows || [];
  const max1 = Math.max(0, ...rows.map((r) => Number(r[m1.measure] ?? 0)));
  const max2 = m2 ? Math.max(0, ...rows.map((r) => Number(r[m2.measure] ?? 0))) : 0;
  const shareScale = Boolean(m2 && m1.format === m2.format && max1 > 0 && max2 > 0 && Math.max(max1, max2) / Math.min(max1, max2) <= 3);

  return html`
    <div class="da-section-card" style="padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--app-title, var(--app-text));">
          ${m2 ? `${m1.label} vs. ${m2.label}` : m1.label}
        </h3>
        <button aria-label="Chart options" @click=${() => { this.chartMenuOpen = !this.chartMenuOpen; }}>⋮</button>
      </div>

      ${m2
        ? html`
            <app-chart
              bare
              type=${this.chartType}
              height="300px"
              value-format=${m1.format}
              .data=${this.trendRows}
              .error=${this.trendError}
              .options=${{
                chart: { spacing: [10, 15, 10, 10] },
                colors: ['var(--app-chart-1, #4285f4)', 'var(--app-chart-2, #34a853)'],
                yAxis: [
                  { title: { text: m1.label }, labels: { formatter() { return formatAxisValue(this.value, m1.format); } } },
                  { ...(shareScale ? { linkedTo: 0 } : {}), opposite: true, title: { text: m2.label }, labels: { formatter() { return formatAxisValue(this.value, m2.format); } }, gridLineWidth: 0 },
                ],
                series: [
                  { name: m1.label, yAxis: 0 },
                  { name: m2.label, yAxis: shareScale ? 0 : 1 },
                ],
                ...(m1.format !== m2.format
                  ? {
                      tooltip: {
                        shared: true,
                        useHTML: true,
                        formatter() {
                          return (this.points || [this]).map((p, i) => (i === 0 ? `<b>${escapeHtml(String(this.x ?? ''))}</b><br/>` : '') + `${escapeHtml(String(p.series.name ?? ''))}: <b>${escapeHtml(String(formatValue(p.y, p.series.index === 1 ? m2.format : m1.format)))}</b>`).join('<br/>');
                        },
                      },
                    }
                  : {}),
              }}>
            </app-chart>
          `
        : html`
            <app-chart
              bare
              type=${this.chartType}
              height="300px"
              explore=${this.explore}
              value-format=${m1.format}
              color="var(--app-chart-1, #4285f4)"
              .query=${{
                fields: [d1, m1.measure],
                filters: this.getEffectiveFilters({ [d1]: win }),
                sorts: [`${d1} asc`],
                limit,
              }}
              .options=${{
                chart: { spacing: [10, 15, 10, 10] },
                yAxis: { title: { text: m1.label } },
                legend: { enabled: false },
              }}>
            </app-chart>
          `}
    </div>
  `;
}
```

## Fields to swap

- `METRICS`: Dictionary mapping metric keys to `{ label, measure, dateBase, format, polarity }` so each metric queries its own lifecycle `dimension_group` (`orders.created`, `orders.returned`, `orders.cancelled`).
- `selectedMetric` / `compareMetric`: Primary (`--app-chart-1`) and optional secondary (`--app-chart-2: #34a853`) metric keys toggled via KPI card clicks, `Shift+Click`, and `@contextmenu` (`Compare` / `Remove comparison`).
- `trendRows` / `trendError`: Merged 3-key numeric `{ period, [m1.measure], [m2.measure] }` array and optional error message populated by `loadTrendData()` when `this.compareMetric` is set (`trendRows` initialized to `null` while idle or in flight so `AppChart` keeps `isEmpty === false` without flashing `"No data returned"`).

## Rules that matter

- **Always layer two `this.runQuery(...)` calls via `Promise.all` when `compareMetric` is set.** Co-querying `orders.count` and `orders.return_count` on `orders.returned_week` injects `WHERE returned_at >= ...` and discards ~90% of non-returned orders. Always query `d1` and `d2` separately (never gating on `m1.dateBase !== m2.dateBase` / `!=`) and union period keys chronologically.
- **Omit `.query` and initialize `this.trendRows = null` on the comparison `<app-chart>`.** `AppChart._skipFetch()` only skips `.query` when `Boolean(this.data && this.data.length > 0 && !this._forceLive)`, so keeping `.query` alongside `.data` fires a single-date query whenever `this.data` is null or empty (initial mount, in-flight fetch, or 0-row result), whereas initializing `this.trendRows = null` keeps `isEmpty === false` during initial network flight, sets `[]` only when Looker genuinely returns 0 rows, and catches query failures into `.error=${this.trendError}`.
- **Pass palette `var(...)` strings in top-level `options.colors`, never `options.series[i].color`, and format both axes via `formatAxisValue`.** `AppChart` resolves CSS `var(...)` strings on `options.colors` (preserving area gradients and hover states) and strips default formatters on `yAxis[1]`, so supply `labels.formatter` using `formatAxisValue(this.value, m1.format)` / `formatAxisValue(this.value, m2.format)` on `yAxis[0]` and `yAxis[1]` (plus `escapeHtml` + `formatValue` in `tooltip.formatter` when `m1.format !== m2.format`).
- **Left Y Axis = Main Metric (`yAxis[0]`), Right Y Axis = Comparison Metric (`yAxis[1]`, `opposite: true`), shared when close (`linkedTo: 0`).** Compute `const shareScale = Boolean(m2 && m1.format === m2.format && max1 > 0 && max2 > 0 && (Math.max(max1, max2) / Math.min(max1, max2) <= 3));`. When `shareScale` is `true`, bind both series to `yAxis: 0` and set `yAxis[1]` to `{ ...(shareScale ? { linkedTo: 0 } : {}), opposite: true, title: { text: m2.label }, labels: { formatter() { return formatAxisValue(this.value, m2.format); } }, gridLineWidth: 0 }` so Highcharts autoscales both series identically without clipping or hardcoded `yAxis.max`. When `false`, bind `series[1]` to `yAxis: 1` for independent scaling.
- **Never write an `updated(changed)` fetch loop or `<app-select label="Compare against">`.** Trigger `loadTrendData()` from `connectedCallback()`, custom `onFiltersChanged()` (called from `willUpdate(changed)` after `super.willUpdate(changed)` on `dashboardFilters` and `crossFilters`), `onRefresh()`, and explicit `Period` / `Window` / KPI interaction handlers.
- **An explicit `height="300px"` is deliberate here.** Because this card embeds a custom header bar (`<h3>` + `⋮` menu) above `<app-chart bare>`, setting `height` sets `min-height: 0` on the inner chart wrapper cleanly without outer card double-borders. Always use `chart.spacing`, never `chart.margin`.
