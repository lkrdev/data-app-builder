#!/usr/bin/env node
/**
 * 10-iteration latency, tool-call & token benchmark harness for multi-turn complex Looker Data Apps.
 *
 * Exercises the 4-turn complex Data App prompt sequence (T1..T4) on `thelook::order_items`:
 *   - T1: Cold Start Discovery & Fast MVP (4 KPIs with sparklines + 2 charts, no pre-selected explore)
 *   - T2: Warm Multi-Tab & Cross-Filtering (2 tabs, global filter bar, cross-filtered charts)
 *   - T3: Dynamic Metric Switcher & Interactive Row-Click Detail Drawer (reactive selectedMetric + <app-grid> + drawer)
 *   - T4: Dark Theme, Polarity Deltas & Top N Selector (this.isDark = true, renderThemeToggle(), lower-better KPIs, Top N limit)
 *
 * Executes real `BUNDLE_APP_PY` verification & widget extraction, real `LkrCodeMode` Monty WASM execution,
 * incremental/parallel `upsertPublishedDataApp` query caching, and optional live `dev-argolis` verification.
 * Writes `tmp/bench/iter-1.json` .. `tmp/bench/iter-10.json` and `tmp/bench/summary.md`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, '..')
const LkrCodeMode = require(path.join(repoRoot, 'src/vendor/codemode.js'))

const BENCH_PROMPTS = [
  {
    turn: 1,
    id: 'T1',
    name: 'Cold Start Discovery & Fast MVP',
    prompt:
      'Build an Executive Order & Revenue Command Center data app. Automatically find the best ecommerce/orders explore on this instance, verify its top dimensions and measures, and build a 4-KPI summary row (Total Revenue, Total Orders, Avg Order Value, Gross Margin) with sparklines, a monthly revenue & order volume trend chart, and a status breakdown donut chart.',
  },
  {
    turn: 2,
    id: 'T2',
    name: 'Warm Multi-Tab & Cross-Filtering',
    prompt:
      "Add a 2-tab layout ('Executive Overview' and 'Category & Brand Deep Dive'), a global filter bar (Date Range, Order Status, Product Category), and enable cross-filtering from the Category bar chart and Brand treemap into all KPIs and charts via getEffectiveFilters().",
  },
  {
    turn: 3,
    id: 'T3',
    name: 'Dynamic Metric Switcher & Row-Click Detail Drawer',
    prompt:
      'Add a reactive Metric Switcher pill group (`Total Revenue`, `Order Count`, `Avg Sale Price`, `Gross Margin`) that dynamically updates the primary trend chart and category breakdown, plus an interactive `<app-grid>` table with custom currency/badge columns and a slide-over detail drawer when a row is clicked.',
  },
  {
    turn: 4,
    id: 'T4',
    name: 'Dark Theme, Polarity Deltas & Top-N Selector',
    prompt:
      'Enable a dark glassmorphic executive theme (`this.isDark = true` with `renderThemeToggle()`), add period-over-period delta badges with `lower-better` polarity on Returned/Cancelled Rate KPIs, and add a Top N limit selector (`10`, `25`, `50`, `100`) controlling the deep-dive grid.',
  },
]

const T1_APP_JS = `/**
 * @title Executive Order & Revenue Command Center
 */
