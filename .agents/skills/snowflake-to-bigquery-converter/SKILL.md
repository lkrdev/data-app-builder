---
name: snowflake-to-bigquery-converter
description: Translate Snowflake SQL queries and LookML views, explores, and derived tables to Google BigQuery Standard SQL with compilation and SQL parity verification.
---

# Snowflake to BigQuery SQL & LookML Converter (`snowflake-to-bigquery-converter`)

Use this skill when migrating or translating Snowflake SQL queries or Snowflake-backed LookML (`sql:`, `sql_table_name:`, `sql_on:`, `sql_always_where:`, `derived_table.sql`, and model `connection:`) to Google BigQuery Standard SQL.

## 1. Unified Folder & Refactoring Invariant

- **Greenfield projects** use Medallion `bronze/`/`silver/`/`gold/` (`bronze/:table.view.lkml`, `bronze/:table.refinement.lkml`, `silver/`, `gold/`).
- **Brownfield repositories** preserve their existing directory layout (e.g., `views/base/` + `views/refinements/` or `explores/`) and `include:` globs — update SQL expressions, `sql_table_name:` references, and `connection:` in place without reorganizing folders unless asked.

## 2. Snowflake -> BigQuery Standard SQL Translation Matrix

| Category | Snowflake Construct | BigQuery Standard SQL / LookML Equivalent |
| :--- | :--- | :--- |
| **Identifier Quoting** | `"DB"."SCHEMA"."TABLE"`, `${TABLE}."ORDER_ID"` | `` `project.dataset.table` ``, `${TABLE}.order_id` (backtick only reserved words or special chars; BigQuery column names are case-insensitive) |
| **Null & Zero Guards** | `NVL(a, b)`, `NVL2(x, a, b)`, `ZEROIFNULL(x)`, `NULLIFZERO(x)`, `EQUAL_NULL(a, b)` | `IFNULL(a, b)` (or `COALESCE(a, b)`), `IF(x IS NOT NULL, a, b)`, `IFNULL(x, 0)`, `NULLIF(x, 0)`, `a IS NOT DISTINCT FROM b` |
| **Conditionals & Safe Math** | `IFF(cond, t, f)`, `DECODE(expr, k1, v1, def)`, `DIV0(a, b)` / `DIV0NULL(a, b)` | `IF(cond, t, f)`, `CASE expr WHEN k1 THEN v1 ELSE def END`, `IFNULL(SAFE_DIVIDE(a, b), 0)` / `SAFE_DIVIDE(a, b)` (or `1.0 * ${a} / NULLIF(${b}, 0)` in LookML measures) |
| **Safe Type Casting** | `TRY_CAST(x AS NUMBER)`, `TRY_TO_NUMBER(x)`, `TRY_TO_DOUBLE(x)`, `x::VARCHAR`, `NUMBER(38,0)` | `SAFE_CAST(x AS NUMERIC)`, `SAFE_CAST(x AS INT64)` / `NUMERIC`, `SAFE_CAST(x AS FLOAT64)`, `CAST(x AS STRING)`, `INT64` (`FLOAT` -> `FLOAT64`, `VARCHAR` -> `STRING`) |
| **Date / Time Math** | `DATEADD(day, -7, ts)` / `TIMEADD(...)` | `TIMESTAMP_ADD(ts, INTERVAL -7 DAY)` or `DATE_ADD(dt, INTERVAL -7 DAY)` (`DATE_SUB(dt, INTERVAL 7 DAY)`) |
| **Date Diff (Arg Order)** | `DATEDIFF('day', start_dt, end_dt)` *(start first, end second)* | **In LookML views**: use `dimension_group` `type: duration` (`sql_start: ${start_raw} ;; sql_end: ${end_raw} ;;`). **In raw SQL**: `DATE_DIFF(end_dt, start_dt, DAY)` or `TIMESTAMP_DIFF(end_ts, start_ts, DAY)` *(end first, start second)* |
| **Date Trunc & Formatting** | `DATE_TRUNC('month', ts)`, `TO_CHAR(ts, 'YYYY-MM')`, `TO_TIMESTAMP_NTZ(s)`, `TO_TIMESTAMP(epoch_sec)` | `TIMESTAMP_TRUNC(ts, MONTH)` / `DATE_TRUNC(dt, MONTH)` (prefer LookML `dimension_group` `type: time` with `raw` timeframe), `FORMAT_TIMESTAMP('%Y-%m', ts)`, `PARSE_DATETIME(...)` / `SAFE_CAST(s AS DATETIME)`, `TIMESTAMP_SECONDS(epoch_sec)` |
| **Timezone Conversion** | `CURRENT_TIMESTAMP()`, `CONVERT_TIMEZONE('America/New_York', ts_tz)` / `CONVERT_TIMEZONE('UTC', 'America/New_York', ts_ntz)` | `CURRENT_TIMESTAMP()`, `DATETIME(ts_tz, 'America/New_York')` (for `TIMESTAMP`) / `DATETIME(TIMESTAMP(ts_ntz, 'UTC'), 'America/New_York')` (for naive `DATETIME`) |
| **Window `QUALIFY`** | `SELECT ... QUALIFY ROW_NUMBER() OVER (...) = 1` | Supported natively in BigQuery (`SELECT ... QUALIFY ROW_NUMBER() OVER (...) = 1` — keep `QUALIFY` intact rather than wrapping in an extra subquery) |
| **Semi-Structured `VARIANT`** | `payload:user.id::STRING`, `GET_PATH(v, 'a.b')`, `PARSE_JSON(str)` | Native BigQuery `JSON`: `LAX_STRING(payload.user.id)` / `JSON_VALUE(payload, '$.user.id')`, `LAX_INT64(...)`, `LAX_FLOAT64(...)`, `LAX_BOOL(...)`, `SAFE.PARSE_JSON(str)` |
| **Arrays & `FLATTEN`** | `, LATERAL FLATTEN(input => items) f` (`f.value`, `f.index`) / `OUTER => TRUE` | `CROSS JOIN UNNEST(items) AS item WITH OFFSET AS item_idx` (or `LEFT JOIN UNNEST(JSON_QUERY_ARRAY(payload, '$.items')) AS item` for `OUTER => TRUE`) |
| **Strings & Regex** | `ILIKE '%abc%'`, `CONTAINS(s, 'x')`, `REGEXP_LIKE(s, pat)`, `LISTAGG(col, ',') WITHIN GROUP (ORDER BY k)` | `LOWER(s) LIKE '%abc%'` (or `REGEXP_CONTAINS(s, r'(?i)abc')`), `STRPOS(s, 'x') > 0`, `REGEXP_CONTAINS(s, pat)`, `STRING_AGG(col, ',' ORDER BY k)` |
| **PDT Materialization** | `cluster_keys` / Snowflake transient table options | BigQuery PDT `partition_keys: ["created_date"]` and `cluster_keys: ["entity_id"]` paired with `datagroup_trigger:` |

