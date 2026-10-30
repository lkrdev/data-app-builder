# Filter-Responsive KPI Card

In Lit Data Apps, `<app-kpi>` elements are natively reactive. Route `this.getEffectiveFilters()` into their `.query` (as the `filters:` key, as shown below) — or bind the `.filters` property directly — and they re-query automatically whenever filters change.

## Snippet

```javascript
html`
  <app-kpi
    label="Average Order Value"
    format="usd"
    .query=${{
      model: this.model,
      view: this.explore,
      fields: ['order_items.average_sale_price'],
      filters: this.getEffectiveFilters(),
      limit: '1'
    }}>
  </app-kpi>
`
```

## Ratio & Percentage KPI

For 0.0–1.0 ratio measures (e.g. coverage, win rate, churn), specify `format="percent1"`:

```javascript
html`
  <app-kpi
    label="Conversion Rate"
    format="percent1"
    .query=${{
      model: this.model,
      view: this.explore,
      fields: ['orders.conversion_rate'],
      filters: this.getEffectiveFilters(),
      limit: '1'
    }}>
  </app-kpi>
`
```

## Responsive KPI Grid Layout

```javascript
html`
  <div class="da-kpi-grid">
    <app-kpi
      label="Total Revenue"
      format="usd"
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.total_revenue'],
        filters: this.getEffectiveFilters(),
        limit: '1'
      }}>
    </app-kpi>
    <app-kpi
      label="Total Orders"
      format="int"
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.count'],
        filters: this.getEffectiveFilters(),
        limit: '1'
      }}>
    </app-kpi>
  </div>
`
```
