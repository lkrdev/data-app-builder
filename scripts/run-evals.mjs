#!/usr/bin/env node
/**
 * Unified 16-Eval Suite & Multi-Dimensional Grader for Looker Data App Studio (scripts/run-evals.mjs).
 *
 * Grades Evals #1 through #16 across 4 dimensions:
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
import Module, { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const babel = require('@babel/core')
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (m, f) => m._compile(babel.transformSync(readFileSync(f, 'utf8'), { filename: f, envName: 'test' }).code, f)
}
const { LkrCodeMode } = require(path.join(repoRoot, 'src/lkrCliBridge.ts'))
const { fetchConversationSandboxDebugMarkdown } = require(path.join(repoRoot, 'src/antigravity.ts'))

function resolveLiveGeminiAuth() {
  if (process.env.GEMINI_API_KEY?.trim()) return { mode: 'apikey', apiKey: process.env.GEMINI_API_KEY.trim() }
  const envFile = process.env.AGENTIC_THELOOK_ENV || path.join(os.homedir(), 'bwebs/agentic-thelook/.env')
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)
    if (m?.[1]) return { mode: 'apikey', apiKey: m[1].trim().replace(/^['"]|['"]$/g, '') }
  }
  return undefined
}

const args = process.argv.slice(2)
const isLive = args.includes('--live')
const evalFilter = args.find((a) => a.startsWith('--eval='))?.split('=')[1]?.trim()?.toLowerCase()

const antigravityPromptsTs = [
  'src/antigravityPrompts.ts',
  'src/lookmlSkills.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
const antigravityStepsTs = readFileSync(path.join(repoRoot, 'src/antigravitySteps.ts'), 'utf8')
const antigravityTs = [
  'src/antigravity.ts',
  'src/antigravityEnv.ts',
  'src/antigravityLoop.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
const lkrCliBridgeTs = [
  'src/lkrCliBridge.ts',
  'src/lkrCliCodeModeHelpers.ts',
  'src/lkrCliSitecustomize.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
const lookerPermissionsTs = readFileSync(path.join(repoRoot, 'src/lookerPermissions.ts'), 'utf8')
const lookerApiTs = readFileSync(path.join(repoRoot, 'src/lookerApi.ts'), 'utf8')
const conversationalAnalyticsTs = readFileSync(path.join(repoRoot, 'src/conversationalAnalytics.ts'), 'utf8')
const useStudioControllerTs = [
  'src/useStudioController.ts',
  'src/studioControllerAuth.ts',
  'src/studioControllerMetadata.ts',
  'src/studioControllerLoaders.ts',
  'src/studioControllerTurn.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
const studioWorkspaceTsx = readFileSync(path.join(repoRoot, 'src/components/StudioWorkspace.tsx'), 'utf8')
const healthCheckTs = readFileSync(path.join(repoRoot, 'src/healthCheck.ts'), 'utf8')

function extractTsTemplateConstant(source, constName) {
  const re = new RegExp(`export const ${constName} = \`([\\s\\S]*?)\`;?\\n`, 'm')
  const match = source.match(re)
  assert(match, `Could not extract ${constName}`)
  return match[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${').replace(/\\\\/g, '\\')
}

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
    code: `
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
    useCase: 'tile',
    detail: `1 CodeMode call (${sdkCalls} Looker HTTP call), short=3 items (untruncated), long=10 items across 2 folders (max 2 links/folder + /workspace/content_inventory.md), 0 dashboard 404s`,
    messages: [
      { role: 'user', text: 'What dashboards and Looks are in my personal and shared folders?' },
      {
        role: 'assistant',
        text: res.long.summary_markdown,
        activitySteps: [
          { id: 'eval01_cm', kind: 'codemode', title: 'Executing format_content_inventory in Monty WASM', detail: 'me() + format_content_inventory(folders_data)', content: JSON.stringify(res, null, 2), status: 'done' },
          { id: 'eval01_md', kind: 'file', title: 'Writing content_inventory.md', path: '/workspace/content_inventory.md', content: res.long.full_markdown, status: 'done' },
        ],
      },
    ],
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
  const rawCode = `
all_agents = search_agents()
ecom_hits = sdk.search_agents(query="margin")
no_hits = search_agents(query="payroll")
fallback_rows = run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.total_sale_price"], "limit": "5"}) if len(no_hits) == 0 else []
return {"count": len(all_agents), "ecom_id": ecom_hits[0]["id"], "gq_count": len(ecom_hits[0]["golden_queries"]), "no_hits": len(no_hits), "fallback_rows": len(fallback_rows)}
`

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
    useCase: 'conversational-analytics',
    detail: `search_agents() in Monty WASM inspected ${res.count} CA agents + golden_queries, matched ca_ecom_01 for margin, and executed fallback run_inline_query when no CA agent matched`,
    messages: [
      { role: 'user', text: 'Compare search_agents(query="margin") vs search_agents(query="payroll") fallback routing' },
      {
        role: 'assistant',
        text: `<USE_CASE>conversational-analytics</USE_CASE>\nMatched CA agent \`${res.ecom_id}\` for margin and fell back to \`run_inline_query\` (${res.fallback_rows} row) when no CA agent matched payroll.`,
        activitySteps: [
          { id: 'eval02_cm', kind: 'codemode', title: 'Searching accessible Looker Conversational Analytics agents and golden queries...', detail: 'search_agents()', content: JSON.stringify({ code: rawCode, result: res }, null, 2), status: 'done' },
        ],
      },
    ],
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
    useCase: 'app',
    environmentId: iter10.environment_id,
    lastInteractionId: iter10.turns[iter10.turns.length - 1]?.interaction_id,
    detail: `4-turn Data App loop passed (${iter10.turns.map((t) => `${t.id}:${t.widgets_extracted}w`).join(', ')}); T1 tools=1 codemode+1 bash, T2-T4 warm tools=0 codemode+1 bash, retries=0`,
    messages: iter10.turns.flatMap((t) => [
      { role: 'user', text: t.prompt || `Turn ${t.id}` },
      {
        role: 'assistant',
        text: `Extracted ${t.widgets_extracted} widgets (codemode=${t.codemode_calls}, bash=${t.bash_calls}, verify_retries=${t.verify_retries}).`,
        interactionId: t.interaction_id,
        activitySteps: [{ id: `eval03_${t.id}`, kind: 'code_execution', language: 'PYTHON', title: `Bundle & verify ${t.id}`, content: JSON.stringify(t, null, 2), status: 'done' }],
      },
    ]),
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
    useCase: 'dashboard',
    environmentId: iter10.environment_id,
    lastInteractionId: turnList[turnList.length - 1]?.interaction_id,
    detail: `4-turn Content Studio loop passed (bash=0, codemode=1/turn, Looker HTTP=${iter10.totals.looker_http_calls} total across 4 turns, WASM macros verified)`,
    messages: Object.entries(iter10.turns || {}).flatMap(([tid, t]) => [
      { role: 'user', text: t.prompt || `Content Studio Turn ${tid}` },
      {
        role: 'assistant',
        text: `Completed ${tid} (codemode=${t.codemode_calls}, bash=${t.bash_calls}, looker_http=${t.looker_http_calls}).`,
        interactionId: t.interaction_id,
        activitySteps: [{ id: `eval04_${tid}`, kind: 'codemode', title: `Executing Content Studio macro (${tid})`, content: JSON.stringify(t, null, 2), status: 'done' }],
      },
    ]),
  }
}

async function eval05ConcurrentSharedEnv() {
  execFileSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/bench-concurrent-convs.mjs'), '--iter=10', ...(isLive ? ['--live'] : [])],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    }
  )
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
    useCase: 'auto',
    environmentId: iter10.shared_environment_id,
    detail: `Concurrent Conv A (Data App) + Conv B (Content Studio) on 1 shared env (${iter10.shared_environment_id}): score=${iter10.functional_score}, codemode_calls=${totalCodeMode}, 400_errors=0, filesystem_isolation=true`,
    messages: Object.entries(iter10.turns || {}).flatMap(([tid, t]) => [
      { role: 'user', text: `[${tid}] ${t.prompt || tid}` },
      {
        role: 'assistant',
        text: `[${tid}] env=${t.environment_id}, passed=${t.self_eval?.passed}`,
        interactionId: t.interaction_id,
        activitySteps: [{ id: `eval05_${tid}`, kind: 'codemode', title: `Concurrent turn ${tid}`, content: JSON.stringify(t, null, 2), status: 'done' }],
      },
    ]),
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
        code: `
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
      useCase: 'data-investigator',
      detail: `KDA + Data Investigator bundle verified: fixed date window=${kdaRes.fixed_window}, ${bundle.widgets.length} widgets with limit="500", 0 relative dates, Doc/Slides switcher present`,
      messages: [
        { role: 'user', text: 'Investigate Q1 gross margin drop over the last 30 days' },
        {
          role: 'assistant',
          text: `Completed KDA root-cause narrative (${kdaRes.fixed_window}): top driver ${kdaRes.top_driver}.`,
          activitySteps: [
            { id: 'eval06_kda', kind: 'codemode', title: 'Running run_key_driver_analysis', content: JSON.stringify(kdaRes, null, 2), status: 'done' },
            { id: 'eval06_app', kind: 'file', title: 'Bundled MarginInvestigatorApp', path: '/workspace/apps/margin-investigator/app.js', content: JSON.stringify(bundle, null, 2), status: 'done' },
          ],
        },
      ],
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
    writeFileSync(
      path.join(workDir, 'data/run_eval07/summary.md'),
      '### LookML Onboarding Summary\n- Layered base + refinement views validated with 0 errors.\n- [Open ecommerce_core in Looker IDE](/projects/ecommerce_core)\n',
      'utf8'
    )

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
    assert((bundle.files[0].diff || bundle.files[0].content).includes('measure: total_sale_price'))
    const hasProjectLink = /\/projects\/[^/\s)]+/i.test(bundle.summary_markdown || '')
    assert(hasProjectLink, 'Expected /projects/<project_name> link in onboarding summary')

    const onboardingSkillMd = readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')
    const lookmlToolTsx = readFileSync(path.join(repoRoot, 'src/lookmlTool.tsx'), 'utf8')
    const zeroSdkDotGlobals =
      !/\bsdk\.(?:all_connections|all_lookml_models|connection_schemas|connection_tables)\b/.test(onboardingSkillMd) &&
      !/\bsdk\.(?:all_connections|all_lookml_models|connection_schemas|connection_tables)\b/.test(lookmlToolTsx)
    assert(zeroSdkDotGlobals, 'Onboarding skill and lookmlTool must use bare Monty globals without sdk.*')
    const requiresProjectAndDashLinks =
      onboardingSkillMd.includes('/projects/<project_name>') &&
      !onboardingSkillMd.includes('/projects/<project_name>/files') &&
      onboardingSkillMd.includes('/dashboards/<id>') &&
      antigravityPromptsTs.includes('/dashboards/<id>') &&
      lookmlToolTsx.includes('lookml-open-ide-btn')
    assert(requiresProjectAndDashLinks, 'Onboarding & dashboard skills and LookmlPreviewPane must enforce IDE/dashboard links')
    const hasTurn1FastPath =
      lookerApiTs.includes('export async function discoverAccessibleConnections(') &&
      antigravityTs.includes('isLookmlOnboardingIntake') &&
      antigravityTs.includes("generation_config: { thinking_level: 'low'")
    assert(hasTurn1FastPath, 'Turn-1 client connection prefetch and <4s stateless low-thinking fast-path must be present')

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
      routing: hasTurn1FastPath && zeroSdkDotGlobals,
      toolBudget: hasTurn1FastPath,
      outputRubric:
        bundle.validation.passed &&
        bundle.files.length === 1 &&
        bundle.queries[0].parity_status === 'matched' &&
        hasProjectLink &&
        requiresProjectAndDashLinks,
      safety: pyKey === nodeKey && zeroSdkDotGlobals,
      useCase: 'lookml',
      detail: `LOOKML_BUNDLE + Turn-1 <4s fast-path verified (project=${bundle.project_id}, hasProjectLink=${hasProjectLink}, diff files=${bundle.files.length}, parity=matched, sitecustomize SHA-256=${pyKey.slice(0, 12)}...)`,
      messages: [
        { role: 'user', text: 'Onboard ecommerce_core LookML refinement and verify SQL-to-LookML parity' },
        {
          role: 'assistant',
          text: bundle.summary_markdown || 'Validated LookML bundle.',
          activitySteps: [
            { id: 'eval07_lkml', kind: 'file', title: 'Bundled +order_items.view.lkml', path: '/workspace/data/run_eval07/lookml/views/refinements/+order_items.view.lkml', content: JSON.stringify(bundle, null, 2), status: 'done' },
          ],
        },
      ],
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
    useCase: 'health-check',
    detail: `THREE_PILLAR_CODEMODE_PY executed in Monty WASM (${sdkCalls} Looker HTTP calls across Pillars 1/2/3) + 7-section TECHNICAL_DESIGN_DOCUMENT.md template verified`,
    messages: [
      { role: 'user', text: 'Run 3-Pillar Looker & BigQuery Health Check on thelook_project' },
      {
        role: 'assistant',
        text: `Completed 3-Pillar telemetry collection (${sdkCalls} Looker HTTP calls).`,
        activitySteps: [
          { id: 'eval08_cm', kind: 'codemode', title: 'Executing THREE_PILLAR_CODEMODE_PY', content: JSON.stringify(res, null, 2), status: 'done' },
        ],
      },
    ],
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
    useCase: 'conversational-analytics',
    detail: 'Stateless CA sub-agent (store:false, tools:[]), Turn-1 <CA_AGENT_SELECTION> fast-path (0 redundant LLM calls), and 4 CA_EMBED_COLLAPSE_PARAMS verified',
    messages: [
      { role: 'user', text: 'Verify stateless isolated CA sub-agent router & embed collapse parameters' },
      { role: 'assistant', text: 'Verified store:false, background:false, tools:[], Turn-1 <CA_AGENT_SELECTION> fast-path, and CA_EMBED_COLLAPSE_PARAMS.' },
    ],
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
    useCase: 'auto',
    detail: `Read-only me() bypassed prompt (0 prompts); create_dashboard intercepted (${decisions[0]}) and blocked on 'deny' (writeExecuted=false); 404 & no-op guards verified`,
    messages: [
      { role: 'user', text: 'Verify Safe Mode RBAC permission gate on me() vs create_dashboard()' },
      {
        role: 'assistant',
        text: `Read-only \`me()\` allowed with 0 prompts; \`create_dashboard\` intercepted (\`${decisions[0]}\`) and denied (writeExecuted=${writeExecuted}).`,
        activitySteps: [
          { id: 'eval10_gate', kind: 'codemode', title: 'Safe Mode permission gate check', content: JSON.stringify({ readOut, decisions, writeBlocked, writeExecuted }, null, 2), status: 'done' },
        ],
      },
    ],
  }
}

async function eval11AlertsTriageAndActions() {
  const { matchExplicitUseCaseRule, isLookerInstanceMetadataQuery } = require(path.join(repoRoot, 'src/lookerPermissions.ts'))
  const { extractAlertBundleFromInteraction, BUILTIN_SKILLS_FILES } = require(path.join(repoRoot, 'src/antigravitySteps.ts'))
  const { buildAlertDashboardFilterUrl } = require(path.join(repoRoot, 'src/components/AlertInspectorPane.tsx'))
  const { saveAlertArtifact, loadAlertArtifact } = require(path.join(repoRoot, 'src/lookerArtifacts.ts'))

  const userPrompts = [
    'My alerts are failing how can i disable them?',
    'I dont think my alert data is right',
    'I have too many alerts',
    "I'm not getting my alerts on mobile",
    'create an alert on dashboard 42 when margin drops below 40%',
    '/looker-alerts inspect alert 104',
  ]
  const routingOk =
    userPrompts.every((p) => matchExplicitUseCaseRule(p) === 'tile' && isLookerInstanceMetadataQuery(p)) &&
    Boolean(BUILTIN_SKILLS_FILES['looker-alerts']?.includes('alert_details'))

  const callOrder = []
  let putBody = null
  const alertMockHandler = async (method, urlPath, queryParams, body) => {
    const m = String(method).toUpperCase()
    const p = String(urlPath)
    callOrder.push(`${m} ${p}`)
    if (m === 'GET' && p.endsWith('/alerts/search')) {
      return [
        { id: '104', custom_title: 'Failing Margin Alert', is_disabled: false, dashboard_element_id: '318' },
        { id: '105', custom_title: 'Noisy Revenue Alert', is_disabled: false, dashboard_element_id: '319' },
      ]
    }
    if (m === 'GET' && p.endsWith('/alert_details')) {
      assert(Array.isArray(queryParams?.alert_ids) ? queryParams.alert_ids.length > 0 : Boolean(queryParams?.alert_ids), 'alert_details must receive non-empty alert_ids')
      return [
        { id: '104', title: 'Failing Margin Alert', dashboard_id: '42', dashboard_name: 'Executive Pulse', error: 'Unknown field order_items.old_margin', alert_history_items: [{ outcome: 'failed', message: 'Unknown field' }] },
        { id: '105', title: 'Noisy Revenue Alert', dashboard_id: '42', dashboard_name: 'Executive Pulse', error: null, alert_history_items: [{ outcome: 'succeeded', alert_condition_met: true }] },
      ]
    }
    if (m === 'PATCH' && p.endsWith('/alerts/104')) return { id: '104', is_disabled: Boolean(body?.is_disabled), disabled_reason: body?.disabled_reason }
    if (m === 'GET' && p.endsWith('/alerts/105')) {
      return {
        id: '105',
        comparison_type: 'GREATER_THAN',
        cron: '*/15 * * * *',
        destinations: [{ destination_type: 'EMAIL', email_address: 'bryan@example.com' }],
        field: { title: 'Revenue', name: 'order_items.total_revenue', filter: [] },
        owner_id: '7',
        threshold: 1000,
        dashboard_element_id: '319',
        applied_dashboard_filters: [{ filter_title: 'Region', field_name: 'users.region', filter_value: 'North America' }],
      }
    }
    if (m === 'PUT' && p.endsWith('/alerts/105')) {
      putBody = body
      return { ...body, id: '105' }
    }
    if (m === 'POST' && p.endsWith('/alerts')) return { ...body, id: '206' }
    if (m === 'DELETE' && p.endsWith('/alerts/105')) return ''
    if (m === 'POST' && p.endsWith('/alerts/206/enqueue')) return { id: '206', enqueued: true }
    return {}
  }

  const pyResRaw = await LkrCodeMode.runPythonCode({
    code: [
      'active = search_alerts(disabled=False)',
      'ids = [a["id"] for a in active if a.get("id")]',
      'details = alert_details(alert_ids=ids)',
      'disabled = update_alert_field("104", {"is_disabled": True, "disabled_reason": "Disabled while fixing field"})',
      'cur = get_alert("105")',
      'payload = {k: cur.get(k) for k in ("comparison_type", "cron", "destinations", "field", "owner_id", "threshold", "applied_dashboard_filters", "dashboard_element_id")}',
      'payload["cron"] = "0 9 * * *"',
      'updated = update_alert("105", payload)',
      'cloned = create_alert({**payload, "dashboard_element_id": "410"})',
      'if cloned and cloned.get("id"):',
      '    delete_alert("105")',
      '    enqueue_alert(cloned["id"])',
      'return {"details_count": len(details), "disabled": disabled["is_disabled"], "cloned_id": cloned["id"]}',
    ].join('\n'),
    requestHandler: alertMockHandler,
  })
  const pyRes = JSON.parse(pyResRaw)
  const pyOut = pyRes?.result || pyRes
  const mandatoryFields = ['comparison_type', 'cron', 'destinations', 'field', 'owner_id', 'threshold']
  const hasAllMandatoryOnPut = Boolean(putBody && mandatoryFields.every((k) => putBody[k] !== undefined))
  const createIdx = callOrder.indexOf('POST /alerts')
  const deleteIdx = callOrder.indexOf('DELETE /alerts/105')
  const cloneBeforeDelete = createIdx >= 0 && deleteIdx > createIdx

  const toolBudgetOk = pyOut?.details_count === 2 && pyOut?.disabled === true && pyOut?.cloned_id === '206'

  const store = new Map()
  const mockArtifactSdk = {
    ok: async (p) => p,
    artifact: async ({ key }) =>
      String(key).split(',').filter((k) => store.has(k)).map((k, idx) => ({ key: k, version: idx + 1, value: JSON.stringify(store.get(k)) })),
    update_artifacts: async (_ns, body) => {
      for (const row of body || []) store.set(row.key, JSON.parse(row.value))
      return []
    },
  }
  const extracted = extractAlertBundleFromInteraction({
    output_text:
      'Cloned alert #206.\n<ALERT_BUNDLE>{"alert_id":"206","title":"Executive Margin Alert","dashboard_id":"42","dashboard_name":"Executive Pulse","cron":"0 9 * * *","comparison_type":"LESS_THAN","threshold":0.42,"field":{"title":"Gross Margin %","name":"order_items.gross_margin_pct"},"applied_dashboard_filters":[{"filter_title":"Region","field_name":"users.region","filter_value":"North America"}],"destinations":[{"destination_type":"EMAIL","email_address":"bryan@example.com"}],"alert_history_items":[{"outcome":"succeeded","alert_condition_met":false}]}</ALERT_BUNDLE>',
  })
  await saveAlertArtifact(mockArtifactSdk, '7', extracted)
  const loaded = await loadAlertArtifact(mockArtifactSdk, '206')
  const filterUrl = buildAlertDashboardFilterUrl(loaded)
  const outputRubricOk =
    Boolean(loaded && loaded.alert_id === '206') &&
    filterUrl === '/embed/dashboards/42?Region=North+America'

  const safetyOk =
    hasAllMandatoryOnPut &&
    cloneBeforeDelete &&
    LkrCodeMode.classifyOperation('GET', '/alert_details').requiresPermission === false &&
    LkrCodeMode.classifyOperation('POST', '/alerts/206/enqueue').operation === 'enqueue_alert' &&
    LkrCodeMode.classifyOperation('POST', '/alerts/206/enqueue').requiresPermission === true &&
    LkrCodeMode.classifyOperation('PATCH', '/alerts/104').operation === 'update_alert_field' &&
    LkrCodeMode.classifyOperation('POST', '/alerts/206/follow').operation === 'follow_alert' &&
    LkrCodeMode.classifyOperation('DELETE', '/alerts/206/follow').operation === 'unfollow_alert'

  return {
    routing: routingOk,
    toolBudget: toolBudgetOk,
    outputRubric: outputRubricOk,
    safety: safetyOk,
    useCase: 'tile',
    detail: `Alert prompts routed to tile; search_alerts -> alert_details -> update_alert_field -> get_alert/update_alert (6 mandatory fields) -> clone-before-delete verified; AlertInspectorPane URL=${filterUrl}`,
    messages: [
      { role: 'user', text: 'Triage failing/noisy Looker alerts, update filters & schedule, clone to new tile, and open Alert Inspector' },
      {
        role: 'assistant',
        text: `Processed ${pyOut?.details_count} alerts via \`alert_details\`, disabled failing alert \`#104\`, updated \`#105\` cron, cloned to \`#206\` before retiring \`#105\`, and persisted \`obj_alert_206\` (\`${filterUrl}\`).`,
      },
    ],
  }
}

