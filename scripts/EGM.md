# Scripts (`scripts/`)

## Overview

The `scripts/` package provides verification, evaluation, benchmarking, and vendor synchronization utilities for Looker Data App Studio. These Node.js ESM (`.mjs`) and Bash (`.sh`) entrypoints validate bundle packaging, Monty WASM `LkrCodeMode` execution, multi-turn Data App and Content Studio benchmarks, end-to-end LookML project onboarding evals, and upstream/CLI asset synchronization without modifying application runtime code.

## Interface

No child subdirectories exist under `scripts/`. Every file below is a standalone CLI script or verification harness:

- **`scripts/test-bundle.mjs`** — End-to-end offline verification suite (`node scripts/test-bundle.mjs`, invoked by `npm test`):
  - No CLI flags or exports; imports `LkrCodeMode` from `src/vendor/codemode.js` (`[test-bundle.mjs:LkrCodeMode]`).
  - Exercises `BUNDLE_APP_PY` (`[test-bundle.mjs:bundlePyPath]`), `BOOTSTRAP_LOOKML_PY` (`[test-bundle.mjs:bootstrapPyPath]`), `THREE_PILLAR_CODEMODE_PY` (`[test-bundle.mjs:hcPyMatch]`), `LkrCodeMode.runPythonCode` (`[test-bundle.mjs:cmOut]`), and `scripts/bench-concurrent-convs.mjs --iter=1` (`[test-bundle.mjs:iter1Report]`).
  - Passes subprocess env vars `TOOLKIT_DIR` (`upstream/payload`) (`[test-bundle.mjs:TOOLKIT_DIR]`), `WORKSPACE_DIR`, `LOOKML_DIR`, `LOOKML_BASELINE_DIR` (`[test-bundle.mjs:WORKSPACE_DIR]`), and `PATH` (`${fakeBinDir}:/usr/bin:/bin`) (`[test-bundle.mjs:fakeBinDir]`).
- **`scripts/run-evals.mjs`** — 10-case studio evaluation suite (`node scripts/run-evals.mjs` / `npm run eval`):
  - CLI flags: `--offline` (default) and `--live` (`[run-evals.mjs:isLive]`), `--eval=<id|number>` (`[run-evals.mjs:evalFilter]`).
  - Helpers & constants: `extractTsTemplateConstant` (`[run-evals.mjs:extractTsTemplateConstant]`), `extractJoinedPyPreamble` (`[run-evals.mjs:extractJoinedPyPreamble]`), `SEARCH_AGENTS_PREAMBLE_PY`, `FORMAT_CONTENT_INVENTORY_PREAMBLE_PY`, `DATE_HELPER_PREAMBLE_PY` (`[run-evals.mjs:SEARCH_AGENTS_PREAMBLE_PY]`), `EVAL_SUITE` (`[run-evals.mjs:EVAL_SUITE]`), `main` (`[run-evals.mjs:main]`).
  - Eval functions (`eval-01`..`eval-10`): `eval01ContentFolderInventory`, `eval02CaVsCodemodeRouting`, `eval03MultiTurnDataApp`, `eval04MultiTurnContentStudio`, `eval05ConcurrentSharedEnv`, `eval06DataInvestigatorKda`, `eval07AgenticLookmlOnboarding`, `eval08ThreePillarHealthCheck`, `eval09ConversationalAnalyticsRouter`, `eval10RbacSafemodeNoopGuardrails` (`[run-evals.mjs:EVAL_SUITE]`).
  - Passes `WORKSPACE_DIR` and `LOOKML_BASELINE_DIR` to `bootstrap_lookml.py bundle` (`[run-evals.mjs:eval07AgenticLookmlOnboarding]`).
