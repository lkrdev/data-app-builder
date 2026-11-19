import { useCallback, useRef, useState } from 'react'

import type { ExtensionSDK } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AntigravityActivityStep, AntigravityAuth, AntigravityTurnResult, cleanLookmlProjectId,
  CodeModePermissionDecision, CodeModePermissionRequest, getSessionConversationMessages,
  hydrateRemoteConversationMessages, recoverInFlightInteraction, runAntigravityTurn,
  sanitizeConversationLabel, setSessionConversationMessages,
} from './antigravity'
import type { ChatMessage } from './components/App'
import {
  addInFlightConvId, type AlertInspectorBundle, buildDenseExploreSchema, clearInFlightConvId,
  extractExploreIdsFromCode, extractResolvedUseCase, formatExploreId, getArtifactNamespace,
  hydrateConversationContentItems, hydrateMentionedContext, mergeTurnInteractionIds, NativeContentState,
  normalizeConversationTags, parseExploreId, PublishedAppState, removeInFlightConvId, ResolvedStudioUseCase,
  saveAlertArtifact, saveNativeContentArtifact, saveUserConversation, StudioContentItem,
  StudioContentItemType, StudioContextMention, studioModeToUseCase, StudioUseCase,
  toTurnCrudItem, TurnCrudItem, upsertPublishedDataApp, upsertStudioContentItem, UserConversationEntry,
} from './lookerApi'
import {
  extractLookmlDashboardsFromBundle, LookmlBundle, mergeLookmlFiles,
  resolveLookmlCanonicalProjectId, saveLookmlSessionArtifact,
} from './lookmlTool'
import type { QueuedPromptItem } from './studioControllerAuth'

let lastGeneratedConvMs = 0
export function nextStudioConvId(): string {
  const now = Date.now()
  lastGeneratedConvMs = now > lastGeneratedConvMs ? now : lastGeneratedConvMs + 1
  return `conv_${lastGeneratedConvMs}`
}

export interface PendingPermEntry {
  req: CodeModePermissionRequest; resolve: (decision: CodeModePermissionDecision) => void
  approvedSet?: Set<string>; convId?: string; signal?: AbortSignal; epoch?: number
}

export interface TurnSnapshotState {
  selectedExplores: string[]; selectedFolderId: string; currentAppCode: string
  nativeContent: NativeContentState | null; publishedApp: PublishedAppState | null
  lookmlProjectId: string; lookmlBundle: LookmlBundle | null; alertBundle: AlertInspectorBundle | null
  scriptCode: string; scriptId: string; scriptTitle: string; filtersJson: string
  publishedTileDash: { dashboardId: string; elementId: string } | null
  contentItems: StudioContentItem[]; activeContentTabKey: string; messagesWithUser: ChatMessage[]
}

export interface InFlightTurnEntry {
  convId: string; busyStatus: string | null; liveActivitySteps: AntigravityActivityStep[]
  abortController: AbortController; approvedOps: Set<string>; permEpoch: number
  pendingPermQueue: PendingPermEntry[]; queuedPrompts: QueuedPromptItem[]; snapshot: TurnSnapshotState
}

export interface BackgroundPendingPermNotice {
  convId: string; convLabel?: string; req: CodeModePermissionRequest
}

export function upsertLocalTurnContentItem(
  state: { items: StudioContentItem[]; activeKey: string },
  rawItem: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType },
  activate = true
): StudioContentItem & { existed: boolean } {
  const res = upsertStudioContentItem(state.items, rawItem)
  state.items = res.items
  if (activate || !state.activeKey) state.activeKey = res.activeKey
  return Object.assign({}, res.item, { existed: res.existed })
}

export async function prepareTurnMentionsAndContext(opts: {
  effectivePrompt: string; mentionsToHydrate: StudioContextMention[]; resumeConv?: UserConversationEntry
  core40SDK: Looker40SDK; extensionSDK?: Partial<ExtensionSDK>; auth?: AntigravityAuth; userId?: string; activeEnvironmentId?: string
  conversations: UserConversationEntry[]; snapExplores: string[]
  turnTargetUseCase: StudioUseCase; initialSchemaMarkdown: string
  onMentionItem: (raw: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType }) => void
  onHydratingStatus: () => void
}): Promise<{
  explores: string[]; schemaMarkdown: string; exploresChanged: boolean
  extraSources?: Array<{ type: 'inline'; content: string; target: string }>; promptWithContext: string
}> {
  const { effectivePrompt, mentionsToHydrate, resumeConv, core40SDK, extensionSDK, auth, userId, activeEnvironmentId, conversations, snapExplores, turnTargetUseCase, initialSchemaMarkdown, onMentionItem, onHydratingStatus } = opts
  if (resumeConv || mentionsToHydrate.length === 0) {
    return { explores: snapExplores, schemaMarkdown: initialSchemaMarkdown, exploresChanged: false, promptWithContext: effectivePrompt }
  }
  mentionsToHydrate.forEach((m) => {
    if (m.type === 'explore' || m.type === 'dashboard' || m.type === 'look') {
      const ct: StudioContentItemType = m.type === 'explore' ? 'explore' : m.type === 'look' ? 'look' : m.id.includes('::') ? 'lookml_dashboard' : 'dashboard'
      onMentionItem(Object.assign(
        { id: m.id, contentType: ct, title: m.title, source: 'mention' as const, createdInConversation: false },
        ct === 'explore' ? { exploreId: m.id } : ct === 'look' ? { lookId: m.id } : ct === 'dashboard' ? { dashboardId: m.id } : { lookmlDashboardId: m.id }
      ))
    }
  })
  onHydratingStatus()
  const hydrated = await hydrateMentionedContext({ sdk: core40SDK, extensionSDK, auth, userId, activeEnvironmentId, mentions: mentionsToHydrate, conversations, selectedExplores: snapExplores, useCase: turnTargetUseCase })
  let explores = snapExplores, schemaMarkdown = initialSchemaMarkdown, exploresChanged = false
  if (hydrated.explores.length > 0) {
    explores = hydrated.explores
    if (JSON.stringify(explores) !== JSON.stringify(snapExplores)) {
      exploresChanged = true
      const sections = await Promise.all(explores.map(async (id) => {
        const parsed = parseExploreId(id)
        if (!parsed) return ''
        try { return await buildDenseExploreSchema(core40SDK, parsed.modelName, parsed.exploreName) } catch { return '' }
      }))
      const joined = sections.filter(Boolean).join('\n\n---\n\n')
      if (joined) schemaMarkdown = joined
    }
  }
  return {
    explores, schemaMarkdown, exploresChanged,
    extraSources: hydrated.extraSources.length > 0 ? hydrated.extraSources : undefined,
    promptWithContext: hydrated.promptSummary ? `${effectivePrompt}\n\n${hydrated.promptSummary}` : effectivePrompt,
  }
}

