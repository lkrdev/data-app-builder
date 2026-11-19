import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  AntigravityActivityStep, cleanLookmlProjectId, extractSkillNameFromPath,
  fetchConversationSandboxDebugMarkdown, fetchEnvironmentFile,
  hydrateInteractionActivitySteps, hydrateRemoteConversationMessages, normalizeEnvironmentId,
  normalizeSandboxFilePath, resolveBuiltinWorkspaceFileContent,
} from './antigravity'
import { ChatMessage } from './components/App'
import { DEFAULT_PYTHON_SCRIPT } from './components/PythonTile'
import { loadHealthCheckArtifact } from './healthCheck'
import {
  archiveUserConversation, ConversationRecord, copyTextWithExtensionSdk,
  deleteLocalDraftScript, deleteUserConversation, getArtifactNamespace, getConvTargetId,
  hydrateConversationContentItems, isLookmlTargetAlreadyLoaded, isUserConversationDeleted, loadAlertArtifact,
  loadExistingDashboardApp, loadLocalDraftScript, loadScriptArtifact, normalizeStudioContentItem,
  readInFlightConvIds, resolveConversationRelatedContent, saveUserConversation, searchGlobalContentV2,
  STUDIO_OVERVIEW_TAB_KEY, StudioContentItem,
} from './lookerApi'
import { loadLookmlSessionArtifact } from './lookmlTool'
import {
  getErrorMessage, normalizeCatalogMode, QueuedPromptItem,
  StudioEnvironmentStatus, useStudioAuthAndPrefs,
} from './studioControllerAuth'
import { nextStudioConvId, resumeInFlightConversationTurn } from './studioControllerConcurrency'
import { StudioViewerDocument, useStudioLoaders } from './studioControllerLoaders'
import { useStudioMetadata } from './studioControllerMetadata'
import { useStudioTurn } from './studioControllerTurn'

export {
  authenticateGoogleOAuth, computeIsAuthenticated, DEFAULT_MAX_TOOL_ROUNDS, DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_THINKING_LEVEL, loadStoredThinkingLevel, loadStoredThinkingLevelByModel, normalizeMaxToolRounds, normalizeMaxTotalTokens,
  normalizeThinkingLevel, normalizeThinkingLevelByModel, persistThinkingLevel, persistThinkingLevelByModel, readInitialThinkingLevel,
  readInitialThinkingLevelByModel, recoverInFlightInteraction, refreshOAuthSessionIfNeeded, resolveLookerOAuthRedirectUri,
  resolveLookerOAuthRedirectUris, STUDIO_MAX_TOOL_ROUNDS_OPTIONS, STUDIO_MAX_TOTAL_TOKENS_OPTIONS,
  STUDIO_OAUTH_REFRESH_LOCK_KEY, STUDIO_OAUTH_STORAGE_KEY,
  STUDIO_THINKING_LEVEL_BY_MODEL_STORAGE_KEY, STUDIO_THINKING_LEVEL_OPTIONS, STUDIO_THINKING_LEVEL_STORAGE_KEY,
} from './antigravity'
export type { StudioThinkingLevel } from './antigravity'
export {
  addInFlightConvId, clearInFlightConvId, DEFAULT_BUSY_SEND_ACTION, loadStoredBusySendAction, loadStoredSelectedFolderId,
  normalizeBusySendAction, normalizeStudioThemeMode, persistSelectedFolderId,
  readInFlightConvId, readInFlightConvIds, readInitialBusySendAction, readInitialSelectedFolderId,
  removeInFlightConvId, resolveStudioTheme,
  resolveSystemTheme, saveInFlightConvId, saveStoredBusySendAction, STUDIO_BUSY_SEND_ACTION_STORAGE_KEY,
  STUDIO_FOLDER_STORAGE_KEY, STUDIO_INFLIGHT_CONV_SESSION_KEY, STUDIO_THEME_STORAGE_KEY,
} from './lookerApi'
export { getConvTargetId }
export { nextStudioConvId, resumeInFlightConversationTurn }
export type {
  ResolvedStudioTheme, StudioBusySendAction, StudioContextCategory,
  StudioContextMention, StudioThemeMode,
} from './lookerApi'
export type { QueuedPromptItem, StudioEnvironmentStatus, StudioViewerDocument }

