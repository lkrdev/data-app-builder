import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  classifyLooker404Error,
  ConversationRecord,
  deleteUserConversation,
  extractResolvedUseCase,
  fetchInitialLookerMetadata,
  formatUserConversationsArtifactKey,
  formatUserConversationsKey,
  getAllowedUseCases,
  loadUserConversations,
  rawLookerRequest,
  resolveUserCapabilities,
  saveUserConversation,
} from '../lookerApi'
import {
  AGENTS_MD,
  ANTIGRAVITY_ALLOWED_MODELS,
  CONVERSATION_LABEL_REQUEST_TAG,
  DEFAULT_ANTIGRAVITY_MODEL,
  generateConversationLabel,
  listAvailableAntigravityModels,
  runAntigravityTurn,
  sanitizeConversationLabel,
} from '../antigravity'

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
})
