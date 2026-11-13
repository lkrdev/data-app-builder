import React from 'react'

import type { ExtensionSDK } from '@looker/extension-sdk'
import {
  AlertTriangle, Check, Code2, Copy, ExternalLink, MoreVertical, RotateCw, Shield, X,
} from 'lucide-react'

import { cleanLookmlProjectId, StudioUseCase } from '../antigravity'
import { HealthCheckReportPayload } from '../healthCheck'
import {
  CaConversationState, copyTextWithExtensionSdk, NativeContentState, PublishedAppState,
  StudioContentItem,
} from '../lookerApi'
import { LookmlBundle, renderLineNumberedPre } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import { AlertInspectorPane } from './AlertInspectorPane'
import { TilePreviewPane } from './ScriptStudioView'
import {
  StudioBadge, StudioButton, StudioToolbar,
} from './StudioDesignSystem'
import {
  formatContentTypeLabel, openOrCopyMarkdownLink, renderContentTabIcon, resolveContentLookerPath,
} from './StudioMarkdown'
import {
  DerivedOverviewData, formatPrettyPayload, OverviewApiCallRow,
} from './StudioOverviewSidebar'
import { UseCaseInfoTrigger } from './StudioUseCaseGuides'

export const StudioContentTabsBar: React.FC<{
  isOverviewMode: boolean
  visibleTabs: StudioContentItem[]
  hiddenTabs: StudioContentItem[]
  resolvedActiveTabKey: string
  hoveredTab: { key: string; left: number; top: number } | null
  setHoveredTab: React.Dispatch<React.SetStateAction<{ key: string; left: number; top: number } | null>>
  moreMenuOpen: boolean
  setMoreMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  moreMenuWrapRef: React.RefObject<HTMLDivElement | null>
  openTabPopover: (key: string, el: HTMLElement | null, immediate?: boolean) => void
  scheduleCloseTabPopover: () => void
  clearTabPopoverTimers: () => void
  closeStageToOverview: () => void
  selectContentTabInStage: (key: string, lkFilePath?: string) => void
  handleHideContentTab?: (key: string) => void
  hostUrl: string
  extensionSDK: ExtensionSDK
}> = ({
  isOverviewMode, visibleTabs, hiddenTabs, resolvedActiveTabKey, hoveredTab, setHoveredTab,
  moreMenuOpen, setMoreMenuOpen, moreMenuWrapRef, openTabPopover, scheduleCloseTabPopover,
  clearTabPopoverTimers, closeStageToOverview, selectContentTabInStage, handleHideContentTab,
  hostUrl, extensionSDK,
}) => (
        <div className="dab-content-tabs" data-testid="studio-content-tabs" role="tablist" aria-label="Conversation Looker content tabs">
          <div className="dab-content-tabs-scroll">
            <button
              type="button"
              role="tab"
              aria-selected={isOverviewMode}
              data-testid="studio-overview-tab"
              className={`dab-content-tab dab-ov-pill ${isOverviewMode ? 'active' : ''}`}
              onClick={closeStageToOverview}
              title="View conversation overview"
            >
              <span className="dab-content-tab-label">Overview</span>
            </button>
            {visibleTabs.map((item) => {
              const isSelected = item.key === resolvedActiveTabKey
              const isPopOpen = hoveredTab?.key === item.key
              const pid = item.contentType === 'lookml' ? cleanLookmlProjectId(item.projectId) || cleanLookmlProjectId(item.id) : item.projectId || item.id
              const isLookmlTab = item.contentType === 'lookml'
              const isNonEmbed = item.contentType === 'script' || item.contentType === 'report'
              const popHref = resolveContentLookerPath(item.contentType, pid, item.embedPath)
              return (
                <div
                  key={item.key}
                  className="dab-content-tab-item"
                  onMouseEnter={(e) => openTabPopover(item.key, e.currentTarget)}
                  onMouseLeave={scheduleCloseTabPopover}
                  onFocus={(e) => openTabPopover(item.key, e.currentTarget, true)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleCloseTabPopover()
                  }}
                >
                  <div
                    role="tab" tabIndex={0} aria-selected={isSelected}
                    data-testid={`studio-content-tab-${item.key}`} className={`dab-content-tab ${isSelected ? 'active' : ''}`}
                    onClick={() => selectContentTabInStage(item.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectContentTabInStage(item.key)
                      }
                    }}
                  >
                    <span className="dab-content-tab-icon">{renderContentTabIcon(item.contentType)}</span>
                    <span className="dab-content-tab-label">{item.title}</span>
                    <button
                      type="button"
                      data-testid={`studio-content-tab-close-${item.key}`}
                      className="dab-content-tab-close"
                      aria-label={`Hide ${item.title} tab`}
                      title="Hide tab"
                      onClick={(e) => {
                        e.stopPropagation()
                        clearTabPopoverTimers()
                        setHoveredTab(null)
                        handleHideContentTab?.(item.key)
                      }}
                    >
                      <X size={12} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                  <div
                    data-testid={`content-tab-popover-${item.key}`}
                    className={`dab-content-tab-popover ${isPopOpen ? 'open' : ''}`}
                    style={isPopOpen && hoveredTab ? { left: hoveredTab.left, top: hoveredTab.top } : undefined}
                    onMouseEnter={clearTabPopoverTimers}
                    onMouseLeave={scheduleCloseTabPopover}
                  >
                    <span className="dab-tab-popover-meta">
                      {isLookmlTab ? <>Project: <code>{pid}</code></> : isNonEmbed ? <>{formatContentTypeLabel(item.contentType)}: <code>{item.id}</code></> : formatContentTypeLabel(item.contentType)}
                    </span>
                    {popHref && (
                      <StudioButton
                        variant="secondary"
                        testId={isLookmlTab ? 'lookml-open-ide-btn' : undefined}
                        className="dab-tab-popover-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          void openOrCopyMarkdownLink(popHref, hostUrl, extensionSDK)
                        }}
                      >
                        <span>{isLookmlTab ? 'Open in IDE' : 'Open in Looker'}</span>
                        <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
                      </StudioButton>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {hiddenTabs.length > 0 && (
            <div className="dab-content-tabs-more-wrap" ref={moreMenuWrapRef}>
              <button
                type="button"
                data-testid="studio-content-tabs-more-btn"
                className="dab-btn dab-btn-secondary dab-content-tabs-more-btn"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                aria-label={`Restore hidden tabs (${hiddenTabs.length})`}
                title={`Restore hidden tabs (${hiddenTabs.length})`}
                onClick={() => setMoreMenuOpen((open) => !open)}
              >
                <MoreVertical size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
              {moreMenuOpen && (
                <div
                  data-testid="studio-content-tabs-more-menu"
                  role="menu"
                  aria-label="Hidden content tabs"
                  className="dab-content-tabs-more-menu"
                >
                  {hiddenTabs.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      data-testid={`studio-content-tab-restore-${item.key}`}
                      className="dab-content-tabs-more-item"
                      onClick={() => {
                        setMoreMenuOpen(false)
                        selectContentTabInStage(item.key)
                      }}
                    >
                      <span className="dab-content-tab-icon">{renderContentTabIcon(item.contentType)}</span>
                      <span className="dab-content-tab-label">{item.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

)

export const StudioReviewStagePane: React.FC<{
  overviewData: DerivedOverviewData
  lookmlBundle: LookmlBundle | null
  pendingPerm: StudioController['pendingPerm']
  resolvePermDecision: StudioController['resolvePermDecision']
  handleSelectLookmlFileFromOverview: (filePath: string) => void
  openViewerDocument?: StudioController['openViewerDocument']
  hostUrl: string
  extensionSDK: ExtensionSDK
  stageCloseBtn: (testId: string, label: string) => React.ReactNode
  toggleExplorerBtn: React.ReactNode
  collapseToggleBtn: React.ReactNode
}> = ({
  overviewData, lookmlBundle, pendingPerm, resolvePermDecision,
  handleSelectLookmlFileFromOverview, openViewerDocument, hostUrl, extensionSDK,
  stageCloseBtn, toggleExplorerBtn, collapseToggleBtn,
}) => (
            <div className="dab-stage-screen" data-testid="stage-review-pane">
              <StudioToolbar
                testId="stage-review-toolbar"
                className="dab-stage-compact-bar"
                title={
                  <>
                    <strong>Review</strong>
                    {overviewData.reviewItems.filter((rv) => rv.kind !== 'files').map((rv, idx) => (
                      <StudioBadge key={idx} tone={rv.badgeTone}>{rv.badgeText}</StudioBadge>
                    ))}
                    {overviewData.changedFiles.length > 0 && (
                      <StudioBadge tone="neutral">{`${overviewData.changedFiles.length} ${overviewData.changedFiles.length === 1 ? 'file' : 'files'}`}</StudioBadge>
                    )}
                  </>
                }
                actions={
                  <>
                    {cleanLookmlProjectId(lookmlBundle?.project_id) && (
                      <StudioButton
                        variant="secondary"
                        testId="stage-review-open-ide-btn"
                        onClick={() => void openOrCopyMarkdownLink(`/projects/${encodeURIComponent(cleanLookmlProjectId(lookmlBundle?.project_id))}`, hostUrl, extensionSDK)}
                      >
                        <span>IDE</span>
                        <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
                      </StudioButton>
                    )}
                    {stageCloseBtn('stage-review-close-btn', 'Close Review')}
                    {toggleExplorerBtn}
                    {collapseToggleBtn}
                  </>
                }
              />
              <div className="dab-stage-scroll">
                {pendingPerm && (
                  <div className="dab-review-perm-strip" data-testid="stage-review-permission-card">
                    <div className="dab-review-strip-row">
                      <AlertTriangle size={13} strokeWidth={1.75} style={{ color: 'var(--dab-warning-text)', flexShrink: 0 }} aria-hidden="true" />
                      <strong>Safe Mode:</strong>
                      <code>{pendingPerm.req.operation}</code>
                      <span>·</span>
                      <code>{pendingPerm.req.httpMethod} {pendingPerm.req.path}</code>
                      {pendingPerm.req.thought && <span>— {pendingPerm.req.thought}</span>}
                    </div>
                    <div className="dab-permission-actions">
                      <button type="button" className="dab-btn-primary dab-btn-xs" data-testid="stage-perm-allow-once" onClick={() => resolvePermDecision('allow_once')}>Allow once</button>
                      <button type="button" className="dab-btn-secondary dab-btn-xs" data-testid="stage-perm-allow-op" onClick={() => resolvePermDecision('allow_op')}>Allow &apos;{pendingPerm.req.operation}&apos;</button>
                      <button type="button" className="dab-btn-secondary dab-btn-xs" data-testid="stage-perm-allow-all" onClick={() => resolvePermDecision('allow_all')}>Allow all</button>
                      <button type="button" className="dab-btn-secondary dab-btn-xs" data-testid="stage-perm-deny" onClick={() => resolvePermDecision('deny')}>Deny</button>
                    </div>
                  </div>
                )}

                {lookmlBundle && (
                  <div className="dab-review-checks-strip" data-testid="stage-review-checks-card">
                    <div className="dab-review-strip-row">
                      <Shield size={13} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
                      <StudioBadge tone={lookmlBundle.validation?.passed === false ? 'danger' : 'success'}>
                        {lookmlBundle.validation?.passed === false
                          ? `${lookmlBundle.validation.errors?.length || lookmlBundle.validation.error_count || 1} error(s)`
                          : 'Validator Passed'}
                      </StudioBadge>
                      {lookmlBundle.branch_name && <code className="dab-stage-inline-meta">{lookmlBundle.branch_name}</code>}
                      {(lookmlBundle.tests || []).map((t, i) => (
                        <StudioBadge key={i} pill tone={t.success ? 'success' : 'danger'}>
                          {t.success ? '✓' : '✕'} {t.test_name}
                        </StudioBadge>
                      ))}
                      {(lookmlBundle.queries || []).map((q, i) => {
                        const sqlPath = q.sql_runner_url || (q.sql_slug ? `/sql/${q.sql_slug}` : '')
                        const expPath = q.explore_url || (q.explore_slug ? `/x/${q.explore_slug}` : '')
                        return (
                          <span key={i} className="dab-review-inline-parity">
                            <span className="dab-stage-inline-meta">{q.label || `Parity #${(q.query_index ?? i) + 1}`}{q.parity_status ? ` (${q.parity_status})` : ''}</span>
                            {sqlPath && <button type="button" className="dab-btn-secondary dab-btn-xs" onClick={() => void openOrCopyMarkdownLink(sqlPath, hostUrl, extensionSDK)}>SQL ↗</button>}
                            {expPath && <button type="button" className="dab-btn-secondary dab-btn-xs" onClick={() => void openOrCopyMarkdownLink(expPath, hostUrl, extensionSDK)}>Explore ↗</button>}
                          </span>
                        )
                      })}
                    </div>
                    {(lookmlBundle.validation?.errors || []).map((err, i) => (
                      <div key={i} className="dab-review-err-line">
                        {err.file_path ? `${err.file_path}${err.line_number ? `:${err.line_number}` : ''} — ` : ''}
                        {err.message}
                      </div>
                    ))}
                  </div>
                )}

                {overviewData.changedFiles.length > 0 ? (
                  <div className="dab-review-files" data-testid="stage-review-files">
                    {overviewData.changedFiles.map((file, idx) => {
                      const rawDiffOrBody = file.diff || file.content || ''
                      const hasDiffMarkers = Boolean(file.diff) || /^(?:@@|\+\+\+|---)/m.test(rawDiffOrBody)
                      const lines = rawDiffOrBody ? rawDiffOrBody.split('\n') : []
                      const adds = hasDiffMarkers ? lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length : 0
                      const dels = hasDiffMarkers ? lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length : 0
                      return (
                        <details key={file.key} className="dab-review-file-card" data-testid={`stage-review-file-${idx}`} open={idx < 5}>
                          <summary className="dab-review-file-head">
                            <span className="dab-ov-stat" style={{ color: file.action === 'created' ? 'var(--dab-success-text)' : file.action === 'deleted' ? 'var(--dab-danger-text)' : 'var(--dab-accent-text)' }}>
                              {file.action === 'created' ? '+' : file.action === 'deleted' ? '-' : 'M'}
                            </span>
                            <code className="dab-review-file-path">{file.label}</code>
                            {hasDiffMarkers ? (
                              <span className="dab-review-diff-stat">
                                {adds > 0 && <span className="is-add">+{adds}</span>}
                                {dels > 0 && <span className="is-del">-{dels}</span>}
                              </span>
                            ) : lines.length > 0 ? (
                              <span className="dab-stage-inline-meta">{lines.length}L</span>
                            ) : null}
                            <button
                              type="button"
                              data-testid={`stage-review-open-file-${idx}`}
                              className="dab-btn dab-btn-secondary dab-review-open-btn"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (file.kind === 'lookml') handleSelectLookmlFileFromOverview(file.path)
                                else void openViewerDocument?.({ path: file.path, title: file.label, kind: 'file', content: file.content })
                              }}
                            >
                              <span>Open file</span>
                            </button>
                          </summary>
                          {rawDiffOrBody
                            ? renderLineNumberedPre(rawDiffOrBody, hasDiffMarkers)
                            : <div className="dab-review-empty-file">Click &ldquo;Open file&rdquo; to load contents from sandbox.</div>}
                        </details>
                      )
                    })}
                  </div>
                ) : !pendingPerm && !lookmlBundle ? (
                  <div className="dab-placeholder">
                    <p>No pending changes or approvals</p>
                    <p className="dab-muted">Modified files, LookML checks, and Safe Mode approvals appear here.</p>
                  </div>
                ) : null}
              </div>
            </div>

)

export const StudioApiInspectorStagePane: React.FC<{
  activeApiCall: OverviewApiCallRow
  copiedApiJson: boolean
  setCopiedApiJson: React.Dispatch<React.SetStateAction<boolean>>
  fullApiResponse: boolean
  setFullApiResponse: React.Dispatch<React.SetStateAction<boolean>>
  extensionSDK: ExtensionSDK
  stageCloseBtn: (testId: string, label: string) => React.ReactNode
  toggleExplorerBtn: React.ReactNode
  collapseToggleBtn: React.ReactNode
}> = ({
  activeApiCall, copiedApiJson, setCopiedApiJson, fullApiResponse, setFullApiResponse,
  extensionSDK, stageCloseBtn, toggleExplorerBtn, collapseToggleBtn,
}) => (
            <div className="dab-stage-screen" data-testid="stage-api-inspector">
              <StudioToolbar
                testId="stage-api-toolbar"
                className="dab-stage-compact-bar"
                title={
                  <>
                    <span className={`dab-ov-mth dab-ov-mth-${activeApiCall.ok ? activeApiCall.method.toLowerCase() : 'err'}`}>{activeApiCall.method}</span>
                    <code className="dab-api-route-code" data-testid="stage-api-route">{activeApiCall.route}</code>
                    <StudioBadge tone={activeApiCall.ok ? 'success' : 'danger'}>
                      {activeApiCall.status !== null ? String(activeApiCall.status) : activeApiCall.ok ? 'OK' : 'ERR'}
                    </StudioBadge>
                    <span className="dab-stage-inline-meta" data-testid="stage-api-meta">
                      {[
                        activeApiCall.durationMs !== undefined ? `${activeApiCall.durationMs}ms` : '',
                        activeApiCall.timestamp ? activeApiCall.timestamp.replace(/^.*T/, '').replace(/\.\d+Z$/, 'Z') : activeApiCall.source === 'turn' ? 'turn log' : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </>
                }
                actions={
                  <>
                    <StudioButton
                      variant="secondary"
                      testId="stage-api-copy-btn"
                      onClick={() => {
                        const snapshot = formatPrettyPayload({
                          method: activeApiCall.method,
                          route: activeApiCall.route,
                          status: activeApiCall.status,
                          duration_ms: activeApiCall.durationMs,
                          query_params: activeApiCall.queryParams,
                          body: activeApiCall.body,
                          response: activeApiCall.responseBody,
                        })
                        void copyTextWithExtensionSdk(snapshot, extensionSDK)
                        setCopiedApiJson(true)
                        setTimeout(() => setCopiedApiJson(false), 1800)
                      }}
                    >
                      {copiedApiJson ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Copy size={12} strokeWidth={1.75} aria-hidden="true" />}
                      <span>{copiedApiJson ? 'Copied' : 'Copy'}</span>
                    </StudioButton>
                    {stageCloseBtn('stage-api-close-btn', 'Close API inspector')}
                    {toggleExplorerBtn}
                    {collapseToggleBtn}
                  </>
                }
              />
              <div className="dab-stage-scroll">
                {activeApiCall.queryParams && Object.keys(activeApiCall.queryParams).length > 0 && (
                  <div className="dab-api-panel" data-testid="stage-api-query-params">
                    <div className="dab-api-panel-head">
                      <span>Query Params</span>
                      <span className="dab-stage-inline-meta">{Object.keys(activeApiCall.queryParams).length}</span>
                    </div>
                    {renderLineNumberedPre(formatPrettyPayload(activeApiCall.queryParams))}
                  </div>
                )}

                {activeApiCall.body !== undefined && activeApiCall.body !== null && (
                  <div className="dab-api-panel" data-testid="stage-api-request-body">
                    <div className="dab-api-panel-head"><span>Request Body</span></div>
                    {renderLineNumberedPre(formatPrettyPayload(activeApiCall.body))}
                  </div>
                )}

                <div className="dab-api-panel" data-testid="stage-api-response">
                  <div className="dab-api-panel-head">
                    <span>Response</span>
                    <span className="dab-stage-inline-meta">
                      {activeApiCall.status !== null ? `HTTP ${activeApiCall.status}` : activeApiCall.ok ? 'OK' : 'Error'}
                    </span>
                  </div>
                  {(() => {
                    const pretty = formatPrettyPayload(activeApiCall.responseBody)
                    if (!pretty) {
                      return (
                        <div className="dab-review-empty-file">
                          {activeApiCall.source === 'turn'
                            ? 'Recorded in historical turn step telemetry (response body omitted from persisted conversation index).'
                            : 'Empty response body.'}
                        </div>
                      )
                    }
                    const truncated = !fullApiResponse && pretty.length > 24000
                    return (
                      <>
                        {renderLineNumberedPre(truncated ? `${pretty.slice(0, 24000)}\n… [truncated ${pretty.length - 24000} chars]` : pretty)}
                        {truncated && (
                          <div style={{ padding: '4px 8px' }}>
                            <button type="button" className="dab-btn-secondary dab-btn-xs" onClick={() => setFullApiResponse(true)}>Show full payload</button>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

)

export const StudioActiveModeStageHeader: React.FC<{
  ctl: StudioController
  activePaneKind: 'script' | 'alert' | 'report' | 'lookml' | 'ca' | 'embed' | 'empty_hidden'
  alertBundle: StudioController['alertBundle']
  previewingAlertDashboard: boolean
  setPreviewingAlertDashboard: React.Dispatch<React.SetStateAction<boolean>>
  healthReport: HealthCheckReportPayload | null
  tddViewMode: 'rendered' | 'raw'
  setTddViewMode: React.Dispatch<React.SetStateAction<'rendered' | 'raw'>>
  copiedTdd: boolean
  handleCopyTddMarkdown: () => void
  handleDownloadTddMarkdown: () => void
  lookmlBundle: LookmlBundle | null
  caConversation: CaConversationState | null
  setIframeRev: React.Dispatch<React.SetStateAction<number>>
  allTabsHidden: boolean
  activeContentItem: StudioContentItem | null
  builderMode: 'app' | 'dashboard'
  nativeContent: NativeContentState | null
  publishedApp: PublishedAppState | null
  isDataAppPane: boolean
  currentAppCode: string
  showAppCode: boolean
  setShowAppCode: React.Dispatch<React.SetStateAction<boolean>>
  activePreviewId?: string
  reloadingViewer: boolean
  setReloadingViewer: React.Dispatch<React.SetStateAction<boolean>>
  openInLookerPath: string
  selectedUseCase: StudioUseCase
  setInfoModalUseCase: (useCase: StudioUseCase | null) => void
  overviewCrumb: React.ReactNode
  idleToolbarText: React.ReactNode
  toggleExplorerBtn: React.ReactNode
  collapseToggleBtn: React.ReactNode
  extensionSDK: ExtensionSDK
}> = ({
  ctl, activePaneKind, alertBundle, previewingAlertDashboard, setPreviewingAlertDashboard,
  healthReport, tddViewMode, setTddViewMode, copiedTdd, handleCopyTddMarkdown,
  handleDownloadTddMarkdown, lookmlBundle, caConversation, setIframeRev, allTabsHidden,
  activeContentItem, builderMode, nativeContent, publishedApp, isDataAppPane, currentAppCode,
  showAppCode, setShowAppCode, activePreviewId, reloadingViewer, setReloadingViewer,
  openInLookerPath, selectedUseCase, setInfoModalUseCase, overviewCrumb, idleToolbarText,
  toggleExplorerBtn, collapseToggleBtn, extensionSDK,
}) => (
            activePaneKind === 'script' ? (
              <TilePreviewPane
                ctl={ctl}
                stageTrailActions={<>{toggleExplorerBtn}{collapseToggleBtn}</>}
              />
            ) : activePaneKind === 'alert' ? (
              <AlertInspectorPane
                bundle={alertBundle}
                previewingDashboard={previewingAlertDashboard}
                onTogglePreviewDashboard={() => setPreviewingAlertDashboard((p) => !p)}
                onOpenInLooker={(p) => extensionSDK.openBrowserWindow(p, '_blank')}
              />
            ) : activePaneKind === 'report' ? (
              <StudioToolbar
                title={healthReport ? (
                  <>
                    {overviewCrumb}
                    <strong>{healthReport.title}</strong>{' '}
                    <StudioBadge>Health Score: {healthReport.scores.overallScore}% ({healthReport.scores.grade})</StudioBadge>{' '}
                    <StudioBadge>Transcriber: {healthReport.scores.transcriberScore}/4.00</StudioBadge>
                  </>
                ) : idleToolbarText}
                actions={
                  <>
                    {healthReport && (
                      <>
                        <button type="button" className="dab-btn-secondary" onClick={() => setTddViewMode((m) => (m === 'rendered' ? 'raw' : 'rendered'))}>
                          {tddViewMode === 'rendered' ? '{ } Raw Markdown' : 'Rendered Report'}
                        </button>
                        <button type="button" className="dab-btn-secondary" onClick={handleCopyTddMarkdown}>{copiedTdd ? '✓ Copied Markdown' : 'Copy Markdown'}</button>
                        <button type="button" className="dab-btn-gemini" onClick={handleDownloadTddMarkdown}>Download Markdown (.md)</button>
                      </>
                    )}
                    <UseCaseInfoTrigger useCase="health-check" onOpen={setInfoModalUseCase} />
                    {toggleExplorerBtn}
                    {collapseToggleBtn}
                  </>
                }
              />
            ) : activePaneKind === 'lookml' ? (
              <StudioToolbar
                className="dab-stage-compact-bar"
                title={lookmlBundle ? (
                  <>
                    {overviewCrumb}
                    <strong>{lookmlBundle.title || cleanLookmlProjectId(lookmlBundle.project_id) || lookmlBundle.model_name || 'LookML Session'}</strong>
                    <StudioBadge tone={lookmlBundle.validation?.passed === false ? 'danger' : 'success'}>
                      {lookmlBundle.validation?.passed === false ? 'Invalid' : 'Valid'}
                    </StudioBadge>
                    {lookmlBundle.branch_name && <code className="dab-stage-inline-meta">{lookmlBundle.branch_name}</code>}
                    <span className="dab-stage-inline-meta">{lookmlBundle.files?.length || 0} files</span>
                    {(lookmlBundle.tests?.length || 0) > 0 && (
                      <StudioBadge tone="neutral">
                        {`${(lookmlBundle.tests || []).filter((t) => t.success).length}/${lookmlBundle.tests?.length} tests`}
                      </StudioBadge>
                    )}
                  </>
                ) : idleToolbarText}
                actions={<><UseCaseInfoTrigger useCase="lookml" onOpen={setInfoModalUseCase} />{toggleExplorerBtn}{collapseToggleBtn}</>}
              />
            ) : activePaneKind === 'ca' ? (
              <>
                <StudioToolbar
                  testId="ca-preview-toolbar"
                  title={caConversation ? (
                    <>
                      {overviewCrumb}
                      <strong>{caConversation.title}</strong>{' '}
                      <StudioBadge testId="ca-selected-agent-badge">Agent: {caConversation.agentName} ({caConversation.agentId})</StudioBadge>{' '}
                      <span className="dab-muted">(Conversation <code>{caConversation.caConversationId}</code> · <code>{caConversation.embedPath}</code>)</span>
                    </>
                  ) : idleToolbarText}
                  actions={
                    <>
                      {caConversation && (
                        <>
                          <button type="button" className="dab-btn-secondary" onClick={() => setIframeRev((r) => r + 1)}>Reload CA Chat</button>
                          <button type="button" className="dab-btn-secondary" onClick={() => extensionSDK.openBrowserWindow(caConversation.embedPath.replace(/^\/embed/, ''), '_blank')}>Open in Looker ↗</button>
                        </>
                      )}
                      <UseCaseInfoTrigger useCase="conversational-analytics" onOpen={setInfoModalUseCase} />
                      {toggleExplorerBtn}
                      {collapseToggleBtn}
                    </>
                  }
                />
                {caConversation?.selectionRationale && (
                  <div data-testid="ca-selection-rationale" style={{ padding: '6px 12px', fontSize: 12, background: 'var(--dab-surface-muted, #f8fafc)', borderBottom: '1px solid var(--dab-border, #e2e8f0)', color: 'var(--dab-text-secondary, #334155)' }}>
                    <strong>Isolated Sub-Agent Selection:</strong> {caConversation.selectionRationale}
                    {caConversation.explores?.length > 0 && <span style={{ marginLeft: 8, color: 'var(--dab-text-muted, #64748b)' }}>· Explores: <code>{caConversation.explores.join(', ')}</code></span>}
                  </div>
                )}
              </>
            ) : (
              <StudioToolbar
                title={
                  allTabsHidden ? (
                    <span className="dab-muted">All tabs hidden — restore an item from the menu above</span>
                  ) : activeContentItem && activeContentItem.contentType !== 'data_app' && activeContentItem.contentType !== 'data-investigator' ? (
                    <>{overviewCrumb}<strong>{activeContentItem.title}</strong> <span className="dab-muted">({activeContentItem.contentType} #{activeContentItem.id} · <code>{activeContentItem.embedPath}</code>)</span></>
                  ) : !activeContentItem && builderMode === 'dashboard' && nativeContent ? (
                    <>{overviewCrumb}<strong>{nativeContent.title}</strong> <span className="dab-muted">({nativeContent.contentType} #{nativeContent.id} · <code>{nativeContent.embedPath}</code>)</span></>
                  ) : publishedApp ? (
                    <>{overviewCrumb}<strong>{publishedApp.title}</strong></>
                  ) : idleToolbarText
                }
                actions={
                  <>
                    {!allTabsHidden && isDataAppPane && currentAppCode && (
                      <StudioButton variant="secondary" testId="preview-view-code-btn" aria-pressed={showAppCode} onClick={() => setShowAppCode((v) => !v)}>
                        <Code2 size={13} strokeWidth={1.75} aria-hidden="true" />
                        <span>{showAppCode ? 'Hide app.js' : 'View app.js'}</span>
                      </StudioButton>
                    )}
                    {!allTabsHidden && activePreviewId && (
                      <>
                        <StudioButton
                          variant="secondary"
                          testId="preview-reload-viewer-btn"
                          data-reloading={reloadingViewer ? 'true' : 'false'}
                          onClick={() => { setShowAppCode(false); setReloadingViewer(true); setIframeRev((r) => r + 1) }}
                        >
                          <RotateCw size={13} strokeWidth={1.75} className={reloadingViewer ? 'dab-spin' : undefined} aria-hidden="true" />
                          <span>Reload Viewer</span>
                        </StudioButton>
                        <button type="button" className="dab-btn-secondary" onClick={() => extensionSDK.openBrowserWindow(openInLookerPath, '_blank')}>Open in Looker ↗</button>
                      </>
                    )}
                    <UseCaseInfoTrigger useCase={!isDataAppPane ? 'dashboard' : selectedUseCase === 'data-investigator' ? 'data-investigator' : 'app'} onOpen={setInfoModalUseCase} />
                    {toggleExplorerBtn}
                    {collapseToggleBtn}
                  </>
                }
              />
            )

)
