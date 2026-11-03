import React, { useEffect, useMemo, useRef, useState } from 'react'

import {
  ChattyHostBuilderFactory,
  getEmbedSDK,
  ILookerConnection,
  LookerEmbedExSDK,
  PageChangedEvent,
} from '@looker/embed-sdk'
import {
  Archive,
  ArchiveRestore,
  AtSign,
  BookOpen,
  Brain,
  Check,
  Code2,
  CornerDownRight,
  Database,
  Eye,
  FileText,
  Kanban,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

import {
  AntigravityActivityStep,
  buildDynamicStarterPrompts,
  handleFileInputSelection,
  handleImageClipboardPaste,
  StarterPromptItem,
  stripStarterPromptEmojis,
  STUDIO_THINKING_LEVEL_OPTIONS,
  StudioThinkingLevel,
  StudioUseCase,
} from '../antigravity'
import { renderTddMarkdownToHtml } from '../healthCheck'
import {
  ConversationRecord,
  formatExploreId,
  resolveConversationRelatedContent,
  StudioContentItem,
  StudioContentItemType,
  StudioContextCategory,
  StudioContextMention,
} from '../lookerApi'
import { LOOKML_TURN_SKILLS, LookmlPreviewPane } from '../lookmlTool'
import { StudioController } from '../useStudioController'
import { TilePreviewPane } from './ScriptStudioView'
import {
  StudioBadge,
  StudioButton,
  StudioDocPreview,
  StudioModal,
  StudioSelect,
  StudioSkeleton,
  StudioToolbar,
} from './StudioDesignSystem'

export interface LookerEmbedTarget {
  kind: 'preload' | 'dashboard' | 'look' | 'explore' | 'extension' | 'report' | 'url'
  target: string
  previewMode: 'preload' | 'conversational-analytics' | 'dashboard' | 'data_app'
  previewObjectId: string
  nonce: number
}

export interface LookerEmbedSessionTelemetry {
  hostUrl: string
  state: 'preloaded' | 'dashboard' | 'look' | 'explore' | 'extension' | 'report' | 'url'
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
  activeContentItem?: StudioContentItem | null
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

  const item =
    opts.activeContentItem?.id && opts.activeContentItem?.contentType
      ? opts.activeContentItem
      : opts.builderMode === 'dashboard' && opts.nativeContent
      ? (opts.nativeContent as Partial<StudioContentItem> & { id: string; contentType: string })
      : null
  if (item) {
    const ct = item.contentType
    if (ct === 'dashboard' || ct === 'lookml_dashboard') {
      const id = String(item.lookmlDashboardId || item.dashboardId || item.id)
      return { kind: 'dashboard', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    if (ct === 'data_app' || ct === 'data-investigator') {
      const id = String(item.dashboardId || item.id)
      return { kind: 'dashboard', target: id, previewMode: 'data_app', previewObjectId: id, nonce }
    }
    if (ct === 'look') {
      const id = String(item.lookId || item.id)
      return { kind: 'look', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    if (ct === 'explore') {
      const rawId = String(item.exploreId || item.id)
      return {
        kind: 'explore',
        target: rawId.replace('::', '/'),
        previewMode: 'dashboard',
        previewObjectId: rawId,
        nonce,
      }
    }
    if (ct === 'extension') {
      const id = String(item.extensionId || item.id)
      return { kind: 'extension', target: id, previewMode: 'data_app', previewObjectId: id, nonce }
    }
    if (ct === 'report') {
      const id = String(item.id)
      return { kind: 'report', target: id, previewMode: 'dashboard', previewObjectId: id, nonce }
    }
    const isCa = ct === 'conversational-analytics'
    const id = String(item.lookmlDashboardId || item.id)
    const rawUrl =
      item.embedPath || `/embed/${isCa ? 'conversations' : 'boards'}/${encodeURIComponent(id)}`
    return {
      kind: 'url',
      target: normalizeLookerEmbedUrl(rawUrl, opts.hostUrl),
      previewMode: isCa ? 'conversational-analytics' : 'dashboard',
      previewObjectId: id,
      nonce,
    }
  }

  if ((opts.isCaMode || opts.caConversation) && opts.caConversation?.embedPath) {
    return {
      kind: 'url',
      target: normalizeLookerEmbedUrl(opts.caConversation.embedPath, opts.hostUrl),
      previewMode: 'conversational-analytics',
      previewObjectId: opts.caConversation.caConversationId,
      nonce,
    }
  }
  if (opts.builderMode === 'dashboard') return preload
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
      window.__LOOKER_EMBED_STATE__ = {
        ...telemetry,
        events: [...telemetry.events],
        calls: [...telemetry.calls],
      }
    }
  }

  if (typeof window === 'undefined') {
    ;(globalThis as Record<string, unknown>).window = {
      location: { origin: opts.hostUrl || 'https://looker.example.com' },
      setTimeout,
      clearTimeout,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  }

  const chattyHostCreator = (initialUrl: string) => {
    const handlers: Record<string, Array<(payload?: Record<string, unknown>) => void>> = {}
    let targetEl: HTMLElement | null = opts.container
    const emit = (evt: string, payload: Record<string, unknown> = {}) =>
      (handlers[evt] || []).forEach((fn) => fn(payload))
    const noop = () => builder
    const builder = {
      on: (evt: string, fn: (payload?: Record<string, unknown>) => void) => {
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
        const iframe: Partial<HTMLIFrameElement> & {
          setAttribute?: (k: string, v: string) => void
          removeAttribute?: (k: string) => void
          getAttribute?: (k: string) => string | null
          classList?: { add: (c: string) => void }
        } =
          targetEl?.querySelector?.('iframe') ||
          (doc
            ? doc.createElement('iframe')
            : {
                setAttribute: () => {},
                removeAttribute: () => {},
                getAttribute: () => '',
                classList: { add: () => {} },
                style: {} as CSSStyleDeclaration,
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
        if (doc && targetEl && iframe.parentNode !== targetEl) {
          targetEl.appendChild(iframe as HTMLIFrameElement)
        }
        const connectedHost = {
          send: (event: string) => {
            if (event === 'dashboard:run') {
              syncIframe(iframe.getAttribute?.('src') || initialUrl)
              emit('dashboard:run:start')
              emit('dashboard:run:complete')
            }
          },
          sendAndReceive: async (event: string, payload?: { url?: string }) => {
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
    ? getEmbedSDK(new LookerEmbedExSDK(chattyHostCreator as unknown as ChattyHostBuilderFactory))
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
    .on('page:changed', (e: PageChangedEvent) => {
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
      const recordLoad = async (method: string, arg: string, p: Promise<unknown>) => {
        telemetry.calls.push({ method, arg })
        telemetry.loadCount += 1
        await p
      }
      if (next.kind === 'preload') {
        if (prev && prev.kind !== 'preload') {
          await recordLoad('loadUrl', '/preload', connection.loadUrl({ url: '/preload', options }))
        }
      } else if (next.kind === 'dashboard') {
        if (isSameTarget && prev.nonce !== next.nonce) {
          try {
            telemetry.calls.push({ method: 'asDashboardConnection.run', arg: next.target })
            connection.asDashboardConnection().run()
          } catch {
            await recordLoad('loadDashboard', next.target, connection.loadDashboard({ id: next.target, options }))
          }
        } else {
          await recordLoad('loadDashboard', next.target, connection.loadDashboard({ id: next.target, options }))
        }
      } else if (next.kind === 'look') {
        await recordLoad('loadLook', next.target, connection.loadLook({ id: next.target, options }))
      } else if (next.kind === 'explore') {
        const exploreId = next.target.replace('::', '/')
        await recordLoad('loadExplore', exploreId, connection.loadExplore({ id: exploreId, options }))
      } else if (next.kind === 'extension') {
        await recordLoad('loadExtension', next.target, connection.loadExtension({ id: next.target, options }))
      } else if (next.kind === 'report') {
        await recordLoad('loadReport', next.target, connection.loadReport({ id: next.target, options }))
      } else {
        await recordLoad('loadUrl', next.target, connection.loadUrl({ url: next.target, options }))
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
  PublishDashboardButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Publish Dashboard</button>,
  ScheduleScriptButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Schedule Script</button>,
  SaveScriptButton: () => <button type="button" className="dab-btn-secondary" tabIndex={-1}>Save Script</button>,
  RunPythonButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Run Python</button>,
  ScriptModeSelect: () => (
    <StudioSelect
      className="dab-select"
      value="summary"
      onChange={() => {}}
      options={[
        { value: 'summary', label: 'summary' },
        { value: 'detailed_audit', label: 'detailed_audit' },
        { value: 'anomaly_alert', label: 'anomaly_alert' },
      ]}
    />
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
  PushLookmlButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Update LookML</button>,
  ExportHealthTddButton: () => <button type="button" className="dab-btn-gemini" tabIndex={-1}>Download Markdown (.md)</button>,
  DataInvestigatorPreview: () => (
    <div className="dab-skill-bar" data-testid="data-investigator-doc-slides-preview">
      <span className="dab-skill-label">Narrative View:</span>
      <button type="button" className="dab-skill-chip active" tabIndex={-1}>Doc View</button>
      <button type="button" className="dab-skill-chip" tabIndex={-1}>Slides View</button>
    </div>
  ),
}

export const USE_CASE_BADGES: Record<StudioUseCase, { label: string; className: string }> = {
  auto: { label: 'Auto', className: 'dab-use-case-badge-auto' },
  dashboard: { label: 'Content Studio', className: 'dab-use-case-badge-dashboard' },
  'conversational-analytics': {
    label: 'Conversational Analytics',
    className: 'dab-use-case-badge-ca',
  },
  app: { label: 'Data App', className: 'dab-use-case-badge-app' },
  'data-investigator': {
    label: 'Data Investigator',
    className: 'dab-use-case-badge-investigator',
  },
  'health-check': { label: 'Health Check', className: 'dab-use-case-badge-health' },
  lookml: { label: 'LookML', className: 'dab-use-case-badge-lookml' },
  tile: { label: 'Script', className: 'dab-use-case-badge-tile' },
}

export const USE_CASE_GUIDES: Record<StudioUseCase, { title: string; tabLabel: string; markdown: string }> = {
  auto: {
    title: 'Auto — Smart Looker Agent Routing Guide',
    tabLabel: 'Auto',
    markdown: [
      '# Automatic Workflow Discovery',
      '**Auto** analyzes what you want to accomplish and automatically routes your request to the best Looker workflow allowed by your Looker permissions.',
      '## What You Can Do Across Each Use Case',
      '- **Agentic LookML**: Author, validate, and test LookML views, explores, refinements, and field descriptions in your development branch.',
      '- **Content Studio**: Create and update native Looker User-Defined Dashboards (UDDs), Saved Looks, Boards, and Scheduled Plans.',
      '- **Conversational Analytics**: Ask natural-language data questions and explore trends with Looker Conversational Analytics agents.',
      '- **Data App**: Build custom interactive Looker Data Apps with KPI cards, charts, tables, and metric switchers, or convert pasted screenshots into live apps.',
      '- **Data Investigator**: Generate point-in-time root-cause narrative Data Apps in Google Doc or Google Presentation (Slides) format with Key Driver Analysis, LookML drill paths (`limit: 500`), and fixed date windows.',
      '- **Health Check**: Run a 3-Pillar Looker and BigQuery audit covering System Activity performance, LookML maturity, and warehouse efficiency.',
      '- **Python Tile (Script)**: Write, test, publish, and schedule custom Python data scripts that run as interactive dashboard tiles.',
    ].join('\n'),
  },
  lookml: {
    title: 'Agentic LookML — Modeling, Validation & Data Tests',
    tabLabel: 'Agentic LookML',
    markdown: [
      '# Agentic LookML Modeling & Validation',
      'Author and refine LookML models, views, explores, field descriptions, and data tests in your Looker development workspace with automated SQL and Explore parity checks.',
      '## Focus Your Turn with LookML Skills',
      '<LookmlTurnSkills />',
      'Toggle specialized skills before sending your prompt to steer field descriptions, data test assertions, Explore parity verification, or layered view refinements.',
      '## Review Diffs & Update LookML',
      '<PushLookmlButton />',
      '- Inspect side-by-side LookML diffs, validator results, and query parity checks in the preview pane.',
      '- Push validated updates directly to your active Looker development branch.',
    ].join('\n'),
  },
  dashboard: {
    title: 'Content Studio — Native Dashboards, Looks, Boards & Schedules',
    tabLabel: 'Content Studio',
    markdown: [
      '# Native Looker Content Studio',
      'Create, organize, and update native Looker User-Defined Dashboards (UDDs), Saved Looks, Boards, and Scheduled Plans directly from natural-language prompts.',
      '## Preview & Refresh Controls',
      '<ReloadPreviewButton />',
      'Refreshes the embedded Looker dashboard or Saved Look in the live preview pane after changes are applied.',
      '### Open Native Content in Looker',
      '<OpenInLookerButton />',
      '- Launches your dashboard, Look, or Board in a new Looker browser tab.',
      '- Save content to your personal folder or any shared folder you have permission to edit.',
    ].join('\n'),
  },
  'conversational-analytics': {
    title: 'Conversational Analytics — Natural-Language Data Q&A',
    tabLabel: 'Conversational Analytics',
    markdown: [
      '# Looker Conversational Analytics',
      'Ask ad-hoc analytical questions in plain language, automatically match with the best Looker Conversational Analytics agent for your data, and explore interactive answers.',
      '## Embedded Conversation Controls',
      '<ReloadPreviewButton />',
      'Reloads the embedded Looker Conversational Analytics session in the preview pane.',
      '### Open Conversation in Looker',
      '<OpenInLookerButton />',
      '- Opens the full Looker Conversational Analytics thread in a new browser tab.',
      '- Shows the matched analytics agent and target Explore scope above the conversation.',
    ].join('\n'),
  },
  app: {
    title: 'Data App — Custom Interactive Looker Applications',
    tabLabel: 'Data App',
    markdown: [
      '# Interactive Looker Data Apps',
      'Build custom interactive applications with KPI scorecards, dynamic charts, data grids, and metric switchers published directly into a Looker dashboard tile.',
      '## Live Preview Controls',
      '<ReloadPreviewButton />',
      'Re-runs the live Looker dashboard preview in place so you can test interactive filters and controls immediately.',
      '### Open Published App in Looker',
      '<OpenInLookerButton />',
      '- Opens the published Looker dashboard hosting your Data App in a new browser tab.',
      '- Paste a mockup or screenshot (`Cmd+V`) into the composer to turn a visual design into a working Data App.',
    ].join('\n'),
  },
  'data-investigator': {
    title: 'Data Investigator — Google Doc & Slides Root-Cause Narrative Apps',
    tabLabel: 'Data Investigator',
    markdown: [
      '# Point-in-Time Root-Cause Narrative Data Apps',
      'Investigate metric changes and anomalies using Looker Key Driver Analysis (`run_key_driver_analysis`), LookML `drill_fields` (`limit: 500`), and fixed point-in-time date ranges (`YYYY-MM-DD to YYYY-MM-DD`).',
      '## Google Doc (Default) & Google Presentation (Slides) Modes',
      '<DataInvestigatorPreview />',
      '- **Doc View (Default)**: Renders an executive overview followed by sequential **Chart -> What This Chart Means -> Next Investigation Path** chapters and a 500-row evidence grid.',
      '- **Slides View**: Mention `slides`, `presentation`, or `deck` in your prompt (or toggle in the app header) to present each drill step as a self-contained slide with keyboard arrow navigation.',
      '### Live Preview & Looker Launch Controls',
      '<ReloadPreviewButton />',
      '<OpenInLookerButton />',
    ].join('\n'),
  },
  'health-check': {
    title: 'Health Check — 3-Pillar Looker & BigQuery Audit',
    tabLabel: 'Health Check',
    markdown: [
      '# 3-Pillar Looker & BigQuery Health Check',
      'Run a comprehensive audit across **Pillar 1** (System Activity query latency and caching), **Pillar 2** (LookML modeling quality and best practices), and **Pillar 3** (BigQuery slot usage and storage partitioning).',
      '## Export Technical Design Document (TDD)',
      '<ExportHealthTddButton />',
      '- Downloads a complete Markdown Technical Design Document with prioritized recommendations, SQL optimizations, and estimated impact.',
      '- Switch between the formatted **Rendered Report** and **`{ } Raw Markdown`**, or copy the report to your clipboard.',
    ].join('\n'),
  },
  tile: {
    title: 'Python Tile (Script) — Custom Data Scripts & Scheduling',
    tabLabel: 'Script',
    markdown: [
      '# Publish As Dashboard',
      '<PublishDashboardButton />',
      'Publishes your Python script as an interactive Looker dashboard tile in your selected folder so teammates can view and filter its output.',
      '## Execute & Test Script Mode',
      '<RunPythonButton />',
      '<ScriptModeSelect />',
      'Runs your Python script in the in-browser sandbox and lets you switch execution modes (`summary`, `detailed_audit`, `anomaly_alert`) with live dashboard filter values.',
      '## Save & Schedule Recurring Runs',
      '<SaveScriptButton />',
      '<ScheduleScriptButton />',
      '- **Save Script**: Saves your latest script code and configuration so you can reuse or publish it anytime.',
      '- **Schedule Script**: Configures recurring cron schedules, execution modes, and automated delivery for your script.',
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
    return renderFn ? StudioDocPreview({ key, component: compName, children: renderFn() }) : null
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
  const guide = (activeUseCase && USE_CASE_GUIDES[activeUseCase]) || USE_CASE_GUIDES.auto
  return (
    <StudioModal
      open={Boolean(activeUseCase)}
      onClose={onClose}
      testId="use-case-info-modal"
      closeTestId="use-case-info-close-btn"
      closeLabel="Close"
      className="dab-use-case-info-modal"
      title={guide.title}
      subtitle="Interactive guide & live-themed UI controls reference (non-actionable preview)"
    >
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

      <div className="dab-use-case-guide-body" data-testid="use-case-info-mdx-body">
        {renderUseCaseGuideMarkdown(guide.markdown)}
      </div>
    </StudioModal>
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
              {isArchived ? <ArchiveRestore size={14} strokeWidth={1.75} aria-hidden="true" /> : <Archive size={14} strokeWidth={1.75} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="dab-conv-action-btn dab-conv-delete-btn"
              data-testid={`delete-conv-${conv.id}`}
              onClick={(e) => handleRequestDeleteConversation(e, conv)}
              title="Delete conversation"
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="dab-conv-item-label">{conv.label}</div>
      </div>
    )
  }

  const relatedInfo = pendingDeleteConv ? resolveConversationRelatedContent(pendingDeleteConv, userId) : null
  const hostUrl = (ctl.extensionSDK?.lookerHostData?.hostUrl || ctl.lookerHostData?.hostUrl || '').replace(/\/$/, '')

  return (
    <nav className={`dab-conv-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} data-testid="conversations-sidebar" aria-label="Previous Conversations">
      <div className="dab-conv-sidebar-header">
        <button
          type="button" className="dab-conv-collapse-btn" data-testid="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          title={sidebarCollapsed ? 'Expand conversations sidebar' : 'Collapse conversations sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
        {!sidebarCollapsed && <strong className="dab-conv-sidebar-title">Conversations ({conversations.length})</strong>}
      </div>

      <div className="dab-conv-sidebar-actions">
        <button
          type="button" className="dab-conv-new-btn" data-testid="new-conversation-btn"
          onClick={() => handleNewConversation('auto')} disabled={!!busyStatus} title="Start a new conversation"
        >
          {sidebarCollapsed ? '+' : '+ New Conversation'}
        </button>
      </div>

      {!sidebarCollapsed && (
        <div className="dab-conv-list">
          {conversations.length === 0 ? <div className="dab-conv-empty">No previous conversations yet.</div> : conversations.map((conv) => renderConversationRow(conv, false))}
          <div className="dab-conv-archived-section">
            <button type="button" className="dab-conv-archived-toggle" data-testid="toggle-archived-convs" onClick={() => setShowArchivedConversations((prev) => !prev)}>
              {showArchivedConversations ? `Hide Archived (${archivedConversations.length})` : `Show Archived (${archivedConversations.length})`}
            </button>
            {showArchivedConversations && (
              <div className="dab-conv-archived-list" data-testid="archived-conversations-list">
                {archivedConversations.length === 0 ? <div className="dab-conv-empty">No archived conversations.</div> : archivedConversations.map((conv) => renderConversationRow(conv, true))}
              </div>
            )}
          </div>
        </div>
      )}

      <StudioModal
        open={Boolean(pendingDeleteConv && relatedInfo)}
        onClose={handleCancelDeleteConversation}
        testId="delete-conv-modal"
        title="Delete Conversation?"
        footer={
          <>
            <button type="button" className="dab-btn-secondary" data-testid="cancel-delete-conv-btn" onClick={handleCancelDeleteConversation}>Cancel</button>
            <button type="button" className="dab-btn-secondary" data-testid="confirm-delete-conv-only-btn" onClick={() => handleConfirmDeleteConversation(false)}>Delete Conversation Only</button>
            <button type="button" className="dab-btn-danger" data-testid="confirm-delete-conv-and-content-btn" onClick={() => handleConfirmDeleteConversation(true)}>Delete Conversation &amp; Related Content</button>
            <button type="button" className="dab-btn-primary" data-testid="confirm-delete-conv-btn" onClick={() => handleConfirmDeleteConversation()}>Confirm Delete</button>
          </>
        }
      >
        {pendingDeleteConv && relatedInfo && (
          <div className="dab-modal-body" style={{ padding: 0 }}>
            <p style={{ margin: '0 0 8px' }}>
              Remove <strong>{pendingDeleteConv.label}</strong> (<code>{pendingDeleteConv.type}</code>)
              from your conversation history (<code>user_conversations:{userId || '1'}</code>
              {relatedInfo.userIndexKeys[0] ? ` and ${relatedInfo.userIndexKeys[0]}` : ''})?
            </p>
            {relatedInfo.items.length > 0 && (
              <div className="dab-modal-related-box" data-testid="delete-conv-related-summary">
                <strong>Linked Looker &amp; Shared Artifact Content:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {relatedInfo.items.map((item, idx) => {
                    const matchedLink = relatedInfo.relatedLinks?.find((l) => l.itemText === item)
                    return (
                      <li key={idx}>
                        {matchedLink ? (
                          <a data-testid={`delete-modal-content-link-${idx}`} href={`${hostUrl}${matchedLink.path}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--dab-accent)', textDecoration: 'underline' }}>{item}</a>
                        ) : item}
                      </li>
                    )
                  })}
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
        )}
      </StudioModal>
    </nav>
  )
}

export { buildDynamicStarterPrompts, stripStarterPromptEmojis }
export type { StarterPromptItem }

export const STARTER_PROMPTS_BY_USE_CASE: Record<string, StarterPromptItem[]> = Object.fromEntries(
  ([
    'auto',
    'app',
    'data-investigator',
    'dashboard',
    'conversational-analytics',
    'health-check',
    'lookml',
    'tile',
  ] as const).map((uc) => [uc, buildDynamicStarterPrompts({ useCase: uc })])
)
STARTER_PROMPTS_BY_USE_CASE.health = STARTER_PROMPTS_BY_USE_CASE['health-check']
STARTER_PROMPTS_BY_USE_CASE.investigator = STARTER_PROMPTS_BY_USE_CASE['data-investigator']
STARTER_PROMPTS_BY_USE_CASE.data_investigator = STARTER_PROMPTS_BY_USE_CASE['data-investigator']

export function getStarterPromptsForUseCase(
  useCase?: string,
  selectedExplores?: string[],
  permittedUseCases?: StudioUseCase[]
): StarterPromptItem[] {
  if (
    (selectedExplores && selectedExplores.length > 0) ||
    (permittedUseCases && permittedUseCases.length > 0)
  ) {
    return buildDynamicStarterPrompts({
      useCase,
      selectedExplores,
      permittedUseCases,
    })
  }
  const key = String(useCase || 'auto').trim().toLowerCase()
  return STARTER_PROMPTS_BY_USE_CASE[key] || STARTER_PROMPTS_BY_USE_CASE.auto
}

export const StarterPromptButtons: React.FC<{
  useCase?: string
  prompts?: StarterPromptItem[]
  loading?: boolean
  onSelect: (promptText: string) => void
  disabled?: boolean
}> = ({ useCase, prompts, loading, onSelect, disabled }) => {
  const items = prompts && prompts.length > 0 ? prompts : getStarterPromptsForUseCase(useCase)
  if (loading && (!prompts || prompts.length === 0)) {
    return (
      <div
        className="dab-starter-prompts"
        data-testid="studio-starter-prompts-skeleton"
        aria-busy="true"
      >
        {[0, 1, 2].map((i) => (
          <StudioSkeleton
            key={i}
            width={188}
            height={28}
            style={{ borderRadius: 999 }}
            label="Loading starter prompt..."
          />
        ))}
      </div>
    )
  }
  return (
    <div className="dab-starter-prompts" data-testid="studio-starter-prompts">
      <div data-testid="starter-prompt-list" style={{ display: 'contents' }}>
        {items.map((item, i) => (
          <StudioButton
            key={item.id || `starter-${i}`}
            variant="secondary"
            testId={`starter-prompt-${i}`}
            data-prompt-id={item.id}
            data-use-case={item.useCase || useCase || 'auto'}
            className="dab-starter-chip"
            disabled={disabled}
            onClick={() => onSelect(item.prompt)}
            title={item.prompt}
          >
            {stripStarterPromptEmojis(item.label)}
          </StudioButton>
        ))}
      </div>
    </div>
  )
}

const AT_MENTION_DETECT_RE = /(?:^|\s)@(?:(explore|dashboard|look|conversation):([^\n@]*)|([^\s@]*))$/i

function renderMentionCategoryIcon(type: StudioContextCategory) {
  if (type === 'explore') return <Database size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'dashboard') return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  if (type === 'look') return <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
  return <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
}

export const StudioComposer: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    core40SDK,
    models,
    selectedExplores,
    setSelectedExplores,
    preloadedContent,
    mentionedItems,
    setMentionedItems,
    searchGlobalContentV2,
    allConversations,
    conversations,
    activeMode,
    builderMode,
    isLookmlMode,
    isHealthCheckMode,
    isCaMode,
    caConversation,
    selectedUseCase,
    selectedModel,
    setSelectedModel,
    thinkingLevel,
    setThinkingLevel,
    availableModels,
    busyStatus,
    activatedLookmlSkills,
    setActivatedLookmlSkills,
    pastedImages,
    setPastedImages,
    prompt,
    setPrompt,
    handleSendPrompt,
    queuedPrompts,
    handleStopTurn,
    handleQueuePrompt,
    handleRemoveQueuedPrompt,
    handleInterjectPrompt,
    isAuthenticated,
    authMode,
    clientId,
    oauthSigningIn,
    handleOAuthLogin,
    history,
    lookmlBundle,
    nativeContent,
    infoModalUseCase,
    setInfoModalUseCase,
  } = ctl

  const mockExt =
    typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const addMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const mentionMenuRef = useRef<HTMLDivElement | null>(null)

  const [addContextOpen, setAddContextOpen] = useState(false)
  const [cursorPos, setCursorPos] = useState<number>(() => prompt.length)
  const [forceMentionCategory, setForceMentionCategory] = useState<StudioContextCategory | 'all' | null>(
    () => (mockExt?.initialComboOpen ? 'explore' : null)
  )
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [remoteSearchResults, setRemoteSearchResults] = useState<StudioContextMention[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)

  useEffect(() => {
    setCursorPos((prev) => Math.min(prev, prompt.length))
  }, [prompt.length])

  const detectedMention = useMemo(() => {
    const uptoCursor = prompt.slice(0, cursorPos || prompt.length)
    const m = uptoCursor.match(AT_MENTION_DETECT_RE)
    if (m) {
      const category = (m[1]?.toLowerCase() as StudioContextCategory | undefined) || 'all'
      const query = (m[1] ? m[2] || '' : m[3] || '').trim()
      const atIdx = uptoCursor.lastIndexOf('@')
      return { open: true, category, query, tokenStart: atIdx >= 0 ? atIdx : uptoCursor.length, tokenEnd: uptoCursor.length }
    }
    return {
      open: forceMentionCategory !== null,
      category: forceMentionCategory ?? ('all' as const),
      query: '',
      tokenStart: prompt.length,
      tokenEnd: prompt.length,
    }
  }, [prompt, cursorPos, forceMentionCategory])

  useEffect(() => {
    if (
      detectedMention.open &&
      mentionMenuRef.current &&
      typeof mockExt?.initialExploreScrollTop === 'number'
    ) {
      mentionMenuRef.current.scrollTop = mockExt.initialExploreScrollTop
    }
  }, [detectedMention.open, models.length, mockExt?.initialExploreScrollTop])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (addMenuWrapRef.current && !addMenuWrapRef.current.contains(e.target as Node)) {
        setAddContextOpen(false)
      }
      if (
        mentionMenuRef.current &&
        !mentionMenuRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setForceMentionCategory(null)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  useEffect(() => {
    if (!detectedMention.open || !detectedMention.query) {
      setMentionLoading(false)
      setRemoteSearchResults([])
      return
    }
    let cancelled = false
    setMentionLoading(true)
    const timer = setTimeout(() => {
      searchGlobalContentV2(core40SDK, {
        term: detectedMention.query,
        category: detectedMention.category,
        limit: 15,
      })
        .then((items) => {
          if (!cancelled) setRemoteSearchResults(items)
        })
        .catch(() => {
          if (!cancelled) setRemoteSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setMentionLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [core40SDK, detectedMention.open, detectedMention.query, detectedMention.category, searchGlobalContentV2])

  const groupedExplores = useMemo(() => {
    const tokens = detectedMention.query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    return models
      .reduce(
        (
          acc: Array<{
            label: string
            modelName: string
            options: Array<{ label: string; value: string; mention: StudioContextMention }>
          }>,
          model
        ) => {
          if (model?.explores?.length) {
            const matchingExplores = model.explores.filter((explore) => {
              if (explore.hidden) return false
              if (tokens.length === 0) return true
              const expId = formatExploreId(model.name, String(explore.name))
              const haystack = `${model.label} ${model.name} ${explore.label || ''} ${explore.name} ${expId}`.toLowerCase()
              return tokens.every((tk) => haystack.includes(tk))
            })
            if (matchingExplores.length > 0) {
              acc.push({
                label: model.label || model.name,
                modelName: model.name,
                options: matchingExplores
                  .map((explore) => {
                    const value = formatExploreId(model.name, String(explore.name))
                    const label = String(explore.label || explore.name)
                    return {
                      label,
                      value,
                      mention: {
                        type: 'explore' as const,
                        id: value,
                        title: label,
                        subtitle: String(model.label || model.name),
                        model: model.name,
                        explore: String(explore.name),
                        description: explore.description ? String(explore.description) : undefined,
                      },
                    }
                  })
                  .sort((a, b) => a.label.localeCompare(b.label)),
              })
            }
          }
          return acc
        },
        []
      )
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [models, detectedMention.query])

  const exploreLookup = useMemo(() => {
    const map: Record<string, { id: string; label: string; modelLabel: string; model: string; explore: string }> = {}
    for (const model of models) {
      for (const explore of model.explores || []) {
        if (explore.hidden) continue
        const id = formatExploreId(model.name, String(explore.name))
        map[id] = {
          id,
          label: String(explore.label || explore.name),
          modelLabel: String(model.label || model.name),
          model: model.name,
          explore: String(explore.name),
        }
      }
    }
    return map
  }, [models])

  const mentionOptions = useMemo(() => {
    const tokens = detectedMention.query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    const matchTokens = (text: string) =>
      tokens.length === 0 || tokens.every((tk) => text.toLowerCase().includes(tk))

    const cat = detectedMention.category
    const seen = new Set<string>()
    const out: StudioContextMention[] = []
    const pushItem = (item: StudioContextMention) => {
      const key = `${item.type}:${item.id}`
      if (seen.has(key)) return
      seen.add(key)
      out.push(item)
    }

    if (cat === 'all' || cat === 'explore') {
      for (const group of groupedExplores) {
        for (const opt of group.options) {
          pushItem(opt.mention)
        }
      }
      for (const r of remoteSearchResults) {
        if (r.type === 'explore') pushItem(r)
      }
    }

    for (const contentType of ['dashboard', 'look'] as const) {
      if (cat === 'all' || cat === contentType) {
        for (const item of preloadedContent) {
          if (item.type === contentType && matchTokens(`${item.title} ${item.id} ${item.description || ''}`)) {
            pushItem(item)
          }
        }
        for (const r of remoteSearchResults) {
          if (r.type === contentType) pushItem(r)
        }
      }
    }

    if (cat === 'all' || cat === 'conversation') {
      const convList = allConversations || conversations || []
      for (const c of convList) {
        const label = c.label || c.id
        if (matchTokens(`${label} ${c.id} ${c.type || ''}`)) {
          pushItem({
            type: 'conversation',
            id: c.id,
            title: label,
            subtitle: c.use_case || c.type || 'conversation',
          })
        }
      }
      for (const r of remoteSearchResults) {
        if (r.type === 'conversation') pushItem(r)
      }
    }

    return out
  }, [
    detectedMention.category,
    detectedMention.query,
    groupedExplores,
    preloadedContent,
    remoteSearchResults,
    allConversations,
    conversations,
  ])

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [detectedMention.category, detectedMention.query, mentionOptions.length])

  const contextChips = useMemo(() => {
    const seen = new Set<string>()
    const chips: StudioContextMention[] = []
    for (const item of mentionedItems) {
      const key = `${item.type}:${item.id}`
      if (!seen.has(key)) {
        seen.add(key)
        chips.push(item)
      }
    }
    for (const expId of selectedExplores) {
      const key = `explore:${expId}`
      if (!seen.has(key)) {
        seen.add(key)
        const info = exploreLookup[expId]
        chips.push({
          type: 'explore',
          id: expId,
          title: info ? `${info.modelLabel}: ${info.label}` : expId,
          model: info?.model,
          explore: info?.explore,
        })
      }
    }
    return chips
  }, [mentionedItems, selectedExplores, exploreLookup])

  const handleSelectMentionOption = (item: StudioContextMention) => {
    setMentionedItems((prev) => {
      const exists = prev.some((x) => x.type === item.type && x.id === item.id)
      return exists ? prev : [...prev, item]
    })
    if (item.type === 'explore') {
      setSelectedExplores((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
    }
    const replacement = `@${item.type}:${item.title} `
    const prefix = prompt.slice(0, detectedMention.tokenStart)
    const suffix = prompt.slice(detectedMention.tokenEnd)
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
    const nextPrompt = `${prefix}${needsLeadingSpace ? ' ' : ''}${replacement}${suffix}`
    setPrompt(nextPrompt)
    const nextPos = (prefix + (needsLeadingSpace ? ' ' : '') + replacement).length
    setCursorPos(nextPos)
    setForceMentionCategory(null)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextPos, nextPos)
      }
    })
  }

  const handleRemoveContextChip = (chip: StudioContextMention) => {
    setMentionedItems((prev) =>
      prev.filter((x) => !(x.type === chip.type && x.id === chip.id))
    )
    if (chip.type === 'explore') {
      setSelectedExplores((prev) => prev.filter((id) => id !== chip.id))
    }
  }

  const handleInsertScopedPrefix = (category: StudioContextCategory) => {
    setAddContextOpen(false)
    const token = `@${category}:`
    const trimmed = prompt.replace(/\s+$/, '')
    const nextPrompt = trimmed ? `${trimmed} ${token}` : token
    setPrompt(nextPrompt)
    setCursorPos(nextPrompt.length)
    setForceMentionCategory(category)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextPrompt.length, nextPrompt.length)
      }
    })
  }

  const activeGuideUseCase: StudioUseCase =
    isCaMode || caConversation
      ? 'conversational-analytics'
      : isHealthCheckMode
      ? 'health-check'
      : isLookmlMode
      ? 'lookml'
      : activeMode === 'tile'
      ? 'tile'
      : builderMode === 'dashboard'
      ? 'dashboard'
      : selectedUseCase || 'auto'
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) =>
    handleImageClipboardPaste(e, setPastedImages)

  return (
    <div className="dab-composer dab-chatbar">
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

      {contextChips.length > 0 && (
        <div
          className="dab-composer-context-chips"
          data-testid="composer-context-chips"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {contextChips.map((chip) => (
            <span
              key={`${chip.type}:${chip.id}`}
              className="dab-chip"
              data-testid={`composer-context-chip-${chip.type}-${chip.id}`}
              title={`${chip.type}: ${chip.id}`}
            >
              {renderMentionCategoryIcon(chip.type)}
              <span>
                @{chip.type}:{chip.title}
              </span>
              <button
                type="button"
                aria-label={`Remove ${chip.title}`}
                onClick={() => handleRemoveContextChip(chip)}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {pastedImages.length > 0 && (
        <div
          className="dab-composer-attached-files"
          data-testid="composer-attached-files"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {pastedImages.map((img, i) => {
            const isImage = img.mimeType.startsWith('image/')
            return (
              <div
                key={img.id || i}
                className="dab-attached-file-pill"
                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
              >
                {isImage ? (
                  <img
                    src={img.dataUrl}
                    alt={img.name || 'Attached image'}
                    style={{ height: 52, borderRadius: 4, border: '1px solid var(--dab-border)' }}
                  />
                ) : (
                  <span className="dab-chip" title={img.name || 'Attached file'}>
                    <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
                    <span>{img.name || `Attachment ${i + 1}`}</span>
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${img.name || 'attachment'}`}
                  onClick={() => setPastedImages((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    position: isImage ? 'absolute' : 'static',
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
                    marginLeft: isImage ? 0 : 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={11} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {queuedPrompts.length > 0 && (
        <div
          className="dab-queued-prompts-bar"
          data-testid="queued-prompts-bar"
          role="region"
          aria-label="Queued prompts"
        >
          {queuedPrompts.map((q) => (
            <div
              key={q.id}
              className="dab-queued-prompt-item"
              data-testid="queued-prompt-item"
            >
              <CornerDownRight
                size={12}
                strokeWidth={1.75}
                aria-hidden="true"
                className="dab-queued-prompt-icon"
              />
              <span className="dab-queued-prompt-text" title={q.text}>
                {q.text || `${q.images.length} attachment(s)`}
              </span>
              <div className="dab-queued-prompt-actions">
                <button
                  type="button"
                  className="dab-btn-secondary dab-queued-prompt-interject-btn"
                  data-testid={`queued-prompt-interject-${q.id}`}
                  onClick={() => handleInterjectPrompt(q.id)}
                  title="Abort current turn and send this queued message immediately"
                >
                  <Zap size={11} strokeWidth={1.75} aria-hidden="true" />
                  <span>Interject</span>
                </button>
                <button
                  type="button"
                  className="dab-queued-prompt-remove-btn"
                  data-testid={`queued-prompt-remove-${q.id}`}
                  onClick={() => handleRemoveQueuedPrompt(q.id)}
                  aria-label="Remove queued message"
                  title="Remove from queue"
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dab-composer-input-wrap" style={{ position: 'relative' }}>
        {detectedMention.open && (
          <div
            ref={mentionMenuRef}
            className="dab-at-mention-menu dab-dropdown"
            data-testid="composer-at-mention-menu"
            role="listbox"
            aria-label="Looker context mentions"
          >
            <div className="dab-at-mention-header">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <AtSign size={12} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  {detectedMention.category === 'all'
                    ? 'Mention Looker Context (@explore:, @dashboard:, @look:, @conversation:)'
                    : `Mention ${detectedMention.category} (@${detectedMention.category}:${detectedMention.query})`}
                </span>
              </span>
              {mentionLoading && (
                <span
                  data-testid="composer-mention-loading"
                  className="dab-at-mention-spinner"
                  title="Searching Looker via global_search_v2..."
                >
                  <Loader2 size={13} strokeWidth={2} className="dab-spin" aria-hidden="true" />
                </span>
              )}
            </div>

            {selectedExplores.length > 0 &&
              (detectedMention.category === 'all' || detectedMention.category === 'explore') && (
                <div
                  className="dab-option"
                  style={{ color: 'var(--dab-accent)', fontWeight: 600 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedExplores([])
                    setMentionedItems((prev) => prev.filter((x) => x.type !== 'explore'))
                  }}
                >
                  <span>Clear selection (let agent decide)</span>
                </div>
              )}

            {detectedMention.category === 'explore' && !remoteSearchResults.length ? (
              groupedExplores.length === 0 ? (
                <div className="dab-option dab-muted">No matching explores</div>
              ) : (
                groupedExplores.map((group) => (
                  <div key={group.modelName}>
                    <div className="dab-group-header">{group.label}</div>
                    {group.options.map((opt) => {
                      const isSelected = selectedExplores.includes(opt.value)
                      const flatIdx = mentionOptions.findIndex(
                        (m) => m.type === 'explore' && m.id === opt.value
                      )
                      const isHighlighted = flatIdx === activeMentionIndex
                      return (
                        <div
                          key={opt.value}
                          role="option"
                          aria-selected={isSelected || isHighlighted}
                          data-testid={`composer-mention-option-explore-${opt.value}`}
                          className={`dab-option ${
                            isSelected || isHighlighted ? 'dab-option-selected' : ''
                          }`}
                          onMouseEnter={() => {
                            if (flatIdx >= 0) setActiveMentionIndex(flatIdx)
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectMentionOption(opt.mention)
                          }}
                          title={opt.value}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Database size={13} strokeWidth={1.75} aria-hidden="true" />
                            <span>{opt.label}</span>
                          </span>
                          {isSelected && <Check size={13} strokeWidth={2} aria-hidden="true" />}
                        </div>
                      )
                    })}
                  </div>
                ))
              )
            ) : mentionOptions.length === 0 ? (
              <div className="dab-option dab-muted">
                {mentionLoading ? 'Searching Looker...' : 'No matching Looker items'}
              </div>
            ) : (
              mentionOptions.map((item, idx) => {
                const isSelected =
                  (item.type === 'explore' && selectedExplores.includes(item.id)) ||
                  mentionedItems.some((m) => m.type === item.type && m.id === item.id)
                const isHighlighted = idx === activeMentionIndex
                return (
                  <div
                    key={`${item.type}:${item.id}`}
                    role="option"
                    aria-selected={isSelected || isHighlighted}
                    data-testid={`composer-mention-option-${item.type}-${item.id}`}
                    className={`dab-option ${
                      isSelected || isHighlighted ? 'dab-option-selected' : ''
                    }`}
                    onMouseEnter={() => setActiveMentionIndex(idx)}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectMentionOption(item)
                    }}
                    title={`${item.type}: ${item.title} (${item.id})`}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        minWidth: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {renderMentionCategoryIcon(item.type)}
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="dab-muted" style={{ fontSize: 11 }}>
                          · {item.subtitle}
                        </span>
                      )}
                    </span>
                    <span className="dab-muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>
                      {isSelected ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : item.type}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
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
              ? 'Describe a Looker UDD, Look, Board, or Schedule to create or update (type @ to mention context)...'
              : 'Ask your Looker Agent what you want to build, analyze, or automate (type @ to mention Explores, Dashboards, Looks, or Conversations)...'
          }
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value)
            setCursorPos(e.target.selectionStart ?? e.target.value.length)
            if (forceMentionCategory !== null) setForceMentionCategory(null)
          }}
          onClick={(e) => {
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? prompt.length)
          }}
          onKeyUp={(e) => {
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? prompt.length)
          }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (detectedMention.open && mentionOptions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveMentionIndex((i) => (i + 1) % mentionOptions.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (!(e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  const picked = mentionOptions[activeMentionIndex] || mentionOptions[0]
                  if (picked) handleSelectMentionOption(picked)
                  return
                }
              }
            }
            if (e.key === 'Escape' && detectedMention.open) {
              e.preventDefault()
              setForceMentionCategory(null)
              return
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              if (busyStatus) {
                handleQueuePrompt()
              } else {
                void handleSendPrompt()
              }
            }
          }}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="composer-file-input"
        accept="image/*,application/pdf,.csv,.tsv,.json,.sql,.lkml,.lookml,.md,.py,.js,.ts,.tsx,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFileInputSelection(e.target.files, setPastedImages)
          e.target.value = ''
        }}
      />

      <div className="dab-composer-actions">
        <div className="dab-composer-add-wrap" ref={addMenuWrapRef} style={{ position: 'relative' }}>
          <button
            type="button"
            data-testid="composer-add-context-btn"
            className="dab-btn-secondary dab-composer-add-btn"
            onClick={() => setAddContextOpen((prev) => !prev)}
            title="Add files or @-mention Looker Explores, Dashboards, Looks, or Conversations"
            aria-label="Add Context"
            aria-expanded={addContextOpen}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>

          {addContextOpen && (
            <div
              className="dab-composer-add-menu"
              data-testid="composer-add-context-menu"
              role="menu"
              aria-label="Add Context"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="add-context-files"
                className="dab-composer-add-item"
                onClick={() => {
                  setAddContextOpen(false)
                  fileInputRef.current?.click()
                }}
              >
                <Paperclip size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>Files</span>
              </button>
              {([
                ['explore', 'Explores', 'add-context-explores'],
                ['dashboard', 'Dashboards', 'add-context-dashboards'],
                ['look', 'Looks', 'add-context-looks'],
                ['conversation', 'Conversations', 'add-context-conversations'],
              ] as const).map(([cat, label, testId]) => (
                <button
                  key={cat}
                  type="button"
                  role="menuitem"
                  data-testid={testId}
                  className="dab-composer-add-item"
                  onClick={() => handleInsertScopedPrefix(cat)}
                >
                  {renderMentionCategoryIcon(cat)}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <StudioSelect
          data-testid="composer-model-select"
          testId="composer-model-select"
          className="dab-composer-model-select"
          value={selectedModel}
          onChange={setSelectedModel}
          disabled={!!busyStatus}
          ariaLabel="Select Antigravity model"
          title="Select Antigravity model for this turn (/v1beta/models)"
          options={availableModels.map((m) => ({
            value: m.id,
            label: m.label,
            title: m.description,
            subMenu: {
              value: thinkingLevel,
              options: STUDIO_THINKING_LEVEL_OPTIONS,
              onChange: (lvl) => setThinkingLevel(lvl as StudioThinkingLevel),
              testId: 'composer-thinking-level-menu',
            },
          }))}
        />

        <UseCaseInfoTrigger useCase={activeGuideUseCase} onOpen={setInfoModalUseCase} />

        <div
          className="dab-composer-send-group"
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' }}
        >
          {!isAuthenticated && !busyStatus && (
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
          {busyStatus ? (
            <>
              <StudioButton
                variant="secondary"
                testId="studio-queue-btn"
                onClick={handleQueuePrompt}
                disabled={!prompt.trim() && pastedImages.length === 0}
                title="Queue message to run automatically when the current turn finishes (Cmd/Ctrl+Enter)"
              >
                <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>Queue</span>
              </StudioButton>
              <StudioButton
                variant="secondary"
                testId="studio-interject-btn"
                onClick={() => handleInterjectPrompt()}
                disabled={!isAuthenticated || (!prompt.trim() && pastedImages.length === 0)}
                title="Interrupt the running turn and send this message immediately"
              >
                <Zap size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>Interject</span>
              </StudioButton>
              <StudioButton
                variant="danger"
                testId="studio-stop-btn"
                onClick={handleStopTurn}
                title="Stop current turn"
              >
                <Square size={12} strokeWidth={2} aria-hidden="true" />
                <span>Stop</span>
              </StudioButton>
            </>
          ) : (
            <StudioButton
              variant="gemini"
              testId="studio-send-btn"
              onClick={handleSendPrompt}
              disabled={!isAuthenticated || (!prompt.trim() && pastedImages.length === 0)}
            >
              {isCaMode || selectedUseCase === 'conversational-analytics'
                ? caConversation
                  ? 'Ask CA Agent'
                  : 'Route & Start CA Chat'
                : isLookmlMode
                ? lookmlBundle
                  ? 'Update LookML'
                  : 'Run Agentic LookML'
                : activeMode === 'tile'
                ? 'Ask AI'
                : builderMode === 'dashboard'
                ? nativeContent
                  ? 'Update Content'
                  : 'Create / Update Content'
                : 'Send Message'}
            </StudioButton>
          )}
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
    starterPrompts,
    starterPromptsLoading,
    setPrompt,
    busyStatus,
  } = ctl

  return (
    <main className="dab-empty-stage-centered" data-testid="centered-empty-prompt">
      <div className="dab-empty-prompt-card" data-testid="studio-empty-stage">
        <div className="dab-empty-hero">
          <h2>
            {isHealthCheckMode
              ? 'Run a 3-Pillar Looker & BigQuery Health Check'
              : isLookmlMode
              ? 'Author & Validate Agentic LookML'
              : activeMode === 'tile'
              ? 'Author & Schedule a Looker Script'
              : builderMode === 'dashboard'
              ? 'Native Looker Content Builder (UDDs, Looks, Boards, Schedules)'
              : 'Use your Looker Agent'}
          </h2>
          <p className="dab-muted">
            {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
          </p>
          <StarterPromptButtons
            useCase={selectedUseCase}
            prompts={starterPrompts}
            loading={starterPromptsLoading}
            onSelect={setPrompt}
            disabled={!!busyStatus}
          />
        </div>

        <StudioComposer ctl={ctl} />
      </div>
    </main>
  )
}

const STEP_BADGES: Record<string, React.ReactNode> = {
  thought: <><Brain size={13} strokeWidth={1.75} aria-hidden="true" /> Thought</>,
  codemode: <><Code2 size={13} strokeWidth={1.75} aria-hidden="true" /> Code Mode</>,
  cli_bridge: <><Terminal size={13} strokeWidth={1.75} aria-hidden="true" /> CLI Bridge</>,
  file: <><FileText size={13} strokeWidth={1.75} aria-hidden="true" /> File</>,
  skill: <><BookOpen size={13} strokeWidth={1.75} aria-hidden="true" /> Skill</>,
}

function formatActivityStepBadge(step: AntigravityActivityStep): React.ReactNode {
  if (step.kind === 'code_execution') {
    return step.language === 'PYTHON'
      ? <><Code2 size={13} strokeWidth={1.75} aria-hidden="true" /> Sandbox Python</>
      : <><Terminal size={13} strokeWidth={1.75} aria-hidden="true" /> Sandbox Bash</>
  }
  return STEP_BADGES[step.kind] || <><Wrench size={13} strokeWidth={1.75} aria-hidden="true" /> Activity</>
}

function renderActivityStepsList(steps: AntigravityActivityStep[]) {
  return (
    <div className="dab-thinking-steps">
      {steps.map((step, sIdx) => {
        const hasDetail = Boolean(step.detail && step.detail !== step.title)
        const isCollapsibleThought = step.kind === 'thought' && hasDetail
        const StepTag = isCollapsibleThought ? 'details' : 'div'
        const HeaderTag = isCollapsibleThought ? 'summary' : 'div'
        return (
          <StepTag
            key={step.id || sIdx}
            className={`dab-thinking-step dab-thinking-step-${step.kind}`}
            data-step-kind={step.kind}
            data-step-status={step.status || 'done'}
            {...(isCollapsibleThought ? { 'data-testid': 'thinking-step-thought' } : {})}
          >
            <HeaderTag className="dab-thinking-step-header">
              <span className="dab-thinking-kind-badge">{formatActivityStepBadge(step)}</span>
              <span className="dab-thinking-step-title">{step.title}</span>
              {step.status === 'running' && (
                <span className="dab-thinking-step-status">Running…</span>
              )}
            </HeaderTag>
            {hasDetail && <code className="dab-thinking-step-detail">{step.detail}</code>}
          </StepTag>
        )
      })}
    </div>
  )
}

export const StudioLeftPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    messages,
    builderMode,
    selectedUseCase,
    selectedExplores,
    starterPrompts,
    starterPromptsLoading,
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
                  : 'Ask your Looker Agent to build, analyze, or automate across Looker'}
              </strong>
            </p>
            <p className="dab-muted">
              {selectedExplores.length > 0 ? <>Exploring <code>{selectedExplores.join(', ')}</code> — pick a starter prompt below or describe what you want to build.</> : 'Pick a starter prompt below or describe what you want to build, analyze, or automate.'}
            </p>
            <StarterPromptButtons
              useCase={selectedUseCase}
              prompts={starterPrompts}
              loading={starterPromptsLoading}
              onSelect={setPrompt}
              disabled={!!busyStatus}
            />
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

        {busyStatus && (!liveActivitySteps || liveActivitySteps.length === 0) && (
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

function renderContentTabIcon(contentType: StudioContentItemType): React.ReactNode {
  switch (contentType) {
    case 'dashboard':
    case 'lookml_dashboard':
      return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'look':
      return <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'explore':
      return <Database size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'data_app':
    case 'data-investigator':
      return <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'board':
      return <Kanban size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'conversational-analytics':
      return <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'extension':
      return <Code2 size={13} strokeWidth={1.75} aria-hidden="true" />
    case 'report':
      return <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
    default:
      return <LayoutDashboard size={13} strokeWidth={1.75} aria-hidden="true" />
  }
}

export const StudioRightPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode,
    selectedUseCase,
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
    contentItems = [],
    activeContentTabKey = '',
    activeContentItem = null,
    handleSelectContentTab,
    currentAppCode,
    embedNonce,
    extensionSDK,
    setInfoModalUseCase,
    busyStatus,
  } = ctl
  const isTileMode = activeMode === 'tile'

  const hostUrl = extensionSDK?.lookerHostData?.hostUrl || window.location.origin
  const mockExt =
    typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
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
        activeContentItem,
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
      activeContentItem,
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
    activeContentItem?.id ||
    (builderMode === 'dashboard' ? nativeContent?.id : publishedApp?.dashboardId)
  const openInLookerPath = activeContentItem
    ? activeContentItem.embedPath.replace(/^\/embed/, '')
    : builderMode === 'dashboard' && nativeContent
    ? nativeContent.embedPath.replace(/^\/embed/, '')
    : publishedApp
    ? `/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
    : ''
  const hasActiveEmbed = embedTarget.kind !== 'preload'
  const showContentTabs =
    !isTileMode && !isHealthCheckMode && !isLookmlMode && contentItems.length > 0
  const resolvedActiveTabKey = activeContentTabKey || activeContentItem?.key || ''

  return (
    <main className="dab-right-pane" style={isEmptyConversation ? { display: 'none' } : undefined}>
      {showContentTabs && (
        <div
          className="dab-content-tabs"
          data-testid="studio-content-tabs"
          role="tablist"
          aria-label="Conversation Looker content tabs"
        >
          {contentItems.map((item) => {
            const isSelected = item.key === resolvedActiveTabKey
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`studio-content-tab-${item.key}`}
                className={`dab-content-tab ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelectContentTab?.(item.key)}
                title={`${item.title} (${item.contentType}: ${item.id})`}
              >
                <span className="dab-content-tab-icon">{renderContentTabIcon(item.contentType)}</span>
                <span className="dab-content-tab-label">{item.title}</span>
              </button>
            )
          })}
        </div>
      )}
      {isTileMode ? (
        <TilePreviewPane ctl={ctl} />
      ) : isHealthCheckMode ? (
        <StudioToolbar
          title={
            healthReport ? (
              <>
                <strong>{healthReport.title}</strong>{' '}
                <StudioBadge>
                  Health Score: {healthReport.scores.overallScore}% ({healthReport.scores.grade})
                </StudioBadge>{' '}
                <StudioBadge>
                  Transcriber: {healthReport.scores.transcriberScore}/4.00
                </StudioBadge>{' '}
                <span className="dab-muted">
                  (user_{healthReport.createdBy}_health_check_{healthReport.id} · obj_health_check_
                  {healthReport.id})
                </span>
              </>
            ) : (
              <span className="dab-muted">
                7-section TECHNICAL_DESIGN_DOCUMENT.md (0–100% health score) will render here
              </span>
            )
          }
          actions={
            <>
              {healthReport && (
                <>
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={() => setTddViewMode((m) => (m === 'rendered' ? 'raw' : 'rendered'))}
                  >
                    {tddViewMode === 'rendered' ? '{ } Raw Markdown' : 'Rendered Report'}
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
                    Download Markdown (.md)
                  </button>
                </>
              )}
              <UseCaseInfoTrigger useCase="health-check" onOpen={setInfoModalUseCase} />
            </>
          }
        />
      ) : isLookmlMode ? (
        <StudioToolbar
          title={
            lookmlBundle ? (
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
            )
          }
          actions={<UseCaseInfoTrigger useCase="lookml" onOpen={setInfoModalUseCase} />}
        />
      ) : isCaMode || caConversation ? (
        <>
          <StudioToolbar
            testId="ca-preview-toolbar"
            title={
              caConversation ? (
                <>
                  <strong>{caConversation.title}</strong>{' '}
                  <StudioBadge testId="ca-selected-agent-badge">
                    Agent: {caConversation.agentName} ({caConversation.agentId})
                  </StudioBadge>{' '}
                  <span className="dab-muted">
                    (Conversation <code>{caConversation.caConversationId}</code> ·{' '}
                    <code>{caConversation.embedPath}</code>)
                  </span>
                </>
              ) : (
                <span className="dab-muted">
                  Looker Conversational Analytics embedded chat will appear here after routing
                </span>
              )
            }
            actions={
              <>
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
              </>
            }
          />
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
        <StudioToolbar
          title={
            activeContentItem &&
            activeContentItem.contentType !== 'data_app' &&
            activeContentItem.contentType !== 'data-investigator' ? (
              <>
                <strong>{activeContentItem.title}</strong>{' '}
                <span className="dab-muted">
                  ({activeContentItem.contentType} #{activeContentItem.id} ·{' '}
                  <code>{activeContentItem.embedPath}</code>)
                </span>
              </>
            ) : builderMode === 'dashboard' && nativeContent ? (
              <>
                <strong>{nativeContent.title}</strong>{' '}
                <span className="dab-muted">
                  ({nativeContent.contentType} #{nativeContent.id} ·{' '}
                  <code>{nativeContent.embedPath}</code>)
                </span>
              </>
            ) : publishedApp ? (
              <>
                <strong>{publishedApp.title}</strong>{' '}
                <span className="dab-muted">
                  (Dashboard #{publishedApp.dashboardId} · Extension db::
                  {publishedApp.extensionId.slice(0, 8)}…)
                </span>
              </>
            ) : busyStatus ? (
              <span className="dab-muted">Thinking...</span>
            ) : (
              <span className="dab-muted">
                Preview will appear here when Looker content is ready
              </span>
            )
          }
          actions={
            <>
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
                useCase={
                  builderMode === 'dashboard'
                    ? 'dashboard'
                    : selectedUseCase === 'data-investigator'
                    ? 'data-investigator'
                    : 'app'
                }
                onOpen={setInfoModalUseCase}
              />
            </>
          }
        />
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
                Click <strong>Run 3-Pillar Audit</strong> in the top-right bar or enter a
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
          !hasActiveEmbed &&
            (busyStatus ? (
              <div className="dab-placeholder">
                <div
                  className="dab-thinking-logo-card"
                  data-testid="right-pane-thinking-state"
                  role="status"
                  aria-live="polite"
                >
                  <div className="dab-thinking-logo-orb" aria-hidden="true">
                    <Sparkles size={26} strokeWidth={1.75} className="dab-thinking-logo-icon" />
                  </div>
                  <strong className="dab-thinking-logo-title">Thinking...</strong>
                  <span className="dab-muted dab-thinking-logo-subtitle">{busyStatus}</span>
                </div>
              </div>
            ) : (
              <div className="dab-placeholder">
                <p>Ready when you are</p>
                <p className="dab-muted">
                  Ask a question or describe what you want to analyze, build, or automate on the
                  left.
                </p>
              </div>
            ))
        )}
      </div>
    </main>
  )
}
