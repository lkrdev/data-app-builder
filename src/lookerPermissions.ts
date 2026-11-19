import type { ExtensionSDK } from '@looker/extension-sdk'
import type { IFolder, ILookmlModel, IRole, IUser } from '@looker/sdk'

import { cleanLookmlProjectId } from './antigravityTypes'
import { type ExtensionHostStorageLike, getDualStorage, getWinStorage, setDualStorage } from './lookerDraftScripts'

export * from './lookerDraftScripts'

export const STUDIO_FOLDER_STORAGE_KEY = 'dab_selected_folder_id'

export function readInitialSelectedFolderId(): string | null {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    const raw = w?.__MOCK_LOOKER_EXTENSION__?.initialSelectedFolderId ?? w?.localStorage?.getItem?.(STUDIO_FOLDER_STORAGE_KEY)
    return String(raw ?? '').trim() || null
  } catch {
    return null
  }
}

export async function loadStoredSelectedFolderId(extensionSDK?: Partial<ExtensionSDK>): Promise<string | null> {
  try {
    const raw = (await extensionSDK?.localStorageGetItem?.(STUDIO_FOLDER_STORAGE_KEY)) ?? readInitialSelectedFolderId()
    return String(raw ?? '').trim() || null
  } catch {
    return readInitialSelectedFolderId()
  }
}

export function persistSelectedFolderId(extensionSDK: Partial<ExtensionSDK> | undefined, folderId: string): void {
  const clean = String(folderId ?? '').trim()
  if (clean) void setDualStorage(STUDIO_FOLDER_STORAGE_KEY, clean, extensionSDK)
}

export const STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY = 'dab_left_pane_width'
export const DEFAULT_LEFT_PANE_WIDTH = 380
export const MIN_LEFT_PANE_WIDTH = 280
export const MAX_LEFT_PANE_WIDTH = 780
export const STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY = 'dab_right_pane_collapsed'

export function clampLeftPaneWidth(width: number): number {
  const n = Number(width)
  return Number.isFinite(n) ? Math.min(MAX_LEFT_PANE_WIDTH, Math.max(MIN_LEFT_PANE_WIDTH, Math.round(n))) : DEFAULT_LEFT_PANE_WIDTH
}

export function readInitialLeftPaneWidth(): number {
  const raw = getWinStorage(STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY)
  return raw == null || String(raw).trim() === '' ? DEFAULT_LEFT_PANE_WIDTH : clampLeftPaneWidth(Number(raw))
}
export async function loadStoredLeftPaneWidth(extensionSDK?: ExtensionHostStorageLike | null): Promise<number> {
  const raw = await getDualStorage(STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY, extensionSDK)
  return raw == null || String(raw).trim() === '' ? DEFAULT_LEFT_PANE_WIDTH : clampLeftPaneWidth(Number(raw))
}
export async function saveStoredLeftPaneWidth(width: number, extensionSDK?: ExtensionHostStorageLike | null): Promise<void> {
  await setDualStorage(STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY, String(clampLeftPaneWidth(width)), extensionSDK)
}
export function readInitialRightPaneCollapsed(): boolean {
  if (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth <= 768) return true
  const raw = String(getWinStorage(STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY) ?? '').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}
