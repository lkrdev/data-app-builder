# Metric Switcher (Dynamic Measure Selection)

## Use when

Allowing users to switch which metric a chart queries from an `<app-select>` dropdown. This lets a single chart tile display multiple related metrics without duplicating tiles.

## Canonical Lit Snippet

```javascript
// 1. Declare state property and initial metric:
static properties = {
  selectedMetric: { type: String },
};

constructor() {
  super();
  this.selectedMetric = 'orders.total_revenue';
}

render() {
  const metricOptions = [
    { label: 'Gross Revenue', value: 'orders.total_revenue' },
    { label: 'Total Orders', value: 'orders.count' },
    { label: 'Average Order Value', value: 'orders.average_order_value' }
  ];

  const metricFormats = {
    'orders.total_revenue': 'usd',
    'orders.count': 'int',
    'orders.average_order_value': 'usd'
  };

  const selectedOption = metricOptions.find(o => o.value === this.selectedMetric);
  const currentLabel = selectedOption ? selectedOption.label : 'Metric';
  const currentFormat = metricFormats[this.selectedMetric] || 'decimal1';

  return html`
    <div class="da-section-card" style="padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--app-title, var(--app-text));">
          ${currentLabel} Trend
        </h3>
        <app-select
          label="Metric"
          .value=${this.selectedMetric}
          .options=${metricOptions}
          @change=${(e) => { this.selectedMetric = e.detail.value; }}>
        </app-select>
      </div>

      <app-chart
        bare
        type="areaspline"
        height="280px"
        explore="orders"
        value-format=${currentFormat}
        color="var(--app-primary)"
        .query=${{
          fields: [
            'orders.created_month',
            this.selectedMetric
          ],
          filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
          sorts: ['orders.created_month asc'],
          limit: '24'
        }}
        .options=${{
          chart: {
            spacing: [10, 15, 10, 10]
          },
          legend: {
            enabled: false
          }
        }}>
      </app-chart>
    </div>
  `;
}
```

## Fields to swap

- `selectedMetric`: Reactive property initialized to your default LookML measure.
- `metricOptions`: Array of `{ label, value }` objects with human-readable labels and LookML measure field names.
- `metricFormats`: Map of LookML field names to format tokens (`usd`, `int`, `percent1`, `decimal1`).
- `explore`: LookML explore name.
- `fields`: One dimension followed by `this.selectedMetric`.
- `sorts`: Sort directive for the dimension (`'<VIEW>.<DIMENSION> asc'`).

## Rules that matter

- **An explicit `height` is deliberate here.** This visual is a fixed-height card with an embedded control header, not a tile that should grow with its container. Setting `height` causes `AppChart.render()` to emit an inline `min-height: 0`, opting the chart out of the 300px collapsed-container fallback. Without an explicit height, the chart would be floored at 300px.
- **Read `e.detail.value` in `<app-select>` change handlers.** The `<app-select>` component cancels native change event bubbling and emits a custom event containing `detail.value`. Do not write `e.target.value` fallbacks.
- **Never write an `updated()` query loop.** Setting `this.selectedMetric` causes Lit to re-render the template. `<app-chart>` inspects `.query` automatically and executes a new query when `fields` changes.
- **Pass `{ label, value }` objects to `<app-select>`.** Objects provide friendly user-facing labels in the dropdown while keeping LookML field identifiers in the value property.
- **Update format dynamically.** Pair the selected metric with a format mapping so currency, integer, and ratio metrics display appropriate units on chart axes and tooltips.
- **Use `chart.spacing`, never `chart.margin`.** Set spacing in `.options` to prevent Highcharts from clipping axis labels.
