import React, { useEffect, useMemo, useRef, useState } from 'react'

import type { ExtensionSDK } from '@looker/extension-sdk'
import {
  AlertTriangle, AtSign, BookOpen, Check, ChevronDown, Code2, Copy, Database,
  ExternalLink, FileText, Folder, Loader2, MessageSquare, MoreVertical, Paperclip,
  Sparkles, X,
} from 'lucide-react'

import {
  AntigravityActivityStep, cleanLookmlProjectId, normalizeSandboxFilePath, parseAttachmentDataUrl,
} from '../antigravity'
import { HealthCheckReportPayload } from '../healthCheck'
import {
  CaConversationState, copyTextWithExtensionSdk, LkrCodeModeApiCallEntry, NativeContentState,
  PublishedAppState, StudioContentItem,
  StudioContentItemType, StudioContextMention,
} from '../lookerApi'
import { extractSlashSkillIds, LookmlBundle, parseLookmlFileDisplay, renderLineNumberedPre } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import { ChatMessage } from './App'
import {
  StudioBadge, StudioBadgeTone, StudioSkeleton, StudioToolbar,
} from './StudioDesignSystem'
import { extractStepFilePath } from './StudioLeftPane'
import {
  formatContentTypeLabel, InViewerLookerLinkTarget, isSandboxMarkdownPath,
  openContentLinkTargetInViewer, openOrCopyMarkdownLink, parseInViewerLookerLink,
  renderContentTabIcon, resolveContentLookerPath, StudioMarkdown,
} from './StudioMarkdown'

export type LkrCodeModeApiCallLike = Partial<LkrCodeModeApiCallEntry> & Pick<LkrCodeModeApiCallEntry, 'method' | 'route'>
export type OverviewStageSelection =
  | { kind: 'review' }
  | { kind: 'content'; key: string }
  | { kind: 'file'; path: string }
  | { kind: 'api'; id: string }
  | { kind: 'skill'; id: string }
  | null
