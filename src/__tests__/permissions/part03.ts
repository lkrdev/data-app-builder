import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  BOOTSTRAP_LOOKML_PY, buildWorkspaceSources, BUNDLE_APP_PY, computeLkrExtensionCacheKey,
  CONCURRENT_POLL_SCHEDULE_MS, DASHBOARD_CODEMODE_PREAMBLE_PY, executeLkrExtensionToolRequest, extractLkrExtensionToolRequests,
  getSharedEnvExploreSchemas, LKR_CLI_BRIDGE_TOOL, LKR_CLI_SITECUSTOMIZE_PY, LkrCodeMode,
  recordSharedEnvExploreSchema, resolveAdaptivePollScheduleMs, runAntigravityTurn,
} from '../../antigravity'
import { createLookerEmbedPreloadController, normalizeLookerEmbedUrl, resolveLookerEmbedTarget } from '../../components/StudioWorkspace'
import {
  buildDenseExploreSchema, clearLookerMetadataCache, createDeduplicatedLookerSdkProxy, normalizeStudioThemeMode,
  resolveStudioTheme, resolveSystemTheme, STUDIO_THEME_STORAGE_KEY,
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

export function registerPermissionsPart03Tests(): void {
  test('14. monkey-patches online lkr-dev-cli calls via LKR_CLI_SITECUSTOMIZE_PY, extracts & executes <LKR_EXTENSION_TOOL_REQUEST> (codemode + sdk_request), and auto-bridges in runAntigravityTurn', async () => {
    // 1. Verify LKR_CLI_SITECUSTOMIZE_PY injection in buildWorkspaceSources and BOOTSTRAP_LOOKML_PY
    expect(LKR_CLI_SITECUSTOMIZE_PY).toContain('<LKR_EXTENSION_TOOL_REQUEST>')
    expect(LKR_CLI_SITECUSTOMIZE_PY).toContain('.lkr_extension_cache')
    expect(LKR_CLI_SITECUSTOMIZE_PY).toContain('_patch_auth_service')
    expect(LKR_CLI_SITECUSTOMIZE_PY).toContain('_patch_codemode')
    expect(BOOTSTRAP_LOOKML_PY).toContain('ensure_sitecustomize')
    expect(BOOTSTRAP_LOOKML_PY).toContain('lkr-dev-cli/lib')
    expect(BOOTSTRAP_LOOKML_PY).toContain('python3.*/site-packages')
    expect(BOOTSTRAP_LOOKML_PY).toContain('lkr-dev-cli[tools,code-mode,parse]')
    expect(BOOTSTRAP_LOOKML_PY).not.toContain('urllib.request')
    expect(BOOTSTRAP_LOOKML_PY).not.toContain('codeload.github.com')
    expect(LKR_CLI_BRIDGE_TOOL.name).toBe('lkr_cli_extension_bridge')

    const sources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: '/workspace/sitecustomize.py',
          content: LKR_CLI_SITECUSTOMIZE_PY,
        }),
        expect.objectContaining({
          target: '/workspace/bootstrap_lookml.py',
          content: BOOTSTRAP_LOOKML_PY,
        }),
      ])
    )

    // 2. Verify 1:1 SHA-256 cache_key parity with Python sitecustomize.py + extractLkrExtensionToolRequests
    const codemodeKey = computeLkrExtensionCacheKey({
      kind: 'codemode',
      code: 'return me()',
      vars: { project_id: 'thelook' },
      dev_mode: true,
    })
    expect(codemodeKey).toBe('467cb154b6e27c76e1ac62129a7b15b0bd5615f0ebdb2a7ab5d396e0400b0306')

    const sdkReqKey = computeLkrExtensionCacheKey({
      kind: 'sdk_request',
      method: 'GET',
      path: 'https://extension.looker.local/api/4.0/user',
      query_params: null,
      body: null,
      dev_mode: true,
    })
    expect(sdkReqKey).toBe('14ccf6639b5130d140a0fa3444c5373cf44dcc96d00b265369948529564a4784')

    const extracted = extractLkrExtensionToolRequests({
      steps: [
        {
          type: 'code_execution',
          stdout: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({
            kind: 'codemode',
            cache_key: codemodeKey,
            code: 'return me()',
            vars: { project_id: 'thelook' },
            dev_mode: true,
          })}</LKR_EXTENSION_TOOL_REQUEST>`,
          stderr: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({
            kind: 'codemode',
            cache_key: codemodeKey,
            code: 'return me()',
            vars: { project_id: 'thelook' },
            dev_mode: true,
          })}</LKR_EXTENSION_TOOL_REQUEST>\n<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({
            kind: 'sdk_request',
            method: 'GET',
            path: '/api/4.0/user',
            query_params: {},
            body: null,
            dev_mode: true,
          })}</LKR_EXTENSION_TOOL_REQUEST>`,
        },
      ],
    })
    expect(extracted).toHaveLength(2)
    expect(extracted[0]).toEqual({
      kind: 'codemode',
      cache_key: codemodeKey,
      code: 'return me()',
      vars: { project_id: 'thelook' },
      dev_mode: true,
    })
    expect(extracted[1]).toEqual({
      kind: 'sdk_request',
      cache_key: sdkReqKey,
      method: 'GET',
      path: '/user',
      query_params: null,
      body: null,
      dev_mode: true,
    })

    // 3. Verify executeLkrExtensionToolRequest for both codemode and sdk_request
    const rawTransportCalls: Array<{
      method: string
      path: string
      queryParams?: unknown
      body?: unknown
    }> = []
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      authSession: {
        transport: {
          rawRequest: async (
            method: string,
            reqPath: string,
            queryParams?: unknown,
            body?: unknown
          ) => {
            rawTransportCalls.push({ method, path: reqPath, queryParams, body })
            if (reqPath === '/session') {
              return { ok: true, statusCode: 200, body: JSON.stringify({ workspace_id: 'dev' }) }
            }
            return {
              ok: true,
              statusCode: 200,
              body: JSON.stringify({ id: '1', display_name: 'Super Admin', email: 'admin@bryanweber.altostrat.com' }),
            }
          },
        },
      },
    })

    const spyCodeMode = jest
      .spyOn(LkrCodeMode, 'runPythonCode')
      .mockResolvedValueOnce(
        JSON.stringify({ id: '1', display_name: 'Super Admin', project_id: 'thelook' })
      )

    const cmExec = await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: extracted[0],
      defaultVars: { target_model: 'thelook' },
    })
    expect(cmExec.cacheKey).toBe(codemodeKey)
    expect(cmExec.result).toEqual({ id: '1', display_name: 'Super Admin', project_id: 'thelook' })
    expect(spyCodeMode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return me()',
        sdk: mockSdk,
        vars: { target_model: 'thelook', project_id: 'thelook' },
        allowUpdateSession: true,
      })
    )

    const sdkExec = await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: extracted[1],
    })
    expect(sdkExec.cacheKey).toBe(sdkReqKey)
    expect(sdkExec.result).toEqual({
      id: '1',
      display_name: 'Super Admin',
      email: 'admin@bryanweber.altostrat.com',
    })
    expect(rawTransportCalls).toEqual([
      { method: 'PATCH', path: '/session', queryParams: undefined, body: JSON.stringify({ workspace_id: 'dev' }) },
      { method: 'GET', path: '/user', queryParams: undefined, body: undefined },
    ])

    // 4. End-to-end runAntigravityTurn auto-bridging when sandbox code_execution emits <LKR_EXTENSION_TOOL_REQUEST>
    spyCodeMode.mockResolvedValueOnce(
      JSON.stringify({ run_id: '20261101_1', branch_name: '20261101_1', model_name: 'thelook' })
    )

    const interactionPostBodies: MockInteractionPostBody[] = []
    let interactionPostCount = 0
    const mockExtSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        if (init?.method === 'POST') {
          interactionPostCount += 1
          interactionPostBodies.push(body)
          if (interactionPostCount === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_bridge_round_1',
                environment_id: 'env_lookml_shared',
                status: 'completed',
                steps: [
                  {
                    type: 'code_execution',
                    output: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({
                      kind: 'codemode',
                      cache_key: codemodeKey,
                      code: 'return me()',
                      vars: { project_id: 'thelook' },
                      dev_mode: true,
                    })}</LKR_EXTENSION_TOOL_REQUEST>`,
                  },
                ],
                output_text: 'Waiting on bridged lkr code-mode sandbox execution.',
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_bridge_round_2',
              environment_id: 'env_lookml_shared',
              status: 'completed',
              steps: [
                {
                  type: 'code_execution',
                  output:
                    '<LOOKML_BUNDLE>{"id":"20261101_1","title":"LookML: thelook","project_id":"thelook","model_name":"thelook","branch_name":"20261101_1","files":[{"path":"views/orders.view.lkml","action":"updated","content":"view: orders {}","diff":"@@ -1 +1 @@"}]}</LOOKML_BUNDLE>',
                },
              ],
              output_text: 'Curated orders.view.lkml after replaying cached lkr code-mode sandbox response.',
            }),
          }
        }
        return { ok: true, status: 200, body: '{}' }
      },
    }

    const turnResult = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtSDK,
      auth: { mode: 'apikey' },
      session: { toolType: 'lookml', environmentId: 'env_lookml_shared' },
      toolMode: 'lookml',
      lookmlProjectId: 'thelook',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Run init_branch.py and curate orders view',
      onStatus: () => {},
    })

    expect(interactionPostBodies).toHaveLength(2)
    expect(interactionPostBodies[1].previous_interaction_id).toBe('int_bridge_round_1')
    expect(interactionPostBodies[1].environment).toBe('env_lookml_shared')
    expect(interactionPostBodies[1].input?.[0]?.text).toContain(
      `/workspace/.lkr_extension_cache/${codemodeKey}.json`
    )
    expect(interactionPostBodies[1].input?.[0]?.text).toContain('"branch_name":"20261101_1"')
    expect(turnResult.lookmlBundle?.project_id).toBe('thelook')
    expect(turnResult.lookmlBundle?.branch_name).toBe('20261101_1')
    expect(turnResult.session.lastInteractionId).toBe('int_bridge_round_2')
    expect(turnResult.telemetry.tool_calls.codemode).toBe(1)
    expect(turnResult.telemetry.tool_calls.bash).toBe(2)

    spyCodeMode.mockRestore()
  })

  test('15. runs concurrent multi-conversation turns (Data App Stream A + Content Studio Stream B) in a single shared environment_id with isolated per-turn Looker HTTP telemetry', async () => {
    const sharedEnvId = 'env_shared'
    const originalRawRequest = async (method: string, reqPath: string) => ({
      ok: true,
      statusCode: 200,
      body: JSON.stringify({ method, path: reqPath }),
    })
    const transport = { rawRequest: originalRawRequest }
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      authSession: { transport },
    })
    const spyCodeMode = jest.spyOn(LkrCodeMode, 'runPythonCode').mockImplementation(async (opts) => {
      const count = String(opts.code || '').includes('stream_b') ? 3 : 1
      const sdkTransport = (opts.sdk as unknown as { authSession: { transport: typeof transport } }).authSession.transport
      for (let i = 0; i < count; i += 1) await sdkTransport.rawRequest('GET', `/api/4.0/test_${i}`)
      return JSON.stringify({ NATIVE_CONTENT_BUNDLE: { id: '101', content_type: 'dashboard', title: 'Executive Commerce Pulse' } })
    })

    const postedBodies: MockInteractionPostBody[] = []
    const appStep = (title: string) => [
      { type: 'code_execution', output: `<DATA_APP_BUNDLE>${JSON.stringify({ title, source_code: 'export class App {}', prod_code: 'export class App {}', widgets: [] })}</DATA_APP_BUNDLE>` },
    ]
    const fnCallStep = (id: string, code: string) => [
      { type: 'function_call', id, name: 'run_looker_codemode', arguments: { code } },
    ]
    const mockExtSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        if (init?.method !== 'POST') return { ok: true, status: 200, body: '{}' }
        postedBodies.push(body)
        const text = String(body?.input?.[0]?.text || '')
        const isFnResult = body?.input?.[0]?.type === 'function_result'
        const isB1 = body?.previous_interaction_id === 'int_B1_call'
        const payload = isFnResult
          ? {
              id: isB1 ? 'int_B1' : 'int_A1',
              environment_id: sharedEnvId,
              status: 'completed',
              steps: isB1 ? [] : appStep('Executive Revenue Command Center'),
              output_text: isB1
                ? '<NATIVE_CONTENT_BUNDLE>{"id":"101","content_type":"dashboard","title":"Executive Commerce Pulse"}</NATIVE_CONTENT_BUNDLE>'
                : 'Built Data App.',
            }
          : text.includes('Stream A Turn 1')
          ? { id: 'int_A1_call', environment_id: sharedEnvId, status: 'requires_action', steps: fnCallStep('fc_a1', 'return "stream_a"') }
          : text.includes('Stream A Turn 2')
          ? { id: 'int_A2', environment_id: sharedEnvId, status: 'completed', steps: appStep('Executive Revenue Command Center v2'), output_text: 'Updated Data App.' }
          : text.includes('Stream B Turn 1')
          ? { id: 'int_B1_call', environment_id: sharedEnvId, status: 'requires_action', steps: fnCallStep('fc_b1', 'return "stream_b"') }
          : {
              id: 'int_B2',
              environment_id: sharedEnvId,
              status: 'completed',
              output_text: '<NATIVE_CONTENT_BUNDLE>{"id":"thelook::executive_pulse","content_type":"lookml_dashboard","title":"Executive Pulse (LookML)"}</NATIVE_CONTENT_BUNDLE>',
            }
        return { ok: true, status: 200, body: JSON.stringify(payload) }
      },
    }

    const baseOpts = {
      sdk: mockSdk,
      extensionSDK: mockExtSDK,
      auth: { mode: 'apikey' as const },
      environmentId: sharedEnvId,
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      onStatus: () => {},
    }
    const [convAResults, convBResults] = await Promise.all([
      (async () => {
        const t1a = await runAntigravityTurn({ ...baseOpts, conversationId: 'conv_a_data_app', session: { toolType: 'app', environmentId: sharedEnvId, conversationId: 'conv_a_data_app' }, mode: 'app', userPrompt: 'Stream A Turn 1' })
        const t2a = await runAntigravityTurn({ ...baseOpts, conversationId: 'conv_a_data_app', session: t1a.session, mode: 'app', existingAppCode: t1a.bundle?.source_code, userPrompt: 'Stream A Turn 2' })
        return [t1a, t2a]
      })(),
      (async () => {
        const t1b = await runAntigravityTurn({ ...baseOpts, conversationId: 'conv_b_dashboard', session: { toolType: 'dashboard', environmentId: sharedEnvId, conversationId: 'conv_b_dashboard' }, mode: 'dashboard', userPrompt: 'Stream B Turn 1' })
        const t2b = await runAntigravityTurn({ ...baseOpts, conversationId: 'conv_b_dashboard', session: t1b.session, mode: 'dashboard', activeContent: { id: '101', type: 'dashboard', title: 'Executive Commerce Pulse', embedPath: '/embed/dashboards/101' }, userPrompt: 'Stream B Turn 2' })
        return [t1b, t2b]
      })(),
    ])

    expect(transport.rawRequest).toBe(originalRawRequest)
    expect(postedBodies.every((b) => b.environment === sharedEnvId)).toBe(true)
    expect(convAResults[0].session.environmentId).toBe(sharedEnvId)
    expect(convAResults[1].session.lastInteractionId).toBe('int_A2')
    expect(convBResults[0].session.environmentId).toBe(sharedEnvId)
    expect(convBResults[1].session.lastInteractionId).toBe('int_B2')
    expect(convAResults[0].telemetry.tool_calls.looker_http).toBe(1)
    expect(convBResults[0].telemetry.tool_calls.looker_http).toBe(3)
    spyCodeMode.mockRestore()
  })

  test('16. coalesces concurrent cold-start environment provisioning, deduplicates Looker metadata GETs, and isolates shared-env workspace artifacts (Issue #40)', async () => {
    clearLookerMetadataCache()
    const sharedEnvId = 'env_coalesced_shared_40'

    // 1. Workspace artifact isolation & cross-conversation schema cache
    expect(BUNDLE_APP_PY).toContain('app_path.parent != Path("/workspace")')
    expect(BUNDLE_APP_PY).toContain('app_path.parent / "bundle.json"')
    expect(DASHBOARD_CODEMODE_PREAMBLE_PY).toContain('cached_explore_schemas')
    recordSharedEnvExploreSchema(sharedEnvId, 'thelook::order_items', '### thelook::order_items\n- id')
    expect(getSharedEnvExploreSchemas(sharedEnvId)['thelook::order_items']).toContain('thelook::order_items')
    const sources = buildWorkspaceSources({
      schemaMarkdown: '# Schema',
      cachedExploreSchemas: getSharedEnvExploreSchemas(sharedEnvId),
    })
    const schemaSource = sources.find((s) => s.target === '/workspace/.lkr_extension_cache/explore_schemas.json')
    expect(schemaSource).toBeDefined()
    expect(JSON.parse(schemaSource!.content)['thelook::order_items']).toContain('thelook::order_items')

    // 2. Adaptive poll schedule under multi-turn concurrency
    expect(resolveAdaptivePollScheduleMs(undefined, sharedEnvId, 0)[0]).toBe(400)
    expect(resolveAdaptivePollScheduleMs(undefined, sharedEnvId, 1)[0]).toBe(CONCURRENT_POLL_SCHEDULE_MS[0] + 35)

    // 3. Concurrent Looker metadata GET deduplication
    let lookmlModelExploreCount = 0
    const rawTransport = {
      rawRequest: async (_method: string, reqPath: string) => ({
        ok: true,
        statusCode: 200,
        body: JSON.stringify({ path: reqPath }),
      }),
    }
    const rawSdk = asSdk({
      ok: async <T>(p: T) => p,
      lookml_model_explore: async (params: { explore_name?: string; lookml_model_name?: string }) => {
        lookmlModelExploreCount += 1
        await new Promise((r) => setTimeout(r, 10))
        return {
          name: params.explore_name,
          model_name: params.lookml_model_name,
          fields: { dimensions: [{ name: 'order_items.id', type: 'number' }], measures: [{ name: 'order_items.count', type: 'count' }] },
        }
      },
      authSession: {
        transport: rawTransport,
      },
    })
    const [s1, s2] = await Promise.all([
      buildDenseExploreSchema(rawSdk, 'thelook', 'order_items'),
      buildDenseExploreSchema(rawSdk, 'thelook', 'order_items'),
    ])
    expect(s1).toBe(s2)
    expect(lookmlModelExploreCount).toBe(1)

    let httpHits = 0
    let rawTransportCount = 0
    rawTransport.rawRequest = async (_method: string, reqPath: string) => {
      rawTransportCount += 1
      await new Promise((r) => setTimeout(r, 10))
      return { ok: true, statusCode: 200, body: JSON.stringify({ path: reqPath }) }
    }
    const proxySdk = createDeduplicatedLookerSdkProxy(rawSdk, () => {
      httpHits += 1
    })
    await Promise.all([
      proxySdk.lookml_model_explore({ lookml_model_name: 'thelook', explore_name: 'users' }),
      proxySdk.lookml_model_explore({ lookml_model_name: 'thelook', explore_name: 'users' }),
      proxySdk.authSession.transport.rawRequest('GET', '/api/4.0/lookml_models/thelook/explores/users'),
      proxySdk.authSession.transport.rawRequest('GET', '/api/4.0/lookml_models/thelook/explores/users'),
    ])
    expect(lookmlModelExploreCount).toBe(2)
    expect(rawTransportCount).toBe(1)
    expect(httpHits).toBe(2)

    // 4. Coalesced cold-start environment provisioning across concurrent turns
    const postedBodies: MockInteractionPostBody[] = []
    const mockExtSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        if (init?.method !== 'POST') return { ok: true, status: 200, body: '{}' }
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        postedBodies.push(body)
        if (typeof body?.environment === 'object') {
          await new Promise((r) => setTimeout(r, 15))
        }
        const text = String(body?.input?.[0]?.text || '')
        const isA = text.includes('Coalesce A')
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: isA ? 'int_coal_A1' : 'int_coal_B1',
            environment_id: sharedEnvId,
            status: 'completed',
            steps: isA
              ? [{ type: 'code_execution', output: '<DATA_APP_BUNDLE>{"title":"Coalesced App","source_code":"export class App {}","prod_code":"export class App {}","widgets":[]}</DATA_APP_BUNDLE>' }]
              : [],
            output_text: isA
              ? 'Built Coalesced App.'
              : '<NATIVE_CONTENT_BUNDLE>{"id":"101","content_type":"dashboard","title":"Coalesced Dash"}</NATIVE_CONTENT_BUNDLE>',
          }),
        }
      },
    }
    const baseOpts = {
      sdk: rawSdk,
      extensionSDK: mockExtSDK,
      auth: { mode: 'apikey' as const },
      userId: 'user_coalesce_40',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      onStatus: () => {},
    }
    const [resA, resB] = await Promise.all([
      runAntigravityTurn({ ...baseOpts, conversationId: 'conv_coal_a', session: { toolType: 'app', environmentId: '', conversationId: 'conv_coal_a' }, mode: 'app', userPrompt: 'Coalesce A' }),
      runAntigravityTurn({ ...baseOpts, conversationId: 'conv_coal_b', session: { toolType: 'dashboard', environmentId: '', conversationId: 'conv_coal_b' }, mode: 'dashboard', userPrompt: 'Coalesce B' }),
    ])
    expect(resA.session.environmentId).toBe(sharedEnvId)
    expect(resB.session.environmentId).toBe(sharedEnvId)
    const remoteSpecPosts = postedBodies.filter((b) => typeof b.environment === 'object' && b.environment?.type === 'remote')
    const stringEnvPosts = postedBodies.filter((b) => b.environment === sharedEnvId)
    expect(remoteSpecPosts.length).toBe(1)
    expect(stringEnvPosts.length).toBe(1)
  })

  test('17. preloads @looker/embed-sdk immediately on mount and reuses a single ILookerConnection across loadDashboard, asDashboardConnection().run(), loadLook, loadUrl, and /preload reset (Issue #45)', async () => {
    expect(normalizeLookerEmbedUrl('/preload')).toBe('/preload')
    expect(normalizeLookerEmbedUrl('/dashboards/42')).toBe('/embed/dashboards/42')
    expect(
      normalizeLookerEmbedUrl(
        'https://dev-argolis.looker.com/embed/conversations/ca_1?agent_id=a1',
        'https://dev-argolis.looker.com'
      )
    ).toBe(
      '/embed/conversations/ca_1?agent_id=a1&hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true'
    )

    const attrs: Record<string, string> = {}
    const fakeIframe = {
      className: '',
      title: '',
      src: '',
      srcdoc: '',
      setAttribute: (k: string, v: string) => {
        attrs[`iframe:${k}`] = v
        if (k === 'src') fakeIframe.src = v
      },
      getAttribute: (k: string) => attrs[`iframe:${k}`] || '',
      removeAttribute: (k: string) => {
        delete attrs[`iframe:${k}`]
      },
    }
    const fakeContainer = {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v
      },
      querySelector: (sel: string) => (sel === 'iframe' ? fakeIframe : null),
    } as unknown as HTMLElement

    const ctl = createLookerEmbedPreloadController({
      hostUrl: 'https://dev-argolis.looker.com',
      container: fakeContainer,
      mockPreviewHtml: (mode, objectId) => `<html><body>${mode}:${objectId}</body></html>`,
    })

    const conn0 = await ctl.connectionPromise
    expect(ctl.getTelemetry().state).toBe('preloaded')
    expect(ctl.getTelemetry().target).toBe('/preload')
    expect(ctl.getTelemetry().calls).toEqual([
      { method: 'init', arg: 'https://dev-argolis.looker.com' },
      { method: 'preload', arg: '/embed/preload' },
    ])

    // 1. Initial empty conversation stays on preloaded connection without extra loadUrl call
    const tEmpty = resolveLookerEmbedTarget({ isEmptyConversation: true, nonce: 0 })
    const connEmpty = await ctl.syncTarget(tEmpty)
    expect(connEmpty).toBe(conn0)
    expect(ctl.getTelemetry().loadCount).toBe(0)

    // 2. Load Data App Dashboard #42 via connection.loadDashboard
    const tApp42 = resolveLookerEmbedTarget({
      builderMode: 'data_app',
      publishedApp: { dashboardId: '42' },
      nonce: 1,
    })
    const connApp42 = await ctl.syncTarget(tApp42)
    expect(connApp42).toBe(conn0)
    expect(attrs['data-embed-state']).toBe('dashboard')
    expect(attrs['data-embed-target']).toBe('42')
    expect(fakeIframe.srcdoc).toContain('data_app:42')

    // 3. Warm-turn update on same Dashboard #42 bounces through /preload (pushHistory: false) then loadDashboard('42')
    const tApp42Warm = resolveLookerEmbedTarget({
      builderMode: 'data_app',
      publishedApp: { dashboardId: '42' },
      nonce: 2,
    })
    const connApp42Warm = await ctl.syncTarget(tApp42Warm)
    expect(connApp42Warm).toBe(conn0)
    expect(ctl.getTelemetry().calls.slice(2, 5)).toEqual([
      { method: 'loadDashboard', arg: '42' },
      { method: 'loadUrl', arg: '/preload' },
      { method: 'loadDashboard', arg: '42' },
    ])
    expect(ctl.getTelemetry().runCount).toBeGreaterThanOrEqual(2)

    // 4. Switch to Saved Look #15 via connection.loadLook
    const tLook15 = resolveLookerEmbedTarget({
      builderMode: 'dashboard',
      nativeContent: {
        id: '15',
        lookId: '15',
        contentType: 'look',
        embedPath: '/embed/looks/15',
      },
      nonce: 2,
    })
    const connLook15 = await ctl.syncTarget(tLook15)
    expect(connLook15).toBe(conn0)
    expect(attrs['data-embed-state']).toBe('look')
    expect(attrs['data-embed-target']).toBe('15')

    // 5. Switch to LookML Dashboard via connection.loadDashboard
    const tLookmlDash = resolveLookerEmbedTarget({
      builderMode: 'dashboard',
      nativeContent: {
        id: 'thelook::executive_pulse',
        lookmlDashboardId: 'thelook::executive_pulse',
        contentType: 'lookml_dashboard',
        embedPath: '/embed/dashboards/thelook::executive_pulse',
      },
      nonce: 2,
    })
    await ctl.syncTarget(tLookmlDash)
    expect(attrs['data-embed-state']).toBe('dashboard')
    expect(attrs['data-embed-target']).toBe('thelook::executive_pulse')

    // 6. Switch to Conversational Analytics via connection.loadUrl
    const tCa = resolveLookerEmbedTarget({
      isCaMode: true,
      caConversation: {
        caConversationId: 'ca_conv_streaming_1',
        embedPath: '/embed/conversations/ca_conv_streaming_1?agent_id=ca_agent_ecommerce',
      },
      nonce: 3,
    })
    await ctl.syncTarget(tCa)
    expect(attrs['data-embed-state']).toBe('url')
    expect(attrs['iframe:data-testid']).toBe('ca-embed-iframe')
    expect(fakeIframe.srcdoc).toContain('conversational-analytics:ca_conv_streaming_1')

    // 7. Reset to New Conversation -> resets connection to /preload in-place
    const tReset = resolveLookerEmbedTarget({ isEmptyConversation: true, nonce: 4 })
    await ctl.syncTarget(tReset)
    expect(attrs['data-embed-state']).toBe('preloaded')
    expect(attrs['data-embed-target']).toBe('/preload')
    expect(attrs['iframe:data-testid']).toBeUndefined()
    expect(ctl.getTelemetry().calls.map((c) => c.method)).toEqual([
      'init',
      'preload',
      'loadDashboard',
      'loadUrl',
      'loadDashboard',
      'loadLook',
      'loadDashboard',
      'loadUrl',
      'loadUrl',
    ])
  })

  test('18. normalizes and resolves Light, Dark, and System theme modes (Issue #49)', () => {
    expect(STUDIO_THEME_STORAGE_KEY).toBe('dab_theme_mode')
    expect(normalizeStudioThemeMode('light')).toBe('light')
    expect(normalizeStudioThemeMode('dark')).toBe('dark')
    expect(normalizeStudioThemeMode('system')).toBe('system')
    expect(normalizeStudioThemeMode('invalid')).toBe('system')
    expect(normalizeStudioThemeMode(null)).toBe('system')
    expect(resolveSystemTheme({ matches: true })).toBe('dark')
    expect(resolveSystemTheme({ matches: false })).toBe('light')
    expect(resolveStudioTheme('light', 'dark')).toBe('light')
    expect(resolveStudioTheme('dark', 'light')).toBe('dark')
    expect(resolveStudioTheme('system', 'dark')).toBe('dark')
    expect(resolveStudioTheme('system', 'light')).toBe('light')
  })

}
