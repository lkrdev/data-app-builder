import type { Looker40SDK } from '@looker/sdk'

import { callInteractionsApi, streamInteractionUntilActionOrDone } from './antigravityAuth'
import {
  AGENTS_MD,
  buildNativeContentGuide,
  BUNDLE_APP_PY,
  DATA_APP_GUIDE_MD,
  DATA_INVESTIGATOR_GUIDE_MD,
  KDA_SKILL_MD,
  KDA_TOOLKIT_PY,
  LOOKER_DASHBOARD_SKILL_MD,
  LOOKER_FIELD_PROFILER_SKILL_MD,
  LOOKER_PROJECT_ONBOARDING_SKILL_MD,
  wrapDashboardCodeMode,
} from './antigravityPrompts'
import {
  BUILTIN_SKILLS_FILES,
  collectInteractionTextCandidates,
  extractBundleFromInteraction,
  extractInteractionActivitySteps,
  extractInteractionOutputText,
  extractInteractionTelemetry,
  extractNativeContentFromInteraction,
  extractTddFromInteraction,
  formatFriendlyLookerActivityLabel,
  INTERNAL_JARGON_THOUGHT_RE,
  parseStepArguments,
  SANDBOX_AGENT_SKILL_FILES,
  summarizeProgress,
} from './antigravitySteps'
import {
  activeInteractionsByEnv,
  type AgentSession,
  type AntigravityActivityStep,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  type AntigravityInteractionStep,
  type AntigravityToolType,
  type AntigravityTurnTelemetry,
  type CodeModePermissionDecision,
  type CodeModePermissionRequest,
  DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_POLL_SCHEDULE_MS,
  DEFAULT_THINKING_LEVEL,
  getSharedEnvExploreSchemas,
  inFlightEnvProvisionByUser,
  isEnvironmentNotFoundError,
  normalizeEnvironmentId,
  type PastedImage,
  recordSharedEnvExploreSchema,
  resolveAdaptivePollScheduleMs,
  resolveUserProvisionKey,
  type StudioThinkingLevel,
} from './antigravityTypes'
import {
  createDeduplicatedLookerSdkProxy,
  type DataAppBundle,
  extractResolvedUseCase,
  getArtifactNamespace,
  isConversationalNoOpPrompt,
  type NativeContentBundle,
  type NativeContentState,
  normalizeNativeContent,
  parseExploreId,
  type ResolvedStudioUseCase,
  saveUserEnvironmentId,
  type StudioUseCase,
} from './lookerApi'
import {
  BOOTSTRAP_LOOKML_PY,
  BOOTSTRAP_SANDBOX_SH,
  buildLookmlSystemGuide,
  computeLkrExtensionCacheKey,
  executeLkrExtensionToolRequest,
  extractLkrExtensionToolRequests,
  extractLookmlBundleFromInteraction,
  LKR_CLI_SITECUSTOMIZE_PY,
  LKR_DEV_CLI_SPEC,
  LkrCodeMode,
  type LkrExtensionToolRequest,
  type LookmlBundle,
} from './lookmlTool'

export * from './antigravityTypes'
export * from './antigravityAuth'
export * from './antigravitySteps'
export * from './antigravityStarters'
export * from './antigravityPrompts'
export * from './lookmlSkills'
export {
  buildStudioRoute, clampLeftPaneWidth, classifyStudioUseCase, convertRelativeDateFilterToFixed,
  DEFAULT_BUSY_SEND_ACTION, DEFAULT_LEFT_PANE_WIDTH, EXPLICIT_SCRIPT_CREATION_RE, extractResolvedUseCase,
  formatContentInventoryMarkdown, getAllowedUseCases, getUseCaseLabel,
  isConversationalNoOpPrompt, isLookerInstanceMetadataQuery, loadStoredBusySendAction, loadStoredLeftPaneWidth, loadStoredRightPaneCollapsed,
  matchExplicitUseCaseRule, MAX_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH,
  normalizeBusySendAction, normalizeQueryFiltersToFixedDates, readInitialBusySendAction, readInitialLeftPaneWidth, readInitialRightPaneCollapsed,
  saveStoredBusySendAction, saveStoredLeftPaneWidth, saveStoredRightPaneCollapsed, shouldRouteToIsolatedCaSubagent,
  STUDIO_BUSY_SEND_ACTION_STORAGE_KEY, STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY, STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY,
  STUDIO_USE_CASE_OPTIONS, studioModeToUseCase, studioUseCaseToMode, useCaseToStudioMode,
} from './lookerApi'
export type { ExtensionHostStorageLike, ResolvedStudioUseCase, StudioBusySendAction, StudioUseCase } from './lookerApi'
export {
  BOOTSTRAP_LOOKML_PY,
  BOOTSTRAP_SANDBOX_SH,
  buildLookmlSystemGuide,
  classifyLookerOperation,
  CODEMODE_CDN_URL,
  computeLkrExtensionCacheKey,
  ensureCodeModeLoaded,
  executeLkrExtensionToolRequest,
  extractLkrExtensionToolRequests,
  LKR_CLI_BRIDGE_TOOL,
  LKR_CLI_SITECUSTOMIZE_PY,
  LKR_DEV_CLI_SPEC,
  LKR_DEV_CLI_VERSION,
  LkrCodeMode,
} from './lookmlTool'
export type { LkrExtensionToolRequest, LookmlBundle } from './lookmlTool'

