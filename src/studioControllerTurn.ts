import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AgentSession, AntigravityActivityStep, AntigravityAuth,
  cleanLookmlProjectId, CodeModePermissionRequest,
  inFlightEnvProvisionByUser,
  PastedImage, prewarmOrWakeAntigravityEnvironment,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import {
  buildDenseExploreSchema, clearInFlightConvId, compactPersistedChatTurn, EXPLICIT_SCRIPT_CREATION_RE,
  extractExploreIdsFromCode, extractResolvedUseCase,
  formatExploreId, formatStudioContentItemTitle, getArtifactNamespace, hydrateMentionedContext,
  isConversationalNoOpPrompt, LOOKER_ALERT_QUERY_RE, matchExplicitUseCaseRule, parseExploreId,
  ResolvedStudioUseCase, saveAlertArtifact, saveDashboardStudioMetadata, saveInFlightConvId, saveNativeContentArtifact,
  saveUserArtifact, saveUserConversation, saveUserEnvironmentId, shouldRouteToIsolatedCaSubagent,
  STUDIO_INFLIGHT_CONV_SESSION_KEY, StudioContentItemType, StudioContextMention, StudioUseCase,
  studioUseCaseToMode, toTurnCrudItem, TurnCrudItem, upsertPublishedDataApp, UserConversationEntry,
} from './lookerApi'
import {
  extractLookmlDashboardsFromBundle,
  extractSlashSkillIds,
  LookmlBundle,
  mergeLookmlFiles,
  resolveLookmlCanonicalProjectId,
  saveLookmlSessionArtifact,
} from './lookmlTool'
import { QueuedPromptItem, StudioAuthAndPrefs, StudioEnvironmentStatus } from './studioControllerAuth'
import { StudioLoaders } from './studioControllerLoaders'
import { StudioMetadata } from './studioControllerMetadata'

export { STUDIO_INFLIGHT_CONV_SESSION_KEY }
export type { QueuedPromptItem, StudioEnvironmentStatus }

const stripMessagesForStorage = (msgs: ChatMessage[]) => msgs.map((m) => compactPersistedChatTurn(m, true))

