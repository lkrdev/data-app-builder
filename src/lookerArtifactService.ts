import type { Looker40SDK } from '@looker/sdk'

import {
  ARTIFACT_NAMESPACE,
  type ArtifactRowLike,
  formatObjectArtifactKey,
  formatUserArtifactKey,
  formatUserConversationsKey,
  formatUserEnvArtifactKey,
  matchesArtifactType,
  normalizeArtifactNamespace,
  normalizeConversationsArray,
  normalizeStudioAgentName,
  parseArtifactValue,
  parseUserIndexRow,
  prunePersistedContentItem,
  prunePersistedMessages,
  readSwrCache,
  resolveConversationRelatedContent,
  type SavedScript,
  type SaveUserArtifactParams,
  type SharedArtifactPayload,
  type StudioToolMode,
  type TileScriptBinding,
  type UserArtifactIndexEntry,
  type UserConversationEntry,
  type UserStudioConfig,
  userStudioConfigArtifactKey,
  writeSwrCache,
} from './lookerArtifactTypes'
import { rawLookerRequest } from './lookerTransport'

// ponytail: Unified ArtifactService tracks `versionByKey` in memory so repeat saves skip redundant
// `sdk.artifact` GET lookups (with single-retry version refresh on conflict) and mutates SWR caches in place.
export class ArtifactService {
  private readonly versionByKey = new Map<string, number>()
  private readonly knownMissingKeys = new Set<string>()
  private readonly valueByKey = new Map<string, unknown>()
  private readonly conversationsCache = new Map<string, UserConversationEntry[]>()
  private readonly userListCache = new Map<string, UserArtifactIndexEntry[]>()
  private readonly scriptsCache = new Map<string, SavedScript[]>()
  private readonly tileScriptCache = new Map<string, TileScriptBinding | null>()
  readonly namespace: string

  constructor(readonly sdk: Looker40SDK, namespace = ARTIFACT_NAMESPACE) {
    this.namespace = normalizeArtifactNamespace(namespace)
  }

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

  private recordRows(rows: unknown, requestedKeys?: string[]): ArtifactRowLike[] {
    const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as ArtifactRowLike[]
    const seenKeys = new Set<string>()
    for (const r of list) {
      if (r?.key) {
        seenKeys.add(String(r.key))
        this.knownMissingKeys.delete(String(r.key))
        if (typeof r.version === 'number') this.versionByKey.set(String(r.key), r.version)
        if (r.value !== undefined) this.valueByKey.set(String(r.key), parseArtifactValue(r.value))
      }
    }
    if (requestedKeys) {
      for (const k of requestedKeys) {
        if (!seenKeys.has(k) && !this.versionByKey.has(k)) this.knownMissingKeys.add(k)
      }
    }
    return list
  }

