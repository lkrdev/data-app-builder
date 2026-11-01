import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ExtensionProvider } from '@looker/extension-sdk-react'
import {
  LookerExtensionProvider,
  MockLookerExtensionProvider,
} from '../contexts/LookerExtensionContext'
import { useStudioController } from '../useStudioController'
import { parseStudioRoute, STUDIO_MODES, type StudioMode } from '../lookerApi'
import { PythonTile } from './PythonTile'
import { ConfigSetupView, StudioTopbar } from './StudioHeader'
import {
  StudioCenteredEmptyStage,
  StudioConversationsSidebar,
  StudioLeftPane,
  StudioRightPane,
} from './StudioWorkspace'
import '../styles/index.css'

export { parseStudioRoute, STUDIO_MODES }
export type { StudioMode }

const PythonTileMount: React.FC = () => <PythonTile />

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  images?: string[]
  interactionId?: string
  dashboardId?: string
  widgetCount?: number
}

const StudioMain: React.FC = () => {
  const ctl = useStudioController()

  if (ctl.isTileMount) return <PythonTileMount />

  if (ctl.location.pathname === '/config') {
    return <ConfigSetupView ctl={ctl} />
  }

  return (
    <div className="dab-shell" data-theme={ctl.resolvedTheme} data-theme-mode={ctl.themeMode}>
      <StudioTopbar ctl={ctl} />
      <div
        className={`dab-workspace dab-workspace-with-sidebar ${
          ctl.sidebarCollapsed ? 'dab-workspace-sidebar-collapsed' : ''
        } ${ctl.isEmptyConversation ? 'dab-workspace-empty' : ''}`}
      >
        <StudioConversationsSidebar ctl={ctl} />
        {ctl.isEmptyConversation ? (
          <StudioCenteredEmptyStage ctl={ctl} />
        ) : (
          <StudioLeftPane ctl={ctl} />
        )}
        <StudioRightPane ctl={ctl} />
      </div>
    </div>
  )
}

export const App = () => {
  const mockCtx =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined
  if (mockCtx) {
    return (
      <MemoryRouter initialEntries={[mockCtx.initialRoute || '/']}>
        <MockLookerExtensionProvider value={mockCtx}>
          <StudioMain />
        </MockLookerExtensionProvider>
      </MemoryRouter>
    )
  }
  return (
    <ExtensionProvider>
      <LookerExtensionProvider>
        <StudioMain />
      </LookerExtensionProvider>
    </ExtensionProvider>
  )
}
