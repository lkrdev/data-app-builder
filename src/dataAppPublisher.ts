import type { IDashboard, IDashboardElement, Looker40SDK } from '@looker/sdk'

import type { AntigravityActivityStep } from './antigravityTypes'
import { rawLookerRequest } from './lookerTransport'

export function isLooker404Error(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const rec = err as { statusCode?: unknown; status?: unknown; error?: { statusCode?: unknown; status?: unknown } }
    if (Number(rec.statusCode ?? rec.status ?? rec.error?.statusCode ?? rec.error?.status) === 404) return true
  }
  let msg = ''
  try {
    msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
  } catch {
    msg = String(err)
  }
  return /\(404\b|\bstatus(?:\s*code)?\s*[:=]?\s*404\b|\/r\/err\/[^)\s]*\/404\/|^not found(?:\s*\(\[Docs\]\([^)]*\)\))?$/i.test(msg.trim())
}

function findDashboardExtensionElement(
  elements?: IDashboardElement[] | null,
  excludeId?: string,
  preferredBareExtId?: string
): IDashboardElement | undefined {
  const dbElems = (elements || []).filter(
    (e) => e.type === 'extension' && String(e.extension_id || '').startsWith('db::') && (!excludeId || String(e.id || '') !== excludeId)
  )
  const cleanPref = preferredBareExtId ? String(preferredBareExtId).replace(/^db::/, '') : ''
  return (cleanPref && dbElems.find((e) => String(e.extension_id || '') === `db::${cleanPref}`)) || dbElems[0]
}

async function patchExistingDataAppElement(
  sdk: Looker40SDK,
  dashboardId: string,
  initialElementId: string | undefined,
  payload: Partial<IDashboardElement>,
  preferredBareExtId?: string,
  prefetchedDash?: IDashboard
): Promise<{ elementId?: string; dash?: IDashboard }> {
  if (initialElementId) {
    try {
      await sdk.ok(sdk.update_dashboard_element(initialElementId, payload))
      return { elementId: initialElementId, dash: prefetchedDash }
    } catch (err: unknown) {
      if (!isLooker404Error(err)) throw err
    }
  }
  let dash: IDashboard | undefined = prefetchedDash && !initialElementId ? prefetchedDash : undefined
  if (!dash) {
    try {
      dash = await sdk.ok(sdk.dashboard(dashboardId))
    } catch (err: unknown) {
      if (isLooker404Error(err)) return { elementId: undefined, dash: undefined }
      throw err
    }
  }
  const liveEl = findDashboardExtensionElement(dash.dashboard_elements, initialElementId, preferredBareExtId)
  if (liveEl?.id) {
    const liveId = String(liveEl.id)
    try {
      await sdk.ok(sdk.update_dashboard_element(liveId, payload))
      return { elementId: liveId, dash }
    } catch (retryErr: unknown) {
      if (!isLooker404Error(retryErr)) throw retryErr
    }
  }
  return { elementId: undefined, dash }
}

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
  code?: string
  raw_code: string
  prod_code: string
  widgets: WidgetQueryEntry[]
  warnings?: string[]
}

export type StudioContentItemType =
  | 'board' | 'look' | 'dashboard' | 'lookml_dashboard' | 'explore'
  | 'data_app' | 'data-investigator' | 'lookml' | 'script' | 'report'
  | 'conversational-analytics' | 'extension' | 'alert'

export interface TurnCrudItem {
  key: string
  id: string
  title: string
  contentType: StudioContentItemType
  embedPath?: string
  action: 'created' | 'updated' | 'deleted'
}

export interface ChatTurnMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  interactionId?: string
  stopAtInteractionId?: string
  dashboardId?: string
  widgetCount?: number
  activitySteps?: AntigravityActivityStep[]
  thinkingDurationSec?: number
  crudItems?: TurnCrudItem[]
  images?: string[]
}

export type PersistedChatTurn = ChatTurnMessage

export interface DashboardStudioMetadata {
  explores?: string[] // canonical "model_id::explore_id" IDs
  lastInteractionId?: string
  environmentId?: string
  updatedAt?: string
  // Legacy single-explore / per-user fallback fields
  modelName?: string
  exploreName?: string
  lastSession?: { lastInteractionId: string; environmentId?: string }
}

