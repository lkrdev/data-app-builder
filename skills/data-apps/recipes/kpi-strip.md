# KPI Strip — Lit Data Apps

## Use when

Top-of-dashboard summary metric strip (e.g. Monthly Revenue, Monthly Orders, Conversion Rate).

## Canonical Lit Snippet

```javascript
html`
  <section class="da-kpi-grid">
    <app-kpi
      label="Monthly Revenue"
      format="usd"
      sparkline
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.created_month', 'order_items.total_revenue'],
        sorts: ['orders.created_month desc'],
        filters: this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true }),
        limit: '12'
      }}>
    </app-kpi>

    <app-kpi
      label="Monthly Orders"
      format="int"
      sparkline
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.created_month', 'orders.count'],
        sorts: ['orders.created_month desc'],
        filters: this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true }),
        limit: '12'
      }}>
    </app-kpi>

    <app-kpi
      label="Conversion Rate"
      format="percent1"
      change="-0.2%"
      change-type="negative"
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.conversion_rate'],
        filters: this.getEffectiveFilters(),
        limit: '1'
      }}>
    </app-kpi>
  </section>
`
```

## Fields to swap

- `label`: The card's caption (1–3 words, max ~20 chars). When the headline comes from the sparkline series, use a per-period label (`"Monthly Revenue"`, not `"Total Revenue"`). Secondary context belongs in `subtitle` (2–4 words, max ~25 chars), which renders on its own muted line below the headline value.
- `sparkline-agg`: Optional headline aggregation mode (`"sum"` or `"avg"`). Use `sparkline-agg="sum"` when the KPI headline should represent the full-period total rather than the latest period snapshot (`"last"` default).
- `subtitle`: Secondary qualifier (2–4 words, max ~25 chars) rendered on a dedicated muted line below the headline value without parentheses.
- `fields`: `['<VIEW>.<MEASURE>']` (or `['<VIEW>.<DATE_DIM>', '<VIEW>.<MEASURE>']` with `sparkline`).
- `format`: One of `usd`, `int`, `percent1`, `usd2`.
- `polarity`: `'higher-better'` (default) or `'lower-better'` (flips the computed delta tone for cost/churn/latency metrics).
- `change` / `change-type`: Optional manual delta badge text and its fixed `'positive'` / `'negative'` / `'neutral'` tone. See `kpi-with-delta.md`.

## Inline Sparkline & Auto-Computed Delta (sparkline)

Adding the boolean `sparkline` attribute with a 2-field `[date_dimension, measure]` query (or providing an array via `.sparkline=${[10, 20, 30]}`) renders an interactive inline SVG trendline with hover tooltip/crosshairs and automatically computes the latest period-over-period `%` delta badge from the last two data points.

- **Headline is the latest period:** The headline displays the latest period from the series (trailing rows whose measure is `null`, `undefined`, or `""` are skipped; `0` is preserved). Use per-period labels (`"Monthly Revenue"`, not `"Total Revenue"`) and filter to complete periods (e.g. `'12 months ago for 12 months'`) so an incomplete current month does not skew the headline or delta.
- **Replacing the headline with a total:** Pass `.value=${totalValue}` to display an overall total as the headline while keeping the sparkline and period-over-period delta from the 2-field query.
- **Sort by the time field:** Always sort the query by the time dimension (`sorts: ['orders.created_month desc']`), because sorting by a measure with a row limit can drop recent periods.

```html
<app-kpi
  label="Monthly Revenue"
  format="usd"
  sparkline
  .query=${{
    fields: ['orders.created_month', 'order_items.total_revenue'],
    sorts: ['orders.created_month desc'],
    filters: this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true }),
    limit: '12'
  }}>
</app-kpi>
```

## Layout

The strip lives in `.da-kpi-grid` (auto-fitting `minmax(min(210px, 100%), 1fr)` columns).
That is a convenience, not a requirement — any CSS Grid or Flex container works,
and `<app-kpi bare>` drops the card chrome if you are supplying your own.

Keep `overflow` visible (do not use `hidden`, `clip`, `auto`, or `scroll`) on a custom wrapper around a sparkline `<app-kpi>`. The sparkline tooltip opens below the card, so a clipping wrapper cuts it off.
