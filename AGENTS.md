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
| **Create or edit an app** | `skills/data-apps/SKILL.md` | Schema discovery, component selection, Lit templates, CSS grid, recipes, and tile sandbox publishing (`skills/data-apps/reference/LIT_DATA_APPS.md`, `skills/data-apps/recipes/*.md`, `/workspace/bundle_app.py --stdin`) |
| **Sync upstream Data Apps** | `.agents/skills/data-apps-sync/SKILL.md` | Unpacking the upstream Looker Data Apps `.sh` installer/tarball in a temp directory, stripping local-preview/CLI scripts, and repackaging `skills/data-apps/` (`npm run sync-upstream`) |
| **Data Investigator narrative app** | `skills/data-investigator/SKILL.md` | Point-in-time root-cause narrative Data Apps (`doc` / `slides`) with fixed date ranges (`YYYY-MM-DD to YYYY-MM-DD`) and sequential evidence chapters |
| **Key Driver Analysis (KDA)** | `skills/key-driver-analysis/SKILL.md` | Running, explaining, and recursively drilling through Looker Key Driver Analysis (`run_key_driver_analysis`) via `skills/key-driver-analysis/scripts/kda_toolkit.py` (`resolve_source`, `inspect_explore_for_kda`, `analyze_target`, `run_kda`, `drill_top_driver`, `print_kda_summary`) |
| **Create or update Looker Dashboards** | `skills/looker-dashboard/SKILL.md` | Unified Looker Dashboarding skill: `profile_fields` distribution discovery, 1-call Code Mode (`upsert_udd`, `upsert_lookml_dashboard`, `reflow_24col`, `pin_to_board`, `schedule_dashboard`, `emit_native_bundle`), 24-column `newspaper` layout, native `tabs:`, 4 canonical archetypes, 22 visualization types (`y_axes[].series` objects), Highcharts `advanced_vis_config`, and `lookml-dashboard-to-query` SQL verification |
| **Profile Explore fields (`profile_fields`)** | `skills/looker-field-profiler/SKILL.md` (`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`) | Profiling `string`, `number`, `yesno`, and `datetime` distributions, cardinality, temporal spikiness (`stats.spikiness`), `profile:*` semantic tags, `curation.lookml_snippet` refinements via `profile_fields`, and per-model `_field_value_search_<model>` search index PDTs (`scripts/scratch_search.py`) |
| **Onboard a new Looker project** | `skills/looker-project-onboarding/SKILL.md` | End-to-end Looker Project Onboarding from an existing database connection: connection & table reachability check (`/admin/connections`), `snake_case` `project_name` normalization, bounded `5 × 5` schema/table discovery (`/sql`), `dev` workspace bare Git project & model creation, 5-layer measure synthesis (`<LOOKML_BUNDLE>`), and optional `_field_value_search_<project_name>` search index scaffolding |
| **Agentic LookML & Medallion modeling** | `skills/agentic-lookml/SKILL.md` | Unified LookML engineering, 14 SQL-to-LookML pattern playbooks (`skills/agentic-lookml/references/01..14-*.md`, `measures-and-sql-functions.md`), and Bronze/Silver/Gold Medallion semantic modeling |
| **End-to-end SQL-to-LookML PR workflow** | `skills/agentic-lookml-workflow/SKILL.md` | Offline SQL parsing, branch init, Bronze view generation, LookML data tests, parity pre-gate (`skills/agentic-lookml-workflow/scripts/*.py`), and PR creation |
| **Scaffold Bronze views from DB tables** | `skills/generate-view-from-table/SKILL.md` | Detecting missing/stale Bronze views and generating 1:1 physical `bronze/:table.view.lkml` files (`skills/generate-view-from-table/scripts/generate_bronze_view.py`) |
| **Curate LookML field descriptions & tags** | `skills/lookml-field-curation/SKILL.md` | Authoring high-signal `description:`, `tags:`, `hidden:`, and `suggestable:` refinements (`skills/lookml-field-curation/scripts/profile_string_fields.py`, `enrich_partition_clustering.py`, `scratch_search.py`) |
| **LookML syntax, views, explores & tests** | `skills/lookml/SKILL.md` | Complete LookML reference suite: `skills/lookml-model/SKILL.md`, `skills/lookml-view/SKILL.md` (`references/derived_table.md`), `skills/lookml-explore/SKILL.md` (`references/joins.md`, `advanced.md`), `skills/lookml-fields/SKILL.md` (`references/*.md`), `skills/lookml-refinements/SKILL.md`, `skills/lookml-tests/SKILL.md`, `skills/lookml-liquid/SKILL.md`, `skills/lookml-sets/SKILL.md`, `skills/lookml-access-grants/SKILL.md`, `skills/lookml-ojof/SKILL.md` |
| **Looker filters & table calculations** | `skills/looker-filters/SKILL.md` & `skills/looker-expressions/SKILL.md` | Looker filter expressions, `matches_filter`, Custom Fields, Table Calculations (`references/excel-equivalents.md`), and `.test.lkml` `assert:` expressions |
| **Looker Code Mode & project helpers** | `skills/lkr-code-mode/SKILL.md` & `skills/lkr-project-helper/SKILL.md` | Monty Python sandbox SDK recipes (`skills/lkr-code-mode/scripts/*.py`), bare Git setup, SQL-to-view generation, and UDD dashboard migration (`skills/lkr-project-helper/scripts/*.py`) |
| **LookML review, audits & dialect migration** | `skills/lookml-reviewer/SKILL.md`, `skills/looker-audit/SKILL.md`, `skills/looker-performance-optimizer/SKILL.md`, `skills/snowflake-to-bigquery-converter/SKILL.md` | Code Mode LAMS structural review, `system__activity` governance audits, PDT/query performance optimization, and Snowflake-to-BigQuery SQL/LookML conversion |
| **Looker Alerts** | `skills/looker-alerts/SKILL.md` | Triage running/failing alerts (`search_alerts`, `alert_details`), verify alert filters & data, tune noisy frequency, diagnose mobile notifications, move alerts across tiles, and emit `<ALERT_BUNDLE>` |
| **Studio UI, components, or theme** | `.agents/skills/studio-design-system/SKILL.md` | Design system tokens (`--dab-*`), React UI primitives (`StudioDesignSystem.tsx` & `StudioSelect.tsx`), layout/overflow invariants, Dark/Light theme rules, and cropped visual snapshot standards |
| **Looker RBAC & Safe Mode permissions** | `.agents/skills/looker-permissions/SKILL.md` (`skills/looker-permissions/SKILL.md`) | 4-layer Looker RBAC mental model, model-to-project expansion, folder ACLs, role-denied 404 diagnostics, and `Safe Mode (Ask)` vs. `Auto-Approve (YOLO)` execution approval matrix |
| **Debug Studio conversations & Artifacts** | `.agents/skills/studio-conversation-debugger/SKILL.md` | Inspecting immutable `conv_<id>` records in `user_conversations:${me.id}`, `contentItems` (`hidden`), `user_env:${me.id}`, and payload byte sizes via `lkr --oauth-account=<account> code-mode sandbox` (`scripts/inspect_conversation.py`) |
| **File issues or submit PRs** | `.agents/skills/issue-authoring/SKILL.md` | Feedback stream intake (`file:line` + root-cause pre-analysis), blast-radius grouping, canonical GitHub issue template (`StudioDesignSystem` + `data-testid` + SDK/mock contracts), and mandatory pre-PR evaluation loop |

