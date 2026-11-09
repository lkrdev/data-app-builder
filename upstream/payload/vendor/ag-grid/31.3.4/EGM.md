# ag-grid (31.3.4)

## Overview
Vendored AG Grid Community `v31.3.4` JavaScript UMD bundle and Quartz stylesheets loaded by `runtime/data-app.js` to power `<app-grid>` interactive tables in Looker Data Apps.

## Interface
- `[ag-grid-community.min.js:agGrid, createGrid, Grid, VERSION]`: UMD/CJS/AMD bundle exposing `agGrid` (`self.agGrid` / `window.agGrid`, `module.exports`, AMD) including `agGrid.createGrid(container, gridOptions)` and `VERSION` (`"31.3.4"`).
- `[ag-grid.css:.ag-icon]`: Core AG Grid structural stylesheet using `--ag-*` CSS custom properties.
- `[ag-theme-quartz.css:.ag-theme-quartz, .ag-theme-quartz-dark]`: AG Grid Quartz theme stylesheet with embedded base64 `agGridQuartz` woff2 `@font-face` and light/dark theme tokens.

## Invariants
- `[ag-grid-community.min.js:UMD]`: Third-party minified distribution (`v31.3.4`); must not be hand-edited and must load before `<app-grid>` initializes `agGrid.createGrid(...)`.

## Side Effects
- `[ag-grid-community.min.js:UMD]`: Assigns `agGrid` on `self`/`window` when loaded via `<script>` outside CommonJS/AMD environments.

## Verification
- Run: `npm test`
