# Treemap

## Use when

Showing relative size across many categories where a bar chart would be too tall — products by revenue, customers by spend, regions by order count. Each rectangle's area is proportional to its value.

## Snippet

```javascript
<app-chart
  type="treemap"
  title="Spend by Product Category"
  height="340px"
  value-format="usd"
  cross-filter
  .query=${{
    model: '<MODEL>',
    explore: '<EXPLORE>',
    fields: ['products.category', 'order_items.total_revenue'],
    filters: this.getEffectiveFilters(),
    sorts: ['order_items.total_revenue desc'],
    limit: '25'
  }}>
</app-chart>
```

## Fields to swap

- `<MODEL>` — LookML model name.
- `<EXPLORE>` — LookML explore name.
- `products.category` — Category dimension determining the labels.
- `order_items.total_revenue` — Numeric measure sizing each rectangle.
- `value-format` — `usd`, `int`, or `percent1`.

## Notes

- The runtime turns the 1-dimension + 1-measure query into `{name, value}` points and applies automatic squarified tiling layout.
- **Tile labels show the category name, not the value.** The measure only *sizes* each rectangle; `value-format` does not print a formatted number on the tiles. To show the value on each tile, add an `.options` `dataLabels.formatter` (import `formatValue` from `/runtime/data-app.js`).
- Add the `cross-filter` attribute (included in the snippet above) to handle rectangle clicks, deselect, click-to-gray highlighting, and self-exclusion automatically. The runtime exempts the driving treemap from its own cross-filter, so it keeps showing every cell after a click. Sibling widgets pick up the filter through their own `.filters=${this.getEffectiveFilters()}` binding. See `column-with-cross-filter.md` for full details.
