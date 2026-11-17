---
name: looker-audit
description: Audit a Looker instance for query performance, dashboard complexity, excessive table calculations, broken content/schedules, and datagroup/PDT health via run_looker_codemode.
---

# Looker Instance Governance & System Activity Audit (`looker-audit`)

Use this skill when auditing a Looker instance for slow or high-complexity dashboards, excessive `dynamic_fields` (table calculations / custom fields), unused or broken content, failing schedules, and datagroup/PDT errors via `run_looker_codemode`.

Always route instance audit turns to `<USE_CASE>tile</USE_CASE>` and execute Looker SDK and `system__activity` queries via `run_looker_codemode`.

## 1. Execution Contract & Empirical Integrity Rules

1. **Bounded Code Mode Queries (`limit <= "5000"`)**: Run all checks in `run_looker_codemode` (never call `update_session` or `callable()`). Query `system__activity` explores (`history`, `dashboard`, `pdt_event_log`, `scheduled_plan`, `field_usage`) via `run_inline_query(result_format="json", body={..., "limit": "500"})` (never exceeding `limit="5000"`; use `health_pulse` / `health_analyze` / `health_vacuum` only if pre-bound in a custom `lkr code-mode` host).
2. **Zero Fabricated Metrics on 403 / Empty Results**: If `system__activity` returns HTTP `403` / `PermissionError` (missing `see_system_activity`) or `[]`, report that exact empirical result (`0 rows` or `403 permission denied on system__activity`) and fall back to accessible SDK metadata (`all_datagroups()`, `all_lookml_models()`, `search_dashboards()`, `all_scheduled_plans()`). Never invent sample runtimes, cache rates, or tile counts.
3. **Explicit Truncation Reporting**: Whenever `len(rows) >= int(limit)`, explicitly note that results hit the `limit` cap (or run a companion `count` query before reporting an instance-wide total).
4. **Unified LookML Folder Convention**: When proposing LookML remediations, greenfield projects use Medallion `bronze/`/`silver/`/`gold/`, while brownfield repositories preserve their existing directory layout and `include:` globs.

## 2. One-Pass Audit Recipe (`run_looker_codemode`)

```python
import json

LIMIT = "500"
report = {"errors": {}, "truncated": []}

def sa_query(key, view, fields, filters=None, sorts=None, limit=LIMIT):
    capped = str(min(int(limit), 5000))
    try:
        raw = run_inline_query(
            result_format="json",
            body={
                "model": "system__activity",
                "view": view,
                "fields": fields,
                "filters": filters or {},
                "sorts": sorts or [],
                "limit": capped,
            },
        )
        rows = json.loads(raw) if isinstance(raw, str) else (raw or [])
        if isinstance(rows, list) and len(rows) >= int(capped):
            report["truncated"].append(f"{key} (system__activity::{view}) hit limit={capped}")
        return rows if isinstance(rows, list) else []
    except Exception as exc:
        report["errors"][key] = str(exc)
        return []

# 1) Query runtime, cache efficiency & slow dashboards (last 30 days)
report["slow_dashboards"] = sa_query(
    "slow_dashboards",
    "history",
    ["dashboard.id", "dashboard.title", "history.query_run_count", "history.average_runtime", "history.cache_result_query_count"],
    filters={"history.created_date": "30 days", "dashboard.id": "NOT NULL", "history.status": "complete"},
    sorts=["history.average_runtime desc"],
    limit="100",
)

# 2) Separate dashboard tile-bloat, dynamic_fields, and merged-query scans (preserving SQL grain)
report["high_tile_dashboards"] = sa_query(
    "high_tile_dashboards",
    "dashboard",
    ["dashboard.id", "dashboard.title", "dashboard.refresh_interval_ordered", "dashboard_element.count"],
    filters={"dashboard.deleted_date": "NULL", "dashboard_element.count": ">25"},
    sorts=["dashboard_element.count desc"],
    limit="100",
)
report["dynamic_field_tiles"] = sa_query(
    "dynamic_field_tiles",
    "dashboard",
    ["dashboard.id", "dashboard.title", "dashboard_element.id", "query.dynamic_fields"],
    filters={"dashboard.deleted_date": "NULL", "query.dynamic_fields": "-NULL,-[]"},
    limit=LIMIT,
)
report["merged_query_tiles"] = sa_query(
    "merged_query_tiles",
    "dashboard",
    ["dashboard.id", "dashboard.title", "dashboard_element.id", "dashboard_element.result_source"],
    filters={"dashboard.deleted_date": "NULL", "dashboard_element.result_source": "Merge Query"},
    limit="100",
)

# 3) PDT build failures & datagroup trigger errors
report["pdt_errors"] = sa_query(
    "pdt_errors",
    "pdt_event_log",
    ["pdt_event_log.view_name", "pdt_event_log.model_name", "pdt_event_log.connection", "pdt_event_log.action", "pdt_event_log.action_data", "pdt_event_log.count"],
    filters={"pdt_event_log.created_date": "7 days", "pdt_event_log.action": "%error%"},
    sorts=["pdt_event_log.count desc"],
    limit="100",
)
try:
    report["datagroups_with_errors"] = [
        {"name": d.get("name"), "model_name": d.get("model_name"), "trigger_error": d.get("trigger_error"), "stale_before": d.get("stale_before")}
        for d in (all_datagroups() or [])
        if isinstance(d, dict) and d.get("trigger_error")
    ]
except Exception as exc:
    report["errors"]["datagroups"] = str(exc)

# 4) Failing scheduled plans & unused field inventory
report["scheduled_plans"] = sa_query(
    "scheduled_plans",
    "scheduled_plan",
    ["scheduled_plan.id", "scheduled_plan.name", "user.name", "scheduled_job.status", "scheduled_job.count"],
    filters={"scheduled_job.created_date": "14 days", "scheduled_job.status": "failure"},
    sorts=["scheduled_job.count desc"],
    limit="100",
)
report["low_usage_fields"] = sa_query(
    "low_usage_fields",
    "field_usage",
    ["field_usage.model", "field_usage.explore", "field_usage.field", "field_usage.times_used"],
    sorts=["field_usage.times_used asc"],
    limit="100",
)
return report
```

## 3. Governance Thresholds & Remediation Rubric

- **Tile Bloat & Auto-Refresh**: Flag dashboards in `high_tile_dashboards` (`> 25` tiles) or sub-ETL auto-refresh intervals; split across native dashboard tabs or consolidate KPIs.
- **Ungoverned Logic (`dynamic_fields` & Merged Queries)**: Flag dashboards with `> 3` tiles in `dynamic_field_tiles`, `> 10` total table calculations/custom fields, `limit > 2000` paired with table calculations, or any `merged_query_tiles` (`result_source = "Merge Query"`). Promote repeatable calculations and joins into governed LookML views/explores.
- **Cache Efficiency**: Daily ETL dashboards should sustain `>= 80%` cache hit rate (`cache_result_query_count / query_run_count`). Replace `persist_for` with `datagroup` `sql_trigger` policies aligned to warehouse ELT completion.
- **Broken Content, Schedules & PDTs**: Triage `content_validation()` broken references (when authorized), failing `scheduled_plan` jobs, `datagroups_with_errors`, and `pdt_event_log` build errors immediately.
- See [references/performance_audit_guide.md](references/performance_audit_guide.md) for the 4-phase query lifecycle breakdown.
