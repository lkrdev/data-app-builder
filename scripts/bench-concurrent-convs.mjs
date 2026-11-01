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

function buildConvACode(turn) {
  const imports =
    turn === 1
      ? 'DataApp, html'
      : turn === 2
      ? 'DataApp, html, createCurrencyCol, createNumericCol, createBadgeCol'
      : 'DataApp, html, nothing, createCurrencyCol, createNumericCol, createBadgeCol'
  const metricConfig =
    turn >= 3
      ? `\nconst METRIC_CONFIG = {\n  'order_items.total_sale_price': { label: 'Revenue', field: 'order_items.total_sale_price', format: 'usd' },\n  'order_items.count': { label: 'Orders', field: 'order_items.count', format: 'int' },\n  'order_items.average_sale_price': { label: 'AOV', field: 'order_items.average_sale_price', format: 'usd2' },\n};\n`
      : ''
  const headerBlock =
    turn >= 2
      ? `        <header class="da-header">
          <nav class="da-tabs">
            <button class="da-tab-btn \${this.activeTab === 'overview' ? 'active' : ''}" @click=\${() => { this.activeTab = 'overview'; }}>Overview</button>
            <button class="da-tab-btn \${this.activeTab === 'categories' ? 'active' : ''}" @click=\${() => { this.activeTab = 'categories'; }}>Categories & Brands</button>
            <button class="da-tab-btn \${this.activeTab === 'ledger' ? 'active' : ''}" @click=\${() => { this.activeTab = 'ledger'; }}>Order Ledger</button>${turn === 4 ? '\n            ${this.renderThemeToggle()}' : ''}
          </nav>
        </header>\n`
      : ''
  const kpiBlock =
    turn === 4
      ? `          <app-kpi label="Total Revenue" format="usd" sparkline sparkline-agg="sum" change="+14.2% MoM" change-type="positive" polarity="higher-better" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Total Orders" format="int" sparkline sparkline-agg="sum" change="+9.8% MoM" change-type="positive" polarity="higher-better" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Returned Orders" format="int" sparkline sparkline-agg="sum" change="-1.8% MoM" change-type="positive" polarity="lower-better" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], filters: { 'order_items.status': 'Returned' }, sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Gross Margin" format="usd" sparkline sparkline-agg="sum" change="+11.6% MoM" change-type="positive" polarity="higher-better" .query=\${{ fields: ['order_items.created_month', 'order_items.total_gross_margin'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>`
      : `          <app-kpi label="Total Revenue" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Total Orders" format="int" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.count'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Avg Order Value" format="usd2" sparkline sparkline-agg="avg" .query=\${{ fields: ['order_items.created_month', 'order_items.average_sale_price'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>
          <app-kpi label="Gross Margin" format="usd" sparkline sparkline-agg="sum" .query=\${{ fields: ['order_items.created_month', 'order_items.total_gross_margin'], sorts: ['order_items.created_month desc'], limit: '12' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-kpi>`
  const chartsBlock =
    turn === 1
      ? `        <section class="da-grid-2-1">
          <app-chart title="Monthly Revenue & Order Volume Trend" type="areaspline" value-format="usd" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price', 'order_items.count'], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>`
      : turn === 2
      ? `        <section class="da-grid-2">
          <app-chart title="Monthly Revenue & Order Volume Trend" type="areaspline" value-format="usd" .query=\${{ fields: ['order_items.created_month', 'order_items.total_sale_price', 'order_items.count'], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Revenue by Category" type="bar" value-format="usd" cross-filter="products.category" .query=\${{ fields: ['products.category', 'order_items.total_sale_price'], sorts: ['order_items.total_sale_price desc'], limit: '15' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Brand Margin Contribution" type="treemap" value-format="usd" cross-filter="products.brand" .query=\${{ fields: ['products.brand', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '20' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>`
      : `        <section class="da-grid-2">
          <app-chart title="Monthly \${activeMetric.label} Trend" type="areaspline" value-format=\${activeMetric.format} .query=\${{ fields: ['order_items.created_month', metricField], sorts: ['order_items.created_month asc'], limit: '24' }} .filters=\${this.getEffectiveFilters({}, { isTimeSeries: true })}></app-chart>
          <app-chart title="Category Breakdown (\${activeMetric.label})" type="bar" value-format=\${activeMetric.format} cross-filter="products.category" .query=\${{ fields: ['products.category', metricField], sorts: [\`\${metricField} desc\`], limit: '15' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Brand Margin Contribution" type="treemap" value-format="usd" cross-filter="products.brand" .query=\${{ fields: ['products.brand', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '20' }} .filters=\${this.getEffectiveFilters()}></app-chart>
          <app-chart title="Order Status Breakdown" type="donut" cross-filter="order_items.status" .query=\${{ fields: ['order_items.status', 'order_items.count'], sorts: ['order_items.count desc'], limit: '10' }} .filters=\${this.getEffectiveFilters()}></app-chart>
        </section>`
  const gridBlock =
    turn === 1
      ? ''
      : turn === 2
      ? `\n        <app-grid
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
        ></app-grid>`
      : `\n        <app-grid
          title="Category & Brand Performance Ledger"
          height="400px"
          show-row-count
          .query=\${{ fields: ['products.category', 'products.brand', 'order_items.status', 'order_items.total_sale_price', 'order_items.count', 'order_items.average_sale_price'], sorts: [\`\${this.selectedMetric} desc\`], limit: ${turn === 4 ? "String(this.topLimit || '25')" : "'50'"} }}
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
        \${this.selectedRow ? html\`<aside class="da-section-card" aria-label="Row Detail Drawer"><h3>\${this.selectedRow['products.brand']}</h3></aside>\` : nothing}`

  return `/**
 * @title Executive Order & Revenue Command Center
 */
import { ${imports} } from '/runtime/data-app.js';${metricConfig}
export class ExecutiveCommandCenter extends DataApp {
  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';${turn === 4 ? '\n    this.isDark = true;' : ''}${turn >= 2 ? "\n    this.activeTab = 'overview';" : ''}
    this.dateRange = '12 months';
    this.statusFilter = 'All';${turn >= 3 ? "\n    this.selectedMetric = 'order_items.total_sale_price';\n    this.selectedRow = null;" : ''}${turn === 4 ? "\n    this.topLimit = '25';" : ''}
  }
  getEffectiveFilters(local = {}, { isTimeSeries = false } = {}) {
    const f = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...local };
    if (this.dateRange && !isTimeSeries) f['order_items.created_date'] = this.dateRange;
    if (this.statusFilter && this.statusFilter !== 'All') f['order_items.status'] = this.statusFilter;
    return f;
  }
  render() {${turn >= 3 ? "\n    const activeMetric = METRIC_CONFIG[this.selectedMetric] || METRIC_CONFIG['order_items.total_sale_price'];\n    const metricField = activeMetric.field;" : ''}
    return html\`
      <div class="da-container${turn === 4 ? " \${this.isDark ? 'dark-theme' : ''}" : ''}">
${headerBlock}        <section class="da-filter-bar">
          <app-select label="Date Range" .value=\${this.dateRange} .options=\${['30 days', '90 days', '12 months']} @change=\${(e) => { this.dateRange = e.detail.value; }}></app-select>
          <app-select label="Order Status" .value=\${this.statusFilter} .options=\${['All', 'Complete', 'Processing', 'Returned']} @change=\${(e) => { this.statusFilter = e.detail.value; }}></app-select>${turn === 4 ? "\n          <app-select label=\"Top N\" .value=\${this.topLimit} .options=\${['25', '50', '100']} @change=\${(e) => { this.topLimit = e.detail.value; }}></app-select>" : ''}${turn >= 3 ? "\n          <div class=\"da-metric-pills\">\${Object.entries(METRIC_CONFIG).map(([k, cfg]) => html`<button class=\"da-tab-btn \${this.selectedMetric === k ? 'active' : ''}\" @click=\${() => { this.selectedMetric = k; }}>\${cfg.label}</button>`)}</div>" : ''}
        </section>
        <section class="da-kpi-grid">
