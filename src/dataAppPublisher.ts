import type { Looker40SDK } from '@looker/sdk'
import { rawLookerRequest } from './lookerApi'

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
    canonical_query?: string
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

export function canonicalQueryJson(query: WidgetQueryEntry['query']): string {
  const norm: Record<string, any> = {
    model: query.model,
    view: query.view,
    fields: query.fields || [],
    ...(query.filters && Object.keys(query.filters).length ? { filters: query.filters } : {}),
    ...(query.sorts?.length ? { sorts: query.sorts } : {}),
    ...(query.limit != null ? { limit: String(query.limit) } : {}),
    ...(query.pivots?.length ? { pivots: query.pivots } : {}),
  }
  return JSON.stringify(norm, Object.keys(norm).sort())
}

// ponytail: seed savedByCanonical from existing.manifestQueries and parallelize create_query +
// Looker REST calls via Promise.all so warm turns only register new/changed queries and finish in 1 RTT.
export async function upsertPublishedDataApp(
  sdk: Looker40SDK,
  bundle: DataAppBundle,
  folderId: string,
  existing?: PublishedAppState | null,
  studioUpdate?: StudioMetadataUpdate
): Promise<PublishedAppState> {
  const savedByCanonical = new Map<string, string>(
    (existing?.manifestQueries || [])
      .filter((mq): mq is typeof mq & { canonical_query: string } => Boolean(mq.canonical_query && mq.query_id))
      .map((mq) => [mq.canonical_query, mq.query_id])
  )

  const validWidgets = (bundle.widgets || [])
    .filter((w) => w.query?.model && w.query?.view && w.query?.fields?.length)
    .map((w) => ({ w, canonical: canonicalQueryJson(w.query) }))

  const pendingSpecs = new Map<string, WidgetQueryEntry['query']>()
  for (const { w, canonical } of validWidgets) {
    if (!savedByCanonical.has(canonical)) pendingSpecs.set(canonical, w.query)
  }

  await Promise.all(
    Array.from(pendingSpecs.entries()).map(async ([canonical, q]) => {
      try {
        const created = await sdk.ok(
          sdk.create_query({
            model: q.model,
            view: q.view,
            fields: q.fields,
            filters: q.filters,
            sorts: q.sorts,
            limit: q.limit ? String(q.limit) : undefined,
            pivots: q.pivots,
          })
        )
        const queryId = String(created.slug || created.id || '')
        if (queryId) savedByCanonical.set(canonical, queryId)
      } catch {
        // Skip widget query registration if Looker rejects a query spec
      }
    })
  )

  const manifestQueries = validWidgets.flatMap(({ w, canonical }) => {
    const query_id = savedByCanonical.get(canonical)
    return query_id
      ? [{ widget_id: w.widget_id, title: w.title || w.widget_id, model: w.query.model, explore: w.query.view, query_id, canonical_query: canonical }]
      : []
  })

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

  if (existing?.dashboardId && existing?.extensionId) {
    let elementId = existing.elementId
    if (!elementId) {
      const dash = await sdk.ok(sdk.dashboard(existing.dashboardId))
      const extEl = (dash.dashboard_elements || []).find((e) => e.type === 'extension')
      if (extEl?.id) elementId = String(extEl.id)
    }
    const bareExistingId = String(existing.extensionId).replace(/^db::/, '')

    const [extResp] = await Promise.all([
      rawLookerRequest<{ id: string }>(
        sdk,
        'PATCH',
        `/data_app_extension/${encodeURIComponent(bareExistingId)}`,
        { dashboard_id: existing.dashboardId },
        {
          label: title,
          description: `Data App: ${title}`,
          code: bundle.prod_code,
        }
      ),
      sdk.ok(
        sdk.update_dashboard(existing.dashboardId, {
          title,
        } as any)
      ),
      elementId
        ? sdk.ok(
            sdk.update_dashboard_element(elementId, {
              title,
              title_hidden: true,
              extension_id: `db::${bareExistingId}`,
              rich_content_json: richContentJson,
            } as any)
          )
        : Promise.resolve(null),
    ])
    const bareId = String(extResp?.id || bareExistingId).replace(/^db::/, '')

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

  const randSuffix = Math.random().toString(16).slice(2, 10)
  const [extResp, dash] = await Promise.all([
    rawLookerRequest<{ id: string }>(
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
    ),
    rawLookerRequest(sdk, 'POST', '/dashboards', undefined, {
      title,
      folder_id: folderId,
      appearance: {
        show_dashboard_header: false,
        page_side_margins: 0,
        tile_space_between: 0,
        tile_shadow: false,
      },
    }).catch(() =>
      sdk.ok(
        sdk.create_dashboard({
          title,
          folder_id: folderId,
        })
      )
    ),
  ])
  const bareId = String(extResp.id).replace(/^db::/, '')
  const dashId = String(dash.id)

  const [createdEl, fullDash] = await Promise.all([
    rawLookerRequest<{ id?: string }>(
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
    ),
    sdk.ok(sdk.dashboard(dashId)),
  ])

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
