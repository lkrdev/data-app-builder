import type { Looker40SDK } from '@looker/sdk'

import {
  callInteractionsApi,
  fetchEnvironmentFile,
} from './antigravityAuth'
import {
  buildWorkspaceSources,
  persistUserEnvIfChanged,
  prewarmOrWakeAntigravityEnvironment,
  stripControlTags,
  toSafeConversationId,
  withCoalescedEnvProvision,
} from './antigravityEnv'
import { executeAntigravityPollingLoop } from './antigravityLoop'
import {
  buildNativeContentGuide,
  DATA_APP_GUIDE_MD,
  DATA_INVESTIGATOR_GUIDE_MD,
} from './antigravityPrompts'
import { sanitizeConversationLabel } from './antigravityStarters'
import {
  type AlertInspectorBundle,
  collectInteractionTextCandidates,
  extractAlertBundleFromInteraction,
  extractBundleFromInteraction,
  extractInteractionOutputText,
  extractInteractionTelemetry,
  extractNativeContentFromInteraction,
  extractTddFromInteraction,
} from './antigravitySteps'
import {
  type AgentSession,
  type AntigravityActivityStep,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  type AntigravityToolType,
  type AntigravityTurnTelemetry,
  cleanLookmlProjectId,
  type CodeModePermissionDecision,
  type CodeModePermissionRequest,
  DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_MAX_TOOL_ROUNDS,
  DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_POLL_SCHEDULE_MS,
  DEFAULT_THINKING_LEVEL,
  getSharedEnvExploreSchemas,
  inFlightEnvProvisionByUser,
  isEnvironmentNotFoundError,
  normalizeEnvironmentId,
  type PastedImage,
  recordSharedEnvExploreSchema,
  resolveUserProvisionKey,
  type StudioThinkingLevel,
} from './antigravityTypes'
import {
  type AccessibleLookerConnection,
  type DataAppBundle,
  discoverAccessibleConnections,
  extractResolvedUseCase,
  formatAccessibleConnectionsMarkdown,
  isConversationalNoOpPrompt,
  matchExplicitUseCaseRule,
  type NativeContentBundle,
  type NativeContentState,
  normalizeNativeContent,
  parseExploreId,
  type ResolvedStudioUseCase,
  type StudioUseCase,
} from './lookerApi'
import { KDA_SKILL_MD } from './lookmlSkills'
import {
  buildLookmlSystemGuide,
  extractLookmlBundleFromInteraction,
  LKR_CLI_BRIDGE_TOOL,
  LkrCodeMode,
  type LookmlBundle,
} from './lookmlTool'

export * from './antigravityTypes'
export * from './antigravityAuth'
export * from './antigravitySteps'
export * from './antigravityStarters'
export * from './antigravityPrompts'
export * from './antigravityEnv'
export * from './antigravityLoop'
export * from './lookmlSkills'
export {
  buildStudioRoute, clampLeftPaneWidth, classifyStudioUseCase, convertRelativeDateFilterToFixed,
  copyTextWithExtensionSdk, DEFAULT_BUSY_SEND_ACTION, DEFAULT_LEFT_PANE_WIDTH, discoverAccessibleConnections, EXPLICIT_SCRIPT_CREATION_RE,
  extractResolvedUseCase, formatAccessibleConnectionsMarkdown, formatContentInventoryMarkdown, getAllowedUseCases, getUseCaseLabel,
  isConversationalNoOpPrompt, isLookerInstanceMetadataQuery, loadStoredBusySendAction, loadStoredLeftPaneWidth, loadStoredRightPaneCollapsed,
  LOOKER_ALERT_QUERY_RE, matchExplicitUseCaseRule, MAX_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH,
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
  maxToolRounds?: number
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
  alertBundle?: AlertInspectorBundle | null
  tddMarkdown: string | null
  assistantText: string
  rawOutputText?: string
  resolvedUseCase: ResolvedStudioUseCase
  session: AgentSession
  telemetry: AntigravityTurnTelemetry
  activitySteps?: AntigravityActivityStep[]
  thinkingDurationSec?: number
  permissionError?: string
}

