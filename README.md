# Looker Agent (`data-app-builder`)

A Looker Extension (React + TypeScript) that lets you **Use your Looker Agent** to build, analyze, and automate across **Looker Dashboards (Content Studio)**, **Data Apps**, **Conversational Analytics**, **Agentic LookML**, **Python Tiles**, and **3-Pillar Health Checks** directly inside Looker using the **Antigravity Managed Agent** (`antigravity-preview-09-2026` on the Gemini Interactions API) and the **WASM Looker Code Mode** (`LkrCodeMode` Monty Python sandbox).

## Skilled Use Cases

- **Data Apps**: Author and publish interactive Lit web component apps (`<app-kpi>`, `<app-chart>`, `<app-grid>`) into Looker dashboard tiles.
- **Data Investigator**: Generate root-cause narrative investigations in Google Doc or Presentation format using Key Driver Analysis (`run_key_driver_analysis`) and fixed date ranges.
- **Content Studio**: Build and update native Looker User-Defined Dashboards (UDDs), LookML Dashboards, Saved Looks, Boards, and Scheduled Plans.
- **Conversational Analytics**: Ask natural-language analytical questions and route directly to Looker Conversational Analytics (CA) agents.
- **Agentic LookML**: Author, refactor, validate, and test LookML models, views, explores, and refinements in user dev mode.
- **3-Pillar Health Check**: Audit Looker System Activity (Pillar 1), LookML 0–4 Transcriber Rubric (Pillar 2), and BigQuery `INFORMATION_SCHEMA` (Pillar 3).
- **Script / Python Tile**: Run sandboxed `LkrCodeMode` Python scripts against Looker SDKs, render custom dashboard tiles, and schedule script runs.

---

## Prerequisites

### 1. Looker Instance Requirements
- **Data Apps Feature Enabled**: Enable **Data Apps** in Looker (**Admin → Labs → Data Apps**), which enables `/api/4.0/data_app_extension`, `/api/4.0/inline_extension/{id}/bundle.js`, and dashboard layout `type: "extension"`.
- **User Permissions**: Regular users building Data Apps need `access_data`, `explore`, `see_user_dashboards`, `save_content`, and `save_dashboards` (plus edit access to the target publish folder).

### 2. Instance-Wide Antigravity Authentication Setup (Configured Once by Admin)

Authentication mode (`Google OAuth` vs. `Gemini API Key`) is configured **once per Looker instance** via the **⚙ Setup** button in the top bar and persisted in Looker's shared **Extension Context Data** (`extensionSDK.saveContextData`). Individual users do not need to configure Client IDs or API keys.

#### Option A: Google OAuth 2.0 (Per-User Sign-In, Configured Once)
Only a **Web application OAuth 2.0 Client ID** is needed — **no Client Secret is required** (`extensionSDK.oauth2Authenticate` uses `response_type: 'token'`).

1. **Enable the API**:
   - In the Google Cloud Console (`APIs & Services → Library`), enable the **Generative Language API** (`generativelanguage.googleapis.com`).
2. **Create a Web OAuth Client ID**:
   - Go to `APIs & Services → Credentials → Create Credentials → OAuth client ID` and choose **Web application**.
   - **Authorized JavaScript origins**:
     ```text
     https://<your-looker-host>
     ```
   - **Authorized redirect URIs** (register **both** Standard Extension and Full Screen / Spartan URIs to prevent `Error 400: redirect_uri_mismatch`):
     ```text
     https://<your-looker-host>/extensions/oauth2_redirect
     https://<your-looker-host>/spartan/oauth2_redirect
     ```
     > **Why both URIs are required**: Launching the extension in Looker's standard frame (`/extensions/...`) passes `redirect_uri=https://<your-looker-host>/extensions/oauth2_redirect`, whereas launching in Looker Full Screen mode (`/spartan/...`, `lookerHostData.hostType === 'spartan'`) passes `redirect_uri=https://<your-looker-host>/spartan/oauth2_redirect` (`flowName=GeneralOAuthFlow`). Both URIs are displayed with one-click Copy buttons in **⚙ Setup** (`/config`).
3. **Save in Extension Context (Once)**:
   - Click **⚙ Setup** in the extension top bar, select **Google OAuth**, enter the **OAuth Client ID** and optional **GCP Project ID** (`x-goog-user-project`), and click **Save Setup**.
   - All users on the instance will then simply click **Sign In** in the top bar.

