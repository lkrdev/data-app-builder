import type { Looker40SDK } from '@looker/sdk'
import {
  DataAppBundle,
  NativeContentBundle,
  NativeContentState,
  normalizeNativeContent,
  parseExploreId,
  resolveNativeEmbedPath,
} from './lookerApi'
import {
  BOOTSTRAP_LOOKML_PY,
  buildLookmlSystemGuide,
  extractLookmlBundleFromInteraction,
  LookmlBundle,
} from './lookmlTool'
import {
  AGENTS_MD,
  buildNativeContentGuide,
  BUNDLE_APP_PY,
  CONVERSATION_LABEL_REQUEST_TAG,
  DATA_APP_GUIDE_MD,
  wrapDashboardCodeMode,
} from './antigravityPrompts'
export * from './antigravityPrompts'

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const LkrCodeMode = require('./vendor/codemode.js')

// Expose optional `vars: { type: "object" }` on RUN_LOOKER_CODEMODE_TOOL so Antigravity can pass
// script variables (project_id, ts_utc, raw_sql, inline_queries_json, test_queries_json, commit_message, etc.)
if (LkrCodeMode?.RUN_LOOKER_CODEMODE_TOOL?.parameters?.properties) {
  LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL.parameters.properties.vars = {
    type: 'object',
    description:
      'Optional dictionary of top-level variables to inject into the Monty Python sandbox (e.g. project_id, ts_utc, raw_sql, inline_queries_json, test_queries_json, file_ids, test_names, commit_message).',
  }
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
  explores?: string[]
  toolType?: AntigravityToolType
  objectId?: string
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
  args: { params?: any; body?: any }
}

export interface PastedImage {
  mimeType: string
  data: string // base64 without data: prefix
  dataUrl: string
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

export function getGeminiSecretKeyTag(extensionSDK: any): string {
  if (extensionSDK && typeof extensionSDK.createSecretKeyTag === 'function') {
    return extensionSDK.createSecretKeyTag('gemini_api_key')
  }
  return '{{data_app_builder_data_app_builder_gemini_api_key}}'
}

export function getGeminiUserAttributeName(extensionSDK: any): string {
  return getGeminiSecretKeyTag(extensionSDK).replace(/^\{\{|\}\}$/g, '')
}

export async function ensureGeminiApiKeyUserAttribute(
  sdk: Looker40SDK,
  extensionSDK: any,
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
          label: 'Data App Studio Gemini API Key',
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
  } catch (err: any) {
    throw new Error(
      `Looker Admin required to create/update hidden user attribute "${attrName}" (value_is_hidden=true, user_can_view=false, whitelist="https://generativelanguage.googleapis.com/*"): ${
        err?.message || err
      }`
    )
  }
}

export async function loginWithGoogleOAuth(
  extensionSDK: any,
  clientId: string
): Promise<string> {
  const res = await extensionSDK.oauth2Authenticate(
    'https://accounts.google.com/o/oauth2/v2/auth',
    {
      client_id: clientId.trim(),
      scope:
        'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever',
      response_type: 'token',
    },
    'GET'
  )
  const token = res?.access_token || res?.id_token
  if (!token) {
    throw new Error(
      `Google OAuth response did not include an access_token: ${JSON.stringify(res)}`
    )
  }
  return String(token)
}

async function callInteractionsApi(
  extensionSDK: any,
  auth: AntigravityAuth,
  path: string,
  method: 'GET' | 'POST',
  body?: any
): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${path.replace(/^\//, '')}`
  const serializedBody = body ? JSON.stringify(body) : undefined

  if (auth.mode === 'apikey' && extensionSDK?.serverProxy && !auth.apiKey?.trim()) {
    const proxyResp = await extensionSDK.serverProxy(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': getGeminiSecretKeyTag(extensionSDK),
      },
      body: serializedBody,
    })
    const parsed =
      typeof proxyResp?.body === 'string'
        ? (() => {
            try {
              return JSON.parse(proxyResp.body)
            } catch {
              return { raw: proxyResp.body }
            }
          })()
        : proxyResp?.body || {}
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
    if (!auth.oauthToken) throw new Error('Please sign in with Google OAuth first.')
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
  let parsed: any
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!resp.ok) {
    const msg = parsed?.error?.message || text || `HTTP ${resp.status}`
    throw new Error(`Antigravity API error (${resp.status}): ${msg}`)
  }
  return parsed
}

