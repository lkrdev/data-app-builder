---
name: looker-field-profiler
description: >
  Profile Looker Explore fields (`string`, `number`, `yesno`, `datetime`) using `profile_fields` in
  `lkr code-mode sandbox` or `ExtendedLooker40SDK`. Computes `APPROX_COUNT_DISTINCT` & `APPROX_QUANTILES`
  (`limit=5000`, `total=True`), expands date/time grains for temporal spikiness, walks measure leaf
  dimensions, and emits `profile:*` `suggested_tags`, `decisions`, and `curation.lookml_snippet`.
---

# Looker Field Value Profiler (`looker-field-profiler`)

`profile_fields` is pre-bound as a global in `run_looker_codemode` / `lkr code-mode sandbox` (no imports or `sdk.` prefix) and profiles Explore dimensions and measures within Looker's `5000`-row cap (`limit="5000"`, `total=True`).

## 1. Signature & Invocation

```python
profile_fields(
    body=None, model=None, view=None, fields=None, filters=None,
    types_only=False,   # Metadata-only bucketing (0 SQL queries)
    group_fields=False, # 1 combined query for non-datetime fields -> grouped_rows
    limit=5000,
)
```

- **Measures & `dimension_group`s**: Passing a measure evaluates its scalar total in `"measures"` and profiles its leaf `${...}` dimensions; bare `dimension_group` names resolve to `_date`/`_time`.
- **Return dict**: `type_buckets` (`string`/`number`/`yesno`/`datetime`), `profiles[field]` (`root_type`, `subtype`, `total_rows`, `approx_count_distinct`, `null_count`, `null_pct`, `stats` with `top_values` / `spikiness` / `subtotals_by_grain`, `suggested_tags`, `decisions`, `curation` with `recommended_hidden`, `recommended_suggestable`, `recommended_description`, `lookml_snippet`), `measures`, and `grouped_rows`.

## 2. Subtypes & `profile:*` Tags

- **Cross-type**: `profile:foreign_key` (non-PK `*_id`/`*_fk`), `profile:nullable` (`null_count > 0`), `profile:unique_key_candidate` (`approx_count_distinct == total_rows`, `null_count == 0`).
- **`string` (first match wins)**:
  1. `tier`/`location` -> `profile:tier` (`suggestable: yes`) / `profile:location` (`suggestable: no`).
  2. `json` -> `profile:json_payload` (`hidden: yes`, `suggestable: no`).
  3. `id_or_code` (UUID/hash) -> `profile:uuid_or_hash` (`hidden: yes`, `suggestable: no`).
  4. `id_or_code` (PK, `_fivetran_*`/`_airbyte_*`/`_sdc_*`/`etl_*`, or `*_id` > 100 distinct) -> `hidden: yes`, `suggestable: no`.
  5. `empty_or_null` -> `profile:empty_or_null_only` (`hidden: yes`, `suggestable: no`).
  6. `free_text` (`max_length > 120` / `avg_length > 60` / notes) -> `profile:opaque_code_or_free_text` (`hidden: no`, `suggestable: no`).
  7. `id_or_code` (`sku`/`code`/`zip`/`email`/`phone`/`url`/`ip`/`token`) -> `profile:opaque_code_or_free_text` (`hidden: no`, `suggestable: no`).
  8. `enum` ($1..15$) -> `profile:low_cardinality_enum` (`suggestable: yes`).
  9. `categorical` ($16..100$) -> `profile:medium_cardinality_categorical` (`suggestable: yes`).
  10. `entity_label` ($> 100$) -> `profile:searchable_entity_label` (`suggestable: yes`).
  - PII: `profile:pii` + `profile:email` / `profile:phone` (or SSN/tax/name/address/IP tokens).
- **`number`**: `empty_or_null` (`profile:empty_or_null_only`, `hidden: yes`), `id_or_key` (`hidden: yes`), `constant` (`profile:constant_value`), `duration` (`profile:duration`), `percentage_or_ratio` (`profile:percentage_or_ratio`), `currency_or_decimal` (`profile:currency_or_decimal`), `discrete_integer` (`profile:discrete_integer`), `continuous_number` (`profile:continuous_number`); plus `profile:has_zeros`, `profile:has_negatives`, `profile:skewed_distribution` ($|\text{avg}-\text{median}|/|\text{median}| \ge 0.5$ via `APPROX_QUANTILES`).
- **`yesno`**: `empty_or_null` (`hidden: yes`), `constant_boolean` (`profile:constant_boolean`), `rare_or_skewed_boolean` (`min_pct < 5%`, `profile:rare_or_skewed_boolean`), `balanced_boolean` (`profile:balanced_boolean`).
- **`datetime` & Spikiness (`stats.spikiness[grain]`)**: `timestamp_or_raw` (`[date, hour]`), `calendar_date` / `period_grain` (`[year, month, date]`), `calendar_cycle`. Emits `profile:spiky_year` / `profile:spiky_month` / `profile:spiky_day` / `profile:spiky_hour` when `spikiness_ratio >= 2.0` or `cv >= 0.5`, and `profile:steady_volume` when `0 < cv < 0.25`.

## 3. Action Playbook

- **LookML Refinements (`bronze/:table.refinement.lkml`)**: Paste `curation["lookml_snippet"]` into `view: +:table` (never edit `bronze/:table.view.lkml`); hide `json_payload`/`uuid_or_hash`/`empty_or_null_only`/surrogate keys; set `suggestable: no` on `profile:opaque_code_or_free_text`; guard `profile:pii` with `required_access_grants:` & `lkr parse lookml snapshot`; assert `profile:unique_key_candidate` in `.test.lkml`.
- **Charts & Filters**: `profile:low_cardinality_enum` -> safe for `pivots:`, donuts (`limit: 6`), and `stats.top_values` filters; `profile:medium_cardinality_categorical` -> unpivoted bars/grids (`limit: "20"`); `profile:searchable_entity_label` -> top-N leaderboards (`limit: "25"`); `profile:skewed_distribution` -> pair `average` with `median`; `profile:has_zeros` -> `nullif(${field}, 0)`; `profile:nullable` -> `-NULL` on breakdowns; `profile:rare_or_skewed_boolean` -> filtered measure/rate KPI; `profile:spiky_*` -> exclude incomplete `trough_period` and run `run_key_driver_analysis` on `peak_period`.

## 4. Sub-Skill — Scratch Schema Value Search (`sub-skills/scratch-search/SKILL.md`)

- **Build (`scripts/scratch_search.py`)**: Profiles searchable string dims (excluding PII/JSON/UUID/empty), compiles SQL branches across BigQuery/Snowflake/Postgres/Databricks/DuckDB (`scripts/dialects/*.py`), and writes `view: _field_value_search_<model>` + `explore: _field_value_search_<model> { hidden: yes }`.
- **Query (`run_inline_query`)**: Query `_field_value_search_<model>` with `filters: {"_field_value_search_<model>.field_value": "%<term>%"}` (`limit: "20"`) to resolve unknown or misspelled literals to exact `(explore_name, field_name, field_value)` tuples in one indexed lookup.
