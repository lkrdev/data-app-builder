// Assert-based self-check for the embedded Antigravity sandbox bundler (BUNDLE_APP_PY) and WASM CodeMode bridge.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, '..')
const vendorCodeModePath = path.join(repoRoot, 'src/vendor/codemode.js')
assert.equal(
  createHash('sha256').update(readFileSync(vendorCodeModePath)).digest('hex'),
  '3a782aa6ab08002c8d8f25cd0dfa313f4e8754fc655e30598b87cb0875fe95e5',
  'src/vendor/codemode.js must match CDN 0.0.67/codemode.js SHA-256 byte-for-byte'
)

const babel = require('@babel/core')
const Module = require('node:module')
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const out = babel.transformSync(readFileSync(filename, 'utf8'), {
      filename,
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
      ],
    })
    mod._compile(out.code, filename)
  }
}
const { LkrCodeMode } = require(path.join(repoRoot, 'src/lkrCliBridge.ts'))

assert.equal(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.name, 'run_looker_codemode')
const mockSdk = {
  authSession: {
    transport: {
      async rawRequest(method, reqPath, queryParams) {
        return {
          ok: true,
          statusCode: 200,
          body: JSON.stringify({ method, path: reqPath, queryParams }),
        }
      },
    },
  },
}
const cmOut = await LkrCodeMode.runPythonCode({
  code: 'return lookml_model_explore(target_model, target_explore)',
  sdk: mockSdk,
  vars: { target_model: 'thelook', target_explore: 'order_items' },
})
const cmParsed = JSON.parse(cmOut)
assert.equal(cmParsed.method, 'GET')
assert.equal(cmParsed.path, '/lookml_models/thelook/explores/order_items')

