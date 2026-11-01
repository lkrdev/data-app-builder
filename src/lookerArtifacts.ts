import { mutate, SWRConfig, unstable_serialize } from 'swr'
import type { Looker40SDK } from '@looker/sdk'
import {
  DashboardStudioMetadata,
  mergeStudioMetadata,
  PersistedChatTurn,
  StudioMetadataUpdate,
} from './dataAppPublisher'
import { rawLookerRequest } from './lookerApi'

export const ARTIFACT_NAMESPACE = 'data_app_builder'

export function getArtifactNamespace(extensionSDK?: any): string {
  return (
    String(extensionSDK?.lookerHostData?.extensionId || ARTIFACT_NAMESPACE).trim() ||
    ARTIFACT_NAMESPACE
  )
}

export function readSwrCache<T = any>(key: any): T | undefined {
  try {
    return (SWRConfig as any).default?.cache?.get(unstable_serialize(key)) as T | undefined
  } catch {
    return undefined
  }
}

function writeSwrCache(key: any, value: any): void {
  try {
    ;(SWRConfig as any).default?.cache?.set(unstable_serialize(key), value)
  } catch {}
  void mutate(key, value, false).catch(() => {})
}

export type StudioToolMode =
  | 'app'
  | 'data_app'
  | 'lookml'
  | 'tile'
  | 'script'
  | 'dashboard'
  | 'health'
  | 'health_check'
  | 'conversational-analytics'

const STUDIO_TOOL_MODES = new Set<string>([
  'app',
  'data_app',
  'lookml',
  'tile',
  'script',
  'dashboard',
  'health',
  'health_check',
  'conversational-analytics',
])

export interface UserArtifactIndexEntry {
  id: string
  type: StudioToolMode
  title: string
  label?: string
  updatedAt: string
  createdBy: string
  targetId?: string
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
  [key: string]: any
}

export type UserArtifactIndex = UserArtifactIndexEntry

export interface SharedArtifactPayload extends UserArtifactIndexEntry {
  code?: string
  content?: any
  messages?: PersistedChatTurn[]
  meta?: Record<string, any>
}

export interface SaveUserArtifactParams extends Partial<UserArtifactIndexEntry> {
  sdk?: Looker40SDK
  userId: string
  id: string
  type: StudioToolMode
  title?: string
  content?: any
  objectPayload?: Record<string, any>
  namespace?: string
}

export interface SavedScript {
  id: string
  title: string
  code: string
  messages?: PersistedChatTurn[]
  updatedAt: string
  dashboardId?: string
  elementId?: string
}

export interface TileScriptBinding {
  scriptId: string
  code: string
  title?: string
  updatedAt?: string
}

export interface UserConversationEntry {
  id: string
  type: string
  label: string
  interactionId?: string
  environmentId?: string
  content?: Record<string, any>
  messages?: PersistedChatTurn[]
  explores?: string[]
  createdAt?: string
  updatedAt: string
}

export type ConversationRecord = UserConversationEntry

export function formatUserEnvArtifactKey(userId: string): string {
  return `user_env:${String(userId || '1').trim()}`
}

export function formatUserArtifactKey(
  userId: string,
  type: StudioToolMode,
  id: string
): string {
  return `user_${userId}_${type}_${id}`
}

export function formatObjectArtifactKey(type: StudioToolMode, id: string): string {
  return `obj_${type}_${id}`
}

export function formatUserConversationsKey(userId: string): string {
  return `user_conversations:${String(userId || '1').trim()}`
}

export const formatUserConversationsArtifactKey = formatUserConversationsKey

function parseArtifactValue<T = any>(raw: any): T {
  if (typeof raw !== 'string') return raw as T
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

function normalizeConversationsArray(raw: any): UserConversationEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.conversations)
    ? raw.conversations
    : []
  return list
    .filter((c: any): c is UserConversationEntry => Boolean(c && c.id))
    .map((c: any) => ({
      ...c,
      id: String(c.id),
      type: c.type || 'app',
      label: String(c.label || c.title || c.id),
      updatedAt: String(c.updatedAt || c.createdAt || ''),
    }))
    .sort((a: UserConversationEntry, b: UserConversationEntry) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )
}

function parseUserIndexRow(row: any, fallbackUserId: string): UserArtifactIndexEntry | null {
  if (!row?.value) return null
  try {
    const parsed = parseArtifactValue<Record<string, any>>(row.value)
    if (!parsed || typeof parsed !== 'object') return null
    const keyMatch = String(row.key || '').match(
      /^user_[^_]+_(app|data_app|lookml|tile|script|health|health_check|dashboard|conversational-analytics)_(.+)$/
    )
    const inferredType = (parsed.type ||
      parsed.contentType ||
      keyMatch?.[1]) as StudioToolMode | undefined
    const inferredId = String(parsed.id || keyMatch?.[2] || '')
    if (!inferredId || !inferredType) return null
    return {
      ...parsed,
      id: inferredId,
      type: inferredType,
      title: String(parsed.title || parsed.label || inferredId),
      updatedAt: String(parsed.updatedAt || ''),
      createdBy: String(parsed.createdBy || fallbackUserId),
    } as UserArtifactIndexEntry
  } catch {
    return null
  }
}

const canonArtifactMode = (t?: StudioToolMode): string =>
  t === 'data_app' ? 'app' : t === 'health_check' ? 'health' : t === 'script' ? 'tile' : t || ''

function matchesArtifactType(entryType: StudioToolMode, filterType?: StudioToolMode): boolean {
  return !filterType || canonArtifactMode(entryType) === canonArtifactMode(filterType)
}

// ponytail: Unified ArtifactService tracks `versionByKey` in memory so repeat saves skip redundant
// `sdk.artifact` GET lookups (with single-retry version refresh on conflict) and mutates SWR caches in place.
export class ArtifactService {
  private readonly versionByKey = new Map<string, number>()
  private readonly knownMissingKeys = new Set<string>()
  private readonly valueByKey = new Map<string, any>()
  private readonly conversationsCache = new Map<string, UserConversationEntry[]>()
  private readonly userListCache = new Map<string, UserArtifactIndexEntry[]>()
  private readonly scriptsCache = new Map<string, SavedScript[]>()
  private readonly tileScriptCache = new Map<string, TileScriptBinding | null>()

