# Changelog

All notable changes to the Looker Data Apps runtime and devtools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**What a version bump means for your apps**

| Bump | What you have to do |
| --- | --- |
| **patch** (`1.0.0` → `1.0.1`) | Nothing. Every app you have published keeps working. |
| **minor** (`1.0.0` → `1.1.0`) | Migrate your apps to the new runtime before you re-publish them. Your agent does this with the `toolkit-updater` skill, which applies the Breaking entries below. |
| **major** (`1.0.0` → `2.0.0`) | Same as a minor, and worth reading the entry in full. |

Upgrading the toolkit never changes a dashboard that is already live: published
apps are pinned to the runtime version they were published against. A migration
matters only for apps you choose to re-publish.

To upgrade an app, apply every **Breaking** entry newer than its `@toolkit-version` tag, from oldest to newest. An app with no `@toolkit-version` tag gets every Breaking entry in this file. An app older than the oldest entry is rewritten with the `data-app-creator` skill, keeping its queries, layout intent, and publish metadata. Legacy HTML Canvas Dashboards (`*.canvasdashboard.html`) use the `data-app-upgrader` skill instead.

## [1.2.0] - 2026-10-22

### Added
- The toolkit now supports Windows (Git Bash with Python 3.9+).
- `<app-chart>` supports `pivot-by` (or `pivots`) to split a measure into one series per pivot value.
- `<app-kpi>` supports `sparkline-agg` (`'sum'`, `'avg'`, `'min'`, `'max'`, or `'last'`) to aggregate the full sparkline series for the headline value instead of showing only the latest row.
- `format="percent-100"` formats percentage fields that are already stored on a `0` to `100` scale instead of `0` to `1`.
- Query filters now accept numbers, booleans, and arrays directly (`2023`, `true`, `['Portland, OR', 'Austin']`) instead of requiring Looker filter strings, and ignore `null` or `undefined` values.
- The preview gallery header now includes a Feedback button and a Grid/List view toggle.

### Changed
- **Breaking — migrate your apps before you re-publish them.** Grid column helpers (`createNumericCol`, `createCurrencyCol`, `createPercentageCol`, `createBadgeCol`) now take a single options object `{ field, headerName, ... }` instead of positional `(headerName, field, options)` arguments.
- **Breaking — migrate your apps before you re-publish them.** `cross-filter` and `selected-value` on `<app-chart>` now apply only to segmented charts (`column`, `bar`, `pie`, `donut`, `treemap`, `funnel`, `pyramid`). They are ignored on `line`, `spline`, `area`, `areaspline`, `scatter`, `gauge`, and `solidgauge`; remove the attribute from those charts, or switch them to a column or bar chart.
- Coordinate grid tiles now have a 12px gap by default so adjacent tiles no longer touch (override with `--da-grid-gutter` on `.da-grid`). KPI cards on the coordinate grid should use `h = 14`, or `h = 20` when the row has a sparkline.
- Treemaps with a single `color` now draw every tile in that color; use `categoryColors` or `options.colors` for per-tile colors.
- Publishing now tracks both the original author (`@created-at`, `@created-by`) and the last updater (`@updated-at`, `@updated-by`) in the `app.js` header, and asks for confirmation before overwriting a dashboard last updated by another user.

### Fixed
- A rendering error in a chart or table now shows an error card with a retry button on that widget instead of crashing the whole app.
- Fixed chart cross-filtering and re-querying across tab switches, reactive filter updates, and treemap redraws.
- Percentage charts now scale their axis to the data (including negative values and values over 100%) and use a consistent scale across each series or table column.
- Improved chart layout for compact donut totals, pyramid labels, single-point line and area series, and KPI sparkline tooltips.
- Install and publish errors now list any missing Looker permissions instead of reporting that Data Apps is disabled.

## [1.1.2] - 2026-10-02

