import React, { useEffect, useMemo, useRef, useState } from 'react'

import { ChattyHostBuilderFactory, getEmbedSDK, ILookerConnection, LookerEmbedExSDK, PageChangedEvent } from '@looker/embed-sdk'
import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import {
  AlertTriangle, Archive, ArchiveRestore, AtSign, BookOpen, Brain, Bug, Check, ChevronDown, Code2, Copy,
  CornerDownRight, Database, ExternalLink, Eye, FileText, Folder, Kanban, LayoutDashboard, Loader2,
  MessageSquare, MoreVertical, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, RotateCw, Shield,
  Sparkles, Square, Terminal, Trash2, Wrench, X, Zap,
} from 'lucide-react'

import {
  AntigravityActivityStep, buildDynamicStarterPrompts, fetchConversationSandboxDebugMarkdown,
  formatConversationThreadMarkdown, formatThinkingTraceMarkdown,
  handleFileInputSelection, handleImageClipboardPaste, MAX_LEFT_PANE_WIDTH,
  MIN_LEFT_PANE_WIDTH, normalizeSandboxFilePath, resolveBuiltinWorkspaceFileContent,
  StarterPromptItem, stripStarterPromptEmojis, STUDIO_THINKING_LEVEL_OPTIONS,
  StudioThinkingLevel, StudioUseCase,
} from '../antigravity'
import { HealthCheckReportPayload, renderTddMarkdownToHtml } from '../healthCheck'
import {
  CaConversationState, ConversationRecord, copyTextWithExtensionSdk, discoverAccessibleConnections, formatAccessibleConnectionsMarkdown,
  formatExploreId, LkrCodeModeApiCallEntry, NativeContentState, normalizeCaEmbedPath, normalizeStudioAgentName, PublishedAppState,
  resolveConversationRelatedContent, STUDIO_OVERVIEW_TAB_KEY, StudioContentItem, StudioContentItemType,
  StudioContextCategory, StudioContextMention,
} from '../lookerApi'
import { extractSlashSkillIds, LookmlBundle, LookmlPreviewPane, LookmlSkillCatalogEntry, STUDIO_SLASH_SKILLS } from '../lookmlTool'
export { copyTextWithExtensionSdk, fetchConversationSandboxDebugMarkdown, formatConversationThreadMarkdown }
import { StudioController } from '../useStudioController'
import { ChatMessage } from './App'
import { TilePreviewPane } from './ScriptStudioView'
import {
  StudioBadge, StudioBadgeTone, StudioButton, StudioDocPreview, StudioModal,
  StudioSelect, StudioSkeleton, StudioToolbar,
} from './StudioDesignSystem'

export const ALLOWED_EXTERNAL_WINDOW_PATTERNS: ReadonlyArray<string> = [
  'https://*.looker.com/*', 'https://*.looker.app/*', 'https://*.google.com/*',
  'https://cloud.google.com/*', 'https://docs.cloud.google.com/*', 'https://github.com/*',
]

export function isAllowedExternalWindowUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || '').trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    return ['looker.com', 'looker.app', 'google.com', 'cloud.google.com', 'docs.cloud.google.com', 'github.com'].some(
      (d) => host === d || host.endsWith(`.${d}`)
    )
  } catch {
    return false
  }
}

export const copyLinkWithExtensionSdk = (url: string, extensionSDK?: Partial<ExtensionSDK> | null): Promise<boolean> =>
  copyTextWithExtensionSdk(String(url || '').trim(), extensionSDK)

