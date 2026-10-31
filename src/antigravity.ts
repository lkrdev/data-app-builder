import type { Looker40SDK } from '@looker/sdk'
import {
  DataAppBundle,
  NativeContentBundle,
  NativeContentState,
  parseExploreId,
} from './lookerApi'
import {
  BOOTSTRAP_LOOKML_PY,
  buildLookmlSystemGuide,
  extractLookmlBundleFromInteraction,
  LookmlBundle,
} from './lookmlTool'
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

export interface ExtensionAuthContextConfig {
  authMode: 'oauth' | 'apikey'
  clientId?: string
  projectId?: string
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
}

export const DEFAULT_POLL_SCHEDULE_MS = [400, 700, 1000, 1500]

export const DATA_APP_GUIDE_MD = `# Looker Lit Data Apps — Compact Sandbox Guide

## 1. Zero-Build ES Module Contract
- Import from \`/runtime/data-app.js\`:
  \`import { DataApp, html, nothing, keyed, formatValue, createNumericCol, createCurrencyCol, createPercentageCol, createBadgeCol } from '/runtime/data-app.js';\`
- No TypeScript decorators (\`@customElement\`, \`@property\`). Use \`static properties = { ... }\` and \`customElements.define(elementName, AppClass)\`.
- In \`constructor()\`, always assign literal strings \`this.lookerModel = '<model>'\` and \`this.explore = '<explore>'\`, plus initial reactive state (e.g. \`this.selectedMetric = 'order_items.total_sale_price'\`).
- Always route widget filters through \`getEffectiveFilters(local = {}, { isTimeSeries = false } = {})\` spreading \`{ ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) }\`.

## 2. Live Query Components (\`app-*\`)
- \`<app-kpi>\`: \`label\` (1-3 words), \`subtitle\`, \`query-field="view.measure"\` (or \`.query=\${{ fields: ['view.date_month', 'view.measure'], sorts: ['view.date_month desc'], limit: '12' }}\`), \`.filters=\${this.getEffectiveFilters()}\`, \`format="usd|usd2|int|decimal1|percent1|percent-100"\`, \`sparkline\`, \`sparkline-agg="sum|avg|last"\`, \`change="+12.4%"\`, \`change-type="positive|negative|neutral"\`, \`polarity="higher-better|lower-better"\`, \`bare\`, \`cell\`.
- \`<app-chart>\`: \`title\`, \`type="areaspline|line|column|bar|donut|pie|treemap|funnel|gauge"\`, \`value-format="usd|int|percent1"\`, \`color="var(--app-primary)"\`, \`cross-filter\` (or \`cross-filter="view.dim"\` on segmented charts: \`column|bar|donut|pie|treemap|funnel\`), \`pivot-by="view.dim2"\`, \`.query=\${{ fields: [...], filters: ..., sorts: [...], limit: '500' }}\`, \`.filters=\${this.getEffectiveFilters()}\`, \`.options=\${{ chart: { spacing: [10, 15, 10, 10] } }}\`, \`bare\`, \`cell\`.
- \`<app-grid>\`: \`title\`, \`height="420px"\`, \`show-row-count\`, \`.query=\${{ fields: [...], filters: ..., sorts: [...], limit: String(this.topLimit || '50') }}\`, \`.filters=\${this.getEffectiveFilters()}\`, \`.columnDefs=\${[ { field: 'view.id', headerName: 'ID', width: 110 }, createCurrencyCol({ field: 'view.revenue', headerName: 'Revenue' }) ]}\`, \`@app-grid-row-click=\${(e) => { this.selectedRow = e.detail.row; }}\`.
- \`<app-select>\`: \`label\`, \`.value=\${this.val}\`, \`.options=\${['All', ...]}\` or \`[{ label, value }]\`, \`@change=\${(e) => { this.val = e.detail.value; }}\`.

## 3. Layout & Dark Theme (\`.da-*\`)
- Layout wrappers use standard HTML elements: \`.da-container\`, \`.da-header\`, \`.da-filter-bar\`, \`.da-tabs\`, \`.da-tab-btn\` (\`.active\`), \`.da-kpi-grid\`, \`.da-grid-1\`, \`.da-grid-2\`, \`.da-grid-3\`, \`.da-grid-2-1\`, \`.da-grid-1-2\`, \`.da-section-card\`.
- Dark mode: set \`this.isDark = true\` in \`constructor()\`, render \`<div class="da-container \${this.isDark ? 'dark-theme' : ''}">\`, and include \`\${this.renderThemeToggle()}\` in header. Use CSS variables (\`--app-bg\`, \`--app-card-bg\`, \`--app-border\`, \`--app-text\`, \`--app-muted\`, \`--app-primary\`) — never mutate \`document.body\` directly or use inline \`onclick=\` / \`localStorage\`.

## 4. Static Widget Extraction & Dynamic Metric Switchers
- \`bundle_app.py\` statically extracts every \`<app-kpi>\`, \`<app-chart>\`, and \`<app-grid>\` query at publish time.
- For dynamic metric switchers (\`this.selectedMetric\`), initialize \`this.selectedMetric = 'view.default_measure'\` in \`constructor()\`, and include ALL candidate metric fields in \`<app-grid>\` \`.query.fields\` so every \`.columnDefs\` \`field\` is present in \`.query.fields\`.
- Write, verify, and bundle in a single sandbox call:
  \`python3 /workspace/bundle_app.py --stdin "<App Title>" << 'EOF'\`
`

