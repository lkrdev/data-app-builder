import React, { useEffect, useMemo, useRef, useState } from 'react'

import {
  BookOpen, Brain, Bug, Check, ChevronDown, ChevronUp, Code2, Copy, FileText,
  Loader2, Terminal, Wrench,
} from 'lucide-react'

import {
  AntigravityActivityStep, formatThinkingTraceMarkdown,
  MAX_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH, normalizeSandboxFilePath,
  parseAttachmentDataUrl, resolveBuiltinWorkspaceFileContent,
} from '../antigravity'
import { copyTextWithExtensionSdk, normalizeStudioAgentName } from '../lookerApi'
import { LookmlBundle } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import { StudioComposer } from './StudioComposer'
import { StudioButton, StudioSkeleton } from './StudioDesignSystem'
import {
  fetchAvailableLookerConnectionsMarkdown, InViewerLookerLinkTarget,
  openContentLinkTargetInViewer, openOrCopyMarkdownLink,
  renderContentTabIcon, StudioMarkdown,
} from './StudioMarkdown'
import { SandboxMarkdownPreviewModal, StarterPromptButtons } from './StudioUseCaseGuides'

export const STEP_BADGES: Record<string, React.ReactNode> = {
  thought: <><Brain size={13} strokeWidth={1.75} aria-hidden="true" /> Thought</>,
  codemode: <><Code2 size={13} strokeWidth={1.75} aria-hidden="true" /> Code Mode</>,
  cli_bridge: <><Terminal size={13} strokeWidth={1.75} aria-hidden="true" /> CLI Bridge</>,
  file: <><FileText size={13} strokeWidth={1.75} aria-hidden="true" /> File</>,
  skill: <><BookOpen size={13} strokeWidth={1.75} aria-hidden="true" /> Skill</>,
}

function formatActivityStepBadge(step: AntigravityActivityStep): React.ReactNode {
  if (step.kind === 'code_execution') {
    return step.language === 'PYTHON'
      ? <><Code2 size={13} strokeWidth={1.75} aria-hidden="true" /> Sandbox Python</>
      : <><Terminal size={13} strokeWidth={1.75} aria-hidden="true" /> Sandbox Bash</>
  }
  return STEP_BADGES[step.kind] || <><Wrench size={13} strokeWidth={1.75} aria-hidden="true" /> Activity</>
}

interface ActivityStepContentContext {
  lookmlBundle?: LookmlBundle | null
  currentAppCode?: string | null
  schemaMarkdown?: string | null
  sandboxMarkdownCache?: Record<string, string>
  sandboxMarkdownLoading?: Record<string, boolean>
  onLoadSandboxMarkdownFile?: (path: string, opts?: { openModal?: boolean }) => Promise<string>
  onOpenSandboxMarkdownModal?: (path: string) => void
  onOpenViewerDocument?: (input: { path: string; title?: string; kind?: 'skill' | 'file'; content?: string }) => Promise<string>
}

export function extractStepFilePath(step: AntigravityActivityStep): string | undefined {
  if (step.kind !== 'file' && step.kind !== 'skill') return undefined
  const cands = [step.path, step.detail, step.title].map((s) => String(s || '').trim()).filter(Boolean)
  for (let i = 0; i < cands.length; i++) {
    const clean = cands[i]
      .split('—')[0]
      .trim()
      .replace(/^(?:Viewing|Editing|Creating|Writing|Reading\s+skill|Skill:)\s+/i, '')
      .trim()
    if (!clean) continue
    if (step.kind === 'skill' && !clean.includes('/') && !/\.[a-z0-9]+$/i.test(clean)) {
      return `/workspace/skills/${clean.toLowerCase()}/SKILL.md`
    }
    if (clean.includes('/') || /\.(?:md|lkml|lookml|py|js|ts|tsx|json|sql|sh|txt|css|html)$/i.test(clean)) {
      return clean
    }
  }
  return undefined
}

function extractStepMarkdownPath(step: AntigravityActivityStep): string | undefined {
  const filePath = extractStepFilePath(step)
  if (!filePath) return undefined
  return step.kind === 'skill' || /\.md$/i.test(filePath) ? filePath : undefined
}

