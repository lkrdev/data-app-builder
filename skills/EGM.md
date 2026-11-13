# Skills (`skills`)

## Overview

`skills` houses Looker analytical and engineering skill bundles distributed with Data App Builder, grouping executable helper toolkits alongside `SKILL.md` workflow specifications for Key Driver Analysis, Looker Dashboards, Explore Field Profiling, and Looker Project Onboarding.

## Subdirectories & Boundaries

- `data-apps`: [./data-apps/SKILL.md](./data-apps/SKILL.md) - Repackaged Looker Lit Data Apps Studio skill (`VERSION`, `reference/LIT_DATA_APPS.md`, `recipes/*.md`), synced from the upstream Looker Data Apps installer via `.agents/skills/data-apps-sync/scripts/sync_data_apps.py` (`npm run sync-upstream`).
- `key-driver-analysis`: [./key-driver-analysis/EGM.md](./key-driver-analysis/EGM.md) - Looker Key Driver Analysis (`kda_toolkit.py`) blueprint and `lkr code-mode sandbox` root-cause analysis skill.
- `looker-dashboard`: [./looker-dashboard/SKILL.md](./looker-dashboard/SKILL.md) - Unified Looker Dashboarding skill (`upsert_udd`, `upsert_lookml_dashboard`, `reflow_24col`, `pin_to_board`, `schedule_dashboard`, `emit_native_bundle`, 24-column layouts, and visualization specs).
- `looker-field-profiler`: [./looker-field-profiler/SKILL.md](./looker-field-profiler/SKILL.md) - Explore field profiling skill using `profile_fields` to measure cardinality, quantiles, temporal spikiness, `profile:*` tags, and LookML refinement snippets (merged at runtime with `.agents/skills/looker-field-profiler/scripts/` via `SANDBOX_AGENT_SKILL_FILES`).
- `looker-field-profiler/sub-skills/scratch-search`: [./looker-field-profiler/sub-skills/scratch-search/SKILL.md](./looker-field-profiler/sub-skills/scratch-search/SKILL.md) - Per-model `_field_value_search_<model>` `UNION ALL` Persistent Derived Table and search index generator across 5 SQL dialects (`scripts/scratch_search.py` shipped from `.agents/skills/looker-field-profiler/sub-skills/scratch-search/scripts/`).
- `looker-project-onboarding`: [./looker-project-onboarding/SKILL.md](./looker-project-onboarding/SKILL.md) - End-to-end Looker Project Onboarding workflow from database connection discovery through bare Git setup, Bronze/Silver views, dashboarding, and Metric Selector Data App creation.
