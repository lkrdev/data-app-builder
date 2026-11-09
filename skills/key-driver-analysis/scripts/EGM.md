# Key Driver Analysis Scripts

## Overview

`skills/key-driver-analysis/scripts` contains `kda_toolkit.py`, a Monty-sandbox-compatible Looker Key Driver Analysis (KDA) toolkit executed via `lkr code-mode sandbox`. It resolves heterogeneous Looker targets (Dashboards, Looks, Conversational Analytics Conversations, Explore URLs, and Query slugs), inspects LookML explores dynamically for additive measures and macro business dimensions, decomposes non-additive ratio/average measures, executes native `run_key_driver_analysis` or an Apriori cohort fallback over `run_inline_query`, performs Pass 2 recursive root-cause drilling, and prints a compact pipe-delimited summary.

## Interface

- `[kda_toolkit.py:TIME_SUFFIXES]`: Tuple of 12 time-dimension suffix strings (`_date`, `_time`, `_year`, `_month`, `_quarter`, `_week`, `_day`, `_raw`, `_hour`, `_minute`, `_fiscal_year`, `_fiscal_quarter`) used to detect timeframe fields.
- `[kda_toolkit.py:MACRO_TOKENS]`: Tuple of 12 ranked categorical dimension name suffixes (`status`, `department`, `traffic_source`, `gender`, `country`, `event_type`, `channel`, `segment`, `category`, `browser`, `state`, `brand`).
- `[kda_toolkit.py:resolve_source]`: `resolve_source(target) -> dict` returning `{"type", "id", "title", "targets"}` normalized from a Dashboard URL/ID, Look URL/ID, Conversation URL/ID, Explore URL, or Query slug.
- `[kda_toolkit.py:inspect_explore_for_kda]`: `inspect_explore_for_kda(model_name, explore_name) -> dict` returning `{"additive_measures", "measure_map", "timeframes", "candidate_dimensions"}`.
- `[kda_toolkit.py:decompose_measure]`: `decompose_measure(measure_name, explore_info) -> list[str]` mapping a measure to additive component measure names.
- `[kda_toolkit.py:run_kda]`: `run_kda(model_name, explore_name, contribution_metric, dimensions, baseline_filters, breach_filters, base_filters=None, min_support=0.05, top_k=5) -> dict` returning `status`, `dimensions`, `drivers`, and optional `dropped_null_rows` or `error`.
- `[kda_toolkit.py:drill_top_driver]`: `drill_top_driver(model_name, explore_name, contribution_metric, pass1_result, drill_dimensions, baseline_filters, breach_filters, base_filters=None, sub_timeframe=None, explore_info=None) -> dict` returning `locked_driver`, `pass2_kda`, `breach_sub_trend`, `unit_economics`, and `follow_up_questions` (or `{"status": "NO_DRILLABLE_DRIVER"}`).
- `[kda_toolkit.py:analyze_target]`: `analyze_target(target, baseline_filters, breach_filters, explore_info=None, drill=False, sub_timeframe=None, top_k=6) -> dict` returning `{"title", "model", "explore", "original_measures", "results"}`.
- `[kda_toolkit.py:print_kda_summary]`: `print_kda_summary(out) -> None` printing compact pipe-delimited summary lines for `analyze_target` output(s).

## Invariants

