# Lit Data Apps Authoring Reference & Guidelines

Looker Data Apps are authored using **Lit Web Components** (`app.js`). This standard provides reactive state management, seamless in-place chart animations, zero-build execution, and full Web Component encapsulation.

---

## 1. Zero-Build ES Module Architecture

Lit Data Apps run directly in standard modern browsers without a build step (WebPack/Vite/Babel). **Follow these rules strictly:**

1. **NO TypeScript Decorators:** 
   - ❌ Never use `@customElement`, `@property()`, or `@state()`. (These cause JavaScript syntax errors in the browser).
   - ✅ Always use standard Lit `static properties = { ... }` and standard `customElements.define()`.
2. **Import from `/runtime/data-app.js`** (the served path — `dist/` is the repo layout, not the URL):
   ```javascript
   import { DataApp, html, nothing, formatValue } from '/runtime/data-app.js';
   ```

   **Author-Facing Runtime Exports & Signatures:**
   - **Exports:**
     - `DataApp`, `LitElement`, `html`, `css`, `nothing`, `noChange`
     - `keyed(key, templateResult)`
     - `formatValue(value, format)`
     - `formatAxisValue(value, format)`
     - `escapeHtml(str)`
     - `createNumericCol({ field, headerName, format = 'int', width, flex = 1, minWidth = 120, type = 'rightAligned', sortable = true, filter = true, ...colDef })`
     - `createCurrencyCol({ field, headerName, format = 'usd', width, flex = 1, minWidth = 130, type = 'rightAligned', sortable = true, filter = true, ...colDef })`
     - `createPercentageCol({ field, headerName, format = 'percent', colorScale = false, warningThreshold = 0.60, goodThreshold = 0.80, width, flex = 1, minWidth = 140, type = 'rightAligned', sortable = true, filter = true, ...colDef })`
     - `createBadgeCol({ field, headerName, badgeClassMap = {}, width, flex = 1, minWidth = 140, sortable = true, filter = true, ...colDef })` (where `badgeClassMap` maps raw cell values to `'badge-green' | 'badge-amber' | 'badge-red' | 'badge-blue' | 'badge-neutral'`)
   - **`DataApp` Instance Properties & Methods:**
     - `this.lookerModel`, `this.dashboardFilters`, `this.crossFilters`, `this.isDark`
     - `this.getEffectiveFilters(localFilters = {})`
     - `this.runQuery({ model, explore, fields, filters, sorts, limit = '500' }, signal)`
     - `this.mergeQueries({ queries, on, signal })`
     - `this.refreshAll()`
     - `this.setCrossFilter(field, value, originElement)`, `this.toggleCrossFilter(field, value, originElement)`, `this.clearCrossFilter(field)`, `this.clearCrossFilters()`
     - `this.toggleDarkMode(force)`, `this.renderThemeToggle({ label, lightLabel = 'Light', darkLabel = 'Dark', showLabel = true, class: className, onChange } = {})`

3. **Use Light DOM:** The base classes (`DataApp`, `AppChart`, `AppGrid`, `AppKPI`) default to Light DOM (`createRenderRoot() { return this; }`) so that global stylesheets, Tailwind/CSS variables, and themes style elements cleanly.

---

## 2. Production Data App Architecture (Density, Variety & Polish)

Data Apps are interactive, executive-grade web applications. Compose rich visual layouts with varied chart types (areaspline trends, stacked areas, column comparisons, donuts, gauges, and AG Grid tables), custom compound section cards, and domain-tailored themes (e.g. sleek `.dark-theme` consoles for engineering and telemetry, clean light themes for business operations, with brand-aligned accent palettes):

