# Custom-Designed App (no `.da-*` classes)

## Use when

The design is the point: a brand palette, a reference image, a hero panel, a
console aesthetic — anything where the default card grid isn't the answer. Also
the pattern to reach for when reproducing an existing dashboard's look.

This recipe exists to make one thing concrete: **the `.da-*` utility classes
are optional.** An app that uses none of them is not doing anything unusual. The
components carry the query lifecycle; the design is yours.

## The two moves

1. **`bare`** on `<app-chart>`, `<app-grid>`, and
   `<app-kpi>` strips the runtime's card (background, border, radius,
   shadow, padding), leaving just the visualization to drop into your own panel.
2. **A scoped `<style>` block** in `render()`. Prefix your classes (`.ops-`,
   `.cl-`) so they can't collide with runtime internals, and scope any override
   of a runtime class to your own wrapper — never globally.

## Snippet

```javascript
render() {
  return html`
    <style>
      /* Route the palette through the standard theme tokens on the app ROOT so
         every component picks it up (SKILL.md step 5). For a custom shell like
         this the root is the custom element host — use its tag name (this app's
         `elementName`), not a child wrapper, or the tokens get shadowed. The
         accent goes into --app-primary; charts read the role tokens
         (--app-primary, --app-chart-1…7). */
      revenue-ops-app {
        --brand-accent: #6366f1;
        --brand-ink: #0f172a;
        --app-primary: var(--brand-accent);
      }
      .ops-root {
        max-width: 1400px; margin: 0 auto; padding: 20px 24px 40px;
        font-family: 'Inter', system-ui, sans-serif; color: var(--brand-ink);
      }
      .ops-hero {
        display: flex; align-items: flex-end; justify-content: space-between;
        gap: 16px; padding: 22px 26px; border-radius: 18px; margin-bottom: 20px;
        background: linear-gradient(120deg, #4f46e5 0%, #6366f1 45%, #0ea5e9 100%);
        color: #fff; box-shadow: 0 12px 30px -12px rgba(79, 70, 229, .5);
      }
      .ops-hero h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }

      /* Custom tiles: my chrome, not the runtime's. */
      .ops-tile {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
        padding: 18px; box-shadow: 0 8px 24px -18px rgba(15, 23, 42, .45);
      }
      .ops-tile-label {
        font-size: 11px; font-weight: 700; letter-spacing: .09em;
        text-transform: uppercase; color: #64748b; margin-bottom: 10px;
      }
      .ops-split { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
      @media (max-width: 900px) { .ops-split { grid-template-columns: 1fr; } }

      /* Scoped to my wrapper — never target .chart-header globally. */
      .ops-tile .chart-header { font-size: 12px; color: #64748b; }
    </style>

    <div class="ops-root">
      <header class="ops-hero">
        <div><h1>Revenue Operations</h1></div>
        <app-select
          label="Region"
          .value=${this.region}
          .options=${['All', 'AMER', 'EMEA', 'APAC']}
          @change=${e => { this.region = e.detail.value; }}>
        </app-select>
      </header>

      <div class="ops-split">
        <div class="ops-tile">
          <div class="ops-tile-label">Revenue trajectory</div>
          <app-chart bare type="areaspline" height="260px"
            value-format="usd" color="var(--app-primary)"
            .query=${{
              fields: ['orders.created_month', 'orders.total_revenue'],
              filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
              sorts: ['orders.created_month asc'],
              limit: '500'
            }}>
          </app-chart>
        </div>

        <div class="ops-tile">
          <div class="ops-tile-label">Share by category</div>
          <app-chart bare type="donut" height="260px" value-format="usd"
            .query=${{
              fields: ['products.category', 'orders.total_revenue'],
              filters: this.getEffectiveFilters(),
              sorts: ['orders.total_revenue desc'],
              limit: '8'
            }}>
          </app-chart>
        </div>
      </div>
    </div>
  `;
}
```

## The one rule `bare` does not relax: a data value is a widget

`bare` lets you drop a widget into any design. It does **not** license rendering
a *value* yourself. The moment you show a number that came from Looker, a
`<app-*>` element must render it — never interpolate it as text.

```javascript
// ✗ WRONG — the number is live data, but it's just text in a <div>.
//   It isn't a widget, so it won't re-query on a filter change, and it opts out
//   of the reconnect lifecycle that keeps a widget's data alive.
<div class="hal-eye"><span class="core">${this.completeShare}</span></div>

// ✓ RIGHT — same number, rendered by a KPI. Now the panel is a real grid
//   tile and the value is live. The glowing aperture around it is still yours.
<div class="hal-eye">
  <span class="core">
    <app-kpi bare format="percent1" .value=${this.completeShare}></app-kpi>
  </span>
</div>
```

Choosing how the value reaches the widget:

- **It's a single LookML measure** → give the KPI a `query-field` and bind
  `.filters=${this.getEffectiveFilters()}`; it then re-queries automatically on
  filter-bar changes. Always prefer this. (Without `.filters` bound the KPI
  queries unfiltered and won't track the bar.)
- **You compute it yourself** (a ratio, a blend — anything that isn't one
  measure) → compute with `runQuery` into a reactive property, then pass it in
  with `.value`, which bypasses the widget's own fetch:

```javascript
async firstUpdated() {
  const rows = await this.runQuery({ explore: 'order_items',
    fields: ['order_items.status', 'order_items.count'], limit: '10' });
  const total = rows.reduce((s, r) => s + Number(r['order_items.count'] || 0), 0);
  const done  = rows.filter(r => r['order_items.status'] === 'Complete')
                    .reduce((s, r) => s + Number(r['order_items.count'] || 0), 0);
  this.completeShare = total ? done / total : null;   // reactive → re-renders the KPI
}
```

Caveat for `.value`: it shows a tile and the number, but it does **not**
re-query itself. If the metric should track the filter bar, re-run your
`runQuery` when filters change — a `query-field` KPI does that for free, so reach
for `.value` only when the value genuinely isn't a single measure.

## Notes

- `bare` reflects to an attribute, so `?bare=${this.compact}` toggles the chrome
  reactively.
- A wrapper class ending in `-card` (`.ops-card`) auto-neutralizes inner widget
  chrome via the runtime stylesheet — the older, implicit form of the same
  thing. `bare` is preferred for new work: explicit, and it needs no wrapper.
- Going further: `.data=${rows}` bypasses the query layer entirely (fetch with
  `await this.runQuery(...)`, transform, then bind) while keeping the
  component's reflow, abort, and error handling. `.options` deep-merges into the
  generated Highcharts config — but arrays are *replaced*, so never pass
  `series`.
- Absolute positioning inside a sized root is supported too, when you are
  matching an exact layout. Set the root's own `position: relative` and size;
  don't rely on `.da-container`, whose flex column will fight you.

## Fields to swap

- `orders.*` / `products.*` — real field names from `explore-model.py`.
- Palette, radii, and typography — from `extract-palette.py` if the user
  supplied a reference image; never eyeball colors. Assign the sampled colors
  into the standard role tokens on the app root (`--app-primary`,
  `--app-chart-1`…`--app-chart-7`, `--app-bg`, `--app-card-bg`, `--app-title`,
  `--app-text`, `--app-muted`, `--app-border`) so every component picks them
  up. There is no palette manifest to declare — see SKILL.md step 5.
