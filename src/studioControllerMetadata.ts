import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ILookmlModelNavExplore } from '@looker/sdk'
import useSWR from 'swr'

import {
  AntigravityActivityStep, buildDynamicStarterPrompts, discoverStarterExploreContext,
  generateDynamicStarterPrompts, getCachedStarterPrompts, normalizeEnvironmentId, PastedImage,
  pruneDeadEnvironmentConversations, resolveTargetExploreFromModels, StarterPromptItem,
} from './antigravity'
import { ChatMessage } from './components/App'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import { HealthCheckReportPayload } from './healthCheck'
import type { LkrCodeModeRunOptions } from './lkrCliBridge'
import {
  type AlertInspectorBundle, buildAvailableExploresCatalog, buildDenseExploreSchema, buildRootLookerFolders,
  CaConversationState, ConversationRecord, DEFAULT_STUDIO_AGENT_NAME, fetchFolderChildren, fetchFolderWithAncestors,
  fetchInitialLookerMetadata, fetchPreloadedContentSummary, getArtifactNamespace,
  getArtifactService, listLocalDraftScripts, loadStoredSelectedFolderId,
  loadUserEnvironmentState, LookerFolderNode, NativeContentState, normalizeStudioAgentName,
  parseExploreId, persistSelectedFolderId, PublishedAppState, readInitialSelectedFolderId,
  SavedScript, searchLookerFolders, SearchLookerFoldersParams,
  STUDIO_OVERVIEW_TAB_KEY, StudioContentItem, StudioContentItemType, StudioContextMention,
  upsertStudioContentItem,
  UserArtifactIndex, UserConversationEntry,
} from './lookerApi'
import { LookmlBundle } from './lookmlTool'
import { getErrorMessage, normalizeCatalogMode, StudioAuthAndPrefs } from './studioControllerAuth'

export interface StudioViewerDocument {
  path: string; displayPath: string; title: string; kind: 'skill' | 'file'; isMarkdown: boolean; content: string; loading?: boolean
}

