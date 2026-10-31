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

export interface Looker404Diagnostic {
  kind: 'role_denied' | 'feature_disabled' | 'not_found'
  status: number
  path: string
  message: string
  remediation: string
}

export function classifyLooker404Error(
  status: number,
  path: string,
  rawText: string
): Looker404Diagnostic {
  const text = String(rawText || '').trim()
  let parsed: any = null
  try {
    if (text.startsWith('{')) parsed = JSON.parse(text)
  } catch {}
  const message = String(parsed?.message || text || 'Not found')
  const docUrl = String(parsed?.documentation_url || '')
  const isInlineExt = path.includes('/data_app_extension') || path.includes('/inline_extension')
  const hasErrDoc = docUrl.includes('/r/err/')

  if (status === 404 && (/Sinatra::NotFound/i.test(text) || (isInlineExt && !hasErrDoc))) {
    return {
      kind: 'feature_disabled',
      status,
      path,
      message,
      remediation: isInlineExt
        ? 'The "inline_extensions" feature flag is disabled on this Looker instance. Enable "inline_extensions" in Looker Admin settings.'
        : `Endpoint "${path}" is unmounted or its feature flag is disabled on this Looker instance.`,
    }
  }
  if (status === 404 && (hasErrDoc || /^not found$/i.test(message.trim()))) {
    return {
      kind: 'role_denied',
      status,
      path,
      message,
      remediation: `Looker returned a Role-Denied 404 on "${path}". Verify the user's Looker Role permissions (e.g. access_data, explore, save_content, save_dashboards, develop) and Model Set in Admin > Roles, or folder edit access.`,
    }
  }
  return {
    kind: 'not_found',
    status,
    path,
    message,
    remediation: `Resource at "${path}" was not found or the user lacks permission to access it.`,
  }
}

export type StudioCapabilityMode = 'app' | 'dashboard' | 'lookml' | 'health' | 'tile'

export interface ToolAvailability {
  enabled: boolean
  readOnly?: boolean
  missingPermissions: string[]
  reason?: string
}

export interface UserCapabilities {
  isAdmin: boolean
  rolesLoaded: boolean
  globalPermissions: Set<string>
  modelsByPermission: Record<string, Set<string>>
  explorableModels: Set<string>
  developableProjects: Set<string>
  readableProjects: Set<string>
  sqlRunnerConnections: Set<string>
  editableFolderIds: Set<string>
  canConfigureExtension: boolean
  canManageUserAttributes: boolean
  tools: Record<StudioCapabilityMode, ToolAvailability>
}

const MODEL_SCOPED_PERMISSIONS = new Set([
  'access_data', 'see_looks', 'see_user_dashboards', 'see_lookml_dashboards', 'explore',
  'see_sql', 'clear_cache_refresh', 'see_lookml', 'develop', 'use_sql_runner',
  'manage_project_models', 'use_global_connections', 'schedule_look_emails',
  'schedule_external_look_emails', 'send_to_s3', 'send_to_sftp', 'send_outgoing_webhook', 'send_to_integration',
])

const ALL_CORE_PERMISSIONS = [
  'admin', 'access_data', 'see_looks', 'see_user_dashboards', 'see_lookml_dashboards',
  'explore', 'save_content', 'save_dashboards', 'save_looks', 'see_lookml', 'develop',
  'deploy', 'manage_models', 'use_sql_runner', 'see_sql', 'see_system_activity',
  'manage_user_attributes', 'schedule_look_emails',
]

