import React, { useEffect, useMemo, useRef, useState } from 'react'

import {
  Check, Columns2, Copy, PanelRightClose, PanelRightOpen, X,
} from 'lucide-react'

import { cleanLookmlProjectId, normalizeSandboxFilePath } from '../antigravity'
import { renderTddMarkdownToHtml } from '../healthCheck'
import {
  copyTextWithExtensionSdk, STUDIO_OVERVIEW_TAB_KEY, StudioContentItemType,
} from '../lookerApi'
import { LookmlPreviewPane, renderLineNumberedPre } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import { buildAlertDashboardFilterUrl } from './AlertInspectorPane'
import { StudioButton } from './StudioDesignSystem'
import {
  createLookerEmbedPreloadController, LookerEmbedTarget, openContentLinkTargetInViewer,
  renderContentTabIcon, resolveContentLookerPath, resolveLookerEmbedTarget,
} from './StudioMarkdown'
import {
  deriveConversationOverviewData, EMPTY_WIN_CALLS, LkrCodeModeApiCallLike,
  OverviewApiCallRow, OverviewStageSelection, StudioOverviewSidebar,
  StudioViewerDocumentStagePane,
} from './StudioOverviewSidebar'
import {
  StudioActiveModeStageHeader, StudioApiInspectorStagePane, StudioContentTabsBar,
  StudioReviewStagePane,
} from './StudioStagePanels'

export * from './StudioMarkdown'
export * from './StudioUseCaseGuides'
export * from './StudioComposer'
export * from './StudioLeftPane'
export * from './StudioOverviewSidebar'
export * from './StudioStagePanels'

