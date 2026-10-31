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
  return String(extensionSDK?.lookerHostData?.extensionId || ARTIFACT_NAMESPACE).trim() || ARTIFACT_NAMESPACE
}

export async function searchArtifactsRaw(
  sdk: Looker40SDK,
  namespace: string,
  key: string
): Promise<any[]> {
  const items =
    typeof (sdk as any).search_artifacts === 'function'
      ? await sdk.ok(sdk.search_artifacts({ namespace, key }))
      : await rawLookerRequest<any[]>(
          sdk,
          'GET',
          `/artifacts/${encodeURIComponent(namespace)}/search`,
          { key }
        )
  return Array.isArray(items) ? items : []
}

// ponytail: Looker update_artifacts requires the current `version` for existing keys;
// batch-fetch versions in one `artifact` call (with rawLookerRequest fallback) and upsert with content_type: "application/json".
export async function putArtifacts(
  sdk: Looker40SDK,
  items: Array<{ key: string; value: any }>,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  if (items.length === 0) return
  const versionByKey = new Map<string, number>()
  try {
    const existing =
      typeof (sdk as any).artifact === 'function'
        ? await sdk.ok(
            sdk.artifact({
              namespace,
              key: items.map((i) => i.key).join(','),
            })
          )
        : await rawLookerRequest<any[]>(
            sdk,
            'GET',
            `/artifacts/${encodeURIComponent(namespace)}`,
            { key: items.map((i) => i.key).join(','), fields: 'key,version' }
          )
    for (const a of Array.isArray(existing) ? existing : existing ? [existing] : []) {
      if (a?.key && typeof a.version === 'number') {
        versionByKey.set(a.key, a.version)
      }
    }
  } catch {
    // Keys do not exist yet
  }
  const updates = items.map((item) => {
    const version = versionByKey.get(item.key)
    return {
      key: item.key,
      value: typeof item.value === 'string' ? item.value : JSON.stringify(item.value),
      content_type: 'application/json',
      ...(version !== undefined ? { version } : {}),
    }
  })
  if (typeof (sdk as any).update_artifacts === 'function') {
    await sdk.ok(sdk.update_artifacts(namespace, updates as any))
  } else {
    await rawLookerRequest(sdk, 'PUT', `/artifacts/${encodeURIComponent(namespace)}`, undefined, updates)
  }
}