export function normalizeLookerProjectRootUrl(rawUrl: string): string {
  return String(rawUrl || '')
    .trim()
    .replace(/^((?:https?:\/\/[^/?#]+)?\/projects\/[^/?#]+)\/files\/?([?#].*)?$/i, '$1$2')
}

export interface InViewerLookerLinkTarget {
  id: string
  contentType: StudioContentItemType
  title?: string
  embedPath: string
  externalPath: string
}

export function parseInViewerLookerLink(rawUrl: string, label?: string, hostUrl?: string): InViewerLookerLinkTarget | null {
  const clean = String(rawUrl || '').trim()
  let local = clean.startsWith('/') && !clean.startsWith('//') ? clean : ''
  if (!local && /^https?:\/\//i.test(clean) && hostUrl) {
    try {
      const u = new URL(clean)
      if (u.origin.toLowerCase() === new URL(hostUrl).origin.toLowerCase()) local = `${u.pathname || '/'}${u.search || ''}`
    } catch { /* ignore */ }
  }
  const qIdx = local.search(/[?#]/)
  const pathname = qIdx >= 0 ? local.slice(0, qIdx) : local
  const search = qIdx >= 0 ? local.slice(qIdx).split('#')[0] : ''
  const m = pathname.match(/^(?:\/embed)?\/(dashboards|looks|boards|explore)\/([^/?#\s]+)(?:\/([^/?#\s]+))?\/?$/i)
  if (!m || (m[1].toLowerCase() === 'explore') !== Boolean(m[3])) return null
  const dec = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const kind = m[1].toLowerCase()
  const p1 = dec(m[2])
  const p2 = m[3] ? dec(m[3]) : ''
  const id = kind === 'explore' ? `${p1}::${p2}` : p1
  const encPath = kind === 'explore' ? `explore/${encodeURIComponent(p1)}/${encodeURIComponent(p2)}` : `${kind}/${encodeURIComponent(p1).replace(/%3A%3A/gi, '::')}`
  const contentType: StudioContentItemType = kind === 'explore' ? 'explore' : kind === 'looks' ? 'look' : kind === 'boards' ? 'board' : id.includes('::') ? 'lookml_dashboard' : 'dashboard'
  const rawLbl = String(label || '').trim()
  const title = rawLbl && !/^(?:https?:|\/)/i.test(rawLbl) ? rawLbl.replace(/^open\s+/i, '').replace(/\s+in\s+looker.*$/i, '').replace(/\s*↗\s*$/, '').trim() : undefined
  return { id, contentType, title, embedPath: `/embed/${encPath}${search}`, externalPath: `/${encPath}${search}` }
}

export function openOrCopyMarkdownLink(
  url: string, hostUrl?: string, extensionSDK?: Partial<ExtensionSDK> | null
): Promise<{ action: 'opened' | 'copied'; targetUrl: string }> {
  const clean = normalizeLookerProjectRootUrl(url)
  if (!clean) return Promise.resolve({ action: 'copied', targetUrl: '' })
  let hostOrigin = ''
  if (hostUrl) {
    try { hostOrigin = new URL(hostUrl).origin.toLowerCase() } catch { hostOrigin = '' }
  }
  let targetToOpen: string | null = null
  if (clean.startsWith('/') && !clean.startsWith('//')) {
    targetToOpen = clean
  } else {
    try {
      const parsed = new URL(clean)
      if (hostOrigin && parsed.origin.toLowerCase() === hostOrigin) {
        targetToOpen = normalizeLookerProjectRootUrl(`${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`)
      } else if (isAllowedExternalWindowUrl(parsed.href)) {
        targetToOpen = parsed.href
      }
    } catch { /* non-URL falls back to clipboard */ }
  }
  if (targetToOpen && typeof extensionSDK?.openBrowserWindow === 'function') {
    try {
      extensionSDK.openBrowserWindow(targetToOpen, '_blank')
      return Promise.resolve({ action: 'opened', targetUrl: targetToOpen })
    } catch { /* fall back to clipboard */ }
  }
  return copyLinkWithExtensionSdk(clean, extensionSDK).then(() => ({ action: 'copied' as const, targetUrl: clean }))
}

export function fetchAvailableLookerConnectionsMarkdown(core40SDK?: Partial<Looker40SDK> | null): Promise<string> {
  if (!core40SDK) return Promise.resolve('### Available Looker Connections\n- No Looker SDK session available.')
  return discoverAccessibleConnections(core40SDK).then(formatAccessibleConnectionsMarkdown)
}

const StudioMarkdownLink: React.FC<{
  label: string
  href: string
  hostUrl?: string
  extensionSDK?: Partial<ExtensionSDK> | null
  onInspectConnections?: () => void
  onOpenContentInViewer?: (target: InViewerLookerLinkTarget) => void
}> = ({ label, href, hostUrl, extensionSDK, onInspectConnections, onOpenContentInViewer }) => {
  const [copied, setCopied] = useState(false)
  const markCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  const normalizedHref = normalizeLookerProjectRootUrl(href)
  const isAdminConnectionsLink = /(?:^|\/)admin\/connections(?:[/?#]|$)/i.test(normalizedHref)
  const inViewerTarget = parseInViewerLookerLink(normalizedHref, label, hostUrl)
  return (
    <span className="dab-md-link-group">
      <a
        href={normalizedHref} data-testid="chat-markdown-link" className="dab-md-link" target="_blank" rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation()
          if (isAdminConnectionsLink && onInspectConnections) { onInspectConnections(); return }
          if (inViewerTarget && onOpenContentInViewer) { onOpenContentInViewer(inViewerTarget); return }
          void openOrCopyMarkdownLink(normalizedHref, hostUrl, extensionSDK).then((res) => { if (res.action === 'copied') markCopied() })
        }}
      >
        {label}
      </a>
      {inViewerTarget && (
        <button
          type="button"
          data-testid="markdown-link-external-btn"
          className="dab-md-link-copy-btn"
          title={`Open in Looker (${inViewerTarget.externalPath})`}
          aria-label={`Open ${label} in Looker`}
          onClick={(e) => {
            e.preventDefault(); e.stopPropagation()
            void openOrCopyMarkdownLink(inViewerTarget.externalPath, hostUrl, extensionSDK)
          }}
        >
          <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <button
        type="button" data-testid="chat-markdown-link-copy" data-copied={copied ? 'true' : 'false'}
        className="dab-md-link-copy-btn" title={copied ? 'Copied URL to clipboard' : `Copy link (${normalizedHref})`}
        aria-label={copied ? 'Copied link' : `Copy link ${label}`}
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation()
          void copyLinkWithExtensionSdk(normalizedHref, extensionSDK).then(() => markCopied())
        }}
      >
        {copied ? (<><Check size={11} strokeWidth={2} aria-hidden="true" /><span>Copied!</span></>) : <Copy size={11} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </span>
  )
}

export function isSandboxMarkdownPath(raw: string): boolean {
  const trimmed = String(raw || '').trim()
  if (!trimmed || /\s/.test(trimmed) || /^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(trimmed)) return false
  return /^(?:file:\/\/)?(?:\/workspace\/|[a-zA-Z0-9_./-]*\/)?[a-zA-Z0-9_.-]+\.md$/i.test(trimmed.split(/[?#]/)[0] || '')
}

const LATEX_OPS: Record<string, string> = {
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  times: '×', ge: '>=', geq: '>=', le: '<=', leq: '<=', approx: '≈',
}
const LATEX_INLINE_OP_RE = /\\(rightarrow|to|leftarrow|leftrightarrow|times|geq?|leq?|approx)\b/g

function normalizeInlineMarkdownArtifacts(input: string): string {
  return String(input ?? '')
    .replace(/\[([^\][]+)\]\(\s*([^)]+?)\s*\)/g, (_m, lbl: string, url: string) => `[${lbl.replace(/\s*\n\s*/g, ' ').trim()}](${url.replace(/\s+/g, '')})`)
    .replace(/\*\*([^*]+?)\*\*/g, (m, inner: string) => (inner.includes('\n') && !inner.includes('\n\n') && !/\n\s*(?:[-*]|\d+\.|#{1,4})\s/.test(inner) ? `**${inner.replace(/\s*\n\s*/g, ' ').trim()}**` : m))
    .split(/(`[^`\n]+`)/g)
    .map((part, idx) =>
      idx % 2 === 1
        ? part
        : part.replace(/\$([^$\n]{1,120})\$/g, (m, inner: string) =>
            inner.includes('\\') && /\\(?:rightarrow|to|leftarrow|leftrightarrow|times|geq?|leq?|approx)\b/.test(inner)
              ? inner.replace(LATEX_INLINE_OP_RE, (_op, k: string) => LATEX_OPS[k] || '').trim()
              : m
          )
    )
    .join('')
}

function renderInlineMarkdown(
  rawText: string,
  hostUrl?: string,
  extensionSDK?: Partial<ExtensionSDK> | null,
  onOpenSandboxMarkdownFile?: (path: string) => void,
  onInspectConnections?: () => void,
  onOpenContentInViewer?: (target: InViewerLookerLinkTarget) => void
): React.ReactNode[] {
  const cleanedText = normalizeInlineMarkdownArtifacts(rawText)
  const tokenRegex = /`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<)"']+)/g
  const nodes: React.ReactNode[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null
  let keyCounter = 0
  const renderMdTrigger = (rawPath: string, child: React.ReactNode) => {
    const mdPath = rawPath.split(/[?#]/)[0] || rawPath
    return (
      <button
        key={`md_trig_${keyCounter++}`} type="button" data-testid="sandbox-markdown-file-trigger"
        data-md-path={mdPath} className="dab-sandbox-md-trigger" title={`Click to load ${mdPath} from sandbox`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenSandboxMarkdownFile?.(mdPath) }}
      >
        <FileText size={11} strokeWidth={1.75} aria-hidden="true" />{child}
      </button>
    )
  }
  while ((match = tokenRegex.exec(cleanedText)) !== null) {
    if (match.index > lastIdx) nodes.push(cleanedText.slice(lastIdx, match.index))
    if (match[1] !== undefined) {
      const codeToken = match[1].trim()
      nodes.push(isSandboxMarkdownPath(codeToken) ? renderMdTrigger(codeToken, <code>{match[1]}</code>) : <code key={`code_${keyCounter++}`} className="dab-md-inline-code">{match[1]}</code>)
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const linkHref = match[3].trim()
      nodes.push(isSandboxMarkdownPath(linkHref) ? renderMdTrigger(linkHref, <span>{match[2]}</span>) : <StudioMarkdownLink key={`link_${keyCounter++}`} label={match[2]} href={linkHref} hostUrl={hostUrl} extensionSDK={extensionSDK} onInspectConnections={onInspectConnections} onOpenContentInViewer={onOpenContentInViewer} />)
    } else if (match[4] !== undefined) {
      nodes.push(<strong key={`bold_${keyCounter++}`}>{renderInlineMarkdown(match[4], hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections, onOpenContentInViewer)}</strong>)
    } else if (match[5] !== undefined) {
      const bareUrl = match[5].replace(/[.,;:!?]+$/, '')
      const trailing = match[5].slice(bareUrl.length)
      nodes.push(<StudioMarkdownLink key={`bare_${keyCounter++}`} label={bareUrl} href={bareUrl} hostUrl={hostUrl} extensionSDK={extensionSDK} onInspectConnections={onInspectConnections} onOpenContentInViewer={onOpenContentInViewer} />)
      if (trailing) nodes.push(trailing)
    }
    lastIdx = tokenRegex.lastIndex
  }
  if (lastIdx < cleanedText.length) nodes.push(cleanedText.slice(lastIdx))
  return nodes.length > 0 ? nodes : [cleanedText]
}

function splitGfmTableRow(rawLine: string): string[] {
  let s = rawLine.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let inCode = false
  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx]
    if (ch === '`' && s[idx - 1] !== '\\') { inCode = !inCode; cur += ch; continue }
    if (ch === '\\' && s[idx + 1] === '|' && !inCode) { cur += '|'; idx++; continue }
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function isGfmTableDelimiterRow(rawLine: string): boolean {
  const trimmed = rawLine.trim()
  if (!trimmed.includes('|')) return false
  const cells = splitGfmTableRow(trimmed)
  return cells.length >= 1 && cells.every((c) => /^:?-{3,}:?$/.test(c))
}

function isGfmTableStart(lines: string[], idx: number): boolean {
  return idx + 1 < lines.length && lines[idx].includes('|') && isGfmTableDelimiterRow(lines[idx + 1])
}

const MD_HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/

export const StudioMarkdown: React.FC<{
  text: string
  hostUrl?: string
  extensionSDK?: Partial<ExtensionSDK> | null
  onOpenSandboxMarkdownFile?: (path: string) => void
  onInspectConnections?: () => void
  onOpenContentInViewer?: (target: InViewerLookerLinkTarget) => void
}> = ({ text, hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections, onOpenContentInViewer }) => {
  const raw = String(text ?? '')
  const inline = (s: string) =>
    renderInlineMarkdown(s, hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections, onOpenContentInViewer)
  const segments = raw.split(/(```[\s\S]*?```)/g)
  const blocks: React.ReactNode[] = []
  let blockKey = 0
  for (const segment of segments) {
    if (!segment) continue
    if (segment.startsWith('```') && segment.endsWith('```')) {
      const inner = segment.slice(3, -3)
      const firstNewline = inner.indexOf('\n')
      const codeBody = firstNewline >= 0 && /^[a-zA-Z0-9_-]*$/.test(inner.slice(0, firstNewline).trim()) ? inner.slice(firstNewline + 1) : inner
      blocks.push(<pre key={`pre_${blockKey++}`} className="dab-md-pre"><code className="dab-md-code-block">{codeBody.replace(/^\n+|\n+$/g, '')}</code></pre>)
      continue
    }
    const lines = normalizeInlineMarkdownArtifacts(segment).split('\n')
    let i = 0
    while (i < lines.length) {
      const trimmed = lines[i].trim()
      if (!trimmed) { i++; continue }
      if (MD_HR_RE.test(trimmed)) {
        blocks.push(<hr key={`hr_${blockKey++}`} className="dab-md-hr" />)
        i++; continue
      }
      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/)
      if (headingMatch) {
        const level = headingMatch[1].length
        const HeadingTag = (`h${level}` as unknown) as 'h1' | 'h2' | 'h3' | 'h4'
        blocks.push(<HeadingTag key={`h_${blockKey++}`} className={`dab-md-heading dab-md-h${level}`}>{inline(headingMatch[2])}</HeadingTag>)
        i++; continue
      }
      if (isGfmTableStart(lines, i)) {
        const headers = splitGfmTableRow(lines[i])
        const alignments = splitGfmTableRow(lines[i + 1]).map((c): 'left' | 'center' | 'right' | undefined =>
          c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : undefined
        )
        i += 2
        const rows: string[][] = []
        while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !MD_HR_RE.test(lines[i].trim()) && !/^(#{1,4})\s+/.test(lines[i].trim())) {
          rows.push(splitGfmTableRow(lines[i])); i++
        }
        blocks.push(
          <div key={`tbl_${blockKey++}`} className="dab-py-table-wrap">
            <table className="dab-py-table" data-testid="chat-markdown-table">
              <thead>
                <tr>
                  {headers.map((h, cIdx) => (
                    <th key={`th_${cIdx}`} style={alignments[cIdx] ? { textAlign: alignments[cIdx] } : undefined}>
                      {inline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={`tr_${rIdx}`}>
                    {headers.map((_h, cIdx) => (
                      <td key={`td_${cIdx}`} style={alignments[cIdx] ? { textAlign: alignments[cIdx] } : undefined}>
                        {inline(row[cIdx] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        continue
      }
      const isUl = /^[-*]\s+/.test(trimmed)
      const olMatch = !isUl ? trimmed.match(/^(\d+)\.\s+/) : null
      if (isUl || olMatch) {
        const firstNum = olMatch ? Number(olMatch[1]) : 1
        const markerRe = isUl ? /^[-*]\s+/ : /^\d+\.\s+/
        const items: React.ReactNode[] = []
        while (i < lines.length && markerRe.test(lines[i].trim())) {
          const itemLines = [lines[i].trim().replace(markerRe, '')]
          i++
          while (i < lines.length && lines[i].trim() && !/^(?:#{1,4}\s+|[-*]\s+|\d+\.\s+|```|>\s?|\||(?:-{3,}|\*{3,}|_{3,})$)/.test(lines[i].trim()) && !isGfmTableStart(lines, i)) {
            itemLines.push(lines[i].trim()); i++
          }
          items.push(<li key={`li_${items.length}`}>{inline(itemLines.join(' '))}</li>)
        }
        blocks.push(
          isUl
            ? <ul key={`list_${blockKey++}`} className="dab-md-list">{items}</ul>
            : <ol key={`list_${blockKey++}`} className="dab-md-list" start={firstNum}>{items}</ol>
        )
        continue
      }
      const paraLines: string[] = []
      while (
        i < lines.length && lines[i].trim() &&
        !/^(#{1,4})\s+/.test(lines[i].trim()) && !/^[-*]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim()) && !MD_HR_RE.test(lines[i].trim()) && !isGfmTableStart(lines, i)
      ) {
        paraLines.push(lines[i]); i++
      }
      blocks.push(<p key={`p_${blockKey++}`} className="dab-md-p">{inline(paraLines.join('\n'))}</p>)
    }
  }
  return <div className="dab-markdown" data-testid="studio-markdown-body">{blocks.length > 0 ? blocks : raw}</div>
}

export interface LookerEmbedTarget {
  kind: 'preload' | 'dashboard' | 'look' | 'explore' | 'extension' | 'report' | 'url'
  target: string
  previewMode: 'preload' | 'conversational-analytics' | 'dashboard' | 'data_app'
  previewObjectId: string
  nonce: number
}

export interface LookerEmbedSessionTelemetry {
  hostUrl: string
  state: 'preloaded' | 'dashboard' | 'look' | 'explore' | 'extension' | 'report' | 'url'
  target: string
  running: boolean
  runCount: number
  loadCount: number
  lastPageUrl: string
  events: string[]
  calls: Array<{ method: string; arg: string }>
}

export function normalizeLookerEmbedUrl(rawUrl: string, hostUrl?: string): string {
  let clean = (rawUrl || '').trim()
  if (!clean) return '/preload'
  if (hostUrl) {
    const base = hostUrl.replace(/\/$/, '')
    if (base && clean.startsWith(base)) clean = clean.slice(base.length) || '/'
  }
  clean = clean.replace(/^https?:\/\/[^/]+/i, '')
  if (!clean.startsWith('/')) clean = `/${clean}`
  if (/^\/(?:embed\/)?(?:conversations|agents)\//.test(clean)) return normalizeCaEmbedPath(clean)
  if (clean === '/preload' || clean.startsWith('/preload?') || clean.startsWith('/embed/')) return clean
  return `/embed${clean}`
}

export function resolveLookerEmbedTarget(opts: {
  isEmptyConversation?: boolean; isHealthCheckMode?: boolean; isLookmlMode?: boolean; isTileMode?: boolean; isCaMode?: boolean
  builderMode?: 'data_app' | 'dashboard'; activeContentItem?: StudioContentItem | null
  caConversation?: { caConversationId: string; embedPath: string } | null
  nativeContent?: { id: string; contentType: string; embedPath: string; dashboardId?: string; lookId?: string; lookmlDashboardId?: string } | null
  publishedApp?: { dashboardId: string } | null; hostUrl?: string; nonce?: number
}): LookerEmbedTarget {
  const nonce = opts.nonce || 0
  const preload: LookerEmbedTarget = { kind: 'preload', target: '/preload', previewMode: 'preload', previewObjectId: '', nonce }
  if (opts.isEmptyConversation || opts.isHealthCheckMode || opts.isLookmlMode || opts.isTileMode) return preload

  const item =
    opts.activeContentItem?.id && opts.activeContentItem?.contentType
      ? opts.activeContentItem
      : opts.builderMode === 'dashboard' && opts.nativeContent
      ? (opts.nativeContent as Partial<StudioContentItem> & { id: string; contentType: string })
      : null
  if (item) {
    const ct = item.contentType
    if (ct === 'lookml' || ct === 'script') return preload
    if (ct === 'dashboard' || ct === 'lookml_dashboard') {
      const id = String(item.lookmlDashboardId || item.dashboardId || item.id)
      return { kind: 'dashboard', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    if (ct === 'data_app' || ct === 'data-investigator') {
      const id = String(item.dashboardId || item.id)
      return { kind: 'dashboard', target: id, previewMode: 'data_app', previewObjectId: id, nonce }
    }
    if (ct === 'look') {
      const id = String(item.lookId || item.id)
      return { kind: 'look', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    if (ct === 'explore') {
      const rawId = String(item.exploreId || item.id)
      return { kind: 'explore', target: rawId.replace('::', '/'), previewMode: 'dashboard', previewObjectId: rawId, nonce }
    }
    if (ct === 'extension') {
      const id = String(item.extensionId || item.id)
      return { kind: 'extension', target: id, previewMode: 'data_app', previewObjectId: id, nonce }
    }
    if (ct === 'report') {
      const id = String(item.id)
      return { kind: 'report', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    const isCa = ct === 'conversational-analytics'
    const id = String(item.lookmlDashboardId || item.id)
    const rawUrl = item.embedPath || `/embed/${isCa ? 'conversations' : 'boards'}/${encodeURIComponent(id)}`
    return {
      kind: 'url',
      target: normalizeLookerEmbedUrl(rawUrl, opts.hostUrl),
      previewMode: isCa ? 'conversational-analytics' : 'dashboard',
      previewObjectId: id,
      nonce,
    }
  }

  if ((opts.isCaMode || opts.caConversation) && opts.caConversation?.embedPath) {
    return {
      kind: 'url',
      target: normalizeLookerEmbedUrl(opts.caConversation.embedPath, opts.hostUrl),
      previewMode: 'conversational-analytics',
      previewObjectId: opts.caConversation.caConversationId,
      nonce,
    }
  }
  if (opts.builderMode === 'dashboard') return preload
  if (opts.publishedApp?.dashboardId) {
    const id = String(opts.publishedApp.dashboardId)
    return { kind: 'dashboard', target: id, previewMode: 'data_app', previewObjectId: id, nonce }
  }
  return preload
}

export function createLookerEmbedPreloadController(opts: {
  hostUrl: string
  container: HTMLElement
  mockPreviewHtml?: (mode: string, objectId: string) => string | undefined
}) {
  const telemetry: LookerEmbedSessionTelemetry = {
    hostUrl: opts.hostUrl, state: 'preloaded', target: '/preload', running: false,
    runCount: 0, loadCount: 0, lastPageUrl: '/embed/preload', events: [], calls: [],
  }
  let activePreviewMeta = { mode: 'preload', objectId: '' }

  const notify = () => {
    opts.container?.setAttribute?.('data-embed-state', telemetry.state)
    opts.container?.setAttribute?.('data-embed-target', telemetry.target)
    opts.container?.setAttribute?.('data-embed-running', String(telemetry.running))
    opts.container?.setAttribute?.('data-embed-run-count', String(telemetry.runCount))
    if (typeof window !== 'undefined') {
      window.__LOOKER_EMBED_STATE__ = { ...telemetry, events: [...telemetry.events], calls: [...telemetry.calls] }
    }
  }

  if (typeof window === 'undefined') {
    ;(globalThis as Record<string, unknown>).window = {
      location: { origin: opts.hostUrl || 'https://looker.example.com' },
      setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {},
    }
  }

  const chattyHostCreator = (initialUrl: string) => {
    const handlers: Record<string, Array<(payload?: Record<string, unknown>) => void>> = {}
    let targetEl: HTMLElement | null = opts.container
    const emit = (evt: string, payload: Record<string, unknown> = {}) => (handlers[evt] || []).forEach((fn) => fn(payload))
    const noop = () => builder
    const builder = {
      on: (evt: string, fn: (payload?: Record<string, unknown>) => void) => {
        ;(handlers[evt] = handlers[evt] || []).push(fn)
        return builder
      },
      frameBorder: noop, withTargetOrigin: noop, withAriaLabel: noop, withAllowAttribute: noop,
      withClassName: noop, withFrameAttribute: noop, withSandboxAttribute: noop,
      appendTo: (el: HTMLElement) => { targetEl = el; return builder },
      build: () => {
        const doc = targetEl?.ownerDocument || (typeof document !== 'undefined' ? document : null)
        const iframe: Partial<HTMLIFrameElement> & {
          setAttribute?: (k: string, v: string) => void; removeAttribute?: (k: string) => void
          getAttribute?: (k: string) => string | null; classList?: { add: (c: string) => void }
        } =
          targetEl?.querySelector?.('iframe') ||
          (doc ? doc.createElement('iframe') : {
            setAttribute: () => {}, removeAttribute: () => {}, getAttribute: () => '',
            classList: { add: () => {} }, style: {} as CSSStyleDeclaration, className: '', src: '', srcdoc: '',
          })
        if (!iframe.classList) iframe.classList = { add: () => {} }
        iframe.title = 'Looker Live Viewer'
        const syncIframe = (rawUrl: string) => {
          if (rawUrl.includes('/preload')) {
            iframe.srcdoc = '<!doctype html><html><body data-preload="true" style="margin:0"></body></html>'
            iframe.removeAttribute?.('data-testid')
          } else {
            const html = opts.mockPreviewHtml?.(activePreviewMeta.mode, activePreviewMeta.objectId)
            if (html) iframe.srcdoc = html
            if (activePreviewMeta.mode === 'conversational-analytics') iframe.setAttribute?.('data-testid', 'ca-embed-iframe')
            else iframe.removeAttribute?.('data-testid')
          }
          iframe.setAttribute?.('data-embed-src', rawUrl)
          iframe.setAttribute?.('src', rawUrl)
        }
        syncIframe(initialUrl)
        if (doc && targetEl && iframe.parentNode !== targetEl) targetEl.appendChild(iframe as HTMLIFrameElement)
        const connectedHost = {
          send: (event: string) => {
            if (event === 'dashboard:run') {
              syncIframe(iframe.getAttribute?.('src') || initialUrl)
              emit('dashboard:run:start'); emit('dashboard:run:complete')
            }
          },
          sendAndReceive: (event: string, payload?: { url?: string }) => {
            if (event === 'page:load' && payload?.url) {
              const nextUrl = String(payload.url)
              syncIframe(nextUrl)
              setTimeout(() => {
                const pair = nextUrl.includes('/dashboards/') ? ['dashboard:loaded', 'dashboard']
                  : nextUrl.includes('/looks/') ? ['look:ready', 'look']
                  : nextUrl.includes('/explore/') ? ['explore:ready', 'explore'] : null
                if (pair) {
                  emit(pair[0], { url: nextUrl })
                  emit(`${pair[1]}:run:start`); emit(`${pair[1]}:run:complete`)
                }
                emit('page:changed', { page: { url: nextUrl, lookerVersion: '25.20.0' } })
              }, 0)
            }
            return Promise.resolve([])
          },
        }
        return {
          iframe,
          connect: () => Promise.resolve(connectedHost).then((host) => {
            setTimeout(() => emit('page:changed', { page: { url: initialUrl, lookerVersion: '25.20.0' } }), 0)
            return host
          }),
        }
      },
    }
    return builder
  }

  const sdk = opts.mockPreviewHtml
    ? getEmbedSDK(new LookerEmbedExSDK(chattyHostCreator as unknown as ChattyHostBuilderFactory))
    : getEmbedSDK()
  sdk.init(opts.hostUrl)
  telemetry.calls.push({ method: 'init', arg: opts.hostUrl }, { method: 'preload', arg: '/embed/preload' })

  const recordEvent = (name: string, running?: boolean) => {
    telemetry.events.push(name)
    if (typeof running === 'boolean') telemetry.running = running
    if (name.endsWith(':run:start')) telemetry.runCount += 1
    notify()
  }

  const connectionPromise: Promise<ILookerConnection> = sdk
    .preload()
    .appendTo(opts.container)
    .withClassName('dab-iframe')
    .on('dashboard:loaded', () => recordEvent('dashboard:loaded', false))
    .on('dashboard:run:start', () => recordEvent('dashboard:run:start', true))
    .on('dashboard:run:complete', () => recordEvent('dashboard:run:complete', false))
    .on('look:ready', () => recordEvent('look:ready', false))
    .on('look:run:start', () => recordEvent('look:run:start', true))
    .on('look:run:complete', () => recordEvent('look:run:complete', false))
    .on('explore:ready', () => recordEvent('explore:ready', false))
    .on('explore:run:start', () => recordEvent('explore:run:start', true))
    .on('explore:run:complete', () => recordEvent('explore:run:complete', false))
    .on('page:changed', (e: PageChangedEvent) => {
      if (e?.page?.url) telemetry.lastPageUrl = String(e.page.url)
      recordEvent('page:changed')
    })
    .build()
    .connect({ waitUntilLoaded: true })

  let lastTarget: LookerEmbedTarget | null = null
  let queue: Promise<ILookerConnection> = connectionPromise.then((conn) => { notify(); return conn })

  const syncTarget = (next: LookerEmbedTarget): Promise<ILookerConnection> => {
    const step = queue.catch(() => undefined).then(() => connectionPromise).then((connection) => {
      activePreviewMeta = { mode: next.previewMode, objectId: next.previewObjectId }
      const prev = lastTarget
      const isSameTarget = prev && prev.kind === next.kind && prev.target === next.target
      if (isSameTarget && prev.nonce === next.nonce) return connection
      const options = { waitUntilLoaded: true }
      const rec = (method: string, arg: string, p: Promise<unknown>) => {
        telemetry.calls.push({ method, arg }); telemetry.loadCount += 1; return p
      }
      const pre = next.kind !== 'preload' && isSameTarget && prev.nonce !== next.nonce
        ? rec('loadUrl', '/preload', connection.loadUrl({ url: '/preload', pushHistory: false, options }))
        : Promise.resolve()
      return pre.then(() => {
        if (next.kind === 'preload') return prev && prev.kind !== 'preload' ? rec('loadUrl', '/preload', connection.loadUrl({ url: '/preload', options })) : undefined
        if (next.kind === 'dashboard') return rec('loadDashboard', next.target, connection.loadDashboard({ id: next.target, options }))
        if (next.kind === 'look') return rec('loadLook', next.target, connection.loadLook({ id: next.target, options }))
        if (next.kind === 'explore') { const eid = next.target.replace('::', '/'); return rec('loadExplore', eid, connection.loadExplore({ id: eid, options })) }
        if (next.kind === 'extension') return rec('loadExtension', next.target, connection.loadExtension({ id: next.target, options }))
        if (next.kind === 'report') return rec('loadReport', next.target, connection.loadReport({ id: next.target, options }))
        return rec('loadUrl', next.target, connection.loadUrl({ url: next.target, options }))
      }).then(() => {
        lastTarget = next
        telemetry.state = next.kind === 'preload' ? 'preloaded' : next.kind
        telemetry.target = next.target
        const iframeEl = opts.container?.querySelector?.('iframe')
        if (iframeEl) {
          if (next.previewMode === 'conversational-analytics') {
            iframeEl.setAttribute('data-testid', 'ca-embed-iframe')
            iframeEl.setAttribute('data-ca-panels-collapsed', 'true')
            try {
              iframeEl.contentWindow?.postMessage?.({ type: 'looker:ca:layout', hide_sidebar: true, hide_data_source_panel: true, sidebar_collapsed: true, right_panel_collapsed: true }, '*')
            } catch { /* ignore */ }
          } else {
            iframeEl.removeAttribute('data-testid'); iframeEl.removeAttribute('data-ca-panels-collapsed')
          }
        }
        notify()
        return connection
      })
    })
    queue = step.catch(() => connectionPromise)
    return step
  }

  return {
    connectionPromise,
    syncTarget,
    getTelemetry: () => ({ ...telemetry, events: [...telemetry.events], calls: [...telemetry.calls] }),
  }
}

function formatConversationContentTag(conv: ConversationRecord): string {
  const c = conv.content || {}
  if (c.caConversationId || c.agentId) return `CA · ${c.agentName || c.agentId || c.caConversationId}`
  if (c.reportId) return `TDD #${c.reportId}${typeof c.overallScore === 'number' ? ` (${c.overallScore}%)` : ''}`
  if (c.scriptId) return `Script ${c.scriptId}${c.dashboardId ? ` · #${c.dashboardId}` : ''}`
  if (c.lookmlDashboardId || c.lookId || c.dashboardId) return `${c.lookmlDashboardId ? 'LookML' : c.lookId ? 'Look' : 'Dash'} #${c.lookmlDashboardId || c.lookId || c.dashboardId}`
  if (c.sessionId || c.projectId || c.branch) return `${c.projectId || c.sessionId}${c.branch ? ` · ${c.branch}` : ''}`
  return c.id ? `#${c.id}` : ''
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
      style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280 }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--dab-text-secondary)' }}>
        <Wrench size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>Slash Command Skill Menu (type /)</span>
      </div>
      {STUDIO_SLASH_SKILLS.slice(0, 3).map((sk, idx) => (
        <div
          key={sk.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 5, fontSize: 11.5,
            background: idx === 0 ? 'var(--dab-accent-subtle, #eff6ff)' : 'transparent',
            color: idx === 0 ? 'var(--dab-accent-text, #1d4ed8)' : 'var(--dab-text)',
          }}
        >
          <Wrench size={12} strokeWidth={1.75} aria-hidden="true" />
          <code style={{ fontWeight: 600 }}>{`/${sk.id}`}</code>
          <span className="dab-muted" style={{ fontSize: 11 }}>{sk.label}</span>
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

const AT_MENTION_DETECT_RE = /(?:^|\s)@(?:(explore|dashboard|look|conversation):([^\n@]*)|([^\s@]*))$/i
const SLASH_SKILL_DETECT_RE = /(?:^|\s)\/([a-z0-9_-]*)$/i

function renderMentionCategoryIcon(type: StudioContextCategory) {
  if (type === 'explore') return <Database size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'dashboard') return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'look') return <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
  return <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
}

export const StudioComposer: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    core40SDK, agentName: rawAgentName, models, selectedExplores, setSelectedExplores,
    preloadedContent, mentionedItems, setMentionedItems, searchGlobalContentV2,
    allConversations, conversations, activeMode, builderMode, isLookmlMode,
    isHealthCheckMode, isCaMode, caConversation, selectedUseCase, selectedModel,
    setSelectedModel, thinkingLevel, setThinkingLevel, availableModels, busyStatus,
    activatedLookmlSkills, setActivatedLookmlSkills, pastedImages, setPastedImages,
    prompt, setPrompt, handleSendPrompt, queuedPrompts, busySendAction, setBusySendAction,
    handleStopTurn, handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt,
    isAuthenticated, authMode, clientId, oauthSigningIn, handleOAuthLogin, history,
    lookmlBundle, nativeContent, infoModalUseCase, setInfoModalUseCase,
    folderTreeNodes, selectedFolderId, requirePermission, setRequirePermission,
    setFolderModalOpen, setEditingAgentName,
    messages, liveActivitySteps, copyThreadState, handleCopyThreadDebugTrace, activeConversationId,
  } = ctl

  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const addMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const busyActionWrapRef = useRef<HTMLDivElement | null>(null)
  const mentionMenuRef = useRef<HTMLDivElement | null>(null)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)

  const [addContextOpen, setAddContextOpen] = useState(false)
  const [busyActionMenuOpen, setBusyActionMenuOpen] = useState(false)
  const [cursorPos, setCursorPos] = useState<number>(() => prompt.length)
  const [forceMentionCategory, setForceMentionCategory] = useState<StudioContextCategory | 'all' | null>(
    () => (mockExt?.initialComboOpen ? 'explore' : null)
  )
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const [slashDismissedAt, setSlashDismissedAt] = useState<string | null>(null)
  const [remoteSearchResults, setRemoteSearchResults] = useState<StudioContextMention[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const historyRef = useRef<{ convId?: string; idx: number | null; draft: string }>({ idx: null, draft: '' })
  const userHistory = useMemo(
    () => messages.filter((m) => m.role === 'user' && m.text.trim()).map((m) => m.text),
    [messages]
  )
  const selectedFolderLabel = folderTreeNodes?.[selectedFolderId]?.name || 'My folder'

  useEffect(() => { setCursorPos((prev) => Math.min(prev, prompt.length)) }, [prompt.length])
  const applyRecalledPrompt = (idx: number | null, text: string) => {
    historyRef.current.convId = activeConversationId
    historyRef.current.idx = idx
    setPrompt(text); setCursorPos(text.length)
    setSlashDismissedAt(text || null); setForceMentionCategory(null)
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(text.length, text.length))
  }

  const detectedMention = useMemo(() => {
    const uptoCursor = prompt.slice(0, cursorPos || prompt.length)
    const m = slashDismissedAt !== uptoCursor ? uptoCursor.match(AT_MENTION_DETECT_RE) : null
    if (m) {
      const category = (m[1]?.toLowerCase() as StudioContextCategory | undefined) || 'all'
      const query = (m[1] ? m[2] || '' : m[3] || '').trim()
      const atIdx = uptoCursor.lastIndexOf('@')
      return { open: true, category, query, tokenStart: atIdx >= 0 ? atIdx : uptoCursor.length, tokenEnd: uptoCursor.length }
    }
    return {
      open: forceMentionCategory !== null, category: forceMentionCategory ?? ('all' as const),
      query: '', tokenStart: prompt.length, tokenEnd: prompt.length,
    }
  }, [prompt, cursorPos, forceMentionCategory, slashDismissedAt])

  useEffect(() => {
    if (detectedMention.open && mentionMenuRef.current && typeof mockExt?.initialExploreScrollTop === 'number') {
      mentionMenuRef.current.scrollTop = mockExt.initialExploreScrollTop
    }
  }, [detectedMention.open, models.length, mockExt?.initialExploreScrollTop])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (addMenuWrapRef.current && !addMenuWrapRef.current.contains(e.target as Node)) setAddContextOpen(false)
      if (busyActionWrapRef.current && !busyActionWrapRef.current.contains(e.target as Node)) setBusyActionMenuOpen(false)
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node) && textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setForceMentionCategory(null)
      }
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node) && textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setSlashDismissedAt(prompt.slice(0, cursorPos || prompt.length))
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [cursorPos, prompt])

  useEffect(() => {
    if (!detectedMention.open || !detectedMention.query) {
      setMentionLoading(false); setRemoteSearchResults([])
      return
    }
    let cancelled = false
    setMentionLoading(true)
    const timer = setTimeout(() => {
      searchGlobalContentV2(core40SDK, { term: detectedMention.query, category: detectedMention.category, limit: 15 })
        .then((items) => { if (!cancelled) setRemoteSearchResults(items) })
        .catch(() => { if (!cancelled) setRemoteSearchResults([]) })
        .finally(() => { if (!cancelled) setMentionLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [core40SDK, detectedMention.open, detectedMention.query, detectedMention.category, searchGlobalContentV2])

  const groupedExplores = useMemo(() => {
    const tokens = detectedMention.query.toLowerCase().split(/\s+/).filter(Boolean)
    return models
      .reduce(
        (acc: Array<{ label: string; modelName: string; options: Array<{ label: string; value: string; mention: StudioContextMention }> }>, model) => {
          if (model?.explores?.length) {
            const matchingExplores = model.explores.filter((explore) => {
              if (explore.hidden) return false
              if (tokens.length === 0) return true
              const expId = formatExploreId(model.name, String(explore.name))
              const haystack = `${model.label} ${model.name} ${explore.label || ''} ${explore.name} ${expId}`.toLowerCase()
              return tokens.every((tk) => haystack.includes(tk))
            })
            if (matchingExplores.length > 0) {
              acc.push({
                label: model.label || model.name,
                modelName: model.name,
                options: matchingExplores
                  .map((explore) => {
                    const value = formatExploreId(model.name, String(explore.name))
                    const label = String(explore.label || explore.name)
                    return {
                      label, value,
                      mention: {
                        type: 'explore' as const, id: value, title: label,
                        subtitle: String(model.label || model.name), model: model.name,
                        explore: String(explore.name), description: explore.description ? String(explore.description) : undefined,
                      },
                    }
                  })
                  .sort((a, b) => a.label.localeCompare(b.label)),
              })
            }
          }
          return acc
        },
        []
      )
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [models, detectedMention.query])

  const exploreLookup = useMemo(() => {
    const map: Record<string, { id: string; label: string; modelLabel: string; model: string; explore: string }> = {}
    models.forEach((model) => {
      ;(model.explores || []).forEach((explore) => {
        if (explore.hidden) return
        const id = formatExploreId(model.name, String(explore.name))
        map[id] = { id, label: String(explore.label || explore.name), modelLabel: String(model.label || model.name), model: model.name, explore: String(explore.name) }
      })
    })
    return map
  }, [models])

  const mentionOptions = useMemo(() => {
    const tokens = detectedMention.query.toLowerCase().split(/\s+/).filter(Boolean)
    const matchTokens = (text: string) => tokens.length === 0 || tokens.every((tk) => text.toLowerCase().includes(tk))
    const cat = detectedMention.category
    const seen = new Set<string>()
    const out: StudioContextMention[] = []
    const pushItem = (item: StudioContextMention) => {
      const key = `${item.type}:${item.id}`
      if (!seen.has(key)) { seen.add(key); out.push(item) }
    }
    if (cat === 'all' || cat === 'explore') {
      groupedExplores.forEach((group) => group.options.forEach((opt) => pushItem(opt.mention)))
      remoteSearchResults.forEach((r) => { if (r.type === 'explore') pushItem(r) })
    }
    ;(['dashboard', 'look'] as const).forEach((contentType) => {
      if (cat === 'all' || cat === contentType) {
        preloadedContent.forEach((item) => { if (item.type === contentType && matchTokens(`${item.title} ${item.id} ${item.description || ''}`)) pushItem(item) })
        remoteSearchResults.forEach((r) => { if (r.type === contentType) pushItem(r) })
      }
    })
    if (cat === 'all' || cat === 'conversation') {
      ;(allConversations || conversations || []).forEach((c) => {
        const label = c.label || c.id
        if (matchTokens(`${label} ${c.id} ${c.type || ''}`)) pushItem({ type: 'conversation', id: c.id, title: label, subtitle: c.use_case || c.type || 'conversation' })
      })
      remoteSearchResults.forEach((r) => { if (r.type === 'conversation') pushItem(r) })
    }
    return out
  }, [detectedMention.category, detectedMention.query, groupedExplores, preloadedContent, remoteSearchResults, allConversations, conversations])

  useEffect(() => { setActiveMentionIndex(0) }, [detectedMention.category, detectedMention.query, mentionOptions.length])

  const detectedSlashSkill = useMemo(() => {
    if (detectedMention.open) return { open: false, query: '', tokenStart: prompt.length, tokenEnd: prompt.length }
    const uptoCursor = prompt.slice(0, cursorPos || prompt.length)
    const m = uptoCursor.match(SLASH_SKILL_DETECT_RE)
    if (!m || slashDismissedAt === uptoCursor) return { open: false, query: '', tokenStart: prompt.length, tokenEnd: prompt.length }
    const slashIdx = uptoCursor.lastIndexOf('/')
    return { open: true, query: (m[1] || '').toLowerCase(), tokenStart: slashIdx >= 0 ? slashIdx : uptoCursor.length, tokenEnd: uptoCursor.length }
  }, [prompt, cursorPos, detectedMention.open, slashDismissedAt])

  const slashSkillOptions = useMemo(() => {
    const q = detectedSlashSkill.query.trim().toLowerCase()
    return q ? STUDIO_SLASH_SKILLS.filter((sk) => `${sk.id} ${sk.label} ${sk.desc}`.toLowerCase().includes(q)) : [...STUDIO_SLASH_SKILLS]
  }, [detectedSlashSkill.query])

  useEffect(() => { setActiveSlashIndex(0) }, [detectedSlashSkill.query, slashSkillOptions.length])

  const handleSelectSlashSkill = (sk: LookmlSkillCatalogEntry) => {
    setActivatedLookmlSkills((prev) => (prev.includes(sk.id) ? prev : [...prev, sk.id]))
    const prefix = prompt.slice(0, detectedSlashSkill.tokenStart)
    const head = `${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}/${sk.id} `
    setPrompt(`${head}${prompt.slice(detectedSlashSkill.tokenEnd)}`)
    setCursorPos(head.length); setSlashDismissedAt(null)
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(head.length, head.length) } })
  }

  const contextChips = useMemo(() => {
    const seen = new Set<string>()
    const chips: StudioContextMention[] = []
    mentionedItems.forEach((item) => {
      const key = `${item.type}:${item.id}`
      if (!seen.has(key)) { seen.add(key); chips.push(item) }
    })
    selectedExplores.forEach((expId) => {
      const key = `explore:${expId}`
      if (!seen.has(key)) {
        seen.add(key)
        const info = exploreLookup[expId]
        chips.push({ type: 'explore', id: expId, title: info ? `${info.modelLabel}: ${info.label}` : expId, model: info?.model, explore: info?.explore })
      }
    })
    return chips
  }, [mentionedItems, selectedExplores, exploreLookup])

  const handleSelectMentionOption = (item: StudioContextMention) => {
    setMentionedItems((prev) => (prev.some((x) => x.type === item.type && x.id === item.id) ? prev : [...prev, item]))
    if (item.type === 'explore') setSelectedExplores((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
    const replacement = `@${item.type}:${item.title} `
    const prefix = prompt.slice(0, detectedMention.tokenStart)
    const suffix = prompt.slice(detectedMention.tokenEnd)
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
    const nextPrompt = `${prefix}${needsLeadingSpace ? ' ' : ''}${replacement}${suffix}`
    setPrompt(nextPrompt)
    const nextPos = (prefix + (needsLeadingSpace ? ' ' : '') + replacement).length
    setCursorPos(nextPos); setForceMentionCategory(null)
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(nextPos, nextPos) } })
  }

  const handleRemoveContextChip = (chip: StudioContextMention) => {
    setMentionedItems((prev) => prev.filter((x) => !(x.type === chip.type && x.id === chip.id)))
    if (chip.type === 'explore') setSelectedExplores((prev) => prev.filter((id) => id !== chip.id))
  }

  const handleInsertScopedPrefix = (category: StudioContextCategory) => {
    setAddContextOpen(false)
    const token = `@${category}:`
    const trimmed = prompt.replace(/\s+$/, '')
    const nextPrompt = trimmed ? `${trimmed} ${token}` : token
    setPrompt(nextPrompt); setCursorPos(nextPrompt.length); setForceMentionCategory(category)
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(nextPrompt.length, nextPrompt.length) } })
  }

  const activeGuideUseCase: StudioUseCase =
    isCaMode || caConversation ? 'conversational-analytics'
      : isHealthCheckMode ? 'health-check'
      : isLookmlMode ? 'lookml'
      : activeMode === 'tile' ? 'tile'
      : builderMode === 'dashboard' ? 'dashboard'
      : selectedUseCase || 'auto'
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => handleImageClipboardPaste(e, setPastedImages)

  return (
    <div className="dab-composer dab-chatbar">
      <UseCaseInfoModal activeUseCase={infoModalUseCase} onSelectUseCase={setInfoModalUseCase} onClose={() => setInfoModalUseCase(null)} />

      {contextChips.length > 0 && (
        <div className="dab-composer-context-chips" data-testid="composer-context-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {contextChips.map((chip) => (
            <span key={`${chip.type}:${chip.id}`} className="dab-chip" data-testid={`composer-context-chip-${chip.type}-${chip.id}`} title={`${chip.type}: ${chip.id}`}>
              {renderMentionCategoryIcon(chip.type)}
              <span>@{chip.type}:{chip.title}</span>
              <button type="button" aria-label={`Remove ${chip.title}`} onClick={() => handleRemoveContextChip(chip)}>
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {pastedImages.length > 0 && (
        <div className="dab-composer-attached-files" data-testid="composer-attached-files" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {pastedImages.map((img, i) => {
            const isImage = img.mimeType.startsWith('image/')
            return (
              <div key={img.id || i} className="dab-attached-file-pill" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                {isImage ? (
                  <img src={img.dataUrl} alt={img.name || 'Attached image'} style={{ height: 52, borderRadius: 4, border: '1px solid var(--dab-border)' }} />
                ) : (
                  <span className="dab-chip" title={img.name || 'Attached file'}>
                    <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
                    <span>{img.name || `Attachment ${i + 1}`}</span>
                  </span>
                )}
                <button
                  type="button" aria-label={`Remove ${img.name || 'attachment'}`}
                  onClick={() => setPastedImages((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    position: isImage ? 'absolute' : 'static', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%',
                    border: 'none', background: '#0f172a', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px',
                    padding: 0, marginLeft: isImage ? 0 : 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={11} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {queuedPrompts.length > 0 && (
        <div className="dab-queued-prompts-bar" data-testid="queued-prompts-bar" role="region" aria-label="Queued prompts">
          {queuedPrompts.map((q) => (
            <div key={q.id} className="dab-queued-prompt-item" data-testid="queued-prompt-item">
              <CornerDownRight size={12} strokeWidth={1.75} aria-hidden="true" className="dab-queued-prompt-icon" />
              <span className="dab-queued-prompt-text" title={q.text}>{q.text || `${q.images.length} attachment(s)`}</span>
              <div className="dab-queued-prompt-actions">
                <button
                  type="button" className="dab-btn-secondary dab-queued-prompt-interject-btn"
                  data-testid={`queued-prompt-interject-${q.id}`} onClick={() => handleInterjectPrompt(q.id)}
                  title="Abort current turn and send this queued message immediately"
                >
                  <Zap size={11} strokeWidth={1.75} aria-hidden="true" /><span>Interject</span>
                </button>
                <button
                  type="button" className="dab-queued-prompt-remove-btn" data-testid={`queued-prompt-remove-${q.id}`}
                  onClick={() => handleRemoveQueuedPrompt(q.id)} aria-label="Remove queued message" title="Remove from queue"
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dab-composer-input-wrap" style={{ position: 'relative' }}>
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
                    className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`}
                    onMouseEnter={() => setActiveSlashIndex(idx)} onClick={(e) => { e.stopPropagation(); handleSelectSlashSkill(sk) }}
                    title={`${sk.label} — ${sk.desc} (${sk.path})`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                      <BookOpen size={13} strokeWidth={1.75} aria-hidden="true" /><code style={{ fontSize: 11.5, fontWeight: 600 }}>/{sk.id}</code>
                      <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{sk.label}</span>
                      <span className="dab-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {sk.desc}</span>
                    </span>
                    {isSelected && <Check size={13} strokeWidth={2} aria-hidden="true" />}
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
                onClick={(e) => { e.stopPropagation(); setSelectedExplores([]); setMentionedItems((prev) => prev.filter((x) => x.type !== 'explore')) }}
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
                          onMouseEnter={() => { if (flatIdx >= 0) setActiveMentionIndex(flatIdx) }}
                          onClick={(e) => { e.stopPropagation(); handleSelectMentionOption(opt.mention) }}
                          title={opt.value}
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
                    onMouseEnter={() => setActiveMentionIndex(idx)}
                    onClick={(e) => { e.stopPropagation(); handleSelectMentionOption(item) }}
                    title={`${item.type}: ${item.title} (${item.id})`}
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

        <textarea
          ref={textareaRef} rows={3} data-testid="studio-prompt-input"
          placeholder={
            isHealthCheckMode ? 'Optional custom focus for 3-Pillar Looker & BigQuery Health Check...'
              : isCaMode || selectedUseCase === 'conversational-analytics' ? 'Ask a natural-language data question for Looker Conversational Analytics...'
              : isLookmlMode ? 'Describe LookML changes, SQL query to model, or field descriptions/tests to run in your active dev mode...'
              : activeMode === 'tile' ? 'Describe the Script to generate or update (or paste a screenshot)...'
              : builderMode === 'dashboard' ? 'Describe a Looker UDD, Look, Board, or Schedule to create or update (type @ to mention context)...'
              : `Ask ${normalizeStudioAgentName(rawAgentName)} what you want to build, analyze, or automate (type @ to mention Explores, Dashboards, Looks, or Conversations)...`
          }
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value)
            setCursorPos(e.target.selectionStart ?? e.target.value.length)
            historyRef.current.idx = null
            if (forceMentionCategory !== null) setForceMentionCategory(null)
            if (slashDismissedAt !== null) setSlashDismissedAt(null)
          }}
          onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? prompt.length)}
          onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? prompt.length)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (detectedSlashSkill.open && slashSkillOptions.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSlashIndex((i) => (i + 1) % slashSkillOptions.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSlashIndex((i) => (i - 1 + slashSkillOptions.length) % slashSkillOptions.length); return }
              if ((e.key === 'Enter' || e.key === 'Tab') && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                const picked = slashSkillOptions[activeSlashIndex] || slashSkillOptions[0]
                if (picked) handleSelectSlashSkill(picked)
                return
              }
            }
            if (e.key === 'Escape' && detectedSlashSkill.open) { e.preventDefault(); setSlashDismissedAt(prompt.slice(0, cursorPos || prompt.length)); return }
            if (detectedMention.open && mentionOptions.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveMentionIndex((i) => (i + 1) % mentionOptions.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length); return }
              if ((e.key === 'Enter' || e.key === 'Tab') && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                const picked = mentionOptions[activeMentionIndex] || mentionOptions[0]
                if (picked) handleSelectMentionOption(picked)
                return
              }
            }
            if (e.key === 'Escape' && detectedMention.open) { e.preventDefault(); setSlashDismissedAt(prompt.slice(0, cursorPos || prompt.length)); setForceMentionCategory(null); return }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
              const h = historyRef.current
              const curIdx = h.convId === activeConversationId && h.idx !== null && prompt === userHistory[h.idx] ? h.idx : null
              const selStart = e.currentTarget.selectionStart ?? prompt.length
              const selEnd = e.currentTarget.selectionEnd ?? selStart
              if (e.key === 'ArrowUp' && userHistory.length > 0 && !prompt.slice(0, selStart).includes('\n') && (curIdx !== null || !prompt.trim())) {
                e.preventDefault()
                if (curIdx === null) h.draft = prompt
                const nextIdx = curIdx === null ? userHistory.length - 1 : Math.max(0, curIdx - 1)
                applyRecalledPrompt(nextIdx, userHistory[nextIdx])
                return
              }
              if (e.key === 'ArrowDown' && curIdx !== null && !prompt.slice(selEnd).includes('\n')) {
                e.preventDefault()
                if (curIdx < userHistory.length - 1) applyRecalledPrompt(curIdx + 1, userHistory[curIdx + 1])
                else applyRecalledPrompt(null, h.draft)
                return
              }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              if (busyStatus) {
                if (busySendAction === 'interject') void handleInterjectPrompt()
                else handleQueuePrompt()
              } else {
                void handleSendPrompt()
              }
            }
          }}
        />
      </div>

      <input
        ref={fileInputRef} type="file" multiple data-testid="composer-file-input"
        accept="image/*,application/pdf,.csv,.tsv,.json,.sql,.lkml,.lookml,.md,.py,.js,.ts,.tsx,.txt"
        style={{ display: 'none' }}
        onChange={(e) => { handleFileInputSelection(e.target.files, setPastedImages); e.target.value = '' }}
      />

      <div className="dab-composer-actions">
        <div className="dab-composer-add-wrap" ref={addMenuWrapRef} style={{ position: 'relative' }}>
          <button
            type="button" data-testid="composer-add-context-btn" className="dab-btn-secondary dab-composer-add-btn"
            onClick={() => setAddContextOpen((prev) => !prev)}
            title="Add files or @-mention Looker Explores, Dashboards, Looks, or Conversations"
            aria-label="Add Context" aria-expanded={addContextOpen}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>

          {addContextOpen && (
            <div className="dab-composer-add-menu" data-testid="composer-add-context-menu" role="menu" aria-label="Add Context">
              <button
                type="button" role="menuitem" data-testid="add-context-files" className="dab-composer-add-item"
                onClick={() => { setAddContextOpen(false); fileInputRef.current?.click() }}
              >
                <Paperclip size={13} strokeWidth={1.75} aria-hidden="true" /><span>Files</span>
              </button>
              {([
                ['explore', 'Explores', 'add-context-explores'],
                ['dashboard', 'Dashboards', 'add-context-dashboards'],
                ['look', 'Looks', 'add-context-looks'],
                ['conversation', 'Conversations', 'add-context-conversations'],
              ] as const).map(([cat, label, testId]) => (
                <button key={cat} type="button" role="menuitem" data-testid={testId} className="dab-composer-add-item" onClick={() => handleInsertScopedPrefix(cat)}>
                  {renderMentionCategoryIcon(cat)}<span>{label}</span>
                </button>
              ))}
              <button type="button" role="menuitem" data-testid="mobile-menu-folder-btn" className="dab-composer-add-item dab-mobile-only-menu-item" onClick={() => { setAddContextOpen(false); setFolderModalOpen(true) }}>
                <Folder size={13} strokeWidth={1.75} aria-hidden="true" /><span>Folder: {selectedFolderLabel}</span>
              </button>
              <button type="button" role="menuitem" data-testid="mobile-menu-approval-btn" className="dab-composer-add-item dab-mobile-only-menu-item" onClick={() => { setRequirePermission((prev) => !prev); setAddContextOpen(false) }}>
                {requirePermission ? <Shield size={13} strokeWidth={1.75} aria-hidden="true" /> : <Zap size={13} strokeWidth={1.75} aria-hidden="true" />}
                <span>Approval: {requirePermission ? 'Safe Mode (Ask)' : 'Auto-Approve (YOLO)'}</span>
              </button>
              <button type="button" role="menuitem" data-testid="mobile-menu-edit-agent-name-btn" className="dab-composer-add-item dab-mobile-only-menu-item" onClick={() => { setAddContextOpen(false); setEditingAgentName(true) }}>
                <Pencil size={13} strokeWidth={1.75} aria-hidden="true" /><span>Rename {normalizeStudioAgentName(rawAgentName)}...</span>
              </button>
              {(messages.length > 0 || (liveActivitySteps?.length ?? 0) > 0) && (
                <>
                  <button
                    type="button" role="menuitem" data-testid="mobile-menu-overview-btn"
                    className="dab-composer-add-item dab-mobile-only-menu-item"
                    onClick={() => { setAddContextOpen(false); ctl.handleSelectOverview(); ctl.setRightPaneCollapsed(false) }}
                  >
                    <PanelRightOpen size={13} strokeWidth={1.75} aria-hidden="true" /><span>Overview</span>
                  </button>
                  <button
                    type="button" role="menuitem" data-testid="mobile-menu-copy-thread-btn"
                    className="dab-composer-add-item dab-mobile-only-menu-item"
                    onClick={() => { setAddContextOpen(false); void handleCopyThreadDebugTrace() }}
                  >
                    {copyThreadState === 'loading' ? (
                      <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
                    ) : copyThreadState === 'copied' ? (
                      <Check size={13} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Bug size={13} strokeWidth={1.75} aria-hidden="true" />
                    )}
                    <span>{copyThreadState === 'loading' ? 'Copying Thread…' : copyThreadState === 'copied' ? 'Copied Thread' : 'Copy Thread'}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <StudioSelect
          data-testid="composer-model-select" testId="composer-model-select" className="dab-composer-model-select"
          value={selectedModel} onChange={setSelectedModel} disabled={!!busyStatus}
          ariaLabel="Select Antigravity model" title="Select Antigravity model for this turn (/v1beta/models)"
          options={availableModels.map((m) => ({
            value: m.id, label: m.label, title: m.description,
            subMenu: { value: thinkingLevel, options: STUDIO_THINKING_LEVEL_OPTIONS, onChange: (lvl) => setThinkingLevel(lvl as StudioThinkingLevel), testId: 'composer-thinking-level-menu' },
          }))}
        />

        <UseCaseInfoTrigger useCase={activeGuideUseCase} onOpen={setInfoModalUseCase} />

        <div className="dab-composer-send-group" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' }}>
          {!isAuthenticated && !busyStatus && (
            <button
              type="button" data-testid="composer-signin-inline-btn" className="dab-inline-signin-btn"
              onClick={() => (authMode === 'oauth' && clientId.trim() ? handleOAuthLogin() : history.push('/config'))}
            >
              {authMode === 'oauth' && clientId.trim() ? (oauthSigningIn ? 'Signing in… (click to retry)' : 'Sign in to send') : 'Configure credentials to send'}
            </button>
          )}
          {busyStatus ? (
            <>
              <div className="dab-split-action-group" data-testid="studio-busy-action-group" ref={busyActionWrapRef}>
                <StudioButton
                  variant="secondary"
                  testId={busySendAction === 'interject' ? 'studio-interject-btn' : 'studio-queue-btn'}
                  className="dab-split-action-main"
                  onClick={() => (busySendAction === 'interject' ? void handleInterjectPrompt() : handleQueuePrompt())}
                  disabled={(busySendAction === 'interject' && !isAuthenticated) || (!prompt.trim() && pastedImages.length === 0)}
                  title={busySendAction === 'interject' ? 'Interrupt the running turn and send this message immediately (Cmd/Ctrl+Enter)' : 'Queue message to run automatically when the current turn finishes (Cmd/Ctrl+Enter)'}
                >
                  {busySendAction === 'interject' ? <Zap size={13} strokeWidth={1.75} aria-hidden="true" /> : <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" />}
                  <span>{busySendAction === 'interject' ? 'Interject' : 'Queue'}</span>
                </StudioButton>
                <button
                  type="button" data-testid="studio-busy-action-menu-trigger" className="dab-btn dab-btn-secondary dab-split-action-caret"
                  onClick={() => setBusyActionMenuOpen((prev) => !prev)}
                  title="Change send action while turn is running" aria-label="Change send action while turn is running" aria-expanded={busyActionMenuOpen}
                >
                  <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
                {busyActionMenuOpen && (
                  <div className="dab-split-action-menu" data-testid="studio-busy-action-menu" role="menu" aria-label="Send action while turn is running">
                    {([['queue', 'Queue', CornerDownRight], ['interject', 'Interject', Zap]] as const).map(([act, lbl, Icon]) => (
                      <button
                        key={act} type="button" role="menuitemradio" aria-checked={busySendAction === act}
                        data-testid={`studio-busy-action-option-${act}`}
                        className={`dab-split-action-option ${busySendAction === act ? 'selected' : ''}`}
                        onClick={() => { setBusySendAction(act); setBusyActionMenuOpen(false) }}
                      >
                        <Icon size={13} strokeWidth={1.75} aria-hidden="true" /><span>{lbl}</span>
                        {busySendAction === act && <Check size={12} strokeWidth={2} aria-hidden="true" style={{ marginLeft: 'auto' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <StudioButton variant="danger" testId="studio-stop-btn" onClick={handleStopTurn} title="Stop current turn">
                <Square size={12} strokeWidth={2} aria-hidden="true" /><span>Stop</span>
              </StudioButton>
            </>
          ) : (
            <StudioButton variant="gemini" testId="studio-send-btn" onClick={handleSendPrompt} disabled={!isAuthenticated || (!prompt.trim() && pastedImages.length === 0)}>
              {isCaMode || selectedUseCase === 'conversational-analytics'
                ? (caConversation ? 'Ask CA Agent' : 'Route & Start CA Chat')
                : isLookmlMode ? (lookmlBundle ? 'Update LookML' : 'Run Agentic LookML')
                : activeMode === 'tile' ? 'Ask AI'
                : builderMode === 'dashboard' ? (nativeContent ? 'Update Content' : 'Create / Update Content')
                : 'Send Message'}
            </StudioButton>
          )}
        </div>
      </div>
    </div>
  )
}

export const StudioCenteredEmptyStage: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const { agentName: rawAgentName, activeMode, builderMode, isLookmlMode, isHealthCheckMode, selectedUseCase, selectedExplores, starterPrompts, starterPromptsLoading, setPrompt, busyStatus } = ctl
  const agentName = normalizeStudioAgentName(rawAgentName)
  return (
    <main className="dab-empty-stage-centered" data-testid="centered-empty-prompt">
      <div className="dab-empty-prompt-card" data-testid="studio-empty-stage">
        <div className="dab-empty-hero">
          <h2>
            {isHealthCheckMode ? 'Run a 3-Pillar Looker & BigQuery Health Check'
              : isLookmlMode ? 'Author & Validate Agentic LookML'
              : activeMode === 'tile' ? 'Author & Schedule a Looker Script'
              : builderMode === 'dashboard' ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
              : `${agentName} is ready`}
          </h2>
          <p className="dab-muted">
            {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
          </p>
          <StarterPromptButtons useCase={selectedUseCase} prompts={starterPrompts} loading={starterPromptsLoading} onSelect={setPrompt} disabled={!!busyStatus} />
        </div>
        <StudioComposer ctl={ctl} />
        <SandboxMarkdownPreviewModal ctl={ctl} />
      </div>
    </main>
  )
}

const STEP_BADGES: Record<string, React.ReactNode> = {
  thought: <><Brain size={13} strokeWidth={1.75} aria-hidden="true" /> Thought</>,
  codemode: <><Code2 size={13} strokeWidth={1.75} aria-hidden="true" /> Code Mode</>,
  cli_bridge: <><Terminal size={13} strokeWidth={1.75} aria-hidden="true" /> CLI Bridge</>,
  file: <><FileText size={13} strokeWidth={1.75} aria-hidden="true" /> File</>,
  skill: <><BookOpen size={13} strokeWidth={1.75} aria-hidden="true" /> Skill</>,
}

function formatActivityStepBadge(step: AntigravityActivityStep): React.ReactNode {
  if (step.kind === 'code_execution') {
    return step.language === 'PYTHON'
      ? <><Code2 size={13} strokeWidth={1.75} aria-hidden="true" /> Sandbox Python</>
      : <><Terminal size={13} strokeWidth={1.75} aria-hidden="true" /> Sandbox Bash</>
  }
  return STEP_BADGES[step.kind] || <><Wrench size={13} strokeWidth={1.75} aria-hidden="true" /> Activity</>
}

interface ActivityStepContentContext {
  lookmlBundle?: LookmlBundle | null
  currentAppCode?: string | null
  schemaMarkdown?: string | null
  sandboxMarkdownCache?: Record<string, string>
  sandboxMarkdownLoading?: Record<string, boolean>
  onLoadSandboxMarkdownFile?: (path: string, opts?: { openModal?: boolean }) => Promise<string>
  onOpenSandboxMarkdownModal?: (path: string) => void
  onOpenViewerDocument?: (input: { path: string; title?: string; kind?: 'skill' | 'file'; content?: string }) => Promise<string>
}

function extractStepFilePath(step: AntigravityActivityStep): string | undefined {
  if (step.kind !== 'file' && step.kind !== 'skill') return undefined
  const cands = [step.path, step.detail, step.title].map((s) => String(s || '').trim()).filter(Boolean)
  for (let i = 0; i < cands.length; i++) {
    const clean = cands[i]
      .split('—')[0]
      .trim()
      .replace(/^(?:Viewing|Editing|Creating|Writing|Reading\s+skill|Skill:)\s+/i, '')
      .trim()
    if (!clean) continue
    if (step.kind === 'skill' && !clean.includes('/') && !/\.[a-z0-9]+$/i.test(clean)) {
      return `/workspace/skills/${clean.toLowerCase()}/SKILL.md`
    }
    if (clean.includes('/') || /\.(?:md|lkml|lookml|py|js|ts|tsx|json|sql|sh|txt|css|html)$/i.test(clean)) {
      return clean
    }
  }
  return undefined
}

function extractStepMarkdownPath(step: AntigravityActivityStep): string | undefined {
  const filePath = extractStepFilePath(step)
  if (!filePath) return undefined
  return step.kind === 'skill' || /\.md$/i.test(filePath) ? filePath : undefined
}

function resolveStaticOrCachedStepContent(step: AntigravityActivityStep, ctx?: ActivityStepContentContext): string | undefined {
  if (step.content?.trim()) return step.content
  const cands = [step.path, step.detail, step.title].map((s) => String(s || '').trim()).filter(Boolean)
  for (let i = 0; i < cands.length; i++) {
    const cand = cands[i]
    const clean = cand.split('—')[0].trim().replace(/^(?:Viewing|Editing|Creating|Writing|Reading\s+skill|Skill:)\s+/i, '').trim()
    const builtin = resolveBuiltinWorkspaceFileContent(cand) || resolveBuiltinWorkspaceFileContent(clean)
    if (builtin) return builtin
    const base = clean.split('/').filter(Boolean).pop() || clean
    const lkml = ctx?.lookmlBundle?.files?.find((f) => f.path === clean || f.path.endsWith(`/${base}`) || f.path === base)?.content
    if (lkml) return lkml
    if ((base === 'app.js' || clean.endsWith('/app.js')) && ctx?.currentAppCode) return ctx.currentAppCode
    if ((base === 'schema.md' || clean.endsWith('/schema.md')) && ctx?.schemaMarkdown) return ctx.schemaMarkdown
    const normalized = normalizeSandboxFilePath(clean)
    const cached = ctx?.sandboxMarkdownCache?.[clean] ?? ctx?.sandboxMarkdownCache?.[normalized] ?? ctx?.sandboxMarkdownCache?.[normalized ? `/${normalized}` : '']
    if (typeof cached === 'string' && cached.length > 0) return cached
  }
  return undefined
}

function resolveActivityStepContent(step: AntigravityActivityStep, ctx?: ActivityStepContentContext): string {
  return resolveStaticOrCachedStepContent(step, ctx) || step.detail || step.path || step.title
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

const ThinkingStepsList: React.FC<{ steps: AntigravityActivityStep[]; contentCtx?: ActivityStepContentContext }> = ({ steps, contentCtx }) => {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({})
  const handleToggleStep = (key: string, step: AntigravityActivityStep) => {
    const willOpen = !expandedKeys[key]
    setExpandedKeys((prev) => ({ ...prev, [key]: willOpen }))
    if (step.kind === 'file' || step.kind === 'skill') {
      const filePath = extractStepFilePath(step)
      const staticContent = resolveStaticOrCachedStepContent(step, contentCtx)
      if (filePath && contentCtx?.onOpenViewerDocument) {
        void contentCtx.onOpenViewerDocument({ path: filePath, title: step.title, kind: step.kind, content: staticContent })
      } else if (willOpen) {
        const mdPath = extractStepMarkdownPath(step)
        if (mdPath && !staticContent) void contentCtx?.onLoadSandboxMarkdownFile?.(mdPath)
      }
    }
  }
  return (
    <div className="dab-thinking-steps">
      {steps.map((step, sIdx) => {
        const stepKey = String(step.id || sIdx)
        const hasDetail = Boolean(step.detail && step.detail !== step.title)
        const isCollapsibleThought = step.kind === 'thought' && hasDetail
        const isFileOrSkill = step.kind === 'file' || step.kind === 'skill'
        const isExpandableExec =
          (step.kind === 'code_execution' || step.kind === 'codemode' || step.kind === 'cli_bridge') &&
          Boolean(step.content?.trim())
        const isCollapsible = isCollapsibleThought || isFileOrSkill || isExpandableExec
        const isOpen = Boolean(expandedKeys[stepKey])
        const StepTag = isCollapsible ? 'details' : 'div'
        const HeaderTag = isCollapsible ? 'summary' : 'div'
        const testId = isCollapsibleThought
          ? 'thinking-step-thought'
          : step.kind === 'file'
          ? 'thinking-step-file'
          : step.kind === 'skill'
          ? 'thinking-step-skill'
          : isExpandableExec
          ? 'thinking-step-expandable'
          : undefined
        const mdPath = isFileOrSkill ? extractStepMarkdownPath(step) : undefined
        const staticOrCachedContent = isFileOrSkill ? resolveStaticOrCachedStepContent(step, contentCtx) : undefined
        const resolvedContent = isFileOrSkill ? resolveActivityStepContent(step, contentCtx) : ''
        const normalizedMdPath = mdPath ? normalizeSandboxFilePath(mdPath) : ''
        const isLoadingMd = Boolean(
          normalizedMdPath && !staticOrCachedContent &&
            (contentCtx?.sandboxMarkdownLoading?.[mdPath!] || contentCtx?.sandboxMarkdownLoading?.[normalizedMdPath] || contentCtx?.sandboxMarkdownLoading?.[`/${normalizedMdPath}`])
        )
        return (
          <StepTag
            key={stepKey}
            className={`dab-thinking-step dab-thinking-step-${step.kind}${isFileOrSkill ? ' dab-thinking-step-interactive' : ''}${isExpandableExec ? ' dab-thinking-step-expandable' : ''}`}
            data-step-kind={step.kind} data-step-status={step.status || 'done'}
            {...(testId ? { 'data-testid': testId } : {})}
            {...(isCollapsible ? {
              open: isOpen,
              onClick: (e: React.MouseEvent<HTMLElement>) => {
                if ((e.target as HTMLElement).closest('pre, button')) return
                e.preventDefault(); handleToggleStep(stepKey, step)
              },
            } : {})}
          >
            <HeaderTag
              className="dab-thinking-step-header"
              {...(isCollapsible ? { onClick: (e: React.MouseEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); handleToggleStep(stepKey, step) } } : {})}
            >
              <span className="dab-thinking-kind-badge">{formatActivityStepBadge(step)}</span>
              <span className="dab-thinking-step-title">{step.title}</span>
              {step.status === 'running' && <span className="dab-thinking-step-status">Running…</span>}
            </HeaderTag>
            {hasDetail && <code className="dab-thinking-step-detail">{step.detail}</code>}
            {isExpandableExec && <pre className="dab-thinking-step-pre">{step.content}</pre>}
            {isFileOrSkill && isOpen && (
              isLoadingMd ? (
                <div className="dab-thinking-step-loading" data-testid="activity-step-loading">
                  <StudioSkeleton width="100%" height={24} /><span className="dab-muted">Loading from sandbox...</span>
                </div>
              ) : (
                resolvedContent && (
                  <div className="dab-thinking-step-content-wrap">
                    {mdPath && (
                      <div className="dab-thinking-step-md-actions">
                        <StudioButton
                          variant="secondary" testId="open-sandbox-markdown-modal-btn"
                          onClick={(e) => {
                            e.preventDefault(); e.stopPropagation()
                            if (staticOrCachedContent) contentCtx?.onOpenSandboxMarkdownModal?.(mdPath)
                            else void contentCtx?.onLoadSandboxMarkdownFile?.(mdPath, { openModal: true })
                          }}
                        >
                          <FileText size={12} strokeWidth={1.75} aria-hidden="true" /><span>Open Markdown Preview</span>
                        </StudioButton>
                      </div>
                    )}
                    <pre className="dab-thinking-step-content-preview" data-testid="activity-step-content-preview">{resolvedContent}</pre>
                  </div>
                )
              )
            )}
          </StepTag>
        )
      })}
    </div>
  )
}

export const StudioLeftPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    agentName: rawAgentName, extensionSDK,
    messages, builderMode, selectedUseCase, selectedExplores, starterPrompts, starterPromptsLoading,
    setPrompt, busyStatus, liveActivitySteps, hydratingInteractionIds, hydrateMessageActivitySteps,
    pendingPerm, resolvePermDecision,
    leftPaneWidth, setLeftPaneWidth, flushLeftPaneWidthSave, rightPaneCollapsed, setRightPaneCollapsed,
    contentItems = [], activeContentTabKey = '', handleSelectContentTab,
    lookmlBundle, currentAppCode, schemaMarkdown,
    sandboxMarkdownCache, sandboxMarkdownLoading, loadSandboxMarkdownFile, setActiveSandboxMarkdownModalPath,
    openViewerDocument, setActiveViewerDocument,
    conversations = [], activeConversationId, copyThreadState, handleCopyThreadDebugTrace,
  } = ctl
  const agentName = normalizeStudioAgentName(rawAgentName)
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  const leftPaneRef = useRef<HTMLElement | null>(null)
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  const prevMsgCountRef = useRef(messages.length)
  const prevBusyRef = useRef(Boolean(busyStatus))
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [copiedTraceKey, setCopiedTraceKey] = useState<string | null>(null)
  const [longPressUserMsgIdx, setLongPressUserMsgIdx] = useState<number | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setLongPressUserMsgIdx(null)
    longPressFiredRef.current = false
    return () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current) }
  }, [activeConversationId])

  useEffect(() => {
    if (longPressUserMsgIdx === null || typeof document === 'undefined') return
    const close = (ev: Event) => {
      if (ev.type === 'mousedown' && longPressFiredRef.current) return
      if ((ev.target as HTMLElement | null)?.closest?.(`[data-testid="user-msg-longpress-menu-${longPressUserMsgIdx}"]`)) return
      setLongPressUserMsgIdx(null)
    }
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setLongPressUserMsgIdx(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [longPressUserMsgIdx])

  const clearLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
  }
  const handleCopyUserMsg = (idx: number, text: string) => {
    const key = `user_${idx}`
    void copyTextWithExtensionSdk(text, extensionSDK)
    setCopiedTraceKey(key); setLongPressUserMsgIdx(null)
    setTimeout(() => setCopiedTraceKey((cur) => (cur === key ? null : cur)), 1800)
  }

  const deletedCrudKeys = useMemo(() => {
    const latest = new Map<string, string>()
    messages.forEach((m) => m.crudItems?.forEach((it) => latest.set(it.key, it.action)))
    return new Set(Array.from(latest.entries()).filter(([, a]) => a === 'deleted').map(([k]) => k))
  }, [messages])

  useEffect(() => {
    const el = chatLogRef.current
    const prevCount = prevMsgCountRef.current
    const wasBusy = prevBusyRef.current
    const lastMsg = messages[messages.length - 1]
    const userJustSent = messages.length > prevCount && lastMsg?.role === 'user'
    const busyJustActivated = Boolean(busyStatus) && !wasBusy
    prevMsgCountRef.current = messages.length
    prevBusyRef.current = Boolean(busyStatus)
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 140
    if (userJustSent || ((busyJustActivated || Boolean(busyStatus)) && isNearBottom)) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, busyStatus, liveActivitySteps?.length])

  const contentCtx = useMemo<ActivityStepContentContext>(
    () => ({
      lookmlBundle, currentAppCode, schemaMarkdown, sandboxMarkdownCache, sandboxMarkdownLoading,
      onLoadSandboxMarkdownFile: loadSandboxMarkdownFile,
      onOpenSandboxMarkdownModal: (p: string) => {
        const normalized = normalizeSandboxFilePath(p)
        setActiveSandboxMarkdownModalPath(normalized ? `/${normalized}` : p)
      },
      onOpenViewerDocument: openViewerDocument,
    }),
    [lookmlBundle, currentAppCode, schemaMarkdown, sandboxMarkdownCache, sandboxMarkdownLoading, loadSandboxMarkdownFile, setActiveSandboxMarkdownModalPath, openViewerDocument]
  )

  const handleOpenContentLinkInViewer = (target: InViewerLookerLinkTarget) => openContentLinkTargetInViewer(ctl, target)

  const handleCopyThinkingTrace = (
    e: React.MouseEvent<HTMLButtonElement>, traceKey: string, steps: AntigravityActivityStep[],
    meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string },
    interactionId?: string, stopAtInteractionId?: string
  ) => {
    e.preventDefault(); e.stopPropagation()
    const finishCopy = (resolvedSteps: AntigravityActivityStep[]) => {
      const enriched = resolvedSteps.map((s) => ((s.kind === 'file' || s.kind === 'skill') && !s.content ? { ...s, content: resolveActivityStepContent(s, contentCtx) } : s))
      const md = formatThinkingTraceMarkdown(enriched, meta)
      if (typeof window !== 'undefined') window.__LAST_COPIED_THINKING_TRACE__ = md
      void copyTextWithExtensionSdk(md, extensionSDK)
      setCopiedTraceKey(traceKey)
      setTimeout(() => setCopiedTraceKey((curr) => (curr === traceKey ? null : curr)), 1800)
    }
    if (steps.length > 0 || !interactionId || !hydrateMessageActivitySteps) {
      finishCopy(steps)
    } else {
      void hydrateMessageActivitySteps(interactionId, stopAtInteractionId).then(finishCopy)
    }
  }

  const renderCopyTraceBtn = (
    traceKey: string,
    steps: AntigravityActivityStep[],
    meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string },
    interactionId?: string,
    stopAtInteractionId?: string
  ) => {
    const isCopied = copiedTraceKey === traceKey
    return (
      <button
        type="button" data-testid="copy-thinking-trace-btn" data-copied={isCopied ? 'true' : 'false'}
        className="dab-thinking-copy-btn" title="Copy debug trace to clipboard" aria-label="Copy debug trace to clipboard"
        onClick={(e) => void handleCopyThinkingTrace(e, traceKey, steps, meta, interactionId, stopAtInteractionId)}
      >
        {isCopied ? <><Check size={12} strokeWidth={2} aria-hidden="true" /><span>Copied</span></> : <Bug size={12} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    )
  }

  const activeConvLabel = conversations.find((c) => c.id === activeConversationId)?.label
  const showThreadCopyBtn = messages.length > 0 || Boolean(liveActivitySteps && liveActivitySteps.length > 0)

  return (
    <aside className="dab-left-pane" ref={leftPaneRef}>
      {showThreadCopyBtn && (
        <div className="dab-left-pane-header" data-testid="left-pane-header">
          <span className="dab-left-pane-title" title={activeConvLabel || 'Conversation'}>{activeConvLabel || 'Conversation'}</span>
          <button
            type="button"
            data-testid="copy-thread-trace-btn"
            data-copied={copyThreadState === 'copied' ? 'true' : 'false'}
            data-loading={copyThreadState === 'loading' ? 'true' : 'false'}
            className="dab-btn dab-btn-secondary dab-thread-copy-btn"
            title="Copy full conversation & sandbox debug trace to clipboard"
            aria-label="Copy Thread"
            disabled={copyThreadState === 'loading'}
            onClick={() => void handleCopyThreadDebugTrace()}
          >
            {copyThreadState === 'loading' ? (
              <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
            ) : copyThreadState === 'copied' ? (
              <Check size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Bug size={13} strokeWidth={1.75} aria-hidden="true" />
            )}
            <span>{copyThreadState === 'loading' ? 'Copying…' : copyThreadState === 'copied' ? 'Copied' : 'Copy Thread'}</span>
          </button>
        </div>
      )}
      <div className="dab-chat-log" ref={chatLogRef}>
        {messages.length === 0 && (
          <div className="dab-empty-chat">
            <p><strong>{builderMode === 'dashboard' ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)' : `Ask ${agentName} to build, analyze, or automate across Looker`}</strong></p>
            <p className="dab-muted">
              {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
            </p>
            <StarterPromptButtons useCase={selectedUseCase} prompts={starterPrompts} loading={starterPromptsLoading} onSelect={setPrompt} disabled={!!busyStatus} />
          </div>
        )}

        {messages.map((m, idx) => {
          const prevUserMsg = idx > 0 && messages[idx - 1]?.role === 'user' ? messages[idx - 1]?.text : undefined
          const hasSteps = Boolean(m.activitySteps && m.activitySteps.length > 0)
          const prevAssistantInteractionId =
            !hasSteps && m.interactionId
              ? messages.slice(0, idx).reverse().find((pm) => pm.role === 'assistant' && pm.interactionId)?.interactionId
              : undefined
          const isHydratingTurn = Boolean(!hasSteps && m.interactionId && hydratingInteractionIds?.[m.interactionId])
          const isUserCopied = copiedTraceKey === `user_${idx}`
          return (
            <div
              key={idx}
              className={`dab-msg dab-msg-${m.role}`}
              onContextMenu={m.role === 'user' ? (e) => { if (longPressFiredRef.current || longPressUserMsgIdx === idx) e.preventDefault() } : undefined}
              onTouchStart={m.role === 'user' ? (e) => {
                if ((e.target as HTMLElement | null)?.closest?.('[data-testid^="user-msg-longpress-menu-"]')) return
                clearLongPress(); longPressFiredRef.current = false
                const pt = e.touches?.[0]
                touchStartPosRef.current = pt ? { x: pt.clientX, y: pt.clientY } : { x: 0, y: 0 }
                longPressTimerRef.current = setTimeout(() => { longPressTimerRef.current = null; longPressFiredRef.current = true; setLongPressUserMsgIdx(idx) }, 450)
              } : undefined}
              onTouchMove={m.role === 'user' ? (e) => {
                const pt = e.touches?.[0]
                if (longPressTimerRef.current && touchStartPosRef.current && pt && Math.hypot(pt.clientX - touchStartPosRef.current.x, pt.clientY - touchStartPosRef.current.y) > 10) clearLongPress()
              } : undefined}
              onTouchEnd={m.role === 'user' ? (e) => {
                clearLongPress()
                if (longPressFiredRef.current) { e.preventDefault(); setTimeout(() => { longPressFiredRef.current = false }, 350) }
              } : undefined}
              onTouchCancel={m.role === 'user' ? () => { clearLongPress(); longPressFiredRef.current = false } : undefined}
            >
              <div className="dab-msg-header">
                <span data-testid={m.role === 'assistant' ? 'chat-msg-agent-author' : undefined}>
                  {m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : agentName}
                </span>
                {m.role === 'user' && (
                  <button
                    type="button"
                    data-testid={`copy-user-msg-btn-${idx}`}
                    data-copied={isUserCopied ? 'true' : 'false'}
                    className="dab-user-msg-copy-btn"
                    title={isUserCopied ? 'Copied!' : 'Copy message'}
                    aria-label="Copy message"
                    onClick={(e) => { e.stopPropagation(); handleCopyUserMsg(idx, m.text) }}
                  >
                    {isUserCopied ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Copy size={13} strokeWidth={1.75} aria-hidden="true" />}
                  </button>
                )}
                {m.dashboardId && (
                  <button type="button" className="dab-msg-pill" onClick={() => { setActiveViewerDocument?.(null); setRightPaneCollapsed(false) }}>
                    Dashboard #{m.dashboardId}{typeof m.widgetCount === 'number' ? ` · ${m.widgetCount} queries` : ''}
                  </button>
                )}
              </div>
              {m.role === 'user' && longPressUserMsgIdx === idx && (
                <div data-testid={`user-msg-longpress-menu-${idx}`} role="menu" aria-label="Message actions" className="dab-user-msg-longpress-menu">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`user-msg-longpress-copy-${idx}`}
                    className="dab-composer-add-item"
                    onClick={(e) => { e.stopPropagation(); handleCopyUserMsg(idx, m.text) }}
                  >
                    <Copy size={13} strokeWidth={1.75} aria-hidden="true" /><span>Copy message</span>
                  </button>
                </div>
              )}
              {m.role === 'assistant' && (hasSteps || Boolean(m.interactionId)) && (
                <details
                  className="dab-thinking-block"
                  data-testid="completed-thinking-block"
                  onToggle={(e) => {
                    if ((e.currentTarget as HTMLDetailsElement).open && !hasSteps && m.interactionId) {
                      void hydrateMessageActivitySteps?.(m.interactionId, prevAssistantInteractionId)
                    }
                  }}
                >
                  <summary className="dab-thinking-summary">
                    <span className="dab-thinking-summary-label">
                      {hasSteps
                        ? `Thought for ${m.thinkingDurationSec ?? 1}s · ${m.activitySteps!.length} ${m.activitySteps!.length === 1 ? 'step' : 'steps'}`
                        : typeof m.thinkingDurationSec === 'number'
                        ? `Thought for ${m.thinkingDurationSec}s · Thinking & Activity`
                        : 'Thinking & Activity'}
                    </span>
                    {renderCopyTraceBtn(
                      `completed_${idx}`,
                      m.activitySteps || [],
                      { thinkingDurationSec: m.thinkingDurationSec ?? 1, userPrompt: prevUserMsg, assistantText: m.text },
                      m.interactionId,
                      prevAssistantInteractionId
                    )}
                  </summary>
                  {hasSteps ? (
                    <ThinkingStepsList steps={m.activitySteps!} contentCtx={contentCtx} />
                  ) : isHydratingTurn ? (
                    <div className="dab-thinking-step-loading" data-testid="thinking-hydration-loading">
                      <StudioSkeleton width="100%" height={28} />
                      <StudioSkeleton width="78%" height={24} />
                    </div>
                  ) : (
                    <div className="dab-thinking-steps"><span className="dab-muted">No recorded activity steps.</span></div>
                  )}
                </details>
              )}
              <div className="dab-msg-body">
                <StudioMarkdown
                  text={m.text} hostUrl={hostUrl} extensionSDK={extensionSDK}
                  onOpenContentInViewer={handleOpenContentLinkInViewer}
                  onOpenSandboxMarkdownFile={(p) => {
                    const normalized = normalizeSandboxFilePath(p)
                    setActiveSandboxMarkdownModalPath(normalized ? `/${normalized}` : p)
                    void openViewerDocument?.({ path: p })
                  }}
                  onInspectConnections={() => {
                    if (ctl.capabilities?.isAdmin) void openOrCopyMarkdownLink('/admin/connections', hostUrl, extensionSDK)
                    void fetchAvailableLookerConnectionsMarkdown(ctl.core40SDK).then((md) => {
                      ctl.setMessages((prev) => [...prev, { role: 'assistant', text: md }])
                    })
                  }}
                />
              </div>
              {m.images && m.images.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {m.images.map((src, i) => <img key={i} src={src} alt="Attached screenshot" style={{ maxHeight: 80, borderRadius: 4, border: '1px solid #cbd5e1' }} />)}
                </div>
              )}
              {m.role === 'assistant' && m.crudItems && m.crudItems.length > 0 && (
                <div className="dab-chat-object-chips dab-turn-crud-chips" data-testid="chat-object-viewer-chips">
                  {m.crudItems.map((item) => {
                    const isDeleted = item.action === 'deleted' || deletedCrudKeys.has(item.key)
                    return (
                      <button
                        key={`${item.key}:${item.action}`}
                        type="button"
                        disabled={isDeleted}
                        data-testid={`chat-object-viewer-chip-${item.key}`}
                        data-crud-action={item.action}
                        className={`dab-msg-pill dab-chat-object-chip ${!isDeleted && item.key === activeContentTabKey ? 'active' : ''} ${item.action === 'deleted' ? 'deleted' : ''}`}
                        onClick={() => {
                          if (isDeleted) return
                          setActiveViewerDocument?.(null); setRightPaneCollapsed(false)
                          const k = contentItems.some((c) => c.key === item.key)
                            ? item.key
                            : ctl.upsertContentItem({ id: item.id, contentType: item.contentType, title: item.title, embedPath: item.embedPath, hidden: false }, true).key
                          handleSelectContentTab?.(k)
                        }}
                      >
                        {renderContentTabIcon(item.contentType)}
                        <span>{item.title}</span>
                        <span className="dab-crud-action-label">{item.action}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {liveActivitySteps && liveActivitySteps.length > 0 && (
          <details className="dab-thinking-block dab-thinking-live" data-testid="live-thinking-block" open>
            <summary className="dab-thinking-summary">
              <span className="dab-spinner" />
              <span className="dab-thinking-summary-label">
                Thinking &amp; Activity · {liveActivitySteps[liveActivitySteps.length - 1]?.title || busyStatus || 'Working...'}
              </span>
              <span className="dab-thinking-step-count">{liveActivitySteps.length} {liveActivitySteps.length === 1 ? 'step' : 'steps'}</span>
              {renderCopyTraceBtn('live', liveActivitySteps)}
            </summary>
            <ThinkingStepsList steps={liveActivitySteps} contentCtx={contentCtx} />
          </details>
        )}

        {busyStatus && (!liveActivitySteps || liveActivitySteps.length === 0) && (
          <div className="dab-status-banner"><span className="dab-spinner" /><span>{busyStatus}</span></div>
        )}
      </div>

      {pendingPerm && (
        <div className="dab-permission-bar">
          <div>
            <strong>Approve Looker State Mutation?</strong> <code>{pendingPerm.req.operation}</code> (<code>{pendingPerm.req.httpMethod} {pendingPerm.req.path}</code>)
            {pendingPerm.req.thought && <div className="dab-permission-thought" data-testid="permission-request-thought">{pendingPerm.req.thought}</div>}
          </div>
          <div className="dab-permission-actions">
            <button type="button" className="dab-btn-primary" onClick={() => resolvePermDecision('allow_once')}>Allow once</button>
            <button type="button" className="dab-btn-secondary" onClick={() => resolvePermDecision('allow_op')}>Allow all &apos;{pendingPerm.req.operation}&apos; this turn</button>
            <button type="button" className="dab-btn-secondary" onClick={() => resolvePermDecision('allow_all')}>Allow all mutations this turn</button>
            <button type="button" className="dab-btn-secondary" onClick={() => resolvePermDecision('deny')}>Deny</button>
          </div>
        </div>
      )}

      <StudioComposer ctl={ctl} />
      <SandboxMarkdownPreviewModal ctl={ctl} />
      {!rightPaneCollapsed && (
        <div
          data-testid="workspace-split-resizer" role="separator" aria-orientation="vertical" aria-label="Resize chat and viewer panes"
          aria-valuenow={leftPaneWidth} aria-valuemin={MIN_LEFT_PANE_WIDTH} aria-valuemax={MAX_LEFT_PANE_WIDTH} tabIndex={0}
          className={`dab-split-resizer ${isResizingSplit ? 'active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const startWidth = leftPaneRef.current?.getBoundingClientRect().width || leftPaneWidth
            setIsResizingSplit(true)
            const onMove = (ev: MouseEvent) => setLeftPaneWidth(startWidth + (ev.clientX - startX))
            const onUp = () => {
              setIsResizingSplit(false)
              flushLeftPaneWidthSave?.()
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); setLeftPaneWidth((w) => w - 16) }
            else if (e.key === 'ArrowRight') { e.preventDefault(); setLeftPaneWidth((w) => w + 16) }
          }}
        />
      )}
    </aside>
  )
}

export function openContentLinkTargetInViewer(ctl: StudioController, target: InViewerLookerLinkTarget): void {
  ctl.setActiveViewerDocument?.(null)
  ctl.setRightPaneCollapsed(false)
  const dashGroup = ['dashboard', 'lookml_dashboard', 'data_app', 'data-investigator']
  const existing = (ctl.contentItems || []).find(
    (it) =>
      it.id === target.id &&
      (it.contentType === target.contentType || (dashGroup.includes(target.contentType) && dashGroup.includes(it.contentType)))
  )
  const ct = existing ? existing.contentType : target.contentType
  const upserted = ctl.upsertContentItem(
    Object.assign({}, existing, {
      id: target.id,
      contentType: ct,
      title: target.title || existing?.title,
      embedPath: existing?.embedPath || target.embedPath,
      dashboardId: ct === 'dashboard' ? target.id : existing?.dashboardId,
      lookmlDashboardId: ct === 'lookml_dashboard' ? target.id : existing?.lookmlDashboardId,
      lookId: ct === 'look' ? target.id : existing?.lookId,
      exploreId: ct === 'explore' ? target.id : existing?.exploreId,
      hidden: false,
    }),
    true
  )
  ctl.handleSelectContentTab?.(upserted.key)
}

export function renderContentTabIcon(contentType: StudioContentItemType): React.ReactNode {
  switch (contentType) {
    case 'look': return <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'explore': return <Database size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'data_app':
    case 'data-investigator': return <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'board': return <Kanban size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'conversational-analytics': return <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'lookml':
    case 'extension': return <Code2 size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'script': return <Terminal size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'report': return <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
    default: return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  }
}

const CONTENT_TYPE_LABELS: Partial<Record<StudioContentItemType, string>> = {
  lookml_dashboard: 'LookML Dashboard', data_app: 'Data App', 'data-investigator': 'Data Investigator',
  lookml: 'LookML Project', script: 'Python Script', report: 'Health Check Report', 'conversational-analytics': 'Conversational Analytics',
}
export const formatContentTypeLabel = (ct: StudioContentItemType): string => CONTENT_TYPE_LABELS[ct] || ct.charAt(0).toUpperCase() + ct.slice(1)
const resolveContentLookerPath = (ct: StudioContentItemType, id?: string, embedPath?: string): string =>
  ct === 'lookml' ? (id ? `/projects/${encodeURIComponent(id)}` : '') : ct !== 'script' && ct !== 'report' && embedPath ? embedPath.replace(/^\/embed/, '') : ''

export type LkrCodeModeApiCallLike = Partial<LkrCodeModeApiCallEntry> & Pick<LkrCodeModeApiCallEntry, 'method' | 'route'>
export interface OverviewReviewSummary {
  kind: 'permission' | 'lookml' | 'files'; title: string; subtitle: string; badgeText: string; badgeTone: StudioBadgeTone
}
export interface OverviewContentRow {
  key: string; id: string; title: string; contentType: StudioContentItemType; typeLabel: string; shortTag: string; hidden: boolean; openInLookerPath: string
}
export interface OverviewFileRow {
  key: string; path: string; label: string; kind: 'lookml' | 'app' | 'script' | 'sandbox'; action?: 'created' | 'updated' | 'deleted'; content?: string
}
export interface OverviewSkillRow { id: string; label: string; path: string }
export interface OverviewApiCallRow {
  id: string; method: string; route: string; status: number | null; ok: boolean; durationMs?: number; source: 'window' | 'turn'
}
export interface OverviewLinkRow { href: string; label: string; inViewerTarget: InViewerLookerLinkTarget | null; isSandboxMd: boolean }
export interface DeriveOverviewInput {
  messages: ReadonlyArray<ChatMessage>; liveActivitySteps?: ReadonlyArray<AntigravityActivityStep>; contentItems?: ReadonlyArray<StudioContentItem>
  publishedApp?: PublishedAppState | null; nativeContent?: NativeContentState | null; lookmlBundle?: LookmlBundle | null
  healthReport?: HealthCheckReportPayload | null; caConversation?: CaConversationState | null; loadedScript?: boolean
  scriptId?: string; scriptTitle?: string; scriptCode?: string; savedScheduleBadge?: string | null; currentAppCode?: string
  activatedLookmlSkills?: ReadonlyArray<string>; selectedExplores?: ReadonlyArray<string>; mentionedItems?: ReadonlyArray<StudioContextMention>
  selectedFolderId?: string; selectedFolderLabel?: string; pastedImages?: ReadonlyArray<{ name?: string; mimeType?: string }>
  pendingPerm?: { req: { operation: string; httpMethod: string; path: string } } | null; windowApiCalls?: ReadonlyArray<LkrCodeModeApiCallLike>; hostUrl?: string
}

const INTERNAL_SANDBOX_FILE_RE = /^(?:\/?workspace\/)?(?:\.lkr_extension_cache\/|\.uv_tools\/|\.uv_python\/|(?:\.agents\/)?skills\/|AGENTS\.md$|DATA_APP_GUIDE\.md$|DATA_INVESTIGATOR_GUIDE\.md$|bootstrap_lookml\.py$|bundle_app\.py$|sitecustomize\.py$)/i
const HOUSEKEEPING_API_RE = /\/artifacts(?:\/|$|\?)/i
const ENDPOINT_LOG_RE = /^(?:#\s*)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s(]*)(?:\s*(\[ERR(?:\s+(\d{3}))?\]))?(?:\s*\((\d+)ms\))?/gim
const MD_LINK_SCAN_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g
const BARE_URL_SCAN_RE = /\bhttps?:\/\/[^\s<>)"'`]+/gi
const CODE_SPAN_STRIP_RE = /```[\s\S]*?```|`[^`\n]+`/g
const WORKSPACE_TOKEN_RE = /\/workspace\/[A-Za-z0-9_./-]+\.(?:md|py|sql|json|csv)\b/g
const SHORT_CONTENT_TAGS: Partial<Record<StudioContentItemType, string>> = {
  dashboard: 'UDD', lookml_dashboard: 'LookML Dash', data_app: 'Data App', 'data-investigator': 'Investigation',
  look: 'Look', explore: 'Explore', board: 'Board', lookml: 'LookML', script: 'Script', report: 'Health Check', 'conversational-analytics': 'CA',
}
const CUSTOMIZE_SECTION_DEFS = [
  ['content', 'Content'], ['files', 'Changed Files'], ['api', 'API Calls'],
  ['skills', 'Skills Used'], ['context', 'Data Context'], ['links', 'Links'], ['uploads', 'Uploads'],
] as const

export function deriveConversationOverviewData(input: DeriveOverviewInput) {
  const msgs = input.messages || [], live = input.liveActivitySteps || [], items = input.contentItems || []
  const lk = input.lookmlBundle, hr = input.healthReport, ca = input.caConversation, pub = input.publishedApp, nat = input.nativeContent
  const appCode = input.currentAppCode || '', scCode = input.scriptCode || '', host = input.hostUrl || ''
  const allSteps = msgs.reduce<AntigravityActivityStep[]>((acc, m) => (m.activitySteps?.length ? acc.concat(m.activitySteps) : acc), []).concat(live)

  const reviewItems: OverviewReviewSummary[] = []
  if (input.pendingPerm?.req) {
    const rq = input.pendingPerm.req
    reviewItems.push({ kind: 'permission', title: rq.operation, subtitle: `${rq.httpMethod} ${rq.path}`, badgeText: '1 pending', badgeTone: 'warning' })
  }
  if (lk) {
    const val = lk.validation, ok = val ? val.passed : true, errN = (val ? val.errors?.length || val.error_count || 0 : 0) || 1
    const tests = lk.tests || [], passed = tests.filter((t) => t.success).length, par = lk.queries?.length || 0
    reviewItems.push({
      kind: 'lookml', title: `LookML: ${lk.project_id || lk.title || 'Project'}`,
      subtitle: [`${lk.files?.length || 0} .lkml`, tests.length ? `${passed}/${tests.length} tests` : '', par ? `${par} parity` : ''].filter(Boolean).join(' · '),
      badgeText: ok ? 'LookML valid' : `${errN} ${errN === 1 ? 'error' : 'errors'}`, badgeTone: ok ? 'success' : 'danger',
    })
  }

  const contentRows: OverviewContentRow[] = []
  const pushRow = (r: OverviewContentRow) => { if (!contentRows.some((x) => x.key === r.key)) contentRows.push(r) }
  items.forEach((it) => pushRow({
    key: it.key, id: it.id, title: it.title, contentType: it.contentType, typeLabel: formatContentTypeLabel(it.contentType),
    shortTag: SHORT_CONTENT_TAGS[it.contentType] || formatContentTypeLabel(it.contentType), hidden: Boolean(it.hidden),
    openInLookerPath: resolveContentLookerPath(it.contentType, it.projectId || it.id, it.embedPath),
  }))
  if (!contentRows.length) {
    if (pub?.dashboardId) pushRow({ key: `data_app:${pub.dashboardId}`, id: String(pub.dashboardId), title: pub.title, contentType: 'data_app', typeLabel: 'Data App', shortTag: 'Data App', hidden: false, openInLookerPath: `/dashboards/${encodeURIComponent(String(pub.dashboardId))}` })
    if (nat?.id) pushRow({ key: `${nat.contentType}:${nat.id}`, id: String(nat.id), title: nat.title, contentType: nat.contentType, typeLabel: formatContentTypeLabel(nat.contentType), shortTag: SHORT_CONTENT_TAGS[nat.contentType] || 'Content', hidden: false, openInLookerPath: resolveContentLookerPath(nat.contentType, nat.id, nat.embedPath) })
    if (lk?.id) { const pid = lk.project_id || lk.id; pushRow({ key: `lookml:${pid}`, id: pid, title: lk.title || pid, contentType: 'lookml', typeLabel: 'LookML Project', shortTag: 'LookML', hidden: false, openInLookerPath: `/projects/${encodeURIComponent(pid)}` }) }
    if (hr?.id) pushRow({ key: `report:${hr.id}`, id: hr.id, title: hr.title || 'Health Check Report', contentType: 'report', typeLabel: 'Health Check Report', shortTag: 'Health Check', hidden: false, openInLookerPath: '' })
    if (ca?.caConversationId) pushRow({ key: `conversational-analytics:${ca.caConversationId}`, id: ca.caConversationId, title: ca.title || ca.agentName || 'Conversational Analytics', contentType: 'conversational-analytics', typeLabel: 'Conversational Analytics', shortTag: 'CA', hidden: false, openInLookerPath: resolveContentLookerPath('conversational-analytics', ca.caConversationId, ca.embedPath) })
    if (input.loadedScript && input.scriptId) pushRow({ key: `script:${input.scriptId}`, id: input.scriptId, title: input.scriptTitle || input.scriptId, contentType: 'script', typeLabel: input.savedScheduleBadge ? `Script (${input.savedScheduleBadge})` : 'Python Script', shortTag: input.savedScheduleBadge ? 'Scheduled' : 'Script', hidden: false, openInLookerPath: '' })
  }

  const changedFiles: OverviewFileRow[] = [], seenFiles = new Set<string>()
  const pushFile = (r: OverviewFileRow) => {
    if (r.path.includes('..')) return
    const n = normalizeSandboxFilePath(r.path) || r.path.replace(/^\/+/, '')
    if (n && !seenFiles.has(n)) { seenFiles.add(n); changedFiles.push(r) }
  }
  lk?.files?.forEach((f) => pushFile({ key: `lookml:${f.path}`, path: f.path, label: f.path, kind: 'lookml', action: f.action || 'updated', content: f.content || f.diff }))
  if (appCode.trim()) pushFile({ key: 'app:apps/current/app.js', path: '/workspace/apps/current/app.js', label: 'apps/current/app.js', kind: 'app', action: 'updated', content: appCode })
  if ((input.loadedScript || contentRows.some((c) => c.contentType === 'script')) && scCode.trim()) {
    const fn = `${input.scriptId || 'script'}.py`; pushFile({ key: `script:${fn}`, path: `/workspace/scripts/${fn}`, label: `scripts/${fn}`, kind: 'script', action: 'updated', content: scCode })
  }
  allSteps.forEach((st) => {
    if (st.kind !== 'file' || /^Viewing\b/i.test(String(st.title || '').trim())) return
    const cand = extractStepFilePath(st)
    if (!cand || cand.includes('..') || INTERNAL_SANDBOX_FILE_RE.test(cand)) return
    const norm = normalizeSandboxFilePath(cand), disp = norm ? `/${norm}` : cand
    pushFile({ key: `sandbox:${disp}`, path: disp, label: disp.replace(/^\/workspace\//, ''), kind: 'sandbox', content: st.content })
  })
  msgs.forEach((m) => { if (m.role === 'assistant' && m.text) (m.text.match(WORKSPACE_TOKEN_RE) || []).forEach((tok) => { if (!tok.includes('..') && !INTERNAL_SANDBOX_FILE_RE.test(tok)) pushFile({ key: `sandbox:${tok}`, path: tok, label: tok.replace(/^\/workspace\//, ''), kind: 'sandbox' }) }) })
  if (!lk && changedFiles.length > 0) {
    reviewItems.push({
      kind: 'files', title: 'Changed Files', subtitle: changedFiles[0].label,
      badgeText: `${changedFiles.length} ${changedFiles.length === 1 ? 'file' : 'files'}`, badgeTone: 'neutral',
    })
  }

  const skillsUsed: OverviewSkillRow[] = [], seenSkills = new Set<string>()
  const addSkill = (raw: string) => {
    const c = String(raw || '').split('—')[0].replace(/^(?:Reading\s+skill|Skill:?)\s+/i, '').trim()
    if (!c) return
    const sm = c.match(/(?:^|\/)(?:sub-)?skills\/([^/\s]+)(?:\/SKILL\.md)?$/i)
    const id = (sm ? sm[1] : c.replace(/^\/+/, '').replace(/\/SKILL\.md$/i, '').split('/').pop() || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (id && !seenSkills.has(id)) { seenSkills.add(id); skillsUsed.push({ id, label: id, path: c.includes('/') ? c : `/workspace/skills/${id}/SKILL.md` }) }
  }
  ;(input.activatedLookmlSkills || []).forEach(addSkill)
  msgs.forEach((m) => { if (m.role === 'user' && m.text) extractSlashSkillIds(m.text).forEach(addSkill) })
  allSteps.forEach((st) => { if (st.kind === 'skill') addSkill(st.path || st.detail || st.title) })

  const apiCalls: OverviewApiCallRow[] = [], winCounts = new Map<string, number>(), stepCounts = new Map<string, number>()
  const normRoute = (r: string) => String(r || '').trim().replace(/^\/api\/4\.0(?=\/)/i, '').split('?')[0] || '/'
  ;(input.windowApiCalls || []).forEach((c, idx) => {
    const route = normRoute(c.route); if (!route || HOUSEKEEPING_API_RE.test(route)) return
    const method = String(c.method || 'GET').toUpperCase(), sig = `${method} ${route}`, resp = c.response
    winCounts.set(sig, (winCounts.get(sig) || 0) + 1)
    apiCalls.push({ id: `win_${idx}_${sig}`, method, route, status: resp ? resp.status : null, ok: resp ? Boolean(resp.ok) : true, durationMs: typeof c.duration_ms === 'number' ? Math.round(c.duration_ms) : undefined, source: 'window' })
  })
  allSteps.forEach((st, sIdx) => {
    if (st.kind !== 'codemode' && st.kind !== 'cli_bridge') return
    const hay = [st.content, st.detail, st.title].filter(Boolean).join('\n')
    ENDPOINT_LOG_RE.lastIndex = 0
    let m: RegExpExecArray | null, n = 0
    while ((m = ENDPOINT_LOG_RE.exec(hay)) !== null) {
      const method = m[1].toUpperCase(), route = normRoute(m[2]); if (HOUSEKEEPING_API_RE.test(route)) continue
      n += 1; const sig = `${method} ${route}`, sc = (stepCounts.get(sig) || 0) + 1; stepCounts.set(sig, sc)
      if (sc <= (winCounts.get(sig) || 0)) continue
      apiCalls.push({ id: `step_${sIdx}_${n}_${sig}`, method, route, status: m[4] ? Number(m[4]) : null, ok: !m[3], durationMs: m[5] ? Number(m[5]) : undefined, source: 'turn' })
    }
  })

  const links: OverviewLinkRow[] = [], seenHrefs = new Set<string>()
  const addLink = (rawHref: string, rawLabel?: string) => {
    const href = String(rawHref || '').trim().replace(/[.,;:)'"`]+$/, '')
    if (!href || seenHrefs.has(href)) return
    const isSandboxMd = isSandboxMarkdownPath(href)
    if (!isSandboxMd && !/^https?:\/\//i.test(href) && !/^\/(?!\/)/.test(href)) return
    seenHrefs.add(href)
    const inViewerTarget = !isSandboxMd ? parseInViewerLookerLink(href, rawLabel, host) : null
    links.push({ href, label: String(rawLabel || '').trim() || inViewerTarget?.title || href.replace(/^https?:\/\/[^/]+/i, '') || href, inViewerTarget, isSandboxMd })
  }
  msgs.forEach((m) => {
    if (m.role !== 'assistant' || !m.text) return
    const prose = m.text.replace(CODE_SPAN_STRIP_RE, ' ')
    MD_LINK_SCAN_RE.lastIndex = 0; let lm: RegExpExecArray | null
    while ((lm = MD_LINK_SCAN_RE.exec(prose)) !== null) addLink(lm[2], lm[1])
    const rest = prose.replace(MD_LINK_SCAN_RE, ' '); BARE_URL_SCAN_RE.lastIndex = 0; let um: RegExpExecArray | null
    while ((um = BARE_URL_SCAN_RE.exec(rest)) !== null) addLink(um[0])
  })
  lk?.queries?.forEach((q, i) => {
    const p = q.label || `Parity #${(q.query_index ?? i) + 1}`
    if (q.sql_runner_url || q.sql_slug) addLink(q.sql_runner_url || `/sql/${q.sql_slug}`, `${p} — SQL Runner`)
    if (q.explore_url || q.explore_slug) addLink(q.explore_url || `/x/${q.explore_slug}`, `${p} — Explore`)
  })

  const uploads: Array<{ key: string; label: string; sub: string }> = []
  let imgN = 0
  msgs.forEach((m, mi) => m.images?.forEach((_, ii) => { imgN += 1; uploads.push({ key: `m_${mi}_${ii}`, label: `Screenshot #${imgN}`, sub: `Turn ${Math.floor(mi / 2) + 1}` }) }))
  ;(input.pastedImages || []).forEach((im, i) => uploads.push({ key: `d_${i}`, label: im.name || `Draft image #${i + 1}`, sub: 'Draft' }))
  const explores = (input.selectedExplores || []).slice(), mentions = (input.mentionedItems || []).slice()
  const caAgentLabel = ca ? `${ca.agentName || 'CA Agent'}${ca.agentId ? ` (${ca.agentId})` : ''}` : undefined
  const contextCount = explores.length + mentions.length + (caAgentLabel ? 1 : 0) + (input.selectedFolderLabel ? 1 : 0)
  const totalItems = reviewItems.length + contentRows.length + changedFiles.length + apiCalls.length + skillsUsed.length + links.length + uploads.length

  return {
    reviewItems, primaryReview: reviewItems[0] || null, contentRows, changedFiles, apiCalls, skillsUsed, links,
    context: { explores, mentions, caAgentLabel, folderId: input.selectedFolderId || undefined, folderLabel: input.selectedFolderLabel || undefined, uploads, contextCount },
    totalItems,
  }
}

const OvSec: React.FC<{
  testId: string; title: string; count?: number; badge?: React.ReactNode
  open: boolean; onToggle: () => void; children: React.ReactNode
}> = ({ testId, title, count, badge, open, onToggle, children }) => (
  <div className="dab-ov-sec" data-testid={testId} data-collapsed={open ? 'false' : 'true'}>
    <button type="button" className="dab-ov-sec-btn" data-testid={`${testId}-toggle`} aria-expanded={open} onClick={onToggle}>
      <span className={`dab-ov-chev ${open ? '' : 'closed'}`}><ChevronDown size={13} strokeWidth={2} aria-hidden="true" /></span>
      <span className="dab-ov-sec-ttl">{title}</span>
      {count !== undefined && <span className="dab-ov-cnt">{count}</span>}
      {badge && <span className="dab-ov-sec-right">{badge}</span>}
    </button>
    {open && children}
  </div>
)

export const StudioOverviewSidebar: React.FC<{
  ctl: StudioController; allTabsHidden?: boolean; collapseToggleBtn?: React.ReactNode
  windowApiCalls?: ReadonlyArray<LkrCodeModeApiCallLike>
  openSecs?: Record<string, boolean>; setOpenSecs?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  showAll?: Record<string, boolean>; setShowAll?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  hiddenSecs?: Record<string, boolean | undefined>; setHiddenSecs?: React.Dispatch<React.SetStateAction<Record<string, boolean | undefined>>>
  onOpenContentLinkInViewer?: (target: InViewerLookerLinkTarget) => void
}> = ({
  ctl, allTabsHidden = false, collapseToggleBtn, windowApiCalls = [],
  openSecs: extOpenSecs, setOpenSecs: extSetOpenSecs, showAll: extShowAll, setShowAll: extSetShowAll,
  hiddenSecs: extHiddenSecs, setHiddenSecs: extSetHiddenSecs, onOpenContentLinkInViewer,
}) => {
  const {
    messages, liveActivitySteps, busyStatus, contentItems, publishedApp, nativeContent, lookmlBundle, healthReport,
    caConversation, loadedScript, scriptId, scriptTitle, scriptCode, savedScheduleBadge, currentAppCode,
    activatedLookmlSkills, selectedExplores, mentionedItems, selectedFolderId, folderTreeNodes, pastedImages,
    pendingPerm, extensionSDK, hydratingInteractionIds, hydrateMessageActivitySteps,
    handleSelectContentTab, setActiveContentTabKey, openViewerDocument, isAuthenticated,
  } = ctl
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  const selectedFolderLabel = folderTreeNodes?.[selectedFolderId]?.name || 'My folder'
  const [localShowAll, setLocalShowAll] = useState<Record<string, boolean>>({})
  const [localOpenSecs, setLocalOpenSecs] = useState<Record<string, boolean>>({ api: false })
  const [localHiddenSecs, setLocalHiddenSecs] = useState<Record<string, boolean | undefined>>({})
  const showAll = extShowAll || localShowAll, setShowAll = extSetShowAll || setLocalShowAll
  const openSecs = extOpenSecs || localOpenSecs, setOpenSecs = extSetOpenSecs || setLocalOpenSecs
  const hiddenSecs = extHiddenSecs || localHiddenSecs, setHiddenSecs = extSetHiddenSecs || setLocalHiddenSecs
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') return
    const onDown = (ev: MouseEvent) => { if (menuWrapRef.current && !menuWrapRef.current.contains(ev.target as Node)) setMenuOpen(false) }
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])
  useEffect(() => {
    if (!isAuthenticated || !hydrateMessageActivitySteps) return
    const idx = messages.findIndex((m) => m.role === 'assistant' && Boolean(m.interactionId) && !Array.isArray(m.activitySteps) && !hydratingInteractionIds?.[m.interactionId!])
    if (idx < 0) return
    const prev = messages.slice(0, idx).reverse().find((pm) => pm.role === 'assistant' && Boolean(pm.interactionId))
    void hydrateMessageActivitySteps(messages[idx].interactionId!, prev?.interactionId)
  }, [isAuthenticated, hydrateMessageActivitySteps, hydratingInteractionIds, messages])

  const windowCallsKey = `${windowApiCalls.length}:${windowApiCalls[0] ? `${windowApiCalls[0].method}:${windowApiCalls[0].route}` : ''}`

  const data = useMemo(() => deriveConversationOverviewData({
    messages, liveActivitySteps, contentItems, publishedApp, nativeContent, lookmlBundle, healthReport, caConversation,
    loadedScript, scriptId, scriptTitle, scriptCode, savedScheduleBadge, currentAppCode, activatedLookmlSkills,
    selectedExplores, mentionedItems, selectedFolderId, selectedFolderLabel, pastedImages, pendingPerm,
    windowApiCalls, hostUrl,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    messages, liveActivitySteps, contentItems, publishedApp, nativeContent, lookmlBundle, healthReport, caConversation,
    loadedScript, scriptId, scriptTitle, scriptCode, savedScheduleBadge, currentAppCode, activatedLookmlSkills,
    selectedExplores, mentionedItems, selectedFolderId, selectedFolderLabel, pastedImages, pendingPerm, windowCallsKey, hostUrl,
  ])

  const isHydratingAny = messages.some((m) => Boolean(m.interactionId && hydratingInteractionIds?.[m.interactionId]))
  const hasExplicitCtx = data.context.explores.length > 0 || data.context.mentions.length > 0 || Boolean(data.context.caAgentLabel)
  const isSecOpen = (k: string, defOpen = true) => (k in openSecs ? Boolean(openSecs[k]) : defOpen)
  const toggleSec = (k: string, defOpen = true) => setOpenSecs((p) => ({ ...p, [k]: !(k in p ? p[k] : defOpen) }))
  const scrollTo = (sel: string) => {
    const el = typeof document !== 'undefined' ? document.querySelector<HTMLElement>(sel) : null
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }
  const toggleAll = (k: string) => setShowAll((p) => ({ ...p, [k]: !p[k] }))
  const selectOrClearTab = (ctype?: StudioContentItemType, key?: string) => {
    const found = key ? contentItems.find((c) => c.key === key) : ctype ? contentItems.find((c) => c.contentType === ctype) : undefined
    if (found) handleSelectContentTab(found.key); else setActiveContentTabKey('')
  }
  const onReview = (it: OverviewReviewSummary | null) => {
    if (!it) return
    if (it.kind === 'permission') { scrollTo('.dab-permission-bar'); return }
    if (it.kind === 'lookml') { selectOrClearTab('lookml'); return }
    if (it.kind === 'files' && data.changedFiles[0]) {
      if (data.changedFiles.length === 1) onFile(data.changedFiles[0])
      else { setOpenSecs((p) => ({ ...p, files: true })); scrollTo('[data-testid="overview-section-files"]') }
    }
  }
  const onFile = (row: OverviewFileRow) => {
    if (row.kind === 'lookml') { selectOrClearTab('lookml'); return }
    void openViewerDocument({ path: row.path, title: row.label, kind: 'file', content: row.content })
  }

  const visContent = showAll.content ? data.contentRows : data.contentRows.slice(0, 4)
  const visFiles = showAll.files ? data.changedFiles : data.changedFiles.slice(0, 3)
  const visCalls = showAll.api ? data.apiCalls : data.apiCalls.slice(0, 5)
  const visLinks = showAll.links ? data.links : data.links.slice(0, 3)
  const showCtxSec = hiddenSecs.context !== undefined ? !hiddenSecs.context : hasExplicitCtx

  const failedApiCount = data.apiCalls.filter((c) => !c.ok).length
  const apiSummary = useMemo(() => {
    if (data.apiCalls.length < 6) return ''
    const byMethod: Record<string, number> = {}
    let totalMs = 0
    data.apiCalls.forEach((c) => {
      byMethod[c.method] = (byMethod[c.method] || 0) + 1
      if (c.durationMs) totalMs += c.durationMs
    })
    const parts = Object.keys(byMethod).map((m) => `${byMethod[m]} ${m}`)
    if (failedApiCount > 0) parts.push(`${failedApiCount} failed`)
    if (totalMs > 0) parts.push(totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`)
    return parts.join(' · ')
  }, [data.apiCalls, failedApiCount])

  return (
    <div className="dab-ov" data-testid="studio-overview-sidebar" role="region" aria-label="Conversation overview">
      <div className="dab-ov-card">
        <div className="dab-ov-head" data-testid="overview-header">
          <span className="dab-ov-title">
            Overview
            {(busyStatus || isHydratingAny) && <Loader2 size={12} strokeWidth={2} className="dab-spin" style={{ color: 'var(--dab-accent)' }} aria-hidden="true" />}
          </span>
          <div className="dab-ov-acts" ref={menuWrapRef}>
            <button
              type="button" data-testid="overview-customize-btn" className="dab-ov-icon-btn"
              aria-label="Customize Sections" title="Customize Sections" aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreVertical size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {collapseToggleBtn}
            {menuOpen && (
              <div className="dab-ov-menu" data-testid="overview-customize-menu" role="menu" aria-label="Customize Sections">
                <div className="dab-ov-menu-lbl">Customize Sections</div>
                {CUSTOMIZE_SECTION_DEFS.map(([k, lbl]) => {
                  const enabled = k === 'context' ? showCtxSec : !hiddenSecs[k]
                  return (
                    <button
                      key={k} type="button" role="menuitemcheckbox" aria-checked={enabled}
                      data-testid={`overview-customize-item-${k}`} className="dab-ov-menu-it"
                      onClick={() => {
                        setHiddenSecs((p) => ({ ...p, [k]: enabled }))
                        if (k === 'context' && !enabled) setOpenSecs((p) => ({ ...p, context: true }))
                      }}
                    >
                      <span>{lbl}</span>
                      {enabled && <Check size={13} strokeWidth={2} aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <div className="dab-ov-scroll">
          <nav className="dab-ov-nav" data-testid="overview-top-nav" aria-label="Overview navigation">
            <button type="button" data-testid="overview-nav-review" className="dab-ov-row" disabled={!data.primaryReview} onClick={() => onReview(data.primaryReview)}>
              <span className="dab-ov-ic">{data.primaryReview?.kind === 'permission' ? <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" /> : <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />}</span>
              <span className="dab-ov-txt">Review</span>
              {data.primaryReview && <StudioBadge tone={data.primaryReview.badgeTone}>{data.primaryReview.badgeText}</StudioBadge>}
            </button>
          </nav>

          {busyStatus && (
            <div className="dab-ov-sec" data-testid="overview-busy-status">
              <div className="dab-ov-sec-hd"><span className="dab-ov-sec-ttl">Active Step</span></div>
              <div className="dab-ov-row dab-ov-static" role="status" aria-live="polite">
                <span className="dab-ov-ic" style={{ color: 'var(--dab-accent)' }}><Sparkles size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="dab-ov-txt">{busyStatus}</span>
              </div>
            </div>
          )}

          {allTabsHidden && (
            <div className="dab-ov-sec" data-testid="studio-content-tabs-all-hidden">
              <div className="dab-ov-note">No active tab selected — pick any item below to open in Viewer.</div>
            </div>
          )}

          {!hiddenSecs.content && data.contentRows.length > 0 && (
            <OvSec testId="overview-section-content" title="Content" count={data.contentRows.length} open={isSecOpen('content', true)} onToggle={() => toggleSec('content', true)}>
              {visContent.map((row) => (
                <div key={row.key} className="dab-ov-grp">
                  <button type="button" data-testid={`overview-content-item-${row.key}`} className="dab-ov-row" onClick={() => selectOrClearTab(undefined, row.key)} title={`${row.title} (${row.typeLabel})`}>
                    <span className="dab-ov-ic">{renderContentTabIcon(row.contentType)}</span>
                    <span className="dab-ov-txt">{row.title}</span>
                    <span className="dab-ov-meta">{row.hidden ? 'Hidden' : row.shortTag}</span>
                  </button>
                  {row.openInLookerPath && (
                    <button type="button" data-testid={`overview-content-external-${row.key}`} className="dab-ov-icon-btn" title="Open in Looker" aria-label={`Open ${row.title} in Looker`} onClick={(e) => { e.stopPropagation(); void openOrCopyMarkdownLink(row.openInLookerPath, hostUrl, extensionSDK) }}>
                      <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
              {data.contentRows.length > 4 && <button type="button" className="dab-ov-more" onClick={() => toggleAll('content')}>{showAll.content ? 'Show fewer' : `See all (${data.contentRows.length})`}</button>}
            </OvSec>
          )}

          {!hiddenSecs.files && data.changedFiles.length > 0 && (
            <OvSec testId="overview-section-files" title="Changed Files" count={data.changedFiles.length} open={isSecOpen('files', true)} onToggle={() => toggleSec('files', true)}>
              {visFiles.map((row, idx) => (
                <button key={row.key} type="button" data-testid={`overview-file-item-${idx}`} className="dab-ov-row" onClick={() => onFile(row)} title={row.path}>
                  <span className="dab-ov-ic">{row.kind === 'sandbox' && /\.md$/i.test(row.path) ? <FileText size={13} strokeWidth={1.75} aria-hidden="true" /> : <Code2 size={13} strokeWidth={1.75} aria-hidden="true" />}</span>
                  <span className="dab-ov-txt dab-ov-mono">{row.label}</span>
                  {row.action && <span className="dab-ov-stat" style={{ color: row.action === 'created' ? 'var(--dab-success-text)' : row.action === 'deleted' ? 'var(--dab-danger-text)' : 'var(--dab-accent-text)' }}>{row.action === 'created' ? '+' : row.action === 'deleted' ? '-' : 'M'}</span>}
                </button>
              ))}
              {data.changedFiles.length > 3 && <button type="button" className="dab-ov-more" onClick={() => toggleAll('files')}>{showAll.files ? 'Show fewer' : `See all (${data.changedFiles.length})`}</button>}
            </OvSec>
          )}

          {!hiddenSecs.api && data.apiCalls.length > 0 && (
            <OvSec
              testId="overview-section-api-calls"
              title="API Calls"
              count={data.apiCalls.length}
              badge={failedApiCount > 0 ? <StudioBadge tone="danger">{`${failedApiCount} err`}</StudioBadge> : undefined}
              open={isSecOpen('api', false)}
              onToggle={() => toggleSec('api', false)}
            >
              {apiSummary && <div className="dab-ov-api-sum" data-testid="overview-api-summary">{apiSummary}</div>}
              <div className={showAll.api ? 'dab-ov-api-scroll' : undefined} data-testid={showAll.api ? 'overview-api-scroll' : undefined}>
                {visCalls.map((call, idx) => (
                  <div key={call.id} data-testid={`overview-api-call-${idx}`} className={`dab-ov-row dab-ov-static ${!call.ok ? 'dab-ov-err' : ''}`} title={`${call.method} ${call.route}${call.status ? ` (${call.status})` : ''}`}>
                    <span className={`dab-ov-mth dab-ov-mth-${call.ok ? call.method.toLowerCase() : 'err'}`}>{call.method}</span>
                    <span className="dab-ov-txt dab-ov-mono">{call.route}</span>
                    <span className="dab-ov-meta">{call.status && call.status >= 400 ? `${call.status}` : call.durationMs !== undefined ? `${call.durationMs}ms` : call.status ? `${call.status}` : ''}</span>
                  </div>
                ))}
              </div>
              {data.apiCalls.length > 5 && <button type="button" data-testid="overview-api-calls-toggle-all" className="dab-ov-more" onClick={() => toggleAll('api')}>{showAll.api ? 'Show fewer' : `See all (${data.apiCalls.length})`}</button>}
            </OvSec>
          )}

          {!hiddenSecs.skills && data.skillsUsed.length > 0 && (
            <OvSec testId="overview-section-skills" title="Skills Used" count={data.skillsUsed.length} open={isSecOpen('skills', true)} onToggle={() => toggleSec('skills', true)}>
              {data.skillsUsed.map((sk) => (
                <button key={sk.id} type="button" data-testid={`overview-skill-item-${sk.id}`} className="dab-ov-row" onClick={() => void openViewerDocument({ path: sk.path, title: sk.label, kind: 'skill' })} title={sk.path}>
                  <span className="dab-ov-ic"><BookOpen size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="dab-ov-txt dab-ov-mono">{sk.label}</span>
                </button>
              ))}
            </OvSec>
          )}

          {showCtxSec && (
            <OvSec testId="overview-section-context" title="Data Context" count={data.context.contextCount} open={isSecOpen('context', hasExplicitCtx)} onToggle={() => toggleSec('context', hasExplicitCtx)}>
              {data.context.explores.map((exp) => {
                const parts = exp.split('::')
                const tgt = parts[0] && parts[1] ? parseInViewerLookerLink(`/explore/${parts[0]}/${parts[1]}`, exp, hostUrl) : null
                return (
                  <button key={exp} type="button" data-testid={`overview-explore-${exp}`} className="dab-ov-row" onClick={() => { if (tgt && onOpenContentLinkInViewer) onOpenContentLinkInViewer(tgt) }} title={`Explore ${exp}`}>
                    <span className="dab-ov-ic"><Database size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                    <span className="dab-ov-txt dab-ov-mono">{exp}</span>
                  </button>
                )
              })}
              {data.context.mentions.map((m) => (
                <div key={`${m.type}:${m.id}`} className="dab-ov-row dab-ov-static" title={`${m.type}: ${m.title}`}>
                  <span className="dab-ov-ic"><AtSign size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="dab-ov-txt">{m.title}</span>
                  <span className="dab-ov-meta">{m.type}</span>
                </div>
              ))}
              {data.context.caAgentLabel && (
                <div className="dab-ov-row dab-ov-static" title={data.context.caAgentLabel}>
                  <span className="dab-ov-ic"><MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="dab-ov-txt">{data.context.caAgentLabel}</span>
                </div>
              )}
              {data.context.folderLabel && (
                <button type="button" data-testid="overview-target-folder-btn" className="dab-ov-row" onClick={() => { if (data.context.folderId) void openOrCopyMarkdownLink(`/folders/${encodeURIComponent(data.context.folderId)}`, hostUrl, extensionSDK) }}>
                  <span className="dab-ov-ic"><Folder size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="dab-ov-txt">{data.context.folderLabel}</span>
                  <span className="dab-ov-meta">Folder</span>
                </button>
              )}
            </OvSec>
          )}

          {!hiddenSecs.links && data.links.length > 0 && (
            <OvSec testId="overview-section-links" title="Links" count={data.links.length} open={isSecOpen('links', true)} onToggle={() => toggleSec('links', true)}>
              {visLinks.map((lnk, idx) => (
                <div key={lnk.href} className="dab-ov-grp">
                  <button
                    type="button" data-testid={`overview-link-item-${idx}`} className="dab-ov-row" title={lnk.href}
                    onClick={() => {
                      if (lnk.inViewerTarget && onOpenContentLinkInViewer) { onOpenContentLinkInViewer(lnk.inViewerTarget); return }
                      if (lnk.isSandboxMd) { void openViewerDocument({ path: lnk.href }); return }
                      void openOrCopyMarkdownLink(lnk.href, hostUrl, extensionSDK)
                    }}
                  >
                    <span className="dab-ov-ic">{lnk.inViewerTarget ? renderContentTabIcon(lnk.inViewerTarget.contentType) : lnk.isSandboxMd ? <FileText size={13} strokeWidth={1.75} aria-hidden="true" /> : <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />}</span>
                    <span className="dab-ov-txt">{lnk.label}</span>
                  </button>
                  {lnk.inViewerTarget && (
                    <button type="button" data-testid={`overview-link-external-${idx}`} className="dab-ov-icon-btn" title="Open in Looker" aria-label={`Open ${lnk.label} in Looker`} onClick={(e) => { e.stopPropagation(); void openOrCopyMarkdownLink(lnk.inViewerTarget ? lnk.inViewerTarget.externalPath : lnk.href, hostUrl, extensionSDK) }}>
                      <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
              {data.links.length > 3 && <button type="button" className="dab-ov-more" onClick={() => toggleAll('links')}>{showAll.links ? 'Show fewer' : `See all (${data.links.length})`}</button>}
            </OvSec>
          )}

          {!hiddenSecs.uploads && data.context.uploads.length > 0 && (
            <OvSec testId="overview-section-uploads" title="Uploads" count={data.context.uploads.length} open={isSecOpen('uploads', true)} onToggle={() => toggleSec('uploads', true)}>
              {data.context.uploads.map((u) => (
                <div key={u.key} className="dab-ov-row dab-ov-static">
                  <span className="dab-ov-ic"><Paperclip size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="dab-ov-txt">{u.label}</span>
                  <span className="dab-ov-meta">{u.sub}</span>
                </div>
              ))}
            </OvSec>
          )}

          {data.totalItems === 0 && !busyStatus && (
            <div className="dab-ov-sec" data-testid="overview-empty-state">
              <div className="dab-ov-note">Ready when you are — content, changed files, API calls, skills, and links from this conversation appear here.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const StudioRightPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode, selectedUseCase, isEmptyConversation, isHealthCheckMode, isLookmlMode, isCaMode,
    builderMode, healthReport, lookmlBundle, caConversation, canDeployLookml, nativeContent,
    publishedApp, contentItems = [], activeContentTabKey = '', activeContentItem = null,
    handleSelectOverview, handleSelectContentTab, handleHideContentTab,
    currentAppCode, embedNonce, extensionSDK, setInfoModalUseCase,
    busyStatus, rightPaneCollapsed, setRightPaneCollapsed, scriptId, scriptTitle,
    activeViewerDocument = null, setActiveViewerDocument, openViewerDocument, activeConversationId,
  } = ctl
  const isTileMode = activeMode === 'tile' && Boolean(ctl.loadedScript || ctl.explicitUseCase === 'tile')
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || window.location.origin
  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const [tddViewMode, setTddViewMode] = useState<'rendered' | 'raw'>(() => mockExt?.initialTddViewMode || 'rendered')
  const [copiedTdd, setCopiedTdd] = useState(false)
  const [showAppCode, setShowAppCode] = useState(false)
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
  const [convWinCalls, setConvWinCalls] = useState<Record<string, LkrCodeModeApiCallLike[]>>({})
  const [ovOpenSecs, setOvOpenSecs] = useState<Record<string, boolean>>({ api: false })
  const [ovShowAll, setOvShowAll] = useState<Record<string, boolean>>({})
  const [ovHiddenSecs, setOvHiddenSecs] = useState<Record<string, boolean | undefined>>({})

  useEffect(() => {
    setOvOpenSecs({ api: false })
    setOvShowAll({})
  }, [activeConversationId])

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? (window as Window & { lkr_codemode_api_calls?: unknown }).lkr_codemode_api_calls : undefined
    if (!Array.isArray(raw) || raw !== initialWinCallsRef.current) return
    const key = activeConversationId || '__default__'
    if (raw.length > winCallsCursorRef.current && (busyStatus || wasBusyForCallsRef.current)) {
      const slice = raw.slice(winCallsCursorRef.current) as LkrCodeModeApiCallLike[]
      setConvWinCalls((prev) => ({ ...prev, [key]: (prev[key] || []).concat(slice) }))
    }
    winCallsCursorRef.current = raw.length
    wasBusyForCallsRef.current = Boolean(busyStatus)
  }, [busyStatus, activeConversationId])

  const rawWinCalls = typeof window !== 'undefined' ? (window as Window & { lkr_codemode_api_calls?: unknown }).lkr_codemode_api_calls : undefined
  const overviewWinCalls: ReadonlyArray<LkrCodeModeApiCallLike> =
    Array.isArray(rawWinCalls) && rawWinCalls !== initialWinCallsRef.current
      ? (rawWinCalls as LkrCodeModeApiCallLike[])
      : convWinCalls[activeConversationId || '__default__'] || []

  const clearTabPopoverTimers = () => {
    if (hoverCloseTimerRef.current) { clearTimeout(hoverCloseTimerRef.current); hoverCloseTimerRef.current = null }
    if (hoverOpenTimerRef.current) { clearTimeout(hoverOpenTimerRef.current); hoverOpenTimerRef.current = null }
  }

  useEffect(() => {
    setShowAppCode(false)
    setCopiedAppCode(false)
  }, [activeContentTabKey, activeConversationId, embedNonce])

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
  const activePaneKind: 'script' | 'report' | 'lookml' | 'ca' | 'embed' | 'empty_hidden' = allTabsHidden
    ? 'empty_hidden'
    : ct
    ? ct === 'script' || ct === 'lookml' || ct === 'report' ? ct : ct === 'conversational-analytics' ? 'ca' : 'embed'
    : isTileMode ? 'script' : isHealthCheckMode ? 'report' : isLookmlMode ? 'lookml' : isCaMode || caConversation ? 'ca' : 'embed'

  const embedTarget = useMemo(
    () => resolveLookerEmbedTarget({
      isEmptyConversation: isEmptyConversation || allTabsHidden,
      isHealthCheckMode: activePaneKind === 'report',
      isLookmlMode: activePaneKind === 'lookml',
      isTileMode: activePaneKind === 'script',
      isCaMode: activePaneKind === 'ca',
      builderMode, activeContentItem, caConversation, nativeContent, publishedApp,
      hostUrl, nonce: (embedNonce || 0) + iframeRev,
    }),
    [isEmptyConversation, allTabsHidden, activePaneKind, builderMode, activeContentItem, caConversation, nativeContent, publishedApp, hostUrl, embedNonce, iframeRev]
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

  const isDataAppPane = activeContentItem
    ? activeContentItem.contentType === 'data_app' || activeContentItem.contentType === 'data-investigator'
    : builderMode !== 'dashboard'
  const isShowingAppCodeFullscreen =
    activePaneKind === 'embed' && !rightPaneCollapsed && !allTabsHidden && showAppCode && Boolean(currentAppCode) && isDataAppPane && !activeViewerDocument
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
  const resolvedActiveTabKey = activeContentItem?.key || activeContentTabKey || ''

  const railArtifacts = useMemo<Array<{ key: string; title: string; contentType: StudioContentItemType }>>(() => {
    if (visibleTabs.length > 0) return visibleTabs.map((item) => ({ key: item.key, title: item.title, contentType: item.contentType }))
    if (allTabsHidden) return []
    if (isLookmlMode && lookmlBundle) return [{ key: `lookml:${lookmlBundle.id}`, title: lookmlBundle.title || 'Agentic LookML', contentType: 'lookml' }]
    if (isHealthCheckMode && healthReport) return [{ key: `report:${healthReport.id}`, title: healthReport.title || 'Health Check Report', contentType: 'report' }]
    if (isTileMode && scriptId) return [{ key: `script:${scriptId}`, title: scriptTitle || scriptId, contentType: 'script' }]
    if (caConversation) return [{ key: `ca:${caConversation.caConversationId}`, title: caConversation.title || 'Conversational Analytics', contentType: 'conversational-analytics' }]
    if (nativeContent) return [{ key: `${nativeContent.contentType}:${nativeContent.id}`, title: nativeContent.title, contentType: nativeContent.contentType }]
    if (publishedApp) return [{ key: `data_app:${publishedApp.dashboardId}`, title: publishedApp.title, contentType: 'data_app' }]
    return []
  }, [visibleTabs, allTabsHidden, isLookmlMode, lookmlBundle, isHealthCheckMode, healthReport, isTileMode, scriptId, scriptTitle, caConversation, nativeContent, publishedApp])

  const collapseToggleBtn = !rightPaneCollapsed ? (
    <button
      type="button" data-testid="right-pane-collapse-toggle" className="dab-btn dab-btn-secondary dab-right-collapse-btn"
      title="Collapse viewer" aria-label="Collapse viewer" onClick={() => setRightPaneCollapsed(true)}
    >
      <PanelRightClose size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  ) : null

  const explicitOverview = activeContentTabKey === STUDIO_OVERVIEW_TAB_KEY
  const hasActiveViewerPane =
    !explicitOverview &&
    Boolean(
      activeContentItem ||
      (!allTabsHidden &&
        (hasActiveEmbed ||
          (activePaneKind === 'report' && healthReport) ||
          (activePaneKind === 'lookml' && lookmlBundle) ||
          (activePaneKind === 'ca' && caConversation) ||
          activePaneKind === 'script'))
    )
  const isOverviewMode = !isEmptyConversation && !activeViewerDocument && !hasActiveViewerPane
  const hasViewerContent = Boolean(activeViewerDocument || hasActiveViewerPane)
  const hideRightPane = isEmptyConversation && !activeViewerDocument
  const idleToolbarText = <span className="dab-muted">{busyStatus ? 'Thinking...' : 'Viewer will appear here when Looker content is ready'}</span>

  return (
    <main
      className={`dab-right-pane ${rightPaneCollapsed ? 'dab-right-pane-collapsed' : ''}`}
      data-has-viewer-content={hasViewerContent ? 'true' : 'false'}
      data-overview-mode={isOverviewMode ? 'true' : 'false'}
      data-explicit-overview={explicitOverview ? 'true' : 'false'}
      data-right-hidden={hideRightPane ? 'true' : 'false'}
      style={hideRightPane ? { display: 'none' } : undefined}
    >
      {!rightPaneCollapsed && (
        <div className="dab-mobile-viewer-card-handle" data-testid="mobile-viewer-card-handle">
          <div className="dab-mobile-viewer-grab-bar" aria-hidden="true" />
          <div className="dab-mobile-viewer-card-header">
            <span className="dab-mobile-viewer-card-title">
              {isOverviewMode
                ? 'Overview'
                : activeViewerDocument?.title || activeContentItem?.title || publishedApp?.title || nativeContent?.title || lookmlBundle?.title || healthReport?.title || caConversation?.title || 'Viewer'}
            </span>
            <button
              type="button" data-testid="mobile-viewer-card-close" className="dab-btn dab-btn-secondary dab-mobile-viewer-close-btn"
              title="Collapse viewer" aria-label="Collapse viewer"
              onClick={() => { if (explicitOverview) ctl.setActiveContentTabKey(''); setRightPaneCollapsed(true) }}
            >
              <PanelRightClose size={14} strokeWidth={1.75} aria-hidden="true" /><span>Close</span>
            </button>
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
                    if (contentItems.some((c) => c.key === item.key)) handleSelectContentTab?.(item.key)
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
        <div className="dab-content-tabs" data-testid="studio-content-tabs" role="tablist" aria-label="Conversation Looker content tabs">
          <div className="dab-content-tabs-scroll">
            <button
              type="button"
              role="tab"
              aria-selected={isOverviewMode}
              data-testid="studio-overview-tab"
              className={`dab-content-tab dab-ov-pill ${isOverviewMode ? 'active' : ''}`}
              onClick={() => handleSelectOverview?.()}
              title="View conversation overview"
            >
              <span className="dab-content-tab-label">Overview</span>
            </button>
            {visibleTabs.map((item) => {
              const isSelected = item.key === resolvedActiveTabKey
              const isPopOpen = hoveredTab?.key === item.key
              const pid = item.projectId || item.id
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
                    onClick={() => handleSelectContentTab?.(item.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelectContentTab?.(item.key)
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
                        handleSelectContentTab?.(item.key)
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
      )}
      {!rightPaneCollapsed && isOverviewMode && (
        <StudioOverviewSidebar
          ctl={ctl}
          allTabsHidden={allTabsHidden}
          collapseToggleBtn={collapseToggleBtn}
          windowApiCalls={overviewWinCalls}
          openSecs={ovOpenSecs}
          setOpenSecs={setOvOpenSecs}
          showAll={ovShowAll}
          setShowAll={setOvShowAll}
          hiddenSecs={ovHiddenSecs}
          setHiddenSecs={setOvHiddenSecs}
          onOpenContentLinkInViewer={(target) => openContentLinkTargetInViewer(ctl, target)}
        />
      )}
      {!rightPaneCollapsed && !isOverviewMode && !activeViewerDocument && (
        activePaneKind === 'script' ? (
          <TilePreviewPane ctl={ctl} />
        ) : activePaneKind === 'report' ? (
          <StudioToolbar
            title={healthReport ? (
              <>
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
                {collapseToggleBtn}
              </>
            }
          />
        ) : activePaneKind === 'lookml' ? (
          <StudioToolbar
            title={lookmlBundle ? (
              <><strong>{lookmlBundle.title || lookmlBundle.project_id}</strong> <span className="dab-muted">({lookmlBundle.files?.length || 0} .lkml files)</span></>
            ) : idleToolbarText}
            actions={<><UseCaseInfoTrigger useCase="lookml" onOpen={setInfoModalUseCase} />{collapseToggleBtn}</>}
          />
        ) : activePaneKind === 'ca' ? (
          <>
            <StudioToolbar
              testId="ca-preview-toolbar"
              title={caConversation ? (
                <>
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
                <><strong>{activeContentItem.title}</strong> <span className="dab-muted">({activeContentItem.contentType} #{activeContentItem.id} · <code>{activeContentItem.embedPath}</code>)</span></>
              ) : !activeContentItem && builderMode === 'dashboard' && nativeContent ? (
                <><strong>{nativeContent.title}</strong> <span className="dab-muted">({nativeContent.contentType} #{nativeContent.id} · <code>{nativeContent.embedPath}</code>)</span></>
              ) : publishedApp ? (
                <><strong>{publishedApp.title}</strong> <span className="dab-muted">(Dashboard #{publishedApp.dashboardId})</span></>
              ) : idleToolbarText
            }
            actions={
              <>
                {!allTabsHidden && isDataAppPane && currentAppCode && (
                  <StudioButton variant="secondary" testId="preview-view-code-btn" onClick={() => setShowAppCode((v) => !v)}>
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
                {collapseToggleBtn}
              </>
            }
          />
        )
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
          <pre className="dab-code-drawer-pre">{currentAppCode}</pre>
        </div>
      )}

      {!rightPaneCollapsed && activeViewerDocument && (
        <div className="dab-viewer-document-pane" data-testid="viewer-document-pane">
          <div className="dab-viewer-document-header">
            <div className="dab-viewer-document-title-group">
              <strong data-testid="viewer-document-title">{activeViewerDocument.title}</strong>
              <StudioBadge tone="accent" testId="viewer-document-path-badge">{activeViewerDocument.displayPath}</StudioBadge>
            </div>
            <div className="dab-viewer-document-actions">
              <button
                type="button"
                data-testid="viewer-document-close-btn"
                className="dab-btn dab-btn-secondary dab-btn-icon"
                title="Close document"
                aria-label="Close document"
                onClick={() => setActiveViewerDocument?.(null)}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="dab-viewer-document-body" data-testid="viewer-document-body">
            {activeViewerDocument.loading ? (
              <div className="dab-viewer-document-loading" data-testid="viewer-document-loading">
                <StudioSkeleton width="100%" height={32} /><span className="dab-muted">Loading from sandbox...</span>
              </div>
            ) : activeViewerDocument.isMarkdown ? (
              <div className="dab-viewer-document-markdown" data-testid="viewer-document-markdown">
                <StudioMarkdown
                  text={activeViewerDocument.content}
                  hostUrl={hostUrl}
                  extensionSDK={extensionSDK}
                  onOpenSandboxMarkdownFile={(p) => void openViewerDocument?.({ path: p })}
                  onOpenContentInViewer={(target) => openContentLinkTargetInViewer(ctl, target)}
                />
              </div>
            ) : (
              <pre className="dab-viewer-document-code" data-testid="viewer-document-code"><code>{activeViewerDocument.content}</code></pre>
            )}
          </div>
        </div>
      )}

      <div className="dab-iframe-container" data-testid="ca-embed-preview" style={activePaneKind === 'script' || rightPaneCollapsed || Boolean(activeViewerDocument) || isShowingAppCodeFullscreen || isOverviewMode ? { display: 'none' } : undefined}>
        <div ref={embedContainerRef} data-testid="looker-embed-container" className="dab-embed-container" style={{ width: '100%', height: '100%', display: hasActiveEmbed ? 'block' : 'none' }} />
        {activePaneKind === 'report' && healthReport ? (
          <div className="dab-tdd-viewer">
            {tddViewMode === 'rendered' ? <div className="dab-tdd-rendered" dangerouslySetInnerHTML={{ __html: renderTddMarkdownToHtml(healthReport.tddMarkdown) }} /> : <pre className="dab-tdd-markdown">{healthReport.tddMarkdown}</pre>}
          </div>
        ) : activePaneKind === 'lookml' && lookmlBundle ? (
          <LookmlPreviewPane bundle={lookmlBundle} hostUrl={hostUrl} extensionSDK={extensionSDK} canDeploy={canDeployLookml} />
        ) : null}
      </div>
    </main>
  )
}