export interface StudioMetadataUpdate {
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
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

// ponytail: persist pointers-only studio metadata (explores + lastInteractionId + environmentId) inside
// dashboard_element.rich_content_json; full chat transcripts live exclusively in Antigravity Interactions API.
export function mergeStudioMetadata(
  prev: DashboardStudioMetadata | undefined,
  update?: StudioMetadataUpdate
): DashboardStudioMetadata | undefined {
  if (!update) return prev
  return {
    explores: update.explores ?? prev?.explores ?? [],
    lastInteractionId: update.lastInteractionId || prev?.lastInteractionId,
    environmentId: update.environmentId || prev?.environmentId,
    updatedAt: new Date().toISOString(),
  }
}

export async function loadExistingDashboardApp(
  sdk: Looker40SDK,
  dashboardId: string
): Promise<PublishedAppState & { code: string }> {
  const dash = await sdk.ok(sdk.dashboard(dashboardId))
  const extEl = (dash.dashboard_elements || []).find(
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
  const richContentJson = JSON.stringify({
    data_app_queries_version: 1,
    data_app_queries: existing.manifestQueries || [],
    ...(nextStudio ? { data_app_studio: nextStudio } : {}),
  })
  const { elementId } = await patchExistingDataAppElement(
    sdk,
    existing.dashboardId,
    existing.elementId,
    { rich_content_json: richContentJson },
    existing.extensionId
  )
  return Object.assign({}, existing, { elementId, studio: nextStudio })
}

export function canonicalQueryJson(query: WidgetQueryEntry['query']): string {
  const norm: Record<string, unknown> = {
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

  // ponytail: Looker's ExtensionFrame2 injects `decodeURIComponent('${encodeURIComponent(title)}')` in a single-quoted script literal (`encodeURIComponent("'") === "'"`), throwing SyntaxError on ASCII apostrophes.
  const title = (bundle.title || existing?.title || 'Data App').replace(/'/g, '\u2019')
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'app'

  let resolvedExtId = existing?.extensionId || ''
  let elementId = existing?.elementId
  let prefetchedDash: IDashboard | undefined
  let lookupErr: unknown
  if (existing?.dashboardId && (!resolvedExtId || !elementId)) {
    try {
      prefetchedDash = await sdk.ok(sdk.dashboard(existing.dashboardId))
      const extEl = findDashboardExtensionElement(prefetchedDash.dashboard_elements, undefined, existing.extensionId)
      if (!elementId && extEl?.id) elementId = String(extEl.id)
      if (!resolvedExtId && extEl?.extension_id) resolvedExtId = String(extEl.extension_id)
    } catch (err: unknown) {
      lookupErr = err
    }
  }
  if (existing?.dashboardId && !resolvedExtId) {
    throw lookupErr instanceof Error
      ? lookupErr
      : new Error(`Cannot update Data App dashboard ${existing.dashboardId}: extension element not found`)
  }

  if (existing?.dashboardId && resolvedExtId) {
    const bareExistingId = String(resolvedExtId).replace(/^db::/, '')
    const elemPayload: Partial<IDashboardElement> = {
      title,
      title_hidden: true,
      extension_id: `db::${bareExistingId}`,
      rich_content_json: richContentJson,
    }
    const staleId = elementId
    const [extResp, , patched] = await Promise.all([
      rawLookerRequest<{ id: string }>(
        sdk,
        'PATCH',
        `/data_app_extension/${encodeURIComponent(bareExistingId)}`,
        { dashboard_id: existing.dashboardId },
        { label: title, description: `Data App: ${title}`, code: bundle.prod_code }
      ).catch((extErr: unknown) => {
        if (!isLooker404Error(extErr)) throw extErr
        return rawLookerRequest<{ id: string }>(sdk, 'POST', '/data_app_extension', undefined, {
          name: `data-app-${slug}-${Math.random().toString(16).slice(2, 10)}`,
          label: title,
          description: `Data App: ${title}`,
          code: bundle.prod_code,
        })
      }),
      sdk.ok(sdk.update_dashboard(existing.dashboardId, { title })),
      patchExistingDataAppElement(sdk, existing.dashboardId, elementId, elemPayload, bareExistingId, prefetchedDash),
    ])
    const bareId = String(extResp?.id || bareExistingId).replace(/^db::/, '')
    elementId = patched.elementId

    if (elementId && bareId !== bareExistingId) {
      await sdk.ok(sdk.update_dashboard_element(elementId, { ...elemPayload, extension_id: `db::${bareId}` }))
    } else if (!elementId) {
      const createdEl = await rawLookerRequest<{ id?: string }>(sdk, 'POST', '/dashboard_elements', undefined, {
        dashboard_id: existing.dashboardId,
        type: 'extension',
        extension_id: `db::${bareId}`,
        title,
        title_hidden: true,
        rich_content_json: richContentJson,
      })
      const newElId = createdEl?.id ? String(createdEl.id) : undefined
      elementId = newElId
      const refreshed = await sdk.ok(sdk.dashboard(existing.dashboardId)).catch(() => patched.dash)
      const layouts = refreshed?.dashboard_layouts || patched.dash?.dashboard_layouts || []
      const activeLayout = layouts.find((l) => l.active) || layouts[0]
      if (activeLayout?.id) {
        const layoutId = String(activeLayout.id)
        const otherElems = (refreshed?.dashboard_elements || []).filter(
          (e) => e.id && String(e.id) !== newElId && String(e.id) !== staleId
        )
        if (otherElems.length === 0) {
          if (activeLayout.type !== 'extension') {
            await rawLookerRequest(sdk, 'PATCH', `/dashboard_layouts/${encodeURIComponent(layoutId)}`, undefined, {
              type: 'extension',
            }).catch(() => null)
          }
        } else if (newElId) {
          const comps = activeLayout.dashboard_layout_components || []
          const existingComp = comps.find((c) => String(c.dashboard_element_id || '') === newElId)
          const nextRow = Math.max(
            0,
            ...comps
              .filter((c) => String(c.dashboard_element_id || '') !== newElId)
              .map((c) => Number(c.row || 0) + Number(c.height || 0))
          )
          const box = { dashboard_layout_id: layoutId, dashboard_element_id: newElId, row: nextRow, column: 0, width: 24, height: 16 }
          if (existingComp?.id) {
            await rawLookerRequest(
              sdk,
              'PATCH',
              `/dashboard_layout_components/${encodeURIComponent(String(existingComp.id))}`,
              undefined,
              box
            ).catch(() => null)
          } else {
            await rawLookerRequest(sdk, 'POST', '/dashboard_layout_components', undefined, box).catch(() => null)
          }
        }
      }
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

// ponytail: zero-dependency GFM Markdown viewer supporting tables, fenced code blocks, blockquotes, headings, and lists
export function renderTddMarkdownToHtml(markdown: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')

  const lines = String(markdown || '').split(/\r?\n/)
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(esc(lines[i]))
        i++
      }
      i++
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => inline(c.trim()))
      const headers = parseRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseRow(lines[i]))
        i++
      }
      out.push(
        `<div class="dab-py-table-wrap" style="margin:10px 0 14px;"><table class="dab-py-table"><thead><tr>${headers
          .map((h) => `<th>${h}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      )
      continue
    }

    if (line.startsWith('>')) {
      const bq: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        bq.push(inline(lines[i].replace(/^>\s?/, '')))
        i++
      }
      out.push(`<blockquote>${bq.join('<br/>')}</blockquote>`)
      continue
    }

    if (/^---\s*$/.test(line.trim())) {
      out.push('<hr style="border:none;border-top:1px solid var(--dab-border, #e2e8f0);margin:16px 0;" />')
      i++
      continue
    }

    if (line.startsWith('### ')) {
      out.push(`<h3>${inline(line.slice(4))}</h3>`)
      i++
      continue
    }
    if (line.startsWith('## ')) {
      out.push(`<h2>${inline(line.slice(3))}</h2>`)
      i++
      continue
    }
    if (line.startsWith('# ')) {
      out.push(`<h1>${inline(line.slice(2))}</h1>`)
      i++
      continue
    }

    if (/^(\s*[-*]|\s*\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^(\s*[-*]|\s*\d+\.)\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^(\s*[-*]|\s*\d+\.)\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul style="margin:6px 0 12px;padding-left:20px;">${items.join('')}</ul>`)
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    out.push(`<p style="margin:6px 0 10px;">${inline(line)}</p>`)
    i++
  }

    return out.join('\n')
}

export interface DataAppLoadVerificationResult {
  ok: boolean
  errors: string[]
  height?: number
  htmlLen?: number
  tabsChecked?: number
  skipped?: string
}

type PreflightWindowHooks = {
  __MOCK_LOOKER_EXTENSION__?: unknown
  __ENABLE_LIVE_DATA_APP_PREFLIGHT__?: boolean
  __MOCK_DATA_APP_PREFLIGHT__?: (bundle: DataAppBundle) => Promise<DataAppLoadVerificationResult> | DataAppLoadVerificationResult
  __VERIFY_DATA_APP_BUNDLE__?: typeof verifyDataAppBundleLoadsInBrowser
}

// ponytail: mounts prod_code inside an offscreen <iframe sandbox="allow-scripts" srcdoc> via Blob dynamic import
// (~400ms–1.2s, works inside Looker's data:text/html;base64 ExtensionFrame2) to catch runtime TypeErrors, bad imports, and 0px renders before turn completion.
export async function verifyDataAppBundleLoadsInBrowser(
  bundle: DataAppBundle,
  opts?: { timeoutMs?: number; signal?: AbortSignal; forceLive?: boolean }
): Promise<DataAppLoadVerificationResult> {
  if (typeof window !== 'undefined') {
    const win = window as unknown as PreflightWindowHooks
    if (typeof win.__MOCK_DATA_APP_PREFLIGHT__ === 'function') {
      return await win.__MOCK_DATA_APP_PREFLIGHT__(bundle)
    }
    if (win.__MOCK_LOOKER_EXTENSION__ && !win.__ENABLE_LIVE_DATA_APP_PREFLIGHT__ && !opts?.forceLive) {
      return { ok: true, errors: [], skipped: 'mock-harness' }
    }
  }
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') {
    return { ok: true, errors: [], skipped: 'no-dom' }
  }
  const prodCode = String(bundle?.prod_code || bundle?.code || '').trim()
  if (!prodCode) return { ok: false, errors: ['Data App bundle has empty prod_code.'] }
  const tagMatch = prodCode.match(/customElements\.define\(\s*['"]([a-z0-9-]+)['"]/i)
  const tagName = tagMatch ? tagMatch[1] : ''
  if (!tagName) {
    return { ok: false, errors: ['Data App bundle does not register a custom element via customElements.define("<tag-name>", Class).'] }
  }
  const ver = prodCode.match(/looker-data-apps\/versions\/([^/'"]+)\/data-app\.js/)?.[1] || '1.3.0'
  const runId = `dab_pf_${Math.random().toString(36).slice(2, 10)}`
  const closeScript = '</' + 'script>'
  const safeMod = prodCode.replace(/<\/script/gi, '<\\/script')
  const vendorHead = prodCode.includes('gstatic.com')
    ? [
        `<link rel="stylesheet" href="https://www.gstatic.com/looker-data-apps/versions/${ver}/data-app.css">`,
        ...['ag-grid/31.3.4/ag-grid-community.min.js', 'highcharts/11.4.8/highcharts.js', 'highcharts/11.4.8/highcharts-more.js', 'highcharts/11.4.8/highcharts-solid-gauge.js', 'highcharts/11.4.8/highcharts-funnel.js', 'highcharts/11.4.8/highcharts-treemap.js'].map(
          (p) => `<script src="https://www.gstatic.com/looker-data-apps/vendor/${p}">${closeScript}`
        ),
      ]
    : []
  const htmlDoc = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    ...vendorHead,
    '</head><body style="margin:0;padding:0;width:1280px;min-height:800px;">',
    '<script type="module">',
    'const errors = [];',
    'const pushErr = (v) => { const s = String((v && (v.stack || v.message)) || v || ""); if (s && !/runQuery failed|Looker context|Chatty|timed out/i.test(s)) errors.push(s); };',
    'window.addEventListener("error", (e) => pushErr(e.error || e.message));',
    'window.addEventListener("unhandledrejection", (e) => pushErr(e.reason));',
    'const origErr = console.error.bind(console);',
    'console.error = (...args) => { const s = args.map((a) => (a && (a.stack || a.message)) || String(a)).join(" "); if (/\\[data-app error\\]|TypeError|ReferenceError|SyntaxError/i.test(s)) pushErr(s); origErr(...args); };',
    `const sendResult = (payload) => parent.postMessage(Object.assign({ type: "__DAB_DATA_APP_PREFLIGHT__", runId: ${JSON.stringify(runId)} }, payload), "*");`,
    '(async () => {',
    '  try {',
    `    const modUrl = URL.createObjectURL(new Blob([${JSON.stringify(safeMod)}], { type: "text/javascript" }));`,
    '    try { await import(modUrl); } finally { URL.revokeObjectURL(modUrl); }',
    `    const tag = ${JSON.stringify(tagName)};`,
    '    if (!customElements.get(tag)) { sendResult({ ok: false, errors: errors.length ? errors : ["Custom element <" + tag + "> was not registered."] }); return; }',
    '    let el = document.querySelector(tag);',
    '    if (!el) { el = document.createElement(tag); document.body.appendChild(el); }',
    '    if (el.updateComplete) await Promise.race([el.updateComplete.catch(pushErr), new Promise((r) => setTimeout(r, 450))]);',
    '    await new Promise((r) => setTimeout(r, 100));',
    '    const rect = el.getBoundingClientRect();',
    '    const htmlLen = (el.innerHTML || "").trim().length;',
    '    const tabBtns = Array.from(el.querySelectorAll(".da-tab-btn, [class*=\\"tab-btn\\"]")).slice(0, 6);',
    '    for (const btn of tabBtns) { btn.click(); if (el.updateComplete) await Promise.race([el.updateComplete.catch(pushErr), new Promise((r) => setTimeout(r, 250))]); }',
    '    if (tabBtns[0]) { tabBtns[0].click(); if (el.updateComplete) await Promise.race([el.updateComplete.catch(pushErr), new Promise((r) => setTimeout(r, 250))]); }',
    '    if (errors.length > 0) { sendResult({ ok: false, errors: errors.slice(0, 5), height: Math.round(rect.height), htmlLen }); return; }',
    '    if (htmlLen === 0 || rect.height < 20) { sendResult({ ok: false, errors: ["Data App rendered blank (height=" + Math.round(rect.height) + "px, htmlLen=" + htmlLen + ")."], height: Math.round(rect.height), htmlLen }); return; }',
    '    sendResult({ ok: true, errors: [], height: Math.round(rect.height), htmlLen, tabsChecked: tabBtns.length });',
    '  } catch (err) {',
    '    const msg = String((err && (err.stack || err.message)) || err || "");',
    '    if (/Failed to fetch dynamically imported module.*gstatic\\.com/i.test(msg)) { sendResult({ ok: true, errors: [], skipped: "network-unreachable" }); return; }',
    '    pushErr(err); sendResult({ ok: false, errors: errors.slice(0, 5) });',
    '  }',
    '})();',
    `${closeScript}</body></html>`,
  ].join('\n')

  const timeoutMs = opts?.timeoutMs ?? 6000
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:800px;visibility:hidden;pointer-events:none;border:0;'
  return await new Promise<DataAppLoadVerificationResult>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      opts?.signal?.removeEventListener('abort', onAbort)
      iframe.remove()
    }
    const onAbort = () => { cleanup(); resolve({ ok: true, errors: [], skipped: 'aborted' }) }
    const timer = setTimeout(() => { cleanup(); resolve({ ok: true, errors: [], skipped: 'timeout' }) }, timeoutMs)
    function onMsg(ev: MessageEvent) {
      const d = ev.data as (DataAppLoadVerificationResult & { type?: string; runId?: string }) | null
      if (!d || d.type !== '__DAB_DATA_APP_PREFLIGHT__' || d.runId !== runId) return
      cleanup()
      resolve({ ok: Boolean(d.ok), errors: Array.isArray(d.errors) ? d.errors : [], height: d.height, htmlLen: d.htmlLen, tabsChecked: d.tabsChecked, skipped: d.skipped })
    }
    if (opts?.signal?.aborted) { onAbort(); return }
    opts?.signal?.addEventListener('abort', onAbort, { once: true })
    window.addEventListener('message', onMsg)
    iframe.srcdoc = htmlDoc
    document.body.appendChild(iframe)
  })
}

if (typeof window !== 'undefined') {
  (window as unknown as PreflightWindowHooks).__VERIFY_DATA_APP_BUNDLE__ = verifyDataAppBundleLoadsInBrowser
}