export function isNewProjectOnboardingIntakePrompt(
  userPrompt?: string,
  priorMessages?: ReadonlyArray<{ role: string; text: string }>,
  attachedFiles?: ReadonlyArray<PastedImage>
): boolean {
  const clean = String(userPrompt || '').trim()
  if (/(?:^|\s)\/(?!looker-project-onboarding\b)[a-z0-9_-]+/i.test(clean)) return false
  if (!/(?:\b(?:create|onboard|scaffold|set\s*up|start|initialize|init)\b[\s\S]{0,30}\b(?:new\s+)?(?:looker\s+|lookml\s+)?project\b|\bnew\s+(?:looker\s+|lookml\s+)project\b|\/looker-project-onboarding\b)/i.test(clean)) return false
  const combined = [
    ...(priorMessages || []).map((m) => String(m.text || '')),
    clean,
    ...(attachedFiles || []).map((f) => `${f.name || ''}\n${f.textContent || ''}`),
  ].join('\n')
  const hasConn = /\bconnection(?:\s+name)?\s*(?:is|=|:|\s)\s*[`"']?(?!(?:name|and|or|to|for|from|in|on|with|access|a|the)\b)[a-z][a-z0-9_-]{2,}|\b[a-z][a-z0-9_-]*(?:\s+default)?\s+connection\b/i.test(combined)
  const hasProj = /\b(?:called|call\s+it|named?|project(?:_id|_name|\s+name)?)\s*(?:is|=|:|\s)\s*[`"']?(?!(?:name|called|named|and|or|to|for|from|in|on|with|a|the)\b)[a-z][a-z0-9_]{2,}/i.test(combined)
  const hasTarget =
    (attachedFiles || []).some((f) => /\.sql$/i.test(String(f.name || ''))) ||
    /\b(?:schema|dataset|tables?)\s*(?:is|=|:|\s)\s*[`"']?(?!(?:name|or|and|to|for|from|in|on|with|access|do|you|a|the)\b)[a-z][a-z0-9_.-]{2,}|\bselect\b[\s\S]+\bfrom\b/i.test(combined)
  return !(hasConn && hasProj && hasTarget)
}

export function isConnectionSchemaDiscoveryPrompt(userPrompt?: string): boolean {
  const clean = String(userPrompt || '').trim()
  if (!clean || /\b(?:use|select|pick)\s+(?:the\s+)?\S+\s+(?:dataset|schema)\b|\b(?:profile|refinement|silver|bronze|measure|dashboard|data\s*app)\b/i.test(clean)) return false
  return /\b(?:what|which|list|show|check|discover|inspect)\b[\s\S]{0,60}\b(?:schemas?|datasets?)\b|\bschemas?\s+(?:do\s+you|does\s+(?:it|that|this|the)|available|on\s+(?:that|this|the)?\s*connection)/i.test(clean)
}

export async function runAntigravityTurn(params: RunAntigravityTurnOptions): Promise<AntigravityTurnResult> {
  const turnStartMs = Date.now()
  let initialLookerHttpMs = 0, initialLookerHttpCalls = 0, initialApiRetries = 0

  const {
    sdk, extensionSDK, userId, environmentId, conversationId: rawConversationId, onEnvironmentUpdated, auth, session,
    model = DEFAULT_ANTIGRAVITY_MODEL, thinkingLevel = DEFAULT_THINKING_LEVEL, maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS, maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS, mode = 'data_app', useCase = 'auto',
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

  const isNoOpTurn = isConversationalNoOpPrompt(userPrompt)
  const effectiveLookmlIntent =
    toolMode === 'lookml' || useCase === 'lookml' || (useCase === 'auto' && matchExplicitUseCaseRule(userPrompt, allowedModes) === 'lookml')
  const effectiveToolType: AntigravityToolType =
    toolMode === 'lookml' || effectiveLookmlIntent ? 'lookml'
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
\`\`\`${schemaMarkdown.includes('## Model:') ? `\n\n${schemaMarkdown}` : ''}`

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
  const isKdaSkillActive =
    isDataInvestigatorTurn ||
    /(?:^|\s)\/key-driver-analysis(?=\s|$)/i.test(userPrompt) ||
    (activatedLookmlSkills || []).includes('key-driver-analysis')
  const kdaGuideSuffix = isKdaSkillActive
    ? `\n\n${KDA_SKILL_MD}\n\nIMPORTANT: All kda_toolkit.py helpers (resolve_source, inspect_explore_for_kda, analyze_target, run_kda, drill_top_driver, print_kda_summary) are pre-loaded directly inside run_looker_codemode! Call resolve_source({"dashboard_id": "..."}) + inspect_explore_for_kda(m, e) + analyze_target(...) in ONE run_looker_codemode call instead of manually looping over dashboard elements.`
    : ''

  const dataAppOrNativeGuide =
    (mode === 'dashboard'
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
        ].join('\n')) + kdaGuideSuffix

  const isLookmlOnboardingIntake =
    !isNoOpTurn && effectiveLookmlIntent && !lookmlProjectId?.trim() && isNewProjectOnboardingIntakePrompt(userPrompt, priorMessages, images)
  const isLookmlSchemaDiscovery =
    !isNoOpTurn && !isLookmlOnboardingIntake && effectiveLookmlIntent && isConnectionSchemaDiscoveryPrompt(userPrompt)
  const isToollessTurn = isLookmlOnboardingIntake || isNoOpTurn
  const requiresBashSandbox = !isToollessTurn && !isLookmlSchemaDiscovery && !isDashboardMode && effectiveToolType !== 'tile'

  let resolvedAvailableConnections = providedConnections
  if ((isLookmlOnboardingIntake || (effectiveLookmlIntent && !lookmlProjectId?.trim())) && resolvedAvailableConnections === undefined && sdk) {
    const connStart = Date.now()
    const fetchedConns = await discoverAccessibleConnections(sdk)
    initialLookerHttpMs += Date.now() - connStart
    if (fetchedConns.length > 0) initialLookerHttpCalls += 1
    resolvedAvailableConnections = formatAccessibleConnectionsMarkdown(fetchedConns)
  }

  const systemGuide =
    customSystemGuide ||
    (effectiveLookmlIntent || isLookmlOnboardingIntake
      ? buildLookmlSystemGuide({
          selectedExplores, primaryModel, primaryExplore, projectId: lookmlProjectId,
          activatedSkills: activatedLookmlSkills, userPrompt, developableProjects, canDeploy,
          availableConnections: resolvedAvailableConnections,
        })
      : dataAppOrNativeGuide)

  const uploadSources: Array<{ type: 'inline'; content: string; target: string }> = []
  const uploadedFileNotices: string[] = []
  const uploadedFilesMap: Record<string, string> = {}
  for (let i = 0; i < (images || []).length; i += 1) {
    const file = images![i]
    const fallbackExt = file.mimeType.startsWith('image/') ? `.${file.mimeType.split('/')[1] || 'png'}` : file.mimeType === 'application/pdf' ? '.pdf' : '.txt'
    const safeName = (file.name || `attachment_${i + 1}${fallbackExt}`).replace(/[^a-zA-Z0-9._-]+/g, '_')
    const targetPath = `/workspace/uploads/${safeName}`
    uploadSources.push({ type: 'inline', target: targetPath, content: file.textContent !== undefined ? file.textContent : file.dataUrl || file.data })
    if (file.textContent !== undefined) {
      uploadedFilesMap[safeName] = file.textContent
      uploadedFilesMap[targetPath] = file.textContent
      uploadedFileNotices.push(
        `- \`${targetPath}\` (${file.mimeType}${file.size ? `, ${file.size} bytes` : ''}; also pre-loaded in \`run_looker_codemode\` as \`uploaded_files[${JSON.stringify(safeName)}]\` and \`uploaded_files[${JSON.stringify(targetPath)}]\`):\n\`\`\`\n${file.textContent.slice(0, 64000)}\n\`\`\``
      )
    } else {
      uploadedFileNotices.push(`- \`${targetPath}\` (${file.mimeType}${file.size ? `, ${file.size} bytes` : ''})`)
    }
  }

  // ponytail: omit { type: 'code_execution' } and blocking container boot on toolless intake / no-op turns
  // and CodeMode-only turns (/dashboard, Turn-2 connection_schemas discovery, /tile).
  // Retain LKR_CLI_BRIDGE_TOOL on warm turns after LookML turns so previous_interaction_id history replays stay valid.
  const keepLookmlBridgeTool =
    !isFreshConversation && Boolean(session.usedBridgeTool || session.toolType === 'lookml' || lookmlProjectId?.trim())
  const activeTools = isLookmlOnboardingIntake || (isNoOpTurn && isFreshConversation)
    ? []
    : isNoOpTurn || (keepLookmlBridgeTool && (isDashboardMode || !requiresBashSandbox))
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL, ...(keepLookmlBridgeTool ? [LKR_CLI_BRIDGE_TOOL] : [])]
    : isDashboardMode
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    : !requiresBashSandbox
    ? [LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL]
    : [
        { type: 'code_execution' },
        LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL,
        ...(effectiveToolType === 'lookml' || keepLookmlBridgeTool ? [LKR_CLI_BRIDGE_TOOL] : []),
      ]

  const warmTurnDirective =
    !isNoOpTurn && !effectiveLookmlIntent && mode === 'data_app' && Boolean(existingAppCode?.trim())
      ? `[WARM SANDBOX FAST PATH: ${appFilePath} and the discovered Looker schema are already in /workspace. Do NOT re-run run_looker_codemode discovery or re-read guides unless a brand-new explore is requested. Update ${appFilePath} and bundle in ONE code_execution call via: python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" << 'EOF'\n...\nEOF\nNEVER echo <DATA_APP_BUNDLE> in your text reply.]\n\n`
      : !isNoOpTurn && isDashboardMode && normalizedExistingNative
      ? `[WARM CONTENT STUDIO FAST PATH: Active Looker ${normalizedExistingNative.contentType} id="${normalizedExistingNative.id}" ("${normalizedExistingNative.title}") and pre-hydrated active_content (element_ids=${JSON.stringify(normalizedExistingNative.elementIds || [])}, filter_names=${JSON.stringify(normalizedExistingNative.filterNames || [])}, lookml_dashboard_id="${normalizedExistingNative.lookmlDashboardId || ''}", project_id="${normalizedExistingNative.projectId || lookmlProjectId || ''}") are pre-injected in run_looker_codemode vars. Execute the update in ONE run_looker_codemode call using upsert_udd / upsert_lookml_dashboard / reflow_24col / pin_to_board / schedule_dashboard + return emit_native_bundle(...). NEVER echo <NATIVE_CONTENT_BUNDLE> in your text reply.]\n\n`
      : !isNoOpTurn && isDashboardMode && !normalizedExistingNative
      ? `${systemGuide}\n\n`
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

  const buildInputItems = (fresh: boolean): Array<Record<string, unknown>> => {
    const historyDigest =
      fresh && priorMessages && priorMessages.length > 0
        ? `\n\nPrior conversation context:\n${priorMessages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-40).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')}`
        : ''
    return [
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
  }

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

  let initialInteraction: AntigravityInteractionPayload
  let usedDirectStatelessModel = false
  if (isLookmlOnboardingIntake || (isNoOpTurn && isFreshConversation)) {
    usedDirectStatelessModel = true
    initialInteraction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
      model: activeModel, store: false, background: false, tools: [],
      generation_config: { thinking_level: 'low', max_output_tokens: 2048 },
      input: buildInputItems(true),
    })
  } else if (!requiresBashSandbox || activeEnvId) {
    try {
      initialInteraction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        ...baseAgentBody,
        input: buildInputItems(isFreshConversation),
        ...(activeEnvId ? { environment: activeEnvId } : {}),
        ...(isFreshConversation ? {} : { previous_interaction_id: session.lastInteractionId }),
      })
    } catch (err) {
      if ((!requiresBashSandbox ? !activeEnvId : !isEnvironmentNotFoundError(err)) && isFreshConversation) throw err
      initialApiRetries += 1
      if (!requiresBashSandbox) {
        activeEnvId = undefined
        initialInteraction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
          ...baseAgentBody,
          input: buildInputItems(true),
          environment: { type: 'remote', sources: [] },
        })
      } else {
        onStatus('Resumed sandbox expired; provisioning fresh sandbox with app state...')
        initialInteraction = await provisionFreshEnvironmentInteraction()
      }
    }
  } else {
    initialInteraction = await provisionFreshEnvironmentInteraction()
  }
  if (initialInteraction.id) onInteractionCreated?.(initialInteraction.id)
  await throwIfAborted(initialInteraction.id)
  const initialTrackedEnvId = normalizeEnvironmentId(initialInteraction.environment_id) || activeEnvId
  if (initialTrackedEnvId && schemaMarkdown && selectedExplores.length > 0) {
    selectedExplores.forEach((expKey) => recordSharedEnvExploreSchema(initialTrackedEnvId, expKey, schemaMarkdown))
  }
  await persistUserEnvIfChanged({ sdk, extensionSDK, userId, previousEnvId: initialEnvId, nextEnvId: initialTrackedEnvId, onEnvironmentUpdated })

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
    cached_explore_schemas: getSharedEnvExploreSchemas(initialTrackedEnvId),
    ...(Object.keys(uploadedFilesMap).length > 0 ? { uploaded_files: uploadedFilesMap } : {}),
    ...(activeContentVars ? { active_content: activeContentVars, active_dashboard_state: activeContentVars } : {}),
  }

  const loopRes = await executeAntigravityPollingLoop({
    sdk, extensionSDK, auth, initialInteraction, initialTrackedEnvId, agentConfig, activeTools, maxToolRounds,
    pollScheduleMs, signal, throwIfAborted, onInteractionCreated, onProgressSteps, onStatus,
    effectivePermissionHandler, requirePermission, approvedOperations, conversationId, rawConversationId,
    defaultCodeModeVars, isKdaSkillActive, isDashboardMode, toolMode, mode, useCase, effectiveLookmlIntent,
    isNoOpTurn, isDataInvestigatorTurn, userPrompt, activatedLookmlSkills, usedDirectStatelessModel,
    requiresBashSandbox, appDir, initialLookerHttpMs, initialLookerHttpCalls, initialApiRetries,
  })
  const {
    interaction, trackedEnvId, activitySteps, bridgePermissionError, isDataAppBundleTurn,
    pollWaitMs, pollCount, codemodeExecMs, lookerHttpMs, codemodeCalls, lookerHttpCalls, apiRetries,
  } = loopRes
  const thinkingDurationSec = Math.max(1, Math.round((Date.now() - turnStartMs) / 1000))

  let bundle =
    mode === 'data_app' || useCase === 'auto'
      ? extractBundleFromInteraction(interaction)
      : null
  if (!bundle && (mode === 'data_app' || useCase === 'auto') && isDataAppBundleTurn() && trackedEnvId) {
    const matchedPaths = JSON.stringify(interaction.steps || []).match(/\/workspace\/apps\/[A-Za-z0-9_-]+\/app\.js/g)
    const candidates = Array.from(new Set([...(matchedPaths || []).slice().reverse(), appFilePath]))
    for (const candidatePath of candidates) {
      try {
        const fetchedJs = (await fetchEnvironmentFile({ extensionSDK, auth, environmentId: trackedEnvId, path: candidatePath })).trim()
        if (fetchedJs && (fetchedJs.includes('LookerDataApp') || fetchedJs.includes('DataApp') || fetchedJs.includes('customElements.define'))) {
          const prodCode = fetchedJs
            .replace(/((?:from|import)\s*['"])(?:\.\/data-app\.js|\/runtime\/data-app\.js)(['"])/g, '$1https://www.gstatic.com/looker-data-apps/versions/1.2.0/data-app.js$2')
            .replace(/((?:from|import)\s*['"])\/vendor\/([^'"]+)(['"])/g, '$1https://www.gstatic.com/looker-data-apps/versions/1.2.0/vendor/$2$3')
          bundle = {
            title: sanitizeConversationLabel(userPrompt) || 'Data App',
            code: fetchedJs,
            raw_code: fetchedJs,
            prod_code: prodCode,
            widgets: [],
          }
          break
        }
      } catch {
        /* try next candidate */
      }
    }
  }
  const nativeBundle =
    mode === 'dashboard' || useCase === 'auto'
      ? extractNativeContentFromInteraction(interaction)
      : null
  let lookmlBundle = extractLookmlBundleFromInteraction(interaction)
  const bundleRefPath = (lookmlBundle as unknown as { __bundle_ref__?: string } | null)?.__bundle_ref__
  if (bundleRefPath && trackedEnvId) {
    try {
      const fullBundleJson = await fetchEnvironmentFile({
        extensionSDK,
        auth,
        environmentId: trackedEnvId,
        path: bundleRefPath,
      })
      lookmlBundle =
        extractLookmlBundleFromInteraction({ output_text: `<LOOKML_BUNDLE>${fullBundleJson}</LOOKML_BUNDLE>` }) ||
        lookmlBundle
    } catch {
      /* keep compact bundle fallback */
    }
  }
  const alertBundle = extractAlertBundleFromInteraction(interaction)
  const tddMarkdown = extractTddFromInteraction(interaction)
  const rawText = extractInteractionOutputText(interaction)
  const combinedOutput = `${rawText}\n${collectInteractionTextCandidates(interaction)}`
  const hasExplicitUseCaseTag = /<USE_CASE>\s*[^<]+?\s*<\/USE_CASE>/i.test(combinedOutput)
  const inferredFromOutput = extractResolvedUseCase(combinedOutput, userPrompt, allowedModes)
  const resolvedUseCase: ResolvedStudioUseCase =
    useCase && useCase !== 'auto' && !hasExplicitUseCaseTag
      ? useCase
      : hasExplicitUseCaseTag
      ? inferredFromOutput
      : lookmlBundle
      ? 'lookml'
      : nativeBundle
      ? 'dashboard'
      : alertBundle
      ? 'tile'
      : tddMarkdown
      ? 'health-check'
      : bundle
      ? inferredFromOutput === 'data-investigator'
        ? 'data-investigator'
        : 'app'
      : inferredFromOutput
  const cleanAssistantText = stripControlTags(rawText)

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
      : alertBundle ? `Configured Looker alert "${alertBundle.custom_title || alertBundle.title || alertBundle.alert_id}".`
      : tddMarkdown ? 'Synthesized 7-section Technical Design Document (TECHNICAL_DESIGN_DOCUMENT.md).'
      : 'Done.')
  const lookmlPid = cleanLookmlProjectId(lookmlBundle?.project_id)
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
    alertBundle,
    tddMarkdown,
    resolvedUseCase,
    rawOutputText: rawText,
    assistantText: finalAssistantText,
    ...(bridgePermissionError && (bundle || nativeBundle || lookmlBundle || alertBundle) ? { permissionError: bridgePermissionError } : {}),
    session: {
      environmentId: finalEnvId,
      lastInteractionId:
        interaction.status === 'cancelled' && session.lastInteractionId ? session.lastInteractionId : interaction.id,
      ...(usedDirectStatelessModel ? { statelessTurn: true } : {}),
      ...(session.usedBridgeTool ||
      activeTools.some((t) => (t as { name?: string }).name === 'lkr_cli_extension_bridge')
        ? { usedBridgeTool: true }
        : {}),
      conversationId,
      explores: selectedExplores,
      toolType: effectiveToolType,
    },
    telemetry,
    activitySteps,
    thinkingDurationSec,
  }
}
