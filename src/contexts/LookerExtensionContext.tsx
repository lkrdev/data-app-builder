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

export const LookerExtensionContext = createContext<LookerExtensionContextState | undefined>(undefined);

export const MockLookerExtensionProvider: React.FC<{
  value: LookerExtensionContextState;
  children: ReactNode;
}> = ({ value, children }) => (
  <LookerExtensionContext.Provider value={value}>
    {children}
  </LookerExtensionContext.Provider>
);

export const LookerExtensionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const extensionContext = useContext(ExtensionContext) as ExtensionContextData;
  const mockOverride =
    typeof window !== 'undefined' ? (window as any).__MOCK_LOOKER_EXTENSION__ : undefined;
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
