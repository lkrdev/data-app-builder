---
name: looker-dashboard
description: Unified Looker Dashboarding skill (`skills/looker-dashboard/SKILL.md`) for UDDs, LookML Dashboards (`.dashboard.lookml`), Looks, Boards, Schedules, `profile_fields`, Highcharts `advanced_vis_config`, and `lookml-dashboard-to-query`.
---

# Unified Looker Dashboarding Skill (`looker-dashboard`)

Create, update, and validate UDDs, LookML Dashboards (`.dashboard.lookml`), Looks, Boards, and Schedules via `run_looker_codemode`, Looker MCP, or `lkr-dev-cli`.

## Step 1 — Field & Distribution Discovery (`profile_fields`)
Profile fields via `profile_fields(model=m, view=e, fields=[...])` (`skills/looker-field-profiler/SKILL.md`):
- `profile:low_cardinality_enum` (<= 15): Safe for `pivots:`, stacked series, `looker_pie` (`limit: 6`), and `stats.top_values` filters.
- `profile:medium_cardinality_categorical` (16–100): `looker_bar`/`looker_grid` (`limit: "20"`); **never pivot**.
- `profile:searchable_entity_label` (> 100): Top-N `looker_grid`/`looker_bar` (`sorts: ["measure desc"]`, `limit: "25"`); `ui_config: {type: "advanced", display: "popover"}`.
- `profile:skewed_distribution`: Pair `average` with `median` (`APPROX_QUANTILES`).
- `profile:nullable`: Add `filters: {"view.dim": "-NULL"}` on breakdowns.
- `profile:has_zeros`: Guard denominators with `nullif(${view.field}, 0)`.
- `profile:rare_or_skewed_boolean` (< 5%): Filtered measure or rate `single_value` KPI.
- `profile:spiky_year` / `profile:spiky_month` / `profile:spiky_day`: Exclude incomplete `stats.spikiness[grain]["trough_period"]`.

## Step 2 — Execution Workflows, Compile Gate & Clean Chat Summary Rule
1. **Studio Code Mode (`run_looker_codemode`, 1 call, never `update_session`)**:
   - `upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)`: Gates `lookml_model_explore` + 1-row `run_inline_query("json_detail", ..., limit="1")` SQL per Explore (propagating `default_value` across `listen:` + tile `filters` for partition pruning, with filter-error-only fallback), creates/updates UDD, deduplicates `create_query`, wires `listen`, and lays out 24-col grid.
   - `upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)`: When `tiles` are passed (omitting `yaml_content`), gates `lookml_model_explore` + partition-pruned 1-row `json_detail` SQL and normalizes field filters to `type: field_filter` (always set a concrete `default_value` on date filters for large tables); writes `dashboards/<slug>.dashboard.lookml`, wires `include:`, gates `validate_project(project_id)` (`ValueError` on `"fatal"` & `"warning"` `Unknown field`), and imports/syncs into `folder_id`.
   - `reflow_24col(dashboard_id, boxes)`, `pin_to_board(...)`, `schedule_dashboard(...)`, `emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", ...)`.
2. **Clean Summary Rule**: **NEVER** include coordinates (`Row 0`, `col`, `width`, `height`, `24-Column Grid`) or vis identifiers (`single_value`, `looker_area`, `looker_pie`, `looker_column`, `looker_bar`, `looker_grid`) in chat replies; summarize tiles/filters and end with `[Open <Dashboard Title>](/dashboards/<id>)`.
3. **MCP & CLI**: MCP `make_dashboard`/`create_lookml_dashboard`; CLI `lkr parse lookml-to-api --path /workspace/lookml --validate` && `lkr --dev tools lookml push /workspace/lookml --project-id <project_id> --file dashboards/<name>.dashboard.lookml --no-reset`.

## Step 3 — 24-Column `newspaper` Layout & Native `tabs:`
1. **24-Column Grid (`layout: newspaper`, `preferred_viewer: dashboards-next`, `col + width <= 24`)**: Row 0 (`height: 4`): 3 (`width: 8`, `col: 0, 8, 16`) or 4 (`width: 6`) `single_value` KPIs; Row 4 (`height: 8`): 2 (`width: 12`) trend charts (`looker_line`, `looker_area`, `looker_column`); Row 12 (`height: 8`): breakdowns (`looker_bar`, `looker_pie`, `looker_funnel`, `looker_google_map`); Row 20 (`height: 8`): `col: 0, width: 24` `looker_grid` (`table_theme: modern`).
2. **Native Tabs (`tabs:` + `tab_name:`)**: Group multi-topic or $> 25$-tile dashboards into 2–4 root `tabs: [{name, label}]`; forbid HTML nav bars in `type: text` tiles.

