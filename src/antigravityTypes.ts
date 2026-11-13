import type { ExtensionSDK } from '@looker/extension-sdk'

export interface AntigravityModelOption {
  id: string
  label: string
  description: string
}

export const DEFAULT_ANTIGRAVITY_MODEL = 'gemini-3.8-flash'

export const ANTIGRAVITY_ALLOWED_MODELS: AntigravityModelOption[] = [
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', description: 'Frontier reasoning & complex multi-step engineering' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: 'Default — balanced reasoning, coding & tool use' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: 'Fast multi-step reasoning & coding' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: 'Stable reasoning & tool use' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: 'Lowest latency & cost' },
]

export type StudioThinkingLevel = 'low' | 'medium' | 'high'
export const DEFAULT_THINKING_LEVEL: StudioThinkingLevel = 'high'
export const STUDIO_THINKING_LEVEL_STORAGE_KEY = 'dab_thinking_level'
export const STUDIO_THINKING_LEVEL_OPTIONS: Array<{ value: StudioThinkingLevel; label: string; testId: string }> = [
  { value: 'low', label: 'Low', testId: 'thinking-level-option-low' },
  { value: 'medium', label: 'Medium', testId: 'thinking-level-option-medium' },
  { value: 'high', label: 'High', testId: 'thinking-level-option-high' },
]

export const DEFAULT_MAX_TOTAL_TOKENS = 131072
export const STUDIO_MAX_TOTAL_TOKENS_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 32768, label: '32,768 tokens' },
  { value: 65536, label: '65,536 tokens' },
  { value: 131072, label: '131,072 tokens (Default — High)' },
  { value: 262144, label: '262,144 tokens (Max)' },
]

export function normalizeMaxTotalTokens(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_TOTAL_TOKENS
}

export const DEFAULT_MAX_TOOL_ROUNDS = 50
export const STUDIO_MAX_TOOL_ROUNDS_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 15, label: '15 rounds' },
  { value: 25, label: '25 rounds' },
  { value: 50, label: '50 rounds (Default — High)' },
  { value: 100, label: '100 rounds (Max)' },
]

export function normalizeMaxToolRounds(raw: unknown): number {
  if (typeof raw === 'boolean' || raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_MAX_TOOL_ROUNDS
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 1 ? Math.min(100, n) : DEFAULT_MAX_TOOL_ROUNDS
}

export function cleanLookmlProjectId(raw?: unknown): string {
  const s = String(raw ?? '').trim()
  return s && s !== 'default' ? s : ''
}

export function normalizeThinkingLevel(raw: unknown): StudioThinkingLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : DEFAULT_THINKING_LEVEL
}

export function readInitialThinkingLevel(fallback: StudioThinkingLevel = DEFAULT_THINKING_LEVEL): StudioThinkingLevel {
  try {
    const w = typeof window !== 'undefined' ? window : undefined
    const raw =
      (w?.__MOCK_LOOKER_EXTENSION__ as { initialThinkingLevel?: string } | undefined)?.initialThinkingLevel ??
      w?.localStorage?.getItem?.(STUDIO_THINKING_LEVEL_STORAGE_KEY)
    return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : normalizeThinkingLevel(fallback)
  } catch {
    return normalizeThinkingLevel(fallback)
  }
}

export async function loadStoredThinkingLevel(extensionSDK?: AntigravityExtensionHostLike): Promise<StudioThinkingLevel | null> {
  try {
    const raw = (await extensionSDK?.localStorageGetItem?.(STUDIO_THINKING_LEVEL_STORAGE_KEY)) ??
      (typeof window !== 'undefined' ? window.localStorage?.getItem?.(STUDIO_THINKING_LEVEL_STORAGE_KEY) : null)
    return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : null
  } catch {
    return null
  }
}

export function persistThinkingLevel(extensionSDK: AntigravityExtensionHostLike, level: StudioThinkingLevel): void {
  const normalized = normalizeThinkingLevel(level)
  try { if (typeof window !== 'undefined') window.localStorage?.setItem?.(STUDIO_THINKING_LEVEL_STORAGE_KEY, normalized) } catch { /* ignore */ }
  try { void extensionSDK?.localStorageSetItem?.(STUDIO_THINKING_LEVEL_STORAGE_KEY, normalized) } catch { /* ignore */ }
}