export async function loadStoredRightPaneCollapsed(extensionSDK?: ExtensionHostStorageLike | null): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth <= 768) return true
  const norm = String((await getDualStorage(STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY, extensionSDK)) ?? '').trim().toLowerCase()
  return norm === 'true' || norm === '1'
}
export async function saveStoredRightPaneCollapsed(collapsed: boolean, extensionSDK?: ExtensionHostStorageLike | null): Promise<void> {
  await setDualStorage(STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false', extensionSDK)
}

export type StudioBusySendAction = 'queue' | 'interject'
export const STUDIO_BUSY_SEND_ACTION_STORAGE_KEY = 'dab_busy_send_action'
export const DEFAULT_BUSY_SEND_ACTION: StudioBusySendAction = 'queue'
export const normalizeBusySendAction = (val?: string | null): StudioBusySendAction =>
  String(val || '').trim().toLowerCase() === 'interject' ? 'interject' : DEFAULT_BUSY_SEND_ACTION
export const readInitialBusySendAction = (): StudioBusySendAction =>
  normalizeBusySendAction(getWinStorage(STUDIO_BUSY_SEND_ACTION_STORAGE_KEY))
export async function loadStoredBusySendAction(extensionSDK?: ExtensionHostStorageLike | null): Promise<StudioBusySendAction> {
  return normalizeBusySendAction(await getDualStorage(STUDIO_BUSY_SEND_ACTION_STORAGE_KEY, extensionSDK))
}
export async function saveStoredBusySendAction(action: StudioBusySendAction, extensionSDK?: ExtensionHostStorageLike | null): Promise<void> {
  await setDualStorage(STUDIO_BUSY_SEND_ACTION_STORAGE_KEY, normalizeBusySendAction(action), extensionSDK)
}

export const STUDIO_INFLIGHT_CONV_SESSION_KEY = 'dab_inflight_conv_id'
export function readInFlightConvIds(): string[] {
  try {
    const raw = (typeof window !== 'undefined' ? (window.sessionStorage?.getItem?.(STUDIO_INFLIGHT_CONV_SESSION_KEY) ?? '') : '').trim()
    if (!raw) return []
    if (raw.startsWith('[')) {
      const p: unknown = JSON.parse(raw)
      if (Array.isArray(p)) return Array.from(new Set(p.map((x) => String(x || '').trim()).filter(Boolean)))
    }
    return [raw]
  } catch { return [] }
}
const writeInFlightConvIds = (ids: string[]): void => {
  try {
    if (typeof window === 'undefined') return
    const uniq = Array.from(new Set(ids.map((x) => String(x || '').trim()).filter(Boolean)))
    if (uniq.length === 0) window.sessionStorage?.removeItem?.(STUDIO_INFLIGHT_CONV_SESSION_KEY)
    else window.sessionStorage?.setItem?.(STUDIO_INFLIGHT_CONV_SESSION_KEY, JSON.stringify(uniq))
  } catch { /* ignore */ }
}
export const addInFlightConvId = (convId: string): void => { const id = String(convId || '').trim(); if (id) writeInFlightConvIds([...readInFlightConvIds().filter((x) => x !== id), id]) }
export const removeInFlightConvId = (convId: string): void => { const id = String(convId || '').trim(); if (id) writeInFlightConvIds(readInFlightConvIds().filter((x) => x !== id)) }
export const readInFlightConvId = (): string | null => { const ids = readInFlightConvIds(); return ids.length > 0 ? ids[ids.length - 1] : null }
export const saveInFlightConvId = (convId: string): void => addInFlightConvId(convId)
export const clearInFlightConvId = (convId?: string): void => { if (convId) removeInFlightConvId(convId); else writeInFlightConvIds([]) }

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
  let parsed: Record<string, unknown> | null = null
  try {
    if (text.startsWith('{')) parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // ignore malformed JSON
  }
  const message = String(parsed?.message || text || 'Not found')
  const docUrl = String(parsed?.documentation_url || '')
  const isInlineExt = path.includes('/data_app_extension') || path.includes('/inline_extension')
  const isAlertPath = /\/(?:alerts|alert_details|alert_notifications)(?:\/|$|\?)/i.test(path)
  const hasErrDoc = docUrl.includes('/r/err/') || text.includes('/r/err/')

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
  if ((status === 404 || status === 403) && (hasErrDoc || isAlertPath || /^not found(?:\s*\(\[Docs\]\([^)]*\)\))?$/i.test(message.trim()))) {
    return {
      kind: 'role_denied',
      status,
      path,
      message,
      remediation: isAlertPath
        ? `Looker returned ${status} on alert endpoint "${path}". Verify the user's Looker Role includes create_alerts (own alerts), follow_alerts (follow/unfollow), or manage_alerts (admin / other owners' alerts), and that the user owns or has access to this alert.`
        : `Looker returned a Role-Denied 404 on "${path}". Verify the user's Looker Role permissions (e.g. access_data, explore, save_content, save_dashboards, develop) and Model Set in Admin > Roles, or folder edit access.`,
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

const ARTIFACT_KIND_MAP: Record<string, string> = {
  app: 'app', 'data-app': 'app', data_app: 'app', dataapp: 'app',
  'data-investigator': 'app', data_investigator: 'app', datainvestigator: 'app',
  investigator: 'app', investigation: 'app', 'data-story': 'app', data_story: 'app',
  dashboard: 'dashboard', 'content-studio': 'dashboard', content_studio: 'dashboard', udd: 'dashboard',
  lookml: 'lookml', 'agentic-lookml': 'lookml', agentic_lookml: 'lookml',
  health: 'health', 'health-check': 'health', health_check: 'health', healthcheck: 'health',
  tile: 'tile', script: 'tile', alert: 'tile', 'python-tile': 'tile', python_tile: 'tile',
  'conversational-analytics': 'ca', conversational_analytics: 'ca', conversational: 'ca', ca: 'ca', qa: 'ca',
}

export const getConvTargetId = (
  c?: { dashboardId?: string; lookId?: string; lookmlDashboardId?: string; reportId?: string; projectId?: unknown; sessionId?: string; scriptId?: string; alertId?: string; caConversationId?: string; id?: string; contentType?: string; [key: string]: unknown },
  type?: string
): string => {
  if (!c) return ''
  const lookmlTarget = cleanLookmlProjectId(c.projectId) || cleanLookmlProjectId(c.sessionId)
  const raw = String(type || '').trim().toLowerCase().replace(/\s+/g, '-')
  if (!raw || raw === 'auto' || raw === 'chat' || raw === 'conversation') {
    const isLookmlObj = c.contentType === 'lookml' || c.projectId !== undefined || c.sessionId !== undefined
    const fallbackId = isLookmlObj ? cleanLookmlProjectId(c.id) : c.id
    return String(c.dashboardId || c.lookId || c.lookmlDashboardId || c.reportId || lookmlTarget || c.scriptId || c.alertId || c.caConversationId || fallbackId || '').trim()
  }
  const pick: Record<string, unknown> = {
    lookml: lookmlTarget,
    health: c.reportId,
    tile: c.scriptId || c.alertId || c.id,
    ca: c.caConversationId || c.id,
    dashboard: c.contentType === 'look' ? c.lookId || c.dashboardId : c.contentType === 'lookml_dashboard' ? c.lookmlDashboardId || c.dashboardId : c.dashboardId || c.lookmlDashboardId || c.lookId,
    app: c.dashboardId || c.id,
  }
  const canonical = ARTIFACT_KIND_MAP[raw]
  return canonical ? String(pick[canonical] || '').trim() : ''
}

export const isLookmlTargetAlreadyLoaded = (
  targetMode: string, targetArtifactId: string, bundle?: { id?: string; project_id?: string } | null, sessionId?: string
): boolean => {
  const canon = bundle?.project_id || bundle?.id
  if (targetMode !== 'lookml' || !targetArtifactId || !canon) return false
  const tsBase = targetArtifactId.match(/^(.+)_[0-9a-z]{6,}$/i)?.[1]
  return targetArtifactId === canon || targetArtifactId === bundle?.id || Boolean(bundle?.id && sessionId === bundle.id) || tsBase === canon
}

export type StudioMode = StudioCapabilityMode

export const STUDIO_MODES: Array<{ mode: StudioMode; label: string; prefix: string }> = [
  { mode: 'app', label: 'Data App', prefix: '/app' },
  { mode: 'dashboard', label: 'Content Studio', prefix: '/dashboard' },
  { mode: 'lookml', label: 'LookML', prefix: '/lookml' },
  { mode: 'health', label: 'Health Check', prefix: '/health-check' },
  { mode: 'tile', label: 'Script', prefix: '/tile' },
]

const LEGACY_ROUTE_RE =
  /^\/(?:conversational-analytics|ca|data-investigator|investigator|health(?:-check)?|script|tile|dashboard|lookml|app)(?:\/(.*))?$/i

export function buildStudioRoute(conversationId = ''): string {
  const cleanId = String(conversationId || '').trim()
  return cleanId ? `/c/${encodeURIComponent(cleanId)}` : '/'
}

export function inferRouteArtifactKind(pathname: string, convId = ''): string | undefined {
  const clean = (pathname || '/').trim()
  const legacyPrefix = clean.match(
    /^\/(conversational-analytics|ca|data-investigator|investigator|health(?:-check)?|script|tile|dashboard|lookml|app)(?:\/|$)/i
  )?.[1]
  const idPrefix =
    convId.match(
      /^conv_(app|data_app|data-investigator|data_investigator|investigator|dashboard|lookml|health-check|health_check|health|tile|script|conversational-analytics)_/i
    )?.[1] ||
    (/^ca_conv_/i.test(convId) ? 'conversational-analytics'
      : /^lookml_/i.test(convId) ? 'lookml'
      : /^(?:hc|health)_/i.test(convId) ? 'health'
      : /^(?:dash_native|look|board)_/i.test(convId) ? 'dashboard'
      : /^script_/i.test(convId) ? 'tile' : undefined)
  const kind = ARTIFACT_KIND_MAP[(legacyPrefix || idPrefix || '').toLowerCase()]
  return kind === 'ca' ? 'conversational-analytics' : kind
}

export function parseStudioRoute(pathname: string): {
  objectId: string
  conversationId: string
  isLegacyRoute?: boolean
} {
  const clean = (pathname || '/').trim()
  if (clean === '/' || clean === '/config') return { objectId: '', conversationId: '' }
  if (clean === '/c' || clean === '/c/') return { objectId: '', conversationId: '', isLegacyRoute: true }
  if (clean.startsWith('/c/')) {
    const convId = decodeURIComponent(clean.slice(3).replace(/^\/+|\/+$/g, ''))
    const convMatch = convId.match(
      /^conv_(?:app|data_app|data-investigator|data_investigator|investigator|dashboard|lookml|health-check|health_check|health|tile|script|conversational-analytics)_(.+)$/i
    )
    return { objectId: convMatch ? convMatch[1] : convId, conversationId: convId }
  }
  const legacyMatch = clean.match(LEGACY_ROUTE_RE)
  if (legacyMatch) {
    const rest = decodeURIComponent((legacyMatch[1] || '').replace(/^\/+|\/+$/g, ''))
    return { objectId: rest, conversationId: rest, isLegacyRoute: true }
  }
  const fallbackId = decodeURIComponent(clean.replace(/^\/+|\/+$/g, ''))
  return { objectId: fallbackId, conversationId: fallbackId, ...(fallbackId ? { isLegacyRoute: true } : {}) }
}

const CONVERSATIONAL_NOOP_RE =
  /^\s*(?:(?:hi|hello|hey|howdy|greetings|good\s+(?:morning|afternoon|evening)|yo)(?:\s+(?:there|looker(?:\s+studio)?|studio|team|agent))?|thank(?:s|\s+you)(?:\s+(?:so|very)\s+much)?|help(?:\s+me)?|what\s+can\s+you\s+do|how\s+can\s+you\s+help(?:\s+me)?|what\s+do\s+you\s+do|who\s+are\s+you)[!?.]*\s*$/i
const CONVERSATIONAL_META_RE =
  /\b(?:er+o+rs?\s+(?:you|we|that)|what\s+er+o+rs?\s+did\s+you|experienced\s+here|make\s+you\s+better|improve\s+you(?:\b|rself)|what\s+went\s+wrong|why\s+did\s+(?:you|that|it|this)\s+fail|(?:summarize|explain)\s+(?:what\s+you\s+(?:did|ran|tried)|the\s+er+o+rs?|your\s+(?:er+o+rs?|steps|thinking)))\b/i

export function isConversationalNoOpPrompt(text?: string): boolean {
  const clean = String(text || '').trim()
  return CONVERSATIONAL_NOOP_RE.test(clean) || CONVERSATIONAL_META_RE.test(clean)
}

export const EXPLICIT_SCRIPT_CREATION_RE =
  /\b(python\s*tile|python\s*script|codemode\s*script|obj_script|monty\s*python\s*tile|(?:run|execute|use)\s+(?:a\s+)?python\s+(?:script|code|calculation)|(?:create|write|build|save|make|turn\s+(?:it|this|that)\s+into)\s+(?:a\s+|this\s+|that\s+|as\s+a\s+)?(?:reusable\s+)?(?:python\s+)?(?:script|tile))\b/i

const CONTENT_CREATION_VERB_RE =
  /\b(?:build|create|author|make|design|generate|update|edit|refactor|pin|schedule|convert|onboard)\b/i

export const LOOKER_ALERT_QUERY_RE =
  /\b(?:alerts?|alert_details|alert_notifications|follow_alert|unfollow_alert|enqueue_alert|update_alert_field|create_alert|update_alert|delete_alert)\b/i

export const LOOKER_INSTANCE_ADMIN_OP_RE =
  /\b(?:health(?:[_\s-]*check)?[_\s-]*(?:pulse|analyze|vacuum)\b|unused\s+(?:explores?|joins?|fields?|models?|lookml)\b|(?:api_template|describe_body)\b|(?:request|api|writable)\s+body\s+(?:template|schema|skeleton)s?\b|(?:export|import)_(?:dashboard|look)_json\b|(?:export|import)\s+(?:portable\s+)?(?:dashboard|look)\s+json\b|(?:delete|remove|trash|clean\s*up)\b[\s\S]{0,100}\b(?:personal|home)\s*(?:folder|space)s?\b)/i

export const LOOKER_INSTANCE_API_QUERY_RE =
  /\b(?:personal\s*(?:space|folder)s?|home\s*(?:folder|space)s?|shared\s*(?:space|folder)s?|(?:in|from|inside|under)\s+my\s+personal\b|(?:in|from|inside|under)\s+my\s+home\b|(?:my|our)\s+favou?rite\s+(?:dashboards?|looks?|content|folders?)|(?:dashboards?|looks?)\s+(?:in\s+my\s+(?:personal|home|shared|favou?rites?|folder|space)|that\s+I\s+favou?rited)|(?:my|our|all|empty|unused|list|find|inspect|search|query)\s+(?:looker\s+)?(?:personal\s+|home\s+|shared\s+)?(?:spaces|folders)\b|(?:my|our)\s+(?:looker\s+)?(?:space|folder)\b|(?:spaces|folders)\s+(?:that|which|without|with\s+no)|folder_children|all_folders|search_folders|search_dashboards|search_looks|looker\s*sdk|instance\s*metadata|(?:what|which|query|inspect|list|find|check|show)\s+(?:looker\s+)?(?:users?|roles?|permissions?|groups?|scheduled\s*plans?|schedules?|instance\s*metadata)\b(?:\s+(?:have|with|in|on|for|are|who|that))?|(?:users?|roles?)\s+have\s+(?:admin|developer|viewer)|admin\s+roles?\b)/i

export function isLookerInstanceMetadataQuery(text?: string): boolean {
  const clean = String(text || '').trim()
  if (!clean || EXPLICIT_SCRIPT_CREATION_RE.test(clean)) return false
  if (LOOKER_ALERT_QUERY_RE.test(clean) || LOOKER_INSTANCE_ADMIN_OP_RE.test(clean)) return true
  if (CONTENT_CREATION_VERB_RE.test(clean)) return false
  return LOOKER_INSTANCE_API_QUERY_RE.test(clean)
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

export type LookerUserLike = Partial<IUser> & { is_iam_admin?: boolean }
export type LookerRoleLike = Partial<IRole>
export type LookerModelLike = Partial<ILookmlModel>
export type LookerFolderLike = Partial<IFolder>

// ponytail: evaluate Role = PermissionSet × ModelSet per role first so model sets never bleed across roles,
// then apply Looker's Model -> Project and Model -> Connection expansion rules.
export function resolveUserCapabilities(
  params: {
    user?: LookerUserLike | null
    roles?: LookerRoleLike[] | null
    models?: LookerModelLike[] | null
    folders?: LookerFolderLike[] | null
  } = {}
): UserCapabilities {
  const user: LookerUserLike = params.user || {}
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
          (r: LookerRoleLike) =>
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
  const hasSaveContent = isAdmin || (globalPermissions.has('save_content') && (globalPermissions.has('save_dashboards') || globalPermissions.has('save_looks')))
  const hasDevelop = isAdmin || developableProjects.size > 0 || globalPermissions.has('develop')
  const hasSeeLookml = hasDevelop || readableProjects.size > 0 || globalPermissions.has('see_lookml')
  const hasPillar1 = isAdmin || globalPermissions.has('see_system_activity') || hasModelPerm('explore', 'system__activity')
  const hasPillar3 = isAdmin || sqlRunnerConnections.size > 0 || globalPermissions.has('use_sql_runner')

  const appMissing = [
    ...(!hasExplore ? ['explore'] : []),
    ...(!isAdmin && !globalPermissions.has('save_content') ? ['save_content'] : []),
    ...(!isAdmin && !globalPermissions.has('save_dashboards') ? ['save_dashboards'] : []),
  ]
  const dashMissing = [
    ...(!hasExplore ? ['explore'] : []),
    ...(!isAdmin && !globalPermissions.has('save_content') ? ['save_content'] : []),
    ...(!isAdmin && !globalPermissions.has('save_dashboards') && !globalPermissions.has('save_looks') ? ['save_dashboards'] : []),
  ]
  const healthMissing = [...(!hasPillar1 ? ['see_system_activity'] : []), ...(!hasDevelop ? ['develop'] : []), ...(!hasPillar3 ? ['use_sql_runner'] : [])]

  const mkTool = (enabled: boolean, readOnly: boolean, missingPermissions: string[], reason?: string): ToolAvailability =>
    !rolesLoaded
      ? { enabled: true, readOnly: false, missingPermissions: [] }
      : { enabled, readOnly, missingPermissions, reason: reason ?? (missingPermissions.length > 0 ? `Missing Looker permissions: ${missingPermissions.join(', ')}` : undefined) }

  return {
    isAdmin, rolesLoaded, globalPermissions, modelsByPermission, explorableModels, developableProjects, readableProjects,
    sqlRunnerConnections, editableFolderIds, canConfigureExtension, canManageUserAttributes,
    tools: {
      app: mkTool(hasExplore, hasExplore && !hasSaveDash, appMissing),
      dashboard: mkTool(hasExplore, hasExplore && !hasSaveContent, dashMissing),
      lookml: mkTool(
        hasSeeLookml, !hasDevelop && hasSeeLookml, hasDevelop ? [] : ['develop'],
        !hasDevelop ? (hasSeeLookml ? 'Read-only LookML access (missing develop permission)' : 'Missing Looker permissions: develop') : undefined
      ),
      health: mkTool(hasPillar1 || hasSeeLookml || hasPillar3, false, healthMissing, healthMissing.length > 0 ? `Partial 3-Pillar access (missing: ${healthMissing.join(', ')})` : undefined),
      tile: mkTool(hasExplore, hasExplore && !hasSaveDash, appMissing),
    },
  }
}
