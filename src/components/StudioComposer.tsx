import React, { useEffect, useMemo, useRef, useState } from 'react'

import {
  AtSign, BookOpen, Bug, Check, ChevronDown, CornerDownRight, Database, FileText, Folder,
  Loader2, PanelRightOpen, Paperclip, Pencil, Plus, Shield,
  Square, Wrench, X, Zap,
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
import { StudioButton, StudioSelect } from './StudioDesignSystem'
import {
  AT_MENTION_DETECT_RE, renderMentionCategoryIcon, SandboxMarkdownPreviewModal,
  SLASH_SKILL_DETECT_RE, StarterPromptButtons, UseCaseInfoModal, UseCaseInfoTrigger,
} from './StudioUseCaseGuides'

export const StudioComposer: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
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
    setFolderModalOpen, setEditingAgentName,
    messages, liveActivitySteps, copyThreadState, handleCopyThreadDebugTrace, activeConversationId,
  } = ctl

  const mockExt = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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
  const [slashDismissedAt, setSlashDismissedAt] = useState<string | null>(null)
  const [remoteSearchResults, setRemoteSearchResults] = useState<StudioContextMention[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const historyRef = useRef<{ convId?: string; idx: number | null; draft: string }>({ idx: null, draft: '' })
  const userHistory = useMemo(
    () => messages.filter((m) => m.role === 'user' && m.text.trim()).map((m) => m.text),
    [messages]
  )
  const selectedFolderLabel = folderTreeNodes?.[selectedFolderId]?.name || 'My folder'

  useEffect(() => { setCursorPos((prev) => Math.min(prev, prompt.length)) }, [prompt.length])
  const applyRecalledPrompt = (idx: number | null, text: string) => {
    historyRef.current.convId = activeConversationId
    historyRef.current.idx = idx
    setPrompt(text); setCursorPos(text.length)
    setSlashDismissedAt(text || null); setForceMentionCategory(null)
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(text.length, text.length))
  }

  const detectedMention = useMemo(() => {
    const uptoCursor = prompt.slice(0, cursorPos || prompt.length)
    const m = slashDismissedAt !== uptoCursor ? uptoCursor.match(AT_MENTION_DETECT_RE) : null
    if (m) {
      const category = (m[1]?.toLowerCase() as StudioContextCategory | undefined) || 'all'
      const query = (m[1] ? m[2] || '' : m[3] || '').trim()
      const atIdx = uptoCursor.lastIndexOf('@')
      return { open: true, category, query, tokenStart: atIdx >= 0 ? atIdx : uptoCursor.length, tokenEnd: uptoCursor.length }
    }
    return {
      open: forceMentionCategory !== null, category: forceMentionCategory ?? ('all' as const),
      query: '', tokenStart: prompt.length, tokenEnd: prompt.length,
    }
  }, [prompt, cursorPos, forceMentionCategory, slashDismissedAt])

  useEffect(() => {
    if (detectedMention.open && mentionMenuRef.current && typeof mockExt?.initialExploreScrollTop === 'number') {
      mentionMenuRef.current.scrollTop = mockExt.initialExploreScrollTop
    }
  }, [detectedMention.open, models.length, mockExt?.initialExploreScrollTop])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (addMenuWrapRef.current && !addMenuWrapRef.current.contains(e.target as Node)) setAddContextOpen(false)
      if (busyActionWrapRef.current && !busyActionWrapRef.current.contains(e.target as Node)) setBusyActionMenuOpen(false)
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node) && textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setForceMentionCategory(null)
      }
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node) && textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setSlashDismissedAt(prompt.slice(0, cursorPos || prompt.length))
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [cursorPos, prompt])

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

  const groupedExplores = useMemo(() => {
    const tokens = detectedMention.query.toLowerCase().split(/\s+/).filter(Boolean)
    return models
      .reduce(
        (acc: Array<{ label: string; modelName: string; options: Array<{ label: string; value: string; mention: StudioContextMention }> }>, model) => {
          if (model?.explores?.length) {
            const matchingExplores = model.explores.filter((explore) => {
              if (explore.hidden) return false
              if (tokens.length === 0) return true
              const expId = formatExploreId(model.name, String(explore.name))
              const haystack = `${model.label} ${model.name} ${explore.label || ''} ${explore.name} ${expId}`.toLowerCase()
              return tokens.every((tk) => haystack.includes(tk))
            })
            if (matchingExplores.length > 0) {
              acc.push({
                label: model.label || model.name,
                modelName: model.name,
                options: matchingExplores
                  .map((explore) => {
                    const value = formatExploreId(model.name, String(explore.name))
                    const label = String(explore.label || explore.name)
                    return {
                      label, value,
                      mention: {
                        type: 'explore' as const, id: value, title: label,
                        subtitle: String(model.label || model.name), model: model.name,
                        explore: String(explore.name), description: explore.description ? String(explore.description) : undefined,
                      },
                    }
                  })
                  .sort((a, b) => a.label.localeCompare(b.label)),
              })
            }
          }
          return acc
        },
        []
      )
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [models, detectedMention.query])

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

  const mentionOptions = useMemo(() => {
    const tokens = detectedMention.query.toLowerCase().split(/\s+/).filter(Boolean)
    const matchTokens = (text: string) => tokens.length === 0 || tokens.every((tk) => text.toLowerCase().includes(tk))
    const cat = detectedMention.category
    const seen = new Set<string>()
    const out: StudioContextMention[] = []
    const pushItem = (item: StudioContextMention) => {
      const key = `${item.type}:${item.id}`
      if (!seen.has(key)) { seen.add(key); out.push(item) }
    }
    if (cat === 'all' || cat === 'explore') {
      groupedExplores.forEach((group) => group.options.forEach((opt) => pushItem(opt.mention)))
      remoteSearchResults.forEach((r) => { if (r.type === 'explore') pushItem(r) })
    }
    ;(['dashboard', 'look'] as const).forEach((contentType) => {
      if (cat === 'all' || cat === contentType) {
        preloadedContent.forEach((item) => { if (item.type === contentType && matchTokens(`${item.title} ${item.id} ${item.description || ''}`)) pushItem(item) })
        remoteSearchResults.forEach((r) => { if (r.type === contentType) pushItem(r) })
      }
    })
    if (cat === 'all' || cat === 'conversation') {
      ;(allConversations || conversations || []).forEach((c) => {
        const label = c.label || c.id
        if (matchTokens(`${label} ${c.id} ${c.type || ''}`)) pushItem({ type: 'conversation', id: c.id, title: label, subtitle: c.use_case || c.type || 'conversation' })
      })
      remoteSearchResults.forEach((r) => { if (r.type === 'conversation') pushItem(r) })
    }
    return out
  }, [detectedMention.category, detectedMention.query, groupedExplores, preloadedContent, remoteSearchResults, allConversations, conversations])

  useEffect(() => { setActiveMentionIndex(0) }, [detectedMention.category, detectedMention.query, mentionOptions.length])

  const detectedSlashSkill = useMemo(() => {
    if (detectedMention.open) return { open: false, query: '', tokenStart: prompt.length, tokenEnd: prompt.length }
    const uptoCursor = prompt.slice(0, cursorPos || prompt.length)
    const m = uptoCursor.match(SLASH_SKILL_DETECT_RE)
    if (!m || slashDismissedAt === uptoCursor) return { open: false, query: '', tokenStart: prompt.length, tokenEnd: prompt.length }
    const slashIdx = uptoCursor.lastIndexOf('/')
    return { open: true, query: (m[1] || '').toLowerCase(), tokenStart: slashIdx >= 0 ? slashIdx : uptoCursor.length, tokenEnd: uptoCursor.length }
  }, [prompt, cursorPos, detectedMention.open, slashDismissedAt])

  const slashSkillOptions = useMemo(() => {
    const q = detectedSlashSkill.query.trim().toLowerCase()
    return q ? STUDIO_SLASH_SKILLS.filter((sk) => `${sk.id} ${sk.label} ${sk.desc}`.toLowerCase().includes(q)) : [...STUDIO_SLASH_SKILLS]
  }, [detectedSlashSkill.query])

  useEffect(() => { setActiveSlashIndex(0) }, [detectedSlashSkill.query, slashSkillOptions.length])

  const handleSelectSlashSkill = (sk: LookmlSkillCatalogEntry) => {
    setActivatedLookmlSkills((prev) => (prev.includes(sk.id) ? prev : [...prev, sk.id]))
    const prefix = prompt.slice(0, detectedSlashSkill.tokenStart)
    const head = `${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}/${sk.id} `
    setPrompt(`${head}${prompt.slice(detectedSlashSkill.tokenEnd)}`)
    setCursorPos(head.length); setSlashDismissedAt(null)
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(head.length, head.length) } })
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
    setMentionedItems((prev) => (prev.some((x) => x.type === item.type && x.id === item.id) ? prev : [...prev, item]))
    if (item.type === 'explore') setSelectedExplores((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
    const replacement = `@${item.type}:${item.title} `
    const prefix = prompt.slice(0, detectedMention.tokenStart)
    const suffix = prompt.slice(detectedMention.tokenEnd)
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
    const nextPrompt = `${prefix}${needsLeadingSpace ? ' ' : ''}${replacement}${suffix}`
    setPrompt(nextPrompt)
    const nextPos = (prefix + (needsLeadingSpace ? ' ' : '') + replacement).length
    setCursorPos(nextPos); setForceMentionCategory(null)
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(nextPos, nextPos) } })
  }

  const handleRemoveContextChip = (chip: StudioContextMention) => {
    setMentionedItems((prev) => prev.filter((x) => !(x.type === chip.type && x.id === chip.id)))
    if (chip.type === 'explore') setSelectedExplores((prev) => prev.filter((id) => id !== chip.id))
  }

  const handleInsertScopedPrefix = (category: StudioContextCategory) => {
    setAddContextOpen(false)
    const token = `@${category}:`
    const trimmed = prompt.replace(/\s+$/, '')
    const nextPrompt = trimmed ? `${trimmed} ${token}` : token
    setPrompt(nextPrompt); setCursorPos(nextPrompt.length); setForceMentionCategory(category)
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(nextPrompt.length, nextPrompt.length) } })
  }

  const activeGuideUseCase: StudioUseCase =
    isCaMode || caConversation ? 'conversational-analytics'
      : isHealthCheckMode ? 'health-check'
      : isLookmlMode ? 'lookml'
      : activeMode === 'tile' ? 'tile'
      : builderMode === 'dashboard' ? 'dashboard'
      : selectedUseCase || 'auto'
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => handleImageClipboardPaste(e, setPastedImages)

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
        {detectedSlashSkill.open && (
          <div ref={slashMenuRef} className="dab-at-mention-menu dab-dropdown" data-testid="composer-slash-skill-menu" role="listbox" aria-label="Studio slash skills">
            <div className="dab-at-mention-header">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Wrench size={12} strokeWidth={1.75} aria-hidden="true" /><span>Skills (/{detectedSlashSkill.query})</span>
              </span>
            </div>
            {slashSkillOptions.length === 0 ? (
              <div className="dab-option dab-muted">No matching skills</div>
            ) : (
              slashSkillOptions.map((sk, idx) => {
                const isSelected = activatedLookmlSkills.includes(sk.id)
                const isHighlighted = idx === activeSlashIndex
                return (
                  <div
                    key={sk.id} role="option" aria-selected={isSelected || isHighlighted} data-testid={`composer-slash-skill-option-${sk.id}`}
                    className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`}
                    style={{ gap: 8 }}
                    onMouseEnter={() => setActiveSlashIndex(idx)} onClick={(e) => { e.stopPropagation(); handleSelectSlashSkill(sk) }}
                    title={`${sk.desc} (${sk.path})`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                      <BookOpen size={13} strokeWidth={1.75} style={{ flexShrink: 0 }} aria-hidden="true" />
                      <code style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>/{sk.id}</code>
                      <span className="dab-muted dab-studio-menu-text" style={{ fontSize: 12 }}>{sk.desc}</span>
                    </span>
                    {isSelected && <Check size={13} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />}
                  </div>
                )
              })
            )}
          </div>
        )}

        {detectedMention.open && (
          <div ref={mentionMenuRef} className="dab-at-mention-menu dab-dropdown" data-testid="composer-at-mention-menu" role="listbox" aria-label="Looker context mentions">
            <div className="dab-at-mention-header">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <AtSign size={12} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  {detectedMention.category === 'all'
                    ? 'Mention Looker Context (@explore:, @dashboard:, @look:, @conversation:)'
                    : `Mention ${detectedMention.category} (@${detectedMention.category}:${detectedMention.query})`}
                </span>
              </span>
              {mentionLoading && (
                <span data-testid="composer-mention-loading" className="dab-at-mention-spinner" title="Searching Looker via global_search_v2...">
                  <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
                </span>
              )}
            </div>

            {selectedExplores.length > 0 && (detectedMention.category === 'all' || detectedMention.category === 'explore') && (
              <div
                className="dab-option" style={{ color: 'var(--dab-accent)', fontWeight: 600 }}
                onClick={(e) => { e.stopPropagation(); setSelectedExplores([]); setMentionedItems((prev) => prev.filter((x) => x.type !== 'explore')) }}
              >
                <span>Clear selection (let agent decide)</span>
              </div>
            )}

            {detectedMention.category === 'explore' && !remoteSearchResults.length ? (
              groupedExplores.length === 0 ? (
                <div className="dab-option dab-muted">No matching explores</div>
              ) : (
                groupedExplores.map((group) => (
                  <div key={group.modelName}>
                    <div className="dab-group-header">{group.label}</div>
                    {group.options.map((opt) => {
                      const isSelected = selectedExplores.includes(opt.value)
                      const flatIdx = mentionOptions.findIndex((m) => m.type === 'explore' && m.id === opt.value)
                      const isHighlighted = flatIdx === activeMentionIndex
                      return (
                        <div
                          key={opt.value} role="option" aria-selected={isSelected || isHighlighted}
                          data-testid={`composer-mention-option-explore-${opt.value}`}
                          className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`}
                          onMouseEnter={() => { if (flatIdx >= 0) setActiveMentionIndex(flatIdx) }}
                          onClick={(e) => { e.stopPropagation(); handleSelectMentionOption(opt.mention) }}
                          title={opt.value}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Database size={13} strokeWidth={1.75} aria-hidden="true" /><span>{opt.label}</span>
                          </span>
                          {isSelected && <Check size={13} strokeWidth={2} aria-hidden="true" />}
                        </div>
                      )
                    })}
                  </div>
                ))
              )
            ) : mentionOptions.length === 0 ? (
              <div className="dab-option dab-muted">{mentionLoading ? 'Searching Looker...' : 'No matching Looker items'}</div>
            ) : (
              mentionOptions.map((item, idx) => {
                const isSelected = (item.type === 'explore' && selectedExplores.includes(item.id)) || mentionedItems.some((m) => m.type === item.type && m.id === item.id)
                const isHighlighted = idx === activeMentionIndex
                return (
                  <div
                    key={`${item.type}:${item.id}`} role="option" aria-selected={isSelected || isHighlighted}
                    data-testid={`composer-mention-option-${item.type}-${item.id}`}
                    className={`dab-option ${isSelected || isHighlighted ? 'dab-option-selected' : ''}`}
                    onMouseEnter={() => setActiveMentionIndex(idx)}
                    onClick={(e) => { e.stopPropagation(); handleSelectMentionOption(item) }}
                    title={`${item.type}: ${item.title} (${item.id})`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                      {renderMentionCategoryIcon(item.type)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                      {item.subtitle && <span className="dab-muted" style={{ fontSize: 11 }}>· {item.subtitle}</span>}
                    </span>
                    <span className="dab-muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>
                      {isSelected ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : item.type}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}

        <textarea
          ref={textareaRef} rows={3} data-testid="studio-prompt-input"
          placeholder={
            isHealthCheckMode ? 'Optional custom focus for 3-Pillar Looker & BigQuery Health Check...'
              : isCaMode || selectedUseCase === 'conversational-analytics' ? 'Ask a natural-language data question for Looker Conversational Analytics...'
              : isLookmlMode ? 'Describe LookML changes, SQL query to model, or field descriptions/tests to run in your active dev mode...'
              : activeMode === 'tile' ? 'Describe the Script to generate or update (or paste a screenshot)...'
              : builderMode === 'dashboard' ? 'Describe a Looker UDD, Look, Board, or Schedule to create or update (type @ to mention context)...'
              : `Ask ${normalizeStudioAgentName(rawAgentName)} what you want to build, analyze, or automate (type @ to mention Explores, Dashboards, Looks, or Conversations)...`
          }
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value)
            setCursorPos(e.target.selectionStart ?? e.target.value.length)
            historyRef.current.idx = null
            if (forceMentionCategory !== null) setForceMentionCategory(null)
            if (slashDismissedAt !== null) setSlashDismissedAt(null)
          }}
          onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? prompt.length)}
          onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? prompt.length)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
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
            if (e.key === 'Escape' && detectedSlashSkill.open) { e.preventDefault(); setSlashDismissedAt(prompt.slice(0, cursorPos || prompt.length)); return }
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
            if (e.key === 'Escape' && detectedMention.open) { e.preventDefault(); setSlashDismissedAt(prompt.slice(0, cursorPos || prompt.length)); setForceMentionCategory(null); return }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
              const h = historyRef.current
              const curIdx = h.convId === activeConversationId && h.idx !== null && prompt === userHistory[h.idx] ? h.idx : null
              const selStart = e.currentTarget.selectionStart ?? prompt.length
              const selEnd = e.currentTarget.selectionEnd ?? selStart
              if (e.key === 'ArrowUp' && userHistory.length > 0 && !prompt.slice(0, selStart).includes('\n') && (curIdx !== null || !prompt.trim())) {
                e.preventDefault()
                if (curIdx === null) h.draft = prompt
                const nextIdx = curIdx === null ? userHistory.length - 1 : Math.max(0, curIdx - 1)
                applyRecalledPrompt(nextIdx, userHistory[nextIdx])
                return
              }
              if (e.key === 'ArrowDown' && curIdx !== null && !prompt.slice(selEnd).includes('\n')) {
                e.preventDefault()
                if (curIdx < userHistory.length - 1) applyRecalledPrompt(curIdx + 1, userHistory[curIdx + 1])
                else applyRecalledPrompt(null, h.draft)
                return
              }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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
