#!/usr/bin/env node
// Standalone single-turn live evaluation for Looker Data Apps (Studio turn -> bundle -> Looker dashboard publish -> Headless Chrome live render & output hygiene).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getApiKey } from './eval-new-project.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const {
  fetchConversationSandboxDebugMarkdown,
  runAntigravityTurn,
} = require(path.join(rootDir, 'src/antigravity.ts'))
const { DEFAULT_ANTIGRAVITY_MODEL } = require(path.join(rootDir, 'src/antigravityTypes.ts'))
const {
  ARTIFACT_NAMESPACE,
  buildAvailableExploresCatalog,
  buildDenseExploreSchema,
  deleteUserArtifact,
  extractResolvedUseCase,
  fetchInitialLookerMetadata,
  loadExistingDashboardApp,
  parseExploreId,
  saveDashboardStudioMetadata,
  unwrapLookerRawResponse,
} = require(path.join(rootDir, 'src/lookerApi.ts'))
const { materializeTurnBundles } = require(path.join(rootDir, 'src/studioControllerConcurrency.ts'))

export const STICKER_BOOK_PROMPT = [
  'Build a playful sticker-book e-commerce command center using the (1) Orders, Items and Users and (8) Cohort Analysis explores in the eCommerce model, pairing warm paper-and-sticker visual polish and Lu the friendly mascot with live Looker commerce analytics.',
  '',
  'Provide five interactive views (Pulse, Network, Forecast, Voice, and Tree) covering headline KPIs (Order Items Total Sale Price, Order Items Total Gross Margin, Order Items Total Gross Margin Percentage, Orders Order Count, Order Items Average Sale Price, Order Items Return Rate, Order Items Returned Count, and Order Items Average Days to Process), daily and weekly trends (Order Items Created Date, Order Items Created Week, Order Items Created Month), fulfilment corridors (Distribution Center Name to Users State), customer cluster segmentation (Ecomm Predict Centroid ID, Ecomm Predict Centroid Label, Ecomm Predict Count, Users Average Age), and product and audience breakdowns (Products Department, Products Category, Products Brand, Users Traffic Source, Users Age Tier, Order Items Status).',
  '',
  'Include global segment pills, an interactive guided Tour with Lu, signal cards that can be applied directly as dashboard filters, cross-filtering, and a Query Inspector drawer.',
].join('\n')

export function getLookerAuth(account = 'dev-argolis') {
  execFileSync('lkr', [`--oauth-account=${account}`, 'auth', 'whoami'], { stdio: 'ignore' })
  const db = new DatabaseSync(path.join(os.homedir(), '.lkr/auth.db'), { open: true, readOnly: true })
  const row = db.prepare('SELECT base_url, token_type, access_token FROM auth WHERE instance_name = ?').get(account)
  db.close()
  if (!row?.base_url || !row?.access_token) {
    throw new Error(`Missing Looker OAuth credentials in ~/.lkr/auth.db for account "${account}"`)
  }
  return {
    base_url: String(row.base_url).replace(/\/+$/, ''),
    auth_header: `${row.token_type || 'Bearer'} ${row.access_token}`,
  }
}

