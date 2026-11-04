---
type: reference
title: Conversational Analytics Best Practices for LookML
description: Guidelines for structuring LookML models and Explores to optimize natural language understanding for Gemini in Looker.
tags:
  - conversational-analytics
  - gemini
  - lookml
license: Apache-2.0
metadata:
  publisher: google
  version: v1
---

Conversational Analytics uses Gemini for Google Cloud to interpret natural language questions, using your Looker semantic model (LookML), data values, and data agent configurations as its source of truth. The quality of its responses is tied to how effectively you prepare these inputs.

This guide provides strategies and best practices for LookML developers and administrators to configure and optimize Conversational Analytics. By following these recommendations for your LookML model and Explores, you can increase user adoption and ensure that users get accurate, relevant, and useful answers to their questions.

This guide covers best practices as they relate to Conversational Analytics, following a logical flow that starts with developing a strong foundation in a model's LookML, configuring Explores that are based on this model.

---

<a id="lookml-best-practices"></a>

## LookML Best Practices for Conversational Analytics

Conversational Analytics interprets natural language questions by leveraging these primary inputs:

* **The LookML model:** The agent fetches the schema for the Explores that are connected to it. The schema includes fields (dimensions, measures), filter-only fields (filters, parameters), and their corresponding labels, descriptions, and synonyms that are defined in the LookML model that underlies the Looker Explore.
* **Distinct field values:** The agent can sample data values and perform fuzzy searches to check for specific field values in the underlying database. These methods enable the agent to choose the correct fields, apply the correct filter values, and identify the available categories and entities that users might ask about.

The effectiveness of Conversational Analytics is directly tied to the quality and clarity of these inputs. The following table contains common ways that unclear or ambiguous LookML can negatively affect Conversational Analytics, along with solutions for reducing latency and improving the output and user experience.

### Troubleshooting LookML Quality

| LookML Quality Issue | Solution for Clearer Conversational Analytics |
| :--- | :--- |
| **Lack of clarity and naming conflicts:** Fields that lack clear labels, have ambiguous definitions, or share similar names across different views can lead to incorrect field selection. | **Apply clear labels and thorough descriptions:**<br>• Use the `label` parameter to give fields intuitive, business-friendly names.<br>• Use the `description` parameter to provide critical context, natural language definitions, and industry-specific terminology. |
| **Field bloat:** Exposing too many fields, such as internal IDs, duplicate fields from joins, or intermediate calculations, clutters the options available. | **Hide irrelevant fields:** Ensure all primary keys, foreign keys, and technical fields remain hidden.<br>**Extend Explores (Optional):** Consider creating a dedicated version for Conversational Analytics by extending an existing Explore. |
| **Database load for sampling and search:** Retrieving sample values and suggestions from the database can be slow or incur unnecessary load. | **Define suggestions in LookML:** Avoid real-time database queries by hard-coding values or pointing to more efficient dimensions using the `suggestions`, `suggest_explore`, or `suggest_dimension` parameters. |
| **Database load for data queries:** Large or inefficient queries can increase latency and database load. | **Optimize data queries:** Adhere to general best practices, such as using aggregate awareness and efficient join logic. |
| **Incomplete LookML definitions:** Relying on dashboard-level custom fields or table calculations makes critical business logic inaccessible. | **Incorporate custom logic:** Convert important and commonly used custom fields or table calculations into LookML dimensions and measures. |
| **Messy data:** Inconsistent variations, varying data types, or timezone ambiguity makes it difficult for Conversational Analytics to interpret queries accurately. | **Address data quality:** Flag issues identified during data curation. Work with data engineering teams to clean source data or apply transformations in the ETL/data modeling layer. |

### Key LookML Takeaways

Keep these takeaways in mind when defining LookML for Explores that will be used as data sources:

* **Use clear and precise labels:** Choose labels for your data that reflect how your business users actually talk. Avoid technical shorthand like "amt_usd_curr" and instead use "Amount (USD)".
* **Enable seamless mapping:** Use synonyms and descriptions to help the agent map user questions to the correct fields.
* **Centralize calculations:** Define frequently used calculations directly as LookML dimensions or measures to ensure a single source of truth and reduce latency.
* **Streamline the context:** Hide technical or internal-only fields in LookML (like foreign keys or raw IDs) to ensure that only fields necessary for answering business questions are surfaced. This reduces noise and improves accuracy.
* **Optimize sample data and fuzzy search queries:** Define hardcoded values in the `suggestions` parameter, or use `suggest_dimension` and `suggest_explore` for more efficient database queries.
* **Optimize data queries:** Adhere to general Looker best practices for optimizing query performance.

> **Tip:** Conversational Analytics doesn't support custom fields in queries. You can monitor an Explore's commonly used custom fields in System Activity and add those fields directly to your models.

---

<a id="explore-best-practices"></a>

## Best Practices for Setting Up an Explore

To help Conversational Analytics provide the most helpful answers, consider following these best practices when defining your Explores:

* **Define only useful fields:** In your Explore's underlying LookML, define only the fields that are useful for analysis by end users. Give each field a clear and concise name and description.
* **Include sample values:** Include sample values where relevant. These are especially helpful for string type fields.
* **Curate data agent-specific Explores:** Reuse content by using `extends` to build off existing LookML and curate the exact fields the agent needs. In System Activity, users can see what fields are used in generated queries and decide on fields to exclude.
* **Use field-level LookML refinements:** Create descriptions that are purpose-built for agents (e.g., *"Use the Orders field when users refer to Sales"*).

---