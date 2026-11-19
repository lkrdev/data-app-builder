import React from 'react'

import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  type AntigravityExtensionHostLike,
  extractBundleFromInteraction,
  extractCaSelectionFromInteraction,
  LkrCodeMode,
  runAntigravityTurn,
} from '../../antigravity'
import {
  StudioCapabilitiesModal,
  StudioCapabilitiesTrigger,
} from '../../components/StudioCapabilitiesGuide'
import type { StudioContentItem } from '../../lookerApi'
import { materializeTurnBundles } from '../../studioControllerConcurrency'

const asSdk = (mock: Record<string, unknown>): Looker40SDK => mock as unknown as Looker40SDK
const asHost = (mock: Record<string, unknown>): AntigravityExtensionHostLike => mock as unknown as AntigravityExtensionHostLike

export function registerPermissionsPart29Tests(): void {
  test('106. Open-ended chat: auto-continues claimedLiveArtifactWithoutBundle on "Continue?" turns, publishes Data App, and delivers guaranteed Looker content links', async () => {
    const spyPy = jest.spyOn(LkrCodeMode, 'runPythonCode').mockResolvedValue(
      JSON.stringify({ order_items_dims: ['order_items.created_month'], order_items_meas: ['order_items.total_sale_price'] })
    )
    const postedBodies: Array<{ tools?: Array<{ name?: string; type?: string }>; input?: Array<{ text?: string }> }> = []
    let postHop = 0

    try {
      const turnRes = await runAntigravityTurn({
        sdk: asSdk({ ok: async <T>(p: T) => p }),
        extensionSDK: asHost({
          serverProxy: async (url: string, init?: { method?: string; body?: string }) => {
            if (url.includes(':stream') || url.includes('alt=sse')) return { ok: false, status: 404, body: 'no sse' }
            if (init?.method === 'POST' && url.includes('/interactions')) {
              postHop += 1
              postedBodies.push(JSON.parse(String(init.body || '{}')))
            }
            if (postHop === 1) {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: 'int_cont_1',
                  environment_id: 'env_demowest_3325',
                  status: 'requires_action',
                  steps: [
                    {
                      id: 'call_cm_1',
                      type: 'function_call',
                      name: 'run_looker_codemode',
                      arguments: JSON.stringify({
                        thought: 'Fetching field lists for order_items and ecomm_predict',
                        code: 'return {"order_items_dims": ["order_items.created_month"]}',
                      }),
                    },
                  ],
                }),
              }
            }
            if (postHop === 2) {
              // Exact demowest conv_1795051757037 failure: model claims Data App is live in right pane without running bundle_app.py
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: 'int_cont_2',
                  previous_interaction_id: 'int_cont_1',
                  environment_id: 'env_demowest_3325',
                  status: 'completed',
                  output_text:
                    "**Lu’s Sticker-Book E-Commerce Command Center** is live and ready in the right pane! Here is what’s inside:\n- 4 Sticker KPI Badges",
                }),
              }
            }
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_cont_3',
                previous_interaction_id: 'int_cont_2',
                environment_id: 'env_demowest_3325',
                status: 'completed',
                steps: [
                  {
                    type: 'code_execution_result',
                    output:
                      '<DATA_APP_BUNDLE>{"title":"Lu’s Sticker-Book E-Commerce Command Center","raw_code":"import { DataApp } from \'/runtime/data-app.js\'; customElements.define(\'lu-app\', class extends DataApp {});","prod_code":"import { DataApp } from \'https://www.gstatic.com/looker-data-apps/versions/1.3.0/data-app.js\'; customElements.define(\'lu-app\', class extends DataApp {});","widgets":[{"id":"w1","query":{"model":"thelook","view":"order_items","fields":["order_items.total_sale_price"]}}]}</DATA_APP_BUNDLE>',
                  },
                ],
                output_text:
                  "**Lu’s Sticker-Book E-Commerce Command Center** is published with 4 Sticker KPI Badges and interactive charts.",
              }),
            }
          },
        }),
        userId: '3325',
        conversationId: 'conv_1795051757037',
        auth: { mode: 'apikey', apiKey: 'k-3325' },
        session: { environmentId: 'env_demowest_3325', lastInteractionId: 'int_turn1_interjected' },
        selectedExplores: ['thelook::order_items', 'thelook::ecomm_predict'],
        schemaMarkdown: '# Schema',
        userPrompt: 'Continue?',
        rawUserPrompt: 'Continue?',
        onStatus: () => {},
      })

      // Hop 1: "Continue?" warm turn, Hop 2: run_looker_codemode continuation, Hop 3: claimedLiveArtifactWithoutBundle auto-continuation!
      expect(postedBodies).toHaveLength(3)
      expect((postedBodies[2]?.tools || []).some((t) => t.type === 'code_execution')).toBe(true)
      expect(postedBodies[2]?.input?.[0]?.text || '').toContain('nothing is live in the right pane')
      expect(turnRes.bundle?.title).toBe('Lu’s Sticker-Book E-Commerce Command Center')

      // Materialize Data App bundle and verify guaranteed deliveredContentLink + contentItems population
      const itemState: { items: StudioContentItem[]; activeKey: string } = { items: [], activeKey: '' }
      const matApp = await materializeTurnBundles({
        sdk: asSdk({
          ok: async <T>(p: T) => p,
          create_dashboard: async (b: { title?: string; folder_id?: string }) => ({ id: '9901', title: b.title, folder_id: b.folder_id }),
          dashboard: async () => ({
            id: '9901',
            title: 'Lu’s Sticker-Book E-Commerce Command Center',
            folder_id: '5',
            dashboard_elements: [],
            dashboard_layouts: [{ id: 'lay_9901', active: true, dashboard_layout_components: [] }],
          }),
          create_dashboard_element: async () => ({ id: 'el_9901' }),
          update_dashboard_element: async () => ({ id: 'el_9901' }),
          update_dashboard: async () => ({ id: '9901' }),
          authSession: {
            transport: {
              rawRequest: async (_m: string, reqPath: string) => ({
                ok: true,
                statusCode: 200,
                body: JSON.stringify(
                  reqPath.includes('/data_app_extension')
                    ? { id: 'db::ext_9901' }
                    : reqPath === '/dashboards'
                    ? { id: '9901', title: 'Lu’s Sticker-Book E-Commerce Command Center', folder_id: '5' }
                    : reqPath === '/dashboard_elements'
                    ? { id: 'el_9901' }
                    : { id: 'lay_9901' }
                ),
              }),
            },
          },
        }),
        userId: '3325',
        result: turnRes,
        folderId: '5',
        turnExplores: ['thelook::order_items'],
        itemState,
        requirePermission: false,
      })
      expect(matApp.handledArtifact).toBe(true)
      expect(matApp.publishedApp?.dashboardId).toBe('9901')
      expect(itemState.items.map((i) => i.key)).toEqual(['data_app:9901'])
      expect(matApp.deliveredContentLink).toEqual({
        label: 'Looker Dashboard',
        title: 'Lu’s Sticker-Book E-Commerce Command Center',
        path: '/dashboards/9901',
      })

      // Materialize Native Look & LookML Project bundles and verify deliveredContentLink paths
      const nativeLookState: { items: StudioContentItem[]; activeKey: string } = { items: [], activeKey: '' }
      const matLook = await materializeTurnBundles({
        sdk: asSdk({ ok: async <T>(p: T) => p, look: async (id: string) => ({ id, title: 'Top Brands Look', folder_id: '5' }) }),
        userId: '3325',
        result: {
          ...turnRes,
          bundle: null,
          nativeBundle: { id: '404', contentType: 'look', lookId: '404', title: 'Top Brands Look', embedPath: '/embed/looks/404' },
        },
        folderId: '5',
        turnExplores: ['thelook::order_items'],
        itemState: nativeLookState,
        requirePermission: false,
      })
      expect(matLook.deliveredContentLink).toEqual({ label: 'Looker Look', title: 'Top Brands Look', path: '/looks/404' })

      const lookmlState: { items: StudioContentItem[]; activeKey: string } = { items: [], activeKey: '' }
      const matLookml = await materializeTurnBundles({
        sdk: asSdk({ ok: async <T>(p: T) => p }),
        userId: '3325',
        result: {
          ...turnRes,
          bundle: null,
          lookmlBundle: {
            id: 'ecom_sem',
            project_id: 'ecom_sem',
            title: 'LookML: ecom_sem',
            model_name: 'ecom_sem',
            files: [{ path: 'views/orders.view.lkml', action: 'created', content: 'view: orders {}' }],
          },
        },
        folderId: '5',
        turnExplores: [],
        itemState: lookmlState,
        requirePermission: false,
      })
      expect(matLookml.deliveredContentLink).toEqual({
        label: 'Looker Project',
        title: 'ecom_sem in Looker IDE',
        path: '/projects/ecom_sem',
      })
    } finally {
      spyPy.mockRestore()
    }
  })

  test('107. Open-ended chat: newest-first <DATA_APP_BUNDLE> extraction, <CA_AGENT_SELECTION> extraction, and tabless StudioCapabilitiesModal', () => {
    // Latest <DATA_APP_BUNDLE> wins when an interaction updates app.js and re-bundles in the same turn
    const multiBundle = extractBundleFromInteraction({
      id: 'int_multi_bundle',
      status: 'completed',
      steps: [
        {
          type: 'code_execution_result',
          output: '<DATA_APP_BUNDLE>{"title":"Draft v1","raw_code":"class V1 {}","prod_code":"class V1 {}","widgets":[]}</DATA_APP_BUNDLE>',
        },
        {
          type: 'code_execution_result',
          output: '<DATA_APP_BUNDLE>{"title":"Final v2","raw_code":"class V2 {}","prod_code":"class V2 {}","widgets":[{"id":"kpi_1"}]}</DATA_APP_BUNDLE>',
        },
      ],
    })
    expect(multiBundle?.title).toBe('Final v2')
    expect(multiBundle?.widgets).toHaveLength(1)

    // <CA_AGENT_SELECTION> extracts cleanly from interaction output without any <USE_CASE> wrapper
    const caSel = extractCaSelectionFromInteraction({
      id: 'int_ca_sel',
      status: 'completed',
      output_text:
        '<CA_AGENT_SELECTION>{"agent_id":"b891cf86aa2c4258b3f173cd17c8d8c1","rationale":"Matches thelook eCommerce explore."}</CA_AGENT_SELECTION>',
    })
    expect(caSel).toEqual({
      agentId: 'b891cf86aa2c4258b3f173cd17c8d8c1',
      rationale: 'Matches thelook eCommerce explore.',
    })

    // Tabless StudioCapabilitiesTrigger + StudioCapabilitiesModal render single unified guide with zero use-case tabs
    const triggerHtml = renderToStaticMarkup(React.createElement(StudioCapabilitiesTrigger, { onOpen: () => {} }))
    expect(triggerHtml).toContain('data-testid="studio-capabilities-btn"')

    const modalHtml = renderToStaticMarkup(React.createElement(StudioCapabilitiesModal, { open: true, onClose: () => {} }))
    expect(modalHtml).toContain('data-testid="studio-capabilities-modal"')
    expect(modalHtml).toContain('data-testid="studio-capabilities-close-btn"')
    expect(modalHtml).toContain('data-testid="studio-capabilities-mdx-body"')
    expect(modalHtml).toContain('Open-Ended Looker Studio Workspace')
    expect(modalHtml).toContain('data-testid="doc-ui-preview"')
    expect(modalHtml).not.toContain('use-case-guide-tab-')
  })
}
