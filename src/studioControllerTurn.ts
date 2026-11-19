import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AgentSession, cleanLookmlProjectId, CodeModePermissionRequest,
  CURRENT_MANAGED_SOURCES_HASH, hydrateRemoteConversationMessages, inFlightEnvProvisionByUser,
  PastedImage, prewarmOrWakeAntigravityEnvironment, pruneDeadEnvironmentConversations, recoverInFlightInteraction,
  runAntigravityTurn, sanitizeConversationLabel, sharedEnvExploreSchemas, syncManagedSkillsIntoEnvironment,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import { clearHealthCheckSessionCache, HealthCheckReportPayload, saveHealthCheckArtifact } from './healthCheck'
import {
  clearAllUserConversations, clearInFlightConvId, clearSessionAlertCache, EXPLICIT_SCRIPT_CREATION_RE,
  getArtifactNamespace, hydrateConversationContentItems, isLookerInstanceMetadataQuery, isUserConversationDeleted,
  LOOKER_ALERT_QUERY_RE, mergeTurnInteractionIds, reconcileDeletedLookerContent,
  saveDashboardStudioMetadata, saveInFlightConvId,
  saveNativeContentArtifact, saveUserConversation, saveUserEnvironmentId,
  shouldOfferReusableScriptPrompt, STUDIO_INFLIGHT_CONV_SESSION_KEY,
  StudioContentItemType, StudioContextMention,
  toTurnCrudItem, TurnCrudItem, UserConversationEntry,
} from './lookerApi'
import { clearLookmlSessionCache, extractSlashSkillIds, resolveLookmlCanonicalProjectId } from './lookmlTool'
import { QueuedPromptItem, StudioAuthAndPrefs, StudioEnvironmentStatus } from './studioControllerAuth'
import { checkDataAppPublishGate, materializeTurnBundles, nextStudioConvId, prepareTurnMentionsAndContext, TurnSnapshotState, upsertLocalTurnContentItem } from './studioControllerConcurrency'
import { StudioLoaders } from './studioControllerLoaders'
import { StudioMetadata } from './studioControllerMetadata'

export { STUDIO_INFLIGHT_CONV_SESSION_KEY }
export type { QueuedPromptItem, StudioEnvironmentStatus }