Detailed component properties, methods, and styling variables live in
`skills/data-apps/reference/LIT_DATA_APPS.md`, with pattern recipes in
`skills/data-apps/recipes/README.md`.

> [!TIP]
> Always load the respective `SKILL.md` before executing any commands. Internal repository skills live under `.agents/skills/`.
> When submitting a PR, always evaluate `.agents/skills/issue-authoring/SKILL.md` against the Issue → PR execution and commit any improvements that reduce search/test friction so going from issue to PR gets faster every iteration.

## Sandbox CLI Bootstrap (`uv` + `lkr-dev-cli`)

New Antigravity sandbox environments (`user_env:${me.id}`) bootstrap `uv` and a pinned release of `lkr-dev-cli` (`0.0.69`) into `/usr/local/bin` via `/workspace/bootstrap_lookml.py` so both persist in the container's GCS overlay snapshot (`{env_id}/snapshot.tar`):
1. `pip install --break-system-packages --quiet uv` (if `uv` is not on `PATH`).
2. `UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "lkr-dev-cli[tools,code-mode,parse]==0.0.69"`.

## Conversation Labeling (Stateless Side-Request)

When a prompt starts with or contains `[CONVERSATION_LABEL_REQUEST]`, you are handling an out-of-band, stateless conversation labeling request:
1. Return **only** a single-line concise title of **3–6 words** in plain text (no quotes, no markdown formatting, no trailing period, no tags).
2. **Never** call `lookup_skill`, `code_execution`, `run_looker_codemode`, or read any `.agents/skills/*` file.

