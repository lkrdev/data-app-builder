import type { Looker40SDK } from '@looker/sdk'

import {
  callInteractionsApi,
  fetchEnvironmentFile,
  normalizeSandboxFilePath,
  streamInteractionUntilActionOrDone,
} from './antigravityAuth'
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
  BUILTIN_WORKSPACE_FILES,
  collectInteractionTextCandidates,
  type ConversationThreadTurnLike,
  extractBundleFromInteraction,
  extractInteractionActivitySteps,
  extractInteractionOutputText,
  extractInteractionTelemetry,
  extractNativeContentFromInteraction,
  extractNonThoughtText,
  extractTddFromInteraction,
  extractThoughtText,
  formatConversationThreadMarkdown,
  formatFriendlyLookerActivityLabel,
  parseStepArguments,
  SANDBOX_AGENT_SKILL_FILES,
  sanitizeActivityThought,
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
  type AccessibleLookerConnection,
  createDeduplicatedLookerSdkProxy,
  type DataAppBundle,
  discoverAccessibleConnections,
  extractResolvedUseCase,
  formatAccessibleConnectionsMarkdown,
  getArtifactNamespace,
  isConversationalNoOpPrompt,
  matchExplicitUseCaseRule,
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
  copyTextWithExtensionSdk, DEFAULT_BUSY_SEND_ACTION, DEFAULT_LEFT_PANE_WIDTH, discoverAccessibleConnections, EXPLICIT_SCRIPT_CREATION_RE,
  extractResolvedUseCase, formatAccessibleConnectionsMarkdown, formatContentInventoryMarkdown, getAllowedUseCases, getUseCaseLabel,
  isConversationalNoOpPrompt, isLookerInstanceMetadataQuery, loadStoredBusySendAction, loadStoredLeftPaneWidth, loadStoredRightPaneCollapsed,
  matchExplicitUseCaseRule, MAX_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH,
  normalizeBusySendAction, normalizeQueryFiltersToFixedDates, readInitialBusySendAction, readInitialLeftPaneWidth, readInitialRightPaneCollapsed,
  saveStoredBusySendAction, saveStoredLeftPaneWidth, saveStoredRightPaneCollapsed, shouldRouteToIsolatedCaSubagent,
  STUDIO_BUSY_SEND_ACTION_STORAGE_KEY, STUDIO_LEFT_PANE_WIDTH_STORAGE_KEY, STUDIO_RIGHT_PANE_COLLAPSED_STORAGE_KEY,
  STUDIO_USE_CASE_OPTIONS, studioModeToUseCase, studioUseCaseToMode, useCaseToStudioMode,
} from './lookerApi'
export type { AccessibleLookerConnection, ExtensionHostStorageLike, ResolvedStudioUseCase, StudioBusySendAction, StudioUseCase } from './lookerApi'
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

