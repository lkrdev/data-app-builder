import { useCallback, useEffect, useRef } from 'react'

import {
  cleanLookmlProjectId, generateConversationLabel, hydrateRemoteConversationMessages,
  LkrCodeMode, normalizeEnvironmentId, PastedImage, recoverInFlightInteraction, runAntigravityTurn,
  synthesizeCaConversationMessages,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import { HEALTH_CHECK_SYSTEM_GUIDE, loadHealthCheckArtifact, runThreePillarHealthCheckViaCodeMode, saveHealthCheckArtifact, THREE_PILLAR_CODEMODE_PY } from './healthCheck'
import type { LkrCodeModeRunOptions } from './lkrCliBridge'
import {
  CaConversationState, clearInFlightConvId, ConversationRecord, createLookerCaConversation, extractExploreIdsFromCode,
  formatExploreId, getArtifactNamespace, getConvTargetId, hydrateConversationContentItems, isLookmlTargetAlreadyLoaded, isUserConversationDeleted, listLocalDraftScripts,
  loadAlertArtifact, loadExistingDashboardApp, loadLocalDraftScript, loadNativeContentById, loadObjectArtifact, loadScriptArtifact,
  normalizeConversationTags, publishScriptDashboard, readInFlightConvId, readInFlightConvIds, resolveCaEmbedPath, ResolvedStudioUseCase, SavedScript, saveLocalDraftScript,
  saveUserConversation, selectCaAgentViaIsolatedSubagent, STUDIO_OVERVIEW_TAB_KEY, StudioContentItem,
  toTurnCrudItem, upsertStudioContentItem, UserConversationEntry,
} from './lookerApi'
import { loadLookmlSessionArtifact } from './lookmlTool'
import { getErrorMessage, normalizeCatalogMode, StudioAuthAndPrefs } from './studioControllerAuth'
import { nextStudioConvId } from './studioControllerConcurrency'
import { StudioMetadata, StudioViewerDocument } from './studioControllerMetadata'

export { getConvTargetId, STUDIO_OVERVIEW_TAB_KEY }
export type { StudioViewerDocument }

interface StoredCaArtifactPayload extends Partial<CaConversationState> {
  agent_id?: string; agent_name?: string; lastInteractionId?: string; routingRationale?: string; initialQuestion?: string
  studio?: { lastInteractionId?: string; messages?: ChatMessage[] }; messages?: ChatMessage[]
}

export function useStudioLoaders(auth: StudioAuthAndPrefs, meta: StudioMetadata) {
  const {
    extensionSDK, core40SDK, extHostData, history, location, isTileMount, mockExt, authMode, oauthToken, oauthTokenRef,
    selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds, isConfigured, disabledModes, resolvedUseCaseByIdRef,
    parsedRoute, setSelectedUseCase, explicitUseCaseRef, sharedEnvIdRef, syncSharedEnvironmentId, setAgentSession, setMessages,
    getAuthCfg, getConvMessages, setConvMessages, deleteConvMessages, setExpiredConversationNotice,
    busyStatus, setBusyStatus, setConvBusyStatus, inFlightTurnsRef, convLabelsRef, turnResumerRef, registerTurnEntry, finishTurnEntry,
    resetOAuthOnUnauthorized, activeConversationId, activeConversationIdRef, setActiveConversationId,
  } = auth
  const {
    userId, availableLookmlProjects, selectedExplores, setSelectedExplores, selectedFolderId, setSelectedFolderId,
    schemaMarkdown, inferredRouteUseCase, activeMode, agentSession, messages, catalogItems, activeObjectId, setActiveObjectId,
    conversations, conversationsRef, setConversations, savedScripts, setSavedScripts, healthScope, caConversation, setCaConversation,
    lastCaIdRef, isCaMode, lookmlProjectId, setLookmlProjectId, lookmlBundle, setLookmlBundle, lastLookmlIdRef, publishedApp,
    setPublishedApp, lastPublishedIdRef, nativeContent, setNativeContent, lastNativeIdRef, alertBundle, setAlertBundle, contentItemsRef,
    setContentItems, activeContentTabKeyRef, setActiveContentTabKey, upsertContentItem, healthReport, setHealthReport,
    lastHealthIdRef, scriptId, setScriptId, scriptTitle, setScriptTitle, scriptCode, setScriptCode, filtersJson, setScriptOutput,
    scriptMode, publishedTileDash, setPublishedTileDash, loadedScript, setLoadedScript, lastScriptIdRef, currentAppCode, setCurrentAppCode,
    hydratedConvRouteRef, activityStepsByInteractionIdRef, mergeCachedActivitySteps, codeModePermOptsRef,
  } = meta
  const recoveredInFlightIdsRef = useRef<Set<string>>(new Set())

  const runWithBusy = useCallback((statusText: string, errPrefix: string, fn: () => Promise<unknown>, targetConvId?: string) => {
    const loadConvId = targetConvId || activeConversationIdRef.current
    setConvBusyStatus(loadConvId, statusText)
    return Promise.resolve().then(fn).then(
      () => { setConvBusyStatus(loadConvId, mockExt?.initialBusyStatus || null) },
      (err: unknown) => {
        setConvBusyStatus(loadConvId, mockExt?.initialBusyStatus || null)
        if (activeConversationIdRef.current === loadConvId) setMessages((prev) => [...prev, { role: 'error', text: `${errPrefix}: ${getErrorMessage(err)}` }])
      }
    )
  }, [activeConversationIdRef, mockExt?.initialBusyStatus, setConvBusyStatus, setMessages])

  const hydrateLoadedArtifact = useCallback((opts: {
    mode: StudioMode; id: string; route: string; pushRoute: boolean; convTypes: string[]; convId?: string; explores?: string[]
    studio?: { explores?: string[]; messages?: unknown[]; lastInteractionId?: string; environmentId?: string; lastSession?: { lastInteractionId?: string; environmentId?: string } } | null
    lastInteractionId?: string; environmentId?: string; defaultEnvId: string; messages?: ChatMessage[]; fallbackText: string; dashboardId?: string
  }) => {
    const matchedConv = conversationsRef.current.find((c) => {
      if (opts.convId && c.id === opts.convId) return true
      if (!opts.pushRoute && c.id === activeConversationIdRef.current) return true
      return (getConvTargetId(c.content, c.type) === opts.id || (opts.mode === 'lookml' && c.content?.sessionId === opts.id)) && opts.convTypes.includes(c.type)
    })
    const explores = opts.explores ?? opts.studio?.explores?.filter(Boolean) ?? matchedConv?.explores
    const convMsgs = getConvMessages(matchedConv?.id || opts.convId || (!opts.pushRoute ? activeConversationIdRef.current : '') || '')
    const msgs = (convMsgs.length ? convMsgs : undefined) ?? opts.messages ?? (opts.studio?.messages as ChatMessage[] | undefined)
    if (matchedConv) {
      hydrateConversationContentItems(matchedConv).forEach((item) => upsertContentItem(item, false))
      if (matchedConv.activeContentTabKey && matchedConv.activeContentTabKey !== 'lookml:default') setActiveContentTabKey(matchedConv.activeContentTabKey)
    }
    setActiveObjectId(opts.id)
    setActiveConversationId((prev) => {
      if (opts.convId) return opts.convId
      if (matchedConv) return matchedConv.id
      if (!opts.pushRoute && prev.startsWith('conv_')) return prev
      const prefix = `conv_${opts.mode}_`
      return prev.startsWith(prefix) ? prev : `${prefix}${opts.id}`
    })
    if (explores && explores.length > 0) setSelectedExplores(explores)
    setAgentSession({
      lastInteractionId: matchedConv?.interactionId || opts.lastInteractionId || opts.studio?.lastInteractionId || opts.studio?.lastSession?.lastInteractionId,
      environmentId: sharedEnvIdRef.current || matchedConv?.environmentId || opts.environmentId || opts.studio?.environmentId || opts.studio?.lastSession?.environmentId || opts.defaultEnvId,
      conversationId: opts.convId || matchedConv?.id || activeConversationIdRef.current || opts.id, explores, toolType: opts.mode,
    }, opts.mode)
    if (msgs?.length) setMessages(mergeCachedActivitySteps(msgs))
    else if (!(matchedConv && activeConversationIdRef.current === matchedConv.id && auth.messagesRef.current.some((m) => m.role === 'user'))) {
      setMessages([{ role: 'assistant', text: opts.fallbackText, ...(opts.dashboardId ? { dashboardId: opts.dashboardId } : {}) }])
    }
    if (opts.pushRoute && location.pathname !== opts.route) history.replace(opts.route)
  }, [activeConversationIdRef, auth.messagesRef, conversationsRef, getConvMessages, history, location.pathname, mergeCachedActivitySteps, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setAgentSession, setMessages, setSelectedExplores, sharedEnvIdRef, upsertContentItem])

  const persistConversationAndLabel = useCallback(
    (opts: {
      id: string; type: string; interactionId?: string; environmentId?: string; label?: string; explores?: string[]
      tags?: string[]; inFlight?: boolean; turnInteractionIds?: Array<[string, string]>; caConversationId?: string
      content?: Record<string, unknown>; contentItems?: StudioContentItem[]; activeContentTabKey?: string
      messages: ChatMessage[]; isFirstTurn?: boolean; userPrompt?: string; assistantText?: string; updateArtifactIndex?: boolean
    }) => {
      opts.messages.forEach((m) => { if (m.role === 'assistant' && m.interactionId && m.activitySteps?.length) activityStepsByInteractionIdRef.current[m.interactionId] = m.activitySteps })
      setConvMessages(opts.id, opts.messages)
      const isFg = activeConversationIdRef.current === opts.id
      if (isFg) hydratedConvRouteRef.current = `/c/${encodeURIComponent(opts.id)}:${opts.id}`
      const namespace = getArtifactNamespace(extensionSDK)
      if (isUserConversationDeleted(core40SDK, userId, opts.id, namespace)) return Promise.resolve()
      const hasDeletedCrud = opts.messages.some((m) => m.crudItems?.some((x) => x.action === 'deleted'))
      const items = opts.contentItems !== undefined ? opts.contentItems : (isFg ? contentItemsRef.current : undefined)
      const rawTabKey = opts.activeContentTabKey !== undefined ? opts.activeContentTabKey : (isFg ? activeContentTabKeyRef.current : '')
      const persistedTabKey = rawTabKey === STUDIO_OVERVIEW_TAB_KEY ? '' : rawTabKey
      const shouldPersistTabKey = Boolean(persistedTabKey) || opts.activeContentTabKey !== undefined || hasDeletedCrud
      const tags = normalizeConversationTags(opts.tags, opts.explores, (items || []).map((i) => i.contentType), opts.type)
      const baseConv = {
        id: opts.id, type: opts.type, interactionId: opts.interactionId, environmentId: opts.environmentId,
        inFlight: opts.inFlight ?? false, explores: opts.explores,
        ...(tags?.length ? { tags } : {}),
        ...(opts.turnInteractionIds?.length ? { turnInteractionIds: opts.turnInteractionIds } : {}),
        ...(opts.caConversationId ? { caConversationId: opts.caConversationId } : {}),
        ...(opts.content ? { content: opts.content } : {}),
        ...(items && (items.length > 0 || hasDeletedCrud)
          ? { contentItems: items, ...(shouldPersistTabKey ? { activeContentTabKey: persistedTabKey } : {}) }
          : shouldPersistTabKey ? { activeContentTabKey: persistedTabKey } : {}),
      }
      if (isFg) setActiveConversationId(opts.id)
      return saveUserConversation(core40SDK, userId, { ...baseConv, use_case: opts.type, ...(opts.label ? { label: opts.label } : {}), updatedAt: new Date().toISOString() }, namespace)
        .then((list) => { if (!isUserConversationDeleted(core40SDK, userId, opts.id, namespace)) setConversations(list, { optimisticEntry: null }) })
        .catch(() => {})
        .then(() => {
          if (!opts.isFirstTurn || !opts.userPrompt || !opts.assistantText || isUserConversationDeleted(core40SDK, userId, opts.id, namespace)) return
          void generateConversationLabel({ extensionSDK, auth: getAuthCfg(), environmentId: opts.environmentId, userPrompt: opts.userPrompt, assistantText: opts.assistantText, model: selectedModel })
            .then((label) => {
              if (!label || isUserConversationDeleted(core40SDK, userId, opts.id, namespace)) return
              const targetArtifactId = getConvTargetId(opts.content as ConversationRecord['content'], opts.type)
              convLabelsRef.current[opts.id] = label
              if (targetArtifactId) convLabelsRef.current[targetArtifactId] = label
              setCaConversation((prev) => (prev && (prev.id === opts.id || prev.id === targetArtifactId) ? { ...prev, label } : prev))
              return saveUserConversation(core40SDK, userId, { id: opts.id, type: opts.type, use_case: opts.type, label, updatedAt: new Date().toISOString() }, namespace)
                .then((list) => { if (!isUserConversationDeleted(core40SDK, userId, opts.id, namespace)) setConversations(list, { optimisticEntry: null }) })
                .catch(() => {})
            })
            .catch(() => {})
        })
    },
    [activeContentTabKeyRef, activeConversationIdRef, activityStepsByInteractionIdRef, contentItemsRef, convLabelsRef, core40SDK, extensionSDK, getAuthCfg, hydratedConvRouteRef, selectedModel, setActiveConversationId, setCaConversation, setConvMessages, setConversations, userId]
  )

  const loadDashboardById = useCallback((rawId: string, pushRoute = true) => {
    const id = rawId.trim()
    if (!id) return Promise.resolve()
    const loadConvId = activeConversationIdRef.current
    lastPublishedIdRef.current = id
    return runWithBusy(`Loading Data App from dashboard #${id}...`, `Could not load dashboard #${id}`, () =>
      loadExistingDashboardApp(core40SDK, id).then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId) return
        lastPublishedIdRef.current = loaded.dashboardId
        const targetUc: ResolvedStudioUseCase = resolvedUseCaseByIdRef.current[loaded.dashboardId] === 'data-investigator' ? 'data-investigator' : 'app'
        resolvedUseCaseByIdRef.current[loaded.dashboardId] = targetUc
        setSelectedUseCase(targetUc); setPublishedApp(loaded); setCurrentAppCode(loaded.code); setSelectedFolderId(loaded.folderId)
        const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
        const legacyExplore = loaded.studio?.modelName && loaded.studio?.exploreName ? [formatExploreId(loaded.studio.modelName, loaded.studio.exploreName)] : []
        const queryExplores = Array.from(new Set((loaded.manifestQueries || []).filter((q) => q.model && q.explore).map((q) => formatExploreId(q.model, q.explore))))
        const resolvedExplores = studioExplores.length > 0 ? studioExplores : legacyExplore.length > 0 ? legacyExplore : queryExplores.length > 0 ? queryExplores : extractExploreIdsFromCode(loaded.code)
        setSelectedExplores(resolvedExplores)
        hydrateLoadedArtifact({
          mode: 'app', id: loaded.dashboardId, route: `/c/${encodeURIComponent(loaded.dashboardId)}`,
          pushRoute, convTypes: ['app', 'data_app', 'data-investigator', 'data_investigator'], explores: resolvedExplores, studio: loaded.studio,
          defaultEnvId: 'env_app_42', dashboardId: loaded.dashboardId,
          fallbackText: `Loaded existing Data App "${loaded.title}" (Dashboard #${loaded.dashboardId}, ${loaded.code.length.toLocaleString()} bytes). Describe any changes to update it in place.`,
        })
      }), loadConvId)
  }, [activeConversationIdRef, core40SDK, hydrateLoadedArtifact, lastPublishedIdRef, resolvedUseCaseByIdRef, runWithBusy, setCurrentAppCode, setPublishedApp, setSelectedExplores, setSelectedFolderId, setSelectedUseCase])

  const loadNativeById = useCallback((rawId: string, pushRoute = true) => {
    const id = rawId.trim()
    if (!id) return Promise.resolve()
    const loadConvId = activeConversationIdRef.current
    lastNativeIdRef.current = id
    return runWithBusy(`Loading native Looker content #${id}...`, `Could not load native content #${id}`, () =>
      loadNativeContentById(core40SDK, extensionSDK, id).then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId) return
        lastNativeIdRef.current = loaded.id; resolvedUseCaseByIdRef.current[loaded.id] = 'dashboard'
        setSelectedUseCase('dashboard'); setNativeContent(loaded); setSelectedFolderId(loaded.folderId)
        hydrateLoadedArtifact({
          mode: 'dashboard', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['dashboard'], studio: loaded.studio, defaultEnvId: 'env_dashboard_7', dashboardId: loaded.id,
          fallbackText: `Loaded native Looker ${loaded.contentType} "${loaded.title}" (#${loaded.id}). Ask for tiles, filters, looks, boards, or schedules to update it via CodeMode.`,
        })
      }), loadConvId)
  }, [activeConversationIdRef, core40SDK, extensionSDK, hydrateLoadedArtifact, lastNativeIdRef, resolvedUseCaseByIdRef, runWithBusy, setNativeContent, setSelectedFolderId, setSelectedUseCase])

  const loadHealthCheckById = useCallback((rawId: string, pushRoute = true) => {
    const id = rawId.trim()
    if (!id) return Promise.resolve()
    const loadConvId = activeConversationIdRef.current
    const matchedConv = conversations.find((c) => c.id === loadConvId || getConvTargetId(c.content, c.type) === id)
    lastHealthIdRef.current = id
    return runWithBusy(`Loading Health Check report "${id}"...`, `Could not load Health Check "${id}"`, () =>
      loadHealthCheckArtifact(core40SDK, extensionSDK, id, {
        auth: getAuthCfg(), environmentId: matchedConv?.environmentId || sharedEnvIdRef.current,
        lastInteractionId: matchedConv?.interactionId, projectId: String(matchedConv?.content?.projectId || '') || undefined,
      }).then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId) return
        lastHealthIdRef.current = loaded.id; resolvedUseCaseByIdRef.current[loaded.id] = 'health-check'
        setSelectedUseCase('health-check'); setHealthReport(loaded)
        upsertContentItem({ id: String(loaded.id), reportId: String(loaded.id), contentType: 'report', title: loaded.title, embedPath: `/health-check/${encodeURIComponent(String(loaded.id))}`, updatedAt: loaded.updatedAt })
        hydrateLoadedArtifact({
          mode: 'health', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['health', 'health-check', 'health_check'], studio: loaded, defaultEnvId: `env_health_${loaded.id}`,
          fallbackText: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00).`,
        })
      }), loadConvId)
  }, [activeConversationIdRef, conversations, core40SDK, extensionSDK, getAuthCfg, hydrateLoadedArtifact, lastHealthIdRef, resolvedUseCaseByIdRef, runWithBusy, setHealthReport, setSelectedUseCase, sharedEnvIdRef, upsertContentItem])

  const loadLookmlSessionById = useCallback((rawId: string, pushRoute = true) => {
    const id = cleanLookmlProjectId(rawId)
    if (!id) return Promise.resolve()
    const loadConvId = activeConversationIdRef.current
    const matchedConv = conversations.find((c) => c.type === 'lookml' && (c.id === loadConvId || getConvTargetId(c.content, c.type) === id))
    lastLookmlIdRef.current = id
    return runWithBusy(`Loading LookML session "${id}"...`, `Could not load LookML session "${id}"`, () =>
      loadLookmlSessionArtifact(core40SDK, extensionSDK, id, matchedConv?.content?.sessionId, {
        auth: getAuthCfg(), environmentId: matchedConv?.environmentId || sharedEnvIdRef.current,
        lastInteractionId: matchedConv?.interactionId, explores: matchedConv?.explores,
      }).then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId) return
        const validProj = cleanLookmlProjectId(loaded.bundle?.project_id)
        const canonProj = validProj || cleanLookmlProjectId(loaded.id) || id
        lastLookmlIdRef.current = canonProj; resolvedUseCaseByIdRef.current[canonProj] = 'lookml'; resolvedUseCaseByIdRef.current[loaded.id] = 'lookml'
        setSelectedUseCase('lookml'); setLookmlBundle(loaded.bundle)
        if (validProj) setLookmlProjectId(validProj)
        setSelectedExplores(loaded.studio?.explores?.filter(Boolean) || [])
        upsertContentItem({ id: canonProj, sessionId: String(loaded.id), projectId: canonProj, contentType: 'lookml', title: `LookML: ${canonProj}`, embedPath: `/lookml/${encodeURIComponent(canonProj)}`, updatedAt: loaded.updatedAt })
        hydrateLoadedArtifact({
          mode: 'lookml', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['lookml'], studio: loaded.studio, defaultEnvId: `env_lookml_${loaded.id}`,
          fallbackText: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} .lkml files).`,
        })
      }), loadConvId)
  }, [activeConversationIdRef, conversations, core40SDK, extensionSDK, getAuthCfg, hydrateLoadedArtifact, lastLookmlIdRef, resolvedUseCaseByIdRef, runWithBusy, setLookmlBundle, setLookmlProjectId, setSelectedExplores, setSelectedUseCase, sharedEnvIdRef, upsertContentItem])

  const handleRunPython = useCallback((
    codeToRun = scriptCode, rawFilters = filtersJson,
    permOpts?: Pick<LkrCodeModeRunOptions, 'requirePermission' | 'approvedOperations' | 'onPermissionRequest' | 'thought' | 'signal'> & { isCanceled?: () => boolean },
    bgOpts?: { convId?: string; targetExplores?: string[]; targetFolderId?: string }
  ): Promise<string> => {
    const runConvId = bgOpts?.convId || activeConversationIdRef.current
    setConvBusyStatus(runConvId, 'Executing Looker queries...')
    let parsedFilters: Record<string, string> = {}
    try { parsedFilters = JSON.parse(rawFilters || '{}') } catch { parsedFilters = {} }
    const effectivePermOpts = permOpts || codeModePermOptsRef.current?.()
    const finish = (v: string) => {
      if (activeConversationIdRef.current === runConvId && !effectivePermOpts?.isCanceled?.()) setScriptOutput(v)
      if (!inFlightTurnsRef.current.has(runConvId)) setConvBusyStatus(runConvId, mockExt?.initialBusyStatus || null)
      return v
    }
    return LkrCodeMode.runPythonCode(Object.assign(
      {
        code: codeToRun, sdk: core40SDK, extensionSDK, conversationId: runConvId,
        vars: {
          mode: scriptMode, dashboard_filters: Object.assign({ script_mode: scriptMode }, parsedFilters),
          target_explores: bgOpts?.targetExplores ?? selectedExplores, target_folder_id: bgOpts?.targetFolderId ?? selectedFolderId,
        },
      },
      effectivePermOpts ? {
        requirePermission: effectivePermOpts.requirePermission, approvedOperations: effectivePermOpts.approvedOperations,
        onPermissionRequest: effectivePermOpts.onPermissionRequest, thought: effectivePermOpts.thought, signal: effectivePermOpts.signal,
      } : null
    )).then(finish, (err: unknown) => finish(JSON.stringify({ error: getErrorMessage(err) })))
  }, [activeConversationIdRef, codeModePermOptsRef, core40SDK, extensionSDK, filtersJson, inFlightTurnsRef, mockExt?.initialBusyStatus, scriptCode, scriptMode, selectedExplores, selectedFolderId, setConvBusyStatus, setScriptOutput])

  const loadAlertById = useCallback((rawId: string, _pushRoute = true): Promise<void> => {
    const id = String(rawId || '').trim().replace(/^obj_alert_/, '')
    if (!id) return Promise.resolve()
    const loadConvId = activeConversationIdRef.current
    resolvedUseCaseByIdRef.current[id] = 'tile'; setSelectedUseCase('tile')
    return loadAlertArtifact(core40SDK, id, getArtifactNamespace(extensionSDK)).then((loaded) => {
      if (activeConversationIdRef.current !== loadConvId || !loaded) return
      setAlertBundle(loaded)
      const alertTitle = String(loaded.custom_title || loaded.title || `Alert #${id}`)
      upsertContentItem({ id, alertId: id, dashboardId: loaded.dashboard_id ? String(loaded.dashboard_id) : undefined, contentType: 'alert', title: alertTitle, embedPath: `/alerts/${encodeURIComponent(id)}`, updatedAt: loaded.updated_at })
    }).catch(() => {})
  }, [activeConversationIdRef, core40SDK, extensionSDK, resolvedUseCaseByIdRef, setAlertBundle, setSelectedUseCase, upsertContentItem])

  const loadScriptById = useCallback((rawId: string, pushRoute = true): Promise<void> => {
    const id = rawId.trim()
    if (!id) return Promise.resolve()
    const loadConvId = activeConversationIdRef.current
    lastScriptIdRef.current = id; resolvedUseCaseByIdRef.current[id] = 'tile'
    setSelectedUseCase('tile'); setLoadedScript(true); setScriptId(id)
    return loadLocalDraftScript(id, extensionSDK)
      .then((local): Promise<SavedScript | null> | SavedScript => local || loadScriptArtifact(core40SDK, id, getArtifactNamespace(extensionSDK)))
      .then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId || lastScriptIdRef.current !== id) return
        const effectiveCode = loaded?.code || scriptCode
        if (loaded) {
          setScriptId(loaded.id); setScriptTitle(loaded.title || loaded.id); setScriptCode(loaded.code || DEFAULT_PYTHON_SCRIPT)
        }
        setPublishedTileDash(loaded?.dashboardId ? { dashboardId: loaded.dashboardId, elementId: loaded.elementId || '' } : null)
        const effectiveScriptId = loaded?.id || id
        upsertContentItem({ id: String(effectiveScriptId), scriptId: String(effectiveScriptId), contentType: 'script', title: loaded?.title || scriptTitle || effectiveScriptId, embedPath: `/tile/${encodeURIComponent(String(effectiveScriptId))}`, updatedAt: loaded?.updatedAt })
        hydrateLoadedArtifact({
          mode: 'tile', id: effectiveScriptId, route: `/c/${encodeURIComponent(effectiveScriptId)}`, pushRoute, convTypes: ['tile', 'script'], studio: null,
          defaultEnvId: 'env_tile_isolated',
          fallbackText: loaded ? `Loaded script "${loaded.title}" (${loaded.id}).` : `Opened Script "${scriptTitle}" (${id}).`,
        })
        return handleRunPython(effectiveCode, filtersJson).then(() => {})
      })
  }, [activeConversationIdRef, core40SDK, extensionSDK, filtersJson, handleRunPython, hydrateLoadedArtifact, lastScriptIdRef, resolvedUseCaseByIdRef, scriptCode, scriptTitle, setLoadedScript, setPublishedTileDash, setScriptCode, setScriptId, setScriptTitle, setSelectedUseCase, upsertContentItem])

  const handleSaveScript = useCallback(
    (
      overrideCode = scriptCode, _overrideMsgs?: ChatMessage[], explicitDashInfo?: { dashboardId: string; elementId: string } | null,
      bgOpts?: { convId?: string; scriptId?: string; scriptTitle?: string; baseItems?: StudioContentItem[] }
    ): Promise<SavedScript> => {
      const saveConvId = bgOpts?.convId || activeConversationIdRef.current
      const isFg = () => activeConversationIdRef.current === saveConvId
      const rawScriptId = bgOpts?.scriptId !== undefined ? bgOpts.scriptId : scriptId
      const rawScriptTitle = bgOpts?.scriptTitle !== undefined ? bgOpts.scriptTitle : scriptTitle
      const cleanId = rawScriptId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `script_${Date.now().toString(36).slice(-5)}`
      const priorSaved = savedScripts.find((s) => s.id === cleanId)
      const dashInfo =
        explicitDashInfo !== undefined
          ? (bgOpts?.scriptId === undefined || cleanId === lastScriptIdRef.current || Boolean(priorSaved?.dashboardId) ? explicitDashInfo : null)
          : cleanId === lastScriptIdRef.current
          ? publishedTileDash
          : priorSaved?.dashboardId
          ? { dashboardId: priorSaved.dashboardId, elementId: priorSaved.elementId || '' }
          : null
      setConvBusyStatus(saveConvId, `Saving draft script "${cleanId}"...`)
      const isExisting = (bgOpts?.baseItems ?? contentItemsRef.current).some((it) => it.key === `script:${cleanId}`)
      return saveLocalDraftScript({
        id: cleanId, title: rawScriptTitle.trim() || cleanId, code: overrideCode,
        ...(dashInfo?.dashboardId ? { dashboardId: dashInfo.dashboardId } : {}),
        ...(dashInfo?.elementId ? { elementId: dashInfo.elementId } : {}),
      }, extensionSDK).then(
        (saved) => listLocalDraftScripts(extensionSDK).then((list) => {
          resolvedUseCaseByIdRef.current[saved.id] = 'tile'
          setSavedScripts(list)
          if (isFg()) {
            lastScriptIdRef.current = saved.id
            setLoadedScript(true); setScriptId(saved.id); setScriptCode(saved.code)
            setPublishedTileDash(saved.dashboardId ? { dashboardId: saved.dashboardId, elementId: saved.elementId || '' } : null)
            upsertContentItem({
              id: String(saved.id), scriptId: String(saved.id), contentType: 'script',
              title: saved.title || saved.id, embedPath: `/tile/${encodeURIComponent(String(saved.id))}`,
              updatedAt: saved.updatedAt, source: isExisting ? 'modified' : 'created', createdInConversation: true, hidden: false,
            })
            if (location.pathname === '/') history.replace(`/c/${encodeURIComponent(saveConvId)}`)
          }
          if (!inFlightTurnsRef.current.has(saveConvId)) setConvBusyStatus(saveConvId, mockExt?.initialBusyStatus || null)
          return saved
        }),
        (err) => { if (!inFlightTurnsRef.current.has(saveConvId)) setConvBusyStatus(saveConvId, mockExt?.initialBusyStatus || null); throw err }
      )
    },
    [activeConversationIdRef, contentItemsRef, extensionSDK, history, inFlightTurnsRef, lastScriptIdRef, location.pathname, mockExt?.initialBusyStatus, publishedTileDash, resolvedUseCaseByIdRef, savedScripts, scriptCode, scriptId, scriptTitle, setConvBusyStatus, setLoadedScript, setPublishedTileDash, setSavedScripts, setScriptCode, setScriptId, upsertContentItem]
  )

  const handlePublishTileDashboard = useCallback(async () => {
    try {
      const saved = await handleSaveScript()
      setBusyStatus('Publishing extension-layout Looker dashboard & saving tile script...')
      const extId = extHostData?.extensionId || 'data_app_builder::data_app_builder'
      const pub = await publishScriptDashboard(core40SDK, {
        script: saved, folderId: selectedFolderId, extensionId: extId, existingDashboardId: saved.dashboardId,
      })
      const nextDash = { dashboardId: pub.dashboardId, elementId: pub.elementId }
      setPublishedTileDash(nextDash)
      const upDash = upsertContentItem({
        id: String(pub.dashboardId), dashboardId: String(pub.dashboardId), contentType: 'dashboard',
        title: saved.title || `Dashboard #${pub.dashboardId}`, embedPath: `/embed/dashboards/${encodeURIComponent(String(pub.dashboardId))}`,
        folderId: selectedFolderId, source: contentItemsRef.current.some((it) => it.key === `dashboard:${pub.dashboardId}`) ? 'modified' : 'created', createdInConversation: true,
      })
      await handleSaveScript(saved.code, undefined, nextDash)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Published Dashboard #${pub.dashboardId} (load_configuration="wait", show_dashboard_header=true, layout="extension") and saved script "${saved.id}" to dashboard_element.rich_content_json (#${pub.elementId}).`,
          dashboardId: pub.dashboardId, crudItems: [toTurnCrudItem(upDash, upDash.existed ? 'updated' : 'created')],
        },
      ])
    } catch (err: unknown) {
      setBusyStatus(mockExt?.initialBusyStatus || null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
    }
  }, [contentItemsRef, core40SDK, extHostData?.extensionId, handleSaveScript, mockExt?.initialBusyStatus, selectedFolderId, setBusyStatus, setMessages, setPublishedTileDash, upsertContentItem])

  const loadCaConversationById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      const loadConvId = activeConversationIdRef.current
      lastCaIdRef.current = id
      return runWithBusy(`Loading Conversational Analytics session "${id}"...`, `Could not load Conversational Analytics session "${id}"`, async () => {
        const convFromList = conversations.find((c) => c.id === id || c.caConversationId === id || String(c.content?.caConversationId || c.content?.id || '') === id)
        const loaded = convFromList?.content?.agentId
          ? null
          : await loadObjectArtifact<StoredCaArtifactPayload>(core40SDK, 'conversational-analytics', id, getArtifactNamespace(extensionSDK)).catch(() => null)
        if (activeConversationIdRef.current !== loadConvId) return
        const content: StoredCaArtifactPayload = (convFromList?.content as StoredCaArtifactPayload | undefined) || loaded || {}
        const agentId = String(content.agentId || content.agent_id || 'ad69f74cd9e2494090e9e9e9c50190c8')
        const agentName = String(content.agentName || content.agent_name || 'Looker CA Agent')
        const caConvId = String(content.caConversationId || convFromList?.caConversationId || content.id || id)
        const explores = Array.isArray(content.explores) ? content.explores : convFromList?.explores || []
        const resolvedTitle = String(content.title || content.label || convFromList?.label || id)
        const resolvedRationale = String(content.routingRationale || content.selectionRationale || content.rationale || `Routed to Looker CA agent "${agentName}" (${agentId}) via isolated sub-agent.`)
        const state: CaConversationState = {
          id: caConvId, caConversationId: caConvId, agentId, agentName,
          embedPath: content.embedPath || resolveCaEmbedPath(agentId, caConvId),
          title: resolvedTitle, label: resolvedTitle, rationale: resolvedRationale, selectionRationale: resolvedRationale,
          initialPrompt: String(content.initialQuestion || content.initialPrompt || content.title || convFromList?.label || id),
          explores, interactionId: content.studio?.lastInteractionId || content.lastInteractionId || convFromList?.interactionId,
          updatedAt: String(content.updatedAt || convFromList?.updatedAt || new Date().toISOString()),
        }
        lastCaIdRef.current = caConvId; resolvedUseCaseByIdRef.current[caConvId] = 'conversational-analytics'
        setCaConversation(state)
        upsertContentItem({ id: caConvId, contentType: 'conversational-analytics', title: state.title, embedPath: state.embedPath, updatedAt: state.updatedAt })
        setSelectedUseCase('conversational-analytics')
        const cachedMsgs = getConvMessages(convFromList?.id || caConvId)
        const legacyMsgs = content.studio?.messages || content.messages
        const msgs = cachedMsgs.length ? cachedMsgs : Array.isArray(legacyMsgs) && legacyMsgs.length ? legacyMsgs : synthesizeCaConversationMessages({
          id: convFromList?.id || caConvId, type: 'conversational-analytics', label: resolvedTitle, caConversationId: caConvId,
          interactionId: state.interactionId, content: { agentId, agentName, caConversationId: caConvId, routingRationale: resolvedRationale, initialQuestion: state.initialPrompt },
          updatedAt: state.updatedAt,
        })
        hydrateLoadedArtifact({
          mode: 'app', id: caConvId, route: `/c/${encodeURIComponent(caConvId)}`, pushRoute,
          convTypes: ['conversational-analytics'], convId: convFromList?.id || caConvId, explores,
          lastInteractionId: state.interactionId, defaultEnvId: 'env_app_isolated', messages: msgs, fallbackText: state.rationale,
        })
      }, loadConvId)
    },
    [activeConversationIdRef, conversations, core40SDK, extensionSDK, getConvMessages, hydrateLoadedArtifact, lastCaIdRef, resolvedUseCaseByIdRef, runWithBusy, setCaConversation, setSelectedUseCase, upsertContentItem]
  )

  const makeStandaloneSnap = (baseMsgs: ChatMessage[], baseItems: StudioContentItem[]) => ({
    selectedExplores, selectedFolderId, currentAppCode, nativeContent, publishedApp, lookmlProjectId, lookmlBundle, alertBundle,
    scriptCode, scriptId, scriptTitle, filtersJson, publishedTileDash, contentItems: baseItems, activeContentTabKey: activeContentTabKeyRef.current, messagesWithUser: baseMsgs,
  })

  const handleRunConversationalAnalytics = async (
    userQuestion: string, baseMessages: ChatMessage[], preselectedOutput?: string, existingConvId?: string
  ) => {
    const authCfg = getAuthCfg()
    const isFirstTurn = baseMessages.filter((m) => m.role === 'user').length <= 1
    const convId = existingConvId || activeConversationIdRef.current || nextStudioConvId()
    const isFg = () => activeConversationIdRef.current === convId
    const baseConvItems = isFg() ? contentItemsRef.current : hydrateConversationContentItems(conversations.find((c) => c.id === convId) || { id: convId, type: 'conversational-analytics', label: convId, updatedAt: '' })
    const ownEntry = !inFlightTurnsRef.current.has(convId) ? registerTurnEntry(convId, makeStandaloneSnap(baseMessages, baseConvItems), userQuestion) : null
    const sig = (ownEntry || inFlightTurnsRef.current.get(convId))?.abortController.signal
    try {
      if (!preselectedOutput && isFg()) { if (isFirstTurn) setContentItems((prev) => prev.filter((it) => it.createdInConversation === true)) }
      const selection = await selectCaAgentViaIsolatedSubagent({
        sdk: core40SDK, extensionSDK, auth: authCfg, userQuestion, preselectedOutput, model: selectedModel, onStatus: (s) => setConvBusyStatus(convId, s),
      })
      if (sig?.aborted) return
      setConvBusyStatus(convId, `Creating Looker CA conversation with "${selection.agentName}"...`)
      const created = await createLookerCaConversation(core40SDK, selection.agentId, userQuestion, selection.agentName)
      if (sig?.aborted) return
      const assistantText = `Routed via isolated CA sub-agent to **${selection.agentName}** (\`${selection.agentId}\`) and opened embedded Looker CA conversation \`${created.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${selection.rationale}`
      const nextCaState: CaConversationState = {
        id: created.caConversationId, caConversationId: created.caConversationId, agentId: selection.agentId, agentName: selection.agentName,
        embedPath: created.embedPath, title: created.label, label: created.label, rationale: selection.rationale, selectionRationale: selection.rationale,
        initialPrompt: userQuestion, explores: selection.explores.length > 0 ? selection.explores : selectedExplores,
        interactionId: selection.isolatedInteractionId, updatedAt: new Date().toISOString(),
      }
      resolvedUseCaseByIdRef.current[created.caConversationId] = 'conversational-analytics'
      resolvedUseCaseByIdRef.current[convId] = 'conversational-analytics'
      const caRaw = { id: created.caConversationId, contentType: 'conversational-analytics' as const, title: created.label, embedPath: created.embedPath, updatedAt: nextCaState.updatedAt, source: 'created' as const, createdInConversation: true, hidden: false }
      const localUp = upsertStudioContentItem(!preselectedOutput && isFirstTurn ? baseConvItems.filter((it) => it.createdInConversation === true) : baseConvItems, caRaw)
      const upCa = isFg() ? upsertContentItem(caRaw) : Object.assign({}, localUp.item, { existed: localUp.existed })
      const nextMsgs: ChatMessage[] = [...baseMessages, { role: 'assistant', text: assistantText, interactionId: selection.isolatedInteractionId, crudItems: [toTurnCrudItem(upCa, 'created')] }]
      const liveEntry = inFlightTurnsRef.current.get(convId)
      if (liveEntry) { liveEntry.snapshot.contentItems = localUp.items; liveEntry.snapshot.activeContentTabKey = localUp.activeKey; liveEntry.snapshot.messagesWithUser = nextMsgs }
      if (isFg()) {
        lastCaIdRef.current = created.caConversationId
        setCaConversation(nextCaState); setSelectedUseCase('conversational-analytics'); setActiveObjectId(created.caConversationId)
        if (selection.explores.length > 0) setSelectedExplores(selection.explores)
        setMessages(nextMsgs); setActiveConversationId(convId)
        const targetRoute = `/c/${encodeURIComponent(convId)}`
        if (location.pathname !== targetRoute) history.replace(targetRoute)
      }
      await persistConversationAndLabel({
        id: convId, type: 'conversational-analytics',
        caConversationId: created.caConversationId,
        label: isFirstTurn ? created.label : undefined, explores: nextCaState.explores,
        content: {
          caConversationId: created.caConversationId, agentId: selection.agentId, agentName: selection.agentName,
          routingRationale: selection.rationale.slice(0, 120), initialQuestion: userQuestion.slice(0, 100), embedPath: created.embedPath,
        },
        contentItems: localUp.items, activeContentTabKey: localUp.activeKey, messages: nextMsgs, isFirstTurn, userPrompt: userQuestion, assistantText,
      })
    } catch (err: unknown) {
      if (!sig?.aborted && isFg()) setMessages((prev) => [...prev, { role: 'error', text: resetOAuthOnUnauthorized(err) }])
    } finally {
      if (ownEntry) finishTurnEntry(convId, ownEntry.abortController)
      else setConvBusyStatus(convId, null)
    }
  }

  const handleRunHealthCheck = async (customFocus?: string, baseMessages?: ChatMessage[], images?: PastedImage[], existingConvId?: string) => {
    const activeMsgs = baseMessages || messages
    const isFirstTurn = activeMsgs.filter((m) => m.role === 'user').length <= 1
    const convId = existingConvId || activeConversationIdRef.current || nextStudioConvId()
    const isFg = () => activeConversationIdRef.current === convId
    const baseConvItems = isFg() ? contentItemsRef.current : hydrateConversationContentItems(conversations.find((c) => c.id === convId) || { id: convId, type: 'health-check', label: convId, updatedAt: '' })
    const ownEntry = !inFlightTurnsRef.current.has(convId) ? registerTurnEntry(convId, makeStandaloneSnap(activeMsgs, baseConvItems), customFocus || 'Health Check') : null
    const sig = (ownEntry || inFlightTurnsRef.current.get(convId))?.abortController.signal
    try {
      const baseRes = await runThreePillarHealthCheckViaCodeMode({
        sdk: core40SDK, extensionSDK, conversationId: convId, signal: sig, reportId: healthReport?.id || undefined,
        targetProject: lookmlProjectId || availableLookmlProjects[0], healthScope, customFocus, onStatus: (s) => setConvBusyStatus(convId, s),
      })
      if (sig?.aborted) return
      let finalReport = baseRes.report
      if (customFocus && (authMode === 'apikey' || oauthTokenRef.current || oauthToken)) {
        try {
          const turnRes = await runAntigravityTurn({
            sdk: core40SDK, extensionSDK, userId, environmentId: sharedEnvIdRef.current || agentSession.environmentId,
            conversationId: convId, onEnvironmentUpdated: syncSharedEnvironmentId, signal: sig,
            auth: getAuthCfg(), session: agentSession, model: selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds, selectedExplores, folderId: selectedFolderId,
            schemaMarkdown, userPrompt: customFocus, rawUserPrompt: customFocus, images, customSystemGuide: HEALTH_CHECK_SYSTEM_GUIDE,
            extraSources: [
              { type: 'inline', content: THREE_PILLAR_CODEMODE_PY, target: '/workspace/three_pillar_audit.py' },
              { type: 'inline', content: finalReport.tddMarkdown, target: '/workspace/TECHNICAL_DESIGN_DOCUMENT.md' },
            ],
            priorMessages: activeMsgs, onStatus: (s) => setConvBusyStatus(convId, s),
          })
          if (sig?.aborted) return
          if (isFg()) setAgentSession(turnRes.session)
          if (turnRes.tddMarkdown) {
            finalReport = { ...finalReport, tddMarkdown: turnRes.tddMarkdown, lastInteractionId: turnRes.session.lastInteractionId, environmentId: turnRes.session.environmentId, updatedAt: new Date().toISOString() }
            await saveHealthCheckArtifact(core40SDK, extensionSDK, userId, finalReport)
          }
        } catch { /* ignore */ }
      }
      if (sig?.aborted) return
      resolvedUseCaseByIdRef.current[finalReport.id] = 'health-check'
      resolvedUseCaseByIdRef.current[convId] = 'health-check'
      const isExistingRep = baseConvItems.some((it) => it.key === `report:${finalReport.id}`)
      const repRaw = { id: String(finalReport.id), reportId: String(finalReport.id), contentType: 'report' as const, title: finalReport.title, embedPath: `/health-check/${encodeURIComponent(String(finalReport.id))}`, updatedAt: finalReport.updatedAt, source: (isExistingRep ? 'modified' : 'created') as 'modified' | 'created', createdInConversation: true, hidden: false }
      const localUp = upsertStudioContentItem(baseConvItems, repRaw)
      const upRep = isFg() ? upsertContentItem(repRaw) : Object.assign({}, localUp.item, { existed: localUp.existed })
      const nextHealthMsgs: ChatMessage[] = [
        ...activeMsgs,
        {
          role: 'assistant',
          text: `3-Pillar Health Check complete: **${finalReport.scores.overallScore}% (${finalReport.scores.grade})** | Pillar 1: ${finalReport.scores.pillar1Score}% · Pillar 2: ${finalReport.scores.pillar2Score}% (Transcriber ${finalReport.scores.transcriberScore}/4.00) · Pillar 3: ${finalReport.scores.pillar3Score}%.`,
          crudItems: [toTurnCrudItem(upRep, upRep.existed ? 'updated' : 'created')],
        },
      ]
      const liveEntry = inFlightTurnsRef.current.get(convId)
      if (liveEntry) { liveEntry.snapshot.contentItems = localUp.items; liveEntry.snapshot.activeContentTabKey = localUp.activeKey; liveEntry.snapshot.messagesWithUser = nextHealthMsgs }
      if (isFg()) {
        lastHealthIdRef.current = finalReport.id
        setHealthReport(finalReport); setActiveObjectId(finalReport.id); setActiveConversationId(convId)
        const targetRoute = `/c/${encodeURIComponent(convId)}`
        if (location.pathname !== targetRoute) history.replace(targetRoute)
        setMessages(nextHealthMsgs); setSelectedUseCase('health-check')
      }
      await persistConversationAndLabel({
        id: convId, type: 'health-check', interactionId: finalReport.lastInteractionId || agentSession.lastInteractionId,
        environmentId: finalReport.environmentId || agentSession.environmentId, label: isFirstTurn ? finalReport.title : undefined,
        explores: selectedExplores, content: { reportId: finalReport.id, projectId: finalReport.projectId, overallScore: finalReport.scores.overallScore, grade: finalReport.scores.grade },
        contentItems: localUp.items, activeContentTabKey: localUp.activeKey, messages: nextHealthMsgs,
      })
    } catch (err: unknown) {
      if (!sig?.aborted && isFg()) setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
    } finally {
      if (ownEntry) finishTurnEntry(convId, ownEntry.abortController)
      else setConvBusyStatus(convId, null)
    }
  }

  const openArtifactByMode = useCallback(
    async (typeOrMode: string, id: string, pushRoute: boolean) => {
      if (!id) return
      const loaders: Record<string, (id: string, pushRoute: boolean) => Promise<void>> = {
        'conversational-analytics': loadCaConversationById, app: loadDashboardById,
        'data-investigator': loadDashboardById, data_investigator: loadDashboardById,
        dashboard: loadNativeById, lookml: loadLookmlSessionById, health: loadHealthCheckById, tile: loadScriptById,
      }
      if (typeOrMode === 'auto') {
        if (await loadLocalDraftScript(id, extensionSDK)) return loaders.tile(id, pushRoute)
        return loadDashboardById(id, pushRoute)
      }
      const fn = loaders[typeOrMode] || loaders[normalizeCatalogMode(typeOrMode)]
      if (fn) return fn(id, pushRoute)
    },
    [extensionSDK, loadCaConversationById, loadDashboardById, loadHealthCheckById, loadLookmlSessionById, loadNativeById, loadScriptById]
  )

  const applyExpiredHydration = useCallback(
    (convId: string, prunedIds: string[], deadEnvironmentId?: string): void => {
      const pruneSet = new Set(prunedIds.length ? prunedIds : [convId])
      pruneSet.forEach((pid) => deleteConvMessages(pid))
      setConversations((prev) => prev.filter((c) => !pruneSet.has(c.id)), { optimisticEntry: null })
      if (deadEnvironmentId && normalizeEnvironmentId(sharedEnvIdRef.current) === deadEnvironmentId) syncSharedEnvironmentId('')
      setExpiredConversationNotice('This conversation expired because its sandbox environment was reset or expired.')
    },
    [deleteConvMessages, setConversations, setExpiredConversationNotice, sharedEnvIdRef, syncSharedEnvironmentId]
  )

  useEffect(() => {
    if (isTileMount || location.pathname === '/config') return
    if (disabledModes.includes(activeMode) || (parsedRoute.useCase && parsedRoute.useCase !== 'auto' && disabledModes.includes(parsedRoute.mode))) {
      explicitUseCaseRef.current = 'auto'; setSelectedUseCase('auto')
      if (location.pathname !== '/') history.replace('/')
      return
    }
    if (!isConfigured && activeMode !== 'tile') { history.replace('/config'); return }
    if (parsedRoute.isLegacyRoute) {
      if (parsedRoute.objectId) {
        if (parsedRoute.useCase && parsedRoute.useCase !== 'auto') { resolvedUseCaseByIdRef.current[parsedRoute.objectId] = parsedRoute.useCase; setSelectedUseCase(parsedRoute.useCase) }
        const target = `/c/${encodeURIComponent(parsedRoute.conversationId || parsedRoute.objectId)}`
        if (location.pathname !== target) history.replace(target)
      } else {
        if (parsedRoute.useCase && parsedRoute.useCase !== 'auto') { explicitUseCaseRef.current = parsedRoute.useCase; setSelectedUseCase(parsedRoute.useCase) }
        if (location.pathname !== '/') history.replace('/')
      }
    }
  }, [isTileMount, isConfigured, location.pathname, activeMode, disabledModes, parsedRoute, history, explicitUseCaseRef, resolvedUseCaseByIdRef, setSelectedUseCase])

  const didInitialRootRecoveryRef = useRef(false)

  useEffect(() => {
    if (isTileMount || location.pathname === '/config' || parsedRoute.isLegacyRoute || disabledModes.includes(activeMode)) return
    if (location.pathname !== '/') didInitialRootRecoveryRef.current = true
    const allInFlightIds = readInFlightConvIds()
    const isConvInterrupted = (c: UserConversationEntry) => Boolean(c.interactionId && (c.inFlight || allInFlightIds.includes(c.id)))
    if (!didInitialRootRecoveryRef.current && location.pathname === '/' && !parsedRoute.conversationId && !parsedRoute.objectId && !busyStatus && messages.length === 0 && conversations.length > 0) {
      didInitialRootRecoveryRef.current = true
      const interruptedConvId = readInFlightConvId()
      const targetResumeId =
        allInFlightIds.slice().reverse().find((cid) => !inFlightTurnsRef.current.has(cid) && conversations.some((c) => c.id === cid && isConvInterrupted(c))) ||
        (interruptedConvId && !inFlightTurnsRef.current.has(interruptedConvId) ? interruptedConvId : null) ||
        conversations.find((c) => !inFlightTurnsRef.current.has(c.id) && c.inFlight && Boolean(c.interactionId))?.id ||
        null
      const interruptedConv = targetResumeId ? conversations.find((c) => c.id === targetResumeId) : undefined
      if (interruptedConv && isConvInterrupted(interruptedConv)) {
        history.replace(`/c/${encodeURIComponent(interruptedConv.id)}`)
        return
      }
    }
    const routeConvId = parsedRoute.conversationId
    const id = parsedRoute.objectId
    const convMatch = conversations.find((c) => c.id === routeConvId || c.id === id)
    if (turnResumerRef.current && (allInFlightIds.length > 0 || conversations.some((c) => c.inFlight))) {
      for (const bgConv of conversations) {
        if (bgConv.id === convMatch?.id || inFlightTurnsRef.current.has(bgConv.id)) continue
        if (isConvInterrupted(bgConv) && bgConv.interactionId && !recoveredInFlightIdsRef.current.has(bgConv.interactionId)) {
          recoveredInFlightIdsRef.current.add(bgConv.interactionId)
          void turnResumerRef.current(bgConv)
        }
      }
    }
    if (routeConvId && (convMatch || /^conv_/i.test(routeConvId)) && routeConvId !== activeConversationIdRef.current) {
      setActiveConversationId(routeConvId)
    }
    if (!id) return
    const wasConvHydrated = Boolean(convMatch && hydratedConvRouteRef.current === `${location.pathname}:${convMatch.id}`)
    if (convMatch) {
      const hydrationKey = `${location.pathname}:${convMatch.id}`
      const isTurnInFlightInTab =
        inFlightTurnsRef.current.has(convMatch.id) ||
        (Boolean(busyStatus) && !mockExt?.initialBusyStatus && messages.length > 0 && activeConversationIdRef.current === convMatch.id) ||
        (activeConversationIdRef.current === convMatch.id && messages.length > 0 && messages[messages.length - 1]?.role === 'user')
      const isOptimisticInFlight = (!convMatch.interactionId && messages.length > 0 && activeConversationIdRef.current === convMatch.id) || isTurnInFlightInTab
      if (hydratedConvRouteRef.current !== hydrationKey && !isOptimisticInFlight) {
        hydratedConvRouteRef.current = hydrationKey
        const initialItems = hydrateConversationContentItems(convMatch)
        if (initialItems.length > 0 || convMatch.contentItems?.length || convMatch.activeContentTabKey === 'lookml:default') {
          setContentItems(initialItems)
          const fallbackTab = initialItems.filter((it) => !it.hidden).slice(-1)[0]?.key || ''
          const savedTab = convMatch.activeContentTabKey === 'lookml:default' ? undefined : convMatch.activeContentTabKey
          setActiveContentTabKey(savedTab ?? fallbackTab)
        }
        if (convMatch.explores?.length) setSelectedExplores(convMatch.explores)
        if (convMatch.interactionId || convMatch.environmentId) {
          const mode = normalizeCatalogMode(convMatch.type)
          setAgentSession({
            lastInteractionId: convMatch.interactionId,
            environmentId: sharedEnvIdRef.current || convMatch.environmentId || `env_${mode}_isolated`,
            conversationId: convMatch.id, explores: convMatch.explores, toolType: mode,
          }, mode)
        }
        const cachedMsgs = getConvMessages(convMatch.id)
        if (cachedMsgs.length > 0) {
          setMessages(mergeCachedActivitySteps(cachedMsgs))
        } else {
          void hydrateRemoteConversationMessages({
            extensionSDK, auth: getAuthCfg(), sdk: core40SDK, userId, conv: convMatch, activeEnvironmentId: sharedEnvIdRef.current,
          }).then((res) => {
            if (inFlightTurnsRef.current.has(convMatch.id)) return
            if (res.expired) {
              applyExpiredHydration(convMatch.id, res.prunedIds, res.deadEnvironmentId)
              if (activeConversationIdRef.current === convMatch.id) { setMessages([]); setContentItems([]); setActiveContentTabKey(''); setActiveConversationId(nextStudioConvId()); history.replace('/') }
              return
            }
            if (res.messages.length > 0) {
              setConvMessages(convMatch.id, res.messages)
              if (activeConversationIdRef.current === convMatch.id && !inFlightTurnsRef.current.has(convMatch.id)) setMessages(mergeCachedActivitySteps(res.messages))
            }
          }).catch(() => {})
        }
        if (isConvInterrupted(convMatch) && convMatch.interactionId && !recoveredInFlightIdsRef.current.has(convMatch.interactionId)) {
          recoveredInFlightIdsRef.current.add(convMatch.interactionId)
          if (turnResumerRef.current) {
            void turnResumerRef.current(convMatch)
          } else {
            // ponytail: fallback when useStudioLoaders mounts without useStudioTurn (preserves part21.ts contract)
            setBusyStatus('Resuming in-flight turn...')
            void recoverInFlightInteraction({ extensionSDK, auth: getAuthCfg(), interactionId: convMatch.interactionId })
              .then((rec) => {
                if (!rec || rec.status !== 'completed' || !rec.text) return
                const recMsgs: ChatMessage[] = [
                  ...(rec.userPrompt ? [{ role: 'user' as const, text: rec.userPrompt }] : []),
                  { role: 'assistant' as const, text: rec.text, interactionId: rec.interactionId, activitySteps: rec.activitySteps },
                ]
                setConvMessages(convMatch.id, recMsgs)
                setMessages((prev) => (prev.length > 0 ? [...prev, recMsgs[recMsgs.length - 1]] : recMsgs))
                const rootId = rec.rootInteractionId || convMatch.interactionId!
                void saveUserConversation(core40SDK, userId, { id: convMatch.id, inFlight: false, interactionId: rec.interactionId, turnInteractionIds: [[rootId, rec.interactionId]] }, getArtifactNamespace(extensionSDK)).catch(() => {})
              })
              .finally(() => { setBusyStatus(null); clearInFlightConvId(convMatch.id) })
          }
        }
      }
    }
    const convTargetId = getConvTargetId(convMatch?.content, convMatch?.type)
    const isPureConvId = /^conv_/i.test(id) && parsedRoute.useCase === 'auto'
    const targetArtifactId = convTargetId || (!isPureConvId ? id : '')
    if (!targetArtifactId) return
    if (!convTargetId) {
      if ((id === activeConversationId || id === agentSession.lastInteractionId) && !activeObjectId) return
    }
    const resolvedRouteType =
      (convMatch && convMatch.type !== 'auto' ? convMatch.type : undefined) ||
      (parsedRoute.useCase && parsedRoute.useCase !== 'auto' ? parsedRoute.useCase : undefined) ||
      inferredRouteUseCase
    const targetMode = resolvedRouteType ? normalizeCatalogMode(resolvedRouteType) : activeMode
    if (convMatch && !convTargetId && !catalogItems.some((it) => it.id === targetArtifactId && normalizeCatalogMode(it.type) === targetMode)) return
    const loadedPair: [string | undefined, string] = (resolvedRouteType === 'conversational-analytics' || isCaMode)
      ? [caConversation?.caConversationId, lastCaIdRef.current]
      : targetMode === 'lookml' ? [lookmlBundle?.project_id || lookmlBundle?.id, lastLookmlIdRef.current]
      : targetMode === 'health' ? [healthReport?.id, lastHealthIdRef.current]
      : targetMode === 'dashboard' ? [nativeContent?.id, lastNativeIdRef.current]
      : targetMode === 'tile' ? [loadedScript ? (wasConvHydrated ? targetArtifactId : scriptId) : undefined, lastScriptIdRef.current]
      : [publishedApp?.dashboardId, lastPublishedIdRef.current]
    if (
      targetArtifactId !== loadedPair[0] && targetArtifactId !== loadedPair[1] &&
      !isLookmlTargetAlreadyLoaded(targetMode, targetArtifactId, lookmlBundle?.id || lookmlBundle?.project_id ? { id: lookmlBundle.id, project_id: lookmlBundle.project_id } : null, convMatch?.content?.sessionId)
    ) {
      void openArtifactByMode(resolvedRouteType || (isCaMode ? 'conversational-analytics' : parsedRoute.useCase === 'auto' ? 'auto' : activeMode), targetArtifactId, false)
    }
  }, [
    isTileMount, location.pathname, activeMode, disabledModes, parsedRoute.conversationId, parsedRoute.isLegacyRoute, parsedRoute.objectId, parsedRoute.useCase,
    inferredRouteUseCase, isCaMode, publishedApp?.dashboardId, nativeContent?.id, lookmlBundle?.id, lookmlBundle?.project_id, healthReport?.id, caConversation?.caConversationId,
    loadedScript, scriptId, openArtifactByMode, conversations, catalogItems, messages, busyStatus, mockExt?.initialBusyStatus, activeConversationId, activeConversationIdRef,
    activeObjectId, agentSession.lastInteractionId, applyExpiredHydration, core40SDK, extensionSDK, getAuthCfg, getConvMessages, history, hydratedConvRouteRef,
    inFlightTurnsRef, lastCaIdRef, lastHealthIdRef, lastLookmlIdRef, lastNativeIdRef, lastPublishedIdRef, lastScriptIdRef, mergeCachedActivitySteps,
    setActiveContentTabKey, setActiveConversationId, setAgentSession, setBusyStatus, setContentItems, setConvMessages, setMessages,
    setSelectedExplores, sharedEnvIdRef, turnResumerRef, userId,
  ])

  return {
    recoveredInFlightIdsRef, applyExpiredHydration,
    persistConversationAndLabel, openArtifactByMode,
    loadNativeById, loadLookmlSessionById, loadCaConversationById, loadScriptById, loadAlertById,
    handleRunPython, handleSaveScript, handlePublishTileDashboard,
    handleRunHealthCheck, handleRunConversationalAnalytics,
  }
}

export type StudioLoaders = ReturnType<typeof useStudioLoaders>