- **`scripts/eval-new-project.mjs`** — Live 6-turn Looker project onboarding evaluator (`node scripts/eval-new-project.mjs`):
  - CLI flags: `--keep` (`[eval-new-project.mjs:--keep]`), `--out` (defaults to `tmp/evals/new-project-latest.json`) (`[eval-new-project.mjs:--out]`).
  - Env vars: `GEMINI_API_KEY` (with fallback to `AGENTIC_THELOOK_ENV` / `~/bwebs/agentic-thelook/.env`) (`[eval-new-project.mjs:getApiKey]`).
  - Symbols: `getApiKey` (`[eval-new-project.mjs:getApiKey]`), `getArgolisAuth` (`[eval-new-project.mjs:getArgolisAuth]`), `createLiveLookerSdk` (`[eval-new-project.mjs:createLiveLookerSdk]`), `persistedLookmlFiles` (`[eval-new-project.mjs:persistedLookmlFiles]`), `extractUddId` (`[eval-new-project.mjs:extractUddId]`), `validateBundleOfflineWithLkrParse` (`[eval-new-project.mjs:validateBundleOfflineWithLkrParse]`), `main` (`[eval-new-project.mjs:main]`).
- **`scripts/bench-data-app.mjs`** — 10-iteration Data App (`T1..T4`) benchmark:
  - CLI flag: `--live` (`[bench-data-app.mjs:--live]`, uses `LKR_CLI_DIR || ~/lkrdev/cli`).
  - Symbols: `BENCH_PROMPTS` (`[bench-data-app.mjs:BENCH_PROMPTS]`), `T1_APP_JS`..`T4_APP_JS` (`[bench-data-app.mjs:T1_APP_JS]`), `TURN_APPS` (`[bench-data-app.mjs:TURN_APPS]`), `canonicalQueryJson` (`[bench-data-app.mjs:canonicalQueryJson]`), `runRealBundleApp` (`[bench-data-app.mjs:runRealBundleApp]`), `runLiveDevArgolisVerification` (`[bench-data-app.mjs:runLiveDevArgolisVerification]`), `FLAG_ORDER` (`[bench-data-app.mjs:FLAG_ORDER]`), `ITERATION_NAMES` (`[bench-data-app.mjs:ITERATION_NAMES]`), `ITERATION_CONFIGS` (`[bench-data-app.mjs:ITERATION_CONFIGS]`).
- **`scripts/bench-dashboard.mjs`** — 10-iteration Content Studio (`T1..T4`) & model shootout benchmark:
  - CLI flag: `--live` (`[bench-dashboard.mjs:--live]`, uses `LKR_CLI_DIR || ~/lkrdev/cli`).
  - Symbols: `OUT_DIR` (`[bench-dashboard.mjs:OUT_DIR]`), `PREAMBLE_PY` (`[bench-dashboard.mjs:PREAMBLE_PY]`), `verifyMontyWasmMacros` (`[bench-dashboard.mjs:verifyMontyWasmMacros]`), `runLiveDevArgolisPrototype` (`[bench-dashboard.mjs:runLiveDevArgolisPrototype]`), `ITERATIONS` (`[bench-dashboard.mjs:ITERATIONS]`), `MODEL_SHOOTOUT` (`[bench-dashboard.mjs:MODEL_SHOOTOUT]`), `summarizeIteration` (`[bench-dashboard.mjs:summarizeIteration]`), `main` (`[bench-dashboard.mjs:main]`).
- **`scripts/bench-concurrent-convs.mjs`** — 10-iteration concurrent 2-conversation (`Conv A` Data App + `Conv B` Content Studio) benchmark:
  - CLI flags: `--iter=<N>` (`[bench-concurrent-convs.mjs:--iter=]`), `--all` (`[bench-concurrent-convs.mjs:--all]`, default when neither `--iter=` nor `--all` is passed), `--live` (`[bench-concurrent-convs.mjs:--live]`, uses `LKR_CLI_DIR || ~/lkrdev/cli`).
  - Symbols: `OUT_DIR`, `PREAMBLE_PY`, `runBundleAppStdinAsync`, `buildConvACode`, `CONV_A_TURNS`, `CONV_B_TURNS`, `tm`, `ITERATION_SPECS`, `evaluateTurnA`, `evaluateTurnB`, `buildTurnTelemetry`, `runConcurrentBenchmarkIteration`, `runLiveDevArgolisVerification`, `buildSummaryMarkdown`, `main` (`[bench-concurrent-convs.mjs:main]`).
