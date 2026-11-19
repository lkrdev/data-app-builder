import type { Looker40SDK } from '@looker/sdk'

import { callInteractionsApi } from './antigravityAuth'
import {
  extractAlertBundleFromInteraction,
  extractBundleFromInteraction,
  extractInteractionActivitySteps,
  extractInteractionOutputText,
  extractNativeContentFromInteraction,
  extractRawUserPromptFromInteraction,
  extractTddFromInteraction,
  isFreshUserTurnRoot,
} from './antigravitySteps'
import {
  type AntigravityActivityStep,
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  type AntigravityInteractionStep,
  cleanLookmlProjectId,
  isEnvironmentNotFoundError,
  normalizeEnvironmentId,
  stripControlTags,
} from './antigravityTypes'
import type { ChatTurnMessage } from './dataAppPublisher'
import { getArtifactNamespace, loadUserConversations } from './lookerArtifacts'
import {
  clearUserEnvironmentId,
  pruneUserConversations,
} from './lookerArtifactService'
import {
  deleteSessionConversationMessages,
  getSessionConversationMessages,
  hydrateConversationContentItems,
  normalizeStudioContentItem,
  normalizeTurnInteractionIds,
  setSessionConversationMessages,
  type StudioContentItemType,
  toTurnCrudItem,
  type TurnCrudItem,
  type UserConversationEntry,
} from './lookerArtifactTypes'
import { extractLookmlBundleFromInteraction } from './lookmlArtifactHydration'

export {
  clearSessionConversationMessages,
  deleteSessionConversationMessages,
  getSessionConversationMessages,
  setSessionConversationMessages,
} from './lookerArtifactTypes'

function isPureCaConversationPointer(conv: UserConversationEntry, targetDeadEnvId?: string): boolean {
  const caId = String(conv.caConversationId || conv.content?.caConversationId || '').trim()
  if (!caId) return false
  const hasSandboxTurns = Boolean(
    (conv.turnInteractionIds && conv.turnInteractionIds.length > 0) || String(conv.interactionId || '').trim()
  )
  if (!hasSandboxTurns) return true
  const normDead = normalizeEnvironmentId(targetDeadEnvId)
  const convEnv = normalizeEnvironmentId(conv.environmentId)
  return Boolean(normDead && (!convEnv || convEnv !== normDead))
}

export function synthesizeCaConversationMessages(conv: UserConversationEntry): ChatTurnMessage[] {
  const caId = String(conv.caConversationId || conv.content?.caConversationId || '').trim()
  const question = String(conv.content?.initialQuestion || conv.label || '').trim()
  const agentLabel = String(conv.content?.agentName || conv.content?.agentId || caId || 'Conversational Analytics').trim()
  const rationale = String(conv.content?.routingRationale || '').trim()
  const out: ChatTurnMessage[] = []
  if (question) out.push({ role: 'user', text: question })
  const summary = rationale
    ? `Routed to Looker Conversational Analytics agent **${agentLabel}** — ${rationale}`
    : `Opened Looker Conversational Analytics agent **${agentLabel}**.`
  out.push({ role: 'assistant', text: summary })
  return out
}

