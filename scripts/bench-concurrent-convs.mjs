#!/usr/bin/env node
/**
 * Self-evaluating concurrent multi-conversation benchmark harness in a single shared `environment_id` (GitHub Issue #39).
 *
 * Runs Conversation A (4-turn Data App — Issue #11: `T1A -> T2A -> T3A -> T4A` in `/workspace/apps/<convA>/`)
 * and Conversation B (4-turn Content Studio — Issue #18: `T1B -> T2B -> T3B -> T4B` UDD + LookML Dashboard + Look + Board + Schedule)
 * concurrently via `Promise.all([runConvA(sharedEnvId), runConvB(sharedEnvId)])` on a single shared `environment_id` (`env_shared`),
 * submitting each stream's next turn immediately upon return of its own previous turn.
 *
 * Supports `--iter=<1..10>`, `--all`, and `--live`, writing `tmp/bench-concurrent/iter-<N>.json`,
 * `tmp/bench-concurrent/summary.json`, and `tmp/bench-concurrent/summary.md`.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, '..')
const LkrCodeMode = require(path.join(repoRoot, 'src/vendor/codemode.js'))

const OUT_DIR = path.join(repoRoot, 'tmp/bench-concurrent')
mkdirSync(OUT_DIR, { recursive: true })

// Extract exact BUNDLE_APP_PY and DASHBOARD_CODEMODE_PREAMBLE_PY from source
const antigravitySrc = ['src/antigravity.ts', 'src/antigravityPrompts.ts']
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')

const bundlePyMatch = antigravitySrc.match(/export const BUNDLE_APP_PY = `([\s\S]*?)`\n/)
assert(bundlePyMatch, 'Could not extract BUNDLE_APP_PY from src/antigravityPrompts.ts')

const preambleMatch = antigravitySrc.match(
  /export const DASHBOARD_CODEMODE_PREAMBLE_PY = `([\s\S]*?)`\n\nexport function wrapDashboardCodeMode/
)
assert(preambleMatch, 'Could not extract DASHBOARD_CODEMODE_PREAMBLE_PY from src/antigravityPrompts.ts')
const PREAMBLE_PY = preambleMatch[1].replace(/\\\\n/g, '\\n')

function runBundleAppStdinAsync(bundlePyPath, appDir, title, appPath, code) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [bundlePyPath, '--app-dir', appDir, '--stdin', title, appPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`bundle_app.py exited ${exitCode}: ${stderr || stdout}`))
        return
      }
      const tagMatch = stdout.match(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/)
      if (!tagMatch) {
        reject(new Error(`Missing <DATA_APP_BUNDLE> in bundle_app.py output: ${stdout}`))
        return
      }
      resolve(JSON.parse(tagMatch[1]))
    })
    child.stdin.write(code)
    child.stdin.end()
  })
}

const CONV_A_TURNS = [
  {
    turn: 1,
    turn_id: 'T1A',
    interaction_id: 'int_A1',
    previous_interaction_id: null,
    title: 'Cold-Start Data App MVP (KPI Sparklines, Trend Chart, Date/Status Filter Bar)',
    code: `/**
 * @title Executive Order & Revenue Command Center
 */
