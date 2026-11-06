---
name: looker-project-onboarding
description: End-to-end Looker Project Onboarding skill for creating a new LookML project, bare Git repo, model, Bronze/Silver Medallion views and explores, LookML dashboard, and Metric Selector Data App from an existing Looker database connection.
---

# Looker Project Onboarding (`skills/looker-project-onboarding/SKILL.md`)

Use this skill when a user asks to onboard or create a new Looker project, scaffold a new LookML project from a database connection, or walk through the staged onboarding workflow (Model & Bronze -> Data Profiling & Silver Metrics -> LookML Dashboard -> Metric Selector Data App). All Looker API calls execute through `run_looker_codemode` routed via `transport.rawRequest` (`raw_api_request: yes`, requiring zero `core_api_methods` in `manifest.lkml`) and `lkr --dev tools lookml push`. Never call `update_session` inside `run_looker_codemode` — dev mode is controlled by the app session or the `--dev` CLI flag.

## Step 1: Conversational Intake & Verify Database Connection (`run_looker_codemode`)
1. **Turn 1 Intake (Missing Inputs -> Ask Immediately with 0 Tool Calls)**:
   When the user says `"create a new project"` (or asks to onboard a new project) without providing a **connection name**, **project name**, and **target tables or schemas**, emit `<USE_CASE>lookml</USE_CASE>` and **immediately ask the user** for:
   - **Connection name** (or check `[Open Looker Connections](/admin/connections)` `/admin/connections`)
   - **Project name** (`snake_case`)
   - **Target tables or schemas** (or SQL queries from `[Open SQL Runner](/sql)` `/sql`).
   Do **not** call `run_looker_codemode` or `code_execution` on Turn 1 when these inputs are not yet provided.
2. **Turn 2 Schema Discovery (`connection_schemas`)**:
   When the user provides a connection name (e.g. `default_bigquery_connection`) and project name and asks what schemas it has access to, emit `<USE_CASE>lookml</USE_CASE>`, run **one** `run_looker_codemode` call (`sdk.connection_schemas(connection_name)` with fallback to `sdk.all_connections(fields="name,dialect_name,database,schema,snippets")` and `sdk.connection_tables(connection_name, schema_name=..., table_limit=5)`), list out the accessible schemas clearly (e.g. `argolis_scratch`, `cymbal_lakehouse`, `streaming_analytics`, `thelook`), and ask which schema/dataset to use. Do **not** call `code_execution`, `bootstrap_lookml.py`, or `view_file` on Turn 2.

## Step 2: Require `project_name` (`snake_case`) & Discover Schemas/Tables via SDK (Never `INFORMATION_SCHEMA`)
1. `project_name` is required before creating any project or model. Normalize any user-supplied project name to strict lowercase `snake_case`:
   `project_name = re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')`
   If the user has not provided a `project_name`, ask them for one.
2. Always use Looker SDK / CodeMode methods (`connection_schemas`, `connection_tables`, `generate_lookml_with_new_files`, `profile_fields`, `run_inline_query`) — **never** query `INFORMATION_SCHEMA`.
3. Bound schema/table auto-discovery to at most **5 schemas** and **5 tables per schema** (`5 × 5` cap: `schemas[:5]` and `connection_tables(conn_name, schema_name=sname)` filtered to exclude `LM_*`, `LR_*`, `YM_*`, `connection_reg*` scratch tables). When the user selects `thelook` (`argolis_scratch` / `looker-private-demo.thelook`), pass `schema_name="argolis_scratch"` to `connection_tables` and target `order_items`, `users`, `products`, `distribution_centers`.