export interface UseStudioTurnConcurrencyParams {
  mockExt?: Record<string, unknown>
  activeConversationId: string
  activeConversationIdRef: React.MutableRefObject<string>
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
}

export function useStudioTurnConcurrency(opts: UseStudioTurnConcurrencyParams) {
  const { mockExt, activeConversationId, activeConversationIdRef, setMessages } = opts
  const inFlightTurnsRef = useRef<Map<string, InFlightTurnEntry>>(new Map())
  const permEpochByConvIdRef = useRef<Record<string, number>>({})
  const permQueueByConvIdRef = useRef<Record<string, Promise<unknown>>>({})
  const queuedPromptsByConvIdRef = useRef<Record<string, QueuedPromptItem[]>>({})
  const convLabelsRef = useRef<Record<string, string>>({})
  const turnResumerRef = useRef<((conv: UserConversationEntry) => Promise<void>) | null>(null)
  const onTurnAbortedRef = useRef<((convId: string, reasonText?: string, partialSteps?: AntigravityActivityStep[]) => void) | null>(null)

  const [nonTurnBusyStatus, setNonTurnBusyStatus] = useState<string | null>(() => (mockExt?.initialBusyStatus as string) || null)
  const nonTurnBusyRef = useRef<string | null>(nonTurnBusyStatus)
  nonTurnBusyRef.current = nonTurnBusyStatus
  const nonTurnBusyOwnerRef = useRef<string>('')

  const [nonTurnLiveSteps, setNonTurnLiveSteps] = useState<AntigravityActivityStep[]>(() =>
    Array.isArray(mockExt?.initialLiveActivitySteps) ? (mockExt.initialLiveActivitySteps as AntigravityActivityStep[]) : []
  )
  const [standalonePendingPerm, setStandalonePendingPerm] = useState<PendingPermEntry | null>(() =>
    mockExt?.initialPendingPerm ? { req: mockExt.initialPendingPerm as CodeModePermissionRequest, resolve: () => {} } : null
  )
  const standalonePendingPermRef = useRef<PendingPermEntry | null>(standalonePendingPerm)
  standalonePendingPermRef.current = standalonePendingPerm

  const [requirePermission, setRequirePermissionState] = useState(true)
  const requirePermissionRef = useRef(requirePermission)
  requirePermissionRef.current = requirePermission
  const approvedOpsRef = useRef<Set<string>>(new Set())
  const permEpochRef = useRef(0)

  const [, bumpRegistryVersion] = useState(0)
  const refreshTurnRegistry = useCallback(() => bumpRegistryVersion((v) => v + 1), [])

  const activeTurn = inFlightTurnsRef.current.get(activeConversationId)
  const busyStatus = activeTurn ? activeTurn.busyStatus : nonTurnBusyStatus
  const liveActivitySteps = activeTurn ? activeTurn.liveActivitySteps : nonTurnLiveSteps
  const liveActivityStepsRef = useRef<AntigravityActivityStep[]>(liveActivitySteps)
  liveActivityStepsRef.current = liveActivitySteps

  const pendingPerm = activeTurn?.pendingPermQueue[0] || standalonePendingPerm
  const pendingPermRef = useRef<PendingPermEntry | null>(pendingPerm)
  pendingPermRef.current = pendingPerm

  const queuedPrompts = queuedPromptsByConvIdRef.current[activeConversationId] || []
  const queuedPromptsRef = useRef<QueuedPromptItem[]>(queuedPrompts)
  queuedPromptsRef.current = queuedPrompts

  const runningConvIds: string[] = []
  const pendingPermConvIds: string[] = []
  let backgroundPendingPerm: BackgroundPendingPermNotice | null = null
  inFlightTurnsRef.current.forEach((entry, cid) => {
    runningConvIds.push(cid)
    if (entry.pendingPermQueue.length > 0) {
      pendingPermConvIds.push(cid)
      if (cid !== activeConversationId && !backgroundPendingPerm) {
        backgroundPendingPerm = { convId: cid, convLabel: convLabelsRef.current[cid], req: entry.pendingPermQueue[0].req }
      }
    }
  })

  const setBusyStatus = useCallback((next: React.SetStateAction<string | null>) => {
    const fgId = activeConversationIdRef.current
    const fgTurn = inFlightTurnsRef.current.get(fgId)
    if (fgTurn && typeof next !== 'function') {
      fgTurn.busyStatus = next
      refreshTurnRegistry()
      return
    }
    setNonTurnBusyStatus((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      nonTurnBusyRef.current = resolved
      nonTurnBusyOwnerRef.current = resolved ? fgId : ''
      return resolved
    })
  }, [activeConversationIdRef, refreshTurnRegistry])

  const setLiveActivitySteps = useCallback((next: AntigravityActivityStep[]) => {
    liveActivityStepsRef.current = next
    const fgTurn = inFlightTurnsRef.current.get(activeConversationIdRef.current)
    if (fgTurn) {
      fgTurn.liveActivitySteps = next
      refreshTurnRegistry()
    } else {
      setNonTurnLiveSteps(next)
    }
  }, [activeConversationIdRef, refreshTurnRegistry])

  const setConvBusyStatus = useCallback((convId: string, status: string | null) => {
    const entry = inFlightTurnsRef.current.get(convId)
    if (entry) {
      entry.busyStatus = status
      refreshTurnRegistry()
    } else if (activeConversationIdRef.current === convId) {
      nonTurnBusyRef.current = status
      nonTurnBusyOwnerRef.current = status ? convId : ''
      setNonTurnBusyStatus(status)
    }
  }, [activeConversationIdRef, refreshTurnRegistry])

  const setConvLiveSteps = useCallback((convId: string, steps: AntigravityActivityStep[]) => {
    const entry = inFlightTurnsRef.current.get(convId)
    if (entry) {
      entry.liveActivitySteps = steps
      if (activeConversationIdRef.current === convId) liveActivityStepsRef.current = steps
      refreshTurnRegistry()
    } else if (activeConversationIdRef.current === convId) {
      liveActivityStepsRef.current = steps
      setNonTurnLiveSteps(steps)
    }
  }, [activeConversationIdRef, refreshTurnRegistry])

  const updateQueuedPromptsForConv = useCallback((convId: string, updater: QueuedPromptItem[] | ((prev: QueuedPromptItem[]) => QueuedPromptItem[])) => {
    const cid = convId || activeConversationIdRef.current
    const next = typeof updater === 'function' ? updater(queuedPromptsByConvIdRef.current[cid] || []) : updater
    queuedPromptsByConvIdRef.current[cid] = next
    const entry = inFlightTurnsRef.current.get(cid)
    if (entry) entry.queuedPrompts = next
    if (cid === activeConversationIdRef.current) queuedPromptsRef.current = next
    refreshTurnRegistry()
  }, [activeConversationIdRef, refreshTurnRegistry])

  const updateQueuedPrompts = useCallback(
    (updater: QueuedPromptItem[] | ((prev: QueuedPromptItem[]) => QueuedPromptItem[])) => updateQueuedPromptsForConv(activeConversationIdRef.current, updater),
    [activeConversationIdRef, updateQueuedPromptsForConv]
  )

  const shiftQueuedPromptForConv = useCallback((convId: string): QueuedPromptItem | undefined => {
    const prev = queuedPromptsByConvIdRef.current[convId] || []
    if (prev.length === 0) return undefined
    const [head, ...rest] = prev
    queuedPromptsByConvIdRef.current[convId] = rest
    const entry = inFlightTurnsRef.current.get(convId)
    if (entry) entry.queuedPrompts = rest
    if (convId === activeConversationIdRef.current) queuedPromptsRef.current = rest
    refreshTurnRegistry()
    return head
  }, [activeConversationIdRef, refreshTurnRegistry])

  const syncStandalonePerm = useCallback((next: PendingPermEntry | null) => { standalonePendingPermRef.current = next; setStandalonePendingPerm(next) }, [])

  const dismissPendingPerm = useCallback((decision: CodeModePermissionDecision = 'deny', targetConvId?: string) => {
    const cid = targetConvId || activeConversationIdRef.current
    const entry = cid ? inFlightTurnsRef.current.get(cid) : undefined
    if (entry && entry.pendingPermQueue.length > 0) {
      const queued = entry.pendingPermQueue.splice(0, entry.pendingPermQueue.length)
      refreshTurnRegistry(); queued.forEach((p) => p.resolve(decision)); return
    }
    const cur = standalonePendingPermRef.current
    if (!cur || (targetConvId && cur.convId && cur.convId !== targetConvId)) return
    syncStandalonePerm(null); cur.resolve(decision)
  }, [activeConversationIdRef, refreshTurnRegistry, syncStandalonePerm])

  const setRequirePermission = useCallback((next: React.SetStateAction<boolean>) => {
    const val = typeof next === 'function' ? next(requirePermissionRef.current) : next
    requirePermissionRef.current = val; setRequirePermissionState(val)
    if (!val) {
      if (standalonePendingPermRef.current) { const cur = standalonePendingPermRef.current; syncStandalonePerm(null); cur.resolve('allow_once') }
      const toAllow: PendingPermEntry[] = []
      inFlightTurnsRef.current.forEach((t) => { if (t.pendingPermQueue.length > 0) toAllow.push(...t.pendingPermQueue.splice(0, t.pendingPermQueue.length)) })
      if (toAllow.length > 0) { refreshTurnRegistry(); toAllow.forEach((p) => p.resolve('allow_once')) }
    }
  }, [refreshTurnRegistry, syncStandalonePerm])

  const requestCodeModePermission = useCallback(
    (req: CodeModePermissionRequest, signal?: AbortSignal, approvedSet?: Set<string>, epoch?: number, convId?: string): Promise<CodeModePermissionDecision> => {
      const cid = convId || activeConversationIdRef.current || '__default__'
      const turnEntry = convId ? inFlightTurnsRef.current.get(convId) : undefined
      const activeSignal = signal || turnEntry?.abortController.signal
      const callEpoch = epoch !== undefined ? epoch : (turnEntry ? turnEntry.permEpoch : (permEpochByConvIdRef.current[cid] ?? permEpochRef.current))
      const targetApproved = approvedSet || turnEntry?.approvedOps || approvedOpsRef.current
      const prevQueue = permQueueByConvIdRef.current[cid] || Promise.resolve()
      const next = prevQueue.then(() => {
        const liveTurn = convId ? inFlightTurnsRef.current.get(convId) : undefined
        const nowEpoch = liveTurn ? liveTurn.permEpoch : (permEpochByConvIdRef.current[cid] ?? permEpochRef.current)
        if (nowEpoch !== callEpoch || activeSignal?.aborted) return 'deny' as CodeModePermissionDecision
        if (!liveTurn && convId !== undefined && activeConversationIdRef.current !== convId) return 'deny' as CodeModePermissionDecision
        if (!requirePermissionRef.current) return 'allow_once' as CodeModePermissionDecision
        if (targetApproved.has('*')) return 'allow_all' as CodeModePermissionDecision
        if (targetApproved.has(req.operation)) return 'allow_op' as CodeModePermissionDecision
        return new Promise<CodeModePermissionDecision>((resolve) => {
          let settled = false
          const finish = (d: CodeModePermissionDecision) => { if (!settled) { settled = true; activeSignal?.removeEventListener('abort', onAbort); resolve(d) } }
          const permItem: PendingPermEntry = { req, resolve: finish, approvedSet: targetApproved, convId: cid, signal: activeSignal, epoch: callEpoch }
          const onAbort = () => {
            const t = convId ? inFlightTurnsRef.current.get(convId) : undefined
            if (t) { const idx = t.pendingPermQueue.indexOf(permItem); if (idx >= 0) { t.pendingPermQueue.splice(idx, 1); refreshTurnRegistry() } }
            else if (standalonePendingPermRef.current === permItem) syncStandalonePerm(null)
            finish('deny')
          }
          activeSignal?.addEventListener('abort', onAbort, { once: true })
          if (liveTurn) { liveTurn.pendingPermQueue.push(permItem); refreshTurnRegistry() } else syncStandalonePerm(permItem)
        })
      })
      permQueueByConvIdRef.current[cid] = next.then(() => {}, () => {})
      return next
    },
    [activeConversationIdRef, refreshTurnRegistry, syncStandalonePerm]
  )

  const resolveBackgroundPermDecision = useCallback((convId: string, decision: CodeModePermissionDecision) => {
    const turnEntry = inFlightTurnsRef.current.get(convId), head = turnEntry?.pendingPermQueue.shift()
    if (!head) return
    const targetApproved = head.approvedSet || turnEntry?.approvedOps || approvedOpsRef.current
    if (decision === 'allow_op') targetApproved.add(head.req.operation)
    else if (decision === 'allow_all') targetApproved.add('*')
    refreshTurnRegistry(); head.resolve(decision)
  }, [refreshTurnRegistry])

  const resolvePermDecision = useCallback((decision: CodeModePermissionDecision) => {
    const fgTurn = inFlightTurnsRef.current.get(activeConversationIdRef.current)
    if (fgTurn && fgTurn.pendingPermQueue.length > 0) { resolveBackgroundPermDecision(fgTurn.convId, decision); return }
    const cur = standalonePendingPermRef.current
    if (!cur) return
    const targetApproved = cur.approvedSet || approvedOpsRef.current
    if (decision === 'allow_op') targetApproved.add(cur.req.operation)
    else if (decision === 'allow_all') targetApproved.add('*')
    syncStandalonePerm(null); cur.resolve(decision)
  }, [activeConversationIdRef, resolveBackgroundPermDecision, syncStandalonePerm])

  const registerTurnEntry = useCallback((convId: string, snapshot: TurnSnapshotState, label?: string): InFlightTurnEntry => {
    const existing = inFlightTurnsRef.current.get(convId)
    if (existing) {
      existing.permEpoch += 1
      existing.abortController.abort()
      existing.pendingPermQueue.splice(0).forEach((p) => p.resolve('deny'))
    }
    const nextEpoch = (permEpochByConvIdRef.current[convId] || 0) + 1
    permEpochByConvIdRef.current[convId] = nextEpoch
    if (label) convLabelsRef.current[convId] = label
    const abortController = new AbortController()
    const approvedOps = new Set<string>()
    const entry: InFlightTurnEntry = {
      convId,
      busyStatus: 'Connecting to Antigravity...',
      liveActivitySteps: [],
      abortController,
      approvedOps,
      permEpoch: nextEpoch,
      pendingPermQueue: [],
      queuedPrompts: queuedPromptsByConvIdRef.current[convId] || [],
      snapshot,
    }
    inFlightTurnsRef.current.set(convId, entry)
    approvedOpsRef.current = approvedOps
    if (activeConversationIdRef.current === convId) liveActivityStepsRef.current = []
    refreshTurnRegistry()
    return entry
  }, [activeConversationIdRef, refreshTurnRegistry])

  const finishTurnEntry = useCallback((convId: string, abortController: AbortController) => {
    const cur = inFlightTurnsRef.current.get(convId)
    if (cur && cur.abortController === abortController) {
      cur.pendingPermQueue.splice(0).forEach((p) => p.resolve('deny'))
      inFlightTurnsRef.current.delete(convId)
      if (activeConversationIdRef.current === convId) {
        const fallbackSteps = Array.isArray(mockExt?.initialLiveActivitySteps)
          ? (mockExt.initialLiveActivitySteps as AntigravityActivityStep[])
          : []
        liveActivityStepsRef.current = fallbackSteps
        setNonTurnLiveSteps(fallbackSteps)
        nonTurnBusyRef.current = (mockExt?.initialBusyStatus as string) || null
        nonTurnBusyOwnerRef.current = ''
        setNonTurnBusyStatus(nonTurnBusyRef.current)
      }
      refreshTurnRegistry()
    }
  }, [activeConversationIdRef, mockExt?.initialBusyStatus, mockExt?.initialLiveActivitySteps, refreshTurnRegistry])

  const abortConvTurn = useCallback(
    (convId: string, reasonText?: string) => {
      const cid = convId || activeConversationIdRef.current
      permEpochRef.current += 1
      permEpochByConvIdRef.current[cid] = (permEpochByConvIdRef.current[cid] || 0) + 1
      const entry = inFlightTurnsRef.current.get(cid)
      if (entry) {
        const partialSteps = entry.liveActivitySteps
        inFlightTurnsRef.current.delete(cid)
        entry.abortController.abort()
        entry.pendingPermQueue.splice(0).forEach((p) => p.resolve('deny'))
        if (reasonText) {
          if (activeConversationIdRef.current === cid) {
            setMessages((prev) => [...prev, Object.assign({ role: 'assistant' as const, text: reasonText }, partialSteps.length > 0 ? { activitySteps: partialSteps } : null)])
          }
          onTurnAbortedRef.current?.(cid, reasonText, partialSteps)
        }
      } else if (reasonText) {
        const partialSteps = activeConversationIdRef.current === cid ? liveActivityStepsRef.current : []
        if (partialSteps.length > 0 && activeConversationIdRef.current === cid) {
          setMessages((prev) => [...prev, { role: 'assistant', text: reasonText, activitySteps: partialSteps }])
        }
        onTurnAbortedRef.current?.(cid, reasonText, partialSteps)
      }
      if (standalonePendingPermRef.current && (!standalonePendingPermRef.current.convId || standalonePendingPermRef.current.convId === cid)) {
        const cur = standalonePendingPermRef.current
        syncStandalonePerm(null)
        cur.resolve('deny')
      }
      if (activeConversationIdRef.current === cid) {
        liveActivityStepsRef.current = []
        setNonTurnLiveSteps([])
        nonTurnBusyRef.current = null
        nonTurnBusyOwnerRef.current = ''
        setNonTurnBusyStatus(null)
      }
      clearInFlightConvId(cid)
      refreshTurnRegistry()
    },
    [activeConversationIdRef, refreshTurnRegistry, setMessages, syncStandalonePerm]
  )

  const abortActiveTurn = useCallback(
    (reasonText?: string) => abortConvTurn(activeConversationIdRef.current, reasonText),
    [abortConvTurn, activeConversationIdRef]
  )

  const abortAllConvTurns = useCallback(() => {
    Array.from(inFlightTurnsRef.current.keys()).forEach((cid) => abortConvTurn(cid))
    clearInFlightConvId()
  }, [abortConvTurn])

  const handleStopTurn = useCallback(() => {
    abortConvTurn(activeConversationIdRef.current, 'Stopped by user.')
  }, [abortConvTurn, activeConversationIdRef])

  const cancelStandaloneForConv = useCallback((prevConvId: string) => {
    if (!prevConvId) return
    permEpochByConvIdRef.current[prevConvId] = (permEpochByConvIdRef.current[prevConvId] || 0) + 1
    permEpochRef.current += 1
    if (standalonePendingPermRef.current && standalonePendingPermRef.current.convId === prevConvId) {
      const cur = standalonePendingPermRef.current
      syncStandalonePerm(null)
      cur.resolve('deny')
    }
    if (nonTurnBusyRef.current && (!nonTurnBusyOwnerRef.current || nonTurnBusyOwnerRef.current === prevConvId)) {
      nonTurnBusyRef.current = (mockExt?.initialBusyStatus as string) || null
      nonTurnBusyOwnerRef.current = ''
      setNonTurnBusyStatus(nonTurnBusyRef.current)
    }
  }, [mockExt?.initialBusyStatus, syncStandalonePerm])

  return {
    inFlightTurnsRef, permEpochByConvIdRef, queuedPromptsByConvIdRef, convLabelsRef, turnResumerRef, onTurnAbortedRef,
    busyStatus, setBusyStatus, setConvBusyStatus,
    liveActivitySteps, liveActivityStepsRef, setLiveActivitySteps, setConvLiveSteps,
    requirePermission, requirePermissionRef, setRequirePermission,
    approvedOpsRef, pendingPerm, pendingPermRef, permEpochRef,
    runningConvIds, pendingPermConvIds, backgroundPendingPerm,
    dismissPendingPerm, requestCodeModePermission, resolvePermDecision, resolveBackgroundPermDecision,
    registerTurnEntry, finishTurnEntry, abortConvTurn, abortActiveTurn, abortAllConvTurns,
    handleStopTurn, cancelStandaloneForConv,
    queuedPrompts, queuedPromptsRef, updateQueuedPrompts, updateQueuedPromptsForConv, shiftQueuedPromptForConv,
  }
}

