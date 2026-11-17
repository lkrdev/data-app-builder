# Ripper — Looker Agent (`data-app-builder`)

A Looker Extension (React + TypeScript) that lets you build, analyze, and automate across **Data Apps**, **Data Investigator**, **Content Studio**, **Conversational Analytics**, **Agentic LookML**, **3-Pillar Health Checks**, and **Python Tiles / Instance Governance** inside Looker using the Gemini Interactions API (`antigravity`) and the WASM Looker Code Mode (`LkrCodeMode` Monty Python sandbox).

## Skilled Use Cases

- **Data Apps**: Author and publish interactive Lit web component apps (`<app-kpi>`, `<app-chart>`, `<app-grid>`, clickable PoP variance cards, layered dual-date comparisons, metric switchers) directly into Looker dashboard tiles.
- **Data Investigator**: Generate root-cause narrative investigations in Google Doc (`doc`) or Presentation (`slides`) format using Key Driver Analysis (`run_key_driver_analysis`), LookML `drill_fields`, and fixed date ranges.
- **Content Studio**: Build and update native Looker UDDs, LookML Dashboards (`.dashboard.lookml`), Saved Looks, Boards, and Scheduled Plans; clone content on the same instance (`copy_dashboard`, `copy_look`) or export/import portable `.json` specs (`export_dashboard_json`, `import_dashboard_json`, `export_look_json`, `import_look_json`, including composer `.json` drag-and-drop).
- **Conversational Analytics**: Route natural-language analytical questions via isolated sub-agent selection to Looker Conversational Analytics (CA) agents, backed by per-model `_field_value_search_<model>` string search indexes.
- **Agentic LookML**: Onboard new Looker projects end-to-end from existing DB connections (`looker-project-onboarding`), refactor `.sql` files (including drag-and-drop) with `sql-lookml-compare` parity checks, profile and curate Explore fields (`profile_fields`, `scratch-search`), run LAMS and query/PDT performance reviews, author `.test.lkml` suites, and translate Snowflake SQL/LookML to BigQuery.
- **3-Pillar Health Check**: Audit Looker System Activity (Pillar 1), LookML 0–4 Transcriber Rubric (Pillar 2), and BigQuery `INFORMATION_SCHEMA` (Pillar 3).
- **Script / Python Tile**: Run sandboxed `LkrCodeMode` Python dashboard tiles and schedules, triage and migrate **Looker Alerts** in the Alert Inspector (`looker-alerts`), run **Henry `system__activity` health & safe vacuum** audits (`health_pulse`, `health_analyze`, `health_vacuum`), generate redacted **OpenAPI request skeletons** (`api_template`, `describe_body`), inspect clickable folder inventories (`format_content_inventory`), and soft-trash `test*` clutter in personal folders.

---

## Prerequisites

### 1. Looker Instance Requirements
- **Data Apps Feature Enabled**: Enable **Data Apps** in Looker (**Admin → Labs → Data Apps**), which enables `/api/4.0/data_app_extension`, `/api/4.0/inline_extension/{id}/bundle.js`, and dashboard layout `type: "extension"`.
- **User Permissions**: Capabilities gate dynamically against Looker's 4-layer RBAC (`PermissionSet × ModelSet`). Building Data Apps requires `access_data`, `explore`, `see_user_dashboards`, `save_content`, and `save_dashboards` (plus edit access to the target folder).

### 2. Instance-Wide Authentication Setup (Configured Once by Admin)

Authentication mode (`Google OAuth` vs. `Gemini API Key`) is configured once per Looker instance via **⚙ Setup** (`/config`) and persisted in Looker Extension Context Data (`extensionSDK.saveContextData`).

#### Option A: Google OAuth 2.0 (Per-User Sign-In)
Only a **Web application OAuth 2.0 Client ID** is needed (no Client Secret; `extensionSDK.oauth2Authenticate` uses `response_type: 'token'`).

1. Enable the **Generative Language API** (`generativelanguage.googleapis.com`) in Google Cloud Console.
2. Create a **Web application** OAuth Client ID with:
   - **Authorized JavaScript origins**: `https://<your-looker-host>`
   - **Authorized redirect URIs** (register **both** Standard Extension and Full Screen / Spartan URIs to avoid `Error 400: redirect_uri_mismatch`):
     ```text
     https://<your-looker-host>/extensions/oauth2_redirect
     https://<your-looker-host>/spartan/oauth2_redirect
     ```
3. Open **⚙ Setup**, choose **Google OAuth**, save the Client ID (and optional GCP Project ID), and sign in from the top bar.