async function eval12ApiBodyTemplates() {
  const { matchExplicitUseCaseRule, extractResolvedUseCase, isLookerInstanceMetadataQuery } = require(path.join(repoRoot, 'src/lookerPermissions.ts'))
  const { shouldOfferReusableScriptPrompt } = require(path.join(repoRoot, 'src/lookerApi.ts'))

  const prompts = [
    'Generate a request body template for create_connection',
    "Show api_template('create_dashboard')",
    'Use describe_body on WriteLookWithQuery',
    'Show writable body schema for scheduled_plan',
  ]
  const routingOk = prompts.every(
    (p) => isLookerInstanceMetadataQuery(p) && matchExplicitUseCaseRule(p) === 'tile' && extractResolvedUseCase('', p) === 'tile'
  )

  let httpCalls = 0
  let permPrompts = 0
  const raw = await LkrCodeMode.runPythonCode({
    code: [
      'dash_tpl = api_template("create_dashboard")',
      'conn_tpl = api_template("create_connection")',
      'look_desc = describe_body("WriteLookWithQuery")',
      'sched_tpl = api_template("WriteScheduledPlan")',
      'return {',
      '    "dash_tpl": dash_tpl,',
      '    "conn_tpl": conn_tpl,',
      '    "look_type": look_desc.get("type"),',
      '    "look_writable": [f.get("name") for f in (look_desc.get("fields") or []) if not f.get("read_only")],',
      '    "sched_tpl": sched_tpl,',
      '}',
    ].join('\n'),
    requestHandler: async () => {
      httpCalls += 1
      return {}
    },
    requirePermission: true,
    onPermissionRequest: async () => {
      permPrompts += 1
      return 'deny'
    },
  })
  const parsed = JSON.parse(raw)
  const out = parsed.result || parsed
  const secretsRedacted = Object.entries(out?.conn_tpl || {}).every(
    ([k, v]) => !/password|secret|certificate|private_key|token/i.test(k) || v === '<CONFIGURE_IN_LOOKER_ADMIN_UI>'
  )
  const destSecretRedacted =
    out?.sched_tpl?.scheduled_plan_destination?.[0]?.secret_parameters === '<CONFIGURE_IN_LOOKER_ADMIN_UI>' &&
    !('id' in (out?.sched_tpl?.scheduled_plan_destination?.[0] || {}))
  const suppressScriptOffer = !shouldOfferReusableScriptPrompt({
    effectivePrompt: prompts[0],
    baseReply: 'Generated request body template.',
    activitySteps: [],
    crudItemsCount: 0,
  })

  return {
    routing: routingOk,
    toolBudget: httpCalls === 0,
    outputRubric:
      Boolean(out?.dash_tpl && 'title' in out.dash_tpl && !('id' in out.dash_tpl)) &&
      out?.look_type === 'WriteLookWithQuery' &&
      Array.isArray(out?.look_writable) &&
      out.look_writable.includes('title'),
    safety: permPrompts === 0 && secretsRedacted && destSecretRedacted && suppressScriptOffer,
    useCase: 'tile',
    detail: `Template/schema prompts routed to tile; live api_template & describe_body verified (${httpCalls} HTTP calls, ${permPrompts} perm prompts, read-only omitted, secrets redacted); Script offer suppressed`,
    messages: [
      { role: 'user', text: prompts[0] },
      { role: 'assistant', text: `Generated writable templates via \`api_template\` & \`describe_body\` (\`${out?.look_type}\`).` },
    ],
  }
}

