# preview-server

## Overview
Local HTTP preview server and LitElement host shell (`<preview-host>`) providing the Data App gallery, sandboxed `srcdoc` iframe execution with CSP + `postMessage` query proxying, same-origin `inspect=1` verification mode, and Looker API 4.0 `/api/query` proxying.

## Interface
- `[serve.py:ROOT, CONFIG_PATH, ROOT_RESOLVED, PORT, DEFAULT_HOST, BIND_HOST, BIND_PORT, LOOPBACK_HOSTNAMES, EXTRA_ALLOWED_HOSTS, MAX_BODY, LOOKER_NOT_FOUND_MSG, SINATRA_NOT_FOUND_MARKER, LOOKER_ROLE_ERR_DOC_PATH, get_config, get_base_url, host_is_ours, check_same_origin, login, run_inline_query, Handler, main]`: Stdlib `ThreadingHTTPServer` CLI (`--host`, `--port`, `app`) serving static workspace files, `/api/apps`, and `/api/query` proxy endpoints.
- `[index.html:<preview-host>, window.DataApps.queryRunner]`: Entry HTML page loading vendored AG Grid/Highcharts assets, defining the same-origin `window.DataApps.queryRunner`, and mounting `<preview-host>`.
- `[preview-host.js:FEEDBACK_FORM_URL, GALLERY_VIEW_STORAGE_KEY, PreviewHost]`: Exported `LitElement` registered as `<preview-host>` (`setViewMode`, `teardownSandboxBridge`, `dismissError`, `writeDiagnosticsNode`, `addSandboxError`, `applyViewport`, `loadAppsData`, `handleRoute`, `mountApp`, `render`).
- `[favicon.svg]`: Static SVG favicon asset for the preview server UI.

## Invariants
- `[serve.py:check_same_origin]` & `[serve.py:Handler._guard]`: `/api/*` endpoints reject requests failing `host_is_ours(Host)` (accepting `BIND_PORT`, `PORT`, `8765`, `8766`, `BIND_PORT + 1..10`, and `PREVIEW_ALLOWED_PORTS`) or same-origin `Origin`/`Sec-Fetch-Site` checks with 403; `POST /api/query` additionally requires `X-Looker-Preview-Client: 1` and caps bodies at `MAX_BODY` (5 MiB).
- `[serve.py:Handler.translate_path]`, `[serve.py:_detect_fan_out_risk]`, `[serve.py:_error_envelope]`: Static paths outside `ROOT_RESOLVED` are rejected; queries mixing multiple `<base>__<sub>` sub-views on one `<base>` fail with HTTP 400 `fan_out_risk`; error envelopes omit raw query payloads.
- `[serve.py:login]`: Reuses cached `_token` only while `now < expires_at - 60`; TLS verification remains enabled on `_SSL_CTX`.
- `[preview-host.js:PreviewHost.mountApp]`: Sandboxed `#canvas-sandbox-frame` uses `sandbox="allow-scripts"` and a per-mount nonce CSP (`connect-src 'none'`); message bridges strictly verify `e.source`; `inspect=1`/`true` mode requires `CustomClass.prototype instanceof HTMLElement`; stale mounts abort on `_mountId` mismatch.

## Side Effects
- `[serve.py:main]`: Binds `ThreadingHTTPServer`, reclaims same-root preview servers on `EADDRINUSE` via `SIGTERM`/`SIGKILL`, writes/unlinks `.preview-port` and `.preview-pid` in `ROOT`, and sends outbound HTTPS requests to `{base_url}/api/4.0/login` and `/queries/run/json`.
- `[index.html]` & `[preview-host.js]`: Mutates `window.DataApps.queryRunner`, `window.__lookerDataAppMeta`, `localStorage` (`dataAppsGalleryView`), `document.head` (`#preview-host-styles`), `document.body` (`#preview-diagnostics`, `dark-theme`), registers `<preview-host>`, attaches `ResizeObserver`/`MutationObserver`/window listeners, and issues `fetch('/api/apps')` and `POST /api/query`.

## Verification
- Run: `npm test`
