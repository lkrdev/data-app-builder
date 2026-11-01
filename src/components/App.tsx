import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ExtensionProvider } from '@looker/extension-sdk-react'
import {
  LookerExtensionProvider,
  MockLookerExtensionProvider,
} from '../contexts/LookerExtensionContext'
import { useStudioController } from '../useStudioController'
import { PythonTile, ScriptStudioView } from './PythonTile'
import { ConfigSetupView, StudioTopbar } from './StudioHeader'
import {
  StudioCenteredEmptyStage,
  StudioConversationsSidebar,
  StudioLeftPane,
  StudioRightPane,
} from './StudioWorkspace'
import '../styles/index.css'

export type StudioMode = 'app' | 'dashboard' | 'lookml' | 'health' | 'tile'

export const STUDIO_MODES: Array<{
  mode: StudioMode
  label: string
  prefix: string
}> = [
  { mode: 'app', label: 'Data App', prefix: '/app' },
  { mode: 'dashboard', label: 'Content Studio', prefix: '/dashboard' },
  { mode: 'lookml', label: 'LookML', prefix: '/lookml' },
  { mode: 'health', label: 'Health Check', prefix: '/health-check' },
  { mode: 'tile', label: 'Python Tile', prefix: '/tile' },
]

export function parseStudioRoute(pathname: string): {
  mode: StudioMode
  objectId: string
  isCaRoute?: boolean
} {
  const clean = (pathname || '/').trim()
  if (clean === '/' || clean === '/config') return { mode: 'app', objectId: '' }
  if (clean.startsWith('/conversational-analytics') || clean === '/ca' || clean.startsWith('/ca/')) {
    const rest = clean.replace(/^\/(?:conversational-analytics|ca)\/?/, '')
    return { mode: 'app', objectId: decodeURIComponent(rest), isCaRoute: true }
  }
  if (clean.startsWith('/health')) {
    const rest = clean.replace(/^\/health(?:-check)?\/?/, '')
    return { mode: 'health', objectId: decodeURIComponent(rest) }
  }
  if (clean.startsWith('/script')) {
    const rest = clean.replace(/^\/script\/?/, '')
    return { mode: 'tile', objectId: decodeURIComponent(rest) }
  }
  for (const m of STUDIO_MODES) {
    if (clean === m.prefix || clean.startsWith(`${m.prefix}/`)) {
      return {
        mode: m.mode,
        objectId: decodeURIComponent(clean.slice(m.prefix.length).replace(/^\/+/, '')),
      }
    }
  }
  return {
    mode: 'app',
    objectId: decodeURIComponent(clean.replace(/^\/+/, '')),
  }
}

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

  if (ctl.activeMode === 'tile' && !ctl.disabledModes.includes('tile')) {
    return (
      <ScriptStudioView
        auth={{
          mode: ctl.authMode,
          oauthToken: ctl.oauthToken,
          clientId: ctl.clientId,
          projectId: ctl.projectId,
          apiKey: ctl.apiKey,
        }}
        selectedModel={ctl.selectedModel}
        availableModels={ctl.availableModels}
        onChangeModel={ctl.setSelectedModel}
        schemaMarkdown={ctl.schemaMarkdown}
        selectedExplores={ctl.selectedExplores}
        selectedFolderId={ctl.selectedFolderId}
        folders={ctl.folders}
        onChangeFolder={ctl.setSelectedFolderId}
        disabledModes={ctl.disabledModes}
        capabilities={ctl.capabilities}
        sharedEnvironmentId={ctl.sharedEnvironmentId}
        onEnvironmentUpdated={ctl.syncSharedEnvironmentId}
      />
    )
  }

  if (ctl.location.pathname === '/config') {
    return <ConfigSetupView ctl={ctl} />
  }

  return (
    <div className="dab-shell">
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
      <MemoryRouter initialEntries={[mockCtx.initialRoute || '/app']}>
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
