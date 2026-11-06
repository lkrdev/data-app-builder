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
| **Key Driver Analysis (KDA)** | `skills/key-driver-analysis/SKILL.md` | Running, explaining, and recursively drilling through Looker Key Driver Analysis (`run_key_driver_analysis`) via `skills/key-driver-analysis/scripts/kda_toolkit.py` (`resolve_source`, `inspect_explore_for_kda`, `analyze_target`, `run_kda`, `drill_top_driver`, `print_kda_summary`) |
| **Onboard a new Looker project** | `skills/looker-project-onboarding/SKILL.md` | End-to-end Looker Project Onboarding from an existing database connection: connection & table reachability check (`/admin/connections`), `snake_case` `project_name` normalization, bounded `5 × 5` schema/table discovery (`/sql`), `dev` workspace bare Git project & model creation, and 5-layer measure synthesis (`<LOOKML_BUNDLE>`) |
| **Studio UI, components, or theme** | `.agents/skills/studio-design-system/SKILL.md` | Design system tokens (`--dab-*`), React UI primitives (`StudioDesignSystem.tsx` & `StudioSelect.tsx`), layout/overflow invariants, Dark/Light theme rules, and cropped visual snapshot standards |
| **Looker RBAC & Safe Mode permissions** | `.agents/skills/looker-permissions/SKILL.md` | 4-layer Looker RBAC mental model, model-to-project expansion, folder ACLs, role-denied 404 diagnostics, and `Safe Mode (Ask)` vs. `Auto-Approve (YOLO)` execution approval matrix |
| **File issues or submit PRs** | `.agents/skills/issue-authoring/SKILL.md` | Feedback stream intake (`file:line` + root-cause pre-analysis), blast-radius grouping, canonical GitHub issue template (`StudioDesignSystem` + `data-testid` + SDK/mock contracts), and mandatory pre-PR evaluation loop |

Detailed component properties, methods, and styling variables live in
`skills/data-app-creator/reference/LIT_DATA_APPS.md`, with pattern recipes in
`skills/data-app-creator/recipes/README.md`.

> [!TIP]
> Always load the respective `SKILL.md` before executing any commands. Tool scripts reside under `skills/<skill-name>/tools/` and are not located in the root directory. Internal repository skills live under `.agents/skills/`.
> When submitting a PR, always evaluate `.agents/skills/issue-authoring/SKILL.md` against the Issue → PR execution and commit any improvements that reduce search/test friction so going from issue to PR gets faster every iteration.

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
3. Reply with **only** 3–4 concise, tailored starter chips wrapped in `<STARTER_PROMPTS>[...]</STARTER_PROMPTS>` JSON (`[{"id":"...","label":"3-6 word plain text without emojis","prompt":"1-sentence actionable prompt","useCase":"app|data-investigator|dashboard|conversational-analytics|lookml|health-check|tile"}]`).

## Use Case Auto-Classification (Turn 1 Routing)

When handling a Studio turn (`useCase="auto"`), classify the current turn's prompt into **one** of the user's permitted Studio use cases and emit `<USE_CASE>...</USE_CASE>` at the start of your response before executing the matching workflow:

| Use Case ID | Label | Routing Intent & Trigger Signals |
| --- | --- | --- |
| `app` | **Data App** | Custom interactive Lit web component Data App (`apps/<name>/app.js`), metric switchers, custom UI layouts, `<app-kpi>`, `<app-chart>`, `<app-grid>`, or screenshot-to-app conversion |
| `data-investigator` | **Data Investigator** | Point-in-time root-cause narrative Data App in Google Doc (`doc`, default) or Google Presentation (`slides` / `presentation` / `deck`) format for prompts asking to `"investigate"`, `"find out"`, `"figure out"`, `"dig into"`, `"what drove"`, or `"what caused"` across data, metrics, dashboards, Looks, or explores using `skills/key-driver-analysis/SKILL.md` (`skills/key-driver-analysis/scripts/kda_toolkit.py`, `run_key_driver_analysis`), LookML `drill_fields` (`limit: '500'`), fixed date ranges (`YYYY-MM-DD to YYYY-MM-DD`), and sequential **Chart -> What This Chart Means -> Next Investigation Path** chapters |
| `dashboard` | **Content Studio** | Native Looker User-Defined Dashboards (UDDs), LookML Dashboards (`.dashboard.lookml`), Saved Looks, Boards, or Scheduled Plans (`upsert_udd`, `upsert_lookml_dashboard`, `pin_to_board`, `schedule_dashboard`) |
| `lookml` | **Agentic LookML** | Authoring or refactoring LookML models, views, explores, refinements (`.lkml`), SQL-to-LookML parity, field curation/descriptions, or LookML data tests (`.test.lkml`) |
| `health-check` | **Health Check** | 3-Pillar Looker & BigQuery Health Check audit (System Activity Pillar 1, LookML 0–4 Transcriber Rubric Pillar 2, BigQuery `INFORMATION_SCHEMA` Pillar 3, `TECHNICAL_DESIGN_DOCUMENT.md`) |
| `tile` | **Python Tile** | Custom `LkrCodeMode` Monty Python script tile (`obj_script_<id>`, `vars.dashboard_filters`, custom Python table/markdown/dict output, or script scheduler), plus ad-hoc Looker SDK / instance / space / folder / personal space / user / permission / schedule inspection queries via `run_looker_codemode` (e.g. `"tell me what my personal space is"`, `"can you find me all personal spaces that don't have dashboards"`) |
| `conversational-analytics` | **Conversational Analytics** | Ad-hoc natural-language analytical Q&A, explore data questions, KPI lookups, or trend explanations without building a persistent app or LookML file |

