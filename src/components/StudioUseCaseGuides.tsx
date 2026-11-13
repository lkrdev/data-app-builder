import React, { useEffect, useState } from 'react'

import {
  Archive, ArchiveRestore, BookOpen, Check, Code2, Copy, Database, Eye, FileText,
  LayoutDashboard, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Trash2, Wrench,
} from 'lucide-react'

import {
  buildDynamicStarterPrompts, cleanLookmlProjectId, normalizeSandboxFilePath,
  resolveBuiltinWorkspaceFileContent, StarterPromptItem, stripStarterPromptEmojis, StudioUseCase,
} from '../antigravity'
import {
  ConversationRecord, copyTextWithExtensionSdk, resolveConversationRelatedContent,
  StudioContextCategory,
} from '../lookerApi'
import { STUDIO_SLASH_SKILLS } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import {
  StudioBadge, StudioButton, StudioDocPreview, StudioModal, StudioSelect, StudioSkeleton,
} from './StudioDesignSystem'
import { StudioMarkdown } from './StudioMarkdown'

export function formatConversationContentTag(conv: ConversationRecord): string {
  const c = conv.content || {}
  if (c.caConversationId || c.agentId) return `CA · ${c.agentName || c.agentId || c.caConversationId}`
  if (c.reportId) return `TDD #${c.reportId}${typeof c.overallScore === 'number' ? ` (${c.overallScore}%)` : ''}`
  if (c.scriptId) return `Script ${c.scriptId}${c.dashboardId ? ` · #${c.dashboardId}` : ''}`
  if (c.lookmlDashboardId || c.lookId || c.dashboardId) return `${c.lookmlDashboardId ? 'LookML' : c.lookId ? 'Look' : 'Dash'} #${c.lookmlDashboardId || c.lookId || c.dashboardId}`
  const lkId = cleanLookmlProjectId(c.projectId) || cleanLookmlProjectId(c.sessionId)
  if (lkId || c.branch) return `${lkId || 'LookML'}${c.branch ? `${lkId ? ' · ' : ' '}${c.branch}` : ''}`
  const rawId = cleanLookmlProjectId(c.id)
  return rawId ? `#${rawId}` : ''
}

export const DOC_UI_COMPONENTS: Record<string, () => React.ReactElement> = {
  PublishDashboardButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Publish Dashboard</button>,
  ScheduleScriptButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Schedule Script</button>,
  SaveScriptButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Save Script</button>,
  RunPythonButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Run Python</button>,
  ScriptModeSelect: () => (
    <StudioSelect
      className="dab-select" value="summary" onChange={() => {}}
      options={[{ value: 'summary', label: 'summary' }, { value: 'detailed_audit', label: 'detailed_audit' }, { value: 'anomaly_alert', label: 'anomaly_alert' }]}
    />
  ),
  ReloadPreviewButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Reload Viewer</button>,
  OpenInLookerButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Open in Looker ↗</button>,
  LookmlTurnSkills: () => (
    <div
      className="dab-ds-card"
      data-testid="doc-slash-skill-menu-preview"
      style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4, width: 360, maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--dab-text-secondary)' }}>
        <Wrench size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>Slash Command Skill Menu (type /)</span>
      </div>
      {STUDIO_SLASH_SKILLS.slice(0, 3).map((sk, idx) => (
        <div
          key={sk.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 5, fontSize: 12, minWidth: 0, overflow: 'hidden',
            background: idx === 0 ? 'var(--dab-accent-subtle, #eff6ff)' : 'transparent',
            color: idx === 0 ? 'var(--dab-accent-text, #1d4ed8)' : 'var(--dab-text)',
          }}
        >
          <BookOpen size={13} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
          <code style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, background: 'transparent', color: 'inherit', padding: 0 }}>{`/${sk.id}`}</code>
          <span className="dab-muted dab-studio-menu-text" style={{ fontSize: 12 }}>{sk.desc}</span>
        </div>
      ))}
    </div>
  ),
  PushLookmlButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Update LookML</button>,
  ExportHealthTddButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Download Markdown (.md)</button>,
  DataInvestigatorPreview: () => (
    <div className="dab-skill-bar" data-testid="data-investigator-doc-slides-preview">
      <span className="dab-skill-label">Narrative View:</span>
      <button type="button" className="dab-skill-chip active" tabIndex={-1}>Doc View</button>
      <button type="button" className="dab-skill-chip" tabIndex={-1}>Slides View</button>
    </div>
  ),
}

