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
"""Self-contained sandbox verifier, widget query extractor, and bundler for Looker Data Apps.
Supports both:
  python3 /workspace/bundle_app.py --stdin "<App Title>" [output_path]
  python3 /workspace/bundle_app.py <path/to/app.js> [title]
Runs syntax check, AST tile safety rules, static widget query extraction (including
dynamic metric switchers), rewrites production runtime URLs, and emits
<DATA_APP_BUNDLE>{...}</DATA_APP_BUNDLE> with zero network downloads.
"""
import base64
import json
import os
import sys
import zlib
from pathlib import Path

TOOLKIT_DIR = Path(os.environ.get("TOOLKIT_DIR", "/workspace/toolkit"))
DEFAULT_VERSION = "1.2.0"
_CORE_B64 = "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"
exec(zlib.decompress(base64.b64decode(_CORE_B64)).decode("utf-8"), globals())

def ensure_toolkit() -> str:
    version_file = TOOLKIT_DIR / "VERSION"
    if version_file.is_file():
        try:
            v = version_file.read_text(encoding="utf-8").strip()
            if v:
                return v
        except Exception:
            pass
    return DEFAULT_VERSION

def main():
    args = sys.argv[1:]
    if not args:
        sys.exit("Usage: python3 /workspace/bundle_app.py <path/to/app.js> [title] OR --stdin [title] [output_path]")
    if args[0] == "--stdin":
        title = args[1] if len(args) > 1 else "Data App"
        app_path = Path(args[2] if len(args) > 2 else "/workspace/apps/current/app.js").resolve()
        app_path.parent.mkdir(parents=True, exist_ok=True)
        stdin_code = sys.stdin.read()
        if not stdin_code.strip():
            sys.exit("error: --stdin received empty input")
        app_path.write_text(stdin_code, encoding="utf-8")
    else:
        app_path = Path(args[0]).resolve()
        title = args[1] if len(args) > 1 else "Data App"
        if not app_path.is_file():
            sys.exit(f"error: {app_path} does not exist")

    version = ensure_toolkit()
    syn = check_syntax(app_path)
    if not syn.get("ok"):
        print(json.dumps({"stage": "syntax", "error": syn}, indent=2), file=sys.stderr)
        sys.exit(1)

    safety = check_tile_safety(app_path)
    warnings = check_composition(app_path)
    if safety:
        print(json.dumps({"stage": "safety", "violations": safety}, indent=2), file=sys.stderr)
        sys.exit(1)

    raw_code = app_path.read_text(encoding="utf-8")
    extraction = extract_widget_queries(app_path)
    if extraction.stamped_code is None:
        print(json.dumps({"stage": "widget_extraction", "error": extraction.error}, indent=2), file=sys.stderr)
        sys.exit(1)

    runtime_url, vendor_url = resolve_shared_urls({}, TOOLKIT_DIR, version)
    prod_code = prepare_production_content(
        extraction.stamped_code, runtime_url, vendor_url
    )

    bundle = {
        "title": title,
        "version": version,
        "raw_code": raw_code,
        "prod_code": prod_code,
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
  runtimeStats: {
    agentWallMs: number
    pollWaitMs: number
    pollCount: number
    codemodeExecMs: number
    codemodeCalls: number
    lookerHttpCalls: number
  }
): AntigravityTurnTelemetry {
  const steps: any[] = interaction?.steps || []
  let bashCalls = 0
  let verifyRetries = 0
  for (const s of steps) {
    const isCodeExec =
      s?.type === 'code_execution' ||
      s?.type === 'executable_code' ||
      (s?.type === 'function_call' && s?.name !== 'run_looker_codemode')
    if (isCodeExec) bashCalls += 1
    const out = String(s?.output || s?.stderr || s?.result || '')
    if (
      out.includes('"stage": "syntax"') ||
      out.includes('"stage": "safety"') ||
      out.includes('"stage": "widget_extraction"')
    ) {
      verifyRetries += 1
    }
  }
  const usage = interaction?.usage || interaction?.usage_metadata || {}
  return {
    agent_wall_ms: runtimeStats.agentWallMs,
    poll_wait_ms: runtimeStats.pollWaitMs,
    poll_count: runtimeStats.pollCount,
    codemode_exec_ms: runtimeStats.codemodeExecMs,
    tool_calls: {
      bash: bashCalls || Number(interaction?.bash_calls || 0),
      codemode: runtimeStats.codemodeCalls,
      looker_http: runtimeStats.lookerHttpCalls,
    },
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

  const step3Directive =
    selectedExplores.length === 1
      ? `3. Write and bundle the Lit Data App in ONE \`code_execution\` call importing from '/runtime/data-app.js' (with \`this.lookerModel = '${primaryModel}'\` and \`this.explore = '${primaryExplore}'\` in \`constructor()\`):
   \`python3 /workspace/bundle_app.py --stdin "<App Title>" << 'EOF'\\n...\\nEOF\``
      : `3. Write and bundle the Lit Data App in ONE \`code_execution\` call importing from '/runtime/data-app.js' (setting \`this.lookerModel\` and \`this.explore\` in \`constructor()\`):
   \`python3 /workspace/bundle_app.py --stdin "<App Title>" << 'EOF'\\n...\\nEOF\``

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
