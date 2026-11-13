import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AntigravityActivityStep, BUNDLE_APP_PY, extractInteractionActivitySteps, fetchEnvironmentFile,
  formatFriendlyLookerActivityLabel, formatThinkingTraceMarkdown, hydrateInteractionActivitySteps, LkrCodeMode,
  LOOKER_DASHBOARD_SKILL_MD, mergeInteractionSseEvent, runAntigravityTurn, sanitizeActivityThought,
} from '../../antigravity'
import {
  clearArtifactServiceCache, clearLookerMetadataCache, hydrateConversationContentItems, loadUserConversations,
  saveUserConversation,
} from '../../lookerApi'

interface MockInteractionPostBody {
  model?: string
  store?: boolean
  background?: boolean
  system_instruction?: string
  generation_config?: Record<string, unknown>
  response_format?: Record<string, unknown>
  environment?: string | { type?: string; sources?: Array<{ target: string; content: string }> }
  previous_interaction_id?: string
  tools?: unknown[]
  agent_config?: { type: string; model: string; max_total_tokens?: string }
  input?: Array<{ type?: string; text?: string; name?: string; call_id?: string; result?: unknown }>
}

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart13Tests(): void {
  test('68. Issue #165: passes plain Struct function_result.result, concatenates SSE arguments + upgrades live step titles + streams turnSdk telemetry, preserves untruncated fenced code traces, lazy-hydrates historical activitySteps, and resolves local SKILL.md without remote 404 overwrite', async () => {
    clearLookerMetadataCache()
    clearArtifactServiceCache()

    // 1. Struct function_result.result (object, array/primitive wrapper, non-JSON fallback) + live turnSdk endpoint telemetry
    const postedBodies: MockInteractionPostBody[] = []
    const seenStatuses: string[] = []
    const liveStepSnapshots: AntigravityActivityStep[][] = []
    const origRunPython = LkrCodeMode.runPythonCode
    let callNum = 0
    const mockTurnSdk = asSdk({
      ok: async <T>(p: T) => p,
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string) => ({
            ok: true,
            statusCode: 200,
            body: JSON.stringify({ rows: [{ id: 1, method, path: reqPath }] }),
          }),
        },
      },
    })

    LkrCodeMode.runPythonCode = async (opts: { code: string; sdk: Looker40SDK }) => {
      callNum += 1
      if (callNum === 1) {
        const tr = (opts.sdk as unknown as { authSession: { transport: { rawRequest: (m: string, p: string) => Promise<unknown> } } }).authSession.transport
        await tr.rawRequest('GET', '/lookml_models/thelook/explores/users')
        await tr.rawRequest('POST', '/queries/run/json')
        return JSON.stringify({ model: 'thelook', explore: 'users', row_count: 5 })
      }
      if (callNum === 2) return JSON.stringify(['alpha', 'beta'])
      return 'plain non-json stdout summary'
    }

    try {
      const mockExt = {
        serverProxy: async (_url: string, init?: FetchCustomParameters) => {
          const b = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
          postedBodies.push(b)
          if (postedBodies.length === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_165_r1',
                environment_id: 'env_165',
                status: 'requires_action',
                steps: [
                  {
                    id: 'fc_obj',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: {
                      thought: 'Inspecting Users explore schema via Looker Code Mode',
                      code: 'exp = lookml_model_explore("thelook", "users")\nreturn run_inline_query("json", {"model": "thelook", "view": "users"})',
                    },
                  },
                ],
              }),
            }
          }
          if (postedBodies.length === 2) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_165_r2',
                environment_id: 'env_165',
                status: 'requires_action',
                steps: [
                  { id: 'fc_arr', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: 'Listing tags in LkrCodeMode', code: 'return ["alpha", "beta"]' } },
                ],
              }),
            }
          }
          if (postedBodies.length === 3) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_165_r3',
                environment_id: 'env_165',
                status: 'requires_action',
                steps: [
                  { id: 'fc_txt', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: 'Checking raw text in the WASM Monty sandbox', code: 'return "raw"' } },
                ],
              }),
            }
          }
          return { ok: true, status: 200, body: JSON.stringify({ id: 'int_165_done', environment_id: 'env_165', status: 'completed', output_text: 'Completed Struct verification.' }) }
        },
      }

      const turnRes = await runAntigravityTurn({
        sdk: mockTurnSdk,
        extensionSDK: mockExt,
        auth: { mode: 'apikey', apiKey: 'key_165' },
        session: { environmentId: 'env_165', toolType: 'app' },
        selectedExplores: ['thelook::users'],
        schemaMarkdown: '# Schema',
        userPrompt: 'Check users explore',
        onProgressSteps: (st) => liveStepSnapshots.push(st.map((x) => ({ ...x }))),
        onStatus: (s) => seenStatuses.push(s),
      })

      const res1 = postedBodies[1]?.input?.[0]?.result
      const res2 = postedBodies[2]?.input?.[0]?.result
      const res3 = postedBodies[3]?.input?.[0]?.result
      expect(typeof res1).toBe('object')
      expect(res1).toEqual({ model: 'thelook', explore: 'users', row_count: 5 })
      expect(typeof res2).toBe('object')
      expect(res2).toEqual({ result: ['alpha', 'beta'] })
      expect(typeof res3).toBe('object')
      expect(res3).toEqual({ result: 'plain non-json stdout summary' })

      expect(seenStatuses.some((s) => /GET \/lookml_models\/thelook\/explores\/users \(\d+ms\)/.test(s))).toBe(true)
      expect(seenStatuses.some((s) => /POST \/queries\/run\/json \(\d+ms\)/.test(s))).toBe(true)
      const fcObjStep = turnRes.activitySteps?.find((s) => s.id === 'fc_obj')
      expect(fcObjStep?.title).toBe('Inspecting Users explore schema')
      expect(fcObjStep?.content).toMatch(/GET \/lookml_models\/thelook\/explores\/users \(\d+ms\)/)
      expect(fcObjStep?.content).toMatch(/POST \/queries\/run\/json \(\d+ms\)/)
      expect(liveStepSnapshots.some((snap) => snap.some((s) => /GET \/lookml_models\/thelook\/explores\/users \(\d+ms\)/.test(s.content || '')))).toBe(true)
    } finally {
      LkrCodeMode.runPythonCode = origRunPython
    }

    // 2. SSE arguments concatenation + plain-object shallow merge + upsertStep title upgrade + sanitizeActivityThought + expanded friendly labels
    expect(sanitizeActivityThought('Validating LookML project ecom via Looker Code Mode')).toBe('Validating LookML project ecom')
    expect(sanitizeActivityThought('Profiling order_items in the WASM Monty sandbox')).toBe('Profiling order_items')
    expect(sanitizeActivityThought('Running LkrCodeMode')).toBe('')

    let sseState = mergeInteractionSseEvent(
      { id: 'int_sse_165', status: 'in_progress' },
      'step.delta',
      { step: { id: 'fc_sse_1', type: 'function_call', name: 'run_looker_codemode', arguments: '{"thought":"Validating ' } }
    )
    expect(extractInteractionActivitySteps(sseState)[0]?.title).toBe('Executing Looker API calls...')
    sseState = mergeInteractionSseEvent(
      sseState,
      'step.delta',
      { step_delta: { id: 'fc_sse_1', arguments: 'sales_core LookML via Looker Code Mode","code":"return validate_project(\\"sales_core\\")"}' } }
    )
    expect(sseState.steps?.[0]?.arguments).toBe(
      '{"thought":"Validating sales_core LookML via Looker Code Mode","code":"return validate_project(\\"sales_core\\")"}'
    )
    const upgradedSteps = extractInteractionActivitySteps({
      status: 'in_progress',
      steps: [
        { id: 'fc_sse_1', type: 'function_call', name: 'run_looker_codemode', arguments: '{}' },
        sseState.steps![0],
      ],
    })
    expect(upgradedSteps).toHaveLength(1)
    expect(upgradedSteps[0]).toMatchObject({
      id: 'fc_sse_1',
      kind: 'codemode',
      title: 'Validating sales_core LookML',
      detail: 'sdk.validate_project',
    })

    const objMerged = mergeInteractionSseEvent(
      mergeInteractionSseEvent({ id: 'int_obj', status: 'in_progress' }, 'step.delta', { step: { id: 'fc_o', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: 'Checking folders' } } }),
      'step.delta',
      { step_delta: { id: 'fc_o', arguments: { code: 'return folder_children("5")' } } }
    )
    expect(objMerged.steps?.[0]?.arguments).toEqual({ thought: 'Checking folders', code: 'return folder_children("5")' })

    expect(formatFriendlyLookerActivityLabel('create_project({"name": "ecom_dw"})').statusText).toContain('Configuring LookML project Ecom Dw')
    expect(formatFriendlyLookerActivityLabel('connection_schemas("bq_prod")').statusText).toContain('Inspecting database connection Bq Prod')
    expect(formatFriendlyLookerActivityLabel('generate_lookml_with_new_files("ecom_dw")').statusText).toContain('Generating LookML files for Ecom Dw')
    expect(formatFriendlyLookerActivityLabel('validate_project("ecom_dw")').statusText).toContain('Validating LookML project Ecom Dw')
    expect(formatFriendlyLookerActivityLabel('upsert_udd("Q4 Revenue Pulse")').statusText).toContain('Building Looker dashboard Q4 Revenue Pulse')
    expect(formatFriendlyLookerActivityLabel('folder_children("5")').statusText).toContain('Inspecting Looker folder')

    // 3. Untruncated step.content (stripping duplicate bundle envelopes) + fenced ```bash / ```python blocks in formatThinkingTraceMarkdown
    const tenLineApp = Array.from({ length: 12 }, (_, i) => `const metricLine_${i + 1} = "UNTRUNCATED_LINE_${i + 1}";`).join('\n')
    const bundleCmd = `python3 /workspace/bundle_app.py --app-dir /workspace/apps/c1 --stdin "App" << 'EOF'\nimport { DataApp, html } from '/runtime/data-app.js';\n${tenLineApp}\nEOF`
    const fullSteps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        {
          id: 'ce_full',
          type: 'code_execution',
          language: 'BASH',
          command: bundleCmd,
          stdout: `Bundled 3 widgets OK.\n<DATA_APP_BUNDLE>{"title":"App","prod_code":"huge","raw_code":"huge","widgets":[]}</DATA_APP_BUNDLE>`,
        },
      ],
    })
    expect(fullSteps[0]?.detail).toBeUndefined()
    expect(fullSteps[0]?.content).toContain('UNTRUNCATED_LINE_12')
    expect(fullSteps[0]?.content).toContain('Bundled 3 widgets OK.')
    expect(fullSteps[0]?.content).not.toContain('<DATA_APP_BUNDLE>')
    const fencedTrace = formatThinkingTraceMarkdown([fullSteps[0], upgradedSteps[0]])
    expect(fencedTrace).toContain('```bash')
    expect(fencedTrace).toContain('UNTRUNCATED_LINE_12')
    expect(fencedTrace).toContain('```python')
    expect(fencedTrace).toContain('return validate_project("sales_core")')

    // 4. Lazy multi-hop hydrateInteractionActivitySteps (walking back to stopAtInteractionId, skipping [PREWARM:, max 105 hops)
    const fetchedHopUrls: string[] = []
    const hopMap: Record<string, Record<string, unknown>> = {
      int_t2_final: {
        id: 'int_t2_final',
        previous_interaction_id: 'int_t2_call',
        status: 'completed',
        input: [{ type: 'function_result', name: 'run_looker_codemode', call_id: 'fc_t2', result: { total_orders: 1280 } }],
        steps: [{ id: 'ce_t2', type: 'code_execution', language: 'BASH', command: 'echo "FINAL_STEP_T2"', stdout: 'FINAL_STEP_T2' }],
      },
      int_t2_call: {
        id: 'int_t2_call',
        previous_interaction_id: 'int_t1_done',
        status: 'requires_action',
        input: [{ type: 'text', text: 'Update orders tile' }],
        steps: [
          { id: 'th_t2', type: 'thought', thought: 'Planning Turn 2 query' },
          { id: 'fc_t2', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: 'Querying order count', code: 'return run_inline_query("json", {"model":"thelook","view":"orders"})' } },
        ],
      },
      int_t1_done: {
        id: 'int_t1_done',
        status: 'completed',
        steps: [{ id: 'th_t1', type: 'thought', thought: 'MUST_NOT_INCLUDE_TURN_1' }],
      },
    }
    const hydratedTurn2 = await hydrateInteractionActivitySteps({
      extensionSDK: {
        serverProxy: async (url: string) => {
          fetchedHopUrls.push(url)
          const id = decodeURIComponent(url.split('/interactions/')[1] || '')
          return { ok: true, status: 200, body: JSON.stringify(hopMap[id] || {}) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'k' },
      interactionId: 'int_t2_final',
      stopAtInteractionId: 'int_t1_done',
    })
    expect(fetchedHopUrls).toHaveLength(2)
    expect(hydratedTurn2.map((s) => s.id)).toEqual(['th_t2', 'fc_t2', 'ce_t2'])
    expect(hydratedTurn2.find((s) => s.id === 'fc_t2')?.content).toContain('1280')
    expect(JSON.stringify(hydratedTurn2)).not.toContain('MUST_NOT_INCLUDE_TURN_1')

    let runawayCalls = 0
    await hydrateInteractionActivitySteps({
      extensionSDK: {
        serverProxy: async (url: string) => {
          runawayCalls += 1
          const cur = Number((url.match(/hop_(\d+)/) || [])[1] || 0)
          return { ok: true, status: 200, body: JSON.stringify({ id: `hop_${cur}`, previous_interaction_id: `hop_${cur + 1}`, status: 'completed', steps: [] }) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'k' },
      interactionId: 'hop_1',
    })
    expect(runawayCalls).toBe(105)

    let customCapCalls = 0
    await hydrateInteractionActivitySteps({
      extensionSDK: {
        serverProxy: async (url: string) => {
          customCapCalls += 1
          const cur = Number((url.match(/hop_(\d+)/) || [])[1] || 0)
          return { ok: true, status: 200, body: JSON.stringify({ id: `hop_${cur}`, previous_interaction_id: `hop_${cur + 1}`, status: 'completed', steps: [] }) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'k' },
      interactionId: 'hop_1',
      maxHops: 12,
    })
    expect(customCapCalls).toBe(12)

    // 5. Unconditional local SKILL.md resolution in fetchEnvironmentFile with zero remote HTTP calls
    let remoteSkillCalls = 0
    const skillText = await fetchEnvironmentFile({
      extensionSDK: {
        serverProxy: async () => {
          remoteSkillCalls += 1
          return { ok: false, status: 404, body: 'Not Found' }
        },
      },
      auth: { mode: 'apikey', apiKey: 'k' },
      environmentId: 'env_404',
      path: '/workspace/skills/looker-dashboard/SKILL.md',
    })
    expect(remoteSkillCalls).toBe(0)
    expect(skillText).toBe(LOOKER_DASHBOARD_SKILL_MD)
  })

  test('69. Issue #173: rejects repeat(auto-fit/auto-fill) KPI grids in BUNDLE_APP_PY while permitting @container 4 -> 2 -> 1 balanced KPI grids and custom Window number popovers', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const rawMatch = readFileSync(path.join(repoRoot, 'src/antigravityPrompts.ts'), 'utf8').match(/export const BUNDLE_APP_PY = `([\s\S]*?)`\n/)
    expect(rawMatch?.[1]).toBe(BUNDLE_APP_PY)

    const workDir = mkdtempSync(path.join(tmpdir(), 'dab-173-test-'))
    try {
      const bundlePyPath = path.join(workDir, 'bundle_app.py')
      writeFileSync(bundlePyPath, BUNDLE_APP_PY.replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`), 'utf8')
      const env = { ...process.env }
      for (const badMarkup of [
        '<style>.da-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }</style><section class="da-kpi-grid"><app-kpi query-field="orders.count"></app-kpi></section>',
        '<style>.summary-cards, .da-kpi-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }</style><div class="da-kpi-grid"></div>',
        '<style>.top-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }</style><div class="top-cards"><span>Banner</span></div><div class="top-cards"><app-kpi query-field="orders.count"></app-kpi></div>',
        '<div @click=${(e) => e} style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))" class="da-kpi-grid"><app-kpi query-field="orders.count"></app-kpi></div>',
        '<div class="da-kpi-grid"><div class="card"><span class="kpi-change">+4%</span></div></div>',
        '<style>.da-container { container-type: inline-size; } @container (max-width: 820px) { .da-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }</style><div class="da-container"><div class="da-kpi-grid"><div class="card"><span class="kpi-change">+4%</span></div></div></div>',
      ]) {
        const badSrc = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadKpi extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html\`${badMarkup}<app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-kpi', BadKpi);`
        expect(() => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad KPI', path.join(workDir, 'bad.js')], { input: badSrc, env, encoding: 'utf8', stdio: 'pipe' })).toThrow(/unbalanced-kpi-grid[\s\S]*4 -> 2 -> 1/)
      }

      const goodSrc = `import { DataApp, html } from '/runtime/data-app.js';\n// Override .da-kpi-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }\nconst PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 };\nconst WINDOW_OPTIONS = { date: [14, 30, 60, 90, 180] };\nconst UNITS = { date: 'days' };\nexport class GoodBalanced extends DataApp { static properties = { period: { type: String }, periodCount: { type: Number }, customWindowOpen: { type: Boolean }, customWindowDraft: { type: String } }; constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; this.periodCount = PERIOD_DEFAULTS.date + 30; this.customWindowOpen = false; this.selectedMetric = 'orders.count'; } render() { const sel = this.selectedMetric\n    return html\`<style>/* avoid .da-kpi-grid repeat(auto-fit) */ .da-container { container-type: inline-size; } .da-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); } @container (max-width: 820px) { .da-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @container (max-width: 420px) { .da-kpi-grid { grid-template-columns: 1fr; } } .metric-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); }</style><div class="da-container"><div class="da-filter-bar"><span>Period: \${this.period}</span><span>Window: \${!(WINDOW_OPTIONS[this.period] || []).includes(this.periodCount) ? html\`<button class="active">\${this.periodCount} \${UNITS[this.period]}</button>\` : ''}</span><button title="Custom window length" @click=\${() => { this.customWindowDraft = String(this.periodCount); this.customWindowOpen = !this.customWindowOpen; }}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg></button>\${this.customWindowOpen ? html\`<input @keydown=\${(e) => e} type="number" min="1" max="1000" .value=\${this.customWindowDraft ?? String(this.periodCount)}>\` : ''}</div><div class="metric-charts"><app-chart type="areaspline" .query=\${{ fields: ['orders.created_date', sel], limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10))) }}></app-chart></div><div class="da-kpi-grid"><div class="card"><span class="kpi-change">+4%</span><span>vs. prev 120 days</span></div></div><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid></div>\`; } }\ncustomElements.define('good-balanced', GoodBalanced);`
      expect(execFileSync('python3', [bundlePyPath, '--stdin', 'Good Balanced', path.join(workDir, 'good.js')], { input: goodSrc, env, encoding: 'utf8' })).toContain('<DATA_APP_BUNDLE>')

      const fnBodyMatch = readFileSync(path.join(repoRoot, 'scripts/eval-new-project.mjs'), 'utf8').match(/const cleanCode =[\s\S]*?const hasDecoupledPeriodAndWindow =[^\n]+/)
      expect(fnBodyMatch).toBeTruthy()
      const runTurn6Checks = new Function('code', `${fnBodyMatch?.[0]}\nreturn { hasBalancedKpiGrid, hasCustomWindowPopover, hasDecoupledPeriodAndWindow };`) as (c: string) => Record<string, boolean>
      const expectedChecks = { hasBalancedKpiGrid: true, hasCustomWindowPopover: true, hasDecoupledPeriodAndWindow: true }
      expect(runTurn6Checks(`${goodSrc}\n// getEffectiveFilters`)).toEqual(expectedChecks)
      const aliasVariant = `${goodSrc.replace('!(WINDOW_OPTIONS[this.period] || []).includes(this.periodCount)', '!presets.includes(n)').replace('limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)))', 'limit')}\nconst limit = String(Math.min(5000, Math.max(500, n * 2 + 10))); function getEffectiveFilters() {}`
      expect(runTurn6Checks(aliasVariant)).toEqual(expectedChecks)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('70. Issue #172: prunePersistedMessages preserves compact crudItems on mutating turns and omits crudItems on chat-only turns', async () => {
    const store = new Map<string, string>()
    const mockSdk = {
      authSession: {
        transport: {
          rawRequest: async (method: string, path: string, _q?: unknown, body?: unknown) => {
            if (method === 'GET' && path.includes('/artifacts/')) {
              const key = decodeURIComponent(path.split('/artifacts/')[1]?.split('/').pop() || '')
              const val = store.get(key)
              return val ? { ok: true, statusCode: 200, body: [{ key, value: val, version: 1 }] } : { ok: false, statusCode: 404, body: { message: 'Not Found' } }
            }
            if (method === 'PUT' && path.includes('/artifacts/')) {
              const rows = Array.isArray(body) ? body : [body]
              rows.forEach((r: { key?: string; value?: string }) => { if (r?.key && typeof r.value === 'string') store.set(r.key, r.value) })
              return { ok: true, statusCode: 200, body: rows }
            }
            return { ok: true, statusCode: 200, body: [] }
          },
        },
      },
    } as unknown as Parameters<typeof saveUserConversation>[0]

    await saveUserConversation(mockSdk, 'u172', {
      id: 'conv_crud_172',
      type: 'app',
      label: 'CRUD Turn Persistence',
      updatedAt: '2026-11-10T19:00:00Z',
      messages: [
        { role: 'user', text: 'Create app' },
        {
          role: 'assistant',
          text: 'Created app #42.',
          dashboardId: '42',
          activitySteps: [{ id: 's1', kind: 'thought', title: 'Thinking', status: 'done' }],
          crudItems: [{ key: 'data_app:42', id: '42', title: 'Exec App', contentType: 'data_app', embedPath: '/embed/dashboards/42', action: 'created' }],
        },
        { role: 'user', text: 'Explain KPIs' },
        { role: 'assistant', text: 'KPIs use net revenue.', crudItems: [] },
      ],
    })
    const loaded = await loadUserConversations(mockSdk, 'u172')
    const conv = loaded.find((c) => c.id === 'conv_crud_172')
    expect(conv?.messages?.[1]?.crudItems).toEqual([
      { key: 'data_app:42', id: '42', title: 'Exec App', contentType: 'data_app', embedPath: '/embed/dashboards/42', action: 'created' },
    ])
    expect(conv?.messages?.[1]?.activitySteps).toBeUndefined()
    expect('crudItems' in (conv?.messages?.[3] || {})).toBe(false)

    // Deleting the last remaining tab persists contentItems: [] without resurrecting prev.contentItems or conv.content
    await saveUserConversation(mockSdk, 'u172', {
      id: 'conv_crud_172',
      type: 'app',
      content: { dashboardId: '42' },
      contentItems: [{ key: 'data_app:42', id: '42', title: 'Exec App', contentType: 'data_app', embedPath: '/embed/dashboards/42' }],
      activeContentTabKey: 'data_app:42',
    })
    const afterDelList = await saveUserConversation(mockSdk, 'u172', {
      id: 'conv_crud_172',
      type: 'app',
      contentItems: [],
      activeContentTabKey: '',
      messages: [
        { role: 'user', text: 'Delete dashboard 42' },
        { role: 'assistant', text: 'Deleted.', crudItems: [{ key: 'data_app:42', id: '42', title: 'Exec App', contentType: 'data_app', action: 'deleted' }] },
      ],
    })
    const afterDelConv = afterDelList.find((c) => c.id === 'conv_crud_172')!
    expect(afterDelConv.contentItems).toEqual([])
    expect(afterDelConv.activeContentTabKey).toBe('')
    expect(hydrateConversationContentItems(afterDelConv)).toEqual([])
  })

}
