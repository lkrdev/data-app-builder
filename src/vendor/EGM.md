# Vendored Code Mode Runtime (`src/vendor`)

## Overview
Contains the self-contained Looker Code Mode WASM runtime (`codemode.js`), embedding a gzip-compressed Monty Python WebAssembly sandbox and a `@looker/chatty` Looker Extension Host bridge for executing Python Looker SDK scripts in browser and Node.js environments.

## Interface
- `[codemode.js:LkrCodeMode]` / `[codemode.js:lkrCodeMode]` — Non-callable plain object exported on `root.LkrCodeMode`, `root.lkrCodeMode`, and CommonJS `module.exports`, copying `wasm_bindgen` exports (`connectHost`, `dir`, `examples`, `help`, `lookup`, `lookupType`, `readme`, `runPythonCodeRaw`, `search`, `searchWithLookups`, `setHostData`, `initSync`, overriding `getHostData`) plus JS wrappers:
  - `[codemode.js:init]` — `() => Promise<LkrCodeMode>` asynchronously initializes WASM.
  - `[codemode.js:getCodeModeRuntime]` — `() => LkrCodeMode` returns the runtime singleton.
  - `[codemode.js:getToolDefinition]` / `[codemode.js:RUN_LOOKER_CODEMODE_TOOL]` — Returns function tool schema (`properties: { code }`, `required: ['code']`) defaulting to `'run_looker_codemode'`.
  - `[codemode.js:connect]` — `(options) => Promise<any>` initializes WASM, syncs host data, and returns `getHostData()` (when extension SDK resolved) or `connectHost()`.
  - `[codemode.js:setExtensionSDK]` — `(sdk) => Promise<void>` stores `sdk` on `root.__LKR_EXTENSION_SDK__` and syncs host data once initialized.
  - `[codemode.js:getHostData]` — `() => any` syncs host data from `resolveExtSdk(null)` and returns `wasm_bindgen.getHostData()`.
  - `[codemode.js:runPythonCode]` / `[codemode.js:run_python_code]` / `[codemode.js:executeLookerCodeMode]` — `(codeOrParams, optionsOrSdk) => Promise<any>` aliases of `runCode` (supporting 2-arg `(code, sdkWithInvokeCoreSdkRawOrInvokeCoreSdk)`) executing Python in the Monty WASM sandbox.

## Invariants
- `[codemode.js:initAsync]` Singleton WASM initialization: `__wbg_init` and `initSync` return early if `wasm !== undefined`, and `initAsync` caches a single `initPromise`.
- `[codemode.js:decodeGzipBytes]` In Node.js, decompresses and instantiates the embedded gzipped WASM synchronously via `zlib.gunzipSync` + `wasm_bindgen.initSync`; in non-Node environments, requires global `DecompressionStream('gzip')` or `initAsync` rejects.
- `[codemode.js:resolveExtSdk]` Resolves the extension host in order: `opts` (if `invokeCoreSdkRaw` or `invokeCoreSdk` is a function) -> `opts.extensionSDK` / `opts.extensionSdk` -> `core.authSession.transport.extensionHost` / `core.authSession.transport.hostConnection.hostConnection` -> `root.__LKR_EXTENSION_SDK__` -> `root.extensionSDK` -> `root.lookerExtensionSDK` -> `null`.
- `[codemode.js:normalizeRunArgs]` HTTP request handler precedence: `opts.requestHandler` -> `extSdk.invokeCoreSdkRaw(..., '4.0')` -> `extSdk.invokeCoreSdk(..., '4.0')` -> `core.authSession.transport.rawRequest(...)` -> `undefined`; studio-specific `classifyOperation`, `requirePermission` Safe Mode gating, and `to_fixed_date_range` / `INVESTIGATION_ANCHOR_DATE` preambles live in `src/lkrCliBridge.ts` so `src/vendor/codemode.js` stays byte-identical to `https://cdn.lkr.dev/cli/codemode/0.0.67/codemode.js`.
- `[codemode.js:syncHost]` `runCode`, `connect`, `setExtensionSDK`, and `LkrCodeMode.getHostData` call `syncHost` (`wb.setHostData`) prior to WASM host-dependent calls.

## Side Effects
- `[codemode.js:root]` Assigns `root.LkrCodeMode`, `root.lkrCodeMode`, and `root.__LKR_EXTENSION_SDK__` (in `setExtensionSDK`), and sets `module.exports = LkrCodeMode` in CommonJS environments.
- `[codemode.js:initAsync]` In Node.js, IIFE evaluation synchronously decompresses the inline base64-encoded gzip literal (`decodeGzipBytes()`) via `zlib.gunzipSync` + `initSync`; `initAsync()` performs browser async decompression via `Blob` + `DecompressionStream('gzip')` + `WebAssembly.instantiate`.
- `[codemode.js:module]` Uses `MessageChannel`, `MessagePort.postMessage`, `crypto.getRandomValues`, `performance.now()`, `Date`, `fetch`, `queueMicrotask`, `FinalizationRegistry` (`CLOSURE_DTORS`), `document.currentScript.src` (inner `wasm_bindgen` IIFE), and `console.warn` (`__wbg_load`/`initSync`/`__wbg_init`).
- `[codemode.js:normalizeRunArgs]` Dispatches Looker 4.0 HTTP API calls through the resolved `handler`.

## Verification
- Run: `npm test && npm run lint:check`