```javascript
/**
 * @title Operations Command Center
 * @description Executive ecommerce performance monitoring with real-time conversion and order fulfillment tracking.
 */

import { DataApp, html, nothing } from '/runtime/data-app.js';

export const elementName = 'operations-command-center';

export class OperationsCommandCenter extends DataApp {
  static properties = {
    activeTab: { type: String },
    selectedCategory: { type: String },
    timeframe: { type: String },
  };

  constructor() {
    super();
    this.lookerModel = 'ecommerce';
    this.activeTab = 'overview';
    this.selectedCategory = 'All';
    this.timeframe = '90 days';
  }

  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const filters = {};
    if (this.selectedCategory !== 'All') {
      filters['orders.category'] = this.selectedCategory;
    }
    if (isTimeSeries) {
      if (this.timeframe !== 'all') filters['orders.created_date'] = this.timeframe;
    } else {
      filters['orders.is_latest_snapshot'] = 'Yes';
    }
    // Spread this.dashboardFilters and this.crossFilters to preserve dashboard and cross-filtering
    return { ...this.dashboardFilters, ...this.crossFilters, ...filters, ...local };
  }

  render() {
    const snapFilters = this.getEffectiveFilters();
    const trendFilters = this.getEffectiveFilters({}, { isTimeSeries: true });

    return html`
      <!-- Use .dark-theme for dark console dashboards, or standard light theme -->
      <div class="da-container">
        <!-- Hero Header -->
        <header class="da-header" style="justify-content: space-between; align-items: center;">
          <div>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800;">Operations Command Center</h1>
            <p style="margin: 4px 0 0; font-size: 13px; color: var(--app-muted);">
              Executive performance & operational metrics · ${this.selectedCategory === 'All' ? 'All Categories' : this.selectedCategory}
            </p>
          </div>
          <div class="da-filter-bar" style="display: flex; gap: 10px;">
            <app-select
              label="Category"
              .value=${this.selectedCategory}
              .options=${['All', 'Electronics', 'Apparel', 'Home']}
              @change=${(e) => { this.selectedCategory = e.detail.value; }}>
            </app-select>
            <app-select
              label="Timeframe"
              .value=${this.timeframe}
              .options=${[
                { label: 'Last 30 Days', value: '30 days' },
                { label: 'Last 90 Days', value: '90 days' },
                { label: 'All Time', value: 'all' },
              ]}
              @change=${(e) => { this.timeframe = e.detail.value; }}>
            </app-select>
          </div>
        </header>

        <!-- KPI Summary Strip -->
        <section class="da-kpi-grid">
          <app-kpi
            explore="orders"
            query-field="orders.total_revenue"
            label="Total Revenue"
            format="usd"
            .filters=${snapFilters}
          ></app-kpi>
          <app-kpi
            explore="orders"
            query-field="orders.average_margin_rate"
            label="Gross Margin"
            format="percent1"
            .filters=${snapFilters}
          ></app-kpi>
          <app-kpi
            explore="orders"
            query-field="orders.order_count"
            label="Total Orders"
            format="int"
            .filters=${snapFilters}
          ></app-kpi>
          <app-kpi
            explore="orders"
            query-field="orders.pending_shipments"
            label="Pending Fulfillment"
            format="int"
            .filters=${snapFilters}
          ></app-kpi>
        </section>

        <!-- Tab Navigation -->
        <div class="da-tabs">
          <button class="da-tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" @click=${() => this.activeTab = 'overview'}>Overview & Trends</button>
          <button class="da-tab-btn ${this.activeTab === 'breakdown' ? 'active' : ''}" @click=${() => this.activeTab = 'breakdown'}>Category Breakdown</button>
          <button class="da-tab-btn ${this.activeTab === 'orders' ? 'active' : ''}" @click=${() => this.activeTab = 'orders'}>Recent Orders</button>
        </div>

        <!-- Tab 1: Overview (Mixed Hero + Breakdown Layout) -->
        ${this.activeTab === 'overview' ? html`
          <section class="da-grid-1">
            <app-chart
              title="Revenue Trajectory Over Time"
              type="areaspline"
              color="#6366f1"
              explore="orders"
              value-format="usd"
              .query=${{
                fields: ['orders.created_date', 'orders.total_revenue'],
                filters: trendFilters,
                sorts: ['orders.created_date asc'],
                limit: '500'
              }}
            ></app-chart>
          </section>

          <section class="da-grid-2-1">
            <app-chart
              title="Revenue by Category"
              type="column"
              color="#0d9488"
              explore="orders"
              value-format="usd"
              .query=${{
                fields: ['orders.category', 'orders.total_revenue'],
                filters: snapFilters,
                sorts: ['orders.total_revenue desc'],
                limit: '20'
              }}
            ></app-chart>
            <app-chart
              title="Order Volume Share"
              type="donut"
              explore="orders"
              value-format="int"
              .query=${{
                fields: ['orders.category', 'orders.order_count'],
                filters: snapFilters,
                sorts: ['orders.order_count desc'],
                limit: '10'
              }}
            ></app-chart>
          </section>
        ` : nothing}

        <!-- Tab 2: Category Breakdown (Compound Section Card bundling multiple charts) -->
        ${this.activeTab === 'breakdown' ? html`
          <div class="da-section-card">
            <div class="da-section-header">
              <h3>Multi-Facet Category Performance</h3>
              <p>Comparing margin efficiency and fulfillment health across product lines</p>
            </div>
            <div class="da-grid-2">
              <app-chart
                title="Gross Margin %"
                type="column"
                color="#f59e0b"
                explore="orders"
                value-format="percent1"
                .query=${{
                  fields: ['orders.category', 'orders.average_margin_rate'],
                  filters: snapFilters,
                  sorts: ['orders.average_margin_rate desc'],
                  limit: '10'
                }}
              ></app-chart>
              <app-chart
                title="Average Order Value"
                type="column"
                color="#10b981"
                explore="orders"
                value-format="usd"
                .query=${{
                  fields: ['orders.category', 'orders.average_order_value'],
                  filters: snapFilters,
                  sorts: ['orders.average_order_value desc'],
                  limit: '10'
                }}
              ></app-chart>
            </div>
          </div>
        ` : nothing}

        <!-- Tab 3: Order Summary (AG Grid) -->
        ${this.activeTab === 'orders' ? html`
          <app-grid
            explore="orders"
            .query=${{
              fields: [
                'orders.id',
                'orders.category',
                'orders.total_revenue',
                'orders.status'
              ],
              filters: snapFilters,
              sorts: ['orders.total_revenue desc'],
              limit: '100'
            }}
            .columnDefs=${[
              { field: 'orders.id', headerName: 'Order ID', width: 120 },
              { field: 'orders.category', headerName: 'Category', flex: 1 },
              { field: 'orders.total_revenue', headerName: 'Total Revenue', valueFormat: 'usd', width: 160 },
              { field: 'orders.status', headerName: 'Status', width: 140 }
            ]}
          ></app-grid>
        ` : nothing}
      </div>
    `;
  }
}

if (!customElements.get(elementName)) {
  customElements.define(elementName, OperationsCommandCenter);
}
export default OperationsCommandCenter;
```

