import type { ILookmlModel } from '@looker/sdk'

import {
  ConversationRecord, formatExploreId, StudioContentItem, StudioContextCategory, StudioContextMention,
} from '../lookerApi'
import { LookmlSkillCatalogEntry, STUDIO_SLASH_SKILLS } from '../lookmlTool'

export const AT_MENTION_DETECT_RE = /(?:^|\s)@(?:(explore|dashboard|look|conversation):([^\n@]*)|([^\s@]*))$/i
export const SLASH_SKILL_DETECT_RE = /(?:^|\s)\/([a-z0-9_-]*)$/i

export type ComposerPillKind = 'slash' | 'mention'

export interface ComposerPillSpec {
  pillKind: ComposerPillKind; tokenId: string; label: string; rawValue: string; mentionType?: StudioContextCategory
}

export type ComposerRawSegment = { kind: 'text'; text: string } | ({ kind: 'pill' } & ComposerPillSpec)
export type ComposerSegment = { kind: 'text'; text: string; start: number; end: number } | ({ kind: 'pill'; start: number; end: number } & ComposerPillSpec)

export interface ComposerHydrationContext {
  slashSkills?: readonly LookmlSkillCatalogEntry[]
  mentionedItems?: readonly StudioContextMention[]
  exploreLookup?: Record<string, { id: string; label: string; modelLabel: string; model: string; explore: string }>
  selectedExplores?: readonly string[]
  preloadedContent?: readonly StudioContextMention[]
  contentItems?: readonly StudioContentItem[]
  conversations?: ReadonlyArray<{ id: string; label?: string }>
}

export interface DetectedMentionState {
  open: boolean; category: StudioContextCategory | 'all'; query: string; tokenStart: number; tokenEnd: number
}

export interface DetectedSlashSkillState {
  open: boolean; query: string; tokenStart: number; tokenEnd: number
}

interface DabComposerAugmentedElement extends HTMLElement {
  __dabComposerPropsDefined?: boolean; __dabSelStart?: number; __dabSelEnd?: number
  __dabGetHydrationCtx?: () => ComposerHydrationContext
  value?: string; selectionStart?: number; selectionEnd?: number; disabled?: boolean
  setSelectionRange?: (start: number, end?: number) => void
}

export function withSegmentOffsets(raw: readonly ComposerRawSegment[]): ComposerSegment[] {
  const merged: ComposerRawSegment[] = []
  for (const item of raw) {
    if (item.kind === 'text') {
      if (!item.text) continue
      const prev = merged[merged.length - 1]
      if (prev && prev.kind === 'text') prev.text += item.text
      else merged.push({ kind: 'text', text: item.text })
    } else if (item.rawValue) {
      merged.push({ ...item })
    }
  }
  const out: ComposerSegment[] = []
  let pos = 0
  for (const item of merged) {
    const len = item.kind === 'text' ? item.text.length : item.rawValue.length
    out.push({ ...item, start: pos, end: pos + len })
    pos += len
  }
  return out
}

export function serializeComposerSegments(segments: readonly ComposerRawSegment[]): string {
  let out = ''
  for (const seg of segments) out += seg.kind === 'text' ? seg.text : seg.rawValue
  return out
}

export function collectPillKeySet(segments: readonly ComposerRawSegment[]): Set<string> {
  const keys = new Set<string>()
  for (const seg of segments) if (seg.kind === 'pill') keys.add(`${seg.pillKind}:${seg.tokenId}`)
  return keys
}

export function diffRemovedPills(
  prevKeys: ReadonlySet<string>,
  nextSegments: readonly ComposerRawSegment[]
): { nextKeys: Set<string>; removedSlash: string[]; removedMentions: string[] } {
  const nextKeys = collectPillKeySet(nextSegments)
  const removedSlash: string[] = []
  const removedMentions: string[] = []
  prevKeys.forEach((key) => {
    if (nextKeys.has(key)) return
    if (key.startsWith('slash:')) removedSlash.push(key.slice(6))
    else if (key.startsWith('mention:')) removedMentions.push(key.slice(8))
  })
  return { nextKeys, removedSlash, removedMentions }
}

export function removeMentionPillFromSegments(
  segments: readonly ComposerSegment[],
  tokenId: string
): { segments: ComposerSegment[]; prompt: string; changed: boolean } {
  let changed = false
  const raw: ComposerRawSegment[] = []
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (
      seg.kind === 'pill' &&
      seg.pillKind === 'mention' &&
      (seg.tokenId === tokenId || (tokenId === 'explore:*' && seg.mentionType === 'explore'))
    ) {
      changed = true
      const next = segments[i + 1]
      if (next && next.kind === 'text' && next.text.startsWith(' ')) {
        if (next.text.length > 1) raw.push({ kind: 'text', text: next.text.slice(1) })
        i += 1
      }
      continue
    }
    raw.push(seg)
  }
  const updated = withSegmentOffsets(raw)
  return { segments: updated, prompt: serializeComposerSegments(updated), changed }
}

