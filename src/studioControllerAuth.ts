import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useHistory, useLocation } from 'react-router-dom'

import {
  AgentSession, ANTIGRAVITY_ALLOWED_MODELS, AntigravityModelOption,
  clearStoredOAuthSession, DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_THINKING_LEVEL, ensureGeminiApiKeyUserAttribute, ExtensionAuthContextConfig,
  getInitialStoredOAuthSession, getInitialStoredOAuthToken, listAvailableAntigravityModels,
  loadStoredOAuthSession, loadStoredThinkingLevel, loginWithGoogleOAuth, normalizeEnvironmentId,
  normalizeMaxTotalTokens, normalizeThinkingLevel, parseValidOAuthSession, persistThinkingLevel,
  readInitialThinkingLevel, refreshOAuthSessionIfNeeded, resolveLookerOAuthRedirectUri,
  STUDIO_OAUTH_REFRESH_INTERVAL_MS, STUDIO_OAUTH_STORAGE_KEY, StudioThinkingLevel,
} from './antigravity'
import { ChatMessage, parseStudioRoute, STUDIO_MODES, StudioMode } from './components/App'
import { useLookerExtension } from './contexts/LookerExtensionContext'
import {
  applyStudioDocumentTheme, clampLeftPaneWidth, getAllowedUseCases, loadStoredBusySendAction,
  loadStoredLeftPaneWidth, loadStoredRightPaneCollapsed, loadStoredStudioThemeMode,
  normalizeBusySendAction, normalizeStudioAgentName, normalizeStudioThemeMode,
  persistStudioThemeMode, readInitialBusySendAction, readInitialLeftPaneWidth,
  readInitialRightPaneCollapsed, readInitialStudioThemeMode, ResolvedStudioTheme,
  ResolvedStudioUseCase, resolveStudioTheme, resolveSystemTheme, resolveUserCapabilities,
  saveStoredBusySendAction, saveStoredLeftPaneWidth, saveStoredRightPaneCollapsed,
  STUDIO_USE_CASE_OPTIONS, StudioBusySendAction, StudioThemeMode, StudioUseCase, UserCapabilities,
} from './lookerApi'

export type HostDataWithMount = { mountType?: string; mountPoint?: string; hostUrl?: string; extensionId?: string }

export const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err || ''))

export const normalizeCatalogMode = (t?: string): StudioMode =>
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

