import type { ChatTurnMessage } from './dataAppPublisher'

export const MAX_USER_ENV_ARTIFACT_BYTES = 512
const MAX_USER_CONFIG_ARTIFACT_BYTES = 1024
const MAX_USER_CONVERSATIONS_TOTAL_BYTES = 65536
const MAX_USER_CONVERSATION_ENTRY_BYTES = 4096
export const SOFT_USER_CONVERSATIONS_EVICT_BYTES = 60000
const MAX_CONVERSATION_LABEL_CHARS = 120
const MAX_CONVERSATION_TAGS = 4
const MAX_CONVERSATION_TAG_CHARS = 32
const MAX_TURN_INTERACTION_ID_PAIRS = 20

const POINTER_ARTIFACT_KEY_RE = /^user_(env|config|conversations):([^\s:]+)$/

const ALLOWED_USER_ENV_FIELDS = new Set<string>(['environmentId', 'sourcesHash', 'updatedAt'])

const ALLOWED_USER_CONFIG_FIELDS = new Set<string>([
  'userId',
  'agentName',
  'themeMode',
  'requirePermission',
  'busySendAction',
  'maxToolRounds',
  'selectedFolderId',
  'updatedAt',
])

export const ALLOWED_USER_CONVERSATION_FIELDS = new Set<string>([
  'id',
  'objectId',
  'type',
  'label',
  'tags',
  'archived',
  'environmentId',
  'interactionId',
  'inFlight',
  'turnInteractionIds',
  'caConversationId',
  'explores',
  'activeContentTabKey',
  'content',
  'contentItems',
  'createdAt',
  'updatedAt',
])

export const FORBIDDEN_ARTIFACT_PROPERTY_NAMES = new Set<string>([
  'messages',
  'text',
  'activitySteps',
  'images',
  'rawCode',
  'prod_code',
  'raw_code',
  'code',
  'files',
  'tddMarkdown',
  'telemetry',
  'elements',
  'alert_history_items',
  'queryCache',
  'filterCache',
])

export class ArtifactPayloadViolationError extends Error {
  readonly key: string
  readonly reason: string

  constructor(key: string, reason: string) {
    super(`Looker Artifact Pointers-Only violation on "${key}": ${reason}`)
    this.name = 'ArtifactPayloadViolationError'
    this.key = key
    this.reason = reason
    Object.setPrototypeOf(this, ArtifactPayloadViolationError.prototype)
  }
}

const utf8Encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length
}

