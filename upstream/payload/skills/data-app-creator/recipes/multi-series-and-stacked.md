# Multi-Series Lines & Stacked Area Charts

## Use when

Visualizing multiple metric trajectories on the same timeline, or displaying category breakdowns over time using multi-line, stacked area (`stacking: 'normal'`), or 100% proportional area (`stacking: 'percent'`) charts.

---

## Pattern 1: Multi-Measure Multi-Line / Area (1 Dimension + N Measures)

Use when comparing distinct metrics (e.g. Gross Revenue vs Net Margin):

```javascript
html`
  <app-chart
    title="Gross Revenue vs Net Margin Over Time"
    type="areaspline"
    explore="orders"
    value-format="usd"
    .query=${{
      fields: [
        'orders.created_date',
        'orders.gross_revenue',
        'orders.net_margin'
      ],
      filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
      sorts: ['orders.created_date asc'],
      limit: '500'
    }}
    .options=${{
      plotOptions: {
        areaspline: {
          fillOpacity: 0.15
        }
      }
    }}>
  </app-chart>
`
```

---

## Pattern 2: Stacked Area Chart (`stacking: 'normal'`)

Use when multiple measures sum up to a meaningful total (e.g. desktop vs mobile traffic, or organic + paid search revenue):

```javascript
html`
  <app-chart
    title="Revenue Composition by Channel"
    type="areaspline"
    explore="order_items"
    value-format="usd"
    .query=${{
      fields: [
        'order_items.created_date',
        'order_items.organic_revenue',
        'order_items.paid_search_revenue',
        'order_items.email_revenue'
      ],
      filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
      sorts: ['order_items.created_date asc'],
      limit: '500'
    }}
    .options=${{
      plotOptions: {
        areaspline: {
          stacking: 'normal',
          fillOpacity: 0.6
        }
      }
    }}>
  </app-chart>
`
```

---

## Pattern 3: Category-Pivoted Multi-Line Trend (2 Dimensions + 1 Measure)

Use when breaking down a single measure across discrete categories over time (e.g. revenue trajectory by product category). When the second dimension is a string, `<app-chart>` automatically pivots it into distinct series with separate colors and legend without needing `pivot-by`:

```javascript
html`
  <app-chart
    title="Revenue Trend by Category"
    type="line"
    explore="orders"
    value-format="usd"
    .query=${{
      fields: [
        'orders.created_date',
        'orders.category',
        'orders.total_revenue'
      ],
      filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
      sorts: ['orders.created_date asc'],
      limit: '1000'
    }}>
  </app-chart>
`
```

A string second dimension auto-pivots without `pivot-by`. Pass `pivot-by` (or `.query.pivots`) only when the second dimension is numeric and X values may not repeat (such as a year), or when choosing which dimension is the series pivot:

```javascript
html`
  <app-chart
    title="Flights by Origin and Year"
    type="column"
    explore="flights"
    dimensions="flights.origin, flights.dep_year"
    measures="flights.count"
    pivot-by="flights.dep_year"
    .filters=${this.getEffectiveFilters()}>
  </app-chart>
`
```

---

## Pattern 4: Multi-Measure Grouped Columns (1 Category Dimension + N Measures)

Use when comparing multiple metrics side-by-side across discrete categories (e.g. Budget vs Actual spend by department). `<app-chart>` automatically renders side-by-side grouped columns with legend and distinct series colors:

> [!WARNING]
> **Only combine measures that live on the same view.** If the metrics you want
> come from different joined or UNNESTed array views, putting them in one
> `fields` list is the fan-out trap in SKILL.md gotcha #3 — it cross-joins and
> the query dies with an HTTP 502/504. In that case run one query per view and
> merge the rows yourself into `.data=` (see SKILL.md gotcha #3).

```javascript
html`
  <app-chart
    title="Budget vs Actual by Department"
    type="column"
    explore="spend"
    value-format="usd"
    .query=${{
      fields: [
        'spend.department',
        'spend.budget_amount',
        'spend.actual_amount'
      ],
      filters: this.getEffectiveFilters(),
      sorts: ['spend.actual_amount desc'],
      limit: '15'
    }}
    .options=${{
      plotOptions: {
        column: {
          borderRadius: 4,
          groupPadding: 0.15,
          pointPadding: 0.05
        }
      }
    }}>
  </app-chart>
`
```

---

## Key Rules & Options

- **Multi-Measure Columns:** Passing 1 category dimension and N measures to `type="column"` renders side-by-side grouped bars for each category.
- **Stacking Variants:** Set `plotOptions.areaspline.stacking` or `plotOptions.column.stacking` to `'normal'` (absolute sum) or `'percent'` (100% share breakdown).
- **Auto-Pivot:** Passing `[Date, Category, Measure]` with a string second dimension automatically creates separate series for each category with zero manual matrix manipulation. Pass `pivot-by="<DIM>"` on `<app-chart>` (or `pivots: ['<DIM>']` in `.query`) only when the second dimension is numeric and X values may not repeat (such as a year), or when choosing which dimension is the series pivot.
- **Always Sort by Date Ascending for Time Series:** Always include `sorts: ['<DATE_FIELD> asc']` so lines draw left-to-right chronologically.
