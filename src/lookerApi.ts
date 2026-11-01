import useSWR, { mutate, SWRConfig, unstable_serialize } from 'swr'
import type { Looker40SDK } from '@looker/sdk'
import { classifyLooker404Error, resolveUserCapabilities } from './lookerPermissions'
import { fetchLookerCaAgentsCatalog } from './conversationalAnalytics'

export * from './lookerPermissions'
export * from './dataAppPublisher'
export * from './lookerArtifacts'
export * from './conversationalAnalytics'

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

const inFlightMetadataRequests = new Map<string, Promise<any>>()
const recentMetadataCache = new Map<string, { expiresAt: number; value: any }>()
export const LOOKER_METADATA_CACHE_TTL_MS = 15_000
export const LOOKER_SWR_CONFIG = {
  revalidateOnFocus: false,
  dedupingInterval: LOOKER_METADATA_CACHE_TTL_MS,
}

function syncSwrKey(swrKey: any, val: any): void {
  if (!swrKey) return
  try {
    ;(SWRConfig as any).default?.cache?.set(unstable_serialize(swrKey), val)
  } catch {}
  void mutate(swrKey, val, false).catch(() => {})
}

export function clearLookerMetadataCache(): void {
  inFlightMetadataRequests.clear()
  recentMetadataCache.clear()
  try {
    const cache = (SWRConfig as any).default?.cache
    if (cache && typeof cache.clear === 'function') cache.clear()
  } catch {}
}

export const clearLookerMetadataRequestCache = clearLookerMetadataCache

// ponytail: coalesce concurrent in-flight + short-TTL Looker metadata/explore GET requests across
// simultaneous conversations so concurrent turns never fire duplicate HTTP calls for the same schema.
export async function coalesceLookerMetadataRequest<T>(
  cacheKey: string,
  fn: () => Promise<T>,
  ttlMs = LOOKER_METADATA_CACHE_TTL_MS,
  swrKey?: any
): Promise<T> {
  const now = Date.now()
  const hit = recentMetadataCache.get(cacheKey)
  if (hit && now < hit.expiresAt) return hit.value as T
  const inFlight = inFlightMetadataRequests.get(cacheKey)
  if (inFlight) return inFlight as Promise<T>
  const p = (async () => {
    try {
      const val = await fn()
      if (ttlMs > 0) recentMetadataCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value: val })
      syncSwrKey(swrKey || cacheKey, val)
      return val
    } finally {
      inFlightMetadataRequests.delete(cacheKey)
    }
  })()
  inFlightMetadataRequests.set(cacheKey, p)
  return p
}

export function createDeduplicatedLookerSdkProxy(
  sdk: Looker40SDK,
  onRawRequest?: (res: any, elapsedMs: number, err?: unknown) => void
): Looker40SDK {
  if (!sdk || typeof sdk !== 'object') return sdk
  const rawTransport = (sdk as any)?.authSession?.transport
  const origRawReq = rawTransport?.rawRequest
  const wrappedsdk: any = Object.create(sdk)
  wrappedsdk.__rawSdk = (sdk as any).__rawSdk || sdk
  for (const method of [
    'lookml_model_explore',
    'all_lookml_models',
    'search_content',
    'me',
    'all_folders',
    'folder',
    'folder_children',
    'folder_ancestors',
    'search_folders',
  ]) {
    if (typeof (sdk as any)[method] === 'function') {
      const origFn = (sdk as any)[method].bind(sdk)
      wrappedSdkMethod(wrappedsdk, method, origFn)
    }
  }
  if (typeof origRawReq === 'function') {
    wrappedsdk.authSession = {
      ...(sdk as any).authSession,
      transport: {
        ...rawTransport,
        rawRequest: async (method: string, path: string, queryParams?: any, body?: any, ...rest: any[]) => {
          const reqStart = Date.now()
          const upper = String(method || 'GET').toUpperCase()
          const isMetaGet =
            upper === 'GET' && /\/(?:lookml_models|content_search|user|folders)(?:\/|$|\?)/i.test(String(path || ''))
          const execRaw = () => origRawReq.call(rawTransport, method, path, queryParams, body, ...rest)
          try {
            const res = isMetaGet
              ? await coalesceLookerMetadataRequest(`raw:GET:${path}:${JSON.stringify(queryParams || {})}`, execRaw)
              : await execRaw()
            onRawRequest?.(res, Date.now() - reqStart)
            return res
          } catch (err) {
            onRawRequest?.(undefined, Date.now() - reqStart, err)
            throw err
          }
        },
      },
    }
  }
  return wrappedsdk as Looker40SDK
}