export interface ExtensionAuthContextConfig {
  authMode: 'oauth' | 'apikey'
  clientId?: string
  projectId?: string
  disabledModes?: AntigravityToolType[]
  defaultModel?: string
  defaultThinkingLevel?: StudioThinkingLevel
  maxTotalTokens?: number
  maxToolRounds?: number
}

export interface AntigravityAuth {
  mode: 'oauth' | 'apikey'
  oauthToken?: string
  clientId?: string
  projectId?: string
  apiKey?: string
  onUnauthorizedRefresh?: () => Promise<string | null | undefined>
}

export type AntigravityToolType = 'app' | 'dashboard' | 'lookml' | 'health' | 'tile'

export interface AgentSession {
  environmentId?: string
  lastInteractionId?: string
  statelessTurn?: boolean
  conversationId?: string
  explores?: string[]
  toolType?: AntigravityToolType
  objectId?: string
  usedBridgeTool?: boolean
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
  filename?: string; file?: string; filepath?: string; uri?: string
  Path?: string; FilePath?: string; TargetFile?: string; AbsolutePath?: string
  target?: string; description?: string; skill?: string; skill_name?: string
  query?: string; input?: string; new_content?: string
  code?: string; command?: string; language?: string
}

export interface AntigravityInteractionStep extends AntigravityNestedStepCall {
  id?: string; call_id?: string; index?: number; type?: string; status?: string
  output?: unknown; stdout?: unknown; stderr?: unknown; result?: unknown
  text?: string; summary?: unknown; content?: unknown; parts?: unknown
  thought?: unknown
  input?: string; method?: string
  function_call?: AntigravityNestedStepCall; view_file_call?: AntigravityNestedStepCall
  edit_file_call?: AntigravityNestedStepCall; skill_lookup_call?: AntigravityNestedStepCall
  code_execution?: AntigravityNestedStepCall; code_execution_call?: AntigravityNestedStepCall
  executable_code?: AntigravityNestedStepCall; code_execution_result?: { output?: unknown; stdout?: unknown }
}

export interface AntigravityInteractionOutput {
  id?: string; type?: string; text?: string; summary?: unknown; content?: unknown; parts?: unknown
  thought?: unknown
}

export interface AntigravityUsageMetadata {
  input_tokens?: number; total_input_tokens?: number; prompt_token_count?: number
  output_tokens?: number; total_output_tokens?: number; candidates_token_count?: number
  thought_tokens?: number; total_thought_tokens?: number; thoughts_token_count?: number
  total_tokens?: number
}

export interface AntigravityInteractionPayload {
  id?: string; previous_interaction_id?: string; status?: string; environment_id?: string; input?: unknown; output_text?: string
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
  args: { params?: unknown; body?: unknown; [key: string]: unknown }
  thought?: string
}

