import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import { ExtensionProvider } from '@looker/extension-sdk-react'
import {
  LookerExtensionProvider,
  useLookerExtension,
} from '../contexts/LookerExtensionContext'
import {
  buildAvailableExploresCatalog,
  buildDenseExploreSchema,
  deleteUserArtifact,
  extractExploreIdsFromCode,
  fetchInitialLookerMetadata,
  formatExploreId,
  listUserArtifacts,
  listUserDashboardArtifacts,
  loadExistingDashboardApp,
  loadNativeContentById,
  loadObjectArtifact,
  NativeContentState,
  NativeContentType,
  parseExploreId,
  PublishedAppState,
  saveDashboardStudioMetadata,
  saveNativeContentArtifact,
  saveUserArtifact,
  upsertPublishedDataApp,
  UserArtifactIndex,
} from '../lookerApi'
import {
  AgentSession,
  AntigravityAuth,
  CodeModePermissionDecision,
  CodeModePermissionRequest,
  ensureGeminiApiKeyUserAttribute,
  ExtensionAuthContextConfig,
  getGeminiUserAttributeName,
  LkrCodeMode,
  loginWithGoogleOAuth,
  PastedImage,
  runAntigravityTurn,
} from '../antigravity'
import { PythonTile, ScriptStudioView } from './PythonTile'
import {
  listUserLookmlSessions,
  loadLookmlSessionArtifact,
  LookmlBundle,
  LookmlPreviewPane,
  LookmlSessionIndex,
  saveLookmlSessionArtifact,
} from '../lookmlTool'
import {
  HEALTH_CHECK_SYSTEM_GUIDE,
  HealthCheckReportPayload,
  loadHealthCheckArtifact,
  runThreePillarHealthCheckViaCodeMode,
  saveHealthCheckArtifact,
  THREE_PILLAR_CODEMODE_PY,
} from '../healthCheck'
import '../styles/index.css'

export type StudioMode = 'app' | 'dashboard' | 'lookml' | 'health' | 'tile'

export const STUDIO_MODES: Array<{
  mode: StudioMode
  label: string
  prefix: string
}> = [
  { mode: 'app', label: 'Data App', prefix: '/app' },
  { mode: 'dashboard', label: 'Dashboard', prefix: '/dashboard' },
  { mode: 'lookml', label: 'LookML', prefix: '/lookml' },
  { mode: 'health', label: 'Health Check', prefix: '/health-check' },
  { mode: 'tile', label: 'Python Tile', prefix: '/tile' },
]

export function parseStudioRoute(pathname: string): {
  mode: StudioMode
  objectId: string
} {
  const clean = (pathname || '/').trim()
  if (clean === '/' || clean === '/config') return { mode: 'app', objectId: '' }
  if (clean.startsWith('/health')) {
    const rest = clean.replace(/^\/health(?:-check)?\/?/, '')
    return { mode: 'health', objectId: decodeURIComponent(rest) }
  }
  if (clean.startsWith('/script')) {
    const rest = clean.replace(/^\/script\/?/, '')
    return { mode: 'tile', objectId: decodeURIComponent(rest) }
  }
  for (const m of STUDIO_MODES) {
    if (clean === m.prefix || clean.startsWith(`${m.prefix}/`)) {
      return {
        mode: m.mode,
        objectId: decodeURIComponent(clean.slice(m.prefix.length).replace(/^\/+/, '')),
      }
    }
  }
  return {
    mode: 'app',
    objectId: decodeURIComponent(clean.replace(/^\/+/, '')),
  }
}

const PythonTileMount: React.FC = () => <PythonTile />

interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  images?: string[]
  interactionId?: string
  dashboardId?: string
  widgetCount?: number
}