export const USE_CASE_BADGES: Record<StudioUseCase, { label: string; className: string }> = {
  auto: { label: 'Auto', className: 'dab-use-case-badge-auto' },
  dashboard: { label: 'Content Studio', className: 'dab-use-case-badge-dashboard' },
  'conversational-analytics': { label: 'Conversational Analytics', className: 'dab-use-case-badge-ca' },
  app: { label: 'Data App', className: 'dab-use-case-badge-app' },
  'data-investigator': { label: 'Data Investigator', className: 'dab-use-case-badge-investigator' },
  'health-check': { label: 'Health Check', className: 'dab-use-case-badge-health' },
  lookml: { label: 'LookML', className: 'dab-use-case-badge-lookml' },
  tile: { label: 'Script', className: 'dab-use-case-badge-tile' },
}

export const USE_CASE_GUIDES: Record<StudioUseCase, { title: string; tabLabel: string; markdown: string }> = {
  auto: {
    title: 'Auto — Smart Looker Agent Routing Guide',
    tabLabel: 'Auto',
    markdown: [
      '# Automatic Workflow Discovery',
      '**Auto** routes each turn to the best Looker workflow allowed by your Looker permissions.',
      '## Composer Shortcuts & Multi-Tab Viewer',
      '- **Slash Command Skills (`/`)**: Type `/` (e.g. `/looker-project-onboarding`, `/lookml-field-curation`, `/looker-dashboard`, `/key-driver-analysis`) to activate domain skills.',
      '- **Context Mentions (`@`)**: Type `@explore:`, `@dashboard:`, `@look:`, or `@conversation:` (or `+`) to attach live Looker metadata.',
      '- **Multi-Tab Viewer**: Every dashboard, LookML Dashboard, Data App, Look, or Board stays switchable in the right-hand Viewer.',
      '## Use Cases',
      '- **Agentic LookML**: Onboard Looker projects from connections, and author, validate, and test LookML views, explores, refinements, and descriptions.',
      '- **Content Studio**: Create and update UDDs, LookML Dashboards, Saved Looks, Boards, and Scheduled Plans.',
      '- **Conversational Analytics**: Ask plain-language questions with Looker Conversational Analytics agents.',
      '- **Data App**: Build interactive Data Apps with KPIs, charts, grids, and metric switchers, or convert screenshots.',
      '- **Data Investigator**: Generate Doc or Slides root-cause narrative apps with Key Driver Analysis, LookML drills (`limit: 500`), and fixed date windows.',
      '- **Health Check**: Run a 3-Pillar Looker and BigQuery performance and LookML maturity audit.',
      '- **Python Tile (Script)**: Write, test, publish, and schedule Python scripts as interactive dashboard tiles.',
    ].join('\n'),
  },
  lookml: {
    title: 'Agentic LookML — Project Onboarding, Modeling & Data Tests',
    tabLabel: 'Agentic LookML',
    markdown: [
      '# Agentic LookML Modeling & Project Onboarding',
      'Onboard new LookML projects from a Looker connection, or refine models, views, explores, field descriptions, and data tests in your dev workspace.',
      '## Activate Skills with `/` Slash Commands & `@` Mentions',
      '<LookmlTurnSkills />',
      '- Type `/` for `/looker-project-onboarding`, `/lookml-field-curation`, `/lookml-tests`, or `/looker-field-profiler`, and `@explore:` to scope models and Explores.',
      '- Browse modified `.lkml` files in the scrollable tab strip and use the 3-dot menu to toggle unified diffs vs. full `.lkml` or copy files.',
      '## Review Diffs & Update LookML',
      '<PushLookmlButton />',
      '- Inspect LookML Validator results, `run_lookml_test` assertions, and SQL vs. Explore parity links in the Viewer.',
    ].join('\n'),
  },
  dashboard: {
    title: 'Content Studio — UDDs, LookML Dashboards, Looks, Boards & Schedules',
    tabLabel: 'Content Studio',
    markdown: [
      '# Native Looker Content Studio',
      'Create and update Looker User-Defined Dashboards (UDDs), LookML Dashboards (`.dashboard.lookml` synced to your folder), Saved Looks, Boards, and Schedules.',
      '## Context, Skills & Multi-Tab Viewer',
      '- Reference `@explore:`, `@dashboard:`, or `@look:`, or invoke `/looker-dashboard` and `/looker-field-profiler` before building tiles.',
      '- Switch across dashboards, LookML Dashboards, and Looks in the multi-tab Viewer bar.',
      '## Viewer Controls',
      '<ReloadPreviewButton />',
      '<OpenInLookerButton />',
      '- Reloads the embedded dashboard or Look in place, or opens it in Looker from `Save New Content to Folder:`.',
    ].join('\n'),
  },
  'conversational-analytics': {
    title: 'Conversational Analytics — Natural-Language Data Q&A',
    tabLabel: 'Conversational Analytics',
    markdown: [
      '# Looker Conversational Analytics',
      'Ask analytical questions in plain language, match with the best Looker Conversational Analytics agent, and explore interactive answers.',
      '## Embedded Controls',
      '<ReloadPreviewButton />',
      '<OpenInLookerButton />',
      '- Reloads the embedded session or opens the full thread in Looker.',
    ].join('\n'),
  },
  app: {
    title: 'Data App — Custom Interactive Looker Applications',
    tabLabel: 'Data App',
    markdown: [
      '# Interactive Looker Data Apps',
      'Build interactive apps with KPI cards, dynamic charts, data grids, and metric switchers published into a Looker dashboard tile, or paste a screenshot (`Cmd+V`).',
      '## Live Viewer Controls',
      '<ReloadPreviewButton />',
      '<OpenInLookerButton />',
      '- Re-runs the live dashboard viewer or opens the published Data App in Looker.',
    ].join('\n'),
  },
  'data-investigator': {
    title: 'Data Investigator — Google Doc & Slides Root-Cause Narrative Apps',
    tabLabel: 'Data Investigator',
    markdown: [
      '# Point-in-Time Root-Cause Narrative Data Apps',
      'Investigate metric changes using Key Driver Analysis (`run_key_driver_analysis`), LookML `drill_fields` (`limit: 500`), and fixed date ranges (`YYYY-MM-DD to YYYY-MM-DD`).',
      '## Google Doc & Slides Modes',
      '<DataInvestigatorPreview />',
      '- **Doc View (Default)**: Executive overview plus **Chart -> What This Chart Means -> Next Investigation Path** chapters and a 500-row evidence grid.',
      '- **Slides View**: Mention `slides`, `presentation`, or `deck` (or toggle in header) for slide-by-slide navigation.',
      '<ReloadPreviewButton />',
      '<OpenInLookerButton />',
    ].join('\n'),
  },
  'health-check': {
    title: 'Health Check — 3-Pillar Looker & BigQuery Audit',
    tabLabel: 'Health Check',
    markdown: [
      '# 3-Pillar Looker & BigQuery Health Check',
      'Audit **Pillar 1** (System Activity latency and caching), **Pillar 2** (LookML quality), and **Pillar 3** (BigQuery slot usage and partitioning).',
      '## Export Technical Design Document (TDD)',
      '<ExportHealthTddButton />',
      '- Download or copy the Markdown TDD, or toggle **Rendered Report** vs. **`{ } Raw Markdown`**.',
    ].join('\n'),
  },
  tile: {
    title: 'Python Tile (Script) — Custom Data Scripts & Scheduling',
    tabLabel: 'Script',
    markdown: [
      '# Publish As Dashboard',
      '<PublishDashboardButton />',
      'Publishes your Python script as an interactive Looker dashboard tile in your selected folder.',
      '## Execute & Test Script Mode',
      '<RunPythonButton />',
      '<ScriptModeSelect />',
      'Runs your Python script in the in-browser sandbox across modes (`summary`, `detailed_audit`, `anomaly_alert`) with live dashboard filters.',
      '## Save & Schedule Recurring Runs',
      '<SaveScriptButton />',
      '<ScheduleScriptButton />',
      '- Save your script or configure recurring cron schedules and delivery.',
    ].join('\n'),
  },
}

