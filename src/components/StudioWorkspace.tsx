import React, { useState } from 'react'
import { LkrCodeMode, StudioUseCase } from '../antigravity'
import { ConversationRecord, parseExploreId } from '../lookerApi'
import { LOOKML_TURN_SKILLS, LookmlPreviewPane } from '../lookmlTool'
import { renderTddMarkdownToHtml } from '../healthCheck'
import { StudioController } from '../useStudioController'

function formatConversationContentTag(conv: ConversationRecord): string {
  const c = conv.content || {}
  if (c.reportId) return `TDD #${c.reportId}${typeof c.overallScore === 'number' ? ` (${c.overallScore}%)` : ''}`
  if (c.scriptId) return `Script ${c.scriptId}${c.dashboardId ? ` · #${c.dashboardId}` : ''}`
  if (c.lookmlDashboardId || c.lookId || c.dashboardId) return `${c.lookmlDashboardId ? 'LookML' : c.lookId ? 'Look' : 'Dash'} #${c.lookmlDashboardId || c.lookId || c.dashboardId}`
  if (c.sessionId || c.projectId || c.branch) return `${c.projectId || c.sessionId}${c.branch ? ` · ${c.branch}` : ''}`
  return c.id ? `#${c.id}` : ''
}

export const StudioConversationsSidebar: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    conversations,
    activeConversationId,
    sidebarCollapsed,
    setSidebarCollapsed,
    handleSelectConversation,
    handleDeleteConversation,
    handleNewConversation,
    busyStatus,
  } = ctl

  return (
    <nav
      className={`dab-conv-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
      data-testid="conversations-sidebar"
      aria-label="Previous Conversations"
    >
      <div className="dab-conv-sidebar-header">
        <button
          type="button"
          className="dab-conv-collapse-btn"
          data-testid="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          title={sidebarCollapsed ? 'Expand conversations sidebar' : 'Collapse conversations sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
        {!sidebarCollapsed && (
          <strong className="dab-conv-sidebar-title">
            Conversations ({conversations.length})
          </strong>
        )}
      </div>

      <div className="dab-conv-sidebar-actions">
        <button
          type="button"
          className="dab-conv-new-btn"
          data-testid="new-conversation-btn"
          onClick={handleNewConversation}
          disabled={!!busyStatus}
          title="Start a new conversation"
        >
          {sidebarCollapsed ? '+' : '+ New Conversation'}
        </button>
      </div>

      {!sidebarCollapsed && (
        <div className="dab-conv-list">
          {conversations.length === 0 ? (
            <div className="dab-conv-empty">No previous conversations yet.</div>
          ) : (
            conversations.map((conv) => {
              const contentBadge = formatConversationContentTag(conv)
              const isActive = activeConversationId === conv.id
              return (
                <div
                  key={conv.id}
                  data-testid={`conversation-item-${conv.id}`}
                  className={`dab-conv-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectConversation(conv)}
                  title={`${conv.label} (${conv.type}${conv.interactionId ? ` · ${conv.interactionId}` : ''})`}
                >
                  <div className="dab-conv-item-top">
                    <span className="dab-conv-type-badge">{conv.type}</span>
                    {contentBadge && (
                      <span className="dab-conv-content-tag">{contentBadge}</span>
                    )}
                    <button
                      type="button"
                      className="dab-conv-delete-btn"
                      data-testid={`delete-conversation-${conv.id}`}
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      title="Delete conversation"
                    >
                      ×
                    </button>
                  </div>
                  <div className="dab-conv-item-label">{conv.label}</div>
                </div>
              )
            })
          )}
        </div>
      )}
    </nav>
  )
}