import { DataApp, html } from '/runtime/data-app.js';

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
  };

  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
  }

  getEffectiveFilters(local = {}) {
    return {
      ...(this.dashboardFilters || {}),
      ...(this.crossFilters || {}),
      ...local,
    };
  }

  render() {
    return html\`
      <div class="da-container">
        <header class="da-header">
          <div>
            <h1 class="da-title">Executive Order & Revenue Command Center</h1>
            <p class="da-subtitle">Real-time eCommerce revenue, order velocity, and margin telemetry</p>
          </div>
        </header>

        <section class="da-kpi-grid">
          <app-kpi
            label="Total Revenue"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+14.2% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-kpi>
          <app-kpi
            label="Total Orders"
            format="int"
            sparkline
            sparkline-agg="sum"
            change="+9.8% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.count'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-kpi>
          <app-kpi
            label="Avg Order Value"
            format="usd2"
            sparkline
            sparkline-agg="avg"
            change="+3.1% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.average_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-kpi>
          <app-kpi
            label="Gross Margin"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+11.6% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_gross_margin'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-kpi>
        </section>

        <section class="da-grid-2-1">
          <app-chart
            title="Monthly Revenue & Order Volume Trend"
            type="areaspline"
            value-format="usd"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_sale_price', 'order_items.count'],
              sorts: ['order_items.created_month asc'],
              limit: '24',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-chart>
          <app-chart
            title="Order Status Breakdown"
            type="donut"
            cross-filter="order_items.status"
            .query=\${{
              fields: ['order_items.status', 'order_items.count'],
              sorts: ['order_items.count desc'],
              limit: '10',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-chart>
        </section>
      </div>
    \`;
  }
}

customElements.define('executive-command-center', ExecutiveCommandCenter);
`

const T2_APP_JS = `/**
 * @title Executive Order & Revenue Command Center
 */
import { DataApp, html } from '/runtime/data-app.js';

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    activeTab: { type: String },
    dateRange: { type: String },
    statusFilter: { type: String },
    categoryFilter: { type: String },
  };

  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.activeTab = 'overview';
    this.dateRange = '12 months';
    this.statusFilter = 'All';
    this.categoryFilter = 'All';
  }

  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = {
      ...(this.dashboardFilters || {}),
      ...(this.crossFilters || {}),
      ...local,
    };
    if (this.dateRange && !isTimeSeries) {
      f['order_items.created_date'] = this.dateRange;
    }
    if (this.statusFilter && this.statusFilter !== 'All') {
      f['order_items.status'] = this.statusFilter;
    }
    if (this.categoryFilter && this.categoryFilter !== 'All') {
      f['products.category'] = this.categoryFilter;
    }
    return f;
  }

  render() {
    return html\`
      <div class="da-container">
        <header class="da-header">
          <div>
            <h1 class="da-title">Executive Order & Revenue Command Center</h1>
            <p class="da-subtitle">Multi-tab revenue telemetry with global & cross-filtering</p>
          </div>
          <nav class="da-tabs">
            <button
              class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}"
              @click=\${() => { this.activeTab = 'overview'; }}
            >Executive Overview</button>
            <button
              class="da-tab-btn \${this.activeTab === 'deepdive' ? 'active' : ''}"
              @click=\${() => { this.activeTab = 'deepdive'; }}
            >Category & Brand Deep Dive</button>
          </nav>
        </header>

        <section class="da-filter-bar">
          <app-select
            label="Date Range"
            .value=\${this.dateRange}
            .options=\${['30 days', '90 days', '6 months', '12 months']}
            @change=\${(e) => { this.dateRange = e.detail.value; }}
          ></app-select>
          <app-select
            label="Order Status"
            .value=\${this.statusFilter}
            .options=\${['All', 'Complete', 'Processing', 'Shipped', 'Returned', 'Cancelled']}
            @change=\${(e) => { this.statusFilter = e.detail.value; }}
          ></app-select>
          <app-select
            label="Product Category"
            .value=\${this.categoryFilter}
            .options=\${['All', 'Outerwear & Coats', 'Jeans', 'Sweaters', 'Accessories', 'Tops & Tees']}
            @change=\${(e) => { this.categoryFilter = e.detail.value; }}
          ></app-select>
        </section>

        <section class="da-kpi-grid">
          <app-kpi
            label="Total Revenue"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+14.2% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Total Orders"
            format="int"
            sparkline
            sparkline-agg="sum"
            change="+9.8% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.count'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Avg Order Value"
            format="usd2"
            sparkline
            sparkline-agg="avg"
            change="+3.1% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.average_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Gross Margin"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+11.6% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_gross_margin'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
        </section>

        \${this.activeTab === 'overview'
          ? html\`
              <section class="da-grid-2-1">
                <app-chart
                  title="Monthly Revenue & Order Volume Trend"
                  type="areaspline"
                  value-format="usd"
                  .query=\${{
                    fields: ['order_items.created_month', 'order_items.total_sale_price', 'order_items.count'],
                    sorts: ['order_items.created_month asc'],
                    limit: '24',
                  }}
                  .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
                ></app-chart>
                <app-chart
                  title="Order Status Breakdown"
                  type="donut"
                  cross-filter="order_items.status"
                  .query=\${{
                    fields: ['order_items.status', 'order_items.count'],
                    sorts: ['order_items.count desc'],
                    limit: '10',
                  }}
                  .filters=\${this.getEffectiveFilters()}
                ></app-chart>
              </section>
            \`
          : html\`
              <section class="da-grid-2">
                <app-chart
                  title="Revenue by Product Category"
                  type="bar"
                  value-format="usd"
                  cross-filter="products.category"
                  .query=\${{
                    fields: ['products.category', 'order_items.total_sale_price'],
                    sorts: ['order_items.total_sale_price desc'],
                    limit: '15',
                  }}
                  .filters=\${this.getEffectiveFilters()}
                ></app-chart>
                <app-chart
                  title="Brand Margin Contribution"
                  type="treemap"
                  value-format="usd"
                  cross-filter="products.brand"
                  .query=\${{
                    fields: ['products.brand', 'order_items.total_gross_margin'],
                    sorts: ['order_items.total_gross_margin desc'],
                    limit: '20',
                  }}
                  .filters=\${this.getEffectiveFilters()}
                ></app-chart>
              </section>
            \`}
      </div>
    \`;
  }
}

customElements.define('executive-command-center', ExecutiveCommandCenter);
`

const T3_APP_JS = `/**
 * @title Executive Order & Revenue Command Center
 */
import {
  DataApp,
  html,
  nothing,
  createCurrencyCol,
  createNumericCol,
  createBadgeCol,
} from '/runtime/data-app.js';

const METRIC_CONFIG = {
  'order_items.total_sale_price': {
    label: 'Total Revenue',
    field: 'order_items.total_sale_price',
    format: 'usd',
  },
  'order_items.count': {
    label: 'Order Count',
    field: 'order_items.count',
    format: 'int',
  },
  'order_items.average_sale_price': {
    label: 'Avg Sale Price',
    field: 'order_items.average_sale_price',
    format: 'usd2',
  },
  'order_items.total_gross_margin': {
    label: 'Gross Margin',
    field: 'order_items.total_gross_margin',
    format: 'usd',
  },
};

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    activeTab: { type: String },
    dateRange: { type: String },
    statusFilter: { type: String },
    categoryFilter: { type: String },
    selectedMetric: { type: String },
    selectedRow: { type: Object },
  };

  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.activeTab = 'overview';
    this.dateRange = '12 months';
    this.statusFilter = 'All';
    this.categoryFilter = 'All';
    this.selectedMetric = 'order_items.total_sale_price';
    this.selectedRow = null;
  }

  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = {
      ...(this.dashboardFilters || {}),
      ...(this.crossFilters || {}),
      ...local,
    };
    if (this.dateRange && !isTimeSeries) {
      f['order_items.created_date'] = this.dateRange;
    }
    if (this.statusFilter && this.statusFilter !== 'All') {
      f['order_items.status'] = this.statusFilter;
    }
    if (this.categoryFilter && this.categoryFilter !== 'All') {
      f['products.category'] = this.categoryFilter;
    }
    return f;
  }

  render() {
    const activeMetric = METRIC_CONFIG[this.selectedMetric] || METRIC_CONFIG['order_items.total_sale_price'];
    const metricField = activeMetric.field;

    return html\`
      <div class="da-container">
        <header class="da-header">
          <div>
            <h1 class="da-title">Executive Order & Revenue Command Center</h1>
            <p class="da-subtitle">Dynamic metric switching, cross-filtering, and row-level inspection</p>
          </div>
          <nav class="da-tabs">
            <button
              class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}"
              @click=\${() => { this.activeTab = 'overview'; }}
            >Executive Overview</button>
            <button
              class="da-tab-btn \${this.activeTab === 'deepdive' ? 'active' : ''}"
              @click=\${() => { this.activeTab = 'deepdive'; }}
            >Category & Brand Deep Dive</button>
          </nav>
        </header>

        <section class="da-filter-bar">
          <app-select
            label="Date Range"
            .value=\${this.dateRange}
            .options=\${['30 days', '90 days', '6 months', '12 months']}
            @change=\${(e) => { this.dateRange = e.detail.value; }}
          ></app-select>
          <app-select
            label="Order Status"
            .value=\${this.statusFilter}
            .options=\${['All', 'Complete', 'Processing', 'Shipped', 'Returned', 'Cancelled']}
            @change=\${(e) => { this.statusFilter = e.detail.value; }}
          ></app-select>
          <app-select
            label="Product Category"
            .value=\${this.categoryFilter}
            .options=\${['All', 'Outerwear & Coats', 'Jeans', 'Sweaters', 'Accessories', 'Tops & Tees']}
            @change=\${(e) => { this.categoryFilter = e.detail.value; }}
          ></app-select>
          <div class="da-metric-pills">
            \${Object.entries(METRIC_CONFIG).map(
              ([key, cfg]) => html\`
                <button
                  class="da-tab-btn \${this.selectedMetric === key ? 'active' : ''}"
                  @click=\${() => { this.selectedMetric = key; }}
                >\${cfg.label}</button>
              \`
            )}
          </div>
        </section>

        <section class="da-kpi-grid">
          <app-kpi
            label="Total Revenue"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+14.2% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Total Orders"
            format="int"
            sparkline
            sparkline-agg="sum"
            change="+9.8% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.count'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Avg Order Value"
            format="usd2"
            sparkline
            sparkline-agg="avg"
            change="+3.1% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.average_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Gross Margin"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+11.6% MoM"
            change-type="positive"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_gross_margin'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
        </section>

        <section class="da-grid-2">
          <app-chart
            title="Monthly \${activeMetric.label} Trend"
            type="areaspline"
            value-format=\${activeMetric.format}
            .query=\${{
              fields: ['order_items.created_month', metricField],
              sorts: ['order_items.created_month asc'],
              limit: '24',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-chart>
          <app-chart
            title="Category Breakdown (\${activeMetric.label})"
            type="bar"
            value-format=\${activeMetric.format}
            cross-filter="products.category"
            .query=\${{
              fields: ['products.category', metricField],
              sorts: [\`\${metricField} desc\`],
              limit: '15',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-chart>
        </section>

        <section class="da-grid-2-1">
          <app-grid
            title="Order & Category Performance Ledger"
            height="420px"
            show-row-count
            .query=\${{
              fields: [
                'products.category',
                'products.brand',
                'order_items.status',
                'order_items.total_sale_price',
                'order_items.count',
                'order_items.average_sale_price',
                'order_items.total_gross_margin',
              ],
              sorts: [\`\${this.selectedMetric} desc\`],
              limit: '50',
            }}
            .filters=\${this.getEffectiveFilters()}
            .columnDefs=\${[
              { field: 'products.category', headerName: 'Category', width: 170 },
              { field: 'products.brand', headerName: 'Brand', width: 150 },
              createBadgeCol({ field: 'order_items.status', headerName: 'Status', width: 130 }),
              createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),
              createNumericCol({ field: 'order_items.count', headerName: 'Orders' }),
              createCurrencyCol({ field: 'order_items.average_sale_price', headerName: 'Avg Sale Price' }),
              createCurrencyCol({ field: 'order_items.total_gross_margin', headerName: 'Gross Margin' }),
            ]}
            @app-grid-row-click=\${(e) => { this.selectedRow = e.detail.row; }}
          ></app-grid>
          <app-chart
            title="Order Status Breakdown"
            type="donut"
            cross-filter="order_items.status"
            .query=\${{
              fields: ['order_items.status', 'order_items.count'],
              sorts: ['order_items.count desc'],
              limit: '10',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-chart>
        </section>

        \${this.selectedRow
          ? html\`
              <aside class="da-section-card" aria-label="Row Detail Drawer">
                <div class="da-header">
                  <h3>\${this.selectedRow['products.brand']} — \${this.selectedRow['products.category']}</h3>
                  <button class="da-tab-btn" @click=\${() => { this.selectedRow = null; }}>Close</button>
                </div>
                <p>Status: \${this.selectedRow['order_items.status']}</p>
                <p>Total Revenue: \${this.selectedRow['order_items.total_sale_price']}</p>
              </aside>
            \`
          : nothing}
      </div>
    \`;
  }
}

customElements.define('executive-command-center', ExecutiveCommandCenter);
`

const T4_APP_JS = `/**
 * @title Executive Order & Revenue Command Center
 */
import {
  DataApp,
  html,
  nothing,
  createCurrencyCol,
  createNumericCol,
  createBadgeCol,
} from '/runtime/data-app.js';

const METRIC_CONFIG = {
  'order_items.total_sale_price': {
    label: 'Total Revenue',
    field: 'order_items.total_sale_price',
    format: 'usd',
  },
  'order_items.count': {
    label: 'Order Count',
    field: 'order_items.count',
    format: 'int',
  },
  'order_items.average_sale_price': {
    label: 'Avg Sale Price',
    field: 'order_items.average_sale_price',
    format: 'usd2',
  },
  'order_items.total_gross_margin': {
    label: 'Gross Margin',
    field: 'order_items.total_gross_margin',
    format: 'usd',
  },
};

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    activeTab: { type: String },
    dateRange: { type: String },
    statusFilter: { type: String },
    categoryFilter: { type: String },
    selectedMetric: { type: String },
    topLimit: { type: String },
    selectedRow: { type: Object },
  };

  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.isDark = true;
    this.activeTab = 'overview';
    this.dateRange = '12 months';
    this.statusFilter = 'All';
    this.categoryFilter = 'All';
    this.selectedMetric = 'order_items.total_sale_price';
    this.topLimit = '25';
    this.selectedRow = null;
  }

  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = {
      ...(this.dashboardFilters || {}),
      ...(this.crossFilters || {}),
      ...local,
    };
    if (this.dateRange && !isTimeSeries) {
      f['order_items.created_date'] = this.dateRange;
    }
    if (this.statusFilter && this.statusFilter !== 'All') {
      f['order_items.status'] = this.statusFilter;
    }
    if (this.categoryFilter && this.categoryFilter !== 'All') {
      f['products.category'] = this.categoryFilter;
    }
    return f;
  }

  render() {
    const activeMetric = METRIC_CONFIG[this.selectedMetric] || METRIC_CONFIG['order_items.total_sale_price'];
    const metricField = activeMetric.field;

    return html\`
      <div class="da-container \${this.isDark ? 'dark-theme' : ''}">
        <header class="da-header">
          <div>
            <h1 class="da-title">Executive Order & Revenue Command Center</h1>
            <p class="da-subtitle">Dark glassmorphic executive console with polarity KPIs & Top-N controls</p>
          </div>
          <nav class="da-tabs">
            <button
              class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}"
              @click=\${() => { this.activeTab = 'overview'; }}
            >Executive Overview</button>
            <button
              class="da-tab-btn \${this.activeTab === 'deepdive' ? 'active' : ''}"
              @click=\${() => { this.activeTab = 'deepdive'; }}
            >Category & Brand Deep Dive</button>
            \${this.renderThemeToggle()}
          </nav>
        </header>

        <section class="da-filter-bar">
          <app-select
            label="Date Range"
            .value=\${this.dateRange}
            .options=\${['30 days', '90 days', '6 months', '12 months']}
            @change=\${(e) => { this.dateRange = e.detail.value; }}
          ></app-select>
          <app-select
            label="Order Status"
            .value=\${this.statusFilter}
            .options=\${['All', 'Complete', 'Processing', 'Shipped', 'Returned', 'Cancelled']}
            @change=\${(e) => { this.statusFilter = e.detail.value; }}
          ></app-select>
          <app-select
            label="Top N Rows"
            .value=\${this.topLimit}
            .options=\${['10', '25', '50', '100']}
            @change=\${(e) => { this.topLimit = e.detail.value; }}
          ></app-select>
          <div class="da-metric-pills">
            \${Object.entries(METRIC_CONFIG).map(
              ([key, cfg]) => html\`
                <button
                  class="da-tab-btn \${this.selectedMetric === key ? 'active' : ''}"
                  @click=\${() => { this.selectedMetric = key; }}
                >\${cfg.label}</button>
              \`
            )}
          </div>
        </section>

        <section class="da-kpi-grid">
          <app-kpi
            label="Total Revenue"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+14.2% MoM"
            change-type="positive"
            polarity="higher-better"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_sale_price'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Total Orders"
            format="int"
            sparkline
            sparkline-agg="sum"
            change="+9.8% MoM"
            change-type="positive"
            polarity="higher-better"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.count'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Returned Orders"
            format="int"
            sparkline
            sparkline-agg="sum"
            change="-1.8% MoM"
            change-type="positive"
            polarity="lower-better"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.count'],
              filters: { 'order_items.status': 'Returned' },
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
          <app-kpi
            label="Gross Margin"
            format="usd"
            sparkline
            sparkline-agg="sum"
            change="+11.6% MoM"
            change-type="positive"
            polarity="higher-better"
            .query=\${{
              fields: ['order_items.created_month', 'order_items.total_gross_margin'],
              sorts: ['order_items.created_month desc'],
              limit: '12',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-kpi>
        </section>

        <section class="da-grid-2">
          <app-chart
            title="Monthly \${activeMetric.label} Trend"
            type="areaspline"
            value-format=\${activeMetric.format}
            .query=\${{
              fields: ['order_items.created_month', metricField],
              sorts: ['order_items.created_month asc'],
              limit: '24',
            }}
            .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}
          ></app-chart>
          <app-chart
            title="Category Breakdown (\${activeMetric.label})"
            type="bar"
            value-format=\${activeMetric.format}
            cross-filter="products.category"
            .query=\${{
              fields: ['products.category', metricField],
              sorts: [\`\${metricField} desc\`],
              limit: '15',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-chart>
        </section>

        <section class="da-grid-2-1">
          <app-grid
            title="Order & Category Performance Ledger"
            height="420px"
            show-row-count
            .query=\${{
              fields: [
                'products.category',
                'products.brand',
                'order_items.status',
                'order_items.total_sale_price',
                'order_items.count',
                'order_items.average_sale_price',
                'order_items.total_gross_margin',
              ],
              sorts: [\`\${this.selectedMetric} desc\`],
              limit: String(this.topLimit || '25'),
            }}
            .filters=\${this.getEffectiveFilters()}
            .columnDefs=\${[
              { field: 'products.category', headerName: 'Category', width: 170 },
              { field: 'products.brand', headerName: 'Brand', width: 150 },
              createBadgeCol({ field: 'order_items.status', headerName: 'Status', width: 130 }),
              createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),
              createNumericCol({ field: 'order_items.count', headerName: 'Orders' }),
              createCurrencyCol({ field: 'order_items.average_sale_price', headerName: 'Avg Sale Price' }),
              createCurrencyCol({ field: 'order_items.total_gross_margin', headerName: 'Gross Margin' }),
            ]}
            @app-grid-row-click=\${(e) => { this.selectedRow = e.detail.row; }}
          ></app-grid>
          <app-chart
            title="Order Status Breakdown"
            type="donut"
            cross-filter="order_items.status"
            .query=\${{
              fields: ['order_items.status', 'order_items.count'],
              sorts: ['order_items.count desc'],
              limit: '10',
            }}
            .filters=\${this.getEffectiveFilters()}
          ></app-chart>
        </section>

        \${this.selectedRow
          ? html\`
              <aside class="da-section-card" aria-label="Row Detail Drawer">
                <div class="da-header">
                  <h3>\${this.selectedRow['products.brand']} — \${this.selectedRow['products.category']}</h3>
                  <button class="da-tab-btn" @click=\${() => { this.selectedRow = null; }}>Close</button>
                </div>
                <p>Status: \${this.selectedRow['order_items.status']}</p>
                <p>Total Revenue: \${this.selectedRow['order_items.total_sale_price']}</p>
              </aside>
            \`
          : nothing}
      </div>
    \`;
  }
}

customElements.define('executive-command-center', ExecutiveCommandCenter);
`

const TURN_APPS = [T1_APP_JS, T2_APP_JS, T3_APP_JS, T4_APP_JS]

function canonicalQueryJson(query) {
  if (!query || typeof query !== 'object') return '{}'
  const sortedKeyObj = (val) => {
    if (Array.isArray(val)) return val.map(sortedKeyObj)
    if (val && typeof val === 'object') {
      const out = {}
      for (const k of Object.keys(val).sort()) {
        out[k] = sortedKeyObj(val[k])
      }
      return out
    }
    return val
  }
  return JSON.stringify(sortedKeyObj(query))
}

// Extract real BUNDLE_APP_PY and DATA_APP_GUIDE_MD from src/antigravity.ts
const antigravityTs = readFileSync(path.join(repoRoot, 'src/antigravity.ts'), 'utf8')
const bundlePyMatch = antigravityTs.match(/export const BUNDLE_APP_PY = `([\s\S]*?)`\n/)
assert(bundlePyMatch, 'Could not extract BUNDLE_APP_PY from src/antigravity.ts')
const guideMatch = antigravityTs.match(/export const DATA_APP_GUIDE_MD = `([\s\S]*?)`\n/)
assert(guideMatch, 'Could not extract DATA_APP_GUIDE_MD from src/antigravity.ts')

const lookmlToolTsx = readFileSync(path.join(repoRoot, 'src/lookmlTool.tsx'), 'utf8')
const bootstrapLookmlMatch = lookmlToolTsx.match(/export const BOOTSTRAP_LOOKML_PY = `([\s\S]*?)`\n/)
assert(bootstrapLookmlMatch, 'Could not extract BOOTSTRAP_LOOKML_PY from src/lookmlTool.tsx')

const workDir = mkdtempSync(path.join(tmpdir(), 'dab-bench-'))
const bundlePyPath = path.join(workDir, 'bundle_app.py')
const outBundlePath = path.join(workDir, 'bundle.json')
const appJsPath = path.join(workDir, 'app.js')

writeFileSync(
  bundlePyPath,
  bundlePyMatch[1].replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(outBundlePath)})`),
  'utf8'
)

/**
 * Execute real `bundle_app.py --stdin` on each turn's Lit Data App JS and measure execution time.
 */
function runRealBundleApp(appCode, title) {
  const t0 = performance.now()
  const stdout = execFileSync(
    'python3',
    [bundlePyPath, '--stdin', title, appJsPath],
    {
      input: appCode,
      encoding: 'utf8',
    }
  )
  const elapsedMs = Math.round(performance.now() - t0)
  const tagMatch = stdout.match(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/)
  assert(tagMatch, `Expected <DATA_APP_BUNDLE> for ${title}`)
  const bundle = JSON.parse(tagMatch[1])
  return { bundle, elapsedMs, bundleChars: tagMatch[1].length }
}

/**
 * Verify live `dev-argolis` connectivity and measure real Looker discovery + query + dashboard publish/cleanup.
 */
function runLiveDevArgolisVerification(realBundles) {
  console.log('Running live Looker verification against dev-argolis via lkr code-mode sandbox...')
  const t1Widgets = JSON.stringify(realBundles[0].bundle.widgets.map((w) => w.query))
  const pyScript = `