function findForbiddenPropertyPath(val: unknown, pathPrefix = '$'): string | null {
  if (!val || typeof val !== 'object') return null
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i += 1) {
      const hit = findForbiddenPropertyPath(val[i], `${pathPrefix}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  const rec = val as Record<string, unknown>
  const keys = Object.keys(rec)
  for (let i = 0; i < keys.length; i += 1) {
    const prop = keys[i]
    if (rec[prop] === undefined) continue
    if (FORBIDDEN_ARTIFACT_PROPERTY_NAMES.has(prop)) return `${pathPrefix}.${prop}`
    const nested = findForbiddenPropertyPath(rec[prop], `${pathPrefix}.${prop}`)
    if (nested) return nested
  }
  return null
}

function assertAllowedObjectFields(
  key: string,
  obj: unknown,
  allowedFields: ReadonlySet<string>,
  label: string
): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ArtifactPayloadViolationError(key, `${label} must be a JSON object`)
  }
  const rec = obj as Record<string, unknown>
  const keys = Object.keys(rec)
  for (let i = 0; i < keys.length; i += 1) {
    const field = keys[i]
    if (rec[field] === undefined) continue
    if (FORBIDDEN_ARTIFACT_PROPERTY_NAMES.has(field)) {
      throw new ArtifactPayloadViolationError(key, `forbidden property "${field}" in ${label}`)
    }
    if (!allowedFields.has(field)) {
      throw new ArtifactPayloadViolationError(key, `disallowed field "${field}" in ${label}`)
    }
  }
  return rec
}

export function assertPointerOnlyArtifactWrite(key: string, value: unknown): void {
  const cleanKey = String(key || '').trim()
  const match = cleanKey.match(POINTER_ARTIFACT_KEY_RE)
  if (!match) {
    throw new ArtifactPayloadViolationError(
      cleanKey || '<empty>',
      'writable keys are restricted to user_env:<uid>, user_config:<uid>, and user_conversations:<uid>'
    )
  }
  const kind = match[1] as 'env' | 'config' | 'conversations'
  let serialized: string
  let parsed: unknown
  if (typeof value === 'string') {
    serialized = value
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new ArtifactPayloadViolationError(cleanKey, 'payload string must be valid JSON')
    }
  } else {
    if (value === undefined || value === null) {
      throw new ArtifactPayloadViolationError(cleanKey, 'payload must not be null or undefined')
    }
    serialized = JSON.stringify(value)
    parsed = value
  }

  const forbiddenHit = findForbiddenPropertyPath(parsed)
  if (forbiddenHit) {
    throw new ArtifactPayloadViolationError(cleanKey, `forbidden property at ${forbiddenHit}`)
  }

  const totalBytes = utf8ByteLength(serialized)
  if (kind === 'env') {
    if (totalBytes > MAX_USER_ENV_ARTIFACT_BYTES) {
      throw new ArtifactPayloadViolationError(cleanKey, `payload (${totalBytes} B) exceeds ${MAX_USER_ENV_ARTIFACT_BYTES} B cap`)
    }
    assertAllowedObjectFields(cleanKey, parsed, ALLOWED_USER_ENV_FIELDS, 'user_env')
    return
  }

  if (kind === 'config') {
    if (totalBytes > MAX_USER_CONFIG_ARTIFACT_BYTES) {
      throw new ArtifactPayloadViolationError(cleanKey, `payload (${totalBytes} B) exceeds ${MAX_USER_CONFIG_ARTIFACT_BYTES} B cap`)
    }
    assertAllowedObjectFields(cleanKey, parsed, ALLOWED_USER_CONFIG_FIELDS, 'user_config')
    return
  }

  if (totalBytes > MAX_USER_CONVERSATIONS_TOTAL_BYTES) {
    throw new ArtifactPayloadViolationError(
      cleanKey,
      `user_conversations payload (${totalBytes} B) exceeds ${MAX_USER_CONVERSATIONS_TOTAL_BYTES} B cap`
    )
  }
  if (!Array.isArray(parsed)) {
    throw new ArtifactPayloadViolationError(cleanKey, 'user_conversations payload must be an array')
  }
  for (let i = 0; i < parsed.length; i += 1) {
    assertAllowedObjectFields(cleanKey, parsed[i], ALLOWED_USER_CONVERSATION_FIELDS, `user_conversations[${i}]`)
    const entryBytes = utf8ByteLength(JSON.stringify(parsed[i]))
    if (entryBytes > MAX_USER_CONVERSATION_ENTRY_BYTES) {
      throw new ArtifactPayloadViolationError(
        cleanKey,
        `user_conversations[${i}] (${entryBytes} B) exceeds ${MAX_USER_CONVERSATION_ENTRY_BYTES} B per-entry cap`
      )
    }
  }
}

export function stripForbiddenArtifactFieldsDeep<T>(val: T): T {
  if (!val || typeof val !== 'object') return val
  if (Array.isArray(val)) return val.map((item) => stripForbiddenArtifactFieldsDeep(item)) as unknown as T
  const out: Record<string, unknown> = {}
  const rec = val as Record<string, unknown>
  Object.keys(rec).forEach((k) => {
    if (rec[k] !== undefined && !FORBIDDEN_ARTIFACT_PROPERTY_NAMES.has(k)) {
      out[k] = stripForbiddenArtifactFieldsDeep(rec[k])
    }
  })
  return out as T
}

export function normalizeConversationLabel(raw: unknown, fallback = ''): string {
  const clean = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const base = clean || String(fallback || '').replace(/\s+/g, ' ').trim()
  return base.length <= MAX_CONVERSATION_LABEL_CHARS ? base : base.slice(0, MAX_CONVERSATION_LABEL_CHARS).trim()
}

export function normalizeConversationTags(
  explicitTags?: readonly unknown[],
  explores?: readonly string[],
  contentTypes?: readonly string[],
  mode?: string
): string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  const pushTag = (raw: unknown) => {
    if (out.length >= MAX_CONVERSATION_TAGS) return
    const clean = String(raw ?? '')
      .trim()
      .replace(/^.*::/, '')
      .replace(/\s+/g, ' ')
      .slice(0, MAX_CONVERSATION_TAG_CHARS)
      .trim()
    if (!clean) return
    const lower = clean.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    out.push(clean)
  }

  if (Array.isArray(explicitTags) && explicitTags.length > 0) {
    explicitTags.forEach(pushTag)
    return out.length > 0 ? out : undefined
  }
  ;(explores || []).forEach(pushTag)
  ;(contentTypes || []).forEach(pushTag)
  if (out.length === 0 && mode) pushTag(mode)
  return out.length > 0 ? out : undefined
}

export function normalizeTurnInteractionIds(raw: unknown): Array<[string, string]> {
  if (!Array.isArray(raw)) return []
  const pairs: Array<[string, string]> = []
  raw.forEach((item) => {
    if (!Array.isArray(item) || item.length < 2) return
    const rootId = String(item[0] || '').trim()
    const finalId = String(item[1] || item[0] || '').trim()
    if (rootId && finalId) pairs.push([rootId, finalId])
  })
  return pairs.slice(-MAX_TURN_INTERACTION_ID_PAIRS)
}

export function mergeTurnInteractionIds(
  prev?: ReadonlyArray<readonly [string, string]>,
  next?: ReadonlyArray<readonly [string, string]>
): Array<[string, string]> | undefined {
  const merged: Array<[string, string]> = []
  const idxByRoot = new Map<string, number>()
  const apply = (list?: ReadonlyArray<readonly [string, string]>, preferIncomingFinal = false) => {
    ;(list || []).forEach((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return
      const rootId = String(pair[0] || '').trim()
      const finalId = String(pair[1] || pair[0] || '').trim()
      if (!rootId || !finalId) return
      const existingIdx = idxByRoot.get(rootId)
      if (existingIdx !== undefined) {
        const prevFinal = merged[existingIdx][1]
        if (preferIncomingFinal && (finalId !== rootId || prevFinal === rootId)) {
          merged[existingIdx] = [rootId, finalId]
        }
      } else {
        idxByRoot.set(rootId, merged.length)
        merged.push([rootId, finalId])
      }
    })
  }
  apply(prev, false)
  apply(next, true)
  if (merged.length === 0) return undefined
  return merged.slice(-MAX_TURN_INTERACTION_ID_PAIRS)
}

export function compactConversationEntryToBudget<T extends object>(
  entry: T,
  maxBytes = MAX_USER_CONVERSATION_ENTRY_BYTES
): T {
  if (utf8ByteLength(JSON.stringify(entry)) <= maxBytes) return entry
  const out = Object.assign({}, entry) as Record<string, unknown>
  if (out.content && typeof out.content === 'object' && !Array.isArray(out.content)) {
    const rawC = out.content as Record<string, unknown>
    const c: Record<string, unknown> = {}
    Object.keys(rawC).forEach((k) => {
      const v = rawC[k]
      if (typeof v === 'string') {
        const cap = k === 'routingRationale' || k === 'initialQuestion' ? 80 : 120
        c[k] = v.length > cap ? v.slice(0, cap) : v
      } else {
        c[k] = v
      }
    })
    out.content = c
  }
  if (utf8ByteLength(JSON.stringify(out)) > maxBytes && Array.isArray(out.contentItems)) {
    const trimmed = (out.contentItems as Array<Record<string, unknown>>)
      .filter((it) => !(it?.hidden && it?.source === 'mention'))
      .map((it) =>
        typeof it?.title === 'string' && it.title.length > 48
          ? Object.assign({}, it, { title: it.title.slice(0, 48) })
          : it
      )
    out.contentItems = trimmed.length > 8 ? trimmed.slice(-8) : trimmed
  }
  if (utf8ByteLength(JSON.stringify(out)) > maxBytes && Array.isArray(out.explores) && out.explores.length > 6) {
    out.explores = out.explores.slice(0, 6)
  }
  while (
    utf8ByteLength(JSON.stringify(out)) > maxBytes &&
    Array.isArray(out.turnInteractionIds) &&
    out.turnInteractionIds.length > 1
  ) {
    out.turnInteractionIds = out.turnInteractionIds.slice(1)
  }
  if (utf8ByteLength(JSON.stringify(out)) > maxBytes && Array.isArray(out.contentItems) && out.contentItems.length > 2) {
    out.contentItems = out.contentItems.slice(-2)
  }
  return out as T
}

export function evictConversationsToByteBudget<T extends { id: string; archived?: boolean }>(
  sortedConversations: readonly T[],
  maxBytes = SOFT_USER_CONVERSATIONS_EVICT_BYTES,
  protectedId?: string
): T[] {
  const next = sortedConversations.slice()
  while (next.length > 1 && utf8ByteLength(JSON.stringify(next)) > maxBytes) {
    let evictIdx = -1
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i].archived && next[i].id !== protectedId) {
        evictIdx = i
        break
      }
    }
    if (evictIdx < 0) {
      evictIdx = next[next.length - 1].id === protectedId && next.length > 1 ? next.length - 2 : next.length - 1
    }
    next.splice(evictIdx, 1)
  }
  return next
}

const sessionMessagesByConvId = new Map<string, ChatTurnMessage[]>()

export function getSessionConversationMessages(convId: string): ChatTurnMessage[] | undefined {
  const id = String(convId || '').trim()
  const hit = id ? sessionMessagesByConvId.get(id) : undefined
  return hit ? hit.slice() : undefined
}

export function setSessionConversationMessages(convId: string, messages: ReadonlyArray<ChatTurnMessage>): void {
  const id = String(convId || '').trim()
  if (id) sessionMessagesByConvId.set(id, messages.slice())
}

export function deleteSessionConversationMessages(convId: string): void {
  const id = String(convId || '').trim()
  if (id) sessionMessagesByConvId.delete(id)
}

export function clearSessionConversationMessages(): void {
  sessionMessagesByConvId.clear()
}
