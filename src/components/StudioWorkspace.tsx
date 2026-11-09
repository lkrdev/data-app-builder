import React, { useEffect, useMemo, useRef, useState } from 'react'

import { ChattyHostBuilderFactory, getEmbedSDK, ILookerConnection, LookerEmbedExSDK, PageChangedEvent } from '@looker/embed-sdk'
import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import {
  Archive, ArchiveRestore, AtSign, BookOpen, Brain, Bug, Check, ChevronDown, Code2, Copy,
  CornerDownRight, Database, Eye, FileText, Folder, Kanban, LayoutDashboard, Loader2,
  MessageSquare, MoreVertical, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, Shield,
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
import { renderTddMarkdownToHtml } from '../healthCheck'
import {
  ConversationRecord, copyTextWithExtensionSdk, discoverAccessibleConnections, formatAccessibleConnectionsMarkdown,
  formatExploreId, normalizeCaEmbedPath, normalizeStudioAgentName,
  resolveConversationRelatedContent, StudioContentItem, StudioContentItemType,
  StudioContextCategory, StudioContextMention,
} from '../lookerApi'
import { LookmlBundle, LookmlPreviewPane, LookmlSkillCatalogEntry, STUDIO_SLASH_SKILLS } from '../lookmlTool'
export { copyTextWithExtensionSdk, fetchConversationSandboxDebugMarkdown, formatConversationThreadMarkdown }
import { StudioController } from '../useStudioController'
import { TilePreviewPane } from './ScriptStudioView'
import {
  StudioBadge, StudioButton, StudioDocPreview, StudioModal,
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

export async function openOrCopyMarkdownLink(
  url: string, hostUrl?: string, extensionSDK?: Partial<ExtensionSDK> | null
): Promise<{ action: 'opened' | 'copied'; targetUrl: string }> {
  const clean = String(url || '').trim()
  if (!clean) return { action: 'copied', targetUrl: '' }
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
        targetToOpen = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`
      } else if (isAllowedExternalWindowUrl(parsed.href)) {
        targetToOpen = parsed.href
      }
    } catch { /* non-URL falls back to clipboard */ }
  }
  if (targetToOpen && typeof extensionSDK?.openBrowserWindow === 'function') {
    try {
      extensionSDK.openBrowserWindow(targetToOpen, '_blank')
      return { action: 'opened', targetUrl: targetToOpen }
    } catch { /* fall back to clipboard */ }
  }
  await copyLinkWithExtensionSdk(clean, extensionSDK)
  return { action: 'copied', targetUrl: clean }
}

export async function fetchAvailableLookerConnectionsMarkdown(core40SDK?: Partial<Looker40SDK> | null): Promise<string> {
  if (!core40SDK) return '### Available Looker Connections\n- No Looker SDK session available.'
  return formatAccessibleConnectionsMarkdown(await discoverAccessibleConnections(core40SDK))
}

const StudioMarkdownLink: React.FC<{
  label: string; href: string; hostUrl?: string; extensionSDK?: Partial<ExtensionSDK> | null; onInspectConnections?: () => void
}> = ({ label, href, hostUrl, extensionSDK, onInspectConnections }) => {
  const [copied, setCopied] = useState(false)
  const markCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  const isAdminConnectionsLink = /(?:^|\/)admin\/connections(?:[/?#]|$)/i.test(String(href || '').trim())
  return (
    <span className="dab-md-link-group">
      <a
        href={href} data-testid="chat-markdown-link" className="dab-md-link" target="_blank" rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation()
          if (isAdminConnectionsLink && onInspectConnections) { onInspectConnections(); return }
          void openOrCopyMarkdownLink(href, hostUrl, extensionSDK).then((res) => { if (res.action === 'copied') markCopied() })
        }}
      >
        {label}
      </a>
      <button
        type="button" data-testid="chat-markdown-link-copy" data-copied={copied ? 'true' : 'false'}
        className="dab-md-link-copy-btn" title={copied ? 'Copied URL to clipboard' : `Copy link (${href})`}
        aria-label={copied ? 'Copied link' : `Copy link ${label}`}
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation()
          void copyLinkWithExtensionSdk(href, extensionSDK).then(() => markCopied())
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

function normalizeInlineMarkdownArtifacts(input: string): string {
  return String(input ?? '')
    .replace(/\[([^\][]+)\]\(\s*([^)]+?)\s*\)/g, (_m, lbl: string, url: string) => `[${lbl.replace(/\s*\n\s*/g, ' ').trim()}](${url.replace(/\s+/g, '')})`)
    .replace(/\*\*([^*]+?)\*\*/g, (m, inner: string) => (inner.includes('\n') && !inner.includes('\n\n') && !/\n\s*(?:[-*]|\d+\.|#{1,4})\s/.test(inner) ? `**${inner.replace(/\s*\n\s*/g, ' ').trim()}**` : m))
}

function renderInlineMarkdown(
  rawText: string,
  hostUrl?: string,
  extensionSDK?: Partial<ExtensionSDK> | null,
  onOpenSandboxMarkdownFile?: (path: string) => void,
  onInspectConnections?: () => void
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
      nodes.push(isSandboxMarkdownPath(linkHref) ? renderMdTrigger(linkHref, <span>{match[2]}</span>) : <StudioMarkdownLink key={`link_${keyCounter++}`} label={match[2]} href={linkHref} hostUrl={hostUrl} extensionSDK={extensionSDK} onInspectConnections={onInspectConnections} />)
    } else if (match[4] !== undefined) {
      nodes.push(<strong key={`bold_${keyCounter++}`}>{renderInlineMarkdown(match[4], hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections)}</strong>)
    } else if (match[5] !== undefined) {
      const bareUrl = match[5].replace(/[.,;:!?]+$/, '')
      const trailing = match[5].slice(bareUrl.length)
      nodes.push(<StudioMarkdownLink key={`bare_${keyCounter++}`} label={bareUrl} href={bareUrl} hostUrl={hostUrl} extensionSDK={extensionSDK} onInspectConnections={onInspectConnections} />)
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
  text: string; hostUrl?: string; extensionSDK?: Partial<ExtensionSDK> | null; onOpenSandboxMarkdownFile?: (path: string) => void; onInspectConnections?: () => void
}> = ({ text, hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections }) => {
  const raw = String(text ?? '')
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
        blocks.push(<HeadingTag key={`h_${blockKey++}`} className={`dab-md-heading dab-md-h${level}`}>{renderInlineMarkdown(headingMatch[2], hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections)}</HeadingTag>)
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
                      {renderInlineMarkdown(h, hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={`tr_${rIdx}`}>
                    {headers.map((_h, cIdx) => (
                      <td key={`td_${cIdx}`} style={alignments[cIdx] ? { textAlign: alignments[cIdx] } : undefined}>
                        {renderInlineMarkdown(row[cIdx] ?? '', hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections)}
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
          items.push(<li key={`li_${items.length}`}>{renderInlineMarkdown(itemLines.join(' '), hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections)}</li>)
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
      blocks.push(<p key={`p_${blockKey++}`} className="dab-md-p">{renderInlineMarkdown(paraLines.join('\n'), hostUrl, extensionSDK, onOpenSandboxMarkdownFile, onInspectConnections)}</p>)
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
          sendAndReceive: async (event: string, payload?: { url?: string }) => {
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
            return []
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
    queue = queue.then(async () => {
      const connection = await connectionPromise
      activePreviewMeta = { mode: next.previewMode, objectId: next.previewObjectId }
      const prev = lastTarget
      const isSameTarget = prev && prev.kind === next.kind && prev.target === next.target
      if (isSameTarget && prev.nonce === next.nonce) return connection
      lastTarget = next
      const options = { waitUntilLoaded: true }
      const recordLoad = async (method: string, arg: string, p: Promise<unknown>) => {
        telemetry.calls.push({ method, arg })
        telemetry.loadCount += 1
        await p
      }
      if (next.kind === 'preload') {
        if (prev && prev.kind !== 'preload') await recordLoad('loadUrl', '/preload', connection.loadUrl({ url: '/preload', options }))
      } else if (next.kind === 'dashboard') {
        if (isSameTarget && prev.nonce !== next.nonce) {
          try {
            telemetry.calls.push({ method: 'asDashboardConnection.run', arg: next.target })
            connection.asDashboardConnection().run()
          } catch {
            await recordLoad('loadDashboard', next.target, connection.loadDashboard({ id: next.target, options }))
          }
        } else {
          await recordLoad('loadDashboard', next.target, connection.loadDashboard({ id: next.target, options }))
        }
      } else if (next.kind === 'look') {
        await recordLoad('loadLook', next.target, connection.loadLook({ id: next.target, options }))
      } else if (next.kind === 'explore') {
        const exploreId = next.target.replace('::', '/')
        await recordLoad('loadExplore', exploreId, connection.loadExplore({ id: exploreId, options }))
      } else if (next.kind === 'extension') {
        await recordLoad('loadExtension', next.target, connection.loadExtension({ id: next.target, options }))
      } else if (next.kind === 'report') {
        await recordLoad('loadReport', next.target, connection.loadReport({ id: next.target, options }))
      } else {
        await recordLoad('loadUrl', next.target, connection.loadUrl({ url: next.target, options }))
      }
      telemetry.state = next.kind === 'preload' ? 'preloaded' : next.kind
      telemetry.target = next.target
      const iframeEl = opts.container?.querySelector?.('iframe')
      if (iframeEl) {
        if (next.previewMode === 'conversational-analytics') {
          iframeEl.setAttribute('data-testid', 'ca-embed-iframe')
          iframeEl.setAttribute('data-ca-panels-collapsed', 'true')
          try {
            iframeEl.contentWindow?.postMessage?.(
              { type: 'looker:ca:layout', hide_sidebar: true, hide_data_source_panel: true, sidebar_collapsed: true, right_panel_collapsed: true },
              '*'
            )
          } catch { /* ignore cross-origin postMessage errors */ }
        } else {
          iframeEl.removeAttribute('data-testid')
          iframeEl.removeAttribute('data-ca-panels-collapsed')
        }
      }
      notify()
      return connection
    })
    return queue
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
    messages, liveActivitySteps, copyThreadState, handleCopyThreadDebugTrace,
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
  const selectedFolderLabel = folderTreeNodes?.[selectedFolderId]?.name || 'My folder'

  useEffect(() => { setCursorPos((prev) => Math.min(prev, prompt.length)) }, [prompt.length])

  const detectedMention = useMemo(() => {
    const uptoCursor = prompt.slice(0, cursorPos || prompt.length)
    const m = uptoCursor.match(AT_MENTION_DETECT_RE)
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
  }, [prompt, cursorPos, forceMentionCategory])

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
    for (const model of models) {
      for (const explore of model.explores || []) {
        if (explore.hidden) continue
        const id = formatExploreId(model.name, String(explore.name))
        map[id] = { id, label: String(explore.label || explore.name), modelLabel: String(model.label || model.name), model: model.name, explore: String(explore.name) }
      }
    }
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
      for (const group of groupedExplores) for (const opt of group.options) pushItem(opt.mention)
      for (const r of remoteSearchResults) if (r.type === 'explore') pushItem(r)
    }
    for (const contentType of ['dashboard', 'look'] as const) {
      if (cat === 'all' || cat === contentType) {
        for (const item of preloadedContent) if (item.type === contentType && matchTokens(`${item.title} ${item.id} ${item.description || ''}`)) pushItem(item)
        for (const r of remoteSearchResults) if (r.type === contentType) pushItem(r)
      }
    }
    if (cat === 'all' || cat === 'conversation') {
      for (const c of allConversations || conversations || []) {
        const label = c.label || c.id
        if (matchTokens(`${label} ${c.id} ${c.type || ''}`)) pushItem({ type: 'conversation', id: c.id, title: label, subtitle: c.use_case || c.type || 'conversation' })
      }
      for (const r of remoteSearchResults) if (r.type === 'conversation') pushItem(r)
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
    for (const item of mentionedItems) {
      const key = `${item.type}:${item.id}`
      if (!seen.has(key)) { seen.add(key); chips.push(item) }
    }
    for (const expId of selectedExplores) {
      const key = `explore:${expId}`
      if (!seen.has(key)) {
        seen.add(key)
        const info = exploreLookup[expId]
        chips.push({ type: 'explore', id: expId, title: info ? `${info.modelLabel}: ${info.label}` : expId, model: info?.model, explore: info?.explore })
      }
    }
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
            if (e.key === 'Escape' && detectedMention.open) { e.preventDefault(); setForceMentionCategory(null); return }
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
  for (const cand of [step.path, step.detail, step.title].map((s) => String(s || '').trim()).filter(Boolean)) {
    const clean = cand
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
  for (const cand of [step.path, step.detail, step.title].map((s) => String(s || '').trim()).filter(Boolean)) {
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

const ActivityStepsList: React.FC<{ steps: AntigravityActivityStep[]; contentCtx?: ActivityStepContentContext }> = ({ steps, contentCtx }) => {
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
        const isCollapsible = isCollapsibleThought || isFileOrSkill
        const isOpen = Boolean(expandedKeys[stepKey])
        const StepTag = isCollapsible ? 'details' : 'div'
        const HeaderTag = isCollapsible ? 'summary' : 'div'
        const testId = isCollapsibleThought ? 'thinking-step-thought' : step.kind === 'file' ? 'thinking-step-file' : step.kind === 'skill' ? 'thinking-step-skill' : undefined
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
            className={`dab-thinking-step dab-thinking-step-${step.kind} ${isFileOrSkill ? 'dab-thinking-step-interactive' : ''}`}
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
    setPrompt, busyStatus, liveActivitySteps, pendingPerm, resolvePermDecision,
    leftPaneWidth, setLeftPaneWidth, flushLeftPaneWidthSave, rightPaneCollapsed, setRightPaneCollapsed,
    contentItems = [], activeContentTabKey = '', handleSelectContentTab, publishedApp, nativeContent,
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
  const chatViewerObjects = useMemo<Array<{ key: string; title: string; contentType: StudioContentItemType }>>(() => {
    if (contentItems.length > 0) return contentItems.map((item) => ({ key: item.key, title: item.title, contentType: item.contentType }))
    if (nativeContent) return [{ key: `${nativeContent.contentType}:${nativeContent.id}`, title: nativeContent.title, contentType: nativeContent.contentType }]
    if (publishedApp) return [{ key: `data_app:${publishedApp.dashboardId}`, title: publishedApp.title, contentType: 'data_app' }]
    return []
  }, [contentItems, nativeContent, publishedApp])

  const handleCopyThinkingTrace = (
    e: React.MouseEvent<HTMLButtonElement>, traceKey: string, steps: AntigravityActivityStep[],
    meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string }
  ) => {
    e.preventDefault(); e.stopPropagation()
    const enriched = steps.map((s) => ((s.kind === 'file' || s.kind === 'skill') && !s.content ? { ...s, content: resolveActivityStepContent(s, contentCtx) } : s))
    const md = formatThinkingTraceMarkdown(enriched, meta)
    if (typeof window !== 'undefined') window.__LAST_COPIED_THINKING_TRACE__ = md
    void copyTextWithExtensionSdk(md, extensionSDK)
    setCopiedTraceKey(traceKey)
    setTimeout(() => setCopiedTraceKey((curr) => (curr === traceKey ? null : curr)), 1800)
  }

  const renderCopyTraceBtn = (traceKey: string, steps: AntigravityActivityStep[], meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string }) => {
    const isCopied = copiedTraceKey === traceKey
    return (
      <button
        type="button" data-testid="copy-thinking-trace-btn" data-copied={isCopied ? 'true' : 'false'}
        className="dab-thinking-copy-btn" title="Copy debug trace to clipboard" aria-label="Copy debug trace to clipboard"
        onClick={(e) => handleCopyThinkingTrace(e, traceKey, steps, meta)}
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
          return (
            <div key={idx} className={`dab-msg dab-msg-${m.role}`}>
              <div className="dab-msg-header">
                <span data-testid={m.role === 'assistant' ? 'chat-msg-agent-author' : undefined}>
                  {m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : agentName}
                </span>
                {m.dashboardId && (
                  <button type="button" className="dab-msg-pill" onClick={() => { setActiveViewerDocument?.(null); setRightPaneCollapsed(false) }}>
                    Dashboard #{m.dashboardId}{typeof m.widgetCount === 'number' ? ` · ${m.widgetCount} queries` : ''}
                  </button>
                )}
              </div>
              {m.role === 'assistant' && m.activitySteps && m.activitySteps.length > 0 && (
                <details className="dab-thinking-block" data-testid="completed-thinking-block">
                  <summary className="dab-thinking-summary">
                    <span className="dab-thinking-summary-label">
                      Thought for {m.thinkingDurationSec ?? 1}s · {m.activitySteps.length} {m.activitySteps.length === 1 ? 'step' : 'steps'}
                    </span>
                    {renderCopyTraceBtn(`completed_${idx}`, m.activitySteps, { thinkingDurationSec: m.thinkingDurationSec ?? 1, userPrompt: prevUserMsg, assistantText: m.text })}
                  </summary>
                  <ActivityStepsList steps={m.activitySteps} contentCtx={contentCtx} />
                </details>
              )}
              <div className="dab-msg-body">
                <StudioMarkdown
                  text={m.text} hostUrl={hostUrl} extensionSDK={extensionSDK}
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
            <ActivityStepsList steps={liveActivitySteps} contentCtx={contentCtx} />
          </details>
        )}

        {busyStatus && (!liveActivitySteps || liveActivitySteps.length === 0) && (
          <div className="dab-status-banner"><span className="dab-spinner" /><span>{busyStatus}</span></div>
        )}

        {chatViewerObjects.length > 0 && (
          <div className="dab-chat-object-chips" data-testid="chat-object-viewer-chips">
            {chatViewerObjects.map((item) => (
              <button
                key={item.key} type="button" data-testid={`chat-object-viewer-chip-${item.key}`}
                className={`dab-msg-pill dab-chat-object-chip ${item.key === activeContentTabKey ? 'active' : ''}`}
                onClick={() => {
                  setActiveViewerDocument?.(null)
                  if (contentItems.some((c) => c.key === item.key)) handleSelectContentTab?.(item.key)
                  setRightPaneCollapsed(false)
                }}
              >
                {renderContentTabIcon(item.contentType)}<span>{item.title}</span>
              </button>
            ))}
          </div>
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

function renderContentTabIcon(contentType: StudioContentItemType): React.ReactNode {
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

export const StudioRightPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode, selectedUseCase, isEmptyConversation, isHealthCheckMode, isLookmlMode, isCaMode,
    builderMode, healthReport, lookmlBundle, caConversation, canDeployLookml, nativeContent,
    publishedApp, contentItems = [], activeContentTabKey = '', activeContentItem = null,
    handleSelectContentTab, handleHideContentTab,
    currentAppCode, embedNonce, extensionSDK, setInfoModalUseCase,
    busyStatus, rightPaneCollapsed, setRightPaneCollapsed, scriptId, scriptTitle,
    activeViewerDocument = null, setActiveViewerDocument, openViewerDocument,
  } = ctl
  const isTileMode = activeMode === 'tile' && Boolean(ctl.loadedScript || ctl.explicitUseCase === 'tile')
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || window.location.origin
  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const [tddViewMode, setTddViewMode] = useState<'rendered' | 'raw'>(() => mockExt?.initialTddViewMode || 'rendered')
  const [copiedTdd, setCopiedTdd] = useState(false)
  const [showAppCode, setShowAppCode] = useState(false)
  const [iframeRev, setIframeRev] = useState(0)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const embedContainerRef = useRef<HTMLDivElement | null>(null)
  const embedControllerRef = useRef<ReturnType<typeof createLookerEmbedPreloadController> | null>(null)

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
    if (!embedControllerRef.current) return
    void embedControllerRef.current.syncTarget(embedTarget)
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
  const activePreviewId = allTabsHidden
    ? ''
    : activeContentItem?.id || (builderMode === 'dashboard' ? nativeContent?.id : publishedApp?.dashboardId)
  const openInLookerPath = activeContentItem
    ? activeContentItem.embedPath.replace(/^\/embed/, '')
    : builderMode === 'dashboard' && nativeContent
    ? nativeContent.embedPath.replace(/^\/embed/, '')
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

  const hasViewerContent = Boolean(
    activeViewerDocument || showContentTabs || hasActiveEmbed ||
    (activePaneKind === 'report' && healthReport) ||
    (activePaneKind === 'lookml' && lookmlBundle) ||
    (activePaneKind === 'ca' && caConversation) ||
    activePaneKind === 'script'
  )

  return (
    <main
      className={`dab-right-pane ${rightPaneCollapsed ? 'dab-right-pane-collapsed' : ''}`}
      data-has-viewer-content={hasViewerContent ? 'true' : 'false'}
      style={isEmptyConversation && !activeViewerDocument ? { display: 'none' } : undefined}
    >
      {!rightPaneCollapsed && (
        <div className="dab-mobile-viewer-card-handle" data-testid="mobile-viewer-card-handle">
          <div className="dab-mobile-viewer-grab-bar" aria-hidden="true" />
          <div className="dab-mobile-viewer-card-header">
            <span className="dab-mobile-viewer-card-title">
              {activeViewerDocument?.title || activeContentItem?.title || publishedApp?.title || nativeContent?.title || lookmlBundle?.title || healthReport?.title || caConversation?.title || 'Viewer'}
            </span>
            <button
              type="button" data-testid="mobile-viewer-card-close" className="dab-btn dab-btn-secondary dab-mobile-viewer-close-btn"
              title="Collapse viewer" aria-label="Collapse viewer" onClick={() => setRightPaneCollapsed(true)}
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
            {visibleTabs.map((item) => {
              const isSelected = item.key === resolvedActiveTabKey
              return (
                <div
                  key={item.key} role="tab" tabIndex={0} aria-selected={isSelected}
                  data-testid={`studio-content-tab-${item.key}`} className={`dab-content-tab ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectContentTab?.(item.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelectContentTab?.(item.key)
                    }
                  }}
                  title={`${item.title} (${item.contentType}: ${item.id})`}
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
                      handleHideContentTab?.(item.key)
                    }}
                  >
                    <X size={12} strokeWidth={1.75} aria-hidden="true" />
                  </button>
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
      {!rightPaneCollapsed && (
        activePaneKind === 'script' ? (
          <TilePreviewPane ctl={ctl} />
        ) : activePaneKind === 'report' ? (
          <StudioToolbar
            title={healthReport ? (
              <>
                <strong>{healthReport.title}</strong>{' '}
                <StudioBadge>Health Score: {healthReport.scores.overallScore}% ({healthReport.scores.grade})</StudioBadge>{' '}
                <StudioBadge>Transcriber: {healthReport.scores.transcriberScore}/4.00</StudioBadge>{' '}
                <span className="dab-muted">(user_{healthReport.createdBy}_health_check_{healthReport.id} · obj_health_check_{healthReport.id})</span>
              </>
            ) : <span className="dab-muted">7-section TECHNICAL_DESIGN_DOCUMENT.md (0–100% health score) will render here</span>}
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
              <><strong>{lookmlBundle.title}</strong> <span className="dab-muted">(Session <code>obj_lookml_{lookmlBundle.id}</code> · {lookmlBundle.files?.length || 0} .lkml files)</span></>
            ) : <span className="dab-muted">Agentic LookML Viewer (.lkml diffs, validator, run_lookml_test &amp; /sql/:slug + /x/:slug parity)</span>}
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
              ) : <span className="dab-muted">Looker Conversational Analytics embedded chat will appear here after routing</span>}
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
                <><strong>{publishedApp.title}</strong> <span className="dab-muted">(Dashboard #{publishedApp.dashboardId} · Extension db::{publishedApp.extensionId.slice(0, 8)}…)</span></>
              ) : busyStatus ? <span className="dab-muted">Thinking...</span>
              : <span className="dab-muted">Viewer will appear here when Looker content is ready</span>
            }
            actions={
              <>
                {!allTabsHidden && isDataAppPane && currentAppCode && (
                  <button type="button" data-testid="preview-view-code-btn" className="dab-btn-secondary" onClick={() => setShowAppCode((v) => !v)}>
                    {showAppCode ? 'Hide app.js' : '{ } View app.js'}
                  </button>
                )}
                {!allTabsHidden && activePreviewId && (
                  <>
                    <button type="button" className="dab-btn-secondary" onClick={() => setIframeRev((r) => r + 1)}>Reload Viewer</button>
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

      {!rightPaneCollapsed && !allTabsHidden && showAppCode && currentAppCode && isDataAppPane && (
        <div className="dab-code-drawer" data-testid="preview-app-code-drawer" style={{ padding: 12, background: 'var(--dab-code-bg, #0f172a)', color: '#e2e8f0', borderBottom: '1px solid var(--dab-border, #e2e8f0)', maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
          <div className="dab-inspector-bar">
            <strong>app.js ({currentAppCode.length} B)</strong>
            <button type="button" className="dab-btn-secondary" onClick={() => void copyTextWithExtensionSdk(currentAppCode, extensionSDK)}>Copy app.js</button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{currentAppCode}</pre>
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
              <button type="button" data-testid="viewer-document-close-btn" className="dab-btn dab-btn-secondary" onClick={() => setActiveViewerDocument?.(null)}>
                Close Document
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
                <StudioMarkdown text={activeViewerDocument.content} hostUrl={hostUrl} extensionSDK={extensionSDK} onOpenSandboxMarkdownFile={(p) => void openViewerDocument?.({ path: p })} />
              </div>
            ) : (
              <pre className="dab-viewer-document-code" data-testid="viewer-document-code"><code>{activeViewerDocument.content}</code></pre>
            )}
          </div>
        </div>
      )}

      <div className="dab-iframe-container" data-testid="ca-embed-preview" style={activePaneKind === 'script' || rightPaneCollapsed || Boolean(activeViewerDocument) ? { display: 'none' } : undefined}>
        <div ref={embedContainerRef} data-testid="looker-embed-container" className="dab-embed-container" style={{ width: '100%', height: '100%', display: hasActiveEmbed ? 'block' : 'none' }} />
        {activePaneKind === 'empty_hidden' ? (
          <div className="dab-placeholder" data-testid="studio-content-tabs-all-hidden">
            <p>All content tabs are hidden</p>
            <p className="dab-muted">Open the menu at the right end of the tab bar to restore any item.</p>
          </div>
        ) : activePaneKind === 'report' ? (
          healthReport ? (
            <div className="dab-tdd-viewer">
              {tddViewMode === 'rendered' ? <div className="dab-tdd-rendered" dangerouslySetInnerHTML={{ __html: renderTddMarkdownToHtml(healthReport.tddMarkdown) }} /> : <pre className="dab-tdd-markdown">{healthReport.tddMarkdown}</pre>}
            </div>
          ) : (
            <div className="dab-placeholder">
              <p>No 3-Pillar Health Check report loaded yet.</p>
              <p className="dab-muted">Click <strong>Run 3-Pillar Audit</strong> in the top-right bar or enter a prompt on the left to execute Pillar 1 (System Activity), Pillar 2 (LookML 0–4 Transcriber Rubric), and Pillar 3 (BigQuery INFORMATION_SCHEMA) in <code>LkrCodeMode</code>.</p>
            </div>
          )
        ) : activePaneKind === 'lookml' ? (
          <LookmlPreviewPane bundle={lookmlBundle} hostUrl={hostUrl} extensionSDK={extensionSDK} canDeploy={canDeployLookml} />
        ) : activePaneKind === 'ca' ? (
          !caConversation && !hasActiveEmbed && (
            <div className="dab-placeholder">
              <p>No active Conversational Analytics chat yet.</p>
              <p className="dab-muted">Ask a data question on the left — a stateless isolated sub-agent will select the best Looker CA Agent, create the conversation, and embed it here.</p>
            </div>
          )
        ) : (
          !hasActiveEmbed && (
            busyStatus ? (
              <div className="dab-placeholder">
                <div className="dab-thinking-logo-card" data-testid="right-pane-thinking-state" role="status" aria-live="polite">
                  <div className="dab-thinking-logo-orb" aria-hidden="true"><Sparkles size={26} strokeWidth={1.75} className="dab-thinking-logo-icon" /></div>
                  <strong className="dab-thinking-logo-title">Thinking...</strong>
                  <span className="dab-muted dab-thinking-logo-subtitle">{busyStatus}</span>
                </div>
              </div>
            ) : (
              <div className="dab-placeholder">
                <p>Ready when you are</p>
                <p className="dab-muted">Ask a question or describe what you want to analyze, build, or automate on the left.</p>
              </div>
            )
          )
        )}
      </div>
    </main>
  )
}