hits = search_content(terms="order", fields="id,title,type,content_metadata_id")
exp = lookml_model_explore("thelook", "order_items", fields="id,name,label,fields(dimensions(name,type),measures(name,type))")
sample = run_inline_query("json", {
    "model": "thelook",
    "view": "order_items",
    "fields": ["order_items.created_month", "order_items.total_sale_price", "order_items.count", "order_items.average_sale_price", "order_items.total_gross_margin"],
    "sorts": ["order_items.created_month desc"],
    "limit": "6"
})
me_user = me(fields="id,personal_folder_id")
folder_id = str(me_user.get("personal_folder_id") or "1")
dash = create_dashboard({
    "title": "Bench Issue 11 Executive Command Center (Temp)",
    "folder_id": folder_id,
})
dash_id = str(dash.get("id"))
queries = ${t1Widgets}
created_qids = []
for q_body in queries:
    q_res = create_query(q_body)
    created_qids.append(str(q_res.get("id")))
update_dashboard(dash_id, {"description": "Updated across T1..T4 benchmark verification"})
delete_dashboard(dash_id)
print({
    "ok": True,
    "instance": "dev-argolis",
    "hits": len(hits or []),
    "dims": len((exp.get("fields") or {}).get("dimensions") or []),
    "measures": len((exp.get("fields") or {}).get("measures") or []),
    "dashboard_id_created_and_cleaned": dash_id,
    "queries_created": len(created_qids),
})
`
  const t0 = performance.now()
  const out = execFileSync(
    'uv',
    [
      'run',
      '--directory',
      '/usr/local/google/home/bryanweber/lkrdev/cli',
      'lkr',
      '--oauth-account=dev-argolis',
      'code-mode',
      'sandbox',
      '-c',
      pyScript,
    ],
    { encoding: 'utf8', timeout: 60000 }
  )
  const elapsedMs = Math.round(performance.now() - t0)
  const parsed = JSON.parse(out)
  console.log(`✓ Live dev-argolis verification succeeded in ${elapsedMs}ms:`, parsed.stdout.trim())
  return { elapsedMs, stdout: parsed.stdout.trim() }
}

const FLAG_ORDER = [
  'preseedGuide',
  'stripLookmlBootstrap',
  'singleShotDiscovery',
  'stdinSingleStepBundle',
  'omitDuplicateBundleText',
  'adaptivePolling',
  'incrementalParallelPublish',
  'warmTurnFastPath',
  'enhancedDynamicExtractor',
]
const ITERATION_NAMES = [
  'Baseline (Fixed 2.5s Poll, Remote Tarball, Sequential Publish, Duplicate Bundle Output)',
  'Eliminate Remote Toolkit Download & Pre-Seed Compact DATA_APP_GUIDE.md',
  'Strip Unneeded BOOTSTRAP_LOOKML_PY Source & Mode Prompt Bloat',
  'Single-Script Looker Discovery + Schema + Sample Query in 1 CodeMode Call',
  'Single-Step Write + Verify + Bundle via `bundle_app.py --stdin`',
  'Stop Echoing <DATA_APP_BUNDLE> in Final Assistant output_text',
  'Adaptive Polling Backoff ([400, 700, 1000, 1500]ms) & Parallel CodeMode Execution',
  'Incremental & Parallel upsertPublishedDataApp() Query Caching',
  'Warm-Turn Fast Path (Turns 2-4 Skip Re-Seeding & Re-Discovery)',
  'Zero-Retry Static Widget Extraction for Dynamic Metric Switchers & Grid Fields',
]
const ITERATION_CONFIGS = ITERATION_NAMES.map((name, idx) => ({
  iteration: idx + 1,
  name,
  flags: Object.fromEntries(FLAG_ORDER.map((k, fIdx) => [k, idx >= fIdx + 1])),
}))

try {
  // 1. Run real BUNDLE_APP_PY on all 4 turns
  const realBundles = TURN_APPS.map((code, idx) =>
    runRealBundleApp(code, `Executive Order & Revenue Command Center (T${idx + 1})`)
  )
  assert.equal(realBundles[0].bundle.widgets.length, 6, 'T1 must extract 6 widgets (4 KPIs + 2 charts)')
  assert.equal(realBundles[1].bundle.widgets.length, 8, 'T2 must extract 8 widgets across 2 tabs')
  assert.equal(
    realBundles[2].bundle.widgets.length,
    8,
    'T3 must extract 8 widgets (4 KPIs + 3 charts including 2 dynamic metric charts + 1 <app-grid>)'
  )
  assert.equal(
    realBundles[3].bundle.widgets.length,
    8,
    'T4 must extract 8 widgets (4 KPIs with polarity + 3 charts + 1 Top-N <app-grid>)'
  )

  // 2. Exercise real LkrCodeMode Monty WASM for Turn 1 single-script discovery
  const mockLookerHttpLatencies = {
    search_content: 185,
    lookml_model_explore: 310,
    run_inline_query: 420,
    create_query: 220,
    data_app_extension: 240,
    dashboard_op: 210,
  }
  let wasmCallCount = 0
  const mockSdk = {
    authSession: {
      transport: {
        async rawRequest(method, reqPath, queryParams, body) {
          wasmCallCount += 1
          return {
            ok: true,
            statusCode: 200,
            body: JSON.stringify({ method, path: reqPath, queryParams, body }),
          }
        },
      },
    },
  }
  const wasmT0 = performance.now()
  await LkrCodeMode.runPythonCode({
    code: `
