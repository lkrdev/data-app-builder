import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ILookmlModelNavExplore } from '@looker/sdk'
import useSWR from 'swr'

import {
  buildDynamicStarterPrompts, discoverStarterExploreContext,
  generateDynamicStarterPrompts, getCachedStarterPrompts,
  resolveTargetExploreFromModels, StarterPromptItem,
} from './antigravity'
import { StudioMode } from './components/App'
import {
  buildAvailableExploresCatalog, buildDenseExploreSchema, buildRootLookerFolders,
  DEFAULT_STUDIO_AGENT_NAME, fetchFolderChildren, fetchFolderWithAncestors,
  fetchInitialLookerMetadata, fetchPreloadedContentSummary, getArtifactNamespace,
  getArtifactService, getConvTargetId, listSavedScripts, loadStoredSelectedFolderId,
  loadUserEnvironmentId, LookerFolderNode, normalizeStudioAgentName,
  parseExploreId, persistSelectedFolderId, readInitialSelectedFolderId,
  ResolvedStudioUseCase, SavedScript, searchLookerFolders, SearchLookerFoldersParams,
  StudioContextMention, studioModeToUseCase, StudioUseCase, studioUseCaseToMode,
  UserArtifactIndex, UserConversationEntry,
} from './lookerApi'
import { getErrorMessage, StudioAuthAndPrefs } from './studioControllerAuth'

