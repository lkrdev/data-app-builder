import type { ExtensionSDK } from '@looker/extension-sdk'
import type { IContentSummary, IRequestContentSummary, Looker40SDK } from '@looker/sdk'

import {
  AGENTS_MD,
  buildNativeContentGuide,
  BUNDLE_APP_PY,
  CONVERSATION_LABEL_REQUEST_TAG,
  DATA_APP_GUIDE_MD,
  DATA_INVESTIGATOR_GUIDE_MD,
  STARTER_PROMPTS_REQUEST_TAG,
  wrapDashboardCodeMode,
} from './antigravityPrompts'
import {
  buildStudioRoute,
  classifyStudioUseCase,
  convertRelativeDateFilterToFixed,
  createDeduplicatedLookerSdkProxy,
  DataAppBundle,
  extractResolvedUseCase,
  getAllowedUseCases,
  getArtifactNamespace,
  getUseCaseLabel,
  NativeContentBundle,
  NativeContentState,
  normalizeNativeContent,
  normalizeQueryFiltersToFixedDates,
  parseExploreId,
  ResolvedStudioUseCase,
  resolveNativeEmbedPath,
  saveUserEnvironmentId,
  STUDIO_USE_CASE_OPTIONS,
  studioModeToUseCase,
  StudioUseCase,
  studioUseCaseToMode,
  useCaseToStudioMode,
} from './lookerApi'
import {
  BOOTSTRAP_LOOKML_PY,
  BOOTSTRAP_SANDBOX_SH,
  buildLookmlSystemGuide,
  classifyLookerOperation,
  computeLkrExtensionCacheKey,
  executeLkrExtensionToolRequest,
  extractLkrExtensionToolRequests,
  extractLookmlBundleFromInteraction,
  LKR_CLI_BRIDGE_TOOL,
  LKR_CLI_SITECUSTOMIZE_PY,
  LKR_DEV_CLI_SPEC,
  LKR_DEV_CLI_VERSION,
  LkrExtensionToolRequest,
  LookmlBundle,
} from './lookmlTool'

export * from './antigravityPrompts'
export {
  buildStudioRoute,
  classifyStudioUseCase,
  convertRelativeDateFilterToFixed,
  extractResolvedUseCase,
  getAllowedUseCases,
  getUseCaseLabel,
  normalizeQueryFiltersToFixedDates,
  STUDIO_USE_CASE_OPTIONS,
  studioModeToUseCase,
  studioUseCaseToMode,
  useCaseToStudioMode,
}
export type { ResolvedStudioUseCase, StudioUseCase } from './lookerApi'
export {
  BOOTSTRAP_LOOKML_PY,
  BOOTSTRAP_SANDBOX_SH,
  classifyLookerOperation,
  computeLkrExtensionCacheKey,
  executeLkrExtensionToolRequest,
  extractLkrExtensionToolRequests,
  LKR_CLI_BRIDGE_TOOL,
  LKR_CLI_SITECUSTOMIZE_PY,
  LKR_DEV_CLI_SPEC,
  LKR_DEV_CLI_VERSION,
}
export type { LkrExtensionToolRequest, LookmlBundle } from './lookmlTool'

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const LkrCodeMode = require('./vendor/codemode.js')

// Expose optional `vars: { type: "object" }` and required `thought: { type: "string" }` on RUN_LOOKER_CODEMODE_TOOL
if (LkrCodeMode?.RUN_LOOKER_CODEMODE_TOOL?.parameters?.properties) {
  LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.vars = {
    type: 'object',
    description:
      'Optional dictionary of top-level variables to inject into the Monty Python sandbox (e.g. project_id, ts_utc, raw_sql, inline_queries_json, test_queries_json, file_ids, test_names, commit_message).',
  }
  LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.thought = {
    type: 'string',
    description:
      'Required concise 1-sentence summary of what this Code Mode snippet is doing with the Looker API calls (e.g. "Querying monthly revenue and brand share from thelook::order_items" or "Creating executive KPI dashboard with 4 tiles").',
  }
  LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.required = ['code', 'thought']
}

export interface AntigravityModelOption {
  id: string
  label: string
  description: string
}

export const DEFAULT_ANTIGRAVITY_MODEL = 'gemini-3.8-flash'

export const ANTIGRAVITY_ALLOWED_MODELS: AntigravityModelOption[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: 'Default — balanced reasoning, coding & tool use' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', description: 'Frontier reasoning & complex multi-step engineering' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: 'Fast multi-step reasoning & coding' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: 'Stable reasoning & tool use' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: 'Lowest latency & cost' },
]

export interface ExtensionAuthContextConfig {
  authMode: 'oauth' | 'apikey'
  clientId?: string
  projectId?: string
  disabledModes?: AntigravityToolType[]
  defaultModel?: string
}

export interface AntigravityAuth {
  mode: 'oauth' | 'apikey'
  oauthToken?: string
  clientId?: string
  projectId?: string
  apiKey?: string
}

export type AntigravityToolType = 'app' | 'dashboard' | 'lookml' | 'health' | 'tile'

export interface AgentSession {
  environmentId?: string
  lastInteractionId?: string
  conversationId?: string
  explores?: string[]
  toolType?: AntigravityToolType
  objectId?: string
}

export type AntigravityExtensionHostLike =
  | (Partial<ExtensionSDK> & {
      createSecretKeyTag?: (key: string) => string
      lookerHostData?: { extensionId?: string; hostUrl?: string }
    })
  | null
  | undefined

export interface AntigravityNestedStepCall {
  name?: string; arguments?: unknown; args?: unknown; path?: string; file_path?: string
  target?: string; description?: string; skill?: string; skill_name?: string
  code?: string; command?: string; language?: string
}

export interface AntigravityInteractionStep extends AntigravityNestedStepCall {
  id?: string; call_id?: string; type?: string; status?: string
  output?: unknown; stdout?: unknown; stderr?: unknown; result?: unknown
  text?: string; summary?: unknown; content?: unknown; parts?: unknown
  thought?: unknown
  input?: string; method?: string
  function_call?: AntigravityNestedStepCall; view_file_call?: AntigravityNestedStepCall
  edit_file_call?: AntigravityNestedStepCall; skill_lookup_call?: AntigravityNestedStepCall
  code_execution?: AntigravityNestedStepCall; code_execution_call?: AntigravityNestedStepCall
  executable_code?: AntigravityNestedStepCall; code_execution_result?: { output?: unknown }
}

export interface AntigravityInteractionOutput {
  id?: string; type?: string; text?: string; summary?: unknown; content?: unknown; parts?: unknown
  thought?: unknown
}

export interface AntigravityUsageMetadata {
  input_tokens?: number; prompt_token_count?: number; output_tokens?: number
  candidates_token_count?: number; thought_tokens?: number; thoughts_token_count?: number
}

export interface AntigravityInteractionPayload {
  id?: string; status?: string; environment_id?: string; output_text?: string
  outputs?: AntigravityInteractionOutput[]; steps?: AntigravityInteractionStep[]
  error?: { message?: string }; bash_calls?: number
  usage?: AntigravityUsageMetadata; usage_metadata?: AntigravityUsageMetadata
  models?: Array<{ name?: string; displayName?: string; description?: string }>; raw?: string
}

export function normalizeEnvironmentId(raw?: string | null): string | undefined {
  const id = String(raw || '').trim()
  return !id || id === 'remote' || /^env_(?:app|dashboard|lookml|health|tile)(?:_isolated|_warm)?$/.test(id) ? undefined : id
}

export function isEnvironmentNotFoundError(err: unknown): boolean {
  const e = err && typeof err === 'object' ? (err as { status?: number; statusCode?: number; message?: string }) : undefined
  const status = Number(e?.status || e?.statusCode || 0)
  return status === 404 || /\b404\b|environment.*not[\s_-]*found|requested entity was not found/i.test(String(e?.message || err || ''))
}

export type CodeModePermissionDecision =
  | 'allow_once'
  | 'allow_op'
  | 'allow_all'
  | 'deny'

export interface CodeModePermissionRequest {
  operation: string
  httpMethod: string
  path: string
  args: { params?: unknown; body?: unknown }
  thought?: string
}

export interface AntigravityActivityStep {
  id: string
  kind: 'thought' | 'codemode' | 'cli_bridge' | 'code_execution' | 'file' | 'skill'
  title: string
  detail?: string
  language?: string
  status?: 'running' | 'done'
}

export interface StudioAttachedFile {
  id?: string
  name?: string
  mimeType: string
  size?: number
  data: string // base64 without data: prefix
  dataUrl: string
  textContent?: string
}

export type PastedImage = StudioAttachedFile

const TEXT_ATTACHMENT_EXT_RE = /\.(?:csv|tsv|json|sql|lkml|lookml|md|py|js|mjs|ts|tsx|txt|ya?ml|xml|html|css)$/i

export function isTextAttachmentFile(name?: string, mimeType?: string): boolean {
  const m = String(mimeType || '').toLowerCase()
  const n = String(name || '').toLowerCase()
  if (m.startsWith('image/') || m === 'application/pdf') return false
  return (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/sql' ||
    m === 'application/javascript' ||
    TEXT_ATTACHMENT_EXT_RE.test(n)
  )
}

export function readAttachedFile(file: File, index = 0): Promise<StudioAttachedFile | null> {
  return new Promise((resolve) => {
    const name = file.name || `attachment_${index + 1}`
    const mimeType = file.type || (TEXT_ATTACHMENT_EXT_RE.test(name) ? 'text/plain' : 'application/octet-stream')
    const id = `att_${Date.now()}_${index}_${ name.replace(/[^a-zA-Z0-9._-]+/g, '_') }`
    if (isTextAttachmentFile(name, mimeType)) {
      const textReader = new FileReader()
      textReader.onload = () => {
        const textContent = String(textReader.result ?? '')
        let base64 = ''
        try {
          base64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(textContent))) : ''
        } catch {
          base64 = ''
        }
        resolve({
          id,
          name,
          mimeType,
          size: file.size,
          data: base64,
          dataUrl: `data:${mimeType};base64,${base64}`,
          textContent,
        })
      }
      textReader.onerror = () => resolve(null)
      textReader.readAsText(file)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] || '' : dataUrl
      if (!base64) {
        resolve(null)
        return
      }
      resolve({
        id,
        name,
        mimeType,
        size: file.size,
        data: base64,
        dataUrl,
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function handleFileInputSelection(
  files: FileList | File[] | null | undefined,
  setAttachedFiles: (updater: (prev: StudioAttachedFile[]) => StudioAttachedFile[]) => void
): void {
  const list = Array.from(files || [])
  if (list.length === 0) return
  void Promise.all(list.map((file, idx) => readAttachedFile(file, idx))).then((resolved) => {
    const valid = resolved.filter((item): item is StudioAttachedFile => Boolean(item))
    if (valid.length > 0) {
      setAttachedFiles((prev) => [...prev, ...valid])
    }
  })
}

export function handleImageClipboardPaste(
  e: { clipboardData?: DataTransfer | null; preventDefault: () => void },
  setPastedImages: (updater: (prev: PastedImage[]) => PastedImage[]) => void
): void {
  const items = Array.from(e.clipboardData?.items || []).filter((item) =>
    item.type.startsWith('image/')
  )
  if (items.length === 0) return
  e.preventDefault()
  for (let i = 0; i < items.length; i += 1) {
    const file = items[i].getAsFile()
    if (!file) continue
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const base64 = dataUrl.split(',')[1]
      if (base64) {
        setPastedImages((prev) => [
          ...prev,
          {
            id: `paste_${Date.now()}_${i}`,
            name: file.name || `screenshot_${prev.length + 1}.png`,
            mimeType: file.type || 'image/png',
            size: file.size,
            data: base64,
            dataUrl,
          },
        ])
      }
    }
    reader.readAsDataURL(file)
  }
}

export interface AntigravityTurnTelemetry {
  agent_wall_ms: number
  poll_wait_ms: number
  poll_count: number
  codemode_exec_ms: number
  looker_http_ms: number
  tool_calls: {
    bash: number
    codemode: number
    looker_http: number
  }
  tokens: {
    input: number
    output: number
    thought: number
  }
  verify_retries: number
  api_retries: number
}

export const DEFAULT_POLL_SCHEDULE_MS = [400, 700, 1000, 1500]
export const CONCURRENT_POLL_SCHEDULE_MS = [250, 450, 750, 1100]

// ponytail: coalesce concurrent environment creation per user so simultaneous Turn 1 / prewarm calls
// spin up 1 remote container and attach all other conversations to the same environment_id.
export const inFlightEnvProvisionByUser = new Map<string, Promise<string>>()
export const sharedEnvExploreSchemas = new Map<string, Record<string, unknown>>()
export const activeInteractionsByEnv = new Map<string, number>()

export function resolveUserProvisionKey(userId?: string, auth?: AntigravityAuth): string {
  return String(userId || auth?.oauthToken?.slice(-16) || auth?.apiKey?.slice(-16) || auth?.clientId || 'default').trim() || 'default'
}

export function recordSharedEnvExploreSchema(
  environmentId: string | undefined,
  exploreKey: string,
  schemaPayload: unknown
): void {
  const envId = normalizeEnvironmentId(environmentId)
  const key = String(exploreKey || '').trim()
  if (!envId || !key || !schemaPayload) return
  sharedEnvExploreSchemas.set(envId, { ...(sharedEnvExploreSchemas.get(envId) || {}), [key]: schemaPayload })
}

export function getSharedEnvExploreSchemas(environmentId: string | undefined): Record<string, unknown> {
  const envId = normalizeEnvironmentId(environmentId)
  return envId ? { ...(sharedEnvExploreSchemas.get(envId) || {}) } : {}
}

export function resolveAdaptivePollScheduleMs(customSchedule?: number[], environmentId?: string, slotIndex = 0): number[] {
  if (customSchedule && customSchedule.length > 0 && customSchedule !== DEFAULT_POLL_SCHEDULE_MS) return customSchedule
  const envId = normalizeEnvironmentId(environmentId)
  const concurrentCount = envId ? activeInteractionsByEnv.get(envId) || 0 : 0
  if (concurrentCount > 1 || slotIndex > 0) {
    const offset = (slotIndex % 4) * 35
    return CONCURRENT_POLL_SCHEDULE_MS.map((ms, idx) => (idx === 0 ? ms + offset : ms))
  }
  return DEFAULT_POLL_SCHEDULE_MS
}

export function getGeminiSecretKeyTag(extensionSDK: AntigravityExtensionHostLike): string {
  if (extensionSDK && typeof extensionSDK.createSecretKeyTag === 'function') {
    return extensionSDK.createSecretKeyTag('gemini_api_key')
  }
  return '{{data_app_builder_data_app_builder_gemini_api_key}}'
}

export function getGeminiUserAttributeName(extensionSDK: AntigravityExtensionHostLike): string {
  return getGeminiSecretKeyTag(extensionSDK).replace(/^\{\{|\}\}$/g, '')
}

export async function ensureGeminiApiKeyUserAttribute(
  sdk: Looker40SDK,
  extensionSDK: AntigravityExtensionHostLike,
  apiKeyValue?: string
): Promise<string> {
  const attrName = getGeminiUserAttributeName(extensionSDK)
  const trimmedKey = apiKeyValue?.trim()
  try {
    const attrs = await sdk.ok(sdk.all_user_attributes({ fields: 'id,name' }))
    const existing = (attrs || []).find((a) => a.name === attrName)
    if (!existing) {
      await sdk.ok(
        sdk.create_user_attribute({
          name: attrName,
          label: 'Looker Agent Gemini API Key',
          type: 'string',
          value_is_hidden: true,
          user_can_view: false,
          user_can_edit: false,
          hidden_value_domain_whitelist: 'https://generativelanguage.googleapis.com/*',
          default_value: trimmedKey || undefined,
        })
      )
    } else if (trimmedKey && existing.id) {
      await sdk.ok(
        sdk.update_user_attribute(String(existing.id), {
          default_value: trimmedKey,
        })
      )
    }
    return attrName
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err || '')
    throw new Error(
      `Looker Admin required to create/update hidden user attribute "${attrName}" (value_is_hidden=true, user_can_view=false, whitelist="https://generativelanguage.googleapis.com/*"): ${errMsg}`
    )
  }
}

export interface GoogleOAuthOptions {
  signal?: AbortSignal
  timeoutMs?: number
  focusReturnDelayMs?: number
}

export interface LookerOAuthRedirectUris {
  extensionUri: string
  spartanUri: string
  activeUri: string
}

export function resolveLookerOAuthRedirectUris(
  hostUrl?: string | null,
  fallbackOrigin?: string,
  hostTypeOrPathname?: string | null
): LookerOAuthRedirectUris {
  const base = (
    (hostUrl && hostUrl.trim()) ||
    fallbackOrigin ||
    (typeof window !== 'undefined' && window.location?.origin) ||
    'https://looker.example.com'
  ).replace(/\/+$/, '')
  const extensionUri = `${base}/extensions/oauth2_redirect`
  const spartanUri = `${base}/spartan/oauth2_redirect`
  const pathOrHostType =
    (hostTypeOrPathname && hostTypeOrPathname.trim()) ||
    (typeof window !== 'undefined' && window.location?.pathname) ||
    ''
  const isSpartan =
    pathOrHostType === 'spartan' || /^\/spartan(\/|$)/.test(pathOrHostType)
  return {
    extensionUri,
    spartanUri,
    activeUri: isSpartan ? spartanUri : extensionUri,
  }
}

export function resolveLookerOAuthRedirectUri(
  hostUrl?: string | null,
  fallbackOrigin?: string
): string {
  return resolveLookerOAuthRedirectUris(hostUrl, fallbackOrigin).extensionUri
}

export function computeIsAuthenticated(
  authMode: 'oauth' | 'apikey',
  oauthToken: string,
  apiKey: string
): boolean {
  return authMode === 'apikey' ? Boolean(apiKey.trim()) : Boolean(oauthToken.trim())
}

export const STUDIO_OAUTH_STORAGE_KEY = 'dab_oauth_session'

export interface StoredOAuthSession {
  token: string
  expiresAt: number
  clientId?: string
}

function parseValidOAuthSession(
  raw: string | null | undefined,
  clientId?: string
): { session: StoredOAuthSession | null; expired: boolean } {
  if (!raw?.trim()) return { session: null, expired: false }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredOAuthSession> | null
    const token = typeof parsed?.token === 'string' ? parsed.token.trim() : ''
    const expiresAt = Number(parsed?.expiresAt)
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return { session: null, expired: true }
    }
    const storedClientId = typeof parsed?.clientId === 'string' ? parsed.clientId.trim() : ''
    const expectedClientId = clientId?.trim() || ''
    if (expectedClientId && storedClientId && storedClientId !== expectedClientId) {
      return { session: null, expired: false }
    }
    return {
      session: { token, expiresAt, ...(storedClientId ? { clientId: storedClientId } : {}) },
      expired: false,
    }
  } catch {
    return { session: null, expired: true }
  }
}

