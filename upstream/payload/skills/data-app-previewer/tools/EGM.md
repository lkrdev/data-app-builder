# data-app-previewer Tools

## Overview
Python CLI lifecycle helpers for starting, probing, and cleanly stopping the local `preview-server/serve.py` daemon and opening a Data App preview URL in the browser.

## Interface
- `[start-preview.py:DEFAULT_PORT, LANDING_PAGE, find_root, resolve_app_arg, probe, read_pid, alive, stop_pid, main]`: CLI (`[app]`, `--stop`, `--no-open`, `--port`) that validates port/app paths, replaces any prior server on the port, launches `preview-server/serve.py` detached, polls `/api/apps`, and opens the browser.
- `[stop-preview.py:DEFAULT_PORT, PROC_PATH, find_root, alive, probe, stop_server, main]`: CLI (`--port`) that locates and terminates `serve.py` processes via `.preview-pid`, HTTP `/api/apps` probe, and `/proc` cmdline/cwd inspection, then cleans up marker files.

## Invariants
- `[start-preview.py:main]`: Rejects ports outside `1 <= port <= 65535`; requires `preview-server/serve.py` (or `dist/preview-server/serve.py`) under `root`; exits if an existing server on the port cannot be stopped or if `/api/apps` fails to return HTTP 200 JSON within 20 polls (0.25s apart).
- `[start-preview.py:resolve_app_arg]`: Positional `app` argument must resolve to an existing file under `root`, `<app>/app.js`, `apps/<app>/app.js`, or `examples/<app>/app.js`.
- `[stop-preview.py:stop_server]`: Scoped to workspace roots (`resolved_roots`); skips PID/port files or `/proc` `serve.py` processes belonging to other workspaces or non-matching `--port` values; `main()` always returns `0`.

## Side Effects
- `[start-preview.py:main]`: Appends to `root/.preview-server.log`, spawns detached `serve.py` via `subprocess.Popen(..., start_new_session=True)`, writes `root/.preview-pid` and `root/.preview-port`, and calls `webbrowser.open(url)` unless `--no-open` is passed.
- `[stop-preview.py:stop_server]`: Reads `/proc/<pid>/cmdline` and `/proc/<pid>/cwd`, queries `http://localhost:<port>/api/apps`, sends `SIGTERM`/`SIGKILL` via `os.kill`, and unlinks `.preview-pid` and `.preview-port`.

## Verification
- Run: `npm test`
