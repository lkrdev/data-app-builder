import React from 'react'

import { ExtensionProvider } from '@looker/extension-sdk-react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import { LookerExtensionProvider, MockLookerExtensionProvider } from '../contexts/LookerExtensionContext'
import { parseStudioRoute, type PersistedChatTurn, STUDIO_MODES, type StudioMode } from '../lookerApi'
import { useStudioController } from '../useStudioController'
import { PythonTile } from './PythonTile'
import { ConfigSetupView, RipperSurfLoader, StudioTopbar } from './StudioHeader'
import { StudioCenteredEmptyStage, StudioConversationsSidebar, StudioLeftPane, StudioRightPane } from './StudioWorkspace'
import '../styles/index.css'

export { parseStudioRoute, STUDIO_MODES }
export type { StudioMode }

const PythonTileMount: React.FC = () => <PythonTile />

export interface ChatMessage extends PersistedChatTurn { images?: string[] }

const StudioMain: React.FC = () => {
  const ctl = useStudioController()
  const [longPressTooltip, setLongPressTooltip] = React.useState<{ text: string; left: number; top: number } | null>(null)
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressNextClickRef = React.useRef(false)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  React.useEffect(() => () => {
    clearLongPressTimer()
    if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current)
  }, [])

  if (ctl.isTileMount) return <PythonTileMount />
  if (ctl.appInitializing) return <RipperSurfLoader agentName={ctl.agentName} theme={ctl.resolvedTheme} themeMode={ctl.themeMode} />
  if (ctl.location.pathname === '/config') return <ConfigSetupView ctl={ctl} />

  return (
    <div
      className="dab-shell"
      data-theme={ctl.resolvedTheme}
      data-theme-mode={ctl.themeMode}
      onMouseDown={() => {
        if (!suppressNextClickRef.current) setLongPressTooltip(null)
      }}
      onTouchStart={(e) => {
        clearLongPressTimer()
        if (dismissTimerRef.current !== null) {
          clearTimeout(dismissTimerRef.current)
          dismissTimerRef.current = null
        }
        suppressNextClickRef.current = false
        setLongPressTooltip(null)
        const target = (e.target as HTMLElement | null)?.closest?.(
          'button, [role="button"], [role="option"], a, summary, .dab-badge'
        ) as HTMLElement | null
        if (!target || target.closest('.dab-msg-user')) return
        const label = (target.getAttribute('title') || target.getAttribute('aria-label') || '').trim()
        if (!label) return
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null
          const rect = target.getBoundingClientRect()
          suppressNextClickRef.current = true
          setLongPressTooltip({
            text: label,
            left: Math.min(Math.max(12, rect.left + rect.width / 2), (window.innerWidth || 390) - 12),
            top: Math.max(8, rect.bottom + 6),
          })
          dismissTimerRef.current = setTimeout(() => {
            dismissTimerRef.current = null
            setLongPressTooltip(null)
          }, 2200)
        }, 450)
      }}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      onTouchMove={clearLongPressTimer}
      onClickCapture={(e) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <StudioTopbar ctl={ctl} />
      <div
        className={`dab-workspace dab-workspace-with-sidebar ${ctl.sidebarCollapsed ? 'dab-workspace-sidebar-collapsed' : ''} ${ctl.rightPaneCollapsed ? 'dab-workspace-right-collapsed' : ''} ${ctl.isEmptyConversation ? 'dab-workspace-empty' : ''}`}
        style={{ '--dab-left-pane-width': `${ctl.leftPaneWidth}px` } as React.CSSProperties}
      >
        <StudioConversationsSidebar ctl={ctl} />
        {ctl.isEmptyConversation ? <StudioCenteredEmptyStage ctl={ctl} /> : <StudioLeftPane ctl={ctl} />}
        <StudioRightPane ctl={ctl} />
      </div>
      {longPressTooltip && (
        <div
          data-testid="studio-longpress-tooltip"
          role="tooltip"
          className="dab-longpress-tooltip"
          style={{ left: longPressTooltip.left, top: longPressTooltip.top }}
        >
          {longPressTooltip.text}
        </div>
      )}
    </div>
  )
}

export const App = () => {
  const mockCtx = typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined
  return (
    <SWRConfig value={{ revalidateOnFocus: false, dedupingInterval: 15000 }}>
      {mockCtx ? (
        <MemoryRouter initialEntries={[mockCtx.initialRoute || '/']}>
          <MockLookerExtensionProvider value={mockCtx}><StudioMain /></MockLookerExtensionProvider>
        </MemoryRouter>
      ) : (
        <ExtensionProvider><LookerExtensionProvider><StudioMain /></LookerExtensionProvider></ExtensionProvider>
      )}
    </SWRConfig>
  )
}