export function useStudioMetadata(auth: StudioAuthAndPrefs) {
  const {
    extensionSDK, core40SDK, history, location, isTileMount, mockExt, disabledModes,
    setAgentName, setAppInitializing, setCapabilities, pushToast, setExpiredConversationNotice,
    parsedRoute, availableModels,
    oauthAccessToken, oauthTokenRef, clientId, projectId, apiKey, selectedModel, triggerSilentOAuthRefresh,
    sharedEnvIdRef, syncSharedEnvironmentId, agentSession, messages,
    capabilities,
  } = auth

  const [userId, setUserId] = useState('1')
  const userIdRef = useRef<string>('1')
  const [userDisplayName, setUserDisplayName] = useState('')
  const [lookerWorkspaceId, setLookerWorkspaceId] = useState<'dev' | 'production'>(() =>
    mockExt?.initialLookerWorkspaceId === 'dev' ? 'dev' : 'production'
  )
  const isLookerDevMode = lookerWorkspaceId === 'dev'

  const lastSessionSyncAtRef = useRef<number>(0)
  const syncLookerSessionWorkspace = useCallback(async (force = false) => {
    const s = core40SDK as unknown as { session?: () => Promise<{ workspace_id?: string | null }>; ok?: <T>(p: Promise<T> | T) => Promise<T> }
    if (typeof s?.session !== 'function') return
    const now = Date.now()
    if (!force && now - lastSessionSyncAtRef.current < 15_000) return
    lastSessionSyncAtRef.current = now
    try {
      const sess = typeof s.ok === 'function' ? await s.ok(s.session()) : await s.session()
      if (sess?.workspace_id === 'dev' || sess?.workspace_id === 'production') setLookerWorkspaceId(sess.workspace_id)
    } catch { /* ignore */ }
  }, [core40SDK])

  const handleToggleLookerDevMode = useCallback(
    async (targetWorkspace?: 'dev' | 'production') => {
      const nextWorkspace: 'dev' | 'production' =
        targetWorkspace === 'dev' || targetWorkspace === 'production' ? targetWorkspace : lookerWorkspaceId === 'dev' ? 'production' : 'dev'
      setLookerWorkspaceId(nextWorkspace)
      const s = core40SDK as unknown as { update_session?: (body: { workspace_id: string }) => Promise<{ workspace_id?: string | null }>; ok?: <T>(p: Promise<T> | T) => Promise<T> }
      if (typeof s?.update_session === 'function') {
        try {
          const res = typeof s.ok === 'function' ? await s.ok(s.update_session({ workspace_id: nextWorkspace })) : await s.update_session({ workspace_id: nextWorkspace })
          if (res?.workspace_id === 'dev' || res?.workspace_id === 'production') setLookerWorkspaceId(res.workspace_id)
        } catch { /* ignore */ }
      }
      return nextWorkspace
    },
    [core40SDK, lookerWorkspaceId]
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return
    const onFocus = () => { void syncLookerSessionWorkspace(false) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [syncLookerSessionWorkspace])

  const [allModels, setAllModels] = useState<Array<{ name: string; label: string; project_name?: string; explores: ILookmlModelNavExplore[] }>>([])
  const [loadingMetadata, setLoadingMetadata] = useState<boolean>(() => Boolean(mockExt?.forceFolderSkeleton ?? true))
  const [folderTreeNodes, setFolderTreeNodes] = useState<Record<string, LookerFolderNode>>(() =>
    Object.fromEntries(buildRootLookerFolders().map((r) => [r.id, r]))
  )
  const [rootFolderIds, setRootFolderIds] = useState<string[]>(() => buildRootLookerFolders().map((r) => r.id))
  const rootFolderIdsRef = useRef<string[]>(rootFolderIds)
  rootFolderIdsRef.current = rootFolderIds
  const [folderChildrenById, setFolderChildrenById] = useState<Record<string, string[]>>({})
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([])
  const [loadingFolderIds, setLoadingFolderIds] = useState<string[]>([])
  const [selectedExplores, setSelectedExplores] = useState<string[]>([])
  const [preloadedContent, setPreloadedContent] = useState<StudioContextMention[]>([])
  const [mentionedItems, setMentionedItems] = useState<StudioContextMention[]>([])
  const [selectedFolderId, setSelectedFolderIdState] = useState<string>(() =>
    String(mockExt?.initialSelectedFolderId || readInitialSelectedFolderId() || '1')
  )
  const hasExplicitFolderRef = useRef<boolean>(Boolean(mockExt?.initialSelectedFolderId || readInitialSelectedFolderId()))
  const setSelectedFolderId = useCallback(
    (next: string | ((prev: string) => string)) => {
      hasExplicitFolderRef.current = true
      setSelectedFolderIdState((prev) => {
        const resolved = String(typeof next === 'function' ? next(prev) : next).trim() || '1'
        persistSelectedFolderId(extensionSDK, resolved)
        return resolved
      })
    },
    [extensionSDK]
  )

  useEffect(() => {
    if (mockExt?.initialSelectedFolderId) return
    let mounted = true
    void loadStoredSelectedFolderId(extensionSDK).then((stored) => {
      if (mounted && stored) { hasExplicitFolderRef.current = true; setSelectedFolderIdState(stored) }
    })
    return () => { mounted = false }
  }, [extensionSDK, mockExt?.initialSelectedFolderId])

  const [schemaMarkdown, setSchemaMarkdown] = useState('')
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [starterPrompts, setStarterPrompts] = useState<StarterPromptItem[]>([])
  const [starterPromptsLoading, setStarterPromptsLoading] = useState<boolean>(() => Boolean(mockExt?.forceStarterPromptsSkeleton ?? true))

  const [activeObjectId, setActiveObjectId] = useState('')
  const optimisticConvsRef = useRef<UserConversationEntry[]>([])
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [healthScope, setHealthScope] = useState<'all' | 'looker' | 'bq'>('all')

  const artifactNamespace = getArtifactNamespace(extensionSDK)
  const artifactService = useMemo(() => getArtifactService(core40SDK, artifactNamespace), [core40SDK, artifactNamespace])
  const { data: swrUserArtifacts } = useSWR<UserArtifactIndex[]>(
    !isTileMount && !loadingMetadata && userId ? ['artifact:user_list', artifactNamespace, userId, 'all'] : null,
    () => artifactService.listUserArtifacts(userId),
    { revalidateOnFocus: false }
  )
  const catalogItems = useMemo(() => swrUserArtifacts ?? [], [swrUserArtifacts])
  const { data: swrConversations, mutate: mutateConversations } = useSWR<UserConversationEntry[]>(
    !isTileMount && userId ? ['artifact:conversations', artifactNamespace, userId] : null,
    () => artifactService.listConversations(userId),
    { revalidateOnFocus: false }
  )
  const [optimisticVersion, bumpOptimisticConvs] = useState(0)
  const conversations = useMemo<UserConversationEntry[]>(() => {
    void optimisticVersion
    const base = swrConversations ?? []
    if (optimisticConvsRef.current.length === 0) return base
    const baseIds = new Set(base.map((c) => c.id))
    optimisticConvsRef.current = optimisticConvsRef.current.filter((c) => !baseIds.has(c.id))
    return optimisticConvsRef.current.length > 0 ? [...optimisticConvsRef.current, ...base] : base
  }, [optimisticVersion, swrConversations])
  const conversationsRef = useRef<UserConversationEntry[]>(conversations)
  conversationsRef.current = conversations

  const setConversations = useCallback(
    (
      next: UserConversationEntry[] | ((prev: UserConversationEntry[]) => UserConversationEntry[]),
      opts?: { optimisticEntry?: UserConversationEntry | null }
    ) => {
      const resolved = typeof next === 'function' ? next(conversationsRef.current) : next
      const resolvedIds = new Set(resolved.map((c) => c.id))
      optimisticConvsRef.current = optimisticConvsRef.current
        .filter((c) => resolvedIds.has(c.id))
        .map((c) => resolved.find((r) => r.id === c.id) || c)
      if (opts?.optimisticEntry && !optimisticConvsRef.current.some((c) => c.id === opts.optimisticEntry!.id)) {
        optimisticConvsRef.current = [opts.optimisticEntry, ...optimisticConvsRef.current]
      }
      conversationsRef.current = resolved
      bumpOptimisticConvs((v) => v + 1)
      void mutateConversations(resolved, { revalidate: false })
    },
    [mutateConversations]
  )

  const handleSaveAgentName = useCallback(
    async (nextName: string): Promise<string> => {
      const normalized = normalizeStudioAgentName(nextName)
      setAgentName(normalized)
      try { await artifactService.saveUserConfig(userIdRef.current || userId, { agentName: normalized }) } catch { /* ignore */ }
      return normalized
    },
    [artifactService, setAgentName, userId]
  )

  const models = useMemo(() => {
    if (capabilities.rolesLoaded && !capabilities.explorableModels.has('*')) {
      return allModels.filter((m) => capabilities.explorableModels.has(m.name))
    }
    return allModels
  }, [allModels, capabilities.rolesLoaded, capabilities.explorableModels])

  const availableLookmlProjects = useMemo(
    () => Array.from(capabilities.developableProjects).filter((p) => p && p !== '*').sort(),
    [capabilities.developableProjects]
  )
  const canDevelopLookml = useMemo(
    () => !disabledModes.includes('lookml') && (!capabilities.rolesLoaded || (capabilities.tools.lookml.enabled && !capabilities.tools.lookml.readOnly)),
    [capabilities, disabledModes]
  )
  const canDeployLookml = useMemo(
    () => !capabilities.rolesLoaded || capabilities.isAdmin || capabilities.globalPermissions.has('deploy') || capabilities.globalPermissions.has('admin'),
    [capabilities]
  )

  const loadFolderChildren = useCallback(
    async (fid: string, knownRootIds?: string[], markEmptyLeaf = false) => {
      const children = await fetchFolderChildren(core40SDK, fid)
      const activeRootIds = knownRootIds || rootFolderIdsRef.current
      const visibleChildren = children.filter((c) => !activeRootIds.includes(c.id))
      setFolderTreeNodes((prev) => {
        const next = { ...prev }
        for (const c of visibleChildren) next[c.id] = { ...next[c.id], ...c }
        if (markEmptyLeaf && next[fid] && visibleChildren.length === 0) next[fid] = { ...next[fid], child_count: 0, has_children: false }
        return next
      })
      if (visibleChildren.length > 0 || markEmptyLeaf) {
        setFolderChildrenById((prev) => {
          const existing = prev[fid] || []
          const merged = Array.from(new Set([...visibleChildren.map((c) => c.id), ...existing])).filter((id) => !activeRootIds.includes(id))
          return { ...prev, [fid]: merged }
        })
      }
    },
    [core40SDK]
  )

  const hydrateFolderAncestors = useCallback(
    async (targetFolderId: string, knownRootIds?: string[]) => {
      const fid = String(targetFolderId || '').trim()
      if (!fid) return
      const activeRootIds = knownRootIds || rootFolderIdsRef.current
      try {
        const res = await fetchFolderWithAncestors(core40SDK, fid)
        if (!res.folder && res.ancestors.length === 0) return
        let anchorIdx = res.chain.length - 1
        while (anchorIdx >= 0 && !activeRootIds.includes(res.chain[anchorIdx].id)) anchorIdx -= 1
        const effectiveChain = anchorIdx >= 0 ? res.chain.slice(anchorIdx) : res.chain
        const effectiveAncestors = effectiveChain.slice(0, -1)
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const node of effectiveChain) {
            const existing = next[node.id]
            next[node.id] = {
              ...existing, ...node,
              name: existing?.is_personal && existing.name === 'My folder' ? existing.name : node.name,
              parent_id: activeRootIds.includes(node.id) ? null : node.parent_id,
            }
          }
          return next
        })
        if (effectiveChain.length > 0) {
          const topRootId = effectiveChain[0].id
          setRootFolderIds((prev) => (prev.includes(topRootId) ? prev : [topRootId, ...prev]))
        }
        if (effectiveChain.length > 1) {
          setFolderChildrenById((prev) => {
            const next = { ...prev }
            for (let i = 0; i < effectiveChain.length - 1; i += 1) {
              const parentId = effectiveChain[i].id
              const childId = effectiveChain[i + 1].id
              if (activeRootIds.includes(childId)) continue
              const cur = next[parentId] || []
              if (!cur.includes(childId)) next[parentId] = [...cur, childId]
            }
            return next
          })
          setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...effectiveAncestors.map((a) => a.id)])))
          for (const anc of effectiveAncestors) void loadFolderChildren(anc.id, activeRootIds).catch(() => {})
        }
      } catch { /* ignore */ }
    },
    [core40SDK, loadFolderChildren]
  )

  const toggleExpandFolder = useCallback(
    async (folderId: string) => {
      const fid = String(folderId || '').trim()
      if (!fid) return
      const isCurrentlyExpanded = expandedFolderIds.includes(fid)
      setExpandedFolderIds((prev) => (prev.includes(fid) ? prev.filter((id) => id !== fid) : [...prev, fid]))
      if (isCurrentlyExpanded || folderChildrenById[fid]?.length) return
      setLoadingFolderIds((prev) => (prev.includes(fid) ? prev : [...prev, fid]))
      try { await loadFolderChildren(fid, undefined, true) } catch { /* ignore */ } finally {
        setLoadingFolderIds((prev) => prev.filter((id) => id !== fid))
      }
    },
    [expandedFolderIds, folderChildrenById, loadFolderChildren]
  )

  const handleSearchFolders = useCallback(
    async (params: SearchLookerFoldersParams): Promise<LookerFolderNode[]> => {
      const results = await searchLookerFolders(core40SDK, {
        knownFolders: folderTreeNodes,
        knownUsers: userDisplayName ? [{ id: userId, display_name: userDisplayName }] : undefined,
        ...params,
      })
      if (results.length > 0) {
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const r of results) next[r.id] = { ...next[r.id], ...r }
          return next
        })
      }
      return results
    },
    [core40SDK, folderTreeNodes, userDisplayName, userId]
  )

  useEffect(() => {
    if (selectedFolderId) void hydrateFolderAncestors(selectedFolderId)
  }, [selectedFolderId, hydrateFolderAncestors])

  const initialRouteRef = useRef({ pathname: location.pathname, convId: parsedRoute.conversationId, objId: parsedRoute.objectId })
  useEffect(() => {
    let mounted = true
    Promise.all([fetchInitialLookerMetadata(core40SDK), loadStoredSelectedFolderId(extensionSDK)])
      .then(async ([meta, asyncStoredFolderId]) => {
        if (!mounted) return
        const resolvedUserId = String(meta.user?.id || '1')
        userIdRef.current = resolvedUserId
        setUserId(resolvedUserId)
        setUserDisplayName(String(meta.user?.display_name || ''))
        lastSessionSyncAtRef.current = Date.now()
        if (meta.workspaceId === 'dev' || meta.workspaceId === 'production') setLookerWorkspaceId(meta.workspaceId)
        setCapabilities(meta.capabilities)
        if (meta.capabilities.rolesLoaded && meta.capabilities.sqlRunnerConnections.size === 0) {
          setHealthScope((prev) => (prev === 'all' || prev === 'bq' ? 'looker' : prev))
        }
        const extMock = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        const ns = getArtifactNamespace(extensionSDK)
        const [cfg, envState, rawConvs] = await Promise.all([
          artifactService.getUserConfig(resolvedUserId).catch(() => null),
          loadUserEnvironmentState(core40SDK, resolvedUserId, ns).catch(() => null),
          artifactService.listConversations(resolvedUserId).catch(() => [] as UserConversationEntry[]),
        ])
        const resolvedEnvId = normalizeEnvironmentId(envState?.environmentId)
        let loadedConvs = rawConvs
        if (resolvedEnvId) {
          const expiredIds = await pruneDeadEnvironmentConversations({
            sdk: core40SDK,
            extensionSDK,
            userId: resolvedUserId,
            namespace: ns,
            activeEnvironmentId: resolvedEnvId,
            conversations: rawConvs,
          })
          if (expiredIds.length > 0) {
            const expiredSet = new Set(expiredIds)
            loadedConvs = rawConvs.filter((c) => !expiredSet.has(c.id))
            const init = initialRouteRef.current
            const initSeg = decodeURIComponent(init.pathname.replace(/^\/c\//, '').replace(/^\/+|\/+$/g, ''))
            const initTarget = init.convId || init.objId || initSeg
            if (mounted && initTarget && expiredSet.has(initTarget)) {
              setExpiredConversationNotice('This conversation expired because its sandbox environment was reset or expired.')
              if (init.pathname !== '/') history.replace('/')
            }
          }
        }
        if (mounted) {
          const hasStoredCustom = Boolean(cfg?.updatedAt || (cfg?.agentName && cfg.agentName !== DEFAULT_STUDIO_AGENT_NAME))
          setAgentName(hasStoredCustom ? normalizeStudioAgentName(cfg?.agentName) : normalizeStudioAgentName(extMock?.initialAgentName || cfg?.agentName))
          if (envState?.environmentId) syncSharedEnvironmentId(envState.environmentId, envState.sourcesHash ?? null)
          const loadedIds = new Set(loadedConvs.map((c) => c.id))
          const missingOpt = optimisticConvsRef.current.filter((c) => !loadedIds.has(c.id))
          const nextConvs = missingOpt.length > 0 ? [...missingOpt, ...loadedConvs] : loadedConvs
          conversationsRef.current = nextConvs
          void mutateConversations(nextConvs, { revalidate: false })
        }
        listLocalDraftScripts(extensionSDK).then((items) => { if (mounted) setSavedScripts(items) }).catch(() => {})
        setAllModels(
          meta.models.map((m) => ({
            name: String(m.name || ''), label: String(m.label || m.name || ''),
            project_name: m.project_name ? String(m.project_name) : undefined,
            explores: (m.explores || []).filter((e) => !e.hidden),
          }))
        )
        const rawFolders = (meta.folders || []) as LookerFolderNode[]
        const initialRootIds = rawFolders.map((f) => String(f.id))
        rootFolderIdsRef.current = initialRootIds
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const f of rawFolders) next[f.id] = { ...next[f.id], ...f }
          return next
        })
        setRootFolderIds(initialRootIds)
        const storedFolderId = asyncStoredFolderId || readInitialSelectedFolderId()
        const targetInitialFolder = extMock?.initialSelectedFolderId ? String(extMock.initialSelectedFolderId) : storedFolderId || meta.defaultFolderId
        setSelectedFolderIdState((prev) =>
          extMock?.initialSelectedFolderId ? String(extMock.initialSelectedFolderId) : storedFolderId || (hasExplicitFolderRef.current ? prev : meta.defaultFolderId)
        )
        if (!extMock?.forceFolderSkeleton) setLoadingMetadata(false)
        void hydrateFolderAncestors(targetInitialFolder, initialRootIds)
        void loadFolderChildren(targetInitialFolder, initialRootIds).catch(() => {})
        fetchPreloadedContentSummary(core40SDK).then((items) => { if (mounted) setPreloadedContent(items) }).catch(() => {})
      })
      .catch((err: unknown) => {
        if (!mounted) return
        const extMock = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        if (!extMock?.forceFolderSkeleton) setLoadingMetadata(false)
        pushToast({ tone: 'error', message: `Failed to load Looker models: ${getErrorMessage(err)}` })
      })
      .finally(() => {
        const extMock = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        if (mounted && !extMock?.forceAppInitializing) setAppInitializing(false)
      })
    return () => { mounted = false }
  }, [artifactService, core40SDK, extensionSDK, history, syncSharedEnvironmentId, hydrateFolderAncestors, loadFolderChildren, mutateConversations, pushToast, setAgentName, setAppInitializing, setCapabilities, setExpiredConversationNotice])

  useEffect(() => {
    let mounted = true
    if (selectedExplores.length === 0) {
      setSchemaMarkdown(buildAvailableExploresCatalog(models))
      setLoadingSchema(false)
      return
    }
    setLoadingSchema(true)
    Promise.all(
      selectedExplores.map(async (id) => {
        const parsed = parseExploreId(id)
        if (!parsed) return ''
        try { return await buildDenseExploreSchema(core40SDK, parsed.modelName, parsed.exploreName) }
        catch (err: unknown) { return `# Error loading explore \`${id}\`\n${getErrorMessage(err)}` }
      })
    )
      .then((sections) => { if (mounted) setSchemaMarkdown(sections.filter(Boolean).join('\n\n---\n\n')) })
      .finally(() => { if (mounted) setLoadingSchema(false) })
    return () => { mounted = false }
  }, [core40SDK, selectedExplores, models])

  useEffect(() => {
    let mounted = true
    const targetExplore = resolveTargetExploreFromModels(selectedExplores, models)
    const exploreKey = selectedExplores.length > 0 ? selectedExplores.join(',') : targetExplore?.exploreKey || 'none'
    const hasOAuth = Boolean(oauthAccessToken)
    const cached = getCachedStarterPrompts(exploreKey, canDevelopLookml, hasOAuth)
    if (cached && cached.length > 0 && !mockExt?.forceStarterPromptsSkeleton) {
      setStarterPrompts(cached); setStarterPromptsLoading(false); return () => { mounted = false }
    }
    if ((loadingMetadata && models.length === 0 && selectedExplores.length === 0) || mockExt?.forceStarterPromptsSkeleton) {
      setStarterPromptsLoading(true); return () => { mounted = false }
    }
    setStarterPrompts((prev) => { if (prev.length === 0) setStarterPromptsLoading(true); return prev })
    void (async () => {
      const exploreContext = await discoverStarterExploreContext({ sdk: core40SDK, selectedExplores, availableModels: models })
      if (!mounted) return
      const immediate = buildDynamicStarterPrompts({
        selectedExplores, canDevelopLookml, availableModels: models, exploreContext,
      })
      setStarterPrompts(immediate)
      setStarterPromptsLoading(false)
      if (hasOAuth) {
        const refined = await generateDynamicStarterPrompts({
          sdk: core40SDK, extensionSDK,
          auth: {
            mode: 'oauth', oauthToken: oauthTokenRef.current || oauthAccessToken, getOAuthToken: () => oauthTokenRef.current,
            clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true),
          },
          environmentId: sharedEnvIdRef.current || undefined, selectedExplores,
          canDevelopLookml, availableModels: models, exploreContext, model: selectedModel,
        })
        if (mounted && refined.length > 0) setStarterPrompts(refined)
      }
    })()
    return () => { mounted = false }
  }, [
    core40SDK, extensionSDK, selectedExplores, canDevelopLookml,
    models, availableModels, oauthAccessToken, oauthTokenRef, loadingMetadata, clientId,
    projectId, apiKey, selectedModel, sharedEnvIdRef, triggerSilentOAuthRefresh, mockExt?.forceStarterPromptsSkeleton,
  ])

  const [caConversation, setCaConversation] = useState<CaConversationState | null>(null)
  const lastCaIdRef = useRef<string>('')
  const [lookmlProjectId, setLookmlProjectId] = useState('')
  const [activatedLookmlSkills, setActivatedLookmlSkills] = useState<string[]>([])
  const [lookmlBundle, setLookmlBundle] = useState<LookmlBundle | null>(null)
  const lastLookmlIdRef = useRef<string>('')
  const [publishedApp, setPublishedAppState] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContentState] = useState<NativeContentState | null>(null)
  const [alertBundle, setAlertBundle] = useState<AlertInspectorBundle | null>(null)
  const [contentItems, setContentItemsState] = useState<StudioContentItem[]>([])
  const contentItemsRef = useRef<StudioContentItem[]>([])
  const [activeContentTabKey, setActiveContentTabKeyState] = useState<string>('')
  const activeContentTabKeyRef = useRef<string>('')
  const codeModePermOptsRef = useRef<
    (() => Pick<LkrCodeModeRunOptions, 'requirePermission' | 'approvedOperations' | 'onPermissionRequest' | 'thought' | 'signal'> & {
      isCanceled?: () => boolean
    }) | null
  >(null)

  const setContentItems = useCallback((next: StudioContentItem[] | ((prev: StudioContentItem[]) => StudioContentItem[])) => {
    const resolved = typeof next === 'function' ? next(contentItemsRef.current) : next
    contentItemsRef.current = resolved
    setContentItemsState(resolved)
  }, [])

  const setActiveContentTabKey = useCallback((nextKey: string) => {
    activeContentTabKeyRef.current = nextKey
    setActiveContentTabKeyState(nextKey)
  }, [])

  const upsertContentItem = useCallback(
    (rawItem: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType }, activate = true): StudioContentItem & { existed: boolean } => {
      const res = upsertStudioContentItem(contentItemsRef.current, rawItem)
      contentItemsRef.current = res.items
      setContentItemsState(res.items)
      if (activate || !activeContentTabKeyRef.current) {
        activeContentTabKeyRef.current = res.activeKey
        setActiveContentTabKeyState(res.activeKey)
      }
      return Object.assign({}, res.item, { existed: res.existed })
    },
    []
  )

  const applyStateWithSync = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, next: T | ((prev: T) => T), sync: (resolved: T) => void) => {
    if (typeof next !== 'function') { sync(next); setter(next); return }
    setter((prev) => { const r = (next as (p: T) => T)(prev); sync(r); return r })
  }

  const setPublishedApp = useCallback(
    (
      next: PublishedAppState | null | ((prev: PublishedAppState | null) => PublishedAppState | null),
      metaOpts?: { contentType?: 'data_app' | 'data-investigator'; source?: 'created' | 'modified' | 'mention'; createdInConversation?: boolean; hidden?: boolean }
    ) => {
      applyStateWithSync(setPublishedAppState, next, (resolved) => {
        if (resolved?.dashboardId) {
          const existingCt = contentItemsRef.current.find((it) => it.id === String(resolved.dashboardId) && (it.contentType === 'data_app' || it.contentType === 'data-investigator'))?.contentType
          const ct: 'data_app' | 'data-investigator' = metaOpts?.contentType || existingCt || 'data_app'
          upsertContentItem({
            id: String(resolved.dashboardId), dashboardId: String(resolved.dashboardId),
            contentType: ct,
            title: resolved.title, embedPath: `/embed/dashboards/${encodeURIComponent(String(resolved.dashboardId))}`,
            folderId: resolved.folderId, extensionId: resolved.extensionId,
            source: metaOpts?.source, createdInConversation: metaOpts?.createdInConversation, hidden: metaOpts?.hidden,
          })
        }
      })
    },
    [upsertContentItem]
  )

  const setNativeContent = useCallback(
    (
      next: NativeContentState | null | ((prev: NativeContentState | null) => NativeContentState | null),
      metaOpts?: { source?: 'created' | 'modified' | 'mention'; createdInConversation?: boolean; hidden?: boolean }
    ) => {
      applyStateWithSync(setNativeContentState, next, (resolved) => {
        if (resolved?.id) {
          const ct = (resolved.contentType || 'dashboard') as StudioContentItemType
          upsertContentItem({
            id: String(resolved.id), contentType: ct, title: resolved.title, embedPath: resolved.embedPath, folderId: resolved.folderId,
            dashboardId: ct === 'dashboard' ? String(resolved.id) : undefined,
            lookId: resolved.lookId || (ct === 'look' ? String(resolved.id) : undefined),
            lookmlDashboardId: resolved.lookmlDashboardId || (ct === 'lookml_dashboard' ? String(resolved.id) : undefined),
            ...metaOpts,
          })
        }
      })
    },
    [upsertContentItem]
  )

  const activeContentItem = useMemo<StudioContentItem | null>(() => {
    if (activeContentTabKey === STUDIO_OVERVIEW_TAB_KEY) return null
    const visible = contentItems.filter((it) => !it.hidden)
    return visible.length === 0 ? null : visible.find((it) => it.key === activeContentTabKey) || visible[visible.length - 1] || null
  }, [contentItems, activeContentTabKey])

  const [embedNonce, setEmbedNonce] = useState<number>(0)
  const bumpEmbedNonce = useCallback(() => setEmbedNonce((n) => n + 1), [])
  const lastPublishedIdRef = useRef<string>('')
  const lastNativeIdRef = useRef<string>('')
  const [healthReport, setHealthReport] = useState<HealthCheckReportPayload | null>(null)
  const lastHealthIdRef = useRef<string>('')
  const [scriptId, setScriptId] = useState(() => parsedRoute.objectId || 'demo1')
  const [scriptTitle, setScriptTitle] = useState('Looker Explore & Filter Summary')
  const [scriptCode, setScriptCode] = useState(DEFAULT_PYTHON_SCRIPT)
  const [filtersJson, setFiltersJson] = useState('{}')
  const [scriptOutput, setScriptOutput] = useState('')
  const [scriptMode, setScriptMode] = useState('summary')
  const [publishedTileDash, setPublishedTileDash] = useState<{ dashboardId: string; elementId: string } | null>(null)
  const [schedulerOpen, setSchedulerOpen] = useState(() => Boolean(mockExt?.openSchedulerModal))
  const [capabilitiesModalOpen, setCapabilitiesModalOpen] = useState(() => Boolean(mockExt?.initialCapabilitiesModalOpen))
  const [scheduleConfig, setScheduleConfig] = useState<{
    name: string; cron: string; mode: string; customVarsJson: string
    destination: 'artifact_snapshot' | 'webhook' | 'looker_scheduled_plan'; targetUrlOrEmail: string; enabled: boolean
  }>({
    name: 'Daily Morning Explore & Filter Snapshot', cron: '0 8 * * *', mode: 'summary',
    customVarsJson: '{"region":"AMER","threshold":0.95}', destination: 'artifact_snapshot',
    targetUrlOrEmail: 'https://hooks.example.com/looker-script-webhook', enabled: true,
  })
  const [savedScheduleBadge, setSavedScheduleBadge] = useState<string | null>('0 8 * * * · summary')
  const [loadedScript, setLoadedScript] = useState(false)
  const lastScriptIdRef = useRef<string>('')
  const [currentAppCode, setCurrentAppCode] = useState('')
  const [activeViewerDocument, setActiveViewerDocument] = useState<StudioViewerDocument | null>(null)
  const [prompt, setPrompt] = useState(() => String(mockExt?.initialPrompt || ''))
  const [pastedImages, setPastedImages] = useState<PastedImage[]>(() => (mockExt?.initialPastedImages as PastedImage[] | undefined) || [])
  const [showArchivedConversations, setShowArchivedConversations] = useState<boolean>(() => Boolean(mockExt?.initialShowArchived))
  const [pendingDeleteConv, setPendingDeleteConv] = useState<ConversationRecord | null>(() => (mockExt?.initialPendingDeleteConv as ConversationRecord | undefined) || null)
  const [deleteRelatedContent, setDeleteRelatedContent] = useState<boolean>(() => Boolean(mockExt?.initialDeleteRelatedContent))
  const hydratedConvRouteRef = useRef<string>('')
  const activityStepsByInteractionIdRef = useRef<Record<string, AntigravityActivityStep[]>>({})
  const mergeCachedActivitySteps = useCallback((msgs: ChatMessage[]): ChatMessage[] =>
    msgs.map((m) =>
      m.role === 'assistant' && !m.activitySteps?.length && m.interactionId && activityStepsByInteractionIdRef.current[m.interactionId]?.length
        ? { ...m, activitySteps: activityStepsByInteractionIdRef.current[m.interactionId] }
        : m
    ), [])

  const modeAllowedConversations = useMemo(
    () => conversations.filter((conv) => !disabledModes.includes(normalizeCatalogMode(conv.type))),
    [conversations, disabledModes]
  )
  const filteredConversations = useMemo(() => modeAllowedConversations.filter((conv) => !conv.archived), [modeAllowedConversations])
  const archivedConversations = useMemo(() => modeAllowedConversations.filter((conv) => Boolean(conv.archived)), [modeAllowedConversations])

  return {
    userId, userIdRef, userDisplayName,
    lookerWorkspaceId, isLookerDevMode, setLookerWorkspaceId, syncLookerSessionWorkspace, handleToggleLookerDevMode,
    handleSaveAgentName,
    availableLookmlProjects, canDevelopLookml, canDeployLookml,
    loadingMetadata, setLoadingMetadata,
    starterPrompts, setStarterPrompts, starterPromptsLoading, setStarterPromptsLoading,
    models, folderTreeNodes, rootFolderIds, folderChildrenById,
    expandedFolderIds, loadingFolderIds, toggleExpandFolder,
    hydrateFolderAncestors, handleSearchFolders,
    selectedExplores, setSelectedExplores,
    preloadedContent, setPreloadedContent, mentionedItems, setMentionedItems,
    selectedFolderId, setSelectedFolderId, schemaMarkdown, setSchemaMarkdown, loadingSchema,
    agentSession, messages,
    catalogItems, activeObjectId, setActiveObjectId,
    conversations, conversationsRef, setConversations,
    savedScripts, setSavedScripts,
    healthScope, setHealthScope,
    caConversation, setCaConversation, lastCaIdRef,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, setLookmlBundle, lastLookmlIdRef,
    publishedApp, setPublishedAppState, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContentState, setNativeContent, lastNativeIdRef,
    alertBundle, setAlertBundle,
    contentItems, contentItemsRef, setContentItems,
    activeContentTabKey, activeContentTabKeyRef, setActiveContentTabKey,
    activeContentItem, upsertContentItem,
    embedNonce, setEmbedNonce, bumpEmbedNonce,
    healthReport, setHealthReport, lastHealthIdRef,
    scriptId, setScriptId, scriptTitle, setScriptTitle,
    scriptCode, setScriptCode, filtersJson, setFiltersJson,
    scriptOutput, setScriptOutput, scriptMode, setScriptMode,
    publishedTileDash, setPublishedTileDash, schedulerOpen, setSchedulerOpen,
    capabilitiesModalOpen, setCapabilitiesModalOpen,
    scheduleConfig, setScheduleConfig, savedScheduleBadge, setSavedScheduleBadge,
    loadedScript, setLoadedScript, lastScriptIdRef,
    currentAppCode, setCurrentAppCode,
    activeViewerDocument, setActiveViewerDocument,
    prompt, setPrompt, pastedImages, setPastedImages,
    showArchivedConversations, setShowArchivedConversations,
    pendingDeleteConv, setPendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent,
    hydratedConvRouteRef, activityStepsByInteractionIdRef, mergeCachedActivitySteps,
    modeAllowedConversations, filteredConversations, archivedConversations,
    codeModePermOptsRef,
  }
}

export type StudioMetadata = ReturnType<typeof useStudioMetadata>
