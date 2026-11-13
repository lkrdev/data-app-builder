import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'

import {
  classifyLookerOperation, DATA_INVESTIGATOR_GUIDE_MD, isTextAttachmentFile, LkrCodeMode,
  runAntigravityTurn, StudioAttachedFile,
} from '../../antigravity'
import { USE_CASE_BADGES } from '../../components/StudioWorkspace'
import {
  buildDenseExploreSchema, buildStudioRoute, classifyStudioUseCase, clearLookerMetadataCache,
  convertRelativeDateFilterToFixed, extractResolvedUseCase, fetchPreloadedContentSummary, hydrateMentionedContext,
  normalizeQueryFiltersToFixedDates, parseStudioRoute, searchGlobalContentV2, SWR_DEDUPED_METHODS,
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

export function registerPermissionsPart07Tests(): void {
  test('Issue #92: preloads content_summary, searches global_search_v2, hydrates @dashboard/@look/@conversation/@explore context, and seeds /workspace/uploads', async () => {
    clearLookerMetadataCache()
    expect(SWR_DEDUPED_METHODS).toContain('content_summary')
    expect(isTextAttachmentFile('sales.csv', 'text/csv')).toBe(true)
    expect(isTextAttachmentFile('orders.refinement.lkml', 'application/octet-stream')).toBe(true)
    expect(isTextAttachmentFile('screenshot.png', 'image/png')).toBe(false)
    expect(isTextAttachmentFile('report.pdf', 'application/pdf')).toBe(false)

    const rawCalls: Array<{ method: string; path: string; queryParams?: Record<string, unknown> }> = []
    const mockSdk = asSdk({
      ok: async <T>(p: Promise<T> | T) => p,
      content_summary: async () => [
        {
          id: 'cs_901',
          content_type: 'dashboard',
          content_id: '901',
          title: 'Business Pulse',
          description: 'Executive KPIs & brand breakdown',
        },
        {
          id: 'cs_301',
          content_type: 'look',
          content_id: '301',
          title: 'Monthly Gross Margin Look',
          description: 'Margin trend by month',
        },
      ],
      dashboard: async (idOrParams: unknown) => {
        const id =
          typeof idOrParams === 'object' && idOrParams !== null && 'dashboard_id' in idOrParams
            ? String((idOrParams as { dashboard_id: unknown }).dashboard_id)
            : String(idOrParams || '')
        return {
          id,
          title: 'Business Pulse',
          description: 'Executive KPIs & brand breakdown',
          folder_id: '5',
          dashboard_filters: [{ name: 'Date', field: 'order_items.created_date' }],
          dashboard_layouts: [{ id: '10', type: 'newspaper', active: true }],
          dashboard_elements: [
            {
              id: '501',
              title: 'Revenue by Brand',
              type: 'vis',
              query: {
                model: 'thelook',
                view: 'order_items',
                fields: ['products.brand', 'order_items.total_sale_price'],
                sorts: ['order_items.total_sale_price desc'],
                limit: '15',
              },
            },
            {
              id: '502',
              title: 'Store Basket Count',
              type: 'vis',
              result_maker: {
                query: {
                  model: 'retail_ops',
                  view: 'store_transactions',
                  fields: ['store_transactions.store_region', 'store_transactions.basket_count'],
                  limit: '10',
                },
              },
            },
          ],
        }
      },
      look: async (idOrParams: unknown) => {
        const id =
          typeof idOrParams === 'object' && idOrParams !== null && 'look_id' in idOrParams
            ? String((idOrParams as { look_id: unknown }).look_id)
            : String(idOrParams || '')
        return {
          id,
          title: 'Monthly Gross Margin Look',
          folder_id: '5',
          query: {
            model: 'thelook',
            view: 'inventory_items',
            fields: ['inventory_items.cost'],
            limit: '20',
          },
        }
      },
      authSession: {
        transport: {
          rawRequest: async (
            method: string,
            reqPath: string,
            queryParams?: Record<string, unknown>
          ) => {
            rawCalls.push({ method, path: reqPath, queryParams })
            if (reqPath.includes('global_search_v2')) {
              return {
                ok: true,
                statusCode: 200,
                body: JSON.stringify({
                  sections: [
                    {
                      name: 'Dashboards',
                      items: [
                        {
                          content_type: 'dashboard',
                          content_id: '901',
                          title: 'Business Pulse',
                        },
                      ],
                    },
                  ],
                }),
              }
            }
            return { ok: true, statusCode: 200, body: '[]' }
          },
        },
      },
    })

    const preloaded = await fetchPreloadedContentSummary(mockSdk)
    expect(preloaded).toEqual([
      expect.objectContaining({ type: 'dashboard', id: '901', title: 'Business Pulse' }),
      expect.objectContaining({ type: 'look', id: '301', title: 'Monthly Gross Margin Look' }),
    ])

    const searchDashboards = await searchGlobalContentV2(mockSdk, {
      term: 'Business Pulse',
      category: 'dashboard',
      limit: 15,
    })
    expect(searchDashboards).toEqual([
      expect.objectContaining({ type: 'dashboard', id: '901', title: 'Business Pulse' }),
    ])
    expect(rawCalls.some((c) => c.path === '/api/4.0/global_search_v2')).toBe(true)

    const hydrated = await hydrateMentionedContext({
      sdk: mockSdk,
      mentions: [
        { type: 'dashboard', id: '901', title: 'Business Pulse' },
        { type: 'look', id: '301', title: 'Monthly Gross Margin Look' },
        { type: 'explore', id: 'thelook::users', title: 'Users', model: 'thelook', explore: 'users' },
        { type: 'conversation', id: 'conv_prev_1', title: 'Prior Revenue Thread' },
      ],
      conversations: [
        {
          id: 'conv_prev_1',
          type: 'app',
          label: 'Prior Revenue Thread',
          updatedAt: '2026-11-02T00:00:00Z',
          explores: ['thelook::events'],
          messages: [{ role: 'user', text: 'Analyze event funnel conversion.' }],
        },
      ],
      selectedExplores: [],
    })

    expect(hydrated.explores).toEqual([
      'thelook::order_items',
      'retail_ops::store_transactions',
      'thelook::inventory_items',
      'thelook::users',
      'thelook::events',
    ])
    expect(hydrated.extraSources.map((s) => s.target)).toEqual([
      '/workspace/context/dashboard_901.json',
      '/workspace/context/look_301.json',
      '/workspace/context/conversation_conv_prev_1.md',
    ])
    expect(hydrated.promptSummary).toContain('@dashboard:Business Pulse')
    expect(hydrated.promptSummary).toContain('/workspace/context/dashboard_901.json')
    expect(hydrated.promptSummary).toContain('@look:Monthly Gross Margin Look')
    expect(hydrated.promptSummary).toContain('@conversation:Prior Revenue Thread')

    // Verify StudioAttachedFile uploads (text/CSV + PDF + image) in runAntigravityTurn
    const turnBodies: MockInteractionPostBody[] = []
    const mockExt = {
      serverProxy: async (_url: string, init?: FetchCustomParameters) => {
        const body = init?.body ? (JSON.parse(init.body) as MockInteractionPostBody) : undefined
        if (body) turnBodies.push(body)
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'int_92_uploads',
            environment_id: 'env_92',
            status: 'completed',
            output_text: '<USE_CASE>app</USE_CASE>Built Data App from Business Pulse & CSV.',
          }),
        }
      },
    }
    const attachments: StudioAttachedFile[] = [
      {
        id: 'att_csv',
        name: 'targets.csv',
        mimeType: 'text/csv',
        size: 32,
        data: 'cmVnaW9uLHRhcmdldApXZXN0LDEwMAo=',
        dataUrl: 'data:text/csv;base64,cmVnaW9uLHRhcmdldApXZXN0LDEwMAo=',
        textContent: 'region,target\nWest,100\n',
      },
      {
        id: 'att_pdf',
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 128,
        data: 'JVBERi0xLjQK',
        dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
      },
    ]
    await runAntigravityTurn({
      sdk: mockSdk,
      extensionSDK: mockExt,
      auth: { mode: 'apikey', apiKey: 'key-92' },
      session: {},
      selectedExplores: hydrated.explores,
      schemaMarkdown: '# Schema',
      userPrompt: `Turn @dashboard:Business Pulse into a Data App\n\n${hydrated.promptSummary}`,
      images: attachments,
      extraSources: hydrated.extraSources,
      pollScheduleMs: [0],
      onStatus: () => {},
    })

    expect(turnBodies).toHaveLength(1)
    const envObj = turnBodies[0].environment as {
      sources?: Array<{ target: string; content: string }>
    }
    const targets = (envObj.sources || []).map((s) => s.target)
    expect(targets).toContain('/workspace/context/dashboard_901.json')
    expect(targets).toContain('/workspace/uploads/targets.csv')
    expect(targets).toContain('/workspace/uploads/brief.pdf')
    const csvSource = (envObj.sources || []).find((s) => s.target === '/workspace/uploads/targets.csv')
    expect(csvSource?.content).toBe('region,target\nWest,100\n')
    const inputItems = turnBodies[0].input || []
    expect(inputItems[0]?.text).toContain('/workspace/uploads/targets.csv')
    expect(inputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'document', mime_type: 'application/pdf', data: 'JVBERi0xLjQK' }),
      ])
    )
  })

  test('30. Issue #94: registers Data Investigator (data-investigator) use case, Google Doc & Slides narrative guide, LookML drill_fields in buildDenseExploreSchema, run_key_driver_analysis in LkrCodeMode, and convertRelativeDateFilterToFixed', async () => {
    // 1. Routing, aliases, badges, and classification
    expect(USE_CASE_BADGES['data-investigator']).toEqual({
      label: 'Data Investigator',
      className: 'dab-use-case-badge-investigator',
    })
    expect(buildStudioRoute('data-investigator')).toBe('/data-investigator')
    expect(buildStudioRoute('data-investigator', '42')).toBe('/data-investigator/42')
    expect(parseStudioRoute('/data-investigator/42')).toEqual({
      mode: 'app',
      objectId: '42',
      conversationId: '42',
      useCase: 'data-investigator',
      isLegacyRoute: true,
    })
    expect(parseStudioRoute('/c/conv_data-investigator_42')).toEqual({
      mode: 'app',
      objectId: '42',
      conversationId: 'conv_data-investigator_42',
      useCase: 'data-investigator',
    })
    expect(parseStudioRoute('/c/inv_42')).toEqual({
      mode: 'app',
      objectId: 'inv_42',
      conversationId: 'inv_42',
      useCase: 'data-investigator',
    })
    expect(
      classifyStudioUseCase(
        'Run a key driver analysis and root-cause investigation in a Google Doc narrative report'
      )
    ).toBe('data-investigator')
    expect(
      extractResolvedUseCase(
        '<USE_CASE>data-investigator</USE_CASE>\nBuilt Google Presentation slides investigation.',
        'Investigate revenue drop in slides'
      )
    ).toBe('data-investigator')

    // 2. DATA_INVESTIGATOR_GUIDE_MD contract (Doc default vs Slides mode, Chart -> What This Chart Means -> Next Investigation Path, limit 500)
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain("this.viewMode = 'doc'")
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain("this.viewMode = 'slides'")
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('Doc View')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('Slides View')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('What This Chart Means')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('Next Investigation Path')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain("limit: '500'")
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('run_key_driver_analysis')
    expect(DATA_INVESTIGATOR_GUIDE_MD).toContain('to_fixed_date_range')

    // 3. buildDenseExploreSchema surfaces LookML drill_fields on measures and dimensions
    clearLookerMetadataCache()
    const mockDrillSdk = asSdk({
      ok: async <T>(p: T) => p,
      lookml_model_explore: async () => ({
        name: 'order_items',
        label: 'Order Items',
        view_name: 'order_items',
        fields: {
          measures: [
            {
              name: 'order_items.total_sale_price',
              label: 'Total Sale Price',
              type: 'sum',
              drill_fields: ['products.category', 'products.brand', 'users.country'],
            },
          ],
          dimensions: [
            {
              name: 'products.category',
              label: 'Category',
              type: 'string',
              drill_fields: ['products.brand', 'products.name'],
            },
          ],
        },
      }),
      run_inline_query: async () => [],
    })
    const schemaMd = await buildDenseExploreSchema(mockDrillSdk, 'thelook', 'order_items')
    expect(schemaMd).toContain(
      '[Drills: `products.category, products.brand, users.country`]'
    )
    expect(schemaMd).toContain('[Drills: `products.brand, products.name`]')

    // 4. convertRelativeDateFilterToFixed & normalizeQueryFiltersToFixedDates
    const anchor = '2026-03-30'
    expect(convertRelativeDateFilterToFixed('today', anchor)).toBe('2026-03-30 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('yesterday', anchor)).toBe('2026-03-29 to 2026-03-29')
    expect(convertRelativeDateFilterToFixed('last 30 days', anchor)).toBe('2026-02-28 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('90 days', anchor)).toBe('2025-12-30 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last 4 weeks', anchor)).toBe('2026-03-02 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last 3 months', anchor)).toBe('2025-12-30 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('this month', anchor)).toBe('2026-03-01 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last month', anchor)).toBe('2026-02-01 to 2026-02-28')
    expect(convertRelativeDateFilterToFixed('this quarter', anchor)).toBe('2026-01-01 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last quarter', anchor)).toBe('2025-10-01 to 2025-12-31')
    expect(convertRelativeDateFilterToFixed('this year', anchor)).toBe('2026-01-01 to 2026-03-30')
    expect(convertRelativeDateFilterToFixed('last year', anchor)).toBe('2025-01-01 to 2025-12-31')
    expect(convertRelativeDateFilterToFixed('2026-01-01 to 2026-03-31', anchor)).toBe(
      '2026-01-01 to 2026-03-31'
    )
    expect(convertRelativeDateFilterToFixed('Complete', anchor)).toBe('Complete')
    expect(
      normalizeQueryFiltersToFixedDates(
        {
          'order_items.created_date': 'last 30 days',
          'order_items.status': 'Complete',
        },
        anchor
      )
    ).toEqual({
      'order_items.created_date': '2026-02-28 to 2026-03-30',
      'order_items.status': 'Complete',
    })

    // 5. LkrCodeMode run_key_driver_analysis & to_fixed_date_range read-only whitelisting
    expect(classifyLookerOperation('POST', '/api/4.0/internal/kda/analyze')).toEqual({
      operation: 'read_internal_kda_analyze',
      requiresPermission: false,
    })
    expect(LkrCodeMode.classifyOperation('POST', '/internal/kda/analyze')).toEqual({
      operation: 'read_internal_kda_analyze',
      requiresPermission: false,
    })

    const kdaCalls: Array<{ method: string; path: string; body: unknown }> = []
    const kdaOut = await LkrCodeMode.runPythonCode(
      `
fixed_window = to_fixed_date_range("last 30 days")
res = run_key_driver_analysis({
    "data_source": {"model_name": "thelook", "explore_name": "order_items"},
    "contribution_metric": "order_items.total_sale_price",
    "dimensions": ["products.category", "products.brand"],
    "baseline_filters": {"order_items.created_date": to_fixed_date_range("last month")},
    "breach_filters": {"order_items.created_date": fixed_window},
})
return {"anchor": INVESTIGATION_ANCHOR_DATE, "fixed_window": fixed_window, "kda": res}
`,
      {
        vars: { INVESTIGATION_ANCHOR_DATE: '2026-03-30' },
        requirePermission: true,
        requestHandler: async (m: string, p: string, _q: unknown, b: unknown) => {
          kdaCalls.push({ method: m, path: p, body: b })
          return { status: 'SUCCESS', drivers: [{ dimension: 'products.category', value: 'Outerwear' }] }
        },
      }
    )
    const parsedKda = typeof kdaOut === 'string' ? JSON.parse(kdaOut) : kdaOut
    expect(parsedKda.anchor).toBe('2026-03-30')
    expect(parsedKda.fixed_window).toBe('2026-02-28 to 2026-03-30')
    expect(kdaCalls).toHaveLength(1)
    expect(kdaCalls[0]).toMatchObject({
      method: 'POST',
      path: '/internal/kda/analyze',
      body: {
        data_source: { model_name: 'thelook', explore_name: 'order_items' },
        contribution_metric: 'order_items.total_sale_price',
        dimensions: ['products.category', 'products.brand'],
        baseline_filters: { 'order_items.created_date': '2026-02-01 to 2026-02-28' },
        breach_filters: { 'order_items.created_date': '2026-02-28 to 2026-03-30' },
      },
    })
  })

}
