# data-app-publisher Tools

## Overview
Static AST/token-based widget query extractor and Looker API 4.0 publisher that stamps Data App widget IDs, pre-registers Looker queries, rewrites local ES imports to hosted bundle URLs, and creates or updates Looker extension dashboards.

## Interface
- `[widget_extractor.py:WIDGET_TAGS, VOID_TAGS, WIDGET_ATTRS, PROP_PARTS, NATIVE_ATTRS, QUERY_KEY_PARTS, WIDGET_QUERY_DEFAULTS, EXPR_BASE, EXPR_MAX, EXPR_CHAR_RE, FILLER, REPEATED_EXPR_RE, LOCAL_ID_PREFIX, canonical_query_json, ExtractionResult, extract_widget_queries]`: Reads `app.js` as UTF-8 text without executing it, stamps `data-da-key` / generated `da-<short_tag>-<slug>` IDs, and extracts deduplicable Looker widget queries, skips, warnings, and parity descriptors.
- `[publish-data-app.py:DEFAULT_MAX_DEF_BYTES, FALLBACK_HINT, APPEARANCE_PROBE_FIELD, CANONICAL_BROWSER_ASSETS, CANONICAL_SHARED_BASE, METADATA_TAGS, TAG_REGEX, load_config, check_def_size, login, call, register_widget_queries, upsert_data_app_extension, extension_name_for, resolve_version, resolve_shared_urls, parse_metadata, upsert_metadata, prepare_production_content, fetch_authenticated_user, check_instance_mismatch, publish, main]`: CLI (`--def`, `--title`, `--folder-id`, `--config`, `--inline-name`, `--dashboard-id`, `--confirm-replace`) orchestrating metadata updates, query registration, `/data_app_extension` upsert, and extension dashboard creation/update.

## Invariants
- `[widget_extractor.py:extract_widget_queries]`: Never executes `app.js`; `_strip_comments_and_mask_expressions` preserves 1:1 character offsets via `FILLER` (`\x00`) padding and rejects > `EXPR_MAX` template expressions; `WIDGET_ATTRS` and `WIDGET_QUERY_DEFAULTS` mirror `runtime/data-app.js`; `_to_slug` truncates at 48 UTF-16 code units; parity descriptors are omitted for keyed, dropped-part, or stateful widgets.
- `[publish-data-app.py:check_def_size]`: Raw source and production-rewritten bundle must each stay within `size_limit_fallback.max_def_bytes` (default `900_000` UTF-8 bytes) or abort with `def_too_large`.
- `[publish-data-app.py:check_instance_mismatch]` & `[publish-data-app.py:publish]`: `--dashboard-id` updates abort on `@looker-instance` mismatch, require an existing dashboard with a single `extension` element and `extension` active layout, and abort on author `user_mismatch` unless `--confirm-replace` is passed.
- `[publish-data-app.py:upsert_data_app_extension]`: Matches existing extensions solely via `db::<id>`, omits `name` on `PATCH`, and checks extension layout support on newly created dashboards (deleting the dashboard on layout fallback failure).
- `[publish-data-app.py:publish]`: Restores `original_content` to `args.def_path` if any publish step raises after leading JSDoc metadata was updated; `_sanitize_metadata_value` strips `*/` from metadata values.

## Side Effects
- `[widget_extractor.py:extract_widget_queries]`: Reads `Path(def_path).resolve()` from disk with no writes, network calls, or global mutations.
- `[publish-data-app.py:publish]`: Reads and updates `args.def_path` JSDoc metadata in place; installs a default HTTPS opener on import while scoping `LOOKER_CA_BUNDLE` to `_LOOKER_SSL_CTX`; sends Looker API 4.0 requests (`/login`, `/user`, `/swagger.json`, `/queries`, `/data_app_extension`, `/inline_extension/{id}/bundle.js`, `/dashboards`, `/dashboard_elements`, `/dashboard_layouts`); emits `ERROR_ENVELOPE_JSON:` to stderr and exits `1` on failure.

## Verification
- Run: `npm test`
