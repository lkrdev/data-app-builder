// LOOKER SDK: All Looker SDK initialization happens here

import React, { createContext, useContext, ReactNode } from 'react';
import { ExtensionContext, ExtensionContextData } from '@looker/extension-sdk-react';
import type { Looker40SDK } from '@looker/sdk';

interface LookerExtensionContextState {
  extensionSDK: ExtensionContextData['extensionSDK'];
  core40SDK: Looker40SDK;
}

const LookerExtensionContext = createContext<LookerExtensionContextState | undefined>(undefined);

export const LookerExtensionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const extensionContext = useContext(ExtensionContext) as ExtensionContextData;

  const contextValue: LookerExtensionContextState = {
    extensionSDK: extensionContext.extensionSDK,
    core40SDK: extensionContext.core40SDK,
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