function buildHydratedAssistantMessage(
  rootInter: AntigravityInteractionPayload | undefined,
  finalInter: AntigravityInteractionPayload | undefined,
  finalId: string,
  prevFinalId: string | undefined,
  conv: UserConversationEntry,
  isLastTurn = true
): ChatTurnMessage {
  const rawOut = extractInteractionOutputText(finalInter)
  const cleaned = rawOut === 'Completed.' && !finalInter?.output_text && !finalInter?.outputs?.length && !finalInter?.steps?.length
    ? ''
    : stripControlTags(rawOut)
  const bundle = extractBundleFromInteraction(finalInter)
  const nativeBundle = extractNativeContentFromInteraction(finalInter)
  const lookmlBundle = extractLookmlBundleFromInteraction(finalInter)
  const alertBundle = extractAlertBundleFromInteraction(finalInter)
  const tddMd = extractTddFromInteraction(finalInter)
  const isOneOrTwoHop = Boolean(
    !rootInter ||
      rootInter === finalInter ||
      (rootInter.id && finalInter?.previous_interaction_id === rootInter.id)
  )
  let activitySteps: AntigravityActivityStep[] = []
  if (isOneOrTwoHop) {
    if (rootInter && finalInter && rootInter !== finalInter) {
      const mergedRaw: AntigravityInteractionStep[] = (rootInter.steps || []).slice()
      if (Array.isArray(finalInter.input)) {
        finalInter.input.forEach((it) => {
          if (
            it &&
            typeof it === 'object' &&
            (it as { type?: string }).type === 'function_result' &&
            !(finalInter.steps?.[0]?.type === 'function_result' && finalInter.steps[0].call_id === (it as { call_id?: string }).call_id)
          ) {
            mergedRaw.push(it as AntigravityInteractionStep)
          }
        })
      }
      if (Array.isArray(finalInter.steps)) mergedRaw.push(...finalInter.steps)
      activitySteps = extractInteractionActivitySteps(Object.assign({}, finalInter, { steps: mergedRaw }))
    } else {
      activitySteps = finalInter ? extractInteractionActivitySteps(finalInter) : []
    }
  }

  let text =
    cleaned ||
    (bundle ? `Built "${bundle.title}".`
      : nativeBundle ? `Built "${nativeBundle.title}".`
      : lookmlBundle ? `Updated LookML "${lookmlBundle.title}".`
      : alertBundle ? `Configured Looker alert "${alertBundle.custom_title || alertBundle.title || alertBundle.alert_id}".`
      : tddMd ? 'Synthesized 7-section Technical Design Document (TECHNICAL_DESIGN_DOCUMENT.md).'
      : 'Completed.')

  const lookmlPid = cleanLookmlProjectId(lookmlBundle?.project_id)
  if (lookmlPid && !/\/projects\/[^/\s)]+/i.test(text)) {
    text = `${text}\n\n[Open ${lookmlPid} in Looker IDE](/projects/${encodeURIComponent(lookmlPid)})`
  }
  const dashId =
    bundle && conv.content?.dashboardId
      ? String(conv.content.dashboardId)
      : nativeBundle && (nativeBundle.content_type === 'dashboard' || nativeBundle.contentType === 'dashboard' || !nativeBundle.content_type)
      ? String(nativeBundle.id || '')
      : undefined
  if (dashId && !/\/(?:embed\/)?dashboards\/[^/\s)]+/i.test(text)) {
    const dashTitle = bundle?.title || nativeBundle?.title || `Dashboard #${dashId}`
    text = `${text}\n\n**Looker Dashboard:** [Open ${dashTitle}](/dashboards/${encodeURIComponent(dashId)})`
  }

  const crudItems: TurnCrudItem[] = []
  if (bundle && conv.content?.dashboardId) {
    const bDashId = String(conv.content.dashboardId).trim()
    const ct: StudioContentItemType = conv.type === 'data-investigator' || conv.type === 'data_investigator' ? 'data-investigator' : 'data_app'
    crudItems.push(toTurnCrudItem(normalizeStudioContentItem({ id: bDashId, contentType: ct, title: bundle.title, dashboardId: bDashId, source: 'created' }), 'created'))
  }
  if (nativeBundle && nativeBundle.id) {
    const rawCt = nativeBundle.content_type || nativeBundle.contentType || 'dashboard'
    const ct: StudioContentItemType = rawCt === 'look' ? 'look' : rawCt === 'board' ? 'board' : rawCt === 'lookml_dashboard' ? 'lookml_dashboard' : 'dashboard'
    crudItems.push(toTurnCrudItem(normalizeStudioContentItem({ id: String(nativeBundle.id), contentType: ct, title: nativeBundle.title, embedPath: nativeBundle.embed_path || nativeBundle.url, source: 'created' }), 'created'))
  }
  if (lookmlPid) {
    crudItems.push(toTurnCrudItem(normalizeStudioContentItem({ id: lookmlPid, contentType: 'lookml', projectId: lookmlPid, title: lookmlBundle?.title || `LookML: ${lookmlPid}`, source: 'modified' }), 'updated'))
  }
  if (alertBundle && alertBundle.alert_id) {
    const aid = String(alertBundle.alert_id)
    crudItems.push(toTurnCrudItem(normalizeStudioContentItem({ id: aid, contentType: 'alert', alertId: aid, title: alertBundle.custom_title || alertBundle.title || `Alert #${aid}`, source: 'modified' }), 'updated'))
  }
  if (isLastTurn && crudItems.length === 0) {
    hydrateConversationContentItems(conv)
      .filter((it) => !it.hidden && it.source !== 'mention')
      .forEach((it) => crudItems.push(toTurnCrudItem(it, it.source === 'modified' ? 'updated' : 'created')))
  }

  return Object.assign(
    { role: 'assistant' as const, text, interactionId: finalId },
    prevFinalId ? { stopAtInteractionId: prevFinalId } : null,
    dashId ? { dashboardId: dashId } : null,
    bundle?.widgets?.length ? { widgetCount: bundle.widgets.length } : null,
    crudItems.length > 0 ? { crudItems } : null,
    activitySteps.length > 0 ? { activitySteps } : null
  )
}