export async function listAvailableAntigravityModels(
  extensionSDK: any,
  auth: AntigravityAuth
): Promise<AntigravityModelOption[]> {
  const canQuery =
    auth.mode === 'oauth'
      ? Boolean(auth.oauthToken?.trim())
      : Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)
  if (!canQuery) return ANTIGRAVITY_ALLOWED_MODELS
  try {
    const res = await callInteractionsApi(extensionSDK, auth, 'models', 'GET')
    const byId = new Map<string, any>(
      (Array.isArray(res?.models) ? res.models : []).map((m: any) => [
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

function collectInteractionTextCandidates(interaction: any): string {
  const out: any[] = [interaction?.output_text]
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

function extractBundleFromInteraction(interaction: any): DataAppBundle | null {
  const matches = Array.from(
    collectInteractionTextCandidates(interaction).matchAll(
      /<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/g
    )
  )
  return matches.length > 0
    ? (JSON.parse(matches[matches.length - 1][1].trim()) as DataAppBundle)
    : null
}

function extractTddFromInteraction(interaction: any): string | null {
  const combined = collectInteractionTextCandidates(interaction)
  const matches = Array.from(
    combined.matchAll(/<HEALTH_CHECK_TDD>([\s\S]*?)<\/HEALTH_CHECK_TDD>/g)
  )
  if (matches.length > 0) return matches[matches.length - 1][1].trim()
  return combined.includes('## 1. Executive Summary') && combined.includes('## 7.')
    ? combined.trim()
    : null
}

function normalizeNativeBundleCandidate(raw: any): NativeContentBundle | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw.NATIVE_CONTENT_BUNDLE && typeof raw.NATIVE_CONTENT_BUNDLE === 'object'
    ? raw.NATIVE_CONTENT_BUNDLE
    : raw
  const id =
    r.id ||
    r.lookml_dashboard_id ||
    r.dashboard_id ||
    r.look_id ||
    r.board_id
  if (!id) return null
  const strId = String(id).trim()
  const cType =
    r.content_type ||
    r.contentType ||
    (r.board_id ? 'board' : r.look_id && !r.dashboard_id ? 'look' : strId.includes('::') ? 'lookml_dashboard' : 'dashboard')
  const folderId = r.folder_id || r.folderId ? String(r.folder_id || r.folderId) : undefined
  const embedPath = resolveNativeEmbedPath(cType, strId, r.embed_path || r.url)
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
    layout_component_ids: r.layout_component_ids && typeof r.layout_component_ids === 'object' ? r.layout_component_ids : undefined,
    query_cache: r.query_cache && typeof r.query_cache === 'object' ? r.query_cache : undefined,
    filter_cache: r.filter_cache && typeof r.filter_cache === 'object' ? r.filter_cache : undefined,
    summary: r.summary ? String(r.summary) : undefined,
    elements: Array.isArray(r.elements) ? r.elements : undefined,
    explores: Array.isArray(r.explores) ? r.explores : undefined,
  }
}

// ponytail: capture NATIVE_CONTENT_BUNDLE directly from run_looker_codemode return value first
// so the model never has to echo <NATIVE_CONTENT_BUNDLE>{...}</NATIVE_CONTENT_BUNDLE> in output_text.
export function extractNativeContentFromInteraction(
  interaction: any
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
        } catch {}
      }
      try {
        const parsed = typeof step.result === 'string' ? JSON.parse(step.result) : step.result
        const norm = normalizeNativeBundleCandidate(parsed?.result ?? parsed)
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
    } catch {}
  }
  return null
}

function summarizeProgress(interaction: any): string {
  const steps = interaction?.steps || []
  if (steps.length === 0) return `Status: ${interaction?.status || 'starting'}...`
  const last = steps[steps.length - 1]
  if (last.type === 'function_call') {
    return `Running tool: ${last.name || 'sandbox command'}...`
  }
  if (last.type === 'thought' || last.type === 'thinking') {
    return 'Agent is reasoning...'
  }
  return `Step ${steps.length} (${last.type || interaction.status})...`
}

