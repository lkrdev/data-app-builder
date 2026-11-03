import React, { useEffect, useMemo, useRef, useState } from 'react'

import {
  AlertTriangle,
  ChevronDown,
  Folder,
  FolderOpen,
  Lock,
  RotateCcw,
  Search,
  Server,
  Square,
  User,
} from 'lucide-react'
import { useLocation } from 'react-router-dom'

import {
   getGeminiUserAttributeName,
  resolveLookerOAuthRedirectUris,
} from '../antigravity'
import { useLookerExtension } from '../contexts/LookerExtensionContext'
import { LookerFolderNode } from '../lookerApi'
import {
  ResolvedStudioTheme,
  StudioController,
  StudioThemeMode,
} from '../useStudioController'
import { STUDIO_MODES } from './App'
import {
  StudioBadge,
  StudioButton,
  StudioCard,
  StudioModal,
  StudioSelect,
  StudioSkeleton,
  ThemeModeIcon,
} from './StudioDesignSystem'
export * from './StudioDesignSystem'

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
    isLookerDevMode,
  } = ctl
  const [copiedRedirectUri, setCopiedRedirectUri] = useState(false)
  const [copiedSpartanRedirectUri, setCopiedSpartanRedirectUri] = useState(false)
  const { extensionUri: extensionRedirectUri, spartanUri: spartanRedirectUri } =
    resolveLookerOAuthRedirectUris(
      oauthRedirectUri?.replace(/\/(extensions|spartan)\/oauth2_redirect\/?$/, '')
    )
  const errorText = messages.filter((m) => m.role === 'error').slice(-1)[0]?.text
  const canSaveContext = capabilities?.canConfigureExtension !== false
  const canManageAttrs = capabilities?.canManageUserAttributes !== false
  const saveDisabled =
    !!busyStatus || !canSaveContext || (authMode === 'apikey' && !canManageAttrs)

  return (
    <div className="dab-shell" data-theme={resolvedTheme} data-theme-mode={themeMode}>
      <header className="dab-topbar">
        <div className="dab-brand">
          <strong>Looker Agent</strong>
          <span className="dab-badge">Configuration</span>
        </div>
        <div className="dab-controls">
          <ThemeModeSelect
            themeMode={themeMode}
            resolvedTheme={resolvedTheme}
            onChange={setThemeMode}
          />
          {isLookerDevMode && (
            <StudioBadge
              tone="warning"
              testId="topbar-dev-mode-badge"
              title="Looker session is in Development Mode"
            >
              Dev Mode
            </StudioBadge>
          )}
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
              Save Setup
            </button>
          </div>
          {authMode === 'oauth' && (
            <StudioCard className="dab-oauth-redirect-helper" testId="config-oauth-redirect-card">
              <div className="dab-oauth-redirect-row">
                <span>
                  <strong>Authorized redirect URI (Standard):</strong>{' '}
                  <code data-testid="config-oauth-redirect-uri">{extensionRedirectUri}</code>
                </span>
                <StudioButton
                  variant="secondary"
                  testId="config-copy-redirect-uri-btn"
                  style={{ minHeight: 24, fontSize: 11, padding: '0 8px' }}
                  onClick={() => {
                    navigator.clipboard?.writeText?.(extensionRedirectUri)
                    setCopiedRedirectUri(true)
                    setTimeout(() => setCopiedRedirectUri(false), 1800)
                  }}
                >
                  <span data-testid="copy-redirect-uri-btn">
                    {copiedRedirectUri ? '✓ Copied Redirect URI' : 'Copy Redirect URI'}
                  </span>
                </StudioButton>
              </div>
              <div className="dab-oauth-redirect-row">
                <span>
                  <strong>Authorized redirect URI (Full Screen / Spartan):</strong>{' '}
                  <code data-testid="config-spartan-oauth-redirect-uri">{spartanRedirectUri}</code>
                </span>
                <StudioButton
                  variant="secondary"
                  testId="copy-spartan-redirect-uri-btn"
                  style={{ minHeight: 24, fontSize: 11, padding: '0 8px' }}
                  onClick={() => {
                    navigator.clipboard?.writeText?.(spartanRedirectUri)
                    setCopiedSpartanRedirectUri(true)
                    setTimeout(() => setCopiedSpartanRedirectUri(false), 1800)
                  }}
                >
                  <span data-testid="config-copy-spartan-redirect-uri-btn">
                    {copiedSpartanRedirectUri ? '✓ Copied Spartan URI' : 'Copy Spartan URI'}
                  </span>
                </StudioButton>
              </div>
              <div className="dab-muted" style={{ fontSize: 11 }}>
                Add <strong>both</strong> URIs under <strong>Authorized redirect URIs</strong> on your GCP Web OAuth 2.0
                Client ID (Standard <code>/extensions/oauth2_redirect</code> and Full Screen{' '}
                <code>/spartan/oauth2_redirect</code>) to avoid <code>Error 400: redirect_uri_mismatch</code>.
              </div>
            </StudioCard>
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
            <div className="dab-muted" style={{ fontSize: 11, color: 'var(--dab-warning-text)' }}>
              <Lock size={13} strokeWidth={1.75} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden="true" />
              Read-only: saving shared extension context requires Looker <code>develop</code> or{' '}
              <code>admin</code> permission.
            </div>
          )}
          {authMode === 'apikey' && !canManageAttrs && (
            <div className="dab-muted" style={{ fontSize: 11, color: 'var(--dab-warning-text)' }}>
              <Lock size={13} strokeWidth={1.75} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden="true" />
              Creating or updating hidden Looker User Attributes requires{' '}
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
    environmentStatus,
    envResetNotice,
    handleResetEnvironment,
    handleStopEnvironment,
    requirePermission,
    setRequirePermission,
    capabilities,
    availableLookmlProjects,
    canDeployLookml,
    isLookmlMode,
    isHealthCheckMode,
    builderMode,
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
    userDisplayName,
    isLookerDevMode,
  } = ctl

  const mockExt =
    typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined

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
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const envMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (
        folderPickerRef.current &&
        !folderPickerRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement)?.closest?.('[data-testid="folder-advanced-search-modal"]')
      ) {
        setFolderPopoverOpen(false)
      }
      if (envMenuRef.current && !envMenuRef.current.contains(e.target as Node)) {
        setEnvMenuOpen(false)
      }
    }
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEnvMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [])

  const selectedFolderNode = folderTreeNodes[selectedFolderId]
  const selectedFolderLabel = selectedFolderNode ? selectedFolderNode.name : 'My folder'

  const selectedFolderPath = useMemo(() => {
    const parts: string[] = []
    let cur: LookerFolderNode | undefined = folderTreeNodes[selectedFolderId]
    const visited = new Set<string>()
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id)
      parts.unshift(cur.name)
      if (rootFolderIds.includes(cur.id)) break
      cur = cur.parent_id ? folderTreeNodes[cur.parent_id] : undefined
    }
    return parts.length > 0 ? parts.join(' / ') : selectedFolderLabel
  }, [folderTreeNodes, rootFolderIds, selectedFolderId, selectedFolderLabel])

  const quickFilteredFolders = useMemo(() => {
    const q = folderQuickSearch.trim().toLowerCase()
    if (!q) return null
    return Object.values(folderTreeNodes).filter((node) =>
      `${node.name} ${node.id}`.toLowerCase().includes(q)
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

  const renderFolderIcon = (isPersonal?: boolean | null, isOpen = false) => {
    const Icon = isPersonal ? User : isOpen ? FolderOpen : Folder
    return <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
  }

  const renderFolderTreeNode = (folderId: string, depth = 0, visited = new Set<string>()): React.ReactNode => {
    if (visited.has(folderId)) return null
    const node = folderTreeNodes[folderId]
    if (!node) return null
    const nextVisited = new Set(visited)
    nextVisited.add(folderId)
    const isExpanded = expandedFolderIds.includes(node.id)
    const isLoading = loadingFolderIds.includes(node.id)
    const childIds = (folderChildrenById[node.id] || []).filter(
      (cid) => !rootFolderIds.includes(cid)
    )
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
            title={node.name}
          >
            <span className="dab-folder-node-icon">{renderFolderIcon(node.is_personal, isExpanded)}</span>
            <span className="dab-folder-node-name">{node.name}</span>
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

  return (
    <header className="dab-topbar">
      <div className="dab-brand">
        <strong>Looker Agent</strong>
        <div className="dab-env-menu-wrap" ref={envMenuRef}>
          <StudioBadge
            tone={environmentStatus === 'stopped' ? 'neutral' : environmentStatus === 'resetting' ? 'warning' : 'success'}
            testId="topbar-environment-btn"
            data-env-status={environmentStatus}
            data-env-reset-notice={envResetNotice ? 'true' : undefined}
            onClick={() => setEnvMenuOpen((prev) => !prev)}
            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title={
              environmentStatus === 'stopped'
                ? 'Antigravity sandbox environment stopped (click to reset or manage)'
                : environmentStatus === 'resetting'
                ? 'Resetting Antigravity sandbox environment...'
                : 'Antigravity sandbox environment active (click to reset or stop)'
            }
          >
            {environmentStatus === 'resetting' ? (
              <RotateCcw size={12} strokeWidth={1.75} className="dab-spin" aria-hidden="true" />
            ) : (
              <>
                <span className={`dab-env-status-dot ${environmentStatus === 'stopped' ? 'stopped' : 'active'}`} aria-hidden="true" />
                <Server size={12} strokeWidth={1.75} aria-hidden="true" />
              </>
            )}
            <span>
              {environmentStatus === 'resetting'
                ? 'Resetting...'
                : environmentStatus === 'stopped'
                ? 'Environment (Stopped)'
                : envResetNotice
                ? '✓ Environment Reset'
                : 'Environment'}
            </span>
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
          </StudioBadge>

          {envMenuOpen && (
            <div
              className="dab-env-popover-menu"
              data-testid="topbar-environment-menu"
              role="menu"
              aria-label="Environment actions"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="env-reset-btn"
                className="dab-env-menu-item"
                onClick={() => {
                  setEnvMenuOpen(false)
                  void handleResetEnvironment()
                }}
              >
                <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>Reset Environment</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="env-stop-btn"
                className="dab-env-menu-item dab-env-menu-item-danger"
                onClick={() => {
                  setEnvMenuOpen(false)
                  handleStopEnvironment()
                }}
              >
                <Square size={12} strokeWidth={2} aria-hidden="true" />
                <span>Stop Environment</span>
              </button>
            </div>
          )}
        </div>
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
          <span data-testid="studio-approval-policy-select">
            {requirePermission ? 'Safe Mode (Ask)' : 'Auto-Approve (YOLO)'}
          </span>
        </button>

        {isLookmlMode ? (
          <>
            <label className="dab-field">
              <span>Project</span>
              {loadingMetadata ? (
                <StudioSkeleton
                  testId="folder-selector-skeleton"
                  className="dab-folder-trigger-fixed"
                  ariaLabel="Loading LookML projects..."
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
              <StudioBadge
                tone="warning"
                title="Deploy to production requires Looker 'deploy' or 'admin' permission"
              >
                <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> No deploy
              </StudioBadge>
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
                <StudioSkeleton
                  testId="folder-selector-skeleton"
                  className="dab-folder-trigger-fixed"
                  ariaLabel="Loading folders..."
                />
              ) : (
                <button
                  type="button"
                  data-testid="topbar-folder-trigger"
                  className="dab-folder-trigger dab-folder-trigger-fixed"
                  onClick={() => setFolderPopoverOpen((prev) => !prev)}
                  title={`Publish target folder: ${selectedFolderPath}`}
                >
                  <span className="dab-folder-node-icon">
                    {renderFolderIcon(selectedFolderNode?.is_personal, folderPopoverOpen)}
                  </span>
                  <span className="dab-folder-trigger-text">{selectedFolderLabel}</span>
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
                                title={node.name}
                              >
                                <span className="dab-folder-node-icon">{renderFolderIcon(node.is_personal)}</span>
                                <span className="dab-folder-node-name">{node.name}</span>
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
                      Target: <strong>{selectedFolderLabel}</strong>
                    </span>
                    <button
                      type="button"
                      data-testid="folder-advanced-search-btn"
                      className="dab-btn-secondary dab-folder-adv-btn"
                      onClick={handleOpenAdvancedSearch}
                    >
                      <Search size={14} strokeWidth={1.75} aria-hidden="true" /> Advanced Search...
                    </button>
                  </div>
                </div>
              )}

              <StudioModal
                open={advModalOpen}
                onClose={() => setAdvModalOpen(false)}
                testId="folder-advanced-search-modal"
                closeTestId="folder-search-modal-close"
                closeLabel="✕"
                backdropClassName="dab-folder-modal-backdrop"
                className="dab-folder-search-modal"
                title={
                  <>
                    <Search size={14} strokeWidth={1.75} style={{ verticalAlign: -2, marginRight: 5 }} aria-hidden="true" />
                    Advanced Looker Folder Search
                  </>
                }
                subtitle="Search across all Looker folders by folder name, parent folder, personal scope, creator, or folder ID"
              >
                <div className="dab-folder-search-grid">
                  <div className="dab-modal-row">
                    <label>Folder Name</label>
                    <input
                      type="search"
                      data-testid="folder-search-input-name"
                      placeholder="Search folder name or ID..."
                      value={advName}
                      onChange={(e) => setAdvName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void executeAdvancedSearch()
                      }}
                    />
                  </div>
                  <div className="dab-modal-row">
                    <label>Parent Folder</label>
                    <input
                      type="search"
                      data-testid="folder-search-input-parent-id"
                      list="dab-folder-parent-suggestions"
                      placeholder="Search parent folder name..."
                      value={advParentId}
                      onChange={(e) => setAdvParentId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void executeAdvancedSearch()
                      }}
                    />
                    <datalist id="dab-folder-parent-suggestions">
                      {Object.values(folderTreeNodes).map((node) => (
                        <option key={node.id} value={node.name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="dab-modal-row">
                    <label>Personal Scope</label>
                    <StudioSelect
                      testId="folder-search-select-personal"
                      value={advPersonal}
                      onChange={(val) => setAdvPersonal(val)}
                      options={[
                        { value: 'any', label: 'Any Folder' },
                        { value: 'false', label: 'Shared Folders Only' },
                        { value: 'true', label: 'Personal Folders Only' },
                      ]}
                    />
                  </div>
                  <div className="dab-modal-row">
                    <label>Created By</label>
                    <input
                      type="search"
                      data-testid="folder-search-input-creator-id"
                      list="dab-folder-creator-suggestions"
                      placeholder="Search creator name or ID..."
                      value={advCreatorId}
                      onChange={(e) => setAdvCreatorId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void executeAdvancedSearch()
                      }}
                    />
                    <datalist id="dab-folder-creator-suggestions">
                      {Array.from(
                        new Set(
                          [userDisplayName, ...Object.values(folderTreeNodes).map((n) => n.creator_id)].filter((c): c is string => Boolean(c))
                        )
                      ).map((creator) => (
                        <option key={creator} value={creator} />
                      ))}
                    </datalist>
                  </div>
                  <div className="dab-modal-row">
                    <label>Folder ID</label>
                    <input
                      type="search"
                      data-testid="folder-search-input-id"
                      placeholder="Filter by exact folder ID..."
                      value={advFolderId}
                      onChange={(e) => setAdvFolderId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void executeAdvancedSearch()
                      }}
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
                          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            {renderFolderIcon(item.is_personal)}
                            {item.name}
                          </span>
                          <span className="dab-muted" style={{ fontSize: 11 }}>
                            {item.parent_id
                              ? folderTreeNodes[item.parent_id]?.name || 'Subfolder'
                              : 'Root'}{' '}
                            · {item.is_personal ? 'Personal' : 'Shared'}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </StudioModal>
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
                    {builderMode === 'dashboard' ? 'New Content' : 'New Session'}
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
                <StudioBadge
                  tone="warning"
                  title={capabilities.tools.health.reason}
                >
                  <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" /> Missing:{' '}
                  {capabilities.tools.health.missingPermissions.join(', ')}
                </StudioBadge>
              )}
              <StudioSelect
                testId="topbar-health-scope-select"
                value={healthScope}
                onChange={(val) => setHealthScope(val)}
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
                Run 3-Pillar Audit
              </button>
            </>
          )}
          {isLookerDevMode && (
            <StudioBadge
              tone="warning"
              testId="topbar-dev-mode-badge"
              title="Looker session is in Development Mode"
            >
              Dev Mode
            </StudioBadge>
          )}
          <FullScreenToggleButton />
        </div>
      </div>
    </header>
  )
}
