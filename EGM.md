# data-app-builder Blueprint

## System Overview

`data-app-builder` ("Ripper" / Looker Data App Studio) is a Looker Extension (React + TypeScript) and bundled Looker Data Apps toolkit. It turns a single Looker Extension mount (`standalone` and `dashboard_tile`) into an agentic Looker workbench powered by the Gemini Interactions API (`antigravity`), a browser-loaded WASM Python sandbox (`LkrCodeMode` / Monty), and a browser-to-sandbox Looker API bridge (`lkrCliBridge.ts`).

Core execution flow across subsystem boundaries:

1. **Extension Shell & Controller (`src/`)**: Mounts inside Looker (`manifest.lkml`), authenticates users via Google OAuth 2.0 or a server-proxied hidden Looker user attribute (`gemini_api_key`), enforces 4-layer Looker RBAC capabilities (`lookerPermissions.ts`), and routes turns dynamically across `Data App`, `Data Investigator`, `Content Studio` (UDDs/LookML Dashboards/Looks/Boards/Schedules), `Conversational Analytics`, `Agentic LookML`, `3-Pillar Health Check`, and `Script / Python Tile`.
2. **WASM Sandbox & CLI Bridge (`src/lkrCliBridge.ts`, `src/vendor/codemode.js`)**: Executes Python in Monty WASM (loaded from `https://cdn.lkr.dev/cli/codemode/0.0.69/codemode.js` in browser or `src/vendor/codemode.js` in Node/Jest) and intercepts remote sandbox `lkr-dev-cli` calls back to Looker API 4.0 via `transport.rawRequest` under `Safe Mode (Ask)` / `Auto-Approve (YOLO)` gating.
3. **Skills & Playbooks (`skills/`, `src/sandboxSkillsBundle.ts`)**: Bundles canonical Looker workflows (`key-driver-analysis`, `looker-alerts`, `looker-dashboard`, `looker-field-profiler`, `scratch-search`, `looker-project-onboarding`) mounted into the Antigravity remote sandbox at `/workspace/skills/<name>/SKILL.md` and exposed in the Studio UI.
4. **Upstream Toolkit Payload (`upstream/`)**: Mirrors the distributable Looker Data Apps Lit runtime (`data-app.js`, `lit.mjs`, `highcharts`, `ag-grid`, `extension-sdk`), local preview server, and CLI authoring/publishing/update tools.
5. **Verification & Benchmarks (`scripts/`)**: Provides offline bundle/bridge checks (`test-bundle.mjs`), 11-case studio evals (`run-evals.mjs`), live Looker onboarding & SQL-workflow evals (`eval-new-project.mjs`, `eval-stackoverflow-workflow.mjs`), and 10-iteration single/concurrent benchmarks.

## Local Interface & Invariants

### Root Build, Extension & Tooling Interface
- `[package.json:main]`, `[package.json:dependencies]`: Package `data-app-builder` v0.1.0 (`dist/bundle.js`) depending on `@looker/embed-sdk`, `@looker/extension-sdk`, `@looker/extension-sdk-react`, `lucide-react`, `react`, `react-dom`, `react-router-dom`, and `swr`.
- `[package.json:scripts]`: Exposes `dev`, `dev:https`, `build`, `lint`, `lint:check`, `format`, `prepare`, `sync-upstream`, `sync-codemode`, `clean:artifacts`, `eval`, and `test`.
- `[package.json:jest]`: Configures Jest with `testEnvironment: "node"` and `testMatch: ["**/src/__tests__/**/*.test.{js,ts}"]`.
- `[webpack.config.js:module.exports]`: Compiles `src/index.tsx` -> `dist/bundle.js` (`publicPath: "https://localhost:8080/"`) using `babel-loader` (`/\\.(ts|tsx)$/`) and `style-loader` + `css-loader` (`/\\.css$/`).
- `[webpack.develop.js:module.exports]`, `[webpack.prod.js:module.exports]`: Extend base Webpack config for `development` (HMR on `localhost`, permissive dev CORS, filtered runtime error overlay) and `production`.
- `[babel.config.js:module.exports]`: Configures `@babel/preset-env`, `@babel/preset-react`, and `@babel/preset-typescript`.
- `[tsconfig.json:compilerOptions]`: Sets `strict: true`, `jsx: "react"`, `lib: ["dom", "es2015"]`, `esModuleInterop: true`, `sourceMap: true`.
- `[manifest.lkml:application]`: Declares Looker project `data_app_builder` and application `data_app_builder` (`label: "Ripper"`, `url: "https://localhost:8080/bundle.js"`, `mount_points: { standalone: yes, dashboard_tile: yes }`, boolean entitlements `local_storage`/`navigation`/`new_window`/`use_clipboard`/`use_embeds`/`use_iframes`/`use_form_submit`/`raw_api_request: yes`, `scoped_user_attributes: ["gemini_api_key"]`, plus explicit `new_window_external_urls`, `oauth2_urls`, and `external_api_urls` allowlists).
- `[AGENTS.md]`, `[lkr-dev-cli-version.txt]`, `[.nvmrc]`: Root agent routing guide (`<USE_CASE>` rules, `lkr-dev-cli==0.0.69` bootstrap), pinned CLI version (`0.0.69`), and Node version (`v24.21.0`).
- `[.eslintrc.json:extends]`, `[.prettierrc.json:tabWidth]`: Enforces TypeScript/React/Hooks/Import lint rules across `src/` (ignoring `src/vendor/**`, `dist/**`, `upstream/**`) and Prettier formatting (`tabWidth: 2`, `singleQuote: true`, `semi: true`).

