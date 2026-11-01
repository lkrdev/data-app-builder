import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { useLookerExtension } from './contexts/LookerExtensionContext'
import {
  applyStudioDocumentTheme, archiveUserConversation, buildAvailableExploresCatalog, buildDenseExploreSchema,
  buildRootLookerFolders, CaConversationState, ConversationRecord, createLookerCaConversation,
  deleteUserArtifact, deleteUserConversation, extractExploreIdsFromCode, extractResolvedUseCase,
  fetchFolderChildren, fetchFolderWithAncestors, fetchInitialLookerMetadata, formatExploreId,
  getAllowedUseCases, getArtifactNamespace, getArtifactService, getUseCaseLabel, listSavedScripts,
  listUserArtifacts, loadExistingDashboardApp, loadNativeContentById,
  loadObjectArtifact, loadScriptArtifact, loadStoredStudioThemeMode, loadUserConversations,
  loadUserEnvironmentId, LookerFolderNode, NativeContentState, NativeContentType,
  normalizeStudioThemeMode, parseExploreId, persistStudioThemeMode, PublishedAppState,
  publishScriptDashboard, readInitialStudioThemeMode, resolveCaEmbedPath,
  resolveConversationRelatedContent, ResolvedStudioTheme, ResolvedStudioUseCase, resolveStudioTheme, resolveSystemTheme,
  resolveUserCapabilities, saveDashboardStudioMetadata, SavedScript, saveNativeContentArtifact,
  saveScriptArtifact, saveUserArtifact, saveUserConversation, searchLookerFolders, SearchLookerFoldersParams,
  selectCaAgentViaIsolatedSubagent, STUDIO_THEME_STORAGE_KEY, STUDIO_USE_CASE_OPTIONS,
  studioModeToUseCase, StudioThemeMode, StudioUseCase, upsertPublishedDataApp, useCaseToStudioMode,
  UserArtifactIndex, UserCapabilities, UserConversationEntry,
} from './lookerApi'
import {
  AgentSession, ANTIGRAVITY_ALLOWED_MODELS, AntigravityActivityStep, AntigravityAuth, AntigravityModelOption,
  authenticateGoogleOAuth, CodeModePermissionDecision, CodeModePermissionRequest, computeIsAuthenticated,
  DEFAULT_ANTIGRAVITY_MODEL, ensureGeminiApiKeyUserAttribute, ExtensionAuthContextConfig, generateConversationLabel,
  listAvailableAntigravityModels, LkrCodeMode, loginWithGoogleOAuth, normalizeEnvironmentId,
  PastedImage, prewarmOrWakeAntigravityEnvironment, resolveLookerOAuthRedirectUri, runAntigravityTurn, sanitizeConversationLabel,
} from './antigravity'
import {
  listUserLookmlSessions, loadLookmlSessionArtifact, LookmlBundle, LookmlSessionIndex, saveLookmlSessionArtifact,
} from './lookmlTool'
import {
  HEALTH_CHECK_SYSTEM_GUIDE, HealthCheckReportPayload, loadHealthCheckArtifact,
  runThreePillarHealthCheckViaCodeMode, saveHealthCheckArtifact, THREE_PILLAR_CODEMODE_PY,
} from './healthCheck'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import { ChatMessage, parseStudioRoute, STUDIO_MODES, StudioMode } from './components/App'

export {
  authenticateGoogleOAuth,
  computeIsAuthenticated,
  normalizeStudioThemeMode,
  resolveLookerOAuthRedirectUri,
  resolveStudioTheme,
  resolveSystemTheme,
  STUDIO_THEME_STORAGE_KEY,
}
export type { ResolvedStudioTheme, StudioThemeMode }

