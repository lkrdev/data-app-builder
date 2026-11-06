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
| **Create or update Looker Dashboards** | `skills/looker-dashboard/SKILL.md` | Unified Looker Dashboarding skill: `profile_fields` distribution discovery, 1-call Code Mode (`upsert_udd`, `upsert_lookml_dashboard`, `reflow_24col`, `pin_to_board`, `schedule_dashboard`, `emit_native_bundle`), 24-column `newspaper` layout, native `tabs:`, 4 canonical archetypes, 22 visualization types (`y_axes[].series` objects), Highcharts `advanced_vis_config`, and `lookml-dashboard-to-query` SQL verification |
| **Profile Explore fields (`profile_fields`)** | `skills/looker-field-profiler/SKILL.md` | Profiling `string`, `number`, `yesno`, and `datetime` distributions, cardinality, temporal spikiness (`stats.spikiness`), `profile:*` semantic tags, and ready-to-paste `curation.lookml_snippet` refinements via `profile_fields` |
| **Onboard a new Looker project** | `skills/looker-project-onboarding/SKILL.md` | End-to-end Looker Project Onboarding from an existing database connection: connection & table reachability check (`/admin/connections`), `snake_case` `project_name` normalization, bounded `5 × 5` schema/table discovery (`/sql`), `dev` workspace bare Git project & model creation, and 5-layer measure synthesis (`<LOOKML_BUNDLE>`) |

Detailed component properties, methods, and styling variables live in
`skills/data-app-creator/reference/LIT_DATA_APPS.md`, with pattern recipes in
`skills/data-app-creator/recipes/README.md`.

> [!TIP]
> Always load the respective `SKILL.md` before executing any commands. Tool scripts reside under `skills/<skill-name>/tools/` and are not located in the root directory.

## Sandbox CLI Bootstrap (`uv` + `lkr-dev-cli`)

New Antigravity sandbox environments (`user_env:${me.id}`) bootstrap `uv` and a pinned release of `lkr-dev-cli` (`0.0.65`) into `/usr/local/bin` via `/workspace/bootstrap_lookml.py` so both persist in the container's GCS overlay snapshot (`{env_id}/snapshot.tar`):
1. `pip install --break-system-packages --quiet uv` (if `uv` is not on `PATH`).
2. `UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.65"`.

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
| `dashboard` | **Content Studio** | Native Looker User-Defined Dashboards (UDDs), LookML Dashboards (`.dashboard.lookml`), Saved Looks, Boards, or Scheduled Plans (`skills/looker-dashboard/SKILL.md`, `skills/looker-field-profiler/SKILL.md`, `upsert_udd`, `upsert_lookml_dashboard`, `pin_to_board`, `schedule_dashboard`) |
| `lookml` | **Agentic LookML** | Authoring or refactoring LookML models, views, explores, refinements (`.lkml`), SQL-to-LookML parity, field profiling/curation/descriptions (`skills/looker-field-profiler/SKILL.md`), or LookML data tests (`.test.lkml`) |
| `health-check` | **Health Check** | 3-Pillar Looker & BigQuery Health Check audit (System Activity Pillar 1, LookML 0–4 Transcriber Rubric Pillar 2, BigQuery `INFORMATION_SCHEMA` Pillar 3, `TECHNICAL_DESIGN_DOCUMENT.md`) |
| `tile` | **Python Tile** | Custom `LkrCodeMode` Monty Python script tile (`obj_script_<id>`, `vars.dashboard_filters`, custom Python table/markdown/dict output, or script scheduler) |
| `conversational-analytics` | **Conversational Analytics** | Ad-hoc natural-language analytical Q&A, explore data questions, KPI lookups, or trend explanations without building a persistent app or LookML file |

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