export type StudioTurnConcurrency = ReturnType<typeof useStudioTurnConcurrency>

export interface MaterializeTurnBundlesParams {
  sdk: Looker40SDK; extensionSDK?: Partial<ExtensionSDK>; userId: string; result: AntigravityTurnResult
  userPrompt: string; resolvedUseCase?: ResolvedStudioUseCase; allowedModes?: StudioUseCase[]
  folderId: string; turnExplores: string[]; itemState: { items: StudioContentItem[]; activeKey: string }
  existingPublishedApp?: PublishedAppState | null; existingNativeContent?: NativeContentState | null
  existingLookmlBundle?: LookmlBundle | null; existingLookmlProjectId?: string
  initialConvType?: string; initialConvContent?: Record<string, unknown>
  requirePermission?: boolean; approvedOperations?: Set<string>
  onPermissionRequest?: (req: CodeModePermissionRequest) => Promise<CodeModePermissionDecision>
  signal?: AbortSignal; onStatus?: (status: string) => void
  onItemUpserted?: (up: StudioContentItem & { existed: boolean }) => void
  onLookmlSaved?: (bundle: LookmlBundle, lookmlId: string, rawItem: Partial<StudioContentItem> & { id: string; contentType: 'lookml' }) => void
  onLookmlDashSaved?: (dash: { id: string; title: string; embedPath: string; model?: string }, lookmlId: string, isExisting: boolean) => void
  onNativeSaved?: (savedNative: NativeContentState, isExisting: boolean) => void
  onAlertSaved?: (savedAlert: AlertInspectorBundle, alertId: string, rawItem: Partial<StudioContentItem> & { id: string; contentType: 'alert' }) => void
  onDataAppSaved?: (upserted: PublishedAppState, appUseCase: ResolvedStudioUseCase, isExisting: boolean) => void
}

