import type { Looker40SDK } from '@looker/sdk'

import {
  callInteractionsApi,
  fetchEnvironmentFile,
  normalizeSandboxFilePath,
} from './antigravityAuth'
import {
  AGENTS_MD,
  BUNDLE_APP_PY,
  DATA_APP_GUIDE_MD,
  DATA_INVESTIGATOR_GUIDE_MD,
  LOOKER_PROJECT_ONBOARDING_SKILL_MD,
} from './antigravityPrompts'
import {
  LOOKER_ALERTS_SKILL_MD,
  LOOKER_DASHBOARD_SKILL_MD,
  LOOKER_FIELD_PROFILER_SKILL_MD,
} from './antigravityStarters'
import {
  BUILTIN_SKILLS_FILES,
  BUILTIN_WORKSPACE_FILES,
  type ConversationThreadTurnLike,
  extractBundleFromInteraction,
  extractInteractionActivitySteps,
  extractInteractionOutputText,
  extractNativeContentFromInteraction,
  extractNonThoughtText,
  extractTddFromInteraction,
  extractThoughtText,
  formatConversationThreadMarkdown,
  parseStepArguments,
  SANDBOX_AGENT_SKILL_FILES,
} from './antigravitySteps'
import {
  type AgentSession,
  type AntigravityActivityStep,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  type AntigravityInteractionStep,
  type AntigravityToolType,
  DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_MAX_TOTAL_TOKENS,
  getSharedEnvExploreSchemas,
  inFlightEnvProvisionByUser,
  isEnvironmentNotFoundError,
  normalizeEnvironmentId,
  resolveUserProvisionKey,
} from './antigravityTypes'
import {
  type DataAppBundle,
  getArtifactNamespace,
  type NativeContentBundle,
  saveUserEnvironmentId,
} from './lookerApi'
import { KDA_SKILL_MD, KDA_TOOLKIT_PY } from './lookmlSkills'
import {
  BOOTSTRAP_LOOKML_PY,
  BOOTSTRAP_SANDBOX_SH,
  extractLookmlBundleFromInteraction,
  LKR_CLI_SITECUSTOMIZE_PY,
  LKR_DEV_CLI_SPEC,
  LkrCodeMode,
  type LookmlBundle,
} from './lookmlTool'

export const toSafeConversationId = (rawId?: string, session?: AgentSession): string =>
  String(rawId || session?.conversationId || session?.objectId || 'current')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_') || 'current'