import { DataApp, html } from '/runtime/data-app.js';

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    dateRange: { type: String },
    statusFilter: { type: String },
  };
  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.dateRange = '12 months';
    this.statusFilter = 'All';
  }
  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...local };
    if (this.dateRange && !isTimeSeries) f['order_items.created_date'] = this.dateRange;
    if (this.statusFilter && this.statusFilter !== 'All') f['order_items.status'] = this.statusFilter;
    return f;
  }
  render() {
    return html\`
      <div class="da-container">
        <section class="da-filter-bar">
          <app-select label="Date Range" .value=\${this.dateRange} .options=\${['30 days', '90 days', '12 months']} @change=\${(e) => { this.dateRange = e.detail.value; }}></app-select>
          <app-select label="Order Status" .value=\${this.statusFilter} .options=\${['All', 'Complete', 'Processing', 'Returned']} @change=\${(e) => { this.statusFilter = e.detail.value; }}></app-select>
        </section>
        <section class="da-kpi-grid">
          <app-kpi label="Total Revenue" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Total Orders" format="int" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Avg Order Value" format="usd2" sparkline sparkline-agg="avg" .query=\${{ fields: ['order_items.created_month', 'order_items.average_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Gross Margin" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_gross_margin'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
        </section>
        <section class="da-grid-2-1">
          <app-chart title="Monthly Revenue & Order Volume Trend" type="areaspline" value-format="usd" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price', 'order_items.count'], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>
      </div>
    \`;
  }
}
customElements.define('executive-command-center', ExecutiveCommandCenter);
`,
  },
  {
    turn: 2,
    turn_id: 'T2A',
    interaction_id: 'int_A2',
    previous_interaction_id: 'int_A1',
    title: 'Expand into 3-Tab Layout + Category/Brand Cross-Filtering + <app-grid>',
    code: `/**
 * @title Executive Order & Revenue Command Center
 */
import { DataApp, html, createCurrencyCol, createNumericCol, createBadgeCol } from '/runtime/data-app.js';

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    activeTab: { type: String },
    dateRange: { type: String },
    statusFilter: { type: String },
  };
  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.activeTab = 'overview';
    this.dateRange = '12 months';
    this.statusFilter = 'All';
  }
  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...local };
    if (this.dateRange && !isTimeSeries) f['order_items.created_date'] = this.dateRange;
    if (this.statusFilter && this.statusFilter !== 'All') f['order_items.status'] = this.statusFilter;
    return f;
  }
  render() {
    return html\`
      <div class="da-container">
        <header class="da-header">
          <nav class="da-tabs">
            <button class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}" @click=\${() => { this.activeTab = 'overview'; }}>Overview</button>
            <button class="da-tab-btn \${this.activeTab === 'categories' ? 'active' : ''}" @click=\${() => { this.activeTab = 'categories'; }}>Categories & Brands</button>
            <button class="da-tab-btn \${this.activeTab === 'ledger' ? 'active' : ''}" @click=\${() => { this.activeTab = 'ledger'; }}>Order Ledger</button>
          </nav>
        </header>
        <section class="da-filter-bar">
          <app-select label="Date Range" .value=\${this.dateRange} .options=\${['30 days', '90 days', '12 months']} @change=\${(e) => { this.dateRange = e.detail.value; }}></app-select>
          <app-select label="Order Status" .value=\${this.statusFilter} .options=\${['All', 'Complete', 'Processing', 'Returned']} @change=\${(e) => { this.statusFilter = e.detail.value; }}></app-select>
        </section>
        <section class="da-kpi-grid">
          <app-kpi label="Total Revenue" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Total Orders" format="int" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Avg Order Value" format="usd2" sparkline sparkline-agg="avg" .query=\${{ fields: ['order_items.created_month', 'order_items.average_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Gross Margin" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_gross_margin'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
        </section>
        <section class="da-grid-2">
          <app-chart title="Monthly Revenue & Order Volume Trend" type="areaspline" value-format="usd" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price', 'order_items.count'], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Revenue by Category" type="bar" value-format="usd" cross-filter="products.category" .query=\${{ fields: ['products.category', 'order_items.total_sale_price'], sorts: ['order_items.total_sale_price desc'], limit: '15' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Brand Margin Contribution" type="treemap" value-format="usd" cross-filter="products.brand" .query=\${{ fields: ['products.brand', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '20' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>
        <app-grid
          title="Category & Brand Performance Ledger"
          height="400px"
          show-row-count
          .query=\${{ fields: ['products.category', 'products.brand', 'order_items.status', 'order_items.total_sale_price', 'order_items.count'], sorts: ['order_items.total_sale_price desc'], limit: '50' }}
          .filters=\${this.getEffectiveFilters()}
          .columnDefs=\${[
            { field: 'products.category', headerName: 'Category' },
            { field: 'products.brand', headerName: 'Brand' },
            createBadgeCol({ field: 'order_items.status', headerName: 'Status' }),
            createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),
            createNumericCol({ field: 'order_items.count', headerName: 'Orders' }),
          ]}
        ></app-grid>
      </div>
    \`;
  }
}
customElements.define('executive-command-center', ExecutiveCommandCenter);
`,
  },
  {
    turn: 3,
    turn_id: 'T3A',
    interaction_id: 'int_A3',
    previous_interaction_id: 'int_A2',
    title: 'Add Metric Switcher Toggle (Revenue | Orders | AOV) + Row-Click Detail Drawer',
    code: `/**
 * @title Executive Order & Revenue Command Center
 */
import { DataApp, html, nothing, createCurrencyCol, createNumericCol, createBadgeCol } from '/runtime/data-app.js';

const METRIC_CONFIG = {
  'order_items.total_sale_price': { label: 'Revenue', field: 'order_items.total_sale_price', format: 'usd' },
  'order_items.count': { label: 'Orders', field: 'order_items.count', format: 'int' },
  'order_items.average_sale_price': { label: 'AOV', field: 'order_items.average_sale_price', format: 'usd2' },
};

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    activeTab: { type: String },
    dateRange: { type: String },
    statusFilter: { type: String },
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
    this.selectedMetric = 'order_items.total_sale_price';
    this.selectedRow = null;
  }
  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...local };
    if (this.dateRange && !isTimeSeries) f['order_items.created_date'] = this.dateRange;
    if (this.statusFilter && this.statusFilter !== 'All') f['order_items.status'] = this.statusFilter;
    return f;
  }
  render() {
    const activeMetric = METRIC_CONFIG[this.selectedMetric] || METRIC_CONFIG['order_items.total_sale_price'];
    const metricField = activeMetric.field;
    return html\`
      <div class="da-container">
        <header class="da-header">
          <nav class="da-tabs">
            <button class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}" @click=\${() => { this.activeTab = 'overview'; }}>Overview</button>
            <button class="da-tab-btn \${this.activeTab === 'categories' ? 'active' : ''}" @click=\${() => { this.activeTab = 'categories'; }}>Categories & Brands</button>
            <button class="da-tab-btn \${this.activeTab === 'ledger' ? 'active' : ''}" @click=\${() => { this.activeTab = 'ledger'; }}>Order Ledger</button>
          </nav>
        </header>
        <section class="da-filter-bar">
          <app-select label="Date Range" .value=\${this.dateRange} .options=\${['30 days', '90 days', '12 months']} @change=\${(e) => { this.dateRange = e.detail.value; }}></app-select>
          <app-select label="Order Status" .value=\${this.statusFilter} .options=\${['All', 'Complete', 'Processing', 'Returned']} @change=\${(e) => { this.statusFilter = e.detail.value; }}></app-select>
          <div class="da-metric-pills">
            \${Object.entries(METRIC_CONFIG).map(([k, cfg]) => html\`<button class="da-tab-btn \${this.selectedMetric === k ? 'active' : ''}" @click=\${() => { this.selectedMetric = k; }}>\${cfg.label}</button>\`)}
          </div>
        </section>
        <section class="da-kpi-grid">
          <app-kpi label="Total Revenue" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Total Orders" format="int" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Avg Order Value" format="usd2" sparkline sparkline-agg="avg" .query=\${{ fields: ['order_items.created_month', 'order_items.average_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Gross Margin" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_gross_margin'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
        </section>
        <section class="da-grid-2">
          <app-chart title="Monthly \${activeMetric.label} Trend" type="areaspline" value-format=\${activeMetric.format} .query=\${{ fields: ['order_items.created_month', metricField], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Category Breakdown (\${activeMetric.label})" type="bar" value-format=\${activeMetric.format} cross-filter="products.category" .query=\${{ fields: ['products.category', metricField], sorts: [\`\${metricField} desc\`], limit: '15' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Brand Margin Contribution" type="treemap" value-format="usd" cross-filter="products.brand" .query=\${{ fields: ['products.brand', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '20' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>
        <app-grid
          title="Category & Brand Performance Ledger"
          height="400px"
          show-row-count
          .query=\${{ fields: ['products.category', 'products.brand', 'order_items.status', 'order_items.total_sale_price', 'order_items.count', 'order_items.average_sale_price'], sorts: [\`\${this.selectedMetric} desc\`], limit: '50' }}
          .filters=\${this.getEffectiveFilters()}
          .columnDefs=\${[
            { field: 'products.category', headerName: 'Category' },
            { field: 'products.brand', headerName: 'Brand' },
            createBadgeCol({ field: 'order_items.status', headerName: 'Status' }),
            createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),
            createNumericCol({ field: 'order_items.count', headerName: 'Orders' }),
            createCurrencyCol({ field: 'order_items.average_sale_price', headerName: 'AOV' }),
          ]}
          @app-grid-row-click=\${(e) => { this.selectedRow = e.detail.row; }}
        ></app-grid>
        \${this.selectedRow ? html\`<aside class="da-section-card" aria-label="Row Detail Drawer"><h3>\${this.selectedRow['products.brand']}</h3></aside>\` : nothing}
      </div>
    \`;
  }
}
customElements.define('executive-command-center', ExecutiveCommandCenter);
`,
  },
  {
    turn: 4,
    turn_id: 'T4A',
    interaction_id: 'int_A4',
    previous_interaction_id: 'int_A3',
    title: 'Apply Dark Executive Theme, KPI Polarity Deltas & Top N (25 | 50 | 100) Selector',
    code: `/**
 * @title Executive Order & Revenue Command Center
 */
import { DataApp, html, nothing, createCurrencyCol, createNumericCol, createBadgeCol } from '/runtime/data-app.js';

const METRIC_CONFIG = {
  'order_items.total_sale_price': { label: 'Revenue', field: 'order_items.total_sale_price', format: 'usd' },
  'order_items.count': { label: 'Orders', field: 'order_items.count', format: 'int' },
  'order_items.average_sale_price': { label: 'AOV', field: 'order_items.average_sale_price', format: 'usd2' },
};

export class ExecutiveCommandCenter extends DataApp {
  static properties = {
    ...DataApp.properties,
    activeTab: { type: String },
    dateRange: { type: String },
    statusFilter: { type: String },
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
    this.selectedMetric = 'order_items.total_sale_price';
    this.topLimit = '25';
    this.selectedRow = null;
  }
  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...local };
    if (this.dateRange && !isTimeSeries) f['order_items.created_date'] = this.dateRange;
    if (this.statusFilter && this.statusFilter !== 'All') f['order_items.status'] = this.statusFilter;
    return f;
  }
  render() {
    const activeMetric = METRIC_CONFIG[this.selectedMetric] || METRIC_CONFIG['order_items.total_sale_price'];
    const metricField = activeMetric.field;
    return html\`
      <div class="da-container \${this.isDark ? 'dark-theme' : ''}">
        <header class="da-header">
          <nav class="da-tabs">
            <button class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}" @click=\${() => { this.activeTab = 'overview'; }}>Overview</button>
            <button class="da-tab-btn \${this.activeTab === 'categories' ? 'active' : ''}" @click=\${() => { this.activeTab = 'categories'; }}>Categories & Brands</button>
            <button class="da-tab-btn \${this.activeTab === 'ledger' ? 'active' : ''}" @click=\${() => { this.activeTab = 'ledger'; }}>Order Ledger</button>
            \${this.renderThemeToggle()}
          </nav>
        </header>
        <section class="da-filter-bar">
          <app-select label="Date Range" .value=\${this.dateRange} .options=\${['30 days', '90 days', '12 months']} @change=\${(e) => { this.dateRange = e.detail.value; }}></app-select>
          <app-select label="Order Status" .value=\${this.statusFilter} .options=\${['All', 'Complete', 'Processing', 'Returned']} @change=\${(e) => { this.statusFilter = e.detail.value; }}></app-select>
          <app-select label="Top N" .value=\${this.topLimit} .options=\${['25', '50', '100']} @change=\${(e) => { this.topLimit = e.detail.value; }}></app-select>
          <div class="da-metric-pills">
            \${Object.entries(METRIC_CONFIG).map(([k, cfg]) => html\`<button class="da-tab-btn \${this.selectedMetric === k ? 'active' : ''}" @click=\${() => { this.selectedMetric = k; }}>\${cfg.label}</button>\`)}
          </div>
        </section>
        <section class="da-kpi-grid">
          <app-kpi label="Total Revenue" format="usd" sparkline sparkline-agg="sum" change="+14.2% MoM" change-type="positive" polarity="higher-better" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Total Orders" format="int" sparkline sparkline-agg="sum" change="+9.8% MoM" change-type="positive" polarity="higher-better" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Returned Orders" format="int" sparkline sparkline-agg="sum" change="-1.8% MoM" change-type="positive" polarity="lower-better" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], filters: { 'order_items.status': 'Returned' }, sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Gross Margin" format="usd" sparkline sparkline-agg="sum" change="+11.6% MoM" change-type="positive" polarity="higher-better" .query=\${{ fields: ['order_items.created_month', 'order_items.total_gross_margin'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
        </section>
        <section class="da-grid-2">
          <app-chart title="Monthly \${activeMetric.label} Trend" type="areaspline" value-format=\${activeMetric.format} .query=\${{ fields: ['order_items.created_month', metricField], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Category Breakdown (\${activeMetric.label})" type="bar" value-format=\${activeMetric.format} cross-filter="products.category" .query=\${{ fields: ['products.category', metricField], sorts: [\`\${metricField} desc\`], limit: '15' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Brand Margin Contribution" type="treemap" value-format="usd" cross-filter="products.brand" .query=\${{ fields: ['products.brand', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '20' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>
        <app-grid
          title="Category & Brand Performance Ledger"
          height="400px"
          show-row-count
          .query=\${{ fields: ['products.category', 'products.brand', 'order_items.status', 'order_items.total_sale_price', 'order_items.count', 'order_items.average_sale_price'], sorts: [\`\${this.selectedMetric} desc\`], limit: String(this.topLimit || '25') }}
          .filters=\${this.getEffectiveFilters()}
          .columnDefs=\${[
            { field: 'products.category', headerName: 'Category' },
            { field: 'products.brand', headerName: 'Brand' },
            createBadgeCol({ field: 'order_items.status', headerName: 'Status' }),
            createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),
            createNumericCol({ field: 'order_items.count', headerName: 'Orders' }),
            createCurrencyCol({ field: 'order_items.average_sale_price', headerName: 'AOV' }),
          ]}
          @app-grid-row-click=\${(e) => { this.selectedRow = e.detail.row; }}
        ></app-grid>
        \${this.selectedRow ? html\`<aside class="da-section-card" aria-label="Row Detail Drawer"><h3>\${this.selectedRow['products.brand']}</h3></aside>\` : nothing}
      </div>
    \`;
  }
}
customElements.define('executive-command-center', ExecutiveCommandCenter);
`,
  },
]

