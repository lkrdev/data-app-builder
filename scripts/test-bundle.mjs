// Assert-based self-check for the embedded Antigravity sandbox bundler (BUNDLE_APP_PY) and WASM CodeMode bridge.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, '..')
const LkrCodeMode = require(path.join(repoRoot, 'src/vendor/codemode.js'))

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

const antigravityTs = ['src/antigravity.ts', 'src/antigravityPrompts.ts']
  .map((p) => readFileSync(path.join(repoRoot, p), 'utf8'))
  .join('\n')
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
  'src/components/StudioHeader.tsx',
  'src/components/StudioWorkspace.tsx',
  'src/useStudioController.ts',
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
  manifestLkml.includes('"create_look"') &&
    manifestLkml.includes('"create_board"') &&
    manifestLkml.includes('"create_dashboard_filter"') &&
    manifestLkml.includes('"create_scheduled_plan"') &&
    manifestLkml.includes('"update_artifacts"'),
  'manifest.lkml must declare native content and artifact core_api_methods'
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
    appTsx.includes('dab-mode-switcher'),
  'App.tsx must include STUDIO_MODES switcher, parseStudioRoute, PythonTileMount, and dab-permission-bar'
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
  const lookmlToolTsx = readFileSync(path.join(repoRoot, 'src/lookmlTool.tsx'), 'utf8')
  assert(
    lookmlToolTsx.includes('user_${cleanUser}_lookml_${cleanId}') &&
      lookmlToolTsx.includes('obj_lookml_${cleanId}'),
    'lookmlTool.tsx must persist user_${userId}_lookml_${id} and obj_lookml_${id}'
  )
  assert(
    antigravityTs.includes("allowUpdateSession: toolMode === 'lookml' || mode === 'dashboard'") &&
      antigravityTs.includes('LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.vars') &&
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
  assert(
    rootAgentsMd.includes('## Conversation Labeling (Stateless Side-Request)') &&
      rootAgentsMd.includes('[CONVERSATION_LABEL_REQUEST]') &&
      rootAgentsMd.includes('## Use Case Auto-Classification (Turn 1 Routing)') &&
      rootAgentsMd.includes('<USE_CASE>') &&
      upstreamAgentsMd.includes('## Conversation Labeling (Stateless Side-Request)') &&
      upstreamAgentsMd.includes('## Use Case Auto-Classification (Turn 1 Routing)') &&
      antigravityTs.includes("target: '/workspace/AGENTS.md'") &&
      antigravityTs.includes('generateConversationLabel') &&
      antigravityTs.includes('sanitizeConversationLabel') &&
      lookerApiTs.includes('extractResolvedUseCase') &&
      lookerApiTs.includes('getAllowedUseCases') &&
      lookerApiTs.includes('user_conversations:') &&
      lookerApiTs.includes('loadUserConversations') &&
      lookerApiTs.includes('saveUserConversation') &&
      appTsx.includes('data-testid="use-case-selector"') &&
      appTsx.includes('data-testid="locked-use-case-badge"'),
    'Issues #25 & #26: AGENTS.md routing + labeling, /workspace/AGENTS.md seeding, use-case-selector, locked-use-case-badge, and user_conversations:${me.id} persistence must be present'
  )
  console.log('✓ test-bundle.mjs: all assertions passed!')
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