  constructor(readonly sdk: Looker40SDK, readonly namespace = ARTIFACT_NAMESPACE) {}

  getCachedVersion(key: string): number | undefined {
    return this.versionByKey.get(key)
  }

  clearCache(): void {
    this.versionByKey.clear()
    this.knownMissingKeys.clear()
    this.valueByKey.clear()
    this.conversationsCache.clear()
    this.userListCache.clear()
    this.scriptsCache.clear()
    this.tileScriptCache.clear()
  }

  private recordRows(rows: any, requestedKeys?: string[]): any[] {
    const list = Array.isArray(rows) ? rows : rows ? [rows] : []
    const seenKeys = new Set<string>()
    for (const r of list) {
      if (r?.key) {
        seenKeys.add(String(r.key))
        this.knownMissingKeys.delete(String(r.key))
        if (typeof r.version === 'number') {
          this.versionByKey.set(String(r.key), r.version)
        }
        if (r.value !== undefined) {
          this.valueByKey.set(String(r.key), parseArtifactValue(r.value))
        }
      }
    }
    if (requestedKeys) {
      for (const k of requestedKeys) {
        if (!seenKeys.has(k) && !this.versionByKey.has(k)) {
          this.knownMissingKeys.add(k)
        }
      }
    }
    return list
  }