export function appendScopedPrefixToSegments(
  segments: readonly ComposerSegment[],
  category: StudioContextCategory
): { segments: ComposerSegment[]; prompt: string; cursorPos: number } {
  const token = `@${category}:`
  const raw: ComposerRawSegment[] = segments.map((s) => (s.kind === 'text' ? { kind: 'text', text: s.text } : { ...s }))
  while (raw.length > 0 && raw[raw.length - 1].kind === 'text') {
    const last = raw[raw.length - 1] as { kind: 'text'; text: string }
    const trimmed = last.text.replace(/\s+$/, '')
    if (trimmed) { last.text = trimmed; break }
    raw.pop()
  }
  raw.push({ kind: 'text', text: raw.length > 0 ? ` ${token}` : token })
  const next = withSegmentOffsets(raw)
  const prompt = serializeComposerSegments(next)
  return { segments: next, prompt, cursorPos: prompt.length }
}

export function segmentsSignature(segments: readonly ComposerSegment[]): string {
  return segments.map((s) => (s.kind === 'text' ? `T:${s.text}` : `P:${s.pillKind}:${s.tokenId}:${s.rawValue}`)).join('\u0001')
}

interface MentionCandidate {
  rawLower: string
  tokenId: string
  label: string
  mentionType: StudioContextCategory
}

function buildMentionCandidates(ctx?: ComposerHydrationContext): MentionCandidate[] {
  if (!ctx) return []
  const map = new Map<string, MentionCandidate>()
  const add = (mentionType: StudioContextCategory, id: string, label: string, rawToken: string) => {
    const cleanId = String(id || '').trim()
    const cleanLabel = String(label || '').trim()
    const cleanRaw = String(rawToken || '').trim()
    if (!cleanId || !cleanLabel || cleanRaw.length <= mentionType.length + 2) return
    const rawLower = cleanRaw.toLowerCase()
    if (!map.has(rawLower)) map.set(rawLower, { rawLower, tokenId: `${mentionType}:${cleanId}`, label: cleanLabel, mentionType })
  }
  for (const item of ctx.mentionedItems || []) {
    add(item.type, item.id, item.title, `@${item.type}:${item.title}`)
    add(item.type, item.id, item.title, `@${item.type}:${item.id}`)
  }
  for (const info of Object.values(ctx.exploreLookup || {})) {
    add('explore', info.id, info.label, `@explore:${info.label}`)
    add('explore', info.id, `${info.modelLabel}: ${info.label}`, `@explore:${info.modelLabel}: ${info.label}`)
    add('explore', info.id, info.label, `@explore:${info.id}`)
  }
  for (const expId of ctx.selectedExplores || []) {
    const info = ctx.exploreLookup?.[expId]
    add('explore', expId, info ? info.label : expId, `@explore:${expId}`)
  }
  for (const item of ctx.preloadedContent || []) add(item.type, item.id, item.title, `@${item.type}:${item.title}`)
  for (const ci of ctx.contentItems || []) {
    const mType: StudioContextCategory | null =
      ci.contentType === 'dashboard' || ci.contentType === 'lookml_dashboard' ? 'dashboard'
        : ci.contentType === 'look' ? 'look'
        : ci.contentType === 'explore' ? 'explore'
        : null
    const ciId = ci.dashboardId || ci.lookmlDashboardId || ci.lookId || ci.exploreId || ci.id
    if (mType && ciId && ci.title) {
      add(mType, ciId, ci.title, `@${mType}:${ci.title}`)
      add(mType, ciId, ci.title, `@${mType}:${ciId}`)
    }
  }
  for (const conv of ctx.conversations || []) {
    if (conv.label) add('conversation', conv.id, conv.label, `@conversation:${conv.label}`)
    add('conversation', conv.id, conv.label || conv.id, `@conversation:${conv.id}`)
  }
  return Array.from(map.values()).sort((a, b) => b.rawLower.length - a.rawLower.length)
}