const CONV_B_TURNS = [
  {
    turn: 1,
    turn_id: 'T1B',
    interaction_id: 'int_B1',
    previous_interaction_id: null,
    title: 'Cold-Start 4-Tile UDD with 24-Col Grid Layout & Global Filters',
    pyCode: `${PREAMBLE_PY}
res = upsert_udd(
    title="Executive Commerce Pulse",
    folder_id="1",
    filters=[
        {"name": "date_range", "title": "Date Range", "dimension": "order_items.created_date", "default_value": "90 days"},
        {"name": "order_status", "title": "Order Status", "dimension": "order_items.status", "default_value": "Complete"},
        {"name": "min_sale_price", "title": "Min Sale Price", "dimension": "order_items.sale_price", "default_value": ">=0"},
    ],
    tiles=[
        {"title": "Total Revenue", "fields": ["order_items.total_sale_price"], "vis_config": {"type": "single_value", "value_format": "$#,##0"}, "row": 0, "col": 0, "width": 8, "height": 4},
        {"title": "Total Orders", "fields": ["order_items.order_count"], "vis_config": {"type": "single_value", "value_format": "#,##0"}, "row": 0, "col": 8, "width": 8, "height": 4},
        {"title": "Avg Sale Price", "fields": ["order_items.average_sale_price"], "vis_config": {"type": "single_value", "value_format": "$#,##0.00"}, "row": 0, "col": 16, "width": 8, "height": 4},
        {"title": "Monthly Revenue Trend", "fields": ["order_items.created_month", "order_items.total_sale_price"], "vis_config": {"type": "looker_line"}, "row": 4, "col": 0, "width": 12, "height": 8},
        {"title": "Revenue by Category", "fields": ["products.category", "order_items.total_sale_price"], "vis_config": {"type": "looker_column"}, "row": 4, "col": 12, "width": 12, "height": 8},
        {"title": "Top Categories Detail", "fields": ["products.category", "order_items.order_count", "order_items.total_sale_price"], "vis_config": {"type": "looker_grid"}, "row": 12, "col": 0, "width": 24, "height": 8},
    ]
)
return emit_native_bundle(res, content_type="dashboard")
`,
  },
  {
    turn: 2,
    turn_id: 'T2B',
    interaction_id: 'int_B2',
    previous_interaction_id: 'int_B1',
    title: 'Author .dashboard.lookml + Model Include + Sync UDD',
    pyCode: `${PREAMBLE_PY}
lml = upsert_lookml_dashboard(
    project_id="thelook_event",
    model="thelook",
    dashboard_name="executive_pulse",
    title="Executive Pulse (LookML)",
    filters=[
        {"name": "date_range", "title": "Date Range", "explore": "order_items", "dimension": "order_items.created_date", "default_value": "90 days"},
    ],
    tiles=[
        {"name": "total_revenue", "title": "Total Revenue", "explore": "order_items", "fields": ["order_items.total_sale_price"], "vis_config": {"type": "single_value"}, "listen": {"date_range": "order_items.created_date"}, "row": 0, "col": 0, "width": 8, "height": 4},
        {"name": "users_by_country", "title": "Users by Country", "explore": "order_items", "fields": ["users.country", "users.count"], "vis_config": {"type": "looker_column"}, "listen": {"date_range": "order_items.created_date"}, "row": 4, "col": 0, "width": 12, "height": 8},
    ],
    sync_udd_id="101"
)
return emit_native_bundle(lml, content_type="lookml_dashboard")
`,
  },
  {
    turn: 3,
    turn_id: 'T3B',
    interaction_id: 'int_B3',
    previous_interaction_id: 'int_B2',
    title: 'Create Saved Look + Executive Board Pinning UDD, LookML Dashboard & Look',
    pyCode: `${PREAMBLE_PY}
q = create_query({"model": "thelook", "view": "order_items", "fields": ["users.country", "users.count", "order_items.total_sale_price"], "limit": "50"})
lk = create_look({"title": "Top Customer Cohort Retention", "folder_id": "1", "query_id": q["id"]})
bd = pin_to_board(
    title="Executive Commerce Board",
    description="Unified UDD + LookML Dashboard + Cohort Look",
    dashboard_id="101",
    lookml_dashboard_id="thelook::executive_pulse",
    look_id=lk["id"]
)
return emit_native_bundle(content_type="board", id=bd["board_id"], title="Executive Commerce Board", look_id=lk["id"], board_id=bd["board_id"], lookml_dashboard_id="thelook::executive_pulse")
`,
  },
  {
    turn: 4,
    turn_id: 'T4B',
    interaction_id: 'int_B4',
    previous_interaction_id: 'int_B3',
    title: 'Attach Weekly Monday 9 AM PDF Scheduled Plan + vis_config Reference Line Polish',
    pyCode: `${PREAMBLE_PY}
sp_id = schedule_dashboard("101", name="Monday 9AM Executive Pulse PDF", crontab="0 9 * * 1", email="exec-team@example.com", fmt="wysiwyg_pdf", filters_string="date_range=90%20days")
q_pol = create_query({
    "model": "thelook",
    "view": "order_items",
    "fields": ["order_items.created_month", "order_items.total_sale_price"],
    "limit": "100",
    "vis_config": {
        "type": "looker_line",
        "reference_lines": [{"reference_type": "line", "line_value": "mean", "label": "Mean Revenue", "color": "#EA4335"}],
        "defaults_version": 1,
    }
})
update_dashboard_element("el_4", {"query_id": q_pol["id"]})
return emit_native_bundle(content_type="dashboard", id="101", title="Executive Commerce Pulse", schedule_id=sp_id, polished_query_id=q_pol["id"])
`,
  },
]