  private async fetchVersionsForKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    try {
      const joined = keys.join(',')
      const existing =
        typeof (this.sdk as any).artifact === 'function'
          ? await this.sdk.ok(
              this.sdk.artifact({
                namespace: this.namespace,
                key: joined,
              })
            )
          : await rawLookerRequest<any[]>(
              this.sdk,
              'GET',
              `/artifacts/${encodeURIComponent(this.namespace)}`,
              { key: joined, fields: 'key,version' }
            )
      this.recordRows(existing, keys)
    } catch {
      for (const k of keys) {
        if (!this.versionByKey.has(k)) this.knownMissingKeys.add(k)
      }
    }
  }

  private updateScriptsCache(
    targetKey: string | undefined,
    updater: (prev: SavedScript[]) => SavedScript[]
  ): void {
    const keys = targetKey ? [targetKey, '*'] : Array.from(this.scriptsCache.keys())
    for (const k of keys) {
      const prev =
        this.scriptsCache.get(k) ??
        readSwrCache<SavedScript[]>(['artifact:scripts', this.namespace, k === '*' ? undefined : k]) ??
        []
      const next = updater(prev).sort((a, b) =>
        String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      )
      this.scriptsCache.set(k, next)
      writeSwrCache(['artifact:scripts', this.namespace, k === '*' ? undefined : k], next)
    }
  }

  private syncInPlaceCachesOnWrite(key: string, parsedVal: any): void {
    this.valueByKey.set(key, parsedVal)
    writeSwrCache(['artifact:obj', this.namespace, key], parsedVal)

    const convMatch = key.match(/^user_conversations:(.+)$/)
    if (convMatch) {
      const uid = convMatch[1]
      const normalized = normalizeConversationsArray(parsedVal)
      this.conversationsCache.set(uid, normalized)
      writeSwrCache(['artifact:conversations', this.namespace, uid], normalized)
      return
    }

    const userKeyMatch = key.match(
      /^user_([^_]+)_(app|data_app|lookml|tile|script|health|health_check|dashboard|conversational-analytics)_(.+)$/
    )
    if (userKeyMatch) {
      const uid = userKeyMatch[1]
      const rawType = userKeyMatch[2] as StudioToolMode
      const id = userKeyMatch[3]
      const entry = parseUserIndexRow({ key, value: parsedVal }, uid) || {
        ...(typeof parsedVal === 'object' && parsedVal ? parsedVal : {}),
        id: String(parsedVal?.id || id),
        type: (parsedVal?.type || parsedVal?.contentType || rawType) as StudioToolMode,
        title: String(parsedVal?.title || parsedVal?.label || id),
        updatedAt: String(parsedVal?.updatedAt || new Date().toISOString()),
        createdBy: String(parsedVal?.createdBy || uid),
      }
      const prevAll =
        this.userListCache.get(uid) ??
        readSwrCache<UserArtifactIndexEntry[]>(['artifact:user_list', this.namespace, uid, 'all']) ??
        readSwrCache<UserArtifactIndexEntry[]>(['artifact:user_list', this.namespace, uid, undefined])
      const nextAll = [
        entry,
        ...(prevAll || []).filter((e) => !(e.id === entry.id && matchesArtifactType(e.type, entry.type))),
      ].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      this.userListCache.set(uid, nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, 'all'], nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, undefined], nextAll)
      writeSwrCache(
        ['artifact:user_list', this.namespace, uid, entry.type],
        nextAll.filter((e) => matchesArtifactType(e.type, entry.type))
      )
      if (rawType !== entry.type) {
        writeSwrCache(
          ['artifact:user_list', this.namespace, uid, rawType],
          nextAll.filter((e) => matchesArtifactType(e.type, rawType))
        )
      }
      if (rawType === 'script' || entry.type === 'script') {
        const scriptEntry: SavedScript = {
          id: entry.id,
          title: entry.title,
          code: String(parsedVal?.code || ''),
          updatedAt: entry.updatedAt,
          ...(parsedVal?.dashboardId ? { dashboardId: String(parsedVal.dashboardId) } : {}),
          ...(parsedVal?.elementId ? { elementId: String(parsedVal.elementId) } : {}),
        }
        this.updateScriptsCache(uid, (prev) => [
          scriptEntry,
          ...prev.filter((s) => s.id !== scriptEntry.id),
        ])
      }
      return
    }

    const objScriptMatch = key.match(/^obj_script_(.+)$/)
    if (objScriptMatch && parsedVal && typeof parsedVal === 'object') {
      const id = String(parsedVal.id || objScriptMatch[1])
      const scriptEntry: SavedScript = {
        ...parsedVal,
        id,
        title: String(parsedVal.title || id),
        code: String(parsedVal.code || ''),
        updatedAt: String(parsedVal.updatedAt || new Date().toISOString()),
      }
      this.updateScriptsCache(undefined, (prev) => [
        scriptEntry,
        ...prev.filter((s) => s.id !== id),
      ])
      return
    }

    const tileMatch = key.match(/^tile_element_(.+)$/)
    if (tileMatch) {
      const elId = tileMatch[1]
      const binding = (parsedVal || null) as TileScriptBinding | null
      this.tileScriptCache.set(elId, binding)
      writeSwrCache(['artifact:tile_script', this.namespace, elId], binding)
    }
  }

  private syncInPlaceCachesOnDelete(key: string): void {
    this.versionByKey.delete(key)
    this.knownMissingKeys.add(key)
    this.valueByKey.delete(key)
    writeSwrCache(['artifact:obj', this.namespace, key], null)

    const convMatch = key.match(/^user_conversations:(.+)$/)
    if (convMatch) {
      const uid = convMatch[1]
      this.conversationsCache.set(uid, [])
      writeSwrCache(['artifact:conversations', this.namespace, uid], [])
      return
    }

    const userKeyMatch = key.match(
      /^user_([^_]+)_(app|data_app|lookml|tile|script|health|health_check|dashboard|conversational-analytics)_(.+)$/
    )
    if (userKeyMatch) {
      const uid = userKeyMatch[1]
      const rawType = userKeyMatch[2] as StudioToolMode
      const id = userKeyMatch[3]
      const prevAll =
        this.userListCache.get(uid) ??
        readSwrCache<UserArtifactIndexEntry[]>(['artifact:user_list', this.namespace, uid, 'all']) ??
        []
      const nextAll = prevAll.filter((e) => !(e.id === id && matchesArtifactType(e.type, rawType)))
      this.userListCache.set(uid, nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, 'all'], nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, undefined], nextAll)
      writeSwrCache(
        ['artifact:user_list', this.namespace, uid, rawType],
        nextAll.filter((e) => matchesArtifactType(e.type, rawType))
      )
      if (rawType === 'script' || rawType === 'tile') {
        this.updateScriptsCache(uid, (prev) => prev.filter((s) => s.id !== id))
      }
      return
    }

    const objScriptMatch = key.match(/^obj_script_(.+)$/)
    if (objScriptMatch) {
      const id = objScriptMatch[1]
      this.updateScriptsCache(undefined, (prev) => prev.filter((s) => s.id !== id))
      return
    }

    const tileMatch = key.match(/^tile_element_(.+)$/)
    if (tileMatch) {
      const elId = tileMatch[1]
      this.tileScriptCache.set(elId, null)
      writeSwrCache(['artifact:tile_script', this.namespace, elId], null)
    }
  }

  async getMany(keys: string[]): Promise<any[]> {
    const cleanKeys = keys.map((k) => String(k || '').trim()).filter(Boolean)
    if (cleanKeys.length === 0) return []
    const joined = cleanKeys.join(',')
    const rows =
      typeof (this.sdk as any).artifact === 'function'
        ? await this.sdk.ok(this.sdk.artifact({ namespace: this.namespace, key: joined }))
        : await this.search(joined)
    return this.recordRows(rows, cleanKeys)
  }

  async get<T = any>(key: string): Promise<T | null> {
    const cleanKey = String(key || '').trim()
    if (!cleanKey) return null
    try {
      const list = await this.getMany([cleanKey])
      const found = list.find((r) => r?.key === cleanKey) || list[0]
      if (!found || found.value === undefined || found.value === null) return null
      const parsed = parseArtifactValue<T>(found.value)
      this.valueByKey.set(cleanKey, parsed)
      return parsed
    } catch {
      return null
    }
  }

  async search(pattern: string): Promise<any[]> {
    const items =
      typeof (this.sdk as any).search_artifacts === 'function'
        ? await this.sdk.ok(this.sdk.search_artifacts({ namespace: this.namespace, key: pattern }))
        : await rawLookerRequest<any[]>(
            this.sdk,
            'GET',
            `/artifacts/${encodeURIComponent(this.namespace)}/search`,
            { key: pattern }
          )
    return this.recordRows(Array.isArray(items) ? items : [])
  }

  async put(items: Array<{ key: string; value: any }>): Promise<void> {
    if (items.length === 0) return
    const uncachedKeys = items
      .map((i) => i.key)
      .filter((k) => !this.versionByKey.has(k) && !this.knownMissingKeys.has(k))
    if (uncachedKeys.length > 0) {
      await this.fetchVersionsForKeys(uncachedKeys)
    }

    const buildUpdates = () =>
      items.map((item) => {
        const version = this.versionByKey.get(item.key)
        return {
          key: item.key,
          value: typeof item.value === 'string' ? item.value : JSON.stringify(item.value),
          content_type: 'application/json',
          ...(version !== undefined ? { version } : {}),
        }
      })

    const sendUpdates = async (updates: any[]) => {
      if (typeof (this.sdk as any).update_artifacts === 'function') {
        return await this.sdk.ok(this.sdk.update_artifacts(this.namespace, updates as any))
      }
      return await rawLookerRequest(
        this.sdk,
        'PUT',
        `/artifacts/${encodeURIComponent(this.namespace)}`,
        undefined,
        updates
      )
    }

    let result: any
    try {
      result = await sendUpdates(buildUpdates())
    } catch {
      // Version conflict or stale version: evict cached versions, fetch fresh versions via sdk.artifact, and retry once
      for (const item of items) {
        this.versionByKey.delete(item.key)
        this.knownMissingKeys.delete(item.key)
      }
      await this.fetchVersionsForKeys(items.map((i) => i.key))
      result = await sendUpdates(buildUpdates())
    }

    const resList = Array.isArray(result) ? result : result ? [result] : []
    const resByKey = new Map<string, any>()
    for (const r of resList) {
      if (r?.key) resByKey.set(String(r.key), r)
    }

    for (const item of items) {
      const prevVersion = this.versionByKey.get(item.key)
      const resItem = resByKey.get(item.key)
      const nextVersion =
        prevVersion === undefined
          ? typeof resItem?.version === 'number' && resItem.version > 0
            ? resItem.version
            : 1
          : typeof resItem?.version === 'number' && resItem.version > prevVersion
          ? resItem.version
          : prevVersion + 1
      this.versionByKey.set(item.key, nextVersion)
      this.knownMissingKeys.delete(item.key)
      const parsedVal = parseArtifactValue(item.value)
      this.syncInPlaceCachesOnWrite(item.key, parsedVal)
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyList = (Array.isArray(keys) ? keys : String(keys || '').split(','))
      .map((k) => k.trim())
      .filter(Boolean)
    if (keyList.length === 0) return
    const joined = keyList.join(',')
    if (typeof (this.sdk as any).delete_artifact === 'function') {
      await this.sdk.ok(this.sdk.delete_artifact(this.namespace, joined))
    } else {
      await rawLookerRequest(
        this.sdk,
        'DELETE',
        `/artifacts/${encodeURIComponent(this.namespace)}/${encodeURIComponent(joined)}`
      )
    }
    for (const k of keyList) {
      this.syncInPlaceCachesOnDelete(k)
    }
  }

  async getUserEnvironmentId(userId: string): Promise<string | null> {
    const key = formatUserEnvArtifactKey(userId)
    const stored = this.valueByKey.has(key)
      ? this.valueByKey.get(key)
      : await this.get<{ environmentId?: string; updatedAt?: string } | string>(key)
    const envId =
      typeof stored === 'string' ? stored.trim() : String(stored?.environmentId || '').trim()
    return envId || null
  }

  async saveUserEnvironmentId(userId: string, environmentId: string): Promise<void> {
    const envId = String(environmentId || '').trim()
    if (!envId) return
    await this.put([
      {
        key: formatUserEnvArtifactKey(userId),
        value: { environmentId: envId, updatedAt: new Date().toISOString() },
      },
    ])
  }

  async clearUserEnvironmentId(userId: string): Promise<void> {
    await this.delete(formatUserEnvArtifactKey(userId))
  }

  async listConversations(userId: string): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cached = this.conversationsCache.get(uid)
    if (cached) return cached
    const raw = await this.get<
      UserConversationEntry[] | { conversations?: UserConversationEntry[] }
    >(formatUserConversationsKey(uid))
    const normalized = normalizeConversationsArray(raw)
    this.conversationsCache.set(uid, normalized)
    writeSwrCache(['artifact:conversations', this.namespace, uid], normalized)
    return normalized
  }

  async getConversation(id: string, userId = '1'): Promise<UserConversationEntry | null> {
    const cleanId = String(id || '').trim()
    if (!cleanId) return null
    const list = await this.listConversations(userId)
    return list.find((c) => c.id === cleanId) || null
  }

  async saveConversation(
    userId: string,
    entry: Partial<UserConversationEntry> & { id: string }
  ): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(entry.id || '').trim()
    if (!cleanId) return []
    const now = new Date().toISOString()
    const existing = this.conversationsCache.has(uid)
      ? this.conversationsCache.get(uid)!
      : await this.listConversations(uid)
    const prev = existing.find((c) => c.id === cleanId)
    const merged: UserConversationEntry = {
      ...prev,
      ...entry,
      ...(prev?.content || entry.content
        ? { content: { ...prev?.content, ...entry.content } }
        : {}),
      id: cleanId,
      type: entry.type || prev?.type || 'app',
      label: String(entry.label || prev?.label || (entry as any).title || cleanId),
      createdAt: prev?.createdAt || entry.createdAt || now,
      updatedAt: entry.updatedAt || now,
    }
    const nextList = [merged, ...existing.filter((c) => c.id !== cleanId)].sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )
    await this.put([{ key: formatUserConversationsKey(uid), value: nextList }])
    return nextList
  }

  async deleteConversation(
    userId: string,
    conversationId: string
  ): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const existing = this.conversationsCache.has(uid)
      ? this.conversationsCache.get(uid)!
      : await this.listConversations(uid)
    const next = existing.filter((c) => c.id !== conversationId)
    await this.put([{ key: formatUserConversationsKey(uid), value: next }])
    return next
  }

  async listUserArtifacts(
    userId: string,
    type?: StudioToolMode
  ): Promise<UserArtifactIndexEntry[]> {
    const uid = String(userId || '1').trim()
    let allEntries = this.userListCache.get(uid)
    if (!allEntries) {
      const rows = await this.search(`user_${uid}_%`)
      const parsedEntries: UserArtifactIndexEntry[] = []
      for (const row of rows || []) {
        const entry = parseUserIndexRow(row, uid)
        if (entry) parsedEntries.push(entry)
      }
      allEntries = parsedEntries.sort((a, b) =>
        String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      )
      this.userListCache.set(uid, allEntries)
      writeSwrCache(['artifact:user_list', this.namespace, uid, 'all'], allEntries)
      writeSwrCache(['artifact:user_list', this.namespace, uid, undefined], allEntries)
    }
    if (!type) return allEntries
    const filtered = allEntries.filter((e) => matchesArtifactType(e.type, type))
    writeSwrCache(['artifact:user_list', this.namespace, uid, type], filtered)
    return filtered
  }

  async loadObjectArtifact<T = SharedArtifactPayload>(
    type: StudioToolMode,
    id: string
  ): Promise<T | null> {
    const objKey = formatObjectArtifactKey(type, id)
    if (this.valueByKey.has(objKey)) {
      return this.valueByKey.get(objKey) as T
    }
    const direct = await this.get<T>(objKey)
    if (direct) return direct
    const fallbackRows = await this.search(`%_${type}_${id}`)
    const hit = fallbackRows[0]
    if (!hit?.value) return null
    return parseArtifactValue<T>(hit.value)
  }

  async saveUserArtifact(
    userIdOrParams: string | SaveUserArtifactParams,
    indexEntry?: UserArtifactIndexEntry,
    objectPayload?: Record<string, any>
  ): Promise<SharedArtifactPayload> {
    if (typeof userIdOrParams === 'object' && userIdOrParams !== null) {
      const {
        sdk: _sdk,
        userId: rawUid,
        namespace: _ns,
        content,
        objectPayload: explicitObj,
        ...rest
      } = userIdOrParams
      const uid = String(rawUid || '1').trim()
      const id = String(rest.id || '').trim()
      const type = (rest.type || 'app') as StudioToolMode
      const entry: UserArtifactIndexEntry = {
        ...rest,
        id,
        type,
        title: String(rest.title || rest.label || id),
        updatedAt: String(rest.updatedAt || new Date().toISOString()),
        createdBy: String(rest.createdBy || uid),
      }
      const payload = explicitObj ?? content
      return this.saveUserArtifact(uid, entry, payload)
    }

    const uid = String(userIdOrParams || '1').trim()
    const entry = indexEntry!
    const items = [
      { key: formatUserArtifactKey(uid, entry.type, entry.id), value: entry },
      ...(objectPayload
        ? [{ key: formatObjectArtifactKey(entry.type, entry.id), value: objectPayload }]
        : []),
    ]
    await this.put(items)
    return (objectPayload || entry) as SharedArtifactPayload
  }

  async deleteUserArtifact(
    userId: string,
    type: StudioToolMode,
    id: string,
    deleteSharedPayload = false
  ): Promise<void> {
    const uid = String(userId || '1').trim()
    const keys = [formatUserArtifactKey(uid, type, id)]
    if (deleteSharedPayload) {
      keys.push(formatObjectArtifactKey(type, id))
    }
    await this.delete(keys)
  }

  async saveScript(userId: string, script: SavedScript): Promise<SavedScript> {
    const payload: SavedScript = {
      ...script,
      updatedAt: script.updatedAt || new Date().toISOString(),
    }
    const uid = String(userId || '1').trim()
    await this.put([
      {
        key: `user_${uid}_script_${payload.id}`,
        value: { ...payload, messages: undefined },
      },
      {
        key: `obj_script_${payload.id}`,
        value: payload,
      },
    ])
    return payload
  }

  async loadScript(scriptId: string): Promise<SavedScript | null> {
    const cleanId = String(scriptId || '').trim().replace(/^obj_script_/, '')
    if (!cleanId) return null
    const objKey = `obj_script_${cleanId}`
    if (this.valueByKey.has(objKey)) {
      return this.valueByKey.get(objKey) as SavedScript
    }
    return this.get<SavedScript>(objKey)
  }

  async listSavedScripts(userId?: string): Promise<SavedScript[]> {
    const cacheKey = userId ? String(userId).trim() : '*'
    const cached = this.scriptsCache.get(cacheKey)
    if (cached) return cached

    const patterns = userId
      ? [`user_${String(userId).trim()}_script_%`, 'obj_script_%']
      : ['obj_script_%']
    const byId = new Map<string, SavedScript>()
    for (const pattern of patterns) {
      try {
        const rows = await this.search(pattern)
        for (const r of rows || []) {
          if (!r?.value) continue
          try {
            const parsed = parseArtifactValue<SavedScript>(r.value)
            if (parsed?.id && !byId.has(parsed.id)) {
              byId.set(parsed.id, parsed)
            }
          } catch {}
        }
      } catch {}
      if (byId.size > 0 && userId) break
    }
    const sorted = Array.from(byId.values()).sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )
    this.scriptsCache.set(cacheKey, sorted)
    writeSwrCache(['artifact:scripts', this.namespace, userId ? cacheKey : undefined], sorted)
    return sorted
  }

  async deleteScript(userId: string, scriptId: string): Promise<void> {
    const uid = String(userId || '1').trim()
    const cleanId = String(scriptId || '').trim().replace(/^obj_script_/, '')
    if (!cleanId) return
    await this.delete([`user_${uid}_script_${cleanId}`, `obj_script_${cleanId}`])
  }

  async bindTileScript(elementId: string, binding: TileScriptBinding): Promise<TileScriptBinding> {
    const cleanElId = String(elementId || '').trim()
    const saved: TileScriptBinding = {
      scriptId: binding.scriptId,
      code: binding.code,
      ...(binding.title ? { title: binding.title } : {}),
      updatedAt: new Date().toISOString(),
    }
    await this.put([{ key: `tile_element_${String(elementId).trim()}`, value: saved }])
    this.tileScriptCache.set(cleanElId, saved)
    writeSwrCache(['artifact:tile_script', this.namespace, cleanElId], saved)
    return saved
  }

  async loadTileScript(elementId: string): Promise<TileScriptBinding | null> {
    const cleanElId = String(elementId || '').trim()
    if (!cleanElId) return null
    if (this.tileScriptCache.has(cleanElId)) {
      return this.tileScriptCache.get(cleanElId) || null
    }
    const binding = await this.get<TileScriptBinding>(`tile_element_${cleanElId}`)
    if (!binding) {
      this.tileScriptCache.set(cleanElId, null)
      writeSwrCache(['artifact:tile_script', this.namespace, cleanElId], null)
      return null
    }
    if (!binding.code && binding.scriptId) {
      const obj = await this.loadScript(binding.scriptId)
      if (obj?.code) {
        const resolved = { ...binding, code: obj.code, title: binding.title || obj.title }
        this.tileScriptCache.set(cleanElId, resolved)
        writeSwrCache(['artifact:tile_script', this.namespace, cleanElId], resolved)
        return resolved
      }
    }
    this.tileScriptCache.set(cleanElId, binding)
    writeSwrCache(['artifact:tile_script', this.namespace, cleanElId], binding)
    return binding
  }

  getTileScript(elementId: string): Promise<TileScriptBinding | null> {
    return this.loadTileScript(elementId)
  }

  listScripts(userId?: string): Promise<SavedScript[]> {
    return this.listSavedScripts(userId)
  }
}

