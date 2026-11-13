import { useCallback, useEffect, useRef } from 'react'

import {
  AntigravityAuth, cleanLookmlProjectId, generateConversationLabel, LkrCodeMode,
  PastedImage, recoverInFlightInteraction, runAntigravityTurn,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import {
  HEALTH_CHECK_SYSTEM_GUIDE, loadHealthCheckArtifact,
  runThreePillarHealthCheckViaCodeMode, saveHealthCheckArtifact, THREE_PILLAR_CODEMODE_PY,
} from './healthCheck'
import type { LkrCodeModeRunOptions } from './lkrCliBridge'
import {
  CaConversationState, clearInFlightConvId, compactPersistedChatTurn, ConversationRecord,
  createLookerCaConversation, extractExploreIdsFromCode,
  formatExploreId, getArtifactNamespace, getConvTargetId, hydrateConversationContentItems,
  isLookmlTargetAlreadyLoaded, listSavedScripts, loadAlertArtifact, loadExistingDashboardApp, loadNativeContentById,
  loadObjectArtifact, loadScriptArtifact, normalizeNativeContent,
  publishScriptDashboard, readInFlightConvId, resolveCaEmbedPath, ResolvedStudioUseCase, SavedScript,
  saveScriptArtifact, saveUserArtifact, saveUserConversation,
  selectCaAgentViaIsolatedSubagent, STUDIO_OVERVIEW_TAB_KEY,
  studioModeToUseCase, StudioToolMode, studioUseCaseToMode,
  toTurnCrudItem, UserConversationEntry,
} from './lookerApi'
import { loadLookmlSessionArtifact } from './lookmlTool'
import { getErrorMessage, normalizeCatalogMode, StudioAuthAndPrefs } from './studioControllerAuth'
import { StudioMetadata, StudioViewerDocument } from './studioControllerMetadata'

export { getConvTargetId }
export { STUDIO_OVERVIEW_TAB_KEY }
export type { StudioViewerDocument }

interface StoredCaArtifactPayload extends Partial<CaConversationState> {
  agent_id?: string; agent_name?: string; lastInteractionId?: string
  studio?: { lastInteractionId?: string; messages?: ChatMessage[] }; messages?: ChatMessage[]
}

export function useStudioLoaders(auth: StudioAuthAndPrefs, meta: StudioMetadata) {
  const {
    extensionSDK, core40SDK, extHostData, history, location, isTileMount, mockExt, authMode, oauthToken, clientId, projectId,
    apiKey, selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds, isConfigured, disabledModes, resolvedUseCaseByIdRef,
    parsedRoute, setSelectedUseCase, explicitUseCaseRef, sharedEnvIdRef, syncSharedEnvironmentId, setAgentSession, setMessages,
    busyStatus, setBusyStatus, triggerSilentOAuthRefresh, resetOAuthOnUnauthorized, activeConversationId, activeConversationIdRef, setActiveConversationId,
  } = auth
  const {
    userId, userIdRef, availableLookmlProjects, selectedExplores, setSelectedExplores, selectedFolderId, setSelectedFolderId,
    schemaMarkdown, inferredRouteUseCase, activeMode, agentSession, messages, catalogItems, activeObjectId, setActiveObjectId,
    conversations, setConversations, conversationLabelsRef, setSavedScripts, healthScope, caConversation, setCaConversation,
    lastCaIdRef, isCaMode, lookmlProjectId, setLookmlProjectId, lookmlBundle, setLookmlBundle, lastLookmlIdRef, publishedApp,
    setPublishedApp, lastPublishedIdRef, nativeContent, setNativeContent, lastNativeIdRef, setAlertBundle, contentItemsRef,
    setContentItems, activeContentTabKeyRef, setActiveContentTabKey, upsertContentItem, healthReport, setHealthReport,
    lastHealthIdRef, scriptId, setScriptId, scriptTitle, setScriptTitle, scriptCode, setScriptCode, filtersJson, setScriptOutput,
    scriptMode, publishedTileDash, setPublishedTileDash, loadedScript, setLoadedScript, lastScriptIdRef, setCurrentAppCode,
    hydratedConvRouteRef, activityStepsByInteractionIdRef, mergeCachedActivitySteps, codeModePermOptsRef,
  } = meta
  const recoveredInFlightIdsRef = useRef<Set<string>>(new Set())

  const runWithBusy = useCallback(
    (statusText: string, errPrefix: string, fn: () => Promise<unknown>) => {
      setBusyStatus(statusText)
      return Promise.resolve().then(fn).then(
        () => { setBusyStatus(mockExt?.initialBusyStatus || null) },
        (err: unknown) => {
          setBusyStatus(mockExt?.initialBusyStatus || null)
          setMessages((prev) => [...prev, { role: 'error', text: `${errPrefix}: ${getErrorMessage(err)}` }])
        }
      )
    },
    [mockExt?.initialBusyStatus, setBusyStatus, setMessages]
  )

  const hydrateLoadedArtifact = useCallback(
    (opts: {
      mode: StudioMode; id: string; route: string; pushRoute: boolean; convTypes: string[]; convId?: string; explores?: string[]
      studio?: { explores?: string[]; messages?: unknown[]; lastInteractionId?: string; environmentId?: string; lastSession?: { lastInteractionId?: string; environmentId?: string } } | null
      lastInteractionId?: string; environmentId?: string; defaultEnvId: string; messages?: ChatMessage[]; fallbackText: string; dashboardId?: string
    }) => {
      const matchedConv = conversations.find((c) => {
        if (opts.convId && c.id === opts.convId) return true
        if (!opts.pushRoute && c.id === activeConversationIdRef.current) return true
        return (getConvTargetId(c.content, c.type) === opts.id || (opts.mode === 'lookml' && c.content?.sessionId === opts.id)) && opts.convTypes.includes(c.type)
      })
      const explores = opts.explores ?? opts.studio?.explores?.filter(Boolean) ?? matchedConv?.explores
      const msgs = (matchedConv?.messages as ChatMessage[] | undefined) ?? opts.messages ?? (opts.studio?.messages as ChatMessage[] | undefined)
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
      setAgentSession(
        {
          lastInteractionId: matchedConv?.interactionId || opts.lastInteractionId || opts.studio?.lastInteractionId || opts.studio?.lastSession?.lastInteractionId,
          environmentId: sharedEnvIdRef.current || matchedConv?.environmentId || opts.environmentId || opts.studio?.environmentId || opts.studio?.lastSession?.environmentId || opts.defaultEnvId,
          conversationId: opts.convId || matchedConv?.id || activeConversationIdRef.current || opts.id, explores, toolType: opts.mode,
        },
        opts.mode
      )
      setMessages(msgs?.length ? mergeCachedActivitySteps(msgs) : [{ role: 'assistant', text: opts.fallbackText, ...(opts.dashboardId ? { dashboardId: opts.dashboardId } : {}) }])
      if (opts.pushRoute && location.pathname !== opts.route) history.replace(opts.route)
    },
    [activeConversationIdRef, conversations, history, location.pathname, mergeCachedActivitySteps, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setAgentSession, setMessages, setSelectedExplores, sharedEnvIdRef, upsertContentItem]
  )

  const persistConversationAndLabel = useCallback(
    (opts: {
      id: string; type: string; interactionId?: string; environmentId?: string; label?: string; explores?: string[]
      content?: Record<string, unknown>; messages: ChatMessage[]; isFirstTurn?: boolean; userPrompt?: string; assistantText?: string; updateArtifactIndex?: boolean
    }) => {
      opts.messages.forEach((m) => { if (m.role === 'assistant' && m.interactionId && m.activitySteps?.length) activityStepsByInteractionIdRef.current[m.interactionId] = m.activitySteps })
      hydratedConvRouteRef.current = `/c/${encodeURIComponent(opts.id)}:${opts.id}`
      const namespace = getArtifactNamespace(extensionSDK)
      const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
      const hasDeletedCrud = opts.messages.some((m) => m.crudItems?.some((x) => x.action === 'deleted'))
      const persistedTabKey = activeContentTabKeyRef.current === STUDIO_OVERVIEW_TAB_KEY ? '' : activeContentTabKeyRef.current
      const baseConv = {
        id: opts.id, type: opts.type, interactionId: opts.interactionId, environmentId: opts.environmentId,
        explores: opts.explores, ...(opts.content ? { content: opts.content } : {}),
        ...(contentItemsRef.current.length > 0 || hasDeletedCrud
          ? { contentItems: contentItemsRef.current, ...(persistedTabKey ? { activeContentTabKey: persistedTabKey } : {}) }
          : persistedTabKey ? { activeContentTabKey: persistedTabKey } : {}),
        messages: opts.messages,
      }
      setActiveConversationId(opts.id)
      return saveUserConversation(core40SDK, userId, { ...baseConv, use_case: opts.type, ...(opts.label ? { label: opts.label } : {}), updatedAt: new Date().toISOString() }, namespace)
        .then((list) => setConversations(list, { optimisticEntry: null }))
        .catch(() => {})
        .then(() => {
          if (!opts.isFirstTurn || !opts.userPrompt || !opts.assistantText) return
          void generateConversationLabel({ extensionSDK, auth: authCfg, environmentId: opts.environmentId, userPrompt: opts.userPrompt, assistantText: opts.assistantText, model: selectedModel })
            .then((label) => {
              if (!label) return
              const targetArtifactId = getConvTargetId(opts.content as ConversationRecord['content'], opts.type)
              conversationLabelsRef.current[opts.id] = label
              if (targetArtifactId) conversationLabelsRef.current[targetArtifactId] = label
              setCaConversation((prev) => (prev && (prev.id === opts.id || prev.id === targetArtifactId) ? { ...prev, label } : prev))
              const updatedAt = new Date().toISOString()
              return saveUserConversation(core40SDK, userId, { id: opts.id, type: opts.type, use_case: opts.type, label, updatedAt }, namespace)
                .then((list) => setConversations(list, { optimisticEntry: null }))
                .catch(() => {})
                .then(() => {
                  if (opts.updateArtifactIndex && targetArtifactId) {
                    return saveUserArtifact(
                      core40SDK, userId,
                      { id: targetArtifactId, type: studioUseCaseToMode(studioModeToUseCase(opts.type)), title: label, label, explores: opts.explores, lastInteractionId: opts.interactionId, environmentId: opts.environmentId, updatedAt, createdBy: userId },
                      undefined, namespace
                    ).catch(() => {})
                  }
                })
            })
            .catch(() => {})
        })
    },
    [activeContentTabKeyRef, activityStepsByInteractionIdRef, apiKey, authMode, clientId, contentItemsRef, conversationLabelsRef, core40SDK, extensionSDK, hydratedConvRouteRef, oauthToken, projectId, selectedModel, setActiveConversationId, setCaConversation, setConversations, userId]
  )

  const loadDashboardById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastPublishedIdRef.current = id
      return runWithBusy(`Loading Data App from dashboard #${id}...`, `Could not load dashboard #${id}`, () =>
        loadExistingDashboardApp(core40SDK, id).then((loaded) => {
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
        })
      )
    },
    [core40SDK, hydrateLoadedArtifact, lastPublishedIdRef, resolvedUseCaseByIdRef, runWithBusy, setCurrentAppCode, setPublishedApp, setSelectedExplores, setSelectedFolderId, setSelectedUseCase]
  )

  const loadNativeById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastNativeIdRef.current = id
      return runWithBusy(`Loading native Looker content #${id}...`, `Could not load native content #${id}`, () =>
        loadNativeContentById(core40SDK, extensionSDK, id).then((loaded) => {
          lastNativeIdRef.current = loaded.id
          resolvedUseCaseByIdRef.current[loaded.id] = 'dashboard'
          setSelectedUseCase('dashboard'); setNativeContent(loaded); setSelectedFolderId(loaded.folderId)
          hydrateLoadedArtifact({
            mode: 'dashboard', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
            pushRoute, convTypes: ['dashboard'], studio: loaded.studio, defaultEnvId: 'env_dashboard_7', dashboardId: loaded.id,
            fallbackText: `Loaded native Looker ${loaded.contentType} "${loaded.title}" (#${loaded.id}). Ask for tiles, filters, looks, boards, or schedules to update it via CodeMode.`,
          })
        })
      )
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, lastNativeIdRef, resolvedUseCaseByIdRef, runWithBusy, setNativeContent, setSelectedFolderId, setSelectedUseCase]
  )

  const loadHealthCheckById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastHealthIdRef.current = id
      return runWithBusy(`Loading Health Check report "${id}"...`, `Could not load Health Check "${id}"`, () =>
        loadHealthCheckArtifact(core40SDK, extensionSDK, id).then((loaded) => {
          lastHealthIdRef.current = loaded.id
          resolvedUseCaseByIdRef.current[loaded.id] = 'health-check'
          setSelectedUseCase('health-check'); setHealthReport(loaded)
          upsertContentItem({
            id: String(loaded.id), reportId: String(loaded.id), contentType: 'report',
            title: loaded.title, embedPath: `/health-check/${encodeURIComponent(String(loaded.id))}`, updatedAt: loaded.updatedAt,
          })
          hydrateLoadedArtifact({
            mode: 'health', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
            pushRoute, convTypes: ['health', 'health-check', 'health_check'], studio: loaded, defaultEnvId: `env_health_${loaded.id}`,
            fallbackText: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00) from obj_health_check_${loaded.id}.`,
          })
        })
      )
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, lastHealthIdRef, resolvedUseCaseByIdRef, runWithBusy, setHealthReport, setSelectedUseCase, upsertContentItem]
  )

  const loadLookmlSessionById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = cleanLookmlProjectId(rawId)
      if (!id) return Promise.resolve()
      const matchedSessionId = conversations.find(
        (c) => c.type === 'lookml' && (c.id === activeConversationIdRef.current || getConvTargetId(c.content, c.type) === id)
      )?.content?.sessionId
      lastLookmlIdRef.current = id
      return runWithBusy(`Loading LookML session "${id}"...`, `Could not load LookML session "${id}"`, () =>
        loadLookmlSessionArtifact(core40SDK, extensionSDK, id, matchedSessionId).then((loaded) => {
          const validProj = cleanLookmlProjectId(loaded.bundle?.project_id)
          const canonProj = validProj || cleanLookmlProjectId(loaded.id) || id
          lastLookmlIdRef.current = canonProj
          resolvedUseCaseByIdRef.current[canonProj] = 'lookml'
          resolvedUseCaseByIdRef.current[loaded.id] = 'lookml'
          setSelectedUseCase('lookml'); setLookmlBundle(loaded.bundle)
          if (validProj) setLookmlProjectId(validProj)
          setSelectedExplores(loaded.studio?.explores?.filter(Boolean) || [])
          upsertContentItem({
            id: canonProj, sessionId: String(loaded.id), projectId: canonProj,
            contentType: 'lookml', title: `LookML: ${canonProj}`, embedPath: `/lookml/${encodeURIComponent(canonProj)}`, updatedAt: loaded.updatedAt,
          })
          hydrateLoadedArtifact({
            mode: 'lookml', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
            pushRoute, convTypes: ['lookml'], studio: loaded.studio, defaultEnvId: `env_lookml_${loaded.id}`,
            fallbackText: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} .lkml files).`,
          })
        })
      )
    },
    [activeConversationIdRef, conversations, core40SDK, extensionSDK, hydrateLoadedArtifact, lastLookmlIdRef, resolvedUseCaseByIdRef, runWithBusy, setLookmlBundle, setLookmlProjectId, setSelectedExplores, setSelectedUseCase, upsertContentItem]
  )

  const handleRunPython = useCallback(
    (
      codeToRun = scriptCode,
      rawFilters = filtersJson,
      permOpts?: Pick<LkrCodeModeRunOptions, 'requirePermission' | 'approvedOperations' | 'onPermissionRequest' | 'thought'> & {
        isCanceled?: () => boolean
      }
    ): Promise<string> => {
      const runConvId = activeConversationIdRef.current
      const execBusyText = 'Executing Looker queries...'
      setBusyStatus(execBusyText)
      let parsedFilters: Record<string, string> = {}
      try { parsedFilters = JSON.parse(rawFilters || '{}') } catch { parsedFilters = {} }
      const effectivePermOpts = permOpts || codeModePermOptsRef.current?.()
      const finish = (v: string) => {
        if (activeConversationIdRef.current === runConvId && !effectivePermOpts?.isCanceled?.()) setScriptOutput(v)
        setBusyStatus((prev) => (prev === execBusyText ? mockExt?.initialBusyStatus || null : prev))
        return v
      }
      return LkrCodeMode.runPythonCode(
        Object.assign(
          {
            code: codeToRun, sdk: core40SDK, extensionSDK, conversationId: runConvId,
            vars: {
              mode: scriptMode, dashboard_filters: Object.assign({ script_mode: scriptMode }, parsedFilters),
              target_explores: selectedExplores, target_folder_id: selectedFolderId,
            },
          },
          effectivePermOpts
            ? {
                requirePermission: effectivePermOpts.requirePermission,
                approvedOperations: effectivePermOpts.approvedOperations,
                onPermissionRequest: effectivePermOpts.onPermissionRequest,
                thought: effectivePermOpts.thought,
              }
            : null
        )
      ).then(finish, (err: unknown) => finish(JSON.stringify({ error: getErrorMessage(err) })))
    },
    [activeConversationIdRef, codeModePermOptsRef, core40SDK, extensionSDK, filtersJson, mockExt?.initialBusyStatus, scriptCode, scriptMode, selectedExplores, selectedFolderId, setBusyStatus, setScriptOutput]
  )

  const loadAlertById = useCallback(
    (rawId: string, _pushRoute = true): Promise<void> => {
      const id = String(rawId || '').trim().replace(/^obj_alert_/, '')
      if (!id) return Promise.resolve()
      const loadConvId = activeConversationIdRef.current
      resolvedUseCaseByIdRef.current[id] = 'tile'
      setSelectedUseCase('tile')
      return loadAlertArtifact(core40SDK, id, getArtifactNamespace(extensionSDK)).then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId || !loaded) return
        setAlertBundle(loaded)
        const alertTitle = String(loaded.custom_title || loaded.title || `Alert #${id}`)
        upsertContentItem({
          id, alertId: id, dashboardId: loaded.dashboard_id ? String(loaded.dashboard_id) : undefined,
          contentType: 'alert', title: alertTitle, embedPath: `/alerts/${encodeURIComponent(id)}`, updatedAt: loaded.updated_at,
        })
      }).catch(() => {})
    },
    [activeConversationIdRef, core40SDK, extensionSDK, resolvedUseCaseByIdRef, setAlertBundle, setSelectedUseCase, upsertContentItem]
  )

  const loadScriptById = useCallback(
    (rawId: string, pushRoute = true): Promise<void> => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      const loadConvId = activeConversationIdRef.current
      lastScriptIdRef.current = id
      resolvedUseCaseByIdRef.current[id] = 'tile'
      setSelectedUseCase('tile'); setLoadedScript(true); setScriptId(id)
      return loadScriptArtifact(core40SDK, id).then((loaded) => {
        if (activeConversationIdRef.current !== loadConvId) return
        const effectiveCode = loaded?.code || scriptCode
        if (loaded) {
          setScriptId(loaded.id); setScriptTitle(loaded.title || loaded.id); setScriptCode(loaded.code || DEFAULT_PYTHON_SCRIPT)
          if (loaded.dashboardId) setPublishedTileDash({ dashboardId: loaded.dashboardId, elementId: loaded.elementId || '' })
        }
        const effectiveScriptId = loaded?.id || id
        upsertContentItem({
          id: String(effectiveScriptId), scriptId: String(effectiveScriptId), contentType: 'script',
          title: loaded?.title || scriptTitle || effectiveScriptId, embedPath: `/tile/${encodeURIComponent(String(effectiveScriptId))}`, updatedAt: loaded?.updatedAt,
        })
        hydrateLoadedArtifact({
          mode: 'tile', id: effectiveScriptId, route: `/c/${encodeURIComponent(effectiveScriptId)}`,
          pushRoute, convTypes: ['tile', 'script'], studio: loaded,
          messages: loaded?.messages as ChatMessage[] | undefined, defaultEnvId: 'env_tile_isolated',
          fallbackText: loaded ? `Loaded script "${loaded.title}" (${loaded.id}).` : `Opened Script "${scriptTitle}" (${id}).`,
        })
        return handleRunPython(effectiveCode, filtersJson).then(() => {})
      })
    },
    [activeConversationIdRef, core40SDK, filtersJson, handleRunPython, hydrateLoadedArtifact, lastScriptIdRef, resolvedUseCaseByIdRef, scriptCode, scriptTitle, setLoadedScript, setPublishedTileDash, setScriptCode, setScriptId, setScriptTitle, setSelectedUseCase, upsertContentItem]
  )

  const handleSaveScript = useCallback(
    (overrideCode = scriptCode, _overrideMsgs = messages, dashInfo = publishedTileDash): Promise<SavedScript> => {
      const cleanId = scriptId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `script_${Date.now().toString(36).slice(-5)}`
      setBusyStatus(`Saving script "${cleanId}" to Looker Artifacts...`)
      const isExisting = contentItemsRef.current.some((it) => it.key === `script:${cleanId}`)
      return saveScriptArtifact(core40SDK, userId, {
        id: cleanId, title: scriptTitle.trim() || cleanId, code: overrideCode, updatedAt: new Date().toISOString(),
        ...(dashInfo?.dashboardId ? { dashboardId: dashInfo.dashboardId } : {}),
        ...(dashInfo?.elementId ? { elementId: dashInfo.elementId } : {}),
      }).then(
        (saved) => listSavedScripts(core40SDK, userId).then((list) => {
          lastScriptIdRef.current = saved.id
          resolvedUseCaseByIdRef.current[saved.id] = 'tile'
          setLoadedScript(true); setScriptId(saved.id); setSavedScripts(list)
          upsertContentItem({
            id: String(saved.id), scriptId: String(saved.id), contentType: 'script',
            title: saved.title || saved.id, embedPath: `/tile/${encodeURIComponent(String(saved.id))}`,
            updatedAt: saved.updatedAt, source: isExisting ? 'modified' : 'created', createdInConversation: true, hidden: false,
          })
          if (location.pathname === '/') history.replace(`/c/${encodeURIComponent(activeConversationIdRef.current)}`)
          setBusyStatus(mockExt?.initialBusyStatus || null)
          return saved
        }),
        (err) => { setBusyStatus(mockExt?.initialBusyStatus || null); throw err }
      )
    },
    [activeConversationIdRef, contentItemsRef, core40SDK, history, lastScriptIdRef, location.pathname, messages, mockExt?.initialBusyStatus, publishedTileDash, resolvedUseCaseByIdRef, scriptCode, scriptId, scriptTitle, setBusyStatus, setLoadedScript, setSavedScripts, setScriptId, upsertContentItem, userId]
  )

  const handlePublishTileDashboard = useCallback(async () => {
    try {
      const saved = await handleSaveScript()
      setBusyStatus('Publishing extension-layout Looker dashboard & binding tile artifact...')
      const extId = extHostData?.extensionId || 'data_app_builder::data_app_builder'
      const pub = await publishScriptDashboard(core40SDK, {
        script: saved, folderId: selectedFolderId, extensionId: extId, existingDashboardId: publishedTileDash?.dashboardId,
      })
      const nextDash = { dashboardId: pub.dashboardId, elementId: pub.elementId }
      setPublishedTileDash(nextDash)
      const upDash = upsertContentItem({
        id: String(pub.dashboardId), dashboardId: String(pub.dashboardId), contentType: 'dashboard',
        title: saved.title || `Dashboard #${pub.dashboardId}`, embedPath: `/embed/dashboards/${encodeURIComponent(String(pub.dashboardId))}`,
        folderId: selectedFolderId, source: contentItemsRef.current.some((it) => it.key === `dashboard:${pub.dashboardId}`) ? 'modified' : 'created', createdInConversation: true,
      })
      await handleSaveScript(saved.code, saved.messages || [], nextDash)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Published Dashboard #${pub.dashboardId} (load_configuration="wait", show_dashboard_header=true, layout="extension") and bound tile_element_${pub.elementId} -> ${saved.id}.`,
          dashboardId: pub.dashboardId, crudItems: [toTurnCrudItem(upDash, upDash.existed ? 'updated' : 'created')],
        },
      ])
    } catch (err: unknown) {
      setBusyStatus(mockExt?.initialBusyStatus || null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
    }
  }, [contentItemsRef, core40SDK, extHostData?.extensionId, handleSaveScript, mockExt?.initialBusyStatus, publishedTileDash?.dashboardId, selectedFolderId, setBusyStatus, setMessages, setPublishedTileDash, upsertContentItem])

  const loadCaConversationById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastCaIdRef.current = id
      return runWithBusy(`Loading Conversational Analytics session "${id}"...`, `Could not load Conversational Analytics session "${id}"`, () =>
        loadObjectArtifact<StoredCaArtifactPayload>(core40SDK, 'conversational-analytics', id, getArtifactNamespace(extensionSDK)).then((loaded) => {
          const convFromList = conversations.find((c) => c.id === id || String(c.content?.caConversationId || c.content?.id || '') === id)
          const content: StoredCaArtifactPayload = loaded || (convFromList?.content as StoredCaArtifactPayload | undefined) || {}
          const agentId = String(content.agentId || content.agent_id || 'ad69f74cd9e2494090e9e9e9c50190c8')
          const agentName = String(content.agentName || content.agent_name || 'Looker CA Agent')
          const caConvId = String(content.caConversationId || content.id || id)
          const explores = Array.isArray(content.explores) ? content.explores : convFromList?.explores || []
          const resolvedTitle = String(content.title || content.label || convFromList?.label || id)
          const resolvedRationale = String(content.selectionRationale || content.rationale || `Routed to Looker CA agent "${agentName}" (${agentId}) via isolated sub-agent.`)
          const state: CaConversationState = {
            id: caConvId, caConversationId: caConvId, agentId, agentName,
            embedPath: content.embedPath || resolveCaEmbedPath(agentId, caConvId),
            title: resolvedTitle, label: resolvedTitle, rationale: resolvedRationale, selectionRationale: resolvedRationale,
            initialPrompt: String(content.initialPrompt || content.title || convFromList?.label || id),
            explores, interactionId: content.studio?.lastInteractionId || content.lastInteractionId || convFromList?.interactionId,
            updatedAt: String(content.updatedAt || convFromList?.updatedAt || new Date().toISOString()),
          }
          lastCaIdRef.current = caConvId
          resolvedUseCaseByIdRef.current[caConvId] = 'conversational-analytics'
          setCaConversation(state)
          upsertContentItem({ id: caConvId, contentType: 'conversational-analytics', title: state.title, embedPath: state.embedPath, updatedAt: state.updatedAt })
          setSelectedUseCase('conversational-analytics')
          const msgs = content.studio?.messages || content.messages || convFromList?.messages
          hydrateLoadedArtifact({
            mode: 'app', id: caConvId, route: `/c/${encodeURIComponent(caConvId)}`, pushRoute,
            convTypes: ['conversational-analytics'], convId: convFromList?.id || caConvId, explores,
            lastInteractionId: state.interactionId, defaultEnvId: 'env_app_isolated',
            messages: Array.isArray(msgs) && msgs.length > 0 ? msgs : [
              { role: 'user', text: state.initialPrompt },
              {
                role: 'assistant',
                text: `Routed via isolated CA sub-agent to **${state.agentName}** (\`${state.agentId}\`) and opened embedded Looker CA conversation \`${state.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${state.rationale}`,
                interactionId: state.interactionId,
              },
            ],
            fallbackText: state.rationale,
          })
        })
      )
    },
    [conversations, core40SDK, extensionSDK, hydrateLoadedArtifact, lastCaIdRef, resolvedUseCaseByIdRef, runWithBusy, setCaConversation, setSelectedUseCase, upsertContentItem]
  )

  const handleRunConversationalAnalytics = async (
    userQuestion: string, baseMessages: ChatMessage[], preselectedOutput?: string, existingConvId?: string
  ) => {
    const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const isFirstTurn = baseMessages.filter((m) => m.role === 'user').length <= 1
    const convId = existingConvId || activeConversationIdRef.current || `conv_${Date.now()}`
    try {
      if (!preselectedOutput) {
        if (isFirstTurn) setContentItems((prev) => prev.filter((it) => it.createdInConversation === true))
      }
      const selection = await selectCaAgentViaIsolatedSubagent({
        sdk: core40SDK, extensionSDK, auth: authCfg, userQuestion, preselectedOutput, model: selectedModel, onStatus: setBusyStatus,
      })
      setBusyStatus(`Creating Looker CA conversation with "${selection.agentName}"...`)
      const created = await createLookerCaConversation(core40SDK, selection.agentId, userQuestion, selection.agentName)
      const assistantText = `Routed via isolated CA sub-agent to **${selection.agentName}** (\`${selection.agentId}\`) and opened embedded Looker CA conversation \`${created.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${selection.rationale}`
      const nextCaState: CaConversationState = {
        id: created.caConversationId, caConversationId: created.caConversationId, agentId: selection.agentId, agentName: selection.agentName,
        embedPath: created.embedPath, title: created.label, label: created.label, rationale: selection.rationale, selectionRationale: selection.rationale,
        initialPrompt: userQuestion, explores: selection.explores.length > 0 ? selection.explores : selectedExplores,
        interactionId: selection.isolatedInteractionId, updatedAt: new Date().toISOString(),
      }
      lastCaIdRef.current = created.caConversationId
      resolvedUseCaseByIdRef.current[created.caConversationId] = 'conversational-analytics'
      resolvedUseCaseByIdRef.current[convId] = 'conversational-analytics'
      setCaConversation(nextCaState)
      const upCa = upsertContentItem({
        id: created.caConversationId, contentType: 'conversational-analytics', title: created.label,
        embedPath: created.embedPath, updatedAt: nextCaState.updatedAt, source: 'created', createdInConversation: true, hidden: false,
      })
      const nextMsgs: ChatMessage[] = [...baseMessages, { role: 'assistant', text: assistantText, interactionId: selection.isolatedInteractionId, crudItems: [toTurnCrudItem(upCa, 'created')] }]
      setSelectedUseCase('conversational-analytics'); setActiveObjectId(created.caConversationId)
      if (selection.explores.length > 0) setSelectedExplores(selection.explores)
      setMessages(nextMsgs); setActiveConversationId(convId)
      const targetRoute = `/c/${encodeURIComponent(convId)}`
      if (location.pathname !== targetRoute) history.replace(targetRoute)

      const namespace = getArtifactNamespace(extensionSDK)
      await saveUserArtifact(
        core40SDK, userId,
        { id: created.caConversationId, type: 'conversational-analytics', title: created.label, label: created.label, explores: nextCaState.explores, lastInteractionId: selection.isolatedInteractionId, updatedAt: nextCaState.updatedAt, createdBy: userId },
        { ...nextCaState, type: 'conversational-analytics', title: created.label, studio: { explores: nextCaState.explores, lastInteractionId: selection.isolatedInteractionId }, createdBy: userId },
        namespace
      ).catch(() => {})
      await persistConversationAndLabel({
        id: convId, type: 'conversational-analytics', interactionId: selection.isolatedInteractionId, environmentId: sharedEnvIdRef.current || agentSession.environmentId,
        label: isFirstTurn ? created.label : undefined, explores: nextCaState.explores,
        content: { agentId: selection.agentId, agentName: selection.agentName, caConversationId: created.caConversationId, embedPath: created.embedPath, rationale: selection.rationale },
        messages: nextMsgs, isFirstTurn, userPrompt: userQuestion, assistantText,
      })
    } catch (err: unknown) {
      setMessages((prev) => [...prev, { role: 'error', text: resetOAuthOnUnauthorized(err) }])
    } finally {
      setBusyStatus(null)
    }
  }

  const handleRunHealthCheck = async (customFocus?: string, baseMessages?: ChatMessage[], images?: PastedImage[], existingConvId?: string) => {
    const activeMsgs = baseMessages || messages
    const isFirstTurn = activeMsgs.filter((m) => m.role === 'user').length <= 1
    const convId = existingConvId || activeConversationIdRef.current || `conv_${Date.now()}`
    try {
      const baseRes = await runThreePillarHealthCheckViaCodeMode({
        sdk: core40SDK, extensionSDK, reportId: healthReport?.id || undefined,
        targetProject: lookmlProjectId || availableLookmlProjects[0], healthScope, customFocus, messages: [], onStatus: setBusyStatus,
      })
      let finalReport = baseRes.report
      if (customFocus && (authMode === 'apikey' || oauthToken)) {
        try {
          const turnRes = await runAntigravityTurn({
            sdk: core40SDK, extensionSDK, userId, environmentId: sharedEnvIdRef.current || agentSession.environmentId,
            conversationId: convId, onEnvironmentUpdated: syncSharedEnvironmentId,
            auth: { mode: authMode, oauthToken, clientId, projectId, apiKey }, session: agentSession,
            model: selectedModel, thinkingLevel, maxTotalTokens, maxToolRounds, selectedExplores, folderId: selectedFolderId,
            schemaMarkdown, userPrompt: customFocus, images, customSystemGuide: HEALTH_CHECK_SYSTEM_GUIDE,
            extraSources: [
              { type: 'inline', content: THREE_PILLAR_CODEMODE_PY, target: '/workspace/three_pillar_audit.py' },
              { type: 'inline', content: finalReport.tddMarkdown, target: '/workspace/TECHNICAL_DESIGN_DOCUMENT.md' },
            ],
            priorMessages: messages, onStatus: setBusyStatus,
          })
          setAgentSession(turnRes.session)
          if (turnRes.tddMarkdown) {
            finalReport = { ...finalReport, tddMarkdown: turnRes.tddMarkdown, lastInteractionId: turnRes.session.lastInteractionId, environmentId: turnRes.session.environmentId, updatedAt: new Date().toISOString() }
            await saveHealthCheckArtifact(core40SDK, extensionSDK, userId, finalReport)
          }
        } catch { /* ignore */ }
      }
      lastHealthIdRef.current = finalReport.id
      resolvedUseCaseByIdRef.current[finalReport.id] = 'health-check'
      resolvedUseCaseByIdRef.current[convId] = 'health-check'
      const isExistingRep = contentItemsRef.current.some((it) => it.key === `report:${finalReport.id}`)
      setHealthReport(finalReport); setActiveObjectId(finalReport.id)
      const upRep = upsertContentItem({
        id: String(finalReport.id), reportId: String(finalReport.id), contentType: 'report', title: finalReport.title,
        embedPath: `/health-check/${encodeURIComponent(String(finalReport.id))}`, updatedAt: finalReport.updatedAt,
        source: isExistingRep ? 'modified' : 'created', createdInConversation: true, hidden: false,
      })
      setActiveConversationId(convId)
      const targetRoute = `/c/${encodeURIComponent(convId)}`
      if (location.pathname !== targetRoute) history.replace(targetRoute)
      const nextHealthMsgs: ChatMessage[] = [
        ...activeMsgs,
        {
          role: 'assistant',
          text: `3-Pillar Health Check complete: **${finalReport.scores.overallScore}% (${finalReport.scores.grade})** | Pillar 1: ${finalReport.scores.pillar1Score}% · Pillar 2: ${finalReport.scores.pillar2Score}% (Transcriber ${finalReport.scores.transcriberScore}/4.00) · Pillar 3: ${finalReport.scores.pillar3Score}%.\nSaved to \`${baseRes.userKey}\` and \`${baseRes.objKey}\`.`,
          crudItems: [toTurnCrudItem(upRep, upRep.existed ? 'updated' : 'created')],
        },
      ]
      setMessages(nextHealthMsgs); setSelectedUseCase('health-check')
      void persistConversationAndLabel({
        id: convId, type: 'health-check', interactionId: finalReport.lastInteractionId || agentSession.lastInteractionId,
        environmentId: finalReport.environmentId || agentSession.environmentId, label: isFirstTurn ? finalReport.title : undefined,
        explores: selectedExplores, content: { reportId: finalReport.id, projectId: finalReport.projectId, overallScore: finalReport.scores.overallScore, grade: finalReport.scores.grade },
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
        'conversational-analytics': loadCaConversationById, app: loadDashboardById,
        'data-investigator': loadDashboardById, data_investigator: loadDashboardById,
        dashboard: loadNativeById, lookml: loadLookmlSessionById, health: loadHealthCheckById, tile: loadScriptById,
      }
      if (typeOrMode === 'auto') {
        const ns = getArtifactNamespace(extensionSDK)
        const probes: Array<[StudioToolMode, string]> = [
          ['conversational-analytics', 'conversational-analytics'], ['lookml', 'lookml'],
          ['health_check', 'health'], ['script', 'tile'], ['dashboard', 'dashboard'],
        ]
        for (let pIdx = 0; pIdx < probes.length; pIdx += 1) {
          const [artifactType, loaderKey] = probes[pIdx]
          if (await loadObjectArtifact(core40SDK, artifactType, id, ns)) return loaders[loaderKey](id, pushRoute)
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
    if (disabledModes.includes(activeMode) || (parsedRoute.useCase && parsedRoute.useCase !== 'auto' && disabledModes.includes(parsedRoute.mode))) {
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
  }, [isTileMount, isConfigured, location.pathname, activeMode, disabledModes, parsedRoute, history, explicitUseCaseRef, resolvedUseCaseByIdRef, setSelectedUseCase])

  useEffect(() => {
    if (isTileMount || location.pathname === '/config' || parsedRoute.isLegacyRoute || disabledModes.includes(activeMode)) return
    if (location.pathname === '/' && !parsedRoute.conversationId && !parsedRoute.objectId && !busyStatus && messages.length === 0) {
      const interruptedConvId = readInFlightConvId()
      if (interruptedConvId) {
        const interruptedConv = conversations.find((c) => c.id === interruptedConvId)
        if (interruptedConv && interruptedConv.messages?.[interruptedConv.messages.length - 1]?.role === 'user') {
          history.replace(`/c/${encodeURIComponent(interruptedConv.id)}`)
          return
        }
      }
    }
    const routeConvId = parsedRoute.conversationId
    const id = parsedRoute.objectId
    const convMatch = conversations.find((c) => c.id === routeConvId || c.id === id)
    if (routeConvId && (convMatch || /^conv_/i.test(routeConvId)) && routeConvId !== activeConversationIdRef.current) {
      setActiveConversationId(routeConvId)
    }
    if (!id) return
    if (convMatch) {
      const hydrationKey = `${location.pathname}:${convMatch.id}`
      const isTurnInFlightInTab =
        (Boolean(busyStatus) && !mockExt?.initialBusyStatus && messages.length > 0) ||
        (activeConversationIdRef.current === convMatch.id && messages.length > 0 && messages[messages.length - 1]?.role === 'user')
      const isOptimisticInFlight = (!convMatch.interactionId && messages.length > 0) || isTurnInFlightInTab
      if (hydratedConvRouteRef.current !== hydrationKey && !isOptimisticInFlight) {
        hydratedConvRouteRef.current = hydrationKey
        const initialItems = hydrateConversationContentItems(convMatch)
        if (initialItems.length > 0 || convMatch.contentItems?.length || convMatch.activeContentTabKey === 'lookml:default') {
          setContentItems(initialItems)
          const fallbackTab = initialItems.filter((it) => !it.hidden).slice(-1)[0]?.key || ''
          const savedTab = convMatch.activeContentTabKey === 'lookml:default' ? undefined : convMatch.activeContentTabKey
          setActiveContentTabKey(savedTab ?? fallbackTab)
        }
        if (convMatch.messages?.length) setMessages(mergeCachedActivitySteps(convMatch.messages as ChatMessage[]))
        if (convMatch.explores?.length) setSelectedExplores(convMatch.explores)
        if (convMatch.interactionId || convMatch.environmentId) {
          const mode = normalizeCatalogMode(convMatch.type)
          setAgentSession(
            {
              lastInteractionId: convMatch.interactionId,
              environmentId: sharedEnvIdRef.current || convMatch.environmentId || `env_${mode}_isolated`,
              conversationId: convMatch.id, explores: convMatch.explores, toolType: mode,
            },
            mode
          )
        }
        if (
          convMatch.messages?.length &&
          convMatch.messages[convMatch.messages.length - 1]?.role === 'user' &&
          convMatch.interactionId &&
          !recoveredInFlightIdsRef.current.has(convMatch.interactionId)
        ) {
          recoveredInFlightIdsRef.current.add(convMatch.interactionId)
          setBusyStatus('Resuming in-flight turn...')
          void recoverInFlightInteraction({
            extensionSDK,
            auth: { mode: authMode, oauthToken, clientId, projectId, apiKey, onUnauthorizedRefresh: () => triggerSilentOAuthRefresh(true) },
            interactionId: convMatch.interactionId,
          })
            .then((recovered) => {
              if (!recovered) return
              if (recovered.activitySteps.length) activityStepsByInteractionIdRef.current[recovered.interactionId] = recovered.activitySteps
              const assistantMsg: ChatMessage = {
                role: 'assistant', text: recovered.text || 'Completed.', interactionId: recovered.interactionId,
                ...(recovered.activitySteps.length ? { activitySteps: recovered.activitySteps } : {}),
              }
              const nextMsgs = [...(convMatch.messages as ChatMessage[]), assistantMsg]
              setMessages(mergeCachedActivitySteps(nextMsgs))
              if (recovered.nativeContent) setNativeContent(normalizeNativeContent(recovered.nativeContent), { source: 'created', createdInConversation: true })
              if (recovered.lookmlBundle) setLookmlBundle(recovered.lookmlBundle)
              const updatedConv: UserConversationEntry = {
                ...convMatch, interactionId: recovered.interactionId,
                messages: nextMsgs.map((m) => compactPersistedChatTurn(m, true)), updatedAt: new Date().toISOString(),
              }
              setConversations((prev) => [updatedConv, ...prev.filter((c) => c.id !== convMatch.id)], { optimisticEntry: null })
              if (userIdRef.current || userId) {
                void saveUserConversation(core40SDK, userIdRef.current || userId, updatedConv, getArtifactNamespace(extensionSDK)).catch(() => {})
              }
            })
            .catch(() => {})
            .finally(() => { setBusyStatus(null); clearInFlightConvId() })
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
      : targetMode === 'tile' ? [loadedScript ? scriptId : undefined, lastScriptIdRef.current]
      : [publishedApp?.dashboardId, lastPublishedIdRef.current]
    if (
      targetArtifactId !== loadedPair[0] && targetArtifactId !== loadedPair[1] &&
      !isLookmlTargetAlreadyLoaded(targetMode, targetArtifactId, lookmlBundle?.id || lookmlBundle?.project_id ? { id: lookmlBundle.id, project_id: lookmlBundle.project_id } : null, convMatch?.content?.sessionId)
    ) {
      void openArtifactByMode(resolvedRouteType || (isCaMode ? 'conversational-analytics' : parsedRoute.useCase === 'auto' ? 'auto' : activeMode), targetArtifactId, false)
    }
  }, [
    isTileMount, location.pathname, activeMode, disabledModes, parsedRoute.conversationId, parsedRoute.isLegacyRoute,
    parsedRoute.objectId, parsedRoute.useCase, inferredRouteUseCase, isCaMode, publishedApp?.dashboardId,
    nativeContent?.id, lookmlBundle?.id, lookmlBundle?.project_id, healthReport?.id, caConversation?.caConversationId, loadedScript, scriptId,
    openArtifactByMode, conversations, catalogItems, messages, busyStatus, mockExt?.initialBusyStatus, activeConversationId, activeConversationIdRef, activeObjectId,
    activityStepsByInteractionIdRef, agentSession.lastInteractionId, apiKey, authMode, clientId, core40SDK, extensionSDK, history, hydratedConvRouteRef,
    lastCaIdRef, lastHealthIdRef, lastLookmlIdRef, lastNativeIdRef, lastPublishedIdRef, lastScriptIdRef, mergeCachedActivitySteps,
    oauthToken, projectId, setActiveContentTabKey, setActiveConversationId, setAgentSession, setBusyStatus,
    setContentItems, setConversations, setLookmlBundle, setMessages, setNativeContent, setSelectedExplores,
    sharedEnvIdRef, triggerSilentOAuthRefresh, userId, userIdRef,
  ])

  return {
    persistConversationAndLabel, openArtifactByMode,
    loadNativeById, loadLookmlSessionById, loadCaConversationById, loadScriptById, loadAlertById,
    handleRunPython, handleSaveScript, handlePublishTileDashboard,
    handleRunHealthCheck, handleRunConversationalAnalytics,
  }
}

export type StudioLoaders = ReturnType<typeof useStudioLoaders>
