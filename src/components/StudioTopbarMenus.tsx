import React from 'react'

import {
  Check, ChevronDown, Code2, LogOut, MoreVertical, RefreshCw, RotateCcw, Server, Square, User,
} from 'lucide-react'

import { getGeminiUserAttributeName } from '../antigravity'
import { ResolvedStudioTheme, StudioController, StudioThemeMode } from '../useStudioController'
import { StudioBadge, StudioButton, StudioModal, StudioSelect, ThemeModeIcon } from './StudioDesignSystem'

const THEME_MODES: ReadonlyArray<readonly [StudioThemeMode, string]> = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
]

export const formatApiKeyBadgeTitle = (extensionSDK?: StudioController['extensionSDK']): string =>
  `Uses serverProxy + ${getGeminiUserAttributeName(extensionSDK)}`

function moveMenuFocus(container: HTMLElement | null, step: 'first' | 'last' | 1 | -1): void {
  const items = container ? Array.from(container.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')) : []
  if (!items.length) return
  if (step === 'first' || step === 'last') { items[step === 'first' ? 0 : items.length - 1].focus(); return }
  const idx = items.indexOf(document.activeElement as HTMLElement)
  items[(idx < 0 ? (step > 0 ? 0 : items.length - 1) : idx + step + items.length) % items.length].focus()
}

function handleMenuKeyNav(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveMenuFocus(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1) }
  else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); moveMenuFocus(e.currentTarget, e.key === 'Home' ? 'first' : 'last') }
}

function useMenuDismiss(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  setOpen: (v: boolean) => void,
  mobile: boolean,
  btnRef?: React.RefObject<HTMLElement | null>
): void {
  React.useEffect(() => {
    if (!open) return
    moveMenuFocus(wrapRef.current, 'first')
    const onOut = (e: Event) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef?.current?.focus() } }
    const onBlur = () => setOpen(false)
    const onResize = () => { if (typeof window !== 'undefined' && (mobile ? window.innerWidth > 768 : window.innerWidth <= 768)) setOpen(false) }
    const bindings: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [
      [document, 'mousedown', onOut],
      [document, 'touchstart', onOut, { passive: true }],
      [document, 'keydown', onKey as EventListener],
      [window, 'blur', onBlur],
      [window, 'resize', onResize],
    ]
    bindings.forEach(([t, ev, fn, opt]) => t.addEventListener(ev, fn, opt))
    return () => bindings.forEach(([t, ev, fn]) => t.removeEventListener(ev, fn))
  }, [open, wrapRef, setOpen, mobile, btnRef])
}

export function formatEnvironmentStatusLabel(
  environmentStatus: StudioController['environmentStatus'],
  envResetNotice: boolean,
  envSyncNotice: boolean
): string {
  return environmentStatus === 'resetting'
    ? 'Resetting...'
    : environmentStatus === 'syncing'
      ? 'Syncing Skills...'
      : environmentStatus === 'stopped'
        ? 'Environment (Stopped)'
        : envResetNotice
          ? '✓ Environment Reset'
          : envSyncNotice
            ? '✓ Skills Updated'
            : 'Environment'
}

const renderEnvStatusIcon = (environmentStatus: StudioController['environmentStatus']): React.ReactNode =>
  environmentStatus === 'resetting' ? (
    <RotateCcw size={12} strokeWidth={1.75} className="dab-spin" aria-hidden="true" />
  ) : environmentStatus === 'syncing' ? (
    <RefreshCw size={12} strokeWidth={1.75} className="dab-spin" aria-hidden="true" />
  ) : (
    <>
      <span className={`dab-env-status-dot ${environmentStatus === 'stopped' ? 'stopped' : 'active'}`} aria-hidden="true" />
      <Server size={12} strokeWidth={1.75} aria-hidden="true" />
    </>
  )

