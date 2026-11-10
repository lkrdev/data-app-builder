import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AntigravityActivityStep, AntigravityAuth, generateConversationLabel, LkrCodeMode,
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
  toTurnCrudItem, upsertStudioContentItem,
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

const getConvTargetId = (c?: ConversationRecord['content'], type?: string): string => {
  if (!c) return ''
  if (type === 'tile' || type === 'script') return String(c.scriptId || c.id || '').trim()
  if (type === 'conversational-analytics' || type === 'ca') return String(c.caConversationId || c.id || '').trim()
  return String(
    c.dashboardId || c.lookId || c.lookmlDashboardId || c.reportId || c.sessionId || c.scriptId || c.caConversationId || c.id || ''
  ).trim()
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
    inferredRouteUseCase, effectiveUseCase, activeMode,
    agentSession, messages, catalogItems, activeObjectId, setActiveObjectId,
    conversations, setConversations, conversationLabelsRef,
    setSavedScripts, healthScope,
  } = meta

  const [caConversation, setCaConversation] = useState<CaConversationState | null>(null)
  const lastCaIdRef = useRef<string>('')
  const isCaMode = Boolean(
    parsedRoute.isCaRoute || effectiveUseCase === 'conversational-analytics' || caConversation
  )

  const [lookmlProjectId, setLookmlProjectId] = useState('')
  const [activatedLookmlSkills, setActivatedLookmlSkills] = useState<string[]>([])
  const [lookmlBundle, setLookmlBundle] = useState<LookmlBundle | null>(null)
  const lastLookmlIdRef = useRef<string>('')
  const [publishedApp, setPublishedAppState] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContentState] = useState<NativeContentState | null>(null)
  const [contentItems, setContentItemsState] = useState<StudioContentItem[]>([])
  const contentItemsRef = useRef<StudioContentItem[]>([])
  const [activeContentTabKey, setActiveContentTabKeyState] = useState<string>('')
  const activeContentTabKeyRef = useRef<string>('')

  const setContentItems = useCallback(
    (next: StudioContentItem[] | ((prev: StudioContentItem[]) => StudioContentItem[])) => {
      const resolved = typeof next === 'function' ? next(contentItemsRef.current) : next
      contentItemsRef.current = resolved
      setContentItemsState(resolved)
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
    ): StudioContentItem & { existed: boolean } => {
      const res = upsertStudioContentItem(contentItemsRef.current, rawItem)
      contentItemsRef.current = res.items
      setContentItemsState(res.items)
      if (activate || !activeContentTabKeyRef.current) {
        activeContentTabKeyRef.current = res.activeKey
        setActiveContentTabKeyState(res.activeKey)
      }
      return Object.assign({}, res.item, { existed: res.existed })
    },
    []
  )

  const applyStateWithSync = <T,>(
    setter: React.Dispatch<React.SetStateAction<T>>,
    next: T | ((prev: T) => T),
    sync: (resolved: T) => void
  ) => {
    if (typeof next !== 'function') {
      sync(next); setter(next); return
    }
    setter((prev) => { const r = (next as (p: T) => T)(prev); sync(r); return r })
  }

  const setPublishedApp = useCallback(
    (
      next: PublishedAppState | null | ((prev: PublishedAppState | null) => PublishedAppState | null),
      metaOpts?: { source?: 'created' | 'modified' | 'mention'; createdInConversation?: boolean; hidden?: boolean }
    ) => {
      applyStateWithSync(setPublishedAppState, next, (resolved) => {
        if (resolved?.dashboardId) {
          const uc = resolvedUseCaseByIdRef.current[resolved.dashboardId]
          upsertContentItem({
            id: String(resolved.dashboardId), dashboardId: String(resolved.dashboardId),
            contentType: uc === 'data-investigator' ? 'data-investigator' : 'data_app',
            title: resolved.title, embedPath: `/embed/dashboards/${encodeURIComponent(String(resolved.dashboardId))}`,
            folderId: resolved.folderId, extensionId: resolved.extensionId, ...metaOpts,
          })
        }
      })
    },
    [resolvedUseCaseByIdRef, upsertContentItem]
  )

  const setNativeContent = useCallback(
    (
      next: NativeContentState | null | ((prev: NativeContentState | null) => NativeContentState | null),
      metaOpts?: { source?: 'created' | 'modified' | 'mention'; createdInConversation?: boolean; hidden?: boolean }
    ) => {
      applyStateWithSync(setNativeContentState, next, (resolved) => {
        if (resolved?.id) {
          const ct = (resolved.contentType || 'dashboard') as StudioContentItemType
          upsertContentItem({
            id: String(resolved.id), contentType: ct, title: resolved.title, embedPath: resolved.embedPath, folderId: resolved.folderId,
            dashboardId: ct === 'dashboard' ? String(resolved.id) : undefined,
            lookId: resolved.lookId || (ct === 'look' ? String(resolved.id) : undefined),
            lookmlDashboardId: resolved.lookmlDashboardId || (ct === 'lookml_dashboard' ? String(resolved.id) : undefined),
            ...metaOpts,
          })
        }
      })
    },
    [upsertContentItem]
  )

  const activeContentItem = useMemo<StudioContentItem | null>(() => {
    const visible = contentItems.filter((it) => !it.hidden)
    if (visible.length === 0) return null
    return visible.find((it) => it.key === activeContentTabKey) || visible[visible.length - 1] || null
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
  const [activeConversationId, setActiveConversationIdState] = useState<string>(
    () => (parsedRoute.conversationId && /^conv_/i.test(parsedRoute.conversationId) ? parsedRoute.conversationId : `conv_${Date.now()}`)
  )
  const activeConversationIdRef = useRef<string>(activeConversationId)
  activeConversationIdRef.current = activeConversationId
  const setActiveConversationId = useCallback((next: string | ((prev: string) => string)) => {
    setActiveConversationIdState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      activeConversationIdRef.current = resolved
      return resolved
    })
  }, [])
  const hydratedConvRouteRef = useRef<string>('')
  const activityStepsByInteractionIdRef = useRef<Record<string, AntigravityActivityStep[]>>({})
  const mergeCachedActivitySteps = useCallback((msgs: ChatMessage[]): ChatMessage[] =>
    msgs.map((m) =>
      m.role === 'assistant' && !m.activitySteps?.length && m.interactionId && activityStepsByInteractionIdRef.current[m.interactionId]?.length
        ? { ...m, activitySteps: activityStepsByInteractionIdRef.current[m.interactionId] }
        : m
    ), [])

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
      mode: StudioMode; id: string; route: string; pushRoute: boolean; convTypes: string[]
      convId?: string; explores?: string[]
      studio?: {
        explores?: string[]; messages?: unknown[]; lastInteractionId?: string; environmentId?: string
        lastSession?: { lastInteractionId?: string; environmentId?: string }
      } | null
      lastInteractionId?: string; environmentId?: string; defaultEnvId: string; messages?: ChatMessage[]
      fallbackText: string; dashboardId?: string
    }) => {
      const matchedConv = conversations.find((c) => {
        if (opts.convId && c.id === opts.convId) return true
        if (!opts.pushRoute && c.id === activeConversationIdRef.current) return true
        return getConvTargetId(c.content, c.type) === opts.id && opts.convTypes.includes(c.type)
      })
      const explores = opts.explores ?? opts.studio?.explores?.filter(Boolean) ?? matchedConv?.explores
      const msgs = (matchedConv?.messages as ChatMessage[] | undefined) ?? opts.messages ?? (opts.studio?.messages as ChatMessage[] | undefined)
      if (matchedConv) {
        hydrateConversationContentItems(matchedConv).forEach((item) => upsertContentItem(item, false))
        if (matchedConv.activeContentTabKey) setActiveContentTabKey(matchedConv.activeContentTabKey)
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
      const resolvedConvId = opts.convId || matchedConv?.id || activeConversationIdRef.current || opts.id
      setAgentSession(
        {
          lastInteractionId: matchedConv?.interactionId || opts.lastInteractionId || opts.studio?.lastInteractionId || opts.studio?.lastSession?.lastInteractionId,
          environmentId: sharedEnvIdRef.current || matchedConv?.environmentId || opts.environmentId || opts.studio?.environmentId || opts.studio?.lastSession?.environmentId || opts.defaultEnvId,
          conversationId: resolvedConvId, explores, toolType: opts.mode,
        },
        opts.mode
      )
      setMessages(
        msgs?.length
          ? mergeCachedActivitySteps(msgs)
          : [{ role: 'assistant', text: opts.fallbackText, ...(opts.dashboardId ? { dashboardId: opts.dashboardId } : {}) }]
      )
      if (opts.pushRoute && location.pathname !== opts.route) history.replace(opts.route)
    },
    [conversations, history, location.pathname, mergeCachedActivitySteps, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setAgentSession, setMessages, setSelectedExplores, sharedEnvIdRef, upsertContentItem]
  )

  const persistConversationAndLabel = useCallback(
    (opts: {
      id: string; type: string; interactionId?: string; environmentId?: string; label?: string
      explores?: string[]; content?: Record<string, unknown>; messages: ChatMessage[]
      isFirstTurn?: boolean; userPrompt?: string; assistantText?: string; updateArtifactIndex?: boolean
    }) => {
      opts.messages.forEach((m) => {
        if (m.role === 'assistant' && m.interactionId && m.activitySteps?.length) {
          activityStepsByInteractionIdRef.current[m.interactionId] = m.activitySteps
        }
      })
      hydratedConvRouteRef.current = `/c/${encodeURIComponent(opts.id)}:${opts.id}`
      const namespace = getArtifactNamespace(extensionSDK)
      const authCfg: AntigravityAuth = { mode: authMode, oauthToken, clientId, projectId, apiKey }
      const hasDeletedCrud = opts.messages.some((m) => m.crudItems?.some((x) => x.action === 'deleted'))
      const baseConv = {
        id: opts.id, type: opts.type, interactionId: opts.interactionId, environmentId: opts.environmentId,
        explores: opts.explores, ...(opts.content ? { content: opts.content } : {}),
        ...(contentItemsRef.current.length > 0 || hasDeletedCrud
          ? { contentItems: contentItemsRef.current, activeContentTabKey: activeContentTabKeyRef.current }
          : activeContentTabKeyRef.current ? { activeContentTabKey: activeContentTabKeyRef.current } : {}),
        messages: opts.messages,
      }
      setActiveConversationId(opts.id)
      return saveUserConversation(
        core40SDK, userId,
        { ...baseConv, use_case: opts.type, ...(opts.label ? { label: opts.label } : {}), updatedAt: new Date().toISOString() },
        namespace
      )
        .then((list) => setConversations(list, { optimisticEntry: null }))
        .catch(() => {})
        .then(() => {
          if (!opts.isFirstTurn || !opts.userPrompt || !opts.assistantText) return
          void generateConversationLabel({
            extensionSDK, auth: authCfg, environmentId: opts.environmentId,
            userPrompt: opts.userPrompt, assistantText: opts.assistantText, model: selectedModel,
          })
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
                      {
                        id: targetArtifactId, type: studioUseCaseToMode(studioModeToUseCase(opts.type)),
                        title: label, label, explores: opts.explores,
                        lastInteractionId: opts.interactionId, environmentId: opts.environmentId,
                        updatedAt, createdBy: userId,
                      },
                      undefined, namespace
                    ).catch(() => {})
                  }
                })
            })
            .catch(() => {})
        })
    },
    [apiKey, authMode, clientId, conversationLabelsRef, core40SDK, extensionSDK, oauthToken, projectId, selectedModel, setActiveConversationId, setConversations, userId]
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
    [core40SDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setPublishedApp, setSelectedExplores, setSelectedFolderId, setSelectedUseCase]
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
    [core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setNativeContent, setSelectedFolderId, setSelectedUseCase]
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
            title: loaded.title, embedPath: `/health-check/${encodeURIComponent(String(loaded.id))}`,
            updatedAt: loaded.updatedAt,
          })
          hydrateLoadedArtifact({
            mode: 'health', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
            pushRoute, convTypes: ['health', 'health-check', 'health_check'], studio: loaded, defaultEnvId: `env_health_${loaded.id}`,
            fallbackText: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00) from obj_health_check_${loaded.id}.`,
          })
        })
      )
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setSelectedUseCase, upsertContentItem]
  )

  const loadLookmlSessionById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastLookmlIdRef.current = id
      return runWithBusy(`Loading LookML session "${id}"...`, `Could not load LookML session "${id}"`, () =>
        loadLookmlSessionArtifact(core40SDK, extensionSDK, id).then((loaded) => {
          const canonProj = loaded.bundle?.project_id?.trim() || String(loaded.id || id).trim()
          lastLookmlIdRef.current = canonProj
          resolvedUseCaseByIdRef.current[canonProj] = 'lookml'
          resolvedUseCaseByIdRef.current[loaded.id] = 'lookml'
          setSelectedUseCase('lookml'); setLookmlBundle(loaded.bundle)
          if (loaded.bundle?.project_id) setLookmlProjectId(loaded.bundle.project_id)
          setSelectedExplores(loaded.studio?.explores?.filter(Boolean) || [])
          upsertContentItem({
            id: canonProj, sessionId: String(loaded.id), projectId: canonProj,
            contentType: 'lookml', title: `LookML: ${canonProj}`, embedPath: `/lookml/${encodeURIComponent(canonProj)}`,
            updatedAt: loaded.updatedAt,
          })
          hydrateLoadedArtifact({
            mode: 'lookml', id: loaded.id, route: `/c/${encodeURIComponent(loaded.id)}`,
            pushRoute, convTypes: ['lookml'], studio: loaded.studio, defaultEnvId: `env_lookml_${loaded.id}`,
            fallbackText: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} .lkml files).`,
          })
        })
      )
    },
    [core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setSelectedExplores, setSelectedUseCase, upsertContentItem]
  )

  const handleRunPython = useCallback(
    (codeToRun = scriptCode, rawFilters = filtersJson): Promise<string> => {
      setBusyStatus('Executing Looker queries...')
      let parsedFilters: Record<string, string> = {}
      try { parsedFilters = JSON.parse(rawFilters || '{}') } catch { parsedFilters = {} }
      return LkrCodeMode.runPythonCode({
        code: codeToRun, sdk: core40SDK, extensionSDK,
        vars: {
          mode: scriptMode, dashboard_filters: { script_mode: scriptMode, ...parsedFilters },
          target_explores: selectedExplores, target_folder_id: selectedFolderId,
        },
      }).then(
        (out) => { setScriptOutput(out); setBusyStatus(mockExt?.initialBusyStatus || null); return out },
        (err: unknown) => {
          const errOut = JSON.stringify({ error: getErrorMessage(err) })
          setScriptOutput(errOut); setBusyStatus(mockExt?.initialBusyStatus || null)
          return errOut
        }
      )
    },
    [core40SDK, extensionSDK, filtersJson, mockExt?.initialBusyStatus, scriptCode, scriptMode, selectedExplores, selectedFolderId, setBusyStatus]
  )

  const loadScriptById = useCallback(
    (rawId: string, pushRoute = true): Promise<void> => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastScriptIdRef.current = id
      resolvedUseCaseByIdRef.current[id] = 'tile'
      setSelectedUseCase('tile'); setLoadedScript(true); setScriptId(id)
      return loadScriptArtifact(core40SDK, id).then((loaded) => {
        const effectiveCode = loaded?.code || scriptCode
        if (loaded) {
          setScriptId(loaded.id); setScriptTitle(loaded.title || loaded.id); setScriptCode(loaded.code || DEFAULT_PYTHON_SCRIPT)
          if (loaded.dashboardId) setPublishedTileDash({ dashboardId: loaded.dashboardId, elementId: loaded.elementId || '' })
        }
        const effectiveScriptId = loaded?.id || id
        upsertContentItem({
          id: String(effectiveScriptId), scriptId: String(effectiveScriptId), contentType: 'script',
          title: loaded?.title || scriptTitle || effectiveScriptId, embedPath: `/tile/${encodeURIComponent(String(effectiveScriptId))}`,
          updatedAt: loaded?.updatedAt,
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
    [core40SDK, filtersJson, handleRunPython, hydrateLoadedArtifact, resolvedUseCaseByIdRef, scriptCode, scriptTitle, setSelectedUseCase, upsertContentItem]
  )

  const handleSaveScript = useCallback(
    (overrideCode = scriptCode, _overrideMsgs = messages, dashInfo = publishedTileDash): Promise<SavedScript> => {
      const cleanId = scriptId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `script_${Date.now().toString(36).slice(-5)}`
      setBusyStatus(`Saving script "${cleanId}" to Looker Artifacts...`)
      const isExisting = contentItemsRef.current.some((it) => it.key === `script:${cleanId}`)
      return saveScriptArtifact(core40SDK, userId, {
        id: cleanId, title: scriptTitle.trim() || cleanId, code: overrideCode,
        updatedAt: new Date().toISOString(),
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
    [core40SDK, history, location.pathname, messages, mockExt?.initialBusyStatus, publishedTileDash, resolvedUseCaseByIdRef, scriptCode, scriptId, scriptTitle, setBusyStatus, setSavedScripts, upsertContentItem, userId]
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
          dashboardId: pub.dashboardId,
          crudItems: [toTurnCrudItem(upDash, upDash.existed ? 'updated' : 'created')],
        },
      ])
    } catch (err: unknown) {
      setBusyStatus(mockExt?.initialBusyStatus || null)
      setMessages((prev) => [...prev, { role: 'error', text: getErrorMessage(err) }])
    }
  }, [core40SDK, extHostData?.extensionId, handleSaveScript, mockExt?.initialBusyStatus, publishedTileDash?.dashboardId, selectedFolderId, setBusyStatus, setMessages, upsertContentItem])

  const loadCaConversationById = useCallback(
    (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return Promise.resolve()
      lastCaIdRef.current = id
      return runWithBusy(
        `Loading Conversational Analytics session "${id}"...`,
        `Could not load Conversational Analytics session "${id}"`,
        () =>
          loadObjectArtifact<StoredCaArtifactPayload>(core40SDK, 'conversational-analytics', id, getArtifactNamespace(extensionSDK)).then((loaded) => {
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
            setSelectedUseCase('conversational-analytics')
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
          })
      )
    },
    [conversations, core40SDK, extensionSDK, hydrateLoadedArtifact, resolvedUseCaseByIdRef, runWithBusy, setSelectedUseCase, upsertContentItem]
  )

  const handleRunConversationalAnalytics = async (
    userQuestion: string,
    baseMessages: ChatMessage[],
    preselectedOutput?: string,
    existingConvId?: string
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
        id: created.caConversationId, caConversationId: created.caConversationId,
        agentId: selection.agentId, agentName: selection.agentName, embedPath: created.embedPath,
        title: created.label, label: created.label, rationale: selection.rationale, selectionRationale: selection.rationale,
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
      const nextMsgs: ChatMessage[] = [
        ...baseMessages,
        {
          role: 'assistant', text: assistantText, interactionId: selection.isolatedInteractionId,
          crudItems: [toTurnCrudItem(upCa, 'created')],
        },
      ]
      setSelectedUseCase('conversational-analytics'); setActiveObjectId(created.caConversationId)
      if (selection.explores.length > 0) setSelectedExplores(selection.explores)
      setMessages(nextMsgs)
      setActiveConversationId(convId)
      const targetRoute = `/c/${encodeURIComponent(convId)}`
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
          studio: { explores: nextCaState.explores, lastInteractionId: selection.isolatedInteractionId }, createdBy: userId,
        },
        namespace
      ).catch(() => {})
      await persistConversationAndLabel({
        id: convId, type: 'conversational-analytics', interactionId: selection.isolatedInteractionId,
        environmentId: sharedEnvIdRef.current || agentSession.environmentId,
        label: isFirstTurn ? created.label : undefined, explores: nextCaState.explores,
        content: {
          agentId: selection.agentId, agentName: selection.agentName, caConversationId: created.caConversationId,
          embedPath: created.embedPath, rationale: selection.rationale,
        },
        messages: nextMsgs, isFirstTurn, userPrompt: userQuestion, assistantText,
      })
    } catch (err: unknown) {
      setMessages((prev) => [...prev, { role: 'error', text: resetOAuthOnUnauthorized(err) }])
    } finally {
      setBusyStatus(null)
    }
  }

  const handleRunHealthCheck = async (
    customFocus?: string,
    baseMessages?: ChatMessage[],
    images?: PastedImage[],
    existingConvId?: string
  ) => {
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
      resolvedUseCaseByIdRef.current[convId] = 'health-check'
      const isExistingRep = contentItemsRef.current.some((it) => it.key === `report:${finalReport.id}`)
      setHealthReport(finalReport); setActiveObjectId(finalReport.id)
      const upRep = upsertContentItem({
        id: String(finalReport.id), reportId: String(finalReport.id), contentType: 'report',
        title: finalReport.title, embedPath: `/health-check/${encodeURIComponent(String(finalReport.id))}`,
        updatedAt: finalReport.updatedAt, source: isExistingRep ? 'modified' : 'created',
        createdInConversation: true, hidden: false,
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
      setMessages(nextHealthMsgs)
      setSelectedUseCase('health-check')
      void persistConversationAndLabel({
        id: convId, type: 'health-check',
        interactionId: finalReport.lastInteractionId || agentSession.lastInteractionId,
        environmentId: finalReport.environmentId || agentSession.environmentId,
        label: isFirstTurn ? finalReport.title : undefined, explores: selectedExplores,
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
        for (let pIdx = 0; pIdx < probes.length; pIdx += 1) {
          const [artifactType, loaderKey] = probes[pIdx]
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
    const routeConvId = parsedRoute.conversationId
    const id = parsedRoute.objectId
    const convMatch = conversations.find((c) => c.id === routeConvId || c.id === id)
    if (routeConvId && (convMatch || /^conv_/i.test(routeConvId)) && routeConvId !== activeConversationIdRef.current) {
      setActiveConversationId(routeConvId)
    }
    if (!id) return
    if (convMatch) {
      const hydrationKey = `${location.pathname}:${convMatch.id}`
      const isOptimisticInFlight = !convMatch.interactionId && messages.length > 0
      if (hydratedConvRouteRef.current !== hydrationKey && !isOptimisticInFlight) {
        hydratedConvRouteRef.current = hydrationKey
        const initialItems = hydrateConversationContentItems(convMatch)
        if (initialItems.length > 0) {
          setContentItems(initialItems)
          const fallbackTab = initialItems.filter((it) => !it.hidden).slice(-1)[0]?.key || ''
          setActiveContentTabKey(convMatch.activeContentTabKey ?? fallbackTab)
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
      }
    }
    const convTargetId = getConvTargetId(convMatch?.content, convMatch?.type)
    const isPureConvId = /^conv_/i.test(id) && parsedRoute.useCase === 'auto'
    const targetArtifactId = convTargetId || (!isPureConvId ? id : '')
    if (!targetArtifactId) return
    if (!convTargetId) {
      if ((id === activeConversationId || id === agentSession.lastInteractionId) && !activeObjectId) return
    }
    if (convMatch && !convTargetId && !catalogItems.some((it) => it.id === targetArtifactId)) return
    const resolvedRouteType =
      (convMatch && convMatch.type !== 'auto' ? convMatch.type : undefined) ||
      (parsedRoute.useCase && parsedRoute.useCase !== 'auto' ? parsedRoute.useCase : undefined) ||
      inferredRouteUseCase
    const targetMode = resolvedRouteType ? normalizeCatalogMode(resolvedRouteType) : activeMode
    const loadedPair: [string | undefined, string] = (resolvedRouteType === 'conversational-analytics' || isCaMode)
      ? [caConversation?.caConversationId, lastCaIdRef.current]
      : targetMode === 'lookml'
      ? [lookmlBundle?.project_id || lookmlBundle?.id, lastLookmlIdRef.current]
      : targetMode === 'health'
      ? [healthReport?.id, lastHealthIdRef.current]
      : targetMode === 'dashboard'
      ? [nativeContent?.id, lastNativeIdRef.current]
      : targetMode === 'tile'
      ? [loadedScript ? scriptId : undefined, lastScriptIdRef.current]
      : [publishedApp?.dashboardId, lastPublishedIdRef.current]
    if (
      targetArtifactId !== loadedPair[0] &&
      targetArtifactId !== loadedPair[1] &&
      !(targetMode === 'lookml' && targetArtifactId === lookmlBundle?.id)
    ) {
      const dispatchType =
        resolvedRouteType || (isCaMode ? 'conversational-analytics' : parsedRoute.useCase === 'auto' ? 'auto' : activeMode)
      void openArtifactByMode(dispatchType, targetArtifactId, false)
    }
  }, [
    isTileMount, location.pathname, activeMode, disabledModes, parsedRoute.conversationId, parsedRoute.isLegacyRoute,
    parsedRoute.objectId, parsedRoute.useCase, inferredRouteUseCase, isCaMode, publishedApp?.dashboardId,
    nativeContent?.id, lookmlBundle?.id, lookmlBundle?.project_id, healthReport?.id, caConversation?.caConversationId, loadedScript, scriptId,
    openArtifactByMode, conversations, catalogItems, messages.length, activeConversationId, activeObjectId,
    agentSession.lastInteractionId, mergeCachedActivitySteps, setActiveContentTabKey,
    setActiveConversationId, setAgentSession, setContentItems, setMessages, setSelectedExplores, sharedEnvIdRef,
  ])

  const handleResetNewApp = useCallback(
    (_resetToDefaultRoute?: boolean | React.MouseEvent, presetUseCase?: StudioUseCase) => {
      const nextUseCase: StudioUseCase = typeof presetUseCase === 'string' && presetUseCase ? presetUseCase : 'auto'
      const freshConvId = `conv_${Date.now()}`
      hydratedConvRouteRef.current = ''
      lastPublishedIdRef.current = ''
      lastNativeIdRef.current = ''
      lastLookmlIdRef.current = ''
      lastHealthIdRef.current = ''
      lastCaIdRef.current = ''
      lastScriptIdRef.current = ''
      setLoadedScript(false)
      setActiveObjectId('')
      setActiveConversationId(freshConvId)
      setConversations((prev) => prev, { optimisticEntry: null })
      setPublishedAppState(null)
      setNativeContentState(null)
      setActiveViewerDocument(null)
      setContentItems([])
      setActiveContentTabKey('')
      setLookmlBundle(null)
      setHealthReport(null)
      setCaConversation(null)
      setCurrentAppCode('')
      setSelectedExplores([])
      setMentionedItems([])
      setAgentSession({
        environmentId: sharedEnvIdRef.current || undefined,
        lastInteractionId: undefined,
        conversationId: freshConvId,
      })
      setMessages([])
      setPastedImages([])
      setPrompt('')
      explicitUseCaseRef.current = nextUseCase
      setSelectedUseCase(nextUseCase)
      if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarCollapsed(true)
      if (location.pathname !== '/') history.replace('/')
    },
    [explicitUseCaseRef, history, location.pathname, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setAgentSession, setContentItems, setConversations, setMentionedItems, setMessages, setSelectedExplores, setSelectedUseCase, setSidebarCollapsed, sharedEnvIdRef]
  )

  const handleNewConversation = useCallback(
    (presetUseCase?: StudioUseCase | React.MouseEvent) =>
      handleResetNewApp(true, typeof presetUseCase === 'string' ? presetUseCase : 'auto'),
    [handleResetNewApp]
  )

  const syncContentItemViewer = useCallback(
    (item: StudioContentItem | null | undefined) => {
      if (!item) return
      const ct = item.contentType
      if (ct === 'dashboard' || ct === 'lookml_dashboard' || ct === 'look' || ct === 'board') {
        setNativeContentState((prev) => ({
          id: item.id, title: item.title, contentType: ct, embedPath: item.embedPath,
          folderId: item.folderId || prev?.folderId || selectedFolderId,
          dashboardId: item.dashboardId, lookId: item.lookId, lookmlDashboardId: item.lookmlDashboardId,
        }))
      } else if (ct === 'data_app' || ct === 'data-investigator') {
        const dashId = String(item.dashboardId || item.id)
        setPublishedAppState((prev) =>
          prev && prev.dashboardId === dashId
            ? prev
            : { dashboardId: dashId, title: item.title, folderId: item.folderId || prev?.folderId || selectedFolderId, extensionId: item.extensionId || prev?.extensionId || '', elementId: prev?.elementId || '' }
        )
        if (!currentAppCode && dashId) {
          void loadExistingDashboardApp(core40SDK, dashId).then((l) => { setCurrentAppCode(l.code); setPublishedAppState(l) }).catch(() => {})
        }
      } else if (ct === 'lookml') {
        const targetProj = item.projectId || item.id
        if (lookmlBundle?.project_id !== targetProj && lookmlBundle?.id !== item.id && lookmlBundle?.id !== item.sessionId) {
          void loadLookmlSessionArtifact(core40SDK, extensionSDK, targetProj, item.sessionId).then((l) => { setLookmlBundle(l.bundle); if (l.bundle?.project_id) setLookmlProjectId(l.bundle.project_id) }).catch(() => {})
        }
      } else if (ct === 'script' && (!loadedScript || scriptId !== item.id)) {
        setLoadedScript(true); setScriptId(item.id)
        void loadScriptArtifact(core40SDK, item.id).then((l) => { if (l) { setScriptTitle(l.title || l.id); setScriptCode(l.code || DEFAULT_PYTHON_SCRIPT); void handleRunPython(l.code || DEFAULT_PYTHON_SCRIPT, filtersJson) } }).catch(() => {})
      } else if (ct === 'report' && healthReport?.id !== item.id) {
        void loadHealthCheckArtifact(core40SDK, extensionSDK, item.id).then(setHealthReport).catch(() => {})
      } else if (ct === 'conversational-analytics') {
        setCaConversation((prev) =>
          prev && prev.caConversationId === item.id
            ? prev
            : { id: item.id, caConversationId: item.id, agentId: '', agentName: item.title, embedPath: item.embedPath, title: item.title, label: item.title, rationale: '', selectionRationale: '', initialPrompt: item.title, explores: selectedExplores, updatedAt: item.updatedAt || '' }
        )
      }
    },
    [core40SDK, currentAppCode, extensionSDK, filtersJson, handleRunPython, healthReport?.id, loadedScript, lookmlBundle?.id, lookmlBundle?.project_id, scriptId, selectedExplores, selectedFolderId]
  )

  const persistTabStateToConversation = useCallback(
    (nextItems: StudioContentItem[], nextActiveKey: string) => {
      const convId = activeConversationIdRef.current
      if (!convId || !conversations.some((c) => c.id === convId)) return
      void saveUserConversation(
        core40SDK, userIdRef.current || userId,
        { id: convId, contentItems: nextItems, activeContentTabKey: nextActiveKey, updatedAt: new Date().toISOString() },
        getArtifactNamespace(extensionSDK)
      ).then((list) => setConversations(list)).catch(() => {})
    },
    [conversations, core40SDK, extensionSDK, setConversations, userId, userIdRef]
  )

  const handleSelectContentTab = useCallback(
    (key: string) => {
      setActiveViewerDocument(null)
      const existing = contentItemsRef.current.find((it) => it.key === key)
      if (!existing) { setActiveContentTabKey(key); return }
      const nextItems = existing.hidden
        ? contentItemsRef.current.map((it) => (it.key === key ? { ...it, hidden: false } : it))
        : contentItemsRef.current
      if (existing.hidden) setContentItems(nextItems)
      setActiveContentTabKey(key)
      syncContentItemViewer({ ...existing, hidden: false })
      persistTabStateToConversation(nextItems, key)
    },
    [persistTabStateToConversation, setActiveContentTabKey, setContentItems, syncContentItemViewer]
  )

  const handleHideContentTab = useCallback(
    (key: string) => {
      const visibleBefore = contentItemsRef.current.filter((it) => !it.hidden)
      const closedIdx = visibleBefore.findIndex((it) => it.key === key)
      const nextItems = contentItemsRef.current.map((it) => (it.key === key ? { ...it, hidden: true } : it))
      const rem = nextItems.filter((it) => !it.hidden)
      const nextActiveItem =
        rem.length === 0
          ? null
          : activeContentTabKeyRef.current !== key && rem.some((it) => it.key === activeContentTabKeyRef.current)
          ? rem.find((it) => it.key === activeContentTabKeyRef.current) || null
          : rem[Math.min(Math.max(0, closedIdx), rem.length - 1)] || null
      const nextKey = nextActiveItem?.key || ''
      setContentItems(nextItems)
      setActiveContentTabKey(nextKey)
      if (nextActiveItem) syncContentItemViewer(nextActiveItem)
      persistTabStateToConversation(nextItems, nextKey)
    },
    [persistTabStateToConversation, setActiveContentTabKey, setContentItems, syncContentItemViewer]
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
      const targetPath = `/c/${encodeURIComponent(conv.id)}`
      hydratedConvRouteRef.current = `${targetPath}:${conv.id}`
      if (location.pathname !== targetPath) history.push(targetPath)
      const initialItems = hydrateConversationContentItems(conv)
      setContentItems(initialItems)
      const initialVisible = initialItems.filter((it) => !it.hidden)
      const initialTabKey = conv.activeContentTabKey ?? (initialVisible[initialVisible.length - 1]?.key || '')
      setActiveContentTabKey(initialTabKey)
      if (conv.explores?.length) setSelectedExplores(conv.explores)
      const targetId = getConvTargetId(conv.content, conv.type)
      if (targetId) {
        resolvedUseCaseByIdRef.current[targetId] = useCase
        setActiveObjectId(targetId)
        await openArtifactByMode(conv.type, targetId, false)
      } else {
        setLoadedScript(false)
        setActiveObjectId('')
      }
      if (initialTabKey && contentItemsRef.current.some((it) => it.key === initialTabKey && !it.hidden)) {
        setActiveContentTabKey(initialTabKey)
        syncContentItemViewer(contentItemsRef.current.find((it) => it.key === initialTabKey))
      }
      setActiveConversationId(conv.id)
      if (conv.messages?.length) setMessages(mergeCachedActivitySteps(conv.messages as ChatMessage[]))
      else if (!targetId) setMessages([])
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
    [explicitUseCaseRef, history, location.pathname, mergeCachedActivitySteps, openArtifactByMode, resolvedUseCaseByIdRef, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setAgentSession, setContentItems, setMessages, setSelectedExplores, setSelectedUseCase, setSidebarCollapsed, sharedEnvIdRef, syncContentItemViewer]
  )

  const handleToggleArchiveConversation = (
    e: React.MouseEvent | undefined,
    conversationId: string,
    nextArchived?: boolean
  ) => {
    e?.stopPropagation()
    const current = conversations.find((c) => c.id === conversationId)
    const archived = typeof nextArchived === 'boolean' ? nextArchived : !current?.archived
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, archived } : c)))
    return archiveUserConversation(
      core40SDK, userIdRef.current || userId, conversationId, archived, getArtifactNamespace(extensionSDK)
    ).then(setConversations, () => {})
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

  const handleDeleteConversation = (
    e: React.MouseEvent | undefined,
    conversationId: string,
    deleteRelated = false,
    explicitTarget?: ConversationRecord
  ) => {
    e?.stopPropagation()
    const cleanId = String(conversationId || '').trim()
    const target = explicitTarget || conversations.find((c) => c.id === cleanId)
    const targetIds = new Set(
      [cleanId, target?.objectId, getConvTargetId(target?.content, target?.type), ...(target?.contentItems || []).map((it) => it.id)]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    )
    const routeSeg = decodeURIComponent(location.pathname.replace(/^\/c\//, '').replace(/^\/+|\/+$/g, ''))
    const isDeletingActive =
      activeConversationIdRef.current === cleanId ||
      activeConversationId === cleanId ||
      (Boolean(parsedRoute.conversationId) && targetIds.has(parsedRoute.conversationId)) ||
      (Boolean(parsedRoute.objectId) && targetIds.has(parsedRoute.objectId)) ||
      (Boolean(routeSeg) && location.pathname !== '/' && location.pathname !== '/config' && targetIds.has(routeSeg)) ||
      (Boolean(activeObjectId) && targetIds.has(activeObjectId))

    setConversations((prev) => prev.filter((c) => c.id !== cleanId), { optimisticEntry: null })
    if (isDeletingActive) handleNewConversation()
    return deleteUserConversation(
      core40SDK, userIdRef.current || userId, cleanId,
      { deleteRelatedContent: deleteRelated, conversation: target },
      getArtifactNamespace(extensionSDK)
    ).then((next) => setConversations(next, { optimisticEntry: null }), () => {})
  }

  const handleConfirmDeleteConversation = (overrideDeleteRelated?: boolean) => {
    if (!pendingDeleteConv) return Promise.resolve()
    const target = pendingDeleteConv
    const shouldDeleteRelated = typeof overrideDeleteRelated === 'boolean' ? overrideDeleteRelated : deleteRelatedContent
    setPendingDeleteConv(null)
    setDeleteRelatedContent(false)
    return handleDeleteConversation(undefined, target.id, shouldDeleteRelated, target)
  }

  return {
    caConversation, setCaConversation, lastCaIdRef, isCaMode,
    lookmlProjectId, setLookmlProjectId, activatedLookmlSkills, setActivatedLookmlSkills,
    lookmlBundle, setLookmlBundle, lastLookmlIdRef,
    publishedApp, setPublishedAppState, setPublishedApp, lastPublishedIdRef,
    nativeContent, setNativeContentState, setNativeContent, lastNativeIdRef,
    contentItems, contentItemsRef, setContentItems,
    activeContentTabKey, activeContentTabKeyRef, setActiveContentTabKey,
    activeContentItem, upsertContentItem,
    handleSelectContentTab, handleHideContentTab,
    embedNonce, setEmbedNonce, bumpEmbedNonce,
    healthReport, setHealthReport, lastHealthIdRef,
    scriptId, setScriptId, scriptTitle, setScriptTitle,
    scriptCode, setScriptCode, filtersJson, setFiltersJson,
    scriptOutput, setScriptOutput, scriptMode, setScriptMode,
    publishedTileDash, setPublishedTileDash, schedulerOpen, setSchedulerOpen,
    infoModalUseCase, setInfoModalUseCase,
    scheduleConfig, setScheduleConfig, savedScheduleBadge, setSavedScheduleBadge,
    loadedScript, setLoadedScript, lastScriptIdRef,
    currentAppCode, setCurrentAppCode,
    activeViewerDocument, setActiveViewerDocument,
    prompt, setPrompt, pastedImages, setPastedImages,
    showArchivedConversations, setShowArchivedConversations,
    pendingDeleteConv, setPendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent,
    activeConversationId, activeConversationIdRef, setActiveConversationId,
    hydratedConvRouteRef, activityStepsByInteractionIdRef, mergeCachedActivitySteps,
    modeAllowedConversations, filteredConversations, archivedConversations,
    persistConversationAndLabel,
    loadNativeById, loadLookmlSessionById, loadCaConversationById, loadScriptById,
    handleRunPython, handleSaveScript, handlePublishTileDashboard,
    handleRunHealthCheck, handleRunConversationalAnalytics,
    handleResetNewApp, handleNewConversation, handleSelectConversation,
    handleToggleArchiveConversation, handleRequestDeleteConversation,
    handleCancelDeleteConversation, handleConfirmDeleteConversation, handleDeleteConversation,
  }
}

export type StudioLoaders = ReturnType<typeof useStudioLoaders>
