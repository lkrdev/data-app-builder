import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import { useLookerExtension } from './contexts/LookerExtensionContext'
import {
  buildAvailableExploresCatalog,
  buildDenseExploreSchema,
  ConversationRecord,
  deleteUserArtifact,
  deleteUserConversation,
  extractExploreIdsFromCode,
  fetchInitialLookerMetadata,
  formatExploreId,
  getArtifactNamespace,
  listUserArtifacts,
  listUserDashboardArtifacts,
  loadExistingDashboardApp,
  loadNativeContentById,
  loadObjectArtifact,
  loadUserConversations,
  NativeContentState,
  NativeContentType,
  parseExploreId,
  PublishedAppState,
  resolveUserCapabilities,
  saveDashboardStudioMetadata,
  saveNativeContentArtifact,
  saveUserArtifact,
  saveUserConversation,
  upsertPublishedDataApp,
  UserArtifactIndex,
  UserCapabilities,
  UserConversationEntry,
} from './lookerApi'
import {
  AgentSession,
  ANTIGRAVITY_ALLOWED_MODELS,
  AntigravityAuth,
  AntigravityModelOption,
  CodeModePermissionDecision,
  CodeModePermissionRequest,
  DEFAULT_ANTIGRAVITY_MODEL,
  ensureGeminiApiKeyUserAttribute,
  ExtensionAuthContextConfig,
  generateConversationLabel,
  listAvailableAntigravityModels,
  loginWithGoogleOAuth,
  PastedImage,
  prewarmOrWakeAntigravityEnvironment,
  runAntigravityTurn,
  sanitizeConversationLabel,
} from './antigravity'
import {
  listUserLookmlSessions,
  loadLookmlSessionArtifact,
  LookmlBundle,
  LookmlSessionIndex,
  saveLookmlSessionArtifact,
} from './lookmlTool'
import {
  HEALTH_CHECK_SYSTEM_GUIDE,
  HealthCheckReportPayload,
  loadHealthCheckArtifact,
  runThreePillarHealthCheckViaCodeMode,
  saveHealthCheckArtifact,
  THREE_PILLAR_CODEMODE_PY,
} from './healthCheck'
import { ChatMessage, parseStudioRoute, STUDIO_MODES, StudioMode } from './components/App'

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
  const [oauthToken, setOauthToken] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isConfigured, setIsConfigured] = useState(() =>
    Boolean(initialCtx?.authMode && (initialCtx.authMode === 'apikey' || initialCtx.clientId))
  )

  const mockExt =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  const [userId, setUserId] = useState('1')
  const [capabilities, setCapabilities] = useState<UserCapabilities>(() =>
    resolveUserCapabilities()
  )
  const [allModels, setAllModels] = useState<
    Array<{ name: string; label: string; project_name?: string; explores: any[] }>
  >([])
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [selectedExplores, setSelectedExplores] = useState<string[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('1')
  const [schemaMarkdown, setSchemaMarkdown] = useState('')
  const [loadingSchema, setLoadingSchema] = useState(false)

  const parsedRoute = useMemo(() => parseStudioRoute(location.pathname), [location.pathname])
  const activeMode = parsedRoute.mode
  const isLookmlMode = activeMode === 'lookml'
  const isHealthCheckMode =
    location.pathname === '/health-check' || activeMode === 'health'
  const builderMode: 'data_app' | 'dashboard' =
    activeMode === 'dashboard' ? 'dashboard' : 'data_app'

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
  const [myCreations, setMyCreations] = useState<
    Array<{ id: string; title: string; contentType: NativeContentType; embedPath: string }>
  >([])
  const lastPublishedIdRef = useRef<string>('')
  const lastNativeIdRef = useRef<string>('')
  const [healthReport, setHealthReport] = useState<HealthCheckReportPayload | null>(null)
  const [healthScope, setHealthScope] = useState<'all' | 'looker' | 'bq'>('all')
  const lastHealthIdRef = useRef<string>('')
  const [currentAppCode, setCurrentAppCode] = useState('')
  const [loadDashInput, setLoadDashInput] = useState('')

  // Per-mode isolated Antigravity sessions & chat histories
  const [sessionsByMode, setSessionsByMode] = useState<Record<StudioMode, AgentSession>>({
    app: { toolType: 'app', environmentId: 'env_app_isolated' },
    dashboard: { toolType: 'dashboard', environmentId: 'env_dashboard_isolated' },
    lookml: { toolType: 'lookml', environmentId: 'env_lookml_isolated' },
    health: { toolType: 'health', environmentId: 'env_health_isolated' },
    tile: { toolType: 'tile', environmentId: 'env_tile_isolated' },
  })
  const [messagesByMode, setMessagesByMode] = useState<Record<StudioMode, ChatMessage[]>>(() => {
    const initialErr = mockExt?.initialError
      ? [{ role: 'error' as const, text: String(mockExt.initialError) }]
      : []
    return { app: initialErr, dashboard: [], lookml: [], health: [], tile: [] }
  })

  const agentSession = sessionsByMode[activeMode] || { toolType: activeMode }
  const setAgentSession = useCallback(
    (next: AgentSession, targetMode: StudioMode = activeMode) => {
      setSessionsByMode((prev) => ({
        ...prev,
        [targetMode]: {
          ...next,
          toolType: targetMode,
          environmentId:
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

  const handleWakeModeEnv = useCallback(
    async (modeToWake: StudioMode = activeMode) => {
      try {
        const res = await prewarmOrWakeAntigravityEnvironment({
          extensionSDK,
          auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
          toolType: modeToWake,
          model: selectedModel,
          existingSession: sessionsByMode[modeToWake],
          selectedExplores,
          schemaMarkdown,
          existingAppCode: modeToWake === 'app' ? currentAppCode : undefined,
        })
        setSessionsByMode((prev) => ({ ...prev, [modeToWake]: res.session }))
      } catch {}
    },
    [
      activeMode,
      extensionSDK,
      authMode,
      oauthToken,
      clientId,
      projectId,
      apiKey,
      selectedModel,
      sessionsByMode,
      selectedExplores,
      schemaMarkdown,
      currentAppCode,
    ]
  )

  useEffect(() => {
    if (!isConfigured && !oauthToken && !apiKey) return
    let mounted = true
    listAvailableAntigravityModels(extensionSDK, {
      mode: authMode,
      oauthToken,
      clientId,
      projectId,
      apiKey,
    }).then((list) => {
      if (mounted && list.length > 0) setAvailableModels(list)
    })
    return () => {
      mounted = false
    }
  }, [extensionSDK, isConfigured, authMode, oauthToken, clientId, projectId, apiKey])

  useEffect(() => {
    if (disabledModes.includes(activeMode)) return
    handleWakeModeEnv(activeMode)
  }, [activeMode, disabledModes])

  const [catalogItems, setCatalogItems] = useState<UserArtifactIndex[]>([])
  const [catalogSearch, setCatalogSearch] = useState('')
  const [activeObjectId, setActiveObjectId] = useState('')
  const [conversations, setConversations] = useState<UserConversationEntry[]>([])
  const conversationLabelsRef = useRef<Record<string, string>>({})
  const [activeConversationId, setActiveConversationId] = useState<string>(
    () => `conv_${Date.now()}`
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    Boolean(mockExt?.initialSidebarCollapsed)
  )

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
    } as Record<string, StudioMode>)[t || ''] ||
    (t as StudioMode) ||
    'app'

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    return catalogItems.filter((item) => {
      if (disabledModes.includes(normalizeCatalogMode(item.type))) return false
      if (!q) return true
      return `${item.label || ''} ${item.title} ${item.id} ${item.type} ${(item.explores || []).join(' ')}`
        .toLowerCase()
        .includes(q)
    })
  }, [catalogItems, catalogSearch, disabledModes])

  const filteredConversations = useMemo(
    () =>
      conversations.filter(
        (conv) => !disabledModes.includes(normalizeCatalogMode(conv.type))
      ),
    [conversations, disabledModes]
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
      history.replace(enabledModes[0].prefix)
    } catch (err: any) {
      setBusyStatus(null)
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    }
  }

  useEffect(() => {
    let mounted = true
    fetchInitialLookerMetadata(core40SDK)
      .then((meta) => {
        if (!mounted) return
        const resolvedUserId = String(meta.user?.id || '1')
        setUserId(resolvedUserId)
        setCapabilities(meta.capabilities)
        if (meta.capabilities.rolesLoaded && meta.capabilities.sqlRunnerConnections.size === 0) {
          setHealthScope((prev) => (prev === 'all' || prev === 'bq' ? 'looker' : prev))
        }
        listUserLookmlSessions(core40SDK, extensionSDK, resolvedUserId).then((s) => {
          if (mounted) setLookmlSessions(s)
        })
        setAllModels(
          meta.models.map((m: any) => ({
            name: String(m.name),
            label: String(m.label || m.name),
            project_name: m.project_name ? String(m.project_name) : undefined,
            explores: (m.explores || []).filter((e: any) => !e.hidden),
          }))
        )
        const editableIds = meta.capabilities.editableFolderIds
        const rawFolders = meta.folders || []
        const filteredFolders = rawFolders.filter((f: any) => editableIds.has(String(f.id)))
        setFolders(
          (filteredFolders.length > 0 ? filteredFolders : rawFolders).map((f: any) => ({
            id: String(f.id),
            name: `${f.name} (#${f.id})`,
          }))
        )
        setSelectedFolderId((prev) => (prev === '1' ? meta.defaultFolderId : prev))
        listUserDashboardArtifacts(core40SDK, extensionSDK, resolvedUserId).then((items) => {
          if (mounted) setMyCreations(items)
        })
        refreshCatalog(resolvedUserId)
        loadUserConversations(
          core40SDK,
          resolvedUserId,
          getArtifactNamespace(extensionSDK)
        ).then(async (loadedConvs) => {
          if (!mounted) return
          if (loadedConvs.length > 0) {
            setConversations(loadedConvs)
          } else {
            const legacyItems = await listUserArtifacts(core40SDK, resolvedUserId)
            if (!mounted) return
            setCatalogItems(legacyItems)
            if (legacyItems.length > 0) {
              setConversations(
                legacyItems.map((item) => ({
                  id: `conv_${item.type}_${item.id}`,
                  type: item.type,
                  interactionId: item.lastInteractionId,
                  environmentId: item.environmentId,
                  label: item.label || item.title,
                  createdAt: item.updatedAt || new Date().toISOString(),
                  updatedAt: item.updatedAt || new Date().toISOString(),
                  explores: item.explores,
                  content:
                    item.type === 'app' || item.type === 'data_app'
                      ? { dashboardId: item.id, appArtifactId: `obj_app_${item.id}` }
                      : item.type === 'dashboard'
                      ? { dashboardId: item.id }
                      : item.type === 'lookml'
                      ? { sessionId: item.id }
                      : item.type === 'health' || item.type === 'health_check'
                      ? { reportId: item.id }
                      : { scriptId: item.id },
                }))
              )
            }
          }
        })
      })
      .catch((err) => {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Failed to load Looker models: ${err.message}` },
        ])
      })
    return () => {
      mounted = false
    }
  }, [core40SDK, extensionSDK])

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

  const handleOAuthLogin = async () => {
    if (!clientId.trim()) {
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: 'Enter your Google Web OAuth 2.0 Client ID first.' },
      ])
      return
    }
    try {
      setBusyStatus('Opening Google OAuth sign-in...')
      setOauthToken(await loginWithGoogleOAuth(extensionSDK, clientId))
      setBusyStatus(null)
    } catch (err: any) {
      setBusyStatus(null)
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: `Google OAuth failed: ${err.message || err}` },
      ])
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

  const loadDashboardById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(
        `Loading Data App from dashboard #${id}...`,
        `Could not load dashboard #${id}`,
        async () => {
          const loaded = await loadExistingDashboardApp(core40SDK, id)
          lastPublishedIdRef.current = loaded.dashboardId
          setPublishedApp(loaded)
          setActiveObjectId(loaded.dashboardId)
          setActiveConversationId((prev) => {
            const match = conversations.find(
              (c) =>
                String(c.content?.dashboardId || c.content?.id || '') === loaded.dashboardId &&
                (c.type === 'app' || c.type === 'data_app')
            )
            return match ? match.id : prev.startsWith('conv_app_') ? prev : `conv_app_${loaded.dashboardId}`
          })
          setCurrentAppCode(loaded.code)
          setLoadDashInput(loaded.dashboardId)
          setSelectedFolderId(loaded.folderId)
          const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
          const legacyExplore =
            loaded.studio?.modelName && loaded.studio?.exploreName
              ? [formatExploreId(loaded.studio.modelName, loaded.studio.exploreName)]
              : []
          const queryExplores = Array.from(
            new Set(
              (loaded.manifestQueries || [])
                .filter((q) => q.model && q.explore)
                .map((q) => formatExploreId(q.model, q.explore))
            )
          )
          const resolvedExplores =
            studioExplores.length > 0
              ? studioExplores
              : legacyExplore.length > 0
              ? legacyExplore
              : queryExplores.length > 0
              ? queryExplores
              : extractExploreIdsFromCode(loaded.code)
          setSelectedExplores(resolvedExplores)
          const savedInteractionId =
            loaded.studio?.lastInteractionId || loaded.studio?.lastSession?.lastInteractionId
          const savedEnvironmentId =
            loaded.studio?.environmentId || loaded.studio?.lastSession?.environmentId
          setAgentSession(
            savedInteractionId
              ? {
                  lastInteractionId: savedInteractionId,
                  environmentId: savedEnvironmentId || 'env_app_42',
                  explores: resolvedExplores,
                  toolType: 'app',
                }
              : { toolType: 'app', environmentId: 'env_app_42' },
            'app'
          )
          if (pushRoute && location.pathname !== `/${loaded.dashboardId}`) {
            history.replace(`/${encodeURIComponent(loaded.dashboardId)}`)
          }
          setMessages(
            loaded.studio?.messages?.length
              ? loaded.studio.messages
              : [
                  {
                    role: 'assistant',
                    text: `Loaded existing Data App "${loaded.title}" (Dashboard #${loaded.dashboardId}, ${loaded.code.length.toLocaleString()} bytes). Describe any changes to update it in place.`,
                    dashboardId: loaded.dashboardId,
                  },
                ],
            'app'
          )
        }
      )
    },
    [core40SDK, history, location.pathname, runWithBusy, setAgentSession, setMessages]
  )

  const loadNativeById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(
        `Loading native Looker content #${id}...`,
        `Could not load native content #${id}`,
        async () => {
          const loaded = await loadNativeContentById(core40SDK, extensionSDK, id)
          lastNativeIdRef.current = loaded.id
          setNativeContent(loaded)
          setActiveObjectId(loaded.id)
          setActiveConversationId((prev) => {
            const match = conversations.find(
              (c) =>
                String(
                  c.content?.dashboardId ||
                    c.content?.lookId ||
                    c.content?.lookmlDashboardId ||
                    c.content?.id ||
                    ''
                ) === loaded.id && c.type === 'dashboard'
            )
            return match ? match.id : prev.startsWith('conv_dashboard_') ? prev : `conv_dashboard_${loaded.id}`
          })
          setLoadDashInput(loaded.id)
          setSelectedFolderId(loaded.folderId)
          const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
          if (studioExplores.length > 0) setSelectedExplores(studioExplores)
          const savedInteractionId =
            loaded.studio?.lastInteractionId || loaded.studio?.lastSession?.lastInteractionId
          const savedEnvironmentId =
            loaded.studio?.environmentId || loaded.studio?.lastSession?.environmentId
          setAgentSession(
            savedInteractionId
              ? {
                  lastInteractionId: savedInteractionId,
                  environmentId: savedEnvironmentId || 'env_dashboard_7',
                  explores: studioExplores,
                  toolType: 'dashboard',
                }
              : { toolType: 'dashboard', environmentId: 'env_dashboard_7' },
            'dashboard'
          )
          const targetRoute = `/dashboard/${encodeURIComponent(loaded.id)}`
          if (pushRoute && location.pathname !== targetRoute) history.replace(targetRoute)
          setMessages(
            loaded.studio?.messages?.length
              ? loaded.studio.messages
              : [
                  {
                    role: 'assistant',
                    text: `Loaded native Looker ${loaded.contentType} "${loaded.title}" (#${loaded.id}). Ask for tiles, filters, looks, boards, or schedules to update it via CodeMode.`,
                    dashboardId: loaded.id,
                  },
                ],
            'dashboard'
          )
        }
      )
    },
    [core40SDK, extensionSDK, history, location.pathname, runWithBusy, setAgentSession, setMessages]
  )

  const loadHealthCheckById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(
        `Loading Health Check report "${id}"...`,
        `Could not load Health Check "${id}"`,
        async () => {
          const loaded = await loadHealthCheckArtifact(core40SDK, extensionSDK, id)
          lastHealthIdRef.current = loaded.id
          setHealthReport(loaded)
          setActiveObjectId(loaded.id)
          setActiveConversationId((prev) => {
            const match = conversations.find(
              (c) =>
                String(c.content?.reportId || c.content?.id || '') === loaded.id &&
                (c.type === 'health' || c.type === 'health-check' || c.type === 'health_check')
            )
            return match ? match.id : prev.startsWith('conv_health_') ? prev : `conv_health_${loaded.id}`
          })
          setLoadDashInput(loaded.id)
          setAgentSession(
            {
              lastInteractionId: loaded.lastInteractionId,
              environmentId: loaded.environmentId || `env_health_${loaded.id}`,
              toolType: 'health',
            },
            'health'
          )
          setMessages(
            loaded.messages?.length
              ? loaded.messages
              : [
                  {
                    role: 'assistant',
                    text: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00) from obj_health_check_${loaded.id}.`,
                  },
                ],
            'health'
          )
          if (pushRoute && location.pathname !== `/health-check/${loaded.id}`) {
            history.replace(`/health-check/${encodeURIComponent(loaded.id)}`)
          }
        }
      )
    },
    [core40SDK, extensionSDK, history, location.pathname, runWithBusy, setAgentSession, setMessages]
  )

  const loadLookmlSessionById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      await runWithBusy(
        `Loading LookML session "${id}"...`,
        `Could not load LookML session "${id}"`,
        async () => {
          const loaded = await loadLookmlSessionArtifact(core40SDK, extensionSDK, id)
          lastLookmlIdRef.current = loaded.id
          setLookmlBundle(loaded.bundle)
          setActiveObjectId(loaded.id)
          setActiveConversationId((prev) => {
            const match = conversations.find(
              (c) =>
                String(c.content?.sessionId || c.content?.id || '') === loaded.id &&
                c.type === 'lookml'
            )
            return match ? match.id : prev.startsWith('conv_lookml_') ? prev : `conv_lookml_${loaded.id}`
          })
          setLoadLookmlInput(loaded.id)
          if (loaded.bundle?.project_id) setLookmlProjectId(loaded.bundle.project_id)
          const savedExplores = loaded.studio?.explores?.filter(Boolean) || []
          setSelectedExplores(savedExplores)
          setAgentSession(
            loaded.studio?.lastInteractionId
              ? {
                  lastInteractionId: loaded.studio.lastInteractionId,
                  environmentId: loaded.studio.environmentId || `env_lookml_${loaded.id}`,
                  explores: savedExplores,
                  toolType: 'lookml',
                }
              : { toolType: 'lookml', environmentId: `env_lookml_${loaded.id}` },
            'lookml'
          )
          setMessages(
            loaded.studio?.messages?.length
              ? loaded.studio.messages
              : [
                  {
                    role: 'assistant',
                    text: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} modified .lkml files).`,
                  },
                ],
            'lookml'
          )
          if (pushRoute && location.pathname !== `/lookml/${loaded.id}`) {
            history.replace(`/lookml/${encodeURIComponent(loaded.id)}`)
          }
        }
      )
    },
    [core40SDK, extensionSDK, history, location.pathname, runWithBusy, setAgentSession, setMessages]
  )

  const handleRunHealthCheck = async (
    customFocus?: string,
    baseMessages?: ChatMessage[],
    images?: PastedImage[]
  ) => {
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
              {
                type: 'inline',
                content: THREE_PILLAR_CODEMODE_PY,
                target: '/workspace/three_pillar_audit.py',
              },
              {
                type: 'inline',
                content: finalReport.tddMarkdown,
                target: '/workspace/TECHNICAL_DESIGN_DOCUMENT.md',
              },
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
      setHealthReport(finalReport)
      setActiveObjectId(finalReport.id)
      setLoadDashInput(finalReport.id)
      if (location.pathname !== `/health-check/${finalReport.id}`) {
        history.replace(`/health-check/${encodeURIComponent(finalReport.id)}`)
      }
      const nextHealthMsgs: ChatMessage[] = [
        ...activeMsgs,
        {
          role: 'assistant',
          text: `3-Pillar Health Check complete: **${finalReport.scores.overallScore}% (${finalReport.scores.grade})** | Pillar 1: ${finalReport.scores.pillar1Score}% · Pillar 2: ${finalReport.scores.pillar2Score}% (Transcriber ${finalReport.scores.transcriberScore}/4.00) · Pillar 3: ${finalReport.scores.pillar3Score}%.\nSaved to \`${baseRes.userKey}\` and \`${baseRes.objKey}\`.`,
        },
      ]
      setMessages(nextHealthMsgs)
      const convId = activeConversationId.startsWith('conv_health_')
        ? activeConversationId
        : `conv_health_${finalReport.id}`
      setActiveConversationId(convId)
      void saveUserConversation(
        core40SDK,
        userId,
        {
          id: convId,
          type: 'health-check',
          interactionId: finalReport.lastInteractionId || agentSession.lastInteractionId,
          environmentId: finalReport.environmentId || agentSession.environmentId,
          label: finalReport.title,
          content: {
            reportId: finalReport.id,
            projectId: finalReport.projectId,
            overallScore: finalReport.scores.overallScore,
            grade: finalReport.scores.grade,
          },
          messages: nextHealthMsgs,
          explores: selectedExplores,
        },
        getArtifactNamespace(extensionSDK)
      )
        .then(setConversations)
        .catch(() => {})
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    } finally {
      setBusyStatus(null)
    }
  }

  useEffect(() => {
    if (isTileMount || location.pathname === '/config') return
    if (disabledModes.includes(activeMode)) {
      history.replace(enabledModes[0].prefix)
      return
    }
    if (!isConfigured && activeMode !== 'tile') {
      history.replace('/config')
    }
  }, [isTileMount, isConfigured, location.pathname, activeMode, disabledModes, enabledModes, history])

  useEffect(() => {
    if (
      isTileMount ||
      location.pathname === '/config' ||
      activeMode === 'tile' ||
      disabledModes.includes(activeMode)
    )
      return
    const id = parsedRoute.objectId
    if (!id) return
    if (activeMode === 'lookml' && id !== lookmlBundle?.id && id !== lastLookmlIdRef.current) {
      loadLookmlSessionById(id, false)
    } else if (activeMode === 'health' && id !== healthReport?.id && id !== lastHealthIdRef.current) {
      loadHealthCheckById(id, false)
    } else if (
      activeMode === 'dashboard' &&
      id !== nativeContent?.id &&
      id !== lastNativeIdRef.current
    ) {
      loadNativeById(id, false)
    } else if (
      activeMode === 'app' &&
      id !== publishedApp?.dashboardId &&
      id !== lastPublishedIdRef.current
    ) {
      loadDashboardById(id, false)
    }
  }, [
    isTileMount,
    location.pathname,
    activeMode,
    parsedRoute.objectId,
    publishedApp?.dashboardId,
    nativeContent?.id,
    lookmlBundle?.id,
    healthReport?.id,
    loadDashboardById,
    loadNativeById,
    loadLookmlSessionById,
    loadHealthCheckById,
  ])

  const handleLoadExistingDashboard = async () => {
    if (isHealthCheckMode) await loadHealthCheckById(loadDashInput, true)
    else if (builderMode === 'dashboard') await loadNativeById(loadDashInput, true)
    else await loadDashboardById(loadDashInput, true)
  }

  const handleResetNewApp = () => {
    lastPublishedIdRef.current = ''
    lastNativeIdRef.current = ''
    lastLookmlIdRef.current = ''
    lastHealthIdRef.current = ''
    setActiveObjectId('')
    setActiveConversationId(`conv_${Date.now()}`)
    setPublishedApp(null)
    setNativeContent(null)
    setLookmlBundle(null)
    setHealthReport(null)
    setCurrentAppCode('')
    setLoadDashInput('')
    setLoadLookmlInput('')
    setSelectedExplores([])
    setAgentSession({})
    setMessages([])
    setPastedImages([])
    setPrompt('')
    const baseRoute = isHealthCheckMode
      ? '/health-check'
      : isLookmlMode
      ? '/lookml'
      : builderMode === 'dashboard'
      ? '/dashboard'
      : '/app'
    if (location.pathname !== baseRoute) history.push(baseRoute)
  }

  const handleSelectConversation = async (conv: ConversationRecord) => {
    const mode = normalizeCatalogMode(conv.type)
    setActiveConversationId(conv.id)
    if (conv.explores?.length) setSelectedExplores(conv.explores)
    const c = conv.content || {}
    if (mode === 'app' && (c.dashboardId || c.id)) {
      const targetId = String(c.dashboardId || c.id)
      setActiveObjectId(targetId)
      await loadDashboardById(targetId, true)
    } else if (
      mode === 'dashboard' &&
      (c.dashboardId || c.lookId || c.lookmlDashboardId || c.id)
    ) {
      const targetId = String(c.dashboardId || c.lookId || c.lookmlDashboardId || c.id)
      setActiveObjectId(targetId)
      await loadNativeById(targetId, true)
    } else if (mode === 'lookml' && (c.sessionId || c.id)) {
      const targetId = String(c.sessionId || c.id)
      setActiveObjectId(targetId)
      await loadLookmlSessionById(targetId, true)
    } else if (mode === 'health' && (c.reportId || c.id)) {
      const targetId = String(c.reportId || c.id)
      setActiveObjectId(targetId)
      await loadHealthCheckById(targetId, true)
    } else if (mode === 'tile' && (c.scriptId || c.id)) {
      const targetId = String(c.scriptId || c.id)
      setActiveObjectId(targetId)
      history.push(`/tile/${encodeURIComponent(targetId)}`)
    } else {
      const modeInfo = STUDIO_MODES.find((m) => m.mode === mode)
      const targetPath = modeInfo ? modeInfo.prefix : '/app'
      if (location.pathname !== targetPath) history.push(targetPath)
    }
    setActiveConversationId(conv.id)
    if (conv.messages?.length) {
      setMessages(conv.messages as ChatMessage[], mode)
    }
    if (conv.interactionId || conv.environmentId) {
      setAgentSession(
        {
          lastInteractionId: conv.interactionId,
          environmentId: conv.environmentId || `env_${mode}_isolated`,
          explores: conv.explores,
          toolType: mode,
        },
        mode
      )
    }
  }

  const handleDeleteConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation()
    setConversations((prev) => prev.filter((c) => c.id !== conversationId))
    try {
      const next = await deleteUserConversation(
        core40SDK,
        userId,
        conversationId,
        getArtifactNamespace(extensionSDK)
      )
      setConversations(next)
    } catch {}
    if (activeConversationId === conversationId) {
      handleResetNewApp()
    }
  }

  const handleSelectCatalogItem = async (item: UserArtifactIndex) => {
    const mode = normalizeCatalogMode(item.type)
    const modeInfo = STUDIO_MODES.find((m) => m.mode === mode)
    const targetPath = modeInfo
      ? `${modeInfo.prefix}/${encodeURIComponent(item.id)}`
      : `/app/${encodeURIComponent(item.id)}`
    setActiveObjectId(item.id)
    if (location.pathname !== targetPath) history.push(targetPath)
    if (mode === 'app') await loadDashboardById(item.id, false)
    else if (mode === 'dashboard') await loadNativeById(item.id, false)
    else if (mode === 'lookml') await loadLookmlSessionById(item.id, false)
    else if (mode === 'health') await loadHealthCheckById(item.id, false)
    else {
      const loaded = await loadObjectArtifact(core40SDK, item.type, item.id)
      if (loaded?.messages) setMessages(loaded.messages)
    }
  }

  const handleDeleteCatalogItem = async (e: React.MouseEvent, item: UserArtifactIndex) => {
    e.stopPropagation()
    try {
      await deleteUserArtifact(core40SDK, userId, item.type, item.id, true)
      await refreshCatalog()
    } catch {}
  }

  const handleSendPrompt = async () => {
    const text = prompt.trim()
    if ((!text && pastedImages.length === 0) || busyStatus) return
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

    if (isHealthCheckMode) {
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
      await refreshCatalog()
      return
    }

    setBusyStatus('Connecting to Antigravity...')
    try {
      const result = await runAntigravityTurn({
        sdk: core40SDK,
        extensionSDK,
        auth,
        session: agentSession,
        model: selectedModel,
        mode: builderMode,
        selectedExplores,
        folderId: selectedFolderId,
        toolMode: isLookmlMode ? 'lookml' : 'data_app',
        lookmlProjectId,
        activatedLookmlSkills,
        developableProjects: availableLookmlProjects,
        canDeploy: canDeployLookml,
        schemaMarkdown,
        userPrompt: effectivePrompt,
        images: attachedImages,
        existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent,
        priorMessages: messages,
        requirePermission,
        approvedOperations: approvedOpsRef.current,
        onPermissionRequest: requestCodeModePermission,
        onStatus: setBusyStatus,
      })

      let convId = activeObjectId || activeConversationId || result.session.lastInteractionId || 'conv_1'
      let convMode: StudioMode = activeMode
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
          },
        ]
        setLookmlBundle(result.lookmlBundle)
        if (result.lookmlBundle.project_id) setLookmlProjectId(result.lookmlBundle.project_id)
        convId = result.lookmlBundle.id || 'lookml_1'
        convMode = 'lookml'
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
          if (location.pathname !== `/lookml/${saved.id}`) {
            history.replace(`/lookml/${encodeURIComponent(saved.id)}`)
          }
        } catch {}
        setAgentSession({ ...result.session, explores: selectedExplores })
        setMessages(finalMsgs)
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
        setAgentSession({ ...result.session, explores: effectiveExplores })

        if (builderMode === 'dashboard' && result.nativeBundle) {
          setBusyStatus('Indexing native Looker content in user catalog...')
          const prelimAssistantMsg: ChatMessage = {
            role: 'assistant',
            text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            widgetCount: result.nativeBundle.tile_count,
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
          setNativeContent(savedNative)
          setActiveObjectId(savedNative.id)
          setLoadDashInput(savedNative.id)
          const targetRoute = `/dashboard/${encodeURIComponent(savedNative.id)}`
          if (location.pathname !== targetRoute) history.replace(targetRoute)
          listUserDashboardArtifacts(core40SDK, extensionSDK, userId).then(setMyCreations)
          await refreshCatalog()
          finalMsgs = [
            ...messagesWithUser,
            { ...prelimAssistantMsg, dashboardId: savedNative.id },
          ]
          setMessages(finalMsgs)
          convId = savedNative.id
          convMode = 'dashboard'
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
          setPublishedApp(upserted)
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
          if (location.pathname !== `/${upserted.dashboardId}`) {
            history.replace(`/${encodeURIComponent(upserted.dashboardId)}`)
          }
          setMessages(finalMsgs)
          convId = upserted.dashboardId
          convMode = 'app'
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
            },
          ]
          setMessages(finalMsgs)
          if (builderMode === 'dashboard' && nativeContent) {
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
            convTitle = publishedApp.title
            convContent = {
              dashboardId: publishedApp.dashboardId,
              appArtifactId: `obj_app_${publishedApp.dashboardId}`,
            }
          }
        }
      }

      setActiveConversationId(convId)
      const namespace = getArtifactNamespace(extensionSDK)
      const baseConv = {
        id: convId,
        type: convMode,
        interactionId: result.session.lastInteractionId,
        environmentId: result.session.environmentId,
        explores: convExplores,
        ...(convContent ? { content: convContent } : {}),
        messages: finalMsgs,
      }
      void saveUserConversation(
        core40SDK,
        userId,
        {
          ...baseConv,
          ...(isFirstTurn
            ? { label: convTitle || sanitizeConversationLabel('', effectivePrompt) }
            : {}),
          updatedAt: new Date().toISOString(),
        },
        namespace
      )
        .then(setConversations)
        .catch(() => {})

      if (isFirstTurn) {
        void generateConversationLabel({
          extensionSDK,
          auth,
          environmentId: result.session.environmentId,
          userPrompt: effectivePrompt,
          assistantText: result.assistantText,
          model: selectedModel,
        })
          .then(async (label) => {
            if (!label) return
            conversationLabelsRef.current[convId] = label
            setCatalogItems((prev) =>
              prev.map((it) => (it.id === convId ? { ...it, label, title: label } : it))
            )
            setMyCreations((prev) =>
              prev.map((c) => (c.id === convId ? { ...c, title: label } : c))
            )
            setLookmlSessions((prev) =>
              prev.map((s) => (s.id === convId ? { ...s, title: label } : s))
            )
            const updatedAt = new Date().toISOString()
            await saveUserConversation(
              core40SDK,
              userId,
              { ...baseConv, label, updatedAt },
              namespace
            )
              .then(setConversations)
              .catch(() => {})
            await saveUserArtifact(
              core40SDK,
              userId,
              {
                id: convId,
                type: convMode,
                title: label,
                label,
                explores: convExplores,
                lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId,
                updatedAt,
                createdBy: userId,
              },
              undefined,
              namespace
            ).catch(() => {})
          })
          .catch(() => {})
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    } finally {
      setPendingPerm(null)
      setBusyStatus(null)
    }
  }

  const isEmptyConversation =
    !isTileMount &&
    location.pathname !== '/config' &&
    activeMode !== 'tile' &&
    !parsedRoute.objectId &&
    messages.length === 0 &&
    !publishedApp &&
    !nativeContent &&
    !lookmlBundle &&
    !healthReport &&
    !busyStatus

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).__DAB_STUDIO__ = {
        history,
        requestCodeModePermission,
        setRequirePermission,
        setDisabledModes,
        setSelectedModel,
        setAuthMode,
        setApiKey,
        setSidebarCollapsed,
        handleNewConversation: handleResetNewApp,
        handleSelectConversation,
      }
    }
  }, [history, requestCodeModePermission, handleResetNewApp, handleSelectConversation])

  return {
    extensionSDK,
    core40SDK,
    history,
    location,
    isTileMount,
    authMode,
    setAuthMode,
    clientId,
    setClientId,
    projectId,
    setProjectId,
    disabledModes,
    setDisabledModes,
    selectedModel,
    setSelectedModel,
    availableModels,
    enabledModes,
    oauthToken,
    apiKey,
    setApiKey,
    capabilities,
    availableLookmlProjects,
    canDeployLookml,
    models,
    folders,
    selectedExplores,
    setSelectedExplores,
    selectedFolderId,
    setSelectedFolderId,
    schemaMarkdown,
    loadingSchema,
    activeMode,
    isLookmlMode,
    isHealthCheckMode,
    builderMode,
    lookmlProjectId,
    setLookmlProjectId,
    activatedLookmlSkills,
    setActivatedLookmlSkills,
    lookmlBundle,
    lookmlSessions,
    loadLookmlInput,
    setLoadLookmlInput,
    publishedApp,
    nativeContent,
    myCreations,
    healthReport,
    healthScope,
    setHealthScope,
    currentAppCode,
    loadDashInput,
    setLoadDashInput,
    agentSession,
    messages,
    prompt,
    setPrompt,
    pastedImages,
    setPastedImages,
    busyStatus,
    handleWakeModeEnv,
    filteredCatalog,
    catalogSearch,
    setCatalogSearch,
    activeObjectId,
    conversations: filteredConversations,
    activeConversationId,
    sidebarCollapsed,
    setSidebarCollapsed,
    isEmptyConversation,
    requirePermission,
    setRequirePermission,
    pendingPerm,
    resolvePermDecision,
    handleSaveAuthSetup,
    handleOAuthLogin,
    loadNativeById,
    loadLookmlSessionById,
    handleRunHealthCheck,
    handleLoadExistingDashboard,
    handleResetNewApp,
    handleNewConversation: handleResetNewApp,
    handleSelectConversation,
    handleDeleteConversation,
    handleSelectCatalogItem,
    handleDeleteCatalogItem,
    handleSendPrompt,
  }
}

export type StudioController = ReturnType<typeof useStudioController>
