---
name: looker-project-onboarding
description: End-to-end Looker Project Onboarding skill for creating a new LookML project, bare Git repo, model, base views, and 5-layer measure-synthesized refinements from an existing Looker database connection via run_looker_codemode.
---

# Looker Project Onboarding (`skills/looker-project-onboarding/SKILL.md`)

Use this skill when a user asks to onboard a new Looker project, scaffold a new LookML project from a database connection, or model tables/SQL queries into a new LookML project and model. All Looker API calls execute through `run_looker_codemode` routed via `transport.rawRequest` (`raw_api_request: yes`, requiring zero `core_api_methods` in `manifest.lkml`).

## Step 1: Verify Database Connection & Table Reachability (`run_looker_codemode`)
1. Query connections via `sdk.all_connections(fields="name,dialect_name,database,schema,snippets")` and filter out internal Looker system connections (`not c.get("name", "").startswith("looker__")`).
2. Verify table reachability on the target connection via `sdk.connection_schemas(connection_name)` (with fallback to `sdk.connection_databases(connection_name)` and `sdk.connection_tables(connection_name, schema_name=..., table_limit=5)`).
3. If no reachable connection or tables exist, stop and instruct the user to configure or verify their database connection at `[Open Looker Connections](/admin/connections)` (`/admin/connections`).

## Step 2: Require `project_name` (`snake_case`) & Discover Schemas, Tables, or User SQL Queries
1. `project_name` is required before creating any project or model. Normalize any user-supplied project name to strict lowercase `snake_case`:
   `project_name = re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')`
   If the user has not provided a `project_name`, ask them for one.
2. Ask the user which schemas/tables to include or whether they have 1 or more SQL queries from SQL Runner (`[Open SQL Runner](/sql)`, `/sql`) representing their core reporting workload.
3. Bound schema/table auto-discovery to at most **5 schemas** and **5 tables per schema** (`5 × 5` cap: `schemas[:5]` and `connection_tables(conn_name, schema_name=sname, table_limit=5)` `tables[:5]`) plus `sdk.connection_columns(conn_name, schema_name=sname, table_names=",".join(tables))`.

## Step 3: Switch to `dev` Workspace, Create Project, Initialize Bare Git Repo, Scaffold Model/Views, and Register LookML Model
1. Switch session to dev mode: `sdk.update_session({"workspace_id": "dev"})`.
2. Create or fetch the project: `sdk.create_project({"name": project_name})` (fallback `sdk.project(project_name)`).
3. Initialize bare Git repo: `sdk.create_git_deploy_key(project_name)` and `sdk.update_project(project_name, {"git_remote_url": f"file:///tmp/{project_name}_bare.git", "git_service_name": "bare"})`.
4. Scaffold `models/<project_name>.model.lkml`, `views/base/<table>.view.lkml`, and `views/refinements/+<table>.view.lkml` via `sdk.create_project_directory` and `sdk.create_file` / `sdk.update_file`.
5. Register the LookML model tied to the connection: `sdk.create_lookml_model({"name": project_name, "project_name": project_name, "allowed_db_connection_names": [conn_name]})` (fallback `sdk.update_lookml_model`).

## Step 4: Download LookML to `/workspace`, Synthesize Measures (`looker-demo-cli` 5-Layer Methodology), Push, and Validate
1. Pull project `.lkml` files into `/workspace/lookml_baseline/` and `/workspace/data/$RUN_ID/lookml/<project_name>/` via `sdk.all_project_files` + `sdk.get_file_content`.
2. Follow the 5-layer measure synthesis methodology from `cloud-gtm/looker-demo-cli` (`measure-synthesis`, `lookml-architect`, `workload-measure-extractor`):
   - **Layer 1 — Layered Base vs. Refinement Structure**: Keep `views/base/<table>.view.lkml` strictly for raw dimensions (`primary_key: yes`, `dimension_group`, raw columns, base `count`); place all synthesized measures and descriptions in `views/refinements/+<table>.view.lkml` (`view: +<table>`).
   - **Layer 2 — Core Statistical Measures per Numeric & Entity Column**: `count_distinct` for `*_id` keys; `sum` (`total_<col>`), `average` (`average_<col>`), `min`, `max`, `median`, and `percentile` for numeric facts with `value_format_name` and `drill_fields`.
   - **Layer 3 — Data-Grounded Filtered Measures**: Query actual distinct categorical values (`SELECT DISTINCT <col> FROM <schema>.<table> LIMIT 20` via `sdk.create_sql_query` + `sdk.run_sql_query`) before authoring `filters: [<dim>: "<exact_db_value>"]`.
   - **Layer 4 — Portable ANSI Derived Ratios (`type: number`)**: Compose ratios from LookML measures via `1.0 * ${numerator_measure} / NULLIF(${denominator_measure}, 0)`.
   - **Layer 5 — Workload SQL Deconstruction**: Deconstruct user SQL `SUM`, `COUNT(DISTINCT)`, `AVG`, `CASE WHEN`, and ratios into base dimensions + refinement measures; only introduce NDT/SDT when one of the 5 irreducible signals is present (`grain_change_reagg`, `window_pre_groupby`, `union`, `non_equi_join`, `filter_dependent_cte`).
3. Push curated `.lkml` files back to Looker dev mode, validate with `sdk.validate_project(project_name)`, and emit `<LOOKML_BUNDLE>` via `python3 /workspace/bootstrap_lookml.py bundle /workspace/data/$RUN_ID`.
