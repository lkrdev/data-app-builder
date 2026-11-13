import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import React from 'react'

import type { FetchCustomParameters } from '@looker/extension-sdk'
import type { Looker40SDK } from '@looker/sdk'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  BUNDLE_APP_PY, DATA_APP_GUIDE_MD, executeLkrExtensionToolRequest, handleImageClipboardPaste,
  isNewProjectOnboardingIntakePrompt, LkrCodeMode, loadStoredThinkingLevelByModel, normalizeThinkingLevelByModel,
  parseAttachmentDataUrl, persistThinkingLevelByModel, readAttachedFile, readInitialThinkingLevelByModel,
  runAntigravityTurn, STUDIO_THINKING_LEVEL_BY_MODEL_STORAGE_KEY, StudioAttachedFile, wrapKdaCodeMode,
} from '../../antigravity'
import { deriveConversationOverviewData, StudioOverviewSidebar } from '../../components/StudioWorkspace'
import {
  createDeduplicatedLookerSdkProxy, getActiveCodeModeConversationId, isInsideCodeModeApiScope, LkrCodeModeApiCallEntry,
  parseAttachmentDataUrl as lookerApiParseAttachmentDataUrl, rawLookerRequest, withCodeModeApiScope,
} from '../../lookerApi'

export function registerPermissionsPart20Tests(): void {
  test('81. Issue #196: scopes Overview API Calls to per-conversation Turn Code Mode calls, removes Overview Hidden badge, links dashboard/Look contentRows, and supports .sql/.json drag-drop, clipboard paste, and file chips', async () => {
    // 1. parseAttachmentDataUrl, readAttachedFile, and handleImageClipboardPaste for .sql / .json / .pdf / image/*
    expect(lookerApiParseAttachmentDataUrl).toBe(parseAttachmentDataUrl)
    expect(parseAttachmentDataUrl('data:text/plain;name=query%201.sql;base64,U0VMRUNUIDE=')).toEqual({
      isImage: false,
      name: 'query 1.sql',
      mimeType: 'text/plain',
    })
    expect(parseAttachmentDataUrl('data:application/json;name=manifest.json;base64,e30=')).toEqual({
      isImage: false,
      name: 'manifest.json',
      mimeType: 'application/json',
    })
    expect(parseAttachmentDataUrl('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      isImage: true,
      name: undefined,
      mimeType: 'image/png',
    })

    const origFileReader = (globalThis as { FileReader?: unknown }).FileReader
    ;(globalThis as { FileReader?: unknown }).FileReader = class {
      result = ''
      onload: (() => void) | null = null
      readAsText(f: { __text?: string }) {
        this.result = f.__text || ''
        if (this.onload) this.onload()
      }
      readAsDataURL(f: { type?: string }) {
        this.result = `data:${f.type || 'image/png'};base64,iVBORw0KGgo=`
        if (this.onload) this.onload()
      }
    }
    try {
      const sqlFile = {
        name: 'revenue_by_region.sql',
        type: '',
        size: 24,
        __text: 'SELECT region FROM sales;',
      } as unknown as File
      const readSql = await readAttachedFile(sqlFile)
      expect(readSql.name).toBe('revenue_by_region.sql')
      expect(readSql.mimeType).toBe('text/plain')
      expect(readSql.dataUrl).toMatch(/^data:text\/plain;name=revenue_by_region\.sql;base64,/)
      expect(parseAttachmentDataUrl(readSql.dataUrl || '')).toEqual({
        isImage: false,
        name: 'revenue_by_region.sql',
        mimeType: 'text/plain',
      })

      const jsonFile = {
        name: 'config.json',
        type: 'application/json',
        size: 15,
        __text: '{"theme":"dark"}',
      } as unknown as File
      const readJson = await readAttachedFile(jsonFile)
      expect(readJson.dataUrl).toMatch(/^data:application\/json;name=config\.json;base64,/)
      expect(parseAttachmentDataUrl(readJson.dataUrl || '')).toEqual({
        isImage: false,
        name: 'config.json',
        mimeType: 'application/json',
      })

      const imgFile = {
        name: 'chart.png',
        type: 'image/png',
        size: 4,
      } as unknown as File
      const readImg = await readAttachedFile(imgFile)
      expect(readImg.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
      expect(readImg.dataUrl).not.toContain(';name=')

      let pastedFiles: StudioAttachedFile[] = []
      let prevented = false
      handleImageClipboardPaste(
        {
          clipboardData: {
            items: [
              { kind: 'file', type: '', getAsFile: () => sqlFile },
              { kind: 'file', type: 'application/json', getAsFile: () => jsonFile },
            ],
          } as unknown as DataTransfer,
          preventDefault: () => {
            prevented = true
          },
        },
        (updater) => {
          pastedFiles = updater(pastedFiles)
        }
      )
      await new Promise((r) => setTimeout(r, 20))
      expect(prevented).toBe(true)
      expect(pastedFiles.map((f) => f.name)).toEqual(['revenue_by_region.sql', 'config.json'])

      // 2. Host SDK calls outside Code Mode (e.g. GET /session) get codemode: false and are excluded from Overview API Calls,
      //    while calls inside LkrCodeMode.runPythonCode / executeLkrExtensionToolRequest get codemode: true and conversation_id
      const gCalls = globalThis as { lkr_codemode_api_calls?: LkrCodeModeApiCallEntry[] }
      gCalls.lkr_codemode_api_calls = []
      expect(isInsideCodeModeApiScope()).toBe(false)
      expect(getActiveCodeModeConversationId()).toBe('')

      const rawTransport = {
        rawRequest: jest.fn(async (_m: string, p: string) => ({
          ok: true,
          statusCode: 200,
          body: JSON.stringify({ path: p, workspace_id: 'production' }),
        })),
      }
      const rawSdk = {
        authSession: { transport: rawTransport },
      } as unknown as Looker40SDK
      const proxiedSdk = createDeduplicatedLookerSdkProxy(rawSdk)

      // Host UI call outside Code Mode (simulating syncLookerSessionWorkspace on focus/mount)
      await rawLookerRequest(proxiedSdk, 'GET', '/session')
      await rawLookerRequest(proxiedSdk, 'GET', '/folders/1')
      expect(gCalls.lkr_codemode_api_calls).toHaveLength(2)
      expect(gCalls.lkr_codemode_api_calls[0]).toEqual(
        expect.objectContaining({ method: 'GET', route: '/session', codemode: false })
      )
      expect(gCalls.lkr_codemode_api_calls[1]).toEqual(
        expect.objectContaining({ method: 'GET', route: '/folders/1', codemode: false })
      )

      // Turn Code Mode call on conv_a (even calling session() and folder("1") inside Python Code Mode!)
      await LkrCodeMode.runPythonCode({
        code: 's = session()\nf = folder("1")\nreturn {"ws": s.get("workspace_id")}',
        sdk: proxiedSdk,
        conversationId: 'conv_a',
        requirePermission: false,
      })
      // Turn CLI Bridge call on conv_b
      await executeLkrExtensionToolRequest({
        sdk: proxiedSdk,
        req: { kind: 'sdk_request', method: 'GET', path: '/api/4.0/projects/ecom' },
        conversationId: 'conv_b',
        requirePermission: false,
      })
      expect(isInsideCodeModeApiScope()).toBe(false)
      expect(getActiveCodeModeConversationId()).toBe('')

      const codeModeEntries = gCalls.lkr_codemode_api_calls.filter((c) => c.codemode === true)
      expect(codeModeEntries.map((c) => ({ method: c.method, route: c.route, conversation_id: c.conversation_id }))).toEqual([
        { method: 'GET', route: '/session', conversation_id: 'conv_a' },
        { method: 'GET', route: '/folders/1', conversation_id: 'conv_a' },
        { method: 'GET', route: '/projects/ecom', conversation_id: 'conv_b' },
      ])

      // Verify deriveConversationOverviewData excludes host (codemode: false) calls and isolates conv_a vs conv_b
      const ovConvA = deriveConversationOverviewData({
        conversationId: 'conv_a',
        messages: [
          {
            role: 'user',
            text: 'Analyze SQL and JSON',
            images: [readSql.dataUrl!, readJson.dataUrl!, 'data:image/png;base64,iVBORw0KGgo='],
          },
        ],
        contentItems: [
          { key: 'dashboard:42', id: '42', contentType: 'dashboard', title: 'Exec KPIs', embedPath: '/embed/dashboards/42', hidden: true },
          { key: 'look:19', id: '19', contentType: 'look', title: 'Margin Look', embedPath: '/embed/looks/19', hidden: true },
        ],
        windowApiCalls: gCalls.lkr_codemode_api_calls,
      })
      expect(ovConvA.apiCalls.map((c) => `${c.method} ${c.route}`)).toEqual(['GET /session', 'GET /folders/1'])
      expect(ovConvA.links.map((l) => ({ href: l.href, label: l.label, meta: l.meta }))).toEqual([
        { href: '/dashboards/42', label: 'Open Exec KPIs', meta: 'UDD' },
        { href: '/looks/19', label: 'Open Margin Look', meta: 'Look' },
      ])
      expect(ovConvA.context.uploads.map((u) => u.label)).toEqual([
        'revenue_by_region.sql',
        'config.json',
        'Screenshot #3',
      ])

      const ovConvB = deriveConversationOverviewData({
        conversationId: 'conv_b',
        messages: [],
        windowApiCalls: gCalls.lkr_codemode_api_calls,
      })
      expect(ovConvB.apiCalls.map((c) => `${c.method} ${c.route}`)).toEqual(['GET /projects/ecom'])

      // Host-only calls produce 0 API Calls in Overview
      const ovHostOnly = deriveConversationOverviewData({
        conversationId: 'conv_idle',
        messages: [],
        windowApiCalls: gCalls.lkr_codemode_api_calls.filter((c) => c.codemode === false),
      })
      expect(ovHostOnly.apiCalls).toEqual([])

      // 3. Verify StudioOverviewSidebar renders row.shortTag ('UDD' / 'Look') and NEVER 'Hidden' when hidden: true
      const sidebarHtml = renderToStaticMarkup(
        React.createElement(StudioOverviewSidebar, {
          ctl: {
            messages: [],
            busyStatus: null,
            isAuthenticated: true,
            openViewerDocument: async () => {},
          } as unknown as React.ComponentProps<typeof StudioOverviewSidebar>['ctl'],
          data: ovConvA,
          openSecs: { content: true, links: true, uploads: true, api: true },
          setOpenSecs: () => {},
          showAll: {},
          setShowAll: () => {},
          hiddenSecs: {},
          setHiddenSecs: () => {},
          onOpenContentLinkInViewer: () => {},
          onOpenReview: () => {},
          onSelectContentRow: () => {},
          onSelectLookmlFile: () => {},
          onOpenApiCall: () => {},
          onCloseDockedExplorer: () => {},
        })
      )
      expect(sidebarHtml).toContain('data-testid="overview-content-item-dashboard:42"')
      expect(sidebarHtml).toContain('>UDD</span>')
      expect(sidebarHtml).toContain('>Look</span>')
      expect(sidebarHtml).not.toContain('>Hidden</span>')
      expect(sidebarHtml).toContain('revenue_by_region.sql')
      expect(sidebarHtml).toContain('config.json')
    } finally {
      ;(globalThis as { FileReader?: unknown }).FileReader = origFileReader
    }

    // 4. Verify withCodeModeApiScope restores depth and conversationId on rejection
    await expect(
      withCodeModeApiScope(async () => {
        expect(isInsideCodeModeApiScope()).toBe(true)
        expect(getActiveCodeModeConversationId()).toBe('conv_err')
        throw new Error('boom')
      }, 'conv_err')
    ).rejects.toThrow('boom')
    expect(isInsideCodeModeApiScope()).toBe(false)
    expect(getActiveCodeModeConversationId()).toBe('')
  })

  test('82. Issue #197: pre-injects INVESTIGATION_ANCHOR_DATE & globals()/locals() in LkrCodeMode, preloads kda_toolkit.py & uploaded_files in run_looker_codemode, auto-normalizes positional create*Col in BUNDLE_APP_PY, auto-continues failed bundle_app.py runs, and links published Data App dashboards', async () => {
    // 1. LkrCodeMode.runPythonCode supports globals().get("INVESTIGATION_ANCHOR_DATE") and locals() without NameError
    const anchorOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: 'return {"anchor": globals().get("INVESTIGATION_ANCHOR_DATE"), "local_custom": locals().get("custom_var")}',
        vars: { custom_var: 'ok_197', 'from': 'ignored_keyword' },
        requestHandler: async () => ({}),
      })
    )
    expect(anchorOut.anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(anchorOut.local_custom).toBe('ok_197')

    // 2. wrapKdaCodeMode injects KDA_TOOLKIT_PY when forceInclude is true or resolve_source(...) is called, and resolve_source accepts {"dashboard_id": "..."}
    const wrappedByForce = wrapKdaCodeMode('x = 1', true)
    expect(wrappedByForce).toContain('def resolve_source(')
    const wrappedByCall = wrapKdaCodeMode('res = resolve_source({"dashboard_id": "thelook::business_pulse"})', false)
    expect(wrappedByCall).toContain('def resolve_source(')
    expect(wrapKdaCodeMode('x = 1', false)).toBe('x = 1')

    const kdaResolveOut = JSON.parse(
      await LkrCodeMode.runPythonCode({
        code: wrapKdaCodeMode('return resolve_source({"dashboard_id": "thelook::business_pulse"})', true),
        requestHandler: async (_m, p) => {
          if (p.includes('/dashboards/')) {
            return {
              id: 'thelook::business_pulse',
              title: 'Business Pulse',
              dashboard_elements: [
                {
                  id: 'el_1',
                  title: 'Total Sales',
                  query: {
                    model: 'thelook',
                    view: 'order_items',
                    fields: ['order_items.created_date', 'order_items.total_sale_price'],
                    filters: { 'order_items.created_date': '2026-10-01 to 2026-10-31' },
                  },
                },
              ],
            }
          }
          return {}
        },
      })
    )
    expect(kdaResolveOut).toMatchObject({
      type: 'dashboard',
      id: 'thelook::business_pulse',
      targets: [
        expect.objectContaining({
          model: 'thelook',
          explore: 'order_items',
        }),
      ],
    })

    // 3. DATA_APP_GUIDE_MD documents { field, headerName, width } for all create*Col helpers and BUNDLE_APP_PY auto-normalizes positional create*Col calls
    expect(DATA_APP_GUIDE_MD).toContain('createCurrencyCol({ field, headerName, width })')
    expect(DATA_APP_GUIDE_MD).toContain('never positional string arguments')

    const repoRoot = path.resolve(__dirname, '../../..')
    const workDir = mkdtempSync(path.join(tmpdir(), 'dab-197-test-'))
    try {
      const bundlePyPath = path.join(workDir, 'bundle_app.py')
      writeFileSync(
        bundlePyPath,
        BUNDLE_APP_PY.replace('Path("/workspace/bundle.json")', `Path(${JSON.stringify(path.join(workDir, 'bundle.json'))})`),
        'utf8'
      )
      const env = { ...process.env }
      const posAppPath = path.join(workDir, 'pos_app.js')
      const posAppSrc = [
        "import { DataApp, html, createTextCol, createCurrencyCol, createNumericCol } from '/runtime/data-app.js';",
        'export class PosApp extends DataApp {',
        "  constructor() { super(); this.lookerModel = 'thelook'; this.explore = 'order_items'; }",
        '  render() {',
        "    const cols = [createTextCol('order_items.created_date', 'Date', { width: 120 }), createCurrencyCol('order_items.total_sale_price', 'Total Sales'), createNumericCol('order_items.order_count', 'Orders')];",
        "    return html`<app-grid .columns=${cols} .query=${{ model: 'thelook', view: 'order_items', fields: ['order_items.created_date', 'order_items.total_sale_price', 'order_items.order_count'] }}></app-grid>`;",
        '  }',
        '}',
        "customElements.define('pos-app', PosApp);",
      ].join('\n')
      const stdout = execFileSync('python3', [bundlePyPath, '--stdin', 'Halloween Sales KDA', posAppPath], {
        input: posAppSrc,
        env,
        encoding: 'utf8',
        stdio: 'pipe',
      })
      expect(stdout).toContain('<DATA_APP_BUNDLE>')
      const healedDisk = readFileSync(posAppPath, 'utf8')
      expect(healedDisk).toContain("createCurrencyCol({ field: 'order_items.total_sale_price', headerName: 'Total Sales' })")
      expect(healedDisk).toContain("createTextCol({ field: 'order_items.created_date', headerName: 'Date', width: 120 })")
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }

    // 4. isNewProjectOnboardingIntakePrompt recognizes attached .sql files as satisfying hasTarget
    expect(
      isNewProjectOnboardingIntakePrompt(
        'Create a new LookML project called orders_proj on connection bigquery_conn',
        [],
        [{ data: '', mimeType: 'text/plain', dataUrl: '', name: 'orders.sql', textContent: 'SELECT id FROM t' }]
      )
    ).toBe(false)

    // 5. runAntigravityTurn: inline schemaMarkdown when selectedExplores=[], KDA_SKILL_MD + wrapKdaCodeMode + uploaded_files in run_looker_codemode, and auto-continue when bundle_app.py fails without <DATA_APP_BUNDLE>
    const postedBodies: Array<Record<string, unknown>> = []
    let turnStep = 0
    const turnRes = await runAntigravityTurn({
      sdk: {
        authSession: {
          transport: {
            rawRequest: async () => ({
              ok: true,
              statusCode: 200,
              body: JSON.stringify({
                id: 'thelook::business_pulse',
                title: 'Business Pulse',
                dashboard_elements: [
                  {
                    id: '1',
                    title: 'Sales',
                    query: { model: 'thelook', view: 'order_items', fields: ['order_items.total_sale_price'] },
                  },
                ],
              }),
            }),
          },
        },
      } as unknown as Looker40SDK,
      userId: '1',
      extensionSDK: {
        serverProxy: async (_url: string, init?: FetchCustomParameters) => {
          turnStep += 1
          const parsedBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
          postedBodies.push(parsedBody)
          if (turnStep === 1) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_197_1',
                environment_id: 'env_197',
                status: 'requires_action',
                steps: [
                  {
                    id: 'call_kda_197',
                    type: 'function_call',
                    name: 'run_looker_codemode',
                    arguments: JSON.stringify({
                      code: 'return {"src": resolve_source({"dashboard_id": "thelook::business_pulse"}), "sql": uploaded_files.get("halloween.sql")}',
                    }),
                  },
                ],
              }),
            }
          }
          if (turnStep === 2) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_197_2',
                environment_id: 'env_197',
                status: 'completed',
                steps: [
                  {
                    id: 'exec_fail_197',
                    type: 'code_execution',
                    code: 'python3 /workspace/bundle_app.py --app-dir /workspace/apps/conv_197 --stdin "Halloween KDA"',
                    stderr: 'ERROR: [grid-column-field]',
                  },
                ],
                output_text: 'Attempted to bundle Halloween KDA app.',
              }),
            }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_197_3',
              environment_id: 'env_197',
              status: 'completed',
              steps: [
                {
                  id: 'exec_ok_197',
                  type: 'code_execution',
                  code: 'python3 /workspace/bundle_app.py --app-dir /workspace/apps/conv_197 --stdin "Halloween KDA"',
                  stdout:
                    '<DATA_APP_BUNDLE>{"title":"Halloween KDA","bundle_js":"export default class {}","raw_code":"export default class {}","widgets":[]}</DATA_APP_BUNDLE>',
                },
              ],
              output_text: 'Published Halloween KDA narrative app.',
            }),
          }
        },
      },
      auth: { mode: 'apikey', apiKey: 'test-key', oauthToken: '', clientId: '', projectId: '' },
      session: { conversationId: 'conv_197' },
      selectedExplores: [],
      schemaMarkdown: '# Available Looker Explores Catalog\n## Model: TheLook (`thelook`)\n- `thelook::order_items` (Order Items)',
      userPrompt: '/key-driver-analysis explain halloween sales drop',
      images: [{ data: '', mimeType: 'text/plain', dataUrl: '', name: 'halloween.sql', textContent: 'SELECT * FROM sales_oct31' }],
      requirePermission: false,
      onStatus: () => {},
    })

    const firstInputText = String(((postedBodies[0]?.input as Array<{ text?: string }>) || [])[0]?.text || '')
    expect(firstInputText).toContain('## Model: TheLook (`thelook`)')
    expect(firstInputText).toContain('IMPORTANT: All kda_toolkit.py helpers')
    expect(firstInputText).toContain('SELECT * FROM sales_oct31')
    expect(firstInputText).toContain('uploaded_files["halloween.sql"]')

    const fnResultInput = ((postedBodies[1]?.input as Array<{ result?: Record<string, unknown> }>) || [])[0]?.result
    expect(fnResultInput).toMatchObject({
      src: expect.objectContaining({
        type: 'dashboard',
        id: 'thelook::business_pulse',
        targets: [expect.objectContaining({ model: 'thelook', explore: 'order_items' })],
      }),
      sql: 'SELECT * FROM sales_oct31',
    })

    const recoveryText = String(((postedBodies[2]?.input as Array<{ text?: string }>) || [])[0]?.text || '')
    expect(recoveryText).toContain('Your previous bundle_app.py run failed validation and did not emit <DATA_APP_BUNDLE>')
    expect(turnRes.bundle?.title).toBe('Halloween KDA')

    // 6. Verify studioControllerTurn.ts guards prewarm until metadata loads, hydrates raw Looker URLs, and appends Looker Dashboard link
    const turnTs = readFileSync(path.join(repoRoot, 'src/studioControllerTurn.ts'), 'utf8')
    expect(turnTs).toContain('if (loadingMetadata && models.length === 0 && selectedExplores.length === 0) return')
    expect(turnTs).toContain('/(?:https?:\\/\\/[^\\s/]+)?\\/(dashboards|looks|explore)\\/([^\\s?#)]+)/gi')
    expect(turnTs).toContain('**Looker Dashboard:** [Open ${publishedDataAppDashboardLink.title}](${publishedDataAppDashboardLink.path})')
  })

  test('Issue #206: persists per-model sticky thinking levels independently, surfaces mobile Overview buttons, and renders touch long-press tooltips', async () => {
    expect(STUDIO_THINKING_LEVEL_BY_MODEL_STORAGE_KEY).toBe('dab_thinking_level_by_model')
    expect(
      normalizeThinkingLevelByModel(
        JSON.stringify({
          'gemini-4-argon': 'low',
          'gemini-3.8-flash': 'high',
          'gemini-3.7-flash': 'medium',
          invalid_model: 'ultra',
        })
      )
    ).toEqual({
      'gemini-4-argon': 'low',
      'gemini-3.8-flash': 'high',
      'gemini-3.7-flash': 'medium',
    })
    expect(normalizeThinkingLevelByModel('not-json')).toEqual({})
    expect(normalizeThinkingLevelByModel(['low'])).toEqual({})

    const storedItems: Record<string, string> = {}
    const mockExtHost = {
      localStorageGetItem: async (k: string) => storedItems[k] ?? null,
      localStorageSetItem: async (k: string, v: string) => {
        storedItems[k] = v
      },
    }

    persistThinkingLevelByModel(mockExtHost, {
      'gemini-4-argon': 'low',
      'gemini-3.8-flash': 'high',
    })
    expect(JSON.parse(storedItems[STUDIO_THINKING_LEVEL_BY_MODEL_STORAGE_KEY])).toEqual({
      'gemini-4-argon': 'low',
      'gemini-3.8-flash': 'high',
    })

    const loaded = await loadStoredThinkingLevelByModel(mockExtHost)
    expect(loaded).toEqual({
      'gemini-4-argon': 'low',
      'gemini-3.8-flash': 'high',
    })

    // Updating gemini-4-argon to medium preserves gemini-3.8-flash at high
    persistThinkingLevelByModel(mockExtHost, {
      ...loaded,
      'gemini-4-argon': 'medium',
    })
    expect(await loadStoredThinkingLevelByModel(mockExtHost)).toEqual({
      'gemini-4-argon': 'medium',
      'gemini-3.8-flash': 'high',
    })

    const seeded = readInitialThinkingLevelByModel('gemini-3.5-flash-lite', 'medium')
    expect(seeded['gemini-3.5-flash-lite']).toBeDefined()

    const repoRoot = path.resolve(__dirname, '../../..')
    const authSrc = readFileSync(path.join(repoRoot, 'src/studioControllerAuth.ts'), 'utf8')
    expect(authSrc).toContain('thinkingLevelByModel')
    expect(authSrc).toContain('setModelThinkingLevel')
    expect(authSrc).toContain('loadStoredThinkingLevelByModel(extensionSDK)')
    expect(authSrc).toContain('persistThinkingLevelByModel(extensionSDK, thinkingLevelByModelRef.current)')

    const wsSrc = [
      readFileSync(path.join(repoRoot, 'src/components/StudioComposer.tsx'), 'utf8'),
      readFileSync(path.join(repoRoot, 'src/components/StudioUseCaseGuides.tsx'), 'utf8'),
    ].join('\n')
    expect(wsSrc).toContain('value: thinkingLevelByModel?.[m.id] || defaultThinkingLevel || thinkingLevel')
    expect(wsSrc).toContain('onChange: (lvl) => setModelThinkingLevel(m.id, lvl as StudioThinkingLevel)')
    expect(wsSrc).toContain('data-testid="sidebar-overview-btn"')

    const headerSrc = readFileSync(path.join(repoRoot, 'src/components/StudioHeader.tsx'), 'utf8')
    expect(headerSrc).toContain('data-testid="topbar-mobile-overview-btn"')

    const appSrc = readFileSync(path.join(repoRoot, 'src/components/App.tsx'), 'utf8')
    expect(appSrc).toContain('data-testid="studio-longpress-tooltip"')
    expect(appSrc).toContain('suppressNextClickRef.current = true')
  })

}
