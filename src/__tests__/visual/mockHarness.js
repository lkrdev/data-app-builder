const { execFileSync, spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const { SAMPLE_PASTED_IMAGE_DATA_URL, buildMockFixturesScript } = require('./mockFixtures')

const repoRoot = path.resolve(__dirname, '../../..')
const bundlePath = path.join(repoRoot, 'dist/bundle.js')
const codemodePath = path.join(repoRoot, 'src/vendor/codemode.js')
const imageSnapshotsDir = path.join(__dirname, '../__image_snapshots__')
mkdirSync(imageSnapshotsDir, { recursive: true })

function buildHtmlPage(scenario) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent — Visual Test (${scenario})</title>
  <style>html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }</style>
  <script>
${buildMockFixturesScript(scenario)}
        dashboard: async (id) => {
          const did = String((id && id.dashboard_id) || id || '');
          if (did === '901') {
            return {
              id: '901',
              title: 'Business Pulse',
              description: 'Executive KPIs and order margin breakdown',
              folder: { id: '5' },
              dashboard_filters: [{ name: 'Created Date', field: 'order_items.created_date', default_value: '30 days' }],
              dashboard_elements: [
                {
                  id: '9011',
                  title: 'Revenue by Category',
                  type: 'vis',
                  query: {
                    model: 'thelook',
                    view: 'order_items',
                    fields: ['products.category', 'order_items.total_sale_price'],
                    sorts: ['order_items.total_sale_price desc'],
                    limit: '10'
                  }
                }
              ],
              dashboard_layouts: [{ id: '9012', type: 'newspaper', active: true }]
            };
          }
          if (did === '7') {
            return {
              id: '7',
              title: 'Executive Order Performance (Native UDD)',
              folder: { id: '5' },
              dashboard_elements: [{ id: '55' }, { id: '56' }]
            };
          }
          return {
            id: '42',
            title: 'Executive Revenue App',
            folder: { id: '5' },
            dashboard_elements: [
              {
                id: '101',
                type: 'extension',
                extension_id: 'db::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                rich_content_json: JSON.stringify({
                  queries: { 'da-kpi-rev': 'q1', 'da-kpi-orders': 'q2', 'da-chart-trend': 'q3' },
                  data_app_studio: {
                    explores: ['thelook::order_items'],
                    lastInteractionId: 'v1_app_42',
                    environmentId: 'env_42',
                    messages: artifactObjects.obj_app_42.messages
                  }
                })
              }
            ],
            dashboard_layouts: [{ id: '201', type: 'extension', active: true }]
          };
        },
        authSession: {
          transport: {
            rawRequest: async (method, reqPath, queryParams) => {
              if (reqPath.includes('content_summary')) {
                const items = await mockCore40SDK.content_summary(queryParams || {});
                return { ok: true, statusCode: 200, body: JSON.stringify(items) };
              }
              if (reqPath.includes('global_search_v2')) {
                const term = String((queryParams && queryParams.term) || '').toLowerCase();
                const items = [
                  { content_type: 'dashboard', content_id: '901', title: 'Business Pulse', description: 'Executive KPIs and order margin breakdown' },
                  { content_type: 'look', content_id: '301', title: 'Monthly Order Margin Look', description: 'Monthly revenue and gross margin trend' },
                  { content_type: 'explore', id: 'thelook::order_items', model_name: 'thelook', explore_name: 'order_items', title: 'Order Items' }
                ].filter((it) => !term || it.title.toLowerCase().includes(term));
                return { ok: true, statusCode: 200, body: JSON.stringify({ results: items }) };
              }
              if (reqPath.includes('inline_extension')) {
                return {
                  ok: true,
                  statusCode: 200,
                  body: '// Executive Revenue App Lit Bundle\\nimport { DataApp, html } from "/runtime/data-app.js";\\nexport class ExecutiveRevenueApp extends DataApp {}\\n'
                };
              }
              if (reqPath.includes('/artifacts/') && reqPath.endsWith('/search')) {
                const items = await mockCore40SDK.search_artifacts(queryParams || {});
                return { ok: true, statusCode: 200, body: JSON.stringify(items) };
              }
              if (reqPath.includes('/artifacts/')) {
                const pathParts = reqPath.split('/').filter(Boolean);
                const lastSeg = decodeURIComponent(pathParts[pathParts.length - 1] || '');
                const key = (queryParams && queryParams.key) || lastSeg;
                const items = await mockCore40SDK.artifact({ key });
                return { ok: true, statusCode: 200, body: JSON.stringify(items) };
              }
              return {
                ok: true,
                statusCode: 200,
                body: JSON.stringify({ method, path: reqPath })
              };
            }
          }
        }
      };

      let savedContextData = {
        authMode: 'oauth',
        clientId: 'looker-data-app-studio.apps.googleusercontent.com',
        projectId: 'looker-private-demo',
        disabledModes: []
      };

      const mockExtensionSDK = {
        lookerHostData: {
          hostUrl: 'https://dev-argolis.looker.com',
          extensionId: 'data_app_builder::data_app_builder',
          hostType: scenario === 'spartan_fullscreen' ? 'spartan' : 'standard',
          mountPoint: isTile ? 'dashboard-tile' : 'standalone',
          mountType: isTile ? 'dashboard_tile' : scenario === 'spartan_fullscreen' ? 'fullscreen' : 'standalone'
        },
        getContextData: () => savedContextData,
        saveContextData: async (ctx) => {
          savedContextData = { ...savedContextData, ...ctx };
          window.__LAST_SAVED_CONTEXT_DATA__ = savedContextData;
          return savedContextData;
        },
        localStorageGetItem: async (key) => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        localStorageSetItem: async (key, value) => {
          window.__LOCAL_STORAGE_UPDATES__ = window.__LOCAL_STORAGE_UPDATES__ || [];
          window.__LOCAL_STORAGE_UPDATES__.push({ key, value });
          try {
            window.localStorage.setItem(key, value);
          } catch {}
        },
        openBrowserWindow: (url, target) => {
          window.__OPENED_WINDOWS__ = window.__OPENED_WINDOWS__ || [];
          window.__OPENED_WINDOWS__.push({ url, target });
        },
        clipboardWrite: async (text) => {
          window.__CLIPBOARD_WRITES__ = window.__CLIPBOARD_WRITES__ || [];
          window.__CLIPBOARD_WRITES__.push(text);
        },
        oauth2Authenticate: async (authUrl, params, method) => {
          window.__OAUTH_CALLS__ = window.__OAUTH_CALLS__ || [];
          window.__OAUTH_CALLS__.push({ authUrl, params, method });
          if (typeof window.__MOCK_OAUTH_IMPL__ === 'function') {
            return window.__MOCK_OAUTH_IMPL__(authUrl, params, method);
          }
          return { access_token: 'mock_oauth_token_123' };
        },
        updateLocation: (url, state, target) => {
          window.__UPDATED_LOCATIONS__ = window.__UPDATED_LOCATIONS__ || [];
          window.__UPDATED_LOCATIONS__.push({ url, state, target });
        },
        rendered: () => {
          window.__RENDERED_CALLS__ = window.__RENDERED_CALLS__ || [];
          const tableEl = document.querySelector('.dab-tile-table, .dab-py-table');
          const markdownEl = document.querySelector('.dab-py-markdown');
          const idleEl = document.querySelector('.dab-tile-idle');
          const editEl = document.querySelector('.dab-tile-edit');
          window.__RENDERED_CALLS__.push({
            hasTableInDom: Boolean(tableEl),
            tableRowCount: tableEl ? tableEl.querySelectorAll('tbody tr').length : 0,
            tableText: tableEl ? (tableEl.innerText || '').trim() : '',
            hasMarkdownInDom: Boolean(markdownEl),
            hasIdleInDom: Boolean(idleEl),
            hasEditInDom: Boolean(editEl),
            bodyText: document.body ? (document.body.innerText || '').trim() : ''
          });
        },
        updateTitle: (title) => {
          window.__UPDATED_TITLES__ = window.__UPDATED_TITLES__ || [];
          window.__UPDATED_TITLES__.push(title);
        },
        serverProxy: async (url, init) => {
          window.__INTERACTION_CALLS__ = window.__INTERACTION_CALLS__ || [];
          const method = (init && init.method) || 'GET';
          const body = init && init.body ? JSON.parse(init.body) : undefined;
          window.__INTERACTION_CALLS__.push({ url, method, body });
          if (window.__MOCK_FORCE_ENV_FILE_404__ && url.includes('/environments/') && url.includes('/files/')) {
            return { ok: false, status: 404, body: JSON.stringify({ error: { message: 'File not found in remote sandbox' } }) };
          }
          if (method === 'GET' && url.includes('/interactions/') && !url.includes(':cancel') && window.__MOCK_LOOKER_EXTENSION__ && window.__MOCK_LOOKER_EXTENSION__.mockInteractions) {
            const rawId = url.split('/interactions/').pop().split(/[?#]/)[0];
            const hit = window.__MOCK_LOOKER_EXTENSION__.mockInteractions[decodeURIComponent(rawId)];
            if (window.__MOCK_INTERACTION_DELAY_MS__) {
              await new Promise((r) => setTimeout(r, window.__MOCK_INTERACTION_DELAY_MS__));
            }
            if (hit) return { ok: true, status: 200, body: JSON.stringify(hit) };
          }
          const inputText = (body && body.input && body.input[0] && body.input[0].text) || '';
          if (inputText.includes('[CA_AGENT_SELECTION_REQUEST]')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_ca_subagent_1',
                status: 'completed',
                output_text: '<CA_AGENT_SELECTION>{"agent_id":"ca_agent_ecommerce","agent_name":"eCommerce & BigQuery Analytics Agent","rationale":"Question asks about gross margin by product category in thelook::order_items.","initial_question":"What are the top 3 product categories by gross margin in Q4?"}</CA_AGENT_SELECTION>'
              })
            };
          }
          if (inputText.includes('[CONVERSATION_LABEL_REQUEST]')) {
            return {
              ok: true,
              status: 200,
              body: JSON.stringify({
                id: 'int_label_99',
                status: 'completed',
                output_text: '"Quarterly Order Margin Analysis."'
              })
            };
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'int_turn1_main',
              environment_id: 'env_dashboard_isolated',
              status: 'completed',
              output_text: 'Created native Looker Dashboard #99 with KPI and trend tiles.\\n<NATIVE_CONTENT_BUNDLE>{"id":"99","content_type":"dashboard","title":"Draft Dashboard 99","folder_id":"5","tile_count":2,"explores":["thelook::order_items"]}</NATIVE_CONTENT_BUNDLE>'
            })
          };
        }
      };

      window.__MOCK_LOOKER_EXTENSION__ = {
        initialRoute: routeMap[scenario] || '/app/42',
        initialThemeMode: scenario === 'studio_dark_theme' ? 'dark' : undefined,
        initialPendingPerm: scenario === 'data_app' ? {
          operation: 'create_dashboard',
          httpMethod: 'POST',
          path: '/api/4.0/dashboards',
          args: { title: 'Executive Revenue App', folder_id: '5' }
        } : undefined,
        initialComboOpen:
          scenario === 'explore_dropdown_open_top' || scenario === 'explore_dropdown_scrolled',
        initialExploreScrollTop: scenario === 'explore_dropdown_scrolled' ? 140 : 0,
        initialPrompt:
          scenario === 'chatbar_pasted_image_inspector'
            ? 'Match the layout in this screenshot and add a gross margin breakdown.'
            : scenario === 'chatbar_lookml_skills'
            ? '/lookml'
            : '',
        initialPastedImages:
          scenario === 'chatbar_pasted_image_inspector'
            ? [
                {
                  mimeType: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                  dataUrl: ${JSON.stringify(SAMPLE_PASTED_IMAGE_DATA_URL)}
                }
              ]
            : [],
        initialInspectorOpen: scenario === 'chatbar_pasted_image_inspector',
        initialBusyStatus:
          scenario === 'chatbar_busy_running'
            ? 'Executing Looker queries for Order Items...'
            : null,
        initialError:
          scenario === 'chatbar_error_banner'
            ? 'Looker API Error (422): Field "order_items.unknown_metric" not found in explore "thelook::order_items".'
            : null,
        openSchedulerModal: scenario === 'python_tile_scheduler_modal',
        forceAppInitializing: scenario === 'ripper_surf_loader',
        environmentFiles: {
          '/workspace/analysis.md': '# Q4 Revenue Drop Root-Cause Analysis\\n\\n- **Primary Driver:** Outerwear stockouts in West region (-$420K YoY)\\n- **Secondary Driver:** Shipping carrier delay on express orders',
          '/workspace/report.md': '# Executive Remediation Report\\n\\n1. Rebalance West warehouse inventory\\n2. Enable fallback regional carrier routing'
        },
        extensionSDK: mockExtensionSDK,
        core40SDK: mockCore40SDK,
        lookerHostData: mockExtensionSDK.lookerHostData,
        tileHostData: isTile ? {
          elementId: scenario === 'tile_mount_unbound' ? '999' : '57',
          dashboardId: '8',
          isDashboardEditing: scenario === 'tile_mount_edit',
          dashboardRunState: 'NOT_RUNNING',
          dashboardFilters: { status: 'Complete', model: 'thelook' }
        } : undefined,
        getMockPreviewHtml: (mode, objectId) => {
          if (mode === 'conversational-analytics') {
            return \`<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div>
                  <span style="background:#ede9fe;color:#6d28d9;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">LOOKER CONVERSATIONAL ANALYTICS · \${objectId || 'ca_conv_streaming_1'}</span>
                  <h2 style="margin:6px 0 0;font-size:20px;">eCommerce &amp; BigQuery Analytics Agent (Embedded Conversation)</h2>
                </div>
                <span style="background:#fff;border:1px solid #cbd5e1;padding:6px 12px;border-radius:6px;font-size:12px;">Agent ID: <strong>ca_agent_ecommerce</strong></span>
              </div>
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:14px;">
                <div style="font-size:12px;color:#64748b;font-weight:600;">USER QUESTION</div>
                <div style="font-size:14px;color:#0f172a;margin-top:4px;font-weight:600;">Why did order revenue spike in Q4 and which BigQuery tables had the highest streaming buffer volume?</div>
              </div>
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;">
                <div style="font-size:12px;color:#6d28d9;font-weight:700;">CA AGENT VERIFIED ANSWER · thelook::order_items + streaming_timeline</div>
                <p style="font-size:13px;line-height:1.5;color:#1e293b;margin:8px 0 12px;">Q4 order revenue rose <strong>+18.4% YoY ($4.28M)</strong> led by Outerwear and Jeans, while <strong>looker-private-demo.thelook.events</strong> accounted for 84% of streaming buffer bytes (507.5 MB across 2.89M rows).</p>
              </div>
            </body></html>\`;
          }
          if (mode === 'dashboard') {
            return \`<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div>
                  <span style="background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">LOOKER NATIVE UDD #7</span>
                  <h2 style="margin:6px 0 0;font-size:20px;">Executive Order Performance (Native UDD via CodeMode)</h2>
                </div>
                <div style="background:#fff;border:1px solid #cbd5e1;padding:6px 12px;border-radius:6px;font-size:12px;">Filter: <strong>Order Status = Any</strong></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                  <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">Tile #55 · Total Revenue & Orders KPI</div>
                  <div style="font-size:34px;font-weight:800;color:#0f172a;margin-top:12px;">$14,011,848.92</div>
                  <div style="font-size:14px;color:#059669;margin-top:6px;font-weight:600;">303,454 Total Orders (thelook::order_items)</div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                  <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:12px;">Tile #56 · Revenue & Orders by Status (looker_column)</div>
                  <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
                    <div><div style="display:flex;justify-content:space-between;"><span>Complete (289,494)</span><strong>$13,366,666.37</strong></div><div style="height:10px;background:#2563eb;width:95%;border-radius:4px;margin-top:3px;"></div></div>
                    <div><div style="display:flex;justify-content:space-between;"><span>Cancelled (7,789)</span><strong>$362,803.49</strong></div><div style="height:10px;background:#f59e0b;width:18%;border-radius:4px;margin-top:3px;"></div></div>
                    <div><div style="display:flex;justify-content:space-between;"><span>Returned (3,004)</span><strong>$135,824.96</strong></div><div style="height:10px;background:#ef4444;width:10%;border-radius:4px;margin-top:3px;"></div></div>
                  </div>
                </div>
              </div>
            </body></html>\`;
          }
          return \`<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#0f172a;color:#f8fafc;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
              <div>
                <span style="background:#1e3a8a;color:#93c5fd;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">LIT DATA APP · db::a1b2c3d4</span>
                <h2 style="margin:6px 0 0;font-size:20px;">Executive Revenue App (Dashboard #42)</h2>
              </div>
              <span style="font-size:12px;color:#94a3b8;">Explore: thelook::order_items</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px;">
              <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;">TOTAL REVENUE</div><div style="font-size:26px;font-weight:700;margin-top:6px;color:#38bdf8;">$14.01M</div><div style="font-size:11px;color:#4ade80;margin-top:4px;">▲ +18.4% YoY</div></div>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;">TOTAL ORDERS</div><div style="font-size:26px;font-weight:700;margin-top:6px;color:#f8fafc;">303,454</div><div style="font-size:11px;color:#4ade80;margin-top:4px;">▲ +12.1% YoY</div></div>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;"><div style="font-size:11px;color:#94a3b8;">AVG ORDER VALUE</div><div style="font-size:26px;font-weight:700;margin-top:6px;color:#a78bfa;">$46.17</div><div style="font-size:11px;color:#4ade80;margin-top:4px;">▲ +5.6% YoY</div></div>
            </div>
            <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:18px;">
              <div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">MONTHLY REVENUE TREND (HIGHCHARTS LIT COMPONENT)</div>
              <div style="display:flex;align-items:flex-end;gap:10px;height:140px;padding-top:10px;">
                <div style="flex:1;background:#38bdf8;height:45%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:52%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:60%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:58%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:72%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:85%;border-radius:4px 4px 0 0;"></div>
                <div style="flex:1;background:#38bdf8;height:95%;border-radius:4px 4px 0 0;"></div>
              </div>
            </div>
          </body></html>\`;
        }
      };
    })();
  </script>
</head>
<body>
  <script src="/codemode.js"></script>
  <script src="/bundle.js"></script>
</body>
</html>`
}

async function startHeadlessChrome() {
  const proc = spawn(
    '/usr/bin/google-chrome',
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--remote-debugging-port=0',
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  const wsBrowserUrl = await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`Chrome startup timeout: ${stderr}`)), 10000)
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
  })

  const httpBase = wsBrowserUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '')
  const targets = await fetch(`${httpBase}/json/list`).then((r) => r.json())
  const pageTarget = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let msgId = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const data = JSON.parse(String(ev.data))
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) reject(new Error(data.error.message))
      else resolve(data.result)
    }
  })

  const rawSend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const send = async (method, params = {}) => {
    if (method === 'Page.navigate') {
      try {
        await rawSend('Runtime.evaluate', {
          expression: `(() => {
            delete window.__DAB_STUDIO__;
            delete window.__RENDERED_CALLS__;
            delete window.__LOOKER_EMBED_STATE__;
            if (document.body) document.body.innerHTML = '';
          })()`
        })
      } catch {
        /* ignore */
      }
    }
    return rawSend(method, params)
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })

  return {
    send,
    close: () => {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      proc.kill('SIGKILL')
    }
  }
}

