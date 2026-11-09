---
name: looker-dashboard
description: >
  Unified Looker Dashboarding skill (`skills/looker-dashboard/SKILL.md`) collating `looker-open-source/looker-skills`
  (`creating-looker-dashboard`, `looker-architect`), `googleapis/genai-toolbox` Looker MCP (`make_dashboard`,
  `add_dashboard_filter`, `add_dashboard_element`, `get_lookml_dashboard_examples`, `create_lookml_dashboard`),
  `lkrdev/looker-embed-demo` (`lookml-dashboard`, `lookml-dashboard-to-query`), `gcloud_gtm/looker-demo-cli`
  (`looker-visualizations`, `looker-vis-cartesian`, `looker-vis-tabular-kpi`, `looker-vis-specialty-maps`,
  `looker-vis-advanced-config`), `looker-field-profiler` (`profile_fields`), and `lkrdev/data-app-builder`
  Code Mode helpers (`upsert_udd`, `upsert_lookml_dashboard`, `reflow_24col`, `pin_to_board`, `schedule_dashboard`,
  `emit_native_bundle`).
---

# Unified Looker Dashboarding Skill (`looker-dashboard`)

Use this skill whenever creating, updating, refactoring, or validating Looker User-Defined Dashboards (UDDs), LookML Dashboards (`.dashboard.lookml`), Saved Looks, Boards, or Scheduled Plans across Looker Studio Code Mode (`run_looker_codemode`), Looker MCP Toolbox, or `lkr-dev-cli`.

---

## Step 1 — Field & Distribution Discovery with `profile_fields` (`skills/looker-field-profiler/SKILL.md`)

Before choosing chart types, pivots, filter controls, or date windows, profile candidate dimensions and measures via `profile_fields(model=m, view=e, fields=[...])` in `run_looker_codemode` (or `lkr code-mode sandbox`) and map its `suggested_tags` (`profile:*`) and `stats` directly to dashboard decisions:

| `profile_fields` Tag / Signal | Dashboard Visualization & Filter Action |
| :--- | :--- |
| `profile:low_cardinality_enum` ($\le 15$ distinct) | Safe for **`pivots:`**, stacked column/area series, `looker_pie` donuts (`limit: 6`), and `button_toggles` / `dropdown_menu` filters grounded in exact literals from `stats.top_values`. |
| `profile:medium_cardinality_categorical` ($16\text{–}100$) | Render as horizontal `looker_bar` or `looker_grid` with `limit: "20"`; **never pivot** (causes wide-table column explosion); use `dropdown_menu` or `tag_list` filter. |
| `profile:searchable_entity_label` ($> 100$) | Use only in top-$N$ ranked `looker_grid` / `looker_bar` leaderboards (`sorts: ["measure desc"]`, `limit: "25"`); configure filter with `ui_config: {type: "advanced", display: "popover"}`. |
| `profile:skewed_distribution` ($\frac{\|\text{avg}-\text{median}\|}{\|\text{median}\|} \ge 0.5$) | Pair `type: average` KPI scorecards with a `type: median` (`percentile` / `APPROX_QUANTILES`) measure so outliers do not distort executive scorecards. |
| `profile:nullable` (`null_pct > 0`) | Add element-level `filters: {"view.dim": "-NULL"}` on dimensional ranking/breakdown tiles so unmapped `null` buckets do not claim the #1 rank. |
| `profile:has_zeros` | Guard custom ratio denominators in LookML or table calculations with `nullif(${view.field}, 0)`. |
| `profile:rare_or_skewed_boolean` ($< 5\%$) | Use a filtered measure (`filters: [flag: "Yes"]`) or anomaly-rate `single_value` KPI instead of a 50/50 split chart where the minority slice is invisible. |
| `profile:spiky_year` / `profile:spiky_month` / `profile:spiky_day` | Inspect `stats.spikiness[grain]["trough_period"]` to exclude incomplete trailing periods in dashboard date filters (e.g. `"12 complete months"`) and overlay moving-average `reference_lines`. |

---

## Step 2 — Execution Workflows (Studio Code Mode, MCP Toolbox, & LookML CLI)

1. **Studio Code Mode (`run_looker_codemode`)**:
   - Execute the entire dashboard workflow in **ONE** `run_looker_codemode` call using pre-injected helpers:
     - `upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)`: Creates/updates a UDD, deduplicates `create_query`, wires `create_dashboard_filter` + `result_maker.filterables[].listen`, and positions all tiles on the 24-column grid via `dashboard_dashboard_layouts` + `update_dashboard_layout_component`.
     - `upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)`: Writes `dashboards/<slug>.dashboard.lookml` (`create_file` / `update_file`), ensures `include: "/dashboards/*.dashboard.lookml"` (or `include: "*.dashboard.lookml"`) in `{model}.model.lkml`, and imports/syncs a linked UDD into `folder_id` via `import_lookml_dashboard` / `sync_lookml_dashboard`.
     - `reflow_24col(dashboard_id, boxes)`: Reflows 24-column `dashboard_layout_components` in place.
     - `pin_to_board(title, description, section_title, dashboard_id=..., lookml_dashboard_id=..., look_id=...)`: Pins UDDs, LookML Dashboards, and Saved Looks to a Looker Board.
     - `schedule_dashboard(dashboard_id, name, crontab="0 9 * * 1", email="...", fmt="wysiwyg_pdf", filters_string="...")`: Attaches a Scheduled Plan (`create_scheduled_plan`).
     - `emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", id=..., title=..., **extra)`: Returns `NATIVE_CONTENT_BUNDLE` directly from `run_looker_codemode` (never call `update_session` inside `run_looker_codemode`).
   - Always include `[Open <Dashboard Title>](/dashboards/<id>)` at the end of every turn that creates or updates a Looker dashboard.