export function useStudioController() {
  const auth = useStudioAuthAndPrefs()
  const meta = useStudioMetadata(auth)
  const loaders = useStudioLoaders(auth, meta)
  const turn = useStudioTurn(auth, meta, loaders)

  const {
    extensionSDK, core40SDK, history, location, isTileMount, selectedModel, thinkingLevel,
    parsedRoute, setRightPaneCollapsed, setSidebarCollapsed,
    sharedEnvIdRef, agentSession, agentSessionRef, messages, setAgentSession, setMessages,
    getAuthCfg, selectEpochRef, getConvMessages, setConvMessages, deleteConvMessages,
    busyStatus, activeConversationId, activeConversationIdRef, setActiveConversationId,
    liveActivitySteps, liveActivityStepsRef, inFlightTurnsRef, turnResumerRef, onTurnAbortedRef, abortConvTurn,
  } = auth
  const {
    userId, userIdRef, setSelectedExplores, selectedExplores, setMentionedItems,
    selectedFolderId, schemaMarkdown, activeObjectId, setActiveObjectId,
    conversations, conversationsRef, setConversations, setSavedScripts,
    caConversation, setCaConversation, lastCaIdRef,
    setLookmlProjectId, lookmlBundle, setLookmlBundle, lastLookmlIdRef, setActivatedLookmlSkills,
    publishedApp, setPublishedAppState, lastPublishedIdRef,
    nativeContent, setNativeContentState, lastNativeIdRef,
    alertBundle, setAlertBundle,
    contentItems, contentItemsRef, setContentItems,
    activeContentTabKeyRef, setActiveContentTabKey,
    healthReport, setHealthReport, lastHealthIdRef,
    scriptId, setScriptId, setScriptTitle, setScriptCode, filtersJson, setPublishedTileDash,
    loadedScript, setLoadedScript, lastScriptIdRef,
    currentAppCode, setCurrentAppCode,
    setActiveViewerDocument, setPrompt, setPastedImages,
    pendingDeleteConv, setPendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent,
    hydratedConvRouteRef, activityStepsByInteractionIdRef, mergeCachedActivitySteps,
  } = meta
  const { openArtifactByMode, handleRunPython, recoveredInFlightIdsRef } = loaders
  const { latestTurnInteractionRef } = turn

  onTurnAbortedRef.current = (cid, reasonText, partialSteps) => {
    const conv = conversationsRef.current.find((c) => c.id === cid)
    if (conv?.interactionId) recoveredInFlightIdsRef.current.add(conv.interactionId)
    if (latestTurnInteractionRef.current?.convId === cid && latestTurnInteractionRef.current.id) {
      recoveredInFlightIdsRef.current.add(latestTurnInteractionRef.current.id)
    }
    const ns = getArtifactNamespace(extensionSDK), uid = userIdRef.current || userId
    if (!conv || isUserConversationDeleted(core40SDK, uid, cid, ns)) return
    const stopMsg: ChatMessage = Object.assign(
      { role: 'assistant' as const, text: reasonText || 'Stopped by user.' },
      partialSteps?.length ? { activitySteps: partialSteps } : null
    )
    const prior = getConvMessages(cid)
    setConvMessages(cid, [...prior, stopMsg])
    const updated = Object.assign({}, conv, { inFlight: false, updatedAt: new Date().toISOString() })
    setConversations((prev) => [updated, ...prev.filter((c) => c.id !== cid)], { optimisticEntry: null })
    if (uid) void saveUserConversation(core40SDK, uid, updated, ns).catch(() => {})
  }

  const [sandboxMarkdownCache, setSandboxMarkdownCache] = useState<Record<string, string>>({})
  const sandboxMarkdownCacheRef = useRef<Record<string, string>>({})
  sandboxMarkdownCacheRef.current = sandboxMarkdownCache
  const inFlightSandboxFilesRef = useRef<Record<string, Promise<string> | undefined>>({})
  const [sandboxMarkdownLoading, setSandboxMarkdownLoading] = useState<Record<string, boolean>>({})
  const [activeSandboxMarkdownModalPath, setActiveSandboxMarkdownModalPath] = useState<string | null>(null)
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
        auth: getAuthCfg(),
        interactionId: cleanId, stopAtInteractionId,
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
    [activityStepsByInteractionIdRef, extensionSDK, getAuthCfg, setMessages]
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
        auth: getAuthCfg(),
        environmentId: envId, path: normalizedPath,
      })
        .then(storeCache, (err: unknown) =>
          storeCache(`# Error Loading File\n\nUnable to load \`${displayPath}\` from sandbox environment \`${envId}\`: ${getErrorMessage(err)}`)
        )
        .finally(() => { delete inFlightSandboxFilesRef.current[cacheKey]; setLoading(false) })
      inFlightSandboxFilesRef.current[cacheKey] = reqPromise
      return reqPromise
    },
    [agentSessionRef, extensionSDK, getAuthCfg, resolveLocalWorkspaceFile, sharedEnvIdRef]
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
      extensionSDK,
      auth: getAuthCfg(),
      conversationId: activeConversationId || activeConv?.id, label: activeConv?.label,
      model: selectedModel, thinkingLevel,
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
    activeConversationId, agentSession, busyStatus,
    contentItems, conversations, extensionSDK, getAuthCfg, latestTurnInteractionRef, liveActivitySteps, liveActivityStepsRef, messages, selectedModel,
    sharedEnvIdRef, thinkingLevel,
  ])

  const handleResetNewApp = useCallback(
    (_resetToDefaultRoute?: boolean | React.MouseEvent) => {
      if (location.pathname === '/config' && (!auth.isConfigured || Boolean(busyStatus))) return
      selectEpochRef.current += 1
      const freshConvId = nextStudioConvId()
      hydratedConvRouteRef.current = ''
      if (location.pathname !== '/') history.replace('/')
      lastPublishedIdRef.current = ''
      lastNativeIdRef.current = ''
      lastLookmlIdRef.current = ''
      lastHealthIdRef.current = ''
      lastCaIdRef.current = ''
      lastScriptIdRef.current = ''
      setLoadedScript(false)
      setPublishedTileDash(null)
      setActiveObjectId('')
      setActiveConversationId(freshConvId)
      setPublishedAppState(null)
      setNativeContentState(null)
      setActiveViewerDocument(null)
      setContentItems([])
      setActiveContentTabKey('')
      setLookmlBundle(null)
      setLookmlProjectId('')
      setAlertBundle(null)
      setHealthReport(null)
      setCaConversation(null)
      setCurrentAppCode('')
      setSelectedExplores([])
      setMentionedItems([])
      setActivatedLookmlSkills([])
      setAgentSession({
        environmentId: sharedEnvIdRef.current || undefined,
        lastInteractionId: undefined,
        conversationId: freshConvId,
      })
      setMessages([])
      setPastedImages([])
      setPrompt('')
      if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarCollapsed(true)
    },
    [auth.isConfigured, busyStatus, history, hydratedConvRouteRef, lastCaIdRef, lastHealthIdRef, lastLookmlIdRef, lastNativeIdRef, lastPublishedIdRef, lastScriptIdRef, location.pathname, selectEpochRef, setActivatedLookmlSkills, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setActiveViewerDocument, setAgentSession, setAlertBundle, setCaConversation, setContentItems, setCurrentAppCode, setHealthReport, setLoadedScript, setLookmlBundle, setLookmlProjectId, setMentionedItems, setMessages, setNativeContentState, setPastedImages, setPrompt, setPublishedAppState, setPublishedTileDash, setSelectedExplores, setSidebarCollapsed, sharedEnvIdRef]
  )

  const handleNewConversation = useCallback(
    (_ev?: React.MouseEvent) => handleResetNewApp(true),
    [handleResetNewApp]
  )

  turn.onResetAppStateRef.current = () => handleResetNewApp(true)
  turn.onClearSandboxFileCacheRef.current = () => {
    sandboxMarkdownCacheRef.current = {}
    setSandboxMarkdownCache({})
  }

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
        const targetProj = cleanLookmlProjectId(item.projectId) || cleanLookmlProjectId(item.id)
        if (targetProj && !isLookmlTargetAlreadyLoaded('lookml', targetProj, lookmlBundle?.id || lookmlBundle?.project_id ? { id: lookmlBundle.id, project_id: lookmlBundle.project_id } : null, item.sessionId) && lookmlBundle?.id !== item.id) {
          void loadLookmlSessionArtifact(core40SDK, extensionSDK, targetProj, item.sessionId, {
            auth: getAuthCfg(), environmentId: sharedEnvIdRef.current, lastInteractionId: agentSessionRef.current.lastInteractionId, explores: selectedExplores,
          }).then((l) => { setLookmlBundle(l.bundle); const vp = cleanLookmlProjectId(l.bundle?.project_id); if (vp) setLookmlProjectId(vp) }).catch(() => {})
        }
      } else if (ct === 'script' && (!loadedScript || scriptId !== item.id)) {
        setLoadedScript(true); setScriptId(item.id)
        void loadLocalDraftScript(item.id, extensionSDK)
          .then((local) => local || loadScriptArtifact(core40SDK, item.id, getArtifactNamespace(extensionSDK)))
          .then((l) => {
            setPublishedTileDash(l?.dashboardId ? { dashboardId: l.dashboardId, elementId: l.elementId || '' } : null)
            if (l) { setScriptTitle(l.title || l.id); setScriptCode(l.code || DEFAULT_PYTHON_SCRIPT); void handleRunPython(l.code || DEFAULT_PYTHON_SCRIPT, filtersJson) }
          })
          .catch(() => {})
      } else if (ct === 'alert' && alertBundle?.alert_id !== (item.alertId || item.id)) {
        void loadAlertArtifact(core40SDK, item.alertId || item.id, getArtifactNamespace(extensionSDK)).then((l) => { if (l) setAlertBundle(l) }).catch(() => {})
      } else if (ct === 'report' && healthReport?.id !== item.id) {
        void loadHealthCheckArtifact(core40SDK, extensionSDK, item.id, {
          auth: getAuthCfg(), environmentId: sharedEnvIdRef.current, lastInteractionId: agentSessionRef.current.lastInteractionId,
        }).then(setHealthReport).catch(() => {})
      } else if (ct === 'conversational-analytics') {
        setCaConversation((prev) =>
          prev && prev.caConversationId === item.id
            ? prev
            : { id: item.id, caConversationId: item.id, agentId: '', agentName: item.title, embedPath: item.embedPath, title: item.title, label: item.title, rationale: '', selectionRationale: '', initialPrompt: item.title, explores: selectedExplores, updatedAt: item.updatedAt || '' }
        )
      }
    },
    [agentSessionRef, alertBundle?.alert_id, core40SDK, currentAppCode, extensionSDK, filtersJson, getAuthCfg, handleRunPython, healthReport?.id, loadedScript, lookmlBundle?.id, lookmlBundle?.project_id, scriptId, selectedExplores, selectedFolderId, setAlertBundle, setCaConversation, setCurrentAppCode, setHealthReport, setLoadedScript, setLookmlBundle, setLookmlProjectId, setNativeContentState, setPublishedAppState, setPublishedTileDash, setScriptCode, setScriptId, setScriptTitle, sharedEnvIdRef]
  )

  const persistTabStateToConversation = useCallback(
    (nextItems: StudioContentItem[], nextActiveKey: string) => {
      const convId = activeConversationIdRef.current
      if (!convId || !conversations.some((c) => c.id === convId)) return
      const cleanKey = nextActiveKey === STUDIO_OVERVIEW_TAB_KEY ? '' : nextActiveKey
      void saveUserConversation(
        core40SDK, userIdRef.current || userId,
        { id: convId, contentItems: nextItems, activeContentTabKey: cleanKey, updatedAt: new Date().toISOString() },
        getArtifactNamespace(extensionSDK)
      ).then((list) => setConversations(list)).catch(() => {})
    },
    [activeConversationIdRef, conversations, core40SDK, extensionSDK, setConversations, userId, userIdRef]
  )

  const handleSelectOverview = useCallback(() => {
    setActiveViewerDocument(null)
    setActiveContentTabKey(STUDIO_OVERVIEW_TAB_KEY)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('dab:stage-nav'))
  }, [setActiveContentTabKey, setActiveViewerDocument])

  const handleSelectContentTab = useCallback(
    (key: string) => {
      setActiveViewerDocument(null)
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('dab:stage-nav'))
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
    [contentItemsRef, persistTabStateToConversation, setActiveContentTabKey, setActiveViewerDocument, setContentItems, syncContentItemViewer]
  )

  const handleHideContentTab = useCallback(
    (key: string) => {
      const visibleBefore = contentItemsRef.current.filter((it) => !it.hidden)
      const closedIdx = visibleBefore.findIndex((it) => it.key === key)
      const nextItems = contentItemsRef.current.map((it) => (it.key === key ? { ...it, hidden: true } : it))
      const rem = nextItems.filter((it) => !it.hidden)
      const stayInOverview = rem.length > 0 && activeContentTabKeyRef.current === STUDIO_OVERVIEW_TAB_KEY
      const nextActiveItem =
        rem.length === 0 || stayInOverview
          ? null
          : activeContentTabKeyRef.current !== key && rem.some((it) => it.key === activeContentTabKeyRef.current)
          ? rem.find((it) => it.key === activeContentTabKeyRef.current) || null
          : rem[Math.min(Math.max(0, closedIdx), rem.length - 1)] || null
      const nextKey = stayInOverview ? STUDIO_OVERVIEW_TAB_KEY : nextActiveItem?.key || ''
      setContentItems(nextItems)
      setActiveContentTabKey(nextKey)
      if (nextActiveItem) syncContentItemViewer(nextActiveItem)
      persistTabStateToConversation(nextItems, nextKey)
    },
    [activeContentTabKeyRef, contentItemsRef, persistTabStateToConversation, setActiveContentTabKey, setContentItems, syncContentItemViewer]
  )

  const handleSelectConversation = useCallback(
    async (conv: ConversationRecord) => {
      const myEpoch = ++selectEpochRef.current
      setActiveViewerDocument(null)
      if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarCollapsed(true)
      const mode = normalizeCatalogMode(conv.type)
      const liveTurn = inFlightTurnsRef.current.get(conv.id)
      if (liveTurn) {
        setActiveConversationId(conv.id)
        const targetPath = `/c/${encodeURIComponent(conv.id)}`
        hydratedConvRouteRef.current = `${targetPath}:${conv.id}`
        if (location.pathname !== targetPath) history.push(targetPath)
        const snap = liveTurn.snapshot
        setContentItems(snap.contentItems)
        setActiveContentTabKey(snap.activeContentTabKey)
        setSelectedExplores(snap.selectedExplores)
        setPublishedAppState(snap.publishedApp)
        setNativeContentState(snap.nativeContent)
        setCurrentAppCode(snap.currentAppCode)
        setLookmlBundle(snap.lookmlBundle)
        setLookmlProjectId(snap.lookmlProjectId)
        setAlertBundle(snap.alertBundle)
        if (snap.scriptId) {
          setLoadedScript(true); setScriptId(snap.scriptId); setScriptTitle(snap.scriptTitle); setScriptCode(snap.scriptCode)
        } else {
          setLoadedScript(false)
        }
        setActiveObjectId(snap.publishedApp?.dashboardId || snap.nativeContent?.id || snap.lookmlProjectId || String(snap.alertBundle?.alert_id || '') || snap.scriptId || '')
        setMessages(mergeCachedActivitySteps(snap.messagesWithUser))
        setAgentSession({
          lastInteractionId: conv.interactionId,
          environmentId: sharedEnvIdRef.current || conv.environmentId || 'env_app_isolated',
          conversationId: conv.id, explores: snap.selectedExplores,
        })
        return
      }
      const hydrated = await hydrateRemoteConversationMessages({
        extensionSDK, auth: getAuthCfg(), sdk: core40SDK, userId: userIdRef.current || userId,
        conv, activeEnvironmentId: sharedEnvIdRef.current,
      })
      if (selectEpochRef.current !== myEpoch || inFlightTurnsRef.current.has(conv.id)) return
      if (hydrated.expired) {
        loaders.applyExpiredHydration(conv.id, hydrated.prunedIds, hydrated.deadEnvironmentId)
        handleResetNewApp(true)
        return
      }
      if (hydrated.messages.length > 0) setConvMessages(conv.id, hydrated.messages)
      setActiveConversationId(conv.id)
      const targetPath = `/c/${encodeURIComponent(conv.id)}`
      hydratedConvRouteRef.current = `${targetPath}:${conv.id}`
      if (location.pathname !== targetPath) history.push(targetPath)
      const initialItems = hydrateConversationContentItems(conv)
      setContentItems(initialItems)
      const initialVisible = initialItems.filter((it) => !it.hidden)
      const savedTab = conv.activeContentTabKey === 'lookml:default' ? undefined : conv.activeContentTabKey
      const initialTabKey = savedTab ?? (initialVisible[initialVisible.length - 1]?.key || '')
      setActiveContentTabKey(initialTabKey)
      if (conv.explores?.length) setSelectedExplores(conv.explores)
      if (conv.interactionId || conv.environmentId || sharedEnvIdRef.current) {
        setAgentSession({
          lastInteractionId: conv.interactionId,
          environmentId: sharedEnvIdRef.current || conv.environmentId || 'env_app_isolated',
          conversationId: conv.id, explores: conv.explores,
        })
      }
      const targetId = getConvTargetId(conv.content, conv.type)
      if (targetId) {
        setActiveObjectId(targetId)
        await openArtifactByMode(conv.type, targetId, false)
        if (selectEpochRef.current !== myEpoch || activeConversationIdRef.current !== conv.id) return
      } else {
        setLoadedScript(false); setPublishedTileDash(null); setActiveObjectId('')
        setPublishedAppState(null); setNativeContentState(null)
        if (mode === 'lookml') { setLookmlBundle(null); setLookmlProjectId('') }
      }
      if (initialTabKey && contentItemsRef.current.some((it) => it.key === initialTabKey && !it.hidden)) {
        setActiveContentTabKey(initialTabKey)
        syncContentItemViewer(contentItemsRef.current.find((it) => it.key === initialTabKey))
      }
      setActiveConversationId(conv.id)
      if (hydrated.messages.length > 0) setMessages(mergeCachedActivitySteps(hydrated.messages))
      else if (!targetId) setMessages([])
      if (
        (conv.inFlight || readInFlightConvIds().includes(conv.id)) &&
        conv.interactionId &&
        !recoveredInFlightIdsRef.current.has(conv.interactionId)
      ) {
        recoveredInFlightIdsRef.current.add(conv.interactionId)
        void turnResumerRef.current?.(conv)
      }
    },
    [activeConversationIdRef, contentItemsRef, core40SDK, extensionSDK, getAuthCfg, handleResetNewApp, history, hydratedConvRouteRef, inFlightTurnsRef, loaders, location.pathname, mergeCachedActivitySteps, openArtifactByMode, recoveredInFlightIdsRef, selectEpochRef, setActiveContentTabKey, setActiveConversationId, setActiveObjectId, setActiveViewerDocument, setAgentSession, setAlertBundle, setContentItems, setConvMessages, setCurrentAppCode, setLoadedScript, setLookmlBundle, setLookmlProjectId, setMessages, setNativeContentState, setPublishedAppState, setPublishedTileDash, setScriptCode, setScriptId, setScriptTitle, setSelectedExplores, setSidebarCollapsed, sharedEnvIdRef, syncContentItemViewer, turnResumerRef, userId, userIdRef]
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
    abortConvTurn(cleanId)
    const target = explicitTarget || conversations.find((c) => c.id === cleanId)
    const targetItems = (target?.contentItems || []).map((it) => normalizeStudioContentItem(it))
    const targetIds = new Set(
      [cleanId, target?.objectId, getConvTargetId(target?.content, target?.type), ...targetItems.map((it) => it.id)]
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

    if (deleteRelated && target) {
      const mentionScriptIds = new Set(
        targetItems
          .filter((it) => it.contentType === 'script' && (it.source === 'mention' || it.createdInConversation === false))
          .map((it) => it.id)
      )
      const relatedScripts = new Set(
        [
          target.content?.scriptId,
          target.type === 'tile' || target.type === 'script' ? target.objectId : '',
          ...targetItems
            .filter((it) => it.contentType === 'script' && it.source !== 'mention' && it.createdInConversation !== false)
            .map((it) => it.id),
        ]
          .map((v) => String(v || '').trim().replace(/^obj_script_/, ''))
          .filter((id) => Boolean(id) && !mentionScriptIds.has(id))
      )
      if (relatedScripts.size > 0) {
        setSavedScripts((prev) => prev.filter((s) => !relatedScripts.has(s.id)))
        Array.from(relatedScripts).forEach((sid) => {
          void deleteLocalDraftScript(sid, extensionSDK).then(setSavedScripts, () => {})
        })
      }
    }

    deleteConvMessages(cleanId)
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

  const isEmptyConversation =
    !isTileMount && location.pathname !== '/config' &&
    !parsedRoute.objectId && messages.length === 0 && !publishedApp && !nativeContent &&
    contentItems.length === 0 &&
    !lookmlBundle && !healthReport && !caConversation && !loadedScript && !busyStatus &&
    liveActivitySteps.length === 0

  const controller = {
    ...auth,
    ...meta,
    ...loaders,
    ...turn,
    hydratingInteractionIds, hydrateMessageActivitySteps,
    copyThreadState, handleCopyThreadDebugTrace,
    sandboxMarkdownCache, sandboxMarkdownLoading, activeSandboxMarkdownModalPath,
    setActiveSandboxMarkdownModalPath, loadSandboxMarkdownFile, openViewerDocument,
    handleSelectOverview, handleSelectContentTab, handleHideContentTab, persistTabStateToConversation,
    handleResetNewApp, handleNewConversation, handleSelectConversation,
    handleToggleArchiveConversation, handleRequestDeleteConversation,
    handleCancelDeleteConversation, handleConfirmDeleteConversation, handleDeleteConversation,
    isEmptyConversation,
    searchGlobalContentV2,
    loading: Boolean(auth.busyStatus),
    setQueuedPrompts: auth.updateQueuedPrompts,
    conversations: meta.filteredConversations,
    allConversations: meta.modeAllowedConversations,
    handleSend: turn.handleSendPrompt,
    resolveConversationRelatedContent,
  }

  useEffect(() => {
    if (typeof window !== 'undefined') window.__DAB_STUDIO__ = controller
  })

  return controller
}

export type StudioController = ReturnType<typeof useStudioController>
