import type { Looker40SDK } from '@looker/sdk'

export interface WidgetQueryEntry {
  widget_id: string
  title: string
  query: {
    model: string
    view: string
    fields: string[]
    filters?: Record<string, string>
    sorts?: string[]
    limit?: string
    pivots?: string[]
  }
}

export interface DataAppBundle {
  title: string
  raw_code: string
  prod_code: string
  widgets: WidgetQueryEntry[]
  warnings?: string[]
}

export interface PersistedChatTurn {
  role: 'user' | 'assistant' | 'error'
  text: string
  interactionId?: string
  dashboardId?: string
  widgetCount?: number
}

export interface DashboardStudioMetadata {
  explores?: string[] // canonical "model_id::explore_id" IDs
  lastInteractionId?: string
  environmentId?: string
  updatedAt?: string
  messages?: PersistedChatTurn[]
  // Legacy single-explore / per-user fallback fields
  modelName?: string
  exploreName?: string
  lastSession?: { lastInteractionId: string; environmentId?: string }
}

export interface StudioMetadataUpdate {
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
  messages?: PersistedChatTurn[]
}

export function formatExploreId(modelName: string, exploreName: string): string {
  return `${modelName.trim()}::${exploreName.trim()}`
}

export function parseExploreId(
  exploreId: string
): { modelName: string; exploreName: string } | null {
  const idx = exploreId.indexOf('::')
  if (idx <= 0 || idx >= exploreId.length - 2) return null
  return {
    modelName: exploreId.slice(0, idx).trim(),
    exploreName: exploreId.slice(idx + 2).trim(),
  }
}

export function extractExploreIdsFromCode(code: string): string[] {
  const found = new Set<string>()
  const classModel = code.match(/this\.lookerModel\s*=\s*['"]([^'"]+)['"]/)?.[1]
  const classExplore = code.match(/this\.explore\s*=\s*['"]([^'"]+)['"]/)?.[1]
  if (classModel && classExplore) {
    found.add(formatExploreId(classModel, classExplore))
  }
  const widgetRegex = /looker-model=['"]([^'"]+)['"][^>]*?\bexplore=['"]([^'"]+)['"]/g
  for (const m of code.matchAll(widgetRegex)) {
    if (m[1] && m[2]) found.add(formatExploreId(m[1], m[2]))
  }
  return Array.from(found)
}

export interface PublishedAppState {
  dashboardId: string
  extensionId: string // bare UUID without "db::"
  elementId?: string
  title: string
  folderId: string
  studio?: DashboardStudioMetadata
  manifestQueries?: Array<{
    widget_id: string
    title: string
    model: string
    explore: string
    query_id: string
  }>
}

// ponytail: store shared dashboard chat history + interaction pointer inside dashboard_element.rich_content_json
// (up to 500 text turns) instead of Looker Artifact API or per-user partitioning so anyone opening the dashboard sees full history.
export function mergeStudioMetadata(
  prev: DashboardStudioMetadata | undefined,
  update?: StudioMetadataUpdate
): DashboardStudioMetadata | undefined {
  if (!update) return prev
  const compactMessages = (update.messages ?? prev?.messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-500)
    .map((m) => ({
      role: m.role,
      text: m.text,
      ...(m.interactionId ? { interactionId: m.interactionId } : {}),
      ...(m.dashboardId ? { dashboardId: m.dashboardId } : {}),
      ...(m.widgetCount !== undefined ? { widgetCount: m.widgetCount } : {}),
    }))

  return {
    explores: update.explores ?? prev?.explores ?? [],
    lastInteractionId: update.lastInteractionId || prev?.lastInteractionId,
    environmentId: update.environmentId || prev?.environmentId,
    updatedAt: new Date().toISOString(),
    messages: compactMessages,
  }
}