function resolveStaticOrCachedStepContent(step: AntigravityActivityStep, ctx?: ActivityStepContentContext): string | undefined {
  if (step.content?.trim()) return step.content
  const cands = [step.path, step.detail, step.title].map((s) => String(s || '').trim()).filter(Boolean)
  for (let i = 0; i < cands.length; i++) {
    const cand = cands[i]
    const clean = cand.split('—')[0].trim().replace(/^(?:Viewing|Editing|Creating|Writing|Reading\s+skill|Skill:)\s+/i, '').trim()
    const builtin = resolveBuiltinWorkspaceFileContent(cand) || resolveBuiltinWorkspaceFileContent(clean)
    if (builtin) return builtin
    const base = clean.split('/').filter(Boolean).pop() || clean
    const lkml = ctx?.lookmlBundle?.files?.find((f) => f.path === clean || f.path.endsWith(`/${base}`) || f.path === base)?.content
    if (lkml) return lkml
    if ((base === 'app.js' || clean.endsWith('/app.js')) && ctx?.currentAppCode) return ctx.currentAppCode
    if ((base === 'schema.md' || clean.endsWith('/schema.md')) && ctx?.schemaMarkdown) return ctx.schemaMarkdown
    const normalized = normalizeSandboxFilePath(clean)
    const cached = ctx?.sandboxMarkdownCache?.[clean] ?? ctx?.sandboxMarkdownCache?.[normalized] ?? ctx?.sandboxMarkdownCache?.[normalized ? `/${normalized}` : '']
    if (typeof cached === 'string' && cached.length > 0) return cached
  }
  return undefined
}

function resolveActivityStepContent(step: AntigravityActivityStep, ctx?: ActivityStepContentContext): string {
  return resolveStaticOrCachedStepContent(step, ctx) || step.detail || step.path || step.title
}