export function clearStoredOAuthSession(extensionSDK?: AntigravityExtensionHostLike): void {
  try {
    if (typeof window !== 'undefined') window.localStorage?.removeItem?.(STUDIO_OAUTH_STORAGE_KEY)
  } catch {
    // ignore browser storage removal failure
  }
  try {
    void extensionSDK?.localStorageRemoveItem?.(STUDIO_OAUTH_STORAGE_KEY)
    void extensionSDK?.localStorageSetItem?.(STUDIO_OAUTH_STORAGE_KEY, '')
  } catch {
    // ignore extensionSDK storage removal failure
  }
}

export function persistOAuthSession(
  extensionSDK: AntigravityExtensionHostLike | undefined,
  session: StoredOAuthSession
): void {
  const token = String(session?.token || '').trim()
  const expiresAt = Number(session?.expiresAt)
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return
  const cid = session.clientId?.trim()
  const serialized = JSON.stringify({ token, expiresAt, ...(cid ? { clientId: cid } : {}) })
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem?.(STUDIO_OAUTH_STORAGE_KEY, serialized)
    }
  } catch {
    // ignore browser storage write failure
  }
  try {
    void extensionSDK?.localStorageSetItem?.(STUDIO_OAUTH_STORAGE_KEY, serialized)
  } catch {
    // ignore extensionSDK storage write failure
  }
}

export function getInitialStoredOAuthToken(clientId?: string): string {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    if (w?.__MOCK_LOOKER_EXTENSION__ && 'initialOauthToken' in w.__MOCK_LOOKER_EXTENSION__) {
      return String(w.__MOCK_LOOKER_EXTENSION__.initialOauthToken || '')
    }
    const { session, expired } = parseValidOAuthSession(
      w?.localStorage?.getItem?.(STUDIO_OAUTH_STORAGE_KEY),
      clientId
    )
    if (expired) clearStoredOAuthSession()
    return session?.token || ''
  } catch {
    return ''
  }
}

export async function loadStoredOAuthSession(
  extensionSDK?: AntigravityExtensionHostLike,
  clientId?: string
): Promise<StoredOAuthSession | null> {
  try {
    const extRaw = await extensionSDK?.localStorageGetItem?.(STUDIO_OAUTH_STORAGE_KEY)
    const raw =
      extRaw?.trim() ||
      (typeof window !== 'undefined'
        ? window.localStorage?.getItem?.(STUDIO_OAUTH_STORAGE_KEY)
        : null)
    const { session, expired } = parseValidOAuthSession(raw, clientId)
    if (expired) clearStoredOAuthSession(extensionSDK)
    return session
  } catch {
    return null
  }
}

export async function loginWithGoogleOAuth(
  extensionSDK: AntigravityExtensionHostLike,
  clientId: string,
  options?: GoogleOAuthOptions
): Promise<string> {
  const focusReturnDelayMs = options?.focusReturnDelayMs ?? 1500
  const timeoutMs = options?.timeoutMs ?? 120000
  let cleanup = () => {}
  try {
    if (!extensionSDK?.oauth2Authenticate) {
      throw new Error('Looker Extension SDK oauth2Authenticate is not available.')
    }
    const authPromise = Promise.resolve(
      extensionSDK.oauth2Authenticate(
        'https://accounts.google.com/o/oauth2/v2/auth',
        {
          client_id: clientId.trim(),
          scope:
            'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever',
          response_type: 'token',
        },
        'GET'
      )
    )
    const guardPromise = new Promise<never>((_resolve, reject) => {
      let focusTimer: ReturnType<typeof setTimeout> | null = null
      const timeoutTimer = setTimeout(() => reject(new Error('Google OAuth sign-in timed out.')), timeoutMs)
      const onFocus = () => {
        if (focusTimer) clearTimeout(focusTimer)
        focusTimer = setTimeout(
          () => reject(new Error('Google OAuth popup closed or failed before completing (check Authorized redirect URIs in /config if you saw Error 400: redirect_uri_mismatch).')),
          focusReturnDelayMs
        )
      }
      const onAbort = () => reject(new Error('Google OAuth sign-in cancelled.'))
      if (options?.signal?.aborted) return onAbort()
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      if (typeof window !== 'undefined') window.addEventListener?.('focus', onFocus)
      cleanup = () => {
        clearTimeout(timeoutTimer)
        if (focusTimer) clearTimeout(focusTimer)
        options?.signal?.removeEventListener('abort', onAbort)
        if (typeof window !== 'undefined') window.removeEventListener?.('focus', onFocus)
      }
    })
    const res = (await Promise.race([authPromise, guardPromise])) as
      | { access_token?: string; id_token?: string; expires_in?: number | string }
      | undefined
    const rawToken = res?.access_token || res?.id_token
    if (!rawToken) {
      throw new Error(`Google OAuth response did not include an access_token: ${JSON.stringify(res)}`)
    }
    const token = String(rawToken).trim()
    const expiresAt =
      Date.now() + Math.max(60, (Number(res?.expires_in) || 3600) - 60) * 1000
    persistOAuthSession(extensionSDK, {
      token,
      expiresAt,
      clientId: clientId.trim(),
    })
    return token
  } finally {
    cleanup()
  }
}

export const authenticateGoogleOAuth = loginWithGoogleOAuth

export async function callInteractionsApi(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<AntigravityInteractionPayload> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${path.replace(/^\//, '')}`
  const serializedBody = body ? JSON.stringify(body) : undefined

  if (auth.mode === 'apikey' && extensionSDK?.serverProxy) {
    const proxyResp = await extensionSDK.serverProxy(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': auth.apiKey?.trim() || getGeminiSecretKeyTag(extensionSDK),
      },
      body: serializedBody,
    })
    const parsed: AntigravityInteractionPayload =
      typeof proxyResp?.body === 'string'
        ? (() => {
            try {
              return JSON.parse(proxyResp.body) as AntigravityInteractionPayload
            } catch {
              return { raw: proxyResp.body }
            }
          })()
        : ((proxyResp?.body || {}) as AntigravityInteractionPayload)
    if (!proxyResp?.ok || (proxyResp?.status && proxyResp.status >= 400)) {
      const msg = parsed?.error?.message || JSON.stringify(parsed) || `HTTP ${proxyResp?.status}`
      throw new Error(`Antigravity API error (${proxyResp?.status}): ${msg}`)
    }
    return parsed
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (auth.mode === 'oauth') {
    if (!auth.oauthToken?.trim()) {
      throw new Error('Please sign in with Google OAuth first.')
    }
    if (typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__) {
      const inputArr = Array.isArray(body?.input)
        ? (body?.input as Array<{ text?: string }>)
        : []
      const promptText = String(inputArr[0]?.text || '')
      if (promptText.includes(CONVERSATION_LABEL_REQUEST_TAG)) {
        return {
          id: 'int_mock_label',
          status: 'completed',
          output_text: sanitizeConversationLabel('', promptText),
        }
      }
      if (promptText.includes(STARTER_PROMPTS_REQUEST_TAG)) {
        const ucMatch = promptText.match(/Active useCase:\s*([^\r\n]+)/i)?.[1]?.trim() || 'auto'
        const permittedMatch = promptText
          .match(/Permitted use cases:\s*([^\r\n]+)/i)?.[1]
          ?.split(',')
          .map((s) => s.trim() as StudioUseCase)
          .filter(Boolean)
        const targetMatch = promptText.match(
          /Target explore:\s*([^\s(\r\n]+)(?:\s*\(([^)\r\n]+)\))?/i
        )
        const expKey = targetMatch?.[1]?.trim()
        const expLabel = targetMatch?.[2]?.trim()
        const parseFieldLine = (prefix: string): StarterExploreFieldSummary[] => {
          const line = promptText
            .match(new RegExp(`${prefix}:\\s*([^\\r\\n]+)`, 'i'))?.[1]
            ?.trim()
          if (!line) return []
          return line
            .split(',')
            .map((part) => {
              const m = part.trim().match(/^([^\s(]+)(?:\s*\(([^)]+)\))?$/)
              return m ? { name: m[1].trim(), label: (m[2] || m[1]).trim() } : null
            })
            .filter((x): x is StarterExploreFieldSummary => Boolean(x))
        }
        const [mName = '', eName = ''] =
          expKey && expKey !== 'none'
            ? expKey.includes('::')
              ? expKey.split('::')
              : expKey.split('/')
            : ['', '']
        const mockPrompts = buildDynamicStarterPrompts({
          useCase: ucMatch,
          selectedExplores: expKey && expKey !== 'none' ? [expKey] : [],
          permittedUseCases: permittedMatch,
          exploreContext:
            expKey && expKey !== 'none'
              ? {
                  modelName: mName,
                  modelLabel: mName,
                  exploreName: eName || expKey,
                  exploreLabel: expLabel || eName || expKey,
                  exploreKey: expKey,
                  measures: parseFieldLine('Top measures'),
                  dimensions: parseFieldLine('Top dimensions'),
                }
              : null,
        })
        return {
          id: 'int_mock_starter_prompts',
          status: 'completed',
          output_text: `<STARTER_PROMPTS>${JSON.stringify(mockPrompts)}</STARTER_PROMPTS>`,
        }
      }
      const userReqMatch = promptText.match(/User request:\s*([\s\S]*)$/i)
      const effectiveUserText = userReqMatch ? userReqMatch[1].trim() : promptText
      const inferred = extractResolvedUseCase(undefined, effectiveUserText)
      return {
        id: `int_mock_${Date.now().toString(36).slice(-5)}`,
        environment_id: `env_${inferred}_mock`,
        status: 'completed',
        output_text: `<USE_CASE>${inferred}</USE_CASE>\nRouted turn via AGENTS.md to ${inferred}.`,
      }
    }
    headers['Authorization'] = `Bearer ${auth.oauthToken.trim()}`
    if (auth.projectId?.trim()) {
      headers['x-goog-user-project'] = auth.projectId.trim()
    }
  } else {
    if (!auth.apiKey?.trim()) {
      throw new Error('Gemini API Key is not configured.')
    }
    headers['x-goog-api-key'] = auth.apiKey.trim()
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: serializedBody,
  })
  const text = await resp.text()
  let parsed: AntigravityInteractionPayload
  try {
    parsed = text ? (JSON.parse(text) as AntigravityInteractionPayload) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!resp.ok) {
    if (resp.status === 401) {
      clearStoredOAuthSession(extensionSDK)
    }
    const msg = parsed?.error?.message || text || `HTTP ${resp.status}`
    throw new Error(`Antigravity API error (${resp.status}): ${msg}`)
  }
  return parsed
}

export async function listAvailableAntigravityModels(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth
): Promise<AntigravityModelOption[]> {
  const canQuery =
    auth.mode === 'oauth'
      ? Boolean(auth.oauthToken?.trim())
      : Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)
  if (!canQuery) return ANTIGRAVITY_ALLOWED_MODELS
  try {
    const res = await callInteractionsApi(extensionSDK, auth, 'models', 'GET')
    const byId = new Map<string, { name?: string; displayName?: string; description?: string }>(
      (Array.isArray(res?.models) ? res.models : []).map((m) => [
        String(m?.name || '').replace(/^models\//, '').trim(),
        m,
      ])
    )
    const matched = ANTIGRAVITY_ALLOWED_MODELS.filter((a) => byId.has(a.id)).map((a) => {
      const m = byId.get(a.id)
      return {
        id: a.id,
        label: String(m?.displayName || a.label),
        description: String(m?.description || a.description),
      }
    })
    return matched.length > 0 ? matched : ANTIGRAVITY_ALLOWED_MODELS
  } catch {
    return ANTIGRAVITY_ALLOWED_MODELS
  }
}

function collectInteractionTextCandidates(
  interaction: AntigravityInteractionPayload | null | undefined
): string {
  const out: unknown[] = [interaction?.output_text]
  for (const o of interaction?.outputs || []) out.push(o?.text)
  for (const s of interaction?.steps || []) {
    out.push(
      s?.output,
      s?.stdout,
      s?.result,
      s?.text,
      s?.code_execution_result?.output
    )
  }
  return out.filter((x): x is string => typeof x === 'string').join('\n')
}

function extractBundleFromInteraction(
  interaction: AntigravityInteractionPayload | null | undefined
): DataAppBundle | null {
  const matches = Array.from(
    collectInteractionTextCandidates(interaction).matchAll(
      /<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/g
    )
  )
  return matches.length > 0
    ? (JSON.parse(matches[matches.length - 1][1].trim()) as DataAppBundle)
    : null
}

function extractTddFromInteraction(
  interaction: AntigravityInteractionPayload | null | undefined
): string | null {
  const combined = collectInteractionTextCandidates(interaction)
  const matches = Array.from(
    combined.matchAll(/<HEALTH_CHECK_TDD>([\s\S]*?)<\/HEALTH_CHECK_TDD>/g)
  )
  if (matches.length > 0) return matches[matches.length - 1][1].trim()
  return combined.includes('## 1. Executive Summary') && combined.includes('## 7.')
    ? combined.trim()
    : null
}

