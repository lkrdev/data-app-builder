# Column Chart — Lit Data Apps

## Use when

Visualizing discrete categories (traffic sources, product categories, departments) with clean column bars.

## Canonical Lit Snippet

```javascript
html`
  <app-chart
    title="<TITLE>"
    type="column"
    color="var(--app-primary)"
    looker-model="<MODEL>"
    explore="<EXPLORE>"
    .query=${{
      fields: ['<VIEW>.<CATEGORY_FIELD>', '<VIEW>.<MEASURE>'],
      filters: this.getEffectiveFilters(),
      sorts: ['<VIEW>.<MEASURE> desc'],
      limit: '500'
    }}>
  </app-chart>
`
```

## Fields to swap

- `<TITLE>` — Chart title.
- `<MODEL>` / `<EXPLORE>` — LookML model and explore.
- `<VIEW>.<CATEGORY_FIELD>` — Dimension (e.g. `users.traffic_source`).
- `<VIEW>.<MEASURE>` — Measure (e.g. `order_items.total_revenue`).
- `color` — `var(--app-primary)` follows the theme accent; pass a literal hex or `var(--brand-…)` to override. See SKILL.md step 5.

## Interactive cross-filtering (`cross-filter`)

Add `cross-filter` to `<app-chart>`. The runtime handles the interaction automatically:

```javascript
<app-chart
  title="Orders by Category"
  type="column"
  looker-model="<MODEL>"
  explore="<EXPLORE>"
  cross-filter
  .query=${{
    fields: ['products.category', 'order_items.count'],
    filters: this.getEffectiveFilters(),
    sorts: ['order_items.count desc'],
    limit: '20'
  }}>
</app-chart>
```

What happens on click:
1. Clicking a bar toggles `products.category` in `host.crossFilters` (or the field set via `cross-filter="field.name"`).
2. The runtime turns unselected bars solid neutral gray and keeps the selected bar at full color.
3. Sibling widgets bound to `getEffectiveFilters()` re-query with the filter applied.
4. The emitting chart is automatically excluded from its own cross-filter.

### Custom click actions & canceling cross-filter

If clicking a chart element should open a modal, slide-out drawer, or custom detail panel instead of toggling a dashboard cross-filter, call `e.preventDefault()` in `@app-chart-click`:

```javascript
<app-chart
  title="Orders by Category"
  type="column"
  cross-filter
  @app-chart-click=${(e) => {
    e.preventDefault();
    this.selectedItem = e.detail.value;
    this.showDetailDrawer = true;
  }}
  .query=${{
    fields: ['products.category', 'order_items.count'],
    filters: this.getEffectiveFilters(),
    sorts: ['order_items.count desc'],
    limit: '20'
  }}>
</app-chart>
```

Alternatively, author-supplied `options.plotOptions.series.point.events.click` (or `pie` / `donut`) functions can call `e.preventDefault()` or return `false` to cancel automatic `cross-filter` toggling while handling the click.