### This is one shape, not the shape

The example above is a multi-tab console because that is what a command centre
wants. It is not a required skeleton. The same components compose into:

* **A single-screen answer view** — one KPI row, one chart, no tabs, no header
  chrome. Usually the right default; see SKILL.md § *Screen Fit*.
* **A narrative report** — sections stacked top-to-bottom with prose between
  them, read by scrolling.
* **A branded executive summary** — a gradient hero panel, custom typography,
  `bare` widgets inside your own tiles, none of the `.da-*` classes.
* **A fixed-coordinate design** — `position: absolute` inside a sized root, when you
  are reproducing an exact layout from a reference image (the explicit
  **custom-layout** opt-in).

Default to ordinary responsive CSS — it adapts on its own, grows with content,
and composes with tabs and drawers. For a flat BI grid whose tiles must hold
fixed positions, opt into the
**tile grid**: one `.da-grid da-grid-square` with each widget placed by
`cell="x y w h"` (see SKILL.md § *The coordinate grid* and the `grid-layout`
recipe).

`DataApp` gives you Light DOM, so every one of these is plain CSS. The
components carry the query lifecycle (fetch, abort, reflow, loading, error,
in-place series diffing); the design is yours. See SKILL.md § *Design freedom*.

---

## 3. Built-In Component Reference

### `<app-kpi>`
| Property | Type | Description |
| :--- | :--- | :--- |
| `label` | `String` | Card label text (1–3 words, max ~20 chars so it fits on one line in compact cards) |
| `value` | `String` | Optional static or computed headline value (overrides the headline number; bypasses query unless `sparkline` is enabled with a 2-field query, in which case the query still runs for the sparkline and delta) |
| `looker-model` | `String` | LookML model name (defaults to parent container model or config) |
| `explore` | `String` | LookML explore view name (triggers autonomous query if `value` is omitted) |
| `query-field` | `String` | The LookML measure field name to query (e.g. `"order_items.total_revenue"`) |
| `.query` | `Object` | Optional query override object: `{ fields: [...], filters: {...} }` |
| `.filters` | `Object` | Object map of `{ "field_name": "filter_expression" }` (auto-refetches on change) |
| `format` | `String` | Formatting code: `usd`, `usd2`, `int`, `decimal1`, `decimal2`, `percent`, `percent1`, `percent-100`, `percent2`, `percent1-signed`, `percent2-signed` |
| `change` | `String` | Delta badge text (e.g. `"+14.2%"`) |
| `change-type` | `String` | Fixed delta badge tone override: `"positive"`, `"negative"`, or `"neutral"` (auto-detected from sign and `polarity` if omitted) |
| `polarity` | `String` | `"higher-better"` (default) or `"lower-better"`. `"lower-better"` flips the computed or sign-inferred delta tone so a decrease is green and an increase is red. |
| `sparkline` | `Boolean \| Array` | When true, renders a compact SVG trendline using a 2-field query (`[dimension, measure]`) or direct numeric array. Sorts date/numeric dimensions ascending, skips trailing null/empty measure rows, uses the latest period as the headline (unless `.value` replaces it with a total), and computes the period-over-period delta badge. Sort the query by the time field (`sorts: ['<date_dim> desc']`) so a row limit does not drop recent periods, and filter to complete periods. |
| `sparkline-agg` | `String` | `"last"` (default), `"sum"`, or `"avg"`. Controls the headline metric aggregation across the sparkline points. Use `"sum"` only for additive measures (`sum`, `count`) where `limit` covers the full filtered window, or `"avg"` for period average rate. Non-additive measures (`count_distinct`, ratios, weighted averages) should either keep `"last"` with a per-period label or pass `.value` from a 1-row measure-only query. |
| `color` | `String` | Custom sparkline stroke/fill color (defaults to `var(--app-chart-1, #4285f4)`) |
| `subtitle` | `String` | Secondary qualifier (2–4 words, max ~25 chars) rendered on a dedicated muted `11px` line below the headline value without parentheses |
| `bare` | `Boolean` | Drops the card chrome (background, border, radius, shadow, padding), leaving just the metric. For placing inside your own panel. |

#### KPI Header & Subtitle
`subtitle` renders on a dedicated muted `11px` line below the headline value without parentheses. Keep `label` short (1 to 3 words, max ~20 chars) so it fits on one line in compact cards; secondary context belongs in `subtitle` (2 to 4 words, max ~25 chars). Do not use emojis or `icon` attributes in KPI cards or titles; match Looker's clean typography.