### Root Invariants & Side Effects
- **Invariants**:
  - `[.githooks/pre-commit:4-20]`: Prepends Node `v24.21.0` (`$HOME/.nvm/...`) to `PATH`, enforces exact version parity across `lkr-dev-cli-version.txt`, `src/lkrCliBridge.ts` (`LKR_DEV_CLI_VERSION`), and `CODEMODE_CDN_URL`, rejects any `manifest.lkml` missing `raw_api_request: yes` or declaring `core_api_methods:`, and runs `npm run lint:check`.
  - `[.eslintrc.json:rules]`, `[package.json:scripts.lint:check]`: Enforces `@typescript-eslint/no-explicit-any: "error"`, `@typescript-eslint/no-unused-vars: "error"` (except `^_`), `import/order`, and `--max-warnings=0`.
  - `[webpack.develop.js:devServer.client.overlay.runtimeErrors]`: Suppresses dev overlay noise only for `ResizeObserver loop completed with undelivered notifications.` and `AbortSignal.timeout is not defined...`.
  - `[manifest.lkml:entitlements]`: Restricts outbound host/OAuth/proxy access to `generativelanguage.googleapis.com`, `oauth2.googleapis.com`, `cdn.lkr.dev`, and Looker/Google/GitHub wildcards.
- **Side Effects**:
  - `[package.json:scripts.build]`: Emits `dist/bundle.js`.
  - `[package.json:scripts.prepare]`: Sets `git config core.hooksPath .githooks`.
  - `[package.json:scripts.lint]`, `[package.json:scripts.format]`: Mutate files in `src/`.
  - `[package.json:scripts.sync-upstream]`, `[package.json:scripts.sync-codemode]`, `[package.json:scripts.clean:artifacts]`: Invoke `scripts/sync-upstream.sh`, `scripts/sync-codemode.sh`, and `scripts/clean-artifacts.sh`.

## Subdirectories & System Boundaries

- **src**: [./src/EGM.md](./src/EGM.md) — Core Looker Extension React/TS application, studio controller hooks, Looker RBAC/API/Artifacts services, Antigravity Interactions client, CA sub-agent router, Health Check, LookML viewer, and Monty `lkr-dev-cli` bridge.
- **skills**: [./skills/EGM.md](./skills/EGM.md) & `.agents/skills/` ([skills-lock.json](./skills-lock.json)) — Studio Looker skills (`key-driver-analysis`, `looker-alerts`, `looker-dashboard`, `looker-field-profiler`, `scratch-search`, `looker-project-onboarding`, `studio-conversation-debugger`) bundled for sandbox execution (`src/sandboxSkillsBundle.ts`) and synced via [.github/workflows/update-skills.yml](./.github/workflows/update-skills.yml).
- **scripts**: [./scripts/EGM.md](./scripts/EGM.md) — Offline verification harness (`test-bundle.mjs`), 11-case studio eval suite (`run-evals.mjs`), live onboarding & SQL-workflow evals (`eval-new-project.mjs`, `eval-stackoverflow-workflow.mjs`), 10-iteration benchmarks, artifact cleaner (`clean-artifacts.sh`), and upstream/codemode sync scripts.
- **upstream**: [./upstream/EGM.md](./upstream/EGM.md) — Synced Looker Data Apps distribution (`install.sh`, `version-install.sh`) and packaged `payload/` (`runtime/data-app.js`, `preview-server/`, `scripts/`, `skills/`, and `vendor/` assets for `ag-grid`, `highcharts`, `lit`, and `@looker/extension-sdk`).
- **looker**: [./looker/manifest.lkml](./looker/manifest.lkml) — Looker deployment manifest mirror (`data_app_builder`) tracked outside the build pipeline.

