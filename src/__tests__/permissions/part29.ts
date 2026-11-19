import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import React from 'react'

import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  ANTIGRAVITY_ALLOWED_MODELS,
  type AntigravityExtensionHostLike,
  BUNDLE_APP_PY,
  clearSessionConversationMessages,
  extractBundleFromInteraction,
  extractCaSelectionFromInteraction,
  hydrateRemoteConversationMessages,
  isFreshUserTurnRoot,
  LkrCodeMode,
  runAntigravityTurn,
} from '../../antigravity'
import {
  StudioCapabilitiesModal,
  StudioCapabilitiesTrigger,
} from '../../components/StudioCapabilitiesGuide'
import { StudioLeftPane } from '../../components/StudioLeftPane'
import type { DataAppBundle, StudioContentItem } from '../../lookerApi'
import { materializeTurnBundles } from '../../studioControllerConcurrency'
import type { StudioController } from '../../useStudioController'

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

  test('108. Pre-completion Data App load verification: BUNDLE_APP_PY blocks hallucinated this.renderFilterBar() and runAntigravityTurn auto-heals failed browser load preflight before completing turn', async () => {
    // 1. Layer 1: BUNDLE_APP_PY static unknown-data-app-method safety check
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dab-bundle-pf-'))
    const scriptPath = path.join(tmpDir, 'bundle_app.py')
    fs.writeFileSync(scriptPath, BUNDLE_APP_PY, 'utf8')
    try {
      const brokenJs = [
        "import { DataApp, html } from '/runtime/data-app.js';",
        'export class BrokenStickerApp extends DataApp {',
        '  constructor() { super(); this.lookerModel = "thelook"; this.explore = "order_items"; }',
        '  render() { return html`<div class="da-container">${this.renderFilterBar()}<app-kpi explore="order_items" query-field="order_items.total_sale_price" label="Sales" format="usd"></app-kpi></div>`; }',
        '}',
        "customElements.define('broken-sticker-app', BrokenStickerApp);",
      ].join('\n')
      const brokenPath = path.join(tmpDir, 'broken.js')
      fs.writeFileSync(brokenPath, brokenJs, 'utf8')
      let bundleErr = ''
      try {
        execFileSync('python3', [scriptPath, brokenPath, 'Broken App'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e: unknown) {
        bundleErr = String((e as { stderr?: string }).stderr || (e as Error).message || '')
      }
      expect(bundleErr).toContain('unknown-data-app-method')
      expect(bundleErr).toContain("Unknown DataApp method 'this.renderFilterBar()'")

      const validJs = [
        "import { DataApp, html } from '/runtime/data-app.js';",
        'export class ValidStickerApp extends DataApp {',
        '  constructor() { super(); this.lookerModel = "thelook"; this.explore = "order_items"; this._onPick = () => this.requestUpdate(); }',
        '  renderFilterBar() { return html`<div class="da-filter-bar">${this.renderThemeToggle()}</div>`; }',
        '  render() { const f = this.getEffectiveFilters(); return html`<div class="da-container">${this.renderFilterBar()}<app-kpi explore="order_items" query-field="order_items.total_sale_price" label="Sales" format="usd" .filters=${f}></app-kpi></div>`; }',
        '}',
        "customElements.define('valid-sticker-app', ValidStickerApp);",
      ].join('\n')
      const validPath = path.join(tmpDir, 'valid.js')
      fs.writeFileSync(validPath, validJs, 'utf8')
      const okOut = execFileSync('python3', [scriptPath, validPath, 'Valid App'], { encoding: 'utf8' })
      expect(okOut).toContain('<DATA_APP_BUNDLE>')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }

    // 2. Layer 2: In-turn browser mount preflight catches runtime crash, scrubs broken bundle, sends [DATA_APP_LOAD_VERIFICATION_FAILED], and returns healed bundle
    expect(
      isFreshUserTurnRoot({
        id: 'int_pf_hop',
        input: [{ type: 'text', text: '[DATA_APP_LOAD_VERIFICATION_FAILED] Mounting your bundled Data App in the browser failed' }],
      })
    ).toBe(false)

    const prevWin = (globalThis as { window?: unknown }).window
    const preflightSeenTitles: string[] = []
    ;(globalThis as { window?: unknown }).window = {
      __MOCK_DATA_APP_PREFLIGHT__: async (b: DataAppBundle) => {
        preflightSeenTitles.push(b.title)
        if (String(b.prod_code || '').includes('this.renderFilterBar()')) {
          return {
            ok: false,
            errors: ['TypeError: this.renderFilterBar is not a function\n    at StickerApp.render (blob:null/1:12:18)'],
          }
        }
        return { ok: true, errors: [], height: 1420, htmlLen: 8400, tabsChecked: 3 }
      },
    }

    const postedBodies: Array<{ previous_interaction_id?: string; tools?: Array<{ type?: string }>; input?: Array<{ text?: string }> }> = []
    let hop = 0
    try {
      const res = await runAntigravityTurn({
        sdk: asSdk({ ok: async <T>(p: T) => p }),
        extensionSDK: asHost({
          serverProxy: async (url: string, init?: { method?: string; body?: string }) => {
            if (url.includes(':stream') || url.includes('alt=sse')) return { ok: false, status: 404, body: 'no sse' }
            if (init?.method === 'POST' && url.includes('/interactions')) {
              hop += 1
              postedBodies.push(JSON.parse(String(init.body || '{}')))
            }
            if (hop === 1) {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  id: 'int_pf_1',
                  environment_id: 'env_pf_776',
                  status: 'completed',
                  steps: [
                    {
                      type: 'code_execution_result',
                      output:
                        '<DATA_APP_BUNDLE>{"title":"Broken v1","raw_code":"this.renderFilterBar()","prod_code":"customElements.define(\'x-a\', class { render() { return this.renderFilterBar(); } });","widgets":[]}</DATA_APP_BUNDLE>',
                    },
                  ],
                  output_text: 'Built Broken v1.',
                }),
              }
            }
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_pf_2',
                previous_interaction_id: 'int_pf_1',
                environment_id: 'env_pf_776',
                status: 'completed',
                steps: [
                  {
                    type: 'code_execution_result',
                    output:
                      '<DATA_APP_BUNDLE>{"title":"Healed v2","raw_code":"renderFilterBar() {}","prod_code":"customElements.define(\'x-a\', class {});","widgets":[{"widget_id":"k1","title":"Sales","query":{"model":"thelook","view":"order_items","fields":["order_items.total_sale_price"]}}]}</DATA_APP_BUNDLE>',
                  },
                ],
                output_text: 'Fixed renderFilterBar with <app-select> controls and re-bundled.',
              }),
            }
          },
        }),
        userId: '3325',
        conversationId: 'conv_pf_776',
        auth: { mode: 'apikey', apiKey: 'k-3325' },
        session: { environmentId: 'env_pf_776' },
        selectedExplores: ['thelook::order_items'],
        schemaMarkdown: '# Schema',
        userPrompt: '/data-apps Build sticker command center',
        rawUserPrompt: '/data-apps Build sticker command center',
        onStatus: () => {},
      })

      expect(preflightSeenTitles).toEqual(['Broken v1', 'Healed v2'])
      expect(postedBodies).toHaveLength(2)
      expect(postedBodies[1]?.previous_interaction_id).toBe('int_pf_1')
      expect(postedBodies[1]?.input?.[0]?.text || '').toContain('[DATA_APP_LOAD_VERIFICATION_FAILED]')
      expect(postedBodies[1]?.input?.[0]?.text || '').toContain('TypeError: this.renderFilterBar is not a function')
      expect((postedBodies[1]?.tools || []).some((t) => t.type === 'code_execution')).toBe(true)
      expect(res.bundle?.title).toBe('Healed v2')
      expect(res.assistantText).toContain('Fixed renderFilterBar')
    } finally {
      if (prevWin === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = prevWin
    }
  })

  test('109. Issue #239: renders Sign In to See Conversation gate in StudioLeftPane for unhydrated signed-out conversations, gates hydrateRemoteConversationMessages on requireAuthForHydration, and hydrates upon auth', async () => {
    const savedConv = {
      id: 'conv_app_42',
      type: 'app',
      label: 'Executive Revenue App',
      interactionId: 'v1_app_42',
      turnInteractionIds: [['v1_app_42_r', 'v1_app_42']] as Array<[string, string]>,
      environmentId: 'env_42',
      updatedAt: '2026-11-19T12:00:00Z',
    }
    const baseCtl = {
      agentName: 'Ripper',
      isAuthenticated: false,
      authMode: 'oauth' as const,
      clientId: 'client-id.apps.googleusercontent.com',
      oauthSigningIn: false,
      handleOAuthLogin: async () => {},
      history: { push: () => {}, replace: () => {}, location: { pathname: '/c/conv_app_42' } },
      messages: [],
      conversations: [savedConv],
      allConversations: [savedConv],
      activeConversationId: 'conv_app_42',
      selectedExplores: ['thelook::order_items'],
      starterPrompts: [{ id: 's1', label: 'Build KPI App', prompt: 'Build KPI App' }],
      starterPromptsLoading: false,
      setPrompt: () => {},
      busyStatus: null,
      liveActivitySteps: [],
      pendingPerm: null,
      backgroundPendingPerm: null,
      resolvePermDecision: () => {},
      resolveBackgroundPermDecision: () => {},
      leftPaneWidth: 380,
      setLeftPaneWidth: () => {},
      rightPaneCollapsed: false,
      setRightPaneCollapsed: () => {},
      contentItems: [],
      activeContentTabKey: '',
      copyThreadState: 'idle' as const,
      handleCopyThreadDebugTrace: async () => {},
      models: [],
      preloadedContent: [],
      mentionedItems: [],
      setMentionedItems: () => {},
      setSelectedExplores: () => {},
      selectedModel: ANTIGRAVITY_ALLOWED_MODELS[0].id,
      setSelectedModel: () => {},
      thinkingLevel: 'high' as const,
      thinkingLevelByModel: {},
      setModelThinkingLevel: () => {},
      defaultThinkingLevel: 'high' as const,
      availableModels: ANTIGRAVITY_ALLOWED_MODELS,
      activatedLookmlSkills: [],
      setActivatedLookmlSkills: () => {},
      pastedImages: [],
      setPastedImages: () => {},
      prompt: '',
      handleSendPrompt: async () => {},
      queuedPrompts: [],
      busySendAction: 'queue' as const,
      setBusySendAction: () => {},
      handleStopTurn: () => {},
      handleQueuePrompt: () => {},
      handleRemoveQueuedPrompt: () => {},
      handleInterjectPrompt: async () => {},
      capabilitiesModalOpen: false,
      setCapabilitiesModalOpen: () => {},
      folderTreeNodes: {},
      selectedFolderId: '1',
      requirePermission: true,
      setRequirePermission: () => {},
      setFolderModalOpen: () => {},
      setEditingAgentName: () => {},
      activeSandboxMarkdownModalPath: null,
      setActiveSandboxMarkdownModalPath: () => {},
      sandboxMarkdownCache: {},
      sandboxMarkdownLoading: {},
    } as unknown as StudioController

    // 1. Signed-out saved conversation with 0 hydrated messages -> header title + conv-signin-gate (no copy-thread button, no starter prompts)
    const gateHtml = renderToStaticMarkup(React.createElement(StudioLeftPane, { ctl: baseCtl }))
    expect(gateHtml).toContain('data-testid="left-pane-header"')
    expect(gateHtml).toContain('Executive Revenue App')
    expect(gateHtml).not.toContain('data-testid="copy-thread-trace-btn"')
    expect(gateHtml).toContain('data-testid="conv-signin-gate"')
    expect(gateHtml).toContain('data-testid="conv-signin-btn"')
    expect(gateHtml).toContain('Sign In to See Conversation')
    expect(gateHtml).not.toContain('dab-empty-chat')

    // 2. oauthSigningIn state & archived conversation lookup via allConversations
    const signingInHtml = renderToStaticMarkup(
      React.createElement(StudioLeftPane, {
        ctl: Object.assign({}, baseCtl, {
          oauthSigningIn: true,
          conversations: [],
          allConversations: [Object.assign({}, savedConv, { archived: true, label: 'Archived Revenue App' })],
        }),
      })
    )
    expect(signingInHtml).toContain('Archived Revenue App')
    expect(signingInHtml).toContain('Signing in…')

    // 3. Unsaved fresh local conversation (not in conversations) while signed out -> keeps starter prompts (.dab-empty-chat)
    const freshLocalHtml = renderToStaticMarkup(
      React.createElement(StudioLeftPane, {
        ctl: Object.assign({}, baseCtl, { activeConversationId: 'conv_fresh_local_1' }),
      })
    )
    expect(freshLocalHtml).toContain('dab-empty-chat')
    expect(freshLocalHtml).not.toContain('data-testid="conv-signin-gate"')
    expect(freshLocalHtml).not.toContain('data-testid="left-pane-header"')

    // 4. Hydrated conversation -> renders copy-thread-trace-btn and messages without conv-signin-gate
    const hydratedHtml = renderToStaticMarkup(
      React.createElement(StudioLeftPane, {
        ctl: Object.assign({}, baseCtl, {
          isAuthenticated: true,
          messages: [
            { role: 'user', text: 'Build KPI App' },
            { role: 'assistant', text: 'Built Executive Revenue App.', interactionId: 'v1_app_42' },
          ],
        }),
      })
    )
    expect(hydratedHtml).toContain('data-testid="copy-thread-trace-btn"')
    expect(hydratedHtml).not.toContain('data-testid="conv-signin-gate"')

    // 5. hydrateRemoteConversationMessages honors window.__MOCK_LOOKER_EXTENSION__.requireAuthForHydration
    clearSessionConversationMessages()
    const prevWin = (globalThis as { window?: unknown }).window
    const mockWin = {
      __INTERACTION_CALLS__: [] as Array<{ url: string; path: string; method: string; id?: string }>,
      __MOCK_LOOKER_EXTENSION__: {
        requireAuthForHydration: true,
        mockInteractions: {
          v1_app_42_r: {
            id: 'v1_app_42_r',
            environment_id: 'env_42',
            status: 'completed',
            input: [{ type: 'text', text: '<USER_MESSAGE>Build KPI App</USER_MESSAGE>' }],
          },
          v1_app_42: {
            id: 'v1_app_42',
            previous_interaction_id: 'v1_app_42_r',
            environment_id: 'env_42',
            status: 'completed',
            output_text: 'Built KPI App.',
          },
        },
      },
    }
    try {
      ;(globalThis as { window?: unknown }).window = mockWin
      const unauthRes = await hydrateRemoteConversationMessages({
        auth: { mode: 'oauth', oauthToken: '' },
        conv: savedConv,
        activeEnvironmentId: 'env_42',
      })
      expect(unauthRes).toEqual({ expired: false, messages: [], prunedIds: [], resolvedEnvironmentId: 'env_42' })
      expect(mockWin.__INTERACTION_CALLS__).toHaveLength(0)

      // Pure Looker CA pointer still synthesizes locally without sandbox auth
      const caRes = await hydrateRemoteConversationMessages({
        auth: { mode: 'oauth', oauthToken: '' },
        conv: {
          id: 'conv_ca_local',
          type: 'conversational-analytics',
          label: 'Margin Q&A',
          caConversationId: 'ca_99',
          content: { caConversationId: 'ca_99', agentName: 'eCommerce Agent', initialQuestion: 'Top margin brand?' },
          updatedAt: '2026-11-19T12:00:00Z',
        },
      })
      expect(caRes.messages).toHaveLength(2)
      expect(mockWin.__INTERACTION_CALLS__).toHaveLength(0)

      // Once signed in with OAuth token, remote turns hydrate in 1 parallel batch
      const authRes = await hydrateRemoteConversationMessages({
        auth: { mode: 'oauth', oauthToken: 'tok_signed_in' },
        conv: savedConv,
        activeEnvironmentId: 'env_42',
      })
      expect(mockWin.__INTERACTION_CALLS__).toHaveLength(2)
      expect(authRes.messages).toEqual([
        { role: 'user', text: 'Build KPI App' },
        { role: 'assistant', text: 'Built KPI App.', interactionId: 'v1_app_42' },
      ])
    } finally {
      if (prevWin === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = prevWin
      clearSessionConversationMessages()
    }
  })
}
