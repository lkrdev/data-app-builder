# Dark Theme Styling — Lit Data Apps

## Use when

Building developer-centric, DevOps, CI/CD telemetry, or high-contrast monitoring dashboards where a sleek dark aesthetic improves readability and look-and-feel.

> [!IMPORTANT]
> **Theme Management via `this.isDark`:** `DataApp` provides built-in reactive theme state via `this.isDark` and `this.toggleDarkMode()`. Setting `this.isDark = true;` or calling `this.toggleDarkMode()` automatically synchronizes `.dark-theme` across the component, the root container (`.da-container` or top-level element), and the document root/body so there are zero white margin leaks. Do not manually manipulate `document.body` styles yourself—let `DataApp` handle it.

## Canonical Lit Snippet

For a dashboard that is dark by default, initialize `this.isDark = true;` in `constructor()`:

```javascript
import { DataApp, html } from '/runtime/data-app.js';

export class TelemetryApp extends DataApp {
  static properties = {
    selectedScope: { type: String },
  };

  constructor() {
    super();
    this.lookerModel = 'system_metrics';
    this.explore = 'performance';
    this.isDark = true; // Dark theme on launch
    this.selectedScope = 'All';
  }

  render() {
    return html`
      <div class="da-container ${this.isDark ? 'dark-theme' : ''}">
        <!-- Header banner -->
        <header class="da-header" style="justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--app-text);">
              Performance Command Center
            </h1>
            <p style="margin: 4px 0 0; font-size: 13px; color: var(--app-muted);">
              Real-time console telemetry & performance health
            </p>
          </div>
          <div class="da-filter-bar">
            <!-- Illustrative only: it shows how a control themes in dark mode.
                 Include a dropdown only if your app actually needs one. -->
            <app-select
              .value=${this.selectedScope}
              .options=${[
                { label: 'All Categories', value: 'All' },
                { label: 'Tier 1', value: 'Tier1' },
                { label: 'Tier 2', value: 'Tier2' },
              ]}
              @change=${(e) => { this.selectedScope = e.detail.value; }}>
            </app-select>
          </div>
        </header>

        <!-- KPI Summary Row -->
        <section class="da-kpi-grid" style="margin-bottom: 24px;">
          <app-kpi
            explore="system_metrics"
            query-field="system_metrics.uptime_ratio"
            label="Service Uptime"
            format="percent1"
            .filters=${this.getEffectiveFilters()}
          ></app-kpi>
          <app-kpi
            explore="system_metrics"
            query-field="system_metrics.request_count"
            label="Total Requests"
            format="int"
            .filters=${this.getEffectiveFilters()}
          ></app-kpi>
        </section>

        <!-- Main Chart -->
        <section class="da-grid-1">
          <app-chart
            title="Metric Trend Over Time"
            type="areaspline"
            color="var(--app-primary)"
            explore="system_metrics"
            value-format="percent1"
            .query=${{
              fields: ['system_metrics.timestamp_date', 'system_metrics.uptime_ratio'],
              filters: this.getEffectiveFilters({}, { isTimeSeries: true }),
              sorts: ['system_metrics.timestamp_date asc'],
              limit: '500'
            }}
          ></app-chart>
        </section>
      </div>
    `;
  }
}
```

## Styling & Dark Palette Variables

The `.dark-theme` class automatically applies the following variables and component overrides across cards, KPIs, Highcharts, AG Grid, tab bars, filter bars, and controls. Chart series follow the palette too — `--app-primary` for a single series (as `color="var(--app-primary)"` above), and `--app-chart-1` … `--app-chart-7` for the categorical default.

```css
.dark-theme {
  --app-bg: #0b0f19;              /* Deep canvas background */
  --app-card-bg: #111827;         /* Elevated card background */
  --app-border: #1f2937;          /* Subtle slate border */
  --app-text: #f9fafb;            /* High-contrast white ink */
  --app-muted: #9ca3af;           /* Secondary description text */
  --app-tabs-bg: #1f2937;         /* Dark tab pill container background */
  --app-tabs-btn-active: #374151; /* Elevated active tab button */
  --app-input-bg: #1f2937;        /* Filter bar & dropdown input background */
  --app-shadow: none;
}
```

### Custom Container Classes

If an app uses a custom wrapper class (e.g., `.hub-container`) instead of or in addition to `.da-container`, always base background and card styles on `--app-bg` and `--app-card-bg`:

```css
.hub-container {
  background-color: var(--app-bg, #ffffff);
  color: var(--app-text, #262d33);
}
```

This guarantees that toggling `.dark-theme` smoothly recolors custom containers alongside runtime cards and widgets.

## Interactive Light ↔ Dark Theme Toggle

`DataApp` provides a built-in standardized toggle switch via `${this.renderThemeToggle(options)}`:
- Place `${this.renderThemeToggle()}` in your header or filter bar.
- By default, it renders an accessible dual-label `Light [ (o) ] Dark` switch highlighting the active mode, and calls `this.toggleDarkMode()` on change.
- Options:
  - `showLabel: false`: hide text labels and render the switch only.
  - `lightLabel`: customize the left mode label (default: `'Light'`).
  - `darkLabel`: customize the right mode label (default: `'Dark'`).
  - `label: 'Theme'`: use a single static label on the right and set `aria-label`.
  - `class: 'custom-toggle'`: add additional CSS classes.
  - `onChange: (isDark, event) => { ... }`: callback fired after the theme toggles.

```javascript
export class TelemetryApp extends DataApp {
  static properties = {
    selectedScope: { type: String },
  };

  constructor() {
    super();
    this.lookerModel = 'system_metrics';
    this.explore = 'performance';
    this.isDark = true; // Default theme: dark
    this.selectedScope = 'All';
  }

  render() {
    return html`
      <div class="da-container ${this.isDark ? 'dark-theme' : ''}">
        <header class="da-header" style="justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800;">Command Center</h1>
            <p style="margin: 4px 0 0; font-size: 13px; color: var(--app-muted);">Real-time telemetry</p>
          </div>
          <div style="display: flex; gap: 12px; align-items: center;">
            <!-- Built-in theme toggle switch -->
            ${this.renderThemeToggle()}
          </div>
        </header>

        <!-- KPI Summary & Charts automatically re-theme smoothly without refetching -->
        <section class="da-kpi-grid">
          <app-kpi query-field="performance.uptime" label="Uptime" format="percent1"></app-kpi>
        </section>
      </div>
    `;
  }
}
```

> [!TIP]
> **Zero White-Background Leaks:** Built-in classes (`.da-tabs`, `.da-tab-btn`, `.da-filter-bar`) automatically inherit `--app-tabs-bg`, `--app-input-bg`, and `--app-card-bg` inside `.dark-theme`. Never hardcode light backgrounds (e.g. `#ffffff` or `#f1f5f9`) on filter bars or tab strips.

> [!IMPORTANT]
> **CSS Variables and AG Grid in Dark Apps:**
> 1. **Never hardcode hex colors:** Always define every single color as a CSS variable (e.g. `--app-bg`, `--brand-primary`) with a required dark variant under `.dark-theme`.
> 2. **AG Grid automatically adopts dark mode:** Inside `.dark-theme`, `<app-grid>` applies `ag-theme-quartz-dark` and maps all AG Grid quartz variables to dark palette. To force dark mode explicitly, set `<app-grid theme="dark" ...>`.