  private async fetchVersionsForKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    try {
      const joined = keys.join(',')
      const existing =
        typeof (this.sdk as Partial<Looker40SDK>).artifact === 'function'
          ? await this.sdk.ok(this.sdk.artifact({ namespace: this.namespace, key: joined }))
          : await rawLookerRequest<ArtifactRowLike[]>(this.sdk, 'GET', `/artifacts/${encodeURIComponent(this.namespace)}`, { key: joined, fields: 'key,version' })
      this.recordRows(existing, keys)
    } catch {
      for (const k of keys) if (!this.versionByKey.has(k)) this.knownMissingKeys.add(k)
    }
  }

  private updateScriptsCache(targetKey: string | undefined, updater: (prev: SavedScript[]) => SavedScript[]): void {
    const keys = targetKey ? [targetKey, '*'] : Array.from(this.scriptsCache.keys())
    for (const k of keys) {
      const prev = this.scriptsCache.get(k) ?? readSwrCache<SavedScript[]>(['artifact:scripts', this.namespace, k === '*' ? undefined : k]) ?? []
      const next = updater(prev).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      this.scriptsCache.set(k, next)
      writeSwrCache(['artifact:scripts', this.namespace, k === '*' ? undefined : k], next)
    }
  }

  private syncInPlaceCachesOnWrite(key: string, parsedVal: unknown): void {
    this.valueByKey.set(key, parsedVal)
    writeSwrCache(['artifact:obj', this.namespace, key], parsedVal)
    const parsedObj = parsedVal && typeof parsedVal === 'object' ? (parsedVal as Record<string, unknown>) : undefined

    const convMatch = key.match(/^user_conversations:(.+)$/)
    if (convMatch) {
      const uid = convMatch[1]
      const prevList = this.conversationsCache.get(uid)
      const normalized = normalizeConversationsArray(parsedVal).map((c) => {
        const p = prevList?.find((x) => x.id === c.id)
        return p?.messages && (!c.messages || (p.messages.length > c.messages.length && c.messages[c.messages.length - 1]?.role === 'user'))
          ? { ...c, messages: p.messages, interactionId: c.interactionId || p.interactionId }
          : c
      })
      this.conversationsCache.set(uid, normalized)
      writeSwrCache(['artifact:conversations', this.namespace, uid], normalized)
      return
    }

    const userKeyMatch = key.match(
      /^user_([^_]+)_(app|data_app|data-investigator|data_investigator|lookml|tile|script|alert|health|health_check|dashboard|conversational-analytics)_(.+)$/
    )
    if (userKeyMatch) {
      const uid = userKeyMatch[1]
      const rawType = userKeyMatch[2] as StudioToolMode
      const id = userKeyMatch[3]
      const entry = parseUserIndexRow({ key, value: parsedVal }, uid) || {
        ...(parsedObj || {}),
        id: String(parsedObj?.id || id),
        type: (parsedObj?.type || parsedObj?.contentType || rawType) as StudioToolMode,
        title: String(parsedObj?.title || parsedObj?.label || id),
        updatedAt: String(parsedObj?.updatedAt || new Date().toISOString()),
        createdBy: String(parsedObj?.createdBy || uid),
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
      writeSwrCache(['artifact:user_list', this.namespace, uid, entry.type], nextAll.filter((e) => matchesArtifactType(e.type, entry.type)))
      if (rawType !== entry.type) {
        writeSwrCache(['artifact:user_list', this.namespace, uid, rawType], nextAll.filter((e) => matchesArtifactType(e.type, rawType)))
      }
      if (rawType === 'script' || entry.type === 'script') {
        const scriptEntry: SavedScript = {
          id: entry.id,
          title: entry.title,
          code: String(parsedObj?.code || ''),
          updatedAt: entry.updatedAt,
          ...(parsedObj?.dashboardId ? { dashboardId: String(parsedObj.dashboardId) } : {}),
          ...(parsedObj?.elementId ? { elementId: String(parsedObj.elementId) } : {}),
        }
        this.updateScriptsCache(uid, (prev) => [scriptEntry, ...prev.filter((s) => s.id !== scriptEntry.id)])
      }
      return
    }

    const objScriptMatch = key.match(/^obj_script_(.+)$/)
    if (objScriptMatch && parsedObj) {
      const id = String(parsedObj.id || objScriptMatch[1])
      const scriptEntry: SavedScript = {
        ...(parsedObj as Partial<SavedScript>),
        id,
        title: String(parsedObj.title || id),
        code: String(parsedObj.code || ''),
        updatedAt: String(parsedObj.updatedAt || new Date().toISOString()),
      }
      this.updateScriptsCache(undefined, (prev) => [scriptEntry, ...prev.filter((s) => s.id !== id)])
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
      /^user_([^_]+)_(app|data_app|data-investigator|data_investigator|lookml|tile|script|alert|health|health_check|dashboard|conversational-analytics)_(.+)$/
    )
    if (userKeyMatch) {
      const uid = userKeyMatch[1]
      const rawType = userKeyMatch[2] as StudioToolMode
      const id = userKeyMatch[3]
      const prevAll = this.userListCache.get(uid) ?? readSwrCache<UserArtifactIndexEntry[]>(['artifact:user_list', this.namespace, uid, 'all']) ?? []
      const nextAll = prevAll.filter((e) => !(e.id === id && matchesArtifactType(e.type, rawType)))
      this.userListCache.set(uid, nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, 'all'], nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, undefined], nextAll)
      writeSwrCache(['artifact:user_list', this.namespace, uid, rawType], nextAll.filter((e) => matchesArtifactType(e.type, rawType)))
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

  async getMany(keys: string[]): Promise<ArtifactRowLike[]> {
    const cleanKeys = keys.map((k) => String(k || '').trim()).filter(Boolean)
    if (cleanKeys.length === 0) return []
    const joined = cleanKeys.join(',')
    const rows =
      typeof (this.sdk as Partial<Looker40SDK>).artifact === 'function'
        ? await this.sdk.ok(this.sdk.artifact({ namespace: this.namespace, key: joined }))
        : await this.search(joined)
    return this.recordRows(rows, cleanKeys)
  }

  async get<T = unknown>(key: string): Promise<T | null> {
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

  async search(pattern: string): Promise<ArtifactRowLike[]> {
    const items =
      typeof (this.sdk as Partial<Looker40SDK>).search_artifacts === 'function'
        ? await this.sdk.ok(this.sdk.search_artifacts({ namespace: this.namespace, key: pattern }))
        : await rawLookerRequest<ArtifactRowLike[]>(this.sdk, 'GET', `/artifacts/${encodeURIComponent(this.namespace)}/search`, { key: pattern })
    return this.recordRows(Array.isArray(items) ? items : [])
  }

  async put(items: Array<{ key: string; value: unknown }>): Promise<void> {
    if (items.length === 0) return
    const uncachedKeys = items.map((i) => i.key).filter((k) => !this.versionByKey.has(k) && !this.knownMissingKeys.has(k))
    if (uncachedKeys.length > 0) await this.fetchVersionsForKeys(uncachedKeys)

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

    const sendUpdates = async (updates: Array<{ key: string; value: string; content_type: string; version?: number }>) => {
      if (typeof (this.sdk as Partial<Looker40SDK>).update_artifacts === 'function') {
        return await this.sdk.ok(this.sdk.update_artifacts(this.namespace, updates as Parameters<Looker40SDK['update_artifacts']>[1]))
      }
      return await rawLookerRequest(this.sdk, 'PUT', `/artifacts/${encodeURIComponent(this.namespace)}`, undefined, updates)
    }

    let result: unknown
    try {
      result = await sendUpdates(buildUpdates())
    } catch {
      for (const item of items) {
        this.versionByKey.delete(item.key)
        this.knownMissingKeys.delete(item.key)
      }
      await this.fetchVersionsForKeys(items.map((i) => i.key))
      result = await sendUpdates(buildUpdates())
    }

    const resList = (Array.isArray(result) ? result : result ? [result] : []) as ArtifactRowLike[]
    const resByKey = new Map<string, ArtifactRowLike>()
    for (const r of resList) if (r?.key) resByKey.set(String(r.key), r)

    for (const item of items) {
      const prevVersion = this.versionByKey.get(item.key)
      const resItem = resByKey.get(item.key)
      const nextVersion =
        prevVersion === undefined
          ? typeof resItem?.version === 'number' && resItem.version > 0 ? resItem.version : 1
          : typeof resItem?.version === 'number' && resItem.version > prevVersion ? resItem.version : prevVersion + 1
      this.versionByKey.set(item.key, nextVersion)
      this.knownMissingKeys.delete(item.key)
      this.syncInPlaceCachesOnWrite(item.key, parseArtifactValue(item.value))
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyList = (Array.isArray(keys) ? keys : String(keys || '').split(',')).map((k) => k.trim()).filter(Boolean)
    if (keyList.length === 0) return
    const joined = keyList.join(',')
    try {
      if (typeof (this.sdk as Partial<Looker40SDK>).delete_artifact === 'function') {
        await this.sdk.ok(this.sdk.delete_artifact(this.namespace, joined))
      } else {
        await rawLookerRequest(this.sdk, 'DELETE', `/artifacts/${encodeURIComponent(this.namespace)}/${encodeURIComponent(joined)}`)
      }
    } finally {
      for (const k of keyList) this.syncInPlaceCachesOnDelete(k)
    }
  }

  async getUserEnvironmentId(userId: string): Promise<string | null> {
    const key = formatUserEnvArtifactKey(userId)
    const stored = this.valueByKey.has(key) ? this.valueByKey.get(key) : await this.get<{ environmentId?: string; updatedAt?: string } | string>(key)
    const envId = typeof stored === 'string' ? stored.trim() : String(stored?.environmentId || '').trim()
    return envId || null
  }

  async saveUserEnvironmentId(userId: string, environmentId: string): Promise<void> {
    const envId = String(environmentId || '').trim()
    if (!envId) {
      try { await this.clearUserEnvironmentId(userId) } catch { /* Ignore clear errors */ }
      return
    }
    await this.put([{ key: formatUserEnvArtifactKey(userId), value: { environmentId: envId, updatedAt: new Date().toISOString() } }])
  }

  async clearUserEnvironmentId(userId: string): Promise<void> {
    await this.delete(formatUserEnvArtifactKey(userId))
  }

  async getUserConfig(userId: string): Promise<UserStudioConfig> {
    const uid = String(userId || '').trim() || '1'
    const key = userStudioConfigArtifactKey(uid)
    const stored = this.valueByKey.has(key) ? this.valueByKey.get(key) : await this.get<Partial<UserStudioConfig> | string>(key)
    const obj = stored && typeof stored === 'object' ? (stored as Partial<UserStudioConfig>) : undefined
    return {
      userId: uid,
      agentName: normalizeStudioAgentName(typeof stored === 'string' ? stored : obj?.agentName),
      updatedAt: typeof obj?.updatedAt === 'string' ? obj.updatedAt : '',
    }
  }

  async saveUserConfig(userId: string, patch: Partial<Pick<UserStudioConfig, 'agentName'>>): Promise<UserStudioConfig> {
    const uid = String(userId || '').trim() || '1'
    const nextConfig: UserStudioConfig = { userId: uid, agentName: normalizeStudioAgentName(patch.agentName), updatedAt: new Date().toISOString() }
    await this.put([{ key: userStudioConfigArtifactKey(uid), value: nextConfig }])
    return nextConfig
  }

  async listConversations(userId: string): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cached = this.conversationsCache.get(uid)
    if (cached) return cached
    const raw = await this.get<UserConversationEntry[] | { conversations?: UserConversationEntry[] }>(formatUserConversationsKey(uid))
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

  async saveConversation(userId: string, entry: Partial<UserConversationEntry> & { id: string }): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(entry.id || '').trim()
    if (!cleanId) return []
    const now = new Date().toISOString()
    if (!this.conversationsCache.has(uid)) await this.listConversations(uid)
    const existing = this.conversationsCache.get(uid) || []
    const prev = existing.find((c) => c.id === cleanId)
    let mergedContentItems = entry.contentItems
    if (mergedContentItems === undefined && prev?.contentItems?.length) mergedContentItems = prev.contentItems
    const rawMessages =
      entry.messages && prev?.messages && prev.messages.length > entry.messages.length && entry.messages[entry.messages.length - 1]?.role === 'user'
        ? prev.messages
        : (entry.messages ?? prev?.messages)
    const mergedMessages = prunePersistedMessages(rawMessages)
    const merged: UserConversationEntry = {
      ...prev,
      ...entry,
      ...(prev?.content || entry.content ? { content: { ...prev?.content, ...entry.content } } : {}),
      ...(mergedContentItems ? { contentItems: mergedContentItems.map((it) => prunePersistedContentItem(it)) } : {}),
      ...(entry.activeContentTabKey !== undefined || prev?.activeContentTabKey ? { activeContentTabKey: entry.activeContentTabKey ?? prev?.activeContentTabKey } : {}),
      ...(mergedMessages !== undefined ? { messages: mergedMessages } : {}),
      id: cleanId,
      type: entry.type || prev?.type || 'app',
      label: String(entry.label || prev?.label || (entry as { title?: string }).title || cleanId),
      createdAt: prev?.createdAt || entry.createdAt || now,
      updatedAt: entry.updatedAt || now,
    }
    const nextList = [merged, ...existing.filter((c) => c.id !== cleanId)].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    this.conversationsCache.set(uid, nextList)
    writeSwrCache(['artifact:conversations', this.namespace, uid], nextList)
    await this.put([{ key: formatUserConversationsKey(uid), value: nextList }])
    return this.conversationsCache.get(uid) || nextList
  }

  async archiveConversation(userId: string, conversationId: string, archived = true): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(conversationId || '').trim()
    const existing = this.conversationsCache.has(uid) ? this.conversationsCache.get(uid)! : await this.listConversations(uid)
    const nextList = existing.map((c) => (c.id === cleanId ? { ...c, archived } : c))
    await this.put([{ key: formatUserConversationsKey(uid), value: nextList }])
    return nextList
  }

  async deleteConversation(
    userId: string,
    conversationId: string,
    options?: boolean | { deleteRelatedContent?: boolean; conversation?: Partial<UserConversationEntry> & { id: string } }
  ): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(conversationId || '').trim()
    const deleteRelatedContent = typeof options === 'boolean' ? options : Boolean(options?.deleteRelatedContent)
    const existing = this.conversationsCache.has(uid) ? this.conversationsCache.get(uid)! : await this.listConversations(uid)
    const targetConv = (typeof options === 'object' && options?.conversation) || existing.find((c) => c.id === cleanId) || { id: cleanId }
    const next = existing.filter((c) => c.id !== cleanId)
    await this.put([{ key: formatUserConversationsKey(uid), value: next }])

    // ponytail: always delete matching `user_${userId}_${type}_${id}` index artifact(s) so stale index entries never linger or resurrect.
    const related = resolveConversationRelatedContent(targetConv, uid)
    const cachedUserEntries = this.userListCache.get(uid) || []
    for (const entry of cachedUserEntries) {
      if (entry.id === cleanId || (related.objectId && entry.id === related.objectId)) {
        const k = formatUserArtifactKey(uid, entry.type, entry.id)
        if (!related.userIndexKeys.includes(k)) related.userIndexKeys.push(k)
      }
    }
    const keysToDelete = [...related.userIndexKeys, ...(deleteRelatedContent ? related.sharedObjectKeys : [])]
    if (keysToDelete.length > 0) {
      try { await this.delete(keysToDelete) } catch { /* Ignore deletion errors for missing index keys */ }
    }

    if (deleteRelatedContent) {
      const sdkRecord = this.sdk as unknown as Record<string, ((id: string) => ReturnType<Looker40SDK['delete_dashboard']>) | undefined>
      const dashTargets = related.dashboardIds && related.dashboardIds.length > 0 ? related.dashboardIds : related.dashboardId ? [related.dashboardId] : []
      const lookTargets = related.lookIds && related.lookIds.length > 0 ? related.lookIds : related.lookId ? [related.lookId] : []
      const deleteJobs: Array<readonly ['delete_dashboard' | 'delete_look', string, string]> = [
        ...dashTargets.map((id) => ['delete_dashboard', '/dashboards', id] as const),
        ...lookTargets.map((id) => ['delete_look', '/looks', id] as const),
      ]
      for (const [fnName, pathPrefix, targetId] of deleteJobs) {
        if (!targetId) continue
        try {
          if (typeof sdkRecord[fnName] === 'function') await this.sdk.ok(sdkRecord[fnName]!(String(targetId)))
          else await rawLookerRequest(this.sdk, 'DELETE', `${pathPrefix}/${encodeURIComponent(String(targetId))}`)
        } catch { /* Ignore errors when related Looker content was already removed */ }
      }
    }

    return next
  }

  async listUserArtifacts(userId: string, type?: StudioToolMode): Promise<UserArtifactIndexEntry[]> {
    const uid = String(userId || '1').trim()
    let allEntries = this.userListCache.get(uid)
    if (!allEntries) {
      const rows = await this.search(`user_${uid}_%`)
      const parsedEntries: UserArtifactIndexEntry[] = []
      for (const row of rows || []) {
        const entry = parseUserIndexRow(row, uid)
        if (entry) parsedEntries.push(entry)
      }
      allEntries = parsedEntries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      this.userListCache.set(uid, allEntries)
      writeSwrCache(['artifact:user_list', this.namespace, uid, 'all'], allEntries)
      writeSwrCache(['artifact:user_list', this.namespace, uid, undefined], allEntries)
    }
    if (!type) return allEntries
    const filtered = allEntries.filter((e) => matchesArtifactType(e.type, type))
    writeSwrCache(['artifact:user_list', this.namespace, uid, type], filtered)
    return filtered
  }

  async loadObjectArtifact<T = SharedArtifactPayload>(type: StudioToolMode, id: string): Promise<T | null> {
    const objKey = formatObjectArtifactKey(type, id)
    if (this.valueByKey.has(objKey)) return this.valueByKey.get(objKey) as T
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
    objectPayload?: Record<string, unknown>
  ): Promise<SharedArtifactPayload> {
    if (typeof userIdOrParams === 'object' && userIdOrParams !== null) {
      const { sdk: _sdk, userId: rawUid, namespace: _ns, content, objectPayload: explicitObj, ...rest } = userIdOrParams
      const uid = String(rawUid || '1').trim()
      const id = String(rest.id || '').trim()
      const type = (rest.type || 'app') as StudioToolMode
      const entry: UserArtifactIndexEntry = {
        ...rest, id, type,
        title: String(rest.title || rest.label || id),
        updatedAt: String(rest.updatedAt || new Date().toISOString()),
        createdBy: String(rest.createdBy || uid),
      }
      return this.saveUserArtifact(uid, entry, explicitObj ?? content)
    }

    const uid = String(userIdOrParams || '1').trim()
    const entry = indexEntry!
    const items = [
      { key: formatUserArtifactKey(uid, entry.type, entry.id), value: entry },
      ...(objectPayload ? [{ key: formatObjectArtifactKey(entry.type, entry.id), value: objectPayload }] : []),
    ]
    await this.put(items)
    return (objectPayload || entry) as SharedArtifactPayload
  }

  async deleteUserArtifact(userId: string, type: StudioToolMode, id: string, deleteSharedPayload = false): Promise<void> {
    const uid = String(userId || '1').trim()
    const keys = [formatUserArtifactKey(uid, type, id)]
    if (deleteSharedPayload) keys.push(formatObjectArtifactKey(type, id))
    await this.delete(keys)
  }

  async saveScript(userId: string, script: SavedScript): Promise<SavedScript> {
    const payload: SavedScript = { ...script, updatedAt: script.updatedAt || new Date().toISOString() }
    const uid = String(userId || '1').trim()
    await this.put([
      { key: `user_${uid}_script_${payload.id}`, value: { ...payload, messages: undefined } },
      { key: `obj_script_${payload.id}`, value: payload },
    ])
    return payload
  }

  async loadScript(scriptId: string): Promise<SavedScript | null> {
    const cleanId = String(scriptId || '').trim().replace(/^obj_script_/, '')
    if (!cleanId) return null
    const objKey = `obj_script_${cleanId}`
    if (this.valueByKey.has(objKey)) return this.valueByKey.get(objKey) as SavedScript
    return this.get<SavedScript>(objKey)
  }

  async listSavedScripts(userId?: string): Promise<SavedScript[]> {
    const cacheKey = userId ? String(userId).trim() : '*'
    const cached = this.scriptsCache.get(cacheKey)
    if (cached) return cached

    const patterns = userId ? [`user_${String(userId).trim()}_script_%`, 'obj_script_%'] : ['obj_script_%']
    const byId = new Map<string, SavedScript>()
    for (const pattern of patterns) {
      try {
        const rows = await this.search(pattern)
        for (const r of rows || []) {
          if (!r?.value) continue
          try {
            const parsed = parseArtifactValue<SavedScript>(r.value)
            if (parsed?.id && !byId.has(parsed.id)) byId.set(parsed.id, parsed)
          } catch { /* Ignore malformed script row */ }
        }
      } catch { /* Ignore search error for pattern */ }
      if (byId.size > 0 && userId) break
    }
    const sorted = Array.from(byId.values()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
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
    if (this.tileScriptCache.has(cleanElId)) return this.tileScriptCache.get(cleanElId) || null
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

export function getArtifactService(sdk: Looker40SDK, namespace = ARTIFACT_NAMESPACE): ArtifactService {
  const ns = normalizeArtifactNamespace(namespace)
  const rawCandidate = (sdk as Looker40SDK & { __rawSdk?: object })?.__rawSdk || sdk
  const rawKey = rawCandidate && (typeof rawCandidate === 'object' || typeof rawCandidate === 'function') ? (rawCandidate as object) : DEFAULT_SDK_KEY
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

export const searchArtifactsRaw = (sdk: Looker40SDK, namespace: string, key: string): Promise<ArtifactRowLike[]> =>
  getArtifactService(sdk, namespace).search(key)
export const searchArtifacts = (sdk: Looker40SDK, key: string, namespace = ARTIFACT_NAMESPACE): Promise<ArtifactRowLike[]> =>
  getArtifactService(sdk, namespace).search(key)
export const getArtifacts = (sdk: Looker40SDK, keys: string | string[], namespace = ARTIFACT_NAMESPACE): Promise<ArtifactRowLike[]> =>
  getArtifactService(sdk, namespace).getMany(Array.isArray(keys) ? keys : String(keys || '').split(','))
// ponytail: Looker update_artifacts requires the current `version` for existing keys;
// delegate to ArtifactService so cached `versionByKey` skips redundant `artifact` GET calls.
export const putArtifacts = (sdk: Looker40SDK, items: Array<{ key: string; value: unknown }>, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).put(items)
export const deleteArtifacts = (sdk: Looker40SDK, keys: string | string[], namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).delete(keys)
export const getArtifactJson = <T = unknown>(sdk: Looker40SDK, key: string, namespace = ARTIFACT_NAMESPACE): Promise<T | null> =>
  getArtifactService(sdk, namespace).get<T>(key)
export const loadUserEnvironmentId = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<string | null> =>
  getArtifactService(sdk, namespace).getUserEnvironmentId(userId)
export const saveUserEnvironmentId = (sdk: Looker40SDK, userId: string, environmentId: string, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).saveUserEnvironmentId(userId, environmentId)
export const clearUserEnvironmentId = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).clearUserEnvironmentId(userId)
