# KPI with Delta Comparison

## Use when

Displaying a headline metric alongside a comparison delta or period-over-period change (e.g. "+12.4% vs prior month").

## Option 1 (Recommended): Automatic Period-over-Period Delta + Sparkline (sparkline)

Add the boolean `sparkline` attribute and a 2-field `[date_dimension, measure]` query filtered to complete periods and sorted by the time field (`sorts: ['orders.created_month desc']`, because sorting by measure with a row limit can drop recent periods). The headline shows the latest period in the series by default, or set `sparkline-agg="sum"` (or `"avg"`) to display the full-period total or average across the sparkline series as the headline without running a second query (only for additive measures like `sum` or `count` where `limit` covers the full filtered window). For non-additive measures (`count_distinct`, ratios, weighted averages), keep `"last"` with a per-period label or pass `.value` from a 1-row measure-only query. The runtime renders an interactive SVG trendline and computes the period-over-period percentage delta from the last two data points:

```javascript
html`
  <app-kpi
    label="Monthly Revenue"
    format="usd"
    sparkline
    subtitle="vs prior month"
    .query=${{
      fields: ['orders.created_month', 'orders.total_revenue'],
      sorts: ['orders.created_month desc'],
      filters: this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true }),
      limit: '12'
    }}>
  </app-kpi>
`
```

## Option 2: Manual / Static Delta Badge (change & change-type)

Supply a manual string via `change` when displaying a static figure, hardcoded target, or a figure computed through custom app logic:

```javascript
html`
  <app-kpi
    label="Quarterly Revenue"
    format="usd"
    change="+12.4%"
    change-type="positive"
    subtitle="vs prior period"
    .query=${{
      model: this.model,
      view: this.explore,
      fields: ['orders.total_revenue'],
      filters: this.getEffectiveFilters(),
      limit: '1'
    }}>
  </app-kpi>
`
```

## Delta tone & styling

`change` is the badge text; `polarity` and `change-type` control its colour.

- `polarity="higher-better"` (default): a leading `+` renders green (`positive`) and a leading `-` renders red (`negative`).
- `polarity="lower-better"`: flips the computed or sign-inferred delta tone for cost, latency, or churn metrics so a decrease (`-8.0%`) renders green (`positive`) and an increase (`+8.0%`) renders red (`negative`).
- `change-type="positive"`: fixed green delta indicator.
- `change-type="negative"`: fixed red alert indicator.
- `change-type="neutral"` (or any `change` not starting with `+`/`-`): the badge renders in the default footer text colour — there is no dedicated neutral tone, only `positive` (green) and `negative` (red).

`subtitle` renders the qualifier on its own dedicated muted line below the headline value without parentheses. Keep `label` short (1 to 3 words, max ~20 chars) and `subtitle` concise (2 to 4 words, max ~25 chars, e.g. `vs prior month`).