function normalizeNativeBundleCandidate(raw: unknown): NativeContentBundle | null {
  if (!raw || typeof raw !== 'object') return null
  const rawObj = raw as Record<string, unknown>
  const r =
    rawObj.NATIVE_CONTENT_BUNDLE && typeof rawObj.NATIVE_CONTENT_BUNDLE === 'object'
      ? (rawObj.NATIVE_CONTENT_BUNDLE as Record<string, unknown>)
      : rawObj
  const id =
    r.id ||
    r.lookml_dashboard_id ||
    r.dashboard_id ||
    r.look_id ||
    r.board_id
  if (!id) return null
  const strId = String(id).trim()
  const cType = (r.content_type ||
    r.contentType ||
    (r.board_id
      ? 'board'
      : r.look_id && !r.dashboard_id
      ? 'look'
      : strId.includes('::')
      ? 'lookml_dashboard'
      : 'dashboard')) as NativeContentBundle['contentType'] & string
  const folderId = r.folder_id || r.folderId ? String(r.folder_id || r.folderId) : undefined
  const embedPath = resolveNativeEmbedPath(
    cType,
    strId,
    typeof (r.embed_path || r.url) === 'string' ? String(r.embed_path || r.url) : undefined
  )
  return {
    id: strId,
    content_type: cType,
    contentType: cType,
    title: String(r.title || `Native ${cType} #${strId}`),
    folder_id: folderId,
    folderId,
    embed_path: embedPath,
    url: embedPath,
    tile_count: typeof r.tile_count === 'number' ? r.tile_count : Array.isArray(r.elements) ? r.elements.length : undefined,
    filter_count: typeof r.filter_count === 'number' ? r.filter_count : Array.isArray(r.filter_names) ? r.filter_names.length : undefined,
    schedule_id: r.schedule_id ? String(r.schedule_id) : undefined,
    look_id: r.look_id ? String(r.look_id) : undefined,
    board_id: r.board_id ? String(r.board_id) : undefined,
    lookml_dashboard_id: r.lookml_dashboard_id ? String(r.lookml_dashboard_id) : cType === 'lookml_dashboard' ? strId : undefined,
    project_id: r.project_id ? String(r.project_id) : undefined,
    model: r.model ? String(r.model) : undefined,
    file_path: r.file_path ? String(r.file_path) : undefined,
    layout_id: r.layout_id ? String(r.layout_id) : undefined,
    element_ids: Array.isArray(r.element_ids) ? r.element_ids.map(String) : undefined,
    filter_names: Array.isArray(r.filter_names) ? r.filter_names.map(String) : undefined,
    layout_component_ids:
      r.layout_component_ids && typeof r.layout_component_ids === 'object'
        ? (r.layout_component_ids as Record<string, string>)
        : undefined,
    query_cache:
      r.query_cache && typeof r.query_cache === 'object'
        ? (r.query_cache as Record<string, string>)
        : undefined,
    filter_cache:
      r.filter_cache && typeof r.filter_cache === 'object'
        ? (r.filter_cache as Record<string, string>)
        : undefined,
    summary: r.summary ? String(r.summary) : undefined,
    elements: Array.isArray(r.elements)
      ? (r.elements as NativeContentBundle['elements'])
      : undefined,
    explores: Array.isArray(r.explores) ? r.explores.map(String) : undefined,
  }
}

// ponytail: capture NATIVE_CONTENT_BUNDLE directly from run_looker_codemode return value first
// so the model never has to echo <NATIVE_CONTENT_BUNDLE>{...}</NATIVE_CONTENT_BUNDLE> in output_text.
export function extractNativeContentFromInteraction(
  interaction: AntigravityInteractionPayload | null | undefined
): NativeContentBundle | null {
  for (const step of [...(interaction?.steps || [])].reverse()) {
    if (step?.type === 'function_result' && step?.name === 'run_looker_codemode') {
      const rawStr = typeof step.result === 'string' ? step.result : JSON.stringify(step.result || '')
      const tagMatches = Array.from(
        rawStr.matchAll(/<NATIVE_CONTENT_BUNDLE>([\s\S]*?)<\/NATIVE_CONTENT_BUNDLE>/g)
      )
      if (tagMatches.length > 0) {
        try {
          const parsedTag = JSON.parse(tagMatches[tagMatches.length - 1][1].trim())
          const norm = normalizeNativeBundleCandidate(parsedTag)
          if (norm) return norm
        } catch {
          // Ignore malformed tag JSON
        }
      }
      try {
        const parsed = typeof step.result === 'string' ? JSON.parse(step.result) : step.result
        const parsedObj = parsed && typeof parsed === 'object' ? (parsed as { result?: unknown }) : undefined
        const norm = normalizeNativeBundleCandidate(parsedObj?.result ?? parsed)
        if (norm) return norm
      } catch {
        // Ignore non-JSON codemode outputs
      }
    }
  }
  const combined = collectInteractionTextCandidates(interaction)
  const matches = Array.from(
    combined.matchAll(/<NATIVE_CONTENT_BUNDLE>([\s\S]*?)<\/NATIVE_CONTENT_BUNDLE>/g)
  )
  if (matches.length > 0) {
    try {
      const parsed = JSON.parse(matches[matches.length - 1][1].trim())
      return normalizeNativeBundleCandidate(parsed) || (parsed as NativeContentBundle)
    } catch {
      // Ignore malformed tag JSON
    }
  }
  return null
}

const KNOWN_LOOKER_SDK_CALL_RE =
  /\b(?:sdk\.([a-z_][a-z0-9_]*)|(run_inline_query|run_key_driver_analysis|to_fixed_date_range|lookml_model_explore|lookml_model|all_lookml_models|search_content|search_dashboards|search_looks|create_dashboard|update_dashboard|dashboard_dashboard_layouts|update_dashboard_layout_component|create_dashboard_element|update_dashboard_element|create_dashboard_filter|update_dashboard_filter|create_query|create_look|create_board|update_board|create_board_section|create_board_item|create_scheduled_plan|upsert_udd|upsert_lookml_dashboard|reflow_24col|pin_to_board|schedule_dashboard|emit_native_bundle|validate_project|run_lookml_test|create_sql_query|run_sql_query|all_project_files|get_file_content|create_file|update_file|delete_file|create_project_directory|update_session|git_branch|import_lookml_dashboard|sync_lookml_dashboard|me|user_roles|all_folders))\s*\(/gi

const CODEMODE_MACROS = new Set([
  'upsert_udd',
  'upsert_lookml_dashboard',
  'reflow_24col',
  'pin_to_board',
  'schedule_dashboard',
  'emit_native_bundle',
  'to_fixed_date_range',
])

function extractLookerSdkMethodPreview(code: string): string {
  const seen = new Set<string>()
  for (const m of String(code || '').matchAll(KNOWN_LOOKER_SDK_CALL_RE)) {
    const name = m[1] || m[2]
    if (name) seen.add(m[1] || !CODEMODE_MACROS.has(name) ? `sdk.${name}` : name)
  }
  return Array.from(seen).join(', ')
}

function parseStepArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

export function extractThoughtText(val: unknown): string {
  if (typeof val === 'string') return val.trim()
  if (Array.isArray(val)) return val.map(extractThoughtText).filter(Boolean).join('\n\n')
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    for (const key of ['text', 'summary', 'content', 'parts']) {
      const extracted = extractThoughtText(obj[key])
      if (extracted) return extracted
    }
  }
  return ''
}

const stripThoughtHeading = (line: string): string =>
  line.trim().replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*:?\s*$|^\*\*|\*\*$/g, '$1').trim()

