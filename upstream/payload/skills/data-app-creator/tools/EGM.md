# data-app-creator Tools

## Overview
Python CLI utilities supporting Data App creation, credential verification, LookML Explore schema discovery, palette extraction, tile sandbox safety linting, recipe retrieval, JSDoc timestamp generation, and end-to-end 4-stage app verification.

## Interface
- `[check-credentials.py:load_config, check_port_open, verify_credentials, main]`: Validates Looker API 4.0 credentials (`--config`, `--json`) via `/api/4.0/login` and `/api/4.0/lookml_models`, with env var overrides (`LOOKERSDK_*`/`LOOKER_*`).
- `[check-tile-safety.py:strip_comments, RULES, IMPORT_RE, ID_RE, check, main]`: Static analyzer enforcing Looker tile sandbox rules (`inline-handler`, `dialog`, `storage`, `window-open`, `relative-asset`, `duplicate-connect`, `outer-dom-mutation`, `second-module`, `duplicate-id`).
- `[explore-model.py:VALUES_LIMIT, load_config, login, api_call, render_dense_schema, render_catalog_entry, main]`: Inspects LookML models/explores (`--list-models`, `--full`, `--json`, `--probe`, `--fields`, `--all-fields`, `--values`, `--sample`) and generates dense Markdown field schemas.
- `[extract-palette.py:to_hex, saturation, lightness, hue, is_warm, darken, extract, assign_roles, build_variables, main]`: Quantizes an input image (`--out`) via Pillow into 8 semantic palette roles and `--app-*` CSS custom properties.
- `[get-recipe.py:find_recipes_dir, main]`: Lists (`--list` / `-l`) or prints recipe Markdown files from `../recipes` or `skills/data-app-creator/recipes`.
- `[get-timestamp.py:get_timestamps, main]`: Emits current local/UTC timestamps or JSDoc headers (`--header`, `--json`, `--title`, `--description`).
- `[verify-app.py:check_syntax, check_tile_safety, check_widget_extraction, check_composition, load_looker_credentials, get_auth_token, extract_queries_from_code, dry_run_query, check_port_open, find_system_browser, parse_content_height, parse_sandbox_state, run_headless_browser, verify_app, main]`: Orchestrates 4-stage app verification (`app`, `--no-browser`, `--port`, `--json`): Node syntax check, tile safety + widget extraction, live 1-row Looker query dry-runs, and headless Chromium DOM/screenshot inspection.

## Invariants
- `[check-credentials.py:load_config]`, `[explore-model.py:load_config]`, `[verify-app.py:load_looker_credentials]`: Ancestor search for `data-apps-config.json` stops at `.git`; `LOOKERSDK_*`/`LOOKER_*` env vars override file credentials; `LOOKER_CA_BUNDLE` applies `DEFAULT@SECLEVEL=1` only to the dedicated `_LOOKER_SSL_CTX`.
- `[check-tile-safety.py:strip_comments]`: Masks `//` and `/* */` comments with spaces while preserving line numbers and tracking string/template-literal interpolation scopes.
- `[explore-model.py:main]`: Filters hidden explores and hidden fields; `--probe` refuses > `PROBE_LIMIT` (25) fields without `--fields` or `--all-fields`; `--sample` never mixes fields from multiple views in one query; `--values` caps at `VALUES_LIMIT` (50).
- `[extract-palette.py:Image]`: Requires Pillow (`PIL.Image`), exiting with status 1 at import time if missing; `frame` and `card` roles are fixed to `#ffffff`.
- `[get-recipe.py:main]`: Excludes `readme.md` (case-insensitive) and prioritizes exact stem matches over substring matches.
- `[verify-app.py:verify_app]`: Fail-fast gating stops before Stage 3 on syntax/safety failures and before Stage 4 on query failures; `results['passed']` requires syntax, zero safety findings, zero query failures, and Stage 4 browser pass (or skip/`--no-browser`), while composition/widget warnings and 0-row dry-runs do not fail `passed`.

## Side Effects
- `[check-credentials.py:verify_credentials]`, `[explore-model.py:api_call]`, `[verify-app.py:dry_run_query]`: Issue outbound HTTPS requests to Looker `/api/4.0/login`, `/api/4.0/lookml_models`, and `/api/4.0/queries/run/json`; `explore-model.py` installs a process-wide default HTTPS opener on import and runs `ThreadPoolExecutor` pools.
- `[verify-app.py:check_syntax]`, `[verify-app.py:run_headless_browser]`: Spawns `node --input-type=module --check -` and headless Chromium subprocesses, and writes `preview.png` / `preview-sandbox.png` alongside the target app.
- `[verify-app.py:_load_tile_safety]`, `[verify-app.py:_load_widget_extractor]`: Dynamically loads sibling `check-tile-safety.py` and `../../data-app-publisher/tools/widget_extractor.py` into `sys.modules`.
- `[extract-palette.py:main]`, `[get-recipe.py:main]`, `[check-tile-safety.py:check]`: Read target image/recipe/JS files from disk; `extract-palette.py --out` writes JSON to disk; all CLI tools reconfigure `sys.stdout`/`sys.stderr` to UTF-8.

## Verification
- Run: `npm test`
