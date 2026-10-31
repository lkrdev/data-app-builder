import type { Looker40SDK } from '@looker/sdk'
import { classifyLooker404Error, resolveUserCapabilities } from './lookerPermissions'

export * from './lookerPermissions'
export * from './dataAppPublisher'
export * from './lookerArtifacts'

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

export async function fetchInitialLookerMetadata(sdk: Looker40SDK) {
  const [me, models, folders] = await Promise.all([
    sdk.ok(
      sdk.me(
        'id,display_name,email,personal_folder_id,home_folder_id,is_iam_admin,can'
      )
    ),
    sdk.ok(
      sdk.all_lookml_models({
        fields:
          'name,label,project_name,allowed_db_connection_names,can,explores(name,label,description,group_label,hidden)',
      })
    ),
    sdk.ok(sdk.all_folders('id,name,parent_id,is_personal,can')),
  ])
  let roles: any[] | null = null
  if (me?.id && typeof (sdk as any).user_roles === 'function') {
    try {
      const fetchedRoles = await sdk.ok(
        (sdk as any).user_roles({ user_id: String(me.id) })
      )
      if (Array.isArray(fetchedRoles)) roles = fetchedRoles
    } catch {
      roles = null
    }
  }
  const allModels = models || []
  const validModels = allModels.filter((m) => m.name && m.explores && m.explores.length > 0)
  const allFolders = folders || []
  const capabilities = resolveUserCapabilities({
    user: me,
    roles,
    models: allModels,
    folders: allFolders,
  })
  const defaultFolderId = String(me.personal_folder_id || me.home_folder_id || '1')
  return {
    user: me,
    roles,
    models: validModels,
    allModels,
    folders: allFolders,
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
}