export function extractInteractionActivitySteps(
  interaction: AntigravityInteractionPayload | null | undefined
): AntigravityActivityStep[] {
  const rawSteps: AntigravityInteractionStep[] = Array.isArray(interaction?.steps)
    ? interaction.steps
    : []
  const rawOutputs: AntigravityInteractionOutput[] = Array.isArray(interaction?.outputs)
    ? interaction.outputs
    : []
  const completedCallIds = new Set<string>(
    rawSteps
      .filter((s) => s?.type === 'function_result' || s?.type === 'tool_result')
      .map((s) => String(s?.call_id || s?.id || '').trim())
      .filter(Boolean)
  )
  const interactionDone = /^(?:completed|failed|cancelled)$/.test(String(interaction?.status || ''))
  const byKey = new Map<string, AntigravityActivityStep>()
  const seenContent = new Set<string>()
  const seenKindTitle = new Set<string>()
  let autoIdx = 0

  const upsertStep = (step: AntigravityActivityStep, explicitId?: string) => {
    const contentKey = `${step.kind}:${step.title}:${step.detail || ''}`
    const kindTitleKey = `${step.kind}:${step.title}`
    const mapKey = explicitId || contentKey
    const existing = byKey.get(mapKey)
    if (existing) {
      if (step.status === 'done') existing.status = 'done'
      if (step.detail && !existing.detail) existing.detail = step.detail
      return
    }
    if (seenContent.has(contentKey) || (!step.detail && seenKindTitle.has(kindTitleKey))) return
    seenContent.add(contentKey)
    seenKindTitle.add(kindTitleKey)
    byKey.set(mapKey, step)
  }

  const addThought = (
    item: AntigravityInteractionStep | AntigravityInteractionOutput,
    stepId: string,
    explicitId: string | undefined,
    status: 'running' | 'done'
  ) => {
    const tObj =
      item.thought && typeof item.thought === 'object' && !Array.isArray(item.thought)
        ? (item.thought as Record<string, unknown>)
        : null
    const summary = extractThoughtText(tObj?.summary ?? item.summary)
    const text = extractThoughtText(
      tObj?.text ??
        (typeof item.thought === 'string' || Array.isArray(item.thought) ? item.thought : undefined) ??
        item.text ??
        tObj?.content ??
        item.content ??
        tObj?.parts ??
        item.parts
    )
    const raw = summary && text && summary !== text ? `${summary}\n${text}` : summary || text
    const [firstLine = '', ...restLines] = raw.split(/\r?\n/)
    const title = stripThoughtHeading(firstLine)
    if (!title) return
    const rest = restLines.join('\n').trim()
    upsertStep({ id: stepId, kind: 'thought', title, ...(rest && rest !== title ? { detail: rest } : {}), status }, explicitId)
  }

  for (let i = 0; i < rawSteps.length; i++) {
    const step = rawSteps[i]
    if (!step || typeof step !== 'object') continue
    const sType = String(step.type || '').trim()
    if (sType === 'function_result' || sType === 'tool_result') continue

    const explicitId = step.id ? String(step.id).trim() : undefined
    const stepId = explicitId || `step_${++autoIdx}`
    const isLastStep = i === rawSteps.length - 1
    const fnName = String(step.name || step.function_call?.name || '').trim()

    const resolveStatus = (isFunctionCall = false): 'running' | 'done' => {
      if (step.status === 'running' || step.status === 'in_progress') return 'running'
      if (step.status === 'done' || step.status === 'completed' || interactionDone) return 'done'
      if (isFunctionCall && explicitId) {
        if (completedCallIds.has(explicitId)) return 'done'
        if (interaction?.status === 'requires_action' || isLastStep) return 'running'
      }
      return interaction?.status === 'in_progress' && isLastStep ? 'running' : 'done'
    }

    if (
      sType === 'thought' ||
      sType === 'thinking' ||
      (step.thought && !/^(?:function_call|run_looker_codemode|lkr_cli_extension_bridge)$/.test(sType))
    ) {
      addThought(step, stepId, explicitId, resolveStatus(false))
      continue
    }

    if (
      sType === 'view_file_call' ||
      sType === 'edit_file_call' ||
      step.view_file_call ||
      step.edit_file_call ||
      (sType === 'function_call' && /^(?:view_file|edit_file|read_file|write_file)(?:_call)?$/.test(fnName))
    ) {
      const nested = step.view_file_call || step.edit_file_call || step.function_call || {}
      const args = parseStepArguments(step.arguments ?? step.args ?? nested.arguments ?? nested.args)
      const targetPath = String(
        step.path || step.file_path || step.target || nested.path || nested.file_path || nested.target || args.path || args.file_path || args.target || ''
      ).trim()
      const desc = String(step.description || nested.description || args.description || '').trim()
      const isEdit = /edit|write/.test(`${sType}:${fnName}`)
      const title = targetPath && desc ? `${targetPath} — ${desc}` : targetPath || desc || (isEdit ? 'Editing file' : 'Viewing file')
      const detail = desc || targetPath || undefined
      upsertStep({ id: stepId, kind: 'file', title, ...(detail ? { detail } : {}), status: resolveStatus(true) }, explicitId)
      continue
    }

    const skillCallRe = /^(?:skill_lookup|lookup_skill)(?:_call)?$/
    if (skillCallRe.test(sType) || step.skill_lookup_call || (sType === 'function_call' && skillCallRe.test(fnName))) {
      const nested = step.skill_lookup_call || step.function_call || {}
      const args = parseStepArguments(step.arguments ?? step.args ?? nested.arguments ?? nested.args)
      const pickName = (v: unknown) => (v && !skillCallRe.test(String(v)) ? String(v) : '')
      const skillName = String(
        step.skill || step.skill_name || nested.skill || nested.skill_name || pickName(nested.name) || args.skill || args.skill_name || pickName(args.name) || pickName(step.name) || step.target || args.target || ''
      ).trim()
      const desc = String(step.description || nested.description || args.description || '').trim()
      const title = skillName && desc ? `${skillName} — ${desc}` : skillName || desc || 'Skill lookup'
      const detail = desc || skillName || undefined
      upsertStep({ id: stepId, kind: 'skill', title, ...(detail ? { detail } : {}), status: resolveStatus(true) }, explicitId)
      continue
    }

    if (/^(?:run_looker_codemode|lkr_cli_extension_bridge)$/.test(fnName) || /^(?:run_looker_codemode|lkr_cli_extension_bridge)$/.test(sType)) {
      const isBridge = fnName === 'lkr_cli_extension_bridge' || sType === 'lkr_cli_extension_bridge'
      const args = parseStepArguments(step.arguments ?? step.args ?? step.function_call?.arguments ?? step.function_call?.args ?? step)
      const thought = extractThoughtText(args.thought ?? step.thought)
      const codeStr = String(args.code || step.code || '').trim()
      const sdkPreview = extractLookerSdkMethodPreview(codeStr)
      const firstCodeLine = codeStr.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || ''
      if (isBridge) {
        const method = String(args.method || step.method || '').trim().toUpperCase()
        const pathStr = String(args.path || step.path || '').trim()
        const methodPath = method || pathStr ? `${method || 'GET'} ${pathStr || '/'}` : ''
        const title = thought || methodPath || (sdkPreview ? `Looker CLI Bridge (${sdkPreview})` : 'Executing bridged Looker CLI request')
        const detail = methodPath || sdkPreview || (codeStr ? codeStr.split('\n')[0].trim().slice(0, 140) : undefined)
        upsertStep(
          { id: stepId, kind: 'cli_bridge', title, ...(detail ? { detail } : {}), ...(codeStr ? { language: 'PYTHON' } : {}), status: resolveStatus(true) },
          explicitId
        )
      } else {
        const title = thought || (sdkPreview ? `Looker Code Mode (${sdkPreview})` : 'Running Looker Code Mode')
        const detail = sdkPreview || (firstCodeLine ? firstCodeLine.slice(0, 140) : undefined)
        upsertStep(
          { id: stepId, kind: 'codemode', title, ...(detail ? { detail } : {}), language: 'PYTHON', status: resolveStatus(true) },
          explicitId
        )
      }
      continue
    }

    if (
      /^(?:code_execution|code_execution_call|executable_code)$/.test(sType) ||
      step.code_execution ||
      step.code_execution_call ||
      step.executable_code ||
      (sType === 'function_call' && /^(?:code_execution|bash|sh|python)(?:_call)?$/.test(fnName))
    ) {
      const nested = step.code_execution || step.code_execution_call || step.executable_code || step.function_call || {}
      const args = parseStepArguments(step.arguments ?? step.args ?? nested.arguments ?? nested.args)
      const rawCode = String(step.code ?? step.command ?? nested.code ?? nested.command ?? args.code ?? args.command ?? step.input ?? '').trim()
      const rawLang = String(step.language ?? nested.language ?? args.language ?? '').trim().toUpperCase()
      const language =
        rawLang.includes('PYTHON') || rawLang === 'PY' || fnName === 'python'
          ? 'PYTHON'
          : rawLang.includes('BASH') || rawLang.includes('SH') || fnName === 'bash'
          ? 'BASH'
          : /^(?:import\s+\w|from\s+\w+\s+import\s+|def\s+\w)/m.test(rawCode) && !/^(?:python3?|uv|lkr|bash|sh)\b/.test(rawCode)
          ? 'PYTHON'
          : 'BASH'
      const firstLine = rawCode.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || rawCode
      const conciseCmd =
        firstLine.replace(/\s*<<\s*['"]?\w+['"]?.*$/, '').trim().slice(0, 140) ||
        (language === 'PYTHON' ? 'Running Python script' : 'Running sandbox command')
      const detail = rawCode ? rawCode.split('\n').slice(0, 3).join('\n').slice(0, 200) : undefined
      upsertStep(
        { id: stepId, kind: 'code_execution', title: conciseCmd, ...(detail ? { detail } : {}), language, status: resolveStatus(false) },
        explicitId
      )
    }
  }

  for (const out of rawOutputs) {
    if (out && typeof out === 'object' && (out.type === 'thought' || out.type === 'thinking' || out.thought)) {
      const outId = out.id ? String(out.id) : undefined
      addThought(out, outId || `step_${++autoIdx}`, outId, interactionDone ? 'done' : 'running')
    }
  }

  return Array.from(byKey.values())
}

function summarizeProgress(interaction: AntigravityInteractionPayload | null | undefined): string {
  const steps = interaction?.steps || []
  if (steps.length === 0) return `Status: ${interaction?.status || 'starting'}...`
  const last = steps[steps.length - 1]
  if (last.type === 'function_call') {
    const args = parseStepArguments(last.arguments ?? last.args)
    const thought = extractThoughtText(args.thought)
    if (thought) return thought
    return `Running tool: ${last.name || 'sandbox command'}...`
  }
  if (last.type === 'thought' || last.type === 'thinking' || last.thought) {
    const tObj =
      last.thought && typeof last.thought === 'object' && !Array.isArray(last.thought)
        ? (last.thought as Record<string, unknown>)
        : null
    const raw = extractThoughtText(tObj?.summary ?? last.summary ?? last.thought ?? last)
    return stripThoughtHeading(raw.split(/\r?\n/)[0] || '') || 'Agent is reasoning...'
  }
  return `Step ${steps.length} (${last.type || interaction?.status})...`
}

function extractInteractionTelemetry(
  interaction: AntigravityInteractionPayload | null | undefined,
  stats: {
    agentWallMs: number
    pollWaitMs: number
    pollCount: number
    codemodeExecMs: number
    lookerHttpMs: number
    codemodeCalls: number
    lookerHttpCalls: number
    apiRetries: number
  }
): AntigravityTurnTelemetry {
  const steps: AntigravityInteractionStep[] = interaction?.steps || []
  const bashCalls = steps.filter(
    (s) =>
      s?.type === 'code_execution' ||
      s?.type === 'executable_code' ||
      (s?.type === 'function_call' && s?.name !== 'run_looker_codemode')
  ).length
  const verifyRetries = steps.filter((s) =>
    /"stage":\s*"(?:syntax|safety|widget_extraction)"/.test(
      String(s?.output || s?.stderr || s?.result || '')
    )
  ).length
  const usage = interaction?.usage || interaction?.usage_metadata || {}
  return {
    agent_wall_ms: stats.agentWallMs,
    poll_wait_ms: stats.pollWaitMs,
    poll_count: stats.pollCount,
    codemode_exec_ms: stats.codemodeExecMs,
    looker_http_ms: stats.lookerHttpMs,
    tool_calls: {
      bash: bashCalls || Number(interaction?.bash_calls || 0),
      codemode: stats.codemodeCalls,
      looker_http: stats.lookerHttpCalls,
    },
    tokens: {
      input: Number(usage.input_tokens ?? usage.prompt_token_count ?? 0),
      output: Number(usage.output_tokens ?? usage.candidates_token_count ?? 0),
      thought: Number(usage.thought_tokens ?? usage.thoughts_token_count ?? 0),
    },
    verify_retries: verifyRetries,
    api_retries: stats.apiRetries + verifyRetries,
  }
}

export function buildWorkspaceSources(params: {
  schemaMarkdown: string
  appFilePath?: string
  existingAppCode?: string
  cachedExploreSchemas?: Record<string, unknown>
  extraSources?: Array<{ type: 'inline'; content: string; target: string }>
}): Array<{ type: 'inline'; content: string; target: string }> {
  const {
    schemaMarkdown,
    appFilePath = '/workspace/apps/current/app.js',
    existingAppCode,
    cachedExploreSchemas,
    extraSources,
  } = params
  return [
    { type: 'inline', content: AGENTS_MD, target: '/workspace/AGENTS.md' },
    { type: 'inline', content: schemaMarkdown, target: '/workspace/schema.md' },
    { type: 'inline', content: BUNDLE_APP_PY, target: '/workspace/bundle_app.py' },
    { type: 'inline', content: DATA_APP_GUIDE_MD, target: '/workspace/DATA_APP_GUIDE.md' },
    { type: 'inline', content: DATA_INVESTIGATOR_GUIDE_MD, target: '/workspace/DATA_INVESTIGATOR_GUIDE.md' },
    { type: 'inline', content: BOOTSTRAP_LOOKML_PY, target: '/workspace/bootstrap_lookml.py' },
    { type: 'inline', content: LKR_CLI_SITECUSTOMIZE_PY, target: '/workspace/sitecustomize.py' },
    {
      type: 'inline',
      content: JSON.stringify(cachedExploreSchemas || {}),
      target: '/workspace/.lkr_extension_cache/explore_schemas.json',
    },
    ...(extraSources || []),
    ...(existingAppCode ? [{ type: 'inline' as const, content: existingAppCode, target: appFilePath }] : []),
  ]
}

async function persistUserEnvIfChanged(params: {
  sdk?: Looker40SDK
  extensionSDK?: AntigravityExtensionHostLike
  userId?: string
  previousEnvId?: string
  nextEnvId?: string
  onEnvironmentUpdated?: (environmentId: string) => void | Promise<void>
}): Promise<void> {
  const next = normalizeEnvironmentId(params.nextEnvId)
  if (!next || next === normalizeEnvironmentId(params.previousEnvId)) return
  await params.onEnvironmentUpdated?.(next)
  if (params.sdk && typeof (params.sdk as Partial<Looker40SDK>).update_artifacts === 'function') {
    let uid = String(params.userId || '').trim()
    if (!uid && typeof (params.sdk as Partial<Looker40SDK>).me === 'function') {
      try {
        const me = await (params.sdk.ok ? params.sdk.ok(params.sdk.me('id')) : params.sdk.me('id'))
        uid = String((me as { id?: string | number } | undefined)?.id || '').trim()
      } catch {
        // Ignore error resolving user ID
      }
    }
    if (uid) await saveUserEnvironmentId(params.sdk, uid, next, getArtifactNamespace(params.extensionSDK))
  }
}

export interface RunAntigravityTurnOptions {
  sdk: Looker40SDK
  extensionSDK?: AntigravityExtensionHostLike
  userId?: string
  environmentId?: string
  conversationId?: string
  onEnvironmentUpdated?: (environmentId: string) => void | Promise<void>
  auth: AntigravityAuth
  session: AgentSession
  model?: string
  mode?: 'data_app' | 'dashboard'
  useCase?: StudioUseCase
  allowedModes?: string[]
  selectedExplores: string[]
  folderId?: string
  toolMode?: 'data_app' | 'lookml'
  lookmlProjectId?: string
  activatedLookmlSkills?: string[]
  developableProjects?: string[]
  canDeploy?: boolean
  schemaMarkdown: string
  userPrompt: string
  images?: PastedImage[]
  existingAppCode?: string
  existingNativeContent?: NativeContentState | NativeContentBundle | null
  customSystemGuide?: string
  extraSources?: Array<{ type: 'inline'; content: string; target: string }>
  priorMessages?: Array<{ role: string; text: string }>
  requirePermission?: boolean
  approvedOperations?: Set<string>
  onPermissionRequest?: (
    req: CodeModePermissionRequest
  ) => Promise<CodeModePermissionDecision>
  onRequestWritePermission?: (
    req: CodeModePermissionRequest
  ) => Promise<CodeModePermissionDecision>
  onProgressSteps?: (steps: AntigravityActivityStep[]) => void
  pollScheduleMs?: number[]
  onStatus: (statusText: string) => void
}

export interface AntigravityTurnResult {
  bundle: DataAppBundle | null
  nativeBundle: NativeContentBundle | null
  lookmlBundle?: LookmlBundle | null
  tddMarkdown: string | null
  assistantText: string
  resolvedUseCase: ResolvedStudioUseCase
  session: AgentSession
  telemetry: AntigravityTurnTelemetry
  activitySteps?: AntigravityActivityStep[]
  thinkingDurationSec?: number
}

export async function runAntigravityTurn(
  params: RunAntigravityTurnOptions
): Promise<AntigravityTurnResult> {
  const turnStartMs = Date.now()
  let pollWaitMs = 0
  let pollCount = 0
  let codemodeExecMs = 0
  let lookerHttpMs = 0
  let codemodeCalls = 0
  let lookerHttpCalls = 0
  let apiRetries = 0

  const {
    sdk,
    extensionSDK,
    userId,
    environmentId,
    conversationId: rawConversationId,
    onEnvironmentUpdated,
    auth,
    session,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    mode = 'data_app',
    useCase = 'auto',
    allowedModes,
    selectedExplores,
    folderId,
    toolMode = 'data_app',
    lookmlProjectId,
    activatedLookmlSkills,
    developableProjects,
    canDeploy,
    schemaMarkdown,
    userPrompt,
    images,
    existingAppCode,
    existingNativeContent,
    customSystemGuide,
    extraSources,
    priorMessages,
    requirePermission = true,
    approvedOperations,
    onPermissionRequest,
    onRequestWritePermission,
    onProgressSteps,
    pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS,
    onStatus,
  } = params

  const effectivePermissionHandler = onPermissionRequest || onRequestWritePermission

  const firstParsed = selectedExplores[0] ? parseExploreId(selectedExplores[0]) : null
  const primaryModel = firstParsed?.modelName || ''
  const primaryExplore = firstParsed?.exploreName || ''

  const effectiveToolType: AntigravityToolType =
    toolMode === 'lookml'
      ? 'lookml'
      : customSystemGuide?.includes('3-Pillar')
      ? 'health'
      : customSystemGuide?.includes('codemode-script-tile')
      ? 'tile'
      : mode === 'dashboard'
      ? 'dashboard'
      : 'app'

  const isDashboardMode = effectiveToolType === 'dashboard'

  const conversationId =
    String(rawConversationId || session.conversationId || session.objectId || 'current')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_') || 'current'
  const appDir = `/workspace/apps/${conversationId}`
  const appFilePath = `${appDir}/app.js`

  const initialEnvId = normalizeEnvironmentId(environmentId || session.environmentId)
  let activeEnvId = initialEnvId
  const userProvisionKey = resolveUserProvisionKey(userId, auth)
  if (activeEnvId && schemaMarkdown && selectedExplores.length > 0) {
    for (const expKey of selectedExplores) {
      recordSharedEnvExploreSchema(activeEnvId, expKey, schemaMarkdown)
    }
  }

  // ponytail: decouple container state (environmentId) from conversation history (lastInteractionId).
  // A single per-user environmentId is shared across conversations and tool modes, while
  // previous_interaction_id stays strictly scoped to the active conversation.
  const isFreshConversation =
    !session.lastInteractionId ||
    Boolean(session.toolType && session.toolType !== effectiveToolType) ||
    (Array.isArray(session.explores) &&
      session.explores.length > 0 &&
      JSON.stringify(session.explores) !== JSON.stringify(selectedExplores))

  const exploreDirective =
    selectedExplores.length > 0
      ? `for selected Looker explore(s): ${selectedExplores.map((id) => `"${id}"`).join(', ')}.`
      : `where no explore was pre-selected — YOU decide which Looker explore(s) ("model_id::explore_id") from /workspace/schema.md best fit the user's request.`

  const step2Directive =
    selectedExplores.length > 0
      ? `2. Read /workspace/schema.md for the compiled Looker Explore schema(s) and sample rows. You also have \`run_looker_codemode\` (WASM Monty Python sandbox with \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel}", and \`target_explore\`="${primaryExplore}" pre-injected, plus Looker 4.0 SDK globals \`lookml_model_explore\`, \`run_inline_query\`, \`search_content\`; always pass a concise 1-sentence \`thought\` string) if you need additional sample queries.`
      : `2. Pick the best \`model_id::explore_id\` from /workspace/schema.md and run ONE \`run_looker_codemode\` Python snippet (always passing a concise 1-sentence \`thought\` description) that resolves discovery + schema + 5-row sample in a single call:
\`\`\`python
m, e = "thelook", "order_items"  # or best model/explore from /workspace/schema.md matching search_content(terms="...")
exp = lookml_model_explore(m, e, fields="name,label,fields(dimensions(name,label,type),measures(name,label,type))")
dims = [d["name"] for d in (exp.get("fields", {}).get("dimensions") or [])]
meas = [x["name"] for x in (exp.get("fields", {}).get("measures") or [])]
sample = run_inline_query("json", {"model": m, "view": e, "fields": dims[:2] + meas[:2], "limit": "5"})
return {"model": m, "explore": e, "dimensions": dims, "measures": meas, "sample": sample}
\`\`\``

  const ctorHint =
    selectedExplores.length === 1
      ? `with \`this.lookerModel = '${primaryModel}'\` and \`this.explore = '${primaryExplore}'\` in \`constructor()\``
      : `setting \`this.lookerModel\` and \`this.explore\` in \`constructor()\``
  const step3Directive = `3. Write and bundle the Lit Data App in ONE \`code_execution\` call importing from '/runtime/data-app.js' (${ctorHint}) into \`${appFilePath}\`:\n   \`python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\\n...\\nEOF\``

  const normalizedExistingNative: NativeContentState | null = existingNativeContent
    ? normalizeNativeContent({
        ...existingNativeContent,
        folderId:
          (existingNativeContent as Partial<NativeContentState & NativeContentBundle>).folderId ||
          (existingNativeContent as Partial<NativeContentState & NativeContentBundle>).folder_id ||
          folderId ||
          '1',
      })
    : null

  const isDataInvestigatorTurn =
    useCase === 'data-investigator' ||
    (useCase === 'auto' &&
      extractResolvedUseCase('', userPrompt, allowedModes) === 'data-investigator')

  const dataAppOrNativeGuide =
    mode === 'dashboard'
      ? buildNativeContentGuide({
          selectedExplores,
          primaryModel,
          primaryExplore,
          folderId: folderId || '1',
          lookmlProjectId: lookmlProjectId || '',
          existingNativeContent: normalizedExistingNative,
        })
      : [
          `You are building a Looker ${isDataInvestigatorTurn ? 'Data Investigator Narrative Data App' : 'Data App'} (Lit web component using Looker's data-app.js runtime) ${exploreDirective}`,
          `Follow these exact steps inside your Linux sandbox:`,
          `1. /workspace/DATA_APP_GUIDE.md${isDataInvestigatorTurn ? ' and /workspace/DATA_INVESTIGATOR_GUIDE.md are' : ' is'} pre-loaded with component contracts (<app-kpi>, <app-chart>, <app-grid>, <app-select>), .da-* layout classes, dark mode (this.isDark), and static widget extraction rules. Do NOT download toolkits or read external skill directories.`,
          ...(isDataInvestigatorTurn ? [DATA_INVESTIGATOR_GUIDE_MD] : []),
          step2Directive,
          step3Directive,
          `4. If bundle_app.py reports any syntax or tile safety violation, fix ${appFilePath} and re-run \`python3 /workspace/bundle_app.py ${appFilePath} "<App Title>"\` until it exits 0.`,
          `5. CRITICAL: bundle_app.py prints \`<DATA_APP_BUNDLE>...</DATA_APP_BUNDLE>\` directly to stdout, which the host captures automatically from tool output. NEVER echo or repeat \`<DATA_APP_BUNDLE>\` or raw JavaScript code in your final text reply—respond with a concise 1–2 sentence summary only.`,
        ].join('\n')

  const systemGuide =
    customSystemGuide ||
    (toolMode === 'lookml'
      ? buildLookmlSystemGuide({
          selectedExplores,
          primaryModel,
          primaryExplore,
          projectId: lookmlProjectId,
          activatedSkills: activatedLookmlSkills,
          developableProjects,
          canDeploy,
        })
      : dataAppOrNativeGuide)

  const uploadSources: Array<{ type: 'inline'; content: string; target: string }> = []
  const uploadedFileNotices: string[] = []
  for (let i = 0; i < (images || []).length; i += 1) {
    const file = images![i]
    const fallbackExt = file.mimeType.startsWith('image/')
      ? `.${file.mimeType.split('/')[1] || 'png'}`
      : file.mimeType === 'application/pdf'
      ? '.pdf'
      : '.txt'
    const rawName = file.name || `attachment_${i + 1}${fallbackExt}`
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const targetPath = `/workspace/uploads/${safeName}`
    uploadSources.push({
      type: 'inline',
      target: targetPath,
      content: file.textContent !== undefined ? file.textContent : file.dataUrl || file.data,
    })
    uploadedFileNotices.push(
      `- \`${targetPath}\` (${file.mimeType}${file.size ? `, ${file.size} bytes` : ''})`
    )
  }

  const sources = buildWorkspaceSources({
    schemaMarkdown,
    appFilePath,
    existingAppCode: mode === 'data_app' ? existingAppCode : undefined,
    cachedExploreSchemas: getSharedEnvExploreSchemas(activeEnvId),
    extraSources: [...(extraSources || []), ...uploadSources],
  })

  // ponytail: disable remote container code_execution in /dashboard mode so all UDD + .dashboard.lookml
  // operations run directly in browser/extension WASM Monty CodeMode with zero bash container overhead.
  const activeTools = isDashboardMode
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    : [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]

  const historyDigest =
    priorMessages && priorMessages.length > 0
      ? `\n\nPrior conversation context:\n${priorMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-40)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
          .join('\n')}`
      : ''

  const warmTurnDirective =
    mode === 'data_app' && toolMode !== 'lookml'
      ? `[WARM SANDBOX FAST PATH: ${appFilePath} and the discovered Looker schema are already in /workspace. Do NOT re-run run_looker_codemode discovery or re-read guides unless a brand-new explore is requested. Update ${appFilePath} and bundle in ONE code_execution call via: python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\n...\nEOF\nNEVER echo <DATA_APP_BUNDLE> in your text reply.]\n\n`
      : isDashboardMode && normalizedExistingNative
      ? `[WARM CONTENT STUDIO FAST PATH: Active Looker ${normalizedExistingNative.contentType} id="${normalizedExistingNative.id}" ("${normalizedExistingNative.title}") and pre-hydrated active_content (element_ids=${JSON.stringify(normalizedExistingNative.elementIds || [])}, filter_names=${JSON.stringify(normalizedExistingNative.filterNames || [])}, lookml_dashboard_id="${normalizedExistingNative.lookmlDashboardId || ''}", project_id="${normalizedExistingNative.projectId || lookmlProjectId || ''}") are pre-injected in run_looker_codemode vars. Execute the update in ONE run_looker_codemode call using upsert_udd / upsert_lookml_dashboard / reflow_24col / pin_to_board / schedule_dashboard + return emit_native_bundle(...). NEVER echo <NATIVE_CONTENT_BUNDLE> in your text reply.]\n\n`
      : ''

  const autoRoutingDirective =
    useCase === 'auto'
      ? `\n\n[AUTO USE-CASE ROUTING: Consult /workspace/AGENTS.md ("## Use Case Auto-Classification (Turn 1 Routing)"). Allowed use cases for this user: ${JSON.stringify(
          allowedModes && allowedModes.length > 0
            ? allowedModes
            : [
                'app',
                'data-investigator',
                'dashboard',
                'lookml',
                'health-check',
                'tile',
                'conversational-analytics',
              ]
        )}. Start your response with <USE_CASE>...</USE_CASE> naming the single best allowed use case for this request, then execute that workflow.]`
      : ''

  const uploadsSection =
    uploadedFileNotices.length > 0
      ? `\n\nAttached files in /workspace/uploads:\n${uploadedFileNotices.join('\n')}`
      : ''

  const buildInputItems = (fresh: boolean): Array<Record<string, unknown>> => [
    {
      type: 'text',
      text: fresh
        ? `${systemGuide}${autoRoutingDirective}${historyDigest}\n\nUser request:\n${userPrompt}${uploadsSection}`
        : `${warmTurnDirective}${autoRoutingDirective ? `${autoRoutingDirective.trim()}\n\n` : ''}User request:\n${userPrompt}${uploadsSection}`,
    },
    ...(images || [])
      .filter((img) => img.mimeType.startsWith('image/') || img.mimeType === 'application/pdf')
      .map((img) => ({
        type: img.mimeType === 'application/pdf' ? 'document' : 'image',
        mime_type: img.mimeType,
        data: img.data,
      })),
  ]

  const activeModel = model || DEFAULT_ANTIGRAVITY_MODEL
  const agentConfig = { type: 'antigravity', model: activeModel }

  const buildFreshPayload = (): Record<string, unknown> => ({
    agent: 'antigravity-preview-09-2026',
    agent_config: agentConfig,
    background: true,
    tools: activeTools,
    input: buildInputItems(true),
    environment: { type: 'remote', sources },
  })

  const provisionFreshEnvironmentInteraction = async (): Promise<AntigravityInteractionPayload> => {
    let resolveEnv!: (envId: string) => void
    let rejectEnv!: (err: unknown) => void
    const envPromise = new Promise<string>((res, rej) => {
      resolveEnv = res
      rejectEnv = rej
    })
    envPromise.catch(() => {})
    inFlightEnvProvisionByUser.set(userProvisionKey, envPromise)
    try {
      const created = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', buildFreshPayload())
      resolveEnv(normalizeEnvironmentId(created?.environment_id) || '')
      return created
    } catch (err) {
      rejectEnv(err)
      throw err
    } finally {
      if (inFlightEnvProvisionByUser.get(userProvisionKey) === envPromise) {
        inFlightEnvProvisionByUser.delete(userProvisionKey)
      }
    }
  }

  onStatus('Starting Antigravity sandbox interaction...')
  if (!activeEnvId && inFlightEnvProvisionByUser.has(userProvisionKey)) {
    try {
      const coalescedId = normalizeEnvironmentId(await inFlightEnvProvisionByUser.get(userProvisionKey)!)
      if (coalescedId) activeEnvId = coalescedId
    } catch {
      // Ignore coalesced provisioning failure
    }
  }

  let interaction: AntigravityInteractionPayload
  if (activeEnvId || (!isFreshConversation && session.lastInteractionId)) {
    try {
      interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        agent: 'antigravity-preview-09-2026',
        agent_config: agentConfig,
        background: true,
        tools: activeTools,
        input: buildInputItems(isFreshConversation),
        environment: activeEnvId || 'remote',
        ...(isFreshConversation ? {} : { previous_interaction_id: session.lastInteractionId }),
      })
    } catch (err) {
      if (activeEnvId && !isEnvironmentNotFoundError(err) && isFreshConversation) throw err
      // ponytail: if stored environmentId returned 404 (Environment '<env_id>' not found) or
      // resumed conversation expired, spin up a fresh remote environment seeded with sources.
      apiRetries += 1
      onStatus('Resumed sandbox expired; provisioning fresh sandbox with app state...')
      interaction = await provisionFreshEnvironmentInteraction()
    }
  } else {
    interaction = await provisionFreshEnvironmentInteraction()
  }
  let trackedEnvId: string | undefined =
    normalizeEnvironmentId(interaction.environment_id) || activeEnvId
  if (trackedEnvId && schemaMarkdown && selectedExplores.length > 0) {
    for (const expKey of selectedExplores) {
      recordSharedEnvExploreSchema(trackedEnvId, expKey, schemaMarkdown)
    }
  }
  await persistUserEnvIfChanged({
    sdk,
    extensionSDK,
    userId,
    previousEnvId: initialEnvId,
    nextEnvId: trackedEnvId,
    onEnvironmentUpdated,
  })

  let pollIdx = 0
  let prevStepCount = (interaction.steps || []).length
  let prevStatus = interaction.status
  const resolvedBridgeCacheKeys = new Set<string>()
  const accumulatedSteps: AntigravityInteractionStep[] = []
  let bridgeRound = 0

  const n = normalizedExistingNative
  const activeContentVars = n
    ? {
        ...n,
        content_type: n.contentType,
        folder_id: n.folderId,
        lookml_dashboard_id: n.lookmlDashboardId,
        projectId: n.projectId || lookmlProjectId || '',
        project_id: n.projectId || lookmlProjectId || '',
        model: n.model || primaryModel,
        file_path: n.filePath,
        look_id: n.lookId,
        board_id: n.boardId,
        schedule_id: n.scheduleId,
        layout_id: n.layoutId,
        element_ids: n.elementIds || [],
        filter_names: n.filterNames || [],
        layout_component_ids: n.layoutComponentIds || {},
        query_cache: n.queryCache || {},
        filter_cache: n.filterCache || {},
        explores: selectedExplores,
      }
    : null
  const defaultCodeModeVars: Record<string, unknown> = {
    target_explores: selectedExplores,
    target_model: primaryModel,
    target_explore: primaryExplore,
    target_folder_id: folderId || '1',
    target_project_id: lookmlProjectId || normalizedExistingNative?.projectId || '',
    cached_explore_schemas: getSharedEnvExploreSchemas(trackedEnvId),
    ...(activeContentVars
      ? {
          active_content: activeContentVars,
          active_dashboard_state: activeContentVars,
        }
      : {}),
  }

  const turnSdk = createDeduplicatedLookerSdkProxy(sdk, (res, elapsedMs, err) => {
    lookerHttpCalls += 1
    lookerHttpMs += elapsedMs
    if (err || (res && (res.ok === false || Number(res.statusCode) >= 400))) apiRetries += 1
  })
  const envSlotKey = normalizeEnvironmentId(trackedEnvId) || 'remote'
  const envConcurrencySlot = activeInteractionsByEnv.get(envSlotKey) || 0
  activeInteractionsByEnv.set(envSlotKey, envConcurrencySlot + 1)

  const emitProgressSteps = (
    currInteraction: AntigravityInteractionPayload
  ): AntigravityActivityStep[] => {
    const merged =
      accumulatedSteps.length > 0
        ? { ...currInteraction, steps: [...accumulatedSteps, ...(currInteraction?.steps || [])] }
        : currInteraction
    const steps = extractInteractionActivitySteps(merged)
    if (steps.length > 0) {
      onProgressSteps?.(steps)
    }
    return steps
  }

  try {
    for (;;) {
      while (
        interaction.status === 'in_progress' ||
        interaction.status === 'requires_action' ||
        interaction.status === 'queued'
      ) {
        if (interaction.environment_id) {
          trackedEnvId = interaction.environment_id
        }
        emitProgressSteps(interaction)
        if (interaction.status === 'requires_action') {
          const steps = interaction.steps || []
          const executedIds = new Set(
            steps
              .filter((s: AntigravityInteractionStep) => s.type === 'function_result')
              .map((s: AntigravityInteractionStep) => s.call_id)
          )
          const pendingLookerCalls = steps.filter(
            (s: AntigravityInteractionStep) =>
              s.type === 'function_call' &&
              (s.name === 'run_looker_codemode' || s.name === 'lkr_cli_extension_bridge') &&
              !executedIds.has(s.id)
          )

          if (pendingLookerCalls.length > 0) {
            const firstThought = pendingLookerCalls
              .map((c: AntigravityInteractionStep) =>
                String(parseStepArguments(c.arguments ?? c.args).thought || '').trim()
              )
              .find(Boolean)
            onStatus(firstThought || 'Running Looker Code Mode (WASM Monty sandbox) in extension...')
            const cmStart = Date.now()
            codemodeCalls += pendingLookerCalls.length
            const resultsInput = await Promise.all(
              pendingLookerCalls.map(async (call: AntigravityInteractionStep) => {
                const args = parseStepArguments(call.arguments ?? call.args)
                const callThought =
                  (typeof args.thought === 'string' && args.thought.trim()) ||
                  (call.name === 'lkr_cli_extension_bridge' && (args.method || args.path)
                    ? `${String(args.method || 'GET').toUpperCase()} ${String(args.path || '/')}`
                    : undefined)
                const wrappedPermissionRequest = effectivePermissionHandler
                  ? (permReq: CodeModePermissionRequest) =>
                      effectivePermissionHandler({
                        ...permReq,
                        ...(permReq.thought || callThought ? { thought: permReq.thought || callThought } : {}),
                      })
                  : undefined
                let codeModeOutput: string
                try {
                  if (call.name === 'lkr_cli_extension_bridge') {
                    const bridged = await executeLkrExtensionToolRequest({
                      sdk: turnSdk,
                      req: args as unknown as LkrExtensionToolRequest,
                      defaultVars: defaultCodeModeVars,
                      extensionSDK,
                      requirePermission,
                      approvedOperations,
                      onPermissionRequest: wrappedPermissionRequest,
                    })
                    resolvedBridgeCacheKeys.add(bridged.cacheKey)
                    codeModeOutput = JSON.stringify({
                      ok: true,
                      cache_key: bridged.cacheKey,
                      cache_path: `/workspace/.lkr_extension_cache/${bridged.cacheKey}.json`,
                      result: bridged.result,
                    })
                  } else {
                    const customVars =
                      args.vars && typeof args.vars === 'object' && !Array.isArray(args.vars)
                        ? (args.vars as Record<string, unknown>)
                        : {}
                    const rawCode = String(args.code || '')
                    codeModeOutput = await LkrCodeMode.runPythonCode({
                      code: isDashboardMode ? wrapDashboardCodeMode(rawCode) : rawCode,
                      sdk: turnSdk,
                      extensionSDK,
                      allowUpdateSession: toolMode === 'lookml' || mode === 'dashboard',
                      requirePermission,
                      approvedOperations,
                      onPermissionRequest: wrappedPermissionRequest,
                      vars: {
                        ...defaultCodeModeVars,
                        ...customVars,
                      },
                    })
                  }
                } catch (err: unknown) {
                  apiRetries += 1
                  const errMsg = err instanceof Error ? err.message : String(err)
                  codeModeOutput = JSON.stringify({
                    ok: false,
                    error: errMsg,
                  })
                }
                return {
                  type: 'function_result',
                  name: call.name || 'run_looker_codemode',
                  call_id: call.id,
                  result: codeModeOutput,
                }
              })
            )
            codemodeExecMs += Date.now() - cmStart

            interaction = await callInteractionsApi(
              extensionSDK,
              auth,
              'interactions',
              'POST',
              {
                agent: 'antigravity-preview-09-2026',
                agent_config: agentConfig,
                background: true,
                environment: interaction.environment_id || trackedEnvId || 'remote',
                previous_interaction_id: interaction.id,
                tools: activeTools,
                input: resultsInput,
              }
            )
            if (interaction.environment_id) {
              trackedEnvId = interaction.environment_id
            }
            pollIdx = 0
            prevStepCount = (interaction.steps || []).length
            prevStatus = interaction.status
            continue
          }
        }

        onStatus(summarizeProgress(interaction))
        const schedule = resolveAdaptivePollScheduleMs(pollScheduleMs, trackedEnvId, envConcurrencySlot)
        const sleepMs = schedule[Math.min(pollIdx, schedule.length - 1)]
        pollIdx += 1
        pollCount += 1
        pollWaitMs += sleepMs
        if (sleepMs > 0) {
          await new Promise((r) => setTimeout(r, sleepMs))
        }
        interaction = await callInteractionsApi(
          extensionSDK,
          auth,
          `interactions/${encodeURIComponent(interaction.id)}`,
          'GET'
        )
        if (interaction.environment_id) {
          trackedEnvId = interaction.environment_id
        }
        const curStepCount = (interaction.steps || []).length
        if (curStepCount !== prevStepCount || interaction.status !== prevStatus) {
          pollIdx = 0
          prevStepCount = curStepCount
          prevStatus = interaction.status
        }
      }

      if (interaction.status === 'failed' || interaction.status === 'cancelled') {
        throw new Error(
          `Antigravity interaction ${interaction.status}: ${
            interaction.error?.message || JSON.stringify(interaction.error || interaction)
          }`
        )
      }

      const hasFinalBundle = Boolean(
        extractBundleFromInteraction(interaction) ||
          extractNativeContentFromInteraction(interaction) ||
          extractLookmlBundleFromInteraction(interaction) ||
          extractTddFromInteraction(interaction)
      )
      const pendingBridgeReqs = extractLkrExtensionToolRequests(interaction).filter(
        (r) => !resolvedBridgeCacheKeys.has(r.cache_key || computeLkrExtensionCacheKey(r))
      )

      if (!hasFinalBundle && pendingBridgeReqs.length > 0 && bridgeRound < 8) {
        bridgeRound += 1
        accumulatedSteps.push(...(interaction.steps || []))
        const firstBridgeThought = pendingBridgeReqs.map((r) => r.thought).find(Boolean)
        onStatus(
          firstBridgeThought || 'Executing bridged lkr-dev-cli request(s) in Looker extension...'
        )
        const bridgeStart = Date.now()
        const bridgedLines: string[] = []
        for (const req of pendingBridgeReqs) {
          if (req.kind !== 'sdk_request') codemodeCalls += 1
          try {
            const { cacheKey, result } = await executeLkrExtensionToolRequest({
              sdk: turnSdk,
              req,
              defaultVars: defaultCodeModeVars,
              extensionSDK,
              requirePermission,
              approvedOperations,
              onPermissionRequest: effectivePermissionHandler,
            })
            resolvedBridgeCacheKeys.add(cacheKey)
            bridgedLines.push(`/workspace/.lkr_extension_cache/${cacheKey}.json\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``)
          } catch (err: unknown) {
            apiRetries += 1
            const cacheKey = req.cache_key || computeLkrExtensionCacheKey(req)
            resolvedBridgeCacheKeys.add(cacheKey)
            const errMsg = err instanceof Error ? err.message : String(err)
            bridgedLines.push(`/workspace/.lkr_extension_cache/${cacheKey}.json\n\`\`\`json\n${JSON.stringify({ ok: false, error: errMsg })}\n\`\`\``)
          }
        }
        codemodeExecMs += Date.now() - bridgeStart

        const seedText = [
          '[LKR_EXTENSION_BRIDGE_RESULT] Executed online lkr-dev-cli request(s) in the host Looker Extension.',
          'Write the resolved JSON payload(s) below to /workspace/.lkr_extension_cache/ and re-run your sandbox command so it hits the local cache and completes:',
          ...bridgedLines,
        ].join('\n\n')

        interaction = await callInteractionsApi(
          extensionSDK,
          auth,
          'interactions',
          'POST',
          {
            agent: 'antigravity-preview-09-2026',
            agent_config: agentConfig,
            background: true,
            environment: interaction.environment_id || trackedEnvId || 'remote',
            previous_interaction_id: interaction.id,
            tools: activeTools,
            input: [{ type: 'text', text: seedText }],
          }
        )
        if (interaction.environment_id) {
          trackedEnvId = interaction.environment_id
        }
        pollIdx = 0
        prevStepCount = (interaction.steps || []).length
        prevStatus = interaction.status
        continue
      }

      break
    }
  } finally {
    const remaining = (activeInteractionsByEnv.get(envSlotKey) || 1) - 1
    if (remaining <= 0) activeInteractionsByEnv.delete(envSlotKey)
    else activeInteractionsByEnv.set(envSlotKey, remaining)
  }

  if (accumulatedSteps.length > 0) {
    interaction = {
      ...interaction,
      steps: [...accumulatedSteps, ...(interaction.steps || [])],
    }
  }

  const activitySteps = extractInteractionActivitySteps({
    ...interaction,
    status: 'completed',
  }).map((s) => ({ ...s, status: 'done' as const }))
  if (activitySteps.length > 0) {
    onProgressSteps?.(activitySteps)
  }
  const thinkingDurationSec = Math.max(1, Math.round((Date.now() - turnStartMs) / 1000))

  const bundle =
    (mode === 'data_app' || useCase === 'auto') && toolMode !== 'lookml'
      ? extractBundleFromInteraction(interaction)
      : null
  const nativeBundle =
    (mode === 'dashboard' || useCase === 'auto') && toolMode !== 'lookml'
      ? extractNativeContentFromInteraction(interaction)
      : null
  const lookmlBundle = extractLookmlBundleFromInteraction(interaction)
  const tddMarkdown = extractTddFromInteraction(interaction)
  const rawText =
    interaction.output_text ||
    (interaction.outputs || []).map((o: AntigravityInteractionOutput) => o.text || '').join('\n') ||
    'Completed.'
  const combinedOutput = `${rawText}\n${collectInteractionTextCandidates(interaction)}`
  const hasExplicitUseCaseTag = /<USE_CASE>\s*[^<]+?\s*<\/USE_CASE>/i.test(combinedOutput)
  const inferredFromOutput = extractResolvedUseCase(
    combinedOutput,
    userPrompt,
    allowedModes
  )
  const resolvedUseCase: ResolvedStudioUseCase =
    useCase && useCase !== 'auto' && !hasExplicitUseCaseTag
      ? useCase
      : hasExplicitUseCaseTag
      ? inferredFromOutput
      : lookmlBundle
      ? 'lookml'
      : nativeBundle
      ? 'dashboard'
      : tddMarkdown
      ? 'health-check'
      : bundle
      ? inferredFromOutput === 'data-investigator'
        ? 'data-investigator'
        : 'app'
      : inferredFromOutput
  const cleanAssistantText = rawText
    .replace(/<USE_CASE>[\s\S]*?<\/USE_CASE>/gi, '')
    .replace(/<DATA_APP_BUNDLE>[\s\S]*?<\/DATA_APP_BUNDLE>/g, '')
    .replace(/<NATIVE_CONTENT_BUNDLE>[\s\S]*?<\/NATIVE_CONTENT_BUNDLE>/g, '')
    .replace(/<LOOKML_BUNDLE>[\s\S]*?<\/LOOKML_BUNDLE>/g, '')
    .replace(/<HEALTH_CHECK_TDD>[\s\S]*?<\/HEALTH_CHECK_TDD>/g, '')
    .replace(/<LKR_EXTENSION_TOOL_REQUEST>[\s\S]*?<\/LKR_EXTENSION_TOOL_REQUEST>/g, '')
    .trim()

  const telemetry = extractInteractionTelemetry(interaction, {
    agentWallMs: Date.now() - turnStartMs,
    pollWaitMs,
    pollCount,
    codemodeExecMs,
    lookerHttpMs,
    codemodeCalls,
    lookerHttpCalls,
    apiRetries,
  })

  const finalEnvId = normalizeEnvironmentId(interaction.environment_id) || trackedEnvId
  await persistUserEnvIfChanged({
    sdk,
    extensionSDK,
    userId,
    previousEnvId: trackedEnvId,
    nextEnvId: finalEnvId,
    onEnvironmentUpdated,
  })

  return {
    bundle,
    nativeBundle,
    lookmlBundle,
    tddMarkdown,
    resolvedUseCase,
    assistantText:
      cleanAssistantText ||
      (bundle
        ? `Built "${bundle.title}".`
        : nativeBundle
        ? `Built "${nativeBundle.title}".`
        : lookmlBundle
        ? `Updated LookML "${lookmlBundle.title}".`
        : tddMarkdown
        ? 'Synthesized 7-section Technical Design Document (TECHNICAL_DESIGN_DOCUMENT.md).'
        : 'Done.'),
    session: {
      environmentId: finalEnvId,
      lastInteractionId: interaction.id,
      conversationId,
      explores: selectedExplores,
      toolType: effectiveToolType,
    },
    telemetry,
    activitySteps,
    thinkingDurationSec,
  }
}