## 3. LookML-Specific Migration Checklist

1. **Model & Connection**: Update `connection:` in `.model.lkml` (or `manifest.lkml` constants) to the target BigQuery connection and replace Snowflake `sql_trigger:` queries in `datagroup:` blocks with BigQuery Standard SQL.
2. **Base Views (`sql_table_name:` & Quoting)**: Strip Snowflake uppercase double-quotes (`${TABLE}."USER_ID"` -> `${TABLE}.user_id`) and rewrite three-part table names to `` `project.dataset.table` ``.
3. **Time & Duration Groups**: Check `datatype:` on `dimension_group` (`timestamp`, `datetime`, `date`, `epoch`) so Looker emits `TIMESTAMP_TRUNC` vs `DATE_TRUNC` accurately without casting partition columns in `WHERE` clauses (which breaks BigQuery partition pruning).

## 4. Verification via `run_looker_codemode` or `lkr parse`

1. **Offline AST & Parity Check (when `/workspace/` CLI is available)**:
   - Run `lkr parse lookml-to-api --validate` on modified LookML and `lkr parse sql-lookml-compare --dialect bigquery` when comparing translated SQL against LookML views/explores.
2. **Live Looker Compilation & SQL Check (`run_looker_codemode`, never `update_session`)**:
   ```python
   val = validate_project(project_id)
   sql = run_inline_query(
       result_format="sql",
       body={"model": model_name, "view": explore_name, "fields": sample_fields, "limit": "10"},
   )
   return {"validation_errors": (val or {}).get("errors") or [], "generated_bigquery_sql": sql}
   ```
   Confirm zero new LookML validation errors and verify the generated SQL uses BigQuery backtick table refs, `SAFE_DIVIDE`/`NULLIF`, `TIMESTAMP_TRUNC`/`DATE_TRUNC`, and `UNNEST` with intact partition pruning.