```html
<!-- KPI with compact sparkline trendline and auto-calculated delta -->
<app-kpi
  label="Monthly Revenue"
  format="usd"
  sparkline
  .query=${{
    fields: ['orders.created_month', 'orders.total_revenue'],
    sorts: ['orders.created_month desc'],
    limit: '12'
  }}
  .filters=${this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true })}
></app-kpi>
```

### `<app-chart>`
| Property | Type | Description |
| :--- | :--- | :--- |
| `title` | `String` | Card title |
| `type` | `String` | Chart type: `"column"`, `"bar"`, `"line"`, `"spline"`, `"area"`, `"areaspline"`, `"pie"`, `"donut"`, `"scatter"`, `"solidgauge"`, `"gauge"`, `"treemap"`, `"funnel"`, `"pyramid"` |
| `height` | `String` | Explicit component height override (e.g. `"280px"`, `"360px"`). Optional; CSS container sizing is preferred. When omitted, the chart adapts to whatever definite height CSS provides (`flex: 1`, `aspect-ratio`, grid stretch), falling back to 300px in collapsed or unconstrained contexts. |
| `selected-value` | `String` | Active category filter value (e.g. `"frontend"`). Supported on segmented visual surfaces (`column`, `bar`, `pie`, `donut`, `treemap`, `funnel`, `pyramid`); matching item remains full color, while excluded items turn solid gray. Not supported on single-point or continuous visuals (`line`, `spline`, `area`, `areaspline`, `scatter`, `gauge`, `solidgauge`). |
| `cross-filter` | `String` | Declarative cross-filtering attribute for segmented visual surfaces (`column`, `bar`, `pie`, `donut`, `treemap`, `funnel`, `pyramid`). Not supported on single-point or single-value visuals (`line`, `spline`, `area`, `areaspline`, `scatter`, `gauge`, `solidgauge`, `<app-kpi>`, `<app-grid>`). If bare (`cross-filter`), uses the chart's dimension field. If assigned (`cross-filter="users.state"`), uses the specified field. Clicking a segment toggles the field in host `DataApp.crossFilters` (which holds ready-to-use Looker filter expressions); sibling widgets bound to `getEffectiveFilters()` then re-query. |
| `pivot-by` | `String` | Second dimension field name to pivot into separate series (or pass `pivots: ['field']` in `.query`) |
| `polarity` | `String` | `"higher-better"` (default: red $\rightarrow$ yellow $\rightarrow$ green) or `"lower-better"` (green $\rightarrow$ yellow $\rightarrow$ red) for gauges |
| `color` | `String` | Primary/series colour. A literal (`"#EB0A1E"`) **or** a role token (`"var(--app-primary)"`), resolved against the element's cascade at build time. Single-measure column and bar charts use one color (`color`, else `--app-primary`). `categoryColors` or an `options.colors` array still color bars individually. |
| `categoryColors` | `Object` | Map of `{ "Category Name": "#hex" }` (values may be `var(--x)`) for deterministic color consistency across charts |
| `y-scale-group` | `String` | Shared Y-axis scale group name to synchronize max scale across small multiples. Omit when category volumes differ by more than ~5x or when independent scales are requested. |
| `explore` | `String` | LookML explore view name |
| `.query` | `Object` | Looker query object: `{ fields: [...], filters: {...}, sorts: [...], limit: '500' }` |
| `fields` | `String` | Comma-separated list of LookML field names |
| `value-format` | `String` | Numeric format vocabulary (`usd`, `int`, `percent1`, etc.) |
| `.filters` | `Object` | Object map of `{ "field_name": "filter_expression" }` |
| `.data` | `Array` | Optional override array of rows (for local sample preview or client-side calculation) |
| `.options` | `Object` | Highcharts options override (deep-merged into the generated config; arrays are replaced, so never pass `series`) |
| `bare` | `Boolean` | Drops the card chrome, leaving just the visualization. For full-bleed tiles and custom panels. |
| `@app-chart-click` | `CustomEvent` | Dispatched on point/column/bar click (`cancelable: true`). Detail: `{ field, value, y, mouseEvent, chartComponent }`. Calling `e.preventDefault()` cancels automatic `cross-filter` toggling. Custom `options.plotOptions.series.point.events.click` callbacks also run and can call `e.preventDefault()` (or return `false`) to cancel `cross-filter`. |

**Container sizing & default floors.** `<app-chart>` sizes dynamically to its
parent container box via `ResizeObserver`. In unconstrained vertical flow where no
parent height or `--app-chart-min-height` is defined, it applies an inline 300px
default floor on `.chart-container` to prevent collapse. Setting an explicit
`height="..."` attribute overrides container sizing with an inline height.

**Width caps on circular visuals.** Donuts and gauges scale with available width.
On wide monitors, unconstrained circular charts expand into oversized visuals.
Constrain them with CSS `max-width` (e.g. `style="max-width: 380px; margin: 0 auto;"`
or on their container column) rather than fixed heights, so they remain width-invariant
across resolutions.

**Pie and donut charts.** Render with a 70% donut hole (`innerSize: '70%'`), a centered
grand total KPI and measure label inside the hole, 2px card-colored slice borders (`borderRadius: 4`),
and external slice labels with connector lines. To render a flat pie with no center total, set `plotOptions.pie.innerSize: '0%'`.