export interface AntigravityActivityStep {
  id: string
  kind: 'thought' | 'codemode' | 'cli_bridge' | 'code_execution' | 'file' | 'skill'
  title: string
  detail?: string
  language?: string
  status?: 'running' | 'done'
  path?: string
  content?: string
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
    const id = `att_${Date.now()}_${index}_${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
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
  const files = Array.from(e.clipboardData?.items || [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((f): f is File => Boolean(f))
  if (files.length === 0) return
  e.preventDefault()
  handleFileInputSelection(files, setPastedImages)
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

export function extractNonThoughtText(val: unknown): string {
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return val.map(extractNonThoughtText).filter((s) => s.length > 0).join('')
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (obj.type === 'thought' || obj.type === 'thinking' || obj.thought) return ''
    for (let i = 0; i < 3; i++) {
      const extracted = extractNonThoughtText(obj[['text', 'content', 'parts'][i]])
      if (extracted) return extracted
    }
  }
  return ''
}

const IGNORED_INSPECTION_STEP_RE =
  /^(?:thought|thinking|(?:view|read|open|cat|edit|write)_file(?:_call|_result)?|(?:skill_lookup|lookup_skill)(?:_call|_result)?)$/i
const ALLOWED_RESULT_TOOL_RE = /^(?:run_looker_codemode|lkr_cli_extension_bridge)$/i
const EXEC_STEP_TYPE_RE = /^(?:code_execution|code_execution_call|executable_code)$/i
const isIgnoredInspectionStep = (s: AntigravityInteractionStep, sType: string, fnName: string): boolean =>
  Boolean(IGNORED_INSPECTION_STEP_RE.test(sType) || IGNORED_INSPECTION_STEP_RE.test(fnName) || s.view_file_call || s.edit_file_call || s.skill_lookup_call)

export function collectInteractionTextCandidates(interaction: AntigravityInteractionPayload | null | undefined): string {
  const out: unknown[] = [interaction?.output_text]
  ;(interaction?.outputs || []).forEach((o) => {
    if (o && o.type !== 'thought' && o.type !== 'thinking' && !o.thought) {
      out.push(o.text, extractNonThoughtText(o.content ?? o.parts))
    }
  })
  const steps = interaction?.steps || []
  const ignoredCallIds = new Set<string>()
  const callNameById = new Map<string, string>()
  steps.forEach((s) => {
    if (!s || typeof s !== 'object') return
    const sType = String(s.type || '').trim()
    const fnName = String(s.name || s.function_call?.name || '').trim()
    const id = s.id ? String(s.id).trim() : ''
    if (id && fnName && sType !== 'function_result' && sType !== 'tool_result') callNameById.set(id, fnName)
    if (id && isIgnoredInspectionStep(s, sType, fnName)) ignoredCallIds.add(id)
  })
  steps.forEach((s) => {
    if (!s || typeof s !== 'object') return
    const sType = String(s.type || '').trim()
    const fnName = String(s.name || s.function_call?.name || '').trim()
    const callId = String(s.call_id || '').trim()
    if (isIgnoredInspectionStep(s, sType, fnName) || (callId && ignoredCallIds.has(callId))) return
    if (sType === 'function_call' || sType === 'tool_call') return
    if (sType === 'function_result' || sType === 'tool_result') {
      const effName = fnName || (callId ? callNameById.get(callId) || '' : '')
      if (!ALLOWED_RESULT_TOOL_RE.test(effName)) return
      const rObj = s.result && typeof s.result === 'object' ? (s.result as Record<string, unknown>) : null
      const resStr = typeof s.result === 'string' ? s.result : rObj ? [rObj.result, rObj.stdout, rObj.output].filter((v): v is string => typeof v === 'string').join('\n') || JSON.stringify(s.result) : ''
      out.push(s.output, s.stdout, resStr)
      return
    }
    if (EXEC_STEP_TYPE_RE.test(sType) || s.code_execution || s.code_execution_call || s.executable_code) {
      out.push(s.output, s.stdout, s.result, s.code_execution_result?.output, s.code_execution_result?.stdout)
      return
    }
    if (s.thought) return
    out.push(s.output, s.stdout, s.result, s.text, s.code_execution_result?.output, s.code_execution_result?.stdout, extractNonThoughtText((s as Record<string, unknown>).content ?? (s as Record<string, unknown>).parts))
  })
  return out.filter((x): x is string => typeof x === 'string' && x.length > 0).join('\n')
}

export function parseTaggedJsonObjects(text: string, tagRe: RegExp): Array<Record<string, unknown>> {
  const matches = Array.from(text.matchAll(tagRe))
  const out: Array<Record<string, unknown>> = []
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const raw = matches[i][1]?.trim() || ''
    if (!raw.startsWith('{') || !raw.endsWith('}')) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>)
      }
    } catch { /* skip malformed/source match */ }
  }
  return out
}

export interface AlertAppliedFilterItem {
  filter_title: string
  field_name: string
  filter_value: string
  filter_description?: string | null
}

export interface AlertDestinationItem {
  destination_type: string
  email_address?: string | null
  action_hub_integration_id?: string | null
  action_hub_form_params_json?: string | null
}

export interface AlertHistoryItem {
  Check_start_time?: string | null
  alert_condition_met?: boolean | null
  outcome?: string | null
  message?: string | null
}

export interface AlertInspectorBundle {
  id: string
  alert_id: string
  title?: string
  custom_title?: string | null
  description?: string | null
  dashboard_id?: string | number | null
  dashboard_name?: string | null
  lookml_dashboard_id?: string | null
  lookml_link_id?: string | null
  dashboard_element_id?: string | number | null
  owner_id?: string | number
  owner_display_name?: string | null
  cron?: string
  comparison_type?: string
  threshold?: number
  field?: {
    title?: string
    name?: string
    filter?: Array<{ field_name?: string; field_value?: string; filter_value?: string }> | null
  }
  applied_dashboard_filters?: AlertAppliedFilterItem[] | null
  destinations?: AlertDestinationItem[] | null
  is_disabled?: boolean | null
  disabled_reason?: string | null
  is_public?: boolean | null
  followed?: boolean | null
  followable?: boolean | null
  error?: string | null
  alert_history_items?: AlertHistoryItem[] | null
  updated_at?: string
}

