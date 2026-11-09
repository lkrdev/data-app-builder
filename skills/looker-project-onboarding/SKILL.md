---
name: looker-project-onboarding
description: End-to-end Looker Project Onboarding skill for creating a new LookML project, bare Git repo, model, Bronze/Silver Medallion views and explores, LookML dashboard, and Metric Selector Data App from an existing Looker database connection.
---

# Looker Project Onboarding (`skills/looker-project-onboarding/SKILL.md`)

Use this skill when a user asks to onboard or create a new Looker project, scaffold a new LookML project from a database connection, or walk through the staged onboarding workflow (Model & Bronze -> Data Profiling & Silver Metrics -> LookML Dashboard -> Metric Selector Data App). All Looker API calls execute through `run_looker_codemode` routed via `transport.rawRequest` (`raw_api_request: yes`, requiring zero `core_api_methods` in `manifest.lkml`) and `lkr --dev tools lookml push`. Never call `update_session` inside `run_looker_codemode` — dev mode is controlled by the app session or the `--dev` CLI flag.

## Step 1: Conversational Intake & Verify Database Connection (`run_looker_codemode`)
1. **Turn 1 Intake (Missing Inputs -> Discover Available Connections via 1 `run_looker_codemode` Call & Ask)**:
   When the user says `"create a new project"` (or asks to onboard a new project) without providing a **connection name**, **project name**, and **target tables or schemas**, emit `<USE_CASE>lookml</USE_CASE>`, run **one** `run_looker_codemode` call (`sdk.all_connections(fields="name,dialect_name,database,schema")` with fallback to `sdk.all_lookml_models(fields="name,project_name,allowed_db_connection_names")`), and **immediately ask the user** for:
   - **Connection name** — list the discovered connection names (with dialect/database/schema) directly in your response alongside `[Open Looker Connections](/admin/connections)` `/admin/connections` so non-admin developers do not hit a 404 on `/admin/connections`
   - **Project name** (`snake_case`)
   - **Target tables or schemas** (or SQL queries from `[Open SQL Runner](/sql)` `/sql`).
   Do **not** call `code_execution` on Turn 1 when these inputs are not yet provided.
2. **Turn 2 Schema Discovery (`connection_schemas`)**:
   When the user provides a connection name (`<connection_name>`) and project name (`<project_name>`) and asks what schemas it has access to, emit `<USE_CASE>lookml</USE_CASE>`, run **one** `run_looker_codemode` call (`sdk.connection_schemas(connection_name)` with fallback to `sdk.all_connections(fields="name,dialect_name,database,schema,snippets")` and `sdk.connection_tables(connection_name, schema_name=..., table_limit=5)`), list out all accessible schema names returned by the connection clearly, and ask which schema/dataset to use. Do **not** call `code_execution`, `bootstrap_lookml.py`, or `view_file` on Turn 2.

## Step 2: Require `project_name` (`snake_case`) & Discover Schemas/Tables via SDK (Never `INFORMATION_SCHEMA`)
1. `project_name` is required before creating any project or model. Normalize any user-supplied project name to strict lowercase `snake_case`:
   `project_name = re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')`
   If the user has not provided a `project_name`, ask them for one.
2. Always use Looker SDK / CodeMode methods (`connection_schemas`, `connection_tables`, `generate_lookml_with_new_files`, `profile_fields`, `run_inline_query`) — **never** query `INFORMATION_SCHEMA`.
3. Bound schema/table auto-discovery to at most **5 schemas** and **5 tables per schema** (`5 × 5` cap: `schemas[:5]` and up to 5 core fact/dimension tables from `connection_tables(conn_name, schema_name=sname)` filtered to exclude `LM_*`, `LR_*`, `YM_*`, `connection_reg*` scratch tables, prioritizing the primary line-item/transaction fact table and its foreign-key entity dimension tables over high-volume event logs or inventory snapshot tables). If the user names a dataset alias alongside a physical schema name in the connection (e.g. `<schema_name>`), pass the physical `schema_name` from `connection_schemas` to `connection_tables`.