export interface OverviewReviewSummary {
  kind: 'permission' | 'lookml' | 'files'; title: string; subtitle: string; badgeText: string; badgeTone: StudioBadgeTone
}
export interface OverviewContentRow {
  key: string; id: string; title: string; contentType: StudioContentItemType; typeLabel: string; shortTag: string; hidden: boolean; openInLookerPath: string
}
export interface OverviewFileRow {
  key: string; path: string; label: string; kind: 'lookml' | 'app' | 'script' | 'sandbox'; action?: 'created' | 'updated' | 'deleted'; content?: string; diff?: string
}
export interface OverviewSkillRow { id: string; label: string; path: string }
export interface OverviewApiCallRow {
  id: string; method: string; route: string; status: number | null; ok: boolean; durationMs?: number; source: 'window' | 'turn'
  queryParams?: Record<string, unknown>; body?: unknown; responseBody?: unknown; timestamp?: string
}
export interface OverviewLinkRow { href: string; label: string; meta?: string; inViewerTarget: InViewerLookerLinkTarget | null; isSandboxMd: boolean }
export interface DeriveOverviewInput {
  messages: ReadonlyArray<ChatMessage>; liveActivitySteps?: ReadonlyArray<AntigravityActivityStep>; contentItems?: ReadonlyArray<StudioContentItem>
  publishedApp?: PublishedAppState | null; nativeContent?: NativeContentState | null; lookmlBundle?: LookmlBundle | null
  healthReport?: HealthCheckReportPayload | null; caConversation?: CaConversationState | null; loadedScript?: boolean
  scriptId?: string; scriptTitle?: string; scriptCode?: string; savedScheduleBadge?: string | null; currentAppCode?: string
  activatedLookmlSkills?: ReadonlyArray<string>; selectedExplores?: ReadonlyArray<string>; mentionedItems?: ReadonlyArray<StudioContextMention>
  selectedFolderId?: string; selectedFolderLabel?: string; pastedImages?: ReadonlyArray<{ name?: string; mimeType?: string }>
  pendingPerm?: { req: { operation: string; httpMethod: string; path: string } } | null; windowApiCalls?: ReadonlyArray<LkrCodeModeApiCallLike>; hostUrl?: string; conversationId?: string
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
    const lkProj = cleanLookmlProjectId(lk.project_id)
    reviewItems.push({
      kind: 'lookml', title: `LookML: ${lkProj || lk.title || 'Project'}`,
      subtitle: [`${lk.files?.length || 0} .lkml`, tests.length ? `${passed}/${tests.length} tests` : '', par ? `${par} parity` : ''].filter(Boolean).join(' · '),
      badgeText: ok ? 'LookML valid' : `${errN} ${errN === 1 ? 'error' : 'errors'}`, badgeTone: ok ? 'success' : 'danger',
    })
  }

  const contentRows: OverviewContentRow[] = []
  const pushRow = (r: OverviewContentRow) => { if (!contentRows.some((x) => x.key === r.key)) contentRows.push(r) }
  items.forEach((it) => {
    const lkId = it.contentType === 'lookml' ? cleanLookmlProjectId(it.projectId) || cleanLookmlProjectId(it.id) : ''
    if (it.contentType === 'lookml' && !lkId) return
    pushRow({
      key: it.key, id: it.id, title: it.title, contentType: it.contentType, typeLabel: formatContentTypeLabel(it.contentType),
      shortTag: SHORT_CONTENT_TAGS[it.contentType] || formatContentTypeLabel(it.contentType), hidden: Boolean(it.hidden),
      openInLookerPath: resolveContentLookerPath(it.contentType, it.contentType === 'lookml' ? lkId : it.projectId || it.id, it.embedPath),
    })
  })
  if (!contentRows.length) {
    if (pub?.dashboardId) pushRow({ key: `data_app:${pub.dashboardId}`, id: String(pub.dashboardId), title: pub.title, contentType: 'data_app', typeLabel: 'Data App', shortTag: 'Data App', hidden: false, openInLookerPath: `/dashboards/${encodeURIComponent(String(pub.dashboardId))}` })
    if (nat?.id) pushRow({ key: `${nat.contentType}:${nat.id}`, id: String(nat.id), title: nat.title, contentType: nat.contentType, typeLabel: formatContentTypeLabel(nat.contentType), shortTag: SHORT_CONTENT_TAGS[nat.contentType] || 'Content', hidden: false, openInLookerPath: resolveContentLookerPath(nat.contentType, nat.id, nat.embedPath) })
    if (lk) { const pid = cleanLookmlProjectId(lk.project_id) || cleanLookmlProjectId(lk.id); if (pid) pushRow({ key: `lookml:${pid}`, id: pid, title: lk.title || pid, contentType: 'lookml', typeLabel: 'LookML Project', shortTag: 'LookML', hidden: false, openInLookerPath: `/projects/${encodeURIComponent(pid)}` }) }
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
  lk?.files?.forEach((f) => pushFile({ key: `lookml:${f.path}`, path: f.path, label: f.path, kind: 'lookml', action: f.action || 'updated', content: f.content || f.diff, diff: f.diff }))
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
    if (c.codemode === false || (c.conversation_id && input.conversationId && c.conversation_id !== input.conversationId)) return
    const route = normRoute(c.route), method = String(c.method || 'GET').toUpperCase()
    if (!route || HOUSEKEEPING_API_RE.test(route)) return
    const sig = `${method} ${route}`, resp = c.response
    winCounts.set(sig, (winCounts.get(sig) || 0) + 1)
    apiCalls.push({
      id: `win_${idx}_${sig}`, method, route, status: resp ? resp.status : null, ok: resp ? Boolean(resp.ok) : true,
      durationMs: typeof c.duration_ms === 'number' ? Math.round(c.duration_ms) : undefined, source: 'window',
      queryParams: c.query_params, body: c.body, responseBody: resp?.body, timestamp: c.timestamp,
    })
  })
  allSteps.forEach((st, sIdx) => {
    if (st.kind !== 'codemode' && st.kind !== 'cli_bridge') return
    const hay = [st.content, st.detail, st.title].filter(Boolean).join('\n')
    const stepOut = st.content?.match(/(?:^|\n)# Output\n([\s\S]*)$/)?.[1]?.trim() || undefined
    ENDPOINT_LOG_RE.lastIndex = 0
    let m: RegExpExecArray | null, n = 0
    while ((m = ENDPOINT_LOG_RE.exec(hay)) !== null) {
      const method = m[1].toUpperCase(), route = normRoute(m[2]); if (HOUSEKEEPING_API_RE.test(route)) continue
      n += 1; const sig = `${method} ${route}`, sc = (stepCounts.get(sig) || 0) + 1; stepCounts.set(sig, sc)
      if (sc <= (winCounts.get(sig) || 0)) continue
      apiCalls.push({
        id: `step_${sIdx}_${n}_${sig}`, method, route, status: m[4] ? Number(m[4]) : null, ok: !m[3],
        durationMs: m[5] ? Number(m[5]) : undefined, source: 'turn', responseBody: stepOut,
      })
    }
  })

  const links: OverviewLinkRow[] = [], seenHrefs = new Set<string>()
  const addLink = (rawHref: string, rawLabel?: string, meta?: string) => {
    const href = String(rawHref || '').trim().replace(/[.,;:)'"`]+$/, '')
    if (!href || seenHrefs.has(href) || /(?:^|\/)projects\/default(?:\/|$|[?#])/i.test(href)) return
    const isSandboxMd = isSandboxMarkdownPath(href)
    if (!isSandboxMd && !/^https?:\/\//i.test(href) && !/^\/(?!\/)/.test(href)) return
    seenHrefs.add(href)
    const inViewerTarget = !isSandboxMd ? parseInViewerLookerLink(href, rawLabel, host) : null
    links.push({ href, label: String(rawLabel || '').trim() || inViewerTarget?.title || href.replace(/^https?:\/\/[^/]+/i, '') || href, meta, inViewerTarget, isSandboxMd })
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
    if (q.sql_runner_url || q.sql_slug) addLink(q.sql_runner_url || `/sql/${q.sql_slug}`, p, 'SQL')
    if (q.explore_url || q.explore_slug) addLink(q.explore_url || `/x/${q.explore_slug}`, p, 'Explore')
  })
  for (const r of contentRows) {
    if (r.openInLookerPath && /^\/(?:dashboards|looks)\//i.test(r.openInLookerPath)) {
      addLink(r.openInLookerPath, `Open ${r.title}`, r.shortTag)
    }
  }

  const uploads: Array<{ key: string; label: string; sub: string }> = []
  let imgN = 0
  msgs.forEach((m, mi) => m.images?.forEach((src, ii) => { imgN += 1; uploads.push({ key: `m_${mi}_${ii}`, label: parseAttachmentDataUrl(src).name || `Screenshot #${imgN}`, sub: `Turn ${Math.floor(mi / 2) + 1}` }) }))
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

export type DerivedOverviewData = ReturnType<typeof deriveConversationOverviewData>

export const EMPTY_WIN_CALLS: ReadonlyArray<LkrCodeModeApiCallLike> = []

export const formatPrettyPayload = (val: unknown): string => {
  if (val === undefined || val === null) return ''
  if (typeof val === 'string') {
    const t = val.trim()
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.stringify(JSON.parse(t), null, 2) } catch { return val }
    }
    return val
  }
  try { return JSON.stringify(val, null, 2) } catch { return String(val) }
}

export const StudioOverviewSidebar: React.FC<{
  ctl: StudioController; allTabsHidden?: boolean; collapseToggleBtn?: React.ReactNode
  data: DerivedOverviewData
  docked?: boolean; hiddenInStage?: boolean; mobileOverlayOpen?: boolean; activeSelection?: OverviewStageSelection
  openSecs: Record<string, boolean>; setOpenSecs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  showAll: Record<string, boolean>; setShowAll: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  hiddenSecs: Record<string, boolean | undefined>; setHiddenSecs: React.Dispatch<React.SetStateAction<Record<string, boolean | undefined>>>
  onOpenContentLinkInViewer: (target: InViewerLookerLinkTarget) => void
  onOpenReview: () => void
  onSelectContentRow: (row: OverviewContentRow) => void
  onSelectLookmlFile: (path: string) => void
  onOpenApiCall: (call: OverviewApiCallRow) => void
  onCloseDockedExplorer: () => void
}> = ({
  ctl, allTabsHidden = false, collapseToggleBtn, data,
  docked = false, hiddenInStage = false, mobileOverlayOpen = false, activeSelection = null,
  openSecs, setOpenSecs, showAll, setShowAll, hiddenSecs, setHiddenSecs,
  onOpenContentLinkInViewer, onOpenReview, onSelectContentRow, onSelectLookmlFile, onOpenApiCall, onCloseDockedExplorer,
}) => {
  const { messages, busyStatus, extensionSDK, hydratingInteractionIds, hydrateMessageActivitySteps, openViewerDocument, isAuthenticated } = ctl
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || (typeof window !== 'undefined' ? window.location.origin : '')
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

  const isHydratingAny = messages.some((m) => Boolean(m.interactionId && hydratingInteractionIds?.[m.interactionId]))
  const hasExplicitCtx = data.context.explores.length > 0 || data.context.mentions.length > 0 || Boolean(data.context.caAgentLabel)
  const isSecOpen = (k: string, defOpen = true) => (k in openSecs ? Boolean(openSecs[k]) : defOpen)
  const toggleSec = (k: string, defOpen = true) => setOpenSecs((p) => ({ ...p, [k]: !(k in p ? p[k] : defOpen) }))
  const toggleAll = (k: string) => setShowAll((p) => ({ ...p, [k]: !p[k] }))
  const onFile = (row: OverviewFileRow) => {
    if (row.kind === 'lookml') { onSelectLookmlFile(row.path); return }
    void openViewerDocument({ path: row.path, title: row.label, kind: 'file', content: row.content })
  }
  const matchesSelectedFile = (rowPath: string) => {
    if (activeSelection?.kind !== 'file') return false
    const a = normalizeSandboxFilePath(activeSelection.path) || activeSelection.path.replace(/^\/+/, '')
    const b = normalizeSandboxFilePath(rowPath) || rowPath.replace(/^\/+/, '')
    return a === b
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

  const isReviewActive = activeSelection?.kind === 'review'

  return (
    <div
      className={`dab-ov ${docked ? 'dab-ov-docked' : ''} ${mobileOverlayOpen ? 'dab-ov-mobile-open' : ''}`}
      data-testid="studio-overview-sidebar"
      data-docked={docked ? 'true' : 'false'}
      style={hiddenInStage ? { display: 'none' } : undefined}
      role="region"
      aria-label="Conversation overview"
    >
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
            {docked ? (
              <button
                type="button" data-testid="overview-docked-hide-btn" className="dab-ov-icon-btn"
                aria-label="Hide Overview explorer" title="Hide Overview explorer"
                onClick={onCloseDockedExplorer}
              >
                <X size={13} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : (
              collapseToggleBtn
            )}
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
            <button
              type="button"
              data-testid="overview-nav-review"
              aria-current={isReviewActive ? 'true' : undefined}
              className={`dab-ov-row ${isReviewActive ? 'active' : ''}`}
              disabled={!data.primaryReview}
              onClick={onOpenReview}
            >
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
              {visContent.map((row) => {
                const isRowActive = activeSelection?.kind === 'content' && activeSelection.key === row.key
                return (
                  <div key={row.key} className="dab-ov-grp">
                    <button
                      type="button"
                      data-testid={`overview-content-item-${row.key}`}
                      aria-current={isRowActive ? 'true' : undefined}
                      className={`dab-ov-row ${isRowActive ? 'active' : ''}`}
                      onClick={() => onSelectContentRow(row)}
                      title={`${row.title} (${row.typeLabel})`}
                    >
                      <span className="dab-ov-ic">{renderContentTabIcon(row.contentType)}</span>
                      <span className="dab-ov-txt">{row.title}</span>
                      <span className="dab-ov-meta">{row.shortTag}</span>
                    </button>
                    {row.openInLookerPath && (
                      <button type="button" data-testid={`overview-content-external-${row.key}`} className="dab-ov-icon-btn" title="Open in Looker" aria-label={`Open ${row.title} in Looker`} onClick={(e) => { e.stopPropagation(); void openOrCopyMarkdownLink(row.openInLookerPath, hostUrl, extensionSDK) }}>
                        <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )
              })}
              {data.contentRows.length > 4 && <button type="button" className="dab-ov-more" onClick={() => toggleAll('content')}>{showAll.content ? 'Show fewer' : `See all (${data.contentRows.length})`}</button>}
            </OvSec>
          )}

          {!hiddenSecs.files && data.changedFiles.length > 0 && (
            <OvSec testId="overview-section-files" title="Changed Files" count={data.changedFiles.length} open={isSecOpen('files', true)} onToggle={() => toggleSec('files', true)}>
              {visFiles.map((row, idx) => {
                const isFileActive = matchesSelectedFile(row.path)
                const hoverPath = row.label || row.path
                const parsed = parseLookmlFileDisplay(hoverPath)
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-testid={`overview-file-item-${idx}`}
                    aria-current={isFileActive ? 'true' : undefined}
                    aria-label={row.action ? `${hoverPath} (${row.action})` : hoverPath}
                    className={`dab-ov-row ${isFileActive ? 'active' : ''}`}
                    onClick={() => onFile(row)}
                    title={hoverPath}
                  >
                    <span className="dab-ov-ic">
                      {parsed.letter ? (
                        <span className="dab-lkml-kind-badge" data-kind={parsed.letter} aria-hidden="true">{parsed.letter}</span>
                      ) : row.kind === 'sandbox' && /\.md$/i.test(row.path) ? (
                        <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
                      ) : (
                        <Code2 size={13} strokeWidth={1.75} aria-hidden="true" />
                      )}
                    </span>
                    <span className="dab-ov-txt dab-ov-mono">{parsed.stem}</span>
                    {row.action && <span className="dab-ov-stat" style={{ color: row.action === 'created' ? 'var(--dab-success-text)' : row.action === 'deleted' ? 'var(--dab-danger-text)' : 'var(--dab-accent-text)' }}>{row.action === 'created' ? '+' : row.action === 'deleted' ? '-' : 'M'}</span>}
                  </button>
                )
              })}
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
                {visCalls.map((call, idx) => {
                  const isApiActive = activeSelection?.kind === 'api' && activeSelection.id === call.id
                  return (
                    <button
                      key={call.id}
                      type="button"
                      data-testid={`overview-api-call-${idx}`}
                      aria-current={isApiActive ? 'true' : undefined}
                      className={`dab-ov-row ${!call.ok ? 'dab-ov-err' : ''} ${isApiActive ? 'active' : ''}`}
                      onClick={() => onOpenApiCall(call)}
                      title={`${call.method} ${call.route}${call.status ? ` (${call.status})` : ''}`}
                    >
                      <span className={`dab-ov-mth dab-ov-mth-${call.ok ? call.method.toLowerCase() : 'err'}`}>{call.method}</span>
                      <span className="dab-ov-txt dab-ov-mono">{call.route}</span>
                      <span className="dab-ov-meta">{call.status && call.status >= 400 ? `${call.status}` : call.durationMs !== undefined ? `${call.durationMs}ms` : call.status ? `${call.status}` : ''}</span>
                    </button>
                  )
                })}
              </div>
              {data.apiCalls.length > 5 && <button type="button" data-testid="overview-api-calls-toggle-all" className="dab-ov-more" onClick={() => toggleAll('api')}>{showAll.api ? 'Show fewer' : `See all (${data.apiCalls.length})`}</button>}
            </OvSec>
          )}

          {!hiddenSecs.skills && data.skillsUsed.length > 0 && (
            <OvSec testId="overview-section-skills" title="Skills Used" count={data.skillsUsed.length} open={isSecOpen('skills', true)} onToggle={() => toggleSec('skills', true)}>
              {data.skillsUsed.map((sk) => {
                const isSkillActive = activeSelection?.kind === 'skill' && activeSelection.id === sk.id
                return (
                  <button
                    key={sk.id}
                    type="button"
                    data-testid={`overview-skill-item-${sk.id}`}
                    aria-current={isSkillActive ? 'true' : undefined}
                    className={`dab-ov-row ${isSkillActive ? 'active' : ''}`}
                    onClick={() => void openViewerDocument({ path: sk.path, title: sk.label, kind: 'skill' })}
                    title={sk.path}
                  >
                    <span className="dab-ov-ic"><BookOpen size={13} strokeWidth={1.75} aria-hidden="true" /></span>
                    <span className="dab-ov-txt dab-ov-mono">{sk.label}</span>
                  </button>
                )
              })}
            </OvSec>
          )}

          {showCtxSec && (
            <OvSec testId="overview-section-context" title="Data Context" count={data.context.contextCount} open={isSecOpen('context', hasExplicitCtx)} onToggle={() => toggleSec('context', hasExplicitCtx)}>
              {data.context.explores.map((exp) => {
                const parts = exp.split('::')
                const tgt = parts[0] && parts[1] ? parseInViewerLookerLink(`/explore/${parts[0]}/${parts[1]}`, exp, hostUrl) : null
                return (
                  <button key={exp} type="button" data-testid={`overview-explore-${exp}`} className="dab-ov-row" onClick={() => { if (tgt) onOpenContentLinkInViewer(tgt) }} title={`Explore ${exp}`}>
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
                      if (lnk.inViewerTarget) { onOpenContentLinkInViewer(lnk.inViewerTarget); return }
                      if (lnk.isSandboxMd) { void openViewerDocument({ path: lnk.href }); return }
                      void openOrCopyMarkdownLink(lnk.href, hostUrl, extensionSDK)
                    }}
                  >
                    <span className="dab-ov-ic">{lnk.inViewerTarget ? renderContentTabIcon(lnk.inViewerTarget.contentType) : lnk.isSandboxMd ? <FileText size={13} strokeWidth={1.75} aria-hidden="true" /> : <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />}</span>
                    <span className="dab-ov-txt">{lnk.label}</span>
                    {lnk.meta && <span className="dab-ov-meta">{lnk.meta}</span>}
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

export const StudioViewerDocumentStagePane: React.FC<{
  ctl: StudioController
  activeViewerDocument: NonNullable<StudioController['activeViewerDocument']>
  setActiveViewerDocument?: StudioController['setActiveViewerDocument']
  openViewerDocument?: StudioController['openViewerDocument']
  docViewMode: 'rendered' | 'raw'
  setDocViewMode: React.Dispatch<React.SetStateAction<'rendered' | 'raw'>>
  copiedDoc: boolean
  setCopiedDoc: React.Dispatch<React.SetStateAction<boolean>>
  hostUrl: string
  extensionSDK: ExtensionSDK
  toggleExplorerBtn: React.ReactNode
  collapseToggleBtn: React.ReactNode
}> = ({
  ctl,
  activeViewerDocument,
  setActiveViewerDocument,
  openViewerDocument,
  docViewMode,
  setDocViewMode,
  copiedDoc,
  setCopiedDoc,
  hostUrl,
  extensionSDK,
  toggleExplorerBtn,
  collapseToggleBtn,
}) => (
            <div className="dab-viewer-document-pane" data-testid="viewer-document-pane">
              <StudioToolbar
                testId="viewer-document-header"
                className="dab-stage-compact-bar"
                title={
                  <>
                    <strong data-testid="viewer-document-title">{activeViewerDocument.title}</strong>
                    <StudioBadge tone="accent" testId="viewer-document-path-badge" className="dab-doc-path-pill">{activeViewerDocument.displayPath}</StudioBadge>
                  </>
                }
                actions={
                  <>
                    {activeViewerDocument.isMarkdown && !activeViewerDocument.loading && (
                      <div className="dab-seg-group" role="group" aria-label="Document view mode">
                        <button
                          type="button"
                          data-testid="viewer-document-mode-rendered"
                          aria-pressed={docViewMode === 'rendered'}
                          className={`dab-seg-btn ${docViewMode === 'rendered' ? 'active' : ''}`}
                          onClick={() => setDocViewMode('rendered')}
                        >
                          Rendered
                        </button>
                        <button
                          type="button"
                          data-testid="viewer-document-mode-raw"
                          aria-pressed={docViewMode === 'raw'}
                          className={`dab-seg-btn ${docViewMode === 'raw' ? 'active' : ''}`}
                          onClick={() => setDocViewMode('raw')}
                        >
                          Raw
                        </button>
                      </div>
                    )}
                    {!activeViewerDocument.loading && activeViewerDocument.content && (
                      <button
                        type="button"
                        data-testid="viewer-document-copy-btn"
                        className="dab-btn dab-btn-secondary dab-btn-icon"
                        title={copiedDoc ? 'Copied!' : 'Copy file'}
                        aria-label="Copy file"
                        onClick={() => {
                          void copyTextWithExtensionSdk(activeViewerDocument.content, extensionSDK)
                          setCopiedDoc(true)
                          setTimeout(() => setCopiedDoc(false), 1800)
                        }}
                      >
                        {copiedDoc ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
                      </button>
                    )}
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
                    {toggleExplorerBtn}
                    {collapseToggleBtn}
                  </>
                }
              />
              <div className="dab-viewer-document-body" data-testid="viewer-document-body">
                {activeViewerDocument.loading ? (
                  <div className="dab-viewer-document-loading" data-testid="viewer-document-loading">
                    <StudioSkeleton width="100%" height={32} /><span className="dab-muted">Loading from sandbox...</span>
                  </div>
                ) : activeViewerDocument.isMarkdown && docViewMode === 'rendered' ? (
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
                  <div className="dab-viewer-document-code-wrap" data-testid="viewer-document-code">
                    {renderLineNumberedPre(activeViewerDocument.content)}
                  </div>
                )}
              </div>
            </div>
)
