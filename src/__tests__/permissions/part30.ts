import { readFileSync } from 'node:fs'
import path from 'node:path'

import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'

import { type AntigravityExtensionHostLike, prewarmOrWakeAntigravityEnvironment } from '../../antigravity'
import {
  DEFAULT_TOAST_DURATION_MS,
  StudioToast,
  type StudioToastItem,
  type StudioToastTone,
  StudioToastViewport,
} from '../../components/StudioDesignSystem'
import {
  formatApiKeyBadgeTitle,
  formatEnvironmentStatusLabel,
  StudioDevModeBadge,
  StudioMobileMoreMenu,
  ThemeModeSelect,
} from '../../components/StudioTopbarMenus'
import type { StudioController } from '../../useStudioController'

export function registerPermissionsPart30Tests(): void {
  test('108. Issue #238: renders StudioToast & StudioToastViewport across all 4 tones, enforces 10s default / custom / disabled auto-dismiss timers with cleanup, and routes non-conversation errors to pushToast', async () => {
    expect(DEFAULT_TOAST_DURATION_MS).toBe(10_000)

    // Verify re-export parity via StudioHeader with minimal Node window stub
    const g = globalThis as Record<string, unknown>
    const hadWindow = 'window' in g
    const prevWindow = g.window
    g.window = { addEventListener: () => {}, removeEventListener: () => {} }
    try {
      const headerMod = await import('../../components/StudioHeader')
      expect(headerMod.DEFAULT_TOAST_DURATION_MS).toBe(10_000)
      expect(headerMod.StudioToast).toBe(StudioToast)
      expect(headerMod.StudioToastViewport).toBe(StudioToastViewport)
    } finally {
      if (hadWindow) g.window = prevWindow
      else delete g.window
    }

    // Empty viewport renders null
    expect(renderToStaticMarkup(React.createElement(StudioToastViewport, { toasts: [], onDismiss: () => {} }))).toBe('')

    // SSR render of all 4 tones (info, success, warning, error) + optional title
    const items: StudioToastItem[] = [
      { id: 'toast_1', tone: 'info', title: 'Sandbox Notice', message: 'Provisioning shared container...' },
      { id: 'toast_2', tone: 'success', message: 'Configured hidden Looker User Attribute and saved extension context.' },
      { id: 'toast_3', tone: 'warning', message: 'Looker session switched to Development Mode.' },
      { id: 'toast_4', tone: 'error', title: 'Sync Error', message: 'Skill sync failed: Please sign in with Google OAuth first.' },
    ]
    const html = renderToStaticMarkup(React.createElement(StudioToastViewport, { toasts: items, onDismiss: () => {} }))
    expect(html).toContain('data-testid="studio-toast-viewport"')
    expect(html).toContain('class="dab-toast-viewport"')
    for (const tone of ['info', 'success', 'warning', 'error'] as StudioToastTone[]) {
      expect(html).toContain(`data-toast-tone="${tone}"`)
      expect(html).toContain(`dab-toast-${tone}`)
    }
    expect(html).toContain('data-toast-id="toast_1"')
    expect(html).toContain('data-toast-id="toast_4"')
    expect(html.match(/data-testid="studio-toast"/g)).toHaveLength(4)
    expect(html.match(/data-testid="studio-toast-dismiss-btn"/g)).toHaveLength(4)
    expect(html.match(/aria-label="Dismiss notification"/g)).toHaveLength(4)
    expect(html.match(/role="status"/g)).toHaveLength(3)
    expect(html.match(/role="alert"/g)).toHaveLength(1)
    expect(html.match(/<svg\b[^>]*width="15"[^>]*height="15"/g)).toHaveLength(4)
    expect(html).toContain('class="dab-toast-title">Sandbox Notice</div>')
    expect(html).toContain('class="dab-toast-title">Sync Error</div>')

    // Timer lifecycle: 10_000ms default, custom positive durationMs, disabled null / <= 0, unmount cleanup, and manual dismiss cleanup
    jest.useFakeTimers()
    const useRefSpy = jest
      .spyOn(React, 'useRef')
      .mockImplementation(((initialValue?: unknown) => ({ current: initialValue })) as typeof React.useRef)
    let activeEffectCleanup: (() => void) | undefined
    const useEffectSpy = jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      const cleanup = effect()
      activeEffectCleanup = typeof cleanup === 'function' ? cleanup : undefined
    })

    try {
      // 1. Default 10s auto-dismiss when durationMs is undefined
      const dismissedDefault: string[] = []
      StudioToast({
        toast: { id: 't_default', tone: 'error', message: 'Default 10s timer' },
        onDismiss: (id) => dismissedDefault.push(id),
      })
      jest.advanceTimersByTime(9_999)
      expect(dismissedDefault).toEqual([])
      jest.advanceTimersByTime(1)
      expect(dismissedDefault).toEqual(['t_default'])

      // 2. Custom positive durationMs (250ms)
      const dismissedCustom: string[] = []
      StudioToast({
        toast: { id: 't_custom', tone: 'info', message: 'Custom 250ms timer', durationMs: 250 },
        onDismiss: (id) => dismissedCustom.push(id),
      })
      jest.advanceTimersByTime(249)
      expect(dismissedCustom).toEqual([])
      jest.advanceTimersByTime(1)
      expect(dismissedCustom).toEqual(['t_custom'])

      // 3. Disabled auto-dismiss when durationMs is null, 0, or negative
      const dismissedSticky: string[] = []
      for (const stickyMs of [null, 0, -500] as Array<number | null>) {
        StudioToast({
          toast: { id: `t_sticky_${String(stickyMs)}`, tone: 'warning', message: 'Sticky', durationMs: stickyMs },
          onDismiss: (id) => dismissedSticky.push(id),
        })
      }
      jest.advanceTimersByTime(60_000)
      expect(dismissedSticky).toEqual([])

      // 4. Unmount cleans up pending setTimeout handle
      const dismissedUnmounted: string[] = []
      StudioToast({
        toast: { id: 't_unmount', tone: 'success', message: 'Unmounted early' },
        onDismiss: (id) => dismissedUnmounted.push(id),
      })
      jest.advanceTimersByTime(4_000)
      activeEffectCleanup?.()
      jest.advanceTimersByTime(10_000)
      expect(dismissedUnmounted).toEqual([])

      // 5. Manual dismiss button clears active setTimeout so onDismiss never double-fires
      const dismissedManual: string[] = []
      const el = StudioToast({
        toast: { id: 't_manual', tone: 'error', message: 'Dismissed manually' },
        onDismiss: (id) => dismissedManual.push(id),
      }) as React.ReactElement<{ children: React.ReactNode[] }>
      const closeBtn = el.props.children[2] as React.ReactElement<{ onClick: () => void }>
      closeBtn.props.onClick()
      expect(dismissedManual).toEqual(['t_manual'])
      jest.advanceTimersByTime(15_000)
      expect(dismissedManual).toEqual(['t_manual'])
    } finally {
      useEffectSpy.mockRestore()
      useRefSpy.mockRestore()
      jest.useRealTimers()
    }

    // Verify non-conversation error boundaries: ConfigSetupView omits .dab-msg-error, mockExt.initialError stays in messages, and apikey serverProxy is respected
    const repoRoot = path.resolve(__dirname, '../../..')
    const headerSrc = readFileSync(path.join(repoRoot, 'src/components/StudioHeader.tsx'), 'utf8')
    const authSrc = readFileSync(path.join(repoRoot, 'src/studioControllerAuth.ts'), 'utf8')
    const turnSrc = readFileSync(path.join(repoRoot, 'src/studioControllerTurn.ts'), 'utf8')
    expect(headerSrc).not.toContain('dab-msg-error')
    expect(authSrc).toContain("mockExt?.initialError ? [{ role: 'error' as const, text: String(mockExt.initialError) }] : []")
    expect(turnSrc).toContain('extensionSDK?.serverProxy')

    // Verify prewarmOrWakeAntigravityEnvironment falls back to standby by default, and rejects when rethrowOnError: true
    const failingExt = {
      serverProxy: async () => ({ ok: false, status: 503, body: JSON.stringify({ error: { message: 'Sandbox capacity unavailable' } }) }),
    } as unknown as AntigravityExtensionHostLike
    const standbyRes = await prewarmOrWakeAntigravityEnvironment({
      extensionSDK: failingExt,
      auth: { mode: 'apikey', apiKey: '' },
      forceFresh: true,
    })
    expect(standbyRes.status).toBe('standby')
    await expect(
      prewarmOrWakeAntigravityEnvironment({
        extensionSDK: failingExt,
        auth: { mode: 'apikey', apiKey: '' },
        forceFresh: true,
        rethrowOnError: true,
      })
    ).rejects.toThrow('Sandbox capacity unavailable')
  })

  test('109. Issue #245: renders icon+label StudioDevModeBadge, StudioMobileMoreMenu (environment, theme, OAuth/API-key auth), and keeps reset-env-modal outside .dab-env-menu-wrap', async () => {
    expect(formatEnvironmentStatusLabel('active', false, false)).toBe('Environment')
    expect(formatEnvironmentStatusLabel('stopped', false, false)).toBe('Environment (Stopped)')
    expect(formatEnvironmentStatusLabel('syncing', false, false)).toBe('Syncing Skills...')
    expect(formatEnvironmentStatusLabel('resetting', false, false)).toBe('Resetting...')
    expect(formatEnvironmentStatusLabel('active', true, false)).toBe('✓ Environment Reset')
    expect(formatEnvironmentStatusLabel('active', false, true)).toBe('✓ Skills Updated')

    const devBadgeHtml = renderToStaticMarkup(React.createElement(StudioDevModeBadge))
    expect(devBadgeHtml).toContain('data-testid="topbar-dev-mode-badge"')
    expect(devBadgeHtml).toContain('title="Looker session is in Development Mode"')
    expect(devBadgeHtml).toContain('aria-label="Looker session is in Development Mode"')
    expect(devBadgeHtml).toContain('dab-mobile-dev-icon')
    expect(devBadgeHtml).toContain('<span class="dab-dev-mode-label">Dev Mode</span>')

    const makeCtl = (overrides: Partial<StudioController> = {}): StudioController =>
      ({
        agentName: 'Ripper',
        editingAgentName: false,
        setEditingAgentName: () => {},
        handleSaveAgentName: async () => {},
        handleNewConversation: () => {},
        themeMode: 'dark',
        resolvedTheme: 'dark',
        setThemeMode: () => {},
        sharedEnvironmentId: 'env_shared_1',
        environmentStatus: 'active',
        envResetNotice: false,
        envSyncNotice: false,
        resetEnvModalOpen: false,
        setResetEnvModalOpen: () => {},
        hasInFlightTurns: false,
        envSkillsOutdated: false,
        handleSyncEnvironmentSkills: async () => {},
        handleResetEnvironment: async () => {},
        handleStopEnvironment: () => {},
        requirePermission: true,
        setRequirePermission: () => {},
        loadingMetadata: false,
        folderTreeNodes: { '1': { id: '1', name: 'Shared', parent_id: null, is_personal: false } },
        rootFolderIds: ['1'],
        folderChildrenById: {},
        expandedFolderIds: [],
        loadingFolderIds: [],
        toggleExpandFolder: async () => {},
        hydrateFolderAncestors: async () => {},
        handleSearchFolders: async () => [],
        selectedFolderId: '1',
        setSelectedFolderId: () => {},
        authMode: 'oauth',
        oauthToken: 'tok_live',
        oauthSigningIn: false,
        handleOAuthLogin: async () => {},
        handleOAuthLogout: () => {},
        handleCancelOAuthLogin: () => {},
        healthScope: 'all',
        setHealthScope: () => {},
        handleRunHealthCheck: async () => {},
        busyStatus: null,
        userDisplayName: 'Bryan',
        isLookerDevMode: true,
        isEmptyConversation: false,
        rightPaneCollapsed: true,
        activeContentTabKey: '',
        setActiveContentTabKey: () => {},
        setRightPaneCollapsed: () => {},
        handleSelectOverview: () => {},
        folderModalOpen: false,
        setFolderModalOpen: () => {},
        ...overrides,
      }) as unknown as StudioController

    // Closed mobile more menu: renders trigger without dot when active & up-to-date, with dot & status aria-label when outdated/syncing/resetting
    const closedIdleHtml = renderToStaticMarkup(React.createElement(StudioMobileMoreMenu, { ctl: makeCtl() }))
    expect(closedIdleHtml).toContain('data-testid="topbar-mobile-more-btn"')
    expect(closedIdleHtml).toContain('aria-label="More options"')
    expect(closedIdleHtml).toContain('aria-haspopup="menu"')
    expect(closedIdleHtml).toContain('aria-expanded="false"')
    expect(closedIdleHtml).not.toContain('dab-mobile-more-dot')
    expect(closedIdleHtml).not.toContain('data-testid="topbar-mobile-more-menu"')

    const closedOutdatedHtml = renderToStaticMarkup(
      React.createElement(StudioMobileMoreMenu, { ctl: makeCtl({ envSkillsOutdated: true }) })
    )
    expect(closedOutdatedHtml).toContain('class="dab-mobile-more-dot"')
    expect(closedOutdatedHtml).toContain('aria-label="More options (skill update available)"')

    const closedSyncingHtml = renderToStaticMarkup(
      React.createElement(StudioMobileMoreMenu, { ctl: makeCtl({ environmentStatus: 'syncing' }) })
    )
    expect(closedSyncingHtml).toContain('class="dab-mobile-more-dot busy"')
    expect(closedSyncingHtml).toContain('aria-label="More options (syncing skills)"')

    const closedResettingHtml = renderToStaticMarkup(
      React.createElement(StudioMobileMoreMenu, { ctl: makeCtl({ environmentStatus: 'resetting' }) })
    )
    expect(closedResettingHtml).toContain('class="dab-mobile-more-dot busy"')
    expect(closedResettingHtml).toContain('aria-label="More options (resetting environment)"')

    const renderOpenMenu = (overrides: Partial<StudioController> = {}): string => {
      const spy = jest.spyOn(React, 'useState').mockImplementationOnce(() => [true, () => {}])
      try {
        return renderToStaticMarkup(React.createElement(StudioMobileMoreMenu, { ctl: makeCtl(overrides) }))
      } finally {
        spy.mockRestore()
      }
    }

    // Open mobile more menu: OAuth signed-in + outdated skills + report audit item
    const openSignedInHtml = renderOpenMenu({
      envSkillsOutdated: true,
      themeMode: 'dark',
      activeContentItem: { key: 'report:1', contentType: 'report', contentId: '1', title: 'Audit' } as unknown as StudioController['activeContentItem'],
    })
    expect(openSignedInHtml).toContain('data-testid="topbar-mobile-more-menu"')
    expect(openSignedInHtml).toContain('role="menu"')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-env-status"')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-sync-skills-btn"')
    expect(openSignedInHtml).toContain('Update available')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-stop-env-btn"')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-reset-env-btn"')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-run-audit-btn"')
    expect(openSignedInHtml).toContain('dab-env-menu-item-danger')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-theme-light"')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-theme-dark"')
    expect(openSignedInHtml).toContain('data-testid="mobile-more-theme-system"')
    expect(openSignedInHtml).toMatch(/role="menuitemradio"[^>]*aria-checked="true"[^>]*data-testid="mobile-more-theme-dark"/)
    expect(openSignedInHtml).toContain('data-testid="mobile-more-signout-btn"')
    expect(openSignedInHtml).toContain('Sign Out')

    // Disabled matrix on mobile-more-sync-skills-btn (!sharedEnvironmentId, hasInFlightTurns, stopped) and resetting stop/reset buttons
    for (const ov of [
      { sharedEnvironmentId: '', environmentStatus: 'active' as const },
      { hasInFlightTurns: true, environmentStatus: 'active' as const },
      { environmentStatus: 'stopped' as const },
    ]) {
      expect(renderOpenMenu(ov)).toMatch(/data-testid="mobile-more-sync-skills-btn"[^>]*disabled=""/)
    }
    const openSignedOutHtml = renderOpenMenu({ oauthToken: '', environmentStatus: 'resetting' })
    expect(openSignedOutHtml).toContain('data-testid="mobile-more-signin-btn"')
    expect(openSignedOutHtml).toContain('Sign In with Google')
    expect(openSignedOutHtml).toMatch(/data-testid="mobile-more-sync-skills-btn"[^>]*disabled=""/)
    expect(openSignedOutHtml).toMatch(/data-testid="mobile-more-stop-env-btn"[^>]*disabled=""/)
    expect(openSignedOutHtml).toMatch(/data-testid="mobile-more-reset-env-btn"[^>]*disabled=""/)

    const openSigningInHtml = renderOpenMenu({ oauthToken: '', oauthSigningIn: true })
    expect(openSigningInHtml).toContain('Signing in… (Cancel)')

    // Verify clicking mobile-more-signin-btn while oauthSigningIn=true closes menu and calls handleCancelOAuthLogin() (not handleOAuthLogin())
    let cancelCalls = 0
    let loginCalls = 0
    const setOpenCalls: boolean[] = []
    const stateSpy = jest.spyOn(React, 'useState').mockImplementationOnce(() => [true, (v: unknown) => setOpenCalls.push(Boolean(v))])
    const refSpy = jest.spyOn(React, 'useRef').mockImplementation(((init?: unknown) => ({ current: init })) as typeof React.useRef)
    const fxSpy = jest.spyOn(React, 'useEffect').mockImplementation(() => {})
    try {
      const tree = StudioMobileMoreMenu({
        ctl: makeCtl({
          oauthToken: '',
          oauthSigningIn: true,
          handleCancelOAuthLogin: () => { cancelCalls += 1 },
          handleOAuthLogin: async () => { loginCalls += 1 },
        }),
      }) as React.ReactElement<{ children: React.ReactNode[] }>
      const menuEl = tree.props.children[1] as React.ReactElement<{ children: React.ReactNode[] }>
      const signInBtn = menuEl.props.children[menuEl.props.children.length - 1] as React.ReactElement<{
        'data-testid': string; onClick: () => void
      }>
      expect(signInBtn.props['data-testid']).toBe('mobile-more-signin-btn')
      signInBtn.props.onClick()
      expect(setOpenCalls).toEqual([false])
      expect(cancelCalls).toBe(1)
      expect(loginCalls).toBe(0)
    } finally {
      fxSpy.mockRestore()
      refSpy.mockRestore()
      stateSpy.mockRestore()
    }

    // Open mobile more menu: API Key auth mode
    const openApiKeyHtml = renderOpenMenu({ authMode: 'apikey', oauthToken: '' })
    expect(openApiKeyHtml).toContain('data-testid="mobile-more-apikey-badge"')
    expect(openApiKeyHtml).toContain('API Key (User Attr) ✓')
    expect(openApiKeyHtml).toContain(formatApiKeyBadgeTitle(undefined))
    expect(openApiKeyHtml).not.toContain('mobile-more-signin-btn')
    expect(openApiKeyHtml).not.toContain('mobile-more-signout-btn')
    expect(typeof ThemeModeSelect).toBe('function')

    // Verify test-bundle.mjs registration, CSS contract, and balanced-tag proof that reset-env-modal mounts outside .dab-env-menu-wrap
    const repoRoot = path.resolve(__dirname, '../../..')
    const testBundleSrc = readFileSync(path.join(repoRoot, 'scripts/test-bundle.mjs'), 'utf8')
    const cssSrc = readFileSync(path.join(repoRoot, 'src/styles/index.css'), 'utf8')
    expect(testBundleSrc).toContain("'src/components/StudioTopbarMenus.tsx'")
    expect(cssSrc).toContain('.dab-topbar .dab-env-menu-wrap')
    expect(cssSrc).toContain('.dab-topbar [data-testid="topbar-theme-select"]')
    expect(cssSrc).toContain('.dab-topbar [data-testid="topbar-oauth-signin-btn"]')

    const g = globalThis as Record<string, unknown>
    const hadWindow = 'window' in g
    const prevWindow = g.window
    g.window = { addEventListener: () => {}, removeEventListener: () => {} }
    try {
      const { MemoryRouter } = await import('react-router-dom')
      const { MockLookerExtensionProvider } = await import('../../contexts/LookerExtensionContext')
      const headerMod = await import('../../components/StudioHeader')
      const topbarEl = React.createElement(headerMod.StudioTopbar, { ctl: makeCtl({ resetEnvModalOpen: true }) })
      const mockProps: Parameters<typeof MockLookerExtensionProvider>[0] = {
        value: {} as unknown as Parameters<typeof MockLookerExtensionProvider>[0]['value'],
        children: topbarEl,
      }
      const topbarHtml = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(MockLookerExtensionProvider, mockProps)))
      const envWrapStart = topbarHtml.indexOf('<div class="dab-env-menu-wrap">')
      expect(envWrapStart).toBeGreaterThan(-1)
      const divTagRe = /<\/?div\b[^>]*>/g
      divTagRe.lastIndex = envWrapStart
      let depth = 0
      let envWrapEnd = -1
      let m: RegExpExecArray | null
      while ((m = divTagRe.exec(topbarHtml)) !== null) {
        depth += m[0].startsWith('</div') ? -1 : 1
        if (depth === 0) {
          envWrapEnd = divTagRe.lastIndex
          break
        }
      }
      const modalIdx = topbarHtml.indexOf('data-testid="reset-env-modal"')
      expect(envWrapEnd).toBeGreaterThan(envWrapStart)
      expect(modalIdx).toBeGreaterThan(envWrapEnd)
      expect(topbarHtml).toContain('data-testid="topbar-mobile-more-btn"')
    } finally {
      if (hadWindow) g.window = prevWindow
      else delete g.window
    }
  })
}
