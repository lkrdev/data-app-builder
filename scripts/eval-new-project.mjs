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

const { DEFAULT_THINKING_LEVEL, fetchConversationSandboxDebugMarkdown, runAntigravityTurn } = require(path.join(rootDir, 'src/antigravity.ts'))
const { discoverAccessibleConnections, extractResolvedUseCase, matchExplicitUseCaseRule } = require(path.join(rootDir, 'src/lookerApi.ts'))

export function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim()
  const envFile = process.env.AGENTIC_THELOOK_ENV || path.join(os.homedir(), 'bwebs/agentic-thelook/.env')
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '')
  }
  throw new Error('Missing GEMINI_API_KEY')
}

export function getArgolisAuth() {
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

export function createLiveLookerSdk(initialAuth) {
  let currentAuth = initialAuth
  let activeWorkspaceId = ''
  const rawRequest = async (method, reqPath, queryParams, body) => {
    const cleanPath = reqPath.startsWith('/api/') ? reqPath : `/api/4.0${reqPath.startsWith('/') ? '' : '/'}${reqPath}`
    if (method.toUpperCase() === 'PATCH' && /\/session$/.test(cleanPath) && body) {
      try {
        const b = typeof body === 'string' ? JSON.parse(body) : body
        if (b?.workspace_id) activeWorkspaceId = String(b.workspace_id)
      } catch {}
    }
    const doFetch = async () => {
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
      if (activeWorkspaceId) {
        await fetch(`${currentAuth.base_url}/api/4.0/session`, {
          method: 'PATCH',
          headers: { Authorization: currentAuth.auth_header, 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: activeWorkspaceId }),
        }).catch(() => {})
      }
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
    all_project_files: async (pid) => (await rawRequest('GET', `/projects/${encodeURIComponent(pid)}/files`)).body,
    get_file_content: async (pid, fpath) =>
      (await rawRequest('GET', `/projects/${encodeURIComponent(pid)}/file/content`, { file_id: fpath })).body,
    validate_project: async (pid) => (await rawRequest('POST', `/projects/${encodeURIComponent(pid)}/validate`)).body,
    dashboard: async (did) => (await rawRequest('GET', `/dashboards/${encodeURIComponent(did)}`)).body,
    run_inline_query: async (fmt, body) => (await rawRequest('POST', `/queries/run/${fmt}`, undefined, body)).body,
    delete_dashboard: async (did) => (await rawRequest('DELETE', `/dashboards/${encodeURIComponent(did)}`)).body,
    delete_lookml_model: async (mname) => (await rawRequest('DELETE', `/lookml_models/${encodeURIComponent(mname)}`)).body,
    delete_project: async (pid) => (await rawRequest('DELETE', `/projects/${encodeURIComponent(pid)}`)).body,
  }
}

export const persistedLookmlFiles = new Map()
export const extractUddId = (nb) =>
  String(nb?.synced_udd_id || nb?.embed_path?.match(/\/dashboards\/([^/?#]+)/)?.[1] || nb?.url?.match(/\/dashboards\/([^/?#]+)/)?.[1] || nb?.id || '')

export function validateBundleOfflineWithLkrParse(files) {
  for (const f of files || []) {
    if (f && typeof f === 'object' && f.path && typeof f.content === 'string') {
      persistedLookmlFiles.set(f.path, f.content)
    }
  }
  if (persistedLookmlFiles.size === 0) return { ok: false, error: 'No LookML files in bundle' }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-lookml-'))
  try {
    for (const [relPath, content] of persistedLookmlFiles.entries()) {
      if (!relPath.endsWith('.lkml') && !relPath.endsWith('.lookml')) continue
      const target = path.join(tmpDir, relPath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf8')
    }
    execFileSync('lkr', ['parse', 'lookml-to-api', '--path', tmpDir, '-o', path.join(tmpDir, 'api.json'), '--validate'], {
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    })
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
  const prediscoveredConns = await discoverAccessibleConnections(sdk)

  console.log(`[eval-new-project] Starting live 6-turn eval on dev-argolis (${argolis.base_url})`)
  console.log(`[eval-new-project] user_id=${argolis.user_id} selectedFolderId=${selectedFolderId} projectName=${projectName}`)

  const turns = [
    {
      turn: 1,
      name: 'Turn 1: Ask to create a new project',
      prompt: 'create a new project',
      grade: (res, { durationMs } = {}) => {
        const text = (res.assistantText || '').toLowerCase()
        const asksConnection = /connection/.test(text)
        const listsConnections =
          prediscoveredConns.length > 0
            ? prediscoveredConns.some((c) => text.includes(String(c.name || '').toLowerCase()))
            : /default_bigquery_connection|bigquery/i.test(text)
        const asksProject = /project/.test(text)
        const asksSchemaOrTable = /schema|dataset|table/.test(text)
        const underLatencyBudget = typeof durationMs === 'number' && durationMs < 15000
        return {
          passed: asksConnection && listsConnections && asksProject && asksSchemaOrTable && underLatencyBudget,
          checks: {
            durationMs,
            underLatencyBudget,
            listsConnections,
            asksConnection,
            asksProject,
            asksSchemaOrTable,
            resolvedUseCase: res.resolvedUseCase,
          },
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
        const hasProjectLink = /\/projects\/[^/\s)]+/i.test(res.assistantText || '')
        return {
          passed: hasModel && hasBronzeFolder && calledConnectionTables && calledGenerateLookml && offlineParse.ok && asksToProfileAndMakeMetrics && hasProjectLink,
          checks: { hasModel, hasBronzeFolder, calledConnectionTables, calledGenerateLookml, offlineParseOk: offlineParse.ok, offlineParseError: offlineParse.error, asksToProfileAndMakeMetrics, hasProjectLink, files },
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
        const rawFiles = res.lookmlBundle?.files || []
        const bronzeRefinementsSingleTable = rawFiles
          .filter((f) => typeof f?.path === 'string' && f.path.includes('bronze/') && f.path.endsWith('.refinement.lkml'))
          .every((f) => {
            const viewMatch = String(f.content || '').match(/view\s*:\s*\+?([a-z0-9_]+)/i)
            const vname = viewMatch?.[1] || ''
            const dottedRefs = Array.from(String(f.content || '').matchAll(/\$\{\s*([a-z0-9_]+)\.[a-z0-9_]+\s*\}/gi)).map((m) => m[1])
            return dottedRefs.every((ref) => ref.toUpperCase() === 'TABLE' || ref === vname)
          })
        const noBaseFieldExclusions = rawFiles
          .filter((f) => typeof f?.path === 'string' && f.path.endsWith('_base.explore.lkml'))
          .every((f) => !/\bfields\s*:\s*\[[^\]]*-[a-z0-9_.]+/i.test(String(f.content || '')))
        const offlineParse = validateBundleOfflineWithLkrParse(rawFiles)
        const activeProj = res.lookmlBundle?.project_id || lookmlProjectId || projectName
        let liveProjectValid = false
        let liveProjectDiagnostics = []
        try {
          const valRes = await sdk.validate_project(activeProj)
          liveProjectDiagnostics = (valRes?.errors || []).filter(
            (e) => (e.severity === 'fatal' || e.severity === 'warning') && (!e.explore || e.explore === 'order_items' || e.explore === 'order_items_base')
          )
          liveProjectValid = Array.isArray(valRes?.errors) && liveProjectDiagnostics.length === 0
        } catch (err) {
          liveProjectDiagnostics = [String(err?.message || err)]
        }
        const asksForDashboard = /dashboard/.test(text) && /\?/.test(text)
        const hasProjectLink = /\/projects\/[^/\s)]+/i.test(res.assistantText || '')
        return {
          passed: hasRefinements && hasSilverExplores && bronzeRefinementsSingleTable && noBaseFieldExclusions && calledProfileFields && showsExampleQueryData && offlineParse.ok && liveProjectValid && asksForDashboard && hasProjectLink,
          checks: { hasRefinements, hasSilverExplores, bronzeRefinementsSingleTable, noBaseFieldExclusions, calledProfileFields, showsExampleQueryData, offlineParseOk: offlineParse.ok, offlineParseError: offlineParse.error, liveProjectValid, liveProjectDiagnostics, asksForDashboard, hasProjectLink, files },
        }
      },
    },
    {
      turn: 5,
      name: 'Turn 5: Create LookML dashboard, copy into selected UI folder via CodeMode, ask for metric selector Data App',
      prompt: 'Yes, create a dashboard with these metrics.',
      grade: async (res) => {
        const rawText = res.assistantText || ''
        const text = rawText.toLowerCase()
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const createdLookmlDashboard = /\.dashboard\.lookml/.test(stepsText) || /\.dashboard\.lookml/.test(text)
        const copiedToSelectedFolder =
          (/import_lookml_dashboard|sync_lookml_dashboard|create_dashboard|upsert_lookml_dashboard|upsert_udd/.test(stepsText)) &&
          (stepsText.includes(`"${selectedFolderId}"`) || stepsText.includes('target_folder_id') || String(res.nativeBundle?.folder_id || res.nativeBundle?.folderId || '') === String(selectedFolderId))
        const activeProj = lookmlProjectId || projectName
        let lookmlDashValidationClean = false
        let lookmlDashValidationErrors = []
        try {
          const valRes = await sdk.validate_project(activeProj)
          lookmlDashValidationErrors = (valRes?.errors || []).filter((e) => {
            const sev = String(e?.severity || '').toLowerCase()
            const hay = `${e?.file_path || ''} ${e?.message || ''} ${e?.details || ''}`
            return (sev === 'fatal' || sev === 'warning') && (/\.dashboard\.lookml/i.test(hay) || /unknown field/i.test(hay))
          })
          lookmlDashValidationClean = Array.isArray(valRes?.errors) && lookmlDashValidationErrors.length === 0
        } catch (err) {
          lookmlDashValidationErrors = [String(err?.message || err)]
        }
        let liveDashExists = false
        let liveDashFolderMatches = false
        let liveDashTileCount = 0
        let liveDashTilesAllValid = false
        const liveTileErrors = []
        const rawDashId = extractUddId(res.nativeBundle)
        if (rawDashId) {
          try {
            const liveDash = await sdk.dashboard(rawDashId)
            liveDashExists = Boolean(liveDash && String(liveDash.id) === rawDashId)
            liveDashFolderMatches = String(liveDash?.folder?.id || liveDash?.space?.id || '') === String(selectedFolderId)
            const elements = liveDash?.dashboard_elements || []
            liveDashTileCount = elements.length
            const queryElements = elements.filter((el) => el?.type !== 'text')
            if (queryElements.length >= 4) {
              await Promise.all(
                queryElements.map(async (el) => {
                  const q = el?.query || el?.result_maker?.query
                  const qFields = Array.isArray(q?.fields) ? q.fields : []
                  if (!q?.model || !q?.view || qFields.length === 0) {
                    liveTileErrors.push(`${el?.title || el?.id}: empty fields or missing query`)
                    return
                  }
                  try {
                    const rows = await sdk.run_inline_query('json', {
                      model: q.model,
                      view: q.view,
                      fields: qFields,
                      filters: q.filters || {},
                      sorts: q.sorts || [],
                      ...(Array.isArray(q.pivots) && q.pivots.length > 0 ? { pivots: q.pivots } : {}),
                      limit: '5',
                    })
                    if (!Array.isArray(rows) || rows[0]?.looker_error) {
                      liveTileErrors.push(`${el?.title || el?.id}: ${JSON.stringify(rows).slice(0, 160)}`)
                    }
                  } catch (qErr) {
                    liveTileErrors.push(`${el?.title || el?.id}: ${String(qErr?.message || qErr)}`)
                  }
                })
              )
              liveDashTilesAllValid = liveTileErrors.length === 0
            }
          } catch {}
        }
        const noGridOrVisJargon =
          !/\brow\s+\d+\b|\b(?:width|height|col)\s*:\s*\d+|\b24-column\s+grid\b|\b(?:single_value|looker_area|looker_pie|looker_column|looker_bar|looker_grid)\b/i.test(rawText)
        const asksForMetricSelectorApp =
          /data app|metric selector/.test(text) && /day|date|week|month|year/.test(text)
        const hasDashboardLink = /\/dashboards\/[^\s)]+/i.test(rawText)
        return {
          passed: createdLookmlDashboard && copiedToSelectedFolder && lookmlDashValidationClean && liveDashExists && liveDashFolderMatches && liveDashTileCount >= 4 && liveDashTilesAllValid && noGridOrVisJargon && asksForMetricSelectorApp && hasDashboardLink,
          checks: { createdLookmlDashboard, copiedToSelectedFolder, lookmlDashValidationClean, lookmlDashValidationErrors, liveDashExists, liveDashFolderMatches, liveDashTileCount, liveDashTilesAllValid, liveTileErrors, noGridOrVisJargon, asksForMetricSelectorApp, hasDashboardLink, nativeBundle: res.nativeBundle || null },
        }
      },
    },
    {
      turn: 6,
      name: 'Turn 6: Build responsive metric selector Data App (date timeframe, balanced @container KPI grid, custom 4-row PoP KPIs, card-border compare, custom Window popover & PoP variance grid)',
      prompt: 'Yes, build that metric selector data app.',
      grade: async (res) => {
        const code = res.bundle?.raw_code || ''
        const cleanCode = code.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<!:)\/\/[^\n]*/g, ' ')
        const hasBundle = Boolean(code.trim())
        const has90Days = /90\s*days|90d|\bdate\s*:\s*['"]?90\b/i.test(code)
        const has53Weeks = /53\s*weeks|53w|\bweek\s*:\s*['"]?53\b/i.test(code)
        const has60Months = /60\s*months|60m|\bmonth\s*:\s*['"]?60\b/i.test(code)
        const has10Years = /10\s*years|10y|\byear\s*:\s*['"]?10\b/i.test(code)
        const noInvalidDayField =
          !/(?:\.[a-z0-9_]+(?<!_hour_of)|\$\{[^}]+\})_day(?![a-zA-Z0-9_])/i.test(code) &&
          !(/\bday\s*:/.test(code) && /_\$\{[^}]*period\b/.test(code))
        const matchesMeasureDate =
          /return/i.test(code) && /returned_date|returned_week|returned_month|returned_year|returned/i.test(code) &&
          /cancel/i.test(code) && /cancelled|canceled|shipped|delivered/i.test(code)
        // 1 & 2. Custom 4-row clickable PoP KPI cards (forbid <app-kpi>, "ACTIVE METRIC" badge, and Metric <app-select>), Row-3 kpi-change pill before vs. prev, 2 * periodCount, lower-better, sparkline SVG
        const noMetricDropdownOrActiveBadge =
          !/active\s+metric/i.test(code) &&
          !/<app-select[^>]*\blabel\s*=\s*["'](?:Primary\s+)?Metric["']/i.test(code) &&
          !/<app-kpi\b/i.test(code)
        const hasPopClickableKpis =
          noMetricDropdownOrActiveBadge &&
          /--app-chart-1/.test(code) &&
          /2\s*\*/.test(code) &&
          /<span[^>]*class\s*=\s*["'][^"']*kpi-change[\s\S]{0,240}vs\.?\s*prev/i.test(code) &&
          /lower-better/i.test(code) &&
          /<svg\b/i.test(code)
        // 3 & 4. Secondary KPI card-border comparison (--app-chart-2, shiftKey, contextmenu, no "Compare against" <app-select>), layered dual-date Promise.all + runQuery, and shared-when-close dual yAxis (linkedTo, opposite: true), no "Longitudinal Trend", yAxis.title.text, and top-right 3-dot (⋮) Chart Type menu
        const hasCardBorderCompareDualAxis =
          !/<app-select(?![a-zA-Z0-9_-])(?:(?!<\/app-select\b)[\s\S])*?\bcompare\s+against\b/i.test(cleanCode) &&
          /--app-chart-2/.test(code) &&
          /\bshiftKey\b/.test(code) &&
          /@contextmenu|contextmenu/i.test(code) &&
          /<app-chart(?![a-zA-Z0-9_-])(?:(?!<\/app-chart\b|<app-(?:chart|grid|kpi|select)\b)[\s\S])*?\.data\s*=(?!=)/i.test(cleanCode) &&
          !/<app-chart(?![a-zA-Z0-9_-])(?:(?!<\/app-chart\b|<app-(?:chart|grid|kpi|select)\b)[\s\S])*?(?:\.data\s*=(?!=)(?:(?!<\/app-chart\b|<app-(?:chart|grid|kpi|select)\b)[\s\S])*?\.query\s*=(?!=)|\.query\s*=(?!=)(?:(?!<\/app-chart\b|<app-(?:chart|grid|kpi|select)\b)[\s\S])*?\.data\s*=(?!=))/i.test(cleanCode) &&
          !/<app-chart(?![a-zA-Z0-9_-])(?:(?!<\/app-chart\b|<app-(?:chart|grid|kpi|select)\b)[\s\S])*?\.query\s*=(?!=)(?:(?!<\/app-chart\b|<app-(?:chart|grid|kpi|select)\b)[\s\S])*?\bfields\s*:\s*\[(?:[^[\]]|\[[^\]]*\])*?(?:\bcompareMetric\b|\.\.\.\s*\(|\[[^\]]*\bcompareMetric\b)/i.test(cleanCode) &&
          !/\bdateBase\s*\)*\s*[!=]==?[^;:\n{}&,|]*\bdateBase\b/.test(cleanCode) &&
          !/\bupdated\s*\([^)]*\)\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*(?:\{[^{}]*){0,2}\bloadTrendData\b/.test(cleanCode) &&
          /\bPromise\s*\.\s*all\b/.test(cleanCode) &&
          /\brunQuery\b/.test(cleanCode) &&
          /\blinkedTo\b/.test(cleanCode) &&
          /opposite\s*:\s*true/.test(cleanCode)
        const hasTrendMenuAndYAxis = !/longitudinal\s+trend/i.test(code) && !/<app-select[^>]*\blabel\s*=\s*["']Chart\s*Type["']/i.test(code) && /yAxis[\s\S]{0,500}title\s*:\s*\{\s*text\s*:/.test(code) && /⋮|\\u22ee|&#8942;|&vellip;|chartMenuOpen|more-vertical/i.test(code) && ['areaspline', 'line', 'column', 'bar'].every((t) => new RegExp(`\\b${t}\\b`, 'i').test(code))
        // 5 & 6. Balanced @container KPI grid (4 -> 2x2 -> 1, no auto-fit/auto-fill on KPI strip), decoupled Period & Window + custom Window number popover + dynamic 2*periodCount row limit, Multi-Select Dimensions, and titleless PoP Variance <app-grid>
        const hasBalancedKpiGrid =
          !/[.#][a-z0-9_-]*kpi[a-z0-9_-]*[^{};<>`=]*\{[^}]*repeat\(\s*auto-(?:fit|fill)/i.test(cleanCode) &&
          !/<(?:div|section)(?:[^>]|=>)*?kpi(?:[^>]|=>)*?style\s*=\s*["'][^"']*repeat\(\s*auto-(?:fit|fill)/i.test(cleanCode) &&
          !/<(?:div|section)(?:[^>]|=>)*?style\s*=\s*["'][^"']*repeat\(\s*auto-(?:fit|fill)[^"']*["'](?:[^>]|=>)*?kpi/i.test(cleanCode) &&
          /container-type\s*:\s*inline-size/i.test(cleanCode) &&
          /@container\b[\s\S]*?(?:repeat\(\s*2\b|1fr\s+1fr|\b1fr\s*[;}])/i.test(cleanCode)
        const hasCustomWindowPopover =
          /customWindowOpen|Custom\s+window\s+length/i.test(code) &&
          /<input(?:[^>]|=>)*\btype\s*=\s*["']number["']/i.test(code) &&
          /!\s*(?:\([^)\n]+\)|[a-zA-Z0-9_$.[\]?]+)\.includes\(\s*(?:Number\(\s*)?(?:this\.)?(?:periodCount|n)\b/i.test(code) &&
          /(?:limit\s*:|(?:const|let|var)\s+[a-zA-Z0-9_$]*(?:limit|rows)[a-zA-Z0-9_$]*\s*=)[^\n;{}]*(?:2\s*\*\s*(?:Number\(\s*)?(?:this\.)?(?:periodCount|n|window\w*)\b|(?:this\.)?(?:periodCount|n|window\w*)\b\s*\*\s*2)/i.test(code)
        const hasDecoupledPeriodAndWindow = /(?:(?:aria-)?label\s*=\s*["']Period["']|>\s*Period\s*:?\s*(?:<|\$\{))/i.test(code) && /(?:(?:aria-)?label\s*=\s*["']Window["']|>\s*Window\s*:?\s*(?:<|\$\{))/i.test(code) && /periodCount/.test(code) && /getEffectiveFilters/.test(code) && noInvalidDayField && has90Days && has53Weeks && has60Months && has10Years
        const hasMultiSelectDimensions = /Dimensions/i.test(code) && /selectedDimensions/.test(code)
        const hasTitlelessPopVarianceGrid = /<app-grid(?![^>]*\btitle\s*=)/i.test(code) && /\.data\s*=\s*\$\{/.test(code) && /ago\s+for/i.test(code) && /This\s+Period/i.test(code) && /Last\s+Period/i.test(code) && /Variance/i.test(code)
        const activeModel = lookmlProjectId || projectName
        const pairs = [
          ['order_items.created_date', 'order_items.total_sale_price', 14],
          ['order_items.returned_date', 'order_items.return_count', 1],
          ['order_items.cancelled_date', 'order_items.cancel_count', 1],
        ]
        const liveQueryChecks = {}
        let liveQueriesAllValid = true
        await Promise.all(
          pairs.map(async ([dim, meas, minRows]) => {
            try {
              const rows = await sdk.run_inline_query('json', {
                model: activeModel,
                view: 'order_items',
                fields: [dim, meas],
                filters: { [dim]: '10 years' },
                limit: '500',
              })
              const ok = Array.isArray(rows) && rows.length >= minRows && !rows[0]?.looker_error
              liveQueryChecks[`${dim}+${meas}`] = ok ? rows.length : rows
              if (!ok) liveQueriesAllValid = false
            } catch (err) {
              liveQueryChecks[`${dim}+${meas}`] = String(err?.message || err)
              liveQueriesAllValid = false
            }
          })
        )
        return {
          passed: hasBundle && noInvalidDayField && matchesMeasureDate && hasBalancedKpiGrid && hasPopClickableKpis && hasCardBorderCompareDualAxis && hasTrendMenuAndYAxis && hasDecoupledPeriodAndWindow && hasCustomWindowPopover && hasMultiSelectDimensions && hasTitlelessPopVarianceGrid && liveQueriesAllValid,
          checks: { hasBundle, noInvalidDayField, has90Days, has53Weeks, has60Months, has10Years, matchesMeasureDate, noMetricDropdownOrActiveBadge, hasBalancedKpiGrid, hasPopClickableKpis, hasCardBorderCompareDualAxis, hasTrendMenuAndYAxis, hasDecoupledPeriodAndWindow, hasCustomWindowPopover, hasMultiSelectDimensions, hasTitlelessPopVarianceGrid, liveQueriesAllValid, liveQueryChecks, codeLength: code.length },
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
          thinkingLevel: DEFAULT_THINKING_LEVEL,
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
          warmEnvironmentInBackground: true,
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
        priorMessages.push({ role: 'user', text: t.prompt })
        priorMessages.push({ role: 'error', text: String(err?.stack || err) })
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
      priorMessages.push({
        role: 'assistant',
        text: res.assistantText,
        interactionId: res.session?.lastInteractionId,
        activitySteps: res.activitySteps,
      })

      const evaluation = await t.grade(res, { durationMs })
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
    try {
      const debugMd = await fetchConversationSandboxDebugMarkdown({
        auth: { mode: 'apikey', apiKey },
        conversationId: session.conversationId,
        label: report.projectName,
        useCase: lastResolvedUseCase,
        environmentId,
        lastInteractionId: session.lastInteractionId,
        messages: priorMessages,
      })
      const evalDumpDir = path.join(rootDir, 'tmp/eval')
      fs.mkdirSync(evalDumpDir, { recursive: true })
      fs.writeFileSync(path.join(evalDumpDir, 'eval-new-project.md'), debugMd, 'utf8')
      fs.writeFileSync(path.join(evalDumpDir, 'eval-new-project.json'), JSON.stringify(report, null, 2), 'utf8')
      console.log(`[eval-new-project] Saved sandbox debug dump to ${path.join(evalDumpDir, 'eval-new-project.md')}`)
    } catch (dumpErr) {
      console.warn('[eval-new-project] Debug dump warning:', dumpErr?.message || dumpErr)
    }
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
  if (passedCount < turns.length) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