- **`scripts/sync-codemode.sh`** — Copies or builds `codemode.js` into `src/vendor/codemode.js` (`npm run sync-codemode`):
  - Env var: `LKR_CLI_DIR` (defaults to `/usr/local/google/home/bryanweber/lkrdev/cli`) (`[sync-codemode.sh:CLI_DIR]`).
- **`scripts/sync-upstream.sh`** — Redownloads upstream Looker Data Apps installer & toolkit into `upstream/` (`npm run sync-upstream`):
  - Env var: `DATA_APPS_PREFIX_URL` (defaults to `https://dl.google.com/looker-data-apps`) (`[sync-upstream.sh:PREFIX_URL]`).
- **`scripts/clean-artifacts.sh`** — Purges all Looker Artifact namespaces owned by Data App Studio / Ripper (`data_app_builder`, `ripper`, `<project>::data_app_builder`, `<project>::ripper`) on a target Looker instance via `lkr --oauth-account=<account> code-mode sandbox` (`npm run clean:artifacts <oauth-account>`):
  - Positional CLI arg (required, exact count `1`, non-flag): `<oauth-account>` (`[clean-artifacts.sh:LKR]`); exits `1` when omitted or invalid.

## Invariants

- **Source Contract & Template Extraction**:
  - `test-bundle.mjs`, `run-evals.mjs`, `bench-data-app.mjs`, `bench-dashboard.mjs`, and `bench-concurrent-convs.mjs` extract Python preambles/templates (`BUNDLE_APP_PY`, `BOOTSTRAP_LOOKML_PY` from joined `src/lookmlTool.tsx` + `src/lkrCliBridge.ts`, `DATA_APP_GUIDE_MD`, `DASHBOARD_CODEMODE_PREAMBLE_PY`, `SEARCH_AGENTS_PREAMBLE_PY`, `FORMAT_CONTENT_INVENTORY_PREAMBLE_PY`, `DATE_HELPER_PREAMBLE_PY`, `THREE_PILLAR_CODEMODE_PY` from `src/healthCheck.ts`) directly from source and assert regex match (`[run-evals.mjs:extractTsTemplateConstant]`, `[bench-dashboard.mjs:PREAMBLE_PY]`, `[bench-data-app.mjs:bundlePyMatch]`).
  - `test-bundle.mjs` asserts `LKR_DEV_CLI_VERSION === '0.0.66'` matches `lkr-dev-cli-version.txt`, `src/lkrCliBridge.ts`, `AGENTS.md`, `upstream/payload/AGENTS.md`, and `CODEMODE_CDN_URL` (`https://cdn.lkr.dev/cli/codemode/0.0.66/codemode.js`); checks `.github/workflows/update-skills.yml` for its Mon/Thu cron, PyPI URL, and `chore/update-skills` branch; and validates `manifest.lkml` (`raw_api_request: yes`, zero `core_api_methods:`) (`[test-bundle.mjs:pinnedVersionTxt]`, `[test-bundle.mjs:manifestLkml]`).
  - `test-bundle.mjs` asserts `.eslintrc.json` enforces `"@typescript-eslint/no-explicit-any": "error"`, `.githooks/pre-commit` is executable and runs `lint:check`, `dist/bundle.js < 2 MiB` (when present), and `package.json` defines `"eval": "node scripts/run-evals.mjs"` (`[test-bundle.mjs:eslintrcJson]`, `[test-bundle.mjs:preCommitPath]`, `[test-bundle.mjs:pkgJson]`).
