import { useEffect } from 'react'

import {
  getUseCaseLabel, resolveConversationRelatedContent, searchGlobalContentV2,
} from './lookerApi'
import { useStudioAuthAndPrefs } from './studioControllerAuth'
import { StudioViewerDocument, useStudioLoaders } from './studioControllerLoaders'
import { useStudioMetadata } from './studioControllerMetadata'
import { QueuedPromptItem, StudioEnvironmentStatus, useStudioTurn } from './studioControllerTurn'

export {
  authenticateGoogleOAuth, computeIsAuthenticated, DEFAULT_MAX_TOOL_ROUNDS, DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_THINKING_LEVEL, loadStoredThinkingLevel, normalizeMaxToolRounds, normalizeMaxTotalTokens,
  normalizeThinkingLevel, persistThinkingLevel, readInitialThinkingLevel,
  refreshOAuthSessionIfNeeded, resolveLookerOAuthRedirectUri,
  resolveLookerOAuthRedirectUris, STUDIO_MAX_TOOL_ROUNDS_OPTIONS, STUDIO_MAX_TOTAL_TOKENS_OPTIONS,
  STUDIO_OAUTH_REFRESH_LOCK_KEY, STUDIO_OAUTH_STORAGE_KEY,
  STUDIO_THINKING_LEVEL_OPTIONS, STUDIO_THINKING_LEVEL_STORAGE_KEY,
} from './antigravity'
export type { StudioThinkingLevel } from './antigravity'
export {
  DEFAULT_BUSY_SEND_ACTION, loadStoredBusySendAction, loadStoredSelectedFolderId,
  normalizeBusySendAction, normalizeStudioThemeMode, persistSelectedFolderId,
  readInitialBusySendAction, readInitialSelectedFolderId, resolveStudioTheme,
  resolveSystemTheme, saveStoredBusySendAction, STUDIO_BUSY_SEND_ACTION_STORAGE_KEY,
  STUDIO_FOLDER_STORAGE_KEY, STUDIO_THEME_STORAGE_KEY,
} from './lookerApi'
export type {
  ResolvedStudioTheme, StudioBusySendAction, StudioContextCategory,
  StudioContextMention, StudioThemeMode,
} from './lookerApi'
export type { QueuedPromptItem, StudioEnvironmentStatus, StudioViewerDocument }

export function useStudioController() {
  const auth = useStudioAuthAndPrefs()
  const meta = useStudioMetadata(auth)
  const loaders = useStudioLoaders(auth, meta)
  const turn = useStudioTurn(auth, meta, loaders)

  const controller = {
    ...auth,
    ...meta,
    ...loaders,
    ...turn,
    setSelectedUseCase: meta.handleChangeUseCase,
    getUseCaseLabel,
    searchGlobalContentV2,
    explicitUseCase: auth.explicitUseCaseRef.current,
    loading: Boolean(auth.busyStatus),
    setQueuedPrompts: turn.updateQueuedPrompts,
    conversations: loaders.filteredConversations,
    allConversations: loaders.modeAllowedConversations,
    handleSend: turn.handleSendPrompt,
    resolveConversationRelatedContent,
  }

  useEffect(() => {
    if (typeof window !== 'undefined') window.__DAB_STUDIO__ = controller
  })

  return controller
}

export type StudioController = ReturnType<typeof useStudioController>
