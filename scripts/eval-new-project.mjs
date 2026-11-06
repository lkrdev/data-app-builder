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
      grade: (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const files = (res.lookmlBundle?.files || []).map((f) => f.path || f)
        const allText = `${text}\n${files.join('\n')}\n${JSON.stringify(res.activitySteps || [])}`.toLowerCase()
        const hasModel = files.some((f) => f.endsWith('.model.lkml')) || /\.model\.lkml/.test(allText)
        const hasBronzeFolder = files.some((f) => f.startsWith('bronze/') || f.includes('/bronze/')) || /\bbronze\//.test(allText)
        const asksToProfileAndMakeMetrics = /profile/.test(text) && /metric|measure|silver|refinement/.test(text)
        return {
          passed: hasModel && hasBronzeFolder && asksToProfileAndMakeMetrics,
          checks: { hasModel, hasBronzeFolder, asksToProfileAndMakeMetrics, files },
        }
      },
    },
    {
      turn: 4,
      name: 'Turn 4: Profile data & create refinements, silver explores with joins, metrics, example query data, ask for dashboard',
      prompt: 'Yes, please profile the data and take a stab at making metrics.',
      grade: (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const files = (res.lookmlBundle?.files || []).map((f) => f.path || f)
        const allText = `${text}\n${files.join('\n')}\n${JSON.stringify(res.activitySteps || [])}`.toLowerCase()
        const hasRefinements = files.some((f) => f.includes('.refinement.lkml')) || /\.refinement\.lkml/.test(allText)
        const hasSilverExplores = files.some((f) => f.includes('silver/')) || /silver\/explores/.test(allText)
        const showsExampleQueryData = /run_inline_query/.test(allText) && /\d/.test(text)
        const asksForDashboard = /dashboard/.test(text) && /\?/.test(text)
        return {
          passed: hasRefinements && hasSilverExplores && showsExampleQueryData && asksForDashboard,
          checks: { hasRefinements, hasSilverExplores, showsExampleQueryData, asksForDashboard, files },
        }
      },
    },
    {
      turn: 5,
      name: 'Turn 5: Create LookML dashboard, copy into selected UI folder via CodeMode, ask for metric selector Data App',
      prompt: 'Yes, create a dashboard with these metrics.',
      grade: (res) => {
        const text = (res.assistantText || '').toLowerCase()
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const createdLookmlDashboard = /\.dashboard\.lookml/.test(stepsText) || /\.dashboard\.lookml/.test(text)
        const copiedToSelectedFolder =
          (/import_lookml_dashboard|sync_lookml_dashboard|create_dashboard|upsert_lookml_dashboard|upsert_udd/.test(stepsText)) &&
          (stepsText.includes(`"${selectedFolderId}"`) || stepsText.includes('target_folder_id') || String(res.nativeBundle?.folder_id || res.nativeBundle?.folderId || '') === String(selectedFolderId))
        const asksForMetricSelectorApp =
          /data app|metric selector/.test(text) && /day|week|month|year/.test(text)
        return {
          passed: createdLookmlDashboard && copiedToSelectedFolder && asksForMetricSelectorApp,
          checks: { createdLookmlDashboard, copiedToSelectedFolder, asksForMetricSelectorApp, nativeBundle: res.nativeBundle || null },
        }
      },
    },
    {
      turn: 6,
      name: 'Turn 6: Build responsive metric selector Data App (90d/53w/60m/10y + measure-matched date dimensions)',
      prompt: 'Yes, build that metric selector data app.',
      grade: (res) => {
        const code = res.bundle?.raw_code || ''
        const hasBundle = Boolean(code.trim())
        const has90Days = /90\s*days|90d/i.test(code)
        const has53Weeks = /53\s*weeks|53w/i.test(code)
        const has60Months = /60\s*months|60m/i.test(code)
        const has10Years = /10\s*years|10y/i.test(code)
        const matchesMeasureDate =
          /return/i.test(code) && /returned_date|returned_week|returned_month|returned_year|returned/i.test(code) &&
          /cancel/i.test(code) && /cancelled|canceled|shipped|delivered/i.test(code)
        return {
          passed: hasBundle && has90Days && has53Weeks && has60Months && has10Years && matchesMeasureDate,
          checks: { hasBundle, has90Days, has53Weeks, has60Months, has10Years, matchesMeasureDate, codeLength: code.length },
        }
      },
    },
  ]

  let session = { explores: [], conversationId: `eval_${shortId}` }
  let environmentId = undefined
  let lookmlProjectId = ''
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

  for (const t of turns) {
    console.log(`\n=== ${t.name} ===`)
    console.log(`> User: ${t.prompt}`)
    if (t.turn >= 2 && !lookmlProjectId) lookmlProjectId = projectName
    const classified = matchExplicitUseCaseRule(t.prompt, allowedModes)
    const turnTargetUseCase = classified || 'auto'
    const toolMode = turnTargetUseCase === 'lookml' || (lookmlProjectId && turnTargetUseCase === 'auto') ? 'lookml' : 'data_app'
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
        activatedLookmlSkills: ['looker-project-onboarding', 'agentic-lookml'],
        developableProjects: lookmlProjectId ? [lookmlProjectId] : [],
        canDeploy: true,
        schemaMarkdown: '',
        userPrompt: t.prompt,
        existingAppCode: currentAppCode,
        existingNativeContent: nativeContent,
        priorMessages,
        requirePermission: false,
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

    priorMessages.push({ role: 'user', text: t.prompt })
    priorMessages.push({ role: 'assistant', text: res.assistantText, interactionId: res.session?.lastInteractionId })

    const evaluation = t.grade(res)
    console.log(`  [assistant (${(durationMs / 1000).toFixed(1)}s)] ${(res.assistantText || '').slice(0, 500).replace(/\n/g, ' ')}`)
    console.log(`  [grade] passed=${evaluation.passed}`, JSON.stringify(evaluation.checks))

    report.turns.push({
      turn: t.turn,
      name: t.name,
      prompt: t.prompt,
      durationMs,
      interactionId: res.session?.lastInteractionId,
      telemetry: res.telemetry,
      resolvedUseCase: res.resolvedUseCase || extractResolvedUseCase(res.assistantText, t.prompt, allowedModes),
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

  const outDir = path.join(rootDir, 'tmp/evals')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'new-project-latest.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\n[eval-new-project] Saved full report to ${outPath}`)
  const passedCount = report.turns.filter((x) => x.passed).length
  console.log(`[eval-new-project] Score: ${passedCount}/${turns.length} turns passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