// ponytail: pre-launch or wake a single per-user Antigravity remote environment shared across
// tool modes (app, dashboard, lookml, health, tile), with automatic 404 environment recovery.
export async function prewarmOrWakeAntigravityEnvironment(params: {
  sdk?: Looker40SDK
  userId?: string
  extensionSDK: AntigravityExtensionHostLike
  auth: AntigravityAuth
  toolType: AntigravityToolType
  model?: string
  environmentId?: string
  conversationId?: string
  existingSession?: AgentSession
  selectedExplores?: string[]
  schemaMarkdown?: string
  existingAppCode?: string
  extraSources?: Array<{ type: 'inline'; content: string; target: string }>
  onEnvironmentUpdated?: (environmentId: string) => void | Promise<void>
}): Promise<{
  session: AgentSession
  status: 'woken' | 'prelaunched' | 'standby'
}> {
  const {
    sdk,
    userId,
    extensionSDK,
    auth,
    toolType,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    environmentId,
    conversationId: rawConversationId,
    existingSession,
    selectedExplores = [],
    schemaMarkdown = '',
    existingAppCode,
    extraSources = [],
    onEnvironmentUpdated,
  } = params

  const conversationId =
    String(
      rawConversationId ||
        existingSession?.conversationId ||
        existingSession?.objectId ||
        'current'
    )
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_') || 'current'
  const appFilePath = `/workspace/apps/${conversationId}/app.js`

  const initialEnvId = normalizeEnvironmentId(environmentId || existingSession?.environmentId)
  let activeEnvId = initialEnvId

  const hasValidExisting =
    existingSession?.lastInteractionId &&
    (!existingSession.toolType || existingSession.toolType === toolType)

  // 1. If the artifact or mode already has a saved interaction, wake & verify it
  if (hasValidExisting && existingSession?.lastInteractionId) {
    if (auth.mode === 'apikey' || auth.oauthToken) {
      try {
        const res = await callInteractionsApi(
          extensionSDK,
          auth,
          `interactions/${encodeURIComponent(existingSession.lastInteractionId)}`,
          'GET'
        )
        const resolvedEnvId =
          normalizeEnvironmentId(res?.environment_id) ||
          activeEnvId ||
          `env_${toolType}`
        await persistUserEnvIfChanged({
          sdk,
          extensionSDK,
          userId,
          previousEnvId: initialEnvId,
          nextEnvId: resolvedEnvId,
          onEnvironmentUpdated,
        })
        return {
          session: {
            ...existingSession,
            environmentId: resolvedEnvId,
            toolType,
          },
          status: 'woken',
        }
      } catch (err) {
        if (isEnvironmentNotFoundError(err)) {
          activeEnvId = undefined
        }
      }
    } else {
      return {
        session: {
          ...existingSession,
          environmentId: activeEnvId || existingSession.environmentId || `env_${toolType}_warm`,
          toolType,
        },
        status: 'woken',
      }
    }
  }

  // 2. If signed in (OAuth token or API key), wake existing shared environmentId or pre-launch a new one
  if (auth.mode === 'apikey' || auth.oauthToken) {
    const prewarmTools =
      toolType === 'dashboard'
        ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
        : [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    const prewarmBase = {
      agent: 'antigravity-preview-09-2026',
      agent_config: { type: 'antigravity', model: model || DEFAULT_ANTIGRAVITY_MODEL },
      background: true,
      tools: prewarmTools,
      input: [
        {
          type: 'text',
          text: `[PREWARM:${toolType.toUpperCase()}] Initialize ${toolType} workspace and reply READY.`,
        },
      ],
    }

    const userProvisionKey = resolveUserProvisionKey(userId, auth)
    if (!activeEnvId && inFlightEnvProvisionByUser.has(userProvisionKey)) {
      try {
        const coalescedId = normalizeEnvironmentId(await inFlightEnvProvisionByUser.get(userProvisionKey)!)
        if (coalescedId) activeEnvId = coalescedId
      } catch {
        // Ignore coalesced provisioning failure
      }
    }

    if (activeEnvId) {
      try {
        const woken = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
          ...prewarmBase,
          environment: activeEnvId,
        })
        const resolvedEnvId = normalizeEnvironmentId(woken?.environment_id) || activeEnvId
        await persistUserEnvIfChanged({
          sdk,
          extensionSDK,
          userId,
          previousEnvId: initialEnvId,
          nextEnvId: resolvedEnvId,
          onEnvironmentUpdated,
        })
        return {
          session: { ...existingSession, environmentId: resolvedEnvId, explores: selectedExplores, toolType },
          status: 'woken',
        }
      } catch (err) {
        if (!isEnvironmentNotFoundError(err)) {
          return {
            session: { ...existingSession, environmentId: activeEnvId, explores: selectedExplores, toolType },
            status: 'woken',
          }
        }
        // 404 Environment '<env_id>' not found -> fall through to create fresh remote environment
        activeEnvId = undefined
      }
    }

    let resolveEnv!: (envId: string) => void
    let rejectEnv!: (err: unknown) => void
    const envPromise = new Promise<string>((res, rej) => {
      resolveEnv = res
      rejectEnv = rej
    })
    envPromise.catch(() => {})
    inFlightEnvProvisionByUser.set(userProvisionKey, envPromise)
    try {
      const sources = buildWorkspaceSources({
        schemaMarkdown,
        appFilePath,
        existingAppCode: toolType === 'app' ? existingAppCode : undefined,
        cachedExploreSchemas: getSharedEnvExploreSchemas(activeEnvId),
        extraSources,
      })
      const pre = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        ...prewarmBase,
        tools: [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL],
        input: [
          {
            type: 'text',
            text: `[PREWARM:${toolType.toUpperCase()}] Initialize ${toolType} workspace: run \`python3 /workspace/bootstrap_lookml.py cli\` (${BOOTSTRAP_SANDBOX_SH}) so \`uv\` and \`${LKR_DEV_CLI_SPEC}\` are installed in \`/usr/local/bin\`, then reply READY.`,
          },
        ],
        environment: { type: 'remote', sources },
      })
      const newEnvId =
        normalizeEnvironmentId(pre?.environment_id) ||
        `env_${toolType}_${Date.now().toString(36).slice(-4)}`
      resolveEnv(newEnvId)
      await persistUserEnvIfChanged({
        sdk,
        extensionSDK,
        userId,
        previousEnvId: initialEnvId,
        nextEnvId: newEnvId,
        onEnvironmentUpdated,
      })
      return {
        session: {
          ...existingSession,
          environmentId: newEnvId,
          lastInteractionId: existingSession?.lastInteractionId,
          explores: selectedExplores,
          toolType,
        },
        status: 'prelaunched',
      }
    } catch (err) {
      rejectEnv(err)
      // Fall back to standby session slot
    } finally {
      if (inFlightEnvProvisionByUser.get(userProvisionKey) === envPromise) {
        inFlightEnvProvisionByUser.delete(userProvisionKey)
      }
    }
  }

  return {
    session: {
      environmentId:
        activeEnvId || existingSession?.environmentId || `env_${toolType}_isolated`,
      lastInteractionId: existingSession?.lastInteractionId,
      explores: selectedExplores,
      toolType,
    },
    status: 'standby',
  }
}