// ponytail: evaluate Role = PermissionSet × ModelSet per role first so model sets never bleed across roles,
// then apply Looker's Model -> Project and Model -> Connection expansion rules.
export function resolveUserCapabilities(
  params: { user?: any; roles?: any[] | null; models?: any[]; folders?: any[] } = {}
): UserCapabilities {
  const user = params.user || {}
  const models = Array.isArray(params.models) ? params.models : []
  const folders = Array.isArray(params.folders) ? params.folders : []
  const roles = params.roles
  const rolesLoaded = Array.isArray(roles)

  const isAdmin = Boolean(
    user?.is_iam_admin ||
      user?.can?.use_admin_agent ||
      (user?.can?.create && user?.can?.destroy) ||
      (rolesLoaded &&
        roles.some(
          (r: any) =>
            r?.permission_set?.all_access ||
            (r?.permission_set?.permissions || []).includes('admin') ||
            String(r?.name || '').toLowerCase() === 'admin' ||
            (r?.can?.create && r?.can?.delete)
        ))
  )

  const globalPermissions = new Set<string>()
  const modelsByPermission: Record<string, Set<string>> = {}
  const addModelPerm = (perm: string, modelName: string) => {
    ;(modelsByPermission[perm] ||= new Set<string>()).add(modelName)
  }

  if (rolesLoaded) {
    for (const role of roles) {
      const rawPerms: string[] = Array.isArray(role?.permission_set?.permissions)
        ? role.permission_set.permissions
        : []
      const roleAllPerms = Boolean(role?.permission_set?.all_access) || rawPerms.includes('admin')
      const roleModels: string[] = Array.isArray(role?.model_set?.models)
        ? role.model_set.models.filter(Boolean).map(String)
        : []
      const roleAllModels = Boolean(role?.model_set?.all_access) || roleAllPerms
      const basePerms = roleAllPerms ? ALL_CORE_PERMISSIONS : rawPerms
      const impliesAccess = basePerms.some((p) =>
        ['explore', 'develop', 'see_lookml', 'use_sql_runner', 'see_user_dashboards', 'see_looks'].includes(p)
      )
      const effectivePerms =
        impliesAccess && !basePerms.includes('access_data') ? [...basePerms, 'access_data'] : basePerms

      for (const perm of effectivePerms) {
        globalPermissions.add(perm)
        if (MODEL_SCOPED_PERMISSIONS.has(perm)) {
          for (const mName of roleAllModels ? ['*'] : roleModels) addModelPerm(perm, mName)
        }
      }
    }
  }

  if (isAdmin) {
    for (const perm of ALL_CORE_PERMISSIONS) {
      globalPermissions.add(perm)
      if (MODEL_SCOPED_PERMISSIONS.has(perm)) addModelPerm(perm, '*')
    }
  }
  if (globalPermissions.has('manage_models')) {
    for (const p of ['develop', 'see_lookml', 'manage_project_models']) addModelPerm(p, '*')
  }

  const hasModelPerm = (perm: string, modelName: string): boolean =>
    isAdmin || Boolean(modelsByPermission[perm]?.has('*') || modelsByPermission[perm]?.has(modelName))

  const explorableModels = new Set<string>()
  const developableProjects = new Set<string>()
  const readableProjects = new Set<string>()
  const sqlRunnerConnections = new Set<string>()
  const editableFolderIds = new Set<string>()

  if (rolesLoaded) {
    const exploreSet = modelsByPermission['explore']
    if (exploreSet?.has('*')) {
      explorableModels.add('*')
      for (const m of models) if (m?.name) explorableModels.add(String(m.name))
    } else if (exploreSet) {
      for (const mName of exploreSet) {
        if (
          hasModelPerm('access_data', mName) &&
          (models.length === 0 || models.some((m) => String(m?.name) === mName))
        ) {
          explorableModels.add(mName)
        }
      }
    }

    if (isAdmin || globalPermissions.has('manage_models') || modelsByPermission['develop']?.has('*')) {
      developableProjects.add('*')
      readableProjects.add('*')
    } else if (modelsByPermission['see_lookml']?.has('*')) {
      readableProjects.add('*')
    }

    for (const m of models) {
      const mName = String(m?.name || '').trim()
      const proj = String(m?.project_name || '').trim()
      if (!mName) continue
      if (proj) {
        if (hasModelPerm('develop', mName)) {
          developableProjects.add(proj)
          readableProjects.add(proj)
        } else if (hasModelPerm('see_lookml', mName)) {
          readableProjects.add(proj)
        }
      }
      if (hasModelPerm('use_sql_runner', mName)) {
        for (const conn of m?.allowed_db_connection_names || []) {
          if (conn) sqlRunnerConnections.add(String(conn))
        }
      }
    }

    if (
      isAdmin ||
      globalPermissions.has('use_global_connections') ||
      modelsByPermission['use_sql_runner']?.has('*')
    ) {
      sqlRunnerConnections.add('*')
    }

    const canSaveAny =
      isAdmin ||
      globalPermissions.has('save_content') ||
      globalPermissions.has('save_dashboards') ||
      globalPermissions.has('save_looks')

    for (const f of folders) {
      const fid = String(f?.id || '').trim()
      if (!fid) continue
      if (
        isAdmin ||
        (f?.can ? (f.can.edit_content === true || f.can.save_content === true) && canSaveAny : canSaveAny)
      ) {
        editableFolderIds.add(fid)
      }
    }
    if (user?.personal_folder_id && canSaveAny) editableFolderIds.add(String(user.personal_folder_id))
  } else {
    for (const m of models) {
      const mName = String(m?.name || '').trim()
      const proj = String(m?.project_name || '').trim()
      const canDev = m?.can?.develop === true || m?.can?.update === true || m?.can === undefined
      if (mName && m?.can?.show !== false) explorableModels.add(mName)
      if (proj) {
        if (canDev) {
          developableProjects.add(proj)
          readableProjects.add(proj)
        } else if (m?.can?.show !== false) {
          readableProjects.add(proj)
        }
      }
      if (canDev) {
        for (const conn of m?.allowed_db_connection_names || []) {
          if (conn) sqlRunnerConnections.add(String(conn))
        }
      }
    }
    for (const f of folders) {
      const fid = String(f?.id || '').trim()
      if (fid && f?.can?.edit_content !== false && f?.can?.save_content !== false) {
        editableFolderIds.add(fid)
      }
    }
    if (user?.personal_folder_id) editableFolderIds.add(String(user.personal_folder_id))
  }

  const canConfigureExtension = Boolean(
    !rolesLoaded || isAdmin || globalPermissions.has('admin') || globalPermissions.has('develop') || developableProjects.size > 0
  )
  const canManageUserAttributes = Boolean(
    !rolesLoaded || isAdmin || globalPermissions.has('admin') || globalPermissions.has('manage_user_attributes')
  )

  const hasExplore = isAdmin || explorableModels.size > 0
  const hasSaveDash = isAdmin || (globalPermissions.has('save_content') && globalPermissions.has('save_dashboards'))
  const hasSaveContent =
    isAdmin ||
    (globalPermissions.has('save_content') &&
      (globalPermissions.has('save_dashboards') || globalPermissions.has('save_looks')))
  const hasDevelop = isAdmin || developableProjects.size > 0 || globalPermissions.has('develop')
  const hasSeeLookml = hasDevelop || readableProjects.size > 0 || globalPermissions.has('see_lookml')
  const hasPillar1 =
    isAdmin || globalPermissions.has('see_system_activity') || hasModelPerm('explore', 'system__activity')
  const hasPillar3 = isAdmin || sqlRunnerConnections.size > 0 || globalPermissions.has('use_sql_runner')

  const appMissing = [
    ...(!hasExplore ? ['explore'] : []),
    ...(!isAdmin && !globalPermissions.has('save_content') ? ['save_content'] : []),
    ...(!isAdmin && !globalPermissions.has('save_dashboards') ? ['save_dashboards'] : []),
  ]
  const dashMissing = [
    ...(!hasExplore ? ['explore'] : []),
    ...(!isAdmin && !globalPermissions.has('save_content') ? ['save_content'] : []),
    ...(!isAdmin && !globalPermissions.has('save_dashboards') && !globalPermissions.has('save_looks')
      ? ['save_dashboards']
      : []),
  ]
  const healthMissing = [
    ...(!hasPillar1 ? ['see_system_activity'] : []),
    ...(!hasDevelop ? ['develop'] : []),
    ...(!hasPillar3 ? ['use_sql_runner'] : []),
  ]

  const mkTool = (
    enabled: boolean,
    readOnly: boolean,
    missingPermissions: string[],
    reason?: string
  ): ToolAvailability =>
    !rolesLoaded
      ? { enabled: true, readOnly: false, missingPermissions: [] }
      : {
          enabled,
          readOnly,
          missingPermissions,
          reason:
            reason ??
            (missingPermissions.length > 0
              ? `Missing Looker permissions: ${missingPermissions.join(', ')}`
              : undefined),
        }

  return {
    isAdmin,
    rolesLoaded,
    globalPermissions,
    modelsByPermission,
    explorableModels,
    developableProjects,
    readableProjects,
    sqlRunnerConnections,
    editableFolderIds,
    canConfigureExtension,
    canManageUserAttributes,
    tools: {
      app: mkTool(hasExplore, hasExplore && !hasSaveDash, appMissing),
      dashboard: mkTool(hasExplore, hasExplore && !hasSaveContent, dashMissing),
      lookml: mkTool(
        hasSeeLookml,
        !hasDevelop && hasSeeLookml,
        hasDevelop ? [] : ['develop'],
        !hasDevelop
          ? hasSeeLookml
            ? 'Read-only LookML access (missing develop permission)'
            : 'Missing Looker permissions: develop'
          : undefined
      ),
      health: mkTool(
        hasPillar1 || hasSeeLookml || hasPillar3,
        false,
        healthMissing,
        healthMissing.length > 0 ? `Partial 3-Pillar access (missing: ${healthMissing.join(', ')})` : undefined
      ),
      tile: mkTool(hasExplore, hasExplore && !hasSaveDash, appMissing),
    },
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
  // 1. Seed existing canonical query slugs and register only new/changed widget queries concurrently
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

  // 2. Update existing dashboard + inline extension concurrently if present
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

  // 3. Create new inline extension + full-bleed dashboard concurrently
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

export function getArtifactNamespace(extensionSDK?: any): string {
  return String(extensionSDK?.lookerHostData?.extensionId || 'data_app_builder')
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

async function searchArtifactsRaw(
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

async function readArtifactJson<T = any>(
  sdk: Looker40SDK,
  namespace: string,
  key: string
): Promise<{ version?: number; data?: T } | null> {
  try {
    const hit = (await searchArtifactsRaw(sdk, namespace, key)).find((a) => a.key === key)
    if (!hit) return null
    const data = typeof hit.value === 'string' ? JSON.parse(hit.value) : (hit.value as T)
    return { version: typeof hit.version === 'number' ? hit.version : undefined, data }
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
    bundle.content_type ||
    bundle.contentType ||
    existing?.contentType ||
    (id.includes('::') ? 'lookml_dashboard' : 'dashboard')
  const title = bundle.title || existing?.title || `Native ${contentType} #${id}`
  const effectiveFolderId = String(
    bundle.folder_id || bundle.folderId || existing?.folderId || folderId || '1'
  )
  const embedPath = resolveNativeEmbedPath(
    contentType,
    id,
    bundle.embed_path || bundle.url || existing?.embedPath
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
    lookId: bundle.look_id ?? existing?.lookId,
    boardId: bundle.board_id ?? existing?.boardId,
    lookmlDashboardId:
      bundle.lookml_dashboard_id ??
      existing?.lookmlDashboardId ??
      (contentType === 'lookml_dashboard' ? id : undefined),
    projectId: bundle.project_id ?? existing?.projectId,
    model: bundle.model ?? existing?.model,
    filePath: bundle.file_path ?? existing?.filePath,
    layoutId: bundle.layout_id ?? existing?.layoutId,
    elementIds: bundle.element_ids ?? existing?.elementIds,
    filterNames: bundle.filter_names ?? existing?.filterNames,
    layoutComponentIds: bundle.layout_component_ids ?? existing?.layoutComponentIds,
    queryCache: bundle.query_cache ?? existing?.queryCache,
    filterCache: bundle.filter_cache ?? existing?.filterCache,
    summary: bundle.summary ?? existing?.summary,
    elements: bundle.elements ?? existing?.elements,
    studio: nextStudio,
  }

  const updates = [
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
      await rawLookerRequest(sdk, 'PUT', `/artifacts/${encodeURIComponent(namespace)}`, undefined, updates)
    }
  } catch {
    // Non-fatal outside an extension host
  }

  return {
    ...objPayload,
    studio: nextStudio,
  }
}

export async function loadNativeContentById(
  sdk: Looker40SDK,
  extensionSDK: any,
  rawId: string
): Promise<NativeContentState> {
  const prefixMatch = rawId.trim().match(/^(dashboard|lookml_dashboard|look|board):(.+)$/i)
  const explicitType = prefixMatch ? (prefixMatch[1].toLowerCase() as NativeContentType) : undefined
  const cleanId = (prefixMatch ? prefixMatch[2] : rawId).trim()
  const stored = await readArtifactJson<any>(
    sdk,
    getArtifactNamespace(extensionSDK),
    `obj_dashboard_${cleanId}`
  )
  if (stored?.data?.id) {
    const d = stored.data
    const cType: NativeContentType =
      explicitType ||
      d.contentType ||
      (String(d.id).includes('::') ? 'lookml_dashboard' : 'dashboard')
    return {
      ...d,
      id: String(d.id),
      contentType: cType,
      title: d.title || `Native ${cType} #${d.id}`,
      folderId: String(d.folderId || '1'),
      embedPath: resolveNativeEmbedPath(cType, String(d.id), d.embedPath),
    }
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
  return {
    id,
    contentType: finalType,
    title: item.title || `${finalType} #${id}`,
    folderId: String(item.folder?.id || item.folder_id || '1'),
    embedPath: resolveNativeEmbedPath(finalType, id),
    tileCount: item.dashboard_elements?.length,
    filterCount: item.dashboard_filters?.length,
    lookmlDashboardId:
      finalType === 'lookml_dashboard'
        ? id
        : item.lookml_link_id
        ? String(item.lookml_link_id)
        : undefined,
  }
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

export const ARTIFACT_NAMESPACE = 'data_app_builder'

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

// ponytail: Looker update_artifacts requires the current `version` for existing keys;
// batch-fetch versions in one `artifact` call and upsert with content_type: "application/json".
export async function putArtifacts(
  sdk: Looker40SDK,
  items: Array<{ key: string; value: any }>,
  namespace = ARTIFACT_NAMESPACE
): Promise<void> {
  if (items.length === 0) return
  const versionByKey = new Map<string, number>()
  try {
    const existing = await sdk.ok(
      sdk.artifact({
        namespace,
        key: items.map((i) => i.key).join(','),
      })
    )
    for (const a of existing || []) {
      if (a.key && typeof a.version === 'number') {
        versionByKey.set(a.key, a.version)
      }
    }
  } catch {
    // Keys do not exist yet
  }
  await sdk.ok(
    sdk.update_artifacts(
      namespace,
      items.map((item) => {
        const version = versionByKey.get(item.key)
        return {
          key: item.key,
          value:
            typeof item.value === 'string' ? item.value : JSON.stringify(item.value),
          content_type: 'application/json',
          ...(version !== undefined ? { version } : {}),
        }
      })
    )
  )
}

export async function getArtifactJson<T = any>(
  sdk: Looker40SDK,
  key: string,
  namespace = ARTIFACT_NAMESPACE
): Promise<T | null> {
  try {
    const rows = await sdk.ok(sdk.artifact({ namespace, key }))
    const found = (rows || []).find((r) => r.key === key) || rows?.[0]
    if (!found || !found.value) return null
    return JSON.parse(found.value) as T
  } catch {
    return null
  }
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
      const rows = await sdk.ok(sdk.search_artifacts({ namespace, key: pattern }))
      for (const r of rows || []) {
        if (!r.value) continue
        try {
          const parsed = JSON.parse(r.value) as SavedScript
          if (parsed?.id && !byId.has(parsed.id)) {
            byId.set(parsed.id, parsed)
          }
        } catch {
          // Ignore non-JSON artifact
        }
      }
    } catch {
      // Ignore empty namespace
    }
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
  paramsOrUserId: any,
  indexArg?: UserArtifactIndexEntry,
  objectPayloadArg?: Record<string, any>
): Promise<SharedArtifactPayload> {
  if (typeof paramsOrUserId === 'string' && indexArg) {
    const items = [
      { key: formatUserArtifactKey(paramsOrUserId, indexArg.type, indexArg.id), value: indexArg },
      ...(objectPayloadArg ? [{ key: formatObjectArtifactKey(indexArg.type, indexArg.id), value: objectPayloadArg }] : []),
    ]
    await putArtifacts(sdk, items, ARTIFACT_NAMESPACE)
    return (objectPayloadArg || indexArg) as SharedArtifactPayload
  }
  const params = paramsOrUserId
  const namespace = params.namespace || getArtifactNamespace(params.extensionSDK)
  const indexEntry: UserArtifactIndexEntry = {
    id: String(params.id),
    type: params.type,
    title: String(params.title || params.id).slice(0, 140),
    updatedAt: new Date().toISOString(),
    createdBy: String(params.userId),
    ...(params.targetId ? { targetId: String(params.targetId) } : {}),
    ...(params.explores?.length ? { explores: params.explores.slice(0, 10) } : {}),
    ...(params.lastInteractionId ? { lastInteractionId: params.lastInteractionId } : {}),
    ...(params.environmentId ? { environmentId: params.environmentId } : {}),
  }
  const fullPayload: SharedArtifactPayload = {
    ...indexEntry,
    ...(params.code !== undefined ? { code: params.code } : {}),
    ...(params.content !== undefined ? { content: params.content } : {}),
    ...(params.messages?.length ? { messages: params.messages.slice(-200) } : {}),
    ...(params.payload || {}),
  }
  const items: Array<{ key: string; value: any }> = [
    {
      key: formatUserArtifactKey(params.userId, params.type, params.id),
      value: indexEntry,
    },
  ]
  if (!params.skipObjectPayload) {
    items.push({
      key: formatObjectArtifactKey(params.type, params.id),
      value: fullPayload,
    })
  }
  await putArtifacts(sdk, items, namespace)
  return fullPayload
}

export async function listUserArtifacts(
  sdk: Looker40SDK,
  paramsOrUserId: any,
  namespaceArg = ARTIFACT_NAMESPACE
): Promise<UserArtifactIndexEntry[]> {
  const params =
    typeof paramsOrUserId === 'string'
      ? { userId: paramsOrUserId, namespace: namespaceArg }
      : paramsOrUserId
  const namespace = params.namespace || getArtifactNamespace(params.extensionSDK)
  const keyPattern = params.type
    ? `user_${params.userId}_${params.type}_%`
    : `user_${params.userId}_%`
  const rows = await searchArtifactsRaw(sdk, namespace, keyPattern)
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
          createdBy: String(parsed.createdBy || params.userId),
        } as UserArtifactIndexEntry)
      }
    } catch {
      // Ignore malformed artifact value
    }
  }
  return entries.sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  )
}

