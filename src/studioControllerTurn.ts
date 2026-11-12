import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AgentSession, AntigravityActivityStep, AntigravityAuth,
  cleanLookmlProjectId, CodeModePermissionDecision, CodeModePermissionRequest,
  extractSkillNameFromPath, fetchConversationSandboxDebugMarkdown, fetchEnvironmentFile,
  hydrateInteractionActivitySteps, inFlightEnvProvisionByUser,
  isNewProjectOnboardingIntakePrompt, normalizeEnvironmentId, normalizeSandboxFilePath,
  PastedImage, prewarmOrWakeAntigravityEnvironment, resolveBuiltinWorkspaceFileContent,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import {
  buildDenseExploreSchema, copyTextWithExtensionSdk, discoverAccessibleConnections, EXPLICIT_SCRIPT_CREATION_RE,
  extractExploreIdsFromCode, extractResolvedUseCase, formatAccessibleConnectionsMarkdown,
  formatExploreId, formatStudioContentItemTitle, getArtifactNamespace, hydrateMentionedContext,
  isConversationalNoOpPrompt, matchExplicitUseCaseRule, parseExploreId,
  ResolvedStudioUseCase, saveDashboardStudioMetadata, saveNativeContentArtifact,
  saveUserArtifact, saveUserEnvironmentId, shouldRouteToIsolatedCaSubagent,
  StudioContentItemType, StudioContextMention, StudioUseCase,
  studioUseCaseToMode, toTurnCrudItem, TurnCrudItem, upsertPublishedDataApp,
} from './lookerApi'
import {
  extractLookmlDashboardsFromBundle,
  extractSlashSkillIds,
  LookmlBundle,
  mergeLookmlFiles,
  resolveLookmlCanonicalProjectId,
  saveLookmlSessionArtifact,
} from './lookmlTool'
import { getErrorMessage, StudioAuthAndPrefs } from './studioControllerAuth'
import { StudioLoaders } from './studioControllerLoaders'
import { StudioMetadata } from './studioControllerMetadata'

export interface QueuedPromptItem { id: string; text: string; images: PastedImage[]; mentions: StudioContextMention[] }
export type StudioEnvironmentStatus = 'active' | 'resetting' | 'stopped'

