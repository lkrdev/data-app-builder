import { readFileSync } from 'node:fs'
import path from 'node:path'

import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  buildLookmlSystemGuide, copyTextWithExtensionSdk, DATA_APP_GUIDE_MD, DEFAULT_ANTIGRAVITY_MODEL,
  discoverAccessibleConnections, fetchConversationSandboxDebugMarkdown, formatAccessibleConnectionsMarkdown, formatConversationThreadMarkdown,
  formatThinkingTraceMarkdown, isConnectionSchemaDiscoveryPrompt, isNewProjectOnboardingIntakePrompt, LkrCodeMode,
  LOOKER_DASHBOARD_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, runAntigravityTurn,
} from '../../antigravity'
import { DOC_UI_COMPONENTS, StudioMarkdown, USE_CASE_GUIDES } from '../../components/StudioWorkspace'
import { clearLookerMetadataCache } from '../../lookerApi'
import { LookmlPreviewPane } from '../../lookmlTool'

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

export function registerPermissionsPart11Tests(): void {
  test('61. Issue #158: enforces all 6 Metric Selector Data App standards across onboarding skill, DATA_APP_GUIDE_MD, step3Directive, data-app-creator skill/reference, and eval-new-project Turn 6 grader', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const onboardingSkillDisk = readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')
    expect(onboardingSkillDisk).toBe(LOOKER_PROJECT_ONBOARDING_SKILL_MD)
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)
    expect(DATA_APP_GUIDE_MD).not.toMatch(/thelook|argolis_scratch|default_bigquery_connection|demowest|looker-private-demo/i)

    const antigravityTsDisk = readFileSync(path.join(repoRoot, 'src/antigravity.ts'), 'utf8')
    const step3Line = antigravityTsDisk.split('\n').find((line) => line.includes('const step3Directive =')) || ''
    const creatorSkillDisk = readFileSync(path.join(repoRoot, 'skills/data-apps/SKILL.md'), 'utf8')
    const litRefDisk = readFileSync(path.join(repoRoot, 'skills/data-apps/reference/LIT_DATA_APPS.md'), 'utf8')
    const evalNewProjectDisk = readFileSync(path.join(repoRoot, 'scripts/eval-new-project.mjs'), 'utf8')

    const requiredTokens = [
      'ACTIVE METRIC', '--app-chart-1', '--app-chart-2', 'shiftKey', 'contextmenu', 'Remove comparison',
      'kpi-change', 'vs. prev', 'lower-better',
      'container-type: inline-size', '@container', 'repeat(4, minmax(0, 1fr))', 'repeat(2, minmax(0, 1fr))', 'auto-fit',
      'opposite: true', 'Longitudinal Trend', 'yAxis.title.text', '⋮',
      'loadTrendData', 'Promise.all', 'shareScale', 'linkedTo: 0',
      'PERIOD_DEFAULTS = { date:', 'Period', 'Window', 'periodCount', 'getEffectiveFilters',
      '!WINDOW_OPTIONS[this.period].includes(this.periodCount)', 'customWindowOpen', 'Custom window length', 'type="number"',
      'Math.min(5000, Math.max(500, 2 * this.periodCount + 10))',
      'Dimensions', 'selectedDimensions', 'ago for', 'This Period', 'Last Period', 'Variance',
    ]
    for (const targetDoc of [LOOKER_PROJECT_ONBOARDING_SKILL_MD, DATA_APP_GUIDE_MD, step3Line, creatorSkillDisk, litRefDisk]) {
      expect(targetDoc).toMatch(/2 \* (?:this\.)?periodCount/)
      for (const tok of requiredTokens) expect(targetDoc).toContain(tok)
    }

    for (const checkKey of ['noInvalidDayField', 'noMetricDropdownOrActiveBadge', 'hasBalancedKpiGrid', 'hasPopClickableKpis', 'hasCardBorderCompareDualAxis', 'hasTrendMenuAndYAxis', 'hasDecoupledPeriodAndWindow', 'hasCustomWindowPopover', 'hasMultiSelectDimensions', 'hasTitlelessPopVarianceGrid']) {
      expect(evalNewProjectDisk).toContain(checkKey)
    }
  })

  test('62. Issue #157: pre-fetches accessible connections via discoverAccessibleConnections, runs Turn-1 project intake toollessly at thinkingLevel="low" with zero blocking container boot, uses bare Monty globals, renders lookml-open-ide-btn, and enforces IDE/dashboard links', async () => {
    clearLookerMetadataCache()

    // 1. discoverAccessibleConnections: /connections caching + non-admin /lookml_models fallback
    let adminConnHits = 0
    const adminSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) => {
            if (p === '/connections') {
              adminConnHits += 1
              return {
                statusCode: 200,
                ok: true,
                body: [
                  { name: 'bq_warehouse', dialect_name: 'bigquery_standard_sql', database: 'corp_dw', schema: 'analytics' },
                ],
              }
            }
            return { statusCode: 200, ok: true, body: [] }
          },
        },
      },
    })
    const [conns1, conns2] = await Promise.all([
      discoverAccessibleConnections(adminSdk),
      discoverAccessibleConnections(adminSdk),
    ])
    expect(adminConnHits).toBe(1)
    expect(conns1).toEqual([
      { name: 'bq_warehouse', dialect_name: 'bigquery_standard_sql', database: 'corp_dw', schema: 'analytics', source: 'connections' },
    ])
    expect(conns2).toEqual(conns1)
    expect(formatAccessibleConnectionsMarkdown(conns1)).toContain(
      '- `bq_warehouse` (bigquery_standard_sql · corp_dw · analytics)'
    )

    let fallbackHits = 0
    const nonAdminSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (_m: string, p: string) => {
            fallbackHits += 1
            if (p === '/connections') return { statusCode: 403, ok: false, body: { message: 'Forbidden' } }
            return {
              statusCode: 200,
              ok: true,
              body: [{ name: 'commerce_model', project_name: 'commerce_proj', allowed_db_connection_names: ['sf_prod'] }],
            }
          },
        },
      },
    })
    const fallbackConns = await discoverAccessibleConnections(nonAdminSdk)
    expect(fallbackHits).toBe(2)
    expect(fallbackConns).toEqual([
      { name: 'sf_prod', models: ['commerce_proj'], source: 'lookml_models' },
    ])
    await discoverAccessibleConnections(nonAdminSdk)
    expect(fallbackHits).toBe(2)

    // 2. Prompt classifiers, bare Monty globals (zero sdk.*), skill byte-parity, and required link instructions
    expect(isNewProjectOnboardingIntakePrompt('I need to create a new project')).toBe(true)
    expect(isNewProjectOnboardingIntakePrompt('create a new project')).toBe(true)
    expect(
      isNewProjectOnboardingIntakePrompt(
        'Create a new project called sales_core on connection bq_warehouse using schema analytics'
      )
    ).toBe(false)
    expect(
      isConnectionSchemaDiscoveryPrompt(
        "Let's call it sales_core on connection bq_warehouse. What schemas do you have access to on that connection?"
      )
    ).toBe(true)
    expect(isConnectionSchemaDiscoveryPrompt('Use the analytics dataset.')).toBe(false)

    const repoRoot = path.resolve(__dirname, '../../..')
    expect(readFileSync(path.join(repoRoot, 'skills/looker-project-onboarding/SKILL.md'), 'utf8')).toBe(
      LOOKER_PROJECT_ONBOARDING_SKILL_MD
    )
    expect(readFileSync(path.join(repoRoot, 'skills/looker-dashboard/SKILL.md'), 'utf8')).toBe(
      LOOKER_DASHBOARD_SKILL_MD
    )
    expect(readFileSync(path.join(repoRoot, '.agents/skills/looker-dashboard/SKILL.md'), 'utf8')).toBe(
      LOOKER_DASHBOARD_SKILL_MD
    )

    const guideWithConns = buildLookmlSystemGuide({
      selectedExplores: [],
      userPrompt: 'I need to create a new project',
      availableConnections: conns1,
    })
    expect(guideWithConns).toContain('### Available Looker Connections')
    expect(guideWithConns).toContain('`bq_warehouse` (bigquery_standard_sql · corp_dw · analytics)')
    expect(guideWithConns).toContain('[Open <project_name> in Looker IDE](/projects/<project_name>)')
    expect(guideWithConns).toContain('[Open <Dashboard Title>](/dashboards/<id>)')
    for (const doc of [LOOKER_PROJECT_ONBOARDING_SKILL_MD, guideWithConns]) {
      expect(doc).toContain('all_connections')
      expect(doc).toContain('all_lookml_models')
      expect(doc).toContain('connection_schemas')
      expect(doc).not.toMatch(/\bsdk\.(?:all_connections|all_lookml_models|connection_schemas|connection_tables)\b/)
    }
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain('/projects/<project_name>')
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).not.toContain('/projects/<project_name>/files')
    expect(LOOKER_PROJECT_ONBOARDING_SKILL_MD).toContain('/dashboards/<id>')
    expect(LOOKER_DASHBOARD_SKILL_MD).toContain('/dashboards/<id>')

    // Verify LkrCodeMode Monty runtime strips accidental sdk.<method>(...) prefixes cleanly
    const cmBareOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: 'c = sdk.all_connections(fields="name")\nreturn {"first": c[0]["name"]}',
        sdk: adminSdk,
      })
    )
    expect((cmBareOut.result || cmBareOut).first).toBe('bq_warehouse')

    // 3. runAntigravityTurn fast-path on Turn-1 intake -> Turn-2 schema discovery -> Turn-3 LookML bundle + IDE link
    const postedBodies: MockInteractionPostBody[] = []
    const mockExt157 = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as MockInteractionPostBody) : {}
        postedBodies.push(body)
        if (postedBodies.length === 1) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_157_t1',
              status: 'completed',
              output_text:
                '<USE_CASE>lookml</USE_CASE>\nAvailable connection: `bq_warehouse`. Please provide project name and target schema.',
            }),
          }
        }
        if (postedBodies.length === 2) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_157_t2',
              status: 'completed',
              output_text: '<USE_CASE>lookml</USE_CASE>\nAccessible schemas on `bq_warehouse`: `analytics`, `finance`.',
            }),
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_157_t3',
            environment_id: 'env_157_warm',
            status: 'completed',
            steps: [
              {
                type: 'code_execution',
                output:
                  '<LOOKML_BUNDLE>{"id":"sales_core_1","title":"sales_core","project_id":"sales_core","model_name":"sales_core","files":[{"path":"sales_core.model.lkml","action":"created","content":"connection: \\"bq_warehouse\\"\\n"}]}</LOOKML_BUNDLE>',
              },
            ],
            output_text: '<USE_CASE>lookml</USE_CASE>\nCreated Bronze views. Want me to profile the data?',
          }),
        }
      },
    }

    const t1Res = await runAntigravityTurn({
      sdk: adminSdk,
      extensionSDK: mockExt157,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-157' },
      session: {},
      thinkingLevel: 'high',
      useCase: 'auto',
      toolMode: 'lookml',
      selectedExplores: [],
      schemaMarkdown: '',
      userPrompt: 'I need to create a new project',
      onStatus: () => {},
    })
    expect(postedBodies).toHaveLength(1)
    expect(postedBodies[0].model).toBe(DEFAULT_ANTIGRAVITY_MODEL)
    expect(postedBodies[0].store).toBe(false)
    expect(postedBodies[0].background).toBe(false)
    expect(postedBodies[0].tools).toEqual([])
    expect(postedBodies[0].environment).toBeUndefined()
    expect(postedBodies[0].generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 2048 })
    expect(postedBodies[0].input?.[0]?.text?.startsWith('[THINKING LEVEL: LOW')).toBe(true)
    expect(postedBodies[0].input?.[0]?.text).toContain('`bq_warehouse` (bigquery_standard_sql · corp_dw · analytics)')
    expect(t1Res.resolvedUseCase).toBe('lookml')
    expect(t1Res.session.statelessTurn).toBe(true)

    const t2Res = await runAntigravityTurn({
      sdk: adminSdk,
      extensionSDK: mockExt157,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-157' },
      session: t1Res.session,
      thinkingLevel: 'high',
      useCase: 'auto',
      toolMode: 'lookml',
      selectedExplores: [],
      schemaMarkdown: '',
      priorMessages: [
        { role: 'user', text: 'I need to create a new project' },
        { role: 'assistant', text: t1Res.assistantText },
      ],
      userPrompt: "Let's call it sales_core on connection bq_warehouse. What schemas do you have access to?",
      onStatus: () => {},
    })
    expect(postedBodies).toHaveLength(2)
    expect(postedBodies[1].environment).toBeUndefined()
    expect(postedBodies[1].previous_interaction_id).toBeUndefined()
    expect(postedBodies[1].tools).toEqual([LkrCodeMode.RUN_LOOKER_CODEMODE_TOOL])
    expect(postedBodies[1].input?.[0]?.text?.startsWith('[THINKING LEVEL: LOW')).toBe(true)
    expect(postedBodies[1].input?.[0]?.text).toContain('Prior conversation context:')

    const t3Res = await runAntigravityTurn({
      sdk: adminSdk,
      extensionSDK: mockExt157,
      userId: '1',
      auth: { mode: 'apikey', apiKey: 'key-157' },
      session: t2Res.session,
      thinkingLevel: 'high',
      useCase: 'auto',
      toolMode: 'lookml',
      selectedExplores: [],
      schemaMarkdown: '',
      priorMessages: [
        { role: 'user', text: 'I need to create a new project' },
        { role: 'assistant', text: t1Res.assistantText },
        { role: 'user', text: "Let's call it sales_core on connection bq_warehouse. What schemas do you have access to?" },
        { role: 'assistant', text: t2Res.assistantText },
      ],
      userPrompt: 'Use the analytics schema.',
      onStatus: () => {},
    })
    expect(postedBodies).toHaveLength(3)
    expect(postedBodies[2].environment).toEqual(expect.objectContaining({ type: 'remote' }))
    expect(t3Res.assistantText).toContain('[Open sales_core in Looker IDE](/projects/sales_core)')

    // 4. LookmlPreviewPane defaults to clean file-first view and renders lookml-details-modal + lookml-open-ide-btn when details modal is open
    const openedIdeUrls: Array<{ url: string; target?: string }> = []
    const defaultPaneHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: {
          id: 'b1',
          title: 'Sales Core',
          project_id: 'sales_core',
          files: [{ path: 'sales_core.model.lkml', action: 'created', content: 'connection: "bq"\n', diff: '--- a/sales_core.model.lkml\n+++ b/sales_core.model.lkml\n@@ -0,0 +1 @@\n+connection: "bq"\n' }],
        },
        hostUrl: 'https://dev.looker.com',
        extensionSDK: { openBrowserWindow: (url: string, target?: string) => openedIdeUrls.push({ url, target }) },
      })
    )
    expect(defaultPaneHtml).not.toContain('data-testid="lookml-details-modal"')
    expect(defaultPaneHtml).toContain('title="sales_core.model.lkml"')
    expect(defaultPaneHtml).toContain('<span class="dab-lkml-kind-badge" data-kind="M" aria-hidden="true">M</span><span>sales_core</span></button>')
    expect(defaultPaneHtml).toContain('data-testid="lookml-file-picker-btn"')
    expect(defaultPaneHtml).not.toContain('data-testid="lookml-open-file-ide-btn"')
    expect(defaultPaneHtml).not.toContain('--- a/sales_core.model.lkml')

    const withProjectDetailsHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: {
          id: 'b1',
          title: 'Sales Core',
          project_id: 'sales_core',
          files: [{ path: 'sales_core.model.lkml', action: 'created', content: 'connection: "bq"\n' }],
        },
        hostUrl: 'https://dev.looker.com',
        initialDetailsOpen: true,
        extensionSDK: { openBrowserWindow: (url: string, target?: string) => openedIdeUrls.push({ url, target }) },
      })
    )
    expect(withProjectDetailsHtml).toContain('data-testid="lookml-details-modal"')
    expect(withProjectDetailsHtml).toContain('data-testid="lookml-open-ide-btn"')
    expect(withProjectDetailsHtml).toContain('Open Project in IDE')

    const withoutProjectHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: { id: 'b2', title: 'Untitled', project_id: '', files: [] },
        hostUrl: 'https://dev.looker.com',
        initialDetailsOpen: true,
      })
    )
    expect(withoutProjectHtml).not.toContain('data-testid="lookml-open-ide-btn"')
  })

  test('63. Issue #156: routes clipboard copies via copyTextWithExtensionSdk, parses GFM pipe tables / <hr> / <ol start>, walks full sandbox interaction chains via fetchConversationSandboxDebugMarkdown, and refreshes LookmlTurnSkills & UseCaseInfoModal guides', async () => {
    // 1. copyTextWithExtensionSdk: extensionSDK.clipboardWrite first, navigator.clipboard.writeText fallback
    const extCopied: string[] = []
    const navCopied: string[] = []
    const g = globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }
    const prevNav = g.navigator
    try {
      g.navigator = { clipboard: { writeText: async (t: string) => { navCopied.push(t) } } }
      expect(await copyTextWithExtensionSdk('', { clipboardWrite: async (t: string) => { extCopied.push(t) } })).toBe(false)
      expect(await copyTextWithExtensionSdk('line 1\nline 2', { clipboardWrite: async (t: string) => { extCopied.push(t) } })).toBe(true)
      expect(extCopied).toEqual(['line 1\nline 2'])
      expect(navCopied).toEqual([])

      // Fallback when clipboardWrite throws or is missing
      expect(await copyTextWithExtensionSdk('fallback_throw', { clipboardWrite: async () => { throw new Error('sandbox denied') } })).toBe(true)
      expect(await copyTextWithExtensionSdk('fallback_missing', undefined)).toBe(true)
      expect(navCopied).toEqual(['fallback_throw', 'fallback_missing'])
    } finally {
      g.navigator = prevNav
    }

    // 2. StudioMarkdown: GFM pipe tables, --- <hr>, and <ol start={firstNum}>
    type Elem = React.ReactElement<Record<string, unknown>>
    const gfmMd = [
      '| Category | Formula | Revenue |',
      '| :--- | :---: | ---: |',
      '| Outerwear | `price | qty` | $142,500 |',
      '| Coats \\| Parkas | **gross** | $84,120 |',
      '',
      '---',
      '',
      '3. Third step after break',
      '4. Fourth step',
    ].join('\n')
    const mdRoot = StudioMarkdown({ text: gfmMd }) as Elem
    const mdBlocks = mdRoot.props.children as Elem[]
    expect(mdBlocks).toHaveLength(3)
    expect(mdBlocks[0].type).toBe('div')
    expect(mdBlocks[0].props.className).toBe('dab-py-table-wrap')
    const tableEl = mdBlocks[0].props.children as Elem
    expect(tableEl.type).toBe('table')
    expect(tableEl.props['data-testid']).toBe('chat-markdown-table')
    const [theadEl, tbodyEl] = tableEl.props.children as [Elem, Elem]
    const thCells = ((theadEl.props.children as Elem).props.children as Elem[])
    expect(thCells).toHaveLength(3)
    expect(thCells.map((th) => (th.props.style as { textAlign?: string } | undefined)?.textAlign)).toEqual(['left', 'center', 'right'])
    const trRows = tbodyEl.props.children as Elem[]
    expect(trRows).toHaveLength(2)
    expect(mdBlocks[1].type).toBe('hr')
    expect(mdBlocks[1].props.className).toBe('dab-md-hr')
    expect(mdBlocks[2].type).toBe('ol')
    expect(mdBlocks[2].props.start).toBe(3)
    expect((mdBlocks[2].props.children as Elem[])).toHaveLength(2)

    // 3. Untruncated formatThinkingTraceMarkdown + 2-turn fetchConversationSandboxDebugMarkdown
    const longOutput = `SELECT ${'col_metric_value, '.repeat(60)}FROM order_items -- END_MARKER_999`
    expect(longOutput.length).toBeGreaterThan(900)
    const singleTurnMd = formatThinkingTraceMarkdown([
      { id: 's1', kind: 'codemode', title: 'Executing Looker queries...', content: longOutput, status: 'done' },
    ])
    expect(singleTurnMd).toContain('END_MARKER_999')

    const threadMd = formatConversationThreadMarkdown(
      [
        { role: 'user', text: 'Build revenue app' },
        { role: 'assistant', text: 'Built app.', interactionId: 'int_t1', activitySteps: [{ id: 's1', kind: 'thought', title: 'Plan', content: longOutput, status: 'done' }] },
      ],
      { title: 'Revenue App Thread', conversationId: 'conv_42', liveActivitySteps: [{ id: 's_live', kind: 'code_execution', title: 'python3 /workspace/bundle_app.py', status: 'running' }], busyStatus: 'Bundling...' }
    )
    expect(threadMd).toContain('END_MARKER_999')
    expect(threadMd).toContain('Live / In-Flight Activity (Bundling...)')
    expect(threadMd).toContain('python3 /workspace/bundle_app.py')

    const longThought = `Analyzing schema cardinality across dimensions: ${' products.category '.repeat(55)} [FULL_THOUGHT_TAIL]`
    const proxyCalls: string[] = []
    const debugClipWrites: string[] = []
    const mockDebugExt = {
      clipboardWrite: async (t: string) => { debugClipWrites.push(t) },
      serverProxy: async (url: string) => {
        proxyCalls.push(url)
        if (url.endsWith('/interactions/int_turn_2')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn_2',
              previous_interaction_id: 'int_turn_1',
              status: 'completed',
              environment_id: 'env_live_sandbox_77',
              usage: { input_tokens: 1200, output_tokens: 450, thought_tokens: 310 },
              input: [{ type: 'text', text: 'Add gross margin breakdown and write /workspace/analysis.md' }],
              steps: [
                { id: 'st_2a', type: 'code_execution', language: 'BASH', command: 'python3 /workspace/bundle_app.py /workspace/apps/rev-app/app.js && cat /workspace/skills/data-apps/SKILL.md', stdout: 'BUNDLE_STDOUT_FULL_OK' },
                { id: 'st_2b', type: 'function_call', name: 'run_looker_codemode', arguments: { thought: longThought, code: 'return sdk.run_inline_query("json", {"model":"thelook","view":"order_items"})' } },
                { id: 'st_2c', type: 'function_result', name: 'run_looker_codemode', call_id: 'st_2b', result: { rows: [{ category: 'Outerwear', margin: 98412.5 }] } },
              ],
              output_text: 'Updated Data App and saved `/workspace/analysis.md`.',
            }),
          }
        }
        if (url.endsWith('/interactions/int_turn_1')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn_1',
              previous_interaction_id: 'int_prewarm_0',
              status: 'completed',
              environment_id: 'env_live_sandbox_77',
              input: [{ type: 'text', text: 'Create initial revenue Data App' }],
              steps: [{ id: 'st_1a', type: 'thought', thought: 'Initial Turn 1 reasoning step' }],
              output_text: 'Created `/workspace/apps/rev-app/app.js`.',
            }),
          }
        }
        if (url.endsWith('/interactions/int_prewarm_0')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_prewarm_0',
              status: 'completed',
              environment_id: 'env_live_sandbox_77',
              input: [{ type: 'text', text: '[PREWARM: initialize container]' }],
              output_text: 'Ready.',
            }),
          }
        }
        if (url.includes('/environments/env_live_sandbox_77/files/workspace/apps/rev-app/app.js')) {
          return { ok: true, status: 200, body: 'export class RevApp extends DataApp { /* FULL_APP_JS_SOURCE */ }' }
        }
        if (url.includes('/environments/env_live_sandbox_77/files/workspace/analysis.md')) {
          return { ok: true, status: 200, body: '# Margin Analysis\nOuterwear drove +18.4% YoY.' }
        }
        return { ok: false, status: 404, body: 'Not found' }
      },
    }

    const sandboxDumpMd = await fetchConversationSandboxDebugMarkdown({
      extensionSDK: mockDebugExt,
      auth: { mode: 'apikey', apiKey: 'test_key' },
      conversationId: 'conv_app_42',
      label: 'Executive Revenue App',
      useCase: 'app',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'high',
      lastInteractionId: 'int_turn_2',
      messages: [
        { role: 'user', text: 'Create initial revenue Data App' },
        { role: 'assistant', text: 'Created app.', interactionId: 'int_turn_1' },
        { role: 'user', text: 'Add gross margin breakdown and write /workspace/analysis.md' },
        { role: 'assistant', text: 'Updated Data App and saved `/workspace/analysis.md`.', interactionId: 'int_turn_2' },
      ],
    })
    await copyTextWithExtensionSdk(sandboxDumpMd, mockDebugExt)

    expect(debugClipWrites).toEqual([sandboxDumpMd])
    // Chronological order: Turn 1 (int_turn_1) appears before Turn 2 (int_turn_2), and [PREWARM:] is skipped
    expect(sandboxDumpMd).not.toContain('int_prewarm_0')
    expect(sandboxDumpMd.indexOf('### Turn 1 Interaction: `int_turn_1`')).toBeLessThan(
      sandboxDumpMd.indexOf('### Turn 2 Interaction: `int_turn_2`')
    )
    expect(sandboxDumpMd).toContain('[FULL_THOUGHT_TAIL]')
    expect(sandboxDumpMd).toContain('BUNDLE_STDOUT_FULL_OK')
    expect(sandboxDumpMd).toContain('98412.5')
    expect(sandboxDumpMd).toContain('### `/workspace/apps/rev-app/app.js`')
    expect(sandboxDumpMd).toContain('FULL_APP_JS_SOURCE')
    expect(sandboxDumpMd).toContain('### `/workspace/analysis.md`')
    expect(sandboxDumpMd).toContain('Outerwear drove +18.4% YoY.')
    // Static /workspace/skills/data-apps/SKILL.md was NOT fetched over network
    expect(proxyCalls.some((u) => u.includes('skills/data-apps'))).toBe(false)

    // 4. Refreshed DOC_UI_COMPONENTS.LookmlTurnSkills & USE_CASE_GUIDES
    const slashPreview = DOC_UI_COMPONENTS.LookmlTurnSkills() as Elem
    expect(slashPreview.props['data-testid']).toBe('doc-slash-skill-menu-preview')
    const previewJson = JSON.stringify(slashPreview)
    for (const skId of ['/looker-project-onboarding', '/lookml-field-curation', '/lookml-tests']) {
      expect(previewJson).toContain(skId)
    }
    expect(USE_CASE_GUIDES.lookml.markdown).toContain('/looker-project-onboarding')
    expect(USE_CASE_GUIDES.auto.markdown).toContain('@explore:')
    expect(USE_CASE_GUIDES.dashboard.markdown).toContain('LookML Dashboards')
  })

}
