import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AgentSession, AntigravityAuth, cleanLookmlProjectId, CodeModePermissionRequest,
  CURRENT_MANAGED_SOURCES_HASH, inFlightEnvProvisionByUser, PastedImage, prewarmOrWakeAntigravityEnvironment,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas, syncManagedSkillsIntoEnvironment,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import {
  clearAllUserConversations, clearInFlightConvId, compactPersistedChatTurn, EXPLICIT_SCRIPT_CREATION_RE,
  extractResolvedUseCase, getArtifactNamespace,
  hydrateConversationContentItems, isConversationalNoOpPrompt, isUserConversationDeleted,
  LOOKER_ALERT_QUERY_RE, matchExplicitUseCaseRule, reconcileDeletedLookerContent,
  ResolvedStudioUseCase, saveDashboardStudioMetadata, saveInFlightConvId,
  saveNativeContentArtifact, saveUserConversation, saveUserEnvironmentId,
  shouldOfferReusableScriptPrompt, shouldRouteToIsolatedCaSubagent, STUDIO_INFLIGHT_CONV_SESSION_KEY,
  StudioContentItemType, StudioContextMention, StudioUseCase, studioUseCaseToMode,
  toTurnCrudItem, TurnCrudItem, UserConversationEntry,
} from './lookerApi'
import { extractSlashSkillIds, resolveLookmlCanonicalProjectId } from './lookmlTool'
import { QueuedPromptItem, StudioAuthAndPrefs, StudioEnvironmentStatus } from './studioControllerAuth'
import { checkDataAppPublishGate, materializeTurnBundles, nextStudioConvId, prepareTurnMentionsAndContext, TurnSnapshotState, upsertLocalTurnContentItem } from './studioControllerConcurrency'
import { StudioLoaders } from './studioControllerLoaders'
import { StudioMetadata } from './studioControllerMetadata'

export { STUDIO_INFLIGHT_CONV_SESSION_KEY }
export type { QueuedPromptItem, StudioEnvironmentStatus }

const stripMessagesForStorage = (msgs: ChatMessage[]) => msgs.map((m) => compactPersistedChatTurn(m, true))

