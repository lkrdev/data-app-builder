import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  Bug, Check, ChevronDown, CornerDownRight, FileText, Folder,
  Loader2, PanelRightOpen, Paperclip, Pencil, Plus, Shield,
  Square, X, Zap,
} from 'lucide-react'

import {
  fetchConversationSandboxDebugMarkdown, formatConversationThreadMarkdown,
  handleFileInputSelection, handleImageClipboardPaste,
  STUDIO_THINKING_LEVEL_OPTIONS, StudioThinkingLevel, StudioUseCase,
} from '../antigravity'
import {
  formatExploreId, normalizeStudioAgentName, StudioContextCategory, StudioContextMention,
} from '../lookerApi'
import { LookmlSkillCatalogEntry, STUDIO_SLASH_SKILLS } from '../lookmlTool'
export { fetchConversationSandboxDebugMarkdown, formatConversationThreadMarkdown }
import { StudioController } from '../useStudioController'
import {
  appendScopedPrefixToSegments, applyComposerBackspaceOrDelete, attachComposerElementCompat,
  buildGroupedExplores, buildMentionOptions, collectPillKeySet, ComposerHydrationContext,
  ComposerSegment, detectActiveMention, detectActiveSlashSkill, diffRemovedPills,
  getComposerSelectionOffsets, insertPlainTextAtSelection, parsePromptIntoSegments,
  readSegmentsFromDom, removeMentionPillFromSegments, renderSegmentsToDom, resolveHydratedPills,
  segmentsSignature, serializeComposerSegments, setComposerSelectionOffsets, sliceComposerPrompt,
  splicePillIntoSegments, stepComposerArrowAcrossPill,
} from './StudioComposerTokens'
import { StudioButton, StudioSelect } from './StudioDesignSystem'
import {
  ComposerAutocompleteMenus, renderMentionCategoryIcon, SandboxMarkdownPreviewModal,
  StarterPromptButtons, UseCaseInfoModal, UseCaseInfoTrigger,
} from './StudioUseCaseGuides'