const toSafeConversationId = (rawId?: string, session?: AgentSession): string =>
  String(rawId || session?.conversationId || session?.objectId || 'current')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_') || 'current'

async function withCoalescedEnvProvision<T>(
  userProvisionKey: string,
  task: () => Promise<{ envId: string; value: T }>
): Promise<T> {
  const promise = task()
  const envPromise = promise.then((r) => r.envId)
  envPromise.catch(() => {})
  inFlightEnvProvisionByUser.set(userProvisionKey, envPromise)
  try {
    return (await promise).value
  } finally {
    if (inFlightEnvProvisionByUser.get(userProvisionKey) === envPromise) {
      inFlightEnvProvisionByUser.delete(userProvisionKey)
    }
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
    { type: 'inline', content: DATA_APP_GUIDE_MD, target: '/workspace/skills/data-apps/SKILL.md' },
    { type: 'inline', content: DATA_INVESTIGATOR_GUIDE_MD, target: '/workspace/skills/data-investigator/SKILL.md' },
    { type: 'inline', content: KDA_SKILL_MD, target: '/workspace/skills/key-driver-analysis/SKILL.md' },
    { type: 'inline', content: KDA_TOOLKIT_PY, target: '/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py' },
    { type: 'inline', content: LOOKER_DASHBOARD_SKILL_MD, target: '/workspace/skills/looker-dashboard/SKILL.md' },
    { type: 'inline', content: LOOKER_FIELD_PROFILER_SKILL_MD, target: '/workspace/skills/looker-field-profiler/SKILL.md' },
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
  thinkingLevel?: StudioThinkingLevel
  maxTotalTokens?: number
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
  signal?: AbortSignal
  onInteractionCreated?: (interactionId: string) => void
  onStatus: (statusText: string) => void
}

export interface AntigravityTurnResult {
  bundle: DataAppBundle | null
  nativeBundle: NativeContentBundle | null
  lookmlBundle?: LookmlBundle | null
  tddMarkdown: string | null
  assistantText: string
  rawOutputText?: string
  resolvedUseCase: ResolvedStudioUseCase
  session: AgentSession
  telemetry: AntigravityTurnTelemetry
  activitySteps?: AntigravityActivityStep[]
  thinkingDurationSec?: number
}

export async function runAntigravityTurn(params: RunAntigravityTurnOptions): Promise<AntigravityTurnResult> {
  const turnStartMs = Date.now()
  let pollWaitMs = 0, pollCount = 0, codemodeExecMs = 0, lookerHttpMs = 0, codemodeCalls = 0, lookerHttpCalls = 0, apiRetries = 0

  const {
    sdk, extensionSDK, userId, environmentId, conversationId: rawConversationId, onEnvironmentUpdated, auth, session,
    model = DEFAULT_ANTIGRAVITY_MODEL, thinkingLevel = DEFAULT_THINKING_LEVEL, maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS, mode = 'data_app', useCase = 'auto',
    allowedModes, selectedExplores, folderId, toolMode = 'data_app', lookmlProjectId, activatedLookmlSkills,
    developableProjects, canDeploy, schemaMarkdown, userPrompt, images, existingAppCode, existingNativeContent,
    customSystemGuide, extraSources, priorMessages, requirePermission = true, approvedOperations, onPermissionRequest,
    onRequestWritePermission, onProgressSteps, pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS, signal, onInteractionCreated, onStatus,
  } = params

  const throwIfAborted = async (interactionId?: string): Promise<void> => {
    if (!signal?.aborted) return
    if (interactionId) {
      try { await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(interactionId)}:cancel`, 'POST', {}) } catch { /* ignore */ }
    }
    throw Object.assign(new Error('Turn stopped by user'), { name: 'AbortError' })
  }

  const effectivePermissionHandler = onPermissionRequest || onRequestWritePermission
  const firstParsed = selectedExplores[0] ? parseExploreId(selectedExplores[0]) : null
  const primaryModel = firstParsed?.modelName || ''
  const primaryExplore = firstParsed?.exploreName || ''

  const effectiveToolType: AntigravityToolType =
    toolMode === 'lookml' ? 'lookml'
      : customSystemGuide?.includes('3-Pillar') ? 'health'
      : customSystemGuide?.includes('codemode-script-tile') ? 'tile'
      : mode === 'dashboard' ? 'dashboard' : 'app'
  const isDashboardMode = effectiveToolType === 'dashboard'

  const conversationId = toSafeConversationId(rawConversationId, session)
  const appDir = `/workspace/apps/${conversationId}`
  const appFilePath = `${appDir}/app.js`

  const initialEnvId = normalizeEnvironmentId(environmentId || session.environmentId)
  let activeEnvId = initialEnvId
  const userProvisionKey = resolveUserProvisionKey(userId, auth)
  if (activeEnvId && schemaMarkdown && selectedExplores.length > 0) {
    for (const expKey of selectedExplores) recordSharedEnvExploreSchema(activeEnvId, expKey, schemaMarkdown)
  }

  // ponytail: decouple container state (environmentId) from conversation history (lastInteractionId).
  const isFreshConversation =
    !session.lastInteractionId ||
    Boolean(session.toolType && session.toolType !== effectiveToolType) ||
    (Array.isArray(session.explores) && session.explores.length > 0 && JSON.stringify(session.explores) !== JSON.stringify(selectedExplores))

  const exploreDirective =
    selectedExplores.length > 0
      ? `for selected Looker explore(s): ${selectedExplores.map((id) => `"${id}"`).join(', ')}.`
      : `where no explore was pre-selected — YOU decide which Looker explore(s) ("model_id::explore_id") from /workspace/schema.md best fit the user's request.`

  const step2Directive =
    selectedExplores.length > 0
      ? `2. Read /workspace/schema.md for the compiled Looker Explore schema(s) and sample rows. You also have \`run_looker_codemode\` (WASM Monty Python sandbox with \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel}", and \`target_explore\`="${primaryExplore}" pre-injected, plus Looker 4.0 SDK globals \`lookml_model_explore\`, \`run_inline_query\`, \`search_content\`; always pass a concise 1-sentence \`thought\` string) if you need additional sample queries.`
      : lookmlProjectId
      ? `2. Reuse the LookML model "${lookmlProjectId}" and primary Silver explore${primaryExplore ? ` "${primaryExplore}"` : ''} and fields already created in conversation history (\`total_<num_col>\`, \`count\`, \`return_count\`, \`cancel_count\`, \`created_*\`, \`returned_*\`, \`cancelled_*\`, and joined dimension fields) — do NOT run \`ls\`, \`find\`, \`head\`, \`view_file\`, or \`run_looker_codemode\` on \`/workspace/lookml\` or \`/workspace/schema.md\`.`
      : `2. Pick the best \`model_id::explore_id\` from /workspace/schema.md and run ONE \`run_looker_codemode\` Python snippet (always passing a concise 1-sentence \`thought\` description) that resolves discovery + schema + 5-row sample in a single call:
\`\`\`python
m, e = "<model_name>", "<explore_name>"  # best model/explore from /workspace/schema.md matching search_content(terms="...")
exp = lookml_model_explore(m, e, fields="name,label,fields(dimensions(name,label,type),measures(name,label,type))")
dims = [d["name"] for d in (exp.get("fields", {}).get("dimensions") or [])]
meas = [x["name"] for x in (exp.get("fields", {}).get("measures") or [])]
sample = run_inline_query("json", {"model": m, "view": e, "fields": dims[:2] + meas[:2], "limit": "5"})
return {"model": m, "explore": e, "dimensions": dims, "measures": meas, "sample": sample}
\`\`\``

  const ctorHint =
    selectedExplores.length === 1
      ? `with \`this.lookerModel = '${primaryModel}'\` and \`this.explore = '${primaryExplore}'\` in \`constructor()\``
      : lookmlProjectId
      ? `with \`this.lookerModel = '${lookmlProjectId}'\` and \`this.explore = '${primaryExplore || '<fact_explore>'}'\` (the primary Silver explore from conversation history) in \`constructor()\``
      : `setting \`this.lookerModel\` and \`this.explore\` in \`constructor()\``
  const step3Directive = `3. Write and bundle the Lit Data App in ONE \`code_execution\` call importing from '/runtime/data-app.js' (${ctorHint}; never inspect \`/workspace/bundle_app.py\` or \`/runtime\`; for Metric Selector apps: clickable PoP KPIs with \`border-color: var(--app-primary)\` only & no \`"ACTIVE METRIC"\` badge or Metric \`<app-select>\`, querying \`2 * periodCount\` periods per KPI on \`created_*\`/\`returned_*\`/\`cancelled_*\` to stack label, standalone headline, inline \`[+/- %] vs. prev <N> <unit>\` with \`lower-better\` polarity, and sparkline SVG; \`Compare against\` \`<app-select>\` with \`opposite: true\` dual \`yAxis\` + \`yAxis.title.text\`, no \`"Longitudinal Trend"\` title, and top-right \`⋮\` Chart Type menu; separate \`Period\`/\`Window\` \`periodCount\` \`90\`/\`53\`/\`60\`/\`10\` via \`getEffectiveFilters\` on all widgets; titleless PoP \`<app-grid>\` + \`Dimensions\` \`selectedDimensions\` joining \`ago for\` into \`.data\` with \`This Period\`/\`Last Period\`/\`Variance\`) into \`${appFilePath}\`:\n   \`python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\\n...\\nEOF\``

  const normalizedExistingNative: NativeContentState | null = existingNativeContent
    ? normalizeNativeContent({
        ...existingNativeContent,
        folderId: (existingNativeContent as Partial<NativeContentState & NativeContentBundle>).folderId || (existingNativeContent as Partial<NativeContentState & NativeContentBundle>).folder_id || folderId || '1',
      })
    : null

  const isDataInvestigatorTurn =
    useCase === 'data-investigator' || (useCase === 'auto' && extractResolvedUseCase('', userPrompt, allowedModes) === 'data-investigator')

  const dataAppOrNativeGuide =
    mode === 'dashboard'
      ? buildNativeContentGuide({ selectedExplores, primaryModel, primaryExplore, folderId: folderId || '1', lookmlProjectId: lookmlProjectId || '', existingNativeContent: normalizedExistingNative })
      : [
          `You are building a Looker ${isDataInvestigatorTurn ? 'Data Investigator Narrative Data App' : 'Data App'} (Lit web component using Looker's data-app.js runtime) ${exploreDirective}`,
          `Follow these exact steps inside your Linux sandbox:`,
          `1. /workspace/skills/data-apps/SKILL.md${isDataInvestigatorTurn ? ' and /workspace/skills/data-investigator/SKILL.md are' : ' is'} pre-loaded below with component contracts (<app-kpi>, <app-chart>, <app-grid>, <app-select>), .da-* layout classes, dark mode (this.isDark), and static widget extraction rules. Do NOT call view_file on /workspace/skills/data-apps/SKILL.md, download toolkits, or read external skill directories.`,
          DATA_APP_GUIDE_MD,
          ...(isDataInvestigatorTurn ? [DATA_INVESTIGATOR_GUIDE_MD] : []),
          step2Directive,
          step3Directive,
          `4. If bundle_app.py reports any syntax or tile safety violation, fix ${appFilePath} and re-run \`python3 /workspace/bundle_app.py ${appFilePath} "<App Title>"\` until it exits 0.`,
          `5. CRITICAL: bundle_app.py prints \`<DATA_APP_BUNDLE>...</DATA_APP_BUNDLE>\` directly to stdout, which the host captures automatically from tool output. NEVER echo or repeat \`<DATA_APP_BUNDLE>\` or raw JavaScript code in your final text reply—respond with a concise 1–2 sentence summary only.`,
        ].join('\n')

  const systemGuide =
    customSystemGuide ||
    (toolMode === 'lookml'
      ? buildLookmlSystemGuide({ selectedExplores, primaryModel, primaryExplore, projectId: lookmlProjectId, activatedSkills: activatedLookmlSkills, userPrompt, developableProjects, canDeploy })
      : dataAppOrNativeGuide)

  const uploadSources: Array<{ type: 'inline'; content: string; target: string }> = []
  const uploadedFileNotices: string[] = []
  for (let i = 0; i < (images || []).length; i += 1) {
    const file = images![i]
    const fallbackExt = file.mimeType.startsWith('image/') ? `.${file.mimeType.split('/')[1] || 'png'}` : file.mimeType === 'application/pdf' ? '.pdf' : '.txt'
    const safeName = (file.name || `attachment_${i + 1}${fallbackExt}`).replace(/[^a-zA-Z0-9._-]+/g, '_')
    const targetPath = `/workspace/uploads/${safeName}`
    uploadSources.push({ type: 'inline', target: targetPath, content: file.textContent !== undefined ? file.textContent : file.dataUrl || file.data })
    uploadedFileNotices.push(`- \`${targetPath}\` (${file.mimeType}${file.size ? `, ${file.size} bytes` : ''})`)
  }

  const sources = buildWorkspaceSources({
    schemaMarkdown, appFilePath, existingAppCode: mode === 'data_app' ? existingAppCode : undefined,
    cachedExploreSchemas: getSharedEnvExploreSchemas(activeEnvId), extraSources: [...(extraSources || []), ...uploadSources],
  })

  // ponytail: disable remote container code_execution in /dashboard mode so all UDD + .dashboard.lookml
  // operations run directly in browser/extension WASM Monty CodeMode with zero bash container overhead.
  const activeTools = isDashboardMode
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    : [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]

  const historyDigest =
    priorMessages && priorMessages.length > 0
      ? `\n\nPrior conversation context:\n${priorMessages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-40).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')}`
      : ''

  const isNoOpTurn = isConversationalNoOpPrompt(userPrompt)
  const warmTurnDirective =
    !isNoOpTurn && mode === 'data_app' && toolMode !== 'lookml' && Boolean(existingAppCode?.trim())
      ? `[WARM SANDBOX FAST PATH: ${appFilePath} and the discovered Looker schema are already in /workspace. Do NOT re-run run_looker_codemode discovery or re-read guides unless a brand-new explore is requested. Update ${appFilePath} and bundle in ONE code_execution call via: python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\n...\nEOF\nNEVER echo <DATA_APP_BUNDLE> in your text reply.]\n\n`
      : !isNoOpTurn && isDashboardMode && normalizedExistingNative
      ? `[WARM CONTENT STUDIO FAST PATH: Active Looker ${normalizedExistingNative.contentType} id="${normalizedExistingNative.id}" ("${normalizedExistingNative.title}") and pre-hydrated active_content (element_ids=${JSON.stringify(normalizedExistingNative.elementIds || [])}, filter_names=${JSON.stringify(normalizedExistingNative.filterNames || [])}, lookml_dashboard_id="${normalizedExistingNative.lookmlDashboardId || ''}", project_id="${normalizedExistingNative.projectId || lookmlProjectId || ''}") are pre-injected in run_looker_codemode vars. Execute the update in ONE run_looker_codemode call using upsert_udd / upsert_lookml_dashboard / reflow_24col / pin_to_board / schedule_dashboard + return emit_native_bundle(...). NEVER echo <NATIVE_CONTENT_BUNDLE> in your text reply.]\n\n`
      : ''

  const autoRoutingDirective =
    useCase === 'auto'
      ? `\n\n[AUTO USE-CASE ROUTING: Consult /workspace/AGENTS.md ("## Use Case Auto-Classification (Turn 1 Routing)"). Allowed use cases for this user: ${JSON.stringify(allowedModes && allowedModes.length > 0 ? allowedModes : ['app', 'data-investigator', 'dashboard', 'lookml', 'health-check', 'tile', 'conversational-analytics'])}. Start your response with <USE_CASE>...</USE_CASE> naming the single best allowed use case for this request, then execute that workflow. CRITICAL: (1) Conversational & Follow-Up Questions (No-Op): when the prompt is a greeting, help request, meta/error summary ("summarize the errors you experienced", "what went wrong?", "how can I make you better?"), or general follow-up question in an active conversation that does not ask to build or modify a right-pane artifact ("hello", "hi", "help", "what can you do?"), answer directly in chat (calling zero tools for greetings/meta-questions) and do NOT create or open any right-pane content item (do NOT run bundle_app.py, emit_native_bundle, or redirect to an isolated CA sub-agent). (2) Ad-Hoc Looker Instance / Folder / Content Inventory / SDK Queries (<USE_CASE>tile</USE_CASE>): route prompts asking to inspect or query Looker spaces, folders, personal spaces, favorite dashboards, dashboards/Looks in folders, users, permissions, schedules, or instance metadata via SDK (e.g. "tell me what my personal space is", "What dashboards are in my personal", "what are my favorite dashboards", "can you find me all personal spaces that don't have dashboards") to <USE_CASE>tile</USE_CASE> and call run_looker_codemode (using format_content_inventory(folders) to format clickable /dashboards/<id>, /looks/<id>, /folders/<id> links, capped at 2 items per folder when >5 total items or multiple folders, with full list saved to /workspace/content_inventory.md). Answer directly in chat without creating a right-pane Script unless explicitly requested, and ask if the user wants to save it as a reusable Script. (3) Open-Ended Analytical Questions & search_agents() in CodeMode: for open-ended analytical questions without a pre-selected explore, call search_agents() inside run_looker_codemode to inspect accessible Looker Conversational Analytics (CA) agents, their explores, description, and golden_queries; if a CA agent covers the question, emit <USE_CASE>conversational-analytics</USE_CASE> and <CA_AGENT_SELECTION>{"agent_id":"<matched_id>","rationale":"<1-sentence reason>"}</CA_AGENT_SELECTION>; if no CA agent matches, answer directly via run_inline_query in run_looker_codemode. (4) Data Investigator Routing: route prompts asking to "investigate", "find out", "figure out", "dig into", "what drove", or "what caused" across data, metrics, dashboards, Looks, or explores to <USE_CASE>data-investigator</USE_CASE> and follow /workspace/skills/data-investigator/SKILL.md and /workspace/skills/key-driver-analysis/SKILL.md.]`
      : ''

  const uploadsSection = uploadedFileNotices.length > 0 ? `\n\nAttached files in /workspace/uploads:\n${uploadedFileNotices.join('\n')}` : ''
  const thinkingDirective =
    thinkingLevel === 'low' ? '[THINKING LEVEL: LOW — Be concise and minimize exploratory steps]\n\n'
      : thinkingLevel === 'high' ? '[THINKING LEVEL: HIGH — Reason deeply and verify edge cases thoroughly]\n\n' : ''

  const buildInputItems = (fresh: boolean): Array<Record<string, unknown>> => [
    {
      type: 'text',
      text: fresh
        ? `${thinkingDirective}${systemGuide}${autoRoutingDirective}${historyDigest}\n\nUser request:\n${userPrompt}${uploadsSection}`
        : `${thinkingDirective}${warmTurnDirective}${autoRoutingDirective ? `${autoRoutingDirective.trim()}\n\n` : ''}User request:\n${userPrompt}${uploadsSection}`,
    },
    ...(images || [])
      .filter((img) => img.mimeType.startsWith('image/') || img.mimeType === 'application/pdf')
      .map((img) => ({ type: img.mimeType === 'application/pdf' ? 'document' : 'image', mime_type: img.mimeType, data: img.data })),
  ]

  const activeModel = model || DEFAULT_ANTIGRAVITY_MODEL
  const resolvedMaxTokens = Number(maxTotalTokens) > 0 ? Number(maxTotalTokens) : DEFAULT_MAX_TOTAL_TOKENS
  const agentConfig = { type: 'antigravity', model: activeModel, max_total_tokens: String(resolvedMaxTokens) }
  const buildFreshPayload = (): Record<string, unknown> => ({
    agent: 'antigravity-preview-09-2026', agent_config: agentConfig, background: true, tools: activeTools,
    input: buildInputItems(true), environment: { type: 'remote', sources },
  })

  const provisionFreshEnvironmentInteraction = (): Promise<AntigravityInteractionPayload> =>
    withCoalescedEnvProvision(userProvisionKey, async () => {
      const created = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', buildFreshPayload())
      return { envId: normalizeEnvironmentId(created?.environment_id) || '', value: created }
    })

  if (signal?.aborted) await throwIfAborted()
  onStatus('Starting Antigravity sandbox interaction...')
  if (!activeEnvId && inFlightEnvProvisionByUser.has(userProvisionKey)) {
    try {
      const coalescedId = normalizeEnvironmentId(await inFlightEnvProvisionByUser.get(userProvisionKey)!)
      if (coalescedId) activeEnvId = coalescedId
    } catch { /* ignore */ }
  }
  if (signal?.aborted) await throwIfAborted()

  let interaction: AntigravityInteractionPayload
  if (activeEnvId || (!isFreshConversation && session.lastInteractionId)) {
    try {
      interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        agent: 'antigravity-preview-09-2026', agent_config: agentConfig, background: true, tools: activeTools,
        input: buildInputItems(isFreshConversation), environment: activeEnvId || 'remote',
        ...(isFreshConversation ? {} : { previous_interaction_id: session.lastInteractionId }),
      })
    } catch (err) {
      if (activeEnvId && !isEnvironmentNotFoundError(err) && isFreshConversation) throw err
      apiRetries += 1
      onStatus('Resumed sandbox expired; provisioning fresh sandbox with app state...')
      interaction = await provisionFreshEnvironmentInteraction()
    }
  } else {
    interaction = await provisionFreshEnvironmentInteraction()
  }
  if (interaction.id) onInteractionCreated?.(interaction.id)
  await throwIfAborted(interaction.id)
  let trackedEnvId: string | undefined = normalizeEnvironmentId(interaction.environment_id) || activeEnvId
  if (trackedEnvId && schemaMarkdown && selectedExplores.length > 0) {
    for (const expKey of selectedExplores) recordSharedEnvExploreSchema(trackedEnvId, expKey, schemaMarkdown)
  }
  await persistUserEnvIfChanged({ sdk, extensionSDK, userId, previousEnvId: initialEnvId, nextEnvId: trackedEnvId, onEnvironmentUpdated })

  let pollIdx = 0, prevStepCount = (interaction.steps || []).length, prevStatus = interaction.status, bridgeRound = 0, actionRound = 0
  let accInputTokens = 0, accOutputTokens = 0, accThoughtTokens = 0
  const accumulateInteractionUsage = (snap: AntigravityInteractionPayload | null | undefined) => {
    const u = snap?.usage || snap?.usage_metadata
    if (!u) return
    accInputTokens += Number(u.input_tokens ?? u.total_input_tokens ?? u.prompt_token_count ?? 0)
    accOutputTokens += Number(u.output_tokens ?? u.total_output_tokens ?? u.candidates_token_count ?? 0)
    accThoughtTokens += Number(u.thought_tokens ?? u.total_thought_tokens ?? u.thoughts_token_count ?? 0)
  }
  const resolvedBridgeCacheKeys = new Set<string>()
  const getPendingBridgeReqs = (snap: AntigravityInteractionPayload) => {
    const raw = extractLkrExtensionToolRequests(snap).filter(
      (r) => !resolvedBridgeCacheKeys.has(r.cache_key || computeLkrExtensionCacheKey(r))
    )
    return raw.filter((r, idx) => {
      const pid = !r.vars?.single_file && Array.isArray(r.vars?.files_to_push) ? r.vars?.project_id : null
      if (
        pid &&
        raw
          .slice(idx + 1)
          .some((later) => !later.vars?.single_file && Array.isArray(later.vars?.files_to_push) && later.vars?.project_id === pid)
      ) {
        resolvedBridgeCacheKeys.add(r.cache_key || computeLkrExtensionCacheKey(r))
        return false
      }
      return true
    })
  }
  const accumulatedSteps: AntigravityInteractionStep[] = []

  const n = normalizedExistingNative
  const activeContentVars = n
    ? {
        ...n, content_type: n.contentType, folder_id: n.folderId, lookml_dashboard_id: n.lookmlDashboardId,
        projectId: n.projectId || lookmlProjectId || '', project_id: n.projectId || lookmlProjectId || '',
        model: n.model || primaryModel, file_path: n.filePath, look_id: n.lookId, board_id: n.boardId,
        schedule_id: n.scheduleId, layout_id: n.layoutId, element_ids: n.elementIds || [],
        filter_names: n.filterNames || [], layout_component_ids: n.layoutComponentIds || {},
        query_cache: n.queryCache || {}, filter_cache: n.filterCache || {}, explores: selectedExplores,
      }
    : null
  const defaultCodeModeVars: Record<string, unknown> = {
    target_explores: selectedExplores, target_model: primaryModel, target_explore: primaryExplore,
    target_folder_id: folderId || '1', target_project_id: lookmlProjectId || normalizedExistingNative?.projectId || '',
    cached_explore_schemas: getSharedEnvExploreSchemas(trackedEnvId),
    ...(activeContentVars ? { active_content: activeContentVars, active_dashboard_state: activeContentVars } : {}),
  }

  const turnSdk = createDeduplicatedLookerSdkProxy(sdk, (res, elapsedMs, err) => {
    lookerHttpCalls += 1
    lookerHttpMs += elapsedMs
    if (err || (res && (res.ok === false || Number(res.statusCode) >= 400))) apiRetries += 1
  })
  const envSlotKey = normalizeEnvironmentId(trackedEnvId) || 'remote'
  const envConcurrencySlot = activeInteractionsByEnv.get(envSlotKey) || 0
  activeInteractionsByEnv.set(envSlotKey, envConcurrencySlot + 1)

  const emitProgressSteps = (currInteraction: AntigravityInteractionPayload): AntigravityActivityStep[] => {
    const merged = accumulatedSteps.length > 0 ? { ...currInteraction, steps: [...accumulatedSteps, ...(currInteraction?.steps || [])] } : currInteraction
    const steps = extractInteractionActivitySteps(merged)
    if (steps.length > 0) onProgressSteps?.(steps)
    return steps
  }

  try {
    for (;;) {
      while (interaction.status === 'in_progress' || interaction.status === 'requires_action' || interaction.status === 'queued') {
        await throwIfAborted(interaction.id)
        if (interaction.environment_id) trackedEnvId = interaction.environment_id
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

          if (pendingLookerCalls.length > 0 && actionRound < 8) {
            actionRound += 1
            await throwIfAborted(interaction.id)
            const preBridgeReqs = getPendingBridgeReqs(interaction)
            for (const req of preBridgeReqs) {
              await throwIfAborted(interaction.id)
              try {
                const { cacheKey } = await executeLkrExtensionToolRequest({
                  sdk: turnSdk,
                  req,
                  defaultVars: defaultCodeModeVars,
                  extensionSDK,
                  requirePermission,
                  approvedOperations,
                  onPermissionRequest: effectivePermissionHandler,
                })
                resolvedBridgeCacheKeys.add(cacheKey)
              } catch {
                resolvedBridgeCacheKeys.add(req.cache_key || computeLkrExtensionCacheKey(req))
              }
            }
            const firstCallArgs = parseStepArguments(
              pendingLookerCalls[0]?.arguments ?? pendingLookerCalls[0]?.args
            )
            const firstThought = pendingLookerCalls
              .map((c: AntigravityInteractionStep) =>
                String(parseStepArguments(c.arguments ?? c.args).thought || '').trim()
              )
              .find((t) => Boolean(t) && !INTERNAL_JARGON_THOUGHT_RE.test(t))
            const friendlyCall = formatFriendlyLookerActivityLabel(
              String(firstCallArgs.code || ''),
              { ...defaultCodeModeVars, ...firstCallArgs }
            )
            onStatus(firstThought || friendlyCall.statusText)
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
                    const needsDashboardMacros =
                      isDashboardMode ||
                      /\b(?:upsert_udd|upsert_lookml_dashboard|reflow_24col|pin_to_board|schedule_dashboard|emit_native_bundle)\s*\(/.test(rawCode)
                    codeModeOutput = await LkrCodeMode.runPythonCode({
                      code: needsDashboardMacros ? wrapDashboardCodeMode(rawCode) : rawCode,
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
                // ponytail: /v1beta/interactions requires function_result.result to be a JSON object (Struct); top-level arrays/primitives get dropped
                let structResult = codeModeOutput
                try {
                  const parsed = JSON.parse(codeModeOutput)
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    structResult = JSON.stringify({ result: parsed })
                  }
                } catch {
                  // Non-JSON string: /v1beta/interactions wraps raw strings automatically
                }
                return {
                  type: 'function_result',
                  name: call.name || 'run_looker_codemode',
                  call_id: call.id,
                  result: structResult,
                }
              })
            )
            codemodeExecMs += Date.now() - cmStart
            await throwIfAborted(interaction.id)
            accumulateInteractionUsage(interaction)
            accumulatedSteps.push(...(interaction.steps || []), ...resultsInput)

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
            if (interaction.id) {
              onInteractionCreated?.(interaction.id)
            }
            await throwIfAborted(interaction.id)
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

        onStatus(summarizeProgress(interaction))
        if (
          auth.mode === 'oauth' &&
          interaction.id &&
          (interaction.status === 'in_progress' || interaction.status === 'queued')
        ) {
          const streamRes = await streamInteractionUntilActionOrDone({
            extensionSDK,
            auth,
            interactionId: interaction.id,
            initialInteraction: interaction,
            signal,
            onUpdate: (snap) => {
              interaction = snap
              if (snap.environment_id) trackedEnvId = snap.environment_id
              emitProgressSteps(snap)
              onStatus(summarizeProgress(snap))
            },
          })
          if (streamRes.streamed && streamRes.interaction) {
            interaction = streamRes.interaction
            await throwIfAborted(interaction.id)
            if (interaction.environment_id) trackedEnvId = interaction.environment_id
            const curStepCount = (interaction.steps || []).length
            if (curStepCount !== prevStepCount || interaction.status !== prevStatus) {
              pollIdx = 0
              prevStepCount = curStepCount
              prevStatus = interaction.status
            }
            if (interaction.status !== 'in_progress' && interaction.status !== 'queued') {
              continue
            }
          }
        }
        const schedule = resolveAdaptivePollScheduleMs(pollScheduleMs, trackedEnvId, envConcurrencySlot)
        const sleepMs = schedule[Math.min(pollIdx, schedule.length - 1)]
        pollIdx += 1
        pollCount += 1
        pollWaitMs += sleepMs
        await throwIfAborted(interaction.id)
        if (sleepMs > 0) {
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
            const timer = setTimeout(done, sleepMs)
            signal?.addEventListener('abort', done, { once: true })
          })
        }
        await throwIfAborted(interaction.id)
        interaction = await callInteractionsApi(
          extensionSDK,
          auth,
          `interactions/${encodeURIComponent(interaction.id)}`,
          'GET'
        )
        await throwIfAborted(interaction.id)
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
      const pendingBridgeReqs = getPendingBridgeReqs(interaction)

      if (pendingBridgeReqs.length > 0 && bridgeRound < 8) {
        await throwIfAborted(interaction.id)
        const firstBridgeThought = pendingBridgeReqs
          .map((r) => String(r.thought || '').trim())
          .find((t) => Boolean(t) && !INTERNAL_JARGON_THOUGHT_RE.test(t))
        const firstBridgeReq = pendingBridgeReqs[0]
        const friendlyBridge = formatFriendlyLookerActivityLabel(
          String(firstBridgeReq?.code || ''),
          { ...defaultCodeModeVars, ...(firstBridgeReq as unknown as Record<string, unknown>) }
        )
        onStatus(firstBridgeThought || friendlyBridge.statusText)
        const bridgeStart = Date.now()
        const bridgedLines: string[] = []
        for (const req of pendingBridgeReqs) {
          await throwIfAborted(interaction.id)
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
        await throwIfAborted(interaction.id)

        if (!hasFinalBundle) {
          bridgeRound += 1
          accumulateInteractionUsage(interaction)
          accumulatedSteps.push(...(interaction.steps || []))
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
          if (interaction.id) {
            onInteractionCreated?.(interaction.id)
          }
          await throwIfAborted(interaction.id)
          if (interaction.environment_id) {
            trackedEnvId = interaction.environment_id
          }
          pollIdx = 0
          prevStepCount = (interaction.steps || []).length
          prevStatus = interaction.status
          continue
        }
      }

      break
    }
  } finally {
    const remaining = (activeInteractionsByEnv.get(envSlotKey) || 1) - 1
    if (remaining <= 0) activeInteractionsByEnv.delete(envSlotKey)
    else activeInteractionsByEnv.set(envSlotKey, remaining)
  }

  if (accumulatedSteps.length > 0) {
    accumulateInteractionUsage(interaction)
    interaction = {
      ...interaction,
      steps: [...accumulatedSteps, ...(interaction.steps || [])],
      usage: {
        ...(interaction.usage || {}),
        input_tokens: accInputTokens,
        output_tokens: accOutputTokens,
        thought_tokens: accThoughtTokens,
      },
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
  const rawText = extractInteractionOutputText(interaction)
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
    .replace(/<CA_AGENT_SELECTION>[\s\S]*?<\/CA_AGENT_SELECTION>/gi, '')
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
    rawOutputText: rawText,
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
    maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS,
    environmentId,
    conversationId: rawConversationId,
    existingSession,
    selectedExplores = [],
    schemaMarkdown = '',
    existingAppCode,
    extraSources = [],
    forceFresh = false,
    onEnvironmentUpdated,
  } = params

  const conversationId = toSafeConversationId(rawConversationId, existingSession)
  const appFilePath = `/workspace/apps/${conversationId}/app.js`

  const initialEnvId = forceFresh
    ? undefined
    : normalizeEnvironmentId(environmentId || existingSession?.environmentId)
  let activeEnvId = initialEnvId

  const hasValidExisting =
    !forceFresh &&
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
    const resolvedMaxTokens = Number(maxTotalTokens) > 0 ? Number(maxTotalTokens) : DEFAULT_MAX_TOTAL_TOKENS
    const prewarmBase = {
      agent: 'antigravity-preview-09-2026',
      agent_config: {
        type: 'antigravity',
        model: model || DEFAULT_ANTIGRAVITY_MODEL,
        max_total_tokens: String(resolvedMaxTokens),
      },
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
    if (!forceFresh && !activeEnvId && inFlightEnvProvisionByUser.has(userProvisionKey)) {
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

    try {
      return await withCoalescedEnvProvision(userProvisionKey, async () => {
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
        await persistUserEnvIfChanged({
          sdk,
          extensionSDK,
          userId,
          previousEnvId: initialEnvId,
          nextEnvId: newEnvId,
          onEnvironmentUpdated,
        })
        return {
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
        }
      })
    } catch {
      // Fall back to standby session slot
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