function extractCleanLabelWords(input?: string): string[] {
  const firstLine =
    String(input || '')
      .replace(/\[CONVERSATION_LABEL_REQUEST\]/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/^(?:label|title)\s*:\s*/i, '')
          .replace(/^[#>*\-\s"'`“”‘’]+|[#*`"'“”‘’.\s:;!?-]+$/g, '')
          .replace(/[*_`~"]/g, '')
          .trim()
      )
      .find(Boolean) || ''
  return firstLine
    .split(/\s+/)
    .map((w) => w.replace(/^[("'“‘]+|[)"'”’.,:;!?-]+$/g, ''))
    .filter(Boolean)
}

export function sanitizeConversationLabel(raw: string, fallbackPrompt?: string): string {
  const words = extractCleanLabelWords(raw)
  if (words.length >= 3) return words.slice(0, 6).join(' ')
  const combined = [...words, ...extractCleanLabelWords(fallbackPrompt).filter((w) => !words.includes(w))]
  if (combined.length >= 3) return combined.slice(0, 6).join(' ')
  return [...combined, 'Looker', 'Studio', 'Conversation'].slice(0, 3).join(' ')
}

// ponytail: stateless out-of-band labeling request — omits previous_interaction_id and passes tools: []
// so it never enters the conversation chain or triggers skill/tool execution.
export async function generateConversationLabel(params: {
  extensionSDK: AntigravityExtensionHostLike
  auth: AntigravityAuth
  environmentId?: string
  userPrompt: string
  assistantText?: string
  model?: string
  pollScheduleMs?: number[]
}): Promise<string> {
  const {
    extensionSDK,
    auth,
    environmentId,
    userPrompt,
    assistantText,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS,
  } = params
  const cleanUser = String(userPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const cleanAssistant = String(assistantText || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const inputText = [
    `${CONVERSATION_LABEL_REQUEST_TAG} Return only a single-line concise 3-6 word plain-text title for this conversation turn (no quotes, no markdown, no trailing period, no tools):`,
    `User: ${cleanUser}`,
    ...(cleanAssistant ? [`Assistant: ${cleanAssistant}`] : []),
  ].join('\n')

  try {
    let interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
      agent: 'antigravity-preview-09-2026',
      agent_config: { type: 'antigravity', model: model || DEFAULT_ANTIGRAVITY_MODEL },
      background: true,
      tools: [],
      environment: environmentId || 'remote',
      input: [{ type: 'text', text: inputText }],
    })
    const schedule = pollScheduleMs.length > 0 ? pollScheduleMs : DEFAULT_POLL_SCHEDULE_MS
    for (
      let i = 0;
      interaction?.id && (interaction.status === 'in_progress' || interaction.status === 'queued');
      i++
    ) {
      const sleepMs = schedule[Math.min(i, schedule.length - 1)]
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
      interaction = await callInteractionsApi(
        extensionSDK,
        auth,
        `interactions/${encodeURIComponent(interaction.id)}`,
        'GET'
      )
    }
    const rawText =
      interaction?.output_text ||
      (interaction?.outputs || []).map((o: AntigravityInteractionOutput) => o?.text || '').join('\n') ||
      collectInteractionTextCandidates(interaction)
    return sanitizeConversationLabel(rawText, userPrompt)
  } catch {
    return sanitizeConversationLabel('', userPrompt)
  }
}

export interface StarterPromptItem {
  id: string
  label: string
  prompt: string
  useCase?: ResolvedStudioUseCase
}

export interface StarterExploreFieldSummary {
  name: string
  label?: string
  type?: string
}

export type StarterContentSummaryItem = Pick<
  IContentSummary,
  | 'id'
  | 'content_type'
  | 'content_id'
  | 'content_slug'
  | 'title'
  | 'description'
  | 'view_count'
  | 'favorite_count'
  | 'is_scheduled'
>

export interface StarterExploreContext {
  exploreKey: string
  modelName: string
  modelLabel: string
  exploreName: string
  exploreLabel: string
  dimensions: StarterExploreFieldSummary[]
  measures: StarterExploreFieldSummary[]
  contentSummaries?: StarterContentSummaryItem[]
}

export interface LookmlModelExploreSummaryLike {
  name?: string | null
  label?: string | null
  project_name?: string | null
  explores?: Array<{
    name?: string | null
    label?: string | null
    description?: string | null
    hidden?: boolean | null
  }> | null
}

export interface BuildDynamicStarterPromptsOptions {
  useCase?: StudioUseCase | string
  selectedExplores?: string[]
  permittedUseCases?: StudioUseCase[]
  availableModels?: LookmlModelExploreSummaryLike[]
  exploreContext?: StarterExploreContext | null
  contentSummaries?: StarterContentSummaryItem[]
}

const starterExploreContextCache = new Map<string, StarterExploreContext>()
const starterPromptsCache = new Map<string, StarterPromptItem[]>()
let starterContentSummariesCache: StarterContentSummaryItem[] | null = null

export function clearStarterPromptsCache(): void {
  starterExploreContextCache.clear()
  starterPromptsCache.clear()
  starterContentSummariesCache = null
}

export function stripStarterPromptEmojis(text: string): string {
  return String(text || '')
    .replace(
      /(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]|\uFE0E|\uFE0F|\u200D)+/gu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function humanizeLookmlIdentifier(raw?: string | null): string {
  const clean = String(raw || '')
    .trim()
    .replace(/^[^.]+\./, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  return clean
    .split(' ')
    .map((w) => (w.length <= 2 && /^(?:id|pk|bq|qa|ai)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export function buildStarterPromptsCacheKey(
  useCase?: string,
  exploreKey?: string,
  permittedUseCases?: string[],
  isAgentAuthenticated = false
): string {
  const rawUc = String(useCase || 'auto').trim().toLowerCase()
  const normUc = rawUc === 'health' ? 'health-check' : rawUc || 'auto'
  const exp = String(exploreKey || 'none').trim() || 'none'
  const perms =
    Array.isArray(permittedUseCases) && permittedUseCases.length > 0
      ? [...permittedUseCases].sort().join(',')
      : 'all'
  return `${normUc}::${exp}::${perms}::${isAgentAuthenticated ? 'agent' : 'local'}`
}

export function getCachedStarterPrompts(
  useCase?: string,
  exploreKey?: string,
  permittedUseCases?: string[],
  isAgentAuthenticated = false
): StarterPromptItem[] | undefined {
  return starterPromptsCache.get(
    buildStarterPromptsCacheKey(useCase, exploreKey, permittedUseCases, isAgentAuthenticated)
  )
}

export function resolveTargetExploreFromModels(
  selectedExplores?: string[],
  availableModels?: LookmlModelExploreSummaryLike[]
): {
  exploreKey: string
  modelName: string
  modelLabel: string
  exploreName: string
  exploreLabel: string
} | null {
  const validModels = (Array.isArray(availableModels) ? availableModels : []).filter(
    (m) => m && typeof m.name === 'string' && m.name.trim().length > 0
  )
  const firstSelected = (Array.isArray(selectedExplores) ? selectedExplores : [])
    .map((s) => String(s || '').trim())
    .find(Boolean)
  if (firstSelected) {
    const parsed =
      parseExploreId(firstSelected) ||
      (firstSelected.includes('/')
        ? {
            modelName: firstSelected.split('/')[0].trim(),
            exploreName: firstSelected.split('/')[1].trim(),
          }
        : null)
    if (parsed && parsed.modelName && parsed.exploreName) {
      const matchedModel = validModels.find((m) => String(m.name).trim() === parsed.modelName)
      const matchedExplore = (matchedModel?.explores || []).find(
        (e) => String(e?.name || '').trim() === parsed.exploreName
      )
      return {
        exploreKey: `${parsed.modelName}::${parsed.exploreName}`,
        modelName: parsed.modelName,
        modelLabel: String(matchedModel?.label || humanizeLookmlIdentifier(parsed.modelName)),
        exploreName: parsed.exploreName,
        exploreLabel: String(matchedExplore?.label || humanizeLookmlIdentifier(parsed.exploreName)),
      }
    }
  }
  for (const m of validModels) {
    const modelName = String(m.name || '').trim()
    if (!modelName) continue
    const firstExplore = (m.explores || []).find((e) => !e?.hidden && String(e?.name || '').trim())
    if (firstExplore) {
      const exploreName = String(firstExplore.name || '').trim()
      return {
        exploreKey: `${modelName}::${exploreName}`,
        modelName,
        modelLabel: String(m.label || humanizeLookmlIdentifier(modelName)),
        exploreName,
        exploreLabel: String(firstExplore.label || humanizeLookmlIdentifier(exploreName)),
      }
    }
  }
  return null
}

export async function discoverStarterContentSummaries(
  sdk?: Looker40SDK | null
): Promise<StarterContentSummaryItem[]> {
  if (starterContentSummariesCache) return starterContentSummariesCache
  const sdkAny = sdk as unknown as {
    ok?: <T>(p: Promise<T> | T) => Promise<T>
    content_summary?: (req: IRequestContentSummary) => Promise<IContentSummary[]>
  } | null | undefined
  if (!sdkAny || typeof sdkAny.content_summary !== 'function') return []
  try {
    const unwrap = async <T>(p: Promise<T> | T): Promise<T> =>
      typeof sdkAny.ok === 'function' ? sdkAny.ok(Promise.resolve(p)) : p
    const rows = await unwrap(
      sdkAny.content_summary.call(sdk, {
        limit: 6,
        fields:
          'id,content_type,content_id,content_slug,title,description,view_count,favorite_count,is_scheduled',
      })
    )
    const normalized = (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.title === 'string' && r.title.trim())
      .slice(0, 6)
      .map((r) => ({
        id: r.id,
        content_type: r.content_type || 'dashboard',
        content_id: r.content_id || r.id || null,
        content_slug: r.content_slug || null,
        title: String(r.title).trim(),
        description: r.description || null,
        view_count: typeof r.view_count === 'number' ? r.view_count : null,
        favorite_count: typeof r.favorite_count === 'number' ? r.favorite_count : null,
        is_scheduled: Boolean(r.is_scheduled),
      }))
    starterContentSummariesCache = normalized
    return normalized
  } catch {
    return []
  }
}

export async function discoverStarterExploreContext(params: {
  sdk?: Looker40SDK | null
  selectedExplores?: string[]
  availableModels?: LookmlModelExploreSummaryLike[]
}): Promise<StarterExploreContext | null> {
  const { sdk, selectedExplores, availableModels } = params
  let modelsList = Array.isArray(availableModels) ? availableModels : []
  let target = resolveTargetExploreFromModels(selectedExplores, modelsList)

  const sdkAny = sdk as unknown as {
    ok?: <T>(p: Promise<T> | T) => Promise<T>
    all_lookml_models?: (req?: Record<string, unknown>) => Promise<LookmlModelExploreSummaryLike[]>
    lookml_model_explore?: (...args: unknown[]) => Promise<unknown>
  } | null | undefined

  const unwrap = async <T>(p: Promise<T> | T): Promise<T> =>
    typeof sdkAny?.ok === 'function' ? sdkAny.ok(Promise.resolve(p)) : p

  if (!target && sdkAny && typeof sdkAny.all_lookml_models === 'function') {
    try {
      const fetched = await unwrap(
        sdkAny.all_lookml_models({
          fields: 'name,label,project_name,explores(name,label,description,hidden)',
        })
      )
      if (Array.isArray(fetched) && fetched.length > 0) {
        modelsList = fetched
        target = resolveTargetExploreFromModels(selectedExplores, modelsList)
      }
    } catch {
      // Ignore model discovery failure
    }
  }

  const contentSummaries = await discoverStarterContentSummaries(sdk)

  if (!target) {
    return contentSummaries.length > 0
      ? {
          exploreKey: '',
          modelName: '',
          modelLabel: '',
          exploreName: '',
          exploreLabel: '',
          dimensions: [],
          measures: [],
          contentSummaries,
        }
      : null
  }
  const cached = starterExploreContextCache.get(target.exploreKey)
  if (cached) {
    return contentSummaries.length > 0 && !cached.contentSummaries?.length
      ? { ...cached, contentSummaries }
      : cached
  }

  let rawExplore: Record<string, unknown> | null = null
  if (sdkAny && typeof sdkAny.lookml_model_explore === 'function') {
    try {
      const fn = sdkAny.lookml_model_explore
      rawExplore = (await unwrap(
        fn.length >= 2
          ? fn.call(sdk, target.modelName, target.exploreName)
          : fn.call(sdk, {
              lookml_model_name: target.modelName,
              explore_name: target.exploreName,
              fields:
                'name,label,model_name,fields(dimensions(name,label,label_short,type,hidden),measures(name,label,label_short,type,hidden))',
            })
      )) as Record<string, unknown>
    } catch {
      rawExplore = null
    }
  }
  if (!rawExplore && sdk && typeof LkrCodeMode?.runPythonCode === 'function') {
    try {
      const cmOut = await LkrCodeMode.runPythonCode({
        code: 'return lookml_model_explore(target_model, target_explore)',
        sdk,
        vars: { target_model: target.modelName, target_explore: target.exploreName },
      })
      const parsed = typeof cmOut === 'string' ? JSON.parse(cmOut) : cmOut
      if (parsed && typeof parsed === 'object') {
        rawExplore = parsed as Record<string, unknown>
      }
    } catch {
      rawExplore = null
    }
  }

  const rawFields =
    rawExplore?.fields && typeof rawExplore.fields === 'object'
      ? (rawExplore.fields as {
          dimensions?: Array<Record<string, unknown>>
          measures?: Array<Record<string, unknown>>
        })
      : {}

  const normalizeFieldList = (
    items?: Array<Record<string, unknown>>
  ): StarterExploreFieldSummary[] =>
    (Array.isArray(items) ? items : [])
      .filter((f) => f && !f.hidden && typeof f.name === 'string' && f.name.trim())
      .slice(0, 6)
      .map((f) => {
        const name = String(f.name).trim()
        const label = String(f.label_short || f.label || humanizeLookmlIdentifier(name)).trim()
        return {
          name,
          label,
          ...(f.type ? { type: String(f.type) } : {}),
        }
      })

  const ctx: StarterExploreContext = {
    exploreKey: target.exploreKey,
    modelName: target.modelName,
    modelLabel: target.modelLabel,
    exploreName: target.exploreName,
    exploreLabel: target.exploreLabel || String(rawExplore?.label || humanizeLookmlIdentifier(target.exploreName)),
    dimensions: normalizeFieldList(rawFields.dimensions),
    measures: normalizeFieldList(rawFields.measures),
    ...(contentSummaries.length > 0 ? { contentSummaries } : {}),
  }
  starterExploreContextCache.set(target.exploreKey, ctx)
  return ctx
}

function toPermittedUseCaseSet(permittedUseCases?: StudioUseCase[]): Set<string> | null {
  return Array.isArray(permittedUseCases) && permittedUseCases.length > 0
    ? new Set(
        permittedUseCases.map((u) => {
          const k = String(u).trim().toLowerCase()
          return k === 'health' ? 'health-check' : k
        })
      )
    : null
}

export function buildDynamicStarterPrompts(
  options: BuildDynamicStarterPromptsOptions = {}
): StarterPromptItem[] {
  const rawUseCase = String(options.useCase || 'auto').trim().toLowerCase()
  const useCaseKey = rawUseCase === 'health' ? 'health-check' : rawUseCase || 'auto'

  const baseTarget =
    options.exploreContext?.exploreName
      ? options.exploreContext
      : resolveTargetExploreFromModels(options.selectedExplores, options.availableModels)
  const resolvedTarget = baseTarget
    ? { dimensions: [] as StarterExploreFieldSummary[], measures: [] as StarterExploreFieldSummary[], ...baseTarget }
    : null

  const hasExplore = Boolean(resolvedTarget?.exploreName)
  const expName = resolvedTarget?.exploreName || ''
  const expKey =
    resolvedTarget?.modelName && expName ? `${resolvedTarget.modelName}::${expName}` : expName
  const expLabel = resolvedTarget?.exploreLabel || humanizeLookmlIdentifier(expName) || 'Primary Explore'
  const modelName = resolvedTarget?.modelName || ''
  const modelLabel = resolvedTarget?.modelLabel || humanizeLookmlIdentifier(modelName) || expLabel

  const measures = resolvedTarget?.measures || []
  const dimensions = resolvedTarget?.dimensions || []
  const [m1, m2] = measures
  const measureLabelPair =
    m1 && m2
      ? `${m1.label || humanizeLookmlIdentifier(m1.name)} and ${m2.label || humanizeLookmlIdentifier(m2.name)}`
      : m1
      ? m1.label || humanizeLookmlIdentifier(m1.name)
      : 'headline KPIs and performance metrics'
  const timeDim =
    dimensions.find((d) => /date|time|month|week|year|quarter/i.test(`${d.type || ''} ${d.name}`)) ||
    dimensions[0]
  const catDim =
    dimensions.find(
      (d) =>
        d !== timeDim &&
        !/\b(?:id|pk)\b/i.test(d.name) &&
        (!d.type || /string|tier|zipcode|yesno/i.test(d.type))
    ) ||
    dimensions.find((d) => d !== timeDim) ||
    dimensions[0]
  const timeLabel = timeDim ? timeDim.label || humanizeLookmlIdentifier(timeDim.name) : 'time-series'
  const catLabel = catDim ? catDim.label || humanizeLookmlIdentifier(catDim.name) : 'segment'

  const contentSummaries = options.contentSummaries || options.exploreContext?.contentSummaries || []
  const topContent =
    contentSummaries.find(
      (c) => String(c.content_type || '').toLowerCase() === 'dashboard' && String(c.title || '').trim()
    ) || contentSummaries.find((c) => String(c.title || '').trim())
  const topContentTitle = stripStarterPromptEmojis(String(topContent?.title || '').trim())
  const topContentIdSuffix = topContent?.content_id ? ` (#${topContent.content_id})` : ''

  const mk = (
    useCase: ResolvedStudioUseCase,
    id: string,
    label: string,
    prompt: string
  ): StarterPromptItem => ({
    id,
    label: stripStarterPromptEmojis(label),
    prompt,
    useCase,
  })

  const byUseCase: Record<ResolvedStudioUseCase, StarterPromptItem[]> = {
    app: [
      mk(
        'app',
        'exec-kpi',
        hasExplore ? `Build ${expLabel} KPI App` : 'Executive KPI Scorecard App',
        hasExplore
          ? `Build an interactive Data App on ${expKey} with ${measureLabelPair} KPI scorecards, a ${timeLabel} trend chart, and a ${catLabel} filter.`
          : 'Build an interactive Executive KPI Data App with summary scorecards, a time-series trend chart, and segment filters from our primary LookML explore.'
      ),
      mk(
        'app',
        'cohort-grid',
        hasExplore ? `Interactive ${expLabel} Explorer` : 'Interactive Metric & Segment Explorer',
        hasExplore
          ? `Build an interactive Data App on ${expKey} with a dynamic metric switcher for ${measureLabelPair}, a ${catLabel} breakdown chart, and a drillable detail grid.`
          : 'Build an interactive Data App with a dynamic metric switcher, category breakdown chart, and drillable detail grid.'
      ),
      mk(
        'app',
        'funnel-app',
        topContentTitle
          ? `Upgrade ${topContentTitle} to Data App`
          : hasExplore
          ? `${expLabel} Segment Comparison App`
          : 'Cohort & Conversion Funnel App',
        topContentTitle
          ? `Convert our "${topContentTitle}" Looker ${topContent?.content_type || 'dashboard'}${topContentIdSuffix} into an interactive Data App${hasExplore ? ` on ${expKey}` : ''} with KPI scorecards and cross-filtering.`
          : hasExplore
          ? `Create a segment comparison Data App on ${expKey} with ${catLabel} cross-filtering and period-over-period comparison cards.`
          : 'Create a conversion and retention Data App with regional filters and period-over-period comparison cards.'
      ),
    ],
    'data-investigator': [
      mk(
        'data-investigator',
        'inv-doc-drivers',
        hasExplore ? `Investigate ${expLabel} Key Drivers` : 'Root-Cause Key Driver Narrative Doc',
        hasExplore
          ? `Investigate key drivers of ${measureLabelPair} in ${expKey} across ${catLabel} using run_key_driver_analysis, LookML drill_fields (limit 500), and fixed point-in-time dates in a Google Doc narrative Data App.`
          : 'Investigate the root-cause key drivers of our primary business metric change using run_key_driver_analysis, LookML drill_fields (limit 500), and fixed point-in-time dates in a Google Doc narrative Data App.'
      ),
      mk(
        'data-investigator',
        'inv-slides-deck',
        hasExplore ? `${expLabel} Executive Slides Investigation` : 'Executive Presentation Slides Investigation',
        hasExplore
          ? `Build a Google Presentation slides investigation deck on ${expKey} drilling into ${measureLabelPair} by ${catLabel} across ${timeLabel} with What This Chart Means and Next Investigation Path slides.`
          : 'Build a Google Presentation slides investigation deck drilling into segment anomalies with What This Chart Means callouts and Next Investigation Path transitions.'
      ),
      mk(
        'data-investigator',
        'inv-anomaly-drill',
        hasExplore ? `${expLabel} Segment Anomaly Drill Path` : 'Segment Anomaly & Drill Path Story',
        hasExplore
          ? `Run a point-in-time data investigation on ${expKey} with fixed date filters, drilling from ${measureLabelPair} down its LookML drill_fields and ${catLabel} to a 500-row evidence grid.`
          : 'Run a point-in-time data investigation with fixed date ranges, drilling from headline KPI variance down LookML drill_fields to a 500-row evidence grid.'
      ),
    ],
    dashboard: [
      mk(
        'dashboard',
        'udd-exec',
        hasExplore ? `Create ${expLabel} Looker Dashboard` : 'Create a Native Looker Dashboard',
        hasExplore
          ? `Create a native Looker UDD on ${expKey} with ${measureLabelPair} KPI tiles, a breakdown chart by ${catLabel}, and an interactive ${catLabel} filter.`
          : 'Create a native Looker UDD with headline KPI scorecards, a segment breakdown column chart, and interactive dashboard filters.'
      ),
      mk(
        'dashboard',
        'saved-look',
        hasExplore ? `Top ${expLabel} Segments Saved Look` : 'Top Segments & Metrics Saved Look',
        hasExplore
          ? `Create a Saved Look on ${expKey} ranking top ${catLabel} segments by ${measureLabelPair} with a 90-day date filter.`
          : 'Create a Saved Look showing top 10 segments by primary business metrics with a 90-day date filter.'
      ),
      mk(
        'dashboard',
        'board-schedule',
        topContentTitle
          ? `Pin ${topContentTitle} & Schedule`
          : hasExplore
          ? `${expLabel} Board & Morning Schedule`
          : 'Executive Board & Morning Schedule',
        topContentTitle
          ? `Pin "${topContentTitle}"${topContentIdSuffix} to an Executive Pulse board and schedule a weekday 8 AM summary delivery.`
          : hasExplore
          ? `Pin our ${expLabel} dashboards to an Executive Pulse board and schedule a weekday 8 AM summary delivery.`
          : 'Pin our key business dashboards to an Executive Pulse board and schedule a weekday 8 AM summary.'
      ),
    ],
    'conversational-analytics': [
      mk(
        'conversational-analytics',
        'ca-margin',
        hasExplore ? `Top ${expLabel} Drivers by ${catLabel}` : 'Top Segments by Key Metrics',
        hasExplore
          ? `What are the top ${catLabel} segments in ${expKey} by ${measureLabelPair}?`
          : 'What are the top 3 product or service segments by primary business performance in Q4?'
      ),
      mk(
        'conversational-analytics',
        'ca-spike',
        hasExplore ? `${expLabel} Trend & Anomaly Q&A` : 'Q4 Metric Spike & Streaming Volume Q&A',
        hasExplore
          ? `How have ${measureLabelPair} in ${expKey} trended across ${timeLabel}, and which segments drove the largest change?`
          : 'Why did primary KPI metrics spike in Q4 and which BigQuery tables had the highest streaming buffer volume?'
      ),
      mk(
        'conversational-analytics',
        'ca-retention',
        hasExplore ? `Compare ${expLabel} Segments` : 'Repeat vs New Cohort Breakdown',
        hasExplore
          ? `Show a breakdown of ${measureLabelPair} by ${catLabel} in ${expKey} and highlight top outliers.`
          : 'Show me the monthly breakdown of repeat vs first-time customer cohorts over the past year.'
      ),
    ],
    'health-check': [
      mk(
        'health-check',
        'hc-full',
        hasExplore ? `Full 3-Pillar Audit for ${modelLabel}` : 'Full 3-Pillar Looker & BigQuery Audit',
        hasExplore
          ? `Run a full 3-pillar Looker & BigQuery health check focused on ${modelName || expKey} and generate a prioritized Technical Design Document.`
          : 'Run a full 3-pillar Looker & BigQuery health check and generate a prioritized Technical Design Document.'
      ),
      mk(
        'health-check',
        'hc-lookml',
        'LookML Transcriber Rubric & PK Audit',
        hasExplore
          ? `Audit LookML views in ${modelName || expKey} for missing primary keys, symmetric aggregate fanouts, and 0–4 Transcriber maturity score.`
          : 'Audit LookML views for missing primary keys, symmetric aggregate fanouts, and 0–4 Transcriber maturity score.'
      ),
      mk(
        'health-check',
        'hc-bq',
        'BigQuery Partitioning & Slot Cost Audit',
        'Analyze BigQuery INFORMATION_SCHEMA for unpartitioned tables, high-byte scans, and clustering recommendations.'
      ),
    ],
    lookml: [
      mk(
        'lookml',
        'lkml-measures',
        hasExplore ? `Add Measures to ${expLabel}` : 'Add Curated Measures & Refinements',
        hasExplore
          ? `Add curated KPI measures and field descriptions to ${expName} in model ${modelName || 'LookML'}, and verify SQL vs Explore parity.`
          : 'Add KPI summary measures to a LookML view refinement, curate field descriptions, and verify SQL vs Explore parity.'
      ),
      mk(
        'lookml',
        'lkml-tests',
        hasExplore ? `Generate ${expLabel} LookML Data Tests` : 'Generate LookML Assert Data Tests',
        hasExplore
          ? `Curate field descriptions on ${expKey}, generate assert data tests (.test.lkml), and capture a LookML parity snapshot.`
          : 'Curate LookML field descriptions, generate assert data tests (.test.lkml), and capture a LookML parity snapshot.'
      ),
      mk(
        'lookml',
        'lkml-ndt',
        hasExplore ? `Model ${expLabel} Rollup Derived Table` : 'Model a Native Derived Table Rollup',
        hasExplore
          ? `Create an aggregated native derived table (NDT) rollup view for ${catLabel} and join it into the ${expKey} explore.`
          : 'Create a customer lifetime value native derived table (NDT) view and join it into our primary LookML explore.'
      ),
    ],
    tile: [
      mk(
        'tile',
        'script-summary',
        hasExplore ? `${expLabel} & Filter Summary Script` : 'Explore & Active Filter Summary',
        hasExplore
          ? `Write a Script summarizing ${expKey} metrics by ${catLabel} and active dashboard filters as a table.`
          : 'Write a Script summarizing visible LookML models, explores, and active dashboard filters as a table.'
      ),
      mk(
        'tile',
        'script-anomaly',
        hasExplore ? `${expLabel} Anomaly Detector Script` : 'Daily Metric Anomaly Detector',
        hasExplore
          ? `Write a Script that queries ${measureLabelPair} in ${expKey} across ${timeLabel}, flags values outside 2 standard deviations, and outputs a markdown alert.`
          : 'Write a Script that queries daily time-series metrics, flags days outside 2 standard deviations, and outputs a markdown alert.'
      ),
      mk(
        'tile',
        'script-audit',
        'Unused Content & Schedule Audit',
        'Write a Script that lists top scheduled plans and dashboard element counts across folders.'
      ),
    ],
  }

  if (useCaseKey !== 'auto' && useCaseKey in byUseCase) {
    return byUseCase[useCaseKey as ResolvedStudioUseCase]
  }

  const candidateOrder: Array<{ uc: ResolvedStudioUseCase; autoId: string; fallbackLabel: string }> = [
    { uc: 'app', autoId: 'exec-app', fallbackLabel: hasExplore ? `Build ${expLabel} Data App` : 'Build an Executive KPI Data App' },
    { uc: 'data-investigator', autoId: 'inv-doc', fallbackLabel: hasExplore ? `Investigate ${expLabel} Drivers` : 'Investigate Key Metric Drivers' },
    { uc: 'dashboard', autoId: 'native-udd', fallbackLabel: hasExplore ? `Create ${expLabel} Looker Dashboard` : 'Create a Native Looker Dashboard' },
    { uc: 'conversational-analytics', autoId: 'ask-ca', fallbackLabel: hasExplore ? `Ask a Question on ${expLabel}` : 'Ask a Data Question' },
    { uc: 'lookml', autoId: 'lookml-measure', fallbackLabel: hasExplore ? `Add LookML Measures to ${expLabel}` : 'Add LookML Measures & Data Tests' },
    { uc: 'tile', autoId: 'script-summary', fallbackLabel: hasExplore ? `${expLabel} & Filter Summary Script` : 'Explore & Active Filter Summary' },
    { uc: 'health-check', autoId: 'hc-full', fallbackLabel: hasExplore ? `Full 3-Pillar Audit for ${modelLabel}` : 'Full 3-Pillar Looker & BigQuery Audit' },
  ]

  const permittedSet = toPermittedUseCaseSet(options.permittedUseCases)

  const autoItems: StarterPromptItem[] = []
  for (const cand of candidateOrder) {
    if (permittedSet && !permittedSet.has(cand.uc)) continue
    const first = byUseCase[cand.uc]?.[0]
    if (!first) continue
    autoItems.push(mk(cand.uc, cand.autoId, cand.fallbackLabel, first.prompt))
    if (autoItems.length >= 4) break
  }

  if (autoItems.length < 3) {
    for (const cand of candidateOrder) {
      if (permittedSet && !permittedSet.has(cand.uc)) continue
      for (const extra of (byUseCase[cand.uc] || []).slice(1)) {
        if (autoItems.some((x) => x.prompt === extra.prompt)) continue
        autoItems.push({ ...extra, label: stripStarterPromptEmojis(extra.label) })
        if (autoItems.length >= 3) break
      }
      if (autoItems.length >= 3) break
    }
  }

  return autoItems.length > 0 ? autoItems : byUseCase.app
}

export function parseStarterPromptsResponse(
  rawText: string,
  fallbackPrompts: StarterPromptItem[],
  permittedUseCases?: StudioUseCase[]
): StarterPromptItem[] {
  const cleanRaw = String(rawText || '').trim()
  if (!cleanRaw) return fallbackPrompts

  const tagMatch = cleanRaw.match(/<STARTER_PROMPTS>([\s\S]*?)<\/STARTER_PROMPTS>/i)
  const jsonCandidate = tagMatch ? tagMatch[1].trim() : cleanRaw
  const bracketMatch = jsonCandidate.match(/\[[\s\S]*\]/)
  if (!bracketMatch) return fallbackPrompts

  try {
    const parsed = JSON.parse(bracketMatch[0])
    if (!Array.isArray(parsed)) return fallbackPrompts
    const validUseCases = new Set<string>([
      'app',
      'data-investigator',
      'dashboard',
      'conversational-analytics',
      'lookml',
      'health-check',
      'tile',
    ])
    const permittedSet = toPermittedUseCaseSet(permittedUseCases)

    const normalized: StarterPromptItem[] = []
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const label = stripStarterPromptEmojis(String(rec.label || '').trim())
      const prompt = String(rec.prompt || '').trim()
      if (!label || prompt.length < 10) continue
      if (/search_content|lookml_model_explore|Solr/i.test(prompt)) continue
      const rawUc = String(rec.useCase || rec.use_case || '').trim().toLowerCase()
      const normUc = (rawUc === 'health' ? 'health-check' : rawUc) as ResolvedStudioUseCase
      const resolvedUc: ResolvedStudioUseCase | undefined = validUseCases.has(normUc)
        ? normUc
        : fallbackPrompts[i]?.useCase
      if (permittedSet && resolvedUc && !permittedSet.has(resolvedUc)) continue
      const id =
        String(rec.id || '')
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '-') || `starter-${i}`
      normalized.push({
        id,
        label,
        prompt,
        ...(resolvedUc ? { useCase: resolvedUc } : {}),
      })
      if (normalized.length >= 4) break
    }
    return normalized.length >= 3 ? normalized : fallbackPrompts
  } catch {
    return fallbackPrompts
  }
}

// ponytail: stateless out-of-band starter prompt synthesis — omits previous_interaction_id and passes tools: []
// while falling back to deterministic LookML explore/field prompts when unauthenticated or on error.
export async function generateDynamicStarterPrompts(params: {
  sdk?: Looker40SDK | null
  extensionSDK?: AntigravityExtensionHostLike
  auth?: AntigravityAuth
  environmentId?: string
  useCase?: StudioUseCase | string
  selectedExplores?: string[]
  permittedUseCases?: StudioUseCase[]
  availableModels?: LookmlModelExploreSummaryLike[]
  exploreContext?: StarterExploreContext | null
  model?: string
  pollScheduleMs?: number[]
}): Promise<StarterPromptItem[]> {
  const {
    sdk,
    extensionSDK,
    auth,
    environmentId,
    useCase = 'auto',
    selectedExplores = [],
    permittedUseCases,
    availableModels = [],
    exploreContext: providedContext,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS,
  } = params

  const exploreContext =
    providedContext !== undefined
      ? providedContext
      : await discoverStarterExploreContext({
          sdk,
          selectedExplores,
          availableModels,
        })

  const exploreKey =
    selectedExplores.length > 0
      ? selectedExplores.join(',')
      : exploreContext?.exploreKey || 'none'

  const canCallAgent = Boolean(
    auth?.oauthToken?.trim() || (auth?.mode === 'apikey' && auth?.apiKey?.trim())
  )
  const localCacheKey = buildStarterPromptsCacheKey(useCase, exploreKey, permittedUseCases, false)
  const agentCacheKey = buildStarterPromptsCacheKey(useCase, exploreKey, permittedUseCases, true)

  if (canCallAgent) {
    const cachedAgent = starterPromptsCache.get(agentCacheKey)
    if (cachedAgent && cachedAgent.length > 0) return cachedAgent
  } else {
    const cachedLocal = starterPromptsCache.get(localCacheKey)
    if (cachedLocal && cachedLocal.length > 0) return cachedLocal
  }

  const fallbackPrompts = buildDynamicStarterPrompts({
    useCase,
    selectedExplores,
    permittedUseCases,
    availableModels,
    exploreContext,
  })
  starterPromptsCache.set(localCacheKey, fallbackPrompts)

  if (!canCallAgent || !auth) {
    return fallbackPrompts
  }

  const rawUc = String(useCase || 'auto').trim().toLowerCase()
  const normUc = rawUc === 'health' ? 'health-check' : rawUc || 'auto'
  const allowedList =
    Array.isArray(permittedUseCases) && permittedUseCases.length > 0
      ? permittedUseCases.filter((u) => u !== 'auto')
      : [
          'app',
          'data-investigator',
          'dashboard',
          'conversational-analytics',
          'lookml',
          'health-check',
          'tile',
        ]

  const inputText = [
    `${STARTER_PROMPTS_REQUEST_TAG} Synthesize ${normUc === 'auto' ? 4 : 3} concise, tailored Looker Studio starter prompts as JSON wrapped in <STARTER_PROMPTS>[...]</STARTER_PROMPTS> (plain-text labels with zero emojis, no tools, no markdown outside tag).`,
    `Active useCase: ${normUc}`,
    `Permitted use cases: ${allowedList.join(', ')}`,
    exploreContext?.exploreName
      ? `Target explore: ${exploreContext.exploreKey} (${exploreContext.exploreLabel})`
      : 'Target explore: none',
    exploreContext?.measures?.length
      ? `Top measures: ${exploreContext.measures
          .slice(0, 5)
          .map((m) => `${m.name}${m.label ? ` (${m.label})` : ''}`)
          .join(', ')}`
      : '',
    exploreContext?.dimensions?.length
      ? `Top dimensions: ${exploreContext.dimensions
          .slice(0, 5)
          .map((d) => `${d.name}${d.label ? ` (${d.label})` : ''}`)
          .join(', ')}`
      : '',
    exploreContext?.contentSummaries?.length
      ? `Recent user content (content_summary): ${exploreContext.contentSummaries
          .slice(0, 4)
          .map((c) => `${c.content_type || 'dashboard'} "${c.title}"${c.content_id ? ` (#${c.content_id})` : ''}`)
          .join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    let interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
      agent: 'antigravity-preview-09-2026',
      agent_config: { type: 'antigravity', model: model || DEFAULT_ANTIGRAVITY_MODEL },
      background: true,
      tools: [],
      environment: environmentId || 'remote',
      input: [{ type: 'text', text: inputText }],
    })
    const schedule = pollScheduleMs.length > 0 ? pollScheduleMs : DEFAULT_POLL_SCHEDULE_MS
    for (
      let i = 0;
      interaction?.id && (interaction.status === 'in_progress' || interaction.status === 'queued');
      i++
    ) {
      const sleepMs = schedule[Math.min(i, schedule.length - 1)]
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
      interaction = await callInteractionsApi(
        extensionSDK,
        auth,
        `interactions/${encodeURIComponent(interaction.id)}`,
        'GET'
      )
    }
    const rawText =
      interaction?.output_text ||
      (interaction?.outputs || []).map((o: AntigravityInteractionOutput) => o?.text || '').join('\n') ||
      collectInteractionTextCandidates(interaction)
    const parsed = parseStarterPromptsResponse(rawText, fallbackPrompts, permittedUseCases)
    starterPromptsCache.set(agentCacheKey, parsed)
    return parsed
  } catch {
    return fallbackPrompts
  }
}


