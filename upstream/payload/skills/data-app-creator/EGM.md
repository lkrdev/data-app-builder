# skills/data-app-creator

## Overview
Skill package for authoring, styling, schema-exploring, safety-checking, and verifying Looker Data Apps (`apps/<name>/app.js`), combining skill instructions, reference recipes, and Python CLI tools.

## Subdirectories & Boundaries
- [SKILL.md](./SKILL.md) - Skill authoring workflow, schema discovery, and verification instructions.
- [tools](./tools/EGM.md) - Python CLI utilities (`check-credentials.py`, `check-tile-safety.py`, `explore-model.py`, `extract-palette.py`, `get-recipe.py`, `get-timestamp.py`, `verify-app.py`) for credential checks, LookML schema exploration, tile safety linting, palette extraction, and 4-stage app verification.
- `recipes/` and `reference/` - Markdown pattern recipes and Lit Data App component documentation.