export function createDataAppEvalSdk(account = 'dev-argolis') {
  let currentAuth = getLookerAuth(account)
  const rawRequest = async (method, reqPath, queryParams, body) => {
    const cleanPath = reqPath.startsWith('/api/') ? reqPath : `/api/4.0${reqPath.startsWith('/') ? '' : '/'}${reqPath}`
    const doFetch = async () => {
      const url = new URL(`${currentAuth.base_url}${cleanPath}`)
      if (queryParams && typeof queryParams === 'object') {
        for (const [k, v] of Object.entries(queryParams)) {
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
        }
      }
      const upper = String(method || 'GET').toUpperCase()
      const init = { method: upper, headers: { Authorization: currentAuth.auth_header, 'Content-Type': 'application/json' } }
      if (body !== undefined && body !== null && upper !== 'GET' && upper !== 'HEAD') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body)
      }
      return fetch(url.toString(), init)
    }
    let resp = await doFetch()
    if (resp.status === 401) {
      currentAuth = getLookerAuth(account)
      resp = await doFetch()
    }
    const text = await resp.text()
    let parsed = text
    const ct = resp.headers.get('content-type') || ''
    if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try { parsed = JSON.parse(text) } catch {}
    }
    return { ok: resp.ok, statusCode: resp.status, statusMessage: resp.statusText, contentType: ct || 'application/json', body: parsed }
  }
  const call = async (method, reqPath, queryParams, body) =>
    unwrapLookerRawResponse(await rawRequest(method, reqPath, queryParams, body), method, reqPath)

  return {
    baseUrl: () => currentAuth.base_url,
    ok: async (p) => {
      const r = await p
      if (r && typeof r === 'object' && 'ok' in r && 'value' in r) {
        if (!r.ok) throw new Error(JSON.stringify(r.error || r))
        return r.value
      }
      return r
    },
    authSession: { transport: { rawRequest } },
    me: (fields) => call('GET', '/user', fields ? { fields } : undefined),
    session: () => call('GET', '/session'),
    update_session: (body) => call('PATCH', '/session', undefined, body),
    all_lookml_models: (params) => call('GET', '/lookml_models', params),
    lookml_model_explore: (m, e, fields) =>
      call('GET', `/lookml_models/${encodeURIComponent(m)}/explores/${encodeURIComponent(e)}`, typeof fields === 'string' ? { fields } : fields),
    create_query: (body) => call('POST', '/queries', undefined, body),
    run_inline_query: (fmt, body) => call('POST', `/queries/run/${fmt}`, undefined, body),
    create_dashboard: (body) => call('POST', '/dashboards', undefined, body),
    dashboard: (did) => call('GET', `/dashboards/${encodeURIComponent(did)}`),
    update_dashboard: (did, body) => call('PATCH', `/dashboards/${encodeURIComponent(did)}`, undefined, body),
    update_dashboard_element: (eid, body) => call('PATCH', `/dashboard_elements/${encodeURIComponent(eid)}`, undefined, body),
    delete_dashboard: (did) => call('DELETE', `/dashboards/${encodeURIComponent(did)}`),
  }
}

