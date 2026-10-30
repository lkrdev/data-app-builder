# Responsive Layout (the default)

**Use when:** almost always. A Data App renders into Light DOM, so its layout is
ordinary CSS. Let the browser place things: the app adapts to any width on its
own, tiles grow with their content instead of clipping, and it composes with
tabs, drawers, sidebars and anything else the design needs.

Opt into the coordinate grid (`grid-layout.md`) only when tiles must hold fixed
positions.

## The shape

A vertical stack of sections. Each section decides its own columns.

```html
<div class="da-container">

  <header class="da-header">
    <h1 style="margin: 0; font-size: 22px; font-weight: 800;">Coverage Overview</h1>
  </header>

  <!-- KPI strip — fits as many ~210px columns as there is room for -->
  <section class="da-kpi-grid">
    <app-kpi label="Coverage"  query-field="cov.pct"   format="percent1"
      .filters=${this.getEffectiveFilters()}></app-kpi>
    <app-kpi label="Files"     query-field="cov.files" format="int"
      .filters=${this.getEffectiveFilters()}></app-kpi>
    <app-kpi label="Uncovered" query-field="cov.gaps"  format="int"
      .filters=${this.getEffectiveFilters()}></app-kpi>
  </section>

  <!-- two charts side by side; stacks to one column when narrow -->
  <section class="da-grid-2">
    <app-chart title="Coverage Trend" type="areaspline"
      .query=${{ /* … */ }} .filters=${this.getEffectiveFilters()}></app-chart>
    <app-chart title="By Suite" type="donut"
      .query=${{ /* … */ }} .filters=${this.getEffectiveFilters()}></app-chart>
  </section>

  <!-- full-width table -->
  <section>
    <app-grid title="Files"
      .query=${{ /* … */ }} .filters=${this.getEffectiveFilters()}></app-grid>
  </section>
</div>
```

## The shortcut classes

All of these are `auto-fit` grids with a sensible gap. They reflow by
themselves — there are no breakpoints to write.

| Class | Columns |
| :--- | :--- |
| `.da-kpi-grid` | auto-fit `minmax(min(210px, 100%), 1fr)` — KPI strip |
| `.da-grid-1` | `1fr` — full-width row |
| `.da-grid-2` | auto-fit `minmax(min(380px, 100%), 1fr)` |
| `.da-grid-2-1` | `2fr 1fr` — hero + breakdown (stacks under 860px container width) |
| `.da-grid-1-2` | `1fr 2fr` — sidebar + detail (stacks under 860px container width) |

Breakpoints use `@container (max-width: 860px)` on the app's own container width (with an `@supports not` media fallback), so they adapt to the Looker tile's size rather than the viewport.

`auto-fit` means the column count follows the available width: a `.da-grid-3`
is three across on a laptop and one across on a phone, with nothing to
configure.

## Rules that matter

- **Size containers, not widgets.** A chart sizes itself to whatever definite
  height CSS gives it (`flex: 1`, grid stretch, `aspect-ratio` all work), at any
  size: a chart in a 140px box is 140px tall, with no opt-out to write. The
  300px fallback applies only when the container has no definite height at all,
  so a chart in plain block flow still renders. Override that fallback with
  `--app-chart-min-height`. An explicit `height` attribute still works but is
  not needed in a CSS-driven layout. A KPI sizes itself.
- **Set the minimum, not the count.** `minmax(min(380px, 100%), 1fr)` says "never narrower
  than 380px" and lets the browser decide how many fit. Don't write
  `repeat(3, 1fr)` unless you genuinely want exactly three at every width.
- **Wrap in a card only if you want chrome.** Widgets already draw their own
  card. Nesting one inside `.card` doubles the border — use `bare` on the
  widget, or let it stand alone (see `card.md`).
- **Container owns vertical rhythm.** `.da-container` manages vertical spacing via
  `--app-gap` (default 18px), so do not hand-write `gap` or `margin-bottom` on top-level
  sections.
- **Anything CSS can do, you can do.** These classes are shortcuts, not a
  framework. Write your own grid or flex whenever the design calls for it —
  see `custom-design.md`.

## Uneven rows

An odd tile count in an `auto-fit` row leaves the last one stretched across the
remainder. Usually fine. When it isn't, either give that tile its own
full-width section, or set an explicit span on it:

```html
<section class="da-grid-2">
  <app-chart ...></app-chart>
  <app-chart ...></app-chart>
  <!-- the fifth tile spans both columns instead of stretching alone -->
  <app-chart style="grid-column: 1 / -1;" ...></app-chart>
</section>
```

## Fields to swap

- `query-field` / `.query` — the LookML fields for each widget.
- `height`: optional on charts and grids; CSS container sizing is preferred (`height="300px"` is supported when an explicit override is required).
- The `minmax()` minimum if your content needs more room than the default.
