# Looker CLI 0.0.69 Upgrade, Alerts Analysis Skill, and Evaluation

*   **Author:** Bryan Weber
*   **Status:** Approved
*   **Date:** 2026-11-13

--------------------------------------------------------------------------------

## Overview

This design covers three connected changes in `data-app-builder` ("Ripper"):

1.  Upgrading the pinned `lkr-dev-cli` release from `0.0.67` to `0.0.69` so both the browser Monty WASM sandbox (`LkrCodeMode`) and the remote container CLI expose `alert_details` (`GET /alert_details`).
2.  Adding a Looker Alerts skill structured around **what users need to do with their alerts**—inspect running/failing alerts, diagnose root causes from execution history and query definitions, and take concrete remediation actions (disable/enable, change filters, change frequency, adjust thresholds, move/repoint to a new dashboard or tile, update recipients/owners, follow/unfollow, re-run, or delete)—along with the Ripper routing rules to reach it reliably.
3.  Adding an automated evaluation that grades alert routing, tool-call efficiency, diagnostic and action accuracy, and `Safe Mode` / RBAC safety.

## The Problem

Looker users who rely on alerts to monitor metrics have no guided workflow in Ripper to see how their alerts are performing, understand why an alert failed or fired unexpectedly, or update those alerts without clicking through individual dashboard tiles in the Looker UI. Three specific gaps block this today:

1.  **Missing execution-history endpoint**: `data-app-builder` pins `lkr-dev-cli` at `0.0.67`. The standard Looker OpenAPI 4.0 spec includes alert configuration and notification endpoints (`search_alerts`, `get_alert`, `update_alert`, `update_alert_field`, `create_alert`, `enqueue_alert`, `follow_alert`, `unfollow_alert`, `delete_alert`, `alert_notifications`), but omits Looker's internal `GET /alert_details` endpoint that returns alert execution details and run history. `lkr-dev-cli` `0.0.69` adds `alert_details` to `ExtendedLooker40SDK` and the Monty WASM runtime.
2.  **No job-oriented alerts skill or safe mutation rules**: Ripper has no skill organized around user alert workflows—listing what is running or broken, diagnosing why, and translating user intent into the right Looker API pattern (for example, `PATCH /alerts/{id}` via `update_alert_field` for partial field changes like `is_disabled` or `threshold`, vs. read-modify-write `PUT /alerts/{id}` via `update_alert` for `cron`, `applied_dashboard_filters`, `destinations`, or repointing a dashboard tile so existing fields are not wiped). Ripper `auto` routing also lacks alert keywords, risking misrouting to Conversational Analytics or LookML.
3.  **No verification coverage**: None of the existing evaluations in `scripts/run-evals.mjs` test `alert_details`, alert triage, read-modify-write alert updates, or `Safe Mode` / RBAC guardrails on alert actions.

## Goals

*   **Expose `GET /alert_details` across all runtimes**: Upgrade `lkr-dev-cli` from `0.0.67` to `0.0.69` across `lkr-dev-cli-version.txt`, `src/lkrCliBridge.ts`, `src/vendor/codemode.js`, sandbox bootstrap scripts, and version parity checks so `alert_details(...)` works in both browser WASM and the Antigravity sandbox.
*   **Anchor the Alerts skill on user questions and jobs first, API mechanics second**: Organize the skill around the real questions users ask and what they need to accomplish with alerts, then map each job to its read/write API flow:
    1.  **"My alerts are failing — how can I disable them?" (Triage & Pause/Resume)**: Inspect active, disabled, or erroring alerts (`search_alerts`, `alert_details`), explain why runs failed, disable or re-enable alerts with a `disabled_reason` (`update_alert_field`), or trigger an immediate test run (`enqueue_alert`).
    2.  **"I don't think my alert data is right" (Verify Data, Filters & Repointing)**: Inspect `field` (`field.filter`), `applied_dashboard_filters`, `query_id`, `comparison_type`, `threshold`, and `alert_details` run history; run/compare the underlying query against the source dashboard tile; fix `applied_dashboard_filters` / `field.filter` (`update_alert` read-modify-write) or move/repoint the alert to a new dashboard or tile (`dashboard_element_id` / `lookml_dashboard_id` / `query_id`, or `create_alert` + retiring the old alert).
    3.  **"I have too many alerts" (Audit Volume, Tune Frequency & Clean Up)**: Audit alert volume, duplicate alerts on the same dashboard/metric, noisy thresholds, and trigger frequency (`search_alerts` + `alert_details` + `alert_notifications`); widen `cron` frequency (`update_alert`), raise `threshold` (`update_alert_field`), `unfollow_alert`, disable (`is_disabled`), or `delete_alert`.
    4.  **"I'm not getting my alerts on mobile" (Delivery & Notification Diagnosis)**: Check whether the alert is enabled and succeeding (`search_alerts`, `alert_details`), whether the condition triggered and generated `MobilePayload` notifications (`alert_notifications`), whether the user is owner or following (`followed`, `follow_alert`), and inspect `destinations` (`EMAIL` / `ACTION_HUB`)—reporting device/app push settings as outside API scope when Looker notifications exist.
    5.  **Manage Ownership & Recipients**: Reassign `owner_id` or toggle `is_public` (`update_alert_field`), edit email/Slack/Action Hub `destinations` (`update_alert`), or acknowledge notifications (`read_alert_notification`).
*   **Enforce safe mutation boundaries**: Require explicit user confirmation and `Safe Mode (Ask)` approval before any mutating alert call executes, and use read-modify-write (`get_alert` -> merge -> `update_alert`) whenever calling `PUT /alerts/{id}` so untouched fields (`destinations`, `applied_dashboard_filters`, `cron`) are never dropped.
*   **Route alert prompts reliably**: Ensure `auto` mode and slash-skill invocation route alert prompts to the right Ripper capability without falsely triggering Conversational Analytics or creating unwanted dashboards/Data Apps.
*   **Verify behavior with an automated eval**: Add deterministic offline checks (and optional live checks) that validate alert routing, `alert_details` + alert-action tool usage, diagnostic/action output quality, and `Safe Mode` / RBAC safety.

