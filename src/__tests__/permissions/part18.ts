import type { Looker40SDK } from '@looker/sdk'

import {
  classifyLookerOperation, DASHBOARD_CODEMODE_PREAMBLE_PY, ensureCodeModeLoaded, executeLkrExtensionToolRequest,
  LKR_CLI_SITECUSTOMIZE_PY, LkrCodeMode, wrapDashboardCodeMode,
} from '../../antigravity'
import { createDeduplicatedLookerSdkProxy, hookChattyHostApiLogger } from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart18Tests(): void {
  test('80. Issue #190: enforces Safe Mode (Ask) across unpatched CDN codemode.js + extensionSDK.invokeCoreSdkRaw/invokeCoreSdk, classifies HTTP (method, path) before DASHBOARD_CODEMODE_PREAMBLE_PY code fallback, treats PATCH /session as read-only, and gates host-side Data App publishing with per-turn approval resets', async () => {
    // 1. Deterministic HTTP (method, path) classification before Python code fallback + PATCH /session read-only
    expect(classifyLookerOperation('PATCH', '/session')).toEqual({
      operation: 'read_session',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('PATCH', '/api/4.0/session')).toEqual({
      operation: 'read_session',
      requiresPermission: false,
    })
    // Even when DASHBOARD_CODEMODE_PREAMBLE_PY (containing update_dashboard_layout_component) is prepended,
    // non-empty HTTP paths classify deterministically from (verb, cleanPath):
    expect(classifyLookerOperation('POST', '/dashboards', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/dashboards/42', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'update_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/dashboards/42', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'delete_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/dashboard_elements', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_dashboard_element',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/dashboard_filters', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_dashboard_filter',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/dashboard_layout_components/7', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'update_dashboard_layout_component',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/deploy_to_production', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'deploy_to_production',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/git_branch', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_git_branch',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PUT', '/projects/p1/git_branch', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'update_git_branch',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/projects/p1/git_branch/dev_1', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'delete_git_branch',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/deploy_ref_to_production', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'deploy_ref_to_production',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/reset_to_production', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'reset_project_to_production',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/reset_to_remote', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'reset_project_to_remote',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/developer_copy', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_developer_copy',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/git/deploy_key', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_git_deploy_key',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/commit', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'commit',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/generate_lookml', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'generate_lookml_with_new_files',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/files', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_file',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PUT', '/projects/p1/files', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'update_file',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/projects/p1/files?file_id=views%2Forders.view.lkml', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'delete_file',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/p1/directories', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'create_project_directory',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/projects/p1/directories/views', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'delete_project_directory',
      requiresPermission: true,
    })
    // RFC 3986 canonicalization & anti-spoofing (#fragment, .. / %2e%2e, project named "validate", -ss/-ies plurals, API case/relative)
    expect(classifyLookerOperation('POST', '/api/4.0/dashboards#/validate')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/queries/../dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/session/%2e%2e/dashboards/42')).toEqual({
      operation: 'update_dashboard',
      requiresPermission: true,
    })
    // Two-pass WHATWG fetch() + %2f traversal anti-spoofing (preventing allow_op create_file/delete_file escalation)
    expect(classifyLookerOperation('POST', '/projects/p1/deploy_to_production/a%2f..%2f..%2ffiles%2fdummy/..')).toEqual({
      operation: 'deploy_to_production',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/dashboards/42/a%2f..%2f..%2f..%2fprojects%2fp1%2ffiles%2fdummy/..')).toEqual({
      operation: 'delete_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/%25252e%25252e/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    // Encoded-slash / dot-segment traversal INTO read-only endpoints must fail closed (requiresPermission: true)
    expect(classifyLookerOperation('POST', '/dashboards%2f..%2fqueries')).toEqual({
      operation: 'create_query',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/dashboards/42%2f..%2f..%2fsession')).toEqual({
      operation: 'update_session',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/queries/./run/json')).toEqual({
      operation: 'create_query',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/queries/%252e%252e/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    // URL-encoded %2F inside :project_id / :dashboard_id must NOT split segments or spoof /validate
    expect(classifyLookerOperation('POST', '/projects/p1%2Fvalidate/files')).toEqual({
      operation: 'create_file',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/validate/extra')).toEqual({
      operation: 'create_project',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/dashboards/space%2Fdash/import/5')).toEqual({
      operation: 'import_lookml_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/projects/validate/deploy_to_production')).toEqual({
      operation: 'deploy_to_production',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', 'api/4.0/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/API/4.0/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/content_metadata_access')).toEqual({
      operation: 'create_content_metadata_access',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/running_queries/q1')).toEqual({
      operation: 'delete_running_query',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/dashboards/ecom%3A%3Apulse/import/5', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'import_lookml_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/dashboards/ecom%3A%3Apulse/sync', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'sync_lookml_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/data_app_extension', DASHBOARD_CODEMODE_PREAMBLE_PY)).toEqual({
      operation: 'publish_data_app_extension',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/looks')).toEqual({ operation: 'create_look', requiresPermission: true })
    expect(classifyLookerOperation('POST', '/boards')).toEqual({ operation: 'create_board', requiresPermission: true })
    expect(classifyLookerOperation('POST', '/scheduled_plans')).toEqual({ operation: 'create_scheduled_plan', requiresPermission: true })
    expect(classifyLookerOperation('POST', '/lookml_models')).toEqual({ operation: 'create_lookml_model', requiresPermission: true })
    // Code fallback applies ONLY when rawPath is empty or '/'
    expect(classifyLookerOperation('POST', '', 'commit(project_id="p1")')).toEqual({
      operation: 'commit',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('POST', '/', 'repair_model()')).toEqual({
      operation: 'repair_model',
      requiresPermission: true,
    })

    // 2. Swap globalThis.LkrCodeMode with an unpatched CDN-shaped runtime (which completely ignores
    // requirePermission / onPermissionRequest / approvedOperations and ONLY calls opts.requestHandler)
    const vendorRuntime = (await ensureCodeModeLoaded()) as unknown as {
      init: () => Promise<unknown>
      runPythonCodeRaw: (code: string, varsJson: string, allowUpdate: boolean, handler?: unknown) => Promise<string>
    }
    const g = globalThis as unknown as {
      LkrCodeMode?: unknown
      __LKR_EXTENSION_SDK__?: unknown
      lkr_codemode_api_calls?: Array<{ method: string; route: string }>
    }
    const prevGlobalCm = g.LkrCodeMode
    const prevGlobalExt = g.__LKR_EXTENSION_SDK__
    try {
      const unpatchedCdnRuntime = {
        init: () => vendorRuntime.init().then(() => unpatchedCdnRuntime),
        getCodeModeRuntime: () => unpatchedCdnRuntime,
        runPythonCode: (codeOrParams: unknown, options?: unknown) => {
          const isObj = Boolean(codeOrParams && typeof codeOrParams === 'object')
          const opts = (isObj ? codeOrParams : options || {}) as Record<string, unknown>
          const pyCode = String(isObj ? opts.code || '' : codeOrParams || '')
          // Unpatched CDN codemode.js ignores requirePermission/onPermissionRequest and calls invokeCoreSdkRaw directly if requestHandler is missing!
          const handler =
            typeof opts.requestHandler === 'function'
              ? opts.requestHandler
              : () => {
                  throw new Error('BUG: unpatched CDN runtime fell through without gatedRequestHandler!')
                }
          return vendorRuntime
            .init()
            .then(() =>
              vendorRuntime.runPythonCodeRaw(
                pyCode,
                JSON.stringify(opts.vars || {}),
                Boolean(opts.allowUpdateSession || opts.allow_update_session),
                handler
              )
            )
        },
      }
      g.LkrCodeMode = unpatchedCdnRuntime

      const rawChattyCalls: Array<{ method: string; path: string }> = []
      const cdnChattyHost = {
        sendAndReceive: async (_ev: string, req: { type: string; payload?: Record<string, unknown> }) => {
          const hm = String(req.payload?.httpMethod || 'GET').toUpperCase()
          const p = String(req.payload?.path || '')
          rawChattyCalls.push({ method: hm, path: p })
          if (hm === 'GET' && p.includes('/explores/')) {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ fields: { dimensions: [{ name: 'orders.created_date' }], measures: [{ name: 'orders.count' }] } }) }]
          }
          if (hm === 'POST' && p.includes('/queries/run/json_detail')) {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ data: [{ 'orders.count': { value: 10 } }] }) }]
          }
          if (hm === 'POST' && p === '/queries') {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ id: '701' }) }]
          }
          if (hm === 'PATCH' && p === '/session') {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ workspace_id: 'dev' }) }]
          }
          if (hm === 'POST' && p === '/dashboards') {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ id: '88', title: 'CDN Safe UDD', dashboard_layouts: [{ id: '11', dashboard_layout_components: [] }] }) }]
          }
          if (hm === 'POST' && p === '/dashboard_elements') {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ id: '301', dashboard_id: '88' }) }]
          }
          if (hm === 'GET' && p === '/dashboards/88') {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ id: '88', dashboard_layouts: [{ id: '11', dashboard_layout_components: [{ id: '901', dashboard_element_id: '301' }] }] }) }]
          }
          if (hm === 'PATCH' && p.startsWith('/dashboard_layout_components/')) {
            return [{ ok: true, statusCode: 200, body: JSON.stringify({ id: '901' }) }]
          }
          if (p === '/forbidden') {
            return [{ ok: false, statusCode: 403, body: '{"message":"Forbidden"}' }]
          }
          return [{ ok: true, statusCode: 200, body: JSON.stringify({ ok: true }) }]
        },
      }
      const cdnExtSdk = {
        chattyHost: cdnChattyHost,
        invokeCoreSdkRaw: (httpMethod: string, reqPath: string, params?: unknown, body?: unknown, apiVersion?: string) =>
          cdnChattyHost
            .sendAndReceive('EXTENSION_API_REQUEST', {
              type: 'RAW_INVOKE_CORE_SDK',
              payload: { httpMethod, path: reqPath, params, body, apiVersion },
            })
            .then((vals) => (Array.isArray(vals) ? vals[0] : vals)),
      }
      hookChattyHostApiLogger(cdnExtSdk)

      const uddMacroCode = wrapDashboardCodeMode(
        'update_session({"workspace_id": "dev"})\nreturn upsert_udd("CDN Safe UDD", folder_id="5", tiles=[{"title": "Orders KPI", "fields": ["orders.count"], "vis_config": {"type": "single_value"}}])'
      )

      // 2a. Deny in Safe Mode with CDN codemode.js + extensionSDK.invokeCoreSdkRaw (no rawSdk.rawRequest!):
      // Read-only calls & PATCH /session execute without prompting, then POST /dashboards prompts with 'create_dashboard' (NOT update_dashboard_layout_component!) and blocks on 'deny'
      g.lkr_codemode_api_calls = []
      rawChattyCalls.length = 0
      const promptedOpsDeny: Array<{ operation: string; httpMethod: string; path: string; thought?: string }> = []
      const deniedCdnOut = await LkrCodeMode.runPythonCode({
        code: uddMacroCode,
        extensionSDK: cdnExtSdk,
        allowUpdateSession: true,
        requirePermission: true,
        thought: 'Creating CDN Safe UDD',
        vars: { target_model: 'ecom', target_explore: 'orders' },
        onPermissionRequest: async (req) => {
          promptedOpsDeny.push({ operation: req.operation, httpMethod: req.httpMethod, path: req.path, thought: req.thought })
          return 'deny'
        },
      })
      expect(promptedOpsDeny).toEqual([
        {
          operation: 'create_dashboard',
          httpMethod: 'POST',
          path: '/dashboards',
          thought: 'Creating CDN Safe UDD',
        },
      ])
      expect(deniedCdnOut).toContain("PermissionError: Operation 'create_dashboard' (POST /dashboards) mutates Looker state and was not approved.")
      expect(rawChattyCalls.some((c) => c.path === '/dashboards')).toBe(false)
      expect(rawChattyCalls.some((c) => c.method === 'PATCH' && c.path === '/session')).toBe(true)
      // Exact 1x Chatty logging for the read-only preflight calls (0x for denied POST /dashboards)
      expect(g.lkr_codemode_api_calls).toHaveLength(rawChattyCalls.length)

      // 2b. Approve via 'allow_op' (on create_dashboard) + 'allow_all' (on create_dashboard_element) -> completes UDD creation with 1x Chatty logging
      g.lkr_codemode_api_calls = []
      rawChattyCalls.length = 0
      const turnApproved = new Set<string>()
      const promptedOpsAllow: string[] = []
      const sdkViaNestedHostConn = asSdk({
        authSession: { transport: { hostConnection: { hostConnection: cdnExtSdk } } },
      })
      const allowedCdnOut = JSON.parse(
        await LkrCodeMode.runPythonCode({
          code: uddMacroCode,
          sdk: sdkViaNestedHostConn,
          allowUpdateSession: true,
          requirePermission: true,
          approvedOperations: turnApproved,
          vars: { target_model: 'ecom', target_explore: 'orders' },
          onPermissionRequest: async (req) => {
            promptedOpsAllow.push(req.operation)
            return req.operation === 'create_dashboard' ? 'allow_op' : 'allow_all'
          },
        })
      )
      expect(promptedOpsAllow).toEqual(['create_dashboard', 'create_dashboard_element'])
      expect(turnApproved.has('create_dashboard')).toBe(true)
      expect(turnApproved.has('*')).toBe(true)
      expect((allowedCdnOut.result || allowedCdnOut).dashboard_id).toBe('88')
      expect(g.lkr_codemode_api_calls).toHaveLength(rawChattyCalls.length)

      // 2c. YOLO mode (requirePermission: false) auto-executes on CDN runtime with 0 prompts
      let yoloPrompts = 0
      const yoloCdnOut = JSON.parse(
        await LkrCodeMode.runPythonCode({
          code: uddMacroCode,
          extensionSDK: cdnExtSdk,
          allowUpdateSession: true,
          requirePermission: false,
          vars: { target_model: 'ecom', target_explore: 'orders' },
          onPermissionRequest: async () => {
            yoloPrompts += 1
            return 'deny'
          },
        })
      )
      expect(yoloPrompts).toBe(0)
      expect((yoloCdnOut.result || yoloCdnOut).dashboard_id).toBe('88')

      // 2d. HTTP >= 400 error unwrapping on invokeCoreSdkRaw & invokeCoreSdk fallback via globalThis.__LKR_EXTENSION_SDK__
      const forbiddenOut = await LkrCodeMode.runPythonCode({
        code: 'return delete_dashboard("forbidden")',
        extensionSDK: {
          invokeCoreSdkRaw: async () => ({ ok: false, statusCode: 403, body: '{"message":"Forbidden"}' }),
        },
        requirePermission: false,
      })
      expect(forbiddenOut).toContain('403')
      expect(forbiddenOut).toContain('Forbidden')

      let invokeCoreSdkPrompts = 0
      g.__LKR_EXTENSION_SDK__ = {
        invokeCoreSdk: async (m: string, p: string) => ({ ok: true, value: { method: m, path: p, id: '55' } }),
      }
      const globalFallbackOut = JSON.parse(
        await LkrCodeMode.runPythonCode({
          code: 'return create_look({"title": "Saved Look", "folder_id": "5", "query_id": "701"})',
          requirePermission: true,
          onPermissionRequest: async (req) => {
            invokeCoreSdkPrompts += 1
            expect(req.operation).toBe('create_look')
            return 'allow_once'
          },
        })
      )
      expect(invokeCoreSdkPrompts).toBe(1)
      expect((globalFallbackOut.result || globalFallbackOut).id).toBe('55')

      // 2e. executeLkrExtensionToolRequest: PATCH /session sdk_request bypasses prompt & codemode bridge enforces Safe Mode on CDN runtime
      let bridgePrompts = 0
      await executeLkrExtensionToolRequest({
        sdk: asSdk({
          authSession: {
            transport: {
              rawRequest: async () => ({ ok: true, statusCode: 200, body: '{"workspace_id":"dev"}' }),
            },
          },
        }),
        req: { kind: 'sdk_request', method: 'PATCH', path: '/session', body: { workspace_id: 'dev' } },
        requirePermission: true,
        onPermissionRequest: async () => {
          bridgePrompts += 1
          return 'deny'
        },
      })
      expect(bridgePrompts).toBe(0)

      const bridgedCdnDenied = await executeLkrExtensionToolRequest({
        sdk: sdkViaNestedHostConn,
        req: { kind: 'codemode', code: 'return create_dashboard({"title": "Bridged"})', thought: 'Bridged dash' },
        requirePermission: true,
        onPermissionRequest: async (req) => {
          bridgePrompts += 1
          expect(req.operation).toBe('create_dashboard')
          expect(req.thought).toBe('Bridged dash')
          return 'deny'
        },
      })
      expect(bridgePrompts).toBe(1)
      expect(String(bridgedCdnDenied.result)).toContain('PermissionError')

      // 2f. sdk_request fallback via extensionSDK when sdk lacks rawRequest (and zero /session calls on deny)
      rawChattyCalls.length = 0
      await expect(
        executeLkrExtensionToolRequest({
          sdk: sdkViaNestedHostConn,
          req: { kind: 'sdk_request', method: 'POST', path: '/dashboards', body: { title: 'Blocked' }, dev_mode: true },
          requirePermission: true,
          onPermissionRequest: async () => 'deny',
        })
      ).rejects.toThrow(/PermissionError: Operation 'create_dashboard' \(POST \/dashboards\)/)
      expect(rawChattyCalls).toHaveLength(0)

      const extSdkReqAllowed = await executeLkrExtensionToolRequest({
        sdk: sdkViaNestedHostConn,
        req: { kind: 'sdk_request', method: 'POST', path: '/dashboards', body: { title: 'Allowed' }, dev_mode: true },
        requirePermission: true,
        onPermissionRequest: async () => 'allow_once',
      })
      expect(extSdkReqAllowed.result).toMatchObject({ id: '88' })
      expect(rawChattyCalls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /session', 'POST /dashboards'])

      // 2g. Production ExtensionTransport (createDeduplicatedLookerSdkProxy + rawRequest -> chattyHost) 1x logging + concurrent Promise.all serialization
      g.lkr_codemode_api_calls = []
      rawChattyCalls.length = 0
      const prodProxiedSdk = createDeduplicatedLookerSdkProxy(
        asSdk({
          authSession: {
            transport: {
              hostConnection: { hostConnection: cdnExtSdk },
              rawRequest: (m: string, p: string, q?: Record<string, unknown>, b?: unknown) =>
                cdnExtSdk.invokeCoreSdkRaw(m, p, q, b, '4.0'),
            },
          },
        })
      )
      const sharedConcurrentApproved = new Set<string>()
      let concurrentPromptCount = 0
      const [concA, concB] = await Promise.all([
        LkrCodeMode.runPythonCode({
          code: 'return create_dashboard({"title": "Conc A", "folder_id": "5"})',
          sdk: prodProxiedSdk,
          requirePermission: true,
          approvedOperations: sharedConcurrentApproved,
          onPermissionRequest: async (req) => {
            if (sharedConcurrentApproved.has(req.operation)) return 'allow_op'
            concurrentPromptCount += 1
            await new Promise((r) => setTimeout(r, 15))
            sharedConcurrentApproved.add(req.operation)
            return 'allow_op'
          },
        }),
        (async () => {
          await new Promise((r) => setTimeout(r, 20))
          return LkrCodeMode.runPythonCode({
            code: 'return create_dashboard({"title": "Conc B", "folder_id": "5"})',
            sdk: prodProxiedSdk,
            requirePermission: true,
            approvedOperations: sharedConcurrentApproved,
            onPermissionRequest: async () => {
              concurrentPromptCount += 1
              return 'deny'
            },
          })
        })(),
      ])
      expect(concurrentPromptCount).toBe(1)
      expect(JSON.parse(concA).id || JSON.parse(concA).result?.id).toBe('88')
      expect(JSON.parse(concB).id || JSON.parse(concB).result?.id).toBe('88')
      expect(g.lkr_codemode_api_calls).toHaveLength(2)

      // 2h. upsert_lookml_dashboard re-raises PermissionError immediately (prompts only 1x instead of retrying 5 fallback mutations)
      let lookmlDashPrompts = 0
      const lookmlDashDenied = await LkrCodeMode.runPythonCode({
        code: wrapDashboardCodeMode(
          'return upsert_lookml_dashboard(project_id="p1", model="ecom", dashboard_name="pulse", title="Pulse", yaml_content="- dashboard: pulse\\n", folder_id="5")'
        ),
        extensionSDK: cdnExtSdk,
        requirePermission: true,
        onPermissionRequest: async () => {
          lookmlDashPrompts += 1
          return 'deny'
        },
      })
      expect(lookmlDashPrompts).toBe(1)
      expect(lookmlDashDenied).toContain('PermissionError')

      // 2i. _PUSH_CODEMODE_PY (lkr tools lookml push bridge) switches dev session via extensionSDK fallback and re-raises PermissionError on 1st denial
      const pushPaths: string[] = []
      let pushPrompts = 0
      const pushModCode = LKR_CLI_SITECUSTOMIZE_PY.match(/_PUSH_CODEMODE_PY\s*=\s*"""([\s\S]*?)"""\.strip\(\)/)?.[1] || ''
      expect(pushModCode).toContain('def _re_perm(e):')
      const pushBridgeRes = await executeLkrExtensionToolRequest({
        sdk: asSdk({ authSession: { transport: {} } }),
        extensionSDK: {
          invokeCoreSdkRaw: async (m: string, p: string) => {
            pushPaths.push(`${m} ${p}`)
            if (p === '/projects') {
              return { ok: true, statusCode: 200, body: JSON.stringify([{ id: 'p1', uses_git: true, git_service_name: 'bare' }]) }
            }
            return { ok: true, statusCode: 200, body: JSON.stringify({ ok: true }) }
          },
        } as unknown as Parameters<typeof executeLkrExtensionToolRequest>[0]['extensionSDK'],
        req: {
          kind: 'codemode',
          code: pushModCode,
          dev_mode: true,
          vars: {
            project_id: 'p1',
            reset: true,
            deploy: true,
            single_file: false,
            message: 'push test',
            files_to_push: [],
          },
        },
        requirePermission: true,
        onPermissionRequest: async () => {
          pushPrompts += 1
          return 'deny'
        },
      })
      expect(pushPaths).toContain('PATCH /session')
      expect(pushPrompts).toBe(1)
      expect(JSON.stringify(pushBridgeRes.result)).toContain("PermissionError: Operation 'reset_project_to_production'")
      expect(JSON.stringify(pushBridgeRes.result)).not.toContain('"ok":true')
    } finally {
      g.LkrCodeMode = prevGlobalCm
      if (prevGlobalExt === undefined) delete g.__LKR_EXTENSION_SDK__
      else g.__LKR_EXTENSION_SDK__ = prevGlobalExt
    }

    // 2j. Fail-closed when baseHandler is undefined and requirePermission is true
    const noTransportDenied = await LkrCodeMode.runPythonCode({
      code: 'return create_dashboard({"title": "No Transport"})',
      requirePermission: true,
    })
    expect(noTransportDenied).toContain("PermissionError: Operation 'create_dashboard'")

  })

}