export function resolveHydratedPills(
  segments: readonly ComposerRawSegment[],
  ctx?: ComposerHydrationContext
): { slashIds: string[]; mentions: StudioContextMention[]; exploreIds: string[] } {
  const slashIds: string[] = []
  const mentions: StudioContextMention[] = []
  const exploreIds: string[] = []
  const seenMentions = new Set<string>()
  for (const seg of segments) {
    if (seg.kind !== 'pill') continue
    if (seg.pillKind === 'slash') {
      if (seg.tokenId && !slashIds.includes(seg.tokenId)) slashIds.push(seg.tokenId)
    } else if (seg.mentionType && seg.tokenId.startsWith(`${seg.mentionType}:`)) {
      const id = seg.tokenId.slice(seg.mentionType.length + 1)
      if (!id || seenMentions.has(seg.tokenId)) continue
      seenMentions.add(seg.tokenId)
      const known =
        ctx?.mentionedItems?.find((m) => m.type === seg.mentionType && m.id === id) ||
        ctx?.preloadedContent?.find((m) => m.type === seg.mentionType && m.id === id)
      const exp = seg.mentionType === 'explore' ? ctx?.exploreLookup?.[id] : undefined
      mentions.push(
        known ?? {
          type: seg.mentionType, id, title: seg.label || id,
          ...(exp ? { subtitle: exp.modelLabel, model: exp.model, explore: exp.explore } : {}),
        }
      )
      if (seg.mentionType === 'explore' && !exploreIds.includes(id)) exploreIds.push(id)
    }
  }
  return { slashIds, mentions, exploreIds }
}

export function parsePromptIntoSegments(prompt: string, ctx?: ComposerHydrationContext): ComposerSegment[] {
  const text = String(prompt || '')
  if (!text) return []
  const slashById = new Map((ctx?.slashSkills ?? STUDIO_SLASH_SKILLS).map((sk) => [sk.id.toLowerCase(), sk]))
  const mentionCandidates = buildMentionCandidates(ctx)
  const lowerText = text.toLowerCase()
  const raw: ComposerRawSegment[] = []
  let plainStart = 0
  let i = 0
  while (i < text.length) {
    const atBoundary = i === 0 || /\s/.test(text[i - 1])
    if (atBoundary && text[i] === '/') {
      const m = text.slice(i).match(/^\/([a-z0-9_-]+)(?=\s|$)/i)
      const hit = m ? slashById.get(m[1].toLowerCase()) : undefined
      if (m && hit) {
        if (i > plainStart) raw.push({ kind: 'text', text: text.slice(plainStart, i) })
        raw.push({ kind: 'pill', pillKind: 'slash', tokenId: hit.id, label: hit.id, rawValue: text.slice(i, i + m[0].length) })
        i += m[0].length
        plainStart = i
        continue
      }
    }
    if (atBoundary && text[i] === '@' && mentionCandidates.length > 0) {
      const matched = mentionCandidates.find((c) => {
        const end = i + c.rawLower.length
        return end <= text.length && lowerText.startsWith(c.rawLower, i) && (end === text.length || /\s/.test(text[end]))
      })
      if (matched) {
        if (i > plainStart) raw.push({ kind: 'text', text: text.slice(plainStart, i) })
        const end = i + matched.rawLower.length
        raw.push({ kind: 'pill', pillKind: 'mention', mentionType: matched.mentionType, tokenId: matched.tokenId, label: matched.label, rawValue: text.slice(i, end) })
        i = end
        plainStart = i
        continue
      }
    }
    i += 1
  }
  if (plainStart < text.length) raw.push({ kind: 'text', text: text.slice(plainStart) })
  return withSegmentOffsets(raw)
}

export function getActivePlainTextRun(segments: readonly ComposerSegment[], cursorPos: number): { text: string; offset: number } {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  const pos = Math.max(0, Math.min(cursorPos, totalLen))
  let lastPillEnd = 0
  for (const seg of segments) {
    if (seg.kind === 'pill' && seg.start < pos) {
      if (pos <= seg.end) return { text: '', offset: pos }
      lastPillEnd = seg.end
    }
  }
  let text = ''
  for (const seg of segments) {
    if (seg.kind === 'text' && seg.end > lastPillEnd && seg.start < pos) {
      text += seg.text.slice(Math.max(0, lastPillEnd - seg.start), Math.min(seg.text.length, pos - seg.start))
    }
  }
  return { text, offset: lastPillEnd }
}

export function detectActiveMention(
  segments: readonly ComposerSegment[],
  cursorPos: number,
  dismissedTriggerStart: number | null,
  forceMentionCategory: StudioContextCategory | 'all' | null
): DetectedMentionState {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  const pos = Math.max(0, Math.min(cursorPos, totalLen))
  const run = getActivePlainTextRun(segments, pos)
  const m = run.text.match(AT_MENTION_DETECT_RE)
  if (m) {
    const tokenStart = run.offset + run.text.lastIndexOf('@')
    if (dismissedTriggerStart !== tokenStart) {
      const category = (m[1]?.toLowerCase() as StudioContextCategory | undefined) || 'all'
      const query = (m[1] ? m[2] || '' : m[3] || '').trim()
      return { open: true, category, query, tokenStart, tokenEnd: pos }
    }
  }
  return { open: forceMentionCategory !== null, category: forceMentionCategory ?? 'all', query: '', tokenStart: totalLen, tokenEnd: totalLen }
}

