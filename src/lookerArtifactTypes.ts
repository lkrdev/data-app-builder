import type { ExtensionSDK } from '@looker/extension-sdk'
import type { IArtifact, Looker40SDK } from '@looker/sdk'
import { mutate, SWRConfig, unstable_serialize } from 'swr'

import { type AlertInspectorBundle, cleanLookmlProjectId } from './antigravityTypes'
export type { AlertInspectorBundle }
import {
  buildCaEmbedPath,
  normalizeCaEmbedPath,
} from './conversationalAnalytics'
import {
  compactPersistedChatTurn,
  PersistedChatTurn,
  type StudioContentItemType,
  type TurnCrudItem,
} from './dataAppPublisher'
export type { StudioContentItemType, TurnCrudItem }

export const ARTIFACT_NAMESPACE = 'data_app_builder::data_app_builder'
export const DEFAULT_STUDIO_AGENT_NAME = 'Ripper'

export interface UserStudioConfig { userId: string; agentName: string; updatedAt: string }
export const normalizeStudioAgentName = (raw?: string | null): string => String(raw ?? '').trim() || DEFAULT_STUDIO_AGENT_NAME
export const userStudioConfigArtifactKey = (userId: string): string => `user_config:${String(userId || '').trim() || '1'}`
const UUID_OR_TILE_ID_REGEX = /^(?:db::)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ArtifactExtensionHostLike = Partial<ExtensionSDK> | { lookerHostData?: { extensionId?: string } } | null | undefined
export type ArtifactRowLike = Partial<IArtifact> & { key?: string; value?: unknown; version?: number; content_type?: string }
interface SwrConfigWithDefaultCache {
  default?: { cache?: { get: (key: string) => unknown; set: (key: string, value: unknown) => void } }
}

export function normalizeArtifactNamespace(raw?: string | null, projectId?: string | null): string {
  const clean = String(raw || '').trim()
  if (!clean || clean === 'data_app_builder' || clean.startsWith('db::') || UUID_OR_TILE_ID_REGEX.test(clean)) return ARTIFACT_NAMESPACE
  if (clean.includes('::')) return clean
  return `${String(projectId || clean).trim() || clean}::${clean}`
}

export function getArtifactNamespace(extensionSDK?: ArtifactExtensionHostLike): string {
  return normalizeArtifactNamespace(extensionSDK?.lookerHostData?.extensionId)
}

export function readSwrCache<T = unknown>(key: unknown): T | undefined {
  try {
    return (SWRConfig as unknown as SwrConfigWithDefaultCache).default?.cache?.get(unstable_serialize(key)) as T | undefined
  } catch {
    return undefined
  }
}

export function writeSwrCache(key: unknown, value: unknown): void {
  try {
    ;(SWRConfig as unknown as SwrConfigWithDefaultCache).default?.cache?.set(unstable_serialize(key), value)
  } catch {
    // Ignore cache write errors
  }
  void mutate(key, value, false).catch(() => {})
}

export type StudioToolMode =
  | 'app' | 'data_app' | 'data-investigator' | 'data_investigator' | 'lookml'
  | 'tile' | 'script' | 'alert' | 'dashboard' | 'health' | 'health_check' | 'conversational-analytics'

export type StudioArtifactType = StudioToolMode