#### Option B: Gemini API Key via Hidden Looker User Attribute (`serverProxy`)
1. Click **⚙ Setup** in the extension top bar and select **Gemini API Key (User Attr)**.
2. Optionally paste the default Gemini API Key and click **Save Setup**.
3. The extension uses `extensionSDK.createSecretKeyTag('gemini_api_key')` and calls the Core 4.0 SDK `create_user_attribute` / `update_user_attribute` to provision the scoped user attribute (`data_app_builder_data_app_builder_gemini_api_key`) with:
   - `value_is_hidden: true` (**Hide Values: Yes**)
   - `user_can_view: false`, `user_can_edit: false` (**User Access: None**)
   - `hidden_value_domain_whitelist: "https://generativelanguage.googleapis.com/*"` (**Domain Allowlist**)
   *(If the current user is not a Looker Admin, the extension displays an error indicating that a Looker Admin is required to create/update the hidden user attribute).*
4. At runtime, all Antigravity API calls route through `extensionSDK.serverProxy` with `'x-goog-api-key': extensionSDK.createSecretKeyTag('gemini_api_key')`, so Looker's backend injects the secret key server-side and the key is never exposed to the browser.

---

## Route Navigation

The extension synchronizes its route with Looker's host URL:
- **New Data App**: `/extensions/data-app-builder::data-app-builder`
- **Open Existing Data App Dashboard**:
  - `/extensions/data-app-builder::data-app-builder/:dashboardId`
  - `/extensions/data-app-builder::data-app-builder/dashboards/:dashboardId`

Opening a route with `:dashboardId` (or entering a Dashboard ID in the top bar and clicking **Load App**) fetches the published bundle from `/api/4.0/inline_extension/{id}/bundle.js`, detects `this.lookerModel` and `this.explore`, loads the live `/embed/dashboards/:dashboardId` preview on the right, and mounts the code at `/workspace/apps/current/app.js` on the next Antigravity turn for in-place updates.

---

## Execution Approval Policy (`Safe Mode (Ask)` vs. `Auto-Approve (YOLO)`)

The top bar includes an execution approval toggle (`🛡️ Safe Mode (Ask)` vs. `⚡ Auto-Approve (YOLO)`). Both `LkrCodeMode` (`classifyOperation` in `src/vendor/codemode.js`) and the `lkr-dev-cli` Extension Bridge (`classifyLookerOperation` / `executeLkrExtensionToolRequest` in `src/lkrCliBridge.ts` for both `codemode` and `sdk_request` calls) enforce the following permission matrix:

| Category | HTTP Methods & Looker API 4.0 Endpoints / SDK Calls | `🛡️ Safe Mode (Ask)` (`requirePermission: true`) | `⚡ Auto-Approve (YOLO)` (`requirePermission: false`) |
| --- | --- | --- | --- |
| **Read-Only Metadata & Content Lookups** | All `GET`, `HEAD`, and `OPTIONS` endpoints (`me`, `all_lookml_models`, `lookml_model_explore`, `all_folders`, `folder_children`, `folder_ancestors`, `search_folders`, `dashboard`, `search_content`, `all_projects`, `all_project_files`, `get_file_content`, `search_artifacts`, `user_roles`, etc.) | **Auto-executes** (`requiresPermission: false`) | **Auto-executes** |
| **Read-Only Query Execution** | `POST /queries`, `POST /queries/run/*`, `POST /sql_queries`, `POST /sql_queries/*/run/*`, `POST /merge_queries` (`run_inline_query`, `create_query`, `run_query`, `create_sql_query`, `run_sql_query`, `create_merge_query`) | **Auto-executes** (`requiresPermission: false`) | **Auto-executes** |
| **Read-Only Validation & Testing** | `POST /content_validation`, `POST /projects/{id}/validate`, `POST /projects/{id}/lookml_tests/run`, `POST /projects/{id}/git_connection_tests` (`content_validation`, `validate_project`, `run_lookml_test`, `run_git_connection_test`) | **Auto-executes** (`requiresPermission: false`) | **Auto-executes** |
| **Content & Dashboard Mutations** | `POST`, `PATCH`, `PUT`, `DELETE` on `/dashboards`, `/dashboard_elements`, `/dashboard_filters`, `/dashboard_layouts`, `/dashboard_layout_components`, `/looks`, `/boards`, `/board_sections`, `/board_items`, `/scheduled_plans` (`create_dashboard`, `update_dashboard`, `delete_dashboard`, `import_lookml_dashboard`, `sync_lookml_dashboard`, `create_look`, `update_look`, `delete_look`, `create_board`, `create_scheduled_plan`, etc.) | **Prompts for user approval** (`requiresPermission: true`) | **Auto-executes** |
| **Data App Inline Extensions & Artifacts** | `POST`, `PATCH`, `DELETE` on `/data_app_extension` (`publish_app`), `PUT`, `POST`, `DELETE` on `/artifacts/{namespace}` (`update_artifacts`, `delete_artifact`) | **Prompts for user approval** (`requiresPermission: true`) | **Auto-executes** |
| **LookML File CRUD, Git & Production Deploy** | `POST`, `PATCH`, `PUT`, `DELETE` on `/projects/{id}/files`, `/projects/{id}/git_branch`, `/projects/{id}/deploy_to_production`, `/lookml_models` (`create_file`, `update_file`, `delete_file`, `create_git_branch`, `update_git_branch`, `commit`, `deploy_to_production`, `create_lookml_model`, `update_lookml_model`) | **Prompts for user approval** (`requiresPermission: true`) | **Auto-executes** |

