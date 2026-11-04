---
type: guideline
title: Looker Analytics Management Standard (LAMS) Style Guide
description: Strict style and architectural standards for LookML keys, joins, derived tables, and field naming.
tags:
  - lams
  - style-guide
  - lookml
license: Apache-2.0
metadata:
  publisher: google
  version: v1
---

# Looker Best Practices and Style Guide

## Key Dimensions
**Summary:** Implement consistent dimensions to communicate information about views' keys to developers who use the view.

### K1. Primary Key Naming Convention
Views should define 1 or more "Primary Key Dimensions" following a naming convention of `pk{n}_{key_name}...` where `n` is the total number of columns that form the primary key, and which may be omitted if it is 1, and `key_name` is any descriptive name.

> **Note:** This applies to "regular" views that describe an underlying table, i.e. through a `sql_table_name`, `derived_table`, or implicit table name. In some cases, you may have a "field-only view", which would be joined using `join: {sql: ;;}`, for which this rule would not apply.

**Rationale:** With this naming convention, anyone creating a join can conclusively find the correct logic without having to investigate. Additionally, anyone reading the join could conclusively verify it.

#### Primary Key Notes
* **PK0 Case:** The number can (and must) be **0** in the rare case that you are working with a table with no primary key.
* **Descriptive Naming:** The name should be descriptive outside of the context of the view. Prefer `pk1_account_id` over `pk1_id`.
* **Composite Keys:** For keys with more than one column, all numbers should be equal to the total number of columns (e.g., `pk3_a`, `pk3_b`, `pk3_c`).
* **Concatenation:** For composite keys, define the individual columns and once as a concatenated dimension with `primary_key: yes`.
* **K3. Placement:** Primary Key Dimensions should be defined immediately following the table definition and before any other dimensions.
* **K4. Visibility:** Primary Keys Dimensions should be **hidden**. The audience is developers. If a column should be user-facing, expose it via a separate dimension.

### K3. Primary Key Dimensions should be defined immediately following the table definition, and the table definition should be defined before any other dimensions

### K4. Primary Keys Dimensions should be hidden

### K7. Primary Key Declarations
Views should declare exactly one `primary_key` dimension unless the view declares it has no primary key via a `pk0_` dimension.

### K8. PK Dimension Usage
The `primary_key` dimension must use or be the Primary Key Dimension(s). For composite keys, ensure the `primary_key: yes` dimension uses all components in its SQL:

**LookML**
dimension: membership_id {
  hidden: yes
  primary_key: yes
  sql: ${pk2_user_id} || "-" || ${pk2_group_id} ;;
}

## K5 & K6. Performance Keys
* **K5. Distribution Keys:** Distribution Key Dimensions should be named `pkd_{key_name}`.
* **K6. Sort/Cluster Keys:** Sort/Cluster Key Dimensions should be named `pkc_{key_name}`. Use numbers for compound clusters: `pkc1_site`, `pkc2_date`.

---

## Other Fields
**Summary:** Implement fields in ways which (a) maximize reuse and (b) maximize usability.

* **F1. Inter-view References:** Fields in a view should not reference other views unless it is a field-only view or a tightly coupled view.
* **F2. View Labels:** Fields should not contain a `view_label`. Prefer view-level labels as field-level labels cannot be overridden by a join.
* **F3. Count Filtering:** All `type: count` measures should specify a filter (e.g., `field: pk1_user_id, value: "NOT NULL"`). This ensures correct counts when joined.
* **F4. Documentation:** Non-hidden fields should have descriptions.
* **F5. Technical IDs:** ID fields without business usage should be hidden.
* **F6. Foreign Keys:** Foreign keys should be hidden. Expose the ID under the view where it is the primary key.

---

## Derived Tables
**Summary:** Restrict SQL patterns for modularity and reliability.

* **T1. Caching:** Triggered PDTs should use datagroups.
* **T2. Primary Keys in SQL:** Every derived table/CTE should SELECT a set of primary key columns.
    * **T2.1.** Alias as `pk{n}_{column_name}`.
    * **T2.2.** PK columns should be the first columns in the SELECT clause.
    * **T2.3.** For grouped queries, the PK should start with the grouped columns.
    * **T2.6.** Primary key columns end with `---` on its own line in the SQL.
    * **T2.7.** Exception - Subqueries may SELECT a single column without declaring PKs
    * **T2.8.** Exception - Queries may SELECT *, plus any non-PK columns, FROM a single table/subquery
* **T11. Assertions:** Use `CASE WHEN MIN(id) <> MAX(id) THEN ERROR(...)` to ensure unique values produce a single result.
* **T12. Ordering:** No `ORDER BY` clause unless a `LIMIT` is used.
* **T13. Aggregate Filtering:** Use aggregate functions (`MIN`/`MAX`) instead of `ORDER BY` for first/last values.
* **T14. Dynamic SQL:** Persisted PDTs should not use liquid or dynamic SQL.
* **T15. Set Operations:** Use `UNION ALL` instead of `UNION` unless de-duplication is explicitly required.

---

## Explores

* **E1. Substitution:** All join fields should use the substitution operator: `${view_name.field_name}`.
* **E2. Join Integrity:** Non-many-to-many joins should join on equality constraints on all Primary Key Dimensions.
* **E3. Performance Joins:** Joins should use distribution and sort/cluster keys when possible.
* **E4. Base Filters:** Use `always_filter` on the base table's sort/partition column.
* **E5. Fanout:** Avoid joins that cause multiplicative fanout or spurious relationships.
* **E7. Label Length:** Explore labels should be no longer than 25 characters.

---

## Hierarchy

**Summary:** Limit options to prevent user overwhelm.

* **H1. Hoisting:** Wrap ID/Name labels in square brackets: `[ID]`.
* **H2. View Cleanliness:** If a view has >20 fields, use `group_label`.
* **H3. Nested Hierarchy:** If a view has >10 groups, use `Dates > Close` hierarchy.
* **H5. Fact Table Highlighting:** Wrap the Explore's base view in square brackets: `view_label: "[Orders]"`.
* **H6. Explore Organization:** If an Explore has >20 views, use label prefixes (e.g., `User > Attributes`).

---