## Dynamic Starter Prompts (Stateless Side-Request)

When a prompt starts with or contains `[STARTER_PROMPTS_REQUEST]`, you are handling an out-of-band, stateless starter prompt synthesis request:
1. Inspect discovered LookML explore/field metadata (`model::explore`, dimensions, measures), LookML development access, and recent user content (`content_summary` dashboards and Looks).
2. Do **not** call any tools (`lookup_skill`, `code_execution`, `run_looker_codemode`) or read any skill files.
3. Reply with **only** 3–4 concise, tailored starter chips wrapped in `<STARTER_PROMPTS>[...]</STARTER_PROMPTS>` JSON (`[{"id":"...","label":"3-6 word plain text without emojis","prompt":"1-sentence actionable prompt"}]`).

## Open-Ended Chat & Artifact Bundles

Every Studio conversation is an open-ended chat with **zero host pre-routing** — any turn can freely answer questions, run Key Driver Analysis, build a Data App, create a Looker Dashboard/Look/Board, author LookML, inspect Alerts, or run an audit. Right-pane `contentItems` tabs materialize strictly from the output bundles emitted in a turn:

| Capability | Skill & Tools | Output Bundle / Chat Contract |
| --- | --- | --- |
| **Data App** | `skills/data-apps/SKILL.md` + `bundle_app.py` (`code_execution`) | Run `python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "<App Title>"` to emit `<DATA_APP_BUNDLE>` (never claim an app is live in the right pane without running `bundle_app.py`). |
| **Data Investigator** | `skills/data-investigator/SKILL.md` & `skills/key-driver-analysis/SKILL.md` (`run_key_driver_analysis`, `limit: '500'`, fixed `YYYY-MM-DD to YYYY-MM-DD`) | Author narrative `doc` (default) or `slides` Data App (**Chart -> What This Chart Means -> Next Investigation Path**) and run `bundle_app.py` to emit `<DATA_APP_BUNDLE>`. |
| **Dashboards, Looks & Boards** | `skills/looker-dashboard/SKILL.md`, `skills/looker-field-profiler/SKILL.md` (`profile_fields`, `_field_value_search_<model>`) | Call `upsert_udd`, `upsert_lookml_dashboard`, `pin_to_board`, or `schedule_dashboard` + `return emit_native_bundle(...)` in `run_looker_codemode` (`<NATIVE_CONTENT_BUNDLE>`) and end with `[Open <Title>](/dashboards/<id>)` or `[Open <Title>](/looks/<id>)`. |
| **Agentic LookML** | `skills/agentic-lookml/SKILL.md`, `skills/looker-project-onboarding/SKILL.md`, `skills/lookml-field-curation/SKILL.md` | Validate with `lkr parse lookml-to-api --path /workspace/lookml --validate`, push via `lkr --dev tools lookml push`, run `python3 /workspace/bootstrap_lookml.py bundle` (`<LOOKML_BUNDLE>`), and end with `[Open <project_id> in Looker IDE](/projects/<project_id>)`. |
| **3-Pillar Health Check** | System Activity Pillar 1, LookML 0–4 Transcriber Rubric Pillar 2, BigQuery `INFORMATION_SCHEMA` Pillar 3 | Write `/workspace/TECHNICAL_DESIGN_DOCUMENT.md` and emit `<HEALTH_CHECK_TDD>...</HEALTH_CHECK_TDD>`. |
| **Scripts, Alerts & SDK Audits** | `skills/looker-alerts/SKILL.md`, `skills/looker-audit/SKILL.md`, `run_looker_codemode` | Emit `<ALERT_BUNDLE>` when creating/editing/inspecting a specific alert; output a ```python``` block when explicitly asked for a reusable `LkrCodeMode` Script (`obj_script_<id>`, `vars.dashboard_filters`); answer ad-hoc SDK/folder/user/schedule lookups directly in chat using `format_content_inventory(folders)` (`[Title](/dashboards/<id>)`, `[Title](/looks/<id>)`, `[Folder](/folders/<folder_id>)`, saving lists `> 5` items to `/workspace/content_inventory.md`) and ask if the user wants to save the lookup as a reusable Script. |
| **Conversational Analytics & Q&A** | `run_looker_codemode` (`search_agents()`, `run_inline_query`, `_field_value_search_<model>`) | For open-ended analytical questions without an artifact request, call `search_agents()` in `run_looker_codemode`: if a Looker CA agent covers the domain/explores, emit `<CA_AGENT_SELECTION>{"agent_id":"<matched_id>","rationale":"<1-sentence reason>"}</CA_AGENT_SELECTION>` (include `<model>::_field_value_search_<model>` when configuring CA agents); otherwise answer directly in chat via `run_looker_codemode`. |

