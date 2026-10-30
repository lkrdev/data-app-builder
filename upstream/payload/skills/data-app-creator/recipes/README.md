# Lit Component Recipes

One short reference per visualization pattern for authoring Looker Data Apps in Lit (`app.js`).

Each recipe provides:
- A one-line "use when" guide.
- A canonical Lit snippet using `<app-chart>`, `<app-grid>`, or `<app-kpi>`.
- A "fields to swap" checklist of LookML field names and query parameters.

## Available Recipes

| File | Component & Pattern | Use When |
| :--- | :--- | :--- |
| `responsive-layout.md` | **The default layout** — flex / CSS grid with `auto-fit`, plus the `.da-*` shortcut classes | Almost always. Adapts to any width on its own, tiles grow with their content, composes with tabs and drawers. |
| `grid-layout.md` | Coordinate grid (opt-in) — one `.da-grid da-grid-square`, each tile placed by `cell="x y w h"` | A flat BI dashboard whose tiles must hold fixed positions. |
| `custom-layout.md` | Free-form / absolute layout (explicit opt-in) | Bespoke posters, absolutely-positioned canvases, overlapping elements. |
| `custom-design.md` | Fully custom styling (`bare` + your own CSS) | Brand palettes, reference images, hero panels — any design the default card grid doesn't fit; and keeping a computed value inside a widget so it stays a grid tile. |
| `card.md` | Card composition | When widgets already are cards, and when to group them in `.da-section-card`. |
| `kpi-strip.md` | `<app-kpi>` Strip & Sparklines | Top-of-dashboard summary numbers with optional `<app-kpi sparkline>` trendlines and automatic deltas. |
| `kpi-responsive.md` | `<app-kpi>` with Slicing | Decimal ratios (`0.0–1.0`) and reactive filter reactivity. |
| `kpi-with-delta.md` | `<app-kpi>` with Trend & Sparkline | Headline metric with `<app-kpi sparkline>` auto-calculated delta or manual change indicator (`change="+12%"`). |
| `sparkline-grid.md` | Sparkline Trend Grid (`<app-kpi sparkline>` or custom card) | High-density metric trend cards using built-in `<app-kpi sparkline>` or `<app-chart bare>`. |
| `line-trend.md` | `<app-chart type="areaspline">` | Continuous metric trends over date dimensions. |
| `small-multiples.md` | Small Multiples Grid (`<app-chart>` grid) | Comparing metric trajectories across categories by curve shape and volume using a uniform Y-axis scale. |
| `multi-series-and-stacked.md` | Multi-Line & Stacked Area | Multi-metric comparisons, stacked area (`normal`/`percent`), and 2-dim pivoted trends. |
| `dual-axis.md` | Dual-Axis Trend (Incompatible Magnitudes) | Comparing two metrics of vastly different magnitudes (e.g. conversions vs spend) on the same timeline without compressing the smaller scale to zero. |
| `stacked-bar.md` | `<app-chart type="column">` | Multi-measure stacked or grouped comparisons. |
| `column-with-cross-filter.md` | `<app-chart>` with Click Filter | Interactive column chart driving reactive state. |
| `column-conditional-format.md` | `<app-chart>` with Threshold Zones | Conditional formatting by performance cutoff bands. |
| `donut-with-constraint.md` | `<app-chart type="donut">` | Ratio and breakdown donuts. |
| `gauge.md` | `<app-chart type="solidgauge">` | Progress dial against performance targets. |
| `funnel.md` | `<app-chart type="funnel">` | Stage-by-stage pipeline or conversion drop-off. |
| `treemap.md` | `<app-chart type="treemap">` | Relative-size view across category hierarchies. |
| `grid-card-list.md` | `<app-grid>` | High-performance AG Grid table for detailed records. |
| `grid-heatmap.md` | `<app-grid>` Category × Bucket Heatmap | Heatmap with paired values and row-max alpha opacity. |
| `filter-dropdown.md` | Reactive Slicing Dropdown | Native select dropdown bound to Lit state properties. |
| `metric-switcher.md` | Reactive Metric Switcher (`<app-select>` + `<app-chart>`) | Swapping the queried measure on a single chart card dynamically via dropdown selection. |
| `multi-metric-array-views.md` | Multi-Array Explore Best Practices | Preventing Cartesian SQL fan-outs across UNNEST views. |
| `dark-theme.md` | Dark Theme & Theme Switching | Dark dashboards, theme tokens, and interactive light/dark mode toggles via `this.isDark` / `this.toggleDarkMode()`. |
