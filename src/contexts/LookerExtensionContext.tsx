// LOOKER SDK: All Looker SDK initialization happens here

import React, { createContext, useContext, ReactNode } from 'react';

import { ExtensionContext, ExtensionContextData } from '@looker/extension-sdk-react';
import type { Looker40SDK } from '@looker/sdk';

export interface LookerExtensionContextState {
  extensionSDK: ExtensionContextData['extensionSDK'];
  core40SDK: Looker40SDK;
  tileHostData?: ExtensionContextData['tileHostData'];
  tileSDK?: ExtensionContextData['tileSDK'];
  lookerHostData?: ExtensionContextData['lookerHostData'];
}

export interface MockLookerExtensionContextValue extends LookerExtensionContextState {
  initialRoute?: string;
  initialSelectedFolderId?: string;
  forceFolderSkeleton?: boolean;
  initialComboOpen?: boolean;
  initialFolderPopoverOpen?: boolean;
  initialFolderSearchModalOpen?: boolean;
  initialExploreScrollTop?: number;
  initialTddViewMode?: 'rendered' | 'raw';
  getMockPreviewHtml?: (mode: string, objectId: string) => string | undefined;
  initialThemeMode?: 'light' | 'dark' | 'system';
  initialOauthToken?: string;
  initialApiKey?: string;
  initialShowArchived?: boolean;
  initialPendingDeleteConv?: unknown;
  initialDeleteRelatedContent?: boolean;
  initialSidebarCollapsed?: boolean;
  openSchedulerModal?: boolean;
  initialInfoModalUseCase?: string;
  initialMessages?: unknown[];
  initialError?: string;
  initialPrompt?: string;
  initialPastedImages?: string[];
  initialBusyStatus?: string | null;
  initialLiveActivitySteps?: unknown[];
  initialPendingPerm?: { operation: string; httpMethod: string; path: string };
  oauthFocusReturnDelayMs?: number;
  setTileHostData?: React.Dispatch<React.SetStateAction<ExtensionContextData['tileHostData']>>;
}

declare global {
  interface Window {
    __MOCK_LOOKER_EXTENSION__?: MockLookerExtensionContextValue;
    __LOOKER_EMBED_STATE__?: unknown;
    __DAB_STUDIO__?: unknown;
  }
}

export const LookerExtensionContext = createContext<LookerExtensionContextState | undefined>(undefined);

export const MockLookerExtensionProvider: React.FC<{
  value: MockLookerExtensionContextValue;
  children: ReactNode;
}> = ({ value, children }) => {
  const [tileHostData, setTileHostData] = React.useState(value.tileHostData);
  React.useEffect(() => {
    setTileHostData(value.tileHostData);
  }, [value.tileHostData]);
  if (typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__ === value) {
    value.setTileHostData = setTileHostData;
  }
  return (
    <LookerExtensionContext.Provider value={{ ...value, tileHostData }}>
      {children}
    </LookerExtensionContext.Provider>
  );
};

export const LookerExtensionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const extensionContext = useContext(ExtensionContext) as ExtensionContextData;
  const mockOverride =
    typeof window !== 'undefined' ? window.__MOCK_LOOKER_EXTENSION__ : undefined;
  if (mockOverride) {
    return (
      <LookerExtensionContext.Provider value={mockOverride}>
        {children}
      </LookerExtensionContext.Provider>
    );
  }

  const contextValue: LookerExtensionContextState = {
    extensionSDK: extensionContext.extensionSDK,
    core40SDK: extensionContext.core40SDK,
    tileHostData: extensionContext.tileHostData,
    tileSDK: extensionContext.tileSDK,
    lookerHostData:
      extensionContext.lookerHostData || extensionContext.extensionSDK?.lookerHostData,
  };

  return (
    <LookerExtensionContext.Provider value={contextValue}>
      {children}
    </LookerExtensionContext.Provider>
  );
};

export const useLookerExtension = (): LookerExtensionContextState => {
  const context = useContext(LookerExtensionContext);
  if (context === undefined) {
    throw new Error('useLookerExtension must be used within a LookerExtensionProvider');
  }
  return context;
};
