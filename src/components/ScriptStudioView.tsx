import React from 'react'
import { renderTddMarkdownToHtml } from '../healthCheck'
import type { StudioController } from '../useStudioController'
import { StudioSelect } from './StudioSelect'

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
      (typeof parsed[0] === 'object' && parsed[0] !== null && !Array.isArray(parsed[0])))
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

export const TilePreviewPane: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    scriptId,
    setScriptId,
    scriptTitle,
    setScriptTitle,
    scriptCode,
    setScriptCode,
    filtersJson,
    setFiltersJson,
    scriptOutput,
    scriptMode,
    setScriptMode,
    savedScripts,
    publishedTileDash,
    schedulerOpen,
    setSchedulerOpen,
    scheduleConfig,
    setScheduleConfig,
    savedScheduleBadge,
    setSavedScheduleBadge,
    handleRunPython,
    handleSaveScript,
    handlePublishTileDashboard,
    loadScriptById,
    busyStatus,
    extensionSDK,
    setInfoModalUseCase,
  } = ctl

  return (
    <>
      <div className="dab-preview-toolbar" data-testid="tile-preview-toolbar">
        <div
          data-testid="tile-toolbar-title-block"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
          <strong>{scriptTitle}</strong>
          <span className="dab-muted">
            (Artifact <code>obj_script_{scriptId}</code>
            {publishedTileDash
              ? ` · Dashboard #${publishedTileDash.dashboardId} · tile_element_${publishedTileDash.elementId}`
              : ''}
            )
          </span>
          {savedScheduleBadge && (
            <span
              className="dab-badge"
              onClick={() => setSchedulerOpen(true)}
              style={{ cursor: 'pointer' }}
            >
              ⏰ Scheduled: {savedScheduleBadge}
            </span>
          )}
        </div>
        <div className="dab-preview-actions">
          {savedScripts.length > 0 && (
            <StudioSelect
              testId="tile-saved-scripts-select"
              className="dab-select"
              value={savedScripts.some((s) => s.id === scriptId) ? scriptId : ''}
              onChange={(val) => {
                if (val) loadScriptById(val, true)
              }}
              options={[
                { value: '', label: '-- Select Saved Script --' },
                ...savedScripts.map((s) => ({
                  value: s.id,
                  label: `${s.title} (${s.id})`,
                })),
              ]}
            />
          )}
          <StudioSelect
            testId="tile-mode-select"
            className="dab-select"
            value={scriptMode}
            onChange={setScriptMode}
            title="Custom script mode injected as vars.mode and dashboard_filters.script_mode"
            options={[
              { value: 'summary', label: 'summary' },
              { value: 'detailed_audit', label: 'detailed_audit' },
              { value: 'anomaly_alert', label: 'anomaly_alert' },
            ]}
          />
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
            onClick={handlePublishTileDashboard}
            disabled={!!busyStatus}
          >
            ✨ Publish Dashboard
          </button>
          {publishedTileDash && (
            <button
              type="button"
              className="dab-btn-secondary"
              onClick={() =>
                extensionSDK.openBrowserWindow(
                  `/dashboards/${encodeURIComponent(publishedTileDash.dashboardId)}`,
                  '_blank'
                )
              }
            >
              Open Dashboard #{publishedTileDash.dashboardId} ↗
            </button>
          )}
          <button
            type="button"
            data-testid="use-case-info-btn"
            className="dab-btn dab-btn-secondary dab-info-trigger"
            title="Use case guide & controls reference"
            onClick={() => setInfoModalUseCase('tile')}
          >
            ?
          </button>
        </div>
      </div>

      <div
        className="dab-iframe-container"
        style={{ padding: 14, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--dab-surface-muted, #f8fafc)',
            border: '1px solid var(--dab-border, #e2e8f0)',
            borderRadius: 8,
            padding: 10,
          }}
        >
          <div className="dab-inspector-bar" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong>Python Script (`LkrCodeMode.runPythonCode`)</strong>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="dab-input"
                data-testid="tile-script-id-input"
                value={scriptId}
                onChange={(e) => setScriptId(e.target.value)}
                placeholder="script_id"
                style={{ width: 95, fontSize: 11.5 }}
              />
              <input
                type="text"
                className="dab-input"
                data-testid="tile-script-title-input"
                value={scriptTitle}
                onChange={(e) => setScriptTitle(e.target.value)}
                placeholder="Script title"
                style={{ width: 165, fontSize: 11.5 }}
              />
              <button
                type="button"
                data-testid="tile-run-python-btn"
                className="dab-btn-gemini"
                onClick={() => handleRunPython()}
                disabled={!!busyStatus}
              >
                ✨ Run Python
              </button>
            </div>
          </div>
          <textarea
            rows={5}
            data-testid="tile-script-editor"
            value={scriptCode}
            onChange={(e) => setScriptCode(e.target.value)}
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              background: 'var(--dab-code-bg, #0f172a)',
              color: '#f8fafc',
              borderRadius: 6,
              padding: 8,
            }}
          />
          <label
            className="dab-field"
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>Test `vars.dashboard_filters` / Custom Controls (JSON):</span>
            <input
              type="text"
              className="dab-input"
              data-testid="tile-filters-json-input"
              value={filtersJson}
              onChange={(e) => setFiltersJson(e.target.value)}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
            />
          </label>
        </div>

        <div data-testid="tile-script-output" style={{ flex: 1, minHeight: 160 }}>
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
                <StudioSelect
                  testId="scheduler-cron-select"
                  value={scheduleConfig.cron}
                  onChange={(val) => setScheduleConfig((prev) => ({ ...prev, cron: val }))}
                  options={[
                    { value: '0 8 * * *', label: 'Daily at 8:00 AM (0 8 * * *)' },
                    { value: '0 * * * *', label: 'Hourly (0 * * * *)' },
                    { value: '0 9 * * 1-5', label: 'Weekdays at 9:00 AM (0 9 * * 1-5)' },
                    { value: '0 8 * * 1', label: 'Weekly Monday 8:00 AM (0 8 * * 1)' },
                  ]}
                />
              </div>

              <div className="dab-modal-row">
                <label>Script Execution Mode (`vars.mode`)</label>
                <StudioSelect
                  testId="scheduler-mode-select"
                  value={scheduleConfig.mode}
                  onChange={(val) => setScheduleConfig((prev) => ({ ...prev, mode: val }))}
                  options={[
                    { value: 'summary', label: 'summary (Executive Rollup)' },
                    { value: 'detailed_audit', label: 'detailed_audit (Full Row Audit)' },
                    { value: 'anomaly_alert', label: 'anomaly_alert (Threshold Check)' },
                  ]}
                />
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
                <StudioSelect
                  testId="scheduler-destination-select"
                  value={scheduleConfig.destination}
                  onChange={(val) =>
                    setScheduleConfig((prev) => ({
                      ...prev,
                      destination: val as any,
                    }))
                  }
                  options={[
                    {
                      value: 'artifact_snapshot',
                      label: `Persist Snapshot Artifact (obj_script_run_${scriptId})`,
                    },
                    { value: 'webhook', label: 'Webhook POST (JSON / Markdown)' },
                    {
                      value: 'looker_scheduled_plan',
                      label: 'Looker Scheduled Plan Bridge (create_scheduled_plan)',
                    },
                  ]}
                />
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
    </>
  )
}

export const ScriptStudioView = TilePreviewPane