### Changed
- The donut center total uses the same short format as the value axis (`76.95M`), sits in the middle of the hole, is hidden on charts under 250px tall, and leaves out a label that only says "Count".
- The preview gallery shows the Looker icon in the browser tab. Tab titles read "Data Apps Gallery", or "<app name> - Data Apps Gallery" when an app is open.

### Fixed
- Tables keep their scroll position, column widths, and sort when the app redraws often, for example on a timer.
- `<app-chart>` widgets with static data no longer show a false "Highcharts vendor bundle is not available" banner while the vendor files are still downloading.
- `verify-install.py` checks the Data App extension endpoint instead of a developer-only endpoint, so dashboard authors without LookML developer permissions no longer get a false 403 during install verification.

## [1.1.1] - 2026-09-30

### Added
- Exposed all 20 `looker_2026_categorical_1` colors as CSS custom properties (`--app-chart-1` through `--app-chart-20`), along with semantic tokens `--app-chart-up`, `--app-chart-down`, `--app-chart-total`, and `--app-chart-unselected`.

### Changed
- `verify-app` stops after the first headless browser error or timeout instead of running a second pass, and `data-app-creator` instructs agents to fall back to `--no-browser` when headless Chrome hangs or times out.
- `data-app-upgrader` now only converts legacy HTML Canvas Dashboards, straight to the latest runtime. Lit apps upgrade through the Breaking entries in this changelog, which `toolkit-updater` applies from oldest to newest.
- Old releases can be removed from this changelog once they are no longer supported for upgrades.
- The default style now follows Looker UX modern dashboard designs: blue cell focus highlight on tables (`#d9e7fd` fill, `#4285f4` border), vertical transparency gradient on area charts, a 70% donut hole with centered grand total and connector lines, a tapered sequential-blue funnel, and a floating white card tooltip with drop shadow (`#1e293b` in dark mode).
- `<app-kpi>` renders `subtitle` on a dedicated muted 11px line below the headline value without parentheses rather than as an inline parenthetical or separate footer line.
- Scatter charts draw their points with 20% alpha fill and author-overridable markers.
- Cross-filter selection now turns unselected items solid gray (`#dadce0` light, `#374151` dark) instead of dimming them.
- Published tiles load the runtime from `www.gstatic.com`. The Looker tile CSP only allows scripts from `www.gstatic.com`.
- Toolkit installation and update checks use `dl.google.com/looker-data-apps`.

## [1.1.0] - 2026-09-29

### Added
- Every app shows a small built-in stamp at the bottom right with the runtime version and the publish date.
- `<app-kpi>` supports compact sparklines via `sparkline`, `color`, and `polarity` (`'higher-better'` | `'lower-better'`) attributes. Accepts a 2-field query (`[dimension, measure]`) or direct numeric array, auto-detects chronological ordering, renders an SVG trendline with fill area, and auto-calculates period-over-period delta badge.
- `<app-chart>` supports `y-scale-group` to synchronize Y-axis maximum scale across small multiples without clipping or hardcoding `yAxis.max`.
- Declarative cross-filtering via the `cross-filter` attribute on `<app-chart>`. Clicking a series point or slice toggles the field in host `DataApp.crossFilters` (which holds ready-to-use Looker filter expressions), dims unselected points, and excludes the emitting chart from its own filter. Existing `@app-chart-click` wiring keeps working. `verify-app` warns when an app overrides `getEffectiveFilters()` without spreading `this.crossFilters`.
- `<app-grid>` sends `@app-grid-row-click` when a user clicks a row, with `detail: { row, rowIndex, mouseEvent }`.
- `DataApp.renderThemeToggle(options)` helper for rendering the standard `Light` / `Dark` mode switch in `.da-filter-bar` or `.da-header`.
- Dashboard layout and chart readability rules in `data-app-creator`, plus reusable recipes for `dual-axis`, `metric-switcher`, `small-multiples`, and `sparkline-grid`.

