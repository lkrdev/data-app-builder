# data-app-creator skill

A focused authoring skill for AI agents (Antigravity, Claude Code, Cursor, etc.)
for creating new Data Apps against a Looker customer's LookML models.

See `SKILL.md` for the core system instructions and trigger prompt the agent reads.

## Layout

```
SKILL.md              Trigger + authoring run-order the agent follows
config.example.json   Template for the customer's local config
recipes/              Chart-options snippets for common patterns
reference/            Component API reference and architectural guides
tools/
  check-credentials.py  Preflight Looker direct credentials and verify API connectivity
  explore-model.py      Inspect LookML models, explores, and run preflight checks
  extract-palette.py    Sample a palette from a reference image
  get-recipe.py         Batch retrieve chart and layout recipe markdown
  get-timestamp.py      Output current system timestamp in standard ISO local format
  check-tile-safety.py  AST linter for tile sandbox constraints
  verify-app.py         Post-creation QA & multi-tier offline verification
```

## Progressive Disclosure & Chaining

1. **`data-app-creator`** authors the ES module Lit component in `apps/<name>/app.js`.
2. Automatically chains to **`data-app-previewer`** to verify and preview locally.
3. Once reviewed and confirmed by the user, hands off to **`data-app-publisher`** for deployment.

## Configuration

Run `scripts/bootstrap.sh` once per machine. It creates `data-apps-config.json`
at the repo root with the customer's Looker instance URL, API credentials,
target publish folder, and runtime bundle URL.

Model discovery is performed dynamically via `explore-model.py --list-models`.
If specific defaults (`default_model`, `default_explores`) are set in
`data-apps-config.json`, the agent will use them as sensible starting points.
