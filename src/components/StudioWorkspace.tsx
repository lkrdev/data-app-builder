import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getEmbedSDK, ILookerConnection, LookerEmbedExSDK } from '@looker/embed-sdk'
import {
  AntigravityActivityStep,
  handleImageClipboardPaste,
  StudioUseCase,
} from '../antigravity'
import {
  ConversationRecord,
  resolveConversationRelatedContent,
} from '../lookerApi'
import { LOOKML_TURN_SKILLS, LookmlPreviewPane } from '../lookmlTool'
import { renderTddMarkdownToHtml } from '../healthCheck'
import { StudioController } from '../useStudioController'
import { TilePreviewPane } from './ScriptStudioView'

export interface LookerEmbedTarget {
  kind: 'preload' | 'dashboard' | 'look' | 'url'
  target: string
  previewMode: 'preload' | 'conversational-analytics' | 'dashboard' | 'data_app'
  previewObjectId: string
  nonce: number
}

export interface LookerEmbedSessionTelemetry {
  hostUrl: string
  state: 'preloaded' | 'dashboard' | 'look' | 'url'
  target: string
  running: boolean
  runCount: number
  loadCount: number
  lastPageUrl: string
  events: string[]
  calls: Array<{ method: string; arg: string }>
}

export function normalizeLookerEmbedUrl(rawUrl: string, hostUrl?: string): string {
  let clean = (rawUrl || '').trim()
  if (!clean) return '/preload'
  if (hostUrl) {
    const base = hostUrl.replace(/\/$/, '')
    if (base && clean.startsWith(base)) clean = clean.slice(base.length) || '/'
  }
  clean = clean.replace(/^https?:\/\/[^/]+/i, '')
  if (!clean.startsWith('/')) clean = `/${clean}`
  if (clean === '/preload' || clean.startsWith('/preload?') || clean.startsWith('/embed/')) {
    return clean
  }
  return `/embed${clean}`
}