export const ThinkingStepsList: React.FC<{ steps: AntigravityActivityStep[]; contentCtx?: ActivityStepContentContext }> = ({ steps, contentCtx }) => {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({})
  const handleToggleStep = (key: string, step: AntigravityActivityStep) => {
    const willOpen = !expandedKeys[key]
    setExpandedKeys((prev) => ({ ...prev, [key]: willOpen }))
    if (step.kind === 'file' || step.kind === 'skill') {
      const filePath = extractStepFilePath(step)
      const staticContent = resolveStaticOrCachedStepContent(step, contentCtx)
      if (filePath && contentCtx?.onOpenViewerDocument) {
        void contentCtx.onOpenViewerDocument({ path: filePath, title: step.title, kind: step.kind, content: staticContent })
      } else if (willOpen) {
        const mdPath = extractStepMarkdownPath(step)
        if (mdPath && !staticContent) void contentCtx?.onLoadSandboxMarkdownFile?.(mdPath)
      }
    }
  }
  return (
    <div className="dab-thinking-steps">
      {steps.map((step, sIdx) => {
        const stepKey = String(step.id || sIdx)
        const hasDetail = Boolean(step.detail && step.detail !== step.title)
        const isCollapsibleThought = step.kind === 'thought' && hasDetail
        const isFileOrSkill = step.kind === 'file' || step.kind === 'skill'
        const isExpandableExec =
          (step.kind === 'code_execution' || step.kind === 'codemode' || step.kind === 'cli_bridge') &&
          Boolean(step.content?.trim())
        const isCollapsible = isCollapsibleThought || isFileOrSkill || isExpandableExec
        const isOpen = Boolean(expandedKeys[stepKey])
        const StepTag = isCollapsible ? 'details' : 'div'
        const HeaderTag = isCollapsible ? 'summary' : 'div'
        const testId = isCollapsibleThought
          ? 'thinking-step-thought'
          : step.kind === 'file'
          ? 'thinking-step-file'
          : step.kind === 'skill'
          ? 'thinking-step-skill'
          : isExpandableExec
          ? 'thinking-step-expandable'
          : undefined
        const mdPath = isFileOrSkill ? extractStepMarkdownPath(step) : undefined
        const staticOrCachedContent = isFileOrSkill ? resolveStaticOrCachedStepContent(step, contentCtx) : undefined
        const resolvedContent = isFileOrSkill ? resolveActivityStepContent(step, contentCtx) : ''
        const normalizedMdPath = mdPath ? normalizeSandboxFilePath(mdPath) : ''
        const isLoadingMd = Boolean(
          normalizedMdPath && !staticOrCachedContent &&
            (contentCtx?.sandboxMarkdownLoading?.[mdPath!] || contentCtx?.sandboxMarkdownLoading?.[normalizedMdPath] || contentCtx?.sandboxMarkdownLoading?.[`/${normalizedMdPath}`])
        )
        return (
          <StepTag
            key={stepKey}
            className={`dab-thinking-step dab-thinking-step-${step.kind}${isFileOrSkill ? ' dab-thinking-step-interactive' : ''}${isExpandableExec ? ' dab-thinking-step-expandable' : ''}`}
            data-step-kind={step.kind} data-step-status={step.status || 'done'}
            {...(testId ? { 'data-testid': testId } : {})}
            {...(isCollapsible ? {
              open: isOpen,
              onClick: (e: React.MouseEvent<HTMLElement>) => {
                if ((e.target as HTMLElement).closest('pre, button')) return
                e.preventDefault(); handleToggleStep(stepKey, step)
              },
            } : {})}
          >
            <HeaderTag
              className="dab-thinking-step-header"
              {...(isCollapsible ? { onClick: (e: React.MouseEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); handleToggleStep(stepKey, step) } } : {})}
            >
              <span className="dab-thinking-kind-badge">{formatActivityStepBadge(step)}</span>
              <span className="dab-thinking-step-title">{step.title}</span>
              {step.status === 'running' && <span className="dab-thinking-step-status">Running…</span>}
            </HeaderTag>
            {hasDetail && <code className="dab-thinking-step-detail">{step.detail}</code>}
            {isExpandableExec && <pre className="dab-thinking-step-pre">{step.content}</pre>}
            {isFileOrSkill && isOpen && (
              isLoadingMd ? (
                <div className="dab-thinking-step-loading" data-testid="activity-step-loading">
                  <StudioSkeleton width="100%" height={24} /><span className="dab-muted">Loading from sandbox...</span>
                </div>
              ) : (
                resolvedContent && (
                  <div className="dab-thinking-step-content-wrap">
                    {mdPath && (
                      <div className="dab-thinking-step-md-actions">
                        <StudioButton
                          variant="secondary" testId="open-sandbox-markdown-modal-btn"
                          onClick={(e) => {
                            e.preventDefault(); e.stopPropagation()
                            if (staticOrCachedContent) contentCtx?.onOpenSandboxMarkdownModal?.(mdPath)
                            else void contentCtx?.onLoadSandboxMarkdownFile?.(mdPath, { openModal: true })
                          }}
                        >
                          <FileText size={12} strokeWidth={1.75} aria-hidden="true" /><span>Open Markdown Preview</span>
                        </StudioButton>
                      </div>
                    )}
                    <pre className="dab-thinking-step-content-preview" data-testid="activity-step-content-preview">{resolvedContent}</pre>
                  </div>
                )
              )
            )}
          </StepTag>
        )
      })}
    </div>
  )
}

