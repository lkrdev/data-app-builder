---
name: data-app-upgrader
description: |
  Converts legacy HTML Canvas Dashboards (*.canvasdashboard.html) into Data Apps (apps/<name>/app.js) on the latest runtime.
  Trigger on migrate, upgrade, port, or convert of an HTML or canvas dashboard.
  Existing Lit apps (apps/*/app.js) upgrade through CHANGELOG.md with toolkit-updater, not this skill.
---

# Data App Upgrader

Convert legacy HTML Canvas Dashboards into Looker Data Apps in one step.
`skills/data-app-creator/SKILL.md` is the source of truth for the target app (file template, layout classes, chart recipes).
This skill lists only what differs from HTML.
To upgrade existing Lit apps, see `skills/toolkit-updater/SKILL.md` Gate 3 and `CHANGELOG.md`.
To upgrade the toolkit installation itself, use `toolkit-updater`.

## 1. Rules

1. **Preserve app identity, strip runtime chrome:**
   Retain what makes the app unique: custom palettes, gradients, and distinctive layout intent.
   Delete both `<style>` rules and inline `style="..."` attributes that duplicate `runtime/data-app.css`.
   This includes card borders, panel backgrounds, border-radii, box-shadows, margin-bottoms, and hardcoded text colors.
   The runtime widgets draw their own cards and manage their own spacing.

2. **Never nest elements with the same role:**
   Never nest `.da-header` inside `.da-header`.
   A widget placed inside a custom card wrapper must get the `bare` attribute, or drop the wrapper.

3. **Use runtime components and declarative attributes:**
   Convert filter `<select>` controls to `<app-select>`.
   Replace manual click event handling with the declarative `cross-filter` attribute on `<app-chart>`.

4. **Spread filters correctly:**
   Ensure `getEffectiveFilters()` spreads all filter sources:
   `return { ...this.dashboardFilters, ...this.crossFilters, ...filters, ...local };`

5. **Keep tiles safe:**
   Never use `localStorage` or `sessionStorage` in tiles. Sandboxed opaque origins block web storage.
   Never call `alert()`, `window.open()`, or inline `on*` event handlers.
   Store reactive state in Lit properties.

6. **Start with the JSDoc header:**
   Begin `app.js` with the line-1 JSDoc header from `skills/data-app-creator/SKILL.md` (`@title`, `@description`).
   Publishing adds the publish tags later.

7. **Register element and default export:**
   Register the custom element with `customElements.define('my-app', MyApp)`.
   Provide the class as the default export of the module.

8. **Modern Looker look:**
   Use sentence-case titles across all cards and widgets.
   Omit decorative emojis on headers, tabs, and `<app-kpi>` `icon`.

9. **Hoist static Highcharts formatters:**
   Define Highcharts formatters outside `render()` or as module-level functions.
   Inline function literals in `.options` cause redundant chart redraws on every render cycle.

## 2. HTML element -> Data App mapping

| Legacy HTML Element / Attribute | Modern Lit Equivalent | Migration Rule & Behavior |
| :--- | :--- | :--- |
| `<canvas-dashboard looker-model="...">` | `class App extends DataApp` (`this.lookerModel = '...'`) | Declares base Looker model context. |
| `<canvas-constraint field="..." condition="..." value="...">` | `filters['field'] = 'value'` | Constraints and listens collapse to `filters[field]`. Pass `value` as raw Looker filter expression. Comma-join duplicates (`"A,B"`). |
| `<canvas-listen filter="..." to="...">` | `filters['field'] = this.selectedProperty` | Wire to reactive Lit properties in `getEffectiveFilters()`. |
| `<canvas-dimension name="...">` / `<canvas-measure name="...">` | `fields: ['<VIEW>.<DIM>', '<VIEW>.<MEASURE>']` | Listed in query `fields: [...]` array. |
| `<canvas-chart type="..." explore="...">` | `<app-chart type="..." looker-model=${...} explore=${...} .query=${...} .options=${...}>` | Highcharts visualization. Pass `.query` object and Highcharts `.options` override. |
| `<canvas-grid explore="...">` | `<app-grid looker-model=${...} explore=${...} .query=${...} .columnDefs=${...}>` | AG Grid table. Supports custom `columnDefs`, `valueGetter`, and `cellRenderer`. |
| `<canvas-kpi query-field="...">` / 1-row grids | `<app-kpi>` or custom stat card HTML | Single measure summary tile or custom HTML card with deltas and progress bars. |
| `<canvas-tile card>` | The widget's own card by default, or `.da-section-card`/`.card` with `bare` on inner widgets | Self-contained visual card wrapper. |
| `<canvas-text>` | `<h1>`, `<h2>`, `<h3>`, `<p>`, `<span>` | Standard semantic HTML typography elements. |
| `<canvas-shape>` | CSS border, badge, pill, or background decoration | Native CSS styles inside `<style>`. |
| `<canvas-filter name="..." field="...">` | `<app-select label="..." .value=${...} .options=${[...]} @change=${...}>` | Property mutations trigger automatic reactive widget re-queries. |
| `pointClick` / cross-filtering scripts | `<app-chart cross-filter>` | Declarative `cross-filter` updates `this.crossFilters`, turns unselected segments solid gray on visual surface charts (column, bar, pie, donut, treemap, funnel, pyramid), and self-excludes source chart. |
| Hard page refreshes / re-init loops | `${keyed(this.activeMetric, html`<app-grid ...></app-grid>`)}` | Use `keyed(key, template)` for clean identity resets across state changes. |

## 3. What the latest runtime changed or dropped

- **Widgets draw their own card:** `<app-chart>`, `<app-grid>`, and `<app-kpi>` draw clean white cards with borders. Do not wrap widgets in outer card containers unless grouped.
- **Layout is container and grid classes with gap spacing:** Layout uses `.da-container` and grid classes (`.da-grid-2`, `.da-grid-3`, `.da-kpi-grid`). Convert legacy absolute positions to grid classes. Keep the 1-line `.da-container.fixed-canvas` override only if pixel layout must stay:
  ```css
  .da-container.fixed-canvas { position: relative; max-width: none; width: 1450px; min-height: 977px; margin: 0 auto; padding: 0; }
  ```
- **Raw form inputs are not styled:** Raw `<select>` and `<input>` elements receive no runtime styling. Use `<app-select>` or style inputs in your app CSS.
- **No modal, toast, button, or form CSS kits:** The runtime dropped generic UI kits. Apps style their own modals, buttons, and form elements.
- **Dark mode:** Dark mode follows the `.dark-theme` class via `this.renderThemeToggle()`.
- **Retired editor layout block:** If an app already contains an `app-layout` block, leave it in place. Never add a new one.

## 4. Verify and report

On Windows where `python3` is absent or points to the Microsoft Store stub, substitute `python` or `py -3` in all `python3` commands below.

1. **Check tile safety:**
   ```bash
   python3 skills/data-app-creator/tools/check-tile-safety.py apps/<name>/app.js
   ```
   This catches storage calls, popups, and forbidden handlers before loading the tile.

2. **Audit remaining styles:**
   Audit remaining `<style>` and inline `style="..."` attributes against `runtime/data-app.css`.
   Ensure no duplicate card borders or nested header containers remain.

3. **Run verification:**
   ```bash
   python3 skills/data-app-creator/tools/verify-app.py apps/<name>/app.js
   ```
   Inspect `apps/<name>/preview.png` to confirm charts, tables, and KPIs render properly.

4. **Report links and decisions:**
   Provide clickable preview and inspect links:
   - http://localhost:8765/preview-server/?app=apps/<name>/app.js
   - http://localhost:8765/preview-server/?app=apps/<name>/app.js&inspect=1

   Report the concrete decisions from the diff:
   - Elements with no direct equivalent.
   - Fixed layout kept or converted to CSS Grid.
   - Filter `condition` dropped because values pass through as raw Looker expressions.
   - Redundant CSS rules and inline style overrides removed.