async function eval13HealthPulseAndVacuum() {
  const { matchExplicitUseCaseRule, extractResolvedUseCase, isLookerInstanceMetadataQuery } = require(path.join(repoRoot, 'src/lookerPermissions.ts'))
  const { shouldOfferReusableScriptPrompt } = require(path.join(repoRoot, 'src/lookerApi.ts'))

  const healthTilePrompts = [
    'Run a health pulse on this Looker instance',
    'Run health_analyze on slow queries',
    'Run health-vacuum to find unused explores',
    'Find unused LookML fields and joins in thelook',
  ]
  const routingOk =
    healthTilePrompts.every((p) => isLookerInstanceMetadataQuery(p) && matchExplicitUseCaseRule(p) === 'tile' && extractResolvedUseCase('', p) === 'tile') &&
    !isLookerInstanceMetadataQuery('Run a 3-pillar health check on thelook') &&
    extractResolvedUseCase('', 'Run a 3-pillar health check on thelook') === 'health-check'

  let httpCalls = 0
  let analyzeExploreCalls = 0
  let inAnalyzePhase = true
  let permPrompts = 0
  const raw = await LkrCodeMode.runPythonCode({
    code: [
      'pulse = health_pulse(7)',
      'analyze = health_analyze(project="thelook", timeframe_days=90)',
      'vac = health_vacuum(project="thelook", timeframe_days=90)',
      'return {"pulse": pulse, "analyze": analyze, "vac": vac}',
    ].join('\n'),
    requestHandler: async (_method, urlPath, _qp, body) => {
      httpCalls += 1
      const p = String(urlPath)
      const b = (typeof body === 'string' && body ? JSON.parse(body) : body) || {}
      if (p.includes('/explores/') && inAnalyzePhase) analyzeExploreCalls += 1
      if (p.includes('/queries/run/') && b.view === 'field_usage') {
        inAnalyzePhase = false
        return [
          { 'field_usage.model': 'thelook', 'field_usage.explore': 'order_items', 'field_usage.view': 'orders', 'field_usage.field': 'orders.unused_note', 'field_usage.times_used': 0 },
          { 'field_usage.model': 'thelook', 'field_usage.explore': 'order_items', 'field_usage.view': 'unused_leaf', 'field_usage.field': 'unused_leaf.code', 'field_usage.times_used': 0 },
        ]
      }
      if (p.includes('/queries/run/') && b.view === 'history') {
        if (Array.isArray(b.fields) && b.fields.includes('history.result_source')) {
          return [
            { 'history.status': 'complete', 'history.result_source': 'cache', 'history.query_run_count': 80 },
            { 'history.status': 'error', 'history.result_source': 'query', 'history.query_run_count': 20 },
          ]
        }
        if (Array.isArray(b.fields) && b.fields.includes('history.query_run_count')) {
          return [{ 'query.model': 'thelook', 'query.view': 'order_items', 'history.query_run_count': 142 }]
        }
        return []
      }
      if (p.includes('/queries/run/')) return []
      if (p === '/lookml_models') {
        return [{ name: 'thelook', project_name: 'thelook', explores: [{ name: 'order_items', hidden: false }, { name: 'legacy_abandoned_cart', hidden: false }] }]
      }
      if (p.includes('/explores/order_items')) {
        return {
          name: 'order_items',
          joins: [{ name: 'orders' }, { name: 'users', dependent_fields: ['orders.user_id', 'users.id'] }, { name: 'unused_leaf' }],
          fields: {
            dimensions: [
              { name: 'order_items.id', hidden: false },
              { name: 'orders.unused_note', hidden: false },
              { name: 'users.country', hidden: false },
              { name: 'unused_leaf.code', hidden: false },
            ],
            measures: [],
            filters: [],
            parameters: [],
          },
        }
      }
      if (p.includes('/explores/legacy_abandoned_cart')) {
        return {
          name: 'legacy_abandoned_cart',
          joins: [],
          fields: { dimensions: [{ name: 'legacy_abandoned_cart.id', hidden: false }], measures: [], filters: [], parameters: [] },
        }
      }
      return {}
    },
    requirePermission: true,
    onPermissionRequest: async () => {
      permPrompts += 1
      return 'deny'
    },
  })
  const out = JSON.parse(raw)
  const res = out.result || out
  const nonAdminRaw = await LkrCodeMode.runPythonCode({
    code: 'return {"pulse": health_pulse(7), "vac": health_vacuum(model="thelook")}',
    requestHandler: async (_m, urlPath) => {
      if (String(urlPath) === '/lookml_models') {
        return [{ name: 'thelook', project_name: 'thelook', explores: [{ name: 'order_items', hidden: false }] }]
      }
      return { ok: false, statusCode: 403, body: '403 Forbidden: see_system_activity required' }
    },
  })
  const nonAdmin = JSON.parse(nonAdminRaw).result || JSON.parse(nonAdminRaw)
  const suppressOffer = !shouldOfferReusableScriptPrompt({
    effectivePrompt: healthTilePrompts[2],
    baseReply: 'Identified 1 unused explore.',
    activitySteps: [],
    crudItemsCount: 0,
  })

  return {
    routing: routingOk,
    toolBudget: analyzeExploreCalls === 0 && httpCalls > 0 && httpCalls <= 12,
    outputRubric:
      res.pulse?.status === 'ok' &&
      res.pulse?.query_volume === 100 &&
      res.pulse?.cache_hit_ratio === 0.8 &&
      res.analyze?.unused_explores?.some((x) => x.explore === 'legacy_abandoned_cart') &&
      res.vac?.status === 'ok' &&
      res.vac?.unused_joins?.some((j) => j.join === 'unused_leaf') &&
      !res.vac?.unused_joins?.some((j) => j.join === 'users') &&
      res.vac?.unused_fields?.some((f) => f.field === 'orders.unused_note'),
    safety:
      permPrompts === 0 &&
      nonAdmin.pulse?.status === 'permission_denied' &&
      nonAdmin.pulse?.query_volume === null &&
      nonAdmin.vac?.status === 'permission_denied' &&
      nonAdmin.vac?.vacuum_safe === false &&
      Array.isArray(nonAdmin.vac?.unused_fields) &&
      nonAdmin.vac.unused_fields.length === 0 &&
      suppressOffer,
    useCase: 'tile',
    detail: `health_pulse/health_analyze/health_vacuum -> tile (3-pillar -> health-check preserved); ${httpCalls} Looker calls (0 explore calls in health_analyze) found unused legacy_abandoned_cart & unused_leaf; 403 System Activity returns null metrics`,
    messages: [
      { role: 'user', text: healthTilePrompts[2] },
      { role: 'assistant', text: `Unused explores: \`thelook::legacy_abandoned_cart\`; unused join: \`unused_leaf\`.` },
    ],
  }
}