export function useStudioController() {
  const { extensionSDK, core40SDK, tileHostData, lookerHostData } = useLookerExtension()
  const history = useHistory()
  const location = useLocation()
  const mountType =
    (lookerHostData as any)?.mountType ||
    (extensionSDK as any)?.lookerHostData?.mountType ||
    lookerHostData?.mountPoint ||
    (extensionSDK as any)?.lookerHostData?.mountPoint
  const isTileMount =
    mountType === 'dashboard_tile' ||
    mountType === 'dashboard-tile' ||
    Boolean(tileHostData?.elementId || tileHostData?.dashboardId)

  const initialCtx = (() => {
    try {
      return (extensionSDK.getContextData() as ExtensionAuthContextConfig | undefined) || undefined
    } catch {
      return undefined
    }
  })()
  const mockExt =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>(initialCtx?.authMode || 'oauth')
  const [clientId, setClientId] = useState(initialCtx?.clientId || '')
  const [projectId, setProjectId] = useState(initialCtx?.projectId || '')
  const [disabledModes, setDisabledModes] = useState<StudioMode[]>(() =>
    Array.isArray(initialCtx?.disabledModes) ? (initialCtx.disabledModes as StudioMode[]) : []
  )
  const [selectedModel, setSelectedModel] = useState<string>(
    initialCtx?.defaultModel || DEFAULT_ANTIGRAVITY_MODEL
  )
  const [availableModels, setAvailableModels] = useState<AntigravityModelOption[]>(
    ANTIGRAVITY_ALLOWED_MODELS
  )
  const enabledModes = useMemo(() => {
    const list = STUDIO_MODES.filter((m) => !disabledModes.includes(m.mode))
    return list.length > 0 ? list : [STUDIO_MODES[0]]
  }, [disabledModes])
  const [oauthToken, setOauthToken] = useState(() => String(mockExt?.initialOauthToken || ''))
  const [apiKey, setApiKey] = useState(() => String(mockExt?.initialApiKey || ''))
  const [oauthSigningIn, setOauthSigningIn] = useState(false)
  const oauthAbortRef = useRef<AbortController | null>(null)
  const isAuthenticated = authMode === 'apikey' ? Boolean(apiKey.trim()) : Boolean(oauthToken.trim())
  const oauthRedirectUri = useMemo(
    () =>
      resolveLookerOAuthRedirectUri(
        lookerHostData?.hostUrl || (extensionSDK as any)?.lookerHostData?.hostUrl
      ),
    [lookerHostData?.hostUrl, extensionSDK]
  )
  const [isConfigured, setIsConfigured] = useState(() =>
    Boolean(initialCtx?.authMode && (initialCtx.authMode === 'apikey' || initialCtx.clientId))
  )
  const [themeMode, setThemeModeState] = useState<StudioThemeMode>(() =>
    readInitialStudioThemeMode()
  )
  const [systemTheme, setSystemTheme] = useState<ResolvedStudioTheme>(() => resolveSystemTheme())
  const resolvedTheme: ResolvedStudioTheme = resolveStudioTheme(themeMode, systemTheme)

  applyStudioDocumentTheme(resolvedTheme, themeMode)

  useEffect(() => {
    applyStudioDocumentTheme(resolvedTheme, themeMode)
  }, [resolvedTheme, themeMode])

  useEffect(() => {
    let mounted = true
    void loadStoredStudioThemeMode(extensionSDK).then((stored) => {
      if (mounted && stored) setThemeModeState(stored)
    })
    return () => {
      mounted = false
    }
  }, [extensionSDK])

  useEffect(() => {
    const mql = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null
    if (!mql) return
    setSystemTheme(mql.matches ? 'dark' : 'light')
    const onChange = (e?: MediaQueryListEvent | { matches?: boolean }) => {
      const nextSys: ResolvedStudioTheme = (typeof e?.matches === 'boolean' ? e.matches : mql.matches) ? 'dark' : 'light'
      setSystemTheme(nextSys)
      if (themeMode === 'system') applyStudioDocumentTheme(nextSys, 'system')
    }
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [themeMode])

  const setThemeMode = useCallback(
    (next: StudioThemeMode) => {
      const mode = normalizeStudioThemeMode(next)
      const nextSys = resolveSystemTheme()
      setThemeModeState(mode)
      setSystemTheme(nextSys)
      applyStudioDocumentTheme(resolveStudioTheme(mode, nextSys), mode)
      persistStudioThemeMode(extensionSDK, mode)
    },
    [extensionSDK]
  )
  const [userId, setUserId] = useState('1')
  const [capabilities, setCapabilities] = useState<UserCapabilities>(() =>
    resolveUserCapabilities()
  )
  const [allModels, setAllModels] = useState<
    Array<{ name: string; label: string; project_name?: string; explores: any[] }>
  >([])
  const [loadingMetadata, setLoadingMetadata] = useState<boolean>(
    () => Boolean(mockExt?.forceFolderSkeleton ?? true)
  )
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [folderTreeNodes, setFolderTreeNodes] = useState<Record<string, LookerFolderNode>>(() => {
    const roots = buildRootLookerFolders()
    return Object.fromEntries(roots.map((r) => [r.id, r]))
  })
  const [rootFolderIds, setRootFolderIds] = useState<string[]>(() =>
    buildRootLookerFolders().map((r) => r.id)
  )
  const [folderChildrenById, setFolderChildrenById] = useState<Record<string, string[]>>({})
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([])
  const [loadingFolderIds, setLoadingFolderIds] = useState<string[]>([])
  const [selectedExplores, setSelectedExplores] = useState<string[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() =>
    String(mockExt?.initialSelectedFolderId || '1')
  )
  const [schemaMarkdown, setSchemaMarkdown] = useState('')
  const [loadingSchema, setLoadingSchema] = useState(false)

  const [catalogItems, setCatalogItems] = useState<UserArtifactIndex[]>([])
  const [activeObjectId, setActiveObjectId] = useState('')
  const [conversations, setConversations] = useState<UserConversationEntry[]>([])
  const conversationLabelsRef = useRef<Record<string, string>>({})
  const artifactNamespace = getArtifactNamespace(extensionSDK)
  const artifactService = useMemo(
    () => getArtifactService(core40SDK, artifactNamespace),
    [core40SDK, artifactNamespace]
  )
  const { data: swrUserArtifacts } = useSWR<UserArtifactIndex[]>(
    !isTileMount && userId ? ['artifact:user_list', artifactNamespace, userId, 'all'] : null,
    () => artifactService.listUserArtifacts(userId)
  )
  const { data: swrConversations } = useSWR<UserConversationEntry[]>(
    !isTileMount && userId ? ['artifact:conversations', artifactNamespace, userId] : null,
    () => artifactService.listConversations(userId)
  )
  useEffect(() => {
    if (!swrUserArtifacts) return
    const labels = conversationLabelsRef.current
    setCatalogItems(
      swrUserArtifacts.map((item) =>
        labels[item.id]
          ? { ...item, label: labels[item.id], title: labels[item.id] }
          : item.label
          ? { ...item, title: item.label }
          : item
      )
    )
  }, [swrUserArtifacts])
  useEffect(() => {
    if (swrConversations) {
      setConversations(swrConversations)
    }
  }, [swrConversations])
  const [showArchivedConversations, setShowArchivedConversations] = useState<boolean>(
    () => Boolean(mockExt?.initialShowArchived)
  )
  const [pendingDeleteConv, setPendingDeleteConv] = useState<ConversationRecord | null>(
    () => mockExt?.initialPendingDeleteConv || null
  )
  const [deleteRelatedContent, setDeleteRelatedContent] = useState<boolean>(
    () => Boolean(mockExt?.initialDeleteRelatedContent)
  )
  const [activeConversationId, setActiveConversationId] = useState<string>(
    () => `conv_${Date.now()}`
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    Boolean(mockExt?.initialSidebarCollapsed)
  )
  const resolvedUseCaseByIdRef = useRef<Record<string, ResolvedStudioUseCase>>({})

  const parsedRoute = useMemo(() => parseStudioRoute(location.pathname), [location.pathname])
  if (parsedRoute.useCase && parsedRoute.useCase !== 'auto' && parsedRoute.objectId) {
    resolvedUseCaseByIdRef.current[parsedRoute.objectId] = parsedRoute.useCase
    if (parsedRoute.conversationId) {
      resolvedUseCaseByIdRef.current[parsedRoute.conversationId] = parsedRoute.useCase
    }
  }

  const inferredRouteUseCase = useMemo((): ResolvedStudioUseCase | undefined => {
    if (parsedRoute.useCase && parsedRoute.useCase !== 'auto') return parsedRoute.useCase
    const rawId = parsedRoute.conversationId || parsedRoute.objectId || ''
    const id = parsedRoute.objectId || rawId
    if (!id) return undefined
    const cached = resolvedUseCaseByIdRef.current[rawId] || resolvedUseCaseByIdRef.current[id]
    if (cached) return cached
    const convMatch = conversations.find((c) => {
      if (c.id === rawId || c.id === id) return true
      const cid = String(
        c.content?.dashboardId ||
          c.content?.lookId ||
          c.content?.lookmlDashboardId ||
          c.content?.reportId ||
          c.content?.sessionId ||
          c.content?.scriptId ||
          c.content?.caConversationId ||
          c.content?.id ||
          ''
      )
      return cid === id || cid === rawId
    })
    if (convMatch) return studioModeToUseCase(convMatch.type)
    const catMatch = catalogItems.find((it) => it.id === id || it.id === rawId)
    if (catMatch) return studioModeToUseCase(catMatch.type)
    return undefined
  }, [parsedRoute, conversations, catalogItems])

  const [selectedUseCase, setSelectedUseCase] = useState<StudioUseCase>(
    () => parsedRoute.useCase || 'auto'
  )
  const effectiveUseCase: StudioUseCase = parsedRoute.objectId
    ? inferredRouteUseCase || (selectedUseCase !== 'auto' ? selectedUseCase : 'app')
    : selectedUseCase !== 'auto'
    ? selectedUseCase
    : inferredRouteUseCase || 'auto'
  const activeMode: StudioMode =
    effectiveUseCase !== 'auto' ? useCaseToStudioMode(effectiveUseCase) : parsedRoute.mode
  const isLookmlMode = activeMode === 'lookml'
  const isHealthCheckMode =
    location.pathname === '/health-check' || activeMode === 'health'
  const builderMode: 'data_app' | 'dashboard' =
    activeMode === 'dashboard' ? 'dashboard' : 'data_app'

  const [lockedByTurn, setLockedByTurn] = useState<boolean>(false)
  const [caConversation, setCaConversation] = useState<CaConversationState | null>(null)
  const lastCaIdRef = useRef<string>('')
  const isCaMode = Boolean(
    parsedRoute.isCaRoute || effectiveUseCase === 'conversational-analytics' || caConversation
  )

  const allowedUseCases = useMemo(
    () => getAllowedUseCases(capabilities, disabledModes),
    [capabilities, disabledModes]
  )
  const useCaseOptions = useMemo(
    () =>
      STUDIO_USE_CASE_OPTIONS.filter(
        (opt) => !opt.capabilityMode || !disabledModes.includes(opt.capabilityMode)
      ),
    [disabledModes]
  )

  const models = useMemo(() => {
    const isAuthoringMode =
      activeMode === 'app' || activeMode === 'dashboard' || activeMode === 'tile'
    if (
      isAuthoringMode &&
      capabilities.rolesLoaded &&
      !capabilities.explorableModels.has('*')
    ) {
      return allModels.filter((m) => capabilities.explorableModels.has(m.name))
    }
    return allModels
  }, [allModels, activeMode, capabilities.rolesLoaded, capabilities.explorableModels])

  const availableLookmlProjects = useMemo(
    () =>
      Array.from(capabilities.developableProjects)
        .filter((p) => p && p !== '*')
        .sort(),
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

  const [lookmlProjectId, setLookmlProjectId] = useState('')
  const [activatedLookmlSkills, setActivatedLookmlSkills] = useState<string[]>([
    'lookml-field-curation',
    'lookml-tests',
    'lookml-snapshot',
  ])
  const [lookmlBundle, setLookmlBundle] = useState<LookmlBundle | null>(null)
  const [lookmlSessions, setLookmlSessions] = useState<LookmlSessionIndex[]>([])
  const [loadLookmlInput, setLoadLookmlInput] = useState('')
  const lastLookmlIdRef = useRef<string>('')
  const [publishedApp, setPublishedApp] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContent] = useState<NativeContentState | null>(null)
  const [embedNonce, setEmbedNonce] = useState<number>(0)
  const bumpEmbedNonce = useCallback(() => setEmbedNonce((n) => n + 1), [])
  const lastPublishedIdRef = useRef<string>('')
  const lastNativeIdRef = useRef<string>('')
  const [healthReport, setHealthReport] = useState<HealthCheckReportPayload | null>(null)
  const [healthScope, setHealthScope] = useState<'all' | 'looker' | 'bq'>('all')
  const lastHealthIdRef = useRef<string>('')
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [scriptId, setScriptId] = useState(() => parsedRoute.objectId || 'demo1')
  const [scriptTitle, setScriptTitle] = useState('Looker Explore & Filter Summary')
  const [scriptCode, setScriptCode] = useState(DEFAULT_PYTHON_SCRIPT)
  const [filtersJson, setFiltersJson] = useState('{}')
  const [scriptOutput, setScriptOutput] = useState('')
  const [scriptMode, setScriptMode] = useState('summary')
  const [publishedTileDash, setPublishedTileDash] = useState<{
    dashboardId: string
    elementId: string
  } | null>(null)
  const [schedulerOpen, setSchedulerOpen] = useState(() =>
    Boolean(mockExt?.openSchedulerModal)
  )
  const [infoModalUseCase, setInfoModalUseCase] = useState<StudioUseCase | null>(() =>
    (mockExt?.initialInfoModalUseCase as StudioUseCase) || null
  )
  const [scheduleConfig, setScheduleConfig] = useState<{
    name: string
    cron: string
    mode: string
    customVarsJson: string
    destination: 'artifact_snapshot' | 'webhook' | 'looker_scheduled_plan'
    targetUrlOrEmail: string
    enabled: boolean
  }>({
    name: 'Daily Morning Explore & Filter Snapshot',
    cron: '0 8 * * *',
    mode: 'summary',
    customVarsJson: '{"region":"AMER","threshold":0.95}',
    destination: 'artifact_snapshot',
    targetUrlOrEmail: 'https://hooks.example.com/looker-script-webhook',
    enabled: true,
  })
  const [savedScheduleBadge, setSavedScheduleBadge] = useState<string | null>(
    '0 8 * * * · summary'
  )
  const [loadedScript, setLoadedScript] = useState(false)
  const lastScriptIdRef = useRef<string>('')
  const [currentAppCode, setCurrentAppCode] = useState('')
  const [loadDashInput, setLoadDashInput] = useState('')
  const [sharedEnvironmentId, setSharedEnvironmentId] = useState('')
  const sharedEnvIdRef = useRef<string>('')
  const userIdRef = useRef<string>('1')

  // Per-mode isolated Antigravity conversation histories sharing a single per-user environmentId
  const [sessionsByMode, setSessionsByMode] = useState<Record<StudioMode, AgentSession>>({
    app: { toolType: 'app', environmentId: 'env_app_isolated' },
    dashboard: { toolType: 'dashboard', environmentId: 'env_dashboard_isolated' },
    lookml: { toolType: 'lookml', environmentId: 'env_lookml_isolated' },
    health: { toolType: 'health', environmentId: 'env_health_isolated' },
    tile: { toolType: 'tile', environmentId: 'env_tile_isolated' },
  })
  const [messagesByMode, setMessagesByMode] = useState<Record<StudioMode, ChatMessage[]>>(() => {
    if (Array.isArray(mockExt?.initialMessages)) {
      return { app: mockExt.initialMessages, dashboard: [], lookml: [], health: [], tile: [] }
    }
    const initialErr = mockExt?.initialError
      ? [{ role: 'error' as const, text: String(mockExt.initialError) }]
      : []
    return { app: initialErr, dashboard: [], lookml: [], health: [], tile: [] }
  })

  const syncSharedEnvironmentId = useCallback((envId?: string) => {
    const clean = normalizeEnvironmentId(envId)
    if (!clean) return
    sharedEnvIdRef.current = clean
    setSharedEnvironmentId(clean)
    setSessionsByMode((prev) => ({
      app: { ...prev.app, toolType: 'app', environmentId: clean },
      dashboard: { ...prev.dashboard, toolType: 'dashboard', environmentId: clean },
      lookml: { ...prev.lookml, toolType: 'lookml', environmentId: clean },
      health: { ...prev.health, toolType: 'health', environmentId: clean },
      tile: { ...prev.tile, toolType: 'tile', environmentId: clean },
    }))
  }, [])

  const agentSession = sessionsByMode[activeMode] || { toolType: activeMode }
  const setAgentSession = useCallback(
    (next: AgentSession, targetMode: StudioMode = activeMode) => {
      const nextShared = normalizeEnvironmentId(next.environmentId)
      if (nextShared && nextShared !== sharedEnvIdRef.current && next.lastInteractionId) {
        sharedEnvIdRef.current = nextShared
        setSharedEnvironmentId(nextShared)
      }
      setSessionsByMode((prev) => ({
        ...prev,
        [targetMode]: {
          ...next,
          toolType: targetMode,
          environmentId:
            sharedEnvIdRef.current ||
            next.environmentId ||
            prev[targetMode]?.environmentId ||
            `env_${targetMode}_isolated`,
        },
      }))
    },
    [activeMode]
  )

  const messages = messagesByMode[activeMode] || []
  const setMessages = useCallback(
    (
      updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
      targetMode: StudioMode = activeMode
    ) => {
      setMessagesByMode((prev) => {
        const cur = prev[targetMode] || []
        const next = typeof updater === 'function' ? updater(cur) : updater
        return { ...prev, [targetMode]: next }
      })
    },
    [activeMode]
  )

  const [prompt, setPrompt] = useState(() => String(mockExt?.initialPrompt || ''))
  const [pastedImages, setPastedImages] = useState<PastedImage[]>(
    () => mockExt?.initialPastedImages || []
  )
  const [busyStatus, setBusyStatus] = useState<string | null>(
    () => mockExt?.initialBusyStatus || null
  )
  const [liveActivitySteps, setLiveActivitySteps] = useState<AntigravityActivityStep[]>(
    () => (Array.isArray(mockExt?.initialLiveActivitySteps) ? mockExt.initialLiveActivitySteps : [])
  )

  const isUseCaseLocked = Boolean(
    lockedByTurn ||
      parsedRoute.objectId ||
      messages.length > 0 ||
      publishedApp ||
      nativeContent ||
      lookmlBundle ||
      healthReport ||
      caConversation ||
      loadedScript
  )

  useEffect(() => {
    if (inferredRouteUseCase) {
      setSelectedUseCase(inferredRouteUseCase)
    } else if (parsedRoute.objectId && selectedUseCase === 'auto') {
      setSelectedUseCase('app')
    }
  }, [parsedRoute.objectId, parsedRoute.conversationId, inferredRouteUseCase, selectedUseCase])

  const handleChangeUseCase = useCallback(
    (nextUseCase: StudioUseCase) => {
      if (isUseCaseLocked) return
      setSelectedUseCase(nextUseCase)
      if (location.pathname !== '/' && !parsedRoute.objectId) {
        history.replace('/')
      }
    },
    [isUseCaseLocked, location.pathname, parsedRoute.objectId, history]
  )

  const handleWakeModeEnv = useCallback(
    async (modeToWake: StudioMode = activeMode) => {
      try {
        const res = await prewarmOrWakeAntigravityEnvironment({
          sdk: core40SDK,
          userId: userIdRef.current || userId,
          extensionSDK,
          auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
          toolType: modeToWake,
          model: selectedModel,
          environmentId: sharedEnvIdRef.current || sessionsByMode[modeToWake]?.environmentId,
          existingSession: sessionsByMode[modeToWake],
          selectedExplores,
          schemaMarkdown,
          existingAppCode: modeToWake === 'app' ? currentAppCode : undefined,
          onEnvironmentUpdated: syncSharedEnvironmentId,
        })
        setSessionsByMode((prev) => ({
          ...prev,
          [modeToWake]: {
            ...res.session,
            environmentId: sharedEnvIdRef.current || res.session.environmentId,
          },
        }))
      } catch {}
    },
    [activeMode, core40SDK, userId, extensionSDK, authMode, oauthToken, clientId, projectId, apiKey, selectedModel, sessionsByMode, selectedExplores, schemaMarkdown, currentAppCode, syncSharedEnvironmentId]
  )

  useEffect(() => {
    if (!isConfigured && !oauthToken && !apiKey) return
    let mounted = true
    listAvailableAntigravityModels(extensionSDK, { mode: authMode, oauthToken, clientId, projectId, apiKey }).then((list) => {
      if (mounted && list.length > 0) setAvailableModels(list)
    })
    return () => {
      mounted = false
    }
  }, [extensionSDK, isConfigured, authMode, oauthToken, clientId, projectId, apiKey])

  useEffect(() => {
    if (disabledModes.includes(activeMode)) return
    if (sharedEnvIdRef.current) return
    handleWakeModeEnv(activeMode)
  }, [activeMode, disabledModes])

  const [requirePermission, setRequirePermission] = useState(true)
  const approvedOpsRef = useRef<Set<string>>(new Set())
  const [pendingPerm, setPendingPerm] = useState<{
    req: CodeModePermissionRequest
    resolve: (decision: CodeModePermissionDecision) => void
  } | null>(() =>
    mockExt?.initialPendingPerm ? { req: mockExt.initialPendingPerm, resolve: () => {} } : null
  )

  const requestCodeModePermission = useCallback(
    (req: CodeModePermissionRequest): Promise<CodeModePermissionDecision> =>
      new Promise<CodeModePermissionDecision>((resolve) => {
        setPendingPerm({ req, resolve })
      }),
    []
  )

  const resolvePermDecision = (decision: CodeModePermissionDecision) => {
    if (!pendingPerm) return
    const { resolve } = pendingPerm
    setPendingPerm(null)
    resolve(decision)
  }

  const refreshCatalog = useCallback(
    async (uid = userId) => {
      if (!uid) return
      try {
        const items = await listUserArtifacts(core40SDK, uid, getArtifactNamespace(extensionSDK))
        const labels = conversationLabelsRef.current
        setCatalogItems(
          items.map((item) =>
            labels[item.id]
              ? { ...item, label: labels[item.id], title: labels[item.id] }
              : item.label
              ? { ...item, title: item.label }
              : item
          )
        )
      } catch {}
    },
    [core40SDK, extensionSDK, userId]
  )

  const normalizeCatalogMode = (t?: string): StudioMode =>
    ({
      health_check: 'health',
      'health-check': 'health',
      script: 'tile',
      data_app: 'app',
      'conversational-analytics': 'app',
    } as Record<string, StudioMode>)[t || ''] ||
    (t as StudioMode) ||
    'app'

  const modeAllowedConversations = useMemo(
    () =>
      conversations.filter(
        (conv) => !disabledModes.includes(normalizeCatalogMode(conv.type))
      ),
    [conversations, disabledModes]
  )

  const filteredConversations = useMemo(
    () => modeAllowedConversations.filter((conv) => !conv.archived),
    [modeAllowedConversations]
  )

  const archivedConversations = useMemo(
    () => modeAllowedConversations.filter((conv) => Boolean(conv.archived)),
    [modeAllowedConversations]
  )

  const handleSaveAuthSetup = async () => {
    const permErr = !capabilities.canConfigureExtension
      ? 'Saving shared extension configuration requires Looker "develop" or "admin" permission.'
      : authMode === 'apikey' && !capabilities.canManageUserAttributes
      ? 'Creating or updating hidden Looker User Attributes requires Looker "manage_user_attributes" or "admin" permission.'
      : ''
    if (permErr) {
      setMessages((prev) => [...prev, { role: 'error', text: permErr }])
      return
    }
    try {
      if (authMode === 'apikey') {
        setBusyStatus('Ensuring hidden Looker User Attribute for Gemini API Key...')
        const attrName = await ensureGeminiApiKeyUserAttribute(core40SDK, extensionSDK, apiKey)
        setApiKey('')
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Configured hidden Looker User Attribute "${attrName}" (value_is_hidden=true, user_can_view=false, whitelist="https://generativelanguage.googleapis.com/*") and saved extension context.`,
          },
        ])
      } else if (!clientId.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: 'Enter a Google Web OAuth 2.0 Client ID before saving.' },
        ])
        return
      }
      setBusyStatus('Saving shared extension context...')
      await extensionSDK.saveContextData({
        authMode,
        clientId: clientId.trim(),
        projectId: projectId.trim(),
        disabledModes,
        defaultModel: selectedModel,
      })
      setIsConfigured(true)
      setBusyStatus(null)
      history.replace('/')
    } catch (err: any) {
      setBusyStatus(null)
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    }
  }

  const hydrateFolderAncestors = useCallback(
    async (targetFolderId: string) => {
      const fid = String(targetFolderId || '').trim()
      if (!fid) return
      try {
        const res = await fetchFolderWithAncestors(core40SDK, fid)
        if (!res.folder && res.ancestors.length === 0) return
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const node of res.chain) {
            const existing = next[node.id]
            next[node.id] = existing ? { ...existing, ...node, name: existing.is_personal && existing.name === 'My folder' ? existing.name : node.name } : node
          }
          return next
        })
        if (res.chain.length > 0) {
          const topRootId = res.chain[0].id
          setRootFolderIds((prev) => (prev.includes(topRootId) ? prev : [topRootId, ...prev]))
        }
        if (res.chain.length > 1) {
          setFolderChildrenById((prev) => {
            const next = { ...prev }
            for (let i = 0; i < res.chain.length - 1; i += 1) {
              const parentId = res.chain[i].id
              const childId = res.chain[i + 1].id
              const cur = next[parentId] || []
              if (!cur.includes(childId)) next[parentId] = [...cur, childId]
            }
            return next
          })
          setExpandedFolderIds((prev) => Array.from(new Set([...prev, ...res.expandedIds])))
          for (const anc of res.ancestors) {
            void fetchFolderChildren(core40SDK, anc.id)
              .then((children) => {
                if (!children.length) return
                setFolderTreeNodes((prev) => {
                  const next = { ...prev }
                  for (const c of children) next[c.id] = { ...next[c.id], ...c }
                  return next
                })
                setFolderChildrenById((prev) => {
                  const cur = prev[anc.id] || []
                  const merged = Array.from(new Set([...children.map((c) => c.id), ...cur]))
                  return { ...prev, [anc.id]: merged }
                })
              })
              .catch(() => {})
          }
        }
      } catch {}
    },
    [core40SDK]
  )

  const toggleExpandFolder = useCallback(
    async (folderId: string) => {
      const fid = String(folderId || '').trim()
      if (!fid) return
      let shouldFetch = false
      setExpandedFolderIds((prev) => {
        if (prev.includes(fid)) return prev.filter((id) => id !== fid)
        shouldFetch = true
        return [...prev, fid]
      })
      if (!shouldFetch) return
      setLoadingFolderIds((prev) => (prev.includes(fid) ? prev : [...prev, fid]))
      try {
        const children = await fetchFolderChildren(core40SDK, fid)
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const c of children) next[c.id] = { ...next[c.id], ...c }
          if (next[fid] && children.length === 0) {
            next[fid] = { ...next[fid], child_count: 0, has_children: false }
          }
          return next
        })
        setFolderChildrenById((prev) => {
          const existing = prev[fid] || []
          const merged = Array.from(new Set([...children.map((c) => c.id), ...existing]))
          return { ...prev, [fid]: merged }
        })
      } catch {
      } finally {
        setLoadingFolderIds((prev) => prev.filter((id) => id !== fid))
      }
    },
    [core40SDK]
  )

  const handleSearchFolders = useCallback(
    async (params: SearchLookerFoldersParams): Promise<LookerFolderNode[]> => {
      const results = await searchLookerFolders(core40SDK, params)
      if (results.length > 0) {
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const r of results) next[r.id] = { ...next[r.id], ...r }
          return next
        })
      }
      return results
    },
    [core40SDK]
  )

  useEffect(() => {
    const list = Object.values(folderTreeNodes).map((f) => ({
      id: String(f.id),
      name: `${f.name} (#${f.id})`,
    }))
    if (list.length > 0) setFolders(list)
  }, [folderTreeNodes])

  useEffect(() => {
    if (!selectedFolderId) return
    void hydrateFolderAncestors(selectedFolderId)
  }, [selectedFolderId, hydrateFolderAncestors])

  useEffect(() => {
    let mounted = true
    fetchInitialLookerMetadata(core40SDK)
      .then((meta) => {
        if (!mounted) return
        const resolvedUserId = String(meta.user?.id || '1')
        userIdRef.current = resolvedUserId
        setUserId(resolvedUserId)
        setCapabilities(meta.capabilities)
        if (meta.capabilities.rolesLoaded && meta.capabilities.sqlRunnerConnections.size === 0) {
          setHealthScope((prev) => (prev === 'all' || prev === 'bq' ? 'looker' : prev))
        }
        loadUserEnvironmentId(
          core40SDK,
          resolvedUserId,
          getArtifactNamespace(extensionSDK)
        ).then((savedEnvId) => {
          if (mounted && savedEnvId) {
            syncSharedEnvironmentId(savedEnvId)
          }
        })
        listUserLookmlSessions(core40SDK, extensionSDK, resolvedUserId).then((s) => {
          if (mounted) setLookmlSessions(s)
        })
        listSavedScripts(core40SDK, resolvedUserId)
          .then((items) => {
            if (mounted) setSavedScripts(items)
          })
          .catch(() => {})
        setAllModels(
          meta.models.map((m: any) => ({
            name: String(m.name),
            label: String(m.label || m.name),
            project_name: m.project_name ? String(m.project_name) : undefined,
            explores: (m.explores || []).filter((e: any) => !e.hidden),
          }))
        )
        const rawFolders = (meta.folders || []) as LookerFolderNode[]
        setFolderTreeNodes((prev) => {
          const next = { ...prev }
          for (const f of rawFolders) next[f.id] = { ...next[f.id], ...f }
          return next
        })
        setRootFolderIds(rawFolders.map((f) => String(f.id)))
        setFolders(
          rawFolders.map((f: any) => ({
            id: String(f.id),
            name: `${f.name} (#${f.id})`,
          }))
        )
        const targetInitialFolder = mockExt?.initialSelectedFolderId
          ? String(mockExt.initialSelectedFolderId)
          : meta.defaultFolderId
        setSelectedFolderId((prev) =>
          mockExt?.initialSelectedFolderId
            ? String(mockExt.initialSelectedFolderId)
            : prev === '1'
            ? meta.defaultFolderId
            : prev
        )
        if (!mockExt?.forceFolderSkeleton) setLoadingMetadata(false)
        void hydrateFolderAncestors(targetInitialFolder)
        refreshCatalog(resolvedUserId)
        loadUserConversations(
          core40SDK,
          resolvedUserId,
          getArtifactNamespace(extensionSDK)
        ).then((loadedConvs) => {
          if (mounted) setConversations(loadedConvs)
        })
      })
      .catch((err) => {
        if (!mockExt?.forceFolderSkeleton) setLoadingMetadata(false)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Failed to load Looker models: ${err.message}` },
        ])
      })
    return () => {
      mounted = false
    }
  }, [core40SDK, extensionSDK, syncSharedEnvironmentId, hydrateFolderAncestors])

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
        } catch (err: any) {
          return `# Error loading explore \`${id}\`\n${err?.message || err}`
        }
      })
    )
      .then((sections) => {
        if (mounted) setSchemaMarkdown(sections.filter(Boolean).join('\n\n---\n\n'))
      })
      .finally(() => {
        if (mounted) setLoadingSchema(false)
      })
    return () => {
      mounted = false
    }
  }, [core40SDK, selectedExplores, models])

  const handleCancelOAuthLogin = useCallback(() => {
    oauthAbortRef.current?.abort()
    oauthAbortRef.current = null
    setOauthSigningIn(false)
  }, [])

  const handleOAuthLogin = async () => {
    if (!clientId.trim()) {
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: 'Enter your Google Web OAuth 2.0 Client ID first.' },
      ])
      return
    }
    oauthAbortRef.current?.abort()
    const controller = new AbortController()
    oauthAbortRef.current = controller
    setOauthSigningIn(true)
    try {
      const token = await loginWithGoogleOAuth(extensionSDK, clientId, {
        signal: controller.signal,
        focusReturnDelayMs:
          typeof mockExt?.oauthFocusReturnDelayMs === 'number'
            ? mockExt.oauthFocusReturnDelayMs
            : 1500,
      })
      if (oauthAbortRef.current === controller) setOauthToken(token)
    } catch (err: any) {
      if (oauthAbortRef.current === controller && !controller.signal.aborted) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Google OAuth failed: ${err.message || err}` },
        ])
      }
    } finally {
      if (oauthAbortRef.current === controller) {
        oauthAbortRef.current = null
        setOauthSigningIn(false)
      }
    }
  }

  const runWithBusy = useCallback(
    async (statusText: string, errPrefix: string, fn: () => Promise<void>) => {
      try {
        setBusyStatus(statusText)
        await fn()
        setBusyStatus(mockExt?.initialBusyStatus || null)
      } catch (err: any) {
        setBusyStatus(mockExt?.initialBusyStatus || null)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `${errPrefix}: ${err?.message || err}` },
        ])
      }
    },
    [mockExt?.initialBusyStatus, setMessages]
  )

  const hydrateLoadedArtifact = useCallback(
    (opts: {
      mode: StudioMode; id: string; route: string; pushRoute: boolean; convTypes: string[]
      convId?: string; explores?: string[]; studio?: any; lastInteractionId?: string
      environmentId?: string; defaultEnvId: string; messages?: ChatMessage[]
      fallbackText: string; dashboardId?: string
    }) => {
      const explores = opts.explores ?? opts.studio?.explores?.filter(Boolean)
      const msgs = opts.messages ?? opts.studio?.messages
      setActiveObjectId(opts.id)
      setActiveConversationId((prev) => {
        if (opts.convId) return opts.convId
        const match = conversations.find((c) => {
          const cid = String(
            c.content?.dashboardId || c.content?.lookId || c.content?.lookmlDashboardId ||
            c.content?.reportId || c.content?.sessionId || c.content?.caConversationId || c.content?.id || ''
          )
          return cid === opts.id && opts.convTypes.includes(c.type)
        })
        const prefix = `conv_${opts.mode}_`
        return match ? match.id : prev.startsWith(prefix) ? prev : `${prefix}${opts.id}`
      })
      if (explores && explores.length > 0) setSelectedExplores(explores)
      setAgentSession(
        {
          lastInteractionId: opts.lastInteractionId || opts.studio?.lastInteractionId || opts.studio?.lastSession?.lastInteractionId,
          environmentId: sharedEnvIdRef.current || opts.environmentId || opts.studio?.environmentId || opts.studio?.lastSession?.environmentId || opts.defaultEnvId,
          conversationId: opts.id,
          explores,
          toolType: opts.mode,
        },
        opts.mode
      )
      setMessages(
        msgs?.length
          ? msgs
          : [{ role: 'assistant', text: opts.fallbackText, ...(opts.dashboardId ? { dashboardId: opts.dashboardId } : {}) }],
        opts.mode
      )
      if (opts.pushRoute && location.pathname !== opts.route) history.replace(opts.route)
    },
    [conversations, history, location.pathname, setAgentSession, setMessages]
  )

  const persistConversationAndLabel = useCallback(
    async (opts: {
      id: string; type: string; interactionId?: string; environmentId?: string; label?: string
      explores?: string[]; content?: Record<string, any>; messages: ChatMessage[]
      isFirstTurn?: boolean; userPrompt?: string; assistantText?: string; updateArtifactIndex?: boolean
    }) => {
      const namespace = getArtifactNamespace(extensionSDK)
      const auth: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
      const baseConv = {
        id: opts.id, type: opts.type, interactionId: opts.interactionId, environmentId: opts.environmentId,
        explores: opts.explores, ...(opts.content ? { content: opts.content } : {}), messages: opts.messages,
      }
      setActiveConversationId(opts.id)
      await saveUserConversation(
        core40SDK, userId,
        { ...baseConv, ...(opts.label ? { label: opts.label } : {}), updatedAt: new Date().toISOString() },
        namespace
      ).then(setConversations).catch(() => {})

      if (opts.isFirstTurn && opts.userPrompt && opts.assistantText) {
        void generateConversationLabel({
          extensionSDK, auth, environmentId: opts.environmentId,
          userPrompt: opts.userPrompt, assistantText: opts.assistantText, model: selectedModel,
        })
          .then(async (label) => {
            if (!label) return
            conversationLabelsRef.current[opts.id] = label
            setCaConversation((prev) => (prev && prev.id === opts.id ? { ...prev, label } : prev))
            setCatalogItems((prev) => prev.map((it) => (it.id === opts.id ? { ...it, label, title: label } : it)))
            setLookmlSessions((prev) => prev.map((s) => (s.id === opts.id ? { ...s, title: label } : s)))
            const updatedAt = new Date().toISOString()
            await saveUserConversation(core40SDK, userId, { ...baseConv, label, updatedAt }, namespace)
              .then(setConversations).catch(() => {})
            if (opts.updateArtifactIndex) {
              await saveUserArtifact(
                core40SDK, userId,
                {
                  id: opts.id, type: useCaseToStudioMode(studioModeToUseCase(opts.type)),
                  title: label, label, explores: opts.explores,
                  lastInteractionId: opts.interactionId, environmentId: opts.environmentId,
                  updatedAt, createdBy: userId,
                },
                undefined, namespace
              ).catch(() => {})
            }
          })
          .catch(() => {})
      }
    },
    [apiKey, authMode, clientId, core40SDK, extensionSDK, oauthToken, projectId, selectedModel, userId]
  )

  const loadDashboardById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(`Loading Data App from dashboard #${id}...`, `Could not load dashboard #${id}`, async () => {
        const loaded = await loadExistingDashboardApp(core40SDK, id)
        lastPublishedIdRef.current = loaded.dashboardId
        resolvedUseCaseByIdRef.current[loaded.dashboardId] = 'app'
        setSelectedUseCase('app')
        setLockedByTurn(true)
        setPublishedApp(loaded)
        setCurrentAppCode(loaded.code)
        setLoadDashInput(loaded.dashboardId)
        setSelectedFolderId(loaded.folderId)
        const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
        const legacyExplore =
          loaded.studio?.modelName && loaded.studio?.exploreName
            ? [formatExploreId(loaded.studio.modelName, loaded.studio.exploreName)]
            : []
        const queryExplores = Array.from(
          new Set((loaded.manifestQueries || []).filter((q) => q.model && q.explore).map((q) => formatExploreId(q.model, q.explore)))
        )
        const resolvedExplores =
          studioExplores.length > 0 ? studioExplores
          : legacyExplore.length > 0 ? legacyExplore
          : queryExplores.length > 0 ? queryExplores
          : extractExploreIdsFromCode(loaded.code)
        setSelectedExplores(resolvedExplores)
        hydrateLoadedArtifact({
          mode: 'app', id: loaded.dashboardId, route: `/c/${encodeURIComponent(loaded.dashboardId)}`,
          pushRoute, convTypes: ['app', 'data_app'], explores: resolvedExplores, studio: loaded.studio,
          defaultEnvId: 'env_app_42', dashboardId: loaded.dashboardId,
          fallbackText: `Loaded existing Data App "${loaded.title}" (Dashboard #${loaded.dashboardId}, ${loaded.code.length.toLocaleString()} bytes). Describe any changes to update it in place.`,
        })
      })
    },
    [core40SDK, hydrateLoadedArtifact, runWithBusy]
  )

  const loadNativeById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(`Loading native Looker content #${id}...`, `Could not load native content #${id}`, async () => {
        const loaded = await loadNativeContentById(core40SDK, extensionSDK, id)
        lastNativeIdRef.current = loaded.id
        resolvedUseCaseByIdRef.current[loaded.id] = 'dashboard'
        setSelectedUseCase('dashboard')
        setLockedByTurn(true)
        setNativeContent(loaded)
        setLoadDashInput(loaded.id)
        setSelectedFolderId(loaded.folderId)
        hydrateLoadedArtifact({
          mode: 'dashboard', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['dashboard'], studio: loaded.studio, defaultEnvId: 'env_dashboard_7',
          dashboardId: loaded.id,
          fallbackText: `Loaded native Looker ${loaded.contentType} "${loaded.title}" (#${loaded.id}). Ask for tiles, filters, looks, boards, or schedules to update it via CodeMode.`,
        })
      })
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, runWithBusy]
  )

  const loadHealthCheckById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(`Loading Health Check report "${id}"...`, `Could not load Health Check "${id}"`, async () => {
        const loaded = await loadHealthCheckArtifact(core40SDK, extensionSDK, id)
        lastHealthIdRef.current = loaded.id
        resolvedUseCaseByIdRef.current[loaded.id] = 'health-check'
        setSelectedUseCase('health-check')
        setLockedByTurn(true)
        setHealthReport(loaded)
        setLoadDashInput(loaded.id)
        hydrateLoadedArtifact({
          mode: 'health', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['health', 'health-check', 'health_check'], studio: loaded,
          defaultEnvId: `env_health_${loaded.id}`,
          fallbackText: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00) from obj_health_check_${loaded.id}.`,
        })
      })
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, runWithBusy]
  )

  const loadLookmlSessionById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(`Loading LookML session "${id}"...`, `Could not load LookML session "${id}"`, async () => {
        const loaded = await loadLookmlSessionArtifact(core40SDK, extensionSDK, id)
        lastLookmlIdRef.current = loaded.id
        resolvedUseCaseByIdRef.current[loaded.id] = 'lookml'
        setSelectedUseCase('lookml')
        setLockedByTurn(true)
        setLookmlBundle(loaded.bundle)
        setLoadLookmlInput(loaded.id)
        if (loaded.bundle?.project_id) setLookmlProjectId(loaded.bundle.project_id)
        setSelectedExplores(loaded.studio?.explores?.filter(Boolean) || [])
        hydrateLoadedArtifact({
          mode: 'lookml', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['lookml'], studio: loaded.studio, defaultEnvId: `env_lookml_${loaded.id}`,
          fallbackText: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} modified .lkml files).`,
        })
      })
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, runWithBusy]
  )

  const handleRunPython = useCallback(
    async (codeToRun = scriptCode, rawFilters = filtersJson) => {
      try {
        setBusyStatus('Running Python in WASM Monty sandbox...')
        let parsedFilters: Record<string, string> = {}
        try {
          parsedFilters = JSON.parse(rawFilters || '{}')
        } catch {
          parsedFilters = {}
        }
        const out = await LkrCodeMode.runPythonCode({
          code: codeToRun,
          sdk: core40SDK,
          extensionSDK,
          vars: {
            mode: scriptMode,
            dashboard_filters: { script_mode: scriptMode, ...parsedFilters },
            target_explores: selectedExplores,
            target_folder_id: selectedFolderId,
          },
        })
        setScriptOutput(out)
        return out
      } catch (err: any) {
        const errOut = JSON.stringify({ error: err?.message || String(err) })
        setScriptOutput(errOut)
        return errOut
      } finally {
        setBusyStatus(mockExt?.initialBusyStatus || null)
      }
    },
    [core40SDK, extensionSDK, filtersJson, mockExt?.initialBusyStatus, scriptCode, scriptMode, selectedExplores, selectedFolderId]
  )

  const loadScriptById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastScriptIdRef.current = id
      resolvedUseCaseByIdRef.current[id] = 'tile'
      setSelectedUseCase('tile')
      setLockedByTurn(true)
      setLoadedScript(true)
      setScriptId(id)
      const loaded = await loadScriptArtifact(core40SDK, id)
      const effectiveCode = loaded?.code || scriptCode
      if (loaded) {
        setScriptId(loaded.id)
        setScriptTitle(loaded.title || loaded.id)
        setScriptCode(loaded.code || DEFAULT_PYTHON_SCRIPT)
        if (loaded.dashboardId) {
          setPublishedTileDash({ dashboardId: loaded.dashboardId, elementId: loaded.elementId || '' })
        }
      }
      hydrateLoadedArtifact({
        mode: 'tile', id: loaded?.id || id, route: `/c/${encodeURIComponent(loaded?.id || id)}`,
        pushRoute, convTypes: ['tile', 'script'], studio: loaded,
        messages: loaded?.messages as ChatMessage[] | undefined, defaultEnvId: 'env_tile_isolated',
        fallbackText: loaded ? `Loaded script "${loaded.title}" (${loaded.id}).` : `Opened Script "${scriptTitle}" (${id}).`,
      })
      await handleRunPython(effectiveCode, filtersJson)
    },
    [core40SDK, filtersJson, handleRunPython, hydrateLoadedArtifact, scriptCode, scriptTitle]
  )

  const handleSaveScript = useCallback(
    async (overrideCode = scriptCode, overrideMsgs = messages, dashInfo = publishedTileDash): Promise<SavedScript> => {
      const cleanId = scriptId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `script_${Date.now().toString(36).slice(-5)}`
      setBusyStatus(`Saving script "${cleanId}" to Looker Artifacts...`)
      try {
        const saved = await saveScriptArtifact(core40SDK, userId, {
          id: cleanId,
          title: scriptTitle.trim() || cleanId,
          code: overrideCode,
          messages: overrideMsgs,
          updatedAt: new Date().toISOString(),
          ...(dashInfo?.dashboardId ? { dashboardId: dashInfo.dashboardId } : {}),
          ...(dashInfo?.elementId ? { elementId: dashInfo.elementId } : {}),
        })
        lastScriptIdRef.current = saved.id
        resolvedUseCaseByIdRef.current[saved.id] = 'tile'
        setLoadedScript(true)
        setScriptId(saved.id)
        setSavedScripts(await listSavedScripts(core40SDK, userId))
        await refreshCatalog()
        const targetRoute = `/c/${encodeURIComponent(saved.id)}`
        if (location.pathname !== targetRoute) history.replace(targetRoute)
        return saved
      } finally {
        setBusyStatus(mockExt?.initialBusyStatus || null)
      }
    },
    [core40SDK, history, location.pathname, messages, mockExt?.initialBusyStatus, publishedTileDash, refreshCatalog, scriptCode, scriptId, scriptTitle, userId]
  )

  const handlePublishTileDashboard = useCallback(async () => {
    try {
      const saved = await handleSaveScript()
      setBusyStatus('Publishing extension-layout Looker dashboard & binding tile artifact...')
      const extId = (extensionSDK as any)?.lookerHostData?.extensionId || 'data_app_builder::data_app_builder'
      const pub = await publishScriptDashboard(core40SDK, {
        script: saved,
        folderId: selectedFolderId,
        extensionId: extId,
        existingDashboardId: publishedTileDash?.dashboardId,
      })
      const nextDash = { dashboardId: pub.dashboardId, elementId: pub.elementId }
      setPublishedTileDash(nextDash)
      await handleSaveScript(saved.code, saved.messages || [], nextDash)
      setMessages(
        (prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Published Dashboard #${pub.dashboardId} (load_configuration="wait", show_dashboard_header=true, layout="extension") and bound tile_element_${pub.elementId} -> ${saved.id}.`,
            dashboardId: pub.dashboardId,
          },
        ],
        'tile'
      )
    } catch (err: any) {
      setBusyStatus(mockExt?.initialBusyStatus || null)
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }], 'tile')
    }
  }, [core40SDK, extensionSDK, handleSaveScript, mockExt?.initialBusyStatus, publishedTileDash?.dashboardId, selectedFolderId, setMessages])

  const loadCaConversationById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(
        `Loading Conversational Analytics session "${id}"...`,
        `Could not load Conversational Analytics session "${id}"`,
        async () => {
          const loaded = await loadObjectArtifact<any>(core40SDK, 'conversational-analytics', id, getArtifactNamespace(extensionSDK))
          const convFromList = conversations.find((c) => c.id === id || String(c.content?.caConversationId || c.content?.id || '') === id)
          const content = loaded || convFromList?.content || {}
          const agentId = String(content.agentId || content.agent_id || 'ad69f74cd9e2494090e9e9e9c50190c8')
          const agentName = String(content.agentName || content.agent_name || 'Looker CA Agent')
          const caConvId = String(content.caConversationId || content.id || id)
          const explores = Array.isArray(content.explores) ? content.explores : convFromList?.explores || []
          const resolvedTitle = String(content.title || content.label || convFromList?.label || id)
          const resolvedRationale = String(
            content.selectionRationale || content.rationale || `Routed to Looker CA agent "${agentName}" (${agentId}) via isolated sub-agent.`
          )
          const state: CaConversationState = {
            id: caConvId,
            caConversationId: caConvId,
            agentId,
            agentName,
            embedPath: content.embedPath || resolveCaEmbedPath(agentId, caConvId),
            title: resolvedTitle,
            label: resolvedTitle,
            rationale: resolvedRationale,
            selectionRationale: resolvedRationale,
            initialPrompt: String(content.initialPrompt || content.title || convFromList?.label || id),
            explores,
            interactionId: content.studio?.lastInteractionId || content.lastInteractionId || convFromList?.interactionId,
            updatedAt: String(content.updatedAt || convFromList?.updatedAt || new Date().toISOString()),
          }
          lastCaIdRef.current = caConvId
          resolvedUseCaseByIdRef.current[caConvId] = 'conversational-analytics'
          setCaConversation(state)
          setSelectedUseCase('conversational-analytics')
          setLockedByTurn(true)
          setLoadDashInput(caConvId)
          const msgs = content.studio?.messages || content.messages || convFromList?.messages
          hydrateLoadedArtifact({
            mode: 'app',
            id: caConvId,
            route: `/c/${encodeURIComponent(caConvId)}`,
            pushRoute,
            convTypes: ['conversational-analytics'],
            convId: convFromList?.id || caConvId,
            explores,
            lastInteractionId: state.interactionId,
            defaultEnvId: 'env_app_isolated',
            messages:
              Array.isArray(msgs) && msgs.length > 0
                ? msgs
                : [
                    { role: 'user', text: state.initialPrompt },
                    {
                      role: 'assistant',
                      text: `Routed via isolated CA sub-agent to **${state.agentName}** (\`${state.agentId}\`) and opened embedded Looker CA conversation \`${state.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${state.rationale}`,
                      interactionId: state.interactionId,
                    },
                  ],
            fallbackText: state.rationale,
          })
        }
      )
    },
    [conversations, core40SDK, extensionSDK, hydrateLoadedArtifact, runWithBusy]
  )

  const handleRunConversationalAnalytics = async (userQuestion: string, baseMessages: ChatMessage[]) => {
    const auth: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const isFirstTurn = baseMessages.filter((m) => m.role === 'user').length <= 1
    try {
      const selection = await selectCaAgentViaIsolatedSubagent({
        sdk: core40SDK, extensionSDK, auth, userQuestion, model: selectedModel, onStatus: setBusyStatus,
      })
      setBusyStatus(`Creating Looker CA conversation with "${selection.agentName}"...`)
      const created = await createLookerCaConversation(core40SDK, selection.agentId, userQuestion, selection.agentName)
      const assistantText = `Routed via isolated CA sub-agent to **${selection.agentName}** (\`${selection.agentId}\`) and opened embedded Looker CA conversation \`${created.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${selection.rationale}`
      const nextMsgs: ChatMessage[] = [
        ...baseMessages,
        { role: 'assistant', text: assistantText, interactionId: selection.isolatedInteractionId },
      ]
      const nextCaState: CaConversationState = {
        id: created.caConversationId,
        caConversationId: created.caConversationId,
        agentId: selection.agentId,
        agentName: selection.agentName,
        embedPath: created.embedPath,
        title: created.label,
        label: created.label,
        rationale: selection.rationale,
        selectionRationale: selection.rationale,
        initialPrompt: userQuestion,
        explores: selection.explores.length > 0 ? selection.explores : selectedExplores,
        interactionId: selection.isolatedInteractionId,
        updatedAt: new Date().toISOString(),
      }
      lastCaIdRef.current = created.caConversationId
      resolvedUseCaseByIdRef.current[created.caConversationId] = 'conversational-analytics'
      setCaConversation(nextCaState)
      setSelectedUseCase('conversational-analytics')
      setLockedByTurn(true)
      setActiveObjectId(created.caConversationId)
      setLoadDashInput(created.caConversationId)
      if (selection.explores.length > 0) setSelectedExplores(selection.explores)
      setMessages(nextMsgs, 'app')
      const targetRoute = `/c/${encodeURIComponent(created.caConversationId)}`
      if (location.pathname !== targetRoute) {
        history.replace(targetRoute)
      }

      const namespace = getArtifactNamespace(extensionSDK)
      await saveUserArtifact(
        core40SDK,
        userId,
        {
          id: created.caConversationId,
          type: 'conversational-analytics',
          title: created.label,
          label: created.label,
          explores: nextCaState.explores,
          lastInteractionId: selection.isolatedInteractionId,
          updatedAt: nextCaState.updatedAt,
          createdBy: userId,
        },
        {
          ...nextCaState,
          type: 'conversational-analytics',
          title: created.label,
          studio: { explores: nextCaState.explores, lastInteractionId: selection.isolatedInteractionId, messages: nextMsgs },
          createdBy: userId,
        },
        namespace
      ).catch(() => {})
      await persistConversationAndLabel({
        id: created.caConversationId,
        type: 'conversational-analytics',
        interactionId: selection.isolatedInteractionId,
        environmentId: sharedEnvIdRef.current || agentSession.environmentId,
        label: created.label,
        explores: nextCaState.explores,
        content: {
          agentId: selection.agentId,
          agentName: selection.agentName,
          caConversationId: created.caConversationId,
          embedPath: created.embedPath,
          rationale: selection.rationale,
        },
        messages: nextMsgs,
        isFirstTurn,
        userPrompt: userQuestion,
        assistantText,
      })
      await refreshCatalog()
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }], 'app')
    } finally {
      setBusyStatus(null)
    }
  }

  const handleRunHealthCheck = async (customFocus?: string, baseMessages?: ChatMessage[], images?: PastedImage[]) => {
    const activeMsgs = baseMessages || messages
    try {
      const baseRes = await runThreePillarHealthCheckViaCodeMode({
        sdk: core40SDK,
        extensionSDK,
        reportId: healthReport?.id || loadDashInput.trim() || undefined,
        targetProject: lookmlProjectId || availableLookmlProjects[0],
        healthScope,
        customFocus,
        messages: activeMsgs,
        onStatus: setBusyStatus,
      })
      let finalReport = baseRes.report
      if (customFocus && (authMode === 'apikey' || oauthToken)) {
        try {
          const turnRes = await runAntigravityTurn({
            sdk: core40SDK,
            extensionSDK,
            userId,
            environmentId: sharedEnvIdRef.current || agentSession.environmentId,
            conversationId: finalReport.id,
            onEnvironmentUpdated: syncSharedEnvironmentId,
            auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
            session: agentSession,
            model: selectedModel,
            selectedExplores,
            folderId: selectedFolderId,
            schemaMarkdown,
            userPrompt: customFocus,
            images,
            customSystemGuide: HEALTH_CHECK_SYSTEM_GUIDE,
            extraSources: [
              { type: 'inline', content: THREE_PILLAR_CODEMODE_PY, target: '/workspace/three_pillar_audit.py' },
              { type: 'inline', content: finalReport.tddMarkdown, target: '/workspace/TECHNICAL_DESIGN_DOCUMENT.md' },
            ],
            priorMessages: messages,
            onStatus: setBusyStatus,
          })
          setAgentSession(turnRes.session)
          if (turnRes.tddMarkdown) {
            finalReport = {
              ...finalReport,
              tddMarkdown: turnRes.tddMarkdown,
              lastInteractionId: turnRes.session.lastInteractionId,
              environmentId: turnRes.session.environmentId,
              updatedAt: new Date().toISOString(),
            }
            await saveHealthCheckArtifact(core40SDK, extensionSDK, userId, finalReport)
          }
        } catch {}
      }
      lastHealthIdRef.current = finalReport.id
      resolvedUseCaseByIdRef.current[finalReport.id] = 'health-check'
      setHealthReport(finalReport)
      setActiveObjectId(finalReport.id)
      setLoadDashInput(finalReport.id)
      const targetRoute = `/c/${encodeURIComponent(finalReport.id)}`
      if (location.pathname !== targetRoute) {
        history.replace(targetRoute)
      }
      const nextHealthMsgs: ChatMessage[] = [
        ...activeMsgs,
        {
          role: 'assistant',
          text: `3-Pillar Health Check complete: **${finalReport.scores.overallScore}% (${finalReport.scores.grade})** | Pillar 1: ${finalReport.scores.pillar1Score}% · Pillar 2: ${finalReport.scores.pillar2Score}% (Transcriber ${finalReport.scores.transcriberScore}/4.00) · Pillar 3: ${finalReport.scores.pillar3Score}%.\nSaved to \`${baseRes.userKey}\` and \`${baseRes.objKey}\`.`,
        },
      ]
      setMessages(nextHealthMsgs, 'health')
      const convId = activeConversationId.startsWith('conv_health_') ? activeConversationId : `conv_health_${finalReport.id}`
      setSelectedUseCase('health-check')
      setLockedByTurn(true)
      void persistConversationAndLabel({
        id: convId,
        type: 'health-check',
        interactionId: finalReport.lastInteractionId || agentSession.lastInteractionId,
        environmentId: finalReport.environmentId || agentSession.environmentId,
        label: finalReport.title,
        explores: selectedExplores,
        content: {
          reportId: finalReport.id,
          projectId: finalReport.projectId,
          overallScore: finalReport.scores.overallScore,
          grade: finalReport.scores.grade,
        },
        messages: nextHealthMsgs,
      })
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    } finally {
      setBusyStatus(null)
    }
  }

  const openArtifactByMode = useCallback(
    async (typeOrMode: string, id: string, pushRoute: boolean) => {
      if (!id) return
      const loaders: Record<string, (id: string, pushRoute: boolean) => Promise<void>> = {
        'conversational-analytics': loadCaConversationById,
        app: loadDashboardById,
        dashboard: loadNativeById,
        lookml: loadLookmlSessionById,
        health: loadHealthCheckById,
        tile: loadScriptById,
      }
      if (typeOrMode === 'auto') {
        const ns = getArtifactNamespace(extensionSDK)
        const probes: Array<[string, string]> = [
          ['conversational-analytics', 'conversational-analytics'],
          ['lookml', 'lookml'],
          ['health_check', 'health'],
          ['script', 'tile'],
          ['dashboard', 'dashboard'],
        ]
        for (const [artifactType, loaderKey] of probes) {
          if (await loadObjectArtifact(core40SDK, artifactType as any, id, ns)) {
            return loaders[loaderKey](id, pushRoute)
          }
        }
        return loadDashboardById(id, pushRoute)
      }
      const fn = loaders[typeOrMode] || loaders[normalizeCatalogMode(typeOrMode)]
      if (fn) return fn(id, pushRoute)
      const loaded = await loadObjectArtifact(core40SDK, typeOrMode as any, id)
      if (loaded?.messages) setMessages(loaded.messages)
    },
    [core40SDK, extensionSDK, loadCaConversationById, loadDashboardById, loadHealthCheckById, loadLookmlSessionById, loadNativeById, loadScriptById, setMessages]
  )

  useEffect(() => {
    if (isTileMount || location.pathname === '/config') return
    if (disabledModes.includes(activeMode)) {
      setSelectedUseCase('auto')
      if (location.pathname !== '/') history.replace('/')
      return
    }
    if (!isConfigured && activeMode !== 'tile') {
      history.replace('/config')
      return
    }
    if (parsedRoute.isLegacyRoute) {
      if (parsedRoute.objectId) {
        if (parsedRoute.useCase && parsedRoute.useCase !== 'auto') {
          resolvedUseCaseByIdRef.current[parsedRoute.objectId] = parsedRoute.useCase
          setSelectedUseCase(parsedRoute.useCase)
        }
        const target = `/c/${encodeURIComponent(parsedRoute.conversationId || parsedRoute.objectId)}`
        if (location.pathname !== target) history.replace(target)
      } else {
        if (parsedRoute.useCase && parsedRoute.useCase !== 'auto') {
          setSelectedUseCase(parsedRoute.useCase)
        }
        if (location.pathname !== '/') history.replace('/')
      }
    }
  }, [isTileMount, isConfigured, location.pathname, activeMode, disabledModes, parsedRoute, history])

  useEffect(() => {
    if (isTileMount || location.pathname === '/config' || disabledModes.includes(activeMode)) return
    const id = parsedRoute.objectId
    if (!id) return
    const loadedPair: [string | undefined, string] = isCaMode
      ? [caConversation?.caConversationId, lastCaIdRef.current]
      : activeMode === 'lookml'
      ? [lookmlBundle?.id, lastLookmlIdRef.current]
      : activeMode === 'health'
      ? [healthReport?.id, lastHealthIdRef.current]
      : activeMode === 'dashboard'
      ? [nativeContent?.id, lastNativeIdRef.current]
      : activeMode === 'tile'
      ? [loadedScript ? scriptId : undefined, lastScriptIdRef.current]
      : [publishedApp?.dashboardId, lastPublishedIdRef.current]
    if (id !== loadedPair[0] && id !== loadedPair[1]) {
      const dispatchType = isCaMode
        ? 'conversational-analytics'
        : parsedRoute.useCase === 'auto' && !inferredRouteUseCase
        ? 'auto'
        : activeMode
      void openArtifactByMode(dispatchType, id, false)
    }
  }, [
    isTileMount, location.pathname, activeMode, disabledModes, parsedRoute.objectId, parsedRoute.useCase,
    inferredRouteUseCase, isCaMode, publishedApp?.dashboardId, nativeContent?.id, lookmlBundle?.id,
    healthReport?.id, caConversation?.caConversationId, loadedScript, scriptId, openArtifactByMode,
  ])

  const handleLoadExistingDashboard = async () => {
    await openArtifactByMode(isHealthCheckMode ? 'health' : isCaMode ? 'conversational-analytics' : builderMode, loadDashInput, true)
  }

  const handleResetNewApp = (resetToDefaultRoute?: boolean | React.MouseEvent) => {
    const forceDefaultRoute = resetToDefaultRoute === true
    lastPublishedIdRef.current = ''
    lastNativeIdRef.current = ''
    lastLookmlIdRef.current = ''
    lastHealthIdRef.current = ''
    lastCaIdRef.current = ''
    lastScriptIdRef.current = ''
    setLoadedScript(false)
    setActiveObjectId('')
    setActiveConversationId(`conv_${Date.now()}`)
    setPublishedApp(null)
    setNativeContent(null)
    setLookmlBundle(null)
    setHealthReport(null)
    setCaConversation(null)
    setCurrentAppCode('')
    setLoadDashInput('')
    setLoadLookmlInput('')
    setSelectedExplores([])
    setAgentSession({
      environmentId: sharedEnvIdRef.current || undefined,
      lastInteractionId: undefined,
      conversationId: `conv_${Date.now().toString(36)}`,
    })
    setMessages([])
    if (forceDefaultRoute) setMessages([], 'app')
    setPastedImages([])
    setPrompt('')
    setLockedByTurn(false)
    setSelectedUseCase('auto')
    if (location.pathname !== '/') history.push('/')
  }

  const handleNewConversation = () => handleResetNewApp(true)

  const handleSelectConversation = async (conv: ConversationRecord) => {
    const useCase = studioModeToUseCase(conv.type)
    const mode = normalizeCatalogMode(conv.type)
    resolvedUseCaseByIdRef.current[conv.id] = useCase
    setSelectedUseCase(useCase)
    setLockedByTurn(true)
    setActiveConversationId(conv.id)
    if (conv.explores?.length) setSelectedExplores(conv.explores)
    const c = conv.content || {}
    const targetId = String(
      (conv.type === 'conversational-analytics' && (c.caConversationId || c.id || conv.id)) ||
        c.dashboardId ||
        c.lookId ||
        c.lookmlDashboardId ||
        c.sessionId ||
        c.reportId ||
        c.scriptId ||
        c.id ||
        ''
    )
    if (targetId) {
      resolvedUseCaseByIdRef.current[targetId] = useCase
      setActiveObjectId(targetId)
      await openArtifactByMode(conv.type, targetId, true)
    } else {
      const targetPath = `/c/${encodeURIComponent(conv.id)}`
      if (location.pathname !== targetPath) history.push(targetPath)
    }
    setActiveConversationId(conv.id)
    if (conv.messages?.length) {
      setMessages(conv.messages as ChatMessage[], mode)
    }
    if (conv.interactionId || conv.environmentId || sharedEnvIdRef.current) {
      setAgentSession(
        {
          lastInteractionId: conv.interactionId,
          environmentId: sharedEnvIdRef.current || conv.environmentId || `env_${mode}_isolated`,
          conversationId: conv.id,
          explores: conv.explores,
          toolType: mode,
        },
        mode
      )
    }
  }

  const handleToggleArchiveConversation = async (
    e: React.MouseEvent | undefined,
    conversationId: string,
    nextArchived?: boolean
  ) => {
    e?.stopPropagation()
    const current = conversations.find((c) => c.id === conversationId)
    const archived = typeof nextArchived === 'boolean' ? nextArchived : !current?.archived
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, archived } : c))
    )
    try {
      const next = await archiveUserConversation(
        core40SDK,
        userIdRef.current || userId,
        conversationId,
        archived,
        getArtifactNamespace(extensionSDK)
      )
      setConversations(next)
    } catch {}
  }

  const handleRequestDeleteConversation = (
    e: React.MouseEvent | undefined,
    convOrId: ConversationRecord | string
  ) => {
    e?.stopPropagation()
    const target =
      typeof convOrId === 'string'
        ? conversations.find((c) => c.id === convOrId) || {
            id: convOrId,
            type: 'app',
            label: convOrId,
            updatedAt: '',
          }
        : convOrId
    setDeleteRelatedContent(false)
    setPendingDeleteConv(target)
  }

  const handleCancelDeleteConversation = () => {
    setPendingDeleteConv(null)
    setDeleteRelatedContent(false)
  }

  const handleDeleteConversation = async (
    e: React.MouseEvent | undefined,
    conversationId: string,
    deleteRelated = false,
    explicitTarget?: ConversationRecord
  ) => {
    e?.stopPropagation()
    const target = explicitTarget || conversations.find((c) => c.id === conversationId)
    setConversations((prev) => prev.filter((c) => c.id !== conversationId))
    try {
      const next = await deleteUserConversation(
        core40SDK,
        userIdRef.current || userId,
        conversationId,
        { deleteRelatedContent: deleteRelated, conversation: target },
        getArtifactNamespace(extensionSDK)
      )
      setConversations(next)
      await refreshCatalog(userIdRef.current || userId)
    } catch {}
    if (activeConversationId === conversationId) {
      handleResetNewApp()
    }
  }

  const handleConfirmDeleteConversation = async (overrideDeleteRelated?: boolean) => {
    if (!pendingDeleteConv) return
    const target = pendingDeleteConv
    const shouldDeleteRelated =
      typeof overrideDeleteRelated === 'boolean' ? overrideDeleteRelated : deleteRelatedContent
    setPendingDeleteConv(null)
    setDeleteRelatedContent(false)
    await handleDeleteConversation(undefined, target.id, shouldDeleteRelated, target)
  }

  const handleSendPrompt = async () => {
    const text = prompt.trim()
    if (!isAuthenticated || (!text && pastedImages.length === 0) || busyStatus) return
    const auth: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const attachedImages = pastedImages
    const effectivePrompt = text || 'See the attached screenshot.'
    const isFirstTurn = messages.filter((m) => m.role === 'user').length === 0
    const userMsg: ChatMessage = {
      role: 'user',
      text: effectivePrompt,
      images: attachedImages.map((img) => img.dataUrl),
    }
    const messagesWithUser = [...messages, userMsg]
    setPrompt('')
    setPastedImages([])
    setMessages(messagesWithUser)
    setLockedByTurn(true)

    if (isHealthCheckMode || selectedUseCase === 'health-check') {
      setSelectedUseCase('health-check')
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
      await refreshCatalog()
      return
    }

    if (
      selectedUseCase === 'conversational-analytics' ||
      isCaMode ||
      (isFirstTurn &&
        selectedUseCase === 'auto' &&
        extractResolvedUseCase('', effectivePrompt, allowedUseCases) === 'conversational-analytics')
    ) {
      setSelectedUseCase('conversational-analytics')
      await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser)
      return
    }

    const activeConvId =
      parsedRoute.objectId ||
      activeObjectId ||
      agentSession.conversationId ||
      (activeMode === 'app'
        ? publishedApp?.dashboardId
        : activeMode === 'dashboard'
        ? nativeContent?.id
        : activeMode === 'lookml'
        ? lookmlBundle?.id
        : activeMode === 'tile'
        ? scriptId
        : healthReport?.id) ||
      'current'

    setBusyStatus('Connecting to Antigravity...')
    setLiveActivitySteps([])
    try {
      const effectiveLookmlTurn = isLookmlMode || selectedUseCase === 'lookml'
      const effectiveBuilderMode: 'data_app' | 'dashboard' =
        selectedUseCase === 'dashboard' ? 'dashboard' : builderMode
      const result = await runAntigravityTurn({
        sdk: core40SDK,
        extensionSDK,
        userId,
        environmentId: sharedEnvIdRef.current || agentSession.environmentId,
        conversationId: activeConvId,
        onEnvironmentUpdated: syncSharedEnvironmentId,
        auth,
        session: agentSession,
        model: selectedModel,
        mode: effectiveBuilderMode,
        useCase: selectedUseCase,
        allowedModes: allowedUseCases,
        selectedExplores,
        folderId: selectedFolderId,
        toolMode: effectiveLookmlTurn ? 'lookml' : 'data_app',
        lookmlProjectId,
        activatedLookmlSkills,
        developableProjects: availableLookmlProjects,
        canDeploy: canDeployLookml,
        schemaMarkdown,
        userPrompt:
          activeMode === 'tile' || selectedUseCase === 'tile'
            ? `Write a LkrCodeMode Python script for the user's request. Return the Python snippet inside a \`\`\`python code block.\n\nCurrent script:\n\`\`\`python\n${scriptCode}\n\`\`\`\n\nUser request: ${effectivePrompt}`
            : effectivePrompt,
        images: attachedImages,
        existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent,
        priorMessages: messages,
        requirePermission,
        approvedOperations: approvedOpsRef.current,
        onPermissionRequest: requestCodeModePermission,
        onProgressSteps: setLiveActivitySteps,
        onStatus: setBusyStatus,
      })

      const resolvedUseCase: ResolvedStudioUseCase =
        selectedUseCase !== 'auto'
          ? selectedUseCase
          : result.resolvedUseCase ||
            extractResolvedUseCase(result.assistantText, effectivePrompt, allowedUseCases)
      setSelectedUseCase(resolvedUseCase)
      if (resolvedUseCase === 'conversational-analytics') {
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser)
        return
      }
      const resolvedMode: StudioMode = useCaseToStudioMode(resolvedUseCase)

      let convId = activeObjectId || activeConversationId || result.session.lastInteractionId || 'conv_1'
      let convType: string = resolvedUseCase
      let convTitle = ''
      let convExplores = selectedExplores
      let convContent: Record<string, any> | undefined
      let finalMsgs: ChatMessage[] = []

      if (result.lookmlBundle) {
        setBusyStatus('Saving LookML session artifacts (user_..._lookml_... & obj_lookml_...)...')
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant',
            text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            activitySteps: result.activitySteps,
            thinkingDurationSec: result.thinkingDurationSec,
          },
        ]
        setLookmlBundle(result.lookmlBundle)
        if (result.lookmlBundle.project_id) setLookmlProjectId(result.lookmlBundle.project_id)
        convId = result.lookmlBundle.id || 'lookml_1'
        convType = 'lookml'
        convTitle = result.lookmlBundle.title
        try {
          const saved = await saveLookmlSessionArtifact({
            sdk: core40SDK,
            extensionSDK,
            userId,
            bundle: result.lookmlBundle,
            studio: {
              explores: selectedExplores,
              lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
              messages: finalMsgs,
            },
          })
          convId = saved.id
          resolvedUseCaseByIdRef.current[saved.id] = 'lookml'
          convContent = {
            sessionId: saved.id,
            projectId: result.lookmlBundle.project_id,
            model: result.lookmlBundle.model_name,
            branch: result.lookmlBundle.branch_name,
          }
          lastLookmlIdRef.current = saved.id
          setActiveObjectId(saved.id)
          setLoadLookmlInput(saved.id)
          setLookmlSessions((prev) => [
            saved.index,
            ...prev.filter((s) => s.id !== saved.id),
          ])
          await refreshCatalog()
          const targetRoute = `/c/${encodeURIComponent(saved.id)}`
          if (location.pathname !== targetRoute) {
            history.replace(targetRoute)
          }
        } catch {}
        setAgentSession({ ...result.session, explores: selectedExplores }, 'lookml')
        setMessages(finalMsgs, 'lookml')
      } else if (resolvedUseCase === 'tile') {
        const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
        const extractedPy = pyMatch ? pyMatch[1].trim() : ''
        const nextCode = extractedPy || scriptCode
        if (extractedPy) setScriptCode(extractedPy)
        await handleRunPython(nextCode, filtersJson)
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant',
            text: result.assistantText || 'Updated Python script and executed in WASM Monty sandbox.',
            interactionId: result.session.lastInteractionId,
            activitySteps: result.activitySteps,
            thinkingDurationSec: result.thinkingDurationSec,
          },
        ]
        setAgentSession({ ...result.session, explores: selectedExplores }, 'tile')
        setMessages(finalMsgs, 'tile')
        try {
          const saved = await handleSaveScript(nextCode, finalMsgs, publishedTileDash)
          convId = `conv_tile_${saved.id}`
          convType = 'tile'
          convTitle = saved.title
          convContent = { scriptId: saved.id, dashboardId: saved.dashboardId, elementId: saved.elementId }
          setActiveObjectId(saved.id)
        } catch {}
      } else {
        const bundleExplores = result.bundle
          ? Array.from(
              new Set([
                ...(result.bundle.widgets || [])
                  .filter((w) => w.query?.model && w.query?.view)
                  .map((w) => formatExploreId(w.query.model, w.query.view)),
                ...extractExploreIdsFromCode(result.bundle.raw_code || ''),
              ])
            )
          : result.nativeBundle?.explores || []
        const effectiveExplores =
          selectedExplores.length > 0 ? selectedExplores : bundleExplores
        convExplores = effectiveExplores
        if (selectedExplores.length === 0 && bundleExplores.length > 0) {
          setSelectedExplores(bundleExplores)
        }
        setAgentSession({ ...result.session, explores: effectiveExplores }, resolvedMode)

        if ((effectiveBuilderMode === 'dashboard' || resolvedUseCase === 'dashboard') && result.nativeBundle) {
          setBusyStatus('Indexing native Looker content in user catalog...')
          const prelimAssistantMsg: ChatMessage = {
            role: 'assistant',
            text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            widgetCount: result.nativeBundle.tile_count,
            activitySteps: result.activitySteps,
            thinkingDurationSec: result.thinkingDurationSec,
          }
          const savedNative = await saveNativeContentArtifact(
            core40SDK,
            extensionSDK,
            userId,
            result.nativeBundle,
            selectedFolderId,
            nativeContent,
            {
              explores: effectiveExplores,
              lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
              messages: [...messagesWithUser, prelimAssistantMsg],
            }
          )
          lastNativeIdRef.current = savedNative.id
          resolvedUseCaseByIdRef.current[savedNative.id] = 'dashboard'
          setNativeContent(savedNative)
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(savedNative.id)
          setLoadDashInput(savedNative.id)
          const targetRoute = `/c/${encodeURIComponent(savedNative.id)}`
          if (location.pathname !== targetRoute) history.replace(targetRoute)
          await refreshCatalog()
          finalMsgs = [
            ...messagesWithUser,
            { ...prelimAssistantMsg, dashboardId: savedNative.id },
          ]
          setMessages(finalMsgs, 'dashboard')
          convId = savedNative.id
          convType = 'dashboard'
          convTitle = savedNative.title
          convContent = {
            dashboardId: savedNative.id,
            contentType: savedNative.contentType,
            embedPath: savedNative.embedPath,
            lookId: savedNative.lookId,
            lookmlDashboardId: savedNative.lookmlDashboardId,
          }
        } else if (result.bundle) {
          setBusyStatus('Publishing inline extension & updating Looker dashboard...')
          const prelimAssistantMsg: ChatMessage = {
            role: 'assistant',
            text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            widgetCount: result.bundle?.widgets?.length || 0,
            activitySteps: result.activitySteps,
            thinkingDurationSec: result.thinkingDurationSec,
          }
          const upserted = await upsertPublishedDataApp(
            core40SDK,
            result.bundle,
            selectedFolderId,
            publishedApp,
            {
              explores: effectiveExplores,
              lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
              messages: [...messagesWithUser, prelimAssistantMsg],
            }
          )
          lastPublishedIdRef.current = upserted.dashboardId
          resolvedUseCaseByIdRef.current[upserted.dashboardId] = 'app'
          setPublishedApp(upserted)
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(upserted.dashboardId)
          setCurrentAppCode(result.bundle.raw_code)
          setLoadDashInput(upserted.dashboardId)
          finalMsgs = [
            ...messagesWithUser,
            { ...prelimAssistantMsg, dashboardId: upserted.dashboardId },
          ]
          try {
            await saveUserArtifact(
              core40SDK,
              userId,
              {
                id: upserted.dashboardId,
                type: 'app',
                title: upserted.title,
                explores: effectiveExplores,
                updatedAt: new Date().toISOString(),
                createdBy: userId,
              },
              {
                id: upserted.dashboardId,
                type: 'app',
                title: upserted.title,
                explores: effectiveExplores,
                updatedAt: new Date().toISOString(),
                createdBy: userId,
                dashboardId: upserted.dashboardId,
                extensionId: upserted.extensionId,
                rawCode: result.bundle.raw_code,
                messages: finalMsgs,
              },
              getArtifactNamespace(extensionSDK)
            )
            await refreshCatalog()
          } catch {}
          const targetRoute = `/c/${encodeURIComponent(upserted.dashboardId)}`
          if (location.pathname !== targetRoute) {
            history.replace(targetRoute)
          }
          setMessages(finalMsgs, 'app')
          convId = upserted.dashboardId
          convType = 'app'
          convTitle = upserted.title
          convContent = {
            dashboardId: upserted.dashboardId,
            appArtifactId: `obj_app_${upserted.dashboardId}`,
            extensionId: upserted.extensionId,
          }
        } else {
          finalMsgs = [
            ...messagesWithUser,
            {
              role: 'assistant',
              text: result.assistantText,
              interactionId: result.session.lastInteractionId,
              activitySteps: result.activitySteps,
              thinkingDurationSec: result.thinkingDurationSec,
            },
          ]
          setMessages(finalMsgs, resolvedMode)
          if (selectedUseCase === 'auto' && resolvedMode !== activeMode) {
            if (resolvedUseCase === 'health-check') {
              await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
              await refreshCatalog()
              return
            }
          }
          if (effectiveBuilderMode === 'dashboard' && nativeContent) {
            const updatedNative = await saveNativeContentArtifact(
              core40SDK,
              extensionSDK,
              userId,
              { id: nativeContent.id, title: nativeContent.title, explores: effectiveExplores },
              selectedFolderId,
              nativeContent,
              {
                explores: effectiveExplores,
                lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId,
                messages: finalMsgs,
              }
            )
            setNativeContent(updatedNative)
            await refreshCatalog()
            convId = updatedNative.id
            convType = 'dashboard'
            convTitle = updatedNative.title
            convContent = {
              dashboardId: updatedNative.id,
              contentType: updatedNative.contentType,
              embedPath: updatedNative.embedPath,
            }
          } else if (publishedApp) {
            setPublishedApp(
              await saveDashboardStudioMetadata(core40SDK, publishedApp, {
                explores: effectiveExplores,
                lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId,
                messages: finalMsgs,
              })
            )
            convId = publishedApp.dashboardId
            convType = 'app'
            convTitle = publishedApp.title
            convContent = {
              dashboardId: publishedApp.dashboardId,
              appArtifactId: `obj_app_${publishedApp.dashboardId}`,
            }
          }
        }
      }

      if (convId && resolvedUseCase) {
        resolvedUseCaseByIdRef.current[convId] = resolvedUseCase
      }
      const nextConvRoute = `/c/${encodeURIComponent(convId)}`
      if (location.pathname !== nextConvRoute) {
        history.replace(nextConvRoute)
      }

      void persistConversationAndLabel({
        id: convId,
        type: convType,
        interactionId: result.session.lastInteractionId,
        environmentId: result.session.environmentId,
        label: isFirstTurn ? convTitle || sanitizeConversationLabel('', effectivePrompt) : undefined,
        explores: convExplores,
        content: convContent,
        messages: finalMsgs,
        isFirstTurn,
        userPrompt: effectivePrompt,
        assistantText: result.assistantText,
        updateArtifactIndex: true,
      })
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    } finally {
      setPendingPerm(null)
      setBusyStatus(null)
      setLiveActivitySteps(
        Array.isArray(mockExt?.initialLiveActivitySteps) ? mockExt.initialLiveActivitySteps : []
      )
    }
  }

  const isEmptyConversation =
    !isTileMount && location.pathname !== '/config' &&
    !parsedRoute.objectId && messages.length === 0 && !publishedApp && !nativeContent &&
    !lookmlBundle && !healthReport && !caConversation && !loadedScript && !busyStatus &&
    liveActivitySteps.length === 0

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).__DAB_STUDIO__ = {
        history, requestCodeModePermission, setRequirePermission, setDisabledModes,
        setSelectedModel, setAuthMode, setClientId, setOauthToken, setApiKey,
        isAuthenticated, oauthSigningIn, oauthRedirectUri,
        handleOAuthLogin, handleCancelOAuthLogin,
        setSidebarCollapsed, themeMode, resolvedTheme, setThemeMode,
        setSelectedUseCase: handleChangeUseCase, setCapabilities,
        handleResetNewApp, handleNewConversation, handleSelectConversation,
        setNativeContent, setPublishedApp, bumpEmbedNonce,
        setMessages, setBusyStatus, setLiveActivitySteps,
        infoModalUseCase, setInfoModalUseCase,
        loadingMetadata, setLoadingMetadata,
        selectedFolderId, setSelectedFolderId,
        hydrateFolderAncestors, toggleExpandFolder, handleSearchFolders,
      }
    }
  }, [history, requestCodeModePermission, isAuthenticated, oauthSigningIn, oauthRedirectUri, handleCancelOAuthLogin, themeMode, resolvedTheme, setThemeMode, handleChangeUseCase, handleResetNewApp, handleNewConversation, handleSelectConversation, bumpEmbedNonce, setMessages, infoModalUseCase, loadingMetadata, selectedFolderId, hydrateFolderAncestors, toggleExpandFolder, handleSearchFolders])

  return {
    extensionSDK, core40SDK, lookerHostData, history, location, isTileMount,
    themeMode, resolvedTheme, setThemeMode,
    authMode, setAuthMode, clientId, setClientId, projectId, setProjectId,
    disabledModes, setDisabledModes, selectedModel, setSelectedModel,
    availableModels, enabledModes, oauthToken, setOauthToken, apiKey, setApiKey,
    isAuthenticated, oauthSigningIn, oauthRedirectUri,
    capabilities, setCapabilities, availableLookmlProjects, canDeployLookml,
    loadingMetadata, setLoadingMetadata,
    models, folders, folderTreeNodes, rootFolderIds, folderChildrenById,
    expandedFolderIds, loadingFolderIds, toggleExpandFolder,
    hydrateFolderAncestors, handleSearchFolders,
    selectedExplores, setSelectedExplores,
    selectedFolderId, setSelectedFolderId, schemaMarkdown, loadingSchema,
    activeMode, isLookmlMode, isHealthCheckMode, isCaMode, builderMode,
    selectedUseCase, setSelectedUseCase: handleChangeUseCase,
    isUseCaseLocked, allowedUseCases, useCaseOptions, getUseCaseLabel,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, lookmlSessions, loadLookmlInput, setLoadLookmlInput,
    publishedApp, nativeContent, embedNonce, bumpEmbedNonce,
    healthReport, healthScope, setHealthScope, caConversation,
    savedScripts, scriptId, setScriptId, scriptTitle, setScriptTitle,
    scriptCode, setScriptCode, filtersJson, setFiltersJson,
    scriptOutput, setScriptOutput, scriptMode, setScriptMode,
    publishedTileDash, setPublishedTileDash, schedulerOpen, setSchedulerOpen,
    infoModalUseCase, setInfoModalUseCase,
    scheduleConfig, setScheduleConfig, savedScheduleBadge, setSavedScheduleBadge,
    handleRunPython, handleSaveScript, handlePublishTileDashboard, loadScriptById,
    currentAppCode, loadDashInput, setLoadDashInput,
    sharedEnvironmentId, syncSharedEnvironmentId,
    agentSession, messages, setMessages, prompt, setPrompt, pastedImages, setPastedImages,
    busyStatus, loading: Boolean(busyStatus), liveActivitySteps, setLiveActivitySteps,
    handleWakeModeEnv,
    activeObjectId, conversations: filteredConversations, allConversations: modeAllowedConversations,
    archivedConversations, showArchivedConversations, setShowArchivedConversations,
    pendingDeleteConv, setPendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent,
    activeConversationId,
    sidebarCollapsed, setSidebarCollapsed, isEmptyConversation,
    requirePermission, setRequirePermission, pendingPerm, resolvePermDecision,
    handleSaveAuthSetup, handleOAuthLogin, handleCancelOAuthLogin,
    loadNativeById, loadLookmlSessionById, loadCaConversationById,
    handleRunHealthCheck, handleRunConversationalAnalytics, handleLoadExistingDashboard,
    handleResetNewApp, handleNewConversation, handleSelectConversation,
    handleToggleArchiveConversation, handleRequestDeleteConversation,
    handleCancelDeleteConversation, handleConfirmDeleteConversation,
    handleDeleteConversation,
    handleSendPrompt, handleSend: handleSendPrompt,
    userId,
    resolveConversationRelatedContent,
  }
}

export type StudioController = ReturnType<typeof useStudioController>
