import type { Looker40SDK } from '@looker/sdk'

import {
  callInteractionsApi,
  LkrCodeMode,
  refreshOAuthSessionIfNeeded,
  runAntigravityTurn,
  STUDIO_OAUTH_STORAGE_KEY,
} from '../../antigravity'
import { enqueueCodeModeExecution, yieldCodeModeExecution } from '../../lkrCliCodeModeHelpers'
import {
  addInFlightConvId,
  clearArtifactServiceCache,
  clearInFlightConvId,
  createDeduplicatedLookerSdkProxy,
  getActiveCodeModeConversationId,
  getArtifactService,
  LkrCodeModeApiCallEntry,
  readInFlightConvId,
  readInFlightConvIds,
  removeInFlightConvId,
  saveInFlightConvId,
  STUDIO_INFLIGHT_CONV_SESSION_KEY,
  suspendCodeModeApiScope,
  withCodeModeApiScope,
} from '../../lookerApi'
import { nextStudioConvId, resumeInFlightConversationTurn } from '../../studioControllerConcurrency'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart25Tests(): void {
  test('89. Issue #224: serializes concurrent LkrCodeMode executions via enqueueCodeModeExecution with isolated conversation_id attribution and early AbortSignal cancellation', async () => {
    const id1 = nextStudioConvId()
    const id2 = nextStudioConvId()
    expect(id1).not.toBe(id2)

    // 1. Early abort while queued in enqueueCodeModeExecution
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((r) => { releaseFirst = r })
    const slot1 = enqueueCodeModeExecution(async () => {
      order.push('slot1:start')
      await firstGate
      order.push('slot1:end')
      return 'one'
    })
    const abort2 = new AbortController()
    const slot2 = enqueueCodeModeExecution(async () => {
      order.push('slot2:should-not-run')
      return 'two'
    }, abort2.signal)
    const slot3 = enqueueCodeModeExecution(async () => {
      order.push('slot3:run')
      return 'three'
    })

    abort2.abort()
    await expect(slot2).rejects.toMatchObject({ name: 'AbortError' })
    releaseFirst()
    expect(await slot1).toBe('one')
    expect(await slot3).toBe('three')
    expect(order).toEqual(['slot1:start', 'slot1:end', 'slot3:run'])

    // 2. Two concurrent turns running Code Mode in parallel serialize cleanly without cross-talk in lkr_codemode_api_calls
    const gCalls = globalThis as { lkr_codemode_api_calls?: LkrCodeModeApiCallEntry[] }
    gCalls.lkr_codemode_api_calls = []
    const activeScopesDuringTransport: Array<{ path: string; activeConv: string }> = []
    let concurrentInFlightScopes = 0
    let maxConcurrentScopes = 0

    const rawSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, reqPath: string) => {
            const activeConv = getActiveCodeModeConversationId()
            activeScopesDuringTransport.push({ path: reqPath, activeConv })
            if (reqPath.includes('/folders')) {
              await new Promise((r) => setTimeout(r, 35))
            } else {
              await new Promise((r) => setTimeout(r, 10))
            }
            return { ok: true, statusCode: 200, body: JSON.stringify([{ path: reqPath, conv: activeConv }]) }
          },
        },
      },
    })
    const proxiedSdk = createDeduplicatedLookerSdkProxy(rawSdk)

    let stepA = 0
    let stepB = 0
    const makeConvExtension = (convKey: 'A' | 'B') => ({
      serverProxy: async () => {
        if (convKey === 'A') {
          stepA += 1
          if (stepA === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_224_A1',
                environment_id: 'env_shared_224',
                status: 'requires_action',
                steps: [
                  {
                    id: 'call_224_A',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({
                      code: 'a = all_folders()\nb = folder("1")\nreturn {"count": len(a)}',
                    }),
                  },
                ],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_224_A2',
              environment_id: 'env_shared_224',
              status: 'completed',
              output_text: '<USE_CASE>tile</USE_CASE>\nConv A finished folders lookup.',
            }),
          }
        }
        stepB += 1
        if (stepB === 1) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_224_B1',
              environment_id: 'env_shared_224',
              status: 'requires_action',
              steps: [
                {
                  id: 'call_224_B',
                  type: 'function_call',
                  name: 'run_looker_codemode',
                  arguments: JSON.stringify({
                    code: 'm = all_lookml_models()\nu = me()\nreturn {"models": len(m)}',
                  }),
                },
              ],
            }),
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_224_B2',
            environment_id: 'env_shared_224',
            status: 'completed',
            output_text: '<USE_CASE>tile</USE_CASE>\nConv B finished models lookup.',
          }),
        }
      },
    })

    const wrapScopeTracker = enqueueCodeModeExecution(async () => {
      concurrentInFlightScopes += 1
      maxConcurrentScopes = Math.max(maxConcurrentScopes, concurrentInFlightScopes)
      await new Promise((r) => setTimeout(r, 5))
      concurrentInFlightScopes -= 1
    })

    const [resA, resB] = await Promise.all([
      runAntigravityTurn({
        sdk: proxiedSdk,
        extensionSDK: makeConvExtension('A'),
        userId: '1',
        environmentId: 'env_shared_224',
        conversationId: 'conv_224_A',
        auth: { mode: 'apikey', apiKey: 'k', oauthToken: '', clientId: '', projectId: '' },
        session: { environmentId: 'env_shared_224', lastInteractionId: 'int_prev_A' },
        selectedExplores: [],
        schemaMarkdown: '',
        userPrompt: 'Check folders in Conv A',
        requirePermission: false,
        onStatus: () => {},
      }),
      runAntigravityTurn({
        sdk: proxiedSdk,
        extensionSDK: makeConvExtension('B'),
        userId: '1',
        environmentId: 'env_shared_224',
        conversationId: 'conv_224_B',
        auth: { mode: 'apikey', apiKey: 'k', oauthToken: '', clientId: '', projectId: '' },
        session: { environmentId: 'env_shared_224', lastInteractionId: 'int_prev_B' },
        selectedExplores: [],
        schemaMarkdown: '',
        userPrompt: 'Check models in Conv B',
        requirePermission: false,
        onStatus: () => {},
      }),
      wrapScopeTracker,
    ])

    expect(maxConcurrentScopes).toBe(1)
    expect(resA.assistantText).toContain('Conv A finished folders lookup.')
    expect(resB.assistantText).toContain('Conv B finished models lookup.')

    const recorded = (gCalls.lkr_codemode_api_calls || []).filter((c) => c.codemode)
    const callsA = recorded.filter((c) => c.conversation_id === 'conv_224_A')
    const callsB = recorded.filter((c) => c.conversation_id === 'conv_224_B')
    expect(callsA.length).toBeGreaterThanOrEqual(2)
    expect(callsB.length).toBeGreaterThanOrEqual(2)
    expect(callsA.every((c) => String(c.route || '').includes('/folders'))).toBe(true)
    expect(callsB.every((c) => String(c.route || '').includes('/lookml_models') || String(c.route || '').includes('/user'))).toBe(true)

    // 3. yieldCodeModeExecution: Safe Mode approval prompt in Conv A temporarily releases mutex so Conv B read-only Code Mode completes immediately
    let resolvePermA!: (d: 'allow_once') => void
    const permGateReady = new Promise<void>((resolveReady) => {
      void LkrCodeMode.runPythonCode({
        code: 'return create_folder({"name": "Yielded Folder", "parent_id": "1"})',
        sdk: proxiedSdk,
        conversationId: 'conv_yield_A',
        requirePermission: true,
        onPermissionRequest: async () => {
          resolveReady()
          return new Promise<'allow_once'>((r) => { resolvePermA = r })
        },
      }).then((out) => { order.push(`permA:${out.includes('/folders') ? 'ok' : 'done'}`) })
    })
    await permGateReady
    const readOutB = await LkrCodeMode.runPythonCode({
      code: 'return me()',
      sdk: proxiedSdk,
      conversationId: 'conv_yield_B',
      requirePermission: true,
      onPermissionRequest: async () => 'deny',
    })
    expect(readOutB).toContain('conv_yield_B')
    resolvePermA('allow_once')
    await new Promise((r) => setTimeout(r, 45))
    expect(order.some((x) => x.startsWith('permA:'))).toBe(true)
  })

  test('90. Issue #224: resumes requires_action turns + publishes <DATA_APP_BUNDLE>, refreshes OAuth tokens live across polls, survives hidden-tab poll errors, and merges concurrent ArtifactService.saveConversation writes', async () => {
    // 1. Multi-ID session storage helpers + backwards-compatible single-ID wrappers
    const gWin = globalThis as unknown as { window?: { sessionStorage?: Storage } }
    const origWin = gWin.window
    const memStore: Record<string, string> = {}
    gWin.window = {
      sessionStorage: {
        getItem: (k: string) => (k in memStore ? memStore[k] : null),
        setItem: (k: string, v: string) => { memStore[k] = String(v) },
        removeItem: (k: string) => { delete memStore[k] },
      } as unknown as Storage,
    }
    try {
      clearInFlightConvId()
      expect(readInFlightConvIds()).toEqual([])
      expect(readInFlightConvId()).toBeNull()

      gWin.window.sessionStorage!.setItem(STUDIO_INFLIGHT_CONV_SESSION_KEY, 'conv_legacy_single')
      expect(readInFlightConvIds()).toEqual(['conv_legacy_single'])
      expect(readInFlightConvId()).toBe('conv_legacy_single')

      saveInFlightConvId('conv_bg_1')
      addInFlightConvId('conv_bg_2')
      expect(readInFlightConvIds()).toContain('conv_bg_1')
      expect(readInFlightConvIds()).toContain('conv_bg_2')
      expect(readInFlightConvId()).toBe('conv_bg_2')
      removeInFlightConvId('conv_bg_1')
      expect(readInFlightConvIds()).not.toContain('conv_bg_1')
      expect(readInFlightConvIds()).toContain('conv_bg_2')
      clearInFlightConvId('conv_bg_2')
      expect(readInFlightConvIds()).not.toContain('conv_bg_2')
      clearInFlightConvId()
      expect(readInFlightConvIds()).toEqual([])
    } finally {
      if (origWin === undefined) delete gWin.window
      else gWin.window = origWin
    }

    // 2. Concurrent ArtifactService.saveConversation across Conv A & Conv B never clobbers sibling conversations
    clearArtifactServiceCache()
    let releaseFirstConvPut: (() => void) | null = null
    let convPutCount = 0
    const persistedArtifactStore: Record<string, string> = {}

    const mockPublishAndConvSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async (_ns: string, params: { key: string }) => {
        const val = persistedArtifactStore[params.key]
        return val ? [{ key: params.key, value: val, version: 1 }] : []
      },
      search_artifacts: async () => [],
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) {
          if (u.key.startsWith('user_conversations:')) {
            convPutCount += 1
            if (convPutCount === 1) {
              await new Promise<void>((r) => { releaseFirstConvPut = r })
            }
          }
          persistedArtifactStore[u.key] = u.value
        }
        return updates.map((u, idx) => ({ key: u.key, version: idx + 1 }))
      },
      create_dashboard: async (body: { title?: string; folder_id?: string }) => ({
        id: '2240',
        title: body.title || 'Order Pulse 224',
        folder_id: body.folder_id || '1',
      }),
      dashboard: async () => ({
        id: '2240',
        title: 'Order Pulse 224',
        folder_id: '1',
        dashboard_elements: [],
        dashboard_layouts: [{ id: 'lay_2240', active: true, dashboard_layout_components: [] }],
      }),
      create_dashboard_element: async () => ({ id: 'el_2240' }),
      update_dashboard_element: async () => ({ id: 'el_2240' }),
      update_dashboard: async () => ({ id: '2240' }),
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string) => {
            const m = String(method || 'GET').toUpperCase()
            const bodyObj = reqPath.includes('/data_app_extension')
              ? { id: 'db::ext_2240' }
              : m === 'POST' && reqPath === '/dashboards'
              ? { id: '2240', title: 'Order Pulse 224', folder_id: '1' }
              : m === 'POST' && reqPath === '/dashboard_elements'
              ? { id: 'el_2240' }
              : reqPath.startsWith('/dashboard_layouts/')
              ? { id: 'lay_2240' }
              : [{ orders: 42 }]
            return { ok: true, statusCode: 200, body: JSON.stringify(bodyObj) }
          },
        },
      },
    })

    const svc = getArtifactService(mockPublishAndConvSdk)
    await svc.listConversations('1')
    const saveA = svc.saveConversation('1', {
      id: 'conv_concurrent_A',
      type: 'app',
      label: 'Conv A',
      messages: [{ role: 'user', text: 'Prompt A' }, { role: 'assistant', text: 'Reply A' }],
      updatedAt: '2026-11-18T01:00:00.000Z',
    })
    while (!releaseFirstConvPut) {
      await new Promise((r) => setTimeout(r, 5))
    }
    const saveB = svc.saveConversation('1', {
      id: 'conv_concurrent_B',
      type: 'dashboard',
      label: 'Conv B',
      messages: [{ role: 'user', text: 'Prompt B' }, { role: 'assistant', text: 'Reply B' }],
      updatedAt: '2026-11-18T01:00:01.000Z',
    })
    releaseFirstConvPut()
    await Promise.all([saveA, saveB])
    const finalStoredList = JSON.parse(persistedArtifactStore['user_conversations:1'] || '[]') as Array<{ id: string }>
    expect(finalStoredList.map((c) => c.id)).toEqual(expect.arrayContaining(['conv_concurrent_A', 'conv_concurrent_B']))

    // Deleted conversation tombstone prevents stale background saveConversation from resurrecting a deleted thread
    await svc.deleteConversation('1', 'conv_concurrent_A')
    expect(svc.isConversationDeleted('1', 'conv_concurrent_A')).toBe(true)
    const afterLateSave = await svc.saveConversation('1', {
      id: 'conv_concurrent_A',
      type: 'app',
      label: 'Stale Background Turn A',
      messages: [{ role: 'user', text: 'Prompt A' }, { role: 'assistant', text: 'Late reply' }],
      updatedAt: '2026-11-18T02:00:00.000Z',
    })
    expect(afterLateSave.some((c) => c.id === 'conv_concurrent_A')).toBe(false)

    // 3. Same-tab concurrent OAuth refresh deduplication + hidden-tab 401 non-wipe + resumeInFlightConversationTurn
    const gEnv = globalThis as unknown as {
      fetch?: typeof fetch
      document?: {
        visibilityState: 'visible' | 'hidden'
        addEventListener: (ev: string, cb: () => void) => void
        removeEventListener: (ev: string, cb: () => void) => void
      }
      window?: { localStorage?: Storage; location?: { origin: string; pathname: string } }
    }
    const origFetch = gEnv.fetch
    const origDoc = gEnv.document
    const origWin2 = gEnv.window
    const localMem: Record<string, string> = {
      [STUDIO_OAUTH_STORAGE_KEY]: JSON.stringify({
        token: 'stored-valid-token',
        clientId: 'cid-224',
        expiresAt: Date.now() + 600_000,
      }),
    }
    const docListeners: Record<string, Array<() => void>> = {}
    let mockVisibility: 'visible' | 'hidden' = 'visible'
    const mockDoc = {
      get visibilityState() {
        return mockVisibility
      },
      addEventListener: (ev: string, cb: () => void) => {
        ;(docListeners[ev] || (docListeners[ev] = [])).push(cb)
      },
      removeEventListener: (ev: string, cb: () => void) => {
        docListeners[ev] = (docListeners[ev] || []).filter((fn) => fn !== cb)
      },
    }
    gEnv.document = mockDoc
    gEnv.window = {
      location: { origin: 'https://looker.example.com', pathname: '/extensions/dab' },
      localStorage: {
        getItem: (k: string) => (k in localMem ? localMem[k] : null),
        setItem: (k: string, v: string) => { localMem[k] = String(v) },
        removeItem: (k: string) => { delete localMem[k] },
      } as unknown as Storage,
    }

    try {
      // 3a. Concurrent same-tab force refreshes share a single oauth2Authenticate popup call
      let oauthPopupCalls = 0
      const oauthExt = {
        lookerHostData: { hostUrl: 'https://looker.example.com' },
        oauth2Authenticate: async () => {
          oauthPopupCalls += 1
          await new Promise((r) => setTimeout(r, 15))
          return { access_token: 'deduped-tok-224', expires_in: 3600 }
        },
      }
      const [r1, r2] = await Promise.all([
        refreshOAuthSessionIfNeeded({ extensionSDK: oauthExt, clientId: 'cid-224', tabId: 'tab_same', force: true }),
        refreshOAuthSessionIfNeeded({ extensionSDK: oauthExt, clientId: 'cid-224', tabId: 'tab_same', force: true }),
      ])
      expect(oauthPopupCalls).toBe(1)
      expect(r1?.token).toBe('deduped-tok-224')
      expect(r2?.token).toBe('deduped-tok-224')

      // 3b. Hidden-tab 401 waits for visibilitychange instead of wiping STUDIO_OAUTH_STORAGE_KEY
      let hidden401Calls = 0
      mockVisibility = 'hidden'
      gEnv.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        hidden401Calls += 1
        if (hidden401Calls === 1) {
          return new Response('{"error":"UNAUTHENTICATED"}', { status: 401 })
        }
        const hdrs = (init?.headers || {}) as Record<string, string>
        expect(hdrs.Authorization).toBe('Bearer visible-recovered-tok')
        return new Response(JSON.stringify({ id: 'int_vis_ok', status: 'completed' }), { status: 200 })
      }) as typeof fetch

      let hiddenToken = 'stale-hidden-tok'
      const hiddenCallPromise = callInteractionsApi(
        undefined,
        {
          mode: 'oauth',
          oauthToken: hiddenToken,
          getOAuthToken: () => hiddenToken,
          clientId: 'cid-224',
          projectId: 'proj-224',
          apiKey: '',
          onUnauthorizedRefresh: async () => {
            if (mockDoc.visibilityState === 'hidden') return null
            hiddenToken = 'visible-recovered-tok'
            return hiddenToken
          },
        },
        'interactions/int_vis_ok',
        'GET'
      )
      await new Promise((r) => setTimeout(r, 10))
      expect(localMem[STUDIO_OAUTH_STORAGE_KEY]).toBeDefined()
      mockVisibility = 'visible'
      ;(docListeners.visibilitychange || []).slice().forEach((fn) => fn())
      const hiddenRes = await hiddenCallPromise
      expect(hiddenRes.id).toBe('int_vis_ok')

      // 3c. resumeInFlightConversationTurn: requires_action -> run_looker_codemode -> live OAuth 401 refresh -> 8 hidden-tab network poll errors -> Safe Mode <DATA_APP_BUNDLE> publish
      let liveToken = 'expired-oauth-224'
      let refreshCount = 0
      const seenAuthHeaders: string[] = []
      const seenPermOps: string[] = []
      const postedContinuationBodies: Array<Record<string, unknown>> = []
      let restCallIdx = 0

      gEnv.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        // SSE stream probe returns 404 so executeAntigravityPollingLoop exercises REST polling deterministically
        if (url.includes(':stream') || url.includes('alt=sse')) {
          return new Response('not found', { status: 404 })
        }
        restCallIdx += 1
        const hdrs = (init?.headers || {}) as Record<string, string>
        const authHeader = String(hdrs.Authorization || '')
        seenAuthHeaders.push(authHeader)
        const method = String(init?.method || 'GET').toUpperCase()

        // Call 1: initial GET /interactions/int_224_req_act returns requires_action
        if (restCallIdx === 1) {
          expect(method).toBe('GET')
          expect(url).toContain('/interactions/int_224_req_act')
          return new Response(
            JSON.stringify({
              id: 'int_224_req_act',
              environment_id: 'env_224',
              status: 'requires_action',
              steps: [
                {
                  id: 'call_resume_cm',
                  type: 'function_call',
                  name: 'run_looker_codemode',
                  arguments: JSON.stringify({ code: 'return all_lookml_models()' }),
                },
              ],
            }),
            { status: 200 }
          )
        }

        // Call 2: POST tool continuation returns 401 on expired token -> triggers onUnauthorizedRefresh -> Call 3 retries with refreshed token!
        if (restCallIdx === 2) {
          expect(method).toBe('POST')
          return new Response('{"error":"UNAUTHENTICATED"}', { status: 401 })
        }
        if (restCallIdx === 3) {
          expect(method).toBe('POST')
          expect(authHeader).toBe('Bearer refreshed-oauth-224')
          postedContinuationBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
          mockVisibility = 'hidden'
          return new Response(
            JSON.stringify({ id: 'int_224_cont_1', environment_id: 'env_224', status: 'in_progress' }),
            { status: 200 }
          )
        }

        // Calls 4..11 (8 polls while tab is hidden!): transient network errors must NOT trip the 6-attempt transient failure cap
        if (restCallIdx >= 4 && restCallIdx <= 11) {
          if (restCallIdx === 11) mockVisibility = 'visible'
          throw new TypeError('Failed to fetch while tab backgrounded')
        }

        // Call 12: visible tab poll completes with <DATA_APP_BUNDLE>
        return new Response(
          JSON.stringify({
            id: 'int_224_cont_1',
            environment_id: 'env_224',
            status: 'completed',
            output_text:
              '<USE_CASE>app</USE_CASE>\nBuilt Order Pulse 224.\n<DATA_APP_BUNDLE>{"title":"Order Pulse 224","raw_code":"export default class App {}","widgets":[{"id":"w1","title":"Orders","query":{"model":"thelook","view":"orders","fields":["orders.count"]}}]}</DATA_APP_BUNDLE>',
          }),
          { status: 200 }
        )
      }) as typeof fetch

      const resumed = await resumeInFlightConversationTurn({
        sdk: mockPublishAndConvSdk,
        userId: '1',
        auth: {
          mode: 'oauth',
          oauthToken: liveToken,
          getOAuthToken: () => liveToken,
          clientId: 'cid-224',
          projectId: 'proj-224',
          apiKey: '',
          onUnauthorizedRefresh: async () => {
            refreshCount += 1
            liveToken = 'refreshed-oauth-224'
            return liveToken
          },
        },
        conv: {
          id: 'conv_224_resume',
          type: 'app',
          use_case: 'app',
          label: 'Order Pulse 224',
          interactionId: 'int_224_req_act',
          environmentId: 'env_224',
          messages: [{ role: 'user', text: 'Build Order Pulse 224' }],
          updatedAt: '2026-11-18T01:05:00.000Z',
        },
        requirePermission: true,
        onPermissionRequest: async (req) => {
          seenPermOps.push(req.operation)
          return 'allow_once'
        },
        pollScheduleMs: [1, 1, 1],
      })

      expect(refreshCount).toBe(1)
      expect(seenPermOps).toContain('create_dashboard')
      expect(seenAuthHeaders.slice(2).every((h) => h === 'Bearer refreshed-oauth-224')).toBe(true)
      const contTools = (postedContinuationBodies[0]?.tools as Array<{ name?: string; type?: string }>) || []
      expect(contTools.some((t) => t.name === 'run_looker_codemode')).toBe(true)
      expect(contTools.some((t) => t.type === 'code_execution')).toBe(true)

      expect(resumed.publishedApp?.dashboardId).toBe('2240')
      expect(resumed.conversation.interactionId).toBe('int_224_cont_1')
      expect(resumed.conversation.messages).toHaveLength(2)
      expect(resumed.conversation.messages?.[1]?.text).toContain('**Looker Dashboard:** [Open Order Pulse 224](/dashboards/2240)')
      expect(resumed.conversation.contentItems?.some((it) => it.id === '2240' && it.contentType === 'data_app')).toBe(true)
      expect(readInFlightConvIds()).not.toContain('conv_224_resume')
    } finally {
      if (origFetch === undefined) delete gEnv.fetch
      else gEnv.fetch = origFetch
      if (origDoc === undefined) delete gEnv.document
      else gEnv.document = origDoc
      if (origWin2 === undefined) delete gEnv.window
      else gEnv.window = origWin2
    }
  })

  test('91. Issue #224: aborting a yielded Safe Mode turn preserves sibling enqueueCodeModeExecution lock & conversation_id scope, excludes /artifacts from codemode telemetry, and sets cold-cache deleteConversation tombstones synchronously', async () => {
    const abortA = new AbortController()
    const order: string[] = []
    let releasePermA!: (v: string) => void
    let releaseWorkB!: () => void
    const runA = enqueueCodeModeExecution(
      () =>
        withCodeModeApiScope(async () => {
          order.push(`A:start:${getActiveCodeModeConversationId()}`)
          await yieldCodeModeExecution(
            () => new Promise<string>((r) => { releasePermA = r }),
            abortA.signal,
            suspendCodeModeApiScope
          )
          order.push('A:resumed')
        }, 'conv_yield_A'),
      abortA.signal
    )
    await new Promise((r) => setTimeout(r, 15))
    const runB = enqueueCodeModeExecution(
      () =>
        withCodeModeApiScope(async () => {
          order.push(`B:start:${getActiveCodeModeConversationId()}`)
          await new Promise<void>((r) => { releaseWorkB = r })
          order.push(`B:end:${getActiveCodeModeConversationId()}`)
        }, 'conv_active_B')
    )
    await new Promise((r) => setTimeout(r, 15))
    let enteredCWhileBRunning = false
    let bFinished = false
    const runC = enqueueCodeModeExecution(() => {
      if (!bFinished) enteredCWhileBRunning = true
      order.push('C:run')
      return Promise.resolve('ok')
    })

    // Abort A while A is yielded and B actively holds the mutex + scope
    abortA.abort()
    releasePermA('deny')
    await expect(runA).rejects.toThrow(/aborted/i)
    await new Promise((r) => setTimeout(r, 15))
    expect(enteredCWhileBRunning).toBe(false)
    expect(getActiveCodeModeConversationId()).toBe('conv_active_B')
    bFinished = true
    releaseWorkB()
    await Promise.all([runB, runC])
    expect(order).toEqual(['A:start:conv_yield_A', 'B:start:conv_active_B', 'B:end:conv_active_B', 'C:run'])

    // Verify cold-cache deleteConversation sets synchronous tombstone before cold GET resolves
    clearArtifactServiceCache()
    let releaseColdGet!: () => void
    const coldSdk = asSdk({
      ok: async <T>(p: Promise<T>) => p,
      artifact: async () => {
        await new Promise<void>((r) => { releaseColdGet = r })
        return [{ key: 'user_conversations:9', version: 1, value: JSON.stringify([{ id: 'conv_cold_del', type: 'app', label: 'Cold', updatedAt: '2026-11-18T00:00:00Z' }]) }]
      },
      update_artifacts: async () => [{ key: 'user_conversations:9', version: 2 }],
      purge_artifacts: async () => [],
    })
    const svc = getArtifactService(coldSdk, 'ns_cold_224')
    const delPromise = svc.deleteConversation('9', 'conv_cold_del')
    expect(svc.isConversationDeleted('9', 'conv_cold_del')).toBe(true)
    while (!releaseColdGet) await new Promise((r) => setTimeout(r, 5))
    releaseColdGet()
    await delPromise
  })
}
