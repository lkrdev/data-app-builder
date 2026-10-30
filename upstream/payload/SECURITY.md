# Security & data handling

A one-pager for the customer security team reviewing whether Data
Apps is safe to install. Pair with `PRIVACY.md` (no telemetry
statement) and `docs/architecture.md` (full data-flow diagram).

## Data stays in your Looker

There is no SaaS layer in front of your data. The runtime is a static
JS/CSS bundle hosted on Google Cloud Storage. Query execution happens
entirely inside your own Looker instance via the Looker Extension SDK.
Data Apps never sees your rows, your column values, or your LookML
model contents.

```
Looker tile  ─── Extension SDK ───►  your Looker API  ───►  your warehouse
     │
     └── imports its runtime from gs://canvas-dashboards-shared/looker-data-apps/versions/<version>/
         and vendored libraries from .../looker-data-apps/vendor/
```

Data App code (the JavaScript ES module that describes a dashboard) is stored
inside Looker as a Data App extension (`POST /data_app_extension`), and the
dashboard element references it as `extension_id: "db::<uuid>"`. No external
storage infrastructure to provision; Looker's existing folder and dashboard
permissions are the access boundary.

## Outbound network calls (full list)

At install and update:

- `dl.google.com/looker-data-apps/latest-version.txt` —
  a small text file naming the current release. Read by the install entry point,
  and daily (cached) by the version discovery check
  (`skills/toolkit-updater/tools/check-for-update.py`, carrying
  `User-Agent: looker-data-apps/<installed_version>`) to notify authors of toolkit
  updates. Can be disabled via `"update_check": false` in `data-apps-config.json`
  or `DATA_APPS_NO_UPDATE_CHECK=1`.
- `dl.google.com/looker-data-apps/install.sh` (along with versioned installers at
  `.../versions/<version>/install.sh`) — the install entry point and the versioned
  installer it delegates to. `self-update.sh` fetches the versioned one directly
  during an in-place devtools upgrade.
- `dl.google.com/looker-data-apps/versions/<version>/looker-data-apps.tar.gz` —
  the curated tarball with the skills, scripts, and runtime sources.
- `dl.google.com/looker-data-apps/CHANGELOG.md` —
  fetched on demand only when an update is found and presented for review.
- Your configured Looker base URL — to validate credentials, create Data App
  extensions, and publish dashboards.


At runtime, inside the Looker tile iframe:

- `storage.googleapis.com/canvas-dashboards-shared/looker-data-apps/versions/<version>/*` —
  the immutable runtime bundle (`data-app.js`, `data-app.css`).
- `storage.googleapis.com/canvas-dashboards-shared/looker-data-apps/vendor/*` —
  the vendored dependencies, shared by every version and never overwritten.
- **That is the whole list.** Every dependency — AG Grid, Highcharts and
  its modules, Lit, the Looker Extension SDK — is vendored on the same
  bucket, so the bundle host is the single trust root and the tile makes
  no third-party request at all.
- Your Looker instance — for `run_inline_query`, `dashboard`, and
  `dashboard_element` calls via the Extension SDK.

No analytics, no telemetry, no error reporting, no GA, no Sentry, no
Segment, no usage beacons. Verify in your browser's DevTools network
panel.

## Credential handling

Looker API credentials (`client_id`, `client_secret`) are written to
`./data-apps-config.json` on the customer's machine after bootstrap, with
owner-only permissions (`0600`). They
never leave it except to authenticate against the Looker instance you
configured. If you keep the installation inside a version-controlled
directory, exclude `data-apps-config.json` and `backups/` yourself — the
toolkit ships no `.gitignore`, and `backups/toolkit/` retains copies of the
credential file from previous versions. It is read by:

- `serve.py` — the local preview server, server-side only. The browser
  never sees the secret; the preview server proxies inline-query
  requests through `/api/query`.
- `scripts/verify-install.py` — to confirm the instance can publish, by
  creating a temporary inline extension and deleting it again.
- `skills/data-app-publisher/tools/publish-data-app.py` — to create
  the Data App extension and dashboard.

