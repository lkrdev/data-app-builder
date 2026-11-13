# Progress Dial & Rating Gauge (solidgauge)

## Use when

Visualizing a single progress percentage, score against SLA target, or health score where a circular arc dial is more intuitive and visually engaging than a plain number card.

## Snippet

```javascript
<app-chart
  type="solidgauge"
  title="SLA Compliance Rate"
  height="260px"
  value-format="percent1"
  .query=${{
    model: '<MODEL>',
    explore: '<EXPLORE>',
    fields: ['<EXPLORE>.<PERCENTAGE_MEASURE>'],
    filters: this.getEffectiveFilters(),
    limit: '1'
  }}>
</app-chart>
```

## Fields to swap

- `<MODEL>` — LookML model name.
- `<EXPLORE>` — LookML explore name.
- `<EXPLORE>.<PERCENTAGE_MEASURE>` — Measure returning the percentage ratio (e.g. `0.85` for 85%).
- `value-format` — `percent1` for decimal ratios `0.0–1.0` (auto scales to `0–100%`), or `int` for raw scores. Non-`percent1` formats assume a **0–100** arc; for another scale set the max via `.options=${{ yAxis: { max: N } }}`.

## Notes

- The runtime automatically configures the semi-circular arc pane, needle-less solid fill, and colored stops — **red at low values → yellow → green at high**, the default `higher-better` polarity. Add `polarity="lower-better"` to flip it (e.g. for error/latency rates).
- Supports both `type="solidgauge"` and `type="gauge"`.
