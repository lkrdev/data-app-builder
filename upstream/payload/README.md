# Looker Data Apps

A code-first, freeform-layout application format for Looker, plus an
AI authoring skill (`data-app-creator`) that turns natural-language
prompts into published Data Apps in your Looker instance.

## Install

If you reached this directory by running `install.sh` or `install.py`, you're
already on the install path -- `python3 scripts/bootstrap.py` (or `python scripts\bootstrap.py` on Windows) continues
from here.

For a fresh install on a new machine:

**macOS / Linux:**
```bash
bash <(curl -fsSL https://dl.google.com/looker-data-apps/install.sh)
```

**Windows (`cmd.exe` / PowerShell) or cross-platform Python:**
```cmd
curl.exe -fsSL https://dl.google.com/looker-data-apps/install.py | python
```

Step-by-step walkthrough: [docs/customer-quickstart.md](docs/customer-quickstart.md).

**For AI Agents:**
When asked to create, edit, or publish a Data App, you must read and follow the strict instructions located in `skills/data-app-creator/SKILL.md` before taking any action.

## Layout (after install)

```
~/looker-data-apps/
├── apps/                       your Data Apps -- one folder per app, each with an app.js
├── backups/                    app snapshots and temporary update rollback copies
├── runtime/                    local runtime bundle (data-app.js, data-app.css)
├── skills/data-app-creator/    the AI agent skill instructions & scripts
├── preview-server/             local preview server + app gallery
├── scripts/                    bootstrap, install check
└── data-apps-config.json       your Looker creds & settings (owner-only -- keep local)
```

Third-party libraries (Lit 3.3.1, Highcharts 11.4.8, AG Grid Community 31.3.4, and Looker Extension SDK 24.20.0) load automatically from `https://www.gstatic.com/looker-data-apps/vendor/` in both local preview and published Looker tiles. Local preview therefore requires internet access (or a reachable `browser_assets_url`).

Re-installing replaces everything except `apps/` and your `*.json` config,
so obsolete files from an older release are removed rather than left behind.
The installer never changes your apps.

## Previewing locally

Everything is a stdlib Python script -- **`make` is not required** and is not
a dependency of this project. On Windows, the Python entry points (`python scripts\bootstrap.py`,
`python skills\toolkit-updater\tools\self-update.py`) work directly in cmd.exe and PowerShell,
and `.sh` wrappers need Git Bash or WSL. (Use `python` or `py -3` wherever `python3`
is shown if `python3` is not on `PATH`.)

**Browse everything you have built.** Start the server with no arguments and
it opens the gallery: every app in `apps/`, searchable, newest
first, each card showing the app's title, description, path and when it last
changed.

```bash
make start
# or without make:
python3 preview-server/serve.py
```

**Open one app directly**, skipping the gallery:

```bash
make start ARGS=apps/<name>/app.js
# or background launcher (also accepts bare app name <name>):
python3 skills/data-app-previewer/tools/start-preview.py apps/<name>/app.js
```

**Stop it** when you're done -- it runs in the background on port 8765:

```bash
make stop
# or:
python3 skills/data-app-previewer/tools/stop-preview.py
```

Useful flags: `--no-open` starts the server without launching a browser, and
`--port N` moves it off 8765.

### The two preview modes

Opening an app from the gallery shows it the way a published Looker tile runs
it: isolated origin, strict script policy, no network access of its own. That
is what the app will actually look like once published.

That mode is faithful precisely because it is isolated -- which also means
devtools and automation cannot see inside it. If you (or an agent) need to
inspect the page, add `&inspect=1` to the preview URL. It mounts the app on an
ordinary same-origin page instead; the gallery does not link to it.

The gallery reads `apps/` from disk every time, so an app
appears as soon as its file exists. Titles and descriptions come from a short
header comment at the top of each `app.js`; there is no registry to update.

## Update

Re-run the install one-liner above. Your `data-apps-config.json` is preserved.


