import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  appendScopedPrefixToSegments,
  applyComposerBackspaceOrDelete,
  ComposerHydrationContext,
  detectActiveMention,
  detectActiveSlashSkill,
  diffRemovedPills,
  getActivePlainTextRun,
  parsePromptIntoSegments,
  removeMentionPillFromSegments,
  replaceSegmentRange,
  resolveHydratedPills,
  serializeComposerSegments,
  sliceComposerPrompt,
  splicePillIntoSegments,
  stepComposerArrowAcrossPill,
} from '../../components/StudioComposerTokens'
import { extractSlashSkillIds, STUDIO_SLASH_SKILLS } from '../../lookmlSkills'

export function registerPermissionsPart24Tests(): void {
  test('88. Issue #223: hydrates & serializes /slash and @mention inline pill tokens, scopes detection to plain-text run after last pill, and executes 2-step whole-pill Backspace & Delete', () => {
    const hydrationCtx: ComposerHydrationContext = {
      slashSkills: STUDIO_SLASH_SKILLS,
      mentionedItems: [
        {
          type: 'dashboard',
          id: '902',
          title: 'Halloween Sales Drop — KDA Investigation',
          description: 'Holiday sales root-cause investigation',
        },
        {
          type: 'look',
          id: '301',
          title: 'Monthly Order Margin Look',
        },
      ],
      exploreLookup: {
        'thelook::order_items': {
          id: 'thelook::order_items',
          label: 'Order Items',
          modelLabel: 'eCommerce',
          model: 'thelook',
          explore: 'order_items',
        },
      },
      selectedExplores: ['thelook::order_items'],
    }

    // 1. Canonical hydration & round-trip serialization (URLs and partial /lookml remain plain text)
    const rawPrompt =
      '/lookml-tests Compare @dashboard:Halloween Sales Drop — KDA Investigation with @explore:thelook::order_items and https://docs.example.com/lookml-tests plus /lookml draft'
    const hydrated = parsePromptIntoSegments(rawPrompt, hydrationCtx)
    expect(serializeComposerSegments(hydrated)).toBe(rawPrompt)

    const pills = hydrated.filter((s) => s.kind === 'pill')
    expect(pills.map((p) => ({ kind: p.pillKind, id: p.tokenId, label: p.label, raw: p.rawValue }))).toEqual([
      { kind: 'slash', id: 'lookml-tests', label: 'lookml-tests', raw: '/lookml-tests' },
      {
        kind: 'mention',
        id: 'dashboard:902',
        label: 'Halloween Sales Drop — KDA Investigation',
        raw: '@dashboard:Halloween Sales Drop — KDA Investigation',
      },
      {
        kind: 'mention',
        id: 'explore:thelook::order_items',
        label: 'Order Items',
        raw: '@explore:thelook::order_items',
      },
    ])
    expect(extractSlashSkillIds(serializeComposerSegments(hydrated))).toEqual(['lookml-tests'])

    // 2. Selecting a multi-word @mention splices atomic pill + auto-space and closes detection immediately
    const typingMention = parsePromptIntoSegments('Analyze @dashboard:Halloween', hydrationCtx)
    const beforePick = detectActiveMention(typingMention, 'Analyze @dashboard:Halloween'.length, null, null)
    expect(beforePick).toEqual({
      open: true,
      category: 'dashboard',
      query: 'Halloween',
      tokenStart: 8,
      tokenEnd: 'Analyze @dashboard:Halloween'.length,
    })

    const picked = splicePillIntoSegments(typingMention, beforePick.tokenStart, beforePick.tokenEnd, {
      pillKind: 'mention',
      mentionType: 'dashboard',
      tokenId: 'dashboard:902',
      label: 'Halloween Sales Drop — KDA Investigation',
      rawValue: '@dashboard:Halloween Sales Drop — KDA Investigation',
    })
    expect(picked.prompt).toBe('Analyze @dashboard:Halloween Sales Drop — KDA Investigation ')
    expect(picked.cursorPos).toBe(picked.prompt.length)

    // Immediately after selection (and while typing normal words after pill), active plain-text run starts AFTER the pill
    const runAfterPick = getActivePlainTextRun(picked.segments, picked.cursorPos)
    expect(runAfterPick.text).toBe(' ')
    expect(detectActiveMention(picked.segments, picked.cursorPos, null, null).open).toBe(false)

    // Appending normal multi-word text after the pill NEVER reopens @mention across the committed pill
    const afterNormalTyping = parsePromptIntoSegments(
      'Analyze @dashboard:Halloween Sales Drop — KDA Investigation by region and margin',
      hydrationCtx
    )
    expect(detectActiveMention(afterNormalTyping, afterNormalTyping[afterNormalTyping.length - 1].end, null, null).open).toBe(false)
    expect(detectActiveSlashSkill(afterNormalTyping, afterNormalTyping[afterNormalTyping.length - 1].end, null, false).open).toBe(false)

    // Typing a fresh @ or / after the pill DOES open detection scoped strictly to the trailing plain-text run
    const withFreshSlash = parsePromptIntoSegments(
      'Analyze @dashboard:Halloween Sales Drop — KDA Investigation /lookml',
      hydrationCtx
    )
    const slashState = detectActiveSlashSkill(withFreshSlash, withFreshSlash[withFreshSlash.length - 1].end, null, false)
    expect(slashState).toEqual({
      open: true,
      query: 'lookml',
      tokenStart: 'Analyze @dashboard:Halloween Sales Drop — KDA Investigation '.length,
      tokenEnd: 'Analyze @dashboard:Halloween Sales Drop — KDA Investigation /lookml'.length,
    })

    const withFreshMention = appendScopedPrefixToSegments(picked.segments, 'look')
    expect(withFreshMention.prompt).toBe('Analyze @dashboard:Halloween Sales Drop — KDA Investigation @look:')
    const freshMentionState = detectActiveMention(withFreshMention.segments, withFreshMention.cursorPos, null, null)
    expect(freshMentionState).toEqual({
      open: true,
      category: 'look',
      query: '',
      tokenStart: 'Analyze @dashboard:Halloween Sales Drop — KDA Investigation '.length,
      tokenEnd: withFreshMention.prompt.length,
    })

    // 3. Two-step Backspace & forward Delete around atomic pills + duplicate-pill retention
    // Normal multi-char plain text returns null so browser handles normal typing/editing
    expect(
      applyComposerBackspaceOrDelete(
        afterNormalTyping,
        afterNormalTyping[afterNormalTyping.length - 1].end,
        afterNormalTyping[afterNormalTyping.length - 1].end,
        'Backspace'
      )
    ).toBeNull()

    // Right after selection (`[pill] |`), Backspace #1 removes ONLY the trailing `" "` (`[pill]|`, removedPills: [])
    const bs1 = applyComposerBackspaceOrDelete(picked.segments, picked.cursorPos, picked.cursorPos, 'Backspace')
    expect(bs1).not.toBeNull()
    expect(bs1?.prompt).toBe('Analyze @dashboard:Halloween Sales Drop — KDA Investigation')
    expect(bs1?.removedPills).toEqual([])

    // Backspace #2 (`[pill]|`) deletes the entire atomic pill in one keystroke
    const bs2 = applyComposerBackspaceOrDelete(bs1!.segments, bs1!.cursorPos, bs1!.cursorPos, 'Backspace')
    expect(bs2).not.toBeNull()
    expect(bs2?.prompt).toBe('Analyze ')
    expect(bs2?.cursorPos).toBe('Analyze '.length)
    expect(bs2?.removedPills.map((p) => p.tokenId)).toEqual(['dashboard:902'])

    // Forward Delete immediately before a pill deletes the whole pill atomically
    const delBeforePill = applyComposerBackspaceOrDelete(picked.segments, 8, 8, 'Delete')
    expect(delBeforePill?.prompt).toBe('Analyze  ')
    expect(delBeforePill?.cursorPos).toBe(8)
    expect(delBeforePill?.removedPills.map((p) => p.tokenId)).toEqual(['dashboard:902'])

    // ArrowLeft / ArrowRight hop atomically across pills instead of landing inside raw token characters
    const pillSeg = picked.segments.find((s) => s.kind === 'pill')
    expect(pillSeg).toBeDefined()
    if (pillSeg) {
      expect(stepComposerArrowAcrossPill(picked.segments, pillSeg.end, pillSeg.end, 'ArrowLeft')).toBe(pillSeg.start)
      expect(stepComposerArrowAcrossPill(picked.segments, pillSeg.start, pillSeg.start, 'ArrowRight')).toBe(pillSeg.end)
    }

    // Duplicate pill retention: deleting one of two `/lookml-tests` pills keeps `slash:lookml-tests` in active set
    const dupSegs = parsePromptIntoSegments('/lookml-tests check and /lookml-tests verify', hydrationCtx)
    const prevSet = new Set(['slash:lookml-tests'])
    const afterRemovingFirstDup = applyComposerBackspaceOrDelete(dupSegs, '/lookml-tests'.length, '/lookml-tests'.length, 'Backspace')
    expect(afterRemovingFirstDup).not.toBeNull()
    if (afterRemovingFirstDup) {
      const diff1 = diffRemovedPills(prevSet, afterRemovingFirstDup.segments)
      expect(diff1.removedSlash).toEqual([])
      const afterRemovingSecondDup = applyComposerBackspaceOrDelete(
        afterRemovingFirstDup.segments,
        afterRemovingFirstDup.prompt.length - ' verify'.length,
        afterRemovingFirstDup.prompt.length - ' verify'.length,
        'Backspace'
      )
      expect(afterRemovingSecondDup).not.toBeNull()
      if (afterRemovingSecondDup) {
        const diff2 = diffRemovedPills(diff1.nextKeys, afterRemovingSecondDup.segments)
        expect(diff2.removedSlash).toEqual(['lookml-tests'])
      }
    }

    // Context chip removal helper strips matching mention pills ('explore:*' clears all explore pills) & sliceComposerPrompt serializes copied selections
    const strippedChip = removeMentionPillFromSegments(picked.segments, 'dashboard:902')
    expect(strippedChip.changed).toBe(true)
    expect(strippedChip.prompt).toBe('Analyze ')
    expect(sliceComposerPrompt(picked.segments, 0, picked.prompt.length)).toBe(picked.prompt)

    const clearedExplores = removeMentionPillFromSegments(hydrated, 'explore:*')
    expect(clearedExplores.changed).toBe(true)
    expect(clearedExplores.segments.some((s) => s.kind === 'pill' && s.mentionType === 'explore')).toBe(false)

    // Conversation contentItems hydrate previously mentioned/created remote items on ArrowUp recall & resolveHydratedPills restores metadata
    const recallSegs = parsePromptIntoSegments('/lookml-tests Re-check @dashboard:Q4 Executive Scorecard', {
      slashSkills: STUDIO_SLASH_SKILLS,
      contentItems: [
        {
          key: 'dashboard:777',
          id: '777',
          dashboardId: '777',
          contentType: 'dashboard',
          title: 'Q4 Executive Scorecard',
          embedPath: '/embed/dashboards/777',
          source: 'mention',
        },
      ],
    })
    const resolved = resolveHydratedPills(recallSegs)
    expect(resolved).toEqual({
      slashIds: ['lookml-tests'],
      mentions: [{ type: 'dashboard', id: '777', title: 'Q4 Executive Scorecard' }],
      exploreIds: [],
    })

    // Range replacement expands across any partially overlapped atomic pill cleanly
    const rangeReplaced = replaceSegmentRange(picked.segments, 4, 15, 'for ')
    expect(rangeReplaced.removedPills.map((p) => p.tokenId)).toEqual(['dashboard:902'])
    expect(rangeReplaced.prompt).toBe('Analfor  ')

    // 4. Static guardrails: StudioComposer + StudioUseCaseGuides preserve contentEditable accessibility & preventDefault on menu options
    const composerSrc = readFileSync(path.resolve(__dirname, '../../components/StudioComposer.tsx'), 'utf8')
    const guidesSrc = readFileSync(path.resolve(__dirname, '../../components/StudioUseCaseGuides.tsx'), 'utf8')
    const tokensSrc = readFileSync(path.resolve(__dirname, '../../components/StudioComposerTokens.tsx'), 'utf8')
    expect(composerSrc).toContain('role="textbox"')
    expect(composerSrc).toContain('aria-multiline="true"')
    expect(composerSrc).toContain('contentEditable={!disabled}')
    expect(guidesSrc).toContain('onMouseDown={(e) => e.preventDefault()}')
    expect(tokensSrc).toContain("'data-testid', 'composer-inline-pill'")
  })
}
