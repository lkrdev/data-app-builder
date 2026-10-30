# Looker Data App Studio (`data-app-builder`)

A Looker Extension (React + TypeScript) that builds, validates, previews, and publishes **Looker Data Apps** directly inside Looker using the **Antigravity Managed Agent** (`antigravity-preview-09-2026` on the Gemini Interactions API) and the **WASM Looker Code Mode** (`LkrCodeMode` Monty Python sandbox).

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
     https://<your-instance>.looker-ext.com
     ```
     *(Include the `*.looker-ext.com` origin if **Enhanced Extension Loading** is enabled on your Looker instance.)*
   - **Authorized redirect URIs**:
     ```text
     https://<your-looker-host>/extensions/oauth2_redirect
     ```
     *(Even when **Enhanced Extension Loading** (`*.looker-ext.com`) is enabled, `extensionSDK.oauth2Authenticate` delegates the OAuth popup to the parent Looker host window on `https://<your-looker-host>`, so the redirect URI is always on `<your-looker-host>`.)*
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
  label: "Data App Studio"
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