export const StudioCatalogBar: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    filteredCatalog,
    catalogSearch,
    setCatalogSearch,
    activeObjectId,
    handleSelectCatalogItem,
    handleDeleteCatalogItem,
  } = ctl

  return (
    <div className="dab-catalog-bar">
      <div className="dab-catalog-search">
        <strong style={{ fontSize: 12, color: '#334155', whiteSpace: 'nowrap' }}>
          My Creations ({filteredCatalog.length})
        </strong>
        <input
          type="text"
          placeholder="Search by title, ID, type, or explore..."
          value={catalogSearch}
          onChange={(e) => setCatalogSearch(e.target.value)}
          style={{
            flex: 1,
            padding: '3px 8px',
            fontSize: 12,
            border: '1px solid #cbd5e1',
            borderRadius: 4,
          }}
        />
      </div>
      {filteredCatalog.length > 0 && (
        <div className="dab-catalog-list">
          {filteredCatalog.map((item) => (
            <span
              key={`${item.type}:${item.id}`}
              className={`dab-catalog-chip ${activeObjectId === item.id ? 'active' : ''}`}
              onClick={() => handleSelectCatalogItem(item)}
              title={`${item.type.toUpperCase()} #${item.id} · ${(item.explores || []).join(', ')}`}
            >
              <span>
                [{item.type}] {item.label || item.title} (#{item.id})
              </span>
              <button
                type="button"
                onClick={(e) => handleDeleteCatalogItem(e, item)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 11,
                  color: '#94a3b8',
                }}
                title="Delete artifact"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export const StudioComposer: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    builderMode,
    isLookmlMode,
    isHealthCheckMode,
    selectedUseCase,
    setSelectedUseCase,
    isUseCaseLocked,
    allowedUseCases,
    useCaseOptions,
    getUseCaseLabel,
    capabilities,
    selectedExplores,
    schemaMarkdown,
    busyStatus,
    activatedLookmlSkills,
    setActivatedLookmlSkills,
    pastedImages,
    setPastedImages,
    prompt,
    setPrompt,
    handleSendPrompt,
    currentAppCode,
    core40SDK,
    extensionSDK,
    selectedFolderId,
    lookmlProjectId,
    lookmlBundle,
    nativeContent,
    publishedApp,
  } = ctl

  const mockExt =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  const [inspectorOpen, setInspectorOpen] = useState(() => Boolean(mockExt?.initialInspectorOpen))
  const [codeModeSnippet, setCodeModeSnippet] = useState(
    'return search_content(terms="order", types="lookml_explore")'
  )
  const [codeModeOutput, setCodeModeOutput] = useState('')

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []).filter((item) =>
      item.type.startsWith('image/')
    )
    if (items.length === 0) return
    e.preventDefault()
    for (const item of items) {
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        const base64 = dataUrl.split(',')[1]
        if (base64) {
          setPastedImages((prev) => [
            ...prev,
            { mimeType: file.type || 'image/png', data: base64, dataUrl },
          ])
        }
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div className="dab-composer dab-chatbar">
      <div
        className="dab-use-case-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <strong style={{ color: '#475569' }}>Use Case:</strong>
          {!isUseCaseLocked ? (
            <select
              data-testid="use-case-selector"
              value={selectedUseCase}
              onChange={(e) => setSelectedUseCase(e.target.value as StudioUseCase)}
              disabled={!!busyStatus}
              style={{
                height: 26,
                fontSize: 12,
                padding: '0 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontWeight: 500,
              }}
            >
              {useCaseOptions.map((opt) => {
                const isAllowed =
                  opt.value === 'auto' || allowedUseCases.includes(opt.value as any)
                const toolReason =
                  opt.capabilityMode && capabilities?.rolesLoaded
                    ? capabilities.tools?.[opt.capabilityMode]?.reason
                    : undefined
                return (
                  <option
                    key={opt.value}
                    value={opt.value}
                    disabled={!isAllowed}
                    title={!isAllowed ? toolReason || 'Missing Looker permissions' : undefined}
                  >
                    {opt.label}
                    {!isAllowed ? ' (Locked)' : ''}
                  </option>
                )
              })}
            </select>
          ) : (
            <span
              data-testid="locked-use-case-badge"
              className="dab-badge dab-locked-use-case-badge"
              style={{
                background: '#eff6ff',
                color: '#1d4ed8',
                borderColor: '#bfdbfe',
                fontWeight: 600,
              }}
              title="Use case is locked after Turn 1 — start a new conversation to switch use cases"
            >
              🔒 {getUseCaseLabel(selectedUseCase)}
            </span>
          )}
        </div>
      </div>

      {isLookmlMode && (
        <div className="dab-skill-bar" aria-label="Activated Turn Skills">
          <span className="dab-skill-label">Turn Skills:</span>
          {LOOKML_TURN_SKILLS.map((sk) => {
            const isActive = activatedLookmlSkills.includes(sk.id)
            return (
              <button
                key={sk.id}
                type="button"
                className={`dab-skill-chip ${isActive ? 'active' : ''}`}
                title={sk.desc}
                onClick={() =>
                  setActivatedLookmlSkills((prev) =>
                    prev.includes(sk.id)
                      ? prev.filter((x) => x !== sk.id)
                      : [...prev, sk.id]
                  )
                }
              >
                {isActive ? '✓ ' : '+ '}
                {sk.label}
              </button>
            )
          })}
        </div>
      )}

      {pastedImages.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {pastedImages.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={img.dataUrl}
                alt="Pasted screenshot"
                style={{ height: 52, borderRadius: 4, border: '1px solid #cbd5e1' }}
              />
              <button
                type="button"
                onClick={() => setPastedImages((prev) => prev.filter((_, idx) => idx !== i))}
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#0f172a',
                  color: '#fff',
                  fontSize: 10,
                  cursor: 'pointer',
                  lineHeight: '18px',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        rows={3}
        data-testid="studio-prompt-input"
        placeholder={
          isHealthCheckMode
            ? 'Optional custom focus for 3-Pillar Looker & BigQuery Health Check...'
            : isLookmlMode
            ? 'Describe LookML changes, SQL query to model, or field descriptions/tests to run in your active dev mode...'
            : builderMode === 'dashboard'
            ? 'Describe a Looker UDD, Look, Board, or Schedule to create or update...'
            : 'Describe the Data App to build or paste a screenshot (Cmd+Enter to send)...'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            handleSendPrompt()
          }
        }}
        disabled={!!busyStatus}
      />

      <div className="dab-composer-actions">
        <details
          className="dab-inspector"
          open={inspectorOpen}
          onToggle={(e) => setInspectorOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            Inspect Code / Schema {currentAppCode ? `(${currentAppCode.length} B)` : ''}
          </summary>
          <div className="dab-inspector-content">
            {currentAppCode && (
              <>
                <div className="dab-inspector-bar">
                  <strong>app.js</strong>
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={() => navigator.clipboard?.writeText(currentAppCode)}
                  >
                    Copy app.js
                  </button>
                </div>
                <pre>{currentAppCode}</pre>
              </>
            )}
            <strong>Compiled Explore Schema (/workspace/schema.md)</strong>
            <pre>{schemaMarkdown}</pre>
            <div className="dab-inspector-bar">
              <strong>Test WASM Code Mode (Monty)</strong>
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={async () => {
                  try {
                    setCodeModeOutput('Running in WASM Monty sandbox...')
                    const firstParsed = selectedExplores[0]
                      ? parseExploreId(selectedExplores[0])
                      : null
                    const out = await LkrCodeMode.runPythonCode({
                      code: codeModeSnippet,
                      sdk: core40SDK,
                      extensionSDK,
                      allowUpdateSession: isLookmlMode || builderMode === 'dashboard',
                      vars: {
                        target_explores: selectedExplores,
                        target_model: firstParsed?.modelName || '',
                        target_explore: firstParsed?.exploreName || '',
                        target_folder_id: selectedFolderId,
                        target_project_id: lookmlProjectId,
                      },
                    })
                    setCodeModeOutput(out)
                  } catch (err: any) {
                    setCodeModeOutput(`Error: ${err?.message || err}`)
                  }
                }}
              >
                Run Python
              </button>
            </div>
            <textarea
              rows={3}
              value={codeModeSnippet}
              onChange={(e) => setCodeModeSnippet(e.target.value)}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: 11,
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 4,
                padding: 6,
              }}
            />
            {codeModeOutput && <pre>{codeModeOutput}</pre>}
          </div>
        </details>

        <button
          type="button"
          className="dab-btn-gemini"
          onClick={handleSendPrompt}
          disabled={!!busyStatus || (!prompt.trim() && pastedImages.length === 0)}
        >
          {isLookmlMode
            ? lookmlBundle
              ? '✨ Update LookML'
              : '✨ Run Agentic LookML'
            : builderMode === 'dashboard'
            ? nativeContent
              ? '✨ Update Content'
              : '✨ Create / Update Content'
            : publishedApp
            ? '✨ Update App'
            : '✨ Build App'}
        </button>
      </div>
    </div>
  )
}

export const StudioCenteredEmptyStage: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    builderMode,
    isLookmlMode,
    isHealthCheckMode,
    models,
    selectedExplores,
    loadingSchema,
    schemaMarkdown,
  } = ctl

  return (
    <main className="dab-empty-stage-centered" data-testid="centered-empty-prompt">
      <div className="dab-empty-prompt-card">
        <div className="dab-empty-hero">
          <span className="dab-badge">New Conversation</span>
          <h2>
            {isHealthCheckMode
              ? 'Run a 3-Pillar Looker & BigQuery Health Check'
              : isLookmlMode
              ? 'Author & Validate Agentic LookML'
              : builderMode === 'dashboard'
              ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
              : 'Build a Looker Data App with Antigravity'}
          </h2>
          <p className="dab-muted">
            {selectedExplores.length === 0 ? (
              <>
                <strong>Let Agent Decide:</strong> No explore pre-selected — Antigravity will
                search across all {models.length} models using Looker&apos;s Solr{' '}
                <code>search_content</code> &amp; <code>lookml_model_explore</code> in WASM
                CodeMode.
              </>
            ) : (
              <>
                Compiled schema for <code>{selectedExplores.join(', ')}</code>{' '}
                {loadingSchema
                  ? 'is loading...'
                  : `is ready (${schemaMarkdown.length.toLocaleString()} chars).`}
              </>
            )}
          </p>
        </div>

        <StudioComposer ctl={ctl} />
        <StudioCatalogBar ctl={ctl} />
      </div>
    </main>
  )
}