export function withCoalescedEnvProvision<T>(
  userProvisionKey: string,
  task: () => Promise<{ envId: string; value: T }>
): Promise<T> {
  const promise = task()
  const envPromise = promise.then((r) => r.envId)
  envPromise.catch(() => {})
  inFlightEnvProvisionByUser.set(userProvisionKey, envPromise)
  return promise.then((r) => r.value).finally(() => {
    if (inFlightEnvProvisionByUser.get(userProvisionKey) === envPromise) {
      inFlightEnvProvisionByUser.delete(userProvisionKey)
    }
  })
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
    { type: 'inline', content: DATA_APP_GUIDE_MD, target: '/workspace/skills/data-apps/SKILL.md' },
    { type: 'inline', content: DATA_INVESTIGATOR_GUIDE_MD, target: '/workspace/skills/data-investigator/SKILL.md' },
    { type: 'inline', content: KDA_SKILL_MD, target: '/workspace/skills/key-driver-analysis/SKILL.md' },
    { type: 'inline', content: KDA_TOOLKIT_PY, target: '/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py' },
    { type: 'inline', content: LOOKER_DASHBOARD_SKILL_MD, target: '/workspace/skills/looker-dashboard/SKILL.md' },
    { type: 'inline', content: LOOKER_FIELD_PROFILER_SKILL_MD, target: '/workspace/skills/looker-field-profiler/SKILL.md' },
    { type: 'inline', content: LOOKER_ALERTS_SKILL_MD, target: '/workspace/skills/looker-alerts/SKILL.md' },
    {
      type: 'inline',
      content: LOOKER_PROJECT_ONBOARDING_SKILL_MD,
      target: '/workspace/skills/looker-project-onboarding/SKILL.md',
    },
    {
      type: 'inline',
      content: BUILTIN_SKILLS_FILES['lookml-snapshot'],
      target: '/workspace/skills/lookml-snapshot/SKILL.md',
    },
    ...Object.entries(SANDBOX_AGENT_SKILL_FILES).map(([relPath, content]) => ({
      type: 'inline' as const,
      content,
      target: `/workspace/skills/${relPath}`,
    })),
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

export function persistUserEnvIfChanged(params: {
  sdk?: Looker40SDK
  extensionSDK?: AntigravityExtensionHostLike
  userId?: string
  previousEnvId?: string
  nextEnvId?: string
  onEnvironmentUpdated?: (environmentId: string) => void | Promise<void>
}): Promise<void> {
  const next = normalizeEnvironmentId(params.nextEnvId)
  if (!next || next === normalizeEnvironmentId(params.previousEnvId)) return Promise.resolve()
  return Promise.resolve(params.onEnvironmentUpdated?.(next)).then(() => {
    if (!params.sdk || typeof (params.sdk as Partial<Looker40SDK>).update_artifacts !== 'function') return
    const explicitUid = String(params.userId || '').trim()
    const uidPromise =
      explicitUid || typeof (params.sdk as Partial<Looker40SDK>).me !== 'function'
        ? Promise.resolve(explicitUid)
        : Promise.resolve(params.sdk.ok ? params.sdk.ok(params.sdk.me('id')) : params.sdk.me('id')).then(
            (me) => String((me as { id?: string | number } | undefined)?.id || '').trim(),
            () => ''
          )
    return uidPromise.then((uid) =>
      uid ? saveUserEnvironmentId(params.sdk!, uid, next, getArtifactNamespace(params.extensionSDK)).then(() => {}) : undefined
    )
  })
}

// ponytail: pre-launch or wake a single per-user Antigravity remote environment shared across
// tool modes (app, dashboard, lookml, health, tile), with automatic 404 environment recovery.
export function prewarmOrWakeAntigravityEnvironment(params: {
  sdk?: Looker40SDK
  userId?: string
  extensionSDK: AntigravityExtensionHostLike
  auth: AntigravityAuth
  toolType: AntigravityToolType
  model?: string
  maxTotalTokens?: number
  environmentId?: string
  conversationId?: string
  existingSession?: AgentSession
  selectedExplores?: string[]
  schemaMarkdown?: string
  existingAppCode?: string
  extraSources?: Array<{ type: 'inline'; content: string; target: string }>
  forceFresh?: boolean
  onEnvironmentUpdated?: (environmentId: string) => void | Promise<void>
}): Promise<{ session: AgentSession; status: 'woken' | 'prelaunched' | 'standby' }> {
  const {
    sdk, userId, extensionSDK, auth, toolType, model = DEFAULT_ANTIGRAVITY_MODEL,
    maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS, environmentId, conversationId: rawConversationId,
    existingSession, selectedExplores = [], schemaMarkdown = '', existingAppCode, extraSources = [],
    forceFresh = false, onEnvironmentUpdated,
  } = params
  const appFilePath = `/workspace/apps/${toSafeConversationId(rawConversationId, existingSession)}/app.js`
  const initialEnvId = forceFresh ? undefined : normalizeEnvironmentId(environmentId || existingSession?.environmentId)
  let activeEnvId = initialEnvId
  const canAuth = Boolean(auth.mode === 'apikey' || auth.oauthToken)
  const persistEnv = (nextEnvId?: string) =>
    persistUserEnvIfChanged({ sdk, extensionSDK, userId, previousEnvId: initialEnvId, nextEnvId, onEnvironmentUpdated })
  const standby = () => ({
    session: {
      environmentId: activeEnvId || existingSession?.environmentId || `env_${toolType}_isolated`,
      lastInteractionId: existingSession?.lastInteractionId,
      explores: selectedExplores,
      toolType,
    },
    status: 'standby' as const,
  })

  const step2WakeOrProvision = (): Promise<{ session: AgentSession; status: 'woken' | 'prelaunched' | 'standby' }> => {
    if (!canAuth) return Promise.resolve(standby())
    const prewarmTools =
      toolType === 'dashboard'
        ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
        : [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    const resolvedMaxTokens = Number(maxTotalTokens) > 0 ? Number(maxTotalTokens) : DEFAULT_MAX_TOTAL_TOKENS
    const prewarmBase = {
      agent: 'antigravity-preview-09-2026',
      agent_config: { type: 'antigravity', model: model || DEFAULT_ANTIGRAVITY_MODEL, max_total_tokens: String(resolvedMaxTokens) },
      background: true,
      tools: prewarmTools,
      input: [{ type: 'text', text: `[PREWARM:${toolType.toUpperCase()}] Initialize ${toolType} workspace${toolType === 'lookml' ? ' (ensure `command -v lkr >/dev/null 2>&1 || python3 /workspace/bootstrap_lookml.py cli`)' : ''} and reply READY.` }],
    }
    const userProvisionKey = resolveUserProvisionKey(userId, auth)
    const coalesceStep =
      !forceFresh && !activeEnvId && inFlightEnvProvisionByUser.has(userProvisionKey)
        ? inFlightEnvProvisionByUser.get(userProvisionKey)!.then(
            (id) => { const c = normalizeEnvironmentId(id); if (c) activeEnvId = c },
            () => {}
          )
        : Promise.resolve()

    const provisionFresh = () =>
      withCoalescedEnvProvision(userProvisionKey, () => {
        const sources = buildWorkspaceSources({
          schemaMarkdown, appFilePath, existingAppCode: toolType === 'app' ? existingAppCode : undefined,
          cachedExploreSchemas: getSharedEnvExploreSchemas(activeEnvId), extraSources,
        })
        return callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
          ...prewarmBase,
          tools: [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL],
          input: [{
            type: 'text',
            text: `[PREWARM:${toolType.toUpperCase()}] Initialize ${toolType} workspace: run \`python3 /workspace/bootstrap_lookml.py cli\` (${BOOTSTRAP_SANDBOX_SH}) so \`uv\` and \`${LKR_DEV_CLI_SPEC}\` are installed in \`/usr/local/bin\`, then reply READY.`,
          }],
          environment: { type: 'remote', sources },
        }).then((pre) => {
          const newEnvId = normalizeEnvironmentId(pre?.environment_id) || `env_${toolType}_${Date.now().toString(36).slice(-4)}`
          return persistEnv(newEnvId).then(() => ({
            envId: newEnvId,
            value: {
              session: {
                ...existingSession,
                environmentId: newEnvId,
                lastInteractionId: forceFresh ? undefined : existingSession?.lastInteractionId,
                explores: selectedExplores,
                toolType,
              },
              status: 'prelaunched' as const,
            },
          }))
        })
      }).catch(standby)

    return coalesceStep.then(() => {
      if (!activeEnvId) return provisionFresh()
      return callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', { ...prewarmBase, environment: activeEnvId }).then(
        (woken) => {
          const resolvedEnvId = normalizeEnvironmentId(woken?.environment_id) || activeEnvId!
          return persistEnv(resolvedEnvId).then(() => ({
            session: { ...existingSession, environmentId: resolvedEnvId, explores: selectedExplores, toolType },
            status: 'woken' as const,
          }))
        },
        (err) => {
          if (!isEnvironmentNotFoundError(err)) {
            return { session: { ...existingSession, environmentId: activeEnvId, explores: selectedExplores, toolType }, status: 'woken' as const }
          }
          activeEnvId = undefined
          return provisionFresh()
        }
      )
    })
  }

  if (!forceFresh && existingSession?.lastInteractionId && (!existingSession.toolType || existingSession.toolType === toolType)) {
    if (!canAuth) {
      return Promise.resolve({
        session: { ...existingSession, environmentId: activeEnvId || existingSession.environmentId || `env_${toolType}_warm`, toolType },
        status: 'woken',
      })
    }
    return callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(existingSession.lastInteractionId)}`, 'GET').then(
      (res) => {
        const resolvedEnvId = normalizeEnvironmentId(res?.environment_id) || activeEnvId || `env_${toolType}`
        return persistEnv(resolvedEnvId).then(() => ({
          session: { ...existingSession, environmentId: resolvedEnvId, toolType },
          status: 'woken' as const,
        }))
      },
      (err) => {
        if (isEnvironmentNotFoundError(err)) activeEnvId = undefined
        return step2WakeOrProvision()
      }
    )
  }
  return step2WakeOrProvision()
}

export function hydrateInteractionActivitySteps(opts: {
  extensionSDK?: AntigravityExtensionHostLike
  auth: AntigravityAuth
  interactionId: string
  stopAtInteractionId?: string
  maxHops?: number
}): Promise<AntigravityActivityStep[]> {
  const { extensionSDK, auth, maxHops = 105 } = opts
  const startId = String(opts.interactionId || '').trim()
  const stopId = String(opts.stopAtInteractionId || '').trim()
  const canFetch = Boolean(auth && (auth.mode === 'apikey' ? Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy) : Boolean(auth.oauthToken?.trim())))
  if (!startId || !canFetch) return Promise.resolve([])
  const chainNewestFirst: AntigravityInteractionPayload[] = []
  const seen = new Set<string>()
  const walk = (currId: string): Promise<void> => {
    if (!currId || currId === stopId || seen.has(currId) || seen.size >= maxHops) return Promise.resolve()
    seen.add(currId)
    return callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(currId)}`, 'GET').then(
      (fetched) => {
        const rawInput = JSON.stringify(fetched.input ?? '')
        if (rawInput.includes('[PREWARM:')) return
        chainNewestFirst.push({ ...fetched, id: fetched.id || currId })
        const isFreshUserTurnRoot =
          !stopId &&
          Array.isArray(fetched.input) &&
          fetched.input.some((it) => it && typeof it === 'object' && (it as { type?: string }).type === 'text') &&
          !rawInput.includes('[LKR_EXTENSION_BRIDGE_RESULT]') &&
          !rawInput.includes('Continue and complete the current request.') &&
          !rawInput.includes('You have not emitted <DATA_APP_BUNDLE> yet.') &&
          !rawInput.includes('Your previous bundle_app.py run failed') &&
          !rawInput.includes('Max Tool Rounds (') &&
          !fetched.input.some((it) => it && typeof it === 'object' && (it as { type?: string }).type === 'function_result')
        if (isFreshUserTurnRoot) return
        return walk(typeof fetched.previous_interaction_id === 'string' ? fetched.previous_interaction_id.trim() : '')
      },
      () => {}
    )
  }
  return walk(startId).then(() => {
    if (!chainNewestFirst.length) return []
    const chronological = chainNewestFirst.slice().reverse()
    const mergedSteps: AntigravityInteractionStep[] = []
    chronological.forEach((inter) => {
      if (Array.isArray(inter.input)) {
        inter.input.forEach((it) => {
          if (
            it &&
            typeof it === 'object' &&
            (it as { type?: string }).type === 'function_result' &&
            !(inter.steps?.[0]?.type === 'function_result' && inter.steps[0].call_id === (it as { call_id?: string }).call_id)
          ) {
            mergedSteps.push(it as AntigravityInteractionStep)
          }
        })
      }
      if (Array.isArray(inter.steps)) mergedSteps.push(...inter.steps)
    })
    const latest = chronological[chronological.length - 1]
    return extractInteractionActivitySteps({ ...latest, id: startId, status: 'completed', steps: mergedSteps }).map((s) => ({
      ...s,
      status: 'done' as const,
    }))
  })
}