- **RBAC, Safe Mode & Content Routing Guardrails**:
  - Under `requirePermission: true`, read-only calls (`me()`, `run_inline_query`) execute with zero permission prompts, while mutating calls (`create_dashboard`) trigger `onPermissionRequest`, fail with `PermissionError` on deny, and cache `'allow_op'` once across loops (`[run-evals.mjs:eval10RbacSafemodeNoopGuardrails]`, `[test-bundle.mjs:loopOut]`).
  - `eval01ContentFolderInventory` enforces `truncated === false` for `3` items and `truncated === true` with `overflow_file_path === '/workspace/content_inventory.md'` and at most `2` links per folder for `10` items across `2` folders (`[run-evals.mjs:eval01ContentFolderInventory]`).
- **Concurrent Single-Environment & Turn Isolation**:
  - `bench-concurrent-convs.mjs` enforces `environmentsCreated === 1`, `sourceUpdate400Errors === 0` (rejecting any subsequent `environment.sources` POST with `'400 Updating sources for an existing environment is not supported'`), `previous_interaction_id` chaining per conversation, `8/8` `functional_score`, and `filesystem_isolation_ok === true` (`[bench-concurrent-convs.mjs:recordInteractionPost]`, `[bench-concurrent-convs.mjs:singleEnvInvariant]`, `[bench-concurrent-convs.mjs:filesystemIsolationOk]`).
- **Bundle & Eval Grading Invariants**:
  - `bench-data-app.mjs` asserts `6, 8, 8, 8` widgets for `T1..T4` and `3` HTTP calls in single-script Monty WASM discovery (`[bench-data-app.mjs:TURN_APPS]`, `[bench-data-app.mjs:LkrCodeMode]`).
  - `run-evals.mjs` requires every selected eval in `EVAL_SUITE` to pass all 4 dimensions (`routing`, `toolBudget`, `outputRubric`, `safety`) (`totalPoints === maxPoints`, else exit `1`) (`[run-evals.mjs:main]`).
  - `eval-new-project.mjs` requires `GEMINI_API_KEY` (`[eval-new-project.mjs:getApiKey]`), refreshes `dev-argolis` auth from `~/.lkr/auth.db` via `lkr --oauth-account=dev-argolis --dev auth whoami` at startup and again on HTTP `401` (`[eval-new-project.mjs:getArgolisAuth]`, `[eval-new-project.mjs:createLiveLookerSdk]`), verifies offline `lkr parse lookml-to-api --validate` plus live Looker checks, and sets `process.exitCode = 1` if any turn fails (`[eval-new-project.mjs:validateBundleOfflineWithLkrParse]`, `[eval-new-project.mjs:main]`).
- **Fail-Fast & Temp Cleanup Guarantees**:
  - `sync-codemode.sh` and `sync-upstream.sh` use `set -euo pipefail` (`[sync-codemode.sh:4]`, `[sync-upstream.sh:4]`).
  - All scripts creating `os.tmpdir()` scratch directories (`test-bundle.mjs`, `run-evals.mjs`, `eval-new-project.mjs`, `bench-data-app.mjs`, `bench-concurrent-convs.mjs`) remove them in `finally` blocks (`[test-bundle.mjs:workDir]`, `[bench-data-app.mjs:workDir]`, `[eval-new-project.mjs:validateBundleOfflineWithLkrParse]`).

## Side Effects