let servicesBySdk = new WeakMap<object, Map<string, ArtifactService>>()
const DEFAULT_SDK_KEY = {}

export function getArtifactService(
  sdk: Looker40SDK,
  namespace = ARTIFACT_NAMESPACE
): ArtifactService {
  const ns = String(namespace || ARTIFACT_NAMESPACE).trim() || ARTIFACT_NAMESPACE
  const rawCandidate = (sdk as any)?.__rawSdk || sdk
  const rawKey =
    rawCandidate && (typeof rawCandidate === 'object' || typeof rawCandidate === 'function')
      ? (rawCandidate as object)
      : DEFAULT_SDK_KEY
  let byNs = servicesBySdk.get(rawKey)
  if (!byNs) {
    byNs = new Map<string, ArtifactService>()
    servicesBySdk.set(rawKey, byNs)
  }
  let svc = byNs.get(ns)
  if (!svc) {
    svc = new ArtifactService(sdk, ns)
    byNs.set(ns, svc)
  }
  return svc
}

export function clearArtifactServiceCache(): void {
  servicesBySdk = new WeakMap<object, Map<string, ArtifactService>>()
}

export async function searchArtifactsRaw(
  sdk: Looker40SDK,
  namespace: string,
  key: string
): Promise<any[]> {
  return getArtifactService(sdk, namespace).search(key)
}

