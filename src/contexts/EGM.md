# Looker Extension Context (`src/contexts`)

## Overview
Provides the React context and provider components bridging Looker's `@looker/extension-sdk-react` `ExtensionContext` (and test-time `window.__MOCK_LOOKER_EXTENSION__` overrides) into the studio application with SDK request deduplication.

## Interface
- `[LookerExtensionContext.tsx:LookerExtensionContextState]` — Interface defining the extension context shape (`extensionSDK`, `core40SDK`, `tileHostData?`, `tileSDK?`, `lookerHostData?`).
- `[LookerExtensionContext.tsx:MockLookerExtensionContextValue]` — Interface extending `LookerExtensionContextState` with optional mock/test configuration fields and `setTileHostData` dispatcher.
- `[LookerExtensionContext.tsx:Window]` — Global `Window` interface augmentation declaring optional `__MOCK_LOOKER_EXTENSION__`, `__LOOKER_EMBED_STATE__`, `__DAB_STUDIO__`, `__LAST_COPIED_THINKING_TRACE__`, and `lkr_codemode_api_calls` (`LkrCodeModeApiCallEntry[]`) fields.
- `[LookerExtensionContext.tsx:LookerExtensionContext]` — React context (`Context<LookerExtensionContextState | undefined>`, defaulting to `undefined`).
- `[LookerExtensionContext.tsx:MockLookerExtensionProvider]` — `React.FC<{ value: MockLookerExtensionContextValue; children: ReactNode }>` provider component for mock/test extension state.
- `[LookerExtensionContext.tsx:LookerExtensionProvider]` — `React.FC<{ children: ReactNode }>` provider component wrapping `@looker/extension-sdk-react` `ExtensionContext`.
- `[LookerExtensionContext.tsx:useLookerExtension]` — Hook returning `LookerExtensionContextState`.

## Invariants
- `[LookerExtensionContext.tsx:useLookerExtension]` Throws `Error('useLookerExtension must be used within a LookerExtensionProvider')` if `LookerExtensionContext` is `undefined`.
- `[LookerExtensionContext.tsx:LookerExtensionProvider]` When `typeof window !== 'undefined'` and `window.__MOCK_LOOKER_EXTENSION__` is truthy, provides that mock override directly instead of `ExtensionContext` values.
- `[LookerExtensionContext.tsx:LookerExtensionProvider]` Hooks `extensionContext?.extensionSDK` (and `mockOverride.extensionSDK` when present) via idempotent `hookChattyHostApiLogger`, and wraps `extensionContext.core40SDK` with `createDeduplicatedLookerSdkProxy` (memoized on `extensionContext?.core40SDK`) whenever `extensionContext?.core40SDK` is truthy.
- `[LookerExtensionContext.tsx:LookerExtensionProvider]` Resolves `lookerHostData` as `extensionContext.lookerHostData || extensionContext.extensionSDK?.lookerHostData`.

## Side Effects
- `[LookerExtensionContext.tsx:LookerExtensionProvider]` & `[LookerExtensionContext.tsx:MockLookerExtensionProvider]` Wrap `extensionSDK.chattyHost.sendAndReceive` idempotently via `hookChattyHostApiLogger` to record session Looker API calls in `window.lkr_codemode_api_calls`.
- `[LookerExtensionContext.tsx:MockLookerExtensionProvider]` Assigns `value.setTileHostData = setTileHostData` on the `value` prop object during render when `typeof window !== 'undefined' && window.__MOCK_LOOKER_EXTENSION__ === value`.
- `[LookerExtensionContext.tsx:MockLookerExtensionProvider]` Registers a `React.useEffect` on `value.tileHostData` changes to invoke `setTileHostData(value.tileHostData)`.

## Verification
- Run: `npm test && npm run lint:check`