const renderEnvActionItems = (ctl: StudioController, onClose: () => void, mobile: boolean): React.ReactNode =>
  ([
    [
      mobile ? 'mobile-more-sync-skills-btn' : 'env-sync-skills-btn',
      RefreshCw, 13, 1.75, 'Update Ripper-managed skills',
      'Overwrite & prune Ripper-managed skills in-place; keeps conversations & sandbox files.',
      !ctl.sharedEnvironmentId || ctl.environmentStatus !== 'active' || ctl.hasInFlightTurns,
      () => void ctl.handleSyncEnvironmentSkills(), ctl.envSkillsOutdated, false,
    ],
    [
      mobile ? 'mobile-more-stop-env-btn' : 'env-stop-btn',
      Square, 12, 2, 'Stop Environment',
      'Cancel active turns and pause the sandbox until your next prompt.',
      ctl.environmentStatus === 'resetting',
      () => ctl.handleStopEnvironment(), false, false,
    ],
    [
      mobile ? 'mobile-more-reset-env-btn' : 'env-reset-btn',
      RotateCcw, 13, 1.75, 'Reset Environment...',
      'Delete all Studio conversations and provision a fresh sandbox (keeps Looker content).',
      ctl.environmentStatus === 'resetting',
      () => ctl.setResetEnvModalOpen(true), false, true,
    ],
  ] as const).map(([id, Icon, size, strokeWidth, title, desc, disabled, run, badge, danger]) => (
    <button
      key={id} type="button" role="menuitem" data-testid={id}
      className={`dab-env-menu-item${danger ? ' dab-env-menu-item-danger' : ''}`}
      disabled={disabled} onClick={() => { onClose(); run() }}
    >
      <Icon size={size} strokeWidth={strokeWidth} className="dab-env-menu-item-icon" aria-hidden="true" />
      <span className="dab-env-menu-item-body">
        <span className="dab-env-menu-item-title">
          <span>{title}</span>
          {badge && <StudioBadge tone="accent" pill>Update available</StudioBadge>}
        </span>
        {!mobile && <span className="dab-env-menu-item-desc">{desc}</span>}
      </span>
    </button>
  ))

export const ThemeModeSelect: React.FC<{
  themeMode: StudioThemeMode; resolvedTheme: ResolvedStudioTheme; onChange: (mode: StudioThemeMode) => void
}> = ({ themeMode, resolvedTheme, onChange }) => (
  <StudioSelect
    testId="topbar-theme-select" optionTestIdPrefix="topbar-theme" value={themeMode}
    onChange={(val) => onChange(val as StudioThemeMode)} ariaLabel="Theme Mode"
    title={`Theme mode: ${themeMode} (active: ${resolvedTheme})`} iconOnly align="right"
    triggerIcon={<ThemeModeIcon mode={themeMode} />}
    extraAttrs={{ 'data-theme-mode': themeMode, 'data-resolved-theme': resolvedTheme }}
    options={THEME_MODES.map(([mode, label]) => ({ value: mode, label, icon: <ThemeModeIcon mode={mode} /> }))}
  />
)

export const StudioDevModeBadge: React.FC = () => (
  <StudioBadge
    tone="warning" testId="topbar-dev-mode-badge"
    title="Looker session is in Development Mode" aria-label="Looker session is in Development Mode"
  >
    <Code2 size={13} strokeWidth={1.75} className="dab-mobile-dev-icon" aria-hidden="true" />
    <span className="dab-dev-mode-label">Dev Mode</span>
  </StudioBadge>
)

