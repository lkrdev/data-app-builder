---
type: reference
title: Sustainable and Maintainable LookML
description: Architectural patterns for substitution operators, DRY principles with extends, and centralized configurations.
tags:
  - lookml
  - architecture
  - maintainability
license: Apache-2.0
metadata:
  publisher: google
  version: v1
---

## Use substitution operators

Substitution operators should be used throughout all LookML files. A LookML model should have only a single reference point to any object in the physical data model. Any subsequent definitions that need to reference that object should do so by pointing to the already defined LookML object.

* **Syntax `${TABLE}.field_name`**: Use this when referencing the underlying database table for all base dimensions pulling data directly from database columns. If a schema or table name changes, you only need to update the `sql_table_name` parameter in one place to propagate the change.
* **Syntax `${field_name}`**: Use this when referencing dimensions or measures already defined within LookML. If a column name changes (e.g., from `usersid` to `users_id`), you only need to update the base dimension. All other fields referencing that field will update automatically.

### Example: Maintenance Comparison

**Avoid this (Hard to maintain):**
When multiple fields reference `${TABLE}.field_name`, every field must be updated manually if the database column changes.

Lookml: 

dimension: usersid {
  type: number
  sql: ${TABLE}.usersid ;; # Change here
}
measure: this_week_count {
  type: count_distinct
  sql: ${TABLE}.usersid ;; # Change here
  filters: [created_date: "7 days"]
}
measure: this_month_count {
  type: count_distinct
  sql: ${TABLE}.usersid ;; # Change here
  filters: [created_date: "1 month"]
}

### Do this (Easy to maintain):
By using `${field_name}`, only the base dimension requires a change.

Lookml:

dimension: usersid {
  type: number
  sql: ${TABLE}.usersid ;; # Change here
}
measure: this_week_count {
  type: count_distinct
  sql: ${usersid} ;;       # References the LookML field `usersid`
  filters: [created_date: "7 days"]
}
measure: this_month_count {
  type: count_distinct
  sql: ${usersid} ;;       # References the LookML field `usersid`
  filters: [created_date: "1 month"]
}

## Define field sets
Use **sets** for maintaining reusable field lists within the model. Any lists of fields that are repeated—whether within the `fields` parameter or within drill fields—should be incorporated into sets. This creates a single place in the model where that field list can be updated or field references changed. 

---

## Avoid repeating code
Think of LookML objects as building blocks. Use the `extends` parameter to combine objects in different ways without repeating code.

* **Modularity:** Maintain consistency across Explores by not repeating code in multiple places.
* **Resources:** Check the documentation for [Reusing code with extends](https://cloud.google.com/looker/docs/reusing-code-with-extends), as well as the parameter pages for `extends` (for [views](https://cloud.google.com/looker/docs/reference/param-view-extends)) and [Explores](https://cloud.google.com/looker/docs/reference/param-explore-extends).

---

## Consolidate items like map layers and value formats

### Map Layers
Define custom map layers centrally in a file called `map_layers.lkml`. This file can be included as needed across models. Alternatively, add JSON files directly to your repository and reference them.

**Example `map_layers.base.lkml`:**
map_layer: example_africa {
  file: "africa_file_name.json"
  property_key: "geounit"
}

map_layer: example_asia {
  file: "asia_file_name.json"
  property_key: "geounit"
}

map_layer: example_europe {
  file: "europe_file_name.json"
  property_key: "geounit"
}

## Value Formats
Set custom value formats centrally using the `named_value_format` parameter. Reference these using the `value_format_name` parameter in dimensions and measures to ensure global consistency.

---

## Create development guidelines
Define development guidelines to make it easier to scale your LookML model. Common guidelines include requirements for:

* **Organization:** Clearly organizing LookML files so they are consistent and easy to navigate.
* **Context:** Using comments throughout views and models to explain the logic.
* **Documentation:** Creating internal documentation within Looker using Markdown files.