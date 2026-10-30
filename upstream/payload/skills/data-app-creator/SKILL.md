---
name: data-app-creator
description: |
  Author and create a new Looker Data App for the user's Looker instance against one of
  their LookML models. Trigger when the user asks to make/build/create a new
  data app or dashboard, add/modify data app or dashboard components, or author Lit Data Apps.
---

You are creating a single Data App for a Looker customer. The runtime, recipes,
and reference docs live next to this file; the customer's Looker connection
lives in `data-apps-config.json` at the repo root.

## How to work: show something, then widen

**Your first delivery is something the user can look at, not something that is
finished.** Get one screen of real data in front of them, then ask what to add.

**Speed is the point.** A first screen in a few minutes beats a complete one in
twenty — every time, without exception. The user cannot redirect what they
cannot see, and every tile you add before they've looked is a guess you may
have to undo. If five minutes have passed and nothing is on screen, ship what
renders right now and say what's missing.

### What actually burns the time

Exploring, not building. Writing the app is minutes; discovery is where runs go
to die. Keep it short and cheap:

- **Use reference docs first, and avoid reading raw runtime files.**
  The Step 7 MVP template already includes standard primitives (KPI cards, `<app-select>` dropdowns, and charts).
  Check `recipes/` or `reference/LIT_DATA_APPS.md` for component properties and helper signatures.
  Do not page through `runtime/data-app.js` or `runtime/data-app.css`, and only grep them for a specific symbol or signature if something remains ambiguous.
- **Execute tools, never read their source code.** Tool scripts reside in
  `skills/data-app-creator/tools/` (`check-credentials.py`, `explore-model.py`,
  `get-recipe.py`, `verify-app.py`). Always invoke them with `python3` via bash using this local path (on Windows where `python3` is absent or points to the Microsoft Store stub, substitute `python` or `py -3` in all `python3` commands below).
  Never search external directories for tool copies, and never use file read or
  view tools on `tools/*.py` or `data-apps-config.json`.
- **Never sample or probe an explore unscoped.** Always pass `--fields` with
  the handful you actually need. An unscoped `--sample` on a wide explore
  compiles a monster query and can block for *five minutes* on its own.
- **Batch your probes.** Fire discovery queries in parallel, not one at a time.
- **Find the fields your first screen needs, then stop.** You do not need a
  complete map of the model to render something useful.
- **If a field fights you** — broken join, an array that won't combine — drop
  it and move on. Note it, mention it at the end. Do not spend turn one
  solving it.
- **Never insert fixed waits.** No sleeping "to let it settle". Load the page,
  read it, move on.

## Run order

1. **Check for toolkit updates (cached daily).**
   Run `python3 skills/toolkit-updater/tools/check-for-update.py`. If an update is available, follow `skills/toolkit-updater/SKILL.md` before continuing.

2. **Verify Looker credentials first (MANDATORY HITL GATE).**
   Before brainstorming, discovering explores, inspecting files, or writing any code, verify that Looker credentials work:
   ```bash
   python3 skills/data-app-creator/tools/check-credentials.py
   ```
   - **If this check FAILS (Exit Code 1):** **HARD STOP IMMEDIATELY.**
     * **DO NOT** execute any further tool calls, shell commands, port tests, or diagnostic probes.
     * **DO NOT** inspect configuration files, logs, or example folders searching for fallbacks or offline mock data.
     * **DO NOT** attempt to write code, even if the user request appears to be an offline app, game, or prototype.
     * **Immediately end your turn** and report the failure directly to the user (Human-In-The-Loop) quoting the exact error output, hint, and required human action from `check-credentials.py`.
     * **Wait for human confirmation and instructions before resuming.**
   - **If this check PASSES (Exit Code 0):** Review the available LookML models, explores, and the current local ISO timestamp output by the tool, then proceed to discovery.

   `bootstrap.sh` writes `data-apps-config.json` at the repo root:
   - **`data-apps-config.json`** (repo root) — the Looker instance URL (`base_url`),
     API credentials (`client_id`/`client_secret`), and publish settings (`publish_folder_id`).
   - *Optionally* `default_model` / `default_explores` may be present. These are
     **optional defaults, not a constraint**: if omitted, or if a dashboard
     targets another model, call `explore-model.py --list-models` to discover available models.

---

### Runtime Capabilities & Component Contract Cheatsheet

