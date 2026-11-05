import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AntigravityAuth, generateConversationLabel, LkrCodeMode,
  PastedImage, runAntigravityTurn,
} from './antigravity'
import { ChatMessage, StudioMode } from './components/App'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import {
  HEALTH_CHECK_SYSTEM_GUIDE, HealthCheckReportPayload, loadHealthCheckArtifact,
  runThreePillarHealthCheckViaCodeMode, saveHealthCheckArtifact, THREE_PILLAR_CODEMODE_PY,
} from './healthCheck'
import {
  archiveUserConversation, CaConversationState, ConversationRecord,
  createLookerCaConversation, deleteUserConversation, extractExploreIdsFromCode,
  formatExploreId, getArtifactNamespace, hydrateConversationContentItems,
  listSavedScripts, loadExistingDashboardApp, loadNativeContentById,
  loadObjectArtifact, loadScriptArtifact, NativeContentState, PublishedAppState,
  publishScriptDashboard, resolveCaEmbedPath, ResolvedStudioUseCase, SavedScript,
  saveScriptArtifact, saveUserArtifact, saveUserConversation,
  selectCaAgentViaIsolatedSubagent, StudioContentItem, StudioContentItemType,
  studioModeToUseCase, StudioToolMode, StudioUseCase, studioUseCaseToMode,
  upsertStudioContentItem,
} from './lookerApi'
import { loadLookmlSessionArtifact, LookmlBundle } from './lookmlTool'
import { getErrorMessage, normalizeCatalogMode, StudioAuthAndPrefs } from './studioControllerAuth'
import { StudioMetadata } from './studioControllerMetadata'

export interface StudioViewerDocument {
  path: string; displayPath: string; title: string; kind: 'skill' | 'file'; isMarkdown: boolean; content: string; loading?: boolean
}

interface StoredCaArtifactPayload extends Partial<CaConversationState> {
  agent_id?: string; agent_name?: string; lastInteractionId?: string
  studio?: { lastInteractionId?: string; messages?: ChatMessage[] }; messages?: ChatMessage[]
}

