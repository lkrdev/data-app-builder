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

export type ResolvedStudioUseCase =
  | 'app'
  | 'dashboard'
  | 'lookml'
  | 'health-check'
  | 'tile'
  | 'conversational-analytics'

export type StudioUseCase = 'auto' | ResolvedStudioUseCase

export const STUDIO_USE_CASE_OPTIONS: Array<{
  value: StudioUseCase
  label: string
  capabilityMode: StudioCapabilityMode | null
}> = [
  { value: 'auto', label: 'Auto (Agent Decides)', capabilityMode: null },
  { value: 'app', label: 'Data App', capabilityMode: 'app' },
  { value: 'dashboard', label: 'Content Studio', capabilityMode: 'dashboard' },
  { value: 'lookml', label: 'LookML', capabilityMode: 'lookml' },
  { value: 'health-check', label: 'Health Check', capabilityMode: 'health' },
  { value: 'tile', label: 'Python Tile', capabilityMode: 'tile' },
  { value: 'conversational-analytics', label: 'Conversational Analytics', capabilityMode: 'app' },
]

export function getUseCaseLabel(useCase: StudioUseCase): string {
  return STUDIO_USE_CASE_OPTIONS.find((o) => o.value === useCase)?.label || useCase
}

const USE_CASE_ALIAS_MAP: Record<string, ResolvedStudioUseCase> = {
  app: 'app',
  'data-app': 'app',
  data_app: 'app',
  dataapp: 'app',
  dashboard: 'dashboard',
  'content-studio': 'dashboard',
  content_studio: 'dashboard',
  udd: 'dashboard',
  lookml: 'lookml',
  'agentic-lookml': 'lookml',
  agentic_lookml: 'lookml',
  health: 'health-check',
  'health-check': 'health-check',
  health_check: 'health-check',
  healthcheck: 'health-check',
  tile: 'tile',
  script: 'tile',
  'python-tile': 'tile',
  python_tile: 'tile',
  'conversational-analytics': 'conversational-analytics',
  conversational_analytics: 'conversational-analytics',
  conversational: 'conversational-analytics',
  ca: 'conversational-analytics',
  qa: 'conversational-analytics',
}

export function useCaseToStudioMode(useCase: StudioUseCase): StudioCapabilityMode {
  if (useCase === 'dashboard') return 'dashboard'
  if (useCase === 'lookml') return 'lookml'
  if (useCase === 'health-check') return 'health'
  if (useCase === 'tile') return 'tile'
  return 'app'
}

export function studioModeToUseCase(mode?: string): ResolvedStudioUseCase {
  const token = String(mode || '').trim().toLowerCase().replace(/\s+/g, '-')
  return USE_CASE_ALIAS_MAP[token] || 'app'
}

export function getAllowedUseCases(
  capabilities?: UserCapabilities | null,
  disabledModes: StudioCapabilityMode[] = []
): ResolvedStudioUseCase[] {
  const disabledSet = new Set<StudioCapabilityMode>(disabledModes || [])
  const out: ResolvedStudioUseCase[] = []
  for (const opt of STUDIO_USE_CASE_OPTIONS) {
    if (opt.value === 'auto' || !opt.capabilityMode) continue
    if (disabledSet.has(opt.capabilityMode)) continue
    if (capabilities?.rolesLoaded) {
      const tool = capabilities.tools?.[opt.capabilityMode]
      if (tool && !tool.enabled) continue
      if (opt.value === 'lookml' && tool?.readOnly) continue
    }
    out.push(opt.value)
  }
  return out.length > 0 ? out : ['app']
}

const USE_CASE_RULES: Array<[ResolvedStudioUseCase, RegExp]> = [
  ['health-check', /\b(3-pillar|three-pillar|health\s*check|transcriber\s*rubric|technical_design_document)\b/i],
  ['lookml', /\b(lookml|\.lkml|dimension\s*:|measure\s*:|explore\s*:|refinement|data\s*test|model\.lkml|view\.lkml)\b/i],
  ['tile', /\b(python\s*tile|python\s*script|codemode\s*script|obj_script|monty\s*python\s*tile)\b/i],
  ['dashboard', /\b(udd|user[- ]defined\s*dashboard|native\s*dashboard|saved\s*look|lookml\s*dashboard|pin\s*to\s*board|schedule\s*dashboard|content\s*studio)\b/i],
  ['app', /\b(data\s*app|lit\s*app|web\s*component|app-kpi|app-chart|app-grid|custom\s*app|interactive\s*app)\b/i],
  ['conversational-analytics', /\b(conversational\s*analytics|what\s+is\s+the|how\s+many|why\s+did|summarize\s+the|explain\s+the|answer\s+this\s+question)\b/i],
  ['lookml', /\b(add\s+a\s+measure|add\s+a\s+dimension|create\s+a\s+view|edit\s+view|sql_table_name|derived_table)\b/i],
  ['dashboard', /\b(build\s+a\s+dashboard|create\s+a\s+dashboard|create\s+a\s+look|create\s+a\s+board)\b/i],
]

// ponytail: extract <USE_CASE>...</USE_CASE> emitted by AGENTS.md Turn 1 routing or infer from prompt keywords,
// always intersecting with the user's allowed modes so restricted users never route to a locked capability.
export function extractResolvedUseCase(
  text?: string,
  promptFallback?: string,
  allowedModes?: string[]
): ResolvedStudioUseCase {
  const allowedList: ResolvedStudioUseCase[] =
    Array.isArray(allowedModes) && allowedModes.length > 0
      ? Array.from(
          new Set(
            allowedModes
              .map((m) => USE_CASE_ALIAS_MAP[String(m || '').trim().toLowerCase().replace(/\s+/g, '-')])
              .filter((m): m is ResolvedStudioUseCase => Boolean(m))
          )
        )
      : ['app', 'dashboard', 'lookml', 'health-check', 'tile', 'conversational-analytics']
  const allowedSet = new Set<ResolvedStudioUseCase>(allowedList.length > 0 ? allowedList : ['app'])

  const rawText = String(text || '')
  const tagMatches = Array.from(rawText.matchAll(/<USE_CASE>\s*([^<]+?)\s*<\/USE_CASE>/gi))
  if (tagMatches.length > 0) {
    const token = String(tagMatches[tagMatches.length - 1][1] || '')
      .trim()
      .toLowerCase()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, '-')
    const tagged = USE_CASE_ALIAS_MAP[token]
    if (tagged && allowedSet.has(tagged)) return tagged
  }

  const combined = `${String(promptFallback || '')}\n${rawText}`
  for (const [candidate, re] of USE_CASE_RULES) {
    if (allowedSet.has(candidate) && re.test(combined)) return candidate
  }
  return allowedSet.has('app') ? 'app' : allowedList[0] || 'app'
}

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