export function detectActiveSlashSkill(
  segments: readonly ComposerSegment[],
  cursorPos: number,
  dismissedTriggerStart: number | null,
  mentionOpen: boolean
): DetectedSlashSkillState {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  if (mentionOpen) return { open: false, query: '', tokenStart: totalLen, tokenEnd: totalLen }
  const pos = Math.max(0, Math.min(cursorPos, totalLen))
  const run = getActivePlainTextRun(segments, pos)
  const m = run.text.match(SLASH_SKILL_DETECT_RE)
  if (!m) return { open: false, query: '', tokenStart: totalLen, tokenEnd: totalLen }
  const tokenStart = run.offset + run.text.lastIndexOf('/')
  if (dismissedTriggerStart === tokenStart) return { open: false, query: '', tokenStart: totalLen, tokenEnd: totalLen }
  return { open: true, query: (m[1] || '').toLowerCase(), tokenStart, tokenEnd: pos }
}

function sliceSegmentsRange(segments: readonly ComposerSegment[], from: number, to: number): ComposerRawSegment[] {
  const out: ComposerRawSegment[] = []
  for (const seg of segments) {
    if (seg.end <= from || seg.start >= to) continue
    if (seg.kind === 'pill') {
      out.push({ kind: 'pill', pillKind: seg.pillKind, tokenId: seg.tokenId, label: seg.label, rawValue: seg.rawValue, mentionType: seg.mentionType })
    } else {
      const s = Math.max(0, from - seg.start)
      const e = Math.min(seg.text.length, to - seg.start)
      if (e > s) out.push({ kind: 'text', text: seg.text.slice(s, e) })
    }
  }
  return out
}

export function splicePillIntoSegments(
  segments: readonly ComposerSegment[],
  tokenStart: number,
  tokenEnd: number,
  pill: ComposerPillSpec
): { segments: ComposerSegment[]; prompt: string; cursorPos: number } {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  const start = Math.max(0, Math.min(tokenStart, totalLen))
  const end = Math.max(start, Math.min(tokenEnd, totalLen))
  const before = sliceSegmentsRange(segments, 0, start)
  const after = sliceSegmentsRange(segments, end, totalLen)
  const beforeStr = serializeComposerSegments(before)
  if (beforeStr.length > 0 && !/\s$/.test(beforeStr)) before.push({ kind: 'text', text: ' ' })
  if (after.length > 0 && after[0].kind === 'text' && after[0].text.startsWith(' ')) {
    after[0] = { kind: 'text', text: after[0].text.slice(1) }
  }
  const combined = withSegmentOffsets([...before, { kind: 'pill', ...pill }, { kind: 'text', text: ' ' }, ...after])
  return { segments: combined, prompt: serializeComposerSegments(combined), cursorPos: serializeComposerSegments(before).length + pill.rawValue.length + 1 }
}

export function replaceSegmentRange(
  segments: readonly ComposerSegment[],
  start: number,
  end: number,
  insertedText: string = ''
): { segments: ComposerSegment[]; prompt: string; cursorPos: number; removedPills: ComposerPillSpec[] } {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  const s = Math.max(0, Math.min(start, totalLen))
  const e = Math.max(s, Math.min(end, totalLen))
  const touched = segments.filter((seg): seg is Extract<ComposerSegment, { kind: 'pill' }> => seg.kind === 'pill' && seg.end > s && seg.start < e)
  const cutStart = touched.length > 0 ? Math.min(s, ...touched.map((p) => p.start)) : s
  const cutEnd = touched.length > 0 ? Math.max(e, ...touched.map((p) => p.end)) : e
  const before = sliceSegmentsRange(segments, 0, cutStart)
  const mid: ComposerRawSegment[] = insertedText ? [{ kind: 'text', text: insertedText }] : []
  const next = withSegmentOffsets([...before, ...mid, ...sliceSegmentsRange(segments, cutEnd, totalLen)])
  return { segments: next, prompt: serializeComposerSegments(next), cursorPos: serializeComposerSegments(before).length + insertedText.length, removedPills: touched }
}