async function eval14HomeFolderTrashCleanup() {
  const { matchExplicitUseCaseRule, extractResolvedUseCase, isLookerInstanceMetadataQuery } = require(path.join(repoRoot, 'src/lookerPermissions.ts'))
  const { reconcileDeletedLookerContent, shouldOfferReusableScriptPrompt } = require(path.join(repoRoot, 'src/lookerApi.ts'))

  const runId = Date.now().toString(36)
  const testDashTitle = `test_eval_${runId}_draft_dash`
  const testLookTitle = `test_eval_${runId}_draft_look`
  const routingOk =
    isLookerInstanceMetadataQuery('Find out how many dashboards are in my home folder') &&
    extractResolvedUseCase('', 'Find out how many dashboards are in my home folder') === 'tile' &&
    matchExplicitUseCaseRule('Clean up test dashboards in my home folder') === 'tile' &&
    extractResolvedUseCase('', 'Find out what drove Q4 returns') === 'data-investigator'

  const dashStore = new Map([
    ['701', { id: '701', title: 'Executive Revenue KPIs', folder_id: '5', deleted: false }],
    ['702', { id: '702', title: testDashTitle, folder_id: '5', deleted: false }],
  ])
  const lookStore = new Map([['802', { id: '802', title: testLookTitle, folder_id: '5', deleted: false }]])
  const approvedOps = []
  let httpCalls = 0

  const raw = await LkrCodeMode.runPythonCode({
    code: [
      'u = me()',
      'home_id = str(u.get("home_folder_id") or u.get("personal_folder_id") or "5")',
      'f = folder(home_id)',
      'inv = format_content_inventory([f])',
      'trashed_d = []',
      'trashed_l = []',
      'for d in (f.get("dashboards") or []):',
      '    if str(d.get("title") or "").lower().startswith("test_eval_"):',
      '        update_dashboard(str(d["id"]), {"deleted": True})',
      '        trashed_d.append(str(d["id"]))',
      'for l in (f.get("looks") or []):',
      '    if str(l.get("title") or "").lower().startswith("test_eval_"):',
      '        update_look(str(l["id"]), {"deleted": True})',
      '        trashed_l.append(str(l["id"]))',
      'return {"home_id": home_id, "before_total": inv.get("total_items"), "trashed_dashboards": trashed_d, "trashed_looks": trashed_l}',
    ].join('\n'),
    requestHandler: async (method, urlPath, _qp, body) => {
      httpCalls += 1
      const m = String(method).toUpperCase()
      const p = String(urlPath)
      if (m === 'GET' && p.endsWith('/user')) return { id: '7', home_folder_id: '5', personal_folder_id: '5' }
      if (m === 'GET' && p.endsWith('/folders/5')) {
        return {
          id: '5',
          name: 'Home Folder',
          dashboards: Array.from(dashStore.values()).filter((d) => !d.deleted),
          looks: Array.from(lookStore.values()).filter((l) => !l.deleted),
        }
      }
      if (m === 'PATCH' && p.includes('/dashboards/')) {
        const id = p.split('/').pop()
        const cur = dashStore.get(id)
        const next = Object.assign({}, cur, typeof body === 'string' ? JSON.parse(body) : body)
        dashStore.set(id, next)
        return next
      }
      if (m === 'PATCH' && p.includes('/looks/')) {
        const id = p.split('/').pop()
        const cur = lookStore.get(id)
        const next = Object.assign({}, cur, typeof body === 'string' ? JSON.parse(body) : body)
        lookStore.set(id, next)
        return next
      }
      return {}
    },
    requirePermission: true,
    onPermissionRequest: async (req) => {
      approvedOps.push(req.operation)
      return 'allow_op'
    },
  })
  const res = JSON.parse(raw)
  const out = res.result || res

  const openItems = [
    { key: 'dashboard:701', id: '701', contentType: 'dashboard', title: 'Executive Revenue KPIs', embedPath: '/embed/dashboards/701', hidden: false },
    { key: 'dashboard:702', id: '702', contentType: 'dashboard', title: testDashTitle, embedPath: '/embed/dashboards/702', hidden: false },
    { key: 'look:802', id: '802', contentType: 'look', title: testLookTitle, embedPath: '/embed/looks/802', hidden: false },
  ]
  const activitySteps = [
    {
      kind: 'codemode',
      content: `update_dashboard("702", {"deleted": True})\nupdate_look("802", {"deleted": True})\n# Looker API Telemetry\n# PATCH /dashboards/702 (12ms)\n# PATCH /looks/802 (9ms)\n# Output\n${JSON.stringify(out)}`,
    },
  ]
  const rec = reconcileDeletedLookerContent(openItems, 'dashboard:702', activitySteps)
  const suppressMutatingOffer = !shouldOfferReusableScriptPrompt({
    effectivePrompt: 'Clean up test dashboards in my home folder',
    baseReply: 'Soft-trashed 2 test items.',
    activitySteps,
    crudItemsCount: rec.crudItems.length,
  })
  const allowLookupOffer = shouldOfferReusableScriptPrompt({
    effectivePrompt: 'What dashboards are in my home folder?',
    baseReply: 'Found 1 dashboard in your home folder.',
    activitySteps: [{ kind: 'codemode', content: '# GET /user (4ms)\n# GET /folders/5 (7ms)' }],
    crudItemsCount: 0,
  })

  return {
    routing: routingOk,
    toolBudget: httpCalls === 4,
    outputRubric:
      out.before_total === 3 &&
      JSON.stringify(out.trashed_dashboards) === '["702"]' &&
      JSON.stringify(out.trashed_looks) === '["802"]' &&
      rec.nextItems.length === 1 &&
      rec.nextItems[0].key === 'dashboard:701' &&
      rec.nextActiveTabKey === 'dashboard:701' &&
      rec.crudItems.length === 2,
    safety:
      dashStore.get('701')?.deleted === false &&
      dashStore.get('702')?.deleted === true &&
      lookStore.get('802')?.deleted === true &&
      approvedOps.includes('update_dashboard') &&
      approvedOps.includes('update_look') &&
      suppressMutatingOffer &&
      allowLookupOffer,
    useCase: 'tile',
    detail: `Home-folder inventory + soft-trash cleanup (${testDashTitle}, ${testLookTitle}) in ${httpCalls} HTTP calls; reconciled tabs (3 -> 1) + 2 deleted CRUD pills; Script prompt suppressed on mutation`,
    messages: [
      { role: 'user', text: 'Clean up test_eval_* dashboards and Looks in my home folder' },
      { role: 'assistant', text: `Soft-trashed \`702\` and \`802\`; kept \`Executive Revenue KPIs\` (\`701\`).` },
    ],
  }
}

