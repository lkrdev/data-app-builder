import type { IDashboard, IDashboardElement, Looker40SDK } from '@looker/sdk'

import { type AlertInspectorBundle } from './antigravityTypes'
import {
  DashboardStudioMetadata,
  mergeStudioMetadata,
  StudioMetadataUpdate,
} from './dataAppPublisher'
import {
  getArtifactJson,
  getArtifactService,
  putArtifacts,
  searchArtifactsRaw,
} from './lookerArtifactService'
import {
  ARTIFACT_NAMESPACE,
  type ArtifactExtensionHostLike,
  getArtifactNamespace,
  type SavedScript,
  type SaveUserArtifactParams,
  type SharedArtifactPayload,
  STUDIO_TOOL_MODES,
  type StudioToolMode,
  type TileScriptBinding,
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

// ponytail: batch both user_${userId}_dashboard_${id} and obj_dashboard_${id} into one putArtifacts call
export async function saveNativeContentArtifact(
  sdk: Looker40SDK,
  extensionSDK: ArtifactExtensionHostLike,
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
  const { messages: _messages, ...lightStudio } = merged.studio || {}
  const objPayload = {
    ...merged,
    studio: merged.studio ? lightStudio : undefined,
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
  extensionSDK: ArtifactExtensionHostLike,
  rawId: string
): Promise<NativeContentState> {
  const prefixMatch = rawId.trim().match(/^(dashboard|lookml_dashboard|look|board):(.+)$/i)
  const explicitType = prefixMatch ? (prefixMatch[1].toLowerCase() as NativeContentType) : undefined
  const cleanId = (prefixMatch ? prefixMatch[2] : rawId).trim()
  const stored = await getArtifactJson<RawNativeContentInput>(
    sdk,
    `obj_dashboard_${cleanId}`,
    getArtifactNamespace(extensionSDK)
  )
  if (stored?.id) {
    return normalizeNativeContent(stored, '1', explicitType)
  }

  type RawContentItem = Partial<IDashboard> & {
    id?: string | number
    title?: string | null
    folder?: { id?: string | null } | null
    folder_id?: string | null
    lookml_link_id?: string | null
  }

  const cType: NativeContentType =
    explicitType || (cleanId.includes('::') ? 'lookml_dashboard' : 'dashboard')
  const item: RawContentItem =
    cType === 'look'
      ? await rawLookerRequest<RawContentItem>(sdk, 'GET', `/looks/${encodeURIComponent(cleanId)}`)
      : cType === 'board'
      ? await rawLookerRequest<RawContentItem>(sdk, 'GET', `/boards/${encodeURIComponent(cleanId)}`)
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
  extensionSDK: ArtifactExtensionHostLike,
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

export const saveScriptArtifact = (sdk: Looker40SDK, userId: string, script: SavedScript, namespace = ARTIFACT_NAMESPACE): Promise<SavedScript> =>
  getArtifactService(sdk, namespace).saveScript(userId, script)
export const loadScriptArtifact = (sdk: Looker40SDK, scriptId: string, namespace = ARTIFACT_NAMESPACE): Promise<SavedScript | null> =>
  getArtifactService(sdk, namespace).loadScript(scriptId)
export const loadSingleScriptArtifact = loadScriptArtifact
export const listSavedScripts = (sdk: Looker40SDK, userId?: string, namespace = ARTIFACT_NAMESPACE): Promise<SavedScript[]> =>
  getArtifactService(sdk, namespace).listSavedScripts(userId)
export const loadSavedScriptsList = listSavedScripts
export const deleteScriptArtifact = (sdk: Looker40SDK, userId: string, scriptId: string, namespace = ARTIFACT_NAMESPACE): Promise<void> =>
  getArtifactService(sdk, namespace).deleteScript(userId, scriptId)
export const bindTileScriptArtifact = (sdk: Looker40SDK, elementId: string, binding: TileScriptBinding, namespace = ARTIFACT_NAMESPACE): Promise<TileScriptBinding> =>
  getArtifactService(sdk, namespace).bindTileScript(elementId, binding)
export const bindScriptToTileArtifact = bindTileScriptArtifact
export const loadTileScriptArtifact = (sdk: Looker40SDK, elementId: string, namespace = ARTIFACT_NAMESPACE): Promise<TileScriptBinding | null> =>
  getArtifactService(sdk, namespace).loadTileScript(elementId)

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
      const dash = await rawLookerRequest<{ id: string | number }>(sdk, 'POST', '/dashboards', undefined, {
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
        } as Parameters<Looker40SDK['create_dashboard']>[0])
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
      } as Parameters<Looker40SDK['update_dashboard_element']>[1])
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
  objectPayload?: Record<string, unknown>,
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
  sdk: Looker40SDK,
  userId: string,
  bundle: AlertInspectorBundle,
  namespace = ARTIFACT_NAMESPACE
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
  await saveUserArtifact(
    sdk,
    userId,
    {
      id: alertId,
      type: 'alert',
      title: String(bundle.custom_title || bundle.title || `Alert #${alertId}`),
      targetId: bundle.dashboard_id ? String(bundle.dashboard_id) : alertId,
      updatedAt: now,
      createdBy: String(userId || '1'),
    },
    compact as unknown as Record<string, unknown>,
    namespace
  )
  return compact
}

export const loadAlertArtifact = (
  sdk: Looker40SDK,
  alertId: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<AlertInspectorBundle | null> =>
  loadObjectArtifact<AlertInspectorBundle>(
    sdk,
    'alert',
    String(alertId || '').trim().replace(/^obj_alert_/, ''),
    namespace
  )