export function applyComposerBackspaceOrDelete(
  segments: readonly ComposerSegment[],
  selStart: number,
  selEnd: number,
  key: 'Backspace' | 'Delete'
): { segments: ComposerSegment[]; prompt: string; cursorPos: number; removedPills: ComposerPillSpec[] } | null {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  const start = Math.max(0, Math.min(selStart, totalLen))
  const end = Math.max(start, Math.min(selEnd, totalLen))

  if (start !== end) {
    const replaced = replaceSegmentRange(segments, start, end)
    return replaced.removedPills.length > 0 ? replaced : null
  }

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (seg.kind !== 'pill') continue
    if ((key === 'Backspace' && start === seg.end) || (key === 'Delete' && start === seg.start)) {
      const next = withSegmentOffsets(segments.filter((_, idx) => idx !== i))
      return { segments: next, prompt: serializeComposerSegments(next), cursorPos: seg.start, removedPills: [seg] }
    }
    if (key === 'Backspace' && start === seg.end + 1) {
      const nextSeg = segments[i + 1]
      if (nextSeg && nextSeg.kind === 'text' && nextSeg.text.length > 0) {
        const raw = segments.flatMap<ComposerRawSegment>((s, idx) =>
          idx === i + 1 && s.kind === 'text' ? (s.text.length > 1 ? [{ kind: 'text', text: s.text.slice(1) }] : []) : [s]
        )
        const next = withSegmentOffsets(raw)
        return { segments: next, prompt: serializeComposerSegments(next), cursorPos: seg.end, removedPills: [] }
      }
    }
  }
  return null
}

export function stepComposerArrowAcrossPill(
  segments: readonly ComposerSegment[],
  selStart: number,
  selEnd: number,
  key: 'ArrowLeft' | 'ArrowRight'
): number | null {
  if (selStart !== selEnd) return null
  for (const seg of segments) {
    if (seg.kind !== 'pill') continue
    if (key === 'ArrowLeft' && selStart === seg.end) return seg.start
    if (key === 'ArrowRight' && selStart === seg.start) return seg.end
  }
  return null
}

