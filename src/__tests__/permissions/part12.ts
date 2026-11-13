import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AGENTS_MD, BOOTSTRAP_LOOKML_PY, buildNativeContentGuide, buildWorkspaceSources,
  BUILTIN_SKILLS_FILES, BUNDLE_APP_PY, LkrCodeMode, LOOKER_DASHBOARD_SKILL_MD,
  LOOKER_PROJECT_ONBOARDING_SKILL_MD, NATIVE_CONTENT_GUIDE_MD, runAntigravityTurn, SANDBOX_AGENT_SKILL_FILES,
  wrapDashboardCodeMode,
} from '../../antigravity'
import {
  normalizeLookerProjectRootUrl, openOrCopyMarkdownLink, parseInViewerLookerLink, resolveLookerEmbedTarget,
  StudioMarkdown,
} from '../../components/StudioWorkspace'
import {
  clearArtifactServiceCache, ConversationRecord, hydrateConversationContentItems, normalizeStudioContentItem,
  saveNativeContentArtifact, saveUserConversation, upsertStudioContentItem,
} from '../../lookerApi'
import {
  extractLookmlDashboardsFromBundle, loadLookmlSessionArtifact, LookmlPreviewPane, mergeLookmlFiles,
  resolveLookmlCanonicalProjectId, saveLookmlSessionArtifact,
} from '../../lookmlTool'

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