| Component | Reactive Properties | Built-in Styling Contract | Auto Features |
| :--- | :--- | :--- | :--- |
| `<app-kpi>` | `label`, `value`, `format` (`percent1`, `usd`, `int`), `change`, `change-type` (`positive`/`negative`), `polarity` (`higher-better`/`lower-better`), `subtitle`, `sparkline`, `sparkline-agg` (`sum`/`avg`/`last`), `color`, `query`, `filters`, `queryField`, `bare`, `cell` | **Self-contained card**: border, radius (16px), background, padding, shadow — or none of it, with `bare`. | Fetches single measure, formats decimal ratios (`0.0–1.0` -> `79.2%`). When `sparkline` is set, accepts a 2-field query (`[dim, measure]`) or numeric array, renders mini trendline, and auto-computes delta (`sparkline-agg="sum|avg|last"` configures headline aggregation). |
| `<app-chart>` | `type` (`line`, `spline`, `areaspline`, `area`, `bar`, `column`, `donut`, `pie`, `scatter`, `solidgauge`, `gauge`, `treemap`, `funnel`, `pyramid`), `title`, `height`, `explore`, `query`, `filters`, `sorts`, `limit`, `value-format`, `color`, `options`, `selected-value`, `cross-filter`, `pivot-by`, `y-scale-group`, `bare`, `cell` | **Self-contained card**: adapts to CSS container height (falling back to 300px default inline height on collapsed/unconstrained containers; overridable via `--app-chart-min-height`), title bar, loading skeleton, error banner. | **2-Dim Auto-Pivot** (`[date, suite, cov]` -> multi-series), declarative `cross-filter` (`cross-filter` or `cross-filter="view.field"`), `@app-chart-click` events, click-to-gray selection, in-place `.setData()` updates. |
| `<app-select>` | `label`, `value`, `options` (strings or `{label, value}`), `placeholder`, `disabled` | Labelled `<select>`; inherits the filter-bar styling. | Emits `@change` once per selection with `detail: { value }`. |
| `<app-grid>` | `title`, `explore`, `query`, `filters`, `sorts`, `limit`, `height`, `columnDefs`, `gridOptions`, `data`, `bare`, `cell`, `show-row-count`, `@app-grid-row-click` | **Self-contained table card**: AG Grid wrapper, optional header, scrollable table with no footer by default (`min-height: 360px`; opt in to a row count footer with `show-row-count`, opt in to pagination via `gridOptions`). | **Dynamic `columnDefs` reactivity** (updates live on metric toggles), auto-normalizes dotted LookML getters (`data['view.field']`), emits `@app-grid-row-click` `CustomEvent` (`detail: { row, rowIndex, mouseEvent }`, where `rowIndex` is the position after sorting and filtering, so read `detail.row`). |

Attribute names are exact. An attribute the component doesn't declare does not
error — it lands as an inert HTML attribute and the feature silently doesn't
happen. Set an explicit `id` attribute when a widget's `title` or `label` is
dynamic so its widget ID stays stable across state changes and publishes, and
bind `id=${...}` per item for widgets rendered in a loop. Write variants (metric
toggles, tabs, one card per metric) as separate widgets or as a `.map()` over a
static `const` array so publishing can register a query for "Explore from here"
for each widget (`verify-app.py` warns during Stage 2 QA when a widget's query
cannot be statically extracted). When unsure, check `reference/LIT_DATA_APPS.md`.

#### Tag & Namespace Conventions: `app-*` vs `da-*`

- **`app-*` (Live Data Widgets)**: Strictly reserved for live, query-bearing Looker widgets (`<app-chart>`, `<app-grid>`, `<app-kpi>`, `<app-select>`). They carry queries, filters, data-fetching lifecycles, and auto-refresh on `R` keypresses or filter changes.
- **`da-*` (Data Apps Layout & Chrome)**: Used for layout containers, cosmetic wrappers, and structural styling (e.g. `.da-container`, `.da-header`, `.da-tabs`, `.da-filter-bar`, `.da-kpi-grid`, `.da-grid`, `.da-tile`, `.da-section-card`, etc.).
- **Separation of concerns**: Never use `app-*` for layout containers or non-widget wrappers. Live query widgets are custom elements (`<app-chart>`, `<app-grid>`, `<app-kpi>`, `<app-select>`), whereas layout and styling use standard HTML elements (`<div>`, `<section>`) with `da-*` classes (e.g. `<div class="da-container">`). Layout and chrome never use custom element tags.

#### Layout: ordinary CSS first

A Data App is a Lit component rendering into Light DOM, so its layout is just
CSS you write. **Default to normal responsive layout** — flex and CSS grid with
`auto-fit` / `minmax()` — and let the browser place things. It adapts to any
width on its own, tiles grow with their content instead of clipping, and it
composes with tabs, drawers, sidebars and anything else you need.

```html
<div class="da-container">

  <!-- KPI strip: fits as many ~200px columns as there is room for -->
  <section class="da-kpi-grid">
    <app-kpi label="Revenue" query-field="orders.total" format="usd"></app-kpi>
    <app-kpi label="Orders"  query-field="orders.count" format="int"></app-kpi>
  </section>

  <!-- two charts side by side, stacking when narrow -->
  <section class="da-grid-2">
    <app-chart ...></app-chart>
    <app-chart type="donut" ...></app-chart>
  </section>

  <!-- full-width table -->
  <app-grid ...></app-grid>
</div>
```
These utility classes are shortcuts for the common shapes. All of them are
`auto-fit` grids, so they reflow by themselves — no breakpoints to write:

- `.da-kpi-grid` — auto-fitting KPI strip (`minmax(min(210px, 100%), 1fr)`).
- `.da-grid-1` — full-width row (`1fr`).
- `.da-grid-2` — 2 equal columns (`minmax(min(380px, 100%), 1fr)`).
- `.da-grid-3` — 3 equal columns (`minmax(min(280px, 100%), 1fr)`).
- `.da-grid-2-1` — 2:1 hero + breakdown (`2fr 1fr`).
- `.da-grid-1-2` — 1:2 sidebar + detail (`1fr 2fr`).

