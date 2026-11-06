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
| **Create or edit an app** | `skills/data-apps/SKILL.md` (`skills/data-app-creator/SKILL.md`) | Schema discovery, component selection, Lit templates, CSS grid, recipes, and tile sandbox safety (tools in `skills/data-app-creator/tools/`) |
| **Preview an app locally** | `skills/data-app-previewer/SKILL.md` | Starting/stopping local preview server and app gallery (tools in `skills/data-app-previewer/tools/`) |
| **Publish to Looker** | `skills/data-app-publisher/SKILL.md` | Publishing or updating extension tiles in Looker (tools in `skills/data-app-publisher/tools/`) |
| **Convert HTML dashboards** | `skills/data-app-upgrader/SKILL.md` | Converting legacy HTML Canvas Dashboards (`*.canvasdashboard.html`) into Data Apps |
| **Check or run updates** | `skills/toolkit-updater/SKILL.md` | Checking for toolkit updates, changelog narration, backing up, upgrading, and upgrading existing Lit apps from `CHANGELOG.md` (tools in `skills/toolkit-updater/tools/`) |
| **Data Investigator narrative app** | `skills/data-investigator/SKILL.md` | Point-in-time root-cause narrative Data Apps (`doc` / `slides`) with fixed date ranges (`YYYY-MM-DD to YYYY-MM-DD`) and sequential evidence chapters |
| **Key Driver Analysis (KDA)** | `skills/key-driver-analysis/SKILL.md` | Running, explaining, and recursively drilling through Looker Key Driver Analysis (`run_key_driver_analysis`) via `skills/key-driver-analysis/scripts/kda_toolkit.py` (`resolve_source`, `inspect_explore_for_kda`, `analyze_target`, `run_kda`, `drill_top_driver`, `print_kda_summary`) |
| **Create or update Looker Dashboards** | `skills/looker-dashboard/SKILL.md` | Unified Looker Dashboarding skill: `profile_fields` distribution discovery, 1-call Code Mode (`upsert_udd`, `upsert_lookml_dashboard`, `reflow_24col`, `pin_to_board`, `schedule_dashboard`, `emit_native_bundle`), 24-column `newspaper` layout, native `tabs:`, 4 canonical archetypes, 22 visualization types (`y_axes[].series` objects), Highcharts `advanced_vis_config`, and `lookml-dashboard-to-query` SQL verification |
| **Profile Explore fields (`profile_fields`)** | `skills/looker-field-profiler/SKILL.md` (`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`) | Profiling `string`, `number`, `yesno`, and `datetime` distributions, cardinality, temporal spikiness (`stats.spikiness`), `profile:*` semantic tags, `curation.lookml_snippet` refinements via `profile_fields`, and per-model `_field_value_search_<model>` search index PDTs (`scripts/scratch_search.py`) |
| **Onboard a new Looker project** | `skills/looker-project-onboarding/SKILL.md` | End-to-end Looker Project Onboarding from an existing database connection: connection & table reachability check (`/admin/connections`), `snake_case` `project_name` normalization, bounded `5 × 5` schema/table discovery (`/sql`), `dev` workspace bare Git project & model creation, 5-layer measure synthesis (`<LOOKML_BUNDLE>`), and optional `_field_value_search_<project_name>` search index scaffolding |
| **Agentic LookML & Medallion modeling** | `skills/agentic-lookml/SKILL.md` | Unified LookML engineering, 14 SQL-to-LookML pattern playbooks (`skills/agentic-lookml/references/01..14-*.md`, `measures-and-sql-functions.md`), and Bronze/Silver/Gold Medallion semantic modeling |
| **End-to-end SQL-to-LookML PR workflow** | `skills/agentic-lookml-workflow/SKILL.md` | Offline SQL parsing, branch init, Bronze view generation, LookML data tests, parity pre-gate (`skills/agentic-lookml-workflow/scripts/*.py`), and PR creation |
| **Scaffold Bronze views from DB tables** | `skills/generate-view-from-table/SKILL.md` | Detecting missing/stale Bronze views and generating 1:1 physical `bronze/:table.view.lkml` files (`skills/generate-view-from-table/scripts/generate_bronze_view.py`) |
| **Profile Explore fields & distributions** | `skills/looker-field-profiler/SKILL.md` (`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`) | Profiling Looker Explore dimensions and measures (`profile_fields`) for cardinality, quantiles, temporal spikiness, LookML refinement snippets, and `_field_value_search_<model>` search index PDTs (`scripts/scratch_search.py`) |
| **Curate LookML field descriptions & tags** | `skills/lookml-field-curation/SKILL.md` | Authoring high-signal `description:`, `tags:`, `hidden:`, and `suggestable:` refinements (`skills/lookml-field-curation/scripts/profile_string_fields.py`, `enrich_partition_clustering.py`, `scratch_search.py`) |
| **LookML syntax, views, explores & tests** | `skills/lookml/SKILL.md` | Complete LookML reference suite: `skills/lookml-model/SKILL.md`, `skills/lookml-view/SKILL.md` (`references/derived_table.md`), `skills/lookml-explore/SKILL.md` (`references/joins.md`, `advanced.md`), `skills/lookml-fields/SKILL.md` (`references/*.md`), `skills/lookml-refinements/SKILL.md`, `skills/lookml-tests/SKILL.md`, `skills/lookml-liquid/SKILL.md`, `skills/lookml-sets/SKILL.md`, `skills/lookml-access-grants/SKILL.md`, `skills/lookml-ojof/SKILL.md`, `skills/lookml-modeling-guidelines/SKILL.md` |
| **Looker filters & table calculations** | `skills/looker-filters/SKILL.md` & `skills/looker-expressions/SKILL.md` | Looker filter expressions, `matches_filter`, Custom Fields, Table Calculations (`references/excel-equivalents.md`), and `.test.lkml` `assert:` expressions |
| **Looker Code Mode & project helpers** | `skills/lkr-code-mode/SKILL.md` & `skills/lkr-project-helper/SKILL.md` | Monty Python sandbox SDK recipes (`skills/lkr-code-mode/scripts/*.py`), bare Git setup, SQL-to-view generation, and UDD dashboard migration (`skills/lkr-project-helper/scripts/*.py`) |
| **LookML architecture, review & audits** | `skills/looker-architect/SKILL.md`, `skills/lookml-reviewer/SKILL.md`, `skills/looker-audit/SKILL.md`, `skills/looker-performance-optimizer/SKILL.md` | Enterprise LookML scaffolding (`looker_scaffold.py`, `references/*.md`), LAMS style review, instance governance audits, and PDT/query performance optimization |
| **Create & sync LookML dashboards** | `skills/creating-looker-dashboard/SKILL.md` | Authoring `.dashboard.lookml` files, importing to UDDs, and syncing iterative layout/tile refinements |

