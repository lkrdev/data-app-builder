import type { Looker40SDK } from '@looker/sdk'

import {
  callInteractionsApi,
  fetchEnvironmentFile,
  streamInteractionUntilActionOrDone,
} from './antigravityAuth'
import { wrapDashboardCodeMode } from './antigravityPrompts'
import {
  extractAlertBundleFromInteraction,
  extractBundleFromInteraction,
  extractInteractionActivitySteps,
  extractInteractionOutputText,
  extractNativeContentFromInteraction,
  extractTddFromInteraction,
  formatFriendlyLookerActivityLabel,
  parseStepArguments,
  sanitizeActivityThought,
  summarizeProgress,
} from './antigravitySteps'
import {
  activeInteractionsByEnv,
  type AntigravityActivityStep,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  type AntigravityInteractionStep,
  type CodeModePermissionDecision,
  type CodeModePermissionRequest,
  normalizeEnvironmentId,
  normalizeMaxToolRounds,
  resolveAdaptivePollScheduleMs,
} from './antigravityTypes'
import { createDeduplicatedLookerSdkProxy, type StudioUseCase } from './lookerApi'
import { wrapKdaCodeMode } from './lookmlSkills'
import {
  classifyLookerOperation,
  computeLkrExtensionCacheKey,
  executeLkrExtensionToolRequest,
  extractLkrExtensionToolRequests,
  extractLookmlBundleFromInteraction,
  LkrCodeMode,
  type LkrExtensionToolRequest,
} from './lookmlTool'

export interface ExecuteAntigravityPollingLoopOptions {
  sdk: Looker40SDK
  extensionSDK?: AntigravityExtensionHostLike
  auth: AntigravityAuth
  initialInteraction: AntigravityInteractionPayload
  initialTrackedEnvId?: string
  agentConfig: Record<string, unknown>
  activeTools: unknown[]
  maxToolRounds?: number
  pollScheduleMs: number[]
  signal?: AbortSignal
  throwIfAborted: (interactionId?: string) => Promise<void>
  onInteractionCreated?: (interactionId: string) => void
  onProgressSteps?: (steps: AntigravityActivityStep[]) => void
  onStatus: (statusText: string) => void
  effectivePermissionHandler?: (req: CodeModePermissionRequest) => Promise<CodeModePermissionDecision>
  requirePermission: boolean
  approvedOperations?: Set<string>
  conversationId: string
  rawConversationId?: string
  defaultCodeModeVars: Record<string, unknown>
  isKdaSkillActive: boolean
  isDashboardMode: boolean
  toolMode: 'data_app' | 'lookml'
  mode: 'data_app' | 'dashboard'
  useCase: StudioUseCase
  effectiveLookmlIntent: boolean
  isNoOpTurn: boolean
  isDataInvestigatorTurn: boolean
  userPrompt: string
  activatedLookmlSkills?: string[]
  usedDirectStatelessModel: boolean
  requiresBashSandbox: boolean
  appDir: string
  initialLookerHttpMs: number
  initialLookerHttpCalls: number
  initialApiRetries: number
}

export interface ExecuteAntigravityPollingLoopResult {
  interaction: AntigravityInteractionPayload
  trackedEnvId?: string
  activitySteps: AntigravityActivityStep[]
  bridgePermissionError: string
  isDataAppBundleTurn: () => boolean
  pollWaitMs: number
  pollCount: number
  codemodeExecMs: number
  lookerHttpMs: number
  codemodeCalls: number
  lookerHttpCalls: number
  apiRetries: number
}