When writing custom CSS grid layouts using `minmax(Npx, 1fr)`, always wrap the minimum in `min(Npx, 100%)` (for example, `minmax(min(360px, 100%), 1fr)`) so cards and charts shrink cleanly and never overflow on mobile devices or narrow screens.

You are not limited to these. Any CSS the browser understands works — write your
own grid, flex, or whatever the design needs. See the **custom-design** and
**custom-layout** recipes.

Charts take their height from CSS container geometry (falling back to a 300px
default floor in unconstrained vertical flow); explicit `height` is optional.
Tables take their height from the card (`height="440px"` default). A KPI sizes itself: keep `label` short (1 to 3 words, max ~20 characters, e.g. `"Logged Flights"`, `"Active Routes"`) so it fits on one line in compact cards; secondary context belongs in `subtitle` (2 to 4 words, max ~25 characters, e.g. `"National Airspace"`, `"Scheduled carriers"`), which renders on a dedicated muted 11px line below the headline value. Do not use emojis or `icon` attributes in KPI cards or titles; match Looker's clean typography.

#### The coordinate grid: opt in when tiles must hold fixed positions

For a BI-style grid layout — a flat single screen where every tile sits at a fixed
spot and nothing reflows — use `.da-grid` and give each direct child a
`cell="x y w h"`: the 0-based start column and row, then the column and row
spans, over 96 columns with an 8px row unit.

```html
<div class="da-grid da-grid-square">
  <app-kpi cell="0 0 48 14"  label="Revenue" query-field="orders.total" format="usd"></app-kpi>
  <app-kpi cell="48 0 48 14" label="Orders"  query-field="orders.count" format="int"></app-kpi>
  <div class="card da-tile" cell="0 14 96 36"><app-chart height="100%" ...></app-chart></div>
  <app-grid cell="0 50 96 40" height="100%" ...></app-grid>
</div>
```

Reach for it when the user asks for a dashboard whose tiles must line up exactly.
**Do not** use it as a default wrapper around a layout that would be simpler as
flow, and never reverse-engineer a layout with absolute positioning — that
reflows nowhere.

What to know before you choose it:

- **Positions are absolute.** Inserting a band means renumbering the `y` of every
  tile below it. Place tiles side by side with the same `y` and adjacent columns
  summing to 96; stack rows by increasing `y`.
- **Default gutter is 12px.** The runtime adds a 12px gutter between tiles
  by default (`--da-grid-gutter: 6px` per tile side). Place tiles flush
  against each other (`next band at y = previous y + h`); the runtime handles
  tile spacing. Set `--da-grid-gutter: 0px;` on `.da-grid` for flush tiles.
- **Heights are fixed**, in 8px units (`h=14` → 112px cell, 100px tile; `h=36` → 288px cell, 276px tile), and tiles
  do not grow with their content: what does not fit spills over the card edge.
  Leave room for text that may wrap or grow.
- **A KPI with `sparkline` needs `h >= 20`** (160px cell, 148px tile) so the
  sparkline trendline, label, and subtitle fit inside the card.
- **All KPIs in one row use the same `h`.** If any KPI in the row has a sparkline, give the whole row `h = 20`.
- **Composed tiles stay whole.** A hero with a number over a background is ONE
  tile — `cell` on the wrapper, backdrop inside it.
- **Filling the cell.** A chart/grid that is a direct child takes `height="100%"`.
  For a titled card, add `class="… da-tile"` so the widget grows under its heading.
- **It collapses on narrow widths** to 2 columns and then 1, using the tile's
  width bucket. Check both, and check `?sandbox=true`.
- Header and filter chrome can sit above the grid; it doesn't have to be a tile.

See the **grid-layout** recipe for the full reference.
---

3. **Discover the fields before you write anything.** Every field you
   reference must exist — inventing one is the single most common way a build
   fails late.

   - **Step A: Instance Overview:** Run `python3 skills/data-app-creator/tools/explore-model.py` (with no arguments) to inspect all active models, explores, and joined views across the instance in a single concise call. Identify the single primary explore that matches your prompt's domain (if the prompt names no specific model/explore, check `data-apps-config.json` for `default_model` and `default_explores`; otherwise pick the single best-matching explore from the instance overview and do not probe unrelated models). Focus on a single primary explore for most dashboards; combine multiple explores only when your prompt explicitly spans distinct business domains.
   - **Step B: Get Complete Explore Schema (1 call):** Run `python3 skills/data-app-creator/tools/explore-model.py <model> <explore>` to fetch the complete, untruncated field list (all dimensions and measures with types, SQL formulas, and descriptions) for your chosen explore.
   - **Preflight probing and dropdown values (batch in 1 call, always include `--fields` with `--probe`):**
     If you want to preflight test candidate fields or need distinct values for a dropdown filter, pass `--probe --fields <f1,f2>` and `--values <dim>` in a single call (`--fields` is required with `--probe`; `--sample` selects representative fields automatically):
     ```bash
     python3 skills/data-app-creator/tools/explore-model.py <model> <explore> \
       --probe --fields orders.count,orders.total_revenue,users.state \
       --values users.state
     ```

