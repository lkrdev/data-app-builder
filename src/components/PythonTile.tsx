import React, { useCallback, useEffect, useRef, useState } from 'react'

import useSWR from 'swr'

import { LkrCodeMode } from '../antigravity'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import {
  getArtifactNamespace,
  loadTileScriptFromElement,
  saveTileScriptToElement,
  type TileElementScriptPayload,
} from '../lookerApi'
import { renderMarkdownOrHtmlString, ScriptOutputRenderer } from './ScriptStudioView'
import { StudioBadge, StudioButton } from './StudioDesignSystem'

export { renderMarkdownOrHtmlString, ScriptOutputRenderer }

export const PYTHON_TILE_SKILL_GUIDE = [
  `# Skill: codemode-script-tile (Scriptable CodeMode Python Tiles, Custom Controls & Scheduling)`,
  `1. **Unbound Custom Dashboard Filters (Non-Query / Non-Parameter Filters)**:`,
  `   - Looker UDDs support pure UI filters via \`create_dashboard_filter({"dashboard_id": dash_id, "name": "script_mode", "title": "Script Mode", "type": "string_filter", "default_value": "summary", "allow_multiple_values": False, "ui_config": {"type": "button_toggles", "display": "inline", "options": ["summary", "detailed_audit", "anomaly_alert"]}})\` with NO \`model\`, \`explore\`, or \`dimension\` required.`,
  `   - Any unbound filter value selected by the user is passed directly into \`dashboard_filters["script_mode"]\` inside \`LkrCodeMode.runPythonCode\`.`,
  `2. **Multi-Mode & Variable-Driven Python Scripts**:`,
  `   - Always read \`filters = dashboard_filters if isinstance(dashboard_filters, dict) else {}\` and \`active_mode = mode if "mode" in globals() else filters.get("script_mode", "summary")\`.`,
  `   - Branch script behavior by \`active_mode\` (e.g., \`"summary"\` returns a KPI/model rollup table, \`"detailed_audit"\` runs deeper \`run_inline_query\` breakdowns, \`"anomaly_alert"\` returns Markdown alerts for scheduled runs).`,
  `3. **Custom Script Scheduling**:`,
  `   - Scripts can be scheduled independently of Looker dashboard emails via the Studio Scheduler, injecting \`mode\` and \`custom_controls\` on each scheduled run.`,
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
  const {
    data: swrBinding,
    error: bindingError,
    mutate: mutateTileScript,
  } = useSWR<TileElementScriptPayload | null>(
    elementId ? ['tile:rich_content_script', elementId, namespace] : null,
    () => loadTileScriptFromElement(core40SDK, elementId, namespace).catch(() => null)
  )

  const [localBinding, setLocalBinding] = useState<TileElementScriptPayload | null | undefined>(undefined)
  const [editTitle, setEditTitle] = useState('')
  const [editCode, setEditCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const runningRef = useRef(false)
  const hydratedEditKeyRef = useRef('')
  const lastRunStateRef = useRef<string | undefined>(dashboardRunState)
  const lastExecutedFiltersRef = useRef<string | null>(null)

  const binding = localBinding !== undefined ? localBinding : swrBinding ?? null
  const bindingLoaded =
    !elementId || swrBinding !== undefined || Boolean(bindingError) || localBinding !== undefined

  useEffect(() => {
    extensionSDK?.updateTitle?.('')
  }, [extensionSDK])

  useEffect(() => {
    setLocalBinding(undefined)
    hydratedEditKeyRef.current = ''
    lastExecutedFiltersRef.current = null
  }, [core40SDK, elementId])

  useEffect(() => {
    if (!isEditing) {
      hydratedEditKeyRef.current = ''
      return
    }
    if (!bindingLoaded) return
    const key = `${elementId}:${binding?.updatedAt || (binding?.code ? 'bound' : 'unbound')}`
    if (hydratedEditKeyRef.current === key) return
    hydratedEditKeyRef.current = key
    setEditTitle(binding?.title || 'Python Script Tile')
    setEditCode(binding?.code || DEFAULT_PYTHON_SCRIPT)
  }, [binding?.code, binding?.title, binding?.updatedAt, bindingLoaded, elementId, isEditing])

  const executeBoundScript = useCallback(
    async (
      overrideBinding?: Pick<TileElementScriptPayload, 'code'> | null,
      overrideFilters?: Record<string, unknown>
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
      } catch (err: unknown) {
        setOutput(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
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
      void executeBoundScript(binding, tileHostData?.dashboardFilters)
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
  }, [binding?.code, bindingLoaded, extensionSDK, isEditing, output, running])

  const handleSaveTileScript = async () => {
    if (!elementId || saving) return
    setSaving(true)
    setStatusMsg('Saving tile script to dashboard element...')
    try {
      const saved = await saveTileScriptToElement(core40SDK, elementId, {
        scriptId: binding?.scriptId || `tile_${elementId}`,
        title: editTitle,
        code: editCode,
      })
      hydratedEditKeyRef.current = `${elementId}:${saved.updatedAt}`
      setLocalBinding(saved)
      void mutateTileScript(saved, false)
      setStatusMsg(`Saved "${saved.title}" to tile #${elementId} (rich_content_json)`)
      await executeBoundScript(saved, tileHostData?.dashboardFilters)
    } catch (err: unknown) {
      setStatusMsg(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  if (isEditing) {
    return (
      <div className="dab-tile-edit" data-testid="tile-edit-mode">
        <div className="dab-tile-edit-header">
          <strong>CodeMode Python Tile Configuration</strong>
          <StudioBadge tone="neutral">Tile #{elementId || 'unsaved'}</StudioBadge>
        </div>
        <div className="dab-tile-edit-field">
          <label className="dab-tile-edit-label" htmlFor="tile-script-title-input">
            Script Title
          </label>
          <input
            id="tile-script-title-input"
            type="text"
            className="dab-input"
            data-testid="tile-script-title-input"
            value={editTitle}
            disabled={!bindingLoaded || saving}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Python Script Tile"
            style={{ width: '100%' }}
          />
        </div>
        <div className="dab-tile-edit-field">
          <label className="dab-tile-edit-label" htmlFor="tile-script-code-input">
            Monty Python Code
          </label>
          <textarea
            id="tile-script-code-input"
            className="dab-input dab-tile-code-input"
            data-testid="tile-script-code-input"
            rows={8}
            value={editCode}
            disabled={!bindingLoaded || saving}
            onChange={(e) => setEditCode(e.target.value)}
          />
        </div>
        <div className="dab-tile-edit-actions">
          <StudioButton
            type="button"
            variant="primary"
            testId="tile-script-save-btn"
            disabled={!elementId || !bindingLoaded || saving || running || !editCode.trim()}
            onClick={() => {
              void handleSaveTileScript()
            }}
          >
            {saving ? 'Saving…' : 'Save Tile Script'}
          </StudioButton>
          {statusMsg && (
            <span className="dab-muted" data-testid="tile-script-status">
              {statusMsg}
            </span>
          )}
        </div>
        {output !== null && (
          <div data-testid="tile-edit-live-preview" style={{ minWidth: 0 }}>
            <ScriptOutputRenderer output={output} />
          </div>
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
            onClick={() => {
              void executeBoundScript()
            }}
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
              onClick={() => {
                void executeBoundScript()
              }}
              disabled={running}
            >
              {running ? 'Running Python…' : '▶ Run Script'}
            </button>
          ) : (
            <span className="dab-muted">
              No script bound to tile #{elementId || '?'}. Enter Dashboard Edit mode to
              author and save a Python script.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export { ScriptStudioView } from './ScriptStudioView'