const StudioMain: React.FC = () => {
  const { extensionSDK, core40SDK, tileHostData, lookerHostData } = useLookerExtension()
  const history = useHistory()
  const location = useLocation()
  const mountType =
    (lookerHostData as any)?.mountType ||
    (extensionSDK as any)?.lookerHostData?.mountType ||
    lookerHostData?.mountPoint ||
    (extensionSDK as any)?.lookerHostData?.mountPoint
  const isTileMount =
    mountType === 'dashboard_tile' ||
    mountType === 'dashboard-tile' ||
    Boolean(tileHostData?.elementId || tileHostData?.dashboardId)

  // Extension-wide Auth Context state (stored once via extensionSDK.saveContextData)
  const initialCtx = (() => {
    try {
      return (extensionSDK.getContextData() as ExtensionAuthContextConfig | undefined) || undefined
    } catch {
      return undefined
    }
  })()
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>(
    initialCtx?.authMode || 'oauth'
  )
  const [clientId, setClientId] = useState(initialCtx?.clientId || '')
  const [projectId, setProjectId] = useState(initialCtx?.projectId || '')
  const [oauthToken, setOauthToken] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isConfigured, setIsConfigured] = useState(() =>
    Boolean(initialCtx?.authMode && (initialCtx.authMode === 'apikey' || initialCtx.clientId))
  )

  // Looker metadata & multi-select explore state (empty = let agent decide)
  const [userId, setUserId] = useState('1')
  const [models, setModels] = useState<Array<{ name: string; label: string; explores: any[] }>>([])
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [selectedExplores, setSelectedExplores] = useState<string[]>([])
  const [exploreSearch, setExploreSearch] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const comboRef = useRef<HTMLDivElement | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState('1')
  const [schemaMarkdown, setSchemaMarkdown] = useState('')
  const [loadingSchema, setLoadingSchema] = useState(false)

  // App, Native Content, Agentic LookML, Health Check & Agent session state
  const isLookmlMode =
    location.pathname === '/lookml' || location.pathname.startsWith('/lookml/')
  const builderMode: 'data_app' | 'dashboard' = /^\/dashboard(?:\/|$)/.test(
    location.pathname
  )
    ? 'dashboard'
    : 'data_app'
  const [lookmlProjectId, setLookmlProjectId] = useState('')
  const [lookmlBundle, setLookmlBundle] = useState<LookmlBundle | null>(null)
  const [lookmlSessions, setLookmlSessions] = useState<LookmlSessionIndex[]>([])
  const [loadLookmlInput, setLoadLookmlInput] = useState('')
  const lastLookmlIdRef = useRef<string>('')
  const [publishedApp, setPublishedApp] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContent] = useState<NativeContentState | null>(null)
  const [myCreations, setMyCreations] = useState<
    Array<{ id: string; title: string; contentType: NativeContentType; embedPath: string }>
  >([])
  const lastPublishedIdRef = useRef<string>('')
  const lastNativeIdRef = useRef<string>('')
  const [healthReport, setHealthReport] = useState<HealthCheckReportPayload | null>(null)
  const lastHealthIdRef = useRef<string>('')
  const [copiedTdd, setCopiedTdd] = useState(false)
  const [currentAppCode, setCurrentAppCode] = useState('')
  const [loadDashInput, setLoadDashInput] = useState('')
  const [agentSession, setAgentSession] = useState<AgentSession>({})
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([])
  const [busyStatus, setBusyStatus] = useState<string | null>(null)
  const [iframeRev, setIframeRev] = useState(1)
  const [codeModeSnippet, setCodeModeSnippet] = useState(
    'return search_content(terms="order", types="lookml_explore")'
  )
  const [codeModeOutput, setCodeModeOutput] = useState('')

  const isHealthCheckMode =
    location.pathname === '/health-check' ||
    location.pathname.startsWith('/health-check/') ||
    location.pathname === '/health' ||
    location.pathname.startsWith('/health/')
  const parsedRoute = useMemo(() => parseStudioRoute(location.pathname), [location.pathname])
  const activeMode = parsedRoute.mode

  // Per-user searchable artifact catalog (My Creations)
  const [catalogItems, setCatalogItems] = useState<UserArtifactIndex[]>([])
  const [catalogSearch, setCatalogSearch] = useState('')
  const [activeObjectId, setActiveObjectId] = useState('')

  // Inline permission prompt state for mutating CodeMode SDK operations
  const approvedOpsRef = useRef<Set<string>>(new Set())
  const [pendingPerm, setPendingPerm] = useState<{
    req: CodeModePermissionRequest
    resolve: (decision: CodeModePermissionDecision) => void
  } | null>(null)

  const requestCodeModePermission = useCallback(
    (req: CodeModePermissionRequest): Promise<CodeModePermissionDecision> =>
      new Promise<CodeModePermissionDecision>((resolve) => {
        setPendingPerm({ req, resolve })
      }),
    []
  )

  const resolvePermDecision = (decision: CodeModePermissionDecision) => {
    if (!pendingPerm) return
    const { resolve } = pendingPerm
    setPendingPerm(null)
    resolve(decision)
  }

  const refreshCatalog = useCallback(
    async (uid = userId) => {
      if (!uid) return
      try {
        const items = await listUserArtifacts(core40SDK, uid)
        setCatalogItems(items)
      } catch {
        // Ignore if artifacts namespace is empty
      }
    },
    [core40SDK, userId]
  )

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    return catalogItems.filter((item) => {
      if (!q) return true
      const hay = `${item.title} ${item.id} ${item.type} ${(item.explores || []).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [catalogItems, catalogSearch])

  const handleSaveAuthSetup = async () => {
    try {
      if (authMode === 'apikey') {
        setBusyStatus('Ensuring hidden Looker User Attribute for Gemini API Key...')
        const attrName = await ensureGeminiApiKeyUserAttribute(
          core40SDK,
          extensionSDK,
          apiKey
        )
        setApiKey('')
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Configured hidden Looker User Attribute "${attrName}" (value_is_hidden=true, user_can_view=false, whitelist="https://generativelanguage.googleapis.com/*") and saved extension context.`,
          },
        ])
      } else if (!clientId.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: 'Enter a Google Web OAuth 2.0 Client ID before saving.' },
        ])
        return
      }
      setBusyStatus('Saving shared extension context...')
      const nextCtx: ExtensionAuthContextConfig = {
        authMode,
        clientId: clientId.trim(),
        projectId: projectId.trim(),
      }
      await extensionSDK.saveContextData(nextCtx)
      setIsConfigured(true)
      setBusyStatus(null)
      history.replace('/')
    } catch (err: any) {
      setBusyStatus(null)
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: err?.message || String(err) },
      ])
    }
  }

  // Close explore combo dropdown when clicking outside
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  // Load models, folders & user's indexed native creations on mount
  useEffect(() => {
    let mounted = true
    fetchInitialLookerMetadata(core40SDK)
      .then((meta) => {
        if (!mounted) return
        const resolvedUserId = String(meta.user?.id || '1')
        setUserId(resolvedUserId)
        listUserLookmlSessions(core40SDK, extensionSDK, resolvedUserId).then((sessions) => {
          if (mounted) setLookmlSessions(sessions)
        })
        const mappedModels = meta.models.map((m: any) => ({
          name: String(m.name),
          label: String(m.label || m.name),
          explores: (m.explores || []).filter((e: any) => !e.hidden),
        }))
        setModels(mappedModels)
        setFolders(
          meta.folders.map((f: any) => ({
            id: String(f.id),
            name: `${f.name} (#${f.id})`,
          }))
        )
        setSelectedFolderId((prev) => (prev === '1' ? meta.defaultFolderId : prev))
        listUserDashboardArtifacts(core40SDK, extensionSDK, resolvedUserId).then((items) => {
          if (mounted) setMyCreations(items)
        })
        refreshCatalog(resolvedUserId)
      })
      .catch((err) => {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Failed to load Looker models: ${err.message}` },
        ])
      })
    return () => {
      mounted = false
    }
  }, [core40SDK, extensionSDK])

  // Grouped explore options matching lkrdev/explore-blending (grouped by model.label, sorted alphabetically)
  const groupedExplores = useMemo(() => {
    const q = exploreSearch.trim().toLowerCase()
    return models
      .reduce(
        (
          acc: Array<{
            label: string
            modelName: string
            options: Array<{ label: string; value: string }>
          }>,
          model
        ) => {
          if (model?.explores?.length) {
            const modelTerm = `${model.label} ${model.name}`.toLowerCase()
            const matchingExplores = model.explores.filter((explore: any) => {
              if (explore.hidden) return false
              if (!q) return true
              const exploreTerm = `${explore.label || ''} ${explore.name}`.toLowerCase()
              return exploreTerm.includes(q) || modelTerm.includes(q)
            })
            if (matchingExplores.length > 0) {
              acc.push({
                label: model.label || model.name,
                modelName: model.name,
                options: matchingExplores
                  .map((explore: any) => ({
                    label: String(explore.label || explore.name),
                    value: formatExploreId(model.name, String(explore.name)),
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label)),
              })
            }
          }
          return acc
        },
        []
      )
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [models, exploreSearch])

  const exploreLookup = useMemo(() => {
    const map: Record<string, { id: string; label: string; modelLabel: string }> = {}
    for (const model of models) {
      for (const explore of model.explores || []) {
        if (explore.hidden) continue
        const id = formatExploreId(model.name, String(explore.name))
        map[id] = {
          id,
          label: String(explore.label || explore.name),
          modelLabel: String(model.label || model.name),
        }
      }
    }
    return map
  }, [models])

  const toggleExploreSelection = (exploreId: string) => {
    setSelectedExplores((prev) =>
      prev.includes(exploreId)
        ? prev.filter((id) => id !== exploreId)
        : [...prev, exploreId]
    )
    setExploreSearch('')
  }

  // Compile explore schemas when selectedExplores > 0, or build catalog when empty ("let agent decide")
  useEffect(() => {
    let mounted = true
    if (selectedExplores.length === 0) {
      setSchemaMarkdown(buildAvailableExploresCatalog(models))
      setLoadingSchema(false)
      return
    }
    setLoadingSchema(true)
    Promise.all(
      selectedExplores.map(async (id) => {
        const parsed = parseExploreId(id)
        if (!parsed) return ''
        try {
          return await buildDenseExploreSchema(
            core40SDK,
            parsed.modelName,
            parsed.exploreName
          )
        } catch (err: any) {
          return `# Error loading explore \`${id}\`\n${err?.message || err}`
        }
      })
    )
      .then((sections) => {
        if (mounted) {
          setSchemaMarkdown(sections.filter(Boolean).join('\n\n---\n\n'))
        }
      })
      .finally(() => {
        if (mounted) setLoadingSchema(false)
      })
    return () => {
      mounted = false
    }
  }, [core40SDK, selectedExplores, models])

  const handleOAuthLogin = async () => {
    if (!clientId.trim()) {
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: 'Enter your Google Web OAuth 2.0 Client ID first.' },
      ])
      return
    }
    try {
      setBusyStatus('Opening Google OAuth sign-in...')
      const token = await loginWithGoogleOAuth(extensionSDK, clientId)
      setOauthToken(token)
      setBusyStatus(null)
    } catch (err: any) {
      setBusyStatus(null)
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: `Google OAuth failed: ${err.message || err}` },
      ])
    }
  }

  const loadDashboardById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      try {
        setBusyStatus(`Loading Data App from dashboard #${id}...`)
        const loaded = await loadExistingDashboardApp(core40SDK, id)
        setPublishedApp({
          dashboardId: loaded.dashboardId,
          extensionId: loaded.extensionId,
          elementId: loaded.elementId,
          title: loaded.title,
          folderId: loaded.folderId,
          studio: loaded.studio,
          manifestQueries: loaded.manifestQueries,
        })
        setCurrentAppCode(loaded.code)
        setLoadDashInput(loaded.dashboardId)
        setSelectedFolderId(loaded.folderId)

        // Resolve canonical model_id::explore_id list from studio metadata, manifest queries, or code
        const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
        const legacyExplore =
          loaded.studio?.modelName && loaded.studio?.exploreName
            ? [formatExploreId(loaded.studio.modelName, loaded.studio.exploreName)]
            : []
        const queryExplores = Array.from(
          new Set(
            (loaded.manifestQueries || [])
              .filter((q) => q.model && q.explore)
              .map((q) => formatExploreId(q.model, q.explore))
          )
        )
        const codeExplores = extractExploreIdsFromCode(loaded.code)
        const resolvedExplores =
          studioExplores.length > 0
            ? studioExplores
            : legacyExplore.length > 0
            ? legacyExplore
            : queryExplores.length > 0
            ? queryExplores
            : codeExplores
        setSelectedExplores(resolvedExplores)

        const savedInteractionId =
          loaded.studio?.lastInteractionId ||
          loaded.studio?.lastSession?.lastInteractionId
        const savedEnvironmentId =
          loaded.studio?.environmentId ||
          loaded.studio?.lastSession?.environmentId
        setAgentSession(
          savedInteractionId
            ? {
                lastInteractionId: savedInteractionId,
                environmentId: savedEnvironmentId,
                explores: resolvedExplores,
              }
            : {}
        )
        setIframeRev((r) => r + 1)
        if (pushRoute && location.pathname !== `/${loaded.dashboardId}`) {
          history.replace(`/${encodeURIComponent(loaded.dashboardId)}`)
        }
        if (loaded.studio?.messages && loaded.studio.messages.length > 0) {
          setMessages(loaded.studio.messages)
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `Loaded existing Data App "${loaded.title}" (Dashboard #${loaded.dashboardId}, ${loaded.code.length.toLocaleString()} bytes). Describe any changes to update it in place.`,
              dashboardId: loaded.dashboardId,
            },
          ])
        }
        setBusyStatus(null)
      } catch (err: any) {
        setBusyStatus(null)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Could not load dashboard #${id}: ${err.message || err}` },
        ])
      }
    },
    [core40SDK, history, location.pathname]
  )

  const loadNativeById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      try {
        setBusyStatus(`Loading native Looker content #${id}...`)
        const loaded = await loadNativeContentById(core40SDK, extensionSDK, id)
        lastNativeIdRef.current = loaded.id
        setNativeContent(loaded)
        setLoadDashInput(loaded.id)
        setSelectedFolderId(loaded.folderId)
        const studioExplores = loaded.studio?.explores?.filter(Boolean) || []
        if (studioExplores.length > 0) setSelectedExplores(studioExplores)
        const savedInteractionId =
          loaded.studio?.lastInteractionId ||
          loaded.studio?.lastSession?.lastInteractionId
        const savedEnvironmentId =
          loaded.studio?.environmentId ||
          loaded.studio?.lastSession?.environmentId
        setAgentSession(
          savedInteractionId
            ? {
                lastInteractionId: savedInteractionId,
                environmentId: savedEnvironmentId,
                explores: studioExplores,
              }
            : {}
        )
        setIframeRev((r) => r + 1)
        const targetRoute = `/dashboard/${encodeURIComponent(loaded.id)}`
        if (pushRoute && location.pathname !== targetRoute) {
          history.replace(targetRoute)
        }
        if (loaded.studio?.messages && loaded.studio.messages.length > 0) {
          setMessages(loaded.studio.messages)
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `Loaded native Looker ${loaded.contentType} "${loaded.title}" (#${loaded.id}). Ask for tiles, filters, looks, boards, or schedules to update it via CodeMode.`,
              dashboardId: loaded.id,
            },
          ])
        }
        setBusyStatus(null)
      } catch (err: any) {
        setBusyStatus(null)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Could not load native content #${id}: ${err.message || err}` },
        ])
      }
    },
    [core40SDK, extensionSDK, history, location.pathname]
  )

  const loadHealthCheckById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      try {
        setBusyStatus(`Loading Health Check report "${id}"...`)
        const loaded = await loadHealthCheckArtifact(core40SDK, extensionSDK, id)
        lastHealthIdRef.current = loaded.id
        setHealthReport(loaded)
        setLoadDashInput(loaded.id)
        if (loaded.messages && loaded.messages.length > 0) {
          setMessages(loaded.messages)
        } else {
          setMessages([
            {
              role: 'assistant',
              text: `Loaded "${loaded.title}" (Health Score: ${loaded.scores.overallScore}%, Transcriber: ${loaded.scores.transcriberScore}/4.00) from obj_health_check_${loaded.id}.`,
            },
          ])
        }
        if (pushRoute && location.pathname !== `/health-check/${loaded.id}`) {
          history.replace(`/health-check/${encodeURIComponent(loaded.id)}`)
        }
        setBusyStatus(null)
      } catch (err: any) {
        setBusyStatus(null)
        setMessages((prev) => [
          ...prev,
          {
            role: 'error',
            text: `Could not load Health Check "${id}": ${err?.message || err}`,
          },
        ])
      }
    },
    [core40SDK, extensionSDK, history, location.pathname]
  )

  const handleRunHealthCheck = async (
    customFocus?: string,
    baseMessages?: ChatMessage[],
    images?: PastedImage[]
  ) => {
    const activeMsgs = baseMessages || messages
    try {
      const baseRes = await runThreePillarHealthCheckViaCodeMode({
        sdk: core40SDK,
        extensionSDK,
        reportId: healthReport?.id || loadDashInput.trim() || undefined,
        customFocus,
        messages: activeMsgs,
        onStatus: setBusyStatus,
      })
      let finalReport = baseRes.report
      if (customFocus && (authMode === 'apikey' || oauthToken)) {
        try {
          const turnRes = await runAntigravityTurn({
            sdk: core40SDK,
            extensionSDK,
            auth: { mode: authMode, oauthToken, clientId, projectId, apiKey },
            session: agentSession,
            selectedExplores,
            folderId: selectedFolderId,
            schemaMarkdown,
            userPrompt: customFocus,
            images,
            customSystemGuide: HEALTH_CHECK_SYSTEM_GUIDE,
            extraSources: [
              { type: 'inline', content: THREE_PILLAR_CODEMODE_PY, target: '/workspace/three_pillar_audit.py' },
              { type: 'inline', content: finalReport.tddMarkdown, target: '/workspace/TECHNICAL_DESIGN_DOCUMENT.md' },
            ],
            priorMessages: messages,
            onStatus: setBusyStatus,
          })
          setAgentSession(turnRes.session)
          if (turnRes.tddMarkdown) {
            finalReport = {
              ...finalReport,
              tddMarkdown: turnRes.tddMarkdown,
              lastInteractionId: turnRes.session.lastInteractionId,
              environmentId: turnRes.session.environmentId,
              updatedAt: new Date().toISOString(),
            }
            await saveHealthCheckArtifact(core40SDK, extensionSDK, userId, finalReport)
          }
        } catch {
          // Keep deterministic 3-pillar LkrCodeMode TDD if Antigravity turn is unavailable
        }
      }
      lastHealthIdRef.current = finalReport.id
      setHealthReport(finalReport)
      setLoadDashInput(finalReport.id)
      if (location.pathname !== `/health-check/${finalReport.id}`) {
        history.replace(`/health-check/${encodeURIComponent(finalReport.id)}`)
      }
      setMessages([
        ...activeMsgs,
        {
          role: 'assistant',
          text: `3-Pillar Health Check complete: **${finalReport.scores.overallScore}% (${finalReport.scores.grade})** | Pillar 1: ${finalReport.scores.pillar1Score}% · Pillar 2: ${finalReport.scores.pillar2Score}% (Transcriber ${finalReport.scores.transcriberScore}/4.00) · Pillar 3: ${finalReport.scores.pillar3Score}%.\nSaved to \`${baseRes.userKey}\` and \`${baseRes.objKey}\`.`,
        },
      ])
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'error', text: err?.message || String(err) }])
    } finally {
      setBusyStatus(null)
    }
  }

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
  // Redirect to /config if extension auth is not configured yet
  useEffect(() => {
    if (
      !isTileMount &&
      !isConfigured &&
      location.pathname !== '/config' &&
      !location.pathname.startsWith('/script')
    ) {
      history.replace('/config')
    }
  }, [isTileMount, isConfigured, location.pathname, history])

  const loadLookmlSessionById = useCallback(
    async (rawId: string, pushRoute = true) => {
      const id = rawId.trim()
      if (!id) return
      try {
        setBusyStatus(`Loading LookML session "${id}"...`)
        const loaded = await loadLookmlSessionArtifact(core40SDK, extensionSDK, id)
        lastLookmlIdRef.current = loaded.id
        setLookmlBundle(loaded.bundle)
        setLoadLookmlInput(loaded.id)
        if (loaded.bundle?.project_id) {
          setLookmlProjectId(loaded.bundle.project_id)
        }
        const savedExplores = loaded.studio?.explores?.filter(Boolean) || []
        setSelectedExplores(savedExplores)
        setAgentSession(
          loaded.studio?.lastInteractionId
            ? {
                lastInteractionId: loaded.studio.lastInteractionId,
                environmentId: loaded.studio.environmentId,
                explores: savedExplores,
              }
            : {}
        )
        if (loaded.studio?.messages && loaded.studio.messages.length > 0) {
          setMessages(loaded.studio.messages)
        } else {
          setMessages([
            {
              role: 'assistant',
              text: `Loaded LookML session "${loaded.title}" (${loaded.bundle?.files?.length || 0} modified .lkml files).`,
            },
          ])
        }
        if (pushRoute && location.pathname !== `/lookml/${loaded.id}`) {
          history.replace(`/lookml/${encodeURIComponent(loaded.id)}`)
        }
        setBusyStatus(null)
      } catch (err: any) {
        setBusyStatus(null)
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: `Could not load LookML session "${id}": ${err.message || err}` },
        ])
      }
    },
    [core40SDK, extensionSDK, history, location.pathname]
  )

  // Auto-load content when opened via route (/lookml/:id, /health-check/:id, /dashboard/:id, or /:dashboardId / /dashboards/:dashboardId)
  useEffect(() => {
    if (
      isTileMount ||
      location.pathname === '/config' ||
      location.pathname === '/script' ||
      location.pathname.startsWith('/script/')
    ) {
      return
    }
    const lookmlMatch = location.pathname.match(/^\/lookml\/([^/]+)\/?$/)
    if (lookmlMatch) {
      const lookmlId = decodeURIComponent(lookmlMatch[1]).trim()
      if (
        lookmlId &&
        lookmlId !== lookmlBundle?.id &&
        lookmlId !== lastLookmlIdRef.current
      ) {
        loadLookmlSessionById(lookmlId, false)
      }
      return
    }
    if (location.pathname === '/lookml') return
    const hcMatch = location.pathname.match(/^\/health-check\/([^/]+)\/?$/)
    if (hcMatch) {
      const hcId = decodeURIComponent(hcMatch[1]).trim()
      if (hcId && hcId !== healthReport?.id && hcId !== lastHealthIdRef.current) {
        loadHealthCheckById(hcId, false)
      }
      return
    }
    if (location.pathname === '/health-check') return
    const nativeMatch = location.pathname.match(/^\/dashboard\/([^/]+)\/?$/)
    if (nativeMatch) {
      const routeId = decodeURIComponent(nativeMatch[1]).trim()
      if (
        routeId &&
        routeId !== nativeContent?.id &&
        routeId !== lastNativeIdRef.current
      ) {
        loadNativeById(routeId, false)
      }
      return
    }
    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      return
    }
    const m = location.pathname.match(/^\/(?:dashboards\/)?([^/]+)\/?$/)
    const routeId = m ? decodeURIComponent(m[1]).trim() : ''
    if (
      routeId &&
      routeId !== publishedApp?.dashboardId &&
      routeId !== lastPublishedIdRef.current
    ) {
      loadDashboardById(routeId, false)
    }
  }, [
    isTileMount,
    location.pathname,
    publishedApp?.dashboardId,
    nativeContent?.id,
    lookmlBundle?.id,
    healthReport?.id,
    loadDashboardById,
    loadNativeById,
    loadLookmlSessionById,
    loadHealthCheckById,
  ])

  const handleLoadExistingDashboard = async () => {
    if (isHealthCheckMode) {
      await loadHealthCheckById(loadDashInput, true)
      return
    }
    if (builderMode === 'dashboard') {
      await loadNativeById(loadDashInput, true)
    } else {
      await loadDashboardById(loadDashInput, true)
    }
  }

  const handleResetNewApp = () => {
    lastPublishedIdRef.current = ''
    lastNativeIdRef.current = ''
    lastLookmlIdRef.current = ''
    lastHealthIdRef.current = ''
    setPublishedApp(null)
    setNativeContent(null)
    setLookmlBundle(null)
    setHealthReport(null)
    setCurrentAppCode('')
    setLoadDashInput('')
    setLoadLookmlInput('')
    setSelectedExplores([])
    setAgentSession({})
    setMessages([])
    setPastedImages([])
    if (isHealthCheckMode) {
      history.push('/health-check')
      return
    }
    const baseRoute = isLookmlMode
      ? '/lookml'
      : builderMode === 'dashboard'
      ? '/dashboard'
      : '/'
    if (location.pathname !== baseRoute) {
      history.push(baseRoute)
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []).filter((item) =>
      item.type.startsWith('image/')
    )
    if (items.length === 0) return
    e.preventDefault()
    for (const item of items) {
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        const base64 = dataUrl.split(',')[1]
        if (base64) {
          setPastedImages((prev) => [
            ...prev,
            { mimeType: file.type || 'image/png', data: base64, dataUrl },
          ])
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSelectCatalogItem = async (item: UserArtifactIndex) => {
    const modeInfo = STUDIO_MODES.find((m) => m.mode === item.type)
    const targetPath = modeInfo
      ? `${modeInfo.prefix}/${encodeURIComponent(item.id)}`
      : `/app/${encodeURIComponent(item.id)}`
    setActiveObjectId(item.id)
    if (location.pathname !== targetPath) {
      history.push(targetPath)
    }
    if (item.type === 'app') {
      await loadDashboardById(item.id, false)
    } else if (item.type === 'dashboard') {
      await loadNativeById(item.id, false)
    } else if (item.type === 'lookml') {
      await loadLookmlSessionById(item.id, false)
    } else if (item.type === 'health') {
      await loadHealthCheckById(item.id, false)
    } else {
      const loaded = await loadObjectArtifact(core40SDK, item.type, item.id)
      if (loaded?.messages) setMessages(loaded.messages)
    }
  }

  const handleDeleteCatalogItem = async (
    e: React.MouseEvent,
    item: UserArtifactIndex
  ) => {
    e.stopPropagation()
    try {
      await deleteUserArtifact(core40SDK, userId, item.type, item.id, true)
      await refreshCatalog()
    } catch {
      // Ignore delete error
    }
  }

  const handleSendPrompt = async () => {
    const text = prompt.trim()
    if ((!text && pastedImages.length === 0) || busyStatus) return

    const auth: AntigravityAuth = {
      mode: authMode,
      oauthToken,
      clientId,
      projectId,
      apiKey,
    }

    const attachedImages = pastedImages
    const effectivePrompt = text || 'See the attached screenshot.'
    const userMsg: ChatMessage = {
      role: 'user',
      text: effectivePrompt,
      images: attachedImages.map((img) => img.dataUrl),
    }
    const messagesWithUser = [...messages, userMsg]
    setPrompt('')
    setPastedImages([])
    setMessages(messagesWithUser)

    if (isHealthCheckMode) {
      await handleRunHealthCheck(effectivePrompt, messagesWithUser, attachedImages)
      await refreshCatalog()
      return
    }

    setBusyStatus('Connecting to Antigravity...')

    try {
      const result = await runAntigravityTurn({
        sdk: core40SDK,
        extensionSDK,
        auth,
        session: agentSession,
        mode: builderMode,
        selectedExplores,
        folderId: selectedFolderId,
        toolMode: isLookmlMode ? 'lookml' : 'data_app',
        lookmlProjectId,
        schemaMarkdown,
        userPrompt: effectivePrompt,
        images: attachedImages,
        existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent,
        priorMessages: messages,
        approvedOperations: approvedOpsRef.current,
        onPermissionRequest: requestCodeModePermission,
        onStatus: setBusyStatus,
      })

      if (result.lookmlBundle) {
        setBusyStatus('Saving LookML session artifacts (user_..._lookml_... & obj_lookml_...)...')
        const prelimAssistantMsg: ChatMessage = {
          role: 'assistant',
          text: result.assistantText,
          interactionId: result.session.lastInteractionId,
        }
        const nextMsgs = [...messagesWithUser, prelimAssistantMsg]
        setLookmlBundle(result.lookmlBundle)
        if (result.lookmlBundle.project_id) {
          setLookmlProjectId(result.lookmlBundle.project_id)
        }
        try {
          const saved = await saveLookmlSessionArtifact({
            sdk: core40SDK,
            extensionSDK,
            userId,
            bundle: result.lookmlBundle,
            studio: {
              explores: selectedExplores,
              lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
              messages: nextMsgs,
            },
          })
          lastLookmlIdRef.current = saved.id
          setLoadLookmlInput(saved.id)
          setLookmlSessions((prev) => [
            saved.index,
            ...prev.filter((s) => s.id !== saved.id),
          ])
          await refreshCatalog()
          if (location.pathname !== `/lookml/${saved.id}`) {
            history.replace(`/lookml/${encodeURIComponent(saved.id)}`)
          }
        } catch {
          // Non-fatal if Looker Artifact store is unavailable in test/dev environment
        }
        setAgentSession({
          ...result.session,
          explores: selectedExplores,
        })
        setMessages(nextMsgs)
        return
      }

      // If user left explores empty ("let agent decide"), record the model_id::explore_id(s) chosen by the agent
      const bundleExplores = result.bundle
        ? Array.from(
            new Set([
              ...(result.bundle.widgets || [])
                .filter((w) => w.query?.model && w.query?.view)
                .map((w) => formatExploreId(w.query.model, w.query.view)),
              ...extractExploreIdsFromCode(result.bundle.raw_code || ''),
            ])
          )
        : result.nativeBundle?.explores || []
      const effectiveExplores =
        selectedExplores.length > 0 ? selectedExplores : bundleExplores
      if (selectedExplores.length === 0 && bundleExplores.length > 0) {
        setSelectedExplores(bundleExplores)
      }

      setAgentSession({
        ...result.session,
        explores: effectiveExplores,
      })

      if (builderMode === 'dashboard' && result.nativeBundle) {
        setBusyStatus('Indexing native Looker content in user catalog...')
        const prelimAssistantMsg: ChatMessage = {
          role: 'assistant',
          text: result.assistantText,
          interactionId: result.session.lastInteractionId,
          widgetCount: result.nativeBundle.tile_count,
        }
        const savedNative = await saveNativeContentArtifact(
          core40SDK,
          extensionSDK,
          userId,
          result.nativeBundle,
          selectedFolderId,
          nativeContent,
          {
            explores: effectiveExplores,
            lastInteractionId: result.session.lastInteractionId,
            environmentId: result.session.environmentId,
            messages: [...messagesWithUser, prelimAssistantMsg],
          }
        )
        lastNativeIdRef.current = savedNative.id
        setNativeContent(savedNative)
        setLoadDashInput(savedNative.id)
        setIframeRev((r) => r + 1)
        const targetRoute = `/dashboard/${encodeURIComponent(savedNative.id)}`
        if (location.pathname !== targetRoute) {
          history.replace(targetRoute)
        }
        listUserDashboardArtifacts(core40SDK, extensionSDK, userId).then(setMyCreations)
        await refreshCatalog()
        setMessages([
          ...messagesWithUser,
          {
            ...prelimAssistantMsg,
            dashboardId: savedNative.id,
          },
        ])
      } else if (result.bundle) {
        setBusyStatus('Publishing inline extension & updating Looker dashboard...')
        const prelimAssistantMsg: ChatMessage = {
          role: 'assistant',
          text: result.assistantText,
          interactionId: result.session.lastInteractionId,
          widgetCount: result.bundle?.widgets?.length || 0,
        }
        const upserted = await upsertPublishedDataApp(
          core40SDK,
          result.bundle,
          selectedFolderId,
          publishedApp,
          {
            explores: effectiveExplores,
            lastInteractionId: result.session.lastInteractionId,
            environmentId: result.session.environmentId,
            messages: [...messagesWithUser, prelimAssistantMsg],
          }
        )
        lastPublishedIdRef.current = upserted.dashboardId
        setPublishedApp(upserted)
        setActiveObjectId(upserted.dashboardId)
        setCurrentAppCode(result.bundle.raw_code)
        setLoadDashInput(upserted.dashboardId)
        setIframeRev((r) => r + 1)
        try {
          await saveUserArtifact(
            core40SDK,
            userId,
            {
              id: upserted.dashboardId,
              type: 'app',
              title: upserted.title,
              explores: effectiveExplores,
              updatedAt: new Date().toISOString(),
              createdBy: userId,
            },
            {
              id: upserted.dashboardId,
              type: 'app',
              title: upserted.title,
              explores: effectiveExplores,
              updatedAt: new Date().toISOString(),
              createdBy: userId,
              dashboardId: upserted.dashboardId,
              extensionId: upserted.extensionId,
              rawCode: result.bundle.raw_code,
              messages: [
                ...messagesWithUser,
                {
                  ...prelimAssistantMsg,
                  dashboardId: upserted.dashboardId,
                },
              ],
            }
          )
          await refreshCatalog()
        } catch {
          // Non-fatal if artifacts API is unavailable
        }
        if (location.pathname !== `/${upserted.dashboardId}`) {
          history.replace(`/${encodeURIComponent(upserted.dashboardId)}`)
        }
        setMessages([
          ...messagesWithUser,
          {
            ...prelimAssistantMsg,
            dashboardId: upserted.dashboardId,
          },
        ])
      } else {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          text: result.assistantText,
          interactionId: result.session.lastInteractionId,
        }
        const nextMsgs = [...messagesWithUser, assistantMsg]
        setMessages(nextMsgs)
        if (builderMode === 'dashboard' && nativeContent) {
          const updatedNative = await saveNativeContentArtifact(
            core40SDK,
            extensionSDK,
            userId,
            { id: nativeContent.id, title: nativeContent.title, explores: effectiveExplores },
            selectedFolderId,
            nativeContent,
            {
              explores: effectiveExplores,
              lastInteractionId: result.session.lastInteractionId,
              environmentId: result.session.environmentId,
              messages: nextMsgs,
            }
          )
          setNativeContent(updatedNative)
          await refreshCatalog()
        } else if (publishedApp) {
          const updatedApp = await saveDashboardStudioMetadata(core40SDK, publishedApp, {
            explores: effectiveExplores,
            lastInteractionId: result.session.lastInteractionId,
            environmentId: result.session.environmentId,
            messages: nextMsgs,
          })
          setPublishedApp(updatedApp)
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: err?.message || String(err) },
      ])
    } finally {
      setPendingPerm(null)
      setBusyStatus(null)
    }
  }

  const hostUrl = (extensionSDK as any)?.lookerHostData?.hostUrl || window.location.origin
  const activePreviewId =
    builderMode === 'dashboard' ? nativeContent?.id : publishedApp?.dashboardId
  const embedUrl =
    builderMode === 'dashboard'
      ? nativeContent
        ? `${hostUrl.replace(/\/$/, '')}${nativeContent.embedPath}`
        : ''
      : publishedApp
      ? `${hostUrl.replace(/\/$/, '')}/embed/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
      : ''
  const openInLookerPath =
    builderMode === 'dashboard' && nativeContent
      ? nativeContent.embedPath.replace(/^\/embed/, '')
      : publishedApp
      ? `/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
      : ''

  if (isTileMount) {
    return <PythonTileMount />
  }

  if (
    location.pathname === '/script' ||
    location.pathname.startsWith('/script/') ||
    location.pathname === '/tile' ||
    location.pathname.startsWith('/tile/')
  ) {
    return (
      <ScriptStudioView
        auth={{
          mode: authMode,
          oauthToken,
          clientId,
          projectId,
          apiKey,
        }}
        schemaMarkdown={schemaMarkdown}
        selectedExplores={selectedExplores}
        selectedFolderId={selectedFolderId}
        folders={folders}
        onChangeFolder={setSelectedFolderId}
      />
    )
  }

  if (location.pathname === '/config') {
    return (
      <div className="dab-shell">
        <header className="dab-topbar">
          <div className="dab-brand">
            <strong>Data App Studio</strong>
            <span className="dab-badge">Configuration</span>
          </div>
        </header>
        <div className="dab-placeholder">
          <div className="dab-controls" style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <select
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as 'oauth' | 'apikey')}
            >
              <option value="oauth">Google OAuth</option>
              <option value="apikey">Gemini API Key (User Attr)</option>
            </select>

            {authMode === 'oauth' ? (
              <>
                <input
                  type="text"
                  placeholder="OAuth Client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  style={{ width: 220 }}
                />
                <input
                  type="text"
                  placeholder="GCP Project (opt)"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  style={{ width: 150 }}
                />
              </>
            ) : (
              <input
                type="password"
                placeholder="Default API Key (opt)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ width: 220 }}
                title={`Creates/updates hidden user attribute ${getGeminiUserAttributeName(
                  extensionSDK
                )}`}
              />
            )}
            <button
              type="button"
              className="dab-btn-primary"
              onClick={handleSaveAuthSetup}
              disabled={!!busyStatus}
            >
              Save Setup
            </button>
          </div>
          {busyStatus && (
            <div className="dab-status-banner" style={{ marginTop: 12 }}>
              <span className="dab-spinner" />
              <span>{busyStatus}</span>
            </div>
          )}
          {messages
            .filter((m) => m.role === 'error')
            .slice(-1)
            .map((m, i) => (
              <div key={i} className="dab-msg dab-msg-error" style={{ marginTop: 12 }}>
                {m.text}
              </div>
            ))}
        </div>
      </div>
    )
  }

  return (
    <div className="dab-shell">
      {/* Top Configuration Bar */}
      <header className="dab-topbar">
        <div className="dab-brand">
          <strong>Data App Studio</strong>
          <span className="dab-badge">Antigravity</span>
          <span className="dab-badge">
            {LkrCodeMode?.runPythonCode ? 'WASM CodeMode ✓' : 'WASM CodeMode (pending build)'}
          </span>
          <div className="dab-mode-switcher" role="tablist" aria-label="Tool Mode">
            {STUDIO_MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="tab"
                aria-selected={activeMode === m.mode}
                className={`dab-mode-tab ${activeMode === m.mode ? 'active' : ''}`}
                onClick={() => history.push(m.prefix)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="dab-btn-secondary"
            onClick={() => history.push('/script')}
          >
            Python Script (/script)
          </button>
          <button
            type="button"
            className={!isHealthCheckMode ? 'dab-btn-primary' : 'dab-btn-secondary'}
            onClick={() => history.push('/')}
          >
            Data App
          </button>
          <button
            type="button"
            className={isHealthCheckMode ? 'dab-btn-primary' : 'dab-btn-secondary'}
            onClick={() => history.push('/health-check')}
          >
            3-Pillar Health Check
          </button>
          {isHealthCheckMode && (
            <button
              type="button"
              className="dab-btn-primary"
              onClick={() => handleRunHealthCheck()}
              disabled={!!busyStatus}
            >
              ⚡ Run 3-Pillar Audit
            </button>
          )}
        </div>

        <div className="dab-controls">
          <label className="dab-field">
            <span>Mode</span>
            <select
              value={isLookmlMode ? 'lookml' : builderMode}
              onChange={(e) => {
                const nextMode = e.target.value as 'data_app' | 'dashboard' | 'lookml'
                if (nextMode === 'lookml') {
                  history.push(
                    lookmlBundle?.id
                      ? `/lookml/${encodeURIComponent(lookmlBundle.id)}`
                      : '/lookml'
                  )
                } else if (nextMode === 'dashboard') {
                  history.push(
                    nativeContent?.id
                      ? `/dashboard/${encodeURIComponent(nativeContent.id)}`
                      : '/dashboard'
                  )
                } else {
                  history.push(
                    publishedApp?.dashboardId
                      ? `/${encodeURIComponent(publishedApp.dashboardId)}`
                      : '/'
                  )
                }
              }}
            >
              <option value="data_app">Data App (Lit)</option>
              <option value="dashboard">Native Content (UDD / Look / Board)</option>
              <option value="lookml">Agentic LookML (.lkml)</option>
            </select>
          </label>

          <div className="dab-field" ref={comboRef}>
            <span>Explores</span>
            <div className="dab-combobox" onClick={() => setComboOpen(true)}>
              {selectedExplores.map((id) => {
                const info = exploreLookup[id]
                return (
                  <span key={id} className="dab-chip" title={id}>
                    {info ? `${info.modelLabel}: ${info.label}` : id}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedExplores((prev) => prev.filter((x) => x !== id))
                      }}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
              <input
                type="text"
                className="dab-combo-input"
                placeholder={
                  selectedExplores.length === 0
                    ? 'Search explores (or leave empty to let agent decide)...'
                    : 'Add explore...'
                }
                value={exploreSearch}
                onFocus={() => setComboOpen(true)}
                onChange={(e) => {
                  setExploreSearch(e.target.value)
                  setComboOpen(true)
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Backspace' &&
                    !exploreSearch &&
                    selectedExplores.length > 0
                  ) {
                    setSelectedExplores((prev) => prev.slice(0, -1))
                  } else if (e.key === 'Escape') {
                    setComboOpen(false)
                  }
                }}
              />
              {comboOpen && (
                <div className="dab-dropdown">
                  {selectedExplores.length > 0 && (
                    <div
                      className="dab-option"
                      style={{ color: '#2563eb', fontWeight: 600 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedExplores([])
                        setExploreSearch('')
                      }}
                    >
                      <span>Clear selection (let agent decide)</span>
                    </div>
                  )}
                  {groupedExplores.length === 0 ? (
                    <div className="dab-option" style={{ color: '#64748b' }}>
                      No matching explores
                    </div>
                  ) : (
                    groupedExplores.map((group) => (
                      <div key={group.modelName}>
                        <div className="dab-group-header">{group.label}</div>
                        {group.options.map((opt) => {
                          const isSelected = selectedExplores.includes(opt.value)
                          return (
                            <div
                              key={opt.value}
                              className={`dab-option ${
                                isSelected ? 'dab-option-selected' : ''
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleExploreSelection(opt.value)
                              }}
                              title={opt.value}
                            >
                              <span>{opt.label}</span>
                              {isSelected && (
                                <span className="dab-muted" style={{ fontSize: 11 }}>
                                  ✓
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {isLookmlMode ? (
            <>
              <label className="dab-field">
                <span>Project</span>
                <input
                  type="text"
                  placeholder="LookML project_id (opt)..."
                  value={lookmlProjectId}
                  onChange={(e) => setLookmlProjectId(e.target.value)}
                  style={{ width: 150 }}
                />
              </label>

              <div className="dab-divider" />

              <div className="dab-load-box">
                {lookmlSessions.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) loadLookmlSessionById(e.target.value, true)
                    }}
                  >
                    <option value="">Saved LookML ({lookmlSessions.length})...</option>
                    {lookmlSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} ({s.id})
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  placeholder="LookML Session ID..."
                  value={loadLookmlInput}
                  onChange={(e) => setLoadLookmlInput(e.target.value)}
                  style={{ width: 120 }}
                />
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() => loadLookmlSessionById(loadLookmlInput, true)}
                  disabled={!!busyStatus || !loadLookmlInput.trim()}
                >
                  Load LookML
                </button>
                {lookmlBundle && (
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={handleResetNewApp}
                    disabled={!!busyStatus}
                  >
                    New LookML
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="dab-field">
                <span>Folder</span>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="dab-divider" />

              <div className="dab-load-box">
                {builderMode === 'dashboard' && myCreations.length > 0 && (
                  <select
                    value={nativeContent?.id || ''}
                    onChange={(e) => {
                      if (e.target.value) loadNativeById(e.target.value, true)
                    }}
                    title="My Creations (indexed under user_${userId}_dashboard_${id})"
                  >
                    <option value="">My Creations ({myCreations.length})...</option>
                    {myCreations.map((c) => (
                      <option key={`${c.contentType}:${c.id}`} value={c.id}>
                        [{c.contentType}] {c.title} (#{c.id})
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  placeholder={
                    builderMode === 'dashboard' ? 'ID or look:ID...' : 'Dashboard ID...'
                  }
                  value={loadDashInput}
                  onChange={(e) => setLoadDashInput(e.target.value)}
                  style={{ width: 105 }}
                />
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={handleLoadExistingDashboard}
                  disabled={!!busyStatus || !loadDashInput.trim()}
                >
                  {builderMode === 'dashboard' ? 'Load Content' : 'Load App'}
                </button>
                {(publishedApp || nativeContent) && (
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={handleResetNewApp}
                    disabled={!!busyStatus}
                  >
                    {builderMode === 'dashboard' ? 'New Content' : 'New App'}
                  </button>
                )}
              </div>
            </>
          )}

          <div className="dab-divider" />

          {/* Auth Controls (User Sign-In) */}
          <div className="dab-auth-box">
            {authMode === 'oauth' ? (
              <button
                type="button"
                className={oauthToken ? 'dab-btn-secondary' : 'dab-btn-primary'}
                onClick={handleOAuthLogin}
              >
                {oauthToken ? '✓ Signed In' : 'Sign In'}
              </button>
            ) : (
              <span
                className="dab-badge"
                title={`Uses serverProxy + ${getGeminiUserAttributeName(extensionSDK)}`}
              >
                API Key (User Attr) ✓
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="dab-workspace">
        {/* Left Chat & Inspector Pane */}
        <aside className="dab-left-pane">
          <div className="dab-catalog-bar">
            <div className="dab-catalog-search">
              <strong style={{ fontSize: 12, color: '#334155', whiteSpace: 'nowrap' }}>
                My Creations ({filteredCatalog.length})
              </strong>
              <input
                type="text"
                placeholder="Search by title, ID, type, or explore..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                style={{
                  flex: 1,
                  padding: '3px 8px',
                  fontSize: 12,
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                }}
              />
            </div>
            {filteredCatalog.length > 0 && (
              <div className="dab-catalog-list">
                {filteredCatalog.map((item) => (
                  <span
                    key={`${item.type}:${item.id}`}
                    className={`dab-catalog-chip ${
                      activeObjectId === item.id ? 'active' : ''
                    }`}
                    onClick={() => handleSelectCatalogItem(item)}
                    title={`${item.type.toUpperCase()} #${item.id} · ${(item.explores || []).join(', ')}`}
                  >
                    <span>
                      [{item.type}] {item.title} (#{item.id})
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteCatalogItem(e, item)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 11,
                        color: '#94a3b8',
                      }}
                      title="Delete artifact"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
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
                <p>
                  {selectedExplores.length === 0 ? (
                    <>
                      <strong>Let Agent Decide:</strong> No explore pre-selected — Antigravity
                      will search across all {models.length} models using Looker&apos;s Solr{' '}
                      <code>search_content</code> &amp; <code>lookml_model_explore</code> in WASM
                      CodeMode.
                    </>
                  ) : (
                    <>
                      Compiled schema for{' '}
                      <code>{selectedExplores.join(', ')}</code>{' '}
                      {loadingSchema
                        ? 'is loading...'
                        : `is ready (${schemaMarkdown.length.toLocaleString()} chars).`}
                    </>
                  )}
                </p>
                <p>
                  {builderMode === 'dashboard'
                    ? 'Creates or updates native Looker UDDs, Looks, Boards, and Schedules via CodeMode, indexes them in your My Creations catalog, and previews them on the right.'
                    : "Every turn validates your app in Antigravity's Linux sandbox, registers widget queries, and auto-publishes the live Looker dashboard on the right."}
                </p>
              </div>
            )}

            {messages.map((m, idx) => (
              <div key={idx} className={`dab-msg dab-msg-${m.role}`}>
                <div className="dab-msg-header">
                  {m.role === 'user'
                    ? 'You'
                    : m.role === 'error'
                    ? 'Error'
                    : 'Antigravity'}
                  {m.dashboardId && (
                    <span className="dab-msg-pill">
                      Dashboard #{m.dashboardId}
                      {typeof m.widgetCount === 'number'
                        ? ` · ${m.widgetCount} queries`
                        : ''}
                    </span>
                  )}
                </div>
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

          <div className="dab-composer">
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
                      onClick={() =>
                        setPastedImages((prev) => prev.filter((_, idx) => idx !== i))
                      }
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
              placeholder="Describe the Data App to build or paste a screenshot (Cmd+Enter to send)..."
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
              <details className="dab-inspector">
                <summary>
                  Inspect Code / Schema {currentAppCode ? `(${currentAppCode.length} B)` : ''}
                </summary>
                <div className="dab-inspector-content">
                  {currentAppCode && (
                    <>
                      <div className="dab-inspector-bar">
                        <strong>app.js</strong>
                        <button
                          type="button"
                          className="dab-btn-secondary"
                          onClick={() => navigator.clipboard?.writeText(currentAppCode)}
                        >
                          Copy app.js
                        </button>
                      </div>
                      <pre>{currentAppCode}</pre>
                    </>
                  )}
                  <strong>Compiled Explore Schema (/workspace/schema.md)</strong>
                  <pre>{schemaMarkdown}</pre>
                  <div className="dab-inspector-bar">
                    <strong>Test WASM Code Mode (Monty)</strong>
                    <button
                      type="button"
                      className="dab-btn-secondary"
                      onClick={async () => {
                        try {
                          setCodeModeOutput('Running in WASM Monty sandbox...')
                          const firstParsed = selectedExplores[0]
                            ? parseExploreId(selectedExplores[0])
                            : null
                          const out = await LkrCodeMode.runPythonCode({
                            code: codeModeSnippet,
                            sdk: core40SDK,
                            extensionSDK,
                            allowUpdateSession: isLookmlMode,
                            vars: {
                              target_explores: selectedExplores,
                              target_model: firstParsed?.modelName || '',
                              target_explore: firstParsed?.exploreName || '',
                              target_folder_id: selectedFolderId,
                              target_project_id: lookmlProjectId,
                            },
                          })
                          setCodeModeOutput(out)
                        } catch (err: any) {
                          setCodeModeOutput(`Error: ${err?.message || err}`)
                        }
                      }}
                    >
                      Run Python
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={codeModeSnippet}
                    onChange={(e) => setCodeModeSnippet(e.target.value)}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      background: '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      padding: 6,
                    }}
                  />
                  {codeModeOutput && <pre>{codeModeOutput}</pre>}
                </div>
              </details>

              <button
                type="button"
                className="dab-btn-primary"
                onClick={handleSendPrompt}
                disabled={!!busyStatus || (!prompt.trim() && pastedImages.length === 0)}
              >
                {isLookmlMode
                  ? lookmlBundle
                    ? 'Update LookML'
                    : 'Run Agentic LookML'
                  : builderMode === 'dashboard'
                  ? nativeContent
                    ? 'Update Content'
                    : 'Build Content'
                  : publishedApp
                  ? 'Update App'
                  : 'Build App'}
              </button>
            </div>
          </div>
        </aside>

        {/* Right Live Embedded Dashboard, Agentic LookML, or Health Check TDD Pane */}
        <main className="dab-right-pane">
          {isHealthCheckMode ? (
            <>
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
                        (user_{healthReport.createdBy}_health_check_{healthReport.id} · obj_health_check_{healthReport.id})
                      </span>
                    </>
                  ) : (
                    <span className="dab-muted">
                      7-section TECHNICAL_DESIGN_DOCUMENT.md (0–100% health score) will render here
                    </span>
                  )}
                </div>
                {healthReport && (
                  <div className="dab-preview-actions">
                    <button
                      type="button"
                      className="dab-btn-secondary"
                      onClick={handleCopyTddMarkdown}
                    >
                      {copiedTdd ? '✓ Copied Markdown' : 'Copy Markdown'}
                    </button>
                    <button
                      type="button"
                      className="dab-btn-primary"
                      onClick={handleDownloadTddMarkdown}
                    >
                      Download Markdown (.md)
                    </button>
                  </div>
                )}
              </div>
              <div className="dab-iframe-container">
                {healthReport ? (
                  <div className="dab-tdd-viewer">
                    <pre className="dab-tdd-markdown">{healthReport.tddMarkdown}</pre>
                  </div>
                ) : (
                  <div className="dab-placeholder">
                    <p>No 3-Pillar Health Check report loaded yet.</p>
                    <p className="dab-muted">
                      Click <strong>⚡ Run 3-Pillar Audit</strong> in the top bar or enter a prompt on the left to execute Pillar 1 (System Activity), Pillar 2 (LookML 0–4 Transcriber Rubric), and Pillar 3 (BigQuery INFORMATION_SCHEMA) in <code>LkrCodeMode</code>.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : isLookmlMode ? (
            <>
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
                      Agentic LookML preview (.lkml diffs, validator, run_lookml_test &amp; /sql/:slug + /x/:slug parity)
                    </span>
                  )}
                </div>
              </div>
              <div className="dab-iframe-container">
                <LookmlPreviewPane
                  bundle={lookmlBundle}
                  hostUrl={hostUrl}
                  extensionSDK={extensionSDK}
                />
              </div>
            </>
          ) : (
            <>
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
                {activePreviewId && (
                  <div className="dab-preview-actions">
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
                  </div>
                )}
              </div>

              <div className="dab-iframe-container">
                {activePreviewId && embedUrl ? (
                  <iframe
                    key={`${builderMode}-${activePreviewId}-${iframeRev}`}
                    src={embedUrl}
                    title="Looker Live Preview"
                    className="dab-iframe"
                  />
                ) : (
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
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export const App = () => {
  return (
    <ExtensionProvider>
      <LookerExtensionProvider>
        <StudioMain />
      </LookerExtensionProvider>
    </ExtensionProvider>
  )
}
