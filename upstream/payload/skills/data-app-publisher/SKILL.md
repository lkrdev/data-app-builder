---
name: data-app-publisher
description: |
  Deploy and publish a Data App to the customer's Looker instance via the
  Data Apps extension framework. Trigger when publishing, deploying, or releasing
  a finished Data App to Looker.
---

You are publishing a completed, verified Data App into the customer's Looker instance.

## 1. Strict Requirement — Never Publish Autonomously

**Under NO circumstances should an AI agent run `publish-data-app.py` on its own.**
Publishing creates real, persistent resources on the customer's Looker instance and is strictly an interactive action requiring explicit user instruction. (Similarly, never run toolkit updates autonomously; see `skills/toolkit-updater/SKILL.md`.)

## 2. Configuration & Prerequisites

Publishing requires configuration from `data-apps-config.json` (written during bootstrap):
- **`data-apps-config.json`** (repo root) — Looker instance `base_url`, `client_id`, `client_secret`, and `publish_folder_id`.

To verify the instance supports inline extensions before publishing (on Windows where `python3` is absent or points to the Microsoft Store stub, substitute `python` or `py -3` in all `python3` commands below):
```bash
python3 scripts/verify-install.py
```

## 3. Publishing the Data App

When the user explicitly instructs you to publish, run:

```bash
python3 skills/data-app-publisher/tools/publish-data-app.py \
  --def apps/<app-name>/app.js \
  --title "<App Title>"
```

### Re-publishing an existing app in place:
When updating an already published app, pass `--dashboard-id <id>` using the dashboard ID printed by the previous publish:
```bash
python3 skills/data-app-publisher/tools/publish-data-app.py \
  --def apps/<app-name>/app.js \
  --title "<App Title>" \
  --dashboard-id <id>
```
Without `--dashboard-id`, every publish creates *another* dashboard at a new URL and leaves the old one behind.

> [!IMPORTANT]
> If the output contains `WARNING: Looker's dashboard header stays visible`, tell the user. Their Looker instance cannot hide the dashboard header, so the app works but renders below Looker's title and filter bar instead of full screen. The publish still succeeded; do not retry it.

#### Overwrite Protection & Confirmation:
- **Never pass `--confirm-replace` on the first run:** Always execute `publish-data-app.py` without `--confirm-replace` first, even if the user asked to overwrite or replace the dashboard. A same-user update never prompts, so this adds no step for the common case, while ensuring that updates to another user's work always pause for explicit confirmation.
- **Never bypass the check with a custom script:** The agent must never write or run custom scripts, curl commands, or direct API calls to bypass `publish-data-app.py` or force an overwrite.
- **Prompt the user on `user_mismatch`:** If `publish-data-app.py` exits with a `user_mismatch` error envelope (`ERROR_ENVELOPE_JSON`), stop and prompt the human user:
  > *"Dashboard <id> was last updated by '<last_updater>', but you are currently authenticated as '<current_user>'. Updating it will overwrite their work. Would you like to proceed?"*
- **Pass `--confirm-replace` only after explicit confirmation:** Pass `--confirm-replace` only after encountering a `user_mismatch` error envelope and receiving an explicit confirmation from the human user in response to the prompt:
```bash
python3 skills/data-app-publisher/tools/publish-data-app.py \
  --def apps/<app-name>/app.js \
  --title "<App Title>" \
  --dashboard-id <id> \
  --confirm-replace
```

> [!NOTE]
> Published apps should always reside under `apps/<app-name>/app.js`. Reference apps under `examples/` are overwritten during toolkit updates; publishing an app directly from `examples/` will warn the author to copy the app into `apps/` to preserve in-file publish metadata across updates.


### Automatic Metadata Tracking:
On initial publish, `publish-data-app.py` writes the dashboard identity back into the source `app.js` JSDoc header:
- `@looker-dashboard-id <id>`
- `@looker-instance <url>`
- `@created-at <iso8601>`
- `@created-by <author>`
- `@toolkit-version <version>`

`@updated-at <iso8601>` and `@updated-by <author>` are omitted initially; when absent, the updater is assumed to be the original author at creation time.

On subsequent publishes with `--dashboard-id`, it preserves the original `@created-at` timestamp and `@created-by` author (migrating legacy `@published-at` / `@published-by`), records `@updated-at <iso8601>` and `@updated-by <author>` with the person and time performing the update, and updates `@toolkit-version` (along with `@looker-dashboard-id` and `@looker-instance`) to reflect the latest publish state, while verifying that the target Looker instance matches the recorded `@looker-instance`. If the author lookup is unavailable, the author tag is omitted.

