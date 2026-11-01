import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import {
  bindTileScriptArtifact,
  listSavedScripts,
  loadScriptArtifact,
  loadTileScriptArtifact,
  SavedScript,
  TileScriptBinding,
} from '../lookerApi'
import { LkrCodeMode } from '../antigravity'
import { renderTddMarkdownToHtml } from '../healthCheck'

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

// ponytail: reuse shared zero-dependency Markdown renderer from healthCheck.ts
export function renderMarkdownOrHtmlString(input: string): string {
  const trimmed = input.trim()
  if (/^<[a-zA-Z][^>]*>[\s\S]*<\/[a-zA-Z0-9]+>\s*$/.test(trimmed)) {
    return trimmed
  }
  return renderTddMarkdownToHtml(trimmed)
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
        <table className="dab-py-table dab-tile-table">
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
  const dashboardRunState = tileHostData?.dashboardRunState
  const filtersJson = JSON.stringify(tileHostData?.dashboardFilters || {})

  const [scripts, setScripts] = useState<SavedScript[]>([])
  const [binding, setBinding] = useState<TileScriptBinding | null>(null)
  const [bindingLoaded, setBindingLoaded] = useState(false)
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [completedRunCount, setCompletedRunCount] = useState(0)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const runningRef = useRef(false)
  const initialRunCompletedRef = useRef(false)
  const lastRunStateRef = useRef<string | undefined>(dashboardRunState)
  const lastFiltersJsonRef = useRef<string>(filtersJson)

  useEffect(() => {
    extensionSDK?.updateTitle?.('')
  }, [extensionSDK])

  // Load tile binding and (when in edit mode) available scripts
  useEffect(() => {
    let mounted = true
    setBindingLoaded(false)
    initialRunCompletedRef.current = false
    const load = async () => {
      const loadedBinding = elementId
        ? await loadTileScriptArtifact(core40SDK, elementId).catch(() => null)
        : null
      const list = isEditing ? await listSavedScripts(core40SDK).catch(() => []) : null
      if (!mounted) return
      setBinding(loadedBinding)
      setSelectedScriptId(loadedBinding?.scriptId || '')
      if (list) setScripts(list)
      setBindingLoaded(true)
    }
    load()
    return () => {
      mounted = false
    }
  }, [core40SDK, elementId, isEditing])

  const executeBoundScript = useCallback(
    async (
      overrideBinding?: TileScriptBinding | null,
      overrideFilters?: Record<string, any>
    ) => {
      const activeBinding =
        overrideBinding && typeof (overrideBinding as any).code === 'string'
          ? overrideBinding
          : binding
      if (!activeBinding?.code || runningRef.current) return
      const dashboardFilters =
        overrideFilters && typeof overrideFilters === 'object'
          ? overrideFilters
          : tileHostData?.dashboardFilters || {}
      runningRef.current = true
      setRunning(true)
      try {
        const out = await LkrCodeMode.runPythonCode({
          code: activeBinding.code,
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
        setCompletedRunCount((c) => c + 1)
        runningRef.current = false
        setRunning(false)
      }
    },
    [binding, core40SDK, extensionSDK, tileHostData?.dashboardFilters]
  )

  // Auto-execute once on initial load when binding.code resolves, and re-execute on dashboardRunState -> 'RUNNING' or dashboardFilters change
  useEffect(() => {
    const prevRunState = lastRunStateRef.current
    lastRunStateRef.current = dashboardRunState
    if (isEditing || !bindingLoaded || !binding?.code) return

    if (!initialRunCompletedRef.current) {
      initialRunCompletedRef.current = true
      lastFiltersJsonRef.current = filtersJson
      executeBoundScript(binding, tileHostData?.dashboardFilters)
      return
    }

    const runStateTriggered =
      dashboardRunState === 'RUNNING' && prevRunState !== 'RUNNING'
    const filtersChanged = filtersJson !== lastFiltersJsonRef.current
    if (filtersChanged) {
      lastFiltersJsonRef.current = filtersJson
    }
    if (runStateTriggered || filtersChanged) {
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
    const readyWithoutRun = bindingLoaded && (!binding?.code || isEditing)
    if (!readyAfterRun && !readyWithoutRun) return

    const fireRendered = () => {
      extensionSDK?.rendered?.()
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      let raf2 = 0
      const raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(fireRendered)
      })
      return () => {
        if (typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(raf1)
          if (raf2) window.cancelAnimationFrame(raf2)
        }
      }
    }
    const timer = setTimeout(fireRendered, 0)
    return () => clearTimeout(timer)
  }, [
    binding?.code,
    bindingLoaded,
    completedRunCount,
    extensionSDK,
    isEditing,
    output,
    running,
  ])

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
