#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

// ponytail: transpile TS in-memory via existing @babel/core hook so we run real src/antigravity.ts without a build step
const babel = require('@babel/core')
const Module = require('node:module')
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const src = fs.readFileSync(filename, 'utf8')
    const out = babel.transformSync(src, {
      filename,
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
      ],
    })
    mod._compile(out.code, filename)
  }
}

const { runAntigravityTurn } = require(path.join(rootDir, 'src/antigravity.ts'))
const { matchExplicitUseCaseRule, extractResolvedUseCase } = require(path.join(rootDir, 'src/lookerApi.ts'))

function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim()
  const envFile = '/usr/local/google/home/bryanweber/bwebs/agentic-thelook/.env'
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '')
  }
  throw new Error('Missing GEMINI_API_KEY')
}

function getArgolisAuth() {
  execFileSync('lkr', ['--oauth-account=dev-argolis', '--dev', 'auth', 'whoami'], { stdio: 'ignore' })
  const db = new DatabaseSync(path.join(os.homedir(), '.lkr/auth.db'), { open: true, readOnly: true })
  const row = db.prepare('SELECT base_url, token_type, access_token FROM auth WHERE instance_name = ?').get('dev-argolis')
  db.close()
  return {
    base_url: String(row.base_url).replace(/\/+$/, ''),
    auth_header: `${row.token_type || 'Bearer'} ${row.access_token}`,
    user_id: '1',
    personal_folder_id: '5',
  }
}

function createLiveLookerSdk(initialAuth) {
  let currentAuth = initialAuth
  const rawRequest = async (method, reqPath, queryParams, body) => {
    const doFetch = async () => {
      const cleanPath = reqPath.startsWith('/api/') ? reqPath : `/api/4.0${reqPath.startsWith('/') ? '' : '/'}${reqPath}`
      const url = new URL(`${currentAuth.base_url}${cleanPath}`)
      if (queryParams && typeof queryParams === 'object') {
        for (const [k, v] of Object.entries(queryParams)) {
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
        }
      }
      const headers = { Authorization: currentAuth.auth_header, 'Content-Type': 'application/json' }
      const init = { method: method.toUpperCase(), headers }
      if (body !== undefined && body !== null && init.method !== 'GET' && init.method !== 'HEAD') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body)
      }
      return fetch(url.toString(), init)
    }
    let resp = await doFetch()
    if (resp.status === 401) {
      currentAuth = getArgolisAuth()
      resp = await doFetch()
    }
    const text = await resp.text()
    let parsed = text
    try { parsed = JSON.parse(text) } catch {}
    return {
      ok: resp.ok,
      statusCode: resp.status,
      statusMessage: resp.statusText,
      contentType: resp.headers.get('content-type') || 'application/json',
      body: parsed,
    }
  }
  return {
    ok: async (p) => {
      const r = await p
      if (r && typeof r === 'object' && 'ok' in r && 'value' in r) {
        if (!r.ok) throw new Error(JSON.stringify(r.error || r))
        return r.value
      }
      return r
    },
    authSession: {
      transport: { rawRequest },
    },
    me: async () => (await rawRequest('GET', '/user')).body,
    session: async () => (await rawRequest('GET', '/session')).body,
    update_session: async (body) => (await rawRequest('PATCH', '/session', undefined, body)).body,
    all_lookml_models: async (params) => (await rawRequest('GET', '/lookml_models', params)).body,
    validate_project: async (pid) => (await rawRequest('POST', `/projects/${encodeURIComponent(pid)}/validate`)).body,
    dashboard: async (did) => (await rawRequest('GET', `/dashboards/${encodeURIComponent(did)}`)).body,
    run_inline_query: async (fmt, body) => (await rawRequest('POST', `/queries/run/${fmt}`, undefined, body)).body,
    delete_dashboard: async (did) => (await rawRequest('DELETE', `/dashboards/${encodeURIComponent(did)}`)).body,
    delete_lookml_model: async (mname) => (await rawRequest('DELETE', `/lookml_models/${encodeURIComponent(mname)}`)).body,
  }
}