## Step 4 — Four Canonical Archetypes (`get_lookml_dashboard_examples`)
1. **Executive Pulse (`business_pulse`)**: 4 PoP `single_value` KPIs + `looker_area` & `looker_pie` + `looker_column` & `looker_google_map` + `looker_grid`.
2. **Entity Deep-Dive (`brand_lookup`)**: Entity filter + scorecards, affinity bars, map, leaderboard.
3. **360° Inspector (`customer_lookup`)**: `looker_single_record` (`show_null_labels: false`) + KPIs + chronological `looker_grid`.
4. **Funnel (`web_analytics_overview`)**: `looker_funnel` + conversion trends + attribution grid.

## Step 5 — Visualization Matrix & Query Shape Rules (All 22 Types)
- **`single_value`**: 1 date dim + 1 measure (`sorts: [date desc]`, `limit: 2`, `show_comparison: true`, `comparison_type: change_percentage`) or 2 measures (`comparison_reverse_colors: true` when lower is better).
- **`looker_grid`**: `table_theme: modern`, `show_view_names: false`, `size_to_fit: true`, `enable_conditional_formatting: true`, `series_cell_visualizations`.
- **Cartesian Dual Y-Axes (`looker_line`, `looker_column`, `looker_area`, `looker_bar`, `looker_scatter`)**: `y_axis_combined: false`, `y_axis_unpinned: true`, and `y_axes[].series` **MUST** be objects `[{id: "view.m", name: "Label", axisId: "view.m"}]`.
- **Donut (`looker_pie`)**: 1 dim, 1 measure, 0 pivots, `limit: 6`, `show_donut: true`, `inner_radius: 50`.
- **Maps & Others**: `looker_google_map`, `looker_map`, `looker_geo_choropleth`, `looker_geo_coordinates` (`map_marker_radius_min: 3`, `map_marker_radius_max: 25`); `looker_waterfall`, `looker_boxplot`, `looker_histogram`, `looker_funnel`, `looker_timeline`, `looker_sankey`, `treemap`, `sunburst`, `looker_wordcloud`, `looker_bullet`, `looker_single_record`, `table`.

## Step 6 — Highcharts `advanced_vis_config` Guardrails
1. **Allowed (14 Highcharts types only)**: `looker_column`, `looker_bar`, `looker_line`, `looker_area`, `looker_scatter`, `looker_pie`, `looker_funnel`, `looker_timeline`, `looker_waterfall`, `looker_boxplot`, `looker_wordcloud`, `looker_histogram`, `looker_bullet`, `looker_sankey` (never `single_value`, `looker_grid`, `table`, `looker_single_record`, or maps).
2. **JSON & Security**: `defaults_version: 1`, valid JSON, zero JS `formatter` functions (use `format` strings like `"{point.y:,.0f}"`), `borderRadius: 8`, `"backgroundColor": "rgba(0, 0, 0, 0)"`.

## Step 7 — YAML Safety, Medallion Field Scoping & Self-Healing (`lookml-dashboard-to-query`)
1. **YAML & Filters**: Quote strings; `snake_case` `name:` without periods; `crossfilter_enabled: true`; use `type: field_filter` whenever `model`/`explore`/`field` is set (reserve `type: date_filter`/`number_filter`/`string_filter` for fieldless filters without `model`/`explore`/`field`/`allow_multiple_values`); omit `access_filter` duplicates.
2. **Medallion Scoping**: Keep `bronze/<fact>.refinement.lkml` **single-table** (cross-view fields in `silver/`), and **never** set `fields: [ALL_FIELDS*, -...]` exclusions on `<fact>_base` when extended by Silver.
3. **Self-Healing (`lookml-dashboard-to-query`)**: Verify tile SQL via `run_inline_query("sql", body)`, add missing fields to `bronze/` or `silver/`, re-run `validate_project`, and `sync_lookml_dashboard`.