export const StudioEnvironmentControl: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const { environmentStatus, envResetNotice, envSyncNotice, hasInFlightTurns, envSkillsOutdated, handleSyncEnvironmentSkills } = ctl
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLSpanElement | null>(null)
  useMenuDismiss(wrapRef, open, setOpen, false, triggerRef)

  return (
    <div className="dab-env-menu-wrap" ref={wrapRef}>
      <StudioBadge
        tone={environmentStatus === 'stopped' ? 'neutral' : environmentStatus === 'resetting' || environmentStatus === 'syncing' ? 'warning' : 'success'}
        testId="topbar-environment-btn" role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={open}
        data-env-status={environmentStatus}
        data-env-reset-notice={envResetNotice ? 'true' : undefined} data-env-sync-notice={envSyncNotice ? 'true' : undefined}
        onClick={(e) => { triggerRef.current = e.currentTarget; setOpen((prev) => !prev) }}
        onKeyDown={(e) => {
          triggerRef.current = e.currentTarget
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
        }}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
        title={environmentStatus === 'stopped' ? 'Antigravity sandbox environment stopped (click to manage)' : environmentStatus === 'resetting' ? 'Resetting Antigravity sandbox environment...' : environmentStatus === 'syncing' ? 'Syncing Ripper-managed skills into sandbox...' : 'Antigravity sandbox environment active (click to manage)'}
      >
        {renderEnvStatusIcon(environmentStatus)}
        <span>{formatEnvironmentStatusLabel(environmentStatus, envResetNotice, envSyncNotice)}</span>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
      </StudioBadge>

      {(envSkillsOutdated || environmentStatus === 'syncing') && (
        <StudioButton
          variant="secondary" testId="topbar-env-sync-btn" className="dab-btn-icon dab-env-sync-icon-btn"
          disabled={hasInFlightTurns || environmentStatus === 'syncing'} onClick={() => void handleSyncEnvironmentSkills()}
          title={environmentStatus === 'syncing' ? 'Updating Ripper-managed skills in sandbox...' : hasInFlightTurns ? 'Wait for active turn to finish before updating skills' : 'Update Ripper-managed skills'}
          aria-label="Update Ripper-managed skills"
        >
          <RefreshCw size={13} strokeWidth={1.75} className={environmentStatus === 'syncing' ? 'dab-spin' : undefined} aria-hidden="true" />
        </StudioButton>
      )}

      {open && (
        <div
          className="dab-env-popover-menu" data-testid="topbar-environment-menu"
          role="menu" aria-label="Environment actions" onKeyDown={handleMenuKeyNav}
        >
          {renderEnvActionItems(ctl, () => setOpen(false), false)}
        </div>
      )}
    </div>
  )
}

export const StudioResetEnvModal: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const { resetEnvModalOpen, setResetEnvModalOpen, handleResetEnvironment } = ctl
  const [confirmText, setConfirmText] = React.useState('')
  React.useEffect(() => { if (!resetEnvModalOpen) setConfirmText('') }, [resetEnvModalOpen])
  const close = () => {
    setConfirmText('')
    setResetEnvModalOpen(false)
    setTimeout(() => {
      const sel = typeof window !== 'undefined' && window.innerWidth <= 768
        ? '[data-testid="topbar-mobile-more-btn"]'
        : '[data-testid="topbar-environment-btn"]'
      document.querySelector<HTMLElement>(sel)?.focus()
    }, 0)
  }
  const confirm = () => { if (confirmText.trim() !== 'DELETE') return; setConfirmText(''); void handleResetEnvironment() }

  return (
    <StudioModal
      open={resetEnvModalOpen} onClose={close} testId="reset-env-modal"
      hideCloseButton title="Reset Environment & Expire Conversations?" maxWidth={460}
      footer={
        <>
          <StudioButton variant="secondary" testId="cancel-reset-env-btn" onClick={close}>Cancel</StudioButton>
          <StudioButton variant="danger" testId="confirm-reset-env-btn" disabled={confirmText.trim() !== 'DELETE'} onClick={confirm}>
            Reset Environment
          </StudioButton>
        </>
      }
    >
      <div className="dab-modal-body" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}>Resetting provisions a fresh remote sandbox container and permanently expires and deletes <strong>all Studio conversations</strong> from your history.</p>
        <div className="dab-modal-related-box">All published Looker <strong>Dashboards, Looks, Boards, and Data Apps</strong> remain untouched in Looker.</div>
        <div className="dab-modal-row">
          <label htmlFor="dab-reset-env-confirm-input">Type <code>DELETE</code> to confirm</label>
          <input
            id="dab-reset-env-confirm-input" type="text" data-testid="reset-env-confirm-input" autoFocus
            placeholder="Type DELETE to confirm" autoComplete="off" value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && confirmText.trim() === 'DELETE') { e.preventDefault(); confirm() } }}
          />
        </div>
      </div>
    </StudioModal>
  )
}