### Changed
- Display Looker's human-readable error message on `.da-error-card` instead of raw JSON text.
- An author `plotOptions.*.point.events.click` handler on `<app-chart>` now runs before the runtime click handling. If it returns `false` or calls `e.preventDefault()`, `@app-chart-click` is sent already cancelled and `cross-filter` does nothing. In-place chart updates redraw once, without animation.
- Grid columns without `width` flex to fill the card; `createNumericCol`, `createCurrencyCol`, `createPercentageCol`, and `createBadgeCol` default to flex: 1 with a `minWidth` instead of a fixed `width`. Tables scroll inside their card (`domLayout: 'normal'`, `pagination: false`) by default instead of paging after 10 rows.
- Single-measure column and bar charts use one color (`color`, else `--app-primary`). `categoryColors` or an `options.colors` array still color bars individually.
- Value-axis labels on `<app-chart>` use compact numbers (`100K`, `1.5M`, `$2.5M` with `usd`) and keep category and datetime axes as they are.
- `decimal1`, `decimal2`, and the `percent` formats now add thousands separators, like `int` and `usd`.
- The default style now follows modern Looker dashboards. Cards: white canvas, `#dadce0` borders, 16px radius, no shadow, 12px gap. Text: Looker's font stack, sentence-case labels, 18px widget titles. Tables: 12px text, 26px rows, a tinted header, column lines, and right-aligned numbers. Charts: Looker's palette, no animation, no markers on line and area series, a flat area fill, and a dark tooltip. Modern Looker dashboards omit decorative emojis on headers, tabs, and `<app-kpi>` (`icon`). Authors can still override every default. Apps pinned to an older runtime are unaffected.
- `<app-select>` defaults `placeholder` to `''` (prepending an empty option only when set), labels empty-value options `'any value'`, stacks its label above the dropdown, and highlights active filter selections via `data-active="true"`.
- `<app-kpi>` renders `subtitle` inline in parentheses next to `.kpi-label` rather than as a separate footer line.
- The runtime's AG Grid theme variables now apply in light mode. The vendored Quartz theme loads after `data-app.css` and overrode them, so tables showed stock Quartz styling.
- Scatter charts draw their points. Generic series defaults hid the markers and joined the points with a line.
- `<app-kpi>` lowers the compact container-query breakpoint from `260px` to `200px` so 4-column KPI rows keep the `36px` value size and subtitle.
- Preview workflow automatically starts the background preview server and opens the Data App in a browser tab after verification; `start-preview.py` accepts shorthand app arguments and direct execution.
- `verify-app` checks both the same-origin view and the sandboxed tile view, waits for queries to settle, fails on sandbox load or runtime errors, `<app-kpi>` query errors, or empty charts, merges KPI value and sparkline fields into one dry-run query, and captures full-height screenshots.
- `self-update.sh` and `snapshot-apps.sh` point saved app snapshots in `backups/apps/` at their matching backup runtime and keep any toolkit backup still referenced by a saved app snapshot.
- `data-apps-config.json` uses `toolkit_url` and `browser_assets_url` (replacing `shared_base_url` and `shared_runtime_url`), omits them when they match the default URLs, and migrates the old keys on upgrade.
- The installer and toolkit scripts support Python 3.9+.
- Static `.data` charts and grids no longer render blank in a tile when vendors load after the first render.
- Vertical layout spacing is now managed by `.da-container` via `--app-gap` and `gap: var(--app-gap)`. Margin bottoms on `.da-header`, `.da-filter-bar`, `.da-kpi-grid`, `.da-grid-*`, and `.da-section-card` have been removed to eliminate double-spacing artifacts. Upgrading apps should strip redundant `<style>` rules and inline `style="..."` layout or color overrides on `.da-*` elements so `.da-container` gap and theme tokens govern spacing and colors.
- Widgets inside `.da-section-card` keep their padding and drop only their border and shadow. `.da-section-header` is inset by the same 16px, so the section title lines up with the widget titles.
- `<app-chart>` merges author-supplied `options.series` index-wise onto generated series, allowing overrides (like secondary axes) without wiping query data.
- **Breaking — migrate your apps before you re-publish them.** Runtime CSS cleanup. Web components now own their internal DOM, state, and control skin, and author classes no longer style form elements. `<app-select>` is the only author-facing select API. The runtime no longer skins a raw `<input>`, `<select>`, or `<textarea>` placed inside `.da-container`, and `.da-filter-select`, `.da-filter-input`, and `.da-form-*` are gone. Filter `<select>` controls (including `.filter-select` and surrounding `.da-filter-item` or `.da-filter-label` wrappers) must be converted to `<app-select label="..." .value=${...} .options=${[...]} @change=${...}>`, or styled in your own app CSS.
- The preview gallery shows each app with its last edit time (from file modification time) and last publish time (from `@published-at` in the header). Apps are sorted by last edit. (Known limitation: if `apps/` is tracked in git, fresh clones or branch switches will temporarily show checkout time until files are edited.)
- `make start` runs the preview server in the foreground and keeps the terminal until you press Ctrl+C. `start-preview.py` still starts it in the background.
- If an older preview server for the same workspace still holds the port, the preview server stops it and starts.
- The preview's same-origin mode is now **Inspect** (`?inspect=1`), replacing `?edit=1`. It mounts the app on an ordinary page for browser devtools and agent DOM access, as before, without the editor. It is reached by URL only: the gallery and the preview dock no longer offer a mode switch, so opening an app always shows the tile-parity view.

