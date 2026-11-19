import type { Looker40SDK } from '@looker/sdk'

import {
  ALLOWED_USER_CONVERSATION_FIELDS, ARTIFACT_NAMESPACE, type ArtifactRowLike,
  assertPointerOnlyArtifactWrite, compactConversationEntryToBudget, evictConversationsToByteBudget,
  FORBIDDEN_ARTIFACT_PROPERTY_NAMES, formatObjectArtifactKey, formatUserArtifactKey, formatUserConversationsKey,
  formatUserEnvArtifactKey, matchesArtifactType, MAX_USER_ENV_ARTIFACT_BYTES, mergeTurnInteractionIds,
  normalizeArtifactNamespace, normalizeConversationLabel, normalizeConversationsArray, normalizeConversationTags,
  normalizeStudioAgentName, parseArtifactValue, parseUserIndexRow, prunePersistedContentItem, readSwrCache,
  resolveConversationRelatedContent, type SavedScript, type SharedArtifactPayload, SOFT_USER_CONVERSATIONS_EVICT_BYTES,
  STUDIO_TOOL_MODES, type StudioToolMode, type TileScriptBinding, type UserArtifactIndexEntry,
  type UserConversationEntry, type UserEnvironmentState, type UserStudioConfig, userStudioConfigArtifactKey,
  utf8ByteLength, writeSwrCache,
} from './lookerArtifactTypes'
export { ArtifactPayloadViolationError, assertPointerOnlyArtifactWrite } from './lookerArtifactTypes'
import { rawLookerRequest } from './lookerTransport'

// ponytail: Unified ArtifactService tracks `versionByKey` in memory so repeat saves skip redundant
// `sdk.artifact` GET lookups (with single-retry version refresh on conflict) and mutates SWR caches in place.
export class ArtifactService {
  private readonly versionByKey = new Map<string, number>()
  private readonly knownMissingKeys = new Set<string>()
  private readonly valueByKey = new Map<string, unknown>()
  private readonly conversationsCache = new Map<string, UserConversationEntry[]>()
  private readonly convLoadByUser = new Map<string, Promise<UserConversationEntry[]>>()
  private readonly convPutByUser = new Map<string, Promise<void>>()
  private readonly envPutByUser = new Map<string, Promise<void>>()
  private readonly deletedConvIdsByUser = new Map<string, Set<string>>()
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
    this.convLoadByUser.clear()
    this.convPutByUser.clear()
    this.envPutByUser.clear()
    this.deletedConvIdsByUser.clear()
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