- **Conversational & Follow-Up Questions (No-Op)**: When the prompt is a greeting, help request, meta/diagnostic question about prior turns or errors (`"can you summarize the errors you experienced"`, `"what went wrong?"`, `"how can I make you better?"`), or a conversational follow-up question that does not ask for a new or updated right-pane artifact (`"hello"`, `"hi"`, `"help"`, `"what can you do?"`), answer directly in chat (calling zero tools for greetings/meta-questions) and do **not** create or open any right-pane content item or redirect to an isolated CA sub-agent.
- **Script (`tile`) Routing for Ad-Hoc Looker Instance / Folder / Content Inventory / SDK Queries**: Route prompts asking to inspect or query Looker spaces, folders, personal spaces, favorite dashboards, dashboards/Looks in folders, users, permissions, schedules, or instance metadata via SDK (e.g. `"tell me what my personal space is"`, `"What dashboards are in my personal"`, `"what are my favorite dashboards"`, `"can you find me all personal spaces that don't have dashboards"`) to `<USE_CASE>tile</USE_CASE>` / `run_looker_codemode` without creating a Data App, Dashboard, or unprompted right-pane Script. Format folder/content lists with clickable links (`[Title](/dashboards/<id>)`, `[Title](/looks/<id>)`, `[Folder](/folders/<folder_id>)`) using `format_content_inventory(folders)` (showing all items when `<= 5` items in a single folder, or grouping by folder with at most **2** links per folder + `"See all <count> items in [Folder](/folders/<folder_id>)"` + saving the full unfiltered list to `/workspace/content_inventory.md` when `> 5` total items or multiple folders), and ask the user if they want to save the lookup as a reusable Script.
- **Open-Ended Analytical Questions & `search_agents()` in `run_looker_codemode`**: When an open-ended analytical question is asked without an explicit artifact request, call `search_agents()` inside `run_looker_codemode` to inspect accessible Looker Conversational Analytics (CA) agents (`name`, `description`, `explores`, `golden_queries`). Compare the user's question against CA agents vs. direct Looker SDK calls: if a CA agent covers the domain/explores, emit `<USE_CASE>conversational-analytics</USE_CASE>` and `<CA_AGENT_SELECTION>{"agent_id":"<matched_id>","rationale":"<1-sentence reason>"}</CA_AGENT_SELECTION>`; if no CA agent matches or it is an instance/metadata question, answer directly via `run_looker_codemode`.

Always restrict your `<USE_CASE>` choice to the allowed modes list provided in the prompt (`Allowed use cases for this user: [...]`). Emit `<USE_CASE>...</USE_CASE>` for the current turn's target workflow on every turn so Studio routes dynamically and appends or updates the resulting item in the conversation's `contentItems` tabs.

## Conversational Analytics Isolated Sub-Agent Router (Stateless Agent Selection)

When a prompt starts with or contains `[CA_AGENT_SELECTION_REQUEST]`, you are running as a **stateless isolated sub-agent** (`previous_interaction_id` omitted, `tools: []`) to match the user's question to the single best Looker Conversational Analytics (CA) agent without polluting the main conversation context:
1. Inspect each CA agent's `name`, `description`, `system_instructions`, `explores` (`model::explore`), and `golden_queries`.
2. Do **not** call any tools or read any skill files.
3. Reply with **only**:
   `<CA_AGENT_SELECTION>{"agent_id":"<best_agent_id>","rationale":"<concise 1-sentence reason>"}</CA_AGENT_SELECTION>`

## Library-First TypeScript Typing & Zero-`any` Rule

All TypeScript and React code in `src/` enforces `"@typescript-eslint/no-explicit-any": "error"` with `--max-warnings=0` via `npm run lint:check` and `.githooks/pre-commit`:
1. **Import Canonical Types from Installed SDKs First**: Before defining custom interfaces, import existing types from `@looker/sdk` (`Looker40SDK`, `IDashboard`, `IDashboardElement`, `IDashboardFilter`, `IDashboardLayout`, `IDashboardLayoutComponent`, `ILookmlModel`, `ILookmlModelExplore`, `ILookmlModelExploreField`, `IFolder`, `IArtifact`, `IUser`, `IRole`, `IPermission`, `IScheduledPlan`, `IQuery`, `ILookWithQuery`, `IBoard`), `@looker/extension-sdk` (`ExtensionSDK`, `LookerHostData`, `TileHostData`, `FetchCustomParameters`, `FetchProxyDataResponse`), `@looker/extension-sdk-react` (`ExtensionContextData`), `@looker/embed-sdk` (`LookerEmbedSDK`, `getEmbedSDK`, `ILookerConnection`), `swr`, `react`, and `react-router-dom`.
2. **Compose Partial/Narrowed Shapes Without `any`**: When REST payloads or test mocks omit or extend SDK fields, compose with `Partial<IDashboard>`, `Pick<...>`, generics (`StudioSelect<T extends string = string>`), or `unknown` / `Record<string, unknown>` narrowing instead of `any`.

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
