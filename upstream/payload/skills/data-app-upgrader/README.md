# data-app-upgrader Skill

An AI authoring and migration skill that converts legacy HTML Looker Canvas Dashboards (`*.canvasdashboard.html`) into Data Apps (`apps/<name>/app.js`).

To upgrade an existing Lit app in `apps/`, use the `toolkit-updater` skill, which applies the Breaking entries in `CHANGELOG.md`.

## Usage

Ask your AI coding assistant (Claude Code, Antigravity, Cursor, etc.):

> Use the `data-app-upgrader` skill to upgrade `path/to/app.canvasdashboard.html` to a modern Lit Data App in `apps/my-app/app.js`.

See [SKILL.md](./SKILL.md) for detailed mapping tables, code templates, and verification guidelines.