export type StudioBundlePayload = DataAppBundle
export type LookerNativeContentBundle = NativeContentBundle
export type LookmlSessionBundle = LookmlBundle

export const stripControlTags = (rawText: string): string =>
  String(rawText || '')
    .replace(/<(USE_CASE|CA_AGENT_SELECTION|DATA_APP_BUNDLE|NATIVE_CONTENT_BUNDLE|LOOKML_BUNDLE|ALERT_BUNDLE|HEALTH_CHECK_TDD|LKR_EXTENSION_TOOL_REQUEST)>[\s\S]*?<\/\1>/gi, '')
    .trim()

export async function recoverInFlightInteraction(opts: {
  extensionSDK?: AntigravityExtensionHostLike
  auth: AntigravityAuth
  interactionId: string
  maxPollAttempts?: number
  pollIntervalMs?: number
}): Promise<{
  text: string
  interactionId: string
  status: string
  activitySteps: AntigravityActivityStep[]
  bundle: StudioBundlePayload | null
  nativeContent: LookerNativeContentBundle | null
  lookmlBundle: LookmlSessionBundle | null
  tddMarkdown: string | null
} | null> {
  const { extensionSDK, auth, maxPollAttempts = 60, pollIntervalMs = 2000 } = opts
  const cleanId = String(opts.interactionId || '').trim()
  const canFetch = Boolean(auth && (auth.mode === 'apikey' ? Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy) : Boolean(auth.oauthToken?.trim())))
  if (!cleanId || !canFetch) return null
  let fetched = await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(cleanId)}`, 'GET')
  for (
    let attempt = 0;
    (fetched.status === 'in_progress' || fetched.status === 'queued' || fetched.status === 'processing') && attempt < maxPollAttempts;
    attempt += 1
  ) {
    if (pollIntervalMs > 0) await new Promise((r) => setTimeout(r, pollIntervalMs))
    fetched = await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(cleanId)}`, 'GET')
  }
  return {
    text: stripControlTags(extractInteractionOutputText(fetched)),
    interactionId: fetched.id || cleanId,
    status: String(fetched.status || 'completed'),
    activitySteps: extractInteractionActivitySteps({ ...fetched, id: fetched.id || cleanId, status: 'completed' }).map((s) => ({
      ...s,
      status: 'done' as const,
    })),
    bundle: extractBundleFromInteraction(fetched),
    nativeContent: extractNativeContentFromInteraction(fetched),
    lookmlBundle: extractLookmlBundleFromInteraction(fetched),
    tddMarkdown: extractTddFromInteraction(fetched),
  }
}

