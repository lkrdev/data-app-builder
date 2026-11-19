---
name: studio-conversation-debugger
description: >
  Internal developer skill for inspecting Looker Data App Studio conversation pointers and auditing the closed
  3-key Pointers-Only Looker Artifacts schema (`user_env:${me.id}`, `user_config:${me.id}`, `user_conversations:${me.id}`)
  on a live Looker instance via `lkr --oauth-account=<account> code-mode sandbox`.
---

# Studio Conversation & Artifacts Debugger (`studio-conversation-debugger`)

Use this **repository-internal** skill (never bundled into `SANDBOX_AGENT_SKILL_FILES` or customer sandboxes) when debugging a live Studio conversation (`conv_<id>`), verifying `turnInteractionIds` / `contentItems` (`hidden`) pointer persistence, or auditing the closed 3-key Pointers-Only Looker Artifacts schema (`user_env:${me.id}`, `user_config:${me.id}`, `user_conversations:${me.id}`).

## 1. Mandatory `--oauth-account` Selection Rule (Zero Hardcoded Accounts)

1. **Never assume or hardcode an `--oauth-account` name.**
2. If the user did not explicitly specify which `--oauth-account=<account>` to target in their prompt:
   - Run `lkr auth list` first to see configured OAuth accounts on the machine (if any).
   - **Stop and ask the user** which `--oauth-account=<account>` to use before running `lkr --oauth-account=<account> code-mode sandbox`.

## 2. Running `scripts/inspect_conversation.py`

Once the user provides `<account>`, run `scripts/inspect_conversation.py` inside `lkr --oauth-account=<account> code-mode sandbox`:

```bash
# Audit all 3 per-user keys (`user_env:<uid>`, `user_config:<uid>`, `user_conversations:<uid>`) and scan for legacy artifacts:
lkr --oauth-account="<account>" code-mode sandbox \
  --file=.agents/skills/studio-conversation-debugger/scripts/inspect_conversation.py

# Inspect a specific immutable conversation (`conv_<id>`) and verify zero legacy `obj_*`/`tile_element_*` artifacts:
lkr --oauth-account="<account>" code-mode sandbox \
  --file=.agents/skills/studio-conversation-debugger/scripts/inspect_conversation.py \
  --var conversation_id="<conv_id>"

# Optional overrides for another Looker user ID or custom artifact namespace:
lkr --oauth-account="<account>" code-mode sandbox \
  --file=.agents/skills/studio-conversation-debugger/scripts/inspect_conversation.py \
  --var conversation_id="<conv_id>" \
  --var user_id="<looker_user_id>" \
  --var namespace="data_app_builder::data_app_builder"
```

## 3. What `inspect_conversation.py` Audits

- **Closed 3-Key Schema & Byte Budgets**: Resolves `me("id,display_name,email")` (or uses `--var user_id`) and audits `user_env:<uid>` (`<= 512 B`), `user_config:<uid>` (`<= 1,024 B`), and `user_conversations:<uid>` (`<= 65,536 B` total, `<= 4,096 B` per conversation pointer).
- **Recursive Forbidden-Field Check**: Flags any forbidden payload keys anywhere in stored values (`messages`, `text`, `activitySteps`, `images`, `rawCode`, `prod_code`, `raw_code`, `code`, `files`, `tddMarkdown`, `telemetry`, `elements`, `alert_history_items`, `queryCache`, `filterCache`) as well as unknown top-level conversation fields.
- **Legacy Non-Pointer Key Detection**: Scans for leftover legacy `obj_*`, `tile_element_*`, or `user_<uid>_*` keys in the namespace so retired non-pointer artifacts are surfaced immediately.
