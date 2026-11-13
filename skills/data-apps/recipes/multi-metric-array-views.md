# Multi-Metric Array Views (Avoiding Fan-Out Timeouts)

## Problem

When an Explore joins multiple array views (UNNESTed array fields, such as order items, fulfillment events, or refunds), combining measures from two or more array views into a **single query** triggers a SQL Cartesian product fan-out. The query will run until it hits a Looker API timeout (**HTTP 504 / 502**).

## Solution

Do **not** combine measures from separate array views inside the same `.query.fields` array. Instead, split the metrics into **separate independent widgets** inside the Lit template. Both widgets bind to `this.getEffectiveFilters()`, so they update in parallel when filters change.

### Recommended Pattern: Side-by-Side Chart Grid

```javascript
html`
  <div class="da-grid-2">
    <!-- Card 1: Items Array View Measure -->
    <app-chart
      type="column"
      title="Gross Sales by Category"
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.category', 'order_items.total_gross_revenue'],
        filters: this.getEffectiveFilters(),
        sorts: ['order_items.total_gross_revenue desc'],
        limit: '15'
      }}
      value-format="usd">
    </app-chart>

    <!-- Card 2: Refunds Array View Measure -->
    <app-chart
      type="column"
      title="Refund Amount by Category"
      .query=${{
        model: this.model,
        view: this.explore,
        fields: ['orders.category', 'order_refunds.total_refund_amount'],
        filters: this.getEffectiveFilters(),
        sorts: ['order_refunds.total_refund_amount desc'],
        limit: '15'
      }}
      value-format="usd">
    </app-chart>
  </div>
`
```

### Alternative Pattern: Composite Single-Chart Multi-Series (via `this.mergeQueries()`)

If both metrics must render as grouped/paired series on the **same single chart**, fetch them in parallel and join them using `this.mergeQueries()`:

```javascript
export class MultiMetricApp extends DataApp {
  static properties = {
    mergedData: { type: Array },
  };

  async firstUpdated() {
    this.loadData();
  }

  async loadData() {
    this.mergedData = await this.mergeQueries({
      gross: {
        explore: 'orders',
        fields: ['orders.category', 'order_items.total_gross_revenue'],
        filters: this.getEffectiveFilters(),
      },
      refunds: {
        explore: 'orders',
        fields: ['orders.category', 'order_refunds.total_refund_amount'],
        filters: this.getEffectiveFilters(),
      },
      on: 'orders.category',
    });
    this.requestUpdate();
  }

  render() {
    return html`
      <app-chart
        title="Gross Sales vs Refunds"
        type="column"
        value-format="usd"
        .data=${this.mergedData || []}>
      </app-chart>
    `;
  }
}
```

## Key Rules

1. **One Array View per Widget Query**: Keep measures from different UNNEST views isolated in their own query definitions.
2. **Use `this.mergeQueries()` for Multi-Series**: When combining multi-array measures into one chart, join them using `this.mergeQueries({ on: 'join_field', ... })` and pass `.data=${rows}`.
3. **Synchronized Filters**: Both charts bind to `this.getEffectiveFilters()`, updating reactively without Cartesian fan-outs.