## Global Invariants

1. **Pinned `lkr-dev-cli` Version Parity**: `lkr-dev-cli-version.txt`, `LKR_DEV_CLI_VERSION` and `CODEMODE_CDN_URL` in `src/lkrCliBridge.ts`, `AGENTS.md`, `upstream/payload/AGENTS.md`, and `test-bundle.mjs` must match (`0.0.69`); `.github/workflows/update-skills.yml` runs on Mon/Thu (`09:00 UTC`) to sync `.agents/skills/*` & `skills-lock.json`, rewrite `lkr-dev-cli-version.txt`, `src/lkrCliBridge.ts`, `src/lookmlTool.tsx`, `AGENTS.md`, and `upstream/payload/AGENTS.md` when PyPI ships a newer `lkr-dev-cli` release, and refresh `upstream/` via `npm run sync-upstream` (while `src/vendor/codemode.js`, `src/sandboxSkillsBundle.ts`, `scripts/test-bundle.mjs`, and `src/__tests__/permissions.test.ts` are updated in lockstep during verified CLI bumps), and `lkrCliBridge.ts` SHA-256 cache keys must stay synchronized with the Python `sitecustomize.py` shim.
2. **Raw API Transport Routing (Zero `core_api_methods`)**: All Looker API 4.0 calls from both `core40SDK` (`createDeduplicatedLookerSdkProxy` in `src/lookerApi.ts`) and `LkrCodeMode` (`src/lkrCliBridge.ts`) route through `transport.rawRequest` (or `extensionSDK.invokeCoreSdkRaw` / `invokeCoreSdk` / `opts.requestHandler` fallbacks in `LkrCodeMode` when `core40SDK` is omitted), and `manifest.lkml` must declare `raw_api_request: yes` with zero `core_api_methods:`.
3. **Zero-`any` TypeScript & Pre-Commit Enforcement**: `npm run lint:check` (`--max-warnings=0`, `@typescript-eslint/no-explicit-any: "error"`) runs in both `.githooks/pre-commit` and `npm test`; library SDK types (`@looker/sdk`, `@looker/extension-sdk`, `@looker/embed-sdk`, `swr`, `react`) are imported before defining custom interfaces.
4. **4-Layer Looker RBAC & Safe Mode Approval**: `resolveUserCapabilities` (`src/lookerPermissions.ts`) evaluates `PermissionSet × ModelSet` per role before merging, while `lkrCliBridge.ts` (`classifyLookerOperation`, `LkrCodeMode.runPythonCode`, and `executeLkrExtensionToolRequest`) auto-executes read-only endpoints and gates mutating Looker calls behind `Safe Mode (Ask)` user approvals (`allow_once`, `allow_op`, `allow_all`, `deny`).
5. **Single Per-User Remote Sandbox & Multi-Item Conversations**: Concurrent conversation turns share one persisted per-user `environment_id` (coordinated via `activeInteractionsByEnv`, defined in `src/antigravityTypes.ts` and re-exported by `src/antigravity.ts`), and conversations store an array of `contentItems` tabs rendered via `@looker/embed-sdk` in `StudioRightPane`.
6. **Browser Bundle Size Optimization**: `src/lkrCliBridge.ts` dynamically loads `LkrCodeMode` from `cdn.lkr.dev` in browsers and falls back to local `src/vendor/codemode.js` only in Node/Jest environments.

## Global Side Effects