export async function executeAntigravityPollingLoop(
  opts: ExecuteAntigravityPollingLoopOptions
): Promise<ExecuteAntigravityPollingLoopResult> {
  const {
    sdk, extensionSDK, auth, agentConfig, activeTools, maxToolRounds, pollScheduleMs, signal,
    throwIfAborted, onInteractionCreated, onProgressSteps, onStatus, effectivePermissionHandler,
    requirePermission, approvedOperations, conversationId, rawConversationId, defaultCodeModeVars,
    isKdaSkillActive, isDashboardMode, toolMode, mode, useCase, effectiveLookmlIntent, isNoOpTurn,
    isDataInvestigatorTurn, userPrompt, activatedLookmlSkills, usedDirectStatelessModel,
    requiresBashSandbox, appDir,
  } = opts

  let interaction = opts.initialInteraction
  let trackedEnvId = opts.initialTrackedEnvId
  let pollWaitMs = 0, pollCount = 0, codemodeExecMs = 0, codemodeCalls = 0
  let lookerHttpMs = opts.initialLookerHttpMs
  let lookerHttpCalls = opts.initialLookerHttpCalls
  let apiRetries = opts.initialApiRetries

  const resolvedMaxToolRounds = normalizeMaxToolRounds(maxToolRounds)
  const wrapUpErrorText = `Max Tool Rounds (${resolvedMaxToolRounds}) reached for this turn — summarize all progress completed so far and ask the user to reply 'continue' for remaining steps.`
  let pollIdx = 0, prevStepCount = (interaction.steps || []).length, prevStatus = interaction.status, bridgeRound = 0, actionRound = 0, incompleteRound = 0, wrapUpSent = false, transientPollErrors = 0
  let accInputTokens = 0, accOutputTokens = 0, accThoughtTokens = 0
  const accumulateInteractionUsage = (snap: AntigravityInteractionPayload | null | undefined) => {
    const u = snap?.usage || snap?.usage_metadata
    if (!u) return
    accInputTokens += Number(u.input_tokens ?? u.total_input_tokens ?? u.prompt_token_count ?? 0)
    accOutputTokens += Number(u.output_tokens ?? u.total_output_tokens ?? u.candidates_token_count ?? 0)
    accThoughtTokens += Number(u.thought_tokens ?? u.total_thought_tokens ?? u.thoughts_token_count ?? 0)
  }
  const resolvedBridgeCacheKeys = new Set<string>()
  const hydratedFileRefs = new Map<string, LkrExtensionToolRequest>()
  const resolveBridgeReq = async (r: LkrExtensionToolRequest): Promise<LkrExtensionToolRequest> => {
    if (r.kind !== 'file_ref') return r
    const reqPath = r.req_path || (r.cache_key ? `/workspace/.lkr_extension_cache/_req_${r.cache_key}.json` : '')
    if (!reqPath) throw new Error('file_ref bridge request missing req_path and cache_key')
    const cached = hydratedFileRefs.get(reqPath)
    if (cached) return cached
    const envIdForFile = normalizeEnvironmentId(interaction.environment_id) || trackedEnvId
    if (!envIdForFile) throw new Error(`Cannot hydrate ${reqPath}: missing environmentId`)
    const rawJson = await fetchEnvironmentFile({ extensionSDK, auth, environmentId: envIdForFile, path: reqPath })
    const parsed = JSON.parse(rawJson) as LkrExtensionToolRequest
    const hydrated: LkrExtensionToolRequest = {
      ...parsed,
      cache_key: r.cache_key || parsed.cache_key || computeLkrExtensionCacheKey(parsed),
    }
    hydratedFileRefs.set(reqPath, hydrated)
    return hydrated
  }
  const compactBridgeValue = (val: unknown): unknown => {
    const rawStr = JSON.stringify(val)
    if (!rawStr || rawStr.length <= 6000 || !val || typeof val !== 'object' || Array.isArray(val)) return val
    const rec = val as Record<string, unknown>
    if (!Array.isArray(rec.queries)) return val
    const compactQueries = rec.queries.map((q) => {
      if (!q || typeof q !== 'object' || Array.isArray(q)) return q
      const qRec = { ...(q as Record<string, unknown>) }
      if (rec.passed === true) delete qRec.sql
      delete qRec.inline_query
      return qRec
    })
    const tqr = rec.test_query_results
    const compactTqr =
      tqr && typeof tqr === 'object' && !Array.isArray(tqr)
        ? Object.fromEntries(
            Object.entries(tqr as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 10) : v])
          )
        : tqr
    return {
      ...rec,
      queries: compactQueries,
      ...(tqr !== undefined ? { test_query_results: compactTqr } : {}),
    }
  }
  const isNoReplayBridgeResult = (val: unknown): boolean => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return false
    const rec = val as Record<string, unknown>
    const isEmptyPull = Boolean(
      rec.__lookml_pull__ && (!rec.files || typeof rec.files !== 'object' || Object.keys(rec.files as object).length === 0)
    )
    return (
      'pushed' in rec ||
      'committed' in rec ||
      isEmptyPull ||
      Boolean('passed' in rec && (rec.all_queries_matched !== undefined || Array.isArray(rec.queries)))
    )
  }
  const encodeBridgePayload = (val: unknown): string => `\`\`\`json\n${JSON.stringify(compactBridgeValue(val))}\n\`\`\``
  const getPendingBridgeReqs = async (snap: AntigravityInteractionPayload): Promise<LkrExtensionToolRequest[]> => {
    const rawUnresolved = extractLkrExtensionToolRequests(snap).filter(
      (r) => !resolvedBridgeCacheKeys.has(r.cache_key || computeLkrExtensionCacheKey(r))
    )
    const raw = (await Promise.all(rawUnresolved.map((r) => resolveBridgeReq(r).catch(() => null)))).filter(
      (r): r is LkrExtensionToolRequest => Boolean(r)
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
  const endpointLogsByCallId = new Map<string, string[]>()
  let activeLookerCallId = ''
  const attachEndpointLogs = (steps?: AntigravityInteractionStep[]): AntigravityInteractionStep[] | undefined =>
    steps?.map((st) => {
      const logs = st?.id ? endpointLogsByCallId.get(String(st.id)) : undefined
      return logs?.length ? ({ ...st, endpoint_logs: [...logs] } as AntigravityInteractionStep) : st
    })
  const mergeSteps = (currSteps?: AntigravityInteractionStep[]): AntigravityInteractionStep[] => {
    const s = currSteps || []
    const last = accumulatedSteps[accumulatedSteps.length - 1]
    return last?.type === 'function_result' && s[0]?.type === 'function_result' && last.call_id === s[0].call_id ? s.slice(1) : s
  }
  const emitProgressSteps = (currInteraction: AntigravityInteractionPayload): AntigravityActivityStep[] => {
    const rawCombined = accumulatedSteps.length > 0 ? [...accumulatedSteps, ...mergeSteps(currInteraction?.steps)] : currInteraction?.steps
    const steps = extractInteractionActivitySteps({ ...currInteraction, steps: attachEndpointLogs(rawCombined) })
    if (steps.length > 0) onProgressSteps?.(steps)
    return steps
  }
  let mutSuccessSeq = 0
  const turnSdk = createDeduplicatedLookerSdkProxy(sdk, (res, elapsedMs, err, reqMeta) => {
    lookerHttpCalls += 1
    lookerHttpMs += elapsedMs
    const failed = Boolean(err || (res && (res.ok === false || Number(res.statusCode) >= 400)))
    if (failed) apiRetries += 1
    else if (reqMeta?.path && classifyLookerOperation(reqMeta.method, reqMeta.path).requiresPermission) mutSuccessSeq += 1
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
  const postContinuation = async (input: Array<Record<string, unknown>>, envFallback?: string, extraSteps: AntigravityInteractionStep[] = [], toolsOverride?: unknown[]) => {
    accumulateInteractionUsage(interaction)
    accumulatedSteps.push(...mergeSteps(interaction.steps), ...extraSteps)
    const resumeEnv = interaction.environment_id || trackedEnvId || envFallback
    interaction = await callInteractionsApi(
      extensionSDK, auth, 'interactions', 'POST',
      Object.assign({ agent: 'antigravity-preview-09-2026', agent_config: agentConfig, background: true, previous_interaction_id: interaction.id, tools: toolsOverride ?? activeTools, input }, resumeEnv ? { environment: resumeEnv } : null)
    )
    if (
      extraSteps.length > 0 &&
      interaction.steps?.[0]?.type === 'function_result' &&
      interaction.steps[0].call_id === extraSteps[0]?.call_id
    ) {
      accumulatedSteps.splice(accumulatedSteps.length - extraSteps.length, extraSteps.length)
    }
    if (interaction.id) onInteractionCreated?.(interaction.id)
    await throwIfAborted(interaction.id)
    if (interaction.environment_id) trackedEnvId = interaction.environment_id
    pollIdx = 0; prevStepCount = (interaction.steps || []).length; prevStatus = interaction.status
  }

  let bridgePermissionError = ''
  const trackedPermissionHandler = effectivePermissionHandler
    ? async (r: CodeModePermissionRequest) => {
        const d = await effectivePermissionHandler(r)
        if (d === 'allow_once' || d === 'allow_op' || d === 'allow_all' || (d as unknown) === true) mutSuccessSeq += 1
        return d
      }
    : undefined
  const recordPermOutcome = (val: unknown, prevSeq: number, req?: LkrExtensionToolRequest): string => {
    const s = typeof val === 'string' ? val : val instanceof Error ? val.message : JSON.stringify(val || '')
    const pErr = s.match(/PermissionError:[^\n"\\]+/)?.[0] || ''
    if (pErr) bridgePermissionError = bridgePermissionError || pErr
    else if (mutSuccessSeq > prevSeq || (req?.kind === 'sdk_request' && classifyLookerOperation(req.method, req.path).requiresPermission)) {
      bridgePermissionError = ''
    }
    return pErr
  }
  const isResolvedFunctionCall = (
    callStep: AntigravityInteractionStep,
    idx: number,
    allSteps: AntigravityInteractionStep[]
  ): boolean =>
    allSteps
      .slice(idx + 1)
      .some((later: AntigravityInteractionStep) => later.type === 'function_result' && (!callStep.id || later.call_id === callStep.id))
  const executedCodeModeByCode = new Map<string, Record<string, unknown>>()
  const isDataAppBundleTurn = (): boolean =>
    !isNoOpTurn &&
    !effectiveLookmlIntent &&
    (useCase === 'app' ||
      isDataInvestigatorTurn ||
      /(?:^|\s)\/data-apps?(?=\s|$)/i.test(userPrompt) ||
      [...accumulatedSteps, ...(interaction.steps || [])].some((s) => JSON.stringify(s).includes('bundle_app.py')))

  try {
    for (;;) {
      while (interaction.status === 'in_progress' || interaction.status === 'requires_action' || interaction.status === 'queued') {
        await throwIfAborted(interaction.id)
        if (interaction.environment_id) trackedEnvId = interaction.environment_id
        emitProgressSteps(interaction)
        if (interaction.status === 'requires_action') {
          const steps = interaction.steps || []
          const pendingLookerCalls = steps.filter(
            (s: AntigravityInteractionStep, idx: number) =>
              s.type === 'function_call' &&
              (s.name === 'run_looker_codemode' || s.name === 'lkr_cli_extension_bridge') &&
              !isResolvedFunctionCall(s, idx, steps)
          )

          if (pendingLookerCalls.length > 0 && actionRound + bridgeRound < resolvedMaxToolRounds) {
            actionRound += 1
            await throwIfAborted(interaction.id)
            let preBridgeDenied = ''
            const explicitBridgeKeys = new Set(
              pendingLookerCalls
                .filter((c: AntigravityInteractionStep) => c.name === 'lkr_cli_extension_bridge')
                .map((c: AntigravityInteractionStep) => String(parseStepArguments(c.arguments ?? c.args).cache_key || ''))
                .filter(Boolean)
            )
            const preBridgeReqs = (await getPendingBridgeReqs(interaction)).filter(
              (r) => !explicitBridgeKeys.has(r.cache_key || '')
            )
            const preBridgePayloads: Record<string, string> = {}
            for (const req of preBridgeReqs) {
              await throwIfAborted(interaction.id)
              const prevSeq = mutSuccessSeq
              try {
                const { cacheKey, result } = await executeLkrExtensionToolRequest({
                  sdk: turnSdk, req, defaultVars: defaultCodeModeVars, extensionSDK,
                  requirePermission, approvedOperations, onPermissionRequest: trackedPermissionHandler,
                  conversationId: rawConversationId || conversationId,
                })
                resolvedBridgeCacheKeys.add(cacheKey)
                const pErr = recordPermOutcome(result, prevSeq, req)
                if (pErr) preBridgeDenied = preBridgeDenied || pErr
                else if (!isNoReplayBridgeResult(result)) {
                  preBridgePayloads[`/workspace/.lkr_extension_cache/${cacheKey}.json`] = JSON.stringify(compactBridgeValue(result))
                }
              } catch (err: unknown) {
                const pErr = recordPermOutcome(err, prevSeq)
                if (pErr) {
                  resolvedBridgeCacheKeys.add(req.cache_key || computeLkrExtensionCacheKey(req))
                  preBridgeDenied = preBridgeDenied || pErr
                }
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
            const resultsInput: AntigravityInteractionStep[] = []
            for (const call of pendingLookerCalls) {
              activeLookerCallId = String(call.id || '')
              const args = parseStepArguments(call.arguments ?? call.args)
              const callThought =
                sanitizeActivityThought(args.thought) ||
                (call.name === 'lkr_cli_extension_bridge' && (args.method || args.path)
                  ? `${String(args.method || 'GET').toUpperCase()} ${String(args.path || '/')}`
                  : undefined)
              const wrappedPermissionRequest = trackedPermissionHandler
                ? (permReq: CodeModePermissionRequest) =>
                    trackedPermissionHandler(
                      Object.assign({}, permReq, permReq.thought || callThought ? { thought: permReq.thought || callThought } : null)
                    )
                : undefined
              const codeKey = call.name === 'lkr_cli_extension_bridge' ? '' : String(args.code || '').trim()
              const cachedCodeMode = codeKey ? executedCodeModeByCode.get(codeKey) : undefined
              let structResult: Record<string, unknown>
              if (cachedCodeMode) {
                structResult = {
                  ...cachedCodeMode,
                  _duplicate_call_notice:
                    'NOTE: You already executed this exact run_looker_codemode snippet in the previous step and received the result above. Do NOT repeat the same discovery call — proceed immediately to the next step (query the specific fields you need or write your Data App to /workspace/apps/<name>/app.js and run python3 /workspace/bundle_app.py).',
                }
              } else {
                let codeModeOutput: string
                const prevSeq = mutSuccessSeq
                try {
                  if (call.name === 'lkr_cli_extension_bridge') {
                    const resolvedToolReq = await resolveBridgeReq(args as unknown as LkrExtensionToolRequest)
                    const bridged = await executeLkrExtensionToolRequest({
                      sdk: turnSdk, req: resolvedToolReq, defaultVars: defaultCodeModeVars, extensionSDK,
                      requirePermission, approvedOperations, onPermissionRequest: wrappedPermissionRequest,
                      conversationId: rawConversationId || conversationId,
                    })
                    resolvedBridgeCacheKeys.add(bridged.cacheKey)
                    const pErr = recordPermOutcome(bridged.result, prevSeq, resolvedToolReq)
                    if (pErr) {
                      codeModeOutput = JSON.stringify({ ok: false, error: pErr })
                    } else {
                      const compactRes = compactBridgeValue(bridged.result)
                      const noReplay = isNoReplayBridgeResult(compactRes)
                      codeModeOutput = JSON.stringify({
                        ok: true,
                        cache_key: bridged.cacheKey,
                        cache_path: `/workspace/.lkr_extension_cache/${bridged.cacheKey}.json`,
                        replay_needed: !noReplay,
                        ...(noReplay
                          ? {
                              note: 'Already executed on Looker host — skip cache_path write and CLI replay (for pre_gate.py, merge passed/queries/test_query_results into data.json without deleting sql).',
                            }
                          : {}),
                        result: compactRes,
                      })
                    }
                  } else {
                    const customVars =
                      args.vars && typeof args.vars === 'object' && !Array.isArray(args.vars)
                        ? (args.vars as Record<string, unknown>)
                        : {}
                    const rawCode = wrapKdaCodeMode(String(args.code || ''), isKdaSkillActive)
                    const needsDashboardMacros =
                      isDashboardMode ||
                      /\b(?:upsert_udd|upsert_lookml_dashboard|reflow_24col|pin_to_board|schedule_dashboard|emit_native_bundle)\b/.test(rawCode)
                    codeModeOutput = await LkrCodeMode.runPythonCode({
                      code: needsDashboardMacros ? wrapDashboardCodeMode(rawCode) : rawCode,
                      sdk: turnSdk, extensionSDK,
                      allowUpdateSession: toolMode === 'lookml' || mode === 'dashboard' || effectiveLookmlIntent,
                      requirePermission, approvedOperations, onPermissionRequest: wrappedPermissionRequest,
                      conversationId: rawConversationId || conversationId,
                      vars: { ...defaultCodeModeVars, ...customVars },
                    })
                    recordPermOutcome(codeModeOutput, prevSeq)
                  }
                } catch (err: unknown) {
                  const errMsg = err instanceof Error ? err.message : String(err)
                  if (!recordPermOutcome(errMsg, prevSeq)) apiRetries += 1
                  codeModeOutput = JSON.stringify({ ok: false, error: errMsg })
                }
                // ponytail: /v1beta/interactions requires function_result.result to be a plain JS Struct object (never a JSON string)
                try {
                  const parsed: unknown = JSON.parse(codeModeOutput)
                  structResult = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? (parsed as Record<string, unknown>)
                    : { result: parsed }
                } catch {
                  structResult = { result: codeModeOutput }
                }
                if (codeKey && structResult.ok !== false && !('error' in structResult) && !codeModeOutput.includes('PermissionError:')) {
                  executedCodeModeByCode.set(codeKey, { ...structResult })
                }
              }
              if (preBridgeDenied && !('warning' in structResult)) structResult.warning = preBridgeDenied
              if (Object.keys(preBridgePayloads).length > 0 && pendingLookerCalls[0]?.id === call.id) {
                structResult = { ...structResult, _bridged_cache_files: preBridgePayloads }
              }
              resultsInput.push({
                type: 'function_result' as const,
                name: call.name || 'run_looker_codemode',
                call_id: call.id,
                result: structResult,
              })
            }
            activeLookerCallId = ''
            codemodeExecMs += Date.now() - cmStart
            await throwIfAborted(interaction.id)
            await postContinuation(resultsInput, requiresBashSandbox ? 'remote' : undefined, resultsInput)
            continue
          }
          if (pendingLookerCalls.length > 0 && !wrapUpSent) {
            wrapUpSent = true
            await throwIfAborted(interaction.id)
            onStatus(`Max Tool Rounds (${resolvedMaxToolRounds}) reached — summarizing progress...`)
            const wrapUpResults = pendingLookerCalls.map((call: AntigravityInteractionStep) => ({
              type: 'function_result' as const, name: call.name || 'run_looker_codemode', call_id: call.id, result: { ok: false, error: wrapUpErrorText },
            }))
            await postContinuation(wrapUpResults, requiresBashSandbox ? 'remote' : undefined, wrapUpResults, [])
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
            extensionSDK, auth, interactionId: interaction.id, initialInteraction: interaction, signal,
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
              pollIdx = 0; prevStepCount = curStepCount; prevStatus = interaction.status
            }
            if (
              interaction.status !== 'in_progress' &&
              interaction.status !== 'queued' &&
              (interaction.status !== 'requires_action' ||
                (interaction.steps || []).some((s, idx, arr) => s.type === 'function_call' && !isResolvedFunctionCall(s, idx, arr)))
            ) {
              continue
            }
          }
        }
        const schedule = resolveAdaptivePollScheduleMs(pollScheduleMs, trackedEnvId, envConcurrencySlot)
        const sleepMs = schedule[Math.min(pollIdx, schedule.length - 1)]
        pollIdx += 1; pollCount += 1; pollWaitMs += sleepMs
        await throwIfAborted(interaction.id)
        if (sleepMs > 0) {
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
            const timer = setTimeout(done, sleepMs)
            signal?.addEventListener('abort', done, { once: true })
          })
        }
        await throwIfAborted(interaction.id)
        try {
          interaction = await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(interaction.id)}`, 'GET')
          transientPollErrors = 0
        } catch (pollErr: unknown) {
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr)
          if (transientPollErrors < 6 && /\b(?:500|502|503|504|429)\b|deadline_exceeded|fetch failed|network/i.test(msg)) {
            transientPollErrors += 1; apiRetries += 1
            continue
          }
          throw pollErr
        }
        await throwIfAborted(interaction.id)
        if (interaction.environment_id) trackedEnvId = interaction.environment_id
        const curStepCount = (interaction.steps || []).length
        if (curStepCount !== prevStepCount || interaction.status !== prevStatus) {
          pollIdx = 0; prevStepCount = curStepCount; prevStatus = interaction.status
        }
      }

      const mergedSnap: AntigravityInteractionPayload =
        accumulatedSteps.length > 0
          ? { ...interaction, steps: [...accumulatedSteps, ...mergeSteps(interaction.steps)] }
          : interaction
      const hasFinalBundle = Boolean(
        extractBundleFromInteraction(mergedSnap) ||
          extractNativeContentFromInteraction(mergedSnap) ||
          extractLookmlBundleFromInteraction(mergedSnap) ||
          extractAlertBundleFromInteraction(mergedSnap) ||
          extractTddFromInteraction(mergedSnap)
      )
      const hasDirectModelOutput =
        extractInteractionOutputText({ output_text: interaction.output_text, outputs: interaction.outputs }) !== 'Completed.'
      const curSteps = interaction.steps || []
      const hasUnfinishedCall = curSteps.some((s, idx) => s.type === 'function_call' && !isResolvedFunctionCall(s, idx, curSteps))

      if (
        interaction.status === 'failed' ||
        (interaction.status === 'cancelled' &&
          (Boolean(signal?.aborted) || Boolean(interaction.error) || (!hasFinalBundle && (!hasDirectModelOutput || hasUnfinishedCall))))
      ) {
        throw new Error(
          `Antigravity interaction ${interaction.status}: ${
            interaction.error?.message || JSON.stringify(interaction.error || interaction)
          }`
        )
      }
      const pendingBridgeReqs = await getPendingBridgeReqs(interaction)

      if (pendingBridgeReqs.length > 0 && actionRound + bridgeRound < resolvedMaxToolRounds) {
        await throwIfAborted(interaction.id)
        const firstBridgeThought = pendingBridgeReqs.map((r) => sanitizeActivityThought(r.thought)).find(Boolean)
        const firstBridgeReq = pendingBridgeReqs[0]
        const friendlyBridge = formatFriendlyLookerActivityLabel(
          String(firstBridgeReq?.code || ''),
          { ...defaultCodeModeVars, ...(firstBridgeReq as unknown as Record<string, unknown>) }
        )
        onStatus(firstBridgeThought || friendlyBridge.statusText)
        const bridgeStart = Date.now()
        const bridgedLines: string[] = []
        const deniedLines: string[] = []
        for (const req of pendingBridgeReqs) {
          await throwIfAborted(interaction.id)
          if (req.kind !== 'sdk_request') codemodeCalls += 1
          const prevSeq = mutSuccessSeq
          try {
            const { cacheKey, result } = await executeLkrExtensionToolRequest({
              sdk: turnSdk, req, defaultVars: defaultCodeModeVars, extensionSDK,
              requirePermission, approvedOperations, onPermissionRequest: trackedPermissionHandler,
              conversationId: rawConversationId || conversationId,
            })
            resolvedBridgeCacheKeys.add(cacheKey)
            const pErr = recordPermOutcome(result, prevSeq, req)
            if (pErr) deniedLines.push(pErr)
            else {
              bridgedLines.push(
                isNoReplayBridgeResult(result)
                  ? `[NO_REPLAY: ${cacheKey} already executed on Looker host — skip cache write and CLI replay]\n${encodeBridgePayload(result)}`
                  : `/workspace/.lkr_extension_cache/${cacheKey}.json\n${encodeBridgePayload(result)}`
              )
            }
          } catch (err: unknown) {
            const cacheKey = req.cache_key || computeLkrExtensionCacheKey(req)
            resolvedBridgeCacheKeys.add(cacheKey)
            const errMsg = err instanceof Error ? err.message : String(err)
            const pErr = recordPermOutcome(errMsg, prevSeq)
            if (pErr) deniedLines.push(pErr)
            else {
              apiRetries += 1
              bridgedLines.push(`/workspace/.lkr_extension_cache/${cacheKey}.json\n\`\`\`json\n${JSON.stringify({ ok: false, error: errMsg })}\n\`\`\``)
            }
          }
        }
        codemodeExecMs += Date.now() - bridgeStart
        await throwIfAborted(interaction.id)

        if (!hasFinalBundle) {
          bridgeRound += 1
          const seedParts = ['[LKR_EXTENSION_BRIDGE_RESULT] Executed online lkr-dev-cli request(s) in the host Looker Extension.']
          if (bridgedLines.length > 0) {
            seedParts.push(
              'Write the resolved JSON payload(s) below to /workspace/.lkr_extension_cache/ and re-run your sandbox command so it hits the local cache and completes:',
              ...bridgedLines
            )
          }
          if (deniedLines.length > 0) {
            seedParts.push(
              `Safe Mode denied Looker mutation(s) (do NOT write to /workspace/.lkr_extension_cache/ and stop without retrying):\n${deniedLines.join('\n')}`
            )
          }
          await postContinuation([{ type: 'text', text: seedParts.join('\n\n') }], 'remote')
          continue
        }
      } else if (pendingBridgeReqs.length > 0 && !hasFinalBundle && !wrapUpSent) {
        wrapUpSent = true
        pendingBridgeReqs.forEach((r) => resolvedBridgeCacheKeys.add(r.cache_key || computeLkrExtensionCacheKey(r)))
        await throwIfAborted(interaction.id)
        onStatus(`Max Tool Rounds (${resolvedMaxToolRounds}) reached — summarizing progress...`)
        await postContinuation([{ type: 'text', text: wrapUpErrorText }], 'remote', [], [])
        continue
      }

      const maxIncompleteRounds =
        /(?:^|\s)\/agentic-lookml-workflow(?=\s|$)/i.test(userPrompt) ||
        (activatedLookmlSkills || []).includes('agentic-lookml-workflow')
          ? 8
          : 2

      const requiresDataAppBundle = isDataAppBundleTurn()
      const attemptedBundleApp =
        (mode === 'data_app' || isDataInvestigatorTurn) &&
        !isNoOpTurn &&
        [...accumulatedSteps, ...(interaction.steps || [])].some((s) => JSON.stringify(s).includes('bundle_app.py'))

      if (
        !usedDirectStatelessModel &&
        Boolean(interaction.id) &&
        !hasFinalBundle &&
        !bridgePermissionError &&
        incompleteRound < maxIncompleteRounds &&
        ((interaction.status === 'incomplete' && !hasDirectModelOutput) ||
          (interaction.status === 'completed' && attemptedBundleApp) ||
          (requiresDataAppBundle && !wrapUpSent))
      ) {
        incompleteRound += 1
        await throwIfAborted(interaction.id)
        onStatus('Resuming incomplete turn...')
        const resumeText =
          interaction.status === 'completed' && attemptedBundleApp
            ? `Your previous bundle_app.py run failed validation and did not emit <DATA_APP_BUNDLE>. Fix the reported error in your app.js (remember createTextCol/createNumericCol/createCurrencyCol/createPercentageCol/createBadgeCol take a single options object { field, headerName }) and re-run python3 /workspace/bundle_app.py --app-dir ${appDir} --stdin "<App Title>" until it exits 0.`
            : requiresDataAppBundle
            ? 'You have not emitted <DATA_APP_BUNDLE> yet. Write the complete self-contained Lit Data App to /workspace/apps/<app-name>/app.js (remember createTextCol/createNumericCol/createCurrencyCol/createPercentageCol/createBadgeCol take a single options object { field, headerName }) and run python3 /workspace/bundle_app.py --app-dir /workspace/apps/<app-name> --stdin "<App Title>" in bash until it exits 0 and emits <DATA_APP_BUNDLE>.'
            : 'Continue and complete the current request.'
        await postContinuation([{ type: 'text', text: resumeText }], requiresBashSandbox ? 'remote' : undefined, [], wrapUpSent ? [] : undefined)
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
      steps: [...accumulatedSteps, ...mergeSteps(interaction.steps)],
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

  return {
    interaction,
    trackedEnvId,
    activitySteps,
    bridgePermissionError,
    isDataAppBundleTurn,
    pollWaitMs,
    pollCount,
    codemodeExecMs,
    lookerHttpMs,
    codemodeCalls,
    lookerHttpCalls,
    apiRetries,
  }
}