// ponytail: use SDK's underlying transport.rawRequest (requires raw_api_request: yes in manifest.lkml)
// instead of generating custom SDK bindings for /data_app_extension and /inline_extension.
export async function rawLookerRequest<T = any>(
  sdk: Looker40SDK,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  queryParams?: Record<string, any>,
  body?: any
): Promise<T> {
  const transport = (sdk.authSession as any).transport
  const rawResp = await transport.rawRequest(
    method,
    path,
    queryParams,
    body ? JSON.stringify(body) : undefined
  )
  if (rawResp.ok === false || (rawResp.statusCode && rawResp.statusCode >= 400)) {
    const errBody = typeof rawResp.body === 'string' ? rawResp.body : JSON.stringify(rawResp.body)
    throw new Error(`Looker ${method} ${path} failed (${rawResp.statusCode}): ${errBody}`)
  }
  if (typeof rawResp.body === 'string') {
    const trimmed = rawResp.body.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as T
      } catch {
        return rawResp.body as unknown as T
      }
    }
    return rawResp.body as unknown as T
  }
  return (rawResp.body ?? rawResp) as T
}

export async function fetchInitialLookerMetadata(sdk: Looker40SDK) {
  const [me, models, folders] = await Promise.all([
    sdk.ok(sdk.me('id,display_name,email,personal_folder_id,home_folder_id')),
    sdk.ok(
      sdk.all_lookml_models({
        fields: 'name,label,explores(name,label,description,group_label,hidden)',
      })
    ),
    sdk.ok(sdk.all_folders('id,name,parent_id,is_personal')),
  ])
  const validModels = (models || []).filter((m) => m.name && m.explores && m.explores.length > 0)
  const defaultFolderId = String(me.personal_folder_id || me.home_folder_id || '1')
  return {
    user: me,
    models: validModels,
    folders: folders || [],
    defaultFolderId,
  }
}