export function registerPermissionsPart12Tests(): void {
  test('64. Issue #155: preserves previous_interaction_id + extracts bundles across multi-use-case turns, unifies contentItems (lookml/script/hidden/modified), prunes Looker Artifacts bloat, and isolates studio-conversation-debugger + root AGENTS.md rule', async () => {
    clearArtifactServiceCache()

    // 1. Cross-use-case continuity: LookML session -> Dashboard turn preserves previous_interaction_id and extracts <NATIVE_CONTENT_BUNDLE> even when toolMode === 'lookml'
    const postedBodies: MockInteractionPostBody[] = []
    const mockExtSdk = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        if (init?.body) postedBodies.push(JSON.parse(String(init.body)) as MockInteractionPostBody)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_cross_mode_2',
            environment_id: 'env_shared_155',
            status: 'completed',
            output_text:
              '<USE_CASE>dashboard</USE_CASE>\nCreated Executive KPI UDD.\n<NATIVE_CONTENT_BUNDLE>{"id":"34","content_type":"dashboard","title":"Executive KPI UDD","folder_id":"1","tile_count":4}</NATIVE_CONTENT_BUNDLE>',
          }),
        }
      },
    }

    const crossTurn = await runAntigravityTurn({
      sdk: asSdk({ ok: async <T>(p: T) => p }),
      extensionSDK: mockExtSdk,
      userId: '1',
      conversationId: 'conv_1762720000',
      environmentId: 'env_shared_155',
      auth: { mode: 'apikey' },
      session: {
        environmentId: 'env_shared_155',
        lastInteractionId: 'int_lookml_turn_1',
        conversationId: 'conv_1762720000',
        toolType: 'lookml',
        explores: ['ecom::orders'],
      },
      mode: 'data_app',
      useCase: 'auto',
      toolMode: 'lookml',
      allowedModes: ['app', 'dashboard', 'lookml', 'tile', 'health-check', 'conversational-analytics'],
      selectedExplores: ['ecom::orders'],
      schemaMarkdown: '# Schema',
      userPrompt: 'Now build an Executive KPI UDD dashboard on orders',
      onStatus: () => {},
    })

    expect(postedBodies[0]?.previous_interaction_id).toBe('int_lookml_turn_1')
    expect(crossTurn.resolvedUseCase).toBe('dashboard')
    expect(crossTurn.nativeBundle?.id).toBe('34')
    expect(crossTurn.nativeBundle?.title).toBe('Executive KPI UDD')

    // 2. Unified contentItems hydration for lookml/script/report + hidden & source='modified' + embed target preload on lookml/script
    expect(
      hydrateConversationContentItems({
        id: 'conv_lml',
        type: 'lookml',
        label: 'Orders Model Onboarding',
        content: { sessionId: 'ecom_1762720001', projectId: 'ecom' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'lookml:ecom',
        id: 'ecom',
        sessionId: 'ecom_1762720001',
        projectId: 'ecom',
        contentType: 'lookml',
        title: 'LookML: ecom',
      }),
    ])
    expect(
      hydrateConversationContentItems({
        id: 'conv_scr',
        type: 'tile',
        label: 'Space Audit Script',
        content: { scriptId: 'audit_1' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'script:audit_1',
        id: 'audit_1',
        contentType: 'script',
        title: 'Space Audit Script',
      }),
    ])
    expect(
      hydrateConversationContentItems({
        id: 'conv_rep',
        type: 'health-check',
        label: '3-Pillar Audit',
        content: { reportId: 'hc_9' },
      })
    ).toEqual([
      expect.objectContaining({
        key: 'report:hc_9',
        id: 'hc_9',
        contentType: 'report',
        title: '3-Pillar Audit',
      }),
    ])

    const step1 = upsertStudioContentItem([], {
      id: '34',
      dashboardId: '34',
      contentType: 'dashboard',
      title: 'Executive KPI UDD',
      source: 'created',
      hidden: true,
    })
    expect(step1.item.hidden).toBe(true)
    const step2 = upsertStudioContentItem(step1.items, {
      id: '34',
      dashboardId: '34',
      contentType: 'dashboard',
      title: 'Executive KPI UDD v2',
      source: 'modified',
    })
    expect(step2.item.hidden).toBe(false)
    expect(step2.item.source).toBe('created')
    expect(step2.item.title).toBe('Executive KPI UDD v2')

    expect(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({ id: 'ecom_1', contentType: 'lookml', title: 'LookML' }),
        nonce: 1,
      }).kind
    ).toBe('preload')
    expect(
      resolveLookerEmbedTarget({
        activeContentItem: normalizeStudioContentItem({ id: 'scr_1', contentType: 'script', title: 'Script' }),
        nonce: 1,
      }).kind
    ).toBe('preload')

    // 3. Lightweight Looker Artifacts pruning: strip activitySteps, images, rawCode from user_conversations:1 and omit studio.messages from obj_lookml_* & obj_dashboard_*
    const rawArtifactStore = new Map<string, string>()
    const mockSdk = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) => {
        const hit = rawArtifactStore.get(key)
        return hit ? [{ key, version: 1, value: hit }] : []
      },
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        for (const u of updates) rawArtifactStore.set(u.key, u.value)
        return updates
      },
    })

    await saveUserConversation(mockSdk, '1', {
      id: 'conv_1762720000',
      type: 'app',
      label: 'Lightweight Pruning Test',
      interactionId: 'int_155',
      environmentId: 'env_155',
      activeContentTabKey: 'data_app:42',
      contentItems: [
        {
          key: 'data_app:42',
          id: '42',
          dashboardId: '42',
          contentType: 'data_app',
          title: 'Revenue App',
          embedPath: '/embed/dashboards/42',
          rawCode: 'export class HugeMultiMegabyteApp {}',
          source: 'created',
          hidden: true,
        },
      ],
      messages: [
        {
          role: 'user',
          text: 'Build app from screenshot',
          images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA'],
        } as unknown as ConversationRecord['messages'] extends Array<infer M> ? M : never,
        {
          role: 'assistant',
          text: 'Published Data App #42.',
          interactionId: 'int_155',
          dashboardId: '42',
          thinkingDurationSec: 4,
          activitySteps: [{ id: 's1', kind: 'code', title: 'Bundled app', status: 'done', content: 'huge trace' }],
        },
      ],
      updatedAt: '2026-11-09T20:00:00Z',
    })

    const persistedConvsJson = rawArtifactStore.get('user_conversations:1') || '[]'
    expect(persistedConvsJson).not.toContain('HugeMultiMegabyteApp')
    expect(persistedConvsJson).not.toContain('data:image/png;base64')
    expect(persistedConvsJson).not.toContain('activitySteps')
    const reloadedConvs = JSON.parse(persistedConvsJson) as ConversationRecord[]
    expect(reloadedConvs[0]?.contentItems?.[0]?.hidden).toBe(true)
    expect(reloadedConvs[0]?.contentItems?.[0]?.rawCode).toBeUndefined()
    expect(reloadedConvs[0]?.messages).toEqual([
      { role: 'user', text: 'Build app from screenshot' },
      { role: 'assistant', text: 'Published Data App #42.', interactionId: 'int_155', dashboardId: '42', thinkingDurationSec: 4 },
    ])

    await saveLookmlSessionArtifact({
      sdk: mockSdk,
      userId: '1',
      bundle: {
        id: 'ecom_1762720001',
        title: 'LookML Session',
        project_id: 'ecom',
        files: [],
        validation: { passed: true, error_count: 0, errors: [] },
        tests: [],
        queries: [],
      },
      studio: {
        explores: ['ecom::orders'],
        lastInteractionId: 'int_lml_1',
        environmentId: 'env_155',
        messages: [{ role: 'user', text: 'Should not duplicate in obj_lookml' }],
      },
    })
    const loadedLookmlObj = await loadLookmlSessionArtifact(mockSdk, undefined, 'ecom_1762720001')
    expect(loadedLookmlObj.id).toBe('ecom')
    expect(loadedLookmlObj.studio?.messages).toBeUndefined()
    expect(rawArtifactStore.get('obj_lookml_ecom')).toBeDefined()
    expect(rawArtifactStore.get('obj_lookml_ecom')).not.toContain('Should not duplicate in obj_lookml')

    await saveNativeContentArtifact(
      mockSdk,
      undefined,
      '1',
      { id: '34', content_type: 'dashboard', title: 'Executive KPI UDD' },
      '1',
      null,
      {
        explores: ['ecom::orders'],
        lastInteractionId: 'int_dash_1',
        environmentId: 'env_155',
        messages: [{ role: 'user', text: 'Should not duplicate in obj_dashboard' }],
      }
    )
    expect(rawArtifactStore.get('obj_dashboard_34')).not.toContain('Should not duplicate in obj_dashboard')

    // 4. Root-only AGENTS.md rule & studio-conversation-debugger / data-apps-sync excluded from sandbox bundle
    const repoRoot = path.resolve(__dirname, '../../..')
    const rootAgents = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(rootAgents).toContain('## Looker Artifacts Lightweight-Only Rule')
    expect(rootAgents).toContain('.agents/skills/data-apps-sync/SKILL.md')
    expect(AGENTS_MD).not.toContain('Looker Artifacts Lightweight-Only Rule')
    expect(BOOTSTRAP_LOOKML_PY).not.toContain('"lookml-session"')
    expect(
      Object.keys(SANDBOX_AGENT_SKILL_FILES).some((k) => k.includes('studio-conversation-debugger') || k.includes('data-apps-sync'))
    ).toBe(false)
    expect(
      Object.keys(BUILTIN_SKILLS_FILES).some((k) => k.includes('studio-conversation-debugger') || k.includes('data-apps-sync'))
    ).toBe(false)
    expect(
      buildWorkspaceSources({ schemaMarkdown: '# Schema' }).some((s) =>
        s.target.includes('studio-conversation-debugger') || s.target.includes('data-apps-sync')
      )
    ).toBe(false)
  })

  test('66. Issue #167: enforces LookML dashboard field-existence & validate_project warning gates, clean summaries, date timeframe guard in BUNDLE_APP_PY, 4-row PoP KPIs, and card-border compare', async () => {
    let exploreHits = 0
    let validationErrors: Array<{ severity: string; file_path?: string; message: string }> = []
    const mockDashSdk = asSdk({
      authSession: {
        transport: {
          rawRequest: async (method: string, reqPath: string, _qp?: Record<string, unknown>, body?: Record<string, unknown>) => {
            const m = method.toUpperCase()
            if (m === 'GET' && reqPath.includes('/lookml_models/ecom/explores/order_items')) {
              exploreHits += 1
              return { statusCode: 200, ok: true, body: { fields: { dimensions: [{ name: 'order_items.created_date' }, { name: 'products.category' }], measures: [{ name: 'order_items.total_sale_price' }, { name: 'order_items.count' }], filters: [], parameters: [] } } }
            }
            if (m === 'POST' && reqPath.includes('/projects/ecom_proj/validate')) return { statusCode: 200, ok: true, body: { errors: validationErrors } }
            if (m === 'POST' && reqPath === '/dashboards') return { statusCode: 200, ok: true, body: { id: '77', title: body?.title } }
            if (m === 'POST' && reqPath === '/queries') return { statusCode: 200, ok: true, body: { id: '901' } }
            if (m === 'POST' && reqPath === '/dashboard_elements') return { statusCode: 200, ok: true, body: { id: '501' } }
            if (m === 'GET' && reqPath.includes('/dashboard_layouts')) return { statusCode: 200, ok: true, body: [{ id: 'lay_77', dashboard_layout_components: [{ id: 'c_1', dashboard_element_id: '501' }] }] }
            return { statusCode: 200, ok: true, body: { id: '1', path: body?.path || 'dashboards/pulse.dashboard.lookml' } }
          },
        },
      },
    })

    const badUddOut = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode('return upsert_udd("Commerce Overview", folder_id="5", filters=[{"name": "bad_flt", "dimension": "order_items.excluded_filter"}], tiles=[{"title": "KPI 1", "fields": ["order_items.excluded_brand_count"], "vis_config": {"type": "single_value"}}, {"title": "Trend", "fields": ["order_items.created_date", "order_items.count"], "pivots": ["products.unknown_pivot"], "sorts": ["order_items.unknown_sort desc"]}])'),
      sdk: mockDashSdk,
      vars: { target_model: 'ecom', target_explore: 'order_items', target_folder_id: '5' },
    })
    expect(exploreHits).toBe(1)
    for (const badTok of ['ValueError', 'order_items.excluded_filter', 'order_items.excluded_brand_count', 'products.unknown_pivot', 'order_items.unknown_sort', 'order_items.total_sale_price', 'order_items.created_date']) {
      expect(badUddOut).toContain(badTok)
    }

    const emptyTileOut = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode('return upsert_udd("Empty Tile", folder_id="5", tiles=[{"title": "Broken KPI", "fields": [], "vis_config": {"type": "single_value"}}])'),
      sdk: mockDashSdk,
      vars: { target_model: 'ecom', target_explore: 'order_items' },
    })
    expect(emptyTileOut).toContain('empty fields=[]')

    validationErrors = [{ severity: 'warning', file_path: 'dashboards/ecommerce_overview.dashboard.lookml', message: 'Unknown field "order_items.brand_count" referenced in dashboard element' }]
    const warnLookmlDashOut = await LkrCodeMode.runPythonCode({
      code: wrapDashboardCodeMode('return upsert_lookml_dashboard(project_id="ecom_proj", model="ecom", dashboard_name="ecommerce_overview", title="Overview", tiles=[{"title": "Orders", "explore": "order_items", "fields": ["order_items.count"], "vis_config": {"type": "single_value"}}])'),
      sdk: mockDashSdk,
      vars: { target_model: 'ecom', target_explore: 'order_items', target_project_id: 'ecom_proj' },
    })
    expect(warnLookmlDashOut).toContain('[warning]')
    expect(warnLookmlDashOut).toContain('Unknown field')

    validationErrors = []
    const okLookmlDashOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: wrapDashboardCodeMode('return upsert_lookml_dashboard(project_id="ecom_proj", model="ecom", dashboard_name="ecommerce_overview", title="Overview", folder_id="5", tiles=[{"title": "Orders", "explore": "order_items", "fields": ["order_items.count"], "sorts": ["order_items.count desc"], "vis_config": {"type": "single_value"}}])'),
        sdk: mockDashSdk,
        vars: { target_model: 'ecom', target_explore: 'order_items', target_project_id: 'ecom_proj', target_folder_id: '5' },
      })
    )
    expect((okLookmlDashOut.result || okLookmlDashOut).lookml_dashboard_id).toBe('ecom::ecommerce_overview')

    for (const doc of [LOOKER_PROJECT_ONBOARDING_SKILL_MD, LOOKER_DASHBOARD_SKILL_MD]) {
      expect(doc).toContain('single-table')
      expect(doc).toContain('ALL_FIELDS*')
    }
    const onboardingNativeGuide = buildNativeContentGuide({ selectedExplores: [], primaryModel: 'ecom_proj', primaryExplore: 'order_items', folderId: '5', lookmlProjectId: 'ecom_proj' })
    for (const summaryDoc of [LOOKER_DASHBOARD_SKILL_MD, LOOKER_PROJECT_ONBOARDING_SKILL_MD, NATIVE_CONTENT_GUIDE_MD, onboardingNativeGuide]) {
      for (const forbiddenReplyTok of ['Row 0', '24-Column Grid', 'single_value', 'looker_area', 'looker_pie', 'looker_column', 'looker_bar', 'looker_grid', '[Open <Dashboard Title>](/dashboards/<id>)']) {
        expect(summaryDoc).toContain(forbiddenReplyTok)
      }
    }

    const workDir = mkdtempSync(path.join(tmpdir(), 'dab-167-test-'))
    try {
      const bundlePyPath = path.join(workDir, 'bundle_app.py')
      writeFileSync(bundlePyPath, BUNDLE_APP_PY.replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`), 'utf8')
      const env = { ...process.env }
      for (const badBody of [
        "fields: ['orders.created_day', 'orders.count']",
        'fields: [`${m.dateBase}_day`, m.field]',
        'const PERIOD_DEFAULTS = { day: 90, week: 53 }; const f = `${m.dateBase}_${this.period}`',
      ]) {
        const badSrc = `import { DataApp, html } from '/runtime/data-app.js';\nexport class BadApp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; } render() { const m = { dateBase: 'orders.created', field: 'orders.count' }; ${badBody}; return html\`<app-grid .query=\${{ fields: ['orders.count'] }}></app-grid>\`; } }\ncustomElements.define('bad-app', BadApp);`
        expect(() => execFileSync('python3', [bundlePyPath, '--stdin', 'Bad App', path.join(workDir, 'bad.js')], { input: badSrc, env, encoding: 'utf8', stdio: 'pipe' })).toThrow(/invalid-lookml-day-timeframe/)
      }
      const goodSrc = `import { DataApp, html } from '/runtime/data-app.js';\nconst PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 };\nconst WINDOW_OPTIONS = { date: [14, 30, 60, 90, 180], week: [12, 26, 53, 104], month: [6, 12, 24, 60], year: [3, 5, 10] };\nconst UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' };\nexport class GoodApp extends DataApp { constructor() { super(); this.lookerModel = 'ecom'; this.explore = 'orders'; this.period = 'date'; this.periodCount = PERIOD_DEFAULTS.date; } render() { const m = { dateBase: 'orders.created', field: 'orders.count' }; const dateDim = \`\${m.dateBase}_\${this.period}\`; return html\`<app-chart type="areaspline" .query=\${{ fields: [dateDim, m.field], limit: String(WINDOW_OPTIONS[this.period][3]) }}></app-chart><app-grid .query=\${{ fields: ['orders.created_day_of_week', 'orders.created_day_of_month', 'orders.created_day_of_year', 'orders.created_hour_of_day', m.field], filters: { 'orders.created_date': \`\${this.periodCount} \${UNITS[this.period]}\` } }}></app-grid>\`; } }\ncustomElements.define('good-app', GoodApp);`
      expect(execFileSync('python3', [bundlePyPath, '--stdin', 'Good App', path.join(workDir, 'good.js')], { input: goodSrc, env, encoding: 'utf8' })).toContain('<DATA_APP_BUNDLE>')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('67. Issue #166: keys LookML tabs & artifacts by canonical projectId with multi-turn file merging, extracts .dashboard.lookml into lookml_dashboard tabs, normalizes /projects/<id> vs /files/<path>, routes content links in-viewer, and normalizes inline LaTeX operators', async () => {
    // 1. Canonical LookML projectId tab dedupe & multi-turn obj_lookml_<projectId> file merging + legacy timestamped load fallback
    expect(resolveLookmlCanonicalProjectId({ id: 'bryan_test2_1762720001', project_id: 'bryan_test2', model_name: 'ecom' })).toBe('bryan_test2')
    expect(resolveLookmlCanonicalProjectId({ id: 'bryan_test2_1762720001', project_id: '', model_name: 'ecom' })).toBe('ecom')
    expect(resolveLookmlCanonicalProjectId({ id: 'bryan_test2_1762720001', project_id: '' })).toBe('bryan_test2_1762720001')

    const lmlStep1 = upsertStudioContentItem([], {
      id: 'bryan_test2_1001',
      sessionId: 'bryan_test2_1001',
      projectId: 'bryan_test2',
      contentType: 'lookml',
      title: 'Stage 1 Bronze',
      source: 'created',
    })
    expect(lmlStep1.activeKey).toBe('lookml:bryan_test2')
    expect(lmlStep1.item.title).toBe('LookML: bryan_test2')
    const lmlStep2 = upsertStudioContentItem(lmlStep1.items, {
      id: 'bryan_test2_1002',
      sessionId: 'bryan_test2_1002',
      projectId: 'bryan_test2',
      contentType: 'lookml',
      title: 'Stage 2 Silver',
      source: 'modified',
    })
    expect(lmlStep2.items).toHaveLength(1)
    expect(lmlStep2.activeKey).toBe('lookml:bryan_test2')
    expect(lmlStep2.item.title).toBe('LookML: bryan_test2')

    const mergedFiles = mergeLookmlFiles(
      [
        { path: 'bryan_test2.model.lkml', action: 'created', content: 'connection: "bq"\n', diff: '+connection: "bq"\n' },
        { path: 'bronze/orders.view.lkml', action: 'created', content: 'view: orders {}\n', diff: '+view: orders {}\n' },
      ],
      [
        { path: 'bryan_test2.model.lkml', action: 'updated', content: 'connection: "bq"\ninclude: "/silver/*.explore.lkml"\n', diff: '+include: "/silver/*.explore.lkml"\n' },
        { path: 'silver/orders.explore.lkml', action: 'created', content: 'explore: orders {}\n', diff: '+explore: orders {}\n' },
      ]
    )
    expect(mergedFiles).toHaveLength(3)
    expect(mergedFiles.find((f) => f.path === 'bryan_test2.model.lkml')?.content).toContain('silver/*.explore.lkml')
    expect(mergedFiles.find((f) => f.path === 'bronze/orders.view.lkml')?.content).toBe('view: orders {}\n')

    const store166 = new Map<string, string>()
    store166.set(
      'obj_lookml_legacy_proj_1762700999',
      JSON.stringify({
        id: 'legacy_proj_1762700999',
        type: 'lookml',
        title: 'Legacy Session',
        updatedAt: '2026-11-09T00:00:00Z',
        createdBy: '1',
        bundle: { id: 'legacy_proj_1762700999', title: 'Legacy Session', project_id: 'legacy_proj', files: [{ path: 'legacy.model.lkml', content: 'connection: "c"\n' }] },
      })
    )
    const sdk166 = asSdk({
      ok: async <T>(p: T) => p,
      artifact: async ({ key }: { key: string }) => {
        const hit = store166.get(key)
        return hit ? [{ key, version: 1, value: hit }] : []
      },
      search_artifacts: async ({ key }: { key: string }) => {
        const prefix = key.replace(/%$/, '')
        return Array.from(store166.entries())
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({ key: k, version: 1, value: v }))
      },
      update_artifacts: async (_ns: string, updates: Array<{ key: string; value: string }>) => {
        updates.forEach((u) => store166.set(u.key, u.value))
        return updates
      },
    })
    await saveLookmlSessionArtifact({
      sdk: sdk166,
      userId: '1',
      bundle: {
        id: 'bryan_test2_1',
        title: 'Turn 1',
        project_id: 'bryan_test2',
        files: [{ path: 'bryan_test2.model.lkml', action: 'created', content: 'connection: "bq"\n' }],
      },
      studio: { explores: [] },
    })
    const savedT2 = await saveLookmlSessionArtifact({
      sdk: sdk166,
      userId: '1',
      bundle: {
        id: 'bryan_test2_2',
        title: 'Turn 2',
        project_id: 'bryan_test2',
        files: [{ path: 'bronze/orders.refinement.lkml', action: 'created', content: 'view: +orders {}\n' }],
      },
      studio: { explores: ['bryan_test2::orders'] },
    })
    expect(savedT2.id).toBe('bryan_test2')
    expect(savedT2.objKey).toBe('obj_lookml_bryan_test2')
    expect(savedT2.payload.bundle.files.map((f) => f.path)).toEqual([
      'bryan_test2.model.lkml',
      'bronze/orders.refinement.lkml',
    ])
    const legacyLoaded = await loadLookmlSessionArtifact(sdk166, undefined, 'legacy_proj')
    expect(legacyLoaded.bundle.project_id).toBe('legacy_proj')

    // 2. Fatal-only inline alert strip in LookmlPreviewPane
    const fatalHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: {
          id: 'bryan_test2',
          title: 'LookML: bryan_test2',
          project_id: 'bryan_test2',
          files: [{ path: 'bryan_test2.model.lkml', content: 'connection: "bq"\n' }],
          validation: {
            passed: false,
            error_count: 2,
            errors: [
              { message: 'Unused view warning', severity: 'warning' },
              { message: 'Unknown connection "bad_conn"', file_path: 'bryan_test2.model.lkml', line_number: 1, severity: 'fatal' },
            ],
          },
        },
        hostUrl: 'https://dev.looker.com',
      })
    )
    expect(fatalHtml).toContain('Unknown connection &quot;bad_conn&quot;')
    expect(fatalHtml).not.toContain('Unused view warning')

    // 3. Looker IDE project root URL normalization (/projects/<id> vs /projects/<id>/files/<path>)
    expect(normalizeLookerProjectRootUrl('/projects/bryan_test2/files')).toBe('/projects/bryan_test2')
    expect(normalizeLookerProjectRootUrl('https://dev.looker.com/projects/bryan_test2/files?branch=dev')).toBe(
      'https://dev.looker.com/projects/bryan_test2?branch=dev'
    )
    expect(normalizeLookerProjectRootUrl('/projects/bryan_test2/files/bronze/orders.view.lkml')).toBe(
      '/projects/bryan_test2/files/bronze/orders.view.lkml'
    )
    const openedProjUrls: string[] = []
    await openOrCopyMarkdownLink('/projects/bryan_test2/files', 'https://dev.looker.com', {
      openBrowserWindow: (u: string) => openedProjUrls.push(u),
    })
    await openOrCopyMarkdownLink('/projects/bryan_test2/files/bronze/orders.view.lkml', 'https://dev.looker.com', {
      openBrowserWindow: (u: string) => openedProjUrls.push(u),
    })
    expect(openedProjUrls).toEqual(['/projects/bryan_test2', '/projects/bryan_test2/files/bronze/orders.view.lkml'])

    // 4. .dashboard.lookml extraction + parseInViewerLookerLink & markdown-link-external-btn
    const extractedDash = extractLookmlDashboardsFromBundle({
      id: 'bryan_test2',
      title: 'LookML: bryan_test2',
      project_id: 'bryan_test2',
      model_name: 'bryan_test2',
      files: [
        {
          path: 'dashboards/exec_pulse.dashboard.lookml',
          action: 'created',
          content: '- dashboard: exec_pulse\n  title: Executive Sales Pulse\n  layout: newspaper\n',
        },
      ],
    })
    expect(extractedDash).toEqual([
      {
        slug: 'exec_pulse',
        title: 'Executive Sales Pulse',
        model: 'bryan_test2',
        id: 'bryan_test2::exec_pulse',
        embedPath: '/embed/dashboards/bryan_test2::exec_pulse',
      },
    ])

    expect(parseInViewerLookerLink('/dashboards/bryan_test2::exec_pulse', 'Open Executive Sales Pulse', 'https://dev.looker.com')).toEqual({
      id: 'bryan_test2::exec_pulse',
      contentType: 'lookml_dashboard',
      title: 'Executive Sales Pulse',
      embedPath: '/embed/dashboards/bryan_test2::exec_pulse',
      externalPath: '/dashboards/bryan_test2::exec_pulse',
    })
    expect(parseInViewerLookerLink('https://dev.looker.com/looks/15', 'Monthly Churn Look', 'https://dev.looker.com')).toMatchObject({
      id: '15',
      contentType: 'look',
      embedPath: '/embed/looks/15',
      externalPath: '/looks/15',
    })
    expect(parseInViewerLookerLink('/boards/9', 'Exec Board', 'https://dev.looker.com')).toMatchObject({
      id: '9',
      contentType: 'board',
      embedPath: '/embed/boards/9',
    })
    expect(parseInViewerLookerLink('/explore/thelook/order_items', 'Orders Explore', 'https://dev.looker.com')).toMatchObject({
      id: 'thelook::order_items',
      contentType: 'explore',
      embedPath: '/embed/explore/thelook/order_items',
    })
    expect(parseInViewerLookerLink('/projects/bryan_test2', 'Open in IDE', 'https://dev.looker.com')).toBeNull()
    expect(parseInViewerLookerLink('/admin/connections', 'Connections', 'https://dev.looker.com')).toBeNull()
    expect(parseInViewerLookerLink('/sql/abc123', 'SQL Runner', 'https://dev.looker.com')).toBeNull()

    // 5. StudioMarkdown LaTeX operator normalization outside code spans + markdown-link-external-btn + AGENTS_MD rule
    expect(AGENTS_MD).toContain('No `$...$` LaTeX')
    const mdHtml = renderToStaticMarkup(
      React.createElement(StudioMarkdown, {
        text: [
          'Flow: A $\\rightarrow$ B $\\to$ C $\\leftarrow$ D $\\leftrightarrow$ E, grid $5 \\times 5$, bounds $x \\ge 1$, $y \\leq 10$, $\\approx 99%$, price $100 to $200, inline `$\\rightarrow$`, and [Open Pulse](/dashboards/42) vs [IDE](/projects/bryan_test2).',
          '```',
          'const raw = "$\\rightarrow$"',
          '```',
        ].join('\n'),
        hostUrl: 'https://dev.looker.com',
      })
    )
    expect(mdHtml).toContain('Flow: A → B → C ← D ↔ E, grid 5 × 5, bounds x &gt;= 1, y &lt;= 10, ≈ 99%, price $100 to $200')
    expect(mdHtml).toContain('<code class="dab-md-inline-code">$\\rightarrow$</code>')
    expect(mdHtml).toContain('const raw = &quot;$\\rightarrow$&quot;')
    expect(mdHtml).toContain('data-testid="markdown-link-external-btn"')
  })

}
