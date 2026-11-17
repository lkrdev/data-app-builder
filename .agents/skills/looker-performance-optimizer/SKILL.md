---
name: looker-performance-optimizer
description: Diagnose and optimize slow Looker queries, symmetric aggregate fanouts, caching datagroups, and Persistent Derived Tables (PDTs) via run_looker_codemode.
---

# Looker Query & PDT Performance Optimizer (`looker-performance-optimizer`)

Use this skill to diagnose slow Looker queries, eliminate unnecessary Symmetric Aggregations, align `datagroup` caching, and optimize PDT partitioning/clustering via `run_looker_codemode`.

## 1. Unified Folder & Surgical Editing Invariant

- **Greenfield projects** use Medallion `bronze/`/`silver/`/`gold/` (`bronze/:table.refinement.lkml`, `silver/:entity_facts.view.lkml`, `gold/explores/*.explore.lkml`).
- **Brownfield repositories** preserve their existing directory layout (e.g., `views/base/` + `views/refinements/` or `explores/`) and `include:` globs — edit existing files surgically without moving directories or stripping developer comments.

## 2. Diagnostic Workflow in `run_looker_codemode`

Run diagnostics in a single `run_looker_codemode` script (never calling `update_session`, and reporting exact HTTP `403` or `limit` truncation empirically):

```python
import json

compiled_sql = run_inline_query(
    result_format="sql",
    body={
        "model": model_name,
        "view": explore_name,
        "fields": fields,
        "filters": filters,
        "limit": "500",
    },
)
explore_meta = lookml_model_explore(model_name, explore_name, fields="joins,fields,sql_table_name")

errors, truncated = {}, []
def sa_rows(view, q_fields, q_filters, q_sorts, limit="100"):
    try:
        raw = run_inline_query("json", {
            "model": "system__activity",
            "view": view,
            "fields": q_fields,
            "filters": q_filters,
            "sorts": q_sorts,
            "limit": limit,
        })
        rows = json.loads(raw) if isinstance(raw, str) else (raw or [])
        if isinstance(rows, list) and len(rows) >= int(limit):
            truncated.append(f"system__activity::{view} hit limit={limit}")
        return rows if isinstance(rows, list) else []
    except Exception as exc:
        errors[view] = str(exc)
        return []

hist_rows = sa_rows(
    "history",
    ["query.model", "query.view", "query.slug", "history.average_runtime", "history.query_run_count", "history.cache_result_query_count"],
    {"history.created_date": "14 days", "query.model": model_name},
    ["history.average_runtime desc"],
)
pdt_rows = sa_rows(
    "pdt_event_log",
    ["pdt_event_log.view_name", "pdt_event_log.action", "pdt_event_log.elapsed_seconds", "pdt_event_log.created_time"],
    {"pdt_event_log.created_date": "14 days", "pdt_event_log.model_name": model_name, "pdt_event_log.action": "create complete"},
    ["pdt_event_log.elapsed_seconds desc"],
)
return {"compiled_sql": compiled_sql, "joins": (explore_meta or {}).get("joins"), "slow_queries": hist_rows[:20], "pdt_builds": pdt_rows[:20], "truncated": truncated, "errors": errors}
```

## 3. Bottleneck Playbooks & LookML Remediations

1. **Unnecessary Symmetric Aggregations (`SUM(DISTINCT ... MD5/SHA1)` in `compiled_sql`)**:
   - Inspect every joined view involved in the query. If the "one" side key is genuinely unique (`COUNT(*) > 1` check returns 0 rows), set `primary_key: yes` on that key and fix the `join:` `relationship:` to `many_to_one` or `one_to_one` so Looker emits native `SUM(col)` instead of row-hashing.
   - If the join is genuinely `one_to_many` or multi-fact, pre-aggregate the grain in a Native Derived Table (`explore_source:`) or apply the Outer Join On False (`lookml-ojof`) pattern.
2. **Missing Partition & Cluster Pruning**:
   - Remove non-SARGable wrappers on partition columns (`CAST(ts AS STRING)`, `DATE(ts)` in custom `sql_where` instead of native `dimension_group` timeframes or range bounds).
   - On physically partitioned warehouse fact tables, add `always_filter: { filters: [fact.created_date: "90 days"] }` (or push `{% condition %}` bounds into derived table `WHERE` clauses) and disable expensive autocomplete scans (`suggestable: no`) on high-cardinality ID columns.
   - Ensure `sql_on:` join keys have matching warehouse types (avoiding implicit `CAST(int_id AS STRING)` full scans).
3. **Datagroup & Cache Alignment (`datagroup_trigger` / `sql_trigger`)**:
   - Replace `persist_for:` on models/explores/PDTs with a centralized `datagroup:` polling a lightweight ETL metadata or `__TABLES__` query (`sql_trigger: SELECT MAX(completed_at) FROM analytics_meta.etl_runs ;;`, `max_cache_age: "24 hours"`), wired via `persist_with:` on models/explores and `datagroup_trigger:` on PDTs.
4. **PDT Materialization & Aggregate Awareness**:
   - Declare `partition_keys: ["created_date"]` and `cluster_keys: ["entity_id"]` (BigQuery) or `sortkeys` / `distribution` on PDTs.
   - Convert append-only fact PDTs (`> 10M` rows) to incremental PDTs (`increment_key: "created_date"`, `increment_offset: 3`, with `{% incrementcondition %} created_at {% endincrementcondition %}` in SQL PDT `WHERE` clauses; automatic on NDTs).
   - Add `aggregate_table:` rollups (`materialization: { datagroup_trigger: ... }`) on high-traffic dashboard explores, including `always_filter` dimensions so queries hit the rollup.

## 4. Verification Gate

After editing LookML, run `validate_project(project_id)` and re-run `run_inline_query(result_format="sql", ...)` in `run_looker_codemode` to confirm clean compilation, partition predicate pushdown, and removal of unintended symmetric aggregate hashes.

## 5. Reference Guides

- [Query Diagnostics & Execution Plans](references/query_diagnostic.md)
- [Caching & Datagroups](references/caching_datagroups.md)
- [PDT Optimization & Incremental Builds](references/pdt_optimization.md)