## Step 3: Stage 1 (Turn 3) — Discover Tables & Generate Bronze Views via `generate_lookml_with_new_files`, Validate Offline (`lkr parse`), Push (`lkr --dev tools lookml push`), and Ask to Profile Data
1. Emit `<USE_CASE>lookml</USE_CASE>`. Do **not** call `update_session` in `run_looker_codemode`.
2. First, in **ONE** `run_looker_codemode` call (Monty WASM — do **not** `import re`), discover the tables in `<schema_name>` via `connection_tables` and generate the 1:1 `bronze/*.view.lkml` files on Looker via `generate_lookml_with_new_files`:
   ```python
   conn, project_id, schema = "<connection_name>", "<project_name>", "<schema_name>"
   existing_ids = [p.get("id") for p in (all_projects(fields="id") or []) if isinstance(p, dict)]
   if project_id not in existing_ids:
       create_project({"name": project_id})
   update_project(project_id, {"git_service_name": "bare"})
   try:
       create_project_directory(project_id, "bronze")
   except Exception:
       pass
   raw = connection_tables(conn, schema_name=schema) or []
   tlist = (raw[0].get("tables") or []) if raw and isinstance(raw[0], dict) else []
   names = [t.get("name") for t in tlist if isinstance(t, dict) and t.get("name") and not t.get("name", "").startswith(("LM_", "LR_", "YM_", "connection_reg"))]
   core_tables = [t for t in names if "event" not in t and "inventory" not in t][:5] or names[:5]
   generate_lookml_with_new_files(
       project_id,
       {"tables": [{"schema": schema, "table_name": t, "base_view": True} for t in core_tables]},
       connection=conn,
       model_name=project_id,
       folder_name="bronze",
       file_type_for_explores="none",
       generate_descriptions=True,
       add_autogenerated_header=True,
       allow_update_without_header=True,
   )
   fields = {}
   for t in core_tables:
       cols = []
       for blk in (get_file_content(project_id, f"bronze/{t}.view.lkml") or "").split("\n  "):
           if blk.startswith(("dimension:", "dimension_group:")):
               kind, rest = blk.split(":", 1)
               cname = rest.split("{", 1)[0].strip()
               ctype = rest.split("type:", 1)[1].split()[0].strip() if "type:" in rest else "string"
               cols.append([kind.strip(), cname, ctype])
       fields[t] = cols
   return {"schema": schema, "tables": core_tables, "fields": fields}
   ```
3. Next, in **ONE** `code_execution` call using a single-quoted Python heredoc (`python3 - << 'PYEOF'`, never `python3 -c "..."`, so bash never interpolates BigQuery backticks `` `...` `` or LookML `${TABLE}` references; do **not** create refinements or `silver/` files yet), write `/workspace/lookml/` from the discovered `fields` (creating `bronze/explores/<fact_table>_base.explore.lkml` for the primary line-item/transaction fact table `<fact_table>`), validate offline with `lkr parse`, push via `lkr --dev tools lookml push` (which registers the model via `create_lookml_model` / `update_lookml_model` and skips overwriting remote `# AUTOGENERATED` views), and emit `<LOOKML_BUNDLE>`:
   ```bash
   python3 /workspace/bootstrap_lookml.py setup
   python3 - << 'PYEOF'
   from pathlib import Path
   import json
   project_id, conn, schema, fact_table = "<project_name>", "<connection_name>", "<schema_name>", "<fact_table>"
   fields = <FIELDS_DICT_FROM_RUN_LOOKER_CODEMODE>
   root = Path("/workspace/lookml")
   (root / "bronze/explores").mkdir(parents=True, exist_ok=True)
   (root / f"{project_id}.model.lkml").write_text(f'connection: "{conn}"\ninclude: "/bronze/*.view.lkml"\ninclude: "/bronze/explores/*.explore.lkml"\n')
   (root / "bronze/explores" / f"{fact_table}_base.explore.lkml").write_text(f'include: "/bronze/*.view.lkml"\nexplore: {fact_table}_base {{\n  view_name: {fact_table}\n}}\n')
   for t, cols in fields.items():
       lines = ["# AUTOGENERATED BY LKR CLI", f"view: {t} {{", f"  sql_table_name: `{schema}.{t}` ;;"]
       for kind, cname, ctype in cols:
           if kind == "dimension_group":
               lines.append(f"  dimension_group: {cname} {{ type: time timeframes: [raw, time, date, week, month, quarter, year] sql: ${{TABLE}}.{cname}_at ;; }}")
           else:
               pk = "primary_key: yes " if cname == "id" else ""
               lines.append(f"  dimension: {cname} {{ {pk}type: {ctype} sql: ${{TABLE}}.{cname} ;; }}")
       lines.append("  measure: count { type: count }\n}\n")
       (root / "bronze" / f"{t}.view.lkml").write_text("\n".join(lines))
   Path("/workspace/lookml_result.json").write_text(json.dumps({"project_id": project_id, "model_name": project_id}))
   PYEOF
   lkr parse lookml-to-api --path /workspace/lookml --validate > /dev/null
   lkr --dev tools lookml push /workspace/lookml --project-id <project_name> --no-reset
   python3 /workspace/bootstrap_lookml.py bundle /workspace/lookml_result.json
   ```