Detailed component properties, methods, and styling variables live in
`skills/data-app-creator/reference/LIT_DATA_APPS.md`, with pattern recipes in
`skills/data-app-creator/recipes/README.md`.

> [!TIP]
> Always load the respective `SKILL.md` before executing any commands. Tool scripts reside under `skills/<skill-name>/tools/` and are not located in the root directory.

## Sandbox CLI Bootstrap (`uv` + `lkr-dev-cli`)

New Antigravity sandbox environments (`user_env:${me.id}`) bootstrap `uv` and a pinned release of `lkr-dev-cli` (`0.0.66`) into `/usr/local/bin` via `/workspace/bootstrap_lookml.py` so both persist in the container's GCS overlay snapshot (`{env_id}/snapshot.tar`):
1. `pip install --break-system-packages --quiet uv` (if `uv` is not on `PATH`).
2. `UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.66"`.

## Conversation Labeling (Stateless Side-Request)

When a prompt starts with or contains `[CONVERSATION_LABEL_REQUEST]`, you are handling an out-of-band, stateless conversation labeling request:
1. Return **only** a single-line concise title of **3–6 words** in plain text (no quotes, no markdown formatting, no trailing period, no tags).
2. **Never** call `lookup_skill`, `code_execution`, `run_looker_codemode`, or read any `.agents/skills/*` file.

## Dynamic Starter Prompts (Stateless Side-Request)

