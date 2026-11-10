---
name: looker-dashboard
description: >
  Unified Looker Dashboarding skill (`skills/looker-dashboard/SKILL.md`) collating `creating-looker-dashboard`,
  `looker-architect`, Looker MCP (`make_dashboard`, `add_dashboard_filter`, `add_dashboard_element`,
  `get_lookml_dashboard_examples`, `create_lookml_dashboard`), `lookml-dashboard`, `lookml-dashboard-to-query`,
  `looker-visualizations`, `looker-field-profiler` (`profile_fields`), and Code Mode helpers (`upsert_udd`,
  `upsert_lookml_dashboard`, `reflow_24col`, `pin_to_board`, `schedule_dashboard`, `emit_native_bundle`).
---

# Unified Looker Dashboarding Skill (`looker-dashboard`)

Create, update, and validate Looker User-Defined Dashboards (UDDs), LookML Dashboards (`.dashboard.lookml`), Saved Looks, Boards, and Scheduled Plans across Studio Code Mode (`run_looker_codemode`), Looker MCP Toolbox, or `lkr-dev-cli`.

---

## Step 1 — Field & Distribution Discovery (`profile_fields`)

Profile candidate fields via `profile_fields(model=m, view=e, fields=[...])` (`skills/looker-field-profiler/SKILL.md`) before selecting chart types, pivots, or filters:

| `profile_fields` Tag | Visualization & Filter Rule |
| :--- | :--- |
| `profile:low_cardinality_enum` (<= 15) | Safe for **`pivots:`**, stacked series, `looker_pie` donuts (`limit: 6`), and `button_toggles`/`dropdown_menu` filters using exact `stats.top_values` literals. |
| `profile:medium_cardinality_categorical` (16–100) | Horizontal `looker_bar` or `looker_grid` (`limit: "20"`); **never pivot**; `dropdown_menu`/`tag_list` filter. |
| `profile:searchable_entity_label` (> 100) | Top-N `looker_grid`/`looker_bar` (`sorts: ["measure desc"]`, `limit: "25"`); `ui_config: {type: "advanced", display: "popover"}`. |
| `profile:skewed_distribution` | Pair `type: average` scorecards with `type: median` (`percentile` / `APPROX_QUANTILES`). |
| `profile:nullable` (`null_pct > 0`) | Add `filters: {"view.dim": "-NULL"}` on ranking/breakdown tiles so `null` does not claim #1. |
| `profile:has_zeros` | Guard ratio denominators with `nullif(${view.field}, 0)`. |
| `profile:rare_or_skewed_boolean` (< 5%) | Filtered measure (`filters: [flag: "Yes"]`) or anomaly-rate `single_value` KPI instead of 50/50 split chart. |
| `profile:spiky_year` / `profile:spiky_month` / `profile:spiky_day` | Inspect `stats.spikiness[grain]["trough_period"]` to exclude incomplete trailing periods and overlay moving-average `reference_lines`. |

---

## Step 2 — Execution Workflows, Compile Gate & Clean Chat Summary Rule

1. **Studio Code Mode (`run_looker_codemode`)**:
   - Execute in **ONE** `run_looker_codemode` call using pre-injected helpers (never call `update_session`):
     - `upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)`: Verifies all tile `fields`, `pivots`, `sorts`, and filter `field`s exist in `lookml_model_explore`, creates/updates a UDD, deduplicates `create_query`, wires `listen`, and positions tiles on the 24-column grid.
     - `upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)`: Verifies fields against `lookml_model_explore`, writes `dashboards/<slug>.dashboard.lookml`, wires `include:` in `{model}.model.lkml`, runs `validate_project(project_id)` (raising `ValueError` on **both** `"fatal"` and `"warning"` diagnostics referencing the dashboard file or `Unknown field`, which otherwise strip tile `fields` to `[]` -> `"Must query at least one dimension or measure"`), and imports/syncs into `folder_id`.
     - `reflow_24col(dashboard_id, boxes)`, `pin_to_board(...)`, `schedule_dashboard(...)`, `emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", ...)`.
2. **Clean User-Facing Summary Rule (Mandatory)**:
   - **NEVER** include layout coordinates (`Row 0`, `col`, `width`, `height`, `24-Column Grid`) or internal Looker vis-type identifiers (`single_value`, `looker_area`, `looker_pie`, `looker_column`, `looker_bar`, `looker_grid`) in user-facing chat replies.
   - Focus strictly on the created tiles, filters, what each tile measures, and end with `[Open <Dashboard Title>](/dashboards/<id>)`.
3. **Looker MCP Toolbox & Local CLI (`lkr-dev-cli`)**:
   - MCP UDD: `make_dashboard` -> `add_dashboard_filter` -> `add_dashboard_element`. MCP LookML: `dev_mode(true)` -> `get_lookml_dashboard_examples` -> `create_lookml_dashboard` -> `validate_project`.
   - CLI: `lkr parse lookml-to-api --path /workspace/lookml --validate` && `lkr --dev tools lookml push /workspace/lookml --project-id <project_id> --file dashboards/<name>.dashboard.lookml --no-reset`.

---

## Step 3 — 24-Column `newspaper` Layout & Native `tabs:`

