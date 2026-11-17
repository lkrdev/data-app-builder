import {
  AGENTS_MD,
  extractInteractionActivitySteps,
  extractNativeContentFromInteraction,
  formatFriendlyLookerActivityLabel,
} from '../../antigravity'
import { buildApiTemplate, buildDescribeBody, LkrCodeMode } from '../../lkrCliBridge'

export function registerPermissionsPart22Tests(): void {
  test('84. Issue #214: LkrCodeMode describe_body & api_template resolve SDK methods/endpoints/models, redact secrets, omit read-only fields, and guard cycles', async () => {
    // 1. Cyclic schema + explicit [read-only] + secret redaction unit check
    const cyclicRuntime = {
      lookup: (name: string) =>
        name === 'create_folder_node'
          ? 'Function: create_folder_node\nInputs:\n- body*: FolderNode\n\nOutputs:\nReturn Type: FolderNode'
          : '',
      lookupType: (typeName: string) =>
        typeName === 'FolderNode'
          ? [
              'Type: FolderNode',
              '  - id: string [read-only]',
              '      # Unique Id',
              '  - name*: string',
              '      # Folder name',
              '  - api_token: string',
              '      # Secret token',
              '  - child_folders: Array of FolderNode',
              '      # Nested child folders',
            ].join('\n')
          : '',
    }
    const cyclicDesc = buildDescribeBody(cyclicRuntime, 'create_folder_node')
    expect(cyclicDesc.method).toBe('create_folder_node')
    expect(cyclicDesc.type).toBe('FolderNode')
    expect(cyclicDesc.fields.find((f) => f.name === 'id')?.read_only).toBe(true)
    expect(cyclicDesc.fields.find((f) => f.name === 'name')?.required).toBe(true)
    expect(cyclicDesc.fields.find((f) => f.name === 'child_folders')?.cycle).toBe(true)
    expect(buildApiTemplate(cyclicRuntime, 'FolderNode')).toEqual({
      name: '',
      api_token: '<CONFIGURE_IN_LOOKER_ADMIN_UI>',
      child_folders: [],
    })

    // 2. Real Monty WASM execution for SDK method, "<group> <endpoint>", model alias, and regular folder() calls
    const transportCalls: string[] = []
    const wasmOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: [
          'by_fn = api_template("create_connection")',
          'by_ep = describe_body("connections create")',
          'by_model = api_template("WriteConnection")',
          'sched = api_template("WriteScheduledPlan")',
          'real_folder = folder("42")',
          'return {"by_fn": by_fn, "by_ep": by_ep, "by_model": by_model, "sched": sched, "real_folder": real_folder}',
        ].join('\n'),
        requestHandler: async (method, urlPath) => {
          transportCalls.push(`${method} ${urlPath}`)
          return { id: '42', name: 'Personal' }
        },
      })
    )
    expect(transportCalls).toEqual(['GET /folders/42'])
    expect(wasmOut.real_folder).toEqual({ id: '42', name: 'Personal' })
    expect(wasmOut.by_ep.type).toBe('WriteDBConnection')
    expect(wasmOut.by_ep.method).toBe('create_connection')
    expect(wasmOut.by_fn).toEqual(wasmOut.by_model)
    for (const [k, v] of Object.entries(wasmOut.by_fn as Record<string, unknown>)) {
      if (/password|secret|certificate|private_key|token/i.test(k)) {
        expect(v).toBe('<CONFIGURE_IN_LOOKER_ADMIN_UI>')
      }
    }
    expect(wasmOut.sched.scheduled_plan_destination[0].secret_parameters).toBe('<CONFIGURE_IN_LOOKER_ADMIN_UI>')
    expect('id' in wasmOut.sched.scheduled_plan_destination[0]).toBe(false)

    // 3. Regex gating: local def is respected and unused helpers are not injected
    const localOverrideOut = await LkrCodeMode.runPythonCode({
      code: 'def api_template(x):\n    return {"custom": x}\nreturn api_template("test")',
    })
    expect(JSON.parse(localOverrideOut)).toEqual({ custom: 'test' })
  })

  test('85. Issue #214: Henry system__activity helpers (health_pulse, health_analyze, health_vacuum) enforce zero-mock truncation, explore caps, 403/404 envelopes, and PermissionError propagation', async () => {
    // 1. 200 OK path + verify health_analyze makes 0 lookml_model_explore calls
    const analyzeCalls: string[] = []
    const okOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: 'return {"pulse": health_pulse(7), "analyze": health_analyze(project="ecom_proj", timeframe_days=90)}',
        requestHandler: async (method, urlPath, _qp, body) => {
          analyzeCalls.push(`${method} ${urlPath}`)
          const b = (body || {}) as Record<string, unknown>
          if (String(urlPath).includes('/queries/run/')) {
            if (b.view === 'history' && Array.isArray(b.fields) && b.fields.includes('history.status')) {
              return [
                { 'history.status': 'complete', 'history.result_source': 'cache', 'history.query_run_count': 80 },
                { 'history.status': 'error', 'history.result_source': 'query', 'history.query_run_count': 20 },
              ]
            }
            if (b.view === 'history' && Array.isArray(b.fields) && b.fields.includes('query.model')) {
              return [{ 'query.model': 'thelook', 'query.view': 'orders', 'history.query_run_count': 100 }]
            }
            return []
          }
          if (urlPath === '/lookml_models') {
            return [
              {
                name: 'thelook',
                project_name: 'ecom_proj',
                explores: [{ name: 'orders', hidden: false }, { name: 'abandoned_explore', hidden: false }],
              },
            ]
          }
          return {}
        },
      })
    )
    expect(analyzeCalls.some((c) => c.includes('/explores/'))).toBe(false)
    expect(okOut.pulse).toMatchObject({
      status: 'ok',
      vacuum_safe: true,
      query_volume: 100,
      error_rate: 0.2,
      cache_hit_ratio: 0.8,
    })
    expect(okOut.analyze).toMatchObject({
      status: 'ok',
      vacuum_safe: true,
      unused_models: [],
      unused_explores: [{ model: 'thelook', explore: 'abandoned_explore', project_name: 'ecom_proj' }],
    })

    // 2. health_vacuum: 200 OK (join-chain dependency protection + project scoping) vs capped short-circuit vs 5000-row truncation vs model/explore errors vs 403 Forbidden
    let mode: 'ok' | 'truncated' | 'forbidden' | 'models_fail' | 'explore_fail' = 'ok'
    const vacCalls: Array<{ path: string; body?: unknown }> = []
    const runVac = async (code: string) =>
      JSON.parse(
        await LkrCodeMode.runPythonCode({
          code,
          requestHandler: async (_m, urlPath, _qp, body) => {
            vacCalls.push({ path: String(urlPath), body })
            if (mode === 'models_fail' && urlPath === '/lookml_models') {
              return { ok: false, statusCode: 500, body: '500 LookML model service unavailable' }
            }
            if (mode === 'forbidden' && String(urlPath).includes('/queries/run/')) {
              return { ok: false, statusCode: 403, body: '403 Forbidden: see_system_activity required' }
            }
            const b = (body || {}) as Record<string, unknown>
            if (String(urlPath).includes('/queries/run/')) {
              if (b.view === 'field_usage') {
                if (mode === 'truncated') {
                  return Array.from({ length: 5000 }, (_, idx) => ({
                    'field_usage.model': 'thelook',
                    'field_usage.explore': 'order_items',
                    'field_usage.view': 'users',
                    'field_usage.field': `users.f_${idx}`,
                    'field_usage.times_used': 0,
                  }))
                }
                return [
                  { 'field_usage.model': 'thelook', 'field_usage.explore': 'order_items', 'field_usage.view': 'orders', 'field_usage.field': 'orders.unused_note', 'field_usage.times_used': 0 },
                  { 'field_usage.model': 'thelook', 'field_usage.explore': 'order_items', 'field_usage.view': 'unused_leaf', 'field_usage.field': 'unused_leaf.code', 'field_usage.times_used': 0 },
                ]
              }
              return [{ 'query.model': 'thelook', 'query.view': 'order_items', 'history.query_run_count': 25 }]
            }
            if (urlPath === '/lookml_models') {
              return [
                { name: 'thelook', project_name: 'ecom_proj', explores: [{ name: 'order_items', hidden: false }, { name: 'inventory', hidden: false }] },
                { name: 'other_model', project_name: 'other_proj', explores: [{ name: 'other_exp', hidden: false }] },
              ]
            }
            if (String(urlPath).includes('/explores/')) {
              if (mode === 'explore_fail') return { ok: false, statusCode: 500, body: '500 Broken explore LookML' }
              return {
                name: 'order_items',
                joins: [
                  { name: 'orders' },
                  { name: 'users', dependent_fields: ['orders.user_id', 'users.id'] },
                  { name: 'unused_leaf' },
                ],
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
            return {}
          },
        })
      )

    const vacOk = await runVac('return health_vacuum(project="ecom_proj")')
    expect(vacOk).toMatchObject({
      status: 'ok',
      vacuum_safe: true,
      unused_fields: [
        { model: 'thelook', explore: 'order_items', field: 'orders.unused_note', hidden: false },
        { model: 'thelook', explore: 'order_items', field: 'unused_leaf.code', hidden: false },
      ],
      unused_joins: [{ model: 'thelook', explore: 'order_items', join: 'unused_leaf' }],
    })
    const queryBodies = vacCalls.filter((c) => c.path.includes('/queries/run/')).map((c) => c.body as Record<string, Record<string, string>>)
    expect(queryBodies[0]?.filters?.['query.model']).toBe('thelook')
    expect(queryBodies[1]?.filters?.['field_usage.model']).toBe('thelook')

    // Capped explores short-circuits BEFORE executing 5000-row field_usage query
    vacCalls.length = 0
    const vacCapped = await runVac('return health_vacuum(project="ecom_proj", max_explores=1)')
    expect(vacCapped).toMatchObject({ status: 'truncated', capped_explores: true, vacuum_safe: false, unused_fields: [] })
    expect(vacCalls.some((c) => (c.body as Record<string, unknown>)?.view === 'field_usage')).toBe(false)

    mode = 'truncated'
    const vacTrunc = await runVac('return health_vacuum(model="thelook")')
    expect(vacTrunc).toMatchObject({
      status: 'truncated',
      row_count: 5000,
      limit: 5000,
      truncated: true,
      vacuum_safe: false,
      unused_fields: [],
      unused_joins: [],
    })

    mode = 'models_fail'
    expect(await runVac('return health_vacuum(project="ecom_proj")')).toMatchObject({ status: 'error', vacuum_safe: false, unused_fields: [] })

    mode = 'explore_fail'
    expect(await runVac('return health_vacuum(project="ecom_proj")')).toMatchObject({ status: 'error', vacuum_safe: false, unused_fields: [] })

    mode = 'forbidden'
    const pulseDenied = await runVac('return {"pulse": health_pulse(7), "vac": health_vacuum(model="thelook")}')
    expect(pulseDenied.pulse).toMatchObject({
      status: 'permission_denied',
      vacuum_safe: false,
      query_volume: null,
      error_queries: null,
      error_rate: null,
      cache_hit_ratio: null,
      slow_query_count: null,
    })
    expect(pulseDenied.vac).toMatchObject({
      status: 'permission_denied',
      vacuum_safe: false,
      unused_fields: [],
    })

    // 3. Safe Mode PermissionError re-raised untouched + per-helper gating when user defines 1 helper locally
    const permDenied = await LkrCodeMode.runPythonCode({
      code: 'return health_pulse(7)',
      requestHandler: async () => {
        throw new Error('PermissionError: User denied run_inline_query')
      },
    })
    expect(permDenied).toContain('PermissionError')
    const partialOverride = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: 'def api_template(t):\n    return {"wrapped": describe_body(t)["type"]}\nreturn api_template("WriteConnection")',
      })
    )
    expect(partialOverride).toEqual({ wrapped: 'WriteDBConnection' })
  })

  test('86. Issue #214: portable JSON export/import helpers remap elements & filters, soft-trash partial shells on failure, propagate PermissionError, and register activity labels', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = []
    let failOnElement = false
    let nextElIdx = 501
    const portableHandler = async (method: string, urlPath: string, _qp?: unknown, body?: unknown) => {
      calls.push({ method, path: urlPath, body })
      if (method === 'GET' && urlPath === '/dashboards/10') {
        return {
          id: '10',
          user_id: '7',
          folder_id: '3',
          content_metadata_id: '88',
          slug: 'slug10',
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
          last_updater_id: '7',
          title: 'Revenue Overview',
          dashboard_filters: [
            { id: 'f_old', name: 'Region', title: 'Region', type: 'field_filter', model: 'ecom', explore: 'orders', dimension: 'users.region', field: { name: 'users.region', sql: '${TABLE}.region' }, row: 1 },
          ],
          dashboard_elements: [
            {
              id: 'el_100',
              dashboard_id: '10',
              dashboard_layout_id: 'lay_old',
              body_text_as_html: '<p>ro</p>',
              title: 'Total Orders',
              type: 'vis',
              query: { id: 'q_old', client_id: 'c_old', slug: 'qs', model: 'ecom', view: 'orders', fields: ['orders.count'] },
              result_maker: { filterables: [{ model: 'ecom', view: 'orders', listen: [{ dashboard_filter_name: 'Region', field: 'users.region' }] }] },
            },
          ],
          dashboard_layouts: [{ id: 'lay_old', type: 'newspaper', dashboard_layout_components: [{ id: 'cmp_old', dashboard_element_id: 'el_100', row: 2, column: 4, width: 12, height: 6 }] }],
        }
      }
      if (method === 'GET' && urlPath === '/folders/55') return { id: '55', name: 'Personal' }
      if (method === 'POST' && urlPath === '/dashboards') return { id: '501', title: (body as Record<string, unknown>)?.title }
      if (method === 'PATCH' && urlPath === '/dashboards/501') return { id: '501', deleted: true }
      if (method === 'POST' && urlPath === '/dashboard_filters') return { id: 'f_501' }
      if (method === 'POST' && urlPath === '/queries') return { id: 'q_501' }
      if (method === 'POST' && urlPath === '/dashboard_elements') {
        if (failOnElement) throw new Error('Simulated element failure')
        return { id: `el_${nextElIdx++}` }
      }
      if (method === 'GET' && urlPath === '/dashboards/501/dashboard_layouts') {
        return [{ id: 'lay_501', dashboard_layout_components: [{ id: 'cmp_501', dashboard_element_id: 'el_501' }] }]
      }
      if (method === 'PATCH' && urlPath === '/dashboard_layout_components/cmp_501') return { id: 'cmp_501' }
      if (method === 'GET' && urlPath === '/looks/20') {
        return { id: '20', user_id: '7', slug: 'lslug', title: 'Top Brands', model: { id: 'ecom' }, query: { id: 'q20', slug: 'qs20', model: 'ecom', view: 'orders', fields: ['products.brand', 'orders.count'] } }
      }
      if (method === 'POST' && urlPath === '/looks') return { id: '601', title: (body as Record<string, unknown>)?.title }
      return {}
    }

    const roundTripRaw = await LkrCodeMode.runPythonCode({
      code: [
        'd_spec = export_dashboard_json("10")',
        'd_imp = import_dashboard_json("uploaded_dash.json", "55", title="Imported Revenue")',
        'l_spec = export_look_json("20")',
        'l_imp = import_look_json("\\ufeff" + json.dumps([l_spec]), "55", title="Imported Brands")',
        'return {"d_spec": d_spec, "d_imp": d_imp, "l_spec": l_spec, "l_imp": l_imp}',
      ].join('\n'),
      vars: {
        uploaded_files: {
          '/workspace/uploads/uploaded_dash.json': JSON.stringify({
            title: 'From Upload',
            dashboard_filters: [{ name: 'Region', title: 'Region', type: 'field_filter', model: 'ecom', explore: 'orders', dimension: 'users.region', field: { name: 'users.region' }, row: 2, listen: { el_100: 'users.region' } }],
            dashboard_elements: [
              { id: 'el_100', dashboard_layout_id: 'lay_foreign', title: 'Total Orders', type: 'vis', query: { id: 'q_old', model: 'ecom', view: 'orders', fields: ['orders.count'] } },
              { title: 'Note Banner', type: 'text', body_text: 'Read me', listen: { Region: 'users.region' } },
            ],
            dashboard_layouts: [
              { active: false, type: 'newspaper', dashboard_layout_components: [] },
              { active: true, type: 'newspaper', dashboard_layout_components: [{ dashboard_element_id: 'el_100', row: 4, column: 6, width: 12, height: 8 }, { dashboard_element_id: 'orphan_999', row: 0, column: 0, width: 6, height: 4 }] },
            ],
          }),
        },
      },
      requestHandler: portableHandler,
    })
    const rt = JSON.parse(roundTripRaw)
    for (const roKey of ['id', 'user_id', 'folder_id', 'content_metadata_id', 'slug', 'created_at', 'updated_at', 'last_updater_id']) {
      expect(roKey in rt.d_spec).toBe(false)
      expect(roKey in rt.l_spec).toBe(false)
    }
    expect('dashboard_layout_id' in rt.d_spec.dashboard_elements[0]).toBe(false)
    expect('field' in rt.d_spec.dashboard_filters[0]).toBe(false)
    const postedFilter = calls.find((c) => c.method === 'POST' && c.path === '/dashboard_filters')?.body as Record<string, unknown>
    expect('field' in postedFilter).toBe(false)
    const postedEls = calls.filter((c) => c.method === 'POST' && c.path === '/dashboard_elements').map((c) => c.body as Record<string, unknown>)
    expect('dashboard_layout_id' in postedEls[0]).toBe(false)
    expect('result_maker' in postedEls[1]).toBe(false)
    expect(rt.d_imp).toMatchObject({ id: '501', dashboard_id: '501', folder_id: '55', tile_count: 2, element_id_map: { el_100: 'el_501' } })
    expect(rt.l_imp).toMatchObject({ id: '601', look_id: '601', folder_id: '55' })
    expect(
      extractNativeContentFromInteraction({
        steps: [{ id: 'c1', type: 'function_call', name: 'run_looker_codemode' }, { id: 'r1', call_id: 'c1', type: 'function_result', name: 'run_looker_codemode', result: rt.d_imp }],
      })
    ).toMatchObject({ id: '501', contentType: 'dashboard', title: 'Imported Revenue' })

    // Empty folder_id and queryless Look fail fast before mutating
    calls.length = 0
    expect(await LkrCodeMode.runPythonCode({ code: 'return import_dashboard_json({"title": "Bad"}, "")', requestHandler: portableHandler })).toContain('Valid non-empty folder_id')
    expect(await LkrCodeMode.runPythonCode({ code: 'return import_look_json({"title": "NoQuery"}, "55")', requestHandler: portableHandler })).toContain('valid query')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    // Mid-import failure soft-trashes partial shell; PermissionError propagates without soft-trashing or swallowing
    calls.length = 0
    failOnElement = true
    const failedImport = await LkrCodeMode.runPythonCode({
      code: 'return import_dashboard_json({"title": "Partial", "dashboard_elements": [{"title": "T1", "type": "text"}]}, "55")',
      requestHandler: portableHandler,
    })
    expect(failedImport).toContain('Simulated element failure')
    expect(calls.some((c) => c.method === 'PATCH' && c.path === '/dashboards/501' && (c.body as Record<string, unknown>)?.deleted === true)).toBe(true)

    const permImport = await LkrCodeMode.runPythonCode({
      code: 'return import_dashboard_json({"title": "Blocked"}, "55")',
      requirePermission: true,
      onPermissionRequest: async () => 'deny',
      requestHandler: portableHandler,
    })
    expect(permImport).toContain('PermissionError')

    // Activity labels & CODEMODE_MACROS preview (preserving existing labels byte-for-byte)
    expect(formatFriendlyLookerActivityLabel('run_inline_query("json", {"model": "ecom", "view": "orders"})')).toEqual({
      statusText: 'Executing Looker queries for Orders...',
      stepTitle: 'Executing Looker queries for Orders...',
      targetLabel: 'Orders',
      isQuery: true,
    })
    expect(formatFriendlyLookerActivityLabel('api_template("WriteConnection")').title).toBe('Inspecting Looker API request schema')
    expect(formatFriendlyLookerActivityLabel('health_vacuum(model="ecom")').title).toBe('Auditing unused LookML fields & explores')
    expect(formatFriendlyLookerActivityLabel('import_dashboard_json("d.json", "55")').title).toBe('Importing portable Looker JSON content')
    const steps = extractInteractionActivitySteps({
      steps: [
        {
          id: 'cm_214',
          type: 'function_call',
          name: 'run_looker_codemode',
          arguments: { code: 'api_template("WriteConnection")\nhealth_pulse(7)\nexport_dashboard_json("10")' },
        },
      ],
    })
    expect(steps[0]?.detail).toBe('api_template, health_pulse, export_dashboard_json')
    expect(AGENTS_MD).toContain('<CONFIGURE_IN_LOOKER_ADMIN_UI>')
    expect(AGENTS_MD).toContain('health_vacuum')
    expect(AGENTS_MD).toContain('copy_dashboard(id, folder_id)')
    expect(AGENTS_MD).toContain('me()["personal_folder_id"]')
  })
}
