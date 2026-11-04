---
type: guideline
title: LookML Dos and Don'ts
description: Foundational rules and anti-patterns for LookML development.
tags:
  - lookml
  - best-practices
license: Apache-2.0
metadata:
  publisher: google
  version: v1
---

These best practices reflect recommendations that were shared by a cross-functional team of seasoned Lookers. These insights come from years of experience working with Looker customers from implementation to long-term success. 

The practices are written to work for most users and situations, but — as always — use your best judgment when implementing any of the recommendations that are shared on this page.

---

## Do this with LookML

*   **Do: Define the `relationship` parameter for all joins.**
    This will ensure that metrics aggregate properly within Looker. By default, Looker will use a `many_to_one` join relationship for any joins in which a relationship is not defined. For additional information on defining the `relationship` parameter correctly, see the Best Practices page on [getting the relationship parameter right](https://cloud.google.com/looker/docs/best-practices/how-to-get-the-relationship-parameter-right).

*   **Do: Define a `primary key` within each and every view, including derived tables.**
    All views, whether they are derived or coming directly from the database, should contain a primary key. This primary key should be a **unique value** to enable Looker to uniquely identify any given record. This primary key can be a single column or a concatenation of columns — it simply needs to be a unique identifier for the table or derived table.

*   **Do: Name dimensions, measures, and other LookML objects using all lowercase letters and underscores for spaces.**
    The `label` parameter can be used for additional formatting of a name field, and can also be used to customize the appearance of view names, Explore names, and model names. For example, in the following LookML, the `label` parameter is used to assign the label **Number of Customers** to the `customer_count_distinct` measure:
    ```lookml
    measure: customer_count_distinct {
      label: "Number of Customers"
      type: count_distinct
      sql: ${customer.id} ;;
    }
    ```

*   **Do: Use `datagroups` to align generation of persistent derived tables (PDTs) and Explore caching with underlying ETL processes.**
    Datagroups can also be used to trigger deliveries of dashboards or Looks to ensure that up-to-date data is sent to recipients.

---

## Don't do this with LookML

*   **Don't: Use the `from` parameter for renaming views within an Explore.**
    Use the `view_label` parameter instead. The `from` parameter should primarily be used in the following situations:
    1.  **Polymorphic joins** (joining the same table multiple times)
    2.  **Self-joins** (joining a table to itself)
    3.  **Re-scoping** an extended view back to its original view name

*   **Don't: Use the word "date" or "time" in a `dimension_group` name.**
    Looker appends each timeframe to the end of the dimension group name. A dimension group named `created_date` results in fields called `created_date_date` and `created_date_month`. Simply use `created` as the name, which results in clean field names like `created_date` and `created_month`.

*   **Don't: Use formatted timestamps within joins.**
    Instead, use the `raw` timeframe option for joining on any date or time fields. This will avoid the inclusion of casting and timezone conversion in join predicates.