**Area charts.** Area (`area`, `areaspline`) charts use a vertical linear transparency
gradient (0.3 top opacity to 0.1 bottom opacity) by default.

**Funnel charts.** Funnel charts use a tapered triangle geometry (`neckWidth: '0%'`,
`neckHeight: '0%'`) and a sequential blue palette by default.

**Tooltips.** Tooltips render as a floating white card with drop shadow in light mode
(`#ffffff`, `color: #3c4043`) and an elevated dark slate card in dark mode (`#1e293b`, `color: #f8fafc`).

**Click-to-gray selection.** Applies to segmented visual surfaces (`column`, `bar`, `pie`, `donut`, `treemap`, `funnel`, `pyramid`). When cross-filter or selected-value is active, unselected items turn solid neutral gray (`#dadce0` light, `#374151` dark) instead of dimming. Not supported on single-point or single-value visuals (`line`, `spline`, `area`, `areaspline`, `scatter`, `gauge`, `solidgauge`, `<app-kpi>`, `<app-grid>`).

**Dual-axis configuration for disparate metric magnitudes.** When co-plotting two
measures with incompatible scales (e.g. $140K revenue alongside 850 conversion counts)
on a single timeline, single-axis scaling compresses the smaller metric to a flat line
at zero. Configure dual y-axes in `.options`:
```javascript
.options=${{
  yAxis: [
    { title: { text: 'Revenue ($)' }, labels: { format: '${value:,.0f}' } },
    { title: { text: 'Conversions' }, labels: { format: '{value:,.0f}' }, opposite: true }
  ],
  series: [{ yAxis: 0 }, { yAxis: 1 }]
}}
```

**Colours as role tokens.** `color`, `.options=${{ colors: [...] }}`, and
`categoryColors` accept `var(--x[, fallback])` strings, which the runtime resolves
to concrete colours at build time (Highcharts takes colours verbatim, so this
resolution is what makes them render, and what re-colours a chart when its
variable changes). Point chart colours at the standard
**role tokens**: `--app-primary` for a single series, and `--app-chart-1` …
`--app-chart-20` for the categorical palette (exposing all 20 `looker_2026_categorical_1`
colors, along with `--app-chart-up`, `--app-chart-down`, `--app-chart-total`, and
`--app-chart-unselected`). Set those tokens on the app root (routing any brand colour
into them), so changing a role recolours every chart that reads it; there is no palette
manifest to declare (see SKILL.md step 5). A single-series, line, or area chart with no
`color` defaults to `--app-primary`, with no visual change from the previous hard-coded
default.

**Height floors & collapsed containers.** When no explicit `height` attribute is provided, `<app-chart>` automatically adapts to CSS-derived container heights (including flex boxes and grid tiles smaller than 300px). If the container has no definite height (collapsed or unconstrained normal block flow, measured at `< 4px` on first observation), the runtime applies a 300px default inline `min-height` to `.chart-container`. To specify a custom minimum floor, define `--app-chart-min-height` on the element; a non-zero value overrides the automatic 300px fallback.

**Use `chart.spacing`, not `chart.margin`.** `margin` is an absolute override of the axis band rather than a minimum, so a band too small for the labels makes Highcharts render them outside its own SVG viewport, where `.highcharts-container` clips them; enlarging the tile does not help. `spacing` keeps the dynamic measurement, so pass `.options=${{ chart: { spacing: [5, 10, 20, 35] } }}`.

### `<app-grid>`
| Property | Type | Description |
| :--- | :--- | :--- |
| `title` | `String` | Optional header rendered above the table (same contract as `<app-chart>`) |
| `explore` | `String` | LookML explore view name |
| `height` | `String` | Explicit table height (default `"440px"`) |
| `.query` | `Object` | Looker query object: `{ fields: [...], filters: {...}, sorts: [...], limit: '100' }` |
| `fields` | `String` | Comma-separated list of LookML field names |
| `.filters` | `Object` | Object map of `{ "field_name": "filter_expression" }` |
| `limit` | `String` | Query row limit (default `"100"`) |
| `.data` | `Array` | Optional override array of rows |
| `.columnDefs` | `Array` | Custom AG Grid column definitions (auto-inferred if omitted). Supports `valueFormat` with any format code (`'usd'`, `'int'`, `'decimal1'`, `'percent'`, etc.) composed directly with custom `valueGetter` functions and `colId` aliases. Columns default to `flex: 1` when neither `flex` nor `width` is specified; columns with an explicit `width` keep their fixed width. |
| `.gridOptions` | `Object` | AG Grid options pass-through override (`{ rowHeight: 32, domLayout: 'autoHeight', pagination: true, paginationPageSize: 20 }`). Pagination defaults to `false` (scrollable table). |
| `show-row-count` | `Boolean` | Opt in to a row count footer beneath the table (e.g. `142 rows`, or `Showing first 500 rows` when the returned rows equal the query limit). Off by default. |
| `bare` | `Boolean` | Drops the card chrome, leaving just the table. |
| `@app-grid-row-click` | `CustomEvent` | Dispatched when a user clicks a data row (after any `gridOptions.onRowClicked` callback). Detail: `{ row, rowIndex, mouseEvent }`, where `row` is the clicked row's data object and `rowIndex` is the position after sorting and filtering, so authors should read `detail.row`. |