export function useStudioTurn(auth: StudioAuthAndPrefs, meta: StudioMetadata, loaders: StudioLoaders) {
  const {
    extensionSDK, core40SDK, history, location, selectedModel,
    thinkingLevel, maxTotalTokens, maxToolRounds, isAuthenticated, disabledModes, parsedRoute,
    resetOAuthOnUnauthorized, sharedEnvIdRef,
    syncSharedEnvironmentId, agentSession, agentSessionRef, messagesRef, setAgentSession, setMessages,
    getAuthCfg, selectEpochRef, getConvMessages, setConvMessages, clearAllConvMessages, busyStatus,
    activeConversationId, activeConversationIdRef, setActiveConversationId, requirePermissionRef, approvedOpsRef,
    permEpochByConvIdRef, inFlightTurnsRef, convLabelsRef, turnResumerRef, setConvBusyStatus, setConvLiveSteps,
    requestCodeModePermission, registerTurnEntry, finishTurnEntry, abortActiveTurn, abortAllConvTurns, cancelStandaloneForConv,
    queuedPromptsRef, updateQueuedPrompts, shiftQueuedPromptForConv, setExpiredConversationNotice,
  } = auth
  const {
    userId, userIdRef, setLookerWorkspaceId, syncLookerSessionWorkspace, availableLookmlProjects, canDevelopLookml, canDeployLookml, loadingMetadata,
    models, selectedExplores, setSelectedExplores, mentionedItems, setMentionedItems, selectedFolderId, schemaMarkdown,
    setSchemaMarkdown, setActiveObjectId, conversations,
    conversationsRef, setConversations, lookmlProjectId, setLookmlProjectId, activatedLookmlSkills,
    setActivatedLookmlSkills, lookmlBundle, setLookmlBundle, lastLookmlIdRef, publishedApp, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContent, lastNativeIdRef, alertBundle, setAlertBundle, contentItemsRef, setContentItems, activeContentTabKeyRef,
    setActiveContentTabKey, upsertContentItem, setEmbedNonce, healthReport, setHealthReport, lastHealthIdRef,
    scriptId, scriptTitle, scriptCode, setScriptCode, filtersJson, publishedTileDash,
    loadedScript, currentAppCode, setCurrentAppCode, prompt, setPrompt, pastedImages, setPastedImages, hydratedConvRouteRef,
    activityStepsByInteractionIdRef, mergeCachedActivitySteps, codeModePermOptsRef,
  } = meta
  const { recoveredInFlightIdsRef, persistConversationAndLabel, handleRunPython, handleSaveScript, handleRunConversationalAnalytics } = loaders

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
    async (modeToWake: StudioMode = 'app', forceFresh = false) => {
      try {
        const ctx = wakeContextRef.current
        const existingSession: AgentSession = forceFresh ? { toolType: modeToWake } : ctx.agentSession
        const res = await prewarmOrWakeAntigravityEnvironment({
          sdk: core40SDK, userId: userIdRef.current || userId, extensionSDK,
          auth: getAuthCfg(),
          toolType: modeToWake, model: selectedModel, maxTotalTokens,
          environmentId: forceFresh ? undefined : sharedEnvIdRef.current || existingSession?.environmentId,
          existingSession, selectedExplores: ctx.selectedExplores, schemaMarkdown: ctx.schemaMarkdown,
          existingAppCode: ctx.currentAppCode || undefined,
          forceFresh, onEnvironmentUpdated: syncSharedEnvironmentId,
        })
        const nextEnvId = sharedEnvIdRef.current || res.session.environmentId
        const cur = agentSessionRef.current
        if (forceFresh || cur.environmentId !== nextEnvId || (!cur.lastInteractionId && res.session.lastInteractionId)) {
          setAgentSession(Object.assign({}, cur, res.session, { lastInteractionId: forceFresh ? res.session.lastInteractionId : cur.lastInteractionId || res.session.lastInteractionId, environmentId: nextEnvId }))
        }
      } catch { /* ignore */ }
    },
    [agentSessionRef, core40SDK, extensionSDK, getAuthCfg, maxTotalTokens, selectedModel, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId, userId, userIdRef]
  )

  useEffect(() => {
    if (environmentStatus !== 'active' || sharedEnvIdRef.current) return
    if (loadingMetadata && models.length === 0 && selectedExplores.length === 0) return
    void handleWakeModeEnv('app')
  }, [environmentStatus, handleWakeModeEnv, loadingMetadata, models.length, selectedExplores.length, sharedEnvIdRef])

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
      setAgentSession({ environmentId: '' })
      environmentStatusRef.current = nextStatus; setEnvironmentStatus(nextStatus)
    },
    [abortAllConvTurns, setAgentSession, sharedEnvIdRef, syncSharedEnvironmentId]
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
        auth: getAuthCfg(),
        environmentId: targetEnvId, model: selectedModel, signal: ac.signal,
      })
      if (ac.signal.aborted || envLifecycleEpochRef.current !== syncEpoch) return
      if (res.status === 'environment_expired') {
        syncSharedEnvironmentId('')
        const pruned = await pruneDeadEnvironmentConversations({
          sdk: core40SDK, extensionSDK, userId: userIdRef.current || userId, deadEnvironmentId: targetEnvId,
        }).catch(() => [] as string[])
        if (pruned.length > 0) {
          const pSet = new Set(pruned)
          setConversations((prev) => prev.filter((c) => !pSet.has(c.id)), { optimisticEntry: null })
          if (pSet.has(activeConversationIdRef.current)) { onResetAppStateRef.current?.(); setExpiredConversationNotice('This conversation expired because its sandbox environment was reset or expired.') }
        }
        await handleWakeModeEnv('app', true)
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
  }, [activeConversationIdRef, auth.sharedEnvironmentId, clearEnvNotices, core40SDK, extensionSDK, flashEnvNotice, getAuthCfg, handleWakeModeEnv, hasInFlightTurns, resetOAuthOnUnauthorized, selectedModel, setConversations, setExpiredConversationNotice, setMessages, sharedEnvIdRef, syncSharedEnvironmentId, userId, userIdRef])

  const handleResetEnvironment = useCallback((): Promise<void> => {
    setResetEnvModalOpen(false); clearEnvNotices()
    const uid = userIdRef.current || userId, ns = getArtifactNamespace(extensionSDK)
    const priorConvIds = Array.from(new Set([...conversationsRef.current.map((c) => c.id), ...Array.from(inFlightTurnsRef.current.keys())]))
    conversationsRef.current = []
    clearAllEnvSessions('resetting')
    const resetEpoch = envLifecycleEpochRef.current
    auth.queuedPromptsByConvIdRef.current = {}
    updateQueuedPrompts(() => [])
    setConversations([], { optimisticEntry: null })
    onResetAppStateRef.current?.()
    wakeContextRef.current = { agentSession: { environmentId: '' }, selectedExplores: [], schemaMarkdown: '', currentAppCode: '' }
    onClearSandboxFileCacheRef.current?.()
    clearAllConvMessages(); clearLookmlSessionCache(); clearHealthCheckSessionCache(); clearSessionAlertCache()
    sharedEnvExploreSchemas.clear(); inFlightEnvProvisionByUser.clear()
    const finish = () => {
      if (envLifecycleEpochRef.current !== resetEpoch) return
      environmentStatusRef.current = 'active'; setEnvironmentStatus('active'); flashEnvNotice('reset')
    }
    return Promise.all([
      uid ? clearAllUserConversations(core40SDK, uid, ns, priorConvIds).catch(() => {}) : Promise.resolve(),
      saveUserEnvironmentId(core40SDK, uid, '', ns).catch(() => {}),
    ])
      .then(() => (envLifecycleEpochRef.current === resetEpoch ? handleWakeModeEnv('app', true) : undefined))
      .then(finish, (err) => { finish(); throw err })
  }, [auth.queuedPromptsByConvIdRef, clearAllConvMessages, clearAllEnvSessions, clearEnvNotices, conversationsRef, core40SDK, extensionSDK, flashEnvNotice, handleWakeModeEnv, inFlightTurnsRef, setConversations, updateQueuedPrompts, userId, userIdRef])

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
    if (fgAtStart) selectEpochRef.current += 1
    if (fgAtStart && activeConversationIdRef.current !== convId) {
      lastSeenConvIdRef.current = convId
      setActiveConversationId(convId)
    }
    const isFg = () => activeConversationIdRef.current === convId
    const existingConv = resumeConv || conversationsRef.current.find((c) => c.id === convId)
    const authCfg = getAuthCfg()
    let rawResumeMsgs = resumeConv ? mergeCachedActivitySteps(getConvMessages(resumeConv.id)) : []
    let turnRootId = resumeConv ? (resumeConv.turnInteractionIds?.slice(-1)[0]?.[0] || '') : ''
    let recoveredResumePrompt = ''
    if (resumeConv && resumeConv.interactionId && (rawResumeMsgs.length === 0 || !turnRootId)) {
      if (rawResumeMsgs.length === 0 && resumeConv.turnInteractionIds?.length) {
        const hyd = await hydrateRemoteConversationMessages({ extensionSDK, auth: authCfg, sdk: core40SDK, userId, conv: resumeConv, activeEnvironmentId: sharedEnvIdRef.current }).catch(() => null)
        if (hyd?.messages.length) rawResumeMsgs = mergeCachedActivitySteps(hyd.messages as ChatMessage[])
      }
      const rec = await recoverInFlightInteraction({ extensionSDK, auth: authCfg, interactionId: resumeConv.interactionId }).catch(() => null)
      if (rec?.rootInteractionId) turnRootId = rec.rootInteractionId
      if (rec?.userPrompt) recoveredResumePrompt = rec.userPrompt
    }
    const lastResumeIsUser = rawResumeMsgs[rawResumeMsgs.length - 1]?.role === 'user'
    const effectivePrompt = resumeConv
      ? recoveredResumePrompt || (lastResumeIsUser ? rawResumeMsgs[rawResumeMsgs.length - 1]?.text : '') || resumeConv.label || 'Continue request'
      : text || 'See the attached screenshot.'
    const currentMessages: ChatMessage[] = resumeConv
      ? (lastResumeIsUser ? rawResumeMsgs.slice(0, -1) : rawResumeMsgs)
      : fgAtStart
      ? messagesRef.current
      : getConvMessages(convId)
    const isFirstTurn = currentMessages.filter((m) => m.role === 'user').length === 0
    const userMsg: ChatMessage = { role: 'user', text: effectivePrompt, images: attachedImages.map((img) => img.dataUrl) }
    const messagesWithUser: ChatMessage[] = resumeConv && lastResumeIsUser ? rawResumeMsgs : [...currentMessages, userMsg]
    setConvMessages(convId, messagesWithUser)
    if (!typedOverride) { setPrompt(''); setPastedImages([]); setMentionedItems([]) }
    if (environmentStatusRef.current === 'stopped') { environmentStatusRef.current = 'active'; setEnvironmentStatus('active') }

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
      id: convId, type: existingConv?.type || 'app',
      label: existingConv?.label || sanitizeConversationLabel('', effectivePrompt),
      inFlight: true, explores: snapExplores.length ? snapExplores : existingConv?.explores,
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
        effectivePrompt, mentionsToHydrate, resumeConv, core40SDK, extensionSDK, auth: authCfg, userId,
        activeEnvironmentId: sharedEnvIdRef.current || currentSession.environmentId, conversations, snapExplores,
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
      const hasActiveScriptTab = Boolean((fgAtStart && loadedScript) || snapshot.contentItems.some((it) => it.contentType === 'script' && !it.hidden))
      const result = await runAntigravityTurn({
        sdk: core40SDK, extensionSDK, userId,
        environmentId: sharedEnvIdRef.current || currentSession.environmentId,
        conversationId: convId, onEnvironmentUpdated: syncSharedEnvironmentId,
        auth: authCfg, session: currentSession,
        model: selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds,
        selectedExplores: turnExplores, folderId: snapshot.selectedFolderId,
        lookmlProjectId: snapshot.lookmlProjectId, activatedLookmlSkills: turnActivatedSkills,
        developableProjects: canDevelopLookml ? availableLookmlProjects : [],
        canDevelop: canDevelopLookml, canDeploy: canDevelopLookml && canDeployLookml, warmEnvironmentInBackground: true,
        schemaMarkdown: turnSchemaMarkdown,
        userPrompt: hasActiveScriptTab
          ? `${turnPromptWithContext}\n\nActive Script (\`${snapshot.scriptId}\`):\n\`\`\`python\n${snapshot.scriptCode}\n\`\`\``
          : turnPromptWithContext,
        rawUserPrompt: effectivePrompt,
        images: attachedImages, existingAppCode: snapshot.currentAppCode || undefined,
        existingPublishedApp: snapshot.publishedApp ? { dashboardId: snapshot.publishedApp.dashboardId, title: snapshot.publishedApp.title } : null,
        existingNativeContent: snapshot.nativeContent, extraSources: turnExtraSources,
        priorMessages: currentMessages, requirePermission: true,
        approvedOperations: turnApprovedOps, onPermissionRequest: turnPermRequest,
        onProgressSteps: (steps) => setConvLiveSteps(convId, steps),
        onInteractionCreated: (id) => {
          recoveredInFlightIdsRef.current.add(id)
          if (abortController.signal.aborted || isUserConversationDeleted(core40SDK, userId, convId, getArtifactNamespace(extensionSDK))) return
          if (!turnRootId) turnRootId = id
          latestTurnInteractionRef.current = { convId, id }
          const prevConv = conversationsRef.current.find((c) => c.id === convId) || inFlightEntry
          const updatedInFlightEntry: UserConversationEntry = Object.assign({}, prevConv, {
            inFlight: true, interactionId: id, environmentId: sharedEnvIdRef.current || currentSession.environmentId,
            turnInteractionIds: mergeTurnInteractionIds(prevConv.turnInteractionIds, [[turnRootId, id]]),
            updatedAt: new Date().toISOString(),
          })
          setConversations((prev) => [updatedInFlightEntry, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: updatedInFlightEntry })
          if (userId) void saveUserConversation(core40SDK, userId, updatedInFlightEntry, getArtifactNamespace(extensionSDK)).catch(() => {})
        },
        resumeInteractionId: resumeConv?.interactionId, signal: abortController.signal, onStatus: (s) => setConvBusyStatus(convId, s),
      })
      if (abortController.signal.aborted) return

      const finalRootId = result.rootInteractionId || turnRootId || result.session.lastInteractionId || ''
      const mergedTurnPairs = mergeTurnInteractionIds(
        existingConv?.turnInteractionIds,
        finalRootId && result.session.lastInteractionId ? [[finalRootId, result.session.lastInteractionId]] : undefined
      )
      if (!resumeConv && result.caSelection && !disabledModes.includes('app')) {
        await handleRunConversationalAnalytics(effectivePrompt, messagesWithUser, result.rawOutputText ?? result.assistantText, convId)
        return
      }
      let convType: string = existingConv?.type || 'app', convTitle = '', convExplores = turnExplores
      let convContent: Record<string, unknown> | undefined = existingConv?.content ? Object.assign({}, existingConv.content) : undefined
      let effectivePublishedApp = snapshot.publishedApp
      let effectiveNativeContent = snapshot.nativeContent
      const recordTurnDenial = (denyText: string, typeArg: string, exploresArg: string[], contentArg?: Record<string, unknown>) => {
        const errMsgs: ChatMessage[] = [...messagesWithUser, { role: 'error', text: denyText }]
        turnEntry.snapshot.messagesWithUser = errMsgs
        if (isFg()) {
          setAgentSession(Object.assign({}, result.session, { conversationId: convId, explores: exploresArg }))
          setMessages(errMsgs)
          hydratedConvRouteRef.current = `/c/${encodeURIComponent(convId)}:${convId}`
        }
        void persistConversationAndLabel({
          id: convId, type: typeArg, interactionId: result.session.lastInteractionId, environmentId: result.session.environmentId,
          turnInteractionIds: mergedTurnPairs,
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
        recordTurnDenial(result.permissionError, convType, turnExplores, convContent)
        return
      }

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
        if (gate !== 'allowed') { recordTurnDenial(gate, 'app', turnExplores, convContent); return }
      }

      const mat = await materializeTurnBundles({
        sdk: core40SDK, extensionSDK, userId, result,
        folderId: snapshot.selectedFolderId, turnExplores, itemState,
        existingPublishedApp: effectivePublishedApp, existingNativeContent: effectiveNativeContent,
        existingLookmlBundle: snapshot.lookmlBundle, existingLookmlProjectId: snapshot.lookmlProjectId,
        initialConvType: convType, initialConvContent: convContent,
        requirePermission: false,
        signal: abortController.signal, onStatus: (s) => setConvBusyStatus(convId, s),
        onItemUpserted: () => { turnEntry.snapshot.contentItems = itemState.items; turnEntry.snapshot.activeContentTabKey = itemState.activeKey },
        onLookmlSaved: (mergedBundle, lookmlId, rawLookmlItem) => {
          turnEntry.snapshot.lookmlBundle = mergedBundle; turnEntry.snapshot.lookmlProjectId = lookmlId
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
          turnEntry.snapshot.nativeContent = savedNative
          if (isFg()) {
            lastNativeIdRef.current = savedNative.id
            setNativeContent(savedNative, { source: isExistingNative ? 'modified' : 'created', createdInConversation: true, hidden: false })
            setEmbedNonce((n) => n + 1); setActiveObjectId(savedNative.id)
          }
        },
        onAlertSaved: (savedAlert, alertId, rawAlertItem) => {
          turnEntry.snapshot.alertBundle = savedAlert
          if (isFg()) { setAlertBundle(savedAlert); upsertContentItem(rawAlertItem); setActiveObjectId(alertId) }
        },
        onDataAppSaved: (upserted, appContentType, isExistingApp) => {
          turnEntry.snapshot.publishedApp = upserted
          turnEntry.snapshot.currentAppCode = result.bundle?.raw_code || ''
          if (isFg()) {
            lastPublishedIdRef.current = upserted.dashboardId
            setPublishedApp(upserted, { contentType: appContentType, source: isExistingApp ? 'modified' : 'created', createdInConversation: true, hidden: false })
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
      let { handledArtifact } = mat
      const { studioMeta, finalDashId, finalWidgetCount, deliveredContentLink } = mat

      if (result.tddMarkdown && !disabledModes.includes('health')) {
        handledArtifact = true
        const repId = healthReport?.id || `hc_${Date.now().toString(36)}`
        const repTitle = result.tddMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '3-Pillar Looker & BigQuery Health Check'
        const isExistingRep = itemState.items.some((it) => it.key === `report:${repId}`)
        const repPayload: HealthCheckReportPayload = {
          id: repId, type: 'health_check', title: repTitle,
          projectId: snapshot.lookmlProjectId || availableLookmlProjects[0] || 'thelook',
          connectionName: 'bigquery',
          scores: healthReport?.scores || { pillar1Score: 85, pillar2Score: 85, pillar3Score: 85, overallScore: 85, grade: 'B', transcriberScore: 3.4, transcriberClass: 'Class B' },
          tddMarkdown: result.tddMarkdown, telemetry: healthReport?.telemetry || {},
          lastInteractionId: result.session.lastInteractionId, environmentId: result.session.environmentId,
          updatedAt: new Date().toISOString(), createdBy: userId,
        }
        await saveHealthCheckArtifact(core40SDK, extensionSDK, userId, repPayload).catch(() => {})
        if (abortController.signal.aborted) return
        const repRaw = { id: repId, reportId: repId, contentType: 'report' as const, title: repTitle, embedPath: `/health-check/${encodeURIComponent(repId)}`, updatedAt: repPayload.updatedAt, source: (isExistingRep ? 'modified' : 'created') as 'modified' | 'created', createdInConversation: true, hidden: false }
        const upRep = syncLocalItem(repRaw)
        if (isFg()) { lastHealthIdRef.current = repId; setHealthReport(repPayload); upsertContentItem(repRaw); setActiveObjectId(repId) }
        recordCrudItem(toTurnCrudItem(upRep, isExistingRep ? 'updated' : 'created'))
        convType = 'health-check'; convTitle = repTitle
        convContent = Object.assign({}, convContent, { reportId: repId, projectId: repPayload.projectId, overallScore: repPayload.scores.overallScore })
      }

      const isExplicitScriptRequest = hasActiveScriptTab || EXPLICIT_SCRIPT_CREATION_RE.test(effectivePrompt)
      const pyMatch = (result.assistantText || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
      const extractedPy = pyMatch ? pyMatch[1].trim() : ''

      if (!handledArtifact && deletedIds.size === 0) {
        if (isExplicitScriptRequest && (extractedPy || hasActiveScriptTab) && !disabledModes.includes('tile')) {
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
            { convId, targetExplores: effectiveExplores, targetFolderId: snapshot.selectedFolderId }
          )
          if (abortController.signal.aborted) return
          if (pyOut.includes('PermissionError:')) {
            const denyErr = pyOut.match(/PermissionError:[^\n"]+/)?.[0] || 'PermissionError: Script execution mutates Looker state and was not approved.'
            recordTurnDenial(denyErr, 'tile', effectiveExplores)
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
            handledArtifact = true
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
          convType = existingConv?.type || 'app'
          convContent = { dashboardId: effectivePublishedApp.dashboardId, appArtifactId: `obj_app_${effectivePublishedApp.dashboardId}` }
        } else if (effectiveNativeContent) {
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
        }
      }

      const isAlertQuery = LOOKER_ALERT_QUERY_RE.test(effectivePrompt) || turnActivatedSkills.includes('looker-alerts') || promptSlashSkills.includes('looker-audit')
      let finalAssistantText = result.assistantText || ''
      if (
        !handledArtifact &&
        isLookerInstanceMetadataQuery(effectivePrompt) &&
        shouldOfferReusableScriptPrompt({
          isExplicitScriptRequest, isAlertQuery, effectivePrompt, baseReply: finalAssistantText,
          activitySteps: result.activitySteps, crudItemsCount: turnCrudItems.length,
        })
      ) {
        finalAssistantText = `${finalAssistantText}\n\nWould you like me to save this Looker API lookup as a reusable **Script**?`
      }
      if (deliveredContentLink && !finalAssistantText.includes(deliveredContentLink.path)) {
        finalAssistantText = `${finalAssistantText.trimEnd()}\n\n**${deliveredContentLink.label}:** [Open ${deliveredContentLink.title}](${deliveredContentLink.path})`
      } else if (/\b(?:where(?:'s|\s+is|\s+the)?\s+(?:the\s+)?(?:link|url|dashboard|look)|give\s+me\s+the\s+(?:full\s+)?(?:link|url)|link\s+to\s+the\s+(?:content|dashboard|app|look))\b/i.test(effectivePrompt)) {
        if (effectivePublishedApp?.dashboardId) {
          const p = `/dashboards/${encodeURIComponent(String(effectivePublishedApp.dashboardId))}`
          if (!finalAssistantText.includes(p)) finalAssistantText = `${finalAssistantText.trimEnd()}\n\n**Looker Dashboard:** [Open ${effectivePublishedApp.title || 'Data App Dashboard'}](${p})`
        } else if (effectiveNativeContent?.id) {
          const nCt = effectiveNativeContent.contentType || 'dashboard'
          const p = nCt === 'look'
            ? `/looks/${encodeURIComponent(String(effectiveNativeContent.lookId || effectiveNativeContent.id))}`
            : nCt === 'board'
            ? `/boards/${encodeURIComponent(String(effectiveNativeContent.id))}`
            : `/dashboards/${nCt === 'lookml_dashboard' ? String(effectiveNativeContent.lookmlDashboardId || effectiveNativeContent.id) : encodeURIComponent(String(effectiveNativeContent.id))}`
          if (!finalAssistantText.includes(p)) finalAssistantText = `${finalAssistantText.trimEnd()}\n\n**Looker ${nCt === 'look' ? 'Look' : nCt === 'board' ? 'Board' : 'Dashboard'}:** [Open ${effectiveNativeContent.title || effectiveNativeContent.id}](${p})`
        }
      } else if (
        !handledArtifact && !effectivePublishedApp && !effectiveNativeContent && itemState.items.length === 0 &&
        /\bis\s+live\s+and\s+ready\s+in\s+the\s+right\s+pane\b/i.test(finalAssistantText)
      ) {
        finalAssistantText = `${finalAssistantText.replace(/\s*is\s+live\s+and\s+ready\s+in\s+the\s+right\s+pane!?/gi, '')}\n\n*(Note: No Looker dashboard or artifact has been published in this conversation yet.)*`
      }

      const finalMsgs: ChatMessage[] = [
        ...messagesWithUser,
        Object.assign(
          { role: 'assistant' as const, text: finalAssistantText, interactionId: result.session.lastInteractionId, activitySteps: result.activitySteps, thinkingDurationSec: result.thinkingDurationSec },
          finalDashId ? { dashboardId: finalDashId } : null,
          finalWidgetCount !== undefined ? { widgetCount: finalWidgetCount } : null,
          turnCrudItems.length > 0 ? { crudItems: turnCrudItems } : null
        ),
      ]
      if (isFg()) {
        setAgentSession(Object.assign({}, result.session, { conversationId: convId, explores: effectiveExplores }))
        setMessages(finalMsgs)
      }

      turnEntry.snapshot.messagesWithUser = finalMsgs
      if (result.session.lastInteractionId) {
        recoveredInFlightIdsRef.current.add(result.session.lastInteractionId)
        if (result.activitySteps?.length) activityStepsByInteractionIdRef.current[result.session.lastInteractionId] = result.activitySteps
      }
      if (isFg()) {
        setActiveConversationId(convId)
        const nextConvRoute = `/c/${encodeURIComponent(convId)}`
        hydratedConvRouteRef.current = `${nextConvRoute}:${convId}`
        if (location.pathname !== nextConvRoute) history.replace(nextConvRoute)
      }

      await persistConversationAndLabel({
        id: convId, type: convType, interactionId: result.session.lastInteractionId, environmentId: result.session.environmentId,
        turnInteractionIds: mergedTurnPairs, label: isFirstTurn ? convTitle || sanitizeConversationLabel('', effectivePrompt) : undefined,
        explores: convExplores, content: convContent, contentItems: itemState.items, activeContentTabKey: itemState.activeKey,
        messages: finalMsgs, isFirstTurn, userPrompt: effectivePrompt, assistantText: finalMsgs[finalMsgs.length - 1]?.text || result.assistantText,
      })
      if (!abortController.signal.aborted && isFg()) setMessages(finalMsgs)
    } catch (err: unknown) {
      if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
      const errMsgs: ChatMessage[] = [...messagesWithUser, { role: 'error', text: resetOAuthOnUnauthorized(err) }]
      setConvMessages(convId, errMsgs)
      if (isFg()) setMessages(errMsgs)
      else {
        const ns = getArtifactNamespace(extensionSDK)
        if (!isUserConversationDeleted(core40SDK, userId, convId, ns)) {
          const failedConv: UserConversationEntry = Object.assign({}, conversationsRef.current.find((c) => c.id === convId) || inFlightEntry, {
            inFlight: false, updatedAt: new Date().toISOString(),
          })
          setConversations((prev) => [failedConv, ...prev.filter((c) => c.id !== convId)], { optimisticEntry: failedConv })
          if (userId) void saveUserConversation(core40SDK, userId, failedConv, ns).catch(() => {})
        }
      }
    } finally {
      if (!abortController.signal.aborted) {
        clearInFlightConvId(convId)
        finishTurnEntry(convId, abortController)
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