export const StudioRightPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode, selectedUseCase, isEmptyConversation, isHealthCheckMode, isLookmlMode, isCaMode,
    builderMode, healthReport, lookmlBundle, alertBundle = null, caConversation, canDeployLookml, nativeContent,
    publishedApp, contentItems = [], activeContentTabKey = '', activeContentItem = null,
    handleSelectOverview, handleSelectContentTab, handleHideContentTab, setActiveContentTabKey,
    currentAppCode, embedNonce, extensionSDK, setInfoModalUseCase,
    busyStatus, rightPaneCollapsed, setRightPaneCollapsed, scriptId, scriptTitle, scriptCode, loadedScript, savedScheduleBadge,
    activeViewerDocument = null, setActiveViewerDocument, openViewerDocument, activeConversationId,
    messages, liveActivitySteps, activatedLookmlSkills, selectedExplores, mentionedItems, selectedFolderId, folderTreeNodes, pastedImages,
    pendingPerm, resolvePermDecision,
  } = ctl
  const isTileMode = activeMode === 'tile' && Boolean(ctl.loadedScript || ctl.explicitUseCase === 'tile')
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || window.location.origin
  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const [tddViewMode, setTddViewMode] = useState<'rendered' | 'raw'>(() => mockExt?.initialTddViewMode || 'rendered')
  const [copiedTdd, setCopiedTdd] = useState(false)
  const [showAppCode, setShowAppCode] = useState(false)
  const [previewingAlertDashboard, setPreviewingAlertDashboard] = useState(false)
  const [copiedAppCode, setCopiedAppCode] = useState(false)
  const [reloadingViewer, setReloadingViewer] = useState(false)
  const [iframeRev, setIframeRev] = useState(0)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [hoveredTab, setHoveredTab] = useState<{ key: string; left: number; top: number } | null>(null)
  const hoveredTabRef = useRef(hoveredTab)
  hoveredTabRef.current = hoveredTab
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moreMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const embedContainerRef = useRef<HTMLDivElement | null>(null)
  const embedControllerRef = useRef<ReturnType<typeof createLookerEmbedPreloadController> | null>(null)
  const prevEmbedTargetRef = useRef<LookerEmbedTarget | null>(null)
  const initialWinCallsRef = useRef<unknown>(typeof window !== 'undefined' ? (window as Window & { lkr_codemode_api_calls?: unknown }).lkr_codemode_api_calls : undefined)
  const winCallsCursorRef = useRef(Array.isArray(initialWinCallsRef.current) ? initialWinCallsRef.current.length : 0)
  const wasBusyForCallsRef = useRef(false)
  const lastConvIdForCallsRef = useRef(activeConversationId || '__default__')
  const [convWinCalls, setConvWinCalls] = useState<Record<string, LkrCodeModeApiCallLike[]>>(() => {
    const init: Record<string, LkrCodeModeApiCallLike[]> = {}
    if (Array.isArray(initialWinCallsRef.current)) {
      const defKey = activeConversationId || '__default__'
      ;(initialWinCallsRef.current as LkrCodeModeApiCallLike[]).forEach((c) => {
        if (c && c.codemode === true) {
          const k = c.conversation_id || defKey
          ;(init[k] || (init[k] = [])).push(c)
        }
      })
    }
    return init
  })
  const [ovOpenSecs, setOvOpenSecs] = useState<Record<string, boolean>>({ api: false })
  const [ovShowAll, setOvShowAll] = useState<Record<string, boolean>>({})
  const [ovHiddenSecs, setOvHiddenSecs] = useState<Record<string, boolean | undefined>>({})
  const [stageInspector, setStageInspector] = useState<{ kind: 'review' } | { kind: 'api'; callId: string } | null>(null)
  const [selectedLookmlFilePath, setSelectedLookmlFilePath] = useState('')
  const [explorerRailOpen, setExplorerRailOpen] = useState(true)
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false)
  const [isCompactViewport, setIsCompactViewport] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 1080)
  const [docViewMode, setDocViewMode] = useState<'rendered' | 'raw'>('rendered')
  const [copiedDoc, setCopiedDoc] = useState(false)
  const [copiedApiJson, setCopiedApiJson] = useState(false)
  const [fullApiResponse, setFullApiResponse] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      const compact = window.innerWidth <= 1080
      setIsCompactViewport(compact)
      if (!compact) setMobileExplorerOpen(false)
    }
    const onStageNav = () => {
      setStageInspector(null)
      setShowAppCode(false)
      setMobileExplorerOpen(false)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('dab:stage-nav', onStageNav)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('dab:stage-nav', onStageNav)
    }
  }, [])

  useEffect(() => {
    if (!mobileExplorerOpen || typeof document === 'undefined') return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMobileExplorerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileExplorerOpen])

  useEffect(() => {
    setOvOpenSecs({ api: false })
    setOvShowAll({})
    setStageInspector(null)
    setSelectedLookmlFilePath('')
    setMobileExplorerOpen(false)
  }, [activeConversationId])

  useEffect(() => {
    if (activeContentTabKey && activeContentTabKey !== STUDIO_OVERVIEW_TAB_KEY) {
      setStageInspector(null)
    }
  }, [activeContentTabKey])

  useEffect(() => {
    if (activeViewerDocument) {
      setStageInspector(null)
      setDocViewMode('rendered')
      setCopiedDoc(false)
      setMobileExplorerOpen(false)
    }
  }, [activeViewerDocument])

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? (window as Window & { lkr_codemode_api_calls?: unknown }).lkr_codemode_api_calls : undefined
    if (!Array.isArray(raw) || raw !== initialWinCallsRef.current) return
    const fallbackKey = lastConvIdForCallsRef.current || activeConversationId || '__default__'
    if (raw.length > winCallsCursorRef.current) {
      const slice = (raw.slice(winCallsCursorRef.current) as LkrCodeModeApiCallLike[]).filter(
        (c) => c && (c.codemode === true || (c.codemode !== false && wasBusyForCallsRef.current))
      )
      if (slice.length > 0) {
        setConvWinCalls((prev) => {
          const next = { ...prev }
          slice.forEach((c) => {
            const k = c.conversation_id || fallbackKey
            next[k] = (next[k] || []).concat(c)
          })
          return next
        })
      }
    }
    winCallsCursorRef.current = raw.length
    wasBusyForCallsRef.current = Boolean(busyStatus)
    lastConvIdForCallsRef.current = activeConversationId || '__default__'
  }, [busyStatus, activeConversationId, liveActivitySteps, messages])

  const rawWinCalls = typeof window !== 'undefined' ? (window as Window & { lkr_codemode_api_calls?: unknown }).lkr_codemode_api_calls : undefined
  const overviewWinCalls: ReadonlyArray<LkrCodeModeApiCallLike> =
    Array.isArray(rawWinCalls) && rawWinCalls !== initialWinCallsRef.current
      ? (rawWinCalls as LkrCodeModeApiCallLike[])
      : convWinCalls[activeConversationId || '__default__'] || EMPTY_WIN_CALLS
  const lastWinCall = overviewWinCalls[overviewWinCalls.length - 1]
  const winCallsMemoKey = `${overviewWinCalls.length}:${overviewWinCalls[0]?.route || ''}:${lastWinCall?.timestamp || lastWinCall?.duration_ms || ''}`
  const selectedFolderLabel = folderTreeNodes?.[selectedFolderId]?.name || 'My folder'

  const overviewData = useMemo(() => deriveConversationOverviewData({
    messages, liveActivitySteps, contentItems, publishedApp, nativeContent, lookmlBundle, healthReport, caConversation,
    loadedScript, scriptId, scriptTitle, scriptCode, savedScheduleBadge, currentAppCode, activatedLookmlSkills,
    selectedExplores, mentionedItems, selectedFolderId, selectedFolderLabel, pastedImages, pendingPerm,
    windowApiCalls: winCallsMemoKey ? overviewWinCalls : EMPTY_WIN_CALLS, hostUrl, conversationId: activeConversationId,
  }), [
    messages, liveActivitySteps, contentItems, publishedApp, nativeContent, lookmlBundle, healthReport, caConversation,
    loadedScript, scriptId, scriptTitle, scriptCode, savedScheduleBadge, currentAppCode, activatedLookmlSkills,
    selectedExplores, mentionedItems, selectedFolderId, selectedFolderLabel, pastedImages, pendingPerm, overviewWinCalls, winCallsMemoKey, hostUrl, activeConversationId,
  ])

  const clearTabPopoverTimers = () => {
    if (hoverCloseTimerRef.current) { clearTimeout(hoverCloseTimerRef.current); hoverCloseTimerRef.current = null }
    if (hoverOpenTimerRef.current) { clearTimeout(hoverOpenTimerRef.current); hoverOpenTimerRef.current = null }
  }

  useEffect(() => {
    setShowAppCode(false)
    setPreviewingAlertDashboard(false)
    setCopiedAppCode(false)
  }, [activeContentTabKey, activeConversationId, embedNonce, alertBundle?.alert_id])

  useEffect(() => {
    clearTabPopoverTimers()
    setHoveredTab(null)
  }, [activeConversationId, rightPaneCollapsed])

  useEffect(() => clearTabPopoverTimers, [])

  const openTabPopover = (key: string, el: HTMLElement | null, immediate = false) => {
    clearTabPopoverTimers()
    const commit = () => {
      const r = el?.getBoundingClientRect()
      const maxLeft = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - 328) : 1120
      setHoveredTab({ key, left: r ? Math.max(8, Math.min(Math.round(r.left), maxLeft)) : 8, top: r ? Math.round(r.bottom + 2) : 40 })
    }
    if (immediate || !hoveredTabRef.current || hoveredTabRef.current.key === key) {
      commit()
    } else {
      hoverOpenTimerRef.current = setTimeout(() => { hoverOpenTimerRef.current = null; commit() }, 180)
    }
  }
  const scheduleCloseTabPopover = () => {
    clearTabPopoverTimers()
    hoverCloseTimerRef.current = setTimeout(() => setHoveredTab(null), 280)
  }

  const visibleTabs = useMemo(() => contentItems.filter((it) => !it.hidden), [contentItems])
  const hiddenTabs = useMemo(() => contentItems.filter((it) => Boolean(it.hidden)), [contentItems])
  const allTabsHidden = contentItems.length > 0 && visibleTabs.length === 0

  useEffect(() => {
    if (!moreMenuOpen || typeof document === 'undefined') return
    const onDocDown = (ev: MouseEvent) => {
      if (moreMenuWrapRef.current && !moreMenuWrapRef.current.contains(ev.target as Node)) setMoreMenuOpen(false)
    }
    const onDocKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMoreMenuOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onDocKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onDocKey)
    }
  }, [moreMenuOpen])

  const ct = activeContentItem?.contentType
  const activePaneKind: 'script' | 'alert' | 'report' | 'lookml' | 'ca' | 'embed' | 'empty_hidden' = allTabsHidden
    ? 'empty_hidden'
    : ct
    ? ct === 'script' || ct === 'alert' || ct === 'lookml' || ct === 'report' ? ct : ct === 'conversational-analytics' ? 'ca' : 'embed'
    : isTileMode ? 'script' : activeMode === 'tile' && alertBundle ? 'alert' : isHealthCheckMode ? 'report' : isLookmlMode ? 'lookml' : isCaMode || caConversation ? 'ca' : 'embed'

  const activeApiCall = stageInspector?.kind === 'api'
    ? overviewData.apiCalls.find((c) => c.id === stageInspector.callId) || overviewData.apiCalls[0] || null
    : null
  const resolvedStageInspector = stageInspector?.kind === 'api' && !activeApiCall ? null : stageInspector
  const explicitOverview = activeContentTabKey === STUDIO_OVERVIEW_TAB_KEY
  const isNonEmbedStageView = Boolean(resolvedStageInspector || activeViewerDocument || explicitOverview)
  const alertPreviewUrl = activePaneKind === 'alert' && previewingAlertDashboard ? buildAlertDashboardFilterUrl(alertBundle) : ''

  const embedTarget = useMemo(
    () => resolveLookerEmbedTarget({
      isEmptyConversation: isEmptyConversation || allTabsHidden || isNonEmbedStageView,
      isHealthCheckMode: activePaneKind === 'report',
      isLookmlMode: activePaneKind === 'lookml',
      isTileMode: activePaneKind === 'script',
      isCaMode: activePaneKind === 'ca',
      builderMode, activeContentItem, caConversation, nativeContent, publishedApp,
      alertPreviewUrl: alertPreviewUrl || undefined,
      hostUrl, nonce: (embedNonce || 0) + iframeRev,
    }),
    [isEmptyConversation, allTabsHidden, isNonEmbedStageView, activePaneKind, builderMode, activeContentItem, caConversation, nativeContent, publishedApp, alertPreviewUrl, hostUrl, embedNonce, iframeRev]
  )

  useEffect(() => {
    const el = embedContainerRef.current
    if (!el || embedControllerRef.current) return
    embedControllerRef.current = createLookerEmbedPreloadController({
      hostUrl, container: el,
      mockPreviewHtml: mockExt?.getMockPreviewHtml ? (mode, objectId) => mockExt.getMockPreviewHtml(mode, objectId) : undefined,
    })
  }, [hostUrl, mockExt])

  useEffect(() => {
    const prev = prevEmbedTargetRef.current
    prevEmbedTargetRef.current = embedTarget
    if (!embedControllerRef.current) { setReloadingViewer(false); return }
    if (prev && embedTarget.kind !== 'preload' && prev.kind === embedTarget.kind && prev.target === embedTarget.target && prev.nonce !== embedTarget.nonce) {
      setReloadingViewer(true)
    }
    let cancelled = false
    void embedControllerRef.current.syncTarget(embedTarget).catch(() => undefined).finally(() => {
      if (!cancelled) setReloadingViewer(false)
    })
    return () => { cancelled = true }
  }, [embedTarget])

  const handleCopyTddMarkdown = () => {
    if (!healthReport?.tddMarkdown) return
    void copyTextWithExtensionSdk(healthReport.tddMarkdown, extensionSDK)
    setCopiedTdd(true); setTimeout(() => setCopiedTdd(false), 1800)
  }

  const handleDownloadTddMarkdown = () => {
    if (!healthReport?.tddMarkdown) return
    const url = URL.createObjectURL(new Blob([healthReport.tddMarkdown], { type: 'text/markdown;charset=utf-8' }))
    Object.assign(document.createElement('a'), { href: url, download: 'TECHNICAL_DESIGN_DOCUMENT.md' }).click()
    URL.revokeObjectURL(url)
  }

  const closeStageToOverview = () => {
    setStageInspector(null)
    setSelectedLookmlFilePath('')
    setShowAppCode(false)
    setMobileExplorerOpen(false)
    handleSelectOverview?.()
  }

  const selectContentTabInStage = (key: string, lkFilePath = '') => {
    setActiveViewerDocument?.(null)
    setStageInspector(null)
    setShowAppCode(false)
    setSelectedLookmlFilePath(lkFilePath)
    setMobileExplorerOpen(false)
    if (key && contentItems.some((c) => c.key === key)) handleSelectContentTab?.(key)
    else setActiveContentTabKey?.('')
  }

  const handleOpenReviewStage = () => {
    setActiveViewerDocument?.(null)
    setActiveContentTabKey?.(STUDIO_OVERVIEW_TAB_KEY)
    setStageInspector({ kind: 'review' })
    setMobileExplorerOpen(false)
  }

  const handleOpenApiCallStage = (call: OverviewApiCallRow) => {
    setActiveViewerDocument?.(null)
    setActiveContentTabKey?.(STUDIO_OVERVIEW_TAB_KEY)
    setCopiedApiJson(false)
    setFullApiResponse(false)
    setStageInspector({ kind: 'api', callId: call.id })
    setMobileExplorerOpen(false)
  }

  const handleSelectLookmlFileFromOverview = (filePath: string) => {
    const lkTab = contentItems.find((c) => c.contentType === 'lookml' && cleanLookmlProjectId(c.projectId || c.id))
    if (lkTab) { selectContentTabInStage(lkTab.key, filePath); return }
    const pid = lookmlBundle ? cleanLookmlProjectId(lookmlBundle.project_id) || cleanLookmlProjectId(lookmlBundle.id) : ''
    if (lookmlBundle && pid) {
      const up = ctl.upsertContentItem({ id: pid, projectId: pid, contentType: 'lookml', title: lookmlBundle.title || `LookML: ${pid}`, embedPath: `/lookml/${encodeURIComponent(pid)}`, hidden: false }, true)
      setStageInspector(null); setShowAppCode(false); setSelectedLookmlFilePath(filePath); setMobileExplorerOpen(false)
      handleSelectContentTab?.(up.key)
      return
    }
    void openViewerDocument?.({ path: filePath, title: filePath, kind: 'file' })
  }

  const isDataAppPane = activeContentItem
    ? activeContentItem.contentType === 'data_app' || activeContentItem.contentType === 'data-investigator'
    : builderMode !== 'dashboard'
  const isShowingAppCodeFullscreen =
    activePaneKind === 'embed' && !rightPaneCollapsed && !allTabsHidden && showAppCode && Boolean(currentAppCode) && isDataAppPane && !activeViewerDocument && !resolvedStageInspector
  const activePreviewId = allTabsHidden
    ? ''
    : activeContentItem?.id || (builderMode === 'dashboard' ? nativeContent?.id : publishedApp?.dashboardId)
  const openInLookerPath = activeContentItem
    ? resolveContentLookerPath(activeContentItem.contentType, activeContentItem.projectId || activeContentItem.id, activeContentItem.embedPath)
    : builderMode === 'dashboard' && nativeContent
    ? resolveContentLookerPath(nativeContent.contentType, nativeContent.id, nativeContent.embedPath)
    : publishedApp ? `/dashboards/${encodeURIComponent(publishedApp.dashboardId)}` : ''
  const hasActiveEmbed = embedTarget.kind !== 'preload'
  const showContentTabs = visibleTabs.length > 0 || hiddenTabs.length > 0
  const resolvedActiveTabKey = explicitOverview || resolvedStageInspector || activeViewerDocument ? '' : activeContentItem?.key || activeContentTabKey || ''

  const railArtifacts = useMemo<Array<{ key: string; title: string; contentType: StudioContentItemType }>>(() => {
    if (visibleTabs.length > 0) return visibleTabs.map((item) => ({ key: item.key, title: item.title, contentType: item.contentType }))
    if (allTabsHidden) return []
    const lkPid = lookmlBundle ? cleanLookmlProjectId(lookmlBundle.project_id) || cleanLookmlProjectId(lookmlBundle.id) : ''
    if (isLookmlMode && lookmlBundle && lkPid) return [{ key: `lookml:${lkPid}`, title: lookmlBundle.title || 'Agentic LookML', contentType: 'lookml' }]
    if (isHealthCheckMode && healthReport) return [{ key: `report:${healthReport.id}`, title: healthReport.title || 'Health Check Report', contentType: 'report' }]
    if (isTileMode && scriptId) return [{ key: `script:${scriptId}`, title: scriptTitle || scriptId, contentType: 'script' }]
    if (caConversation) return [{ key: `ca:${caConversation.caConversationId}`, title: caConversation.title || 'Conversational Analytics', contentType: 'conversational-analytics' }]
    if (nativeContent) return [{ key: `${nativeContent.contentType}:${nativeContent.id}`, title: nativeContent.title, contentType: nativeContent.contentType }]
    if (publishedApp) return [{ key: `data_app:${publishedApp.dashboardId}`, title: publishedApp.title, contentType: 'data_app' }]
    return []
  }, [visibleTabs, allTabsHidden, isLookmlMode, lookmlBundle, isHealthCheckMode, healthReport, isTileMode, scriptId, scriptTitle, caConversation, nativeContent, publishedApp])

  const isExplorerOpen = isCompactViewport ? mobileExplorerOpen : explorerRailOpen

  const collapseToggleBtn = !rightPaneCollapsed ? (
    <button
      type="button" data-testid="right-pane-collapse-toggle" className="dab-btn dab-btn-secondary dab-btn-icon dab-right-collapse-btn"
      title="Collapse viewer" aria-label="Collapse viewer" onClick={() => { setStageInspector(null); setRightPaneCollapsed(true) }}
    >
      <PanelRightClose size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  ) : null

  const toggleExplorerBtn = !rightPaneCollapsed ? (
    <button
      type="button"
      data-testid="stage-explorer-toggle-btn"
      className={`dab-btn dab-btn-secondary dab-btn-icon dab-stage-explorer-btn ${isExplorerOpen ? 'active' : ''}`}
      title={isExplorerOpen ? 'Hide Overview explorer' : 'Show Overview explorer'}
      aria-label={isExplorerOpen ? 'Hide Overview explorer' : 'Show Overview explorer'}
      aria-pressed={isExplorerOpen}
      onClick={() => {
        if (isCompactViewport) setMobileExplorerOpen((o) => !o)
        else setExplorerRailOpen((o) => !o)
      }}
    >
      <Columns2 size={13} strokeWidth={1.75} aria-hidden="true" />
    </button>
  ) : null

  const stageCloseBtn = (testId: string, label: string) => (
    <button
      type="button"
      data-testid={testId}
      className="dab-btn dab-btn-secondary dab-btn-icon"
      title={label}
      aria-label={label}
      onClick={closeStageToOverview}
    >
      <X size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  )

  const overviewCrumb = showContentTabs ? null : (
    <button type="button" className="dab-stage-crumb-btn" data-testid="stage-breadcrumb-overview" onClick={closeStageToOverview}>
      Overview /
    </button>
  )

  const hasActiveViewerPane =
    !explicitOverview &&
    !resolvedStageInspector &&
    Boolean(
      activeContentItem ||
      (!allTabsHidden &&
        (hasActiveEmbed ||
          (activePaneKind === 'report' && healthReport) ||
          (activePaneKind === 'lookml' && lookmlBundle) ||
          (activePaneKind === 'alert' && alertBundle) ||
          (activePaneKind === 'ca' && caConversation) ||
          activePaneKind === 'script'))
    )
  const isOverviewMode = !isEmptyConversation && !activeViewerDocument && !resolvedStageInspector && !hasActiveViewerPane
  const hasViewerContent = Boolean(activeViewerDocument || resolvedStageInspector || hasActiveViewerPane)
  const hideRightPane = isEmptyConversation && !activeViewerDocument
  const idleToolbarText = <span className="dab-muted">{busyStatus ? 'Thinking...' : 'Viewer will appear here when Looker content is ready'}</span>

  const activeStageSelection = useMemo<OverviewStageSelection>(() => {
    if (isOverviewMode) return null
    if (resolvedStageInspector?.kind === 'review') return { kind: 'review' }
    if (resolvedStageInspector?.kind === 'api' && activeApiCall) return { kind: 'api', id: activeApiCall.id }
    if (activeViewerDocument) {
      if (activeViewerDocument.kind === 'skill') {
        const docPath = normalizeSandboxFilePath(activeViewerDocument.path)
        const sid = overviewData.skillsUsed.find((s) => normalizeSandboxFilePath(s.path) === docPath || s.label === activeViewerDocument.title)?.id || activeViewerDocument.title
        return { kind: 'skill', id: sid }
      }
      return { kind: 'file', path: activeViewerDocument.displayPath || activeViewerDocument.path }
    }
    if (activePaneKind === 'lookml' && selectedLookmlFilePath) return { kind: 'file', path: selectedLookmlFilePath }
    if (isShowingAppCodeFullscreen) return { kind: 'file', path: '/workspace/apps/current/app.js' }
    if (activeContentItem?.key) return { kind: 'content', key: activeContentItem.key }
    if (overviewData.contentRows[0]) return { kind: 'content', key: overviewData.contentRows[0].key }
    return null
  }, [isOverviewMode, resolvedStageInspector, activeApiCall, activeViewerDocument, overviewData.skillsUsed, overviewData.contentRows, activePaneKind, selectedLookmlFilePath, isShowingAppCodeFullscreen, activeContentItem?.key])

  const mobileHeaderTitle = isOverviewMode
    ? 'Overview'
    : resolvedStageInspector?.kind === 'review'
    ? 'Review Changeset'
    : activeApiCall
    ? `${activeApiCall.method} ${activeApiCall.route}`
    : activeViewerDocument?.title || activeContentItem?.title || publishedApp?.title || nativeContent?.title || lookmlBundle?.title || healthReport?.title || caConversation?.title || 'Viewer'

  const hideIframeContainer =
    activePaneKind === 'script' || (activePaneKind === 'alert' && !previewingAlertDashboard) || rightPaneCollapsed || Boolean(activeViewerDocument) || Boolean(resolvedStageInspector) || isShowingAppCodeFullscreen || isOverviewMode

  return (
    <main
      className={`dab-right-pane ${rightPaneCollapsed ? 'dab-right-pane-collapsed' : ''}`}
      data-has-viewer-content={hasViewerContent ? 'true' : 'false'}
      data-overview-mode={isOverviewMode ? 'true' : 'false'}
      data-explicit-overview={explicitOverview && !resolvedStageInspector ? 'true' : 'false'}
      data-non-tab-stage={resolvedStageInspector || activeViewerDocument ? 'true' : 'false'}
      data-right-hidden={hideRightPane ? 'true' : 'false'}
      style={hideRightPane ? { display: 'none' } : undefined}
    >
      {!rightPaneCollapsed && (
        <div className="dab-mobile-viewer-card-handle" data-testid="mobile-viewer-card-handle">
          <div className="dab-mobile-viewer-grab-bar" aria-hidden="true" />
          <div className="dab-mobile-viewer-card-header">
            <span className="dab-mobile-viewer-card-title">{mobileHeaderTitle}</span>
            <div className="dab-controls" style={{ gap: 4 }}>
              {!isOverviewMode && (
                <button
                  type="button" data-testid="mobile-viewer-overview-btn" className="dab-btn dab-btn-secondary dab-mobile-viewer-close-btn"
                  title="Back to Overview" aria-label="Back to Overview" onClick={closeStageToOverview}
                >
                  <span>Overview</span>
                </button>
              )}
              <button
                type="button" data-testid="mobile-viewer-card-close" className="dab-btn dab-btn-secondary dab-mobile-viewer-close-btn"
                title="Collapse viewer" aria-label="Collapse viewer"
                onClick={() => { if (explicitOverview) ctl.setActiveContentTabKey(''); setStageInspector(null); setRightPaneCollapsed(true) }}
              >
                <PanelRightClose size={14} strokeWidth={1.75} aria-hidden="true" /><span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {rightPaneCollapsed && (
        <div className="dab-right-collapsed-rail" data-testid="right-pane-collapsed-rail" aria-label="Collapsed artifacts rail">
          <button
            type="button" data-testid="right-pane-collapse-toggle" className="dab-btn dab-btn-secondary dab-right-rail-toggle-btn"
            title="Expand viewer" aria-label="Expand viewer" onClick={() => setRightPaneCollapsed(false)}
          >
            <PanelRightOpen size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className="dab-right-rail-artifacts">
            {railArtifacts.map((item) => {
              const isSelected = item.key === resolvedActiveTabKey || railArtifacts.length === 1
              return (
                <button
                  key={item.key} type="button" data-testid={`right-rail-artifact-${item.key}`}
                  className={`dab-right-rail-artifact-btn ${isSelected ? 'active' : ''}`}
                  title={item.title} aria-label={item.title}
                  onClick={() => {
                    setRightPaneCollapsed(false)
                    if (contentItems.some((c) => c.key === item.key)) selectContentTabInStage(item.key)
                  }}
                >
                  {renderContentTabIcon(item.contentType)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {!rightPaneCollapsed && showContentTabs && (
        <StudioContentTabsBar
          isOverviewMode={isOverviewMode}
          visibleTabs={visibleTabs}
          hiddenTabs={hiddenTabs}
          resolvedActiveTabKey={resolvedActiveTabKey}
          hoveredTab={hoveredTab}
          setHoveredTab={setHoveredTab}
          moreMenuOpen={moreMenuOpen}
          setMoreMenuOpen={setMoreMenuOpen}
          moreMenuWrapRef={moreMenuWrapRef}
          openTabPopover={openTabPopover}
          scheduleCloseTabPopover={scheduleCloseTabPopover}
          clearTabPopoverTimers={clearTabPopoverTimers}
          closeStageToOverview={closeStageToOverview}
          selectContentTabInStage={selectContentTabInStage}
          handleHideContentTab={handleHideContentTab}
          hostUrl={hostUrl}
          extensionSDK={extensionSDK}
        />
      )}

      <div className="dab-right-pane-split" style={rightPaneCollapsed ? { display: 'none' } : undefined}>
        <div className="dab-stage-shell" data-testid="studio-unified-stage" style={isOverviewMode ? { display: 'none' } : undefined}>
          {!rightPaneCollapsed && !isOverviewMode && resolvedStageInspector?.kind === 'review' && (
            <StudioReviewStagePane
              overviewData={overviewData}
              lookmlBundle={lookmlBundle}
              pendingPerm={pendingPerm}
              resolvePermDecision={resolvePermDecision}
              handleSelectLookmlFileFromOverview={handleSelectLookmlFileFromOverview}
              openViewerDocument={openViewerDocument}
              hostUrl={hostUrl}
              extensionSDK={extensionSDK}
              stageCloseBtn={stageCloseBtn}
              toggleExplorerBtn={toggleExplorerBtn}
              collapseToggleBtn={collapseToggleBtn}
            />
          )}

          {!rightPaneCollapsed && !isOverviewMode && resolvedStageInspector?.kind === 'api' && activeApiCall && (
            <StudioApiInspectorStagePane
              activeApiCall={activeApiCall}
              copiedApiJson={copiedApiJson}
              setCopiedApiJson={setCopiedApiJson}
              fullApiResponse={fullApiResponse}
              setFullApiResponse={setFullApiResponse}
              extensionSDK={extensionSDK}
              stageCloseBtn={stageCloseBtn}
              toggleExplorerBtn={toggleExplorerBtn}
              collapseToggleBtn={collapseToggleBtn}
            />
          )}

          {!rightPaneCollapsed && !isOverviewMode && !resolvedStageInspector && !activeViewerDocument && (
            <StudioActiveModeStageHeader
              ctl={ctl}
              activePaneKind={activePaneKind}
              alertBundle={alertBundle}
              previewingAlertDashboard={previewingAlertDashboard}
              setPreviewingAlertDashboard={setPreviewingAlertDashboard}
              healthReport={healthReport}
              tddViewMode={tddViewMode}
              setTddViewMode={setTddViewMode}
              copiedTdd={copiedTdd}
              handleCopyTddMarkdown={handleCopyTddMarkdown}
              handleDownloadTddMarkdown={handleDownloadTddMarkdown}
              lookmlBundle={lookmlBundle}
              caConversation={caConversation}
              setIframeRev={setIframeRev}
              allTabsHidden={allTabsHidden}
              activeContentItem={activeContentItem}
              builderMode={builderMode}
              nativeContent={nativeContent}
              publishedApp={publishedApp}
              isDataAppPane={isDataAppPane}
              currentAppCode={currentAppCode}
              showAppCode={showAppCode}
              setShowAppCode={setShowAppCode}
              activePreviewId={activePreviewId}
              reloadingViewer={reloadingViewer}
              setReloadingViewer={setReloadingViewer}
              openInLookerPath={openInLookerPath}
              selectedUseCase={selectedUseCase}
              setInfoModalUseCase={setInfoModalUseCase}
              overviewCrumb={overviewCrumb}
              idleToolbarText={idleToolbarText}
              toggleExplorerBtn={toggleExplorerBtn}
              collapseToggleBtn={collapseToggleBtn}
              extensionSDK={extensionSDK}
            />
          )}

          {!isOverviewMode && isShowingAppCodeFullscreen && (
            <div className="dab-code-drawer" data-testid="preview-app-code-drawer">
              <div className="dab-code-drawer-header">
                <strong>app.js ({currentAppCode.length} B)</strong>
                <StudioButton
                  variant="secondary"
                  testId="preview-copy-code-btn"
                  className="dab-btn-icon"
                  title={copiedAppCode ? 'Copied!' : 'Copy app.js'}
                  aria-label="Copy app.js"
                  onClick={() => {
                    void copyTextWithExtensionSdk(currentAppCode, extensionSDK)
                    setCopiedAppCode(true)
                    setTimeout(() => setCopiedAppCode(false), 1800)
                  }}
                >
                  {copiedAppCode ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
                </StudioButton>
              </div>
              {renderLineNumberedPre(currentAppCode)}
            </div>
          )}


          {!rightPaneCollapsed && activeViewerDocument && (
            <StudioViewerDocumentStagePane
              ctl={ctl}
              activeViewerDocument={activeViewerDocument}
              setActiveViewerDocument={setActiveViewerDocument}
              openViewerDocument={openViewerDocument}
              docViewMode={docViewMode}
              setDocViewMode={setDocViewMode}
              copiedDoc={copiedDoc}
              setCopiedDoc={setCopiedDoc}
              hostUrl={hostUrl}
              extensionSDK={extensionSDK}
              toggleExplorerBtn={toggleExplorerBtn}
              collapseToggleBtn={collapseToggleBtn}
            />
          )}

          <div className="dab-iframe-container" data-testid="ca-embed-preview" style={hideIframeContainer ? { display: 'none' } : undefined}>
            <div ref={embedContainerRef} data-testid="looker-embed-container" className="dab-embed-container" style={{ width: '100%', height: '100%', display: hasActiveEmbed ? 'block' : 'none' }} />
            {activePaneKind === 'report' && healthReport ? (
              <div className="dab-tdd-viewer">
                {tddViewMode === 'rendered' ? <div className="dab-tdd-rendered" dangerouslySetInnerHTML={{ __html: renderTddMarkdownToHtml(healthReport.tddMarkdown) }} /> : <pre className="dab-tdd-markdown">{healthReport.tddMarkdown}</pre>}
              </div>
            ) : activePaneKind === 'lookml' && lookmlBundle ? (
              <LookmlPreviewPane
                bundle={lookmlBundle}
                hostUrl={hostUrl}
                extensionSDK={extensionSDK}
                canDeploy={canDeployLookml}
                selectedFilePath={selectedLookmlFilePath}
                onSelectFilePath={setSelectedLookmlFilePath}
              />
            ) : null}
          </div>
        </div>

        {!isOverviewMode && isCompactViewport && mobileExplorerOpen && (
          <div className="dab-ov-mobile-backdrop" data-testid="overview-mobile-backdrop" aria-hidden="true" onClick={() => setMobileExplorerOpen(false)} />
        )}

        {!isEmptyConversation && (
          <StudioOverviewSidebar
            ctl={ctl}
            allTabsHidden={allTabsHidden}
            collapseToggleBtn={collapseToggleBtn}
            data={overviewData}
            docked={!isOverviewMode}
            hiddenInStage={!isOverviewMode && !isExplorerOpen}
            mobileOverlayOpen={!isOverviewMode && isCompactViewport && mobileExplorerOpen}
            activeSelection={activeStageSelection}
            openSecs={ovOpenSecs}
            setOpenSecs={setOvOpenSecs}
            showAll={ovShowAll}
            setShowAll={setOvShowAll}
            hiddenSecs={ovHiddenSecs}
            setHiddenSecs={setOvHiddenSecs}
            onOpenContentLinkInViewer={(target) => {
              setStageInspector(null)
              setShowAppCode(false)
              setMobileExplorerOpen(false)
              openContentLinkTargetInViewer(ctl, target)
            }}
            onOpenReview={handleOpenReviewStage}
            onSelectContentRow={(row) => selectContentTabInStage(row.key)}
            onSelectLookmlFile={handleSelectLookmlFileFromOverview}
            onOpenApiCall={handleOpenApiCallStage}
            onCloseDockedExplorer={() => {
              if (isCompactViewport) setMobileExplorerOpen(false)
              else setExplorerRailOpen(false)
            }}
          />
        )}
      </div>
    </main>
  )
}