function extractInteractionTelemetry(
  interaction: any,
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
  const steps: any[] = interaction?.steps || []
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

export async function runAntigravityTurn(params: {
  sdk: Looker40SDK
  extensionSDK?: any
  auth: AntigravityAuth
  session: AgentSession
  model?: string
  mode?: 'data_app' | 'dashboard'
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
  pollScheduleMs?: number[]
  onStatus: (statusText: string) => void
}): Promise<{
  bundle: DataAppBundle | null
  nativeBundle: NativeContentBundle | null
  lookmlBundle?: LookmlBundle | null
  tddMarkdown: string | null
  assistantText: string
  session: AgentSession
  telemetry: AntigravityTurnTelemetry
}> {
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
    auth,
    session,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    mode = 'data_app',
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
    pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS,
    onStatus,
  } = params

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

  // ponytail: enforce strict environment & conversation isolation per toolType so switching modes
  // (app vs dashboard vs lookml vs health vs tile) never reuses another mode's previous_interaction_id.
  const isFreshEnvironment =
    !session.lastInteractionId ||
    Boolean(session.toolType && session.toolType !== effectiveToolType) ||
    JSON.stringify(session.explores || []) !== JSON.stringify(selectedExplores)

  const exploreDirective =
    selectedExplores.length > 0
      ? `for selected Looker explore(s): ${selectedExplores.map((id) => `"${id}"`).join(', ')}.`
      : `where no explore was pre-selected — YOU decide which Looker explore(s) ("model_id::explore_id") from /workspace/schema.md best fit the user's request.`

  const step2Directive =
    selectedExplores.length > 0
      ? `2. Read /workspace/schema.md for the compiled Looker Explore schema(s) and sample rows. You also have \`run_looker_codemode\` (WASM Monty Python sandbox with \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel}", and \`target_explore\`="${primaryExplore}" pre-injected, plus Looker 4.0 SDK globals \`lookml_model_explore\`, \`run_inline_query\`, \`search_content\`) if you need additional sample queries.`
      : `2. Pick the best \`model_id::explore_id\` from /workspace/schema.md and run ONE \`run_looker_codemode\` Python snippet that resolves discovery + schema + 5-row sample in a single call:
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
  const step3Directive = `3. Write and bundle the Lit Data App in ONE \`code_execution\` call importing from '/runtime/data-app.js' (${ctorHint}):\n   \`python3 /workspace/bundle_app.py --stdin "<App Title>" << 'EOF'\\n...\\nEOF\``

  const normalizedExistingNative: NativeContentState | null = existingNativeContent
    ? normalizeNativeContent({
        ...existingNativeContent,
        folderId:
          (existingNativeContent as any).folderId ||
          (existingNativeContent as any).folder_id ||
          folderId ||
          '1',
      })
    : null

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
          `You are building a Looker Data App (Lit web component using Looker's data-app.js runtime) ${exploreDirective}`,
          `Follow these exact steps inside your Linux sandbox:`,
          `1. /workspace/DATA_APP_GUIDE.md is pre-loaded with component contracts (<app-kpi>, <app-chart>, <app-grid>, <app-select>), .da-* layout classes, dark mode (this.isDark), and static widget extraction rules. Do NOT download toolkits or read external skill directories.`,
          step2Directive,
          step3Directive,
          `4. If bundle_app.py reports any syntax or tile safety violation, fix /workspace/apps/current/app.js and re-run \`python3 /workspace/bundle_app.py /workspace/apps/current/app.js "<App Title>"\` until it exits 0.`,
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

  const sources: Array<{ type: 'inline'; content: string; target: string }> = [
    { type: 'inline', content: AGENTS_MD, target: '/workspace/AGENTS.md' },
    { type: 'inline', content: schemaMarkdown, target: '/workspace/schema.md' },
    ...(mode === 'data_app' && toolMode !== 'lookml'
      ? [
          { type: 'inline' as const, content: BUNDLE_APP_PY, target: '/workspace/bundle_app.py' },
          { type: 'inline' as const, content: DATA_APP_GUIDE_MD, target: '/workspace/DATA_APP_GUIDE.md' },
        ]
      : []),
    ...(toolMode === 'lookml'
      ? [{ type: 'inline' as const, content: BOOTSTRAP_LOOKML_PY, target: '/workspace/bootstrap_lookml.py' }]
      : []),
    ...(extraSources || []),
  ]
  if (mode === 'data_app' && existingAppCode) {
    sources.push({
      type: 'inline',
      content: existingAppCode,
      target: '/workspace/apps/current/app.js',
    })
  }

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
      ? `[WARM SANDBOX FAST PATH: /workspace/apps/current/app.js and the discovered Looker schema are already in /workspace. Do NOT re-run run_looker_codemode discovery or re-read guides unless a brand-new explore is requested. Update /workspace/apps/current/app.js and bundle in ONE code_execution call via: python3 /workspace/bundle_app.py --stdin "<App Title>" << 'EOF'\n...\nEOF\nNEVER echo <DATA_APP_BUNDLE> in your text reply.]\n\n`
      : isDashboardMode && normalizedExistingNative
      ? `[WARM CONTENT STUDIO FAST PATH: Active Looker ${normalizedExistingNative.contentType} id="${normalizedExistingNative.id}" ("${normalizedExistingNative.title}") and pre-hydrated active_content (element_ids=${JSON.stringify(normalizedExistingNative.elementIds || [])}, filter_names=${JSON.stringify(normalizedExistingNative.filterNames || [])}, lookml_dashboard_id="${normalizedExistingNative.lookmlDashboardId || ''}", project_id="${normalizedExistingNative.projectId || lookmlProjectId || ''}") are pre-injected in run_looker_codemode vars. Execute the update in ONE run_looker_codemode call using upsert_udd / upsert_lookml_dashboard / reflow_24col / pin_to_board / schedule_dashboard + return emit_native_bundle(...). NEVER echo <NATIVE_CONTENT_BUNDLE> in your text reply.]\n\n`
      : ''

  const buildInputItems = (fresh: boolean): Array<Record<string, any>> => [
    {
      type: 'text',
      text: fresh
        ? `${systemGuide}${historyDigest}\n\nUser request:\n${userPrompt}`
        : `${warmTurnDirective}${userPrompt}`,
    },
    ...(images || []).map((img) => ({
      type: 'image',
      mime_type: img.mimeType,
      data: img.data,
    })),
  ]

  const activeModel = model || DEFAULT_ANTIGRAVITY_MODEL
  const agentConfig = { type: 'antigravity', model: activeModel }

  const buildFreshPayload = (): Record<string, any> => ({
    agent: 'antigravity-preview-09-2026',
    agent_config: agentConfig,
    background: true,
    tools: activeTools,
    input: buildInputItems(true),
    environment: { type: 'remote', sources },
  })

  onStatus('Starting Antigravity sandbox interaction...')
  let interaction: any
  if (!isFreshEnvironment && session.lastInteractionId) {
    try {
      interaction = await callInteractionsApi(
        extensionSDK,
        auth,
        'interactions',
        'POST',
        {
          agent: 'antigravity-preview-09-2026',
          agent_config: agentConfig,
          background: true,
          tools: activeTools,
          input: buildInputItems(false),
          environment: session.environmentId || 'remote',
          previous_interaction_id: session.lastInteractionId,
        }
      )
    } catch {
      // ponytail: if stored session/sandbox expired or belongs to another GCP project,
      // transparently spin up a fresh sandbox seeded with existingAppCode + priorMessages.
      onStatus('Resumed sandbox expired; provisioning fresh sandbox with app state...')
      interaction = await callInteractionsApi(
        extensionSDK,
        auth,
        'interactions',
        'POST',
        buildFreshPayload()
      )
    }
  } else {
    interaction = await callInteractionsApi(
      extensionSDK,
      auth,
      'interactions',
      'POST',
      buildFreshPayload()
    )
  }
  let trackedEnvId: string | undefined =
    interaction.environment_id || session.environmentId

  let pollIdx = 0
  let prevStepCount = (interaction.steps || []).length
  let prevStatus = interaction.status

  while (
    interaction.status === 'in_progress' ||
    interaction.status === 'requires_action' ||
    interaction.status === 'queued'
  ) {
    if (interaction.environment_id) {
      trackedEnvId = interaction.environment_id
    }
    if (interaction.status === 'requires_action') {
      const steps = interaction.steps || []
      const executedIds = new Set(
        steps.filter((s: any) => s.type === 'function_result').map((s: any) => s.call_id)
      )
      const pendingLookerCalls = steps.filter(
        (s: any) =>
          s.type === 'function_call' &&
          s.name === 'run_looker_codemode' &&
          !executedIds.has(s.id)
      )

      if (pendingLookerCalls.length > 0) {
        onStatus('Running Looker Code Mode (WASM Monty sandbox) in extension...')
        const cmStart = Date.now()
        codemodeCalls += pendingLookerCalls.length
        const rawTransport = (sdk as any)?.authSession?.transport
        const origRawReq = rawTransport?.rawRequest
        if (typeof origRawReq === 'function') {
          rawTransport.rawRequest = (...reqArgs: any[]) => {
            lookerHttpCalls += 1
            const reqStart = Date.now()
            return Promise.resolve(origRawReq.apply(rawTransport, reqArgs)).then(
              (res: any) => {
                lookerHttpMs += Date.now() - reqStart
                if (res && (res.ok === false || Number(res.statusCode) >= 400)) {
                  apiRetries += 1
                }
                return res
              },
              (err: any) => {
                lookerHttpMs += Date.now() - reqStart
                apiRetries += 1
                throw err
              }
            )
          }
        }
        let resultsInput: any[]
        try {
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
          resultsInput = await Promise.all(
            pendingLookerCalls.map(async (call: any) => {
              const args = call.arguments || call.args || {}
              let codeModeOutput: string
              try {
                const customVars =
                  args.vars && typeof args.vars === 'object' && !Array.isArray(args.vars)
                    ? args.vars
                    : {}
                const rawCode = String(args.code || '')
                codeModeOutput = await LkrCodeMode.runPythonCode({
                  code: isDashboardMode ? wrapDashboardCodeMode(rawCode) : rawCode,
                  sdk,
                  extensionSDK,
                  allowUpdateSession: toolMode === 'lookml' || mode === 'dashboard',
                  requirePermission,
                  approvedOperations,
                  onPermissionRequest,
                  vars: {
                    target_explores: selectedExplores,
                    target_model: primaryModel,
                    target_explore: primaryExplore,
                    target_folder_id: folderId || '1',
                    target_project_id:
                      lookmlProjectId || normalizedExistingNative?.projectId || '',
                    ...(activeContentVars
                      ? {
                          active_content: activeContentVars,
                          active_dashboard_state: activeContentVars,
                        }
                      : {}),
                    ...customVars,
                  },
                })
              } catch (err: any) {
                apiRetries += 1
                codeModeOutput = JSON.stringify({
                  ok: false,
                  error: err?.message || String(err),
                })
              }
              return {
                type: 'function_result',
                name: 'run_looker_codemode',
                call_id: call.id,
                result: codeModeOutput,
              }
            })
          )
        } finally {
          if (typeof origRawReq === 'function') {
            rawTransport.rawRequest = origRawReq
          }
          codemodeExecMs += Date.now() - cmStart
        }

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
    const schedule =
      pollScheduleMs.length > 0 ? pollScheduleMs : DEFAULT_POLL_SCHEDULE_MS
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

  const bundle =
    mode === 'data_app' && toolMode !== 'lookml'
      ? extractBundleFromInteraction(interaction)
      : null
  const nativeBundle =
    mode === 'dashboard' && toolMode !== 'lookml'
      ? extractNativeContentFromInteraction(interaction)
      : null
  const lookmlBundle = extractLookmlBundleFromInteraction(interaction)
  const tddMarkdown = extractTddFromInteraction(interaction)
  const rawText =
    interaction.output_text ||
    (interaction.outputs || []).map((o: any) => o.text || '').join('\n') ||
    'Completed.'
  const cleanAssistantText = rawText
    .replace(/<DATA_APP_BUNDLE>[\s\S]*?<\/DATA_APP_BUNDLE>/g, '')
    .replace(/<NATIVE_CONTENT_BUNDLE>[\s\S]*?<\/NATIVE_CONTENT_BUNDLE>/g, '')
    .replace(/<LOOKML_BUNDLE>[\s\S]*?<\/LOOKML_BUNDLE>/g, '')
    .replace(/<HEALTH_CHECK_TDD>[\s\S]*?<\/HEALTH_CHECK_TDD>/g, '')
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

  return {
    bundle,
    nativeBundle,
    lookmlBundle,
    tddMarkdown,
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
      environmentId: interaction.environment_id || trackedEnvId,
      lastInteractionId: interaction.id,
      explores: selectedExplores,
      toolType: effectiveToolType,
    },
    telemetry,
  }
}

// ponytail: pre-launch or re-load and wake up a mode-isolated Antigravity remote environment
// so each mini-app (app, dashboard, lookml, health, tile) has its own warm sandbox without cross-talk.
export async function prewarmOrWakeAntigravityEnvironment(params: {
  extensionSDK: any
  auth: AntigravityAuth
  toolType: AntigravityToolType
  model?: string
  existingSession?: AgentSession
  selectedExplores?: string[]
  schemaMarkdown?: string
  existingAppCode?: string
  extraSources?: Array<{ type: 'inline'; content: string; target: string }>
}): Promise<{
  session: AgentSession
  status: 'woken' | 'prelaunched' | 'standby'
}> {
  const {
    extensionSDK,
    auth,
    toolType,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    existingSession,
    selectedExplores = [],
    schemaMarkdown = '',
    existingAppCode,
    extraSources = [],
  } = params

  const hasValidExisting =
    existingSession?.lastInteractionId &&
    (!existingSession.toolType || existingSession.toolType === toolType)

  // 1. If the artifact or mode already has a saved interaction/environment, wake & verify it
  if (hasValidExisting && existingSession?.lastInteractionId) {
    if (auth.mode === 'apikey' || auth.oauthToken) {
      try {
        const res = await callInteractionsApi(
          extensionSDK,
          auth,
          `interactions/${encodeURIComponent(existingSession.lastInteractionId)}`,
          'GET'
        )
        return {
          session: {
            ...existingSession,
            environmentId: res?.environment_id || existingSession.environmentId || `env_${toolType}`,
            toolType,
          },
          status: 'woken',
        }
      } catch {
        // Saved sandbox expired; fall through to pre-launch a fresh mode-isolated environment
      }
    } else {
      return {
        session: {
          ...existingSession,
          environmentId: existingSession.environmentId || `env_${toolType}_warm`,
          toolType,
        },
        status: 'woken',
      }
    }
  }

  // 2. If signed in (OAuth token or API key), pre-launch a fresh mode-specific remote sandbox
  if (auth.mode === 'apikey' || auth.oauthToken) {
    try {
      const sources: Array<{ type: 'inline'; content: string; target: string }> = [
        { type: 'inline', content: AGENTS_MD, target: '/workspace/AGENTS.md' },
        { type: 'inline', content: schemaMarkdown, target: '/workspace/schema.md' },
        ...(toolType === 'app'
          ? [{ type: 'inline' as const, content: BUNDLE_APP_PY, target: '/workspace/bundle_app.py' }]
          : []),
        ...(toolType === 'lookml'
          ? [
              {
                type: 'inline' as const,
                content: BOOTSTRAP_LOOKML_PY,
                target: '/workspace/bootstrap_lookml.py',
              },
            ]
          : []),
        ...extraSources,
      ]
      if (toolType === 'app' && existingAppCode) {
        sources.push({
          type: 'inline',
          content: existingAppCode,
          target: '/workspace/apps/current/app.js',
        })
      }
      const prewarmTools =
        toolType === 'dashboard'
          ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
          : [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
      const pre = await callInteractionsApi(
        extensionSDK,
        auth,
        'interactions',
        'POST',
        {
          agent: 'antigravity-preview-09-2026',
          agent_config: {
            type: 'antigravity',
            model: model || DEFAULT_ANTIGRAVITY_MODEL,
          },
          background: true,
          tools: prewarmTools,
          input: [
            {
              type: 'text',
              text: `[PREWARM:${toolType.toUpperCase()}] Initialize isolated ${toolType} workspace and reply READY.`,
            },
          ],
          environment: { type: 'remote', sources },
        }
      )
      return {
        session: {
          environmentId: pre?.environment_id || `env_${toolType}_${Date.now().toString(36).slice(-4)}`,
          lastInteractionId: pre?.id,
          explores: selectedExplores,
          toolType,
        },
        status: 'prelaunched',
      }
    } catch {
      // Fall back to standby session slot isolated for this toolType
    }
  }

  return {
    session: {
      environmentId: existingSession?.environmentId || `env_${toolType}_isolated`,
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
  extensionSDK: any
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
      (interaction?.outputs || []).map((o: any) => o?.text || '').join('\n') ||
      collectInteractionTextCandidates(interaction)
    return sanitizeConversationLabel(rawText, userPrompt)
  } catch {
    return sanitizeConversationLabel('', userPrompt)
  }
}

