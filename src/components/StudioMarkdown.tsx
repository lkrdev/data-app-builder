import React, { useState } from 'react'

import { ChattyHostBuilderFactory, getEmbedSDK, ILookerConnection, LookerEmbedExSDK, PageChangedEvent } from '@looker/embed-sdk'
import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import {
  AlertTriangle, Check, Code2, Copy, Database, ExternalLink, Eye, FileText, Kanban, LayoutDashboard,
  MessageSquare, Sparkles, Terminal,
} from 'lucide-react'

import { cleanLookmlProjectId } from '../antigravity'
import {
  copyTextWithExtensionSdk, discoverAccessibleConnections, formatAccessibleConnectionsMarkdown,
  normalizeCaEmbedPath, StudioContentItem, StudioContentItemType,
} from '../lookerApi'
import { StudioController } from '../useStudioController'
export { copyTextWithExtensionSdk }

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
  publishedApp?: { dashboardId: string } | null; alertPreviewUrl?: string; hostUrl?: string; nonce?: number
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
    if (ct === 'alert') {
      return opts.alertPreviewUrl
        ? {
            kind: 'url',
            target: normalizeLookerEmbedUrl(opts.alertPreviewUrl, opts.hostUrl),
            previewMode: 'dashboard',
            previewObjectId: String(item.dashboardId || item.id),
            nonce,
          }
        : preload
    }
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
    case 'alert': return <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'report': return <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
    default: return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  }
}

const CONTENT_TYPE_LABELS: Partial<Record<StudioContentItemType, string>> = {
  lookml_dashboard: 'LookML Dashboard', data_app: 'Data App', 'data-investigator': 'Data Investigator',
  lookml: 'LookML Project', script: 'Python Script', alert: 'Looker Alert', report: 'Health Check Report', 'conversational-analytics': 'Conversational Analytics',
}
export const formatContentTypeLabel = (ct: StudioContentItemType): string => CONTENT_TYPE_LABELS[ct] || ct.charAt(0).toUpperCase() + ct.slice(1)
export const resolveContentLookerPath = (ct: StudioContentItemType, id?: string, embedPath?: string): string =>
  ct === 'lookml' ? (cleanLookmlProjectId(id) ? `/projects/${encodeURIComponent(cleanLookmlProjectId(id))}` : '') : ct !== 'script' && ct !== 'report' && ct !== 'alert' && embedPath ? embedPath.replace(/^\/embed/, '') : ''
