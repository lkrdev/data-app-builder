# runtime

## Overview
Core browser runtime module (`data-app.js`) and stylesheet (`data-app.css`) providing LitElement base classes (`DataApp`, `AppWidget`), `<app-kpi>`, `<app-chart>`, `<app-grid>`, and `<app-select>` custom elements, Looker Extension Host bootstrapping, vendor loading, cross-filtering, Y-scale synchronization, and render-settle signaling.

## Interface
- `[data-app.js:LitElement, html, css, noChange, nothing, Directive, directive, KeyedDirective, keyed]`: Re-exported Lit primitives (`../vendor/lit/3.3.1/lit.mjs`) and custom `keyed` remount directive.
- `[data-app.js:DataApp]`: Base `LitElement` class (`isDark`, `lookerModel`, `dashboardFilters`, `crossFilters`, `loading`, `appLayout`, instance `error`, getter `isRendering`; `refreshAll`, `setCrossFilter`, `clearCrossFilter`, `clearCrossFilters`, `toggleCrossFilter`, `getEffectiveFilters`, `toggleDarkMode`, `renderThemeToggle`, `runQuery`, `mergeQueries`).
- `[data-app.js:AppWidget, AppKPI, AppChart, AppGrid, AppSelect]`: Light-DOM widget base class and custom elements `<app-kpi>`, `<app-chart>`, `<app-grid>`, and `<app-select>` (emitting `app-chart-click`, `app-grid-row-click`, and `change` events).
- `[data-app.js:loadCSS, loadJS, loadVendors, _setExtensionSDKForTesting, forwardErrorToHost, reportCriticalError, reportRuntimeError, reportRuntimeWarning, isRenderSettled, watchRenderComplete, reportRenderComplete, _setRenderingForTesting, _setWidgetActions]`: Asset loading, Looker host error forwarding, and render-completion monitoring (`RENDER_SETTLE_POLL_MS = 250`, `RENDER_SETTLE_QUIET_MS = 1000`, `RENDERED_SIGNAL_CEILING_MS = 270000`).
- `[data-app.js:FORMATTERS, NUMERIC_FORMATS, parsePointValue, resolvePercentFormat, formatValue, formatAxisValue, formatStampDate, escapeHtml]`: Value, axis, timestamp, and HTML-escaping helpers.
- `[data-app.js:areDataRowsEqual, areColumnDefsEqual, areQueriesEqual, normalizeQueryPayload, CUSTOM_COL_DEF_KEYS, stripCustomColDefProps, createPercentageCol, createNumericCol, createCurrencyCol, createBadgeCol]`: Query normalization/equality and AG Grid column builders.
- `[data-app.js:KNOWN_WIDGET_TAGS, CHART_TYPES, CROSS_FILTER_CHART_TYPES, registerWidgetTag, isAppWidget, getAppContainer, findAppWidgets, resolveParentModel, resolveParentExplore, LAYOUT_FONT_STACKS, resolveAppRoot, applyAppLayout, applyCellTo, applyGridCells, isDarkContext, resolveColor, TILE_WIDGET_ACTION, whenDashboardFiltersReady, noteCrossFilterOrigin, isSameCrossFilterOrigin, CHART_IDENTITY_PROPS, CHART_NON_IDENTITY_PROPS, QUERY_INPUT_PROPS, WIDGET_QUERY_DEFAULTS, renderLoadingSkeleton, renderGridLoadingSkeleton, renderEmptyCard, describeError, renderErrorCard]`: Layout, theme, filter gate, cross-filter origin, and UI skeleton helpers.
- `[data-app.js:window.DataApps]`: Global namespace carrying `queryRunner`, `_extensionInitPromise`, and `renderComplete`.
- `[data-app.css]`: Runtime design tokens, grid cell spans, theme variables, and widget card/skeleton styles.