- **Looker API 4.0 & Artifacts Storage**: Reads and mutates dashboards, looks, boards, schedules, LookML project files/branches, user attributes, inline Data App extensions (`/data_app_extension`), and extension artifacts (`/artifacts/{namespace}`).
- **External Network Integrations**: Calls Gemini Interactions API (`generativelanguage.googleapis.com` directly via OAuth or through Looker `serverProxy`), Google OAuth 2.0 popups (`accounts.google.com` / `oauth2.googleapis.com`), `cdn.lkr.dev` (WASM runtime), and `dl.google.com` (only when invoking `sync-upstream.sh`).
- **Browser & Local Workspace State**: Mutates `localStorage` / `extensionSDK` storage, Looker embedded iframes, DOM theme attributes, `dist/bundle.js` (on build), and `tmp/` benchmark/eval reports (`tmp/eval/`, `tmp/evals/`, `tmp/bench*`).

## Architectural History & Open Evolution (GitHub Issues)

Summary of key architectural milestones from `lkrdev/data-app-builder` issues (`#1`–`#191`):

- **Multi-Tool Agentic Platform & Artifacts (`#1`, `#5`, `#55`, `#99`, `#100`)**: Evolved from a single-purpose Data App builder into a multi-use-case Looker Agent with dynamic per-turn routing (`#100`), SWR-backed Looker GET deduplication + `ArtifactService` (`#55`), and multi-tab `contentItems` per conversation (`#99`).
- **RBAC, Safe Mode & Transport Hardening (`#13`, `#33`, `#77`, `#83`, `#104`, `#127`)**: Enforced 4-layer Looker RBAC (`#13`), routed online `lkr-dev-cli` calls back through the Extension Bridge (`#33`), enforced `/spartan/oauth2_redirect` + Safe Mode `sdk_request` gating (`#83`), switched browser `LkrCodeMode` to CDN loading (`#104`), eliminated all `any` lint violations (`#77`), and replaced `core_api_methods` with `raw_api_request: yes` + `transport.rawRequest` (`#127`).
- **Skills, Profiling & Performance (`#130`, `#145`, `#149`, `#157`, `#191`)**: Mounted skills at `/workspace/skills/<name>/SKILL.md` (`#130`), unified `looker-dashboard` and `looker-field-profiler` (`#145`), bumped `lkr-dev-cli` to `0.0.66` with `scratch-search` (`#149`), cut Turn-1 project onboarding latency below 4s (`#157`), and bumped `lkr-dev-cli` & `CODEMODE_CDN_URL` to `0.0.67` with byte-for-byte CDN `codemode.js` parity (`#191`).
- **Recent & Ongoing Evolution (`#155`–`#191`, PRs `#159`–`#194`)**: Centralized immutable `Conversation` (`conv_<id>`) state with SWR sidebar + unified `contentItems` ribbon (`#155/#162`), topbar/sidebar/markdown/Viewer polish (`#156/#161`), Turn-1 <4s onboarding + Monty global fixes (`#157/#160`), PoP KPI / Metric Selector Data App upgrades (`#158/#159`), plain-Struct `function_result.result` + live telemetry (`#165/#170`), `@container` `4 -> 2x2 -> 1` balanced KPI grids (`unbalanced-kpi-grid`) + custom `Window:` number popover (`#173`), type-scoped `getConvTargetId` + `/workspace/.uv_tools` hibernation recovery (`#171/#176`), Chatty session API logger (`window.lkr_codemode_api_calls`) (`#178/#180`), OAuth SSE `step.delta` wire merge + cross-project `sql_table_name` + 1-row `json_detail` dashboard SQL gate (`#177/#181`), layered dual-date `Promise.all` comparison queries + shared-when-close `linkedTo: 0` dual Y-axes (`forbidden-compare-against-dropdown`, `invalid-metric-comparison-query-or-axis`) (`#179/#182`), unified Overview stage explorer (`#183/#184`), configurable `maxToolRounds` wrap-up + `lookml:default` sanitization (`#186/#188`), `agentic-lookml-workflow` bridge compaction + replay skipping (`#192`), compact `E/V/T/D/M/R/F` LookML file tabs & deep-linked `Open in IDE` (`#189/#193`), and live browser `Safe Mode (Ask)` gating across CDN `codemode.js`, `_re_perm`, & Data App publish (`#190/#194`).

## System Verification

- Full verification suite: `npm test` (runs `npm run lint:check && jest && node scripts/test-bundle.mjs`)
- TypeScript / ESLint check only: `npm run lint:check`
- Production bundle build: `npm run build`
- Offline evals only: `npm run eval`
