import type { IDashboard, IDashboardElement, Looker40SDK } from '@looker/sdk'

import { type AlertInspectorBundle } from './antigravityTypes'
import {
  DashboardStudioMetadata,
  isLooker404Error,
  mergeStudioMetadata,
  StudioMetadataUpdate,
} from './dataAppPublisher'
import {
  getArtifactJson,
  getArtifactService,
} from './lookerArtifactService'
import {
  ARTIFACT_NAMESPACE,
  type ArtifactExtensionHostLike,
  formatStudioContentItemTitle,
  getArtifactNamespace,
  type SavedScript,
  type SharedArtifactPayload,
  STUDIO_TOOL_MODES,
  type StudioContentItem,
  type StudioContentItemType,
  type StudioToolMode,
  type TileScriptBinding,
  toTurnCrudItem,
  type TurnCrudItem,
  type UserArtifactIndexEntry,
  type UserConversationEntry,
} from './lookerArtifactTypes'
import { rawLookerRequest } from './lookerTransport'

export * from './lookerArtifactTypes'
export * from './lookerArtifactService'

export type NativeContentType = 'dashboard' | 'lookml_dashboard' | 'look' | 'board'

export type NativeContentElementLike = Partial<IDashboardElement> & Record<string, unknown>

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
  elements?: NativeContentElementLike[]
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
  elements?: NativeContentElementLike[]
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

export type RawNativeContentInput = Partial<NativeContentBundle & NativeContentState> &
  Record<string, unknown>