export function useStudioTurn(auth: StudioAuthAndPrefs, meta: StudioMetadata, loaders: StudioLoaders) {
  const {
    extensionSDK, core40SDK, history, location, isTileMount, mockExt,
    authMode, oauthToken, clientId, projectId, apiKey, selectedModel,
    thinkingLevel, maxTotalTokens, maxToolRounds, isAuthenticated, disabledModes,
    resolvedUseCaseByIdRef, parsedRoute, setSelectedUseCase, explicitUseCaseRef,
    allowedUseCases, setRightPaneCollapsed, triggerSilentOAuthRefresh, resetOAuthOnUnauthorized,
    sharedEnvIdRef, syncSharedEnvironmentId,
    agentSession, agentSessionRef, messages, messagesRef, activeModeRef, setAgentSession, setMessages,
    busyStatus, setBusyStatus,
  } = auth
  const {
    userId, userIdRef, setLookerWorkspaceId, syncLookerSessionWorkspace,
    availableLookmlProjects, canDeployLookml,
    selectedExplores, setSelectedExplores, mentionedItems, setMentionedItems,
    selectedFolderId, schemaMarkdown, setSchemaMarkdown,
    activeMode, isLookmlMode, isHealthCheckMode, builderMode,
    setActiveObjectId,
    conversations, setConversations,
  } = meta
  const {
    caConversation, isCaMode,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, setLookmlBundle, lastLookmlIdRef,
    publishedApp, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContent, lastNativeIdRef,
    contentItems, contentItemsRef, setContentItems, activeContentTabKeyRef, setActiveContentTabKey, upsertContentItem, setEmbedNonce,
    healthReport, scriptCode, setScriptCode, filtersJson,
    publishedTileDash, loadedScript,
    currentAppCode, setCurrentAppCode,
    activeViewerDocument, setActiveViewerDocument,
    prompt, setPrompt, pastedImages, setPastedImages,
    activeConversationId, activeConversationIdRef, setActiveConversationId,
    hydratedConvRouteRef, activityStepsByInteractionIdRef,
    persistConversationAndLabel,
    handleRunPython, handleSaveScript,
    handleRunHealthCheck, handleRunConversationalAnalytics,
  } = loaders

  const [sandboxMarkdownCache, setSandboxMarkdownCache] = useState<Record<string, string>>({})
  const sandboxMarkdownCacheRef = useRef<Record<string, string>>({})
  sandboxMarkdownCacheRef.current = sandboxMarkdownCache
  const inFlightSandboxFilesRef = useRef<Record<string, Promise<string> | undefined>>({})
  const [sandboxMarkdownLoading, setSandboxMarkdownLoading] = useState<Record<string, boolean>>({})
  const [activeSandboxMarkdownModalPath, setActiveSandboxMarkdownModalPath] = useState<string | null>(null)
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
      const next = typeof updater === 'function' ? updater(queuedPromptsRef.current) : updater
      queuedPromptsRef.current = next
      setQueuedPrompts(next)
    },
    []
  )

  const [liveActivitySteps, setLiveActivitySteps] = useState<AntigravityActivityStep[]>(() =>
    Array.isArray(mockExt?.initialLiveActivitySteps) ? (mockExt.initialLiveActivitySteps as AntigravityActivityStep[]) : []
  )
  const liveActivityStepsRef = useRef<AntigravityActivityStep[]>(liveActivitySteps)
  liveActivityStepsRef.current = liveActivitySteps
  const latestTurnInteractionRef = useRef<{ convId: string; id: string } | null>(null)
  const [copyThreadState, setCopyThreadState] = useState<'idle' | 'loading' | 'copied'>('idle')
  const [hydratingInteractionIds, setHydratingInteractionIds] = useState<Record<string, boolean>>({})
  const inFlightHydrationsRef = useRef<Record<string, Promise<AntigravityActivityStep[]> | undefined>>({})

  const localFileCtxRef = useRef({ lookmlBundle, currentAppCode, schemaMarkdown })
  localFileCtxRef.current = { lookmlBundle, currentAppCode, schemaMarkdown }

  const resolveLocalWorkspaceFile = useCallback((rawPath: string): string | undefined => {
    const raw = String(rawPath || '').trim()
    if (!raw) return undefined
    const builtin = resolveBuiltinWorkspaceFileContent(raw)
    if (typeof builtin === 'string') return builtin
    const norm = normalizeSandboxFilePath(raw)
    const base = norm.split('/').filter(Boolean).pop() || norm
    const relLkml = norm.replace(/^workspace\/(?:lookml\/)?/i, '')
    const ctx = localFileCtxRef.current
    const lkml = ctx.lookmlBundle?.files?.find(
      (f) => f.path === raw || normalizeSandboxFilePath(f.path) === norm || normalizeSandboxFilePath(f.path) === relLkml || f.path.endsWith(`/${base}`) || f.path === base
    )?.content
    if (lkml) return lkml
    if ((base === 'app.js' || norm.endsWith('/app.js')) && ctx.currentAppCode?.trim()) return ctx.currentAppCode
    if ((base === 'schema.md' || norm.endsWith('/schema.md')) && ctx.schemaMarkdown?.trim()) return ctx.schemaMarkdown
    return undefined
  }, [])

  const hydrateMessageActivitySteps = useCallback(
    (interactionId: string, stopAtInteractionId?: string): Promise<AntigravityActivityStep[]> => {
      const cleanId = String(interactionId || '').trim()
      if (!cleanId) return Promise.resolve([])
      const mem = activityStepsByInteractionIdRef.current[cleanId]
      if (Array.isArray(mem)) {
        setMessages((prev) => prev.map((m) => (m.role === 'assistant' && m.interactionId === cleanId && !Array.isArray(m.activitySteps) ? { ...m, activitySteps: mem } : m)))
        return Promise.resolve(mem)
      }
      const inFlight = inFlightHydrationsRef.current[cleanId]
      if (inFlight) return inFlight
      setHydratingInteractionIds((p) => ({ ...p, [cleanId]: true }))
      const p = hydrateInteractionActivitySteps({
        extensionSDK,
        auth: { mode: authMode, oauthToken, clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true) },
        interactionId: cleanId,
        stopAtInteractionId,
      })
        .then((steps) => {
          activityStepsByInteractionIdRef.current[cleanId] = steps
          setMessages((prev) => prev.map((m) => (m.role === 'assistant' && m.interactionId === cleanId ? { ...m, activitySteps: steps } : m)))
          return steps
        })
        .finally(() => {
          delete inFlightHydrationsRef.current[cleanId]
          setHydratingInteractionIds((prev) => ({ ...prev, [cleanId]: false }))
        })
      inFlightHydrationsRef.current[cleanId] = p
      return p
    },
    [activityStepsByInteractionIdRef, apiKey, authMode, clientId, extensionSDK, oauthToken, projectId, setMessages, triggerSilentOAuthRefresh]
  )

  const loadSandboxMarkdownFile = useCallback(
    (rawPath: string, opts?: { openModal?: boolean }): Promise<string> => {
      const normalizedPath = normalizeSandboxFilePath(rawPath)
      if (!normalizedPath) return Promise.resolve('')
      const displayPath = `/${normalizedPath}`
      if (opts?.openModal) setActiveSandboxMarkdownModalPath(displayPath)
      const activeEnv = agentSessionRef.current.environmentId
      const envId = normalizeEnvironmentId(sharedEnvIdRef.current) || normalizeEnvironmentId(activeEnv) || sharedEnvIdRef.current || activeEnv || 'mock_env_1'
      const cacheKey = `${envId}:${normalizedPath}`
      const storeCache = (val: string) => {
        const next = { ...sandboxMarkdownCacheRef.current, [cacheKey]: val, [normalizedPath]: val, [displayPath]: val }
        sandboxMarkdownCacheRef.current = next
        setSandboxMarkdownCache(next)
        return val
      }
      const localContent = resolveLocalWorkspaceFile(rawPath)
      if (typeof localContent === 'string' && localContent.length > 0) return Promise.resolve(storeCache(localContent))
      const cached = sandboxMarkdownCacheRef.current[cacheKey] ?? sandboxMarkdownCacheRef.current[normalizedPath] ?? sandboxMarkdownCacheRef.current[displayPath]
      if (typeof cached === 'string' && cached.length > 0 && !cached.startsWith('# Error Loading File\n')) return Promise.resolve(cached)
      const inFlight = inFlightSandboxFilesRef.current[cacheKey]
      if (inFlight) return inFlight
      const setLoading = (flag: boolean) => setSandboxMarkdownLoading((p) => ({ ...p, [cacheKey]: flag, [normalizedPath]: flag, [displayPath]: flag }))
      setLoading(true)
      const reqPromise = fetchEnvironmentFile({
        extensionSDK,
        auth: { mode: authMode, oauthToken, clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true) },
        environmentId: envId, path: normalizedPath,
      })
        .then(storeCache, (err: unknown) =>
          storeCache(`# Error Loading File\n\nUnable to load \`${displayPath}\` from sandbox environment \`${envId}\`: ${getErrorMessage(err)}`)
        )
        .finally(() => {
          delete inFlightSandboxFilesRef.current[cacheKey]
          setLoading(false)
        })
      inFlightSandboxFilesRef.current[cacheKey] = reqPromise
      return reqPromise
    },
    [agentSessionRef, apiKey, authMode, clientId, extensionSDK, oauthToken, projectId, resolveLocalWorkspaceFile, sharedEnvIdRef, triggerSilentOAuthRefresh]
  )

  const openViewerDocument = useCallback(
    (input: { path: string; title?: string; kind?: 'skill' | 'file'; content?: string; initialContent?: string }): Promise<string> => {
      const raw = String(input.path || '').trim()
      if (!raw) return Promise.resolve('')
      const skillName = extractSkillNameFromPath(raw)
      const resolvedRawPath = !raw.includes('/') && skillName ? `/workspace/skills/${skillName}/SKILL.md` : raw
      const normalizedPath = normalizeSandboxFilePath(resolvedRawPath)
      const displayPath = normalizedPath ? `/${normalizedPath}` : resolvedRawPath
      const kind: 'skill' | 'file' = input.kind === 'skill' ? 'skill' : input.kind === 'file' ? 'file' : skillName ? 'skill' : 'file'
      const isMarkdown = kind === 'skill' || /\.md$/i.test(displayPath)
      const title = input.title || (skillName ? `Reading skill ${skillName}` : displayPath.split('/').filter(Boolean).pop() || displayPath)
      const docBase = { path: normalizedPath || resolvedRawPath, displayPath, title, kind, isMarkdown }
      setRightPaneCollapsed(false)
      const cached = sandboxMarkdownCacheRef.current[normalizedPath] || sandboxMarkdownCacheRef.current[displayPath] || ''
      const immediate =
        resolveLocalWorkspaceFile(resolvedRawPath) ||
        (input.content || input.initialContent || '').trim() ||
        (!cached.startsWith('# Error Loading File\n') ? cached : '')
      if (immediate) {
        setActiveViewerDocument({ ...docBase, content: immediate, loading: false })
        return Promise.resolve(immediate)
      }
      setActiveViewerDocument({ ...docBase, content: '', loading: true })
      return loadSandboxMarkdownFile(resolvedRawPath).then((fetched) => {
        setActiveViewerDocument({ ...docBase, content: fetched, loading: false })
        return fetched
      })
    },
    [loadSandboxMarkdownFile, resolveLocalWorkspaceFile, setActiveViewerDocument, setRightPaneCollapsed]
  )

  const wakeContextRef = useRef({ agentSession, selectedExplores, schemaMarkdown, currentAppCode })
  wakeContextRef.current = { agentSession, selectedExplores, schemaMarkdown, currentAppCode }

  const handleWakeModeEnv = useCallback(
    async (modeToWake: StudioMode = activeModeRef.current, forceFresh = false) => {
      try {
        const ctx = wakeContextRef.current
        const existingSession: AgentSession = forceFresh ? { toolType: modeToWake } : ctx.agentSession
        const res = await prewarmOrWakeAntigravityEnvironment({
          sdk: core40SDK,
          userId: userIdRef.current || userId,
          extensionSDK,
          auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
          toolType: modeToWake,
          model: selectedModel,
          maxTotalTokens,
          environmentId: forceFresh ? undefined : sharedEnvIdRef.current || existingSession?.environmentId,
          existingSession,
          selectedExplores: ctx.selectedExplores,
          schemaMarkdown: ctx.schemaMarkdown,
          existingAppCode: modeToWake === 'app' ? ctx.currentAppCode : undefined,
          forceFresh,
          onEnvironmentUpdated: syncSharedEnvironmentId,
        })
        const nextEnvId = sharedEnvIdRef.current || res.session.environmentId
        const cur = agentSessionRef.current
        if (
          forceFresh ||
          cur.environmentId !== nextEnvId ||
          (!cur.lastInteractionId && res.session.lastInteractionId)
        ) {
          setAgentSession(
            {
              ...cur,
              ...res.session,
              lastInteractionId: forceFresh ? res.session.lastInteractionId : cur.lastInteractionId || res.session.lastInteractionId,
              environmentId: nextEnvId,
            },
            modeToWake
          )
        }
      } catch { /* ignore */ }
    },
    [activeModeRef, agentSessionRef, apiKey, authMode, clientId, core40SDK, extensionSDK, maxTotalTokens, oauthToken, projectId, selectedModel, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId, userId, userIdRef]
  )

  useEffect(() => {
    if (disabledModes.includes(activeMode)) return
    if (environmentStatus === 'stopped' || environmentStatus === 'resetting') return
    if (sharedEnvIdRef.current) return
    void handleWakeModeEnv(activeMode)
  }, [activeMode, disabledModes, environmentStatus, handleWakeModeEnv, sharedEnvIdRef])

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
        setMessages((prev) => [...prev, { role: 'assistant', text: reasonText, activitySteps: partialSteps }])
      }
      liveActivityStepsRef.current = []
      setLiveActivitySteps([])
    },
    [setMessages]
  )

  const handleStopTurn = useCallback(() => {
    abortActiveTurn('Stopped by user.')
    setBusyStatus(null)
  }, [abortActiveTurn, setBusyStatus])

  const handleQueuePrompt = useCallback(() => {
    if (!busyStatus) return
    const text = prompt.trim()
    if (!text && pastedImages.length === 0) return
    updateQueuedPrompts((prev) => [
      ...prev,
      {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text, images: pastedImages, mentions: mentionedItems,
      },
    ])
    setPrompt('')
    setPastedImages([])
    setMentionedItems([])
  }, [busyStatus, mentionedItems, pastedImages, prompt, setMentionedItems, setPastedImages, setPrompt, updateQueuedPrompts])

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
      syncSharedEnvironmentId('')
      setAgentSession({ toolType: activeModeRef.current, environmentId: '' })
      environmentStatusRef.current = nextStatus
      setEnvironmentStatus(nextStatus)
    },
    [activeModeRef, handleStopTurn, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId]
  )

  const handleResetEnvironment = useCallback((): Promise<void> => {
    if (envResetNoticeTimerRef.current) clearTimeout(envResetNoticeTimerRef.current)
    envResetNoticeTimerRef.current = null
    setEnvResetNotice(false)
    clearAllEnvSessions('resetting')
    sharedEnvExploreSchemas.clear()
    inFlightEnvProvisionByUser.clear()
    const finish = () => {
      environmentStatusRef.current = 'active'
      setEnvironmentStatus('active')
      setEnvResetNotice(true)
      envResetNoticeTimerRef.current = setTimeout(() => {
        setEnvResetNotice(false)
        envResetNoticeTimerRef.current = null
      }, 2500)
    }
    return saveUserEnvironmentId(core40SDK, userIdRef.current || userId, '', getArtifactNamespace(extensionSDK))
      .catch(() => {})
      .then(() => handleWakeModeEnv(activeModeRef.current, true))
      .then(finish, (err) => { finish(); throw err })
  }, [activeModeRef, clearAllEnvSessions, core40SDK, extensionSDK, handleWakeModeEnv, userId, userIdRef])

  const handleStopEnvironment = useCallback(() => {
    if (envResetNoticeTimerRef.current) clearTimeout(envResetNoticeTimerRef.current)
    envResetNoticeTimerRef.current = null
    setEnvResetNotice(false)
    clearAllEnvSessions('stopped')
  }, [clearAllEnvSessions])

  const handleSendPrompt = async (
    overrideItem?:
      | { text: string; images?: PastedImage[]; mentions?: StudioContextMention[]; bypassBusy?: boolean }
      | React.SyntheticEvent
  ) => {
    const isOverride =
      Boolean(overrideItem) && typeof overrideItem === 'object' &&
      !('nativeEvent' in (overrideItem as object)) &&
      typeof (overrideItem as { text?: unknown }).text === 'string'
    const typedOverride = isOverride
      ? (overrideItem as { text: string; images?: PastedImage[]; mentions?: StudioContextMention[]; bypassBusy?: boolean })
      : undefined
    const text = typedOverride ? typedOverride.text.trim() : prompt.trim()
    const attachedImages = typedOverride ? typedOverride.images || [] : pastedImages
    const activeMentions = typedOverride ? typedOverride.mentions || [] : mentionedItems
    if (!isAuthenticated || (!text && attachedImages.length === 0) || (busyStatus && !typedOverride?.bypassBusy)) return
    if (environmentStatusRef.current === 'stopped') {
      environmentStatusRef.current = 'active'
      setEnvironmentStatus('active')
    }
    const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const effectivePrompt = text || 'See the attached screenshot.'
    const currentMessages = messagesRef.current
    const isFirstTurn = currentMessages.filter((m) => m.role === 'user').length === 0
    const userMsg: ChatMessage = {
      role: 'user', text: effectivePrompt, images: attachedImages.map((img) => img.dataUrl),
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

    const hasSavedRouteConv = Boolean(
      parsedRoute.conversationId && conversations.some((c) => c.id === parsedRoute.conversationId)
    )
    const convId =
      isFirstTurn && !hasSavedRouteConv && (!parsedRoute.conversationId || location.pathname === '/')
        ? `conv_${Date.now()}`
        : activeConversationIdRef.current || parsedRoute.conversationId || `conv_${Date.now()}`

    setActiveConversationId(convId)
    const targetConvRoute = `/c/${encodeURIComponent(convId)}`
    if (location.pathname !== targetConvRoute) history.replace(targetConvRoute)
    if (isFirstTurn && !conversations.some((c) => c.id === convId)) {
      const nowIso = new Date().toISOString()
      const optimisticEntry = {
        id: convId,
        type: turnTargetUseCase !== 'auto' ? turnTargetUseCase : allowedUseCases[0] || 'app',
        use_case: turnTargetUseCase,
        label: sanitizeConversationLabel('', effectivePrompt),
        explores: selectedExplores,
        messages: [{ role: 'user' as const, text: effectivePrompt }],
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      setConversations((prev) => [optimisticEntry, ...prev.filter((c) => c.id !== convId)], {
        optimisticEntry,
      })
    }

    const caRouteBase = { prompt: effectivePrompt, explicitUseCase, isCaMode, isFirstTurn, allowedModes: allowedUseCases }
    if (!isConversationalNoOpPrompt(effectivePrompt) && (turnTargetUseCase === 'health-check' || (explicitUseCase !== 'auto' && isHealthCheckMode))) {
      setSelectedUseCase('health-check')
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages, convId)
      return
    }

    if (shouldRouteToIsolatedCaSubagent(caRouteBase)) {
      setSelectedUseCase('conversational-analytics')
      await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, undefined, convId)
      return
    }

    const currentSession = agentSessionRef.current

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
        activeMentions.forEach((m) => {
          if (m.type === 'explore' || m.type === 'dashboard' || m.type === 'look') {
            const ct: StudioContentItemType = m.type === 'explore' ? 'explore' : m.type === 'look' ? 'look' : m.id.includes('::') ? 'lookml_dashboard' : 'dashboard'
            upsertContentItem({
              id: m.id, contentType: ct, title: m.title, source: 'mention', createdInConversation: false,
              ...(ct === 'explore' ? { exploreId: m.id } : {}), ...(ct === 'look' ? { lookId: m.id } : {}),
              ...(ct === 'dashboard' ? { dashboardId: m.id } : {}), ...(ct === 'lookml_dashboard' ? { lookmlDashboardId: m.id } : {}),
            })
          }
        })
        setBusyStatus('Hydrating referenced Looker @-mention context...')
        const hydrated = await hydrateMentionedContext({
          sdk: core40SDK, mentions: activeMentions, conversations, selectedExplores, useCase: turnTargetUseCase,
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
        if (hydrated.extraSources.length > 0) turnExtraSources = hydrated.extraSources
        if (hydrated.promptSummary) turnPromptWithContext = `${effectivePrompt}\n\n${hydrated.promptSummary}`
      }

      const promptSlashSkills = extractSlashSkillIds(effectivePrompt)
      const turnActivatedSkills = Array.from(new Set([...activatedLookmlSkills, ...promptSlashSkills]))
      if (promptSlashSkills.length > 0) setActivatedLookmlSkills(turnActivatedSkills)
      const effectiveLookmlTurn = turnTargetUseCase === 'lookml' || (turnTargetUseCase === 'auto' && isLookmlMode)
      const availableConnections =
        effectiveLookmlTurn && !lookmlProjectId?.trim() && isNewProjectOnboardingIntakePrompt(effectivePrompt, currentMessages)
          ? formatAccessibleConnectionsMarkdown(await discoverAccessibleConnections(core40SDK))
          : undefined
      const effectiveBuilderMode: 'data_app' | 'dashboard' =
        turnTargetUseCase === 'dashboard'
          ? 'dashboard'
          : turnTargetUseCase === 'app' || turnTargetUseCase === 'data-investigator'
          ? 'data_app'
          : builderMode
      const result = await runAntigravityTurn({
        sdk: core40SDK, extensionSDK, userId,
        environmentId: sharedEnvIdRef.current || currentSession.environmentId,
        conversationId: convId, onEnvironmentUpdated: syncSharedEnvironmentId,
        auth: authCfg, session: currentSession,
        model: selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds,
        mode: effectiveBuilderMode, useCase: explicitUseCase, allowedModes: allowedUseCases,
        selectedExplores: turnExplores, folderId: selectedFolderId,
        toolMode: effectiveLookmlTurn ? 'lookml' : 'data_app',
        lookmlProjectId, activatedLookmlSkills: turnActivatedSkills, developableProjects: availableLookmlProjects,
        canDeploy: canDeployLookml, availableConnections, warmEnvironmentInBackground: true,
        schemaMarkdown: turnSchemaMarkdown,
        userPrompt:
          explicitUseCase === 'tile' || loadedScript || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
            ? `Write a LkrCodeMode Python script for the user's request. Return the Python snippet inside a \`\`\`python code block.\n\nCurrent script:\n\`\`\`python\n${scriptCode}\n\`\`\`\n\nUser request: ${turnPromptWithContext}`
            : turnPromptWithContext,
        images: attachedImages, existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent, extraSources: turnExtraSources,
        priorMessages: currentMessages, requirePermission,
        approvedOperations: approvedOpsRef.current, onPermissionRequest: requestCodeModePermission,
        onProgressSteps: (steps) => {
          liveActivityStepsRef.current = steps
          setLiveActivitySteps(steps)
        },
        onInteractionCreated: (id) => {
          latestTurnInteractionRef.current = { convId, id }
        },
        signal: abortController.signal, onStatus: setBusyStatus,
      })

      const resolvedUseCase: ResolvedStudioUseCase =
        explicitUseCase !== 'auto'
          ? explicitUseCase
          : result.resolvedUseCase || extractResolvedUseCase(result.assistantText, effectivePrompt, allowedUseCases)
      resolvedUseCaseByIdRef.current[convId] = resolvedUseCase
      setSelectedUseCase(resolvedUseCase)
      if (shouldRouteToIsolatedCaSubagent({ ...caRouteBase, assistantOutput: result.rawOutputText ?? result.assistantText })) {
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, result.rawOutputText ?? result.assistantText, convId)
        return
      }
      const resolvedMode: StudioMode = studioUseCaseToMode(resolvedUseCase)

      let convType: string = resolvedUseCase
      let convTitle = ''
      let convExplores = turnExplores
      let convContent: Record<string, unknown> | undefined
      let finalMsgs: ChatMessage[] = []
      const turnCrudItems: TurnCrudItem[] = []
      const deletedIds = new Set<string>()
      const recordCrudItem = (item: TurnCrudItem) => {
        const idx = turnCrudItems.findIndex((x) => x.key === item.key)
        if (idx >= 0) turnCrudItems[idx] = item
        else turnCrudItems.push(item)
      }
      const deletedRe = /^DELETE\s+\/(?:api\/4\.0\/)?(dashboards|looks|boards)\/([^/?#\s)]+)\s+\(\d+ms\)$/gim
      ;(result.activitySteps || []).forEach((st) => {
        if (st.kind !== 'codemode') return
        ;(st.content || '').replace(deletedRe, (_s, rawKind: string, rawId: string) => {
          const kind = rawKind.toLowerCase()
          let delId = rawId
          try { delId = decodeURIComponent(rawId) } catch { /* ignore */ }
          deletedIds.add(delId)
          const fbType: StudioContentItemType = kind === 'looks' ? 'look' : kind === 'boards' ? 'board' : delId.includes('::') ? 'lookml_dashboard' : 'dashboard'
          const hit = contentItemsRef.current.find(
            (it) => it.id === delId && (kind === 'looks' ? it.contentType === 'look' : kind === 'boards' ? it.contentType === 'board' : ['dashboard', 'lookml_dashboard', 'data_app', 'data-investigator'].includes(it.contentType))
          )
          if (hit) {
            setContentItems((prev) => prev.filter((it) => it.key !== hit.key))
            if (activeContentTabKeyRef.current === hit.key) setActiveContentTabKey(contentItemsRef.current.filter((it) => !it.hidden).slice(-1)[0]?.key || '')
          }
          if (nativeContent?.id === delId) setNativeContent(null)
          if (publishedApp?.dashboardId === delId) { setPublishedApp(null); setCurrentAppCode('') }
          const ct = hit ? hit.contentType : fbType
          recordCrudItem(toTurnCrudItem(hit || { key: `${ct}:${delId}`, id: delId, title: formatStudioContentItemTitle(ct, delId), contentType: ct }, 'deleted'))
          return ''
        })
      })

      if (resolvedUseCase === 'tile' && !result.lookmlBundle && !result.nativeBundle && !result.bundle) {
        const isExplicitScriptRequest =
          explicitUseCase === 'tile' || loadedScript || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
        const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
        const extractedPy = pyMatch ? pyMatch[1].trim() : ''
        const baseReply = result.assistantText || (isExplicitScriptRequest ? 'Updated script and executed Looker queries.' : 'Executed Looker API calls.')
        const replyText =
          !isExplicitScriptRequest && !/\b(?:save|reusable|turn\s+(?:this|it)\s+into)\b[\s\S]{0,60}\b(?:script|tile)\b/i.test(baseReply)
            ? `${baseReply}\n\nWould you like me to save this Looker API lookup as a reusable **Script**?`
            : baseReply
        setAgentSession({ ...result.session, conversationId: convId, explores: turnExplores }, 'tile')
        if (isExplicitScriptRequest && (extractedPy || explicitUseCase === 'tile' || loadedScript)) {
          const nextCode = extractedPy || scriptCode
          const prevKeys = new Set(contentItemsRef.current.map((it) => it.key))
          if (extractedPy) setScriptCode(extractedPy)
          await handleRunPython(nextCode, filtersJson)
          try {
            const saved = await handleSaveScript(nextCode, messagesWithUser, publishedTileDash)
            const existedScript = prevKeys.has(`script:${saved.id}`)
            convType = 'tile'
            convTitle = saved.title
            convContent = { scriptId: saved.id, dashboardId: saved.dashboardId, elementId: saved.elementId }
            setActiveObjectId(saved.id)
            const sItem = contentItemsRef.current.find((it) => it.key === `script:${saved.id}`)
            if (sItem) recordCrudItem(toTurnCrudItem(sItem, existedScript ? 'updated' : 'created'))
          } catch { /* ignore */ }
        }
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant', text: replyText,
            interactionId: result.session.lastInteractionId,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
            ...(turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : {}),
          },
        ]
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
        const effectiveExplores = turnExplores.length > 0 ? turnExplores : bundleExplores
        convExplores = effectiveExplores
        if (turnExplores.length === 0 && bundleExplores.length > 0) setSelectedExplores(bundleExplores)

        const studioMeta = {
          explores: effectiveExplores,
          lastInteractionId: result.session.lastInteractionId,
          environmentId: result.session.environmentId,
        }
        let handledArtifact = false
        let finalDashId: string | undefined
        let finalWidgetCount: number | undefined

        if (result.lookmlBundle) {
          const canonProj = resolveLookmlCanonicalProjectId(result.lookmlBundle) || cleanLookmlProjectId(lookmlProjectId)
          if (canonProj) {
            handledArtifact = true
            setLookerWorkspaceId('dev')
            void syncLookerSessionWorkspace()
            setBusyStatus('Saving LookML project changes...')
            const prevFiles =
              lookmlBundle && resolveLookmlCanonicalProjectId(lookmlBundle) === canonProj
                ? lookmlBundle.files
                : []
            let mergedBundle: LookmlBundle = Object.assign({}, result.lookmlBundle, {
              id: canonProj,
              project_id: cleanLookmlProjectId(result.lookmlBundle.project_id) || canonProj,
              files: mergeLookmlFiles(prevFiles, result.lookmlBundle.files),
            })
            try {
              const saved = await saveLookmlSessionArtifact({ sdk: core40SDK, extensionSDK, userId, bundle: mergedBundle, studio: studioMeta })
              mergedBundle = saved.payload.bundle
            } catch { /* ignore */ }
            const lookmlId = cleanLookmlProjectId(mergedBundle.project_id) || canonProj
            setLookmlBundle(mergedBundle)
            setLookmlProjectId(lookmlId)
            const isExistingLookml = contentItemsRef.current.some(
              (it) => it.contentType === 'lookml' && (it.projectId || it.id) === lookmlId
            )
            const upLookml = upsertContentItem({
              id: lookmlId, sessionId: lookmlId, projectId: lookmlId,
              contentType: 'lookml', title: `LookML: ${lookmlId}`,
              embedPath: `/lookml/${encodeURIComponent(lookmlId)}`, updatedAt: new Date().toISOString(),
              source: isExistingLookml ? 'modified' : 'created', createdInConversation: true, hidden: false,
            })
            recordCrudItem(toTurnCrudItem(upLookml, upLookml.existed ? 'updated' : 'created'))
            resolvedUseCaseByIdRef.current[lookmlId] = 'lookml'
            convType = 'lookml'
            convTitle = result.lookmlBundle.title || `LookML: ${lookmlId}`
            convContent = { sessionId: lookmlId, projectId: lookmlId, model: mergedBundle.model_name, branch: mergedBundle.branch_name }
            lastLookmlIdRef.current = lookmlId
            setActiveObjectId(lookmlId)

            extractLookmlDashboardsFromBundle(
              Object.assign({}, result.lookmlBundle, {
                model_name: result.lookmlBundle.model_name || mergedBundle.model_name,
                project_id: lookmlId,
              })
            ).forEach((d) => {
              if (result.nativeBundle && (result.nativeBundle.id === d.id || result.nativeBundle.lookml_dashboard_id === d.id)) return
              const isExistingDash = contentItemsRef.current.some((it) => it.key === `lookml_dashboard:${d.id}`)
              setNativeContent(
                {
                  id: d.id, contentType: 'lookml_dashboard', title: d.title,
                  folderId: selectedFolderId, embedPath: d.embedPath,
                  lookmlDashboardId: d.id, projectId: lookmlId, model: d.model,
                },
                { source: isExistingDash ? 'modified' : 'created', createdInConversation: true, hidden: false }
              )
              recordCrudItem(toTurnCrudItem({ key: `lookml_dashboard:${d.id}`, id: d.id, title: d.title, contentType: 'lookml_dashboard', embedPath: d.embedPath }, isExistingDash ? 'updated' : 'created'))
              setEmbedNonce((n) => n + 1)
              finalDashId = d.id
            })
          }
        }

        if (result.nativeBundle) {
          handledArtifact = true
          setBusyStatus('Indexing native Looker content in user catalog...')
          const reqCt = (result.nativeBundle.contentType || 'dashboard') as StudioContentItemType
          const isExistingNative = contentItemsRef.current.some(
            (it) => it.id === String(result.nativeBundle!.id) && (it.contentType === reqCt || (['dashboard', 'lookml_dashboard'].includes(it.contentType) && ['dashboard', 'lookml_dashboard'].includes(reqCt)))
          )
          const savedNative = await saveNativeContentArtifact(core40SDK, extensionSDK, userId, result.nativeBundle, selectedFolderId, nativeContent, studioMeta)
          lastNativeIdRef.current = savedNative.id
          resolvedUseCaseByIdRef.current[savedNative.id] = 'dashboard'
          setNativeContent(savedNative, { source: isExistingNative ? 'modified' : 'created', createdInConversation: true, hidden: false })
          const nativeCt = (savedNative.contentType || 'dashboard') as StudioContentItemType
          recordCrudItem(toTurnCrudItem({ key: `${nativeCt}:${savedNative.id}`, id: String(savedNative.id), title: savedNative.title, contentType: nativeCt, embedPath: savedNative.embedPath }, isExistingNative ? 'updated' : 'created'))
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(savedNative.id)
          finalDashId = savedNative.id
          finalWidgetCount = result.nativeBundle.tile_count
          convType = 'dashboard'
          convTitle = savedNative.title
          convContent = Object.assign({}, convContent, {
            dashboardId: savedNative.id, contentType: savedNative.contentType,
            embedPath: savedNative.embedPath, lookId: savedNative.lookId, lookmlDashboardId: savedNative.lookmlDashboardId,
          })
        }

        if (result.bundle) {
          handledArtifact = true
          setBusyStatus('Publishing inline extension & updating Looker dashboard...')
          const upserted = await upsertPublishedDataApp(core40SDK, result.bundle, selectedFolderId, publishedApp, studioMeta)
          const appUseCaseType: ResolvedStudioUseCase = resolvedUseCase === 'data-investigator' ? 'data-investigator' : 'app'
          const appCt: StudioContentItemType = appUseCaseType === 'data-investigator' ? 'data-investigator' : 'data_app'
          const isExistingApp = contentItemsRef.current.some(
            (it) => (it.contentType === 'data_app' || it.contentType === 'data-investigator') && it.id === String(upserted.dashboardId)
          )
          lastPublishedIdRef.current = upserted.dashboardId
          resolvedUseCaseByIdRef.current[upserted.dashboardId] = appUseCaseType
          setPublishedApp(upserted, { source: isExistingApp ? 'modified' : 'created', createdInConversation: true, hidden: false })
          const appItem = contentItemsRef.current.find((it) => it.key === `${appCt}:${upserted.dashboardId}`)
          if (appItem) recordCrudItem(toTurnCrudItem(appItem, isExistingApp ? 'updated' : 'created'))
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(upserted.dashboardId)
          setCurrentAppCode(result.bundle.raw_code)
          finalDashId = upserted.dashboardId
          finalWidgetCount = result.bundle?.widgets?.length || 0
          const appEntryBase = {
            id: upserted.dashboardId, type: appUseCaseType, title: upserted.title,
            explores: effectiveExplores, updatedAt: new Date().toISOString(), createdBy: userId,
          }
          try {
            await saveUserArtifact(
              core40SDK, userId, appEntryBase,
              Object.assign({}, appEntryBase, { dashboardId: upserted.dashboardId, extensionId: upserted.extensionId }),
              getArtifactNamespace(extensionSDK)
            )
          } catch { /* ignore */ }
          convType = appUseCaseType
          convTitle = upserted.title
          convContent = Object.assign({}, convContent, {
            dashboardId: upserted.dashboardId, appArtifactId: `obj_app_${upserted.dashboardId}`, extensionId: upserted.extensionId,
          })
        }

        if (!handledArtifact && deletedIds.size === 0) {
          if (explicitUseCase === 'auto' && resolvedMode !== activeMode && resolvedUseCase === 'health-check') {
            await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages, convId)
            return
          }
          if (effectiveBuilderMode === 'dashboard' && nativeContent) {
            const updatedNative = await saveNativeContentArtifact(
              core40SDK, extensionSDK, userId,
              { id: nativeContent.id, title: nativeContent.title, explores: effectiveExplores },
              selectedFolderId, nativeContent, studioMeta
            )
            setNativeContent(updatedNative, { source: 'modified', hidden: false })
            convType = 'dashboard'
            convContent = { dashboardId: updatedNative.id, contentType: updatedNative.contentType, embedPath: updatedNative.embedPath }
          } else if (publishedApp) {
            setPublishedApp(await saveDashboardStudioMetadata(core40SDK, publishedApp, studioMeta), { source: 'modified', hidden: false })
            convType = 'app'
            convContent = { dashboardId: publishedApp.dashboardId, appArtifactId: `obj_app_${publishedApp.dashboardId}` }
          }
        }

        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant',
            text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            ...(finalDashId ? { dashboardId: finalDashId } : {}),
            ...(finalWidgetCount !== undefined ? { widgetCount: finalWidgetCount } : {}),
            ...(turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : {}),
            activitySteps: result.activitySteps,
            thinkingDurationSec: result.thinkingDurationSec,
          },
        ]
        setAgentSession(
          { ...result.session, conversationId: convId, explores: effectiveExplores },
          result.lookmlBundle && !result.nativeBundle && !result.bundle ? 'lookml' : resolvedMode
        )
        setMessages(finalMsgs)
      }

      if (result.session.lastInteractionId && result.activitySteps?.length) {
        activityStepsByInteractionIdRef.current[result.session.lastInteractionId] = result.activitySteps
      }
      setActiveConversationId(convId)
      const nextConvRoute = `/c/${encodeURIComponent(convId)}`
      hydratedConvRouteRef.current = `${nextConvRoute}:${convId}`
      if (location.pathname !== nextConvRoute) history.replace(nextConvRoute)

      void persistConversationAndLabel({
        id: convId, type: convType, interactionId: result.session.lastInteractionId,
        environmentId: result.session.environmentId,
        label: isFirstTurn ? convTitle || sanitizeConversationLabel('', effectivePrompt) : undefined,
        explores: convExplores, content: convContent, messages: finalMsgs,
        isFirstTurn, userPrompt: effectivePrompt, assistantText: result.assistantText,
        updateArtifactIndex: Boolean(convContent),
      })
    } catch (err: unknown) {
      if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
      const msg = resetOAuthOnUnauthorized(err)
      setMessages((prev) => [...prev, { role: 'error', text: msg }])
    } finally {
      if (!abortController.signal.aborted) {
        if (turnAbortControllerRef.current === abortController) turnAbortControllerRef.current = null
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
            text: nextQueued.text, images: nextQueued.images, mentions: nextQueued.mentions, bypassBusy: true,
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
      const queuedItem = targetId ? queuedPromptsRef.current.find((q) => q.id === targetId) : undefined
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
        text: textToSend, images: imagesToSend, mentions: mentionsToSend, bypassBusy: true,
      })
    },
    [abortActiveTurn, isAuthenticated, mentionedItems, pastedImages, prompt, setMentionedItems, setPastedImages, setPrompt, updateQueuedPrompts]
  )

  const handleCopyThreadDebugTrace = useCallback(() => {
    setCopyThreadState('loading')
    const activeConv = conversations.find((c) => c.id === activeConversationId)
    const trackedTurn = latestTurnInteractionRef.current
    const latestTurnId =
      (trackedTurn && (!activeConversationId || trackedTurn.convId === activeConversationId) ? trackedTurn.id : '') ||
      messages.slice().reverse().find((m) => m.interactionId)?.interactionId ||
      activeConv?.interactionId || agentSession?.lastInteractionId || ''
    const envId = normalizeEnvironmentId(sharedEnvIdRef.current) || normalizeEnvironmentId(activeConv?.environmentId) || normalizeEnvironmentId(agentSession?.environmentId) || ''
    return fetchConversationSandboxDebugMarkdown({
      extensionSDK, auth: { mode: authMode, oauthToken, clientId, projectId, apiKey, onUnauthorizedRefresh: triggerSilentOAuthRefresh },
      conversationId: activeConversationId || activeConv?.id, label: activeConv?.label,
      useCase: activeConv?.use_case || auth.selectedUseCase, model: selectedModel, thinkingLevel,
      environmentId: envId, lastInteractionId: latestTurnId, messages,
      liveActivitySteps: liveActivitySteps.length ? liveActivitySteps : liveActivityStepsRef.current, busyStatus, contentItems,
    }).then(
      (md) => {
        if (typeof window !== 'undefined') window.__LAST_COPIED_THINKING_TRACE__ = md
        return copyTextWithExtensionSdk(md, extensionSDK).then(() => {
          setCopyThreadState('copied')
          setTimeout(() => setCopyThreadState((curr) => (curr === 'copied' ? 'idle' : curr)), 1800)
        })
      },
      () => setCopyThreadState('idle')
    )
  }, [
    activeConversationId, agentSession, apiKey, auth.selectedUseCase, authMode, busyStatus, clientId,
    contentItems, conversations, extensionSDK, liveActivitySteps, messages, oauthToken, projectId, selectedModel,
    sharedEnvIdRef, thinkingLevel, triggerSilentOAuthRefresh,
  ])

  const isEmptyConversation =
    !isTileMount && location.pathname !== '/config' &&
    !parsedRoute.objectId && messages.length === 0 && !publishedApp && !nativeContent &&
    contentItems.length === 0 &&
    !lookmlBundle && !healthReport && !caConversation && !loadedScript && !busyStatus &&
    liveActivitySteps.length === 0

  return {
    environmentStatus, setEnvironmentStatus, envResetNotice, setEnvResetNotice,
    handleResetEnvironment, handleStopEnvironment, handleWakeModeEnv,
    liveActivitySteps, setLiveActivitySteps,
    hydratingInteractionIds, hydrateMessageActivitySteps,
    copyThreadState, handleCopyThreadDebugTrace,
    queuedPrompts, updateQueuedPrompts,
    handleStopTurn, handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt,
    requirePermission, setRequirePermission, pendingPerm, requestCodeModePermission, resolvePermDecision,
    handleSendPrompt,
    isEmptyConversation,
    sandboxMarkdownCache, sandboxMarkdownLoading, activeSandboxMarkdownModalPath,
    setActiveSandboxMarkdownModalPath, loadSandboxMarkdownFile,
    activeViewerDocument, setActiveViewerDocument, openViewerDocument,
  }
}

export type StudioTurn = ReturnType<typeof useStudioTurn>
