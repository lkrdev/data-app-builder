# Donut & Pie Chart — Lit Data Apps

## Use when

Displaying categorical proportions and share breakdowns (e.g. traffic sources, sales channel mix).

## Canonical Lit Snippet

```javascript
html`
  <app-chart
    title="<TITLE>"
    type="donut"
    looker-model="<MODEL>"
    explore="<EXPLORE>"
    cross-filter
    .query=${{
      fields: ['<VIEW>.<CATEGORY_FIELD>', '<VIEW>.<MEASURE>'],
      filters: this.getEffectiveFilters(),
      sorts: ['<VIEW>.<MEASURE> desc'],
      limit: '10'
    }}>
  </app-chart>
`
```

## Fields to swap

- `<TITLE>` — Donut chart title.
- `<MODEL>` / `<EXPLORE>` — LookML model and explore.
- `<VIEW>.<CATEGORY_FIELD>` — Dimension (e.g. `users.traffic_source`).
- `<VIEW>.<MEASURE>` — Measure (e.g. `order_items.total_revenue`).

## Making a slice clickable (cross-filtering)

Add the `cross-filter` attribute (included in the snippet above) to handle slice clicks, deselect,
highlighting, and self-exclusion automatically. Clicking a slice updates host
`DataApp.crossFilters`, turns unselected slices solid gray, and excludes the
donut from its own filter so it keeps showing every slice. Sibling widgets pick
up the filter through their own `.filters=${this.getEffectiveFilters()}` binding.
The pattern is identical for `pie`/`donut`, `column`/`bar`, `treemap`, and `funnel`/`pyramid`; only the chart
`type` changes. See `column-with-cross-filter.md` for full details.
