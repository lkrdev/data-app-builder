# scripts

## Overview
Installation bootstrap, legacy config migration/reconciliation, and Looker inline-extension publish verification scripts for Data App environments.

## Interface
- `[bootstrap.sh:resolve_python, short_path, ask_yn, show_config, print_banner, prompt_config, NO_COLOR, DATA_APPS_PYTHON, PYTHON, DATA_APPS_TOOLKIT_URL, DATA_APPS_SHARED_BASE, DATA_APPS_BROWSER_ASSETS_URL, DATA_APPS_RUNTIME_URL, CANVAS_RUNTIME_URL, DATA_APPS_BANNER_SHOWN, DATA_APPS_SKIP_VERIFY]`: Interactive/non-interactive post-install setup script that resolves Python 3.9+, merges configs, prompts for Looker credentials if needed, links `.claude/skills/*`, and runs `verify-install.py`.
- `[configs-merger.sh:resolve_python, DATA_APPS_TOOLKIT_URL, DATA_APPS_SHARED_BASE, DATA_APPS_BROWSER_ASSETS_URL, DATA_APPS_RUNTIME_URL, DATA_APPS_PREVIOUS_VERSION, DATA_APPS_PYTHON, PYTHON]`: Bash/Python utility merging `looker-config.json`, `skills/data-app-creator/config.json`, and `data-apps-config.json` into consolidated `data-apps-config.json`.
- `[verify-install.py:--config, main, resolve_config, login, call, fetch_bundle, _base_ssl_context, _looker_ssl_context, _is_role_denied_404, _explain_unavailable, LOOKER_NOT_FOUND_MSG, SINATRA_NOT_FOUND_MARKER, LOOKER_ROLE_ERR_DOC_PATH, LOOKER_CA_BUNDLE, LOOKERSDK_*, LOOKER_*]`: 4-step Looker API 4.0 verification probe testing login, `/data_app_extension` read/create, `/inline_extension/{id}/bundle.js` byte parity, and cleanup deletion.

## Invariants
- `[bootstrap.sh:set -euo pipefail]` & `[configs-merger.sh:set -euo pipefail]`: Both shell scripts enforce strict mode and require Python >= 3.9 via `resolve_python`.
- `[bootstrap.sh:prompt_config]` & `[configs-merger.sh:tmp_path]`: `data-apps-config.json` is written atomically via `.tmp` + `os.replace` and restricted to mode `0o600`; `prompt_config` enforces `http`/`https` Looker URLs; `CANVAS_RUNTIME_URL` overrides `browser_assets_url`.
- `[configs-merger.sh:merged]` & `[configs-merger.sh:RETIRED]`: Merge precedence is `looker-config.json < skills/data-app-creator/config.json < data-apps-config.json`; drops retired keys (`shared_assets_url`, `use_proxy`, `proxy_port`), migrates `shared_base_url`/`shared_runtime_url`, reconciles versioned URLs, and exits `1` without deleting legacy files if merging yields an empty dict.
- `[verify-install.py:resolve_config]` & `[verify-install.py:_looker_ssl_context]`: `LOOKERSDK_*`/`LOOKER_*` env vars override file config; TLS verification remains enabled (`LOOKER_CA_BUNDLE` adds trust anchor with `DEFAULT@SECLEVEL=1` on `_LOOKER_SSL_CTX`); `_is_role_denied_404` distinguishes Looker role-denied 404s from `sinatra::notfound` missing routes; probe requires byte-identical served `bundle.js`.

## Side Effects
- `[bootstrap.sh]`: Exports `DATA_APPS_PYTHON`, invokes `configs-merger.sh`, reads stdin to write `$REPO_ROOT/data-apps-config.json` (`0o600`), recreates `$REPO_ROOT/.claude/skills/*` relative symlinks, and executes `verify-install.py` unless `DATA_APPS_SKIP_VERIFY` is truthy (`verify-install.py` failure prints guidance without failing `bootstrap.sh`).
- `[configs-merger.sh]`: Atomically rewrites `data-apps-config.json` (`0o600`) and deletes legacy `looker-config.json` and `skills/data-app-creator/config.json` after successful consolidation.
- `[verify-install.py:main]`: Sends outbound HTTPS requests to `/api/4.0/login`, `GET /data_app_extension?limit=1`, `POST /data_app_extension` (`data-app-verify-<12hex>`), `GET /inline_extension/{id}/bundle.js`, and `DELETE /data_app_extension/{id}` in a `finally` block.

## Verification
- Run: `npm test`
