import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AGENTS_MD, APP_BUILDER_SYSTEM_PROMPT, buildWorkspaceSources, callInteractionsApi,
  clampLeftPaneWidth, DATA_INVESTIGATOR_GUIDE_MD, DEFAULT_LEFT_PANE_WIDTH, extractInteractionActivitySteps,
  extractNativeContentFromInteraction, formatFriendlyLookerActivityLabel, formatThinkingTraceMarkdown, KDA_SKILL_MD,
  KDA_TOOLKIT_PY, LkrCodeMode, loadStoredLeftPaneWidth, loadStoredOAuthSession,
  loadStoredRightPaneCollapsed, loginWithGoogleOAuth, LOOKER_PROJECT_ONBOARDING_SKILL_MD, LOOKML_SKILLS_CATALOG,
  MAX_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH, refreshOAuthSessionIfNeeded, resolveBuiltinWorkspaceFileContent,
  runAntigravityTurn, SANDBOX_AGENT_SKILL_FILES, SANDBOX_WORKSPACE_SKILL_FILES, saveStoredLeftPaneWidth,
  saveStoredRightPaneCollapsed, STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY, STUDIO_OAUTH_REFRESH_INTERVAL_MS, STUDIO_OAUTH_REFRESH_LOCK_KEY,
  STUDIO_OAUTH_STORAGE_KEY, STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY,
} from '../../antigravity'
import {
  ARTIFACT_NAMESPACE, ArtifactService, classifyStudioUseCase, clearArtifactServiceCache,
  clearLookerMetadataCache, createDeduplicatedLookerSdkProxy, DEFAULT_BUSY_SEND_ACTION, deleteUserConversation,
  extractResolvedUseCase, fetchInitialLookerMetadata, getArtifactNamespace, getArtifactService,
  isConversationalNoOpPrompt, loadStoredBusySendAction, loadStoredSelectedFolderId, matchExplicitUseCaseRule,
  normalizeArtifactNamespace, normalizeBusySendAction, normalizeStudioContentItem, persistSelectedFolderId,
  readInitialSelectedFolderId, resolveConversationRelatedContent, saveStoredBusySendAction, saveUserConversation,
  searchLookerFolders, shouldRouteToIsolatedCaSubagent, STUDIO_BUSY_SEND_ACTION_STORAGE_KEY, STUDIO_FOLDER_STORAGE_KEY,
  SWR_DEDUPED_METHODS, upsertStudioContentItem,
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

export function registerPermissionsPart09Tests(): void {
  test('34. Issue #109: seeds skills/key-driver-analysis, expands investigate/find-out and tile/no-op routing, prevents false-positive Native dashboard #5 extraction, and preserves requires_action steps in activitySteps', async () => {
    // 1. Verify KDA_SKILL_MD + KDA_TOOLKIT_PY seeding and AGENTS.md / AGENTS_MD references
    const repoRoot = path.resolve(__dirname, '../../..')
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

    const repoRoot = path.resolve(__dirname, '../../..')
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
    expect(apiLabel).toEqual({ statusText: 'Inspecting Users explore schema...', stepTitle: 'Inspecting Users explore schema...', targetLabel: 'Users', isQuery: false })
    const genericQueryLabel = formatFriendlyLookerActivityLabel(`sdk.run_sql_query("slug_123", "json")`)
    expect(genericQueryLabel).toMatchObject({ statusText: 'Executing Looker queries...', isQuery: true })
    const genericApiLabel = formatFriendlyLookerActivityLabel(`sdk.all_lookml_models()`)
    expect(genericApiLabel).toMatchObject({ statusText: 'Listing accessible LookML models & explores...', stepTitle: 'Listing accessible LookML models & explores...', isQuery: false })
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

    const readme = readFileSync(path.resolve(__dirname, '../../../README.md'), 'utf8')
    expect(readme).toContain('## Skilled Use Cases')
    for (const label of ['**Data Apps**:', '**Data Investigator**:', '**Content Studio**:', '**Conversational Analytics**:', '**Agentic LookML**:', '**3-Pillar Health Check**:', '**Script / Python Tile**:']) {
      expect(readme).toContain(label)
    }
  })

  test('52. Issue #127: enforces raw_api_request: yes with zero core_api_methods in manifest.lkml & .githooks/pre-commit, routes core40SDK and LkrCodeMode calls through transport.rawRequest, and registers skills/looker-project-onboarding/SKILL.md', async () => {
    clearLookerMetadataCache()
    const repoRoot = path.resolve(__dirname, '../../..')
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
    for (const doc of [APP_BUILDER_SYSTEM_PROMPT, readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')]) {
      expect(doc).toContain('skills/looker-project-onboarding/SKILL.md')
    }
    for (const token of ['Step 1:', 'Step 2:', 'Step 3:', 'Step 4:', '/admin/connections', "re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')", '/sql', '5 × 5', 'create_project', 'create_lookml_model', '1.0 * ${numerator_measure} / NULLIF(${denominator_measure}, 0)', 'grain_change_reagg']) {
      expect(skillDisk).toContain(token)
      expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain(token)
    }
    const wsSources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    const bundledEntries = Object.entries(SANDBOX_AGENT_SKILL_FILES)
    expect(bundledEntries.length).toBe(136)
    for (const [relPath, bundledContent] of bundledEntries) {
      expect(relPath).not.toMatch(/^(data-apps-sync|issue-authoring|studio-conversation-debugger|studio-design-system)\//)
      const diskContent = readFileSync(path.join(repoRoot, '.agents/skills', relPath), 'utf8')
      expect(bundledContent).toBe(diskContent)
      expect(wsSources.find((s) => s.target === `/workspace/skills/${relPath}`)?.content).toBe(diskContent)
      expect(resolveBuiltinWorkspaceFileContent(`/workspace/skills/${relPath}`)).toBe(diskContent)
      expect(diskContent).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    }
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    expect(KDA_SKILL_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
  })

}