## Invariants
- `[data-app.js:DataApp.createRenderRoot]` & `[data-app.js:AppWidget.createRenderRoot]` & `[data-app.js:AppSelect.createRenderRoot]`: All runtime components render into Light DOM (`return this`) rather than Shadow DOM.
- `[data-app.js:loadVendors]`: Loads `VENDOR_CSS` in parallel, `VENDOR_JS_ORDERED` sequentially (`ag-grid-community.min.js`, `highcharts.js`, `highcharts-more.js`), and `VENDOR_JS_PARALLEL` (`highcharts-solid-gauge.js`, `highcharts-funnel.js`, `highcharts-treemap.js`) in parallel; `loadCSS`/`loadJS` never reject.
- `[data-app.js:whenDashboardFiltersReady]`: Resolves immediately outside tile context or once `window.__lookerDashboardFilters` is populated, otherwise settles once on `looker-dashboard-filters-changed` or `FILTER_GATE_TIMEOUT_MS` (`4000` ms).
- `[data-app.js:AppWidget.fetchData]`: Drops self-emitted cross-filters (`dropSelfCrossFilters`), deduplicates identical normalized queries unless `_forceRefresh`, guards stale responses via `_activeFetchId` + `AbortController`, and clears `_lastFetchedQuery` when aborted on disconnect.
- `[data-app.js:DataApp.getEffectiveFilters]`: Filter precedence is `localFilters > crossFilters > dashboardFilters`; `mergeQueries` returns `[]` for 0 queries, delegates to `runQuery` for 1 query, and requires explicit `on` keys or a shared field across all queries when `queryList.length > 1`.
- `[data-app.js:AppChart._setupResizeObserver]` & `[data-app.js:AppChart._syncYScaleGroup]`: Enforces a `300px` min-height floor when initial height `< 4px` without explicit height/`--app-chart-min-height`, breaks runaway resize loops (`> 15` resizes/1000ms), and guards `_syncYScaleGroup` with `_syncingYScale`.
- `[data-app.js:stripCustomColDefProps]`: Strips `CUSTOM_COL_DEF_KEYS` before passing column definitions to `agGrid.createGrid`; `createBadgeCol` HTML-escapes values and badge classes via `escapeHtml`.
- `[data-app.js:isRenderSettled]`: Returns `true` only when `_extensionInitPromise` is settled, `_pendingAppQueries <= 0`, `_connectedDataApps.size > 0`, all DataApps have updated, and every widget's `_isDrawSettled()` is `true`.

## Side Effects
- `[data-app.js:bootstrap_branch]`: At module evaluation, initializes `window.DataApps`, monkey-patches `customElements.define` (auto-mounting `DataApp` subclasses when `#app-root`/`#sandboxed-app-root` are absent), registers `<app-kpi>`, `<app-chart>`, `<app-grid>`, and `<app-select>`, and either starts `watchRenderComplete`, connects to Looker Extension Host (`bootstrapLookerTile()` inside iframes), or installs a throwing `queryRunner` stub.
- `[data-app.js:bootstrapLookerTile]` & `[data-app.js:loadVendors]`: Appends `<link>`/`<script>`/`modulepreload` tags to `document.head`, mutates `document.body` (`data-context='tile'`, `data-rendering`, `dark-theme`), fetches dashboard metadata via `coreSDK.dashboard()`, and posts `canvas-theme`, `TILE_WIDGET_ACTION`, error, and `rendered()` messages to the Looker host.
- `[data-app.js:DataApp]` & `[data-app.js:AppWidget]` & `[data-app.js:AppSelect]`: Attach `window` (`looker-dashboard-filters-changed`, `keydown`, `error`, `unhandledrejection`) and module-level `_watchTheme()` `MutationObserver` (`AppWidget`/`AppSelect`), dispatch bubbling/composed `app-chart-click` events (`AppChart`), register `ResizeObserver`/`requestAnimationFrame`/`setTimeout`, sync `.da-stamp` / root dark-mode classes, execute Looker queries via `window.DataApps.queryRunner`, and mutate widget DOM/Highcharts/AG Grid instances.

## Verification
- Run: `npm test`
