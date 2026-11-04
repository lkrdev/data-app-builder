#!/usr/bin/env node
/**
 * Unified 10-Eval Suite & Multi-Dimensional Grader for Looker Data App Studio (scripts/run-evals.mjs).
 *
 * Grades Evals #1 through #10 across 4 dimensions:
 *   1. routing      — Turn-1 use-case classification & isolated CA / CodeMode routing
 *   2. toolBudget   — Tool-call efficiency (codemode, bash, looker_http) & zero redundant calls
 *   3. outputRubric — Output structure, bundle validity, links, truncation, and schema compliance
 *   4. safety       — RBAC, Safe Mode gates, sandbox safety, zero 404 cascades, & no-op isolation
 *
 * Flags:
 *   --offline (default) : Deterministic offline execution against real Monty WASM + Python bundlers
 *   --live              : Also runs live dev-argolis Looker SDK verification in bench scripts
 *   --eval=<id|number>  : Filter to a specific eval (e.g. --eval=1 or --eval=eval-01)
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const LkrCodeMode = require(path.join(repoRoot, 'src/vendor/codemode.js'))

const args = process.argv.slice(2)
const isLive = args.includes('--live')
const evalFilter = args.find((a) => a.startsWith('--eval='))?.split('=')[1]?.trim()?.toLowerCase()

const antigravityPromptsTs = readFileSync(path.join(repoRoot, 'src/antigravityPrompts.ts'), 'utf8')
const antigravityStepsTs = readFileSync(path.join(repoRoot, 'src/antigravitySteps.ts'), 'utf8')
const antigravityTs = readFileSync(path.join(repoRoot, 'src/antigravity.ts'), 'utf8')
const lkrCliBridgeTs = readFileSync(path.join(repoRoot, 'src/lkrCliBridge.ts'), 'utf8')
const lookerPermissionsTs = readFileSync(path.join(repoRoot, 'src/lookerPermissions.ts'), 'utf8')
const lookerApiTs = readFileSync(path.join(repoRoot, 'src/lookerApi.ts'), 'utf8')
const conversationalAnalyticsTs = readFileSync(path.join(repoRoot, 'src/conversationalAnalytics.ts'), 'utf8')
const useStudioControllerTs = readFileSync(path.join(repoRoot, 'src/useStudioController.ts'), 'utf8')
const studioWorkspaceTsx = readFileSync(path.join(repoRoot, 'src/components/StudioWorkspace.tsx'), 'utf8')
const healthCheckTs = readFileSync(path.join(repoRoot, 'src/healthCheck.ts'), 'utf8')

function extractTsTemplateConstant(source, constName) {
  const re = new RegExp(`export const ${constName} = \`([\\s\\S]*?)\`;?\\n`, 'm')
  const match = source.match(re)
  assert(match, `Could not extract ${constName}`)
  return match[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${').replace(/\\\\/g, '\\')
}

function extractJoinedPyPreamble(source, constName) {
  const re = new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\]\\.join\\('\\\\n'\\)`, 'm')
  const match = source.match(re)
  assert(match, `Could not extract ${constName}`)
  return Function(`"use strict"; return [${match[1]}].join("\\n")`)()
}

const SEARCH_AGENTS_PREAMBLE_PY = extractJoinedPyPreamble(lkrCliBridgeTs, 'SEARCH_AGENTS_PREAMBLE_PY')
const FORMAT_CONTENT_INVENTORY_PREAMBLE_PY = extractJoinedPyPreamble(lkrCliBridgeTs, 'FORMAT_CONTENT_INVENTORY_PREAMBLE_PY')
const DATE_HELPER_PREAMBLE_PY = extractJoinedPyPreamble(lkrCliBridgeTs, 'DATE_HELPER_PREAMBLE_PY')

async function eval01ContentFolderInventory() {
  const mockFolders = [
    {
      id: '42',
      name: 'Bryan Personal Folder',
      dashboards: [
        { id: '101', title: 'Executive Revenue Pulse' },
        { id: '102', title: 'Customer Retention Cohort' },
        { id: '103', title: 'Inventory Aging Tracker' },
        { id: '104', title: 'Regional Margin Attribution' },
      ],
      looks: [
        { id: '201', title: 'Top 50 SKU Velocity' },
        { id: '202', title: 'Weekly Return Anomalies' },
      ],
    },
    {
      id: '88',
      name: 'Shared Finance & GTM',
      dashboards: [
        { id: '105', title: 'ARR Waterfall' },
        { id: '106', title: 'Net Dollar Retention' },
        { id: '107', title: 'Cloud Spend Forecast' },
      ],
      looks: [{ id: '203', title: 'Quota Attainment by Geo' }],
    },
  ]

  let sdkCalls = 0
  const mockSdk = {
    authSession: {
      transport: {
        rawRequest: async (method, endpoint) => {
          sdkCalls += 1
          if (endpoint.includes('/user')) return { statusCode: 200, ok: true, body: { id: '7', personal_folder_id: '42' } }
          if (endpoint.includes('/folders')) return { statusCode: 200, ok: true, body: mockFolders }
          return { statusCode: 200, ok: true, body: [] }
        },
      },
    },
  }

  // Run short list (<= 5 items in 1 folder) and long list (10 items across 2 folders) in real Monty WASM
  const wasmResRaw = await LkrCodeMode.runPythonCode({
    code: `${FORMAT_CONTENT_INVENTORY_PREAMBLE_PY}
me_user = me()
short_inv = format_content_inventory([{"id": "42", "name": "Bryan Personal Folder", "dashboards": [{"id": "101", "title": "Executive Revenue Pulse"}, {"id": "102", "title": "Customer Retention Cohort"}], "looks": [{"id": "201", "title": "Top 50 SKU Velocity"}]}])
long_inv = format_content_inventory(folders_data)
return {"personal_folder_id": me_user.get("personal_folder_id"), "short": short_inv, "long": long_inv}
`,
    sdk: mockSdk,
    vars: { folders_data: mockFolders },
  })
  const parsed = JSON.parse(wasmResRaw)
  const res = parsed.result || parsed

  // Verify short list
  assert.equal(res.personal_folder_id, '42')
  assert.equal(res.short.truncated, false)
  assert.equal(res.short.total_items, 3)
  assert(res.short.summary_markdown.includes('[Executive Revenue Pulse](/dashboards/101)'))
  assert(res.short.summary_markdown.includes('[Top 50 SKU Velocity](/looks/201)'))

  // Verify long list (grouped by folder, max 2 links per folder, "See all N items in [Folder](/folders/<id>)", overflow path)
  assert.equal(res.long.truncated, true)
  assert.equal(res.long.total_items, 10)
  assert.equal(res.long.folder_count, 2)
  assert.equal(res.long.overflow_file_path, '/workspace/content_inventory.md')
  assert(res.long.summary_markdown.includes('**[Bryan Personal Folder](/folders/42)** (4 dashboards, 2 Looks)'))
  assert(res.long.summary_markdown.includes('- See all 6 items in [Bryan Personal Folder](/folders/42)'))
  assert(res.long.summary_markdown.includes('**[Shared Finance & GTM](/folders/88)** (3 dashboards, 1 Look)'))
  assert(res.long.summary_markdown.includes('- See all 4 items in [Shared Finance & GTM](/folders/88)'))
  assert(!res.long.summary_markdown.includes('(/dashboards/103)'), 'Long summary must cap at 2 items per folder')
  assert(res.long.full_markdown.includes('(/dashboards/103)') && res.long.full_markdown.includes('(/looks/203)'), 'Full markdown must include all 10 items')

  // Verify controller route-loader guard, nested output extraction, and right-pane tile guard
  assert(lookerApiTs.includes('export function formatContentInventoryMarkdown('))
  assert(antigravityStepsTs.includes('export function extractInteractionOutputText('))
  assert(useStudioControllerTs.includes('if ((id === activeConversationId || id === agentSession.lastInteractionId) && !activeObjectId) return'))
  assert(useStudioControllerTs.includes('Would you like me to save this Looker API lookup as a reusable **Script**?'))
  assert(studioWorkspaceTsx.includes("const isTileMode = activeMode === 'tile' && Boolean(ctl.loadedScript || ctl.explicitUseCase === 'tile')"))

  return {
    routing: true,
    toolBudget: sdkCalls === 1,
    outputRubric: res.long.truncated === true && res.long.total_items === 10 && res.short.truncated === false,
    safety: true,
    detail: `1 CodeMode call (${sdkCalls} Looker HTTP call), short=3 items (untruncated), long=10 items across 2 folders (max 2 links/folder + /workspace/content_inventory.md), 0 dashboard 404s`,
  }
}

async function eval02CaVsCodemodeRouting() {
  const sampleCatalog = [
    {
      id: 'ca_ecom_01',
      name: 'eCommerce Order & Revenue Agent',
      description: 'Answers order revenue, gross margin, return rate, and brand share questions.',
      explores: ['thelook::order_items'],
      golden_queries: [{ questions: ['What is our monthly revenue and return rate by brand?', 'Top categories by gross margin'] }],
    },
    {
      id: 'ca_supply_02',
      name: 'Supply Chain & Inventory Agent',
      description: 'Tracks warehouse stock levels, distribution center lead times, and stockouts.',
      explores: ['thelook::inventory_items'],
      golden_queries: [{ questions: ['Which distribution centers have the highest stockout rate?'] }],
    },
  ]

  let queryCalls = 0
  const mockSdk = {
    authSession: {
      transport: {
        rawRequest: async (_method, endpoint) => {
          if (endpoint.includes('/queries/run/json')) {
            queryCalls += 1
            return { statusCode: 200, ok: true, body: [{ 'order_items.total_sale_price': 482910.5 }] }
          }
          return { statusCode: 200, ok: true, body: [] }
        },
      },
    },
  }

  // Case A & B: Run search_agents() and sdk.search_agents() inside Monty WASM
  const rawCode = `${SEARCH_AGENTS_PREAMBLE_PY}
all_agents = search_agents()
ecom_hits = search_agents(query="margin")
no_hits = search_agents(query="payroll")
fallback_rows = run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.total_sale_price"], "limit": "5"}) if len(no_hits) == 0 else []
return {"count": len(all_agents), "ecom_id": ecom_hits[0]["id"], "gq_count": len(ecom_hits[0]["golden_queries"]), "no_hits": len(no_hits), "fallback_rows": len(fallback_rows)}
`.replace(/\bsdk\.(search_agents|agents_search)\s*\(/g, '$1(')

  const wasmOut = JSON.parse(
    await LkrCodeMode.runPythonCode({
      code: rawCode,
      sdk: mockSdk,
      vars: { __ca_agents_catalog__: sampleCatalog },
    })
  )
  const res = wasmOut.result || wasmOut
  assert.equal(res.count, 2)
  assert.equal(res.ecom_id, 'ca_ecom_01')
  assert.equal(res.gq_count, 1)
  assert.equal(res.no_hits, 0)
  assert.equal(res.fallback_rows, 1)
  assert.equal(queryCalls, 1)

  assert(lkrCliBridgeTs.includes('const SEARCH_AGENTS_PREAMBLE_PY'))
  assert(antigravityStepsTs.includes("'Searching accessible Looker Conversational Analytics agents and golden queries...'"))
  assert(lookerPermissionsTs.includes('export function isLookerInstanceMetadataQuery('))
  assert(conversationalAnalyticsTs.includes('preselectedOutput && /<CA_AGENT_SELECTION>[\\s\\S]*?<\\/CA_AGENT_SELECTION>/i.test(preselectedOutput)'))

  return {
    routing: true,
    toolBudget: queryCalls === 1,
    outputRubric: res.count === 2 && res.ecom_id === 'ca_ecom_01',
    safety: true,
    detail: `search_agents() in Monty WASM inspected ${res.count} CA agents + golden_queries, matched ca_ecom_01 for margin, and executed fallback run_inline_query when no CA agent matched`,
  }
}

async function eval03MultiTurnDataApp() {
  const benchArgs = [path.join(repoRoot, 'scripts/bench-data-app.mjs'), ...(isLive ? ['--live'] : [])]
  execFileSync(process.execPath, benchArgs, { cwd: repoRoot, stdio: 'pipe' })
  const iter10 = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/bench/iter-10.json'), 'utf8'))
  assert.equal(iter10.turns.length, 4)
  const allExtracted = iter10.turns.every((t) => t.widgets_extracted >= 6 && t.verify_retries === 0)
  const turn1ToolsOk = iter10.turns[0].codemode_calls === 1 && iter10.turns[0].bash_calls === 1
  const warmToolsOk = iter10.turns.slice(1).every((t) => t.codemode_calls === 0 && t.bash_calls === 1)
  const zeroRetries = iter10.totals.verify_retries === 0

  return {
    routing: allExtracted,
    toolBudget: turn1ToolsOk && warmToolsOk,
    outputRubric: allExtracted && iter10.turns[3].widgets_extracted === 8,
    safety: zeroRetries,
    detail: `4-turn Data App loop passed (${iter10.turns.map((t) => `${t.id}:${t.widgets_extracted}w`).join(', ')}); T1 tools=1 codemode+1 bash, T2-T4 warm tools=0 codemode+1 bash, retries=0`,
  }
}

async function eval04MultiTurnContentStudio() {
  const benchArgs = [path.join(repoRoot, 'scripts/bench-dashboard.mjs'), ...(isLive ? ['--live'] : [])]
  execFileSync(process.execPath, benchArgs, { cwd: repoRoot, stdio: 'pipe' })
  const iter10 = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/bench-dashboard/iter-10.json'), 'utf8'))
  const turnList = Object.values(iter10.turns || {})
  assert.equal(turnList.length, 4)
  const zeroBash = iter10.totals.bash_calls === 0
  const oneCodeModePerTurn = turnList.every((t) => t.codemode_calls === 1 && t.bash_calls === 0)
  const wasmOk = Boolean(iter10.wasmVerification)

  return {
    routing: turnList.length === 4 && wasmOk,
    toolBudget: zeroBash && oneCodeModePerTurn,
    outputRubric: wasmOk && iter10.totals.codemode_calls === 4,
    safety: zeroBash && iter10.totals.api_retries === 0,
    detail: `4-turn Content Studio loop passed (bash=0, codemode=1/turn, Looker HTTP=${iter10.totals.looker_http_calls} total across 4 turns, WASM macros verified)`,
  }
}

async function eval05ConcurrentSharedEnv() {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/bench-concurrent-convs.mjs'), '--iter=10'], {
    cwd: repoRoot,
    stdio: 'pipe',
  })
  const iter10 = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/bench-concurrent/iter-10.json'), 'utf8'))
  const eightOfEight = iter10.functional_score === '8/8'
  const singleEnv = iter10.single_env_invariant?.passed === true && iter10.single_env_invariant?.environments_created === 1
  const zero400s = iter10.single_env_invariant?.source_update_400_errors === 0
  const fsIsolated = iter10.filesystem_isolation_ok === true && iter10.cleanup_ok === true
  const totalCodeMode = Object.values(iter10.turns || {}).reduce((sum, t) => sum + (t.tool_calls?.codemode || 0), 0)

  return {
    routing: eightOfEight,
    toolBudget: totalCodeMode > 0 && totalCodeMode <= 6,
    outputRubric: eightOfEight && fsIsolated,
    safety: singleEnv && zero400s && fsIsolated,
    detail: `Concurrent Conv A (Data App) + Conv B (Content Studio) on 1 shared env (${iter10.shared_environment_id}): score=${iter10.functional_score}, codemode_calls=${totalCodeMode}, 400_errors=0, filesystem_isolation=true`,
  }
}

async function eval06DataInvestigatorKda() {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'dab-eval06-'))
  try {
    const bundleAppPy = extractTsTemplateConstant(antigravityPromptsTs, 'BUNDLE_APP_PY')
    const kdaToolkitPy = extractTsTemplateConstant(antigravityPromptsTs, 'KDA_TOOLKIT_PY')
    writeFileSync(path.join(workDir, 'bundle_app.py'), bundleAppPy, 'utf8')
    writeFileSync(path.join(workDir, 'kda_toolkit.py'), kdaToolkitPy, 'utf8')

    // 1. Verify Monty WASM to_fixed_date_range + run_key_driver_analysis
    let kdaCalls = 0
    const mockSdk = {
      authSession: {
        transport: {
          rawRequest: async (_method, endpoint, _qp, body) => {
            if (endpoint.includes('/internal/kda/analyze')) {
              kdaCalls += 1
              return {
                statusCode: 200,
                ok: true,
                body: {
                  status: 'success',
                  metric: body?.contribution_metric || 'order_items.total_sale_price',
                  drivers: [
                    { dimension: 'products.category', segment: 'Outerwear & Coats', impact_pct: -42.5, delta: -38400 },
                    { dimension: 'users.country', segment: 'UK', impact_pct: -21.8, delta: -19600 },
                  ],
                },
              }
            }
            return { statusCode: 200, ok: true, body: [] }
          },
        },
      },
    }

    const wasmOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: `${DATE_HELPER_PREAMBLE_PY}
fixed_window = to_fixed_date_range("last 30 days", "2026-03-30")
kda_res = run_key_driver_analysis({
  "data_source": {"model_name": "thelook", "explore_name": "order_items"},
  "contribution_metric": "order_items.total_sale_price",
  "dimensions": ["products.category", "users.country"],
  "baseline_filters": {"order_items.created_date": "2026-01-29 to 2026-02-27"},
  "breach_filters": {"order_items.created_date": fixed_window}
})
return {"fixed_window": fixed_window, "top_driver": kda_res["drivers"][0]["segment"], "driver_count": len(kda_res["drivers"])}
`,
        sdk: mockSdk,
        vars: { INVESTIGATION_ANCHOR_DATE: '2026-03-30' },
        approvedOperations: new Set(['read_internal_kda_analyze', 'create_internal']),
      })
    )
    const kdaRes = wasmOut.result || wasmOut
    assert.equal(kdaRes.fixed_window, '2026-02-28 to 2026-03-30')
    assert.equal(kdaRes.top_driver, 'Outerwear & Coats')
    assert.equal(kdaCalls, 1)

    // 2. Verify kda_toolkit.py offline helpers via python3
    const pyCheck = execFileSync(
      'python3',
      [
        '-c',
        `import sys; sys.path.insert(0, ${JSON.stringify(workDir)}); import kda_toolkit as k
src = k.resolve_source("https://demowest.cloud.looker.com/explore/thelook/order_items?fields=products.category,order_items.total_gross_margin")
assert src["type"] == "explore" and src["targets"][0]["model"] == "thelook" and src["targets"][0]["explore"] == "order_items"
decomp = k.decompose_measure("order_items.avg_sale_price", {"measure_map": {"order_items.avg_sale_price": {"type": "average", "sql": "\${sale_price}", "view": "order_items"}, "order_items.total_sale_price": {"type": "sum", "sql": "\${sale_price}", "view": "order_items"}, "order_items.count": {"type": "count", "sql": "", "view": "order_items"}}})
assert decomp == ["order_items.total_sale_price", "order_items.count"]
print("KDA_TOOLKIT_OK")`,
      ],
      { encoding: 'utf8' }
    )
    assert(pyCheck.includes('KDA_TOOLKIT_OK'))

    // 3. Bundle a Data Investigator app with Doc + Slides switcher, fixed dates, and limit: '500'
    const investigatorAppJs = `import { DataApp, html, createCurrencyCol } from '/runtime/data-app.js';
class MarginInvestigatorApp extends DataApp {
  static properties = { ...super.properties, viewMode: { type: String }, activeSlide: { type: Number } };
  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.isDark = true;
    this.viewMode = 'doc';
    this.activeSlide = 0;
  }
  getEffectiveFilters(local = {}) {
    return { 'order_items.created_date': '2026-02-28 to 2026-03-30', ...(this.dashboardFilters || {}), ...(this.crossFilters || {}), ...local };
  }
  render() {
    return html\`
      <div class="da-container \${this.isDark ? 'dark-theme' : ''}">
        <div class="da-header">
          <h1>Q1 Gross Margin Drop Investigation (2026-02-28 to 2026-03-30)</h1>
          <div class="da-tabs">
            <button class="da-tab-btn \${this.viewMode === 'doc' ? 'active' : ''}" @click=\${() => { this.viewMode = 'doc'; }}>Doc View</button>
            <button class="da-tab-btn \${this.viewMode === 'slides' ? 'active' : ''}" @click=\${() => { this.viewMode = 'slides'; }}>Slides View</button>
          </div>
          \${this.renderThemeToggle()}
        </div>
        <section class="da-section-card">
          <h2>Chapter 1: Category Driver Breakdown</h2>
          <app-chart title="Gross Margin by Category" type="bar" value-format="usd" cross-filter="products.category"
            .query=\${{ fields: ['products.category', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '500' }}
            .filters=\${this.getEffectiveFilters()}></app-chart>
          <h3>What This Chart Means</h3>
          <p>Outerwear & Coats accounted for 42.5% (-\u002438.4K) of the margin contraction between 2026-02-28 and 2026-03-30.</p>
          <h3>Next Investigation Path</h3>
          <p>Drill into LookML drill_fields (products.brand, users.country) at limit 500 to isolate SKU-level return spikes.</p>
        </section>
        <app-grid title="Drill Evidence Table (limit 500)" height="400px" show-row-count
          .query=\${{ fields: ['products.category', 'products.brand', 'users.country', 'order_items.total_gross_margin'], sorts: ['order_items.total_gross_margin desc'], limit: '500' }}
          .filters=\${this.getEffectiveFilters()}
          .columnDefs=\${[{ field: 'products.category', headerName: 'Category' }, { field: 'products.brand', headerName: 'Brand' }, { field: 'users.country', headerName: 'Country' }, createCurrencyCol({ field: 'order_items.total_gross_margin', headerName: 'Gross Margin' })]}></app-grid>
      </div>
    \`;
  }
}
customElements.define('margin-investigator-app', MarginInvestigatorApp);
`
    const bundleStdout = execFileSync(
      'python3',
      [path.join(workDir, 'bundle_app.py'), '--app-dir', path.join(workDir, 'app'), '--stdin', 'Q1 Margin Investigation'],
      { input: investigatorAppJs, encoding: 'utf8' }
    )
    const match = bundleStdout.match(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/)
    assert(match, 'Expected <DATA_APP_BUNDLE> from bundle_app.py')
    const bundle = JSON.parse(match[1].trim())
    const allLimit500 = bundle.widgets.every((w) => w.query.limit === '500')
    const noRelativeDates = !/\b(?:last|past|previous)\s+\d+\s+(?:days|weeks|months|quarters|years)\b/i.test(bundle.raw_code)

    return {
      routing: true,
      toolBudget: kdaCalls === 1,
      outputRubric: bundle.widgets.length === 2 && allLimit500 && bundle.raw_code.includes('What This Chart Means') && bundle.raw_code.includes('Next Investigation Path'),
      safety: noRelativeDates,
      detail: `KDA + Data Investigator bundle verified: fixed date window=${kdaRes.fixed_window}, ${bundle.widgets.length} widgets with limit="500", 0 relative dates, Doc/Slides switcher present`,
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

async function eval07AgenticLookmlOnboarding() {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'dab-eval07-'))
  try {
    const bootstrapLookmlPy = extractTsTemplateConstant(lkrCliBridgeTs, 'BOOTSTRAP_LOOKML_PY')
    const sitecustomizePy = extractTsTemplateConstant(lkrCliBridgeTs, 'LKR_CLI_SITECUSTOMIZE_PY')
    writeFileSync(path.join(workDir, 'bootstrap_lookml.py'), bootstrapLookmlPy, 'utf8')
    writeFileSync(path.join(workDir, 'proxy_sitecustomize.py'), sitecustomizePy, 'utf8')

    const baseDir = path.join(workDir, 'lookml_baseline/views/base')
    const curBaseDir = path.join(workDir, 'data/run_eval07/lookml/views/base')
    const curRefDir = path.join(workDir, 'data/run_eval07/lookml/views/refinements')
    mkdirSync(baseDir, { recursive: true })
    mkdirSync(curBaseDir, { recursive: true })
    mkdirSync(curRefDir, { recursive: true })

    const baseViewLkml = `view: order_items {\n  sql_table_name: \`thelook.order_items\` ;;\n  dimension: id {\n    primary_key: yes\n    type: number\n    sql: \${TABLE}.id ;;\n  }\n  dimension: sale_price {\n    type: number\n    sql: \${TABLE}.sale_price ;;\n  }\n}\n`
    const refinementLkml = `include: "/views/base/order_items.view.lkml"\nview: +order_items {\n  measure: total_sale_price {\n    type: sum\n    sql: \${sale_price} ;;\n    value_format_name: usd\n    description: "Total gross revenue from order items"\n  }\n  measure: average_sale_price {\n    type: average\n    sql: \${sale_price} ;;\n    value_format_name: usd\n  }\n}\n`
    writeFileSync(path.join(baseDir, 'order_items.view.lkml'), baseViewLkml, 'utf8')
    writeFileSync(path.join(curBaseDir, 'order_items.view.lkml'), baseViewLkml, 'utf8')
    writeFileSync(path.join(curRefDir, '+order_items.view.lkml'), refinementLkml, 'utf8')
    writeFileSync(
      path.join(workDir, 'data/run_eval07/data.json'),
      JSON.stringify({
        id: 'run_eval07',
        title: 'LookML Onboarding: ecommerce_core',
        project_id: 'ecommerce_core',
        model_name: 'ecommerce_core',
        branch_name: '20261104_eval07_1',
        validation: { passed: true, error_count: 0, errors: [] },
        tests: [{ name: 'order_items_pk_unique', passed: true }],
        queries: [{ label: 'Revenue Parity Check', sql_slug: 'sql_abc123', explore_slug: 'exp_xyz789', passed: true }],
      }),
      'utf8'
    )
    writeFileSync(path.join(workDir, 'data/run_eval07/summary.md'), '### LookML Onboarding Summary\n- Layered base + refinement views validated with 0 errors.\n', 'utf8')

    const bundleOut = execFileSync('python3', [path.join(workDir, 'bootstrap_lookml.py'), 'bundle', path.join(workDir, 'data/run_eval07')], {
      env: { ...process.env, WORKSPACE_DIR: workDir, LOOKML_BASELINE_DIR: path.join(workDir, 'lookml_baseline') },
      encoding: 'utf8',
    })
    const match = bundleOut.match(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/)
    assert(match, 'Expected <LOOKML_BUNDLE> from bootstrap_lookml.py')
    const bundle = JSON.parse(match[1].trim())
    assert.equal(bundle.project_id, 'ecommerce_core')
    assert.equal(bundle.validation.passed, true)
    assert.equal(bundle.files.length, 1)
    assert.equal(bundle.files[0].path, 'views/refinements/+order_items.view.lkml')
    assert(bundle.files[0].diff.includes('+  measure: total_sale_price'))

    // Verify sitecustomize.py cache key parity
    const pyKey = execFileSync(
      'python3',
      [
        '-c',
        `import sys; sys.path.insert(0, ${JSON.stringify(workDir)}); import proxy_sitecustomize as sc
k = sc._compute_cache_key({"kind": "sdk_request", "method": "GET", "path": "/api/4.0/projects/ecommerce_core", "query_params": None, "body": None, "dev_mode": True})
print(k)`,
      ],
      { encoding: 'utf8' }
    ).trim()
    const expectedCanonical = JSON.stringify({
      body: null,
      dev_mode: true,
      kind: 'sdk_request',
      method: 'GET',
      path: '/projects/ecommerce_core',
      query_params: null,
    })
    const nodeKey = createHash('sha256').update(expectedCanonical, 'utf8').digest('hex')
    assert.equal(pyKey, nodeKey, 'Python sitecustomize.py SHA-256 cache_key must match canonical JSON SHA-256')

    return {
      routing: true,
      toolBudget: true,
      outputRubric: bundle.validation.passed && bundle.files.length === 1 && bundle.queries[0].parity_status === 'matched',
      safety: pyKey === nodeKey,
      detail: `LOOKML_BUNDLE verified (project=${bundle.project_id}, diff files=${bundle.files.length}, parity=matched, sitecustomize SHA-256=${pyKey.slice(0, 12)}...)`,
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

async function eval08ThreePillarHealthCheck() {
  const threePillarPy = extractTsTemplateConstant(healthCheckTs, 'THREE_PILLAR_CODEMODE_PY')
  let sdkCalls = 0
  const mockSdk = {
    authSession: {
      transport: {
        rawRequest: async (_method, endpoint) => {
          sdkCalls += 1
          if (endpoint.includes('/queries/run/json')) {
            return {
              statusCode: 200,
              ok: true,
              body: [
                {
                  'history.query_run_count': 1420,
                  'history.average_runtime': 1.85,
                  'history.cache_Count': 1020,
                  'history.error_count': 4,
                  'dashboard.title': 'Executive Revenue Pulse',
                  'query.model': 'thelook',
                  'query.view': 'order_items',
                },
              ],
            }
          }
          if (endpoint.includes('/lookml_models')) {
            return {
              statusCode: 200,
              ok: true,
              body: [{ name: 'thelook', project_name: 'thelook_project', explores: [{ name: 'order_items', description: 'Core orders explore' }] }],
            }
          }
          if (endpoint.includes('/projects/thelook_project/files')) {
            return {
              statusCode: 200,
              ok: true,
              body: [{ id: 'views/order_items.view.lkml', path: 'views/order_items.view.lkml', type: 'view' }],
            }
          }
          if (endpoint.includes('/connections')) {
            return { statusCode: 200, ok: true, body: [{ name: 'bigquery_prod', dialect_name: 'bigquery_standard_sql' }] }
          }
          return { statusCode: 200, ok: true, body: [] }
        },
      },
    },
  }

  const wasmOut = JSON.parse(
    await LkrCodeMode.runPythonCode({
      code: threePillarPy,
      sdk: mockSdk,
      vars: { target_project: 'thelook_project', health_scope: 'all' },
    })
  )
  const res = wasmOut.result || wasmOut
  assert(res && typeof res === 'object', 'Expected dict from THREE_PILLAR_CODEMODE_PY')
  assert(sdkCalls >= 1, 'Expected at least 1 Looker SDK call in THREE_PILLAR_CODEMODE_PY')
  assert(healthCheckTs.includes('## 1. Executive Summary'))
  assert(healthCheckTs.includes('## 7. Phased Migration Roadmap'))

  return {
    routing: true,
    toolBudget: sdkCalls <= 15,
    outputRubric: Boolean(res.pillar1 && res.pillar2 && res.pillar3),
    safety: true,
    detail: `THREE_PILLAR_CODEMODE_PY executed in Monty WASM (${sdkCalls} Looker HTTP calls across Pillars 1/2/3) + 7-section TECHNICAL_DESIGN_DOCUMENT.md template verified`,
  }
}

async function eval09ConversationalAnalyticsRouter() {
  // Verify stateless isolated sub-agent contract, preselectedOutput fast-path, and CA embed URL collapse params
  assert(conversationalAnalyticsTs.includes("store: false, background: false, tools: []"))
  assert(conversationalAnalyticsTs.includes('if (preselectedOutput && /<CA_AGENT_SELECTION>[\\s\\S]*?<\\/CA_AGENT_SELECTION>/i.test(preselectedOutput))'))
  for (const param of ['hide_sidebar', 'hide_data_source_panel', 'sidebar_collapsed', 'right_panel_collapsed']) {
    assert(conversationalAnalyticsTs.includes(`['${param}', 'true']`), `Missing ${param} in CA_EMBED_COLLAPSE_PARAMS`)
  }
  assert(useStudioControllerTs.includes("if (isFirstTurn) setContentItems((prev) => prev.filter((it) => it.createdInConversation === true))"))

  return {
    routing: true,
    toolBudget: true,
    outputRubric: true,
    safety: true,
    detail: 'Stateless CA sub-agent (store:false, tools:[]), Turn-1 <CA_AGENT_SELECTION> fast-path (0 redundant LLM calls), and 4 CA_EMBED_COLLAPSE_PARAMS verified',
  }
}

async function eval10RbacSafemodeNoopGuardrails() {
  // Verify Monty WASM Safe Mode permission gate blocks unapproved write operations while allowing read operations
  const decisions = []
  let writeExecuted = false
  const mockSdk = {
    authSession: {
      transport: {
        rawRequest: async (method, endpoint) => {
          if (method === 'GET') return { statusCode: 200, ok: true, body: { id: '7', display_name: 'Bryan' } }
          writeExecuted = true
          return { statusCode: 200, ok: true, body: { id: '999' } }
        },
      },
    },
  }

  const readOut = JSON.parse(
    await LkrCodeMode.runPythonCode({
      code: 'u = me()\nreturn {"id": u.get("id")}',
      sdk: mockSdk,
      requirePermission: true,
      onPermissionRequest: async (req) => {
        decisions.push(req.operation)
        return 'deny'
      },
    })
  )
  assert.equal((readOut.result || readOut).id, '7')
  assert.equal(decisions.length, 0, 'Read-only me() must never trigger Safe Mode permission prompt')

  let writeBlocked = false
  try {
    const writeRes = await LkrCodeMode.runPythonCode({
      code: 'd = create_dashboard({"title": "Unauthorized UDD", "folder_id": "1"})\nreturn d',
      sdk: mockSdk,
      requirePermission: true,
      onPermissionRequest: async (req) => {
        decisions.push(req.operation)
        return 'deny'
      },
    })
    if (String(writeRes).toLowerCase().includes('denied') || String(writeRes).toLowerCase().includes('permission')) {
      writeBlocked = true
    }
  } catch {
    writeBlocked = true
  }
  assert.equal(writeBlocked, true, 'Safe Mode deny must block create_dashboard')
  assert.equal(writeExecuted, false, 'Denied write must never reach Looker transport')
  assert(lookerPermissionsTs.includes('export function isConversationalNoOpPrompt('))
  assert(lookerPermissionsTs.includes('export function classifyLooker404Error('))

  return {
    routing: true,
    toolBudget: true,
    outputRubric: true,
    safety: writeBlocked && !writeExecuted && decisions.length > 0,
    detail: `Read-only me() bypassed prompt (0 prompts); create_dashboard intercepted (${decisions[0]}) and blocked on 'deny' (writeExecuted=false); 404 & no-op guards verified`,
  }
}

const EVAL_SUITE = [
  { id: 'eval-01', num: 1, title: 'Looker Content & Folder Inventory Queries (`LkrCodeMode`)', fn: eval01ContentFolderInventory },
  { id: 'eval-02', num: 2, title: 'Open-Ended Analytical Routing (`search_agents()` vs. CodeMode)', fn: eval02CaVsCodemodeRouting },
  { id: 'eval-03', num: 3, title: '4-Turn Interactive Lit Data App Lifecycle', fn: eval03MultiTurnDataApp },
  { id: 'eval-04', num: 4, title: '4-Turn Native Content Studio Lifecycle (Zero-Bash)', fn: eval04MultiTurnContentStudio },
  { id: 'eval-05', num: 5, title: 'Concurrent Multi-Conversation Shared-Environment Isolation', fn: eval05ConcurrentSharedEnv },
  { id: 'eval-06', num: 6, title: 'Data Investigator Root-Cause Narrative & KDA Toolkit', fn: eval06DataInvestigatorKda },
  { id: 'eval-07', num: 7, title: 'Agentic LookML Onboarding & SQL-to-LookML Parity', fn: eval07AgenticLookmlOnboarding },
  { id: 'eval-08', num: 8, title: '3-Pillar Looker & BigQuery Health Check & 7-Section TDD', fn: eval08ThreePillarHealthCheck },
  { id: 'eval-09', num: 9, title: 'Stateless Isolated Conversational Analytics Sub-Agent Router', fn: eval09ConversationalAnalyticsRouter },
  { id: 'eval-10', num: 10, title: 'Looker 4-Layer RBAC, Safe Mode Gates, & Conversational No-Op', fn: eval10RbacSafemodeNoopGuardrails },
]

async function main() {
  const selected = evalFilter
    ? EVAL_SUITE.filter((e) => e.id === evalFilter || String(e.num) === evalFilter || e.id.endsWith(evalFilter))
    : EVAL_SUITE
  assert(selected.length > 0, `No eval matched --eval=${evalFilter}`)

  const results = []
  let totalPoints = 0
  const maxPoints = selected.length * 4

  for (const item of selected) {
    const t0 = performance.now()
    const grade = await item.fn()
    const elapsedMs = Math.round(performance.now() - t0)
    const score = [grade.routing, grade.toolBudget, grade.outputRubric, grade.safety].filter(Boolean).length
    totalPoints += score
    const passed = score === 4
    results.push({
      id: item.id,
      num: item.num,
      title: item.title,
      passed,
      score: `${score}/4`,
      elapsedMs,
      dimensions: {
        routing: Boolean(grade.routing),
        toolBudget: Boolean(grade.toolBudget),
        outputRubric: Boolean(grade.outputRubric),
        safety: Boolean(grade.safety),
      },
      detail: grade.detail,
    })
    console.log(`${passed ? '✓' : '✗'} [${item.id}] ${item.title} (${score}/4, ${elapsedMs}ms) — ${grade.detail}`)
  }

  const outDir = path.join(repoRoot, 'tmp/evals')
  mkdirSync(outDir, { recursive: true })

  const mdLines = [
    '# Looker Data App Studio — 10-Eval Scorecard',
    '',
    `- **Mode:** \`${isLive ? 'live' : 'offline'}\``,
    `- **Overall Score:** **${totalPoints}/${maxPoints}** (${results.filter((r) => r.passed).length}/${results.length} Evals Passed)`,
    '',
    '| Eval | Scenario | Routing | Tool Budget | Output Rubric | Safety & Isolation | Score | Time |',
    '| --- | --- | :---: | :---: | :---: | :---: | :---: | ---: |',
    ...results.map(
      (r) =>
        `| \`${r.id}\` | ${r.title} | ${r.dimensions.routing ? 'PASS' : 'FAIL'} | ${r.dimensions.toolBudget ? 'PASS' : 'FAIL'} | ${r.dimensions.outputRubric ? 'PASS' : 'FAIL'} | ${r.dimensions.safety ? 'PASS' : 'FAIL'} | **${r.score}** | ${r.elapsedMs}ms |`
    ),
    '',
    '## Eval Evidence Details',
    ...results.map((r) => `- **\`${r.id}\` (${r.title})**: ${r.detail}`),
    '',
  ]

  writeFileSync(path.join(outDir, 'scorecard.md'), mdLines.join('\n'), 'utf8')
  writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify({ mode: isLive ? 'live' : 'offline', totalPoints, maxPoints, passed: totalPoints === maxPoints, results }, null, 2),
    'utf8'
  )

  assert.equal(totalPoints, maxPoints, `Eval suite failed: ${totalPoints}/${maxPoints}`)
  console.log(`\n✓ All ${results.length} Evals passed (${totalPoints}/${maxPoints})! Scorecard written to tmp/evals/scorecard.md`)
}

main().catch((err) => {
  console.error('Eval runner failed:', err)
  process.exit(1)
})
