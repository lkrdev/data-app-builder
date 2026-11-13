import type { ExtensionSDK } from '@looker/extension-sdk'
import type {
  ILookmlModelNavExplore,
  IRole,
  Looker40SDK,
} from '@looker/sdk'
import useSWR from 'swr'

import { fetchLookerCaAgentsCatalog } from './conversationalAnalytics'
import { buildRootLookerFolders } from './lookerFolders'
import { resolveUserCapabilities } from './lookerPermissions'
import {
  coalesceLookerMetadataRequest,
  formatExploreId,
  LOOKER_METADATA_CACHE_TTL_MS,
  LOOKER_SWR_CONFIG,
  rawCoreSdkRequest,
} from './lookerTransport'

export * from './lookerPermissions'
export * from './lookerTransport'
export * from './lookerFolders'
export * from './dataAppPublisher'
export * from './lookerArtifactTypes'
export * from './lookerArtifactService'
export * from './lookerArtifacts'
export * from './conversationalAnalytics'
export { LOOKER_ALERTS_SKILL_MD, LOOKER_DASHBOARD_SKILL_MD, LOOKER_FIELD_PROFILER_SKILL_MD } from './antigravityStarters'
export { DEFAULT_MAX_TOOL_ROUNDS, normalizeMaxToolRounds, parseAttachmentDataUrl, STUDIO_MAX_TOOL_ROUNDS_OPTIONS } from './antigravityTypes'

export interface AccessibleLookerConnection {
  name: string
  dialect_name?: string
  database?: string
  schema?: string
  models?: string[]
  source: 'connections' | 'lookml_models'
}

let nextConnectionSdkCacheId = 1
const connectionSdkCacheIds = new WeakMap<object, number>()
const getConnectionSdkCacheId = (sdk: object): number => {
  const raw = ((sdk as { __rawSdk?: object }).__rawSdk || sdk) as object
  let id = connectionSdkCacheIds.get(raw)
  if (!id) connectionSdkCacheIds.set(raw, (id = nextConnectionSdkCacheId++))
  return id
}

