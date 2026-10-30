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

const antigravityTs = readFileSync(path.join(repoRoot, 'src/antigravity.ts'), 'utf8')
assert(
  antigravityTs.includes('https://www.googleapis.com/auth/generative-language.retriever'),
  'OAuth scope must use consent-page-allowed generative-language.retriever scope'
)
assert(
  antigravityTs.includes('!session.lastInteractionId'),
  'Session continuation must key off session.lastInteractionId'
)
const appTsx = readFileSync(path.join(repoRoot, 'src/components/App.tsx'), 'utf8')
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
const lookerApiTs = readFileSync(path.join(repoRoot, 'src/lookerApi.ts'), 'utf8')
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
const pythonTileTsx = readFileSync(path.join(repoRoot, 'src/components/PythonTile.tsx'), 'utf8')
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
  console.log('✓ test-bundle.mjs: all assertions passed!')
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
