import { readFileSync } from 'node:fs'
import path from 'node:path'

import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  AGENTS_MD, buildLookmlSystemGuide, buildNativeContentGuide, buildWorkspaceSources,
  BUILTIN_SKILLS_FILES, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD, DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_THINKING_LEVEL, EXPLICIT_SCRIPT_CREATION_RE, extractInteractionActivitySteps, extractInteractionOutputText,
  extractNonThoughtText, extractSkillNameFromPath, extractSlashSkillIds, extractWrittenMarkdownPathFromCode,
  fetchEnvironmentFile, formatContentInventoryMarkdown, formatFriendlyLookerActivityLabel, isHostOAuthWedged,
  isLookerInstanceMetadataQuery, KDA_SKILL_MD, LkrCodeMode, loadStoredRightPaneCollapsed,
  loginWithGoogleOAuth, LOOKER_DASHBOARD_SKILL_MD, LOOKER_FIELD_PROFILER_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD,
  LOOKML_SKILLS_CATALOG, mergeInteractionSseEvent, NATIVE_CONTENT_GUIDE_MD, normalizeMaxTotalTokens,
  normalizeSandboxFilePath, parseStarterPromptsResponse, readInitialRightPaneCollapsed, readInitialThinkingLevel,
  resetHostOAuthWedged, resolveBuiltinWorkspaceFileContent, runAntigravityTurn, SANDBOX_AGENT_SKILL_FILES,
  streamInteractionUntilActionOrDone, STUDIO_MAX_TOTAL_TOKENS_OPTIONS, STUDIO_SLASH_SKILLS,
} from '../../antigravity'
import {
  ALLOWED_EXTERNAL_WINDOW_PATTERNS, copyLinkWithExtensionSdk, fetchAvailableLookerConnectionsMarkdown, isAllowedExternalWindowUrl,
  isSandboxMarkdownPath, openOrCopyMarkdownLink, StudioMarkdown,
} from '../../components/StudioWorkspace'
import {
  ARTIFACT_NAMESPACE, ArtifactService, buildCaEmbedPath, DEFAULT_STUDIO_AGENT_NAME,
  extractResolvedUseCase, normalizeCaEmbedPath, normalizeStudioAgentName, parseCaAgentSelectionResponse,
  resolveStudioContentEmbedPath, selectCaAgentViaIsolatedSubagent, shouldRouteToIsolatedCaSubagent, userStudioConfigArtifactKey,
} from '../../lookerApi'

interface MockInteractionPostBody {
  model?: string
  store?: boolean
  background?: boolean
  system_instruction?: string
  generation_config?: Record<string, unknown>
  response_format?: Record<string, unknown>
  environment?: string | { type?: string; sources?: Array<{ target: string; content: string }> }
  previous_interaction_id?: string
  tools?: unknown[]
  agent_config?: { type: string; model: string; max_total_tokens?: string }
  input?: Array<{ type?: string; text?: string; name?: string; call_id?: string; result?: unknown }>
}

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK

