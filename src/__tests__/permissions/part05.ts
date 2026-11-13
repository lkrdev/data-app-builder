import React from 'react'

import type { Looker40SDK } from '@looker/sdk'

import {
  authenticateGoogleOAuth, callInteractionsApi, clearStoredOAuthSession, computeIsAuthenticated,
  getInitialStoredOAuthToken, loadStoredOAuthSession, loginWithGoogleOAuth, persistOAuthSession,
  resolveLookerOAuthRedirectUri, resolveLookerOAuthRedirectUris, STUDIO_OAUTH_STORAGE_KEY,
} from '../../antigravity'
import {
  DOC_UI_COMPONENTS, renderUseCaseGuideMarkdown, USE_CASE_GUIDE_ORDER, USE_CASE_GUIDES,
} from '../../components/StudioWorkspace'
import {
  archiveUserConversation, buildRootLookerFolders, clearArtifactServiceCache, clearLookerMetadataCache,
  deleteUserConversation, fetchFolderChildren, fetchFolderWithAncestors, fetchInitialLookerMetadata,
  loadUserConversations, resolveConversationRelatedContent, saveUserArtifact, saveUserConversation,
  searchLookerFolders,
} from '../../lookerApi'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart05Tests(): void {
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

}