export function resolveLookerEmbedTarget(opts: {
  isEmptyConversation?: boolean
  isHealthCheckMode?: boolean
  isLookmlMode?: boolean
  isTileMode?: boolean
  isCaMode?: boolean
  builderMode?: 'data_app' | 'dashboard'
  caConversation?: { caConversationId: string; embedPath: string } | null
  nativeContent?: {
    id: string
    contentType: string
    embedPath: string
    dashboardId?: string
    lookId?: string
    lookmlDashboardId?: string
  } | null
  publishedApp?: { dashboardId: string } | null
  hostUrl?: string
  nonce?: number
}): LookerEmbedTarget {
  const nonce = opts.nonce || 0
  const preload: LookerEmbedTarget = {
    kind: 'preload',
    target: '/preload',
    previewMode: 'preload',
    previewObjectId: '',
    nonce,
  }
  if (opts.isEmptyConversation || opts.isHealthCheckMode || opts.isLookmlMode || opts.isTileMode)
    return preload
  if ((opts.isCaMode || opts.caConversation) && opts.caConversation?.embedPath) {
    return {
      kind: 'url',
      target: normalizeLookerEmbedUrl(opts.caConversation.embedPath, opts.hostUrl),
      previewMode: 'conversational-analytics',
      previewObjectId: opts.caConversation.caConversationId,
      nonce,
    }
  }
  if (opts.builderMode === 'dashboard') {
    const nc = opts.nativeContent
    if (!nc) return preload
    if (nc.contentType === 'dashboard') {
      const id = String(nc.dashboardId || nc.id)
      return { kind: 'dashboard', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    if (nc.contentType === 'look') {
      const id = String(nc.lookId || nc.id)
      return { kind: 'look', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    const id = String(nc.lookmlDashboardId || nc.id)
    const rawUrl = nc.embedPath || `/embed/dashboards/${encodeURIComponent(id)}`
    return {
      kind: 'url',
      target: normalizeLookerEmbedUrl(rawUrl, opts.hostUrl),
      previewMode: 'dashboard',
      previewObjectId: id,
      nonce,
    }
  }
  if (opts.publishedApp?.dashboardId) {
    const id = String(opts.publishedApp.dashboardId)
    return { kind: 'dashboard', target: id, previewMode: 'data_app', previewObjectId: id, nonce }
  }
  return preload
}

export function createLookerEmbedPreloadController(opts: {
  hostUrl: string
  container: HTMLElement
  mockPreviewHtml?: (mode: string, objectId: string) => string | undefined
}) {
  const telemetry: LookerEmbedSessionTelemetry = {
    hostUrl: opts.hostUrl,
    state: 'preloaded',
    target: '/preload',
    running: false,
    runCount: 0,
    loadCount: 0,
    lastPageUrl: '/embed/preload',
    events: [],
    calls: [],
  }
  let activePreviewMeta = { mode: 'preload', objectId: '' }

  const notify = () => {
    opts.container?.setAttribute?.('data-embed-state', telemetry.state)
    opts.container?.setAttribute?.('data-embed-target', telemetry.target)
    opts.container?.setAttribute?.('data-embed-running', String(telemetry.running))
    opts.container?.setAttribute?.('data-embed-run-count', String(telemetry.runCount))
    if (typeof window !== 'undefined') {
      ;(window as any).__LOOKER_EMBED_STATE__ = {
        ...telemetry,
        events: [...telemetry.events],
        calls: [...telemetry.calls],
      }
    }
  }

  if (typeof window === 'undefined') {
    ;(globalThis as any).window = {
      location: { origin: opts.hostUrl || 'https://looker.example.com' },
      setTimeout,
      clearTimeout,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  }

  const chattyHostCreator = (initialUrl: string) => {
    const handlers: Record<string, Array<(...args: any[]) => void>> = {}
    let targetEl: any = opts.container
    const emit = (evt: string, payload: any = {}) =>
      (handlers[evt] || []).forEach((fn) => fn(payload))
    const noop = () => builder
    const builder: any = {
      on: (evt: string, fn: (...args: any[]) => void) => {
        ;(handlers[evt] = handlers[evt] || []).push(fn)
        return builder
      },
      frameBorder: noop,
      withTargetOrigin: noop,
      withAriaLabel: noop,
      withAllowAttribute: noop,
      withClassName: noop,
      withFrameAttribute: noop,
      withSandboxAttribute: noop,
      appendTo: (el: HTMLElement) => {
        targetEl = el
        return builder
      },
      build: () => {
        const doc = targetEl?.ownerDocument || (typeof document !== 'undefined' ? document : null)
        const iframe: any =
          targetEl?.querySelector?.('iframe') ||
          (doc
            ? doc.createElement('iframe')
            : {
                setAttribute: () => {},
                removeAttribute: () => {},
                getAttribute: () => '',
                classList: { add: () => {} },
                style: {},
                className: '',
                src: '',
                srcdoc: '',
              })
        if (!iframe.classList) iframe.classList = { add: () => {} }
        iframe.title = 'Looker Live Preview'
        const syncIframe = (rawUrl: string) => {
          if (rawUrl.includes('/preload')) {
            iframe.srcdoc = '<!doctype html><html><body data-preload="true" style="margin:0"></body></html>'
            iframe.removeAttribute?.('data-testid')
          } else {
            const html = opts.mockPreviewHtml?.(activePreviewMeta.mode, activePreviewMeta.objectId)
            if (html) iframe.srcdoc = html
            if (activePreviewMeta.mode === 'conversational-analytics') {
              iframe.setAttribute?.('data-testid', 'ca-embed-iframe')
            } else {
              iframe.removeAttribute?.('data-testid')
            }
          }
          iframe.setAttribute?.('data-embed-src', rawUrl)
          iframe.setAttribute?.('src', rawUrl)
        }
        syncIframe(initialUrl)
        if (doc && targetEl && iframe.parentNode !== targetEl) targetEl.appendChild(iframe)
        const connectedHost = {
          send: (event: string) => {
            if (event === 'dashboard:run') {
              syncIframe(iframe.getAttribute?.('src') || initialUrl)
              emit('dashboard:run:start')
              emit('dashboard:run:complete')
            }
          },
          sendAndReceive: async (event: string, payload?: any) => {
            if (event === 'page:load' && payload?.url) {
              const nextUrl = String(payload.url)
              syncIframe(nextUrl)
              setTimeout(() => {
                const pair = nextUrl.includes('/dashboards/')
                  ? ['dashboard:loaded', 'dashboard']
                  : nextUrl.includes('/looks/')
                  ? ['look:ready', 'look']
                  : nextUrl.includes('/explore/')
                  ? ['explore:ready', 'explore']
                  : null
                if (pair) {
                  emit(pair[0], { url: nextUrl })
                  emit(`${pair[1]}:run:start`)
                  emit(`${pair[1]}:run:complete`)
                }
                emit('page:changed', { page: { url: nextUrl, lookerVersion: '25.20.0' } })
              }, 0)
            }
            return []
          },
        }
        return {
          iframe,
          connect: () =>
            Promise.resolve(connectedHost).then((host) => {
              setTimeout(
                () => emit('page:changed', { page: { url: initialUrl, lookerVersion: '25.20.0' } }),
                0
              )
              return host
            }),
        }
      },
    }
    return builder
  }

  const sdk = opts.mockPreviewHtml
    ? getEmbedSDK(new LookerEmbedExSDK(chattyHostCreator as any))
    : getEmbedSDK()
  sdk.init(opts.hostUrl)
  telemetry.calls.push({ method: 'init', arg: opts.hostUrl }, { method: 'preload', arg: '/embed/preload' })

  const recordEvent = (name: string, running?: boolean) => {
    telemetry.events.push(name)
    if (typeof running === 'boolean') telemetry.running = running
    if (name.endsWith(':run:start')) telemetry.runCount += 1
    notify()
  }

  const connectionPromise: Promise<ILookerConnection> = sdk
    .preload()
    .appendTo(opts.container)
    .withClassName('dab-iframe')
    .on('dashboard:loaded', () => recordEvent('dashboard:loaded', false))
    .on('dashboard:run:start', () => recordEvent('dashboard:run:start', true))
    .on('dashboard:run:complete', () => recordEvent('dashboard:run:complete', false))
    .on('look:ready', () => recordEvent('look:ready', false))
    .on('look:run:start', () => recordEvent('look:run:start', true))
    .on('look:run:complete', () => recordEvent('look:run:complete', false))
    .on('explore:ready', () => recordEvent('explore:ready', false))
    .on('explore:run:start', () => recordEvent('explore:run:start', true))
    .on('explore:run:complete', () => recordEvent('explore:run:complete', false))
    .on('page:changed', (e: any) => {
      if (e?.page?.url) telemetry.lastPageUrl = String(e.page.url)
      recordEvent('page:changed')
    })
    .build()
    .connect({ waitUntilLoaded: true })

  let lastTarget: LookerEmbedTarget | null = null
  let queue: Promise<ILookerConnection> = connectionPromise.then((conn) => {
    notify()
    return conn
  })

  const syncTarget = (next: LookerEmbedTarget): Promise<ILookerConnection> => {
    queue = queue.then(async () => {
      const connection = await connectionPromise
      activePreviewMeta = { mode: next.previewMode, objectId: next.previewObjectId }
      const prev = lastTarget
      const isSameTarget = prev && prev.kind === next.kind && prev.target === next.target
      if (isSameTarget && prev.nonce === next.nonce) return connection
      lastTarget = next
      const options = { waitUntilLoaded: true }
      if (next.kind === 'preload') {
        if (prev && prev.kind !== 'preload') {
          telemetry.calls.push({ method: 'loadUrl', arg: '/preload' })
          telemetry.loadCount += 1
          await connection.loadUrl({ url: '/preload', options })
        }
      } else if (next.kind === 'dashboard') {
        if (isSameTarget && prev.nonce !== next.nonce) {
          try {
            telemetry.calls.push({ method: 'asDashboardConnection.run', arg: next.target })
            connection.asDashboardConnection().run()
          } catch {
            telemetry.calls.push({ method: 'loadDashboard', arg: next.target })
            telemetry.loadCount += 1
            await connection.loadDashboard({ id: next.target, options })
          }
        } else {
          telemetry.calls.push({ method: 'loadDashboard', arg: next.target })
          telemetry.loadCount += 1
          await connection.loadDashboard({ id: next.target, options })
        }
      } else if (next.kind === 'look') {
        telemetry.calls.push({ method: 'loadLook', arg: next.target })
        telemetry.loadCount += 1
        await connection.loadLook({ id: next.target, options })
      } else {
        telemetry.calls.push({ method: 'loadUrl', arg: next.target })
        telemetry.loadCount += 1
        await connection.loadUrl({ url: next.target, options })
      }
      telemetry.state = next.kind === 'preload' ? 'preloaded' : next.kind
      telemetry.target = next.target
      const iframeEl = opts.container?.querySelector?.('iframe')
      if (iframeEl) {
        if (next.previewMode === 'conversational-analytics') {
          iframeEl.setAttribute('data-testid', 'ca-embed-iframe')
        } else {
          iframeEl.removeAttribute('data-testid')
        }
      }
      notify()
      return connection
    })
    return queue
  }

  return {
    connectionPromise,
    syncTarget,
    getTelemetry: () => ({
      ...telemetry,
      events: [...telemetry.events],
      calls: [...telemetry.calls],
    }),
  }
}

function formatConversationContentTag(conv: ConversationRecord): string {
  const c = conv.content || {}
  if (c.caConversationId || c.agentId) return `CA · ${c.agentName || c.agentId || c.caConversationId}`
  if (c.reportId) return `TDD #${c.reportId}${typeof c.overallScore === 'number' ? ` (${c.overallScore}%)` : ''}`
  if (c.scriptId) return `Script ${c.scriptId}${c.dashboardId ? ` · #${c.dashboardId}` : ''}`
  if (c.lookmlDashboardId || c.lookId || c.dashboardId) return `${c.lookmlDashboardId ? 'LookML' : c.lookId ? 'Look' : 'Dash'} #${c.lookmlDashboardId || c.lookId || c.dashboardId}`
  if (c.sessionId || c.projectId || c.branch) return `${c.projectId || c.sessionId}${c.branch ? ` · ${c.branch}` : ''}`
  return c.id ? `#${c.id}` : ''
}

export const DOC_UI_COMPONENTS: Record<string, () => React.ReactElement> = {
  PublishDashboardButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>✨ Publish Dashboard</button>,
  ScheduleScriptButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>⏰ Schedule Script</button>,
  SaveScriptButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Save Script</button>,
  RunPythonButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>✨ Run Python</button>,
  ScriptModeSelect: () => (
    <select className="dab-select" defaultValue="summary" tabIndex={-1}>
      <option value="summary">summary</option>
      <option value="detailed_audit">detailed_audit</option>
      <option value="anomaly_alert">anomaly_alert</option>
    </select>
  ),
  ReloadPreviewButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Reload Preview</button>,
  OpenInLookerButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Open in Looker ↗</button>,
  LookmlTurnSkills: () => (
    <div className="dab-skill-bar">
      <span className="dab-skill-label">Turn Skills:</span>
      {LOOKML_TURN_SKILLS.slice(0, 3).map((sk) => (
        <button key={sk.id} type="button" className="dab-skill-chip active" tabIndex={-1}>✓ {sk.label}</button>
      ))}
    </div>
  ),
  PushLookmlButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>✨ Update LookML</button>,
  ExportHealthTddButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>✨ Download Markdown (.md)</button>,
  UseCaseBadge: () => <span className="dab-badge dab-locked-use-case-badge">🔒 Locked Use Case</span>,
}

export const USE_CASE_GUIDES: Record<StudioUseCase, { title: string; tabLabel: string; markdown: string }> = {
  auto: {
    title: 'Auto (Agent Decides) — Turn-1 Routing Guide',
    tabLabel: 'Auto',
    markdown: [
      '# Auto Use-Case Routing',
      'Evaluates your first prompt against `AGENTS.md` and your Looker role permissions (`explore`, `save_dashboards`, `develop`, `use_sql_runner`) to select the best Studio workflow automatically.',
      '## Conversation Use-Case Lock',
      '<UseCaseBadge />',
      '- After Turn 1 completes, the conversation locks to the resolved use case so follow-up turns preserve your artifact, sandbox state, and preview pane.',
      '- Click `+ New Conversation` in the left sidebar at any time to unlock the selector and start a fresh task.',
    ].join('\n'),
  },
  app: {
    title: 'Data App — Custom Lit Web Component Guide',
    tabLabel: 'Data App',
    markdown: [
      '# Interactive Looker Data App (`apps/<name>/app.js`)',
      'Builds a self-contained single-file Lit web component (`<app-kpi>`, `<app-chart>`, `<app-grid>`) validated in `/workspace` and published directly into a Looker dashboard extension tile.',
      '## Live Preview Controls',
      '<ReloadPreviewButton />',
      'Re-runs the warm `@looker/embed-sdk` dashboard connection (`asDashboardConnection().run()`) without recreating the iframe.',
      '### Open Published Dashboard in Looker',
      '<OpenInLookerButton />',
      '- Opens the underlying Looker dashboard (`/dashboards/:id`) in a new browser tab.',
      '- Supports pasting screenshots (`Cmd+V`) into the composer to convert mockups into live Data Apps.',
    ].join('\n'),
  },
  dashboard: {
    title: 'Content Studio — Native UDDs, Looks, Boards & Schedules',
    tabLabel: 'Content Studio',
    markdown: [
      '# Native Looker Content Studio',
      'Creates and updates native Looker User-Defined Dashboards (UDDs), Saved Looks, Boards, and Scheduled Plans in-browser via `LkrCodeMode`.',
      '## Preview & Navigation Controls',
      '<ReloadPreviewButton />',
      'Refreshes the embedded Looker UDD or Saved Look inside the warm preview container.',
      '### Open Native Content in Looker',
      '<OpenInLookerButton />',
      '- Launches the native Looker dashboard (`/dashboards/:id`) or Look (`/looks/:id`) directly in Looker.',
      '- All created content is indexed in **My Creations** and persisted to your personal or selected shared folder.',
    ].join('\n'),
  },
  'conversational-analytics': {
    title: 'Conversational Analytics — Isolated Sub-Agent & Embedded Chat',
    tabLabel: 'Conversational Analytics',
    markdown: [
      '# Looker Conversational Analytics (CA)',
      'Routes natural-language analytical questions to the best Looker CA Agent via a stateless isolated sub-agent (`[CA_AGENT_SELECTION_REQUEST]`, `tools=[]`) and embeds the live CA chat.',
      '## Embedded CA Chat Controls',
      '<ReloadPreviewButton />',
      'Reloads the embedded `/embed/conversations/:id` session in the right preview pane.',
      '### Open CA Conversation in Looker',
      '<OpenInLookerButton />',
      '- Opens the full Looker Conversational Analytics conversation in a new tab.',
      '- Displays the isolated sub-agent selection rationale and matched `model::explore` scope below the toolbar.',
    ].join('\n'),
  },
  lookml: {
    title: 'Agentic LookML — Dev Workspace Sync, Curation & Parity',
    tabLabel: 'LookML',
    markdown: [
      '# Agentic LookML (`lkr-dev-cli` + `LkrCodeMode`)',
      'Switches to your active Looker `dev` workspace in-browser, runs offline `lkr parse` & `lkr schema validate` in `/workspace`, and verifies `/sql/:slug` vs `/x/:slug` parity.',
      '## Per-Turn Activated LookML Skills',
      '<LookmlTurnSkills />',
      'Toggle per-turn skills (`lookml-field-curation`, `lookml-tests`, `lookml-snapshot`, `generate-view-from-table`, `agentic-lookml-workflow`) to steer field descriptions, `.test.lkml` assertions, and Bronze/Silver/Gold refinements.',
      '## Push & Validate LookML Changes',
      '<PushLookmlButton />',
      '- Pushes modified `.lkml` files to your active dev branch, runs `validate_project` and `run_lookml_test`, and renders unified diffs.',
    ].join('\n'),
  },
  'health-check': {
    title: '3-Pillar Looker & BigQuery Health Check Guide',
    tabLabel: 'Health Check',
    markdown: [
      '# 3-Pillar Looker & BigQuery Health Check',
      'Executes a zero-CLI audit in `LkrCodeMode` across **Pillar 1** (`system__activity` latency & cache), **Pillar 2** (LookML 0–4 Transcriber Maturity Rubric), and **Pillar 3** (BigQuery `INFORMATION_SCHEMA` slot & partition telemetry).',
      '## Export Technical Design Document (TDD)',
      '<ExportHealthTddButton />',
      '- Downloads the synthesized 7-section `TECHNICAL_DESIGN_DOCUMENT.md` with remediation diffs, BigQuery `PARTITION BY` / `CLUSTER BY` DDL, and quantified ROI.',
      '- Switch between **Rendered Report** and **`{ } Raw Markdown`** or copy the full Markdown to your clipboard.',
    ].join('\n'),
  },
  tile: {
    title: 'Python Tile (Script) — WASM Monty Sandbox & Scheduler Guide',
    tabLabel: 'Script',
    markdown: [
      '# Publish As Dashboard',
      '<PublishDashboardButton />',
      'Publishes the current script as a Looker UDD tile in your selected target folder (`load_configuration="wait"`, `layout="extension"`) and binds `tile_element_<id>` to `obj_script_<id>`.',
      '## Execute & Test Script Mode',
      '<RunPythonButton />',
      '<ScriptModeSelect />',
      'Executes your Python script in the browser WASM Monty sandbox (`LkrCodeMode.runPythonCode`) with `vars.mode` (`summary`, `detailed_audit`, `anomaly_alert`) and `vars.dashboard_filters`.',
      '## Save & Schedule Recurring Runs',
      '<SaveScriptButton />',
      '<ScheduleScriptButton />',
      '- **Save Script**: Persists `obj_script_<id>` and indexes it in **My Creations**.',
      '- **Schedule Script**: Opens the Custom CodeMode Script Scheduler (`obj_schedule_<id>`) to configure cron cadence, `vars.mode`, and snapshot/webhook delivery.',
    ].join('\n'),
  },
}

export const USE_CASE_GUIDE_ORDER = (Object.keys(USE_CASE_GUIDES) as StudioUseCase[]).map((useCase) => ({
  useCase,
  tabLabel: USE_CASE_GUIDES[useCase].tabLabel,
}))

// ponytail: lightweight Markdown + <ComponentName /> parser that wraps mapped React UI controls in a non-actionable preview container
export function renderUseCaseGuideMarkdown(markdown: string): React.ReactElement {
  const wrapPreview = (compName: string, key: string): React.ReactElement | null => {
    const renderFn = DOC_UI_COMPONENTS[compName]
    if (!renderFn) return null
    return (
      <div
        key={key}
        data-testid="doc-ui-preview"
        data-component={compName}
        className="dab-doc-ui-preview"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      >
        {renderFn()}
      </div>
    )
  }

  const renderInline = (text: string, keyPrefix: string): React.ReactNode[] =>
    text
      .split(/(`[^`]+`|\*\*[^*]+\*\*|<[A-Z][A-Za-z0-9_]*\s*\/>)/g)
      .filter(Boolean)
      .map((part, idx) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
          return <code key={`${keyPrefix}-c-${idx}`}>{part.slice(1, -1)}</code>
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          return <strong key={`${keyPrefix}-b-${idx}`}>{part.slice(2, -2)}</strong>
        }
        const tagMatch = part.match(/^<([A-Z][A-Za-z0-9_]*)\s*\/>$/)
        if (tagMatch && DOC_UI_COMPONENTS[tagMatch[1]]) {
          return wrapPreview(tagMatch[1], `${keyPrefix}-ui-${idx}`)
        }
        return part
      })

  const lines = String(markdown || '').split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }
    const standaloneComp = trimmed.match(/^<([A-Z][A-Za-z0-9_]*)\s*\/>$/)
    if (standaloneComp && DOC_UI_COMPONENTS[standaloneComp[1]]) {
      blocks.push(wrapPreview(standaloneComp[1], `block-ui-${i}`))
      i++
      continue
    }
    const hMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (hMatch) {
      const tag = `h${hMatch[1].length}`
      blocks.push(React.createElement(tag, { key: `${tag}-${i}` }, renderInline(hMatch[2], `${tag}-${i}`)))
      i++
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, '')
        items.push(<li key={`li-${i}`}>{renderInline(itemText, `li-${i}`)}</li>)
        i++
      }
      blocks.push(<ul key={`ul-${i}`}>{items}</ul>)
      continue
    }
    blocks.push(<p key={`p-${i}`}>{renderInline(trimmed, `p-${i}`)}</p>)
    i++
  }

  return <div className="dab-tdd-rendered dab-use-case-guide-markdown">{blocks}</div>
}

export const UseCaseInfoTrigger: React.FC<{
  useCase: StudioUseCase
  onOpen: (uc: StudioUseCase) => void
}> = ({ useCase, onOpen }) => (
  <button
    type="button"
    data-testid="use-case-info-btn"
    className="dab-btn dab-btn-secondary dab-info-trigger"
    title="Use case guide & controls reference"
    onClick={() => onOpen(useCase)}
  >
    ?
  </button>
)

export const UseCaseInfoModal: React.FC<{
  activeUseCase: StudioUseCase | null
  onSelectUseCase: (uc: StudioUseCase) => void
  onClose: () => void
}> = ({ activeUseCase, onSelectUseCase, onClose }) => {
  if (!activeUseCase) return null
  const guide = USE_CASE_GUIDES[activeUseCase] || USE_CASE_GUIDES.auto
  return (
    <div
      className="dab-modal-backdrop"
      data-testid="use-case-info-modal"
      onClick={onClose}
    >
      <div
        className="dab-modal dab-use-case-info-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div>
            <strong style={{ fontSize: 15 }}>📖 {guide.title}</strong>
            <div className="dab-muted" style={{ fontSize: 11.5 }}>
              Interactive guide &amp; live-themed UI controls reference (non-actionable preview)
            </div>
          </div>
          <button
            type="button"
            data-testid="use-case-info-close-btn"
            className="dab-btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="dab-use-case-guide-tabs" role="tablist" aria-label="Use Case Guides">
          {USE_CASE_GUIDE_ORDER.map((item) => (
            <button
              key={item.useCase}
              type="button"
              role="tab"
              aria-selected={activeUseCase === item.useCase}
              data-testid={`use-case-guide-tab-${item.useCase}`}
              className={`dab-skill-chip ${activeUseCase === item.useCase ? 'active' : ''}`}
              onClick={() => onSelectUseCase(item.useCase)}
            >
              {item.tabLabel}
            </button>
          ))}
        </div>

        <div className="dab-use-case-guide-body">
          {renderUseCaseGuideMarkdown(guide.markdown)}
        </div>
      </div>
    </div>
  )
}

export const StudioConversationsSidebar: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    conversations,
    archivedConversations,
    showArchivedConversations,
    setShowArchivedConversations,
    pendingDeleteConv,
    deleteRelatedContent,
    setDeleteRelatedContent,
    activeConversationId,
    sidebarCollapsed,
    setSidebarCollapsed,
    handleSelectConversation,
    handleToggleArchiveConversation,
    handleRequestDeleteConversation,
    handleCancelDeleteConversation,
    handleConfirmDeleteConversation,
    handleNewConversation,
    busyStatus,
    userId,
  } = ctl

  const renderConversationRow = (conv: ConversationRecord, isArchived = false) => {
    const contentBadge = formatConversationContentTag(conv)
    const isActive = activeConversationId === conv.id
    return (
      <div
        key={conv.id}
        data-testid={`conversation-item-${conv.id}`}
        className={`dab-conv-item ${isActive ? 'active' : ''} ${isArchived ? 'archived' : ''}`}
        onClick={() => handleSelectConversation(conv)}
        title={`${conv.label} (${conv.type}${conv.interactionId ? ` · ${conv.interactionId}` : ''})`}
      >
        <div className="dab-conv-item-top">
          <span className="dab-conv-type-badge">{conv.type}</span>
          {contentBadge && <span className="dab-conv-content-tag">{contentBadge}</span>}
          <div className="dab-conv-item-actions">
            <button
              type="button"
              className="dab-conv-action-btn dab-conv-archive-btn"
              data-testid={`archive-conv-${conv.id}`}
              onClick={(e) => handleToggleArchiveConversation(e, conv.id, !isArchived)}
              title={isArchived ? 'Unarchive conversation' : 'Archive conversation'}
            >
              {isArchived ? '↩' : '📥'}
            </button>
            <button
              type="button"
              className="dab-conv-action-btn dab-conv-delete-btn"
              data-testid={`delete-conv-${conv.id}`}
              onClick={(e) => handleRequestDeleteConversation(e, conv)}
              title="Delete conversation"
            >
              🗑
            </button>
          </div>
        </div>
        <div className="dab-conv-item-label">{conv.label}</div>
      </div>
    )
  }

  const relatedInfo = pendingDeleteConv
    ? resolveConversationRelatedContent(pendingDeleteConv, userId)
    : null

  return (
    <nav
      className={`dab-conv-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
      data-testid="conversations-sidebar"
      aria-label="Previous Conversations"
    >
      <div className="dab-conv-sidebar-header">
        <button
          type="button"
          className="dab-conv-collapse-btn"
          data-testid="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          title={sidebarCollapsed ? 'Expand conversations sidebar' : 'Collapse conversations sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
        {!sidebarCollapsed && (
          <strong className="dab-conv-sidebar-title">
            Conversations ({conversations.length})
          </strong>
        )}
      </div>

      <div className="dab-conv-sidebar-actions">
        <button
          type="button"
          className="dab-conv-new-btn"
          data-testid="new-conversation-btn"
          onClick={handleNewConversation}
          disabled={!!busyStatus}
          title="Start a new conversation"
        >
          {sidebarCollapsed ? '+' : '+ New Conversation'}
        </button>
      </div>

      {!sidebarCollapsed && (
        <div className="dab-conv-list">
          {conversations.length === 0 ? (
            <div className="dab-conv-empty">No previous conversations yet.</div>
          ) : (
            conversations.map((conv) => renderConversationRow(conv, false))
          )}

          <div className="dab-conv-archived-section">
            <button
              type="button"
              className="dab-conv-archived-toggle"
              data-testid="toggle-archived-convs"
              onClick={() => setShowArchivedConversations((prev) => !prev)}
            >
              {showArchivedConversations
                ? `Hide Archived (${archivedConversations.length})`
                : `Show Archived (${archivedConversations.length})`}
            </button>
            {showArchivedConversations && (
              <div className="dab-conv-archived-list" data-testid="archived-conversations-list">
                {archivedConversations.length === 0 ? (
                  <div className="dab-conv-empty">No archived conversations.</div>
                ) : (
                  archivedConversations.map((conv) => renderConversationRow(conv, true))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {pendingDeleteConv && relatedInfo && (
        <div
          className="dab-modal-backdrop"
          onClick={handleCancelDeleteConversation}
        >
          <div
            className="dab-modal"
            data-testid="delete-conv-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dab-delete-conv-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dab-modal-header">
              <strong id="dab-delete-conv-modal-title">Delete Conversation?</strong>
              <button
                type="button"
                className="dab-conv-action-btn"
                onClick={handleCancelDeleteConversation}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            <div className="dab-modal-body">
              <p style={{ margin: '0 0 8px' }}>
                Remove <strong>{pendingDeleteConv.label}</strong> (<code>{pendingDeleteConv.type}</code>)
                from your conversation history (<code>user_conversations:{userId || '1'}</code>
                {relatedInfo.userIndexKeys[0] ? ` and ${relatedInfo.userIndexKeys[0]}` : ''})?
              </p>
              {relatedInfo.items.length > 0 && (
                <div className="dab-modal-related-box" data-testid="delete-conv-related-summary">
                  <strong>Linked Looker &amp; Shared Artifact Content:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {relatedInfo.items.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="dab-modal-checkbox-row">
                <input
                  type="checkbox"
                  data-testid="delete-related-content-checkbox"
                  checked={deleteRelatedContent}
                  onChange={(e) => setDeleteRelatedContent(e.target.checked)}
                />
                <span>
                  Also delete related Looker content &amp; shared artifacts ({relatedInfo.summary})
                </span>
              </label>
            </div>
            <div className="dab-modal-actions">
              <button
                type="button"
                className="dab-btn-secondary"
                data-testid="cancel-delete-conv-btn"
                onClick={handleCancelDeleteConversation}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dab-btn-secondary"
                data-testid="confirm-delete-conv-only-btn"
                onClick={() => handleConfirmDeleteConversation(false)}
              >
                Delete Conversation Only
              </button>
              <button
                type="button"
                className="dab-btn-danger"
                data-testid="confirm-delete-conv-and-content-btn"
                onClick={() => handleConfirmDeleteConversation(true)}
              >
                Delete Conversation &amp; Related Content
              </button>
              <button
                type="button"
                className="dab-btn-primary"
                data-testid="confirm-delete-conv-btn"
                onClick={() => handleConfirmDeleteConversation()}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

export interface StarterPromptItem {
  id: string
  label: string
  prompt: string
}

export const STARTER_PROMPTS_BY_USE_CASE: Record<string, StarterPromptItem[]> = {
  auto: [
    { id: 'exec-app', label: '📊 Build an Executive Revenue Data App', prompt: 'Build an Executive Revenue Data App on order_items with Total Revenue, Total Orders, Avg Order Value KPIs and a monthly trend chart.' },
    { id: 'native-udd', label: '📈 Create a Native Looker Dashboard', prompt: 'Create a native Looker UDD on order_items with a Total Revenue & Orders KPI, a Revenue by Status column chart, and an Order Status filter.' },
    { id: 'ask-ca', label: '💬 Ask a Data Question', prompt: 'What are the top 3 product categories by gross margin in Q4?' },
    { id: 'lookml-measure', label: '🧩 Add LookML Measures & Data Tests', prompt: 'Add total_revenue and gross_margin measures to orders, curate field descriptions, and add a LookML data test.' },
  ],
  app: [
    { id: 'exec-kpi', label: '📊 Executive Revenue KPI App', prompt: 'Build an Executive Revenue Data App on order_items with Total Revenue, Total Orders, Avg Order Value KPIs and a monthly trend chart.' },
    { id: 'cohort-grid', label: '🧮 Interactive Cohort & Margin Explorer', prompt: 'Build an interactive Data App with a metric switcher, category breakdown chart, and drillable order grid.' },
    { id: 'funnel-app', label: '🛒 Customer Conversion Funnel App', prompt: 'Create a customer conversion and retention Data App with regional filters and YoY comparison cards.' },
  ],
  dashboard: [
    { id: 'udd-exec', label: '📈 Executive Order Performance UDD', prompt: 'Create a native Looker UDD on order_items with a Total Revenue & Orders KPI, a Revenue by Status column chart, and an Order Status filter.' },
    { id: 'saved-look', label: '🔍 Top Brands & Categories Saved Look', prompt: 'Create a Saved Look showing top 10 brands by revenue and gross margin with a 90-day date filter.' },
    { id: 'board-schedule', label: '📌 Executive Board & Morning Schedule', prompt: 'Pin our key revenue dashboards to an Executive Pulse board and schedule a weekday 8 AM summary.' },
  ],
  'conversational-analytics': [
    { id: 'ca-margin', label: '💬 Top Categories by Gross Margin', prompt: 'What are the top 3 product categories by gross margin in Q4?' },
    { id: 'ca-spike', label: '📉 Q4 Revenue & Streaming Volume Q&A', prompt: 'Why did order revenue spike in Q4 and which BigQuery tables had the highest streaming buffer volume?' },
    { id: 'ca-retention', label: '🔁 Repeat Customer Cohort Breakdown', prompt: 'Show me the monthly breakdown of repeat vs first-time customer orders over the past year.' },
  ],
  'health-check': [
    { id: 'hc-full', label: '🩺 Full 3-Pillar Looker & BigQuery Audit', prompt: 'Run a full 3-pillar Looker & BigQuery health check and generate a prioritized Technical Design Document.' },
    { id: 'hc-lookml', label: '📐 LookML Transcriber Rubric & PK Audit', prompt: 'Audit LookML views for missing primary keys, symmetric aggregate fanouts, and 0–4 Transcriber maturity score.' },
    { id: 'hc-bq', label: '⚡ BigQuery Partitioning & Slot Cost Audit', prompt: 'Analyze BigQuery INFORMATION_SCHEMA for unpartitioned tables, high-byte scans, and clustering recommendations.' },
  ],
  lookml: [
    { id: 'lkml-measures', label: '🧩 Add Revenue & Margin Measures', prompt: 'Add total_revenue and gross_margin measures to orders refinement, curate field descriptions, and verify SQL vs Explore parity.' },
    { id: 'lkml-tests', label: '🧪 Generate LookML Assert Data Tests', prompt: 'Curate descriptions on order_items, generate assert data tests (.test.lkml), and capture a LookML parity snapshot.' },
    { id: 'lkml-ndt', label: '🧱 Model a Native Derived Table Rollup', prompt: 'Create a customer lifetime value native derived table (NDT) view and join it into the order_items explore.' },
  ],
  tile: [
    { id: 'script-summary', label: '🐍 Explore & Active Filter Summary', prompt: 'Write a Script summarizing visible LookML models, explores, and active dashboard filters as a table.' },
    { id: 'script-anomaly', label: '🚨 Daily Revenue Anomaly Detector', prompt: 'Write a Script that queries daily order revenue, flags days outside 2 standard deviations, and outputs a markdown alert.' },
    { id: 'script-audit', label: '📋 Unused Content & Schedule Audit', prompt: 'Write a Script that lists top scheduled plans and dashboard element counts across folders.' },
  ],
}
STARTER_PROMPTS_BY_USE_CASE.health = STARTER_PROMPTS_BY_USE_CASE['health-check']

export function getStarterPromptsForUseCase(useCase?: string): StarterPromptItem[] {
  const key = String(useCase || 'auto').trim().toLowerCase()
  return STARTER_PROMPTS_BY_USE_CASE[key] || STARTER_PROMPTS_BY_USE_CASE.auto
}

export const StarterPromptButtons: React.FC<{
  useCase?: string
  onSelect: (promptText: string) => void
  disabled?: boolean
}> = ({ useCase, onSelect, disabled }) => (
  <div className="dab-starter-prompts" data-testid="starter-prompt-list">
    {getStarterPromptsForUseCase(useCase).map((item) => (
      <button key={item.id} type="button" data-testid={`starter-prompt-${item.id}`} className="dab-starter-chip" disabled={disabled} onClick={() => onSelect(item.prompt)} title={item.prompt}>
        {item.label}
      </button>
    ))}
  </div>
)

export const StudioComposer: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode,
    builderMode,
    isLookmlMode,
    isHealthCheckMode,
    isCaMode,
    caConversation,
    selectedUseCase,
    setSelectedUseCase,
    isUseCaseLocked,
    allowedUseCases,
    useCaseOptions,
    getUseCaseLabel,
    capabilities,
    selectedModel,
    setSelectedModel,
    availableModels,
    busyStatus,
    activatedLookmlSkills,
    setActivatedLookmlSkills,
    pastedImages,
    setPastedImages,
    prompt,
    setPrompt,
    handleSendPrompt,
    isAuthenticated,
    authMode,
    clientId,
    oauthSigningIn,
    handleOAuthLogin,
    history,
    lookmlBundle,
    nativeContent,
    publishedApp,
    infoModalUseCase,
    setInfoModalUseCase,
  } = ctl

  const activeGuideUseCase: StudioUseCase = !isUseCaseLocked
    ? selectedUseCase
    : isCaMode || caConversation
    ? 'conversational-analytics'
    : isHealthCheckMode
    ? 'health-check'
    : isLookmlMode
    ? 'lookml'
    : activeMode === 'tile'
    ? 'tile'
    : builderMode === 'dashboard'
    ? 'dashboard'
    : selectedUseCase || 'app'
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) =>
    handleImageClipboardPaste(e, setPastedImages)

  return (
    <div className="dab-composer dab-chatbar">
      <div
        className="dab-use-case-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <strong style={{ color: 'var(--dab-text-secondary, #475569)' }}>Use Case:</strong>
          {!isUseCaseLocked ? (
            <select
              data-testid="use-case-selector"
              value={selectedUseCase}
              onChange={(e) => setSelectedUseCase(e.target.value as StudioUseCase)}
              disabled={!!busyStatus}
              style={{
                height: 26,
                fontSize: 12,
                padding: '0 8px',
                borderRadius: 6,
                border: '1px solid var(--dab-border-strong, #cbd5e1)',
                background: 'var(--dab-surface-muted, #f8fafc)',
                color: 'var(--dab-text-strong, #0f172a)',
                fontWeight: 500,
              }}
            >
              {useCaseOptions.map((opt) => {
                const isAllowed =
                  opt.value === 'auto' || allowedUseCases.includes(opt.value as any)
                const toolReason =
                  opt.capabilityMode && capabilities?.rolesLoaded
                    ? capabilities.tools?.[opt.capabilityMode]?.reason
                    : undefined
                return (
                  <option
                    key={opt.value}
                    value={opt.value}
                    disabled={!isAllowed}
                    title={!isAllowed ? toolReason || 'Missing Looker permissions' : undefined}
                  >
                    {!isAllowed ? `🔒 ${opt.label} (Locked)` : opt.label}
                  </option>
                )
              })}
            </select>
          ) : (
            <span
              data-testid="locked-use-case-badge"
              className="dab-badge dab-locked-use-case-badge"
              style={{
                background: 'var(--dab-badge-bg, #eff6ff)',
                color: 'var(--dab-accent-text, #1d4ed8)',
                borderColor: 'var(--dab-accent-border, #bfdbfe)',
                fontWeight: 600,
              }}
              title="Use case is locked after Turn 1 — start a new conversation to switch use cases"
            >
              🔒 {getUseCaseLabel(selectedUseCase)}
            </span>
          )}
          <UseCaseInfoTrigger useCase={activeGuideUseCase} onOpen={setInfoModalUseCase} />
        </div>
      </div>

      <UseCaseInfoModal
        activeUseCase={infoModalUseCase}
        onSelectUseCase={setInfoModalUseCase}
        onClose={() => setInfoModalUseCase(null)}
      />

      {isLookmlMode && (
        <div className="dab-skill-bar" aria-label="Activated Turn Skills">
          <span className="dab-skill-label">Turn Skills:</span>
          {LOOKML_TURN_SKILLS.map((sk) => {
            const isActive = activatedLookmlSkills.includes(sk.id)
            return (
              <button
                key={sk.id}
                type="button"
                className={`dab-skill-chip ${isActive ? 'active' : ''}`}
                title={sk.desc}
                onClick={() =>
                  setActivatedLookmlSkills((prev) =>
                    prev.includes(sk.id)
                      ? prev.filter((x) => x !== sk.id)
                      : [...prev, sk.id]
                  )
                }
              >
                {isActive ? '✓ ' : '+ '}
                {sk.label}
              </button>
            )
          })}
        </div>
      )}

      {pastedImages.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {pastedImages.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={img.dataUrl}
                alt="Pasted screenshot"
                style={{ height: 52, borderRadius: 4, border: '1px solid #cbd5e1' }}
              />
              <button
                type="button"
                onClick={() => setPastedImages((prev) => prev.filter((_, idx) => idx !== i))}
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#0f172a',
                  color: '#fff',
                  fontSize: 10,
                  cursor: 'pointer',
                  lineHeight: '18px',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        rows={3}
        data-testid="studio-prompt-input"
        placeholder={
          isHealthCheckMode
            ? 'Optional custom focus for 3-Pillar Looker & BigQuery Health Check...'
            : isCaMode || selectedUseCase === 'conversational-analytics'
            ? 'Ask a natural-language data question for Looker Conversational Analytics...'
            : isLookmlMode
            ? 'Describe LookML changes, SQL query to model, or field descriptions/tests to run in your active dev mode...'
            : activeMode === 'tile'
            ? 'Describe the Script to generate or update (or paste a screenshot)...'
            : builderMode === 'dashboard'
            ? 'Describe a Looker UDD, Look, Board, or Schedule to create or update...'
            : 'Describe the Data App to build or paste a screenshot (Cmd+Enter to send)...'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            handleSendPrompt()
          }
        }}
        disabled={!!busyStatus}
      />

      <div className="dab-composer-actions">
        <select
          data-testid="composer-model-select"
          className="dab-composer-model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={!!busyStatus}
          aria-label="Select Antigravity model"
          title="Select Antigravity model for this turn (/v1beta/models)"
        >
          {availableModels.map((m) => (
            <option key={m.id} value={m.id} title={m.description}>
              {m.label}
            </option>
          ))}
        </select>

        <div
          className="dab-composer-send-group"
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}
        >
          {!isAuthenticated && (
            <button
              type="button"
              data-testid="composer-signin-inline-btn"
              className="dab-inline-signin-btn"
              onClick={() =>
                authMode === 'oauth' && clientId.trim()
                  ? handleOAuthLogin()
                  : history.push('/config')
              }
            >
              {authMode === 'oauth' && clientId.trim()
                ? oauthSigningIn
                  ? 'Signing in… (click to retry)'
                  : 'Sign in to send'
                : 'Configure credentials to send'}
            </button>
          )}
          <button
            type="button"
            data-testid="studio-send-btn"
            className="dab-btn-gemini"
            onClick={handleSendPrompt}
            disabled={
              !isAuthenticated || !!busyStatus || (!prompt.trim() && pastedImages.length === 0)
            }
          >
            {isCaMode || selectedUseCase === 'conversational-analytics'
              ? caConversation
                ? '✨ Ask CA Agent'
                : '✨ Route & Start CA Chat'
              : isLookmlMode
              ? lookmlBundle
                ? '✨ Update LookML'
                : '✨ Run Agentic LookML'
              : activeMode === 'tile'
              ? '✨ Ask AI'
              : builderMode === 'dashboard'
              ? nativeContent
                ? '✨ Update Content'
                : '✨ Create / Update Content'
              : publishedApp
              ? '✨ Update App'
              : '✨ Build App'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const StudioCenteredEmptyStage: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode,
    builderMode,
    isLookmlMode,
    isHealthCheckMode,
    selectedUseCase,
    selectedExplores,
    setPrompt,
    busyStatus,
  } = ctl

  return (
    <main className="dab-empty-stage-centered" data-testid="centered-empty-prompt">
      <div className="dab-empty-prompt-card">
        <div className="dab-empty-hero">
          <span className="dab-badge">New Conversation</span>
          <h2>
            {isHealthCheckMode
              ? 'Run a 3-Pillar Looker & BigQuery Health Check'
              : isLookmlMode
              ? 'Author & Validate Agentic LookML'
              : activeMode === 'tile'
              ? 'Author & Schedule a Looker Script'
              : builderMode === 'dashboard'
              ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
              : 'Build a Looker Data App with Antigravity'}
          </h2>
          <p className="dab-muted">
            {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
          </p>
          <StarterPromptButtons useCase={selectedUseCase} onSelect={setPrompt} disabled={!!busyStatus} />
        </div>

        <StudioComposer ctl={ctl} />
      </div>
    </main>
  )
}

const STEP_BADGES: Record<string, string> = {
  thought: '💭 Thought',
  codemode: '🐍 Code Mode',
  cli_bridge: '🌉 CLI Bridge',
  file: '📄 File',
  skill: '📚 Skill',
}

function formatActivityStepBadge(step: AntigravityActivityStep): string {
  if (step.kind === 'code_execution') {
    return step.language === 'PYTHON' ? '🐍 Sandbox Python' : '💻 Sandbox Bash'
  }
  return STEP_BADGES[step.kind] || '⚡ Activity'
}

function renderActivityStepsList(steps: AntigravityActivityStep[]) {
  return (
    <div className="dab-thinking-steps">
      {steps.map((step, sIdx) => (
        <div
          key={step.id || sIdx}
          className={`dab-thinking-step dab-thinking-step-${step.kind}`}
          data-step-kind={step.kind}
          data-step-status={step.status || 'done'}
        >
          <div className="dab-thinking-step-header">
            <span className="dab-thinking-kind-badge">{formatActivityStepBadge(step)}</span>
            <span className="dab-thinking-step-title">{step.title}</span>
            {step.status === 'running' && (
              <span className="dab-thinking-step-status">Running…</span>
            )}
          </div>
          {step.detail && step.detail !== step.title && (
            <code className="dab-thinking-step-detail">{step.detail}</code>
          )}
        </div>
      ))}
    </div>
  )
}

export const StudioLeftPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    messages,
    builderMode,
    selectedUseCase,
    selectedExplores,
    setPrompt,
    busyStatus,
    liveActivitySteps,
    pendingPerm,
    resolvePermDecision,
  } = ctl

  return (
    <aside className="dab-left-pane">
      <div className="dab-chat-log">
        {messages.length === 0 && (
          <div className="dab-empty-chat">
            <p>
              <strong>
                {builderMode === 'dashboard'
                  ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
                  : 'Build a Looker Data App with Antigravity'}
              </strong>
            </p>
            <p className="dab-muted">
              {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
            </p>
            <StarterPromptButtons useCase={selectedUseCase} onSelect={setPrompt} disabled={!!busyStatus} />
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={idx} className={`dab-msg dab-msg-${m.role}`}>
            <div className="dab-msg-header">
              {m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : 'Antigravity'}
              {m.dashboardId && (
                <span className="dab-msg-pill">
                  Dashboard #{m.dashboardId}
                  {typeof m.widgetCount === 'number' ? ` · ${m.widgetCount} queries` : ''}
                </span>
              )}
            </div>
            {m.role === 'assistant' && m.activitySteps && m.activitySteps.length > 0 && (
              <details
                className="dab-thinking-block"
                data-testid="completed-thinking-block"
              >
                <summary className="dab-thinking-summary">
                  <span className="dab-thinking-summary-label">
                    Thought for {m.thinkingDurationSec ?? 1}s · {m.activitySteps.length}{' '}
                    {m.activitySteps.length === 1 ? 'step' : 'steps'}
                  </span>
                </summary>
                {renderActivityStepsList(m.activitySteps)}
              </details>
            )}
            <div className="dab-msg-body">{m.text}</div>
            {m.images && m.images.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {m.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="Attached screenshot"
                    style={{ maxHeight: 80, borderRadius: 4, border: '1px solid #cbd5e1' }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {liveActivitySteps && liveActivitySteps.length > 0 && (
          <details
            className="dab-thinking-block dab-thinking-live"
            data-testid="live-thinking-block"
            open
          >
            <summary className="dab-thinking-summary">
              <span className="dab-spinner" />
              <span className="dab-thinking-summary-label">
                Thinking &amp; Activity ·{' '}
                {liveActivitySteps[liveActivitySteps.length - 1]?.title ||
                  busyStatus ||
                  'Working...'}
              </span>
              <span className="dab-thinking-step-count">
                {liveActivitySteps.length} {liveActivitySteps.length === 1 ? 'step' : 'steps'}
              </span>
            </summary>
            {renderActivityStepsList(liveActivitySteps)}
          </details>
        )}

        {busyStatus && (
          <div className="dab-status-banner">
            <span className="dab-spinner" />
            <span>{busyStatus}</span>
          </div>
        )}
      </div>

      {pendingPerm && (
        <div className="dab-permission-bar">
          <div>
            <strong>Approve Looker State Mutation?</strong>{' '}
            <code>{pendingPerm.req.operation}</code> (
            <code>
              {pendingPerm.req.httpMethod} {pendingPerm.req.path}
            </code>
            )
            {pendingPerm.req.thought && (
              <div
                className="dab-permission-thought"
                data-testid="permission-request-thought"
              >
                {pendingPerm.req.thought}
              </div>
            )}
          </div>
          <div className="dab-permission-actions">
            <button
              type="button"
              className="dab-btn-primary"
              onClick={() => resolvePermDecision('allow_once')}
            >
              Allow once
            </button>
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() => resolvePermDecision('allow_op')}
            >
              Allow all &apos;{pendingPerm.req.operation}&apos; this turn
            </button>
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() => resolvePermDecision('allow_all')}
            >
              Allow all mutations this turn
            </button>
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() => resolvePermDecision('deny')}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      <StudioComposer ctl={ctl} />
    </aside>
  )
}

export const StudioRightPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode,
    isEmptyConversation,
    isHealthCheckMode,
    isLookmlMode,
    isCaMode,
    builderMode,
    healthReport,
    lookmlBundle,
    caConversation,
    canDeployLookml,
    nativeContent,
    publishedApp,
    currentAppCode,
    embedNonce,
    extensionSDK,
    setInfoModalUseCase,
  } = ctl
  const isTileMode = activeMode === 'tile'

  const hostUrl = (extensionSDK as any)?.lookerHostData?.hostUrl || window.location.origin
  const mockExt =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  const [tddViewMode, setTddViewMode] = useState<'rendered' | 'raw'>(
    () => mockExt?.initialTddViewMode || 'rendered'
  )
  const [copiedTdd, setCopiedTdd] = useState(false)
  const [showAppCode, setShowAppCode] = useState(false)
  const [iframeRev, setIframeRev] = useState(0)
  const embedContainerRef = useRef<HTMLDivElement | null>(null)
  const embedControllerRef = useRef<ReturnType<typeof createLookerEmbedPreloadController> | null>(
    null
  )

  const embedTarget = useMemo(
    () =>
      resolveLookerEmbedTarget({
        isEmptyConversation,
        isHealthCheckMode,
        isLookmlMode,
        isTileMode,
        isCaMode,
        builderMode,
        caConversation,
        nativeContent,
        publishedApp,
        hostUrl,
        nonce: (embedNonce || 0) + iframeRev,
      }),
    [
      isEmptyConversation,
      isHealthCheckMode,
      isLookmlMode,
      isTileMode,
      isCaMode,
      builderMode,
      caConversation,
      nativeContent,
      publishedApp,
      hostUrl,
      embedNonce,
      iframeRev,
    ]
  )

  useEffect(() => {
    const el = embedContainerRef.current
    if (!el || embedControllerRef.current) return
    embedControllerRef.current = createLookerEmbedPreloadController({
      hostUrl,
      container: el,
      mockPreviewHtml: mockExt?.getMockPreviewHtml
        ? (mode, objectId) => mockExt.getMockPreviewHtml(mode, objectId)
        : undefined,
    })
  }, [hostUrl, mockExt])

  useEffect(() => {
    if (!embedControllerRef.current) return
    void embedControllerRef.current.syncTarget(embedTarget)
  }, [embedTarget])

  const handleCopyTddMarkdown = () => {
    if (!healthReport?.tddMarkdown) return
    navigator.clipboard?.writeText(healthReport.tddMarkdown)
    setCopiedTdd(true)
    setTimeout(() => setCopiedTdd(false), 1800)
  }

  const handleDownloadTddMarkdown = () => {
    if (!healthReport?.tddMarkdown) return
    const url = URL.createObjectURL(
      new Blob([healthReport.tddMarkdown], { type: 'text/markdown;charset=utf-8' })
    )
    Object.assign(document.createElement('a'), {
      href: url,
      download: 'TECHNICAL_DESIGN_DOCUMENT.md',
    }).click()
    URL.revokeObjectURL(url)
  }

  const activePreviewId =
    builderMode === 'dashboard' ? nativeContent?.id : publishedApp?.dashboardId
  const openInLookerPath =
    builderMode === 'dashboard' && nativeContent
      ? nativeContent.embedPath.replace(/^\/embed/, '')
      : publishedApp
      ? `/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
      : ''
  const hasActiveEmbed = embedTarget.kind !== 'preload'

  return (
    <main className="dab-right-pane" style={isEmptyConversation ? { display: 'none' } : undefined}>
      {isTileMode ? (
        <TilePreviewPane ctl={ctl} />
      ) : isHealthCheckMode ? (
        <div className="dab-preview-toolbar">
          <div>
            {healthReport ? (
              <>
                <strong>{healthReport.title}</strong>{' '}
                <span className="dab-badge">
                  Health Score: {healthReport.scores.overallScore}% ({healthReport.scores.grade})
                </span>{' '}
                <span className="dab-badge">
                  Transcriber: {healthReport.scores.transcriberScore}/4.00
                </span>{' '}
                <span className="dab-muted">
                  (user_{healthReport.createdBy}_health_check_{healthReport.id} · obj_health_check_
                  {healthReport.id})
                </span>
              </>
            ) : (
              <span className="dab-muted">
                7-section TECHNICAL_DESIGN_DOCUMENT.md (0–100% health score) will render here
              </span>
            )}
          </div>
          <div className="dab-preview-actions">
            {healthReport && (
              <>
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => setTddViewMode((m) => (m === 'rendered' ? 'raw' : 'rendered'))}
                >
                  {tddViewMode === 'rendered' ? '{ } Raw Markdown' : '📖 Rendered Report'}
                </button>
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={handleCopyTddMarkdown}
                >
                  {copiedTdd ? '✓ Copied Markdown' : 'Copy Markdown'}
                </button>
                <button
                  type="button"
                  className="dab-btn-gemini"
                  onClick={handleDownloadTddMarkdown}
                >
                  ✨ Download Markdown (.md)
                </button>
              </>
            )}
            <UseCaseInfoTrigger useCase="health-check" onOpen={setInfoModalUseCase} />
          </div>
        </div>
      ) : isLookmlMode ? (
        <div className="dab-preview-toolbar">
          <div>
            {lookmlBundle ? (
              <>
                <strong>{lookmlBundle.title}</strong>{' '}
                <span className="dab-muted">
                  (Session <code>obj_lookml_{lookmlBundle.id}</code> ·{' '}
                  {lookmlBundle.files?.length || 0} .lkml files)
                </span>
              </>
            ) : (
              <span className="dab-muted">
                Agentic LookML preview (.lkml diffs, validator, run_lookml_test &amp; /sql/:slug +
                /x/:slug parity)
              </span>
            )}
          </div>
          <div className="dab-preview-actions">
            <UseCaseInfoTrigger useCase="lookml" onOpen={setInfoModalUseCase} />
          </div>
        </div>
      ) : isCaMode || caConversation ? (
        <>
          <div className="dab-preview-toolbar" data-testid="ca-preview-toolbar">
            <div>
              {caConversation ? (
                <>
                  <strong>{caConversation.title}</strong>{' '}
                  <span className="dab-badge" data-testid="ca-selected-agent-badge">
                    🤖 Agent: {caConversation.agentName} ({caConversation.agentId})
                  </span>{' '}
                  <span className="dab-muted">
                    (Conversation <code>{caConversation.caConversationId}</code> ·{' '}
                    <code>{caConversation.embedPath}</code>)
                  </span>
                </>
              ) : (
                <span className="dab-muted">
                  Looker Conversational Analytics embedded chat will appear here after routing
                </span>
              )}
            </div>
            <div className="dab-preview-actions">
              {caConversation && (
                <>
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={() => setIframeRev((r) => r + 1)}
                  >
                    Reload CA Chat
                  </button>
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={() =>
                      extensionSDK.openBrowserWindow(
                        caConversation.embedPath.replace(/^\/embed/, ''),
                        '_blank'
                      )
                    }
                  >
                    Open in Looker ↗
                  </button>
                </>
              )}
              <UseCaseInfoTrigger useCase="conversational-analytics" onOpen={setInfoModalUseCase} />
            </div>
          </div>
          {caConversation?.selectionRationale && (
            <div
              data-testid="ca-selection-rationale"
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: 'var(--dab-surface-muted, #f8fafc)',
                borderBottom: '1px solid var(--dab-border, #e2e8f0)',
                color: 'var(--dab-text-secondary, #334155)',
              }}
            >
              <strong>Isolated Sub-Agent Selection:</strong> {caConversation.selectionRationale}
              {caConversation.explores?.length > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--dab-text-muted, #64748b)' }}>
                  · Explores: <code>{caConversation.explores.join(', ')}</code>
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="dab-preview-toolbar">
          <div>
            {builderMode === 'dashboard' ? (
              nativeContent ? (
                <>
                  <strong>{nativeContent.title}</strong>{' '}
                  <span className="dab-muted">
                    ({nativeContent.contentType} #{nativeContent.id} ·{' '}
                    <code>{nativeContent.embedPath}</code>)
                  </span>
                </>
              ) : (
                <span className="dab-muted">
                  Live Looker UDD / Look / Board preview will appear here after the first turn
                </span>
              )
            ) : publishedApp ? (
              <>
                <strong>{publishedApp.title}</strong>{' '}
                <span className="dab-muted">
                  (Dashboard #{publishedApp.dashboardId} · Extension db::
                  {publishedApp.extensionId.slice(0, 8)}…)
                </span>
              </>
            ) : (
              <span className="dab-muted">
                Live Looker Data App preview will appear here after the first turn
              </span>
            )}
          </div>
          <div className="dab-preview-actions">
            {builderMode !== 'dashboard' && currentAppCode && (
              <button
                type="button"
                data-testid="preview-view-code-btn"
                className="dab-btn-secondary"
                onClick={() => setShowAppCode((v) => !v)}
              >
                {showAppCode ? 'Hide app.js' : '{ } View app.js'}
              </button>
            )}
            {activePreviewId && (
              <>
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => setIframeRev((r) => r + 1)}
                >
                  Reload Preview
                </button>
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => extensionSDK.openBrowserWindow(openInLookerPath, '_blank')}
                >
                  Open in Looker ↗
                </button>
              </>
            )}
            <UseCaseInfoTrigger
              useCase={builderMode === 'dashboard' ? 'dashboard' : 'app'}
              onOpen={setInfoModalUseCase}
            />
          </div>
        </div>
      )}

      {showAppCode && currentAppCode && builderMode !== 'dashboard' && (
        <div className="dab-code-drawer" data-testid="preview-app-code-drawer" style={{ padding: 12, background: 'var(--dab-code-bg, #0f172a)', color: '#e2e8f0', borderBottom: '1px solid var(--dab-border, #e2e8f0)', maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
          <div className="dab-inspector-bar">
            <strong>app.js ({currentAppCode.length} B)</strong>
            <button type="button" className="dab-btn-secondary" onClick={() => navigator.clipboard?.writeText(currentAppCode)}>Copy app.js</button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{currentAppCode}</pre>
        </div>
      )}

      <div
        className="dab-iframe-container"
        data-testid="ca-embed-preview"
        style={isTileMode ? { display: 'none' } : undefined}
      >
        <div
          ref={embedContainerRef}
          data-testid="looker-embed-container"
          className="dab-embed-container"
          style={{
            width: '100%',
            height: '100%',
            display: hasActiveEmbed ? 'block' : 'none',
          }}
        />
        {isHealthCheckMode ? (
          healthReport ? (
            <div className="dab-tdd-viewer">
              {tddViewMode === 'rendered' ? (
                <div
                  className="dab-tdd-rendered"
                  dangerouslySetInnerHTML={{
                    __html: renderTddMarkdownToHtml(healthReport.tddMarkdown),
                  }}
                />
              ) : (
                <pre className="dab-tdd-markdown">{healthReport.tddMarkdown}</pre>
              )}
            </div>
          ) : (
            <div className="dab-placeholder">
              <p>No 3-Pillar Health Check report loaded yet.</p>
              <p className="dab-muted">
                Click <strong>✨ Run 3-Pillar Audit</strong> in the top-right bar or enter a
                prompt on the left to execute Pillar 1 (System Activity), Pillar 2 (LookML 0–4
                Transcriber Rubric), and Pillar 3 (BigQuery INFORMATION_SCHEMA) in{' '}
                <code>LkrCodeMode</code>.
              </p>
            </div>
          )
        ) : isLookmlMode ? (
          <LookmlPreviewPane
            bundle={lookmlBundle}
            hostUrl={hostUrl}
            extensionSDK={extensionSDK}
            canDeploy={canDeployLookml}
          />
        ) : isCaMode || caConversation ? (
          !caConversation && (
            <div className="dab-placeholder">
              <p>No active Conversational Analytics chat yet.</p>
              <p className="dab-muted">
                Ask a data question on the left — a stateless isolated sub-agent will select the
                best Looker CA Agent, create the conversation, and embed it here.
              </p>
            </div>
          )
        ) : (
          !hasActiveEmbed && (
            <div className="dab-placeholder">
              <p>
                {builderMode === 'dashboard'
                  ? 'No active native Looker content yet.'
                  : 'No active Data App yet.'}
              </p>
              <p className="dab-muted">
                {builderMode === 'dashboard'
                  ? 'Ask on the left to build a native Looker UDD, Look, Board, or Schedule via CodeMode, or pick from My Creations.'
                  : 'Enter a prompt on the left to create a new Data App, or load an existing Dashboard ID from the top bar.'}
              </p>
            </div>
          )
        )}
      </div>
    </main>
  )
}
