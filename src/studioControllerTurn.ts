import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AgentSession, AntigravityActivityStep, AntigravityAuth,
  CodeModePermissionDecision, CodeModePermissionRequest,
  extractSkillNameFromPath, fetchConversationSandboxDebugMarkdown, fetchEnvironmentFile, inFlightEnvProvisionByUser,
  isNewProjectOnboardingIntakePrompt, normalizeEnvironmentId, normalizeSandboxFilePath,
  PastedImage, prewarmOrWakeAntigravityEnvironment, resolveBuiltinWorkspaceFileContent,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import {
  buildDenseExploreSchema, copyTextWithExtensionSdk, discoverAccessibleConnections, EXPLICIT_SCRIPT_CREATION_RE,
  extractExploreIdsFromCode, extractResolvedUseCase, formatAccessibleConnectionsMarkdown,
  formatExploreId, getArtifactNamespace, hydrateMentionedContext,
  isConversationalNoOpPrompt, matchExplicitUseCaseRule, parseExploreId,
  ResolvedStudioUseCase, saveDashboardStudioMetadata, saveNativeContentArtifact,
  saveUserArtifact, saveUserEnvironmentId, shouldRouteToIsolatedCaSubagent,
  StudioContentItemType, StudioContextMention, StudioUseCase,
  studioUseCaseToMode, upsertPublishedDataApp,
} from './lookerApi'
import { extractSlashSkillIds, saveLookmlSessionArtifact } from './lookmlTool'
import { getErrorMessage, StudioAuthAndPrefs } from './studioControllerAuth'
import { StudioLoaders } from './studioControllerLoaders'
import { StudioMetadata } from './studioControllerMetadata'

export interface QueuedPromptItem { id: string; text: string; images: PastedImage[]; mentions: StudioContextMention[] }
export type StudioEnvironmentStatus = 'active' | 'resetting' | 'stopped'

