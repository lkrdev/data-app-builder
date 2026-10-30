# Dual-Axis Trend (Incompatible Magnitudes)

## Use when

Comparing two metrics of vastly different magnitudes (e.g. 12.4K conversions against $142K spend) on the same timeline. Co-plotting them on a single axis compresses the smaller measure into a flat line at zero.

## Canonical Lit Snippet

```javascript
html`
  <app-chart
    title="Spend vs Conversions Over Time"
    type="areaspline"
    explore="ad_events"
    .query=${{
      fields: [
        'ad_events.event_date',
        'ad_events.total_spend',
        'ad_events.conversion_count'
      ],
      filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
      sorts: ['ad_events.event_date asc'],
      limit: '500'
    }}
    .options=${{
      yAxis: [
        {
          title: { text: 'Spend ($)' },
          labels: { format: '${value:,.0f}' }
        },
        {
          title: { text: 'Conversions' },
          labels: { format: '{value:,.0f}' },
          opposite: true
        }
      ],
      series: [
        { yAxis: 0 },
        { yAxis: 1 }
      ]
    }}>
  </app-chart>
`
```

## Fields to swap

- `title`: Chart card header title.
- `explore`: LookML explore name.
- `fields`: Exactly one time dimension followed by the two distinct measures:
  - First measure (`fields[1]`): Assigned to primary axis (`yAxis: 0`, left).
  - Second measure (`fields[2]`): Assigned to secondary axis (`yAxis: 1`, right / `opposite: true`).
- `yAxis[0].title.text` / `yAxis[1].title.text`: Custom axis labels describing the units.
- `yAxis[0].labels.format` / `yAxis[1].labels.format`: Highcharts label format strings matching the metric units.

## Rules that matter

- **Never co-plot incompatible magnitudes on a single axis.** Disparate scales compress the smaller series into a flat line at zero, hiding trends and variance.
- **Use dual axes or separate charts.** When the correlation between two disparate measures matters, assign each measure its own axis (`yAxis: 0` left, `yAxis: 1` right with `opposite: true`). If correlation does not matter, split them into two separate stacked charts.
- **`series` in `.options` maps by index.** In `<app-chart>`, providing `.options=${{ series: [{ yAxis: 0 }, { yAxis: 1 }] }}` merges each config object onto the corresponding query measure series without wiping out fetched data.