### Architecture & Entity Model:
- **A Data App is a dashboard-mounted inline extension** — publishing creates both a **Dashboard** entity and an **Inline Extension** entity in Looker's database (`POST /data_app_extension`). The single dashboard element references the extension via `extension_id: "db::<uuid>"`. Looker serves `app.js` directly to the extension frame as an ES module.
- **Authoring Permissions & Entitlements** — Data Apps can be created by authors with standard dashboard author permissions (`access_data`, `explore`, `see_user_dashboards`, `save_content`, `save_dashboards`, plus edit access on the publish folder) rather than developer `develop` permissions, because Looker fixes and manages the sandbox entitlements server-side. Note that Looker reports a missing permission as HTTP 404.
- **The runtime is imported by URL** — the app imports `data-app.js` and `lit.mjs`, and publish rewrites those two specifiers to the hosted bundle (`publish-data-app.py`), which also prepends `window.__lookerDataAppMeta` with `publishedAt` from `@updated-at`, `@created-at`, or legacy `@published-at`, and stamps missing widget IDs (see below). The runtime stays out of the database and stays HTTP-cacheable across every dashboard.
- **Extension layout, always full bleed** — The app gets the `extension` layout (one element, full screen) with Looker's dashboard header (title, filter bar, reload, menu) and the tile title hidden, because the app draws its own. This is the only mode; there is no flag to keep Looker's header. Re-publishing with `--dashboard-id` hides them again if they were showing.
- **Widget IDs & Query Manifest** — On publish, `publish-data-app.py` (via `tools/widget_extractor.py`) reads `app.js` as text, stamps an identity on every `<app-chart>`, `<app-grid>` and `<app-kpi>` in the published copy (not the file on disk), registers each widget's saved Looker query (`POST /queries`), and stores the mapping in `rich_content_json.data_app_queries` on the dashboard element, which powers host widget actions such as "Explore from here". A widget rendered once gets `id="da-<tag>-<slug>"` (slug of its title, label, query-field or fields; `-1`, `-2` when names collide; an author `id` is kept). A tag rendered many times (a loop, or a helper called more than once or with parameters) gets a shared `data-da-key`; the runtime names each copy `<key>~<index>` (`getWidgetId()`) and resolves widget actions by checking `getWidgetId()` (`<key>~<index>`) first and falling back to `getQueryKey()` (`<key>`). When a `.map()` loop iterates over a static `const` array and each item produces a distinct query (for example `METRICS.map(m => html\`<app-kpi .query=${{ fields: m.fields }}>\`)`), the extractor unrolls the loop and registers per-item `<key>~0..N-1` entries in `data_app_queries`. Saved queries capture each widget's query shape and fixed source filters (leaving out filters that read app state or a loop variable), while at runtime `TILE_WIDGET_ACTION` always supplies the widget's full live filter map so `f[field]` overrides any same-key saved filter. Widgets whose model, explore or fields can't be worked out at publish time (for example a loop over dynamic `this.*` data whose fields come from the loop variable) and static widgets are skipped; query parts read from app state (`this.*`) are registered with their starting value and reported as warnings. The global identity of a widget is `(dashboard_element_id, widget_id)`; generated ids can change when titles or widget order change, so set an explicit `id` where a stable id matters.
- **Report widget registration to the user.** After publishing, tell the user how many widget queries were registered and list every `skipped:` and `warning:` line from the output with its reason, so they know which widgets have no "Explore from here" or may open a different query.
- **Instance requirement** — Requires the `inline_extensions` feature on the Looker instance.

## 4. URL Presentation Rule

**Always present the real Looker instance URL** to the user (e.g. `https://<customer-instance>.looker.com/dashboards/<id>`).
Never present localhost or proxy URLs.

## 5. Error Recovery & Structured Envelopes

`publish-data-app.py` outputs structured JSON error envelopes on failure (`ERROR_ENVELOPE_JSON: <json>`):

* **`user_mismatch`:** The current Looker user does not match the dashboard's last updater (or original author). The agent must NOT self-correct or automatically retry with `--confirm-replace`. It must prompt the human user for explicit confirmation before re-running with `--confirm-replace`. (Note: in shared folders, non-owners with edit access can update the app using `--confirm-replace`; apps in personal folders can only be updated by their owner, an admin, or a developer. This check is best effort: it compares display names; when the deployed bundle has no author tags or cannot be read, it falls back to the dashboard's last updater or creator from Looker, which can be missing or out of date.)
* **`def_too_large`:** The app definition exceeds the payload size limit (default 900 KB). Trim inline mock data or base64 assets.
* **`looker_http_401`:** The Looker API key is invalid or expired.
* **`looker_http_403` / `looker_http_404` (permission denied):** The API user lacks one of the required dashboard author permissions (`access_data`, `explore`, `see_user_dashboards`, `save_content`, `save_dashboards`, plus folder edit access). Note that Looker's `authorize!` reports a missing permission as HTTP 404 with a `/r/err/` `documentation_url`.
* **`looker_http_404` (folder not found):** `publish_folder_id` does not exist or is not viewable by the API user.
* **`looker_http_404` (`/data_app_extension` unavailable):** The Looker instance has the `inline_extensions` feature turned off (returns HTTP 404 with a root `documentation_url` or `Sinatra::NotFound`).

## 6. Server Cleanup

When publishing is complete, stop any running preview server:
```bash
python3 skills/data-app-previewer/tools/stop-preview.py
# (alternate shortcut: make stop)
```