export const BUNDLE_APP_PY = `#!/usr/bin/env python3
"""Self-contained sandbox verifier, widget query extractor, and bundler for Looker Data Apps."""
import base64, json, os, sys, zlib
from pathlib import Path

TOOLKIT_DIR = Path(os.environ.get("TOOLKIT_DIR", "/workspace/toolkit"))
DEFAULT_VERSION = "1.2.0"
_CORE_B64 = "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"
exec(zlib.decompress(base64.b64decode(_CORE_B64)).decode("utf-8"), globals())

def ensure_toolkit() -> str:
    vf = TOOLKIT_DIR / "VERSION"
    return vf.read_text(encoding="utf-8").strip() if vf.is_file() and vf.read_text(encoding="utf-8").strip() else DEFAULT_VERSION

def main():
    args = sys.argv[1:]
    if not args:
        sys.exit("Usage: python3 /workspace/bundle_app.py <path/to/app.js> [title] OR --stdin [title] [output_path]")
    if args[0] == "--stdin":
        title = args[1] if len(args) > 1 else "Data App"
        app_path = Path(args[2] if len(args) > 2 else "/workspace/apps/current/app.js").resolve()
        app_path.parent.mkdir(parents=True, exist_ok=True)
        app_path.write_text(sys.stdin.read(), encoding="utf-8")
    else:
        app_path, title = Path(args[0]).resolve(), (args[1] if len(args) > 1 else "Data App")
        if not app_path.is_file():
            sys.exit(f"error: {app_path} does not exist")

    version = ensure_toolkit()
    syn = check_syntax(app_path)
    if not syn.get("ok"):
        print(json.dumps({"stage": "syntax", "error": syn}, indent=2), file=sys.stderr)
        sys.exit(1)
    safety, warnings = check_tile_safety(app_path), check_composition(app_path)
    if safety:
        print(json.dumps({"stage": "safety", "violations": safety}, indent=2), file=sys.stderr)
        sys.exit(1)
    extraction = extract_widget_queries(app_path)
    if extraction.stamped_code is None:
        print(json.dumps({"stage": "widget_extraction", "error": extraction.error}, indent=2), file=sys.stderr)
        sys.exit(1)
    runtime_url, vendor_url = resolve_shared_urls({}, TOOLKIT_DIR, version)
    bundle = {
        "title": title,
        "version": version,
        "raw_code": app_path.read_text(encoding="utf-8"),
        "prod_code": prepare_production_content(extraction.stamped_code, runtime_url, vendor_url),
        "widgets": extraction.widgets,
        "warnings": list(warnings) + list(extraction.warnings),
    }
    try:
        Path("/workspace/bundle.json").write_text(json.dumps(bundle), encoding="utf-8")
    except Exception:
        pass
    print("<DATA_APP_BUNDLE>" + json.dumps(bundle) + "</DATA_APP_BUNDLE>")

if __name__ == "__main__":
    main()
`

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