export function useStudioMetadata(auth: StudioAuthAndPrefs) {
  const {
    extensionSDK, core40SDK, history, location, isTileMount, mockExt,
    setAgentName, setAppInitializing, setCapabilities, setMessages,
    selectedUseCase, setSelectedUseCase, explicitUseCaseRef, parsedRoute,
    resolvedUseCaseByIdRef, allowedUseCases, availableModels,
    oauthAccessToken, clientId, projectId, apiKey, selectedModel,
    sharedEnvIdRef, syncSharedEnvironmentId, agentSession, messages, activeModeRef,
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

  const [allModels, setAllModels] = useState<
    Array<{ name: string; label: string; project_name?: string; explores: ILookmlModelNavExplore[] }>
  >([])
  const [loadingMetadata, setLoadingMetadata] = useState<boolean>(
    () => Boolean(mockExt?.forceFolderSkeleton ?? true)
  )
  const [folderTreeNodes, setFolderTreeNodes] = useState<Record<string, LookerFolderNode>>(() => {
    const roots = buildRootLookerFolders()
    return Object.fromEntries(roots.map((r) => [r.id, r]))
  })
  const [rootFolderIds, setRootFolderIds] = useState<string[]>(() =>
    buildRootLookerFolders().map((r) => r.id)
  )
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
  const hasExplicitFolderRef = useRef<boolean>(
    Boolean(mockExt?.initialSelectedFolderId || readInitialSelectedFolderId())
  )
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
      if (mounted && stored) {
        hasExplicitFolderRef.current = true
        setSelectedFolderIdState(stored)
      }
    })
    return () => { mounted = false }
  }, [extensionSDK, mockExt?.initialSelectedFolderId])

  const [schemaMarkdown, setSchemaMarkdown] = useState('')
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [starterPrompts, setStarterPrompts] = useState<StarterPromptItem[]>([])
  const [starterPromptsLoading, setStarterPromptsLoading] = useState<boolean>(
    () => Boolean(mockExt?.forceStarterPromptsSkeleton ?? true)
  )

  const [activeObjectId, setActiveObjectId] = useState('')
  const conversationLabelsRef = useRef<Record<string, string>>({})
  const optimisticConvRef = useRef<UserConversationEntry | null>(null)
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [healthScope, setHealthScope] = useState<'all' | 'looker' | 'bq'>('all')

  const artifactNamespace = getArtifactNamespace(extensionSDK)
  const artifactService = useMemo(
    () => getArtifactService(core40SDK, artifactNamespace),
    [core40SDK, artifactNamespace]
  )
  const { data: swrUserArtifacts } = useSWR<UserArtifactIndex[]>(
    !isTileMount && userId ? ['artifact:user_list', artifactNamespace, userId, 'all'] : null,
    () => artifactService.listUserArtifacts(userId),
    { revalidateOnFocus: false }
  )
  const catalogItems = useMemo(() => swrUserArtifacts ?? [], [swrUserArtifacts])
  const { data: swrConversations, mutate: mutateConversations } = useSWR<UserConversationEntry[]>(
    !isTileMount && userId ? ['artifact:conversations', artifactNamespace, userId] : null,
    () => artifactService.listConversations(userId),
    { revalidateOnFocus: false }
  )
  const conversations = useMemo<UserConversationEntry[]>(() => {
    const base = swrConversations ?? []
    const opt = optimisticConvRef.current
    if (opt && base.some((c) => c.id === opt.id)) {
      optimisticConvRef.current = null
      return base
    }
    return opt ? [opt, ...base] : base
  }, [swrConversations])
  const conversationsRef = useRef<UserConversationEntry[]>(conversations)
  conversationsRef.current = conversations

  const setConversations = useCallback(
    (
      next: UserConversationEntry[] | ((prev: UserConversationEntry[]) => UserConversationEntry[]),
      opts?: { optimisticEntry?: UserConversationEntry | null }
    ) => {
      if (opts && 'optimisticEntry' in opts) {
        optimisticConvRef.current = opts.optimisticEntry ?? null
      }
      const resolved = typeof next === 'function' ? next(conversationsRef.current) : next
      conversationsRef.current = resolved
      void mutateConversations(resolved, { revalidate: false })
    },
    [mutateConversations]
  )

  const handleSaveAgentName = useCallback(
    async (nextName: string): Promise<string> => {
      const normalized = normalizeStudioAgentName(nextName)
      setAgentName(normalized)
      try {
        await artifactService.saveUserConfig(userIdRef.current || userId, { agentName: normalized })
      } catch { /* ignore */ }
      return normalized
    },
    [artifactService, setAgentName, userId]
  )

  const inferredRouteUseCase = useMemo((): ResolvedStudioUseCase | undefined => {
    if (parsedRoute.useCase && parsedRoute.useCase !== 'auto') return parsedRoute.useCase
    const rawId = parsedRoute.conversationId || parsedRoute.objectId || ''
    const id = parsedRoute.objectId || rawId
    if (!id) return undefined
    const cached = resolvedUseCaseByIdRef.current[rawId] || resolvedUseCaseByIdRef.current[id]
    if (cached) return cached
    const convMatch = conversations.find((c) => {
      if (c.id === rawId || c.id === id) return true
      const cid = getConvTargetId(c.content, c.type)
      return Boolean((cid && (cid === id || cid === rawId)) || (c.type === 'lookml' && c.content?.sessionId && (c.content.sessionId === id || c.content.sessionId === rawId)))
    })
    if (convMatch) {
      if (convMatch.use_case === 'auto' && !convMatch.interactionId) return undefined
      return studioModeToUseCase(convMatch.type)
    }
    const catMatch = catalogItems.find((it) => it.id === id || it.id === rawId)
    if (catMatch) return studioModeToUseCase(catMatch.type)
    return undefined
  }, [parsedRoute, conversations, catalogItems, resolvedUseCaseByIdRef])

  const isGenericConvRoute =
    /^conv_[a-z0-9_-]+$/i.test(parsedRoute.conversationId || '') && parsedRoute.useCase === 'auto'
  const effectiveUseCase: StudioUseCase =
    selectedUseCase !== 'auto'
      ? selectedUseCase
      : inferredRouteUseCase || (parsedRoute.objectId && !isGenericConvRoute ? 'app' : 'auto')
  const activeMode: StudioMode =
    effectiveUseCase !== 'auto' ? studioUseCaseToMode(effectiveUseCase) : parsedRoute.mode
  activeModeRef.current = activeMode
  const isLookmlMode = activeMode === 'lookml'
  const isHealthCheckMode = location.pathname === '/health-check' || activeMode === 'health'
  const builderMode: 'data_app' | 'dashboard' = activeMode === 'dashboard' ? 'dashboard' : 'data_app'
  const isUseCaseLocked = false

  useEffect(() => {
    if (selectedUseCase === 'auto') {
      if (inferredRouteUseCase) {
        setSelectedUseCase(inferredRouteUseCase)
      } else if (parsedRoute.objectId && !isGenericConvRoute) {
        setSelectedUseCase('app')
      }
    }
  }, [parsedRoute.objectId, isGenericConvRoute, inferredRouteUseCase, selectedUseCase, setSelectedUseCase])

  const handleChangeUseCase = useCallback(
    (nextUseCase: StudioUseCase) => {
      explicitUseCaseRef.current = nextUseCase
      setSelectedUseCase(nextUseCase)
      if (location.pathname !== '/' && !parsedRoute.objectId) {
        history.replace('/')
      }
    },
    [explicitUseCaseRef, setSelectedUseCase, location.pathname, parsedRoute.objectId, history]
  )

  const models = useMemo(() => {
    const isAuthoringMode = activeMode === 'app' || activeMode === 'dashboard' || activeMode === 'tile'
    if (isAuthoringMode && capabilities.rolesLoaded && !capabilities.explorableModels.has('*')) {
      return allModels.filter((m) => capabilities.explorableModels.has(m.name))
    }
    return allModels
  }, [allModels, activeMode, capabilities.rolesLoaded, capabilities.explorableModels])

  const availableLookmlProjects = useMemo(
    () => Array.from(capabilities.developableProjects).filter((p) => p && p !== '*').sort(),
    [capabilities.developableProjects]
  )
  const canDeployLookml = useMemo(
    () =>
      !capabilities.rolesLoaded ||
      capabilities.isAdmin ||
      capabilities.globalPermissions.has('deploy') ||
      capabilities.globalPermissions.has('admin'),
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
        if (markEmptyLeaf && next[fid] && visibleChildren.length === 0) {
          next[fid] = { ...next[fid], child_count: 0, has_children: false }
        }
        return next
      })
      if (visibleChildren.length > 0 || markEmptyLeaf) {
        setFolderChildrenById((prev) => {
          const existing = prev[fid] || []
          const merged = Array.from(new Set([...visibleChildren.map((c) => c.id), ...existing])).filter(
            (id) => !activeRootIds.includes(id)
          )
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
              ...existing,
              ...node,
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
          setExpandedFolderIds((prev) =>
            Array.from(new Set([...prev, ...effectiveAncestors.map((a) => a.id)]))
          )
          for (const anc of effectiveAncestors) {
            void loadFolderChildren(anc.id, activeRootIds).catch(() => {})
          }
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
      setExpandedFolderIds((prev) =>
        prev.includes(fid) ? prev.filter((id) => id !== fid) : [...prev, fid]
      )
      if (isCurrentlyExpanded || folderChildrenById[fid]?.length) return
      setLoadingFolderIds((prev) => (prev.includes(fid) ? prev : [...prev, fid]))
      try {
        await loadFolderChildren(fid, undefined, true)
      } catch { /* ignore */ } finally {
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
    if (!selectedFolderId) return
    void hydrateFolderAncestors(selectedFolderId)
  }, [selectedFolderId, hydrateFolderAncestors])

  useEffect(() => {
    let mounted = true
    Promise.all([
      fetchInitialLookerMetadata(core40SDK),
      loadStoredSelectedFolderId(extensionSDK),
    ])
      .then(async ([meta, asyncStoredFolderId]) => {
        if (!mounted) return
        const resolvedUserId = String(meta.user?.id || '1')
        userIdRef.current = resolvedUserId
        setUserId(resolvedUserId)
        setUserDisplayName(String(meta.user?.display_name || ''))
        lastSessionSyncAtRef.current = Date.now()
        if (meta.workspaceId === 'dev' || meta.workspaceId === 'production') {
          setLookerWorkspaceId(meta.workspaceId)
        }
        setCapabilities(meta.capabilities)
        if (meta.capabilities.rolesLoaded && meta.capabilities.sqlRunnerConnections.size === 0) {
          setHealthScope((prev) => (prev === 'all' || prev === 'bq' ? 'looker' : prev))
        }
        const extMock = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        await artifactService
          .getUserConfig(resolvedUserId)
          .then((cfg) => {
            if (!mounted) return
            const hasStoredCustom = Boolean(
              cfg?.updatedAt || (cfg?.agentName && cfg.agentName !== DEFAULT_STUDIO_AGENT_NAME)
            )
            const resolvedName = hasStoredCustom
              ? normalizeStudioAgentName(cfg.agentName)
              : normalizeStudioAgentName(extMock?.initialAgentName || cfg?.agentName)
            setAgentName(resolvedName)
          })
          .catch(() => {})
        loadUserEnvironmentId(core40SDK, resolvedUserId, getArtifactNamespace(extensionSDK)).then((savedEnvId) => {
          if (mounted && savedEnvId) syncSharedEnvironmentId(savedEnvId)
        })
        listSavedScripts(core40SDK, resolvedUserId)
          .then((items) => { if (mounted) setSavedScripts(items) })
          .catch(() => {})
        setAllModels(
          meta.models.map((m) => ({
            name: String(m.name || ''),
            label: String(m.label || m.name || ''),
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
        const targetInitialFolder = extMock?.initialSelectedFolderId
          ? String(extMock.initialSelectedFolderId)
          : storedFolderId || meta.defaultFolderId
        setSelectedFolderIdState((prev) =>
          extMock?.initialSelectedFolderId
            ? String(extMock.initialSelectedFolderId)
            : storedFolderId || (hasExplicitFolderRef.current ? prev : meta.defaultFolderId)
        )
        if (!extMock?.forceFolderSkeleton) setLoadingMetadata(false)
        void hydrateFolderAncestors(targetInitialFolder, initialRootIds)
        void loadFolderChildren(targetInitialFolder, initialRootIds).catch(() => {})
        void artifactService.listUserArtifacts(resolvedUserId).catch(() => {})
        fetchPreloadedContentSummary(core40SDK)
          .then((items) => { if (mounted) setPreloadedContent(items) })
          .catch(() => {})
        void artifactService.listConversations(resolvedUserId)
          .then((loadedConvs) => {
            if (!mounted) return
            const opt = optimisticConvRef.current
            void mutateConversations(
              opt && !loadedConvs.some((c) => c.id === opt.id) ? [opt, ...loadedConvs] : loadedConvs,
              { revalidate: false }
            )
          })
          .catch(() => {})
      })
      .catch((err: unknown) => {
        const extMock = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        if (!extMock?.forceFolderSkeleton) setLoadingMetadata(false)
        setMessages((prev) => [...prev, { role: 'error', text: `Failed to load Looker models: ${getErrorMessage(err)}` }])
      })
      .finally(() => {
        const extMock = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        if (mounted && !extMock?.forceAppInitializing) setAppInitializing(false)
      })
    return () => { mounted = false }
  }, [artifactService, core40SDK, extensionSDK, syncSharedEnvironmentId, hydrateFolderAncestors, loadFolderChildren, mutateConversations, setAgentName, setAppInitializing, setCapabilities, setMessages])

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
        try {
          return await buildDenseExploreSchema(core40SDK, parsed.modelName, parsed.exploreName)
        } catch (err: unknown) {
          return `# Error loading explore \`${id}\`\n${getErrorMessage(err)}`
        }
      })
    )
      .then((sections) => {
        if (mounted) setSchemaMarkdown(sections.filter(Boolean).join('\n\n---\n\n'))
      })
      .finally(() => {
        if (mounted) setLoadingSchema(false)
      })
    return () => { mounted = false }
  }, [core40SDK, selectedExplores, models])

  useEffect(() => {
    let mounted = true
    const targetExplore = resolveTargetExploreFromModels(selectedExplores, models)
    const exploreKey = selectedExplores.length > 0 ? selectedExplores.join(',') : targetExplore?.exploreKey || 'none'
    const hasOAuth = Boolean(oauthAccessToken)
    const cached = getCachedStarterPrompts(selectedUseCase, exploreKey, allowedUseCases, hasOAuth)
    if (cached && cached.length > 0 && !mockExt?.forceStarterPromptsSkeleton) {
      setStarterPrompts(cached)
      setStarterPromptsLoading(false)
      return () => { mounted = false }
    }
    if ((loadingMetadata && models.length === 0 && selectedExplores.length === 0) || mockExt?.forceStarterPromptsSkeleton) {
      setStarterPromptsLoading(true)
      return () => { mounted = false }
    }
    setStarterPrompts((prev) => {
      if (prev.length === 0) setStarterPromptsLoading(true)
      return prev
    })
    void (async () => {
      const exploreContext = await discoverStarterExploreContext({
        sdk: core40SDK, selectedExplores, availableModels: models,
      })
      if (!mounted) return
      const immediate = buildDynamicStarterPrompts({
        useCase: selectedUseCase, selectedExplores, permittedUseCases: allowedUseCases,
        availableModels: models, exploreContext,
      })
      setStarterPrompts(immediate)
      setStarterPromptsLoading(false)
      if (hasOAuth) {
        const refined = await generateDynamicStarterPrompts({
          sdk: core40SDK, extensionSDK,
          auth: { mode: 'oauth', oauthToken: oauthAccessToken, clientId, projectId, apiKey },
          environmentId: sharedEnvIdRef.current || undefined,
          useCase: selectedUseCase, selectedExplores, permittedUseCases: allowedUseCases,
          availableModels: models, exploreContext, model: selectedModel,
        })
        if (mounted && refined.length > 0) setStarterPrompts(refined)
      }
    })()
    return () => { mounted = false }
  }, [
    core40SDK, extensionSDK, selectedUseCase, selectedExplores, allowedUseCases,
    models, availableModels, oauthAccessToken, loadingMetadata, clientId,
    projectId, apiKey, selectedModel, sharedEnvIdRef, mockExt?.forceStarterPromptsSkeleton,
  ])

  return {
    userId, userIdRef, userDisplayName,
    lookerWorkspaceId, isLookerDevMode, setLookerWorkspaceId, syncLookerSessionWorkspace, handleToggleLookerDevMode,
    handleSaveAgentName,
    availableLookmlProjects, canDeployLookml,
    loadingMetadata, setLoadingMetadata,
    starterPrompts, setStarterPrompts, starterPromptsLoading, setStarterPromptsLoading,
    models, folderTreeNodes, rootFolderIds, folderChildrenById,
    expandedFolderIds, loadingFolderIds, toggleExpandFolder,
    hydrateFolderAncestors, handleSearchFolders,
    selectedExplores, setSelectedExplores,
    preloadedContent, setPreloadedContent, mentionedItems, setMentionedItems,
    selectedFolderId, setSelectedFolderId, schemaMarkdown, setSchemaMarkdown, loadingSchema,
    inferredRouteUseCase, effectiveUseCase, activeMode, isLookmlMode, isHealthCheckMode, builderMode,
    isUseCaseLocked, handleChangeUseCase,
    agentSession, messages,
    catalogItems, activeObjectId, setActiveObjectId,
    conversations, conversationsRef, setConversations, conversationLabelsRef,
    savedScripts, setSavedScripts,
    healthScope, setHealthScope,
  }
}

export type StudioMetadata = ReturnType<typeof useStudioMetadata>