1. **24-Column Grid (`layout: newspaper`, `preferred_viewer: dashboards-next`, `col + width <= 24`)**:
   - Row 0 (`height: 4`): 3 (`width: 8` at `col: 0, 8, 16`) or 4 (`width: 6` at `col: 0, 6, 12, 18`) `single_value` KPIs.
   - Row 4 (`height: 8`): 2 (`width: 12`) or `16 + 8` primary trend charts (`looker_line`, `looker_area`, dual-axis `looker_column`).
   - Row 12 (`height: 8`): 2 (`width: 12`) or 3 (`width: 8`) breakdowns (`looker_bar`, `looker_pie`, `looker_funnel`, `looker_google_map`).
   - Row 20 (`height: 8`): Full-width (`col: 0, width: 24`) `looker_grid` (`table_theme: modern`).
2. **Native Tabs (`tabs:` + `tab_name:`)**: Consolidate multi-topic or $> 25$-tile dashboards into 2–4 root `tabs: [{name, label}]` with independent `row: 0, col: 0` grids per `tab_name`. Prohibit HTML nav bars in `type: text` tiles.

---

## Step 4 — Four Canonical Archetypes (`get_lookml_dashboard_examples`)

1. **Executive Pulse (`business_pulse`)**: 4 PoP `single_value` KPIs + `looker_area` trend & `looker_pie` donut + `looker_column` cohort & `looker_google_map` + full-width `looker_grid` (`series_cell_visualizations`).
2. **Entity / Brand Deep-Dive (`brand_lookup`)**: Parameterized entity filter + scorecards, affinity bars, regional map, and item leaderboard.
3. **360° Inspector (`customer_lookup`)**: `looker_single_record` (`show_null_labels: false`) + lifetime KPIs + chronological `looker_grid`.
4. **Funnel Overview (`web_analytics_overview`)**: `looker_funnel` (`percent_of_previous` / `percent_of_max`) + conversion trends + attribution grid.

---

## Step 5 — Visualization Matrix & Query Shape Rules (All 22 Types)

- **`single_value`**: Pattern A (1 date dim + 1 measure, `sorts: [date desc]`, `limit: 2`, `show_comparison: true`, `comparison_type: change_percentage`, `show_chart_component: true`) or Pattern B (0 dims, 2 measures, `comparison_type: change`, `comparison_reverse_colors: true` when lower is better).
- **`looker_grid`**: `table_theme: modern`, `show_view_names: false`, `size_to_fit: true`, `enable_conditional_formatting: true`, `series_cell_visualizations`.
- **Cartesian Dual Y-Axes (`looker_line`, `looker_column`, `looker_area`, `looker_bar`, `looker_scatter`)**: Set `y_axis_combined: false`, `y_axis_unpinned: true`, and `y_axes[].series` **MUST** be objects `[{id: "view.m", name: "Label", axisId: "view.m"}]` (never plain strings). `legend_position`: `center`|`top`|`right`|`none`.
- **Donut (`looker_pie`)**: 1 dim, 1 measure, 0 pivots, `limit: 6`, `show_donut: true`, `inner_radius: 50`, `value_labels: legend`, `label_type: labPer`.
- **Maps (`looker_google_map`, `looker_map`, `looker_geo_choropleth`, `looker_geo_coordinates`)**: Bound `map_marker_radius_min: 3`, `map_marker_radius_max: 25`, `map_plot_mode: automagic_heatmap`|`points`.
- **Other Supported Types**: `looker_waterfall`, `looker_boxplot`, `looker_histogram`, `looker_funnel`, `looker_timeline`, `looker_sankey`, `treemap`, `sunburst`, `looker_wordcloud`, `looker_bullet`, `looker_single_record`, `table`.

---

## Step 6 — Highcharts `advanced_vis_config` Guardrails

1. **Allowed (14 Highcharts types only)**: `looker_column`, `looker_bar`, `looker_line`, `looker_area`, `looker_scatter`, `looker_pie`, `looker_funnel`, `looker_timeline`, `looker_waterfall`, `looker_boxplot`, `looker_wordcloud`, `looker_histogram`, `looker_bullet`, `looker_sankey`. Never attach to `single_value`, `looker_grid`, `table`, `looker_single_record`, or map types.
2. **JSON & Security**: Set `defaults_version: 1`, valid JSON only, zero JS `formatter` functions (use `format` strings like `"{point.y:,.0f}"` or declarative `formatters`), `borderRadius: 8`, and `"backgroundColor": "rgba(0, 0, 0, 0)"`.

---

## Step 7 — YAML Safety, Medallion Field Scoping & Self-Healing (`lookml-dashboard-to-query`)

1. **YAML & Filters**: Double-quote user-facing strings; filter/element `name:` identifiers must use `snake_case` without periods (`.`); set `crossfilter_enabled: true`, `type: field_filter` with explicit `model`/`explore`/`field`/`ui_config`, and omit filters already enforced by `access_filter`.
2. **Medallion Field Scoping (Prevent Excluded/Unknown Fields)**: Keep `bronze/<fact>.refinement.lkml` strictly **single-table** (cross-view measures referencing joined views belong in `silver/`), and **never** set `fields: [ALL_FIELDS*, -...]` exclusions on `<fact>_base` when Silver `extends: [<fact>_base]` (inherited exclusions hide fields from dashboards and strip tile `fields` to `[]`).
3. **Self-Healing SQL Verification (`lookml-dashboard-to-query`)**: Verify every tile query via `run_inline_query("sql", body)` (deconstructing `result_maker.query_IDs` for Merge Results). Add missing single-table fields to `bronze/<table>.refinement.lkml` or cross-view fields to `silver/`, re-run `validate_project`, and sync via `sync_lookml_dashboard`.
