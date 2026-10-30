# Looker Data Apps

This directory is an installed Looker Data Apps environment. A **Data App** is a
code-first application for Looker, authored as a single self-contained ES module
in `apps/<name>/app.js` and published directly into Looker dashboard tiles.

## AI Agent Routing

This project uses a skill-based architecture. For all authoring, previewing,
and deployment workflows, **activate the appropriate skill in `skills/`** rather
than guessing or hand-crafting commands:

| Task / Intent | Skill to Load | What It Handles |
| --- | --- | --- |
| **Create or edit an app** | `skills/data-app-creator/SKILL.md` | Schema discovery, component selection, Lit templates, CSS grid, recipes, and tile sandbox safety (tools in `skills/data-app-creator/tools/`) |
| **Preview an app locally** | `skills/data-app-previewer/SKILL.md` | Starting/stopping local preview server and app gallery (tools in `skills/data-app-previewer/tools/`) |
| **Publish to Looker** | `skills/data-app-publisher/SKILL.md` | Publishing or updating extension tiles in Looker (tools in `skills/data-app-publisher/tools/`) |
| **Convert HTML dashboards** | `skills/data-app-upgrader/SKILL.md` | Converting legacy HTML Canvas Dashboards (`*.canvasdashboard.html`) into Data Apps |
| **Check or run updates** | `skills/toolkit-updater/SKILL.md` | Checking for toolkit updates, changelog narration, backing up, upgrading, and upgrading existing Lit apps from `CHANGELOG.md` (tools in `skills/toolkit-updater/tools/`) |

Detailed component properties, methods, and styling variables live in
`skills/data-app-creator/reference/LIT_DATA_APPS.md`, with pattern recipes in
`skills/data-app-creator/recipes/README.md`.

> [!TIP]
> Always load the respective `SKILL.md` before executing any commands. Tool scripts reside under `skills/<skill-name>/tools/` and are not located in the root directory.

<mandatory_rules>
### Strict Workspace Boundaries & Configuration Isolation

1. **Only Use `./data-apps-config.json` in the Current Directory**:
   - You MUST ONLY read, reference, or use `./data-apps-config.json` located directly at the root of this workspace.
   - NEVER search parent directories, the user's home directory (`~`), or other project locations for a `data-apps-config.json`.
   - NEVER copy, import, or pass credentials from any external configuration file.
   - If `./data-apps-config.json` is missing or invalid in this directory, DO NOT attempt to borrow credentials from elsewhere. Stop and instruct the user to run `bash scripts/bootstrap.sh` to configure this install.
2. **Customer Code Location**:
   - All customer apps belong in `apps/<name>/app.js`.
   - Never edit internal engine files in `runtime/` or `skills/` unless explicitly instructed.
3. **Single-File ES Modules**:
   - Every app must be self-contained in its single `app.js`.
   - Do not import local helper files (e.g. `./utils.js`); only `data-app.js` and `lit.mjs` are rewritten to hosted bundle assets upon publish.
4. **Credential Privacy**:
   - `data-apps-config.json` contains sensitive API credentials. Keep it local; never log, commit, or expose it.
</mandatory_rules>