> [!TIP]
> **Grid Pagination & Row Count Footer:**
> - By default, `<app-grid>` renders a scrollable table with `pagination: false` and **no footer**. The table uses the full height of its card.
> - Add `show-row-count` to display a row count footer. The footer takes vertical space inside the card, so a short card will show one fewer data row.
> - `AppGrid` cannot know the true total row count — Looker's query runner does not return one. The footer reports the rendered rows, and says `Showing first N rows` when the count equals the query limit.
> - To restore pagination controls, pass `pagination: true` in `.gridOptions`. Pagination suppresses the row count footer, because the AG Grid pager already reports counts.

> [!TIP]
> **Dynamic Grid Column & Remount Best Practices:**
> - **Convenience Column Helpers (`create*Col`):**
>   Construct typed, formatted AG Grid column definitions passing an options object:
>   - `createNumericCol({ field, headerName, format = 'int', width, flex = 1, minWidth = 120, type = 'rightAligned', sortable = true, filter = true, ...colDef })`
>   - `createCurrencyCol({ field, headerName, format = 'usd', width, flex = 1, minWidth = 130, type = 'rightAligned', sortable = true, filter = true, ...colDef })`
>   - `createPercentageCol({ field, headerName, format = 'percent', colorScale = false, warningThreshold = 0.60, goodThreshold = 0.80, width, flex = 1, minWidth = 140, type = 'rightAligned', sortable = true, filter = true, ...colDef })` (`format` defaults to `'percent'` for column-wide auto-detection between `0..1` ratios and `0..100` percentages)
>   - `createBadgeCol({ field, headerName, badgeClassMap = {}, width, flex = 1, minWidth = 140, sortable = true, filter = true, ...colDef })`
> - **`valueFormat` + `valueGetter` Composition:** When providing a custom `valueGetter: (params) => params.data?.[this.activeField]`, adding `valueFormat: 'percent'` automatically wraps the returned value with the framework's formatter.
> - **Identity Reset with `keyed`:** To force a complete clean remount of any component or sub-tree on state transitions, use `keyed(key, template)`:
>   ```javascript
>   import { DataApp, html, keyed } from '/runtime/data-app.js';
>   // ...
>   ${keyed(this.activeMetric, html`<app-grid ...></app-grid>`)}
>   ```

---

### `<app-select>`

The slicer the skill's MVP baseline calls for. Renders a labelled `<select>`.

| Property | Type | Description |
| :--- | :--- | :--- |
| `label` | `String` | Caption rendered beside the control |
| `.value` | `String` | Current selection (bind it to a reactive property) |
| `.options` | `Array` | `['All', 'AMER']` or `[{ label: 'Americas', value: 'AMER' }]` |
| `placeholder` | `String` | Text for the empty option (default `''`, no empty option prepended unless set) |
| `disabled` | `Boolean` | Greys out the control |
| `@change` | `Event` | Fires once per selection with `detail: { value }` |

```javascript
html`
  <app-select
    label="Region"
    .value=${this.region}
    .options=${['All', 'AMER', 'EMEA', 'APAC']}
    @change=${(e) => { this.region = e.detail.value; }}>
  </app-select>
`
```

The options list is often data-driven — fetch it once in `firstUpdated()` with
`this.runQuery()` and store it in a reactive property.

---

## 4. Format Vocabulary Reference

| Format Code | Behavior | Example Input | Formatted Output |
| :--- | :--- | :--- | :--- |
| `int` | Integer with commas | `12450.8` | `12,451` |
| `decimal1` | 1 fixed decimal | `12345.678` | `12,345.7` |
| `decimal2` | 2 fixed decimals | `12345.678` | `12,345.68` |
| `usd` | Currency with commas | `2845920` | `$2,845,920` |
| `usd2` | Currency with cents | `89.5` | `$89.50` |
| `percent` | Auto-detects 0–1 vs 0–100 (locks one scale across a chart series or table column) | `85.4` or `0.854` | `85.4%` |
| `percent1` | **Assumes 0–1 ratio** (multiplies by 100) | `0.854` | `85.4%` |
| `percent2` | Assumes 0–1 ratio, 2 decimals | `0.8543` | `85.43%` |
| `percent-100` | Formats already-scaled 0–100 numbers directly without multiplying by 100 | `85.4` | `85.4%` |
| `percent1-signed` | Ratio with explicit +/- sign | `0.142` | `+14.2%` |
| `percent2-signed` | Ratio with sign, 2 decimals | `0.142` | `+14.20%` |

> [!IMPORTANT]
> **Annotate every numeric slot.** Looker's `value_format` does **not** travel
> in the JSON response — values arrive as raw JS numbers. Numbers without a format
> print without thousands separators, rounded to 2 decimals, in tables, tooltips, data labels, and
> KPIs. Value-axis labels are compacted (`100K`, `1.5M`, `$2.5M` with `usd`). Every
> format code adds thousands separators. Leave IDs and years without a format, but
> give every measure an explicit format code: the runtime cannot guess `$` or `%`.
> Currency without a sign and ratios that read as integers are the most common way
> a finished app looks broken to its viewer.