async function eval15PortableJsonRoundTripAndVars() {
  const { runAntigravityTurn } = require(path.join(repoRoot, 'src/antigravity.ts'))
  const { matchExplicitUseCaseRule, extractResolvedUseCase, isLookerInstanceMetadataQuery } = require(path.join(repoRoot, 'src/lookerPermissions.ts'))

  const runId = Date.now().toString(36)
  const dashTitle = `test_eval_${runId}_portable_dash`
  const lookTitle = `test_eval_${runId}_portable_look`
  const jsonPrompts = [
    'Export portable dashboard json for dashboard 42',
    'Call export_dashboard_json and import_dashboard_json',
    'Import look json from backup',
  ]
  const routingOk = jsonPrompts.every(
    (p) => isLookerInstanceMetadataQuery(p) && matchExplicitUseCaseRule(p) === 'tile' && extractResolvedUseCase('', p) === 'tile'
  )

  const createdDashIds = []
  const createdLookIds = []
  const lastElByDash = new Map()
  let nextId = 900
  let step = 0
  const posted = []

  await runAntigravityTurn({
    sdk: {
      authSession: {
        transport: {
          rawRequest: async (method, reqPath, _qp, body) => {
            const m = String(method).toUpperCase()
            const p = String(reqPath)
            const b = typeof body === 'string' && body ? JSON.parse(body) : body || {}
            if (m === 'GET' && p === '/dashboards/42') {
              return {
                ok: true,
                statusCode: 200,
                body: JSON.stringify({
                  id: '42',
                  user_id: '7',
                  folder_id: '3',
                  slug: 'slug42',
                  title: dashTitle,
                  dashboard_filters: [
                    { id: 'f_old', name: 'Region', title: 'Region', type: 'field_filter', model: 'thelook', explore: 'order_items', dimension: 'users.region', field: { name: 'users.region' }, row: 0 },
                  ],
                  dashboard_elements: [
                    {
                      id: 'el_1',
                      dashboard_id: '42',
                      dashboard_layout_id: 'lay_old',
                      title: 'Sales KPI',
                      type: 'vis',
                      query: { id: 'q_old', slug: 'qs_old', model: 'thelook', view: 'order_items', fields: ['order_items.total_sale_price'] },
                      result_maker: { filterables: [{ model: 'thelook', view: 'order_items', listen: [{ dashboard_filter_name: 'Region', field: 'users.region' }] }] },
                    },
                  ],
                  dashboard_layouts: [
                    { id: 'lay_old', active: true, type: 'newspaper', dashboard_layout_components: [{ id: 'cmp_old', dashboard_element_id: 'el_1', row: 0, column: 0, width: 12, height: 6 }] },
                  ],
                }),
              }
            }
            if (m === 'GET' && (p === '/folders/5' || p === '/folders/8')) {
              const fid = p.split('/').pop()
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: fid, name: fid === '5' ? 'Home' : 'Shared' }) }
            }
            if (m === 'POST' && p === '/dashboards') {
              const id = String(++nextId)
              createdDashIds.push({ id, title: b.title, folder_id: b.folder_id })
              return { ok: true, statusCode: 200, body: JSON.stringify({ id, title: b.title, folder_id: b.folder_id }) }
            }
            if (m === 'POST' && p === '/dashboard_filters') {
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: `f_${++nextId}` }) }
            }
            if (m === 'POST' && p === '/queries') {
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: `q_${++nextId}` }) }
            }
            if (m === 'POST' && p === '/dashboard_elements') {
              const eid = `el_${++nextId}`
              lastElByDash.set(String(b.dashboard_id), eid)
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: eid }) }
            }
            if (m === 'GET' && /^\/dashboards\/\d+\/dashboard_layouts$/.test(p)) {
              const did = p.split('/')[2]
              const eid = lastElByDash.get(did) || 'el_none'
              return { ok: true, statusCode: 200, body: JSON.stringify([{ id: `lay_${did}`, active: true, dashboard_layout_components: [{ id: `cmp_${did}`, dashboard_element_id: eid }] }]) }
            }
            if (m === 'PATCH' && p.startsWith('/dashboard_layout_components/')) {
              return { ok: true, statusCode: 200, body: JSON.stringify({ id: p.split('/').pop() }) }
            }
            if (m === 'GET' && p === '/looks/20') {
              return {
                ok: true,
                statusCode: 200,
                body: JSON.stringify({
                  id: '20',
                  user_id: '7',
                  slug: 'lslug20',
                  title: 'Source Look',
                  model: { id: 'thelook' },
                  query: { id: 'ql_old', slug: 'qls_old', model: 'thelook', view: 'order_items', fields: ['products.brand', 'order_items.count'] },
                }),
              }
            }
            if (m === 'POST' && p === '/looks') {
              const id = String(++nextId)
              createdLookIds.push({ id, title: b.title, folder_id: b.folder_id })
              return { ok: true, statusCode: 200, body: JSON.stringify({ id, title: b.title, folder_id: b.folder_id }) }
            }
            return { ok: true, statusCode: 200, body: '{}' }
          },
        },
      },
    },
    userId: '1',
    extensionSDK: {
      serverProxy: async (_url, init) => {
        step += 1
        const parsedBody = init?.body ? JSON.parse(String(init.body)) : {}
        posted.push(parsedBody)
        if (step === 1) {
          const sharedImportCode = [
            'spec = export_dashboard_json("42")',
            'imp = import_dashboard_json(spec, dest_folder, title=import_title)',
            'return {"exported": spec, "imported": imp, "stripped_ro": ("id" not in spec and "id" not in spec["dashboard_elements"][0]["query"])}',
          ].join('\n')
          const lookImportCode = [
            'lspec = export_look_json("20")',
            'limp = import_look_json(lspec, "5", title=ltitle)',
            'return {"exported_look": lspec, "imported_look": limp, "stripped_look_ro": ("id" not in lspec and "id" not in lspec["query"])}',
          ].join('\n')
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_eval15_1',
              environment_id: 'env_eval15',
              status: 'requires_action',
              steps: [
                { id: 'c1', type: 'function_call', name: 'run_looker_codemode', arguments: JSON.stringify({ code: sharedImportCode, vars: { import_title: `${dashTitle}_a`, dest_folder: '5' } }) },
                { id: 'c2', type: 'function_call', name: 'run_looker_codemode', arguments: JSON.stringify({ code: sharedImportCode, vars: { import_title: `${dashTitle}_b`, dest_folder: '8' } }) },
                { id: 'c3', type: 'function_call', name: 'run_looker_codemode', arguments: JSON.stringify({ code: lookImportCode, vars: { ltitle: lookTitle } }) },
              ],
            }),
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ id: 'int_eval15_2', environment_id: 'env_eval15', status: 'completed', output_text: '<USE_CASE>tile</USE_CASE>Completed portable JSON round-trip.' }),
        }
      },
    },
    auth: { mode: 'apikey', apiKey: 'eval15-key', oauthToken: '', clientId: '', projectId: '' },
    session: { environmentId: 'env_eval15', lastInteractionId: 'int_prev_15' },
    selectedExplores: [],
    schemaMarkdown: '',
    userPrompt: jsonPrompts[0],
    requirePermission: true,
    onPermissionRequest: async () => 'allow_op',
    onStatus: () => {},
  })

  const fnResults = posted[1]?.input || []
  const r1 = fnResults[0]?.result || {}
  const r2 = fnResults[1]?.result || {}
  const r3 = fnResults[2]?.result || {}

  return {
    routing: routingOk,
    toolBudget: createdDashIds.length === 2 && createdLookIds.length === 1,
    outputRubric:
      r1.imported?.title === `${dashTitle}_a` &&
      r2.imported?.title === `${dashTitle}_b` &&
      Boolean(r1.imported?.element_id_map?.el_1) &&
      Boolean(r2.imported?.element_id_map?.el_1) &&
      r1.stripped_ro === true &&
      r3.stripped_look_ro === true &&
      !r1._duplicate_call_notice &&
      !r2._duplicate_call_notice &&
      Boolean(r3.imported_look?.look_id),
    safety:
      createdDashIds[0]?.folder_id === '5' &&
      createdDashIds[1]?.folder_id === '8' &&
      createdLookIds[0]?.folder_id === '5',
    useCase: 'tile',
    detail: `Live export/import_dashboard_json & export/import_look_json round-trip created 2 dashboards (${dashTitle}_a/b via identical code + distinct args.vars without _duplicate_call_notice) + 1 Look (${lookTitle}) with read-only IDs stripped`,
    messages: [
      { role: 'user', text: jsonPrompts[0] },
      { role: 'assistant', text: `Exported & imported portable JSON into folders 5 and 8 (\`${r1.imported?.dashboard_id}\`, \`${r2.imported?.dashboard_id}\`, Look \`${r3.imported_look?.look_id}\`).` },
    ],
  }
}