const scenarios = [
    {
      id: 'data_app',
      category: 'Mini-App Modes',
      title: '1. Data App Mode + Inline Mutation Permission Gate',
      snapshotName: '01-mode-data-app-and-permission-gate-snap.png',
      expectText: [
        'Ripper',
        'Data App',
        'Safe Mode (Ask)',
        'Approve Looker State Mutation?',
        'create_dashboard',
        'Executive Revenue App',
        'Send Message'
      ]
    },
    {
      id: 'dashboard',
      category: 'Mini-App Modes',
      title: '2. Content Studio Mode (Create & Update UDDs, Looks, Boards, Schedules)',
      snapshotName: '02-mode-native-dashboard-builder-snap.png',
      expectText: [
        'Executive Order Performance (Native UDD)',
        '/embed/dashboards/7',
        'Update Content'
      ]
    },
    {
      id: 'lookml',
      category: 'Mini-App Modes',
      title: '3. Agentic LookML Mode (Turn Skills, Active User Dev Mode & .lkml Diffs)',
      snapshotName: '03-mode-agentic-lookml-snap.png',
      expectText: [
        'Add total_revenue & gross_margin to order_items',
        'LookML: deploytobarerepo_temp',
        'bronze/orders.refinement.lkml',
        'total_revenue',
        'Update LookML'
      ]
    },
    {
      id: 'health_check',
      category: 'Mini-App Modes',
      title: '4. 3-Pillar Health Check Mode (Rendered Markdown Viewer & Top-Right Gemini Button)',
      snapshotName: '04-mode-3-pillar-health-check-snap.png',
      expectText: [
        'Run 3-Pillar Audit',
        'All 3 Pillars (Looker + BQ)',
        'Health Score: 70% (B- (Optimization Recommended))',
        'Transcriber: 2.86/4.00',
        'Technical Design Document (TDD): Looker & BigQuery 3-Pillar Health Check',
        '{ } Raw Markdown',
        'Copy Markdown',
        'Download Markdown (.md)'
      ]
    },
    {
      id: 'python_tile_studio',
      category: 'Mini-App Modes',
      title: '5. Python Tile Studio Mode (Mode Selector, Schedule Script & Live Grid)',
      snapshotName: '05-mode-python-tile-studio-snap.png',
      expectText: [
        'Looker Explore & Filter Summary',
        'Schedule Script',
        'Publish Dashboard',
        'Run Python',
        'Ask AI',
        'Scheduled: 0 8 * * * · summary',
        'agentic_thelook'
      ]
    },
    {
      id: 'tile_mount_view',
      category: 'Tile & Scheduler Modal',
      title: '6. Dashboard Tile Mount — View Mode',
      snapshotName: '06-dashboard-tile-mount-view-mode-snap.png',
      expectText: ['thelook', 'eCommerce', 'agentic_thelook', 'Complete']
    },
    {
      id: 'tile_mount_edit',
      category: 'Tile & Scheduler Modal',
      title: '7. Dashboard Tile Mount — Edit Mode',
      snapshotName: '07-dashboard-tile-mount-edit-mode-snap.png',
      expectText: [
        'CodeMode Python Tile Configuration',
        'Tile #57',
        'Looker Explore & Filter Summary (demo1)'
      ]
    },
    {
      id: 'config_page',
      category: 'Config & Explore Dropdown',
      title: '8. Extension Auth & Vertex Setup Page (/config)',
      snapshotName: '08-config-page-setup-snap.png',
      expectText: [
        'Agent',
        'Configuration',
        'Agent & Vertex / Gemini Setup',
        'Google OAuth',
        'Save Setup'
      ]
    },
    {
      id: 'explore_dropdown_open_top',
      category: 'Config & Explore Dropdown',
      title: '9. Explore Combobox Dropdown — Open (Top Scroll State)',
      snapshotName: '09-explore-dropdown-open-top-snap.png',
      clipSelector: ['[data-testid="composer-at-mention-menu"]', '.dab-composer'],
      expectText: [
        'Clear selection (let agent decide)',
        'BIGQUERY INFORMATION SCHEMA (BLOCK)',
        'Jobs Timeline by Project',
        'Table Storage & Partitions',
        'ECOMMERCE',
        'Order Items'
      ]
    },
    {
      id: 'explore_dropdown_scrolled',
      category: 'Config & Explore Dropdown',
      title: '10. Explore Combobox Dropdown — Scrolled State (Retail Ops & System Activity)',
      snapshotName: '10-explore-dropdown-scrolled-snap.png',
      clipSelector: ['[data-testid="composer-at-mention-menu"]', '.dab-composer'],
      expectText: [
        'RETAIL OPERATIONS',
        'Store Transactions',
        'Supply Chain Shipments',
        'SYSTEM ACTIVITY',
        'Query Metrics'
      ]
    },
    {
      id: 'chatbar_lookml_skills',
      category: 'Chat Bar States',
      title: '11. Chat Bar State — LookML Activated Turn Skills & Prompt',
      snapshotName: '11-chatbar-state-lookml-activated-skills-snap.png',
      clipSelector: ['[data-testid="composer-slash-skill-menu"]', '.dab-composer'],
      expectText: [
        '/lookml-field-curation',
        '/lookml-tests',
        '/lookml-snapshot',
        'Run Agentic LookML'
      ]
    },
    {
      id: 'chatbar_pasted_image_inspector',
      category: 'Chat Bar States',
      title: '12. Chat Bar State — Pasted Screenshot Thumbnail & Composer Model Selector',
      snapshotName: '12-chatbar-state-pasted-image-and-inspector-snap.png',
      clipSelector: '.dab-composer',
      expectText: [
        'Gemini 3.8 Flash',
        'Send Message'
      ]
    },
    {
      id: 'chatbar_busy_running',
      category: 'Chat Bar States',
      title: '13. Chat Bar State — Busy / Running Spinner Banner',
      snapshotName: '13-chatbar-state-busy-running-snap.png',
      clipSelector: ['.dab-status-banner', '.dab-composer'],
      expectText: [
        'Executing Looker queries for Order Items...',
        'Executive Revenue App'
      ]
    },
    {
      id: 'chatbar_error_banner',
      category: 'Chat Bar States',
      title: '14. Chat Bar State — Error Diagnostic Banner',
      snapshotName: '14-chatbar-state-error-banner-snap.png',
      clipSelector: ['.dab-msg-error', '.dab-composer'],
      expectText: [
        'Error',
        'Looker API Error (422): Field "order_items.unknown_metric" not found in explore "thelook::order_items".'
      ]
    },
    {
      id: 'python_tile_scheduler_modal',
      category: 'Tile & Scheduler Modal',
      title: '15. Custom CodeMode Script Scheduler Modal (Cron, vars.mode & Custom Controls)',
      snapshotName: '15-python-tile-scheduler-modal-snap.png',
      clipSelector: '.dab-modal',
      expectText: [
        'Custom CodeMode Script Scheduler',
        'obj_schedule_demo1',
        'Daily at 8:00 AM (0 8 * * *)',
        'Script Execution Mode (`vars.mode`)',
        'Custom Controls / Non-Query Variables (`vars.custom_controls` JSON)',
        'Save Script Schedule'
      ]
    },
    {
      id: 'conversational_analytics',
      category: 'Mini-App Modes',
      title: '16. Conversational Analytics Mode (Isolated Sub-Agent Selection & Embedded CA Chat)',
      snapshotName: '16-mode-conversational-analytics-snap.png',
      expectText: [
        'Conversational Analytics',
        'BigQuery Streaming Buffer & Order Revenue Q&A',
        'Agent: eCommerce & BigQuery Analytics Agent (ca_agent_ecommerce)',
        'Isolated Sub-Agent Selection:',
        '/embed/conversations/ca_conv_streaming_1',
        'Ask CA Agent'
      ]
    },
    {
      id: 'centered_empty_prompt',
      category: 'Chat Bar States',
      title: '17. Centered New-Conversation Empty Prompt Box (Use-Case Selector, Input & Actions)',
      snapshotName: '17-centered-empty-prompt-snap.png',
      clipSelector: '.dab-empty-prompt-card',
      expectText: [
        'Ripper is ready',
        'Send Message'
      ]
    },
    {
      id: 'studio_dark_theme',
      category: 'Mini-App Modes',
      title: '18. Studio Dark Theme Mode (Semantic Dark Surface & Text Tokens)',
      snapshotName: '18-studio-dark-theme.png',
      expectText: [
        'Ripper',
        'Executive Revenue App',
        'Send Message'
      ]
    }
  ]

  function writeSnapshotManifest() {
    const gitOut = execFileSync(
      'git',
      ['status', '--porcelain', 'src/__tests__/__image_snapshots__'],
      { cwd: repoRoot, encoding: 'utf8' }
    )
    const changedFiles = new Set(
      gitOut
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => path.basename(line.slice(3).trim()))
    )
    const manifest = scenarios.map((s) => {
      const snapFile = path.join(imageSnapshotsDir, s.snapshotName)
      const buf = existsSync(snapFile) ? readFileSync(snapFile) : null
      const width = buf && buf.length >= 24 ? buf.readUInt32BE(16) : 1440
      const height = buf && buf.length >= 24 ? buf.readUInt32BE(20) : 900
      return {
        id: s.id,
        category: s.category,
        title: s.title,
        snapshotName: s.snapshotName,
        width,
        height,
        ...(s.clipSelector ? { clipSelector: s.clipSelector, clipMargin: s.clipMargin ?? 24 } : {}),
        changedInGit: changedFiles.has(s.snapshotName)
      }
    })
    writeFileSync(path.join(imageSnapshotsDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    return manifest
  }

module.exports = {
  repoRoot,
  bundlePath,
  codemodePath,
  imageSnapshotsDir,
  SAMPLE_PASTED_IMAGE_DATA_URL,
  buildHtmlPage,
  startHeadlessChrome,
  scenarios,
  writeSnapshotManifest
}
