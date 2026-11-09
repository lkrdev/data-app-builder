# looker-extension-sdk Node Browser Shims (24.20.0/node)

## Overview
Vendored `unenv` browser-compatible Node.js module shims imported by `../extension-sdk.mjs` (`@looker/extension-sdk@24.20.0`) so the Extension SDK runs in browser ES module contexts without a Node.js runtime.

## Interface
- `[async_hooks.mjs:AsyncLocalStorage, AsyncResource, asyncWrapProviders, createHook, executionAsyncId, executionAsyncResource, triggerAsyncId, default]`: Browser stub implementations for `node:async_hooks`.
- `[buffer.mjs:Blob, Buffer, File, INSPECT_MAX_BYTES, SlowBuffer, atob, btoa, constants, isAscii, isUtf8, kMaxLength, kStringMaxLength, resolveObjectURL, transcode, default]`: Browser `Buffer` and base64/UTF-8 helpers.
- `[events.mjs:EventEmitter, EventEmitterAsyncResource, addAbortListener, captureRejectionSymbol, captureRejections, defaultMaxListeners, errorMonitor, getEventListeners, getMaxListeners, init, listenerCount, on, once, setMaxListeners, usingDomains, default]`: Browser `EventEmitter` implementation importing `AsyncResource` from `./async_hooks.mjs`.
- `[process.mjs:default, env, hrtime, nextTick, stdin, stdout, stderr, version, versions, abort, cwd, emit, on, off, once, ...]`: Browser `process` shim extending `EventEmitter` from `./events.mjs` with `ReadStream`/`WriteStream` from `./tty.mjs` (`version = "22.14.0"`).
- `[tty.mjs:ReadStream, WriteStream, isatty, default]`: Minimal TTY stream stubs where `isatty()` always returns `false` and `WriteStream.write()` logs decoded text to `console.log`.

## Invariants
- `[process.mjs:r]` / `[events.mjs:te]` / `[buffer.mjs:ut]`: Unimplemented Node.js APIs throw `Error('[unenv] <name> is not implemented yet!')` when invoked.
- `[tty.mjs:isatty]`: Always returns `false`; `ReadStream.isTTY` and `WriteStream.isTTY` are fixed to `false`.

## Side Effects
- `[tty.mjs:WriteStream.write]`: Writes decoded output strings to `console.log`.

## Verification
- Run: `npm test`
