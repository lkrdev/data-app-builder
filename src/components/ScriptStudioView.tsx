import React, { useCallback, useEffect, useState } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import {
  fetchInitialLookerMetadata,
  listSavedScripts,
  loadScriptArtifact,
  PersistedChatTurn,
  publishScriptDashboard,
  SavedScript,
  saveScriptArtifact,
  UserCapabilities,
} from '../lookerApi'
import {
  AgentSession,
  ANTIGRAVITY_ALLOWED_MODELS,
  AntigravityAuth,
  AntigravityModelOption,
  DEFAULT_ANTIGRAVITY_MODEL,
  LkrCodeMode,
  prewarmOrWakeAntigravityEnvironment,
  runAntigravityTurn,
} from '../antigravity'
import {
  DEFAULT_PYTHON_SCRIPT,
  PYTHON_TILE_SKILL_GUIDE,
  ScriptOutputRenderer,
} from './PythonTile'

export const ScriptStudioView: React.FC<{
  auth: AntigravityAuth
  selectedModel?: string
  availableModels?: AntigravityModelOption[]
  onChangeModel?: (model: string) => void
  schemaMarkdown: string
  selectedExplores: string[]
  selectedFolderId: string
  folders: Array<{ id: string; name: string }>
  onChangeFolder: (folderId: string) => void
  disabledModes?: string[]
  capabilities?: UserCapabilities
}> = ({
  auth,
  selectedModel = DEFAULT_ANTIGRAVITY_MODEL,
  availableModels = ANTIGRAVITY_ALLOWED_MODELS,
  onChangeModel,
  schemaMarkdown,
  selectedExplores,
  selectedFolderId,
  folders,
  onChangeFolder,
  disabledModes = [],
  capabilities,
}) => {
  const { extensionSDK, core40SDK } = useLookerExtension()
  const history = useHistory()
  const location = useLocation()

  const [userId, setUserId] = useState('1')
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [scriptId, setScriptId] = useState(
    () => `script_${Date.now().toString(36).slice(-5)}`
  )
  const [scriptTitle, setScriptTitle] = useState('Looker Explore Summary Script')
  const [scriptCode, setScriptCode] = useState(DEFAULT_PYTHON_SCRIPT)
  const [filtersJson, setFiltersJson] = useState('{}')
  const [scriptOutput, setScriptOutput] = useState('')
  const [messages, setMessages] = useState<PersistedChatTurn[]>([])
  const [prompt, setPrompt] = useState('')
  const [agentSession, setAgentSession] = useState<AgentSession>({
    toolType: 'tile',
    environmentId: 'env_tile_isolated',
  })
  const [busyStatus, setBusyStatus] = useState<string | null>(null)

  const handleWakeTileEnv = useCallback(async () => {
    try {
      const res = await prewarmOrWakeAntigravityEnvironment({
        extensionSDK,
        auth,
        toolType: 'tile',
        model: selectedModel,
        existingSession: agentSession,
        selectedExplores,
        schemaMarkdown,
        customSystemGuide: PYTHON_TILE_SKILL_GUIDE,
      } as any)
      setAgentSession(res.session)
    } catch {}
  }, [extensionSDK, auth, selectedModel, agentSession, selectedExplores, schemaMarkdown])

  useEffect(() => {
    handleWakeTileEnv()
  }, [])
  const [publishedDash, setPublishedDash] = useState<{
    dashboardId: string
    elementId: string
  } | null>(null)
  const [scriptMode, setScriptMode] = useState('summary')
  const [schedulerOpen, setSchedulerOpen] = useState(() =>
    Boolean(
      typeof window !== 'undefined' &&
        (window as any).__MOCK_LOOKER_EXTENSION__?.openSchedulerModal
    )
  )
  const [scheduleConfig, setScheduleConfig] = useState<{
    name: string
    cron: string
    mode: string
    customVarsJson: string
    destination: 'artifact_snapshot' | 'webhook' | 'looker_scheduled_plan'
    targetUrlOrEmail: string
    enabled: boolean
  }>({
    name: 'Daily Morning Explore & Filter Snapshot',
    cron: '0 8 * * *',
    mode: 'summary',
    customVarsJson: '{"region":"AMER","threshold":0.95}',
    destination: 'artifact_snapshot',
    targetUrlOrEmail: 'https://hooks.example.com/looker-script-webhook',
    enabled: true,
  })
  const [savedScheduleBadge, setSavedScheduleBadge] = useState<string | null>('0 8 * * * · summary')

  const refreshScriptsList = useCallback(
    async (uid: string) => {
      const list = await listSavedScripts(core40SDK, uid)
      setSavedScripts(list)
    },
    [core40SDK]
  )

  useEffect(() => {
    let mounted = true
    fetchInitialLookerMetadata(core40SDK)
      .then((meta) => {
        if (!mounted) return
        const uid = String(meta.user?.id || '1')
        setUserId(uid)
        refreshScriptsList(uid)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [core40SDK, refreshScriptsList])

  // Load script when route matches /script/:scriptId or /tile/:scriptId
  useEffect(() => {
    const m = location.pathname.match(/^\/(?:script|tile)\/([^/]+)\/?$/)
    const routeScriptId = m ? decodeURIComponent(m[1]).trim() : ''
    if (!routeScriptId) return
    let mounted = true
    loadScriptArtifact(core40SDK, routeScriptId).then((loaded) => {
      if (!mounted || !loaded) return
      setScriptId(loaded.id)
      setScriptTitle(loaded.title || loaded.id)
      setScriptCode(loaded.code || DEFAULT_PYTHON_SCRIPT)
      setMessages(loaded.messages || [])
      if (loaded.dashboardId) {
        setPublishedDash({
          dashboardId: loaded.dashboardId,
          elementId: loaded.elementId || '',
        })
      }
      if (loaded.code) {
        handleRunPython(loaded.code)
      }
    })
    return () => {
      mounted = false
    }
  }, [core40SDK, location.pathname])

  const handleRunPython = async (codeToRun = scriptCode) => {
    try {
      setBusyStatus('Running Python in WASM Monty sandbox...')
      let parsedFilters: Record<string, string> = {}
      try {
        parsedFilters = JSON.parse(filtersJson || '{}')
      } catch {
        parsedFilters = {}
      }
      const out = await LkrCodeMode.runPythonCode({
        code: codeToRun,
        sdk: core40SDK,
        extensionSDK,
        vars: {
          mode: scriptMode,
          dashboard_filters: { script_mode: scriptMode, ...parsedFilters },
          target_explores: selectedExplores,
          target_folder_id: selectedFolderId,
        },
      })
      setScriptOutput(out)
    } catch (err: any) {
      setScriptOutput(JSON.stringify({ error: err?.message || String(err) }))
    } finally {
      setBusyStatus(null)
    }
  }

  const handleSaveScript = async (
    overrideCode = scriptCode,
    overrideMsgs = messages,
    dashInfo = publishedDash
  ): Promise<SavedScript> => {
    const cleanId =
      scriptId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') ||
      `script_${Date.now().toString(36).slice(-5)}`
    setBusyStatus(`Saving script "${cleanId}" to Looker Artifacts...`)
    try {
      const saved = await saveScriptArtifact(core40SDK, userId, {
        id: cleanId,
        title: scriptTitle.trim() || cleanId,
        code: overrideCode,
        messages: overrideMsgs,
        updatedAt: new Date().toISOString(),
        ...(dashInfo?.dashboardId ? { dashboardId: dashInfo.dashboardId } : {}),
        ...(dashInfo?.elementId ? { elementId: dashInfo.elementId } : {}),
      })
      setScriptId(saved.id)
      await refreshScriptsList(userId)
      if (location.pathname !== `/script/${saved.id}`) {
        history.replace(`/script/${encodeURIComponent(saved.id)}`)
      }
      return saved
    } finally {
      setBusyStatus(null)
    }
  }

  const handlePublishDashboard = async () => {
    try {
      const saved = await handleSaveScript()
      setBusyStatus('Publishing extension-layout Looker dashboard & binding tile artifact...')
      const extId =
        (extensionSDK as any)?.lookerHostData?.extensionId ||
        'data_app_builder::data_app_builder'
      const pub = await publishScriptDashboard(core40SDK, {
        script: saved,
        folderId: selectedFolderId,
        extensionId: extId,
        existingDashboardId: publishedDash?.dashboardId,
      })
      const nextDash = { dashboardId: pub.dashboardId, elementId: pub.elementId }
      setPublishedDash(nextDash)
      await handleSaveScript(saved.code, saved.messages || [], nextDash)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Published Dashboard #${pub.dashboardId} (load_configuration="wait", show_dashboard_header=true, layout="extension") and bound tile_element_${pub.elementId} -> ${saved.id}.`,
          dashboardId: pub.dashboardId,
        },
      ])
    } catch (err: any) {
      setBusyStatus(null)
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: err?.message || String(err) },
      ])
    }
  }

  const handleSendChatPrompt = async () => {
    const text = prompt.trim()
    if (!text || busyStatus) return
    const nextUserTurn: PersistedChatTurn = { role: 'user', text }
    const turnsWithUser = [...messages, nextUserTurn]
    setPrompt('')
    setMessages(turnsWithUser)
    setBusyStatus('Asking Antigravity to write/update CodeMode Python script...')
    try {
      const scriptDirective = [
        `IMPORTANT: You are authoring a Looker CodeMode Monty Python script (NOT a Lit Data App).`,
        PYTHON_TILE_SKILL_GUIDE,
        `Write Python code that uses pre-bound Looker 4.0 SDK globals (e.g. run_inline_query, lookml_model_explore, search_content, all_lookml_models, create_dashboard_filter) and reads \`dashboard_filters\` and \`mode\` if present.`,
        `Test your snippet using \`run_looker_codemode\` first, then include the final script inside a \`\`\`python ... \`\`\` block ending with \`return ...\` (returning a list[dict] for a table, a Markdown/HTML string, or a dict).`,
        `Current script:\n\`\`\`python\n${scriptCode}\n\`\`\``,
        `User request: ${text}`,
      ].join('\n\n')
      const res = await runAntigravityTurn({
        sdk: core40SDK,
        extensionSDK,
        auth,
        session: agentSession,
        model: selectedModel,
        selectedExplores,
        folderId: selectedFolderId,
        schemaMarkdown,
        userPrompt: scriptDirective,
        priorMessages: messages,
        onStatus: setBusyStatus,
      })
      setAgentSession(res.session)
      const pyMatch = res.assistantText.match(/```python\s*([\s\S]*?)```/i)
      const extractedCode = pyMatch ? pyMatch[1].trim() : scriptCode
      if (pyMatch && extractedCode) {
        setScriptCode(extractedCode)
        await handleRunPython(extractedCode)
      }
      const nextTurns: PersistedChatTurn[] = [
        ...turnsWithUser,
        {
          role: 'assistant',
          text: res.assistantText,
          interactionId: res.session.lastInteractionId,
        },
      ]
      setMessages(nextTurns)
      await handleSaveScript(extractedCode, nextTurns)
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'error', text: err?.message || String(err) },
      ])
    } finally {
      setBusyStatus(null)
    }
  }

  return (
    <div className="dab-shell">
      <header className="dab-topbar">
        <div className="dab-brand">
          <strong>Agent</strong>
          <span className="dab-badge">Agentic LookML</span>
          <span className="dab-badge">WASM CodeMode ✓</span>
          <span
            className="dab-badge"
            onClick={handleWakeTileEnv}
            style={{
              cursor: 'pointer',
              background: '#ecfdf5',
              color: '#047857',
              borderColor: '#a7f3d0',
            }}
            title="Mode-isolated Antigravity sandbox environment (click to wake or reload)"
          >
            🟢 Env [tile]: {agentSession.environmentId || 'env_tile_isolated'}
          </span>
          {(() => {
            const enabledModes = (
              [
                { mode: 'app', label: 'Data App', prefix: '/app' },
                { mode: 'dashboard', label: 'Content Studio', prefix: '/dashboard' },
                { mode: 'lookml', label: 'LookML', prefix: '/lookml' },
                { mode: 'health', label: 'Health Check', prefix: '/health-check' },
                { mode: 'tile', label: 'Python Tile', prefix: '/tile' },
              ] as const
            ).filter((m) => !disabledModes.includes(m.mode))
            return enabledModes.length > 1 ? (
              <div className="dab-mode-switcher" role="tablist" aria-label="Tool Mode">
                {enabledModes.map((m) => {
                  const tc = capabilities?.rolesLoaded ? capabilities.tools?.[m.mode] : undefined
                  const locked = Boolean(tc && !tc.enabled)
                  const ro = Boolean(tc?.readOnly)
                  return (
                    <button
                      key={m.mode}
                      type="button"
                      role="tab"
                      aria-selected={m.mode === 'tile'}
                      title={tc?.reason}
                      className={`dab-mode-tab ${m.mode === 'tile' ? 'active' : ''}`}
                      onClick={() => history.push(m.prefix)}
                    >
                      {locked ? `🔒 ${m.label}` : ro ? `${m.label} 🔒` : m.label}
                    </button>
                  )
                })}
              </div>
            ) : null
          })()}
          <select
            data-testid="topbar-model-select"
            value={selectedModel}
            onChange={(e) => onChangeModel?.(e.target.value)}
            title="Select Antigravity model (/v1beta/models)"
            style={{ height: 26, fontSize: 11.5, padding: '0 6px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', fontWeight: 500 }}
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id} title={m.description}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="dab-controls">
          <label className="dab-field">
            <span>Saved Scripts</span>
            <select
              value={savedScripts.some((s) => s.id === scriptId) ? scriptId : ''}
              onChange={(e) => {
                const id = e.target.value
                if (id) history.push(`/script/${encodeURIComponent(id)}`)
              }}
            >
              <option value="">-- Select Saved Script --</option>
              {savedScripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.id})
                </option>
              ))}
            </select>
          </label>

          <label className="dab-field">
            <span>ID</span>
            <input
              type="text"
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
              style={{ width: 95 }}
            />
          </label>

          <label className="dab-field">
            <span>Title</span>
            <input
              type="text"
              value={scriptTitle}
              onChange={(e) => setScriptTitle(e.target.value)}
              style={{ width: 165 }}
            />
          </label>

          <label className="dab-field">
            <span>Mode</span>
            <select
              value={scriptMode}
              onChange={(e) => setScriptMode(e.target.value)}
              title="Custom script mode injected as vars.mode and dashboard_filters.script_mode"
            >
              <option value="summary">summary</option>
              <option value="detailed_audit">detailed_audit</option>
              <option value="anomaly_alert">anomaly_alert</option>
            </select>
          </label>

          <label className="dab-field">
            <span>Folder</span>
            <select
              value={selectedFolderId}
              onChange={(e) => onChangeFolder(e.target.value)}
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="dab-btn-secondary"
            onClick={() => {
              const newId = `script_${Date.now().toString(36).slice(-5)}`
              setScriptId(newId)
              setScriptTitle('Untitled Python Script')
              setScriptCode(DEFAULT_PYTHON_SCRIPT)
              setMessages([])
              setPublishedDash(null)
              history.push('/script')
            }}
          >
            New Script
          </button>

          <button
            type="button"
            className="dab-btn-secondary"
            onClick={() => handleSaveScript()}
            disabled={!!busyStatus}
          >
            Save Script
          </button>

          <button
            type="button"
            className="dab-btn-secondary"
            onClick={() => setSchedulerOpen(true)}
          >
            ⏰ Schedule Script
          </button>

          <button
            type="button"
            className="dab-btn-gemini"
            onClick={handlePublishDashboard}
            disabled={!!busyStatus}
          >
            ✨ Publish Dashboard
          </button>
        </div>
      </header>

      <div className="dab-workspace">
        <aside className="dab-left-pane">
          <div className="dab-chat-log">
            {messages.length === 0 && (
              <div className="dab-empty-chat">
                <strong>Scriptable CodeMode Python Authoring</strong>
                <p style={{ margin: '6px 0 0' }}>
                  Edit the Python script below or ask Antigravity to query Looker explores
                  and format a table (<code>list[dict]</code>), Markdown/HTML string, or
                  dict. Saves to <code>user_{'{userId}'}_script_{'{scriptId}'}</code> &amp;{' '}
                  <code>obj_script_{'{scriptId}'}</code>.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`dab-msg dab-msg-${m.role}`}>
                <div className="dab-msg-header">
                  {m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : 'Antigravity'}
                  {m.dashboardId && (
                    <span className="dab-msg-pill">Dashboard #{m.dashboardId}</span>
                  )}
                </div>
                <div className="dab-msg-body">{m.text}</div>
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
            <div className="dab-inspector-bar">
              <strong>Python Script (`LkrCodeMode.runPythonCode`)</strong>
              <button
                type="button"
                className="dab-btn-gemini"
                onClick={() => handleRunPython()}
                disabled={!!busyStatus}
              >
                ✨ Run Python
              </button>
            </div>
            <textarea
              rows={8}
              value={scriptCode}
              onChange={(e) => setScriptCode(e.target.value)}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                background: '#0f172a',
                color: '#f8fafc',
              }}
            />
            <label className="dab-field" style={{ width: '100%' }}>
              <span>Test `vars.dashboard_filters` / Custom Controls (JSON):</span>
              <input
                type="text"
                value={filtersJson}
                onChange={(e) => setFiltersJson(e.target.value)}
                style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
              />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Ask Agent to write or update Python script..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSendChatPrompt()
                  }
                }}
                style={{
                  flex: 1,
                  height: 30,
                  padding: '0 8px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                }}
              />
              <button
                type="button"
                className="dab-btn-gemini"
                onClick={handleSendChatPrompt}
                disabled={!!busyStatus || !prompt.trim()}
              >
                ✨ Ask AI
              </button>
            </div>
          </div>
        </aside>

        <main className="dab-right-pane">
          <div className="dab-preview-toolbar">
            <div>
              <strong>{scriptTitle}</strong>{' '}
              <span className="dab-muted">
                (Artifact <code>obj_script_{scriptId}</code>
                {publishedDash
                  ? ` · Dashboard #${publishedDash.dashboardId} · tile_element_${publishedDash.elementId}`
                  : ''}
                )
              </span>{' '}
              {savedScheduleBadge && (
                <span className="dab-badge" onClick={() => setSchedulerOpen(true)} style={{ cursor: 'pointer' }}>
                  ⏰ Scheduled: {savedScheduleBadge}
                </span>
              )}
            </div>
            <div className="dab-preview-actions">
              {publishedDash && (
                <button
                  type="button"
                  className="dab-btn-secondary"
                  onClick={() =>
                    extensionSDK.openBrowserWindow(
                      `/dashboards/${encodeURIComponent(publishedDash.dashboardId)}`,
                      '_blank'
                    )
                  }
                >
                  Open Dashboard #{publishedDash.dashboardId} ↗
                </button>
              )}
            </div>
          </div>

          <div className="dab-iframe-container" style={{ padding: 16, overflow: 'auto' }}>
            {scriptOutput ? (
              <ScriptOutputRenderer output={scriptOutput} />
            ) : (
              <div className="dab-placeholder">
                <p>Click &ldquo;✨ Run Python&rdquo; to execute in WASM Monty sandbox.</p>
                <p className="dab-muted">
                  Renders a table for <code>list[dict]</code>, HTML/Markdown for{' '}
                  <code>str</code>, or <code>&lt;pre&gt;</code> for <code>dict</code>.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      {schedulerOpen && (
        <div className="dab-modal-backdrop" onClick={() => setSchedulerOpen(false)}>
          <div className="dab-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 15 }}>⏰ Custom CodeMode Script Scheduler</strong>
                <div className="dab-muted" style={{ fontSize: 11.5 }}>
                  Schedule <code>obj_script_{scriptId}</code> with custom <code>vars.mode</code> &amp; non-query controls
                </div>
              </div>
              <span className="dab-badge">obj_schedule_{scriptId}</span>
            </div>

            <div className="dab-modal-row">
              <label>Schedule Name</label>
              <input
                type="text"
                value={scheduleConfig.name}
                onChange={(e) =>
                  setScheduleConfig((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="dab-modal-row">
                <label>Cron Cadence</label>
                <select
                  value={scheduleConfig.cron}
                  onChange={(e) =>
                    setScheduleConfig((prev) => ({ ...prev, cron: e.target.value }))
                  }
                >
                  <option value="0 8 * * *">Daily at 8:00 AM (0 8 * * *)</option>
                  <option value="0 * * * *">Hourly (0 * * * *)</option>
                  <option value="0 9 * * 1-5">Weekdays at 9:00 AM (0 9 * * 1-5)</option>
                  <option value="0 8 * * 1">Weekly Monday 8:00 AM (0 8 * * 1)</option>
                </select>
              </div>

              <div className="dab-modal-row">
                <label>Script Execution Mode (`vars.mode`)</label>
                <select
                  value={scheduleConfig.mode}
                  onChange={(e) =>
                    setScheduleConfig((prev) => ({ ...prev, mode: e.target.value }))
                  }
                >
                  <option value="summary">summary (Executive Rollup)</option>
                  <option value="detailed_audit">detailed_audit (Full Row Audit)</option>
                  <option value="anomaly_alert">anomaly_alert (Threshold Check)</option>
                </select>
              </div>
            </div>

            <div className="dab-modal-row">
              <label>Custom Controls / Non-Query Variables (`vars.custom_controls` JSON)</label>
              <input
                type="text"
                value={scheduleConfig.customVarsJson}
                onChange={(e) =>
                  setScheduleConfig((prev) => ({ ...prev, customVarsJson: e.target.value }))
                }
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="dab-modal-row">
                <label>Delivery Action</label>
                <select
                  value={scheduleConfig.destination}
                  onChange={(e) =>
                    setScheduleConfig((prev) => ({
                      ...prev,
                      destination: e.target.value as any,
                    }))
                  }
                >
                  <option value="artifact_snapshot">
                    Persist Snapshot Artifact (obj_script_run_{scriptId})
                  </option>
                  <option value="webhook">Webhook POST (JSON / Markdown)</option>
                  <option value="looker_scheduled_plan">
                    Looker Scheduled Plan Bridge (create_scheduled_plan)
                  </option>
                </select>
              </div>

              <div className="dab-modal-row">
                <label>Webhook URL / Recipient</label>
                <input
                  type="text"
                  value={scheduleConfig.targetUrlOrEmail}
                  onChange={(e) =>
                    setScheduleConfig((prev) => ({
                      ...prev,
                      targetUrlOrEmail: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() => setSchedulerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dab-btn-gemini"
                onClick={() => {
                  setSavedScheduleBadge(`${scheduleConfig.cron} · ${scheduleConfig.mode}`)
                  setScriptMode(scheduleConfig.mode)
                  setSchedulerOpen(false)
                }}
              >
                ✨ Save Script Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