export function useStudioTurn(auth: StudioAuthAndPrefs, meta: StudioMetadata, loaders: StudioLoaders) {
  const {
    extensionSDK, core40SDK, history, location, isTileMount, mockExt,
    authMode, oauthToken, clientId, projectId, apiKey, selectedModel,
    thinkingLevel, maxTotalTokens, isAuthenticated, disabledModes,
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
    contentItems, contentItemsRef, upsertContentItem, setEmbedNonce,
    healthReport, scriptCode, setScriptCode, filtersJson,
    publishedTileDash, loadedScript,
    currentAppCode, setCurrentAppCode,
    activeViewerDocument, setActiveViewerDocument,
    prompt, setPrompt, pastedImages, setPastedImages,
    activeConversationId, activeConversationIdRef, setActiveConversationId,
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

  const loadSandboxMarkdownFile = useCallback(
    async (rawPath: string, opts?: { openModal?: boolean }): Promise<string> => {
      const normalizedPath = normalizeSandboxFilePath(rawPath)
      if (!normalizedPath) return ''
      const displayPath = `/${normalizedPath}`
      if (opts?.openModal) setActiveSandboxMarkdownModalPath(displayPath)
      const activeEnv = agentSessionRef.current.environmentId
      const envId = normalizeEnvironmentId(sharedEnvIdRef.current) || normalizeEnvironmentId(activeEnv) || sharedEnvIdRef.current || activeEnv || 'mock_env_1'
      const cacheKey = `${envId}:${normalizedPath}`
      const cached = sandboxMarkdownCacheRef.current[cacheKey] ?? sandboxMarkdownCacheRef.current[normalizedPath] ?? sandboxMarkdownCacheRef.current[displayPath]
      if (typeof cached === 'string' && cached.length > 0) return cached
      const inFlight = inFlightSandboxFilesRef.current[cacheKey]
      if (inFlight) return inFlight
      const setLoading = (flag: boolean) => setSandboxMarkdownLoading((p) => ({ ...p, [cacheKey]: flag, [normalizedPath]: flag, [displayPath]: flag }))
      const storeCache = (val: string) => {
        const next = { ...sandboxMarkdownCacheRef.current, [cacheKey]: val, [normalizedPath]: val, [displayPath]: val }
        sandboxMarkdownCacheRef.current = next
        setSandboxMarkdownCache(next)
        return val
      }
      setLoading(true)
      const reqPromise = (async () => {
        try {
          const content = await fetchEnvironmentFile({
            extensionSDK,
            auth: { mode: authMode, oauthToken, clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true) },
            environmentId: envId, path: normalizedPath,
          })
          return storeCache(content)
        } catch (err: unknown) {
          return storeCache(`# Error Loading File\n\nUnable to load \`${displayPath}\` from sandbox environment \`${envId}\`: ${getErrorMessage(err)}`)
        } finally {
          delete inFlightSandboxFilesRef.current[cacheKey]
          setLoading(false)
        }
      })()
      inFlightSandboxFilesRef.current[cacheKey] = reqPromise
      return reqPromise
    },
    [agentSessionRef, apiKey, authMode, clientId, extensionSDK, oauthToken, projectId, sharedEnvIdRef, triggerSilentOAuthRefresh]
  )

  const openViewerDocument = useCallback(
    async (input: { path: string; title?: string; kind?: 'skill' | 'file'; content?: string }): Promise<string> => {
      const raw = String(input.path || '').trim()
      if (!raw) return ''
      const skillName = extractSkillNameFromPath(raw)
      const resolvedRawPath = !raw.includes('/') && skillName ? `/workspace/skills/${skillName}/SKILL.md` : raw
      const normalizedPath = normalizeSandboxFilePath(resolvedRawPath)
      const displayPath = normalizedPath ? `/${normalizedPath}` : resolvedRawPath
      const kind: 'skill' | 'file' = input.kind || (skillName ? 'skill' : 'file')
      const isMarkdown = kind === 'skill' || /\.md$/i.test(displayPath)
      const title = input.title || (skillName ? `Reading skill ${skillName}` : displayPath.split('/').filter(Boolean).pop() || displayPath)
      const initialContent =
        (typeof input.content === 'string' && input.content.trim()) ||
        sandboxMarkdownCacheRef.current[normalizedPath] ||
        sandboxMarkdownCacheRef.current[displayPath] ||
        resolveBuiltinWorkspaceFileContent(resolvedRawPath) ||
        resolveBuiltinWorkspaceFileContent(displayPath) ||
        ''
      const docBase = { path: normalizedPath || resolvedRawPath, displayPath, title, kind, isMarkdown }
      setRightPaneCollapsed(false)
      setActiveViewerDocument({ ...docBase, content: initialContent, loading: !initialContent })
      const finalContent = (await loadSandboxMarkdownFile(resolvedRawPath)) || initialContent
      setActiveViewerDocument({ ...docBase, content: finalContent, loading: false })
      return finalContent
    },
    [loadSandboxMarkdownFile, setActiveViewerDocument, setRightPaneCollapsed]
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

  const handleResetEnvironment = useCallback(async () => {
    if (envResetNoticeTimerRef.current) clearTimeout(envResetNoticeTimerRef.current)
    envResetNoticeTimerRef.current = null
    setEnvResetNotice(false)
    clearAllEnvSessions('resetting')
    sharedEnvExploreSchemas.clear()
    inFlightEnvProvisionByUser.clear()
    await saveUserEnvironmentId(core40SDK, userIdRef.current || userId, '', getArtifactNamespace(extensionSDK)).catch(() => {})
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
    const activeConvId = convId

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
            const ct: StudioContentItemType = m.type === 'explore' ? 'explore' : m.type === 'look' ? 'look' : m.id.includes('::') ? 'lookml_dashboard' : 'dashboard'
            upsertContentItem({
              id: m.id, contentType: ct, title: m.title, source: 'mention', createdInConversation: false,
              ...(ct === 'explore' ? { exploreId: m.id } : {}), ...(ct === 'look' ? { lookId: m.id } : {}),
              ...(ct === 'dashboard' ? { dashboardId: m.id } : {}), ...(ct === 'lookml_dashboard' ? { lookmlDashboardId: m.id } : {}),
            })
          }
        }
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
        conversationId: activeConvId, onEnvironmentUpdated: syncSharedEnvironmentId,
        auth: authCfg, session: currentSession,
        model: selectedModel, thinkingLevel, maxTotalTokens,
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
          latestTurnInteractionRef.current = { convId: activeConvId, id }
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

      if (result.lookmlBundle) {
        setLookerWorkspaceId('dev')
        void syncLookerSessionWorkspace()
        setBusyStatus('Saving LookML session artifacts (user_..._lookml_... & obj_lookml_...)...')
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant', text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
          },
        ]
        setLookmlBundle(result.lookmlBundle)
        if (result.lookmlBundle.project_id) setLookmlProjectId(result.lookmlBundle.project_id)
        convType = 'lookml'
        convTitle = result.lookmlBundle.title
        try {
          const saved = await saveLookmlSessionArtifact({
            sdk: core40SDK, extensionSDK, userId, bundle: result.lookmlBundle,
            studio: {
              explores: turnExplores, lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
            },
          })
          const isExistingLookml = contentItemsRef.current.some((it) => it.key === `lookml:${saved.id}`)
          upsertContentItem({
            id: saved.id, sessionId: saved.id, projectId: result.lookmlBundle.project_id,
            contentType: 'lookml', title: result.lookmlBundle.title || `LookML (${result.lookmlBundle.project_id || saved.id})`,
            embedPath: `/lookml/${encodeURIComponent(saved.id)}`, updatedAt: new Date().toISOString(),
            source: isExistingLookml ? 'modified' : 'created', createdInConversation: true, hidden: false,
          })
          resolvedUseCaseByIdRef.current[saved.id] = 'lookml'
          convContent = {
            sessionId: saved.id, projectId: result.lookmlBundle.project_id,
            model: result.lookmlBundle.model_name, branch: result.lookmlBundle.branch_name,
          }
          lastLookmlIdRef.current = saved.id
          setActiveObjectId(saved.id)
        } catch { /* ignore */ }
        setAgentSession({ ...result.session, conversationId: convId, explores: turnExplores }, 'lookml')
        setMessages(finalMsgs)
      } else if (resolvedUseCase === 'tile') {
        const isExplicitScriptRequest =
          explicitUseCase === 'tile' || loadedScript || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
        const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
        const extractedPy = pyMatch ? pyMatch[1].trim() : ''
        const baseReply = result.assistantText || (isExplicitScriptRequest ? 'Updated script and executed Looker queries.' : 'Executed Looker API calls.')
        const replyText =
          !isExplicitScriptRequest && !/\b(?:save|reusable|turn\s+(?:this|it)\s+into)\b[\s\S]{0,60}\b(?:script|tile)\b/i.test(baseReply)
            ? `${baseReply}\n\nWould you like me to save this Looker API lookup as a reusable **Script**?`
            : baseReply
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant', text: replyText,
            interactionId: result.session.lastInteractionId,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
          },
        ]
        setAgentSession({ ...result.session, conversationId: convId, explores: turnExplores }, 'tile')
        setMessages(finalMsgs)
        if (isExplicitScriptRequest && (extractedPy || explicitUseCase === 'tile' || loadedScript)) {
          const nextCode = extractedPy || scriptCode
          if (extractedPy) setScriptCode(extractedPy)
          await handleRunPython(nextCode, filtersJson)
          try {
            const saved = await handleSaveScript(nextCode, finalMsgs, publishedTileDash)
            convType = 'tile'
            convTitle = saved.title
            convContent = { scriptId: saved.id, dashboardId: saved.dashboardId, elementId: saved.elementId }
            setActiveObjectId(saved.id)
          } catch { /* ignore */ }
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
        const effectiveExplores = turnExplores.length > 0 ? turnExplores : bundleExplores
        convExplores = effectiveExplores
        if (turnExplores.length === 0 && bundleExplores.length > 0) setSelectedExplores(bundleExplores)
        setAgentSession({ ...result.session, conversationId: convId, explores: effectiveExplores }, resolvedMode)

        if (result.nativeBundle) {
          setBusyStatus('Indexing native Looker content in user catalog...')
          const prelimAssistantMsg: ChatMessage = {
            role: 'assistant', text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            widgetCount: result.nativeBundle.tile_count,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
          }
          const isExistingNative = contentItemsRef.current.some((it) => it.id === String(result.nativeBundle!.id))
          const savedNative = await saveNativeContentArtifact(
            core40SDK, extensionSDK, userId, result.nativeBundle, selectedFolderId, nativeContent,
            {
              explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
            }
          )
          lastNativeIdRef.current = savedNative.id
          resolvedUseCaseByIdRef.current[savedNative.id] = 'dashboard'
          setNativeContent(savedNative, { source: isExistingNative ? 'modified' : 'created', createdInConversation: true, hidden: false })
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(savedNative.id)
          finalMsgs = [...messagesWithUser, { ...prelimAssistantMsg, dashboardId: savedNative.id }]
          setMessages(finalMsgs)
          convType = 'dashboard'
          convTitle = savedNative.title
          convContent = {
            dashboardId: savedNative.id, contentType: savedNative.contentType,
            embedPath: savedNative.embedPath, lookId: savedNative.lookId, lookmlDashboardId: savedNative.lookmlDashboardId,
          }
        } else if (result.bundle) {
          setBusyStatus('Publishing inline extension & updating Looker dashboard...')
          const prelimAssistantMsg: ChatMessage = {
            role: 'assistant', text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            widgetCount: result.bundle?.widgets?.length || 0,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
          }
          const upserted = await upsertPublishedDataApp(
            core40SDK, result.bundle, selectedFolderId, publishedApp,
            {
              explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
            }
          )
          const appUseCaseType: ResolvedStudioUseCase =
            resolvedUseCase === 'data-investigator' ? 'data-investigator' : 'app'
          const isExistingApp = contentItemsRef.current.some((it) => it.id === String(upserted.dashboardId))
          lastPublishedIdRef.current = upserted.dashboardId
          resolvedUseCaseByIdRef.current[upserted.dashboardId] = appUseCaseType
          setPublishedApp(upserted, { source: isExistingApp ? 'modified' : 'created', createdInConversation: true, hidden: false })
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(upserted.dashboardId)
          setCurrentAppCode(result.bundle.raw_code)
          finalMsgs = [...messagesWithUser, { ...prelimAssistantMsg, dashboardId: upserted.dashboardId }]
          try {
            await saveUserArtifact(
              core40SDK, userId,
              {
                id: upserted.dashboardId, type: appUseCaseType, title: upserted.title,
                explores: effectiveExplores, updatedAt: new Date().toISOString(), createdBy: userId,
              },
              {
                id: upserted.dashboardId, type: appUseCaseType, title: upserted.title,
                explores: effectiveExplores, updatedAt: new Date().toISOString(), createdBy: userId,
                dashboardId: upserted.dashboardId, extensionId: upserted.extensionId,
              },
              getArtifactNamespace(extensionSDK)
            )
          } catch { /* ignore */ }
          setMessages(finalMsgs)
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
              role: 'assistant', text: result.assistantText,
              interactionId: result.session.lastInteractionId,
              activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
            },
          ]
          setMessages(finalMsgs)
          if (explicitUseCase === 'auto' && resolvedMode !== activeMode && resolvedUseCase === 'health-check') {
            await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages, convId)
            return
          }
          if (effectiveBuilderMode === 'dashboard' && nativeContent) {
            const updatedNative = await saveNativeContentArtifact(
              core40SDK, extensionSDK, userId,
              { id: nativeContent.id, title: nativeContent.title, explores: effectiveExplores },
              selectedFolderId, nativeContent,
              {
                explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId,
              }
            )
            setNativeContent(updatedNative, { source: 'modified', hidden: false })
            convType = 'dashboard'
            convContent = {
              dashboardId: updatedNative.id, contentType: updatedNative.contentType, embedPath: updatedNative.embedPath,
            }
          } else if (publishedApp) {
            setPublishedApp(
              await saveDashboardStudioMetadata(core40SDK, publishedApp, {
                explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId,
              }),
              { source: 'modified', hidden: false }
            )
            convType = 'app'
            convContent = {
              dashboardId: publishedApp.dashboardId, appArtifactId: `obj_app_${publishedApp.dashboardId}`,
            }
          }
        }
      }

      setActiveConversationId(convId)
      const nextConvRoute = `/c/${encodeURIComponent(convId)}`
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