export const StudioComposer: React.FC<{ ctl: StudioController; disabled?: boolean }> = ({ ctl, disabled = false }) => {
  const {
    core40SDK, agentName: rawAgentName, models, selectedExplores, setSelectedExplores,
    preloadedContent, mentionedItems, setMentionedItems, searchGlobalContentV2,
    allConversations, conversations, activeMode, builderMode, isLookmlMode,
    isHealthCheckMode, isCaMode, caConversation, selectedUseCase, selectedModel,
    setSelectedModel, thinkingLevel, thinkingLevelByModel, setModelThinkingLevel, defaultThinkingLevel, availableModels, busyStatus,
    activatedLookmlSkills, setActivatedLookmlSkills, pastedImages, setPastedImages,
    prompt, setPrompt, handleSendPrompt, queuedPrompts, busySendAction, setBusySendAction,
    handleStopTurn, handleQueuePrompt, handleRemoveQueuedPrompt, handleInterjectPrompt,
    isAuthenticated, authMode, clientId, oauthSigningIn, handleOAuthLogin, history,
    lookmlBundle, nativeContent, infoModalUseCase, setInfoModalUseCase,
    folderTreeNodes, selectedFolderId, requirePermission, setRequirePermission,
    setFolderModalOpen, setEditingAgentName, contentItems = [],
    messages, liveActivitySteps, copyThreadState, handleCopyThreadDebugTrace, activeConversationId,
  } = ctl

  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const addMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const busyActionWrapRef = useRef<HTMLDivElement | null>(null)
  const mentionMenuRef = useRef<HTMLDivElement | null>(null)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)

  const [addContextOpen, setAddContextOpen] = useState(false)
  const [busyActionMenuOpen, setBusyActionMenuOpen] = useState(false)
  const [cursorPos, setCursorPos] = useState<number>(() => prompt.length)
  const [forceMentionCategory, setForceMentionCategory] = useState<StudioContextCategory | 'all' | null>(
    () => (mockExt?.initialComboOpen ? 'explore' : null)
  )
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const [dismissedTriggerStart, setDismissedTriggerStart] = useState<number | null>(null)
  const [remoteSearchResults, setRemoteSearchResults] = useState<StudioContextMention[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const historyRef = useRef<{ convId?: string; idx: number | null; draft: string }>({ idx: null, draft: '' })
  const isDomInputRef = useRef(false)
  const prevExternalPromptRef = useRef(prompt)
  const prevPillKeysRef = useRef<Set<string>>(new Set())
  const userHistory = useMemo(
    () => messages.filter((m) => m.role === 'user' && m.text.trim()).map((m) => m.text),
    [messages]
  )
  const selectedFolderLabel = folderTreeNodes?.[selectedFolderId]?.name || 'My folder'

  const exploreLookup = useMemo(() => {
    const map: Record<string, { id: string; label: string; modelLabel: string; model: string; explore: string }> = {}
    models.forEach((model) => {
      ;(model.explores || []).forEach((explore) => {
        if (explore.hidden) return
        const id = formatExploreId(model.name, String(explore.name))
        map[id] = { id, label: String(explore.label || explore.name), modelLabel: String(model.label || model.name), model: model.name, explore: String(explore.name) }
      })
    })
    return map
  }, [models])

  const hydrationCtx = useMemo<ComposerHydrationContext>(
    () => ({ slashSkills: STUDIO_SLASH_SKILLS, mentionedItems, exploreLookup, selectedExplores, preloadedContent, contentItems, conversations: allConversations || conversations }),
    [mentionedItems, exploreLookup, selectedExplores, preloadedContent, contentItems, allConversations, conversations]
  )
  const hydrationCtxRef = useRef<ComposerHydrationContext>(hydrationCtx)
  hydrationCtxRef.current = hydrationCtx
  const recallAddedRef = useRef<{ slash: Set<string>; mentions: Set<string>; explores: Set<string> }>({
    slash: new Set(), mentions: new Set(), explores: new Set(),
  })
  const [segments, setSegments] = useState<ComposerSegment[]>(() => parsePromptIntoSegments(prompt, hydrationCtx))

  const bindEditorRef = (node: HTMLDivElement | null) => {
    editorRef.current = node
    if (node) attachComposerElementCompat(node, () => hydrationCtxRef.current)
  }

  const ensureHydratedPillsInState = useCallback((segs: readonly ComposerSegment[], trackForRecall = false) => {
    const { slashIds, mentions, exploreIds } = resolveHydratedPills(segs, hydrationCtxRef.current)
    const rc = recallAddedRef.current
    if (trackForRecall) {
      const pruneRecalled = (tracked: Set<string>, keep: Set<string>) => {
        const rm = Array.from(tracked).filter((k) => !keep.has(k))
        rm.forEach((k) => tracked.delete(k))
        return rm
      }
      const rmSlash = pruneRecalled(rc.slash, new Set(slashIds))
      const rmMentions = pruneRecalled(rc.mentions, new Set(mentions.map((m) => `${m.type}:${m.id}`)))
      const rmExplores = pruneRecalled(rc.explores, new Set(exploreIds))
      if (rmSlash.length) setActivatedLookmlSkills((prev) => prev.filter((id) => !rmSlash.includes(id)))
      if (rmMentions.length) { const s = new Set(rmMentions); setMentionedItems((prev) => prev.filter((x) => !s.has(`${x.type}:${x.id}`))) }
      if (rmExplores.length) setSelectedExplores((prev) => prev.filter((id) => !rmExplores.includes(id)))
    }
    if (slashIds.length) {
      setActivatedLookmlSkills((prev) => {
        const add = slashIds.filter((id) => !prev.includes(id))
        if (trackForRecall) add.forEach((id) => rc.slash.add(id))
        return add.length ? [...prev, ...add] : prev
      })
    }
    if (mentions.length) {
      setMentionedItems((prev) => {
        const add = mentions.filter((m) => !prev.some((x) => x.type === m.type && x.id === m.id))
        if (trackForRecall) add.forEach((m) => rc.mentions.add(`${m.type}:${m.id}`))
        return add.length ? [...prev, ...add] : prev
      })
    }
    if (exploreIds.length) {
      setSelectedExplores((prev) => {
        const add = exploreIds.filter((id) => !prev.includes(id))
        if (trackForRecall) add.forEach((id) => rc.explores.add(id))
        return add.length ? [...prev, ...add] : prev
      })
    }
  }, [setActivatedLookmlSkills, setMentionedItems, setSelectedExplores])

  const commitEditorSegments = (
    nextSegs: ComposerSegment[], nextPrompt: string, nextPos: number,
    opts?: { renderDom?: boolean; focusDom?: boolean; prune?: boolean }
  ) => {
    const el = editorRef.current
    if (el && opts?.renderDom) {
      renderSegmentsToDom(el, nextSegs)
      if (opts.focusDom) el.focus()
      setComposerSelectionOffsets(el, nextPos, nextPos)
    }
    if (opts?.prune) {
      const { nextKeys, removedSlash, removedMentions } = diffRemovedPills(prevPillKeysRef.current, nextSegs)
      prevPillKeysRef.current = nextKeys
      if (removedSlash.length > 0) setActivatedLookmlSkills((prev) => prev.filter((id) => !removedSlash.includes(id)))
      if (removedMentions.length > 0) {
        const rmSet = new Set(removedMentions)
        setMentionedItems((prev) => prev.filter((x) => !rmSet.has(`${x.type}:${x.id}`)))
        const rmExp = removedMentions.filter((m) => m.startsWith('explore:')).map((m) => m.slice(8))
        if (rmExp.length > 0) setSelectedExplores((prev) => prev.filter((id) => !rmExp.includes(id)))
      }
    } else {
      prevPillKeysRef.current = collectPillKeySet(nextSegs)
    }
    setDismissedTriggerStart((prev) => (prev !== null && nextPrompt[prev] !== '@' && nextPrompt[prev] !== '/' ? null : prev))
    isDomInputRef.current = true
    prevExternalPromptRef.current = nextPrompt
    setSegments(nextSegs); setPrompt(nextPrompt); setCursorPos(nextPos)
  }

  useEffect(() => {
    if (isDomInputRef.current) { isDomInputRef.current = false; return }
    const promptChangedExternally = prompt !== prevExternalPromptRef.current
    prevExternalPromptRef.current = prompt
    const hydrated = parsePromptIntoSegments(prompt, hydrationCtx)
    const nextKeys = collectPillKeySet(hydrated)
    if (promptChangedExternally) {
      recallAddedRef.current.slash.clear(); recallAddedRef.current.mentions.clear(); recallAddedRef.current.explores.clear()
    }
    if (promptChangedExternally ? nextKeys.size > 0 : Array.from(nextKeys).some((k) => !prevPillKeysRef.current.has(k))) {
      ensureHydratedPillsInState(hydrated, !promptChangedExternally && historyRef.current.idx !== null)
    }
    const el = editorRef.current
    prevPillKeysRef.current = nextKeys
    setSegments((prev) => (segmentsSignature(prev) === segmentsSignature(hydrated) ? prev : hydrated))
    if (promptChangedExternally) setCursorPos(prompt.length)
    if (el && (promptChangedExternally || segmentsSignature(readSegmentsFromDom(el)) !== segmentsSignature(hydrated))) {
      const hadFocus = document.activeElement === el
      const prevSel = !promptChangedExternally && hadFocus ? getComposerSelectionOffsets(el) : { start: prompt.length, end: prompt.length }
      renderSegmentsToDom(el, hydrated)
      setComposerSelectionOffsets(el, prevSel.start, prevSel.end, hadFocus || prompt.length === 0)
    }
  }, [prompt, hydrationCtx, ensureHydratedPillsInState])

  const applyRecalledPrompt = (idx: number | null, text: string) => {
    historyRef.current.convId = activeConversationId
    historyRef.current.idx = idx
    const hydrated = parsePromptIntoSegments(text, hydrationCtx)
    ensureHydratedPillsInState(hydrated, true)
    const rawMention = detectActiveMention(hydrated, text.length, null, null)
    const rawSlash = detectActiveSlashSkill(hydrated, text.length, null, rawMention.open)
    setDismissedTriggerStart(rawMention.open ? rawMention.tokenStart : rawSlash.open ? rawSlash.tokenStart : null)
    setForceMentionCategory(null)
    commitEditorSegments(hydrated, text, text.length, { renderDom: true, focusDom: true })
  }

  const detectedMention = useMemo(
    () => detectActiveMention(segments, cursorPos, dismissedTriggerStart, forceMentionCategory),
    [segments, cursorPos, forceMentionCategory, dismissedTriggerStart]
  )

  useEffect(() => {
    if (detectedMention.open && mentionMenuRef.current && typeof mockExt?.initialExploreScrollTop === 'number') {
      mentionMenuRef.current.scrollTop = mockExt.initialExploreScrollTop
    }
  }, [detectedMention.open, models.length, mockExt?.initialExploreScrollTop])

  useEffect(() => {
    if (!detectedMention.open || !detectedMention.query) {
      setMentionLoading(false); setRemoteSearchResults([])
      return
    }
    let cancelled = false
    setMentionLoading(true)
    const timer = setTimeout(() => {
      searchGlobalContentV2(core40SDK, { term: detectedMention.query, category: detectedMention.category, limit: 15 })
        .then((items) => { if (!cancelled) setRemoteSearchResults(items) })
        .catch(() => { if (!cancelled) setRemoteSearchResults([]) })
        .finally(() => { if (!cancelled) setMentionLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [core40SDK, detectedMention.open, detectedMention.query, detectedMention.category, searchGlobalContentV2])

  const groupedExplores = useMemo(
    () => buildGroupedExplores(models, detectedMention.query),
    [models, detectedMention.query]
  )

  const mentionOptions = useMemo(
    () => buildMentionOptions(detectedMention.category, detectedMention.query, groupedExplores, preloadedContent, remoteSearchResults, allConversations || conversations || []),
    [detectedMention.category, detectedMention.query, groupedExplores, preloadedContent, remoteSearchResults, allConversations, conversations]
  )

  useEffect(() => { setActiveMentionIndex(0) }, [detectedMention.category, detectedMention.query, mentionOptions.length])

  const detectedSlashSkill = useMemo(
    () => detectActiveSlashSkill(segments, cursorPos, dismissedTriggerStart, detectedMention.open),
    [segments, cursorPos, detectedMention.open, dismissedTriggerStart]
  )

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (addMenuWrapRef.current && !addMenuWrapRef.current.contains(e.target as Node)) setAddContextOpen(false)
      if (busyActionWrapRef.current && !busyActionWrapRef.current.contains(e.target as Node)) setBusyActionMenuOpen(false)
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node) && editorRef.current && !editorRef.current.contains(e.target as Node)) {
        setForceMentionCategory(null)
        setDismissedTriggerStart(detectedMention.tokenStart)
      }
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node) && editorRef.current && !editorRef.current.contains(e.target as Node)) {
        setDismissedTriggerStart(detectedSlashSkill.tokenStart)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [detectedMention.tokenStart, detectedSlashSkill.tokenStart])

  const slashSkillOptions = useMemo(() => {
    const q = detectedSlashSkill.query.trim().toLowerCase()
    return q ? STUDIO_SLASH_SKILLS.filter((sk) => `${sk.id} ${sk.label} ${sk.desc}`.toLowerCase().includes(q)) : [...STUDIO_SLASH_SKILLS]
  }, [detectedSlashSkill.query])

  useEffect(() => { setActiveSlashIndex(0) }, [detectedSlashSkill.query, slashSkillOptions.length])

  const handleSelectSlashSkill = (sk: LookmlSkillCatalogEntry) => {
    setActivatedLookmlSkills((prev) => (prev.includes(sk.id) ? prev : [...prev, sk.id]))
    const curSegs = editorRef.current ? readSegmentsFromDom(editorRef.current) : segments
    const res = splicePillIntoSegments(curSegs, detectedSlashSkill.tokenStart, detectedSlashSkill.tokenEnd, {
      pillKind: 'slash', tokenId: sk.id, label: sk.id, rawValue: `/${sk.id}`,
    })
    setDismissedTriggerStart(null); setForceMentionCategory(null)
    commitEditorSegments(res.segments, res.prompt, res.cursorPos, { renderDom: true, focusDom: true })
  }

  const contextChips = useMemo(() => {
    const seen = new Set<string>()
    const chips: StudioContextMention[] = []
    mentionedItems.forEach((item) => {
      const key = `${item.type}:${item.id}`
      if (!seen.has(key)) { seen.add(key); chips.push(item) }
    })
    selectedExplores.forEach((expId) => {
      const key = `explore:${expId}`
      if (!seen.has(key)) {
        seen.add(key)
        const info = exploreLookup[expId]
        chips.push({ type: 'explore', id: expId, title: info ? `${info.modelLabel}: ${info.label}` : expId, model: info?.model, explore: info?.explore })
      }
    })
    return chips
  }, [mentionedItems, selectedExplores, exploreLookup])

  const handleSelectMentionOption = (item: StudioContextMention) => {
    const cleanTitle = item.title.trim()
    const normalized = cleanTitle === item.title ? item : { ...item, title: cleanTitle }
    setMentionedItems((prev) => (prev.some((x) => x.type === normalized.type && x.id === normalized.id) ? prev : [...prev, normalized]))
    if (normalized.type === 'explore') setSelectedExplores((prev) => (prev.includes(normalized.id) ? prev : [...prev, normalized.id]))
    const curSegs = editorRef.current ? readSegmentsFromDom(editorRef.current) : segments
    const res = splicePillIntoSegments(curSegs, detectedMention.tokenStart, detectedMention.tokenEnd, {
      pillKind: 'mention', mentionType: normalized.type, tokenId: `${normalized.type}:${normalized.id}`, label: cleanTitle, rawValue: `@${normalized.type}:${cleanTitle}`,
    })
    setDismissedTriggerStart(null); setForceMentionCategory(null)
    commitEditorSegments(res.segments, res.prompt, res.cursorPos, { renderDom: true, focusDom: true })
  }

  const handleRemoveContextChip = (chip: StudioContextMention) => {
    setMentionedItems((prev) => prev.filter((x) => !(x.type === chip.type && x.id === chip.id)))
    if (chip.type === 'explore') setSelectedExplores((prev) => prev.filter((id) => id !== chip.id))
    const curSegs = editorRef.current ? readSegmentsFromDom(editorRef.current) : segments
    const stripped = removeMentionPillFromSegments(curSegs, `${chip.type}:${chip.id}`)
    if (stripped.changed) commitEditorSegments(stripped.segments, stripped.prompt, stripped.prompt.length, { renderDom: true })
  }

  const handleInsertScopedPrefix = (category: StudioContextCategory) => {
    setAddContextOpen(false)
    const curSegs = editorRef.current ? readSegmentsFromDom(editorRef.current) : segments
    const res = appendScopedPrefixToSegments(curSegs, category)
    setDismissedTriggerStart(null); setForceMentionCategory(category)
    commitEditorSegments(res.segments, res.prompt, res.cursorPos, { renderDom: true, focusDom: true })
  }

  const activeGuideUseCase: StudioUseCase =
    isCaMode || caConversation ? 'conversational-analytics'
      : isHealthCheckMode ? 'health-check'
      : isLookmlMode ? 'lookml'
      : activeMode === 'tile' ? 'tile'
      : builderMode === 'dashboard' ? 'dashboard'
      : selectedUseCase || 'auto'

  const placeholderText = isHealthCheckMode
    ? 'Optional custom focus for 3-Pillar Looker & BigQuery Health Check...'
    : isCaMode || selectedUseCase === 'conversational-analytics'
    ? 'Ask a natural-language data question for Looker Conversational Analytics...'
    : isLookmlMode
    ? 'Describe LookML changes, SQL query to model, or field descriptions/tests to run in your active dev mode...'
    : activeMode === 'tile'
    ? 'Describe the Script to generate or update (or paste a screenshot)...'
    : builderMode === 'dashboard'
    ? 'Describe a Looker UDD, Look, Board, or Schedule to create or update (type @ to mention context)...'
    : `Ask ${normalizeStudioAgentName(rawAgentName)} what you want to build, analyze, or automate (type @ to mention Explores, Dashboards, Looks, or Conversations)...`

  const insertEditorPlainText = (text: string) => {
    if (!editorRef.current) return
    const res = insertPlainTextAtSelection(editorRef.current, text)
    historyRef.current.idx = null
    if (forceMentionCategory !== null) setForceMentionCategory(null)
    commitEditorSegments(res.segments, res.prompt, res.cursorPos, { prune: res.removedPills.length > 0 })
  }

  const copyOrCutSelection = (e: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if ((cut && disabled) || !editorRef.current || !e.clipboardData) return
    const sel = getComposerSelectionOffsets(editorRef.current)
    if (sel.start === sel.end) return
    const curSegs = readSegmentsFromDom(editorRef.current)
    if (curSegs.some((s) => s.kind === 'pill' && s.end > sel.start && s.start < sel.end)) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', sliceComposerPrompt(curSegs, sel.start, sel.end))
      if (cut) insertEditorPlainText('')
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) { e.preventDefault(); return }
    handleImageClipboardPaste(e, setPastedImages)
    if (e.defaultPrevented || !editorRef.current) return
    const text = e.clipboardData?.getData('text/plain')
    if (text) { e.preventDefault(); insertEditorPlainText(text) }
  }

  return (
    <div
      className="dab-composer dab-chatbar"
      data-testid="chat-composer-dropzone"
      onDragOver={(e) => {
        if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault()
          handleFileInputSelection(e.dataTransfer.files, setPastedImages)
        }
      }}
    >
      <UseCaseInfoModal activeUseCase={infoModalUseCase} onSelectUseCase={setInfoModalUseCase} onClose={() => setInfoModalUseCase(null)} />

      {contextChips.length > 0 && (
        <div className="dab-composer-context-chips" data-testid="composer-context-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {contextChips.map((chip) => (
            <span key={`${chip.type}:${chip.id}`} className="dab-chip" data-testid={`composer-context-chip-${chip.type}-${chip.id}`} title={`${chip.type}: ${chip.id}`}>
              {renderMentionCategoryIcon(chip.type)}
              <span>@{chip.type}:{chip.title}</span>
              <button type="button" aria-label={`Remove ${chip.title}`} onClick={() => handleRemoveContextChip(chip)}>
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {pastedImages.length > 0 && (
        <div className="dab-composer-attached-files" data-testid="composer-attached-files" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {pastedImages.map((img, i) => {
            const isImage = img.mimeType.startsWith('image/')
            return (
              <div key={img.id || i} className="dab-attached-file-pill" data-testid={`attached-file-chip-${i}`} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                {isImage ? (
                  <img src={img.dataUrl} alt={img.name || 'Attached image'} style={{ height: 52, borderRadius: 4, border: '1px solid var(--dab-border)' }} />
                ) : (
                  <span className="dab-chip" title={img.name || 'Attached file'}>
                    <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
                    <span>{img.name || `Attachment ${i + 1}`}</span>
                  </span>
                )}
                <button
                  type="button" aria-label={`Remove ${img.name || 'attachment'}`}
                  onClick={() => setPastedImages((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    position: isImage ? 'absolute' : 'static', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%',
                    border: 'none', background: '#0f172a', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px',
                    padding: 0, marginLeft: isImage ? 0 : 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={11} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {queuedPrompts.length > 0 && (
        <div className="dab-queued-prompts-bar" data-testid="queued-prompts-bar" role="region" aria-label="Queued prompts">
          {queuedPrompts.map((q) => (
            <div key={q.id} className="dab-queued-prompt-item" data-testid="queued-prompt-item">
              <CornerDownRight size={12} strokeWidth={1.75} aria-hidden="true" className="dab-queued-prompt-icon" />
              <span className="dab-queued-prompt-text" title={q.text}>{q.text || `${q.images.length} attachment(s)`}</span>
              <div className="dab-queued-prompt-actions">
                <button
                  type="button" className="dab-btn-secondary dab-queued-prompt-interject-btn"
                  data-testid={`queued-prompt-interject-${q.id}`} onClick={() => handleInterjectPrompt(q.id)}
                  title="Abort current turn and send this queued message immediately"
                >
                  <Zap size={11} strokeWidth={1.75} aria-hidden="true" /><span>Interject</span>
                </button>
                <button
                  type="button" className="dab-queued-prompt-remove-btn" data-testid={`queued-prompt-remove-${q.id}`}
                  onClick={() => handleRemoveQueuedPrompt(q.id)} aria-label="Remove queued message" title="Remove from queue"
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dab-composer-input-wrap" style={{ position: 'relative' }}>
        <ComposerAutocompleteMenus
          slashMenuRef={slashMenuRef} mentionMenuRef={mentionMenuRef}
          detectedSlashSkill={detectedSlashSkill} slashSkillOptions={slashSkillOptions}
          activatedLookmlSkills={activatedLookmlSkills} activeSlashIndex={activeSlashIndex}
          setActiveSlashIndex={setActiveSlashIndex} onSelectSlashSkill={handleSelectSlashSkill}
          detectedMention={detectedMention} mentionLoading={mentionLoading}
          selectedExplores={selectedExplores} mentionedItems={mentionedItems}
          remoteSearchResults={remoteSearchResults} groupedExplores={groupedExplores}
          mentionOptions={mentionOptions} activeMentionIndex={activeMentionIndex}
          setActiveMentionIndex={setActiveMentionIndex} onSelectMentionOption={handleSelectMentionOption}
          onClearExplores={() => {
            setSelectedExplores([])
            setMentionedItems((prev) => prev.filter((x) => x.type !== 'explore'))
            const curSegs = editorRef.current ? readSegmentsFromDom(editorRef.current) : segments
            const stripped = removeMentionPillFromSegments(curSegs, 'explore:*')
            if (stripped.changed) commitEditorSegments(stripped.segments, stripped.prompt, stripped.prompt.length, { renderDom: true })
          }}
        />

        <div
          ref={bindEditorRef}
          className="dab-composer-editor"
          data-testid="studio-prompt-input"
          role="textbox"
          aria-multiline="true"
          aria-label={placeholderText}
          aria-disabled={disabled ? 'true' : undefined}
          tabIndex={disabled ? -1 : 0}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={placeholderText}
          data-empty={prompt.length === 0 ? 'true' : 'false'}
          {...({ placeholder: placeholderText } as React.HTMLAttributes<HTMLDivElement>)}
          onInput={() => {
            const el = editorRef.current
            if (!el || disabled) return
            const domSegs = readSegmentsFromDom(el)
            const domPrompt = serializeComposerSegments(domSegs)
            const sel = getComposerSelectionOffsets(el)
            historyRef.current.idx = null
            if (forceMentionCategory !== null) setForceMentionCategory(null)
            const prevKeys = prevPillKeysRef.current
            if (Array.from(collectPillKeySet(domSegs)).some((k) => !prevKeys.has(k))) ensureHydratedPillsInState(domSegs, false)
            commitEditorSegments(domSegs, domPrompt, sel.end, { prune: true })
          }}
          onClick={() => { if (editorRef.current) setCursorPos(getComposerSelectionOffsets(editorRef.current).end) }}
          onKeyUp={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') return
            if (editorRef.current) setCursorPos(getComposerSelectionOffsets(editorRef.current).end)
          }}
          onCopy={(e) => copyOrCutSelection(e, false)}
          onCut={(e) => copyOrCutSelection(e, true)}
          onDrop={(e) => {
            if (e.dataTransfer?.files?.length) return
            e.preventDefault()
            if (disabled) return
            const text = e.dataTransfer?.getData('text/plain')
            if (text) insertEditorPlainText(text)
          }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (disabled) { e.preventDefault(); return }
            if (detectedSlashSkill.open && slashSkillOptions.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSlashIndex((i) => (i + 1) % slashSkillOptions.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSlashIndex((i) => (i - 1 + slashSkillOptions.length) % slashSkillOptions.length); return }
              if ((e.key === 'Enter' || e.key === 'Tab') && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                const picked = slashSkillOptions[activeSlashIndex] || slashSkillOptions[0]
                if (picked) handleSelectSlashSkill(picked)
                return
              }
            }
            if (e.key === 'Escape' && detectedSlashSkill.open) { e.preventDefault(); setDismissedTriggerStart(detectedSlashSkill.tokenStart); return }
            if (detectedMention.open && mentionOptions.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveMentionIndex((i) => (i + 1) % mentionOptions.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length); return }
              if ((e.key === 'Enter' || e.key === 'Tab') && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                const picked = mentionOptions[activeMentionIndex] || mentionOptions[0]
                if (picked) handleSelectMentionOption(picked)
                return
              }
            }
            if (e.key === 'Escape' && detectedMention.open) { e.preventDefault(); setDismissedTriggerStart(detectedMention.tokenStart); setForceMentionCategory(null); return }
            if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
              const curSegs = editorRef.current ? readSegmentsFromDom(editorRef.current) : segments
              const sel = editorRef.current ? getComposerSelectionOffsets(editorRef.current) : { start: cursorPos, end: cursorPos }
              const res = applyComposerBackspaceOrDelete(curSegs, sel.start, sel.end, e.key)
              if (res) {
                e.preventDefault()
                historyRef.current.idx = null
                if (forceMentionCategory !== null) setForceMentionCategory(null)
                commitEditorSegments(res.segments, res.prompt, res.cursorPos, { renderDom: true, prune: true })
                return
              }
            }
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && editorRef.current) {
              const curSegs = readSegmentsFromDom(editorRef.current)
              const sel = getComposerSelectionOffsets(editorRef.current)
              const hopped = stepComposerArrowAcrossPill(curSegs, sel.start, sel.end, e.key)
              if (hopped !== null) {
                e.preventDefault()
                setComposerSelectionOffsets(editorRef.current, hopped, hopped)
                setCursorPos(hopped)
                return
              }
            }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
              const h = historyRef.current
              const curIdx = h.convId === activeConversationId && h.idx !== null && prompt === userHistory[h.idx] ? h.idx : null
              const sel = editorRef.current ? getComposerSelectionOffsets(editorRef.current) : { start: prompt.length, end: prompt.length }
              if (e.key === 'ArrowUp' && userHistory.length > 0 && !prompt.slice(0, sel.start).includes('\n') && (curIdx !== null || !prompt.trim())) {
                e.preventDefault()
                if (curIdx === null) h.draft = prompt
                const nextIdx = curIdx === null ? userHistory.length - 1 : Math.max(0, curIdx - 1)
                applyRecalledPrompt(nextIdx, userHistory[nextIdx])
                return
              }
              if (e.key === 'ArrowDown' && curIdx !== null && !prompt.slice(sel.end).includes('\n')) {
                e.preventDefault()
                if (curIdx < userHistory.length - 1) applyRecalledPrompt(curIdx + 1, userHistory[curIdx + 1])
                else applyRecalledPrompt(null, h.draft)
                return
              }
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              if (e.shiftKey && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); insertEditorPlainText('\n'); return }
              e.preventDefault()
              if (busyStatus) {
                if (busySendAction === 'interject') void handleInterjectPrompt()
                else handleQueuePrompt()
              } else {
                void handleSendPrompt()
              }
            }
          }}
        />
      </div>

      <input
        ref={fileInputRef} type="file" multiple data-testid="composer-file-input"
        accept="image/*,application/pdf,.csv,.tsv,.json,.sql,.lkml,.lookml,.md,.py,.js,.ts,.tsx,.txt"
        style={{ display: 'none' }}
        onChange={(e) => { handleFileInputSelection(e.target.files, setPastedImages); e.target.value = '' }}
      />

      <div className="dab-composer-actions">
        <div className="dab-composer-add-wrap" ref={addMenuWrapRef} style={{ position: 'relative' }}>
          <button
            type="button" data-testid="composer-add-context-btn" className="dab-btn-secondary dab-composer-add-btn"
            onClick={() => setAddContextOpen((prev) => !prev)}
            title="Add files or @-mention Looker Explores, Dashboards, Looks, or Conversations"
            aria-label="Add Context" aria-expanded={addContextOpen}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>

          {addContextOpen && (
            <div className="dab-composer-add-menu" data-testid="composer-add-context-menu" role="menu" aria-label="Add Context">
              <button
                type="button" role="menuitem" data-testid="add-context-files" className="dab-composer-add-item"
                onClick={() => { setAddContextOpen(false); fileInputRef.current?.click() }}
              >
                <Paperclip size={13} strokeWidth={1.75} aria-hidden="true" /><span>Files</span>
              </button>
              {([
                ['explore', 'Explores', 'add-context-explores'],
                ['dashboard', 'Dashboards', 'add-context-dashboards'],
                ['look', 'Looks', 'add-context-looks'],
                ['conversation', 'Conversations', 'add-context-conversations'],
              ] as const).map(([cat, label, testId]) => (
                <button key={cat} type="button" role="menuitem" data-testid={testId} className="dab-composer-add-item" onClick={() => handleInsertScopedPrefix(cat)}>
                  {renderMentionCategoryIcon(cat)}<span>{label}</span>
                </button>
              ))}
              <button type="button" role="menuitem" data-testid="mobile-menu-folder-btn" className="dab-composer-add-item dab-mobile-only-menu-item" onClick={() => { setAddContextOpen(false); setFolderModalOpen(true) }}>
                <Folder size={13} strokeWidth={1.75} aria-hidden="true" /><span>Folder: {selectedFolderLabel}</span>
              </button>
              <button type="button" role="menuitem" data-testid="mobile-menu-approval-btn" className="dab-composer-add-item dab-mobile-only-menu-item" onClick={() => { setRequirePermission((prev) => !prev); setAddContextOpen(false) }}>
                {requirePermission ? <Shield size={13} strokeWidth={1.75} aria-hidden="true" /> : <Zap size={13} strokeWidth={1.75} aria-hidden="true" />}
                <span>Approval: {requirePermission ? 'Safe Mode (Ask)' : 'Auto-Approve (YOLO)'}</span>
              </button>
              <button type="button" role="menuitem" data-testid="mobile-menu-edit-agent-name-btn" className="dab-composer-add-item dab-mobile-only-menu-item" onClick={() => { setAddContextOpen(false); setEditingAgentName(true) }}>
                <Pencil size={13} strokeWidth={1.75} aria-hidden="true" /><span>Rename {normalizeStudioAgentName(rawAgentName)}...</span>
              </button>
              {(messages.length > 0 || (liveActivitySteps?.length ?? 0) > 0) && (
                <>
                  <button
                    type="button" role="menuitem" data-testid="mobile-menu-overview-btn"
                    className="dab-composer-add-item dab-mobile-only-menu-item"
                    onClick={() => { setAddContextOpen(false); ctl.handleSelectOverview(); ctl.setRightPaneCollapsed(false) }}
                  >
                    <PanelRightOpen size={13} strokeWidth={1.75} aria-hidden="true" /><span>Overview</span>
                  </button>
                  <button
                    type="button" role="menuitem" data-testid="mobile-menu-copy-thread-btn"
                    className="dab-composer-add-item dab-mobile-only-menu-item"
                    onClick={() => { setAddContextOpen(false); void handleCopyThreadDebugTrace() }}
                  >
                    {copyThreadState === 'loading' ? (
                      <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
                    ) : copyThreadState === 'copied' ? (
                      <Check size={13} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Bug size={13} strokeWidth={1.75} aria-hidden="true" />
                    )}
                    <span>{copyThreadState === 'loading' ? 'Copying Thread…' : copyThreadState === 'copied' ? 'Copied Thread' : 'Copy Thread'}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <StudioSelect
          data-testid="composer-model-select" testId="composer-model-select" className="dab-composer-model-select"
          value={selectedModel} onChange={setSelectedModel} disabled={!!busyStatus}
          ariaLabel="Select Antigravity model" title="Select Antigravity model for this turn (/v1beta/models)"
          options={availableModels.map((m) => ({
            value: m.id, label: m.label, title: m.description,
            subMenu: {
              value: thinkingLevelByModel?.[m.id] || defaultThinkingLevel || thinkingLevel,
              options: STUDIO_THINKING_LEVEL_OPTIONS,
              onChange: (lvl) => setModelThinkingLevel(m.id, lvl as StudioThinkingLevel),
              testId: 'composer-thinking-level-menu',
            },
          }))}
        />

        <UseCaseInfoTrigger useCase={activeGuideUseCase} onOpen={setInfoModalUseCase} />

        <div className="dab-composer-send-group" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' }}>
          {!isAuthenticated && !busyStatus && (
            <button
              type="button" data-testid="composer-signin-inline-btn" className="dab-inline-signin-btn"
              onClick={() => (authMode === 'oauth' && clientId.trim() ? handleOAuthLogin() : history.push('/config'))}
            >
              {authMode === 'oauth' && clientId.trim() ? (oauthSigningIn ? 'Signing in… (click to retry)' : 'Sign in to send') : 'Configure credentials to send'}
            </button>
          )}
          {busyStatus ? (
            <>
              <div className="dab-split-action-group" data-testid="studio-busy-action-group" ref={busyActionWrapRef}>
                <StudioButton
                  variant="secondary"
                  testId={busySendAction === 'interject' ? 'studio-interject-btn' : 'studio-queue-btn'}
                  className="dab-split-action-main"
                  onClick={() => (busySendAction === 'interject' ? void handleInterjectPrompt() : handleQueuePrompt())}
                  disabled={(busySendAction === 'interject' && !isAuthenticated) || (!prompt.trim() && pastedImages.length === 0)}
                  title={busySendAction === 'interject' ? 'Interrupt the running turn and send this message immediately (Cmd/Ctrl+Enter)' : 'Queue message to run automatically when the current turn finishes (Cmd/Ctrl+Enter)'}
                >
                  {busySendAction === 'interject' ? <Zap size={13} strokeWidth={1.75} aria-hidden="true" /> : <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" />}
                  <span>{busySendAction === 'interject' ? 'Interject' : 'Queue'}</span>
                </StudioButton>
                <button
                  type="button" data-testid="studio-busy-action-menu-trigger" className="dab-btn dab-btn-secondary dab-split-action-caret"
                  onClick={() => setBusyActionMenuOpen((prev) => !prev)}
                  title="Change send action while turn is running" aria-label="Change send action while turn is running" aria-expanded={busyActionMenuOpen}
                >
                  <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
                {busyActionMenuOpen && (
                  <div className="dab-split-action-menu" data-testid="studio-busy-action-menu" role="menu" aria-label="Send action while turn is running">
                    {([['queue', 'Queue', CornerDownRight], ['interject', 'Interject', Zap]] as const).map(([act, lbl, Icon]) => (
                      <button
                        key={act} type="button" role="menuitemradio" aria-checked={busySendAction === act}
                        data-testid={`studio-busy-action-option-${act}`}
                        className={`dab-split-action-option ${busySendAction === act ? 'selected' : ''}`}
                        onClick={() => { setBusySendAction(act); setBusyActionMenuOpen(false) }}
                      >
                        <Icon size={13} strokeWidth={1.75} aria-hidden="true" /><span>{lbl}</span>
                        {busySendAction === act && <Check size={12} strokeWidth={2} aria-hidden="true" style={{ marginLeft: 'auto' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <StudioButton variant="danger" testId="studio-stop-btn" onClick={handleStopTurn} title="Stop current turn">
                <Square size={12} strokeWidth={2} aria-hidden="true" /><span>Stop</span>
              </StudioButton>
            </>
          ) : (
            <StudioButton variant="gemini" testId="studio-send-btn" onClick={handleSendPrompt} disabled={!isAuthenticated || (!prompt.trim() && pastedImages.length === 0)}>
              {isCaMode || selectedUseCase === 'conversational-analytics'
                ? (caConversation ? 'Ask CA Agent' : 'Route & Start CA Chat')
                : isLookmlMode ? (lookmlBundle ? 'Update LookML' : 'Run Agentic LookML')
                : activeMode === 'tile' ? 'Ask AI'
                : builderMode === 'dashboard' ? (nativeContent ? 'Update Content' : 'Create / Update Content')
                : 'Send Message'}
            </StudioButton>
          )}
        </div>
      </div>
    </div>
  )
}

export const StudioCenteredEmptyStage: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const { agentName: rawAgentName, activeMode, builderMode, isLookmlMode, isHealthCheckMode, selectedUseCase, selectedExplores, starterPrompts, starterPromptsLoading, setPrompt, busyStatus } = ctl
  const agentName = normalizeStudioAgentName(rawAgentName)
  return (
    <main className="dab-empty-stage-centered" data-testid="centered-empty-prompt">
      <div className="dab-empty-prompt-card" data-testid="studio-empty-stage">
        <div className="dab-empty-hero">
          <h2>
            {isHealthCheckMode ? 'Run a 3-Pillar Looker & BigQuery Health Check'
              : isLookmlMode ? 'Author & Validate Agentic LookML'
              : activeMode === 'tile' ? 'Author & Schedule a Looker Script'
              : builderMode === 'dashboard' ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
              : `${agentName} is ready`}
          </h2>
          <p className="dab-muted">
            {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
          </p>
          <StarterPromptButtons useCase={selectedUseCase} prompts={starterPrompts} loading={starterPromptsLoading} onSelect={setPrompt} disabled={!!busyStatus} />
        </div>
        <StudioComposer ctl={ctl} />
        <SandboxMarkdownPreviewModal ctl={ctl} />
      </div>
    </main>
  )
}
