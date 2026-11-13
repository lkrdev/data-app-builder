---
name: looker-alerts
description: Triage, inspect, create, update, move, and manage Looker alerts using search_alerts, alert_details, get_alert, create_alert, update_alert, update_alert_field, delete_alert, enqueue_alert, follow_alert, unfollow_alert, alert_notifications, and read_alert_notification in lkr code-mode. Emit <ALERT_BUNDLE> when creating, editing, or inspecting a specific alert.
---

# Looker Alerts (`skills/looker-alerts/SKILL.md`)

Use this skill whenever the user asks about Looker alerts — troubleshooting failing alerts, verifying alert data/filters, tuning noisy alert frequencies or thresholds, diagnosing missing mobile/Slack/email notifications, moving alerts to a new dashboard tile, or creating and editing alerts in **Ripper**.

Always route alert prompts to `<USE_CASE>tile</USE_CASE>` and execute Looker SDK calls via `run_looker_codemode`.

---

## 1. User-Goal Playbooks (What Users Need to Do First)

Organize every alert investigation around the user's concrete goal before choosing SDK endpoints:

### Goal A: *"My alerts are failing — how can I disable them?"*
1. **Discover failing or disabled alerts**:
   - Call `search_alerts(disabled=False)` (or `search_alerts()` to include already auto-disabled alerts) to collect candidate `id` values and inspect `disabled_reason`, `investigative_content_id`, and `dashboard_element_id`.
2. **Batch-inspect execution history (`alert_details`)**:
   - Call `alert_details(alert_ids=[...])` with the non-empty list of alert IDs (up to 50 IDs per batch; **never** pass `alert_ids=[]`).
   - Inspect `error`, `disabled_reason`, `alert_history_items` (`outcome`, `message`, `Check_start_time`), `dashboard_id`, `dashboard_name`, and `lookml_dashboard_id` to identify broken LookML fields, deleted dashboard tiles, or warehouse query errors.
3. **Disable or repair**:
   - **Fast single-owner / disable toggle (`PATCH /alerts/{id}`)**: Call `update_alert_field(alert_id=id, body={"is_disabled": True, "disabled_reason": "Disabled by owner while fixing broken field"})`.
   - **Full update (`PUT /alerts/{id}`)**: If modifying filters, destinations, or conditions alongside `is_disabled`, use the read-modify-write helper (`get_alert` -> merge -> `update_alert`).
   - Emit `<ALERT_BUNDLE>` for the inspected or updated alert so the user can review the failure history in the **Alert Inspector** tab.

### Goal B: *"I don't think my alert data is right"*
1. **Inspect the alert definition and runtime execution**:
   - Call `get_alert(alert_id=id)` and `alert_details(alert_ids=[id])`.
2. **Audit `field`, `applied_dashboard_filters`, and `comparison_type`**:
   - Check `field.name`, `field.title`, and `field.filter` (tile-level filter snapshot) alongside `applied_dashboard_filters` (`filter_title`, `field_name`, `filter_value`, `filter_description`).
   - Verify whether `comparison_type` (`EQUAL_TO`, `GREATER_THAN`, `LESS_THAN`, `INCREASES_BY`, `DECREASES_BY`, `CHANGES_BY`) and `threshold` match the user's expectation (e.g. comparing raw counts vs. percentages, or missing a date/region filter in `applied_dashboard_filters`).
3. **Update filters or thresholds safely**:
   - Fetch the current alert via `get_alert(alert_id=id)`, update `applied_dashboard_filters`, `comparison_type`, or `threshold`, and persist via `update_alert(alert_id=id, body=payload)`.
   - Emit `<ALERT_BUNDLE>` (including `dashboard_id` and `applied_dashboard_filters`) so the user can click **Preview Dashboard with Filters** in the **Alert Inspector** tab to verify the live dashboard tile with those exact filters applied.

### Goal C: *"I have too many alerts"*
1. **Inventory and rank noisy alerts**:
   - Call `search_alerts(disabled=False)` and batch-call `alert_details(alert_ids=[...])`.
   - Rank alerts by cron frequency (`cron`) and recent trigger volume in `alert_history_items`.
2. **Pick the least-destructive noise reduction action**:
   - **Unfollow someone else's alert**: If `followable=True` and the user is a follower rather than the owner, call `unfollow_alert(alert_id=id)`.
   - **Tune cron frequency or threshold**: Reduce check frequency (e.g. every 15 minutes `*/15 * * * *` -> daily at 9am `0 9 * * *`) or widen `threshold` via `get_alert` -> merge -> `update_alert`.
   - **Pause (`is_disabled: True`) or Delete**: Call `update_alert_field(alert_id=id, body={"is_disabled": True})` to pause, or `delete_alert(alert_id=id)` only when the user explicitly confirms permanent deletion.
   - **Clear unread notifications**: Call `alert_notifications()` and `read_alert_notification(notification_id=nid)` to mark backlog notifications read.