2. **Looker MCP Toolbox (`looker.yaml` / `looker-dev.yaml`)**:
   - **UDD 3-Step Sequence**: `make_dashboard` -> `add_dashboard_filter` (`field_filter` requires `model`, `explore`, and `dimension`) -> `add_dashboard_element` (every element name in `listens_to_filters` must already exist on the dashboard).
   - **LookML Dashboard Sequence**: `dev_mode(true)` -> `get_lookml_dashboard_examples` -> `create_lookml_dashboard(project_id, file_path="dashboards/<name>.dashboard.lookml", content=...)` -> `validate_project(project_id)`.
3. **Local LookML CLI (`lkr-dev-cli`)**:
   - Validate offline and push to Looker dev workspace:
     ```bash
     lkr parse lookml-to-api --path /workspace/lookml --validate
     lkr --dev tools lookml push /workspace/lookml --project-id <project_id> --file dashboards/<name>.dashboard.lookml --no-reset
     ```

---

## Step 3 — 24-Column `newspaper` Layout & Native Tabbed Architecture (`tabs:` + `tab_name:`)

1. **24-Column Grid (`layout: newspaper`, `preferred_viewer: dashboards-next`, `col + width <= 24`)**:
   - **Row 0 (`height: 4`)**: 3 (`width: 8` at `col: 0, 8, 16`) or 4 (`width: 6` at `col: 0, 6, 12, 18`) `single_value` KPI scorecards.
   - **Row 4 (`height: 8`)**: 2 side-by-side (`width: 12` at `col: 0, 12`) or `16 + 8` primary velocity/trend charts (`looker_line`, `looker_area`, dual-axis `looker_column`).
   - **Row 12 (`height: 8`)**: 2 (`width: 12`) or 3 (`width: 8`) segment breakdowns (`looker_bar`, `looker_pie` donut, `looker_funnel`, `looker_google_map`).
   - **Row 20 (`height: 8`)**: Full-width (`col: 0, width: 24`) `looker_grid` detail table (`table_theme: modern`).
2. **Native Tabbed Architecture (`tabs:` + `tab_name:`)**:
   - Consolidate multi-topic dashboards or dashboards with $> 25$ tiles into 2–4 native `tabs: [{name, label}]` at the dashboard root and assign each element `tab_name: <tab_id>`.
   - Each tab has its own independent 24-column coordinate system starting at `row: 0, col: 0`.
   - **Strictly prohibit HTML navigation bars** in `type: text` tiles.

---

## Step 4 — Four Canonical Dashboard Archetypes (`get_lookml_dashboard_examples`)

1. **Executive Pulse (`business_pulse`)**:
   - Row 0: 4 `single_value` KPI scorecards (`width: 6, height: 4`) with PoP comparison and sparklines.
   - Row 4: `looker_area` trend (`width: 16, height: 8`) + `looker_pie` donut share (`width: 8, height: 8`).
   - Row 12: `looker_column` cohort breakdown (`width: 12, height: 8`) + `looker_google_map` (`width: 12, height: 8`).
   - Row 20: Full-width `looker_grid` (`width: 24, height: 8`) with `series_cell_visualizations`.
2. **Entity / Brand Deep-Dive (`brand_lookup`)**:
   - Parameterized entity filter (`brand`, `account`, `merchant`) with top-line performance scorecards, category affinity bars, regional heatmap, and item-level leaderboard.
3. **360° Single-Entity Inspector (`customer_lookup` with `looker_single_record`)**:
   - Combines a `looker_single_record` profile card (`show_null_labels: false`, `width: 8, height: 8`) with lifetime value KPIs and chronological order/activity `looker_grid` history.
4. **Funnel & Conversion Overview (`web_analytics_overview` with `looker_funnel`)**:
   - Pairs a stage-drop-off `looker_funnel` (`percent_type: percent_of_previous` or `percent_of_max`) with session/conversion trend lines and traffic-source attribution tables.

---

## Step 5 — Visualization Selection Matrix & Query Shape Rules (All 22 Types)