export async function pruneDeadEnvironmentConversations(params: {
  sdk?: Looker40SDK
  extensionSDK?: AntigravityExtensionHostLike
  userId?: string
  namespace?: string
  deadEnvironmentId?: string
  activeEnvironmentId?: string
  excludeConversationId?: string
  conversations?: ReadonlyArray<UserConversationEntry>
}): Promise<string[]> {
  const { sdk, extensionSDK, userId, deadEnvironmentId, activeEnvironmentId } = params
  const ns = params.namespace || getArtifactNamespace(extensionSDK)
  const normDead = normalizeEnvironmentId(deadEnvironmentId)
  const normActive = normalizeEnvironmentId(activeEnvironmentId)
  const excludeId = String(params.excludeConversationId || '').trim()
  if (!normDead && !normActive) return []

  const sourceConvs =
    params.conversations ||
    (sdk && userId ? await loadUserConversations(sdk, userId, ns).catch(() => [] as UserConversationEntry[]) : [])

  const idsToPrune = sourceConvs
    .filter((c) => {
      if (excludeId && c.id === excludeId) return false
      const cEnv = normalizeEnvironmentId(c.environmentId)
      if (!cEnv) return false
      if (isPureCaConversationPointer(c, normDead)) return false
      if (normDead) return cEnv === normDead
      return Boolean(normActive && cEnv !== normActive)
    })
    .map((c) => c.id)

  idsToPrune.forEach((id) => deleteSessionConversationMessages(id))
  if (sdk && userId) {
    if (idsToPrune.length > 0) {
      await pruneUserConversations(sdk, userId, idsToPrune, ns).catch(() => {})
    }
    if (normDead && (!normActive || normDead === normActive)) {
      await clearUserEnvironmentId(sdk, userId, ns).catch(() => {})
    }
  }
  return idsToPrune
}

export interface HydrateRemoteConversationParams {
  extensionSDK?: AntigravityExtensionHostLike
  auth: AntigravityAuth
  sdk?: Looker40SDK
  userId?: string
  namespace?: string
  conv: UserConversationEntry
  activeEnvironmentId?: string | null
  bypassSessionCache?: boolean
}

export interface HydrateRemoteConversationResult {
  expired: boolean
  messages: ChatTurnMessage[]
  prunedIds: string[]
  deadEnvironmentId?: string
  resolvedEnvironmentId?: string
}

