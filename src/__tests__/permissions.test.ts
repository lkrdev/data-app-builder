import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AGENTS_MD, AntigravityActivityStep, ANTIGRAVITY_ALLOWED_MODELS, APP_BUILDER_SYSTEM_PROMPT, authenticateGoogleOAuth,
  BOOTSTRAP_LOOKML_PY, BOOTSTRAP_SANDBOX_SH, buildDynamicStarterPrompts, buildLookmlSystemGuide, buildNativeContentGuide, buildWorkspaceSources,
  BUNDLE_APP_PY, BUILTIN_SKILLS_FILES, callInteractionsApi, clampLeftPaneWidth, classifyLookerOperation,
  clearStarterPromptsCache, clearStoredOAuthSession, CODEMODE_CDN_URL, CodeModePermissionRequest,
  computeIsAuthenticated, computeLkrExtensionCacheKey, CONCURRENT_POLL_SCHEDULE_MS,
  CONVERSATION_LABEL_REQUEST_TAG, DASHBOARD_CODEMODE_PREAMBLE_PY, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD,
  DEFAULT_ANTIGRAVITY_MODEL, DEFAULT_LEFT_PANE_WIDTH, DEFAULT_MAX_TOTAL_TOKENS, DEFAULT_THINKING_LEVEL,
  discoverAccessibleConnections, discoverStarterContentSummaries, discoverStarterExploreContext, ensureCodeModeLoaded,
  executeLkrExtensionToolRequest, EXPLICIT_SCRIPT_CREATION_RE, extractInteractionActivitySteps,
  extractInteractionOutputText, extractLkrExtensionToolRequests, extractSlashSkillIds,
  extractNativeContentFromInteraction, extractNonThoughtText, extractSkillNameFromPath, extractThoughtText, extractWrittenMarkdownPathFromCode,
  fetchEnvironmentFile, formatAccessibleConnectionsMarkdown, formatContentInventoryMarkdown, formatFriendlyLookerActivityLabel,
  formatThinkingTraceMarkdown, generateConversationLabel, generateDynamicStarterPrompts,
  getCachedStarterPrompts, getInitialStoredOAuthToken, getSharedEnvExploreSchemas,
  isConnectionSchemaDiscoveryPrompt, isEnvironmentNotFoundError, isHostOAuthWedged, isLookerInstanceMetadataQuery,
  isNewProjectOnboardingIntakePrompt, isTextAttachmentFile, KDA_SKILL_MD, KDA_TOOLKIT_PY,
  listAvailableAntigravityModels, LKR_CLI_BRIDGE_TOOL, LKR_CLI_SITECUSTOMIZE_PY, LKR_DEV_CLI_SPEC,
  LKR_DEV_CLI_VERSION, LkrCodeMode, loadStoredLeftPaneWidth, loadStoredOAuthSession,
  loadStoredRightPaneCollapsed, loadStoredThinkingLevel, loginWithGoogleOAuth,
  LOOKER_DASHBOARD_SKILL_MD, LOOKER_FIELD_PROFILER_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, LOOKML_SKILLS_CATALOG, MAX_LEFT_PANE_WIDTH,
  mergeInteractionSseEvent, MIN_LEFT_PANE_WIDTH, NATIVE_CONTENT_GUIDE_MD, normalizeMaxTotalTokens, normalizeSandboxFilePath,
  normalizeThinkingLevel, parseStarterPromptsResponse, persistOAuthSession, persistThinkingLevel,
  prewarmOrWakeAntigravityEnvironment, readInitialRightPaneCollapsed, readInitialThinkingLevel, recordSharedEnvExploreSchema,
  refreshOAuthSessionIfNeeded, resetHostOAuthWedged, resolveAdaptivePollScheduleMs, resolveBuiltinWorkspaceFileContent,
  resolveLookerOAuthRedirectUri, resolveLookerOAuthRedirectUris, runAntigravityTurn,
  SANDBOX_AGENT_SKILL_FILES, SANDBOX_WORKSPACE_SKILL_FILES, sanitizeConversationLabel, saveStoredLeftPaneWidth,
  saveStoredRightPaneCollapsed, STARTER_PROMPTS_REQUEST_TAG, STARTER_PROMPTS_RESPONSE_FORMAT,
  streamInteractionUntilActionOrDone, stripStarterPromptEmojis, STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY,
  STUDIO_MAX_TOTAL_TOKENS_OPTIONS, STUDIO_OAUTH_REFRESH_INTERVAL_MS,
  STUDIO_OAUTH_REFRESH_LOCK_KEY, STUDIO_OAUTH_STORAGE_KEY, STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY,
  STUDIO_SLASH_SKILLS, STUDIO_THINKING_LEVEL_OPTIONS, STUDIO_THINKING_LEVEL_STORAGE_KEY, StudioAttachedFile,
  summarizeProgress, wrapDashboardCodeMode,
  copyTextWithExtensionSdk, fetchConversationSandboxDebugMarkdown, formatConversationThreadMarkdown,
} from '../antigravity'
import {
  StudioBadge, StudioButton, StudioCard, StudioDocPreview, StudioModal,
  StudioSelect, StudioSkeleton, StudioToolbar,
} from '../components/StudioDesignSystem'
import {
  ALLOWED_EXTERNAL_WINDOW_PATTERNS, copyLinkWithExtensionSdk,
  createLookerEmbedPreloadController, DOC_UI_COMPONENTS, fetchAvailableLookerConnectionsMarkdown, getStarterPromptsForUseCase,
  isAllowedExternalWindowUrl, isSandboxMarkdownPath, normalizeLookerEmbedUrl, openOrCopyMarkdownLink,
  renderUseCaseGuideMarkdown, resolveLookerEmbedTarget,
  STARTER_PROMPTS_BY_USE_CASE, StarterPromptButtons, StudioMarkdown, USE_CASE_BADGES,
  USE_CASE_GUIDE_ORDER, USE_CASE_GUIDES,
} from '../components/StudioWorkspace'
import {
  archiveUserConversation, ARTIFACT_NAMESPACE, ArtifactService, buildCaEmbedPath, buildDenseExploreSchema,
  buildRootLookerFolders, buildStudioRoute, CA_AGENT_SELECTION_REQUEST_TAG, CA_AGENT_SELECTION_RESPONSE_FORMAT,
  classifyLooker404Error, classifyStudioUseCase, clearArtifactServiceCache,
  clearLookerMetadataCache, ConversationRecord, convertRelativeDateFilterToFixed,
  createDeduplicatedLookerSdkProxy, createLookerCaConversation, DEFAULT_STUDIO_AGENT_NAME, deleteUserArtifact,
  deleteUserConversation, extractResolvedUseCase, fetchFolderChildren,
  fetchFolderWithAncestors, fetchInitialLookerMetadata, fetchLookerCaAgentsCatalog,
  fetchPreloadedContentSummary, formatStudioContentItemTitle, formatUserConversationsArtifactKey,
  formatUserConversationsKey, formatUserEnvArtifactKey, getAllowedUseCases, getArtifactNamespace,
  getArtifactService, getUseCaseLabel, hydrateConversationContentItems, hydrateMentionedContext,
  isConversationalNoOpPrompt, listUserArtifacts, loadStoredSelectedFolderId,
  loadUserConversations, loadUserEnvironmentId, matchExplicitUseCaseRule,
  normalizeArtifactNamespace, normalizeBusySendAction, normalizeCaEmbedPath, normalizeQueryFiltersToFixedDates,
  normalizeStudioAgentName, normalizeStudioContentItem,
  normalizeStudioThemeMode,
  parseCaAgentSelectionResponse, parseStudioRoute, persistSelectedFolderId, rawLookerRequest,
  readInitialSelectedFolderId, readSwrCache, resolveConversationRelatedContent,
  resolveStudioContentEmbedPath, resolveStudioTheme, resolveSystemTheme, resolveUserCapabilities,
  saveNativeContentArtifact, saveStoredBusySendAction, saveUserArtifact, saveUserConversation, saveUserEnvironmentId, searchGlobalContentV2,
  searchLookerFolders, selectCaAgentViaIsolatedSubagent, shouldRouteToIsolatedCaSubagent,
  DEFAULT_BUSY_SEND_ACTION, loadStoredBusySendAction, STUDIO_BUSY_SEND_ACTION_STORAGE_KEY,
  STUDIO_FOLDER_STORAGE_KEY, STUDIO_MODES, STUDIO_THEME_STORAGE_KEY, STUDIO_USE_CASE_OPTIONS,
  StudioContentItem, SWR_DEDUPED_METHODS, upsertStudioContentItem, UserArtifactIndexItem, userStudioConfigArtifactKey,
} from '../lookerApi'
import { loadLookmlSessionArtifact, LookmlPreviewPane, saveLookmlSessionArtifact } from '../lookmlTool'

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
  input?: Array<{ type?: string; text?: string }>
}
const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

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
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
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
    })

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

    const mockSdkWith404 = asSdk({
      authSession: {
        transport: {
          rawRequest: async () => ({
            ok: false,
            statusCode: 404,
            body: JSON.stringify({ message: 'Not found', documentation_url: 'https://docs.looker.com/' }),
          }),
        },
      },
    })
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
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
    ])
    expect(DEFAULT_THINKING_LEVEL).toBe('high')
    expect(STUDIO_THINKING_LEVEL_STORAGE_KEY).toBe('dab_thinking_level')
    expect(STUDIO_THINKING_LEVEL_OPTIONS).toEqual([
      { value: 'low', label: 'Low', testId: 'thinking-level-option-low' },
      { value: 'medium', label: 'Medium', testId: 'thinking-level-option-medium' },
      { value: 'high', label: 'High', testId: 'thinking-level-option-high' },
    ])
    expect(normalizeThinkingLevel('low')).toBe('low')
    expect(normalizeThinkingLevel('high')).toBe('high')
    expect(normalizeThinkingLevel('invalid')).toBe('high')
    expect(readInitialThinkingLevel()).toBe('high')
    expect(await listAvailableAntigravityModels({}, { mode: 'oauth' })).toEqual(
      ANTIGRAVITY_ALLOWED_MODELS
    )

    const storedKv = new Map<string, string>()
    const calls: Array<{ url: string; method?: string; body?: MockInteractionPostBody }> = []
    const mockExtensionSDK = {
      localStorageGetItem: async (k: string) => storedKv.get(k) ?? null,
      localStorageSetItem: async (k: string, v: string) => {
        storedKv.set(k, v)
      },
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
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

    persistThinkingLevel(mockExtensionSDK, 'high')
    expect(await loadStoredThinkingLevel(mockExtensionSDK)).toBe('high')

    const discovered = await listAvailableAntigravityModels(mockExtensionSDK, { mode: 'apikey' })
    expect(discovered.map((m) => m.id)).toEqual([
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
    ])
    expect(discovered[0].description).toBe('Live 4 Argon')

    const turnRes = await runAntigravityTurn({
      sdk: asSdk({}),
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      session: { toolType: 'app' },
      model: 'gemini-4-argon',
      thinkingLevel: 'high',
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
      max_total_tokens: '131072',
    })
    const firstInputText = Array.isArray(postCall?.body?.input)
      ? String((postCall?.body?.input[0] as { text?: string } | undefined)?.text || '')
      : ''
    expect(firstInputText.startsWith('[THINKING LEVEL: HIGH — Reason deeply and verify edge cases thoroughly]')).toBe(
      true
    )
    expect(
      typeof postCall?.body?.environment === 'object' ? postCall.body.environment.sources : []
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/workspace/AGENTS.md', content: AGENTS_MD }),
      ])
    )

    await runAntigravityTurn({
      sdk: asSdk({}),
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey' },
      session: { toolType: 'app' },
      model: 'gemini-3.8-flash',
      thinkingLevel: 'low',
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Quick summary',
      onStatus: () => {},
    })
    const lowPostCall = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1beta/interactions')).pop()
    const lowInputText = Array.isArray(lowPostCall?.body?.input)
      ? String((lowPostCall?.body?.input[0] as { text?: string } | undefined)?.text || '')
      : ''
    expect(lowInputText.startsWith('[THINKING LEVEL: LOW — Be concise and minimize exploratory steps]')).toBe(true)
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

    const apiCalls: Array<{ url: string; method: string; body?: MockInteractionPostBody }> = []
    let pollCounter = 0
    const mockExtSDK = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined
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
    expect(postReq?.body?.model).toBe('gemini-3.5-flash-lite')
    expect(postReq?.body?.store).toBe(false)
    expect(postReq?.body?.background).toBe(false)
    expect(postReq?.body?.tools).toEqual([])
    expect(postReq?.body?.previous_interaction_id).toBeUndefined()
    expect('previous_interaction_id' in (postReq?.body || {})).toBe(false)
    expect(postReq?.body?.environment).toBeUndefined()
    expect(postReq?.body?.agent_config).toBeUndefined()
    expect(postReq?.body?.system_instruction).toContain('Return only a single-line concise 3-6 word plain-text title')
    expect(postReq?.body?.generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 1024 })
    expect(postReq?.body?.input?.[0]?.text).toContain(CONVERSATION_LABEL_REQUEST_TAG)

    const store = new Map<string, unknown>()
    const mockArtifactSdk = asSdk({
      ok: async <T>(p: T) => p,
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
    })

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
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) => {
        const hit = store.get(key)
        return hit ? [hit] : []
      },
      update_artifacts: async (
        _ns: string,
        updates: Array<{ key: string; value: string; version?: number }>
      ) => {
        for (const u of updates) {
          store.set(u.key, {
            key: u.key,
            version: (u.version ?? 0) + 1,
            value: u.value,
          })
        }
        return updates
      },
    })

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

    const capturedCalls: Array<{ url: string; body?: MockInteractionPostBody }> = []
    const mockExt = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
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
      sdk: asSdk({}),
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
    const env0 = capturedCalls[0]?.body?.environment
    const sentSources = typeof env0 === 'object' ? env0.sources || [] : []
    expect(
      sentSources.some(
        (s) =>
          s.target === '/workspace/AGENTS.md' &&
          String(s.content).includes('## Use Case Auto-Classification (Turn 1 Routing)') &&
          !String(s.content).includes('lock the conversation to that resolved use case for all subsequent turns')
      )
    ).toBe(true)

    const turn2MockExt = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        capturedCalls.push({ url, body })
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_auto_2',
            environment_id: 'env_auto_1',
            status: 'completed',
            output_text: '<USE_CASE>app</USE_CASE>\nBuilt interactive Lit Data App on Turn 2.',
          }),
        }
      },
    }
    const turn2Res = await runAntigravityTurn({
      sdk: asSdk({}),
      extensionSDK: turn2MockExt,
      auth: { mode: 'apikey' },
      session: turnRes.session,
      useCase: 'auto',
      allowedModes: ['app', 'dashboard'],
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Now build a custom interactive Lit Data App for executive KPIs',
      onStatus: () => {},
    })
    expect(turn2Res.resolvedUseCase).toBe('app')
    expect(turn2Res.assistantText).toBe('Built interactive Lit Data App on Turn 2.')
    expect(capturedCalls[1]?.body?.input?.[0]?.text).toContain('[AUTO USE-CASE ROUTING:')
  })

  test('10. persists single per-user environment_id in Looker Artifacts (user_env:${me.id}), shares it across 2 concurrent conversations with isolated /workspace/apps/${conversationId}/app.js paths, and sends sources only once on creation', async () => {
    expect(formatUserEnvArtifactKey('1')).toBe('user_env:1')
    expect(formatUserEnvArtifactKey('42')).toBe('user_env:42')

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
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
    })

    expect(await loadUserEnvironmentId(mockSdk, '1')).toBeNull()

    const apiCalls: Array<{ url: string; method?: string; body?: MockInteractionPostBody }> = []
    let turnCounter = 0
    const mockExtensionSDK = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        apiCalls.push({ url, method: init?.method, body })
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
    expect(apiCalls[0].body?.environment).toEqual(
      expect.objectContaining({
        type: 'remote',
        sources: expect.arrayContaining([
          expect.objectContaining({ target: '/workspace/schema.md' }),
          expect.objectContaining({ target: '/workspace/bundle_app.py' }),
        ]),
      })
    )
    expect(apiCalls[0].body?.previous_interaction_id).toBeUndefined()
    expect(apiCalls[0].body?.input?.[0]?.text).toContain('/workspace/apps/conv_alpha/app.js')
    expect(apiCalls[0].body?.input?.[0]?.text).toContain('--app-dir /workspace/apps/conv_alpha')

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
    expect(apiCalls[1].body?.environment).toBe('env_user_1_shared')
    expect(apiCalls[1].body?.previous_interaction_id).toBeUndefined()
    expect(apiCalls[1].body?.input?.[0]?.text).toContain('/workspace/apps/conv_beta/app.js')
    expect(apiCalls[1].body?.input?.[0]?.text).toContain('--app-dir /workspace/apps/conv_beta')
    expect(apiCalls[1].body?.input?.[0]?.text).not.toContain('conv_alpha')

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
      existingAppCode: 'export class AlphaApp {}',
      userPrompt: 'Add YoY KPI to Alpha',
      onStatus: () => {},
    })

    expect(turnA2.session.lastInteractionId).toBe('int_turn_3')
    expect(apiCalls[2].body?.environment).toBe('env_user_1_shared')
    expect(apiCalls[2].body?.previous_interaction_id).toBe('int_turn_1')
    expect(apiCalls[2].body?.input?.[0]?.text).toContain('/workspace/apps/conv_alpha/app.js')

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
      existingAppCode: 'export class BetaApp {}',
      userPrompt: 'Add stockout chart to Beta',
      onStatus: () => {},
    })

    expect(turnB2.session.lastInteractionId).toBe('int_turn_4')
    expect(apiCalls[3].body?.environment).toBe('env_user_1_shared')
    expect(apiCalls[3].body?.previous_interaction_id).toBe('int_turn_2')
    expect(apiCalls[3].body?.input?.[0]?.text).toContain('/workspace/apps/conv_beta/app.js')
  })

  test('11. auto-recovers on 404 (Environment not found) in runAntigravityTurn and prewarmOrWakeAntigravityEnvironment by creating { type: "remote", sources } and updating user_env:${me.id}', async () => {
    expect(isEnvironmentNotFoundError(new Error("Antigravity API error (404): Environment 'env_stale' not found"))).toBe(true)
    expect(isEnvironmentNotFoundError({ status: 404, message: 'Not Found' })).toBe(true)
    expect(isEnvironmentNotFoundError(new Error('Antigravity API error (500): Internal error'))).toBe(false)

    const artifactStore = new Map<string, { key: string; version: number; value: string }>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
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
    })

    await saveUserEnvironmentId(mockSdk, '1', 'env_stale_404')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_stale_404')

    const postedPayloads: MockInteractionPostBody[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
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
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
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
      create_conversation: async (body: { agent_id?: string; title?: string }) => ({
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
    })

    const catalog = await fetchLookerCaAgentsCatalog(mockSdk, [])
    expect(catalog).toHaveLength(2)
    expect(catalog[0].id).toBe('ca_agent_ecommerce')
    expect(catalog[1].id).toBe('ca_agent_bq_ops')

    const capturedPayloads: MockInteractionPostBody[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
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

    // Stateless isolated sub-agent call must use direct model inference (store: false, background: false, tools: [], response_format)
    expect(capturedPayloads).toHaveLength(1)
    expect(capturedPayloads[0].model).toBe(DEFAULT_ANTIGRAVITY_MODEL)
    expect(capturedPayloads[0].store).toBe(false)
    expect(capturedPayloads[0].background).toBe(false)
    expect(capturedPayloads[0].previous_interaction_id).toBeUndefined()
    expect(capturedPayloads[0].tools).toEqual([])
    expect(capturedPayloads[0].environment).toBeUndefined()
    expect(capturedPayloads[0].agent_config).toBeUndefined()
    expect(capturedPayloads[0].system_instruction).toContain('Select the single best Looker CA agent_id')
    expect(capturedPayloads[0].generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 1024 })
    expect(capturedPayloads[0].response_format).toEqual(CA_AGENT_SELECTION_RESPONSE_FORMAT)
    expect(capturedPayloads[0].input?.[0]?.text).toContain(CA_AGENT_SELECTION_REQUEST_TAG)

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

  test('13. pins LKR_DEV_CLI_VERSION=0.0.66, bootstraps uv via pip --break-system-packages + uv tool install in new environments, and configures Monday/Thursday PyPI auto-PR workflow', async () => {
    const repoRoot = path.resolve(__dirname, '../..')
    const versionTxt = readFileSync(path.join(repoRoot, 'lkr-dev-cli-version.txt'), 'utf8').trim()
    expect(LKR_DEV_CLI_VERSION).toBe('0.0.66')
    expect(versionTxt).toBe(LKR_DEV_CLI_VERSION)
    expect(LKR_DEV_CLI_SPEC).toBe('lkr-dev-cli[tools,code-mode,parse]==0.0.66')

    expect(BOOTSTRAP_SANDBOX_SH).toContain('pip install --break-system-packages --quiet uv')
    expect(BOOTSTRAP_SANDBOX_SH).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.66"'
    )
    expect(BOOTSTRAP_LOOKML_PY).toContain('"install", "--break-system-packages", "--quiet", "uv"')
    expect(BOOTSTRAP_LOOKML_PY).toContain('"UV_TOOL_BIN_DIR": "/usr/local/bin"')
    expect(BOOTSTRAP_LOOKML_PY).toContain('["uv", "tool", "install", "--force", "--quiet", pkg_spec]')
    expect(AGENTS_MD).toContain('pip install --break-system-packages --quiet uv')
    expect(AGENTS_MD).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.66"'
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

    const postedBodies: MockInteractionPostBody[] = []
    const mockExtensionSDK = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
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
    expect(postedBodies[0].input?.[0]?.text).toContain('python3 /workspace/bootstrap_lookml.py cli')
    expect(postedBodies[0].input?.[0]?.text).toContain('pip install --break-system-packages --quiet uv')
    expect(postedBodies[0].input?.[0]?.text).toContain(
      'UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.66"'
    )
    expect(
      typeof postedBodies[0].environment === 'object' ? postedBodies[0].environment.sources : []
    ).toEqual(
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
      'asDashboardConnection.run',
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
      readSwrCache<UserArtifactIndexItem[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map(
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
      readSwrCache<UserArtifactIndexItem[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map((a) => a.id)
    ).toEqual(['99', '42'])

    await deleteUserArtifact(mockSdk, '7', 'app', '42', true)
    expect(deleteArtifactCount).toBe(1)
    expect(searchArtifactsCount).toBe(0)
    expect(svc.getCachedVersion('user_7_app_42')).toBeUndefined()
    expect(svc.getCachedVersion('obj_app_42')).toBeUndefined()
    expect((await listUserArtifacts(mockSdk, '7')).map((a) => a.id)).toEqual(['99'])
    expect(
      readSwrCache<UserArtifactIndexItem[]>(['artifact:user_list', ARTIFACT_NAMESPACE, '7', 'all'])?.map((a) => a.id)
    ).toEqual(['99'])

    await deleteUserConversation(mockSdk, '7', 'conv_42')
    expect(await loadUserConversations(mockSdk, '7')).toEqual([])
    expect(readSwrCache<ConversationRecord[]>(['artifact:conversations', ARTIFACT_NAMESPACE, '7'])).toEqual([])
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

  test('22. sorts STUDIO_USE_CASE_OPTIONS with Auto first and remaining use cases alphabetically, renames Python Tile to Script, and provides tailored starter prompts per use case (Issue #59)', () => {
    expect(STUDIO_USE_CASE_OPTIONS.map((o) => o.label)).toEqual([
      'Auto',
      'Content Studio',
      'Conversational Analytics',
      'Data App',
      'Data Investigator',
      'Health Check',
      'LookML',
      'Script',
    ])
    expect(STUDIO_USE_CASE_OPTIONS.map((o) => o.value)).toEqual([
      'auto',
      'dashboard',
      'conversational-analytics',
      'app',
      'data-investigator',
      'health-check',
      'lookml',
      'tile',
    ])
    expect(getUseCaseLabel('auto')).toBe('Auto')
    expect(getUseCaseLabel('data-investigator')).toBe('Data Investigator')
    expect(getUseCaseLabel('tile')).toBe('Script')
    expect(STUDIO_MODES.find((m) => m.mode === 'tile')?.label).toBe('Script')

    for (const uc of [
      'auto',
      'app',
      'data-investigator',
      'dashboard',
      'conversational-analytics',
      'health',
      'health-check',
      'lookml',
      'tile',
    ]) {
      const prompts = getStarterPromptsForUseCase(uc)
      expect(prompts.length).toBeGreaterThanOrEqual(3)
      for (const item of prompts) {
        expect(item.id.length).toBeGreaterThan(0)
        expect(item.label.length).toBeGreaterThan(0)
        expect(item.prompt.length).toBeGreaterThan(10)
        expect(item.prompt).not.toMatch(/search_content|lookml_model_explore|Solr/i)
      }
    }
    expect(STARTER_PROMPTS_BY_USE_CASE.health).toBe(STARTER_PROMPTS_BY_USE_CASE['health-check'])
  })

  test('23. computes isAuthenticated, resolves Looker OAuth redirect URI (/extensions/oauth2_redirect), and prevents hanging oauth2Authenticate popups from locking via focus-return & abort guards (Issue #65)', async () => {
    expect(computeIsAuthenticated('oauth', '', '')).toBe(false)
    expect(computeIsAuthenticated('oauth', '   ', 'AIzaSyKey')).toBe(false)
    expect(computeIsAuthenticated('oauth', 'mock_valid_token', '')).toBe(true)
    expect(computeIsAuthenticated('apikey', 'mock_valid_token', '')).toBe(false)
    expect(computeIsAuthenticated('apikey', '', '   ')).toBe(false)
    expect(computeIsAuthenticated('apikey', '', 'AIzaSyKey')).toBe(true)

    expect(resolveLookerOAuthRedirectUri('https://dev-argolis.looker.com')).toBe(
      'https://dev-argolis.looker.com/extensions/oauth2_redirect'
    )
    expect(resolveLookerOAuthRedirectUri('https://dev-argolis.looker.com/')).toBe(
      'https://dev-argolis.looker.com/extensions/oauth2_redirect'
    )
    expect(resolveLookerOAuthRedirectUri('', 'https://looker.example.com/')).toBe(
      'https://looker.example.com/extensions/oauth2_redirect'
    )
    expect(resolveLookerOAuthRedirectUris('https://dev-argolis.looker.com/')).toEqual({
      extensionUri: 'https://dev-argolis.looker.com/extensions/oauth2_redirect',
      spartanUri: 'https://dev-argolis.looker.com/spartan/oauth2_redirect',
      activeUri: 'https://dev-argolis.looker.com/extensions/oauth2_redirect',
    })
    expect(
      resolveLookerOAuthRedirectUris('https://dev-argolis.looker.com/', undefined, 'spartan')
    ).toEqual({
      extensionUri: 'https://dev-argolis.looker.com/extensions/oauth2_redirect',
      spartanUri: 'https://dev-argolis.looker.com/spartan/oauth2_redirect',
      activeUri: 'https://dev-argolis.looker.com/spartan/oauth2_redirect',
    })
    expect(
      resolveLookerOAuthRedirectUris(
        'https://dev-argolis.looker.com',
        undefined,
        '/spartan/data_app_builder::data_app_builder'
      )
    ).toEqual({
      extensionUri: 'https://dev-argolis.looker.com/extensions/oauth2_redirect',
      spartanUri: 'https://dev-argolis.looker.com/spartan/oauth2_redirect',
      activeUri: 'https://dev-argolis.looker.com/spartan/oauth2_redirect',
    })

    // 1. Successful OAuth sign-in resolves token cleanly
    const okSdk = {
      oauth2Authenticate: async () => ({ access_token: 'mock_oauth_ok' }),
    }
    await expect(authenticateGoogleOAuth(okSdk, 'client-123')).resolves.toBe('mock_oauth_ok')

    // 2. Hanging OAuth popup (e.g. Error 400: redirect_uri_mismatch or closed window) settles when window regains focus
    const listeners: Record<string, Array<() => void>> = {}
    const globalWithWindow = globalThis as unknown as { window?: unknown }
    const prevWindow = globalWithWindow.window
    globalWithWindow.window = {
      ...(typeof prevWindow === 'object' && prevWindow ? prevWindow : {}),
      location: { origin: 'https://dev-argolis.looker.com' },
      addEventListener: (evt: string, fn: () => void) => {
        ;(listeners[evt] = listeners[evt] || []).push(fn)
      },
      removeEventListener: (evt: string, fn: () => void) => {
        listeners[evt] = (listeners[evt] || []).filter((x) => x !== fn)
      },
    }
    try {
      const hangingSdk = {
        oauth2Authenticate: () => new Promise(() => {}),
      }
      const focusPromise = loginWithGoogleOAuth(hangingSdk, 'client-123', {
        focusReturnDelayMs: 25,
      })
      for (const fn of listeners.focus || []) fn()
      await expect(focusPromise).rejects.toThrow(/popup closed or failed.*redirect_uri_mismatch/i)
      expect(listeners.focus?.length || 0).toBe(0)

      // 3. Explicit abort via AbortController (Cancel Sign-In or retry) rejects immediately
      const abortCtl = new AbortController()
      const abortPromise = loginWithGoogleOAuth(hangingSdk, 'client-123', {
        signal: abortCtl.signal,
      })
      abortCtl.abort()
      await expect(abortPromise).rejects.toThrow(/cancelled/i)
      expect(listeners.focus?.length || 0).toBe(0)

      // 4. Issue #93: Persist & hydrate OAuth session via extensionSDK.localStorageSetItem / localStorageGetItem
      expect(STUDIO_OAUTH_STORAGE_KEY).toBe('dab_oauth_session')
      const extStorage = new Map<string, string>()
      const winStorage = new Map<string, string>()
      ;(globalWithWindow.window as Record<string, unknown>).localStorage = {
        getItem: (k: string) => winStorage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          winStorage.set(k, v)
        },
        removeItem: (k: string) => {
          winStorage.delete(k)
        },
      }
      const storageSdk = {
        oauth2Authenticate: async () => ({
          access_token: 'persisted_oauth_tok_93',
          expires_in: 1800,
        }),
        localStorageGetItem: async (k: string) => extStorage.get(k) ?? null,
        localStorageSetItem: async (k: string, v: string) => {
          extStorage.set(k, v)
        },
        localStorageRemoveItem: async (k: string) => {
          extStorage.delete(k)
        },
      }
      const beforeLogin = Date.now()
      const loggedInToken = await loginWithGoogleOAuth(storageSdk, '  client-93  ')
      expect(loggedInToken).toBe('persisted_oauth_tok_93')
      expect(getInitialStoredOAuthToken('client-93')).toBe('persisted_oauth_tok_93')
      expect(getInitialStoredOAuthToken('other-client')).toBe('')
      const hydrated = await loadStoredOAuthSession(storageSdk, 'client-93')
      expect(hydrated).toMatchObject({
        token: 'persisted_oauth_tok_93',
        clientId: 'client-93',
      })
      expect(hydrated!.expiresAt).toBeGreaterThanOrEqual(beforeLogin + 1730 * 1000)
      clearStoredOAuthSession(storageSdk)
      expect(getInitialStoredOAuthToken('client-93')).toBe('')

      // Expired session is pruned and returns null / empty string
      extStorage.set(
        STUDIO_OAUTH_STORAGE_KEY,
        JSON.stringify({
          token: 'expired_tok',
          expiresAt: Date.now() - 1000,
          clientId: 'client-93',
        })
      )
      winStorage.set(STUDIO_OAUTH_STORAGE_KEY, extStorage.get(STUDIO_OAUTH_STORAGE_KEY)!)
      expect(getInitialStoredOAuthToken('client-93')).toBe('')
      expect(winStorage.has(STUDIO_OAUTH_STORAGE_KEY)).toBe(false)
      extStorage.set(
        STUDIO_OAUTH_STORAGE_KEY,
        JSON.stringify({
          token: 'expired_tok_2',
          expiresAt: Date.now() - 500,
          clientId: 'client-93',
        })
      )
      expect(await loadStoredOAuthSession(storageSdk, 'client-93')).toBeNull()
      expect(extStorage.get(STUDIO_OAUTH_STORAGE_KEY) || '').toBe('')

      // HTTP 401 in callInteractionsApi clears stored OAuth session
      persistOAuthSession(storageSdk, {
        token: 'revoked_tok_93',
        expiresAt: Date.now() + 600_000,
        clientId: 'client-93',
      })
      expect(getInitialStoredOAuthToken('client-93')).toBe('revoked_tok_93')
      const globalWithFetch = globalThis as unknown as {
        fetch?: (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
      }
      const prevFetch = globalWithFetch.fetch
      globalWithFetch.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Request had invalid authentication credentials.' } }),
      })
      try {
        await expect(
          callInteractionsApi(
            storageSdk,
            { mode: 'oauth', oauthToken: 'revoked_tok_93', clientId: 'client-93' },
            'models',
            'GET'
          )
        ).rejects.toThrow(/Antigravity API error \(401\)/)
        expect(winStorage.has(STUDIO_OAUTH_STORAGE_KEY)).toBe(false)
        expect(extStorage.get(STUDIO_OAUTH_STORAGE_KEY) || '').toBe('')
      } finally {
        globalWithFetch.fetch = prevFetch
      }
    } finally {
      globalWithWindow.window = prevWindow
    }
  })

  test('24. renders contextual use-case Markdown guides with embedded non-actionable React UI preview components (Issue #64 & Issue #85)', () => {
    expect(USE_CASE_GUIDE_ORDER.map((u) => u.useCase)).toEqual([
      'auto',
      'lookml',
      'dashboard',
      'conversational-analytics',
      'app',
      'data-investigator',
      'health-check',
      'tile',
    ])
    expect(USE_CASE_GUIDE_ORDER.map((u) => u.tabLabel)).toEqual([
      'Auto',
      'Agentic LookML',
      'Content Studio',
      'Conversational Analytics',
      'Data App',
      'Data Investigator',
      'Health Check',
      'Script',
    ])

    const expectedComponents = [
      'PublishDashboardButton',
      'ScheduleScriptButton',
      'SaveScriptButton',
      'RunPythonButton',
      'ScriptModeSelect',
      'ReloadPreviewButton',
      'OpenInLookerButton',
      'LookmlTurnSkills',
      'PushLookmlButton',
      'ExportHealthTddButton',
      'DataInvestigatorPreview',
    ]
    for (const compName of expectedComponents) {
      expect(typeof DOC_UI_COMPONENTS[compName]).toBe('function')
    }
    expect(DOC_UI_COMPONENTS.UseCaseBadge).toBeUndefined()

    const allGuideMarkdown = Object.values(USE_CASE_GUIDES)
      .map((g) => g.markdown)
      .join('\n')
    for (const compName of expectedComponents) {
      expect(allGuideMarkdown).toContain(`<${compName} />`)
    }
    expect(allGuideMarkdown).not.toContain('Conversation Use-Case Lock')
    expect(allGuideMarkdown).not.toContain('After Turn 1')
    expect(allGuideMarkdown).not.toContain('AGENTS.md')
    expect(allGuideMarkdown).not.toContain('apps/<name>/app.js')
    expect(allGuideMarkdown).not.toContain('[CA_AGENT_SELECTION_REQUEST]')
    expect(allGuideMarkdown).not.toContain('obj_script_')
    expect(allGuideMarkdown).not.toContain('My Creations')
    for (const label of ['Agentic LookML', 'Content Studio', 'Conversational Analytics', 'Data App', 'Health Check', 'Python Tile']) {
      expect(USE_CASE_GUIDES.auto.markdown).toContain(label)
    }

    const tree = renderUseCaseGuideMarkdown(USE_CASE_GUIDES.tile.markdown)
    expect(tree.props.className).toContain('dab-use-case-guide-markdown')
    const children: Array<React.ReactElement<Record<string, unknown>>> = Array.isArray(
      tree.props.children
    )
      ? tree.props.children
      : [tree.props.children]
    const previews = children.filter((c) => c?.props?.['data-testid'] === 'doc-ui-preview')
    expect(previews.map((p) => p.props['data-component'])).toEqual([
      'PublishDashboardButton',
      'RunPythonButton',
      'ScriptModeSelect',
      'SaveScriptButton',
      'ScheduleScriptButton',
    ])
    for (const preview of previews) {
      expect(preview.props.className).toBe('dab-doc-ui-preview')
      expect(preview.props.style).toEqual({ pointerEvents: 'none', userSelect: 'none' })
      expect(preview.props['aria-hidden']).toBe('true')
      expect(preview.props.tabIndex).toBe(-1)
    }
  })

  test('25. Issue #61: archives/unarchives conversations, resolves related content across all 6 modes, deletes user_${userId}_${type}_${id} index artifacts + optional related content, and never resurrects deleted items', async () => {
    clearArtifactServiceCache()
    const store = new Map<string, { key: string; version: number; value: string }>()
    const deletedDashboards: string[] = []
    const deletedLooks: string[] = []
    const deletedArtifactKeys: string[] = []

    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) =>
        String(key || '')
          .split(',')
          .map((k) => store.get(k.trim()))
          .filter(Boolean),
      search_artifacts: async ({ key }: { key: string }) => {
        const prefix = String(key || '').replace(/%/g, '')
        return Array.from(store.values()).filter((r) => r.key.startsWith(prefix))
      },
      update_artifacts: async (
        _ns: string,
        updates: Array<{ key: string; value: string; version?: number }>
      ) => {
        for (const u of updates) {
          store.set(u.key, {
            key: u.key,
            version: (u.version ?? 0) + 1,
            value: u.value,
          })
        }
        return updates
      },
      delete_artifact: async (_ns: string, key: string) => {
        for (const k of String(key || '').split(',')) {
          const clean = k.trim()
          if (clean) {
            deletedArtifactKeys.push(clean)
            store.delete(clean)
          }
        }
        return ''
      },
      delete_dashboard: async (id: string) => {
        deletedDashboards.push(String(id))
        return ''
      },
      delete_look: async (id: string) => {
        deletedLooks.push(String(id))
        return ''
      },
    })

    // 1. Verify resolveConversationRelatedContent across all 6 Studio modes
    expect(
      resolveConversationRelatedContent(
        { id: 'conv_app_42', type: 'app', content: { dashboardId: '42', appArtifactId: 'obj_app_42' } },
        '1'
      )
    ).toMatchObject({
      mode: 'app',
      objectId: '42',
      dashboardId: '42',
      userIndexKeys: expect.arrayContaining(['user_1_app_42']),
      sharedObjectKeys: ['obj_app_42'],
    })

    expect(
      resolveConversationRelatedContent(
        { id: 'conv_dashboard_7', type: 'dashboard', content: { dashboardId: '7', lookId: '15' } },
        '1'
      )
    ).toMatchObject({
      mode: 'dashboard',
      objectId: '7',
      dashboardId: '7',
      lookId: '15',
      userIndexKeys: expect.arrayContaining(['user_1_dashboard_7']),
      sharedObjectKeys: ['obj_dashboard_7'],
    })

    expect(
      resolveConversationRelatedContent(
        { id: 'conv_tile_demo1', type: 'tile', content: { scriptId: 'demo1', dashboardId: '8' } },
        '1'
      )
    ).toMatchObject({
      mode: 'tile',
      objectId: 'demo1',
      dashboardId: '8',
      userIndexKeys: expect.arrayContaining(['user_1_script_demo1', 'user_1_tile_demo1']),
      sharedObjectKeys: ['obj_script_demo1', 'obj_schedule_demo1'],
    })

    expect(
      resolveConversationRelatedContent(
        { id: 'conv_health_demo', type: 'health-check', content: { reportId: 'demo' } },
        '1'
      )
    ).toMatchObject({
      mode: 'health',
      objectId: 'demo',
      userIndexKeys: expect.arrayContaining(['user_1_health_check_demo']),
      sharedObjectKeys: expect.arrayContaining(['obj_health_demo']),
    })

    expect(
      resolveConversationRelatedContent(
        { id: 'conv_lookml_s1', type: 'lookml', content: { sessionId: 's1' } },
        '1'
      )
    ).toMatchObject({
      mode: 'lookml',
      objectId: 's1',
      userIndexKeys: ['user_1_lookml_s1'],
      sharedObjectKeys: ['obj_lookml_s1'],
    })

    expect(
      resolveConversationRelatedContent(
        { id: 'conv_ca_c1', type: 'conversational-analytics', content: { caConversationId: 'c1' } },
        '1'
      )
    ).toMatchObject({
      mode: 'conversational-analytics',
      objectId: 'c1',
      userIndexKeys: expect.arrayContaining(['user_1_conversational-analytics_c1']),
      sharedObjectKeys: expect.arrayContaining(['obj_ca_c1']),
    })

    // 2. Seed two conversations + user index artifacts + shared obj artifacts
    await saveUserArtifact({
      sdk: mockSdk,
      userId: '1',
      id: '42',
      type: 'app',
      title: 'Executive Revenue App',
      objectPayload: { id: '42', type: 'app', title: 'Executive Revenue App', code: 'export default 1' },
    })
    await saveUserArtifact({
      sdk: mockSdk,
      userId: '1',
      id: '7',
      type: 'dashboard',
      title: 'Quarterly UDD',
      objectPayload: { id: '7', type: 'dashboard', title: 'Quarterly UDD' },
    })
    await saveUserConversation(mockSdk, '1', {
      id: 'conv_app_42',
      type: 'app',
      label: 'Executive Revenue App',
      content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      updatedAt: '2026-11-01T10:00:00Z',
    })
    await saveUserConversation(mockSdk, '1', {
      id: 'conv_dashboard_7',
      type: 'dashboard',
      label: 'Quarterly UDD',
      content: { dashboardId: '7', lookId: '15' },
      updatedAt: '2026-11-01T11:00:00Z',
    })

    // 3. Archive & Unarchive conv_app_42 without deleting any artifacts
    const afterArchive = await archiveUserConversation(mockSdk, '1', 'conv_app_42', true)
    expect(afterArchive.find((c) => c.id === 'conv_app_42')?.archived).toBe(true)
    expect(store.has('obj_app_42')).toBe(true)
    expect(deletedDashboards).toHaveLength(0)

    const afterUnarchive = await archiveUserConversation(mockSdk, '1', 'conv_app_42', false)
    expect(afterUnarchive.find((c) => c.id === 'conv_app_42')?.archived).toBe(false)

    // 4. Delete conv_app_42 with deleteRelatedContent=false -> removes conversation + user_1_app_42 index, keeps obj_app_42 & dashboard #42
    const afterDeleteConvOnly = await deleteUserConversation(mockSdk, '1', 'conv_app_42', {
      deleteRelatedContent: false,
    })
    expect(afterDeleteConvOnly.map((c) => c.id)).toEqual(['conv_dashboard_7'])
    expect(store.has('user_1_app_42')).toBe(false)
    expect(store.has('obj_app_42')).toBe(true)
    expect(deletedDashboards).toEqual([])

    // 5. Delete conv_dashboard_7 with deleteRelatedContent=true -> removes conversation + user_1_dashboard_7 + obj_dashboard_7 + deletes dashboard #7 & look #15
    const afterDeleteWithContent = await deleteUserConversation(mockSdk, '1', 'conv_dashboard_7', {
      deleteRelatedContent: true,
    })
    expect(afterDeleteWithContent).toEqual([])
    expect(store.has('user_1_dashboard_7')).toBe(false)
    expect(store.has('obj_dashboard_7')).toBe(false)
    expect(deletedDashboards).toEqual(['7'])
    expect(deletedLooks).toEqual(['15'])

    // 6. Verify empty user_conversations:1 stays [] even after cache clear
    clearArtifactServiceCache()
    expect(await loadUserConversations(mockSdk, '1')).toEqual([])
  })

  test('26. seeds lazy root folders without upfront all_folders, lazily fetches folder_children, hydrates folder_ancestors, and queries search_folders (Issue #62)', async () => {
    clearLookerMetadataCache()
    let allFoldersCalls = 0
    const childCalls: unknown[] = []
    const folderCalls: unknown[] = []
    const ancestorCalls: unknown[] = []
    const searchCalls: unknown[] = []

    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({
        id: '1',
        display_name: 'Bryan Weber',
        personal_folder_id: '5',
        home_folder_id: '1',
        is_iam_admin: true,
      }),
      all_lookml_models: async () => [
        {
          name: 'thelook',
          label: 'eCommerce',
          project_name: 'thelook_event',
          explores: [{ name: 'order_items', hidden: false }],
        },
      ],
      all_folders: async () => {
        allFoldersCalls += 1
        return []
      },
      folder_children: async (req: { folder_id?: string }) => {
        childCalls.push(req)
        if (String(req.folder_id) === '1') {
          return [
            { id: '501', name: 'Marketing Analytics', parent_id: '1', child_count: 1, is_personal: false },
            { id: '503', name: 'Finance & RevOps', parent_id: '1', child_count: 0, is_personal: false },
          ]
        }
        if (String(req.folder_id) === '501') {
          return [
            { id: '502', name: 'subfolder test', parent_id: '501', child_count: 0, is_personal: false },
          ]
        }
        return []
      },
      folder: async (req: string | { folder_id?: string }) => {
        folderCalls.push(req)
        const fid = String(typeof req === 'object' ? req.folder_id : req)
        if (fid === '502') {
          return {
            id: '502',
            name: 'subfolder test',
            parent_id: '501',
            child_count: 0,
            is_personal: false,
            creator_id: '1',
          }
        }
        return { id: fid, name: `Folder #${fid}`, parent_id: null, child_count: 0 }
      },
      folder_ancestors: async (req: string | { folder_id?: string }) => {
        ancestorCalls.push(req)
        const fid = String(typeof req === 'object' ? req.folder_id : req)
        if (fid === '502') {
          return [
            { id: '501', name: 'Marketing Analytics', parent_id: '1', child_count: 1, is_personal: false },
            { id: '1', name: 'Shared folders', parent_id: null, child_count: 2, is_personal: false },
          ]
        }
        return []
      },
      search_folders: async (req: unknown) => {
        searchCalls.push(req)
        return [
          {
            id: '502',
            name: 'subfolder test',
            parent_id: '501',
            child_count: 0,
            is_personal: false,
            creator_id: '1',
          },
        ]
      },
    })

    // 1. fetchInitialLookerMetadata does NOT call all_folders upfront and seeds top-level roots
    const meta = await fetchInitialLookerMetadata(mockSdk)
    expect(allFoldersCalls).toBe(0)
    expect(meta.defaultFolderId).toBe('5')
    expect(meta.folders.map((f) => ({ id: f.id, name: f.name }))).toEqual([
      { id: '5', name: 'My folder' },
      { id: '1', name: 'Shared folders' },
      { id: '2', name: 'People' },
      { id: '3', name: 'Embed Users' },
      { id: '4', name: 'Embed Groups' },
    ])
    expect(buildRootLookerFolders({ personal_folder_id: '5', home_folder_id: '1' })).toHaveLength(5)

    // 2. fetchFolderChildren calls sdk.folder_children lazily
    const sharedChildren = await fetchFolderChildren(mockSdk, '1')
    expect(childCalls).toEqual([
      {
        folder_id: '1',
        fields: 'id,name,parent_id,child_count,is_personal,can',
      },
    ])
    expect(sharedChildren).toEqual([
      expect.objectContaining({ id: '501', name: 'Marketing Analytics', parent_id: '1', has_children: true }),
      expect.objectContaining({ id: '503', name: 'Finance & RevOps', parent_id: '1', has_children: false }),
    ])

    // 3. fetchFolderWithAncestors calls sdk.folder + sdk.folder_ancestors and orders ancestors root -> parent
    const hydrated = await fetchFolderWithAncestors(mockSdk, '502')
    expect(folderCalls).toHaveLength(1)
    expect(ancestorCalls).toHaveLength(1)
    expect(hydrated.folder).toMatchObject({ id: '502', name: 'subfolder test', parent_id: '501' })
    expect(hydrated.ancestors.map((a) => a.id)).toEqual(['1', '501'])
    expect(hydrated.chain.map((c) => c.id)).toEqual(['1', '501', '502'])
    expect(hydrated.expandedIds).toEqual(['1', '501'])

    // 4. searchLookerFolders calls sdk.search_folders with normalized filter params
    const searchRes = await searchLookerFolders(mockSdk, {
      name: 'subfolder',
      parent_id: '501',
      is_personal: 'false',
      creator_id: '1',
      id: '502',
    })
    expect(searchCalls).toEqual([
      expect.objectContaining({
        name: 'subfolder',
        parent_id: '501',
        is_personal: false,
        creator_id: '1',
        id: '502',
      }),
    ])
    expect(searchRes).toEqual([
      expect.objectContaining({ id: '502', name: 'subfolder test', parent_id: '501' }),
    ])

    // 5. Issue #87: when sdk.folder_children or sdk.search_folders rejects with an entitlement/SDK error,
    // falls back to sdk.all_folders and computes child_count / has_children for nested subfolders
    clearLookerMetadataCache()
    const fallbackSdk = asSdk({
      ok: async <T>(p: T) => p,
      folder_children: async () => {
        throw new Error('Method folder_children is not entitled in manifest.lkml')
      },
      search_folders: async () => {
        throw new Error('Method search_folders is not entitled in manifest.lkml')
      },
      all_folders: async () => [
        { id: '5', name: 'My folder', parent_id: '2', is_personal: true },
        { id: '502', name: 'subfolder test', parent_id: '5', is_personal: true },
        { id: '504', name: 'nested leaf', parent_id: '502', is_personal: true },
      ],
    })
    const fallbackChildren = await fetchFolderChildren(fallbackSdk, '5')
    expect(fallbackChildren).toEqual([
      expect.objectContaining({
        id: '502',
        name: 'subfolder test',
        parent_id: '5',
        child_count: 1,
        has_children: true,
      }),
    ])
    const fallbackSearch = await searchLookerFolders(fallbackSdk, { name: 'subfolder' })
    expect(fallbackSearch).toEqual([
      expect.objectContaining({
        id: '502',
        name: 'subfolder test',
        parent_id: '5',
        child_count: 1,
        has_children: true,
      }),
    ])
  })

  test('27. provides StudioDesignSystem primitives (StudioButton, StudioBadge, StudioModal, StudioToolbar, StudioCard, StudioSkeleton, StudioDocPreview) and studio-design-system skill documentation', () => {
    expect(typeof StudioSelect).toBe('function')
    type Elem = React.ReactElement<Record<string, unknown>>

    const btn = StudioButton({ variant: 'primary', testId: 'ds-btn', children: 'Run' }) as Elem
    expect(btn.type).toBe('button')
    expect(btn.props['data-testid']).toBe('ds-btn')
    expect(btn.props.className).toContain('dab-btn-primary')

    const dangerBtn = StudioButton({ variant: 'danger', children: 'Delete' }) as Elem
    expect(dangerBtn.props.className).toContain('dab-badge-danger')

    const badge = StudioBadge({ tone: 'success', testId: 'ds-badge', children: 'OK' }) as Elem
    expect(badge.props['data-testid']).toBe('ds-badge')
    expect(badge.props.className).toContain('dab-badge')
    expect(badge.props.className).toContain('dab-badge-success')

    const pill = StudioBadge({ tone: 'warning', pill: true, children: '2 warnings' }) as Elem
    expect(pill.props.className).toContain('dab-msg-pill')
    expect(pill.props.className).toContain('dab-badge-warning')

    expect(typeof StudioModal).toBe('function')

    const toolbar = StudioToolbar({
      testId: 'ds-toolbar',
      titleBlockTestId: 'ds-title-block',
      title: 'Preview',
      badges: 'Badge',
      actions: 'Action',
    }) as Elem
    expect(toolbar.props['data-testid']).toBe('ds-toolbar')
    expect(toolbar.props.className).toContain('dab-preview-toolbar')

    const card = StudioCard({ testId: 'ds-card', children: 'Card body' }) as Elem
    expect(card.props['data-testid']).toBe('ds-card')
    expect(card.props.className).toContain('dab-ds-card')

    const skel = StudioSkeleton({ width: 120, height: 28, testId: 'ds-skel' }) as Elem
    expect(skel.props['data-testid']).toBe('ds-skel')
    expect(skel.props.className).toContain('dab-skeleton')
    expect(skel.props.style).toMatchObject({ width: 120, height: 28 })

    const docPrev = StudioDocPreview({ component: 'RunPythonButton', children: 'Preview' }) as Elem
    expect(docPrev.props['data-testid']).toBe('doc-ui-preview')
    expect(docPrev.props['data-component']).toBe('RunPythonButton')
    expect(docPrev.props.style).toEqual({ pointerEvents: 'none', userSelect: 'none' })

    const repoRoot = path.resolve(__dirname, '../..')
    const skillMd = readFileSync(path.join(repoRoot, '.agents/skills/studio-design-system/SKILL.md'), 'utf8')
    expect(skillMd).toContain('name: studio-design-system')
    expect(skillMd).toContain('StudioModal')
    expect(skillMd).toContain('StudioToolbar')
    expect(skillMd).toContain('--dab-success-bg')
    expect(skillMd).toContain('lucide-react')

    const agentsMd = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('.agents/skills/studio-design-system/SKILL.md')
    expect(agentsMd).toContain('.agents/skills/issue-authoring/SKILL.md')

    // Issue #86: verify starter prompts, LookML turn skills, and DOC_UI_COMPONENTS contain zero decorative emojis
    for (const items of Object.values(STARTER_PROMPTS_BY_USE_CASE)) {
      for (const item of items) {
        expect(item.label).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      }
    }
    const pkgJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkgJson.dependencies?.['lucide-react']).toBeTruthy()
  })

  test('28. enforces requirePermission on mutating sdk_request calls while auto-executing read-only GET and query/validation POST calls, and documents /spartan/oauth2_redirect + Safe Mode matrix (Issue #83)', async () => {
    // 1. Verify classifyLookerOperation across read-only vs mutating endpoints
    expect(classifyLookerOperation('GET', '/user')).toEqual({
      operation: 'read_user',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/queries/run/json')).toEqual({
      operation: 'read_queries_run_json',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/sql_queries')).toEqual({
      operation: 'read_sql_queries',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/merge_queries')).toEqual({
      operation: 'read_merge_queries',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/content_validation')).toEqual({
      operation: 'read_content_validation',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/validate')).toEqual({
      operation: 'read_projects_thelook_validate',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/lookml_tests/run')).toEqual({
      operation: 'read_projects_thelook_lookml_tests_run',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/projects/thelook/git_connection_tests')).toEqual({
      operation: 'read_projects_thelook_git_connection_tests',
      requiresPermission: false,
    })
    expect(classifyLookerOperation('POST', '/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('PATCH', '/dashboards/42')).toEqual({
      operation: 'update_dashboard',
      requiresPermission: true,
    })
    expect(classifyLookerOperation('DELETE', '/dashboards/42')).toEqual({
      operation: 'delete_dashboard',
      requiresPermission: true,
    })

    // 2. Verify executeLkrExtensionToolRequest for sdk_request read-only bypass vs mutating permission gate
    const transportCalls: Array<{ method: string; path: string; body?: unknown }> = []
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, _qp?: unknown, body?: unknown) => {
            transportCalls.push({ method, path: reqPath, body })
            return {
              ok: true,
              statusCode: 200,
              body: JSON.stringify({ ok: true, method, path: reqPath }),
            }
          },
        },
      },
    })

    let permPromptCount = 0
    // Read-only GET and read-only POST (/queries/run/json, /projects/thelook/validate) auto-execute without prompting
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'GET', path: '/user' },
      requirePermission: true,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: {
        kind: 'sdk_request',
        method: 'POST',
        path: '/queries/run/json',
        body: { model: 'thelook', view: 'order_items', fields: ['order_items.count'] },
      },
      requirePermission: true,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'POST', path: '/projects/thelook/validate' },
      requirePermission: true,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    expect(permPromptCount).toBe(0)
    expect(transportCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /user',
      'POST /queries/run/json',
      'POST /projects/thelook/validate',
    ])

    // Mutating sdk_request without onPermissionRequest or with 'deny' rejects before hitting transport
    transportCalls.length = 0
    await expect(
      executeLkrExtensionToolRequest({
        sdk: mockSdk,
        req: {
          kind: 'sdk_request',
          method: 'POST',
          path: '/dashboards',
          body: { title: 'Blocked Dashboard' },
          dev_mode: true,
        },
        requirePermission: true,
      })
    ).rejects.toThrow(/PermissionError: Operation 'create_dashboard' \(POST \/dashboards\)/)
    expect(transportCalls).toHaveLength(0)

    await expect(
      executeLkrExtensionToolRequest({
        sdk: mockSdk,
        req: {
          kind: 'sdk_request',
          method: 'DELETE',
          path: '/dashboards/42',
          thought: 'Deleting test dashboard 42',
        },
        requirePermission: true,
        onPermissionRequest: async (permReq) => {
          permPromptCount += 1
          expect(permReq).toMatchObject({
            operation: 'delete_dashboard',
            httpMethod: 'DELETE',
            path: '/dashboards/42',
            thought: 'Deleting test dashboard 42',
          })
          return 'deny'
        },
      })
    ).rejects.toThrow(/PermissionError: Operation 'delete_dashboard' \(DELETE \/dashboards\/42\)/)
    expect(permPromptCount).toBe(1)
    expect(transportCalls).toHaveLength(0)

    // 'allow_op' prompts only once across repeated mutating sdk_request calls of the same operation
    const approvedOps = new Set<string>()
    permPromptCount = 0
    for (let i = 0; i < 3; i++) {
      await executeLkrExtensionToolRequest({
        sdk: mockSdk,
        req: {
          kind: 'sdk_request',
          method: 'POST',
          path: '/dashboards',
          body: { title: `Dash ${i}` },
        },
        requirePermission: true,
        approvedOperations: approvedOps,
        onPermissionRequest: async (permReq) => {
          permPromptCount += 1
          expect(permReq.operation).toBe('create_dashboard')
          return 'allow_op'
        },
      })
    }
    expect(permPromptCount).toBe(1)
    expect(approvedOps.has('create_dashboard')).toBe(true)
    expect(transportCalls).toHaveLength(3)

    // 'allow_all' approves all subsequent mutating operations in the turn
    const allowAllSet = new Set<string>()
    permPromptCount = 0
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'PATCH', path: '/dashboards/42', body: { title: 'Updated' } },
      requirePermission: true,
      approvedOperations: allowAllSet,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'allow_all'
      },
    })
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'DELETE', path: '/dashboards/42' },
      requirePermission: true,
      approvedOperations: allowAllSet,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    expect(permPromptCount).toBe(1)
    expect(allowAllSet.has('*')).toBe(true)

    // Auto-Approve (YOLO: requirePermission: false) executes without prompting
    permPromptCount = 0
    await executeLkrExtensionToolRequest({
      sdk: mockSdk,
      req: { kind: 'sdk_request', method: 'POST', path: '/dashboards', body: { title: 'YOLO' } },
      requirePermission: false,
      onPermissionRequest: async () => {
        permPromptCount += 1
        return 'deny'
      },
    })
    expect(permPromptCount).toBe(0)

    // 3. Verify README.md and .agents/skills/looker-permissions/SKILL.md documentation
    const repoRoot = path.resolve(__dirname, '../..')
    const readmeMd = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    expect(readmeMd).toContain('/extensions/oauth2_redirect')
    expect(readmeMd).toContain('/spartan/oauth2_redirect')
    expect(readmeMd).toContain('Safe Mode (Ask)')
    expect(readmeMd).toContain('Auto-Approve (YOLO)')

    const permSkillMd = readFileSync(
      path.join(repoRoot, '.agents/skills/looker-permissions/SKILL.md'),
      'utf8'
    )
    expect(permSkillMd).toContain('name: looker-permissions')
    expect(permSkillMd).toContain('/spartan/oauth2_redirect')
    expect(permSkillMd).toContain('Safe Mode (Ask)')
    expect(permSkillMd).toContain('classifyLookerOperation')
  })

  test('29. Issue #84: removes hardcoded order_items starter prompts, strips emojis from starter labels, discovers explore fields via lookml_model_explore, and synthesizes dynamic starter prompts via [STARTER_PROMPTS_REQUEST] with skeleton loading state', async () => {
    clearStarterPromptsCache()
    const repoRoot = path.resolve(__dirname, '../..')
    const workspaceTsx = readFileSync(
      path.join(repoRoot, 'src/components/StudioWorkspace.tsx'),
      'utf8'
    )
    expect(workspaceTsx).not.toMatch(/order_items/i)
    expect(JSON.stringify(STARTER_PROMPTS_BY_USE_CASE)).not.toMatch(/order_items/i)

    // 1. Emoji stripping on labels
    expect(stripStarterPromptEmojis('📊 Build an Executive Revenue Data App')).toBe(
      'Build an Executive Revenue Data App'
    )
    expect(stripStarterPromptEmojis('✨🐍 Explore & Filter Summary')).toBe(
      'Explore & Filter Summary'
    )
    for (const list of Object.values(STARTER_PROMPTS_BY_USE_CASE)) {
      for (const item of list) {
        expect(item.label).toBe(stripStarterPromptEmojis(item.label))
        expect(item.prompt).not.toMatch(/order_items/i)
      }
    }

    // 2. Discover explore context + recent user content via Looker 4.0 SDK lookml_model_explore + content_summary (cached)
    let exploreCalls = 0
    let contentSummaryCalls = 0
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      content_summary: async () => {
        contentSummaryCalls += 1
        return [
          {
            id: 42,
            content_type: 'dashboard',
            content_id: '101',
            content_slug: 'store-executive-pulse',
            title: 'Store Executive Pulse',
            description: 'Weekly store revenue and basket size',
            view_count: 85,
            favorite_count: 12,
            is_scheduled: true,
          },
          {
            id: 43,
            content_type: 'look',
            content_id: '204',
            title: 'Regional Basket Margin Look',
            view_count: 19,
            favorite_count: 3,
            is_scheduled: false,
          },
        ]
      },
      lookml_model_explore: async (modelName: string, exploreName: string) => {
        exploreCalls += 1
        return {
          id: `${modelName}::${exploreName}`,
          name: exploreName,
          label: 'Store Transactions',
          model_name: modelName,
          fields: {
            dimensions: [
              { name: 'store_transactions.store_region', label_short: 'Store Region', type: 'string' },
              { name: 'store_transactions.transaction_month', label_short: 'Transaction Month', type: 'date_month' },
            ],
            measures: [
              { name: 'store_transactions.net_sales', label_short: 'Net Sales', type: 'sum' },
              { name: 'store_transactions.basket_count', label_short: 'Basket Count', type: 'count' },
            ],
          },
        }
      },
    })

    const availableModels = [
      {
        name: 'retail_ops',
        label: 'Retail Operations',
        explores: [{ name: 'store_transactions', label: 'Store Transactions', hidden: false }],
      },
    ]

    const ctx1 = await discoverStarterExploreContext({
      sdk: mockSdk,
      selectedExplores: [],
      availableModels,
    })
    expect(exploreCalls).toBe(1)
    expect(contentSummaryCalls).toBe(1)
    expect(ctx1).toMatchObject({
      modelName: 'retail_ops',
      exploreName: 'store_transactions',
      exploreLabel: 'Store Transactions',
      exploreKey: 'retail_ops::store_transactions',
    })
    expect(ctx1?.measures.map((m) => m.label)).toEqual(['Net Sales', 'Basket Count'])
    expect(ctx1?.contentSummaries).toHaveLength(2)
    expect(ctx1?.contentSummaries?.[0]).toMatchObject({
      content_type: 'dashboard',
      content_id: '101',
      title: 'Store Executive Pulse',
    })
    expect(await discoverStarterContentSummaries(mockSdk)).toHaveLength(2)
    expect(contentSummaryCalls).toBe(1)

    // Second lookup for same explore hits in-memory cache
    const ctx2 = await discoverStarterExploreContext({
      sdk: mockSdk,
      selectedExplores: ['retail_ops::store_transactions'],
      availableModels,
    })
    expect(exploreCalls).toBe(1)
    expect(ctx2?.exploreKey).toBe('retail_ops::store_transactions')

    // 3. Deterministic dynamic prompts reflect discovered explore, content_summary, & permitted use cases
    const localPrompts = buildDynamicStarterPrompts({
      useCase: 'auto',
      selectedExplores: ['retail_ops::store_transactions'],
      permittedUseCases: ['app', 'dashboard', 'conversational-analytics'],
      availableModels,
      exploreContext: ctx1,
    })
    expect(localPrompts.length).toBe(3)
    expect(localPrompts[0].label).toContain('Store Transactions')
    expect(localPrompts[0].prompt).toContain('retail_ops::store_transactions')
    expect(localPrompts[0].prompt).toContain('Net Sales')
    expect(localPrompts.every((p) => ['app', 'dashboard', 'conversational-analytics'].includes(p.useCase || ''))).toBe(true)

    const appPrompts = buildDynamicStarterPrompts({
      useCase: 'app',
      selectedExplores: ['retail_ops::store_transactions'],
      availableModels,
      exploreContext: ctx1,
    })
    expect(appPrompts[2].label).toBe('Upgrade Store Executive Pulse to Data App')
    expect(appPrompts[2].prompt).toContain('"Store Executive Pulse" Looker dashboard (#101)')

    const dashPrompts = buildDynamicStarterPrompts({
      useCase: 'dashboard',
      selectedExplores: ['retail_ops::store_transactions'],
      availableModels,
      exploreContext: ctx1,
    })
    expect(dashPrompts[2].label).toBe('Pin Store Executive Pulse & Schedule')
    expect(dashPrompts[2].prompt).toContain('"Store Executive Pulse" (#101)')

    // 4. Stateless [STARTER_PROMPTS_REQUEST] side-request when authenticated
    const capturedBodies: Array<Record<string, unknown>> = []
    const mockExtensionSDK = {
      lookerHostData: { hostUrl: 'https://looker.example.com' },
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const parsed = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        capturedBodies.push(parsed)
        return {
          ok: true,
          status: 200,
          body: {
            id: 'int_starter_84',
            status: 'completed',
            output_text: `<STARTER_PROMPTS>${JSON.stringify([
              {
                id: 'custom-1',
                label: '📊 Net Sales Regional Scorecard',
                prompt: 'Build a Store Transactions Data App on retail_ops::store_transactions with Net Sales and Basket Count by Store Region.',
                useCase: 'app',
              },
              {
                id: 'custom-2',
                label: '📈 Store Transactions Executive UDD',
                prompt: 'Create a native Looker UDD on retail_ops::store_transactions tracking Net Sales across Transaction Month.',
                useCase: 'dashboard',
              },
              {
                id: 'custom-3',
                label: '💬 Top Store Regions by Net Sales',
                prompt: 'Which Store Region in retail_ops::store_transactions had the highest Net Sales last quarter?',
                useCase: 'conversational-analytics',
              },
            ])}</STARTER_PROMPTS>`,
          },
        }
      },
    }

    const agentPrompts = await generateDynamicStarterPrompts({
      sdk: mockSdk,
      extensionSDK: mockExtensionSDK,
      auth: { mode: 'apikey', apiKey: 'test-key-84' },
      useCase: 'auto',
      selectedExplores: ['retail_ops::store_transactions'],
      permittedUseCases: ['app', 'dashboard', 'conversational-analytics'],
      availableModels,
      exploreContext: ctx1,
      pollScheduleMs: [0],
    })
    expect(capturedBodies).toHaveLength(1)
    expect(capturedBodies[0].model).toBe(DEFAULT_ANTIGRAVITY_MODEL)
    expect(capturedBodies[0].store).toBe(false)
    expect(capturedBodies[0].background).toBe(false)
    expect(capturedBodies[0].tools).toEqual([])
    expect(capturedBodies[0].previous_interaction_id).toBeUndefined()
    expect(capturedBodies[0].environment).toBeUndefined()
    expect(capturedBodies[0].agent_config).toBeUndefined()
    expect(capturedBodies[0].system_instruction).toContain('Synthesize 3-4 concise, tailored Looker Studio starter prompts')
    expect(capturedBodies[0].generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 1024 })
    expect(capturedBodies[0].response_format).toEqual(STARTER_PROMPTS_RESPONSE_FORMAT)
    const sentInput = (capturedBodies[0].input as Array<{ text?: string }>)[0]?.text || ''
    expect(sentInput).toContain(STARTER_PROMPTS_REQUEST_TAG)
    expect(sentInput).toContain('retail_ops::store_transactions')
    expect(sentInput).toContain('Recent user content (content_summary):')
    expect(sentInput).toContain('Store Executive Pulse')
    expect(agentPrompts.map((p) => p.label)).toEqual([
      'Net Sales Regional Scorecard',
      'Store Transactions Executive UDD',
      'Top Store Regions by Net Sales',
    ])
    expect(
      getCachedStarterPrompts(
        'auto',
        'retail_ops::store_transactions',
        ['app', 'dashboard', 'conversational-analytics'],
        true
      )
    ).toEqual(agentPrompts)

    // Parse fallback safety when malformed output is returned
    expect(parseStarterPromptsResponse('invalid json', localPrompts)).toEqual(localPrompts)
    expect(AGENTS_MD).toContain(STARTER_PROMPTS_REQUEST_TAG)

    // 5. StarterPromptButtons skeleton & loaded states
    type Elem = React.ReactElement<Record<string, unknown>>
    const skelTree = StarterPromptButtons({
      useCase: 'auto',
      prompts: [],
      loading: true,
      onSelect: () => {},
    }) as Elem
    expect(skelTree.props['data-testid']).toBe('studio-starter-prompts-skeleton')

    const loadedTree = StarterPromptButtons({
      useCase: 'auto',
      prompts: agentPrompts,
      loading: false,
      onSelect: () => {},
    }) as Elem
    expect(loadedTree.props['data-testid']).toBe('studio-starter-prompts')
  })

  test('Issue #92: preloads content_summary, searches global_search_v2, hydrates @dashboard/@look/@conversation/@explore context, and seeds /workspace/uploads', async () => {
    clearLookerMetadataCache()
    expect(SWR_DEDUPED_METHODS).toContain('content_summary')
    expect(isTextAttachmentFile('sales.csv', 'text/csv')).toBe(true)
    expect(isTextAttachmentFile('orders.refinement.lkml', 'application/octet-stream')).toBe(true)
    expect(isTextAttachmentFile('screenshot.png', 'image/png')).toBe(false)
    expect(isTextAttachmentFile('report.pdf', 'application/pdf')).toBe(false)

    const rawCalls: Array<{ method: string; path: string; queryParams?: Record<string, unknown> }> = []
    const mockSdk = asSdk({
      ok: async <T>(p: Promise<T> | T) => p,
      content_summary: async () => [
        {
          id: 'cs_901',
          content_type: 'dashboard',
          content_id: '901',
          title: 'Business Pulse',
          description: 'Executive KPIs & brand breakdown',
        },
        {
          id: 'cs_301',
          content_type: 'look',
          content_id: '301',
          title: 'Monthly Gross Margin Look',
          description: 'Margin trend by month',
        },
      ],
      dashboard: async (idOrParams: unknown) => {
        const id =
          typeof idOrParams === 'object' && idOrParams !== null && 'dashboard_id' in idOrParams
            ? String((idOrParams as { dashboard_id: unknown }).dashboard_id)
            : String(idOrParams || '')
        return {
          id,
          title: 'Business Pulse',
          description: 'Executive KPIs & brand breakdown',
          folder_id: '5',
          dashboard_filters: [{ name: 'Date', field: 'order_items.created_date' }],
          dashboard_layouts: [{ id: '10', type: 'newspaper', active: true }],
          dashboard_elements: [
            {
              id: '501',
              title: 'Revenue by Brand',
              type: 'vis',
              query: {
                model: 'thelook',
                view: 'order_items',
                fields: ['products.brand', 'order_items.total_sale_price'],
                sorts: ['order_items.total_sale_price desc'],
                limit: '15',
              },
            },
            {
              id: '502',
              title: 'Store Basket Count',
              type: 'vis',
              result_maker: {
                query: {
                  model: 'retail_ops',
                  view: 'store_transactions',
                  fields: ['store_transactions.store_region', 'store_transactions.basket_count'],
                  limit: '10',
                },
              },
            },
          ],
        }
      },
      look: async (idOrParams: unknown) => {
        const id =
          typeof idOrParams === 'object' && idOrParams !== null && 'look_id' in idOrParams
            ? String((idOrParams as { look_id: unknown }).look_id)
            : String(idOrParams || '')
        return {
          id,
          title: 'Monthly Gross Margin Look',
          folder_id: '5',
          query: {
            model: 'thelook',
            view: 'inventory_items',
            fields: ['inventory_items.cost'],
            limit: '20',
          },
        }
      },
      authSession: {
        transport: {
          rawRequest: async (
            method: string,
            reqPath: string,
            queryParams?: Record<string, unknown>
          ) => {
            rawCalls.push({ method, path: reqPath, queryParams })
            if (reqPath.includes('global_search_v2')) {
              return {
                ok: true,
                statusCode: 200,
                body: JSON.stringify({
                  sections: [
                    {
                      name: 'Dashboards',
                      items: [
                        {
                          content_type: 'dashboard',
                          content_id: '901',
                          title: 'Business Pulse',
                        },
                      ],
                    },
                  ],
                }),
              }
            }
            return { ok: true, statusCode: 200, body: '[]' }
          },
        },
      },
    })

    const preloaded = await fetchPreloadedContentSummary(mockSdk)
    expect(preloaded).toEqual([
      expect.objectContaining({ type: 'dashboard', id: '901', title: 'Business Pulse' }),
      expect.objectContaining({ type: 'look', id: '301', title: 'Monthly Gross Margin Look' }),
    ])

    const searchDashboards = await searchGlobalContentV2(mockSdk, {
      term: 'Business Pulse',
      category: 'dashboard',
      limit: 15,
    })
    expect(searchDashboards).toEqual([
      expect.objectContaining({ type: 'dashboard', id: '901', title: 'Business Pulse' }),
    ])
    expect(rawCalls.some((c) => c.path === '/api/4.0/global_search_v2')).toBe(true)

    const hydrated = await hydrateMentionedContext({
      sdk: mockSdk,
      mentions: [
        { type: 'dashboard', id: '901', title: 'Business Pulse' },
        { type: 'look', id: '301', title: 'Monthly Gross Margin Look' },
        { type: 'explore', id: 'thelook::users', title: 'Users', model: 'thelook', explore: 'users' },
        { type: 'conversation', id: 'conv_prev_1', title: 'Prior Revenue Thread' },
      ],
      conversations: [
        {
          id: 'conv_prev_1',
          type: 'app',
          label: 'Prior Revenue Thread',
          updatedAt: '2026-11-02T00:00:00Z',
          explores: ['thelook::events'],
          messages: [{ role: 'user', text: 'Analyze event funnel conversion.' }],
        },
      ],
      selectedExplores: [],
    })

    expect(hydrated.explores).toEqual([
      'thelook::order_items',
      'retail_ops::store_transactions',
      'thelook::inventory_items',
      'thelook::users',
      'thelook::events',
    ])
    expect(hydrated.extraSources.map((s) => s.target)).toEqual([
      '/workspace/context/dashboard_901.json',
      '/workspace/context/look_301.json',
      '/workspace/context/conversation_conv_prev_1.md',
    ])
    expect(hydrated.promptSummary).toContain('@dashboard:Business Pulse')
    expect(hydrated.promptSummary).toContain('/workspace/context/dashboard_901.json')
    expect(hydrated.promptSummary).toContain('@look:Monthly Gross Margin Look')
    expect(hydrated.promptSummary).toContain('@conversation:Prior Revenue Thread')

    // Verify StudioAttachedFile uploads (text/CSV + PDF + image) in runAntigravityTurn
    const turnBodies: MockInteractionPostBody[] = []
    const mockExt = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(init.body) as MockInteractionPostBody) : undefined
        if (body) turnBodies.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_92_uploads',
            environment_id: 'env_92',
            status: 'completed',
            output_text: '<USE_CASE>app</USE_CASE>Built Data App from Business Pulse & CSV.',
          }),
        }
      },
    }
    const attachments: StudioAttachedFile[] = [
      {
        id: 'att_csv',
        name: 'targets.csv',
        mimeType: 'text/csv',
        size: 32,
        data: 'cmVnaW9uLHRhcmdldApXZXN0LDEwMAo=',
        dataUrl: 'data:text/csv;base64,cmVnaW9uLHRhcmdldApXZXN0LDEwMAo=',
        textContent: 'region,target\nWest,100\n',
      },
      {
        id: 'att_pdf',
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 128,
        data: 'JVBERi0xLjQK',
        dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
      },
    ]
    await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExt,
      auth: { mode: 'apikey', apiKey: 'key-92' },
      session: {},
      selectedExplores: hydrated.explores,
      schemaMarkdown: '# Schema',
      userPrompt: `Turn @dashboard:Business Pulse into a Data App\n\n${hydrated.promptSummary}`,
      images: attachments,
      extraSources: hydrated.extraSources,
      pollScheduleMs: [0],
      onStatus: () => {},
    })

    expect(turnBodies).toHaveLength(1)
    const envObj = turnBodies[0].environment as {
      sources?: Array<{ target: string; content: string }>
    }
    const targets = (envObj.sources || []).map((s) => s.target)
    expect(targets).toContain('/workspace/context/dashboard_901.json')
    expect(targets).toContain('/workspace/uploads/targets.csv')
    expect(targets).toContain('/workspace/uploads/brief.pdf')
    const csvSource = (envObj.sources || []).find((s) => s.target === '/workspace/uploads/targets.csv')
    expect(csvSource?.content).toBe('region,target\nWest,100\n')
    const inputItems = turnBodies[0].input || []
    expect(inputItems[0]?.text).toContain('/workspace/uploads/targets.csv')
    expect(inputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'document', mime_type: 'application/pdf', data: 'JVBERi0xLjQK' }),
      ])
    )
  })

  test('30. Issue #94: registers Data Investigator (data-investigator) use case, Google Doc & Slides narrative guide, LookML drill_fields in buildDenseExploreSchema, run_key_driver_analysis in LkrCodeMode, and convertRelativeDateFilterToFixed', async () => {
    // 1. Routing, aliases, badges, and classification
    expect(USE_CASE_BADGES['data-investigator']).toEqual({
      label: 'Data Investigator',
      className: 'dab-use-case-badge-investigator',
    })
    expect(buildStudioRoute('data-investigator')).toBe('/data-investigator')
    expect(buildStudioRoute('data-investigator', '42')).toBe('/data-investigator/42')
    expect(parseStudioRoute('/data-investigator/42')).toEqual({
      mode: 'app',
      objectId: '42',
      conversationId: '42',
      useCase: 'data-investigator',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/c/conv_data-investigator_42')).toEqual({
      mode: 'app',
      objectId: '42',
      conversationId: 'conv_data-investigator_42',
      useCase: 'data-investigator',
    })
    expect(parseStudioRoute('/c/inv_42')).toEqual({
      mode: 'app',
      objectId: 'inv_42',
      conversationId: 'inv_42',
      useCase: 'data-investigator',
    })
    expect(
      classifyStudioUseCase(
        'Run a key driver analysis and root-cause investigation in a Google Doc narrative report'
      )
    ).toBe('data-investigator')
    expect(
      extractResolvedUseCase(
        '<USE_CASE>data-investigator</USE_CASE>\nBuilt Google Presentation slides investigation.',
        'Investigate revenue drop in slides'
      )
    ).toBe('data-investigator')

    // 2. DATA_INVESTIGATOR_GUIDE_MD contract (Doc default vs Slides mode, Chart -> What This Chart Means -> Next Investigation Path, limit 500)
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain("this.viewMode = 'doc'")
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain("this.viewMode = 'slides'")
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('Doc View')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('Slides View')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('What This Chart Means')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('Next Investigation Path')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain("limit: '500'")
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('run_key_driver_analysis')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('to_fixed_date_range')

    // 3. buildDenseExploreSchema surfaces LookML drill_fields on measures and dimensions
    clearLookerMetadataCache()
    const mockDrillSdk = asSdk({
      ok: async <T>(p: T) => p,
      lookml_model_explore: async () => ({
        name: 'order_items',
        label: 'Order Items',
        view_name: 'order_items',
        fields: {
          measures: [
            {
              name: 'order_items.total_sale_price',
              label: 'Total Sale Price',
              type: 'sum',
              drill_fields: ['products.category', 'products.brand', 'users.country'],
            },
          ],
          dimensions: [
            {
              name: 'products.category',
              label: 'Category',
              type: 'string',
              drill_fields: ['products.brand', 'products.name'],
            },
          ],
        },
      }),
      run_inline_query: async () => [],
    })
    const schemaMd = await buildDenseExploreSchema(mockDrillSdk, 'thelook', 'order_items')
    expect(schemaMd).toContain(
      '[Drills: `products.category, products.brand, users.country`]'
    )
    expect(schemaMd).toContain('[Drills: `products.brand, products.name`]')

    // 4. convertRelativeDateFilterToFixed & normalizeQueryFiltersToFixedDates
    const anchor = '2026-03-30'
    expect(convertRelativeDateFilterToFixed('today', anchor)).toBe('2026-03-30 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('yesterday', anchor)).toBe('2026-03-29 to 2026-03-29')
    expect(convertRelativeDateFilterToFixed('last 30 days', anchor)).toBe('2026-02-28 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('90 days', anchor)).toBe('2025-12-30 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last 4 weeks', anchor)).toBe('2026-03-02 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last 3 months', anchor)).toBe('2025-12-30 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('this month', anchor)).toBe('2026-03-01 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last month', anchor)).toBe('2026-02-01 to 2026-02-28')
    expect(convertRelativeDateFilterToFixed('this quarter', anchor)).toBe('2026-01-01 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last quarter', anchor)).toBe('2025-10-01 to 2025-12-31')
    expect(convertRelativeDateFilterToFixed('this year', anchor)).toBe('2026-01-01 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last year', anchor)).toBe('2025-01-01 to 2025-12-31')
    expect(convertRelativeDateFilterToFixed('2026-01-01 to 2026-03-31', anchor)).toBe(
      '2026-01-01 to 2026-03-31'
    )
    expect(convertRelativeDateFilterToFixed('Complete', anchor)).toBe('Complete')
    expect(
      normalizeQueryFiltersToFixedDates(
        {
          'order_items.created_date': 'last 30 days',
          'order_items.status': 'Complete',
        },
        anchor
      )
    ).toEqual({
      'order_items.created_date': '2026-02-28 to 2026-03-30',
      'order_items.status': 'Complete',
    })

    // 5. LkrCodeMode run_key_driver_analysis & to_fixed_date_range read-only whitelisting
    expect(classifyLookerOperation('POST', '/api/4.0/internal/kda/analyze')).toEqual({
      operation: 'read_internal_kda_analyze',
      requiresPermission: false,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/internal/kda/analyze')).toEqual({
      operation: 'read_internal_kda_analyze',
      requiresPermission: false,
    })

    const kdaCalls: Array<{ method: string; path: string; body: unknown }> = []
    const kdaOut = await LkrCodeMode.runPythonCode(
      `
fixed_window = to_fixed_date_range("last 30 days")
res = run_key_driver_analysis({
    "data_source": {"model_name": "thelook", "explore_name": "order_items"},
    "contribution_metric": "order_items.total_sale_price",
    "dimensions": ["products.category", "products.brand"],
    "baseline_filters": {"order_items.created_date": to_fixed_date_range("last month")},
    "breach_filters": {"order_items.created_date": fixed_window},
})
return {"anchor": INVESTIGATION_ANCHOR_DATE, "fixed_window": fixed_window, "kda": res}
`,
      {
        vars: { INVESTIGATION_ANCHOR_DATE: '2026-03-30' },
        requirePermission: true,
        requestHandler: async (m: string, p: string, _q: unknown, b: unknown) => {
          kdaCalls.push({ method: m, path: p, body: b })
          return { status: 'SUCCESS', drivers: [{ dimension: 'products.category', value: 'Outerwear' }] }
        },
      }
    )
    const parsedKda = typeof kdaOut === 'string' ? JSON.parse(kdaOut) : kdaOut
    expect(parsedKda.anchor).toBe('2026-03-30')
    expect(parsedKda.fixed_window).toBe('2026-02-28 to 2026-03-30')
    expect(kdaCalls).toHaveLength(1)
    expect(kdaCalls[0]).toMatchObject({
      method: 'POST',
      path: '/internal/kda/analyze',
      body: {
        data_source: { model_name: 'thelook', explore_name: 'order_items' },
        contribution_metric: 'order_items.total_sale_price',
        dimensions: ['products.category', 'products.brand'],
        baseline_filters: { 'order_items.created_date': '2026-02-01 to 2026-02-28' },
        breach_filters: { 'order_items.created_date': '2026-02-28 to 2026-03-30' },
      },
    })
  })

  test('31. Issue #99: supports an array of Looker content items per conversation with meaningful tabs, backwards-compatible hydration, multi-item deletion cleanup, and @looker/embed-sdk loadX() switching', async () => {
    // 1. Meaningful titles & embed paths (never bare numeric IDs)
    expect(formatStudioContentItemTitle('dashboard', '7', '7')).toBe('Dashboard #7')
    expect(formatStudioContentItemTitle('dashboard', '7', 'Executive Revenue Overview')).toBe(
      'Executive Revenue Overview'
    )
    expect(formatStudioContentItemTitle('look', '15', '')).toBe('Look #15')
    expect(formatStudioContentItemTitle('explore', 'thelook::order_items')).toBe(
      'Thelook: Order Items'
    )
    expect(formatStudioContentItemTitle('explore', 'thelook::order_items', 'eCommerce: Order Items')).toBe(
      'eCommerce: Order Items'
    )
    expect(resolveStudioContentEmbedPath('explore', 'thelook::order_items')).toBe(
      '/embed/explore/thelook/order_items'
    )
    expect(resolveStudioContentEmbedPath('look', '15')).toBe('/embed/looks/15')
    expect(resolveStudioContentEmbedPath('extension', 'my_proj::my_ext')).toBe(
      '/embed/extensions/my_proj::my_ext'
    )
    expect(resolveStudioContentEmbedPath('report', 'rep_101')).toBe('/embed/reporting/rep_101')

    // 2. Upsert deduplication by `${contentType}:${id}` and order preservation
    let items: StudioContentItem[] = []
    const step1 = upsertStudioContentItem(items, {
      id: 'thelook::order_items',
      contentType: 'explore',
      title: 'eCommerce: Order Items',
    })
    items = step1.items
    expect(step1.activeKey).toBe('explore:thelook::order_items')
    expect(items).toHaveLength(1)

    const step2 = upsertStudioContentItem(items, {
      id: '7',
      dashboardId: '7',
      contentType: 'dashboard',
      title: 'Quarterly Revenue UDD',
    })
    items = step2.items
    expect(step2.activeKey).toBe('dashboard:7')
    expect(items.map((i) => i.key)).toEqual(['explore:thelook::order_items', 'dashboard:7'])

    const step3 = upsertStudioContentItem(items, {
      id: '15',
      lookId: '15',
      contentType: 'look',
      title: 'Monthly Churn Look',
    })
    items = step3.items
    expect(step3.activeKey).toBe('look:15')
    expect(items.map((i) => i.key)).toEqual([
      'explore:thelook::order_items',
      'dashboard:7',
      'look:15',
    ])

    // Updating dashboard:7 in place preserves tab order and updates title
    const step4 = upsertStudioContentItem(items, {
      id: '7',
      dashboardId: '7',
      contentType: 'dashboard',
      title: 'Quarterly Revenue UDD (v2)',
    })
    expect(step4.activeKey).toBe('dashboard:7')
    expect(step4.items.map((i) => i.key)).toEqual([
      'explore:thelook::order_items',
      'dashboard:7',
      'look:15',
    ])
    expect(step4.items[1].title).toBe('Quarterly Revenue UDD (v2)')

    // 3. Backwards-compatible hydration from legacy single-item conv.content
    expect(
      hydrateConversationContentItems({
        id: 'conv_app_42',
        type: 'app',
        label: 'Executive Revenue App',
        content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'data_app:42',
        id: '42',
        contentType: 'data_app',
        title: 'Executive Revenue App',
        embedPath: '/embed/dashboards/42',
      }),
    ])

    expect(
      hydrateConversationContentItems({
        id: 'conv_dashboard_7',
        type: 'dashboard',
        label: 'Quarterly UDD',
        content: { dashboardId: '7', lookId: '15' },
      }).map((i) => ({ key: i.key, title: i.title }))
    ).toEqual([
      { key: 'dashboard:7', title: 'Quarterly UDD' },
      { key: 'look:15', title: 'Look #15' },
    ])

    // 4. Multi-item resolveConversationRelatedContent & deleteUserConversation cleanup
    clearArtifactServiceCache()
    const deletedDashboards: string[] = []
    const deletedLooks: string[] = []
    const store = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) =>
        key
          .split(',')
          .filter((k) => store.has(k))
          .map((k) => ({ key: k, value: store.get(k)!, version: 1 })),
      search_artifacts: async () => [],
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) store.set(u.key, u.value)
        return updates.map((u) => ({ key: u.key, version: 1 }))
      },
      delete_artifact: async (_ns: string, key: string) => {
        for (const k of key.split(',')) store.delete(k.trim())
        return ''
      },
      delete_dashboard: async (id: string) => {
        deletedDashboards.push(String(id))
        return ''
      },
      delete_look: async (id: string) => {
        deletedLooks.push(String(id))
        return ''
      },
    })

    const multiConv = {
      id: 'conv_multi_99',
      type: 'dashboard',
      label: 'Multi-Item Executive Session',
      content: { dashboardId: '7' },
      contentItems: [
        normalizeStudioContentItem({
          id: 'thelook::order_items',
          contentType: 'explore',
          title: 'eCommerce: Order Items',
        }),
        normalizeStudioContentItem({
          id: '7',
          dashboardId: '7',
          contentType: 'dashboard',
          title: 'Executive UDD',
        }),
        normalizeStudioContentItem({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Monthly Churn Look',
        }),
        normalizeStudioContentItem({
          id: '42',
          dashboardId: '42',
          contentType: 'data_app',
          title: 'Interactive Revenue App',
        }),
      ],
      activeContentTabKey: 'look:15',
      updatedAt: '2026-11-02T12:00:00Z',
    }

    const related = resolveConversationRelatedContent(multiConv, '1')
    expect(related.dashboardIds).toEqual(['7', '42'])
    expect(related.lookIds).toEqual(['15'])
    expect(related.sharedObjectKeys).toEqual(
      expect.arrayContaining(['obj_dashboard_7', 'obj_dashboard_15', 'obj_app_42'])
    )

    await saveUserConversation(mockSdk, '1', multiConv)
    await deleteUserConversation(mockSdk, '1', 'conv_multi_99', {
      deleteRelatedContent: true,
    })
    expect(deletedDashboards).toEqual(['7', '42'])
    expect(deletedLooks).toEqual(['15'])

    // 5. @looker/embed-sdk loadX() switching across activeContentItem tabs
    const attrs: Record<string, string> = {}
    const fakeIframe = {
      className: '',
      title: '',
      src: '',
      srcdoc: '',
      setAttribute: (k: string, v: string) => {
        attrs[`iframe:${k}`] = v
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
    await ctl.connectionPromise

    // Tab A: Explore -> loadExplore({ id: 'thelook/order_items' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: 'thelook::order_items',
          contentType: 'explore',
          title: 'eCommerce: Order Items',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('explore')
    expect(attrs['data-embed-target']).toBe('thelook/order_items')

    // Tab B: Look -> loadLook({ id: '15' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: '15',
          lookId: '15',
          contentType: 'look',
          title: 'Monthly Churn Look',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('look')
    expect(attrs['data-embed-target']).toBe('15')

    // Tab C: Dashboard -> loadDashboard({ id: '7' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: '7',
          dashboardId: '7',
          contentType: 'dashboard',
          title: 'Executive UDD',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('dashboard')
    expect(attrs['data-embed-target']).toBe('7')

    // Tab D: Extension -> loadExtension({ id: 'my_proj::my_ext' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: 'my_proj::my_ext',
          contentType: 'extension',
          title: 'Custom Extension',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('extension')
    expect(attrs['data-embed-target']).toBe('my_proj::my_ext')

    // Tab E: Report -> loadReport({ id: 'rep_101' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: 'rep_101',
          contentType: 'report',
          title: 'Executive Report',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('report')
    expect(attrs['data-embed-target']).toBe('rep_101')

    // Tab F: Board -> loadUrl({ url: '/embed/boards/9' })
    await ctl.syncTarget(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({
          id: '9',
          contentType: 'board',
          title: 'Leadership Board',
        }),
        nonce: 1,
      })
    )
    expect(attrs['data-embed-state']).toBe('url')
    expect(attrs['data-embed-target']).toBe('/embed/boards/9')

    expect(ctl.getTelemetry().calls).toEqual([
      { method: 'init', arg: 'https://dev-argolis.looker.com' },
      { method: 'preload', arg: '/embed/preload' },
      { method: 'loadExplore', arg: 'thelook/order_items' },
      { method: 'loadLook', arg: '15' },
      { method: 'loadDashboard', arg: '7' },
      { method: 'loadExtension', arg: 'my_proj::my_ext' },
      { method: 'loadReport', arg: 'rep_101' },
      { method: 'loadUrl', arg: '/embed/boards/9' },
    ])
  })

  test('32. Issue #104: provides CODEMODE_CDN_URL, synchronous LkrCodeMode tool & operation classification, and ensureCodeModeLoaded() runtime loader', async () => {
    expect(CODEMODE_CDN_URL).toBe('https://cdn.lkr.dev/cli/codemode/0.0.66/codemode.js')
    expect(CODEMODE_CDN_URL).toContain(`/${LKR_DEV_CLI_VERSION}/codemode.js`)
    const preCommitHook = readFileSync(path.resolve(__dirname, '../../.githooks/pre-commit'), 'utf8')
    expect(preCommitHook).toContain('lkr-dev-cli-version.txt')
    expect(preCommitHook).toContain('LKR_DEV_CLI_VERSION')
    expect(preCommitHook).toContain('CODEMODE_CDN_URL')
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.name).toBe('run_looker_codemode')
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.required).toEqual(['code', 'thought'])
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.code).toBeDefined()
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.vars).toBeDefined()
    expect(LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.thought).toBeDefined()
    expect(LkrCodeMode.classifyOperation('GET', '/models')).toEqual({
      operation: 'read_models',
      requiresPermission: false,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/dashboards')).toEqual({
      operation: 'create_dashboard',
      requiresPermission: true,
    })

    const runtime = await ensureCodeModeLoaded()
    expect(typeof runtime.runPythonCode).toBe('function')
    expect(runtime).not.toBe(LkrCodeMode)

    const out = await LkrCodeMode.runPythonCode('return {"sum": 2 + 3}')
    expect(JSON.parse(out)).toEqual({ sum: 5 })

    const manifestText = readFileSync(path.resolve(__dirname, '../../manifest.lkml'), 'utf8')
    expect(manifestText).toContain('"https://cdn.lkr.dev"')
  })

  test('33. Issue #105: supports AbortSignal cancellation (:cancel) and onInteractionCreated in runAntigravityTurn, forceFresh environment reset in prewarmOrWakeAntigravityEnvironment, and clearing user_env artifact via saveUserEnvironmentId', async () => {
    clearArtifactServiceCache()
    const store = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) =>
        key
          .split(',')
          .filter((k) => store.has(k))
          .map((k) => ({ key: k, value: store.get(k)!, version: 1 })),
      search_artifacts: async () => [],
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) store.set(u.key, u.value)
        return updates.map((u) => ({ key: u.key, version: 1 }))
      },
      delete_artifact: async (_ns: string, key: string) => {
        for (const k of key.split(',')) store.delete(k.trim())
        return ''
      },
    })

    // 1. Verify saveUserEnvironmentId with empty string clears persisted user_env:1 artifact
    await saveUserEnvironmentId(mockSdk, '1', 'env_saved_before_reset')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBe('env_saved_before_reset')
    await saveUserEnvironmentId(mockSdk, '1', '')
    expect(await loadUserEnvironmentId(mockSdk, '1')).toBeNull()

    // 2. Verify runAntigravityTurn cancellation via AbortSignal throws AbortError and calls :cancel
    const proxyRequests: Array<{ url: string; method: string }> = []
    const createdIds: string[] = []
    const abortController = new AbortController()
    const mockCancelExt = {
      serverProxy: async (url: string, init?: FetchCustomParameters) => {
        const method = init?.method || 'GET'
        proxyRequests.push({ url, method })
        if (url.endsWith(':cancel')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ id: 'int_105_cancel_1', status: 'cancelled' }),
          }
        }
        if (method === 'POST') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_105_cancel_1',
              environment_id: 'env_105_active',
              status: 'in_progress',
              steps: [{ type: 'thought', thought: 'Planning query' }],
            }),
          }
        }
        abortController.abort()
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_105_cancel_1',
            environment_id: 'env_105_active',
            status: 'in_progress',
          }),
        }
      },
    }

    await expect(
      runAntigravityTurn({
        sdk: mockSdk,
        extensionSDK: mockCancelExt,
        userId: '1',
        auth: { mode: 'apikey', apiKey: 'key-105' },
        session: {},
        selectedExplores: ['thelook::order_items'],
        schemaMarkdown: '# Schema',
        userPrompt: 'Build revenue overview',
        pollScheduleMs: [5],
        signal: abortController.signal,
        onInteractionCreated: (id) => createdIds.push(id),
        onStatus: () => {},
      })
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Turn stopped by user',
    })
    expect(createdIds).toEqual(['int_105_cancel_1'])
    expect(
      proxyRequests.some(
        (r) => r.method === 'POST' && r.url.endsWith('/interactions/int_105_cancel_1:cancel')
      )
    ).toBe(true)

    // 3. Verify prewarmOrWakeAntigravityEnvironment with forceFresh: true provisions a fresh remote environment
    const prewarmBodies: MockInteractionPostBody[] = []
    const mockFreshExt = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(init.body) as MockInteractionPostBody) : undefined
        if (body) prewarmBodies.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_105_fresh_prewarm',
            environment_id: 'env_105_fresh_99',
            status: 'completed',
            output_text: 'READY',
          }),
        }
      },
    }
    const freshRes = await prewarmOrWakeAntigravityEnvironment({
      sdk: mockSdk,
      userId: '1',
      extensionSDK: mockFreshExt,
      auth: { mode: 'apikey', apiKey: 'key-105' },
      toolType: 'app',
      environmentId: 'env_stale_old',
      existingSession: {
        toolType: 'app',
        environmentId: 'env_stale_old',
        lastInteractionId: 'int_stale_old',
      },
      selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema',
      forceFresh: true,
    })
    expect(freshRes.status).toBe('prelaunched')
    expect(freshRes.session.environmentId).toBe('env_105_fresh_99')
    expect(freshRes.session.lastInteractionId).toBeUndefined()
    expect(prewarmBodies).toHaveLength(1)
    expect(prewarmBodies[0].environment).toMatchObject({ type: 'remote' })
  })

  test('34. Issue #109: seeds skills/key-driver-analysis, expands investigate/find-out and tile/no-op routing, prevents false-positive Native dashboard #5 extraction, and preserves requires_action steps in activitySteps', async () => {
    // 1. Verify KDA_SKILL_MD + KDA_TOOLKIT_PY seeding and AGENTS.md / AGENTS_MD references
    const repoRoot = path.resolve(__dirname, '../..')
    const diskSkillMd = readFileSync(
      path.join(repoRoot, 'skills/key-driver-analysis/SKILL.md'),
      'utf8'
    )
    const diskToolkitPy = readFileSync(
      path.join(repoRoot, 'skills/key-driver-analysis/scripts/kda_toolkit.py'),
      'utf8'
    )
    const rootAgentsMd = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(KDA_SKILL_MD).toBe(diskSkillMd)
    expect(KDA_TOOLKIT_PY).toBe(diskToolkitPy)
    expect(rootAgentsMd).toContain('skills/key-driver-analysis/SKILL.md')
    expect(rootAgentsMd).toContain('skills/key-driver-analysis/scripts/kda_toolkit.py')
    expect(AGENTS_MD).toContain('skills/key-driver-analysis/SKILL.md')
    expect(AGENTS_MD).toContain('skills/key-driver-analysis/scripts/kda_toolkit.py')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('/workspace/skills/key-driver-analysis/SKILL.md')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py')

    const sources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: '/workspace/skills/key-driver-analysis/SKILL.md',
          content: KDA_SKILL_MD,
        }),
        expect.objectContaining({
          target: '/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py',
          content: KDA_TOOLKIT_PY,
        }),
      ])
    )

    // 2. Verify "investigate" / "find out" routing to 'data-investigator', personal space / folder / SDK queries to 'tile', and conversational no-ops
    expect(matchExplicitUseCaseRule('Investigate our Q3 sales on the Business Pulse dashboard')).toBe(
      'data-investigator'
    )
    expect(
      extractResolvedUseCase('', 'Find out why gross margin dropped in the order_items explore')
    ).toBe('data-investigator')
    expect(
      matchExplicitUseCaseRule('Can you figure out what drove the spike in returns on look 247?')
    ).toBe('data-investigator')
    expect(
      matchExplicitUseCaseRule('Dig into what caused customer churn to increase last month')
    ).toBe('data-investigator')

    expect(matchExplicitUseCaseRule('tell me what my personal space is')).toBe('tile')
    expect(
      extractResolvedUseCase('', 'tell me what my personal space is')
    ).toBe('tile')
    expect(
      matchExplicitUseCaseRule("can you find me all personal spaces that don't have dashboards")
    ).toBe('tile')
    expect(
      extractResolvedUseCase('', "can you find me all personal spaces that don't have dashboards")
    ).toBe('tile')

    expect(isConversationalNoOpPrompt('hello')).toBe(true)
    expect(isConversationalNoOpPrompt('what can you do?')).toBe(true)
    expect(matchExplicitUseCaseRule('hello')).toBeNull()
    expect(matchExplicitUseCaseRule('what can you do?')).toBeNull()

    // 3. Verify extractNativeContentFromInteraction ignores generic Looker folder/user dicts with "id": "5" while extracting valid NATIVE_CONTENT_BUNDLE payloads
    expect(
      extractNativeContentFromInteraction({
        id: 'int_folder_5',
        status: 'completed',
        steps: [
          {
            type: 'function_result',
            name: 'run_looker_codemode',
            call_id: 'call_folder_5',
            result: JSON.stringify({
              id: '5',
              name: 'My folder',
              is_personal: true,
            }),
          },
        ],
      })
    ).toBeNull()

    expect(
      extractNativeContentFromInteraction({
        id: 'int_valid_bundle',
        status: 'completed',
        steps: [
          {
            type: 'function_result',
            name: 'run_looker_codemode',
            call_id: 'call_valid_bundle',
            result: JSON.stringify({
              NATIVE_CONTENT_BUNDLE: {
                id: '101',
                content_type: 'dashboard',
                title: 'Executive KPI Dashboard',
                folder_id: '5',
              },
            }),
          },
        ],
      })
    ).toMatchObject({
      id: '101',
      contentType: 'dashboard',
      title: 'Executive KPI Dashboard',
      folderId: '5',
      embed_path: '/embed/dashboards/101',
    })

    // 4. Verify runAntigravityTurn preserves run_looker_codemode steps in activitySteps across requires_action continuations
    let postCallCount = 0
    const mockExtRequiresAction = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const method = init?.method || 'GET'
        if (method === 'POST') {
          postCallCount += 1
          if (postCallCount === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_109_step1',
                environment_id: 'env_109',
                status: 'requires_action',
                steps: [
                  {
                    id: 'call_cm_109',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({
                      code: 'return {"id": "5", "name": "My folder", "is_personal": True}',
                      thought: 'Inspecting personal folder via Looker SDK',
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
              id: 'int_109_step2',
              environment_id: 'env_109',
              status: 'completed',
              steps: [
                {
                  id: 'thought_109_2',
                  type: 'thought',
                  thought: 'Summarizing personal folder details',
                },
              ],
              output_text:
                '<USE_CASE>tile</USE_CASE>\nYour personal space is folder #5 ("My folder").',
            }),
          }
        }
        return { ok: true, status: 200, body: '{}' }
      },
    }

    const turnResult = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: mockExtRequiresAction,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-109' },
      session: {},
      useCase: 'auto',
      selectedExplores: [],
      schemaMarkdown: '# Schema',
      userPrompt: 'tell me what my personal space is',
      pollScheduleMs: [5],
      onStatus: () => {},
    })

    expect(turnResult.resolvedUseCase).toBe('tile')
    expect(turnResult.nativeBundle).toBeNull()
    expect(turnResult.bundle).toBeNull()
    expect(turnResult.activitySteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'call_cm_109',
          kind: 'codemode',
          title: 'Inspecting personal folder via Looker SDK',
          status: 'done',
        }),
        expect.objectContaining({
          id: 'thought_109_2',
          kind: 'thought',
          title: 'Summarizing personal folder details',
          status: 'done',
        }),
      ])
    )
  })

  test('46. Issue #110: refreshes OAuth at 59m or on tab activation (whichever comes last) with multi-tab deduplication and rejects id_token-only responses', async () => {
    expect(STUDIO_OAUTH_REFRESH_INTERVAL_MS).toBe(59 * 60 * 1000)

    const g = globalThis as unknown as {
      window?: Record<string, unknown>
      document?: Record<string, unknown>
      fetch?: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
    }
    const prev = { window: g.window, document: g.document, fetch: g.fetch }
    const winStorage = new Map<string, string>()
    const extStorage = new Map<string, string>()
    let visibilityState: 'visible' | 'hidden' = 'visible'

    g.window = {
      ...(prev.window || {}),
      addEventListener: () => {},
      removeEventListener: () => {},
      localStorage: {
        getItem: (k: string) => winStorage.get(k) ?? null,
        setItem: (k: string, v: string) => void winStorage.set(k, v),
        removeItem: (k: string) => void winStorage.delete(k),
      },
    }
    g.document = {
      get visibilityState() { return visibilityState },
      addEventListener: () => {},
      removeEventListener: () => {},
    }

    try {
      // 1. Reject id_token-only responses (generativelanguage API requires an OAuth access_token)
      await expect(
        loginWithGoogleOAuth({ oauth2Authenticate: async () => ({ id_token: 'mock_oidc_id_token_only' }) }, 'client-110')
      ).rejects.toThrow(/did not include an access_token/)

      // 2. Standard 3600s token sets expiresAt at 59 minutes (3540s)
      let authCalls = 0
      const storageSdk = {
        oauth2Authenticate: async () => ({ access_token: `oauth_fresh_tok_${++authCalls}`, expires_in: 3600 }),
        localStorageGetItem: async (k: string) => extStorage.get(k) ?? null,
        localStorageSetItem: async (k: string, v: string) => void extStorage.set(k, v),
        localStorageRemoveItem: async (k: string) => void extStorage.delete(k),
      }

      const t0 = Date.now()
      expect(await loginWithGoogleOAuth(storageSdk, 'client-110')).toBe('oauth_fresh_tok_1')
      expect(authCalls).toBe(1)
      const initialStored = await loadStoredOAuthSession(storageSdk, 'client-110')
      expect(initialStored?.expiresAt).toBeGreaterThanOrEqual(t0 + 59 * 60 * 1000 - 50)
      expect(initialStored?.expiresAt).toBeLessThanOrEqual(Date.now() + 59 * 60 * 1000 + 50)

      // 3. Cross-tab deduplication via STUDIO_OAUTH_STORAGE_KEY
      const adopted = await refreshOAuthSessionIfNeeded({ extensionSDK: storageSdk, clientId: 'client-110', tabId: 'tab-b' })
      expect(adopted).toMatchObject({ token: 'oauth_fresh_tok_1', refreshedByOtherTab: true, deferredUntilVisible: false })
      expect(authCalls).toBe(1)

      // 4. "Whichever comes last": if past 59m while hidden, defer refresh until tab becomes visible
      const expiredPayload = JSON.stringify({ token: 'oauth_expired_at_59m', expiresAt: Date.now() - 60_000, clientId: 'client-110' })
      extStorage.set(STUDIO_OAUTH_STORAGE_KEY, expiredPayload)
      winStorage.set(STUDIO_OAUTH_STORAGE_KEY, expiredPayload)

      visibilityState = 'hidden'
      expect(await refreshOAuthSessionIfNeeded({ extensionSDK: storageSdk, clientId: 'client-110', tabId: 'tab-a' })).toEqual({
        token: '', expiresAt: 0, refreshedByOtherTab: false, deferredUntilVisible: true,
      })
      expect(authCalls).toBe(1)

      visibilityState = 'visible'
      const onTabActive = await refreshOAuthSessionIfNeeded({ extensionSDK: storageSdk, clientId: 'client-110', tabId: 'tab-a' })
      expect(onTabActive).toMatchObject({ token: 'oauth_fresh_tok_2', refreshedByOtherTab: false, deferredUntilVisible: false })
      expect(authCalls).toBe(2)
      expect(winStorage.has(STUDIO_OAUTH_REFRESH_LOCK_KEY)).toBe(false)

      // 5. Cross-tab lock deduplication (STUDIO_OAUTH_REFRESH_LOCK_KEY)
      extStorage.delete(STUDIO_OAUTH_STORAGE_KEY)
      winStorage.delete(STUDIO_OAUTH_STORAGE_KEY)
      const [tab1Res, tab2Res] = await Promise.all([
        refreshOAuthSessionIfNeeded({ extensionSDK: storageSdk, clientId: 'client-110', tabId: 'tab-1' }),
        refreshOAuthSessionIfNeeded({ extensionSDK: storageSdk, clientId: 'client-110', tabId: 'tab-2' }),
      ])
      expect(authCalls).toBe(3)
      expect([tab1Res.token, tab2Res.token]).toEqual(['oauth_fresh_tok_3', 'oauth_fresh_tok_3'])
      expect([tab1Res.refreshedByOtherTab, tab2Res.refreshedByOtherTab].sort()).toEqual([false, true])

      // 6. callInteractionsApi 401 with onUnauthorizedRefresh retries once with refreshed token
      const seenAuthHeaders: string[] = []
      g.fetch = async (_url, init) => {
        seenAuthHeaders.push(init?.headers?.Authorization || '')
        return seenAuthHeaders.length === 1
          ? { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Token expired' } }) }
          : { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash' }] }) }
      }
      const retryPayload = await callInteractionsApi(
        storageSdk,
        { mode: 'oauth', oauthToken: 'oauth_stale_token', clientId: 'client-110', onUnauthorizedRefresh: async () => 'oauth_retried_fresh_token' },
        'models',
        'GET'
      )
      expect(seenAuthHeaders).toEqual(['Bearer oauth_stale_token', 'Bearer oauth_retried_fresh_token'])
      expect(retryPayload.models?.[0]?.name).toBe('models/gemini-3.8-flash')
    } finally {
      g.window = prev.window
      g.document = prev.document
      g.fetch = prev.fetch
    }
  })

  test('47. Issue #112: resolves Looker Dev Mode via sdk.session(), persists Save to Folder via STUDIO_FOLDER_STORAGE_KEY, and resolves non-numeric parent_id / creator_id in searchLookerFolders', async () => {
    expect(SWR_DEDUPED_METHODS).toContain('session')
    expect(STUDIO_FOLDER_STORAGE_KEY).toBe('dab_selected_folder_id')

    clearLookerMetadataCache()
    const devSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({ id: '1', display_name: 'Bryan Weber', personal_folder_id: '5' }),
      all_lookml_models: async () => [],
      session: async () => ({ workspace_id: 'dev' }),
    })
    expect((await fetchInitialLookerMetadata(devSdk)).workspaceId).toBe('dev')

    clearLookerMetadataCache()
    const prodFallbackSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({ id: '1', display_name: 'Bryan Weber', personal_folder_id: '5' }),
      all_lookml_models: async () => [],
      session: async () => { throw new Error('session endpoint unavailable') },
    })
    expect((await fetchInitialLookerMetadata(prodFallbackSdk)).workspaceId).toBe('production')

    const g = globalThis as unknown as { window?: Record<string, unknown> }
    const prevWin = g.window
    const winStore = new Map<string, string>()
    const extStore = new Map<string, string>()
    g.window = {
      ...(prevWin || {}),
      localStorage: {
        getItem: (k: string) => winStore.get(k) ?? null,
        setItem: (k: string, v: string) => void winStore.set(k, v),
        removeItem: (k: string) => void winStore.delete(k),
      },
    }
    try {
      const extSdk = {
        localStorageGetItem: async (k: string) => extStore.get(k) ?? null,
        localStorageSetItem: async (k: string, v: string) => void extStore.set(k, v),
      }
      expect(readInitialSelectedFolderId()).toBeNull()
      persistSelectedFolderId(extSdk, '502')
      expect([winStore.get(STUDIO_FOLDER_STORAGE_KEY), extStore.get(STUDIO_FOLDER_STORAGE_KEY), readInitialSelectedFolderId(), await loadStoredSelectedFolderId(extSdk)]).toEqual(['502', '502', '502', '502'])
    } finally {
      g.window = prevWin
    }

    clearLookerMetadataCache()
    const seenSearchPayloads: Array<Record<string, unknown>> = []
    const folderSearchSdk = asSdk({
      ok: async <T>(p: T) => p,
      me: async () => ({ id: '1', display_name: 'Bryan Weber', email: 'bryanweber@google.com' }),
      all_folders: async () => [
        { id: '1', name: 'Shared folders', parent_id: null, is_personal: false },
        { id: '501', name: 'Marketing Analytics', parent_id: '1', is_personal: false, creator_id: '1' },
        { id: '502', name: 'subfolder test', parent_id: '501', is_personal: false, creator_id: '1' },
      ],
      search_folders: async (req: Record<string, unknown>) => {
        seenSearchPayloads.push(req)
        return String(req.parent_id) === '501' && String(req.creator_id) === '1'
          ? [{ id: '502', name: 'subfolder test', parent_id: '501', is_personal: false, creator_id: '1' }]
          : []
      },
    })
    const byNameResults = await searchLookerFolders(folderSearchSdk, { parent_id: 'Marketing Analytics', creator_id: 'Bryan Weber' })
    expect(seenSearchPayloads).toEqual([expect.objectContaining({ parent_id: '501', creator_id: '1' })])
    expect(byNameResults).toEqual([expect.objectContaining({ id: '502', name: 'subfolder test', parent_id: '501', creator_id: '1' })])

    const repoRoot = path.resolve(__dirname, '../..')
    const skillMd = readFileSync(path.join(repoRoot, '.agents/skills/studio-design-system/SKILL.md'), 'utf8')
    expect(skillMd).toContain('Zero Layout Shift (CLS) on Dynamic Select / Grid Controls')
    expect(skillMd).toContain('minmax(0, 1fr) minmax(0, 1fr)')
    expect(readFileSync(path.join(repoRoot, 'src/styles/index.css'), 'utf8')).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
  })

  test('48. Issue #117: relaxes client-side use-case routing, prevents follow-up/meta prompts from hijacking into isolated CA sub-agent, and gates warmTurnDirective on existingAppCode', async () => {
    const metaPrompt = 'can you summarize the eroors you experienced here and how i could make you better?'
    for (const p of [metaPrompt, 'what errors did you experience?', 'what went wrong?', 'why did that fail?', 'how can I make you better?', 'summarize what you did', 'thank you', 'thanks!']) {
      expect(isConversationalNoOpPrompt(p)).toBe(true)
    }
    for (const q of [metaPrompt, 'Can you change the chart color to blue?', 'What is the current filter value?']) {
      expect(matchExplicitUseCaseRule(q)).toBeNull()
    }
    expect(classifyStudioUseCase('Why did gross margin drop in Q3 compared to Q2?', 'auto', ['app', 'dashboard', 'lookml', 'health-check', 'tile', 'conversational-analytics'])).toBe('conversational-analytics')
    expect(shouldRouteToIsolatedCaSubagent({ prompt: metaPrompt, explicitUseCase: 'auto', isFirstTurn: false })).toBe(false)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: metaPrompt, explicitUseCase: 'auto', isFirstTurn: true })).toBe(false)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: 'Why did gross margin drop in Q3 compared to Q2?', explicitUseCase: 'auto', isFirstTurn: false })).toBe(false)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: 'Why did gross margin drop in Q3 compared to Q2?', explicitUseCase: 'auto', isFirstTurn: true })).toBe(false)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: 'Ask the Conversational Analytics CA agent about Q3 margin', explicitUseCase: 'auto', isFirstTurn: true })).toBe(true)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: 'Any question', explicitUseCase: 'conversational-analytics', isFirstTurn: false })).toBe(true)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: 'Why did gross margin drop in Q3?', explicitUseCase: 'auto', assistantOutput: '<USE_CASE>conversational-analytics</USE_CASE>\nGross margin dropped 4.2% in Q3.' })).toBe(false)
    expect(shouldRouteToIsolatedCaSubagent({ prompt: 'Why did gross margin drop in Q3?', explicitUseCase: 'auto', assistantOutput: '<USE_CASE>conversational-analytics</USE_CASE>' })).toBe(true)

    const warmInputs: string[] = []
    const warmExt = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const txt = (init?.body ? (JSON.parse(init.body) as MockInteractionPostBody) : undefined)?.input?.[0]?.text
        if (txt) warmInputs.push(txt)
        return { ok: true, status: 200, body: JSON.stringify({ id: `int_warm_${warmInputs.length}`, environment_id: 'env_warm_117', status: 'completed', output_text: 'Answered directly in chat.' }) }
      },
    }
    const baseTurnParams = {
      sdk: asSdk({ ok: async <T>(p: T) => p }), extensionSDK: warmExt, userId: '1',
      auth: { mode: 'apikey' as const, apiKey: 'key-117' },
      session: { environmentId: 'env_warm_117', lastInteractionId: 'int_prev_117', toolType: 'app' as const },
      useCase: 'auto' as const, selectedExplores: [], schemaMarkdown: '# Schema', pollScheduleMs: [5], onStatus: () => {},
    }
    await runAntigravityTurn({ ...baseTurnParams, userPrompt: 'Add a revenue KPI card' })
    expect(warmInputs[0]).not.toContain('[WARM SANDBOX FAST PATH:')
    await runAntigravityTurn({ ...baseTurnParams, userPrompt: metaPrompt, existingAppCode: 'export class App {}' })
    expect(warmInputs[1]).not.toContain('[WARM SANDBOX FAST PATH:')
    await runAntigravityTurn({ ...baseTurnParams, userPrompt: 'Add a revenue KPI card', existingAppCode: 'export class App {}' })
    expect(warmInputs[2]).toContain('[WARM SANDBOX FAST PATH:')
  })

  test('49. Issue #120: enforces <projectid>::<extensionid> artifact namespace, excludes @-mentioned content from conversation deletion, and populates clickable Looker content links', async () => {
    const DEFAULT_NS = 'data_app_builder::data_app_builder'
    expect(ARTIFACT_NAMESPACE).toBe(DEFAULT_NS)
    for (const raw of [undefined, '', 'data_app_builder', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'db::a1b2c3d4-e5f6-7890-abcd-ef1234567890', DEFAULT_NS]) {
      expect(normalizeArtifactNamespace(raw)).toBe(DEFAULT_NS)
      expect(getArtifactNamespace(raw ? { lookerHostData: { extensionId: raw } } : undefined)).toBe(DEFAULT_NS)
    }
    expect(normalizeArtifactNamespace('custom_proj::custom_ext')).toBe('custom_proj::custom_ext')
    expect(normalizeArtifactNamespace('custom_ext', 'custom_proj')).toBe('custom_proj::custom_ext')
    expect(getArtifactNamespace({ lookerHostData: { extensionId: 'custom_proj::custom_ext' } })).toBe('custom_proj::custom_ext')

    clearArtifactServiceCache()
    const deletedDashboards: string[] = []
    const deletedLooks: string[] = []
    const seenNamespaces: string[] = []
    const store = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ namespace, key }: { namespace: string; key: string }) => {
        seenNamespaces.push(namespace)
        return key.split(',').filter((k) => store.has(k)).map((k) => ({ key: k, value: store.get(k)!, version: 1 }))
      },
      search_artifacts: async ({ namespace }: { namespace: string }) => (seenNamespaces.push(namespace), []),
      update_artifacts: async (ns: string, updates: Array<{ key: string; value: string }>) => {
        seenNamespaces.push(ns)
        for (const u of updates) store.set(u.key, u.value)
        return updates.map((u) => ({ key: u.key, version: 1 }))
      },
      delete_artifact: async (ns: string, key: string) => {
        seenNamespaces.push(ns)
        for (const k of key.split(',')) store.delete(k.trim())
        return ''
      },
      delete_dashboard: async (id: string) => (deletedDashboards.push(String(id)), ''),
      delete_look: async (id: string) => (deletedLooks.push(String(id)), ''),
    })

    expect(new ArtifactService(mockSdk, 'data_app_builder').namespace).toBe(DEFAULT_NS)
    expect(getArtifactService(mockSdk, 'data_app_builder').namespace).toBe(DEFAULT_NS)

    let tabItems = upsertStudioContentItem([], { id: '42', dashboardId: '42', contentType: 'data_app', title: 'Created App #42', source: 'created', createdInConversation: true }).items
    tabItems = upsertStudioContentItem(tabItems, { id: '42', dashboardId: '42', contentType: 'data_app', title: 'Created App #42', source: 'mention', createdInConversation: false }).items
    expect(tabItems[0]).toMatchObject({ source: 'created', createdInConversation: true })

    const convWithMentionsAndCreated = {
      id: 'conv_app_42', type: 'app', label: 'Executive Revenue App',
      content: { dashboardId: '42', appArtifactId: 'obj_app_42' },
      messages: [
        { role: 'user' as const, text: 'Build a revenue app referencing @dashboard:22 and @look:15 [Referenced Looker Dashboard #22]' },
        { role: 'assistant' as const, text: 'Created Executive Revenue App (#42) and Saved Look #19.' },
      ],
      contentItems: [
        normalizeStudioContentItem({ id: '22', dashboardId: '22', contentType: 'dashboard', title: 'Tagged Dashboard #22', source: 'mention', createdInConversation: false }),
        normalizeStudioContentItem({ id: '15', lookId: '15', contentType: 'look', title: 'Tagged Look #15' }),
        normalizeStudioContentItem({ id: '42', dashboardId: '42', contentType: 'data_app', title: 'Executive Revenue App', source: 'created', createdInConversation: true }),
        normalizeStudioContentItem({ id: '19', lookId: '19', contentType: 'look', title: 'Created Look #19', source: 'created', createdInConversation: true }),
      ],
      updatedAt: '2026-11-03T05:00:00Z',
    }

    const related = resolveConversationRelatedContent(convWithMentionsAndCreated, '1')
    expect(related.dashboardIds).toEqual(['42'])
    expect(related.lookIds).toEqual(['19'])
    expect(related.sharedObjectKeys).not.toEqual(expect.arrayContaining(['obj_dashboard_22', 'obj_dashboard_15']))
    expect(related.items.join(' ')).not.toMatch(/#22|#15/)
    expect(related.relatedLinks).toEqual([
      { label: 'Dashboard #42', path: '/dashboards/42', itemText: 'Looker Dashboard #42 (sdk.delete_dashboard)' },
      { label: 'Look #19', path: '/looks/19', itemText: 'Saved Look #19 (sdk.delete_look)' },
    ])

    await saveUserConversation(mockSdk, '1', convWithMentionsAndCreated)
    expect(seenNamespaces.every((ns) => ns === DEFAULT_NS)).toBe(true)

    await deleteUserConversation(mockSdk, '1', 'conv_app_42', { deleteRelatedContent: true })
    expect(deletedDashboards).toEqual(['42'])
    expect(deletedLooks).toEqual(['19'])

    const caRelated = resolveConversationRelatedContent({
      id: 'conv_ca_77', type: 'conversational-analytics', label: 'Q3 Margin CA Session',
      content: { caConversationId: 'ca_77' },
      contentItems: [
        normalizeStudioContentItem({ id: '22', dashboardId: '22', contentType: 'dashboard', title: 'Stale Dashboard #22' }),
        normalizeStudioContentItem({ id: 'ca_77', contentType: 'conversational-analytics', title: 'Q3 Margin CA Session', source: 'created', createdInConversation: true }),
      ],
      updatedAt: '2026-11-03T05:05:00Z',
    }, '1')
    expect(caRelated.dashboardIds).toEqual([])
    expect(caRelated.items).toEqual(['CA conversation artifact (obj_ca_ca_77)'])
    expect(caRelated.relatedLinks).toEqual([
      { label: 'CA Conversation ca_77', path: '/embed/conversations/ca_77', itemText: 'CA conversation artifact (obj_ca_ca_77)' },
    ])
  })

  test('50. Issue #119: persists leftPaneWidth & rightPaneCollapsed, formats friendly Looker activity labels without internal Monty/lkr-dev-cli jargon, resolves file/skill paths & contents, and exports Markdown reasoning traces', async () => {
    expect([STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY, STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY, DEFAULT_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH, MAX_LEFT_PANE_WIDTH]).toEqual(['dab_left_pane_width', 'dab_right_pane_collapsed', 380, 280, 780])
    expect([clampLeftPaneWidth(120), clampLeftPaneWidth(460), clampLeftPaneWidth(960), clampLeftPaneWidth(Number.NaN)]).toEqual([280, 460, 780, 380])

    const extStore = new Map<string, string>()
    const mockExtStorage = {
      localStorageGetItem: async (k: string) => extStore.get(k) ?? null,
      localStorageSetItem: async (k: string, v: string) => void extStore.set(k, v),
    }
    expect(await loadStoredLeftPaneWidth(mockExtStorage)).toBe(380)
    await saveStoredLeftPaneWidth(512, mockExtStorage)
    expect([extStore.get(STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY), await loadStoredLeftPaneWidth(mockExtStorage)]).toEqual(['512', 512])
    expect(await loadStoredRightPaneCollapsed(mockExtStorage)).toBe(false)
    await saveStoredRightPaneCollapsed(true, mockExtStorage)
    expect([extStore.get(STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY), await loadStoredRightPaneCollapsed(mockExtStorage)]).toEqual(['true', true])
    await saveStoredRightPaneCollapsed(false, mockExtStorage)
    expect(await loadStoredRightPaneCollapsed(mockExtStorage)).toBe(false)

    const queryLabel = formatFriendlyLookerActivityLabel(`sdk.run_inline_query({"model": "agentic_thelook", "view": "order_items", "fields": ["order_items.total_sale_price"]})`)
    expect(queryLabel).toEqual({ statusText: 'Executing Looker queries for Order Items...', stepTitle: 'Executing Looker queries for Order Items...', targetLabel: 'Order Items', isQuery: true })
    const apiLabel = formatFriendlyLookerActivityLabel(`sdk.lookml_model_explore("thelook", "users")`)
    expect(apiLabel).toEqual({ statusText: 'Executing Looker API calls for Users...', stepTitle: 'Executing Looker API calls for Users...', targetLabel: 'Users', isQuery: false })
    const genericQueryLabel = formatFriendlyLookerActivityLabel(`sdk.run_sql_query("slug_123", "json")`)
    expect(genericQueryLabel).toMatchObject({ statusText: 'Executing Looker queries...', isQuery: true })
    const genericApiLabel = formatFriendlyLookerActivityLabel(`sdk.all_lookml_models()`)
    expect(genericApiLabel).toMatchObject({ statusText: 'Executing Looker API calls...', isQuery: false })
    for (const lbl of [queryLabel.statusText, apiLabel.statusText, genericQueryLabel.statusText, genericApiLabel.statusText]) {
      expect(lbl).not.toMatch(/LkrCodeMode|Monty|WASM|bridged lkr-dev-cli/i)
    }

    const extracted = extractInteractionActivitySteps({
      steps: [
        { id: 'step_view_1', type: 'view_file', input: JSON.stringify({ TargetFile: '/workspace/DATA_INVESTIGATOR_GUIDE.md' }) },
        { id: 'step_view_1_res', type: 'view_file_result', call_id: 'step_view_1', output: '# Data Investigator Guide\nFollow sequential chapters.' },
        { id: 'step_skill_1', type: 'lookup_skill', arguments: { skill_name: 'skills/key-driver-analysis/SKILL.md' } },
        { id: 'step_bash_cat', type: 'code_execution', arguments: { command: 'cat /workspace/lookml/views/order_items.view.lkml' } },
        { id: 'step_bash_cat_res', type: 'tool_result', call_id: 'step_bash_cat', output: 'view: order_items {\n  dimension: id { primary_key: yes }\n}' },
        { id: 'step_codemode_1', type: 'function_call', name: 'run_looker_codemode', arguments: { code: 'sdk.run_inline_query({"model": "thelook", "view": "order_items"})' } },
      ],
    }, true)
    expect(extracted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'step_view_1', kind: 'skill', title: 'Reading skill data-investigator', path: '/workspace/DATA_INVESTIGATOR_GUIDE.md', content: '# Data Investigator Guide\nFollow sequential chapters.' }),
      expect.objectContaining({ id: 'step_skill_1', kind: 'skill', title: 'Reading skill key-driver-analysis', path: 'skills/key-driver-analysis/SKILL.md' }),
      expect.objectContaining({ id: 'step_bash_cat', kind: 'file', title: 'Viewing order_items.view.lkml', path: '/workspace/lookml/views/order_items.view.lkml', content: 'view: order_items {\n  dimension: id { primary_key: yes }\n}' }),
      expect.objectContaining({ id: 'step_codemode_1', kind: 'codemode', title: 'Executing Looker queries for Order Items...' }),
    ]))
    expect(resolveBuiltinWorkspaceFileContent('key-driver-analysis')).toContain('Key Driver Analysis')
    expect(resolveBuiltinWorkspaceFileContent('/workspace/DATA_INVESTIGATOR_GUIDE.md')).toContain('Data Investigator')

    const traceMd = formatThinkingTraceMarkdown(extracted, { thinkingDurationSec: 5, userPrompt: 'Investigate order items revenue' })
    expect(traceMd).toContain('## Thinking & Activity Trace (5s · 4 steps)')
    expect(traceMd).toContain('**User Prompt:** Investigate order items revenue')
    expect(traceMd).toContain('[Skill] Reading skill data-investigator')
    expect(traceMd).toContain('[Skill] Reading skill key-driver-analysis')
    expect(traceMd).toContain('[Code Mode] Executing Looker queries for Order Items...')
  })

  test('51. Issue #124: persists busySendAction (queue vs interject) in localStorage & extensionSDK and documents Skilled Use Cases in README.md', async () => {
    expect([STUDIO_BUSY_SEND_ACTION_STORAGE_KEY, DEFAULT_BUSY_SEND_ACTION]).toEqual(['dab_busy_send_action', 'queue'])
    expect([normalizeBusySendAction(), normalizeBusySendAction(null), normalizeBusySendAction('queue'), normalizeBusySendAction('INTERJECT'), normalizeBusySendAction('unknown')]).toEqual(['queue', 'queue', 'queue', 'interject', 'queue'])

    const extStore = new Map<string, string>()
    const mockExtStorage = {
      localStorageGetItem: async (k: string) => extStore.get(k) ?? null,
      localStorageSetItem: async (k: string, v: string) => void extStore.set(k, v),
    }
    expect(await loadStoredBusySendAction(mockExtStorage)).toBe('queue')
    await saveStoredBusySendAction('interject', mockExtStorage)
    expect([extStore.get(STUDIO_BUSY_SEND_ACTION_STORAGE_KEY), await loadStoredBusySendAction(mockExtStorage)]).toEqual(['interject', 'interject'])
    await saveStoredBusySendAction('queue', mockExtStorage)
    expect([extStore.get(STUDIO_BUSY_SEND_ACTION_STORAGE_KEY), await loadStoredBusySendAction(mockExtStorage)]).toEqual(['queue', 'queue'])

    const readme = readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8')
    expect(readme).toContain('## Skilled Use Cases')
    for (const label of ['**Data Apps**:', '**Data Investigator**:', '**Content Studio**:', '**Conversational Analytics**:', '**Agentic LookML**:', '**3-Pillar Health Check**:', '**Script / Python Tile**:']) {
      expect(readme).toContain(label)
    }
  })

  test('52. Issue #127: enforces raw_api_request: yes with zero core_api_methods in manifest.lkml & .githooks/pre-commit, routes core40SDK and LkrCodeMode calls through transport.rawRequest, and registers skills/looker-project-onboarding/SKILL.md', async () => {
    clearLookerMetadataCache()
    const repoRoot = path.resolve(__dirname, '../..')
    for (const rel of ['manifest.lkml', 'looker/manifest.lkml']) {
      const m = readFileSync(path.join(repoRoot, rel), 'utf8')
      expect(m).toMatch(/\braw_api_request\s*:\s*yes\b/)
      expect(m).not.toMatch(/\bcore_api_methods\s*:/)
    }
    const preCommitHook = readFileSync(path.join(repoRoot, '.githooks/pre-commit'), 'utf8')
    expect(preCommitHook).toEqual(expect.stringContaining('raw_api_request'))
    expect(preCommitHook).toEqual(expect.stringContaining('core_api_methods'))

    const rawCalls: Array<{ method: string; path: string; queryParams?: unknown; body?: unknown }> = []
    let legacyRequestCalled = 0
    const proxiedSdk = createDeduplicatedLookerSdkProxy(asSdk({
      ok: async <T>(p: Promise<{ ok: boolean; value?: T; error?: Error }>) => {
        const res = await p
        if (res && typeof res === 'object' && 'ok' in res) { if (!res.ok) throw res.error; return res.value as T }
        return res as unknown as T
      },
      authSession: {
        transport: {
          request: async () => { legacyRequestCalled += 1; throw new Error('invokeCoreSdk must not be called') },
          rawRequest: async (method: string, reqPath: string, queryParams?: Record<string, unknown>, body?: unknown) => {
            rawCalls.push({ method, path: reqPath, queryParams, body })
            return reqPath === '/api/4.0/error'
              ? { ok: false, statusCode: 403, body: 'Forbidden' }
              : { ok: true, statusCode: 200, body: JSON.stringify({ id: '42', method, path: reqPath, queryParams, body }) }
          },
        },
      },
    }))
    const proxiedTransport = (proxiedSdk as unknown as {
      authSession: { transport: { request: (m: string, p: string, q?: Record<string, unknown>, b?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: Error }> } }
    }).authSession.transport

    expect(await proxiedTransport.request('POST', '/api/4.0/projects', { fields: 'name' }, { name: 'sales_analytics' })).toEqual({
      ok: true,
      value: { id: '42', method: 'POST', path: '/api/4.0/projects', queryParams: { fields: 'name' }, body: JSON.stringify({ name: 'sales_analytics' }) },
    })
    const errResp = await proxiedTransport.request('GET', '/api/4.0/error')
    expect([errResp.ok, errResp.error?.message.includes('403'), legacyRequestCalled, rawCalls.length]).toEqual([false, true, 0, 2])

    const proxiedFallback = createDeduplicatedLookerSdkProxy(asSdk({
      authSession: { transport: { request: async (_m: string, p: string) => ({ ok: true, value: { fallbackPath: p } }) } },
    }))
    expect(await (proxiedFallback as unknown as typeof proxiedSdk).authSession.transport.request('GET' as never, '/api/4.0/user')).toEqual({
      ok: true, value: { fallbackPath: '/api/4.0/user' },
    })

    let invokeCoreSdkCount = 0
    const cmOut = await LkrCodeMode.runPythonCode({
      code: 'return me()',
      sdk: proxiedSdk,
      extensionSDK: { invokeCoreSdk: async () => { invokeCoreSdkCount += 1; throw new Error('invokeCoreSdk prohibited') } },
    })
    expect([invokeCoreSdkCount, JSON.parse(cmOut)]).toEqual([0, expect.objectContaining({ id: '42', method: 'GET', path: '/user' })])

    const skillDisk = readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')
    expect(LOOKML_SKILLS_CATALOG.find((s) => s.id === 'looker-project-onboarding')).toMatchObject({ id: 'looker-project-onboarding', path: 'skills/looker-project-onboarding/SKILL.md' })
    expect(SANDBOX_WORKSPACE_SKILL_FILES['/workspace/skills/looker-project-onboarding/SKILL.md']).toBe(LOOKER_PROJECT_ONBOARDING_SKILL_MD)
    expect(resolveBuiltinWorkspaceFileContent('skills/looker-project-onboarding/SKILL.md')).toBe(LOOKER_PROJECT_ONBOARDING_SKILL_MD)
    expect(buildWorkspaceSources({ schemaMarkdown: '# Schema' }).find((s) => s.target === '/workspace/skills/looker-project-onboarding/SKILL.md')?.content).toBe(LOOKER_PROJECT_ONBOARDING_SKILL_MD)
    for (const doc of [APP_BUILDER_SYSTEM_PROMPT, readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8'), readFileSync(path.join(repoRoot, 'upstream/payload/AGENTS.md'), 'utf8')]) {
      expect(doc).toContain('skills/looker-project-onboarding/SKILL.md')
    }
    for (const token of ['Step 1:', 'Step 2:', 'Step 3:', 'Step 4:', '/admin/connections', "re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')", '/sql', '5 × 5', 'create_project', 'create_lookml_model', '1.0 * ${numerator_measure} / NULLIF(${denominator_measure}, 0)', 'grain_change_reagg']) {
      expect(skillDisk).toContain(token)
      expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain(token)
    }
    const wsSources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    for (const relPath of [
      'agentic-lookml/SKILL.md',
      'agentic-lookml/references/01-simple-single-table.md',
      'agentic-lookml-workflow/SKILL.md',
      'agentic-lookml-workflow/scripts/pre_gate.py',
      'looker-field-profiler/SKILL.md',
      'lookml-field-curation/SKILL.md',
      'lookml-field-curation/scripts/profile_string_fields.py',
      'generate-view-from-table/SKILL.md',
      'generate-view-from-table/scripts/generate_bronze_view.py',
      'lookml-tests/SKILL.md',
      'lookml-view/references/derived_table.md',
    ]) {
      const diskContent = readFileSync(path.join(repoRoot, '.agents/skills', relPath), 'utf8')
      expect(wsSources.find((s) => s.target === `/workspace/skills/${relPath}`)?.content).toBe(diskContent)
      expect(resolveBuiltinWorkspaceFileContent(`/workspace/skills/${relPath}`)).toBe(diskContent)
      expect(diskContent).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    }
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    expect(KDA_SKILL_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
  })

  test('53. Issue #126: persists per-user agentName in user_config:${userId} (default "Ripper"), routes/copies Markdown links via extensionSDK, and appends CA embed collapse query params', async () => {
    expect(DEFAULT_STUDIO_AGENT_NAME).toBe('Ripper')
    expect([normalizeStudioAgentName(), normalizeStudioAgentName(''), normalizeStudioAgentName('  '), normalizeStudioAgentName('  Maverick  ')]).toEqual(['Ripper', 'Ripper', 'Ripper', 'Maverick'])
    expect([userStudioConfigArtifactKey('42'), userStudioConfigArtifactKey(''), userStudioConfigArtifactKey('  7 ')]).toEqual(['user_config:42', 'user_config:1', 'user_config:7'])

    const store = new Map<string, { key: string; value: string; version: number }>()
    const mockSdk = asSdk({
      ok: async <T>(p: Promise<T> | T) => p,
      artifact: async ({ key }: { namespace: string; key: string }) => (store.has(key) ? [store.get(key)!] : []),
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string; version?: number }>) =>
        updates.map((u) => { const next = { key: u.key, value: u.value, version: (store.get(u.key)?.version || 0) + 1 }; store.set(u.key, next); return next }),
    })
    const svc = new ArtifactService(mockSdk, ARTIFACT_NAMESPACE)
    expect(await svc.getUserConfig('42')).toEqual({ userId: '42', agentName: 'Ripper', updatedAt: '' })

    const savedCfg = await svc.saveUserConfig('42', { agentName: '  Point Break  ' })
    expect([savedCfg.userId, savedCfg.agentName, Boolean(savedCfg.updatedAt)]).toEqual(['42', 'Point Break', true])
    expect(JSON.parse(store.get('user_config:42')!.value)).toMatchObject({ userId: '42', agentName: 'Point Break' })
    expect([(await svc.getUserConfig('42')).agentName, (await svc.saveUserConfig('42', { agentName: '   ' })).agentName]).toEqual(['Point Break', 'Ripper'])

    expect(ALLOWED_EXTERNAL_WINDOW_PATTERNS).toEqual(
      expect.arrayContaining(['https://*.looker.com/*', 'https://*.looker.app/*', 'https://*.google.com/*', 'https://cloud.google.com/*', 'https://docs.cloud.google.com/*', 'https://github.com/*'])
    )
    expect([
      isAllowedExternalWindowUrl('https://docs.cloud.google.com/looker/docs/r/sql/LookML-field'),
      isAllowedExternalWindowUrl('https://github.com/lkrdev/data-app-builder'),
      isAllowedExternalWindowUrl('https://unlisted-vendor.example.org/report'),
    ]).toEqual([true, true, false])

    const openedUrls: Array<{ url: string; target?: string }> = []
    const copiedUrls: string[] = []
    const mockExtSdk = {
      openBrowserWindow: (url: string, target?: string) => { openedUrls.push({ url, target }) },
      clipboardWrite: async (text: string) => { copiedUrls.push(text) },
    }
    expect(await openOrCopyMarkdownLink('/dashboards/42?region=AMER', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'opened', targetUrl: '/dashboards/42?region=AMER' })
    expect(await openOrCopyMarkdownLink('https://dev.looker.com/looks/99#table', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'opened', targetUrl: '/looks/99#table' })
    expect(await openOrCopyMarkdownLink('https://docs.cloud.google.com/looker/docs/r/sql/LookML-field', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'opened', targetUrl: 'https://docs.cloud.google.com/looker/docs/r/sql/LookML-field' })
    expect(await openOrCopyMarkdownLink('https://unlisted-vendor.example.org/report', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'copied', targetUrl: 'https://unlisted-vendor.example.org/report' })
    expect(openedUrls).toEqual([
      { url: '/dashboards/42?region=AMER', target: '_blank' },
      { url: '/looks/99#table', target: '_blank' },
      { url: 'https://docs.cloud.google.com/looker/docs/r/sql/LookML-field', target: '_blank' },
    ])
    expect(copiedUrls).toEqual(['https://unlisted-vendor.example.org/report'])
    expect([await copyLinkWithExtensionSdk('https://github.com/lkrdev/data-app-builder', mockExtSdk), copiedUrls[copiedUrls.length - 1]]).toEqual([true, 'https://github.com/lkrdev/data-app-builder'])

    expect(buildCaEmbedPath('ca_conv_1', 'agent_ecom')).toBe('/embed/conversations/ca_conv_1?agent_id=agent_ecom&hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')
    expect(normalizeCaEmbedPath('/conversations/ca_conv_2', 'agent_2')).toBe('/embed/conversations/ca_conv_2?agent_id=agent_2&hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')
    expect(resolveStudioContentEmbedPath('conversational-analytics', 'ca_conv_3')).toBe('/embed/conversations/ca_conv_3?hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')

    const manifestLkml = readFileSync(path.resolve(__dirname, '../../manifest.lkml'), 'utf8')
    for (const token of ['label: "Ripper"', 'use_clipboard: yes', 'new_window_external_urls:']) expect(manifestLkml).toContain(token)
  })

  test('54. Issue #130: fetches agent-created .md files on demand from /v1beta/environments/{envId}/files/{path}?alt=media via fetchEnvironmentFile (apikey proxy, oauth bearer + 401 refresh retry, and mock resolution) and detects bash/Python .md writes in extractInteractionActivitySteps with zero Looker artifact storage', async () => {
    expect(['/workspace/analysis.md', '///workspace/reports/q4_summary.md', 'file:///workspace/notes.md', '  report.md  '].map(normalizeSandboxFilePath)).toEqual([
      'workspace/analysis.md', 'workspace/reports/q4_summary.md', 'workspace/notes.md', 'report.md',
    ])
    expect(['/workspace/analysis.md', 'workspace/reports/q4_summary.md', 'notes.md', 'file:///workspace/report.md', 'https://docs.cloud.google.com/looker/docs/report.md', '/dashboards/42', 'order_items.total_sale_price'].map(isSandboxMarkdownPath)).toEqual([
      true, true, true, true, false, false, false,
    ])

    const proxyCalls: Array<{ url: string; init?: FetchCustomParameters }> = []
    const apiKeyMd = await fetchEnvironmentFile({
      extensionSDK: {
        serverProxy: async (url: string, init?: FetchCustomParameters) => {
          proxyCalls.push({ url, init })
          return { ok: true, status: 200, body: '# Q4 Margin Root-Cause Analysis\n\nOuterwear drove +18.4% YoY revenue.' }
        },
      },
      auth: { mode: 'apikey', apiKey: 'AIza_test_130' },
      environmentId: 'env_130_prod',
      path: '/workspace/reports/analysis.md',
    })
    expect(apiKeyMd).toContain('# Q4 Margin Root-Cause Analysis')
    expect(proxyCalls).toEqual([{
      url: 'https://generativelanguage.googleapis.com/v1beta/environments/env_130_prod/files/workspace/reports/analysis.md?alt=media',
      init: { method: 'GET', headers: { 'x-goog-api-key': 'AIza_test_130' } },
    }])

    const fetchCalls: Array<{ url: string; headers?: Record<string, string> }> = []
    const globalWithFetch = globalThis as unknown as {
      fetch?: (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
      window?: unknown
    }
    const prevFetch = globalWithFetch.fetch
    const prevWin = globalWithFetch.window
    let attempt = 0
    globalWithFetch.fetch = async (url, init) => {
      fetchCalls.push({ url, headers: init?.headers })
      return ++attempt === 1
        ? { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Token expired' } }) }
        : { ok: true, status: 200, text: async () => '# Refreshed OAuth Sandbox Report\n\nVerified after 401 silent refresh.' }
    }
    try {
      const oauthMd = await fetchEnvironmentFile({
        extensionSDK: {},
        auth: { mode: 'oauth', oauthToken: 'expired_oauth_tok', projectId: 'looker-demo-proj', onUnauthorizedRefresh: async () => 'refreshed_oauth_tok_130' },
        environmentId: 'user_env:42',
        path: '/workspace/summary.md',
      })
      expect(oauthMd).toContain('# Refreshed OAuth Sandbox Report')
      expect(fetchCalls).toEqual([
        { url: 'https://generativelanguage.googleapis.com/v1beta/environments/user_env%3A42/files/workspace/summary.md?alt=media', headers: { Authorization: 'Bearer expired_oauth_tok', 'x-goog-user-project': 'looker-demo-proj' } },
        { url: 'https://generativelanguage.googleapis.com/v1beta/environments/user_env%3A42/files/workspace/summary.md?alt=media', headers: { Authorization: 'Bearer refreshed_oauth_tok_130', 'x-goog-user-project': 'looker-demo-proj' } },
      ])

      globalWithFetch.window = { __MOCK_LOOKER_EXTENSION__: { environmentFiles: { '/workspace/analysis.md': '# Mock Sandbox Analysis\n\n- Gross Margin: 54.2%' } } }
      expect(await fetchEnvironmentFile({ extensionSDK: {}, auth: { mode: 'oauth', oauthToken: 'mock_tok' }, environmentId: 'env_mock_130', path: '/workspace/analysis.md' })).toBe('# Mock Sandbox Analysis\n\n- Gross Margin: 54.2%')
      expect(await fetchEnvironmentFile({ extensionSDK: {}, auth: { mode: 'oauth', oauthToken: 'mock_tok' }, environmentId: 'env_mock_130', path: '/workspace/unlisted_notes.md' })).toContain('# unlisted_notes.md')
    } finally {
      globalWithFetch.fetch = prevFetch
      globalWithFetch.window = prevWin
    }

    const codeSamples = [
      "cat > /workspace/analysis.md << 'EOF'\n# Root Cause Analysis\nEOF",
      'echo "# Notes" | tee -a /workspace/notes.md',
      "with open('/workspace/report.md', 'w') as f:\n    f.write('# Executive Report')",
      "from pathlib import Path\nPath('/workspace/summary.md').write_text('# Executive Summary')",
    ]
    expect(codeSamples.map(extractWrittenMarkdownPathFromCode)).toEqual(['/workspace/analysis.md', '/workspace/notes.md', '/workspace/report.md', '/workspace/summary.md'])
    const mdSteps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        { id: 'step_bash_redir', type: 'code_execution', language: 'BASH', code: codeSamples[0] },
        { id: 'step_bash_tee', type: 'code_execution', language: 'BASH', code: codeSamples[1] },
        { id: 'step_py_open', type: 'code_execution', language: 'PYTHON', code: codeSamples[2] },
        { id: 'step_py_path', type: 'code_execution', language: 'PYTHON', code: codeSamples[3] },
      ],
    })
    expect(mdSteps).toEqual([
      { id: 'step_bash_redir', kind: 'file', title: 'Editing analysis.md', detail: '/workspace/analysis.md', path: '/workspace/analysis.md', status: 'done' },
      { id: 'step_bash_tee', kind: 'file', title: 'Editing notes.md', detail: '/workspace/notes.md', path: '/workspace/notes.md', status: 'done' },
      { id: 'step_py_open', kind: 'file', title: 'Editing report.md', detail: '/workspace/report.md', path: '/workspace/report.md', status: 'done' },
      { id: 'step_py_path', kind: 'file', title: 'Editing summary.md', detail: '/workspace/summary.md', path: '/workspace/summary.md', status: 'done' },
    ])
  })

  test('55. Issue #131: direct model stateless side-requests (store:false, response_format), DEFAULT_MAX_TOTAL_TOKENS=131072, and OAuth SSE streaming with last_event_id resume + polling fallback', async () => {
    expect([DEFAULT_THINKING_LEVEL, DEFAULT_MAX_TOTAL_TOKENS, STUDIO_MAX_TOTAL_TOKENS_OPTIONS.map((o) => o.value)]).toEqual([
      'high', 131072, [32768, 65536, 131072, 262144],
    ])
    expect([normalizeMaxTotalTokens(undefined), normalizeMaxTotalTokens(0), normalizeMaxTotalTokens(65536), normalizeMaxTotalTokens('262144')]).toEqual([
      131072, 131072, 65536, 262144,
    ])
    expect([readInitialThinkingLevel(), readInitialThinkingLevel('low')]).toEqual(['high', 'low'])

    const rawStarterJson = JSON.stringify([
      { id: 's1', label: 'Revenue by Region Scorecard', prompt: 'Build a revenue scorecard by region.', useCase: 'app' },
      { id: 's2', label: 'Monthly Order Trend UDD', prompt: 'Create a native UDD for monthly orders.', useCase: 'dashboard' },
      { id: 's3', label: 'Top Brand Margin Breakdown', prompt: 'What drove brand margin changes?', useCase: 'data-investigator' },
    ])
    expect(parseStarterPromptsResponse(rawStarterJson, []).map((p) => p.id)).toEqual(['s1', 's2', 's3'])
    const rawCaJson = JSON.stringify({ agent_id: 'ca_agent_1', agent_name: 'Orders CA Agent', rationale: 'Direct JSON schema match for orders explore.' })
    expect(
      parseCaAgentSelectionResponse(
        rawCaJson, [{ id: 'ca_agent_1', name: 'Orders CA Agent', description: 'Orders', explores: ['thelook::orders'], goldenQueries: [] }], 'Orders last month?'
      )
    ).toMatchObject({ agentId: 'ca_agent_1', agentName: 'Orders CA Agent', rationale: 'Direct JSON schema match for orders explore.' })

    const capturedTurnBodies: MockInteractionPostBody[] = []
    const mockExtSdk = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        if (init?.body) capturedTurnBodies.push(JSON.parse(String(init.body)) as MockInteractionPostBody)
        return { ok: true, status: 200, body: JSON.stringify({ id: 'int_max_tok_1', environment_id: 'env_tok_1', status: 'completed', output_text: 'Done with 262k budget.' }) }
      },
    }
    await runAntigravityTurn({
      sdk: asSdk({}), extensionSDK: mockExtSdk, auth: { mode: 'apikey' }, session: { toolType: 'app' },
      model: 'gemini-3.8-flash', maxTotalTokens: 262144, selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema', userPrompt: 'Build app', onStatus: () => {},
    })
    expect(capturedTurnBodies[0]?.agent_config).toEqual({ type: 'antigravity', model: 'gemini-3.8-flash', max_total_tokens: '262144' })

    const snap = mergeInteractionSseEvent(
      mergeInteractionSseEvent({ id: 'int_sse_1', status: 'in_progress' }, 'step.delta', { step: { id: 'st_1', type: 'thought', thought: 'Inspecting explore schema...' } }),
      'content.delta', { delta: { text: 'Hello ' } }
    )
    const snap2 = mergeInteractionSseEvent(snap, 'content.delta', { delta: { text: 'world!' } })
    expect([snap2.output_text, (snap2.steps as Array<{ id?: string }>)[0]?.id]).toEqual(['Hello world!', 'st_1'])

    const fallbackApiKey = await streamInteractionUntilActionOrDone({ auth: { mode: 'apikey', apiKey: 'k' }, interactionId: 'int_sse_fallback' })
    expect(fallbackApiKey.streamed).toBe(false)

    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    try {
      let attempt = 0
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input))
        attempt += 1
        const encoder = new TextEncoder()
        const frames = attempt === 1
          ? ['id: evt_1\nevent: step.delta\ndata: {"step":{"id":"s1","type":"thought","thought":"Checking dimensions"}}\n\n']
          : [
              'id: evt_2\nevent: content.delta\ndata: {"delta":{"text":"Streamed KPI App Ready."}}\n\n',
              'id: evt_3\nevent: interaction.complete\ndata: {"interaction":{"id":"int_sse_live","status":"completed","environment_id":"env_sse_1"}}\n\n',
            ]
        let idx = 0
        return {
          ok: true, status: 200,
          headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
          body: {
            getReader: () => ({
              read: async () => (idx >= frames.length ? { done: true, value: undefined } : { done: false, value: encoder.encode(frames[idx++]) }),
              releaseLock: () => {},
            }),
          },
        } as unknown as Response
      }) as typeof fetch

      const updates: Array<Record<string, unknown>> = []
      const sseRes = await streamInteractionUntilActionOrDone({
        auth: { mode: 'oauth', oauthToken: 'mock-oauth-sse-token' }, interactionId: 'int_sse_live',
        onUpdate: (u) => { updates.push({ ...u }) },
      })
      expect([sseRes.streamed, sseRes.lastEventId, sseRes.interaction.status, sseRes.interaction.output_text]).toEqual([
        true, 'evt_3', 'completed', 'Streamed KPI App Ready.',
      ])
      expect(requestedUrls).toEqual([
        'https://generativelanguage.googleapis.com/v1beta/interactions/int_sse_live?stream=true&alt=sse',
        'https://generativelanguage.googleapis.com/v1beta/interactions/int_sse_live?stream=true&alt=sse&last_event_id=evt_1',
      ])
      expect(updates.length).toBeGreaterThanOrEqual(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('56. Issue #132: mounts use-case guides under /workspace/skills/data-apps/SKILL.md & /workspace/skills/data-investigator/SKILL.md, formats skill steps as "Reading skill <name>", and defaults mobile rightPaneCollapsed to true', async () => {
    const sources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/workspace/skills/data-apps/SKILL.md', content: DATA_APP_GUIDE_MD }),
        expect.objectContaining({ target: '/workspace/skills/data-investigator/SKILL.md', content: DATA_INVESTIGATOR_GUIDE_MD }),
        expect.objectContaining({ target: '/workspace/skills/key-driver-analysis/SKILL.md', content: KDA_SKILL_MD }),
        expect.objectContaining({ target: '/workspace/skills/looker-project-onboarding/SKILL.md', content: LOOKER_PROJECT_ONBOARDING_SKILL_MD }),
      ])
    )
    expect(AGENTS_MD).toContain('skills/data-apps/SKILL.md')
    expect(AGENTS_MD).toContain('skills/data-investigator/SKILL.md')

    for (const p of ['/workspace/skills/data-apps/SKILL.md', 'skills/data-apps/SKILL.md', 'skills/data-apps/skill.md', '/workspace/skills/data-apps/skill.md', '/workspace/DATA_APP_GUIDE.md']) {
      expect([extractSkillNameFromPath(p), resolveBuiltinWorkspaceFileContent(p)]).toEqual(['data-apps', DATA_APP_GUIDE_MD])
    }
    for (const p of ['/workspace/skills/data-investigator/SKILL.md', 'skills/data-investigator/SKILL.md', 'skills/data-investigator/skill.md', '/workspace/skills/data-investigator/skill.md', '/workspace/DATA_INVESTIGATOR_GUIDE.md']) {
      expect([extractSkillNameFromPath(p), resolveBuiltinWorkspaceFileContent(p)]).toEqual(['data-investigator', DATA_INVESTIGATOR_GUIDE_MD])
    }
    expect([extractSkillNameFromPath('/workspace/skills/key-driver-analysis/SKILL.md'), extractSkillNameFromPath('/workspace/apps/current/app.js')]).toEqual(['key-driver-analysis', null])

    const steps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        { id: 'st_view_da', type: 'view_file', input: JSON.stringify({ TargetFile: '/workspace/skills/data-apps/SKILL.md' }) },
        { id: 'st_lookup_di', type: 'lookup_skill', arguments: { skill_name: 'data-investigator' } },
        { id: 'st_bash_kda', type: 'code_execution', language: 'BASH', code: 'cat /workspace/skills/key-driver-analysis/SKILL.md' },
      ],
    })
    expect(steps).toEqual([
      expect.objectContaining({ id: 'st_view_da', kind: 'skill', title: 'Reading skill data-apps', path: '/workspace/skills/data-apps/SKILL.md' }),
      expect.objectContaining({ id: 'st_lookup_di', kind: 'skill', title: 'Reading skill data-investigator', path: '/workspace/skills/data-investigator/SKILL.md' }),
      expect.objectContaining({ id: 'st_bash_kda', kind: 'skill', title: 'Reading skill key-driver-analysis', path: '/workspace/skills/data-investigator/SKILL.md'.replace('data-investigator', 'key-driver-analysis') }),
    ])

    const g = globalThis as unknown as { window?: { innerWidth?: number } }
    const prevWin = g.window
    try {
      g.window = { innerWidth: 390 }
      expect([readInitialRightPaneCollapsed(), await loadStoredRightPaneCollapsed()]).toEqual([true, true])
      g.window = { innerWidth: 1440 }
      expect(readInitialRightPaneCollapsed()).toBe(false)
    } finally {
      g.window = prevWin
    }
  })

  test('57. Evals #1 & #2: formatContentInventoryMarkdown, extractInteractionOutputText, Monty WASM search_agents() & format_content_inventory(), and ad-hoc Looker API vs CA routing', async () => {
    // 1. All 5 content & folder inventory prompt variants route to tile (CodeMode) and never to isolated CA sub-agent
    const inventoryPrompts = [
      'tell me what my personal space is',
      "can you find me all personal spaces that don't have dashboards",
      'what are my favorite dashboards',
      'What dashboards are in my personal',
      'List all dashboards and Looks across all shared folders',
    ]
    for (const p of inventoryPrompts) {
      expect(isLookerInstanceMetadataQuery(p)).toBe(true)
      expect(extractResolvedUseCase('', p)).toBe('tile')
      expect(shouldRouteToIsolatedCaSubagent({ prompt: p, explicitUseCase: 'auto', isCaMode: false, isFirstTurn: true })).toBe(false)
      expect(EXPLICIT_SCRIPT_CREATION_RE.test(p)).toBe(false)
    }
    expect(EXPLICIT_SCRIPT_CREATION_RE.test('create a reusable python script tile for revenue')).toBe(true)

    // 2. formatContentInventoryMarkdown: short list (<= 5 items in 1 folder) vs long list (> 5 items across multiple folders)
    const shortInv = formatContentInventoryMarkdown([
      {
        id: '42',
        name: 'My Personal Folder',
        dashboards: [{ id: '101', title: 'Executive KPI Pulse' }, { id: '102', title: 'Retention Cohort' }],
        looks: [{ id: '201', title: 'Top 25 Brands' }],
      },
    ])
    expect([shortInv.truncated, shortInv.totalItems, shortInv.folderCount]).toEqual([false, 3, 1])
    expect(shortInv.summaryMarkdown).toContain('**[My Personal Folder](/folders/42)** (2 dashboards, 1 Look)')
    expect(shortInv.summaryMarkdown).toContain('- [Executive KPI Pulse](/dashboards/101)')
    expect(shortInv.summaryMarkdown).toContain('- [Top 25 Brands](/looks/201)')

    const longInv = formatContentInventoryMarkdown([
      {
        id: '42',
        name: 'My Personal Folder',
        dashboards: [
          { id: '101', title: 'Dash 1' },
          { id: '102', title: 'Dash 2' },
          { id: '103', title: 'Dash 3' },
          { id: '104', title: 'Dash 4' },
        ],
        looks: [{ id: '201', title: 'Look 1' }, { id: '202', title: 'Look 2' }],
      },
      {
        id: '88',
        name: 'Shared Finance',
        dashboards: [{ id: '105', title: 'Finance 1' }, { id: '106', title: 'Finance 2' }, { id: '107', title: 'Finance 3' }],
      },
    ])
    expect([longInv.truncated, longInv.totalItems, longInv.folderCount, longInv.overflowFilePath]).toEqual([
      true,
      9,
      2,
      '/workspace/content_inventory.md',
    ])
    expect(longInv.summaryMarkdown).toContain('**[My Personal Folder](/folders/42)** (4 dashboards, 2 Looks)')
    expect(longInv.summaryMarkdown).toContain('- See all 6 items in [My Personal Folder](/folders/42)')
    expect(longInv.summaryMarkdown).toContain('- See all 3 items in [Shared Finance](/folders/88)')
    expect(longInv.summaryMarkdown).not.toContain('(/dashboards/103)')
    expect(longInv.fullMarkdown).toContain('(/dashboards/103)')

    // 3. extractInteractionOutputText: extracts nested outputs[0].content[0].text & function_result fallback instead of 'Completed.'
    expect(
      extractInteractionOutputText({
        status: 'completed',
        outputs: [{ type: 'message', content: [{ type: 'output_text', text: 'Nested content markdown link: [Dash 1](/dashboards/101)' }] } as never],
      })
    ).toBe('Nested content markdown link: [Dash 1](/dashboards/101)')
    expect(
      extractInteractionOutputText({
        status: 'completed',
        steps: [{ type: 'function_result', name: 'run_looker_codemode', result: JSON.stringify({ result: { summary_markdown: '**[Folder 42](/folders/42)**' } }) }],
      })
    ).toBe('**[Folder 42](/folders/42)**')

    // 4. Monty WASM search_agents(), sdk.search_agents(), and format_content_inventory()
    const mockSdk = {
      search_agents: async () => [
        {
          id: 'ca_agent_rev',
          name: 'Revenue & Margin Agent',
          description: 'Covers gross margin, order revenue, and return rates.',
          explores: ['thelook::order_items'],
          golden_queries: [{ questions: ['What is our gross margin by category?'] }],
        },
      ],
      ok: async <T>(p: Promise<T> | T) => p,
      authSession: {
        transport: {
          rawRequest: async () => ({ statusCode: 200, ok: true, body: [] }),
        },
      },
    } as unknown as Looker40SDK

    const cmOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: `agents = sdk.search_agents()
inv = format_content_inventory([{"id": "42", "name": "My Folder", "dashboards": [{"id": "10", "title": "Revenue Pulse"}]}])
return {"agent_id": agents[0]["id"], "gq": agents[0]["golden_queries"][0]["questions"][0], "md": inv["summary_markdown"]}`,
        sdk: mockSdk,
      })
    )
    const cmRes = cmOut.result || cmOut
    expect([cmRes.agent_id, cmRes.gq]).toEqual(['ca_agent_rev', 'What is our gross margin by category?'])
    expect(cmRes.md).toContain('[Revenue Pulse](/dashboards/10)')

    // 5. Activity label & CA preselectedOutput fast-path
    expect(formatFriendlyLookerActivityLabel('agents = search_agents()').statusText).toBe(
      'Searching accessible Looker Conversational Analytics agents and golden queries...'
    )
    const preselectedOut =
      '<USE_CASE>conversational-analytics</USE_CASE>\n<CA_AGENT_SELECTION>{"agent_id":"ca_agent_rev","rationale":"Matches gross margin golden query."}</CA_AGENT_SELECTION>'
    expect(
      shouldRouteToIsolatedCaSubagent({
        prompt: 'What is our gross margin by category?',
        explicitUseCase: 'auto',
        isCaMode: false,
        isFirstTurn: true,
        assistantOutput: preselectedOut,
      })
    ).toBe(true)
    const fastSelected = await selectCaAgentViaIsolatedSubagent({
      sdk: mockSdk,
      auth: { mode: 'oauth', oauthToken: '' },
      userQuestion: 'What is our gross margin by category?',
      preselectedOutput: preselectedOut,
    })
    expect([fastSelected.agentId, fastSelected.rationale]).toEqual(['ca_agent_rev', 'Matches gross margin golden query.'])
  })

  test('58. Issue #145: collates unified looker-dashboard skill, promotes looker-field-profiler (profile_fields), mounts both in sandbox & Viewer, and integrates profile_fields across Studio use cases & skills', () => {
    const repoRoot = path.resolve(__dirname, '../..')
    const dashSkillDisk = readFileSync(path.join(repoRoot, 'skills/looker-dashboard/SKILL.md'), 'utf8')
    const dashSkillAgentsDisk = readFileSync(path.join(repoRoot, '.agents/skills/looker-dashboard/SKILL.md'), 'utf8')
    const profSkillDisk = readFileSync(path.join(repoRoot, 'skills/looker-field-profiler/SKILL.md'), 'utf8')
    const profSkillAgentsDisk = readFileSync(path.join(repoRoot, '.agents/skills/looker-field-profiler/SKILL.md'), 'utf8')

    expect(LOOKER_DASHBOARD_SKILL_MD).toBe(dashSkillDisk)
    expect(LOOKER_DASHBOARD_SKILL_MD).toBe(dashSkillAgentsDisk)
    expect(LOOKER_FIELD_PROFILER_SKILL_MD).toBe(profSkillDisk)
    expect(LOOKER_FIELD_PROFILER_SKILL_MD).toBe(profSkillAgentsDisk)

    for (const token of ['profile_fields', 'upsert_udd', 'tabs:', 'business_pulse', 'y_axes', 'advanced_vis_config', 'lookml-dashboard-to-query']) {
      expect(LOOKER_DASHBOARD_SKILL_MD).toContain(token)
    }

    const sources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/workspace/skills/looker-dashboard/SKILL.md', content: LOOKER_DASHBOARD_SKILL_MD }),
        expect.objectContaining({ target: '/workspace/skills/looker-field-profiler/SKILL.md', content: LOOKER_FIELD_PROFILER_SKILL_MD }),
      ])
    )

    for (const k of ['looker-dashboard', 'creating-looker-dashboard', 'skills/looker-dashboard/SKILL.md', '/workspace/skills/looker-dashboard/SKILL.md']) {
      expect(BUILTIN_SKILLS_FILES[k]).toBe(LOOKER_DASHBOARD_SKILL_MD)
      expect(resolveBuiltinWorkspaceFileContent(k)).toBe(LOOKER_DASHBOARD_SKILL_MD)
    }
    for (const k of ['looker-field-profiler', 'skills/looker-field-profiler/SKILL.md', '/workspace/skills/looker-field-profiler/SKILL.md']) {
      expect(BUILTIN_SKILLS_FILES[k]).toBe(LOOKER_FIELD_PROFILER_SKILL_MD)
      expect(resolveBuiltinWorkspaceFileContent(k)).toBe(LOOKER_FIELD_PROFILER_SKILL_MD)
    }

    expect(LOOKML_SKILLS_CATALOG.find((s) => s.id === 'looker-field-profiler')).toEqual({
      id: 'looker-field-profiler',
      label: 'Field Value Profiler',
      desc: 'Profile field distributions, spikiness, LookML curation snippets & _field_value_search_<model> search index PDTs',
      path: 'skills/looker-field-profiler/SKILL.md',
    })

    for (const relPath of [
      'looker-field-profiler/sub-skills/scratch-search/SKILL.md',
      'looker-field-profiler/scripts/scratch_search.py',
      'looker-field-profiler/scripts/dialects/bigquery.py',
      'looker-field-profiler/scripts/dialects/snowflake.py',
      'looker-field-profiler/scripts/dialects/postgres.py',
      'looker-field-profiler/scripts/dialects/databricks.py',
      'looker-field-profiler/scripts/dialects/duckdb.py',
    ]) {
      const diskContent = readFileSync(path.join(repoRoot, '.agents/skills', relPath), 'utf8')
      expect(SANDBOX_AGENT_SKILL_FILES[relPath]).toBe(diskContent)
      expect(resolveBuiltinWorkspaceFileContent(`/workspace/skills/${relPath}`)).toBe(diskContent)
    }
    const scratchSkillMd = readFileSync(path.join(repoRoot, 'skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md'), 'utf8')
    expect(SANDBOX_AGENT_SKILL_FILES['looker-field-profiler/sub-skills/scratch-search/SKILL.md']).toBe(scratchSkillMd)
    expect(BUILTIN_SKILLS_FILES['scratch-search']).toBe(scratchSkillMd)
    expect(BUILTIN_SKILLS_FILES['looker-field-profiler-scratch-search']).toBe(scratchSkillMd)
    expect(extractSkillNameFromPath('/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md')).toBe('scratch-search')
    expect(extractSkillNameFromPath('.agents/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md')).toBe('scratch-search')

    const scratchLabel = formatFriendlyLookerActivityLabel('return run_inline_query("json", {"model": "ecom", "view": "_field_value_search_ecom", "filters": {"_field_value_search_ecom.field_value": "%Acme%"}})')
    expect(scratchLabel).toMatchObject({
      title: 'Searching model field value index',
      stepTitle: 'Searching model field value index',
      statusText: 'Searching model _field_value_search index for matching entity values...',
      isQuery: true,
    })

    const profLabel = formatFriendlyLookerActivityLabel('return profile_fields(model="thelook", view="order_items", fields=["order_items.status"])')
    expect(profLabel).toMatchObject({
      title: 'Profiling Explore field distributions',
      stepTitle: 'Profiling Explore field distributions',
      statusText: 'Profiling Explore field distributions, cardinality, and temporal spikiness...',
      targetLabel: 'Order Items',
      isQuery: true,
    })

    const skillSteps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        { id: 'st_dash', type: 'view_file', input: JSON.stringify({ TargetFile: 'skills/looker-dashboard/SKILL.md' }) },
        { id: 'st_prof', type: 'lookup_skill', arguments: { skill_name: 'looker-field-profiler' } },
        { id: 'st_scratch', type: 'view_file', input: JSON.stringify({ TargetFile: '/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md' }) },
      ],
    })
    expect(skillSteps).toEqual([
      expect.objectContaining({ id: 'st_dash', kind: 'skill', title: 'Reading skill looker-dashboard', path: 'skills/looker-dashboard/SKILL.md', content: LOOKER_DASHBOARD_SKILL_MD }),
      expect.objectContaining({ id: 'st_prof', kind: 'skill', title: 'Reading skill looker-field-profiler', path: '/workspace/skills/looker-field-profiler/SKILL.md', content: LOOKER_FIELD_PROFILER_SKILL_MD }),
      expect.objectContaining({ id: 'st_scratch', kind: 'skill', title: 'Reading skill scratch-search', path: '/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md', content: scratchSkillMd }),
    ])

    const nativeGuide = buildNativeContentGuide({ selectedExplores: ['thelook::order_items'], primaryModel: 'thelook', primaryExplore: 'order_items' })
    for (const doc of [NATIVE_CONTENT_GUIDE_MD, nativeGuide, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD, KDA_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD]) {
      expect(doc).toContain('looker-field-profiler')
      expect(doc).toContain('profile_fields')
    }
    for (const doc of [LOOKER_FIELD_PROFILER_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, NATIVE_CONTENT_GUIDE_MD, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD, AGENTS_MD]) {
      expect(doc).toContain('_field_value_search_')
    }
    for (const doc of [AGENTS_MD, readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8'), readFileSync(path.join(repoRoot, 'upstream/payload/AGENTS.md'), 'utf8')]) {
      expect(doc).toContain('skills/looker-dashboard/SKILL.md')
      expect(doc).toContain('skills/looker-field-profiler/SKILL.md')
      expect(doc).toContain('sub-skills/scratch-search/SKILL.md')
      expect(doc).toContain('_field_value_search_<model>')
    }
  })

  test('59. Issue #152: recovers wedged Looker OAuth host state + visibilitychange/stored session, falls back from /connections 403/404 to /lookml_models allowed_db_connection_names, and preserves SSE streamed markdown continuity + multi-line <ol>', async () => {
    // 1. OAuth hostOAuthWedged tracking, visibilitychange listener, and stored session recovery
    resetHostOAuthWedged()
    expect(isHostOAuthWedged()).toBe(false)

    const winListeners: Record<string, Array<() => void>> = {}
    const docListeners: Record<string, Array<() => void>> = {}
    const g = globalThis as unknown as { window?: unknown; document?: unknown }
    const prevWin = g.window
    const prevDoc = g.document
    g.window = {
      location: { origin: 'https://dev.looker.com' },
      addEventListener: (evt: string, fn: () => void) => { ;(winListeners[evt] = winListeners[evt] || []).push(fn) },
      removeEventListener: (evt: string, fn: () => void) => { winListeners[evt] = (winListeners[evt] || []).filter((x) => x !== fn) },
    }
    g.document = {
      visibilityState: 'visible',
      addEventListener: (evt: string, fn: () => void) => { ;(docListeners[evt] = docListeners[evt] || []).push(fn) },
      removeEventListener: (evt: string, fn: () => void) => { docListeners[evt] = (docListeners[evt] || []).filter((x) => x !== fn) },
    }
    try {
      const hangingSdk = { oauth2Authenticate: () => new Promise(() => {}) }
      const p1 = loginWithGoogleOAuth(hangingSdk, 'client-152', { focusReturnDelayMs: 15 })
      for (const fn of docListeners.visibilitychange || []) fn()
      await expect(p1).rejects.toThrow(/popup closed or failed/i)
      expect(isHostOAuthWedged()).toBe(true)
      expect(docListeners.visibilitychange?.length || 0).toBe(0)

      // Stored session resolves on focus/visibilitychange instead of rejecting and clears wedged flag
      const storedPayload = JSON.stringify({ token: 'stored_mobile_tok_152', expiresAt: Date.now() + 600_000, clientId: 'client-152' })
      const storedSdk = {
        oauth2Authenticate: () => new Promise(() => {}),
        localStorageGetItem: async () => storedPayload,
        localStorageSetItem: async () => {},
      }
      const p2 = loginWithGoogleOAuth(storedSdk, 'client-152', { focusReturnDelayMs: 15 })
      for (const fn of docListeners.visibilitychange || []) fn()
      await expect(p2).resolves.toBe('stored_mobile_tok_152')
      expect(isHostOAuthWedged()).toBe(false)
      resetHostOAuthWedged()
    } finally {
      g.window = prevWin
      g.document = prevDoc
    }

    // 2. Non-admin /connections -> /lookml_models fallback in fetchAvailableLookerConnectionsMarkdown
    const adminConnSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) =>
            p === '/connections'
              ? { statusCode: 200, ok: true, body: [{ name: 'bq_analytics', dialect_name: 'bigquery_standard_sql', database: 'analytics_prod', schema: 'core' }] }
              : { statusCode: 200, ok: true, body: [] },
        },
      },
    })
    const adminMd = await fetchAvailableLookerConnectionsMarkdown(adminConnSdk)
    expect(adminMd).toContain('`bq_analytics` (bigquery_standard_sql · analytics_prod · core)')

    const nonAdminFallbackSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) =>
            p === '/connections'
              ? { statusCode: 404, ok: false, body: { message: 'Not found' } }
              : { statusCode: 200, ok: true, body: [{ name: 'retail_model', project_name: 'retail_proj', allowed_db_connection_names: ['snowflake_dw', 'bq_retail'] }] },
        },
      },
    })
    const fallbackMd = await fetchAvailableLookerConnectionsMarkdown(nonAdminFallbackSdk)
    expect(fallbackMd).toContain('`snowflake_dw` (models/projects: retail_proj)')
    expect(fallbackMd).toContain('`bq_retail` (models/projects: retail_proj)')

    // 3. Keyless step.delta SSE merging & non-trimmed streamed parts extraction
    let sseState = { id: 'int_152', status: 'in_progress' }
    for (const chunk of ['I', "'ll", ' help you set up **Target Tables or Schemas', '**: [Open SQL Runner](/sql', ')']) {
      sseState = mergeInteractionSseEvent(sseState, 'step.delta', { step_delta: { type: 'text', text: chunk } })
    }
    expect((sseState.steps as Array<{ text?: string }>).length).toBe(1)
    expect(extractInteractionOutputText(sseState)).toBe("I'll help you set up **Target Tables or Schemas**: [Open SQL Runner](/sql)")
    expect(
      extractNonThoughtText([
        { type: 'output_text', text: 'I' },
        { type: 'output_text', text: "'ll" },
        { type: 'output_text', text: ' check connections.' },
      ])
    ).toBe("I'll check connections.")

    // 4. StudioMarkdown normalizes split **bold\n** / [link](url\n) and keeps multi-line <ol> as a single <ol> with 2 <li>s
    type Elem = React.ReactElement<Record<string, unknown>>
    const mdTree = StudioMarkdown({
      text: '1. **Connection Name**: Check [Open Looker Connections](/admin/connections\n)\nwrapped continuation line\n2. **Target Tables or Schemas\n**: See [Open SQL Runner](/sql\n)',
    }) as Elem
    const blocks = mdTree.props.children as Elem[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('ol')
    const liNodes = blocks[0].props.children as Elem[]
    expect(liNodes).toHaveLength(2)
  })

  test('60. Issue #151: exports STUDIO_SLASH_SKILLS, extracts /skill-id tokens via extractSlashSkillIds, and configures buildLookmlSystemGuide without forcing Turn Skills when none are activated', () => {
    expect(STUDIO_SLASH_SKILLS.map((s) => s.id)).toEqual([
      'looker-project-onboarding',
      'lookml-field-curation',
      'lookml-tests',
      'lookml-snapshot',
      'generate-view-from-table',
      'agentic-lookml-workflow',
      'looker-field-profiler',
      'looker-dashboard',
      'key-driver-analysis',
      'data-investigator',
      'data-apps',
    ])

    expect(extractSlashSkillIds('')).toEqual([])
    expect(extractSlashSkillIds('Please run /lookml-tests and /looker-field-profiler on order_items')).toEqual([
      'lookml-tests',
      'looker-field-profiler',
    ])
    expect(extractSlashSkillIds('/looker-project-onboarding from snowflake_prod')).toEqual([
      'looker-project-onboarding',
    ])
    expect(extractSlashSkillIds('https://example.com/lookml-tests/foo')).toEqual([])

    const guideDefault = buildLookmlSystemGuide({
      selectedExplores: ['thelook::order_items'],
      primaryModel: 'thelook',
      primaryExplore: 'order_items',
      projectId: 'agentic_thelook',
      activatedSkills: [],
    })
    expect(guideDefault).not.toContain('Activated Turn Skills:')
    expect(guideDefault).toContain(
      'Automatically discover and load the matching skill(s) for this turn from `/workspace/AGENTS.md` and `/workspace/skills/<skill-id>/SKILL.md`.'
    )

    const guideExplicit = buildLookmlSystemGuide({
      selectedExplores: ['thelook::order_items'],
      primaryModel: 'thelook',
      primaryExplore: 'order_items',
      projectId: 'agentic_thelook',
      activatedSkills: ['lookml-tests'],
      userPrompt: 'Also run /lookml-field-curation on orders',
    })
    expect(guideExplicit).toContain('Activated Turn Skills: `lookml-tests`, `lookml-field-curation`.')
    expect(guideExplicit).toContain('Prioritize reading and executing the instructions for these activated skills on this turn.')
  })

  test('61. Issue #158: enforces all 6 Metric Selector Data App standards across onboarding skill, DATA_APP_GUIDE_MD, step3Directive, data-app-creator skill/reference, and eval-new-project Turn 6 grader', () => {
    const repoRoot = path.resolve(__dirname, '../..')
    const onboardingSkillDisk = readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')
    expect(onboardingSkillDisk).toBe(LOOKER_PROJECT_ONBOARDING_SKILL_MD)
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    expect(DATA_APP_GUIDE_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)

    const antigravityTsDisk = readFileSync(path.join(repoRoot, 'src/antigravity.ts'), 'utf8')
    const step3Line = antigravityTsDisk.split('\n').find((line) => line.includes('const step3Directive =')) || ''
    const creatorSkillDisk = readFileSync(path.join(repoRoot, 'upstream/payload/skills/data-app-creator/SKILL.md'), 'utf8')
    const litRefDisk = readFileSync(path.join(repoRoot, 'upstream/payload/skills/data-app-creator/reference/LIT_DATA_APPS.md'), 'utf8')
    const evalNewProjectDisk = readFileSync(path.join(repoRoot, 'scripts/eval-new-project.mjs'), 'utf8')

    const requiredTokens = [
      'ACTIVE METRIC', '--app-chart-1', '--app-chart-2', 'shiftKey', 'contextmenu', 'Remove comparison',
      'kpi-change', 'vs. prev', 'lower-better',
      'opposite: true', 'Longitudinal Trend', 'yAxis.title.text', '⋮',
      'PERIOD_DEFAULTS = { date:', 'Period', 'Window', 'periodCount', 'getEffectiveFilters',
      'Dimensions', 'selectedDimensions', 'ago for', 'This Period', 'Last Period', 'Variance',
    ]
    for (const targetDoc of [LOOKER_PROJECT_ONBOARDING_SKILL_MD, DATA_APP_GUIDE_MD, step3Line, creatorSkillDisk, litRefDisk]) {
      expect(targetDoc).toMatch(/2 \* (?:this\.)?periodCount/)
      for (const tok of requiredTokens) expect(targetDoc).toContain(tok)
    }

    for (const checkKey of ['noInvalidDayField', 'noMetricDropdownOrActiveBadge', 'hasPopClickableKpis', 'hasCardBorderCompareDualAxis', 'hasTrendMenuAndYAxis', 'hasDecoupledPeriodAndWindow', 'hasMultiSelectDimensions', 'hasTitlelessPopVarianceGrid']) {
      expect(evalNewProjectDisk).toContain(checkKey)
    }
  })

  test('62. Issue #157: pre-fetches accessible connections via discoverAccessibleConnections, runs Turn-1 project intake toollessly at thinkingLevel="low" with zero blocking container boot, uses bare Monty globals, renders lookml-open-ide-btn, and enforces IDE/dashboard links', async () => {
    clearLookerMetadataCache()

    // 1. discoverAccessibleConnections: /connections caching + non-admin /lookml_models fallback
    let adminConnHits = 0
    const adminSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) => {
            if (p === '/connections') {
              adminConnHits += 1
              return {
                statusCode: 200,
                ok: true,
                body: [
                  { name: 'bq_warehouse', dialect_name: 'bigquery_standard_sql', database: 'corp_dw', schema: 'analytics' },
                ],
              }
            }
            return { statusCode: 200, ok: true, body: [] }
          },
        },
      },
    })
    const [conns1, conns2] = await Promise.all([
      discoverAccessibleConnections(adminSdk),
      discoverAccessibleConnections(adminSdk),
    ])
    expect(adminConnHits).toBe(1)
    expect(conns1).toEqual([
      { name: 'bq_warehouse', dialect_name: 'bigquery_standard_sql', database: 'corp_dw', schema: 'analytics', source: 'connections' },
    ])
    expect(conns2).toEqual(conns1)
    expect(formatAccessibleConnectionsMarkdown(conns1)).toContain(
      '- `bq_warehouse` (bigquery_standard_sql · corp_dw · analytics)'
    )

    let fallbackHits = 0
    const nonAdminSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) => {
            fallbackHits += 1
            if (p === '/connections') return { statusCode: 403, ok: false, body: { message: 'Forbidden' } }
            return {
              statusCode: 200,
              ok: true,
              body: [{ name: 'commerce_model', project_name: 'commerce_proj', allowed_db_connection_names: ['sf_prod'] }],
            }
          },
        },
      },
    })
    const fallbackConns = await discoverAccessibleConnections(nonAdminSdk)
    expect(fallbackHits).toBe(2)
    expect(fallbackConns).toEqual([
      { name: 'sf_prod', models: ['commerce_proj'], source: 'lookml_models' },
    ])
    await discoverAccessibleConnections(nonAdminSdk)
    expect(fallbackHits).toBe(2)

    // 2. Prompt classifiers, bare Monty globals (zero sdk.*), skill byte-parity, and required link instructions
    expect(isNewProjectOnboardingIntakePrompt('I need to create a new project')).toBe(true)
    expect(isNewProjectOnboardingIntakePrompt('create a new project')).toBe(true)
    expect(
      isNewProjectOnboardingIntakePrompt(
        'Create a new project called sales_core on connection bq_warehouse using schema analytics'
      )
    ).toBe(false)
    expect(
      isConnectionSchemaDiscoveryPrompt(
        "Let's call it sales_core on connection bq_warehouse. What schemas do you have access to on that connection?"
      )
    ).toBe(true)
    expect(isConnectionSchemaDiscoveryPrompt('Use the analytics dataset.')).toBe(false)

    const repoRoot = path.resolve(__dirname, '../..')
    expect(readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')).toBe(
      LOOKER_PROJECT_ONBOARDING_SKILL_MD
    )
    expect(readFileSync(path.join(repoRoot, 'skills/looker-dashboard/SKILL.md'), 'utf8')).toBe(
      LOOKER_DASHBOARD_SKILL_MD
    )
    expect(readFileSync(path.join(repoRoot, '.agents/skills/looker-dashboard/SKILL.md'), 'utf8')).toBe(
      LOOKER_DASHBOARD_SKILL_MD
    )

    const guideWithConns = buildLookmlSystemGuide({
      selectedExplores: [],
      userPrompt: 'I need to create a new project',
      availableConnections: conns1,
    })
    expect(guideWithConns).toContain('### Available Looker Connections')
    expect(guideWithConns).toContain('`bq_warehouse` (bigquery_standard_sql · corp_dw · analytics)')
    expect(guideWithConns).toContain('[Open <project_name> in Looker IDE](/projects/<project_name>/files)')
    expect(guideWithConns).toContain('[Open <Dashboard Title>](/dashboards/<id>)')
    for (const doc of [LOOKER_PROJECT_ONBOARDING_SKILL_MD, guideWithConns]) {
      expect(doc).toContain('all_connections')
      expect(doc).toContain('all_lookml_models')
      expect(doc).toContain('connection_schemas')
      expect(doc).not.toMatch(/\bsdk\.(?:all_connections|all_lookml_models|connection_schemas|connection_tables)\b/)
    }
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain('/projects/<project_name>/files')
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain('/dashboards/<id>')
    expect(LOOKER_DASHBOARD_SKILL_MD).toContain('/dashboards/<id>')

    // Verify LkrCodeMode Monty runtime strips accidental sdk.<method>(...) prefixes cleanly
    const cmBareOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: 'c = sdk.all_connections(fields="name")\nreturn {"first": c[0]["name"]}',
        sdk: adminSdk,
      })
    )
    expect((cmBareOut.result || cmBareOut).first).toBe('bq_warehouse')

    // 3. runAntigravityTurn fast-path on Turn-1 intake -> Turn-2 schema discovery -> Turn-3 LookML bundle + IDE link
    const postedBodies: MockInteractionPostBody[] = []
    const mockExt157 = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        postedBodies.push(body)
        if (postedBodies.length === 1) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_157_t1',
              status: 'completed',
              output_text:
                '<USE_CASE>lookml</USE_CASE>\nAvailable connection: `bq_warehouse`. Please provide project name and target schema.',
            }),
          }
        }
        if (postedBodies.length === 2) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_157_t2',
              status: 'completed',
              output_text: '<USE_CASE>lookml</USE_CASE>\nAccessible schemas on `bq_warehouse`: `analytics`, `finance`.',
            }),
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_157_t3',
            environment_id: 'env_157_warm',
            status: 'completed',
            steps: [
              {
                type: 'code_execution',
                output:
                  '<LOOKML_BUNDLE>{"id":"sales_core_1","title":"sales_core","project_id":"sales_core","model_name":"sales_core","files":[{"path":"sales_core.model.lkml","action":"created","content":"connection: \\"bq_warehouse\\"\\n"}]}</LOOKML_BUNDLE>',
              },
            ],
            output_text: '<USE_CASE>lookml</USE_CASE>\nCreated Bronze views. Want me to profile the data?',
          }),
        }
      },
    }

    const t1Res = await runAntigravityTurn({
      sdk: adminSdk,
      extensionSDK: mockExt157,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-157' },
      session: {},
      thinkingLevel: 'high',
      useCase: 'auto',
      toolMode: 'lookml',
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'I need to create a new project',
      onStatus: () => {},
    })
    expect(postedBodies).toHaveLength(1)
    expect(postedBodies[0].model).toBe(DEFAULT_ANTIGRAVITY_MODEL)
    expect(postedBodies[0].store).toBe(false)
    expect(postedBodies[0].background).toBe(false)
    expect(postedBodies[0].tools).toEqual([])
    expect(postedBodies[0].environment).toBeUndefined()
    expect(postedBodies[0].generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 2048 })
    expect(postedBodies[0].input?.[0]?.text?.startsWith('[THINKING LEVEL: LOW')).toBe(true)
    expect(postedBodies[0].input?.[0]?.text).toContain('`bq_warehouse` (bigquery_standard_sql · corp_dw · analytics)')
    expect(t1Res.resolvedUseCase).toBe('lookml')
    expect(t1Res.session.statelessTurn).toBe(true)

    const t2Res = await runAntigravityTurn({
      sdk: adminSdk,
      extensionSDK: mockExt157,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-157' },
      session: t1Res.session,
      thinkingLevel: 'high',
      useCase: 'auto',
      toolMode: 'lookml',
      selectedExplores: [],
      schemaMarkdown: '',
      priorMessages: [
        { role: 'user', text: 'I need to create a new project' },
        { role: 'assistant', text: t1Res.assistantText },
      ],
      userPrompt: "Let's call it sales_core on connection bq_warehouse. What schemas do you have access to?",
      onStatus: () => {},
    })
    expect(postedBodies).toHaveLength(2)
    expect(postedBodies[1].environment).toBeUndefined()
    expect(postedBodies[1].previous_interaction_id).toBeUndefined()
    expect(postedBodies[1].tools).toEqual([LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL])
    expect(postedBodies[1].input?.[0]?.text?.startsWith('[THINKING LEVEL: LOW')).toBe(true)
    expect(postedBodies[1].input?.[0]?.text).toContain('Prior conversation context:')

    const t3Res = await runAntigravityTurn({
      sdk: adminSdk,
      extensionSDK: mockExt157,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-157' },
      session: t2Res.session,
      thinkingLevel: 'high',
      useCase: 'auto',
      toolMode: 'lookml',
      selectedExplores: [],
      schemaMarkdown: '',
      priorMessages: [
        { role: 'user', text: 'I need to create a new project' },
        { role: 'assistant', text: t1Res.assistantText },
        { role: 'user', text: "Let's call it sales_core on connection bq_warehouse. What schemas do you have access to?" },
        { role: 'assistant', text: t2Res.assistantText },
      ],
      userPrompt: 'Use the analytics schema.',
      onStatus: () => {},
    })
    expect(postedBodies).toHaveLength(3)
    expect(postedBodies[2].environment).toEqual(expect.objectContaining({ type: 'remote' }))
    expect(t3Res.assistantText).toContain('[Open sales_core in Looker IDE](/projects/sales_core/files)')

    // 4. LookmlPreviewPane renders data-testid="lookml-open-ide-btn" when bundle.project_id is present
    const openedIdeUrls: Array<{ url: string; target?: string }> = []
    const withProjectHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: {
          id: 'b1',
          title: 'Sales Core',
          project_id: 'sales_core',
          files: [{ path: 'sales_core.model.lkml', action: 'created', content: 'connection: "bq"\n' }],
        },
        hostUrl: 'https://dev.looker.com',
        extensionSDK: { openBrowserWindow: (url: string, target?: string) => openedIdeUrls.push({ url, target }) },
      })
    )
    expect(withProjectHtml).toContain('data-testid="lookml-open-ide-btn"')
    expect(withProjectHtml).toContain('Open Project in IDE')

    const withoutProjectHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: { id: 'b2', title: 'Untitled', project_id: '', files: [] },
        hostUrl: 'https://dev.looker.com',
      })
    )
    expect(withoutProjectHtml).not.toContain('data-testid="lookml-open-ide-btn"')
  })

  test('63. Issue #156: routes clipboard copies via copyTextWithExtensionSdk, parses GFM pipe tables / <hr> / <ol start>, walks full sandbox interaction chains via fetchConversationSandboxDebugMarkdown, and refreshes LookmlTurnSkills & UseCaseInfoModal guides', async () => {
    // 1. copyTextWithExtensionSdk: extensionSDK.clipboardWrite first, navigator.clipboard.writeText fallback
    const extCopied: string[] = []
    const navCopied: string[] = []
    const g = globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }
    const prevNav = g.navigator
    try {
      g.navigator = { clipboard: { writeText: async (t: string) => { navCopied.push(t) } } }
      expect(await copyTextWithExtensionSdk('', { clipboardWrite: async (t: string) => { extCopied.push(t) } })).toBe(false)
      expect(await copyTextWithExtensionSdk('line 1\nline 2', { clipboardWrite: async (t: string) => { extCopied.push(t) } })).toBe(true)
      expect(extCopied).toEqual(['line 1\nline 2'])
      expect(navCopied).toEqual([])

      // Fallback when clipboardWrite throws or is missing
      expect(await copyTextWithExtensionSdk('fallback_throw', { clipboardWrite: async () => { throw new Error('sandbox denied') } })).toBe(true)
      expect(await copyTextWithExtensionSdk('fallback_missing', undefined)).toBe(true)
      expect(navCopied).toEqual(['fallback_throw', 'fallback_missing'])
    } finally {
      g.navigator = prevNav
    }

    // 2. StudioMarkdown: GFM pipe tables, --- <hr>, and <ol start={firstNum}>
    type Elem = React.ReactElement<Record<string, unknown>>
    const gfmMd = [
      '| Category | Formula | Revenue |',
      '| :--- | :---: | ---: |',
      '| Outerwear | `price | qty` | $142,500 |',
      '| Coats \\| Parkas | **gross** | $84,120 |',
      '',
      '---',
      '',
      '3. Third step after break',
      '4. Fourth step',
    ].join('\n')
    const mdRoot = StudioMarkdown({ text: gfmMd }) as Elem
    const mdBlocks = mdRoot.props.children as Elem[]
    expect(mdBlocks).toHaveLength(3)
    expect(mdBlocks[0].type).toBe('div')
    expect(mdBlocks[0].props.className).toBe('dab-py-table-wrap')
    const tableEl = mdBlocks[0].props.children as Elem
    expect(tableEl.type).toBe('table')
    expect(tableEl.props['data-testid']).toBe('chat-markdown-table')
    const [theadEl, tbodyEl] = tableEl.props.children as [Elem, Elem]
    const thCells = ((theadEl.props.children as Elem).props.children as Elem[])
    expect(thCells).toHaveLength(3)
    expect(thCells.map((th) => (th.props.style as { textAlign?: string } | undefined)?.textAlign)).toEqual(['left', 'center', 'right'])
    const trRows = tbodyEl.props.children as Elem[]
    expect(trRows).toHaveLength(2)
    expect(mdBlocks[1].type).toBe('hr')
    expect(mdBlocks[1].props.className).toBe('dab-md-hr')
    expect(mdBlocks[2].type).toBe('ol')
    expect(mdBlocks[2].props.start).toBe(3)
    expect((mdBlocks[2].props.children as Elem[])).toHaveLength(2)

    // 3. Untruncated formatThinkingTraceMarkdown + 2-turn fetchConversationSandboxDebugMarkdown
    const longOutput = `SELECT ${'col_metric_value, '.repeat(60)}FROM order_items -- END_MARKER_999`
    expect(longOutput.length).toBeGreaterThan(900)
    const singleTurnMd = formatThinkingTraceMarkdown([
      { id: 's1', kind: 'codemode', title: 'Executing Looker queries...', content: longOutput, status: 'done' },
    ])
    expect(singleTurnMd).toContain('END_MARKER_999')

    const threadMd = formatConversationThreadMarkdown(
      [
        { role: 'user', text: 'Build revenue app' },
        { role: 'assistant', text: 'Built app.', interactionId: 'int_t1', activitySteps: [{ id: 's1', kind: 'thought', title: 'Plan', content: longOutput, status: 'done' }] },
      ],
      { title: 'Revenue App Thread', conversationId: 'conv_42', liveActivitySteps: [{ id: 's_live', kind: 'code_execution', title: 'python3 /workspace/bundle_app.py', status: 'running' }], busyStatus: 'Bundling...' }
    )
    expect(threadMd).toContain('END_MARKER_999')
    expect(threadMd).toContain('Live / In-Flight Activity (Bundling...)')
    expect(threadMd).toContain('python3 /workspace/bundle_app.py')

    const longThought = `Analyzing schema cardinality across dimensions: ${' products.category '.repeat(55)} [FULL_THOUGHT_TAIL]`
    const proxyCalls: string[] = []
    const debugClipWrites: string[] = []
    const mockDebugExt = {
      clipboardWrite: async (t: string) => { debugClipWrites.push(t) },
      serverProxy: async (url: string) => {
        proxyCalls.push(url)
        if (url.endsWith('/interactions/int_turn_2')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn_2',
              previous_interaction_id: 'int_turn_1',
              status: 'completed',
              environment_id: 'env_live_sandbox_77',
              usage: { input_tokens: 1200, output_tokens: 450, thought_tokens: 310 },
              input: [{ type: 'text', text: 'Add gross margin breakdown and write /workspace/analysis.md' }],
              steps: [
                { id: 'st_2a', type: 'code_execution', language: 'BASH', command: 'python3 /workspace/bundle_app.py /workspace/apps/rev-app/app.js && cat /workspace/skills/data-apps/SKILL.md', stdout: 'BUNDLE_STDOUT_FULL_OK' },
                { id: 'st_2b', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: longThought, code: 'return sdk.run_inline_query("json", {"model":"thelook","view":"order_items"})' } },
                { id: 'st_2c', type: 'function_result', name: 'run_looker_codemode', call_id: 'st_2b', result: { rows: [{ category: 'Outerwear', margin: 98412.5 }] } },
              ],
              output_text: 'Updated Data App and saved `/workspace/analysis.md`.',
            }),
          }
        }
        if (url.endsWith('/interactions/int_turn_1')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn_1',
              previous_interaction_id: 'int_prewarm_0',
              status: 'completed',
              environment_id: 'env_live_sandbox_77',
              input: [{ type: 'text', text: 'Create initial revenue Data App' }],
              steps: [{ id: 'st_1a', type: 'thought', thought: 'Initial Turn 1 reasoning step' }],
              output_text: 'Created `/workspace/apps/rev-app/app.js`.',
            }),
          }
        }
        if (url.endsWith('/interactions/int_prewarm_0')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_prewarm_0',
              status: 'completed',
              environment_id: 'env_live_sandbox_77',
              input: [{ type: 'text', text: '[PREWARM: initialize container]' }],
              output_text: 'Ready.',
            }),
          }
        }
        if (url.includes('/environments/env_live_sandbox_77/files/workspace/apps/rev-app/app.js')) {
          return { ok: true, status: 200, body: 'export class RevApp extends DataApp { /* FULL_APP_JS_SOURCE */ }' }
        }
        if (url.includes('/environments/env_live_sandbox_77/files/workspace/analysis.md')) {
          return { ok: true, status: 200, body: '# Margin Analysis\nOuterwear drove +18.4% YoY.' }
        }
        return { ok: false, status: 404, body: 'Not found' }
      },
    }

    const sandboxDumpMd = await fetchConversationSandboxDebugMarkdown({
      extensionSDK: mockDebugExt,
      auth: { mode: 'apikey', apiKey: 'test_key' },
      conversationId: 'conv_app_42',
      label: 'Executive Revenue App',
      useCase: 'app',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'high',
      lastInteractionId: 'int_turn_2',
      messages: [
        { role: 'user', text: 'Create initial revenue Data App' },
        { role: 'assistant', text: 'Created app.', interactionId: 'int_turn_1' },
        { role: 'user', text: 'Add gross margin breakdown and write /workspace/analysis.md' },
        { role: 'assistant', text: 'Updated Data App and saved `/workspace/analysis.md`.', interactionId: 'int_turn_2' },
      ],
    })
    await copyTextWithExtensionSdk(sandboxDumpMd, mockDebugExt)

    expect(debugClipWrites).toEqual([sandboxDumpMd])
    // Chronological order: Turn 1 (int_turn_1) appears before Turn 2 (int_turn_2), and [PREWARM:] is skipped
    expect(sandboxDumpMd).not.toContain('int_prewarm_0')
    expect(sandboxDumpMd.indexOf('### Turn 1 Interaction: `int_turn_1`')).toBeLessThan(
      sandboxDumpMd.indexOf('### Turn 2 Interaction: `int_turn_2`')
    )
    expect(sandboxDumpMd).toContain('[FULL_THOUGHT_TAIL]')
    expect(sandboxDumpMd).toContain('BUNDLE_STDOUT_FULL_OK')
    expect(sandboxDumpMd).toContain('98412.5')
    expect(sandboxDumpMd).toContain('### `/workspace/apps/rev-app/app.js`')
    expect(sandboxDumpMd).toContain('FULL_APP_JS_SOURCE')
    expect(sandboxDumpMd).toContain('### `/workspace/analysis.md`')
    expect(sandboxDumpMd).toContain('Outerwear drove +18.4% YoY.')
    // Static /workspace/skills/data-apps/SKILL.md was NOT fetched over network
    expect(proxyCalls.some((u) => u.includes('skills/data-apps'))).toBe(false)

    // 4. Refreshed DOC_UI_COMPONENTS.LookmlTurnSkills & USE_CASE_GUIDES
    const slashPreview = DOC_UI_COMPONENTS.LookmlTurnSkills() as Elem
    expect(slashPreview.props['data-testid']).toBe('doc-slash-skill-menu-preview')
    const previewJson = JSON.stringify(slashPreview)
    for (const skId of ['/looker-project-onboarding', '/lookml-field-curation', '/lookml-tests']) {
      expect(previewJson).toContain(skId)
    }
    expect(USE_CASE_GUIDES.lookml.markdown).toContain('/looker-project-onboarding')
    expect(USE_CASE_GUIDES.auto.markdown).toContain('@explore:')
    expect(USE_CASE_GUIDES.dashboard.markdown).toContain('LookML Dashboards')
  })

  test('64. Issue #155: preserves previous_interaction_id + extracts bundles across multi-use-case turns, unifies contentItems (lookml/script/hidden/modified), prunes Looker Artifacts bloat, and isolates studio-conversation-debugger + root AGENTS.md rule', async () => {
    clearArtifactServiceCache()

    // 1. Cross-use-case continuity: LookML session -> Dashboard turn preserves previous_interaction_id and extracts <NATIVE_CONTENT_BUNDLE> even when toolMode === 'lookml'
    const postedBodies: MockInteractionPostBody[] = []
    const mockExtSdk = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        if (init?.body) postedBodies.push(JSON.parse(String(init.body)) as MockInteractionPostBody)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_cross_mode_2',
            environment_id: 'env_shared_155',
            status: 'completed',
            output_text:
              '<USE_CASE>dashboard</USE_CASE>\nCreated Executive KPI UDD.\n<NATIVE_CONTENT_BUNDLE>{"id":"34","content_type":"dashboard","title":"Executive KPI UDD","folder_id":"1","tile_count":4}</NATIVE_CONTENT_BUNDLE>',
          }),
        }
      },
    }

    const crossTurn = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: mockExtSdk,
      userId: '1',
      conversationId: 'conv_1762720000',
      environmentId: 'env_shared_155',
      auth: { mode: 'apikey' },
      session: {
        environmentId: 'env_shared_155',
        lastInteractionId: 'int_lookml_turn_1',
        conversationId: 'conv_1762720000',
        toolType: 'lookml',
        explores: ['ecom::orders'],
      },
      mode: 'data_app',
      useCase: 'auto',
      toolMode: 'lookml',
      allowedModes: ['app', 'dashboard', 'lookml', 'tile', 'health-check', 'conversational-analytics'],
      selectedExplores: ['ecom::orders'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Now build an Executive KPI UDD dashboard on orders',
      onStatus: () => {},
    })

    expect(postedBodies[0]?.previous_interaction_id).toBe('int_lookml_turn_1')
    expect(crossTurn.resolvedUseCase).toBe('dashboard')
    expect(crossTurn.nativeBundle?.id).toBe('34')
    expect(crossTurn.nativeBundle?.title).toBe('Executive KPI UDD')

    // 2. Unified contentItems hydration for lookml/script/report + hidden & source='modified' + embed target preload on lookml/script
    expect(
      hydrateConversationContentItems({
        id: 'conv_lml',
        type: 'lookml',
        label: 'Orders Model Onboarding',
        content: { sessionId: 'ecom_1762720001', projectId: 'ecom' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'lookml:ecom_1762720001',
        id: 'ecom_1762720001',
        contentType: 'lookml',
        title: 'Orders Model Onboarding',
      }),
    ])
    expect(
      hydrateConversationContentItems({
        id: 'conv_scr',
        type: 'tile',
        label: 'Space Audit Script',
        content: { scriptId: 'audit_1' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'script:audit_1',
        id: 'audit_1',
        contentType: 'script',
        title: 'Space Audit Script',
      }),
    ])
    expect(
      hydrateConversationContentItems({
        id: 'conv_rep',
        type: 'health-check',
        label: '3-Pillar Audit',
        content: { reportId: 'hc_9' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'report:hc_9',
        id: 'hc_9',
        contentType: 'report',
        title: '3-Pillar Audit',
      }),
    ])

    const step1 = upsertStudioContentItem([], {
      id: '34',
      dashboardId: '34',
      contentType: 'dashboard',
      title: 'Executive KPI UDD',
      source: 'created',
      hidden: true,
    })
    expect(step1.item.hidden).toBe(true)
    const step2 = upsertStudioContentItem(step1.items, {
      id: '34',
      dashboardId: '34',
      contentType: 'dashboard',
      title: 'Executive KPI UDD v2',
      source: 'modified',
    })
    expect(step2.item.hidden).toBe(false)
    expect(step2.item.source).toBe('created')
    expect(step2.item.title).toBe('Executive KPI UDD v2')

    expect(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({ id: 'ecom_1', contentType: 'lookml', title: 'LookML' }),
        nonce: 1,
      }).kind
    ).toBe('preload')
    expect(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({ id: 'scr_1', contentType: 'script', title: 'Script' }),
        nonce: 1,
      }).kind
    ).toBe('preload')

    // 3. Lightweight Looker Artifacts pruning: strip activitySteps, images, rawCode from user_conversations:1 and omit studio.messages from obj_lookml_* & obj_dashboard_*
    const rawArtifactStore = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) => {
        const hit = rawArtifactStore.get(key)
        return hit ? [{ key, version: 1, value: hit }] : []
      },
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) rawArtifactStore.set(u.key, u.value)
        return updates
      },
    })

    await saveUserConversation(mockSdk, '1', {
      id: 'conv_1762720000',
      type: 'app',
      label: 'Lightweight Pruning Test',
      interactionId: 'int_155',
      environmentId: 'env_155',
      activeContentTabKey: 'data_app:42',
      contentItems: [
        {
          key: 'data_app:42',
          id: '42',
          dashboardId: '42',
          contentType: 'data_app',
          title: 'Revenue App',
          embedPath: '/embed/dashboards/42',
          rawCode: 'export class HugeMultiMegabyteApp {}',
          source: 'created',
          hidden: true,
        },
      ],
      messages: [
        {
          role: 'user',
          text: 'Build app from screenshot',
          images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA'],
        } as unknown as ConversationRecord['messages'] extends Array<infer M> ? M : never,
        {
          role: 'assistant',
          text: 'Published Data App #42.',
          interactionId: 'int_155',
          dashboardId: '42',
          thinkingDurationSec: 4,
          activitySteps: [{ id: 's1', kind: 'code', title: 'Bundled app', status: 'done', content: 'huge trace' }],
        },
      ],
      updatedAt: '2026-11-09T20:00:00Z',
    })

    const persistedConvsJson = rawArtifactStore.get('user_conversations:1') || '[]'
    expect(persistedConvsJson).not.toContain('HugeMultiMegabyteApp')
    expect(persistedConvsJson).not.toContain('data:image/png;base64')
    expect(persistedConvsJson).not.toContain('activitySteps')
    const reloadedConvs = JSON.parse(persistedConvsJson) as ConversationRecord[]
    expect(reloadedConvs[0]?.contentItems?.[0]?.hidden).toBe(true)
    expect(reloadedConvs[0]?.contentItems?.[0]?.rawCode).toBeUndefined()
    expect(reloadedConvs[0]?.messages).toEqual([
      { role: 'user', text: 'Build app from screenshot' },
      { role: 'assistant', text: 'Published Data App #42.', interactionId: 'int_155', dashboardId: '42', thinkingDurationSec: 4 },
    ])

    await saveLookmlSessionArtifact({
      sdk: mockSdk,
      userId: '1',
      bundle: {
        id: 'ecom_1762720001',
        title: 'LookML Session',
        project_id: 'ecom',
        files: [],
        validation: { passed: true, error_count: 0, errors: [] },
        tests: [],
        queries: [],
      },
      studio: {
        explores: ['ecom::orders'],
        lastInteractionId: 'int_lml_1',
        environmentId: 'env_155',
        messages: [{ role: 'user', text: 'Should not duplicate in obj_lookml' }],
      },
    })
    const loadedLookmlObj = await loadLookmlSessionArtifact(mockSdk, undefined, 'ecom_1762720001')
    expect(loadedLookmlObj.studio.messages).toBeUndefined()
    expect(rawArtifactStore.get('obj_lookml_ecom_1762720001')).not.toContain('Should not duplicate in obj_lookml')

    await saveNativeContentArtifact(
      mockSdk,
      undefined,
      '1',
      { id: '34', content_type: 'dashboard', title: 'Executive KPI UDD' },
      '1',
      null,
      {
        explores: ['ecom::orders'],
        lastInteractionId: 'int_dash_1',
        environmentId: 'env_155',
        messages: [{ role: 'user', text: 'Should not duplicate in obj_dashboard' }],
      }
    )
    expect(rawArtifactStore.get('obj_dashboard_34')).not.toContain('Should not duplicate in obj_dashboard')

    // 4. Root-only AGENTS.md rule & studio-conversation-debugger excluded from sandbox bundle
    const repoRoot = path.resolve(__dirname, '../..')
    const rootAgents = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
    const upstreamAgents = readFileSync(path.join(repoRoot, 'upstream/payload/AGENTS.md'), 'utf8')
    expect(rootAgents).toContain('## Looker Artifacts Lightweight-Only Rule')
    expect(upstreamAgents).not.toContain('Looker Artifacts Lightweight-Only Rule')
    expect(AGENTS_MD).not.toContain('Looker Artifacts Lightweight-Only Rule')
    expect(BOOTSTRAP_LOOKML_PY).not.toContain('"lookml-session"')
    expect(
      Object.keys(SANDBOX_AGENT_SKILL_FILES).some((k) => k.includes('studio-conversation-debugger'))
    ).toBe(false)
    expect(
      Object.keys(BUILTIN_SKILLS_FILES).some((k) => k.includes('studio-conversation-debugger'))
    ).toBe(false)
    expect(
      buildWorkspaceSources({ schemaMarkdown: '# Schema' }).some((s) =>
        s.target.includes('studio-conversation-debugger')
      )
    ).toBe(false)
  })

  test('66. Issue #167: enforces LookML dashboard field-existence & validate_project warning gates, clean summaries, date timeframe guard in BUNDLE_APP_PY, 4-row PoP KPIs, and card-border compare', async () => {
    // 1. upsert_udd & upsert_lookml_dashboard field-existence + validate_project warning/fatal gates in Monty WASM
    let exploreHits = 0
    let validationErrors: Array<{ severity: string; file_path?: string; message: string }> = []
    const mockDashSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, _qp?: Record<string, unknown>, body?: Record<string, unknown>) => {
            const m = method.toUpperCase()
            if (m === 'GET' && reqPath.includes('/lookml_models/ecom/explores/order_items')) {
              exploreHits += 1
              return {
                statusCode: 200,
                ok: true,
                body: {
                  fields: {
                    dimensions: [{ name: 'order_items.created_date' }, { name: 'products.category' }],
                    measures: [{ name: 'order_items.total_sale_price' }, { name: 'order_items.count' }],
                    filters: [],
                    parameters: [],
                  },
                },
              }
            }
            if (m === 'POST' && reqPath.includes('/projects/ecom_proj/validate')) {
              return { statusCode: 200, ok: true, body: { errors: validationErrors } }
            }
            if (m === 'POST' && reqPath === '/dashboards') return { statusCode: 200, ok: true, body: { id: '77', title: body?.title } }
            if (m === 'POST' && reqPath === '/queries') return { statusCode: 200, ok: true, body: { id: '901' } }
            if (m === 'POST' && reqPath === '/dashboard_elements') return { statusCode: 200, ok: true, body: { id: '501' } }
            if (m === 'GET' && reqPath.includes('/dashboard_layouts')) {
              return { statusCode: 200, ok: true, body: [{ id: 'lay_77', dashboard_layout_components: [{ id: 'c_1', dashboard_element_id: '501' }] }] }
            }
            return { statusCode: 200, ok: true, body: { id: '1', path: body?.path || 'dashboards/pulse.dashboard.lookml' } }
          },
        },
      },
    })

    const badUddOut = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode(`return upsert_udd(
    "Commerce Overview",
    folder_id="5",
    filters=[{"name": "bad_flt", "dimension": "order_items.excluded_filter"}],
    tiles=[
        {"title": "KPI 1", "fields": ["order_items.excluded_brand_count"], "vis_config": {"type": "single_value"}},
        {"title": "Trend", "fields": ["order_items.created_date", "order_items.count"], "pivots": ["products.unknown_pivot"], "sorts": ["order_items.unknown_sort desc"]},
    ]
)`),
      sdk: mockDashSdk,
      vars: { target_model: 'ecom', target_explore: 'order_items', target_folder_id: '5' },
    })
    expect(exploreHits).toBe(1)
    expect(badUddOut).toContain('ValueError')
    for (const badTok of ['order_items.excluded_filter', 'order_items.excluded_brand_count', 'products.unknown_pivot', 'order_items.unknown_sort', 'order_items.total_sale_price', 'order_items.created_date']) {
      expect(badUddOut).toContain(badTok)
    }

    const emptyTileOut = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode('return upsert_udd("Empty Tile", folder_id="5", tiles=[{"title": "Broken KPI", "fields": [], "vis_config": {"type": "single_value"}}])'),
      sdk: mockDashSdk,
      vars: { target_model: 'ecom', target_explore: 'order_items' },
    })
    expect(emptyTileOut).toContain('ValueError')
    expect(emptyTileOut).toContain('empty fields=[]')

    validationErrors = [
      {
        severity: 'warning',
        file_path: 'dashboards/ecommerce_overview.dashboard.lookml',
        message: 'Unknown field "order_items.brand_count" referenced in dashboard element',
      },
    ]
    const warnLookmlDashOut = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode(`return upsert_lookml_dashboard(
    project_id="ecom_proj",
    model="ecom",
    dashboard_name="ecommerce_overview",
    title="Overview",
    tiles=[{"title": "Orders", "explore": "order_items", "fields": ["order_items.count"], "vis_config": {"type": "single_value"}}]
)`),
      sdk: mockDashSdk,
      vars: { target_model: 'ecom', target_explore: 'order_items', target_project_id: 'ecom_proj' },
    })
    expect(warnLookmlDashOut).toContain('ValueError')
    expect(warnLookmlDashOut).toContain('[warning]')
    expect(warnLookmlDashOut).toContain('Unknown field')

    validationErrors = []
    const okLookmlDashOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: wrapDashboardCodeMode(`return upsert_lookml_dashboard(
    project_id="ecom_proj",
    model="ecom",
    dashboard_name="ecommerce_overview",
    title="Overview",
    folder_id="5",
    tiles=[{"title": "Orders", "explore": "order_items", "fields": ["order_items.count"], "sorts": ["order_items.count desc"], "vis_config": {"type": "single_value"}}]
)`),
        sdk: mockDashSdk,
        vars: { target_model: 'ecom', target_explore: 'order_items', target_project_id: 'ecom_proj', target_folder_id: '5' },
      })
    )
    expect((okLookmlDashOut.result || okLookmlDashOut).lookml_dashboard_id).toBe('ecom::ecommerce_overview')

    // 2. Single-table Bronze refinement, no ALL_FIELDS* exclusions on _base, and clean dashboard summary rules
    for (const doc of [LOOKER_PROJECT_ONBOARDING_SKILL_MD, LOOKER_DASHBOARD_SKILL_MD]) {
      expect(doc).toContain('single-table')
      expect(doc).toContain('ALL_FIELDS*')
    }
    const onboardingNativeGuide = buildNativeContentGuide({
      selectedExplores: [],
      primaryModel: 'ecom_proj',
      primaryExplore: 'order_items',
      folderId: '5',
      lookmlProjectId: 'ecom_proj',
    })
    for (const summaryDoc of [LOOKER_DASHBOARD_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, NATIVE_CONTENT_GUIDE_MD, onboardingNativeGuide]) {
      for (const forbiddenReplyTok of ['Row 0', '24-Column Grid', 'single_value', 'looker_area', 'looker_pie', 'looker_column', 'looker_bar', 'looker_grid']) {
        expect(summaryDoc).toContain(forbiddenReplyTok)
      }
      expect(summaryDoc).toContain('[Open <Dashboard Title>](/dashboards/<id>)')
    }

    // 3. BUNDLE_APP_PY static *_day rejection (allowing _day_of_week/_day_of_month/_day_of_year/_hour_of_day & date: 90)
    const repoRoot = path.resolve(__dirname, '../..')
    const workDir = mkdtempSync(path.join(tmpdir(), 'dab-167-test-'))
    try {
      const bundlePyPath = path.join(workDir, 'bundle_app.py')
      writeFileSync(
        bundlePyPath,
        BUNDLE_APP_PY.replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`),
        'utf8'
      )
      for (const badBody of [
        "fields: ['orders.created_day', 'orders.count']",
        'fields: [`${m.dateBase}_day`, m.field]',
        'const PERIOD_DEFAULTS = { day: 90, week: 53 }; const f = `${m.dateBase}_${this.period}`',
      ]) {
        const badSrc = `import { DataApp, html } from '/runtime/data-app.js';
export class BadApp extends DataApp {
  constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; }
  render() { const m = { dateBase: 'orders.created', field: 'orders.count' }; ${badBody}; return html\`<app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; }
}
customElements.define('bad-app', BadApp);`
        expect(() =>
          execFileSync('python3', [bundlePyPath, '--stdin', 'Bad App', path.join(workDir, 'bad.js')], {
            input: badSrc,
            env: { ...process.env, TOOLKIT_DIR: path.join(repoRoot, 'upstream/payload') },
            encoding: 'utf8',
            stdio: 'pipe',
          })
        ).toThrow(/invalid-lookml-day-timeframe/)
      }

      const goodSrc = `import { DataApp, html } from '/runtime/data-app.js';
const PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 };
const WINDOW_OPTIONS = { date: [14, 30, 60, 90, 180], week: [12, 26, 53, 104], month: [6, 12, 24, 60], year: [3, 5, 10] };
const UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' };
export class GoodApp extends DataApp {
  constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; this.periodCount = PERIOD_DEFAULTS.date; }
  render() {
    const m = { dateBase: 'orders.created', field: 'orders.count' };
    const dateDim = \`\${m.dateBase}_\${this.period}\`;
    return html\`
      <app-chart type="areaspline" .query=\${{ fields: [dateDim, m.field], limit: String(WINDOW_OPTIONS[this.period][3]) }}></app-chart>
      <app-grid .query=\${{ fields: ['orders.created_day_of_week', 'orders.created_day_of_month', 'orders.created_day_of_year', 'orders.created_hour_of_day', m.field], filters: { 'orders.created_date': \`\${this.periodCount} \${UNITS[this.period]}\` } }}></app-grid>
    \`;
  }
}
customElements.define('good-app', GoodApp);`
      const goodOut = execFileSync('python3', [bundlePyPath, '--stdin', 'Good App', path.join(workDir, 'good.js')], {
        input: goodSrc,
        env: { ...process.env, TOOLKIT_DIR: path.join(repoRoot, 'upstream/payload') },
        encoding: 'utf8',
      })
      expect(goodOut).toContain('<DATA_APP_BUNDLE>')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