export function useStudioTurn(auth: StudioAuthAndPrefs, meta: StudioMetadata, loaders: StudioLoaders) {
  const {
    extensionSDK, core40SDK, history, location, authMode, oauthToken, oauthTokenRef, clientId, projectId, apiKey, selectedModel,
    thinkingLevel, maxTotalTokens, maxToolRounds, isAuthenticated, disabledModes, resolvedUseCaseByIdRef, parsedRoute,
    setSelectedUseCase, explicitUseCaseRef, allowedUseCases, triggerSilentOAuthRefresh, resetOAuthOnUnauthorized, sharedEnvIdRef,
    syncSharedEnvironmentId, agentSession, agentSessionRef, messagesRef, activeModeRef, setAgentSession, setMessages, busyStatus,
    activeConversationId, activeConversationIdRef, setActiveConversationId, requirePermissionRef, approvedOpsRef,
    permEpochByConvIdRef, inFlightTurnsRef, convLabelsRef, turnResumerRef, setConvBusyStatus, setConvLiveSteps,
    requestCodeModePermission, registerTurnEntry, finishTurnEntry, abortActiveTurn, abortAllConvTurns, cancelStandaloneForConv,
    queuedPromptsRef, updateQueuedPrompts, shiftQueuedPromptForConv,
  } = auth
  const {
    userId, userIdRef, setLookerWorkspaceId, syncLookerSessionWorkspace, availableLookmlProjects, canDeployLookml, loadingMetadata,
    models, selectedExplores, setSelectedExplores, mentionedItems, setMentionedItems, selectedFolderId, schemaMarkdown,
    setSchemaMarkdown, activeMode, isLookmlMode, isHealthCheckMode, builderMode, setActiveObjectId, conversations,
    conversationsRef, setConversations, isCaMode, lookmlProjectId, setLookmlProjectId, activatedLookmlSkills,
    setActivatedLookmlSkills, lookmlBundle, setLookmlBundle, lastLookmlIdRef, publishedApp, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContent, lastNativeIdRef, alertBundle, setAlertBundle, contentItemsRef, setContentItems, activeContentTabKeyRef,
    setActiveContentTabKey, upsertContentItem, setEmbedNonce, scriptId, scriptTitle, scriptCode, setScriptCode, filtersJson, publishedTileDash,
    loadedScript, currentAppCode, setCurrentAppCode, prompt, setPrompt, pastedImages, setPastedImages, hydratedConvRouteRef,
    activityStepsByInteractionIdRef, mergeCachedActivitySteps, codeModePermOptsRef,
  } = meta
  const { recoveredInFlightIdsRef, persistConversationAndLabel, handleRunPython, handleSaveScript, handleRunHealthCheck, handleRunConversationalAnalytics } = loaders

  conversations.forEach((c) => { if (c.label) convLabelsRef.current[c.id] = c.label })

  const [environmentStatus, setEnvironmentStatus] = useState<StudioEnvironmentStatus>('active')
  const environmentStatusRef = useRef<StudioEnvironmentStatus>('active')
  environmentStatusRef.current = environmentStatus
  const [envResetNotice, setEnvResetNotice] = useState<boolean>(false)
  const [envSyncNotice, setEnvSyncNotice] = useState<boolean>(false)
  const envNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const envLifecycleEpochRef = useRef(0)
  const skillSyncAbortRef = useRef<AbortController | null>(null)
  const [resetEnvModalOpen, setResetEnvModalOpen] = useState<boolean>(false)
  const onResetAppStateRef = useRef<(() => void) | null>(null)
  const onClearSandboxFileCacheRef = useRef<(() => void) | null>(null)
  const activeTurnCount = auth.runningConvIds.length + (busyStatus && auth.runningConvIds.length === 0 ? 1 : 0)
  const hasInFlightTurns = activeTurnCount > 0
  const envSkillsOutdated = Boolean(
    auth.sharedEnvironmentId && environmentStatus === 'active' && auth.envSourcesHash !== CURRENT_MANAGED_SOURCES_HASH
  )
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
          auth: {
            mode: authMode, oauthToken: oauthTokenRef.current || oauthToken, getOAuthToken: () => oauthTokenRef.current,
            clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true),
          },
          toolType: modeToWake, model: selectedModel, maxTotalTokens,
          environmentId: forceFresh ? undefined : sharedEnvIdRef.current || existingSession?.environmentId,
          existingSession, selectedExplores: ctx.selectedExplores, schemaMarkdown: ctx.schemaMarkdown,
          existingAppCode: modeToWake === 'app' ? ctx.currentAppCode : undefined,
          forceFresh, onEnvironmentUpdated: syncSharedEnvironmentId,
        })
        const nextEnvId = sharedEnvIdRef.current || res.session.environmentId
        const cur = agentSessionRef.current
        if (forceFresh || cur.environmentId !== nextEnvId || (!cur.lastInteractionId && res.session.lastInteractionId)) {
          setAgentSession(Object.assign({}, cur, res.session, { lastInteractionId: forceFresh ? res.session.lastInteractionId : cur.lastInteractionId || res.session.lastInteractionId, environmentId: nextEnvId }), modeToWake)
        }
      } catch { /* ignore */ }
    },
    [activeModeRef, agentSessionRef, apiKey, authMode, clientId, core40SDK, extensionSDK, maxTotalTokens, oauthToken, oauthTokenRef, projectId, selectedModel, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId, triggerSilentOAuthRefresh, userId, userIdRef]
  )

  useEffect(() => {
    if (disabledModes.includes(activeMode) || environmentStatus !== 'active' || sharedEnvIdRef.current) return
    if (loadingMetadata && models.length === 0 && selectedExplores.length === 0) return
    void handleWakeModeEnv(activeMode)
  }, [activeMode, disabledModes, environmentStatus, handleWakeModeEnv, loadingMetadata, models.length, selectedExplores.length, sharedEnvIdRef])

  codeModePermOptsRef.current = () => {
    const standaloneApproved = new Set<string>(), standaloneConvId = activeConversationIdRef.current
    const standaloneEpoch = permEpochByConvIdRef.current[standaloneConvId] ?? 0
    return {
      requirePermission: true, approvedOperations: standaloneApproved,
      onPermissionRequest: (req) => requestCodeModePermission(req, undefined, standaloneApproved, standaloneEpoch, standaloneConvId),
      isCanceled: () => (permEpochByConvIdRef.current[standaloneConvId] ?? 0) !== standaloneEpoch,
      thought: 'Execute Looker Python script',
    }
  }

  const lastSeenConvIdRef = useRef(activeConversationId)
  useEffect(() => {
    const prevConvId = lastSeenConvIdRef.current
    lastSeenConvIdRef.current = activeConversationId
    if (prevConvId !== activeConversationId) cancelStandaloneForConv(prevConvId)
  }, [activeConversationId, cancelStandaloneForConv])

  const handleQueuePrompt = useCallback(() => {
    if (!busyStatus) return
    const text = prompt.trim()
    if (!text && pastedImages.length === 0) return
    updateQueuedPrompts((prev) => [...prev, { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, images: pastedImages, mentions: mentionedItems }])
    setPrompt(''); setPastedImages([]); setMentionedItems([])
  }, [busyStatus, mentionedItems, pastedImages, prompt, setMentionedItems, setPastedImages, setPrompt, updateQueuedPrompts])

  const handleRemoveQueuedPrompt = useCallback((id: string) => updateQueuedPrompts((prev) => prev.filter((q) => q.id !== id)), [updateQueuedPrompts])

  const clearEnvNotices = useCallback(() => {
    if (envNoticeTimerRef.current) { clearTimeout(envNoticeTimerRef.current); envNoticeTimerRef.current = null }
    setEnvResetNotice(false); setEnvSyncNotice(false)
  }, [])

  const flashEnvNotice = useCallback((kind: 'reset' | 'sync') => {
    if (envNoticeTimerRef.current) clearTimeout(envNoticeTimerRef.current)
    setEnvResetNotice(kind === 'reset'); setEnvSyncNotice(kind === 'sync')
    envNoticeTimerRef.current = setTimeout(() => { setEnvResetNotice(false); setEnvSyncNotice(false); envNoticeTimerRef.current = null }, 2500)
  }, [])

  const clearAllEnvSessions = useCallback(
    (nextStatus: StudioEnvironmentStatus) => {
      envLifecycleEpochRef.current += 1
      if (skillSyncAbortRef.current) { skillSyncAbortRef.current.abort(); skillSyncAbortRef.current = null }
      abortAllConvTurns(); sharedEnvIdRef.current = ''; syncSharedEnvironmentId('')
      setAgentSession({ toolType: activeModeRef.current, environmentId: '' })
      environmentStatusRef.current = nextStatus; setEnvironmentStatus(nextStatus)
    },
    [abortAllConvTurns, activeModeRef, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId]
  )

  const handleSyncEnvironmentSkills = useCallback(async (): Promise<void> => {
    const targetEnvId = sharedEnvIdRef.current || auth.sharedEnvironmentId
    if (!targetEnvId || environmentStatusRef.current !== 'active' || hasInFlightTurns) return
    clearEnvNotices()
    const syncEpoch = ++envLifecycleEpochRef.current
    const ac = new AbortController()
    skillSyncAbortRef.current = ac
    environmentStatusRef.current = 'syncing'; setEnvironmentStatus('syncing')
    try {
      const res = await syncManagedSkillsIntoEnvironment({
        sdk: core40SDK, userId: userIdRef.current || userId, extensionSDK,
        auth: {
          mode: authMode, oauthToken: oauthTokenRef.current || oauthToken, getOAuthToken: () => oauthTokenRef.current,
          clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true),
        },
        environmentId: targetEnvId, model: selectedModel, signal: ac.signal,
      })
      if (ac.signal.aborted || envLifecycleEpochRef.current !== syncEpoch) return
      if (res.status === 'environment_expired') {
        syncSharedEnvironmentId('')
        await handleWakeModeEnv(activeModeRef.current, true)
        if (ac.signal.aborted || envLifecycleEpochRef.current !== syncEpoch) return
      } else if (sharedEnvIdRef.current === targetEnvId) {
        syncSharedEnvironmentId(targetEnvId, res.sourcesHash)
      } else {
        return
      }
      onClearSandboxFileCacheRef.current?.()
      environmentStatusRef.current = 'active'; setEnvironmentStatus('active'); flashEnvNotice('sync')
    } catch (err: unknown) {
      if (ac.signal.aborted || envLifecycleEpochRef.current !== syncEpoch) return
      environmentStatusRef.current = 'active'; setEnvironmentStatus('active')
      setMessages((prev) => [...prev, { role: 'error', text: `Skill sync failed: ${resetOAuthOnUnauthorized(err)}` }])
    } finally {
      if (skillSyncAbortRef.current === ac) skillSyncAbortRef.current = null
    }
  }, [activeModeRef, apiKey, auth.sharedEnvironmentId, authMode, clearEnvNotices, clientId, core40SDK, extensionSDK, flashEnvNotice, handleWakeModeEnv, hasInFlightTurns, oauthToken, oauthTokenRef, projectId, resetOAuthOnUnauthorized, selectedModel, setMessages, sharedEnvIdRef, syncSharedEnvironmentId, triggerSilentOAuthRefresh, userId, userIdRef])

  const handleResetEnvironment = useCallback((): Promise<void> => {
    setResetEnvModalOpen(false); clearEnvNotices()
    const uid = userIdRef.current || userId, ns = getArtifactNamespace(extensionSDK)
    const priorConvIds = Array.from(new Set([...conversationsRef.current.map((c) => c.id), ...inFlightTurnsRef.current.keys()]))
    conversationsRef.current = []
    clearAllEnvSessions('resetting')
    const resetEpoch = envLifecycleEpochRef.current
    auth.queuedPromptsByConvIdRef.current = {}
    updateQueuedPrompts(() => [])
    setConversations([], { optimisticEntry: null })
    onResetAppStateRef.current?.()
    wakeContextRef.current = { agentSession: { toolType: activeModeRef.current, environmentId: '' }, selectedExplores: [], schemaMarkdown: '', currentAppCode: '' }
    onClearSandboxFileCacheRef.current?.()
    sharedEnvExploreSchemas.clear(); inFlightEnvProvisionByUser.clear()
    const finish = () => {
      if (envLifecycleEpochRef.current !== resetEpoch) return
      environmentStatusRef.current = 'active'; setEnvironmentStatus('active'); flashEnvNotice('reset')
    }
    return Promise.all([
      uid ? clearAllUserConversations(core40SDK, uid, ns, priorConvIds).catch(() => {}) : Promise.resolve(),
      saveUserEnvironmentId(core40SDK, uid, '', ns).catch(() => {}),
    ])
      .then(() => (envLifecycleEpochRef.current === resetEpoch ? handleWakeModeEnv(activeModeRef.current, true) : undefined))
      .then(finish, (err) => { finish(); throw err })
  }, [activeModeRef, auth.queuedPromptsByConvIdRef, clearAllEnvSessions, clearEnvNotices, conversationsRef, core40SDK, extensionSDK, flashEnvNotice, handleWakeModeEnv, inFlightTurnsRef, setConversations, updateQueuedPrompts, userId, userIdRef])

  const handleStopEnvironment = useCallback(() => {
    clearEnvNotices()
    clearAllEnvSessions('stopped')
  }, [clearAllEnvSessions, clearEnvNotices])

  type PromptOverrideInput = {
    text: string; images?: PastedImage[]; mentions?: StudioContextMention[]
    bypassBusy?: boolean; targetConvId?: string; resumeConv?: UserConversationEntry
  }

  const handleSendPrompt = async (overrideItem?: PromptOverrideInput | React.SyntheticEvent) => {
    const isOverride =
      Boolean(overrideItem) && typeof overrideItem === 'object' &&
      !('nativeEvent' in (overrideItem as object)) &&
      typeof (overrideItem as { text?: unknown }).text === 'string'
    const typedOverride = isOverride ? (overrideItem as PromptOverrideInput) : undefined
    const resumeConv = typedOverride?.resumeConv
    const text = typedOverride ? typedOverride.text.trim() : prompt.trim()
    const attachedImages = typedOverride ? typedOverride.images || [] : pastedImages
    const activeMentions = typedOverride ? typedOverride.mentions || [] : mentionedItems
    const fgAtStart = !resumeConv && (!typedOverride?.targetConvId || typedOverride.targetConvId === activeConversationIdRef.current)
    const hasSavedRouteConv = Boolean(parsedRoute.conversationId && conversations.some((c) => c.id === parsedRoute.conversationId))
    const candidateConvId = resumeConv
      ? resumeConv.id
      : typedOverride?.targetConvId
      ? typedOverride.targetConvId
      : fgAtStart && messagesRef.current.filter((m) => m.role === 'user').length === 0 && !hasSavedRouteConv && (!parsedRoute.conversationId || location.pathname === '/')
      ? nextStudioConvId()
      : activeConversationIdRef.current || parsedRoute.conversationId || nextStudioConvId()
    const isConvBusy = inFlightTurnsRef.current.has(candidateConvId) || (candidateConvId === activeConversationIdRef.current && Boolean(busyStatus))
    const isEnvBusy = environmentStatusRef.current === 'resetting' || environmentStatusRef.current === 'syncing'
    if (!isAuthenticated || isEnvBusy || (!resumeConv && !text && attachedImages.length === 0) || (isConvBusy && !typedOverride?.bypassBusy)) return

    const convId = candidateConvId
    if (fgAtStart && activeConversationIdRef.current !== convId) {
      lastSeenConvIdRef.current = convId
      setActiveConversationId(convId)
    }
    const isFg = () => activeConversationIdRef.current === convId
    const existingConv = resumeConv || conversationsRef.current.find((c) => c.id === convId)
    const rawResumeMsgs = resumeConv ? mergeCachedActivitySteps((resumeConv.messages || []) as ChatMessage[]) : []
    const effectivePrompt = resumeConv
      ? rawResumeMsgs[rawResumeMsgs.length - 1]?.text || resumeConv.label || 'Continue request'
      : text || 'See the attached screenshot.'
    const currentMessages: ChatMessage[] = resumeConv
      ? rawResumeMsgs.slice(0, -1)
      : fgAtStart
      ? messagesRef.current
      : ((existingConv?.messages as ChatMessage[] | undefined) || [])
    const isFirstTurn = currentMessages.filter((m) => m.role === 'user').length === 0
    const userMsg: ChatMessage = { role: 'user', text: effectivePrompt, images: attachedImages.map((img) => img.dataUrl) }
    const messagesWithUser: ChatMessage[] = resumeConv ? (rawResumeMsgs.length > 0 ? rawResumeMsgs : [userMsg]) : [...currentMessages, userMsg]
    if (!typedOverride) { setPrompt(''); setPastedImages([]); setMentionedItems([]) }
    if (environmentStatusRef.current === 'stopped') { environmentStatusRef.current = 'active'; setEnvironmentStatus('active') }
    const authCfg: AntigravityAuth = {
      mode: authMode, oauthToken: oauthTokenRef.current || oauthToken, getOAuthToken: () => oauthTokenRef.current,
      clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true),
    }

    const explicitUseCase: StudioUseCase = fgAtStart ? explicitUseCaseRef.current : ((existingConv?.use_case as StudioUseCase) || 'auto')
    const classifiedPromptUseCase = matchExplicitUseCaseRule(effectivePrompt, allowedUseCases)
    const turnTargetUseCase: StudioUseCase = explicitUseCase !== 'auto' ? explicitUseCase : (classifiedPromptUseCase || 'auto')

    const snapExplores = fgAtStart ? (selectedExplores.length ? [...selectedExplores] : [...(existingConv?.explores || [])]) : [...(existingConv?.explores || [])]
    const snapItems = fgAtStart ? [...contentItemsRef.current] : (existingConv ? hydrateConversationContentItems(existingConv) : [])
    const snapTabKey = fgAtStart ? activeContentTabKeyRef.current : (existingConv?.activeContentTabKey === 'lookml:default' ? '' : existingConv?.activeContentTabKey || '')
    const snapPublishedApp = fgAtStart
      ? publishedApp
      : existingConv?.content?.appArtifactId && existingConv.content.dashboardId
      ? { dashboardId: String(existingConv.content.dashboardId), title: existingConv.label || '', folderId: selectedFolderId, extensionId: String(existingConv.content.extensionId || ''), elementId: '' }
      : null
    const snapNativeContent = fgAtStart
      ? nativeContent
      : !existingConv?.content?.appArtifactId && existingConv?.content?.dashboardId
      ? { id: String(existingConv.content.dashboardId), title: existingConv.label || '', contentType: (existingConv.content.contentType as 'dashboard') || 'dashboard', folderId: selectedFolderId, embedPath: String(existingConv.content.embedPath || '') }
      : null
    const snapshot: TurnSnapshotState = {
      selectedExplores: snapExplores, selectedFolderId, currentAppCode: fgAtStart ? currentAppCode : '',
      nativeContent: snapNativeContent, publishedApp: snapPublishedApp,
      lookmlProjectId: fgAtStart ? lookmlProjectId : String(existingConv?.content?.projectId || ''),
      lookmlBundle: fgAtStart ? lookmlBundle : null, alertBundle: fgAtStart ? alertBundle : null,
      scriptCode: fgAtStart ? scriptCode : '',
      scriptId: fgAtStart ? scriptId : String(existingConv?.content?.scriptId || ''),
      scriptTitle: fgAtStart ? scriptTitle : (existingConv?.label || ''),
      filtersJson: fgAtStart ? filtersJson : '{}',
      publishedTileDash: fgAtStart
        ? publishedTileDash
        : existingConv?.content?.dashboardId
        ? { dashboardId: String(existingConv.content.dashboardId), elementId: String(existingConv.content.elementId || '') }
        : null,
      contentItems: snapItems, activeContentTabKey: snapTabKey, messagesWithUser,
    }

    if (isFg()) {
      setMessages(messagesWithUser); setActiveConversationId(convId)
      const targetConvRoute = `/c/${encodeURIComponent(convId)}`
      if (location.pathname !== targetConvRoute) history.replace(targetConvRoute)
    }

    const turnApprovedOps = new Set<string>()
    const turnEntry = registerTurnEntry(convId, snapshot, existingConv?.label || sanitizeConversationLabel('', effectivePrompt))
    turnEntry.approvedOps = turnApprovedOps
    approvedOpsRef.current = turnApprovedOps
    const abortController = turnEntry.abortController, turnEpoch = turnEntry.permEpoch
    if (resumeConv) setConvBusyStatus(convId, 'Resuming in-flight turn...')

    const nowIso = new Date().toISOString()
    const inFlightEntry: UserConversationEntry = Object.assign({}, existingConv, {
      id: convId, type: existingConv?.type || (turnTargetUseCase !== 'auto' ? turnTargetUseCase : allowedUseCases[0] || 'app'),
      use_case: existingConv?.use_case || turnTargetUseCase, label: existingConv?.label || sanitizeConversationLabel('', effectivePrompt),
      explores: snapExplores.length ? snapExplores : existingConv?.explores, messages: stripMessagesForStorage(messagesWithUser),
      createdAt: existingConv?.createdAt || nowIso, updatedAt: nowIso,
    })
    setConversations((prev) => [inFlightEntry, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: inFlightEntry })
    saveInFlightConvId(convId)
    if (userId && !resumeConv) void saveUserConversation(core40SDK, userId, inFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})

    const itemState = { items: [...snapshot.contentItems], activeKey: snapshot.activeContentTabKey }
    const syncLocalItem = (raw: Partial<typeof itemState.items[0]> & { id: string; contentType: StudioContentItemType }, activate = true) => {
      const up = upsertLocalTurnContentItem(itemState, raw, activate)
      turnEntry.snapshot.contentItems = itemState.items; turnEntry.snapshot.activeContentTabKey = itemState.activeKey
      return up
    }

    try {
      const caRouteBase = { prompt: effectivePrompt, explicitUseCase, isCaMode: fgAtStart && isCaMode, isFirstTurn, allowedModes: allowedUseCases }
      if (!resumeConv && !isConversationalNoOpPrompt(effectivePrompt) && (turnTargetUseCase === 'health-check' || (explicitUseCase !== 'auto' && fgAtStart && isHealthCheckMode))) {
        if (isFg()) setSelectedUseCase('health-check')
        await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages, convId)
        return
      }
      if (!resumeConv && shouldRouteToIsolatedCaSubagent(caRouteBase)) {
        if (isFg()) setSelectedUseCase('conversational-analytics')
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, undefined, convId)
        return
      }

      const currentSession: AgentSession = fgAtStart
        ? agentSessionRef.current
        : { lastInteractionId: existingConv?.interactionId, environmentId: sharedEnvIdRef.current || existingConv?.environmentId || 'env_app_isolated', conversationId: convId, explores: snapExplores }
      const turnPermRequest = (req: CodeModePermissionRequest) =>
        requestCodeModePermission(req, abortController.signal, turnApprovedOps, turnEpoch, convId)

      const mentionsToHydrate: StudioContextMention[] = [...activeMentions]
      for (const urlMatch of effectivePrompt.matchAll(/(?:https?:\/\/[^\s/]+)?\/(dashboards|looks|explore)\/([^\s?#)]+)/gi)) {
        const rawKind = (urlMatch[1] || '').toLowerCase()
        let rawRef = String(urlMatch[2] || '').replace(/[.,;:'"]+$/, '').trim()
        try { rawRef = decodeURIComponent(rawRef) } catch { /* ignore */ }
        if (!rawRef) continue
        const mType: StudioContextMention['type'] = rawKind === 'dashboards' ? 'dashboard' : rawKind === 'looks' ? 'look' : 'explore'
        const mId = mType === 'explore' && rawRef.includes('/') && !rawRef.includes('::') ? rawRef.replace('/', '::') : rawRef
        if (!mentionsToHydrate.some((m) => m.type === mType && m.id === mId)) mentionsToHydrate.push({ type: mType, id: mId, title: mId })
      }
      const hydratedCtx = await prepareTurnMentionsAndContext({
        effectivePrompt, mentionsToHydrate, resumeConv, core40SDK, conversations, snapExplores, turnTargetUseCase,
        initialSchemaMarkdown: fgAtStart ? schemaMarkdown : '',
        onMentionItem: (rawMention) => { syncLocalItem(rawMention); if (isFg()) upsertContentItem(rawMention) },
        onHydratingStatus: () => setConvBusyStatus(convId, 'Hydrating referenced Looker @-mention context...'),
      })
      if (abortController.signal.aborted) return
      const turnExplores = hydratedCtx.explores, turnSchemaMarkdown = hydratedCtx.schemaMarkdown
      const turnExtraSources = hydratedCtx.extraSources, turnPromptWithContext = hydratedCtx.promptWithContext
      turnEntry.snapshot.selectedExplores = turnExplores
      if (hydratedCtx.exploresChanged && isFg()) {
        setSelectedExplores(turnExplores)
        if (turnSchemaMarkdown) setSchemaMarkdown(turnSchemaMarkdown)
      }

      const promptSlashSkills = extractSlashSkillIds(effectivePrompt)
      const stickyPromptSkills = promptSlashSkills.filter((id) => id !== 'looker-audit')
      const turnActivatedSkills = Array.from(new Set([...activatedLookmlSkills.filter((id) => id !== 'looker-audit'), ...stickyPromptSkills]))
      if (isFg() && (stickyPromptSkills.length > 0 || activatedLookmlSkills.includes('looker-audit'))) setActivatedLookmlSkills(turnActivatedSkills)
      const effectiveLookmlTurn = turnTargetUseCase === 'lookml' || (turnTargetUseCase === 'auto' && fgAtStart && isLookmlMode)
      const effectiveBuilderMode: 'data_app' | 'dashboard' =
        turnTargetUseCase === 'dashboard' ? 'dashboard' : turnTargetUseCase === 'app' || turnTargetUseCase === 'data-investigator' ? 'data_app' : builderMode
      const result = await runAntigravityTurn({
        sdk: core40SDK, extensionSDK, userId,
        environmentId: sharedEnvIdRef.current || currentSession.environmentId,
        conversationId: convId, onEnvironmentUpdated: syncSharedEnvironmentId,
        auth: authCfg, session: currentSession,
        model: selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds,
        mode: effectiveBuilderMode, useCase: explicitUseCase, allowedModes: allowedUseCases,
        selectedExplores: turnExplores, folderId: snapshot.selectedFolderId,
        toolMode: effectiveLookmlTurn ? 'lookml' : 'data_app',
        lookmlProjectId: snapshot.lookmlProjectId, activatedLookmlSkills: turnActivatedSkills, developableProjects: availableLookmlProjects,
        canDeploy: canDeployLookml, warmEnvironmentInBackground: true,
        schemaMarkdown: turnSchemaMarkdown,
        userPrompt:
          explicitUseCase === 'tile' || (fgAtStart && loadedScript) || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
            ? `Write a LkrCodeMode Python script for the user's request. Return the Python snippet inside a \`\`\`python code block.\n\nCurrent script:\n\`\`\`python\n${snapshot.scriptCode}\n\`\`\`\n\nUser request: ${turnPromptWithContext}`
            : turnPromptWithContext,
        images: attachedImages, existingAppCode: snapshot.currentAppCode || undefined,
        existingNativeContent: snapshot.nativeContent, extraSources: turnExtraSources,
        priorMessages: currentMessages, requirePermission: true,
        approvedOperations: turnApprovedOps, onPermissionRequest: turnPermRequest,
        onProgressSteps: (steps) => setConvLiveSteps(convId, steps),
        onInteractionCreated: (id) => {
          if (abortController.signal.aborted || isUserConversationDeleted(core40SDK, userId, convId, getArtifactNamespace(extensionSDK))) {
            recoveredInFlightIdsRef.current.add(id)
            return
          }
          latestTurnInteractionRef.current = { convId, id }
          const updatedInFlightEntry: UserConversationEntry = Object.assign({}, conversationsRef.current.find((c) => c.id === convId) || inFlightEntry, {
            interactionId: id, environmentId: sharedEnvIdRef.current || currentSession.environmentId,
            messages: stripMessagesForStorage(messagesWithUser), updatedAt: new Date().toISOString(),
          })
          setConversations((prev) => [updatedInFlightEntry, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: updatedInFlightEntry })
          if (userId) void saveUserConversation(core40SDK, userId, updatedInFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})
        },
        resumeInteractionId: resumeConv?.interactionId, signal: abortController.signal, onStatus: (s) => setConvBusyStatus(convId, s),
      })
      if (abortController.signal.aborted) return

      const resolvedUseCase: ResolvedStudioUseCase =
        explicitUseCase !== 'auto' ? explicitUseCase : result.resolvedUseCase || extractResolvedUseCase(result.assistantText, effectivePrompt, allowedUseCases)
      resolvedUseCaseByIdRef.current[convId] = resolvedUseCase
      if (isFg()) setSelectedUseCase(resolvedUseCase)
      if (!resumeConv && shouldRouteToIsolatedCaSubagent(Object.assign({}, caRouteBase, { assistantOutput: result.rawOutputText ?? result.assistantText }))) {
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, result.rawOutputText ?? result.assistantText, convId)
        return
      }
      const resolvedMode: StudioMode = studioUseCaseToMode(resolvedUseCase)
      let convType: string = resolvedUseCase, convTitle = '', convExplores = turnExplores
      let convContent: Record<string, unknown> | undefined, finalMsgs: ChatMessage[] = []
      let effectivePublishedApp = snapshot.publishedApp
      let effectiveNativeContent = snapshot.nativeContent
      const recordTurnDenial = (denyText: string, modeArg: StudioMode, typeArg: string, exploresArg: string[], contentArg?: Record<string, unknown>) => {
        const errMsgs: ChatMessage[] = [...messagesWithUser, { role: 'error', text: denyText }]
        turnEntry.snapshot.messagesWithUser = errMsgs
        if (isFg()) {
          setAgentSession(Object.assign({}, result.session, { conversationId: convId, explores: exploresArg }), modeArg)
          setMessages(errMsgs)
          hydratedConvRouteRef.current = `/c/${encodeURIComponent(convId)}:${convId}`
        }
        void persistConversationAndLabel({
          id: convId, type: typeArg, interactionId: result.session.lastInteractionId, environmentId: result.session.environmentId,
          label: isFirstTurn ? sanitizeConversationLabel('', effectivePrompt) : undefined, explores: exploresArg, content: contentArg,
          contentItems: itemState.items, activeContentTabKey: itemState.activeKey,
          messages: errMsgs, isFirstTurn, userPrompt: effectivePrompt, assistantText: denyText, updateArtifactIndex: false,
        })
      }
      const turnCrudItems: TurnCrudItem[] = []
      const recordCrudItem = (item: TurnCrudItem) => {
        const idx = turnCrudItems.findIndex((x) => x.key === item.key)
        if (idx >= 0) turnCrudItems[idx] = item
        else turnCrudItems.push(item)
      }
      const reconciledDel = reconcileDeletedLookerContent(itemState.items, itemState.activeKey, result.activitySteps)
      const deletedIds = reconciledDel.deletedIds
      if (deletedIds.size > 0) {
        itemState.items = reconciledDel.nextItems
        itemState.activeKey = reconciledDel.nextActiveTabKey
        turnEntry.snapshot.contentItems = itemState.items
        turnEntry.snapshot.activeContentTabKey = itemState.activeKey
        if (isFg()) {
          if (reconciledDel.nextItems.length !== contentItemsRef.current.length) setContentItems(reconciledDel.nextItems)
          if (reconciledDel.nextActiveTabKey !== activeContentTabKeyRef.current) setActiveContentTabKey(reconciledDel.nextActiveTabKey)
        }
        if (effectiveNativeContent && deletedIds.has(effectiveNativeContent.id)) {
          effectiveNativeContent = null; turnEntry.snapshot.nativeContent = null
          if (isFg()) setNativeContent(null)
        }
        if (effectivePublishedApp && deletedIds.has(effectivePublishedApp.dashboardId)) {
          effectivePublishedApp = null; turnEntry.snapshot.publishedApp = null; turnEntry.snapshot.currentAppCode = ''
          if (isFg()) { setPublishedApp(null); setCurrentAppCode('') }
        }
        reconciledDel.crudItems.forEach(recordCrudItem)
      }

      if (result.permissionError) {
        recordTurnDenial(result.permissionError, resolvedMode, convType, turnExplores, convContent)
        return
      }

      if (resolvedUseCase === 'tile' && !result.lookmlBundle && !result.nativeBundle && !result.bundle && !result.alertBundle) {
        const isExplicitScriptRequest = explicitUseCase === 'tile' || (fgAtStart && loadedScript) || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
        const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
        const extractedPy = pyMatch ? pyMatch[1].trim() : ''
        const isAlertQuery = LOOKER_ALERT_QUERY_RE.test(effectivePrompt) || turnActivatedSkills.includes('looker-alerts') || promptSlashSkills.includes('looker-audit')
        const baseReply = result.assistantText || (isExplicitScriptRequest ? 'Updated script and executed Looker queries.' : 'Executed Looker API calls.')
        const canOfferScript = shouldOfferReusableScriptPrompt({
          isExplicitScriptRequest, isAlertQuery, effectivePrompt, baseReply, activitySteps: result.activitySteps,
          crudItemsCount: turnCrudItems.length,
        })
        const replyText = canOfferScript
          ? `${baseReply}\n\nWould you like me to save this Looker API lookup as a reusable **Script**?`
          : baseReply
        if (isExplicitScriptRequest && (extractedPy || explicitUseCase === 'tile' || (fgAtStart && loadedScript))) {
          const nextCode = extractedPy || snapshot.scriptCode
          const prevKeys = new Set(itemState.items.map((it) => it.key))
          const pyOut = await handleRunPython(
            nextCode,
            snapshot.filtersJson,
            {
              requirePermission: true, approvedOperations: turnApprovedOps, onPermissionRequest: turnPermRequest, signal: abortController.signal,
              isCanceled: () => abortController.signal.aborted || (permEpochByConvIdRef.current[convId] ?? 0) !== turnEpoch,
              thought: 'Execute generated Looker Python script',
            },
            { convId, targetExplores: turnExplores, targetFolderId: snapshot.selectedFolderId }
          )
          if (abortController.signal.aborted) return
          if (pyOut.includes('PermissionError:')) {
            const denyErr = pyOut.match(/PermissionError:[^\n"]+/)?.[0] || 'PermissionError: Script execution mutates Looker state and was not approved.'
            recordTurnDenial(denyErr, 'tile', 'tile', turnExplores)
            return
          }
          if (extractedPy) {
            turnEntry.snapshot.scriptCode = extractedPy
            if (isFg()) setScriptCode(extractedPy)
          }
          try {
            const saved = await handleSaveScript(nextCode, messagesWithUser, snapshot.publishedTileDash, {
              convId, scriptId: snapshot.scriptId, scriptTitle: snapshot.scriptTitle, baseItems: itemState.items,
            })
            if (abortController.signal.aborted) return
            const existedScript = prevKeys.has(`script:${saved.id}`)
            turnEntry.snapshot.scriptId = saved.id; turnEntry.snapshot.scriptTitle = saved.title
            convType = 'tile'; convTitle = saved.title
            convContent = { scriptId: saved.id, dashboardId: saved.dashboardId, elementId: saved.elementId }
            const sItem = syncLocalItem({
              id: String(saved.id), scriptId: String(saved.id), contentType: 'script',
              title: saved.title || saved.id, embedPath: `/tile/${encodeURIComponent(String(saved.id))}`,
              updatedAt: saved.updatedAt, source: existedScript ? 'modified' : 'created', createdInConversation: true, hidden: false,
            })
            if (isFg()) setActiveObjectId(saved.id)
            recordCrudItem(toTurnCrudItem(sItem, existedScript ? 'updated' : 'created'))
          } catch { /* ignore */ }
        }
        if (abortController.signal.aborted) return
        finalMsgs = [
          ...messagesWithUser,
          Object.assign(
            {
              role: 'assistant' as const, text: replyText, interactionId: result.session.lastInteractionId,
              activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec,
            },
            turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : null
          ),
        ]
        if (isFg()) {
          setAgentSession(Object.assign({}, result.session, { conversationId: convId, explores: turnExplores }), 'tile')
          setMessages(finalMsgs)
        }
      } else {
        if (result.lookmlBundle && (resolveLookmlCanonicalProjectId(result.lookmlBundle) || cleanLookmlProjectId(snapshot.lookmlProjectId))) {
          setLookerWorkspaceId('dev')
          void syncLookerSessionWorkspace(true)
        }
        if (result.bundle && requirePermissionRef.current) {
          const pubOp = effectivePublishedApp?.dashboardId ? 'update_dashboard' : 'create_dashboard'
          const gate = await checkDataAppPublishGate({
            pubOp, dashboardId: effectivePublishedApp?.dashboardId, title: result.bundle.title, folderId: snapshot.selectedFolderId,
            thought: `Publish Data App "${result.bundle.title}" to Looker dashboard`,
            approvedOperations: turnApprovedOps, signal: abortController.signal, onPermissionRequest: turnPermRequest,
          })
          if (gate === 'aborted') return
          if (gate !== 'allowed') { recordTurnDenial(gate, resolvedMode, 'app', turnExplores, convContent); return }
        }
        const mat = await materializeTurnBundles({
          sdk: core40SDK, extensionSDK, userId, result, userPrompt: effectivePrompt, resolvedUseCase, allowedModes: allowedUseCases,
          folderId: snapshot.selectedFolderId, turnExplores, itemState,
          existingPublishedApp: effectivePublishedApp, existingNativeContent: effectiveNativeContent,
          existingLookmlBundle: snapshot.lookmlBundle, existingLookmlProjectId: snapshot.lookmlProjectId,
          initialConvType: convType, initialConvContent: convContent,
          requirePermission: false,
          signal: abortController.signal, onStatus: (s) => setConvBusyStatus(convId, s),
          onItemUpserted: () => { turnEntry.snapshot.contentItems = itemState.items; turnEntry.snapshot.activeContentTabKey = itemState.activeKey },
          onLookmlSaved: (mergedBundle, lookmlId, rawLookmlItem) => {
            turnEntry.snapshot.lookmlBundle = mergedBundle; turnEntry.snapshot.lookmlProjectId = lookmlId
            resolvedUseCaseByIdRef.current[lookmlId] = 'lookml'
            if (isFg()) { setLookmlBundle(mergedBundle); setLookmlProjectId(lookmlId); upsertContentItem(rawLookmlItem); lastLookmlIdRef.current = lookmlId; setActiveObjectId(lookmlId) }
          },
          onLookmlDashSaved: (d, lookmlId, isExistingDash) => {
            if (isFg()) {
              setNativeContent(
                { id: d.id, contentType: 'lookml_dashboard', title: d.title, folderId: snapshot.selectedFolderId, embedPath: d.embedPath, lookmlDashboardId: d.id, projectId: lookmlId, model: d.model },
                { source: isExistingDash ? 'modified' : 'created', createdInConversation: true, hidden: false }
              )
              setEmbedNonce((n) => n + 1)
            }
          },
          onNativeSaved: (savedNative, isExistingNative) => {
            resolvedUseCaseByIdRef.current[savedNative.id] = 'dashboard'
            turnEntry.snapshot.nativeContent = savedNative
            if (isFg()) {
              lastNativeIdRef.current = savedNative.id
              setNativeContent(savedNative, { source: isExistingNative ? 'modified' : 'created', createdInConversation: true, hidden: false })
              setEmbedNonce((n) => n + 1); setActiveObjectId(savedNative.id)
            }
          },
          onAlertSaved: (savedAlert, alertId, rawAlertItem) => {
            resolvedUseCaseByIdRef.current[alertId] = 'tile'
            turnEntry.snapshot.alertBundle = savedAlert
            if (isFg()) { setAlertBundle(savedAlert); upsertContentItem(rawAlertItem); setActiveObjectId(alertId) }
          },
          onDataAppSaved: (upserted, appUseCaseType, isExistingApp) => {
            resolvedUseCaseByIdRef.current[upserted.dashboardId] = appUseCaseType
            turnEntry.snapshot.publishedApp = upserted
            turnEntry.snapshot.currentAppCode = result.bundle?.raw_code || ''
            if (isFg()) {
              lastPublishedIdRef.current = upserted.dashboardId
              setPublishedApp(upserted, { source: isExistingApp ? 'modified' : 'created', createdInConversation: true, hidden: false })
              setEmbedNonce((n) => n + 1); setActiveObjectId(upserted.dashboardId); setCurrentAppCode(result.bundle?.raw_code || '')
            }
          },
        })
        if (mat.aborted || abortController.signal.aborted) return
        const effectiveExplores = mat.effectiveExplores
        convExplores = effectiveExplores
        turnEntry.snapshot.selectedExplores = effectiveExplores
        if (isFg() && turnExplores.length === 0 && effectiveExplores.length > 0) setSelectedExplores(effectiveExplores)
        mat.crudItems.forEach(recordCrudItem)
        convType = mat.convType; convTitle = mat.convTitle; convContent = mat.convContent
        effectivePublishedApp = mat.publishedApp; effectiveNativeContent = mat.nativeContent
        const { studioMeta, handledArtifact, finalDashId, finalWidgetCount, publishedDataAppDashboardLink } = mat

        if (!handledArtifact && deletedIds.size === 0) {
          if (explicitUseCase === 'auto' && resolvedMode !== activeMode && resolvedUseCase === 'health-check' && !promptSlashSkills.includes('looker-audit')) {
            await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages, convId)
            return
          }
          if (effectiveBuilderMode === 'dashboard' && effectiveNativeContent) {
            const updatedNative = await saveNativeContentArtifact(
              core40SDK, extensionSDK, userId,
              { id: effectiveNativeContent.id, title: effectiveNativeContent.title, explores: effectiveExplores },
              snapshot.selectedFolderId, effectiveNativeContent, studioMeta
            )
            if (abortController.signal.aborted) return
            turnEntry.snapshot.nativeContent = updatedNative
            syncLocalItem({
              id: String(updatedNative.id), contentType: (updatedNative.contentType || 'dashboard') as StudioContentItemType,
              title: updatedNative.title, embedPath: updatedNative.embedPath, folderId: updatedNative.folderId,
              dashboardId: String(updatedNative.id), source: 'modified', hidden: false,
            })
            if (isFg()) setNativeContent(updatedNative, { source: 'modified', hidden: false })
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
              turnEntry.snapshot.publishedApp = updatedApp
              if (isFg()) setPublishedApp(updatedApp, { source: 'modified', hidden: false })
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
          Object.assign(
            { role: 'assistant' as const, text: finalAssistantText, interactionId: result.session.lastInteractionId, activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec },
            finalDashId ? { dashboardId: finalDashId } : null,
            finalWidgetCount !== undefined ? { widgetCount: finalWidgetCount } : null,
            turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : null
          ),
        ]
        if (isFg()) {
          setAgentSession(Object.assign({}, result.session, { conversationId: convId, explores: effectiveExplores }), result.lookmlBundle && !result.nativeBundle && !result.bundle ? 'lookml' : resolvedMode)
          setMessages(finalMsgs)
        }
      }

      turnEntry.snapshot.messagesWithUser = finalMsgs
      if (result.session.lastInteractionId && result.activitySteps?.length) activityStepsByInteractionIdRef.current[result.session.lastInteractionId] = result.activitySteps
      if (isFg()) {
        setActiveConversationId(convId)
        const nextConvRoute = `/c/${encodeURIComponent(convId)}`
        hydratedConvRouteRef.current = `${nextConvRoute}:${convId}`
        if (location.pathname !== nextConvRoute) history.replace(nextConvRoute)
      }

      await persistConversationAndLabel({
        id: convId, type: convType, interactionId: result.session.lastInteractionId, environmentId: result.session.environmentId,
        label: isFirstTurn ? convTitle || sanitizeConversationLabel('', effectivePrompt) : undefined, explores: convExplores, content: convContent,
        contentItems: itemState.items, activeContentTabKey: itemState.activeKey, messages: finalMsgs, isFirstTurn, userPrompt: effectivePrompt,
        assistantText: finalMsgs[finalMsgs.length - 1]?.text || result.assistantText, updateArtifactIndex: Boolean(convContent && !convContent.scriptId),
      })
      if (!abortController.signal.aborted && isFg()) setMessages(finalMsgs)
    } catch (err: unknown) {
      if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
      const errMsgs: ChatMessage[] = [...messagesWithUser, { role: 'error', text: resetOAuthOnUnauthorized(err) }]
      if (isFg()) setMessages(errMsgs)
      else {
        const ns = getArtifactNamespace(extensionSDK)
        if (!isUserConversationDeleted(core40SDK, userId, convId, ns)) {
          const failedConv: UserConversationEntry = Object.assign({}, conversationsRef.current.find((c) => c.id === convId) || inFlightEntry, {
            messages: stripMessagesForStorage(errMsgs), updatedAt: new Date().toISOString(),
          })
          setConversations((prev) => [failedConv, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: failedConv })
          if (userId) void saveUserConversation(core40SDK, userId, failedConv, ns).catch(() => {})
        }
      }
    } finally {
      if (!abortController.signal.aborted) {
        finishTurnEntry(convId, abortController)
        clearInFlightConvId(convId)
        const nextQueued = shiftQueuedPromptForConv(convId)
        if (nextQueued) void handleSendPrompt({ text: nextQueued.text, images: nextQueued.images, mentions: nextQueued.mentions, bypassBusy: true, targetConvId: convId })
      }
    }
  }

  const sendPromptRef = useRef(handleSendPrompt)
  sendPromptRef.current = handleSendPrompt
  turnResumerRef.current = (conv: UserConversationEntry) => sendPromptRef.current({ text: '', resumeConv: conv, bypassBusy: true })

  const handleInterjectPrompt = useCallback(
    (queuedId?: string | React.MouseEvent) => {
      const queuedItem = typeof queuedId === 'string' ? queuedPromptsRef.current.find((q) => q.id === queuedId) : undefined
      const textToSend = queuedItem ? queuedItem.text : prompt.trim()
      const imagesToSend = queuedItem ? queuedItem.images : pastedImages
      const mentionsToSend = queuedItem ? queuedItem.mentions : mentionedItems
      if (!isAuthenticated || (!textToSend && imagesToSend.length === 0)) return
      if (queuedItem) updateQueuedPrompts((prev) => prev.filter((q) => q.id !== queuedItem.id))
      else { setPrompt(''); setPastedImages([]); setMentionedItems([]) }
      abortActiveTurn('Interjected by user.')
      void sendPromptRef.current({ text: textToSend, images: imagesToSend, mentions: mentionsToSend, bypassBusy: true })
    },
    [abortActiveTurn, isAuthenticated, mentionedItems, pastedImages, prompt, queuedPromptsRef, setMentionedItems, setPastedImages, setPrompt, updateQueuedPrompts]
  )

  return {
    environmentStatus, setEnvironmentStatus, envResetNotice, setEnvResetNotice,
    envSyncNotice, setEnvSyncNotice, resetEnvModalOpen, setResetEnvModalOpen,
    activeTurnCount, hasInFlightTurns, envSkillsOutdated,
    onResetAppStateRef, onClearSandboxFileCacheRef, latestTurnInteractionRef,
    handleSyncEnvironmentSkills, handleResetEnvironment, handleStopEnvironment, handleWakeModeEnv,
    handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt, handleSendPrompt,
  }
}

export type StudioTurn = ReturnType<typeof useStudioTurn>