export async function hydrateRemoteConversationMessages(
  params: HydrateRemoteConversationParams
): Promise<HydrateRemoteConversationResult> {
  const { extensionSDK, auth, sdk, userId, conv, activeEnvironmentId, bypassSessionCache = false } = params
  const ns = params.namespace || getArtifactNamespace(extensionSDK)
  const convEnvId = normalizeEnvironmentId(conv.environmentId)
  const activeEnvId = normalizeEnvironmentId(activeEnvironmentId)
  const pairs = normalizeTurnInteractionIds(conv.turnInteractionIds) || []
  const singleId = String(conv.interactionId || '').trim()
  const hasTurnPointers = pairs.length > 0 || Boolean(singleId)

  if (activeEnvId && convEnvId && convEnvId !== activeEnvId && !isPureCaConversationPointer(conv)) {
    deleteSessionConversationMessages(conv.id)
    const prunedConvIds = sdk && userId
      ? await pruneDeadEnvironmentConversations({ sdk, extensionSDK, userId, namespace: ns, activeEnvironmentId: activeEnvId })
      : [conv.id]
    const mergedPruned = prunedConvIds.includes(conv.id) ? prunedConvIds : [conv.id].concat(prunedConvIds)
    if (sdk && userId && !prunedConvIds.includes(conv.id)) {
      await pruneUserConversations(sdk, userId, [conv.id], ns).catch(() => {})
    }
    return { expired: true, messages: [], prunedIds: mergedPruned, deadEnvironmentId: convEnvId }
  }

  if (!bypassSessionCache) {
    const cached = getSessionConversationMessages(conv.id)
    if (cached && cached.length > 0) {
      return { expired: false, messages: cached, prunedIds: [], resolvedEnvironmentId: convEnvId || activeEnvId }
    }
  }

  if (!hasTurnPointers && (conv.caConversationId || conv.content?.caConversationId || conv.type === 'conversational-analytics')) {
    const caMsgs = synthesizeCaConversationMessages(conv)
    setSessionConversationMessages(conv.id, caMsgs)
    return { expired: false, messages: caMsgs, prunedIds: [], resolvedEnvironmentId: convEnvId || activeEnvId }
  }

  if (!hasTurnPointers) {
    return { expired: false, messages: [], prunedIds: [], resolvedEnvironmentId: convEnvId || activeEnvId }
  }

  const canFetch = Boolean(
    (typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__) ||
      (auth &&
        (auth.mode === 'apikey'
          ? Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)
          : Boolean((auth.getOAuthToken?.() || auth.oauthToken || '').trim())))
  )
  if (!canFetch) {
    return { expired: false, messages: [], prunedIds: [], resolvedEnvironmentId: convEnvId || activeEnvId }
  }

  const onDeadEnvironment = async (deadEnvCandidate?: string): Promise<HydrateRemoteConversationResult> => {
    const deadEnv = normalizeEnvironmentId(deadEnvCandidate) || convEnvId
    deleteSessionConversationMessages(conv.id)
    const prunedIds = deadEnv
      ? await pruneDeadEnvironmentConversations({
          sdk,
          extensionSDK,
          userId,
          namespace: ns,
          deadEnvironmentId: deadEnv,
          activeEnvironmentId: activeEnvId,
        })
      : []
    if (sdk && userId && !prunedIds.includes(conv.id) && !isPureCaConversationPointer(conv, deadEnv)) {
      await pruneUserConversations(sdk, userId, [conv.id], ns).catch(() => {})
      prunedIds.push(conv.id)
    }
    return { expired: true, messages: [], prunedIds, deadEnvironmentId: deadEnv || undefined }
  }

  if (pairs.length > 0) {
    const uniqueIds = Array.from(new Set(pairs.flatMap(([r, f]) => [r, f]).filter(Boolean)))
    let fetchedEntries: ReadonlyArray<readonly [string, AntigravityInteractionPayload]>
    try {
      fetchedEntries = await Promise.all(
        uniqueIds.map((id) =>
          callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(id)}`, 'GET').then(
            (inter) => [id, inter] as const
          )
        )
      )
    } catch (err) {
      if (isEnvironmentNotFoundError(err)) return onDeadEnvironment(convEnvId)
      throw err
    }

    const byId = new Map<string, AntigravityInteractionPayload>(fetchedEntries)
    let resolvedEnvironmentId = convEnvId || activeEnvId
    fetchedEntries.forEach(([, inter]) => {
      const eId = normalizeEnvironmentId(inter.environment_id)
      if (eId) resolvedEnvironmentId = eId
    })
    if (activeEnvId && resolvedEnvironmentId && resolvedEnvironmentId !== activeEnvId && !isPureCaConversationPointer(conv)) {
      return onDeadEnvironment(resolvedEnvironmentId)
    }

    const messages: ChatTurnMessage[] = []
    pairs.forEach(([rootId, finalId], idx) => {
      const rootInter = byId.get(rootId)
      const finalInter = byId.get(finalId) || rootInter
      const userPrompt = extractRawUserPromptFromInteraction(rootInter) || (idx === 0 ? String(conv.label || '').trim() : '')
      if (userPrompt) messages.push({ role: 'user', text: userPrompt })
      const st = String(finalInter?.status || 'completed')
      const stillRunning = Boolean(
        conv.inFlight && idx === pairs.length - 1 && (st === 'in_progress' || st === 'queued' || st === 'processing' || st === 'requires_action')
      )
      if (!stillRunning) {
        const prevFinalId = idx > 0 ? pairs[idx - 1][1] : undefined
        messages.push(buildHydratedAssistantMessage(rootInter, finalInter, finalId, prevFinalId, conv, idx === pairs.length - 1))
      }
    })
    setSessionConversationMessages(conv.id, messages)
    return { expired: false, messages, prunedIds: [], resolvedEnvironmentId }
  }

  // Legacy single-interactionId fallback: walk previous_interaction_id grouped via isFreshUserTurnRoot
  const chainNewestFirst: AntigravityInteractionPayload[] = []
  const seen = new Set<string>()
  let currId = singleId
  try {
    while (currId && !seen.has(currId) && seen.size < 60) {
      seen.add(currId)
      const inter = await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(currId)}`, 'GET')
      if (JSON.stringify(inter.input ?? '').includes('[PREWARM:')) break
      chainNewestFirst.push(Object.assign({}, inter, { id: inter.id || currId }))
      currId = typeof inter.previous_interaction_id === 'string' ? inter.previous_interaction_id.trim() : ''
    }
  } catch (err) {
    if (isEnvironmentNotFoundError(err)) return onDeadEnvironment(convEnvId)
    if (chainNewestFirst.length === 0) {
      if (conv.caConversationId || conv.content?.caConversationId) {
        const caMsgs = synthesizeCaConversationMessages(conv)
        setSessionConversationMessages(conv.id, caMsgs)
        return { expired: false, messages: caMsgs, prunedIds: [], resolvedEnvironmentId: convEnvId || activeEnvId }
      }
      throw err
    }
  }

  const chronological = chainNewestFirst.slice().reverse()
  const turns: Array<{ root: AntigravityInteractionPayload; final: AntigravityInteractionPayload }> = []
  chronological.forEach((inter) => {
    if (turns.length === 0 || isFreshUserTurnRoot(inter)) {
      turns.push({ root: inter, final: inter })
    } else {
      turns[turns.length - 1].final = inter
    }
  })

  const messages: ChatTurnMessage[] = []
  let resolvedEnvironmentId = convEnvId || activeEnvId
  turns.forEach((t, idx) => {
    const eId = normalizeEnvironmentId(t.final.environment_id || t.root.environment_id)
    if (eId) resolvedEnvironmentId = eId
    const userPrompt = extractRawUserPromptFromInteraction(t.root) || (idx === 0 ? String(conv.label || '').trim() : '')
    if (userPrompt) messages.push({ role: 'user', text: userPrompt })
    const st = String(t.final.status || 'completed')
    const stillRunning = Boolean(
      conv.inFlight && idx === turns.length - 1 && (st === 'in_progress' || st === 'queued' || st === 'processing' || st === 'requires_action')
    )
    if (!stillRunning) {
      const prevFinalId = idx > 0 ? String(turns[idx - 1].final.id || '') || undefined : undefined
      messages.push(buildHydratedAssistantMessage(t.root, t.final, String(t.final.id || singleId), prevFinalId, conv, idx === turns.length - 1))
    }
  })
  if (activeEnvId && resolvedEnvironmentId && resolvedEnvironmentId !== activeEnvId && !isPureCaConversationPointer(conv)) {
    return onDeadEnvironment(resolvedEnvironmentId)
  }
  setSessionConversationMessages(conv.id, messages)
  return { expired: false, messages, prunedIds: [], resolvedEnvironmentId }
}