- `[kda_toolkit.py:resolve_source]`: Decodes `+` and `%20` in URL query strings to spaces, maps `f[<field>]` parameters to filter key `<field>`, skips dashboard elements lacking a `query` (or `result_maker.query`) with both `model` and `view`, and falls back to `sources[0]` on Conversations only when no `generatedLookerQuery` turns exist.
- `[kda_toolkit.py:inspect_explore_for_kda]`: Excludes views joined with `type == "inner"` or containing Liquid (`{%` in any dimension `sql`) from both `additive_measures` and `candidate_dimensions`.
- `[kda_toolkit.py:inspect_explore_for_kda]`: Restricts `additive_measures` to non-hidden measures with `type in {"sum", "count", "sum_distinct"}`; excludes `hidden`, `primary_key`, `is_timeframe`, `date*` types, types in `("location", "zipcode", "distance", "number")`, ID/URL/name/PII suffixes, and derived/geo/window tokens from `candidate_dimensions`, sorting `macro_dims` by `(not base_explore_prefix, MACRO_TOKENS.index)` before `other_str` and `yesno_dims`.
- `[kda_toolkit.py:decompose_measure]`: Passes through `sum`/`count`/`sum_distinct` and unknown measures unchanged; decomposes `average`/`average_distinct`/`median` into same-view `sum`/`sum_distinct` measures with matching `sql` (preferring unfiltered) plus `<view>.count` when present; extracts unique `${...}` measure references in `measure_map` for `type == "number"`.
- `[kda_toolkit.py:run_kda]`: Strips `_is_time_field` keys from `base_filters` whenever `baseline_filters` or `breach_filters` contains a time field, and caps `dimensions` at 6 (`[:6]`).
- `[kda_toolkit.py:run_kda]`: Invokes native `run_key_driver_analysis` only when `min_support == 0.1 and top_k == 5`; otherwise (or if native raises or lacks `drivers`) falls back to `run_inline_query` cohort queries with `limit: "50000"`.
- `[kda_toolkit.py:run_kda]`: Cohort fallback returns `status: "FAILED"` when `ctrl_rows` or `test_rows` is empty, no dimensions have non-null values, or `tot_test <= 0 and tot_ctrl <= 0`; retains dimensions with `>= 0.75 * len(test_rows)` non-null rows (or any non-null if none qualify), drops rows with `None` in kept dimensions, caps cardinality to top 60 `test_rows` values (`__OTHER__` otherwise), discards itemsets with `> 1` `__OTHER__` or `apriori_support < min_support` or `if idxs and t_rest == 0.0 and c_rest == 0.0` (preserving the `["all"]` headline itemset), assigns `archetype` from `{"HEADLINE_TOTAL", "COUNTER_TREND_OFFSET", "TIDE_FOLLOWER", "HIDDEN_DRAG", "OUTLIER_SURGE", "PRIMARY_ACCELERATOR"}`, prunes strict subset drivers sharing `(metric_test, metric_control, difference, apriori_support)` (except `["all"]`), sorts descending by `contribution`, and caps at `top_k` when truthy.
- `[kda_toolkit.py:drill_top_driver]`: Locks the first driver in `pass1_result["drivers"]` where `drivers != ["all"]` and no token ends with `_is_other` (returning `{"status": "NO_DRILLABLE_DRIVER"}` otherwise), strips time fields from `base_filters` when baseline/breach filters include one, excludes locked dimensions from `next_dims` (capped at 6), runs Pass 2 `run_kda` with `min_support=0.02, top_k=5`, queries `sub_timeframe` with `limit: "50"` (returning `trend_rows[:12]`), and queries unit economics with `limit: "1"`.
- `[kda_toolkit.py:analyze_target]`: Falls back to `info["additive_measures"][:1]` when no fields in `target["fields"]` appear in `measure_map`, excludes measures, timeframes, `_is_time_field` fields, and `target["filters"]` keys from `dims` (capped at 6), deduplicates decomposed component runs, and triggers `drill_top_driver` only when `drill` is truthy and `kda_res.get("status") == "SUCCESS"`.

## Side Effects

- `[kda_toolkit.py:resolve_source]`: Issues Looker/sandbox read RPCs depending on target type: `dashboard(did)`, `look(lid)`, `query(lk["query_id"])`, `get_conversation(clean_id)`, `all_conversation_messages(clean_id)`, and `query_for_slug(...)`.
- `[kda_toolkit.py:inspect_explore_for_kda]`: Issues `lookml_model_explore(model_name, explore_name, fields="fields,joins")`.
- `[kda_toolkit.py:run_kda]`: Issues `run_key_driver_analysis(body=...)` (when `min_support == 0.1 and top_k == 5`) and/or two `run_inline_query("json", ...)` queries for control and test cohorts.
- `[kda_toolkit.py:drill_top_driver]`: Issues `run_kda` (executing two `run_inline_query` calls since `min_support=0.02`), an optional `run_inline_query("json", ...)` for `sub_timeframe` trend, and two `run_inline_query("json", ...)` calls for unit-economics control/test verification.
- `[kda_toolkit.py:analyze_target]`: Transitively triggers `inspect_explore_for_kda`, `run_kda`, and (when `drill=True` and status is `SUCCESS`) `drill_top_driver`.
- `[kda_toolkit.py:print_kda_summary]`: Writes formatted summary lines to stdout via `print(...)` (directly and via `_print_drv_block`).

## Verification

- Run: `npm test`