export const STUDIO_TOOL_MODES = new Set<string>([
  'app', 'data_app', 'data-investigator', 'data_investigator', 'lookml',
  'tile', 'script', 'alert', 'dashboard', 'health', 'health_check', 'conversational-analytics',
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
  [key: string]: unknown
}

export type UserArtifactIndex = UserArtifactIndexEntry

export interface SharedArtifactPayload extends UserArtifactIndexEntry {
  code?: string
  content?: unknown
  messages?: PersistedChatTurn[]
  meta?: Record<string, unknown>
}

export interface SaveUserArtifactParams extends Partial<UserArtifactIndexEntry> {
  sdk?: Looker40SDK
  userId: string
  id: string
  type: StudioToolMode
  title?: string
  content?: Record<string, unknown>
  objectPayload?: Record<string, unknown>
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

export interface StudioContentItem {
  key: string // `${contentType}:${id}`
  id: string
  contentType: StudioContentItemType
  title: string // Meaningful human-readable name (e.g. "Executive Revenue Overview", "eCommerce: Order Items")
  embedPath: string
  folderId?: string
  dashboardId?: string
  lookId?: string
  lookmlDashboardId?: string
  exploreId?: string
  extensionId?: string
  sessionId?: string
  scriptId?: string
  alertId?: string
  reportId?: string
  projectId?: string
  rawCode?: string
  updatedAt?: string
  source?: 'created' | 'modified' | 'mention'
  createdInConversation?: boolean
  hidden?: boolean
}

export function formatStudioContentItemTitle(
  contentType: StudioContentItemType,
  id: string,
  rawTitle?: string
): string {
  const cleanId = String(id || '').trim()
  const cleanTitle = String(rawTitle || '').trim()
  if (cleanTitle && cleanTitle !== cleanId && !/^\d+$/.test(cleanTitle)) return cleanTitle
  if (contentType === 'explore' && cleanId.includes('::')) {
    const humanize = (s: string) => s.split(/[_-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    const [model, explore] = cleanId.split('::')
    return `${humanize(model)}: ${humanize(explore)}`
  }
  const labels: Partial<Record<StudioContentItemType, string>> = {
    look: `Look #${cleanId}`,
    lookml_dashboard: `LookML Dashboard (${cleanId})`,
    explore: `Explore (${cleanId})`,
    board: `Board #${cleanId}`,
    data_app: `Data App #${cleanId}`,
    'data-investigator': `Data Investigator #${cleanId}`,
    lookml: `LookML: ${cleanId}`,
    script: `Script (${cleanId})`,
    alert: `Alert #${cleanId}`,
    'conversational-analytics': `CA Chat (${cleanId})`,
    extension: `Extension (${cleanId})`,
    report: `Report (${cleanId})`,
  }
  return labels[contentType] || `Dashboard #${cleanId}`
}

export function resolveStudioContentEmbedPath(
  contentType: StudioContentItemType,
  id: string,
  explicitPath?: string
): string {
  const cleanExplicit = String(explicitPath || '').trim()
  if (cleanExplicit) {
    return contentType === 'conversational-analytics' || /^\/(?:embed\/)?(?:conversations|agents)\//.test(cleanExplicit)
      ? normalizeCaEmbedPath(cleanExplicit)
      : cleanExplicit
  }
  const cleanId = String(id || '').trim()
  const enc = encodeURIComponent(cleanId)
  const paths: Partial<Record<StudioContentItemType, string>> = {
    look: `/embed/looks/${enc}`,
    explore: `/embed/explore/${cleanId.replace('::', '/')}`,
    board: `/embed/boards/${enc}`,
    lookml: `/lookml/${enc}`,
    script: `/tile/${enc}`,
    alert: `/alerts/${enc}`,
    'conversational-analytics': buildCaEmbedPath(cleanId),
    extension: `/embed/extensions/${cleanId}`,
    report: `/embed/reporting/${cleanId}`,
  }
  return paths[contentType] || `/embed/dashboards/${enc}`
}

export function normalizeStudioContentItem(
  raw: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType }
): StudioContentItem {
  const rawId = String(raw.id || '').trim()
  const contentType = raw.contentType
  const canonProj = contentType === 'lookml' ? cleanLookmlProjectId(raw.projectId) : ''
  const id = contentType === 'lookml' ? canonProj || cleanLookmlProjectId(rawId) : rawId
  const key = contentType === 'lookml' ? `lookml:${id}` : String(raw.key || `${contentType}:${id}`).trim()
  const title =
    contentType === 'lookml' && canonProj
      ? `LookML: ${canonProj}`
      : formatStudioContentItemTitle(contentType, id, raw.title)
  const embedPath = resolveStudioContentEmbedPath(contentType, id, raw.embedPath)
  const source: 'created' | 'modified' | 'mention' | undefined =
    raw.source === 'created' || raw.source === 'modified'
      ? raw.source
      : raw.createdInConversation === true
      ? 'created'
      : raw.source === 'mention' || raw.createdInConversation === false
      ? 'mention'
      : undefined
  const createdInConversation =
    raw.createdInConversation !== undefined ? Boolean(raw.createdInConversation) : source !== undefined ? source === 'created' : undefined
  const out: StudioContentItem = Object.assign({}, raw, { key, id, contentType, title, embedPath })
  if (contentType === 'lookml' && (raw.sessionId || id)) out.sessionId = cleanLookmlProjectId(raw.sessionId) || id
  if (canonProj) out.projectId = canonProj
  else if (contentType === 'lookml') delete out.projectId
  if (source !== undefined) out.source = source
  if (createdInConversation !== undefined) out.createdInConversation = createdInConversation
  if (typeof raw.hidden === 'boolean') out.hidden = raw.hidden
  return out
}

export function toTurnCrudItem(
  item: Pick<StudioContentItem, 'key' | 'id' | 'title' | 'contentType'> & { embedPath?: string },
  action: TurnCrudItem['action']
): TurnCrudItem {
  const out: TurnCrudItem = { key: item.key, id: item.id, title: item.title, contentType: item.contentType, action }
  if (item.embedPath) out.embedPath = item.embedPath
  return out
}

export function upsertStudioContentItem(
  items: StudioContentItem[],
  nextRaw: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType }
): { items: StudioContentItem[]; activeKey: string; item: StudioContentItem; existed: boolean } {
  const hidden = typeof nextRaw.hidden === 'boolean' ? nextRaw.hidden : false
  const normalized = normalizeStudioContentItem(Object.assign({}, nextRaw, { hidden }))
  const existingIdx = items.findIndex(
    (it) =>
      it.key === normalized.key ||
      (normalized.contentType === 'lookml' &&
        it.contentType === 'lookml' &&
        (it.projectId || it.id) === (normalized.projectId || normalized.id))
  )
  if (existingIdx >= 0) {
    const prev = items[existingIdx]
    const isCreated = prev.createdInConversation === true || prev.source === 'created' || normalized.createdInConversation === true || normalized.source === 'created'
    const createdInConversation = isCreated ? true : (normalized.createdInConversation ?? prev.createdInConversation)
    const source = isCreated ? ('created' as const) : (normalized.source || prev.source)
    const merged = normalizeStudioContentItem(
      Object.assign({}, prev, nextRaw, {
        hidden,
        title:
          normalized.contentType === 'lookml' && normalized.projectId
            ? `LookML: ${normalized.projectId}`
            : nextRaw.title && nextRaw.title !== normalized.id && !/^\d+$/.test(nextRaw.title)
            ? nextRaw.title
            : prev.title || normalized.title,
        embedPath: nextRaw.embedPath || prev.embedPath || normalized.embedPath,
        ...(source !== undefined ? { source } : {}),
        ...(createdInConversation !== undefined ? { createdInConversation } : {}),
      })
    )
    const nextItems = items.slice()
    nextItems[existingIdx] = merged
    return { items: nextItems, activeKey: merged.key, item: merged, existed: true }
  }
  return { items: items.concat(normalized), activeKey: normalized.key, item: normalized, existed: false }
}

export interface UserConversationContent {
  dashboardId?: string
  lookId?: string
  lookmlDashboardId?: string
  appArtifactId?: string
  scriptId?: string
  alertId?: string
  scheduleId?: string
  reportId?: string
  sessionId?: string
  caConversationId?: string
  id?: string
  contentType?: string
  embedPath?: string
  [key: string]: unknown
}

export interface UserConversationEntry {
  id: string
  type: string
  use_case?: string
  objectId?: string
  label: string
  archived?: boolean
  interactionId?: string
  environmentId?: string
  content?: UserConversationContent
  contentItems?: StudioContentItem[]
  activeContentTabKey?: string
  messages?: PersistedChatTurn[]
  explores?: string[]
  createdAt?: string
  updatedAt: string
}

export function hydrateConversationContentItems(conv: Partial<UserConversationEntry>): StudioContentItem[] {
  const isDefaultLookml = (it?: Partial<StudioContentItem> | null) =>
    Boolean(it && it.contentType === 'lookml' && (it.key === 'lookml:default' || !cleanLookmlProjectId(it.projectId || it.id)))
  const hadDeletedTurn = Boolean(conv.messages?.some((m) => m.crudItems?.some((x) => x.action === 'deleted')))
  if (Array.isArray(conv.contentItems) && (conv.contentItems.length > 0 || hadDeletedTurn)) {
    return conv.contentItems
      .filter((it): it is StudioContentItem => Boolean(it && it.id && it.contentType) && !isDefaultLookml(it))
      .map((it) => normalizeStudioContentItem(it))
  }
  const c = conv.content || {}
  const rawType = String(conv.type || conv.use_case || 'app').trim()
  const fallbackTitle = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : conv.label && conv.label !== conv.id ? conv.label : undefined
  const items: StudioContentItem[] = []
  const pushItem = (item: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType }) => {
    if (!item.id) return
    items.splice(0, items.length, ...upsertStudioContentItem(items, item).items)
  }

  if (rawType === 'conversational-analytics' || rawType === 'ca' || c.caConversationId) {
    const caId = String(c.caConversationId || c.id || conv.objectId || '').trim()
    if (caId) pushItem({ id: caId, contentType: 'conversational-analytics', title: fallbackTitle, embedPath: c.embedPath, updatedAt: conv.updatedAt })
    return items
  }
  if (rawType === 'lookml' || c.sessionId) {
    const projId = cleanLookmlProjectId(c.projectId)
    const sid = cleanLookmlProjectId(c.sessionId || projId || c.id || conv.objectId)
    const canonId = projId || sid
    if (canonId) pushItem({ id: canonId, sessionId: sid || canonId, projectId: projId || undefined, contentType: 'lookml', title: projId ? `LookML: ${projId}` : fallbackTitle, updatedAt: conv.updatedAt })
    return items
  }
  if (rawType === 'alert' || c.alertId || c.contentType === 'alert') {
    const alId = String(c.alertId || c.id || conv.objectId || '').trim()
    if (alId) pushItem({ id: alId, alertId: alId, dashboardId: c.dashboardId ? String(c.dashboardId) : undefined, contentType: 'alert', title: fallbackTitle, embedPath: c.embedPath || `/alerts/${encodeURIComponent(alId)}`, updatedAt: conv.updatedAt })
    return items
  }
  if (rawType === 'tile' || rawType === 'script' || c.scriptId) {
    const scId = String(c.scriptId || c.id || conv.objectId || '').trim()
    if (scId) pushItem({ id: scId, scriptId: scId, contentType: 'script', title: fallbackTitle, updatedAt: conv.updatedAt })
    return items
  }
  if (rawType === 'health' || rawType === 'health_check' || rawType === 'health-check' || c.reportId) {
    const repId = String(c.reportId || c.id || conv.objectId || '').trim()
    if (repId) pushItem({ id: repId, reportId: repId, contentType: 'report', title: fallbackTitle, embedPath: `/health-check/${encodeURIComponent(repId)}`, updatedAt: conv.updatedAt })
    return items
  }

  const baseMeta = { title: fallbackTitle, embedPath: c.embedPath, updatedAt: conv.updatedAt }
  if (c.contentType === 'lookml_dashboard' || c.lookmlDashboardId) {
    const id = String(c.lookmlDashboardId || c.dashboardId || c.id || conv.objectId || '').trim()
    pushItem({ ...baseMeta, id, contentType: 'lookml_dashboard', lookmlDashboardId: id })
  } else if (c.contentType === 'board') {
    pushItem({ ...baseMeta, id: String(c.id || c.dashboardId || conv.objectId || '').trim(), contentType: 'board' })
  } else if (c.contentType === 'explore') {
    const id = String(c.id || conv.objectId || '').trim()
    pushItem({ ...baseMeta, id, contentType: 'explore', exploreId: id })
  } else if (c.dashboardId || (c.contentType !== 'look' && (c.id || conv.objectId))) {
    const id = String(c.dashboardId || c.id || conv.objectId || '').trim()
    const contentType: StudioContentItemType =
      rawType === 'data-investigator' || rawType === 'data_investigator' ? 'data-investigator' : rawType === 'dashboard' || c.contentType === 'dashboard' ? 'dashboard' : 'data_app'
    pushItem({ ...baseMeta, id, contentType, dashboardId: id, extensionId: typeof c.extensionId === 'string' ? c.extensionId : undefined })
  }

  if (c.lookId || c.contentType === 'look') {
    const lookId = String(c.lookId || c.id || conv.objectId || '').trim()
    pushItem({
      id: lookId, contentType: 'look', lookId,
      title: c.dashboardId ? `Look #${lookId}` : fallbackTitle,
      embedPath: c.contentType === 'look' ? c.embedPath : `/embed/looks/${encodeURIComponent(lookId)}`,
      updatedAt: conv.updatedAt,
    })
  }

  return items
}

export type UserConversationSummary = UserConversationEntry
export type ConversationRecord = UserConversationEntry

export interface ConversationRelatedContentInfo {
  mode: string
  objectId: string
  userIndexKeys: string[]
  sharedObjectKeys: string[]
  dashboardId?: string
  lookId?: string
  dashboardIds?: string[]
  lookIds?: string[]
  relatedLinks?: Array<{ label: string; path: string; itemText: string }>
  summary: string
  items: string[]
}

export function resolveConversationRelatedContent(
  conv: Partial<UserConversationEntry> & { id: string },
  userId = '1'
): ConversationRelatedContentInfo {
  const uid = String(userId || '1').trim()
  const c = conv.content || {}
  const prefixMatch = String(conv.id || '').match(
    /^conv_(app|data_app|data-investigator|data_investigator|dashboard|tile|script|health_check|health-check|health|lookml|ca|conversational-analytics)_(.+)$/
  )
  const rawType = String(conv.type || conv.use_case || prefixMatch?.[1] || 'app').trim()
  const stripPrefix = (s: string) =>
    s.replace(/^conv_(?:app|data_app|data-investigator|data_investigator|dashboard|tile|script|health_check|health-check|health|lookml|ca|conversational-analytics)_/, '').replace(/^obj_script_/, '').trim()
  const uniq = (...vals: Array<string | undefined | false>) => Array.from(new Set(vals.filter((v): v is string => Boolean(v))))

  const mentionedIds = new Set<string>()
  for (const msg of conv.messages || []) {
    const text = String((msg as { text?: unknown })?.text || '')
    for (const m of text.matchAll(/@(?:dashboard|look|conversation|explore):([^\s,)]+)|\[Referenced Looker (?:Dashboard|Look|Conversation) #?([^\s\]]+)/gi)) {
      const id = (m[1] || m[2] || '').trim()
      if (id) mentionedIds.add(id)
    }
  }

  const buildRelatedLinks = (itemList: string[]): Array<{ label: string; path: string; itemText: string }> =>
    itemList.flatMap((itemText) => {
      const d = itemText.match(/Dashboard #([^\s(]+)/)?.[1]
      if (d) return [{ label: `Dashboard #${d}`, path: `/dashboards/${encodeURIComponent(d)}`, itemText }]
      const l = itemText.match(/Saved Look #([^\s(]+)/)?.[1]
      if (l) return [{ label: `Look #${l}`, path: `/looks/${encodeURIComponent(l)}`, itemText }]
      const ca = itemText.match(/CA conversation artifact \(obj_ca_([^)]+)\)/)?.[1]
      return ca ? [{ label: `CA Conversation ${ca}`, path: `/embed/conversations/${encodeURIComponent(ca)}`, itemText }] : []
    })

  const hasExplicitContentItems = Array.isArray(conv.contentItems) && conv.contentItems.length > 0

  const enrichWithContentItems = (base: ConversationRelatedContentInfo): ConversationRelatedContentInfo => {
    if (!hasExplicitContentItems) {
      return { ...base, dashboardIds: base.dashboardId ? [base.dashboardId] : [], lookIds: base.lookId ? [base.lookId] : [], relatedLinks: buildRelatedLinks(base.items) }
    }
    const extraUserKeys: string[] = [...base.userIndexKeys]
    const extraSharedKeys: string[] = [...base.sharedObjectKeys]
    const extraDashIds: string[] = base.dashboardId ? [base.dashboardId] : []
    const extraLookIds: string[] = base.lookId ? [base.lookId] : []
    const extraItems: string[] = [...base.items]

    for (const rawItem of conv.contentItems || []) {
      if (!rawItem?.id || rawItem.source === 'mention' || rawItem.createdInConversation === false) continue
      const item = normalizeStudioContentItem(rawItem)
      const itemId = item.id
      const targetId = String(item.dashboardId || item.lookId || item.lookmlDashboardId || itemId).trim()
      if (!itemId && !targetId) continue
      const isCreated = rawItem.createdInConversation === true || rawItem.source === 'created'
      if (!isCreated && itemId !== base.objectId && targetId !== base.objectId && (mentionedIds.has(itemId) || (targetId && mentionedIds.has(targetId)))) continue
      if ((rawType === 'conversational-analytics' || rawType === 'ca') && !isCreated && ['dashboard', 'data_app', 'data-investigator', 'look'].includes(item.contentType)) continue
      if (item.contentType === 'dashboard') {
        const dId = String(item.dashboardId || itemId).trim()
        if (dId) {
          extraDashIds.push(dId)
          extraUserKeys.push(`user_${uid}_dashboard_${dId}`)
          extraSharedKeys.push(`obj_dashboard_${dId}`)
          extraItems.push(`Native Looker Dashboard #${dId} (sdk.delete_dashboard)`, `Content Studio artifact (obj_dashboard_${dId})`)
        }
      } else if (item.contentType === 'look') {
        const lId = String(item.lookId || itemId).trim()
        if (lId) {
          extraLookIds.push(lId)
          extraUserKeys.push(`user_${uid}_dashboard_${lId}`)
          extraSharedKeys.push(`obj_dashboard_${lId}`)
          extraItems.push(`Saved Look #${lId} (sdk.delete_look)`)
        }
      } else if (item.contentType === 'data_app' || item.contentType === 'data-investigator') {
        const dId = String(item.dashboardId || itemId).trim()
        if (dId) {
          extraDashIds.push(dId)
          extraUserKeys.push(`user_${uid}_app_${dId}`, `user_${uid}_data_app_${dId}`, ...(item.contentType === 'data-investigator' ? [`user_${uid}_data-investigator_${dId}`] : []))
          extraSharedKeys.push(`obj_app_${dId}`)
          extraItems.push(`Looker Dashboard #${dId} (sdk.delete_dashboard)`, `Shared app artifact (obj_app_${dId})`)
        }
      } else if (item.contentType === 'conversational-analytics') {
        extraUserKeys.push(`user_${uid}_conversational-analytics_${itemId}`, `user_${uid}_ca_${itemId}`)
        extraSharedKeys.push(`obj_ca_${itemId}`, `obj_conversational-analytics_${itemId}`)
        extraItems.push(`CA conversation artifact (obj_ca_${itemId})`)
      } else if (item.contentType === 'lookml_dashboard' || item.contentType === 'board') {
        extraUserKeys.push(`user_${uid}_dashboard_${itemId}`)
        extraSharedKeys.push(`obj_dashboard_${itemId}`)
        extraItems.push(`Content Studio artifact (obj_dashboard_${itemId})`)
      } else if (item.contentType === 'lookml' && itemId) {
        extraUserKeys.push(`user_${uid}_lookml_${itemId}`)
        extraSharedKeys.push(`obj_lookml_${itemId}`)
        extraItems.push(`LookML session artifact (obj_lookml_${itemId})`)
      } else if (item.contentType === 'script') {
        extraUserKeys.push(`user_${uid}_script_${itemId}`, `user_${uid}_tile_${itemId}`)
        extraSharedKeys.push(`obj_script_${itemId}`, `obj_schedule_${itemId}`)
        extraItems.push(`Shared script artifact (obj_script_${itemId})`, `Script schedule (obj_schedule_${itemId})`)
      } else if (item.contentType === 'alert') {
        extraUserKeys.push(`user_${uid}_alert_${itemId}`, `user_${uid}_tile_${itemId}`)
        extraSharedKeys.push(`obj_alert_${itemId}`)
        extraItems.push(`Looker Alert #${itemId} (obj_alert_${itemId})`)
      } else if (item.contentType === 'report') {
        extraUserKeys.push(`user_${uid}_health_check_${itemId}`, `user_${uid}_health_${itemId}`)
        extraSharedKeys.push(`obj_health_${itemId}`, `obj_health_check_${itemId}`)
        extraItems.push(`Health Check report artifact (obj_health_${itemId})`)
      }
    }

    const dashboardIds = uniq(...extraDashIds)
    const lookIds = uniq(...extraLookIds)
    const items = uniq(...extraItems)
    return {
      ...base,
      objectId: base.objectId || dashboardIds[0] || lookIds[0] || '',
      userIndexKeys: uniq(...extraUserKeys),
      sharedObjectKeys: uniq(...extraSharedKeys),
      dashboardId: base.dashboardId || dashboardIds[0],
      lookId: base.lookId || lookIds[0],
      dashboardIds, lookIds, items,
      relatedLinks: buildRelatedLinks(items),
      summary: items.join(' + ') || base.summary,
    }
  }

  if (rawType === 'dashboard') {
    const contentType = c.contentType || (c.lookId ? 'look' : c.lookmlDashboardId ? 'lookml_dashboard' : 'dashboard')
    const explicitObjectId = stripPrefix(String(conv.objectId || c.dashboardId || c.lookId || c.lookmlDashboardId || c.id || ''))
    const objectId = explicitObjectId || (!hasExplicitContentItems ? stripPrefix(String(conv.id || '')) : '')
    const dashboardId = c.dashboardId ? String(c.dashboardId).trim() : contentType === 'dashboard' && objectId ? objectId : undefined
    const lookId = c.lookId ? String(c.lookId).trim() : contentType === 'look' && objectId ? objectId : undefined
    const items = uniq(
      dashboardId && `Native Looker Dashboard #${dashboardId} (sdk.delete_dashboard)`,
      lookId && `Saved Look #${lookId} (sdk.delete_look)`,
      objectId && `Content Studio artifact (obj_dashboard_${objectId})`
    )
    return enrichWithContentItems({
      mode: 'dashboard', objectId,
      userIndexKeys: uniq(objectId && `user_${uid}_dashboard_${objectId}`, conv.id && conv.id !== objectId && `user_${uid}_dashboard_${conv.id}`),
      sharedObjectKeys: uniq(objectId && `obj_dashboard_${objectId}`),
      dashboardId, lookId, summary: items.join(' + ') || 'Content Studio artifact', items,
    })
  }

  if (rawType === 'alert' || c.alertId || c.contentType === 'alert') {
    const objectId = stripPrefix(String(conv.objectId || c.alertId || c.id || conv.id || ''))
    const dashboardId = c.dashboardId ? String(c.dashboardId).trim() : undefined
    const items = uniq(objectId && `Looker Alert #${objectId} (obj_alert_${objectId})`)
    return enrichWithContentItems({
      mode: 'tile', objectId,
      userIndexKeys: uniq(objectId && `user_${uid}_alert_${objectId}`, objectId && `user_${uid}_tile_${objectId}`),
      sharedObjectKeys: uniq(objectId && `obj_alert_${objectId}`),
      dashboardId, summary: items.join(' + ') || 'Looker alert artifact', items,
    })
  }

  if (rawType === 'tile' || rawType === 'script') {
    const objectId = stripPrefix(String(conv.objectId || c.scriptId || c.id || conv.id || ''))
    const dashboardId = c.dashboardId ? String(c.dashboardId).trim() : undefined
    const items = uniq(
      objectId && `Shared script artifact (obj_script_${objectId})`,
      objectId && `Script schedule (obj_schedule_${objectId})`,
      dashboardId && `Published wrapper Dashboard #${dashboardId} (sdk.delete_dashboard)`
    )
    return enrichWithContentItems({
      mode: 'tile', objectId,
      userIndexKeys: uniq(objectId && `user_${uid}_script_${objectId}`, objectId && `user_${uid}_tile_${objectId}`),
      sharedObjectKeys: uniq(objectId && `obj_script_${objectId}`, objectId && `obj_schedule_${objectId}`),
      dashboardId, summary: items.join(' + ') || 'Python script & schedule artifacts', items,
    })
  }

  if (rawType === 'health' || rawType === 'health_check' || rawType === 'health-check') {
    const objectId = stripPrefix(String(conv.objectId || c.reportId || c.id || conv.id || ''))
    const items = uniq(objectId && `Health Check report artifact (obj_health_${objectId})`)
    return enrichWithContentItems({
      mode: 'health', objectId,
      userIndexKeys: uniq(objectId && `user_${uid}_health_check_${objectId}`, objectId && `user_${uid}_health_${objectId}`),
      sharedObjectKeys: uniq(objectId && `obj_health_${objectId}`, objectId && `obj_health_check_${objectId}`),
      summary: items.join(' + ') || 'Health Check report artifact', items,
    })
  }

  if (rawType === 'lookml') {
    const objectId = cleanLookmlProjectId(stripPrefix(String(conv.objectId || c.sessionId || c.id || c.projectId || (!hasExplicitContentItems ? conv.id : '') || '')))
    const projId = cleanLookmlProjectId(c.projectId)
    const items = uniq(objectId && `LookML session artifact (obj_lookml_${objectId})`, projId && projId !== objectId && `LookML session artifact (obj_lookml_${projId})`)
    return enrichWithContentItems({
      mode: 'lookml', objectId,
      userIndexKeys: uniq(objectId && `user_${uid}_lookml_${objectId}`, projId && `user_${uid}_lookml_${projId}`),
      sharedObjectKeys: uniq(objectId && `obj_lookml_${objectId}`, projId && `obj_lookml_${projId}`),
      summary: items.join(' + ') || 'LookML session artifact', items,
    })
  }

  if (rawType === 'conversational-analytics' || rawType === 'ca') {
    const objectId = stripPrefix(String(conv.objectId || c.caConversationId || c.id || conv.id || ''))
    const items = uniq(objectId && `CA conversation artifact (obj_ca_${objectId})`)
    return enrichWithContentItems({
      mode: 'conversational-analytics', objectId,
      userIndexKeys: uniq(objectId && `user_${uid}_conversational-analytics_${objectId}`, objectId && `user_${uid}_ca_${objectId}`),
      sharedObjectKeys: uniq(objectId && `obj_ca_${objectId}`, objectId && `obj_conversational-analytics_${objectId}`),
      summary: items.join(' + ') || 'CA conversation artifact', items,
    })
  }

  const explicitAppObjectId = stripPrefix(String(conv.objectId || c.dashboardId || c.id || ''))
  const objectId = explicitAppObjectId || (!hasExplicitContentItems ? stripPrefix(String(conv.id || '')) : '')
  const dashboardId = String(c.dashboardId || objectId || '').trim() || undefined
  const appKey = String(c.appArtifactId || (objectId ? `obj_app_${objectId}` : '')).trim()
  const items = uniq(dashboardId && `Looker Dashboard #${dashboardId} (sdk.delete_dashboard)`, appKey && `Shared app artifact (${appKey})`)
  return enrichWithContentItems({
    mode: 'app', objectId,
    userIndexKeys: uniq(objectId && `user_${uid}_app_${objectId}`, objectId && `user_${uid}_data_app_${objectId}`, conv.id && conv.id !== objectId && `user_${uid}_app_${conv.id}`),
    sharedObjectKeys: uniq(appKey),
    dashboardId, summary: items.join(' + ') || 'Data App dashboard & artifact', items,
  })
}

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

export function parseArtifactValue<T = unknown>(raw: unknown): T {
  if (typeof raw !== 'string') return raw as T
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

export function prunePersistedContentItem(raw: StudioContentItem): StudioContentItem {
  const { rawCode: _rawCode, ...compact } = normalizeStudioContentItem(raw)
  return compact
}

export function prunePersistedMessages(messages?: PersistedChatTurn[]): PersistedChatTurn[] | undefined {
  return Array.isArray(messages) ? messages.map((m) => compactPersistedChatTurn(m, true)) : undefined
}

export function normalizeConversationsArray(raw: unknown): UserConversationEntry[] {
  const rawObj =
    raw && typeof raw === 'object' ? (raw as { conversations?: unknown[] }) : undefined
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObj?.conversations)
    ? rawObj.conversations
    : []
  return list
    .filter(
      (c): c is Partial<UserConversationEntry> & { id: string; title?: string } =>
        Boolean(c && typeof c === 'object' && 'id' in c && (c as { id?: unknown }).id)
    )
    .map((c) => ({
      ...c,
      id: String(c.id),
      type: c.type || 'app',
      label: String(c.label || c.title || c.id),
      updatedAt: String(c.updatedAt || c.createdAt || ''),
      ...(c.activeContentTabKey === 'lookml:default' ? { activeContentTabKey: undefined } : {}),
    }))
    .sort((a: UserConversationEntry, b: UserConversationEntry) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )
}

export function parseUserIndexRow(
  row: ArtifactRowLike | null | undefined,
  fallbackUserId: string
): UserArtifactIndexEntry | null {
  if (!row?.value) return null
  try {
    const parsed = parseArtifactValue<Record<string, unknown>>(row.value)
    if (!parsed || typeof parsed !== 'object') return null
    const keyMatch = String(row.key || '').match(
      /^user_[^_]+_(app|data_app|data-investigator|data_investigator|lookml|tile|script|health|health_check|dashboard|conversational-analytics)_(.+)$/
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
  t === 'data_app' || t === 'data-investigator' || t === 'data_investigator'
    ? 'app'
    : t === 'health_check'
    ? 'health'
    : t === 'script'
    ? 'tile'
    : t || ''

export function matchesArtifactType(entryType: StudioToolMode, filterType?: StudioToolMode): boolean {
  return !filterType || canonArtifactMode(entryType) === canonArtifactMode(filterType)
}