export function useStudioTurn(auth: StudioAuthAndPrefs, meta: StudioMetadata, loaders: StudioLoaders) {
  const {
    extensionSDK, core40SDK, history, location, mockExt, authMode, oauthToken, clientId, projectId, apiKey, selectedModel,
    thinkingLevel, maxTotalTokens, maxToolRounds, isAuthenticated, disabledModes, resolvedUseCaseByIdRef, parsedRoute,
    setSelectedUseCase, explicitUseCaseRef, allowedUseCases, resetOAuthOnUnauthorized, sharedEnvIdRef, syncSharedEnvironmentId,
    agentSession, agentSessionRef, messagesRef, activeModeRef, setAgentSession, setMessages, busyStatus, setBusyStatus,
    activeConversationId, activeConversationIdRef, setActiveConversationId, requirePermissionRef, approvedOpsRef, pendingPermRef,
    permEpochRef, activeTurnConvIdRef, turnAbortControllerRef, dismissPendingPerm, requestCodeModePermission,
    abortActiveTurn, handleStopTurn, liveActivityStepsRef, setLiveActivitySteps, queuedPromptsRef, updateQueuedPrompts,
  } = auth
  const {
    userId, userIdRef, setLookerWorkspaceId, syncLookerSessionWorkspace, availableLookmlProjects, canDeployLookml, loadingMetadata,
    models, selectedExplores, setSelectedExplores, mentionedItems, setMentionedItems, selectedFolderId, schemaMarkdown,
    setSchemaMarkdown, activeMode, isLookmlMode, isHealthCheckMode, builderMode, setActiveObjectId, conversations,
    conversationsRef, setConversations, isCaMode, lookmlProjectId, setLookmlProjectId, activatedLookmlSkills,
    setActivatedLookmlSkills, lookmlBundle, setLookmlBundle, lastLookmlIdRef, publishedApp, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContent, lastNativeIdRef, setAlertBundle, contentItemsRef, setContentItems, activeContentTabKeyRef,
    setActiveContentTabKey, upsertContentItem, setEmbedNonce, scriptCode, setScriptCode, filtersJson, publishedTileDash,
    loadedScript, currentAppCode, setCurrentAppCode, prompt, setPrompt, pastedImages, setPastedImages, hydratedConvRouteRef,
    activityStepsByInteractionIdRef, codeModePermOptsRef,
  } = meta
  const { persistConversationAndLabel, handleRunPython, handleSaveScript, handleRunHealthCheck, handleRunConversationalAnalytics } = loaders

  const [environmentStatus, setEnvironmentStatus] = useState<StudioEnvironmentStatus>('active')
  const environmentStatusRef = useRef<StudioEnvironmentStatus>('active')
  environmentStatusRef.current = environmentStatus
  const [envResetNotice, setEnvResetNotice] = useState<boolean>(false)
  const envResetNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestTurnInteractionRef = useRef<{ convId: string; id: string } | null>(null)
  const wakeContextRef = useRef({ agentSession, selectedExplores, schemaMarkdown, currentAppCode })
  wakeContextRef.current = { agentSession, selectedExplores, schemaMarkdown, currentAppCode }

  const handleWakeModeEnv = useCallback(
    async (modeToWake: StudioMode = activeModeRef.current, forceFresh = false) => {
      try {
        const ctx = wakeContextRef.current
        const existingSession: AgentSession = forceFresh ? { toolType: modeToWake } : ctx.agentSession
        const res = await prewarmOrWakeAntigravityEnvironment({
          sdk: core40SDK, userId: userIdRef.current || userId, extensionSDK,
          auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
          toolType: modeToWake, model: selectedModel, maxTotalTokens,
          environmentId: forceFresh ? undefined : sharedEnvIdRef.current || existingSession?.environmentId,
          existingSession, selectedExplores: ctx.selectedExplores, schemaMarkdown: ctx.schemaMarkdown,
          existingAppCode: modeToWake === 'app' ? ctx.currentAppCode : undefined,
          forceFresh, onEnvironmentUpdated: syncSharedEnvironmentId,
        })
        const nextEnvId = sharedEnvIdRef.current || res.session.environmentId
        const cur = agentSessionRef.current
        if (forceFresh || cur.environmentId !== nextEnvId || (!cur.lastInteractionId && res.session.lastInteractionId)) {
          setAgentSession({ ...cur, ...res.session, lastInteractionId: forceFresh ? res.session.lastInteractionId : cur.lastInteractionId || res.session.lastInteractionId, environmentId: nextEnvId }, modeToWake)
        }
      } catch { /* ignore */ }
    },
    [activeModeRef, agentSessionRef, apiKey, authMode, clientId, core40SDK, extensionSDK, maxTotalTokens, oauthToken, projectId, selectedModel, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId, userId, userIdRef]
  )

  useEffect(() => {
    if (disabledModes.includes(activeMode) || environmentStatus === 'stopped' || environmentStatus === 'resetting' || sharedEnvIdRef.current) return
    if (loadingMetadata && models.length === 0 && selectedExplores.length === 0) return
    void handleWakeModeEnv(activeMode)
  }, [activeMode, disabledModes, environmentStatus, handleWakeModeEnv, loadingMetadata, models.length, selectedExplores.length, sharedEnvIdRef])

  codeModePermOptsRef.current = () => {
    const standaloneApproved = new Set<string>(), standaloneEpoch = permEpochRef.current, standaloneConvId = activeConversationIdRef.current
    return {
      requirePermission: true, approvedOperations: standaloneApproved,
      onPermissionRequest: (req) => requestCodeModePermission(req, undefined, standaloneApproved, standaloneEpoch, standaloneConvId),
      isCanceled: () => permEpochRef.current !== standaloneEpoch, thought: 'Execute Looker Python script',
    }
  }

  const lastSeenConvIdRef = useRef(activeConversationId)
  useEffect(() => {
    const prevConvId = lastSeenConvIdRef.current
    lastSeenConvIdRef.current = activeConversationId
    if (activeTurnConvIdRef.current && activeConversationId !== activeTurnConvIdRef.current && turnAbortControllerRef.current) {
      abortActiveTurn()
      setBusyStatus((prev) => (prev && /^Loading\b/.test(prev) ? prev : mockExt?.initialBusyStatus || null))
    } else if (prevConvId !== activeConversationId) {
      if (pendingPermRef.current && pendingPermRef.current.convId !== activeConversationId) {
        permEpochRef.current += 1
        dismissPendingPerm('deny')
      }
      setBusyStatus((prev) => (prev === 'Executing Looker queries...' ? mockExt?.initialBusyStatus || null : prev))
    }
  }, [abortActiveTurn, activeConversationId, activeTurnConvIdRef, dismissPendingPerm, mockExt?.initialBusyStatus, pendingPermRef, permEpochRef, setBusyStatus, turnAbortControllerRef])

  const handleQueuePrompt = useCallback(() => {
    if (!busyStatus) return
    const text = prompt.trim()
    if (!text && pastedImages.length === 0) return
    updateQueuedPrompts((prev) => [...prev, { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, images: pastedImages, mentions: mentionedItems }])
    setPrompt(''); setPastedImages([]); setMentionedItems([])
  }, [busyStatus, mentionedItems, pastedImages, prompt, setMentionedItems, setPastedImages, setPrompt, updateQueuedPrompts])

  const handleRemoveQueuedPrompt = useCallback((id: string) => updateQueuedPrompts((prev) => prev.filter((q) => q.id !== id)), [updateQueuedPrompts])

  const clearAllEnvSessions = useCallback(
    (nextStatus: StudioEnvironmentStatus) => {
      handleStopTurn(); sharedEnvIdRef.current = ''; syncSharedEnvironmentId('')
      setAgentSession({ toolType: activeModeRef.current, environmentId: '' })
      environmentStatusRef.current = nextStatus; setEnvironmentStatus(nextStatus)
    },
    [activeModeRef, handleStopTurn, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId]
  )

  const handleResetEnvironment = useCallback((): Promise<void> => {
    if (envResetNoticeTimerRef.current) clearTimeout(envResetNoticeTimerRef.current)
    envResetNoticeTimerRef.current = null; setEnvResetNotice(false); clearAllEnvSessions('resetting')
    sharedEnvExploreSchemas.clear(); inFlightEnvProvisionByUser.clear()
    const finish = () => {
      environmentStatusRef.current = 'active'; setEnvironmentStatus('active'); setEnvResetNotice(true)
      envResetNoticeTimerRef.current = setTimeout(() => { setEnvResetNotice(false); envResetNoticeTimerRef.current = null }, 2500)
    }
    return saveUserEnvironmentId(core40SDK, userIdRef.current || userId, '', getArtifactNamespace(extensionSDK))
      .catch(() => {}).then(() => handleWakeModeEnv(activeModeRef.current, true)).then(finish, (err) => { finish(); throw err })
  }, [activeModeRef, clearAllEnvSessions, core40SDK, extensionSDK, handleWakeModeEnv, userId, userIdRef])

  const handleStopEnvironment = useCallback(() => {
    if (envResetNoticeTimerRef.current) clearTimeout(envResetNoticeTimerRef.current)
    envResetNoticeTimerRef.current = null; setEnvResetNotice(false); clearAllEnvSessions('stopped')
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
    const turnApprovedOps = new Set<string>()
    approvedOpsRef.current = turnApprovedOps
    if (!turnAbortControllerRef.current) {
      permEpochRef.current += 1
      if (pendingPermRef.current) dismissPendingPerm('deny')
    }
    if (environmentStatusRef.current === 'stopped') {
      environmentStatusRef.current = 'active'
      setEnvironmentStatus('active')
    }
    const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const effectivePrompt = text || 'See the attached screenshot.'
    const currentMessages = messagesRef.current
    const isFirstTurn = currentMessages.filter((m) => m.role === 'user').length === 0
    const userMsg: ChatMessage = { role: 'user', text: effectivePrompt, images: attachedImages.map((img) => img.dataUrl) }
    const messagesWithUser = [...currentMessages, userMsg]
    if (!typedOverride) {
      setPrompt('')
      setPastedImages([])
      setMentionedItems([])
    }
    setMessages(messagesWithUser)

    const explicitUseCase = explicitUseCaseRef.current
    const classifiedPromptUseCase = matchExplicitUseCaseRule(effectivePrompt, allowedUseCases)
    const turnTargetUseCase: StudioUseCase = explicitUseCase !== 'auto' ? explicitUseCase : (classifiedPromptUseCase || 'auto')

    const hasSavedRouteConv = Boolean(parsedRoute.conversationId && conversations.some((c) => c.id === parsedRoute.conversationId))
    const convId =
      isFirstTurn && !hasSavedRouteConv && (!parsedRoute.conversationId || location.pathname === '/')
        ? `conv_${Date.now()}`
        : activeConversationIdRef.current || parsedRoute.conversationId || `conv_${Date.now()}`

    setActiveConversationId(convId)
    const targetConvRoute = `/c/${encodeURIComponent(convId)}`
    if (location.pathname !== targetConvRoute) history.replace(targetConvRoute)
    const nowIso = new Date().toISOString()
    const existingConv = conversationsRef.current.find((c) => c.id === convId)
    const inFlightEntry: UserConversationEntry = {
      ...existingConv,
      id: convId,
      type: existingConv?.type || (turnTargetUseCase !== 'auto' ? turnTargetUseCase : allowedUseCases[0] || 'app'),
      use_case: existingConv?.use_case || turnTargetUseCase,
      label: existingConv?.label || sanitizeConversationLabel('', effectivePrompt),
      explores: selectedExplores.length ? selectedExplores : existingConv?.explores,
      messages: stripMessagesForStorage(messagesWithUser),
      createdAt: existingConv?.createdAt || nowIso,
      updatedAt: nowIso,
    }
    setConversations((prev) => [inFlightEntry, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: inFlightEntry })
    saveInFlightConvId(convId)
    if (userId) {
      void saveUserConversation(core40SDK, userId, inFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})
    }

    const caRouteBase = { prompt: effectivePrompt, explicitUseCase, isCaMode, isFirstTurn, allowedModes: allowedUseCases }
    if (!isConversationalNoOpPrompt(effectivePrompt) && (turnTargetUseCase === 'health-check' || (explicitUseCase !== 'auto' && isHealthCheckMode))) {
      setSelectedUseCase('health-check')
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages, convId)
      clearInFlightConvId()
      return
    }

    if (shouldRouteToIsolatedCaSubagent(caRouteBase)) {
      setSelectedUseCase('conversational-analytics')
      await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, undefined, convId)
      clearInFlightConvId()
      return
    }

    const currentSession = agentSessionRef.current
    const abortController = new AbortController()
    turnAbortControllerRef.current = abortController
    const turnEpoch = permEpochRef.current
    activeTurnConvIdRef.current = convId
    const turnPermRequest = (req: CodeModePermissionRequest) =>
      requestCodeModePermission(req, abortController.signal, turnApprovedOps, turnEpoch, convId)
    setBusyStatus('Connecting to Antigravity...')
    liveActivityStepsRef.current = []
    setLiveActivitySteps([])
    try {
      let turnExplores = selectedExplores
      let turnSchemaMarkdown = schemaMarkdown
      let turnExtraSources: Array<{ type: 'inline'; content: string; target: string }> | undefined
      let turnPromptWithContext = effectivePrompt

      const mentionsToHydrate: StudioContextMention[] = [...activeMentions]
      for (const urlMatch of effectivePrompt.matchAll(/(?:https?:\/\/[^\s/]+)?\/(dashboards|looks|explore)\/([^\s?#)]+)/gi)) {
        const rawKind = (urlMatch[1] || '').toLowerCase()
        let rawRef = String(urlMatch[2] || '').replace(/[.,;:'"]+$/, '').trim()
        try { rawRef = decodeURIComponent(rawRef) } catch { /* ignore */ }
        if (!rawRef) continue
        const mType: StudioContextMention['type'] = rawKind === 'dashboards' ? 'dashboard' : rawKind === 'looks' ? 'look' : 'explore'
        const mId = mType === 'explore' && rawRef.includes('/') && !rawRef.includes('::') ? rawRef.replace('/', '::') : rawRef
        if (!mentionsToHydrate.some((m) => m.type === mType && m.id === mId)) {
          mentionsToHydrate.push({ type: mType, id: mId, title: mId })
        }
      }

      if (mentionsToHydrate.length > 0) {
        mentionsToHydrate.forEach((m) => {
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
          sdk: core40SDK, mentions: mentionsToHydrate, conversations, selectedExplores, useCase: turnTargetUseCase,
        })
        if (hydrated.explores.length > 0) {
          turnExplores = hydrated.explores
          if (JSON.stringify(turnExplores) !== JSON.stringify(selectedExplores)) {
            setSelectedExplores(turnExplores)
            const sections = await Promise.all(
              turnExplores.map(async (id) => {
                const parsed = parseExploreId(id)
                if (!parsed) return ''
                try { return await buildDenseExploreSchema(core40SDK, parsed.modelName, parsed.exploreName) } catch { return '' }
              })
            )
            const joined = sections.filter(Boolean).join('\n\n---\n\n')
            if (joined) { turnSchemaMarkdown = joined; setSchemaMarkdown(joined) }
          }
        }
        if (hydrated.extraSources.length > 0) turnExtraSources = hydrated.extraSources
        if (hydrated.promptSummary) turnPromptWithContext = `${effectivePrompt}\n\n${hydrated.promptSummary}`
        if (abortController.signal.aborted) return
      }

      const promptSlashSkills = extractSlashSkillIds(effectivePrompt)
      const turnActivatedSkills = Array.from(new Set([...activatedLookmlSkills, ...promptSlashSkills]))
      if (promptSlashSkills.length > 0) setActivatedLookmlSkills(turnActivatedSkills)
      const effectiveLookmlTurn = turnTargetUseCase === 'lookml' || (turnTargetUseCase === 'auto' && isLookmlMode)
      const effectiveBuilderMode: 'data_app' | 'dashboard' =
        turnTargetUseCase === 'dashboard' ? 'dashboard' : turnTargetUseCase === 'app' || turnTargetUseCase === 'data-investigator' ? 'data_app' : builderMode
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
        canDeploy: canDeployLookml, warmEnvironmentInBackground: true,
        schemaMarkdown: turnSchemaMarkdown,
        userPrompt:
          explicitUseCase === 'tile' || loadedScript || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
            ? `Write a LkrCodeMode Python script for the user's request. Return the Python snippet inside a \`\`\`python code block.\n\nCurrent script:\n\`\`\`python\n${scriptCode}\n\`\`\`\n\nUser request: ${turnPromptWithContext}`
            : turnPromptWithContext,
        images: attachedImages, existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent, extraSources: turnExtraSources,
        priorMessages: currentMessages, requirePermission: true,
        approvedOperations: turnApprovedOps, onPermissionRequest: turnPermRequest,
        onProgressSteps: (steps) => { liveActivityStepsRef.current = steps; setLiveActivitySteps(steps) },
        onInteractionCreated: (id) => {
          latestTurnInteractionRef.current = { convId, id }
          const updatedInFlightEntry: UserConversationEntry = {
            ...(conversationsRef.current.find((c) => c.id === convId) || inFlightEntry),
            interactionId: id,
            environmentId: sharedEnvIdRef.current || currentSession.environmentId,
            messages: stripMessagesForStorage(messagesWithUser),
            updatedAt: new Date().toISOString(),
          }
          setConversations((prev) => [updatedInFlightEntry, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: updatedInFlightEntry })
          if (userId) {
            void saveUserConversation(core40SDK, userId, updatedInFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})
          }
        },
        signal: abortController.signal, onStatus: setBusyStatus,
      })
      if (abortController.signal.aborted) return

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
      let effectivePublishedApp = publishedApp
      let effectiveNativeContent = nativeContent
      const recordTurnDenial = (denyText: string, modeArg: StudioMode, typeArg: string, exploresArg: string[], contentArg?: Record<string, unknown>) => {
        setAgentSession(Object.assign({}, result.session, { conversationId: convId, explores: exploresArg }), modeArg)
        const errMsgs: ChatMessage[] = [...messagesWithUser, { role: 'error', text: denyText }]
        setMessages(errMsgs)
        hydratedConvRouteRef.current = `/c/${encodeURIComponent(convId)}:${convId}`
        void persistConversationAndLabel({
          id: convId, type: typeArg, interactionId: result.session.lastInteractionId, environmentId: result.session.environmentId,
          label: isFirstTurn ? sanitizeConversationLabel('', effectivePrompt) : undefined, explores: exploresArg, content: contentArg,
          messages: errMsgs, isFirstTurn, userPrompt: effectivePrompt, assistantText: denyText, updateArtifactIndex: false,
        })
      }
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
          if (effectiveNativeContent?.id === delId) { effectiveNativeContent = null; setNativeContent(null) }
          if (effectivePublishedApp?.dashboardId === delId) { effectivePublishedApp = null; setPublishedApp(null); setCurrentAppCode('') }
          const ct = hit ? hit.contentType : fbType
          recordCrudItem(toTurnCrudItem(hit || { key: `${ct}:${delId}`, id: delId, title: formatStudioContentItemTitle(ct, delId), contentType: ct }, 'deleted'))
          return ''
        })
      })

      if (resolvedUseCase === 'tile' && !result.lookmlBundle && !result.nativeBundle && !result.bundle && !result.alertBundle) {
        const isExplicitScriptRequest = explicitUseCase === 'tile' || loadedScript || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
        const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
        const extractedPy = pyMatch ? pyMatch[1].trim() : ''
        const isAlertQuery = LOOKER_ALERT_QUERY_RE.test(effectivePrompt) || turnActivatedSkills.includes('looker-alerts')
        const baseReply = result.assistantText || (isExplicitScriptRequest ? 'Updated script and executed Looker queries.' : 'Executed Looker API calls.')
        const replyText =
          !isExplicitScriptRequest && !isAlertQuery && !/\b(?:save|reusable|turn\s+(?:this|it)\s+into)\b[\s\S]{0,60}\b(?:script|tile)\b/i.test(baseReply)
            ? `${baseReply}\n\nWould you like me to save this Looker API lookup as a reusable **Script**?`
            : baseReply
        if (isExplicitScriptRequest && (extractedPy || explicitUseCase === 'tile' || loadedScript)) {
          const nextCode = extractedPy || scriptCode
          const prevKeys = new Set(contentItemsRef.current.map((it) => it.key))
          const pyOut = await handleRunPython(nextCode, filtersJson, {
            requirePermission: true, approvedOperations: turnApprovedOps, onPermissionRequest: turnPermRequest,
            isCanceled: () => abortController.signal.aborted || permEpochRef.current !== turnEpoch,
            thought: 'Execute generated Looker Python script',
          })
          if (abortController.signal.aborted) return
          if (pyOut.includes('PermissionError:')) {
            const denyErr = pyOut.match(/PermissionError:[^\n"]+/)?.[0] || 'PermissionError: Script execution mutates Looker state and was not approved.'
            recordTurnDenial(denyErr, 'tile', 'tile', turnExplores)
            return
          }
          if (extractedPy) setScriptCode(extractedPy)
          try {
            const saved = await handleSaveScript(nextCode, messagesWithUser, publishedTileDash)
            if (abortController.signal.aborted) return
            const existedScript = prevKeys.has(`script:${saved.id}`)
            convType = 'tile'
            convTitle = saved.title
            convContent = { scriptId: saved.id, dashboardId: saved.dashboardId, elementId: saved.elementId }
            setActiveObjectId(saved.id)
            const sItem = contentItemsRef.current.find((it) => it.key === `script:${saved.id}`)
            if (sItem) recordCrudItem(toTurnCrudItem(sItem, existedScript ? 'updated' : 'created'))
          } catch { /* ignore */ }
        }
        if (abortController.signal.aborted) return
        setAgentSession({ ...result.session, conversationId: convId, explores: turnExplores }, 'tile')
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant', text: replyText, interactionId: result.session.lastInteractionId,
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
            ...(turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : {}),
          },
        ]
        setMessages(finalMsgs)
      } else {
        const bundleExplores = result.bundle
          ? Array.from(
              new Set([
                ...(result.bundle.widgets || []).filter((w) => w.query?.model && w.query?.view).map((w) => formatExploreId(w.query.model, w.query.view)),
                ...extractExploreIdsFromCode(result.bundle.raw_code || ''),
              ])
            )
          : result.nativeBundle?.explores || []
        const effectiveExplores = turnExplores.length > 0 ? turnExplores : bundleExplores
        convExplores = effectiveExplores
        if (turnExplores.length === 0 && bundleExplores.length > 0) setSelectedExplores(bundleExplores)

        const studioMeta = { explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId, environmentId: result.session.environmentId }
        let handledArtifact = false
        let finalDashId: string | undefined
        let finalWidgetCount: number | undefined
        let publishedDataAppDashboardLink: { title: string; path: string } | null = null

        if (result.permissionError) {
          recordTurnDenial(result.permissionError, resolvedMode, convType, effectiveExplores, convContent)
          return
        }

        if (result.bundle && requirePermissionRef.current && !turnApprovedOps.has('*')) {
          const pubOp = effectivePublishedApp?.dashboardId ? 'update_dashboard' : 'create_dashboard'
          const pubPath = effectivePublishedApp?.dashboardId ? `/api/4.0/dashboards/${effectivePublishedApp.dashboardId}` : '/api/4.0/dashboards'
          if (!turnApprovedOps.has(pubOp)) {
            const decision = await turnPermRequest({
              operation: pubOp, httpMethod: effectivePublishedApp?.dashboardId ? 'PATCH' : 'POST', path: pubPath,
              args: { title: result.bundle.title, folder_id: selectedFolderId },
              thought: `Publish Data App "${result.bundle.title}" to Looker dashboard`,
            })
            if (abortController.signal.aborted) return
            if (decision === 'allow_op') turnApprovedOps.add(pubOp)
            else if (decision === 'allow_all') turnApprovedOps.add('*')
            else if (decision !== 'allow_once' && (decision as unknown) !== true) {
              recordTurnDenial(`PermissionError: Operation '${pubOp}' mutates Looker state and was not approved.`, resolvedMode, convType, effectiveExplores, convContent)
              return
            }
          }
        }

        if (result.lookmlBundle) {
          const canonProj = resolveLookmlCanonicalProjectId(result.lookmlBundle) || cleanLookmlProjectId(lookmlProjectId)
          if (canonProj) {
            handledArtifact = true
            setLookerWorkspaceId('dev')
            void syncLookerSessionWorkspace(true)
            setBusyStatus('Saving LookML project changes...')
            const prevFiles = lookmlBundle && resolveLookmlCanonicalProjectId(lookmlBundle) === canonProj ? lookmlBundle.files : []
            let mergedBundle: LookmlBundle = Object.assign({}, result.lookmlBundle, {
              id: canonProj, project_id: cleanLookmlProjectId(result.lookmlBundle.project_id) || canonProj,
              files: mergeLookmlFiles(prevFiles, result.lookmlBundle.files),
            })
            try {
              const saved = await saveLookmlSessionArtifact({ sdk: core40SDK, extensionSDK, userId, bundle: mergedBundle, studio: studioMeta })
              mergedBundle = saved.payload.bundle
            } catch { /* ignore */ }
            if (abortController.signal.aborted) return
            const lookmlId = cleanLookmlProjectId(mergedBundle.project_id) || canonProj
            setLookmlBundle(mergedBundle)
            setLookmlProjectId(lookmlId)
            const isExistingLookml = contentItemsRef.current.some((it) => it.contentType === 'lookml' && (it.projectId || it.id) === lookmlId)
            const upLookml = upsertContentItem({
              id: lookmlId, sessionId: lookmlId, projectId: lookmlId, contentType: 'lookml', title: `LookML: ${lookmlId}`,
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
              Object.assign({}, result.lookmlBundle, { model_name: result.lookmlBundle.model_name || mergedBundle.model_name, project_id: lookmlId })
            ).forEach((d) => {
              if (result.nativeBundle && (result.nativeBundle.id === d.id || result.nativeBundle.lookml_dashboard_id === d.id)) return
              const isExistingDash = contentItemsRef.current.some((it) => it.key === `lookml_dashboard:${d.id}`)
              setNativeContent(
                { id: d.id, contentType: 'lookml_dashboard', title: d.title, folderId: selectedFolderId, embedPath: d.embedPath, lookmlDashboardId: d.id, projectId: lookmlId, model: d.model },
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
          const savedNative = await saveNativeContentArtifact(core40SDK, extensionSDK, userId, result.nativeBundle, selectedFolderId, effectiveNativeContent, studioMeta)
          if (abortController.signal.aborted) return
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
            dashboardId: savedNative.id, contentType: savedNative.contentType, embedPath: savedNative.embedPath, lookId: savedNative.lookId, lookmlDashboardId: savedNative.lookmlDashboardId,
          })
        }

        if (result.alertBundle) {
          handledArtifact = true
          setBusyStatus('Saving Looker Alert snapshot to Artifacts...')
          const alertId = String(result.alertBundle.alert_id || result.alertBundle.id || '').trim()
          const isExistingAlert = contentItemsRef.current.some((it) => it.contentType === 'alert' && it.id === alertId)
          const savedAlert = await saveAlertArtifact(core40SDK, userId, result.alertBundle, getArtifactNamespace(extensionSDK))
          if (abortController.signal.aborted) return
          resolvedUseCaseByIdRef.current[alertId] = 'tile'
          setAlertBundle(savedAlert)
          const alertTitle = String(savedAlert.custom_title || savedAlert.title || `Alert #${alertId}`)
          const upAlert = upsertContentItem({
            id: alertId, alertId, dashboardId: savedAlert.dashboard_id ? String(savedAlert.dashboard_id) : undefined,
            contentType: 'alert', title: alertTitle, embedPath: `/alerts/${encodeURIComponent(alertId)}`,
            updatedAt: savedAlert.updated_at, source: isExistingAlert ? 'modified' : 'created', createdInConversation: true, hidden: false,
          })
          recordCrudItem(toTurnCrudItem(upAlert, isExistingAlert ? 'updated' : 'created'))
          setActiveObjectId(alertId)
          convType = 'tile'
          convTitle = alertTitle
          convContent = Object.assign({}, convContent, { alertId, dashboardId: savedAlert.dashboard_id ? String(savedAlert.dashboard_id) : undefined, contentType: 'alert' })
        }

        if (result.bundle) {
          handledArtifact = true
          setBusyStatus('Publishing inline extension & updating Looker dashboard...')
          const upserted = await upsertPublishedDataApp(core40SDK, result.bundle, selectedFolderId, effectivePublishedApp, studioMeta)
          if (abortController.signal.aborted) return
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
          if (upserted.dashboardId) {
            publishedDataAppDashboardLink = {
              title: upserted.title || result.bundle.title || 'Data App Dashboard',
              path: `/dashboards/${encodeURIComponent(String(upserted.dashboardId))}`,
            }
          }
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
          if (abortController.signal.aborted) return
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
          if (effectiveBuilderMode === 'dashboard' && effectiveNativeContent) {
            const updatedNative = await saveNativeContentArtifact(
              core40SDK, extensionSDK, userId,
              { id: effectiveNativeContent.id, title: effectiveNativeContent.title, explores: effectiveExplores },
              selectedFolderId, effectiveNativeContent, studioMeta
            )
            if (abortController.signal.aborted) return
            setNativeContent(updatedNative, { source: 'modified', hidden: false })
            convType = 'dashboard'
            convContent = { dashboardId: updatedNative.id, contentType: updatedNative.contentType, embedPath: updatedNative.embedPath }
          } else if (effectivePublishedApp) {
            if (
              !requirePermissionRef.current ||
              turnApprovedOps.has('*') ||
              turnApprovedOps.has('update_dashboard') ||
              turnApprovedOps.has('update_dashboard_element')
            ) {
              const updatedApp = await saveDashboardStudioMetadata(core40SDK, effectivePublishedApp, studioMeta)
              if (abortController.signal.aborted) return
              setPublishedApp(updatedApp, { source: 'modified', hidden: false })
            }
            convType = 'app'
            convContent = { dashboardId: effectivePublishedApp.dashboardId, appArtifactId: `obj_app_${effectivePublishedApp.dashboardId}` }
          }
        }

        const baseAssistantText = result.assistantText || ''
        const finalAssistantText =
          publishedDataAppDashboardLink && !baseAssistantText.includes(publishedDataAppDashboardLink.path)
            ? `${baseAssistantText.trimEnd()}\n\n**Looker Dashboard:** [Open ${publishedDataAppDashboardLink.title}](${publishedDataAppDashboardLink.path})`
            : baseAssistantText
        finalMsgs = [
          ...messagesWithUser,
          {
            role: 'assistant', text: finalAssistantText, interactionId: result.session.lastInteractionId,
            ...(finalDashId ? { dashboardId: finalDashId } : {}),
            ...(finalWidgetCount !== undefined ? { widgetCount: finalWidgetCount } : {}),
            ...(turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : {}),
            activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
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
        isFirstTurn, userPrompt: effectivePrompt, assistantText: finalMsgs[finalMsgs.length - 1]?.text || result.assistantText,
        updateArtifactIndex: Boolean(convContent),
      })
    } catch (err: unknown) {
      if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
      const msg = resetOAuthOnUnauthorized(err)
      setMessages((prev) => [...prev, { role: 'error', text: msg }])
    } finally {
      if (!abortController.signal.aborted) {
        if (turnAbortControllerRef.current === abortController) {
          turnAbortControllerRef.current = null
          activeTurnConvIdRef.current = ''
        }
        if (pendingPermRef.current?.signal === abortController.signal) dismissPendingPerm('deny')
        setBusyStatus(null)
        clearInFlightConvId()
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
      void sendPromptRef.current({ text: textToSend, images: imagesToSend, mentions: mentionsToSend, bypassBusy: true })
    },
    [abortActiveTurn, isAuthenticated, mentionedItems, pastedImages, prompt, queuedPromptsRef, setMentionedItems, setPastedImages, setPrompt, updateQueuedPrompts]
  )

  return {
    environmentStatus, setEnvironmentStatus, envResetNotice, setEnvResetNotice,
    latestTurnInteractionRef,
    handleResetEnvironment, handleStopEnvironment, handleWakeModeEnv,
    handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt,
    handleSendPrompt,
  }
}

export type StudioTurn = ReturnType<typeof useStudioTurn>