export function registerPermissionsPart10Tests(): void {
  test('53. Issue #126: persists per-user agentName in user_config:${userId} (default "Ripper"), routes/copies Markdown links via extensionSDK, and appends CA embed collapse query params', async () => {
    expect(DEFAULT_STUDIO_AGENT_NAME).toBe('Ripper')
    expect([normalizeStudioAgentName(), normalizeStudioAgentName(''), normalizeStudioAgentName('  '), normalizeStudioAgentName('  Maverick  ')]).toEqual(['Ripper', 'Ripper', 'Ripper', 'Maverick'])
    expect([userStudioConfigArtifactKey('42'), userStudioConfigArtifactKey(''), userStudioConfigArtifactKey('  7 ')]).toEqual(['user_config:42', 'user_config:1', 'user_config:7'])

    const store = new Map<string, { key: string; value: string; version: number }>()
    const mockSdk = asSdk({
      ok: async <T>(p: Promise<T> | T) => p,
      artifact: async ({ key }: { namespace: string; key: string }) => (store.has(key) ? [store.get(key)!] : []),
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string; version?: number }>) =>
        updates.map((u) => { const next = { key: u.key, value: u.value, version: (store.get(u.key)?.version || 0) + 1 }; store.set(u.key, next); return next }),
    })
    const svc = new ArtifactService(mockSdk, ARTIFACT_NAMESPACE)
    expect(await svc.getUserConfig('42')).toEqual({ userId: '42', agentName: 'Ripper', updatedAt: '' })

    const savedCfg = await svc.saveUserConfig('42', { agentName: '  Point Break  ' })
    expect([savedCfg.userId, savedCfg.agentName, Boolean(savedCfg.updatedAt)]).toEqual(['42', 'Point Break', true])
    expect(JSON.parse(store.get('user_config:42')!.value)).toMatchObject({ userId: '42', agentName: 'Point Break' })
    expect([(await svc.getUserConfig('42')).agentName, (await svc.saveUserConfig('42', { agentName: '   ' })).agentName]).toEqual(['Point Break', 'Ripper'])

    expect(ALLOWED_EXTERNAL_WINDOW_PATTERNS).toEqual(
      expect.arrayContaining(['https://*.looker.com/*', 'https://*.looker.app/*', 'https://*.google.com/*', 'https://cloud.google.com/*', 'https://docs.cloud.google.com/*', 'https://github.com/*'])
    )
    expect([
      isAllowedExternalWindowUrl('https://docs.cloud.google.com/looker/docs/r/sql/LookML-field'),
      isAllowedExternalWindowUrl('https://github.com/lkrdev/data-app-builder'),
      isAllowedExternalWindowUrl('https://unlisted-vendor.example.org/report'),
    ]).toEqual([true, true, false])

    const openedUrls: Array<{ url: string; target?: string }> = []
    const copiedUrls: string[] = []
    const mockExtSdk = {
      openBrowserWindow: (url: string, target?: string) => { openedUrls.push({ url, target }) },
      clipboardWrite: async (text: string) => { copiedUrls.push(text) },
    }
    expect(await openOrCopyMarkdownLink('/dashboards/42?region=AMER', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'opened', targetUrl: '/dashboards/42?region=AMER' })
    expect(await openOrCopyMarkdownLink('https://dev.looker.com/looks/99#table', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'opened', targetUrl: '/looks/99#table' })
    expect(await openOrCopyMarkdownLink('https://docs.cloud.google.com/looker/docs/r/sql/LookML-field', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'opened', targetUrl: 'https://docs.cloud.google.com/looker/docs/r/sql/LookML-field' })
    expect(await openOrCopyMarkdownLink('https://unlisted-vendor.example.org/report', 'https://dev.looker.com', mockExtSdk)).toEqual({ action: 'copied', targetUrl: 'https://unlisted-vendor.example.org/report' })
    expect(openedUrls).toEqual([
      { url: '/dashboards/42?region=AMER', target: '_blank' },
      { url: '/looks/99#table', target: '_blank' },
      { url: 'https://docs.cloud.google.com/looker/docs/r/sql/LookML-field', target: '_blank' },
    ])
    expect(copiedUrls).toEqual(['https://unlisted-vendor.example.org/report'])
    expect([await copyLinkWithExtensionSdk('https://github.com/lkrdev/data-app-builder', mockExtSdk), copiedUrls[copiedUrls.length - 1]]).toEqual([true, 'https://github.com/lkrdev/data-app-builder'])

    expect(buildCaEmbedPath('ca_conv_1', 'agent_ecom')).toBe('/embed/conversations/ca_conv_1?agent_id=agent_ecom&hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')
    expect(normalizeCaEmbedPath('/conversations/ca_conv_2', 'agent_2')).toBe('/embed/conversations/ca_conv_2?agent_id=agent_2&hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')
    expect(resolveStudioContentEmbedPath('conversational-analytics', 'ca_conv_3')).toBe('/embed/conversations/ca_conv_3?hide_sidebar=true&hide_data_source_panel=true&sidebar_collapsed=true&right_panel_collapsed=true')

    const manifestLkml = readFileSync(path.resolve(__dirname, '../../../manifest.lkml'), 'utf8')
    for (const token of ['label: "Ripper"', 'use_clipboard: yes', 'new_window_external_urls:']) expect(manifestLkml).toContain(token)
  })

  test('54. Issue #130: fetches agent-created .md files on demand from /v1beta/environments/{envId}/files/{path}?alt=media via fetchEnvironmentFile (apikey proxy, oauth bearer + 401 refresh retry, and mock resolution) and detects bash/Python .md writes in extractInteractionActivitySteps with zero Looker artifact storage', async () => {
    expect(['/workspace/analysis.md', '///workspace/reports/q4_summary.md', 'file:///workspace/notes.md', '  report.md  '].map(normalizeSandboxFilePath)).toEqual([
      'workspace/analysis.md', 'workspace/reports/q4_summary.md', 'workspace/notes.md', 'report.md',
    ])
    expect(['/workspace/analysis.md', 'workspace/reports/q4_summary.md', 'notes.md', 'file:///workspace/report.md', 'https://docs.cloud.google.com/looker/docs/report.md', '/dashboards/42', 'order_items.total_sale_price'].map(isSandboxMarkdownPath)).toEqual([
      true, true, true, true, false, false, false,
    ])

    const proxyCalls: Array<{ url: string; init?: FetchCustomParameters }> = []
    const apiKeyMd = await fetchEnvironmentFile({
      extensionSDK: {
        serverProxy: async (url: string, init?: FetchCustomParameters) => {
          proxyCalls.push({ url, init })
          return { ok: true, status: 200, body: '# Q4 Margin Root-Cause Analysis\n\nOuterwear drove +18.4% YoY revenue.' }
        },
      },
      auth: { mode: 'apikey', apiKey: 'AIza_test_130' },
      environmentId: 'env_130_prod',
      path: '/workspace/reports/analysis.md',
    })
    expect(apiKeyMd).toContain('# Q4 Margin Root-Cause Analysis')
    expect(proxyCalls).toEqual([{
      url: 'https://generativelanguage.googleapis.com/v1beta/environments/env_130_prod/files/workspace/reports/analysis.md?alt=media',
      init: { method: 'GET', headers: { 'x-goog-api-key': 'AIza_test_130' } },
    }])

    const fetchCalls: Array<{ url: string; headers?: Record<string, string> }> = []
    const globalWithFetch = globalThis as unknown as {
      fetch?: (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
      window?: unknown
    }
    const prevFetch = globalWithFetch.fetch
    const prevWin = globalWithFetch.window
    let attempt = 0
    globalWithFetch.fetch = async (url, init) => {
      fetchCalls.push({ url, headers: init?.headers })
      return ++attempt === 1
        ? { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Token expired' } }) }
        : { ok: true, status: 200, text: async () => '# Refreshed OAuth Sandbox Report\n\nVerified after 401 silent refresh.' }
    }
    try {
      const oauthMd = await fetchEnvironmentFile({
        extensionSDK: {},
        auth: { mode: 'oauth', oauthToken: 'expired_oauth_tok', projectId: 'looker-demo-proj', onUnauthorizedRefresh: async () => 'refreshed_oauth_tok_130' },
        environmentId: 'user_env:42',
        path: '/workspace/summary.md',
      })
      expect(oauthMd).toContain('# Refreshed OAuth Sandbox Report')
      expect(fetchCalls).toEqual([
        { url: 'https://generativelanguage.googleapis.com/v1beta/environments/user_env%3A42/files/workspace/summary.md?alt=media', headers: { Authorization: 'Bearer expired_oauth_tok', 'x-goog-user-project': 'looker-demo-proj' } },
        { url: 'https://generativelanguage.googleapis.com/v1beta/environments/user_env%3A42/files/workspace/summary.md?alt=media', headers: { Authorization: 'Bearer refreshed_oauth_tok_130', 'x-goog-user-project': 'looker-demo-proj' } },
      ])

      globalWithFetch.window = { __MOCK_LOOKER_EXTENSION__: { environmentFiles: { '/workspace/analysis.md': '# Mock Sandbox Analysis\n\n- Gross Margin: 54.2%' } } }
      expect(await fetchEnvironmentFile({ extensionSDK: {}, auth: { mode: 'oauth', oauthToken: 'mock_tok' }, environmentId: 'env_mock_130', path: '/workspace/analysis.md' })).toBe('# Mock Sandbox Analysis\n\n- Gross Margin: 54.2%')
      expect(await fetchEnvironmentFile({ extensionSDK: {}, auth: { mode: 'oauth', oauthToken: 'mock_tok' }, environmentId: 'env_mock_130', path: '/workspace/unlisted_notes.md' })).toContain('# unlisted_notes.md')
    } finally {
      globalWithFetch.fetch = prevFetch
      globalWithFetch.window = prevWin
    }

    const codeSamples = [
      "cat > /workspace/analysis.md << 'EOF'\n# Root Cause Analysis\nEOF",
      'echo "# Notes" | tee -a /workspace/notes.md',
      "with open('/workspace/report.md', 'w') as f:\n    f.write('# Executive Report')",
      "from pathlib import Path\nPath('/workspace/summary.md').write_text('# Executive Summary')",
    ]
    expect(codeSamples.map(extractWrittenMarkdownPathFromCode)).toEqual(['/workspace/analysis.md', '/workspace/notes.md', '/workspace/report.md', '/workspace/summary.md'])
    const mdSteps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        { id: 'step_bash_redir', type: 'code_execution', language: 'BASH', code: codeSamples[0] },
        { id: 'step_bash_tee', type: 'code_execution', language: 'BASH', code: codeSamples[1] },
        { id: 'step_py_open', type: 'code_execution', language: 'PYTHON', code: codeSamples[2] },
        { id: 'step_py_path', type: 'code_execution', language: 'PYTHON', code: codeSamples[3] },
      ],
    })
    expect(mdSteps).toEqual([
      { id: 'step_bash_redir', kind: 'file', title: 'Editing analysis.md', detail: '/workspace/analysis.md', path: '/workspace/analysis.md', status: 'done' },
      { id: 'step_bash_tee', kind: 'file', title: 'Editing notes.md', detail: '/workspace/notes.md', path: '/workspace/notes.md', status: 'done' },
      { id: 'step_py_open', kind: 'file', title: 'Editing report.md', detail: '/workspace/report.md', path: '/workspace/report.md', status: 'done' },
      { id: 'step_py_path', kind: 'file', title: 'Editing summary.md', detail: '/workspace/summary.md', path: '/workspace/summary.md', status: 'done' },
    ])
  })

  test('55. Issue #131: direct model stateless side-requests (store:false, response_format), DEFAULT_MAX_TOTAL_TOKENS=131072, and OAuth SSE streaming with last_event_id resume + polling fallback', async () => {
    expect([DEFAULT_THINKING_LEVEL, DEFAULT_MAX_TOTAL_TOKENS, STUDIO_MAX_TOTAL_TOKENS_OPTIONS.map((o) => o.value)]).toEqual([
      'high', 131072, [32768, 65536, 131072, 262144],
    ])
    expect([normalizeMaxTotalTokens(undefined), normalizeMaxTotalTokens(0), normalizeMaxTotalTokens(65536), normalizeMaxTotalTokens('262144')]).toEqual([
      131072, 131072, 65536, 262144,
    ])
    expect([readInitialThinkingLevel(), readInitialThinkingLevel('low')]).toEqual(['high', 'low'])

    const rawStarterJson = JSON.stringify([
      { id: 's1', label: 'Revenue by Region Scorecard', prompt: 'Build a revenue scorecard by region.', useCase: 'app' },
      { id: 's2', label: 'Monthly Order Trend UDD', prompt: 'Create a native UDD for monthly orders.', useCase: 'dashboard' },
      { id: 's3', label: 'Top Brand Margin Breakdown', prompt: 'What drove brand margin changes?', useCase: 'data-investigator' },
    ])
    expect(parseStarterPromptsResponse(rawStarterJson, []).map((p) => p.id)).toEqual(['s1', 's2', 's3'])
    const rawCaJson = JSON.stringify({ agent_id: 'ca_agent_1', agent_name: 'Orders CA Agent', rationale: 'Direct JSON schema match for orders explore.' })
    expect(
      parseCaAgentSelectionResponse(
        rawCaJson, [{ id: 'ca_agent_1', name: 'Orders CA Agent', description: 'Orders', explores: ['thelook::orders'], goldenQueries: [] }], 'Orders last month?'
      )
    ).toMatchObject({ agentId: 'ca_agent_1', agentName: 'Orders CA Agent', rationale: 'Direct JSON schema match for orders explore.' })

    const capturedTurnBodies: MockInteractionPostBody[] = []
    const mockExtSdk = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        if (init?.body) capturedTurnBodies.push(JSON.parse(String(init.body)) as MockInteractionPostBody)
        return { ok: true, status: 200, body: JSON.stringify({ id: 'int_max_tok_1', environment_id: 'env_tok_1', status: 'completed', output_text: 'Done with 262k budget.' }) }
      },
    }
    await runAntigravityTurn({
      sdk: asSdk({}), extensionSDK: mockExtSdk, auth: { mode: 'apikey' }, session: { toolType: 'app' },
      model: 'gemini-3.8-flash', maxTotalTokens: 262144, selectedExplores: ['thelook::order_items'],
      schemaMarkdown: '# Schema', userPrompt: 'Build app', onStatus: () => {},
    })
    expect(capturedTurnBodies[0]?.agent_config).toEqual({ type: 'antigravity', model: 'gemini-3.8-flash', max_total_tokens: '262144' })

    const snap = mergeInteractionSseEvent(
      mergeInteractionSseEvent({ id: 'int_sse_1', status: 'in_progress' }, 'step.delta', { step: { id: 'st_1', type: 'thought', thought: 'Inspecting explore schema...' } }),
      'content.delta', { delta: { text: 'Hello ' } }
    )
    const snap2 = mergeInteractionSseEvent(snap, 'content.delta', { delta: { text: 'world!' } })
    expect([snap2.output_text, (snap2.steps as Array<{ id?: string }>)[0]?.id]).toEqual(['Hello world!', 'st_1'])

    const fallbackApiKey = await streamInteractionUntilActionOrDone({ auth: { mode: 'apikey', apiKey: 'k' }, interactionId: 'int_sse_fallback' })
    expect(fallbackApiKey.streamed).toBe(false)

    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    try {
      let attempt = 0
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input))
        attempt += 1
        const encoder = new TextEncoder()
        const frames = attempt === 1
          ? ['id: evt_1\nevent: step.delta\ndata: {"step":{"id":"s1","type":"thought","thought":"Checking dimensions"}}\n\n']
          : [
              'id: evt_2\nevent: content.delta\ndata: {"delta":{"text":"Streamed KPI App Ready."}}\n\n',
              'id: evt_3\nevent: interaction.complete\ndata: {"interaction":{"id":"int_sse_live","status":"completed","environment_id":"env_sse_1"}}\n\n',
            ]
        let idx = 0
        return {
          ok: true, status: 200,
          headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
          body: {
            getReader: () => ({
              read: async () => (idx >= frames.length ? { done: true, value: undefined } : { done: false, value: encoder.encode(frames[idx++]) }),
              releaseLock: () => {},
            }),
          },
        } as unknown as Response
      }) as typeof fetch

      const updates: Array<Record<string, unknown>> = []
      const sseRes = await streamInteractionUntilActionOrDone({
        auth: { mode: 'oauth', oauthToken: 'mock-oauth-sse-token' }, interactionId: 'int_sse_live',
        onUpdate: (u) => { updates.push({ ...u }) },
      })
      expect([sseRes.streamed, sseRes.lastEventId, sseRes.interaction.status, sseRes.interaction.output_text]).toEqual([
        true, 'evt_3', 'completed', 'Streamed KPI App Ready.',
      ])
      expect(requestedUrls).toEqual([
        'https://generativelanguage.googleapis.com/v1beta/interactions/int_sse_live?stream=true&alt=sse',
        'https://generativelanguage.googleapis.com/v1beta/interactions/int_sse_live?stream=true&alt=sse&last_event_id=evt_1',
      ])
      expect(updates.length).toBeGreaterThanOrEqual(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('56. Issue #132: mounts use-case guides under /workspace/skills/data-apps/SKILL.md & /workspace/skills/data-investigator/SKILL.md, formats skill steps as "Reading skill <name>", and defaults mobile rightPaneCollapsed to true', async () => {
    const sources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/workspace/skills/data-apps/SKILL.md', content: DATA_APP_GUIDE_MD }),
        expect.objectContaining({ target: '/workspace/skills/data-investigator/SKILL.md', content: DATA_INVESTIGATOR_GUIDE_MD }),
        expect.objectContaining({ target: '/workspace/skills/key-driver-analysis/SKILL.md', content: KDA_SKILL_MD }),
        expect.objectContaining({ target: '/workspace/skills/looker-project-onboarding/SKILL.md', content: LOOKER_PROJECT_ONBOARDING_SKILL_MD }),
      ])
    )
    expect(AGENTS_MD).toContain('skills/data-apps/SKILL.md')
    expect(AGENTS_MD).toContain('skills/data-investigator/SKILL.md')

    for (const p of ['/workspace/skills/data-apps/SKILL.md', 'skills/data-apps/SKILL.md', 'skills/data-apps/skill.md', '/workspace/skills/data-apps/skill.md', '/workspace/DATA_APP_GUIDE.md']) {
      expect([extractSkillNameFromPath(p), resolveBuiltinWorkspaceFileContent(p)]).toEqual(['data-apps', DATA_APP_GUIDE_MD])
    }
    for (const p of ['/workspace/skills/data-investigator/SKILL.md', 'skills/data-investigator/SKILL.md', 'skills/data-investigator/skill.md', '/workspace/skills/data-investigator/skill.md', '/workspace/DATA_INVESTIGATOR_GUIDE.md']) {
      expect([extractSkillNameFromPath(p), resolveBuiltinWorkspaceFileContent(p)]).toEqual(['data-investigator', DATA_INVESTIGATOR_GUIDE_MD])
    }
    expect([extractSkillNameFromPath('/workspace/skills/key-driver-analysis/SKILL.md'), extractSkillNameFromPath('/workspace/apps/current/app.js')]).toEqual(['key-driver-analysis', null])

    const steps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        { id: 'st_view_da', type: 'view_file', input: JSON.stringify({ TargetFile: '/workspace/skills/data-apps/SKILL.md' }) },
        { id: 'st_lookup_di', type: 'lookup_skill', arguments: { skill_name: 'data-investigator' } },
        { id: 'st_bash_kda', type: 'code_execution', language: 'BASH', code: 'cat /workspace/skills/key-driver-analysis/SKILL.md' },
      ],
    })
    expect(steps).toEqual([
      expect.objectContaining({ id: 'st_view_da', kind: 'skill', title: 'Reading skill data-apps', path: '/workspace/skills/data-apps/SKILL.md' }),
      expect.objectContaining({ id: 'st_lookup_di', kind: 'skill', title: 'Reading skill data-investigator', path: '/workspace/skills/data-investigator/SKILL.md' }),
      expect.objectContaining({ id: 'st_bash_kda', kind: 'skill', title: 'Reading skill key-driver-analysis', path: '/workspace/skills/data-investigator/SKILL.md'.replace('data-investigator', 'key-driver-analysis') }),
    ])

    const g = globalThis as unknown as { window?: { innerWidth?: number } }
    const prevWin = g.window
    try {
      g.window = { innerWidth: 390 }
      expect([readInitialRightPaneCollapsed(), await loadStoredRightPaneCollapsed()]).toEqual([true, true])
      g.window = { innerWidth: 1440 }
      expect(readInitialRightPaneCollapsed()).toBe(false)
    } finally {
      g.window = prevWin
    }
  })

  test('57. Evals #1 & #2: formatContentInventoryMarkdown, extractInteractionOutputText, Monty WASM search_agents() & format_content_inventory(), and ad-hoc Looker API vs CA routing', async () => {
    // 1. All 5 content & folder inventory prompt variants route to tile (CodeMode) and never to isolated CA sub-agent
    const inventoryPrompts = [
      'tell me what my personal space is',
      "can you find me all personal spaces that don't have dashboards",
      'what are my favorite dashboards',
      'What dashboards are in my personal',
      'List all dashboards and Looks across all shared folders',
    ]
    for (const p of inventoryPrompts) {
      expect(isLookerInstanceMetadataQuery(p)).toBe(true)
      expect(extractResolvedUseCase('', p)).toBe('tile')
      expect(shouldRouteToIsolatedCaSubagent({ prompt: p, explicitUseCase: 'auto', isCaMode: false, isFirstTurn: true })).toBe(false)
      expect(EXPLICIT_SCRIPT_CREATION_RE.test(p)).toBe(false)
    }
    expect(EXPLICIT_SCRIPT_CREATION_RE.test('create a reusable python script tile for revenue')).toBe(true)

    // 2. formatContentInventoryMarkdown: short list (<= 5 items in 1 folder) vs long list (> 5 items across multiple folders)
    const shortInv = formatContentInventoryMarkdown([
      {
        id: '42',
        name: 'My Personal Folder',
        dashboards: [{ id: '101', title: 'Executive KPI Pulse' }, { id: '102', title: 'Retention Cohort' }],
        looks: [{ id: '201', title: 'Top 25 Brands' }],
      },
    ])
    expect([shortInv.truncated, shortInv.totalItems, shortInv.folderCount]).toEqual([false, 3, 1])
    expect(shortInv.summaryMarkdown).toContain('**[My Personal Folder](/folders/42)** (2 dashboards, 1 Look)')
    expect(shortInv.summaryMarkdown).toContain('- [Executive KPI Pulse](/dashboards/101)')
    expect(shortInv.summaryMarkdown).toContain('- [Top 25 Brands](/looks/201)')

    const longInv = formatContentInventoryMarkdown([
      {
        id: '42',
        name: 'My Personal Folder',
        dashboards: [
          { id: '101', title: 'Dash 1' },
          { id: '102', title: 'Dash 2' },
          { id: '103', title: 'Dash 3' },
          { id: '104', title: 'Dash 4' },
        ],
        looks: [{ id: '201', title: 'Look 1' }, { id: '202', title: 'Look 2' }],
      },
      {
        id: '88',
        name: 'Shared Finance',
        dashboards: [{ id: '105', title: 'Finance 1' }, { id: '106', title: 'Finance 2' }, { id: '107', title: 'Finance 3' }],
      },
    ])
    expect([longInv.truncated, longInv.totalItems, longInv.folderCount, longInv.overflowFilePath]).toEqual([
      true,
      9,
      2,
      '/workspace/content_inventory.md',
    ])
    expect(longInv.summaryMarkdown).toContain('**[My Personal Folder](/folders/42)** (4 dashboards, 2 Looks)')
    expect(longInv.summaryMarkdown).toContain('- See all 6 items in [My Personal Folder](/folders/42)')
    expect(longInv.summaryMarkdown).toContain('- See all 3 items in [Shared Finance](/folders/88)')
    expect(longInv.summaryMarkdown).not.toContain('(/dashboards/103)')
    expect(longInv.fullMarkdown).toContain('(/dashboards/103)')

    // 3. extractInteractionOutputText: extracts nested outputs[0].content[0].text & function_result fallback instead of 'Completed.'
    expect(
      extractInteractionOutputText({
        status: 'completed',
        outputs: [{ type: 'message', content: [{ type: 'output_text', text: 'Nested content markdown link: [Dash 1](/dashboards/101)' }] } as never],
      })
    ).toBe('Nested content markdown link: [Dash 1](/dashboards/101)')
    expect(
      extractInteractionOutputText({
        status: 'completed',
        steps: [{ type: 'function_result', name: 'run_looker_codemode', result: JSON.stringify({ result: { summary_markdown: '**[Folder 42](/folders/42)**' } }) }],
      })
    ).toBe('**[Folder 42](/folders/42)**')

    // 4. Monty WASM search_agents(), sdk.search_agents(), and format_content_inventory()
    const mockSdk = {
      search_agents: async () => [
        {
          id: 'ca_agent_rev',
          name: 'Revenue & Margin Agent',
          description: 'Covers gross margin, order revenue, and return rates.',
          explores: ['thelook::order_items'],
          golden_queries: [{ questions: ['What is our gross margin by category?'] }],
        },
      ],
      ok: async <T>(p: Promise<T> | T) => p,
      authSession: {
        transport: {
          rawRequest: async () => ({ statusCode: 200, ok: true, body: [] }),
        },
      },
    } as unknown as Looker40SDK

    const cmOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: `agents = sdk.search_agents()
inv = format_content_inventory([{"id": "42", "name": "My Folder", "dashboards": [{"id": "10", "title": "Revenue Pulse"}]}])
return {"agent_id": agents[0]["id"], "gq": agents[0]["golden_queries"][0]["questions"][0], "md": inv["summary_markdown"]}`,
        sdk: mockSdk,
      })
    )
    const cmRes = cmOut.result || cmOut
    expect([cmRes.agent_id, cmRes.gq]).toEqual(['ca_agent_rev', 'What is our gross margin by category?'])
    expect(cmRes.md).toContain('[Revenue Pulse](/dashboards/10)')

    // 5. Activity label & CA preselectedOutput fast-path
    expect(formatFriendlyLookerActivityLabel('agents = search_agents()').statusText).toBe(
      'Searching accessible Looker Conversational Analytics agents and golden queries...'
    )
    const preselectedOut =
      '<USE_CASE>conversational-analytics</USE_CASE>\n<CA_AGENT_SELECTION>{"agent_id":"ca_agent_rev","rationale":"Matches gross margin golden query."}</CA_AGENT_SELECTION>'
    expect(
      shouldRouteToIsolatedCaSubagent({
        prompt: 'What is our gross margin by category?',
        explicitUseCase: 'auto',
        isCaMode: false,
        isFirstTurn: true,
        assistantOutput: preselectedOut,
      })
    ).toBe(true)
    const fastSelected = await selectCaAgentViaIsolatedSubagent({
      sdk: mockSdk,
      auth: { mode: 'oauth', oauthToken: '' },
      userQuestion: 'What is our gross margin by category?',
      preselectedOutput: preselectedOut,
    })
    expect([fastSelected.agentId, fastSelected.rationale]).toEqual(['ca_agent_rev', 'Matches gross margin golden query.'])
  })

  test('58. Issue #145: collates unified looker-dashboard skill, promotes looker-field-profiler (profile_fields), mounts both in sandbox & Viewer, and integrates profile_fields across Studio use cases & skills', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const dashSkillDisk = readFileSync(path.join(repoRoot, 'skills/looker-dashboard/SKILL.md'), 'utf8')
    const dashSkillAgentsDisk = readFileSync(path.join(repoRoot, '.agents/skills/looker-dashboard/SKILL.md'), 'utf8')
    const profSkillDisk = readFileSync(path.join(repoRoot, 'skills/looker-field-profiler/SKILL.md'), 'utf8')
    const profSkillAgentsDisk = readFileSync(path.join(repoRoot, '.agents/skills/looker-field-profiler/SKILL.md'), 'utf8')

    expect(LOOKER_DASHBOARD_SKILL_MD).toBe(dashSkillDisk)
    expect(LOOKER_DASHBOARD_SKILL_MD).toBe(dashSkillAgentsDisk)
    expect(LOOKER_FIELD_PROFILER_SKILL_MD).toBe(profSkillDisk)
    expect(LOOKER_FIELD_PROFILER_SKILL_MD).toBe(profSkillAgentsDisk)

    for (const token of ['profile_fields', 'upsert_udd', 'tabs:', 'business_pulse', 'y_axes', 'advanced_vis_config', 'lookml-dashboard-to-query']) {
      expect(LOOKER_DASHBOARD_SKILL_MD).toContain(token)
    }

    const sources = buildWorkspaceSources({ schemaMarkdown: '# Schema' })
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/workspace/skills/looker-dashboard/SKILL.md', content: LOOKER_DASHBOARD_SKILL_MD }),
        expect.objectContaining({ target: '/workspace/skills/looker-field-profiler/SKILL.md', content: LOOKER_FIELD_PROFILER_SKILL_MD }),
      ])
    )

    for (const k of ['looker-dashboard', 'creating-looker-dashboard', 'skills/looker-dashboard/SKILL.md', '/workspace/skills/looker-dashboard/SKILL.md']) {
      expect(BUILTIN_SKILLS_FILES[k]).toBe(LOOKER_DASHBOARD_SKILL_MD)
      expect(resolveBuiltinWorkspaceFileContent(k)).toBe(LOOKER_DASHBOARD_SKILL_MD)
    }
    for (const k of ['looker-field-profiler', 'skills/looker-field-profiler/SKILL.md', '/workspace/skills/looker-field-profiler/SKILL.md']) {
      expect(BUILTIN_SKILLS_FILES[k]).toBe(LOOKER_FIELD_PROFILER_SKILL_MD)
      expect(resolveBuiltinWorkspaceFileContent(k)).toBe(LOOKER_FIELD_PROFILER_SKILL_MD)
    }

    expect(LOOKML_SKILLS_CATALOG.find((s) => s.id === 'looker-field-profiler')).toEqual({
      id: 'looker-field-profiler',
      label: 'Field Value Profiler',
      desc: 'Profile field distributions, spikiness, LookML curation snippets & _field_value_search_<model> search index PDTs',
      path: 'skills/looker-field-profiler/SKILL.md',
    })

    for (const relPath of [
      'looker-permissions/SKILL.md',
      'looker-field-profiler/sub-skills/scratch-search/SKILL.md',
      'looker-field-profiler/scripts/scratch_search.py',
      'looker-field-profiler/scripts/dialects/bigquery.py',
      'looker-field-profiler/scripts/dialects/snowflake.py',
      'looker-field-profiler/scripts/dialects/postgres.py',
      'looker-field-profiler/scripts/dialects/databricks.py',
      'looker-field-profiler/scripts/dialects/duckdb.py',
    ]) {
      const diskContent = readFileSync(path.join(repoRoot, '.agents/skills', relPath), 'utf8')
      expect(SANDBOX_AGENT_SKILL_FILES[relPath]).toBe(diskContent)
      expect(resolveBuiltinWorkspaceFileContent(`/workspace/skills/${relPath}`)).toBe(diskContent)
    }
    const scratchSkillMd = readFileSync(path.join(repoRoot, 'skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md'), 'utf8')
    expect(SANDBOX_AGENT_SKILL_FILES['looker-field-profiler/sub-skills/scratch-search/SKILL.md']).toBe(scratchSkillMd)
    expect(BUILTIN_SKILLS_FILES['scratch-search']).toBe(scratchSkillMd)
    expect(BUILTIN_SKILLS_FILES['looker-field-profiler-scratch-search']).toBe(scratchSkillMd)
    expect(extractSkillNameFromPath('/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md')).toBe('scratch-search')
    expect(extractSkillNameFromPath('.agents/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md')).toBe('scratch-search')

    const scratchLabel = formatFriendlyLookerActivityLabel('return run_inline_query("json", {"model": "ecom", "view": "_field_value_search_ecom", "filters": {"_field_value_search_ecom.field_value": "%Acme%"}})')
    expect(scratchLabel).toMatchObject({
      title: 'Searching model field value index',
      stepTitle: 'Searching model field value index',
      statusText: 'Searching model _field_value_search index for matching entity values...',
      isQuery: true,
    })

    const profLabel = formatFriendlyLookerActivityLabel('return profile_fields(model="thelook", view="order_items", fields=["order_items.status"])')
    expect(profLabel).toMatchObject({
      title: 'Profiling Explore field distributions',
      stepTitle: 'Profiling Explore field distributions',
      statusText: 'Profiling Explore field distributions, cardinality, and temporal spikiness...',
      targetLabel: 'Order Items',
      isQuery: true,
    })

    const skillSteps = extractInteractionActivitySteps({
      status: 'completed',
      steps: [
        { id: 'st_dash', type: 'view_file', input: JSON.stringify({ TargetFile: 'skills/looker-dashboard/SKILL.md' }) },
        { id: 'st_prof', type: 'lookup_skill', arguments: { skill_name: 'looker-field-profiler' } },
        { id: 'st_scratch', type: 'view_file', input: JSON.stringify({ TargetFile: '/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md' }) },
      ],
    })
    expect(skillSteps).toEqual([
      expect.objectContaining({ id: 'st_dash', kind: 'skill', title: 'Reading skill looker-dashboard', path: 'skills/looker-dashboard/SKILL.md', content: LOOKER_DASHBOARD_SKILL_MD }),
      expect.objectContaining({ id: 'st_prof', kind: 'skill', title: 'Reading skill looker-field-profiler', path: '/workspace/skills/looker-field-profiler/SKILL.md', content: LOOKER_FIELD_PROFILER_SKILL_MD }),
      expect.objectContaining({ id: 'st_scratch', kind: 'skill', title: 'Reading skill scratch-search', path: '/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md', content: scratchSkillMd }),
    ])

    const nativeGuide = buildNativeContentGuide({ selectedExplores: ['thelook::order_items'], primaryModel: 'thelook', primaryExplore: 'order_items' })
    for (const doc of [NATIVE_CONTENT_GUIDE_MD, nativeGuide, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD, KDA_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD]) {
      expect(doc).toContain('looker-field-profiler')
      expect(doc).toContain('profile_fields')
    }
    for (const doc of [LOOKER_FIELD_PROFILER_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, NATIVE_CONTENT_GUIDE_MD, DATA_APP_GUIDE_MD, DATA_INVESTIGATOR_GUIDE_MD, AGENTS_MD]) {
      expect(doc).toContain('_field_value_search_')
    }
    for (const doc of [AGENTS_MD, readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')]) {
      expect(doc).toContain('skills/looker-dashboard/SKILL.md')
      expect(doc).toContain('skills/looker-field-profiler/SKILL.md')
      expect(doc).toContain('sub-skills/scratch-search/SKILL.md')
      expect(doc).toContain('_field_value_search_<model>')
    }
  })

  test('59. Issue #152: recovers wedged Looker OAuth host state + visibilitychange/stored session, falls back from /connections 403/404 to /lookml_models allowed_db_connection_names, and preserves SSE streamed markdown continuity + multi-line <ol>', async () => {
    // 1. OAuth hostOAuthWedged tracking, visibilitychange listener, and stored session recovery
    resetHostOAuthWedged()
    expect(isHostOAuthWedged()).toBe(false)

    const winListeners: Record<string, Array<() => void>> = {}
    const docListeners: Record<string, Array<() => void>> = {}
    const g = globalThis as unknown as { window?: unknown; document?: unknown }
    const prevWin = g.window
    const prevDoc = g.document
    g.window = {
      location: { origin: 'https://dev.looker.com' },
      addEventListener: (evt: string, fn: () => void) => { ;(winListeners[evt] = winListeners[evt] || []).push(fn) },
      removeEventListener: (evt: string, fn: () => void) => { winListeners[evt] = (winListeners[evt] || []).filter((x) => x !== fn) },
    }
    g.document = {
      visibilityState: 'visible',
      addEventListener: (evt: string, fn: () => void) => { ;(docListeners[evt] = docListeners[evt] || []).push(fn) },
      removeEventListener: (evt: string, fn: () => void) => { docListeners[evt] = (docListeners[evt] || []).filter((x) => x !== fn) },
    }
    try {
      const hangingSdk = { oauth2Authenticate: () => new Promise(() => {}) }
      const p1 = loginWithGoogleOAuth(hangingSdk, 'client-152', { focusReturnDelayMs: 15 })
      for (const fn of docListeners.visibilitychange || []) fn()
      await expect(p1).rejects.toThrow(/popup closed or failed/i)
      expect(isHostOAuthWedged()).toBe(true)
      expect(docListeners.visibilitychange?.length || 0).toBe(0)

      // Stored session resolves on focus/visibilitychange instead of rejecting and clears wedged flag
      const storedPayload = JSON.stringify({ token: 'stored_mobile_tok_152', expiresAt: Date.now() + 600_000, clientId: 'client-152' })
      const storedSdk = {
        oauth2Authenticate: () => new Promise(() => {}),
        localStorageGetItem: async () => storedPayload,
        localStorageSetItem: async () => {},
      }
      const p2 = loginWithGoogleOAuth(storedSdk, 'client-152', { focusReturnDelayMs: 15 })
      for (const fn of docListeners.visibilitychange || []) fn()
      await expect(p2).resolves.toBe('stored_mobile_tok_152')
      expect(isHostOAuthWedged()).toBe(false)
      resetHostOAuthWedged()
    } finally {
      g.window = prevWin
      g.document = prevDoc
    }

    // 2. Non-admin /connections -> /lookml_models fallback in fetchAvailableLookerConnectionsMarkdown
    const adminConnSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) =>
            p === '/connections'
              ? { statusCode: 200, ok: true, body: [{ name: 'bq_analytics', dialect_name: 'bigquery_standard_sql', database: 'analytics_prod', schema: 'core' }] }
              : { statusCode: 200, ok: true, body: [] },
        },
      },
    })
    const adminMd = await fetchAvailableLookerConnectionsMarkdown(adminConnSdk)
    expect(adminMd).toContain('`bq_analytics` (bigquery_standard_sql · analytics_prod · core)')

    const nonAdminFallbackSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) =>
            p === '/connections'
              ? { statusCode: 404, ok: false, body: { message: 'Not found' } }
              : { statusCode: 200, ok: true, body: [{ name: 'retail_model', project_name: 'retail_proj', allowed_db_connection_names: ['snowflake_dw', 'bq_retail'] }] },
        },
      },
    })
    const fallbackMd = await fetchAvailableLookerConnectionsMarkdown(nonAdminFallbackSdk)
    expect(fallbackMd).toContain('`snowflake_dw` (models/projects: retail_proj)')
    expect(fallbackMd).toContain('`bq_retail` (models/projects: retail_proj)')

    // 3. Keyless step.delta SSE merging & non-trimmed streamed parts extraction
    let sseState = { id: 'int_152', status: 'in_progress' }
    for (const chunk of ['I', "'ll", ' help you set up **Target Tables or Schemas', '**: [Open SQL Runner](/sql', ')']) {
      sseState = mergeInteractionSseEvent(sseState, 'step.delta', { step_delta: { type: 'text', text: chunk } })
    }
    expect((sseState.steps as Array<{ text?: string }>).length).toBe(1)
    expect(extractInteractionOutputText(sseState)).toBe("I'll help you set up **Target Tables or Schemas**: [Open SQL Runner](/sql)")
    expect(
      extractNonThoughtText([
        { type: 'output_text', text: 'I' },
        { type: 'output_text', text: "'ll" },
        { type: 'output_text', text: ' check connections.' },
      ])
    ).toBe("I'll check connections.")

    // 4. StudioMarkdown normalizes split **bold\n** / [link](url\n) and keeps multi-line <ol> as a single <ol> with 2 <li>s
    type Elem = React.ReactElement<Record<string, unknown>>
    const mdTree = StudioMarkdown({
      text: '1. **Connection Name**: Check [Open Looker Connections](/admin/connections\n)\nwrapped continuation line\n2. **Target Tables or Schemas\n**: See [Open SQL Runner](/sql\n)',
    }) as Elem
    const blocks = mdTree.props.children as Elem[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('ol')
    const liNodes = blocks[0].props.children as Elem[]
    expect(liNodes).toHaveLength(2)
  })

  test('60. Issue #151: exports STUDIO_SLASH_SKILLS, extracts /skill-id tokens via extractSlashSkillIds, and configures buildLookmlSystemGuide without forcing Turn Skills when none are activated', () => {
    expect(STUDIO_SLASH_SKILLS.map((s) => s.id)).toEqual([
      'looker-project-onboarding',
      'lookml-field-curation',
      'lookml-tests',
      'lookml-snapshot',
      'generate-view-from-table',
      'agentic-lookml-workflow',
      'looker-field-profiler',
      'looker-dashboard',
      'key-driver-analysis',
      'data-investigator',
      'data-apps',
      'looker-alerts',
    ])

    expect(extractSlashSkillIds('')).toEqual([])
    expect(extractSlashSkillIds('Please run /lookml-tests and /looker-field-profiler on order_items')).toEqual([
      'lookml-tests',
      'looker-field-profiler',
    ])
    expect(extractSlashSkillIds('/looker-project-onboarding from snowflake_prod')).toEqual([
      'looker-project-onboarding',
    ])
    expect(extractSlashSkillIds('https://example.com/lookml-tests/foo')).toEqual([])

    const guideDefault = buildLookmlSystemGuide({
      selectedExplores: ['thelook::order_items'],
      primaryModel: 'thelook',
      primaryExplore: 'order_items',
      projectId: 'agentic_thelook',
      activatedSkills: [],
    })
    expect(guideDefault).not.toContain('Activated Turn Skills:')
    expect(guideDefault).toContain(
      'Automatically discover and load the matching skill(s) for this turn from `/workspace/AGENTS.md` and `/workspace/skills/<skill-id>/SKILL.md`.'
    )

    const guideExplicit = buildLookmlSystemGuide({
      selectedExplores: ['thelook::order_items'],
      primaryModel: 'thelook',
      primaryExplore: 'order_items',
      projectId: 'agentic_thelook',
      activatedSkills: ['lookml-tests'],
      userPrompt: 'Also run /lookml-field-curation on orders',
    })
    expect(guideExplicit).toContain('Activated Turn Skills: `lookml-tests`, `lookml-field-curation`.')
    expect(guideExplicit).toContain('Prioritize reading and executing the instructions for these activated skills on this turn.')
  })

}