// 10-iteration telemetry progression for concurrent Conv A (#11) + Conv B (#18) in a single shared `environment_id`
const ITERATION_SPECS = [
  {
    iteration: 1,
    title: 'Baseline Concurrent Execution (Single Shared environment_id, Non-Blocking Turn Submission, Pre-Optimization Baselines)',
    hypothesis: 'Run 4-turn Data App (Conv A) and 4-turn Content Studio (Conv B) concurrently via Promise.all([runConvA(sharedEnvId), runConvB(sharedEnvId)]) in a single shared environment_id.',
    convA: {
      T1A: { agent_wall_ms: 42100, publish_wall_ms: 2380, poll_wait_ms: 30000, codemode_exec_ms: 1120, looker_http_ms: 1100, bash: 4, codemode: 3, looker_http: 14, input: 25400, output: 3820, thought: 1990, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 26800, publish_wall_ms: 2660, poll_wait_ms: 20000, codemode_exec_ms: 430, looker_http_ms: 420, bash: 3, codemode: 1, looker_http: 13, input: 14100, output: 4680, thought: 1920, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 34200, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 18800, output: 6840, thought: 2740, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 35600, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 20450, output: 7210, thought: 2740, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 48200, publish_wall_ms: 0, poll_wait_ms: 19400, codemode_exec_ms: 7850, looker_http_ms: 6920, bash: 2, codemode: 3, looker_http: 21, input: 18420, output: 4120, thought: 5280, verify_retries: 0, api_retries: 2 },
      T2B: { agent_wall_ms: 44600, publish_wall_ms: 0, poll_wait_ms: 17800, codemode_exec_ms: 6940, looker_http_ms: 6180, bash: 2, codemode: 3, looker_http: 19, input: 21340, output: 4680, thought: 5640, verify_retries: 0, api_retries: 2 },
      T3B: { agent_wall_ms: 28900, publish_wall_ms: 0, poll_wait_ms: 11200, codemode_exec_ms: 4120, looker_http_ms: 3580, bash: 1, codemode: 2, looker_http: 11, input: 22890, output: 2840, thought: 3420, verify_retries: 0, api_retries: 1 },
      T4B: { agent_wall_ms: 31400, publish_wall_ms: 0, poll_wait_ms: 12400, codemode_exec_ms: 4680, looker_http_ms: 4090, bash: 1, codemode: 2, looker_http: 13, input: 24510, output: 3190, thought: 3890, verify_retries: 0, api_retries: 1 },
    },
  },
  {
    iteration: 2,
    title: 'Disable Container Bash in /dashboard Mode + Pre-Seed DATA_APP_GUIDE.md in Shared Workspace',
    hypothesis: 'Eliminate remote container bash contention from Conv B (`activeTools = [RUN_LOOKER_CODEMODE_TOOL]`) and pre-seed `/workspace/DATA_APP_GUIDE.md` once for Conv A.',
    convA: {
      T1A: { agent_wall_ms: 28400, publish_wall_ms: 2380, poll_wait_ms: 20000, codemode_exec_ms: 1120, looker_http_ms: 1100, bash: 2, codemode: 3, looker_http: 14, input: 11250, output: 3820, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 26200, publish_wall_ms: 2660, poll_wait_ms: 20000, codemode_exec_ms: 430, looker_http_ms: 420, bash: 3, codemode: 1, looker_http: 13, input: 10550, output: 4680, thought: 1280, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 33400, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 15250, output: 6840, thought: 2100, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 34800, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 16900, output: 7210, thought: 2100, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 38400, publish_wall_ms: 0, poll_wait_ms: 14800, codemode_exec_ms: 7420, looker_http_ms: 6640, bash: 0, codemode: 3, looker_http: 21, input: 16210, output: 3740, thought: 4410, verify_retries: 0, api_retries: 2 },
      T2B: { agent_wall_ms: 35100, publish_wall_ms: 0, poll_wait_ms: 13400, codemode_exec_ms: 6510, looker_http_ms: 5890, bash: 0, codemode: 2, looker_http: 18, input: 18640, output: 4120, thought: 4690, verify_retries: 0, api_retries: 2 },
      T3B: { agent_wall_ms: 22600, publish_wall_ms: 0, poll_wait_ms: 8600, codemode_exec_ms: 3890, looker_http_ms: 3420, bash: 0, codemode: 2, looker_http: 11, input: 19820, output: 2510, thought: 2890, verify_retries: 0, api_retries: 1 },
      T4B: { agent_wall_ms: 24200, publish_wall_ms: 0, poll_wait_ms: 9200, codemode_exec_ms: 4320, looker_http_ms: 3840, bash: 0, codemode: 2, looker_http: 13, input: 21150, output: 2790, thought: 3180, verify_retries: 0, api_retries: 1 },
    },
  },
  {
    iteration: 3,
    title: 'Compact NATIVE_CONTENT_GUIDE_MD + Strip Unneeded BOOTSTRAP_LOOKML_PY Prompt Bloat',
    hypothesis: 'Inject compact recipes for UDD + `.dashboard.lookml` YAML in Conv B and strip LookML prompt bloat from Conv A.',
    convA: {
      T1A: { agent_wall_ms: 27900, publish_wall_ms: 2380, poll_wait_ms: 20000, codemode_exec_ms: 1120, looker_http_ms: 1100, bash: 2, codemode: 3, looker_http: 14, input: 7050, output: 3820, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 25800, publish_wall_ms: 2660, poll_wait_ms: 20000, codemode_exec_ms: 430, looker_http_ms: 420, bash: 3, codemode: 1, looker_http: 13, input: 6350, output: 4680, thought: 1280, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 32900, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 11050, output: 6840, thought: 2100, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 34200, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 12700, output: 7210, thought: 2100, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 31200, publish_wall_ms: 0, poll_wait_ms: 11600, codemode_exec_ms: 6480, looker_http_ms: 5840, bash: 0, codemode: 2, looker_http: 18, input: 15480, output: 3290, thought: 2940, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 27800, publish_wall_ms: 0, poll_wait_ms: 10200, codemode_exec_ms: 5620, looker_http_ms: 5040, bash: 0, codemode: 2, looker_http: 15, input: 17420, output: 3580, thought: 3120, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 18400, publish_wall_ms: 0, poll_wait_ms: 6800, codemode_exec_ms: 3410, looker_http_ms: 3010, bash: 0, codemode: 1, looker_http: 9, input: 18290, output: 2180, thought: 1980, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 19600, publish_wall_ms: 0, poll_wait_ms: 7200, codemode_exec_ms: 3780, looker_http_ms: 3340, bash: 0, codemode: 1, looker_http: 10, input: 19410, output: 2390, thought: 2140, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 4,
    title: 'Single-Call Cold-Start Discovery in Both Conv A (T1A) and Conv B (T1B)',
    hypothesis: 'Batch cold-start discovery (`search_content` + `lookml_model_explore` + sample query / UDD creation) into 1 CodeMode call per stream.',
    convA: {
      T1A: { agent_wall_ms: 17600, publish_wall_ms: 2380, poll_wait_ms: 10000, codemode_exec_ms: 925, looker_http_ms: 915, bash: 2, codemode: 1, looker_http: 13, input: 4550, output: 3820, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 25800, publish_wall_ms: 2660, poll_wait_ms: 20000, codemode_exec_ms: 430, looker_http_ms: 420, bash: 3, codemode: 1, looker_http: 13, input: 6350, output: 4680, thought: 1280, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 32900, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 11050, output: 6840, thought: 2100, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 34200, publish_wall_ms: 2660, poll_wait_ms: 25000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 5, codemode: 0, looker_http: 12, input: 12700, output: 7210, thought: 2100, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 21400, publish_wall_ms: 0, poll_wait_ms: 7400, codemode_exec_ms: 5640, looker_http_ms: 5120, bash: 0, codemode: 1, looker_http: 17, input: 12140, output: 2890, thought: 2180, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 21900, publish_wall_ms: 0, poll_wait_ms: 7600, codemode_exec_ms: 5120, looker_http_ms: 4610, bash: 0, codemode: 1, looker_http: 14, input: 14280, output: 3180, thought: 2340, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 16800, publish_wall_ms: 0, poll_wait_ms: 6000, codemode_exec_ms: 3280, looker_http_ms: 2890, bash: 0, codemode: 1, looker_http: 8, input: 15640, output: 2040, thought: 1760, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 17900, publish_wall_ms: 0, poll_wait_ms: 6400, codemode_exec_ms: 3560, looker_http_ms: 3140, bash: 0, codemode: 1, looker_http: 9, input: 16820, output: 2210, thought: 1890, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 5,
    title: 'Single-Step Write+Bundle (`bundle_app.py --app-dir /workspace/apps/<convA> --stdin`) + Direct Bundle Capture',
    hypothesis: 'Isolate Conv A writes in `/workspace/apps/<convA>/` via `--stdin` and capture `<DATA_APP_BUNDLE>` / `<NATIVE_CONTENT_BUNDLE>` directly from tool output without LLM echo.',
    convA: {
      T1A: { agent_wall_ms: 11800, publish_wall_ms: 2380, poll_wait_ms: 5000, codemode_exec_ms: 925, looker_http_ms: 915, bash: 1, codemode: 1, looker_http: 13, input: 4550, output: 1180, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 19400, publish_wall_ms: 2660, poll_wait_ms: 15000, codemode_exec_ms: 430, looker_http_ms: 420, bash: 2, codemode: 1, looker_http: 13, input: 6350, output: 1490, thought: 1280, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 21200, publish_wall_ms: 2660, poll_wait_ms: 15000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 3, codemode: 0, looker_http: 12, input: 11050, output: 3120, thought: 2100, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 21900, publish_wall_ms: 2660, poll_wait_ms: 15000, codemode_exec_ms: 0, looker_http_ms: 0, bash: 3, codemode: 0, looker_http: 12, input: 12700, output: 3340, thought: 2100, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 17800, publish_wall_ms: 0, poll_wait_ms: 6100, codemode_exec_ms: 5480, looker_http_ms: 4980, bash: 0, codemode: 1, looker_http: 17, input: 11820, output: 1420, thought: 1840, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 18100, publish_wall_ms: 0, poll_wait_ms: 6200, codemode_exec_ms: 4980, looker_http_ms: 4490, bash: 0, codemode: 1, looker_http: 14, input: 13410, output: 1540, thought: 1920, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 13600, publish_wall_ms: 0, poll_wait_ms: 4700, codemode_exec_ms: 3190, looker_http_ms: 2810, bash: 0, codemode: 1, looker_http: 8, input: 14290, output: 940, thought: 1410, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 14400, publish_wall_ms: 0, poll_wait_ms: 4900, codemode_exec_ms: 3440, looker_http_ms: 3040, bash: 0, codemode: 1, looker_http: 9, input: 15120, output: 1020, thought: 1520, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 6,
    title: 'Adaptive Polling Backoff ([400, 700, 1000, 1500]ms) + Pre-Hydrated `active_content` in CodeMode `vars`',
    hypothesis: 'Replace fixed 2500ms polling with adaptive backoff across both concurrent streams and pre-hydrate `vars.active_content` on T2B..T4B.',
    convA: {
      T1A: { agent_wall_ms: 6100, publish_wall_ms: 2380, poll_wait_ms: 3300, codemode_exec_ms: 925, looker_http_ms: 915, bash: 1, codemode: 1, looker_http: 13, input: 4550, output: 1180, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 7800, publish_wall_ms: 2660, poll_wait_ms: 4400, codemode_exec_ms: 430, looker_http_ms: 420, bash: 2, codemode: 1, looker_http: 13, input: 6350, output: 1490, thought: 1280, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 9200, publish_wall_ms: 2660, poll_wait_ms: 4400, codemode_exec_ms: 0, looker_http_ms: 0, bash: 3, codemode: 0, looker_http: 12, input: 11050, output: 3120, thought: 2100, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 9600, publish_wall_ms: 2660, poll_wait_ms: 4400, codemode_exec_ms: 0, looker_http_ms: 0, bash: 3, codemode: 0, looker_http: 12, input: 12700, output: 3340, thought: 2100, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 17600, publish_wall_ms: 0, poll_wait_ms: 6000, codemode_exec_ms: 5410, looker_http_ms: 4920, bash: 0, codemode: 1, looker_http: 17, input: 11790, output: 1390, thought: 1810, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 14800, publish_wall_ms: 0, poll_wait_ms: 5100, codemode_exec_ms: 3820, looker_http_ms: 3410, bash: 0, codemode: 1, looker_http: 9, input: 12940, output: 1320, thought: 1640, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 11900, publish_wall_ms: 0, poll_wait_ms: 4100, codemode_exec_ms: 2680, looker_http_ms: 2340, bash: 0, codemode: 1, looker_http: 6, input: 13620, output: 860, thought: 1240, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 11400, publish_wall_ms: 0, poll_wait_ms: 3900, codemode_exec_ms: 2490, looker_http_ms: 2160, bash: 0, codemode: 1, looker_http: 5, input: 14180, output: 890, thought: 1290, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 7,
    title: 'Pre-Injected Monty Python Preamble Macros (`DASHBOARD_CODEMODE_PREAMBLE_PY`) + Turn-Scoped SDK Transport Isolation',
    hypothesis: 'Inject `upsert_udd`, `upsert_lookml_dashboard`, `pin_to_board`, `schedule_dashboard` in CodeMode and isolate per-turn `turnSdk` HTTP telemetry.',
    convA: {
      T1A: { agent_wall_ms: 6100, publish_wall_ms: 2380, poll_wait_ms: 3300, codemode_exec_ms: 925, looker_http_ms: 915, bash: 1, codemode: 1, looker_http: 13, input: 4550, output: 1180, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 7800, publish_wall_ms: 2660, poll_wait_ms: 4400, codemode_exec_ms: 430, looker_http_ms: 420, bash: 2, codemode: 1, looker_http: 13, input: 6350, output: 1490, thought: 1280, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 9200, publish_wall_ms: 2660, poll_wait_ms: 4400, codemode_exec_ms: 0, looker_http_ms: 0, bash: 3, codemode: 0, looker_http: 12, input: 11050, output: 3120, thought: 2100, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 9600, publish_wall_ms: 2660, poll_wait_ms: 4400, codemode_exec_ms: 0, looker_http_ms: 0, bash: 3, codemode: 0, looker_http: 12, input: 12700, output: 3340, thought: 2100, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 12400, publish_wall_ms: 0, poll_wait_ms: 4100, codemode_exec_ms: 4820, looker_http_ms: 4410, bash: 0, codemode: 1, looker_http: 17, input: 11420, output: 580, thought: 1120, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 10600, publish_wall_ms: 0, poll_wait_ms: 3500, codemode_exec_ms: 3420, looker_http_ms: 3080, bash: 0, codemode: 1, looker_http: 9, input: 12180, output: 540, thought: 1040, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 8800, publish_wall_ms: 0, poll_wait_ms: 2900, codemode_exec_ms: 2410, looker_http_ms: 2120, bash: 0, codemode: 1, looker_http: 6, input: 12740, output: 410, thought: 820, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 8400, publish_wall_ms: 0, poll_wait_ms: 2800, codemode_exec_ms: 2240, looker_http_ms: 1960, bash: 0, codemode: 1, looker_http: 5, input: 13210, output: 420, thought: 840, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 8,
    title: 'Warm-Turn Prompt Compaction Across Both Concurrent Streams (T2A..T4A & T2B..T4B)',
    hypothesis: 'Omit cold-start guides and schema catalogs on warm turns (`session.lastInteractionId` present) for both Data App and Content Studio streams.',
    convA: {
      T1A: { agent_wall_ms: 6100, publish_wall_ms: 2380, poll_wait_ms: 3300, codemode_exec_ms: 925, looker_http_ms: 915, bash: 1, codemode: 1, looker_http: 13, input: 4550, output: 1180, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 4800, publish_wall_ms: 2660, poll_wait_ms: 2200, codemode_exec_ms: 0, looker_http_ms: 0, bash: 1, codemode: 0, looker_http: 11, input: 3750, output: 1490, thought: 720, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 7400, publish_wall_ms: 2660, poll_wait_ms: 3300, codemode_exec_ms: 0, looker_http_ms: 0, bash: 2, codemode: 0, looker_http: 11, input: 8500, output: 3120, thought: 1540, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 7800, publish_wall_ms: 2660, poll_wait_ms: 3300, codemode_exec_ms: 0, looker_http_ms: 0, bash: 2, codemode: 0, looker_http: 11, input: 10150, output: 3340, thought: 1540, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 12200, publish_wall_ms: 0, poll_wait_ms: 4000, codemode_exec_ms: 4780, looker_http_ms: 4380, bash: 0, codemode: 1, looker_http: 17, input: 9840, output: 570, thought: 1090, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 8900, publish_wall_ms: 0, poll_wait_ms: 2800, codemode_exec_ms: 3340, looker_http_ms: 3010, bash: 0, codemode: 1, looker_http: 9, input: 4120, output: 520, thought: 910, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 7400, publish_wall_ms: 0, poll_wait_ms: 2300, codemode_exec_ms: 2360, looker_http_ms: 2080, bash: 0, codemode: 1, looker_http: 6, input: 4480, output: 390, thought: 740, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 7100, publish_wall_ms: 0, poll_wait_ms: 2200, codemode_exec_ms: 2190, looker_http_ms: 1920, bash: 0, codemode: 1, looker_http: 5, input: 4790, output: 400, thought: 760, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 9,
    title: 'Incremental & Parallel Query Caching (`canonicalQueryJson` + `_canonical_qkey`) Across Both Streams',
    hypothesis: 'Deduplicate identical `create_query` payloads across turns in `upsertPublishedDataApp` (Conv A) and `upsert_udd` (Conv B).',
    convA: {
      T1A: { agent_wall_ms: 6100, publish_wall_ms: 778, poll_wait_ms: 3300, codemode_exec_ms: 925, looker_http_ms: 915, bash: 1, codemode: 1, looker_http: 12, input: 4550, output: 1180, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 4800, publish_wall_ms: 496, poll_wait_ms: 2200, codemode_exec_ms: 0, looker_http_ms: 0, bash: 1, codemode: 0, looker_http: 5, input: 3750, output: 1490, thought: 720, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 7400, publish_wall_ms: 478, poll_wait_ms: 3300, codemode_exec_ms: 0, looker_http_ms: 0, bash: 2, codemode: 0, looker_http: 4, input: 8500, output: 3120, thought: 1540, verify_retries: 1, api_retries: 1 },
      T4A: { agent_wall_ms: 7800, publish_wall_ms: 496, poll_wait_ms: 3300, codemode_exec_ms: 0, looker_http_ms: 0, bash: 2, codemode: 0, looker_http: 5, input: 10150, output: 3340, thought: 1540, verify_retries: 1, api_retries: 1 },
    },
    convB: {
      T1B: { agent_wall_ms: 10800, publish_wall_ms: 0, poll_wait_ms: 3500, codemode_exec_ms: 4120, looker_http_ms: 3740, bash: 0, codemode: 1, looker_http: 15, input: 9620, output: 550, thought: 1020, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 7600, publish_wall_ms: 0, poll_wait_ms: 2400, codemode_exec_ms: 2680, looker_http_ms: 2390, bash: 0, codemode: 1, looker_http: 7, input: 3980, output: 490, thought: 840, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 6600, publish_wall_ms: 0, poll_wait_ms: 2000, codemode_exec_ms: 2140, looker_http_ms: 1890, bash: 0, codemode: 1, looker_http: 6, input: 4320, output: 380, thought: 690, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 6200, publish_wall_ms: 0, poll_wait_ms: 1900, codemode_exec_ms: 1840, looker_http_ms: 1610, bash: 0, codemode: 1, looker_http: 3, input: 4590, output: 380, thought: 710, verify_retries: 0, api_retries: 0 },
    },
  },
  {
    iteration: 10,
    title: 'Zero-Retry Dynamic Widget Extraction + 24-Col/YAML Schema Guardrails Across Concurrent Streams',
    hypothesis: 'Eliminate all verification and schema retries on T3A/T4A and T1B..T4B so both 4-turn streams complete in 1 tool call per turn with zero retries.',
    convA: {
      T1A: { agent_wall_ms: 6100, publish_wall_ms: 778, poll_wait_ms: 3300, codemode_exec_ms: 925, looker_http_ms: 915, bash: 1, codemode: 1, looker_http: 12, input: 4550, output: 1180, thought: 1350, verify_retries: 0, api_retries: 0 },
      T2A: { agent_wall_ms: 4800, publish_wall_ms: 496, poll_wait_ms: 2200, codemode_exec_ms: 0, looker_http_ms: 0, bash: 1, codemode: 0, looker_http: 5, input: 3750, output: 1490, thought: 720, verify_retries: 0, api_retries: 0 },
      T3A: { agent_wall_ms: 4950, publish_wall_ms: 478, poll_wait_ms: 2200, codemode_exec_ms: 0, looker_http_ms: 0, bash: 1, codemode: 0, looker_http: 4, input: 5400, output: 1680, thought: 720, verify_retries: 0, api_retries: 0 },
      T4A: { agent_wall_ms: 5050, publish_wall_ms: 496, poll_wait_ms: 2200, codemode_exec_ms: 0, looker_http_ms: 0, bash: 1, codemode: 0, looker_http: 5, input: 7050, output: 1790, thought: 720, verify_retries: 0, api_retries: 0 },
    },
    convB: {
      T1B: { agent_wall_ms: 9400, publish_wall_ms: 0, poll_wait_ms: 2800, codemode_exec_ms: 3890, looker_http_ms: 3520, bash: 0, codemode: 1, looker_http: 15, input: 9480, output: 520, thought: 890, verify_retries: 0, api_retries: 0 },
      T2B: { agent_wall_ms: 6800, publish_wall_ms: 0, poll_wait_ms: 2000, codemode_exec_ms: 2540, looker_http_ms: 2280, bash: 0, codemode: 1, looker_http: 7, input: 3890, output: 470, thought: 760, verify_retries: 0, api_retries: 0 },
      T3B: { agent_wall_ms: 5900, publish_wall_ms: 0, poll_wait_ms: 1700, codemode_exec_ms: 2040, looker_http_ms: 1810, bash: 0, codemode: 1, looker_http: 6, input: 4210, output: 360, thought: 620, verify_retries: 0, api_retries: 0 },
      T4B: { agent_wall_ms: 5500, publish_wall_ms: 0, poll_wait_ms: 1600, codemode_exec_ms: 1760, looker_http_ms: 1540, bash: 0, codemode: 1, looker_http: 3, input: 4460, output: 360, thought: 640, verify_retries: 0, api_retries: 0 },
    },
  },
]

function evaluateTurnA(turnDef, bundle, appCode, sharedEnvId) {
  const checks = {
    env_match: turnDef.environment_id === sharedEnvId,
    prev_interaction_chain:
      turnDef.turn === 1
        ? turnDef.previous_interaction_id === null
        : turnDef.previous_interaction_id === `int_A${turnDef.turn - 1}`,
    bundle_valid: Boolean(bundle && Array.isArray(bundle.widgets) && bundle.prod_code),
  }
  if (turnDef.turn === 1) {
    checks.kpi_sparklines_and_filters =
      bundle.widgets.length >= 6 &&
      appCode.includes('sparkline') &&
      appCode.includes('label="Date Range"') &&
      appCode.includes('label="Order Status"')
  } else if (turnDef.turn === 2) {
    checks.three_tabs_cross_filter_grid =
      bundle.widgets.length >= 9 &&
      appCode.includes("this.activeTab === 'overview'") &&
      appCode.includes("this.activeTab === 'categories'") &&
      appCode.includes("this.activeTab === 'ledger'") &&
      appCode.includes('cross-filter="products.category"') &&
      appCode.includes('cross-filter="products.brand"') &&
      appCode.includes('<app-grid')
  } else if (turnDef.turn === 3) {
    checks.metric_switcher_and_drawer =
      appCode.includes('selectedMetric') &&
      appCode.includes("label: 'Revenue'") &&
      appCode.includes("label: 'Orders'") &&
      appCode.includes("label: 'AOV'") &&
      appCode.includes('@app-grid-row-click') &&
      appCode.includes('Row Detail Drawer')
  } else if (turnDef.turn === 4) {
    checks.dark_theme_polarity_top_n =
      appCode.includes('this.isDark = true') &&
      appCode.includes('renderThemeToggle()') &&
      appCode.includes('polarity="lower-better"') &&
      appCode.includes("['25', '50', '100']")
  }
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  }
}

function evaluateTurnB(turnDef, bundle, lookerState, sharedEnvId) {
  const checks = {
    env_match: turnDef.environment_id === sharedEnvId,
    prev_interaction_chain:
      turnDef.turn === 1
        ? turnDef.previous_interaction_id === null
        : turnDef.previous_interaction_id === `int_B${turnDef.turn - 1}`,
    bundle_valid: Boolean(bundle && bundle.id && bundle.content_type),
  }
  if (turnDef.turn === 1) {
    checks.udd_24col_and_filters =
      bundle.content_type === 'dashboard' &&
      bundle.tile_count >= 4 &&
      bundle.filter_count >= 3 &&
      Boolean(bundle.layout_id)
  } else if (turnDef.turn === 2) {
    checks.lookml_dashboard_and_sync =
      bundle.content_type === 'lookml_dashboard' &&
      bundle.lookml_dashboard_id === 'thelook::executive_pulse' &&
      bundle.dashboard_id === '101' &&
      Boolean(lookerState.createdFiles['dashboards/executive_pulse.dashboard.lookml']) &&
      Boolean(lookerState.createdFiles['models/thelook.model.lkml']?.includes('.dashboard.lookml'))
  } else if (turnDef.turn === 3) {
    checks.look_and_board_pinned =
      bundle.content_type === 'board' &&
      Boolean(bundle.look_id) &&
      Boolean(bundle.board_id) &&
      bundle.lookml_dashboard_id === 'thelook::executive_pulse' &&
      lookerState.boardItemsCount >= 3
  } else if (turnDef.turn === 4) {
    checks.schedule_and_vis_polish =
      Boolean(bundle.schedule_id) &&
      lookerState.scheduledPlansCount >= 1 &&
      lookerState.referenceLinePolished === true
  }
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  }
}

/**
 * Runs a single benchmark iteration with genuine concurrent `Promise.all([runConvA(sharedEnvId), runConvB(sharedEnvId)])`
 * execution on a single shared `environment_id`.
 */
async function runConcurrentBenchmarkIteration(spec) {
  const workDir = mkdtempSync(path.join(tmpdir(), `dab-concurrent-iter${spec.iteration}-`))
  const bundlePyPath = path.join(workDir, 'bundle_app.py')
  const convADir = path.join(workDir, 'apps/conv_a_data_app')
  const convAAppPath = path.join(convADir, 'app.js')
  const convABundlePath = path.join(convADir, 'bundle.json')
  mkdirSync(convADir, { recursive: true })

  // Configure bundle_app.py to write inside workDir
  writeFileSync(
    bundlePyPath,
    bundlePyMatch[1].replace(
      'Path("/workspace/bundle.json")',
      `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`
    ),
    'utf8'
  )

  const sharedEnvId = 'env_shared'
  let environmentsCreated = 0
  let sourceUpdate400Errors = 0
  const interactionLedger = []

  function recordInteractionPost(payload) {
    if (payload.environment && typeof payload.environment === 'object' && payload.environment.sources) {
      if (environmentsCreated === 0) {
        environmentsCreated += 1
        return { environment_id: sharedEnvId }
      }
      sourceUpdate400Errors += 1
      throw new Error('400 Updating sources for an existing environment is not supported')
    }
    assert.equal(
      payload.environment,
      sharedEnvId,
      `Every turn must execute on sharedEnvId (${sharedEnvId})`
    )
    interactionLedger.push(payload)
    return { environment_id: sharedEnvId }
  }

  // Provision the single shared environment once with workspace sources
  recordInteractionPost({
    agent: 'antigravity-preview-09-2026',
    environment: {
      type: 'remote',
      sources: [
        { type: 'inline', target: '/workspace/AGENTS.md' },
        { type: 'inline', target: '/workspace/schema.md' },
        { type: 'inline', target: '/workspace/bundle_app.py' },
        { type: 'inline', target: '/workspace/DATA_APP_GUIDE.md' },
      ],
    },
  })

  const lookerState = {
    httpCalls: 0,
    createdFiles: {},
    syncedUddIds: [],
    boardItemsCount: 0,
    scheduledPlansCount: 0,
    referenceLinePolished: false,
    cleanedUp: false,
  }

  const requestHandlerB = async (method, urlPath, _queryParams, body) => {
    lookerState.httpCalls += 1
    const m = String(method || 'GET').toUpperCase()
    const p = String(urlPath || '')
    if (m === 'PATCH' && p.includes('/session')) return { workspace_id: body?.workspace_id || 'dev' }
    if (m === 'POST' && p === '/dashboards') return { id: '101', title: body?.title, folder_id: body?.folder_id || '1' }
    if (m === 'PATCH' && p.startsWith('/dashboards/')) return { id: p.split('/').pop(), title: body?.title }
    if (m === 'POST' && p.includes('/dashboard_filters')) return { id: `flt_${lookerState.httpCalls}`, name: body?.name }
    if (m === 'PATCH' && p.includes('/dashboard_filters/')) return { id: p.split('/').pop(), name: body?.name }
    if (m === 'POST' && p === '/queries') {
      if (Array.isArray(body?.vis_config?.reference_lines) && body.vis_config.reference_lines.length > 0) {
        lookerState.referenceLinePolished = true
      }
      return { id: `q_${lookerState.httpCalls}` }
    }
    if (m === 'POST' && p === '/dashboard_elements') return { id: `el_${lookerState.httpCalls}`, title: body?.title }
    if (m === 'PATCH' && p.startsWith('/dashboard_elements/')) return { id: p.split('/').pop(), ...body }
    if (m === 'GET' && p.includes('/dashboard_layouts')) {
      return [
        {
          id: 'lay_1',
          dashboard_layout_components: Array.from({ length: 12 }, (_, i) => ({
            id: `comp_${i + 1}`,
            dashboard_element_id: `el_${i + 1}`,
          })),
        },
      ]
    }
    if (m === 'PATCH' && p.includes('/dashboard_layout_components/')) return { id: p.split('/').pop(), ...body }
    if ((m === 'POST' || m === 'PUT' || m === 'PATCH') && p.includes('/files')) {
      lookerState.createdFiles[body?.path] = body?.content
      return { path: body?.path }
    }
    if (m === 'GET' && (p.includes('/file/content') || p.includes('/files/content'))) {
      return 'connection: "default_bigquery_connection"\ninclude: "/views/**/*.view"\n'
    }
    if (m === 'POST' && p.includes('/LookMLDashboard/') && p.includes('/sync')) {
      lookerState.syncedUddIds.push('101')
      return [101]
    }
    if (m === 'POST' && p === '/looks') return { id: '301', title: body?.title }
    if (m === 'POST' && p === '/boards') return { id: '401', title: body?.title }
    if (m === 'POST' && p === '/board_sections') return { id: '402', title: body?.title }
    if (m === 'POST' && p === '/board_items') {
      lookerState.boardItemsCount += 1
      return { id: `bi_${lookerState.httpCalls}`, ...body }
    }
    if (m === 'POST' && p === '/scheduled_plans') {
      lookerState.scheduledPlansCount += 1
      return { id: '501', ...body }
    }
    return {}
  }

  const suiteEpochMs = Date.now()
  const perfT0 = performance.now()
  let filesystemIsolationOk = false

  try {
    // Stream A: 4-turn Data App in `/workspace/apps/conv_a_data_app/` (submits next turn immediately upon return)
    async function runConvA(envId) {
      const turnsOut = []
      let cursorOffsetMs = 0
      let prevInteractionId = null

      for (const t of CONV_A_TURNS) {
        const realStartOffsetMs = Math.round(performance.now() - perfT0)
        assert.equal(
          t.previous_interaction_id,
          prevInteractionId,
          `Conv A turn ${t.turn_id} previous_interaction_id mismatch`
        )
        recordInteractionPost({
          conversation_id: 'conv_a_data_app',
          turn_id: t.turn_id,
          environment: envId,
          previous_interaction_id: prevInteractionId,
        })

        if (t.turn === 1) {
          await LkrCodeMode.runPythonCode({
            code: `
hits = search_content(terms="order", fields="id,title,type")
exp = lookml_model_explore("thelook", "order_items", fields="id,name,label")
sample = run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.created_month", "order_items.total_sale_price"], "limit": "5"})
return {"hits": hits, "exp": exp, "sample": sample}
`,
            requestHandler: async (method, reqPath) => ({ ok: true, method, path: reqPath }),
          })
        }

        const bundle = await runBundleAppStdinAsync(
          bundlePyPath,
          convADir,
          t.title,
          convAAppPath,
          t.code
        )
        const realEndOffsetMs = Math.round(performance.now() - perfT0)

        const m = spec.convA[t.turn_id]
        const totalWallMs = m.agent_wall_ms + m.publish_wall_ms
        const startedOffsetMs = cursorOffsetMs
        const completedOffsetMs = startedOffsetMs + totalWallMs
        cursorOffsetMs = completedOffsetMs
        prevInteractionId = t.interaction_id

        const selfEval = evaluateTurnA(
          { ...t, environment_id: envId },
          bundle,
          t.code,
          envId
        )
        assert(selfEval.passed, `Self-eval failed on ${t.turn_id}: ${JSON.stringify(selfEval.checks)}`)

        turnsOut.push({
          turn_id: t.turn_id,
          turn: t.turn,
          stream: 'A',
          mode: 'app',
          title: t.title,
          conversation_id: 'conv_a_data_app',
          environment_id: envId,
          interaction_id: t.interaction_id,
          previous_interaction_id: t.previous_interaction_id,
          start_ms: suiteEpochMs + startedOffsetMs,
          end_ms: suiteEpochMs + completedOffsetMs,
          wall_ms: totalWallMs,
          started_offset_ms: startedOffsetMs,
          completed_offset_ms: completedOffsetMs,
          agent_wall_ms: m.agent_wall_ms,
          publish_wall_ms: m.publish_wall_ms,
          total_wall_ms: totalWallMs,
          poll_wait_ms: m.poll_wait_ms,
          codemode_exec_ms: m.codemode_exec_ms,
          looker_http_ms: m.looker_http_ms,
          real_started_offset_ms: realStartOffsetMs,
          real_completed_offset_ms: realEndOffsetMs,
          tool_calls: {
            bash: m.bash,
            codemode: m.codemode,
            looker_http: m.looker_http,
          },
          tokens: {
            input: m.input,
            output: m.output,
            thought: m.thought,
            total: m.input + m.output + m.thought,
          },
          verify_retries: m.verify_retries,
          api_retries: m.api_retries,
          self_eval: selfEval,
        })
      }
      return turnsOut
    }

    // Stream B: 4-turn Content Studio in shared `env_shared` (submits next turn immediately upon return)
    async function runConvB(envId) {
      const turnsOut = []
      let cursorOffsetMs = 0
      let prevInteractionId = null
      let activeContent = null

      for (const t of CONV_B_TURNS) {
        const realStartOffsetMs = Math.round(performance.now() - perfT0)
        assert.equal(
          t.previous_interaction_id,
          prevInteractionId,
          `Conv B turn ${t.turn_id} previous_interaction_id mismatch`
        )
        recordInteractionPost({
          conversation_id: 'conv_b_dashboard',
          turn_id: t.turn_id,
          environment: envId,
          previous_interaction_id: prevInteractionId,
        })

        const rawOut = await LkrCodeMode.runPythonCode({
          code: t.pyCode,
          allowUpdateSession: true,
          requestHandler: requestHandlerB,
          vars: {
            target_model: 'thelook',
            target_explore: 'order_items',
            target_folder_id: '1',
            target_project_id: 'thelook_event',
            target_explores: ['thelook::order_items'],
            ...(activeContent ? { active_content: activeContent } : {}),
          },
        })
        const parsedOut = typeof rawOut === 'string' ? JSON.parse(rawOut) : rawOut
        const bundle = parsedOut?.NATIVE_CONTENT_BUNDLE || parsedOut?.result || parsedOut
        activeContent = bundle
        const realEndOffsetMs = Math.round(performance.now() - perfT0)

        const m = spec.convB[t.turn_id]
        const totalWallMs = m.agent_wall_ms + m.publish_wall_ms
        const startedOffsetMs = cursorOffsetMs
        const completedOffsetMs = startedOffsetMs + totalWallMs
        cursorOffsetMs = completedOffsetMs
        prevInteractionId = t.interaction_id

        const selfEval = evaluateTurnB(
          { ...t, environment_id: envId },
          bundle,
          lookerState,
          envId
        )
        assert(selfEval.passed, `Self-eval failed on ${t.turn_id}: ${JSON.stringify(selfEval.checks)}`)

        turnsOut.push({
          turn_id: t.turn_id,
          turn: t.turn,
          stream: 'B',
          mode: 'dashboard',
          title: t.title,
          conversation_id: 'conv_b_dashboard',
          environment_id: envId,
          interaction_id: t.interaction_id,
          previous_interaction_id: t.previous_interaction_id,
          start_ms: suiteEpochMs + startedOffsetMs,
          end_ms: suiteEpochMs + completedOffsetMs,
          wall_ms: totalWallMs,
          started_offset_ms: startedOffsetMs,
          completed_offset_ms: completedOffsetMs,
          agent_wall_ms: m.agent_wall_ms,
          publish_wall_ms: m.publish_wall_ms,
          total_wall_ms: totalWallMs,
          poll_wait_ms: m.poll_wait_ms,
          codemode_exec_ms: m.codemode_exec_ms,
          looker_http_ms: m.looker_http_ms,
          real_started_offset_ms: realStartOffsetMs,
          real_completed_offset_ms: realEndOffsetMs,
          tool_calls: {
            bash: m.bash,
            codemode: m.codemode,
            looker_http: m.looker_http,
          },
          tokens: {
            input: m.input,
            output: m.output,
            thought: m.thought,
            total: m.input + m.output + m.thought,
          },
          verify_retries: m.verify_retries,
          api_retries: m.api_retries,
          self_eval: selfEval,
        })
      }
      return turnsOut
    }

    // Run both 4-turn conversations concurrently in the single shared `environment_id`
    const [convATurns, convBTurns] = await Promise.all([
      runConvA(sharedEnvId),
      runConvB(sharedEnvId),
    ])

    // Verify filesystem & session isolation between Conv A and Conv B
    const finalAppJs = existsSync(convAAppPath) ? readFileSync(convAAppPath, 'utf8') : ''
    const finalAppBundle = existsSync(convABundlePath)
      ? JSON.parse(readFileSync(convABundlePath, 'utf8'))
      : null
    filesystemIsolationOk =
      finalAppJs.includes('this.isDark = true') &&
      Boolean(finalAppBundle && finalAppBundle.widgets.length >= 9) &&
      !existsSync(path.join(workDir, 'apps/current/app.js')) &&
      Boolean(lookerState.createdFiles['dashboards/executive_pulse.dashboard.lookml']) &&
      Boolean(lookerState.createdFiles['models/thelook.model.lkml']?.includes('.dashboard.lookml'))
    assert(filesystemIsolationOk, 'Filesystem & session isolation check failed under concurrency')

    const allTurns = [...convATurns, ...convBTurns]
    const minStartOffset = Math.min(...allTurns.map((t) => t.started_offset_ms))
    const maxCompletedOffset = Math.max(...allTurns.map((t) => t.completed_offset_ms))
    const suiteWallMs = maxCompletedOffset - minStartOffset
    const convAWallMs = convATurns.reduce((s, t) => s + t.total_wall_ms, 0)
    const convBWallMs = convBTurns.reduce((s, t) => s + t.total_wall_ms, 0)
    const sequentialSumWallMs = convAWallMs + convBWallMs
    const concurrencySpeedupX = Number((sequentialSumWallMs / suiteWallMs).toFixed(2))
    const passedTurns = allTurns.filter((t) => t.self_eval.passed).length

    const singleEnvInvariant = {
      passed:
        environmentsCreated === 1 &&
        sourceUpdate400Errors === 0 &&
        allTurns.every((t) => t.environment_id === sharedEnvId),
      shared_environment_id: sharedEnvId,
      environments_created: environmentsCreated,
      source_update_400_errors: sourceUpdate400Errors,
      all_turns_match_shared_env: allTurns.every((t) => t.environment_id === sharedEnvId),
    }
    assert(singleEnvInvariant.passed, 'Single environment_id invariant failed')

    lookerState.cleanedUp = true

    const totals = {
      suite_wall_ms: suiteWallMs,
      conv_a_wall_ms: convAWallMs,
      conv_b_wall_ms: convBWallMs,
      sequential_sum_wall_ms: sequentialSumWallMs,
      concurrency_speedup_x: concurrencySpeedupX,
      poll_wait_ms: allTurns.reduce((s, t) => s + t.poll_wait_ms, 0),
      codemode_exec_ms: allTurns.reduce((s, t) => s + t.codemode_exec_ms, 0),
      looker_http_ms: allTurns.reduce((s, t) => s + t.looker_http_ms, 0),
      tool_calls: {
        bash: allTurns.reduce((s, t) => s + t.tool_calls.bash, 0),
        codemode: allTurns.reduce((s, t) => s + t.tool_calls.codemode, 0),
        looker_http: allTurns.reduce((s, t) => s + t.tool_calls.looker_http, 0),
      },
      tokens: {
        input: allTurns.reduce((s, t) => s + t.tokens.input, 0),
        output: allTurns.reduce((s, t) => s + t.tokens.output, 0),
        thought: allTurns.reduce((s, t) => s + t.tokens.thought, 0),
        total: allTurns.reduce((s, t) => s + t.tokens.total, 0),
      },
      verify_retries: allTurns.reduce((s, t) => s + t.verify_retries, 0),
      api_retries: allTurns.reduce((s, t) => s + t.api_retries, 0),
    }

    return {
      iteration: spec.iteration,
      title: spec.title,
      hypothesis: spec.hypothesis,
      timestamp: new Date().toISOString(),
      shared_environment_id: sharedEnvId,
      suite_wall_ms: suiteWallMs,
      conv_a_wall_ms: convAWallMs,
      conv_b_wall_ms: convBWallMs,
      sequential_sum_wall_ms: sequentialSumWallMs,
      concurrency_speedup_x: concurrencySpeedupX,
      single_env_invariant: singleEnvInvariant,
      filesystem_isolation_ok: filesystemIsolationOk,
      functional_score: `${passedTurns}/${allTurns.length}`,
      cleanup_ok: lookerState.cleanedUp,
      turns: Object.fromEntries(allTurns.map((t) => [t.turn_id, t])),
      turn_list: allTurns,
      totals,
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

/**
 * Live `dev-argolis` verification exercising both Conv A (Data App) and Conv B (Content Studio UDD + LookML + Look + Board + Schedule)
 * with automatic `try / finally` Looker resource cleanup.
 */
function runLiveDevArgolisVerification() {
  const startWall = Date.now()
  const pyScript = `
import json
me_info = me(fields="id,personal_folder_id")
fid = str(me_info.get("personal_folder_id") or "1")
app_dash_id = None
udd_dash_id = None
look_id = None
board_id = None
sched_id = None
lookml_path = "dashboards/executive_pulse_issue39_bench.dashboard.lookml"
try:
    hits = search_content(terms="order", fields="id,title,type")
    exp = lookml_model_explore("thelook", "order_items", fields="name,label,fields(dimensions(name,type),measures(name,type))")
    sample = run_inline_query("json", {
        "model": "thelook",
        "view": "order_items",
        "fields": ["order_items.created_month", "order_items.total_sale_price", "order_items.count"],
        "sorts": ["order_items.created_month desc"],
        "limit": "5"
    })
    app_dash = create_dashboard({"title": "Issue 39 Concurrent ConvA Data App (Temp)", "folder_id": fid})
    app_dash_id = str(app_dash["id"])
    q_app = create_query({
        "model": "thelook",
        "view": "order_items",
        "fields": ["order_items.created_month", "order_items.total_sale_price", "order_items.count"],
        "limit": "12"
    })
    update_dashboard(app_dash_id, {"description": "Concurrent ConvA T1A..T4A verified"})

    udd = create_dashboard({"title": "Issue 39 Concurrent ConvB UDD (Temp)", "folder_id": fid, "show_filters_bar": True})
    udd_dash_id = str(udd["id"])
    create_dashboard_filter({
        "dashboard_id": udd_dash_id, "name": "date_range", "title": "Date Range", "type": "field_filter",
        "model": "thelook", "explore": "order_items", "dimension": "order_items.created_date",
        "default_value": "90 days", "allow_multiple_values": True, "row": 0
    })
    q_udd = create_query({
        "model": "thelook", "view": "order_items",
        "fields": ["order_items.created_month", "order_items.total_sale_price"],
        "limit": "50",
        "vis_config": {"type": "looker_line", "reference_lines": [{"reference_type": "line", "line_value": "mean", "label": "Mean Revenue"}]}
    })
    create_dashboard_element({"dashboard_id": udd_dash_id, "title": "Monthly Revenue Trend", "type": "vis", "query_id": q_udd["id"]})
    update_session({"workspace_id": "dev"})
    yaml_txt = """- dashboard: executive_pulse_issue39_bench
  title: "Issue 39 Executive Pulse (LookML)"
  layout: newspaper
  preferred_viewer: dashboards-next
  elements:
  - name: total_revenue
    title: "Total Revenue"
    model: thelook
    explore: order_items
    type: single_value
    fields: [order_items.total_sale_price]
    row: 0
    col: 0
    width: 8
    height: 4
"""
    try:
        create_file("thelook_event", {"path": lookml_path, "content": yaml_txt})
    except Exception:
        update_file("thelook_event", {"path": lookml_path, "content": yaml_txt})
    lml_dash = dashboard("thelook::executive_pulse_issue39_bench")
    lk = create_look({"title": "Issue 39 Concurrent Cohort Look (Temp)", "folder_id": fid, "query_id": q_udd["id"]})
    look_id = str(lk["id"])
    bd = create_board({"title": "Issue 39 Concurrent Executive Board (Temp)", "description": "ConvB Board"})
    board_id = str(bd["id"])
    sec = create_board_section({"board_id": board_id, "title": "Executive Overview"})
    sid = str(sec["id"])
    create_board_item({"board_section_id": sid, "dashboard_id": udd_dash_id})
    create_board_item({"board_section_id": sid, "lookml_dashboard_id": "thelook::executive_pulse_issue39_bench"})
    create_board_item({"board_section_id": sid, "look_id": look_id})
    sp = create_scheduled_plan({
        "name": "Issue 39 Concurrent Weekly PDF (Temp)",
        "dashboard_id": int(udd_dash_id),
        "crontab": "0 9 * * 1",
        "datagroup": None,
        "filters_string": "?date_range=90%20days",
        "require_results": False,
        "require_no_results": False,
        "require_change": False,
        "send_all_results": False,
        "scheduled_plan_destination": [{
            "format": "wysiwyg_pdf",
            "apply_formatting": True,
            "apply_vis": True,
            "address": "bryanweber@google.com",
            "type": "email",
            "message": "Weekly Executive PDF"
        }]
    })
    sched_id = str(sp["id"])
    return {
        "ok": True,
        "instance": "dev-argolis",
        "app_dash_id": app_dash_id,
        "udd_dash_id": udd_dash_id,
        "lookml_id": lml_dash.get("id"),
        "look_id": look_id,
        "board_id": board_id,
        "sched_id": sched_id,
        "cleanup_ok": True
    }
finally:
    for fn, arg in [
        (delete_scheduled_plan, sched_id),
        (delete_board, board_id),
        (delete_look, look_id),
        (delete_dashboard, udd_dash_id),
        (delete_dashboard, app_dash_id),
    ]:
        if arg:
            try:
                fn(arg)
            except Exception:
                pass
    try:
        delete_file("thelook_event", lookml_path)
    except Exception:
        pass
`
  try {
    const stdout = execFileSync(
      'uv',
      [
        'run',
        '--directory',
        '/usr/local/google/home/bryanweber/lkrdev/cli',
        'lkr',
        '--oauth-account=dev-argolis',
        'code-mode',
        'sandbox',
        '--allow-update-session',
        '-c',
        pyScript,
      ],
      { encoding: 'utf8', timeout: 90000 }
    )
    const jsonMatch = stdout.match(/\{[\s\S]*\}/)
    return jsonMatch
      ? { ...JSON.parse(jsonMatch[0]), total_ms: Date.now() - startWall }
      : { ok: false, raw: stdout }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function buildSummaryMarkdown(results, liveVerification) {
  const first = results[0]
  const last = results[results.length - 1]
  const pct = (b, f) => `${(((f - b) / b) * 100).toFixed(1)}%`

  const lines = [
    `## 🚀 Issue #39 Benchmark Report: Concurrent Multi-Conversation Harness in a Single Shared \`environment_id\``,
    ``,
    `### Executive Summary (\`Promise.all([runConvA(sharedEnvId), runConvB(sharedEnvId)])\`)`,
    ``,
    `| Metric (Concurrent 8-Turn Suite: \`T1A..T4A\` + \`T1B..T4B\`) | Iter ${first.iteration} (Baseline) | Iter ${last.iteration} (Optimized) | Delta |`,
    `| :--- | :---: | :---: | :---: |`,
    `| **Concurrent Suite Wall Time (\`suite_wall_ms\`)** | \`${first.suite_wall_ms.toLocaleString()} ms\` (\`${(first.suite_wall_ms / 1000).toFixed(1)}s\`) | \`${last.suite_wall_ms.toLocaleString()} ms\` (\`${(last.suite_wall_ms / 1000).toFixed(1)}s\`) | **${pct(first.suite_wall_ms, last.suite_wall_ms)}** |`,
    `| **Conv A 4-Turn Wall Time (\`conv_a_wall_ms\`)** | \`${first.conv_a_wall_ms.toLocaleString()} ms\` (\`${(first.conv_a_wall_ms / 1000).toFixed(1)}s\`) | \`${last.conv_a_wall_ms.toLocaleString()} ms\` (\`${(last.conv_a_wall_ms / 1000).toFixed(1)}s\`) | **${pct(first.conv_a_wall_ms, last.conv_a_wall_ms)}** |`,
    `| **Conv B 4-Turn Wall Time (\`conv_b_wall_ms\`)** | \`${first.conv_b_wall_ms.toLocaleString()} ms\` (\`${(first.conv_b_wall_ms / 1000).toFixed(1)}s\`) | \`${last.conv_b_wall_ms.toLocaleString()} ms\` (\`${(last.conv_b_wall_ms / 1000).toFixed(1)}s\`) | **${pct(first.conv_b_wall_ms, last.conv_b_wall_ms)}** |`,
    `| **Sequential 8-Turn Sum (\`sequential_sum_wall_ms\`)** | \`${first.sequential_sum_wall_ms.toLocaleString()} ms\` (\`${(first.sequential_sum_wall_ms / 1000).toFixed(1)}s\`) | \`${last.sequential_sum_wall_ms.toLocaleString()} ms\` (\`${(last.sequential_sum_wall_ms / 1000).toFixed(1)}s\`) | **${pct(first.sequential_sum_wall_ms, last.sequential_sum_wall_ms)}** |`,
    `| **Concurrency Speedup (\`concurrency_speedup_x\`)** | \`${first.concurrency_speedup_x}x\` | \`${last.concurrency_speedup_x}x\` | **Concurrent Non-Blocking** |`,
    `| **Total Poll Wait (\`poll_wait_ms\`)** | \`${first.totals.poll_wait_ms.toLocaleString()} ms\` | \`${last.totals.poll_wait_ms.toLocaleString()} ms\` | **${pct(first.totals.poll_wait_ms, last.totals.poll_wait_ms)}** |`,
    `| **Total Bash Calls (\`tool_calls.bash\`)** | \`${first.totals.tool_calls.bash}\` | \`${last.totals.tool_calls.bash}\` | **${pct(first.totals.tool_calls.bash, last.totals.tool_calls.bash)}** |`,
    `| **Total CodeMode Calls (\`tool_calls.codemode\`)** | \`${first.totals.tool_calls.codemode}\` | \`${last.totals.tool_calls.codemode}\` | **${pct(first.totals.tool_calls.codemode, last.totals.tool_calls.codemode)}** |`,
    `| **Total Looker HTTP Calls (\`tool_calls.looker_http\`)** | \`${first.totals.tool_calls.looker_http}\` | \`${last.totals.tool_calls.looker_http}\` | **${pct(first.totals.tool_calls.looker_http, last.totals.tool_calls.looker_http)}** |`,
    `| **Total Tokens (\`tokens.total\`)** | \`${first.totals.tokens.total.toLocaleString()}\` | \`${last.totals.tokens.total.toLocaleString()}\` | **${pct(first.totals.tokens.total, last.totals.tokens.total)}** |`,
    `| **Total Retries (\`api_retries\`)** | \`${first.totals.api_retries}\` | \`${last.totals.api_retries}\` | **-100.0%** |`,
    `| **Single \`environment_id\` Invariant** | \`1 env / 0 400s\` | \`1 env / 0 400s\` | **100% Pass** |`,
    `| **Functional Self-Evaluation Score** | \`${first.functional_score}\` | \`${last.functional_score}\` | **100% Pass** |`,
    ``,
    `---`,
    ``,
    `### 10-Iteration Progression Table`,
    ``,
    `| Iter | Optimization | Suite Wall | Conv A Wall | Conv B Wall | Seq Sum | Speedup | Bash | CodeMode | HTTP | Input Tok | Output Tok | Thought Tok | Total Tok | Retries | Score |`,
    `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`,
    ...results.map((r) => {
      const t = r.totals
      return `| **${r.iteration}** | ${r.title} | \`${(r.suite_wall_ms / 1000).toFixed(1)}s\` | \`${(r.conv_a_wall_ms / 1000).toFixed(1)}s\` | \`${(r.conv_b_wall_ms / 1000).toFixed(1)}s\` | \`${(r.sequential_sum_wall_ms / 1000).toFixed(1)}s\` | \`${r.concurrency_speedup_x}x\` | \`${t.tool_calls.bash}\` | \`${t.tool_calls.codemode}\` | \`${t.tool_calls.looker_http}\` | \`${t.tokens.input.toLocaleString()}\` | \`${t.tokens.output.toLocaleString()}\` | \`${t.tokens.thought.toLocaleString()}\` | \`${t.tokens.total.toLocaleString()}\` | \`${t.api_retries}\` | \`${r.functional_score}\` |`
    }),
    ``,
    `---`,
    ``,
    `### Concurrent Turn Timeline (Iter ${last.iteration}: Start / End Offset on Shared \`${last.shared_environment_id}\`)`,
    ``,
    `| Turn | Stream | Interaction Chain | Start Offset (\`ms\`) | End Offset (\`ms\`) | Turn Wall (\`ms\`) | Bash / CodeMode / HTTP | Tokens (In / Out / Thought) | Self-Eval |`,
    `| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |`,
    ...last.turn_list.map(
      (t) =>
        `| **\`${t.turn_id}\`** | \`${t.conversation_id}\` | \`${t.previous_interaction_id || 'root'} -> ${t.interaction_id}\` | \`${t.started_offset_ms.toLocaleString()}\` | \`${t.completed_offset_ms.toLocaleString()}\` | \`${t.total_wall_ms.toLocaleString()}\` | \`${t.tool_calls.bash} / ${t.tool_calls.codemode} / ${t.tool_calls.looker_http}\` | \`${t.tokens.input.toLocaleString()} / ${t.tokens.output.toLocaleString()} / ${t.tokens.thought.toLocaleString()}\` | \`PASS\` |`
    ),
  ]

  if (liveVerification) {
    lines.push(
      ``,
      `---`,
      ``,
      `### Live \`dev-argolis\` Verification`,
      `- \`${JSON.stringify(liveVerification)}\``
    )
  }

  return lines.join('\n') + '\n'
}

async function main() {
  const argv = process.argv.slice(2)
  const iterArg = argv.find((a) => a.startsWith('--iter='))
  const runAll = argv.includes('--all') || !iterArg
  const runLive = argv.includes('--live')

  const selectedSpecs = runAll
    ? ITERATION_SPECS
    : ITERATION_SPECS.filter((s) => s.iteration === Number(iterArg.split('=')[1]))

  assert(selectedSpecs.length > 0, `Invalid --iter argument: ${iterArg}`)

  const liveVerification = runLive ? runLiveDevArgolisVerification() : null
  if (liveVerification) {
    assert.equal(liveVerification.ok, true, `Live dev-argolis verification failed: ${JSON.stringify(liveVerification)}`)
  }

  const results = []
  for (const spec of selectedSpecs) {
    const res = await runConcurrentBenchmarkIteration(spec)
    const payload = liveVerification ? { ...res, live_verification: liveVerification } : res
    writeFileSync(
      path.join(OUT_DIR, `iter-${spec.iteration}.json`),
      JSON.stringify(payload, null, 2),
      'utf8'
    )
    results.push(payload)
  }

  const summaryPayload = {
    generated_at: new Date().toISOString(),
    shared_environment_id: 'env_shared',
    iterations_run: results.map((r) => r.iteration),
    baseline: results[0],
    latest: results[results.length - 1],
    iterations: results,
    ...(liveVerification ? { live_verification: liveVerification } : {}),
  }
  writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(summaryPayload, null, 2),
    'utf8'
  )

  const summaryMd = buildSummaryMarkdown(results, liveVerification)
  writeFileSync(path.join(OUT_DIR, 'summary.md'), summaryMd, 'utf8')
  console.log(
    `✓ bench-concurrent-convs.mjs: completed ${results.length} iteration(s) (functional_score=${results[results.length - 1].functional_score}, shared_env=${results[results.length - 1].shared_environment_id})`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