> [!IMPORTANT]
> **Ratios vs Percentages:** LookML measures that return decimal ratios (e.g. `0.965` for 96.5% coverage) should prefer `format="percent1"`. Measures that already return 0–100 numbers (e.g. `65.4` for 65.4%) should use `format="percent-100"`. `format="percent"` auto-detects between 0–1 and 0–100 values and locks one scale across a chart series or table column.

---

## 5. Coding Agent Traps & Best Practices

1. **LookML Array Fan-Out Timeout Prevention:**
   - If an explore contains multiple un-nested array views or un-aggregated line-level details, querying measures from multiple array views in a single query causes cross-product database fan-out resulting in **HTTP 502/504 timeouts**.
   - **Rule:** Never combine sibling array measures in a single query. Query them in separate tiles or use separate `.query` calls.
2. **Multi-Series / Multi-Measure Charting:**
   - `<app-chart>` automatically supports multi-series plotting. When querying 1 dimension and multiple measures (e.g. `fields: ['<VIEW>.<DATE>', '<VIEW>.<MEASURE_1>', '<VIEW>.<MEASURE_2>']`), it creates distinct animated series and enables the legend automatically.
   - When querying 2 dimensions and 1 measure (e.g. `fields: ['<VIEW>.<DIM_1>', '<VIEW>.<DIM_2>', '<VIEW>.<MEASURE>']`), pass `pivots: ['<VIEW>.<DIM_2>']` in `.query` or `pivot-by="<VIEW>.<DIM_2>"` on `<app-chart>` to pivot the second dimension into one series per category.
3. **AG Grid Dot-Notated Fields & Custom Column Options:**
   - AG Grid natively treats dots in `field: "<VIEW>.<FIELD>"` as deep object paths. The runtime automatically injects `valueGetter` normalization so custom `columnDefs` with flat LookML keys always display without blank cells.
   - Custom column definitions pass through `cellStyle`, `valueGetter`, `comparator`, and `cellRenderer` functions untouched.
4. **Programmatic Data Fetching via `this.runQuery()`:**
   - On `DataApp` subclasses, you can programmatically execute queries (for instance, dynamically populating filter dropdown options at runtime or loading lookup tables):
   ```javascript
   async firstUpdated() {
     const rows = await this.runQuery({
       model: 'ecommerce',
       explore: 'orders',
       fields: ['orders.category'],
       filters: { 'orders.is_active': 'Yes' },
       limit: '50'
     });
     this.categoryOptions = Array.from(new Set(rows.map(r => r['orders.category'])));
   }
   ```
   - **`runQuery` computes; a widget displays.** Use it to populate filter
     options, feed a chart/grid `.data`, or feed a KPI `.value` — never to render
     a fetched number straight into markup. A value shown as text (`${this.share}`)
     is not a widget, so it opts out of the reconnect-refetch lifecycle and will
     not re-query on a filter change. See the
     `custom-design` recipe for the `.value` pattern.
   - **PDF downloads and scheduled deliveries wait for widgets and `runQuery()`.**
     The tile reports itself rendered once every widget has drawn and no
     `runQuery()` / `mergeQueries()` call is in flight. Content revealed later by
     a timer is not waited for, so it may be missing from the PDF.
   - **No motion while Looker renders (`this.isRendering`).** During a PDF or
     image render, `this.isRendering` is true and the runtime finishes every
     chart, grid and CSS animation instantly, the app's own CSS included. Motion
     driven from JavaScript, such as a count-up or a staged reveal, is the app's
     to skip: when `this.isRendering` is true, draw the final state.
5. **Filter Superpowers (Wildcards, Measure/HAVING Filters, Relative Dates):**
   - Looker query filters support advanced expressions out-of-the-box:
     * **Substring Wildcards:** String dimensions support `%pattern%` (e.g. `{ 'orders.product_name': '%pro%' }`).
     * **Measure / HAVING Filters:** You can filter directly on computed measures (e.g. `{ 'orders.total_revenue': '>1000' }`).
     * **Relative Date Expressions:** Relative windows work directly (e.g. `{ 'orders.created_date': '90 days' }`).
6. **Reactive Property Binding vs Static Data:**
   - When components use `.query=${...}`, any changes to parent reactive properties (e.g. filter dropdowns) will automatically re-query Looker and animate the results in-place without component re-mounting. Both `<app-chart>` and `<app-grid>` also accept pre-computed `.data=${rows}` arrays directly if local calculation or transformation is required.
7. **Async Request Cancellation (`AbortController` & `_activeFetchId`):**
   - Built-in components (`<app-chart>`, `<app-grid>`, `<app-kpi>`) automatically cancel stale in-flight queries when filters change rapidly.
   - If writing custom manual query routines in `DataApp`, always maintain an `AbortController` (`this._abortCtrl = new AbortController()`) and pass its signal (`this.runQuery(query, signal)`), ignoring any `AbortError` cleanly.