export interface MaterializeTurnBundlesOutcome {
  aborted?: boolean; permissionDenied?: string; handledArtifact: boolean; effectiveExplores: string[]
  studioMeta: { explores: string[]; lastInteractionId?: string; environmentId?: string }
  crudItems: TurnCrudItem[]; convType: string; convTitle: string; convContent?: Record<string, unknown>
  publishedApp: PublishedAppState | null; nativeContent: NativeContentState | null
  lookmlBundle: LookmlBundle | null; lookmlProjectId: string; alertBundle: AlertInspectorBundle | null
  finalDashId?: string; finalWidgetCount?: number; publishedDataAppDashboardLink: { title: string; path: string } | null
}

export async function checkDataAppPublishGate(opts: {
  pubOp: 'create_dashboard' | 'update_dashboard'; dashboardId?: string; title: string; folderId: string
  thought: string; approvedOperations: Set<string>; signal?: AbortSignal
  onPermissionRequest?: (req: CodeModePermissionRequest) => Promise<CodeModePermissionDecision>
}): Promise<'allowed' | 'aborted' | string> {
  const { pubOp, dashboardId, title, folderId, thought, approvedOperations, signal, onPermissionRequest } = opts
  if (approvedOperations.has('*') || approvedOperations.has(pubOp)) return 'allowed'
  const denyMsg = `PermissionError: Operation '${pubOp}' mutates Looker state and was not approved.`
  if (!onPermissionRequest) return denyMsg
  const decision = await onPermissionRequest({
    operation: pubOp, httpMethod: dashboardId ? 'PATCH' : 'POST',
    path: dashboardId ? `/api/4.0/dashboards/${dashboardId}` : '/api/4.0/dashboards',
    args: { title, folder_id: folderId }, thought,
  })
  if (signal?.aborted) return 'aborted'
  if (decision === 'allow_op') approvedOperations.add(pubOp)
  else if (decision === 'allow_all') approvedOperations.add('*')
  else if (decision !== 'allow_once' && (decision as unknown) !== true) return denyMsg
  return 'allowed'
}