When a prompt starts with or contains `[STARTER_PROMPTS_REQUEST]`, you are handling an out-of-band, stateless starter prompt synthesis request:
1. Inspect the active `useCase`, permitted use cases, discovered LookML explore/field metadata (`model::explore`, dimensions, measures), and recent user content (`content_summary` dashboards and Looks).
2. Do **not** call any tools (`lookup_skill`, `code_execution`, `run_looker_codemode`) or read any skill files.
3. Reply with **only** 3–4 concise, tailored starter chips wrapped in `<STARTER_PROMPTS>[...]</STARTER_PROMPTS>` JSON (`[{"id":"...","label":"3-6 word plain text without emojis","prompt":"1-sentence actionable prompt","useCase":"app|dashboard|conversational-analytics|lookml|health-check|tile"}]`).

## Use Case Auto-Classification (Turn 1 Routing)

When handling a Studio turn (`useCase="auto"`), classify the current turn's prompt into **one** of the user's permitted Studio use cases and emit `<USE_CASE>...</USE_CASE>` at the start of your response before executing the matching workflow:

| Use Case ID | Label | Routing Intent & Trigger Signals |
| --- | --- | --- |
| `app` | **Data App** | Custom interactive Lit web component Data App (`apps/<name>/app.js`), metric switchers, custom UI layouts, `<app-kpi>`, `<app-chart>`, `<app-grid>`, or screenshot-to-app conversion |
| `dashboard` | **Content Studio** | Native Looker User-Defined Dashboards (UDDs), LookML Dashboards (`.dashboard.lookml`), Saved Looks, Boards, or Scheduled Plans (`skills/looker-dashboard/SKILL.md`, `skills/looker-field-profiler/SKILL.md`, `skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`, `_field_value_search_<model>`, `upsert_udd`, `upsert_lookml_dashboard`, `pin_to_board`, `schedule_dashboard`) |
| `lookml` | **Agentic LookML** | Authoring or refactoring LookML models, views, explores, refinements (`.lkml`), SQL-to-LookML parity, field profiling/curation/descriptions (`skills/looker-field-profiler/SKILL.md`, `skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`, `_field_value_search_<model>`), or LookML data tests (`.test.lkml`) |
| `health-check` | **Health Check** | 3-Pillar Looker & BigQuery Health Check audit (System Activity Pillar 1, LookML 0–4 Transcriber Rubric Pillar 2, BigQuery `INFORMATION_SCHEMA` Pillar 3, `TECHNICAL_DESIGN_DOCUMENT.md`) |
| `tile` | **Python Tile** | Custom `LkrCodeMode` Monty Python script tile (`obj_script_<id>`, `vars.dashboard_filters`, custom Python table/markdown/dict output, or script scheduler) |
| `conversational-analytics` | **Conversational Analytics** | Ad-hoc natural-language analytical Q&A, explore data questions, KPI lookups, or trend explanations without building a persistent app or LookML file |

- **Open-Ended Analytical Questions & Conversational Analytics**: When a model exposes `explore: _field_value_search_<model>` (`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`), Code Mode and CA agents can query `_field_value_search_<model>` (`filters: {"_field_value_search_<model>.field_value": "%<term>%"}`) to resolve ambiguous or misspelled string literals to their exact `(explore_name, field_name, field_value)` in a single indexed query, and when provisioning/configuring a Looker CA agent, include `<model>::_field_value_search_<model>` in the agent's explores.

Always restrict your `<USE_CASE>` choice to the allowed modes list provided in the prompt (`Allowed use cases for this user: [...]`). Emit `<USE_CASE>...</USE_CASE>` for the current turn's target workflow on every turn so Studio routes dynamically and appends or updates the resulting item in the conversation's `contentItems` tabs.

## Conversational Analytics Isolated Sub-Agent Router (Stateless Agent Selection)

When a prompt starts with or contains `[CA_AGENT_SELECTION_REQUEST]`, you are running as a **stateless isolated sub-agent** (`previous_interaction_id` omitted, `tools: []`) to match the user's question to the single best Looker Conversational Analytics (CA) agent without polluting the main conversation context:
1. Inspect each CA agent's `name`, `description`, `system_instructions`, `explores` (`model::explore`), and `golden_queries`.
2. Do **not** call any tools or read any skill files.
3. Reply with **only**:
   `<CA_AGENT_SELECTION>{"agent_id":"<best_agent_id>","rationale":"<concise 1-sentence reason>"}</CA_AGENT_SELECTION>`

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