- **Disk Writes & Artifacts**:
  - `test-bundle.mjs` creates/deletes `tmpdir()/dab-bundle-test-*` (writing `bundle_app.py`, `app.js`, `bootstrap_lookml.py`, `.lkml` files, `lookml_result.json`, and fake `pip`/`uv`/`lkr` shims) and triggers `bench-concurrent-convs.mjs --iter=1` (`[test-bundle.mjs:workDir]`, `[test-bundle.mjs:fakeBinDir]`).
  - `run-evals.mjs` creates `tmp/evals/scorecard.md` and `tmp/evals/results.json`, spawns `bench-data-app.mjs`, `bench-dashboard.mjs`, and `bench-concurrent-convs.mjs --iter=10`, and uses `tmpdir()/dab-eval06-*` and `tmpdir()/dab-eval07-*` (`[run-evals.mjs:main]`).
  - `bench-data-app.mjs` writes `tmp/bench/iter-1.json`..`iter-10.json` and `tmp/bench/summary.md` (`[bench-data-app.mjs:ITERATION_CONFIGS]`).
  - `bench-dashboard.mjs` writes `tmp/bench-dashboard/iter-1.json`..`iter-10.json`, `model-shootout.json`, and `summary.md` (`[bench-dashboard.mjs:OUT_DIR]`, `[bench-dashboard.mjs:main]`).
  - `bench-concurrent-convs.mjs` writes `tmp/bench-concurrent/iter-<N>.json`, `summary.json`, and `summary.md` (`[bench-concurrent-convs.mjs:OUT_DIR]`, `[bench-concurrent-convs.mjs:main]`).
  - `eval-new-project.mjs` writes JSON report to `--out` or `tmp/evals/new-project-latest.json`, reads `~/.lkr/auth.db` (SQLite read-only), and creates/cleans `tmpdir()/eval-lookml-*` (`[eval-new-project.mjs:getArgolisAuth]`, `[eval-new-project.mjs:main]`).
  - `sync-codemode.sh` writes `src/vendor/codemode.js` (and optionally runs `python3 ${CLI_DIR}/scripts/build_codemode_wasm.py`) (`[sync-codemode.sh:DEST_BUNDLE]`).
  - `sync-upstream.sh` deletes `upstream/` via `rm -rf` and downloads/extracts upstream files into `upstream/` and `upstream/payload/` (`[sync-upstream.sh:UPSTREAM_DIR]`).
- **Subprocesses & In-Process WASM Execution**:
  - `test-bundle.mjs`, `run-evals.mjs`, `bench-data-app.mjs`, `bench-dashboard.mjs`, and `bench-concurrent-convs.mjs` run Python snippets in-process via `LkrCodeMode.runPythonCode` (`src/vendor/codemode.js`) against in-memory mock transports and spawn `python3` subprocesses for `bundle_app.py`, `bootstrap_lookml.py`, `kda_toolkit.py`, and `proxy_sitecustomize.py`.
  - `eval-new-project.mjs` mutates `Module._extensions['.ts']` / `['.tsx']` in-process via `@babel/core` and spawns `lkr` CLI subprocesses (`auth whoami`, `parse lookml-to-api`) (`[eval-new-project.mjs:Module._extensions]`).
- **Network & Live Looker Mutations**:
  - When `--live` is passed to `bench-data-app.mjs`, `bench-dashboard.mjs`, or `bench-concurrent-convs.mjs` (or forwarded by `run-evals.mjs`), they spawn `uv run --directory <LKR_CLI_DIR|~/lkrdev/cli> lkr --oauth-account=dev-argolis code-mode sandbox` (`--allow-update-session` in `bench-dashboard.mjs` and `bench-concurrent-convs.mjs`) to create, query, update, and delete dashboards, Looks, queries, boards, scheduled plans, and LookML files on `dev-argolis` (`[bench-data-app.mjs:runLiveDevArgolisVerification]`, `[bench-dashboard.mjs:runLiveDevArgolisPrototype]`, `[bench-concurrent-convs.mjs:runLiveDevArgolisVerification]`).
  - `eval-new-project.mjs` executes live Gemini API calls (`runAntigravityTurn`) and live Looker `/api/4.0` requests on `dev-argolis`, deleting the created UDD and LookML model unless `--keep` is passed (`[eval-new-project.mjs:main]`).
  - `sync-upstream.sh` fetches 4 files over HTTPS via `curl -fsSL` from `${DATA_APPS_PREFIX_URL}` (`[sync-upstream.sh:PREFIX_URL]`).

## Verification

- Run: `npm test` (executes `npm run lint:check && jest && node scripts/test-bundle.mjs && node scripts/run-evals.mjs`)
- Run: `node scripts/test-bundle.mjs`
- Run: `node scripts/run-evals.mjs` (or `npm run eval`)