export function extractNativeContentFromInteraction(
  interaction: any
): NativeContentBundle | null {
  const combined = collectInteractionTextCandidates(interaction)
  const matches = Array.from(
    combined.matchAll(/<NATIVE_CONTENT_BUNDLE>([\s\S]*?)<\/NATIVE_CONTENT_BUNDLE>/g)
  )
  if (matches.length > 0) {
    return JSON.parse(matches[matches.length - 1][1].trim()) as NativeContentBundle
  }
  // ponytail: fallback to inspecting the last run_looker_codemode function_result if agent omitted the tag
  for (const step of [...(interaction?.steps || [])].reverse()) {
    if (step?.type === 'function_result' && step?.name === 'run_looker_codemode') {
      try {
        const r = typeof step.result === 'string' ? JSON.parse(step.result) : step.result
        const id = r?.dashboard_id || r?.look_id || r?.board_id || r?.id
        if (id) {
          const cType = r?.look_id ? 'look' : r?.board_id ? 'board' : r?.content_type || 'dashboard'
          return {
            id: String(id),
            content_type: cType,
            title: String(r.title || `Native ${cType} #${id}`),
            folder_id: r.folder_id ? String(r.folder_id) : undefined,
            embed_path: r.embed_path,
            tile_count: r.tile_count,
            filter_count: r.filter_count,
            schedule_id: r.schedule_id ? String(r.schedule_id) : undefined,
            explores: Array.isArray(r.explores) ? r.explores : undefined,
          }
        }
      } catch {
        // Ignore non-JSON codemode outputs
      }
    }
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
  stats: { agentWallMs: number; pollWaitMs: number; pollCount: number; codemodeExecMs: number; codemodeCalls: number; lookerHttpCalls: number }
): AntigravityTurnTelemetry {
  const steps: any[] = interaction?.steps || []
  const bashCalls = steps.filter(
    (s) => s?.type === 'code_execution' || s?.type === 'executable_code' || (s?.type === 'function_call' && s?.name !== 'run_looker_codemode')
  ).length
  const verifyRetries = steps.filter((s) =>
    /"stage":\s*"(?:syntax|safety|widget_extraction)"/.test(String(s?.output || s?.stderr || s?.result || ''))
  ).length
  const usage = interaction?.usage || interaction?.usage_metadata || {}
  return {
    agent_wall_ms: stats.agentWallMs,
    poll_wait_ms: stats.pollWaitMs,
    poll_count: stats.pollCount,
    codemode_exec_ms: stats.codemodeExecMs,
    tool_calls: { bash: bashCalls || Number(interaction?.bash_calls || 0), codemode: stats.codemodeCalls, looker_http: stats.lookerHttpCalls },
    tokens: {
      input: Number(usage.input_tokens ?? usage.prompt_token_count ?? 0),
      output: Number(usage.output_tokens ?? usage.candidates_token_count ?? 0),
      thought: Number(usage.thought_tokens ?? usage.thoughts_token_count ?? 0),
    },
    verify_retries: verifyRetries,
  }
}

export async function runAntigravityTurn(params: {
  sdk: Looker40SDK
  extensionSDK?: any
  auth: AntigravityAuth
  session: AgentSession
  mode?: 'data_app' | 'dashboard'
  selectedExplores: string[]
  folderId?: string
  toolMode?: 'data_app' | 'lookml'
  lookmlProjectId?: string
  activatedLookmlSkills?: string[]
  schemaMarkdown: string
  userPrompt: string
  images?: PastedImage[]
  existingAppCode?: string
  existingNativeContent?: NativeContentState | null
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
  let codemodeCalls = 0
  let lookerHttpCalls = 0

  const {
    sdk,
    extensionSDK,
    auth,
    session,
    mode = 'data_app',
    selectedExplores,
    folderId,
    toolMode = 'data_app',
    lookmlProjectId,
    activatedLookmlSkills,
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

  const existingNativeDirective = existingNativeContent
    ? `Active native Looker ${existingNativeContent.contentType}: id="${existingNativeContent.id}", title="${existingNativeContent.title}", folder_id="${existingNativeContent.folderId}". Update it in place (e.g. update_dashboard, create_dashboard_element, create_dashboard_filter, update_look, create_scheduled_plan) unless the user asks for a brand-new item.`
    : `Create the requested native Looker content in folder_id=\`target_folder_id\` ("${folderId || '1'}").`

  const dataAppOrNativeGuide =
    mode === 'dashboard'
      ? [
          `You are operating in Native Looker Content Builder mode (/dashboard/:id?) ${exploreDirective}`,
          existingNativeDirective,
          `Follow these exact steps:`,
          `1. ${step2Directive.replace(/^2\.\s*/, '')}`,
          `2. Use \`run_looker_codemode\` (with \`target_folder_id\`="${folderId || '1'}", \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel}", \`target_explore\`="${primaryExplore}") to build or update standard Looker content:`,
          `   - User-Defined Dashboards (UDDs): \`create_dashboard({"title": "...", "folder_id": target_folder_id})\` or \`update_dashboard(id, {...})\`, \`create_query({"model": ..., "view": ..., "fields": [...], "filters": {...}, "sorts": [...], "vis_config": {"type": "single_value"|"looker_column"|"looker_line"|"looker_grid", ...}})\`, \`create_dashboard_element({"dashboard_id": dash_id, "title": "...", "type": "vis", "query_id": q["id"]})\`, and \`create_dashboard_filter({"dashboard_id": dash_id, "name": "...", "title": "...", "type": "field_filter", "model": ..., "explore": ..., "dimension": ..., "allow_multiple_values": True})\`.`,
          `   - Saved Looks: \`create_query(...)\` + \`create_look({"title": "...", "folder_id": target_folder_id, "query_id": q["id"]})\` or \`update_look(look_id, {...})\`.`,
          `   - Boards: \`create_board({"title": "...", "description": "..."})\` + \`create_board_section({"board_id": b["id"], "title": "..."})\` + \`create_board_item({"board_section_id": s["id"], "dashboard_id": ...})\`.`,
          `   - Schedules: \`create_scheduled_plan({"name": "...", "dashboard_id": dash_id, "crontab": "0 9 * * 1", "scheduled_plan_destination": [{"format": "wysiwyg_pdf", "address": "...", "type": "email"}]})\`.`,
          `3. CRITICAL: In your final text response, include \`<NATIVE_CONTENT_BUNDLE>{"id":"<id>","content_type":"dashboard"|"look"|"board","title":"<Title>","folder_id":"<folder_id>","embed_path":"/embed/dashboards/<id>"|"/embed/looks/<id>"|"/boards/<id>","tile_count":<n>,"filter_count":<n>,"explores":["<model>::<explore>"]}</NATIVE_CONTENT_BUNDLE>\` so the host extension can preview and index the content.`,
        ].join('\n')
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
        })
      : dataAppOrNativeGuide)

  const sources: Array<{ type: 'inline'; content: string; target: string }> = [
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

  const activeTools = [
    { type: 'code_execution' },
    LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL,
  ]

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

  const buildFreshPayload = (): Record<string, any> => ({
    agent: 'antigravity-preview-09-2026',
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
            return origRawReq.apply(rawTransport, reqArgs)
          }
        }
        let resultsInput: any[]
        try {
          resultsInput = await Promise.all(
            pendingLookerCalls.map(async (call: any) => {
              const args = call.arguments || call.args || {}
              let codeModeOutput: string
              try {
                const customVars =
                  args.vars && typeof args.vars === 'object' && !Array.isArray(args.vars)
                    ? args.vars
                    : {}
                codeModeOutput = await LkrCodeMode.runPythonCode({
                  code: String(args.code || ''),
                  sdk,
                  extensionSDK,
                  allowUpdateSession: toolMode === 'lookml',
                  requirePermission,
                  approvedOperations,
                  onPermissionRequest,
                  vars: {
                    target_explores: selectedExplores,
                    target_model: primaryModel,
                    target_explore: primaryExplore,
                    target_folder_id: folderId || '1',
                    target_project_id: lookmlProjectId || '',
                    ...customVars,
                  },
                })
              } catch (err: any) {
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
    codemodeCalls,
    lookerHttpCalls,
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
      const pre = await callInteractionsApi(
        extensionSDK,
        auth,
        'interactions',
        'POST',
        {
          agent: 'antigravity-preview-09-2026',
          background: true,
          tools: [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL],
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
