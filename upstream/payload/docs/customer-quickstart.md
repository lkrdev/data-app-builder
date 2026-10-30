# Customer quickstart

End-to-end: from zero to a Data App rendering in your Looker instance. About 10 minutes the first time.

## Prerequisites

- A **Looker instance** with the Extension Framework and `inline_extensions` feature enabled.
- A **Looker API client_id + client_secret** with dashboard author permissions: `access_data`, `explore` (on the models used), `see_user_dashboards`, `save_content`, `save_dashboards`, plus edit access on the publish folder.
  Find or create one at `<your-looker>/admin/users` → pick a user → **Edit API keys**.
- **An AI coding agent** (like Antigravity, Claude Code, or Cursor) installed and authenticated.
- **Python 3.9+** (`python3`, `python`, or `py -3` on `PATH`).
- macOS, Linux, or Windows (via Git Bash or WSL).

## Step 1 — Install

```bash
bash <(curl -fsSL https://dl.google.com/looker-data-apps/install.sh)
```

This downloads the latest curated payload into `~/looker-data-apps`
(prompts if you want a different location), verifies its SHA-256
checksum against the one published next to it, and immediately runs
the bootstrap walkthrough.

Re-running the installer later is the upgrade path: your
`data-apps-config.json` is preserved, and bootstrap shows each existing config
with a keep/re-enter prompt instead of asking everything again.

Your AI agent also checks for newer versions of the toolkit at most once a day,
cached locally (at most one small request per day). If a newer release
is available, the agent will present the changelog highlights and offer a safe
in-place upgrade. You can also run the check manually at any time:
`python3 skills/toolkit-updater/tools/check-for-update.py --force`.
To opt out, set `"update_check": false` in `data-apps-config.json` or export
`DATA_APPS_NO_UPDATE_CHECK=1`.

You'll be prompted for:

1. **Looker instance URL** — e.g. `https://mycompany.looker.com`. Paste
   it straight from your browser; any path is stripped for you.
2. **Looker API client_id and client_secret** — written to
   `data-apps-config.json` at the repo root, with owner-only permissions.
   The toolkit ships no `.gitignore`; if you keep the installation in a git
   repository, exclude `data-apps-config.json` and `backups/` yourself.
3. **Looker folder ID** — where new dashboards land when you publish.
   `1` is the default Shared folder.

You are not asked for a LookML project or a default model — no project
is created, and the agent discovers models from your instance when it
builds an app.

What it does:

- Symlinks `skills/data-app-creator/` into your AI agent's skills directory.
- Writes `data-apps-config.json`.
- Checks that your instance can actually publish, by creating a
  temporary inline extension, reading it back, and deleting it.

## Step 2 — Author your first Data App

Open your AI agent in `~/looker-data-apps` (or anywhere). Ask:

> Use the data-app-creator skill to create a sales Data App against
> the basic_ecomm model with a monthly trend, top users by spend, and
> total revenue.

The agent reads `data-apps-config.json` for your defaults,
verifies field names in your model via `explore-model.py`,
writes the app to `apps/<name>/app.js`, opens
`http://localhost:8765/preview-server/?app=apps/<name>/app.js`
in your browser for preview, iterates with you in conversation, and
finally runs `publish-data-app.py` when you say it's ready.

To browse everything you have built rather than one app, start the preview
server with no arguments and it opens the app gallery:

```bash
make start                                                # gallery
# or without make:
python3 preview-server/serve.py                           # gallery
# or background launcher:
python3 skills/data-app-previewer/tools/start-preview.py  # gallery

make stop                                                 # stop it
# or:
python3 skills/data-app-previewer/tools/stop-preview.py   # stop it
```

See the *Previewing locally* section of [README.md](../README.md) for the
gallery's two preview modes and when to use each.

## Troubleshooting

- **The install check says the `inline_extensions` feature is off** —
  publishing needs it, and this toolchain has no fallback. Ask whoever
  administers the instance to enable it, then re-run
  `python3 scripts/verify-install.py`.
- **The install check says the API user isn't allowed to use
  `/data_app_extension`** — that's a role, not the feature. Open
  `<your-looker>/admin/roles`, find the role attached to the API user,
  and give it dashboard author permissions (`save_content`, `save_dashboards`, and `access_data`; the full toolkit also needs `explore` and `see_user_dashboards`).
- **The install check says the tile host "stores but will not serve"** —
  the extension was written and the bundle route won't return it. That
  is a server-side fault on the instance, not a config problem; its
  logs will have the exception.
- **`data-apps-config.json` has wrong creds and I can't get past the
  install step** — re-run `bootstrap.sh`; it shows the stored values
  and asks whether to keep or re-enter them.
- **Publishing fails with an `extension_id` error** — the Data App
  extension the publish just created has gone missing. Re-run
  `publish-data-app.py`; it recreates it. If it keeps happening, run
  `python3 scripts/verify-install.py` for a definitive check.

## Updating the runtime

Runtime releases are published to immutable versioned paths in the shared bucket
(`…/apps/versions/<version>/assets`).

**Immutable version pinning by default.** Every app published to Looker is pinned
to the immutable versioned bundle of the runtime active when published. Future
releases and deployments do not alter or affect existing apps in Looker. To
update an existing published app to a newer runtime, upgrade your local install
and re-publish with `--dashboard-id <id>`.

## Going deeper

- `docs/architecture.md` — how the pieces fit (Data App extensions,
  runtime architecture, authoring tools).
- `skills/data-app-creator/README.md` — what the skill does, what
  it doesn't, where the v2 migrator design lives.
