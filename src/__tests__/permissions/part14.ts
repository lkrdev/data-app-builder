import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ChattyClient } from '@looker/chatty'
import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  BOOTSTRAP_LOOKML_PY, BOOTSTRAP_SANDBOX_SH, hydrateInteractionActivitySteps, LKR_CLI_SITECUSTOMIZE_PY,
  LKR_DEV_CLI_VERSION, LkrCodeMode, mergeInteractionSseEvent, runAntigravityTurn,
  streamInteractionUntilActionOrDone,
} from '../../antigravity'
import {
  buildCodeModeApiCallEntry, clearLookerMetadataCache, ConversationRecord, createDeduplicatedLookerSdkProxy,
  getConvTargetId, hookChattyHostApiLogger, installChattyApiLogger, isLookmlTargetAlreadyLoaded,
  isTransportChattyHooked, LkrCodeModeApiCallEntry, rawLookerRequest,
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

export function registerPermissionsPart14Tests(): void {
  test('71. Issue #171: type-scoped getConvTargetId on multi-artifact conversations, status="incomplete" auto-continuation in runAntigravityTurn, and /workspace/.uv_tools hibernation recovery', async () => {
    // 1. Type-scoped getConvTargetId & isLookmlTargetAlreadyLoaded prevent cross-mode dashboardId ("35") collisions
    const mixedContent: ConversationRecord['content'] = {
      dashboardId: '35',
      lookId: '88',
      lookmlDashboardId: 'thelook::pulse',
      reportId: 'hc_99',
      projectId: 'thelook_proj',
      sessionId: 'thelook_sess',
      scriptId: 'script_7',
      caConversationId: 'ca_12',
      id: 'generic_id',
    }
    expect(getConvTargetId(mixedContent, 'lookml')).toBe('thelook_proj')
    expect(getConvTargetId(mixedContent, 'LOOKML')).toBe('thelook_proj')
    expect(getConvTargetId({ dashboardId: '35', sessionId: 'legacy_sess' }, 'lookml')).toBe('legacy_sess')
    expect(getConvTargetId({ dashboardId: '35', id: '35' }, 'lookml')).toBe('')
    expect(getConvTargetId(mixedContent, 'health')).toBe('hc_99')
    expect(getConvTargetId(mixedContent, 'health-check')).toBe('hc_99')
    expect(getConvTargetId(mixedContent, 'health_check')).toBe('hc_99')
    expect(getConvTargetId({ dashboardId: '35' }, 'health-check')).toBe('')
    expect(getConvTargetId(mixedContent, 'tile')).toBe('script_7')
    expect(getConvTargetId(mixedContent, 'script')).toBe('script_7')
    expect(getConvTargetId(mixedContent, 'conversational-analytics')).toBe('ca_12')
    expect(getConvTargetId(mixedContent, 'ca')).toBe('ca_12')
    expect(getConvTargetId({ ...mixedContent, contentType: 'look' }, 'dashboard')).toBe('88')
    expect(getConvTargetId({ ...mixedContent, contentType: 'lookml_dashboard' }, 'dashboard')).toBe('thelook::pulse')
    expect(getConvTargetId({ ...mixedContent, contentType: 'dashboard' }, 'dashboard')).toBe('35')
    expect(getConvTargetId({ lookmlDashboardId: 'thelook::pulse', lookId: '88' }, 'dashboard')).toBe('thelook::pulse')
    expect(getConvTargetId(mixedContent, 'app')).toBe('35')
    expect(getConvTargetId(mixedContent, 'data_app')).toBe('35')
    expect(getConvTargetId(mixedContent, 'data-investigator')).toBe('35')
    expect(getConvTargetId(mixedContent, 'data_investigator')).toBe('35')
    expect(getConvTargetId({ projectId: 'only_proj' }, 'auto')).toBe('only_proj')
    expect(getConvTargetId({ sessionId: 'only_sess' }, undefined)).toBe('only_sess')
    expect(getConvTargetId(mixedContent, 'unknown_mode')).toBe('')
    expect(getConvTargetId(undefined, 'lookml')).toBe('')

    expect(isLookmlTargetAlreadyLoaded('lookml', 'thelook_proj', null, undefined)).toBe(false)
    expect(isLookmlTargetAlreadyLoaded('app', 'thelook_proj', { id: 'thelook_proj', project_id: 'thelook_proj' })).toBe(false)
    expect(isLookmlTargetAlreadyLoaded('lookml', 'thelook_proj', { id: 'sess_1', project_id: 'thelook_proj' })).toBe(true)
    expect(isLookmlTargetAlreadyLoaded('lookml', 'thelook_proj', { id: 'legacy_sess', project_id: '' }, 'legacy_sess')).toBe(true)
    expect(isLookmlTargetAlreadyLoaded('lookml', 'thelook_1762800000', { id: 'thelook', project_id: 'thelook' })).toBe(true)

    // 2. Auto-continue status: "incomplete" (outputs: null) in runAntigravityTurn with step/token accumulation, warm LookML directive & < 2 cap
    const resumePosts: MockInteractionPostBody[] = []
    const resumeStatuses: string[] = []
    const createdIds: string[] = []
    const mockIncompleteSdk = asSdk({ ok: async <T>(p: T) => p })
    const resumeTurn = await runAntigravityTurn({
      sdk: mockIncompleteSdk,
      extensionSDK: {
        serverProxy: async (_url: string, init?: FetchCustomParameters) => {
          const b = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
          resumePosts.push(b)
          if (resumePosts.length === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_171_inc1',
                environment_id: 'env_171_idle',
                status: 'incomplete',
                outputs: null,
                usage: { input_tokens: 120, output_tokens: 15, thought_tokens: 30 },
                steps: [{ id: 'vf_1', type: 'view_file', path: '/workspace/AGENTS.md', content: '# Agents' }],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_171_done',
              environment_id: 'env_171_idle',
              previous_interaction_id: 'int_171_inc1',
              status: 'completed',
              output_text: '<USE_CASE>lookml</USE_CASE>\nCompleted field curation on `thelook_proj`.',
              usage: { input_tokens: 200, output_tokens: 45, thought_tokens: 20 },
              steps: [{ id: 'ce_2', type: 'code_execution', command: 'lkr --version', stdout: '0.0.69' }],
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_171_idle', lastInteractionId: 'int_171_prev', toolType: 'lookml' },
      useCase: 'lookml',
      selectedExplores: [],
      existingAppCode: 'export class PriorApp35 {}',
      userPrompt: '/lookml-field-curation curate order_items',
      schemaMarkdown: '# Schema',
      onStatus: (s) => resumeStatuses.push(s),
      onInteractionCreated: (id) => createdIds.push(id),
    })
    expect(resumePosts).toHaveLength(2)
    expect(resumePosts[0].input?.[0]?.text).toContain('[WARM LOOKML SANDBOX:')
    expect(resumePosts[0].input?.[0]?.text).not.toContain('[WARM SANDBOX FAST PATH:')
    expect(resumePosts[1]).toMatchObject({
      previous_interaction_id: 'int_171_inc1',
      environment: 'env_171_idle',
      input: [{ type: 'text', text: 'Continue and complete the current request.' }],
    })
    expect(resumeStatuses).toContain('Resuming incomplete turn...')
    expect(createdIds).toEqual(['int_171_inc1', 'int_171_done'])
    expect(resumeTurn.assistantText).toContain('Completed field curation on `thelook_proj`.')
    expect(resumeTurn.activitySteps?.map((s) => s.id)).toEqual(['vf_1', 'ce_2'])
    expect(resumeTurn.telemetry.tokens.input).toBe(320)
    expect(resumeTurn.telemetry.tokens.output).toBe(60)
    expect(resumeTurn.telemetry.tokens.thought).toBe(50)

    // OAuth SSE mergeInteractionSseEvent & streamInteractionUntilActionOrDone treat status="incomplete" as terminal (zero wasted reconnects)
    expect(
      mergeInteractionSseEvent({ id: 'int_sse_inc', status: 'in_progress' }, 'interaction.incomplete', {})
    ).toMatchObject({ id: 'int_sse_inc', status: 'incomplete' })
    let sseFetchCount = 0
    const sseIncRes = await streamInteractionUntilActionOrDone({
      auth: { mode: 'oauth', oauthToken: 'tok_sse_inc' },
      interactionId: 'int_sse_inc',
      maxReconnects: 2,
      fetchImpl: (async () => {
        sseFetchCount += 1
        const payload = 'id: evt_1\nevent: interaction.incomplete\ndata: {"id":"int_sse_inc","status":"incomplete"}\n\n'
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => {
              let sent = false
              return {
                read: async () =>
                  sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: new TextEncoder().encode(payload) }),
                cancel: async () => {},
              }
            },
          },
        } as unknown as Response
      }) as typeof fetch,
    })
    expect(sseFetchCount).toBe(1)
    expect(sseIncRes.streamed).toBe(true)
    expect(sseIncRes.interaction?.status).toBe('incomplete')

    // Cap auto-continuation at incompleteRound < 2 (1 initial POST + 2 continuation POSTs = 3 total)
    let capPostCount = 0
    const cappedTurn = await runAntigravityTurn({
      sdk: mockIncompleteSdk,
      extensionSDK: {
        serverProxy: async () => {
          capPostCount += 1
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: `int_cap_${capPostCount}`,
              environment_id: 'env_171_idle',
              status: 'incomplete',
              outputs: null,
              steps: [{ id: `s_${capPostCount}`, type: 'thought', thought: `Thinking ${capPostCount}` }],
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_171_idle', lastInteractionId: 'int_171_prev' },
      selectedExplores: [],
      userPrompt: 'Check cold resume cap',
      schemaMarkdown: '# Schema',
      onStatus: () => {},
    })
    expect(capPostCount).toBe(3)
    expect(cappedTurn.assistantText).toBe('Completed.')

    // Zero-step incomplete hop still preserves accumulated token usage across continuation
    let zeroStepCall = 0
    const zeroStepTurn = await runAntigravityTurn({
      sdk: mockIncompleteSdk,
      extensionSDK: {
        serverProxy: async () => {
          zeroStepCall += 1
          return {
            ok: true,
            status: 200,
            body: JSON.stringify(
              zeroStepCall === 1
                ? {
                    id: 'int_zero_inc',
                    environment_id: 'env_171_idle',
                    status: 'incomplete',
                    outputs: null,
                    steps: [],
                    usage: { input_tokens: 75, output_tokens: 5, thought_tokens: 10 },
                  }
                : {
                    id: 'int_zero_done',
                    environment_id: 'env_171_idle',
                    previous_interaction_id: 'int_zero_inc',
                    status: 'completed',
                    output_text: 'Recovered from zero-step wake timeout.',
                    steps: [],
                    usage: { input_tokens: 125, output_tokens: 25, thought_tokens: 15 },
                  }
            ),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_171_idle', lastInteractionId: 'int_171_prev' },
      selectedExplores: [],
      userPrompt: 'Check zero-step incomplete token merge',
      schemaMarkdown: '# Schema',
      onStatus: () => {},
    })
    expect(zeroStepTurn.telemetry.tokens).toMatchObject({ input: 200, output: 30, thought: 25 })

    // Do not auto-continue when status === 'incomplete' already emitted real output text
    let nonEmptyPostCount = 0
    const nonEmptyIncomplete = await runAntigravityTurn({
      sdk: mockIncompleteSdk,
      extensionSDK: {
        serverProxy: async () => {
          nonEmptyPostCount += 1
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_partial_text',
              environment_id: 'env_171_idle',
              status: 'incomplete',
              output_text: 'Partial answer already present.',
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      session: { environmentId: 'env_171_idle', lastInteractionId: 'int_171_prev' },
      selectedExplores: [],
      userPrompt: 'Check partial text guard',
      schemaMarkdown: '# Schema',
      onStatus: () => {},
    })
    expect(nonEmptyPostCount).toBe(1)
    expect(nonEmptyIncomplete.assistantText).toBe('Partial answer already present.')

    // hydrateInteractionActivitySteps walks across auto-continued incomplete hops when stopAtInteractionId is omitted
    const hydratedAcrossIncomplete = await hydrateInteractionActivitySteps({
      extensionSDK: {
        serverProxy: async (url: string) => {
          const hopId = decodeURIComponent(url.split('/interactions/')[1] || '')
          const payload =
            hopId === 'int_171_done'
              ? {
                  id: 'int_171_done',
                  previous_interaction_id: 'int_171_inc1',
                  status: 'completed',
                  input: [{ type: 'text', text: 'Continue and complete the current request.' }],
                  steps: [{ id: 'ce_2', type: 'code_execution', command: 'lkr --version', stdout: '0.0.69' }],
                }
              : {
                  id: 'int_171_inc1',
                  status: 'incomplete',
                  input: [{ type: 'text', text: 'Initial Turn 1 prompt' }],
                  steps: [{ id: 'vf_1', type: 'view_file', path: '/workspace/AGENTS.md', content: '# Agents' }],
                }
          return { ok: true, status: 200, body: JSON.stringify(payload) }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key' },
      interactionId: 'int_171_done',
    })
    expect(hydratedAcrossIncomplete.map((s) => s.id)).toEqual(['vf_1', 'ce_2'])

    // 3. Persist lkr-dev-cli under /workspace/.uv_tools + re-symlink /usr/local/bin/lkr after hibernation (Python + Shell + dangling shebang OSError fallback)
    expect(BOOTSTRAP_SANDBOX_SH).toContain(
      'UV_TOOL_DIR=/workspace/.uv_tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.69"'
    )
    expect(BOOTSTRAP_SANDBOX_SH).toContain('UV_PYTHON_INSTALL_DIR=/workspace/.uv_python')
    expect(BOOTSTRAP_SANDBOX_SH).toContain('ln -sf /workspace/.uv_tools/lkr-dev-cli/bin/lkr /usr/local/bin/lkr')
    expect(BOOTSTRAP_SANDBOX_SH).toContain('/workspace/.uv_tools/lkr-dev-cli/lib/python3.*/site-packages')
    expect(BOOTSTRAP_LOOKML_PY).toContain('"UV_TOOL_DIR": str(WORKSPACE_DIR / ".uv_tools")')
    expect(BOOTSTRAP_LOOKML_PY).toContain('"UV_TOOL_BIN_DIR": "/usr/local/bin"')

    const tmpWs = mkdtempSync(path.join(tmpdir(), 'dab-171-uv-'))
    try {
      const uvBinDir = path.join(tmpWs, '.uv_tools/lkr-dev-cli/bin')
      const uvSiteDir = path.join(tmpWs, '.uv_tools/lkr-dev-cli/lib/python3.12/site-packages')
      const targetBinDir = path.join(tmpWs, 'usr_local_bin')
      const bootstrapPath = path.join(tmpWs, 'bootstrap_lookml.py')
      const cmdLog = path.join(tmpWs, 'uv_calls.log')
      mkdirSync(uvBinDir, { recursive: true })
      mkdirSync(uvSiteDir, { recursive: true })
      mkdirSync(targetBinDir, { recursive: true })
      writeFileSync(bootstrapPath, BOOTSTRAP_LOOKML_PY, { mode: 0o755 })
      writeFileSync(path.join(tmpWs, 'sitecustomize.py'), LKR_CLI_SITECUSTOMIZE_PY, 'utf8')
      writeFileSync(path.join(uvBinDir, 'lkr'), `#!/bin/sh\necho "lkr, version ${LKR_DEV_CLI_VERSION}"\n`, { mode: 0o755 })

      // Hibernation recovery succeeds offline with zero uv/pip binaries on PATH when .uv_tools/lkr-dev-cli/bin/lkr is intact
      const out = JSON.parse(
        execFileSync('/usr/bin/python3', [bootstrapPath, 'cli'], {
          env: {
            PATH: `${targetBinDir}:/bin`,
            WORKSPACE_DIR: tmpWs,
            UV_TOOL_BIN_DIR: targetBinDir,
          },
          encoding: 'utf8',
        }).trim()
      ) as { ok: boolean; lkr: string; version: string }
      expect(out.ok).toBe(true)
      expect(out.version).toBe(LKR_DEV_CLI_VERSION)
      const recoveredLink = path.join(targetBinDir, 'lkr')
      expect(lstatSync(recoveredLink).isSymbolicLink()).toBe(true)
      expect(readlinkSync(recoveredLink)).toBe(path.join(uvBinDir, 'lkr'))
      expect(readFileSync(path.join(uvSiteDir, 'sitecustomize.py'), 'utf8')).toContain('<LKR_EXTENSION_TOOL_REQUEST>')

      // Verify BOOTSTRAP_SANDBOX_SH shell symlink recovery & sitecustomize copy in isolated temp paths without uv/pip
      rmSync(recoveredLink)
      rmSync(path.join(uvSiteDir, 'sitecustomize.py'))
      const rewrittenSh = BOOTSTRAP_SANDBOX_SH.split('/workspace')
        .join(tmpWs)
        .split('/usr/local/bin')
        .join(targetBinDir)
        .split('/usr/local/lib')
        .join(path.join(tmpWs, 'ro_local_lib'))
        .split('/usr/lib')
        .join(path.join(tmpWs, 'ro_usr_lib'))
      execFileSync('sh', ['-c', rewrittenSh], {
        env: { PATH: `${targetBinDir}:/bin:/usr/bin`, HOME: tmpWs },
        encoding: 'utf8',
      })
      expect(lstatSync(recoveredLink).isSymbolicLink()).toBe(true)
      expect(readFileSync(path.join(uvSiteDir, 'sitecustomize.py'), 'utf8')).toContain('<LKR_EXTENSION_TOOL_REQUEST>')

      // Verify broken-#! OSError on persisted_lkr falls back cleanly to uv tool install --force instead of crashing
      writeFileSync(path.join(targetBinDir, 'uv'), `#!/bin/sh\necho "uv $@" >> "${cmdLog}"\n`, { mode: 0o755 })
      rmSync(recoveredLink)
      writeFileSync(path.join(uvBinDir, 'lkr'), '#!/nonexistent/hibernated/python3\nimport sys\n', { mode: 0o755 })
      const fallbackOut = JSON.parse(
        execFileSync('/usr/bin/python3', [bootstrapPath, 'cli'], {
          env: {
            PATH: `${targetBinDir}:/usr/bin:/bin`,
            WORKSPACE_DIR: tmpWs,
            UV_TOOL_BIN_DIR: targetBinDir,
          },
          encoding: 'utf8',
        }).trim()
      ) as { ok: boolean }
      expect(fallbackOut.ok).toBe(true)
      expect(readFileSync(cmdLog, 'utf8')).toContain(`uv tool install --force --quiet lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION}`)
    } finally {
      rmSync(tmpWs, { recursive: true, force: true })
    }
  })

  test('72. Issue #178: hooks @looker/chatty RAW_INVOKE_CORE_SDK + INVOKE_CORE_SDK + errors into window.lkr_codemode_api_calls with query/body/response normalization and zero double-logging across non-Chatty fallbacks', async () => {
    const g = globalThis as unknown as {
      lkr_codemode_api_calls?: LkrCodeModeApiCallEntry[]
      window?: unknown
    }
    clearLookerMetadataCache()
    g.lkr_codemode_api_calls = []

    // 1. Direct buildCodeModeApiCallEntry normalization (query stripping, URLSearchParams + params merge, JSON parsing, null empty body)
    const normalizedRaw = buildCodeModeApiCallEntry({
      requestType: 'RAW_INVOKE_CORE_SDK',
      httpMethod: 'post',
      path: '/api/4.0/queries/run/json?limit=500&cache=true&filter_config=%7B%22region%22%3A%22West%22%7D',
      params: { fields: 'orders.id,orders.count', sorts: '["orders.count desc"]', apply_vis: 'false', folder_id: '502', ignored: undefined },
      body: '{"model":"thelook","view":"order_items"}',
      rawResp: { ok: true, statusCode: 200, body: '[{"orders.count":42}]' },
      timestamp: '2026-11-11T00:00:00.000Z',
      durationMs: 18.4,
    })
    expect(normalizedRaw).toEqual({
      method: 'POST',
      route: '/api/4.0/queries/run/json',
      query_params: {
        limit: '500',
        cache: true,
        filter_config: { region: 'West' },
        fields: 'orders.id,orders.count',
        sorts: ['orders.count desc'],
        apply_vis: false,
        folder_id: '502',
      },
      body: { model: 'thelook', view: 'order_items' },
      response: { ok: true, status: 200, body: [{ 'orders.count': 42 }] },
      timestamp: '2026-11-11T00:00:00.000Z',
      duration_ms: 18,
    })

    const normalizedEmptyBody = buildCodeModeApiCallEntry({
      httpMethod: 'GET',
      path: '/api/4.0/user',
      params: '{"fields":"id,display_name"}',
      body: '',
      rawResp: { ok: false, statusCode: 403, body: 'Forbidden' },
      timestamp: '2026-11-11T00:00:01.000Z',
      durationMs: 5,
    })
    expect(normalizedEmptyBody.body).toBeNull()
    expect(normalizedEmptyBody.query_params).toEqual({ fields: 'id,display_name' })
    expect(normalizedEmptyBody.response).toEqual({ ok: false, status: 403, body: 'Forbidden' })

    const normalizedZeroStatus = buildCodeModeApiCallEntry({
      requestType: 'INVOKE_CORE_SDK',
      httpMethod: 'GET',
      path: '/api/4.0/offline',
      rawResp: { ok: false, error: { message: 'Aborted', statusCode: 0 } },
    })
    expect(normalizedZeroStatus.response).toEqual({ ok: false, status: 500, body: { message: 'Aborted', statusCode: 0 } })
    expect(buildCodeModeApiCallEntry({ path: '/api/4.0/net', rawResp: { statusCode: 0, body: '' } }).response).toEqual({
      ok: false,
      status: 0,
      body: null,
    })

    // 2. Chatty host interception (RAW_INVOKE_CORE_SDK [envelope] array & direct object, INVOKE_CORE_SDK ok/error, rejected promise, non-SDK event passthrough, WeakSet idempotence)
    const mockChattyHost = {
      sendAndReceive: async (_eventName: string, req: { type: string; payload?: Record<string, unknown> }) => {
        if (req.type === 'LOCAL_STORAGE' || req.type === 'VERIFY_HOST') return ['stored_val']
        if (req.type === 'INVOKE_CORE_SDK') {
          if (req.payload?.path === '/api/4.0/denied') {
            return [{ ok: false, error: { message: 'Access denied', statusCode: 403 } }]
          }
          return [{ ok: true, value: { id: '7', title: 'Pulse' } }]
        }
        if (req.payload?.path === '/api/4.0/direct_obj') {
          return { ok: true, statusCode: 200, body: '{"direct":true}' }
        }
        if (req.payload?.path === '/api/4.0/timeout') {
          throw new Error('{"error":"Chatty Timeout"}')
        }
        return [{ ok: true, statusCode: 200, body: JSON.stringify({ ok: true, path: req.payload?.path }) }]
      },
    }
    const mockExtSdk = {
      chattyHost: mockChattyHost,
      invokeCoreSdkRaw: (httpMethod: string, reqPath: string, params?: unknown, body?: unknown) =>
        mockChattyHost
          .sendAndReceive('EXTENSION_API_REQUEST', {
            type: 'RAW_INVOKE_CORE_SDK',
            payload: { httpMethod, path: reqPath, params, body, apiVersion: '4.0' },
          })
          .then((vals) => (Array.isArray(vals) ? vals[0] : vals)),
    }

    // Wrap twice to prove WeakSet idempotence (must not log twice)
    hookChattyHostApiLogger(mockExtSdk)
    hookChattyHostApiLogger(mockChattyHost)

    expect(await mockChattyHost.sendAndReceive('EXTENSION_API_REQUEST', { type: 'LOCAL_STORAGE', payload: { type: 'get', name: 'k' } })).toEqual(['stored_val'])
    expect(await mockChattyHost.sendAndReceive('EXTENSION_API_REQUEST', { type: 'VERIFY_HOST' })).toEqual(['stored_val'])
    expect(await mockChattyHost.sendAndReceive('EXTENSION_NOTIFICATION', { type: 'RAW_INVOKE_CORE_SDK' })).toBeTruthy()
    expect(g.lkr_codemode_api_calls).toHaveLength(0)

    await mockChattyHost.sendAndReceive('EXTENSION_API_REQUEST', {
      type: 'INVOKE_CORE_SDK',
      payload: { httpMethod: 'GET', path: '/api/4.0/dashboards/7?fields=id,title' },
    })
    await mockChattyHost.sendAndReceive('EXTENSION_API_REQUEST', {
      type: 'INVOKE_CORE_SDK',
      payload: { httpMethod: 'DELETE', path: '/api/4.0/denied' },
    })
    await mockChattyHost.sendAndReceive('EXTENSION_API_REQUEST', {
      type: 'RAW_INVOKE_CORE_SDK',
      payload: { httpMethod: 'GET', path: '/api/4.0/direct_obj' },
    })
    await expect(
      mockChattyHost.sendAndReceive('EXTENSION_API_REQUEST', {
        type: 'RAW_INVOKE_CORE_SDK',
        payload: { httpMethod: 'POST', path: '/api/4.0/timeout', body: '{"q":1}' },
      })
    ).rejects.toThrow('Chatty Timeout')

    expect(g.lkr_codemode_api_calls).toHaveLength(4)
    expect(g.lkr_codemode_api_calls[0]).toMatchObject({
      method: 'GET',
      route: '/api/4.0/dashboards/7',
      query_params: { fields: 'id,title' },
      body: null,
      response: { ok: true, status: 200, body: { id: '7', title: 'Pulse' } },
    })
    expect(g.lkr_codemode_api_calls[1]).toMatchObject({
      method: 'DELETE',
      route: '/api/4.0/denied',
      response: { ok: false, status: 403, body: { message: 'Access denied', statusCode: 403 } },
    })
    expect(g.lkr_codemode_api_calls[2]).toMatchObject({
      method: 'GET',
      route: '/api/4.0/direct_obj',
      response: { ok: true, status: 200, body: { direct: true } },
    })
    expect(g.lkr_codemode_api_calls[3]).toMatchObject({
      method: 'POST',
      route: '/api/4.0/timeout',
      body: { q: 1 },
      response: { ok: false, status: null, body: { error: 'Chatty Timeout' } },
    })

    // 3. Zero double-logging when ExtensionTransport -> SdkConnection -> ExtensionHostApiImpl -> chattyHost is hooked AND wrapped in nested createDeduplicatedLookerSdkProxy + rawLookerRequest + LkrCodeMode
    g.lkr_codemode_api_calls = []
    const chattyBackedTransport = {
      hostConnection: {
        hostConnection: mockExtSdk,
        rawRequest: (m: string, p: string, b?: unknown, q?: unknown) => mockExtSdk.invokeCoreSdkRaw(m, p, q, b),
      },
      rawRequest: (m: string, p: string, q?: Record<string, unknown>, b?: unknown) =>
        mockExtSdk.invokeCoreSdkRaw(m, p, q, b) as Promise<{ ok: boolean; statusCode: number; body: string }>,
    }
    expect(isTransportChattyHooked(chattyBackedTransport)).toBe(true)
    const chattySdkL1 = createDeduplicatedLookerSdkProxy({ authSession: { transport: chattyBackedTransport } } as unknown as Looker40SDK)
    const chattySdkL2 = createDeduplicatedLookerSdkProxy(chattySdkL1)
    await rawLookerRequest(chattySdkL2, 'GET', '/api/4.0/folders/5?fields=id,name')
    await LkrCodeMode.runPythonCode({ code: 'return dashboard("42")', sdk: chattySdkL2 })
    expect(g.lkr_codemode_api_calls).toHaveLength(2)
    expect(g.lkr_codemode_api_calls.map((c) => [c.method, c.route, c.query_params])).toEqual([
      ['GET', '/api/4.0/folders/5', { fields: 'id,name' }],
      ['GET', '/dashboards/42', {}],
    ])

    // 4. Non-Chatty fallback (Node/Jest & mock SDKs): exact 1x logging across nested createDeduplicatedLookerSdkProxy, unproxied rawLookerRequest, and LkrCodeMode.runPythonCode
    clearLookerMetadataCache()
    g.lkr_codemode_api_calls = []
    const plainTransport = {
      rawRequest: async (method: string, reqPath: string, queryParams?: Record<string, unknown>, body?: unknown) => ({
        ok: true,
        statusCode: 200,
        body: JSON.stringify({ method, path: reqPath, queryParams, body }),
      }),
    }
    expect(isTransportChattyHooked(plainTransport)).toBe(false)
    const plainRawSdk = { authSession: { transport: plainTransport } } as unknown as Looker40SDK
    await rawLookerRequest(plainRawSdk, 'POST', '/api/4.0/dashboards?notify=false', { folder_id: '5' }, { title: 'Unproxied' })
    const proxiedL1 = createDeduplicatedLookerSdkProxy(plainRawSdk)
    const proxiedL2 = createDeduplicatedLookerSdkProxy(proxiedL1)
    await rawLookerRequest(proxiedL2, 'PATCH', '/api/4.0/dashboards/99', undefined, { title: 'Proxied Nested' })
    await LkrCodeMode.runPythonCode({ code: 'return me()', sdk: proxiedL2 })

    expect(g.lkr_codemode_api_calls).toHaveLength(3)
    expect(g.lkr_codemode_api_calls[0]).toMatchObject({
      method: 'POST',
      route: '/api/4.0/dashboards',
      query_params: { notify: false, folder_id: '5' },
      body: { title: 'Unproxied' },
      response: { ok: true, status: 200 },
    })
    expect(g.lkr_codemode_api_calls[1]).toMatchObject({
      method: 'PATCH',
      route: '/api/4.0/dashboards/99',
      body: { title: 'Proxied Nested' },
    })
    expect(g.lkr_codemode_api_calls[2]).toMatchObject({
      method: 'GET',
      route: '/user',
      query_params: {},
    })

    // 5. installChattyApiLogger safely no-ops when window is undefined and patches ChattyClient.prototype.connect when window is defined
    expect(() => installChattyApiLogger()).not.toThrow()
    const hadWindow = 'window' in g
    const prevWindow = g.window
    try {
      g.window = globalThis
      installChattyApiLogger()
      const fakeClient = Object.create(ChattyClient.prototype) as {
        _connection: Promise<unknown>
        connect: () => Promise<unknown>
      }
      const connectedHost = {
        sendAndReceive: async () => [{ ok: true, statusCode: 200, body: '{"connected":true}' }],
      }
      fakeClient._connection = Promise.resolve(connectedHost)
      await fakeClient.connect()
      g.lkr_codemode_api_calls = []
      await connectedHost.sendAndReceive('EXTENSION_API_REQUEST' as never, {
        type: 'RAW_INVOKE_CORE_SDK',
        payload: { httpMethod: 'GET', path: '/api/4.0/session' },
      } as never)
      expect(g.lkr_codemode_api_calls).toHaveLength(1)
      expect(g.lkr_codemode_api_calls[0]).toMatchObject({
        method: 'GET',
        route: '/api/4.0/session',
        response: { ok: true, status: 200, body: { connected: true } },
      })
    } finally {
      if (hadWindow) g.window = prevWindow
      else delete g.window
    }

    // Source-level checks for StudioHeader (/config subtitle & folder-popover-open-target-btn) and index.tsx
    const rootDir = path.resolve(__dirname, '../../..')
    const headerSrc = readFileSync(path.join(rootDir, 'src/components/StudioHeader.tsx'), 'utf8')
    const indexSrc = readFileSync(path.join(rootDir, 'src/index.tsx'), 'utf8')
    expect(headerSrc).not.toContain('extensionSDK.saveContextData')
    expect(headerSrc).toContain('Configure extension-wide authentication')
    expect(headerSrc).toContain('testId="folder-popover-open-target-btn"')
    expect(headerSrc).toContain('disabled={!selectedFolderId}')
    expect(indexSrc).toContain('installChattyApiLogger()')
    expect(indexSrc).toContain('window.lkr_codemode_api_calls')
  })

}