- **Conversational & Follow-Up Questions (No-Op)**: Answer greetings, help requests, and meta/diagnostic questions directly in chat (calling zero tools for greetings/meta-questions) without emitting any right-pane bundle.
- **Code Mode Helpers (`api_template`, Henry `system__activity`, Portable JSON & Personal `test*` Soft-Trash)**:
  - **OpenAPI Request-Body Helpers**: Use `describe_body(target)` and `api_template(target)` (`"create_connection"`, `"connections create"`, `"WriteConnection"`, `"WriteScheduledPlan"`) to generate writable request skeletons with read-only fields omitted and `/password|secret|certificate|private_key|token/i` fields set to `"<CONFIGURE_IN_LOOKER_ADMIN_UI>"` (never solicit credentials in chat).
  - **Henry Health & Vacuum**: Use `health_pulse(timeframe_days=7)`, `health_analyze(project=None, model=None, timeframe_days=90)`, and `health_vacuum(project=None, model=None, timeframe_days=90, max_explores=20)` for bounded `system__activity` audits; report `permission_denied` / `truncated` honestly without synthetic numbers and suppress deletion recommendations whenever `vacuum_safe` is `False`.
  - **Same-Instance Copy vs Portable JSON**: Use 1-line `copy_dashboard(id, folder_id)` / `copy_look(id, folder_id)` for same-instance clones; use `export_dashboard_json(id)`, `import_dashboard_json(spec_or_filename, folder_id, title=None)`, `export_look_json(id)`, and `import_look_json(spec_or_filename, folder_id, title=None)` for portable JSON dicts, strings, or composer `uploaded_files` `.json` attachments.
  - **Personal Folder `test*` Cleanup**: Scope strictly to `me()["personal_folder_id"]` (`folder_dashboards` / `folder_looks`), match word-boundary `test` prefixes (`title.lower() == "test"` or `title[:5].lower() in ("test ", "test_", "test-")`), and default to recoverable Trash (`update_dashboard(id, {"deleted": True})` / `update_look(id, {"deleted": True})`) unless permanent purge is explicitly requested.

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

## Looker Artifacts Pointers-Only Invariant (Zero Exceptions)

Looker's internal Artifacts key-value store (`data_app_builder::data_app_builder`) enforces a closed, zero-exception **Pointers-Only** schema (`assertPointerOnlyArtifactWrite` in `ArtifactService.put()`):
1. **Closed 3-Key Per-User Allowlist**: Only **`user_env:${me.id}`** (`<= 512 B`: `environmentId`, `sourcesHash`, `updatedAt`), **`user_config:${me.id}`** (`<= 1,024 B`: `userId`, `agentName`, `themeMode`, `requirePermission`, `busySendAction`, `maxToolRounds`, `selectedFolderId`, `updatedAt`), and **`user_conversations:${me.id}`** (`<= 64 KiB` total, `<= 4,096 B` per entry, automatic tail eviction above `60,000 B`) may ever be written. Writing to `obj_*`, `user_${me.id}_*`, or `tile_element_*` keys is strictly forbidden.
2. **Forbidden Content & Transcript Keys**: `ArtifactService.put()` recursively rejects `messages`, `text`, `activitySteps`, `images`, `rawCode`, `prod_code`, `raw_code`, `code`, `files`, `tddMarkdown`, `telemetry`, `elements`, `alert_history_items`, `queryCache`, and `filterCache` (`ArtifactPayloadViolationError`). Full conversation turns live exclusively in the remote Antigravity Interactions API (`turnInteractionIds` `[rootId, finalId]` pairs bound to `environmentId`, hydrated in parallel on cold open and expired when the sandbox resets or returns `404 Environment not found`).
3. **Repository-Internal Rule Only**: Keep this rule in root `AGENTS.md` for Studio engineering only — never copy it into `src/antigravityPrompts.ts` (`AGENTS_MD`).
