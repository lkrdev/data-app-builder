# Sparkline Trend Grid (High-Density Metric Trends)

## Use when

Displaying high-density metric trend lines across key performance indicators or categories in a compact space. Sparklines show trajectory and volatility at a glance by removing all axes, grid lines, and chart chrome.

## Option 1 (Recommended): Built-in <app-kpi sparkline> Cards

Use `<app-kpi sparkline>` in `.da-kpi-grid` for high-density metric trend cards. Each card shows the latest period as the headline by default, or set `sparkline-agg="sum"` (or `"avg"`) to aggregate the sparkline series into the headline total or average without running a second query (pass `.value` to replace it with a custom total). It renders an interactive inline SVG sparkline and computes the period-over-period delta badge from a 2-field query filtered to complete periods and sorted by the time field (`sorts: ['orders.created_month desc']` so a row limit does not drop recent periods):

```javascript
html`
  <div class="da-kpi-grid">
    <app-kpi
      label="Monthly Revenue"
      format="usd"
      sparkline
      .query=${{
        fields: ['orders.created_month', 'orders.total_revenue'],
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
        fields: ['orders.created_month', 'orders.count'],
        sorts: ['orders.created_month desc'],
        filters: this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true }),
        limit: '12'
      }}>
    </app-kpi>
    <app-kpi
      label="Monthly Active Customers"
      format="int"
      sparkline
      .query=${{
        fields: ['orders.created_month', 'users.count'],
        sorts: ['orders.created_month desc'],
        filters: this.getEffectiveFilters({ 'orders.created_month': '12 months ago for 12 months' }, { isTimeSeries: true }),
        limit: '12'
      }}>
    </app-kpi>
  </div>
`
```

## Option 2: Custom Section Card (<app-kpi bare> + <app-chart bare>)

When you need custom styling, secondary metrics, or complex chart interactions that go beyond an inline sparkline, combine `<app-kpi bare>` with `<app-chart bare>` inside `.da-section-card`:

```javascript
const SPARKLINE_OPTIONS = {
  chart: { spacing: [4, 0, 4, 0] },
  legend: { enabled: false },
  xAxis: { visible: false },
  yAxis: { visible: false },
  plotOptions: { areaspline: { fillOpacity: 0.1, lineWidth: 2, marker: { enabled: false } } }
};

html`
  <div class="da-grid-3">
    <div class="da-section-card">
      <div style="font-size: 12px; font-weight: 600; color: var(--app-muted); margin-bottom: 8px;">Revenue Trend</div>
      <app-kpi bare explore="orders" query-field="orders.total_revenue" format="usd"
        .filters=${this.getEffectiveFilters()}></app-kpi>
      <app-chart bare type="areaspline" height="60px" color="var(--app-primary)" explore="orders" value-format="usd"
        .query=${{
          fields: ['orders.created_date', 'orders.total_revenue'],
          filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
          sorts: ['orders.created_date asc'],
          limit: '30'
        }}
        .options=${SPARKLINE_OPTIONS}></app-chart>
    </div>
    <div class="da-section-card">
      <div style="font-size: 12px; font-weight: 600; color: var(--app-muted); margin-bottom: 8px;">Order Volume</div>
      <app-kpi bare explore="orders" query-field="orders.count" format="int"
        .filters=${this.getEffectiveFilters()}></app-kpi>
      <app-chart bare type="areaspline" height="60px" color="var(--app-primary)" explore="orders" value-format="int"
        .query=${{
          fields: ['orders.created_date', 'orders.count'],
          filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
          sorts: ['orders.created_date asc'],
          limit: '30'
        }}
        .options=${SPARKLINE_OPTIONS}></app-chart>
    </div>
    <div class="da-section-card">
      <div style="font-size: 12px; font-weight: 600; color: var(--app-muted); margin-bottom: 8px;">Active Customers</div>
      <app-kpi bare explore="orders" query-field="users.count" format="int"
        .filters=${this.getEffectiveFilters()}></app-kpi>
      <app-chart bare type="areaspline" height="60px" color="var(--app-primary)" explore="orders" value-format="int"
        .query=${{
          fields: ['orders.created_date', 'users.count'],
          filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
          sorts: ['orders.created_date asc'],
          limit: '30'
        }}
        .options=${SPARKLINE_OPTIONS}></app-chart>
    </div>
  </div>
`
```

## Fields to swap

- `label`, measure and `format`: one card per metric, written out (see the rule below).
- `explore`: LookML explore name.
- `fields`: Date dimension followed by the metric measure.
- `format` / `value-format`: Number format vocabulary (`usd`, `int`, `percent1`).
- `height`: Compact height on `<app-chart>` (for example, `'60px'`).
- `color`: Line stroke color token (`var(--app-primary)`).

## Rules that matter

- **Write each metric as its own widget, not a `.map()` over a metric list.** Publishing registers each widget's query from the source so Looker can offer "Explore from here" and drilling. A loop whose copies query different fields can't be registered (its fields only exist when the app runs), so those widgets get no widget actions.
- **An explicit `height` is deliberate here.** This visual is a compact sparkline, not a tile that should grow with its container. Setting `height` causes `AppChart.render()` to emit an inline `min-height: 0`, opting the chart out of the 300px collapsed-container fallback. Without an explicit height, a 60px sparkline would be floored at 300px.
- **A sparkline is a stripped trend shape, not a reduced standard chart.** Standard charts require axes, tick marks, and labels to read exact numbers. A sparkline strips all axes (`xAxis.visible: false`, `yAxis.visible: false`, `legend.enabled: false`) so the data line fills the area.
- **Pair with a KPI for exact figures.** The sparkline provides direction, while `<app-kpi bare>` provides the current absolute figure.
- **Use `bare` on both components inside custom cards.** The `bare` attribute removes default widget backgrounds, borders, and shadows so both components sit cleanly inside `.da-section-card`.
- **Use `chart.spacing`, never `chart.margin`.** Set small spacing values (`[4, 0, 4, 0]`) to keep the sparkline from touching container boundaries without triggering Highcharts margin clipping.
