# Funnel & Stage Drop-off

## Use when

Visualizing step-by-step conversion drop-off — checkout steps, signup flow, sales pipeline, or support ticket lifecycles.

## Snippet

```javascript
<app-chart
  type="funnel"
  title="Conversion Funnel"
  height="340px"
  value-format="int"
  cross-filter
  .query=${{
    model: '<MODEL>',
    explore: '<EXPLORE>',
    fields: ['orders.stage_name', 'orders.count'],
    filters: this.getEffectiveFilters(),
    sorts: ['orders.count desc'],
    limit: '10'
  }}>
</app-chart>
```

## Fields to swap

- `<MODEL>` — LookML model name.
- `<EXPLORE>` — LookML explore name.
- `orders.stage_name` — Stage name dimension.
- `orders.count` — Measure determining funnel width at each step.
- `value-format` — `int`, `usd`, or `percent1`.

## Notes

- Data should arrive sorted in funnel order (largest stage first).
- Supports both `type="funnel"` and `type="pyramid"`.
- Add the `cross-filter` attribute (included in the snippet above) to handle stage clicks, deselect, click-to-gray highlighting, and self-exclusion automatically. The runtime exempts the driving funnel from its own cross-filter, so it keeps showing every stage after a click. Sibling widgets pick up the filter through their own `.filters=${this.getEffectiveFilters()}` binding. See `column-with-cross-filter.md` for full details.
