import React from 'react'

import {
  Archive, ArchiveRestore, Loader2, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Trash2,
} from 'lucide-react'

import { cleanLookmlProjectId } from '../antigravity'
import { ConversationRecord, resolveConversationRelatedContent } from '../lookerApi'
import { StudioController } from '../useStudioController'
import { StudioBadge, StudioModal } from './StudioDesignSystem'

const SIDEBAR_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

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

export function formatRelativeSidebarTime(updatedAt?: string, nowMs = Date.now()): string {
  if (!updatedAt) return ''
  const ts = Date.parse(String(updatedAt))
  if (!Number.isFinite(ts)) return ''
  if (ts - nowMs > 60_000) {
    const fd = new Date(ts)
    return `${SIDEBAR_MONTHS[fd.getUTCMonth()]} ${fd.getUTCDate()}`
  }
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  const d = new Date(ts)
  const mon = SIDEBAR_MONTHS[d.getUTCMonth()]
  const day = d.getUTCDate()
  return diffDay < 365 ? `${mon} ${day}` : `${mon} ${day}, ${d.getUTCFullYear()}`
}

export const StudioConversationsSidebar: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    conversations, archivedConversations, showArchivedConversations, setShowArchivedConversations,
    pendingDeleteConv, deleteRelatedContent, setDeleteRelatedContent, activeConversationId,
    sidebarCollapsed, setSidebarCollapsed, handleSelectConversation, handleToggleArchiveConversation,
    handleRequestDeleteConversation, handleCancelDeleteConversation, handleConfirmDeleteConversation,
    handleNewConversation, runningConvIds = [], pendingPermConvIds = [], userId,
  } = ctl

  const renderConversationRow = (conv: ConversationRecord, isArchived = false) => {
    const contentBadge = formatConversationContentTag(conv)
    const relTime = formatRelativeSidebarTime(conv.updatedAt)
    const visibleTags = (conv.tags || []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 4)
    const isActive = activeConversationId === conv.id
    const isRunning = runningConvIds.includes(conv.id)
    const hasBgPerm = !isActive && pendingPermConvIds.includes(conv.id)
    return (
      <div
        key={conv.id} data-testid={`conversation-item-${conv.id}`}
        className={`dab-conv-item ${isActive ? 'active' : ''} ${isArchived ? 'archived' : ''}`}
        onClick={() => handleSelectConversation(conv)}
        title={`${conv.label} (${conv.type}${conv.interactionId ? ` · ${conv.interactionId}` : ''})`}
      >
        <div className="dab-conv-item-top">
          <span className="dab-conv-type-badge">{conv.type}</span>
          {isRunning && (
            <Loader2
              size={12}
              strokeWidth={2}
              className="dab-spin dab-conv-running-indicator"
              data-testid={`conv-running-indicator-${conv.id}`}
              aria-label="Turn running"
            />
          )}
          {hasBgPerm && <StudioBadge tone="warning" testId={`conv-perm-badge-${conv.id}`}>Approval</StudioBadge>}
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
        {(relTime || visibleTags.length > 0) && (
          <div className="dab-conv-item-meta">
            {relTime && (
              <span className="dab-conv-updated" data-testid={`conv-item-updated-${conv.id}`}>
                {relTime}
              </span>
            )}
            {visibleTags.length > 0 && (
              <div className="dab-conv-tags" data-testid={`conv-item-tags-${conv.id}`}>
                {visibleTags.map((tag) => (
                  <span key={tag} className="dab-conv-tag-pill" title={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
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
          onClick={() => handleNewConversation('auto')} title="Start a new conversation"
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
