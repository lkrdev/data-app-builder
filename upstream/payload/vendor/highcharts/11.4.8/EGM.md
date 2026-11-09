# highcharts (11.4.8)

## Overview
Vendored Highcharts JS `v11.4.8` core and add-on chart module bundles loaded by `runtime/data-app.js` to render `<app-chart>` visualizations in Looker Data Apps.

## Interface
- `[highcharts.js:Highcharts]`: Core Highcharts `v11.4.8` UMD/AMD/CommonJS bundle defining `Highcharts` (`Chart`, `Axis`, `Series`, `Pointer`, `SeriesRegistry`, with `pie` registered on `Highcharts.Series.types.pie`).
- `[highcharts-more.js:RadialAxis]`: Highcharts `v11.4.8` extension module adding `RadialAxis` and extended series types (e.g. `areasplinerange`, gauges/polar support) onto `Highcharts`.
- `[highcharts-solid-gauge.js:solidgauge]`: Highcharts `v11.4.8` module registering the `solidgauge` series type (depends on `highcharts.js` and `highcharts-more.js`).
- `[highcharts-funnel.js:funnel, pyramid]`: Highcharts `v11.4.8` module composing `FunnelSeries` and registering `funnel` and `pyramid` series types onto `Highcharts`.
- `[highcharts-treemap.js:treemap, Breadcrumbs]`: Highcharts `v11.4.8` module composing `Breadcrumbs` and registering the `treemap` series type onto `Highcharts`.

## Invariants
- `[highcharts.js:UMD]` & `[highcharts-more.js]`, `[highcharts-solid-gauge.js]`, `[highcharts-funnel.js]`, `[highcharts-treemap.js]`: Third-party minified `v11.4.8` bundles; `highcharts.js` must load before `highcharts-more.js`, and `highcharts-more.js` must load before `highcharts-solid-gauge.js`.

## Side Effects
- `[highcharts.js:UMD]`: Registers the global `Highcharts` object in browser `<script>` environments; add-on modules mutate `Highcharts` in place to compose axes, breadcrumbs, and series types.

## Verification
- Run: `npm test`