### Fixed
- When filters or tabs change quickly, an older query no longer replaces the newer result or clears its loading state. A widget's first query also waits for the Looker dashboard filters.
- Charts and cards no longer overflow narrow tiles or phone screens, and charts apply their final size after fast resizes.

### Removed
- The Copy details button on error cards.
- **Breaking — migrate your apps before you re-publish them.** Author CSS kits that no component owned, plus duplicate class names. `.da-modal*`, `.da-toast*`, `.da-btn-*`, the modal `.da-form-*` block, and `.da-live-dot` are gone: an app owns its own overlays and buttons, in its own `<style>` block. Duplicate names are gone too: use `.da-kpi-wrap` instead of `.da-kpi-card`, `.da-tab-content` instead of `.da-tab-pane`, and `.card`, a `*-card` class, or the `bare` attribute instead of `.custom-card` or `da-card`. For `.da-title`: use `.da-header` instead of `.da-title` only when `.da-title` is the top-level header container; if `.da-title` (or `.app-title`) is already nested inside `.da-header`, drop the class (`<div>`) or unwrap it so `.da-header` is never nested inside `.da-header`.
- The local visual editor in the preview (drag, resize, theme panel, Save, and the selected-tile marker), along with the preview server's `/api/save-layout` endpoint. Apps that already carry an `app-layout` theme section keep rendering with it, and publish still strips any leftover `data-cd-selected` marker.
- The `@updated` JSDoc header tag and `get-timestamp.py` helper.
- Bundled example apps under `examples/` that targeted the internal test Looker model.

## [1.0.0] - 2026-09-18

### Added
- Publish metadata is written into your `app.js` JSDoc header (`@looker-dashboard-id`, `@looker-instance`, `@published-at`, `@published-by`, `@toolkit-version`), so a file on disk says where it was published and against which runtime.
- The toolkit can upgrade itself in place. Your agent notices a new release and can run the upgrade for you, taking a backup of the installation and of your `apps/` first.