export async function materializeTurnBundles(params: MaterializeTurnBundlesParams): Promise<MaterializeTurnBundlesOutcome> {
  const {
    sdk, extensionSDK, userId, result, userPrompt, resolvedUseCase, allowedModes, folderId, turnExplores, itemState,
    existingPublishedApp = null, existingNativeContent = null, existingLookmlBundle = null, existingLookmlProjectId = '',
    initialConvType = 'app', initialConvContent, requirePermission = true, approvedOperations = new Set<string>(),
    onPermissionRequest, signal, onStatus, onItemUpserted, onLookmlSaved, onLookmlDashSaved, onNativeSaved, onAlertSaved, onDataAppSaved,
  } = params
  const bundleExplores = result.bundle
    ? Array.from(new Set([
        ...(result.bundle.widgets || []).filter((w) => w.query?.model && w.query?.view).map((w) => formatExploreId(w.query.model, w.query.view)),
        ...extractExploreIdsFromCode(result.bundle.raw_code || ''),
      ]))
    : result.nativeBundle?.explores || []
  const effectiveExplores = turnExplores.length > 0 ? turnExplores : bundleExplores
  const studioMeta = { explores: effectiveExplores, lastInteractionId: result.session.lastInteractionId, environmentId: result.session.environmentId }
  const crudItems: TurnCrudItem[] = []
  const recordCrud = (item: TurnCrudItem) => {
    const idx = crudItems.findIndex((x) => x.key === item.key)
    if (idx >= 0) crudItems[idx] = item
    else crudItems.push(item)
  }
  const syncItem = (raw: Partial<StudioContentItem> & { id: string; contentType: StudioContentItemType }) => {
    const up = upsertLocalTurnContentItem(itemState, raw)
    onItemUpserted?.(up)
    return up
  }
  let convType = initialConvType, convTitle = '', convContent = initialConvContent ? Object.assign({}, initialConvContent) : undefined
  let publishedApp = existingPublishedApp, nativeContent = existingNativeContent
  let lookmlBundle = existingLookmlBundle, lookmlProjectId = existingLookmlProjectId, alertBundle: AlertInspectorBundle | null = null
  let handledArtifact = false, finalDashId: string | undefined, finalWidgetCount: number | undefined
  let publishedDataAppDashboardLink: { title: string; path: string } | null = null
  const baseOut = () => ({
    handledArtifact, effectiveExplores, studioMeta, crudItems, convType, convTitle, convContent,
    publishedApp, nativeContent, lookmlBundle, lookmlProjectId, alertBundle, finalDashId, finalWidgetCount, publishedDataAppDashboardLink,
  })
  if (result.permissionError) return Object.assign(baseOut(), { permissionDenied: result.permissionError })

  if (result.bundle && requirePermission) {
    const pubOp = publishedApp?.dashboardId ? 'update_dashboard' : 'create_dashboard'
    const gate = await checkDataAppPublishGate({
      pubOp, dashboardId: publishedApp?.dashboardId, title: result.bundle.title, folderId,
      thought: `Publish Data App "${result.bundle.title}" to Looker dashboard`,
      approvedOperations, signal, onPermissionRequest,
    })
    if (gate === 'aborted') return Object.assign(baseOut(), { aborted: true })
    if (gate !== 'allowed') return Object.assign(baseOut(), { permissionDenied: gate })
  }
  const ns = getArtifactNamespace(extensionSDK)

  if (result.lookmlBundle) {
    const canonProj = resolveLookmlCanonicalProjectId(result.lookmlBundle) || cleanLookmlProjectId(lookmlProjectId)
    if (canonProj) {
      handledArtifact = true
      onStatus?.('Saving LookML project changes...')
      const prevFiles = lookmlBundle && resolveLookmlCanonicalProjectId(lookmlBundle) === canonProj ? lookmlBundle.files : []
      let mergedBundle: LookmlBundle = Object.assign({}, result.lookmlBundle, {
        id: canonProj, project_id: cleanLookmlProjectId(result.lookmlBundle.project_id) || canonProj,
        files: mergeLookmlFiles(prevFiles, result.lookmlBundle.files),
      })
      try {
        const saved = await saveLookmlSessionArtifact({ sdk, extensionSDK, userId, bundle: mergedBundle, studio: studioMeta })
        mergedBundle = saved.payload.bundle
      } catch { /* ignore */ }
      if (signal?.aborted) return Object.assign(baseOut(), { aborted: true })
      const lookmlId = cleanLookmlProjectId(mergedBundle.project_id) || canonProj
      lookmlBundle = mergedBundle; lookmlProjectId = lookmlId
      const isExistingLookml = itemState.items.some((it) => it.contentType === 'lookml' && (it.projectId || it.id) === lookmlId)
      const rawLookmlItem = {
        id: lookmlId, sessionId: lookmlId, projectId: lookmlId, contentType: 'lookml' as const, title: `LookML: ${lookmlId}`,
        embedPath: `/lookml/${encodeURIComponent(lookmlId)}`, updatedAt: new Date().toISOString(),
        source: (isExistingLookml ? 'modified' : 'created') as 'modified' | 'created', createdInConversation: true, hidden: false,
      }
      const upLookml = syncItem(rawLookmlItem)
      onLookmlSaved?.(mergedBundle, lookmlId, rawLookmlItem)
      recordCrud(toTurnCrudItem(upLookml, upLookml.existed ? 'updated' : 'created'))
      convType = 'lookml'; convTitle = result.lookmlBundle.title || `LookML: ${lookmlId}`
      convContent = { sessionId: lookmlId, projectId: lookmlId, model: mergedBundle.model_name, branch: mergedBundle.branch_name }
      extractLookmlDashboardsFromBundle(Object.assign({}, result.lookmlBundle, { model_name: result.lookmlBundle.model_name || mergedBundle.model_name, project_id: lookmlId })).forEach((d) => {
        if (result.nativeBundle && (result.nativeBundle.id === d.id || result.nativeBundle.lookml_dashboard_id === d.id)) return
        const isExistingDash = itemState.items.some((it) => it.key === `lookml_dashboard:${d.id}`)
        syncItem({ id: d.id, contentType: 'lookml_dashboard', title: d.title, embedPath: d.embedPath, folderId, lookmlDashboardId: d.id, source: isExistingDash ? 'modified' : 'created', createdInConversation: true, hidden: false })
        onLookmlDashSaved?.(d, lookmlId, isExistingDash)
        recordCrud(toTurnCrudItem({ key: `lookml_dashboard:${d.id}`, id: d.id, title: d.title, contentType: 'lookml_dashboard', embedPath: d.embedPath }, isExistingDash ? 'updated' : 'created'))
        finalDashId = d.id
      })
    }
  }
  if (result.nativeBundle) {
    handledArtifact = true
    onStatus?.('Indexing native Looker content in user catalog...')
    const reqCt = (result.nativeBundle.contentType || 'dashboard') as StudioContentItemType
    const isExistingNative = itemState.items.some((it) => it.id === String(result.nativeBundle!.id) && (it.contentType === reqCt || (['dashboard', 'lookml_dashboard'].includes(it.contentType) && ['dashboard', 'lookml_dashboard'].includes(reqCt))))
    const savedNative = await saveNativeContentArtifact(sdk, extensionSDK, userId, result.nativeBundle, folderId, nativeContent, studioMeta)
    if (signal?.aborted) return Object.assign(baseOut(), { aborted: true })
    nativeContent = savedNative
    const nCt = (savedNative.contentType || 'dashboard') as StudioContentItemType
    syncItem({
      id: String(savedNative.id), contentType: nCt, title: savedNative.title, embedPath: savedNative.embedPath, folderId: savedNative.folderId,
      dashboardId: nCt === 'dashboard' ? String(savedNative.id) : undefined, lookId: savedNative.lookId, lookmlDashboardId: savedNative.lookmlDashboardId,
      source: isExistingNative ? 'modified' : 'created', createdInConversation: true, hidden: false,
    })
    onNativeSaved?.(savedNative, isExistingNative)
    recordCrud(toTurnCrudItem({ key: `${nCt}:${savedNative.id}`, id: String(savedNative.id), title: savedNative.title, contentType: nCt, embedPath: savedNative.embedPath }, isExistingNative ? 'updated' : 'created'))
    finalDashId = savedNative.id; finalWidgetCount = result.nativeBundle.tile_count
    convType = 'dashboard'; convTitle = savedNative.title
    convContent = Object.assign({}, convContent, { dashboardId: savedNative.id, contentType: savedNative.contentType, embedPath: savedNative.embedPath, lookId: savedNative.lookId, lookmlDashboardId: savedNative.lookmlDashboardId })
  }
  if (result.alertBundle) {
    handledArtifact = true
    onStatus?.('Saving Looker Alert snapshot to Artifacts...')
    const alertId = String(result.alertBundle.alert_id || result.alertBundle.id || '').trim()
    const isExistingAlert = itemState.items.some((it) => it.contentType === 'alert' && it.id === alertId)
    const savedAlert = await saveAlertArtifact(sdk, userId, result.alertBundle, ns)
    if (signal?.aborted) return Object.assign(baseOut(), { aborted: true })
    alertBundle = savedAlert
    const alertTitle = String(savedAlert.custom_title || savedAlert.title || `Alert #${alertId}`)
    const rawAlertItem = {
      id: alertId, alertId, dashboardId: savedAlert.dashboard_id ? String(savedAlert.dashboard_id) : undefined,
      contentType: 'alert' as const, title: alertTitle, embedPath: `/alerts/${encodeURIComponent(alertId)}`,
      updatedAt: savedAlert.updated_at, source: (isExistingAlert ? 'modified' : 'created') as 'modified' | 'created', createdInConversation: true, hidden: false,
    }
    const upAlert = syncItem(rawAlertItem)
    onAlertSaved?.(savedAlert, alertId, rawAlertItem)
    recordCrud(toTurnCrudItem(upAlert, isExistingAlert ? 'updated' : 'created'))
    convType = 'tile'; convTitle = alertTitle
    convContent = Object.assign({}, convContent, { alertId, dashboardId: savedAlert.dashboard_id ? String(savedAlert.dashboard_id) : undefined, contentType: 'alert' })
  }
  if (result.bundle) {
    handledArtifact = true
    onStatus?.('Publishing inline extension & updating Looker dashboard...')
    const upserted = await upsertPublishedDataApp(sdk, result.bundle, folderId, publishedApp, studioMeta)
    if (signal?.aborted) return Object.assign(baseOut(), { aborted: true })
    publishedApp = upserted
    const inferredUc = resolvedUseCase || extractResolvedUseCase(result.assistantText, userPrompt, allowedModes)
    const appUseCase: ResolvedStudioUseCase = inferredUc === 'data-investigator' ? 'data-investigator' : 'app'
    const appCt: StudioContentItemType = appUseCase === 'data-investigator' ? 'data-investigator' : 'data_app'
    const isExistingApp = itemState.items.some((it) => (it.contentType === 'data_app' || it.contentType === 'data-investigator') && it.id === String(upserted.dashboardId))
    const upApp = syncItem({
      id: String(upserted.dashboardId), dashboardId: String(upserted.dashboardId), contentType: appCt, title: upserted.title,
      embedPath: `/embed/dashboards/${encodeURIComponent(String(upserted.dashboardId))}`, folderId: upserted.folderId, extensionId: upserted.extensionId,
      source: isExistingApp ? 'modified' : 'created', createdInConversation: true, hidden: false,
    })
    onDataAppSaved?.(upserted, appUseCase, isExistingApp)
    recordCrud(toTurnCrudItem(upApp, isExistingApp ? 'updated' : 'created'))
    finalDashId = upserted.dashboardId; finalWidgetCount = result.bundle?.widgets?.length || 0
    if (upserted.dashboardId) {
      publishedDataAppDashboardLink = { title: upserted.title || result.bundle.title || 'Data App Dashboard', path: `/dashboards/${encodeURIComponent(String(upserted.dashboardId))}` }
    }
    convType = appUseCase; convTitle = upserted.title
    convContent = Object.assign({}, convContent, { dashboardId: upserted.dashboardId, appArtifactId: `obj_app_${upserted.dashboardId}`, extensionId: upserted.extensionId })
  }
  return baseOut()
}