export async function searchArtifacts(
  sdk: Looker40SDK,
  key: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<any[]> {
  return getArtifactService(sdk, namespace).search(key)
}

export async function getArtifacts(
  sdk: Looker40SDK,
  keys: string | string[],
  namespace = ARTIFACT_NAMESPACE
): Promise<any[]> {
  const list = Array.isArray(keys) ? keys : String(keys || '').split(',')
  return getArtifactService(sdk, namespace).getMany(list)
}

// ponytail: Looker update_artifacts requires the current `version` for existing keys;
// delegate to ArtifactService so cached `versionByKey` skips redundant `artifact` GET calls.
export async function putArtifacts(
  sdk: Looker40SDK,
  items: Array<{ key: string; value: any }>,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  return getArtifactService(sdk, namespace).put(items)
}

export async function deleteArtifacts(
  sdk: Looker40SDK,
  keys: string | string[],
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  return getArtifactService(sdk, namespace).delete(keys)
}

export async function getArtifactJson<T = any>(
  sdk: Looker40SDK,
  key: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<T | null> {
  return getArtifactService(sdk, namespace).get<T>(key)
}

export async function loadUserEnvironmentId(
  sdk: Looker40SDK,
  userId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<string | null> {
  return getArtifactService(sdk, namespace).getUserEnvironmentId(userId)
}

export async function saveUserEnvironmentId(
  sdk: Looker40SDK,
  userId: string,
  environmentId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  return getArtifactService(sdk, namespace).saveUserEnvironmentId(userId, environmentId)
}

export async function clearUserEnvironmentId(
  sdk: Looker40SDK,
  userId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  return getArtifactService(sdk, namespace).clearUserEnvironmentId(userId)
}

export type NativeContentType = 'dashboard' | 'lookml_dashboard' | 'look' | 'board'

export interface NativeContentBundle {
  id: string
  content_type?: NativeContentType
  contentType?: NativeContentType
  title: string
  folder_id?: string
  folderId?: string
  embed_path?: string
  url?: string
  tile_count?: number
  filter_count?: number
  schedule_id?: string
  look_id?: string
  board_id?: string
  lookml_dashboard_id?: string
  project_id?: string
  model?: string
  file_path?: string
  layout_id?: string
  element_ids?: string[]
  filter_names?: string[]
  layout_component_ids?: Record<string, string>
  query_cache?: Record<string, string>
  filter_cache?: Record<string, string>
  summary?: string
  elements?: any[]
  explores?: string[]
}

export interface NativeContentState {
  id: string
  contentType: NativeContentType
  title: string
  folderId: string
  embedPath: string
  tileCount?: number
  filterCount?: number
  scheduleId?: string
  lookId?: string
  boardId?: string
  lookmlDashboardId?: string
  projectId?: string
  model?: string
  filePath?: string
  layoutId?: string
  elementIds?: string[]
  filterNames?: string[]
  layoutComponentIds?: Record<string, string>
  queryCache?: Record<string, string>
  filterCache?: Record<string, string>
  summary?: string
  elements?: any[]
  studio?: DashboardStudioMetadata
}

export function resolveNativeEmbedPath(
  contentType: NativeContentType,
  id: string,
  explicitPath?: string
): string {
  const raw = String(id).trim()
  if (explicitPath && /^\/(?:embed\/(?:dashboards|looks)|dashboards|boards)\//.test(explicitPath)) {
    return explicitPath
  }
  const cleanId = encodeURIComponent(raw).replace(/%3A%3A/gi, '::')
  if (contentType === 'look') return `/embed/looks/${cleanId}`
  if (contentType === 'board') return `/boards/${cleanId}`
  return `/embed/dashboards/${cleanId}`
}

export function normalizeNativeContent(
  raw: any,
  fallbackFolderId = '1',
  explicitType?: NativeContentType
): NativeContentState {
  const id = String(raw?.id || '').trim()
  const contentType: NativeContentType =
    explicitType ||
    raw?.contentType ||
    raw?.content_type ||
    (id.includes('::') ? 'lookml_dashboard' : 'dashboard')
  return {
    id,
    contentType,
    title: String(raw?.title || `Native ${contentType} #${id}`),
    folderId: String(raw?.folderId || raw?.folder_id || fallbackFolderId || '1'),
    embedPath: resolveNativeEmbedPath(contentType, id, raw?.embedPath || raw?.embed_path || raw?.url),
    tileCount: raw?.tileCount ?? raw?.tile_count,
    filterCount: raw?.filterCount ?? raw?.filter_count,
    scheduleId: raw?.scheduleId ?? raw?.schedule_id,
    lookId: raw?.lookId ?? raw?.look_id,
    boardId: raw?.boardId ?? raw?.board_id,
    lookmlDashboardId:
      raw?.lookmlDashboardId ??
      raw?.lookml_dashboard_id ??
      (contentType === 'lookml_dashboard' ? id : undefined),
    projectId: raw?.projectId ?? raw?.project_id,
    model: raw?.model,
    filePath: raw?.filePath ?? raw?.file_path,
    layoutId: raw?.layoutId ?? raw?.layout_id,
    elementIds: raw?.elementIds ?? raw?.element_ids,
    filterNames: raw?.filterNames ?? raw?.filter_names,
    layoutComponentIds: raw?.layoutComponentIds ?? raw?.layout_component_ids,
    queryCache: raw?.queryCache ?? raw?.query_cache,
    filterCache: raw?.filterCache ?? raw?.filter_cache,
    summary: raw?.summary,
    elements: raw?.elements,
    studio: raw?.studio,
  }
}

// ponytail: batch both user_${userId}_dashboard_${id} and obj_dashboard_${id} into one putArtifacts call
export async function saveNativeContentArtifact(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string,
  bundle: NativeContentBundle,
  folderId: string,
  existing?: NativeContentState | null,
  studioUpdate?: StudioMetadataUpdate
): Promise<NativeContentState> {
  const id = String(bundle.id || existing?.id || '').trim()
  if (!id) throw new Error('Native content bundle is missing a target ID.')
  const nextStudio = mergeStudioMetadata(existing?.studio, studioUpdate)
  const merged = normalizeNativeContent(
    { ...existing, ...bundle, id, studio: nextStudio },
    folderId
  )
  const updatedAt = nextStudio?.updatedAt || new Date().toISOString()
  const namespace = getArtifactNamespace(extensionSDK)
  const safeUserId = String(userId || '1').trim()
  const userKey = `user_${safeUserId}_dashboard_${id}`
  const objKey = `obj_dashboard_${id}`

  const userIndexPayload = {
    id,
    type: 'dashboard',
    contentType: merged.contentType,
    title: merged.title,
    updatedAt,
    createdBy: safeUserId,
    targetId: id,
    embedPath: merged.embedPath,
    folderId: merged.folderId,
    explores: nextStudio?.explores || bundle.explores || [],
    lastInteractionId: nextStudio?.lastInteractionId,
    environmentId: nextStudio?.environmentId,
  }
  const objPayload = {
    ...merged,
    type: 'dashboard',
  }

  try {
    await putArtifacts(
      sdk,
      [
        { key: userKey, value: userIndexPayload },
        { key: objKey, value: objPayload },
      ],
      namespace
    )
  } catch {
    // Non-fatal outside an extension host
  }

  return merged
}

export async function loadNativeContentById(
  sdk: Looker40SDK,
  extensionSDK: any,
  rawId: string
): Promise<NativeContentState> {
  const prefixMatch = rawId.trim().match(/^(dashboard|lookml_dashboard|look|board):(.+)$/i)
  const explicitType = prefixMatch ? (prefixMatch[1].toLowerCase() as NativeContentType) : undefined
  const cleanId = (prefixMatch ? prefixMatch[2] : rawId).trim()
  const stored = await getArtifactJson<any>(
    sdk,
    `obj_dashboard_${cleanId}`,
    getArtifactNamespace(extensionSDK)
  )
  if (stored?.id) {
    return normalizeNativeContent(stored, '1', explicitType)
  }

  const cType: NativeContentType =
    explicitType || (cleanId.includes('::') ? 'lookml_dashboard' : 'dashboard')
  const item =
    cType === 'look'
      ? await rawLookerRequest<any>(sdk, 'GET', `/looks/${encodeURIComponent(cleanId)}`)
      : cType === 'board'
      ? await rawLookerRequest<any>(sdk, 'GET', `/boards/${encodeURIComponent(cleanId)}`)
      : await sdk.ok(sdk.dashboard(cleanId))
  const id = String(item.id || cleanId)
  const finalType: NativeContentType =
    explicitType || (id.includes('::') ? 'lookml_dashboard' : cType)
  return normalizeNativeContent(
    {
      id,
      contentType: finalType,
      title: item.title || `${finalType} #${id}`,
      folderId: String(item.folder?.id || item.folder_id || '1'),
      tileCount: item.dashboard_elements?.length,
      filterCount: item.dashboard_filters?.length,
      lookmlDashboardId:
        finalType === 'lookml_dashboard'
          ? id
          : item.lookml_link_id
          ? String(item.lookml_link_id)
          : undefined,
    },
    '1',
    finalType
  )
}

export async function listUserDashboardArtifacts(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string
): Promise<Array<{ id: string; title: string; contentType: NativeContentType; embedPath: string }>> {
  try {
    const items = await searchArtifactsRaw(
      sdk,
      getArtifactNamespace(extensionSDK),
      `user_${String(userId || '1').trim()}_dashboard_%`
    )
    return items.flatMap((item) => {
      try {
        const p = typeof item.value === 'string' ? JSON.parse(item.value) : item.value
        if (!p?.id) return []
        const cType: NativeContentType = p.contentType || 'dashboard'
        return [
          {
            id: String(p.id),
            title: String(p.title || `#${p.id}`),
            contentType: cType,
            embedPath: resolveNativeEmbedPath(cType, String(p.id), p.embedPath),
          },
        ]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export async function saveScriptArtifact(
  sdk: Looker40SDK,
  userId: string,
  script: SavedScript,
  namespace = ARTIFACT_NAMESPACE
): Promise<SavedScript> {
  return getArtifactService(sdk, namespace).saveScript(userId, script)
}

export async function loadScriptArtifact(
  sdk: Looker40SDK,
  scriptId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<SavedScript | null> {
  return getArtifactService(sdk, namespace).loadScript(scriptId)
}

export const loadSingleScriptArtifact = loadScriptArtifact

export async function listSavedScripts(
  sdk: Looker40SDK,
  userId?: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<SavedScript[]> {
  return getArtifactService(sdk, namespace).listSavedScripts(userId)
}

export const loadSavedScriptsList = listSavedScripts

export async function deleteScriptArtifact(
  sdk: Looker40SDK,
  userId: string,
  scriptId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  return getArtifactService(sdk, namespace).deleteScript(userId, scriptId)
}

export async function bindTileScriptArtifact(
  sdk: Looker40SDK,
  elementId: string,
  binding: TileScriptBinding,
  namespace = ARTIFACT_NAMESPACE
): Promise<TileScriptBinding> {
  return getArtifactService(sdk, namespace).bindTileScript(elementId, binding)
}

export const bindScriptToTileArtifact = bindTileScriptArtifact

export async function loadTileScriptArtifact(
  sdk: Looker40SDK,
  elementId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<TileScriptBinding | null> {
  return getArtifactService(sdk, namespace).loadTileScript(elementId)
}

export async function publishScriptDashboard(
  sdk: Looker40SDK,
  params: {
    script: SavedScript
    folderId: string
    extensionId: string
    existingDashboardId?: string
    namespace?: string
  }
): Promise<{ dashboardId: string; elementId: string; extensionId: string }> {
  const {
    script,
    folderId,
    extensionId,
    existingDashboardId,
    namespace = ARTIFACT_NAMESPACE,
  } = params
  const title = script.title || 'Python Runner Dashboard'
  const extId = extensionId || 'data_app_builder::data_app_builder'

  const dashBody = {
    title,
    load_configuration: 'wait',
    run_on_load: false,
    show_filters_bar: true,
    appearance: {
      show_dashboard_header: true,
      page_side_margins: 0,
      tile_space_between: 0,
      tile_shadow: false,
    },
  }
  let dashId = existingDashboardId?.trim() || ''
  if (dashId) {
    await rawLookerRequest(
      sdk,
      'PATCH',
      `/dashboards/${encodeURIComponent(dashId)}`,
      undefined,
      dashBody
    )
  } else {
    try {
      const dash = await rawLookerRequest(sdk, 'POST', '/dashboards', undefined, {
        ...dashBody,
        folder_id: folderId,
      })
      dashId = String(dash.id)
    } catch {
      const dash = await sdk.ok(
        sdk.create_dashboard({
          title,
          folder_id: folderId,
          load_configuration: 'wait',
          show_filters_bar: true,
        } as any)
      )
      dashId = String(dash.id)
    }
  }

  const fullDash = await sdk.ok(sdk.dashboard(dashId))
  let elementId = String(
    (fullDash.dashboard_elements || []).find((e) => e.type === 'extension')?.id || ''
  )
  if (!elementId) {
    const createdEl = await rawLookerRequest<{ id?: string }>(
      sdk,
      'POST',
      '/dashboard_elements',
      undefined,
      {
        dashboard_id: dashId,
        type: 'extension',
        extension_id: extId,
        title,
        title_hidden: true,
      }
    )
    elementId = String(createdEl?.id || '')
  } else {
    await sdk.ok(
      sdk.update_dashboard_element(elementId, {
        title,
        title_hidden: true,
        extension_id: extId,
      } as any)
    )
  }

  const layouts = fullDash.dashboard_layouts || []
  const activeLayout = layouts.find((l) => l.active) || layouts[0]
  if (activeLayout?.id) {
    await rawLookerRequest(
      sdk,
      'PATCH',
      `/dashboard_layouts/${encodeURIComponent(String(activeLayout.id))}`,
      undefined,
      { type: 'extension' }
    )
  }

  if (elementId) {
    await bindTileScriptArtifact(
      sdk,
      elementId,
      { scriptId: script.id, code: script.code, title: script.title },
      namespace
    )
  }

  return {
    dashboardId: dashId,
    elementId,
    extensionId: extId,
  }
}

// ponytail: two-tier artifact store — compact (<1 KB) per-user index key (user_${userId}_${type}_${id})
// for fast search_artifacts listing + shared payload key (obj_${type}_${id}) reusing ArtifactService.
export async function saveUserArtifact(
  sdkOrParams: Looker40SDK | SaveUserArtifactParams,
  userId?: string,
  indexEntry?: UserArtifactIndexEntry,
  objectPayload?: Record<string, any>,
  namespace = ARTIFACT_NAMESPACE
): Promise<SharedArtifactPayload> {
  if (
    sdkOrParams &&
    typeof sdkOrParams === 'object' &&
    'sdk' in sdkOrParams &&
    'userId' in sdkOrParams &&
    'id' in sdkOrParams
  ) {
    const params = sdkOrParams as SaveUserArtifactParams
    return getArtifactService(params.sdk!, params.namespace || ARTIFACT_NAMESPACE).saveUserArtifact(
      params
    )
  }
  return getArtifactService(sdkOrParams as Looker40SDK, namespace).saveUserArtifact(
    String(userId || '1'),
    indexEntry!,
    objectPayload
  )
}

export async function listUserArtifacts(
  sdk: Looker40SDK,
  userId: string,
  typeOrNamespace?: StudioToolMode | string,
  maybeNamespace?: string
): Promise<UserArtifactIndexEntry[]> {
  let type: StudioToolMode | undefined
  let namespace = ARTIFACT_NAMESPACE
  if (maybeNamespace !== undefined) {
    type = typeOrNamespace as StudioToolMode | undefined
    namespace = maybeNamespace || ARTIFACT_NAMESPACE
  } else if (typeOrNamespace && STUDIO_TOOL_MODES.has(typeOrNamespace)) {
    type = typeOrNamespace as StudioToolMode
  } else if (typeOrNamespace) {
    namespace = typeOrNamespace
  }
  return getArtifactService(sdk, namespace).listUserArtifacts(userId, type)
}

export const loadUserArtifactsList = listUserArtifacts

export async function loadObjectArtifact<T = SharedArtifactPayload>(
  sdk: Looker40SDK,
  type: StudioToolMode,
  id: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<T | null> {
  return getArtifactService(sdk, namespace).loadObjectArtifact<T>(type, id)
}

export async function deleteUserArtifact(
  sdk: Looker40SDK,
  userId: string,
  type: StudioToolMode,
  id: string,
  deleteSharedPayload = false,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  return getArtifactService(sdk, namespace).deleteUserArtifact(
    userId,
    type,
    id,
    deleteSharedPayload
  )
}

// ponytail: single per-user JSON array artifact `user_conversations:${me.id}` sorted by updatedAt desc.
export async function loadUserConversations(
  sdk: Looker40SDK,
  userId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<UserConversationEntry[]> {
  return getArtifactService(sdk, namespace).listConversations(userId)
}

export const loadConversationsList = loadUserConversations

export async function loadSingleConversationArtifact(
  sdk: Looker40SDK,
  conversationId: string,
  userId = '1',
  namespace = ARTIFACT_NAMESPACE
): Promise<UserConversationEntry | null> {
  return getArtifactService(sdk, namespace).getConversation(conversationId, userId)
}

export async function saveUserConversation(
  sdk: Looker40SDK,
  userId: string,
  entry: Partial<UserConversationEntry> & { id: string },
  namespace = ARTIFACT_NAMESPACE
): Promise<UserConversationEntry[]> {
  return getArtifactService(sdk, namespace).saveConversation(userId, entry)
}

export const saveConversationArtifact = saveUserConversation

export async function deleteUserConversation(
  sdk: Looker40SDK,
  userId: string,
  conversationId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<UserConversationEntry[]> {
  return getArtifactService(sdk, namespace).deleteConversation(userId, conversationId)
}

export const deleteConversationArtifact = deleteUserConversation