function wrappedSdkMethod(target: any, method: string, origFn: (...args: any[]) => any): void {
  target[method] = (...args: any[]) =>
    coalesceLookerMetadataRequest(`sdk:${method}:${JSON.stringify(args)}`, () => Promise.resolve(origFn(...args)))
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
    if (Number(rawResp.statusCode) === 404) {
      const diag = classifyLooker404Error(404, path, errBody)
      throw new Error(
        `Looker ${method} ${path} failed (404 ${diag.kind}): ${diag.remediation} — ${errBody}`
      )
    }
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

export interface LookerFolderNode {
  id: string
  name: string
  parent_id?: string | null
  child_count?: number
  is_personal?: boolean
  is_personal_descendant?: boolean
  creator_id?: string | null
  has_children?: boolean
  can?: Record<string, boolean>
}

export interface SearchLookerFoldersParams {
  name?: string
  parent_id?: string
  is_personal?: boolean | string
  is_personal_descendant?: boolean | string
  creator_id?: string
  id?: string
  fields?: string
}

export const LOOKER_FOLDER_FIELDS =
  'id,name,parent_id,child_count,is_personal,is_personal_descendant,creator_id,can'

export function normalizeLookerFolderNode(
  raw: any,
  fallbackParentId?: string | null
): LookerFolderNode {
  const childCount = typeof raw?.child_count === 'number' ? raw.child_count : undefined
  const parentId =
    raw?.parent_id !== undefined && raw?.parent_id !== null && raw?.parent_id !== ''
      ? String(raw.parent_id)
      : fallbackParentId ?? null
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name || `Folder #${raw?.id ?? ''}`),
    parent_id: parentId,
    ...(childCount !== undefined ? { child_count: childCount } : {}),
    is_personal: Boolean(raw?.is_personal),
    is_personal_descendant: Boolean(raw?.is_personal_descendant),
    ...(raw?.creator_id != null ? { creator_id: String(raw.creator_id) } : {}),
    has_children:
      typeof raw?.has_children === 'boolean'
        ? raw.has_children
        : childCount === undefined
        ? true
        : childCount > 0,
    ...(raw?.can ? { can: raw.can } : {}),
  }
}

export function buildRootLookerFolders(user?: any): LookerFolderNode[] {
  const canEdit = { show: true, edit_content: true, save_content: true }
  const candidates: LookerFolderNode[] = [
    { id: String(user?.personal_folder_id || '5'), name: 'My folder', parent_id: null, is_personal: true, has_children: true, can: canEdit },
    { id: String(user?.home_folder_id || '1'), name: 'Shared folders', parent_id: null, is_personal: false, has_children: true, can: canEdit },
    { id: '2', name: 'People', parent_id: null, is_personal: false, has_children: true },
    { id: '3', name: 'Embed Users', parent_id: null, is_personal: false, has_children: true },
    { id: '4', name: 'Embed Groups', parent_id: null, is_personal: false, has_children: true },
  ]
  return Array.from(new Map(candidates.filter((n) => n.id).map((n) => [n.id, n])).values())
}

async function unwrapSdkCall(sdk: any, p: any): Promise<any> {
  const resolved = await p
  if (typeof sdk?.ok === 'function') return sdk.ok(Promise.resolve(resolved))
  return resolved
}