export interface ResumeConversationTurnParams {
  sdk: Looker40SDK; extensionSDK?: Partial<ExtensionSDK>; userId: string; auth: AntigravityAuth
  conv: UserConversationEntry; folderId?: string; model?: string; thinkingLevel?: 'low' | 'medium' | 'high'
  maxTotalTokens?: number; maxToolRounds?: number; allowedModes?: StudioUseCase[]
  requirePermission?: boolean; approvedOperations?: Set<string>
  onPermissionRequest?: (req: CodeModePermissionRequest) => Promise<CodeModePermissionDecision>
  onStatus?: (status: string) => void; onProgressSteps?: (steps: AntigravityActivityStep[]) => void
  pollScheduleMs?: number[]; signal?: AbortSignal
}

export async function resumeInFlightConversationTurn(params: ResumeConversationTurnParams): Promise<{
  result: AntigravityTurnResult; conversation: UserConversationEntry; publishedApp: PublishedAppState | null
}> {
  const {
    sdk, extensionSDK, userId, auth, conv, folderId = '1', model, thinkingLevel, maxTotalTokens, maxToolRounds,
    allowedModes, requirePermission = true, approvedOperations = new Set<string>(), onPermissionRequest,
    onStatus = () => {}, onProgressSteps, pollScheduleMs, signal,
  } = params
  const interactionId = String(conv.interactionId || '').trim()
  if (!interactionId) throw new Error(`Conversation "${conv.id}" has no persisted interactionId to resume`)
  let baseMsgs = (getSessionConversationMessages(conv.id) || []) as ChatMessage[]
  if (!baseMsgs.length && conv.turnInteractionIds?.length) {
    const hydrated = await hydrateRemoteConversationMessages({
      extensionSDK, auth, sdk, userId, conv: Object.assign({}, conv, { interactionId: undefined }), activeEnvironmentId: conv.environmentId,
    }).catch(() => null)
    if (hydrated?.messages.length) baseMsgs = hydrated.messages as ChatMessage[]
  }
  const lastIsUser = baseMsgs[baseMsgs.length - 1]?.role === 'user'
  const rec = lastIsUser ? null : await recoverInFlightInteraction({ extensionSDK, auth, interactionId }).catch(() => null)
  const rootId = rec?.rootInteractionId || (!lastIsUser ? interactionId : conv.turnInteractionIds?.slice(-1)[0]?.[0] || interactionId)
  const userPrompt = rec?.userPrompt || (lastIsUser ? baseMsgs[baseMsgs.length - 1]?.text : '') || conv.label || 'Continue request'
  const priorMsgs = lastIsUser ? baseMsgs.slice(0, -1) : baseMsgs
  const msgsWithUser: ChatMessage[] = lastIsUser ? baseMsgs : [...priorMsgs, { role: 'user', text: userPrompt }]
  const explores = conv.explores || []
  const convUseCase = (conv.use_case as StudioUseCase) || studioModeToUseCase(conv.type)
  const existingPublishedApp: PublishedAppState | null =
    conv.content?.appArtifactId && conv.content.dashboardId
      ? { dashboardId: String(conv.content.dashboardId), title: conv.label || '', folderId, extensionId: String(conv.content.extensionId || ''), elementId: '' }
      : null
  const existingNativeContent: NativeContentState | null =
    !conv.content?.appArtifactId && conv.content?.dashboardId
      ? { id: String(conv.content.dashboardId), title: conv.label || '', contentType: (conv.content.contentType as 'dashboard') || 'dashboard', folderId, embedPath: String(conv.content.embedPath || '') }
      : null

  addInFlightConvId(conv.id)
  try {
    const result = await runAntigravityTurn({
      sdk, extensionSDK, userId, environmentId: conv.environmentId, conversationId: conv.id, auth,
      session: { lastInteractionId: interactionId, environmentId: conv.environmentId, conversationId: conv.id, explores },
      model, thinkingLevel, maxTotalTokens, maxToolRounds,
      mode: convUseCase === 'dashboard' ? 'dashboard' : 'data_app', useCase: convUseCase, allowedModes,
      selectedExplores: explores, folderId, toolMode: convUseCase === 'lookml' ? 'lookml' : 'data_app',
      lookmlProjectId: String(conv.content?.projectId || ''), existingNativeContent, schemaMarkdown: '',
      userPrompt, rawUserPrompt: userPrompt, priorMessages: priorMsgs,
      requirePermission, approvedOperations, onPermissionRequest, onProgressSteps, pollScheduleMs, signal,
      resumeInteractionId: interactionId, onStatus,
    })
    const itemState = { items: hydrateConversationContentItems(conv), activeKey: conv.activeContentTabKey || '' }
    const mat = await materializeTurnBundles({
      sdk, extensionSDK, userId, result, userPrompt, allowedModes, folderId, turnExplores: explores, itemState,
      existingPublishedApp, existingNativeContent, existingLookmlProjectId: String(conv.content?.projectId || ''),
      initialConvType: conv.type || result.resolvedUseCase || 'app', initialConvContent: conv.content,
      requirePermission, approvedOperations, onPermissionRequest, signal, onStatus,
    })
    const ns = getArtifactNamespace(extensionSDK)
    const nextMsgs: ChatMessage[] = mat.permissionDenied
      ? [...msgsWithUser, { role: 'error', text: mat.permissionDenied }]
      : [
          ...msgsWithUser,
          Object.assign(
            {
              role: 'assistant' as const,
              text:
                mat.publishedDataAppDashboardLink && !(result.assistantText || 'Completed.').includes(mat.publishedDataAppDashboardLink.path)
                  ? `${(result.assistantText || 'Completed.').trimEnd()}\n\n**Looker Dashboard:** [Open ${mat.publishedDataAppDashboardLink.title}](${mat.publishedDataAppDashboardLink.path})`
                  : result.assistantText || 'Completed.',
              interactionId: result.session.lastInteractionId,
            },
            mat.finalDashId ? { dashboardId: mat.finalDashId } : null,
            mat.finalWidgetCount !== undefined ? { widgetCount: mat.finalWidgetCount } : null,
            mat.crudItems.length > 0 ? { crudItems: mat.crudItems } : null,
            result.activitySteps?.length ? { activitySteps: result.activitySteps } : null,
            result.thinkingDurationSec ? { thinkingDurationSec: result.thinkingDurationSec } : null
          ),
        ]
    setSessionConversationMessages(conv.id, nextMsgs)
    const tags = normalizeConversationTags(
      conv.tags, mat.effectiveExplores, itemState.items.map((i) => i.contentType), mat.convType
    )
    const turnInteractionIds = mergeTurnInteractionIds(
      conv.turnInteractionIds,
      result.session.lastInteractionId ? [[rootId, result.session.lastInteractionId]] : undefined
    )
    const hasDeletedCrud = mat.crudItems.some((c) => c.action === 'deleted')
    const updatedConv: UserConversationEntry = Object.assign(
      {}, conv,
      {
        id: conv.id, type: mat.convType, use_case: mat.convType,
        label: conv.label || mat.convTitle || sanitizeConversationLabel('', userPrompt),
        inFlight: false, interactionId: result.session.lastInteractionId,
        environmentId: result.session.environmentId || conv.environmentId,
        explores: mat.effectiveExplores, updatedAt: new Date().toISOString(),
      },
      tags?.length ? { tags } : null,
      turnInteractionIds?.length ? { turnInteractionIds } : null,
      mat.convContent ? { content: mat.convContent } : null,
      itemState.items.length > 0 || hasDeletedCrud ? { contentItems: itemState.items } : null,
      itemState.activeKey || hasDeletedCrud || conv.activeContentTabKey !== undefined ? { activeContentTabKey: itemState.activeKey } : null
    )
    if (userId) await saveUserConversation(sdk, userId, updatedConv, ns).catch(() => {})
    return { result, conversation: updatedConv, publishedApp: mat.publishedApp }
  } finally {
    removeInFlightConvId(conv.id)
  }
}
