import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ILookmlModelNavExplore } from '@looker/sdk'
import { useHistory, useLocation } from 'react-router-dom'
import useSWR from 'swr'

import {
  AgentSession, ANTIGRAVITY_ALLOWED_MODELS, AntigravityActivityStep, AntigravityAuth, AntigravityModelOption,
  authenticateGoogleOAuth, buildDynamicStarterPrompts, clearStoredOAuthSession, CodeModePermissionDecision,
  CodeModePermissionRequest, computeIsAuthenticated, DEFAULT_ANTIGRAVITY_MODEL, discoverStarterExploreContext,
  ensureGeminiApiKeyUserAttribute, ExtensionAuthContextConfig, generateConversationLabel,
  generateDynamicStarterPrompts, getCachedStarterPrompts, getInitialStoredOAuthSession, getInitialStoredOAuthToken,
  inFlightEnvProvisionByUser, listAvailableAntigravityModels, LkrCodeMode, loadStoredOAuthSession, loginWithGoogleOAuth,
  normalizeEnvironmentId, PastedImage, prewarmOrWakeAntigravityEnvironment, refreshOAuthSessionIfNeeded,
  resolveLookerOAuthRedirectUri, resolveLookerOAuthRedirectUris, resolveTargetExploreFromModels,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas, StarterPromptItem, StoredOAuthSession,
  STUDIO_OAUTH_REFRESH_INTERVAL_MS, STUDIO_OAUTH_REFRESH_LOCK_KEY, STUDIO_OAUTH_STORAGE_KEY,
} from './antigravity'
import { ChatMessage, parseStudioRoute, STUDIO_MODES, StudioMode } from './components/App'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import { useLookerExtension } from './contexts/LookerExtensionContext'
import {
  HEALTH_CHECK_SYSTEM_GUIDE, HealthCheckReportPayload, loadHealthCheckArtifact,
  runThreePillarHealthCheckViaCodeMode, saveHealthCheckArtifact, THREE_PILLAR_CODEMODE_PY,
} from './healthCheck'
import {
  applyStudioDocumentTheme, archiveUserConversation, buildAvailableExploresCatalog, buildDenseExploreSchema,
  buildRootLookerFolders, CaConversationState, ConversationRecord, createLookerCaConversation,
  deleteUserConversation, extractExploreIdsFromCode, extractResolvedUseCase,
  fetchFolderChildren, fetchFolderWithAncestors, fetchInitialLookerMetadata,
  fetchPreloadedContentSummary, formatExploreId,
  getAllowedUseCases, getArtifactNamespace, getArtifactService, getUseCaseLabel,
  hydrateConversationContentItems, hydrateMentionedContext, listSavedScripts,
  listUserArtifacts, loadExistingDashboardApp, loadNativeContentById,
  loadObjectArtifact, loadScriptArtifact, loadStoredStudioThemeMode, loadUserConversations,
  loadUserEnvironmentId, LookerFolderNode, matchExplicitUseCaseRule, NativeContentState,
  normalizeStudioThemeMode, parseExploreId, persistStudioThemeMode, PublishedAppState,
  publishScriptDashboard, readInitialStudioThemeMode, resolveCaEmbedPath,
  resolveConversationRelatedContent, ResolvedStudioTheme, ResolvedStudioUseCase, resolveStudioTheme, resolveSystemTheme,
  resolveUserCapabilities, saveDashboardStudioMetadata, SavedScript, saveNativeContentArtifact,
  saveScriptArtifact, saveUserArtifact, saveUserConversation, saveUserEnvironmentId, searchGlobalContentV2, searchLookerFolders, SearchLookerFoldersParams,
  selectCaAgentViaIsolatedSubagent, STUDIO_THEME_STORAGE_KEY, STUDIO_USE_CASE_OPTIONS,
  StudioContentItem, StudioContentItemType, StudioContextCategory, StudioContextMention, studioModeToUseCase, StudioThemeMode, StudioToolMode, StudioUseCase, studioUseCaseToMode, upsertPublishedDataApp, upsertStudioContentItem,
  UserArtifactIndex, UserCapabilities, UserConversationEntry,
} from './lookerApi'
import {
  listUserLookmlSessions, loadLookmlSessionArtifact, LookmlBundle, LookmlSessionIndex, saveLookmlSessionArtifact,
} from './lookmlTool'

export {
  authenticateGoogleOAuth,
  computeIsAuthenticated,
  normalizeStudioThemeMode,
  refreshOAuthSessionIfNeeded,
  resolveLookerOAuthRedirectUri,
  resolveLookerOAuthRedirectUris,
  resolveStudioTheme,
  resolveSystemTheme,
  STUDIO_OAUTH_REFRESH_LOCK_KEY,
  STUDIO_OAUTH_STORAGE_KEY,
  STUDIO_THEME_STORAGE_KEY,
}
export type {
  ResolvedStudioTheme,
  StudioContextCategory,
  StudioContextMention,
  StudioThemeMode,
}

export interface QueuedPromptItem {
  id: string
  text: string
  images: PastedImage[]
  mentions: StudioContextMention[]
}

export type StudioEnvironmentStatus = 'active' | 'resetting' | 'stopped'

type HostDataWithMount = {
  mountType?: string
  mountPoint?: string
  hostUrl?: string
  extensionId?: string
}

interface StoredCaArtifactPayload extends Partial<CaConversationState> {
  agent_id?: string
  agent_name?: string
  lastInteractionId?: string
  studio?: { lastInteractionId?: string; messages?: ChatMessage[] }
  messages?: ChatMessage[]
}

const getErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err || '')