## Step 3: Stage 1 (Turn 3) — Discover Tables & Generate Bronze Views via `generate_lookml_with_new_files`, Validate Offline (`lkr parse`), Push (`lkr --dev tools lookml push`), and Ask to Profile Data
1. Emit `<USE_CASE>lookml</USE_CASE>`. Do **not** call `update_session` in `run_looker_codemode`.
2. First, in **ONE** `run_looker_codemode` call (Monty WASM — do **not** `import re`), discover the tables in `argolis_scratch` via `connection_tables` and generate the 1:1 `bronze/*.view.lkml` files on Looker via `generate_lookml_with_new_files`:
   ```python
   conn, project_id, schema = "default_bigquery_connection", "<project_name>", "argolis_scratch"
   existing_ids = [p.get("id") for p in (all_projects(fields="id") or []) if isinstance(p, dict)]
   if project_id not in existing_ids:
       create_project({"name": project_id})
   update_project(project_id, {"git_service_name": "bare"})
   raw = connection_tables(conn, schema_name=schema) or []
   tlist = (raw[0].get("tables") or []) if raw and isinstance(raw[0], dict) else []
   names = [t.get("name") for t in tlist if isinstance(t, dict) and t.get("name") and not t.get("name", "").startswith(("LM_", "LR_", "YM_", "connection_reg"))]
   core_tables = [t for t in ("order_items", "users", "products", "distribution_centers") if t in names] or names[:5]
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
3. Next, in **ONE** `code_execution` call using a single-quoted Python heredoc (`python3 - << 'PYEOF'`, never `python3 -c "..."`, so bash never interpolates BigQuery backticks `` `...` `` or LookML `${TABLE}` references; do **not** create refinements or `silver/` files yet), write `/workspace/lookml/` from the discovered `fields`, validate offline with `lkr parse`, push via `lkr --dev tools lookml push` (which registers the model via `create_lookml_model` / `update_lookml_model` and skips overwriting remote `# AUTOGENERATED` views), and emit `<LOOKML_BUNDLE>`:
   ```bash
   python3 /workspace/bootstrap_lookml.py setup
   python3 - << 'PYEOF'
   from pathlib import Path
   import json
   project_id, conn, schema = "<project_name>", "default_bigquery_connection", "argolis_scratch"
   fields = <FIELDS_DICT_FROM_RUN_LOOKER_CODEMODE>
   root = Path("/workspace/lookml")
   (root / "bronze/explores").mkdir(parents=True, exist_ok=True)
   (root / f"{project_id}.model.lkml").write_text(f'connection: "{conn}"\ninclude: "/bronze/*.view.lkml"\ninclude: "/bronze/explores/*.explore.lkml"\n')
   (root / "bronze/explores/order_items_base.explore.lkml").write_text('include: "/bronze/*.view.lkml"\nexplore: order_items_base {\n  view_name: order_items\n  label: "Order Items (Bronze)"\n}\n')
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
1. When the user confirms profiling the data and making metrics, emit `<USE_CASE>lookml</USE_CASE>`.
2. Follow `agentic-lookml` and the 5-layer measure synthesis methodology:
   - **Layer 1 — Medallion Refinements (`bronze/<table>.refinement.lkml`)**: Leave `bronze/<table>.view.lkml` untouched; create `/workspace/lookml/bronze/<table>.refinement.lkml` starting with `include: "/bronze/<table>.view.lkml"` and `view: +<table> { ... }` with `dimension: id { primary_key: yes }`. On `order_items.refinement.lkml`, also add a `cancelled` `dimension_group` (`dimension_group: cancelled { type: time timeframes: [raw, time, date, week, month, quarter, year] sql: CASE WHEN ${status} = 'Cancelled' THEN ${created_raw} END ;; }`) alongside `returned`, `created`, `shipped`, and `delivered`.
   - **Layer 2 — Core Statistical Measures per Numeric & Entity Column**: `order_count` (`type: count_distinct`, `sql: ${order_id} ;;`), `user_count` (`type: count_distinct`, `sql: ${user_id} ;;`), `total_sale_price` (`type: sum`, `sql: ${sale_price} ;;`, `value_format_name: usd`), `average_sale_price` (`type: average`, `sql: ${sale_price} ;;`, `value_format_name: usd`).
   - **Layer 3 — Data-Grounded Filtered Measures (Must Include `return_count` and `cancel_count`)**:
     - `measure: return_count { type: count filters: [status: "Returned"] label: "Return Count" }`
     - `measure: cancel_count { type: count filters: [status: "Cancelled"] label: "Cancel Count" }`
     - `measure: completed_order_count { type: count filters: [status: "Complete"] label: "Completed Order Count" }`
   - **Layer 4 — Portable ANSI Derived Ratios (`type: number`)**: Compose ratios from LookML measures via `1.0 * ${numerator_measure} / NULLIF(${denominator_measure}, 0)` (e.g. `return_rate`, `cancel_rate`, `average_order_value`).
   - **Layer 5 — Silver Explores with Joins (`silver/explores/order_items.explore.lkml`)**: Deconstruct workload SQL (`grain_change_reagg`, `window_pre_groupby`, `union`, `non_equi_join`, `filter_dependent_cte`) and create `/workspace/lookml/silver/explores/order_items.explore.lkml` (`include: "/bronze/*.view.lkml"`, `include: "/bronze/*.refinement.lkml"`, `include: "/bronze/explores/*.explore.lkml"`, `explore: order_items { extends: [order_items_base] hidden: no view_name: order_items ... }`) joining `users` (`${order_items.user_id} = ${users.id}`, `many_to_one`), `products` (`${order_items.product_id} = ${products.id}`, `many_to_one`), and `distribution_centers` (`${products.distribution_center_id} = ${distribution_centers.id}`, `many_to_one`). Update `/workspace/lookml/<project_name>.model.lkml` to include `"/bronze/*.refinement.lkml"` and `"/silver/explores/*.explore.lkml"`.
3. In the **same** `code_execution` call that writes the refinement and Silver explore files via `python3 - << 'PYEOF'` (single-quoted heredoc), validate offline with `lkr parse`, push all files to Looker using `lkr --dev tools lookml push`, and emit `<LOOKML_BUNDLE>` (so Turn 4 uses only **1** `code_execution` call followed by **1** `run_looker_codemode` call):
   ```bash
   lkr parse lookml-to-api --path /workspace/lookml --validate > /dev/null
   lkr --dev tools lookml push /workspace/lookml --project-id <project_name> --no-reset
   python3 /workspace/bootstrap_lookml.py bundle /workspace/lookml_result.json
   ```
4. **Profile Fields & Show Live Example Data via SDK**: After the `code_execution` push completes, in **one** `run_looker_codemode` call, run **both** `profile_fields` and `run_inline_query`:
   ```python
   prof = profile_fields(model="<project_name>", view="order_items", fields=["order_items.status", "order_items.sale_price"])
   rows = run_inline_query("json", {"model": "<project_name>", "view": "order_items", "fields": ["products.department", "order_items.count", "order_items.total_sale_price", "order_items.return_count", "order_items.cancel_count"], "sorts": ["order_items.total_sale_price desc"], "limit": "5"})
   return {"profiles": prof.get("profiles"), "rows": rows}
   ```
   Render the profiled findings and live sample rows in your response, and **ask the user if they want a dashboard with these metrics**.

## Step 5: Stage 3 (Turn 5) — Create LookML Dashboard, Copy into Selected UI Folder, and Offer Metric Selector Data App
1. When the user asks to create a dashboard with these metrics, emit `<USE_CASE>dashboard</USE_CASE>`.
2. In `run_looker_codemode`, call `upsert_lookml_dashboard(project_id=project_name, model=project_name, dashboard_name="ecommerce_performance", title="E-Commerce Performance Overview", folder_id=target_folder_id, filters=[...], tiles=[...])` (which creates `dashboards/ecommerce_performance.dashboard.lookml` and imports/copies it into `target_folder_id` via `import_lookml_dashboard(lookml_id, str(target_folder_id), {"title": title})` with fallback to `upsert_udd` in `target_folder_id`) and `return emit_native_bundle(res, folder_id=target_folder_id, title="E-Commerce Performance Overview")`.
3. In your text response, confirm the LookML dashboard was created and copied into the selected folder, and **ask the user if they want a responsive metric selector Data App** that takes the measures (`total_sale_price`, `count`, `return_count`, `cancel_count`) and switches between **date (day), week, month, and year** and **different chart types**.

## Step 6: Stage 4 (Turn 6) — Responsive Metric Selector Data App (90d/53w/60m/10y & Measure-Matched Date Dimensions)
1. When the user confirms building the metric selector Data App, emit `<USE_CASE>app</USE_CASE>` and write + bundle the Lit Data App in **ONE** `code_execution` call via `python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "Metric Selector Explorer" << 'EOF'` (do **not** run `ls`, `find`, `head`, or `view_file` on `/workspace/lookml` or `/workspace/bundle_app.py`). Use this static-analyzer-safe `render()` snippet:
   ```js
   const datePrefix = this.selectedMetric === 'order_items.return_count' ? 'order_items.returned' : this.selectedMetric === 'order_items.cancel_count' ? 'order_items.cancelled' : 'order_items.created';
   const dateDim = `${datePrefix}_${this.timeframe === 'day' ? 'date' : this.timeframe}`;
   const dateFilterField = `${datePrefix}_date`;
   const dateWindow = ({ day: '90 days', date: '90 days', week: '53 weeks', month: '60 months', year: '10 years' })[this.timeframe] || '90 days';
   ```
2. **Required Timeframe Switcher & Default Lookback Windows**:
   - Switching timeframe granularity between `day` (`date`), `week`, `month`, and `year` MUST default the date filter window to:
     - `day` (`date`): `'90 days'`
     - `week`: `'53 weeks'`
     - `month`: `'60 months'`
     - `year`: `'10 years'`
3. **Required Measure Switcher, Chart Type Switcher & Measure-Matched Date Dimensions**:
   - Allow switching between measures (`order_items.total_sale_price`, `order_items.count`, `order_items.return_count`, `order_items.cancel_count`) and chart types (`line`, `column`, `bar`, `areaspline`).
   - **Date dimension MUST match the selected measure**:
     - When `order_items.return_count` (or a return metric) is selected, use the **`returned`** date dimension group (`order_items.returned_date`, `order_items.returned_week`, `order_items.returned_month`, `order_items.returned_year`).
     - When `order_items.cancel_count` (or a cancel metric) is selected, use the **`cancelled`** date dimension group (`order_items.cancelled_date`, `order_items.cancelled_week`, `order_items.cancelled_month`, `order_items.cancelled_year`).
     - When standard order/revenue metrics (`order_items.total_sale_price`, `order_items.count`) are selected, use the **`created`** date dimension group (`order_items.created_date`, `order_items.created_week`, `order_items.created_month`, `order_items.created_year`).
