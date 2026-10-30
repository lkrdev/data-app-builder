# Small Multiples Grid (Shared-Scale Comparison)

## Use when

Comparing metric trends across several discrete categories (for example, regional revenue trends or department bug counts) side by side. Small multiples let users compare curve shapes and volumes across categories at a glance.

## Canonical Lit Snippet

```javascript
html`
  <style>
    .multiples-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      overflow: hidden;
    }
    .multiples-grid > app-chart {
      border-left: 1px solid var(--app-border);
      border-top: 1px solid var(--app-border);
      margin: -1px 0 0 -1px;
    }
  </style>

  <section class="da-section-card">
    <div class="da-section-header">
      <h3>Monthly Revenue by Category</h3>
      <p>Shared scale: curve height compares volume across categories.</p>
    </div>
    <div class="multiples-grid">
      ${['Electronics', 'Apparel', 'Home', 'Beauty'].map(category => html`
        <app-chart
          title=${category}
          type="areaspline"
          height="240px"
          explore="order_items"
          value-format="usd"
          color="var(--app-primary)"
          y-scale-group="category-trend"
          .query=${{
            fields: [
              'order_items.created_month',
              'order_items.total_revenue'
            ],
            filters: this.getEffectiveFilters(
              { 'products.category': category },
              { isTimeSeries: true }
            ),
            sorts: ['order_items.created_month asc'],
            limit: '24'
          }}
          .options=${{
            chart: {
              spacing: [10, 10, 10, 10]
            },
            legend: {
              enabled: false
            },
            yAxis: {
              min: 0,
              title: {
                text: null
              }
            }
          }}>
        </app-chart>
      `)}
    </div>
  </section>
`
```

## Fields to swap

- `categories`: Array of category strings mapped in the template.
- `title`: Bound to the current category name string.
- `explore`: LookML explore name.
- `fields`: One time dimension followed by one measure.
- `filters`: Route through `this.getEffectiveFilters({ '<VIEW>.<CATEGORY_FIELD>': category }, { isTimeSeries: true })`.
- `sorts`: Sort ascending by the time dimension (`'<VIEW>.<DATE_FIELD> asc'`).
- `y-scale-group`: Shared scale group identifier across related multiples. Omit when category volumes differ by more than ~5x or when the user asks for independent scales.
- `height`: Explicit chart height (for example, `'240px'`).

## Rules that matter

- **An explicit `height` is deliberate here.** This visual is a compact multiple, not a tile that should grow with its container. Setting `height` causes `AppChart.render()` to emit an inline `min-height: 0`, opting the chart out of the 300px collapsed-container fallback. Without an explicit height, each multiple would be floored at 300px. The height covers the chart title and card padding as well as the plot.
- **Share the Y-axis scale when magnitudes are comparable.** Lock `yAxis.min: 0` and set `y-scale-group` when comparing peer categories of similar scale so curve height reflects relative volume. Omit `y-scale-group` (and note `"Independent scale"` in the section subtitle) when categories differ by more than ~5x (for example, `Complete` vs `Pending` or `Cancelled` orders) or when the user asks to compare curve shapes independently, so smaller series do not flatten against zero.
- **Shared scale comes from `y-scale-group`.** Never hardcode `yAxis.max`. Highcharts clips points above a hardcoded max without any error, and the peak changes when filters change.
- **Title the section with `.da-section-header`.** It is inset by the chart card padding, so the section title lines up with the chart titles below it.
- **Do not add `bare` to the charts.** Inside a `.da-section-card` the runtime drops each chart's border and shadow and keeps its padding, so titles and plots stay clear of the header and the column dividers. `bare` would remove the padding too.
- **Synchronize the X-axis time range.** Every tile must query the same date range and sort ascending so columns align chronologically.
- **Strip legends to maximize visual area.** The card title identifies the category. Removing the legend frees vertical space for the trend lines.
- **Use `chart.spacing`, never `chart.margin`.** Spacing adjusts padding inside the SVG without clipping axis labels.
- **Draw dividers with collapsed borders.** Top and left borders with `margin: -1px 0 0 -1px` inside an `overflow: hidden` grid give single 1px lines for any `auto-fit` wrap.