export function useStudioController() {
  const { extensionSDK, core40SDK, tileHostData, lookerHostData } = useLookerExtension()
  const history = useHistory()
  const location = useLocation()
  const extHostData = (extensionSDK as { lookerHostData?: HostDataWithMount } | undefined)
    ?.lookerHostData
  const hostData = (lookerHostData as HostDataWithMount | undefined) || extHostData
  const mountType =
    hostData?.mountType ||
    extHostData?.mountType ||
    lookerHostData?.mountPoint ||
    extHostData?.mountPoint
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
    typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
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
  const initialClientId = initialCtx?.clientId || ''
  const initialOAuthSession = getInitialStoredOAuthSession(initialClientId)
  const [oauthToken, setOauthToken] = useState(
    () => initialOAuthSession?.token || getInitialStoredOAuthToken(initialClientId)
  )
  const [oauthExpiresAt, setOauthExpiresAt] = useState<number>(
    () =>
      initialOAuthSession?.expiresAt ||
      (initialOAuthSession?.token ? Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS : 0)
  )
  const oauthPendingRefreshRef = useRef<boolean>(false)
  const tabIdRef = useRef<string>(
    `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  )
  const [apiKey, setApiKey] = useState(() => String(mockExt?.initialApiKey || ''))
  const [oauthSigningIn, setOauthSigningIn] = useState(false)
  const oauthAbortRef = useRef<AbortController | null>(null)
  const isAuthenticated = authMode === 'apikey' ? Boolean(apiKey.trim()) : Boolean(oauthToken.trim())

  const resetOAuthOnUnauthorized = useCallback(
    (err: unknown): string => {
      const msg = getErrorMessage(err)
      if (authMode === 'oauth' && /\b401\b|UNAUTHENTICATED/i.test(msg)) {
        clearStoredOAuthSession(extensionSDK)
        setOauthToken('')
        setOauthExpiresAt(0)
      }
      return msg
    },
    [authMode, extensionSDK]
  )

  const triggerSilentOAuthRefresh = useCallback(
    async (force = false): Promise<string | null> => {
      if (authMode !== 'oauth' || !clientId.trim()) return null
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        oauthPendingRefreshRef.current = true
        return null
      }
      try {
        const res = await refreshOAuthSessionIfNeeded({
          extensionSDK,
          clientId,
          tabId: tabIdRef.current,
          force,
          currentToken: oauthToken,
        })
        if (res?.deferredUntilVisible) {
          oauthPendingRefreshRef.current = true
          return null
        }
        if (res?.token) {
          oauthPendingRefreshRef.current = false
          setOauthToken(res.token)
          if (res.expiresAt > 0) setOauthExpiresAt(res.expiresAt)
          return res.token
        }
        return null
      } catch {
        clearStoredOAuthSession(extensionSDK)
        setOauthToken('')
        setOauthExpiresAt(0)
        return null
      }
    },
    [authMode, clientId, extensionSDK, oauthToken]
  )

  useEffect(() => {
    if (mockExt && 'initialOauthToken' in mockExt && mockExt.initialOauthToken) return
    let mounted = true
    void loadStoredOAuthSession(extensionSDK, initialClientId).then((stored) => {
      if (!mounted || !stored?.token) return
      setOauthToken((prev) => prev || stored.token)
      setOauthExpiresAt((prev) => prev || stored.expiresAt)
    })
    return () => {
      mounted = false
    }
  }, [extensionSDK, initialClientId, mockExt])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== STUDIO_OAUTH_STORAGE_KEY) return
      if (!e.newValue) {
        oauthPendingRefreshRef.current = false
        setOauthToken('')
        setOauthExpiresAt(0)
        return
      }
      try {
        const parsed = JSON.parse(e.newValue) as Partial<StoredOAuthSession> | null
        const tok = typeof parsed?.token === 'string' ? parsed.token.trim() : ''
        const exp = Number(parsed?.expiresAt)
        const cid = typeof parsed?.clientId === 'string' ? parsed.clientId.trim() : ''
        if (cid && clientId.trim() && cid !== clientId.trim()) return
        if (tok && Number.isFinite(exp) && exp > Date.now()) {
          oauthPendingRefreshRef.current = false
          setOauthToken(tok)
          setOauthExpiresAt(exp)
        }
      } catch {
        // Ignore malformed storage event payload
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clientId])

  useEffect(() => {
    if (authMode !== 'oauth' || !oauthToken.trim() || !clientId.trim() || !oauthExpiresAt) return
    const checkOrRefresh = () => {
      if (Date.now() < oauthExpiresAt && !oauthPendingRefreshRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        oauthPendingRefreshRef.current = true
        return
      }
      oauthPendingRefreshRef.current = false
      void triggerSilentOAuthRefresh(false)
    }
    const timer = setTimeout(checkOrRefresh, Math.max(0, oauthExpiresAt - Date.now()))
    const onVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (oauthPendingRefreshRef.current || Date.now() >= oauthExpiresAt) {
        oauthPendingRefreshRef.current = false
        void triggerSilentOAuthRefresh(false)
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener?.('visibilitychange', onVisibilityOrFocus)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener?.('focus', onVisibilityOrFocus)
    }
    return () => {
      clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener?.('visibilitychange', onVisibilityOrFocus)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener?.('focus', onVisibilityOrFocus)
      }
    }
  }, [authMode, oauthToken, clientId, oauthExpiresAt, triggerSilentOAuthRefresh])
  const oauthRedirectUri = useMemo(
    () =>
      resolveLookerOAuthRedirectUri(
        lookerHostData?.hostUrl || extHostData?.hostUrl
      ),
    [lookerHostData?.hostUrl, extHostData?.hostUrl]
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
    Array<{ name: string; label: string; project_name?: string; explores: ILookmlModelNavExplore[] }>
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
  const rootFolderIdsRef = useRef<string[]>(rootFolderIds)
  rootFolderIdsRef.current = rootFolderIds
  const [folderChildrenById, setFolderChildrenById] = useState<Record<string, string[]>>({})
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([])
  const [loadingFolderIds, setLoadingFolderIds] = useState<string[]>([])
  const [selectedExplores, setSelectedExplores] = useState<string[]>([])
  const [preloadedContent, setPreloadedContent] = useState<StudioContextMention[]>([])
  const [mentionedItems, setMentionedItems] = useState<StudioContextMention[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() =>
    String(mockExt?.initialSelectedFolderId || '1')
  )
  const [schemaMarkdown, setSchemaMarkdown] = useState('')
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [starterPrompts, setStarterPrompts] = useState<StarterPromptItem[]>([])
  const [starterPromptsLoading, setStarterPromptsLoading] = useState<boolean>(
    () => Boolean(mockExt?.forceStarterPromptsSkeleton ?? true)
  )
  const oauthAccessToken = oauthToken.trim()

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
    () => (mockExt?.initialPendingDeleteConv as ConversationRecord | undefined) || null
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
  const explicitUseCaseRef = useRef<StudioUseCase>(
    parsedRoute.useCase && !parsedRoute.objectId ? parsedRoute.useCase : 'auto'
  )
  const effectiveUseCase: StudioUseCase = parsedRoute.objectId
    ? inferredRouteUseCase || (selectedUseCase !== 'auto' ? selectedUseCase : 'app')
    : selectedUseCase !== 'auto'
    ? selectedUseCase
    : inferredRouteUseCase || 'auto'
  const activeMode: StudioMode =
    effectiveUseCase !== 'auto' ? studioUseCaseToMode(effectiveUseCase) : parsedRoute.mode
  const isLookmlMode = activeMode === 'lookml'
  const isHealthCheckMode =
    location.pathname === '/health-check' || activeMode === 'health'
  const builderMode: 'data_app' | 'dashboard' =
    activeMode === 'dashboard' ? 'dashboard' : 'data_app'

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
  const [publishedApp, setPublishedAppState] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContentState] = useState<NativeContentState | null>(null)
  const [contentItems, setContentItemsState] = useState<StudioContentItem[]>([])
  const contentItemsRef = useRef<StudioContentItem[]>([])
  const [activeContentTabKey, setActiveContentTabKeyState] = useState<string>('')
  const activeContentTabKeyRef = useRef<string>('')

  const setContentItems = useCallback(
    (
      next:
        | StudioContentItem[]
        | ((prev: StudioContentItem[]) => StudioContentItem[])
    ) => {
      setContentItemsState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        contentItemsRef.current = resolved
        return resolved
      })
    },
    []
  )

  const setActiveContentTabKey = useCallback((nextKey: string) => {
    activeContentTabKeyRef.current = nextKey
    setActiveContentTabKeyState(nextKey)
  }, [])

  const upsertContentItem = useCallback(
    (
      rawItem: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType },
      activate = true
    ): StudioContentItem => {
      const res = upsertStudioContentItem(contentItemsRef.current, rawItem)
      contentItemsRef.current = res.items
      setContentItemsState(res.items)
      if (activate || !activeContentTabKeyRef.current) {
        activeContentTabKeyRef.current = res.activeKey
        setActiveContentTabKeyState(res.activeKey)
      }
      return res.item
    },
    []
  )

  const setPublishedApp = useCallback(
    (
      next:
        | PublishedAppState
        | null
        | ((prev: PublishedAppState | null) => PublishedAppState | null)
    ) => {
      setPublishedAppState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (resolved && resolved.dashboardId) {
          const uc = resolvedUseCaseByIdRef.current[resolved.dashboardId]
          const ct: StudioContentItemType =
            uc === 'data-investigator' ? 'data-investigator' : 'data_app'
          upsertContentItem({
            id: String(resolved.dashboardId),
            dashboardId: String(resolved.dashboardId),
            contentType: ct,
            title: resolved.title,
            embedPath: `/embed/dashboards/${encodeURIComponent(String(resolved.dashboardId))}`,
            folderId: resolved.folderId,
            extensionId: resolved.extensionId,
            rawCode: resolved.code,
          })
        }
        return resolved
      })
    },
    [upsertContentItem]
  )

  const setNativeContent = useCallback(
    (
      next:
        | NativeContentState
        | null
        | ((prev: NativeContentState | null) => NativeContentState | null)
    ) => {
      setNativeContentState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (resolved && resolved.id) {
          const ct = (resolved.contentType || 'dashboard') as StudioContentItemType
          upsertContentItem({
            id: String(resolved.id),
            contentType: ct,
            title: resolved.title,
            embedPath: resolved.embedPath,
            folderId: resolved.folderId,
            dashboardId:
              resolved.dashboardId || (ct === 'dashboard' ? String(resolved.id) : undefined),
            lookId: resolved.lookId || (ct === 'look' ? String(resolved.id) : undefined),
            lookmlDashboardId:
              resolved.lookmlDashboardId ||
              (ct === 'lookml_dashboard' ? String(resolved.id) : undefined),
          })
        }
        return resolved
      })
    },
    [upsertContentItem]
  )

  const activeContentItem = useMemo<StudioContentItem | null>(() => {
    if (contentItems.length === 0) return null
    return (
      contentItems.find((it) => it.key === activeContentTabKey) ||
      contentItems[contentItems.length - 1] ||
      null
    )
  }, [contentItems, activeContentTabKey])

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
  const [environmentStatus, setEnvironmentStatus] = useState<StudioEnvironmentStatus>('active')
  const environmentStatusRef = useRef<StudioEnvironmentStatus>('active')
  environmentStatusRef.current = environmentStatus
  const [envResetNotice, setEnvResetNotice] = useState<boolean>(false)
  const envResetNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnAbortControllerRef = useRef<AbortController | null>(null)
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPromptItem[]>([])
  const queuedPromptsRef = useRef<QueuedPromptItem[]>([])
  queuedPromptsRef.current = queuedPrompts

  const updateQueuedPrompts = useCallback(
    (updater: QueuedPromptItem[] | ((prev: QueuedPromptItem[]) => QueuedPromptItem[])) => {
      const next =
        typeof updater === 'function' ? updater(queuedPromptsRef.current) : updater
      queuedPromptsRef.current = next
      setQueuedPrompts(next)
    },
    []
  )

  // Per-mode isolated Antigravity conversation histories sharing a single per-user environmentId
  const [sessionsByMode, setSessionsByMode] = useState<Record<StudioMode, AgentSession>>({
    app: { toolType: 'app', environmentId: 'env_app_isolated' },
    dashboard: { toolType: 'dashboard', environmentId: 'env_dashboard_isolated' },
    lookml: { toolType: 'lookml', environmentId: 'env_lookml_isolated' },
    health: { toolType: 'health', environmentId: 'env_health_isolated' },
    tile: { toolType: 'tile', environmentId: 'env_tile_isolated' },
  })
  const sessionsByModeRef = useRef<Record<StudioMode, AgentSession>>(sessionsByMode)
  sessionsByModeRef.current = sessionsByMode

  const [messagesByMode, setMessagesByMode] = useState<Record<StudioMode, ChatMessage[]>>(() => {
    if (Array.isArray(mockExt?.initialMessages)) {
      return {
        app: mockExt.initialMessages as ChatMessage[],
        dashboard: [],
        lookml: [],
        health: [],
        tile: [],
      }
    }
    const initialErr = mockExt?.initialError
      ? [{ role: 'error' as const, text: String(mockExt.initialError) }]
      : []
    return { app: initialErr, dashboard: [], lookml: [], health: [], tile: [] }
  })
  const messagesByModeRef = useRef<Record<StudioMode, ChatMessage[]>>(messagesByMode)
  messagesByModeRef.current = messagesByMode

  const syncSharedEnvironmentId = useCallback((envId?: string) => {
    const clean = normalizeEnvironmentId(envId)
    if (!clean) return
    sharedEnvIdRef.current = clean
    setSharedEnvironmentId(clean)
    setSessionsByMode((prev) => {
      const updated = {
        app: { ...prev.app, toolType: 'app' as const, environmentId: clean },
        dashboard: { ...prev.dashboard, toolType: 'dashboard' as const, environmentId: clean },
        lookml: { ...prev.lookml, toolType: 'lookml' as const, environmentId: clean },
        health: { ...prev.health, toolType: 'health' as const, environmentId: clean },
        tile: { ...prev.tile, toolType: 'tile' as const, environmentId: clean },
      }
      sessionsByModeRef.current = updated
      return updated
    })
  }, [])

  const activeModeRef = useRef<StudioMode>(activeMode)
  activeModeRef.current = activeMode

  const agentSession = sessionsByMode[activeMode] || { toolType: activeMode }
  const setAgentSession = useCallback(
    (next: AgentSession, targetMode: StudioMode = activeModeRef.current) => {
      const nextShared = normalizeEnvironmentId(next.environmentId)
      if (nextShared && nextShared !== sharedEnvIdRef.current && next.lastInteractionId) {
        sharedEnvIdRef.current = nextShared
        setSharedEnvironmentId(nextShared)
      }
      setSessionsByMode((prev) => {
        const updated = {
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
        }
        sessionsByModeRef.current = updated
        return updated
      })
    },
    []
  )

  const messages = useMemo(
    () => messagesByMode[activeMode] || [],
    [messagesByMode, activeMode]
  )
  const setMessages = useCallback(
    (
      updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
      targetMode?: StudioMode
    ) => {
      const mode = targetMode ?? activeModeRef.current
      const cur = messagesByModeRef.current[mode] || []
      const next = typeof updater === 'function' ? updater(cur) : updater
      const updated = { ...messagesByModeRef.current, [mode]: next }
      messagesByModeRef.current = updated
      setMessagesByMode(updated)
    },
    []
  )

  const [prompt, setPrompt] = useState(() => String(mockExt?.initialPrompt || ''))
  const [pastedImages, setPastedImages] = useState<PastedImage[]>(
    () => (mockExt?.initialPastedImages as PastedImage[] | undefined) || []
  )
  const [busyStatus, setBusyStatus] = useState<string | null>(
    () => mockExt?.initialBusyStatus || null
  )
  const [liveActivitySteps, setLiveActivitySteps] = useState<AntigravityActivityStep[]>(
    () =>
      Array.isArray(mockExt?.initialLiveActivitySteps)
        ? (mockExt.initialLiveActivitySteps as AntigravityActivityStep[])
        : []
  )
  const liveActivityStepsRef = useRef<AntigravityActivityStep[]>(liveActivitySteps)
  liveActivityStepsRef.current = liveActivitySteps

  const isUseCaseLocked = false

  useEffect(() => {
    if (inferredRouteUseCase) {
      setSelectedUseCase(inferredRouteUseCase)
    } else if (parsedRoute.objectId && selectedUseCase === 'auto') {
      setSelectedUseCase('app')
    }
  }, [parsedRoute.objectId, parsedRoute.conversationId, inferredRouteUseCase, selectedUseCase])

  const handleChangeUseCase = useCallback(
    (nextUseCase: StudioUseCase) => {
      explicitUseCaseRef.current = nextUseCase
      setSelectedUseCase(nextUseCase)
      if (location.pathname !== '/' && !parsedRoute.objectId) {
        history.replace('/')
      }
    },
    [location.pathname, parsedRoute.objectId, history]
  )

  const wakeContextRef = useRef({
    sessionsByMode,
    selectedExplores,
    schemaMarkdown,
    currentAppCode,
  })
  wakeContextRef.current = {
    sessionsByMode,
    selectedExplores,
    schemaMarkdown,
    currentAppCode,
  }

  const handleWakeModeEnv = useCallback(
    async (modeToWake: StudioMode = activeModeRef.current, forceFresh = false) => {
      try {
        const ctx = wakeContextRef.current
        const existingSession = forceFresh ? { toolType: modeToWake } : ctx.sessionsByMode[modeToWake]
        const res = await prewarmOrWakeAntigravityEnvironment({
          sdk: core40SDK,
          userId: userIdRef.current || userId,
          extensionSDK,
          auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
          toolType: modeToWake,
          model: selectedModel,
          environmentId: forceFresh
            ? undefined
            : sharedEnvIdRef.current || existingSession?.environmentId,
          existingSession,
          selectedExplores: ctx.selectedExplores,
          schemaMarkdown: ctx.schemaMarkdown,
          existingAppCode: modeToWake === 'app' ? ctx.currentAppCode : undefined,
          forceFresh,
          onEnvironmentUpdated: syncSharedEnvironmentId,
        })
        setSessionsByMode((prev) => {
          const nextEnvId = sharedEnvIdRef.current || res.session.environmentId
          const cur = prev[modeToWake]
          if (
            !forceFresh &&
            cur &&
            cur.environmentId === nextEnvId &&
            cur.lastInteractionId === res.session.lastInteractionId &&
            cur.toolType === res.session.toolType
          ) {
            return prev
          }
          const updated = {
            ...prev,
            [modeToWake]: {
              ...res.session,
              environmentId: nextEnvId,
            },
          }
          sessionsByModeRef.current = updated
          return updated
        })
      } catch {
        // Ignore prewarm errors
      }
    },
    [core40SDK, userId, extensionSDK, authMode, oauthToken, clientId, projectId, apiKey, selectedModel, syncSharedEnvironmentId]
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
    if (environmentStatus === 'stopped' || environmentStatus === 'resetting') return
    if (sharedEnvIdRef.current) return
    void handleWakeModeEnv(activeMode)
  }, [activeMode, disabledModes, environmentStatus, handleWakeModeEnv])

  const [requirePermission, setRequirePermission] = useState(true)
  const approvedOpsRef = useRef<Set<string>>(new Set())
  const [pendingPerm, setPendingPerm] = useState<{
    req: CodeModePermissionRequest
    resolve: (decision: CodeModePermissionDecision) => void
  } | null>(() =>
    mockExt?.initialPendingPerm
      ? { req: mockExt.initialPendingPerm as CodeModePermissionRequest, resolve: () => {} }
      : null
  )
  const pendingPermRef = useRef<typeof pendingPerm>(pendingPerm)
  pendingPermRef.current = pendingPerm

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
    async (uid = userIdRef.current || '1') => {
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
      } catch {
        // Ignore catalog refresh failure
      }
    },
    [core40SDK, extensionSDK]
  )

  const normalizeCatalogMode = (t?: string): StudioMode =>
    ({
      health_check: 'health',
      'health-check': 'health',
      script: 'tile',
      data_app: 'app',
      'data-investigator': 'app',
      data_investigator: 'app',
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
    } catch (err: unknown) {
      setBusyStatus(null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
    }
  }

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
          const merged = Array.from(
            new Set([...visibleChildren.map((c) => c.id), ...existing])
          ).filter((id) => !activeRootIds.includes(id))
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
              name:
                existing?.is_personal && existing.name === 'My folder' ? existing.name : node.name,
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
      } catch {
        // Ignore ancestor hydration errors
      }
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
      } catch {
        // Ignore folder children fetch errors
      } finally {
        setLoadingFolderIds((prev) => prev.filter((id) => id !== fid))
      }
    },
    [expandedFolderIds, folderChildrenById, loadFolderChildren]
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
      name: f.name,
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
        setFolders(
          rawFolders.map((f) => ({
            id: String(f.id),
            name: f.name,
          }))
        )
        const extMock =
          typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        const targetInitialFolder = extMock?.initialSelectedFolderId
          ? String(extMock.initialSelectedFolderId)
          : meta.defaultFolderId
        setSelectedFolderId((prev) =>
          extMock?.initialSelectedFolderId
            ? String(extMock.initialSelectedFolderId)
            : prev === '1'
            ? meta.defaultFolderId
            : prev
        )
        if (!extMock?.forceFolderSkeleton) setLoadingMetadata(false)
        void hydrateFolderAncestors(targetInitialFolder, initialRootIds)
        void loadFolderChildren(targetInitialFolder, initialRootIds).catch(() => {})
        void refreshCatalog(resolvedUserId)
        fetchPreloadedContentSummary(core40SDK)
          .then((items) => {
            if (mounted) setPreloadedContent(items)
          })
          .catch(() => {})
        loadUserConversations(
          core40SDK,
          resolvedUserId,
          getArtifactNamespace(extensionSDK)
        ).then((loadedConvs) => {
          if (mounted) setConversations(loadedConvs)
        })
      })
      .catch((err: unknown) => {
        const extMock =
          typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
        if (!extMock?.forceFolderSkeleton) setLoadingMetadata(false)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Failed to load Looker models: ${getErrorMessage(err)}` },
        ])
      })
    return () => {
      mounted = false
    }
  }, [core40SDK, extensionSDK, syncSharedEnvironmentId, hydrateFolderAncestors, loadFolderChildren, refreshCatalog, setMessages])

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
    return () => {
      mounted = false
    }
  }, [core40SDK, selectedExplores, models])

  useEffect(() => {
    let mounted = true
    const targetExplore = resolveTargetExploreFromModels(selectedExplores, models)
    const exploreKey =
      selectedExplores.length > 0
        ? selectedExplores.join(',')
        : targetExplore?.exploreKey || 'none'
    const hasOAuth = Boolean(oauthAccessToken)
    const cached = getCachedStarterPrompts(selectedUseCase, exploreKey, allowedUseCases, hasOAuth)
    if (cached && cached.length > 0 && !mockExt?.forceStarterPromptsSkeleton) {
      setStarterPrompts(cached)
      setStarterPromptsLoading(false)
      return () => {
        mounted = false
      }
    }
    if (
      (loadingMetadata && models.length === 0 && selectedExplores.length === 0) ||
      mockExt?.forceStarterPromptsSkeleton
    ) {
      setStarterPromptsLoading(true)
      return () => {
        mounted = false
      }
    }

    setStarterPrompts((prev) => {
      if (prev.length === 0) setStarterPromptsLoading(true)
      return prev
    })

    void (async () => {
      const exploreContext = await discoverStarterExploreContext({
        sdk: core40SDK,
        selectedExplores,
        availableModels: models,
      })
      if (!mounted) return
      const immediate = buildDynamicStarterPrompts({
        useCase: selectedUseCase,
        selectedExplores,
        permittedUseCases: allowedUseCases,
        availableModels: models,
        exploreContext,
      })
      setStarterPrompts(immediate)
      setStarterPromptsLoading(false)

      if (hasOAuth) {
        const refined = await generateDynamicStarterPrompts({
          sdk: core40SDK,
          extensionSDK,
          auth: { mode: 'oauth', oauthToken: oauthAccessToken, clientId, projectId, apiKey },
          environmentId: sharedEnvIdRef.current || undefined,
          useCase: selectedUseCase,
          selectedExplores,
          permittedUseCases: allowedUseCases,
          availableModels: models,
          exploreContext,
          model: selectedModel,
        })
        if (mounted && refined.length > 0) {
          setStarterPrompts(refined)
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, [
    core40SDK,
    extensionSDK,
    selectedUseCase,
    selectedExplores,
    allowedUseCases,
    models,
    availableModels,
    oauthAccessToken,
    loadingMetadata,
    clientId,
    projectId,
    apiKey,
    selectedModel,
    mockExt?.forceStarterPromptsSkeleton,
  ])

  const handleCancelOAuthLogin = useCallback(() => {
    oauthAbortRef.current?.abort()
    oauthAbortRef.current = null
    setOauthSigningIn(false)
  }, [])

  const handleOAuthLogin = useCallback(async () => {
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
      if (oauthAbortRef.current === controller) {
        oauthPendingRefreshRef.current = false
        setOauthToken(token)
        const stored = await loadStoredOAuthSession(extensionSDK, clientId)
        setOauthExpiresAt(stored?.expiresAt || Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS)
      }
    } catch (err: unknown) {
      if (oauthAbortRef.current === controller && !controller.signal.aborted) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Google OAuth failed: ${getErrorMessage(err)}` },
        ])
      }
    } finally {
      if (oauthAbortRef.current === controller) {
        oauthAbortRef.current = null
        setOauthSigningIn(false)
      }
    }
  }, [clientId, extensionSDK, mockExt?.oauthFocusReturnDelayMs, setMessages])

  const runWithBusy = useCallback(
    async (statusText: string, errPrefix: string, fn: () => Promise<void>) => {
      try {
        setBusyStatus(statusText)
        await fn()
        setBusyStatus(mockExt?.initialBusyStatus || null)
      } catch (err: unknown) {
        setBusyStatus(mockExt?.initialBusyStatus || null)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `${errPrefix}: ${getErrorMessage(err)}` },
        ])
      }
    },
    [mockExt?.initialBusyStatus, setMessages]
  )

  const hydrateLoadedArtifact = useCallback(
    (opts: {
      mode: StudioMode; id: string; route: string; pushRoute: boolean; convTypes: string[]
      convId?: string; explores?: string[]
      studio?: {
        explores?: string[]
        messages?: unknown[]
        lastInteractionId?: string
        environmentId?: string
        lastSession?: { lastInteractionId?: string; environmentId?: string }
      } | null
      lastInteractionId?: string
      environmentId?: string; defaultEnvId: string; messages?: ChatMessage[]
      fallbackText: string; dashboardId?: string
    }) => {
      const explores = opts.explores ?? opts.studio?.explores?.filter(Boolean)
      const msgs = opts.messages ?? (opts.studio?.messages as ChatMessage[] | undefined)
      const matchedConv = conversations.find((c) => {
        if (opts.convId && c.id === opts.convId) return true
        const cid = String(
          c.content?.dashboardId || c.content?.lookId || c.content?.lookmlDashboardId ||
          c.content?.reportId || c.content?.sessionId || c.content?.caConversationId || c.content?.id || ''
        )
        return cid === opts.id && opts.convTypes.includes(c.type)
      })
      if (matchedConv) {
        const fromConv = hydrateConversationContentItems(matchedConv)
        for (const item of fromConv) {
          upsertContentItem(item, false)
        }
        if (matchedConv.activeContentTabKey) {
          setActiveContentTabKey(matchedConv.activeContentTabKey)
        }
      }
      setActiveObjectId(opts.id)
      setActiveConversationId((prev) => {
        if (opts.convId) return opts.convId
        const prefix = `conv_${opts.mode}_`
        return matchedConv ? matchedConv.id : prev.startsWith(prefix) ? prev : `${prefix}${opts.id}`
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
    [conversations, history, location.pathname, setActiveContentTabKey, setAgentSession, setMessages, upsertContentItem]
  )

  const persistConversationAndLabel = useCallback(
    async (opts: {
      id: string; type: string; interactionId?: string; environmentId?: string; label?: string
      explores?: string[]; content?: Record<string, unknown>; messages: ChatMessage[]
      isFirstTurn?: boolean; userPrompt?: string; assistantText?: string; updateArtifactIndex?: boolean
    }) => {
      const namespace = getArtifactNamespace(extensionSDK)
      const auth: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
      const baseConv = {
        id: opts.id, type: opts.type, interactionId: opts.interactionId, environmentId: opts.environmentId,
        explores: opts.explores, ...(opts.content ? { content: opts.content } : {}),
        ...(contentItemsRef.current.length > 0 ? { contentItems: contentItemsRef.current } : {}),
        ...(activeContentTabKeyRef.current ? { activeContentTabKey: activeContentTabKeyRef.current } : {}),
        messages: opts.messages,
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
                  id: opts.id, type: studioUseCaseToMode(studioModeToUseCase(opts.type)),
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
        const existingUc = resolvedUseCaseByIdRef.current[loaded.dashboardId]
        const targetUc: ResolvedStudioUseCase =
          existingUc === 'data-investigator' ? 'data-investigator' : 'app'
        resolvedUseCaseByIdRef.current[loaded.dashboardId] = targetUc
        setSelectedUseCase(targetUc)
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
          pushRoute, convTypes: ['app', 'data_app', 'data-investigator', 'data_investigator'], explores: resolvedExplores, studio: loaded.studio,
          defaultEnvId: 'env_app_42', dashboardId: loaded.dashboardId,
          fallbackText: `Loaded existing Data App "${loaded.title}" (Dashboard #${loaded.dashboardId}, ${loaded.code.length.toLocaleString()} bytes). Describe any changes to update it in place.`,
        })
      })
    },
    [core40SDK, hydrateLoadedArtifact, runWithBusy, setPublishedApp]
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
    [core40SDK, extensionSDK, hydrateLoadedArtifact, runWithBusy, setNativeContent]
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
      } catch (err: unknown) {
        const errOut = JSON.stringify({ error: getErrorMessage(err) })
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
      const extId = extHostData?.extensionId || 'data_app_builder::data_app_builder'
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
    } catch (err: unknown) {
      setBusyStatus(mockExt?.initialBusyStatus || null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }], 'tile')
    }
  }, [core40SDK, extHostData?.extensionId, handleSaveScript, mockExt?.initialBusyStatus, publishedTileDash?.dashboardId, selectedFolderId, setMessages])

  const loadCaConversationById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(
        `Loading Conversational Analytics session "${id}"...`,
        `Could not load Conversational Analytics session "${id}"`,
        async () => {
          const loaded = await loadObjectArtifact<StoredCaArtifactPayload>(core40SDK, 'conversational-analytics', id, getArtifactNamespace(extensionSDK))
          const convFromList = conversations.find((c) => c.id === id || String(c.content?.caConversationId || c.content?.id || '') === id)
          const content: StoredCaArtifactPayload =
            loaded || (convFromList?.content as StoredCaArtifactPayload | undefined) || {}
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
          upsertContentItem({
            id: caConvId,
            contentType: 'conversational-analytics',
            title: state.title,
            embedPath: state.embedPath,
            updatedAt: state.updatedAt,
          })
          setSelectedUseCase('conversational-analytics')
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
    [conversations, core40SDK, extensionSDK, hydrateLoadedArtifact, runWithBusy, upsertContentItem]
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
      upsertContentItem({
        id: created.caConversationId,
        contentType: 'conversational-analytics',
        title: created.label,
        embedPath: created.embedPath,
        updatedAt: nextCaState.updatedAt,
      })
      setSelectedUseCase('conversational-analytics')
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
    } catch (err: unknown) {
      const msg = resetOAuthOnUnauthorized(err)
      setMessages((prev) => [...prev, { role: 'error', text: msg }], 'app')
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
        } catch {
          // Ignore optional Antigravity refinement failure
        }
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
    } catch (err: unknown) {
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
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
        'data-investigator': loadDashboardById,
        data_investigator: loadDashboardById,
        dashboard: loadNativeById,
        lookml: loadLookmlSessionById,
        health: loadHealthCheckById,
        tile: loadScriptById,
      }
      if (typeOrMode === 'auto') {
        const ns = getArtifactNamespace(extensionSDK)
        const probes: Array<[StudioToolMode, string]> = [
          ['conversational-analytics', 'conversational-analytics'],
          ['lookml', 'lookml'],
          ['health_check', 'health'],
          ['script', 'tile'],
          ['dashboard', 'dashboard'],
        ]
        for (const [artifactType, loaderKey] of probes) {
          if (await loadObjectArtifact(core40SDK, artifactType, id, ns)) {
            return loaders[loaderKey](id, pushRoute)
          }
        }
        return loadDashboardById(id, pushRoute)
      }
      const fn = loaders[typeOrMode] || loaders[normalizeCatalogMode(typeOrMode)]
      if (fn) return fn(id, pushRoute)
      const loaded = await loadObjectArtifact(core40SDK, typeOrMode as StudioToolMode, id)
      if (loaded?.messages) setMessages(loaded.messages)
    },
    [core40SDK, extensionSDK, loadCaConversationById, loadDashboardById, loadHealthCheckById, loadLookmlSessionById, loadNativeById, loadScriptById, setMessages]
  )

  useEffect(() => {
    if (isTileMount || location.pathname === '/config') return
    if (disabledModes.includes(activeMode)) {
      explicitUseCaseRef.current = 'auto'
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
          explicitUseCaseRef.current = parsedRoute.useCase
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

  const handleResetNewApp = useCallback(
    (resetToDefaultRoute?: boolean | React.MouseEvent, presetUseCase?: StudioUseCase) => {
      const forceDefaultRoute = resetToDefaultRoute === true
      const nextUseCase: StudioUseCase =
        typeof presetUseCase === 'string' && presetUseCase ? presetUseCase : 'auto'
      lastPublishedIdRef.current = ''
      lastNativeIdRef.current = ''
      lastLookmlIdRef.current = ''
      lastHealthIdRef.current = ''
      lastCaIdRef.current = ''
      lastScriptIdRef.current = ''
      setLoadedScript(false)
      setActiveObjectId('')
      setActiveConversationId(`conv_${Date.now()}`)
      setPublishedAppState(null)
      setNativeContentState(null)
      setContentItems([])
      setActiveContentTabKey('')
      setLookmlBundle(null)
      setHealthReport(null)
      setCaConversation(null)
      setCurrentAppCode('')
      setLoadDashInput('')
      setLoadLookmlInput('')
      setSelectedExplores([])
      setMentionedItems([])
      setAgentSession({
        environmentId: sharedEnvIdRef.current || undefined,
        lastInteractionId: undefined,
        conversationId: `conv_${Date.now().toString(36)}`,
      })
      setMessages([])
      if (forceDefaultRoute) {
        setMessages([], 'app')
        if (nextUseCase !== 'auto') {
          setMessages([], studioUseCaseToMode(nextUseCase))
        }
      }
      setPastedImages([])
      setPrompt('')
      explicitUseCaseRef.current = nextUseCase
      setSelectedUseCase(nextUseCase)
      if (location.pathname !== '/') history.push('/')
    },
    [history, location.pathname, setActiveContentTabKey, setAgentSession, setContentItems, setMessages]
  )

  const handleNewConversation = useCallback(
    (presetUseCase?: StudioUseCase | React.MouseEvent) =>
      handleResetNewApp(true, typeof presetUseCase === 'string' ? presetUseCase : 'auto'),
    [handleResetNewApp]
  )

  const handleSelectContentTab = useCallback(
    (key: string) => {
      setActiveContentTabKey(key)
      const item = contentItemsRef.current.find((it) => it.key === key)
      if (!item) return
      if (
        item.contentType === 'dashboard' ||
        item.contentType === 'lookml_dashboard' ||
        item.contentType === 'look' ||
        item.contentType === 'board'
      ) {
        setNativeContentState((prev) => ({
          id: item.id,
          title: item.title,
          contentType: item.contentType as NativeContentState['contentType'],
          embedPath: item.embedPath,
          folderId: item.folderId || prev?.folderId || selectedFolderId,
          dashboardId: item.dashboardId,
          lookId: item.lookId,
          lookmlDashboardId: item.lookmlDashboardId,
        }))
      } else if (
        item.contentType === 'data_app' ||
        item.contentType === 'data-investigator'
      ) {
        const dashId = String(item.dashboardId || item.id)
        setPublishedAppState((prev) =>
          prev && prev.dashboardId === dashId
            ? prev
            : {
                dashboardId: dashId,
                title: item.title,
                folderId: item.folderId || prev?.folderId || selectedFolderId,
                extensionId: item.extensionId || prev?.extensionId || '',
                elementId: prev?.elementId || '',
                code: item.rawCode || prev?.code || currentAppCode,
              }
        )
      }
    },
    [currentAppCode, selectedFolderId, setActiveContentTabKey]
  )

  const handleSelectConversation = useCallback(
    async (conv: ConversationRecord) => {
      const useCase = studioModeToUseCase(conv.type)
      const mode = normalizeCatalogMode(conv.type)
      resolvedUseCaseByIdRef.current[conv.id] = useCase
      explicitUseCaseRef.current = 'auto'
      setSelectedUseCase(useCase)
      setActiveConversationId(conv.id)
      const initialItems = hydrateConversationContentItems(conv)
      setContentItems(initialItems)
      setActiveContentTabKey(
        conv.activeContentTabKey || initialItems[initialItems.length - 1]?.key || ''
      )
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
      if (
        conv.activeContentTabKey &&
        contentItemsRef.current.some((it) => it.key === conv.activeContentTabKey)
      ) {
        setActiveContentTabKey(conv.activeContentTabKey)
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
    },
    [history, location.pathname, openArtifactByMode, setActiveContentTabKey, setAgentSession, setContentItems, setMessages]
  )

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
    } catch {
      // Ignore archive error
    }
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
    } catch {
      // Ignore delete conversation error
    }
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

  const abortActiveTurn = useCallback(
    (reasonText: string) => {
      turnAbortControllerRef.current?.abort()
      turnAbortControllerRef.current = null
      if (pendingPermRef.current) {
        const { resolve } = pendingPermRef.current
        pendingPermRef.current = null
        setPendingPerm(null)
        resolve('deny')
      }
      const partialSteps = liveActivityStepsRef.current
      if (partialSteps.length > 0) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: reasonText, activitySteps: partialSteps },
        ])
      }
      liveActivityStepsRef.current = []
      setLiveActivitySteps([])
    },
    [setMessages]
  )

  const handleStopTurn = useCallback(() => {
    abortActiveTurn('Stopped by user.')
    setBusyStatus(null)
  }, [abortActiveTurn])

  const handleQueuePrompt = useCallback(() => {
    if (!busyStatus) return
    const text = prompt.trim()
    if (!text && pastedImages.length === 0) return
    updateQueuedPrompts((prev) => [
      ...prev,
      {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        images: pastedImages,
        mentions: mentionedItems,
      },
    ])
    setPrompt('')
    setPastedImages([])
    setMentionedItems([])
  }, [busyStatus, prompt, pastedImages, mentionedItems, updateQueuedPrompts])

  const handleRemoveQueuedPrompt = useCallback(
    (id: string) => {
      updateQueuedPrompts((prev) => prev.filter((q) => q.id !== id))
    },
    [updateQueuedPrompts]
  )

  const clearAllEnvSessions = useCallback(
    (nextStatus: StudioEnvironmentStatus) => {
      handleStopTurn()
      sharedEnvIdRef.current = ''
      setSharedEnvironmentId('')
      const cleared: Record<StudioMode, AgentSession> = {
        app: { toolType: 'app', environmentId: '' },
        dashboard: { toolType: 'dashboard', environmentId: '' },
        lookml: { toolType: 'lookml', environmentId: '' },
        health: { toolType: 'health', environmentId: '' },
        tile: { toolType: 'tile', environmentId: '' },
      }
      sessionsByModeRef.current = cleared
      setSessionsByMode(cleared)
      environmentStatusRef.current = nextStatus
      setEnvironmentStatus(nextStatus)
    },
    [handleStopTurn]
  )

  const handleResetEnvironment = useCallback(async () => {
    if (envResetNoticeTimerRef.current) {
      clearTimeout(envResetNoticeTimerRef.current)
      envResetNoticeTimerRef.current = null
    }
    setEnvResetNotice(false)
    clearAllEnvSessions('resetting')
    sharedEnvExploreSchemas.clear()
    inFlightEnvProvisionByUser.clear()
    try {
      await saveUserEnvironmentId(
        core40SDK,
        userIdRef.current || userId,
        '',
        getArtifactNamespace(extensionSDK)
      )
    } catch {
      // Ignore clear environment artifact errors
    }
    try {
      await handleWakeModeEnv(activeModeRef.current, true)
    } finally {
      environmentStatusRef.current = 'active'
      setEnvironmentStatus('active')
      setEnvResetNotice(true)
      envResetNoticeTimerRef.current = setTimeout(() => {
        setEnvResetNotice(false)
        envResetNoticeTimerRef.current = null
      }, 2500)
    }
  }, [clearAllEnvSessions, core40SDK, userId, extensionSDK, handleWakeModeEnv])

  const handleStopEnvironment = useCallback(() => {
    if (envResetNoticeTimerRef.current) {
      clearTimeout(envResetNoticeTimerRef.current)
      envResetNoticeTimerRef.current = null
    }
    setEnvResetNotice(false)
    clearAllEnvSessions('stopped')
  }, [clearAllEnvSessions])

  const handleSendPrompt = async (
    overrideItem?:
      | {
          text: string
          images?: PastedImage[]
          mentions?: StudioContextMention[]
          bypassBusy?: boolean
        }
      | React.SyntheticEvent
  ) => {
    const isOverride =
      Boolean(overrideItem) &&
      typeof overrideItem === 'object' &&
      !('nativeEvent' in (overrideItem as object)) &&
      typeof (overrideItem as { text?: unknown }).text === 'string'
    const typedOverride = isOverride
      ? (overrideItem as {
          text: string
          images?: PastedImage[]
          mentions?: StudioContextMention[]
          bypassBusy?: boolean
        })
      : undefined
    const text = typedOverride ? typedOverride.text.trim() : prompt.trim()
    const attachedImages = typedOverride ? typedOverride.images || [] : pastedImages
    const activeMentions = typedOverride ? typedOverride.mentions || [] : mentionedItems
    if (
      !isAuthenticated ||
      (!text && attachedImages.length === 0) ||
      (busyStatus && !typedOverride?.bypassBusy)
    ) {
      return
    }
    if (environmentStatusRef.current === 'stopped') {
      environmentStatusRef.current = 'active'
      setEnvironmentStatus('active')
    }
    const auth: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const effectivePrompt = text || 'See the attached screenshot.'
    const currentMessages = messagesByModeRef.current[activeModeRef.current] || messages
    const isFirstTurn = currentMessages.filter((m) => m.role === 'user').length === 0
    const userMsg: ChatMessage = {
      role: 'user',
      text: effectivePrompt,
      images: attachedImages.map((img) => img.dataUrl),
    }
    const messagesWithUser = [...currentMessages, userMsg]
    if (!typedOverride) {
      setPrompt('')
      setPastedImages([])
      setMentionedItems([])
    }
    setMessages(messagesWithUser)

    const explicitUseCase = explicitUseCaseRef.current
    const classifiedPromptUseCase = matchExplicitUseCaseRule(effectivePrompt, allowedUseCases)
    const turnTargetUseCase: StudioUseCase =
      explicitUseCase !== 'auto' ? explicitUseCase : (classifiedPromptUseCase || 'auto')

    if (turnTargetUseCase === 'health-check' || (explicitUseCase !== 'auto' && isHealthCheckMode)) {
      setSelectedUseCase('health-check')
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
      await refreshCatalog()
      return
    }

    if (
      turnTargetUseCase === 'conversational-analytics' ||
      (explicitUseCase !== 'auto' && isCaMode) ||
      (turnTargetUseCase === 'auto' &&
        extractResolvedUseCase('', effectivePrompt, allowedUseCases) === 'conversational-analytics')
    ) {
      setSelectedUseCase('conversational-analytics')
      await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser)
      return
    }

    const currentSession = sessionsByModeRef.current[activeModeRef.current] || agentSession
    const activeConvId =
      parsedRoute.objectId ||
      activeObjectId ||
      currentSession.conversationId ||
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

    const abortController = new AbortController()
    turnAbortControllerRef.current = abortController
    setBusyStatus('Connecting to Antigravity...')
    liveActivityStepsRef.current = []
    setLiveActivitySteps([])
    try {
      let turnExplores = selectedExplores
      let turnSchemaMarkdown = schemaMarkdown
      let turnExtraSources: Array<{ type: 'inline'; content: string; target: string }> | undefined
      let turnPromptWithContext = effectivePrompt

      if (activeMentions.length > 0) {
        for (const m of activeMentions) {
          if (m.type === 'explore' || m.type === 'dashboard' || m.type === 'look') {
            const ct: StudioContentItemType =
              m.type === 'explore'
                ? 'explore'
                : m.type === 'look'
                ? 'look'
                : m.id.includes('::')
                ? 'lookml_dashboard'
                : 'dashboard'
            upsertContentItem({
              id: m.id,
              contentType: ct,
              title: m.title,
              ...(ct === 'explore' ? { exploreId: m.id } : {}),
              ...(ct === 'look' ? { lookId: m.id } : {}),
              ...(ct === 'dashboard' ? { dashboardId: m.id } : {}),
              ...(ct === 'lookml_dashboard' ? { lookmlDashboardId: m.id } : {}),
            })
          }
        }
        setBusyStatus('Hydrating referenced Looker @-mention context...')
        const hydrated = await hydrateMentionedContext({
          sdk: core40SDK,
          mentions: activeMentions,
          conversations,
          selectedExplores,
          useCase: turnTargetUseCase,
        })
        if (hydrated.explores.length > 0) {
          turnExplores = hydrated.explores
          if (JSON.stringify(turnExplores) !== JSON.stringify(selectedExplores)) {
            setSelectedExplores(turnExplores)
            const sections = await Promise.all(
              turnExplores.map(async (id) => {
                const parsed = parseExploreId(id)
                if (!parsed) return ''
                try {
                  return await buildDenseExploreSchema(core40SDK, parsed.modelName, parsed.exploreName)
                } catch {
                  return ''
                }
              })
            )
            const joined = sections.filter(Boolean).join('\n\n---\n\n')
            if (joined) {
              turnSchemaMarkdown = joined
              setSchemaMarkdown(joined)
            }
          }
        }
        if (hydrated.extraSources.length > 0) {
          turnExtraSources = hydrated.extraSources
        }
        if (hydrated.promptSummary) {
          turnPromptWithContext = `${effectivePrompt}\n\n${hydrated.promptSummary}`
        }
      }

      const effectiveLookmlTurn =
        turnTargetUseCase === 'lookml' || (explicitUseCase !== 'auto' && isLookmlMode)
      const effectiveBuilderMode: 'data_app' | 'dashboard' =
        turnTargetUseCase === 'dashboard'
          ? 'dashboard'
          : turnTargetUseCase === 'app' || turnTargetUseCase === 'data-investigator'
          ? 'data_app'
          : builderMode
      const result = await runAntigravityTurn({
        sdk: core40SDK,
        extensionSDK,
        userId,
        environmentId: sharedEnvIdRef.current || currentSession.environmentId,
        conversationId: activeConvId,
        onEnvironmentUpdated: syncSharedEnvironmentId,
        auth,
        session: currentSession,
        model: selectedModel,
        mode: effectiveBuilderMode,
        useCase: explicitUseCase,
        allowedModes: allowedUseCases,
        selectedExplores: turnExplores,
        folderId: selectedFolderId,
        toolMode: effectiveLookmlTurn ? 'lookml' : 'data_app',
        lookmlProjectId,
        activatedLookmlSkills,
        developableProjects: availableLookmlProjects,
        canDeploy: canDeployLookml,
        schemaMarkdown: turnSchemaMarkdown,
        userPrompt:
          explicitUseCase === 'tile' ||
          loadedScript ||
          /\b(python\s*tile|python\s*script|codemode\s*script|obj_script|monty\s*python\s*tile)\b/i.test(
            effectivePrompt
          )
            ? `Write a LkrCodeMode Python script for the user's request. Return the Python snippet inside a \`\`\`python code block.\n\nCurrent script:\n\`\`\`python\n${scriptCode}\n\`\`\`\n\nUser request: ${turnPromptWithContext}`
            : turnPromptWithContext,
        images: attachedImages,
        existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent,
        extraSources: turnExtraSources,
        priorMessages: currentMessages,
        requirePermission,
        approvedOperations: approvedOpsRef.current,
        onPermissionRequest: requestCodeModePermission,
        onProgressSteps: (steps) => {
          liveActivityStepsRef.current = steps
          setLiveActivitySteps(steps)
        },
        signal: abortController.signal,
        onStatus: setBusyStatus,
      })

      const resolvedUseCase: ResolvedStudioUseCase =
        explicitUseCase !== 'auto'
          ? explicitUseCase
          : result.resolvedUseCase ||
            extractResolvedUseCase(result.assistantText, effectivePrompt, allowedUseCases)
      setSelectedUseCase(resolvedUseCase)
      if (resolvedUseCase === 'conversational-analytics') {
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser)
        return
      }
      const resolvedMode: StudioMode = studioUseCaseToMode(resolvedUseCase)

      let convId = activeObjectId || activeConversationId || result.session.lastInteractionId || 'conv_1'
      let convType: string = resolvedUseCase
      let convTitle = ''
      let convExplores = turnExplores
      let convContent: Record<string, unknown> | undefined
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
              explores: turnExplores,
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
        } catch {
          // Ignore LookML artifact save failure
        }
        setAgentSession({ ...result.session, explores: turnExplores }, 'lookml')
        setMessages(finalMsgs, 'lookml')
      } else if (resolvedUseCase === 'tile') {
        const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
        const extractedPy = pyMatch ? pyMatch[1].trim() : ''
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
        setAgentSession({ ...result.session, explores: turnExplores }, 'tile')
        setMessages(finalMsgs, 'tile')
        if (extractedPy || explicitUseCase === 'tile' || loadedScript) {
          const nextCode = extractedPy || scriptCode
          if (extractedPy) setScriptCode(extractedPy)
          await handleRunPython(nextCode, filtersJson)
          try {
            const saved = await handleSaveScript(nextCode, finalMsgs, publishedTileDash)
            convId = `conv_tile_${saved.id}`
            convType = 'tile'
            convTitle = saved.title
            convContent = { scriptId: saved.id, dashboardId: saved.dashboardId, elementId: saved.elementId }
            setActiveObjectId(saved.id)
          } catch {
            // Ignore script save failure
          }
        }
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
          turnExplores.length > 0 ? turnExplores : bundleExplores
        convExplores = effectiveExplores
        if (turnExplores.length === 0 && bundleExplores.length > 0) {
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
          const appUseCaseType: ResolvedStudioUseCase =
            resolvedUseCase === 'data-investigator' ? 'data-investigator' : 'app'
          lastPublishedIdRef.current = upserted.dashboardId
          resolvedUseCaseByIdRef.current[upserted.dashboardId] = appUseCaseType
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
                type: appUseCaseType,
                title: upserted.title,
                explores: effectiveExplores,
                updatedAt: new Date().toISOString(),
                createdBy: userId,
              },
              {
                id: upserted.dashboardId,
                type: appUseCaseType,
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
          } catch {
            // Ignore app artifact save failure
          }
          const targetRoute = `/c/${encodeURIComponent(upserted.dashboardId)}`
          if (location.pathname !== targetRoute) {
            history.replace(targetRoute)
          }
          setMessages(finalMsgs, 'app')
          convId = upserted.dashboardId
          convType = appUseCaseType
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
          if (explicitUseCase === 'auto' && resolvedMode !== activeMode) {
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
    } catch (err: unknown) {
      if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) {
        return
      }
      const msg = resetOAuthOnUnauthorized(err)
      setMessages((prev) => [...prev, { role: 'error', text: msg }])
    } finally {
      if (!abortController.signal.aborted) {
        if (turnAbortControllerRef.current === abortController) {
          turnAbortControllerRef.current = null
        }
        setPendingPerm(null)
        setBusyStatus(null)
        const nextSteps = Array.isArray(mockExt?.initialLiveActivitySteps)
          ? (mockExt.initialLiveActivitySteps as AntigravityActivityStep[])
          : []
        liveActivityStepsRef.current = nextSteps
        setLiveActivitySteps(nextSteps)
        const nextQueued = queuedPromptsRef.current[0]
        if (nextQueued) {
          updateQueuedPrompts((prev) => prev.slice(1))
          void handleSendPrompt({
            text: nextQueued.text,
            images: nextQueued.images,
            mentions: nextQueued.mentions,
            bypassBusy: true,
          })
        }
      }
    }
  }

  const sendPromptRef = useRef(handleSendPrompt)
  sendPromptRef.current = handleSendPrompt

  const handleInterjectPrompt = useCallback(
    (queuedId?: string | React.MouseEvent) => {
      const targetId = typeof queuedId === 'string' ? queuedId : undefined
      const queuedItem = targetId
        ? queuedPromptsRef.current.find((q) => q.id === targetId)
        : undefined
      const textToSend = queuedItem ? queuedItem.text : prompt.trim()
      const imagesToSend = queuedItem ? queuedItem.images : pastedImages
      const mentionsToSend = queuedItem ? queuedItem.mentions : mentionedItems
      if (!isAuthenticated || (!textToSend && imagesToSend.length === 0)) return

      if (queuedItem) {
        updateQueuedPrompts((prev) => prev.filter((q) => q.id !== queuedItem.id))
      } else {
        setPrompt('')
        setPastedImages([])
        setMentionedItems([])
      }

      abortActiveTurn('Interjected by user.')

      void sendPromptRef.current({
        text: textToSend,
        images: imagesToSend,
        mentions: mentionsToSend,
        bypassBusy: true,
      })
    },
    [abortActiveTurn, isAuthenticated, mentionedItems, pastedImages, prompt, setMentionedItems, updateQueuedPrompts]
  )

  const isEmptyConversation =
    !isTileMount && location.pathname !== '/config' &&
    !parsedRoute.objectId && messages.length === 0 && !publishedApp && !nativeContent &&
    contentItems.length === 0 &&
    !lookmlBundle && !healthReport && !caConversation && !loadedScript && !busyStatus &&
    liveActivitySteps.length === 0

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__DAB_STUDIO__ = {
        history, requestCodeModePermission, setRequirePermission, setDisabledModes,
        setSelectedModel, setAuthMode, setClientId, setOauthToken, setOauthExpiresAt, setApiKey,
        oauthExpiresAt, triggerSilentOAuthRefresh,
        isAuthenticated, oauthSigningIn, oauthRedirectUri,
        handleOAuthLogin, handleCancelOAuthLogin,
        setSidebarCollapsed, themeMode, resolvedTheme, setThemeMode,
        selectedUseCase, setSelectedUseCase: handleChangeUseCase,
        isUseCaseLocked, allowedUseCases, useCaseOptions, setCapabilities,
        handleResetNewApp, handleNewConversation, handleSelectConversation,
        setNativeContent, setPublishedApp, bumpEmbedNonce,
        contentItems, setContentItems, activeContentTabKey, setActiveContentTabKey,
        activeContentItem, upsertContentItem, handleSelectContentTab,
        setMessages, setBusyStatus, setLiveActivitySteps,
        queuedPrompts, setQueuedPrompts: updateQueuedPrompts,
        handleStopTurn, handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt,
        environmentStatus, setEnvironmentStatus, envResetNotice, setEnvResetNotice,
        handleResetEnvironment, handleStopEnvironment,
        infoModalUseCase, setInfoModalUseCase,
        loadingMetadata, setLoadingMetadata,
        starterPrompts, setStarterPrompts, starterPromptsLoading, setStarterPromptsLoading,
        selectedFolderId, setSelectedFolderId,
        hydrateFolderAncestors, toggleExpandFolder, handleSearchFolders,
        preloadedContent, setPreloadedContent, mentionedItems, setMentionedItems,
      }
    }
  }, [history, requestCodeModePermission, oauthExpiresAt, triggerSilentOAuthRefresh, isAuthenticated, oauthSigningIn, oauthRedirectUri, handleOAuthLogin, handleCancelOAuthLogin, themeMode, resolvedTheme, setThemeMode, selectedUseCase, handleChangeUseCase, isUseCaseLocked, allowedUseCases, useCaseOptions, handleResetNewApp, handleNewConversation, handleSelectConversation, setNativeContent, setPublishedApp, bumpEmbedNonce, contentItems, setContentItems, activeContentTabKey, setActiveContentTabKey, activeContentItem, upsertContentItem, handleSelectContentTab, setMessages, queuedPrompts, updateQueuedPrompts, handleStopTurn, handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt, environmentStatus, envResetNotice, handleResetEnvironment, handleStopEnvironment, infoModalUseCase, loadingMetadata, starterPrompts, starterPromptsLoading, selectedFolderId, hydrateFolderAncestors, toggleExpandFolder, handleSearchFolders, preloadedContent, mentionedItems])

  return {
    extensionSDK, core40SDK, lookerHostData, history, location, isTileMount,
    themeMode, resolvedTheme, setThemeMode,
    authMode, setAuthMode, clientId, setClientId, projectId, setProjectId,
    disabledModes, setDisabledModes, selectedModel, setSelectedModel,
    availableModels, enabledModes, oauthToken, oauthAccessToken, setOauthToken,
    oauthExpiresAt, setOauthExpiresAt, triggerSilentOAuthRefresh, apiKey, setApiKey,
    isAuthenticated, oauthSigningIn, oauthRedirectUri,
    capabilities, setCapabilities, availableLookmlProjects, canDeployLookml,
    loadingMetadata, setLoadingMetadata,
    starterPrompts, setStarterPrompts, starterPromptsLoading, setStarterPromptsLoading,
    models, folders, folderTreeNodes, rootFolderIds, folderChildrenById,
    expandedFolderIds, loadingFolderIds, toggleExpandFolder,
    hydrateFolderAncestors, handleSearchFolders,
    selectedExplores, setSelectedExplores,
    preloadedContent, setPreloadedContent, mentionedItems, setMentionedItems,
    searchGlobalContentV2,
    selectedFolderId, setSelectedFolderId, schemaMarkdown, loadingSchema,
    activeMode, isLookmlMode, isHealthCheckMode, isCaMode, builderMode,
    selectedUseCase, setSelectedUseCase: handleChangeUseCase,
    isUseCaseLocked, allowedUseCases, useCaseOptions, getUseCaseLabel,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, lookmlSessions, loadLookmlInput, setLoadLookmlInput,
    publishedApp, setPublishedApp, nativeContent, setNativeContent,
    contentItems, setContentItems, activeContentTabKey, setActiveContentTabKey,
    activeContentItem, upsertContentItem, handleSelectContentTab,
    embedNonce, bumpEmbedNonce,
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
    environmentStatus, setEnvironmentStatus, envResetNotice, setEnvResetNotice,
    handleResetEnvironment, handleStopEnvironment,
    agentSession, messages, setMessages, prompt, setPrompt, pastedImages, setPastedImages,
    busyStatus, loading: Boolean(busyStatus), liveActivitySteps, setLiveActivitySteps,
    queuedPrompts, setQueuedPrompts: updateQueuedPrompts,
    handleStopTurn, handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt,
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