### Changed
- **Breaking — migrate your apps before you re-publish them.** Layout classes are now namespaced `da-*`, and `app-*` is reserved strictly for the live query widgets (`<app-chart>`, `<app-grid>`, `<app-kpi>`, `<app-select>`). Every `.app-*` CSS class became `.da-*` with the same suffix, for example `.app-container` -> `.da-container`, `.app-header` -> `.da-header`, and `.app-tab-btn` -> `.da-tab-btn`. One exception: `.app-charts-grid` became `.da-grid-2`. Only class names change; the `<app-chart>`, `<app-grid>`, `<app-kpi>`, and `<app-select>` element names stay. Dashboards already live are unaffected until you re-publish them.
- **Breaking — migrate your apps before you re-publish them.** Dark mode follows only the `.dark-theme` class. Replace the `.dark` class and the `[data-theme="dark"]` attribute with `.dark-theme`.
- Dark mode is reactive and app-owned: `DataApp.isDark` and `toggleDarkMode(force?)` keep `.dark-theme` in step across the app root, `documentElement`, `body`, Highcharts, and AG Grid.

### Removed
- The legacy `.app-*` layout class aliases. They are removed rather than deprecated: a published app is pinned to the runtime it was published against, so keeping an alias would carry the debt into every future release without protecting anything already live.


## [0.9.5] - 2026-09-04

### Added
- Multi-channel GCS distribution support.

## [0.9.0] - 2026-08-31

### Changed
- **Breaking — migrate your apps before you re-publish them.** Canvas Dashboards on Lit (`lit-canvas`) became Looker Data Apps.
  - Runtime files: `/runtime/lit-canvas.js` -> `/runtime/data-app.js` and `/runtime/lit-canvas.css` -> `/runtime/data-app.css`.
  - Base class and exported classes: `CanvasApp` -> `DataApp`, `LitCanvasWidget` -> `AppWidget`, `LitCanvasKPI` -> `AppKPI`, `LitCanvasChart` -> `AppChart`, `LitCanvasGrid` -> `AppGrid`, `LitCanvasSelect` -> `AppSelect`, and `applyCanvasLayout` -> `applyAppLayout`.
  - Element tags: `<lit-canvas-chart>` -> `<app-chart>`, `<lit-canvas-grid>` -> `<app-grid>`, `<lit-canvas-kpi>` -> `<app-kpi>`, and `<lit-canvas-select>` -> `<app-select>`.
  - Click events: `canvas-chart-click` -> `app-chart-click`.
  - Global namespace: `window.canvasDashboard` -> `window.DataApps`.
  - CSS tokens: every `--lit-*` token became `--app-*` with the same suffix (for example `--lit-card-bg` -> `--app-card-bg`). Exception: `--lit-coord-inset` has no replacement and goes away with the coordinate grid below.
  - CSS classes: every `.lit-app-*`, `.lit-*`, and `.cd-*` class became `.app-*` with the same suffix (for example `.lit-app-header` -> `.app-header` and `.cd-empty-card` -> `.app-empty-card`). Exception: `.lit-canvas-grid` -> `.app-grid`. The 1.0.0 entry then renames these `.app-*` layout classes to `.da-*`.

### Removed
- **Breaking — migrate your apps before you re-publish them.** Coordinate grid layout classes and helpers (`.lit-coord-grid`, `.lit-coord-tile`, `computeLayoutModel`, `collectCoordTiles`, `flattenIntoCoordGrid`, `LAYOUT_COORD_HOST_CLASS`, `LAYOUT_GRID_DEFAULTS`, `LAYOUT_ROW_SHAPES`). Lay out tiles with `.app-grid` or with CSS grid rules in the app's `<style>`.

[1.2.0]: https://dl.google.com/looker-data-apps/versions/1.2.0
[1.1.2]: https://dl.google.com/looker-data-apps/versions/1.1.2
[1.1.1]: https://dl.google.com/looker-data-apps/versions/1.1.1
[1.1.0]: https://storage.googleapis.com/canvas-dashboards-shared/looker-data-apps/versions/1.1.0
[1.0.0]: https://storage.googleapis.com/canvas-dashboards-shared/looker-data-apps/versions/1.0.0
[0.9.5]: https://storage.googleapis.com/canvas-dashboards-shared/apps/versions/0.9.5