export const StudioMobileMoreMenu: React.FC<{ ctl: StudioController }> = ({ ctl }) => {
  const {
    themeMode, setThemeMode, environmentStatus, envResetNotice, envSyncNotice, envSkillsOutdated,
    authMode, oauthToken, oauthSigningIn, handleOAuthLogin, handleOAuthLogout, handleCancelOAuthLogin,
    extensionSDK, activeContentItem, busyStatus, handleRunHealthCheck,
  } = ctl
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef<HTMLDivElement | null>(null)
  const btnRef = React.useRef<HTMLButtonElement | null>(null)
  useMenuDismiss(wrapRef, open, setOpen, true, btnRef)
  const envBusy = environmentStatus === 'syncing' || environmentStatus === 'resetting'
  const showDot = envSkillsOutdated || envBusy
  const isSignOut = Boolean(oauthToken)
  const moreLabel = envBusy
    ? `More options (${environmentStatus === 'resetting' ? 'resetting environment' : 'syncing skills'})`
    : envSkillsOutdated
      ? 'More options (skill update available)'
      : 'More options'

  return (
    <div className="dab-mobile-more-wrap" ref={wrapRef}>
      <button
        ref={btnRef} type="button" data-testid="topbar-mobile-more-btn"
        className="dab-btn dab-btn-secondary dab-btn-icon dab-mobile-only-btn dab-mobile-more-btn"
        title={moreLabel} aria-label={moreLabel} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) } }}
      >
        <MoreVertical size={14} strokeWidth={1.75} aria-hidden="true" />
        {showDot && <span className={`dab-mobile-more-dot${envBusy ? ' busy' : ''}`} aria-hidden="true" />}
      </button>
      {open && (
        <div
          data-testid="topbar-mobile-more-menu" className="dab-env-popover-menu dab-mobile-more-menu"
          role="menu" aria-label="More options" onKeyDown={handleMenuKeyNav}
        >
          <div data-testid="mobile-more-env-status" data-env-status={environmentStatus} className="dab-mobile-more-status">
            {renderEnvStatusIcon(environmentStatus)}
            <span>{formatEnvironmentStatusLabel(environmentStatus, envResetNotice, envSyncNotice)}</span>
          </div>
          {renderEnvActionItems(ctl, () => setOpen(false), true)}
          {activeContentItem?.contentType === 'report' && (
            <button
              type="button" role="menuitem" data-testid="mobile-more-run-audit-btn"
              className="dab-studio-menu-item" disabled={!!busyStatus}
              onClick={() => { setOpen(false); void handleRunHealthCheck() }}
            >
              <span className="dab-studio-menu-item-main"><RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" /><span>Run 3-Pillar Audit</span></span>
            </button>
          )}
          <div className="dab-mobile-more-sep" role="separator" />
          <div role="group" aria-label="Theme Mode">
            {THEME_MODES.map(([mode, label]) => (
              <button
                key={mode} type="button" role="menuitemradio" aria-checked={themeMode === mode}
                data-testid={`mobile-more-theme-${mode}`}
                className={`dab-studio-menu-item${themeMode === mode ? ' selected' : ''}`}
                onClick={() => { setThemeMode(mode); setOpen(false) }}
              >
                <span className="dab-studio-menu-item-main"><ThemeModeIcon mode={mode} /><span>{label}</span></span>
                {themeMode === mode && <Check size={12} strokeWidth={2} className="dab-studio-menu-check" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div className="dab-mobile-more-sep" role="separator" />
          {authMode === 'oauth' ? (
            <button
              type="button" role="menuitem" data-testid={isSignOut ? 'mobile-more-signout-btn' : 'mobile-more-signin-btn'}
              className="dab-studio-menu-item"
              onClick={() => {
                setOpen(false)
                if (isSignOut) handleOAuthLogout()
                else if (oauthSigningIn) handleCancelOAuthLogin()
                else void handleOAuthLogin()
              }}
            >
              <span className="dab-studio-menu-item-main">
                {isSignOut ? <LogOut size={13} strokeWidth={1.75} aria-hidden="true" /> : <User size={13} strokeWidth={1.75} aria-hidden="true" />}
                <span>{isSignOut ? 'Sign Out' : oauthSigningIn ? 'Signing in… (Cancel)' : 'Sign In with Google'}</span>
              </span>
            </button>
          ) : (
            <div className="dab-mobile-more-status">
              <span className="dab-badge" data-testid="mobile-more-apikey-badge" title={formatApiKeyBadgeTitle(extensionSDK)}>API Key (User Attr) ✓</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
