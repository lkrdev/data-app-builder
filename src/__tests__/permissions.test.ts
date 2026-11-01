import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ARTIFACT_NAMESPACE,
  ArtifactService,
  buildDenseExploreSchema,
  CA_AGENT_SELECTION_REQUEST_TAG,
  classifyLooker404Error,
  classifyStudioUseCase,
  clearArtifactServiceCache,
  clearLookerMetadataCache,
  coalesceLookerMetadataRequest,
  ConversationRecord,
  createDeduplicatedLookerSdkProxy,
  createLookerCaConversation,
  deleteUserArtifact,
  deleteUserConversation,
  extractResolvedUseCase,
  fetchInitialLookerMetadata,
  fetchLookerCaAgentsCatalog,
  formatUserConversationsArtifactKey,
  formatUserConversationsKey,
  formatUserEnvArtifactKey,
  getAllowedUseCases,
  getArtifactService,
  listUserArtifacts,
  loadUserConversations,
  loadUserEnvironmentId,
  normalizeStudioThemeMode,
  parseCaAgentSelectionResponse,
  parseStudioRoute,
  rawLookerRequest,
  readSwrCache,
  resolveStudioTheme,
  resolveSystemTheme,
  resolveUserCapabilities,
  saveUserArtifact,
  saveUserConversation,
  saveUserEnvironmentId,
  selectCaAgentViaIsolatedSubagent,
  STUDIO_THEME_STORAGE_KEY,
} from '../lookerApi'
import {
  AGENTS_MD,
  ANTIGRAVITY_ALLOWED_MODELS,
  BOOTSTRAP_LOOKML_PY,
  BOOTSTRAP_SANDBOX_SH,
  buildWorkspaceSources,
  BUNDLE_APP_PY,
  computeLkrExtensionCacheKey,
  CONCURRENT_POLL_SCHEDULE_MS,
  CONVERSATION_LABEL_REQUEST_TAG,
  DASHBOARD_CODEMODE_PREAMBLE_PY,
  DEFAULT_ANTIGRAVITY_MODEL,
  executeLkrExtensionToolRequest,
  extractInteractionActivitySteps,
  extractLkrExtensionToolRequests,
  generateConversationLabel,
  getSharedEnvExploreSchemas,
  isEnvironmentNotFoundError,
  LKR_DEV_CLI_SPEC,
  LKR_DEV_CLI_VERSION,
  listAvailableAntigravityModels,
  LKR_CLI_BRIDGE_TOOL,
  LKR_CLI_SITECUSTOMIZE_PY,
  LkrCodeMode,
  prewarmOrWakeAntigravityEnvironment,
  recordSharedEnvExploreSchema,
  resolveAdaptivePollScheduleMs,
  runAntigravityTurn,
  sanitizeConversationLabel,
} from '../antigravity'
import {
  createLookerEmbedPreloadController,
  normalizeLookerEmbedUrl,
  resolveLookerEmbedTarget,
} from '../components/StudioWorkspace'

