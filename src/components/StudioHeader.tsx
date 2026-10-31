import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getGeminiUserAttributeName, LkrCodeMode } from '../antigravity'
import { formatExploreId } from '../lookerApi'
import { StudioController } from '../useStudioController'
import { STUDIO_MODES } from './App'

export const ConfigSetupView: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    authMode,
    setAuthMode,
    clientId,
    setClientId,
    projectId,
    setProjectId,
    apiKey,
    setApiKey,
    extensionSDK,
    busyStatus,
    messages,
    handleSaveAuthSetup,
  } = ctl
  const errorText = messages.filter((m) => m.role === 'error').slice(-1)[0]?.text

  return (
    <div className="dab-shell">
      <header className="dab-topbar">
        <div className="dab-brand">
          <strong>Agent</strong>
          <span className="dab-badge">Agentic LookML</span>
          <span className="dab-badge">Configuration</span>
        </div>
      </header>
      <div className="dab-placeholder">
        <div
          style={{
            background: '#fff',
            padding: '22px 26px',
            borderRadius: 12,
            border: '1px solid #cbd5e1',
            boxShadow: '0 10px 25px rgba(15,23,42,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 460,
          }}
        >
          <div>
            <strong style={{ fontSize: 16 }}>Agent &amp; Vertex / Gemini Setup</strong>
            <div className="dab-muted" style={{ fontSize: 12, marginTop: 2 }}>
              Configure extension-wide authentication (`extensionSDK.saveContextData`)
            </div>
          </div>
          <div className="dab-controls">
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
              className="dab-btn-gemini"
              onClick={handleSaveAuthSetup}
              disabled={!!busyStatus}
            >
              ✨ Save Setup
            </button>
          </div>
        </div>
        {busyStatus && (
          <div className="dab-status-banner" style={{ marginTop: 12 }}>
            <span className="dab-spinner" />
            <span>{busyStatus}</span>
          </div>
        )}
        {errorText && (
          <div className="dab-msg dab-msg-error" style={{ marginTop: 12 }}>
            {errorText}
          </div>
        )}
      </div>
    </div>
  )
}

export const StudioTopbar: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    activeMode,
    agentSession,
    handleWakeModeEnv,
    history,
    requirePermission,
    setRequirePermission,
    models,
    selectedExplores,
    setSelectedExplores,
    isLookmlMode,
    isHealthCheckMode,
    builderMode,
    lookmlProjectId,
    setLookmlProjectId,
    lookmlSessions,
    loadLookmlInput,
    setLoadLookmlInput,
    loadLookmlSessionById,
    lookmlBundle,
    folders,
    selectedFolderId,
    setSelectedFolderId,
    myCreations,
    nativeContent,
    publishedApp,
    healthReport,
    loadDashInput,
    setLoadDashInput,
    handleLoadExistingDashboard,
    loadNativeById,
    handleResetNewApp,
    authMode,
    oauthToken,
    handleOAuthLogin,
    extensionSDK,
    healthScope,
    setHealthScope,
    handleRunHealthCheck,
    busyStatus,
  } = ctl

  const mockExt =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  const [exploreSearch, setExploreSearch] = useState('')
  const [comboOpen, setComboOpen] = useState(() => Boolean(mockExt?.initialComboOpen))
  const comboRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (comboOpen && dropdownRef.current && typeof mockExt?.initialExploreScrollTop === 'number') {
      dropdownRef.current.scrollTop = mockExt.initialExploreScrollTop
    }
  }, [comboOpen, models.length, mockExt?.initialExploreScrollTop])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

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
      prev.includes(exploreId) ? prev.filter((id) => id !== exploreId) : [...prev, exploreId]
    )
    setExploreSearch('')
  }

  return (
    <header className="dab-topbar">
      <div className="dab-brand">
        <strong>Agent</strong>
        <span className="dab-badge">Agentic LookML</span>
        <span className="dab-badge">
          {LkrCodeMode?.runPythonCode ? 'WASM CodeMode ✓' : 'WASM CodeMode (pending build)'}
        </span>
        <span
          className="dab-badge"
          onClick={() => handleWakeModeEnv(activeMode)}
          style={{
            cursor: 'pointer',
            background: '#ecfdf5',
            color: '#047857',
            borderColor: '#a7f3d0',
          }}
          title="Mode-isolated Antigravity sandbox environment (click to wake or reload)"
        >
          🟢 Env [{activeMode}]: {agentSession.environmentId || `env_${activeMode}_isolated`}
        </span>
        <div className="dab-mode-switcher" role="tablist" aria-label="Tool Mode">
          {STUDIO_MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={activeMode === m.mode}
              className={`dab-mode-tab ${activeMode === m.mode ? 'active' : ''}`}
              onClick={() => {
                const target =
                  m.mode === 'app' && publishedApp?.dashboardId
                    ? `/app/${encodeURIComponent(publishedApp.dashboardId)}`
                    : m.mode === 'dashboard' && nativeContent?.id
                    ? `/dashboard/${encodeURIComponent(nativeContent.id)}`
                    : m.mode === 'lookml' && lookmlBundle?.id
                    ? `/lookml/${encodeURIComponent(lookmlBundle.id)}`
                    : m.mode === 'health' && healthReport?.id
                    ? `/health-check/${encodeURIComponent(healthReport.id)}`
                    : m.prefix
                history.push(target)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dab-controls">
        <button
          type="button"
          data-testid="permission-mode-toggle"
          className={requirePermission ? 'dab-btn-secondary' : 'dab-btn-primary'}
          onClick={() => setRequirePermission((prev) => !prev)}
          title="Toggle whether mutating Looker SDK calls require interactive user approval or auto-approve"
        >
          {requirePermission ? '🛡️ Safe Mode (Ask)' : '⚡ Auto-Approve (YOLO)'}
        </button>

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
                if (e.key === 'Backspace' && !exploreSearch && selectedExplores.length > 0) {
                  setSelectedExplores((prev) => prev.slice(0, -1))
                } else if (e.key === 'Escape') {
                  setComboOpen(false)
                }
              }}
            />
            {comboOpen && (
              <div className="dab-dropdown" ref={dropdownRef}>
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
                            className={`dab-option ${isSelected ? 'dab-option-selected' : ''}`}
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
                placeholder={builderMode === 'dashboard' ? 'ID or look:ID...' : 'Dashboard ID...'}
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
          {isHealthCheckMode && (
            <>
              <select
                value={healthScope}
                onChange={(e) => setHealthScope(e.target.value as any)}
                title="Select Looker Health Check, BigQuery Health Check, or Combined 3-Pillar Audit"
              >
                <option value="all">All 3 Pillars (Looker + BQ)</option>
                <option value="looker">Looker Only (Pillars 1 &amp; 2)</option>
                <option value="bq">BigQuery Only (Pillar 3)</option>
              </select>
              <button
                type="button"
                className="dab-btn-gemini"
                onClick={() => handleRunHealthCheck()}
                disabled={!!busyStatus}
              >
                ✨ Run 3-Pillar Audit
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