export function buildAvailableExploresCatalog(
  models: Array<{ name: string; label: string; explores: any[] }>
): string {
  const lines: string[] = [
    '# Available Looker Explores Catalog (Let the Agent Decide)',
    'No specific explore was pre-selected. Choose the best `model_id::explore_id` explore(s) below and use `run_looker_codemode` (`search_content(terms="...", types="lookml_explore,dashboard,look")` and `lookml_model_explore(model_id, explore_id, fields="name,label,description,fields(dimensions(name,label,description,type),measures(name,label,description,type))")`) to inspect fields and sample rows.',
    '',
  ]
  const sortedModels = [...models].sort((a, b) =>
    String(a.label || a.name).localeCompare(String(b.label || b.name))
  )
  for (const m of sortedModels) {
    const visible = (m.explores || [])
      .filter((e: any) => !e.hidden && e.name)
      .sort((a: any, b: any) =>
        String(a.label || a.name).localeCompare(String(b.label || b.name))
      )
    if (visible.length === 0) continue
    lines.push(`## Model: ${m.label || m.name} (\`${m.name}\`)`)
    for (const e of visible) {
      const id = formatExploreId(m.name, String(e.name))
      const desc = e.description ? ` — ${String(e.description).trim()}` : ''
      lines.push(`- \`${id}\` (${e.label || e.name})${desc}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function cleanSql(sql?: string | null): string {
  if (!sql) return ''
  const s = sql.trim()
  if (/^\$\{TABLE\}\.[a-zA-Z0-9_]+$/i.test(s)) return ''
  return s.length > 100 ? s.slice(0, 97) + '...' : s
}

export async function buildDenseExploreSchema(
  sdk: Looker40SDK,
  modelName: string,
  exploreName: string
): Promise<string> {
  const exp = await sdk.ok(
    sdk.lookml_model_explore({
      lookml_model_name: modelName,
      explore_name: exploreName,
    })
  )
  const lines: string[] = [
    `# Explore: \`${modelName}::${exploreName}\``,
    exp.label ? `**Label:** ${exp.label}` : '',
    exp.description ? `**Description:** ${exp.description}` : '',
    '',
  ].filter(Boolean)

  if (exp.joins && exp.joins.length > 0) {
    lines.push('## Joins')
    for (const j of exp.joins) {
      lines.push(`- \`${j.name}\` (${j.relationship || 'many_to_one'}, ${j.type || 'left_outer'})`)
    }
    lines.push('')
  }

  const fields = exp.fields || {}
  const measures = (fields.measures || []).filter((f) => !f.hidden)
  const dimensions = (fields.dimensions || []).filter((f) => !f.hidden)

  lines.push(`## Measures (${measures.length})`)
  for (const m of measures) {
    const meta = [m.type, m.label ? `"${m.label}"` : ''].filter(Boolean).join(', ')
    let line = `- \`${m.name}\` (${meta})`
    if (m.description) line += ` — ${m.description}`
    const sql = cleanSql(m.sql)
    if (sql) line += ` [SQL: \`${sql}\`]`
    lines.push(line)
  }
  lines.push('')

  lines.push(`## Dimensions (${dimensions.length})`)
  for (const d of dimensions) {
    const meta = [d.type, d.label ? `"${d.label}"` : ''].filter(Boolean).join(', ')
    let line = `- \`${d.name}\` (${meta})`
    if (d.description) line += ` — ${d.description}`
    const sql = cleanSql(d.sql)
    if (sql) line += ` [SQL: \`${sql}\`]`
    lines.push(line)
  }
  lines.push('')

  // Single-view sample query (avoids cross-view fan-out joins)
  const baseView = exp.view_name || exploreName
  const sampleDims = dimensions
    .filter((d) => d.name?.startsWith(`${baseView}.`))
    .slice(0, 2)
    .map((d) => d.name!)
  const sampleMeas = measures
    .filter((m) => m.name?.startsWith(`${baseView}.`))
    .slice(0, 2)
    .map((m) => m.name!)
  const sampleFields = [...sampleDims, ...sampleMeas]

  if (sampleFields.length > 0) {
    try {
      const rows = (await sdk.ok(
        sdk.run_inline_query({
          result_format: 'json',
          body: {
            model: modelName,
            view: exploreName,
            fields: sampleFields,
            limit: '5',
          },
        })
      )) as unknown as Record<string, any>[]
      if (Array.isArray(rows) && rows.length > 0) {
        lines.push(`## Sample Rows (${sampleFields.join(', ')})`)
        lines.push('```json')
        lines.push(JSON.stringify(rows, null, 2))
        lines.push('```')
      }
    } catch {
      // Non-fatal if sample query fails
    }
  }

  return lines.join('\n')
}

export async function loadExistingDashboardApp(
  sdk: Looker40SDK,
  dashboardId: string
): Promise<PublishedAppState & { code: string }> {
  const dash = await sdk.ok(sdk.dashboard(dashboardId))
  const elements = dash.dashboard_elements || []
  const extEl = elements.find(
    (e) => e.type === 'extension' && String(e.extension_id || '').startsWith('db::')
  )
  if (!extEl || !extEl.extension_id) {
    throw new Error(`Dashboard ${dashboardId} does not contain a Data App inline extension tile.`)
  }
  const bareExtId = String(extEl.extension_id).replace(/^db::/, '')
  const code = await rawLookerRequest<string>(
    sdk,
    'GET',
    `/inline_extension/${encodeURIComponent(bareExtId)}/bundle.js`
  )
  let studio: DashboardStudioMetadata | undefined
  let manifestQueries: PublishedAppState['manifestQueries']
  if (typeof extEl.rich_content_json === 'string' && extEl.rich_content_json.trim()) {
    try {
      const parsed = JSON.parse(extEl.rich_content_json)
      if (parsed && typeof parsed === 'object') {
        studio = parsed.data_app_studio
        if (Array.isArray(parsed.data_app_queries)) {
          manifestQueries = parsed.data_app_queries
        }
      }
    } catch {
      // Ignore malformed rich_content_json
    }
  }
  return {
    dashboardId: String(dash.id),
    extensionId: bareExtId,
    elementId: extEl.id ? String(extEl.id) : undefined,
    title: dash.title || 'Data App',
    folderId: String(dash.folder?.id || '1'),
    studio,
    manifestQueries,
    code: typeof code === 'string' ? code : JSON.stringify(code),
  }
}

export async function saveDashboardStudioMetadata(
  sdk: Looker40SDK,
  existing: PublishedAppState,
  studioUpdate: StudioMetadataUpdate
): Promise<PublishedAppState> {
  const nextStudio = mergeStudioMetadata(existing.studio, studioUpdate)
  let elementId = existing.elementId
  if (!elementId) {
    const dash = await sdk.ok(sdk.dashboard(existing.dashboardId))
    const extEl = (dash.dashboard_elements || []).find((e) => e.type === 'extension')
    if (extEl?.id) elementId = String(extEl.id)
  }
  if (elementId) {
    const richContentJson = JSON.stringify({
      data_app_queries_version: 1,
      data_app_queries: existing.manifestQueries || [],
      ...(nextStudio ? { data_app_studio: nextStudio } : {}),
    })
    await sdk.ok(
      sdk.update_dashboard_element(elementId, {
        rich_content_json: richContentJson,
      } as any)
    )
  }
  return {
    ...existing,
    elementId,
    studio: nextStudio,
  }
}

export async function upsertPublishedDataApp(
  sdk: Looker40SDK,
  bundle: DataAppBundle,
  folderId: string,
  existing?: PublishedAppState | null,
  studioUpdate?: StudioMetadataUpdate
): Promise<PublishedAppState> {
  // 1. Register widget queries for "Explore from Here" and tile query lineage
  const savedByCanonical = new Map<string, string>()
  const manifestQueries: Array<{
    widget_id: string
    title: string
    model: string
    explore: string
    query_id: string
  }> = []

  for (const w of bundle.widgets || []) {
    if (!w.query?.model || !w.query?.view || !w.query?.fields?.length) continue
    const canonical = JSON.stringify(w.query, Object.keys(w.query).sort())
    let queryId = savedByCanonical.get(canonical)
    if (!queryId) {
      try {
        const created = await sdk.ok(
          sdk.create_query({
            model: w.query.model,
            view: w.query.view,
            fields: w.query.fields,
            filters: w.query.filters,
            sorts: w.query.sorts,
            limit: w.query.limit ? String(w.query.limit) : undefined,
            pivots: w.query.pivots,
          })
        )
        queryId = String(created.slug || created.id || '')
        if (queryId) savedByCanonical.set(canonical, queryId)
      } catch {
        // Skip widget query registration if Looker rejects a query spec
      }
    }
    if (queryId) {
      manifestQueries.push({
        widget_id: w.widget_id,
        title: w.title || w.widget_id,
        model: w.query.model,
        explore: w.query.view,
        query_id: queryId,
      })
    }
  }

  const nextStudio = mergeStudioMetadata(existing?.studio, studioUpdate)
  const richContentJson = JSON.stringify({
    data_app_queries_version: 1,
    data_app_queries: manifestQueries,
    ...(nextStudio ? { data_app_studio: nextStudio } : {}),
  })

  const title = bundle.title || existing?.title || 'Data App'
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'app'

  // 2. Update existing dashboard + inline extension if present
  if (existing?.dashboardId && existing?.extensionId) {
    const extResp = await rawLookerRequest<{ id: string }>(
      sdk,
      'PATCH',
      `/data_app_extension/${encodeURIComponent(existing.extensionId)}`,
      { dashboard_id: existing.dashboardId },
      {
        label: title,
        description: `Data App: ${title}`,
        code: bundle.prod_code,
      }
    )
    const bareId = String(extResp?.id || existing.extensionId).replace(/^db::/, '')

    await sdk.ok(
      sdk.update_dashboard(existing.dashboardId, {
        title,
      } as any)
    )
    let elementId = existing.elementId
    if (!elementId) {
      const dash = await sdk.ok(sdk.dashboard(existing.dashboardId))
      const extEl = (dash.dashboard_elements || []).find((e) => e.type === 'extension')
      if (extEl?.id) elementId = String(extEl.id)
    }
    if (elementId) {
      await sdk.ok(
        sdk.update_dashboard_element(elementId, {
          title,
          title_hidden: true,
          extension_id: `db::${bareId}`,
          rich_content_json: richContentJson,
        } as any)
      )
    }
    return {
      dashboardId: existing.dashboardId,
      extensionId: bareId,
      elementId,
      title,
      folderId: existing.folderId || folderId,
      studio: nextStudio,
      manifestQueries,
    }
  }

  // 3. Create new inline extension + full-bleed dashboard
  const randSuffix = Math.random().toString(16).slice(2, 10)
  const extResp = await rawLookerRequest<{ id: string }>(
    sdk,
    'POST',
    '/data_app_extension',
    undefined,
    {
      name: `data-app-${slug}-${randSuffix}`,
      label: title,
      description: `Data App: ${title}`,
      code: bundle.prod_code,
    }
  )
  const bareId = String(extResp.id).replace(/^db::/, '')

  let dash: any
  try {
    dash = await rawLookerRequest(sdk, 'POST', '/dashboards', undefined, {
      title,
      folder_id: folderId,
      appearance: {
        show_dashboard_header: false,
        page_side_margins: 0,
        tile_space_between: 0,
        tile_shadow: false,
      },
    })
  } catch {
    dash = await sdk.ok(
      sdk.create_dashboard({
        title,
        folder_id: folderId,
      })
    )
  }

  const dashId = String(dash.id)
  const createdEl = await rawLookerRequest<{ id?: string }>(
    sdk,
    'POST',
    '/dashboard_elements',
    undefined,
    {
      dashboard_id: dashId,
      type: 'extension',
      extension_id: `db::${bareId}`,
      title,
      title_hidden: true,
      rich_content_json: richContentJson,
    }
  )

  const fullDash = await sdk.ok(sdk.dashboard(dashId))
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

  return {
    dashboardId: dashId,
    extensionId: bareId,
    elementId: createdEl?.id ? String(createdEl.id) : undefined,
    title,
    folderId,
    studio: nextStudio,
    manifestQueries,
  }
}

export type NativeContentType = 'dashboard' | 'look' | 'board'

export interface NativeContentBundle {
  id: string
  content_type?: NativeContentType
  title: string
  folder_id?: string
  embed_path?: string
  tile_count?: number
  filter_count?: number
  schedule_id?: string
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
  studio?: DashboardStudioMetadata
}

export function getArtifactNamespace(extensionSDK?: any): string {
  return String(extensionSDK?.lookerHostData?.extensionId || 'data_app_builder')
}

export function resolveNativeEmbedPath(
  contentType: NativeContentType,
  id: string,
  explicitPath?: string
): string {
  const cleanId = encodeURIComponent(String(id).trim())
  if (explicitPath && /^\/(?:embed\/(?:dashboards|looks)|boards)\//.test(explicitPath)) {
    return explicitPath
  }
  if (contentType === 'look') return `/embed/looks/${cleanId}`
  if (contentType === 'board') return `/boards/${cleanId}`
  return `/embed/dashboards/${cleanId}`
}

async function readArtifactJson<T = any>(
  sdk: Looker40SDK,
  namespace: string,
  key: string
): Promise<{ version?: number; data?: T } | null> {
  try {
    const items =
      typeof (sdk as any).search_artifacts === 'function'
        ? await sdk.ok(sdk.search_artifacts({ namespace, key }))
        : await rawLookerRequest<any[]>(sdk, 'GET', `/artifacts/${encodeURIComponent(namespace)}/search`, {
            key,
          })
    const hit = Array.isArray(items) ? items.find((a) => a.key === key) : null
    if (!hit) return null
    let rawVal = hit.value
    if (rawVal === undefined) {
      const full =
        typeof (sdk as any).artifact === 'function'
          ? await sdk.ok(sdk.artifact({ namespace, key }))
          : await rawLookerRequest<any>(
              sdk,
              'GET',
              `/artifacts/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`
            )
      const fullObj = Array.isArray(full) ? full[0] : full
      rawVal = fullObj?.value ?? fullObj
    }
    const parsed =
      typeof rawVal === 'string' ? JSON.parse(rawVal) : (rawVal as T | undefined)
    return {
      version: typeof hit.version === 'number' ? hit.version : undefined,
      data: parsed,
    }
  } catch {
    return null
  }
}

// ponytail: batch both user_${userId}_dashboard_${id} and obj_dashboard_${id} into one update_artifacts call
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
  const contentType: NativeContentType =
    bundle.content_type || existing?.contentType || 'dashboard'
  const title = bundle.title || existing?.title || `Native ${contentType} #${id}`
  const effectiveFolderId = String(bundle.folder_id || existing?.folderId || folderId || '1')
  const embedPath = resolveNativeEmbedPath(
    contentType,
    id,
    bundle.embed_path || existing?.embedPath
  )
  const nextStudio = mergeStudioMetadata(existing?.studio, studioUpdate)
  const updatedAt = nextStudio?.updatedAt || new Date().toISOString()
  const namespace = getArtifactNamespace(extensionSDK)
  const safeUserId = String(userId || '1').trim()
  const userKey = `user_${safeUserId}_dashboard_${id}`
  const objKey = `obj_dashboard_${id}`

  const [prevUser, prevObj] = await Promise.all([
    readArtifactJson(sdk, namespace, userKey),
    readArtifactJson(sdk, namespace, objKey),
  ])

  const userIndexPayload = {
    id,
    type: 'dashboard',
    contentType,
    title,
    updatedAt,
    createdBy: safeUserId,
    targetId: id,
    embedPath,
    folderId: effectiveFolderId,
    explores: nextStudio?.explores || bundle.explores || [],
    lastInteractionId: nextStudio?.lastInteractionId,
    environmentId: nextStudio?.environmentId,
  }
  const objPayload = {
    id,
    type: 'dashboard',
    contentType,
    title,
    folderId: effectiveFolderId,
    embedPath,
    tileCount: bundle.tile_count ?? existing?.tileCount,
    filterCount: bundle.filter_count ?? existing?.filterCount,
    scheduleId: bundle.schedule_id ?? existing?.scheduleId,
    studio: nextStudio,
  }

  const updates: Array<Record<string, any>> = [
    {
      key: userKey,
      value: JSON.stringify(userIndexPayload),
      content_type: 'application/json',
      ...(prevUser?.version !== undefined ? { version: prevUser.version } : {}),
    },
    {
      key: objKey,
      value: JSON.stringify(objPayload),
      content_type: 'application/json',
      ...(prevObj?.version !== undefined ? { version: prevObj.version } : {}),
    },
  ]

  try {
    if (typeof (sdk as any).update_artifacts === 'function') {
      await sdk.ok(sdk.update_artifacts(namespace, updates as any))
    } else {
      await rawLookerRequest(
        sdk,
        'PUT',
        `/artifacts/${encodeURIComponent(namespace)}`,
        undefined,
        updates
      )
    }
  } catch {
    // Non-fatal when running outside an extension host or before artifact namespace is initialized
  }

  return {
    id,
    contentType,
    title,
    folderId: effectiveFolderId,
    embedPath,
    tileCount: objPayload.tileCount,
    filterCount: objPayload.filterCount,
    scheduleId: objPayload.scheduleId,
    studio: nextStudio,
  }
}

export async function loadNativeContentById(
  sdk: Looker40SDK,
  extensionSDK: any,
  rawId: string
): Promise<NativeContentState> {
  const trimmed = rawId.trim()
  const prefixMatch = trimmed.match(/^(dashboard|look|board):(.+)$/i)
  const explicitType = prefixMatch
    ? (prefixMatch[1].toLowerCase() as NativeContentType)
    : undefined
  const cleanId = (prefixMatch ? prefixMatch[2] : trimmed).trim()
  const namespace = getArtifactNamespace(extensionSDK)
  const stored = await readArtifactJson<any>(sdk, namespace, `obj_dashboard_${cleanId}`)
  if (stored?.data && stored.data.id) {
    const d = stored.data
    const cType: NativeContentType = explicitType || d.contentType || 'dashboard'
    return {
      id: String(d.id),
      contentType: cType,
      title: d.title || `Native ${cType} #${d.id}`,
      folderId: String(d.folderId || '1'),
      embedPath: resolveNativeEmbedPath(cType, String(d.id), d.embedPath),
      tileCount: d.tileCount,
      filterCount: d.filterCount,
      scheduleId: d.scheduleId,
      studio: d.studio,
    }
  }

  const cType: NativeContentType = explicitType || 'dashboard'
  if (cType === 'look') {
    const lk = await rawLookerRequest<any>(sdk, 'GET', `/looks/${encodeURIComponent(cleanId)}`)
    return {
      id: String(lk.id || cleanId),
      contentType: 'look',
      title: lk.title || `Look #${cleanId}`,
      folderId: String(lk.folder?.id || lk.folder_id || '1'),
      embedPath: resolveNativeEmbedPath('look', String(lk.id || cleanId)),
    }
  }
  if (cType === 'board') {
    const bd = await rawLookerRequest<any>(sdk, 'GET', `/boards/${encodeURIComponent(cleanId)}`)
    return {
      id: String(bd.id || cleanId),
      contentType: 'board',
      title: bd.title || `Board #${cleanId}`,
      folderId: '1',
      embedPath: resolveNativeEmbedPath('board', String(bd.id || cleanId)),
    }
  }

  const dash = await sdk.ok(sdk.dashboard(cleanId))
  return {
    id: String(dash.id || cleanId),
    contentType: 'dashboard',
    title: dash.title || `Dashboard #${cleanId}`,
    folderId: String(dash.folder?.id || '1'),
    embedPath: resolveNativeEmbedPath('dashboard', String(dash.id || cleanId)),
    tileCount: (dash.dashboard_elements || []).length,
    filterCount: (dash.dashboard_filters || []).length,
  }
}

export async function listUserDashboardArtifacts(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string
): Promise<Array<{ id: string; title: string; contentType: NativeContentType; embedPath: string }>> {
  const namespace = getArtifactNamespace(extensionSDK)
  const key = `user_${String(userId || '1').trim()}_dashboard_%`
  try {
    const items =
      typeof (sdk as any).search_artifacts === 'function'
        ? await sdk.ok(sdk.search_artifacts({ namespace, key }))
        : await rawLookerRequest<any[]>(
            sdk,
            'GET',
            `/artifacts/${encodeURIComponent(namespace)}/search`,
            { key }
          )
    const out: Array<{
      id: string
      title: string
      contentType: NativeContentType
      embedPath: string
    }> = []
    for (const item of items || []) {
      try {
        const parsed =
          typeof item.value === 'string' ? JSON.parse(item.value) : item.value || {}
        if (parsed?.id) {
          const cType: NativeContentType = parsed.contentType || 'dashboard'
          out.push({
            id: String(parsed.id),
            title: String(parsed.title || `#${parsed.id}`),
            contentType: cType,
            embedPath: resolveNativeEmbedPath(cType, String(parsed.id), parsed.embedPath),
          })
        }
      } catch {
        // Ignore unparseable entries
      }
    }
    return out
  } catch {
    return []
  }
}
