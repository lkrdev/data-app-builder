# Stacked / Grouped Column Chart

## Use when

Comparing two or more measures over a category dimension (e.g. Tracked vs Covered lines by test suite, or Revenue vs Cost by month).

## Snippet

```javascript
html`
  <app-chart
    type="column"
    title="Revenue vs Cost by Category"
    cross-filter
    .query=${{
      model: this.model,
      view: this.explore,
      fields: [
        'orders.category',
        'orders.net_margin',
        'orders.total_cost'
      ],
      filters: this.getEffectiveFilters(),
      sorts: ['orders.net_margin desc'],
      limit: '15'
    }}
    value-format="usd"
    .options=${{
      plotOptions: {
        column: {
          stacking: 'normal',
          borderWidth: 0
        }
      }
    }}>
  </app-chart>
`
```

## Variants

- **Grouped (side-by-side):** Remove `stacking: 'normal'`.
- **100% Percent Composition:** Set `stacking: 'percent'`.
- **Horizontal Stacked Bar:** Set `type="bar"` instead of `type="column"`.