export async function verifyDataAppInHeadlessBrowser({ account = 'dev-argolis', sdk, dashboardId, loadedCode, screenshotPath }) {
  const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome'
  if (!fs.existsSync(chromeBin)) throw new Error(`Headless Chrome binary not found at ${chromeBin}`)
  const targetUrl = `${sdk.baseUrl()}/embed/dashboards/${encodeURIComponent(dashboardId)}`
  // Security: create_embed_url_as_me returns a one-time signed login URL; keep strictly in memory and never persist to disk/logs.
  const signedUrl = JSON.parse(
    execFileSync('lkr', [`--oauth-account=${account}`, 'code-mode', 'sandbox', '-v', `target_url=${targetUrl}`, '-c', 'return create_embed_url_as_me({"target_url": target_url, "session_length": 300, "force_logout_login": True})'], { encoding: 'utf8' })
  )?.url
  if (!signedUrl) throw new Error(`create_embed_url_as_me did not return a signed URL for dashboard ${dashboardId}`)

  const chrome = spawn(
    chromeBin,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--window-size=1440,1080', '--remote-debugging-port=0', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  const cdpExceptions = []
  let liveQueriesExecuted = 0
  const connectCdp = async (wsTargetUrl, { fulfillBundle = false } = {}) => {
    const ws = new WebSocket(wsTargetUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    let nextId = 1
    const pending = new Map()
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            reject(new Error(`CDP timeout on ${method}`))
          }
        }, 25000)
        pending.set(id, {
          resolve: (v) => { clearTimeout(timer); resolve(v) },
          reject: (e) => { clearTimeout(timer); reject(e) },
        })
        ws.send(JSON.stringify({ id, method, params }))
      })
    ws.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error('CDP WebSocket closed'))
      pending.clear()
    })
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else p.resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails
        const desc = String(d?.exception?.description || d?.text || JSON.stringify(d))
          .replace(/data:text\/html;base64,[A-Za-z0-9+/=%]+/g, 'data:text/html;base64,<iframe-srcdoc>')
          .slice(0, 600)
        cdpExceptions.push(desc)
      } else if (msg.method === 'Network.responseReceived') {
        const respUrl = String(msg.params?.response?.url || '')
        if (respUrl.includes('/queries/') || respUrl.includes('/api/internal/dataflux/') || respUrl.includes('/run/')) {
          liveQueriesExecuted += 1
        }
      } else if (fulfillBundle && msg.method === 'Fetch.requestPaused') {
        // ponytail: Looker's /embed-scoped session returns 403 on non-/embed /inline_extension/*/bundle.js; serve the exact Looker-stored bundleCode.
        send('Fetch.fulfillRequest', {
          requestId: msg.params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: Buffer.from(String(loadedCode || ''), 'utf8').toString('base64'),
        }).catch(() => {})
      }
    })
    return { ws, send }
  }

  let pageCdp = null
  let iframeCdp = null
  try {
    const wsBrowserUrl = await new Promise((resolve, reject) => {
      let stderrBuf = ''
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for Chrome DevTools URL (${stderrBuf.slice(-300)})`)), 15000)
      chrome.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString('utf8')
        const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (m) {
          clearTimeout(timer)
          resolve(m[1])
        }
      })
      chrome.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Chrome exited prematurely with code ${code}: ${stderrBuf.slice(-300)}`))
      })
    })

    const httpBase = wsBrowserUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '')
    const initialTargets = await fetch(`${httpBase}/json/list`).then((r) => r.json())
    const pageTarget = initialTargets.find((t) => t.type === 'page')
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error('Could not find Chrome page target in /json/list')
    }

    pageCdp = await connectCdp(pageTarget.webSocketDebuggerUrl, { fulfillBundle: true })
    await pageCdp.send('Page.enable')
    await pageCdp.send('Runtime.enable')
    await pageCdp.send('Network.enable')
    await pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/inline_extension/*/bundle.js*' }] })
    await pageCdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 2, mobile: false })
    await pageCdp.send('Page.navigate', { url: signedUrl })

    const iframeDeadline = Date.now() + 25000
    while (Date.now() < iframeDeadline && !iframeCdp) {
      await new Promise((r) => setTimeout(r, 250))
      const targets = await fetch(`${httpBase}/json/list`).then((r) => r.json()).catch(() => [])
      const iframeTarget = targets.find((t) => t.type === 'iframe' && String(t.url || '').startsWith('data:text/html') && t.webSocketDebuggerUrl)
      if (iframeTarget) {
        try {
          const cdp = await connectCdp(iframeTarget.webSocketDebuggerUrl)
          await cdp.send('Runtime.enable')
          iframeCdp = cdp
        } catch {}
      }
    }
    if (!iframeCdp) throw new Error(`Timed out waiting for Looker inline extension iframe on dashboard ${dashboardId}`)

    const inspectExpr = `(() => {
      const children = Array.from(document.body ? document.body.children : []);
      const customEl = children.find((el) => el.tagName && el.tagName.includes('-'));
      const appEl = customEl || children[0] || null;
      const rect = appEl ? appEl.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        customTag: customEl ? customEl.tagName.toLowerCase() : '',
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0),
        textLength: document.body ? (document.body.innerText || '').trim().length : 0,
        kpiCount: document.querySelectorAll('app-kpi, .kpi-card, [class*="kpi"]').length,
        chartCount: document.querySelectorAll('app-chart, .highcharts-container, svg').length,
        gridCount: document.querySelectorAll('app-grid, .ag-root-wrapper, table').length,
        hasStyleTag: document.querySelectorAll('style').length > 0,
      };
    })()`

    let snap = { customTag: '', width: 0, height: 0, textLength: 0, kpiCount: 0, chartCount: 0, gridCount: 0, hasStyleTag: false }
    const settleDeadline = Date.now() + 20000
    const settleStartedAt = Date.now()
    let readyTicks = 0
    while (Date.now() < settleDeadline) {
      await new Promise((r) => setTimeout(r, 500))
      const res = await iframeCdp.send('Runtime.evaluate', { expression: inspectExpr, returnByValue: true }).catch(() => null)
      if (res?.result?.value) {
        snap = res.result.value
        if (snap.customTag && snap.height >= 300 && snap.textLength >= 200 && snap.kpiCount + snap.chartCount + snap.gridCount >= 4) {
          if (++readyTicks >= 4) break
        } else if (!snap.customTag && cdpExceptions.length > 0 && Date.now() - settleStartedAt >= 3000) {
          break
        }
      }
    }

    let clickedViews = []
    if (snap.customTag) {
      const clickRes = await iframeCdp
        .send('Runtime.evaluate', {
          awaitPromise: true,
          returnByValue: true,
          expression: `(async () => {
            const clicked = [];
            for (const viewName of ['Network', 'Forecast', 'Voice', 'Tree', 'Pulse']) {
              const candidates = Array.from(document.querySelectorAll('button, [role="tab"], a, .da-tab-btn, [data-view], [data-tab]'));
              const btn = candidates.find((el) => new RegExp('\\\\b' + viewName + '\\\\b', 'i').test((el.textContent || '').trim()));
              if (btn) {
                btn.click();
                clicked.push(viewName);
                await new Promise((r) => setTimeout(r, 500));
              }
            }
            await new Promise((r) => setTimeout(r, 1000));
            return clicked;
          })()`,
        })
        .catch(() => null)
      if (Array.isArray(clickRes?.result?.value)) clickedViews = clickRes.result.value
      const finalRes = await iframeCdp.send('Runtime.evaluate', { expression: inspectExpr, returnByValue: true }).catch(() => null)
      if (finalRes?.result?.value) {
        const f = finalRes.result.value
        snap = {
          customTag: f.customTag || snap.customTag,
          width: Math.max(snap.width, f.width),
          height: Math.max(snap.height, f.height),
          textLength: Math.max(snap.textLength, f.textLength),
          kpiCount: Math.max(snap.kpiCount, f.kpiCount),
          chartCount: Math.max(snap.chartCount, f.chartCount),
          gridCount: Math.max(snap.gridCount, f.gridCount),
          hasStyleTag: snap.hasStyleTag || f.hasStyleTag,
        }
      }
    }

    if (screenshotPath) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
      const shot = await pageCdp.send('Page.captureScreenshot', { format: 'png' })
      if (shot?.data) fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'))
    }

    const uncaughtExceptions = Array.from(new Set(cdpExceptions))
    const renderedNonBlank =
      uncaughtExceptions.length === 0 &&
      Boolean(snap.customTag) &&
      snap.height >= 300 &&
      snap.textLength >= 200 &&
      snap.kpiCount + snap.chartCount + snap.gridCount >= 4

    return { renderedNonBlank, ...snap, clickedViews, liveQueriesExecuted, uncaughtExceptions, screenshotPath: screenshotPath || '' }
  } finally {
    try { iframeCdp?.ws?.close() } catch {}
    try { pageCdp?.ws?.close() } catch {}
    try { chrome.kill('SIGKILL') } catch {}
  }
}

export function gradeDataAppTurnOutput({ resolvedUseCase, bundle, baseAssistantText, finalAssistantText, publishedDashboardId, contentItems, liveVerification }) {
  const dashLinkMatch = String(finalAssistantText || '').match(/\[([^\]]+)\]\((?:https?:\/\/[^\s)]+)?\/dashboards\/([A-Za-z0-9_-]+)(?:[?#][^)]*)?\)/i)
  const linkedDashboardId = dashLinkMatch ? dashLinkMatch[2] : ''
  const expectedId = String(publishedDashboardId || '').trim()
  const rightPaneTabOk = Array.isArray(contentItems) && contentItems.some(
    (it) => it?.contentType === 'data_app' && String(it.id) === expectedId && it.embedPath === `/embed/dashboards/${encodeURIComponent(expectedId)}`
  )
  const codeSource = String(liveVerification?.loadedCode || bundle?.prod_code || bundle?.raw_code || '')
  const br = liveVerification?.browserRender
  const checks = {
    routedToApp: resolvedUseCase === 'app',
    emittedValidBundle: Boolean(
      bundle?.raw_code &&
      bundle?.prod_code?.includes('https://www.gstatic.com/looker-data-apps/versions/') &&
      /customElements\.define\s*\(/.test(bundle.prod_code)
    ),
    noJsLinks: !/\[[^\]]*\]\([^)]*\.js(?:[?#][^)]*)?\)/i.test(finalAssistantText) && !/file:\/\/[^\s)]+/i.test(finalAssistantText),
    noJsReferences: !/\b[A-Za-z0-9_./-]*\.js\b/i.test(finalAssistantText) && !/\/workspace\b/i.test(finalAssistantText),
    hasSummary:
      String(baseAssistantText || '').trim().length >= 80 &&
      !/<DATA_APP_BUNDLE>/i.test(finalAssistantText) &&
      !/```/.test(String(baseAssistantText || '')) &&
      !/[.!](?:The|I|Built)\s+\*\*/.test(String(baseAssistantText || '')),
    hasDashboardLink: Boolean(expectedId && linkedDashboardId === expectedId && rightPaneTabOk),
    liveDashboardOpenable: Boolean(
      expectedId &&
      liveVerification?.dashboardExists &&
      !/^Build a\s+/i.test(String(liveVerification?.dashboardTitle || '')) &&
      liveVerification?.activeLayoutIsExtension &&
      liveVerification?.hasInlineExtensionTile &&
      liveVerification?.loadedBundleOk
    ),
    browserRenderedNonBlank: Boolean(
      !/\bDataApp\s*\.\s*styles\b/.test(codeSource) &&
      br?.renderedNonBlank &&
      (br?.uncaughtExceptions?.length || 0) === 0 &&
      (br?.height || 0) >= 300 &&
      (br?.textLength || 0) >= 200 &&
      (br?.clickedViews?.length || 0) >= 4
    ),
    promptViewsAndExploresCovered: Boolean(
      /thelook/i.test(codeSource) &&
      /order_items/i.test(codeSource) &&
      ['pulse', 'network', 'forecast', 'voice', 'tree'].every((v) => new RegExp(`\\b${v}\\b`, 'i').test(codeSource))
    ),
  }
  const passedCount = Object.values(checks).filter(Boolean).length
  const totalCount = Object.keys(checks).length
  return { passed: passedCount === totalCount, score: `${passedCount}/${totalCount}`, linkedDashboardId, checks }
}

