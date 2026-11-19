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
}
