import React, { useEffect, useState } from 'react'

import {
  AtSign, BookOpen, Check, Code2, Copy, Database, Eye, FileText,
  LayoutDashboard, Loader2, MessageSquare, Wrench,
} from 'lucide-react'

import {
  buildDynamicStarterPrompts, normalizeSandboxFilePath,
  resolveBuiltinWorkspaceFileContent, StarterPromptItem, stripStarterPromptEmojis,
} from '../antigravity'
import {
  copyTextWithExtensionSdk, StudioContextCategory, StudioContextMention,
} from '../lookerApi'
import { LookmlSkillCatalogEntry, STUDIO_SLASH_SKILLS } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import {
  DetectedMentionState, DetectedSlashSkillState, GroupedExploreGroup,
} from './StudioComposerTokens'
import {
  StudioBadge, StudioButton, StudioDocPreview, StudioModal, StudioSelect, StudioSkeleton,
} from './StudioDesignSystem'
import { StudioMarkdown } from './StudioMarkdown'

export {
  formatConversationContentTag, formatRelativeSidebarTime, StudioConversationsSidebar,
} from './StudioConversationsSidebar'

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

export const STUDIO_CAPABILITIES_MARKDOWN: string = [
  '# Open-Ended Looker Studio Workspace',
  'Every conversation is an open-ended chat — combine Key Driver Analysis, Data Apps, Native Dashboards, LookML modeling, Python Scripts, Alerts, and Audits across turns in a single thread.',
  '## Composer Shortcuts & Multi-Tab Viewer',
  '<LookmlTurnSkills />',
  '- **Slash Command Skills (`/`)**: Type `/` (e.g. `/looker-project-onboarding`, `/lookml-field-curation`, `/looker-dashboard`, `/key-driver-analysis`, `/data-apps`) to load domain playbooks on demand.',
  '- **Context Mentions (`@`)**: Type `@explore:`, `@dashboard:`, `@look:`, or `@conversation:` (or click `+`) to attach live Looker metadata, or paste/drop screenshots, CSVs, SQL, or PDFs.',
  '- **Overview & Multi-Tab Viewer**: Every created or referenced Dashboard, Data App, Look, Board, LookML project, Script, Alert, or Report stays switchable in the right-hand Viewer alongside the **Overview** explorer.',
  '## Interactive Data Apps & Root-Cause Narratives',
  '<DataInvestigatorPreview />',
  '- **Data Apps**: Build interactive Lit applications (`<app-kpi>`, `<app-chart>`, `<app-grid>`, metric switchers) published directly into Looker dashboard tiles.',
  '- **Data Investigator & KDA**: Investigate metric changes with `run_key_driver_analysis`, LookML `drill_fields` (`limit: 500`), fixed date ranges (`YYYY-MM-DD to YYYY-MM-DD`), and **Doc** or **Slides** narrative views.',
  '## Native Dashboards, Looks, Boards & Conversational Analytics',
  '<ReloadPreviewButton />',
  '<OpenInLookerButton />',
  '- Create and update 24-column UDDs, LookML Dashboards, Saved Looks, Boards, Scheduled Plans, or open embedded Looker Conversational Analytics threads.',
  '## Agentic LookML, Python Scripts, Alerts & Health Checks',
  '<PushLookmlButton />',
  '<PublishDashboardButton />',
  '<RunPythonButton />',
  '<ExportHealthTddButton />',
  '- Onboard LookML projects from database connections, author and validate `.lkml` views/explores/tests in dev mode, run & schedule Python tile scripts, inspect Looker Alerts, or generate 3-Pillar Looker & BigQuery Health Check TDDs.',
].join('\n')

// ponytail: lightweight Markdown + <ComponentName /> parser that wraps mapped React UI controls in a non-actionable preview container
export function renderCapabilitiesGuideMarkdown(markdown: string): React.ReactElement {
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
  return <div className="dab-tdd-rendered dab-capabilities-guide-markdown">{blocks}</div>
}

export const StudioCapabilitiesTrigger: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button
    type="button" data-testid="studio-capabilities-btn" className="dab-btn dab-btn-secondary dab-info-trigger"
    title="Studio capabilities & shortcuts guide" aria-label="Studio capabilities & shortcuts guide" onClick={onOpen}
  >
    ?
  </button>
)