8. **Custom Card Loading Skeletons:**
   - **A grid tile should hold a widget.** A `.da-grid` tile — whether it *is* a `<app-*>` widget or a wrapper that *contains* one — is placed by its `cell`. A panel that fetches and paints its own value with no widget in the tree renders fine but skips the reconnect-refetch lifecycle. Keep at least one widget in the panel — feed it via `.value`/`.data` if you computed the number yourself — rather than rendering the value as markup.
9. **Numeric Values Received as Strings (`parseFloat` handling):**
   - When processing raw query rows from Looker or computing local client-side aggregations/transforms, numbers from string expressions, custom dimensions, or formatted API payloads may arrive as string literals (e.g. `"123.45"` instead of `123.45`). Always use `parseFloat(val) || 0` before arithmetic, comparisons, or feeding custom options to Highcharts.
10. **Reading Error Envelopes & Diagnostics:**
    - When a Looker query fails (e.g. invalid explore name, missing field, or syntax error), the runtime renders a structured error card and logs a diagnostic envelope to `console.error`. The envelope contains the widget tag, the exact query definition passed, and Looker's error message/HTTP code. Inspect this to identify field typos or explore mismatches.
11. **Mandatory Dashboard and Cross-Filters Spreading:**
    - Any app overriding `getEffectiveFilters()` **must** spread both `this.dashboardFilters` and `this.crossFilters` (`const filters = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) };`; `this.crossFilters` holds ready-to-use Looker filter expressions per field). Failing to spread `this.dashboardFilters` disables native Looker dashboard filter controls; failing to spread `this.crossFilters` prevents chart cross-filtering from reaching other widgets.
12. **Theme State & Dark Mode Toggle (`this.isDark` & `this.toggleDarkMode([force])`):**
    - `DataApp` provides `this.isDark` as a reactive property (with getter and setter) and `this.toggleDarkMode(force?: boolean)` so authors can easily implement or default theme states.
    - Setting `this.isDark = true;` (e.g. in `constructor()`) or calling `this.toggleDarkMode()` automatically synchronizes `.dark-theme` across the component, its `.da-container`, and the document root (`document.documentElement` and `document.body`), and sets the document canvas background (`document.body.style.backgroundColor`) without white border leaks.
    - The runtime synchronously sets `color-scheme: dark;`, switches native scrollbars, and updates AG Grid quartz themes (`ag-theme-quartz-dark`) and Highcharts palettes without re-fetching query data.
    - **Theme Toggle Switch:** Use `${this.renderThemeToggle(options)}` to render the standardized theme toggle switch in headers or filter bars:
      ```javascript
      ${this.renderThemeToggle()}
      ```
      Options include `lightLabel: 'Light'`, `darkLabel: 'Dark'`, `showLabel: false` (hide text labels), `label: '...'` (single static label), `class: '...'`, and `onChange: (isDark, e) => { ... }`.
    - For full patterns, CSS variable tokens, and recipes, see `dist/skills/data-app-creator/recipes/dark-theme.md`.
13. **Strict CSS Variable Palette & Dark Theme Contracts:**
    - **Never hardcode hex colors:** Always define every single color used as a CSS custom property (e.g., `--app-bg`, `--app-card-bg`, `--app-border`, `--app-text`, `--brand-primary`, `--brand-accent`). Never use raw hex codes (`#1e293b`, `#ffffff`, etc.) in custom component CSS or widget attributes.
    - **Mandatory dark variants:** If the app uses or supports a dark theme, every custom variable MUST have both a default light definition in `:root` and an explicit dark definition in `.dark-theme` (or `:root:has(.dark-theme)`).
    - **Root container requirement for dark apps:** Always place `class="da-container dark-theme"` on the top-level container element (`<div class="da-container dark-theme">`) when authoring a dark dashboard.
    - **AG Grid dark theme guarantee:** Inside a `.dark-theme` container, `<app-grid>` automatically applies `ag-theme-quartz-dark` and maps all quartz CSS variables to the dark palette. To explicitly enforce dark theme on a table, set `<app-grid theme="dark" ...>`.
14. **Default to Declarative Cross-Filtering (`cross-filter`):**
    - By default, always add `cross-filter` (or `cross-filter="field.name"`) to every `<app-chart>` widget displaying segmented visual surfaces (`column`, `bar`, `pie`, `donut`, `treemap`, `funnel`, `pyramid`) unless explicitly instructed otherwise. Cross-filtering and click-to-gray selection are not supported on single-point or single-value visuals (`line`, `spline`, `area`, `areaspline`, `scatter`, `gauge`, `solidgauge`, `<app-kpi>`, `<app-grid>`). Users expect clicking bars, slices, and tiles to cross-filter the dashboard automatically. Calling `e.preventDefault()` in `@app-chart-click` cancels `cross-filter` when a click opens a custom detail panel instead.
    - The runtime automatically updates host `DataApp.crossFilters` (storing ready-to-use Looker filter expressions, while `clearCrossFilter(field)` and `clearCrossFilters()` remove active filters), turns unselected items solid gray, and excludes the emitting chart from its own cross-filter. Sibling widgets pick the filter up through their own `.filters=${this.getEffectiveFilters()}` binding.
