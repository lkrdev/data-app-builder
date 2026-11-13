# Line & Area Trend — Lit Data Apps

## Use when

Visualizing continuous metric trajectories over time (revenue by month, orders by week, conversion rate over time).

## Canonical Lit Snippet

```javascript
html`
  <app-chart
    title="<TITLE>"
    type="areaspline"
    color="var(--app-primary)"
    looker-model="<MODEL>"
    explore="<EXPLORE>"
    .query=${{
      fields: ['<VIEW>.<DATE_DIMENSION>', '<VIEW>.<MEASURE>'],
      filters: this.getEffectiveFilters(),
      sorts: ['<VIEW>.<DATE_DIMENSION> asc'],
      limit: '500'
    }}>
  </app-chart>
`
```

## Fields to swap

- `<TITLE>` — Chart card title.
- `<MODEL>` / `<EXPLORE>` — LookML model and explore.
- `<VIEW>.<DATE_DIMENSION>` — Time dimension (e.g. `order_items.created_month`).
- `<VIEW>.<MEASURE>` — Measure field (e.g. `order_items.total_revenue`).
- `color` — Series colour. `var(--app-primary)` follows the theme accent; pass a literal hex or your own `var(--brand-…)` to
  override. See SKILL.md step 5.