// ponytail: pre-fetch accessible Looker DB connections client-side (<100ms, cached in memory/SWR)
// with non-admin fallback to /lookml_models so Turn-1 project intake needs 0 tool calls.
export async function discoverAccessibleConnections(
  sdk?: Partial<Looker40SDK> | null
): Promise<AccessibleLookerConnection[]> {
  if (!sdk || typeof sdk !== 'object') return []
  const sdkId = getConnectionSdkCacheId(sdk)
  return coalesceLookerMetadataRequest(
    `accessible_connections:${sdkId}`,
    async () => {
      const hasRaw = typeof (sdk as { authSession?: { transport?: { rawRequest?: unknown } } })?.authSession?.transport?.rawRequest === 'function'
      const sdkRec = sdk as unknown as {
        ok?: <T>(p: Promise<T> | T) => Promise<T>
        all_connections?: (params?: Record<string, unknown>) => Promise<unknown>
        all_lookml_models?: (params?: Record<string, unknown>) => Promise<unknown>
      }
      const fetchList = async (path: string, fn: ((p: Record<string, unknown>) => Promise<unknown>) | undefined, fields: string) => {
        const res = hasRaw
          ? await rawCoreSdkRequest<Array<Record<string, unknown>>>(sdk as Looker40SDK, 'GET', path, { fields })
          : typeof fn === 'function'
          ? await (typeof sdkRec.ok === 'function' ? sdkRec.ok(Promise.resolve(fn({ fields }))) : fn({ fields }))
          : []
        return Array.isArray(res) ? (res as Array<Record<string, unknown>>) : []
      }
      try {
        const items: AccessibleLookerConnection[] = (await fetchList('/connections', sdkRec.all_connections, 'name,dialect_name,database,schema'))
          .filter((c) => typeof c?.name === 'string' && c.name.trim())
          .map((c) => {
            const d = String(c.dialect_name || '').trim(), db = String(c.database || '').trim(), s = String(c.schema || '').trim()
            return Object.assign({ name: String(c.name).trim(), source: 'connections' as const }, d ? { dialect_name: d } : null, db ? { database: db } : null, s ? { schema: s } : null)
          })
        if (items.length > 0) return items
      } catch { /* non-admin 403/404 -> fallback to /lookml_models */ }
      try {
        const byConn = new Map<string, Set<string>>()
        for (const m of await fetchList('/lookml_models', sdkRec.all_lookml_models, 'name,project_name,allowed_db_connection_names')) {
          const label = String(m?.project_name || m?.name || '').trim()
          for (const c of Array.isArray(m?.allowed_db_connection_names) ? m.allowed_db_connection_names : []) {
            const cname = String(c || '').trim()
            if (cname) { if (!byConn.has(cname)) byConn.set(cname, new Set()); if (label) byConn.get(cname)!.add(label) }
          }
        }
        return Array.from(byConn.entries()).map(([name, p]) => Object.assign({ name, source: 'lookml_models' as const }, p.size ? { models: Array.from(p) } : null))
      } catch { return [] }
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:accessible_connections', sdkId]
  )
}

export function formatAccessibleConnectionsMarkdown(connections: ReadonlyArray<AccessibleLookerConnection>): string {
  if (!Array.isArray(connections) || connections.length === 0) {
    return '### Available Looker Connections\n- No database connections found for your Looker role.'
  }
  const lines = connections.map((c) => {
    const detail = c.source === 'lookml_models' ? (c.models?.length ? `models/projects: ${c.models.join(', ')}` : '') : [c.dialect_name, c.database, c.schema].filter(Boolean).join(' · ')
    return `- \`${c.name}\`${detail ? ` (${detail})` : ''}`
  })
  return `### Available Looker Connections\n${lines.join('\n')}`
}

// ponytail: seed Looker root folder nodes from me (personal_folder_id + home_folder_id + standard roots)
// instead of calling slow sdk.all_folders() upfront on startup; child folders and ancestors hydrate lazily.
export async function fetchInitialLookerMetadata(sdk: Looker40SDK) {
  let workspaceId: 'dev' | 'production' =
    typeof window !== 'undefined' &&
    window.__MOCK_LOOKER_EXTENSION__?.initialLookerWorkspaceId === 'dev'
      ? 'dev'
      : 'production'
  const sdkWithSession = sdk as unknown as {
    session?: () => Promise<{ workspace_id?: string | null }>
  }
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
    typeof sdkWithSession.session === 'function'
      ? coalesceLookerMetadataRequest(
          'meta:session',
          () => sdk.ok(sdkWithSession.session!() as never),
          LOOKER_METADATA_CACHE_TTL_MS,
          ['looker:session']
        )
          .then((sess: { workspace_id?: string | null } | undefined) => {
            if (sess?.workspace_id === 'dev') workspaceId = 'dev'
            else if (sess?.workspace_id === 'production') workspaceId = 'production'
          })
          .catch(() => {})
      : Promise.resolve(),
  ])
  let roles: IRole[] | null = null
  const sdkWithRoles = sdk as unknown as {
    user_roles?: (params: { user_id: string }) => Promise<IRole[]>
  }
  if (me?.id && typeof sdkWithRoles.user_roles === 'function') {
    try {
      const uid = String(me.id)
      const fetchedRoles = await coalesceLookerMetadataRequest(
        `meta:user_roles:${uid}`,
        () => sdk.ok(sdkWithRoles.user_roles!({ user_id: uid }) as never),
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
    workspaceId,
  }
}

export function buildAvailableExploresCatalog(
  models: Array<{
    name?: string | null
    label?: string | null
    explores?: Array<Partial<ILookmlModelNavExplore>> | null
  }>
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
    const modelName = String(m.name || '')
    if (!modelName) continue
    const visible = (m.explores || [])
      .filter((e) => !e.hidden && e.name)
      .sort((a, b) =>
        String(a.label || a.name).localeCompare(String(b.label || b.name))
      )
    if (visible.length === 0) continue
    lines.push(`## Model: ${m.label || modelName} (\`${modelName}\`)`)
    for (const e of visible) {
      const id = formatExploreId(modelName, String(e.name))
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

      const formatFieldLine = (f: {
        name?: string | null
        type?: string | null
        label?: string | null
        description?: string | null
        sql?: string | null
        drill_fields?: string[] | null
      }) => {
        const meta = [f.type, f.label ? `"${f.label}"` : ''].filter(Boolean).join(', ')
        const sql = cleanSql(f.sql)
        const drills = Array.isArray(f.drill_fields) && f.drill_fields.length > 0 ? f.drill_fields.join(', ') : ''
        return `- \`${f.name}\` (${meta})${f.description ? ` — ${f.description}` : ''}${sql ? ` [SQL: \`${sql}\`]` : ''}${drills ? ` [Drills: \`${drills}\`]` : ''}`
      }

      lines.push(`## Measures (${measures.length})`, ...measures.map(formatFieldLine), '')
      lines.push(`## Dimensions (${dimensions.length})`, ...dimensions.map(formatFieldLine), '')

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
          )) as unknown as Record<string, unknown>[]
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
  return useSWR(sdk && enabled ? ['looker:me'] : null, () => fetchInitialLookerMetadata(sdk!), LOOKER_SWR_CONFIG)
}

export function useExploreSchema(sdk: Looker40SDK | null | undefined, modelName?: string, exploreName?: string) {
  return useSWR<string>(
    sdk && modelName && exploreName ? ['looker:explore_schema', modelName, exploreName] : null,
    () => buildDenseExploreSchema(sdk!, modelName!, exploreName!),
    LOOKER_SWR_CONFIG
  )
}

export function useLookerDashboard(sdk: Looker40SDK | null | undefined, dashboardId?: string) {
  return useSWR(
    sdk && dashboardId ? ['looker:dashboard', dashboardId] : null,
    () => coalesceLookerMetadataRequest(`dashboard:${dashboardId}`, () => sdk!.ok(sdk!.dashboard(dashboardId!)), LOOKER_METADATA_CACHE_TTL_MS, ['looker:dashboard', dashboardId]),
    LOOKER_SWR_CONFIG
  )
}

export function useLookerCaAgents(sdk: Looker40SDK | null | undefined) {
  return useSWR(sdk ? ['looker:ca_agents'] : null, () => fetchLookerCaAgentsCatalog(sdk!), LOOKER_SWR_CONFIG)
}

export type StudioThemeMode = 'light' | 'dark' | 'system'
export type ResolvedStudioTheme = 'light' | 'dark'
export const STUDIO_THEME_STORAGE_KEY = 'dab_theme_mode'

export function normalizeStudioThemeMode(raw: unknown): StudioThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function resolveSystemTheme(mediaQueryList?: { matches?: boolean } | null): ResolvedStudioTheme {
  try {
    const mql = mediaQueryList !== undefined ? mediaQueryList : typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null
    return mql?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveStudioTheme(mode: StudioThemeMode, systemTheme: ResolvedStudioTheme = resolveSystemTheme()): ResolvedStudioTheme {
  return mode === 'system' ? systemTheme : mode
}

export function applyStudioDocumentTheme(resolved: ResolvedStudioTheme, mode?: StudioThemeMode): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.setAttribute('data-theme', resolved)
  if (mode) document.documentElement.setAttribute('data-theme-mode', mode)
  document.documentElement.style.colorScheme = resolved
}

export function readInitialStudioThemeMode(): StudioThemeMode {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    return normalizeStudioThemeMode(w?.__MOCK_LOOKER_EXTENSION__?.initialThemeMode ?? w?.localStorage?.getItem?.(STUDIO_THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export async function loadStoredStudioThemeMode(extensionSDK?: Partial<ExtensionSDK>): Promise<StudioThemeMode | null> {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    const raw = (await extensionSDK?.localStorageGetItem?.(STUDIO_THEME_STORAGE_KEY)) ?? w?.localStorage?.getItem?.(STUDIO_THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
  } catch {
    return null
  }
}

export function persistStudioThemeMode(extensionSDK: Partial<ExtensionSDK> | undefined, mode: StudioThemeMode): void {
  try { if (typeof window !== 'undefined') window.localStorage?.setItem?.(STUDIO_THEME_STORAGE_KEY, mode) } catch { /* ignore */ }
  try { void extensionSDK?.localStorageSetItem?.(STUDIO_THEME_STORAGE_KEY, mode) } catch { /* ignore */ }
}

export interface ContentInventoryItem {
  id: string
  title: string
  type: 'dashboard' | 'look'
  folderId?: string
  folderName?: string
}

export interface ContentInventoryFolder {
  id: string
  name: string
  dashboards?: Array<{ id?: string | number | null; title?: string | null; name?: string | null }>
  looks?: Array<{ id?: string | number | null; title?: string | null; name?: string | null }>
  items?: Array<{ id?: string | number | null; title?: string | null; name?: string | null; type?: string | null; content_type?: string | null }>
}

export interface FormattedContentInventory {
  summaryMarkdown: string
  fullMarkdown: string
  overflowFilePath?: string
  truncated: boolean
  totalItems: number
  folderCount: number
}

// ponytail: deterministic Markdown formatter for Looker folder & content inventory queries
// (<= 5 items in 1 folder -> full links; > 5 items or > 1 folder -> max 2 links per folder + /workspace/content_inventory.md).
export function formatContentInventoryMarkdown(
  foldersOrItems: ReadonlyArray<Record<string, unknown> | ContentInventoryFolder | ContentInventoryItem>,
  options: { maxShortItems?: number; maxPerFolder?: number; overflowFilePath?: string } = {}
): FormattedContentInventory {
  const maxShort = options.maxShortItems ?? 5
  const maxPerFolder = options.maxPerFolder ?? 2
  const overflowFilePath = options.overflowFilePath ?? '/workspace/content_inventory.md'
  const groups = new Map<string, { id: string; name: string; items: ContentInventoryItem[] }>()

  const addItem = (fId: string, fName: string, raw: Record<string, unknown>, defaultType: 'dashboard' | 'look') => {
    const id = String(raw.content_id ?? raw.content_slug ?? raw.id ?? '').trim()
    if (!id) return
    const rawType = String(raw.type ?? raw.content_type ?? defaultType).toLowerCase()
    const type: 'dashboard' | 'look' = rawType.includes('look') && !rawType.includes('lookml') ? 'look' : 'dashboard'
    const title = String(raw.title ?? raw.name ?? raw.label ?? `${type === 'look' ? 'Look' : 'Dashboard'} ${id}`).trim()
    const key = fId || fName || '1'
    const group = groups.get(key) || { id: fId || '1', name: fName || `Folder ${fId || '1'}`, items: [] }
    if (!group.items.some((x) => x.type === type && x.id === id)) {
      group.items.push({ id, title, type, folderId: group.id, folderName: group.name })
    }
    groups.set(key, group)
  }

  for (const rawEntry of foldersOrItems || []) {
    if (!rawEntry || typeof rawEntry !== 'object') continue
    const rec = rawEntry as Record<string, unknown>
    if (Array.isArray(rec.dashboards) || Array.isArray(rec.looks) || Array.isArray(rec.items)) {
      const fId = String(rec.id ?? rec.folder_id ?? rec.folderId ?? '1').trim()
      const fName = String(rec.name ?? rec.folder_name ?? rec.folderName ?? rec.title ?? `Folder ${fId}`).trim()
      if (!groups.has(fId)) groups.set(fId, { id: fId, name: fName, items: [] })
      for (const d of (rec.dashboards as Record<string, unknown>[]) || []) if (d && typeof d === 'object') addItem(fId, fName, d, 'dashboard')
      for (const l of (rec.looks as Record<string, unknown>[]) || []) if (l && typeof l === 'object') addItem(fId, fName, l, 'look')
      for (const it of (rec.items as Record<string, unknown>[]) || []) if (it && typeof it === 'object') addItem(fId, fName, it, 'dashboard')
    } else {
      const folderObj = (rec.folder && typeof rec.folder === 'object' ? rec.folder : undefined) as Record<string, unknown> | undefined
      const fId = String(rec.folder_id ?? rec.folderId ?? folderObj?.id ?? '1').trim()
      const fName = String(rec.folder_name ?? rec.folderName ?? folderObj?.name ?? `Folder ${fId}`).trim()
      addItem(fId, fName, rec, 'dashboard')
    }
  }

  const folderList = Array.from(groups.values()).filter((g) => g.items.length > 0)
  const totalItems = folderList.reduce((sum, g) => sum + g.items.length, 0)
  const formatLink = (it: ContentInventoryItem) => `- [${it.title}](/${it.type === 'look' ? 'looks' : 'dashboards'}/${it.id})`
  const formatCounts = (items: ContentInventoryItem[]) => {
    const dCount = items.filter((i) => i.type === 'dashboard').length, lCount = items.length - dCount
    return [dCount && `${dCount} dashboard${dCount === 1 ? '' : 's'}`, lCount && `${lCount} Look${lCount === 1 ? '' : 's'}`].filter(Boolean).join(', ') || '0 items'
  }

  if (totalItems === 0) {
    return { summaryMarkdown: 'No dashboards or Looks found.', fullMarkdown: 'No dashboards or Looks found.', truncated: false, totalItems: 0, folderCount: 0 }
  }

  const fullMarkdown = folderList.map((g) => [`**[${g.name}](/folders/${g.id})** (${formatCounts(g.items)})`, ...g.items.map(formatLink)].join('\n')).join('\n\n')
  if (totalItems <= maxShort && folderList.length <= 1) {
    return { summaryMarkdown: fullMarkdown, fullMarkdown, truncated: false, totalItems, folderCount: folderList.length }
  }

  const summaryBlocks = folderList.map((g) => {
    const shown = g.items.slice(0, maxPerFolder).map(formatLink)
    if (g.items.length > maxPerFolder) {
      shown.push(`- See all ${g.items.length} items in [${g.name}](/folders/${g.id})`)
    }
    return [`**[${g.name}](/folders/${g.id})** (${formatCounts(g.items)})`, ...shown].join('\n')
  })
  summaryBlocks.push(`\nFull unfiltered inventory (${totalItems} items across ${folderList.length} folder${folderList.length === 1 ? '' : 's'}) saved to \`${overflowFilePath}\`.`)

  return {
    summaryMarkdown: summaryBlocks.join('\n\n'),
    fullMarkdown,
    overflowFilePath,
    truncated: true,
    totalItems,
    folderCount: folderList.length,
  }
}
