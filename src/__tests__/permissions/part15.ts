import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Looker40SDK } from '@looker/sdk'

import {
  AntigravityInteractionPayload, BUNDLE_APP_PY, DATA_APP_GUIDE_MD, extractInteractionOutputText,
  LkrCodeMode, LOOKER_DASHBOARD_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, mergeInteractionSseEvent,
  runAntigravityTurn, wrapDashboardCodeMode,
} from '../../antigravity'
import { deriveConversationOverviewData } from '../../components/StudioWorkspace'
import { STUDIO_OVERVIEW_TAB_KEY } from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart15Tests(): void {
  test('73. Issue #177: merges real /v1beta/interactions SSE wire events (top-level data.index, arguments_delta over {}, thought_summary content.text, step.stop, interaction.completed), preserves cross-project <catalog>.<schema> sql_table_name & raw_views, gates dashboards on 1-row json_detail live SQL, and normalizes field-backed LookML filters to field_filter', async () => {
    // 1. Real /v1beta/interactions SSE wire event sequence + runAntigravityTurn OAuth SSE tool execution
    const structuredContent = [{ type: 'thought', text: 'Initial structured part' }]
    let wireState: AntigravityInteractionPayload = { id: 'int_177_r1', status: 'in_progress' }
    const wireEvents: Array<[string, Record<string, unknown>]> = [
      ['step.start', { index: 0, step: { id: 'th_0', type: 'thought', content: structuredContent }, event_type: 'step.start' }],
      ['step.delta', { index: 0, delta: { content: { text: 'Inspecting cross-project ' }, type: 'thought_summary' }, event_type: 'step.delta' }],
      ['step.delta', { index: 0, delta: { content: { text: 'BigQuery dataset...' }, type: 'thought_summary' }, event_type: 'step.delta' }],
      ['step.stop', { index: 0, event_type: 'step.stop' }],
      ['step.start', { index: 1, step: { id: 'call_177', type: 'function_call', name: 'run_looker_codemode', arguments: {} }, event_type: 'step.start' }],
      ['step.delta', { index: 1, delta: { arguments: '{"thought":"Listing tables","code":', type: 'arguments_delta' }, event_type: 'step.delta' }],
      ['step.delta', { index: 1, delta: { arguments: '"return {\\"ok\\": True, \\"rows\\": 3}"}', type: 'arguments_delta' }, event_type: 'step.delta' }],
      ['step.stop', { index: 1, event_type: 'step.stop' }],
      ['interaction.completed', { interaction: { id: 'int_177_r1', status: 'requires_action', environment_id: 'env_177' }, event_type: 'interaction.completed' }],
    ]
    for (const [evtName, payload] of wireEvents) wireState = mergeInteractionSseEvent(wireState, evtName, payload)
    const mergedSteps = (wireState.steps || []) as Array<Record<string, unknown>>
    expect(mergedSteps).toHaveLength(2)
    expect(mergedSteps[0]).toMatchObject({ id: 'th_0', index: 0, type: 'thought', thought: 'Inspecting cross-project BigQuery dataset...', content: structuredContent })
    expect(mergedSteps[1]).toMatchObject({ id: 'call_177', index: 1, type: 'function_call', name: 'run_looker_codemode', arguments: '{"thought":"Listing tables","code":"return {\\"ok\\": True, \\"rows\\": 3}"}' })
    expect(wireState.status).toBe('requires_action')

    // Sparse index text deltas + statusless interaction.completed event
    let textWireState: AntigravityInteractionPayload = { id: 'int_177_r2', status: 'in_progress', steps: wireState.steps }
    textWireState = mergeInteractionSseEvent(textWireState, 'step.delta', { index: 34, delta: { text: '<USE_CASE>lookml</USE_CASE>\nOnboarded ', type: 'text' }, event_type: 'step.delta' })
    textWireState = mergeInteractionSseEvent(textWireState, 'step.delta', { index: 34, delta: { text: '`ext_catalog.sales_dw`.', type: 'text' }, event_type: 'step.delta' })
    textWireState = mergeInteractionSseEvent(textWireState, 'step.stop', { index: 34, event_type: 'step.stop' })
    textWireState = mergeInteractionSseEvent(textWireState, 'interaction.completed', { interaction: { id: 'int_177_r2' }, event_type: 'interaction.completed' })
    expect(textWireState.status).toBe('completed')
    expect((textWireState.steps as unknown[]).length).toBe(3)
    expect(extractInteractionOutputText(textWireState)).toBe('<USE_CASE>lookml</USE_CASE>\nOnboarded `ext_catalog.sales_dw`.')

    // End-to-end OAuth SSE turn through runAntigravityTurn executes streamed code (not "")
    const originalFetch = globalThis.fetch
    const executedCodes: string[] = []
    const origRunPy = LkrCodeMode.runPythonCode
    LkrCodeMode.runPythonCode = (async (opts: { code: string }) => {
      executedCodes.push(opts.code)
      return JSON.stringify({ tables: ['orders', 'customers'] })
    }) as typeof LkrCodeMode.runPythonCode
    try {
      let postNum = 0
      let sseNum = 0
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input)
        if (init?.method === 'POST') {
          postNum += 1
          return { ok: true, status: 200, text: async () => JSON.stringify({ id: postNum === 1 ? 'int_oauth_177_1' : 'int_oauth_177_2', environment_id: 'env_oauth_177', status: 'in_progress' }) } as unknown as Response
        }
        if (urlStr.includes('stream=true&alt=sse')) {
          sseNum += 1
          const encoder = new TextEncoder()
          const sseFrames = sseNum === 1
            ? [
                'id: e1\nevent: step.start\ndata: {"index":1,"step":{"id":"fc_oauth_1","type":"function_call","name":"run_looker_codemode","arguments":{}},"event_type":"step.start"}\n\n',
                'id: e2\nevent: step.delta\ndata: {"index":1,"delta":{"arguments":"{\\"thought\\":\\"Checking tables\\",\\"code\\":\\"return connection_tables(\\\\\\"bq_conn\\\\\\", schema_name=\\\\\\"ext_catalog.sales_dw\\\\\\")\\"}","type":"arguments_delta"},"event_type":"step.delta"}\n\n',
                'id: e3\nevent: step.stop\ndata: {"index":1,"event_type":"step.stop"}\n\n',
                'id: e4\nevent: interaction.completed\ndata: {"interaction":{"id":"int_oauth_177_1","status":"requires_action","environment_id":"env_oauth_177"},"event_type":"interaction.completed"}\n\n',
              ]
            : [
                'id: e5\nevent: step.delta\ndata: {"index":34,"delta":{"text":"<USE_CASE>lookml</USE_CASE>\\nVerified tables.","type":"text"},"event_type":"step.delta"}\n\n',
                'id: e6\nevent: step.stop\ndata: {"index":34,"event_type":"step.stop"}\n\n',
                'id: e7\nevent: interaction.completed\ndata: {"interaction":{"id":"int_oauth_177_2","status":"completed","environment_id":"env_oauth_177"},"event_type":"interaction.completed"}\n\n',
              ]
          let fIdx = 0
          return {
            ok: true, status: 200, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
            body: { getReader: () => ({ read: async () => (fIdx >= sseFrames.length ? { done: true, value: undefined } : { done: false, value: encoder.encode(sseFrames[fIdx++]) }), cancel: async () => {}, releaseLock: () => {} }) },
          } as unknown as Response
        }
        throw new Error(`Unexpected fetch URL: ${urlStr}`)
      }) as typeof fetch

      const oauthTurn = await runAntigravityTurn({
        sdk: asSdk({ ok: async <T>(p: T) => p }), extensionSDK: {}, auth: { mode: 'oauth', oauthToken: 'oauth_tok_177' },
        session: { environmentId: 'env_oauth_177', lastInteractionId: 'int_prev_177', toolType: 'lookml' },
        toolMode: 'lookml', useCase: 'lookml', lookmlProjectId: 'sales_proj', selectedExplores: [],
        schemaMarkdown: '# Schema', userPrompt: 'Generate bronze views for ext_catalog.sales_dw.*', onStatus: () => {},
      })
      expect(executedCodes).toEqual(['return connection_tables("bq_conn", schema_name="ext_catalog.sales_dw")'])
      expect(oauthTurn.assistantText).toBe('Verified tables.')
    } finally {
      globalThis.fetch = originalFetch
      LkrCodeMode.runPythonCode = origRunPy
    }

    // 2. Cross-project <catalog>.<schema>.* onboarding preservation, remote update_file on # AUTOGENERATED, database/schema_name + 404 connection_columns fallback, & SSE edge cases
    let edgeState: AntigravityInteractionPayload = { id: 'int_177_edge', status: 'in_progress' }
    edgeState = mergeInteractionSseEvent(edgeState, 'step.start', { index: 1, step: { id: 'fc_shared', type: 'function_call', function_call: { name: 'run_looker_codemode', arguments: {} } } })
    edgeState = mergeInteractionSseEvent(edgeState, 'message', { index: 1, delta: { function_call: { arguments: '{"code":' }, type: 'arguments_delta' }, event_type: 'step.delta' })
    edgeState = mergeInteractionSseEvent(edgeState, 'message', { index: 1, delta: { function_call: { arguments: '"return 1"}' }, type: 'arguments_delta' }, event_type: 'step.delta' })
    edgeState = mergeInteractionSseEvent(edgeState, 'step.start', { index: 2, step: { type: 'function_result', call_id: 'fc_shared', result: { ok: true } } })
    edgeState = mergeInteractionSseEvent(edgeState, 'step.start', { index: 3, step: { id: 'ce_1', type: 'code_execution', stdout: '<LOOKML_' } })
    edgeState = mergeInteractionSseEvent(edgeState, 'step.delta', { index: 3, delta: { stdout: 'BUNDLE>{"id":"p1"}</LOOKML_BUNDLE>', type: 'output_delta' } })
    edgeState = mergeInteractionSseEvent(edgeState, 'step.delta', { index: 4, delta: { content: { text: 'Chunk A ' }, type: 'text' } })
    edgeState = mergeInteractionSseEvent(edgeState, 'step.delta', { index: 4, delta: { content: { text: 'Chunk B' }, type: 'text' } })
    edgeState = mergeInteractionSseEvent(edgeState, 'step.start', { index: 5, step: { id: 'fc_0delta', type: 'function_call', function_call: { name: 'run_looker_codemode', arguments: '{"code":"return 2"}' } } })
    edgeState = mergeInteractionSseEvent(edgeState, 'interaction.cancelled', { steps: [] })
    const edgeSteps = edgeState.steps as Array<Record<string, unknown>>
    expect(edgeState.status).toBe('cancelled')
    expect(edgeSteps).toHaveLength(5)
    expect(edgeSteps[0]).toMatchObject({ id: 'fc_shared', type: 'function_call', name: 'run_looker_codemode', arguments: '{"code":"return 1"}', function_call: { name: 'run_looker_codemode', arguments: '{"code":"return 1"}' } })
    expect(edgeSteps[1]).toMatchObject({ index: 2, type: 'function_result', call_id: 'fc_shared' })
    expect(edgeSteps[2]?.stdout).toBe('<LOOKML_BUNDLE>{"id":"p1"}</LOOKML_BUNDLE>')
    expect(edgeSteps[4]).toMatchObject({ id: 'fc_0delta', type: 'function_call', name: 'run_looker_codemode', arguments: '{"code":"return 2"}' })
    expect(extractInteractionOutputText(edgeState)).toBe('Chunk A Chunk B')

    const repoRoot = path.resolve(__dirname, '../../..')
    expect(readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')).toBe(LOOKER_PROJECT_ONBOARDING_SKILL_MD)
    for (const tok of ['removesuffix(".*")', 'raw_views', '<catalog>.<schema>', 'update_file', 'dimension_group:']) {
      expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain(tok)
    }
    const step31PyMatch = LOOKER_PROJECT_ONBOARDING_SKILL_MD.match(/```python\n([\s\S]*?)\n {3}```/)
    expect(step31PyMatch).toBeTruthy()
    const step31Code = step31PyMatch![1]
      .split('\n')
      .map((l) => l.replace(/^ {3}/, ''))
      .join('\n')
      .replace('"<connection_name>"', '"bq_warehouse"')
      .replace('"<project_name>"', '"cross_proj_ecom"')
      .replace('"<schema_name>"', '"`ext-public-catalog`.`retail_dw`.*"')
    const tableQpSeen: Array<Record<string, unknown>> = []
    const patchedRemoteFiles: Record<string, string> = {}
    const step31Out = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: step31Code,
        allowUpdateSession: true,
        sdk: asSdk({
          authSession: {
            transport: {
              rawRequest: async (method: string, reqPath: string, queryParams?: Record<string, unknown>, rawBody?: unknown) => {
                const m = method.toUpperCase()
                const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody as Record<string, unknown> | undefined)
                if (m === 'GET' && reqPath.includes('/tables')) {
                  tableQpSeen.push(queryParams || {})
                  if (queryParams?.database === 'ext-public-catalog' && queryParams?.schema_name === 'retail_dw') {
                    return { statusCode: 200, ok: true, body: [{ tables: [{ name: 'orders' }, { name: 'customers' }, { name: 'LR_scratch' }] }] }
                  }
                  return { statusCode: 200, ok: true, body: [] }
                }
                if (m === 'GET' && reqPath.includes('/columns')) {
                  return { statusCode: 200, ok: true, body: [{ columns: [{ name: 'id', data_type: 'INT64' }, { name: 'created_at', data_type: 'TIMESTAMP' }, { name: 'email', data_type: 'STRING' }] }] }
                }
                if (m === 'GET' && (reqPath.includes('/file/content') || reqPath.includes('/files/content'))) {
                  if (String(queryParams?.file_path || reqPath).includes('customers')) {
                    return { statusCode: 404, ok: false, body: { message: 'Not Found' } }
                  }
                  return {
                    statusCode: 200,
                    ok: true,
                    body: '# AUTOGENERATED\nview: orders {\n  sql_table_name: `retail_dw.orders` ;;\n  dimension_group: ordered {\n    type: time\n    sql: ${TABLE}.order_timestamp ;;\n  }\n}\n',
                  }
                }
                if ((m === 'PATCH' || m === 'POST' || m === 'PUT') && reqPath.includes('/files')) {
                  if (body?.path && typeof body.content === 'string') patchedRemoteFiles[String(body.path)] = body.content
                  return { statusCode: 200, ok: true, body: { path: body?.path } }
                }
                return { statusCode: 200, ok: true, body: [] }
              },
            },
          },
        }),
      })
    )
    const step31Res = step31Out.result || step31Out
    expect(step31Res.schema).toBe('ext-public-catalog.retail_dw')
    expect(tableQpSeen).toEqual([
      { schema_name: 'ext-public-catalog.retail_dw' },
      { database: 'ext-public-catalog', schema_name: 'retail_dw' },
    ])
    expect(step31Res.tables).toEqual(['orders', 'customers'])
    expect(step31Res.raw_views.orders).toContain('sql_table_name: `ext-public-catalog.retail_dw.orders` ;;')
    expect(step31Res.raw_views.orders).toContain('sql: ${TABLE}.order_timestamp ;;')
    expect(patchedRemoteFiles['bronze/orders.view.lkml']).toContain('sql_table_name: `ext-public-catalog.retail_dw.orders` ;;')
    expect(step31Res.fields.orders).toBeUndefined()
    expect(step31Res.fields.customers).toEqual([['id', 'number'], ['created_at', 'time'], ['email', 'string']])

    // 3. Consolidated 1-row json_detail live SQL check in _check_dashboard_fields & LookML/UDD filter type normalization
    expect(readFileSync(path.join(repoRoot, 'skills/looker-dashboard/SKILL.md'), 'utf8')).toBe(LOOKER_DASHBOARD_SKILL_MD)
    expect(readFileSync(path.join(repoRoot, '.agents/skills/looker-dashboard/SKILL.md'), 'utf8')).toBe(LOOKER_DASHBOARD_SKILL_MD)
    expect(LOOKER_DASHBOARD_SKILL_MD).toContain('json_detail')
    expect(LOOKER_DASHBOARD_SKILL_MD).toContain('date_filter')

    let jsonDetailCalls: Array<{ model?: string; view?: string; fields?: string[]; filters?: Record<string, string>; limit?: string }> = []
    let uddFiltersCreated: Array<Record<string, unknown>> = []
    let uddQueriesCreated: Array<Record<string, unknown>> = []
    let importDashFail = false
    let sqlCheckMode: 'ok' | 'errors' | 'throw' | 'require_partition' = 'errors'
    const writtenFiles: Record<string, string> = {}
    const sqlGateSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, _qp?: unknown, rawBody?: unknown) => {
            const m = method.toUpperCase()
            const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody as Record<string, unknown> | undefined)
            if (m === 'GET' && reqPath.includes('/explores/')) {
              return {
                statusCode: 200, ok: true,
                body: { fields: { dimensions: [{ name: 'orders.created_date' }, { name: 'orders.status' }, ...Array.from({ length: 22 }, (_, i) => ({ name: `orders.dim_${i}` })), { name: 'customers.country' }], measures: [{ name: 'orders.count' }, { name: 'orders.revenue' }] } },
              }
            }
            if (m === 'POST' && reqPath.includes('/queries/run/json_detail')) {
              jsonDetailCalls.push(body as { model?: string; view?: string; fields?: string[]; filters?: Record<string, string>; limit?: string })
              if (sqlCheckMode === 'throw') return { statusCode: 422, ok: false, body: { message: 'Warehouse connection timeout on orders' } }
              if (sqlCheckMode === 'require_partition' && !body?.filters) return { statusCode: 200, ok: true, body: { errors: [{ message: 'Cannot query over table without partition filter' }] } }
              if (sqlCheckMode === 'errors') {
                return { statusCode: 200, ok: true, body: { errors: [{ message: 'The Google BigQuery Standard SQL database encountered an error while running this query.', message_details: 'Not found: Dataset billing-proj:retail_dw was not found in location US' }] } }
              }
              return { statusCode: 200, ok: true, body: { data: [{ 'orders.count': { value: 10 } }] } }
            }
            if (m === 'POST' && reqPath.includes('/dashboards/') && reqPath.includes('/import/')) {
              if (importDashFail) return { statusCode: 404, ok: false, body: { message: 'LookML dashboard not deployed yet' } }
              return { statusCode: 200, ok: true, body: { id: '777' } }
            }
            if (m === 'POST' && reqPath.includes('/dashboard_filters')) {
              if (body) uddFiltersCreated.push(body)
              return { statusCode: 200, ok: true, body: { id: String(500 + uddFiltersCreated.length) } }
            }
            if (m === 'POST' && reqPath.endsWith('/queries')) {
              if (body) uddQueriesCreated.push(body)
              return { statusCode: 200, ok: true, body: { id: String(600 + uddQueriesCreated.length) } }
            }
            if ((m === 'POST' || m === 'PATCH' || m === 'PUT') && reqPath.includes('/files')) {
              if (body?.path && typeof body.content === 'string') writtenFiles[String(body.path)] = body.content
              return { statusCode: 200, ok: true, body: { path: body?.path } }
            }
            if (m === 'POST' && reqPath.includes('/validate')) return { statusCode: 200, ok: true, body: { errors: [] } }
            return { statusCode: 200, ok: true, body: { id: '99' } }
          },
        },
      },
    })

    // 3a. SQL errors array in json_detail rejects both upsert_lookml_dashboard and upsert_udd
    const sqlErrLookml = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode(
        'return upsert_lookml_dashboard(project_id="p1", model="ecom", dashboard_name="pulse", title="Pulse", tiles=[{"title": "KPI 1", "explore": "orders", "fields": ["orders.count"]}, {"title": "KPI 2", "explore": "orders", "fields": ["orders.created_date", "orders.revenue"]}])'
      ),
      sdk: sqlGateSdk,
    })
    expect(jsonDetailCalls).toHaveLength(1)
    expect(jsonDetailCalls[0]).toEqual({
      model: 'ecom',
      view: 'orders',
      fields: ['orders.count', 'orders.created_date', 'orders.revenue'],
      limit: '1',
    })
    expect(sqlErrLookml).toContain('Live 1-row SQL check failed on ecom::orders')
    expect(sqlErrLookml).toContain('Not found: Dataset billing-proj:retail_dw was not found')

    sqlCheckMode = 'throw'
    const sqlThrowUdd = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode('return upsert_udd("Bad SQL UDD", folder_id="1", tiles=[{"title": "Orders", "fields": ["orders.count"]}])'),
      sdk: sqlGateSdk,
      vars: { target_model: 'ecom', target_explore: 'orders' },
    })
    expect(sqlThrowUdd).toContain('Live 1-row SQL check failed on ecom::orders')

    // 3b. Partition-filter retry + LookML & UDD filter normalization + dev-branch UDD fallback (forwarding model="ecom" without re-running SQL probe)
    jsonDetailCalls = []
    uddFiltersCreated = []
    uddQueriesCreated = []
    importDashFail = true
    sqlCheckMode = 'require_partition'
    const okDashOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: wrapDashboardCodeMode(
          'return upsert_lookml_dashboard(project_id="p1", model="ecom", dashboard_name="pulse", title="Pulse", folder_id="5", filters=[{"name": "order_date", "title": "Order Date", "type": "date_filter", "explore": "orders", "dimension": "orders.created_date", "default_value": "90 days"}, {"name": "window_override", "title": "Window", "type": "field_filter", "default_value": "30 days"}], tiles=[{"title": "Orders", "explore": "orders", "fields": ["orders.count"], "listen": {"order_date": "orders.created_date"}}])'
        ),
        sdk: sqlGateSdk,
      })
    )
    expect((okDashOut.result || okDashOut).lookml_dashboard_id).toBe('ecom::pulse')
    expect((okDashOut.result || okDashOut).dashboard_id).toBe('99')
    expect(jsonDetailCalls).toHaveLength(1)
    expect(jsonDetailCalls[0]?.filters).toEqual({ 'orders.created_date': '90 days' })
    expect(uddFiltersCreated).toEqual([
      expect.objectContaining({ name: 'order_date', type: 'field_filter', model: 'ecom', explore: 'orders', dimension: 'orders.created_date', allow_multiple_values: true }),
      expect.objectContaining({ name: 'window_override', type: 'date_filter', default_value: '30 days' }),
    ])
    expect(uddFiltersCreated[1]).not.toHaveProperty('model')
    expect(uddQueriesCreated[0]).toMatchObject({ model: 'ecom', view: 'orders', fields: ['orders.count'] })
    const generatedYaml = writtenFiles['dashboards/pulse.dashboard.lookml'] || ''
    expect(generatedYaml).toContain(
      ['  - name: order_date', '    title: "Order Date"', '    type: field_filter', '    model: ecom', '    explore: orders', '    field: orders.created_date', '    default_value: "90 days"', '    allow_multiple_values: true'].join('\n')
    )
    expect(generatedYaml).toContain(
      ['  - name: window_override', '    title: "Window"', '    type: date_filter', '    default_value: "30 days"', '  elements:'].join('\n')
    )

    // 3c. yaml_content bypasses _check_dashboard_fields (0 extra json_detail calls)
    jsonDetailCalls = []
    importDashFail = false
    const rawYamlOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: wrapDashboardCodeMode('return upsert_lookml_dashboard(project_id="p1", model="ecom", dashboard_name="raw_dash", yaml_content="- dashboard: raw_dash\\n  title: \\"Raw\\"\\n  layout: newspaper\\n  elements: []\\n")'),
        sdk: sqlGateSdk,
      })
    )
    expect((rawYamlOut.result || rawYamlOut).lookml_dashboard_id).toBe('ecom::raw_dash')
    expect(jsonDetailCalls).toHaveLength(0)

    // 3d. > 20-field dashboard caps json_detail probe at 20 fields while preserving distinct joined view prefixes (orders.* + customers.country)
    jsonDetailCalls = []
    sqlCheckMode = 'ok'
    const wideFields = [...Array.from({ length: 22 }, (_, i) => `orders.dim_${i}`), 'customers.country', 'orders.count']
    await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode(`return upsert_udd("Wide UDD", folder_id="1", tiles=[{"title": "Wide Grid", "fields": ${JSON.stringify(wideFields)}}])`),
      sdk: sqlGateSdk,
      vars: { target_model: 'ecom', target_explore: 'orders' },
    })
    expect(jsonDetailCalls).toHaveLength(1)
    expect(jsonDetailCalls[0]?.fields).toHaveLength(20)
    expect(jsonDetailCalls[0]?.fields).toEqual(expect.arrayContaining(['orders.dim_0', 'customers.country']))
  })

  test('74. Issue #179: enforces layered dual-date Promise.all comparison queries, omits .query on comparison <app-chart>, shares scale via linkedTo: 0 when close, and rejects Compare against dropdowns in BUNDLE_APP_PY & Turn 6 grader', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const rawMatch = readFileSync(path.join(repoRoot, 'src/antigravityPrompts.ts'), 'utf8').match(/export const BUNDLE_APP_PY = `([\s\S]*?)`\n/)
    expect(rawMatch?.[1]).toBe(BUNDLE_APP_PY)
    expect(BUNDLE_APP_PY).not.toContain('\\')
    expect(BUNDLE_APP_PY).not.toContain('${')

    const recipeDisk = readFileSync(path.join(repoRoot, 'skills/data-apps/recipes/metric-switcher.md'), 'utf8')
    expect(recipeDisk).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    expect(DATA_APP_GUIDE_MD).toContain('formatAxisValue, escapeHtml')
    for (const tok of ['loadTrendData', 'Promise.all', 'this.runQuery', 'shareScale', 'linkedTo: 0', 'opposite: true', '--app-chart-1', '--app-chart-2']) {
      expect(recipeDisk).toContain(tok)
    }

    const workDir = mkdtempSync(path.join(tmpdir(), 'dab-179-test-'))
    try {
      const bundlePyPath = path.join(workDir, 'bundle_app.py')
      writeFileSync(bundlePyPath, BUNDLE_APP_PY.replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`), 'utf8')
      const env = { ...process.env }

      // (a1) Reject <app-select label="Compare against"> (including arrow-fn with '>' BEFORE expression-bound label)
      for (const badSelect of [
        '<app-select label="Compare against" .value=${this.x} .options=${[]} @change=${(e) => { if (e.detail.value.length > 0) this.x = e.detail.value; }}></app-select>',
        "<app-select @change=${(e) => { if (e.detail.value.length > 0) this.x = e.detail.value; }} aria-label=${'Compare against'} .options=${[]}></app-select>",
      ]) {
        const src = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadDrop extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; } render() { return html\`${badSelect}<app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-drop', BadDrop);`
        expect(() => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Drop', path.join(workDir, 'bad_drop.js')], { input: src, env, encoding: 'utf8', stdio: 'pipe' })).toThrow(/forbidden-compare-against-dropdown/)
      }

      // (a2) Reject single-query compareMetric (including nested METRICS[...] or conditional spread), missing linkedTo, missing opposite, .data + .query on same <app-chart>, dateBase !== / != branching, or multi-if updated() loop
      for (const badCompareBody of [
        // 1a. Single-query compareMetric via conditional spread (with nested METRICS[...] and sibling <app-chart .data=...>, plus loadGrid Promise.all)
        `async loadGrid() { await Promise.all([this.runQuery({ fields: ['orders.count'] }), this.runQuery({ fields: ['orders.count'] })]); } render() { const METRICS = { r: { measure: 'orders.return_count' } }; const m2 = METRICS[this.compareMetric]; return html\`<app-chart type="bar" .data=\${[]}></app-chart><app-chart type="line" .query=\${{ fields: ['orders.returned_date', METRICS['r'].measure, ...(m2 ? [m2.measure] : [])] }} .options=\${{ yAxis: [{}, { linkedTo: 0, opposite: true }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
        // 1b. Direct compareMetric inside .query fields: [...] even when loadTrendData Promise.all and sibling .data exist
        `async loadTrendData() { await Promise.all([this.runQuery({ fields: ['orders.created_date', this.selectedMetric] }), this.runQuery({ fields: ['orders.returned_date', this.compareMetric] })]); } render() { const METRICS = { r: { measure: 'orders.return_count' } }; return html\`<app-chart type="bar" .data=\${[]}></app-chart><app-chart type="line" .query=\${{ fields: ['orders.returned_date', METRICS[this.compareMetric].measure] }} .options=\${{ yAxis: [{}, { linkedTo: 0, opposite: true }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
        // 2. Dual runQuery present, but missing linkedTo (even if "linkedTo" appears inside a string literal)
        `async loadTrendData() { await Promise.all([this.runQuery({ fields: ['orders.created_date', this.selectedMetric] }), this.runQuery({ fields: ['orders.returned_date', this.compareMetric] })]); } render() { const note = 'linkedTo'; return html\`<app-chart type="line" title=\${note} .data=\${this.trendRows} .options=\${{ yAxis: [{}, { opposite: true }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
        // 3. Dual runQuery + linkedTo present, but opposite: false (missing opposite: true)
        `async loadTrendData() { await Promise.all([this.runQuery({ fields: ['orders.created_date', this.selectedMetric] }), this.runQuery({ fields: ['orders.returned_date', this.compareMetric] })]); } render() { return html\`<app-chart type="line" .data=\${this.trendRows} .options=\${{ yAxis: [{}, { linkedTo: 0, opposite: false }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
        // 4. Dual runQuery + linkedTo + opposite present, but .query kept alongside .data on same <app-chart>
        `async loadTrendData() { await Promise.all([this.runQuery({ fields: ['orders.created_date', this.selectedMetric] }), this.runQuery({ fields: ['orders.returned_date', this.compareMetric] })]); } render() { return html\`<app-chart type="line" .data=\${this.trendRows} .query=\${{ fields: ['orders.created_date', this.selectedMetric] }} .options=\${{ yAxis: [{}, { linkedTo: 0, opposite: true }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
        // 5. Conditional m1.dateBase != m2.dateBase single-query fallback
        `async loadTrendData() { const m1 = { dateBase: 'a' }, m2 = { dateBase: 'b' }; if (m1.dateBase != m2.dateBase) { await Promise.all([this.runQuery({ fields: ['orders.created_date', this.selectedMetric] }), this.runQuery({ fields: ['orders.returned_date', this.compareMetric] })]); } } render() { return html\`<app-chart type="line" .data=\${this.trendRows} .options=\${{ yAxis: [{}, { linkedTo: 0, opposite: true }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
        // 6. Forbidden updated(changed) loop invoking loadTrendData() after an earlier nested if-block
        `updated(changed) { super.updated(changed); if (changed.has('chartType')) { this.chartMenuOpen = false; } if (changed.has('period')) { this.loadTrendData(); } } async loadTrendData() { await Promise.all([this.runQuery({ fields: ['orders.created_date', this.selectedMetric] }), this.runQuery({ fields: ['orders.returned_date', this.compareMetric] })]); } render() { return html\`<app-chart type="line" .data=\${this.trendRows} .options=\${{ yAxis: [{}, { linkedTo: 0, opposite: true }] }}></app-chart><app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }`,
      ]) {
        const src = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadCompare extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.selectedMetric = 'orders.count'; this.compareMetric = 'orders.return_count'; this.trendRows = null; } ${badCompareBody} }\ncustomElements.define('bad-compare', BadCompare);`
        expect(() => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad Compare', path.join(workDir, 'bad_cmp.js')], { input: src, env, encoding: 'utf8', stdio: 'pipe' })).toThrow(/invalid-metric-comparison-query-or-axis/)
      }

      // (b) Accept compliant dual-Promise.all([this.runQuery(...), this.runQuery(...)]) + DRY .map(m => this.runQuery(...)) + sibling ...this.selectedDimensions <app-chart> + shareScale ? 0 : 1 + linkedTo: 0 Metric Selector app
      const compliantSrc = `import { DataApp, html, formatValue, formatAxisValue, escapeHtml } from '/runtime/data-app.js';
const METRICS = {
  orders: { label: 'Orders', measure: 'orders.count', dateBase: 'orders.created', format: 'int', polarity: 'higher-better' },
  returns: { label: 'Returns', measure: 'orders.return_count', dateBase: 'orders.returned', format: 'int', polarity: 'lower-better' },
  cancels: { label: 'Cancellations', measure: 'orders.cancel_count', dateBase: 'orders.cancelled', format: 'int', polarity: 'lower-better' },
};
const PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 };
const WINDOW_OPTIONS = { date: [14, 30, 60, 90, 180], week: [12, 26, 53, 104], month: [6, 12, 24, 60], year: [3, 5, 10] };
const UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' };
export class GoodCompareApp extends DataApp {
  static properties = { period: { type: String }, periodCount: { type: Number }, selectedMetric: { type: String }, compareMetric: { type: String }, chartType: { type: String }, chartMenuOpen: { type: Boolean }, customWindowOpen: { type: Boolean }, customWindowDraft: { type: String }, selectedDimensions: { type: Array }, trendRows: { type: Array }, trendError: { type: String }, gridRows: { type: Array } };
  constructor() {
    super();
    this.lookerModel = 'ecom';
    this.explore = 'orders';
    this.period = 'date';
    this.periodCount = PERIOD_DEFAULTS.date;
    this.selectedMetric = 'returns';
    this.compareMetric = 'cancels';
    this.chartType = 'areaspline';
    this.chartMenuOpen = false;
    this.customWindowOpen = false;
    this.selectedDimensions = ['orders.status'];
    this.trendRows = null;
    this.trendError = null;
    this.gridRows = [];
  }
  connectedCallback() { super.connectedCallback(); this.loadTrendData(); }
  willUpdate(changed) { super.willUpdate(changed); if (this.hasUpdated && (changed.has('dashboardFilters') || changed.has('crossFilters'))) this.onFiltersChanged(); }
  onFiltersChanged() { this.loadTrendData(); }
  onRefresh() { this.loadTrendData(); }
  async loadTrendData() {
    const seq = (this._trendSeq = (this._trendSeq || 0) + 1);
    if (!this.compareMetric) { this.trendRows = null; this.trendError = null; return; }
    this.trendError = null;
    const m1 = METRICS[this.selectedMetric], m2 = METRICS[this.compareMetric];
    const isNonCreated = m1.dateBase !== 'orders.created';
    const d1 = \`\${m1.dateBase}_\${this.period}\`, d2 = \`\${m2.dateBase}_\${this.period}\`;
    const win = \`\${this.periodCount} \${UNITS[this.period]}\`;
    const limit = String(Math.min(5000, Math.max(500, 2 * this.periodCount + (isNonCreated ? 10 : 10))));
    try {
      const [r1, r2] = await Promise.all([
        this.runQuery({ explore: this.explore, fields: [d1, m1.measure], filters: this.getEffectiveFilters({ [d1]: win }), sorts: [\`\${d1} asc\`], limit }),
        this.runQuery({ explore: this.explore, fields: [d2, m2.measure], filters: this.getEffectiveFilters({ [d2]: win }), sorts: [\`\${d2} asc\`], limit }),
      ]);
      if (seq !== this._trendSeq) return;
      const map1 = new Map((r1 || []).map((r) => [String(r[d1] ?? ''), Number(r[m1.measure] ?? 0)]));
      const map2 = new Map((r2 || []).map((r) => [String(r[d2] ?? ''), Number(r[m2.measure] ?? 0)]));
      const periods = [...new Set([...map1.keys(), ...map2.keys()])].filter(Boolean).sort();
      this.trendRows = periods.map((p) => ({ period: p, [m1.measure]: Number(map1.get(p) ?? 0), [m2.measure]: Number(map2.get(p) ?? 0) }));
    } catch (err) {
      if (seq === this._trendSeq) this.trendError = err?.message || String(err);
    }
  }
  render() {
    const m1 = METRICS[this.selectedMetric], m2 = this.compareMetric ? METRICS[this.compareMetric] : null;
    const d1 = \`\${m1.dateBase}_\${this.period}\`;
    const limit = String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)));
    const rows = this.trendRows || [];
    const max1 = Math.max(0, ...rows.map((r) => Number(r[m1.measure] ?? 0)));
    const max2 = m2 ? Math.max(0, ...rows.map((r) => Number(r[m2.measure] ?? 0))) : 0;
    const shareScale = Boolean(m2 && m1.format === m2.format && max1 > 0 && max2 > 0 && (Math.max(max1, max2) / Math.min(max1, max2) <= 3));
    const priorFilter = \`\${2 * this.periodCount} \${UNITS[this.period]} ago for \${this.periodCount} \${UNITS[this.period]}\`;
    return html\`
      <style>
        .da-container { --app-chart-2: #34a853; container-type: inline-size; }
        .da-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        @container (max-width: 820px) { .da-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @container (max-width: 420px) { .da-kpi-grid { grid-template-columns: 1fr; } }
      </style>
      <!-- removed <app-select label="Compare against"> -->
      <div class="da-container" data-prior=\${priorFilter}>
        <div class="da-filter-bar">
          <span>Period:</span>
          <span>Window: \${!WINDOW_OPTIONS[this.period].includes(this.periodCount) ? html\`<button>\${this.periodCount}</button>\` : ''}</span>
          <button title="Custom window length" @click=\${() => { this.customWindowOpen = !this.customWindowOpen; }}><svg viewBox="0 0 16 16"></svg></button>
          \${this.customWindowOpen ? html\`<input type="number" min="1" max="1000" .value=\${this.customWindowDraft ?? String(this.periodCount)}>\` : ''}
          <span>Dimensions: \${this.selectedDimensions.join(',')}</span>
        </div>
        <div class="da-kpi-grid">
          <div style="border: 2px solid var(--app-chart-1, #4285f4)" @click=\${(e) => { if (e.shiftKey) { this.compareMetric = 'cancels'; this.loadTrendData(); } }} @contextmenu=\${(e) => { e.preventDefault(); this.compareMetric = ''; this.loadTrendData(); }}>
            <div>RETURNS</div><div>120</div><div><span class="kpi-change down">+3%</span><span>vs. prev 90 days</span></div><svg></svg>
          </div>
        </div>
        <div><button @click=\${() => { this.chartMenuOpen = !this.chartMenuOpen; }}>⋮</button>\${['areaspline', 'line', 'column', 'bar'].join(',')}</div>
        \${m2
          ? html\`<app-chart bare type=\${this.chartType} value-format=\${m1.format} .data=\${this.trendRows} .error=\${this.trendError} .options=\${{ colors: ['var(--app-chart-1, #4285f4)', 'var(--app-chart-2, #34a853)'], yAxis: [{ title: { text: m1.label }, labels: { formatter() { return formatAxisValue(this.value, m1.format); } } }, { ...(shareScale ? { linkedTo: 0 } : {}), opposite: true, title: { text: m2.label }, labels: { formatter() { return formatAxisValue(this.value, m2.format); } }, gridLineWidth: 0 }], series: [{ name: m1.label, yAxis: 0 }, { name: m2.label, yAxis: shareScale ? 0 : 1 }], ...(m1.format !== m2.format ? { tooltip: { shared: true, useHTML: true, formatter() { return escapeHtml(String(formatValue(this.y, m1.format))); } } } : {}) }}></app-chart>\`
          : html\`<app-chart bare type=\${this.chartType} .query=\${{ fields: [d1, m1.measure], filters: { ...(this.dashboardFilters || {}) }, sorts: [\`\${d1} asc\`], limit }} .options=\${{ yAxis: { title: { text: m1.label } }, ...(this.chartType === 'bar' ? { xAxis: { reversed: true } } : {}) }}></app-chart>\`}
        <app-chart type="bar" title=\${this.compareMetric ? 'Breakdown' : 'Single'} .query=\${{ /* no compareMetric */ fields: [...this.selectedDimensions, m1.measure], limit }}></app-chart>
        <app-grid .data=\${this.gridRows} .columnDefs=\${[{ field: 'dim', headerName: 'Status' }, { field: 'curr', headerName: 'Returns — This Period' }, { field: 'prev', headerName: 'Returns — Last Period' }, { field: 'var', headerName: 'Returns — Variance' }]}></app-grid>
      </div>\`;
  }
}
customElements.define('good-compare-app', GoodCompareApp);`
      const out = execFileSync('python3', [bundlePyPath, '--stdin', 'Good Compare', path.join(workDir, 'good_cmp.js')], { input: compliantSrc, env, encoding: 'utf8' })
      const bundle = JSON.parse((out.match(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/) || [])[1] || '{}') as { warnings?: string[] }
      expect((bundle.warnings || []).filter((w) => !w.includes('registered without limit') && !w.includes('read app state'))).toEqual([])
      const dryMapSrc = compliantSrc.replace(/const \[r1, r2\] = await Promise\.all\(\[[\s\S]*?\n {6}\]\);/, 'const [r1, r2] = await Promise.all([[d1, m1], [d2, m2]].map(([d, m]) => this.runQuery({ explore: this.explore, fields: [d, m.measure], filters: this.getEffectiveFilters({ [d]: win }), sorts: [`${d} asc`], limit })));')
      expect(execFileSync('python3', [bundlePyPath, '--stdin', 'Good DRY Compare', path.join(workDir, 'good_dry_cmp.js')], { input: dryMapSrc, env, encoding: 'utf8' })).toContain('<DATA_APP_BUNDLE>')

      // Verify Turn 6 grader in scripts/eval-new-project.mjs accepts compliant apps (including DRY .map, filters/options spreads, and literal dateBase !== 'orders.created') and rejects all 9 broken variants
      const fnBodyMatch = readFileSync(path.join(repoRoot, 'scripts/eval-new-project.mjs'), 'utf8').match(/const cleanCode =[\s\S]*?const hasTitlelessPopVarianceGrid =[^\n]+/)
      expect(fnBodyMatch).toBeTruthy()
      const gradeTurn6 = new Function('code', `${fnBodyMatch?.[0]}\nreturn { hasCardBorderCompareDualAxis, hasPopClickableKpis, hasTrendMenuAndYAxis, hasTitlelessPopVarianceGrid };`) as (c: string) => Record<string, boolean>
      expect(gradeTurn6(`${compliantSrc}\n// lower-better getEffectiveFilters`)).toEqual({
        hasCardBorderCompareDualAxis: true,
        hasPopClickableKpis: true,
        hasTrendMenuAndYAxis: true,
        hasTitlelessPopVarianceGrid: true,
      })
      expect(gradeTurn6(`${dryMapSrc}\n// lower-better`).hasCardBorderCompareDualAxis).toBe(true)
      for (const badTurn6 of [
        `${compliantSrc}\n<app-select label="Compare against"></app-select>`,
        `${compliantSrc}\n<app-select @change=\${(e) => { if (e.detail.value.length > 0) this.x = e.detail.value; }} aria-label=\${'Compare against'} .options=\${[]}></app-select>`,
        compliantSrc.replace('.data=${this.trendRows}', '.query=${{ fields: [d1, m1.measure, METRICS[this.compareMetric].measure], limit }}'),
        compliantSrc.replace('.data=${this.trendRows}', '.query=${{ fields: [d1, m1.measure, ...(m2 ? [m2.measure] : [])], limit }}'),
        compliantSrc.replace(/linkedTo/g, 'unlinkedAxis'),
        compliantSrc.replace(/opposite:\s*true/g, 'opposite: false'),
        compliantSrc.replace(/Promise\.all/g, 'Array.of'),
        compliantSrc.replace('.data=${this.trendRows}', '.data=${this.trendRows} .query=${{ fields: [d1] }}'),
        `${compliantSrc}\nif (m1.dateBase != m2.dateBase) {}`,
        `${compliantSrc}\nupdated(changed) { if (changed.has('chartType')) { this.chartMenuOpen = false; } if (changed.has('period')) { this.loadTrendData(); } }`,
      ]) expect(gradeTurn6(badTurn6).hasCardBorderCompareDualAxis).toBe(false)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('deriveConversationOverviewData aggregates Review, Content, Changed Files, API Calls, Skills Used, Data Context, Links, and Uploads', () => {
    expect(STUDIO_OVERVIEW_TAB_KEY).toBe('__overview__')

    const overview = deriveConversationOverviewData({
      hostUrl: 'https://demo.looker.com',
      pendingPerm: {
        req: { operation: 'create_dashboard', httpMethod: 'POST', path: '/dashboards' },
      },
      lookmlBundle: {
        id: 'ecom_medallion',
        title: 'Medallion Layer',
        project_id: 'ecom_medallion',
        validation: { passed: false, error_count: 2, errors: [{ message: 'Unknown field' }, { message: 'Join missing' }] },
        tests: [{ test_name: 'pk_unique', success: true }, { test_name: 'margin_positive', success: false }],
        queries: [{ query_index: 0, label: 'Revenue Parity', sql_slug: 'sql_1', explore_slug: 'exp_1' }],
        files: [
          { path: 'bronze/orders.view.lkml', action: 'created', diff: '+view: orders {}' },
          { path: 'silver/orders.refinement.lkml', action: 'updated', diff: '+measure: net {}' },
        ],
      },
      contentItems: [
        { key: 'dashboard:42', id: '42', contentType: 'dashboard', title: 'Exec KPIs', embedPath: '/embed/dashboards/42', hidden: false },
        { key: 'look:19', id: '19', contentType: 'look', title: 'Margin Look', embedPath: '/embed/looks/19', hidden: true },
      ],
      activatedLookmlSkills: ['agentic-lookml'],
      selectedExplores: ['thelook::order_items'],
      mentionedItems: [{ type: 'dashboard', id: '14', title: 'Q3 Baseline' }],
      selectedFolderId: '1',
      selectedFolderLabel: 'My folder',
      pastedImages: [{ name: 'wireframe.png', mimeType: 'image/png' }],
      windowApiCalls: [
        { method: 'GET', route: '/api/4.0/artifacts/data_app_builder::data_app_builder/user_1', duration_ms: 12, response: { ok: true, status: 200, body: [] } },
        { method: 'GET', route: '/api/4.0/lookml_models/thelook/explores/order_items?fields=name', duration_ms: 41.6, response: { ok: true, status: 200, body: {} } },
        { method: 'POST', route: '/queries/run/json', duration_ms: 310, response: { ok: false, status: 422, body: { message: 'Bad field' } } },
      ],
      messages: [
        {
          role: 'user',
          text: '/looker-dashboard Build KPIs and validate LookML',
          images: ['data:image/png;base64,AAA'],
        },
        {
          role: 'assistant',
          text: 'Created [Exec KPIs](/dashboards/42), ignored [XSS](javascript:alert(1)), and saved `/workspace/content_inventory.md`.\n```sql\n-- https://internal-code-comment.example.com/skip\n```\nReference: https://cloud.google.com/looker/docs.',
          activitySteps: [
            { id: 's1', kind: 'skill', title: 'Reading skill looker-field-profiler', path: '/workspace/skills/looker-field-profiler/SKILL.md', status: 'done' },
            { id: 's2', kind: 'file', title: 'Writing /workspace/AGENTS.md', path: '/workspace/AGENTS.md', status: 'done' },
            { id: 's2b', kind: 'file', title: 'Viewing /workspace/readonly_note.md', path: '/workspace/readonly_note.md', status: 'done' },
            { id: 's2c', kind: 'file', title: 'Writing /workspace/../etc/passwd', path: '/workspace/../etc/passwd', status: 'done' },
            { id: 's3', kind: 'file', title: 'Writing /workspace/kda_report.md', path: '/workspace/kda_report.md', status: 'done' },
            {
              id: 's4',
              kind: 'codemode',
              title: 'Run inline query',
              content: [
                '# GET /api/4.0/lookml_models/thelook/explores/order_items (42ms)',
                '# POST /api/4.0/artifacts/ns (9ms)',
                '# POST /api/4.0/dashboards (95ms)',
                '# POST /api/4.0/queries/run/sql [ERR 500] (120ms)',
              ].join('\n'),
              status: 'done',
            },
          ],
        },
      ],
    })

    // Review prioritizes pending permission, then LookML validation failure
    expect(overview.primaryReview).toEqual(
      expect.objectContaining({ kind: 'permission', badgeText: '1 pending', badgeTone: 'warning' })
    )
    expect(overview.reviewItems[1]).toEqual(
      expect.objectContaining({ kind: 'lookml', badgeText: '2 errors', badgeTone: 'danger' })
    )

    // Health Check reports omit diagnostic grades in Review; Data App fallback surfaces apps/current/app.js under kind: 'files'
    const healthOnly = deriveConversationOverviewData({
      messages: [{ role: 'user', text: 'Audit instance' }, { role: 'assistant', text: 'Done.' }],
      healthReport: {
        id: 'hc_1',
        title: '3-Pillar Audit',
        tddMarkdown: '# TDD',
        scores: { overallScore: 72, grade: 'B- (Optimization Recommended)', transcriberScore: 3.1 },
      } as unknown as Parameters<typeof deriveConversationOverviewData>[0]['healthReport'],
    })
    expect(healthOnly.primaryReview).toBeNull()
    expect(healthOnly.contentRows[0]?.shortTag).toBe('Health Check')

    const appFallback = deriveConversationOverviewData({
      messages: [{ role: 'user', text: 'Build app' }, { role: 'assistant', text: 'Built app.' }],
      publishedApp: { dashboardId: '88', title: 'Revenue Data App', folderId: '1', extensionId: 'ext', elementId: '1', code: 'export default {}' },
      currentAppCode: 'export default class App {}',
    })
    expect(appFallback.contentRows[0]).toEqual(expect.objectContaining({ key: 'data_app:88', shortTag: 'Data App' }))
    expect(appFallback.primaryReview).toEqual(expect.objectContaining({ kind: 'files', subtitle: 'apps/current/app.js', badgeText: '1 file' }))

    // Content preserves both visible and hidden items
    expect(overview.contentRows.map((r) => ({ key: r.key, shortTag: r.shortTag, hidden: r.hidden }))).toEqual([
      { key: 'dashboard:42', shortTag: 'UDD', hidden: false },
      { key: 'look:19', shortTag: 'Look', hidden: true },
    ])

    // Changed Files excludes internal /workspace/AGENTS.md, read-only Viewing steps, and '..' traversal
    expect(overview.changedFiles.map((f) => f.label)).toEqual([
      'bronze/orders.view.lkml',
      'silver/orders.refinement.lkml',
      'kda_report.md',
      'content_inventory.md',
    ])

    // API Calls strips /artifacts persistence, preserves 422 failure, deduplicates overlapping step logs, and parses [ERR 500]
    expect(overview.apiCalls).toEqual([
      expect.objectContaining({ method: 'GET', route: '/lookml_models/thelook/explores/order_items', status: 200, ok: true, durationMs: 42, source: 'window' }),
      expect.objectContaining({ method: 'POST', route: '/queries/run/json', status: 422, ok: false, durationMs: 310, source: 'window' }),
      expect.objectContaining({ method: 'POST', route: '/dashboards', status: null, ok: true, durationMs: 95, source: 'turn' }),
      expect.objectContaining({ method: 'POST', route: '/queries/run/sql', status: 500, ok: false, durationMs: 120, source: 'turn' }),
    ])

    // Skills Used merges activated LookML skills, /slash commands, and skill steps without duplicates
    expect(overview.skillsUsed.map((s) => s.id)).toEqual([
      'agentic-lookml',
      'looker-dashboard',
      'looker-field-profiler',
    ])

    // Links extracts assistant markdown links, bare URLs, LookML SQL/Explore parity slugs, and /dashboards/ + /looks/ contentRows while skipping javascript: and fenced code URLs
    expect(overview.links.map((l) => l.href)).toEqual([
      '/dashboards/42',
      'https://cloud.google.com/looker/docs',
      '/sql/sql_1',
      '/x/exp_1',
      '/looks/19',
    ])
    expect(overview.links[0].inViewerTarget?.contentType).toBe('dashboard')

    // Data Context & Uploads
    expect(overview.context.explores).toEqual(['thelook::order_items'])
    expect(overview.context.mentions).toHaveLength(1)
    expect(overview.context.folderLabel).toBe('My folder')
    expect(overview.context.uploads.map((u) => u.label)).toEqual(['Screenshot #1', 'wireframe.png'])
  })

}