function withCoalescedEnvProvision<T>(
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

function persistUserEnvIfChanged(params: {
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
  availableConnections?: ReadonlyArray<AccessibleLookerConnection> | string
  warmEnvironmentInBackground?: boolean
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

export function isNewProjectOnboardingIntakePrompt(
  userPrompt?: string,
  priorMessages?: ReadonlyArray<{ role: string; text: string }>
): boolean {
  const clean = String(userPrompt || '').trim()
  if (!/(?:\b(?:create|onboard|scaffold|set\s*up|start|initialize|init)\b[\s\S]{0,30}\b(?:new\s+)?(?:looker\s+|lookml\s+)?project\b|\bnew\s+(?:looker\s+|lookml\s+)project\b|\/looker-project-onboarding\b)/i.test(clean)) return false
  const combined = [...(priorMessages || []).map((m) => String(m.text || '')), clean].join('\n')
  const hasConn = /\bconnection(?:\s+name)?\s*(?:is|=|:|\s)\s*[`"']?(?!(?:name|and|or|to|for|from|in|on|with|access|a|the)\b)[a-z][a-z0-9_-]{2,}/i.test(combined)
  const hasProj = /\b(?:called|call\s+it|named?|project(?:_id|_name|\s+name)?)\s*(?:is|=|:|\s)\s*[`"']?(?!(?:name|called|named|and|or|to|for|from|in|on|with|a|the)\b)[a-z][a-z0-9_]{2,}/i.test(combined)
  const hasTarget = /\b(?:schema|dataset|tables?)\s*(?:is|=|:|\s)\s*[`"']?(?!(?:name|or|and|to|for|from|in|on|with|access|do|you|a|the)\b)[a-z][a-z0-9_.-]{2,}|\bselect\b[\s\S]+\bfrom\b/i.test(combined)
  return !(hasConn && hasProj && hasTarget)
}

export function isConnectionSchemaDiscoveryPrompt(userPrompt?: string): boolean {
  const clean = String(userPrompt || '').trim()
  if (!clean || /\b(?:use|select|pick)\s+(?:the\s+)?\S+\s+(?:dataset|schema)\b|\b(?:profile|refinement|silver|bronze|measure|dashboard|data\s*app)\b/i.test(clean)) return false
  return /\b(?:what|which|list|show|check|discover|inspect)\b[\s\S]{0,60}\b(?:schemas?|datasets?)\b|\bschemas?\s+(?:do\s+you|does\s+(?:it|that|this|the)|available|on\s+(?:that|this|the)?\s*connection)/i.test(clean)
}

export async function runAntigravityTurn(params: RunAntigravityTurnOptions): Promise<AntigravityTurnResult> {
  const turnStartMs = Date.now()
  let pollWaitMs = 0, pollCount = 0, codemodeExecMs = 0, lookerHttpMs = 0, codemodeCalls = 0, lookerHttpCalls = 0, apiRetries = 0

  const {
    sdk, extensionSDK, userId, environmentId, conversationId: rawConversationId, onEnvironmentUpdated, auth, session,
    model = DEFAULT_ANTIGRAVITY_MODEL, thinkingLevel = DEFAULT_THINKING_LEVEL, maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS, mode = 'data_app', useCase = 'auto',
    allowedModes, selectedExplores, folderId, toolMode = 'data_app', lookmlProjectId, activatedLookmlSkills,
    developableProjects, canDeploy, availableConnections: providedConnections, warmEnvironmentInBackground = false,
    schemaMarkdown, userPrompt, images, existingAppCode, existingNativeContent,
    customSystemGuide, extraSources, priorMessages, requirePermission = true, approvedOperations, onPermissionRequest,
    onRequestWritePermission, onProgressSteps, pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS, signal, onInteractionCreated, onStatus,
  } = params

  const throwIfAborted = (interactionId?: string): Promise<void> => {
    if (!signal?.aborted) return Promise.resolve()
    const cancelP = interactionId
      ? callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(interactionId)}:cancel`, 'POST', {}).catch(() => {})
      : Promise.resolve()
    return cancelP.then(() => {
      throw Object.assign(new Error('Turn stopped by user'), { name: 'AbortError' })
    })
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
    selectedExplores.forEach((expKey) => recordSharedEnvExploreSchema(activeEnvId, expKey, schemaMarkdown))
  }

  // ponytail: decouple container state (environmentId) from conversation history (lastInteractionId).
  const isFreshConversation =
    !session.lastInteractionId ||
    Boolean(session.statelessTurn) ||
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
  const step3Directive = `3. Write and bundle the Lit Data App in ONE \`code_execution\` call importing from '/runtime/data-app.js' (${ctorHint}; never inspect \`/workspace/bundle_app.py\` or \`/runtime\`; Metric Selector Section 4: \`PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 }\` with \`Period\` \`Daily\`->\`'date'\`, no \`*_day\`; \`@container\` KPIs forbidding \`auto-fit\`/\`auto-fill\` (\`container-type: inline-size\`, \`repeat(4, minmax(0, 1fr))\`->\`820px\` \`repeat(2, minmax(0, 1fr))\`->\`420px\` \`1fr\`); 4-row PoP KPIs forbidding \`<app-kpi>\`, \`"ACTIVE METRIC"\`, Metric \`<app-select>\`, querying \`2 * this.periodCount\` (\`Math.min(5000, Math.max(500, 2 * this.periodCount + 10))\`), \`kpi-change\` before \`vs. prev\` (\`lower-better\`) + SVG; no \`Compare against\` \`<app-select>\` — \`--app-chart-1\`/\`--app-chart-2\` borders with click/\`shiftKey\`/\`contextmenu\` (\`Remove comparison\`), \`loadTrendData()\` (\`connectedCallback\`, \`onFiltersChanged\`/\`willUpdate\`, \`onRefresh\`, handlers — no \`updated()\`, \`trendRows = null\` idle) \`Promise.all([this.runQuery(...), this.runQuery(...)])\` into \`.data\` omitting \`.query\`, \`options.colors\`, \`formatAxisValue\` \`labels.formatter\`, \`opposite: true\` + \`yAxis.title.text\`, \`shareScale\` (\`linkedTo: 0\`), no \`"Longitudinal Trend"\`, \`⋮\` menu; \`Period\`/\`Window\` \`periodCount\` (\`customWindowOpen\`), \`!WINDOW_OPTIONS[this.period].includes(this.periodCount)\` pill + \`Custom window length\` \`type="number"\` popover via \`getEffectiveFilters\`; titleless \`<app-grid>\` + \`Dimensions\` \`selectedDimensions\` joining \`ago for\` (\`This Period\`/\`Last Period\`/\`Variance\`)) into \`${appFilePath}\`:\n   \`python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\\n...\\nEOF\``

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

  const isNoOpTurn = isConversationalNoOpPrompt(userPrompt)
  const effectiveLookmlIntent =
    toolMode === 'lookml' || useCase === 'lookml' || (useCase === 'auto' && matchExplicitUseCaseRule(userPrompt, allowedModes) === 'lookml')
  const isLookmlOnboardingIntake =
    !isNoOpTurn && effectiveLookmlIntent && !lookmlProjectId?.trim() && isNewProjectOnboardingIntakePrompt(userPrompt, priorMessages)
  const isLookmlSchemaDiscovery =
    !isNoOpTurn && !isLookmlOnboardingIntake && effectiveLookmlIntent && isConnectionSchemaDiscoveryPrompt(userPrompt)
  const isToollessTurn = isLookmlOnboardingIntake || isNoOpTurn
  const requiresBashSandbox = !isToollessTurn && !isLookmlSchemaDiscovery && !isDashboardMode && effectiveToolType !== 'tile'

  let resolvedAvailableConnections = providedConnections
  if (isLookmlOnboardingIntake && resolvedAvailableConnections === undefined && sdk) {
    const connStart = Date.now()
    const fetchedConns = await discoverAccessibleConnections(sdk)
    lookerHttpMs += Date.now() - connStart
    if (fetchedConns.length > 0) lookerHttpCalls += 1
    resolvedAvailableConnections = formatAccessibleConnectionsMarkdown(fetchedConns)
  }

  const systemGuide =
    customSystemGuide ||
    (toolMode === 'lookml' || isLookmlOnboardingIntake
      ? buildLookmlSystemGuide({
          selectedExplores, primaryModel, primaryExplore, projectId: lookmlProjectId,
          activatedSkills: activatedLookmlSkills, userPrompt, developableProjects, canDeploy,
          availableConnections: resolvedAvailableConnections,
        })
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

  // ponytail: omit { type: 'code_execution' } and blocking container boot on toolless intake / no-op turns
  // and CodeMode-only turns (/dashboard, Turn-2 connection_schemas discovery, /tile).
  const activeTools = isToollessTurn
    ? []
    : isDashboardMode
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    : !requiresBashSandbox
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    : [{ type: 'code_execution' }, LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]

  const historyDigest =
    priorMessages && priorMessages.length > 0
      ? `\n\nPrior conversation context:\n${priorMessages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-40).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')}`
      : ''

  const warmTurnDirective =
    !isNoOpTurn && !effectiveLookmlIntent && mode === 'data_app' && toolMode !== 'lookml' && Boolean(existingAppCode?.trim())
      ? `[WARM SANDBOX FAST PATH: ${appFilePath} and the discovered Looker schema are already in /workspace. Do NOT re-run run_looker_codemode discovery or re-read guides unless a brand-new explore is requested. Update ${appFilePath} and bundle in ONE code_execution call via: python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\n...\nEOF\nNEVER echo <DATA_APP_BUNDLE> in your text reply.]\n\n`
      : !isNoOpTurn && isDashboardMode && normalizedExistingNative
      ? `[WARM CONTENT STUDIO FAST PATH: Active Looker ${normalizedExistingNative.contentType} id="${normalizedExistingNative.id}" ("${normalizedExistingNative.title}") and pre-hydrated active_content (element_ids=${JSON.stringify(normalizedExistingNative.elementIds || [])}, filter_names=${JSON.stringify(normalizedExistingNative.filterNames || [])}, lookml_dashboard_id="${normalizedExistingNative.lookmlDashboardId || ''}", project_id="${normalizedExistingNative.projectId || lookmlProjectId || ''}") are pre-injected in run_looker_codemode vars. Execute the update in ONE run_looker_codemode call using upsert_udd / upsert_lookml_dashboard / reflow_24col / pin_to_board / schedule_dashboard + return emit_native_bundle(...). NEVER echo <NATIVE_CONTENT_BUNDLE> in your text reply.]\n\n`
      : !isNoOpTurn && requiresBashSandbox && effectiveLookmlIntent
      ? `[WARM LOOKML SANDBOX: Before running \`lkr\`, ensure \`command -v lkr >/dev/null 2>&1 || python3 /workspace/bootstrap_lookml.py cli\` so \`/usr/local/bin/lkr\` is linked from \`/workspace/.uv_tools\`.]\n\n`
      : ''

  const autoRoutingDirective =
    useCase === 'auto'
      ? `\n\n[AUTO USE-CASE ROUTING: Consult /workspace/AGENTS.md ("## Use Case Auto-Classification (Turn 1 Routing)"). Allowed use cases for this user: ${JSON.stringify(allowedModes && allowedModes.length > 0 ? allowedModes : ['app', 'data-investigator', 'dashboard', 'lookml', 'health-check', 'tile', 'conversational-analytics'])}. Start your response with <USE_CASE>...</USE_CASE> naming the single best allowed use case, then execute that workflow. CRITICAL: (1) Conversational/Follow-Up No-Op: for greetings, help, meta/error summaries, or follow-up questions not requesting a right-pane artifact, answer directly in chat with zero tools and do NOT run bundle_app.py, emit_native_bundle, or redirect to CA. (2) Ad-Hoc Looker Instance/Folder/Content/SDK Queries (<USE_CASE>tile</USE_CASE>): route folder, personal space, favorite, user, permission, schedule, or metadata lookups to <USE_CASE>tile</USE_CASE> via run_looker_codemode (use format_content_inventory(folders) for clickable /dashboards/<id>, /looks/<id>, /folders/<id> links, max 2 per folder when >5 items or multiple folders, saving full list to /workspace/content_inventory.md) without creating a right-pane Script unless asked, and offer to save as a reusable Script. (3) Open-Ended Analytical Questions: when no explore is pre-selected, call search_agents() in run_looker_codemode; if a CA agent covers it, emit <USE_CASE>conversational-analytics</USE_CASE> and <CA_AGENT_SELECTION>{"agent_id":"<matched_id>","rationale":"<1-sentence reason>"}</CA_AGENT_SELECTION>; else answer via run_inline_query. (4) Data Investigator: route "investigate"/"find out"/"figure out"/"dig into"/"what drove"/"what caused" prompts to <USE_CASE>data-investigator</USE_CASE> using /workspace/skills/data-investigator/SKILL.md and /workspace/skills/key-driver-analysis/SKILL.md.]`
      : ''

  const uploadsSection = uploadedFileNotices.length > 0 ? `\n\nAttached files in /workspace/uploads:\n${uploadedFileNotices.join('\n')}` : ''
  const effectiveThinkingLevel: StudioThinkingLevel =
    isLookmlOnboardingIntake || isLookmlSchemaDiscovery ? 'low' : thinkingLevel
  const thinkingDirective =
    effectiveThinkingLevel === 'low' ? '[THINKING LEVEL: LOW — Be concise and minimize exploratory steps]\n\n'
      : effectiveThinkingLevel === 'high' ? '[THINKING LEVEL: HIGH — Reason deeply and verify edge cases thoroughly]\n\n' : ''

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
  const baseAgentBody = { agent: 'antigravity-preview-09-2026', agent_config: agentConfig, background: true, tools: activeTools }
  const buildFreshPayload = (): Record<string, unknown> => ({
    ...baseAgentBody,
    input: buildInputItems(true),
    environment: {
      type: 'remote',
      sources: buildWorkspaceSources({
        schemaMarkdown, appFilePath, existingAppCode: mode === 'data_app' ? existingAppCode : undefined,
        cachedExploreSchemas: getSharedEnvExploreSchemas(activeEnvId), extraSources: [...(extraSources || []), ...uploadSources],
      }),
    },
  })

  const provisionFreshEnvironmentInteraction = (): Promise<AntigravityInteractionPayload> =>
    withCoalescedEnvProvision(userProvisionKey, async () => {
      const created = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', buildFreshPayload())
      return { envId: normalizeEnvironmentId(created?.environment_id) || '', value: created }
    })

  if (signal?.aborted) await throwIfAborted()
  onStatus(isLookmlOnboardingIntake ? 'Checking accessible Looker connections...' : 'Starting Antigravity sandbox interaction...')
  if (!activeEnvId && inFlightEnvProvisionByUser.has(userProvisionKey) && (requiresBashSandbox || isDashboardMode)) {
    try {
      const coalescedId = normalizeEnvironmentId(await inFlightEnvProvisionByUser.get(userProvisionKey)!)
      if (coalescedId) activeEnvId = coalescedId
    } catch { /* ignore */ }
  }
  if (warmEnvironmentInBackground && !requiresBashSandbox && !activeEnvId && !inFlightEnvProvisionByUser.has(userProvisionKey)) {
    void prewarmOrWakeAntigravityEnvironment({
      sdk, userId, extensionSDK, auth, toolType: effectiveToolType, model: activeModel, maxTotalTokens: resolvedMaxTokens,
      selectedExplores, schemaMarkdown, existingAppCode: mode === 'data_app' ? existingAppCode : undefined, onEnvironmentUpdated,
    }).catch(() => {})
  }
  if (signal?.aborted) await throwIfAborted()

  let interaction: AntigravityInteractionPayload
  let usedDirectStatelessModel = false
  if (isLookmlOnboardingIntake || (isNoOpTurn && isFreshConversation)) {
    usedDirectStatelessModel = true
    interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
      model: activeModel, store: false, background: false, tools: [],
      generation_config: { thinking_level: 'low', max_output_tokens: 2048 },
      input: buildInputItems(true),
    })
  } else if (!requiresBashSandbox || activeEnvId) {
    try {
      interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        ...baseAgentBody,
        input: buildInputItems(isFreshConversation),
        ...(activeEnvId ? { environment: activeEnvId } : {}),
        ...(isFreshConversation ? {} : { previous_interaction_id: session.lastInteractionId }),
      })
    } catch (err) {
      if ((!requiresBashSandbox ? !activeEnvId : !isEnvironmentNotFoundError(err)) && isFreshConversation) throw err
      apiRetries += 1
      if (!requiresBashSandbox) {
        activeEnvId = undefined
        interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', { ...baseAgentBody, input: buildInputItems(true) })
      } else {
        onStatus('Resumed sandbox expired; provisioning fresh sandbox with app state...')
        interaction = await provisionFreshEnvironmentInteraction()
      }
    }
  } else {
    interaction = await provisionFreshEnvironmentInteraction()
  }
  if (interaction.id) onInteractionCreated?.(interaction.id)
  await throwIfAborted(interaction.id)
  let trackedEnvId: string | undefined = normalizeEnvironmentId(interaction.environment_id) || activeEnvId
  if (trackedEnvId && schemaMarkdown && selectedExplores.length > 0) {
    selectedExplores.forEach((expKey) => recordSharedEnvExploreSchema(trackedEnvId, expKey, schemaMarkdown))
  }
  await persistUserEnvIfChanged({ sdk, extensionSDK, userId, previousEnvId: initialEnvId, nextEnvId: trackedEnvId, onEnvironmentUpdated })

  let pollIdx = 0, prevStepCount = (interaction.steps || []).length, prevStatus = interaction.status, bridgeRound = 0, actionRound = 0, incompleteRound = 0
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

  const endpointLogsByCallId = new Map<string, string[]>()
  let activeLookerCallId = ''
  const attachEndpointLogs = (steps?: AntigravityInteractionStep[]): AntigravityInteractionStep[] | undefined =>
    steps?.map((st) => {
      const logs = st?.id ? endpointLogsByCallId.get(String(st.id)) : undefined
      return logs?.length ? ({ ...st, endpoint_logs: [...logs] } as AntigravityInteractionStep) : st
    })
  const emitProgressSteps = (currInteraction: AntigravityInteractionPayload): AntigravityActivityStep[] => {
    const rawCombined = accumulatedSteps.length > 0 ? [...accumulatedSteps, ...(currInteraction?.steps || [])] : currInteraction?.steps
    const steps = extractInteractionActivitySteps({ ...currInteraction, steps: attachEndpointLogs(rawCombined) })
    if (steps.length > 0) onProgressSteps?.(steps)
    return steps
  }
  const turnSdk = createDeduplicatedLookerSdkProxy(sdk, (res, elapsedMs, err, reqMeta) => {
    lookerHttpCalls += 1
    lookerHttpMs += elapsedMs
    const failed = Boolean(err || (res && (res.ok === false || Number(res.statusCode) >= 400)))
    if (failed) apiRetries += 1
    if (reqMeta?.path) {
      const epLine = `${reqMeta.method} ${reqMeta.path}${failed ? ' [ERR]' : ''} (${elapsedMs}ms)`
      if (activeLookerCallId) {
        const list = endpointLogsByCallId.get(activeLookerCallId) || []
        list.push(epLine)
        endpointLogsByCallId.set(activeLookerCallId, list)
      }
      const friendly = formatFriendlyLookerActivityLabel('', { path: reqMeta.path })
      onStatus(`${friendly.statusText.replace(/\.\.\.$/, '')} (${epLine})`)
      if (activeLookerCallId && interaction) emitProgressSteps(interaction)
    }
  })
  const envSlotKey = normalizeEnvironmentId(trackedEnvId) || 'remote'
  const envConcurrencySlot = activeInteractionsByEnv.get(envSlotKey) || 0
  activeInteractionsByEnv.set(envSlotKey, envConcurrencySlot + 1)
  const postContinuation = async (input: Array<Record<string, unknown>>, envFallback?: string, extraSteps: AntigravityInteractionStep[] = []) => {
    accumulateInteractionUsage(interaction)
    accumulatedSteps.push(...(interaction.steps || []), ...extraSteps)
    const resumeEnv = interaction.environment_id || trackedEnvId || envFallback
    interaction = await callInteractionsApi(
      extensionSDK, auth, 'interactions', 'POST',
      Object.assign({ agent: 'antigravity-preview-09-2026', agent_config: agentConfig, background: true, previous_interaction_id: interaction.id, tools: activeTools, input }, resumeEnv ? { environment: resumeEnv } : null)
    )
    if (interaction.id) onInteractionCreated?.(interaction.id)
    await throwIfAborted(interaction.id)
    if (interaction.environment_id) trackedEnvId = interaction.environment_id
    pollIdx = 0; prevStepCount = (interaction.steps || []).length; prevStatus = interaction.status
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
            for (let bIdx = 0; bIdx < preBridgeReqs.length; bIdx += 1) {
              const req = preBridgeReqs[bIdx]
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
                sanitizeActivityThought(parseStepArguments(c.arguments ?? c.args).thought)
              )
              .find(Boolean)
            const friendlyCall = formatFriendlyLookerActivityLabel(
              String(firstCallArgs.code || ''),
              { ...defaultCodeModeVars, ...firstCallArgs }
            )
            onStatus(firstThought || friendlyCall.statusText)
            const cmStart = Date.now()
            codemodeCalls += pendingLookerCalls.length
            const resultsInput = await Promise.all(
              pendingLookerCalls.map(async (call: AntigravityInteractionStep) => {
                activeLookerCallId = String(call.id || '')
                const args = parseStepArguments(call.arguments ?? call.args)
                const callThought =
                  sanitizeActivityThought(args.thought) ||
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
                      vars: { ...defaultCodeModeVars, ...customVars },
                    })
                  }
                } catch (err: unknown) {
                  apiRetries += 1
                  codeModeOutput = JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
                }
                // ponytail: /v1beta/interactions requires function_result.result to be a plain JS Struct object (never a JSON string)
                let structResult: Record<string, unknown>
                try {
                  const parsed: unknown = JSON.parse(codeModeOutput)
                  structResult = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? (parsed as Record<string, unknown>)
                    : { result: parsed }
                } catch {
                  structResult = { result: codeModeOutput }
                }
                return {
                  type: 'function_result' as const,
                  name: call.name || 'run_looker_codemode',
                  call_id: call.id,
                  result: structResult,
                }
              })
            )
            activeLookerCallId = ''
            codemodeExecMs += Date.now() - cmStart
            await throwIfAborted(interaction.id)
            await postContinuation(resultsInput, requiresBashSandbox ? 'remote' : undefined, resultsInput)
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
          .map((r) => sanitizeActivityThought(r.thought))
          .find(Boolean)
        const firstBridgeReq = pendingBridgeReqs[0]
        const friendlyBridge = formatFriendlyLookerActivityLabel(
          String(firstBridgeReq?.code || ''),
          { ...defaultCodeModeVars, ...(firstBridgeReq as unknown as Record<string, unknown>) }
        )
        onStatus(firstBridgeThought || friendlyBridge.statusText)
        const bridgeStart = Date.now()
        const bridgedLines: string[] = []
        for (let bIdx = 0; bIdx < pendingBridgeReqs.length; bIdx += 1) {
          const req = pendingBridgeReqs[bIdx]
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
          const seedText = [
            '[LKR_EXTENSION_BRIDGE_RESULT] Executed online lkr-dev-cli request(s) in the host Looker Extension.',
            'Write the resolved JSON payload(s) below to /workspace/.lkr_extension_cache/ and re-run your sandbox command so it hits the local cache and completes:',
            ...bridgedLines,
          ].join('\n\n')
          await postContinuation([{ type: 'text', text: seedText }], 'remote')
          continue
        }
      }

      if (
        interaction.status === 'incomplete' &&
        !usedDirectStatelessModel &&
        Boolean(interaction.id) &&
        !hasFinalBundle &&
        incompleteRound < 2 &&
        extractInteractionOutputText(interaction) === 'Completed.'
      ) {
        incompleteRound += 1
        await throwIfAborted(interaction.id)
        onStatus('Resuming incomplete turn...')
        await postContinuation([{ type: 'text', text: 'Continue and complete the current request.' }], requiresBashSandbox ? 'remote' : undefined)
        continue
      }

      break
    }
  } finally {
    const remaining = (activeInteractionsByEnv.get(envSlotKey) || 1) - 1
    if (remaining <= 0) activeInteractionsByEnv.delete(envSlotKey)
    else activeInteractionsByEnv.set(envSlotKey, remaining)
  }

  if (accumulatedSteps.length > 0 || incompleteRound > 0 || bridgeRound > 0 || actionRound > 0) {
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
    steps: attachEndpointLogs(interaction.steps),
    status: 'completed',
  }).map((s) => ({ ...s, status: 'done' as const }))
  if (activitySteps.length > 0) {
    onProgressSteps?.(activitySteps)
  }
  const thinkingDurationSec = Math.max(1, Math.round((Date.now() - turnStartMs) / 1000))

  const bundle =
    mode === 'data_app' || useCase === 'auto'
      ? extractBundleFromInteraction(interaction)
      : null
  const nativeBundle =
    mode === 'dashboard' || useCase === 'auto'
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

  let finalAssistantText =
    cleanAssistantText ||
    (bundle ? `Built "${bundle.title}".`
      : nativeBundle ? `Built "${nativeBundle.title}".`
      : lookmlBundle ? `Updated LookML "${lookmlBundle.title}".`
      : tddMarkdown ? 'Synthesized 7-section Technical Design Document (TECHNICAL_DESIGN_DOCUMENT.md).'
      : 'Done.')
  const lookmlPid = lookmlBundle?.project_id?.trim()
  if (lookmlPid && !/\/projects\/[^/\s)]+/i.test(finalAssistantText)) {
    finalAssistantText = `${finalAssistantText}\n\n[Open ${lookmlPid} in Looker IDE](/projects/${encodeURIComponent(lookmlPid)})`
  }
  if (nativeBundle) {
    const ct = nativeBundle.content_type || nativeBundle.contentType || 'dashboard'
    const dashId = nativeBundle.embed_path?.match(/\/dashboards\/([^/?#\s]+)/)?.[1] || (nativeBundle as NativeContentBundle & { dashboard_id?: string }).dashboard_id || nativeBundle.id
    if ((ct === 'dashboard' || ct === 'lookml_dashboard') && dashId && !/\/dashboards\/[^\s)]+/i.test(finalAssistantText)) {
      finalAssistantText = `${finalAssistantText}\n\n[Open ${nativeBundle.title || 'Dashboard'}](/dashboards/${dashId})`
    }
  }

  return {
    bundle,
    nativeBundle,
    lookmlBundle,
    tddMarkdown,
    resolvedUseCase,
    rawOutputText: rawText,
    assistantText: finalAssistantText,
    session: {
      environmentId: finalEnvId,
      lastInteractionId: interaction.id,
      ...(usedDirectStatelessModel ? { statelessTurn: true } : {}),
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
  const { extensionSDK, auth, maxHops = 12 } = opts
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
          if (it && typeof it === 'object' && (it as { type?: string }).type === 'function_result') {
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
  const { extensionSDK, auth, conversationId, label, useCase, model, thinkingLevel, messages = [], liveActivitySteps = [], busyStatus, contentItems = [], maxTurns = 30, maxWorkspaceFiles = 10 } = opts
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
