import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  executeLkrExtensionToolRequest, extractInteractionActivitySteps, LKR_CLI_SITECUSTOMIZE_PY, LkrCodeMode,
  runAntigravityTurn,
} from '../../antigravity'
import { normalizeLookerApiPath, unwrapLookerRawResponse, upsertPublishedDataApp } from '../../lookerApi'

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

export function registerPermissionsPart19Tests(): void {
  test('80b. Issue #190: unwraps Looker raw responses, resolves missing extensionId on upsertPublishedDataApp, and tracks Safe Mode permission denials across bridged CLI and turn controller', async () => {
    // 3. Verify unwrapLookerRawResponse & upsertPublishedDataApp resolving missing extensionId + extensionSDK fallback when rawRequest is absent
    expect(unwrapLookerRawResponse({ ok: true, statusCode: 200, body: '{"id":"9"}' }, 'GET', '/dashboards/9')).toEqual({ id: '9' })
    expect(() => unwrapLookerRawResponse({ ok: false, statusCode: 403, body: 'Denied' }, 'DELETE', '/dashboards/9')).toThrow(/403/)

    const patchedCalls: string[] = []
    const upsertedInPlace = await upsertPublishedDataApp(
      asSdk({
        ok: async <T>(p: T) => p,
        dashboard: async (id: string) => ({
          id,
          dashboard_elements: [{ id: '101', type: 'extension', extension_id: 'db::resolved-ext-id' }],
        }),
        update_dashboard: async (id: string) => {
          patchedCalls.push(`PATCH /dashboards/${id}`)
          return { id }
        },
        update_dashboard_element: async (id: string) => ({ id }),
        authSession: {
          transport: {
            extensionHost: {
              invokeCoreSdkRaw: async (m: string, p: string) => {
                patchedCalls.push(`${m} ${p}`)
                return { ok: true, statusCode: 200, body: '{"id":"resolved-ext-id"}' }
              },
            },
          },
        },
      }),
      { title: 'Updated In Place', raw_code: 'export class A {}', prod_code: 'export class A {}', widgets: [] },
      '5',
      { dashboardId: '42', extensionId: '', title: 'Old' }
    )
    expect(upsertedInPlace.dashboardId).toBe('42')
    expect(upsertedInPlace.extensionId).toBe('resolved-ext-id')
    expect(patchedCalls.sort()).toEqual(['PATCH /dashboards/42', 'PATCH /data_app_extension/resolved-ext-id'])

    // Rejects instead of falling through to POST /dashboards if existing.dashboardId has no extensionId and sdk.dashboard fails
    await expect(
      upsertPublishedDataApp(
        asSdk({
          ok: async <T>(p: T) => p,
          dashboard: async () => {
            throw new Error('Looker GET /dashboards/42 failed (500): transient')
          },
          authSession: { transport: {} },
        }),
        { title: 'Should Fail', raw_code: 'export class A {}', prod_code: 'export class A {}', widgets: [] },
        '5',
        { dashboardId: '42', extensionId: '', title: 'Old' }
      )
    ).rejects.toThrow(/500/)

    // 3b. Bridged CLI (<LOOKML_BUNDLE> + <LKR_EXTENSION_TOOL_REQUEST>) surfaces result.permissionError and skips .lkr_extension_cache on Safe Mode denial
    expect(LKR_CLI_SITECUSTOMIZE_PY).toContain('if "PermissionError:" in txt:')
    const bridgedTurnRes = await runAntigravityTurn({
      sdk: asSdk({
        me: async () => ({ id: '1', personal_folder_id: '5' }),
        authSession: {
          transport: {
            rawRequest: async (_m: string, p: string) => ({
              ok: true,
              statusCode: 200,
              body: p === '/projects' ? JSON.stringify([{ id: 'proj_190', uses_git: true, git_service_name: 'bare' }]) : '{}',
            }),
          },
        },
      }),
      extensionSDK: {
        serverProxy: async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_bridge_denied_190',
            environment_id: 'env_190',
            status: 'completed',
            steps: [
              {
                type: 'code_execution_result',
                output: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({
                  kind: 'sdk_request',
                  method: 'POST',
                  path: '/projects/proj_190/deploy_to_production',
                  dev_mode: true,
                })}</LKR_EXTENSION_TOOL_REQUEST>`,
              },
            ],
            output_text:
              '<USE_CASE>lookml</USE_CASE>\n<LOOKML_BUNDLE>{"id":"proj_190","project_id":"proj_190","title":"Proj 190","model_name":"ecom","files":[{"path":"models/ecom.model.lkml","content":"connection: \\"bq\\""}]}</LOOKML_BUNDLE>',
          }),
        }),
      },
      auth: { mode: 'apikey', apiKey: 'test-key', oauthToken: '', clientId: '', projectId: '' },
      session: { environmentId: 'env_190', lastInteractionId: 'int_prev_190' },
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'Deploy proj_190',
      requirePermission: true,
      onPermissionRequest: async () => 'deny',
      onStatus: () => {},
    })
    expect(normalizeLookerApiPath('/api/4.0#frag')).toBe('/')
    expect(normalizeLookerApiPath('/API/4.0/dashboards?fields=id#frag')).toBe('/dashboards?fields=id')
    expect(bridgedTurnRes.permissionError).toContain("PermissionError: Operation 'deploy_to_production'")

    // Non-bundle chat turn after a denied bridge mutation preserves assistantText without setting permissionError
    let nonBundleRound = 0
    const nonBundleDeniedRes = await runAntigravityTurn({
      sdk: asSdk({
        me: async () => ({ id: '1', personal_folder_id: '5' }),
        authSession: { transport: { rawRequest: async () => ({ ok: true, statusCode: 200, body: '{}' }) } },
      }),
      extensionSDK: {
        serverProxy: async () => {
          nonBundleRound += 1
          return {
            ok: true,
            status: 200,
            body: JSON.stringify(
              nonBundleRound === 1
                ? {
                    id: 'int_nb_1',
                    environment_id: 'env_190',
                    status: 'completed',
                    steps: [
                      {
                        type: 'code_execution_result',
                        output: `<LKR_EXTENSION_TOOL_REQUEST>${JSON.stringify({
                          kind: 'sdk_request',
                          method: 'POST',
                          path: '/projects/proj_190/deploy_to_production',
                        })}</LKR_EXTENSION_TOOL_REQUEST>`,
                      },
                    ],
                    output_text: 'Attempting deploy...',
                  }
                : {
                    id: 'int_nb_2',
                    environment_id: 'env_190',
                    status: 'completed',
                    output_text: '<USE_CASE>lookml</USE_CASE>\nStopped cleanly after Safe Mode denied deployment.',
                  }
            ),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key', oauthToken: '', clientId: '', projectId: '' },
      session: { environmentId: 'env_190', lastInteractionId: 'int_prev_190' },
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'Deploy proj_190',
      requirePermission: true,
      onPermissionRequest: async () => 'deny',
      onStatus: () => {},
    })
    expect(nonBundleDeniedRes.permissionError).toBeUndefined()
    expect(nonBundleDeniedRes.assistantText).toContain('Stopped cleanly after Safe Mode denied deployment.')

    // Verify canonicalized path forwarding on traversal/origin/#fragment + run_looker_codemode denial tracking on bundle turns
    const forwardedPaths: string[] = []
    await executeLkrExtensionToolRequest({
      sdk: {
        authSession: {
          transport: {
            rawRequest: async (_m: string, reqPath: string) => {
              forwardedPaths.push(reqPath)
              return { ok: true, statusCode: 200, body: '{"ok":true}' }
            },
          },
        },
      } as unknown as Looker40SDK,
      req: {
        kind: 'sdk_request',
        method: 'POST',
        path: 'https://evil.example/projects/p1/deploy_to_production/a%2f..%2f..%2ffiles%2fdummy/..#spoof',
      },
      requirePermission: true,
      approvedOperations: new Set(['deploy_to_production']),
      onPermissionRequest: async () => 'deny',
    })
    expect(forwardedPaths).toEqual(['/projects/p1/deploy_to_production'])

    let cmDenyStep = 0
    const cmDeniedBundleRes = await runAntigravityTurn({
      sdk: {
        authSession: {
          transport: {
            rawRequest: async () => ({ ok: true, statusCode: 200, body: '{"id":"999"}' }),
          },
        },
      } as unknown as Looker40SDK,
      userId: '1',
      extensionSDK: {
        serverProxy: async () => {
          cmDenyStep += 1
          return {
            ok: true,
            status: 200,
            body: JSON.stringify(
              cmDenyStep === 1
                ? {
                    id: 'int_cm_deny_1',
                    environment_id: 'env_190',
                    status: 'requires_action',
                    steps: [
                      {
                        id: 'call_cm_1',
                        type: 'function_call',
                        name: 'run_looker_codemode',
                        arguments: JSON.stringify({ code: 'return create_dashboard({"title": "Unapproved"})' }),
                      },
                    ],
                  }
                : {
                    id: 'int_cm_deny_2',
                    environment_id: 'env_190',
                    status: 'completed',
                    output_text:
                      '<USE_CASE>dashboard</USE_CASE>\n<NATIVE_CONTENT_BUNDLE>{"id":"999","content_type":"dashboard","title":"Unapproved"}</NATIVE_CONTENT_BUNDLE>',
                  }
            ),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key', oauthToken: '', clientId: '', projectId: '' },
      session: { environmentId: 'env_190', lastInteractionId: 'int_prev_190' },
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'Build dashboard',
      requirePermission: true,
      onPermissionRequest: async () => 'deny',
      onStatus: () => {},
    })
    expect(cmDeniedBundleRes.permissionError).toContain("PermissionError: Operation 'create_dashboard'")

    // 4. Verify studioControllerTurn.ts allocates fresh per-turn Set and gates upsertPublishedDataApp + handleRunPython + result.permissionError in Safe Mode
    const repoRoot = path.resolve(__dirname, '../../..')
    const turnTs = readFileSync(path.join(repoRoot, 'src/studioControllerTurn.ts'), 'utf8')
    expect(turnTs).toContain('const turnApprovedOps = new Set<string>()')
    expect(turnTs).toContain('if (result.permissionError)')
    expect(turnTs).toContain("const pubOp = effectivePublishedApp?.dashboardId ? 'update_dashboard' : 'create_dashboard'")
    expect(turnTs).toContain('Publish Data App "${result.bundle.title}" to Looker dashboard')
    const stylesCss = readFileSync(path.join(repoRoot, 'src/styles/index.css'), 'utf8')
    const workspaceTsx = readFileSync(path.join(repoRoot, 'src/components/StudioComposer.tsx'), 'utf8')
    expect(stylesCss).toContain('.dab-composer-model-select .dab-studio-menu,.dab-composer .dab-studio-menu,.dab-studio-menu.open-up {top:auto;bottom:calc(100% + 6px);max-height:min(280px,calc(100vh - 120px))}')
    expect(stylesCss).toContain('.dab-composer-model-select .dab-studio-submenu,.dab-composer .dab-studio-submenu {top:auto;bottom:-4px}')
    expect(stylesCss).toContain('.dab-agent-name-edit-btn {width:22px;min-width:22px;height:22px;min-height:22px;visibility:hidden;opacity:0;transition:opacity 0.12s ease}')
    expect(stylesCss).toContain('.dab-agent-name-brand:hover .dab-agent-name-edit-btn,.dab-brand:hover .dab-agent-name-edit-btn,.dab-agent-name-edit-btn:hover,.dab-agent-name-edit-btn:focus-visible {visibility:visible;opacity:1}')
    expect(workspaceTsx).toContain('data-testid="mobile-menu-edit-agent-name-btn" className="dab-composer-add-item dab-mobile-only-menu-item"')
  })

  test('70. Issue #198: resolves Turn 2 function_call ID collision against steps[0] input function_result, deduplicates repeated run_looker_codemode calls with _duplicate_call_notice, verifies SSE requires_action fallback to REST GET, and auto-continues/recovers missing <DATA_APP_BUNDLE>', async () => {
    const origRunPython = LkrCodeMode.runPythonCode
    let pythonRunCount = 0
    LkrCodeMode.runPythonCode = async () => {
      pythonRunCount += 1
      return JSON.stringify({
        ok: true,
        dimensions: ['order_items.created_month', 'products.category'],
        measures: ['order_items.total_sale_price'],
      })
    }

    try {
      // 1. Turn 1 -> Turn 2 call_id collision + duplicate run_looker_codemode deduplication + Turn 3 <DATA_APP_BUNDLE>
      const postedBodies: MockInteractionPostBody[] = []
      const dupDiscoveryCode = 'exp = lookml_model_explore("thelook", "order_items")\nreturn {"ok": True}'
      const collidingCallId = 'call_5950459370112177182'
      const mockCollisionExt = {
        serverProxy: async (_url: string, init?: FetchCustomParameters) => {
          const b = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
          postedBodies.push(b)
          if (postedBodies.length === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_198_t1',
                environment_id: 'env_198',
                status: 'requires_action',
                steps: [
                  { id: 'th_1', type: 'thought', thought: 'Inspecting order_items schema for race bar chart' },
                  {
                    id: collidingCallId,
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: { thought: 'Discovering order_items fields', code: dupDiscoveryCode },
                  },
                ],
              }),
            }
          }
          if (postedBodies.length === 2) {
            // Turn 2 echoes Turn 1's function_result at steps[0] and emits a new function_call at steps[2] with the SAME deterministic id
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_198_t2',
                previous_interaction_id: 'int_198_t1',
                environment_id: 'env_198',
                status: 'requires_action',
                steps: [
                  {
                    type: 'function_result',
                    name: 'run_looker_codemode',
                    call_id: collidingCallId,
                    result: b.input?.[0]?.result,
                  },
                  { id: 'th_2', type: 'thought', thought: 'Checking order_items dimensions again' },
                  {
                    id: collidingCallId,
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: { thought: 'Repeating order_items discovery', code: dupDiscoveryCode },
                  },
                ],
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_198_t3',
              previous_interaction_id: 'int_198_t2',
              environment_id: 'env_198',
              status: 'completed',
              steps: [
                {
                  type: 'function_result',
                  name: 'run_looker_codemode',
                  call_id: collidingCallId,
                  result: b.input?.[0]?.result,
                },
                {
                  id: 'exec_bundle',
                  type: 'code_execution_result',
                  output:
                    '<DATA_APP_BUNDLE>{"title":"Category Race Bar Chart","raw_code":"export class RaceApp extends DataApp {}","prod_code":"export class RaceApp extends DataApp {}","widgets":[]}</DATA_APP_BUNDLE>',
                },
              ],
              output_text: '<USE_CASE>app</USE_CASE>\nBuilt the Category Race Bar Chart Data App.',
            }),
          }
        },
      }

      const collisionTurn = await runAntigravityTurn({
        sdk: asSdk({ ok: async <T>(p: T) => p }),
        extensionSDK: mockCollisionExt,
        auth: { mode: 'apikey', apiKey: 'test_key_198' },
        session: { environmentId: 'env_198', toolType: 'app' },
        mode: 'data_app',
        useCase: 'app',
        selectedExplores: ['thelook::order_items'],
        schemaMarkdown: '# Schema',
        userPrompt: '/data-apps build a data app race bar chart for order items total sale price',
        onStatus: () => {},
      })

      expect(postedBodies).toHaveLength(3)
      // LkrCodeMode.runPythonCode was only invoked ONCE; Turn 2 reused the cached result with _duplicate_call_notice
      expect(pythonRunCount).toBe(1)
      const turn2SentResult = postedBodies[2]?.input?.[0]?.result as Record<string, unknown> | undefined
      expect(turn2SentResult?.ok).toBe(true)
      expect(String(turn2SentResult?._duplicate_call_notice || '')).toContain(
        'NOTE: You already executed this exact run_looker_codemode snippet'
      )
      expect(collisionTurn.bundle?.title).toBe('Category Race Bar Chart')
      expect(collisionTurn.assistantText).toContain('Built the Category Race Bar Chart Data App.')

      // Verify extractInteractionActivitySteps pairs positionally when steps[0] is an input function_result with the same call_id
      const turn2InFlightSteps = extractInteractionActivitySteps({
        id: 'int_198_t2',
        status: 'requires_action',
        steps: [
          { type: 'function_result', name: 'run_looker_codemode', call_id: collidingCallId, result: { ok: true } },
          { id: 'th_2', type: 'thought', thought: 'Planning next step' },
          {
            id: collidingCallId,
            type: 'function_call',
            name: 'run_looker_codemode',
            arguments: { thought: 'Querying race bar series', code: 'return 1' },
          },
        ],
      })
      const runningCodemode = turn2InFlightSteps.find((s) => s.kind === 'codemode')
      expect(runningCodemode?.status).toBe('running')

      // 2. OAuth SSE stream returning status === 'requires_action' before function_call frame arrives falls through to REST GET
      const prevFetch = globalThis.fetch
      let restGetCalled = false
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = String(init?.method || 'GET').toUpperCase()
        if (url.includes('alt=sse')) {
          const sseBody = 'event: interaction.requires_action\ndata: {"id":"int_sse_198","status":"requires_action","steps":[{"type":"function_result","call_id":"call_5950459370112177182","result":{"ok":true}}]}\n\n'
          return {
            ok: true,
            status: 200,
            text: async () => sseBody,
          } as unknown as Response
        }
        if (method === 'GET' && url.includes('/interactions/int_sse_198')) {
          restGetCalled = true
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                id: 'int_sse_198',
                environment_id: 'env_198',
                status: 'requires_action',
                steps: [
                  { type: 'function_result', call_id: collidingCallId, result: { ok: true } },
                  {
                    id: collidingCallId,
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: { thought: 'Fetched via authoritative REST GET', code: 'return {"from_rest": True}' },
                  },
                ],
              }),
          } as unknown as Response
        }
        const postBody = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        if (!postBody.previous_interaction_id) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ id: 'int_sse_198', environment_id: 'env_198', status: 'in_progress', steps: [] }),
          } as unknown as Response
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 'int_sse_198_done',
              environment_id: 'env_198',
              status: 'completed',
              output_text:
                '<DATA_APP_BUNDLE>{"title":"SSE Recovered App","code":"export class SseApp extends DataApp {}"}</DATA_APP_BUNDLE>\nDone.',
            }),
        } as unknown as Response
      }) as typeof fetch

      try {
        const sseTurn = await runAntigravityTurn({
          sdk: asSdk({ ok: async <T>(p: T) => p }),
          auth: { mode: 'oauth', oauthToken: 'tok_198' },
          session: { environmentId: 'env_198', toolType: 'app' },
          mode: 'data_app',
          useCase: 'app',
          selectedExplores: ['thelook::order_items'],
          schemaMarkdown: '# Schema',
          userPrompt: 'Build SSE app',
          pollScheduleMs: [0],
          onStatus: () => {},
        })
        expect(restGetCalled).toBe(true)
        expect(sseTurn.bundle?.title).toBe('SSE Recovered App')
        expect(sseTurn.bundle?.raw_code).toContain('export class SseApp extends DataApp')
      } finally {
        globalThis.fetch = prevFetch
      }

      // 3. Auto-continuation when useCase === 'app' finishes without <DATA_APP_BUNDLE>, plus fallback fetchEnvironmentFile recovery
      const autoContPosts: MockInteractionPostBody[] = []
      const fetchedFiles: string[] = []
      const mockAutoRecoverExt = {
        serverProxy: async (url: string, init?: FetchCustomParameters) => {
          const method = String(init?.method || 'GET').toUpperCase()
          if (method === 'GET' && url.includes('/environments/env_198_rec/files/')) {
            fetchedFiles.push(url)
            if (url.includes('workspace/apps/race-bar/app.js')) {
              return {
                ok: true,
                status: 200,
                body: "import { DataApp, html } from '/runtime/data-app.js';\nexport class RaceBarApp extends DataApp {}\ncustomElements.define('race-bar-app', RaceBarApp);",
              }
            }
            return { ok: false, status: 404, body: 'Not found' }
          }
          const b = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
          autoContPosts.push(b)
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: `int_rec_${autoContPosts.length}`,
              environment_id: 'env_198_rec',
              status: 'completed',
              steps: [
                {
                  id: `st_rec_${autoContPosts.length}`,
                  type: 'code_execution',
                  command: 'cat << "EOF" > /workspace/apps/race-bar/app.js',
                },
              ],
              output_text: 'Wrote /workspace/apps/race-bar/app.js.',
            }),
          }
        },
      }

      const recoveredTurn = await runAntigravityTurn({
        sdk: asSdk({ ok: async <T>(p: T) => p }),
        extensionSDK: mockAutoRecoverExt,
        conversationId: 'conv_198_rec',
        auth: { mode: 'apikey', apiKey: 'test_key_198' },
        session: { environmentId: 'env_198_rec', toolType: 'app' },
        mode: 'data_app',
        useCase: 'app',
        selectedExplores: ['thelook::order_items'],
        schemaMarkdown: '# Schema',
        userPrompt: 'Build Order Items Race Bar Chart',
        onStatus: () => {},
      })

      // Initial POST + 2 auto-continuation rounds before falling back to fetchEnvironmentFile
      expect(autoContPosts).toHaveLength(3)
      expect(JSON.stringify(autoContPosts[1]?.input)).toContain('You have not emitted <DATA_APP_BUNDLE> yet.')
      expect(fetchedFiles.some((u) => u.includes('workspace/apps/race-bar/app.js'))).toBe(true)
      expect(recoveredTurn.bundle?.title).toBe('Build Order Items Race Bar Chart')
      expect(recoveredTurn.bundle?.code).toContain('export class RaceBarApp extends DataApp')
      expect(recoveredTurn.bundle?.prod_code).toContain('https://www.gstatic.com/looker-data-apps/versions/1.2.0/data-app.js')
    } finally {
      LkrCodeMode.runPythonCode = origRunPython
    }
  })

}