4. **Stop after creating the model and `bronze/` folder** and **ask the user if they want you to profile the data and take a stab at making metrics** (refinements and Silver explores with joins).

## Step 4: Stage 2 (Turn 4) — Create Refinements & Silver Explores, Validate Offline (`lkr parse`), Push (`lkr --dev tools lookml push`), Run `profile_fields` & Sample Query, and Ask for a Dashboard
1. Emit `<USE_CASE>lookml</USE_CASE>` and apply `/workspace/skills/agentic-lookml/SKILL.md` 5-layer measure synthesis on `<fact_table>`:
   - **Layer 1 — Medallion Refinements (`bronze/<fact_table>.refinement.lkml`)**: Leave `bronze/<table>.view.lkml` untouched (do **not** create redundant dimension refinements). Write `include: "/bronze/<fact_table>.view.lkml"` and `view: +<fact_table> { dimension: id { primary_key: yes } ... }`. When `<fact_table>` has `status` and lifecycle timestamps (`created`, `shipped`, `delivered`, `returned`) without a physical `cancelled` column, add `dimension_group: cancelled { type: time timeframes: [raw, time, date, week, month, quarter, year] sql: CASE WHEN ${status} = 'Cancelled' THEN ${created_raw} END ;; }`.
   - **Layer 2 — Statistical Measures**: Per `<num_col>`, define `total_<num_col>` (`type: sum`, `sql: ${<num_col>} ;;`, `value_format_name: usd`) and `average_<num_col>` (`type: average`, `sql: ${<num_col>} ;;`, `value_format_name: usd`). Per `<entity>_id`, define `<entity>_count` (`type: count_distinct`, `sql: ${<entity>_id} ;;`).
   - **Layer 3 — Filtered Measures (when `status` exists)**: `return_count` (`filters: [status: "Returned"]`), `cancel_count` (`filters: [status: "Cancelled"]`), `completed_count` (`filters: [status: "Complete"]`), grounded in `stats.top_values` from `profile_fields` (`skills/looker-field-profiler/SKILL.md`); apply `curation.lookml_snippet` (`recommended_hidden`, `recommended_suggestable`, `suggested_tags`, `recommended_description`), guard `profile:has_zeros` denominators with `NULLIF`, and use `profile:unique_key_candidate` / `profile:nullable` for `.test.lkml` assertions when requested.
   - **Layer 4 — ANSI Ratios (`type: number`)**: Compose via `1.0 * ${numerator_measure} / NULLIF(${denominator_measure}, 0)` (`return_rate`, `cancel_rate` with `value_format_name: percent_2`; `average_order_value` with `value_format_name: usd`).
   - **Layer 5 — Silver Explores (`silver/explores/<fact_table>.explore.lkml`)**: Deconstruct workload SQL (`grain_change_reagg`, `window_pre_groupby`, `union`, `non_equi_join`, `filter_dependent_cte`), extend `[<fact_table>_base]` (`hidden: no`, `view_name: <fact_table>`), join each `<dim_table>` (`type: left_outer`, `sql_on: ${<fact_table>.<dim>_id} = ${<dim_table>.id} ;;`, `relationship: many_to_one`), and include `"/bronze/*.refinement.lkml"` + `"/silver/explores/*.explore.lkml"` in `<project_name>.model.lkml`. Optionally run `python3 /workspace/skills/looker-field-profiler/scripts/scratch_search.py --model <project_name> --path /workspace/lookml --write-lookml /workspace/lookml/silver/explores/` (`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md`) to scaffold `explore: _field_value_search_<project_name> { hidden: yes }`.
2. In **ONE** `code_execution` call, write `<project_name>.model.lkml`, `bronze/<fact_table>.refinement.lkml`, and `silver/explores/<fact_table>.explore.lkml` via `python3 - << 'PYEOF'`, validate with `lkr parse lookml-to-api --path /workspace/lookml --validate > /dev/null`, push via `lkr --dev tools lookml push /workspace/lookml --project-id <project_name> --no-reset`, and run `python3 /workspace/bootstrap_lookml.py bundle /workspace/lookml_result.json`.
3. Next, in **ONE** `run_looker_codemode` call, run `profile_fields(model="<project_name>", view="<fact_table>", fields=["<fact_table>.status", "<fact_table>.<num_col>"])` and a 5-row `run_inline_query`, show the profiled results, and **ask if the user wants a dashboard with these metrics**.

