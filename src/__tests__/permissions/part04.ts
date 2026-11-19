import type { Looker40SDK } from '@looker/sdk'

import {
  AGENTS_MD, AntigravityActivityStep, CodeModePermissionRequest, extractInteractionActivitySteps,
  extractThoughtText, LKR_CLI_BRIDGE_TOOL, LkrCodeMode, runAntigravityTurn,
  summarizeProgress,
} from '../../antigravity'
import { DEFAULT_STARTER_PROMPTS } from '../../components/StudioWorkspace'
import {
  ARTIFACT_NAMESPACE, ArtifactPayloadViolationError, ArtifactService, clearArtifactServiceCache,
  clearLookerMetadataCache, ConversationRecord, deleteUserArtifact, deleteUserConversation,
  getArtifactService, listUserArtifacts, loadUserConversations, parseStudioRoute,
  readSwrCache, saveUserConversation, saveUserEnvironmentId, saveUserStudioConfig, STUDIO_MODES,
  UserArtifactIndexItem,
} from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart04Tests(): void {
  test('19. parses central conversation routes (/, /c/:conversationId, /config) and flags legacy routes for redirect (Issue #47)', () => {
    expect(parseStudioRoute('/')).toEqual({
      objectId: '',
      conversationId: '',
    })
    expect(parseStudioRoute('/config')).toEqual({
      objectId: '',
      conversationId: '',
    })
    expect(parseStudioRoute('/c/42')).toEqual({
      objectId: '42',
      conversationId: '42',
    })
    expect(parseStudioRoute('/c/conv_dashboard_7')).toEqual({
      objectId: '7',
      conversationId: 'conv_dashboard_7',
    })
    expect(parseStudioRoute('/c/lookml_1')).toEqual({
      objectId: 'lookml_1',
      conversationId: 'lookml_1',
    })
    expect(parseStudioRoute('/c/hc_thelook_1')).toEqual({
      objectId: 'hc_thelook_1',
      conversationId: 'hc_thelook_1',
    })
    expect(parseStudioRoute('/c/ca_conv_streaming_1')).toEqual({
      objectId: 'ca_conv_streaming_1',
      conversationId: 'ca_conv_streaming_1',
    })
    expect(parseStudioRoute('/c/conv_tile_demo1')).toEqual({
      objectId: 'demo1',
      conversationId: 'conv_tile_demo1',
    })
    expect(parseStudioRoute('/app/42')).toEqual({
      objectId: '42',
      conversationId: '42',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/dashboard/7')).toEqual({
      objectId: '7',
      conversationId: '7',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/tile/demo1')).toEqual({
      objectId: 'demo1',
      conversationId: 'demo1',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/conversational-analytics/ca_conv_streaming_1')).toEqual({
      objectId: 'ca_conv_streaming_1',
      conversationId: 'ca_conv_streaming_1',
      isLegacyRoute: true,
    })
  })

  test('20. ArtifactService caches versionByKey to skip redundant sdk.artifact GET calls on subsequent saves, retries once on version conflict, and mutates SWR list caches in place without extra sdk.search_artifacts calls (Issue #55)', async () => {
    clearArtifactServiceCache()
    clearLookerMetadataCache()

    const store = new Map<string, { key: string; version: number; value: string }>()
    let artifactGetCount = 0
    let searchArtifactsCount = 0
    let updateArtifactsCount = 0
    let deleteArtifactCount = 0
    let simulateVersionConflictOnce = false

    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { namespace: string; key: string }) => {
        artifactGetCount += 1
        const keys = String(key || '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
        return keys.map((k) => store.get(k)).filter(Boolean)
      },
      search_artifacts: async ({ key }: { namespace: string; key: string }) => {
        searchArtifactsCount += 1
        const prefix = String(key || '').replace(/%/g, '')
        return Array.from(store.values()).filter((r) => r.key.startsWith(prefix))
      },
      update_artifacts: async (
        _ns: string,
        updates: Array<{ key: string; value: string; version?: number }>
      ) => {
        updateArtifactsCount += 1
        if (simulateVersionConflictOnce) {
          simulateVersionConflictOnce = false
          for (const u of updates) {
            const cur = store.get(u.key)
            if (cur) store.set(u.key, { ...cur, version: cur.version + 5 })
          }
          throw new Error('409 Conflict: artifact version mismatch')
        }
        const saved: Array<{ key: string; version: number; value: string }> = []
        for (const u of updates) {
          const prev = store.get(u.key)
          if (prev && u.version !== prev.version) {
            throw new Error(
              `Version conflict for ${u.key}: expected ${prev.version}, got ${u.version}`
            )
          }
          const next = {
            key: u.key,
            version: (prev?.version ?? 0) + 1,
            value: u.value,
          }
          store.set(u.key, next)
          saved.push(next)
        }
        return saved
      },
      delete_artifact: async (_ns: string, key: string) => {
        deleteArtifactCount += 1
        for (const k of String(key || '').split(',')) {
          store.delete(k.trim())
        }
        return ''
      },
    })

    const svc = getArtifactService(mockSdk, ARTIFACT_NAMESPACE)
    expect(svc).toBeInstanceOf(ArtifactService)
    expect(getArtifactService(mockSdk, ARTIFACT_NAMESPACE)).toBe(svc)

    // 1. Initial allowed-key saves fetch missing versions once; subsequent updates use cached versionByKey with 0 sdk.artifact calls
    await expect(
      svc.put([{ key: 'obj_app_42', value: { id: '42', title: 'Forbidden Object Key' } }])
    ).rejects.toThrow(ArtifactPayloadViolationError)

    await saveUserEnvironmentId(mockSdk, '7', 'env_7_initial', ARTIFACT_NAMESPACE, 'hash_v1')
    expect(svc.getCachedVersion('user_env:7')).toBe(1)
    const getCountAfterFirstEnvSave = artifactGetCount
    const updateCountAfterFirstEnvSave = updateArtifactsCount

    await saveUserEnvironmentId(mockSdk, '7', 'env_7_next', ARTIFACT_NAMESPACE, 'hash_v2')
    // Subsequent save to existing key makes 0 sdk.artifact GET calls and 1 sdk.update_artifacts call
    expect(artifactGetCount - getCountAfterFirstEnvSave).toBe(0)
    expect(updateArtifactsCount - updateCountAfterFirstEnvSave).toBe(1)
    expect(svc.getCachedVersion('user_env:7')).toBe(2)

    await saveUserStudioConfig(mockSdk, '7', { agentName: 'Atlas' })
    expect(svc.getCachedVersion('user_config:7')).toBe(1)

    // Repeated saveUserConversation calls also make 0 sdk.artifact GET calls on subsequent saves
    await saveUserConversation(mockSdk, '7', {
      id: 'conv_42',
      type: 'app',
      label: 'Conv Turn 1',
      updatedAt: '2026-11-01T10:00:00Z',
    })
    const getCountAfterFirstConvSave = artifactGetCount
    const updateCountAfterFirstConvSave = updateArtifactsCount

    await saveUserConversation(mockSdk, '7', {
      id: 'conv_42',
      type: 'app',
      label: 'Conv Turn 2',
      updatedAt: '2026-11-01T10:06:00Z',
    })
    expect(artifactGetCount - getCountAfterFirstConvSave).toBe(0)
    expect(updateArtifactsCount - updateCountAfterFirstConvSave).toBe(1)
    expect(svc.getCachedVersion('user_conversations:7')).toBe(2)

    // 2. Version conflict on cached key automatically refreshes version via sdk.artifact and retries update_artifacts once
    simulateVersionConflictOnce = true
    const getCountBeforeConflict = artifactGetCount
    const updateCountBeforeConflict = updateArtifactsCount
    await svc.put([{ key: 'user_config:7', value: { agentName: 'Atlas v2' } }])
    expect(artifactGetCount - getCountBeforeConflict).toBe(1)
    expect(updateArtifactsCount - updateCountBeforeConflict).toBe(2)
    expect(svc.getCachedVersion('user_config:7')).toBe(7)

    // 3. Legacy read-only listUserArtifacts + deleteUserArtifact cleanup updates SWR cache without extra sdk.search_artifacts calls
    store.set('user_7_app_42', {
      key: 'user_7_app_42',
      version: 1,
      value: JSON.stringify({
        id: '42',
        type: 'app',
        title: 'Revenue App v2',
        updatedAt: '2026-11-01T10:05:00Z',
        createdBy: '7',
      }),
    })
    store.set('obj_app_42', {
      key: 'obj_app_42',
      version: 1,
      value: JSON.stringify({ id: '42', type: 'app', title: 'Revenue App v2' }),
    })
    store.set('user_7_dashboard_99', {
      key: 'user_7_dashboard_99',
      version: 1,
      value: JSON.stringify({
        id: '99',
        type: 'dashboard',
        title: 'Executive UDD #99',
        updatedAt: '2026-11-01T10:10:00Z',
        createdBy: '7',
      }),
    })
    expect(searchArtifactsCount).toBe(0)
    const cachedArtifactsAfterLoad = await listUserArtifacts(mockSdk, '7')
    expect(searchArtifactsCount).toBe(1)
    expect(cachedArtifactsAfterLoad.map((a) => `${a.id}:${a.title}`)).toEqual([
      '99:Executive UDD #99',
      '42:Revenue App v2',
    ])
    // Second listUserArtifacts call hits SWR cache with 0 extra sdk.search_artifacts calls
    expect((await listUserArtifacts(mockSdk, '7')).map((a) => a.id)).toEqual(['99', '42'])
    expect(searchArtifactsCount).toBe(1)
    expect(
      readSwrCache<UserArtifactIndexItem[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map((a) => a.id)
    ).toEqual(['99', '42'])

    await deleteUserArtifact(mockSdk, '7', 'app', '42', true)
    expect(deleteArtifactCount).toBe(1)
    expect(searchArtifactsCount).toBe(1)
    expect(svc.getCachedVersion('user_7_app_42')).toBeUndefined()
    expect(svc.getCachedVersion('obj_app_42')).toBeUndefined()
    expect((await listUserArtifacts(mockSdk, '7')).map((a) => a.id)).toEqual(['99'])
    expect(
      readSwrCache<UserArtifactIndexItem[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map((a) => a.id)
    ).toEqual(['99'])

    await deleteUserConversation(mockSdk, '7', 'conv_42')
    expect(await loadUserConversations(mockSdk, '7')).toEqual([])
    expect(readSwrCache<ConversationRecord[]>(['artifact:conversations', ARTIFACT_NAMESPACE, '7'])).toEqual([])
    expect(searchArtifactsCount).toBe(1)
  })

  test('21. requires thought on RUN_LOOKER_CODEMODE_TOOL & LKR_CLI_BRIDGE_TOOL, extracts structured activity steps, and surfaces thought in onStatus, onProgressSteps, and write-permission requests (Issue #56)', async () => {
    // 1. Tool schema definitions
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.required).toEqual(
      expect.arrayContaining(['code', 'thought'])
    )
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.thought).toMatchObject({
      type: 'string',
    })
    expect(LKR_CLI_BRIDGE_TOOL.parameters.properties.thought).toMatchObject({
      type: 'string',
    })
    expect(AGENTS_MD).toContain('thought')

    // 2. extractInteractionActivitySteps across thought, codemode, cli_bridge, code_execution, file, and skill steps
    const multiPartSummary = [
      { type: 'text', text: '**Inspecting Explore Schema**\nChecking fields and measures in thelook::order_items.' },
      { type: 'text', text: 'Selecting top 4 executive KPIs.' },
    ]
    expect(extractThoughtText(multiPartSummary)).toBe(
      '**Inspecting Explore Schema**\nChecking fields and measures in thelook::order_items.\n\nSelecting top 4 executive KPIs.'
    )
    expect(extractThoughtText({ foo: 'bar' })).toBe('')

    const arrayThoughtSteps = extractInteractionActivitySteps({
      status: 'in_progress',
      steps: [
        { id: 's_thought_arr', type: 'thought', summary: multiPartSummary },
        { id: 's_thought_empty_obj', type: 'thought', summary: [{ type: 'unknown', opaque: { nested: true } }] },
      ],
      outputs: [
        {
          id: 'out_thought_arr',
          type: 'thought',
          thought: { content: [{ type: 'text', text: '**Validating LookML**\nRunning offline schema checks.' }] },
        },
      ],
    })
    expect(arrayThoughtSteps).toEqual([
      {
        id: 's_thought_arr',
        kind: 'thought',
        title: 'Inspecting Explore Schema',
        detail: 'Checking fields and measures in thelook::order_items.\n\nSelecting top 4 executive KPIs.',
        status: 'done',
      },
      {
        id: 'out_thought_arr',
        kind: 'thought',
        title: 'Validating LookML',
        detail: 'Running offline schema checks.',
        status: 'running',
      },
    ])
    expect(JSON.stringify(arrayThoughtSteps)).not.toContain('[object Object]')
    expect(summarizeProgress(null)).toBe('Thinking...')
    expect(summarizeProgress({ status: 'in_progress', steps: [] })).toBe('Thinking...')
    expect(
      summarizeProgress({ status: 'in_progress', steps: [{ id: 's_thought_arr', type: 'thought', summary: multiPartSummary }] })
    ).toBe('Inspecting Explore Schema')
    expect(
      summarizeProgress({
        status: 'in_progress',
        outputs: [{ id: 'out_thought_arr', type: 'thought', thought: { content: [{ type: 'text', text: '**Validating LookML**\nRunning offline schema checks.' }] } }],
      })
    ).toBe('Validating LookML')
    expect(
      summarizeProgress({
        status: 'in_progress',
        steps: [{ id: 's_cm_progress', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: 'Querying monthly revenue and brand share from thelook::order_items', code: 'res = 1' } }],
      })
    ).toBe('Querying monthly revenue and brand share from thelook::order_items')

    const sampleSteps = extractInteractionActivitySteps({
      status: 'in_progress',
      steps: [
        {
          id: 's_thought_1',
          type: 'thought',
          thought: {
            summary: 'Planning 24-column Executive KPI dashboard layout',
            text: 'Checking order_items dimensions and measures before building tiles.',
          },
        },
        {
          id: 's_cm_1',
          type: 'function_call',
          name: 'run_looker_codemode',
          arguments: {
            thought: 'Querying monthly revenue and brand share from thelook::order_items',
            code: 'res = sdk.run_inline_query("json", {"model": "thelook", "view": "order_items", "fields": ["order_items.total_sale_price"]})\nd = sdk.create_dashboard({"title": "Exec KPI"})',
          },
        },
        {
          id: 's_bridge_1',
          type: 'function_call',
          name: 'lkr_cli_extension_bridge',
          arguments: {
            kind: 'sdk_request',
            method: 'GET',
            path: '/projects/thelook/files',
          },
        },
        {
          id: 's_exec_1',
          type: 'code_execution_call',
          language: 'BASH',
          code: 'python3 /workspace/bundle_app.py --app-dir /workspace/apps/conv_1 --stdin "Exec App" << \'EOF\'\nimport os\nEOF',
        },
        {
          id: 's_file_1',
          type: 'view_file_call',
          path: '/workspace/schema.md',
          description: 'Reading compiled Explore schema',
        },
        {
          id: 's_skill_1',
          type: 'skill_lookup_call',
          skill: 'lookml-field-curation',
          description: 'Loading field curation rubric',
        },
      ],
      outputs: [
        {
          type: 'thought',
          summary: 'Planning 24-column Executive KPI dashboard layout',
        },
      ],
    })

    expect(sampleSteps).toHaveLength(6)
    expect(sampleSteps[0]).toMatchObject({
      id: 's_thought_1',
      kind: 'thought',
      title: 'Planning 24-column Executive KPI dashboard layout',
      detail: 'Checking order_items dimensions and measures before building tiles.',
    })
    expect(sampleSteps[1]).toMatchObject({
      id: 's_cm_1',
      kind: 'codemode',
      title: 'Querying monthly revenue and brand share from thelook::order_items',
      language: 'PYTHON',
    })
    expect(sampleSteps[1].detail).toContain('sdk.run_inline_query')
    expect(sampleSteps[1].detail).toContain('sdk.create_dashboard')
    expect(sampleSteps[2]).toMatchObject({
      id: 's_bridge_1',
      kind: 'cli_bridge',
      title: 'GET /projects/thelook/files',
      detail: 'GET /projects/thelook/files',
    })
    expect(sampleSteps[3]).toMatchObject({
      id: 's_exec_1',
      kind: 'code_execution',
      language: 'BASH',
    })
    expect(sampleSteps[3].title).toContain('bundle_app.py')
    expect(sampleSteps[4]).toMatchObject({
      id: 's_file_1',
      kind: 'file',
    })
    expect(sampleSteps[4].title).toContain('/workspace/schema.md')
    expect(sampleSteps[4].title).toContain('Reading compiled Explore schema')
    expect(sampleSteps[5]).toMatchObject({
      id: 's_skill_1',
      kind: 'skill',
    })
    expect(sampleSteps[5].title).toContain('lookml-field-curation')
    expect(sampleSteps[5].title).toContain('Loading field curation rubric')

    // 3. runAntigravityTurn invokes onProgressSteps, surfaces call.arguments.thought via onStatus and onRequestWritePermission (req.thought), and returns activitySteps
    const statusHistory: string[] = []
    const progressSnapshots: AntigravityActivityStep[][] = []
    const permissionRequests: CodeModePermissionRequest[] = []
    let interactionCallIdx = 0

    const mockExtensionSDK = {
      lookerHostData: { extensionId: 'dab::test' },
      serverProxy: async () => {
        interactionCallIdx += 1
        const arrThoughtStep = { id: 'step_thought_arr', type: 'thought', summary: multiPartSummary }
        if (interactionCallIdx === 1) {
          return {
            ok: true,
            status: 200,
            body: { id: 'int_issue56_1', environment_id: 'env_issue56', status: 'in_progress', steps: [arrThoughtStep] },
          }
        }
        if (interactionCallIdx === 2) {
          return {
            ok: true,
            status: 200,
            body: {
              id: 'int_issue56_1',
              environment_id: 'env_issue56',
              status: 'requires_action',
              steps: [
                arrThoughtStep,
                {
                  id: 'step_thought_1',
                  type: 'thought',
                  summary: 'Designing Executive KPI dashboard in Looker',
                },
                {
                  id: 'call_cm_56',
                  type: 'function_call',
                  name: 'run_looker_codemode',
                  arguments: {
                    thought: 'Creating executive KPI dashboard with 4 tiles',
                    code: 'd = create_dashboard({"title": "Executive KPI", "folder_id": "1"})\nreturn emit_native_bundle(d, content_type="dashboard", id=d["id"], title="Executive KPI")',
                  },
                },
              ],
            },
          }
        }
        return {
          ok: true,
          status: 200,
          body: {
            id: 'int_issue56_2',
            environment_id: 'env_issue56',
            status: 'completed',
            steps: [
              arrThoughtStep,
              {
                id: 'step_thought_1',
                type: 'thought',
                summary: 'Designing Executive KPI dashboard in Looker',
              },
              {
                id: 'call_cm_56',
                type: 'function_call',
                name: 'run_looker_codemode',
                arguments: {
                  thought: 'Creating executive KPI dashboard with 4 tiles',
                  code: 'd = create_dashboard({"title": "Executive KPI", "folder_id": "1"})\nreturn emit_native_bundle(d, content_type="dashboard", id=d["id"], title="Executive KPI")',
                },
              },
              {
                type: 'function_result',
                name: 'run_looker_codemode',
                call_id: 'call_cm_56',
                result: JSON.stringify({
                  NATIVE_CONTENT_BUNDLE: {
                    id: '99',
                    content_type: 'dashboard',
                    title: 'Executive KPI',
                    folder_id: '1',
                  },
                }),
              },
            ],
            output_text: 'Created Executive KPI dashboard #99.',
          },
        }
      },
    }

    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      authSession: {
        transport: {
          request: async (
            method: string,
            pathStr: string,
            _qp?: unknown,
            body?: { title?: string }
          ) => ({
            ok: true,
            value: { id: '99', title: body?.title || 'Executive KPI', method, path: pathStr },
          }),
        },
      },
    })

    const spyCodeMode = jest
      .spyOn(LkrCodeMode, 'runPythonCode')
      .mockImplementationOnce(async (opts) => {
        if (opts?.onPermissionRequest) {
          await opts.onPermissionRequest({
            operation: 'create_dashboard',
            httpMethod: 'POST',
            path: '/api/4.0/dashboards',
            args: { body: { title: 'Executive KPI' } },
          })
        }
        return JSON.stringify({
          NATIVE_CONTENT_BUNDLE: {
            id: '99',
            content_type: 'dashboard',
            title: 'Executive KPI',
            folder_id: '1',
          },
        })
      })

    const turnResult = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      auth: { mode: 'apikey', apiKey: '' },
      session: { environmentId: 'env_issue56', conversationId: 'conv_56' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Create an Executive KPI dashboard',
      requirePermission: true,
      onRequestWritePermission: async (req) => {
        permissionRequests.push(req)
        return 'allow_once'
      },
      onProgressSteps: (steps) => {
        progressSnapshots.push(steps)
      },
      pollScheduleMs: [0],
      onStatus: (s) => statusHistory.push(s),
    })
    spyCodeMode.mockRestore()

    expect(statusHistory).toContain('Inspecting Explore Schema')
    expect(statusHistory).toContain('Creating executive KPI dashboard with 4 tiles')
    expect(statusHistory.join('\n')).not.toContain('[object Object]')
    expect(statusHistory.join('\n')).not.toContain('Status: in_progress')
    expect(permissionRequests.length).toBeGreaterThanOrEqual(1)
    expect(permissionRequests[0]).toMatchObject({
      operation: 'create_dashboard',
      thought: 'Creating executive KPI dashboard with 4 tiles',
    })
    expect(progressSnapshots.length).toBeGreaterThanOrEqual(1)
    expect(turnResult.activitySteps).toBeDefined()
    expect(JSON.stringify(turnResult.activitySteps)).not.toContain('[object Object]')
    expect(turnResult.activitySteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'step_thought_arr',
          kind: 'thought',
          title: 'Inspecting Explore Schema',
          detail: 'Checking fields and measures in thelook::order_items.\n\nSelecting top 4 executive KPIs.',
          status: 'done',
        }),
        expect.objectContaining({
          kind: 'thought',
          title: 'Designing Executive KPI dashboard in Looker',
          status: 'done',
        }),
        expect.objectContaining({
          kind: 'codemode',
          title: 'Creating executive KPI dashboard with 4 tiles',
          status: 'done',
        }),
      ])
    )
    expect(typeof turnResult.thinkingDurationSec).toBe('number')
  })

  test('22. renames Python Tile to Script in STUDIO_MODES and provides open-ended default starter prompts (Issue #59)', () => {
    expect(STUDIO_MODES.find((m) => m.mode === 'tile')?.label).toBe('Script')
    expect(DEFAULT_STARTER_PROMPTS.length).toBeGreaterThanOrEqual(3)
    for (const item of DEFAULT_STARTER_PROMPTS) {
      expect(item.id.length).toBeGreaterThan(0)
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.prompt.length).toBeGreaterThan(10)
      expect(item.prompt).not.toMatch(/search_content|lookml_model_explore|Solr/i)
    }
  })

}