function parseCliArgs(argv) {
  const opts = { account: 'dev-argolis', model: DEFAULT_ANTIGRAVITY_MODEL, thinking: 'medium', useCase: 'auto', explores: [], keep: false, outDir: path.join(rootDir, 'tmp/eval'), prompt: STICKER_BOOK_PROMPT }
  for (const arg of argv) {
    if (arg === '--keep') opts.keep = true
    else if (arg.startsWith('--oauth-account=')) opts.account = arg.split('=')[1].trim() || opts.account
    else if (arg.startsWith('--model=')) opts.model = arg.split('=')[1].trim() || opts.model
    else if (arg.startsWith('--thinking=')) opts.thinking = arg.split('=')[1].trim() || opts.thinking
    else if (arg.startsWith('--use-case=')) opts.useCase = arg.split('=')[1].trim() || opts.useCase
    else if (arg.startsWith('--explores=')) opts.explores = arg.slice('--explores='.length).split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg.startsWith('--out=')) opts.outDir = path.resolve(arg.slice('--out='.length).trim())
    else if (arg.startsWith('--prompt=')) opts.prompt = arg.slice('--prompt='.length)
  }
  return opts
}

export async function runSingleTurnDataAppEval(cliOpts = {}) {
  const opts = { ...parseCliArgs([]), ...cliOpts }
  const apiKey = getApiKey()
  const sdk = createDataAppEvalSdk(opts.account)
  const startedAt = Date.now()
  const convId = `conv_eval_${startedAt}`
  const allowedModes = ['app', 'data-investigator', 'dashboard', 'lookml', 'health-check', 'tile', 'conversational-analytics']

  console.log(`\n=== Single-Turn Live Data App Eval ===`)
  console.log(`Instance: ${sdk.baseUrl()} (${opts.account}) | Model: ${opts.model} (thinking=${opts.thinking}) | useCase=${opts.useCase}`)

  const meta = await fetchInitialLookerMetadata(sdk)
  const userId = String(meta.user?.id || '1')
  const folderId = String(meta.defaultFolderId || '1')
  const schemaMarkdown = opts.explores.length
    ? (await Promise.all(opts.explores.map((id) => { const p = parseExploreId(id); return p ? buildDenseExploreSchema(sdk, p.modelName, p.exploreName) : '' }))).filter(Boolean).join('\n\n---\n\n')
    : buildAvailableExploresCatalog(meta.models)

  let publishedDashId = ''
  const itemState = { items: [], activeKey: '' }
  try {
    const turnStart = Date.now()
    const result = await runAntigravityTurn({
      sdk,
      userId,
      conversationId: convId,
      auth: { mode: 'apikey', apiKey },
      session: { environmentId: '', conversationId: convId, explores: opts.explores, toolType: 'app' },
      model: opts.model,
      thinkingLevel: opts.thinking,
      mode: 'data_app',
      useCase: opts.useCase,
      allowedModes,
      selectedExplores: opts.explores,
      folderId,
      toolMode: 'data_app',
      schemaMarkdown,
      userPrompt: opts.prompt,
      priorMessages: [],
      requirePermission: false,
      onStatus: (s) => process.stdout.write(`  [status] ${s}\n`),
    })
    const turnDurationMs = Date.now() - turnStart

    const resolvedUseCase =
      opts.useCase !== 'auto'
        ? opts.useCase
        : result.resolvedUseCase || extractResolvedUseCase(result.assistantText, opts.prompt, allowedModes)

    const pubStart = Date.now()
    const mat = await materializeTurnBundles({
      sdk,
      userId,
      result,
      userPrompt: opts.prompt,
      resolvedUseCase,
      allowedModes,
      folderId,
      turnExplores: opts.explores,
      itemState,
      requirePermission: false,
      onStatus: (s) => process.stdout.write(`  [publish] ${s}\n`),
    })
    const publishDurationMs = Date.now() - pubStart
    publishedDashId = String(mat.publishedApp?.dashboardId || '')

    const baseAssistantText = result.assistantText || ''
    const link = mat.publishedDataAppDashboardLink
    const finalAssistantText =
      link && !baseAssistantText.includes(link.path)
        ? `${baseAssistantText.trimEnd()}\n\n**Looker Dashboard:** [Open ${link.title}](${link.path})`
        : baseAssistantText

    if (mat.publishedApp) {
      await saveDashboardStudioMetadata(sdk, mat.publishedApp, {
        ...mat.studioMeta,
        messages: [
          { role: 'user', text: opts.prompt },
          { role: 'assistant', text: finalAssistantText, interactionId: result.session.lastInteractionId, dashboardId: publishedDashId },
        ],
      })
    }

    fs.mkdirSync(opts.outDir, { recursive: true })
    const screenshotPath = path.join(opts.outDir, 'eval-data-app.png')

    const liveVerification = {
      dashboardExists: false,
      dashboardTitle: '',
      dashboardUrl: publishedDashId ? `${sdk.baseUrl()}/dashboards/${encodeURIComponent(publishedDashId)}` : '',
      embedUrl: publishedDashId ? `${sdk.baseUrl()}/embed/dashboards/${encodeURIComponent(publishedDashId)}` : '',
      activeLayoutIsExtension: false,
      hasInlineExtensionTile: false,
      loadedBundleOk: false,
      loadedCodeBytes: 0,
      loadedCode: '',
      browserRender: null,
      error: null,
    }

    if (publishedDashId && mat.publishedApp?.extensionId) {
      try {
        const liveDash = await sdk.ok(sdk.dashboard(publishedDashId))
        liveVerification.dashboardTitle = String(liveDash?.title || '')
        const layouts = liveDash?.dashboard_layouts || []
        const activeLayout = layouts.find((l) => l.active) || layouts[0]
        const expectedExtId = `db::${mat.publishedApp.extensionId}`
        const extEl = (liveDash?.dashboard_elements || []).find(
          (e) => e.type === 'extension' && String(e.extension_id || '') === expectedExtId
        )
        liveVerification.dashboardExists = String(liveDash?.id || '') === publishedDashId
        liveVerification.activeLayoutIsExtension = activeLayout?.type === 'extension'
        liveVerification.hasInlineExtensionTile = Boolean(extEl)

        const loadedApp = await loadExistingDashboardApp(sdk, publishedDashId)
        liveVerification.loadedCode = String(loadedApp.code || '')
        liveVerification.loadedCodeBytes = Buffer.byteLength(liveVerification.loadedCode, 'utf8')
        liveVerification.loadedBundleOk =
          loadedApp.extensionId === mat.publishedApp.extensionId &&
          liveVerification.loadedCode.includes('https://www.gstatic.com/looker-data-apps/versions/') &&
          /customElements\.define\s*\(/.test(liveVerification.loadedCode)

        if (liveVerification.loadedCode) {
          process.stdout.write(
            `  [browser] Opening live Looker /embed/dashboards/${publishedDashId} via create_embed_url_as_me in Headless Chrome...\n`
          )
          liveVerification.browserRender = await verifyDataAppInHeadlessBrowser({
            account: opts.account,
            sdk,
            dashboardId: publishedDashId,
            loadedCode: liveVerification.loadedCode,
            screenshotPath,
          })
        }
      } catch (verifyErr) {
        liveVerification.error = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      }
    }

    const grade = gradeDataAppTurnOutput({
      resolvedUseCase,
      bundle: result.bundle,
      baseAssistantText,
      finalAssistantText,
      publishedDashboardId: publishedDashId,
      contentItems: itemState.items,
      liveVerification,
    })

    const summaryPayload = {
      timestamp: new Date().toISOString(),
      conversationId: convId,
      instanceUrl: sdk.baseUrl(),
      oauthAccount: opts.account,
      model: opts.model,
      thinkingLevel: opts.thinking,
      useCaseInput: opts.useCase,
      resolvedUseCase,
      environmentId: result.session.environmentId,
      interactionId: result.session.lastInteractionId,
      turnDurationMs,
      publishDurationMs,
      totalDurationMs: Date.now() - startedAt,
      widgetCount: result.bundle?.widgets?.length || 0,
      effectiveExplores: mat.effectiveExplores,
      publishedDashboardId: publishedDashId,
      dashboardUrl: liveVerification.dashboardUrl,
      embedUrl: liveVerification.embedUrl,
      keptOnInstance: Boolean(opts.keep),
      grade,
      finalAssistantText,
      activityStepsCount: result.activitySteps?.length || 0,
      liveVerification: { ...liveVerification, loadedCode: undefined },
    }
    const jsonPath = path.join(opts.outDir, 'eval-data-app.json')
    fs.writeFileSync(jsonPath, JSON.stringify(summaryPayload, null, 2), 'utf8')

    const debugMd = await fetchConversationSandboxDebugMarkdown({
      auth: { mode: 'apikey', apiKey },
      conversationId: convId,
      label: mat.publishedApp?.title || 'Sticker-Book E-Commerce Command Center',
      useCase: resolvedUseCase,
      model: opts.model,
      thinkingLevel: opts.thinking,
      environmentId: result.session.environmentId,
      lastInteractionId: result.session.lastInteractionId,
      messages: [
        { role: 'user', text: opts.prompt },
        {
          role: 'assistant',
          text: finalAssistantText,
          interactionId: result.session.lastInteractionId,
          activitySteps: result.activitySteps,
          thinkingDurationSec: result.thinkingDurationSec,
        },
      ],
      contentItems: itemState.items,
    })
    const mdPath = path.join(opts.outDir, 'eval-data-app.md')
    fs.writeFileSync(mdPath, debugMd, 'utf8')

    console.log(`\n--- Final Assistant Output ---\n${finalAssistantText}\n------------------------------`)
    console.log(`Dashboard URL: ${liveVerification.dashboardUrl || '(none)'}`)
    console.log(`Turn: ${(turnDurationMs / 1000).toFixed(1)}s | Publish: ${(publishDurationMs / 1000).toFixed(1)}s | Bundle: ${liveVerification.loadedCodeBytes} bytes | Widgets: ${summaryPayload.widgetCount}`)
    if (liveVerification.browserRender) {
      const br = liveVerification.browserRender
      console.log(`Browser Render: tag=<${br.customTag || 'none'}> height=${br.height}px text=${br.textLength} chars kpis=${br.kpiCount} charts=${br.chartCount} grids=${br.gridCount} clickedViews=[${br.clickedViews.join(', ')}] liveQueries=${br.liveQueriesExecuted} exceptions=${br.uncaughtExceptions.length}`)
      if (br.uncaughtExceptions.length > 0) console.log(`Uncaught JS Exceptions:`, br.uncaughtExceptions)
    }
    console.log(`Checks (${grade.score}):`, JSON.stringify(grade.checks, null, 2))
    console.log(`Saved report:     ${jsonPath}\nSaved trace:      ${mdPath}\nSaved screenshot: ${screenshotPath}`)

    return summaryPayload
  } finally {
    if (publishedDashId && !opts.keep) {
      await deleteUserArtifact(sdk, userId, 'app', publishedDashId, ARTIFACT_NAMESPACE).catch(() => {})
      await sdk.delete_dashboard(publishedDashId).catch(() => {})
      console.log(`Cleaned up temporary eval dashboard ${publishedDashId} (pass --keep to preserve).`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSingleTurnDataAppEval(parseCliArgs(process.argv.slice(2)))
    .then((res) => {
      if (!res.grade.passed) process.exit(1)
    })
    .catch((err) => {
      console.error('Data App eval failed:', err)
      process.exit(1)
    })
}