const persistedLookmlFiles = new Map()
const extractUddId = (nb) =>
  String(nb?.synced_udd_id || nb?.embed_path?.match(/\/dashboards\/([^/?#]+)/)?.[1] || nb?.url?.match(/\/dashboards\/([^/?#]+)/)?.[1] || nb?.id || '')

function validateBundleOfflineWithLkrParse(files) {
  for (const f of files || []) {
    if (f && typeof f === 'object' && f.path && typeof f.content === 'string') {
      persistedLookmlFiles.set(f.path, f.content)
    }
  }
  if (persistedLookmlFiles.size === 0) return { ok: false, error: 'No LookML files in bundle' }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-lookml-'))
  try {
    for (const [relPath, content] of persistedLookmlFiles.entries()) {
      const target = path.join(tmpDir, relPath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf8')
    }
    execFileSync('lkr', ['parse', 'lookml-to-api', '--path', tmpDir, '--validate'], { stdio: 'pipe' })
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: String(err?.stderr?.toString() || err?.message || err).slice(0, 500) }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function main() {
  const apiKey = getApiKey()
  const argolis = getArgolisAuth()
  const sdk = createLiveLookerSdk(argolis)
  const shortId = Math.random().toString(36).slice(2, 6)
  const projectName = `new_project_${shortId}`
  const selectedFolderId = argolis.personal_folder_id || '5'
  const allowedModes = ['app', 'data-investigator', 'dashboard', 'conversational-analytics', 'lookml', 'health-check', 'tile']

  console.log(`[eval-new-project] Starting live 6-turn eval on dev-argolis (${argolis.base_url})`)
  console.log(`[eval-new-project] user_id=${argolis.user_id} selectedFolderId=${selectedFolderId} projectName=${projectName}`)

  const turns = [
    {
      turn: 1,
      name: 'Turn 1: Ask to create a new project',
      prompt: 'create a new project',
      grade: (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const asksConnection = /connection/.test(text)
        const asksProject = /project/.test(text)
        const asksSchemaOrTable = /schema|dataset|table/.test(text)
        return {
          passed: asksConnection && asksProject && asksSchemaOrTable,
          checks: { asksConnection, asksProject, asksSchemaOrTable, resolvedUseCase: res.resolvedUseCase },
        }
      },
    },
    {
      turn: 2,
      name: 'Turn 2: Provide project name & connection, ask what schemas it has access to',
      prompt: `Let's call it ${projectName} on connection default_bigquery_connection. What schemas do you have access to on that connection?`,
      grade: (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const calledConnectionSchemas = /connection_schemas|schemas/.test(stepsText)
        const listsSchemas = /argolis_scratch|cymbal_lakehouse|streaming_analytics|thelook/.test(text)
        return {
          passed: calledConnectionSchemas && listsSchemas,
          checks: { calledConnectionSchemas, listsSchemas },
        }
      },
    },
    {
      turn: 3,
      name: 'Turn 3: Select thelook schema -> create model & bronze folders, ask to profile data & make metrics',
      prompt: 'Use the thelook dataset (argolis_scratch / looker-private-demo.thelook).',
      grade: async (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const files = (res.lookmlBundle?.files || []).map((f) => f.path || f)
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const allText = `${text}\n${files.join('\n')}\n${stepsText}`
        const hasModel = files.some((f) => f.endsWith('.model.lkml')) || /\.model\.lkml/.test(allText)
        const hasBronzeFolder = files.some((f) => f.startsWith('bronze/') || f.includes('/bronze/')) || /\bbronze\//.test(allText)
        const calledConnectionTables = /connection_tables/.test(stepsText)
        const calledGenerateLookml = /generate_lookml_with_new_files/.test(stepsText)
        const offlineParse = validateBundleOfflineWithLkrParse(res.lookmlBundle?.files || [])
        const asksToProfileAndMakeMetrics = /profile/.test(text) && /metric|measure|silver|refinement/.test(text)
        return {
          passed: hasModel && hasBronzeFolder && calledConnectionTables && calledGenerateLookml && offlineParse.ok && asksToProfileAndMakeMetrics,
          checks: { hasModel, hasBronzeFolder, calledConnectionTables, calledGenerateLookml, offlineParseOk: offlineParse.ok, offlineParseError: offlineParse.error, asksToProfileAndMakeMetrics, files },
        }
      },
    },
    {
      turn: 4,
      name: 'Turn 4: Profile data & create refinements, silver explores with joins, metrics, example query data, ask for dashboard',
      prompt: 'Yes, please profile the data and take a stab at making metrics.',
      grade: async (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const files = (res.lookmlBundle?.files || []).map((f) => f.path || f)
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const allText = `${text}\n${files.join('\n')}\n${stepsText}`
        const hasRefinements = files.some((f) => f.includes('.refinement.lkml')) || /\.refinement\.lkml/.test(allText)
        const hasSilverExplores = files.some((f) => f.includes('silver/')) || /silver\/explores/.test(allText)
        const calledProfileFields = /profile_fields/.test(stepsText)
        const showsExampleQueryData = /run_inline_query/.test(allText) && /\d/.test(text)
        const offlineParse = validateBundleOfflineWithLkrParse(res.lookmlBundle?.files || [])
        const activeProj = res.lookmlBundle?.project_id || lookmlProjectId || projectName
        let liveProjectValid = false
        let liveProjectFatalErrors = []
        try {
          const valRes = await sdk.validate_project(activeProj)
          liveProjectFatalErrors = (valRes?.errors || []).filter((e) => e.severity === 'fatal' && (!e.explore || e.explore === 'order_items'))
          liveProjectValid = Array.isArray(valRes?.errors) && liveProjectFatalErrors.length === 0
        } catch (err) {
          liveProjectFatalErrors = [String(err?.message || err)]
        }
        const asksForDashboard = /dashboard/.test(text) && /\?/.test(text)
        return {
          passed: hasRefinements && hasSilverExplores && calledProfileFields && showsExampleQueryData && offlineParse.ok && liveProjectValid && asksForDashboard,
          checks: { hasRefinements, hasSilverExplores, calledProfileFields, showsExampleQueryData, offlineParseOk: offlineParse.ok, offlineParseError: offlineParse.error, liveProjectValid, liveProjectFatalErrors, asksForDashboard, files },
        }
      },
    },
    {
      turn: 5,
      name: 'Turn 5: Create LookML dashboard, copy into selected UI folder via CodeMode, ask for metric selector Data App',
      prompt: 'Yes, create a dashboard with these metrics.',
      grade: async (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const createdLookmlDashboard = /\.dashboard\.lookml/.test(stepsText) || /\.dashboard\.lookml/.test(text)
        const copiedToSelectedFolder =
          (/import_lookml_dashboard|sync_lookml_dashboard|create_dashboard|upsert_lookml_dashboard|upsert_udd/.test(stepsText)) &&
          (stepsText.includes(`"${selectedFolderId}"`) || stepsText.includes('target_folder_id') || String(res.nativeBundle?.folder_id || res.nativeBundle?.folderId || '') === String(selectedFolderId))
        let liveDashExists = false
        let liveDashFolderMatches = false
        let liveDashTileCount = 0
        const rawDashId = extractUddId(res.nativeBundle)
        if (rawDashId) {
          try {
            const liveDash = await sdk.dashboard(rawDashId)
            liveDashExists = Boolean(liveDash && String(liveDash.id) === rawDashId)
            liveDashFolderMatches = String(liveDash?.folder?.id || liveDash?.space?.id || '') === String(selectedFolderId)
            liveDashTileCount = (liveDash?.dashboard_elements || []).length
          } catch {}
        }
        const asksForMetricSelectorApp =
          /data app|metric selector/.test(text) && /day|week|month|year/.test(text)
        return {
          passed: createdLookmlDashboard && copiedToSelectedFolder && liveDashExists && liveDashFolderMatches && liveDashTileCount >= 4 && asksForMetricSelectorApp,
          checks: { createdLookmlDashboard, copiedToSelectedFolder, liveDashExists, liveDashFolderMatches, liveDashTileCount, asksForMetricSelectorApp, nativeBundle: res.nativeBundle || null },
        }
      },
    },
    {
      turn: 6,
      name: 'Turn 6: Build responsive metric selector Data App (PoP KPIs, Compare against, 3-dot chart menu, Period/Window split & PoP variance grid)',
      prompt: 'Yes, build that metric selector data app.',
      grade: async (res) => {
        const code = res.bundle?.raw_code || ''
        const hasBundle = Boolean(code.trim())
        const has90Days = /90\s*days|90d|\bday\s*:\s*['"]?90\b/i.test(code)
        const has53Weeks = /53\s*weeks|53w|\bweek\s*:\s*['"]?53\b/i.test(code)
        const has60Months = /60\s*months|60m|\bmonth\s*:\s*['"]?60\b/i.test(code)
        const has10Years = /10\s*years|10y|\byear\s*:\s*['"]?10\b/i.test(code)
        const matchesMeasureDate =
          /return/i.test(code) && /returned_date|returned_week|returned_month|returned_year|returned/i.test(code) &&
          /cancel/i.test(code) && /cancelled|canceled|shipped|delivered/i.test(code)
        // 1 & 2. Border-only clickable PoP KPI cards (no "ACTIVE METRIC" badge or Metric <app-select>), 2 * periodCount, inline vs. prev, polarity, sparkline
        const noMetricDropdownOrActiveBadge = !/active\s+metric/i.test(code) && !/<app-select[^>]*\blabel\s*=\s*["'](?:Primary\s+)?Metric["']/i.test(code)
        const hasPopClickableKpis = noMetricDropdownOrActiveBadge && /border-color[\s\S]{0,160}--app-primary|--app-primary[\s\S]{0,160}border-color/i.test(code) && /2\s*\*/.test(code) && /vs\.?\s*prev/i.test(code) && /lower-better/i.test(code) && /<svg\b|sparkline/i.test(code)
        // 3 & 4. Dual-metric "Compare against" + dual yAxis (opposite: true), no "Longitudinal Trend", yAxis.title.text, and top-right 3-dot (⋮) Chart Type menu
        const hasCompareAgainstDualAxis = /compare\s*against/i.test(code) && /opposite\s*:\s*true/.test(code)
        const hasTrendMenuAndYAxis = !/longitudinal\s+trend/i.test(code) && !/<app-select[^>]*\blabel\s*=\s*["']Chart\s*Type["']/i.test(code) && /yAxis[\s\S]{0,500}title\s*:\s*\{\s*text\s*:/.test(code) && /⋮|\\u22ee|&#8942;|&vellip;|chartMenuOpen|more-vertical/i.test(code) && ['areaspline', 'line', 'column', 'bar'].every((t) => new RegExp(`\\b${t}\\b`, 'i').test(code))
        // 5 & 6. Decoupled Period & Window (periodCount) + universal getEffectiveFilters, Multi-Select Dimensions, and titleless PoP Variance <app-grid>
        const hasDecoupledPeriodAndWindow = /label\s*=\s*["']Period["']/i.test(code) && /label\s*=\s*["']Window["']/i.test(code) && /periodCount/.test(code) && /getEffectiveFilters/.test(code) && has90Days && has53Weeks && has60Months && has10Years
        const hasMultiSelectDimensions = /Dimensions/i.test(code) && /selectedDimensions/.test(code)
        const hasTitlelessPopVarianceGrid = /<app-grid(?![^>]*\btitle\s*=)/i.test(code) && /\.data\s*=\s*\$\{/.test(code) && /ago\s+for/i.test(code) && /This\s+Period/i.test(code) && /Last\s+Period/i.test(code) && /Variance/i.test(code)
        const activeModel = lookmlProjectId || projectName
        const pairs = [
          ['order_items.created_date', 'order_items.total_sale_price'],
          ['order_items.returned_date', 'order_items.return_count'],
          ['order_items.cancelled_date', 'order_items.cancel_count'],
        ]
        const liveQueryChecks = {}
        let liveQueriesAllValid = true
        await Promise.all(
          pairs.map(async ([dim, meas]) => {
            try {
              const rows = await sdk.run_inline_query('json', {
                model: activeModel,
                view: 'order_items',
                fields: [dim, meas],
                filters: { [dim]: '10 years' },
                limit: '5',
              })
              const ok = Array.isArray(rows) && rows.length > 0 && !rows[0]?.looker_error
              liveQueryChecks[`${dim}+${meas}`] = ok ? rows.length : rows
              if (!ok) liveQueriesAllValid = false
            } catch (err) {
              liveQueryChecks[`${dim}+${meas}`] = String(err?.message || err)
              liveQueriesAllValid = false
            }
          })
        )
        return {
          passed: hasBundle && matchesMeasureDate && hasPopClickableKpis && hasCompareAgainstDualAxis && hasTrendMenuAndYAxis && hasDecoupledPeriodAndWindow && hasMultiSelectDimensions && hasTitlelessPopVarianceGrid && liveQueriesAllValid,
          checks: { hasBundle, has90Days, has53Weeks, has60Months, has10Years, matchesMeasureDate, noMetricDropdownOrActiveBadge, hasPopClickableKpis, hasCompareAgainstDualAxis, hasTrendMenuAndYAxis, hasDecoupledPeriodAndWindow, hasMultiSelectDimensions, hasTitlelessPopVarianceGrid, liveQueriesAllValid, liveQueryChecks, codeLength: code.length },
        }
      },
    },
  ]

  let session = { explores: [], conversationId: `eval_${shortId}` }
  let environmentId = undefined
  let lookmlProjectId = ''
  let lastResolvedUseCase = 'auto'
  let currentAppCode = undefined
  let nativeContent = null
  const priorMessages = []
  const report = {
    startedAt: new Date().toISOString(),
    projectName,
    selectedFolderId,
    baseUrl: argolis.base_url,
    turns: [],
  }

  try {
    for (const t of turns) {
      console.log(`\n=== ${t.name} ===`)
      console.log(`> User: ${t.prompt}`)
      const classified = matchExplicitUseCaseRule(t.prompt, allowedModes)
      const turnTargetUseCase = classified || 'auto'
      const toolMode = turnTargetUseCase === 'lookml' || (turnTargetUseCase === 'auto' && lastResolvedUseCase === 'lookml') ? 'lookml' : 'data_app'
      const mode = turnTargetUseCase === 'dashboard' ? 'dashboard' : 'data_app'
      const t0 = Date.now()
      let res
      try {
        res = await runAntigravityTurn({
          sdk,
          userId: argolis.user_id,
          environmentId,
          conversationId: session.conversationId,
          onEnvironmentUpdated: (envId) => { environmentId = envId },
          auth: { mode: 'apikey', apiKey },
          session,
          thinkingLevel: 'low',
          mode,
          useCase: 'auto',
          allowedModes,
          selectedExplores: session.explores || [],
          folderId: selectedFolderId,
          toolMode,
          lookmlProjectId,
          activatedLookmlSkills: [],
          developableProjects: lookmlProjectId ? [lookmlProjectId] : [],
          canDeploy: true,
          schemaMarkdown: '',
          userPrompt: t.prompt,
          existingAppCode: currentAppCode,
          existingNativeContent: nativeContent,
          priorMessages,
          requirePermission: false,
          pollScheduleMs: [250, 450, 700, 1000],
          onStatus: (s) => process.stdout.write(`  [status] ${s}\n`),
        })
      } catch (err) {
        console.error(`  [error] Turn ${t.turn} threw:`, err)
        report.turns.push({
          turn: t.turn,
          name: t.name,
          prompt: t.prompt,
          durationMs: Date.now() - t0,
          error: String(err?.stack || err),
          passed: false,
        })
        break
      }

      const durationMs = Date.now() - t0
      session = { ...res.session, conversationId: session.conversationId }
      if (res.session?.environmentId) environmentId = res.session.environmentId
      if (res.lookmlBundle?.project_id) lookmlProjectId = res.lookmlBundle.project_id
      if (res.bundle?.raw_code) currentAppCode = res.bundle.raw_code
      if (res.nativeBundle) nativeContent = res.nativeBundle
      lastResolvedUseCase = res.resolvedUseCase || extractResolvedUseCase(res.assistantText, t.prompt, allowedModes)

      priorMessages.push({ role: 'user', text: t.prompt })
      priorMessages.push({ role: 'assistant', text: res.assistantText, interactionId: res.session?.lastInteractionId })

      const evaluation = await t.grade(res)
      console.log(`  [assistant (${(durationMs / 1000).toFixed(1)}s)] ${(res.assistantText || '').slice(0, 500).replace(/\n/g, ' ')}`)
      console.log(`  [grade] passed=${evaluation.passed}`, JSON.stringify(evaluation.checks))

      report.turns.push({
        turn: t.turn,
        name: t.name,
        prompt: t.prompt,
        durationMs,
        interactionId: res.session?.lastInteractionId,
        telemetry: res.telemetry,
        resolvedUseCase: lastResolvedUseCase,
        assistantText: res.assistantText,
        activitySteps: res.activitySteps,
        hasLookmlBundle: Boolean(res.lookmlBundle),
        lookmlProjectId: res.lookmlBundle?.project_id || lookmlProjectId,
        lookmlFiles: (res.lookmlBundle?.files || []).map((f) => f.path || f),
        hasNativeBundle: Boolean(res.nativeBundle),
        nativeBundle: res.nativeBundle || null,
        hasDataAppBundle: Boolean(res.bundle),
        dataAppCodeLength: res.bundle?.raw_code?.length || 0,
        passed: evaluation.passed,
        checks: evaluation.checks,
      })
    }
  } finally {
    if (!process.argv.includes('--keep')) {
      const dashId = extractUddId(nativeContent)
      if (dashId && !dashId.includes('::')) {
        try {
          await sdk.delete_dashboard(dashId)
          console.log(`[eval-new-project] Cleaned up UDD dashboard ${dashId}`)
        } catch {}
      }
      const modelToClean = lookmlProjectId || projectName
      if (modelToClean) {
        try {
          await sdk.delete_lookml_model(modelToClean)
          console.log(`[eval-new-project] Cleaned up LookML model ${modelToClean}`)
        } catch {}
      }
    }
  }

  const outIdx = process.argv.indexOf('--out')
  const outPath =
    outIdx >= 0 && process.argv[outIdx + 1]
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(rootDir, 'tmp/evals/new-project-latest.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\n[eval-new-project] Saved full report to ${outPath}`)
  const passedCount = report.turns.filter((x) => x.passed).length
  console.log(`[eval-new-project] Score: ${passedCount}/${turns.length} turns passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
