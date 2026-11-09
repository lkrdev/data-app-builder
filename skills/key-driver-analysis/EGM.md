# Key Driver Analysis (`skills/key-driver-analysis`)

## Overview

`skills/key-driver-analysis` packages the Looker Key Driver Analysis (KDA) agent skill and its Monty-sandbox execution toolkit (`kda_toolkit.py`) for explaining period-over-period or cohort metric shifts across Explores, Queries, Looks, Dashboards, and Conversational Analytics Conversations.

## Subdirectories & Boundaries

- `scripts`: [./scripts/EGM.md](./scripts/EGM.md) - Monty-sandbox KDA toolkit (`kda_toolkit.py`) exporting `resolve_source`, `inspect_explore_for_kda`, `decompose_measure`, `run_kda`, `drill_top_driver`, `analyze_target`, and `print_kda_summary`.
- `SKILL.md`: [./SKILL.md](./SKILL.md) - Skill instructions, API schemas, and `lkr code-mode sandbox` invocation workflow for Key Driver Analysis.
