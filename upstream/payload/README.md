# Looker Data Apps

A code-first, freeform-layout application format for Looker, plus an
AI authoring skill (`data-app-creator`) that turns natural-language
prompts into published Data Apps in your Looker instance.

## Install

If you reached this directory by running `install.sh`, you're
already on the install path -- `bash scripts/bootstrap.sh` continues
from here.

For a fresh install on a new machine:

```bash
bash <(curl -fsSL https://dl.google.com/looker-data-apps/install.sh)
```

Step-by-step walkthrough: [docs/customer-quickstart.md](docs/customer-quickstart.md).

**For AI Agents:**
When asked to create, edit, or publish a Data App, you must read and follow the strict instructions located in `skills/data-app-creator/SKILL.md` before taking any action.

## Layout (after install)

```
~/looker-data-apps/
├── apps/                       your Data Apps -- one folder per app, each with an app.js
├── skills/data-app-creator/    the AI agent skill instructions & scripts
├── runtime/                    the Lit component library the apps import
├── preview-server/             local preview server + app gallery
├── scripts/                    bootstrap, install check
└── data-apps-config.json       your Looker creds & settings (owner-only -- keep local)
```

Re-installing replaces everything except `apps/` and your `*.json` config,
so obsolete files from an older release are removed rather than left behind.

## Previewing locally

Everything is a stdlib Python script -- **`make` is not required** and is not
a dependency of this project. (On Windows, run `.sh` scripts in Git Bash or WSL,
and use `python` or `py -3` wherever `python3` is shown if `python3` is not on `PATH`.)

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


