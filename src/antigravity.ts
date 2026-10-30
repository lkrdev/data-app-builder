import type { Looker40SDK } from '@looker/sdk'
import { DataAppBundle, parseExploreId } from './lookerApi'
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const LkrCodeMode = require('./vendor/codemode.js')

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

export interface AgentSession {
  environmentId?: string
  lastInteractionId?: string
  explores?: string[]
}

export interface PastedImage {
  mimeType: string
  data: string // base64 without data: prefix
  dataUrl: string
}

export const BUNDLE_APP_PY = `#!/usr/bin/env python3
"""Sandbox helper that unpacks the official Looker Data Apps toolkit,
verifies syntax + tile safety rules via verify-app.py, extracts widget
queries via widget_extractor.py, rewrites production runtime URLs via
publish-data-app.py, and emits <DATA_APP_BUNDLE>{...}</DATA_APP_BUNDLE>.
"""
import importlib.util
import json
import os
import sys
import tarfile
import urllib.request
from pathlib import Path

TOOLKIT_DIR = Path(os.environ.get("TOOLKIT_DIR", "/workspace/toolkit"))
PREFIX_URL = "https://dl.google.com/looker-data-apps"

def ensure_toolkit() -> str:
    version_file = TOOLKIT_DIR / "VERSION"
    if (TOOLKIT_DIR / "skills").is_dir() and version_file.is_file():
        return version_file.read_text(encoding="utf-8").strip()
    TOOLKIT_DIR.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{PREFIX_URL}/latest-version.txt", timeout=15) as r:
        version = r.read().decode("utf-8").strip() or "1.2.0"
    tar_path = TOOLKIT_DIR / "looker-data-apps.tar.gz"
    urllib.request.urlretrieve(
        f"{PREFIX_URL}/versions/{version}/looker-data-apps.tar.gz", tar_path
    )
    with tarfile.open(tar_path, "r:gz") as tf:
        tf.extractall(TOOLKIT_DIR)
    return version

def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python3 /workspace/bundle_app.py <path/to/app.js> [title]")
    app_path = Path(sys.argv[1]).resolve()
    title = sys.argv[2] if len(sys.argv) > 2 else "Data App"
    if not app_path.is_file():
        sys.exit(f"error: {app_path} does not exist")

    version = ensure_toolkit()
    verify_mod = load_module(
        "verify_app",
        TOOLKIT_DIR / "skills/data-app-creator/tools/verify-app.py",
    )
    pub_dir = TOOLKIT_DIR / "skills/data-app-publisher/tools"
    sys.path.insert(0, str(pub_dir))
    we_mod = load_module("widget_extractor", pub_dir / "widget_extractor.py")
    pub_mod = load_module("publish_data_app", pub_dir / "publish-data-app.py")

    syn = verify_mod.check_syntax(app_path)
    if not syn.get("ok"):
        print(json.dumps({"stage": "syntax", "error": syn}, indent=2), file=sys.stderr)
        sys.exit(1)

    safety = verify_mod.check_tile_safety(app_path)
    warnings = verify_mod.check_composition(app_path)
    if safety:
        print(json.dumps({"stage": "safety", "violations": safety}, indent=2), file=sys.stderr)
        sys.exit(1)

    raw_code = app_path.read_text(encoding="utf-8")
    extraction = we_mod.extract_widget_queries(app_path)
    if extraction.stamped_code is None:
        print(json.dumps({"stage": "widget_extraction", "error": extraction.error}, indent=2), file=sys.stderr)
        sys.exit(1)

    runtime_url, vendor_url = pub_mod.resolve_shared_urls({}, TOOLKIT_DIR)
    prod_code = pub_mod.prepare_production_content(
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
    Path("/workspace/bundle.json").write_text(json.dumps(bundle), encoding="utf-8")
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

function extractBundleFromInteraction(interaction: any): DataAppBundle | null {
  const candidates: string[] = []
  if (typeof interaction?.output_text === 'string') {
    candidates.push(interaction.output_text)
  }
  for (const out of interaction?.outputs || []) {
    if (typeof out?.text === 'string') candidates.push(out.text)
  }
  for (const step of interaction?.steps || []) {
    if (typeof step?.output === 'string') candidates.push(step.output)
    if (typeof step?.result === 'string') candidates.push(step.result)
    if (typeof step?.text === 'string') candidates.push(step.text)
  }
  const combined = candidates.join('\n')
  const matches = Array.from(
    combined.matchAll(/<DATA_APP_BUNDLE>([\s\S]*?)<\/DATA_APP_BUNDLE>/g)
  )
  if (matches.length === 0) return null
  const lastJson = matches[matches.length - 1][1].trim()
  return JSON.parse(lastJson) as DataAppBundle
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

export async function runAntigravityTurn(params: {
  sdk: Looker40SDK
  extensionSDK?: any
  auth: AntigravityAuth
  session: AgentSession
  selectedExplores: string[]
  folderId?: string
  schemaMarkdown: string
  userPrompt: string
  images?: PastedImage[]
  existingAppCode?: string
  priorMessages?: Array<{ role: string; text: string }>
  onStatus: (statusText: string) => void
}): Promise<{
  bundle: DataAppBundle | null
  assistantText: string
  session: AgentSession
}> {
  const {
    sdk,
    extensionSDK,
    auth,
    session,
    selectedExplores,
    folderId,
    schemaMarkdown,
    userPrompt,
    images,
    existingAppCode,
    priorMessages,
    onStatus,
  } = params

  const firstParsed = selectedExplores[0] ? parseExploreId(selectedExplores[0]) : null
  const primaryModel = firstParsed?.modelName || ''
  const primaryExplore = firstParsed?.exploreName || ''

  const isFreshEnvironment =
    !session.lastInteractionId ||
    JSON.stringify(session.explores || []) !== JSON.stringify(selectedExplores)

  const exploreDirective =
    selectedExplores.length > 0
      ? `for selected Looker explore(s): ${selectedExplores.map((id) => `"${id}"`).join(', ')}.`
      : `where no explore was pre-selected — YOU decide which Looker explore(s) ("model_id::explore_id") from /workspace/schema.md best fit the user's request.`

  const step2Directive =
    selectedExplores.length > 0
      ? `2. Read /workspace/schema.md for the compiled Looker Explore schema(s) and sample rows. You also have the \`run_looker_codemode\` tool (WASM Monty Python sandbox in the Looker Extension with \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel}", and \`target_explore\`="${primaryExplore}" pre-injected, plus all Looker 4.0 SDK methods like \`lookml_model_explore\`, \`run_inline_query\`, \`search_content\`, \`help\`, \`lookup\`, \`lookup_type\`) to filter large schemas or run multiple dry-run queries in one round-trip.`
      : `2. Read /workspace/schema.md for the grouped catalog of all available Looker models and explores (\`model_id::explore_id\`). Because no explore was pre-selected, figure out which model(s) and explore(s) are best for the user's question by running a single \`run_looker_codemode\` Python snippet that:
   a) Calls Looker's Solr-backed hybrid search \`search_content(terms="<keywords>", types="lookml_explore,dashboard,look")\` (which ranks explores and popular content by semantic + keyword match and \`view_count\`), AND/OR picks candidate \`model_id::explore_id\` pairs from /workspace/schema.md,
   b) Fast-searches fields across candidate explores in one batch using partial responses: \`lookml_model_explore(model_id, explore_id, fields="name,label,description,fields(dimensions(name,label,description,type),measures(name,label,description,type))")\`, and
   c) Verifies sample data with \`run_inline_query("json", {"model": model_id, "view": explore_id, "fields": [...], "limit": "5"})\`.`

  const step3Directive =
    selectedExplores.length === 1
      ? `3. Write or update the Lit Data App in /workspace/apps/current/app.js importing from '/runtime/data-app.js'. Set this.lookerModel = '${primaryModel}' and this.explore = '${primaryExplore}' in the constructor (or looker-model="${primaryModel}" explore="${primaryExplore}" on widgets).`
      : `3. Write or update the Lit Data App in /workspace/apps/current/app.js importing from '/runtime/data-app.js'. Set this.lookerModel and this.explore in the constructor for your primary explore, and set looker-model="<model_id>" explore="<explore_id>" on any widget querying another explore.`

  const systemGuide = [
    `You are building a Looker Data App (Lit web component using Looker's data-app.js runtime) ${exploreDirective}`,
    `Follow these exact steps inside your Linux sandbox:`,
    `1. If /workspace/toolkit/skills does not exist yet, run: PYTHONPATH=/workspace python3 -c "import bundle_app; bundle_app.ensure_toolkit()" and read /workspace/toolkit/skills/data-app-creator/SKILL.md and /workspace/toolkit/skills/data-app-creator/reference/LIT_DATA_APPS.md.`,
    step2Directive,
    step3Directive,
    `4. Run: python3 /workspace/bundle_app.py /workspace/apps/current/app.js "<App Title>"`,
    `   - Fix any syntax or tile safety errors reported by bundle_app.py and re-run until it succeeds.`,
    `5. CRITICAL: In your final text response, include the exact <DATA_APP_BUNDLE>...</DATA_APP_BUNDLE> line printed by bundle_app.py (or read it from /workspace/bundle.json) so the host Looker extension can publish and preview the app.`,
  ].join('\n')

  const sources: Array<{ type: 'inline'; content: string; target: string }> = [
    { type: 'inline', content: schemaMarkdown, target: '/workspace/schema.md' },
    { type: 'inline', content: BUNDLE_APP_PY, target: '/workspace/bundle_app.py' },
  ]
  if (existingAppCode) {
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

  const buildInputItems = (fresh: boolean): Array<Record<string, any>> => [
    {
      type: 'text',
      text: fresh
        ? `${systemGuide}${historyDigest}\n\nUser request:\n${userPrompt}`
        : userPrompt,
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
        const resultsInput: any[] = []
        for (const call of pendingLookerCalls) {
          const args = call.arguments || call.args || {}
          onStatus('Running Looker Code Mode (WASM Monty sandbox) in extension...')
          let codeModeOutput: string
          try {
            codeModeOutput = await LkrCodeMode.runPythonCode({
              code: String(args.code || ''),
              sdk,
              extensionSDK,
              vars: {
                target_explores: selectedExplores,
                target_model: primaryModel,
                target_explore: primaryExplore,
                target_folder_id: folderId || '1',
              },
            })
          } catch (err: any) {
            codeModeOutput = JSON.stringify({
              ok: false,
              error: err?.message || String(err),
            })
          }
          resultsInput.push({
            type: 'function_result',
            name: 'run_looker_codemode',
            call_id: call.id,
            result: codeModeOutput,
          })
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
        continue
      }
    }

    onStatus(summarizeProgress(interaction))
    await new Promise((r) => setTimeout(r, 2500))
    interaction = await callInteractionsApi(
      extensionSDK,
      auth,
      `interactions/${encodeURIComponent(interaction.id)}`,
      'GET'
    )
    if (interaction.environment_id) {
      trackedEnvId = interaction.environment_id
    }
  }

  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    throw new Error(
      `Antigravity interaction ${interaction.status}: ${
        interaction.error?.message || JSON.stringify(interaction.error || interaction)
      }`
    )
  }

  const bundle = extractBundleFromInteraction(interaction)
  const rawText =
    interaction.output_text ||
    (interaction.outputs || []).map((o: any) => o.text || '').join('\n') ||
    'Completed.'
  const cleanAssistantText = rawText
    .replace(/<DATA_APP_BUNDLE>[\s\S]*?<\/DATA_APP_BUNDLE>/g, '')
    .trim()

  return {
    bundle,
    assistantText: cleanAssistantText || (bundle ? `Built "${bundle.title}".` : 'Done.'),
    session: {
      environmentId: interaction.environment_id || trackedEnvId,
      lastInteractionId: interaction.id,
      explores: selectedExplores,
    },
  }
}