export async function getArtifactJson<T = any>(
  sdk: Looker40SDK,
  key: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<T | null> {
  try {
    const rows =
      typeof (sdk as any).artifact === 'function'
        ? await sdk.ok(sdk.artifact({ namespace, key }))
        : await searchArtifactsRaw(sdk, namespace, key)
    const list = Array.isArray(rows) ? rows : rows ? [rows] : []
    const found = list.find((r) => r?.key === key) || list[0]
    if (!found?.value) return null
    return (typeof found.value === 'string' ? JSON.parse(found.value) : found.value) as T
  } catch {
    return null
  }
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

export async function saveScriptArtifact(
  sdk: Looker40SDK,
  userId: string,
  script: SavedScript,
  namespace = ARTIFACT_NAMESPACE
): Promise<SavedScript> {
  const payload: SavedScript = {
    ...script,
    updatedAt: script.updatedAt || new Date().toISOString(),
  }
  const uid = String(userId || '1').trim()
  await putArtifacts(
    sdk,
    [
      {
        key: `user_${uid}_script_${payload.id}`,
        value: { ...payload, messages: undefined },
      },
      {
        key: `obj_script_${payload.id}`,
        value: payload,
      },
    ],
    namespace
  )
  return payload
}

export async function loadScriptArtifact(
  sdk: Looker40SDK,
  scriptId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<SavedScript | null> {
  const cleanId = scriptId.trim().replace(/^obj_script_/, '')
  if (!cleanId) return null
  return getArtifactJson<SavedScript>(sdk, `obj_script_${cleanId}`, namespace)
}

export async function listSavedScripts(
  sdk: Looker40SDK,
  userId?: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<SavedScript[]> {
  const patterns = userId
    ? [`user_${String(userId).trim()}_script_%`, 'obj_script_%']
    : ['obj_script_%']
  const byId = new Map<string, SavedScript>()
  for (const pattern of patterns) {
    try {
      const rows = await searchArtifactsRaw(sdk, namespace, pattern)
      for (const r of rows || []) {
        if (!r?.value) continue
        try {
          const parsed = (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as SavedScript
          if (parsed?.id && !byId.has(parsed.id)) {
            byId.set(parsed.id, parsed)
          }
        } catch {}
      }
    } catch {}
    if (byId.size > 0 && userId) break
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  )
}

export async function bindTileScriptArtifact(
  sdk: Looker40SDK,
  elementId: string,
  binding: TileScriptBinding,
  namespace = ARTIFACT_NAMESPACE
): Promise<TileScriptBinding> {
  const saved: TileScriptBinding = {
    scriptId: binding.scriptId,
    code: binding.code,
    ...(binding.title ? { title: binding.title } : {}),
    updatedAt: new Date().toISOString(),
  }
  await putArtifacts(
    sdk,
    [{ key: `tile_element_${String(elementId).trim()}`, value: saved }],
    namespace
  )
  return saved
}

export async function loadTileScriptArtifact(
  sdk: Looker40SDK,
  elementId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<TileScriptBinding | null> {
  const cleanElId = String(elementId || '').trim()
  if (!cleanElId) return null
  const binding = await getArtifactJson<TileScriptBinding>(
    sdk,
    `tile_element_${cleanElId}`,
    namespace
  )
  if (!binding) return null
  if (!binding.code && binding.scriptId) {
    const obj = await loadScriptArtifact(sdk, binding.scriptId, namespace)
    if (obj?.code) {
      return { ...binding, code: obj.code, title: binding.title || obj.title }
    }
  }
  return binding
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

export type StudioToolMode =
  | 'app' | 'data_app' | 'lookml' | 'tile' | 'script' | 'dashboard' | 'health' | 'health_check'

export interface UserArtifactIndexEntry {
  id: string
  type: StudioToolMode
  title: string
  updatedAt: string
  createdBy: string
  targetId?: string
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
}

export type UserArtifactIndex = UserArtifactIndexEntry

export interface SharedArtifactPayload extends UserArtifactIndexEntry {
  code?: string
  content?: string
  messages?: PersistedChatTurn[]
  meta?: Record<string, any>
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

// ponytail: two-tier artifact store — compact (<1 KB) per-user index key (user_${userId}_${type}_${id})
// for fast search_artifacts listing + shared payload key (obj_${type}_${id}) reusing putArtifacts.
export async function saveUserArtifact(
  sdk: Looker40SDK,
  userId: string,
  indexEntry: UserArtifactIndexEntry,
  objectPayload?: Record<string, any>,
  namespace = ARTIFACT_NAMESPACE
): Promise<SharedArtifactPayload> {
  const items = [
    { key: formatUserArtifactKey(userId, indexEntry.type, indexEntry.id), value: indexEntry },
    ...(objectPayload
      ? [{ key: formatObjectArtifactKey(indexEntry.type, indexEntry.id), value: objectPayload }]
      : []),
  ]
  await putArtifacts(sdk, items, namespace)
  return (objectPayload || indexEntry) as SharedArtifactPayload
}

export async function listUserArtifacts(
  sdk: Looker40SDK,
  userId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<UserArtifactIndexEntry[]> {
  const rows = await searchArtifactsRaw(sdk, namespace, `user_${userId}_%`)
  const entries: UserArtifactIndexEntry[] = []
  for (const row of rows || []) {
    if (!row?.value) continue
    try {
      const parsed =
        typeof row.value === 'string'
          ? (JSON.parse(row.value) as Record<string, any>)
          : (row.value as Record<string, any>)
      const keyMatch = String(row.key || '').match(
        /^user_[^_]+_(app|data_app|lookml|tile|script|health|health_check|dashboard)_(.+)$/
      )
      const inferredType = (parsed.type ||
        parsed.contentType ||
        keyMatch?.[1]) as StudioToolMode | undefined
      const inferredId = String(parsed.id || keyMatch?.[2] || '')
      if (inferredId && inferredType) {
        entries.push({
          ...parsed,
          id: inferredId,
          type: inferredType,
          title: String(parsed.title || inferredId),
          updatedAt: String(parsed.updatedAt || ''),
          createdBy: String(parsed.createdBy || userId),
        } as UserArtifactIndexEntry)
      }
    } catch {}
  }
  return entries.sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  )
}

export async function loadObjectArtifact<T = SharedArtifactPayload>(
  sdk: Looker40SDK,
  type: StudioToolMode,
  id: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<T | null> {
  const direct = await getArtifactJson<T>(
    sdk,
    formatObjectArtifactKey(type, id),
    namespace
  )
  if (direct) return direct
  const fallbackRows = await searchArtifactsRaw(sdk, namespace, `%_${type}_${id}`)
  const hit = fallbackRows[0]
  if (!hit?.value) return null
  try {
    return (typeof hit.value === 'string' ? JSON.parse(hit.value) : hit.value) as T
  } catch {
    return null
  }
}

export async function deleteUserArtifact(
  sdk: Looker40SDK,
  userId: string,
  type: StudioToolMode,
  id: string,
  deleteSharedPayload = false,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  const keys = [formatUserArtifactKey(userId, type, id)]
  if (deleteSharedPayload) {
    keys.push(formatObjectArtifactKey(type, id))
  }
  await sdk.ok(sdk.delete_artifact(namespace, keys.join(',')))
}
