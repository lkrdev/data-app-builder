# Card & Container Layout — Lit Data Apps

## Use when

Placing titled content (a chart, grid, or KPI) on the app.

**There is no card class to add.** `<app-chart>`, `<app-grid>`,
and `<app-kpi>` each render their own card — border, radius, background,
padding, shadow — so a bare widget is already a finished card. Wrapping one in
another styled `<div>` is what produces a double border.

You only reach for a container when grouping *several* widgets under one
heading: use `.da-section-card` with `.da-section-header` (inner widgets drop
their border and shadow automatically and keep their padding, so do not add
`bare`). To supply your own card design instead, put
`bare` on the widget and style your own wrapper — see `custom-design.md`.

## Canonical Lit Snippet

```javascript
html`
  <app-chart
    title="<TITLE>"
    type="column"
    looker-model="<MODEL>"
    explore="<EXPLORE>"
    .query=${{
      fields: ['<VIEW>.<DIMENSION>', '<VIEW>.<MEASURE>'],
      filters: this.getEffectiveFilters(),
      sorts: ['<VIEW>.<DIMENSION> asc'],
      limit: '500'
    }}>
  </app-chart>
`
```

## Fields to swap

- `<TITLE>` — Chart card header title.
- `<MODEL>` / `<EXPLORE>` — LookML model and explore.
- `<VIEW>.<DIMENSION>` / `<VIEW>.<MEASURE>` — Real LookML fields discovered via explore-model.py.

## Styling & Theming

Card surfaces are already self-contained, and theme seamlessly with the standard `--app-*` CSS custom properties. Assign your colours into these tokens (any `--brand-*` values route into them) on the app root so every component picks them up; chart `color=` references the role tokens (e.g. `var(--app-chart-3)`, `var(--app-chart-4)` below). See SKILL.md step 5.

```css
.da-container, my-data-app {   /* the app root — not a child wrapper */
  --app-card-bg: #ffffff;
  --app-border: #dadce0;
  --app-radius: 16px;
  --app-shadow: none;
}
```

## Variants

- **Compound Section Card (Bundling 2+ Related Charts):**
  ```javascript
  html`
    <div class="da-section-card">
      <div class="da-section-header">
        <h3>Multi-Facet Comparison</h3>
        <p>Comparing function vs branch decision coverage characteristics across suites</p>
      </div>
      <div class="da-grid-2">
        <app-chart
          title="Function Coverage"
          type="column"
          color="var(--app-chart-3)"
          looker-model="<MODEL>"
          explore="<EXPLORE>"
          value-format="percent1"
          .query=${{
            fields: ['<VIEW>.<CATEGORY>', '<VIEW>.<MEASURE_1>'],
            filters: this.getEffectiveFilters(),
            sorts: ['<VIEW>.<MEASURE_1> desc'],
            limit: '10'
          }}>
        </app-chart>
        <app-chart
          title="Branch Coverage"
          type="column"
          color="var(--app-chart-4)"
          looker-model="<MODEL>"
          explore="<EXPLORE>"
          value-format="percent1"
          .query=${{
            fields: ['<VIEW>.<CATEGORY>', '<VIEW>.<MEASURE_2>'],
            filters: this.getEffectiveFilters(),
            sorts: ['<VIEW>.<MEASURE_2> desc'],
            limit: '10'
          }}>
        </app-chart>
      </div>
    </div>
  `
  ```

- **Ranked Top-N Chart (`query.limit` + `query.sorts`):**
  ```javascript
  html`
    <app-chart
      title="Top 10 Categories by Revenue"
      type="column"
      looker-model="<MODEL>"
      explore="<EXPLORE>"
      .query=${{
        fields: ['<VIEW>.<CATEGORY>', '<VIEW>.<MEASURE>'],
        sorts: ['<VIEW>.<MEASURE> desc'],
        limit: '10'
      }}>
    </app-chart>
  `
  ```

- **Freeform Pixel-Positioned Card (Tableau / Infographic Style):**
  ```javascript
  html`
    <!-- Positioning box only. A class ending in "-card" would trip the runtime's
         [class$="-card"] neutralizer and strip the chart's own chrome, so name it
         anything else and let the (non-bare) chart draw its own card inside. -->
    <div class="pos-frame" style="position: absolute; left: 85px; top: 335px; width: 820px; height: 535px;">
      <app-chart
        title="Revenue Overview"
        type="areaspline"
        looker-model="<MODEL>"
        explore="<EXPLORE>"
        .query=${{
          fields: ['<VIEW>.<DATE>', '<VIEW>.<MEASURE>'],
          sorts: ['<VIEW>.<DATE> asc'],
          limit: '500'
        }}>
      </app-chart>
    </div>
  `
  ```