## Step 5: Stage 3 (Turn 5) — Create LookML Dashboard, Copy into Selected UI Folder, and Offer Metric Selector Data App
1. Emit `<USE_CASE>dashboard</USE_CASE>`, call `upsert_lookml_dashboard(project_id=project_name, model=project_name, dashboard_name="<dashboard_slug>", title="<Dashboard Title>", folder_id=target_folder_id, filters=[...], tiles=[...])` (4+ tiles on `<fact_table>`, imported via `import_lookml_dashboard` with `upsert_udd` fallback) + `return emit_native_bundle(res, folder_id=target_folder_id, title="<Dashboard Title>")` in `run_looker_codemode`, confirm creation, and **ask if they want a responsive metric selector Data App** switching measures (`total_<num_col>`, `count`, `return_count`, `cancel_count`), grains (`day`/`week`/`month`/`year`), and chart types.

## Step 6: Stage 4 (Turn 6) — Responsive Metric Selector Data App (PoP KPIs, Compare Against, 3-Dot Menu, Period/Window & PoP Grid)
1. Emit `<USE_CASE>app</USE_CASE>` and write + bundle in **ONE** `code_execution` call via `python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "Metric Selector Explorer" << 'EOF'` (never run `bundle_app.py --help`, `ls`, `find`, `head`, or `view_file` on `/workspace/lookml` or `/workspace/bundle_app.py`).
2. **PoP Clickable KPIs (Border-Only, 4-Row Stack)**: Remove any `Metric` `<app-select>` and **forbid** `"ACTIVE METRIC"` badges; clicking a card sets `this.selectedMetric = m.field` (clearing `this.compareMetric` if equal) via `border-color: var(--app-primary)` only. Match lifecycle dates (`return_count` -> `returned`, `cancel_count` -> `cancelled`, `total_<num_col>`/`count` -> `created`), query `2 * this.periodCount` periods per KPI, and stack: (1) label, (2) standalone current-`N` headline (no pill beside it), (3) inline flex `[+/- %] vs. prev ${this.periodCount} ${unit}` (`polarity: 'higher-better' | 'lower-better'`), (4) current-`N` sparkline `<svg>`.
3. **`"Compare against"` + Trend Header & Top-Right `⋮` Menu**: Render `<app-select label="Compare against">` (`None`/`''` + other measures) with dual `yAxis: [{ title: { text: m1.label } }, { title: { text: m2.label }, opposite: true }]` (`series: [{ yAxis: 0 }, { yAxis: 1 }]`) when units/magnitudes differ; omit `"Longitudinal Trend"` titles, set `yAxis.title.text` to metric label(s), and put `Chart Type` (`areaspline`/`line`/`column`/`bar`) in a top-right `⋮` menu (`this.chartMenuOpen`) on the trend card only.
4. **Separate `Period` & `Window` (`periodCount`) + PoP `<app-grid>`**: Render separate `Period` (`Daily`/`Weekly`/`Monthly`/`Yearly` resetting `periodCount` to `90`/`53`/`60`/`10` -> `'90 days'`/`'53 weeks'`/`'60 months'`/`'10 years'`) and `Window` (`14/30/60/90/180`d, `12/26/53/104`w, `6/12/24/60`m, `3/5/10`y) controls wired via `this.getEffectiveFilters(...)` to **all** widgets. Omit `title` on `<app-grid>`, add a `"Dimensions"` multi-select (`this.selectedDimensions`, <= 5 non-ID/non-timestamp dims, `>= 1` active), and join current (`"${n} ${unit}"`) + prior (`"${2 * n} ${unit} ago for ${n} ${unit}"`) queries into `.data` with `<Metric> — This Period`, `<Metric> — Last Period`, `<Metric> — Variance` (`percent1-signed`) columns for Metric 1 (and Metric 2 when `compareMetric` is active):
   ```js
   const METRICS_MAP = {
     '<fact_table>.total_<num_col>': { field: '<fact_table>.total_<num_col>', label: 'Total Sales', format: 'usd', polarity: 'higher-better', dateBase: '<fact_table>.created' },
     '<fact_table>.count': { field: '<fact_table>.count', label: 'Orders', format: 'int', polarity: 'higher-better', dateBase: '<fact_table>.created' },
     '<fact_table>.return_count': { field: '<fact_table>.return_count', label: 'Returns', format: 'int', polarity: 'lower-better', dateBase: '<fact_table>.returned' },
     '<fact_table>.cancel_count': { field: '<fact_table>.cancel_count', label: 'Cancellations', format: 'int', polarity: 'lower-better', dateBase: '<fact_table>.cancelled' },
   };
   const PERIOD_DEFAULTS = { day: 90, week: 53, month: 60, year: 10 };
   const WINDOW_OPTIONS = { day: [14, 30, 60, 90, 180], week: [12, 26, 53, 104], month: [6, 12, 24, 60], year: [3, 5, 10] };
   const UNITS = { day: 'days', week: 'weeks', month: 'months', year: 'years' };
   ```