## Non-Goals

*   **Modifying `lkrdev/cli` itself**: `alert_details` is already implemented in `lkrdev/cli` `0.0.69`; this design only consumes that release once published to PyPI and `cdn.lkr.dev`.
*   **Building an instance-wide `/admin/alerts` fleet management table**: While creating, editing, or inspecting an alert opens a persistent per-alert **Alert Inspector** tab (`contentType: 'alert'`) in `contentItems`, bulk fleet triage runs in chat + `LkrCodeMode` rather than duplicating Looker's `/admin/alerts` admin console.
*   **Bypassing Looker alert permissions or `Safe Mode`**: The skill will not work around Looker role restrictions (`manage_alerts`, `see_user_dashboards`, owner-only edit checks) or bypass `Safe Mode` approval prompts on mutating HTTP calls.
*   **External incident-management integrations** (PagerDuty, Jira, custom webhook relays outside Looker's existing `AlertDestination` Action Hub integrations): Out of scope for this change.

## Open Questions

None. All architectural forks from initial intake are resolved below.

### Resolved Findings & Decisions

*   **Skill location**: Lives in `skills/looker-alerts/SKILL.md` inside `data-app-builder` (bundled into Ripper prompts/sandbox skills), not `.agents/skills/` or `lkrdev/cli`.
*   **Right-pane artifact representation**: Creating or editing an alert opens or updates a persistent **Alert Inspector** tab (`contentType: 'alert'`) in `contentItems`, displaying the alert's status, threshold/comparison, `cron` schedule, `applied_dashboard_filters`, destinations, and `alert_details` history, plus a **Preview Dashboard with Filters** drill/flyover (`@looker/embed-sdk` dashboard embed initialized with the alert's `applied_dashboard_filters`).
*   **Eval placement and `npm test` scope**: Add `eval-11` inside `scripts/run-evals.mjs` (`npm run eval`) and remove `node scripts/run-evals.mjs` from `package.json` `"test"` so `npm test` runs `npm run lint:check && jest && node scripts/test-bundle.mjs`.
*   **`GET /alert_details` contract (verified on `dev-argolis`)**: Calling `alert_details()` with omitted/empty `alert_ids` returns HTTP 500 (`/500/get/alert_details`). Callers must pass `alert_ids` gathered from `search_alerts`. Each returned item contains `alert_id`, `dashboard_title`, `dashboard_id`, `dashboard_url`, `query_slug`, `model`, `view`, `average_runtime`, `alert_history_items`, and `latest_alert_sync_history`.
*   **Moving an alert to a new dashboard/tile (verified on `dev-argolis`)**: `PUT /alerts/{id}` (`update_alert`) with a modified `dashboard_element_id` across dashboards returns HTTP 500 (`/500/put/alerts/:alert_id`). Moving an alert across dashboards/tiles must clone-and-retire (`create_alert` on the target `dashboard_element_id` + `delete_alert` or `is_disabled: true` on the source alert).

## Critical User Journeys (CUJs)

### CUJ 1: "My alerts are failing — how can I disable them?"

*   **Given**: A user in Ripper has active and erroring alerts on their Looker instance, and `lkr-dev-cli` `0.0.69` is loaded in Monty WASM.
*   **When**: The user asks why alerts are failing or asks to disable failing alerts.
*   **Then**: Ripper routes the prompt without opening a Conversational Analytics sub-agent or creating an unwanted dashboard/app; the agent reads the alerts skill, calls `search_alerts` and `alert_details` (read-only, zero `Safe Mode` prompts), lists each failing alert with its execution error and dashboard link, proposes disabling the broken ones via `update_alert_field` (`is_disabled: true`, `disabled_reason`), and disables only the confirmed alerts after `Safe Mode` approval.

### CUJ 2: "I don't think my alert data is right" (Filters, Thresholds & Moving Tiles)

*   **Given**: An alert appears to trigger on unexpected numbers, stale filters, or an outdated dashboard tile.
*   **When**: The user asks to check why the alert data looks wrong and then asks to update its filters, change its threshold/frequency, or move it to a new dashboard or tile.
*   **Then**: The agent inspects the alert via `get_alert` and `alert_details`, checks `applied_dashboard_filters`, `field.filter`, and the underlying `query` / `dashboard` element, explains any mismatch, and applies either `update_alert_field` (`PATCH` for `threshold` / `is_disabled`), read-modify-write `update_alert` (`PUT` for `applied_dashboard_filters` or `cron`), or clone-and-retire (`create_alert` on the target tile + disabling/deleting the old alert) after `Safe Mode` approval—and opens or updates a persistent right-pane artifact (`contentItems` tab) for the created or edited alert.

### CUJ 3: "I have too many alerts" (Noisy Alerts & Volume Cleanup)

*   **Given**: A user receives excessive notifications from frequent or duplicate alerts.
*   **When**: The user asks how to reduce or clean up their alerts.
*   **Then**: The agent combines `search_alerts`, `alert_details`, and `alert_notifications` to rank alerts by trigger frequency, duplicate targets, and followed vs. owned status; recommends concrete reductions (widen `cron` frequency, raise threshold, `unfollow_alert`, disable, or `delete_alert`); and executes only the user-selected actions behind `Safe Mode` approval.

### CUJ 4: "I'm not getting my alerts on mobile" (Notification & Delivery Triage)