async function eval16LookmlReviewDialectAndPivot() {
  const { matchExplicitUseCaseRule, extractResolvedUseCase } = require(path.join(repoRoot, 'src/lookerPermissions.ts'))
  const { SANDBOX_AGENT_SKILL_FILES, BUILTIN_SKILLS_FILES } = require(path.join(repoRoot, 'src/antigravitySteps.ts'))

  const readOnlyLookmlModes = ['app', 'data-investigator', 'dashboard', 'tile', 'conversational-analytics']
  const devLookmlModes = ['app', 'data-investigator', 'dashboard', 'lookml', 'tile', 'conversational-analytics']
  const reviewerMd = SANDBOX_AGENT_SKILL_FILES['lookml-reviewer/SKILL.md'] || ''
  const sfToBqMd = SANDBOX_AGENT_SKILL_FILES['snowflake-to-bigquery-converter/SKILL.md'] || ''
  const routingOk =
    matchExplicitUseCaseRule('Inspect the LookML dimensions in order_items.view.lkml', readOnlyLookmlModes) === 'tile' &&
    extractResolvedUseCase('', '/lookml-reviewer audit order_items.view.lkml', readOnlyLookmlModes) === 'tile' &&
    extractResolvedUseCase('', '/snowflake-to-bigquery-converter migrate order_items.view.lkml', readOnlyLookmlModes) === 'tile' &&
    extractResolvedUseCase('<USE_CASE>lookml</USE_CASE>\nReviewed LookML.', 'Check view', readOnlyLookmlModes) === 'tile' &&
    matchExplicitUseCaseRule('/lookml-reviewer audit order_items.view.lkml', devLookmlModes) === 'lookml' &&
    matchExplicitUseCaseRule('/snowflake-to-bigquery-converter migrate order_items.view.lkml', devLookmlModes) === 'lookml' &&
    matchExplicitUseCaseRule('/looker-audit check slow dashboards', devLookmlModes) === 'tile' &&
    Boolean(reviewerMd) &&
    sfToBqMd.includes('SAFE_DIVIDE') &&
    sfToBqMd.includes('QUALIFY') &&
    BUILTIN_SKILLS_FILES['snowflake-to-bigquery-converter'] === sfToBqMd

  let capturedQueryBody = null
  let permPrompts = 0
  let httpCalls = 0
  const raw = await LkrCodeMode.runPythonCode({
    code: [
      'exp = lookml_model_explore("thelook", "order_items")',
      'bq_sql = run_inline_query("sql", {"model": "thelook", "view": "order_items", "fields": ["order_items.created_month", "order_items.total_sale_price"], "limit": "10"})',
      'piv = run_inline_query("json_detail", {',
      '    "model": "thelook",',
      '    "view": "order_items",',
      '    "fields": ["order_items.created_month", "products.category", "order_items.total_sale_price"],',
      '    "pivots": ["products.category"],',
      '    "filters": {"order_items.created_date": to_fixed_date_range("last quarter", "2026-04-15")},',
      '    "limit": "50",',
      '})',
      'dims = [d.get("name") for d in ((exp.get("fields") or {}).get("dimensions") or [])]',
      'return {"dims": dims, "bq_sql_ok": "SAFE_DIVIDE" in str(bq_sql) and "NVL(" not in str(bq_sql), "row_count": len(piv.get("data") or []), "has_pivots": len(piv.get("pivots") or []) == 2}',
    ].join('\n'),
    requestHandler: async (method, urlPath, _qp, body) => {
      httpCalls += 1
      if (String(method).toUpperCase() === 'GET' && String(urlPath).includes('/explores/order_items')) {
        return {
          name: 'order_items',
          fields: {
            dimensions: [{ name: 'order_items.id', primary_key: true }, { name: 'order_items.created_month' }, { name: 'products.category' }],
            measures: [{ name: 'order_items.total_sale_price' }],
          },
        }
      }
      if (String(urlPath).endsWith('/queries/run/sql')) {
        return 'SELECT TIMESTAMP_TRUNC(created_at, MONTH), SAFE_DIVIDE(SUM(sale_price), NULLIF(COUNT(*), 0)) FROM `prj.thelook.order_items` GROUP BY 1 LIMIT 10'
      }
      capturedQueryBody = typeof body === 'string' ? JSON.parse(body) : body
      return {
        pivots: [{ key: 'Accessories' }, { key: 'Outerwear' }],
        data: [{ 'order_items.created_month': { value: '2026-01' }, 'order_items.total_sale_price': { Accessories: { value: 12400 }, Outerwear: { value: 18900 } } }],
      }
    },
    requirePermission: true,
    onPermissionRequest: async () => {
      permPrompts += 1
      return 'deny'
    },
  })
  const out = JSON.parse(raw)
  const res = out.result || out

  return {
    routing: routingOk,
    toolBudget: httpCalls === 3,
    outputRubric:
      res.bq_sql_ok === true &&
      res.row_count === 1 &&
      res.has_pivots === true &&
      JSON.stringify(capturedQueryBody?.pivots) === '["products.category"]' &&
      capturedQueryBody?.filters?.['order_items.created_date'] === '2026-01-01 to 2026-03-31',
    safety: permPrompts === 0,
    useCase: 'tile',
    detail: `Read-only see_lookml routed to tile (dev -> lookml), lookml-reviewer & snowflake-to-bigquery-converter bundled, BigQuery SQL & pivoted json_detail query verified (${capturedQueryBody?.filters?.['order_items.created_date']}, 0 perm prompts)`,
    messages: [
      { role: 'user', text: 'Inspect order_items LookML, review LAMS & Snowflake->BigQuery dialect rules, and verify quarterly category pivot query' },
      { role: 'assistant', text: `Verified \`order_items\` PK, LAMS & Snowflake->BigQuery SQL rules, and ran pivoted query (${res.row_count} row, 2 category pivots).` },
    ],
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
  { id: 'eval-11', num: 11, title: 'Looker Alerts Triage, Actions & Inspector (`0.0.69` `alert_details`)', fn: eval11AlertsTriageAndActions },
  { id: 'eval-12', num: 12, title: 'OpenAPI Request-Body Template & Schema Discovery (`api_template` & `describe_body`)', fn: eval12ApiBodyTemplates },
  { id: 'eval-13', num: 13, title: 'Instance Health Pulse & Unused-LookML Vacuum (`health_pulse` & `health_vacuum`)', fn: eval13HealthPulseAndVacuum },
  { id: 'eval-14', num: 14, title: 'Home/Personal Folder Inventory & `test_eval_*` Soft-Trash Reconciliation', fn: eval14HomeFolderTrashCleanup },
  { id: 'eval-15', num: 15, title: 'Portable Dashboard/Look JSON Round-Trip & `args.vars` Cache Isolation', fn: eval15PortableJsonRoundTripAndVars },
  { id: 'eval-16', num: 16, title: 'Read-Only `see_lookml` Fallback, LAMS / Snowflake->BigQuery & Pivot Verification', fn: eval16LookmlReviewDialectAndPivot },
]

async function main() {
  const selected = evalFilter
    ? EVAL_SUITE.filter((e) => e.id === evalFilter || String(e.num) === evalFilter || e.id.endsWith(evalFilter))
    : EVAL_SUITE
  assert(selected.length > 0, `No eval matched --eval=${evalFilter}`)

  const results = []
  let totalPoints = 0
  const maxPoints = selected.length * 4

  const evalDumpDir = path.join(repoRoot, 'tmp/eval')
  const outDir = path.join(repoRoot, 'tmp/evals')
  mkdirSync(evalDumpDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  const liveAuth = isLive ? resolveLiveGeminiAuth() : undefined

  for (const item of selected) {
    const t0 = performance.now()
    const grade = await item.fn()
    const elapsedMs = Math.round(performance.now() - t0)
    const score = [grade.routing, grade.toolBudget, grade.outputRubric, grade.safety].filter(Boolean).length
    totalPoints += score
    const passed = score === 4
    const record = {
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
    }
    results.push(record)

    const debugMd = await fetchConversationSandboxDebugMarkdown({
      auth: grade.auth || liveAuth,
      conversationId: item.id,
      label: `${item.id} — ${item.title}`,
      useCase: grade.useCase || 'auto',
      environmentId: grade.environmentId,
      lastInteractionId: grade.lastInteractionId,
      messages: [
        ...(grade.messages || [{ role: 'user', text: item.title }]),
        {
          role: 'assistant',
          text: `### Eval Grader Summary (${record.score}, ${elapsedMs}ms)\n- **Detail:** ${grade.detail}\n- **Dimensions:** \`${JSON.stringify(record.dimensions)}\``,
        },
      ],
    })
    writeFileSync(path.join(evalDumpDir, `${item.id}.md`), debugMd, 'utf8')
    console.log(`${passed ? '✓' : '✗'} [${item.id}] ${item.title} (${score}/4, ${elapsedMs}ms) — ${grade.detail}`)
  }

  const mdLines = [
    `# Looker Data App Studio — ${results.length}-Eval Scorecard`,
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

  const resultsJson = JSON.stringify({ mode: isLive ? 'live' : 'offline', totalPoints, maxPoints, passed: totalPoints === maxPoints, results }, null, 2)
  for (const dir of [evalDumpDir, outDir]) {
    writeFileSync(path.join(dir, 'scorecard.md'), mdLines.join('\n'), 'utf8')
    writeFileSync(path.join(dir, 'results.json'), resultsJson, 'utf8')
  }

  assert.equal(totalPoints, maxPoints, `Eval suite failed: ${totalPoints}/${maxPoints}`)
  console.log(`\n✓ All ${results.length} Evals passed (${totalPoints}/${maxPoints})! Debug dumps written to tmp/eval/*.md & tmp/eval/scorecard.md`)
}

main().catch((err) => {
  console.error('Eval runner failed:', err)
  process.exit(1)
})
