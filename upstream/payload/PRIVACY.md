# Privacy & Data Handling

The short version: **Data Apps run as native extensions within your Looker instance. Data Apps do not collect, transmit, or store third-party telemetry or analytics.**

## What that means in practice

- **No third-party analytics SDKs.** No Segment, Mixpanel, Amplitude, PostHog,
  Google Analytics, or anything equivalent.
- **No third-party error reporting services.** No Sentry, Rollbar, Bugsnag, or
  similar external collectors.
- **Looker Platform Diagnostics & Error Telemetry:** When running embedded in a
  Looker dashboard tile, Data Apps use Looker's standard Extension SDK error API
  (`extensionSDK.error()`) to report tile lifecycle and unhandled runtime errors
  back to your Looker host. This feeds standard Looker instance error logging and
  health metrics (`logException`), allowing instance administrators and Looker support
  to monitor broken tiles and connection issues.
- **Product Usage & Feature Adoption Telemetry:** In line with standard Looker
  platform product usage reporting (Pinger), basic tile load and connection status
  events (`event_action: load`, status: success/failure) are tracked under the
  `data_app` component label. This allows Looker product and engineering teams to
  measure feature adoption, reliability, and preview stability across customer instances.
- **Zero Customer Data in Telemetry:** Both diagnostic error reports and product
  usage metrics contain only sanitized system tags and error messages.
  Query payloads, LookML definitions, warehouse data rows, and widget titles are
  strictly excluded and never transmitted in telemetry.
- **No external phone-home.** Neither the runtime nor the devtools POST to any
  service controlled by third-party vendors. The only network calls made are:
  - **Tile runtime calls:** (a) to your own Looker instance for query execution
    and Extension SDK communication, and (b) to `storage.googleapis.com` to load
    the runtime bundle itself (which includes vendored copies of dependencies
    and the Looker Extension SDK).
  - **Local devtools calls:** (c) daily, cached version discovery checks against
    `dl.google.com` by `check-for-update.py` on the author's machine
    (querying `looker-data-apps/latest-version.txt` carrying
    `User-Agent: looker-data-apps/<installed_version>`) to notify authors of
    toolkit updates (can be disabled via `"update_check": false` in
    `data-apps-config.json` or `DATA_APPS_NO_UPDATE_CHECK=1`). `CHANGELOG.md` is
    fetched on demand only when an update is found and presented to the author.
    Full list in `SECURITY.md`.
- **No customer data in the runtime bundle's logs.** The runtime is
  static JS hosted in a public-read GCS bucket; we have no way to
  observe what each customer's instance fetches beyond standard GCS
  access logs (which see only IP + path + status, not query payloads).

## What is stored locally on your machine

The toolkit writes:

- `data-apps-config.json` — your Looker base URL, API
  `client_id`, API `client_secret`, and publish settings.
- `.update-check.json` — timestamp, latest version, and dismissal
  state of the daily, cached version discovery check.
- `backups/` — local snapshot backups of the toolkit (`backups/toolkit/`)
  and customer apps (`backups/apps/`) created prior to upgrades or migrations.
  Toolkit backups contain a copy of `data-apps-config.json`, credentials included.
- `.update.lock` — ephemeral concurrency lockfile preventing
  simultaneous toolkit updates.
- AI Agent configurations (e.g. `.claude/skills/data-app-creator`)
  which register the skill framework locally within the project directory.
- Your app source (`apps/<name>/app.js`) — on publish, the toolkit rewrites the
  JSDoc header of the file you are publishing to record `@created-by` / `@created-at`
  (and `@updated-by` / `@updated-at` on subsequent updates, reflecting the Looker
  user the API credentials authenticate as — display name, full name, or email
  when neither is set) and `@looker-instance` (the base URL you configured), so a
  published app can be traced back to its source.


None of these files are transmitted off your machine. You can delete
them at any time.

## What is stored in your Looker

- For each dashboard you publish: a Looker Data App extension (`POST /data_app_extension`)
  holding the app's JavaScript code, and a dashboard element referencing that
  extension (`extension_id: "db::<uuid>"`). This is normal Looker dashboard and
  extension data, subject to your normal Looker access controls and retention.
- No LookML project is created, and nothing is written to your dev workspace.
- The published app code carries that same `@created-by` / `@updated-by` / `@looker-instance`
  JSDoc header (including the author's name or email), so it is visible to anyone
  who can read the extension row.

## Verifying

Open DevTools → Network tab while viewing a Data App tile.
Confirm requests go only to: your Looker host and the runtime bundle's GCS path.
Filter on the network panel by domain; there should be nothing else.

---

This project is built with privacy by default. 

## Telemetry & Tracking
Standard Looker product usage telemetry (Pinger) and platform instance error logging apply when running inside Looker (as with all native Looker dashboard elements and extensions). No third-party tracking or external commercial analytics tools are built into these tools.

## LLM Usage
When using an AI agent (like Claude Code, Antigravity, or Cursor) in conjunction with these scripts, please be aware that the AI agent itself sends what it reads to its respective backend (e.g. Anthropic or Google), under that provider's terms.

That includes your code, your prompts and your LookML schema — and, where you use them, **small samples of real data**: `explore-model.py --values` lists up to 50 distinct values of a dimension, `--sample` shows five rows, `--probe` shows one value per field, and a screenshot of a rendered app contains whatever that app is displaying. These are opt-in per command and exist because an agent that guesses filter values ships filters that are silently wrong.

The scripts and binaries in this repository do not independently intercept or transmit any data, and the runtime sends query results nowhere but your own browser.

We recommend reviewing the privacy policy of the specific AI agent you choose to use with this repository.