### Goal D: *"I'm not getting my alerts on mobile"*
1. **Inspect `destinations`, `cron`, `is_disabled`, and `alert_notifications`**:
   - Call `get_alert(alert_id=id)`, `alert_details(alert_ids=[id])`, and `alert_notifications()`.
2. **Check delivery prerequisites**:
   - Verify `is_disabled` is `False` and `cron` is actively running (check `alert_history_items` timestamps).
   - Inspect `destinations`: mobile push / Looker mobile app notifications and Action Hub / Slack / email deliveries require the appropriate `destination_type` (`EMAIL` or `ACTION_HUB_INTEGRATION`) and the user either owning or following (`follow_alert(alert_id=id)`) the alert.
3. **Update destinations and trigger an immediate test check**:
   - Update `destinations` via `get_alert` -> merge -> `update_alert` if needed, or subscribe via `follow_alert(alert_id=id)`.
   - Call `enqueue_alert(alert_id=id)` (`POST /alerts/{alert_id}/enqueue`) to queue an immediate evaluation and verify delivery.
   - Emit `<ALERT_BUNDLE>` so the user can see the updated destinations and execution history.

### Goal E: *Move an alert to a new dashboard tile or create a new alert*
- **Clone-and-retire pattern for moving alerts**: Looker alerts are bound to their target `dashboard_element_id` (or `lookml_dashboard_id` + `lookml_link_id`). To move an alert to a different dashboard tile:
  1. Call `get_alert(alert_id=old_id)` to read the full alert configuration (`comparison_type`, `cron`, `destinations`, `field`, `threshold`, `applied_dashboard_filters`, `custom_title`, `description`, `is_public`).
  2. Call `create_alert(body={...})` targeting the **new** `dashboard_element_id` first and verify the returned `new_alert["id"]` is non-empty.
  3. **Only after `create_alert` succeeds**, disable (`update_alert_field(alert_id=old_id, body={"is_disabled": True})`) or delete (`delete_alert(alert_id=old_id)`) the old alert. Never delete or disable the source alert before confirming `create_alert` succeeded.
  4. Emit `<ALERT_BUNDLE>` for the newly created alert.

---

## 2. Looker Alerts SDK Mechanics & Invariants (`lkr code-mode` `0.0.69+`)

### 2.1 `alert_details` Requires a Non-Empty `alert_ids` Array
`GET /alert_details` (`alert_details(alert_ids=[...])`) returns an enriched `AlertDetails[]` list (`id`, `title`, `dashboard_id`, `dashboard_name`, `lookml_dashboard_id`, `owner_display_name`, `cron`, `is_disabled`, `disabled_reason`, `is_public`, `followed`, `followable`, `threshold`, `error`, `alert_history_items`).
- **Never** call `alert_details(alert_ids=[])` with an empty list — Looker returns HTTP `400 Bad Request`.
- Always discover IDs first via `search_alerts(...)` and chunk `alert_ids` into batches of at most `50`:

```python
alerts = search_alerts(disabled=False) or []
alert_ids = [str(a["id"]) for a in alerts if a.get("id")]
details = []
for i in range(0, len(alert_ids), 50):
    batch = alert_ids[i:i + 50]
    if batch:
        details.extend(alert_details(alert_ids=batch) or [])
```

### 2.2 Read-Modify-Write Invariant for `PUT /alerts/{alert_id}` (`update_alert`)
Looker's `PUT /alerts/{alert_id}` (`update_alert`) is a **full replacement** endpoint and requires all 6 mandatory fields on `WriteAlert`:
- `comparison_type` (`EQUAL_TO`, `GREATER_THAN`, `LESS_THAN`, `INCREASES_BY`, `DECREASES_BY`, `CHANGES_BY`)
- `cron` (5-field Vixie cron string, e.g. `"0 9 * * *"`)
- `destinations` (`[{"destination_type": "EMAIL", "email_address": "..."}]`)
- `field` (`{"title": "...", "name": "view.field", "filter": [...]}`)
- `owner_id` (string)
- `threshold` (float)

Always use a read-modify-write helper when calling `update_alert`:

```python
def patch_alert_full(alert_id: str, updates: dict) -> dict:
    current = get_alert(alert_id=alert_id)
    payload = {
        "comparison_type": current["comparison_type"],
        "cron": current["cron"],
        "destinations": current.get("destinations") or [],
        "field": current["field"],
        "owner_id": str(current["owner_id"]),
        "threshold": current["threshold"],
        "applied_dashboard_filters": current.get("applied_dashboard_filters"),
        "custom_title": current.get("custom_title"),
        "custom_url_base": current.get("custom_url_base"),
        "custom_url_label": current.get("custom_url_label"),
        "custom_url_params": current.get("custom_url_params"),
        "dashboard_element_id": current.get("dashboard_element_id"),
        "description": current.get("description"),
        "is_disabled": current.get("is_disabled"),
        "disabled_reason": current.get("disabled_reason"),
        "is_public": current.get("is_public"),
        "investigative_content_id": current.get("investigative_content_id"),
        "investigative_content_type": current.get("investigative_content_type"),
        "lookml_dashboard_id": current.get("lookml_dashboard_id"),
        "lookml_link_id": current.get("lookml_link_id"),
        "time_series_condition_state": current.get("time_series_condition_state"),
    }
    payload.update(updates)
    return update_alert(alert_id=alert_id, body=payload)
```

For quick changes exclusively to `owner_id`, `is_disabled`, or `disabled_reason`, prefer `update_alert_field(alert_id=id, body={...})` (`PATCH /alerts/{alert_id}`).

### 2.3 RBAC Permissions & Safe Mode Boundaries
- **Read-only (`GET` — auto-runs in Safe Mode)**: `search_alerts`, `alert_details`, `get_alert`, `alert_notifications`.
- **Mutations (`POST` / `PUT` / `PATCH` / `DELETE` — gated by Safe Mode confirmation)**: `create_alert`, `update_alert`, `update_alert_field`, `delete_alert`, `enqueue_alert`, `follow_alert`, `unfollow_alert`, `read_alert_notification`.
- **Looker RBAC permissions**:
  - `create_alerts`: Required to create, edit, or inspect your own alerts.
  - `follow_alerts`: Required to follow/unfollow public alerts (`follow_alert` / `unfollow_alert`).
  - `manage_alerts`: Admin-level permission required to search across `all_owners=True`, reassign `owner_id`, or modify alerts owned by other users. If a user receives `403` or `404` on an alert endpoint, check whether they lack `create_alerts` / `follow_alerts` / `manage_alerts` or are attempting to modify another user's private alert.

---

## 3. Right-Pane `<ALERT_BUNDLE>` Contract

- **List-only triage / summary questions** (e.g. *"list my failing alerts"*, *"how many alerts do I have?"*): Answer directly in chat with a concise markdown summary table and do **not** emit `<ALERT_BUNDLE>`.
- **Creating, editing, or inspecting a specific alert**: Whenever you create an alert (`create_alert`), edit an alert (`update_alert` / `update_alert_field`), or inspect a specific alert in depth (`get_alert` + `alert_details`), emit `<ALERT_BUNDLE>{...}</ALERT_BUNDLE>` at the end of your response so **Ripper** opens the persistent **Alert Inspector** tab (with the **Preview Dashboard with Filters** flyover/drill view):

```xml
<ALERT_BUNDLE>{
  "id": "104",
  "alert_id": "104",
  "title": "Daily Gross Margin Drop",
  "custom_title": "Daily Gross Margin Drop",
  "description": "Triggers when gross margin falls below 42%",
  "dashboard_id": "42",
  "dashboard_name": "Executive Pulse",
  "dashboard_element_id": "318",
  "owner_id": "7",
  "owner_display_name": "Bryan Weber",
  "cron": "0 9 * * *",
  "comparison_type": "LESS_THAN",
  "threshold": 0.42,
  "field": {
    "title": "Gross Margin %",
    "name": "order_items.gross_margin_pct",
    "filter": []
  },
  "applied_dashboard_filters": [
    {
      "filter_title": "Region",
      "field_name": "users.region",
      "filter_value": "North America",
      "filter_description": "is North America"
    }
  ],
  "destinations": [
    {
      "destination_type": "EMAIL",
      "email_address": "bryan@example.com"
    }
  ],
  "is_disabled": false,
  "disabled_reason": null,
  "is_public": true,
  "followed": true,
  "followable": true,
  "error": null,
  "alert_history_items": [
    {
      "Check_start_time": "2026-11-12T09:00:00Z",
      "alert_condition_met": false,
      "outcome": "succeeded",
      "message": null
    }
  ]
}</ALERT_BUNDLE>
```

Keep `alert_history_items` capped at the 10 most recent entries so Looker Artifacts remain lightweight.