export const StudioLeftPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    agentName: rawAgentName, extensionSDK,
    messages, builderMode, selectedUseCase, selectedExplores, starterPrompts, starterPromptsLoading,
    setPrompt, busyStatus, liveActivitySteps, hydratingInteractionIds, hydrateMessageActivitySteps,
    pendingPerm, resolvePermDecision,
    leftPaneWidth, setLeftPaneWidth, flushLeftPaneWidthSave, rightPaneCollapsed, setRightPaneCollapsed,
    contentItems = [], activeContentTabKey = '', handleSelectContentTab,
    lookmlBundle, currentAppCode, schemaMarkdown,
    sandboxMarkdownCache, sandboxMarkdownLoading, loadSandboxMarkdownFile, setActiveSandboxMarkdownModalPath,
    openViewerDocument, setActiveViewerDocument,
    conversations = [], activeConversationId, copyThreadState, handleCopyThreadDebugTrace,
  } = ctl
  const agentName = normalizeStudioAgentName(rawAgentName)
  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  const leftPaneRef = useRef<HTMLElement | null>(null)
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  const prevMsgCountRef = useRef(messages.length)
  const prevBusyRef = useRef(Boolean(busyStatus))
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [copiedTraceKey, setCopiedTraceKey] = useState<string | null>(null)
  const [longPressUserMsgIdx, setLongPressUserMsgIdx] = useState<number | null>(null)
  const [expandedUserMsgIndices, setExpandedUserMsgIndices] = useState<Record<number, boolean>>({})
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setLongPressUserMsgIdx(null)
    setExpandedUserMsgIndices({})
    longPressFiredRef.current = false
    return () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current) }
  }, [activeConversationId])

  useEffect(() => {
    if (longPressUserMsgIdx === null || typeof document === 'undefined') return
    const close = (ev: Event) => {
      if (ev.type === 'mousedown' && longPressFiredRef.current) return
      if ((ev.target as HTMLElement | null)?.closest?.(`[data-testid="user-msg-longpress-menu-${longPressUserMsgIdx}"]`)) return
      setLongPressUserMsgIdx(null)
    }
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setLongPressUserMsgIdx(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [longPressUserMsgIdx])

  const clearLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
  }
  const handleCopyUserMsg = (idx: number, text: string) => {
    const key = `user_${idx}`
    void copyTextWithExtensionSdk(text, extensionSDK)
    setCopiedTraceKey(key); setLongPressUserMsgIdx(null)
    setTimeout(() => setCopiedTraceKey((cur) => (cur === key ? null : cur)), 1800)
  }

  const deletedCrudKeys = useMemo(() => {
    const latest = new Map<string, string>()
    messages.forEach((m) => m.crudItems?.forEach((it) => latest.set(it.key, it.action)))
    return new Set(Array.from(latest.entries()).filter(([, a]) => a === 'deleted').map(([k]) => k))
  }, [messages])

  useEffect(() => {
    const el = chatLogRef.current
    const prevCount = prevMsgCountRef.current
    const wasBusy = prevBusyRef.current
    const lastMsg = messages[messages.length - 1]
    const userJustSent = messages.length > prevCount && lastMsg?.role === 'user'
    const busyJustActivated = Boolean(busyStatus) && !wasBusy
    prevMsgCountRef.current = messages.length
    prevBusyRef.current = Boolean(busyStatus)
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 140
    if (userJustSent || ((busyJustActivated || Boolean(busyStatus)) && isNearBottom)) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, busyStatus, liveActivitySteps?.length])

  const contentCtx = useMemo<ActivityStepContentContext>(
    () => ({
      lookmlBundle, currentAppCode, schemaMarkdown, sandboxMarkdownCache, sandboxMarkdownLoading,
      onLoadSandboxMarkdownFile: loadSandboxMarkdownFile,
      onOpenSandboxMarkdownModal: (p: string) => {
        const normalized = normalizeSandboxFilePath(p)
        setActiveSandboxMarkdownModalPath(normalized ? `/${normalized}` : p)
      },
      onOpenViewerDocument: openViewerDocument,
    }),
    [lookmlBundle, currentAppCode, schemaMarkdown, sandboxMarkdownCache, sandboxMarkdownLoading, loadSandboxMarkdownFile, setActiveSandboxMarkdownModalPath, openViewerDocument]
  )

  const handleOpenContentLinkInViewer = (target: InViewerLookerLinkTarget) => openContentLinkTargetInViewer(ctl, target)

  const handleCopyThinkingTrace = (
    e: React.MouseEvent<HTMLButtonElement>, traceKey: string, steps: AntigravityActivityStep[],
    meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string },
    interactionId?: string, stopAtInteractionId?: string
  ) => {
    e.preventDefault(); e.stopPropagation()
    const finishCopy = (resolvedSteps: AntigravityActivityStep[]) => {
      const enriched = resolvedSteps.map((s) => ((s.kind === 'file' || s.kind === 'skill') && !s.content ? { ...s, content: resolveActivityStepContent(s, contentCtx) } : s))
      const md = formatThinkingTraceMarkdown(enriched, meta)
      if (typeof window !== 'undefined') window.__LAST_COPIED_THINKING_TRACE__ = md
      void copyTextWithExtensionSdk(md, extensionSDK)
      setCopiedTraceKey(traceKey)
      setTimeout(() => setCopiedTraceKey((curr) => (curr === traceKey ? null : curr)), 1800)
    }
    if (steps.length > 0 || !interactionId || !hydrateMessageActivitySteps) {
      finishCopy(steps)
    } else {
      void hydrateMessageActivitySteps(interactionId, stopAtInteractionId).then(finishCopy)
    }
  }

  const renderCopyTraceBtn = (
    traceKey: string,
    steps: AntigravityActivityStep[],
    meta?: { thinkingDurationSec?: number; userPrompt?: string; assistantText?: string },
    interactionId?: string,
    stopAtInteractionId?: string
  ) => {
    const isCopied = copiedTraceKey === traceKey
    return (
      <button
        type="button" data-testid="copy-thinking-trace-btn" data-copied={isCopied ? 'true' : 'false'}
        className="dab-thinking-copy-btn" title="Copy debug trace to clipboard" aria-label="Copy debug trace to clipboard"
        onClick={(e) => void handleCopyThinkingTrace(e, traceKey, steps, meta, interactionId, stopAtInteractionId)}
      >
        {isCopied ? <><Check size={12} strokeWidth={2} aria-hidden="true" /><span>Copied</span></> : <Bug size={12} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    )
  }

  const activeConvLabel = conversations.find((c) => c.id === activeConversationId)?.label
  const showThreadCopyBtn = messages.length > 0 || Boolean(liveActivitySteps && liveActivitySteps.length > 0)

  return (
    <aside className="dab-left-pane" ref={leftPaneRef}>
      {showThreadCopyBtn && (
        <div className="dab-left-pane-header" data-testid="left-pane-header">
          <span className="dab-left-pane-title" title={activeConvLabel || 'Conversation'}>{activeConvLabel || 'Conversation'}</span>
          <button
            type="button"
            data-testid="copy-thread-trace-btn"
            data-copied={copyThreadState === 'copied' ? 'true' : 'false'}
            data-loading={copyThreadState === 'loading' ? 'true' : 'false'}
            className="dab-btn dab-btn-secondary dab-thread-copy-btn"
            title="Copy full conversation & sandbox debug trace to clipboard"
            aria-label="Copy Thread"
            disabled={copyThreadState === 'loading'}
            onClick={() => void handleCopyThreadDebugTrace()}
          >
            {copyThreadState === 'loading' ? (
              <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
            ) : copyThreadState === 'copied' ? (
              <Check size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Bug size={13} strokeWidth={1.75} aria-hidden="true" />
            )}
            <span>{copyThreadState === 'loading' ? 'Copying…' : copyThreadState === 'copied' ? 'Copied' : 'Copy Thread'}</span>
          </button>
        </div>
      )}
      <div className="dab-chat-log" ref={chatLogRef}>
        {messages.length === 0 && (
          <div className="dab-empty-chat">
            <p><strong>{builderMode === 'dashboard' ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)' : `Ask ${agentName} to build, analyze, or automate across Looker`}</strong></p>
            <p className="dab-muted">
              {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
            </p>
            <StarterPromptButtons useCase={selectedUseCase} prompts={starterPrompts} loading={starterPromptsLoading} onSelect={setPrompt} disabled={!!busyStatus} />
          </div>
        )}

        {messages.map((m, idx) => {
          const prevUserMsg = idx > 0 && messages[idx - 1]?.role === 'user' ? messages[idx - 1]?.text : undefined
          const hasSteps = Boolean(m.activitySteps && m.activitySteps.length > 0)
          const prevAssistantInteractionId =
            !hasSteps && m.interactionId
              ? messages.slice(0, idx).reverse().find((pm) => pm.role === 'assistant' && pm.interactionId)?.interactionId
              : undefined
          const isHydratingTurn = Boolean(!hasSteps && m.interactionId && hydratingInteractionIds?.[m.interactionId])
          const isUserCopied = copiedTraceKey === `user_${idx}`
          const isLongUserMsg = m.role === 'user' && (m.text.split('\n').length > 5 || m.text.length > 360)
          const isExpanded = Boolean(expandedUserMsgIndices[idx])
          return (
            <div
              key={idx}
              className={`dab-msg dab-msg-${m.role}`}
              onContextMenu={m.role === 'user' ? (e) => { if (longPressFiredRef.current || longPressUserMsgIdx === idx) e.preventDefault() } : undefined}
              onTouchStart={m.role === 'user' ? (e) => {
                if ((e.target as HTMLElement | null)?.closest?.('[data-testid^="user-msg-longpress-menu-"]')) return
                clearLongPress(); longPressFiredRef.current = false
                const pt = e.touches?.[0]
                touchStartPosRef.current = pt ? { x: pt.clientX, y: pt.clientY } : { x: 0, y: 0 }
                longPressTimerRef.current = setTimeout(() => { longPressTimerRef.current = null; longPressFiredRef.current = true; setLongPressUserMsgIdx(idx) }, 450)
              } : undefined}
              onTouchMove={m.role === 'user' ? (e) => {
                const pt = e.touches?.[0]
                if (longPressTimerRef.current && touchStartPosRef.current && pt && Math.hypot(pt.clientX - touchStartPosRef.current.x, pt.clientY - touchStartPosRef.current.y) > 10) clearLongPress()
              } : undefined}
              onTouchEnd={m.role === 'user' ? (e) => {
                clearLongPress()
                if (longPressFiredRef.current) { e.preventDefault(); setTimeout(() => { longPressFiredRef.current = false }, 350) }
              } : undefined}
              onTouchCancel={m.role === 'user' ? () => { clearLongPress(); longPressFiredRef.current = false } : undefined}
            >
              <div className="dab-msg-header">
                <span data-testid={m.role === 'assistant' ? 'chat-msg-agent-author' : undefined}>
                  {m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : agentName}
                </span>
                {m.role === 'user' && (
                  <button
                    type="button"
                    data-testid={`copy-user-msg-btn-${idx}`}
                    data-copied={isUserCopied ? 'true' : 'false'}
                    className="dab-user-msg-copy-btn"
                    title={isUserCopied ? 'Copied!' : 'Copy message'}
                    aria-label="Copy message"
                    onClick={(e) => { e.stopPropagation(); handleCopyUserMsg(idx, m.text) }}
                  >
                    {isUserCopied ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Copy size={13} strokeWidth={1.75} aria-hidden="true" />}
                  </button>
                )}
                {m.dashboardId && (
                  <button
                    type="button"
                    className="dab-msg-pill"
                    onClick={() => openContentLinkTargetInViewer(ctl, { contentType: 'dashboard', id: String(m.dashboardId), embedPath: `/embed/dashboards/${encodeURIComponent(String(m.dashboardId))}` })}
                  >
                    Dashboard #{m.dashboardId}{typeof m.widgetCount === 'number' ? ` · ${m.widgetCount} queries` : ''}
                  </button>
                )}
              </div>
              {m.role === 'user' && longPressUserMsgIdx === idx && (
                <div data-testid={`user-msg-longpress-menu-${idx}`} role="menu" aria-label="Message actions" className="dab-user-msg-longpress-menu">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`user-msg-longpress-copy-${idx}`}
                    className="dab-composer-add-item"
                    onClick={(e) => { e.stopPropagation(); handleCopyUserMsg(idx, m.text) }}
                  >
                    <Copy size={13} strokeWidth={1.75} aria-hidden="true" /><span>Copy message</span>
                  </button>
                </div>
              )}
              {m.role === 'assistant' && (hasSteps || Boolean(m.interactionId)) && (
                <details
                  className="dab-thinking-block"
                  data-testid="completed-thinking-block"
                  onToggle={(e) => {
                    if ((e.currentTarget as HTMLDetailsElement).open && !hasSteps && m.interactionId) {
                      void hydrateMessageActivitySteps?.(m.interactionId, prevAssistantInteractionId)
                    }
                  }}
                >
                  <summary className="dab-thinking-summary">
                    <span className="dab-thinking-summary-label">
                      {hasSteps
                        ? `Thought for ${m.thinkingDurationSec ?? 1}s · ${m.activitySteps!.length} ${m.activitySteps!.length === 1 ? 'step' : 'steps'}`
                        : typeof m.thinkingDurationSec === 'number'
                        ? `Thought for ${m.thinkingDurationSec}s · Thinking & Activity`
                        : 'Thinking & Activity'}
                    </span>
                    {renderCopyTraceBtn(
                      `completed_${idx}`,
                      m.activitySteps || [],
                      { thinkingDurationSec: m.thinkingDurationSec ?? 1, userPrompt: prevUserMsg, assistantText: m.text },
                      m.interactionId,
                      prevAssistantInteractionId
                    )}
                  </summary>
                  {hasSteps ? (
                    <ThinkingStepsList steps={m.activitySteps!} contentCtx={contentCtx} />
                  ) : isHydratingTurn ? (
                    <div className="dab-thinking-step-loading" data-testid="thinking-hydration-loading">
                      <StudioSkeleton width="100%" height={28} />
                      <StudioSkeleton width="78%" height={24} />
                    </div>
                  ) : (
                    <div className="dab-thinking-steps"><span className="dab-muted">No recorded activity steps.</span></div>
                  )}
                </details>
              )}
              <div
                id={isLongUserMsg ? `user-msg-body-${idx}` : undefined}
                className={isLongUserMsg && !isExpanded ? 'dab-msg-body dab-msg-body-collapsed' : 'dab-msg-body'}
                data-collapsed={isLongUserMsg ? String(!isExpanded) : undefined}
                onScroll={isLongUserMsg && !isExpanded ? (e) => {
                  if (e.currentTarget.scrollTop > 0) { e.currentTarget.scrollTop = 0; setExpandedUserMsgIndices((prev) => Object.assign({}, prev, { [idx]: true })) }
                } : undefined}
                onClick={isLongUserMsg && !isExpanded ? (e) => {
                  if (longPressFiredRef.current || (typeof window !== 'undefined' && window.getSelection?.()?.toString())) return
                  if (!(e.target as HTMLElement | null)?.closest?.('a, button, :not(pre) > code, [role="menu"]')) setExpandedUserMsgIndices((prev) => Object.assign({}, prev, { [idx]: true }))
                } : undefined}
              >
                <StudioMarkdown
                  text={m.text} hostUrl={hostUrl} extensionSDK={extensionSDK}
                  onOpenContentInViewer={handleOpenContentLinkInViewer}
                  onOpenSandboxMarkdownFile={(p) => {
                    const normalized = normalizeSandboxFilePath(p)
                    setActiveSandboxMarkdownModalPath(normalized ? `/${normalized}` : p)
                    void openViewerDocument?.({ path: p })
                  }}
                  onInspectConnections={() => {
                    if (ctl.capabilities?.isAdmin) void openOrCopyMarkdownLink('/admin/connections', hostUrl, extensionSDK)
                    void fetchAvailableLookerConnectionsMarkdown(ctl.core40SDK).then((md) => {
                      ctl.setMessages((prev) => [...prev, { role: 'assistant', text: md }])
                    })
                  }}
                />
              </div>
              {isLongUserMsg && (
                <button
                  type="button" data-testid={`toggle-user-msg-expand-${idx}`} className="dab-user-msg-expand-btn"
                  aria-expanded={isExpanded} aria-controls={`user-msg-body-${idx}`}
                  onClick={(e) => { e.stopPropagation(); setExpandedUserMsgIndices((prev) => Object.assign({}, prev, { [idx]: !isExpanded })) }}
                >
                  {isExpanded ? <ChevronUp size={12} strokeWidth={1.75} aria-hidden="true" /> : <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />}
                  <span>{isExpanded ? 'Show less' : 'Show more'}</span>
                </button>
              )}
              {m.images && m.images.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {m.images.map((src, i) => {
                    const parsed = parseAttachmentDataUrl(src)
                    return parsed.isImage ? (
                      <img key={i} src={src} alt="Attached screenshot" style={{ maxHeight: 80, borderRadius: 4, border: '1px solid var(--dab-border)' }} />
                    ) : (
                      <span key={i} className="dab-chip" data-testid={`chat-attached-file-${i}`} title={parsed.name || `Attachment #${i + 1}`}>
                        <FileText size={12} strokeWidth={1.75} aria-hidden="true" />
                        <span>{parsed.name || `Attachment #${i + 1}`}</span>
                      </span>
                    )
                  })}
                </div>
              )}
              {m.role === 'assistant' && m.crudItems && m.crudItems.length > 0 && (
                <div className="dab-chat-object-chips dab-turn-crud-chips" data-testid="chat-object-viewer-chips">
                  {m.crudItems.map((item) => {
                    const isDeleted = item.action === 'deleted' || deletedCrudKeys.has(item.key)
                    return (
                      <button
                        key={`${item.key}:${item.action}`}
                        type="button"
                        disabled={isDeleted}
                        data-testid={`chat-object-viewer-chip-${item.key}`}
                        data-crud-action={item.action}
                        className={`dab-msg-pill dab-chat-object-chip ${!isDeleted && item.key === activeContentTabKey ? 'active' : ''} ${item.action === 'deleted' ? 'deleted' : ''}`}
                        onClick={() => {
                          if (isDeleted) return
                          setActiveViewerDocument?.(null); setRightPaneCollapsed(false)
                          const k = contentItems.some((c) => c.key === item.key)
                            ? item.key
                            : ctl.upsertContentItem({ id: item.id, contentType: item.contentType, title: item.title, embedPath: item.embedPath, hidden: false }, true).key
                          handleSelectContentTab?.(k)
                        }}
                      >
                        {renderContentTabIcon(item.contentType)}
                        <span>{item.title}</span>
                        <span className="dab-crud-action-label">{item.action}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {liveActivitySteps && liveActivitySteps.length > 0 && (
          <details className="dab-thinking-block dab-thinking-live" data-testid="live-thinking-block" open>
            <summary className="dab-thinking-summary">
              <span className="dab-spinner" />
              <span className="dab-thinking-summary-label">
                Thinking &amp; Activity · {liveActivitySteps[liveActivitySteps.length - 1]?.title || busyStatus || 'Working...'}
              </span>
              <span className="dab-thinking-step-count">{liveActivitySteps.length} {liveActivitySteps.length === 1 ? 'step' : 'steps'}</span>
              {renderCopyTraceBtn('live', liveActivitySteps)}
            </summary>
            <ThinkingStepsList steps={liveActivitySteps} contentCtx={contentCtx} />
          </details>
        )}

        {busyStatus && (!liveActivitySteps || liveActivitySteps.length === 0) && (
          <div className="dab-status-banner"><span className="dab-spinner" /><span>{busyStatus}</span></div>
        )}
      </div>

      {pendingPerm && (
        <div className="dab-permission-bar">
          <div>
            <strong>Approve Looker State Mutation?</strong> <code>{pendingPerm.req.operation}</code> (<code>{pendingPerm.req.httpMethod} {pendingPerm.req.path}</code>)
            {pendingPerm.req.thought && <div className="dab-permission-thought" data-testid="permission-request-thought">{pendingPerm.req.thought}</div>}
          </div>
          <div className="dab-permission-actions">
            <button type="button" className="dab-btn-primary" onClick={() => resolvePermDecision('allow_once')}>Allow once</button>
            <button type="button" className="dab-btn-secondary" onClick={() => resolvePermDecision('allow_op')}>Allow all &apos;{pendingPerm.req.operation}&apos; this turn</button>
            <button type="button" className="dab-btn-secondary" onClick={() => resolvePermDecision('allow_all')}>Allow all mutations this turn</button>
            <button type="button" className="dab-btn-secondary" onClick={() => resolvePermDecision('deny')}>Deny</button>
          </div>
        </div>
      )}

      <StudioComposer ctl={ctl} />
      <SandboxMarkdownPreviewModal ctl={ctl} />
      {!rightPaneCollapsed && (
        <div
          data-testid="workspace-split-resizer" role="separator" aria-orientation="vertical" aria-label="Resize chat and viewer panes"
          aria-valuenow={leftPaneWidth} aria-valuemin={MIN_LEFT_PANE_WIDTH} aria-valuemax={MAX_LEFT_PANE_WIDTH} tabIndex={0}
          className={`dab-split-resizer ${isResizingSplit ? 'active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const startWidth = leftPaneRef.current?.getBoundingClientRect().width || leftPaneWidth
            setIsResizingSplit(true)
            const onMove = (ev: MouseEvent) => setLeftPaneWidth(startWidth + (ev.clientX - startX))
            const onUp = () => {
              setIsResizingSplit(false)
              flushLeftPaneWidthSave?.()
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); setLeftPaneWidth((w) => w - 16) }
            else if (e.key === 'ArrowRight') { e.preventDefault(); setLeftPaneWidth((w) => w + 16) }
          }}
        />
      )}
    </aside>
  )
}
