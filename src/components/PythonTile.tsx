import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import {
  bindTileScriptArtifact,
  fetchInitialLookerMetadata,
  listSavedScripts,
  loadScriptArtifact,
  loadTileScriptArtifact,
  PersistedChatTurn,
  publishScriptDashboard,
  SavedScript,
  saveScriptArtifact,
  TileScriptBinding,
} from '../lookerApi'
import {
  AgentSession,
  AntigravityAuth,
  LkrCodeMode,
  runAntigravityTurn,
} from '../antigravity'

export const DEFAULT_PYTHON_SCRIPT = `# Looker CodeMode Python Runner (Monty WASM)
# dashboard_filters is injected from Looker's native filter bar on Run.
try:
    filters = dashboard_filters if isinstance(dashboard_filters, dict) else {}
except Exception:
    filters = {}
models = all_lookml_models(fields="name,label,explores(name,label,hidden)")
rows = []
for m in (models or [])[:8]:
    vis = [e for e in (m.get("explores") or []) if not e.get("hidden")]
    rows.append({
        "model": m.get("name"),
        "label": m.get("label") or m.get("name"),
        "explore_count": len(vis),
        "sample_explore": vis[0].get("name") if vis else "",
        "active_filters": len(filters),
    })
return rows
`

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ponytail: minimal zero-dependency Markdown-to-HTML converter for string return values
export function renderMarkdownOrHtmlString(input: string): string {
  const trimmed = input.trim()
  if (/^<[a-zA-Z][^>]*>[\s\S]*<\/[a-zA-Z0-9]+>\s*$/.test(trimmed)) {
    return trimmed
  }
  const formatInline = (line: string) =>
    escapeHtml(line)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      )

  return trimmed
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((raw) => {
      const l = raw.trimEnd()
      if (l.startsWith('### ')) return `<h3>${formatInline(l.slice(4))}</h3>`
      if (l.startsWith('## ')) return `<h2>${formatInline(l.slice(3))}</h2>`
      if (l.startsWith('# ')) return `<h1>${formatInline(l.slice(2))}</h1>`
      if (/^[-*]\s+/.test(l)) return `<li>${formatInline(l.replace(/^[-*]\s+/, ''))}</li>`
      return `<p>${formatInline(l)}</p>`
    })
    .join('\n')
    .replace(/(?:<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
}

export const ScriptOutputRenderer: React.FC<{ output: string }> = ({ output }) => {
  const parsed = (() => {
    const trimmed = String(output ?? '').trim()
    if (!trimmed) return ''
    try {
      return JSON.parse(trimmed)
    } catch {
      return output
    }
  })()

  if (
    Array.isArray(parsed) &&
    (parsed.length === 0 ||
      (typeof parsed[0] === 'object' &&
        parsed[0] !== null &&
        !Array.isArray(parsed[0])))
  ) {
    if (parsed.length === 0) {
      return <div className="dab-py-empty">0 rows returned.</div>
    }
    const colSet = new Set<string>()
    for (const row of parsed) {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach((k) => colSet.add(k))
      }
    }
    const columns: string[] = Array.from(colSet)
    return (
      <div className="dab-py-table-wrap">
        <table className="dab-py-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.map((row: Record<string, any>, rIdx: number) => (
              <tr key={rIdx}>
                {columns.map((col) => {
                  const v = row?.[col]
                  const cellText =
                    v === null || v === undefined
                      ? ''
                      : typeof v === 'object'
                      ? JSON.stringify(v)
                      : String(v)
                  return <td key={col}>{cellText}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (typeof parsed === 'string') {
    return (
      <div
        className="dab-py-markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdownOrHtmlString(parsed) }}
      />
    )
  }

  return <pre className="dab-py-pre">{JSON.stringify(parsed, null, 2)}</pre>
}

export const PythonTile: React.FC = () => {
  const { extensionSDK, core40SDK, tileHostData } = useLookerExtension()
  const elementId = String(tileHostData?.elementId || '')
  const isEditing = Boolean(tileHostData?.isDashboardEditing)
  const dashboardFilters = tileHostData?.dashboardFilters || {}
  const dashboardRunState = tileHostData?.dashboardRunState

  const [scripts, setScripts] = useState<SavedScript[]>([])
  const [binding, setBinding] = useState<TileScriptBinding | null>(null)
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const lastRunStateRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    extensionSDK?.updateTitle?.('')
  }, [extensionSDK])

  // Load tile binding and (when in edit mode) available scripts
  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (elementId) {
        const loadedBinding = await loadTileScriptArtifact(core40SDK, elementId)
        if (mounted && loadedBinding) {
          setBinding(loadedBinding)
          setSelectedScriptId(loadedBinding.scriptId)
        }
      }
      if (isEditing) {
        const list = await listSavedScripts(core40SDK)
        if (mounted) setScripts(list)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [core40SDK, elementId, isEditing])

  const executeBoundScript = useCallback(async () => {
    if (!binding?.code || running) return
    setRunning(true)
    try {
      const out = await LkrCodeMode.runPythonCode({
        code: binding.code,
        sdk: core40SDK,
        extensionSDK,
        vars: {
          dashboard_filters: dashboardFilters,
        },
      })
      setOutput(out)
    } catch (err: any) {
      setOutput(JSON.stringify({ error: err?.message || String(err) }))
    } finally {
      setRunning(false)
      extensionSDK?.rendered?.()
    }
  }, [binding?.code, core40SDK, dashboardFilters, extensionSDK, running])

  // Trigger script execution when Looker's native dashboard Run button fires
  useEffect(() => {
    if (isEditing || !binding?.code) return
    const prev = lastRunStateRef.current
    lastRunStateRef.current = dashboardRunState
    if (dashboardRunState === 'RUNNING' && prev !== 'RUNNING') {
      executeBoundScript()
    }
  }, [dashboardRunState, isEditing, binding?.code, executeBoundScript])

  const handleBindScript = async (scriptId: string) => {
    setSelectedScriptId(scriptId)
    const chosen =
      scripts.find((s) => s.id === scriptId) ||
      (scriptId ? await loadScriptArtifact(core40SDK, scriptId) : null)
    if (!chosen || !elementId) return
    setStatusMsg('Saving tile script binding...')
    const nextBinding = await bindTileScriptArtifact(core40SDK, elementId, {
      scriptId: chosen.id,
      code: chosen.code,
      title: chosen.title,
    })
    setBinding(nextBinding)
    setStatusMsg(`Bound "${chosen.title}" to tile #${elementId}`)
  }

  if (isEditing) {
    return (
      <div className="dab-tile-edit">
        <div className="dab-tile-edit-header">
          <strong>CodeMode Python Tile Configuration</strong>
          <span className="dab-badge">Tile #{elementId || 'unsaved'}</span>
        </div>
        <label className="dab-tile-select-row">
          <span>Saved Script (`search_artifacts`):</span>
          <select
            value={selectedScriptId}
            onChange={(e) => handleBindScript(e.target.value)}
          >
            <option value="">-- Select a saved Python script --</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.id})
              </option>
            ))}
          </select>
        </label>
        {statusMsg && <div className="dab-muted">{statusMsg}</div>}
        {binding?.code && (
          <pre className="dab-py-pre" style={{ maxHeight: 200 }}>
            {binding.code}
          </pre>
        )}
      </div>
    )
  }

  // View Mode: render only the return value of the script (plus in-tile Run trigger)
  return (
    <div className="dab-tile-view">
      {output !== null ? (
        <>
          <button
            type="button"
            className="dab-tile-run-floating"
            onClick={executeBoundScript}
            disabled={running || !binding?.code}
            title="Re-run Python script with current dashboard_filters"
          >
            {running ? 'Running…' : '▶ Run'}
          </button>
          <ScriptOutputRenderer output={output} />
        </>
      ) : (
        <div className="dab-tile-idle">
          {binding?.code ? (
            <button
              type="button"
              className="dab-btn-primary"
              onClick={executeBoundScript}
              disabled={running}
            >
              {running ? 'Running Python…' : '▶ Run Script'}
            </button>
          ) : (
            <span className="dab-muted">
              No script bound to tile #{elementId || '?'}. Enter Dashboard Edit mode to
              select a script.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export const ScriptStudioView: React.FC<{
  auth: AntigravityAuth
  schemaMarkdown: string
  selectedExplores: string[]
  selectedFolderId: string
  folders: Array<{ id: string; name: string }>
  onChangeFolder: (folderId: string) => void
}> = ({
  auth,
  schemaMarkdown,
  selectedExplores,
  selectedFolderId,
  folders,
  onChangeFolder,
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
  const [agentSession, setAgentSession] = useState<AgentSession>({})
  const [busyStatus, setBusyStatus] = useState<string | null>(null)
  const [publishedDash, setPublishedDash] = useState<{
    dashboardId: string
    elementId: string
  } | null>(null)

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
          dashboard_filters: parsedFilters,
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
        `Write Python code that uses pre-bound Looker 4.0 SDK globals (e.g. run_inline_query, lookml_model_explore, search_content, all_lookml_models) and reads \`dashboard_filters\` if present.`,
        `Test your snippet using \`run_looker_codemode\` first, then include the final script inside a \`\`\`python ... \`\`\` block ending with \`return ...\` (returning a list[dict] for a table, a Markdown/HTML string, or a dict).`,
        `Current script:\n\`\`\`python\n${scriptCode}\n\`\`\``,
        `User request: ${text}`,
      ].join('\n\n')
      const res = await runAntigravityTurn({
        sdk: core40SDK,
        extensionSDK,
        auth,
        session: agentSession,
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
          <strong>Data App Studio</strong>
          <span className="dab-badge">Antigravity</span>
          <span className="dab-badge">WASM CodeMode ✓</span>
          <div className="dab-mode-switcher" role="tablist" aria-label="Tool Mode">
            {[
              { mode: 'app', label: 'Data App', prefix: '/app' },
              { mode: 'dashboard', label: 'Dashboard', prefix: '/dashboard' },
              { mode: 'lookml', label: 'LookML', prefix: '/lookml' },
              { mode: 'health', label: 'Health Check', prefix: '/health-check' },
              { mode: 'tile', label: 'Python Tile', prefix: '/tile' },
            ].map((m) => (
              <button
                key={m.mode}
                type="button"
                role="tab"
                aria-selected={m.mode === 'tile'}
                className={`dab-mode-tab ${m.mode === 'tile' ? 'active' : ''}`}
                onClick={() => history.push(m.prefix)}
              >
                {m.label}
              </button>
            ))}
          </div>
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
              style={{ width: 115 }}
            />
          </label>

          <label className="dab-field">
            <span>Title</span>
            <input
              type="text"
              value={scriptTitle}
              onChange={(e) => setScriptTitle(e.target.value)}
              style={{ width: 190 }}
            />
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
            className="dab-btn-primary"
            onClick={handlePublishDashboard}
            disabled={!!busyStatus}
          >
            Publish Dashboard
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
                className="dab-btn-primary"
                onClick={() => handleRunPython()}
                disabled={!!busyStatus}
              >
                ▶ Run Python
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
              <span>Test `vars.dashboard_filters` (JSON):</span>
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
                placeholder="Ask Antigravity to write or update Python script..."
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
                className="dab-btn-secondary"
                onClick={handleSendChatPrompt}
                disabled={!!busyStatus || !prompt.trim()}
              >
                Ask AI
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
              </span>
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
                <p>Click &ldquo;▶ Run Python&rdquo; to execute in WASM Monty sandbox.</p>
                <p className="dab-muted">
                  Renders a table for <code>list[dict]</code>, HTML/Markdown for{' '}
                  <code>str</code>, or <code>&lt;pre&gt;</code> for <code>dict</code>.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