export const StudioCapabilitiesModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <StudioModal
    open={open} onClose={onClose} testId="studio-capabilities-modal" closeTestId="studio-capabilities-close-btn"
    closeLabel="Close" className="dab-capabilities-modal" title="Studio Capabilities & Shortcuts"
    subtitle="Open-ended chat across Data Apps, Dashboards, LookML, Investigations, Scripts, Alerts & Audits"
  >
    <div className="dab-capabilities-guide-body" data-testid="studio-capabilities-mdx-body">
      {renderCapabilitiesGuideMarkdown(STUDIO_CAPABILITIES_MARKDOWN)}
    </div>
  </StudioModal>
)

export { buildDynamicStarterPrompts, stripStarterPromptEmojis }
export type { StarterPromptItem }

export const DEFAULT_STARTER_PROMPTS: StarterPromptItem[] = buildDynamicStarterPrompts()

export const StarterPromptButtons: React.FC<{
  prompts?: StarterPromptItem[]; loading?: boolean
  onSelect: (promptText: string) => void; disabled?: boolean
}> = ({ prompts, loading, onSelect, disabled }) => {
  const items = prompts && prompts.length > 0 ? prompts : DEFAULT_STARTER_PROMPTS
  if (loading && (!prompts || prompts.length === 0)) {
    return (
      <div className="dab-starter-prompts" data-testid="studio-starter-prompts-skeleton" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <StudioSkeleton key={i} width={188} height={28} style={{ borderRadius: 999 }} ariaLabel="Loading starter prompt..." />
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
            data-prompt-id={item.id}
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

export function renderMentionCategoryIcon(type: StudioContextCategory): React.ReactElement {
  if (type === 'explore') return <Database size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'dashboard') return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'look') return <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
  return <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
}

export const ComposerAutocompleteMenus: React.FC<{
  slashMenuRef: React.RefObject<HTMLDivElement | null>
  mentionMenuRef: React.RefObject<HTMLDivElement | null>
  detectedSlashSkill: DetectedSlashSkillState
  slashSkillOptions: readonly LookmlSkillCatalogEntry[]
  activatedLookmlSkills: readonly string[]
  activeSlashIndex: number
  setActiveSlashIndex: (idx: number) => void
  onSelectSlashSkill: (sk: LookmlSkillCatalogEntry) => void
  detectedMention: DetectedMentionState
  mentionLoading: boolean
  selectedExplores: readonly string[]
  mentionedItems: readonly StudioContextMention[]
  remoteSearchResults: readonly StudioContextMention[]
  groupedExplores: readonly GroupedExploreGroup[]
  mentionOptions: readonly StudioContextMention[]
  activeMentionIndex: number
  setActiveMentionIndex: (idx: number) => void
  onSelectMentionOption: (item: StudioContextMention) => void
  onClearExplores: () => void
}> = ({
  slashMenuRef, mentionMenuRef, detectedSlashSkill, slashSkillOptions, activatedLookmlSkills,
  activeSlashIndex, setActiveSlashIndex, onSelectSlashSkill, detectedMention, mentionLoading,
  selectedExplores, mentionedItems, remoteSearchResults, groupedExplores, mentionOptions,
  activeMentionIndex, setActiveMentionIndex, onSelectMentionOption, onClearExplores,
}) => (
  <>
    {detectedSlashSkill.open && (
      <div ref={slashMenuRef} className="dab-at-mention-menu dab-dropdown" data-testid="composer-slash-skill-menu" role="listbox" aria-label="Studio slash skills">
        <div className="dab-at-mention-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Wrench size={12} strokeWidth={1.75} aria-hidden="true" /><span>Skills (/{detectedSlashSkill.query})</span>
          </span>
        </div>
        {slashSkillOptions.length === 0 ? (
          <div className="dab-option dab-muted">No matching skills</div>
        ) : (
          slashSkillOptions.map((sk, idx) => {
            const isSelected = activatedLookmlSkills.includes(sk.id)
            const isHighlighted = idx === activeSlashIndex
            return (
              <div
                key={sk.id} role="option" aria-selected={isSelected || isHighlighted} data-testid={`composer-slash-skill-option-${sk.id}`}
                className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`} style={{ gap: 8 }}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveSlashIndex(idx)}
                onClick={(e) => { e.stopPropagation(); onSelectSlashSkill(sk) }} title={`${sk.desc} (${sk.path})`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                  <BookOpen size={13} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
                  <code style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>/{sk.id}</code>
                  <span className="dab-muted dab-studio-menu-text" style={{ fontSize: 12 }}>{sk.desc}</span>
                </span>
                {isSelected && <Check size={13} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />}
              </div>
            )
          })
        )}
      </div>
    )}

    {detectedMention.open && (
      <div ref={mentionMenuRef} className="dab-at-mention-menu dab-dropdown" data-testid="composer-at-mention-menu" role="listbox" aria-label="Looker context mentions">
        <div className="dab-at-mention-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <AtSign size={12} strokeWidth={1.75} aria-hidden="true" />
            <span>
              {detectedMention.category === 'all'
                ? 'Mention Looker Context (@explore:, @dashboard:, @look:, @conversation:)'
                : `Mention ${detectedMention.category} (@${detectedMention.category}:${detectedMention.query})`}
            </span>
          </span>
          {mentionLoading && (
            <span data-testid="composer-mention-loading" className="dab-at-mention-spinner" title="Searching Looker via global_search_v2...">
              <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
            </span>
          )}
        </div>

        {selectedExplores.length > 0 && (detectedMention.category === 'all' || detectedMention.category === 'explore') && (
          <div
            className="dab-option" style={{ color: 'var(--dab-accent)', fontWeight: 600 }}
            onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onClearExplores() }}
          >
            <span>Clear selection (let agent decide)</span>
          </div>
        )}

        {detectedMention.category === 'explore' && !remoteSearchResults.length ? (
          groupedExplores.length === 0 ? (
            <div className="dab-option dab-muted">No matching explores</div>
          ) : (
            groupedExplores.map((group) => (
              <div key={group.modelName}>
                <div className="dab-group-header">{group.label}</div>
                {group.options.map((opt) => {
                  const isSelected = selectedExplores.includes(opt.value)
                  const flatIdx = mentionOptions.findIndex((m) => m.type === 'explore' && m.id === opt.value)
                  const isHighlighted = flatIdx === activeMentionIndex
                  return (
                    <div
                      key={opt.value} role="option" aria-selected={isSelected || isHighlighted}
                      data-testid={`composer-mention-option-explore-${opt.value}`}
                      className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => { if (flatIdx >= 0) setActiveMentionIndex(flatIdx) }}
                      onClick={(e) => { e.stopPropagation(); onSelectMentionOption(opt.mention) }} title={opt.value}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Database size={13} strokeWidth={1.75} aria-hidden="true" /><span>{opt.label}</span>
                      </span>
                      {isSelected && <Check size={13} strokeWidth={2} aria-hidden="true" />}
                    </div>
                  )
                })}
              </div>
            ))
          )
        ) : mentionOptions.length === 0 ? (
          <div className="dab-option dab-muted">{mentionLoading ? 'Searching Looker...' : 'No matching Looker items'}</div>
        ) : (
          mentionOptions.map((item, idx) => {
            const isSelected = (item.type === 'explore' && selectedExplores.includes(item.id)) || mentionedItems.some((m) => m.type === item.type && m.id === item.id)
            const isHighlighted = idx === activeMentionIndex
            return (
              <div
                key={`${item.type}:${item.id}`} role="option" aria-selected={isSelected || isHighlighted}
                data-testid={`composer-mention-option-${item.type}-${item.id}`}
                className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveMentionIndex(idx)}
                onClick={(e) => { e.stopPropagation(); onSelectMentionOption(item) }} title={`${item.type}: ${item.title} (${item.id})`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                  {renderMentionCategoryIcon(item.type)}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                  {item.subtitle && <span className="dab-muted" style={{ fontSize: 11 }}>· {item.subtitle}</span>}
                </span>
                <span className="dab-muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>
                  {isSelected ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : item.type}
                </span>
              </div>
            )
          })
        )}
      </div>
    )}
  </>
)
