import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AgentSession, AntigravityActivityStep, AntigravityAuth,
  CodeModePermissionDecision, CodeModePermissionRequest,
  extractSkillNameFromPath, fetchEnvironmentFile, inFlightEnvProvisionByUser,
  isNewProjectOnboardingIntakePrompt, normalizeEnvironmentId, normalizeSandboxFilePath,
  PastedImage, prewarmOrWakeAntigravityEnvironment, resolveBuiltinWorkspaceFileContent,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import {
  buildDenseExploreSchema, discoverAccessibleConnections, EXPLICIT_SCRIPT_CREATION_RE,
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
    sessionsByMode, sessionsByModeRef, setSessionsByMode,
    messagesByModeRef, activeModeRef, setAgentSession, setMessages,
    busyStatus, setBusyStatus,
  } = auth
  const {
    userId, userIdRef, setLookerWorkspaceId, syncLookerSessionWorkspace,
    availableLookmlProjects, canDeployLookml,
    selectedExplores, setSelectedExplores, mentionedItems, setMentionedItems,
    selectedFolderId, schemaMarkdown, setSchemaMarkdown,
    activeMode, isLookmlMode, isHealthCheckMode, builderMode,
    agentSession, messages, activeObjectId, setActiveObjectId,
    conversations, refreshCatalog, setLookmlSessions,
  } = meta
  const {
    caConversation, isCaMode,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, setLookmlBundle, setLoadLookmlInput, lastLookmlIdRef,
    publishedApp, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContent, lastNativeIdRef,
    contentItems, upsertContentItem, setEmbedNonce,
    healthReport, scriptId, scriptCode, setScriptCode, filtersJson,
    publishedTileDash, loadedScript,
    currentAppCode, setCurrentAppCode, setLoadDashInput,
    activeViewerDocument, setActiveViewerDocument,
    prompt, setPrompt, pastedImages, setPastedImages,
    activeConversationId, setActiveConversationId,
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

  const loadSandboxMarkdownFile = useCallback(
    async (rawPath: string, opts?: { openModal?: boolean }): Promise<string> => {
      const normalizedPath = normalizeSandboxFilePath(rawPath)
      if (!normalizedPath) return ''
      const displayPath = `/${normalizedPath}`
      if (opts?.openModal) setActiveSandboxMarkdownModalPath(displayPath)
      const activeEnv = sessionsByModeRef.current[activeModeRef.current]?.environmentId
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
    [activeModeRef, apiKey, authMode, clientId, extensionSDK, oauthToken, projectId, sessionsByModeRef, sharedEnvIdRef, triggerSilentOAuthRefresh]
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

  const wakeContextRef = useRef({ sessionsByMode, selectedExplores, schemaMarkdown, currentAppCode })
  wakeContextRef.current = { sessionsByMode, selectedExplores, schemaMarkdown, currentAppCode }

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
          maxTotalTokens,
          environmentId: forceFresh ? undefined : sharedEnvIdRef.current || existingSession?.environmentId,
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
            !forceFresh && cur && cur.environmentId === nextEnvId &&
            cur.lastInteractionId === res.session.lastInteractionId &&
            cur.toolType === res.session.toolType
          ) {
            return prev
          }
          const updated = { ...prev, [modeToWake]: { ...res.session, environmentId: nextEnvId } }
          sessionsByModeRef.current = updated
          return updated
        })
      } catch { /* ignore */ }
    },
    [activeModeRef, apiKey, authMode, clientId, core40SDK, extensionSDK, maxTotalTokens, oauthToken, projectId, selectedModel, sessionsByModeRef, setSessionsByMode, sharedEnvIdRef, syncSharedEnvironmentId, userId, userIdRef]
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
    [handleStopTurn, sessionsByModeRef, setSessionsByMode, sharedEnvIdRef, syncSharedEnvironmentId]
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
    const currentMessages = messagesByModeRef.current[activeModeRef.current] || messages
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

    const caRouteBase = { prompt: effectivePrompt, explicitUseCase, isCaMode, isFirstTurn, allowedModes: allowedUseCases }
    if (!isConversationalNoOpPrompt(effectivePrompt) && (turnTargetUseCase === 'health-check' || (explicitUseCase !== 'auto' && isHealthCheckMode))) {
      setSelectedUseCase('health-check')
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
      await refreshCatalog()
      return
    }

    if (shouldRouteToIsolatedCaSubagent(caRouteBase)) {
      setSelectedUseCase('conversational-analytics')
      await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser)
      return
    }

    const currentSession = sessionsByModeRef.current[activeModeRef.current] || agentSession
    const activeConvId =
      parsedRoute.objectId || activeObjectId || currentSession.conversationId ||
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
        signal: abortController.signal, onStatus: setBusyStatus,
      })

      const resolvedUseCase: ResolvedStudioUseCase =
        explicitUseCase !== 'auto'
          ? explicitUseCase
          : result.resolvedUseCase || extractResolvedUseCase(result.assistantText, effectivePrompt, allowedUseCases)
      setSelectedUseCase(resolvedUseCase)
      if (shouldRouteToIsolatedCaSubagent({ ...caRouteBase, assistantOutput: result.rawOutputText ?? result.assistantText })) {
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, result.rawOutputText ?? result.assistantText)
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
        convId = result.lookmlBundle.id || 'lookml_1'
        convType = 'lookml'
        convTitle = result.lookmlBundle.title
        try {
          const saved = await saveLookmlSessionArtifact({
            sdk: core40SDK, extensionSDK, userId, bundle: result.lookmlBundle,
            studio: {
              explores: turnExplores, lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId, messages: finalMsgs,
            },
          })
          convId = saved.id
          resolvedUseCaseByIdRef.current[saved.id] = 'lookml'
          convContent = {
            sessionId: saved.id, projectId: result.lookmlBundle.project_id,
            model: result.lookmlBundle.model_name, branch: result.lookmlBundle.branch_name,
          }
          lastLookmlIdRef.current = saved.id
          setActiveObjectId(saved.id)
          setLoadLookmlInput(saved.id)
          setLookmlSessions((prev) => [saved.index, ...prev.filter((s) => s.id !== saved.id)])
          await refreshCatalog()
          const targetRoute = `/c/${encodeURIComponent(saved.id)}`
          if (location.pathname !== targetRoute) history.replace(targetRoute)
        } catch { /* ignore */ }
        setAgentSession({ ...result.session, explores: turnExplores }, 'lookml')
        setMessages(finalMsgs, 'lookml')
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
        setAgentSession({ ...result.session, explores: turnExplores }, 'tile')
        setMessages(finalMsgs, 'tile')
        if (isExplicitScriptRequest && (extractedPy || explicitUseCase === 'tile' || loadedScript)) {
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
        setAgentSession({ ...result.session, explores: effectiveExplores }, resolvedMode)

        if ((effectiveBuilderMode === 'dashboard' || resolvedUseCase === 'dashboard') && result.nativeBundle) {
          setBusyStatus('Indexing native Looker content in user catalog...')
          const prelimAssistantMsg: ChatMessage = {
            role: 'assistant', text: result.assistantText,
            interactionId: result.session.lastInteractionId,
            widgetCount: result.nativeBundle.tile_count,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
          }
          const savedNative = await saveNativeContentArtifact(
            core40SDK, extensionSDK, userId, result.nativeBundle, selectedFolderId, nativeContent,
            {
              explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId, messages: [...messagesWithUser, prelimAssistantMsg],
            }
          )
          lastNativeIdRef.current = savedNative.id
          resolvedUseCaseByIdRef.current[savedNative.id] = 'dashboard'
          setNativeContent(savedNative, { source: 'created', createdInConversation: true })
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(savedNative.id)
          setLoadDashInput(savedNative.id)
          const targetRoute = `/c/${encodeURIComponent(savedNative.id)}`
          if (location.pathname !== targetRoute) history.replace(targetRoute)
          await refreshCatalog()
          finalMsgs = [...messagesWithUser, { ...prelimAssistantMsg, dashboardId: savedNative.id }]
          setMessages(finalMsgs, 'dashboard')
          convId = savedNative.id
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
              environmentId: result.session.environmentId, messages: [...messagesWithUser, prelimAssistantMsg],
            }
          )
          const appUseCaseType: ResolvedStudioUseCase =
            resolvedUseCase === 'data-investigator' ? 'data-investigator' : 'app'
          lastPublishedIdRef.current = upserted.dashboardId
          resolvedUseCaseByIdRef.current[upserted.dashboardId] = appUseCaseType
          setPublishedApp(upserted, { source: 'created', createdInConversation: true })
          setEmbedNonce((n) => n + 1)
          setActiveObjectId(upserted.dashboardId)
          setCurrentAppCode(result.bundle.raw_code)
          setLoadDashInput(upserted.dashboardId)
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
                rawCode: result.bundle.raw_code, messages: finalMsgs,
              },
              getArtifactNamespace(extensionSDK)
            )
            await refreshCatalog()
          } catch { /* ignore */ }
          const targetRoute = `/c/${encodeURIComponent(upserted.dashboardId)}`
          if (location.pathname !== targetRoute) history.replace(targetRoute)
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
              role: 'assistant', text: result.assistantText,
              interactionId: result.session.lastInteractionId,
              activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
            },
          ]
          setMessages(finalMsgs, resolvedMode)
          if (explicitUseCase === 'auto' && resolvedMode !== activeMode && resolvedUseCase === 'health-check') {
            await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
            await refreshCatalog()
            return
          }
          if (effectiveBuilderMode === 'dashboard' && nativeContent) {
            const updatedNative = await saveNativeContentArtifact(
              core40SDK, extensionSDK, userId,
              { id: nativeContent.id, title: nativeContent.title, explores: effectiveExplores },
              selectedFolderId, nativeContent,
              {
                explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId, messages: finalMsgs,
              }
            )
            setNativeContent(updatedNative, { source: 'created', createdInConversation: true })
            await refreshCatalog()
            convId = updatedNative.id
            convType = 'dashboard'
            convTitle = updatedNative.title
            convContent = {
              dashboardId: updatedNative.id, contentType: updatedNative.contentType, embedPath: updatedNative.embedPath,
            }
          } else if (publishedApp) {
            setPublishedApp(
              await saveDashboardStudioMetadata(core40SDK, publishedApp, {
                explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId,
                environmentId: result.session.environmentId, messages: finalMsgs,
              }),
              { source: 'created', createdInConversation: true }
            )
            convId = publishedApp.dashboardId
            convType = 'app'
            convTitle = publishedApp.title
            convContent = {
              dashboardId: publishedApp.dashboardId, appArtifactId: `obj_app_${publishedApp.dashboardId}`,
            }
          }
        }
      }

      if (convId && resolvedUseCase) resolvedUseCaseByIdRef.current[convId] = resolvedUseCase
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