---

### Design freedom — three layers, each one optional

A Data App is a Lit component rendering into Light DOM. Everything CSS can
express, it can express:

1. **Defaults.** `<app-chart type="column" title="…">` — a finished card:
   chrome, header, skeleton, error banner. Fastest path; use it for most tiles.
2. **Props.** `height`, `value-format`, `color`, `categoryColors`, `polarity`,
   and `.options` (deep-merged into the generated Highcharts config).
3. **Your own design.** `bare` removes the card entirely, leaving just the
   visualization to place inside whatever you're building — a gradient hero
   panel, a glass tile, a dense matrix cell.

```javascript
html`
  <style>
    .hero-tile {
      background: linear-gradient(135deg, #4f46e5, #0ea5e9);
      border-radius: 18px; padding: 24px; color: #fff;
      box-shadow: 0 12px 30px -12px rgba(79, 70, 229, .5);
    }
    /* Scoped to my own wrapper — never target .chart-header globally. */
    .hero-tile .chart-header { color: #fff; letter-spacing: .08em; }
  </style>

  <div class="hero-tile">
    <app-chart bare type="areaspline" title="REVENUE" height="240px"
      .query=${{ fields: ['orders.created_month', 'orders.total_revenue'],
                 filters: this.getEffectiveFilters({}, { isTimeSeries: true }) }}>
    </app-chart>
  </div>
`
```

**Scope every override of a runtime class.** The runtime owns `.da-chart-card`,
`.da-grid-card`, `.chart-container`, `.chart-header`, `.grid-container`,
and `.da-kpi-wrap`. Target them only scoped to your own wrapper.
When an app needs a dropdown, `<app-select>` is the author-facing API; `.da-select*`
classes are runtime internals. Add a dropdown only when the request asks for one.
An app whose filtering comes from `@app-chart-click` or from the dashboard filter bar
needs no `<app-select>`, and adding one anyway is a defect.

- **Default Appearance:** The default look follows modern Looker dashboards (white canvas, 16px radius, `#dadce0` borders, no shadows, Looker palette, compact table).
- **Theme & Color System:** Define colors using CSS custom properties (`--app-bg`, `--app-card-bg`, `--app-text`, etc.). For dark dashboards, theme tokens, and interactive light/dark mode toggles via `this.isDark` / `this.toggleDarkMode()`, follow [`recipes/dark-theme.md`](recipes/dark-theme.md).

**Putting a widget inside your own panel? Add `bare`.**
```html
<div class="my-panel">
  <app-chart bare type="column" ...></app-chart>
</div>
```

4. **Build the first screen, then stop and show it.**
   - **Composition floor:** Unless the user asks for a single widget or an explicitly minimal layout, every app includes (1) a KPI strip, (2) at least one time trend, (3) at least one ranking or part-to-whole chart, and (4) a detail `<app-grid>` table. Visuals the user names are added on top of this floor; they do not replace it. A detail table lets readers check the numbers behind the charts.
   - **MANDATORY FRAMEWORK: LIT WEB COMPONENTS (ONLY)**
     * Authored exclusively as Lit Web Components in `apps/<dashboard-name>/app.js`.
     * Modern ES module extending `DataApp` / `LitElement`. Never author legacy HTML fragments.
   - **User Specification Precedence:**
     * If the user explicitly asks for a multi-tab application or specifies detailed features, follow their instructions directly.

5. **Visual Recipe Library & Chart Selection:**
   - **Default to cross-filtering on charts:** Always add `cross-filter` (or `cross-filter="field.name"`) to every `<app-chart>` widget displaying categorical or breakdown data (column, bar, donut, pie, treemap, funnel, pyramid) by default unless explicitly instructed otherwise. Users expect clicking bars, slices, and tiles to cross-filter the dashboard automatically without having to ask. If a chart has a custom click action (such as opening a detail drawer on @app-chart-click), either omit cross-filter or call e.preventDefault() in @app-chart-click (or in options.plotOptions.series.point.events.click) to cancel automatic cross-filtering.
   - **KPI sparklines (`sparkline`):** When the headline is a per-period metric and the explore has a date or month dimension, add `sparkline` and a 2-field `[date_dimension, measure]` query filtered to complete periods (e.g. `'12 months ago for 12 months'`) and sorted by the time field (`sorts: ['<date_dim> desc']`) on `<app-kpi>` cards. The headline shows the latest period in the series, while `.value` replaces it with a total (see `kpi-strip` recipe).
   - **Standard primitives do not require recipes:** Standard KPI strips, `<app-select>` filter dropdowns, and basic charts are already demonstrated in the MVP template in Step 7 below.
   - **Batch recipe retrieval (1 command):** If your dashboard needs specific visual patterns, fetch the full recipe documentation in a single command using `get-recipe.py <pattern...>` (e.g. `python3 skills/data-app-creator/tools/get-recipe.py line-trend filter-dropdown`).
     * **Trends & Time-Series:** `line-trend` (areaspline/line trends), `small-multiples` (comparing category trends with shared Y-axis scale), `multi-series-and-stacked` (grouped/stacked columns), `stacked-bar` (100% share bars).
     * **Proportions & Hierarchy:** `donut-with-constraint` (breakdowns with center totals), `treemap` (relative category size), `funnel` (conversion stages), `gauge` (dial goal tracking).
     * **Interactive & Advanced:** `metric-switcher` (swapping queried measure on a single chart card), `column-with-cross-filter` (point-click filter updates), `column-conditional-format` (threshold colors), `filter-dropdown` (`<app-select>` multi-select).
     * **Tables & Data Grids:** `grid-heatmap` (colored cell metrics), `grid-card-list` (detail cards).
     * **Layout & Style:** `responsive-layout` (multi-tier auto-collapse), `sparkline-grid` (high-density KPI trend cards), `dark-theme` (executive dark mode), `custom-design` (bare custom cards).
   - Always include `looker-model="<MODEL>"` alongside `explore="<EXPLORE>"` on your widgets (or on a parent container).

6. **Theme Tokens & Reference Images:**
   Standard colour roles on the app root:
   - `--app-primary`: Main accent / single-series color.
   - `--app-chart-1` … `--app-chart-20`: Categorical chart-series palette (Looker 2026), plus `--app-chart-up`, `--app-chart-down`, `--app-chart-total`, and `--app-chart-unselected`.
   - `--app-bg`, `--app-card-bg`, `--app-border`: Backgrounds and borders.
   - `--app-title`, `--app-text`, `--app-muted`: Typography hierarchy.
   - Charts reference tokens: `color="var(--app-primary)"`.
   - If a reference image is attached, extract colours:
     ```bash
     python3 skills/data-app-creator/tools/extract-palette.py <image> > palette.json
     ```

7. **Write the Data App (`apps/<dashboard-name>/app.js`).**

   - **Author cleanly in a single pass:** When creating a new app, write the complete, self-contained implementation into `apps/<dashboard-name>/app.js` using `write_to_file` (with `Overwrite: true`) rather than building it up through multiple partial edits. For subsequent iterations, targeted fixes, or self-healing adjustments, use `replace_file_content`.
   - Every `app.js` starts with this header:
   ```javascript
   /**
    * @title <Dashboard Name>
    * @description <one sentence: purpose, domain, primary metrics>
    */
   ```
   When published, `publish-data-app.py` appends publish metadata tags (`@looker-dashboard-id`, `@looker-instance`, `@created-at`, `@created-by`, `@toolkit-version`) to this header. Always preserve these tags during subsequent edits.

   **Standard MVP Template:**
   ```javascript
   import { DataApp, html, nothing, formatValue } from '/runtime/data-app.js';

   export const elementName = 'my-data-app';

   export class MyDataApp extends DataApp {
     static properties = {
       filterValue: { type: String },
     };

     constructor() {
       super();
       this.lookerModel = '<MODEL>';
       this.explore = '<EXPLORE>';
       this.filterValue = 'All';
     }

     getEffectiveFilters(local = {}) {
       const filters = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) };
       if (this.filterValue !== 'All') {
         filters['<VIEW>.<DIMENSION>'] = this.filterValue;
       }
       return { ...filters, ...local };
     }

     render() {
       return html`
         <div class="da-container">
           <!-- Header & Filter Bar -->
           <div class="da-filter-bar">
             <app-select
               label="Filter"
               .value=${this.filterValue}
               .options=${['All', 'Option A', 'Option B']}
               @change=${e => { this.filterValue = e.detail.value; }}>
             </app-select>
           </div>

           <!-- One real square CSS grid: every tile placed by its cell="x y w h" coordinate -->
           <div class="da-grid da-grid-square">
             <!-- KPI strip: two half-width tiles on row 0 (columns 0 and 48) -->
             <app-kpi
               cell="0 0 48 20"
               label="Monthly Revenue"
               sparkline
               sparkline-agg="sum"
               format="usd"
               .query=${{ fields: ['orders.created_month', 'orders.total_revenue'], sorts: ['orders.created_month desc'], limit: '12' }}
               .filters=${this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true })}>
             </app-kpi>
             <app-kpi
               cell="48 0 48 20"
               label="Conversion Rate"
               query-field="orders.conversion_rate"
               format="percent1"
               .filters=${this.getEffectiveFilters()}>
             </app-kpi>

             <!-- Two breakdown charts side by side on row 20 (columns 0 and 48) -->
             <app-chart
               cell="0 20 48 36"
               type="column"
               title="Performance by Category"
               height="100%"
               cross-filter
               .query=${{ fields: ['products.category', 'orders.total_revenue'], sorts: ['orders.total_revenue desc'], limit: '10' }}
               .filters=${this.getEffectiveFilters()}>
             </app-chart>

             <app-chart
               cell="48 20 48 36"
               type="donut"
               title="Status Distribution"
               height="100%"
               cross-filter
               .query=${{ fields: ['orders.status', 'orders.count'], sorts: ['orders.count desc'] }}
               .filters=${this.getEffectiveFilters()}>
             </app-chart>

             <!-- Full-width detail table on row 56 -->
             <app-grid
               cell="0 56 96 40"
               title="Recent Orders"
               height="100%"
               .query=${{ fields: ['orders.id', 'users.name', 'orders.total_revenue', 'orders.created_date'], limit: '50' }}
               .filters=${this.getEffectiveFilters()}>
             </app-grid>
           </div>
         </div>
       `;
     }
   }

   if (!customElements.get(elementName)) {
     customElements.define(elementName, MyDataApp);
   }

   export default MyDataApp;
   ```