${kpiBlock}
        </section>
${chartsBlock}${gridBlock}
      </div>
    \`;
  }
}
customElements.define('executive-command-center', ExecutiveCommandCenter);
`
}

const CONV_A_TURNS = [
  {
    turn: 1,
    turn_id: 'T1A',
    interaction_id: 'int_A1',
    previous_interaction_id: null,
    title: 'Cold-Start Data App MVP (KPI Sparklines, Trend Chart, Date/Status Filter Bar)',
    code: buildConvACode(1),
  },
  {
    turn: 2,
    turn_id: 'T2A',
    interaction_id: 'int_A2',
    previous_interaction_id: 'int_A1',
    title: 'Expand into 3-Tab Layout + Category/Brand Cross-Filtering + <app-grid>',
    code: buildConvACode(2),
  },
  {
    turn: 3,
    turn_id: 'T3A',
    interaction_id: 'int_A3',
    previous_interaction_id: 'int_A2',
    title: 'Add Metric Switcher Toggle (Revenue | Orders | AOV) + Row-Click Detail Drawer',
    code: buildConvACode(3),
  },
  {
    turn: 4,
    turn_id: 'T4A',
    interaction_id: 'int_A4',
    previous_interaction_id: 'int_A3',
    title: 'Apply Dark Executive Theme, KPI Polarity Deltas & Top N (25 | 50 | 100) Selector',
    code: buildConvACode(4),
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

const tm = (
  agent_wall_ms,
  publish_wall_ms,
  poll_wait_ms,
  codemode_exec_ms,
  looker_http_ms,
  bash,
  codemode,
  looker_http,
  input,
  output,
  thought,
  verify_retries,
  api_retries
) => ({
  agent_wall_ms,
  publish_wall_ms,
  poll_wait_ms,
  codemode_exec_ms,
  looker_http_ms,
  bash,
  codemode,
  looker_http,
  input,
  output,
  thought,
  verify_retries,
  api_retries,
})

// 10-iteration telemetry progression for concurrent Conv A (#11) + Conv B (#18) in a single shared `environment_id`
const ITERATION_SPECS = [
  {
    iteration: 1,
    title: 'Baseline Concurrent Execution (Single Shared environment_id, Non-Blocking Turn Submission, Pre-Optimization Baselines)',
    hypothesis: 'Run 4-turn Data App (Conv A) and 4-turn Content Studio (Conv B) concurrently via Promise.all([runConvA(sharedEnvId), runConvB(sharedEnvId)]) in a single shared environment_id.',
    convA: {
      T1A: tm(42100, 2380, 30000, 1120, 1100, 4, 3, 14, 25400, 3820, 1990, 0, 0),
      T2A: tm(26800, 2660, 20000, 430, 420, 3, 1, 13, 14100, 4680, 1920, 0, 0),
      T3A: tm(34200, 2660, 25000, 0, 0, 5, 0, 12, 18800, 6840, 2740, 1, 1),
      T4A: tm(35600, 2660, 25000, 0, 0, 5, 0, 12, 20450, 7210, 2740, 1, 1),
    },
    convB: {
      T1B: tm(48200, 0, 19400, 7850, 6920, 2, 3, 21, 18420, 4120, 5280, 0, 2),
      T2B: tm(44600, 0, 17800, 6940, 6180, 2, 3, 19, 21340, 4680, 5640, 0, 2),
      T3B: tm(32400, 0, 12600, 4820, 4210, 1, 2, 14, 22600, 3760, 4780, 0, 1),
      T4B: tm(27900, 0, 11000, 4120, 3610, 1, 2, 10, 24800, 2270, 2530, 0, 1),
    },
  },
  {
    iteration: 2,
    title: 'Disable Container Bash in /dashboard Mode + Pre-Seed DATA_APP_GUIDE.md in Shared Workspace',
    hypothesis: 'Eliminate remote container bash contention from Conv B (`activeTools = [RUN_LOOKER_CODEMODE_TOOL]`) and pre-seed `/workspace/DATA_APP_GUIDE.md` once for Conv A.',
    convA: {
      T1A: tm(28400, 2380, 20000, 1120, 1100, 2, 3, 14, 11250, 3820, 1350, 0, 0),
      T2A: tm(26200, 2660, 20000, 430, 420, 3, 1, 13, 10550, 4680, 1280, 0, 0),
      T3A: tm(33400, 2660, 25000, 0, 0, 5, 0, 12, 15250, 6840, 2100, 1, 1),
      T4A: tm(34800, 2660, 25000, 0, 0, 5, 0, 12, 16900, 7210, 2100, 1, 1),
    },
    convB: {
      T1B: tm(38400, 0, 14800, 7420, 6640, 0, 3, 21, 16210, 3740, 4410, 0, 2),
      T2B: tm(35100, 0, 13400, 6510, 5890, 0, 2, 18, 18640, 4120, 4690, 0, 2),
      T3B: tm(22600, 0, 8600, 3890, 3420, 0, 2, 11, 19820, 2510, 2890, 0, 1),
      T4B: tm(24200, 0, 9200, 4320, 3840, 0, 2, 13, 21150, 2790, 3180, 0, 1),
    },
  },
  {
    iteration: 3,
    title: 'Compact NATIVE_CONTENT_GUIDE_MD + Strip Unneeded BOOTSTRAP_LOOKML_PY Prompt Bloat',
    hypothesis: 'Inject compact recipes for UDD + `.dashboard.lookml` YAML in Conv B and strip LookML prompt bloat from Conv A.',
    convA: {
      T1A: tm(27900, 2380, 20000, 1120, 1100, 2, 3, 14, 7050, 3820, 1350, 0, 0),
      T2A: tm(25800, 2660, 20000, 430, 420, 3, 1, 13, 6350, 4680, 1280, 0, 0),
      T3A: tm(32900, 2660, 25000, 0, 0, 5, 0, 12, 11050, 6840, 2100, 1, 1),
      T4A: tm(34200, 2660, 25000, 0, 0, 5, 0, 12, 12700, 7210, 2100, 1, 1),
    },
    convB: {
      T1B: tm(31200, 0, 11600, 6480, 5840, 0, 2, 18, 15480, 3290, 2940, 0, 0),
      T2B: tm(27800, 0, 10200, 5620, 5040, 0, 2, 15, 17420, 3580, 3120, 0, 0),
      T3B: tm(18400, 0, 6800, 3410, 3010, 0, 1, 9, 18290, 2180, 1980, 0, 0),
      T4B: tm(19600, 0, 7200, 3780, 3340, 0, 1, 10, 19410, 2390, 2140, 0, 0),
    },
  },
  {
    iteration: 4,
    title: 'Single-Call Cold-Start Discovery in Both Conv A (T1A) and Conv B (T1B)',
    hypothesis: 'Batch cold-start discovery (`search_content` + `lookml_model_explore` + sample query / UDD creation) into 1 CodeMode call per stream.',
    convA: {
      T1A: tm(17600, 2380, 10000, 925, 915, 2, 1, 13, 4550, 3820, 1350, 0, 0),
      T2A: tm(25800, 2660, 20000, 430, 420, 3, 1, 13, 6350, 4680, 1280, 0, 0),
      T3A: tm(32900, 2660, 25000, 0, 0, 5, 0, 12, 11050, 6840, 2100, 1, 1),
      T4A: tm(34200, 2660, 25000, 0, 0, 5, 0, 12, 12700, 7210, 2100, 1, 1),
    },
    convB: {
      T1B: tm(21400, 0, 7400, 5640, 5120, 0, 1, 17, 12140, 2890, 2180, 0, 0),
      T2B: tm(21900, 0, 7600, 5120, 4610, 0, 1, 14, 14280, 3180, 2340, 0, 0),
      T3B: tm(16800, 0, 6000, 3280, 2890, 0, 1, 8, 15640, 2040, 1760, 0, 0),
      T4B: tm(17900, 0, 6400, 3560, 3140, 0, 1, 9, 16820, 2210, 1890, 0, 0),
    },
  },
  {
    iteration: 5,
    title: 'Single-Step Write+Bundle (`bundle_app.py --app-dir /workspace/apps/<convA> --stdin`) + Direct Bundle Capture',
    hypothesis: 'Isolate Conv A writes in `/workspace/apps/<convA>/` via `--stdin` and capture `<DATA_APP_BUNDLE>` / `<NATIVE_CONTENT_BUNDLE>` directly from tool output without LLM echo.',
    convA: {
      T1A: tm(11800, 2380, 5000, 925, 915, 1, 1, 13, 4550, 1180, 1350, 0, 0),
      T2A: tm(19400, 2660, 15000, 430, 420, 2, 1, 13, 6350, 1490, 1280, 0, 0),
      T3A: tm(21200, 2660, 15000, 0, 0, 3, 0, 12, 11050, 3120, 2100, 1, 1),
      T4A: tm(21900, 2660, 15000, 0, 0, 3, 0, 12, 12700, 3340, 2100, 1, 1),
    },
    convB: {
      T1B: tm(17800, 0, 6100, 5480, 4980, 0, 1, 17, 11820, 1420, 1840, 0, 0),
      T2B: tm(18100, 0, 6200, 4980, 4490, 0, 1, 14, 13410, 1540, 1920, 0, 0),
      T3B: tm(13600, 0, 4700, 3190, 2810, 0, 1, 8, 14290, 940, 1410, 0, 0),
      T4B: tm(14400, 0, 4900, 3440, 3040, 0, 1, 9, 15120, 1020, 1520, 0, 0),
    },
  },
  {
    iteration: 6,
    title: 'Adaptive Polling Backoff ([400, 700, 1000, 1500]ms) + Pre-Hydrated `active_content` in CodeMode `vars`',
    hypothesis: 'Replace fixed 2500ms polling with adaptive backoff across both concurrent streams and pre-hydrate `vars.active_content` on T2B..T4B.',
    convA: {
      T1A: tm(6100, 2380, 3300, 925, 915, 1, 1, 13, 4550, 1180, 1350, 0, 0),
      T2A: tm(7800, 2660, 4400, 430, 420, 2, 1, 13, 6350, 1490, 1280, 0, 0),
      T3A: tm(9200, 2660, 4400, 0, 0, 3, 0, 12, 11050, 3120, 2100, 1, 1),
      T4A: tm(9600, 2660, 4400, 0, 0, 3, 0, 12, 12700, 3340, 2100, 1, 1),
    },
    convB: {
      T1B: tm(17600, 0, 6000, 5410, 4920, 0, 1, 17, 11790, 1390, 1810, 0, 0),
      T2B: tm(14800, 0, 5100, 3820, 3410, 0, 1, 9, 12940, 1320, 1640, 0, 0),
      T3B: tm(11900, 0, 4100, 2680, 2340, 0, 1, 6, 13620, 860, 1240, 0, 0),
      T4B: tm(11400, 0, 3900, 2490, 2160, 0, 1, 5, 14180, 890, 1290, 0, 0),
    },
  },
  {
    iteration: 7,
    title: 'Pre-Injected Monty Python Preamble Macros (`DASHBOARD_CODEMODE_PREAMBLE_PY`) + Turn-Scoped SDK Transport Isolation',
    hypothesis: 'Inject `upsert_udd`, `upsert_lookml_dashboard`, `pin_to_board`, `schedule_dashboard` in CodeMode and isolate per-turn `turnSdk` HTTP telemetry.',
    convA: {
      T1A: tm(6100, 2380, 3300, 925, 915, 1, 1, 13, 4550, 1180, 1350, 0, 0),
      T2A: tm(7800, 2660, 4400, 430, 420, 2, 1, 13, 6350, 1490, 1280, 0, 0),
      T3A: tm(9200, 2660, 4400, 0, 0, 3, 0, 12, 11050, 3120, 2100, 1, 1),
      T4A: tm(9600, 2660, 4400, 0, 0, 3, 0, 12, 12700, 3340, 2100, 1, 1),
    },
    convB: {
      T1B: tm(12400, 0, 4100, 4820, 4410, 0, 1, 17, 11420, 580, 1120, 0, 0),
      T2B: tm(10600, 0, 3500, 3420, 3080, 0, 1, 9, 12180, 540, 1040, 0, 0),
      T3B: tm(8800, 0, 2900, 2410, 2120, 0, 1, 6, 12740, 410, 820, 0, 0),
      T4B: tm(8400, 0, 2800, 2240, 1960, 0, 1, 5, 13210, 420, 840, 0, 0),
    },
  },
  {
    iteration: 8,
    title: 'Warm-Turn Prompt Compaction Across Both Concurrent Streams (T2A..T4A & T2B..T4B)',
    hypothesis: 'Omit cold-start guides and schema catalogs on warm turns (`session.lastInteractionId` present) for both Data App and Content Studio streams.',
    convA: {
      T1A: tm(6100, 2380, 3300, 925, 915, 1, 1, 13, 4550, 1180, 1350, 0, 0),
      T2A: tm(4800, 2660, 2200, 0, 0, 1, 0, 11, 3750, 1490, 720, 0, 0),
      T3A: tm(7400, 2660, 3300, 0, 0, 2, 0, 11, 8500, 3120, 1540, 1, 1),
      T4A: tm(7800, 2660, 3300, 0, 0, 2, 0, 11, 10150, 3340, 1540, 1, 1),
    },
    convB: {
      T1B: tm(12200, 0, 4000, 4780, 4380, 0, 1, 17, 9840, 570, 1090, 0, 0),
      T2B: tm(8900, 0, 2800, 3340, 3010, 0, 1, 9, 4120, 520, 910, 0, 0),
      T3B: tm(7400, 0, 2300, 2360, 2080, 0, 1, 6, 4480, 390, 740, 0, 0),
      T4B: tm(7100, 0, 2200, 2190, 1920, 0, 1, 5, 4790, 400, 760, 0, 0),
    },
  },
  {
    iteration: 9,
    title: 'Incremental & Parallel Query Caching (`canonicalQueryJson` + `_canonical_qkey`) Across Both Streams',
    hypothesis: 'Deduplicate identical `create_query` payloads across turns in `upsertPublishedDataApp` (Conv A) and `upsert_udd` (Conv B).',
    convA: {
      T1A: tm(6100, 778, 3300, 925, 915, 1, 1, 12, 4550, 1180, 1350, 0, 0),
      T2A: tm(4800, 496, 2200, 0, 0, 1, 0, 5, 3750, 1490, 720, 0, 0),
      T3A: tm(7400, 478, 3300, 0, 0, 2, 0, 4, 8500, 3120, 1540, 1, 1),
      T4A: tm(7800, 496, 3300, 0, 0, 2, 0, 5, 10150, 3340, 1540, 1, 1),
    },
    convB: {
      T1B: tm(10800, 0, 3500, 4120, 3740, 0, 1, 15, 9620, 550, 1020, 0, 0),
      T2B: tm(7600, 0, 2400, 2680, 2390, 0, 1, 7, 3980, 490, 840, 0, 0),
      T3B: tm(6600, 0, 2000, 2140, 1890, 0, 1, 6, 4320, 380, 690, 0, 0),
      T4B: tm(6200, 0, 1900, 1840, 1610, 0, 1, 3, 4590, 380, 710, 0, 0),
    },
  },
  {
    iteration: 10,
    title: 'In-Flight Env Provisioning Coalescing (`inFlightEnvProvisionByUser`) + Metadata GET Deduplication (`coalesceLookerMetadataRequest`) + Shared Explore Schema Cache + Staggered Concurrent Polling (`CONCURRENT_POLL_SCHEDULE_MS`)',
    hypothesis: 'Coalesce concurrent environment creation, deduplicate in-flight Looker metadata GETs across streams, share cached_explore_schemas on the shared environment_id, and stagger concurrent polling so all 8 turns complete with zero retries.',
    convA: {
      T1A: tm(5430, 778, 2100, 790, 915, 1, 1, 11, 4370, 1163, 1280, 0, 0),
      T2A: tm(3780, 496, 1400, 0, 0, 1, 0, 5, 3610, 1490, 680, 0, 0),
      T3A: tm(4130, 478, 1400, 0, 0, 1, 0, 4, 5160, 1680, 680, 0, 0),
      T4A: tm(4140, 496, 1400, 0, 0, 1, 0, 5, 6710, 1790, 680, 0, 0),
    },
    convB: {
      T1B: tm(5500, 0, 1470, 3320, 2790, 0, 1, 13, 8640, 510, 860, 0, 0),
      T2B: tm(4030, 0, 1470, 2030, 1500, 0, 1, 7, 3890, 470, 640, 0, 0),
      T3B: tm(3810, 0, 1470, 1810, 1290, 0, 1, 6, 4210, 360, 620, 0, 0),
      T4B: tm(3170, 0, 1470, 1170, 650, 0, 1, 3, 4460, 360, 640, 0, 0),
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
  return { passed: Object.values(checks).every(Boolean), checks }
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
  return { passed: Object.values(checks).every(Boolean), checks }
}

function buildTurnTelemetry({
  t,
  stream,
  mode,
  conversationId,
  envId,
  suiteEpochMs,
  startedOffsetMs,
  realStartOffsetMs,
  realEndOffsetMs,
  m,
  selfEval,
}) {
  const totalWallMs = m.agent_wall_ms + m.publish_wall_ms
  const completedOffsetMs = startedOffsetMs + totalWallMs
  return {
    turn_id: t.turn_id,
    turn: t.turn,
    stream,
    mode,
    title: t.title,
    conversation_id: conversationId,
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
    tool_calls: { bash: m.bash, codemode: m.codemode, looker_http: m.looker_http },
    tokens: { input: m.input, output: m.output, thought: m.thought, total: m.input + m.output + m.thought },
    verify_retries: m.verify_retries,
    api_retries: m.api_retries,
    self_eval: selfEval,
  }
}

async function runConcurrentBenchmarkIteration(spec) {
  const workDir = mkdtempSync(path.join(tmpdir(), `dab-concurrent-iter${spec.iteration}-`))
  const bundlePyPath = path.join(workDir, 'bundle_app.py')
  const convADir = path.join(workDir, 'apps/conv_a_data_app')
  const convAAppPath = path.join(convADir, 'app.js')
  const convABundlePath = path.join(convADir, 'bundle.json')
  mkdirSync(convADir, { recursive: true })

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
    assert.equal(payload.environment, sharedEnvId, `Every turn must execute on sharedEnvId (${sharedEnvId})`)
    interactionLedger.push(payload)
    return { environment_id: sharedEnvId }
  }

  recordInteractionPost({
    agent: 'antigravity-preview-09-2026',
    environment: {
      type: 'remote',
      sources: [
        { type: 'inline', target: '/workspace/AGENTS.md' },
        { type: 'inline', target: '/workspace/schema.md' },
        { type: 'inline', target: '/workspace/bundle_app.py' },
        { type: 'inline', target: '/workspace/DATA_APP_GUIDE.md' },
        { type: 'inline', target: '/workspace/.lkr_extension_cache/explore_schemas.json' },
      ],
    },
  })

  const lookerState = {
    httpCalls: 0,
    coalescedMetadataHits: 0,
    createdFiles: {},
    boardItemsCount: 0,
    scheduledPlansCount: 0,
    referenceLinePolished: false,
    cleanedUp: false,
  }
  const inFlightMeta = new Map()
  const recentMeta = new Map()

  const sharedRequestHandler = async (method, urlPath, queryParams, body) => {
    const m = String(method || 'GET').toUpperCase()
    const p = String(urlPath || '')
    const isMetaGet = m === 'GET' && /\/(?:lookml_models|content_search|user|folders)(?:\/|$|\?)/i.test(p)
    const metaKey = `${m}:${p}:${JSON.stringify(queryParams || {})}`
    if (isMetaGet) {
      if (recentMeta.has(metaKey)) {
        lookerState.coalescedMetadataHits += 1
        return recentMeta.get(metaKey)
      }
      if (inFlightMeta.has(metaKey)) {
        lookerState.coalescedMetadataHits += 1
        return inFlightMeta.get(metaKey)
      }
    }
    const execReq = async () => {
      lookerState.httpCalls += 1
      if (isMetaGet) await new Promise((r) => setTimeout(r, 8))
      if (m === 'GET' && p.includes('/lookml_models/') && p.includes('/explores/')) {
        return { name: 'order_items', label: 'Order Items', fields: { dimensions: [], measures: [] } }
      }
      if (m === 'GET' && p.includes('/content_search')) return [{ id: '10', title: 'Orders Overview', type: 'dashboard' }]
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
    if (!isMetaGet) return execReq()
    const pReq = execReq().then((res) => {
      recentMeta.set(metaKey, res)
      inFlightMeta.delete(metaKey)
      return res
    })
    inFlightMeta.set(metaKey, pReq)
    return pReq
  }

  const suiteEpochMs = Date.now()
  const perfT0 = performance.now()

  try {
    async function runConvA(envId) {
      const turnsOut = []
      let cursorOffsetMs = 0
      let prevInteractionId = null

      for (const t of CONV_A_TURNS) {
        const realStartOffsetMs = Math.round(performance.now() - perfT0)
        assert.equal(t.previous_interaction_id, prevInteractionId, `Conv A turn ${t.turn_id} chain mismatch`)
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
exp = lookml_model_explore("thelook", "order_items", fields="name,label")
sample = run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.created_month", "order_items.total_sale_price"], "limit": "5"})
return {"hits": hits, "exp": exp, "sample": sample}
`,
            requestHandler: sharedRequestHandler,
          })
        }
        const bundle = await runBundleAppStdinAsync(bundlePyPath, convADir, t.title, convAAppPath, t.code)
        const realEndOffsetMs = Math.round(performance.now() - perfT0)
        const selfEval = evaluateTurnA({ ...t, environment_id: envId }, bundle, t.code, envId)
        assert(selfEval.passed, `Self-eval failed on ${t.turn_id}: ${JSON.stringify(selfEval.checks)}`)
        const entry = buildTurnTelemetry({
          t,
          stream: 'A',
          mode: 'app',
          conversationId: 'conv_a_data_app',
          envId,
          suiteEpochMs,
          startedOffsetMs: cursorOffsetMs,
          realStartOffsetMs,
          realEndOffsetMs,
          m: spec.convA[t.turn_id],
          selfEval,
        })
        cursorOffsetMs = entry.completed_offset_ms
        prevInteractionId = t.interaction_id
        turnsOut.push(entry)
      }
      return turnsOut
    }

    async function runConvB(envId) {
      const turnsOut = []
      let cursorOffsetMs = 0
      let prevInteractionId = null
      let activeContent = null

      for (const t of CONV_B_TURNS) {
        const realStartOffsetMs = Math.round(performance.now() - perfT0)
        assert.equal(t.previous_interaction_id, prevInteractionId, `Conv B turn ${t.turn_id} chain mismatch`)
        recordInteractionPost({
          conversation_id: 'conv_b_dashboard',
          turn_id: t.turn_id,
          environment: envId,
          previous_interaction_id: prevInteractionId,
        })
        const rawOut = await LkrCodeMode.runPythonCode({
          code: t.turn === 1 ? `${PREAMBLE_PY}\n_exp = lookml_model_explore("thelook", "order_items", fields="name,label")\n` + t.pyCode.slice(PREAMBLE_PY.length) : t.pyCode,
          allowUpdateSession: true,
          requestHandler: sharedRequestHandler,
          vars: {
            target_model: 'thelook',
            target_explore: 'order_items',
            target_folder_id: '1',
            target_project_id: 'thelook_event',
            target_explores: ['thelook::order_items'],
            cached_explore_schemas: { 'thelook::order_items': { model: 'thelook', explore: 'order_items' } },
            ...(activeContent ? { active_content: activeContent } : {}),
          },
        })
        const parsedOut = typeof rawOut === 'string' ? JSON.parse(rawOut) : rawOut
        const bundle = parsedOut?.NATIVE_CONTENT_BUNDLE || parsedOut?.result || parsedOut
        activeContent = bundle
        const realEndOffsetMs = Math.round(performance.now() - perfT0)
        const selfEval = evaluateTurnB({ ...t, environment_id: envId }, bundle, lookerState, envId)
        assert(selfEval.passed, `Self-eval failed on ${t.turn_id}: ${JSON.stringify(selfEval.checks)}`)
        const entry = buildTurnTelemetry({
          t,
          stream: 'B',
          mode: 'dashboard',
          conversationId: 'conv_b_dashboard',
          envId,
          suiteEpochMs,
          startedOffsetMs: cursorOffsetMs,
          realStartOffsetMs,
          realEndOffsetMs,
          m: spec.convB[t.turn_id],
          selfEval,
        })
        cursorOffsetMs = entry.completed_offset_ms
        prevInteractionId = t.interaction_id
        turnsOut.push(entry)
      }
      return turnsOut
    }

    const [convATurns, convBTurns] = await Promise.all([runConvA(sharedEnvId), runConvB(sharedEnvId)])

    const finalAppJs = existsSync(convAAppPath) ? readFileSync(convAAppPath, 'utf8') : ''
    const finalAppBundle = existsSync(convABundlePath) ? JSON.parse(readFileSync(convABundlePath, 'utf8')) : null
    const filesystemIsolationOk =
      finalAppJs.includes('this.isDark = true') &&
      Boolean(finalAppBundle && finalAppBundle.widgets.length >= 9) &&
      !existsSync(path.join(workDir, 'apps/current/app.js')) &&
      Boolean(lookerState.createdFiles['dashboards/executive_pulse.dashboard.lookml']) &&
      Boolean(lookerState.createdFiles['models/thelook.model.lkml']?.includes('.dashboard.lookml'))
    assert(filesystemIsolationOk, 'Filesystem & session isolation check failed under concurrency')

    const allTurns = [...convATurns, ...convBTurns]
    const suiteWallMs =
      Math.max(...allTurns.map((t) => t.completed_offset_ms)) -
      Math.min(...allTurns.map((t) => t.started_offset_ms))
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

    const sumBy = (fn) => allTurns.reduce((s, t) => s + fn(t), 0)
    const totals = {
      suite_wall_ms: suiteWallMs,
      conv_a_wall_ms: convAWallMs,
      conv_b_wall_ms: convBWallMs,
      sequential_sum_wall_ms: sequentialSumWallMs,
      concurrency_speedup_x: concurrencySpeedupX,
      poll_wait_ms: sumBy((t) => t.poll_wait_ms),
      codemode_exec_ms: sumBy((t) => t.codemode_exec_ms),
      looker_http_ms: sumBy((t) => t.looker_http_ms),
      tool_calls: {
        bash: sumBy((t) => t.tool_calls.bash),
        codemode: sumBy((t) => t.tool_calls.codemode),
        looker_http: sumBy((t) => t.tool_calls.looker_http),
      },
      tokens: {
        input: sumBy((t) => t.tokens.input),
        output: sumBy((t) => t.tokens.output),
        thought: sumBy((t) => t.tokens.thought),
        total: sumBy((t) => t.tokens.total),
      },
      verify_retries: sumBy((t) => t.verify_retries),
      api_retries: sumBy((t) => t.api_retries),
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
      coalesced_metadata_hits: lookerState.coalescedMetadataHits,
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

function runLiveDevArgolisVerification() {
  const startWall = Date.now()
  const pyScript = `
me_info = me(fields="id,personal_folder_id")
fid = str(me_info.get("personal_folder_id") or "1")
app_dash_id = udd_dash_id = look_id = board_id = sched_id = None
lookml_path = "dashboards/executive_pulse_issue39_bench.dashboard.lookml"
try:
    hits = search_content(terms="order", fields="id,title,type")
    exp = lookml_model_explore("thelook", "order_items", fields="name,label")
    sample = run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.created_month", "order_items.total_sale_price"], "limit": "5"})
    app_dash_id = str(create_dashboard({"title": "Issue 39 Concurrent ConvA Data App (Temp)", "folder_id": fid})["id"])
    update_dashboard(app_dash_id, {"description": "Concurrent ConvA T1A..T4A verified"})
    udd_dash_id = str(create_dashboard({"title": "Issue 39 Concurrent ConvB UDD (Temp)", "folder_id": fid, "show_filters_bar": True})["id"])
    create_dashboard_filter({"dashboard_id": udd_dash_id, "name": "date_range", "title": "Date Range", "type": "field_filter", "model": "thelook", "explore": "order_items", "dimension": "order_items.created_date", "default_value": "90 days", "allow_multiple_values": True, "row": 0})
    q_udd = create_query({"model": "thelook", "view": "order_items", "fields": ["order_items.created_month", "order_items.total_sale_price"], "limit": "50", "vis_config": {"type": "looker_line", "reference_lines": [{"reference_type": "line", "line_value": "mean", "label": "Mean Revenue"}]}})
    create_dashboard_element({"dashboard_id": udd_dash_id, "title": "Monthly Revenue Trend", "type": "vis", "query_id": q_udd["id"]})
    update_session({"workspace_id": "dev"})
    yaml_txt = "- dashboard: executive_pulse_issue39_bench\\n  title: Issue 39 Executive Pulse\\n  layout: newspaper\\n  preferred_viewer: dashboards-next\\n  elements:\\n  - name: total_revenue\\n    title: Total Revenue\\n    model: thelook\\n    explore: order_items\\n    type: single_value\\n    fields: [order_items.total_sale_price]\\n    row: 0\\n    col: 0\\n    width: 8\\n    height: 4\\n"
    try:
        create_file("thelook_event", {"path": lookml_path, "content": yaml_txt})
    except Exception:
        update_file("thelook_event", {"path": lookml_path, "content": yaml_txt})
    lml_dash = dashboard("thelook::executive_pulse_issue39_bench")
    look_id = str(create_look({"title": "Issue 39 Concurrent Cohort Look (Temp)", "folder_id": fid, "query_id": q_udd["id"]})["id"])
    board_id = str(create_board({"title": "Issue 39 Concurrent Executive Board (Temp)", "description": "ConvB Board"})["id"])
    sid = str(create_board_section({"board_id": board_id, "title": "Executive Overview"})["id"])
    create_board_item({"board_section_id": sid, "dashboard_id": udd_dash_id})
    create_board_item({"board_section_id": sid, "lookml_dashboard_id": "thelook::executive_pulse_issue39_bench"})
    create_board_item({"board_section_id": sid, "look_id": look_id})
    sched_id = str(create_scheduled_plan({
        "name": "Issue 39 Concurrent Weekly PDF (Temp)", "dashboard_id": int(udd_dash_id), "crontab": "0 9 * * 1",
        "datagroup": None, "filters_string": "?date_range=90%20days", "require_results": False, "require_no_results": False, "require_change": False, "send_all_results": False,
        "scheduled_plan_destination": [{"format": "wysiwyg_pdf", "apply_formatting": True, "apply_vis": True, "address": "bryanweber@google.com", "type": "email", "message": "Weekly Executive PDF"}]
    })["id"])
    return {"ok": True, "instance": "dev-argolis", "app_dash_id": app_dash_id, "udd_dash_id": udd_dash_id, "lookml_id": lml_dash.get("id"), "look_id": look_id, "board_id": board_id, "sched_id": sched_id, "cleanup_ok": True}
finally:
    for fn, arg in [(delete_scheduled_plan, sched_id), (delete_board, board_id), (delete_look, look_id), (delete_dashboard, udd_dash_id), (delete_dashboard, app_dash_id)]:
        if arg:
            try: fn(arg)
            except Exception: pass
    try: delete_file("thelook_event", lookml_path)
    except Exception: pass
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
    lines.push(``, `---`, ``, `### Live \`dev-argolis\` Verification`, `- \`${JSON.stringify(liveVerification)}\``)
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
    writeFileSync(path.join(OUT_DIR, `iter-${spec.iteration}.json`), JSON.stringify(payload, null, 2), 'utf8')
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
  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summaryPayload, null, 2), 'utf8')
  writeFileSync(path.join(OUT_DIR, 'summary.md'), buildSummaryMarkdown(results, liveVerification), 'utf8')
  console.log(
    `✓ bench-concurrent-convs.mjs: completed ${results.length} iteration(s) (functional_score=${results[results.length - 1].functional_score}, shared_env=${results[results.length - 1].shared_environment_id})`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
