---
name: lookml-reviewer
description: Review LookML projects and files for LAMS style compliance, symmetric aggregate safety, join hygiene, and Looker compilation validity via /workspace/ files or run_looker_codemode.
---

# LookML Code Reviewer (`lookml-reviewer`)

Use this skill whenever asked to review, audit, lint, or critique LookML models, views, explores, refinements, or data tests.

## 1. Project & Folder Convention Invariant

- **Greenfield projects** use Medallion `bronze/`/`silver/`/`gold/` (`bronze/:table.view.lkml`, `bronze/:table.refinement.lkml`, `silver/explores/*.explore.lkml`, `gold/explores/*.explore.lkml`).
- **Brownfield repositories** preserve their existing directory layout (such as `views/base/` + `views/refinements/` or `explores/`) and `include:` globs — never flag an existing brownfield layout as an error or move files across directories unless explicitly requested.

## 2. Inspecting LookML (`/workspace/` or `run_looker_codemode`)

1. **Local `/workspace/` files first**: When LookML files are mounted in `/workspace/` (or `./data/<id>/lookml`), inspect them directly and run `lkr parse lookml` / `lkr parse lookml-to-api --validate` when available.
2. **Remote Looker project via `run_looker_codemode`** (never call `update_session` inside `run_looker_codemode`):
   ```python
   files = [
       f.get("path") or f.get("id")
       for f in (all_project_files(project_id) or [])
       if isinstance(f, dict) and str(f.get("path") or f.get("id") or "").endswith((".lkml", ".lookml"))
   ]
   contents = {}
   for path in files[:40]:
       contents[path] = get_file_content(project_id, path) or ""
   return {"project_id": project_id, "total_files": len(files), "sampled": len(contents), "contents": contents}
   ```

## 3. Structural & LAMS Review Rules

Evaluate every `.model.lkml`, `.view.lkml`, `.refinement.lkml`, `.explore.lkml`, and `.test.lkml` file against these checks:

| Rule ID | Category | Check & Remediation |
| :--- | :--- | :--- |
| **PK-1 (`K1`–`K4`)** | Primary Key | Every joined view and derived table defines exactly one `primary_key: yes` dimension placed first, marked `hidden: yes` (expose a separate visible ID dimension if needed), and backed by a `.test.lkml` uniqueness assertion (`explore_source:` selecting `column: pk { field: view.pk }` and `column: count { field: view.count }` with `sorts: [view.count: desc]`, `limit: 1`, and `assert: pk_is_unique { expression: ${view.count} = 1 ;; }`). Composite PKs concatenate non-null components (`CONCAT(${a}, '|', ${b})`). |
| **F-1** | `${TABLE}` Boundary | Reference `${TABLE}.col` **only** in 1:1 physical base column dimensions. Derived dimensions, filtered measures, and ratios must reference LookML fields via `${field_name}` (never raw `${TABLE}.col` inside `measure:` `sql:` blocks). |
| **M-1** | Division & Symmetric Safety | Guard every division with `NULLIF`: `sql: 1.0 * ${numerator} / NULLIF(${denominator}, 0) ;;`. Never wrap raw SQL `SUM(...)` or `COUNT(...)` inside `measure: ... { type: number }` (which bypasses Looker symmetric aggregates); compose `type: sum` / `type: count` measures instead. |
| **J-1 (`E1`–`E2`)** | Join Hygiene | Every `join:` block explicitly declares `type:` (`left_outer` by default), `relationship:` (`many_to_one`, `one_to_one`, `one_to_many`, `many_to_many`), and `sql_on:` using `${view_a.field} = ${view_b.field} ;;` substitution (never bare table aliases unless implementing conditional Liquid OJOF). |
| **D-1** | `dimension_group` Hygiene | `type: time` groups omit `_date`, `_at`, and `_timestamp` suffixes from the group name (`dimension_group: created` -> `created_date`, `created_month`) and explicitly include `raw` in `timeframes: [raw, time, date, week, month, quarter, year]`. Elapsed-time calculations use `dimension_group` `type: duration` rather than dialect-specific `DATEDIFF` SQL. |
| **I-1** | Scoped `include:` & Caching | Models and explores use scoped `include:` paths (never root `include: "*.view.lkml"` or `include: "/**/*.view.lkml"` on multi-explore models) and `persist_with:` a `datagroup` rather than scattered `persist_for:` strings. |
| **CA-1** | Descriptions & Curation | User-facing Explores, measures, and ambiguous business dimensions carry concise `description:` strings; internal helper dimensions/joins use `hidden: yes`; high-cardinality ID/UUID dimensions set `suggestable: no` when curating for performance. |

## 4. Validation Gate & Output Format

- **Whenever modifying LookML files**, validate compilation via `validate_project(project_id)` in `run_looker_codemode` (or `lkr parse lookml-to-api --validate` offline) and confirm zero new LookML errors before concluding.
- Report findings grouped by **Critical** (broken compilation, missing PK / fanout double-counting, unguarded division by zero), **Warning** (`${TABLE}` in measures, missing `relationship:`, wildcard `include:`, `persist_for:`), and **Advisory** (naming/descriptions), citing exact `file_path` and object names (`view.field` or `explore.join`) with copy-pasteable LookML fixes that respect the repo's folder convention.

## 5. Reference Guides

- [LAMS Rule Book](references/lams-style-guide.md)
- [LookML Dos and Don'ts](references/lookml-dos-and-donts.md)
- [Sustainable & Maintainable LookML](references/sustainable-maintainable-lookml.md)
- [Conversational Analytics Best Practices](references/conversational-analytics-best-practices.md)