export function useStudioLoaders(auth: StudioAuthAndPrefs, meta: StudioMetadata) {
  const {
    extensionSDK, core40SDK, extHostData, history, location, isTileMount, mockExt,
    authMode, oauthToken, clientId, projectId, apiKey, selectedModel,
    thinkingLevel, maxTotalTokens, isConfigured, disabledModes,
    resolvedUseCaseByIdRef, parsedRoute, setSelectedUseCase, explicitUseCaseRef,
    sharedEnvIdRef, syncSharedEnvironmentId, setAgentSession, setMessages, setBusyStatus,
    resetOAuthOnUnauthorized, setSidebarCollapsed,
  } = auth
  const {
    userId, userIdRef, availableLookmlProjects, selectedExplores, setSelectedExplores,
    setMentionedItems, selectedFolderId, setSelectedFolderId, schemaMarkdown,
    inferredRouteUseCase, effectiveUseCase, activeMode, isHealthCheckMode, builderMode,
    agentSession, messages, catalogItems, setCatalogItems, activeObjectId, setActiveObjectId,
    conversations, setConversations, conversationLabelsRef, refreshCatalog,
    setLookmlSessions, setSavedScripts, healthScope,
  } = meta

  const [caConversation, setCaConversation] = useState<CaConversationState | null>(null)
  const lastCaIdRef = useRef<string>('')
  const isCaMode = Boolean(
    parsedRoute.isCaRoute || effectiveUseCase === 'conversational-analytics' || caConversation
  )

  const [lookmlProjectId, setLookmlProjectId] = useState('')
  const [activatedLookmlSkills, setActivatedLookmlSkills] = useState<string[]>([
    'lookml-field-curation',
    'lookml-tests',
    'lookml-snapshot',
  ])
  const [lookmlBundle, setLookmlBundle] = useState<LookmlBundle | null>(null)
  const [loadLookmlInput, setLoadLookmlInput] = useState('')
  const lastLookmlIdRef = useRef<string>('')
  const [publishedApp, setPublishedAppState] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContentState] = useState<NativeContentState | null>(null)
  const [contentItems, setContentItemsState] = useState<StudioContentItem[]>([])
  const contentItemsRef = useRef<StudioContentItem[]>([])
  const [activeContentTabKey, setActiveContentTabKeyState] = useState<string>('')
  const activeContentTabKeyRef = useRef<string>('')

  const setContentItems = useCallback(
    (next: StudioContentItem[] | ((prev: StudioContentItem[]) => StudioContentItem[])) => {
      setContentItemsState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        contentItemsRef.current = resolved
        return resolved
      })
    },
    []
  )

  const setActiveContentTabKey = useCallback((nextKey: string) => {
    activeContentTabKeyRef.current = nextKey
    setActiveContentTabKeyState(nextKey)
  }, [])

  const upsertContentItem = useCallback(
    (
      rawItem: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType },
      activate = true
    ): StudioContentItem => {
      const res = upsertStudioContentItem(contentItemsRef.current, rawItem)
      contentItemsRef.current = res.items
      setContentItemsState(res.items)
      if (activate || !activeContentTabKeyRef.current) {
        activeContentTabKeyRef.current = res.activeKey
        setActiveContentTabKeyState(res.activeKey)
      }
      return res.item
    },
    []
  )

  const setPublishedApp = useCallback(
    (
      next: PublishedAppState | null | ((prev: PublishedAppState | null) => PublishedAppState | null),
      metaOpts?: { source?: 'created' | 'mention'; createdInConversation?: boolean }
    ) => {
      setPublishedAppState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (resolved && resolved.dashboardId) {
          const uc = resolvedUseCaseByIdRef.current[resolved.dashboardId]
          const ct: StudioContentItemType = uc === 'data-investigator' ? 'data-investigator' : 'data_app'
          upsertContentItem({
            id: String(resolved.dashboardId), dashboardId: String(resolved.dashboardId), contentType: ct,
            title: resolved.title, embedPath: `/embed/dashboards/${encodeURIComponent(String(resolved.dashboardId))}`,
            folderId: resolved.folderId, extensionId: resolved.extensionId, rawCode: resolved.code, ...metaOpts,
          })
        }
        return resolved
      })
    },
    [resolvedUseCaseByIdRef, upsertContentItem]
  )

  const setNativeContent = useCallback(
    (
      next: NativeContentState | null | ((prev: NativeContentState | null) => NativeContentState | null),
      metaOpts?: { source?: 'created' | 'mention'; createdInConversation?: boolean }
    ) => {
      setNativeContentState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (resolved && resolved.id) {
          const ct = (resolved.contentType || 'dashboard') as StudioContentItemType
          upsertContentItem({
            id: String(resolved.id), contentType: ct, title: resolved.title, embedPath: resolved.embedPath, folderId: resolved.folderId,
            dashboardId: resolved.dashboardId || (ct === 'dashboard' ? String(resolved.id) : undefined),
            lookId: resolved.lookId || (ct === 'look' ? String(resolved.id) : undefined),
            lookmlDashboardId: resolved.lookmlDashboardId || (ct === 'lookml_dashboard' ? String(resolved.id) : undefined),
            ...metaOpts,
          })
        }
        return resolved
      })
    },
    [upsertContentItem]
  )

  const activeContentItem = useMemo<StudioContentItem | null>(() => {
    if (contentItems.length === 0) return null
    return contentItems.find((it) => it.key === activeContentTabKey) || contentItems[contentItems.length - 1] || null
  }, [contentItems, activeContentTabKey])

  const [embedNonce, setEmbedNonce] = useState<number>(0)
  const bumpEmbedNonce = useCallback(() => setEmbedNonce((n) => n + 1), [])
  const lastPublishedIdRef = useRef<string>('')
  const lastNativeIdRef = useRef<string>('')
  const [healthReport, setHealthReport] = useState<HealthCheckReportPayload | null>(null)
  const lastHealthIdRef = useRef<string>('')
  const [scriptId, setScriptId] = useState(() => parsedRoute.objectId || 'demo1')
  const [scriptTitle, setScriptTitle] = useState('Looker Explore & Filter Summary')
  const [scriptCode, setScriptCode] = useState(DEFAULT_PYTHON_SCRIPT)
  const [filtersJson, setFiltersJson] = useState('{}')
  const [scriptOutput, setScriptOutput] = useState('')
  const [scriptMode, setScriptMode] = useState('summary')
  const [publishedTileDash, setPublishedTileDash] = useState<{ dashboardId: string; elementId: string } | null>(null)
  const [schedulerOpen, setSchedulerOpen] = useState(() => Boolean(mockExt?.openSchedulerModal))
  const [infoModalUseCase, setInfoModalUseCase] = useState<StudioUseCase | null>(() =>
    (mockExt?.initialInfoModalUseCase as StudioUseCase) || null
  )
  const [scheduleConfig, setScheduleConfig] = useState<{
    name: string; cron: string; mode: string; customVarsJson: string
    destination: 'artifact_snapshot' | 'webhook' | 'looker_scheduled_plan'; targetUrlOrEmail: string; enabled: boolean
  }>({
    name: 'Daily Morning Explore & Filter Snapshot', cron: '0 8 * * *', mode: 'summary',
    customVarsJson: '{"region":"AMER","threshold":0.95}', destination: 'artifact_snapshot',
    targetUrlOrEmail: 'https://hooks.example.com/looker-script-webhook', enabled: true,
  })
  const [savedScheduleBadge, setSavedScheduleBadge] = useState<string | null>('0 8 * * * · summary')
  const [loadedScript, setLoadedScript] = useState(false)
  const lastScriptIdRef = useRef<string>('')
  const [currentAppCode, setCurrentAppCode] = useState('')
  const [loadDashInput, setLoadDashInput] = useState('')
  const [activeViewerDocument, setActiveViewerDocument] = useState<StudioViewerDocument | null>(null)
  const [prompt, setPrompt] = useState(() => String(mockExt?.initialPrompt || ''))
  const [pastedImages, setPastedImages] = useState<PastedImage[]>(() => (mockExt?.initialPastedImages as PastedImage[] | undefined) || [])

  const [showArchivedConversations, setShowArchivedConversations] = useState<boolean>(
    () => Boolean(mockExt?.initialShowArchived)
  )
  const [pendingDeleteConv, setPendingDeleteConv] = useState<ConversationRecord | null>(
    () => (mockExt?.initialPendingDeleteConv as ConversationRecord | undefined) || null
  )
  const [deleteRelatedContent, setDeleteRelatedContent] = useState<boolean>(
    () => Boolean(mockExt?.initialDeleteRelatedContent)
  )
  const [activeConversationId, setActiveConversationId] = useState<string>(() => `conv_${Date.now()}`)

  const modeAllowedConversations = useMemo(
    () => conversations.filter((conv) => !disabledModes.includes(normalizeCatalogMode(conv.type))),
    [conversations, disabledModes]
  )
  const filteredConversations = useMemo(
    () => modeAllowedConversations.filter((conv) => !conv.archived),
    [modeAllowedConversations]
  )
  const archivedConversations = useMemo(
    () => modeAllowedConversations.filter((conv) => Boolean(conv.archived)),
    [modeAllowedConversations]
  )

  const runWithBusy = useCallback(
    async (statusText: string, errPrefix: string, fn: () => Promise<void>) => {
      try {
        setBusyStatus(statusText); await fn(); setBusyStatus(mockExt?.initialBusyStatus || null)
      } catch (err: unknown) {
        setBusyStatus(mockExt?.initialBusyStatus || null)
        setMessages((prev) => [...prev, { role: 'error', text: `${errPrefix}: ${getErrorMessage(err)}` }])
      }
    },
    [mockExt?.initialBusyStatus, setBusyStatus, setMessages]
  )

  const hydrateLoadedArtifact = useCallback(
    (opts: {
      mode: StudioMode; id: string; route: string; pushRoute: boolean; convTypes: string[]
      convId?: string; explores?: string[]
      studio?: {
        explores?: string[]; messages?: unknown[]; lastInteractionId?: string; environmentId?: string
        lastSession?: { lastInteractionId?: string; environmentId?: string }
      } | null
      lastInteractionId?: string; environmentId?: string; defaultEnvId: string; messages?: ChatMessage[]
      fallbackText: string; dashboardId?: string
    }) => {
      const explores = opts.explores ?? opts.studio?.explores?.filter(Boolean)
      const msgs = opts.messages ?? (opts.studio?.messages as ChatMessage[] | undefined)
      const matchedConv = conversations.find((c) => {
        if (opts.convId && c.id === opts.convId) return true
        const cid = String(
          c.content?.dashboardId || c.content?.lookId || c.content?.lookmlDashboardId ||
          c.content?.reportId || c.content?.sessionId || c.content?.caConversationId || c.content?.id || ''
        )
        return cid === opts.id && opts.convTypes.includes(c.type)
      })
      if (matchedConv) {
        for (const item of hydrateConversationContentItems(matchedConv)) upsertContentItem(item, false)
        if (matchedConv.activeContentTabKey) setActiveContentTabKey(matchedConv.activeContentTabKey)
      }
      setActiveObjectId(opts.id)
      setActiveConversationId((prev) => {
        if (opts.convId) return opts.convId
        const prefix = `conv_${opts.mode}_`
        return matchedConv ? matchedConv.id : prev.startsWith(prefix) ? prev : `${prefix}${opts.id}`
      })
      if (explores && explores.length > 0) setSelectedExplores(explores)
      setAgentSession(
        {
          lastInteractionId: opts.lastInteractionId || opts.studio?.lastInteractionId || opts.studio?.lastSession?.lastInteractionId,
          environmentId: sharedEnvIdRef.current || opts.environmentId || opts.studio?.environmentId || opts.studio?.lastSession?.environmentId || opts.defaultEnvId,
          conversationId: opts.id, explores, toolType: opts.mode,
        },
        opts.mode
      )
      setMessages(
        msgs?.length ? msgs : [{ role: 'assistant', text: opts.fallbackText, ...(opts.dashboardId ? { dashboardId: opts.dashboardId } : {}) }],
        opts.mode
      )
      if (opts.pushRoute && location.pathname !== opts.route) history.replace(opts.route)
    },
    [conversations, history, location.pathname, setActiveContentTabKey, setActiveObjectId, setAgentSession, setMessages, setSelectedExplores, sharedEnvIdRef, upsertContentItem]
  )

  const persistConversationAndLabel = useCallback(
    async (opts: {
      id: string; type: string; interactionId?: string; environmentId?: string; label?: string
      explores?: string[]; content?: Record<string, unknown>; messages: ChatMessage[]
      isFirstTurn?: boolean; userPrompt?: string; assistantText?: string; updateArtifactIndex?: boolean
    }) => {
      const namespace = getArtifactNamespace(extensionSDK)
      const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
      const baseConv = {
        id: opts.id, type: opts.type, interactionId: opts.interactionId, environmentId: opts.environmentId,
        explores: opts.explores, ...(opts.content ? { content: opts.content } : {}),
        ...(contentItemsRef.current.length > 0 ? { contentItems: contentItemsRef.current } : {}),
        ...(activeContentTabKeyRef.current ? { activeContentTabKey: activeContentTabKeyRef.current } : {}),
        messages: opts.messages,
      }
      setActiveConversationId(opts.id)
      await saveUserConversation(
        core40SDK, userId,
        { ...baseConv, ...(opts.label ? { label: opts.label } : {}), updatedAt: new Date().toISOString() },
        namespace
      ).then(setConversations).catch(() => {})

      if (opts.isFirstTurn && opts.userPrompt && opts.assistantText) {
        void generateConversationLabel({
          extensionSDK, auth: authCfg, environmentId: opts.environmentId,
          userPrompt: opts.userPrompt, assistantText: opts.assistantText, model: selectedModel,
        })
          .then(async (label) => {
            if (!label) return
            conversationLabelsRef.current[opts.id] = label
            setCaConversation((prev) => (prev && prev.id === opts.id ? { ...prev, label } : prev))
            setCatalogItems((prev) => prev.map((it) => (it.id === opts.id ? { ...it, label, title: label } : it)))
            setLookmlSessions((prev) => prev.map((s) => (s.id === opts.id ? { ...s, title: label } : s)))
            const updatedAt = new Date().toISOString()
            await saveUserConversation(core40SDK, userId, { ...baseConv, label, updatedAt }, namespace)
              .then(setConversations).catch(() => {})
            if (opts.updateArtifactIndex) {
              await saveUserArtifact(
                core40SDK, userId,
                {
                  id: opts.id, type: studioUseCaseToMode(studioModeToUseCase(opts.type)),
                  title: label, label, explores: opts.explores,
                  lastInteractionId: opts.interactionId, environmentId: opts.environmentId,
                  updatedAt, createdBy: userId,
                },
                undefined, namespace
              ).catch(() => {})
            }
          })
          .catch(() => {})
      }
    },
    [apiKey, authMode, clientId, conversationLabelsRef, core40SDK, extensionSDK, oauthToken, projectId, selectedModel, setCatalogItems, setConversations, setLookmlSessions, userId]
  )

  const loadDashboardById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastPublishedIdRef.current = id
      await runWithBusy(`Loading Data App from dashboard #${id}...`, `Could not load dashboard #${id}`, async () => {
        const loaded = await loadExistingDashboardApp(core40SDK, id)
        lastPublishedIdRef.current = loaded.dashboardId
        const existingUc = resolvedUseCaseByIdRef.current[loaded.dashboardId]
        const targetUc: ResolvedStudioUseCase = existingUc === 'data-investigator' ? 'data-investigator' : 'app'
        resolvedUseCaseByIdRef.current[loaded.dashboardId] = targetUc
        setSelectedUseCase(targetUc); setPublishedApp(loaded); setCurrentAppCode(loaded.code)
        setLoadDashInput(loaded.dashboardId); setSelectedFolderId(loaded.folderId)
        const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
        const legacyExplore = loaded.studio?.modelName && loaded.studio?.exploreName ? [formatExploreId(loaded.studio.modelName, loaded.studio.exploreName)] : []
        const queryExplores = Array.from(new Set((loaded.manifestQueries || []).filter((q) => q.model && q.explore).map((q) => formatExploreId(q.model, q.explore))))
        const resolvedExplores =
          studioExplores.length > 0 ? studioExplores
          : legacyExplore.length > 0 ? legacyExplore
          : queryExplores.length > 0 ? queryExplores
          : extractExploreIdsFromCode(loaded.code)
        setSelectedExplores(resolvedExplores)
        hydrateLoadedArtifact({
          mode: 'app', id: loaded.dashboardId, route: `/c/${encodeURIComponent(loaded.dashboardId)}`,
          pushRoute, convTypes: ['app', 'data_app', 'data-investigator', 'data_investigator'], explores: resolvedExplores, studio: loaded.studio,
          defaultEnvId: 'env_app_42', dashboardId: loaded.dashboardId,
          fallbackText: `Loaded existing Data App "${loaded.title}" (Dashboard #${loaded.dashboardId}, ${loaded.code.length.toLocaleString()} bytes). Describe any changes to update it in place.`,
        })
      })
    },
    [core40SDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setPublishedApp, setSelectedExplores, setSelectedFolderId, setSelectedUseCase]
  )

  const loadNativeById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastNativeIdRef.current = id
      await runWithBusy(`Loading native Looker content #${id}...`, `Could not load native content #${id}`, async () => {
        const loaded = await loadNativeContentById(core40SDK, extensionSDK, id)
        lastNativeIdRef.current = loaded.id
        resolvedUseCaseByIdRef.current[loaded.id] = 'dashboard'
        setSelectedUseCase('dashboard'); setNativeContent(loaded); setLoadDashInput(loaded.id); setSelectedFolderId(loaded.folderId)
        hydrateLoadedArtifact({
          mode: 'dashboard', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['dashboard'], studio: loaded.studio, defaultEnvId: 'env_dashboard_7', dashboardId: loaded.id,
          fallbackText: `Loaded native Looker ${loaded.contentType} "${loaded.title}" (#${loaded.id}). Ask for tiles, filters, looks, boards, or schedules to update it via CodeMode.`,
        })
      })
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setNativeContent, setSelectedFolderId, setSelectedUseCase]
  )

  const loadHealthCheckById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastHealthIdRef.current = id
      await runWithBusy(`Loading Health Check report "${id}"...`, `Could not load Health Check "${id}"`, async () => {
        const loaded = await loadHealthCheckArtifact(core40SDK, extensionSDK, id)
        lastHealthIdRef.current = loaded.id
        resolvedUseCaseByIdRef.current[loaded.id] = 'health-check'
        setSelectedUseCase('health-check'); setHealthReport(loaded); setLoadDashInput(loaded.id)
        hydrateLoadedArtifact({
          mode: 'health', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['health', 'health-check', 'health_check'], studio: loaded, defaultEnvId: `env_health_${loaded.id}`,
          fallbackText: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00) from obj_health_check_${loaded.id}.`,
        })
      })
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setSelectedUseCase]
  )

  const loadLookmlSessionById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastLookmlIdRef.current = id
      await runWithBusy(`Loading LookML session "${id}"...`, `Could not load LookML session "${id}"`, async () => {
        const loaded = await loadLookmlSessionArtifact(core40SDK, extensionSDK, id)
        lastLookmlIdRef.current = loaded.id
        resolvedUseCaseByIdRef.current[loaded.id] = 'lookml'
        setSelectedUseCase('lookml'); setLookmlBundle(loaded.bundle); setLoadLookmlInput(loaded.id)
        if (loaded.bundle?.project_id) setLookmlProjectId(loaded.bundle.project_id)
        setSelectedExplores(loaded.studio?.explores?.filter(Boolean) || [])
        hydrateLoadedArtifact({
          mode: 'lookml', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
          pushRoute, convTypes: ['lookml'], studio: loaded.studio, defaultEnvId: `env_lookml_${loaded.id}`,
          fallbackText: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} modified .lkml files).`,
        })
      })
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setSelectedExplores, setSelectedUseCase]
  )

  const handleRunPython = useCallback(
    async (codeToRun = scriptCode, rawFilters = filtersJson) => {
      try {
        setBusyStatus('Executing Looker queries...')
        let parsedFilters: Record<string, string> = {}
        try { parsedFilters = JSON.parse(rawFilters || '{}') } catch { parsedFilters = {} }
        const out = await LkrCodeMode.runPythonCode({
          code: codeToRun, sdk: core40SDK, extensionSDK,
          vars: {
            mode: scriptMode, dashboard_filters: { script_mode: scriptMode, ...parsedFilters },
            target_explores: selectedExplores, target_folder_id: selectedFolderId,
          },
        })
        setScriptOutput(out)
        return out
      } catch (err: unknown) {
        const errOut = JSON.stringify({ error: getErrorMessage(err) })
        setScriptOutput(errOut)
        return errOut
      } finally {
        setBusyStatus(mockExt?.initialBusyStatus || null)
      }
    },
    [core40SDK, extensionSDK, filtersJson, mockExt?.initialBusyStatus, scriptCode, scriptMode, selectedExplores, selectedFolderId, setBusyStatus]
  )

  const loadScriptById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastScriptIdRef.current = id
      resolvedUseCaseByIdRef.current[id] = 'tile'
      setSelectedUseCase('tile'); setLoadedScript(true); setScriptId(id)
      const loaded = await loadScriptArtifact(core40SDK, id)
      const effectiveCode = loaded?.code || scriptCode
      if (loaded) {
        setScriptId(loaded.id); setScriptTitle(loaded.title || loaded.id); setScriptCode(loaded.code || DEFAULT_PYTHON_SCRIPT)
        if (loaded.dashboardId) setPublishedTileDash({ dashboardId: loaded.dashboardId, elementId: loaded.elementId || '' })
      }
      hydrateLoadedArtifact({
        mode: 'tile', id: loaded?.id || id, route: `/c/${encodeURIComponent(loaded?.id || id)}`,
        pushRoute, convTypes: ['tile', 'script'], studio: loaded,
        messages: loaded?.messages as ChatMessage[] | undefined, defaultEnvId: 'env_tile_isolated',
        fallbackText: loaded ? `Loaded script "${loaded.title}" (${loaded.id}).` : `Opened Script "${scriptTitle}" (${id}).`,
      })
      await handleRunPython(effectiveCode, filtersJson)
    },
    [core40SDK, filtersJson, handleRunPython, hydrateLoadedArtifact, resolvedUseCaseByIdRef, scriptCode, scriptTitle, setSelectedUseCase]
  )

  const handleSaveScript = useCallback(
    async (overrideCode = scriptCode, overrideMsgs = messages, dashInfo = publishedTileDash): Promise<SavedScript> => {
      const cleanId = scriptId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `script_${Date.now().toString(36).slice(-5)}`
      setBusyStatus(`Saving script "${cleanId}" to Looker Artifacts...`)
      try {
        const saved = await saveScriptArtifact(core40SDK, userId, {
          id: cleanId, title: scriptTitle.trim() || cleanId, code: overrideCode, messages: overrideMsgs,
          updatedAt: new Date().toISOString(),
          ...(dashInfo?.dashboardId ? { dashboardId: dashInfo.dashboardId } : {}),
          ...(dashInfo?.elementId ? { elementId: dashInfo.elementId } : {}),
        })
        lastScriptIdRef.current = saved.id
        resolvedUseCaseByIdRef.current[saved.id] = 'tile'
        setLoadedScript(true); setScriptId(saved.id); setSavedScripts(await listSavedScripts(core40SDK, userId))
        await refreshCatalog()
        const targetRoute = `/c/${encodeURIComponent(saved.id)}`
        if (location.pathname !== targetRoute) history.replace(targetRoute)
        return saved
      } finally {
        setBusyStatus(mockExt?.initialBusyStatus || null)
      }
    },
    [core40SDK, history, location.pathname, messages, mockExt?.initialBusyStatus, publishedTileDash, refreshCatalog, resolvedUseCaseByIdRef, scriptCode, scriptId, scriptTitle, setBusyStatus, setSavedScripts, userId]
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
      upsertContentItem({
        id: String(pub.dashboardId), dashboardId: String(pub.dashboardId), contentType: 'dashboard',
        title: saved.title || `Dashboard #${pub.dashboardId}`, embedPath: `/embed/dashboards/${encodeURIComponent(String(pub.dashboardId))}`,
        folderId: selectedFolderId, source: 'created', createdInConversation: true,
      })
      await handleSaveScript(saved.code, saved.messages || [], nextDash)
      setMessages(
        (prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Published Dashboard #${pub.dashboardId} (load_configuration="wait", show_dashboard_header=true, layout="extension") and bound tile_element_${pub.elementId} -> ${saved.id}.`,
            dashboardId: pub.dashboardId,
          },
        ],
        'tile'
      )
    } catch (err: unknown) {
      setBusyStatus(mockExt?.initialBusyStatus || null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }], 'tile')
    }
  }, [core40SDK, extHostData?.extensionId, handleSaveScript, mockExt?.initialBusyStatus, publishedTileDash?.dashboardId, selectedFolderId, setBusyStatus, setMessages, upsertContentItem])

  const loadCaConversationById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      lastCaIdRef.current = id
      await runWithBusy(
        `Loading Conversational Analytics session "${id}"...`,
        `Could not load Conversational Analytics session "${id}"`,
        async () => {
          const loaded = await loadObjectArtifact<StoredCaArtifactPayload>(core40SDK, 'conversational-analytics', id, getArtifactNamespace(extensionSDK))
          const convFromList = conversations.find((c) => c.id === id || String(c.content?.caConversationId || c.content?.id || '') === id)
          const content: StoredCaArtifactPayload = loaded || (convFromList?.content as StoredCaArtifactPayload | undefined) || {}
          const agentId = String(content.agentId || content.agent_id || 'ad69f74cd9e2494090e9e9e9c50190c8')
          const agentName = String(content.agentName || content.agent_name || 'Looker CA Agent')
          const caConvId = String(content.caConversationId || content.id || id)
          const explores = Array.isArray(content.explores) ? content.explores : convFromList?.explores || []
          const resolvedTitle = String(content.title || content.label || convFromList?.label || id)
          const resolvedRationale = String(
            content.selectionRationale || content.rationale || `Routed to Looker CA agent "${agentName}" (${agentId}) via isolated sub-agent.`
          )
          const state: CaConversationState = {
            id: caConvId, caConversationId: caConvId, agentId, agentName,
            embedPath: content.embedPath || resolveCaEmbedPath(agentId, caConvId),
            title: resolvedTitle, label: resolvedTitle, rationale: resolvedRationale, selectionRationale: resolvedRationale,
            initialPrompt: String(content.initialPrompt || content.title || convFromList?.label || id),
            explores,
            interactionId: content.studio?.lastInteractionId || content.lastInteractionId || convFromList?.interactionId,
            updatedAt: String(content.updatedAt || convFromList?.updatedAt || new Date().toISOString()),
          }
          lastCaIdRef.current = caConvId
          resolvedUseCaseByIdRef.current[caConvId] = 'conversational-analytics'
          setCaConversation(state)
          upsertContentItem({
            id: caConvId, contentType: 'conversational-analytics', title: state.title, embedPath: state.embedPath, updatedAt: state.updatedAt,
          })
          setSelectedUseCase('conversational-analytics'); setLoadDashInput(caConvId)
          const msgs = content.studio?.messages || content.messages || convFromList?.messages
          hydrateLoadedArtifact({
            mode: 'app', id: caConvId, route: `/c/${encodeURIComponent(caConvId)}`, pushRoute,
            convTypes: ['conversational-analytics'], convId: convFromList?.id || caConvId, explores,
            lastInteractionId: state.interactionId, defaultEnvId: 'env_app_isolated',
            messages:
              Array.isArray(msgs) && msgs.length > 0
                ? msgs
                : [
                    { role: 'user', text: state.initialPrompt },
                    {
                      role: 'assistant',
                      text: `Routed via isolated CA sub-agent to **${state.agentName}** (\`${state.agentId}\`) and opened embedded Looker CA conversation \`${state.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${state.rationale}`,
                      interactionId: state.interactionId,
                    },
                  ],
            fallbackText: state.rationale,
          })
        }
      )
    },
    [conversations, core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setSelectedUseCase, upsertContentItem]
  )

  const handleRunConversationalAnalytics = async (userQuestion: string, baseMessages: ChatMessage[], preselectedOutput?: string) => {
    const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
    const isFirstTurn = baseMessages.filter((m) => m.role === 'user').length <= 1
    try {
      if (isFirstTurn) setContentItems((prev) => prev.filter((it) => it.createdInConversation === true))
      const selection = await selectCaAgentViaIsolatedSubagent({
        sdk: core40SDK, extensionSDK, auth: authCfg, userQuestion, preselectedOutput, model: selectedModel, onStatus: setBusyStatus,
      })
      setBusyStatus(`Creating Looker CA conversation with "${selection.agentName}"...`)
      const created = await createLookerCaConversation(core40SDK, selection.agentId, userQuestion, selection.agentName)
      const assistantText = `Routed via isolated CA sub-agent to **${selection.agentName}** (\`${selection.agentId}\`) and opened embedded Looker CA conversation \`${created.caConversationId}\`.\n\n**Sub-Agent Rationale:** ${selection.rationale}`
      const nextMsgs: ChatMessage[] = [
        ...baseMessages,
        { role: 'assistant', text: assistantText, interactionId: selection.isolatedInteractionId },
      ]
      const nextCaState: CaConversationState = {
        id: created.caConversationId, caConversationId: created.caConversationId,
        agentId: selection.agentId, agentName: selection.agentName, embedPath: created.embedPath,
        title: created.label, label: created.label, rationale: selection.rationale, selectionRationale: selection.rationale,
        initialPrompt: userQuestion, explores: selection.explores.length > 0 ? selection.explores : selectedExplores,
        interactionId: selection.isolatedInteractionId, updatedAt: new Date().toISOString(),
      }
      lastCaIdRef.current = created.caConversationId
      resolvedUseCaseByIdRef.current[created.caConversationId] = 'conversational-analytics'
      setCaConversation(nextCaState)
      upsertContentItem({
        id: created.caConversationId, contentType: 'conversational-analytics', title: created.label,
        embedPath: created.embedPath, updatedAt: nextCaState.updatedAt, source: 'created', createdInConversation: true,
      })
      setSelectedUseCase('conversational-analytics'); setActiveObjectId(created.caConversationId); setLoadDashInput(created.caConversationId)
      if (selection.explores.length > 0) setSelectedExplores(selection.explores)
      setMessages(nextMsgs, 'app')
      const targetRoute = `/c/${encodeURIComponent(created.caConversationId)}`
      if (location.pathname !== targetRoute) history.replace(targetRoute)

      const namespace = getArtifactNamespace(extensionSDK)
      await saveUserArtifact(
        core40SDK, userId,
        {
          id: created.caConversationId, type: 'conversational-analytics', title: created.label, label: created.label,
          explores: nextCaState.explores, lastInteractionId: selection.isolatedInteractionId, updatedAt: nextCaState.updatedAt, createdBy: userId,
        },
        {
          ...nextCaState, type: 'conversational-analytics', title: created.label,
          studio: { explores: nextCaState.explores, lastInteractionId: selection.isolatedInteractionId, messages: nextMsgs }, createdBy: userId,
        },
        namespace
      ).catch(() => {})
      await persistConversationAndLabel({
        id: created.caConversationId, type: 'conversational-analytics', interactionId: selection.isolatedInteractionId,
        environmentId: sharedEnvIdRef.current || agentSession.environmentId, label: created.label, explores: nextCaState.explores,
        content: {
          agentId: selection.agentId, agentName: selection.agentName, caConversationId: created.caConversationId,
          embedPath: created.embedPath, rationale: selection.rationale,
        },
        messages: nextMsgs, isFirstTurn, userPrompt: userQuestion, assistantText,
      })
      await refreshCatalog()
    } catch (err: unknown) {
      setMessages((prev) => [...prev, { role: 'error', text: resetOAuthOnUnauthorized(err) }], 'app')
    } finally {
      setBusyStatus(null)
    }
  }

  const handleRunHealthCheck = async (customFocus?: string, baseMessages?: ChatMessage[], images?: PastedImage[]) => {
    const activeMsgs = baseMessages || messages
    try {
      const baseRes = await runThreePillarHealthCheckViaCodeMode({
        sdk: core40SDK, extensionSDK, reportId: healthReport?.id || loadDashInput.trim() || undefined,
        targetProject: lookmlProjectId || availableLookmlProjects[0], healthScope, customFocus, messages: activeMsgs, onStatus: setBusyStatus,
      })
      let finalReport = baseRes.report
      if (customFocus && (authMode === 'apikey' || oauthToken)) {
        try {
          const turnRes = await runAntigravityTurn({
            sdk: core40SDK, extensionSDK, userId, environmentId: sharedEnvIdRef.current || agentSession.environmentId,
            conversationId: finalReport.id, onEnvironmentUpdated: syncSharedEnvironmentId,
            auth: { mode: authMode, oauthToken, clientId, projectId, apiKey }, session: agentSession,
            model: selectedModel, thinkingLevel, maxTotalTokens, selectedExplores, folderId: selectedFolderId,
            schemaMarkdown, userPrompt: customFocus, images, customSystemGuide: HEALTH_CHECK_SYSTEM_GUIDE,
            extraSources: [
              { type: 'inline', content: THREE_PILLAR_CODEMODE_PY, target: '/workspace/three_pillar_audit.py' },
              { type: 'inline', content: finalReport.tddMarkdown, target: '/workspace/TECHNICAL_DESIGN_DOCUMENT.md' },
            ],
            priorMessages: messages, onStatus: setBusyStatus,
          })
          setAgentSession(turnRes.session)
          if (turnRes.tddMarkdown) {
            finalReport = {
              ...finalReport, tddMarkdown: turnRes.tddMarkdown, lastInteractionId: turnRes.session.lastInteractionId,
              environmentId: turnRes.session.environmentId, updatedAt: new Date().toISOString(),
            }
            await saveHealthCheckArtifact(core40SDK, extensionSDK, userId, finalReport)
          }
        } catch { /* ignore */ }
      }
      lastHealthIdRef.current = finalReport.id
      resolvedUseCaseByIdRef.current[finalReport.id] = 'health-check'
      setHealthReport(finalReport); setActiveObjectId(finalReport.id); setLoadDashInput(finalReport.id)
      const targetRoute = `/c/${encodeURIComponent(finalReport.id)}`
      if (location.pathname !== targetRoute) history.replace(targetRoute)
      const nextHealthMsgs: ChatMessage[] = [
        ...activeMsgs,
        {
          role: 'assistant',
          text: `3-Pillar Health Check complete: **${finalReport.scores.overallScore}% (${finalReport.scores.grade})** | Pillar 1: ${finalReport.scores.pillar1Score}% · Pillar 2: ${finalReport.scores.pillar2Score}% (Transcriber ${finalReport.scores.transcriberScore}/4.00) · Pillar 3: ${finalReport.scores.pillar3Score}%.\nSaved to \`${baseRes.userKey}\` and \`${baseRes.objKey}\`.`,
        },
      ]
      setMessages(nextHealthMsgs, 'health')
      const convId = activeConversationId.startsWith('conv_health_') ? activeConversationId : `conv_health_${finalReport.id}`
      setSelectedUseCase('health-check')
      void persistConversationAndLabel({
        id: convId, type: 'health-check',
        interactionId: finalReport.lastInteractionId || agentSession.lastInteractionId,
        environmentId: finalReport.environmentId || agentSession.environmentId,
        label: finalReport.title, explores: selectedExplores,
        content: {
          reportId: finalReport.id, projectId: finalReport.projectId,
          overallScore: finalReport.scores.overallScore, grade: finalReport.scores.grade,
        },
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
        for (const [artifactType, loaderKey] of probes) {
          if (await loadObjectArtifact(core40SDK, artifactType, id, ns)) {
            return loaders[loaderKey](id, pushRoute)
          }
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
    if (disabledModes.includes(activeMode)) {
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
    if (isTileMount || location.pathname === '/config' || disabledModes.includes(activeMode)) return
    const id = parsedRoute.objectId
    if (!id) return
    if ((id === activeConversationId || id === agentSession.lastInteractionId) && !activeObjectId) return
    const convMatch = conversations.find((c) => c.id === id)
    const convTargetId = String(
      convMatch?.content?.dashboardId || convMatch?.content?.lookId || convMatch?.content?.lookmlDashboardId ||
      convMatch?.content?.reportId || convMatch?.content?.sessionId || convMatch?.content?.scriptId ||
      convMatch?.content?.caConversationId || convMatch?.content?.id || ''
    )
    if (convMatch && !convTargetId && !catalogItems.some((it) => it.id === id)) return
    const loadedPair: [string | undefined, string] = isCaMode
      ? [caConversation?.caConversationId, lastCaIdRef.current]
      : activeMode === 'lookml'
      ? [lookmlBundle?.id, lastLookmlIdRef.current]
      : activeMode === 'health'
      ? [healthReport?.id, lastHealthIdRef.current]
      : activeMode === 'dashboard'
      ? [nativeContent?.id, lastNativeIdRef.current]
      : activeMode === 'tile'
      ? [loadedScript ? scriptId : undefined, lastScriptIdRef.current]
      : [publishedApp?.dashboardId, lastPublishedIdRef.current]
    if (id !== loadedPair[0] && id !== loadedPair[1]) {
      const dispatchType = isCaMode
        ? 'conversational-analytics'
        : parsedRoute.useCase === 'auto' && !inferredRouteUseCase
        ? 'auto'
        : activeMode
      void openArtifactByMode(dispatchType, id, false)
    }
  }, [
    isTileMount, location.pathname, activeMode, disabledModes, parsedRoute.objectId, parsedRoute.useCase,
    inferredRouteUseCase, isCaMode, publishedApp?.dashboardId, nativeContent?.id, lookmlBundle?.id,
    healthReport?.id, caConversation?.caConversationId, loadedScript, scriptId, openArtifactByMode,
    activeConversationId, activeObjectId, agentSession.lastInteractionId, conversations, catalogItems,
  ])

  const handleLoadExistingDashboard = async () => {
    await openArtifactByMode(isHealthCheckMode ? 'health' : isCaMode ? 'conversational-analytics' : builderMode, loadDashInput, true)
  }

  const handleResetNewApp = useCallback(
    (resetToDefaultRoute?: boolean | React.MouseEvent, presetUseCase?: StudioUseCase) => {
      const forceDefaultRoute = resetToDefaultRoute === true
      const nextUseCase: StudioUseCase = typeof presetUseCase === 'string' && presetUseCase ? presetUseCase : 'auto'
      lastPublishedIdRef.current = ''
      lastNativeIdRef.current = ''
      lastLookmlIdRef.current = ''
      lastHealthIdRef.current = ''
      lastCaIdRef.current = ''
      lastScriptIdRef.current = ''
      setLoadedScript(false)
      setActiveObjectId('')
      setActiveConversationId(`conv_${Date.now()}`)
      setPublishedAppState(null)
      setNativeContentState(null)
      setActiveViewerDocument(null)
      setContentItems([])
      setActiveContentTabKey('')
      setLookmlBundle(null)
      setHealthReport(null)
      setCaConversation(null)
      setCurrentAppCode('')
      setLoadDashInput('')
      setLoadLookmlInput('')
      setSelectedExplores([])
      setMentionedItems([])
      setAgentSession({
        environmentId: sharedEnvIdRef.current || undefined,
        lastInteractionId: undefined,
        conversationId: `conv_${Date.now().toString(36)}`,
      })
      setMessages([])
      if (forceDefaultRoute) {
        setMessages([], 'app')
        if (nextUseCase !== 'auto') setMessages([], studioUseCaseToMode(nextUseCase))
      }
      setPastedImages([])
      setPrompt('')
      explicitUseCaseRef.current = nextUseCase
      setSelectedUseCase(nextUseCase)
      if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarCollapsed(true)
      if (location.pathname !== '/') history.push('/')
    },
    [explicitUseCaseRef, history, location.pathname, setActiveContentTabKey, setActiveObjectId, setAgentSession, setContentItems, setMentionedItems, setMessages, setSelectedExplores, setSelectedUseCase, setSidebarCollapsed, sharedEnvIdRef]
  )

  const handleNewConversation = useCallback(
    (presetUseCase?: StudioUseCase | React.MouseEvent) =>
      handleResetNewApp(true, typeof presetUseCase === 'string' ? presetUseCase : 'auto'),
    [handleResetNewApp]
  )

  const handleSelectContentTab = useCallback(
    (key: string) => {
      setActiveViewerDocument(null)
      setActiveContentTabKey(key)
      const item = contentItemsRef.current.find((it) => it.key === key)
      if (!item) return
      if (
        item.contentType === 'dashboard' || item.contentType === 'lookml_dashboard' ||
        item.contentType === 'look' || item.contentType === 'board'
      ) {
        setNativeContentState((prev) => ({
          id: item.id, title: item.title, contentType: item.contentType as NativeContentState['contentType'],
          embedPath: item.embedPath, folderId: item.folderId || prev?.folderId || selectedFolderId,
          dashboardId: item.dashboardId, lookId: item.lookId, lookmlDashboardId: item.lookmlDashboardId,
        }))
      } else if (item.contentType === 'data_app' || item.contentType === 'data-investigator') {
        const dashId = String(item.dashboardId || item.id)
        setPublishedAppState((prev) =>
          prev && prev.dashboardId === dashId
            ? prev
            : {
                dashboardId: dashId, title: item.title,
                folderId: item.folderId || prev?.folderId || selectedFolderId,
                extensionId: item.extensionId || prev?.extensionId || '',
                elementId: prev?.elementId || '', code: item.rawCode || prev?.code || currentAppCode,
              }
        )
      }
    },
    [currentAppCode, selectedFolderId, setActiveContentTabKey]
  )

  const handleSelectConversation = useCallback(
    async (conv: ConversationRecord) => {
      setActiveViewerDocument(null)
      if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarCollapsed(true)
      const useCase = studioModeToUseCase(conv.type)
      const mode = normalizeCatalogMode(conv.type)
      resolvedUseCaseByIdRef.current[conv.id] = useCase
      explicitUseCaseRef.current = 'auto'
      setSelectedUseCase(useCase)
      setActiveConversationId(conv.id)
      const initialItems = hydrateConversationContentItems(conv)
      setContentItems(initialItems)
      setActiveContentTabKey(conv.activeContentTabKey || initialItems[initialItems.length - 1]?.key || '')
      if (conv.explores?.length) setSelectedExplores(conv.explores)
      const c = conv.content || {}
      const targetId = String(
        (conv.type === 'conversational-analytics' && (c.caConversationId || c.id || conv.id)) ||
          c.dashboardId || c.lookId || c.lookmlDashboardId || c.sessionId || c.reportId || c.scriptId || c.id || ''
      )
      if (targetId) {
        resolvedUseCaseByIdRef.current[targetId] = useCase
        setActiveObjectId(targetId)
        await openArtifactByMode(conv.type, targetId, true)
      } else {
        setLoadedScript(false)
        setActiveObjectId('')
        const targetPath = `/c/${encodeURIComponent(conv.id)}`
        if (location.pathname !== targetPath) history.push(targetPath)
      }
      if (conv.activeContentTabKey && contentItemsRef.current.some((it) => it.key === conv.activeContentTabKey)) {
        setActiveContentTabKey(conv.activeContentTabKey)
      }
      setActiveConversationId(conv.id)
      if (conv.messages?.length) setMessages(conv.messages as ChatMessage[], mode)
      if (conv.interactionId || conv.environmentId || sharedEnvIdRef.current) {
        setAgentSession(
          {
            lastInteractionId: conv.interactionId,
            environmentId: sharedEnvIdRef.current || conv.environmentId || `env_${mode}_isolated`,
            conversationId: conv.id, explores: conv.explores, toolType: mode,
          },
          mode
        )
      }
    },
    [explicitUseCaseRef, history, location.pathname, openArtifactByMode, resolvedUseCaseByIdRef, setActiveContentTabKey, setActiveObjectId, setAgentSession, setContentItems, setMessages, setSelectedExplores, setSelectedUseCase, setSidebarCollapsed, sharedEnvIdRef]
  )

  const handleToggleArchiveConversation = async (
    e: React.MouseEvent | undefined,
    conversationId: string,
    nextArchived?: boolean
  ) => {
    e?.stopPropagation()
    const current = conversations.find((c) => c.id === conversationId)
    const archived = typeof nextArchived === 'boolean' ? nextArchived : !current?.archived
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, archived } : c)))
    try {
      const next = await archiveUserConversation(
        core40SDK, userIdRef.current || userId, conversationId, archived, getArtifactNamespace(extensionSDK)
      )
      setConversations(next)
    } catch { /* ignore */ }
  }

  const handleRequestDeleteConversation = (
    e: React.MouseEvent | undefined,
    convOrId: ConversationRecord | string
  ) => {
    e?.stopPropagation()
    const target =
      typeof convOrId === 'string'
        ? conversations.find((c) => c.id === convOrId) || { id: convOrId, type: 'app', label: convOrId, updatedAt: '' }
        : convOrId
    setDeleteRelatedContent(false)
    setPendingDeleteConv(target)
  }

  const handleCancelDeleteConversation = () => {
    setPendingDeleteConv(null)
    setDeleteRelatedContent(false)
  }

  const handleDeleteConversation = async (
    e: React.MouseEvent | undefined,
    conversationId: string,
    deleteRelated = false,
    explicitTarget?: ConversationRecord
  ) => {
    e?.stopPropagation()
    const target = explicitTarget || conversations.find((c) => c.id === conversationId)
    setConversations((prev) => prev.filter((c) => c.id !== conversationId))
    try {
      const next = await deleteUserConversation(
        core40SDK, userIdRef.current || userId, conversationId,
        { deleteRelatedContent: deleteRelated, conversation: target },
        getArtifactNamespace(extensionSDK)
      )
      setConversations(next)
      await refreshCatalog(userIdRef.current || userId)
    } catch { /* ignore */ }
    if (activeConversationId === conversationId) handleResetNewApp()
  }

  const handleConfirmDeleteConversation = async (overrideDeleteRelated?: boolean) => {
    if (!pendingDeleteConv) return
    const target = pendingDeleteConv
    const shouldDeleteRelated = typeof overrideDeleteRelated === 'boolean' ? overrideDeleteRelated : deleteRelatedContent
    setPendingDeleteConv(null)
    setDeleteRelatedContent(false)
    await handleDeleteConversation(undefined, target.id, shouldDeleteRelated, target)
  }

  return {
    caConversation, setCaConversation, lastCaIdRef, isCaMode,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, setLookmlBundle, loadLookmlInput, setLoadLookmlInput, lastLookmlIdRef,
    publishedApp, setPublishedAppState, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContentState, setNativeContent, lastNativeIdRef,
    contentItems, contentItemsRef, setContentItems,
    activeContentTabKey, activeContentTabKeyRef, setActiveContentTabKey,
    activeContentItem, upsertContentItem, handleSelectContentTab,
    embedNonce, setEmbedNonce, bumpEmbedNonce,
    healthReport, setHealthReport, lastHealthIdRef,
    scriptId, setScriptId, scriptTitle, setScriptTitle,
    scriptCode, setScriptCode, filtersJson, setFiltersJson,
    scriptOutput, setScriptOutput, scriptMode, setScriptMode,
    publishedTileDash, setPublishedTileDash, schedulerOpen, setSchedulerOpen,
    infoModalUseCase, setInfoModalUseCase,
    scheduleConfig, setScheduleConfig, savedScheduleBadge, setSavedScheduleBadge,
    loadedScript, setLoadedScript, lastScriptIdRef,
    currentAppCode, setCurrentAppCode, loadDashInput, setLoadDashInput,
    activeViewerDocument, setActiveViewerDocument,
    prompt, setPrompt, pastedImages, setPastedImages,
    showArchivedConversations, setShowArchivedConversations,
    pendingDeleteConv, setPendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent,
    activeConversationId, setActiveConversationId,
    modeAllowedConversations, filteredConversations, archivedConversations,
    persistConversationAndLabel,
    loadNativeById, loadLookmlSessionById, loadCaConversationById, loadScriptById,
    handleRunPython, handleSaveScript, handlePublishTileDashboard,
    handleRunHealthCheck, handleRunConversationalAnalytics, handleLoadExistingDashboard,
    handleResetNewApp, handleNewConversation, handleSelectConversation,
    handleToggleArchiveConversation, handleRequestDeleteConversation,
    handleCancelDeleteConversation, handleConfirmDeleteConversation, handleDeleteConversation,
  }
}

export type StudioLoaders = ReturnType<typeof useStudioLoaders>
