import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getGeminiUserAttributeName, LkrCodeMode } from '../antigravity'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import { formatExploreId, LookerFolderNode } from '../lookerApi'
import {
  ResolvedStudioTheme,
  StudioController,
  StudioThemeMode,
} from '../useStudioController'
import { STUDIO_MODES } from './App'

export const FullScreenToggleButton: React.FC = () => {
  const { extensionSDK, lookerHostData } = useLookerExtension()
  const location = useLocation()
  if (lookerHostData?.mountPoint && lookerHostData.mountPoint !== 'standalone') return null
  const isSpartan = lookerHostData?.hostType === 'spartan'
  const extensionId = lookerHostData?.extensionId || 'data_app_builder::data_app_builder'
  const handleToggleFullScreen = () => {
    if (!extensionSDK) return
    const subRoute = `${location.pathname === '/' ? '' : location.pathname}${location.search || ''}${location.hash || ''}`
    extensionSDK.updateLocation(`${isSpartan ? '/extensions' : '/spartan'}/${extensionId}${subRoute}`, undefined, '_top')
  }
  return (
    <button
      type="button"
      data-testid="topbar-fullscreen-toggle"
      className="dab-btn dab-btn-secondary"
      onClick={handleToggleFullScreen}
      title={`Switch between /extensions/${extensionId} and /spartan/${extensionId}`}
    >
      {isSpartan ? '⤡ Exit Full Screen' : '⤢ Full Screen'}
    </button>
  )
}

import { StudioSelect, ThemeModeIcon } from './StudioSelect'
export { StudioSelect, ThemeModeIcon }
export type { StudioSelectOption, StudioSelectProps } from './StudioSelect'

export const ThemeModeSelect: React.FC<{
  themeMode: StudioThemeMode
  resolvedTheme: ResolvedStudioTheme
  onChange: (mode: StudioThemeMode) => void
}> = ({ themeMode, resolvedTheme, onChange }) => (
  <StudioSelect
    testId="topbar-theme-select"
    optionTestIdPrefix="topbar-theme"
    value={themeMode}
    onChange={(val) => onChange(val as StudioThemeMode)}
    ariaLabel="Theme Mode"
    title={`Theme mode: ${themeMode} (active: ${resolvedTheme})`}
    iconOnly
    align="right"
    triggerIcon={<ThemeModeIcon mode={themeMode} />}
    extraAttrs={{
      'data-theme-mode': themeMode,
      'data-resolved-theme': resolvedTheme,
    }}
    options={[
      { value: 'light', label: 'Light', icon: <ThemeModeIcon mode="light" /> },
      { value: 'dark', label: 'Dark', icon: <ThemeModeIcon mode="dark" /> },
      { value: 'system', label: 'System', icon: <ThemeModeIcon mode="system" /> },
    ]}
  />
)