const STATIC_SANDBOX_PATH_RE =
  /^workspace\/(?:\.lkr_extension_cache\/|\.uv_tools\/|\.uv_python\/|(?:\.agents\/)?skills\/|AGENTS\.md$|DATA_APP_GUIDE\.md$|DATA_INVESTIGATOR_GUIDE\.md$|bootstrap_lookml\.py$|bundle_app\.py$|sitecustomize\.py$)/i
const BINARY_SANDBOX_EXT_RE = /\.(?:png|jpe?g|gif|webp|ico|pdf|tar|gz|zip|pyc|wasm)$/i
const WORKSPACE_FILE_RE = /\/workspace\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g

function collectDynamicWorkspacePaths(texts: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const add = (raw: string) => {
    const norm = normalizeSandboxFilePath(raw.split(/[?#]/)[0] || '').replace(/[,:;)'"`]+$/, '')
    if (norm.startsWith('workspace/') && norm !== 'workspace' && !norm.endsWith('/') && !STATIC_SANDBOX_PATH_RE.test(norm) && !BINARY_SANDBOX_EXT_RE.test(norm) && !BUILTIN_WORKSPACE_FILES[`/${norm}`] && !BUILTIN_WORKSPACE_FILES[norm]) {
      seen.add(norm)
    }
  }
  texts.forEach((t) => {
    if (!t) return
    add(t)
    ;(t.match(WORKSPACE_FILE_RE) || []).forEach(add)
  })
  return Array.from(seen)
}

const toRawText = (val: unknown): string =>
  val === undefined || val === null ? '' : typeof val === 'string' ? val : JSON.stringify(val, null, 2)

function formatInteractionStepForDebug(step: AntigravityInteractionStep, idx: number): string {
  const raw = step as Record<string, unknown>
  const nested = step.function_call || step.code_execution || step.code_execution_call || step.executable_code || step.view_file_call || step.edit_file_call || step.skill_lookup_call
  const stepType = String(step.type || (step.function_call ? 'function_call' : step.code_execution ? 'code_execution' : 'step'))
  const fnName = String(step.name || nested?.name || '').trim()
  const meta = [step.id ? `id=\`${step.id}\`` : '', step.call_id ? `call_id=\`${step.call_id}\`` : '', step.status ? `status=\`${step.status}\`` : ''].filter(Boolean).join(', ')
  const lines = [`##### Step ${idx + 1}: \`${stepType}\`${fnName ? ` — \`${fnName}\`` : ''}${meta ? ` (${meta})` : ''}`]
  const rawArgs = step.arguments ?? step.args ?? nested?.arguments ?? nested?.args
  const parsedArgs = parseStepArguments(rawArgs)
  const thought = extractThoughtText(step.thought) || extractThoughtText(parsedArgs.thought)
  if (thought) lines.push('', '**Thought:**', '```text', thought, '```')
  const execCode = String(step.code || step.command || nested?.code || nested?.command || parsedArgs.command || '').trim()
  const lang = String(step.language || nested?.language || parsedArgs.language || '').toLowerCase()
  if (execCode) lines.push('', `**Executed Code (${lang || 'bash'}):**`, `\`\`\`${lang === 'python' ? 'python' : 'bash'}`, execCode, '```')
  if (rawArgs !== undefined) {
    if (typeof parsedArgs.code === 'string' && parsedArgs.code && parsedArgs.code !== execCode) {
      lines.push('', '**Tool Code (`arguments.code`):**', '```python', parsedArgs.code, '```')
    }
    lines.push('', '**Arguments:**', '```json', toRawText(typeof rawArgs === 'string' && Object.keys(parsedArgs).length ? parsedArgs : rawArgs), '```')
  }
  const execRes = raw.code_execution_result && typeof raw.code_execution_result === 'object' ? (raw.code_execution_result as Record<string, unknown>) : undefined
  ;(
    [
      ['Outcome', raw.outcome ?? execRes?.outcome],
      ['Stdout', step.stdout ?? execRes?.stdout],
      ['Stderr', step.stderr ?? execRes?.stderr],
      ['Output', step.output ?? execRes?.output],
      ['Result', step.result ?? raw.response],
      ['Text', step.text],
    ] as Array<[string, unknown]>
  ).forEach((entry) => {
    const s = toRawText(entry[1])
    if (s) lines.push('', `**${entry[0]}:**`, '```text', s, '```')
  })
  return lines.join('\n')
}

export interface FetchConversationSandboxDebugOptions {
  extensionSDK?: AntigravityExtensionHostLike; auth?: AntigravityAuth; conversationId?: string; label?: string
  useCase?: string; model?: string; thinkingLevel?: string; environmentId?: string; lastInteractionId?: string
  messages?: ReadonlyArray<ConversationThreadTurnLike>; liveActivitySteps?: AntigravityActivityStep[]; busyStatus?: string | null
  contentItems?: ReadonlyArray<{ key?: string; id?: string; contentType?: string; title?: string; embedPath?: string; filePath?: string }>
  maxTurns?: number; maxWorkspaceFiles?: number
}

export function fetchConversationSandboxDebugMarkdown(opts: FetchConversationSandboxDebugOptions): Promise<string> {
  const { extensionSDK, auth, conversationId, label, useCase, model, thinkingLevel, messages = [], liveActivitySteps = [], busyStatus, contentItems = [], maxTurns = 120, maxWorkspaceFiles = 10 } = opts
  const startId = String(opts.lastInteractionId || messages.slice().reverse().find((m) => m.interactionId)?.interactionId || '').trim()
  let resolvedEnvId = normalizeEnvironmentId(opts.environmentId) || String(opts.environmentId || '').trim()
  const canFetch = Boolean(auth && (auth.mode === 'apikey' ? Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy) : Boolean(auth.oauthToken?.trim())))
  const chainNewestFirst: AntigravityInteractionPayload[] = []
  const remoteErrors: string[] = []
  const seen = new Set<string>()

  const walkChain = (currId: string): Promise<void> => {
    if (!currId || seen.has(currId) || seen.size >= maxTurns) return Promise.resolve()
    seen.add(currId)
    return callInteractionsApi(extensionSDK, auth!, `interactions/${encodeURIComponent(currId)}`, 'GET').then(
      (fetched) => {
        const envFromTurn = normalizeEnvironmentId(fetched.environment_id)
        if (envFromTurn && !normalizeEnvironmentId(resolvedEnvId)) resolvedEnvId = envFromTurn
        const isPrewarm = JSON.stringify(fetched.input ?? '').includes('[PREWARM:')
        if (isPrewarm) {
          if (chainNewestFirst.length) chainNewestFirst[chainNewestFirst.length - 1].previous_interaction_id = undefined
        } else {
          chainNewestFirst.push({ ...fetched, id: fetched.id || currId })
        }
        return walkChain(typeof fetched.previous_interaction_id === 'string' ? fetched.previous_interaction_id.trim() : '')
      },
      (err: unknown) => {
        remoteErrors.push(`Failed to fetch interaction \`${currId}\`: ${err instanceof Error ? err.message : String(err)}`)
      }
    )
  }

  const chainPromise = startId && canFetch && auth
    ? walkChain(startId)
    : (startId && !canFetch && remoteErrors.push('Skipped remote interaction fetch: not authenticated.'), Promise.resolve())

  return chainPromise.then(() => {
    const chronological = chainNewestFirst.slice().reverse()
    const scanTexts: string[] = []
    messages.forEach((m) => {
      scanTexts.push(m.text || '')
      ;(m.activitySteps || []).forEach((st) => scanTexts.push(st.path || '', st.detail || '', st.title || ''))
    })
    liveActivitySteps.forEach((st) => scanTexts.push(st.path || '', st.detail || '', st.title || ''))
    contentItems.forEach((ci) => { if (ci.filePath) scanTexts.push(`/workspace/lookml/${ci.filePath.replace(/^\/+/, '')}`) })
    chronological.forEach((inter) => scanTexts.push(JSON.stringify(inter)))

    const workspacePaths = collectDynamicWorkspacePaths(scanTexts).slice(0, maxWorkspaceFiles)
    const filesPromise = workspacePaths.length > 0 && resolvedEnvId && canFetch && auth
      ? Promise.allSettled(workspacePaths.map((p) => fetchEnvironmentFile({ extensionSDK, auth, environmentId: resolvedEnvId, path: p }))).then((settled) =>
          settled.map((r, i) => (r.status === 'fulfilled' ? { path: `/${workspacePaths[i]}`, content: r.value } : { path: `/${workspacePaths[i]}`, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }))
        )
      : Promise.resolve([] as Array<{ path: string; content?: string; error?: string }>)

    return filesPromise.then((fetchedFiles) => {
      const out: string[] = [
        `# Conversation Sandbox Debug Dump${label?.trim() ? ` — ${label.trim()}` : ''}`, '',
        '## Conversation Metadata',
        `- **Conversation ID:** \`${conversationId || 'unsaved'}\``,
        ...(label?.trim() ? [`- **Title:** ${label.trim()}`] : []),
        ...(useCase ? [`- **Use Case:** \`${useCase}\``] : []),
        ...(model ? [`- **Model:** \`${model}\`${thinkingLevel ? ` (thinking: \`${thinkingLevel}\`)` : ''}`] : []),
        `- **Environment ID:** \`${resolvedEnvId || 'none'}\``,
        `- **Latest Interaction ID:** \`${startId || 'none'}\``,
        `- **Fetched Remote Interactions:** ${chronological.length}`,
        ...(contentItems.length ? [`- **Content Items (${contentItems.length}):** ${contentItems.map((c) => `\`${c.contentType || 'item'}:${c.id || c.key || ''}\` (${c.title || ''})`).join(', ')}`] : []),
        '', '## UI Chat Transcript & In-Memory Steps', '',
        formatConversationThreadMarkdown(messages, { title: label, conversationId, liveActivitySteps, busyStatus }),
        '', '## Remote Antigravity Sandbox Interaction Chain',
        ...(remoteErrors.length ? ['', ...remoteErrors.map((e) => `- **Warning:** ${e}`)] : []),
      ]

      if (!chronological.length) {
        out.push('', '_No remote interactions fetched._')
      } else {
        chronological.forEach((inter, idx) => {
          const u = inter.usage || inter.usage_metadata
          const tok = u ? `input=${u.input_tokens ?? u.total_input_tokens ?? u.prompt_token_count ?? 0}, output=${u.output_tokens ?? u.total_output_tokens ?? u.candidates_token_count ?? 0}, thought=${u.thought_tokens ?? u.total_thought_tokens ?? u.thoughts_token_count ?? 0}` : 'n/a'
          out.push('', `### Turn ${idx + 1} Interaction: \`${inter.id || 'unknown'}\``, `- **Status:** \`${inter.status || 'unknown'}\``, `- **Previous Interaction ID:** \`${inter.previous_interaction_id || 'none'}\``, `- **Environment ID:** \`${inter.environment_id || resolvedEnvId || 'none'}\``, `- **Tokens:** ${tok}`)
          if (inter.error?.message) out.push(`- **Error:** ${inter.error.message}`)
          if (inter.input) {
            const items = Array.isArray(inter.input) ? inter.input : [inter.input]
            const inputBlocks = items.map((item, i) => {
              if (typeof item === 'string') return item
              if (!item || typeof item !== 'object') return ''
              const rec = item as Record<string, unknown>
              if (typeof rec.text === 'string' && rec.text) return `**Input[${i}] (${String(rec.type || rec.role || 'text')}):**\n\n${rec.text}`
              if (rec.type === 'function_result' || rec.result !== undefined || rec.response !== undefined) return `**Input[${i}] \`function_result\` (${String(rec.name || 'tool')}):**\n\`\`\`json\n${toRawText(rec.result ?? rec.response ?? rec.output)}\n\`\`\``
              const clean: Record<string, unknown> = {}
              Object.keys(rec).forEach((k) => {
                const v = rec[k]
                clean[k] = k === 'sources' ? '[omitted static sources]' : (k === 'data' || k === 'inline_data') && typeof v === 'string' && v.length > 256 ? `[base64: ${v.length} chars]` : v
              })
              return `\`\`\`json\n${JSON.stringify(clean, null, 2)}\n\`\`\``
            }).filter(Boolean).join('\n\n')
            if (inputBlocks) out.push('', '#### Input', '', inputBlocks)
          }
          if (inter.steps?.length) out.push('', `#### Raw Steps (${inter.steps.length})`, ...inter.steps.flatMap((st, sIdx) => ['', formatInteractionStepForDebug(st, sIdx)]))
          if (inter.outputs?.length || inter.output_text) {
            out.push('', '#### Outputs')
            ;(inter.outputs || []).forEach((o, oIdx) => {
              const oT = extractThoughtText(o.thought)
              if (oT) out.push('', `**Output[${oIdx}] Thought:**`, '```text', oT, '```')
              const oTxt = typeof o.text === 'string' && o.text ? o.text : extractNonThoughtText(o.content ?? o.parts)
              if (oTxt) out.push('', `**Output[${oIdx}] Text:**`, '', oTxt)
            })
            if (inter.output_text) out.push('', '**output_text:**', '', inter.output_text)
          }
        })
      }

      out.push('', '## Sandbox Workspace Files')
      if (!fetchedFiles.length) {
        out.push('', workspacePaths.length ? `_Discovered ${workspacePaths.length} workspace path(s) (${workspacePaths.map((p) => `\`/${p}\``).join(', ')}), but sandbox fetch was unavailable._` : '_No dynamic `/workspace/...` files referenced._')
      } else {
        fetchedFiles.forEach((f) => out.push('', `### \`${f.path}\``, ...(f.error ? [`- **Fetch Error:** ${f.error}`] : ['```', f.content ?? '', '```'])))
      }
      return out.join('\n').trim()
    })
  })
}