    const convMatch = key.match(/^user_conversations:(.+)$/)
    if (convMatch) {
      const uid = convMatch[1]
      const prevList = this.conversationsCache.get(uid)
      const deletedSet = this.deletedConvIdsByUser.get(uid)
      const byId = new Map<string, UserConversationEntry>()
      for (const c of normalizeConversationsArray(parsedVal)) {
        if (deletedSet?.has(c.id)) continue
        const p = prevList?.find((x) => x.id === c.id)
        const keepItems = Boolean(p?.contentItems?.length && c.contentItems === undefined)
        const pNewer = Boolean(p && String(p.updatedAt || '') > String(c.updatedAt || ''))
        const mergedTurns = p ? mergeTurnInteractionIds(p.turnInteractionIds, c.turnInteractionIds) : c.turnInteractionIds
        const mergedInFlight = pNewer ? p?.inFlight : c.inFlight
        byId.set(c.id, p ? {
          ...(pNewer ? c : p), ...(pNewer ? p : c),
          ...(keepItems ? { contentItems: p.contentItems } : {}),
          ...(mergedTurns?.length ? { turnInteractionIds: mergedTurns } : {}),
          ...(p.interactionId || c.interactionId ? { interactionId: (pNewer ? p.interactionId : c.interactionId) || p.interactionId || c.interactionId } : {}),
          ...(p.environmentId || c.environmentId ? { environmentId: (pNewer ? p.environmentId : c.environmentId) || p.environmentId || c.environmentId } : {}),
          ...(mergedInFlight !== undefined ? { inFlight: mergedInFlight } : {}),
        } : c)
      }
      for (const p of prevList || []) if (!byId.has(p.id) && !deletedSet?.has(p.id)) byId.set(p.id, p)
      const sorted = Array.from(byId.values()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      const normalized = evictConversationsToByteBudget(sorted, SOFT_USER_CONVERSATIONS_EVICT_BYTES)
      this.conversationsCache.set(uid, normalized)
      writeSwrCache(['artifact:conversations', this.namespace, uid], normalized)
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
    for (const item of items) assertPointerOnlyArtifactWrite(item.key, item.value)
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

  async getUserEnvironmentState(userId: string): Promise<UserEnvironmentState | null> {
    const key = formatUserEnvArtifactKey(userId)
    const stored = this.valueByKey.has(key) ? this.valueByKey.get(key) : await this.get<UserEnvironmentState | string>(key)
    if (typeof stored === 'string') return stored.trim() ? { environmentId: stored.trim() } : null
    const envId = String((stored as UserEnvironmentState | undefined)?.environmentId || '').trim()
    if (!envId) return null
    const hash = typeof (stored as UserEnvironmentState).sourcesHash === 'string' ? (stored as UserEnvironmentState).sourcesHash!.trim() : ''
    const updatedAt = typeof (stored as UserEnvironmentState).updatedAt === 'string' ? (stored as UserEnvironmentState).updatedAt : undefined
    return { environmentId: envId, ...(hash ? { sourcesHash: hash } : {}), ...(updatedAt ? { updatedAt } : {}) }
  }

  async getUserEnvironmentId(userId: string): Promise<string | null> {
    return (await this.getUserEnvironmentState(userId))?.environmentId || null
  }

  private enqueueEnvOp(userId: string, op: () => Promise<void>): Promise<void> {
    const uid = String(userId || '').trim() || '1'
    const next = (this.envPutByUser.get(uid) || Promise.resolve()).catch(() => {}).then(op)
    this.envPutByUser.set(uid, next)
    return next
  }

  saveUserEnvironmentId(userId: string, environmentId: string, sourcesHash?: string): Promise<void> {
    const envId = String(environmentId || '').trim()
    if (!envId) return this.clearUserEnvironmentId(userId).catch(() => {})
    return this.enqueueEnvOp(userId, async () => {
      const explicitHash = typeof sourcesHash === 'string' ? sourcesHash.trim() : undefined
      const prev = explicitHash === undefined ? await this.getUserEnvironmentState(userId) : null
      const rawHash = explicitHash ?? (prev?.environmentId === envId ? prev.sourcesHash || '' : '')
      const effectiveHash = rawHash.length <= 64 ? rawHash : ''
      const updatedAt = new Date().toISOString()
      let payload: UserEnvironmentState = { environmentId: envId, ...(effectiveHash ? { sourcesHash: effectiveHash } : {}), updatedAt }
      if (utf8ByteLength(JSON.stringify(payload)) > MAX_USER_ENV_ARTIFACT_BYTES) payload = { environmentId: envId.slice(0, 256), updatedAt }
      await this.put([{ key: formatUserEnvArtifactKey(userId), value: payload }])
    })
  }

  clearUserEnvironmentId(userId: string): Promise<void> {
    return this.enqueueEnvOp(userId, () => this.delete(formatUserEnvArtifactKey(userId)))
  }

  async getUserConfig(userId: string): Promise<UserStudioConfig> {
    const uid = String(userId || '').trim() || '1'
    const key = userStudioConfigArtifactKey(uid)
    const stored = this.valueByKey.has(key) ? this.valueByKey.get(key) : await this.get<Partial<UserStudioConfig> | string>(key)
    const obj = stored && typeof stored === 'object' ? (stored as Partial<UserStudioConfig>) : undefined
    return {
      userId: uid,
      agentName: normalizeStudioAgentName(typeof stored === 'string' ? stored : obj?.agentName),
      ...(typeof obj?.themeMode === 'string' ? { themeMode: obj.themeMode } : {}),
      ...(typeof obj?.requirePermission === 'boolean' ? { requirePermission: obj.requirePermission } : {}),
      ...(typeof obj?.busySendAction === 'string' ? { busySendAction: obj.busySendAction } : {}),
      ...(typeof obj?.maxToolRounds === 'number' ? { maxToolRounds: obj.maxToolRounds } : {}),
      ...(typeof obj?.selectedFolderId === 'string' ? { selectedFolderId: obj.selectedFolderId } : {}),
      updatedAt: typeof obj?.updatedAt === 'string' ? obj.updatedAt : '',
    }
  }

  async saveUserConfig(
    userId: string,
    patch: Partial<Omit<UserStudioConfig, 'userId' | 'updatedAt'>>
  ): Promise<UserStudioConfig> {
    const uid = String(userId || '').trim() || '1'
    const prev = await this.getUserConfig(uid).catch(() => null)
    const nextConfig: UserStudioConfig = {
      userId: uid,
      agentName: normalizeStudioAgentName(patch.agentName ?? prev?.agentName),
      ...(patch.themeMode !== undefined ? { themeMode: patch.themeMode } : prev?.themeMode !== undefined ? { themeMode: prev.themeMode } : {}),
      ...(patch.requirePermission !== undefined ? { requirePermission: patch.requirePermission } : prev?.requirePermission !== undefined ? { requirePermission: prev.requirePermission } : {}),
      ...(patch.busySendAction !== undefined ? { busySendAction: patch.busySendAction } : prev?.busySendAction !== undefined ? { busySendAction: prev.busySendAction } : {}),
      ...(patch.maxToolRounds !== undefined ? { maxToolRounds: patch.maxToolRounds } : prev?.maxToolRounds !== undefined ? { maxToolRounds: prev.maxToolRounds } : {}),
      ...(patch.selectedFolderId !== undefined ? { selectedFolderId: patch.selectedFolderId } : prev?.selectedFolderId !== undefined ? { selectedFolderId: prev.selectedFolderId } : {}),
      updatedAt: new Date().toISOString(),
    }
    await this.put([{ key: userStudioConfigArtifactKey(uid), value: nextConfig }])
    return nextConfig
  }

  private enqueueConversationsPut(uid: string): Promise<void> {
    const run = () => this.put([{ key: formatUserConversationsKey(uid), value: this.conversationsCache.get(uid) || [] }]).then(() => {})
    const active = this.convPutByUser.get(uid)
    const next = active ? active.then(run, run) : run()
    const tracked = next.finally(() => { if (this.convPutByUser.get(uid) === tracked) this.convPutByUser.delete(uid) })
    this.convPutByUser.set(uid, tracked)
    return next
  }

  async listConversations(userId: string): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cached = this.conversationsCache.get(uid)
    if (cached) return cached
    let pending = this.convLoadByUser.get(uid)
    if (!pending) {
      pending = this.get<UserConversationEntry[] | { conversations?: UserConversationEntry[] }>(formatUserConversationsKey(uid))
        .then((raw) => {
          this.convLoadByUser.delete(uid)
          const deletedSet = this.deletedConvIdsByUser.get(uid)
          const loaded = normalizeConversationsArray(raw).filter((c) => !deletedSet?.has(c.id))
          const current = this.conversationsCache.get(uid)
          const merged = current
            ? [...current, ...loaded.filter((c) => !current.some((x) => x.id === c.id))].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
            : loaded
          this.conversationsCache.set(uid, merged)
          writeSwrCache(['artifact:conversations', this.namespace, uid], merged)
          return merged
        }, (err) => { this.convLoadByUser.delete(uid); throw err })
      this.convLoadByUser.set(uid, pending)
    }
    return pending
  }

  async getConversation(id: string, userId = '1'): Promise<UserConversationEntry | null> {
    const cleanId = String(id || '').trim()
    if (!cleanId) return null
    const list = await this.listConversations(userId)
    return list.find((c) => c.id === cleanId) || null
  }

  isConversationDeleted(userId: string, conversationId: string): boolean {
    const uid = String(userId || '1').trim()
    const cleanId = String(conversationId || '').trim()
    return Boolean(cleanId && this.deletedConvIdsByUser.get(uid)?.has(cleanId))
  }

  async saveConversation(userId: string, entry: Partial<UserConversationEntry> & { id: string }): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(entry.id || '').trim()
    if (!cleanId) return []
    const convKey = formatUserConversationsKey(uid)
    const entryRec = entry as Record<string, unknown>
    for (const k of Object.keys(entryRec)) {
      if (entryRec[k] === undefined || k === 'title') continue
      if (FORBIDDEN_ARTIFACT_PROPERTY_NAMES.has(k) || !ALLOWED_USER_CONVERSATION_FIELDS.has(k)) {
        assertPointerOnlyArtifactWrite(convKey, [entry])
      }
    }
    const now = new Date().toISOString()
    if (!this.conversationsCache.has(uid)) await this.listConversations(uid)
    if (this.isConversationDeleted(uid, cleanId)) return this.conversationsCache.get(uid) || []
    const existing = this.conversationsCache.get(uid) || []
    const prev = existing.find((c) => c.id === cleanId)
    const prevNewer = Boolean(entry.updatedAt && prev?.updatedAt && entry.updatedAt < prev.updatedAt)
    let mergedContentItems = prevNewer && prev?.contentItems ? prev.contentItems : entry.contentItems
    if (mergedContentItems === undefined && prev?.contentItems?.length) mergedContentItems = prev.contentItems
    const prunedItems = mergedContentItems ? mergedContentItems.map((it) => prunePersistedContentItem(it)) : undefined
    const mergedType = String((prevNewer ? prev?.type : entry.type) || entry.type || prev?.type || 'app')
    const mergedExplores = ((prevNewer ? prev?.explores : entry.explores) ?? prev?.explores)?.slice(0, 16)
    const mergedTurns = mergeTurnInteractionIds(prev?.turnInteractionIds, entry.turnInteractionIds)
    const latestTurnFinalId = mergedTurns && mergedTurns.length > 0 ? mergedTurns[mergedTurns.length - 1][1] : undefined
    const mergedInteractionId = latestTurnFinalId || (prevNewer ? prev?.interactionId : entry.interactionId) || prev?.interactionId
    const nextInFlight = prevNewer && prev?.inFlight !== undefined ? prev.inFlight : entry.inFlight !== undefined ? entry.inFlight : prev?.inFlight
    const mergedTags = normalizeConversationTags(
      (prevNewer ? prev?.tags : entry.tags) ?? prev?.tags,
      mergedExplores,
      prunedItems?.map((it) => it.contentType),
      mergedType
    )
    const rawMergedContent = prev?.content || entry.content
      ? (prevNewer ? { ...entry.content, ...prev?.content } : { ...prev?.content, ...entry.content })
      : undefined
    const mergedCaId = entry.caConversationId ?? prev?.caConversationId ?? (typeof rawMergedContent?.caConversationId === 'string' ? rawMergedContent.caConversationId : undefined)
    const nextTabKey = !prevNewer && entry.activeContentTabKey !== undefined ? entry.activeContentTabKey : prev?.activeContentTabKey
    const merged: UserConversationEntry = {
      ...(prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => ALLOWED_USER_CONVERSATION_FIELDS.has(k) && k !== 'inFlight')) : {}),
      ...(!prevNewer ? Object.fromEntries(Object.entries(entryRec).filter(([k]) => ALLOWED_USER_CONVERSATION_FIELDS.has(k) && k !== 'inFlight' && k !== 'contentItems')) : {}),
      ...(rawMergedContent ? { content: rawMergedContent } : {}),
      ...(prunedItems !== undefined ? { contentItems: prunedItems } : {}),
      ...(nextTabKey !== undefined ? { activeContentTabKey: nextTabKey } : {}),
      ...(mergedExplores ? { explores: mergedExplores } : {}),
      ...(mergedTurns?.length ? { turnInteractionIds: mergedTurns } : {}),
      ...(mergedInteractionId ? { interactionId: mergedInteractionId } : {}),
      ...(mergedCaId ? { caConversationId: mergedCaId } : {}),
      ...(nextInFlight !== undefined ? { inFlight: Boolean(nextInFlight) } : {}),
      ...(mergedTags?.length ? { tags: mergedTags } : {}),
      id: cleanId,
      type: mergedType,
      label: normalizeConversationLabel((prevNewer ? prev?.label : entry.label) || prev?.label || (entry as { title?: string }).title, cleanId),
      createdAt: prev?.createdAt || entry.createdAt || now,
      updatedAt: prevNewer && prev?.updatedAt ? prev.updatedAt : entry.updatedAt || now,
    }
    if (!mergedTags?.length) delete merged.tags
    if (!mergedTurns?.length) delete merged.turnInteractionIds
    const compacted = compactConversationEntryToBudget(merged)
    const sortedList = [compacted, ...existing.filter((c) => c.id !== cleanId)].sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )
    const nextList = evictConversationsToByteBudget(sortedList, SOFT_USER_CONVERSATIONS_EVICT_BYTES, cleanId)
    assertPointerOnlyArtifactWrite(convKey, nextList)
    this.conversationsCache.set(uid, nextList)
    writeSwrCache(['artifact:conversations', this.namespace, uid], nextList)
    await this.enqueueConversationsPut(uid)
    return this.conversationsCache.get(uid) || nextList
  }

  async pruneConversationsByIds(userId: string, idsToPrune: ReadonlyArray<string>): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const pruneSet = new Set(idsToPrune.map((id) => String(id || '').trim()).filter(Boolean))
    if (pruneSet.size === 0) return this.listConversations(uid)
    let deletedSet = this.deletedConvIdsByUser.get(uid)
    if (!deletedSet) { deletedSet = new Set(); this.deletedConvIdsByUser.set(uid, deletedSet) }
    pruneSet.forEach((id) => deletedSet!.add(id))
    const existing = this.conversationsCache.has(uid) ? this.conversationsCache.get(uid)! : await this.listConversations(uid)
    const next = existing.filter((c) => !pruneSet.has(c.id))
    if (next.length === existing.length) return existing
    this.conversationsCache.set(uid, next)
    writeSwrCache(['artifact:conversations', this.namespace, uid], next)
    await this.enqueueConversationsPut(uid)
    return this.conversationsCache.get(uid) || next
  }

  async archiveConversation(userId: string, conversationId: string, archived = true): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(conversationId || '').trim()
    const nowIso = new Date().toISOString()
    const existing = this.conversationsCache.has(uid) ? this.conversationsCache.get(uid)! : await this.listConversations(uid)
    const nextList = existing.map((c) => {
      if (c.id !== cleanId) return c
      const prevTs = Date.parse(String(c.updatedAt || ''))
      const updatedAt = nowIso > String(c.updatedAt || '') || !Number.isFinite(prevTs) ? nowIso : new Date(prevTs + 1).toISOString()
      return { ...c, archived, updatedAt }
    })
    this.conversationsCache.set(uid, nextList)
    writeSwrCache(['artifact:conversations', this.namespace, uid], nextList)
    await this.enqueueConversationsPut(uid)
    return this.conversationsCache.get(uid) || nextList
  }

  async deleteConversation(
    userId: string,
    conversationId: string,
    options?: boolean | { deleteRelatedContent?: boolean; conversation?: Partial<UserConversationEntry> & { id: string } }
  ): Promise<UserConversationEntry[]> {
    const uid = String(userId || '1').trim()
    const cleanId = String(conversationId || '').trim()
    const deleteRelatedContent = typeof options === 'boolean' ? options : Boolean(options?.deleteRelatedContent)
    const preCached = this.conversationsCache.get(uid)
    let deletedSet = this.deletedConvIdsByUser.get(uid)
    if (!deletedSet) { deletedSet = new Set(); this.deletedConvIdsByUser.set(uid, deletedSet) }
    deletedSet.add(cleanId)
    let rawColdTarget: UserConversationEntry | undefined
    if (!preCached && !(typeof options === 'object' && options?.conversation)) {
      const raw = await this.get<UserConversationEntry[] | { conversations?: UserConversationEntry[] }>(formatUserConversationsKey(uid))
      const allLoaded = normalizeConversationsArray(raw)
      rawColdTarget = allLoaded.find((c) => c.id === cleanId)
      if (!this.conversationsCache.has(uid)) this.conversationsCache.set(uid, allLoaded.filter((c) => !deletedSet!.has(c.id)))
    }
    const existing = this.conversationsCache.has(uid) ? this.conversationsCache.get(uid)! : await this.listConversations(uid)
    const targetConv = (typeof options === 'object' && options?.conversation) || preCached?.find((c) => c.id === cleanId) || rawColdTarget || existing.find((c) => c.id === cleanId) || { id: cleanId }
    const next = existing.filter((c) => c.id !== cleanId)
    this.conversationsCache.set(uid, next)
    writeSwrCache(['artifact:conversations', this.namespace, uid], next)
    await this.enqueueConversationsPut(uid)

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

  async clearAllConversations(userId: string, extraConversationIds?: readonly string[]): Promise<void> {
    const uid = String(userId || '1').trim()
    let deletedSet = this.deletedConvIdsByUser.get(uid)
    if (!deletedSet) { deletedSet = new Set(); this.deletedConvIdsByUser.set(uid, deletedSet) }
    for (const id of extraConversationIds || []) if (id) deletedSet.add(String(id).trim())
    const existing = this.conversationsCache.has(uid) ? this.conversationsCache.get(uid)! : await this.listConversations(uid).catch(() => [])
    const preUserEntries = this.userListCache.get(uid) || []
    const indexKeySet = new Set<string>()
    for (const conv of existing) {
      if (conv?.id) deletedSet.add(conv.id)
      for (const k of resolveConversationRelatedContent(conv, uid).userIndexKeys) indexKeySet.add(k)
    }
    for (const entry of preUserEntries) indexKeySet.add(formatUserArtifactKey(uid, entry.type, entry.id))
    this.conversationsCache.set(uid, [])
    this.userListCache.set(uid, [])
    writeSwrCache(['artifact:conversations', this.namespace, uid], [])
    for (const t of ['all', undefined, ...Array.from(STUDIO_TOOL_MODES)] as const) writeSwrCache(['artifact:user_list', this.namespace, uid, t], [])
    const searched = await this.search(`user_${uid}_%`).catch(() => [] as ArtifactRowLike[])
    for (const row of searched || []) {
      const k = String(row?.key || '').trim()
      if (k.startsWith(`user_${uid}_`)) indexKeySet.add(k)
    }
    const remaining = (this.conversationsCache.get(uid) || []).filter((c) => !deletedSet.has(c.id))
    this.conversationsCache.set(uid, remaining)
    writeSwrCache(['artifact:conversations', this.namespace, uid], remaining)
    await this.enqueueConversationsPut(uid)
    if (indexKeySet.size > 0) {
      try { await this.delete(Array.from(indexKeySet)) } catch { /* Ignore missing index keys */ }
    }
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

  async deleteUserArtifact(userId: string, type: StudioToolMode, id: string, deleteSharedPayload = false): Promise<void> {
    const uid = String(userId || '1').trim()
    const keys = [formatUserArtifactKey(uid, type, id)]
    if (deleteSharedPayload) keys.push(formatObjectArtifactKey(type, id))
    await this.delete(keys)
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
        for (const r of (await this.search(pattern)) || []) {
          if (!r?.value) continue
          try {
            const parsed = parseArtifactValue<SavedScript>(r.value)
            if (parsed?.id && !byId.has(parsed.id)) byId.set(parsed.id, parsed)
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
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
  if (!byNs) { byNs = new Map<string, ArtifactService>(); servicesBySdk.set(rawKey, byNs) }
  let svc = byNs.get(ns)
  if (!svc) { svc = new ArtifactService(sdk, ns); byNs.set(ns, svc) }
  return svc
}
export const clearArtifactServiceCache = (): void => { servicesBySdk = new WeakMap<object, Map<string, ArtifactService>>() }

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
export const loadUserEnvironmentState = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<UserEnvironmentState | null> =>
  getArtifactService(sdk, namespace).getUserEnvironmentState(userId)
export const loadUserEnvironmentId = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<string | null> =>
  getArtifactService(sdk, namespace).getUserEnvironmentId(userId)
export const saveUserEnvironmentId = (sdk: Looker40SDK, userId: string, environmentId: string, namespace = ARTIFACT_NAMESPACE, sourcesHash?: string): Promise<void> =>
  getArtifactService(sdk, namespace).saveUserEnvironmentId(userId, environmentId, sourcesHash)
export const clearUserEnvironmentId = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).clearUserEnvironmentId(userId)
export const clearAllUserConversations = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE, extraConversationIds?: readonly string[]): Promise<void> =>
  getArtifactService(sdk, namespace).clearAllConversations(userId, extraConversationIds)
export const pruneUserConversations = (sdk: Looker40SDK, userId: string, idsToPrune: ReadonlyArray<string>, namespace = ARTIFACT_NAMESPACE): Promise<UserConversationEntry[]> =>
  getArtifactService(sdk, namespace).pruneConversationsByIds(userId, idsToPrune)
export const loadUserStudioConfig = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<UserStudioConfig> =>
  getArtifactService(sdk, namespace).getUserConfig(userId)
export const saveUserStudioConfig = (
  sdk: Looker40SDK,
  userId: string,
  patchOrAgentName: string | Partial<Omit<UserStudioConfig, 'userId' | 'updatedAt'>>,
  namespace = ARTIFACT_NAMESPACE
): Promise<UserStudioConfig> =>
  getArtifactService(sdk, namespace).saveUserConfig(
    userId,
    typeof patchOrAgentName === 'string' ? { agentName: patchOrAgentName } : patchOrAgentName
  )