export async function loadObjectArtifact<T = SharedArtifactPayload>(
  sdk: Looker40SDK,
  paramsOrType: any,
  idArg?: string,
  namespaceArg = ARTIFACT_NAMESPACE
): Promise<T | null> {
  const params =
    typeof paramsOrType === 'string'
      ? { type: paramsOrType as StudioToolMode, id: String(idArg || ''), namespace: namespaceArg }
      : paramsOrType
  const namespace = params.namespace || getArtifactNamespace(params.extensionSDK)
  const direct = await getArtifactJson<T>(
    sdk,
    formatObjectArtifactKey(params.type, params.id),
    namespace
  )
  if (direct) return direct
  const fallbackRows = await searchArtifactsRaw(
    sdk,
    namespace,
    `%_${params.type}_${params.id}`
  )
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
  paramsOrUserId: any,
  typeArg?: StudioToolMode,
  idArg?: string,
  deleteSharedArg = false,
  namespaceArg = ARTIFACT_NAMESPACE
): Promise<void> {
  const params =
    typeof paramsOrUserId === 'string'
      ? { userId: paramsOrUserId, type: typeArg as StudioToolMode, id: String(idArg || ''), deleteSharedPayload: deleteSharedArg, namespace: namespaceArg }
      : paramsOrUserId
  const namespace = params.namespace || getArtifactNamespace(params.extensionSDK)
  const keys = [formatUserArtifactKey(params.userId, params.type, params.id)]
  if (params.deleteSharedPayload) {
    keys.push(formatObjectArtifactKey(params.type, params.id))
  }
  await sdk.ok(sdk.delete_artifact(namespace, keys.join(',')))
}
