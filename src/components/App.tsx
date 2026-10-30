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
  extractExploreIdsFromCode,
  fetchInitialLookerMetadata,
  formatExploreId,
  listUserDashboardArtifacts,
  loadExistingDashboardApp,
  loadNativeContentById,
  NativeContentState,
  NativeContentType,
  parseExploreId,
  PublishedAppState,
  saveDashboardStudioMetadata,
  saveNativeContentArtifact,
  upsertPublishedDataApp,
} from '../lookerApi'
import {
  AgentSession,
  AntigravityAuth,
  ensureGeminiApiKeyUserAttribute,
  ExtensionAuthContextConfig,
  getGeminiUserAttributeName,
  LkrCodeMode,
  loginWithGoogleOAuth,
  PastedImage,
  runAntigravityTurn,
} from '../antigravity'
import '../styles/index.css'

interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  images?: string[]
  interactionId?: string
  dashboardId?: string
  widgetCount?: number
}

const StudioMain: React.FC = () => {
  const { extensionSDK, core40SDK } = useLookerExtension()
  const history = useHistory()
  const location = useLocation()

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

  // App, Native Content & Agent session state
  const builderMode: 'data_app' | 'dashboard' = /^\/dashboard(?:\/|$)/.test(
    location.pathname
  )
    ? 'dashboard'
    : 'data_app'
  const [publishedApp, setPublishedApp] = useState<PublishedAppState | null>(null)
  const [nativeContent, setNativeContent] = useState<NativeContentState | null>(null)
  const [myCreations, setMyCreations] = useState<
    Array<{ id: string; title: string; contentType: NativeContentType; embedPath: string }>
  >([])
  const lastPublishedIdRef = useRef<string>('')
  const lastNativeIdRef = useRef<string>('')
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

  // Redirect to /config if extension auth is not configured yet
  useEffect(() => {
    if (!isConfigured && location.pathname !== '/config') {
      history.replace('/config')
    }
  }, [isConfigured, location.pathname, history])

  // Auto-load content when opened via route (/dashboard/:id for Native Content, or /:dashboardId / /dashboards/:dashboardId for Data Apps)
  useEffect(() => {
    if (location.pathname === '/config') return
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
    location.pathname,
    publishedApp?.dashboardId,
    nativeContent?.id,
    loadDashboardById,
    loadNativeById,
  ])

  const handleLoadExistingDashboard = async () => {
    if (builderMode === 'dashboard') {
      await loadNativeById(loadDashInput, true)
    } else {
      await loadDashboardById(loadDashInput, true)
    }
  }

  const handleResetNewApp = () => {
    lastPublishedIdRef.current = ''
    lastNativeIdRef.current = ''
    setPublishedApp(null)
    setNativeContent(null)
    setCurrentAppCode('')
    setLoadDashInput('')
    setSelectedExplores([])
    setAgentSession({})
    setMessages([])
    setPastedImages([])
    const baseRoute = builderMode === 'dashboard' ? '/dashboard' : '/'
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
        schemaMarkdown,
        userPrompt: effectivePrompt,
        images: attachedImages,
        existingAppCode: currentAppCode || undefined,
        existingNativeContent: nativeContent,
        priorMessages: messages,
        onStatus: setBusyStatus,
      })

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
        setCurrentAppCode(result.bundle.raw_code)
        setLoadDashInput(upserted.dashboardId)
        setIframeRev((r) => r + 1)
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
            {
              id: nativeContent.id,
              content_type: nativeContent.contentType,
              title: nativeContent.title,
              folder_id: nativeContent.folderId,
              embed_path: nativeContent.embedPath,
              tile_count: nativeContent.tileCount,
              filter_count: nativeContent.filterCount,
              schedule_id: nativeContent.scheduleId,
              explores: effectiveExplores,
            },
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
      ? nativeContent.contentType === 'look'
        ? `/looks/${encodeURIComponent(nativeContent.id)}`
        : nativeContent.contentType === 'board'
        ? `/boards/${encodeURIComponent(nativeContent.id)}`
        : `/dashboards/${encodeURIComponent(nativeContent.id)}`
      : publishedApp
      ? `/dashboards/${encodeURIComponent(publishedApp.dashboardId)}`
      : ''

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
        </div>

        <div className="dab-controls">
          <label className="dab-field">
            <span>Mode</span>
            <select
              value={builderMode}
              onChange={(e) => {
                const nextMode = e.target.value as 'data_app' | 'dashboard'
                if (nextMode === 'dashboard') {
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
                            vars: {
                              target_explores: selectedExplores,
                              target_model: firstParsed?.modelName || '',
                              target_explore: firstParsed?.exploreName || '',
                              target_folder_id: selectedFolderId,
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
                {builderMode === 'dashboard'
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

        {/* Right Live Embedded Dashboard Pane */}
        <main className="dab-right-pane">
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