- **`single_value`**:
  - **Pattern A (Timeframe Row Comparison + Sparkline)**: 1 date dimension + 1 measure (`sorts: [date desc]`, `limit: 2`, `show_comparison: true`, `comparison_type: change_percentage`, `comparison_row: first`, `show_chart_component: true`).
  - **Pattern B (Two-Measure PoP Comparison)**: 0 dimensions, 2 measures (`[current_measure, change_measure]`, `show_comparison: true`, `comparison_type: change`, `comparison_reverse_colors: true` when lower is better such as error rate, latency, or returns).
- **`looker_grid`**:
  - Always set `table_theme: modern`, `show_view_names: false`, `size_to_fit: true`, `enable_conditional_formatting: true`, and `series_cell_visualizations` on primary measures.
- **Cartesian Dual Y-Axes Rule (`looker_line`, `looker_column`, `looker_area`, `looker_bar`, `looker_scatter`)**:
  - When plotting 2 measures with different units (e.g. Revenue `$` and Margin `%`), set `y_axis_combined: false`, `y_axis_unpinned: true`, and `y_axes[].series` **MUST** be objects `[{id: "view.m", name: "Label", axisId: "view.m"}]` — **never** plain strings, which crash the Looker frontend with `Cannot create property 'id' on string`.
  - Valid `legend_position` values: `center`, `top`, `right`, `none` (**never** `bottom` or `left`).
- **Donut (`looker_pie`)**:
  - Strictly 1 dimension, 1 measure, 0 pivots, `limit: 6`, `show_donut: true`, `inner_radius: 50`, `value_labels: legend`, `label_type: labPer` (never use `looker_donut_multiples` for a single unpivoted measure).
- **Maps (`looker_google_map`, `looker_map`, `looker_geo_choropleth`, `looker_geo_coordinates`)**:
  - Always bound marker sizes (`map_marker_radius_min: 3`, `map_marker_radius_max: 25`, `map_plot_mode: automagic_heatmap` or `points`) to prevent outlier bubbles from obscuring the map.
- **Additional Supported Types**: `looker_waterfall`, `looker_boxplot`, `looker_histogram`, `looker_funnel`, `looker_timeline`, `looker_sankey`, `treemap`, `sunburst`, `looker_wordcloud`, `looker_bullet`, `looker_single_record`, `table`.

---

## Step 6 — Highcharts `advanced_vis_config` Guardrails

1. **Allowed vs. Forbidden Visualization Types**:
   - **Allowed (14 Highcharts types only)**: `looker_column`, `looker_bar`, `looker_line`, `looker_area`, `looker_scatter`, `looker_pie`, `looker_funnel`, `looker_timeline`, `looker_waterfall`, `looker_boxplot`, `looker_wordcloud`, `looker_histogram`, `looker_bullet`, `looker_sankey`.
   - **Forbidden**: Never attach `advanced_vis_config` to `single_value`, `looker_grid`, `table`, `looker_single_record`, `looker_google_map`, `looker_map`, `looker_geo_choropleth`, or `looker_geo_coordinates`.
2. **Strict JSON & Security Rules**:
   - Always set `defaults_version: 1` on the element and pass valid JSON (no trailing commas, no comments).
   - **No JavaScript functions or `formatter` keys**: Looker strips executable JS. Use Highcharts `format` template strings (e.g. `"{point.y:,.0f}"`) or Looker's declarative `formatters: [{"select": "max", "style": {"color": "#10B981"}}]`.
   - Use rounded bar geometry (`borderRadius: 8`) and transparent chart backgrounds (`"backgroundColor": "rgba(0, 0, 0, 0)"`) so embedded dashboards inherit Light/Dark host themes cleanly.

---

## Step 7 — Filter Architecture, YAML Safety & Self-Healing Query Verification (`lookml-dashboard-to-query`)

1. **YAML Quoting & Identifier Rules**:
   - Double-quote all user-facing strings (`title`, `name`, `tab_name`, `label`, `subtitle`) so colons (`:`) or `#` never break YAML parsing.
   - Filter and element `name:` identifiers must **never** contain periods (`.`); use `snake_case` underscores (e.g. `date_range`, `order_status`).
2. **Filter Wiring & RLS Governance**:
   - Set root `crossfilter_enabled: true`.
   - Use `type: field_filter` with explicit `model`, `explore`, `field`, and `ui_config` (`display: inline` for primary filters, `display: popover` for secondary filters), cascading dependent filters via `listens_to_filters`.
   - Omit UI dashboard filters for fields already enforced by model-level `access_filter` (Row-Level Security).
3. **Self-Healing SQL Query Verification (`lookml-dashboard-to-query`)**:
   - `validate_project` checks LookML syntax only. To guarantee zero runtime tile errors, extract every element's query (and deconstruct `result_maker.query_IDs` for Merge Results) and verify SQL generation via `run_inline_query("sql", body)` (or `run_query(query_id, "json", limit=5)`).
   - If a tile references a missing field, self-heal by adding the dimension or measure to `bronze/<table>.refinement.lkml` (never hand-editing `# AUTOGENERATED` `bronze/<table>.view.lkml`), re-running `validate_project`, and syncing via `sync_lookml_dashboard`.