export const StudioLeftPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    messages,
    builderMode,
    models,
    selectedExplores,
    loadingSchema,
    schemaMarkdown,
    busyStatus,
    pendingPerm,
    resolvePermDecision,
  } = ctl

  return (
    <aside className="dab-left-pane">
      <StudioCatalogBar ctl={ctl} />

      <div className="dab-chat-log">
        {messages.length === 0 && (
          <div className="dab-empty-chat">
            <p>
              <strong>
                {builderMode === 'dashboard'
                  ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
                  : 'Build a Looker Data App with Antigravity'}
              </strong>
            </p>
            <p>
              {selectedExplores.length === 0 ? (
                <>
                  <strong>Let Agent Decide:</strong> No explore pre-selected — Antigravity will
                  search across all {models.length} models using Looker&apos;s Solr{' '}
                  <code>search_content</code> &amp; <code>lookml_model_explore</code> in WASM
                  CodeMode.
                </>
              ) : (
                <>
                  Compiled schema for <code>{selectedExplores.join(', ')}</code>{' '}
                  {loadingSchema
                    ? 'is loading...'
                    : `is ready (${schemaMarkdown.length.toLocaleString()} chars).`}
                </>
              )}
            </p>
            <p>
              {builderMode === 'dashboard'
                ? 'Creates or updates native Looker UDDs, Looks, Boards, and Schedules via CodeMode, indexes them in your My Creations catalog, and previews them on the right.'
                : "Every turn validates your app in Antigravity's Linux sandbox, registers widget queries, and auto-publishes the live Looker dashboard on the right."}
            </p>
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={idx} className={`dab-msg dab-msg-${m.role}`}>
            <div className="dab-msg-header">
              {m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : 'Antigravity'}
              {m.dashboardId && (
                <span className="dab-msg-pill">
                  Dashboard #{m.dashboardId}
                  {typeof m.widgetCount === 'number' ? ` · ${m.widgetCount} queries` : ''}
                </span>
              )}
            </div>
            <div className="dab-msg-body">{m.text}</div>
            {m.images && m.images.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {m.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="Attached screenshot"
                    style={{ maxHeight: 80, borderRadius: 4, border: '1px solid #cbd5e1' }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {busyStatus && (
          <div className="dab-status-banner">
            <span className="dab-spinner" />
            <span>{busyStatus}</span>
          </div>
        )}
      </div>

      {pendingPerm && (
        <div className="dab-permission-bar">
          <div>
            <strong>Approve Looker State Mutation?</strong>{' '}
            <code>{pendingPerm.req.operation}</code> (
            <code>
              {pendingPerm.req.httpMethod} {pendingPerm.req.path}
            </code>
            )
          </div>
          <div className="dab-permission-actions">
            <button
              type="button"
              className="dab-btn-primary"
              onClick={() => resolvePermDecision('allow_once')}
            >
              Allow once
            </button>
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() => resolvePermDecision('allow_op')}
            >
              Allow all &apos;{pendingPerm.req.operation}&apos; this turn
            </button>
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() => resolvePermDecision('allow_all')}
            >
              Allow all mutations this turn
            </button>
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() => resolvePermDecision('deny')}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      <StudioComposer ctl={ctl} />
    </aside>
  )
}

export const StudioRightPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    isHealthCheckMode,
    isLookmlMode,
    builderMode,
    healthReport,
    lookmlBundle,
    canDeployLookml,
    nativeContent,
    publishedApp,
    extensionSDK,
  } = ctl

  const hostUrl = (extensionSDK as any)?.lookerHostData?.hostUrl || window.location.origin
  const mockExt =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  const [tddViewMode, setTddViewMode] = useState<'rendered' | 'raw'>(
    () => mockExt?.initialTddViewMode || 'rendered'
  )
  const [copiedTdd, setCopiedTdd] = useState(false)
  const [iframeRev, setIframeRev] = useState(1)

  const handleCopyTddMarkdown = () => {
    if (!healthReport?.tddMarkdown) return
    navigator.clipboard?.writeText(healthReport.tddMarkdown)
    setCopiedTdd(true)
    setTimeout(() => setCopiedTdd(false), 1800)
  }

  const handleDownloadTddMarkdown = () => {
    if (!healthReport?.tddMarkdown) return
    const url = URL.createObjectURL(
      new Blob([healthReport.tddMarkdown], { type: 'text/markdown;charset=utf-8' })
    )
    Object.assign(document.createElement('a'), {
      href: url,
      download: 'TECHNICAL_DESIGN_DOCUMENT.md',
    }).click()
    URL.revokeObjectURL(url)
  }

  const activePreviewId =
    builderMode === 'dashboard' ? nativeContent?.id : publishedApp?.dashboardId
  const embedUrl =
    builderMode === 'dashboard'
      ? nativeContent
        ? `${hostUrl.replace(/\/$/, '')}${nativeContent.embedPath}`
        : ''
      : publishedApp
      ? `${hostUrl.replace(/\/$/, '')}/embed/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
      : ''
  const openInLookerPath =
    builderMode === 'dashboard' && nativeContent
      ? nativeContent.embedPath.replace(/^\/embed/, '')
      : publishedApp
      ? `/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
      : ''

  return (
    <main className="dab-right-pane">
      {isHealthCheckMode ? (
        <>
          <div className="dab-preview-toolbar">
            <div>
              {healthReport ? (
                <>
                  <strong>{healthReport.title}</strong>{' '}
                  <span className="dab-badge">
                    Health Score: {healthReport.scores.overallScore}% ({healthReport.scores.grade})
                  </span>{' '}
                  <span className="dab-badge">
                    Transcriber: {healthReport.scores.transcriberScore}/4.00
                  </span>{' '}
                  <span className="dab-muted">
                    (user_{healthReport.createdBy}_health_check_{healthReport.id} · obj_health_check_
                    {healthReport.id})
                  </span>
                </>
              ) : (
                <span className="dab-muted">
                  7-section TECHNICAL_DESIGN_DOCUMENT.md (0–100% health score) will render here
                </span>
              )}
            </div>
            {healthReport && (
              <div className="dab-preview-actions">
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => setTddViewMode((m) => (m === 'rendered' ? 'raw' : 'rendered'))}
                >
                  {tddViewMode === 'rendered' ? '{ } Raw Markdown' : '📖 Rendered Report'}
                </button>
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={handleCopyTddMarkdown}
                >
                  {copiedTdd ? '✓ Copied Markdown' : 'Copy Markdown'}
                </button>
                <button
                  type="button"
                  className="dab-btn-gemini"
                  onClick={handleDownloadTddMarkdown}
                >
                  ✨ Download Markdown (.md)
                </button>
              </div>
            )}
          </div>
          <div className="dab-iframe-container">
            {healthReport ? (
              <div className="dab-tdd-viewer">
                {tddViewMode === 'rendered' ? (
                  <div
                    className="dab-tdd-rendered"
                    dangerouslySetInnerHTML={{
                      __html: renderTddMarkdownToHtml(healthReport.tddMarkdown),
                    }}
                  />
                ) : (
                  <pre className="dab-tdd-markdown">{healthReport.tddMarkdown}</pre>
                )}
              </div>
            ) : (
              <div className="dab-placeholder">
                <p>No 3-Pillar Health Check report loaded yet.</p>
                <p className="dab-muted">
                  Click <strong>✨ Run 3-Pillar Audit</strong> in the top-right bar or enter a
                  prompt on the left to execute Pillar 1 (System Activity), Pillar 2 (LookML 0–4
                  Transcriber Rubric), and Pillar 3 (BigQuery INFORMATION_SCHEMA) in{' '}
                  <code>LkrCodeMode</code>.
                </p>
              </div>
            )}
          </div>
        </>
      ) : isLookmlMode ? (
        <>
          <div className="dab-preview-toolbar">
            <div>
              {lookmlBundle ? (
                <>
                  <strong>{lookmlBundle.title}</strong>{' '}
                  <span className="dab-muted">
                    (Session <code>obj_lookml_{lookmlBundle.id}</code> ·{' '}
                    {lookmlBundle.files?.length || 0} .lkml files)
                  </span>
                </>
              ) : (
                <span className="dab-muted">
                  Agentic LookML preview (.lkml diffs, validator, run_lookml_test &amp; /sql/:slug +
                  /x/:slug parity)
                </span>
              )}
            </div>
          </div>
          <div className="dab-iframe-container">
            <LookmlPreviewPane
              bundle={lookmlBundle}
              hostUrl={hostUrl}
              extensionSDK={extensionSDK}
              canDeploy={canDeployLookml}
            />
          </div>
        </>
      ) : (
        <>
          <div className="dab-preview-toolbar">
            <div>
              {builderMode === 'dashboard' ? (
                nativeContent ? (
                  <>
                    <strong>{nativeContent.title}</strong>{' '}
                    <span className="dab-muted">
                      ({nativeContent.contentType} #{nativeContent.id} ·{' '}
                      <code>{nativeContent.embedPath}</code>)
                    </span>
                  </>
                ) : (
                  <span className="dab-muted">
                    Live Looker UDD / Look / Board preview will appear here after the first turn
                  </span>
                )
              ) : publishedApp ? (
                <>
                  <strong>{publishedApp.title}</strong>{' '}
                  <span className="dab-muted">
                    (Dashboard #{publishedApp.dashboardId} · Extension db::
                    {publishedApp.extensionId.slice(0, 8)}…)
                  </span>
                </>
              ) : (
                <span className="dab-muted">
                  Live Looker Data App preview will appear here after the first turn
                </span>
              )}
            </div>
            {activePreviewId && (
              <div className="dab-preview-actions">
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => setIframeRev((r) => r + 1)}
                >
                  Reload Preview
                </button>
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => extensionSDK.openBrowserWindow(openInLookerPath, '_blank')}
                >
                  Open in Looker ↗
                </button>
              </div>
            )}
          </div>

          <div className="dab-iframe-container">
            {activePreviewId && embedUrl ? (
              <iframe
                key={`${builderMode}-${activePreviewId}-${iframeRev}`}
                src={embedUrl}
                srcDoc={
                  typeof window !== 'undefined'
                    ? (window as any).__MOCK_LOOKER_EXTENSION__?.getMockPreviewHtml?.(
                        builderMode,
                        activePreviewId
                      )
                    : undefined
                }
                title="Looker Live Preview"
                className="dab-iframe"
              />
            ) : (
              <div className="dab-placeholder">
                <p>
                  {builderMode === 'dashboard'
                    ? 'No active native Looker content yet.'
                    : 'No active Data App yet.'}
                </p>
                <p className="dab-muted">
                  {builderMode === 'dashboard'
                    ? 'Ask on the left to build a native Looker UDD, Look, Board, or Schedule via CodeMode, or pick from My Creations.'
                    : 'Enter a prompt on the left to create a new Data App, or load an existing Dashboard ID from the top bar.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  )
}