export const ConfigSetupView: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    themeMode,
    resolvedTheme,
    setThemeMode,
    authMode,
    setAuthMode,
    clientId,
    setClientId,
    projectId,
    setProjectId,
    disabledModes,
    setDisabledModes,
    selectedModel,
    setSelectedModel,
    availableModels,
    enabledModes,
    apiKey,
    setApiKey,
    oauthRedirectUri,
    capabilities,
    extensionSDK,
    busyStatus,
    messages,
    handleSaveAuthSetup,
  } = ctl
  const [copiedRedirectUri, setCopiedRedirectUri] = useState(false)
  const errorText = messages.filter((m) => m.role === 'error').slice(-1)[0]?.text
  const canSaveContext = capabilities?.canConfigureExtension !== false
  const canManageAttrs = capabilities?.canManageUserAttributes !== false
  const saveDisabled =
    !!busyStatus || !canSaveContext || (authMode === 'apikey' && !canManageAttrs)

  return (
    <div className="dab-shell" data-theme={resolvedTheme} data-theme-mode={themeMode}>
      <header className="dab-topbar">
        <div className="dab-brand">
          <strong>Agent</strong>
          <span className="dab-badge">Agentic LookML</span>
          <span className="dab-badge">Configuration</span>
        </div>
        <div className="dab-controls">
          <ThemeModeSelect
            themeMode={themeMode}
            resolvedTheme={resolvedTheme}
            onChange={setThemeMode}
          />
          <FullScreenToggleButton />
        </div>
      </header>
      <div className="dab-placeholder">
        <div
          style={{
            background: 'var(--dab-surface, #fff)',
            color: 'var(--dab-text, #1f2937)',
            padding: '22px 26px',
            borderRadius: 12,
            border: '1px solid var(--dab-border-strong, #cbd5e1)',
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
            <StudioSelect
              testId="config-auth-mode-select"
              value={authMode}
              onChange={(val) => setAuthMode(val as 'oauth' | 'apikey')}
              options={[
                { value: 'oauth', label: 'Google OAuth' },
                { value: 'apikey', label: 'Gemini API Key (User Attr)' },
              ]}
            />

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
                disabled={!canManageAttrs}
                title={
                  !canManageAttrs
                    ? 'Requires Looker "manage_user_attributes" or "admin" permission'
                    : `Creates/updates hidden user attribute ${getGeminiUserAttributeName(
                        extensionSDK
                      )}`
                }
              />
            )}
            <button
              type="button"
              className="dab-btn-gemini"
              onClick={handleSaveAuthSetup}
              disabled={saveDisabled}
              title={
                !canSaveContext
                  ? 'Requires Looker "develop" or "admin" permission to save shared extension context'
                  : authMode === 'apikey' && !canManageAttrs
                  ? 'Requires Looker "manage_user_attributes" or "admin" permission'
                  : undefined
              }
            >
              ✨ Save Setup
            </button>
          </div>
          {authMode === 'oauth' && (
            <div className="dab-oauth-redirect-helper">
              <div className="dab-oauth-redirect-row">
                <span>
                  <strong>Authorized redirect URI:</strong>{' '}
                  <code data-testid="config-oauth-redirect-uri">{oauthRedirectUri}</code>
                </span>
                <button
                  type="button"
                  data-testid="config-copy-redirect-uri-btn"
                  className="dab-btn-secondary"
                  style={{ height: 24, fontSize: 11, padding: '0 8px' }}
                  onClick={() => {
                    navigator.clipboard?.writeText?.(oauthRedirectUri)
                    setCopiedRedirectUri(true)
                    setTimeout(() => setCopiedRedirectUri(false), 1800)
                  }}
                >
                  {copiedRedirectUri ? '✓ Copied Redirect URI' : 'Copy Redirect URI'}
                </button>
              </div>
              <div className="dab-muted" style={{ fontSize: 11 }}>
                Add this URI under <strong>Authorized redirect URIs</strong> on your GCP Web OAuth 2.0
                Client ID to avoid <code>Error 400: redirect_uri_mismatch</code>.
              </div>
            </div>
          )}
          <div
            style={{
              borderTop: '1px solid var(--dab-border, #e2e8f0)',
              paddingTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 12,
            }}
          >
            <strong style={{ color: 'var(--dab-text-secondary, #475569)' }}>Default Model:</strong>
            <StudioSelect
              testId="config-default-model-select"
              value={selectedModel}
              onChange={setSelectedModel}
              options={availableModels.map((m) => ({
                value: m.id,
                label: `${m.label} (${m.id})`,
                title: m.description,
              }))}
            />
          </div>
          <div
            style={{
              borderTop: '1px solid var(--dab-border, #e2e8f0)',
              paddingTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 12,
            }}
          >
            <strong style={{ color: 'var(--dab-text-secondary, #475569)' }}>Enabled Studio Apps:</strong>
            {STUDIO_MODES.map((m) => {
              const enabled = !disabledModes.includes(m.mode)
              return (
                <label
                  key={m.mode}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--dab-border-strong, #cbd5e1)',
                    background: enabled
                      ? 'var(--dab-accent-subtle, #eff6ff)'
                      : 'var(--dab-surface-muted, #f8fafc)',
                    color: enabled
                      ? 'var(--dab-accent-text, #1d4ed8)'
                      : 'var(--dab-text-muted, #64748b)',
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={`config-mode-toggle-${m.mode}`}
                    checked={enabled}
                    disabled={enabled && enabledModes.length <= 1}
                    onChange={() =>
                      setDisabledModes((prev) =>
                        prev.includes(m.mode)
                          ? prev.filter((x) => x !== m.mode)
                          : [...prev, m.mode]
                      )
                    }
                  />
                  {m.label}
                </label>
              )
            })}
          </div>
          {!canSaveContext && (
            <div className="dab-muted" style={{ fontSize: 11, color: '#b45309' }}>
              🔒 Read-only: saving shared extension context requires Looker <code>develop</code> or{' '}
              <code>admin</code> permission.
            </div>
          )}
          {authMode === 'apikey' && !canManageAttrs && (
            <div className="dab-muted" style={{ fontSize: 11, color: '#b45309' }}>
              🔒 Creating or updating hidden Looker User Attributes requires{' '}
              <code>manage_user_attributes</code> or <code>admin</code> permission.
            </div>
          )}
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
    themeMode,
    resolvedTheme,
    setThemeMode,
    activeMode,
    agentSession,
    handleWakeModeEnv,
    requirePermission,
    setRequirePermission,
    capabilities,
    availableLookmlProjects,
    canDeployLookml,
    models,
    selectedExplores,
    setSelectedExplores,
    isLookmlMode,
    isHealthCheckMode,
    builderMode,
    isUseCaseLocked,
    selectedUseCase,
    getUseCaseLabel,
    lookmlProjectId,
    setLookmlProjectId,
    lookmlSessions,
    loadLookmlSessionById,
    lookmlBundle,
    loadingMetadata,
    folderTreeNodes,
    rootFolderIds,
    folderChildrenById,
    expandedFolderIds,
    loadingFolderIds,
    toggleExpandFolder,
    hydrateFolderAncestors,
    handleSearchFolders,
    selectedFolderId,
    setSelectedFolderId,
    nativeContent,
    publishedApp,
    handleResetNewApp,
    authMode,
    oauthToken,
    oauthSigningIn,
    handleOAuthLogin,
    handleCancelOAuthLogin,
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

  const [folderPopoverOpen, setFolderPopoverOpen] = useState(() =>
    Boolean(mockExt?.initialFolderPopoverOpen)
  )
  const [folderQuickSearch, setFolderQuickSearch] = useState('')
  const [advModalOpen, setAdvModalOpen] = useState(() =>
    Boolean(mockExt?.initialFolderSearchModalOpen)
  )
  const [advName, setAdvName] = useState('')
  const [advParentId, setAdvParentId] = useState('')
  const [advPersonal, setAdvPersonal] = useState<'any' | 'false' | 'true'>('any')
  const [advCreatorId, setAdvCreatorId] = useState('')
  const [advFolderId, setAdvFolderId] = useState('')
  const [advResults, setAdvResults] = useState<LookerFolderNode[]>([])
  const [advLoading, setAdvLoading] = useState(false)
  const folderPickerRef = useRef<HTMLDivElement | null>(null)

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
      if (
        folderPickerRef.current &&
        !folderPickerRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement)?.closest?.('[data-testid="folder-advanced-search-modal"]')
      ) {
        setFolderPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const selectedFolderNode = folderTreeNodes[selectedFolderId]
  const selectedFolderLabel = selectedFolderNode
    ? `${selectedFolderNode.name} (#${selectedFolderNode.id})`
    : `Folder #${selectedFolderId}`

  const selectedFolderPath = useMemo(() => {
    const parts: string[] = []
    let cur: LookerFolderNode | undefined = folderTreeNodes[selectedFolderId]
    const visited = new Set<string>()
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id)
      parts.unshift(`${cur.name} (#${cur.id})`)
      cur = cur.parent_id ? folderTreeNodes[cur.parent_id] : undefined
    }
    return parts.length > 0 ? parts.join(' / ') : selectedFolderLabel
  }, [folderTreeNodes, selectedFolderId, selectedFolderLabel])

  const quickFilteredFolders = useMemo(() => {
    const q = folderQuickSearch.trim().toLowerCase()
    if (!q) return null
    return Object.values(folderTreeNodes).filter((node) =>
      `${node.name} #${node.id} ${node.id}`.toLowerCase().includes(q)
    )
  }, [folderTreeNodes, folderQuickSearch])

  const executeAdvancedSearch = async (overrideName?: string) => {
    setAdvLoading(true)
    try {
      const results = await handleSearchFolders({
        name: overrideName !== undefined ? overrideName : advName,
        parent_id: advParentId,
        is_personal: advPersonal,
        creator_id: advCreatorId,
        id: advFolderId,
      })
      setAdvResults(results)
    } finally {
      setAdvLoading(false)
    }
  }

  const handleOpenAdvancedSearch = () => {
    const seedName = folderQuickSearch.trim()
    if (seedName && !advName) setAdvName(seedName)
    setAdvModalOpen(true)
    void executeAdvancedSearch(seedName || advName)
  }

  const handleSelectFolderNode = (fid: string, closeModal = false) => {
    setSelectedFolderId(fid)
    void hydrateFolderAncestors(fid)
    if (closeModal) setAdvModalOpen(false)
  }

  const renderFolderTreeNode = (folderId: string, depth = 0, visited = new Set<string>()): React.ReactNode => {
    if (visited.has(folderId)) return null
    const node = folderTreeNodes[folderId]
    if (!node) return null
    const nextVisited = new Set(visited)
    nextVisited.add(folderId)
    const isExpanded = expandedFolderIds.includes(node.id)
    const isLoading = loadingFolderIds.includes(node.id)
    const childIds = folderChildrenById[node.id] || []
    const canExpand = node.has_children !== false || childIds.length > 0
    const isSelected = String(selectedFolderId) === String(node.id)

    return (
      <div key={node.id} className="dab-folder-tree-branch">
        <div
          className={`dab-folder-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <button
            type="button"
            data-testid={`folder-expand-${node.id}`}
            className="dab-folder-expand-btn"
            onClick={(e) => {
              e.stopPropagation()
              if (canExpand) void toggleExpandFolder(node.id)
            }}
            disabled={!canExpand}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            title={canExpand ? (isExpanded ? 'Collapse folder' : 'Expand child folders') : 'No subfolders'}
          >
            {isLoading ? '⋯' : canExpand ? (isExpanded ? '▾' : '▸') : '·'}
          </button>
          <button
            type="button"
            data-testid={`folder-select-${node.id}`}
            className="dab-folder-select-btn"
            onClick={() => handleSelectFolderNode(node.id)}
            title={`${node.name} (#${node.id})`}
          >
            <span className="dab-folder-node-icon">{node.is_personal ? '👤' : '📁'}</span>
            <span className="dab-folder-node-name">{node.name}</span>
            <span className="dab-folder-node-id">#{node.id}</span>
          </button>
        </div>
        {isExpanded && childIds.length > 0 && (
          <div className="dab-folder-tree-children">
            {childIds.map((cid) => renderFolderTreeNode(cid, depth + 1, nextVisited))}
          </div>
        )}
      </div>
    )
  }

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
        {isUseCaseLocked && (
          <span
            data-testid="topbar-use-case-badge"
            className="dab-badge dab-locked-use-case-badge"
            style={{
              background: 'var(--dab-badge-bg, #eff6ff)',
              color: 'var(--dab-accent-text, #1d4ed8)',
              borderColor: 'var(--dab-accent-border, #bfdbfe)',
              fontWeight: 600,
            }}
            title="Conversation use case is locked — click + New Conversation in the sidebar to start another use case"
          >
            🔒 {getUseCaseLabel(selectedUseCase)}
          </span>
        )}
        <ThemeModeSelect
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          onChange={setThemeMode}
        />
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
              {loadingMetadata ? (
                <div
                  data-testid="folder-selector-skeleton"
                  className="dab-skeleton dab-folder-trigger-fixed"
                  aria-label="Loading LookML projects..."
                />
              ) : (
                <input
                  type="text"
                  data-testid="topbar-lookml-project-input"
                  className="dab-folder-trigger-fixed"
                  list="dab-lookml-projects"
                  placeholder="LookML project_id (opt)..."
                  value={lookmlProjectId}
                  onChange={(e) => setLookmlProjectId(e.target.value)}
                  title={
                    availableLookmlProjects.length > 0
                      ? `Developable projects: ${availableLookmlProjects.join(', ')}`
                      : undefined
                  }
                />
              )}
              {availableLookmlProjects.length > 0 && (
                <datalist id="dab-lookml-projects">
                  {availableLookmlProjects.map((proj) => (
                    <option key={proj} value={proj} />
                  ))}
                </datalist>
              )}
            </label>
            {capabilities?.rolesLoaded && !canDeployLookml && (
              <span
                className="dab-badge"
                style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}
                title="Deploy to production requires Looker 'deploy' or 'admin' permission"
              >
                🔒 No deploy
              </span>
            )}
            {(lookmlSessions.length > 0 || lookmlBundle) && (
              <>
                <div className="dab-divider" />
                <div className="dab-load-box">
                  {lookmlSessions.length > 0 && (
                    <StudioSelect
                      testId="topbar-lookml-sessions-select"
                      className="dab-folder-trigger-fixed"
                      value=""
                      onChange={(val) => {
                        if (val) loadLookmlSessionById(val, true)
                      }}
                      options={[
                        { value: '', label: `Saved LookML (${lookmlSessions.length})...` },
                        ...lookmlSessions.map((s) => ({
                          value: s.id,
                          label: `${s.title} (${s.id})`,
                        })),
                      ]}
                    />
                  )}
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
            )}
          </>
        ) : (
          <>
            <div
              className="dab-field dab-folder-picker"
              data-testid="topbar-folder-picker"
              ref={folderPickerRef}
            >
              <span>Save to Folder:</span>
              {loadingMetadata ? (
                <div
                  data-testid="folder-selector-skeleton"
                  className="dab-skeleton dab-folder-trigger-fixed"
                  aria-label="Loading folders..."
                />
              ) : (
                <button
                  type="button"
                  data-testid="topbar-folder-trigger"
                  className="dab-folder-trigger dab-folder-trigger-fixed"
                  onClick={() => setFolderPopoverOpen((prev) => !prev)}
                  title={`Publish target folder: ${selectedFolderPath}`}
                >
                  <span className="dab-folder-trigger-text">
                    {selectedFolderNode?.is_personal ? '👤' : '📁'} {selectedFolderLabel}
                  </span>
                  <span className="dab-folder-trigger-caret">▾</span>
                </button>
              )}

              {folderPopoverOpen && !loadingMetadata && (
                <div className="dab-folder-popover" data-testid="folder-tree-popover">
                  <div className="dab-folder-popover-header">
                    <input
                      type="text"
                      data-testid="folder-tree-quick-search"
                      className="dab-folder-quick-search"
                      placeholder="Quick filter loaded folders..."
                      value={folderQuickSearch}
                      onChange={(e) => setFolderQuickSearch(e.target.value)}
                    />
                  </div>
                  <div className="dab-folder-tree-list" data-testid="folder-tree-list">
                    {quickFilteredFolders ? (
                      quickFilteredFolders.length === 0 ? (
                        <div className="dab-folder-empty">
                          No loaded folders match &ldquo;{folderQuickSearch}&rdquo;. Use Advanced Search below.
                        </div>
                      ) : (
                        quickFilteredFolders.map((node) => {
                          const isSelected = String(selectedFolderId) === String(node.id)
                          return (
                            <div
                              key={node.id}
                              className={`dab-folder-tree-row ${isSelected ? 'selected' : ''}`}
                              style={{ paddingLeft: 10 }}
                            >
                              <button
                                type="button"
                                data-testid={`folder-select-${node.id}`}
                                className="dab-folder-select-btn"
                                onClick={() => handleSelectFolderNode(node.id)}
                              >
                                <span className="dab-folder-node-icon">
                                  {node.is_personal ? '👤' : '📁'}
                                </span>
                                <span className="dab-folder-node-name">{node.name}</span>
                                <span className="dab-folder-node-id">#{node.id}</span>
                              </button>
                            </div>
                          )
                        })
                      )
                    ) : (
                      rootFolderIds.map((rid) => renderFolderTreeNode(rid, 0))
                    )}
                  </div>
                  <div className="dab-folder-popover-footer">
                    <span className="dab-muted" style={{ fontSize: 11 }}>
                      Target: <strong>#{selectedFolderId}</strong>
                    </span>
                    <button
                      type="button"
                      data-testid="folder-advanced-search-btn"
                      className="dab-btn-secondary dab-folder-adv-btn"
                      onClick={handleOpenAdvancedSearch}
                    >
                      🔍 Advanced Search...
                    </button>
                  </div>
                </div>
              )}

              {advModalOpen && (
                <div
                  className="dab-modal-backdrop dab-folder-modal-backdrop"
                  onClick={() => setAdvModalOpen(false)}
                >
                  <div
                    className="dab-modal dab-folder-search-modal"
                    data-testid="folder-advanced-search-modal"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 14 }}>
                          🔍 Advanced Looker Folder Search (<code>sdk.search_folders</code>)
                        </strong>
                        <div className="dab-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                          Search across all Looker folders by name, parent_id, personal scope, creator_id, or ID
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="folder-search-close-btn"
                        className="dab-btn-secondary"
                        onClick={() => setAdvModalOpen(false)}
                      >
                        ✕ Close
                      </button>
                    </div>

                    <div className="dab-folder-search-grid">
                      <div className="dab-modal-row">
                        <label>Folder Name (name)</label>
                        <input
                          type="text"
                          data-testid="folder-search-input-name"
                          placeholder="e.g. subfolder test or %marketing%..."
                          value={advName}
                          onChange={(e) => setAdvName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void executeAdvancedSearch()
                          }}
                        />
                      </div>
                      <div className="dab-modal-row">
                        <label>Parent Folder ID (parent_id)</label>
                        <input
                          type="text"
                          data-testid="folder-search-input-parent-id"
                          placeholder="e.g. 1 or 501..."
                          value={advParentId}
                          onChange={(e) => setAdvParentId(e.target.value)}
                        />
                      </div>
                      <div className="dab-modal-row">
                        <label>Personal Scope (is_personal)</label>
                        <StudioSelect
                          testId="folder-search-select-personal"
                          value={advPersonal}
                          onChange={(val) => setAdvPersonal(val as any)}
                          options={[
                            { value: 'any', label: 'Any Folder' },
                            { value: 'false', label: 'Shared Folders Only (is_personal=false)' },
                            { value: 'true', label: 'Personal Folders Only (is_personal=true)' },
                          ]}
                        />
                      </div>
                      <div className="dab-modal-row">
                        <label>Creator User ID (creator_id)</label>
                        <input
                          type="text"
                          data-testid="folder-search-input-creator-id"
                          placeholder="e.g. 1..."
                          value={advCreatorId}
                          onChange={(e) => setAdvCreatorId(e.target.value)}
                        />
                      </div>
                      <div className="dab-modal-row">
                        <label>Exact Folder ID (id)</label>
                        <input
                          type="text"
                          data-testid="folder-search-input-id"
                          placeholder="e.g. 502..."
                          value={advFolderId}
                          onChange={(e) => setAdvFolderId(e.target.value)}
                        />
                      </div>
                      <div
                        className="dab-modal-row"
                        style={{ justifyContent: 'flex-end', alignItems: 'flex-end' }}
                      >
                        <button
                          type="button"
                          data-testid="folder-search-submit-btn"
                          className="dab-btn-primary"
                          onClick={() => void executeAdvancedSearch()}
                          disabled={advLoading}
                        >
                          {advLoading ? 'Searching...' : 'Search Folders'}
                        </button>
                      </div>
                    </div>

                    <div className="dab-folder-search-results" data-testid="folder-search-results">
                      {advResults.length === 0 ? (
                        <div className="dab-folder-empty">
                          {advLoading
                            ? 'Searching Looker folders...'
                            : 'No matching folders found. Adjust filters and click Search Folders.'}
                        </div>
                      ) : (
                        advResults.map((item) => {
                          const isSelected = String(selectedFolderId) === String(item.id)
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-testid={`folder-search-result-${item.id}`}
                              className={`dab-folder-search-result-row ${isSelected ? 'selected' : ''}`}
                              onClick={() => handleSelectFolderNode(item.id, true)}
                            >
                              <span style={{ fontWeight: 600 }}>
                                {item.is_personal ? '👤' : '📁'} {item.name} (#{item.id})
                              </span>
                              <span className="dab-muted" style={{ fontSize: 11 }}>
                                {item.parent_id ? `parent: #${item.parent_id}` : 'root'} ·{' '}
                                {item.is_personal ? 'Personal' : 'Shared'}
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {(publishedApp || nativeContent) && (
              <>
                <div className="dab-divider" />
                <div className="dab-load-box">
                  <button
                    type="button"
                    className="dab-btn-secondary"
                    onClick={handleResetNewApp}
                    disabled={!!busyStatus}
                  >
                    {builderMode === 'dashboard' ? 'New Content' : 'New App'}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <div className="dab-divider" />

        <div className="dab-auth-box">
          {authMode === 'oauth' ? (
            <>
              <button
                type="button"
                data-testid="topbar-oauth-signin-btn"
                className={oauthToken ? 'dab-btn-secondary' : 'dab-btn-primary'}
                onClick={handleOAuthLogin}
              >
                {oauthToken ? '✓ Signed In' : oauthSigningIn ? 'Retry Sign In' : 'Sign In'}
              </button>
              {oauthSigningIn && (
                <button
                  type="button"
                  data-testid="topbar-oauth-cancel-btn"
                  className="dab-btn-secondary"
                  onClick={handleCancelOAuthLogin}
                  title="Cancel pending Google OAuth sign-in popup"
                >
                  Cancel Sign-In
                </button>
              )}
            </>
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
              {capabilities?.rolesLoaded && capabilities.tools.health.missingPermissions.length > 0 && (
                <span
                  className="dab-badge"
                  style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}
                  title={capabilities.tools.health.reason}
                >
                  ⚠️ Missing: {capabilities.tools.health.missingPermissions.join(', ')}
                </span>
              )}
              <StudioSelect
                testId="topbar-health-scope-select"
                value={healthScope}
                onChange={(val) => setHealthScope(val as any)}
                title="Select Looker Health Check, BigQuery Health Check, or Combined 3-Pillar Audit"
                options={[
                  {
                    value: 'all',
                    label: 'All 3 Pillars (Looker + BQ)',
                    disabled: Boolean(capabilities?.rolesLoaded && capabilities.sqlRunnerConnections.size === 0),
                  },
                  { value: 'looker', label: 'Looker Only (Pillars 1 & 2)' },
                  {
                    value: 'bq',
                    label: 'BigQuery Only (Pillar 3)',
                    disabled: Boolean(capabilities?.rolesLoaded && capabilities.sqlRunnerConnections.size === 0),
                  },
                ]}
              />
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
          <FullScreenToggleButton />
        </div>
      </div>
    </header>
  )
}