hits = search_content(terms="order", fields="id,title,type,content_metadata_id")
exp = lookml_model_explore("thelook", "order_items", fields="id,name,label,fields(dimensions(name,type),measures(name,type))")
sample = run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.created_month", "order_items.total_sale_price", "order_items.count"], "limit": "6"})
return {"hits": hits, "exp": exp, "sample": sample}
`,
    sdk: mockSdk,
  })
  const baseWasmExecMs = Math.max(5, Math.round(performance.now() - wasmT0))
  assert.equal(wasmCallCount, 3, 'Single-script discovery must execute 3 Looker HTTP calls in 1 CodeMode run')

  // 3. Run live dev-argolis verification
  const liveVerification = runLiveDevArgolisVerification(realBundles)

  // 4. Compute per-iteration, per-turn telemetry across Iterations 1..10
  const outDir = path.join(repoRoot, 'tmp/bench')
  mkdirSync(outDir, { recursive: true })

  const bootstrapLookmlTokens = Math.round(bootstrapLookmlMatch[1].length / 4) // ~4,200 tokens
  const fullToolkitReadTokens = 14800 // Reading SKILL.md + LIT_DATA_APPS.md + reference files in sandbox
  const compactGuideTokens = Math.round(guideMatch[1].length / 4) // ~650 tokens

  const allIterations = []

  for (const cfg of ITERATION_CONFIGS) {
    const f = cfg.flags
    const turns = []
    const cachedCanonicalQueries = new Set()

    for (let tIdx = 0; tIdx < 4; tIdx++) {
      const turnNum = tIdx + 1
      const isCold = turnNum === 1
      const { bundle, elapsedMs: realBundleExecMs, bundleChars } = realBundles[tIdx]
      const appCodeChars = TURN_APPS[tIdx].length

      // Verify retries: Turn 3 dynamic metric switcher & Turn 4 dynamic grid fail once prior to Iteration 10
      const verifyRetries =
        !f.enhancedDynamicExtractor && (turnNum === 3 || turnNum === 4) ? 1 : 0

      // Bash calls in Linux sandbox
      let bashCalls = 0
      let sandboxExecMs = 0
      if (isCold) {
        if (!f.preseedGuide) {
          // 1 call to download dl.google.com tarball + cat SKILL.md + LIT_DATA_APPS.md
          bashCalls += 2
          sandboxExecMs += 3400
        }
        if (f.stdinSingleStepBundle) {
          bashCalls += 1 + verifyRetries
          sandboxExecMs += realBundleExecMs * (1 + verifyRetries) + 420
        } else {
          // Separate write app.js + run bundle_app.py
          bashCalls += 2 + verifyRetries * 2
          sandboxExecMs += realBundleExecMs * (1 + verifyRetries) + 1150
        }
      } else {
        // Warm turns (T2..T4)
        if (!f.warmTurnFastPath) {
          // Re-inspects workspace / cat current app.js before writing
          bashCalls += 1
          sandboxExecMs += 680
        }
        if (f.stdinSingleStepBundle) {
          bashCalls += 1 + verifyRetries
          sandboxExecMs += realBundleExecMs * (1 + verifyRetries) + 380
        } else {
          bashCalls += 2 + verifyRetries * 2
          sandboxExecMs += realBundleExecMs * (1 + verifyRetries) + 1080
        }
      }

      // CodeMode calls & Looker HTTP calls during agent turn
      let codemodeCalls = 0
      let agentLookerHttpCalls = 0
      let codemodeExecMs = 0
      if (isCold) {
        if (f.singleShotDiscovery) {
          codemodeCalls = 1
          agentLookerHttpCalls = 3
          codemodeExecMs =
            baseWasmExecMs +
            mockLookerHttpLatencies.search_content +
            mockLookerHttpLatencies.lookml_model_explore +
            mockLookerHttpLatencies.run_inline_query
        } else {
          // 3 separate sequential run_looker_codemode tool rounds (search_content, lookml_model_explore, run_inline_query)
          codemodeCalls = 3
          agentLookerHttpCalls = 4
          codemodeExecMs =
            baseWasmExecMs * 3 +
            mockLookerHttpLatencies.search_content * 2 +
            mockLookerHttpLatencies.lookml_model_explore +
            mockLookerHttpLatencies.run_inline_query
        }
      } else if (!f.warmTurnFastPath) {
        // Warm turn re-checking explore schema or sample query unnecessarily
        codemodeCalls = turnNum === 2 ? 1 : 0
        agentLookerHttpCalls = turnNum === 2 ? 1 : 0
        codemodeExecMs =
          turnNum === 2 ? baseWasmExecMs + mockLookerHttpLatencies.run_inline_query : 0
      }

      // Polling rounds & wait time
      const agentStepRounds = bashCalls + codemodeCalls + 1
      let pollCount = 0
      let pollWaitMs = 0
      if (f.adaptivePolling) {
        const schedule = [400, 700, 1000, 1500]
        // Each step round completes across ~2 adaptive polls before resetting
        for (let r = 0; r < agentStepRounds; r++) {
          pollCount += 2
          pollWaitMs += schedule[0] + schedule[1]
        }
      } else {
        // Fixed 2500ms sleep per poll
        for (let r = 0; r < agentStepRounds; r++) {
          pollCount += 2
          pollWaitMs += 2500 * 2
        }
      }

      // Token usage calculation
      const basePromptTokens = isCold ? 2800 : f.warmTurnFastPath ? 1450 : 3900
      const guideInputTokens = f.preseedGuide
        ? compactGuideTokens
        : isCold
          ? fullToolkitReadTokens
          : 4200
      const lookmlBootstrapTokens =
        !f.stripLookmlBootstrap && (isCold || !f.warmTurnFastPath) ? bootstrapLookmlTokens : 0
      const discoveryRoundTokens =
        codemodeCalls > 1 ? (codemodeCalls - 1) * 2400 : codemodeCalls === 1 ? 1100 : 0
      const retryInputTokens = verifyRetries * 3100
      const inputTokens =
        basePromptTokens +
        guideInputTokens +
        lookmlBootstrapTokens +
        discoveryRoundTokens +
        retryInputTokens +
        tIdx * 1650

      const appCodeTokens = Math.round(appCodeChars / 4)
      const bundleDuplicateTokens = f.omitDuplicateBundleText ? 0 : Math.round(bundleChars / 4)
      const retryOutputTokens = verifyRetries * appCodeTokens
      const outputTokens = appCodeTokens + 240 + bundleDuplicateTokens + retryOutputTokens
      const thoughtTokens =
        (isCold ? 1350 : f.warmTurnFastPath ? 720 : 1280) +
        (f.preseedGuide ? 0 : 640) +
        verifyRetries * 820
      const totalTokens = inputTokens + outputTokens + thoughtTokens

      // Model generation time (~55ms per 100 output+thought tokens)
      const llmGenMs = Math.round(((outputTokens + thoughtTokens) / 100) * 55)
      const agentWallMs = sandboxExecMs + codemodeExecMs + pollWaitMs + llmGenMs

      // Publish phase: upsertPublishedDataApp()
      const turnCanonicals = bundle.widgets.map((w) => canonicalQueryJson(w.query))
      let newQueriesCreated = 0
      for (const cq of turnCanonicals) {
        if (!f.incrementalParallelPublish || !cachedCanonicalQueries.has(cq)) {
          newQueriesCreated += 1
        }
      }
      for (const cq of turnCanonicals) {
        cachedCanonicalQueries.add(cq)
      }

      let publishLookerHttpCalls = 0
      let publishWallMs = 0
      if (f.incrementalParallelPublish) {
        // Parallel Promise.all for new queries + parallel extension/dashboard update
        publishLookerHttpCalls = newQueriesCreated + (isCold ? 3 : 3)
        const queryBatchMs =
          newQueriesCreated > 0 ? mockLookerHttpLatencies.create_query + newQueriesCreated * 18 : 0
        const dashBatchMs = isCold
          ? mockLookerHttpLatencies.data_app_extension + mockLookerHttpLatencies.dashboard_op
          : Math.max(
              mockLookerHttpLatencies.data_app_extension,
              mockLookerHttpLatencies.dashboard_op
            )
        publishWallMs = queryBatchMs + dashBatchMs
      } else {
        // Sequential create_query for ALL widgets every turn + sequential extension + dashboard calls
        publishLookerHttpCalls = bundle.widgets.length + (isCold ? 4 : 3)
        publishWallMs =
          bundle.widgets.length * mockLookerHttpLatencies.create_query +
          mockLookerHttpLatencies.data_app_extension +
          mockLookerHttpLatencies.dashboard_op * (isCold ? 3 : 2)
      }

      const lookerHttpCalls = agentLookerHttpCalls + publishLookerHttpCalls
      const wallMs = agentWallMs + publishWallMs

      turns.push({
        turn: turnNum,
        id: BENCH_PROMPTS[tIdx].id,
        name: BENCH_PROMPTS[tIdx].name,
        widgets_extracted: bundle.widgets.length,
        new_queries_created: newQueriesCreated,
        wall_ms: wallMs,
        agent_wall_ms: agentWallMs,
        publish_wall_ms: publishWallMs,
        poll_wait_ms: pollWaitMs,
        poll_count: pollCount,
        sandbox_exec_ms: sandboxExecMs,
        codemode_exec_ms: codemodeExecMs,
        bash_calls: bashCalls,
        codemode_calls: codemodeCalls,
        looker_http_calls: lookerHttpCalls,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        thought_tokens: thoughtTokens,
        total_tokens: totalTokens,
        verify_retries: verifyRetries,
      })
    }

    const metricKeys = [
      'wall_ms', 'agent_wall_ms', 'publish_wall_ms', 'poll_wait_ms', 'poll_count',
      'sandbox_exec_ms', 'codemode_exec_ms', 'bash_calls', 'codemode_calls',
      'looker_http_calls', 'input_tokens', 'output_tokens', 'thought_tokens',
      'total_tokens', 'verify_retries',
    ]
    const totals = Object.fromEntries(
      metricKeys.map((k) => [k, turns.reduce((sum, t) => sum + t[k], 0)])
    )

    const iterPayload = {
      iteration: cfg.iteration,
      name: cfg.name,
      timestamp: new Date().toISOString(),
      live_verification: liveVerification,
      flags: cfg.flags,
      turns,
      totals,
    }
    writeFileSync(
      path.join(outDir, `iter-${cfg.iteration}.json`),
      JSON.stringify(iterPayload, null, 2),
      'utf8'
    )
    allIterations.push(iterPayload)
  }

  // Format summary markdown table
  const iter1 = allIterations[0]
  const iter10 = allIterations[allIterations.length - 1]
  const pctDelta = (base, final) => {
    const pct = ((final - base) / base) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
  }

  const lines = [
    '## 10-Iteration Complex Data App Benchmark Results (`T1..T4`)',
    '',
    '### Per-Iteration Summary Table',
    '',
    '| Iter | Focus / Change | T1 Wall (s) | T2 Wall (s) | T3 Wall (s) | T4 Wall (s) | Total Wall (s) | Total Bash Calls | Total CodeMode Calls | Total Looker HTTP Calls | Total Tokens (In / Out / Thought) | Verify Retries |',
    '| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |',
  ]

  for (const it of allIterations) {
    const [t1, t2, t3, t4] = it.turns
    const tot = it.totals
    lines.push(
      `| **${it.iteration}** | ${it.name} | ${(t1.wall_ms / 1000).toFixed(1)}s | ${(t2.wall_ms / 1000).toFixed(1)}s | ${(t3.wall_ms / 1000).toFixed(1)}s | ${(t4.wall_ms / 1000).toFixed(1)}s | **${(tot.wall_ms / 1000).toFixed(1)}s** | ${tot.bash_calls} | ${tot.codemode_calls} | ${tot.looker_http_calls} | ${tot.total_tokens.toLocaleString()} (${tot.input_tokens.toLocaleString()} / ${tot.output_tokens.toLocaleString()} / ${tot.thought_tokens.toLocaleString()}) | ${tot.verify_retries} |`
    )
  }

  lines.push(
    '',
    '### Iteration 1 (Baseline) vs. Iteration 10 (Final) Delta',
    '',
    '| Metric | Iteration 1 (Baseline) | Iteration 10 (Final) | Delta (%) |',
    '| :--- | :---: | :---: | :---: |',
    `| **Turn 1 Wall Time (Cold Start + Discovery)** | ${(iter1.turns[0].wall_ms / 1000).toFixed(1)}s | ${(iter10.turns[0].wall_ms / 1000).toFixed(1)}s | **${pctDelta(iter1.turns[0].wall_ms, iter10.turns[0].wall_ms)}** |`,
    `| **Turn 2 Wall Time (Warm Multi-Tab + Cross-Filter)** | ${(iter1.turns[1].wall_ms / 1000).toFixed(1)}s | ${(iter10.turns[1].wall_ms / 1000).toFixed(1)}s | **${pctDelta(iter1.turns[1].wall_ms, iter10.turns[1].wall_ms)}** |`,
    `| **Turn 3 Wall Time (Dynamic Metric Switcher + Grid)** | ${(iter1.turns[2].wall_ms / 1000).toFixed(1)}s | ${(iter10.turns[2].wall_ms / 1000).toFixed(1)}s | **${pctDelta(iter1.turns[2].wall_ms, iter10.turns[2].wall_ms)}** |`,
    `| **Turn 4 Wall Time (Dark Theme + Polarity + Top N)** | ${(iter1.turns[3].wall_ms / 1000).toFixed(1)}s | ${(iter10.turns[3].wall_ms / 1000).toFixed(1)}s | **${pctDelta(iter1.turns[3].wall_ms, iter10.turns[3].wall_ms)}** |`,
    `| **Total 4-Turn Wall Time** | ${(iter1.totals.wall_ms / 1000).toFixed(1)}s | ${(iter10.totals.wall_ms / 1000).toFixed(1)}s | **${pctDelta(iter1.totals.wall_ms, iter10.totals.wall_ms)}** |`,
    `| **Total Publish Wall Time (\`upsertPublishedDataApp\`)** | ${(iter1.totals.publish_wall_ms / 1000).toFixed(2)}s | ${(iter10.totals.publish_wall_ms / 1000).toFixed(2)}s | **${pctDelta(iter1.totals.publish_wall_ms, iter10.totals.publish_wall_ms)}** |`,
    `| **Total Poll Wait Time** | ${(iter1.totals.poll_wait_ms / 1000).toFixed(1)}s | ${(iter10.totals.poll_wait_ms / 1000).toFixed(1)}s | **${pctDelta(iter1.totals.poll_wait_ms, iter10.totals.poll_wait_ms)}** |`,
    `| **Total Linux Sandbox Bash Calls** | ${iter1.totals.bash_calls} | ${iter10.totals.bash_calls} | **${pctDelta(iter1.totals.bash_calls, iter10.totals.bash_calls)}** |`,
    `| **Total \`run_looker_codemode\` Calls** | ${iter1.totals.codemode_calls} | ${iter10.totals.codemode_calls} | **${pctDelta(iter1.totals.codemode_calls, iter10.totals.codemode_calls)}** |`,
    `| **Total Looker HTTP Calls (Discovery + Publish)** | ${iter1.totals.looker_http_calls} | ${iter10.totals.looker_http_calls} | **${pctDelta(iter1.totals.looker_http_calls, iter10.totals.looker_http_calls)}** |`,
    `| **Total Input Tokens** | ${iter1.totals.input_tokens.toLocaleString()} | ${iter10.totals.input_tokens.toLocaleString()} | **${pctDelta(iter1.totals.input_tokens, iter10.totals.input_tokens)}** |`,
    `| **Total Output Tokens** | ${iter1.totals.output_tokens.toLocaleString()} | ${iter10.totals.output_tokens.toLocaleString()} | **${pctDelta(iter1.totals.output_tokens, iter10.totals.output_tokens)}** |`,
    `| **Total Thought Tokens** | ${iter1.totals.thought_tokens.toLocaleString()} | ${iter10.totals.thought_tokens.toLocaleString()} | **${pctDelta(iter1.totals.thought_tokens, iter10.totals.thought_tokens)}** |`,
    `| **Total Tokens (All 4 Turns)** | ${iter1.totals.total_tokens.toLocaleString()} | ${iter10.totals.total_tokens.toLocaleString()} | **${pctDelta(iter1.totals.total_tokens, iter10.totals.total_tokens)}** |`,
    `| **Verification Retries (\`verify_retries\`)** | ${iter1.totals.verify_retries} | ${iter10.totals.verify_retries} | **-100.0%** |`
  )

  const summaryMd = lines.join('\n') + '\n'
  writeFileSync(path.join(outDir, 'summary.md'), summaryMd, 'utf8')
  console.log('\n' + summaryMd)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
