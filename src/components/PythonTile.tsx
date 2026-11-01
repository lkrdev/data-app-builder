import React, { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import {
  bindTileScriptArtifact,
  getArtifactNamespace,
  listSavedScripts,
  loadScriptArtifact,
  loadTileScriptArtifact,
  SavedScript,
  TileScriptBinding,
} from '../lookerApi'
import { LkrCodeMode } from '../antigravity'
import { ScriptOutputRenderer, renderMarkdownOrHtmlString } from './ScriptStudioView'
export { ScriptOutputRenderer, renderMarkdownOrHtmlString }

export const PYTHON_TILE_SKILL_GUIDE = [
  `# Skill: codemode-script-tile (Scriptable CodeMode Python Tiles, Custom Controls & Scheduling)`,
  `1. **Unbound Custom Dashboard Filters (Non-Query / Non-Parameter Filters)**:`,
  `   - Looker UDDs support pure UI filters via \`create_dashboard_filter({"dashboard_id": dash_id, "name": "script_mode", "title": "Script Mode", "type": "string_filter", "default_value": "summary", "allow_multiple_values": False, "ui_config": {"type": "button_toggles", "display": "inline", "options": ["summary", "detailed_audit", "anomaly_alert"]}})\` with NO \`model\`, \`explore\`, or \`dimension\` required.`,
  `   - Any unbound filter value selected by the user is passed directly into \`dashboard_filters["script_mode"]\` inside \`LkrCodeMode.runPythonCode\`.`,
  `2. **Multi-Mode & Variable-Driven Python Scripts**:`,
  `   - Always read \`filters = dashboard_filters if isinstance(dashboard_filters, dict) else {}\` and \`active_mode = mode if "mode" in globals() else filters.get("script_mode", "summary")\`.`,
  `   - Branch script behavior by \`active_mode\` (e.g., \`"summary"\` returns a KPI/model rollup table, \`"detailed_audit"\` runs deeper \`run_inline_query\` breakdowns, \`"anomaly_alert"\` returns Markdown alerts for scheduled runs).`,
  `3. **Custom Script Scheduling (\`obj_schedule_<scriptId>\`)**:`,
  `   - Scripts can be scheduled independently of Looker dashboard emails via the Studio Scheduler (\`obj_schedule_<scriptId>\`), injecting \`mode\` and \`custom_controls\` on each scheduled run.`,
].join('\n')

export const DEFAULT_PYTHON_SCRIPT = `# Looker CodeMode Python Runner (Monty WASM)
# Supports unbound custom dashboard filters (e.g. script_mode) & scheduled vars.mode
try:
    filters = dashboard_filters if isinstance(dashboard_filters, dict) else {}
except Exception:
    filters = {}
try:
    active_mode = mode if isinstance(mode, str) and mode else filters.get("script_mode", "summary")
except Exception:
    active_mode = filters.get("script_mode", "summary")
models = all_lookml_models(fields="name,label,explores(name,label,hidden)")
rows = []
for m in (models or [])[:8]:
    vis = [e for e in (m.get("explores") or []) if not e.get("hidden")]
    rows.append({
        "model": m.get("name"),
        "label": m.get("label") or m.get("name"),
        "mode": active_mode,
        "explore_count": len(vis),
        "sample_explore": vis[0].get("name") if vis else "",
        "active_filters": len(filters),
    })
return rows
`

export const PythonTile: React.FC = () => {
  const { extensionSDK, core40SDK, tileHostData } = useLookerExtension()
  const elementId = String(tileHostData?.elementId || '')
  const isEditing = Boolean(tileHostData?.isDashboardEditing)
  const dashboardRunState = tileHostData?.dashboardRunState
  const filtersJson = JSON.stringify(tileHostData?.dashboardFilters || {})

  const namespace = getArtifactNamespace(extensionSDK)
  const { data: swrBinding, error: bindingError } = useSWR<TileScriptBinding | null>(
    elementId ? ['artifact:tile_script', namespace, elementId] : null,
    () => loadTileScriptArtifact(core40SDK, elementId, namespace).catch(() => null)
  )
  const { data: swrScripts } = useSWR<SavedScript[]>(
    isEditing ? ['artifact:scripts', namespace, undefined] : null,
    () => listSavedScripts(core40SDK, undefined, namespace).catch(() => [])
  )

  const [localBinding, setLocalBinding] = useState<TileScriptBinding | null | undefined>(undefined)
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const runningRef = useRef(false)
  const lastRunStateRef = useRef<string | undefined>(dashboardRunState)
  const lastExecutedFiltersRef = useRef<string | null>(null)

  const binding = localBinding !== undefined ? localBinding : swrBinding ?? null
  const scripts = swrScripts || []
  const bindingLoaded =
    !elementId || swrBinding !== undefined || Boolean(bindingError) || localBinding !== undefined

  useEffect(() => {
    extensionSDK?.updateTitle?.('')
  }, [extensionSDK])

  useEffect(() => {
    setLocalBinding(undefined)
    lastExecutedFiltersRef.current = null
  }, [core40SDK, elementId])

  useEffect(() => {
    if (binding?.scriptId) {
      setSelectedScriptId((prev) => prev || binding.scriptId)
    }
  }, [binding?.scriptId])

  const executeBoundScript = useCallback(
    async (
      overrideBinding?: TileScriptBinding | null,
      overrideFilters?: Record<string, any>
    ) => {
      const code = (overrideBinding ?? binding)?.code
      if (!code || runningRef.current) return
      const dashboardFilters = overrideFilters ?? tileHostData?.dashboardFilters ?? {}
      runningRef.current = true
      setRunning(true)
      try {
        const out = await LkrCodeMode.runPythonCode({
          code,
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
        runningRef.current = false
        setRunning(false)
      }
    },
    [binding, core40SDK, extensionSDK, tileHostData?.dashboardFilters]
  )

  // Auto-execute on initial load when binding.code resolves, and re-execute on dashboardRunState -> 'RUNNING' or dashboardFilters change
  useEffect(() => {
    const prevRunState = lastRunStateRef.current
    lastRunStateRef.current = dashboardRunState
    if (isEditing || !bindingLoaded || !binding?.code) return
    if (
      lastExecutedFiltersRef.current !== filtersJson ||
      (dashboardRunState === 'RUNNING' && prevRunState !== 'RUNNING')
    ) {
      lastExecutedFiltersRef.current = filtersJson
      executeBoundScript(binding, tileHostData?.dashboardFilters)
    }
  }, [
    binding,
    bindingLoaded,
    dashboardRunState,
    executeBoundScript,
    filtersJson,
    isEditing,
    tileHostData?.dashboardFilters,
  ])

  // Notify Looker host (PDF/PNG renderer & Scheduled Plans) only after React commits and browser paints DOM
  useEffect(() => {
    const readyAfterRun = !isEditing && !running && output !== null
    const readyWithoutRun =
      bindingLoaded && (!isEditing || swrScripts !== undefined) && (!binding?.code || isEditing)
    if (!readyAfterRun && !readyWithoutRun) return

    const fire = () => extensionSDK?.rendered?.()
    if (typeof requestAnimationFrame !== 'function') {
      const timer = setTimeout(fire, 0)
      return () => clearTimeout(timer)
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(fire)
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [binding?.code, bindingLoaded, extensionSDK, isEditing, output, running, swrScripts])

  const handleBindScript = async (scriptId: string) => {
    setSelectedScriptId(scriptId)
    const chosen =
      scripts.find((s) => s.id === scriptId) ||
      (scriptId ? await loadScriptArtifact(core40SDK, scriptId, namespace) : null)
    if (!chosen || !elementId) return
    setStatusMsg('Saving tile script binding...')
    const nextBinding = await bindTileScriptArtifact(
      core40SDK,
      elementId,
      {
        scriptId: chosen.id,
        code: chosen.code,
        title: chosen.title,
      },
      namespace
    )
    setLocalBinding(nextBinding)
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
            onClick={() => executeBoundScript()}
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
              onClick={() => executeBoundScript()}
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

export { ScriptStudioView } from './ScriptStudioView'