*   **Given**: A user expects mobile/in-app alert notifications that are not arriving.
*   **When**: The user asks why they are not receiving alerts on mobile.
*   **Then**: The agent checks `search_alerts`, `alert_details`, and `alert_notifications` (`MobilePayload`) to verify whether the alert is enabled, running without errors, meeting its threshold, and being followed by the user (`followed`, `follow_alert`), and inspects `destinations`. If Looker is generating `alert_notifications` cleanly for the user, the agent reports that server-side conditions are met and states that device/OS mobile app push settings sit outside the Looker API.

### CUJ 5: Permission-Restricted Alert Handling

*   **Given**: A non-admin user queries alerts they do not own or attempts an action their Looker role does not allow (such as editing or deleting someone else's alert, or calling `GET /alert_details` without sufficient Looker permissions).
*   **When**: Looker returns `403` or a role-denied `404` on `alert_details` or an alert mutation.
*   **Then**: The agent surfaces the permission boundary clearly (using `classifyLooker404Error` / RBAC guidance where applicable) rather than retrying blindly, and limits suggested actions to what the user's role permits (such as `unfollow_alert` or creating their own replacement alert instead of `update_alert` / `delete_alert`).

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

The design spans four subsystems in `data-app-builder`: (1) the `lkr-dev-cli` `0.0.69` version bump and WASM bundle sync, (2) the job-oriented `looker-alerts` skill and Ripper routing rules, (3) the `<ALERT_BUNDLE>` persistence pipeline and `AlertInspectorPane` with a filtered dashboard flyover, and (4) `eval-11` in `scripts/run-evals.mjs` plus lighter `npm test`.

```text
User Prompt ("My alerts are failing..." / "Move alert 42 to dashboard 25" / "/looker-alerts")
  │
  ▼
Ripper Router (src/lookerPermissions.ts)
  ├─ Read-only audit/triage ──► `tile` mode (answers in chat; no right-pane clutter)
  └─ Create / edit / inspect ─► `tile` + emits `<ALERT_BUNDLE>` ──► `contentItems` (`alert:<id>`)
  │                                                                        │
  ▼                                                                        ▼
LkrCodeMode WASM / Sandbox CLI (lkr-dev-cli 0.0.69)                AlertInspectorPane (Right Pane)
  ├─ Read-only (`requiresPermission: false`):                        ├─ Status, threshold, cron, filters
  │    search_alerts -> alert_details(alert_ids=[...])               ├─ Destinations & alert_history_items (<=10)
  │    alert_notifications, get_alert, dashboard, query              └─ [Preview Dashboard with Filters]
  └─ Mutating (`Safe Mode` `requiresPermission: true`):                   │
       PATCH /alerts/:id (update_alert_field)                             ▼
       PUT   /alerts/:id (get_alert -> merge -> update_alert)        Preloaded Looker Embed Controller (`embedContainerRef`)
       POST  /alerts     (clone on move + disable/delete old)        /embed/dashboards/<id>?<encoded_applied_dashboard_filters>
       POST  /alerts/:id/enqueue, follow/unfollow, DELETE              (works in browser & Jest mockPreviewHtml)
```

### 1. `lkr-dev-cli` `0.0.69` Upgrade & Parity

*   **Version bump across all parity checks**: Update `0.0.67` -> `0.0.69` in `lkr-dev-cli-version.txt`, `src/lkrCliBridge.ts` (`CODEMODE_CDN_URL`, `LKR_DEV_CLI_VERSION`, and `_PINNED_CLI_VERSION` in `BOOTSTRAP_LOOKML_PY`), `AGENTS.md`, `upstream/payload/AGENTS.md`, `scripts/test-bundle.mjs` (including `vendorSha256`), `src/__tests__/permissions.test.ts`, and `EGM.md` / `src/EGM.md` / `scripts/EGM.md`.
*   **Vendor WASM parity**: Run `npm run sync-codemode` against `https://cdn.lkr.dev/cli/codemode/0.0.69/codemode.js` so `src/vendor/codemode.js` matches the CDN asset byte-for-byte (verified by SHA-256 in `scripts/test-bundle.mjs`).
*   **Safe Mode classification & activity previews**: In `classifyLookerOperation` (`src/lkrCliBridge.ts`), keep `GET /alert_details`, `GET /alerts`, `GET /alerts/:id`, and `GET /alert_notifications` read-only (`requiresPermission: false`), and add explicit sub-route rules before the first-segment fallback so `POST /alerts/:id/enqueue` -> `'enqueue_alert'`, `POST /alerts/:id/follow` -> `'follow_alert'`, `DELETE /alerts/:id/follow` -> `'unfollow_alert'` (never aliasing to `'delete_alert'`), `PATCH /alerts/:id` -> `'update_alert_field'`, and `POST /alert_notifications/:id/read` -> `'read_alert_notification'`, while extending the `rawPath`-less code fallback regex to include `enqueue|follow|unfollow|read`. Extend `KNOWN_LOOKER_SDK_CALL_RE` in `src/antigravitySteps.ts` so alert SDK calls appear in step previews.

### 2. Job-First `looker-alerts` Skill & Ripper Routing

*   **Skill location and bundling**: Author `skills/looker-alerts/SKILL.md`, export it as `LOOKER_ALERTS_SKILL_MD` in `src/antigravityPrompts.ts`, register it in `BUILTIN_SKILLS_FILES` and `SANDBOX_AGENT_SKILL_FILES['looker-alerts/SKILL.md']` (`src/antigravitySteps.ts`), mount it in `buildWorkspaceSources` (`src/antigravity.ts`), add `/looker-alerts` to `STUDIO_SLASH_SKILLS` (`src/lookmlSkills.ts`), and document it in `AGENTS.md`, `upstream/payload/AGENTS.md`, and `skills/EGM.md`.
*   **Skill structure (User Needs First, API Mechanics Second)**:
    1.  **"My alerts are failing — how can I disable them?"**: Run `search_alerts(all_owners=...)` -> pass collected `alert_ids` to `alert_details(alert_ids=...)` (never call `alert_details()` without `alert_ids`) -> check `alert_history_items`, `disabled_reason`, and `latest_alert_sync_history` -> explain the root error -> offer to disable selected alerts via `update_alert_field(alert_id, {"is_disabled": True, "disabled_reason": "..."})`.
    2.  **"I don't think my alert data is right"**: Inspect `get_alert(alert_id)` (`field`, `comparison_type`, `threshold`, `applied_dashboard_filters`) + `alert_details` (`query_slug`, `dashboard_id`, `latest_alert_sync_history`) + `dashboard(dashboard_id)` / `query_for_slug(query_slug)` + live query comparison -> fix filters or schedules via read-modify-write `get_alert` -> merge -> `update_alert` (`PUT`), or move across tiles via clone-and-retire (`create_alert` on target `dashboard_element_id` first and verify a returned `alert_id`, then default to disabling the source alert via `update_alert_field(..., {"is_disabled": True, "disabled_reason": "Moved to alert #<new_id>"})` or `delete_alert` when explicitly requested).
    3.  **"I have too many alerts"**: Combine `search_alerts`, `alert_details`, and `alert_notifications` to group alerts by dashboard/tile, trigger frequency, `cron` cadence, and `followed` vs. owned -> propose widening `cron` (`update_alert`), raising `threshold` (`update_alert_field`), `unfollow_alert`, disabling, or `delete_alert`.
    4.  **"I'm not getting my alerts on mobile"**: Verify `is_disabled == False`, recent `alert_history_items` from `alert_details`, generated `MobilePayload` entries in `alert_notifications`, `followed == True` (`follow_alert` if needed), and `destinations` (`EMAIL` / `ACTION_HUB`); explain device/app push settings when server-side notifications exist.
    5.  **Creating, testing & permission boundaries**: Create alerts on numeric dashboard elements (`create_alert`), run on demand (`enqueue_alert(alert_id, force=...)`), and catch `403` / role-denied `404` exceptions in Python while `classifyLooker404Error` in `src/lookerPermissions.ts` includes alert RBAC remediation (`create_alerts`, `follow_alerts`, `manage_alerts`, and owner-only edit rules)—never bypassing `Safe Mode`.
*   **Prompt routing (`src/lookerPermissions.ts`)**: Define `LOOKER_ALERT_QUERY_RE` and update `LOOKER_INSTANCE_API_QUERY_RE`, `isLookerInstanceMetadataQuery`, and `matchExplicitUseCaseRule` (`USE_CASE_RULES`, exempting `LOOKER_ALERT_QUERY_RE` from the `CONTENT_CREATION_VERB_RE` skip and evaluating it before `'dashboard'` and `'data-investigator'`) so both read-only and mutating alert prompts route deterministically to `tile` (`SLASH_SKILL_USE_CASES['looker-alerts'] = 'tile'`) without triggering `shouldRouteToIsolatedCaSubagent`.

### 3. Persistent Alert Inspector Tab & Filtered Dashboard Flyover

*   **Data contract (`<ALERT_BUNDLE>`)**: Define `AlertInspectorBundle` in `src/antigravityTypes.ts` and add `'alert'` to `StudioContentItemType` (`src/dataAppPublisher.ts`) and `StudioToolMode` (`src/lookerArtifacts.ts`). When an alert is created, updated, or explicitly inspected, the agent emits `<ALERT_BUNDLE>{...}</ALERT_BUNDLE>` directly in its `run_looker_codemode` output or response text (capping `alert_history_items` at the 10 most recent entries):
    *   Alert identity & config: `alert_id`, `title`, `owner_id`, `owner_display_name`, `dashboard_element_id`, `is_disabled`, `disabled_reason`, `is_public`, `followed`, `cron`, `comparison_type`, `threshold`, `field` (`title`, `name`, `filter`), `applied_dashboard_filters` (`Array<{ filter_title: string; field_name: string; filter_value: string; filter_description?: string }>`), `destinations` (`Array<{ destination_type: string; email_address?: string; action_hub_integration_id?: string }>`).
    *   Execution context from `GET /alert_details`: `dashboard_id`, `dashboard_title`, `dashboard_url`, `query_slug`, `model`, `view`, `average_runtime`, `alert_history_items` (bounded to `<= 10`), `latest_alert_sync_history`.
*   **Extraction & lightweight persistence**:
    *   `extractAlertBundleFromInteraction` in `src/antigravitySteps.ts` / `src/antigravity.ts` extracts `<ALERT_BUNDLE>` from `run_looker_codemode` results or assistant text, strips `<ALERT_BUNDLE>` via `BUNDLE_ENVELOPE_STRIP_RE` and `cleanAssistantText`, and includes `extractAlertBundleFromInteraction` in `hasFinalBundle`.
    *   `src/lookerArtifacts.ts` & `src/studioControllerTurn.ts` bypass the `'tile'` script-save branch when `result.alertBundle` is present (and suppress the reusable Script prompt on chat-only alert turns), upsert a `contentItems` entry (`key: "alert:<alert_id>"`, `contentType: 'alert'`, `embedPath: "/alerts/<alert_id>"`), and persist compact `obj_alert_<alert_id>` metadata without adding the alert's host `dashboard_id` to conversation deletion targets in `resolveConversationRelatedContent`.
*   **UI viewer & Dashboard-with-Filters flyover (`src/components/AlertInspectorPane.tsx` + `src/components/StudioWorkspace.tsx`)**:
    *   Render `AlertInspectorPane` inside `StudioWorkspace.tsx` when `activePaneKind === 'alert'`, using `StudioDesignSystem` primitives (`StudioCard`, `StudioBadge`, `StudioButton`), filter pills, destinations list, and a run-history table.
    *   Include an `Open in Looker ↗` action (`/dashboards/<dashboard_id>`) and a **"Preview Dashboard with Filters"** toggle button (enabled when `dashboard_id` is present) that opens an inline flyover stage view backed by `StudioWorkspace.tsx`'s existing preloaded `createLookerEmbedPreloadController` (`embedContainerRef`) pointed at `/embed/dashboards/${encodeURIComponent(dashboard_id)}?${encodedFilterParams}` (built from `applied_dashboard_filters` via `filter_title || field_name` -> `filter_value`), avoiding a second `@looker/embed-sdk` instance and working in both browser and Jest `mockPreviewHtml` tests.

### 4. Evaluation (`eval-11`) & `npm test` Decoupling

*   **Decouple evals from `npm test`**: Update `package.json` `"test"` to `npm run lint:check && jest && node scripts/test-bundle.mjs` (keeping `"eval": "node scripts/run-evals.mjs"`). Update `EGM.md` and `scripts/EGM.md` to document the 11-eval suite and the `npm test` vs. `npm run eval` split.
*   **Add `eval-11` (`eval11AlertsTriageAndActions`) to `scripts/run-evals.mjs`**:
    *   **Routing**: Asserts alert prompts ("My alerts are failing...", "I have too many alerts", "I'm not getting my alerts on mobile", `/looker-alerts`) route to `tile` and are never intercepted by `shouldRouteToIsolatedCaSubagent`.
    *   **Tool Budget**: Executes `search_alerts` + `alert_details(alert_ids=[...])` in Monty WASM against mock Looker transport (0 `Safe Mode` prompts, verifying `alert_ids` is always passed and never omitted).
    *   **Output Rubric**: Verifies `skills/looker-alerts/SKILL.md` covers all four user questions, `get_alert` read-modify-write for `PUT /alerts/{id}`, and clone-and-retire (`create_alert` + `delete_alert`/disable) for moving across dashboards; verifies `extractAlertBundleFromInteraction` parses `<ALERT_BUNDLE>` with `applied_dashboard_filters` for the flyover.
    *   **Safety**: Verifies `Safe Mode` (`requirePermission: true`) allows `alert_details` / `search_alerts` with 0 prompts, intercepts `update_alert_field`, `update_alert`, and `delete_alert`, blocks transport execution on `'deny'`, and caches `'allow_op'`. Supports optional `--live` smoke verification on `dev-argolis`.

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: Host Dashboard Embed Tab Only (`NATIVE_CONTENT_BUNDLE` Without Alert Inspector)

*   **Pros**: Requires zero new React viewer components or `StudioContentItemType` changes; shows the underlying dashboard live via Looker's embed iframe.
*   **Cons**: Looker's embedded dashboard view does not show or highlight alert configuration (`cron`, `threshold`, `comparison_type`, `destinations`, `disabled_reason`, or `alert_details` run history), and alerts without a `dashboard_id` have no embeddable target.
*   **Reason for Rejection**: Rejected by author: creating or editing an alert needs a dedicated persistent Alert Inspector tab in `contentItems` with an on-demand flyover to preview the dashboard with filters applied.

### Alternative B: Dual Emission (Alert Inspector Tab Plus Automatic Host Dashboard Tab)

*   **Pros**: Exposes both alert metadata and the live embedded dashboard immediately in the tab ribbon without needing a flyover control.
*   **Cons**: Creates two tabs whenever an alert is created or edited on a dashboard that was not already open, cluttering `contentItems` during multi-alert triage.
*   **Reason for Rejection**: Rejected by author: a single Alert Inspector tab with an embedded dashboard-with-filters drill/flyover keeps the tab ribbon clean while preserving access to the filtered dashboard view.

### Alternative C: Placing the Alerts Skill in `.agents/skills/` or Upstream `lkrdev/cli`

*   **Pros**: Makes the skill immediately reusable by non-Ripper `lkrdev/cli` CLI users and automatically packs it via `src/sandboxSkillsBundle.ts`.
*   **Cons**: `.agents/skills/` is tracked and overwritten by the Monday/Thursday automated sync (`.github/workflows/update-skills.yml`), and the Ripper-specific `<ALERT_BUNDLE>` emission contract and Ripper routing rules do not apply to standalone CLI usage.
*   **Reason for Rejection**: Rejected by author: placing the skill in `skills/looker-alerts/SKILL.md` keeps Ripper-owned workflow skills together with `looker-dashboard`, `key-driver-analysis`, `looker-field-profiler`, and `looker-project-onboarding`.

### Alternative D: Moving Alerts Across Dashboards via In-Place `PUT /alerts/{id}` (`update_alert`)

*   **Pros**: Preserves the original `alert_id` and `alert_history_items` without creating a new alert or removing the old one.
*   **Cons**: Fails on Looker 4.0 API—verified on `dev-argolis` that changing `dashboard_element_id` in `PUT /alerts/{id}` returns HTTP 500 (`/500/put/alerts/:alert_id`).
*   **Reason for Rejection**: Rejected due to verified Looker API behavior: moving an alert to a new dashboard or tile must clone-and-retire (`create_alert` on the target tile followed by `delete_alert` or disabling the source alert).

### Alternative E: Standalone Eval Script (`scripts/eval-alerts.mjs`) or Keeping Evals Inside `npm test`

*   **Pros**: A standalone script leaves `scripts/run-evals.mjs` untouched, while keeping evals in `npm test` enforces eval runs on every test command.
*   **Cons**: A standalone script fragments Ripper's 4-dimension grading scorecard, whereas running all WASM/eval checks on every `npm test` adds unnecessary overhead during regular unit/lint development.
*   **Reason for Rejection**: Rejected by author: adding `eval-11` to `scripts/run-evals.mjs` keeps one unified scorecard under `npm run eval`, while removing `node scripts/run-evals.mjs` from `npm test` keeps `npm test` fast and focused on lint, Jest, and `test-bundle.mjs`.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security, RBAC & Safe Mode**: Read-only alert discovery (`search_alerts`, `get_alert`, `alert_details`, `alert_notifications`) executes with zero `Safe Mode` prompts. All alert mutations (`create_alert`, `update_alert_field`, `update_alert`, `enqueue_alert`, `follow_alert`, `unfollow_alert`, `delete_alert`) require `Safe Mode` approval (`requiresPermission: true`), and `delete_alert` requires explicit user confirmation. Persisted `obj_alert_<id>` artifacts store only compact alert state and `alert_details` history, respecting Ripper's Looker Artifacts Lightweight-Only rule (no chat transcripts).
*   **Performance & Bundle Footprint**: Browser Monty WASM continues loading from `https://cdn.lkr.dev/cli/codemode/0.0.69/codemode.js` so `dist/bundle.js` stays under the `2 MiB` threshold enforced by `scripts/test-bundle.mjs`. `search_alerts` should precede `alert_details(alert_ids=[...])` with bounded ID lists to avoid oversized queries or HTTP 500 responses from omitted `alert_ids`.
*   **Rollout & Rollback**: Implementation and `npm run sync-codemode` are gated on `lkr-dev-cli` `0.0.69` finishing its publish to PyPI and `cdn.lkr.dev`. If `0.0.69` CDN distribution has issues after deployment, reverting `lkr-dev-cli-version.txt`, `src/lkrCliBridge.ts`, `src/vendor/codemode.js`, and version assertions back to `0.0.67` restores prior behavior cleanly (while keeping `eval-11` / routing changes gated or disabled if `alert_details` is unavailable).

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Work is partitioned into 4 buildable, independently verifiable phases:

*   **Phase 1 (Items 1–3, 21)**: CLI `0.0.69` Version Bump, WASM Sync & Safe Mode Classifier -> *Checkpoint*: `npm run sync-codemode && node scripts/test-bundle.mjs`
*   **Phase 2 (Items 4, 7–9, 18)**: `looker-alerts` Skill Authoring, Prompt Bundling & Routing -> *Checkpoint*: `npm run lint:check`
*   **Phase 3 (Items 5–6, 10–17)**: `<ALERT_BUNDLE>` Contract, Artifact Persistence & `AlertInspectorPane` UI -> *Checkpoint*: `npm run lint:check && npm run build`
*   **Phase 4 (Items 19–20, 22–23)**: `npm test` Decoupling, Unit Tests, `eval-11` & Docs -> *Checkpoint*: `npm test && npm run eval`

### Target Files to Create/Modify

#### 1. `lkr-dev-cli-version.txt` (Modify)
*   **Type / Scope**: Release Pin Configuration
*   **Proposed Changes**: Bump the pinned version string from `0.0.67` to `0.0.69` so `sync-codemode.sh` and version parity tests resolve `0.0.69` as the single source of truth.

#### 2. `src/lkrCliBridge.ts` (Modify)
*   **Type / Scope**: TypeScript WASM Bridge & Safe Mode Classifier
*   **Proposed Changes**: Update `CODEMODE_CDN_URL` to `https://cdn.lkr.dev/cli/codemode/0.0.69/codemode.js`, `LKR_DEV_CLI_VERSION` to `'0.0.69'`, and the fallback `_PINNED_CLI_VERSION` in `BOOTSTRAP_LOOKML_PY`. In `classifyLookerOperation`, add explicit sub-route rules before the first-segment fallback for `POST /alerts/:id/enqueue` (`'enqueue_alert'`), `POST /alerts/:id/follow` (`'follow_alert'`), `DELETE /alerts/:id/follow` (`'unfollow_alert'`), `PATCH /alerts/:id` (`'update_alert_field'`), and `POST /alert_notifications/:id/read` (`'read_alert_notification'`), and extend the `rawPath`-less code fallback regex to include `enqueue|follow|unfollow|read` while keeping `GET /alert_details`, `GET /alerts*`, and `GET /alert_notifications` read-only (`requiresPermission: false`).

#### 3. `src/vendor/codemode.js` (Modify via `npm run sync-codemode`)
*   **Type / Scope**: Vendored Monty WASM Runtime
*   **Proposed Changes**: Sync the published `0.0.69/codemode.js` bundle from `cdn.lkr.dev` so offline Node/Jest/eval runs include `alert_details` and pass SHA-256 parity in `scripts/test-bundle.mjs`.

#### 4. `skills/looker-alerts/SKILL.md` (Create)
*   **Type / Scope**: Ripper Workflow Skill
*   **Proposed Changes**: Author the job-first Looker Alerts skill organized around the four core user scenarios ("My alerts are failing — how can I disable them?", "I don't think my alert data is right", "I have too many alerts", "I'm not getting my alerts on mobile") plus creating/testing alerts and RBAC handling. Document exact API workflows: `search_alerts` -> `alert_details(alert_ids=[...])` (never omitting `alert_ids`), `alert_notifications` (`MobilePayload`), `update_alert_field` (`PATCH`), `get_alert` -> merge -> `update_alert` (`PUT`) read-modify-write, clone-and-retire (`create_alert` first and verify returned `alert_id`, then default to disabling the source alert or `delete_alert` when requested) for cross-dashboard moves, `Safe Mode` confirmation rules, and emitting `<ALERT_BUNDLE>` (with `alert_history_items` capped at `<= 10`) on create/edit/inspect actions.

#### 5. `src/antigravityTypes.ts` (Modify)
*   **Type / Scope**: TypeScript Shared Contracts
*   **Proposed Changes**: Add `AlertInspectorBundle` (and nested interfaces for `applied_dashboard_filters`, `field`, `destinations`, `alert_history_items`, `latest_alert_sync_history`) matching the Looker `Alert` + `GET /alert_details` schemas so the controller, persistence layer, and UI share one canonical contract without `any`.

#### 6. `src/dataAppPublisher.ts` (Modify)
*   **Type / Scope**: Content Type Union
*   **Proposed Changes**: Add `'alert'` to `StudioContentItemType` so alerts are first-class tabs in `contentItems`.

#### 7. `src/antigravityPrompts.ts` (Modify)
*   **Type / Scope**: Prompt & Built-in Skill Definitions
*   **Proposed Changes**: Export `LOOKER_ALERTS_SKILL_MD` (kept in sync with `skills/looker-alerts/SKILL.md`), add `skills/looker-alerts/SKILL.md` to `AGENTS_MD` routing guidance, update `0.0.67` references via `LKR_DEV_CLI_VERSION`, and document the `<ALERT_BUNDLE>` emission contract for alert create/edit/inspect turns.

#### 8. `src/lookmlSkills.ts` (Modify)
*   **Type / Scope**: Slash Skill Catalog
*   **Proposed Changes**: Register `{ id: 'looker-alerts', label: 'Looker Alerts', desc: ..., path: 'skills/looker-alerts/SKILL.md' }` in `STUDIO_SLASH_SKILLS` so users can invoke `/looker-alerts` directly from the composer.

#### 9. `src/lookerPermissions.ts` (Modify)
*   **Type / Scope**: Prompt Routing & Capabilities
*   **Proposed Changes**: Define `LOOKER_ALERT_QUERY_RE` and extend `LOOKER_INSTANCE_API_QUERY_RE`, `isLookerInstanceMetadataQuery`, and `matchExplicitUseCaseRule` (`USE_CASE_RULES`, exempting `LOOKER_ALERT_QUERY_RE` from the `CONTENT_CREATION_VERB_RE` skip and evaluating it before `'dashboard'` and `'data-investigator'`) to route alert analysis/management prompts to `'tile'`, map `SLASH_SKILL_USE_CASES['looker-alerts'] = 'tile'`, add `c.alertId` to `getConvTargetId`, update `classifyLooker404Error` with alert RBAC guidance, and prevent `shouldRouteToIsolatedCaSubagent` from hijacking alert triage questions to Conversational Analytics.

#### 10. `src/antigravitySteps.ts` (Modify)
*   **Type / Scope**: Skill Mounting & Interaction Extraction
*   **Proposed Changes**: Register `skills/looker-alerts/SKILL.md` in `BUILTIN_SKILLS_FILES` and `SANDBOX_AGENT_SKILL_FILES['looker-alerts/SKILL.md']`, add `extractAlertBundleFromInteraction` to parse `<ALERT_BUNDLE>...</ALERT_BUNDLE>` from `run_looker_codemode` results or assistant output, add `ALERT_BUNDLE` to `BUNDLE_ENVELOPE_STRIP_RE`, and extend `KNOWN_LOOKER_SDK_CALL_RE` with `alert_details`, `search_alerts`, `get_alert`, `create_alert`, `update_alert`, `update_alert_field`, `delete_alert`, `enqueue_alert`, `follow_alert`, `unfollow_alert`, `alert_notifications`, and `read_alert_notification`.

#### 11. `src/antigravity.ts` (Modify)
*   **Type / Scope**: Antigravity Turn Runner
*   **Proposed Changes**: Mount `skills/looker-alerts/SKILL.md` in `buildWorkspaceSources`, add `alertBundle?: AlertInspectorBundle | null` to `AntigravityTurnResult`, include `extractAlertBundleFromInteraction` in `hasFinalBundle` and `runAntigravityTurn`, strip `<ALERT_BUNDLE>` tags from visible chat prose (`cleanAssistantText`), and re-export `AlertInspectorBundle`, `extractAlertBundleFromInteraction`, and `LOOKER_ALERTS_SKILL_MD`.

#### 12. `src/lookerArtifacts.ts` (Modify)
*   **Type / Scope**: Looker Artifacts Persistence & Hydration
*   **Proposed Changes**: Add `'alert'` to `StudioToolMode` / `STUDIO_TOOL_MODES` and user-index key regexes, support `'alert'` in `formatStudioContentItemTitle`, `resolveStudioContentEmbedPath` (`/alerts/<id>`), `StudioContentItem` (`alertId?: string`), `hydrateConversationContentItems`, and `resolveConversationRelatedContent` (mapping only to `user_${uid}_alert_${id}` and `obj_alert_${id}`, never adding the alert's host `dashboard_id` to `dashboardIds` for deletion); add `saveAlertArtifact` / `loadAlertArtifact` storing compact `obj_alert_<id>` metadata only.

#### 13. `src/studioControllerLoaders.ts` (Modify)
*   **Type / Scope**: Controller State & Tab Hydration
*   **Proposed Changes**: Add `alertBundle` state/ref, hydrate `obj_alert_<id>` in `syncContentItemViewer` and `openArtifactByMode` when selecting or restoring an `'alert'` tab in `contentItems`, and clear `alertBundle` on conversation reset.

#### 14. `src/studioControllerTurn.ts` (Modify)
*   **Type / Scope**: Turn Lifecycle Handler
*   **Proposed Changes**: Add `!result.alertBundle` to the `resolvedUseCase === 'tile'` script guard (line 732) and suppress the `"Would you like me to save this Looker API lookup as a reusable **Script**?"` suffix on alert turns; when `result.alertBundle` is returned from `runAntigravityTurn`, persist `obj_alert_<id>`, upsert `contentItems` (`key: "alert:<id>"`, `contentType: 'alert'`, `hidden: false`), select the Alert Inspector tab in the right pane, and record a `TurnCrudItem`.

#### 15. `src/components/AlertInspectorPane.tsx` (Create)
*   **Type / Scope**: React UI Component (`StudioDesignSystem`)
*   **Proposed Changes**: Build the persistent Alert Inspector panel displaying alert status (`Active` / `Disabled` / `Failing`), threshold & comparison condition, `cron` schedule, owner & `followed` indicator, `applied_dashboard_filters` / `field.filter` chips, `destinations`, `alert_details` run/sync history (`average_runtime`, `alert_history_items`, `latest_alert_sync_history`), an `Open in Looker ↗` action (`/dashboards/<dashboard_id>`), and a **Preview Dashboard with Filters** toggle button (`buildAlertDashboardFilterUrl`).

#### 16. `src/components/StudioWorkspace.tsx` (Modify)
*   **Type / Scope**: Right-Pane Stage & Tab Integration
*   **Proposed Changes**: Add `'alert'` handling to `activePaneKind`, `resolveLookerEmbedTarget` (returning `preload` when the alert dashboard flyover is closed, and `/embed/dashboards/<dashboard_id>?<encoded_filters>` when the flyover is open), `renderContentTabIcon`, `CONTENT_TYPE_LABELS`, `SHORT_CONTENT_TAGS`, `resolveContentLookerPath` (`/dashboards/<dashboard_id>` when `dashboard_id` is available, `''` otherwise), `hasActiveViewerPane`, `isNonEmbed`, and render `<AlertInspectorPane>` (plus the preloaded dashboard flyover header when active) when `activePaneKind === 'alert'`.

#### 17. `src/styles/index.css` (Modify)
*   **Type / Scope**: Design System Styles (`--dab-*`)
*   **Proposed Changes**: Add scoped `.dab-alert-*` layout and flyover header styles using existing `--dab-*` theme tokens and `.dab-stage-scroll` / `StudioCard` primitives.

#### 18. `src/lookerApi.ts` (Modify)
*   **Type / Scope**: Public Module Re-Exports
*   **Proposed Changes**: Export `LOOKER_ALERTS_SKILL_MD`, `LOOKER_ALERT_QUERY_RE`, `saveAlertArtifact`, `loadAlertArtifact`, and `AlertInspectorBundle` unconditionally alongside `LOOKER_DASHBOARD_SKILL_MD` and `LOOKER_FIELD_PROFILER_SKILL_MD`.

#### 19. `package.json` (Modify)
*   **Type / Scope**: NPM Scripts Configuration
*   **Proposed Changes**: Change `"test"` to `"npm run lint:check && jest && node scripts/test-bundle.mjs"` so evals run via `npm run eval` rather than every `npm test`.

#### 20. `scripts/run-evals.mjs` (Modify)
*   **Type / Scope**: Automated Evaluation Suite (`eval-11`)
*   **Proposed Changes**: Add `eval11AlertsTriageAndActions` (`eval-11`) grading all four dimensions (`routing`, `toolBudget`, `outputRubric`, `safety`) offline against Monty WASM + mock Looker transport (and optional `--live` verification on `dev-argolis`): routing alert prompts to `tile` without CA interception, calling `search_alerts` + `alert_details(alert_ids=[...])` read-only with non-empty `alert_ids`, verifying `SKILL.md` job coverage and `<ALERT_BUNDLE>` extraction with `applied_dashboard_filters`, and verifying `Safe Mode` blocks denied alert mutations (`update_alert_field`, `update_alert`, `delete_alert`).

#### 21. `scripts/test-bundle.mjs` (Modify)
*   **Type / Scope**: Offline Bundle & Parity Harness
*   **Proposed Changes**: Update pinned version assertions from `0.0.67` to `0.0.69` (including CDN URL, `bootstrap_lookml.py` mock shims, and `vendorSha256` for `0.0.69/codemode.js`) and assert `skills/looker-alerts/SKILL.md` is bundled and exposed via `BUILTIN_SKILLS_FILES` and `SANDBOX_AGENT_SKILL_FILES`.

#### 22. `src/__tests__/permissions.test.ts` (Modify)
*   **Type / Scope**: Jest Unit Tests
*   **Proposed Changes**: Update `0.0.67` pin assertions to `0.0.69`, and add unit tests covering alert routing (`tile`, non-CA), `classifyLookerOperation` for `/alert_details` vs. alert mutations, `<ALERT_BUNDLE>` extraction and `obj_alert_<id>` lightweight persistence, and `AlertInspectorPane` filter-map conversion for the dashboard flyover.

#### 23. `AGENTS.md`, `upstream/payload/AGENTS.md`, `EGM.md`, `src/EGM.md`, `src/components/EGM.md`, `skills/EGM.md`, `scripts/EGM.md` (Modify)
*   **Type / Scope**: Documentation & Architecture Blueprints
*   **Proposed Changes**: Update pinned `lkr-dev-cli` version (`0.0.69`), document `skills/looker-alerts/SKILL.md`, `AlertInspectorPane.tsx`, the `11`-eval suite (`npm run eval`), and the updated `npm test` command.

### Verification Plan

*   **Compilation/Build**: `npm run build` (must succeed and produce `dist/bundle.js` `< 2 MiB`).
*   **Static Analysis & Linting**: `npm run lint:check` (`eslint src --ext js,jsx,ts,tsx --max-warnings=0`, enforcing zero `any`).
*   **Unit Tests & Bundle Parity**: `npm test` (runs `npm run lint:check && jest && node scripts/test-bundle.mjs`, verifying `0.0.69` CDN SHA-256 parity, alert routing, `<ALERT_BUNDLE>` extraction, and `Safe Mode` gates).
*   **Automated Evaluation**:
    *   Offline: `npm run eval` (runs `eval-01`..`eval-11`, requiring `44/44` total points).
    *   Targeted & Live: `node scripts/run-evals.mjs --eval=11 --live` against `dev-argolis` after `0.0.69` finishes publishing (exercising `create_alert`, `alert_details(alert_ids=[...])`, `update_alert_field`, and `delete_alert` cleanup, plus verifying the Alert Inspector tab and dashboard-with-filters flyover in Ripper).

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