export const USE_CASE_GUIDE_ORDER = (Object.keys(USE_CASE_GUIDES) as StudioUseCase[]).map((useCase) => ({
  useCase,
  tabLabel: USE_CASE_GUIDES[useCase].tabLabel,
}))

// ponytail: lightweight Markdown + <ComponentName /> parser that wraps mapped React UI controls in a non-actionable preview container
export function renderUseCaseGuideMarkdown(markdown: string): React.ReactElement {
  const wrapPreview = (compName: string, key: string): React.ReactElement | null => {
    const renderFn = DOC_UI_COMPONENTS[compName]
    return renderFn ? StudioDocPreview({ key, component: compName, children: renderFn() }) : null
  }
  const renderInline = (text: string, keyPrefix: string): React.ReactNode[] =>
    text
      .split(/(`[^`]+`|\*\*[^*]+\*\*|<[A-Z][A-Za-z0-9_]*\s*\/>)/g)
      .filter(Boolean)
      .map((part, idx) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) return <code key={`${keyPrefix}-c-${idx}`}>{part.slice(1, -1)}</code>
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) return <strong key={`${keyPrefix}-b-${idx}`}>{part.slice(2, -2)}</strong>
        const tagMatch = part.match(/^<([A-Z][A-Za-z0-9_]*)\s*\/>$/)
        if (tagMatch && DOC_UI_COMPONENTS[tagMatch[1]]) return wrapPreview(tagMatch[1], `${keyPrefix}-ui-${idx}`)
        return part
      })

  const lines = String(markdown || '').split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) { i++; continue }
    const standaloneComp = trimmed.match(/^<([A-Z][A-Za-z0-9_]*)\s*\/>$/)
    if (standaloneComp && DOC_UI_COMPONENTS[standaloneComp[1]]) {
      blocks.push(wrapPreview(standaloneComp[1], `block-ui-${i}`))
      i++; continue
    }
    const hMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (hMatch) {
      const tag = `h${hMatch[1].length}`
      blocks.push(React.createElement(tag, { key: `${tag}-${i}` }, renderInline(hMatch[2], `${tag}-${i}`)))
      i++; continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(<li key={`li-${i}`}>{renderInline(lines[i].trim().replace(/^[-*]\s+/, ''), `li-${i}`)}</li>)
        i++
      }
      blocks.push(<ul key={`ul-${i}`}>{items}</ul>)
      continue
    }
    blocks.push(<p key={`p-${i}`}>{renderInline(trimmed, `p-${i}`)}</p>)
    i++
  }
  return <div className="dab-tdd-rendered dab-use-case-guide-markdown">{blocks}</div>
}

export const UseCaseInfoTrigger: React.FC<{ useCase: StudioUseCase; onOpen: (uc: StudioUseCase) => void }> = ({ useCase, onOpen }) => (
  <button
    type="button" data-testid="use-case-info-btn" className="dab-btn dab-btn-secondary dab-info-trigger"
    title="Use case guide & controls reference" onClick={() => onOpen(useCase)}
  >
    ?
  </button>
)

export const UseCaseInfoModal: React.FC<{
  activeUseCase: StudioUseCase | null; onSelectUseCase: (uc: StudioUseCase) => void; onClose: () => void
}> = ({ activeUseCase, onSelectUseCase, onClose }) => {
  const guide = (activeUseCase && USE_CASE_GUIDES[activeUseCase]) || USE_CASE_GUIDES.auto
  return (
    <StudioModal
      open={Boolean(activeUseCase)} onClose={onClose} testId="use-case-info-modal" closeTestId="use-case-info-close-btn"
      closeLabel="Close" className="dab-use-case-info-modal" title={guide.title}
      subtitle="Interactive guide & live-themed UI controls reference (non-actionable preview)"
    >
      <div className="dab-use-case-guide-tabs" role="tablist" aria-label="Use Case Guides">
        {USE_CASE_GUIDE_ORDER.map((item) => (
          <button
            key={item.useCase} type="button" role="tab" aria-selected={activeUseCase === item.useCase}
            data-testid={`use-case-guide-tab-${item.useCase}`}
            className={`dab-skill-chip ${activeUseCase === item.useCase ? 'active' : ''}`}
            onClick={() => onSelectUseCase(item.useCase)}
          >
            {item.tabLabel}
          </button>
        ))}
      </div>
      <div className="dab-use-case-guide-body" data-testid="use-case-info-mdx-body">
        {renderUseCaseGuideMarkdown(guide.markdown)}
      </div>
    </StudioModal>
  )
}

export const StudioConversationsSidebar: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    conversations, archivedConversations, showArchivedConversations, setShowArchivedConversations,
    pendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent, activeConversationId,
    sidebarCollapsed, setSidebarCollapsed, handleSelectConversation, handleToggleArchiveConversation,
    handleRequestDeleteConversation, handleCancelDeleteConversation, handleConfirmDeleteConversation,
    handleNewConversation, busyStatus, userId,
  } = ctl

  const renderConversationRow = (conv: ConversationRecord, isArchived = false) => {
    const contentBadge = formatConversationContentTag(conv)
    const isActive = activeConversationId === conv.id
    return (
      <div
        key={conv.id} data-testid={`conversation-item-${conv.id}`}
        className={`dab-conv-item ${isActive ? 'active' : ''} ${isArchived ? 'archived' : ''}`}
        onClick={() => handleSelectConversation(conv)}
        title={`${conv.label} (${conv.type}${conv.interactionId ? ` · ${conv.interactionId}` : ''})`}
      >
        <div className="dab-conv-item-top">
          <span className="dab-conv-type-badge">{conv.type}</span>
          {contentBadge && <span className="dab-conv-content-tag">{contentBadge}</span>}
          <div className="dab-conv-item-actions">
            <button
              type="button" className="dab-conv-action-btn dab-conv-archive-btn" data-testid={`archive-conv-${conv.id}`}
              onClick={(e) => handleToggleArchiveConversation(e, conv.id, !isArchived)}
              title={isArchived ? 'Unarchive conversation' : 'Archive conversation'}
            >
              {isArchived ? <ArchiveRestore size={14} strokeWidth={1.75} aria-hidden="true" /> : <Archive size={14} strokeWidth={1.75} aria-hidden="true" />}
            </button>
            <button
              type="button" className="dab-conv-action-btn dab-conv-delete-btn" data-testid={`delete-conv-${conv.id}`}
              onClick={(e) => handleRequestDeleteConversation(e, conv)} title="Delete conversation"
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="dab-conv-item-label">{conv.label}</div>
      </div>
    )
  }

  const relatedInfo = pendingDeleteConv ? resolveConversationRelatedContent(pendingDeleteConv, userId) : null
  const hostUrl = (ctl.extensionSDK?.lookerHostData?.hostUrl || ctl.lookerHostData?.hostUrl || '').replace(/\/$/, '')

  return (
    <nav className={`dab-conv-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} data-testid="conversations-sidebar" aria-label="Previous Conversations">
      <div className="dab-conv-sidebar-header">
        <button
          type="button" className="dab-conv-collapse-btn" data-testid="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          title={sidebarCollapsed ? 'Expand conversations sidebar' : 'Collapse conversations sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={14} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={14} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        {!sidebarCollapsed && <strong className="dab-conv-sidebar-title">Conversations ({conversations.length})</strong>}
      </div>

      <div className="dab-conv-sidebar-actions">
        <button
          type="button" className="dab-conv-new-btn" data-testid="new-conversation-btn"
          onClick={() => handleNewConversation('auto')} disabled={!!busyStatus} title="Start a new conversation"
        >
          {sidebarCollapsed ? '+' : '+ New Conversation'}
        </button>
        {sidebarCollapsed && !ctl.isEmptyConversation && (
          <button
            type="button"
            className="dab-conv-new-btn dab-conv-overview-btn"
            data-testid="sidebar-overview-btn"
            onClick={() => {
              if (!ctl.rightPaneCollapsed && ctl.activeContentTabKey === 'overview') {
                ctl.setActiveContentTabKey('')
                ctl.setRightPaneCollapsed(true)
              } else {
                ctl.handleSelectOverview()
                ctl.setRightPaneCollapsed(false)
              }
            }}
            title="Toggle Conversation Overview"
            aria-label="Toggle Conversation Overview"
          >
            <PanelRightOpen size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>

      {!sidebarCollapsed && (
        <div className="dab-conv-list">
          {conversations.length === 0 ? <div className="dab-conv-empty">No previous conversations yet.</div> : conversations.map((conv) => renderConversationRow(conv, false))}
          <div className="dab-conv-archived-section">
            <button type="button" className="dab-conv-archived-toggle" data-testid="toggle-archived-convs" onClick={() => setShowArchivedConversations((prev) => !prev)}>
              {showArchivedConversations ? `Hide Archived (${archivedConversations.length})` : `Show Archived (${archivedConversations.length})`}
            </button>
            {showArchivedConversations && (
              <div className="dab-conv-archived-list" data-testid="archived-conversations-list">
                {archivedConversations.length === 0 ? <div className="dab-conv-empty">No archived conversations.</div> : archivedConversations.map((conv) => renderConversationRow(conv, true))}
              </div>
            )}
          </div>
        </div>
      )}

      <StudioModal
        open={Boolean(pendingDeleteConv && relatedInfo)}
        onClose={handleCancelDeleteConversation}
        testId="delete-conv-modal"
        title="Delete Conversation?"
        footer={
          <>
            <button type="button" className="dab-btn-secondary" data-testid="cancel-delete-conv-btn" onClick={handleCancelDeleteConversation}>Cancel</button>
            <button type="button" className="dab-btn-secondary" data-testid="confirm-delete-conv-only-btn" onClick={() => handleConfirmDeleteConversation(false)}>Delete Conversation Only</button>
            <button type="button" className="dab-btn-danger" data-testid="confirm-delete-conv-and-content-btn" onClick={() => handleConfirmDeleteConversation(true)}>Delete Conversation &amp; Related Content</button>
            <button type="button" className="dab-btn-primary" data-testid="confirm-delete-conv-btn" onClick={() => handleConfirmDeleteConversation()}>Confirm Delete</button>
          </>
        }
      >
        {pendingDeleteConv && relatedInfo && (
          <div className="dab-modal-body" style={{ padding: 0 }}>
            <p style={{ margin: '0 0 8px' }}>
              Remove <strong>{pendingDeleteConv.label}</strong> (<code>{pendingDeleteConv.type}</code>)
              from your conversation history (<code>user_conversations:{userId || '1'}</code>
              {relatedInfo.userIndexKeys[0] ? ` and ${relatedInfo.userIndexKeys[0]}` : ''})?
            </p>
            {relatedInfo.items.length > 0 && (
              <div className="dab-modal-related-box" data-testid="delete-conv-related-summary">
                <strong>Linked Looker &amp; Shared Artifact Content:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {relatedInfo.items.map((item, idx) => {
                    const matchedLink = relatedInfo.relatedLinks?.find((l) => l.itemText === item)
                    return (
                      <li key={idx}>
                        {matchedLink ? (
                          <a data-testid={`delete-modal-content-link-${idx}`} href={`${hostUrl}${matchedLink.path}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--dab-accent)', textDecoration: 'underline' }}>{item}</a>
                        ) : item}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <label className="dab-modal-checkbox-row">
              <input
                type="checkbox" data-testid="delete-related-content-checkbox"
                checked={deleteRelatedContent} onChange={(e) => setDeleteRelatedContent(e.target.checked)}
              />
              <span>Also delete related Looker content &amp; shared artifacts ({relatedInfo.summary})</span>
            </label>
          </div>
        )}
      </StudioModal>
    </nav>
  )
}

export { buildDynamicStarterPrompts, stripStarterPromptEmojis }
export type { StarterPromptItem }

export const STARTER_PROMPTS_BY_USE_CASE: Record<string, StarterPromptItem[]> = Object.fromEntries(
  (['auto', 'app', 'data-investigator', 'dashboard', 'conversational-analytics', 'health-check', 'lookml', 'tile'] as const).map(
    (uc) => [uc, buildDynamicStarterPrompts({ useCase: uc })]
  )
)
STARTER_PROMPTS_BY_USE_CASE.health = STARTER_PROMPTS_BY_USE_CASE['health-check']
STARTER_PROMPTS_BY_USE_CASE.investigator = STARTER_PROMPTS_BY_USE_CASE['data-investigator']
STARTER_PROMPTS_BY_USE_CASE.data_investigator = STARTER_PROMPTS_BY_USE_CASE['data-investigator']

export function getStarterPromptsForUseCase(
  useCase?: string, selectedExplores?: string[], permittedUseCases?: StudioUseCase[]
): StarterPromptItem[] {
  if ((selectedExplores && selectedExplores.length > 0) || (permittedUseCases && permittedUseCases.length > 0)) {
    return buildDynamicStarterPrompts({ useCase, selectedExplores, permittedUseCases })
  }
  const key = String(useCase || 'auto').trim().toLowerCase()
  return STARTER_PROMPTS_BY_USE_CASE[key] || STARTER_PROMPTS_BY_USE_CASE.auto
}

export const StarterPromptButtons: React.FC<{
  useCase?: string; prompts?: StarterPromptItem[]; loading?: boolean
  onSelect: (promptText: string) => void; disabled?: boolean
}> = ({ useCase, prompts, loading, onSelect, disabled }) => {
  const items = prompts && prompts.length > 0 ? prompts : getStarterPromptsForUseCase(useCase)
  if (loading && (!prompts || prompts.length === 0)) {
    return (
      <div className="dab-starter-prompts" data-testid="studio-starter-prompts-skeleton" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <StudioSkeleton key={i} width={188} height={28} style={{ borderRadius: 999 }} label="Loading starter prompt..." />
        ))}
      </div>
    )
  }
  return (
    <div className="dab-starter-prompts" data-testid="studio-starter-prompts">
      <div data-testid="starter-prompt-list" style={{ display: 'contents' }}>
        {items.map((item, i) => (
          <StudioButton
            key={item.id || `starter-${i}`} variant="secondary" testId={`starter-prompt-${i}`}
            data-prompt-id={item.id} data-use-case={item.useCase || useCase || 'auto'}
            className="dab-starter-chip" disabled={disabled} onClick={() => onSelect(item.prompt)} title={item.prompt}
          >
            {stripStarterPromptEmojis(item.label)}
          </StudioButton>
        ))}
      </div>
    </div>
  )
}

export const SandboxMarkdownPreviewModal: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeSandboxMarkdownModalPath, setActiveSandboxMarkdownModalPath,
    sandboxMarkdownCache = {}, sandboxMarkdownLoading = {},
    loadSandboxMarkdownFile, schemaMarkdown, extensionSDK,
  } = ctl
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered')
  const [copied, setCopied] = useState(false)

  useEffect(() => { setViewMode('rendered'); setCopied(false) }, [activeSandboxMarkdownModalPath])
  if (!activeSandboxMarkdownModalPath) return null

  const rawPath = activeSandboxMarkdownModalPath
  const normalizedPath = normalizeSandboxFilePath(rawPath)
  const displayPath = normalizedPath ? `/${normalizedPath}` : rawPath
  const fileName = normalizedPath.split('/').filter(Boolean).pop() || 'document.md'
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  const markdownContent =
    sandboxMarkdownCache[rawPath] ?? sandboxMarkdownCache[normalizedPath] ?? sandboxMarkdownCache[displayPath] ??
    resolveBuiltinWorkspaceFileContent(rawPath) ?? resolveBuiltinWorkspaceFileContent(normalizedPath) ??
    ((fileName === 'schema.md' || normalizedPath.endsWith('/schema.md')) && schemaMarkdown ? schemaMarkdown : '')

  const isLoading = Boolean(
    !markdownContent && (sandboxMarkdownLoading[rawPath] || sandboxMarkdownLoading[normalizedPath] || sandboxMarkdownLoading[displayPath])
  )

  const handleCopyMarkdown = () => {
    if (!markdownContent) return
    void copyTextWithExtensionSdk(markdownContent, extensionSDK).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    })
  }

  const handleDownloadMarkdown = () => {
    if (!markdownContent) return
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __LAST_DOWNLOADED_SANDBOX_MD__?: { fileName: string; path: string; content: string } }).__LAST_DOWNLOADED_SANDBOX_MD__ = {
        fileName, path: displayPath, content: markdownContent,
      }
    }
    try {
      const url = URL.createObjectURL(new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' }))
      Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
      URL.revokeObjectURL(url)
    } catch { /* ignore headless download errors */ }
  }

  return (
    <StudioModal
      open={Boolean(activeSandboxMarkdownModalPath)} onClose={() => setActiveSandboxMarkdownModalPath(null)}
      testId="sandbox-markdown-preview-modal" closeTestId="sandbox-markdown-modal-close" closeLabel="Close"
      className="dab-sandbox-md-modal" maxWidth={760}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{fileName}</span>
          <StudioBadge tone="accent" testId="sandbox-markdown-path-badge">{displayPath}</StudioBadge>
        </span>
      }
      subtitle="Loaded on demand from remote sandbox environment (never stored on Looker instance)"
      headerRight={
        <>
          <StudioButton variant="secondary" testId="sandbox-markdown-toggle-raw" onClick={() => setViewMode((m) => (m === 'rendered' ? 'raw' : 'rendered'))}>
            {viewMode === 'rendered' ? <Code2 size={12} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={12} strokeWidth={1.75} aria-hidden="true" />}
            <span>{viewMode === 'rendered' ? 'Raw Markdown' : 'Rendered'}</span>
          </StudioButton>
          <StudioButton variant="secondary" testId="sandbox-markdown-copy-btn" data-copied={copied ? 'true' : 'false'} onClick={handleCopyMarkdown} disabled={!markdownContent}>
            {copied ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Copy size={12} strokeWidth={1.75} aria-hidden="true" />}
            <span>{copied ? 'Copied Markdown' : 'Copy Markdown'}</span>
          </StudioButton>
          <StudioButton variant="gemini" testId="sandbox-markdown-download-btn" onClick={handleDownloadMarkdown} disabled={!markdownContent}>
            <FileText size={12} strokeWidth={1.75} aria-hidden="true" /><span>Download .md</span>
          </StudioButton>
        </>
      }
    >
      {isLoading ? (
        <div className="dab-sandbox-md-modal-loading" data-testid="sandbox-markdown-modal-loading">
          <StudioSkeleton width="100%" height={32} /><span className="dab-muted">Loading from sandbox...</span>
        </div>
      ) : viewMode === 'raw' ? (
        <pre className="dab-sandbox-md-raw" data-testid="sandbox-markdown-raw-body">{markdownContent}</pre>
      ) : (
        <div className="dab-sandbox-md-rendered" data-testid="sandbox-markdown-rendered-body">
          <StudioMarkdown
            text={markdownContent} hostUrl={hostUrl} extensionSDK={extensionSDK}
            onOpenSandboxMarkdownFile={(p) => void loadSandboxMarkdownFile(p, { openModal: true })}
          />
        </div>
      )}
    </StudioModal>
  )
}

export const AT_MENTION_DETECT_RE = /(?:^|\s)@(?:(explore|dashboard|look|conversation):([^\n@]*)|([^\s@]*))$/i
export const SLASH_SKILL_DETECT_RE = /(?:^|\s)\/([a-z0-9_-]*)$/i

export function renderMentionCategoryIcon(type: StudioContextCategory): React.ReactElement {
  if (type === 'explore') return <Database size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'dashboard') return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'look') return <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
  return <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
}