export function useStudioAuthAndPrefs() {
  const { extensionSDK, core40SDK, tileHostData, lookerHostData } = useLookerExtension()
  const history = useHistory()
  const location = useLocation()
  const extHostData = (extensionSDK as { lookerHostData?: HostDataWithMount } | undefined)?.lookerHostData
  const hostData = (lookerHostData as HostDataWithMount | undefined) || extHostData
  const mountType = hostData?.mountType || extHostData?.mountType || lookerHostData?.mountPoint || extHostData?.mountPoint
  const isTileMount =
    mountType === 'dashboard_tile' || mountType === 'dashboard-tile' || Boolean(tileHostData?.elementId || tileHostData?.dashboardId)

  const initialCtx = (() => {
    try { return (extensionSDK.getContextData() as ExtensionAuthContextConfig | undefined) || undefined } catch { return undefined }
  })()
  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>(initialCtx?.authMode || 'oauth')
  const [clientId, setClientId] = useState(initialCtx?.clientId || '')
  const [projectId, setProjectId] = useState(initialCtx?.projectId || '')
  const [disabledModes, setDisabledModes] = useState<StudioMode[]>(() =>
    Array.isArray(initialCtx?.disabledModes) ? (initialCtx.disabledModes as StudioMode[]) : []
  )
  const [selectedModel, setSelectedModel] = useState<string>(initialCtx?.defaultModel || DEFAULT_ANTIGRAVITY_MODEL)
  const [defaultThinkingLevel, setDefaultThinkingLevelState] = useState<StudioThinkingLevel>(() =>
    normalizeThinkingLevel(initialCtx?.defaultThinkingLevel || DEFAULT_THINKING_LEVEL)
  )
  const [maxTotalTokens, setMaxTotalTokensState] = useState<number>(() => normalizeMaxTotalTokens(initialCtx?.maxTotalTokens))
  const [thinkingLevel, setThinkingLevelState] = useState<StudioThinkingLevel>(() =>
    readInitialThinkingLevel(initialCtx?.defaultThinkingLevel || DEFAULT_THINKING_LEVEL)
  )
  const [availableModels, setAvailableModels] = useState<AntigravityModelOption[]>(ANTIGRAVITY_ALLOWED_MODELS)
  const enabledModes = useMemo(() => {
    const list = STUDIO_MODES.filter((m) => !disabledModes.includes(m.mode))
    return list.length > 0 ? list : [STUDIO_MODES[0]]
  }, [disabledModes])

  const initialClientId = initialCtx?.clientId || ''
  const initialOAuthSession = getInitialStoredOAuthSession(initialClientId)
  const [oauthToken, setOauthToken] = useState(() => initialOAuthSession?.token || getInitialStoredOAuthToken(initialClientId))
  const [oauthExpiresAt, setOauthExpiresAt] = useState<number>(
    () => initialOAuthSession?.expiresAt || (initialOAuthSession?.token ? Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS : 0)
  )
  const oauthPendingRefreshRef = useRef(false)
  const tabIdRef = useRef(`tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`)
  const [apiKey, setApiKey] = useState(() => String(mockExt?.initialApiKey || ''))
  const [oauthSigningIn, setOauthSigningIn] = useState(false)
  const oauthAbortRef = useRef<AbortController | null>(null)
  const isAuthenticated = authMode === 'apikey' ? Boolean(apiKey.trim()) : Boolean(oauthToken.trim())
  const oauthAccessToken = oauthToken.trim()

  const resetOAuthOnUnauthorized = useCallback(
    (err: unknown): string => {
      const msg = getErrorMessage(err)
      if (authMode === 'oauth' && /\b401\b|UNAUTHENTICATED/i.test(msg)) {
        clearStoredOAuthSession(extensionSDK); setOauthToken(''); setOauthExpiresAt(0)
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
          extensionSDK, clientId, tabId: tabIdRef.current, force, currentToken: oauthToken,
        })
        if (res?.deferredUntilVisible) { oauthPendingRefreshRef.current = true; return null }
        if (res?.token) {
          oauthPendingRefreshRef.current = false
          setOauthToken(res.token)
          if (res.expiresAt > 0) setOauthExpiresAt(res.expiresAt)
          return res.token
        }
        return null
      } catch {
        clearStoredOAuthSession(extensionSDK); setOauthToken(''); setOauthExpiresAt(0)
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
    return () => { mounted = false }
  }, [extensionSDK, initialClientId, mockExt])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== STUDIO_OAUTH_STORAGE_KEY) return
      if (!e.newValue) {
        oauthPendingRefreshRef.current = false; setOauthToken(''); setOauthExpiresAt(0); return
      }
      const { session } = parseValidOAuthSession(e.newValue, clientId)
      if (session) {
        oauthPendingRefreshRef.current = false; setOauthToken(session.token); setOauthExpiresAt(session.expiresAt)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clientId])

  useEffect(() => {
    if (authMode !== 'oauth' || !oauthToken.trim() || !clientId.trim() || !oauthExpiresAt) return
    const maybeRefresh = () => {
      if (Date.now() < oauthExpiresAt && !oauthPendingRefreshRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        oauthPendingRefreshRef.current = true; return
      }
      oauthPendingRefreshRef.current = false
      void triggerSilentOAuthRefresh(false)
    }
    const timer = setTimeout(maybeRefresh, Math.max(0, oauthExpiresAt - Date.now()))
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', maybeRefresh)
    if (typeof window !== 'undefined') window.addEventListener?.('focus', maybeRefresh)
    return () => {
      clearTimeout(timer)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', maybeRefresh)
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', maybeRefresh)
    }
  }, [authMode, oauthToken, clientId, oauthExpiresAt, triggerSilentOAuthRefresh])

  const oauthRedirectUri = useMemo(
    () => resolveLookerOAuthRedirectUri(lookerHostData?.hostUrl || extHostData?.hostUrl),
    [lookerHostData?.hostUrl, extHostData?.hostUrl]
  )
  const [isConfigured, setIsConfigured] = useState(() =>
    Boolean(initialCtx?.authMode && (initialCtx.authMode === 'apikey' || initialCtx.clientId))
  )
  const [themeMode, setThemeModeState] = useState<StudioThemeMode>(() => readInitialStudioThemeMode())
  const [systemTheme, setSystemTheme] = useState<ResolvedStudioTheme>(() => resolveSystemTheme())
  const resolvedTheme: ResolvedStudioTheme = resolveStudioTheme(themeMode, systemTheme)

  applyStudioDocumentTheme(resolvedTheme, themeMode)
  useEffect(() => { applyStudioDocumentTheme(resolvedTheme, themeMode) }, [resolvedTheme, themeMode])

  const [leftPaneWidth, setLeftPaneWidthState] = useState<number>(() => readInitialLeftPaneWidth())
  const [rightPaneCollapsed, setRightPaneCollapsedState] = useState<boolean>(() => readInitialRightPaneCollapsed())
  const [busySendAction, setBusySendActionState] = useState<StudioBusySendAction>(() => readInitialBusySendAction())

  useEffect(() => {
    let mounted = true
    void loadStoredStudioThemeMode(extensionSDK).then((s) => { if (mounted && s) setThemeModeState(s) })
    void loadStoredThinkingLevel(extensionSDK).then((s) => { if (mounted && s) setThinkingLevelState(s) })
    void loadStoredLeftPaneWidth(extensionSDK).then((w) => { if (mounted && Number.isFinite(w)) setLeftPaneWidthState(clampLeftPaneWidth(w)) })
    void loadStoredRightPaneCollapsed(extensionSDK).then((c) => { if (mounted) setRightPaneCollapsedState(Boolean(c)) })
    void loadStoredBusySendAction(extensionSDK).then((a) => { if (mounted && a) setBusySendActionState(normalizeBusySendAction(a)) })
    return () => { mounted = false }
  }, [extensionSDK])

  const setLeftPaneWidth = useCallback((next: number | ((prev: number) => number)) => {
    setLeftPaneWidthState((prev) => {
      const clamped = clampLeftPaneWidth(typeof next === 'function' ? next(prev) : next)
      void saveStoredLeftPaneWidth(clamped, extensionSDK)
      return clamped
    })
  }, [extensionSDK])

  const setRightPaneCollapsed = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setRightPaneCollapsedState((prev) => {
      const resolved = Boolean(typeof next === 'function' ? next(prev) : next)
      void saveStoredRightPaneCollapsed(resolved, extensionSDK)
      return resolved
    })
  }, [extensionSDK])

  const setBusySendAction = useCallback((next: StudioBusySendAction | ((prev: StudioBusySendAction) => StudioBusySendAction)) => {
    setBusySendActionState((prev) => {
      const resolved = normalizeBusySendAction(typeof next === 'function' ? next(prev) : next)
      void saveStoredBusySendAction(resolved, extensionSDK)
      return resolved
    })
  }, [extensionSDK])

  const setThinkingLevel = useCallback((next: StudioThinkingLevel | string) => {
    const level = normalizeThinkingLevel(next)
    setThinkingLevelState(level)
    persistThinkingLevel(extensionSDK, level)
  }, [extensionSDK])

  const setDefaultThinkingLevel = useCallback((next: StudioThinkingLevel | string) => {
    const level = normalizeThinkingLevel(next)
    setDefaultThinkingLevelState(level)
    setThinkingLevelState(level)
  }, [])

  const setMaxTotalTokens = useCallback((next: number | string) => {
    setMaxTotalTokensState(normalizeMaxTotalTokens(next))
  }, [])

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

  const [capabilities, setCapabilities] = useState<UserCapabilities>(() => resolveUserCapabilities())
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    mockExt?.initialSidebarCollapsed !== undefined
      ? Boolean(mockExt.initialSidebarCollapsed)
      : typeof window !== 'undefined' && window.innerWidth <= 768
  )
  const [agentName, setAgentNameState] = useState<string>(() => normalizeStudioAgentName(mockExt?.initialAgentName))
  const [appInitializing, setAppInitializing] = useState<boolean>(() =>
    mockExt ? Boolean(mockExt.forceAppInitializing) : !isTileMount
  )
  const setAgentName = useCallback(
    (next: string | ((prev: string) => string)) => {
      setAgentNameState((prev) => {
        const resolved = normalizeStudioAgentName(typeof next === 'function' ? next(prev) : next)
        try { extensionSDK?.updateTitle?.(resolved) } catch { /* ignore */ }
        return resolved
      })
    },
    [extensionSDK]
  )
  useEffect(() => {
    if (isTileMount) return
    try { extensionSDK?.updateTitle?.(agentName) } catch { /* ignore */ }
  }, [agentName, extensionSDK, isTileMount])

  const resolvedUseCaseByIdRef = useRef<Record<string, ResolvedStudioUseCase>>({})
  const parsedRoute = useMemo(() => parseStudioRoute(location.pathname), [location.pathname])
  if (parsedRoute.useCase && parsedRoute.useCase !== 'auto' && parsedRoute.objectId) {
    resolvedUseCaseByIdRef.current[parsedRoute.objectId] = parsedRoute.useCase
    if (parsedRoute.conversationId) {
      resolvedUseCaseByIdRef.current[parsedRoute.conversationId] = parsedRoute.useCase
    }
  }
  const [selectedUseCase, setSelectedUseCase] = useState<StudioUseCase>(() => parsedRoute.useCase || 'auto')
  const explicitUseCaseRef = useRef<StudioUseCase>(
    parsedRoute.useCase && !parsedRoute.objectId ? parsedRoute.useCase : 'auto'
  )
  const allowedUseCases = useMemo(() => getAllowedUseCases(capabilities, disabledModes), [capabilities, disabledModes])
  const useCaseOptions = useMemo(
    () => STUDIO_USE_CASE_OPTIONS.filter((opt) => !opt.capabilityMode || !disabledModes.includes(opt.capabilityMode)),
    [disabledModes]
  )

  const [sharedEnvironmentId, setSharedEnvironmentId] = useState('')
  const sharedEnvIdRef = useRef<string>('')
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
      return { app: mockExt.initialMessages as ChatMessage[], dashboard: [], lookml: [], health: [], tile: [] }
    }
    const initialErr = mockExt?.initialError ? [{ role: 'error' as const, text: String(mockExt.initialError) }] : []
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

  const activeModeRef = useRef<StudioMode>(parsedRoute.mode)
  const setAgentSession = useCallback(
    (next: AgentSession, targetMode: StudioMode = activeModeRef.current) => {
      const nextShared = normalizeEnvironmentId(next.environmentId)
      if (nextShared && nextShared !== sharedEnvIdRef.current && next.lastInteractionId) {
        sharedEnvIdRef.current = nextShared; setSharedEnvironmentId(nextShared)
      }
      setSessionsByMode((prev) => {
        const updated = {
          ...prev,
          [targetMode]: {
            ...next, toolType: targetMode,
            environmentId: sharedEnvIdRef.current || next.environmentId || prev[targetMode]?.environmentId || `env_${targetMode}_isolated`,
          },
        }
        sessionsByModeRef.current = updated
        return updated
      })
    },
    []
  )

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]), targetMode?: StudioMode) => {
      const mode = targetMode ?? activeModeRef.current
      const cur = messagesByModeRef.current[mode] || []
      const updated = { ...messagesByModeRef.current, [mode]: typeof updater === 'function' ? updater(cur) : updater }
      messagesByModeRef.current = updated
      setMessagesByMode(updated)
    },
    []
  )

  const [busyStatus, setBusyStatus] = useState<string | null>(() => mockExt?.initialBusyStatus || null)

  useEffect(() => {
    if (!isConfigured && !oauthToken && !apiKey) return
    let mounted = true
    listAvailableAntigravityModels(extensionSDK, { mode: authMode, oauthToken, clientId, projectId, apiKey }).then((list) => {
      if (mounted && list.length > 0) setAvailableModels(list)
    })
    return () => { mounted = false }
  }, [extensionSDK, isConfigured, authMode, oauthToken, clientId, projectId, apiKey])

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
        setMessages((prev) => [...prev, { role: 'error', text: 'Enter a Google Web OAuth 2.0 Client ID before saving.' }])
        return
      }
      setBusyStatus('Saving shared extension context...')
      await extensionSDK.saveContextData({
        authMode, clientId: clientId.trim(), projectId: projectId.trim(),
        disabledModes, defaultModel: selectedModel, defaultThinkingLevel, maxTotalTokens,
      })
      setIsConfigured(true)
      setBusyStatus(null)
      history.replace('/')
    } catch (err: unknown) {
      setBusyStatus(null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
    }
  }

  const handleCancelOAuthLogin = useCallback(() => {
    oauthAbortRef.current?.abort(); oauthAbortRef.current = null; setOauthSigningIn(false)
  }, [])

  const handleOAuthLogout = useCallback(() => {
    oauthAbortRef.current?.abort(); oauthAbortRef.current = null; oauthPendingRefreshRef.current = false
    setOauthSigningIn(false); clearStoredOAuthSession(extensionSDK); setOauthToken(''); setOauthExpiresAt(0)
  }, [extensionSDK])

  const handleOAuthLogin = useCallback(async () => {
    if (!clientId.trim()) {
      setMessages((prev) => [...prev, { role: 'error', text: 'Enter your Google Web OAuth 2.0 Client ID first.' }])
      return
    }
    oauthAbortRef.current?.abort()
    const controller = new AbortController()
    oauthAbortRef.current = controller
    setOauthSigningIn(true)
    try {
      const token = await loginWithGoogleOAuth(extensionSDK, clientId, {
        signal: controller.signal,
        focusReturnDelayMs: typeof mockExt?.oauthFocusReturnDelayMs === 'number' ? mockExt.oauthFocusReturnDelayMs : 1500,
      })
      if (oauthAbortRef.current === controller) {
        oauthPendingRefreshRef.current = false
        setOauthToken(token)
        const stored = await loadStoredOAuthSession(extensionSDK, clientId)
        setOauthExpiresAt(stored?.expiresAt || Date.now() + STUDIO_OAUTH_REFRESH_INTERVAL_MS)
      }
    } catch (err: unknown) {
      if (oauthAbortRef.current === controller && !controller.signal.aborted) {
        setMessages((prev) => [...prev, { role: 'error', text: `Google OAuth failed: ${getErrorMessage(err)}` }])
      }
    } finally {
      if (oauthAbortRef.current === controller) { oauthAbortRef.current = null; setOauthSigningIn(false) }
    }
  }, [clientId, extensionSDK, mockExt?.oauthFocusReturnDelayMs, setMessages])

  return {
    extensionSDK, core40SDK, lookerHostData, extHostData, history, location, isTileMount, mockExt,
    agentName, setAgentName, appInitializing, setAppInitializing,
    themeMode, resolvedTheme, setThemeMode,
    authMode, setAuthMode, clientId, setClientId, projectId, setProjectId,
    disabledModes, setDisabledModes, selectedModel, setSelectedModel,
    thinkingLevel, setThinkingLevel, defaultThinkingLevel, setDefaultThinkingLevel,
    maxTotalTokens, setMaxTotalTokens, availableModels, enabledModes,
    oauthToken, oauthAccessToken, setOauthToken, oauthExpiresAt, setOauthExpiresAt,
    triggerSilentOAuthRefresh, resetOAuthOnUnauthorized, apiKey, setApiKey,
    isAuthenticated, isConfigured, oauthSigningIn, oauthRedirectUri,
    handleSaveAuthSetup, handleOAuthLogin, handleOAuthLogout, handleCancelOAuthLogin,
    capabilities, setCapabilities, allowedUseCases, useCaseOptions,
    sidebarCollapsed, setSidebarCollapsed, leftPaneWidth, setLeftPaneWidth,
    rightPaneCollapsed, setRightPaneCollapsed, busySendAction, setBusySendAction,
    resolvedUseCaseByIdRef, parsedRoute, selectedUseCase, setSelectedUseCase, explicitUseCaseRef,
    sharedEnvironmentId, sharedEnvIdRef, syncSharedEnvironmentId,
    sessionsByMode, sessionsByModeRef, setSessionsByMode,
    messagesByMode, messagesByModeRef, activeModeRef, setAgentSession, setMessages,
    busyStatus, setBusyStatus,
  }
}

export type StudioAuthAndPrefs = ReturnType<typeof useStudioAuthAndPrefs>
