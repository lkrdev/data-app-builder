# Column Chart with Conditional Formatting (Zones)

## Use when

Coloring column/bar bars dynamically based on a goal or threshold (e.g. green when coverage ≥ 80%, amber when 60–80%, red when < 60%).

## Snippet

```javascript
html`
  <app-chart
    type="column"
    title="Fulfillment Rate by Category"
    .query=${{
      model: this.model,
      view: this.explore,
      fields: ['orders.category', 'orders.fulfillment_rate'],
      filters: this.getEffectiveFilters(),
      sorts: ['orders.fulfillment_rate desc'],
      limit: '15'
    }}
    value-format="percent1"
    .options=${{
      yAxis: {
        plotLines: [{
          value: 0.80,
          color: '#10b981',
          dashStyle: 'Dash',
          width: 1.5,
          label: { text: '80% Goal', style: { color: '#059669', fontSize: '11px' } }
        }]
      },
      plotOptions: {
        column: {
          zones: [
            { value: 0.60, color: '#ef4444' }, // Red below 60%
            { value: 0.80, color: '#f59e0b' }, // Amber 60-80%
            { color: '#10b981' }               // Green above 80%
          ]
        }
      }
    }}>
  </app-chart>
`
```

## Fields to swap

- `fields`: `['<CATEGORY_DIMENSION>', '<MEASURE>']`
- `zones`: Array of `{ value, color }` threshold cutoffs.
- `plotLines`: Target baseline line displayed on the chart.
