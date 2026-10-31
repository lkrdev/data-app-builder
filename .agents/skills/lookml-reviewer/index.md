---
type: index
title: LookML Reviewer Knowledge Bundle
description: >-
  Complete procedural and reference knowledge bundle for auditing LookML codebases
  against official Google Looker best practices, LAMS style guides, and Conversational Analytics standards.
tags:
  - looker
  - lookml
  - code-review
license: Apache-2.0
metadata:
  publisher: google
  version: v1
---

# LookML Reviewer Knowledge Bundle

This bundle contains procedural workflows and reference guidelines for conducting automated code reviews of LookML projects using `looker-cli`.

## Procedures (`howto`)
- [LookML Code Review Workflow](./SKILL.md) — Step-by-step procedure for verifying CLI prerequisites, checking out project branches, ingesting LookML, and compiling audit reports.

## Standards & Guidelines (`guideline`)
- [LookML Dos and Don'ts](./references/lookml-dos-and-donts.md) — Core recommendations from experienced Looker architects regarding primary keys, joins, and naming conventions.
- [LAMS Style Guide](./references/lams-style-guide.md) — Looker Analytics Management Standard covering primary/foreign keys, count measure filtering, and derived table patterns.

## Architecture References (`reference`)
- [Sustainable & Maintainable LookML](./references/sustainable-maintainable-lookml.md) — Best practices for field sets, substitutions (`${TABLE}` vs `${field}`), extensions, and value formatting.
- [Conversational Analytics Best Practices](./references/conversational-analytics-best-practices.md) — Optimization techniques for Gemini in Looker (field descriptions, labels, synonyms, and hiding technical keys).