The credentials are not transmitted to Google Cloud Storage, to
anthropic.com, to any analytics service, or to any third party.
**They are used only against the Looker base URL the customer
configured.**

The preview server binds to `127.0.0.1` by default (`serve.py --host
0.0.0.0` opts into LAN exposure if needed). On the default binding the
proxy is not reachable from other devices, even on the same Wi-Fi.

## Data App definition trust model

This is the one bit of the security model worth being explicit about.

A Data App definition is a JavaScript ES module. Looker serves the app
to the tile frame directly as an ES module, so the module's own code — and
any CSS it renders — executes in the tile's context.

That module runs inside Looker's sandboxed extension iframe: an opaque
origin, so `localStorage` and `sessionStorage` throw and `window.open`
returns null, with network access mediated by the Extension SDK rather
than reachable directly. Those are browser-enforced boundaries, not
conventions — but they constrain reach, not intent: within the tile, the
module can do anything JavaScript can do with the data the SDK returns.

**Access Boundary.** The access boundary is Looker's existing
dashboard author permissions (`save_content`, `save_dashboards`, `access_data`) — the `/data_app_extension`
endpoint server-fixes entitlements and mount points, preventing client-side
privilege escalation. We rely on Looker's enforcement of that boundary.

The same trust model applies to the `data-app-creator` and `data-app-publisher`
skills. The skills run on the customer's authoring machine, authenticate
against Looker with the customer's own API key, and produce no special
escalation.

## What we audit before shipping a new runtime

Before publishing a new runtime release to `gs://canvas-dashboards-shared/looker-data-apps/versions/<version>/`:

- Grep for new `console.log` writes. Diagnostic surfaces are gated behind
  `?debug=1` or `localStorage.dataAppsDebug`. Runtime errors are the one
  deliberate exception: the error message always reaches the console, while
  the structured payload (query + rows) is gated in a tile and on in local
  preview.
- Grep for new outbound URLs. The tile should reach the bundle host and
  your Looker instance, nothing else.
- Confirm no third-party CDN crept back into the runtime or the preview
  (`tests/unit_runtime.test.js` fails if one does).

## Reporting a security issue

Contact your Google representative directly. During private preview
there is no public issue tracker.

---

## Local toolkit

Your Looker API credentials (client ID and client secret) are stored locally in the `data-apps-config.json` file at the install root, which bootstrap creates with owner-only permissions (`0600`), and `backups/toolkit/` retains copies of it from the versions you upgraded away from. The toolkit does not ship a `.gitignore`: if you keep the installation inside a git repository, exclude `data-apps-config.json` and `backups/` yourself.

## Data Handling
- **Credentials:** Your API keys are only used to authenticate your local session against the Looker instance you specify.
- **Third-Party Services:** No credentials are ever sent anywhere but your
  Looker instance, and the toolkit contains no telemetry, analytics, or
  error reporting of any kind. All API interactions happen directly between
  your machine and your Looker instance.
- **What the AI agent sees:** authoring runs inside an AI coding agent, and
  what that agent reads goes to its model provider (Anthropic, Google, or
  whoever you have configured) under their terms, not ours. That includes
  LookML metadata, and — deliberately — **small samples of real data**:
  `explore-model.py --values` lists up to 50 distinct values of a dimension
  so a filter dropdown is built from what is actually in the column,
  `--sample` shows five rows, and `--probe` shows one value per field. If
  you ask the agent to look at a rendered app, the screenshot contains
  whatever the app is displaying. None of this is required — the flags are
  opt-in per command — but it is on by design where it is, because an agent
  that guesses filter values ships filters that are silently wrong.
  **The runtime itself sends query results nowhere but your browser.**
- **Inline extensions:** The tile host is stored as an inline extension via the API. Nothing is written to a LookML project or a dev workspace, and no IDE deploy is involved. Installing or updating it needs an API user with dashboard author permissions (`save_content`, `save_dashboards`, `access_data`); entitlements are fixed by the server rather than declared in `publish-data-app.py`, and are limited to three Core API methods and the runtime bundle host.