describe('Looker 4-Layer Permissions, Model->Project Expansion & 404 Diagnostics', () => {
  test('1. evaluates Role = PermissionSet x ModelSet per role without cross-role model bleeding', () => {
    const roles = [
      {
        id: '10',
        name: 'Ecommerce Explorer',
        permission_set: {
          all_access: false,
          permissions: ['access_data', 'see_looks', 'see_user_dashboards', 'explore', 'save_content', 'save_dashboards'],
        },
        model_set: { all_access: false, models: ['model_a'] },
      },
      {
        id: '11',
        name: 'HR LookML Developer',
        permission_set: { all_access: false, permissions: ['access_data', 'see_lookml', 'develop'] },
        model_set: { all_access: false, models: ['model_b'] },
      },
    ]
    const models = [
      { name: 'model_a', label: 'Model A', project_name: 'project_a', allowed_db_connection_names: ['conn_a'], explores: [{ name: 'orders', hidden: false }] },
      { name: 'model_b', label: 'Model B', project_name: 'project_b', allowed_db_connection_names: ['conn_b'], explores: [{ name: 'employees', hidden: false }] },
    ]
    const folders = [
      { id: '1', name: 'Shared', can: { show: true, edit_content: false } },
      { id: '5', name: 'Personal', is_personal: true, can: { show: true, edit_content: true } },
    ]

    const caps = resolveUserCapabilities({ user: { id: '42', personal_folder_id: '5' }, roles, models, folders })
    expect(caps.isAdmin).toBe(false)
    expect(caps.rolesLoaded).toBe(true)
    expect(Array.from(caps.modelsByPermission.explore || [])).toEqual(['model_a'])
    expect(Array.from(caps.explorableModels)).toEqual(['model_a'])
    expect(caps.explorableModels.has('model_b')).toBe(false)
    expect(Array.from(caps.modelsByPermission.develop || [])).toEqual(['model_b'])
    expect(Array.from(caps.developableProjects)).toEqual(['project_b'])
    expect(caps.developableProjects.has('project_a')).toBe(false)
    expect(Array.from(caps.editableFolderIds)).toEqual(['5'])
    expect(caps.editableFolderIds.has('1')).toBe(false)
    expect(caps.tools.app.enabled).toBe(true)
    expect(caps.tools.app.readOnly).toBe(false)
    expect(caps.tools.lookml.enabled).toBe(true)
    expect(caps.tools.lookml.readOnly).toBe(false)
    expect(caps.canConfigureExtension).toBe(true)
    expect(caps.canManageUserAttributes).toBe(false)
  })

  test('2. applies Model -> Project expansion while keeping explorableModels restricted', () => {
    const roles = [
      {
        id: '20',
        name: 'Explore Model A',
        permission_set: { all_access: false, permissions: ['access_data', 'explore'] },
        model_set: { all_access: false, models: ['model_a'] },
      },
      {
        id: '21',
        name: 'Develop Model B1 in Project X',
        permission_set: { all_access: false, permissions: ['access_data', 'see_lookml', 'develop', 'use_sql_runner'] },
        model_set: { all_access: false, models: ['model_b1'] },
      },
    ]
    const models = [
      { name: 'model_a', project_name: 'project_y', allowed_db_connection_names: ['bq_y'], explores: [{ name: 'exp_a', hidden: false }] },
      { name: 'model_b1', project_name: 'project_x', allowed_db_connection_names: ['bq_x'], explores: [{ name: 'exp_b1', hidden: false }] },
      { name: 'model_b2', project_name: 'project_x', allowed_db_connection_names: ['bq_x2'], explores: [{ name: 'exp_b2', hidden: false }] },
    ]

    const caps = resolveUserCapabilities({ user: { id: '7' }, roles, models, folders: [] })
    expect(caps.developableProjects.has('project_x')).toBe(true)
    expect(caps.developableProjects.has('project_y')).toBe(false)
    expect(caps.readableProjects.has('project_x')).toBe(true)
    expect(Array.from(caps.explorableModels)).toEqual(['model_a'])
    expect(caps.explorableModels.has('model_b1')).toBe(false)
    expect(caps.explorableModels.has('model_b2')).toBe(false)
    expect(Array.from(caps.sqlRunnerConnections)).toEqual(['bq_x'])
    expect(caps.tools.app.enabled).toBe(true)
    expect(caps.tools.app.readOnly).toBe(true)
    expect(caps.tools.app.missingPermissions).toEqual(['save_content', 'save_dashboards'])
  })

  test('3. falls back gracefully when sdk.user_roles returns 404 for non-see_users user', async () => {
    const mockSdk: any = {
      ok: async (p: any) => p,
      me: async () => ({ id: '99', display_name: 'Standard Analyst', personal_folder_id: '50' }),
      user_roles: async () => {
        throw new Error('404 Not found: https://docs.looker.com/r/err/4.0/404/get/users/:user_id/roles')
      },
      all_lookml_models: async () => [
        {
          name: 'thelook',
          label: 'TheLook',
          project_name: 'thelook_project',
          allowed_db_connection_names: ['bq_conn'],
          can: { show: true, develop: true },
          explores: [{ name: 'order_items', hidden: false }],
        },
      ],
      all_folders: async () => [
        { id: '1', name: 'Shared', can: { show: true, edit_content: false } },
        { id: '50', name: 'Personal', is_personal: true, can: { show: true, edit_content: true } },
      ],
    }

    const meta = await fetchInitialLookerMetadata(mockSdk)
    expect(meta.roles).toBeNull()
    expect(meta.capabilities.rolesLoaded).toBe(false)
    expect(Array.from(meta.capabilities.explorableModels)).toEqual(['thelook'])
    expect(Array.from(meta.capabilities.developableProjects)).toEqual(['thelook_project'])
    expect(Array.from(meta.capabilities.sqlRunnerConnections)).toEqual(['bq_conn'])
    expect(Array.from(meta.capabilities.editableFolderIds)).toEqual(['50'])
    expect(meta.capabilities.tools.app.enabled).toBe(true)
    expect(meta.capabilities.tools.lookml.enabled).toBe(true)
  })

  test('4. classifies Role-Denied 404 vs inline_extensions Feature-Disabled 404 accurately', async () => {
    const roleDenied = classifyLooker404Error(
      404,
      '/dashboards',
      JSON.stringify({ message: 'Not found', documentation_url: 'https://docs.looker.com/r/err/4.0/404/post/dashboards' })
    )
    expect(roleDenied.kind).toBe('role_denied')
    expect(roleDenied.remediation).toMatch(/Role-Denied 404.*Admin > Roles/i)

    const featureDisabledSinatra = classifyLooker404Error(
      404,
      '/data_app_extension',
      '<!DOCTYPE html><html><body><h1>Sinatra::NotFound</h1></body></html>'
    )
    expect(featureDisabledSinatra.kind).toBe('feature_disabled')
    expect(featureDisabledSinatra.remediation).toMatch(/inline_extensions/i)

    const featureDisabledBareDoc = classifyLooker404Error(
      404,
      '/data_app_extension',
      JSON.stringify({ message: 'Not found', documentation_url: 'https://docs.looker.com/' })
    )
    expect(featureDisabledBareDoc.kind).toBe('feature_disabled')
    expect(featureDisabledBareDoc.remediation).toMatch(/inline_extensions/i)

    const mockSdkWith404: any = {
      authSession: {
        transport: {
          rawRequest: async () => ({
            ok: false,
            statusCode: 404,
            body: JSON.stringify({ message: 'Not found', documentation_url: 'https://docs.looker.com/' }),
          }),
        },
      },
    }
    await expect(
      rawLookerRequest(mockSdkWith404, 'POST', '/data_app_extension', undefined, {})
    ).rejects.toThrow(/404 feature_disabled.*inline_extensions/i)
  })

  test('5. evaluates live dev-argolis Looker Core IAM Admin payload and per-pillar Health Check gating', () => {
    const devArgolisCaps = resolveUserCapabilities({
      user: {
        id: '1',
        display_name: 'Super Admin',
        personal_folder_id: '5',
        is_iam_admin: true,
        can: { create: true, destroy: true, use_admin_agent: true },
      },
      roles: [
        {
          id: '8',
          name: 'Gemini',
          can: { create: true, delete: true, update: true },
          permission_set: { all_access: false, permissions: ['chat_with_agent', 'chat_with_explore', 'gemini_in_looker', 'save_agents'] },
          model_set: { all_access: true, models: ['thelook', 'agentic_thelook'] },
        },
      ],
      models: [
        { name: 'thelook', project_name: 'thelook_event', allowed_db_connection_names: ['default_bigquery_connection'] },
        { name: 'agentic_thelook', project_name: 'agentic-thelook', allowed_db_connection_names: ['default_bigquery_connection'] },
        { name: 'deploytobarerepo_temp', project_name: 'deploytobarerepo_temp', allowed_db_connection_names: ['default_bigquery_connection'] },
      ],
      folders: [
        { id: '1', name: 'Shared', can: { edit_content: true, show: true } },
        { id: '5', name: 'Super Admin', is_personal: true, can: { edit_content: true, show: true } },
      ],
    })

    expect(devArgolisCaps.isAdmin).toBe(true)
    expect(devArgolisCaps.developableProjects.has('thelook_event')).toBe(true)
    expect(devArgolisCaps.developableProjects.has('agentic-thelook')).toBe(true)
    expect(devArgolisCaps.developableProjects.has('deploytobarerepo_temp')).toBe(true)
    expect(devArgolisCaps.sqlRunnerConnections.has('default_bigquery_connection')).toBe(true)
    expect(devArgolisCaps.canConfigureExtension).toBe(true)
    expect(devArgolisCaps.canManageUserAttributes).toBe(true)

    const restrictedAnalyst = resolveUserCapabilities({
      user: { id: '25', personal_folder_id: '99' },
      roles: [
        {
          id: '3',
          name: 'LookML Reader',
          permission_set: { all_access: false, permissions: ['access_data', 'see_lookml'] },
          model_set: { all_access: false, models: ['thelook'] },
        },
      ],
      models: [{ name: 'thelook', project_name: 'thelook_event', allowed_db_connection_names: ['default_bigquery_connection'] }],
      folders: [],
    })

    expect(restrictedAnalyst.sqlRunnerConnections.size).toBe(0)
    expect(restrictedAnalyst.tools.lookml.enabled).toBe(true)
    expect(restrictedAnalyst.tools.lookml.readOnly).toBe(true)
    expect(restrictedAnalyst.tools.lookml.missingPermissions).toEqual(['develop'])
    expect(restrictedAnalyst.tools.health.enabled).toBe(true)
    expect(restrictedAnalyst.tools.health.missingPermissions).toEqual(['see_system_activity', 'develop', 'use_sql_runner'])
    expect(restrictedAnalyst.canConfigureExtension).toBe(false)
    expect(restrictedAnalyst.canManageUserAttributes).toBe(false)
  })

  test('6. discovers /v1beta/models, intersects with ANTIGRAVITY_ALLOWED_MODELS, and passes agent_config.model', async () => {
    expect(DEFAULT_ANTIGRAVITY_MODEL).toBe('gemini-3.8-flash')
    expect(ANTIGRAVITY_ALLOWED_MODELS.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-4-argon',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
    ])
    expect(await listAvailableAntigravityModels({}, { mode: 'oauth' })).toEqual(
      ANTIGRAVITY_ALLOWED_MODELS
    )

    const calls: Array<{ url: string; method: string; body?: any }> = []
    const mockExtensionSDK = {
      serverProxy: async (url: string, init: any) => {
        calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(
            url.endsWith('/v1beta/models')
              ? {
                  models: [
                    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', description: 'Live 3.8 Flash' },
                    { name: 'models/gemini-4-argon', displayName: 'Gemini 4 Argon', description: 'Live 4 Argon' },
                    { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
                    { name: 'models/unrelated-embedding-001', displayName: 'Ignore Me' },
                  ],
                }
              : {
                  id: 'int_argon_1',
                  environment_id: 'env_argon_1',
                  status: 'completed',
                  output_text: 'Completed with Argon.',
                }
          ),
        }
      },
    }

    const discovered = await listAvailableAntigravityModels(mockExtensionSDK, { mode: 'apikey' })
    expect(discovered.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-4-argon',
      'gemini-3.5-flash-lite',
    ])
    expect(discovered[1].description).toBe('Live 4 Argon')

    const turnRes = await runAntigravityTurn({
      sdk: {} as any,
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      session: { toolType: 'app' },
      model: 'gemini-4-argon',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Build KPI app',
      onStatus: () => {},
    })
    expect(turnRes.assistantText).toBe('Completed with Argon.')
    const postCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1beta/interactions'))
    expect(postCall?.body?.agent_config).toEqual({
      type: 'antigravity',
      model: 'gemini-4-argon',
    })
    expect(postCall?.body?.environment?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/workspace/AGENTS.md', content: AGENTS_MD }),
      ])
    )
  })

  test('7. auto-labels conversations after Turn 1 via stateless side-request (tools=[], no previous_interaction_id) and persists to user_conversations:${me.id}', async () => {
    const rootAgentsMd = readFileSync(path.resolve(__dirname, '../../AGENTS.md'), 'utf8')
    expect(rootAgentsMd).toContain('## Conversation Labeling (Stateless Side-Request)')
    expect(rootAgentsMd).toContain(CONVERSATION_LABEL_REQUEST_TAG)
    expect(rootAgentsMd).toContain('3–6 words')
    expect(rootAgentsMd).toContain('lookup_skill')
    expect(AGENTS_MD).toContain('## Conversation Labeling (Stateless Side-Request)')
    expect(AGENTS_MD).toContain(CONVERSATION_LABEL_REQUEST_TAG)

    expect(
      sanitizeConversationLabel('"**Executive Order Revenue & Margin Breakdown.**"')
    ).toBe('Executive Order Revenue & Margin Breakdown')
    expect(
      sanitizeConversationLabel(
        'Title: Monthly Cohort Retention Analysis Across All Global Store Regions Today'
      )
    ).toBe('Monthly Cohort Retention Analysis Across All')
    expect(
      sanitizeConversationLabel('', 'Build an executive revenue dashboard on order_items')
    ).toBe('Build an executive revenue dashboard on')

    const apiCalls: Array<{ url: string; method: string; body?: any }> = []
    let pollCounter = 0
    const mockExtSDK = {
      serverProxy: async (url: string, init: any) => {
        const parsedBody = init?.body ? JSON.parse(init.body) : undefined
        apiCalls.push({ url, method: init?.method || 'GET', body: parsedBody })
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_label_stateless_1',
              status: 'in_progress',
            }),
          }
        }
        pollCounter += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_label_stateless_1',
            status: 'completed',
            output_text: '"Order Revenue & Margin Overview."',
          }),
        }
      },
    }

    const label = await generateConversationLabel({
      extensionSDK: mockExtSDK,
      auth: { mode: 'apikey' },
      environmentId: 'env_shared_1',
      userPrompt: 'Build a revenue and margin dashboard on order_items',
      assistantText: 'Created dashboard #42 with 3 KPI tiles and a trend chart.',
      model: 'gemini-3.5-flash-lite',
      pollScheduleMs: [1],
    })
    expect(label).toBe('Order Revenue & Margin Overview')
    expect(pollCounter).toBe(1)

    const postReq = apiCalls.find((c) => c.method === 'POST')
    expect(postReq).toBeDefined()
    expect(postReq?.body?.tools).toEqual([])
    expect(postReq?.body?.previous_interaction_id).toBeUndefined()
    expect('previous_interaction_id' in (postReq?.body || {})).toBe(false)
    expect(postReq?.body?.environment).toBe('env_shared_1')
    expect(postReq?.body?.input?.[0]?.text).toContain(CONVERSATION_LABEL_REQUEST_TAG)

    const store = new Map<string, any>()
    const mockArtifactSdk: any = {
      ok: async (p: any) => p,
      artifact: async ({ key }: { key: string }) => {
        const val = store.get(key)
        return val ? [{ key, version: 1, value: JSON.stringify(val) }] : []
      },
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) {
          store.set(u.key, JSON.parse(u.value))
        }
        return []
      },
    }

    expect(formatUserConversationsKey('42')).toBe('user_conversations:42')
    await saveUserConversation(mockArtifactSdk, '42', {
      id: 'conv_abc',
      type: 'app',
      label: 'Initial Fallback Title',
      interactionId: 'int_turn_1',
      environmentId: 'env_shared_1',
    })
    await saveUserConversation(mockArtifactSdk, '42', {
      id: 'conv_abc',
      type: 'app',
      label,
      interactionId: 'int_turn_1',
      environmentId: 'env_shared_1',
    })

    const savedConvs = await loadUserConversations(mockArtifactSdk, '42')
    expect(savedConvs).toHaveLength(1)
    expect(savedConvs[0].id).toBe('conv_abc')
    expect(savedConvs[0].label).toBe('Order Revenue & Margin Overview')
    expect(savedConvs[0].interactionId).toBe('int_turn_1')
  })

  test('8. persists, sorts, upserts, and deletes user_conversations:${me.id} in Looker Artifacts', async () => {
    expect(formatUserConversationsArtifactKey('1')).toBe('user_conversations:1')
    const store = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk: any = {
      ok: async (p: any) => p,
      artifact: async ({ key }: { key: string }) => {
        const hit = store.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, updates: any[]) => {
        for (const u of updates) {
          store.set(u.key, {
            key: u.key,
            version: (u.version ?? 0) + 1,
            value: u.value,
          })
        }
        return updates
      },
    }

    expect(await loadUserConversations(mockSdk, '1')).toEqual([])

    const c1: ConversationRecord = {
      id: 'conv_1',
      type: 'app',
      interactionId: 'int_1',
      content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      label: 'First App Conversation',
      createdAt: '2026-10-31T20:00:00Z',
      updatedAt: '2026-10-31T20:05:00Z',
    }
    const c2: ConversationRecord = {
      id: 'conv_2',
      type: 'dashboard',
      interactionId: 'int_2',
      content: { dashboardId: '7', lookId: '12' },
      label: 'Second UDD Conversation',
      createdAt: '2026-10-31T21:00:00Z',
      updatedAt: '2026-10-31T21:10:00Z',
    }

    await saveUserConversation(mockSdk, '1', c1)
    const afterTwo = await saveUserConversation(mockSdk, '1', c2)
    expect(afterTwo.map((c) => c.id)).toEqual(['conv_2', 'conv_1'])

    const afterUpsertC1 = await saveUserConversation(mockSdk, '1', {
      ...c1,
      interactionId: 'int_1_turn2',
      label: 'First App Conversation (Updated)',
      updatedAt: '2026-10-31T22:00:00Z',
    })
    expect(afterUpsertC1.map((c) => c.id)).toEqual(['conv_1', 'conv_2'])
    expect(afterUpsertC1[0].interactionId).toBe('int_1_turn2')
    expect(afterUpsertC1[0].createdAt).toBe('2026-10-31T20:00:00Z')

    const afterDelete = await deleteUserConversation(mockSdk, '1', 'conv_1')
    expect(afterDelete.map((c) => c.id)).toEqual(['conv_2'])
  })

  test('9. routes Auto use-case via AGENTS.md <USE_CASE>, intersects with user permissions, and seeds /workspace/AGENTS.md', async () => {
    expect(
      extractResolvedUseCase(
        '<USE_CASE>lookml</USE_CASE>\nUpdated view order_items.view.lkml.',
        'Help me with my model',
        ['app', 'dashboard', 'lookml', 'health-check', 'tile', 'conversational-analytics']
      )
    ).toBe('lookml')

    expect(
      extractResolvedUseCase(
        '<USE_CASE>lookml</USE_CASE>\nAttempting LookML edit.',
        'Add a measure to order_items.view.lkml',
        ['app', 'dashboard', 'conversational-analytics']
      )
    ).toBe('app')

    expect(
      extractResolvedUseCase(
        'Completed 3-pillar audit.',
        'Run a 3-pillar health check on thelook_event',
        ['app', 'health-check']
      )
    ).toBe('health-check')

    const explorerOnlyCaps = resolveUserCapabilities({
      user: { id: '2' },
      roles: [
        {
          id: '10',
          name: 'Explorer',
          permission_set: {
            all_access: false,
            permissions: ['access_data', 'explore', 'save_content', 'save_dashboards'],
          },
          model_set: { all_access: false, models: ['thelook'] },
        },
      ],
      models: [{ name: 'thelook', project_name: 'thelook_proj', allowed_db_connection_names: [] }],
      folders: [{ id: '5', can: { edit_content: true, save_content: true } }],
    })
    const allowedForExplorer = getAllowedUseCases(explorerOnlyCaps, [])
    expect(allowedForExplorer).toContain('app')
    expect(allowedForExplorer).toContain('dashboard')
    expect(allowedForExplorer).not.toContain('lookml')
    expect(allowedForExplorer).not.toContain('health-check')

    const capturedCalls: any[] = []
    const mockExt = {
      serverProxy: async (url: string, init: any) => {
        const body = init?.body ? JSON.parse(init.body) : undefined
        capturedCalls.push({ url, body })
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_auto_1',
            environment_id: 'env_auto_1',
            status: 'completed',
            output_text: '<USE_CASE>dashboard</USE_CASE>\nBuilt native Looker UDD.',
          }),
        }
      },
    }
    const turnRes = await runAntigravityTurn({
      sdk: {} as any,
      extensionSDK: mockExt,
      auth: { mode: 'apikey' },
      session: {},
      useCase: 'auto',
      allowedModes: ['app', 'dashboard'],
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Create a native Looker UDD dashboard for executive KPIs',
      onStatus: () => {},
    })
    expect(turnRes.resolvedUseCase).toBe('dashboard')
    expect(turnRes.assistantText).toBe('Built native Looker UDD.')
    const sentSources = capturedCalls[0]?.body?.environment?.sources || []
    expect(
      sentSources.some(
        (s: any) =>
          s.target === '/workspace/AGENTS.md' &&
          String(s.content).includes('## Use Case Auto-Classification (Turn 1 Routing)')
      )
    ).toBe(true)
  })

  test('10. persists single per-user environment_id in Looker Artifacts (user_env:${me.id}), shares it across 2 concurrent conversations with isolated /workspace/apps/${conversationId}/app.js paths, and sends sources only once on creation', async () => {
    expect(formatUserEnvArtifactKey('1')).toBe('user_env:1')
    expect(formatUserEnvArtifactKey('42')).toBe('user_env:42')

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk: any = {
      ok: async (p: any) => p,
      me: async () => ({ id: '1' }),
      artifact: async ({ key }: { namespace: string; key: string }) => {
        const hit = artifactStore.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, items: Array<{ key: string; value: string; version?: number }>) => {
        for (const item of items) {
          const prev = artifactStore.get(item.key)
          artifactStore.set(item.key, {
            key: item.key,
            version: (prev?.version || 0) + 1,
            value: item.value,
          })
        }
        return items
      },
    }

    expect(await loadUserEnvironmentId(mockSdk, '1')).toBeNull()

    const apiCalls: Array<{ url: string; method: string; body?: any }> = []
    let turnCounter = 0
    const mockExtensionSDK = {
      serverProxy: async (url: string, init: any) => {
        const body = init.body ? JSON.parse(init.body) : undefined
        apiCalls.push({ url, method: init.method, body })
        turnCounter += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: `int_turn_${turnCounter}`,
            environment_id: 'env_user_1_shared',
            status: 'completed',
            output_text: `Completed turn ${turnCounter}.`,
          }),
        }
      },
    }

    // Conversation A — Turn 1: no existing environmentId -> seeds environment: { type: 'remote', sources }
    const turnA1 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      conversationId: 'conv_alpha',
      auth: { mode: 'apikey' },
      session: { toolType: 'app', conversationId: 'conv_alpha' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Build Alpha revenue app',
      onStatus: () => {},
    })

    expect(turnA1.session.environmentId).toBe('env_user_1_shared')
    expect(turnA1.session.lastInteractionId).toBe('int_turn_1')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_user_1_shared')
    expect(apiCalls[0].body.environment).toEqual(
      expect.objectContaining({
        type: 'remote',
        sources: expect.arrayContaining([
          expect.objectContaining({ target: '/workspace/schema.md' }),
          expect.objectContaining({ target: '/workspace/bundle_app.py' }),
        ]),
      })
    )
    expect(apiCalls[0].body.previous_interaction_id).toBeUndefined()
    expect(apiCalls[0].body.input[0].text).toContain('/workspace/apps/conv_alpha/app.js')
    expect(apiCalls[0].body.input[0].text).toContain('--app-dir /workspace/apps/conv_alpha')

    // Conversation B — Turn 1: reuses shared environment_id string WITHOUT sources and WITHOUT Conversation A's previous_interaction_id
    const sharedEnvFromLooker = (await loadUserEnvironmentId(mockSdk, '1')) || undefined
    const turnB1 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: sharedEnvFromLooker,
      conversationId: 'conv_beta',
      auth: { mode: 'apikey' },
      session: { toolType: 'app', environmentId: sharedEnvFromLooker, conversationId: 'conv_beta' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Build Beta inventory app',
      onStatus: () => {},
    })

    expect(turnB1.session.environmentId).toBe('env_user_1_shared')
    expect(turnB1.session.lastInteractionId).toBe('int_turn_2')
    expect(apiCalls[1].body.environment).toBe('env_user_1_shared')
    expect(apiCalls[1].body.previous_interaction_id).toBeUndefined()
    expect(apiCalls[1].body.input[0].text).toContain('/workspace/apps/conv_beta/app.js')
    expect(apiCalls[1].body.input[0].text).toContain('--app-dir /workspace/apps/conv_beta')
    expect(apiCalls[1].body.input[0].text).not.toContain('conv_alpha')

    // Conversation A — Turn 2: continues Conversation A's previous_interaction_id on the shared environment
    const turnA2 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: sharedEnvFromLooker,
      conversationId: 'conv_alpha',
      auth: { mode: 'apikey' },
      session: turnA1.session,
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Add YoY KPI to Alpha',
      onStatus: () => {},
    })

    expect(turnA2.session.lastInteractionId).toBe('int_turn_3')
    expect(apiCalls[2].body.environment).toBe('env_user_1_shared')
    expect(apiCalls[2].body.previous_interaction_id).toBe('int_turn_1')
    expect(apiCalls[2].body.input[0].text).toContain('/workspace/apps/conv_alpha/app.js')

    // Conversation B — Turn 2: continues Conversation B's previous_interaction_id on the shared environment
    const turnB2 = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: sharedEnvFromLooker,
      conversationId: 'conv_beta',
      auth: { mode: 'apikey' },
      session: turnB1.session,
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Add stockout chart to Beta',
      onStatus: () => {},
    })

    expect(turnB2.session.lastInteractionId).toBe('int_turn_4')
    expect(apiCalls[3].body.environment).toBe('env_user_1_shared')
    expect(apiCalls[3].body.previous_interaction_id).toBe('int_turn_2')
    expect(apiCalls[3].body.input[0].text).toContain('/workspace/apps/conv_beta/app.js')
  })

  test('11. auto-recovers on 404 (Environment not found) in runAntigravityTurn and prewarmOrWakeAntigravityEnvironment by creating { type: "remote", sources } and updating user_env:${me.id}', async () => {
    expect(isEnvironmentNotFoundError(new Error("Antigravity API error (404): Environment 'env_stale' not found"))).toBe(true)
    expect(isEnvironmentNotFoundError({ status: 404, message: 'Not Found' })).toBe(true)
    expect(isEnvironmentNotFoundError(new Error('Antigravity API error (500): Internal error'))).toBe(false)

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk: any = {
      ok: async (p: any) => p,
      me: async () => ({ id: '1' }),
      artifact: async ({ key }: { namespace: string; key: string }) => {
        const hit = artifactStore.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, items: Array<{ key: string; value: string; version?: number }>) => {
        for (const item of items) {
          const prev = artifactStore.get(item.key)
          artifactStore.set(item.key, {
            key: item.key,
            version: (prev?.version || 0) + 1,
            value: item.value,
          })
        }
        return items
      },
    }

    await saveUserEnvironmentId(mockSdk, '1', 'env_stale_404')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_stale_404')

    const postedPayloads: any[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init: any) => {
        const body = init.body ? JSON.parse(init.body) : undefined
        postedPayloads.push(body)
        if (typeof body?.environment === 'string' && body.environment.includes('stale')) {
          return {
            ok: false,
            status: 404,
            body: JSON.stringify({
              error: { message: `Environment '${body.environment}' not found` },
            }),
          }
        }
        const nextEnv =
          postedPayloads.length <= 2 ? 'env_recovered_999' : 'env_prewarm_recovered_777'
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: `int_recovered_${postedPayloads.length}`,
            environment_id: nextEnv,
            status: 'completed',
            output_text: 'Recovered on fresh environment.',
          }),
        }
      },
    }

    let callbackEnvId = ''
    const recoveredTurn = await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      userId: '1',
      environmentId: 'env_stale_404',
      conversationId: 'conv_alpha',
      onEnvironmentUpdated: (id) => {
        callbackEnvId = id
      },
      auth: { mode: 'apikey' },
      session: { toolType: 'app', environmentId: 'env_stale_404', conversationId: 'conv_alpha' },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      existingAppCode: 'export class AlphaApp {}',
      userPrompt: 'Update Alpha after 404 expiry',
      onStatus: () => {},
    })

    expect(postedPayloads).toHaveLength(2)
    expect(postedPayloads[0].environment).toBe('env_stale_404')
    expect(postedPayloads[1].environment).toEqual(
      expect.objectContaining({
        type: 'remote',
        sources: expect.arrayContaining([
          expect.objectContaining({
            target: '/workspace/apps/conv_alpha/app.js',
            content: 'export class AlphaApp {}',
          }),
        ]),
      })
    )
    expect(recoveredTurn.session.environmentId).toBe('env_recovered_999')
    expect(callbackEnvId).toBe('env_recovered_999')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_recovered_999')

    const prewarmRecovered = await prewarmOrWakeAntigravityEnvironment({
      sdk: mockSdk,
      userId: '1',
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      toolType: 'lookml',
      environmentId: 'env_stale_prewarm_404',
      existingSession: { toolType: 'lookml', environmentId: 'env_stale_prewarm_404' },
      schemaMarkdown: '# Schema',
    })

    expect(prewarmRecovered.status).toBe('prelaunched')
    expect(prewarmRecovered.session.environmentId).toBe('env_prewarm_recovered_777')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_prewarm_recovered_777')
  })

  test('12. routes Conversational Analytics via stateless isolated sub-agent (no previous_interaction_id, tools=[]), creates Looker CA conversation, and persists to user_conversations:${me.id}', async () => {
    expect(
      classifyStudioUseCase('Why did gross margin drop in Q3 compared to Q2?', 'auto', [
        'app',
        'dashboard',
        'lookml',
        'health-check',
        'tile',
        'conversational-analytics',
      ])
    ).toBe('conversational-analytics')
    expect(
      classifyStudioUseCase('Build an Executive Revenue Data App on order_items', 'auto', [
        'app',
        'dashboard',
        'lookml',
        'health-check',
        'tile',
        'conversational-analytics',
      ])
    ).toBe('app')

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk: any = {
      ok: async (p: any) => p,
      me: async () => ({ id: '1' }),
      search_agents: async () => [
        {
          id: 'ca_agent_ecommerce',
          name: 'eCommerce Analytics Agent',
          description: 'Answers order revenue, gross margin, and retention questions.',
          explores: ['thelook::order_items', 'thelook::users'],
        },
        {
          id: 'ca_agent_bq_ops',
          name: 'BigQuery Cost & Jobs Agent',
          description: 'Answers BigQuery slot usage, bytes billed, and streaming buffer questions.',
          explores: ['bigquery_information_schema::jobs_timeline'],
        },
      ],
      create_conversation: async (body: any) => ({
        id: 'ca_conv_9001',
        agent_id: body.agent_id,
        title: body.title,
      }),
      conversational_analytics_chat: async () => ({
        reply:
          'Streaming buffer usage peaked on looker-private-demo.thelook.events at 507.5 MB across 2.89M rows.',
      }),
      artifact: async ({ key }: { namespace: string; key: string }) => {
        const hit = artifactStore.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (_ns: string, items: Array<{ key: string; value: string; version?: number }>) => {
        for (const item of items) {
          const prev = artifactStore.get(item.key)
          artifactStore.set(item.key, {
            key: item.key,
            version: (prev?.version || 0) + 1,
            value: item.value,
          })
        }
        return items
      },
    }

    const catalog = await fetchLookerCaAgentsCatalog(mockSdk, [])
    expect(catalog).toHaveLength(2)
    expect(catalog[0].id).toBe('ca_agent_ecommerce')
    expect(catalog[1].id).toBe('ca_agent_bq_ops')

    const capturedPayloads: any[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init: any) => {
        const body = init.body ? JSON.parse(init.body) : undefined
        capturedPayloads.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_subagent_ca_1',
            status: 'completed',
            output_text:
              '<CA_AGENT_SELECTION>{"agent_id":"ca_agent_bq_ops","agent_name":"BigQuery Cost & Jobs Agent","rationale":"Question asks about BigQuery streaming buffer usage on jobs_timeline/streaming_timeline.","initial_question":"Which BigQuery tables have the highest streaming buffer usage?"}</CA_AGENT_SELECTION>',
          }),
        }
      },
    }

    const selection = await selectCaAgentViaIsolatedSubagent({
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      environmentId: 'env_shared_1',
      userPrompt: 'Which BigQuery tables have the highest streaming buffer usage?',
      agents: catalog,
      selectedExplores: [],
    })

    // Stateless isolated sub-agent call must NEVER pass previous_interaction_id and must pass tools: []
    expect(capturedPayloads).toHaveLength(1)
    expect(capturedPayloads[0].previous_interaction_id).toBeUndefined()
    expect(capturedPayloads[0].tools).toEqual([])
    expect(capturedPayloads[0].environment).toBe('env_shared_1')
    expect(capturedPayloads[0].input[0].text).toContain(CA_AGENT_SELECTION_REQUEST_TAG)

    expect(selection.agentId).toBe('ca_agent_bq_ops')
    expect(selection.agentName).toBe('BigQuery Cost & Jobs Agent')
    expect(selection.rationale).toContain('BigQuery streaming buffer usage')

    const parsedFallback = parseCaAgentSelectionResponse(
      'Unstructured output mentioning ca_agent_ecommerce',
      catalog,
      'What was Q4 revenue?'
    )
    expect(parsedFallback.agentId).toBe('ca_agent_ecommerce')

    const created = await createLookerCaConversation({
      sdk: mockSdk,
      agent: catalog[1],
      selection,
      userPrompt: 'Which BigQuery tables have the highest streaming buffer usage?',
    })
    expect(created.caConversationId).toBe('ca_conv_9001')
    expect(created.embedPath).toContain('/embed/conversations/ca_conv_9001')
    expect(created.assistantReply).toContain('507.5 MB')

    const savedList = await saveUserConversation(mockSdk, '1', {
      id: created.caConversationId,
      type: 'conversational-analytics',
      environmentId: 'env_shared_1',
      label: created.title,
      explores: catalog[1].explores,
      content: {
        caConversationId: created.caConversationId,
        agentId: catalog[1].id,
        agentName: catalog[1].name,
        embedPath: created.embedPath,
        selectionRationale: selection.rationale,
      },
    })
    expect(savedList).toHaveLength(1)
    expect(savedList[0].type).toBe('conversational-analytics')
    expect(savedList[0].content?.caConversationId).toBe('ca_conv_9001')
    expect(savedList[0].content?.agentId).toBe('ca_agent_bq_ops')
  })

  test('13. pins LKR_DEV_CLI_VERSION=0.0.61, bootstraps uv via pip --break-system-packages + uv tool install in new environments, and configures Monday/Thursday PyPI auto-PR workflow', async () => {
    const repoRoot = path.resolve(__dirname, '../..')
    const versionTxt = readFileSync(path.join(repoRoot, 'lkr-dev-cli-version.txt'), 'utf8').trim()
    expect(LKR_DEV_CLI_VERSION).toBe('0.0.61')
    expect(versionTxt).toBe(LKR_DEV_CLI_VERSION)
    expect(LKR_DEV_CLI_SPEC).toBe('lkr-dev-cli[tools,code-mode,parse]==0.0.61')

    expect(BOOTSTRAP_SANDBOX_SH).toContain('pip install --break-system-packages --quiet uv')
    expect(BOOTSTRAP_SANDBOX_SH).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.61"'
    )
    expect(BOOTSTRAP_LOOKML_PY).toContain('"install", "--break-system-packages", "--quiet", "uv"')
    expect(BOOTSTRAP_LOOKML_PY).toContain('"UV_TOOL_BIN_DIR": "/usr/local/bin"')
    expect(BOOTSTRAP_LOOKML_PY).toContain('["uv", "tool", "install", "--force", "--quiet", pkg_spec]')
    expect(AGENTS_MD).toContain('pip install --break-system-packages --quiet uv')
    expect(AGENTS_MD).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.61"'
    )

    const workflowYml = readFileSync(
      path.join(repoRoot, '.github/workflows/update-skills.yml'),
      'utf8'
    )
    expect(workflowYml).toContain('cron: "0 9 * * 1,4"')
    expect(workflowYml).toContain('https://pypi.org/pypi/lkr-dev-cli/json')
    expect(workflowYml).toContain('lkr-dev-cli-version.txt')
    expect(workflowYml).toContain('src/lookmlTool.tsx')
    expect(workflowYml).toContain('chore/update-skills')

    const postedBodies: any[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init: any) => {
        const body = init.body ? JSON.parse(init.body) : undefined
        postedBodies.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_prewarm_bootstrap_1',
            environment_id: 'env_fresh_bootstrap_1',
            status: 'completed',
            output_text: 'READY',
          }),
        }
      },
    }

    const res = await prewarmOrWakeAntigravityEnvironment({
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      toolType: 'app',
      schemaMarkdown: '# Schema',
    })
    expect(res.status).toBe('prelaunched')
    expect(res.session.environmentId).toBe('env_fresh_bootstrap_1')
    expect(postedBodies).toHaveLength(1)
    expect(postedBodies[0].input[0].text).toContain('python3 /workspace/bootstrap_lookml.py cli')
    expect(postedBodies[0].input[0].text).toContain('pip install --break-system-packages --quiet uv')
    expect(postedBodies[0].input[0].text).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.61"'
    )
    expect(postedBodies[0].environment.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: '/workspace/bootstrap_lookml.py',
          content: BOOTSTRAP_LOOKML_PY,
        }),
      ])
    )
  })

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
    const rawTransportCalls: Array<{ method: string; path: string; queryParams?: any; body?: any }> = []
    const mockSdk: any = {
      ok: async (p: any) => p,
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, queryParams?: any, body?: any) => {
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
    }

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

    const interactionPostBodies: any[] = []
    let interactionPostCount = 0
    const mockExtSDK = {
      serverProxy: async (_url: string, init: any) => {
        const body = init?.body ? JSON.parse(init.body) : undefined
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
    expect(interactionPostBodies[1].input[0].text).toContain(
      `/workspace/.lkr_extension_cache/${codemodeKey}.json`
    )
    expect(interactionPostBodies[1].input[0].text).toContain('"branch_name":"20261101_1"')
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
    const mockSdk: any = {
      ok: async (p: any) => p,
      authSession: { transport: { rawRequest: originalRawRequest } },
    }
    const spyCodeMode = jest.spyOn(LkrCodeMode, 'runPythonCode').mockImplementation(async (opts: any) => {
      const count = String(opts.code || '').includes('stream_b') ? 3 : 1
      for (let i = 0; i < count; i += 1) await opts.sdk.authSession.transport.rawRequest('GET', `/api/4.0/test_${i}`)
      return JSON.stringify({ NATIVE_CONTENT_BUNDLE: { id: '101', content_type: 'dashboard', title: 'Executive Commerce Pulse' } })
    })

    const postedBodies: any[] = []
    const appStep = (title: string) => [
      { type: 'code_execution', output: `<DATA_APP_BUNDLE>${JSON.stringify({ title, source_code: 'export class App {}', prod_code: 'export class App {}', widgets: [] })}</DATA_APP_BUNDLE>` },
    ]
    const fnCallStep = (id: string, code: string) => [
      { type: 'function_call', id, name: 'run_looker_codemode', arguments: { code } },
    ]
    const mockExtSDK = {
      serverProxy: async (_url: string, init: any) => {
        const body = init?.body ? JSON.parse(init.body) : undefined
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

    expect(mockSdk.authSession.transport.rawRequest).toBe(originalRawRequest)
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
    const rawSdk: any = {
      ok: async (p: any) => p,
      lookml_model_explore: async (params: any) => {
        lookmlModelExploreCount += 1
        await new Promise((r) => setTimeout(r, 10))
        return {
          name: params.explore_name,
          model_name: params.lookml_model_name,
          fields: { dimensions: [{ name: 'order_items.id', type: 'number' }], measures: [{ name: 'order_items.count', type: 'count' }] },
        }
      },
      authSession: {
        transport: {
          rawRequest: async (_method: string, reqPath: string) => ({ ok: true, statusCode: 200, body: JSON.stringify({ path: reqPath }) }),
        },
      },
    }
    const [s1, s2] = await Promise.all([
      buildDenseExploreSchema(rawSdk, 'thelook', 'order_items'),
      buildDenseExploreSchema(rawSdk, 'thelook', 'order_items'),
    ])
    expect(s1).toBe(s2)
    expect(lookmlModelExploreCount).toBe(1)

    let httpHits = 0
    let rawTransportCount = 0
    rawSdk.authSession.transport.rawRequest = async (_method: string, reqPath: string) => {
      rawTransportCount += 1
      await new Promise((r) => setTimeout(r, 10))
      return { ok: true, statusCode: 200, body: JSON.stringify({ path: reqPath }) }
    }
    const proxySdk: any = createDeduplicatedLookerSdkProxy(rawSdk, () => {
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
    const postedBodies: any[] = []
    const mockExtSDK = {
      serverProxy: async (_url: string, init: any) => {
        if (init?.method !== 'POST') return { ok: true, status: 200, body: '{}' }
        const body = init?.body ? JSON.parse(init.body) : undefined
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
    ).toBe('/embed/conversations/ca_1?agent_id=a1')

    const attrs: Record<string, string> = {}
    const fakeIframe: any = {
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
    const fakeContainer: any = {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v
      },
      querySelector: (sel: string) => (sel === 'iframe' ? fakeIframe : null),
    }

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

    // 3. Warm-turn update on same Dashboard #42 triggers connection.asDashboardConnection().run()
    const tApp42Warm = resolveLookerEmbedTarget({
      builderMode: 'data_app',
      publishedApp: { dashboardId: '42' },
      nonce: 2,
    })
    const connApp42Warm = await ctl.syncTarget(tApp42Warm)
    expect(connApp42Warm).toBe(conn0)
    expect(ctl.getTelemetry().calls).toContainEqual({
      method: 'asDashboardConnection.run',
      arg: '42',
    })
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

    // 5. Switch to LookML Dashboard via connection.loadUrl
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
    expect(attrs['data-embed-state']).toBe('url')
    expect(attrs['data-embed-target']).toBe('/embed/dashboards/thelook::executive_pulse')

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
      'asDashboardConnection.run',
      'loadLook',
      'loadUrl',
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

  test('19. parses central conversation routes (/, /c/:conversationId, /config) and flags legacy per-use-case routes for redirect (Issue #47)', () => {
    expect(parseStudioRoute('/')).toEqual({
      mode: 'app',
      objectId: '',
      conversationId: '',
      useCase: 'auto',
    })
    expect(parseStudioRoute('/config')).toEqual({
      mode: 'app',
      objectId: '',
      conversationId: '',
      useCase: 'auto',
    })
    expect(parseStudioRoute('/c/42')).toEqual({
      mode: 'app',
      objectId: '42',
      conversationId: '42',
      useCase: 'auto',
    })
    expect(parseStudioRoute('/c/conv_dashboard_7')).toEqual({
      mode: 'dashboard',
      objectId: '7',
      conversationId: 'conv_dashboard_7',
      useCase: 'dashboard',
    })
    expect(parseStudioRoute('/c/lookml_1')).toEqual({
      mode: 'lookml',
      objectId: 'lookml_1',
      conversationId: 'lookml_1',
      useCase: 'lookml',
    })
    expect(parseStudioRoute('/c/hc_thelook_1')).toEqual({
      mode: 'health',
      objectId: 'hc_thelook_1',
      conversationId: 'hc_thelook_1',
      useCase: 'health-check',
    })
    expect(parseStudioRoute('/c/ca_conv_streaming_1')).toEqual({
      mode: 'app',
      objectId: 'ca_conv_streaming_1',
      conversationId: 'ca_conv_streaming_1',
      useCase: 'conversational-analytics',
      isCaRoute: true,
    })
    expect(parseStudioRoute('/c/conv_tile_demo1')).toEqual({
      mode: 'tile',
      objectId: 'demo1',
      conversationId: 'conv_tile_demo1',
      useCase: 'tile',
    })
    expect(parseStudioRoute('/app/42')).toEqual({
      mode: 'app',
      objectId: '42',
      conversationId: '42',
      useCase: 'app',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/dashboard/7')).toEqual({
      mode: 'dashboard',
      objectId: '7',
      conversationId: '7',
      useCase: 'dashboard',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/tile/demo1')).toEqual({
      mode: 'tile',
      objectId: 'demo1',
      conversationId: 'demo1',
      useCase: 'tile',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/conversational-analytics/ca_conv_streaming_1')).toEqual({
      mode: 'app',
      objectId: 'ca_conv_streaming_1',
      conversationId: 'ca_conv_streaming_1',
      useCase: 'conversational-analytics',
      isCaRoute: true,
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

    const mockSdk: any = {
      ok: async (p: any) => p,
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
    }

    const svc = getArtifactService(mockSdk, ARTIFACT_NAMESPACE)
    expect(svc).toBeInstanceOf(ArtifactService)
    expect(getArtifactService(mockSdk, ARTIFACT_NAMESPACE)).toBe(svc)

    // 1. Initial saveUserArtifact fetches missing versions once; subsequent updates use cached versionByKey with 0 sdk.artifact calls
    await saveUserArtifact(
      mockSdk,
      '7',
      {
        id: '42',
        type: 'app',
        title: 'Revenue App v1',
        updatedAt: '2026-11-01T10:00:00Z',
        createdBy: '7',
      },
      { id: '42', type: 'app', title: 'Revenue App v1', code: 'v1' }
    )
    expect(svc.getCachedVersion('user_7_app_42')).toBe(1)
    expect(svc.getCachedVersion('obj_app_42')).toBe(1)
    const getCountAfterFirstArtifactSave = artifactGetCount
    const updateCountAfterFirstArtifactSave = updateArtifactsCount

    await saveUserArtifact(
      mockSdk,
      '7',
      {
        id: '42',
        type: 'app',
        title: 'Revenue App v2',
        updatedAt: '2026-11-01T10:05:00Z',
        createdBy: '7',
      },
      { id: '42', type: 'app', title: 'Revenue App v2', code: 'v2' }
    )
    // Subsequent save to existing keys makes 0 sdk.artifact GET calls and 1 sdk.update_artifacts call
    expect(artifactGetCount - getCountAfterFirstArtifactSave).toBe(0)
    expect(updateArtifactsCount - updateCountAfterFirstArtifactSave).toBe(1)
    expect(svc.getCachedVersion('user_7_app_42')).toBe(2)
    expect(svc.getCachedVersion('obj_app_42')).toBe(2)

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
    await svc.put([{ key: 'obj_app_42', value: { id: '42', title: 'Revenue App v3' } }])
    expect(artifactGetCount - getCountBeforeConflict).toBe(1)
    expect(updateArtifactsCount - updateCountBeforeConflict).toBe(2)
    expect(svc.getCachedVersion('obj_app_42')).toBe(8)

    // 3. Saving and deleting artifacts/conversations updates SWR cache & list in-place without extra sdk.search_artifacts calls
    expect(searchArtifactsCount).toBe(0)
    const cachedArtifactsAfterSave = await listUserArtifacts(mockSdk, '7')
    expect(searchArtifactsCount).toBe(0)
    expect(cachedArtifactsAfterSave.map((a) => `${a.id}:${a.title}`)).toEqual([
      '42:Revenue App v2',
    ])
    expect(
      readSwrCache<any[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map(
        (a) => a.title
      )
    ).toEqual(['Revenue App v2'])

    await saveUserArtifact(mockSdk, '7', {
      id: '99',
      type: 'dashboard',
      title: 'Executive UDD #99',
      updatedAt: '2026-11-01T10:10:00Z',
      createdBy: '7',
    })
    expect(searchArtifactsCount).toBe(0)
    expect((await listUserArtifacts(mockSdk, '7')).map((a) => a.id)).toEqual(['99', '42'])
    expect(
      readSwrCache<any[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map((a) => a.id)
    ).toEqual(['99', '42'])

    await deleteUserArtifact(mockSdk, '7', 'app', '42', true)
    expect(deleteArtifactCount).toBe(1)
    expect(searchArtifactsCount).toBe(0)
    expect(svc.getCachedVersion('user_7_app_42')).toBeUndefined()
    expect(svc.getCachedVersion('obj_app_42')).toBeUndefined()
    expect((await listUserArtifacts(mockSdk, '7')).map((a) => a.id)).toEqual(['99'])
    expect(
      readSwrCache<any[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map((a) => a.id)
    ).toEqual(['99'])

    await deleteUserConversation(mockSdk, '7', 'conv_42')
    expect(await loadUserConversations(mockSdk, '7')).toEqual([])
    expect(readSwrCache<any[]>(['artifact:conversations', ARTIFACT_NAMESPACE, '7'])).toEqual([])
    expect(searchArtifactsCount).toBe(0)
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
    const progressSnapshots: any[][] = []
    const permissionRequests: any[] = []
    let interactionCallIdx = 0

    const mockExtensionSDK = {
      lookerHostData: { extensionId: 'dab::test' },
      serverProxy: async () => {
        interactionCallIdx += 1
        if (interactionCallIdx === 1) {
          return {
            ok: true,
            status: 200,
            body: {
              id: 'int_issue56_1',
              environment_id: 'env_issue56',
              status: 'requires_action',
              steps: [
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

    const mockSdk: any = {
      ok: async (p: any) => p,
      authSession: {
        transport: {
          request: async (method: string, pathStr: string, _qp?: any, body?: any) => ({
            ok: true,
            value: { id: '99', title: body?.title || 'Executive KPI', method, path: pathStr },
          }),
        },
      },
    }

    const spyCodeMode = jest
      .spyOn(LkrCodeMode, 'runPythonCode')
      .mockImplementationOnce(async (opts: any) => {
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
      mode: 'dashboard',
      useCase: 'dashboard',
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

    expect(statusHistory).toContain('Creating executive KPI dashboard with 4 tiles')
    expect(permissionRequests.length).toBeGreaterThanOrEqual(1)
    expect(permissionRequests[0]).toMatchObject({
      operation: 'create_dashboard',
      thought: 'Creating executive KPI dashboard with 4 tiles',
    })
    expect(progressSnapshots.length).toBeGreaterThanOrEqual(1)
    expect(turnResult.activitySteps).toBeDefined()
    expect(turnResult.activitySteps).toEqual(
      expect.arrayContaining([
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
})