#### Option B: Gemini API Key via Hidden Looker User Attribute (`serverProxy`)
1. Open **⚙ Setup**, select **Gemini API Key (User Attr)**, paste the key, and click **Save Setup** (requires Looker Admin to create/update the hidden attribute).
2. Studio provisions `data_app_builder_data_app_builder_gemini_api_key` (`value_is_hidden: true`, `user_can_view: false`, `user_can_edit: false`, `hidden_value_domain_whitelist: "https://generativelanguage.googleapis.com/*"`) and routes requests through `extensionSDK.serverProxy` so the key is never exposed to the browser.

---

## Route Navigation

- **Studio Home**: `/extensions/data_app_builder::data_app_builder`
- **Open Existing Data App Dashboard**: `/extensions/data_app_builder::data_app_builder/:dashboardId` (or `/dashboards/:dashboardId`)

---

## Execution Approval Policy (`Safe Mode (Ask)` vs. `Auto-Approve (YOLO)`)

`src/lkrCliBridge.ts` (`classifyLookerOperation`, `LkrCodeMode.runPythonCode`, and `executeLkrExtensionToolRequest`) enforces the top-bar approval mode across all `codemode` and `sdk_request` calls:

| Category | HTTP Methods & Looker API 4.0 Endpoints | `🛡️ Safe Mode (Ask)` | `⚡ Auto-Approve (YOLO)` |
| --- | --- | --- | --- |
| **Read-Only Metadata & Lookups** | `GET`, `HEAD`, `OPTIONS` (`me`, `all_lookml_models`, `lookml_model_explore`, `all_folders`, `dashboard`, `search_content`, `all_projects`, `search_alerts`, etc.) | **Auto-executes** | **Auto-executes** |
| **Read-Only Query Execution** | `POST /queries`, `POST /queries/run/*`, `POST /sql_queries`, `POST /sql_queries/*/run/*`, `POST /merge_queries` | **Auto-executes** | **Auto-executes** |
| **Read-Only Validation & Tests** | `POST /content_validation`, `POST /projects/{id}/validate`, `POST /projects/{id}/lookml_tests/run`, `POST /projects/{id}/git_connection_tests` | **Auto-executes** | **Auto-executes** |
| **Content, Alerts & Artifacts Mutations** | `POST`, `PATCH`, `PUT`, `DELETE` on `/dashboards*`, `/looks`, `/boards*`, `/scheduled_plans`, `/alerts*`, `/data_app_extension`, `/artifacts/{namespace}` | **Prompts (`allow_once` / `allow_op` / `allow_all` / `deny`)** | **Auto-executes** |
| **LookML CRUD, Git & Deploy** | `POST`, `PATCH`, `PUT`, `DELETE` on `/projects/{id}/files`, `/projects/{id}/git_branch`, `/projects/{id}/deploy_to_production`, `/lookml_models` | **Prompts (`allow_once` / `allow_op` / `allow_all` / `deny`)** | **Auto-executes** |

---

## Scripts

```bash
npm install                                  # Install dependencies & configure .githooks
npm run dev                                  # Local dev server (http://localhost:8080/bundle.js)
npm run dev:https                            # Local HTTPS dev server (https://localhost:8080/bundle.js)
npm run build                                # Build production bundle (dist/bundle.js)
npm test                                     # Run ESLint (--max-warnings=0), Jest, and scripts/test-bundle.mjs
npm run eval                                 # Run 16-case offline Studio evaluation suite (pass --live for live API)
npm run pack-skills                          # Repack .agents/skills/* into src/sandboxSkillsBundle.ts (--check to verify)
npm run clean:artifacts <oauth-account>      # Purge Studio/Ripper Looker Artifact namespaces via lkr code-mode
npm run sync-upstream                        # Unpack upstream Looker Data Apps release into skills/data-apps/
npm run sync-codemode                        # Sync pinned WASM codemode.js from cdn.lkr.dev into src/vendor/codemode.js
```

---

## LookML Manifest

[`manifest.lkml`](./manifest.lkml) is the single canonical LookML manifest:
- Uses `raw_api_request: yes` with **zero** `core_api_methods:` (enforced by `.githooks/pre-commit` and `npm test`) so all SDK and `LkrCodeMode` calls route through `transport.rawRequest`.
- Mounts on both `standalone: yes` and `dashboard_tile: yes` (required for `PythonTile` dashboard elements).
- Point `url: "https://localhost:8080/bundle.js"` during local development, or switch to `file: "bundle.js"` when deploying `dist/bundle.js` into a Looker project.