export async function fetchFolderChildren(
  sdk: Looker40SDK,
  folderId: string
): Promise<LookerFolderNode[]> {
  const fid = String(folderId || '').trim()
  if (!fid) return []
  return coalesceLookerMetadataRequest(
    `folder_children:${fid}`,
    async () => {
      const s = sdk as any
      if (typeof s?.folder_children === 'function') {
        const rows = await unwrapSdkCall(
          s,
          s.folder_children({
            folder_id: fid,
            fields: 'id,name,parent_id,child_count,is_personal,can',
          })
        )
        return (Array.isArray(rows) ? rows : []).map((r) => normalizeLookerFolderNode(r, fid))
      }
      if (typeof s?.all_folders === 'function') {
        const all = await unwrapSdkCall(
          s,
          s.all_folders('id,name,parent_id,child_count,is_personal,can')
        )
        return (Array.isArray(all) ? all : [])
          .filter((r: any) => String(r?.parent_id ?? '') === fid)
          .map((r: any) => normalizeLookerFolderNode(r, fid))
      }
      return []
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:folder_children', fid]
  )
}

async function callFolderIdEndpoint(
  sdk: any,
  method: 'folder' | 'folder_ancestors',
  folderId: string,
  fields: string
): Promise<any> {
  const fn = sdk?.[method]
  if (typeof fn !== 'function') return null
  if (typeof sdk?.get === 'function') {
    return unwrapSdkCall(sdk, fn.call(sdk, folderId, fields))
  }
  try {
    const res = await unwrapSdkCall(sdk, fn.call(sdk, { folder_id: folderId, fields }))
    if (res !== undefined) return res
  } catch {}
  return unwrapSdkCall(sdk, fn.call(sdk, folderId, fields))
}

export async function fetchFolderWithAncestors(
  sdk: Looker40SDK,
  folderId: string
): Promise<{
  folder: LookerFolderNode | null
  ancestors: LookerFolderNode[]
  chain: LookerFolderNode[]
  expandedIds: string[]
}> {
  const fid = String(folderId || '').trim()
  if (!fid) return { folder: null, ancestors: [], chain: [], expandedIds: [] }
  return coalesceLookerMetadataRequest(
    `folder_ancestors:${fid}`,
    async () => {
      const s = sdk as any
      let rawFolder: any = null
      let rawAncestors: any[] | null = null
      try {
        if (typeof s?.folder === 'function') {
          rawFolder = await callFolderIdEndpoint(s, 'folder', fid, LOOKER_FOLDER_FIELDS)
        }
      } catch {}
      try {
        if (typeof s?.folder_ancestors === 'function') {
          const anc = await callFolderIdEndpoint(s, 'folder_ancestors', fid, LOOKER_FOLDER_FIELDS)
          if (Array.isArray(anc)) rawAncestors = anc
        }
      } catch {}

      if ((!rawFolder || !rawAncestors) && typeof s?.all_folders === 'function') {
        try {
          const all = await unwrapSdkCall(s, s.all_folders(LOOKER_FOLDER_FIELDS))
          const list = Array.isArray(all) ? all : []
          const byId = new Map<string, any>(list.map((f: any) => [String(f.id), f]))
          if (!rawFolder) rawFolder = byId.get(fid) || null
          if (!rawAncestors && rawFolder) {
            const chainUp: any[] = []
            let cur = rawFolder.parent_id ? byId.get(String(rawFolder.parent_id)) : null
            const visited = new Set<string>([fid])
            while (cur && !visited.has(String(cur.id))) {
              visited.add(String(cur.id))
              chainUp.unshift(cur)
              cur = cur.parent_id ? byId.get(String(cur.parent_id)) : null
            }
            rawAncestors = chainUp
          }
        } catch {}
      }

      const folder = rawFolder ? normalizeLookerFolderNode(rawFolder) : null
      const normAnc = (rawAncestors || []).map((a) => normalizeLookerFolderNode(a))
      const orderedAncestors =
        normAnc.length > 1 && normAnc[0].parent_id ? [...normAnc].reverse() : normAnc
      const chain = [...orderedAncestors, ...(folder ? [folder] : [])]
      return {
        folder,
        ancestors: orderedAncestors,
        chain,
        expandedIds: orderedAncestors.map((a) => a.id),
      }
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:folder_ancestors', fid]
  )
}

export async function searchLookerFolders(
  sdk: Looker40SDK,
  params: SearchLookerFoldersParams = {}
): Promise<LookerFolderNode[]> {
  const req: Record<string, any> = {
    fields: params.fields || LOOKER_FOLDER_FIELDS,
  }
  if (params.name?.trim()) req.name = params.name.trim()
  if (params.parent_id?.trim()) req.parent_id = params.parent_id.trim()
  if (params.id?.trim()) req.id = params.id.trim()
  if (params.creator_id?.trim()) req.creator_id = params.creator_id.trim()
  if (params.is_personal !== undefined && params.is_personal !== '' && params.is_personal !== 'any') {
    req.is_personal = params.is_personal === true || params.is_personal === 'true'
  }
  if (
    params.is_personal_descendant !== undefined &&
    params.is_personal_descendant !== '' &&
    params.is_personal_descendant !== 'any'
  ) {
    req.is_personal_descendant =
      params.is_personal_descendant === true || params.is_personal_descendant === 'true'
  }

  return coalesceLookerMetadataRequest(
    `search_folders:${JSON.stringify(req)}`,
    async () => {
      const s = sdk as any
      if (typeof s?.search_folders === 'function') {
        const rows = await unwrapSdkCall(s, s.search_folders(req))
        return (Array.isArray(rows) ? rows : []).map((r) => normalizeLookerFolderNode(r))
      }
      if (typeof s?.all_folders === 'function') {
        const rows = await unwrapSdkCall(s, s.all_folders(LOOKER_FOLDER_FIELDS))
        const all = (Array.isArray(rows) ? rows : []).map((r) => normalizeLookerFolderNode(r))
        const nameQ = String(req.name || '')
          .replace(/%/g, '')
          .trim()
          .toLowerCase()
        return all.filter((f) => {
          if (nameQ && !f.name.toLowerCase().includes(nameQ)) return false
          if (req.parent_id && String(f.parent_id || '') !== String(req.parent_id)) return false
          if (req.id && String(f.id) !== String(req.id)) return false
          if (req.creator_id && String(f.creator_id || '') !== String(req.creator_id)) return false
          if (typeof req.is_personal === 'boolean' && Boolean(f.is_personal) !== req.is_personal)
            return false
          if (
            typeof req.is_personal_descendant === 'boolean' &&
            Boolean(f.is_personal_descendant) !== req.is_personal_descendant
          )
            return false
          return true
        })
      }
      return []
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:search_folders', req]
  )
}

// ponytail: seed Looker root folder nodes from me (personal_folder_id + home_folder_id + standard roots)
// instead of calling slow sdk.all_folders() upfront on startup; child folders and ancestors hydrate lazily.
export async function fetchInitialLookerMetadata(sdk: Looker40SDK) {
  const [me, models] = await Promise.all([
    coalesceLookerMetadataRequest(
      'meta:me',
      () =>
        sdk.ok(sdk.me('id,display_name,email,personal_folder_id,home_folder_id,is_iam_admin,can')),
      LOOKER_METADATA_CACHE_TTL_MS,
      ['looker:me']
    ),
    coalesceLookerMetadataRequest(
      'meta:all_lookml_models',
      () =>
        sdk.ok(
          sdk.all_lookml_models({
            fields:
              'name,label,project_name,allowed_db_connection_names,can,explores(name,label,description,group_label,hidden)',
          })
        ),
      LOOKER_METADATA_CACHE_TTL_MS,
      ['looker:models']
    ),
  ])
  let roles: any[] | null = null
  if (me?.id && typeof (sdk as any).user_roles === 'function') {
    try {
      const uid = String(me.id)
      const fetchedRoles = await coalesceLookerMetadataRequest(
        `meta:user_roles:${uid}`,
        () => sdk.ok((sdk as any).user_roles({ user_id: uid })),
        LOOKER_METADATA_CACHE_TTL_MS,
        ['looker:user_roles', uid]
      )
      if (Array.isArray(fetchedRoles)) roles = fetchedRoles
    } catch {
      roles = null
    }
  }
  const allModels = models || []
  const validModels = allModels.filter((m) => m.name && m.explores && m.explores.length > 0)
  const rootFolders = buildRootLookerFolders(me)
  const capFolders = me?.personal_folder_id
    ? [
        {
          id: String(me.personal_folder_id),
          name: 'My folder',
          is_personal: true,
          can: { show: true, edit_content: true },
        },
      ]
    : []
  const capabilities = resolveUserCapabilities({
    user: me,
    roles,
    models: allModels,
    folders: capFolders,
  })
  const defaultFolderId = String(me.personal_folder_id || me.home_folder_id || '1')
  return {
    user: me,
    roles,
    models: validModels,
    allModels,
    folders: rootFolders,
    defaultFolderId,
    capabilities,
  }
}

export function buildAvailableExploresCatalog(
  models: Array<{ name: string; label: string; explores: any[] }>
): string {
  const lines: string[] = [
    '# Available Looker Explores Catalog (Let the Agent Decide)',
    'No specific explore was pre-selected. Pick the best `model_id::explore_id` explore below and run ONE `run_looker_codemode` call (`lookml_model_explore(m, e, fields="name,label,description,fields(dimensions(name,label,description,type),measures(name,label,description,type))")` + 5-row `run_inline_query("json", {"model": m, "view": e, "fields": [...], "limit": "5"})`) to inspect fields and sample rows.',
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
  return coalesceLookerMetadataRequest(
    `dense_explore_schema:${formatExploreId(modelName, exploreName)}`,
    async () => {
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
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:explore_schema', modelName, exploreName]
  )
}

export const fetchExploreSchemaAndSample = buildDenseExploreSchema

export function useLookerMetadata(sdk?: Looker40SDK | null, enabled = true) {
  return useSWR(
    sdk && enabled ? ['looker:me'] : null,
    () => fetchInitialLookerMetadata(sdk!),
    LOOKER_SWR_CONFIG
  )
}

export function useExploreSchema(
  sdk: Looker40SDK | null | undefined,
  modelName?: string,
  exploreName?: string
) {
  return useSWR<string>(
    sdk && modelName && exploreName ? ['looker:explore_schema', modelName, exploreName] : null,
    () => buildDenseExploreSchema(sdk!, modelName!, exploreName!),
    LOOKER_SWR_CONFIG
  )
}

export function useLookerDashboard(sdk: Looker40SDK | null | undefined, dashboardId?: string) {
  return useSWR(
    sdk && dashboardId ? ['looker:dashboard', dashboardId] : null,
    () =>
      coalesceLookerMetadataRequest(
        `dashboard:${dashboardId}`,
        () => sdk!.ok(sdk!.dashboard(dashboardId!)),
        LOOKER_METADATA_CACHE_TTL_MS,
        ['looker:dashboard', dashboardId]
      ),
    LOOKER_SWR_CONFIG
  )
}

export function useLookerCaAgents(sdk: Looker40SDK | null | undefined) {
  return useSWR(
    sdk ? ['looker:ca_agents'] : null,
    () => fetchLookerCaAgentsCatalog(sdk!),
    LOOKER_SWR_CONFIG
  )
}

export type StudioThemeMode = 'light' | 'dark' | 'system'
export type ResolvedStudioTheme = 'light' | 'dark'

export const STUDIO_THEME_STORAGE_KEY = 'dab_theme_mode'

export function normalizeStudioThemeMode(raw: unknown): StudioThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function resolveSystemTheme(
  mediaQueryList?: { matches?: boolean } | null
): ResolvedStudioTheme {
  try {
    const mql =
      mediaQueryList !== undefined
        ? mediaQueryList
        : typeof window !== 'undefined'
        ? window.matchMedia?.('(prefers-color-scheme: dark)')
        : null
    return mql?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveStudioTheme(
  mode: StudioThemeMode,
  systemTheme: ResolvedStudioTheme = resolveSystemTheme()
): ResolvedStudioTheme {
  return mode === 'system' ? systemTheme : mode
}

export function applyStudioDocumentTheme(
  resolved: ResolvedStudioTheme,
  mode?: StudioThemeMode
): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.setAttribute('data-theme', resolved)
  if (mode) document.documentElement.setAttribute('data-theme-mode', mode)
  document.documentElement.style.colorScheme = resolved
}

export function readInitialStudioThemeMode(): StudioThemeMode {
  try {
    const w = typeof window !== 'undefined' ? (window as any) : undefined
    return normalizeStudioThemeMode(
      w?.__MOCK_LOOKER_EXTENSION__?.initialThemeMode ??
        w?.localStorage?.getItem?.(STUDIO_THEME_STORAGE_KEY)
    )
  } catch {
    return 'system'
  }
}

export async function loadStoredStudioThemeMode(
  extensionSDK?: any
): Promise<StudioThemeMode | null> {
  try {
    const w = typeof window !== 'undefined' ? (window as any) : undefined
    const raw =
      (await extensionSDK?.localStorageGetItem?.(STUDIO_THEME_STORAGE_KEY)) ??
      w?.localStorage?.getItem?.(STUDIO_THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
  } catch {
    return null
  }
}

export function persistStudioThemeMode(extensionSDK: any, mode: StudioThemeMode): void {
  try {
    ;(window as any)?.localStorage?.setItem?.(STUDIO_THEME_STORAGE_KEY, mode)
  } catch {}
  try {
    void extensionSDK?.localStorageSetItem?.(STUDIO_THEME_STORAGE_KEY, mode)
  } catch {}
}
