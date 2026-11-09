# skills/data-app-publisher

## Overview
Skill package for statically extracting widget queries and publishing or updating Data Apps as Looker extension dashboard tiles.

## Subdirectories & Boundaries
- [SKILL.md](./SKILL.md) - Publishing and in-place dashboard update workflow instructions.
- [tools](./tools/EGM.md) - Static widget query extractor (`widget_extractor.py`) and Looker API 4.0 publisher (`publish-data-app.py`) handling JSDoc metadata, query registration, bundle rewriting, and `/data_app_extension` + dashboard lifecycle management.