export function sliceComposerPrompt(segments: readonly ComposerSegment[], from: number, to: number): string {
  const totalLen = segments.length > 0 ? segments[segments.length - 1].end : 0
  const s = Math.max(0, Math.min(from, totalLen))
  return serializeComposerSegments(sliceSegmentsRange(segments, s, Math.max(s, Math.min(to, totalLen))))
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const PILL_SVG_SHAPES: Record<string, ReadonlyArray<readonly [string, Record<string, string>]>> = {
  slash: [['path', { d: 'm18 16 4-4-4-4' }], ['path', { d: 'm6 8-4 4 4 4' }], ['path', { d: 'm14.5 4-5 16' }]],
  explore: [['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }], ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }], ['path', { d: 'M3 12A9 3 0 0 0 21 12' }]],
  dashboard: [['rect', { width: '7', height: '9', x: '3', y: '3', rx: '1' }], ['rect', { width: '7', height: '5', x: '14', y: '3', rx: '1' }], ['rect', { width: '7', height: '9', x: '14', y: '12', rx: '1' }], ['rect', { width: '7', height: '5', x: '3', y: '16', rx: '1' }]],
  look: [['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
  conversation: [['path', { d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z' }]],
}

export function createInlinePillElement(doc: Document, spec: ComposerPillSpec): HTMLSpanElement {
  const span = doc.createElement('span')
  span.setAttribute('contenteditable', 'false')
  span.className = 'dab-inline-token-pill'
  span.setAttribute('data-testid', 'composer-inline-pill')
  span.setAttribute('data-token-kind', spec.pillKind)
  span.setAttribute('data-token-id', spec.tokenId)
  span.setAttribute('data-token-value', spec.rawValue)
  span.setAttribute('data-pill-label', spec.label)
  if (spec.mentionType) span.setAttribute('data-mention-type', spec.mentionType)

  const svg = doc.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of [['width', '12'], ['height', '12'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['class', 'dab-inline-token-pill-icon']]) {
    svg.setAttribute(k, v)
  }
  const shapes = PILL_SVG_SHAPES[spec.pillKind === 'slash' ? 'slash' : spec.mentionType || 'conversation'] || PILL_SVG_SHAPES.conversation
  for (const [tag, attrs] of shapes) {
    const el = doc.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.appendChild(el)
  }
  span.appendChild(svg)

  const lbl = doc.createElement('span')
  lbl.className = 'dab-inline-token-pill-label'
  lbl.textContent = spec.label
  span.appendChild(lbl)
  return span
}

export function renderSegmentsToDom(editorEl: HTMLElement, segments: readonly ComposerSegment[]): void {
  const doc = editorEl.ownerDocument || document
  while (editorEl.firstChild) editorEl.removeChild(editorEl.firstChild)
  for (const seg of segments) {
    editorEl.appendChild(seg.kind === 'text' ? doc.createTextNode(seg.text) : createInlinePillElement(doc, seg))
  }
  const last = segments[segments.length - 1]
  if (last && last.kind === 'text' && last.text.endsWith('\n')) {
    const br = doc.createElement('br')
    br.setAttribute('data-composer-sentinel', 'true')
    editorEl.appendChild(br)
  }
  editorEl.setAttribute('data-empty', segments.length === 0 ? 'true' : 'false')
}

function isPillNode(node: Node | null | undefined): node is HTMLElement {
  return Boolean(node && node.nodeType === 1 && (node as HTMLElement).getAttribute('data-testid') === 'composer-inline-pill')
}

function isSentinelBr(node: Node | null | undefined): boolean {
  return Boolean(node && node.nodeType === 1 && (node as HTMLElement).getAttribute('data-composer-sentinel') === 'true')
}

export function readSegmentsFromDom(editorEl: HTMLElement): ComposerSegment[] {
  if (editorEl.childNodes.length === 1 && editorEl.firstChild?.nodeName === 'BR' && !isSentinelBr(editorEl.firstChild)) {
    editorEl.removeChild(editorEl.firstChild)
    editorEl.setAttribute('data-empty', 'true')
    return []
  }
  const raw: ComposerRawSegment[] = []
  const walk = (parent: Node) => {
    for (let i = 0; i < parent.childNodes.length; i += 1) {
      const child = parent.childNodes[i]
      if (isSentinelBr(child)) continue
      if (isPillNode(child)) {
        const pillKind: ComposerPillKind = child.getAttribute('data-token-kind') === 'slash' ? 'slash' : 'mention'
        const rawValue = child.getAttribute('data-token-value') || ''
        if (rawValue) {
          raw.push({
            kind: 'pill', pillKind, rawValue,
            tokenId: child.getAttribute('data-token-id') || '',
            label: child.getAttribute('data-pill-label') || child.textContent || '',
            mentionType: (child.getAttribute('data-mention-type') || undefined) as StudioContextCategory | undefined,
          })
        }
      } else if (child.nodeType === 3) {
        const txt = (child.nodeValue || '').replace(/\u00A0/g, ' ')
        if (txt) raw.push({ kind: 'text', text: txt })
      } else if (child.nodeName === 'BR') {
        raw.push({ kind: 'text', text: '\n' })
      } else if (child.nodeType === 1) {
        if (/^(DIV|P)$/i.test(child.nodeName) && raw.length > 0) {
          const prev = raw[raw.length - 1]
          if (prev.kind !== 'text' || !prev.text.endsWith('\n')) raw.push({ kind: 'text', text: '\n' })
        }
        walk(child)
      }
    }
  }
  walk(editorEl)
  const out = withSegmentOffsets(raw)
  editorEl.setAttribute('data-empty', out.length === 0 ? 'true' : 'false')
  return out
}

export function serializeComposerDom(editorEl: HTMLElement): string {
  return serializeComposerSegments(readSegmentsFromDom(editorEl))
}

function serializedSubtreeLength(root: Node, maxRootChildren = root.childNodes.length): number {
  let len = 0
  let endsNl = false
  const walk = (parent: Node, limit: number) => {
    for (let i = 0; i < limit; i += 1) {
      const c = parent.childNodes[i]
      if (isSentinelBr(c)) continue
      if (isPillNode(c)) {
        const n = (c.getAttribute('data-token-value') || '').length
        if (n > 0) { len += n; endsNl = false }
      } else if (c.nodeType === 3) {
        const txt = c.nodeValue || ''
        if (txt.length > 0) { len += txt.length; endsNl = txt.endsWith('\n') }
      } else if (c.nodeName === 'BR') {
        len += 1; endsNl = true
      } else if (c.nodeType === 1) {
        if (/^(DIV|P)$/i.test(c.nodeName) && len > 0 && !endsNl) { len += 1; endsNl = true }
        walk(c, c.childNodes.length)
      }
    }
  }
  walk(root, Math.min(Math.max(0, maxRootChildren), root.childNodes.length))
  return len
}

function serializedEditorLength(editorEl: HTMLElement): number {
  if (editorEl.childNodes.length === 1 && editorEl.firstChild?.nodeName === 'BR' && !isSentinelBr(editorEl.firstChild)) return 0
  return serializedSubtreeLength(editorEl)
}

function domBoundaryToOffset(editorEl: HTMLElement, container: Node, offset: number): number {
  if (container === editorEl) return serializedSubtreeLength(editorEl, offset)
  let cur: Node | null = container
  while (cur && cur.parentNode && cur.parentNode !== editorEl) {
    if (isPillNode(cur)) break
    cur = cur.parentNode
  }
  if (!cur || cur.parentNode !== editorEl) return serializedEditorLength(editorEl)
  let idx = 0
  while (idx < editorEl.childNodes.length && editorEl.childNodes[idx] !== cur) idx += 1
  const pos = serializedSubtreeLength(editorEl, idx)
  if (isPillNode(cur)) return offset === 0 ? pos : pos + (cur.getAttribute('data-token-value') || '').length
  return cur.nodeType === 3 ? pos + Math.min(offset, (cur.nodeValue || '').length) : pos
}

function offsetToDomBoundary(editorEl: HTMLElement, targetOffset: number): { node: Node; offset: number } {
  let pos = 0
  const children = editorEl.childNodes
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (isSentinelBr(child)) return { node: editorEl, offset: i }
    if (isPillNode(child)) {
      const len = (child.getAttribute('data-token-value') || '').length
      if (targetOffset <= pos) return { node: editorEl, offset: i }
      if (targetOffset < pos + len) return { node: editorEl, offset: i + 1 }
      pos += len
      if (targetOffset === pos && children[i + 1]?.nodeType !== 3) return { node: editorEl, offset: i + 1 }
    } else if (child.nodeType === 3) {
      const len = (child.nodeValue || '').length
      if (targetOffset <= pos + len) return { node: child, offset: targetOffset - pos }
      pos += len
    } else if (child.nodeName === 'BR') {
      if (targetOffset <= pos) return { node: editorEl, offset: i }
      pos += 1
    }
  }
  const endIdx = children.length > 0 && isSentinelBr(children[children.length - 1]) ? children.length - 1 : children.length
  return { node: editorEl, offset: endIdx }
}

export function getComposerSelectionOffsets(editorEl: HTMLElement): { start: number; end: number } {
  const aug = editorEl as DabComposerAugmentedElement
  const totalLen = serializedEditorLength(editorEl)
  const sel = (editorEl.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : undefined))?.getSelection?.()
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    if (editorEl.contains(range.startContainer) && editorEl.contains(range.endContainer)) {
      const s = Math.max(0, Math.min(domBoundaryToOffset(editorEl, range.startContainer, range.startOffset), totalLen))
      const e = Math.max(s, Math.min(domBoundaryToOffset(editorEl, range.endContainer, range.endOffset), totalLen))
      aug.__dabSelStart = s; aug.__dabSelEnd = e
      return { start: s, end: e }
    }
  }
  const s = Math.max(0, Math.min(aug.__dabSelStart ?? totalLen, totalLen))
  return { start: s, end: Math.max(s, Math.min(aug.__dabSelEnd ?? s, totalLen)) }
}

export function setComposerSelectionOffsets(
  editorEl: HTMLElement,
  start: number,
  end: number = start,
  syncDomSelection: boolean = true
): void {
  const aug = editorEl as DabComposerAugmentedElement
  const totalLen = serializedEditorLength(editorEl)
  const s = Math.max(0, Math.min(start, totalLen))
  const e = Math.max(s, Math.min(end, totalLen))
  aug.__dabSelStart = s; aug.__dabSelEnd = e
  if (!syncDomSelection) return
  const doc = editorEl.ownerDocument || document
  const sel = (doc.defaultView || (typeof window !== 'undefined' ? window : undefined))?.getSelection?.()
  if (!sel) return
  try {
    const pStart = offsetToDomBoundary(editorEl, s)
    const pEnd = s === e ? pStart : offsetToDomBoundary(editorEl, e)
    const range = doc.createRange()
    range.setStart(pStart.node, pStart.offset)
    range.setEnd(pEnd.node, pEnd.offset)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch { /* ignore detached node range errors */ }
}

export function insertPlainTextAtSelection(
  editorEl: HTMLElement,
  insertedText: string
): { segments: ComposerSegment[]; prompt: string; cursorPos: number; removedPills: ComposerPillSpec[] } {
  const current = readSegmentsFromDom(editorEl)
  const { start, end } = getComposerSelectionOffsets(editorEl)
  const res = replaceSegmentRange(current, start, end, insertedText)
  renderSegmentsToDom(editorEl, res.segments)
  setComposerSelectionOffsets(editorEl, res.cursorPos, res.cursorPos)
  return res
}

export function attachComposerElementCompat(editorEl: HTMLElement, getHydrationCtx: () => ComposerHydrationContext): void {
  const aug = editorEl as DabComposerAugmentedElement
  aug.__dabGetHydrationCtx = getHydrationCtx
  if (aug.__dabComposerPropsDefined) return
  Object.defineProperty(aug, '__dabComposerPropsDefined', { value: true })
  Object.defineProperties(aug, {
    value: {
      configurable: true,
      get: () => serializeComposerDom(editorEl),
      set: (v: unknown) => {
        const nextVal = String(v ?? '')
        renderSegmentsToDom(editorEl, parsePromptIntoSegments(nextVal, aug.__dabGetHydrationCtx?.()))
        setComposerSelectionOffsets(editorEl, nextVal.length, nextVal.length)
      },
    },
    selectionStart: {
      configurable: true,
      get: () => getComposerSelectionOffsets(editorEl).start,
      set: (v: number) => setComposerSelectionOffsets(editorEl, Number(v) || 0, Math.max(Number(v) || 0, getComposerSelectionOffsets(editorEl).end)),
    },
    selectionEnd: {
      configurable: true,
      get: () => getComposerSelectionOffsets(editorEl).end,
      set: (v: number) => setComposerSelectionOffsets(editorEl, getComposerSelectionOffsets(editorEl).start, Number(v) || 0),
    },
    setSelectionRange: { configurable: true, value: (start: number, end?: number) => setComposerSelectionOffsets(editorEl, start, end ?? start) },
    disabled: {
      configurable: true,
      get: () => editorEl.getAttribute('aria-disabled') === 'true',
      set: (v: boolean) => {
        editorEl.contentEditable = v ? 'false' : 'true'
        if (v) editorEl.setAttribute('aria-disabled', 'true')
        else editorEl.removeAttribute('aria-disabled')
      },
    },
  })
}

export interface GroupedExploreGroup {
  label: string; modelName: string; options: Array<{ label: string; value: string; mention: StudioContextMention }>
}

export function buildGroupedExplores(models: readonly ILookmlModel[], query: string): GroupedExploreGroup[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const out: GroupedExploreGroup[] = []
  for (const model of models) {
    if (!model?.explores?.length) continue
    const modelName = String(model.name || '')
    const modelLabel = String(model.label || modelName)
    const matching = model.explores.filter((explore) => {
      if (explore.hidden) return false
      if (tokens.length === 0) return true
      const expId = formatExploreId(modelName, String(explore.name))
      return tokens.every((tk) => `${modelLabel} ${modelName} ${explore.label || ''} ${explore.name} ${expId}`.toLowerCase().includes(tk))
    })
    if (matching.length > 0) {
      out.push({
        label: modelLabel, modelName,
        options: matching.map((explore) => {
          const value = formatExploreId(modelName, String(explore.name))
          const label = String(explore.label || explore.name)
          return {
            label, value,
            mention: {
              type: 'explore' as const, id: value, title: label, subtitle: modelLabel,
              model: modelName, explore: String(explore.name),
              description: explore.description ? String(explore.description) : undefined,
            },
          }
        }).sort((a, b) => a.label.localeCompare(b.label)),
      })
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export function buildMentionOptions(
  category: StudioContextCategory | 'all',
  query: string,
  groupedExplores: readonly GroupedExploreGroup[],
  preloadedContent: readonly StudioContextMention[],
  remoteSearchResults: readonly StudioContextMention[],
  conversations: readonly ConversationRecord[]
): StudioContextMention[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matchTokens = (text: string) => tokens.length === 0 || tokens.every((tk) => text.toLowerCase().includes(tk))
  const seen = new Set<string>()
  const out: StudioContextMention[] = []
  const pushItem = (item: StudioContextMention) => {
    const key = `${item.type}:${item.id}`
    if (!seen.has(key)) { seen.add(key); out.push(item) }
  }
  if (category === 'all' || category === 'explore') {
    groupedExplores.forEach((group) => group.options.forEach((opt) => pushItem(opt.mention)))
    remoteSearchResults.forEach((r) => { if (r.type === 'explore') pushItem(r) })
  }
  for (const contentType of ['dashboard', 'look'] as const) {
    if (category === 'all' || category === contentType) {
      preloadedContent.forEach((item) => { if (item.type === contentType && matchTokens(`${item.title} ${item.id} ${item.description || ''}`)) pushItem(item) })
      remoteSearchResults.forEach((r) => { if (r.type === contentType) pushItem(r) })
    }
  }
  if (category === 'all' || category === 'conversation') {
    conversations.forEach((c) => {
      const label = c.label || c.id
      if (matchTokens(`${label} ${c.id} ${c.type || ''}`)) pushItem({ type: 'conversation', id: c.id, title: label, subtitle: c.type || 'conversation' })
    })
    remoteSearchResults.forEach((r) => { if (r.type === 'conversation') pushItem(r) })
  }
  return out
}