8. **Automated QA Verification (MANDATORY SUBAGENT DELEGATION):**
   Before presenting your code, automated QA verification must be performed.

   - **Strict Post-Write Sequence Rule:** Automated QA verification is strictly a post-implementation gate. **DO NOT** run `verify-app.py` or `check-tile-safety.py` before `apps/<name>/app.js` has been completely written in Step 7. Running verification against an empty or incomplete scaffold generates spurious syntax and structure failures that pollute your context.
   - **Subagent Policy:** If you have subagent or child-agent capabilities (such as `invoke_subagent`, `Task`, or equivalent), you **MUST NOT** run verification directly in your main thread. Delegate this to a subagent so that verification logs and self-healing iterations stay isolated.
   - **Subagent Task:** Instruct the subagent to run `python3 skills/data-app-creator/tools/verify-app.py apps/<name>/app.js`, inspect any failure hints, edit `apps/<name>/app.js` to fix them, and repeat until all stages pass cleanly.
   - **Browser Hang & Timeout Fallback (`--no-browser`):** If `verify-app.py` runs for more than 30 seconds or Stage 4 fails with a headless browser timeout, stop the stuck run and re-run with `python3 skills/data-app-creator/tools/verify-app.py apps/<name>/app.js --no-browser` so Stages 1–3 finish without blocking delivery. Never retry headless Chrome after a timeout, debug browser processes, or create browser wrapper scripts.
   - **Single-Agent Fallback:** Only if your environment does not have any subagent or child-task capabilities may you run `python3 skills/data-app-creator/tools/verify-app.py apps/<name>/app.js` directly in your terminal.

   **What `verify-app.py` checks:**
   - **Stage 1 (Syntax):** JavaScript syntax validity (catches unescaped quotes like `'O\'Hare'`).
   - **Stage 2 (Tile Safety):** AST sandbox constraints (no `localStorage`, no `onclick`, no second imports), composition warnings (missing detail table, thin app, hardcoded `yAxis.max`), and static widget query extraction (warns if any widget's query cannot be registered for "Explore from here").
   - **Stage 3 (Query Dry-Run):** Probes your queries against Looker (catches `Model Not Found`, HTTP 422 bad fields, 0-row empties).
   - **Stage 4 (Headless Visual):** Automated full-height screenshot capture (`apps/<name>/preview.png`, taller than the fold when the app is) when a preview server is active. Stage 4 checks both the edit mount and the tile sandbox, waits for the sandboxed app to finish loading, and fails if the sandbox still has queries running at capture time. If the preview server is already running, Stage 4 captures visual verification automatically. If not running, verification cleanly passes offline on Stages 1–3 without needing to launch a background server.
   - **Automatic Live Preview:** Once verification passes, immediately start the background preview server and open the app in a new browser tab by running `python3 skills/data-app-previewer/tools/start-preview.py apps/<name>/app.js` (unless the user explicitly requested code-only output or an evaluation harness is active). Never ask the user to run `start-preview.py` themselves.

   **Self-Healing Loop:** If Stages 1–3 or Stage 4 DOM checks report errors, **DO NOT** stop and do not ask the user. Read the error envelope and hint, fix `apps/<name>/app.js`, and re-run `verify-app.py` until it passes cleanly (using `--no-browser` if Stage 4 timed out).

---

## Top Gotchas to Avoid (Read Before Writing Code)

### 1. Hardcoded Static Filters vs. Dynamic `getEffectiveFilters()`
Always route every widget filter through `this.getEffectiveFilters(...)` and **always spread both `this.dashboardFilters` and `this.crossFilters`** (`const filters = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) };`). If you do not spread `this.dashboardFilters`, native Looker dashboard filter bar controls will silently fail to update your queries.

### 2. Ratio & Percentage Formatting Standard (`0.0` to `1.0`)
LookML ratios return raw decimals (`0.792`). Always specify `format="percent1"` on `<app-kpi>` and `value-format="percent1"` on `<app-chart>` (or `'percent-100'` for already-scaled 0–100 percentage values like `65.4%`, while `'percent'` auto-detects per series/column). Numbers without a format print without thousands separators, rounded to 2 decimals. Give each measure column a `valueFormat` (`int`, `decimal1`, `usd`, ...) in `<app-grid>` `columnDefs`, and set `value-format` on `<app-chart>` for tooltips and data labels. Leave IDs and years unformatted.

### 3. The Fan-Out Trap & Cross-Array Timeouts (HTTP 504)
Never combine measures from conflicting unnested array views into a single query. Bind separate widgets or use `this.mergeQueries()`.

### 4. Snapshot Flags vs Time-Series
Snapshot flags (`is_latest_snapshot`) belong on current-state tiles only. Opt out for date-trend charts:
```javascript
getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
  const filters = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) };
  if (this.selectedCategory !== 'All') filters['orders.category'] = this.selectedCategory;
  if (isTimeSeries) {
    if (this.timeframe !== 'all') filters['orders.created_date'] = this.timeframe;
  } else {
    filters['orders.is_latest_snapshot'] = 'Yes';
  }
  return { ...filters, ...local };
}
```

### 5. Auto-Pivoting
- `[date, metric1, metric2]` $\rightarrow$ multi-series by measure.
- `[date, category, metric]` $\rightarrow$ multi-series pivoted by category.

### 6. Screen Fit
Aim for ~850–950px of content height at ~1400px width. Start with one screenful and no tabs unless content genuinely splits into separate operational workflows.

### 7. Double Borders
Primitives are self-contained cards. If nesting in your own custom container, add `bare` to the inner primitive. Inside `.da-section-card`, do not: the runtime drops the border and shadow and keeps the padding.

### 8. Manual `updated()` Loops
Never write manual `updated()` query fetch loops. Widgets own their reactive query lifecycle.

### 9. Highcharts Label Collisions
Leave auto-rotation enabled for categorical axes rather than forcing `rotation: 0`.
Use `chart.spacing`, never `chart.margin`: `margin` is an absolute override of the axis band rather than a minimum, so labels that need a taller band render outside the chart's own SVG viewport and are clipped, and a bigger tile does not fix it.

### 10. `.options` Handling
Passing `.options=${{ series: [...] }}` replaces fetched series. Use `.options` for styling (`plotOptions`, `colors`, `yAxis.plotLines`).

### 11. Declarative Cross-Filtering and `getEffectiveFilters()`
Use `cross-filter` on `<app-chart>` by default instead of manual `@app-chart-click` handlers (if custom state handling explicitly requires `@app-chart-click`, read the clicked point value from `e.detail.value`). Cross-filter and click-to-gray selection apply to segmented visual surfaces (`column`, `bar`, `pie`, `donut`, `treemap`, `funnel`, `pyramid`), turning unselected items solid neutral gray (`#dadce0` light, `#374151` dark) while the selected segment keeps its color; they are not supported on single-point or single-value visuals (`line`, `spline`, `area`, `areaspline`, `scatter`, `gauge`, `solidgauge`, `<app-kpi>`, `<app-grid>`). `this.crossFilters` holds ready-to-use Looker filter expressions per field; when overriding `getEffectiveFilters()`, always spread `this.crossFilters` (`{ ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) }`) or cross-filtering will not reach widgets.

### 12. Numeric Values (Parsing Raw Formatted String Metrics)
When dimensions in LookML represent numbers or versions stored as strings, warehouse SQL sorts them lexically (`'100'` before `'20'`). When custom aggregations or sorts are needed:
- Apply a numeric sort on rows: `(a, b) => parseFloat(a[field]) - parseFloat(b[field])`.
- When calculating metrics from string cell values, always parse with `parseFloat(val)` before arithmetic to avoid string concatenation.

### 13. Unescaped Apostrophes & Quotes in Strings ("O'Hare")
When dashboard titles, airport names, or filter strings contain apostrophes (e.g. `O'Hare`, `O'Connor`), wrapping them in single quotes (`'O'Hare'`) causes a fatal JavaScript `SyntaxError: Unexpected identifier`. Always use double quotes (`"O'Hare"`), backticks, or escape the apostrophe (`'O\'Hare'`).

### 14. Layout Authoring Rules
1. **Size containers, not widgets:** charts take height from CSS, so stop writing `height="300px"` on every tile.
2. **Alignment is free:** equal row heights fall out of CSS grid without arithmetic.
3. **Width caps beat height caps:** a `max-width` on a donut or gauge is width-invariant, while a fixed height is not.
4. **Primitive horizontal floors:** 5-column table ~600px, ranked list with real labels ~600px, line chart ~300px, legend+bar share list ~240px.
5. **Collapse on content, not the default 860px:** a row holding a 5-column table must collapse near 1150px.
6. **Under width pressure, increase asymmetry:** a symmetric `1fr 1fr` intermediate step starves the high-floor element.
7. **Use the full range of visuals:** not everything becomes a ranked list and a bar chart.
8. **Never co-plot incompatible magnitudes:** disparate scales compress the smaller series into a flat line at zero; use a dual axis or separate charts.
9. **Do not height-match a short list to a tall neighbour:** it buys alignment with ~90px of dead space.
10. **`chart.spacing`, never `chart.margin`:** `margin` overrides the axis band absolutely, causing Highcharts to clip labels inside its SVG viewport.
11. **Container owns vertical rhythm:** `.da-container` manages vertical spacing via `--app-gap`, so do not hand-write `gap` or `margin-bottom` on top-level sections.
12. **One measure, one colour:** giving each bar of a single-measure chart its own colour implies a second encoding that does not exist. Vary colour only when it carries meaning, such as a second dimension or a threshold band.
13. **Horizontal bars once category labels run long:** past roughly 12 characters a vertical column chart rotates or truncates its labels, while a horizontal bar gives them the full width. Set `xAxis: { reversed: true }` so rank 1 lands at the top.
14. **Shorten a label from the part that differs:** `split(' ')[0]` collapses "San Francisco International" and "San Diego International" into the same word. Keep the distinctive token, not the first one.
15. **Synchronize scale on small multiples unless magnitudes skew:** small multiples of comparable magnitude share one scale via `y-scale-group` (never hardcode `yAxis.max`), while categories that differ by more than ~5x or focus on internal curve shape omit `y-scale-group` so smaller series are not flattened at zero.
16. **Seamless nested multiples:** put multiples inside one `.da-section-card` with column dividers, never nested cards, and without `bare`; see the `small-multiples` recipe.
17. **Flat pie with no center total:** to render a flat pie with no donut hole or center total, set `options = { plotOptions: { pie: { innerSize: '0%' } } }`.

---

## Tile Sandbox Constraints

| Don't | Why | Do instead |
| --- | --- | --- |
| inline `onclick="..."` HTML strings | Blocked by CSP | Use Lit event bindings: `@click=${() => this.action()}` |
| `alert` / `confirm` / `prompt` | Blocked / No-op in sandbox | Use reactive modal templates or floating snackbars |
| `localStorage` / `sessionStorage` | Throws in opaque origin | Store state in Lit component properties |
| `window.open` / `target="_blank"` | Returns null in sandbox | Render views inside the application tabs |
| Relative URLs to external assets | No `<base>` tag | Use absolute URLs or inline SVG icons |
| Duplicate `connectExtensionHost()` | Handshake fails | Rely on `window.DataApps.queryRunner` installed by the runtime or `this.runQuery()` |
| Direct `document.body` or `document.documentElement` mutation | Leaks in embedded sandboxes | Rely on `DataApp.isDark` / `toggleDarkMode()` (which centralizes canvas background styling safely) rather than manual DOM writes. Scope custom classes to `<div class="da-container">` |
| Importing a second local module | Only `data-app.js` / `lit.mjs` get rewritten | Keep the app to one self-contained file |

## Forbidden Moves

- **No Manual Fetch Loops:** Never write `updated(changed)` loops that manually execute queries and mutate multiple state properties.
- **No TypeScript Decorators:** Never use `@customElement` or `@property()`. Always use `static properties = { ... }` and `customElements.define()`.
- **No Shadow DOM:** Never attach shadow roots. Always use Light DOM for Looker theme and CSS variable inheritance.
- **Never Invent Field Names:** Always verify dimension and measure names against Looker models using `explore-model.py`.
- **Never Run Unconstrained Queries:** Always specify a `"limit"` and partition/date filters in `.query`.

---

## When the user is stuck

- If they ask for a chart type a recipe doesn't cover, write the Highcharts options from scratch but keep them minimal (the runtime applies sane defaults) and note that adding a recipe for this type would be a good follow-up.
- If they want to add LookML fields that don't exist, redirect them to Develop mode in Looker — this skill creates dashboards against existing models, it doesn't author LookML.
- If publish fails (Looker API error, network, permissions), surface the error verbatim. Don't retry blindly.

---

## Reading error envelopes

Both `serve.py /api/query` and `publish-data-app.py` return errors in a structured envelope so you can self-correct without bouncing back to the user every time:

```json
{
  "error_type": "field_not_found",
  "message": "Looker rejected the query (HTTP 422): ...",
  "hint": "One of the LookML fields referenced in this query doesn't exist...",
  "suggested_action": "Re-run explore-model.py, swap the bad field..."
}
```

When you encounter an error envelope:
1. **Read `hint` first.** It names the most likely fix without re-deriving it from raw HTTP responses.
2. **Take `suggested_action` literally** when concrete (e.g. re-run `explore-model.py`). If it requires admin intervention, surface that directly to the user.
3. **Only escalate to the user** when the envelope indicates you cannot self-correct.

---

## Suggest what you learned

When reporting your progress, describe concrete observations discovered in the LookML model (e.g. dimensions that would slice well, complementary explores, or date ranges found during discovery).

---

## Phase Completion & Next Step Handoff

Once `apps/<app-name>/app.js` is written and passes `verify-app.py`:

1. **Standard Interactive Flow (Default):**
   Unless the user explicitly requested code-only output or an evaluation harness is active: **Proceed immediately to preview and inspect the application by invoking or loading the `data-app-previewer` skill** (`skills/data-app-previewer/SKILL.md`), running `python3 skills/data-app-previewer/tools/start-preview.py apps/<app-name>/app.js`, and opening the preview URL in a new browser tab. In your summary, share the live preview URL, the gallery URL (`http://localhost:8765/preview-server/`), and the top-level command for the user to launch the gallery later (`make start` or `python3 preview-server/serve.py`).

2. **Direct Publish Option:**
   If the user specifically requested immediate deployment to Looker or wants to skip local preview:
   **Hand off directly to the `data-app-publisher` skill** (`skills/data-app-publisher/SKILL.md`).

3. **Code-Only / Evaluation Mode:**
   If running in a non-interactive eval harness or code-only generation mode:
   Conclude the creation phase by outputting a summary of the authored app and state that preview (`data-app-previewer`) or publishing (`data-app-publisher`) can be run when ready.