const antigravityTs = [
  'src/antigravity.ts',
  'src/antigravityTypes.ts',
  'src/antigravityAuth.ts',
  'src/antigravitySteps.ts',
  'src/antigravityStarters.ts',
  'src/antigravityPrompts.ts',
  'src/lkrCliBridge.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
assert(
  antigravityTs.includes('https://cdn.lkr.dev/cli/codemode/0.0.67/codemode.js') &&
    antigravityTs.includes('export async function ensureCodeModeLoaded()'),
  'src/lkrCliBridge.ts must define CODEMODE_CDN_URL (https://cdn.lkr.dev/cli/codemode/0.0.67/codemode.js) and ensureCodeModeLoaded()'
)
const distBundlePath = path.join(repoRoot, 'dist/bundle.js')
if (statSync(distBundlePath, { throwIfNoEntry: false })) {
  const bundleStat = statSync(distBundlePath)
  assert(
    bundleStat.size < 2 * 1024 * 1024,
    `Expected dist/bundle.js to be < 2 MiB (got ${bundleStat.size} bytes)`
  )
  const distBundleText = readFileSync(distBundlePath, 'utf8')
  assert(
    distBundleText.includes('https://cdn.lkr.dev/cli/codemode/0.0.67/codemode.js'),
    'Expected dist/bundle.js to reference https://cdn.lkr.dev/cli/codemode/0.0.67/codemode.js'
  )
}
assert(
  antigravityTs.includes('https://www.googleapis.com/auth/generative-language.retriever'),
  'OAuth scope must use consent-page-allowed generative-language.retriever scope'
)
assert(
  antigravityTs.includes('!session.lastInteractionId'),
  'Session continuation must key off session.lastInteractionId'
)
const appTsx = [
  'src/components/App.tsx',
  'src/components/StudioDesignSystem.tsx',
  'src/components/StudioHeader.tsx',
  'src/components/StudioWorkspace.tsx',
  'src/useStudioController.ts',
  'src/studioControllerAuth.ts',
  'src/studioControllerMetadata.ts',
  'src/studioControllerLoaders.ts',
  'src/studioControllerTurn.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
assert(
  appTsx.includes('onPaste={handlePaste}'),
  'Composer textarea must support pasting screenshots'
)
assert(
  !/\b(sessionStorage|localStorage)\b/.test(appTsx),
  'Direct browser storage is disabled in Looker data: URL iframes'
)
assert(
  appTsx.includes("location.pathname === '/config'") && !appTsx.includes('⚙ Setup'),
  'Auth setup must only be exposed on /config route without a setup button'
)
const lookerApiTs = [
  'src/lookerApi.ts',
  'src/lookerPermissions.ts',
  'src/lookerArtifacts.ts',
  'src/dataAppPublisher.ts',
  'src/conversationalAnalytics.ts',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
assert(
  lookerApiTs.includes('data_app_studio') &&
    lookerApiTs.includes('formatExploreId') &&
    lookerApiTs.includes('parseExploreId') &&
    !lookerApiTs.includes('sessionsByUser'),
  'Dashboard rich_content_json must persist shared data_app_studio turn history and canonical model_id::explore_id explores without per-user isolation'
)
assert(
  appTsx.includes('groupedExplores') &&
    appTsx.includes('selectedExplores') &&
    !appTsx.includes('Select a LookML Model and Explore first.'),
  'App must use a single grouped multi-select explore combo box and allow empty selection so the agent decides'
)
assert(
  antigravityTs.includes('search_content(terms=') &&
    antigravityTs.includes('Resumed sandbox expired; provisioning fresh sandbox with app state...'),
  'runAntigravityTurn must instruct agent to use Solr search_content + lookml_model_explore when no explore is selected and fall back cleanly on expired sandboxes'
)
assert(
  antigravityTs.includes('<NATIVE_CONTENT_BUNDLE>') &&
    antigravityTs.includes('create_dashboard_filter') &&
    antigravityTs.includes('create_scheduled_plan') &&
    lookerApiTs.includes('user_${safeUserId}_dashboard_${id}') &&
    lookerApiTs.includes('obj_dashboard_${id}') &&
    lookerApiTs.includes('/embed/looks/') &&
    lookerApiTs.includes('/boards/') &&
    appTsx.includes("builderMode === 'dashboard'"),
  'Native Content Builder (/dashboard/:id?) must support UDDs/Looks/Boards/Schedules via CodeMode and index user_${userId}_dashboard_${id} + obj_dashboard_${id}'
)
const manifestLkml = readFileSync(path.join(repoRoot, 'manifest.lkml'), 'utf8')
assert(
  /\braw_api_request\s*:\s*yes\b/.test(manifestLkml) &&
    !/\bcore_api_methods\s*:/.test(manifestLkml) &&
    manifestLkml.includes('"https://cdn.lkr.dev"'),
  'manifest.lkml must declare raw_api_request: yes, zero core_api_methods, and https://cdn.lkr.dev in external_api_urls'
)
const pythonTileTsx = [
  'src/components/PythonTile.tsx',
  'src/components/ScriptStudioView.tsx',
]
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
assert(
  lookerApiTs.includes('user_${uid}_script_${payload.id}') &&
    lookerApiTs.includes('obj_script_${payload.id}') &&
    lookerApiTs.includes('tile_element_${String(elementId).trim()}') &&
    lookerApiTs.includes("load_configuration: 'wait'") &&
    lookerApiTs.includes('run_on_load: false') &&
    lookerApiTs.includes('show_dashboard_header: true'),
  'lookerApi.ts must persist user/obj/tile_element script artifacts and publish extension-layout dashboards with load_configuration="wait" and show_dashboard_header=true'
)
assert(
  pythonTileTsx.includes('isDashboardEditing') &&
    pythonTileTsx.includes('dashboardRunState') &&
    pythonTileTsx.includes('dashboard_filters: dashboardFilters') &&
    pythonTileTsx.includes('dab-py-table') &&
    pythonTileTsx.includes('dab-py-markdown') &&
    pythonTileTsx.includes('dab-py-pre'),
  'PythonTile.tsx must handle Edit/View modes, dashboardRunState, vars.dashboard_filters, and list[dict]/string/dict return value rendering'
)
const tileTableOut = await LkrCodeMode.runPythonCode({
  code: 'return [{"filter_status": dashboard_filters.get("status", "ALL"), "rows": 42}]',
  sdk: mockSdk,
  vars: { dashboard_filters: { status: 'Complete' } },
})
assert.deepEqual(JSON.parse(tileTableOut), [{ filter_status: 'Complete', rows: 42 }])

const healthCheckTs = readFileSync(path.join(repoRoot, 'src/healthCheck.ts'), 'utf8')
assert(
  healthCheckTs.includes('system__activity') &&
    healthCheckTs.includes('query_metrics') &&
    healthCheckTs.includes('scheduled_plan') &&
    healthCheckTs.includes('all_project_files') &&
    healthCheckTs.includes('get_file_content') &&
    healthCheckTs.includes('validate_project') &&
    healthCheckTs.includes('create_sql_query') &&
    healthCheckTs.includes('run_sql_query') &&
    healthCheckTs.includes('JOBS_TIMELINE_BY_PROJECT') &&
    healthCheckTs.includes('TABLE_STORAGE'),
  'THREE_PILLAR_CODEMODE_PY must execute Pillar 1 (system__activity), Pillar 2 (all_project_files/get_file_content/validate_project), and Pillar 3 (create_sql_query + run_sql_query on JOBS_TIMELINE_BY_PROJECT & TABLE_STORAGE)'
)
assert(
  healthCheckTs.includes('user_${cleanUser}_health_check_${cleanId}') &&
    healthCheckTs.includes('obj_health_check_${cleanId}') &&
    appTsx.includes("location.pathname === '/health-check'") &&
    appTsx.includes('TECHNICAL_DESIGN_DOCUMENT.md') &&
    appTsx.includes('Copy Markdown') &&
    appTsx.includes('Download Markdown'),
  'Health Check mode (/health-check/:id?) must synthesize 7-section TECHNICAL_DESIGN_DOCUMENT.md with Copy/Download Markdown buttons and persist to user_${userId}_health_check_${id} + obj_health_check_${id}'
)

const hcPyMatch = healthCheckTs.match(/export const THREE_PILLAR_CODEMODE_PY = `([\s\S]*?)`;\n/)
assert(hcPyMatch, 'Could not extract THREE_PILLAR_CODEMODE_PY from src/healthCheck.ts')
const hcMockOut = await LkrCodeMode.runPythonCode({
  code: hcPyMatch[1].replace(/\\`/g, '`').replace(/\\\$/g, '$'),
  sdk: mockSdk,
  vars: { target_project: 'thelook_event' },
})
const hcParsed = JSON.parse(hcMockOut)
assert(hcParsed.pillar1 && hcParsed.pillar2 && hcParsed.pillar3, 'Expected 3-pillar telemetry object from Monty WASM')

// Verify Issue #1: LkrCodeMode mutation permission gate (read-only bypass, deny, and loop-safe allow_op)
const readOnlyPostOut = await LkrCodeMode.runPythonCode({
  code: 'return run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.count"]})',
  sdk: mockSdk,
  requirePermission: true,
})
assert.equal(JSON.parse(readOnlyPostOut).method, 'POST')

const deniedOut = await LkrCodeMode.runPythonCode({
  code: 'return create_dashboard({"title": "Blocked"})',
  sdk: mockSdk,
  requirePermission: true,
})
assert(
  deniedOut.includes('PermissionError') && deniedOut.includes('create_dashboard'),
  'Unapproved mutating SDK call must fail with PermissionError'
)

let promptCount = 0
const approvedSet = new Set()
const loopOut = await LkrCodeMode.runPythonCode({
  code: 'return [create_dashboard({"title": f"D{i}"})["method"] for i in range(3)]',
  sdk: mockSdk,
  requirePermission: true,
  approvedOperations: approvedSet,
  async onPermissionRequest(req) {
    promptCount += 1
    assert.equal(req.operation, 'create_dashboard')
    assert.equal(req.httpMethod, 'POST')
    return 'allow_op'
  },
})
assert.equal(promptCount, 1, 'allow_op must only prompt once across a Python loop')
assert.deepEqual(JSON.parse(loopOut), ['POST', 'POST', 'POST'])

assert(
  lookerApiTs.includes('saveUserArtifact') &&
    lookerApiTs.includes('listUserArtifacts') &&
    lookerApiTs.includes('loadObjectArtifact') &&
    lookerApiTs.includes('deleteUserArtifact') &&
    lookerApiTs.includes('user_${') &&
    lookerApiTs.includes('obj_${'),
  'lookerApi.ts must implement dual-key user_${uid}_${type}_${id} + obj_${type}_${id} catalog helpers'
)
assert(
  appTsx.includes('STUDIO_MODES') &&
    appTsx.includes('parseStudioRoute') &&
    appTsx.includes('PythonTileMount') &&
    appTsx.includes('dab-permission-bar') &&
    !appTsx.includes('topbar-use-case-badge') &&
    !appTsx.includes('dab-mode-switcher'),
  'App.tsx must include STUDIO_MODES, parseStudioRoute, PythonTileMount, and dab-permission-bar without topbar-use-case-badge or dab-mode-switcher'
)
const match = antigravityTs.match(/export const BUNDLE_APP_PY = `([\s\S]*?)`\n/)
assert(match, 'Could not find BUNDLE_APP_PY in src/antigravity.ts')

const workDir = mkdtempSync(path.join(tmpdir(), 'dab-bundle-test-'))
try {
  const bundlePyPath = path.join(workDir, 'bundle_app.py')
  const sampleAppPath = path.join(workDir, 'app.js')
  const outBundlePath = path.join(workDir, 'bundle.json')

  // Point /workspace/bundle.json write to our temp workDir for local non-root test
  const pyCode = match[1].replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(outBundlePath)})`)
  writeFileSync(bundlePyPath, pyCode, 'utf8')

  const sampleApp = `/**
 * @title Executive Revenue App
 */
import { DataApp, html } from '/runtime/data-app.js';

export class ExecutiveApp extends DataApp {
  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
  }
  render() {
    return html\`
      <app-kpi label="Total Revenue" query-field="order_items.total_sale_price"></app-kpi>
      <app-chart title="Monthly Orders" dimensions="order_items.created_month" measures="order_items.count"></app-chart>
    \`;
  }
}
customElements.define('executive-app', ExecutiveApp);
`
  writeFileSync(sampleAppPath, sampleApp, 'utf8')

  const stdout = execFileSync(
    'python3',
    [bundlePyPath, sampleAppPath, 'Executive Revenue App'],
    {
      env: {
        ...process.env,
        TOOLKIT_DIR: path.join(repoRoot, 'upstream/payload'),
      },
      encoding: 'utf8',
    }
  )

  const tagMatch = stdout.match(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/)
  assert(tagMatch, 'Expected <DATA_APP_BUNDLE> output from bundle_app.py')
  const bundle = JSON.parse(tagMatch[1])

  assert.equal(bundle.title, 'Executive Revenue App')
  assert.equal(bundle.widgets.length, 2, 'Expected 2 extracted widget queries')
  assert(
    bundle.prod_code.includes('https://www.gstatic.com/looker-data-apps/versions/'),
    'Expected gstatic runtime URL rewrite in prod_code'
  )
  assert(
    bundle.prod_code.includes('id="da-kpi-total-revenue"'),
    'Expected stamped widget ID on <app-kpi>'
  )

  // Verify Issue #11: --stdin single-command bundling, dynamic metric switcher extraction,
  // pre-seeded DATA_APP_GUIDE_MD, adaptive polling, and incremental query caching.
  assert(
    antigravityTs.includes('DATA_APP_GUIDE_MD') &&
      antigravityTs.includes('DEFAULT_POLL_SCHEDULE_MS = [400, 700, 1000, 1500]') &&
      antigravityTs.includes('AntigravityTurnTelemetry') &&
      antigravityTs.includes('warmTurnDirective') &&
      lookerApiTs.includes('canonicalQueryJson') &&
      lookerApiTs.includes('savedByCanonical'),
    'antigravity.ts and lookerApi.ts must include DATA_APP_GUIDE_MD, adaptive polling, telemetry, warmTurnDirective, and incremental canonicalQueryJson caching'
  )

  const stdinAppPath = path.join(workDir, 'stdin_app.js')
  const dynamicMetricApp = `/**
 * @title Dynamic Metric Switcher App
 */
import { DataApp, html, createCurrencyCol } from '/runtime/data-app.js';

const METRIC_MAP = {
  'order_items.total_sale_price': { label: 'Revenue', field: 'order_items.total_sale_price' },
  'order_items.count': { label: 'Orders', field: 'order_items.count' },
};

export class DynamicMetricApp extends DataApp {
  constructor() {
    super();
    this.lookerModel = 'thelook';
    this.explore = 'order_items';
    this.isDark = true;
    this.selectedMetric = 'order_items.total_sale_price';
    this.topLimit = '25';
  }
  render() {
    const active = METRIC_MAP[this.selectedMetric] || METRIC_MAP['order_items.total_sale_price'];
    return html\`
      <div class="da-container \${this.isDark ? 'dark-theme' : ''}">
        \${this.renderThemeToggle()}
        <app-chart
          title="Trend (\${active.label})"
          type="areaspline"
          .query=\${{ fields: ['order_items.created_month', active.field], sorts: ['order_items.created_month asc'], limit: '12' }}
        ></app-chart>
        <app-grid
          title="Top Categories"
          .query=\${{
            fields: ['products.category', 'order_items.total_sale_price', 'order_items.count'],
            sorts: [\`\${this.selectedMetric} desc\`],
            limit: String(this.topLimit || '25'),
          }}
          .columnDefs=\${[
            { field: 'products.category', headerName: 'Category' },
            createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Revenue' }),
          ]}
        ></app-grid>
      </div>
    \`;
  }
}
customElements.define('dynamic-metric-app', DynamicMetricApp);
`
  const stdinOut = execFileSync(
    'python3',
    [bundlePyPath, '--stdin', 'Dynamic Metric Switcher App', stdinAppPath],
    {
      input: dynamicMetricApp,
      encoding: 'utf8',
    }
  )
  const stdinTag = stdinOut.match(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/)
  assert(stdinTag, 'Expected <DATA_APP_BUNDLE> output from bundle_app.py --stdin')
  const stdinBundle = JSON.parse(stdinTag[1])
  assert.equal(stdinBundle.title, 'Dynamic Metric Switcher App')
  assert.equal(stdinBundle.widgets.length, 2, 'Expected 2 widgets extracted from dynamic metric switcher app')
  assert.deepEqual(stdinBundle.widgets[0].query.fields, [
    'order_items.created_month',
    'order_items.total_sale_price',
  ])

  // Verify Agentic LookML tool (BOOTSTRAP_LOOKML_PY, allowUpdateSession, vars, and artifact keys)
  const lookmlToolTsx = ['src/lookmlTool.tsx', 'src/lkrCliBridge.ts']
    .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
    .join('\n')
  assert(
    lookmlToolTsx.includes('user_${cleanUser}_lookml_${cleanId}') &&
      lookmlToolTsx.includes('obj_lookml_${cleanId}'),
    'lookmlTool.tsx must persist user_${userId}_lookml_${id} and obj_lookml_${id}'
  )
  assert(
    antigravityTs.includes("allowUpdateSession: toolMode === 'lookml' || mode === 'dashboard'") &&
      antigravityTs.includes("required: ['code', 'thought']") &&
      antigravityTs.includes('...customVars'),
    'runAntigravityTurn must expose vars: { type: "object" } on RUN_LOOKER_CODEMODE_TOOL and pass allowUpdateSession: true + customVars in LookML and dashboard modes'
  )
  // Verify Issue #18: Content Studio (UDD & LookML Dashboards, Looks, Boards, Schedules)
  assert(
    lookerApiTs.includes("'lookml_dashboard'") &&
      lookerApiTs.includes('lookmlDashboardId') &&
      lookerApiTs.includes('layoutComponentIds') &&
      antigravityTs.includes('DASHBOARD_CODEMODE_PREAMBLE_PY') &&
      antigravityTs.includes('def upsert_udd(') &&
      antigravityTs.includes('def upsert_lookml_dashboard(') &&
      antigravityTs.includes('def reflow_24col(') &&
      antigravityTs.includes('def pin_to_board(') &&
      antigravityTs.includes('def schedule_dashboard(') &&
      antigravityTs.includes('def emit_native_bundle(') &&
      antigravityTs.includes('NATIVE_CONTENT_GUIDE_MD') &&
      antigravityTs.includes('isDashboardMode\n    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]') &&
      antigravityTs.includes('looker_http_ms') &&
      antigravityTs.includes('api_retries'),
    'Issue #18: lookerApi.ts and antigravity.ts must include lookml_dashboard support, DASHBOARD_CODEMODE_PREAMBLE_PY macros, CodeMode-only activeTools in /dashboard mode, and Looker HTTP telemetry'
  )
  const lookmlPyMatch = lookmlToolTsx.match(/export const BOOTSTRAP_LOOKML_PY = `([\s\S]*?)`\n/)
  assert(lookmlPyMatch, 'Could not find BOOTSTRAP_LOOKML_PY in src/lookmlTool.tsx')
  const bootstrapPyPath = path.join(workDir, 'bootstrap_lookml.py')
  writeFileSync(bootstrapPyPath, lookmlPyMatch[1], 'utf8')

  const baselineDir = path.join(workDir, 'lookml_baseline')
  const lookmlDir = path.join(workDir, 'lookml')
  execFileSync('mkdir', ['-p', `${baselineDir}/bronze`, `${lookmlDir}/bronze`, `${lookmlDir}/tests/bronze`])
  writeFileSync(
    `${baselineDir}/bronze/orders.refinement.lkml`,
    'include: "orders.view.lkml"\nview: +orders {\n  dimension: id { primary_key: yes }\n}\n',
    'utf8'
  )
  writeFileSync(
    `${lookmlDir}/bronze/orders.refinement.lkml`,
    'include: "orders.view.lkml"\nview: +orders {\n  dimension: id { primary_key: yes }\n  measure: total_revenue { type: sum sql: ${sale_price} ;; value_format_name: usd }\n}\n',
    'utf8'
  )
  writeFileSync(
    `${lookmlDir}/tests/bronze/orders.test.lkml`,
    'test: orders_revenue_test {\n  explore_source: orders {\n    column: total_revenue { field: orders.total_revenue }\n  }\n  assert: non_negative { expression: ${orders.total_revenue} >= 0 ;; }\n}\n',
    'utf8'
  )
  const resultSpecPath = path.join(workDir, 'lookml_result.json')
  writeFileSync(
    resultSpecPath,
    JSON.stringify({
      id: '20261030_dev_branch',
      title: 'Add total_revenue measure to orders',
      project_id: 'deploytobarerepo_temp',
      model_name: 'thelook',
      branch_name: '20261030_dev_branch',
      validation: { passed: true, error_count: 0, errors: [] },
      tests: [{ test_name: 'orders_revenue_test', file_id: 'tests/bronze/orders.test.lkml', success: true }],
      queries: [
        {
          query_index: 0,
          label: 'Orders Total Revenue',
          sql_slug: 'abc123sql',
          explore_slug: 'xyz789exp',
          parity_status: 'matched',
        },
      ],
    }),
    'utf8'
  )
  const lookmlStdout = execFileSync('python3', [bootstrapPyPath, 'bundle', resultSpecPath], {
    env: {
      ...process.env,
      WORKSPACE_DIR: workDir,
      LOOKML_DIR: lookmlDir,
      LOOKML_BASELINE_DIR: baselineDir,
    },
    encoding: 'utf8',
  })
  const lookmlTag = lookmlStdout.match(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/)
  assert(lookmlTag, 'Expected <LOOKML_BUNDLE> output from bootstrap_lookml.py')
  const lookmlBundle = JSON.parse(lookmlTag[1])
  assert.equal(lookmlBundle.project_id, 'deploytobarerepo_temp')
  assert.equal(lookmlBundle.files.length, 2, 'Expected 2 modified/created .lkml files')
  assert(
    lookmlBundle.files.some((f) => f.path === 'bronze/orders.refinement.lkml' && f.diff.includes('+  measure: total_revenue')),
    'Expected unified diff for bronze/orders.refinement.lkml'
  )

  const rootAgentsMd = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
  const upstreamAgentsMd = readFileSync(path.join(repoRoot, 'upstream/payload/AGENTS.md'), 'utf8')
  const pinnedVersionTxt = readFileSync(path.join(repoRoot, 'lkr-dev-cli-version.txt'), 'utf8').trim()
  const updateSkillsYml = readFileSync(path.join(repoRoot, '.github/workflows/update-skills.yml'), 'utf8')
  assert.equal(pinnedVersionTxt, '0.0.67', 'lkr-dev-cli-version.txt must pin 0.0.67')
  assert(
    rootAgentsMd.includes(`lkr-dev-cli[tools,code-mode,parse]==${pinnedVersionTxt}`) &&
      upstreamAgentsMd.includes(`lkr-dev-cli[tools,code-mode,parse]==${pinnedVersionTxt}`),
    `AGENTS.md and upstream/payload/AGENTS.md must pin lkr-dev-cli==${pinnedVersionTxt}`
  )
  assert(
    lookmlToolTsx.includes("export const LKR_DEV_CLI_VERSION = '0.0.67'") &&
      lookmlToolTsx.includes('"install", "--break-system-packages", "--quiet", "uv"') &&
      lookmlToolTsx.includes('"UV_TOOL_BIN_DIR": "/usr/local/bin"') &&
      lookmlToolTsx.includes('"uv", "tool", "install", "--force", "--quiet", pkg_spec') &&
      updateSkillsYml.includes('cron: "0 9 * * 1,4"') &&
      updateSkillsYml.includes('https://pypi.org/pypi/lkr-dev-cli/json') &&
      updateSkillsYml.includes('chore/update-skills'),
    'Issue #32: lookmlTool.tsx and .github/workflows/update-skills.yml must pin lkr-dev-cli==0.0.67, bootstrap uv via pip --break-system-packages + uv tool install, and auto-PR new PyPI releases'
  )

  // Live prototype check of bootstrap_lookml.py cli with mock pip & uv shims
  const fakeBinDir = path.join(workDir, 'fake_bin')
  const cmdLogPath = path.join(workDir, 'cmd.log')
  execFileSync('mkdir', ['-p', fakeBinDir])
  writeFileSync(
    path.join(fakeBinDir, 'pip'),
    `#!/bin/sh
echo "pip $@" >> "${cmdLogPath}"
cat << 'EOF' > "${fakeBinDir}/uv"
#!/bin/sh
echo "UV_TOOL_BIN_DIR=\${UV_TOOL_BIN_DIR:-} uv $@" >> "${cmdLogPath}"
echo "UV_TOOL_DIR=\${UV_TOOL_DIR:-}" >> "${cmdLogPath}"
cat << 'INNER' > "${fakeBinDir}/lkr"
#!/bin/sh
echo "lkr, version 0.0.67"
INNER
chmod +x "${fakeBinDir}/lkr"
EOF
chmod +x "${fakeBinDir}/uv"
`,
    { mode: 0o755 }
  )
  const cliBootstrapOut = execFileSync('/usr/bin/python3', [bootstrapPyPath, 'cli'], {
    env: {
      PATH: `${fakeBinDir}:/usr/bin:/bin`,
      WORKSPACE_DIR: workDir,
    },
    encoding: 'utf8',
  })
  const cliBootstrapJson = JSON.parse(cliBootstrapOut.trim())
  assert.equal(cliBootstrapJson.ok, true)
  assert.equal(cliBootstrapJson.version, '0.0.67')
  const loggedCmds = readFileSync(cmdLogPath, 'utf8')
  assert(
    loggedCmds.includes('pip install --break-system-packages --quiet uv') &&
      loggedCmds.includes('UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet lkr-dev-cli[tools,code-mode,parse]==0.0.67') &&
      loggedCmds.includes(`UV_TOOL_DIR=${workDir}/.uv_tools`),
    'bootstrap_lookml.py cli must execute pip install --break-system-packages --quiet uv followed by UV_TOOL_DIR=<workspace>/.uv_tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install'
  )
  // Issue #171: verify hibernation recovery re-symlinks .uv_tools/lkr-dev-cli/bin/lkr without re-running uv tool install, plus type-scoped getConvTargetId & incomplete auto-continue
  const hibernatedBinDir = path.join(workDir, 'hibernated_bin')
  const persistedUvBin = path.join(workDir, '.uv_tools/lkr-dev-cli/bin')
  const persistedUvSp = path.join(workDir, '.uv_tools/lkr-dev-cli/lib/python3.12/site-packages')
  execFileSync('mkdir', ['-p', hibernatedBinDir, persistedUvBin, persistedUvSp])
  writeFileSync(path.join(persistedUvBin, 'lkr'), '#!/bin/sh\necho "lkr, version 0.0.67"\n', { mode: 0o755 })
  writeFileSync(path.join(hibernatedBinDir, 'uv'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  writeFileSync(path.join(workDir, 'sitecustomize.py'), '# bridge shim\n', 'utf8')
  const hibernateOut = JSON.parse(
    execFileSync('/usr/bin/python3', [bootstrapPyPath, 'cli'], {
      env: { PATH: `${hibernatedBinDir}:/usr/bin:/bin`, WORKSPACE_DIR: workDir, UV_TOOL_BIN_DIR: hibernatedBinDir },
      encoding: 'utf8',
    }).trim()
  )
  assert.equal(hibernateOut.ok, true)
  assert.equal(readFileSync(path.join(persistedUvSp, 'sitecustomize.py'), 'utf8'), '# bridge shim\n')
  assert(
    lookerApiTs.includes('export const getConvTargetId =') &&
      appTsx.includes('export { getConvTargetId }') &&
      antigravityTs.includes("interaction.status === 'incomplete'") &&
      antigravityTs.includes("onStatus('Resuming incomplete turn...')") &&
      antigravityTs.includes('UV_TOOL_DIR=/workspace/.uv_tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install'),
    'Issue #171: exported getConvTargetId, incomplete turn auto-continuation, and UV_TOOL_DIR=/workspace/.uv_tools must be present'
  )

  assert(
    rootAgentsMd.includes('## Conversation Labeling (Stateless Side-Request)') &&
      rootAgentsMd.includes('[CONVERSATION_LABEL_REQUEST]') &&
      rootAgentsMd.includes('## Use Case Auto-Classification (Turn 1 Routing)') &&
      rootAgentsMd.includes('<USE_CASE>') &&
      rootAgentsMd.includes('pip install --break-system-packages --quiet uv') &&
      rootAgentsMd.includes('UV_TOOL_BIN_DIR=/usr/local/bin uv tool install') &&
      upstreamAgentsMd.includes('## Conversation Labeling (Stateless Side-Request)') &&
      upstreamAgentsMd.includes('## Use Case Auto-Classification (Turn 1 Routing)') &&
      upstreamAgentsMd.includes('pip install --break-system-packages --quiet uv') &&
      antigravityTs.includes("target: '/workspace/AGENTS.md'") &&
      antigravityTs.includes('generateConversationLabel') &&
      antigravityTs.includes('sanitizeConversationLabel') &&
      lookerApiTs.includes('extractResolvedUseCase') &&
      lookerApiTs.includes('getAllowedUseCases') &&
      lookerApiTs.includes('user_conversations:') &&
      lookerApiTs.includes('loadUserConversations') &&
      lookerApiTs.includes('saveUserConversation') &&
      appTsx.includes('data-testid="use-case-info-btn"') &&
      appTsx.includes('data-testid="new-conversation-btn"') &&
      !appTsx.includes('data-testid="use-case-selector"') &&
      !appTsx.includes('data-testid="locked-use-case-badge"') &&
      rootAgentsMd.includes('<CA_AGENT_SELECTION>') &&
      upstreamAgentsMd.includes('<CA_AGENT_SELECTION>') &&
      lookerApiTs.includes('selectCaAgentViaIsolatedSubagent') &&
      lookerApiTs.includes('createLookerCaConversation') &&
      appTsx.includes('data-testid="ca-embed-preview"'),
    'Issues #25, #26, #27, #32 & #100: AGENTS.md routing + labeling + CA sub-agent selection + uv/lkr-dev-cli bootstrap, /workspace/AGENTS.md seeding, use-case-info-btn, new-conversation-btn (without use-case-selector or locked-use-case-badge), ca-embed-preview, and user_conversations:${me.id} persistence must be present'
  )

  // Issue #39: Self-evaluating concurrent multi-conversation benchmark harness in a single shared environment_id
  assert(
    antigravityTs.includes('const turnSdk') &&
      antigravityTs.includes('sdk: turnSdk'),
    'Issue #39: runAntigravityTurn must isolate per-turn Looker HTTP telemetry via turnSdk without mutating shared sdk.authSession.transport.rawRequest in place'
  )
  assert(
    appTsx.includes('@looker/embed-sdk') &&
      appTsx.includes('getEmbedSDK') &&
      appTsx.includes('.preload()') &&
      appTsx.includes('loadDashboard(') &&
      appTsx.includes('loadLook(') &&
      appTsx.includes('loadUrl(') &&
      appTsx.includes('pushHistory: false') &&
      appTsx.includes('data-testid="looker-embed-container"'),
    'Issues #45 & #172: StudioWorkspace.tsx must adopt @looker/embed-sdk with immediate .preload() and persistent ILookerConnection loadDashboard/loadLook/loadUrl plus /preload bounce on reload'
  )
  execFileSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/bench-concurrent-convs.mjs'), '--iter=1'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  )
  const iter1JsonPath = path.join(repoRoot, 'tmp/bench-concurrent/iter-1.json')
  const iter1Report = JSON.parse(readFileSync(iter1JsonPath, 'utf8'))
  assert.equal(iter1Report.iteration, 1, 'Expected iteration 1 in tmp/bench-concurrent/iter-1.json')
  assert.equal(iter1Report.functional_score, '8/8', 'Expected 8/8 functional_score in iter-1.json')
  assert.equal(iter1Report.single_env_invariant?.passed, true, 'Expected single_env_invariant.passed === true')
  assert.equal(iter1Report.single_env_invariant?.environments_created, 1, 'Expected exactly 1 environment created')
  assert.equal(iter1Report.single_env_invariant?.source_update_400_errors, 0, 'Expected 0 source update 400 errors')
  assert.equal(iter1Report.filesystem_isolation_ok, true, 'Expected filesystem_isolation_ok === true')
  assert.equal(iter1Report.cleanup_ok, true, 'Expected cleanup_ok === true')
  for (const tid of ['T1A', 'T2A', 'T3A', 'T4A', 'T1B', 'T2B', 'T3B', 'T4B']) {
    const turnEntry = iter1Report.turns?.[tid]
    assert(turnEntry, `Expected turn ${tid} in iter-1.json`)
    assert.equal(turnEntry.environment_id, iter1Report.shared_environment_id, `Expected ${tid} on shared environment_id`)
    assert.equal(turnEntry.self_eval?.passed, true, `Expected ${tid} self_eval.passed === true`)
  }

  const indexCss = readFileSync(path.join(repoRoot, 'src/styles/index.css'), 'utf8')
  const studioDsSkillMd = readFileSync(path.join(repoRoot, '.agents/skills/studio-design-system/SKILL.md'), 'utf8')
  assert(
    indexCss.includes('--dab-success-bg') &&
      indexCss.includes('--dab-warning-bg') &&
      indexCss.includes('--dab-danger-bg') &&
      appTsx.includes('export function StudioModal(') &&
      appTsx.includes('export function StudioToolbar(') &&
      studioDsSkillMd.includes('name: studio-design-system') &&
      rootAgentsMd.includes('.agents/skills/studio-design-system/SKILL.md') &&
      readFileSync(path.join(repoRoot, '.agents/skills/issue-authoring/SKILL.md'), 'utf8').includes('name: issue-authoring') &&
      rootAgentsMd.includes('.agents/skills/issue-authoring/SKILL.md') &&
      !upstreamAgentsMd.includes('issue-authoring'),
    'StudioDesignSystem primitives, semantic status CSS tokens, .agents/skills/studio-design-system/SKILL.md, and .agents/skills/issue-authoring/SKILL.md must be present'
  )

  const eslintrcJson = JSON.parse(readFileSync(path.join(repoRoot, '.eslintrc.json'), 'utf8'))
  const preCommitPath = path.join(repoRoot, '.githooks/pre-commit')
  assert.equal(
    eslintrcJson.rules?.['@typescript-eslint/no-explicit-any'],
    'error',
    '.eslintrc.json must enforce "@typescript-eslint/no-explicit-any": "error"'
  )
  assert(
    (statSync(preCommitPath).mode & 0o111) !== 0 &&
      readFileSync(preCommitPath, 'utf8').includes('lint:check'),
    '.githooks/pre-commit must exist, be executable, and run lint:check'
  )

  const pkgJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(pkgJson.scripts?.eval, 'node scripts/run-evals.mjs', 'package.json must define "eval": "node scripts/run-evals.mjs"')
  assert.equal(pkgJson.scripts?.['clean:artifacts'], 'bash scripts/clean-artifacts.sh')
  const cleanScriptPath = path.join(repoRoot, 'scripts/clean-artifacts.sh')
  for (const badArgs of [[], ['--oauth-account=foo'], ['a', 'b']]) {
    assert.throws(() => execFileSync('bash', [cleanScriptPath, ...badArgs], { encoding: 'utf8', stdio: 'pipe' }), /expected a single <oauth-account> argument/)
  }
  const fakeCleanBinDir = mkdtempSync(path.join(workDir, 'fake_clean_bin_'))
  writeFileSync(path.join(fakeCleanBinDir, 'lkr'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 })
  const fakeCleanOut = execFileSync('bash', [cleanScriptPath, 'test-account'], { env: { ...process.env, PATH: `${fakeCleanBinDir}:/usr/bin:/bin` }, encoding: 'utf8' })
  assert(
    fakeCleanOut.includes('--oauth-account=test-account') && fakeCleanOut.includes('code-mode') && fakeCleanOut.includes('sandbox') && fakeCleanOut.includes('purge_artifacts'),
    'clean-artifacts.sh must invoke lkr --oauth-account=<account> code-mode sandbox with purge_artifacts'
  )
  assert(
    statSync(path.join(repoRoot, 'scripts/run-evals.mjs')).isFile() &&
      antigravityTs.includes('extractInteractionOutputText') &&
      antigravityTs.includes('formatContentInventoryMarkdown') &&
      readFileSync(path.join(repoRoot, 'src/lkrCliBridge.ts'), 'utf8').includes('SEARCH_AGENTS_PREAMBLE_PY') &&
      readFileSync(path.join(repoRoot, 'src/lkrCliBridge.ts'), 'utf8').includes('FORMAT_CONTENT_INVENTORY_PREAMBLE_PY'),
    'Evals #1-#10: scripts/run-evals.mjs, extractInteractionOutputText, formatContentInventoryMarkdown, and Monty WASM search_agents()/format_content_inventory() must be present'
  )

  // Issue #155: Immutable conv_<id> state, unified close/restore content ribbon, lightweight Looker Artifacts rule (root AGENTS.md only), and studio-conversation-debugger exclusion
  const sandboxSkillsBundleTs = readFileSync(path.join(repoRoot, 'src/sandboxSkillsBundle.ts'), 'utf8')
  const convDebuggerSkillMd = readFileSync(
    path.join(repoRoot, '.agents/skills/studio-conversation-debugger/SKILL.md'),
    'utf8'
  )
  const convDebuggerScriptPy = readFileSync(
    path.join(repoRoot, '.agents/skills/studio-conversation-debugger/scripts/inspect_conversation.py'),
    'utf8'
  )
  const fallbackLookmlSpecPath = path.join(workDir, 'lookml_fallback_id.json')
  writeFileSync(
    fallbackLookmlSpecPath,
    JSON.stringify({ title: 'Fallback ID Check', project_id: 'my_proj', model_name: 'ecom' }),
    'utf8'
  )
  const fallbackLookmlOut = execFileSync('python3', [bootstrapPyPath, 'bundle', fallbackLookmlSpecPath], {
    env: { ...process.env, WORKSPACE_DIR: workDir, LOOKML_DIR: lookmlDir, LOOKML_BASELINE_DIR: baselineDir },
    encoding: 'utf8',
  })
  const fallbackLookmlBundle = JSON.parse(
    fallbackLookmlOut.match(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/)[1]
  )
  assert(
    /^my_proj_\d+$/.test(fallbackLookmlBundle.id) && fallbackLookmlBundle.id !== 'lookml-session',
    `Issue #155: BOOTSTRAP_LOOKML_PY fallback id must be <project_id>_<timestamp> (got "${fallbackLookmlBundle.id}")`
  )
  assert(
    !appTsx.includes('messagesByMode') &&
      !appTsx.includes('sessionsByMode') &&
      appTsx.includes('studio-content-tab-close-') &&
      appTsx.includes('studio-content-tabs-more-btn') &&
      appTsx.includes('studio-content-tabs-more-menu') &&
      appTsx.includes('studio-content-tab-restore-') &&
      rootAgentsMd.includes('## Looker Artifacts Lightweight-Only Rule') &&
      rootAgentsMd.includes('.agents/skills/studio-conversation-debugger/SKILL.md') &&
      !upstreamAgentsMd.includes('Looker Artifacts Lightweight-Only Rule') &&
      !upstreamAgentsMd.includes('studio-conversation-debugger') &&
      !antigravityTs.includes('Looker Artifacts Lightweight-Only Rule') &&
      !antigravityTs.includes('studio-conversation-debugger') &&
      !sandboxSkillsBundleTs.includes('studio-conversation-debugger') &&
      !sandboxSkillsBundleTs.includes('"issue-authoring/') &&
      !sandboxSkillsBundleTs.includes('"studio-design-system/') &&
      convDebuggerSkillMd.includes('name: studio-conversation-debugger') &&
      convDebuggerSkillMd.includes('--oauth-account') &&
      convDebuggerScriptPy.includes('user_conversations:') &&
      !/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i.test(
        convDebuggerSkillMd + '\n' + convDebuggerScriptPy
      ),
    'Issue #155: single continuous messages/session, close/restore tab ribbon testids, root-only Looker Artifacts Lightweight-Only Rule, and studio-conversation-debugger exclusion from sandbox skills must hold'
  )
  if (statSync(distBundlePath, { throwIfNoEntry: false })) {
    const distBundleContent = readFileSync(distBundlePath, 'utf8')
    assert(
      !distBundleContent.includes('studio-conversation-debugger') &&
        !distBundleContent.includes('name: issue-authoring') &&
        !distBundleContent.includes('name: studio-design-system') &&
        !distBundleContent.includes('Looker Artifacts Lightweight-Only Rule'),
      'Issue #155: dist/bundle.js must exclude repo-internal skills (studio-conversation-debugger, issue-authoring, studio-design-system) and root-only Looker Artifacts Lightweight-Only Rule'
    )
  }

  // Issue #167: BUNDLE_APP_PY *_day rejection (allowing _day_of_week / _hour_of_day / date: 90) & DASHBOARD_CODEMODE_PREAMBLE_PY field/warning gates
  for (const badDaySnippet of [
    "fields: ['order_items.created_day', 'order_items.count']",
    "const PERIOD_DEFAULTS = { day: 90, week: 53 }; const d = `${m.dateBase}_${this.period}`;",
  ]) {
    const badDayApp = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadDayApp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; } render() { const m = { dateBase: 'orders.created' }; ${badDaySnippet}; return html\`<app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-day-app', BadDayApp);\n`
    assert.throws(
      () => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Day App', path.join(workDir, 'bad_day_app.js')], { input: badDayApp, encoding: 'utf8', stdio: 'pipe' }),
      /invalid-lookml-day-timeframe/,
      'BUNDLE_APP_PY must reject *_day LookML fields and day: keys paired with _${...period}'
    )
  }
  const validDateApp = `import { DataApp, html } from '/runtime/data-app.js';\nconst PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 };\nconst UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' };\nexport class ValidDateApp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; } render() { const m = { dateBase: 'orders.created' }; const dateDim = \`\${m.dateBase}_\${this.period}\`; return html\`<app-chart type="line" .query=\${{ fields: ['orders.created_day_of_week', 'orders.created_hour_of_day', 'orders.count'], limit: String(PERIOD_DEFAULTS[this.period]) }}></app-chart><app-grid .query=\${{ fields: [dateDim, 'orders.count'], filters: { 'orders.created_date': \`90 \${UNITS[this.period]}\` } }}></app-grid>\`; } }\ncustomElements.define('valid-date-app', ValidDateApp);\n`
  const validDateOut = execFileSync('python3', [bundlePyPath, '--stdin', 'Valid Date App', path.join(workDir, 'valid_date_app.js')], { input: validDateApp, encoding: 'utf8' })
  assert(validDateOut.includes('<DATA_APP_BUNDLE>'), 'BUNDLE_APP_PY must allow _day_of_week, _hour_of_day, and date: 90 timeframe keys')

  // Issue #173: BUNDLE_APP_PY unbalanced-kpi-grid rejection (repeat(auto-fit/auto-fill) on KPI strips) & @container 4->2->1 pass
  for (const badKpiMarkup of [
    '<style>.da-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }</style><section class="da-kpi-grid"><app-kpi query-field="orders.count"></app-kpi></section>',
    '<style>.kpi-strip { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }</style><div class="kpi-strip"></div>',
    '<style>.cards { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }</style><div class="cards"><span>Header</span></div><div class="cards"><app-kpi query-field="orders.count"></app-kpi></div>',
    '<section class="da-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));"><app-kpi query-field="orders.count"></app-kpi></section>',
    '<div class="da-kpi-grid"><div class="kpi-card"><span class="kpi-change">+5%</span></div></div>',
    '<style>.da-container { container-type: inline-size; } @container (max-width: 820px) { .da-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }</style><div class="da-container"><div class="da-kpi-grid"><div class="kpi-card"><span class="kpi-change">+5%</span></div></div></div>',
  ]) {
    const badKpiApp = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadKpiApp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html\`${badKpiMarkup}<app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-kpi-app', BadKpiApp);\n`
    assert.throws(
      () => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad KPI App', path.join(workDir, 'bad_kpi_app.js')], { input: badKpiApp, encoding: 'utf8', stdio: 'pipe' }),
      /unbalanced-kpi-grid[\s\S]*@container/,
      'BUNDLE_APP_PY must reject auto-fit/auto-fill KPI grids and un-overridden PoP .da-kpi-grid strips with @container 4 -> 2 -> 1 guidance'
    )
  }
  const balancedKpiApp = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BalancedKpiApp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.periodCount = 90; this.selectedMetric = 'orders.count'; } render() { const m = this.selectedMetric\n    return html\`<style>/* avoid .da-kpi-grid repeat(auto-fit) */ .da-container { container-type: inline-size; } .da-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); } @container (max-width: 820px) { .da-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @container (max-width: 420px) { .da-kpi-grid { grid-template-columns: 1fr; } } .metric-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); }</style><div class="da-container"><div class="metric-charts"><app-chart type="line" .query=\${{ fields: ['orders.created_date', m], limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10))) }}></app-chart></div><div class="da-kpi-grid"><div class="kpi-card"><span class="kpi-change">+5%</span></div></div><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid></div>\`; } }\ncustomElements.define('balanced-kpi-app', BalancedKpiApp);\n`
  const balancedKpiOut = execFileSync('python3', [bundlePyPath, '--stdin', 'Balanced KPI App', path.join(workDir, 'balanced_kpi_app.js')], { input: balancedKpiApp, encoding: 'utf8' })
  assert(balancedKpiOut.includes('<DATA_APP_BUNDLE>'), 'BUNDLE_APP_PY must accept @container 4 -> 2 -> 1 .da-kpi-grid and non-KPI .metric-charts auto-fit grids placed above .da-kpi-grid')

  // Issue #179: BUNDLE_APP_PY forbidden-compare-against-dropdown & invalid-metric-comparison-query-or-axis gates
  assert.throws(
    () => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Compare Select', path.join(workDir, 'bad_cmp_sel.js')], { input: `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadCmpSel extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html\`<app-select label="Compare against" .options=\${[]}></app-select><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-cmp-sel', BadCmpSel);\n`, encoding: 'utf8', stdio: 'pipe' }),
    /forbidden-compare-against-dropdown/,
    'BUNDLE_APP_PY must reject <app-select label="Compare against">'
  )
  assert.throws(
    () => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Single Compare', path.join(workDir, 'bad_single_cmp.js')], { input: `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadSingleCmp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.compareMetric = 'orders.return_count'; } render() { return html\`<app-chart type="line" .query=\${{ fields: ['orders.returned_date', 'orders.count', this.compareMetric] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-single-cmp', BadSingleCmp);\n`, encoding: 'utf8', stdio: 'pipe' }),
    /invalid-metric-comparison-query-or-axis/,
    'BUNDLE_APP_PY must reject single-query or unlinked compareMetric apps'
  )
  const validCompareOut = execFileSync('python3', [bundlePyPath, '--stdin', 'Valid Compare App', path.join(workDir, 'valid_cmp_app.js')], { input: `import { DataApp, html } from '/runtime/data-app.js';\nexport class ValidCmp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.compareMetric = 'orders.return_count'; this.selectedDimensions = ['orders.status']; this.trendRows = null; } async loadTrendData() { await Promise.all(['orders.count', this.compareMetric].map((m, i) => this.runQuery({ fields: [i ? 'orders.returned_date' : 'orders.created_date', m] }))); } render() { const shareScale = true; return html\`<app-chart type="line" .data=\${this.trendRows} .options=\${{ yAxis: [{ title: { text: 'Orders' } }, { ...(shareScale ? { linkedTo: 0 } : {}), opposite: true }] }}></app-chart><app-chart type="bar" .query=\${{ fields: [...this.selectedDimensions, 'orders.count'] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('valid-cmp', ValidCmp);\n`, encoding: 'utf8' })
  assert(validCompareOut.includes('<DATA_APP_BUNDLE>'), 'BUNDLE_APP_PY must accept dual Promise.all + runQuery + .data + linkedTo + opposite compareMetric apps')

  const dashPreambleMatch = antigravityTs.match(/export const DASHBOARD_CODEMODE_PREAMBLE_PY = `([\s\S]*?)`\n\nexport function wrapDashboardCodeMode/)
  assert(dashPreambleMatch, 'Could not extract DASHBOARD_CODEMODE_PREAMBLE_PY')
  const dashPreamblePy = dashPreambleMatch[1].replace(/\\\\n/g, '\\n')
  const gateMockHandler = async (method, urlPath) => {
    const p = String(urlPath || '')
    if (String(method).toUpperCase() === 'GET' && p.includes('/explores/')) return { fields: { dimensions: [{ name: 'orders.created_date' }], measures: [{ name: 'orders.count' }] } }
    if (String(method).toUpperCase() === 'POST' && p.includes('/validate')) return { errors: [{ severity: 'warning', file_path: 'dashboards/pulse.dashboard.lookml', message: 'Unknown field "orders.excluded_metric" referenced in dashboard element' }] }
    return { path: 'dashboards/pulse.dashboard.lookml' }
  }
  const unknownFieldOut = await LkrCodeMode.runPythonCode({ code: `${dashPreamblePy}\nreturn upsert_udd("Bad UDD", "1", tiles=[{"title": "Bad KPI", "fields": ["orders.missing_metric"], "vis_config": {"type": "single_value"}}])`, requestHandler: gateMockHandler, vars: { target_model: 'ecom', target_explore: 'orders' } })
  assert(unknownFieldOut.includes('ValueError') && unknownFieldOut.includes('orders.missing_metric') && unknownFieldOut.includes('orders.count'), `Expected ValueError on unknown field in upsert_udd, got: ${unknownFieldOut}`)
  const warnGateOut = await LkrCodeMode.runPythonCode({ code: `${dashPreamblePy}\nreturn upsert_lookml_dashboard(project_id="ecom_proj", model="ecom", dashboard_name="pulse", title="Pulse", tiles=[{"title": "Orders", "explore": "orders", "fields": ["orders.count"], "vis_config": {"type": "single_value"}}])`, requestHandler: gateMockHandler, vars: { target_model: 'ecom', target_explore: 'orders', target_project_id: 'ecom_proj' } })
  assert(warnGateOut.includes('ValueError') && warnGateOut.includes('Unknown field'), `Expected ValueError on validate_project warning in upsert_lookml_dashboard, got: ${warnGateOut}`)

  console.log('✓ test-bundle.mjs: all assertions passed!')
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