### Interactive Approval Decisions (`Safe Mode (Ask)`)
When a mutating `codemode` or `sdk_request` call is intercepted in `Safe Mode (Ask)`, the Studio displays an inline approval prompt with four options:
- **Allow once** (`allow_once`): Executes the single pending mutation.
- **Allow all `'<operation>'` this turn** (`allow_op`): Adds `<operation>` (e.g., `create_dashboard_element`) to `approvedOperations` so loops over that operation execute without re-prompting during the current turn.
- **Allow all mutations this turn** (`allow_all`): Approves all remaining mutating operations for the current turn.
- **Deny** (`deny`): Rejects the request with `PermissionError: Operation '<operation>' (<VERB> <path>) mutates Looker state and was not approved.` before any HTTP call is sent.

---

## Development & Build Scripts

```bash
# Install dependencies
npm install

# Start local webpack dev server (http://localhost:8080/bundle.js)
npm run dev

# Or start over HTTPS (https://localhost:8080/bundle.js)
npm run dev:https

# Run self-check tests (verifies BUNDLE_APP_PY + WASM Code Mode bridge)
npm test

# Build production bundle (dist/bundle.js)
npm run build
```

### Sync Scripts

- **Sync Upstream Looker Data Apps Toolkit (`dl.google.com`)**:
  ```bash
  npm run sync-upstream
  ```
  Redownloads `install.sh`, `latest-version.txt`, `versions/<ver>/install.sh`, and extracts `looker-data-apps.tar.gz` into [`upstream/`](./upstream) so `git diff upstream/` shows any upstream toolkit or skill changes.

- **Sync Looker Code Mode WASM (`~/lkrdev/cli/dist/codemode.js`)**:
  ```bash
  npm run sync-codemode
  ```
  Copies (or builds via `build_codemode_wasm.py`) the single-file Monty Python WASM runtime into [`src/vendor/codemode.js`](./src/vendor/codemode.js).

---

## LookML Manifest Configuration

See [`looker/manifest.lkml`](./looker/manifest.lkml) (or root [`manifest.lkml`](./manifest.lkml)):

```lkml
project_name: "data_app_builder"

application: data_app_builder {
  label: "Looker Agent"
  url: "https://localhost:8080/bundle.js"
  # file: "bundle.js"
  mount_points: {
    standalone: yes
  }
  entitlements: {
    local_storage: yes
    navigation: yes
    new_window: yes
    use_embeds: yes
    use_iframes: yes
    use_form_submit: yes
    raw_api_request: yes
    core_api_methods: [
      "me",
      "all_lookml_models",
      "lookml_model_explore",
      "run_inline_query",
      "create_query",
      "all_folders",
      "dashboard",
      "create_dashboard",
      "update_dashboard",
      "delete_dashboard",
      "create_dashboard_element",
      "update_dashboard_element",
      "dashboard_layout",
      "update_dashboard_layout",
      "all_user_attributes",
      "create_user_attribute",
      "update_user_attribute"
    ]
    scoped_user_attributes: [
      "gemini_api_key"
    ]
    oauth2_urls: [
      "https://accounts.google.com/o/oauth2/v2/auth",
      "https://oauth2.googleapis.com/token"
    ]
    external_api_urls: [
      "https://generativelanguage.googleapis.com",
      "https://oauth2.googleapis.com"
    ]
  }
}
```