export function normalizeNativeContent(
  raw: RawNativeContentInput | null | undefined,
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

const sessionNativeContentCache = new Map<string, NativeContentState>()
const sessionAlertBundleCache = new Map<string, AlertInspectorBundle>()

export function clearSessionAlertCache(): void {
  sessionAlertBundleCache.clear()
  sessionNativeContentCache.clear()
}

export async function saveNativeContentArtifact(
  _sdk: Looker40SDK,
  _extensionSDK: ArtifactExtensionHostLike,
  _userId: string,
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
  sessionNativeContentCache.set(id, merged)
  return merged
}

export async function loadNativeContentById(
  sdk: Looker40SDK,
  extensionSDK: ArtifactExtensionHostLike,
  rawId: string
): Promise<NativeContentState> {
  const prefixMatch = rawId.trim().match(/^(dashboard|lookml_dashboard|look|board):(.+)$/i)
  const explicitType = prefixMatch ? (prefixMatch[1].toLowerCase() as NativeContentType) : undefined
  const cleanId = (prefixMatch ? prefixMatch[2] : rawId).trim()
  const cached = sessionNativeContentCache.get(cleanId)
  if (cached && (!explicitType || cached.contentType === explicitType)) return cached

  type RawContentItem = Partial<IDashboard> & {
    id?: string | number
    title?: string | null
    folder?: { id?: string | null } | null
    folder_id?: string | null
    lookml_link_id?: string | null
  }

  const cType: NativeContentType =
    explicitType || (cleanId.includes('::') ? 'lookml_dashboard' : 'dashboard')
  try {
    const item: RawContentItem =
      cType === 'look'
        ? await rawLookerRequest<RawContentItem>(sdk, 'GET', `/looks/${encodeURIComponent(cleanId)}`)
        : cType === 'board'
        ? await rawLookerRequest<RawContentItem>(sdk, 'GET', `/boards/${encodeURIComponent(cleanId)}`)
        : await sdk.ok(sdk.dashboard(cleanId))
    const id = String(item.id || cleanId)
    const finalType: NativeContentType =
      explicitType || (id.includes('::') ? 'lookml_dashboard' : cType)
    const activeLayout = item.dashboard_layouts?.find((l) => l.active) || item.dashboard_layouts?.[0]
    const hydrated = normalizeNativeContent(
      {
        id,
        contentType: finalType,
        title: item.title || `${finalType} #${id}`,
        folderId: String(item.folder?.id || item.folder_id || '1'),
        tileCount: item.dashboard_elements?.length,
        filterCount: item.dashboard_filters?.length,
        layoutId: activeLayout?.id ? String(activeLayout.id) : undefined,
        elementIds: item.dashboard_elements?.map((el) => String(el.id || '')).filter(Boolean),
        filterNames: item.dashboard_filters?.map((f) => String(f.name || f.title || '')).filter(Boolean),
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
    sessionNativeContentCache.set(cleanId, hydrated)
    return hydrated
  } catch (liveErr) {
    const stored = await getArtifactJson<RawNativeContentInput>(
      sdk,
      `obj_dashboard_${cleanId}`,
      getArtifactNamespace(extensionSDK)
    )
    if (stored?.id) return normalizeNativeContent(stored, '1', explicitType)
    throw liveErr
  }
}

export interface TileElementScriptPayload { scriptId: string; title: string; code: string; updatedAt: string }

function parseRichContentJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch { return {} }
}

async function getDashboardElementSafe(
  sdk: Looker40SDK,
  cleanElId: string,
  allowMissing404Only = false
): Promise<Partial<IDashboardElement> | null> {
  try {
    return typeof (sdk as Partial<Looker40SDK>).dashboard_element === 'function'
      ? await sdk.ok(sdk.dashboard_element(cleanElId))
      : await rawLookerRequest<IDashboardElement>(sdk, 'GET', `/dashboard_elements/${encodeURIComponent(cleanElId)}`)
  } catch (err) {
    if (allowMissing404Only && !isLooker404Error(err)) throw err
    return null
  }
}

async function patchDashboardElementVerified(sdk: Looker40SDK, cleanElId: string, body: Partial<IDashboardElement>): Promise<IDashboardElement> {
  const updated = typeof (sdk as Partial<Looker40SDK>).update_dashboard_element === 'function'
    ? await sdk.ok(sdk.update_dashboard_element(cleanElId, body as Parameters<Looker40SDK['update_dashboard_element']>[1]))
    : await rawLookerRequest<IDashboardElement>(sdk, 'PATCH', `/dashboard_elements/${encodeURIComponent(cleanElId)}`, undefined, body)
  if (!updated?.rich_content_json) throw new Error(`Looker update_dashboard_element(#${cleanElId}) returned empty rich_content_json`)
  return updated
}

export const loadScriptArtifact = (sdk: Looker40SDK, scriptId: string, namespace = ARTIFACT_NAMESPACE): Promise<SavedScript | null> =>
  getArtifactService(sdk, namespace).loadScript(scriptId)
export const loadSingleScriptArtifact = loadScriptArtifact
export const listSavedScripts = (sdk: Looker40SDK, userId?: string, namespace = ARTIFACT_NAMESPACE): Promise<SavedScript[]> =>
  getArtifactService(sdk, namespace).listSavedScripts(userId)
export const loadSavedScriptsList = listSavedScripts
export const deleteScriptArtifact = (sdk: Looker40SDK, userId: string, scriptId: string, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).deleteScript(userId, scriptId)
export const loadTileScriptArtifact = (sdk: Looker40SDK, elementId: string, namespace = ARTIFACT_NAMESPACE): Promise<TileScriptBinding | null> =>
  getArtifactService(sdk, namespace).loadTileScript(elementId)

export async function saveTileScriptToElement(
  sdk: Looker40SDK, elementId: string, binding: { scriptId: string; title: string; code: string }
): Promise<TileElementScriptPayload> {
  const cleanElId = String(elementId || '').trim()
  if (!cleanElId) throw new Error('saveTileScriptToElement requires a non-empty dashboard elementId')
  const existingEl = await getDashboardElementSafe(sdk, cleanElId, true)
  const payload: TileElementScriptPayload = {
    scriptId: String(binding.scriptId || '').trim() || `tile_${cleanElId}`,
    title: String(binding.title || '').trim() || 'Python Script Tile',
    code: String(binding.code ?? ''),
    updatedAt: new Date().toISOString(),
  }
  const rich_content_json = JSON.stringify({ ...parseRichContentJsonObject(existingEl?.rich_content_json), python_tile_script: payload })
  await patchDashboardElementVerified(sdk, cleanElId, { rich_content_json })
  return payload
}

export async function loadTileScriptFromElement(
  sdk: Looker40SDK, elementId: string, namespace = ARTIFACT_NAMESPACE
): Promise<TileElementScriptPayload | null> {
  const cleanElId = String(elementId || '').trim()
  if (!cleanElId) return null
  const el = await getDashboardElementSafe(sdk, cleanElId)
  const rawTileScript = parseRichContentJsonObject(el?.rich_content_json).python_tile_script
  if (rawTileScript && typeof rawTileScript === 'object' && !Array.isArray(rawTileScript)) {
    const rec = rawTileScript as Record<string, unknown>, code = String(rec.code ?? '')
    if (code.trim().length > 0) {
      const scriptId = String(rec.scriptId ?? '').trim() || `tile_${cleanElId}`
      return { scriptId, title: String(rec.title ?? '').trim() || scriptId, code, updatedAt: String(rec.updatedAt ?? '') }
    }
  }
  const legacy = await loadTileScriptArtifact(sdk, cleanElId, namespace)
  if (legacy && String(legacy.code ?? '').trim().length > 0) {
    const scriptId = String(legacy.scriptId || '').trim() || `tile_${cleanElId}`
    return { scriptId, title: String(legacy.title || '').trim() || scriptId, code: legacy.code, updatedAt: String(legacy.updatedAt || '') }
  }
  return null
}

export async function publishScriptDashboard(
  sdk: Looker40SDK,
  params: { script: SavedScript; folderId: string; extensionId: string; existingDashboardId?: string; namespace?: string }
): Promise<{ dashboardId: string; elementId: string; extensionId: string }> {
  const { script, folderId, extensionId, existingDashboardId } = params
  const title = script.title || 'Python Runner Dashboard'
  const extId = extensionId || 'data_app_builder::data_app_builder'
  const dashBody = {
    title, load_configuration: 'wait', run_on_load: false, show_filters_bar: true,
    appearance: { show_dashboard_header: true, page_side_margins: 0, tile_space_between: 0, tile_shadow: false },
  }
  let dashId = existingDashboardId?.trim() || ''
  if (dashId) {
    try {
      await rawLookerRequest(sdk, 'PATCH', `/dashboards/${encodeURIComponent(dashId)}`, undefined, dashBody)
    } catch (err) {
      if (!isLooker404Error(err)) throw err
      dashId = ''
    }
  }
  if (!dashId) {
    try {
      const dash = await rawLookerRequest<{ id: string | number }>(sdk, 'POST', '/dashboards', undefined, { ...dashBody, folder_id: folderId })
      dashId = String(dash.id)
    } catch {
      const dash = await sdk.ok(sdk.create_dashboard({ title, folder_id: folderId, load_configuration: 'wait', show_filters_bar: true } as Parameters<Looker40SDK['create_dashboard']>[0]))
      dashId = String(dash.id)
    }
  }
  const fullDash = await sdk.ok(sdk.dashboard(dashId))
  const els = fullDash.dashboard_elements || []
  const existingExtEl =
    els.find((e) => e.type === 'extension' && script.elementId && String(e.id) === String(script.elementId)) ??
    els.find((e) => e.type === 'extension' && e.extension_id === extId) ??
    els.find((e) => e.type === 'extension')
  let elementId = String(existingExtEl?.id || '')
  const tilePayload: TileElementScriptPayload = {
    scriptId: String(script.id || '').trim() || 'script_tile', title, code: String(script.code ?? ''), updatedAt: new Date().toISOString(),
  }
  const rich_content_json = JSON.stringify({ ...parseRichContentJsonObject(existingExtEl?.rich_content_json), python_tile_script: tilePayload })
  if (!elementId) {
    const createdEl = await rawLookerRequest<Partial<IDashboardElement>>(sdk, 'POST', '/dashboard_elements', undefined, {
      dashboard_id: dashId, type: 'extension', extension_id: extId, title, title_hidden: true, rich_content_json,
    })
    elementId = String(createdEl?.id || '')
  } else {
    await patchDashboardElementVerified(sdk, elementId, { title, title_hidden: true, extension_id: extId, rich_content_json })
  }
  const layouts = fullDash.dashboard_layouts || [], activeLayout = layouts.find((l) => l.active) || layouts[0]
  if (activeLayout?.id) {
    await rawLookerRequest(sdk, 'PATCH', `/dashboard_layouts/${encodeURIComponent(String(activeLayout.id))}`, undefined, { type: 'extension' })
  }
  return { dashboardId: dashId, elementId, extensionId: extId }
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

export const loadObjectArtifact = <T = SharedArtifactPayload>(sdk: Looker40SDK, type: StudioToolMode, id: string, namespace = ARTIFACT_NAMESPACE): Promise<T | null> =>
  getArtifactService(sdk, namespace).loadObjectArtifact<T>(type, id)
export const deleteUserArtifact = (sdk: Looker40SDK, userId: string, type: StudioToolMode, id: string, deleteSharedPayload = false, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).deleteUserArtifact(userId, type, id, deleteSharedPayload)
// ponytail: single per-user JSON array artifact `user_conversations:${me.id}` sorted by updatedAt desc.
export const loadUserConversations = (sdk: Looker40SDK, userId: string, namespace = ARTIFACT_NAMESPACE): Promise<UserConversationEntry[]> =>
  getArtifactService(sdk, namespace).listConversations(userId)
export const loadConversationsList = loadUserConversations
export const loadSingleConversationArtifact = (sdk: Looker40SDK, conversationId: string, userId = '1', namespace = ARTIFACT_NAMESPACE): Promise<UserConversationEntry | null> =>
  getArtifactService(sdk, namespace).getConversation(conversationId, userId)
export const saveUserConversation = (sdk: Looker40SDK, userId: string, entry: Partial<UserConversationEntry> & { id: string }, namespace = ARTIFACT_NAMESPACE): Promise<UserConversationEntry[]> =>
  getArtifactService(sdk, namespace).saveConversation(userId, entry)
export const saveConversationArtifact = saveUserConversation
export const archiveUserConversation = (sdk: Looker40SDK, userId: string, conversationId: string, archived = true, namespace = ARTIFACT_NAMESPACE): Promise<UserConversationEntry[]> =>
  getArtifactService(sdk, namespace).archiveConversation(userId, conversationId, archived)
export const archiveConversationArtifact = archiveUserConversation
export const isUserConversationDeleted = (sdk: Looker40SDK, userId: string, conversationId: string, namespace = ARTIFACT_NAMESPACE): boolean =>
  getArtifactService(sdk, namespace).isConversationDeleted(userId, conversationId)

export async function deleteUserConversation(
  sdk: Looker40SDK,
  userId: string,
  conversationId: string,
  optionsOrNamespace?:
    | string
    | boolean
    | { deleteRelatedContent?: boolean; conversation?: Partial<UserConversationEntry> & { id: string } },
  maybeNamespace?: string
): Promise<UserConversationEntry[]> {
  const namespace =
    typeof optionsOrNamespace === 'string'
      ? optionsOrNamespace
      : maybeNamespace || ARTIFACT_NAMESPACE
  const options =
    typeof optionsOrNamespace === 'string' ? undefined : optionsOrNamespace
  return getArtifactService(sdk, namespace).deleteConversation(userId, conversationId, options)
}

export const deleteConversationArtifact = deleteUserConversation

export async function saveAlertArtifact(
  _sdk: Looker40SDK,
  _userId: string,
  bundle: AlertInspectorBundle,
  _namespace = ARTIFACT_NAMESPACE
): Promise<AlertInspectorBundle> {
  const alertId = String(bundle.alert_id || bundle.id || '').trim().replace(/^obj_alert_/, '')
  const now = new Date().toISOString()
  const compact: AlertInspectorBundle = {
    ...bundle,
    id: alertId,
    alert_id: alertId,
    alert_history_items: (bundle.alert_history_items || []).slice(0, 10),
    updated_at: now,
  }
  if (alertId) sessionAlertBundleCache.set(alertId, compact)
  return compact
}

export async function loadAlertArtifact(
  sdk: Looker40SDK,
  alertId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<AlertInspectorBundle | null> {
  const cleanId = String(alertId || '').trim().replace(/^obj_alert_/, '')
  if (!cleanId) return null
  const cached = sessionAlertBundleCache.get(cleanId)
  const sdkWithAlert = sdk as Partial<Looker40SDK>
  if (typeof sdkWithAlert.get_alert === 'function') {
    try {
      const [rawAlert, rawDetails] = await Promise.all([
        sdk.ok(sdkWithAlert.get_alert(cleanId)),
        rawLookerRequest<unknown>(sdk, 'POST', '/alert_details', undefined, { alert_ids: [cleanId] }).catch(() => null),
      ])
      const alertRec = (rawAlert || {}) as unknown as Record<string, unknown>
      const detailsArr = Array.isArray(rawDetails)
        ? rawDetails
        : Array.isArray((rawDetails as { items?: unknown[]; alerts?: unknown[] } | null)?.items)
        ? (rawDetails as { items: unknown[] }).items
        : Array.isArray((rawDetails as { alerts?: unknown[] } | null)?.alerts)
        ? (rawDetails as { alerts: unknown[] }).alerts
        : []
      const detailRec = (detailsArr.find(
        (d) => d && typeof d === 'object' && String((d as Record<string, unknown>).alert_id ?? (d as Record<string, unknown>).id ?? '') === cleanId
      ) || detailsArr[0] || {}) as Record<string, unknown>
      const directHistoryArr =
        detailsArr.length > 0 && detailsArr[0] && typeof detailsArr[0] === 'object' && ('triggered_at' in (detailsArr[0] as object) || 'alert_sync_id' in (detailsArr[0] as object))
          ? detailsArr
          : undefined
      const historyRaw = detailRec.alert_history_items ?? detailRec.history ?? directHistoryArr ?? alertRec.alert_history_items ?? cached?.alert_history_items
      const appliedRaw = alertRec.applied_dashboard_filters ?? detailRec.applied_dashboard_filters ?? cached?.applied_dashboard_filters
      const destRaw = alertRec.destinations ?? detailRec.destinations ?? cached?.destinations
      const fieldObj = (alertRec.field ?? detailRec.field ?? cached?.field) as AlertInspectorBundle['field'] | undefined
      const dashElId = alertRec.dashboard_element_id ?? detailRec.dashboard_element_id ?? cached?.dashboard_element_id
      let dashId = alertRec.dashboard_id ?? detailRec.dashboard_id ?? cached?.dashboard_id
      if ((dashId === undefined || dashId === null || dashId === '') && dashElId) {
        dashId = (await getDashboardElementSafe(sdk, String(dashElId)))?.dashboard_id ?? dashId
      }
      const liveBundle: AlertInspectorBundle = {
        ...(cached || {}),
        id: cleanId,
        alert_id: cleanId,
        title: String(alertRec.custom_title || detailRec.title || alertRec.title || cached?.title || `Alert #${cleanId}`),
        custom_title: (alertRec.custom_title ?? detailRec.custom_title ?? cached?.custom_title ?? null) as string | null,
        description: (alertRec.description ?? detailRec.description ?? cached?.description ?? null) as string | null,
        dashboard_id: (dashId ?? null) as string | number | null,
        dashboard_name: (detailRec.dashboard_name ?? alertRec.dashboard_name ?? cached?.dashboard_name ?? null) as string | null,
        lookml_dashboard_id: (alertRec.lookml_dashboard_id ?? detailRec.lookml_dashboard_id ?? cached?.lookml_dashboard_id ?? null) as string | null,
        lookml_link_id: (alertRec.lookml_link_id ?? detailRec.lookml_link_id ?? cached?.lookml_link_id ?? null) as string | null,
        dashboard_element_id: (dashElId ?? null) as string | number | null,
        owner_id: (alertRec.owner_id ?? detailRec.owner_id ?? cached?.owner_id) as string | number | undefined,
        owner_display_name: (alertRec.owner_display_name ?? detailRec.owner_display_name ?? cached?.owner_display_name ?? null) as string | null,
        cron: String(alertRec.cron ?? detailRec.cron ?? cached?.cron ?? ''),
        comparison_type: String(alertRec.comparison_type ?? detailRec.comparison_type ?? cached?.comparison_type ?? ''),
        threshold: typeof (alertRec.threshold ?? detailRec.threshold) === 'number' ? Number(alertRec.threshold ?? detailRec.threshold) : cached?.threshold,
        field: fieldObj,
        applied_dashboard_filters: Array.isArray(appliedRaw) ? (appliedRaw as AlertInspectorBundle['applied_dashboard_filters']) : null,
        destinations: Array.isArray(destRaw) ? (destRaw as AlertInspectorBundle['destinations']) : null,
        is_disabled: (alertRec.is_disabled ?? detailRec.is_disabled ?? cached?.is_disabled ?? null) as boolean | null,
        disabled_reason: (alertRec.disabled_reason ?? detailRec.disabled_reason ?? cached?.disabled_reason ?? null) as string | null,
        is_public: (alertRec.is_public ?? detailRec.is_public ?? cached?.is_public ?? null) as boolean | null,
        followed: (alertRec.followed ?? detailRec.followed ?? cached?.followed ?? null) as boolean | null,
        followable: (alertRec.followable ?? detailRec.followable ?? cached?.followable ?? null) as boolean | null,
        error: (detailRec.error ?? alertRec.error ?? cached?.error ?? null) as string | null,
        alert_history_items: Array.isArray(historyRaw) ? (historyRaw as NonNullable<AlertInspectorBundle['alert_history_items']>).slice(0, 10) : null,
        updated_at: String(detailRec.updated_at ?? alertRec.updated_at ?? cached?.updated_at ?? new Date().toISOString()),
      }
      sessionAlertBundleCache.set(cleanId, liveBundle)
      return liveBundle
    } catch {
      if (cached) return cached
    }
  }
  if (cached) return cached
  return loadObjectArtifact<AlertInspectorBundle>(sdk, 'alert', cleanId, namespace)
}

export interface DeletedLookerResource {
  kind: 'dashboards' | 'looks' | 'boards'
  id: string
}

const decodeLookerId = (raw: string): string => {
  try { return decodeURIComponent(raw) } catch { return raw }
}

export function extractDeletedLookerResources(
  activitySteps?: ReadonlyArray<{ kind?: string; content?: string }>
): DeletedLookerResource[] {
  const seen = new Set<string>()
  const out: DeletedLookerResource[] = []
  const push = (rawKind: string, rawId: string) => {
    const k = rawKind.toLowerCase().replace(/s$/, '')
    const kind: DeletedLookerResource['kind'] = k === 'look' ? 'looks' : k === 'board' ? 'boards' : 'dashboards'
    const id = decodeLookerId(String(rawId || '').trim())
    const key = `${kind}:${id}`
    if (id && !seen.has(key)) { seen.add(key); out.push({ kind, id }) }
  }
  const hardDeleteRe = /^(?:#\s*)?DELETE\s+\/(?:api\/[0-9.]+\/)?(dashboards|looks|boards)\/([^/?#\s)]+)(?:\?[^\s)]*)?\s+\(\d+ms\)$/gim
  const patchRe = /^(?:#\s*)?PATCH\s+\/(?:api\/[0-9.]+\/)?(dashboards|looks)\/([^/?#\s)]+)(?:\?[^\s)]*)?\s+(\[ERR\](?:\s+\(\d+ms\))?|\(\d+ms\))$/gim
  const literalIdPrefixRe = /^\s*(?:(?:dashboard_id|look_id)\s*=\s*)?(?:['"]([^'"]+)['"]|(\d+))\s*,/
  const hasTrashFlagRe = /\bdeleted['"]?\s*[:=]\s*(?:True|true)\b/

  for (const st of activitySteps || []) {
    if (st?.kind !== 'codemode') continue
    const txt = String(st.content || '')
    for (const m of txt.matchAll(hardDeleteRe)) push(m[1], m[2])
    const errKeys = new Set<string>()
    const okPatches: Array<[string, string]> = []
    for (const m of txt.matchAll(patchRe)) {
      const kind = m[1].toLowerCase()
      const id = decodeLookerId(m[2])
      if (m[3].startsWith('[ERR]')) errKeys.add(`${kind}:${id}`)
      else okPatches.push([kind, id])
    }
    const codePart = txt.split(/\n#\s*(?:Looker API Telemetry|Output)\b/)[0].replace(/^\s*#.*$/gm, '')
    const outputPart = txt.includes('\n# Output') ? txt.slice(txt.indexOf('\n# Output')) : ''
    const literalTrashKeys = new Set<string>()
    const nonTrashLiteralKeys = new Set<string>()
    const dynamicTrash = new Set<string>()
    const dynamicNonTrash = new Set<string>()
    let sawUpdateCall = false
    for (const m of codePart.matchAll(/\bupdate_(dashboard|look)\s*\(/g)) {
      sawUpdateCall = true
      const kind = m[1].toLowerCase() === 'look' ? 'looks' : 'dashboards'
      const start = (m.index || 0) + m[0].length
      let depth = 1
      let i = start
      while (i < codePart.length && depth > 0) {
        if (codePart[i] === '(') depth += 1
        else if (codePart[i] === ')') depth -= 1
        i += 1
      }
      const argsSlice = codePart.slice(start, Math.max(start, i - 1))
      const isTrash = hasTrashFlagRe.test(argsSlice)
      const idMatch = argsSlice.match(literalIdPrefixRe)
      const litId = idMatch ? decodeLookerId(idMatch[1] || idMatch[2] || '') : ''
      if (litId) {
        if (isTrash) literalTrashKeys.add(`${kind}:${litId}`)
        else nonTrashLiteralKeys.add(`${kind}:${litId}`)
      } else if (isTrash) dynamicTrash.add(kind)
      else dynamicNonTrash.add(kind)
    }
    const rawSoftTrash = !sawUpdateCall && hasTrashFlagRe.test(codePart)
    for (const [kind, id] of okPatches) {
      const key = `${kind}:${id}`
      if (errKeys.has(key) || nonTrashLiteralKeys.has(key)) continue
      if (literalTrashKeys.has(key) || rawSoftTrash) push(kind, id)
      else if (dynamicTrash.has(kind)) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (!dynamicNonTrash.has(kind) || (outputPart && new RegExp(`["']${escaped}["']`).test(outputPart))) push(kind, id)
      }
    }
  }
  return out
}

export function reconcileDeletedLookerContent(
  items: ReadonlyArray<StudioContentItem>,
  activeTabKey: string,
  activitySteps?: ReadonlyArray<{ kind?: string; content?: string }>
): {
  deletedIds: Set<string>
  nextItems: StudioContentItem[]
  nextActiveTabKey: string
  crudItems: TurnCrudItem[]
} {
  const deletedResources = extractDeletedLookerResources(activitySteps)
  const deletedIds = new Set<string>()
  let nextItems = [...items]
  let nextActiveTabKey = activeTabKey
  const crudItems: TurnCrudItem[] = []
  for (const { kind, id: delId } of deletedResources) {
    deletedIds.add(delId)
    const fbType: StudioContentItemType = kind === 'looks' ? 'look' : kind === 'boards' ? 'board' : delId.includes('::') ? 'lookml_dashboard' : 'dashboard'
    const hit = nextItems.find(
      (it) => it.id === delId && (kind === 'looks' ? it.contentType === 'look' : kind === 'boards' ? it.contentType === 'board' : ['dashboard', 'lookml_dashboard', 'data_app', 'data-investigator'].includes(it.contentType))
    )
    if (hit) {
      nextItems = nextItems.filter((it) => it.key !== hit.key)
      if (nextActiveTabKey === hit.key) nextActiveTabKey = nextItems.filter((it) => !it.hidden).slice(-1)[0]?.key || ''
    }
    const ct = hit ? hit.contentType : fbType
    crudItems.push(toTurnCrudItem(hit || { key: `${ct}:${delId}`, id: delId, title: formatStudioContentItemTitle(ct, delId), contentType: ct }, 'deleted'))
  }
  return { deletedIds, nextItems, nextActiveTabKey, crudItems }
}
