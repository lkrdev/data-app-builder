---
name: studio-conversation-debugger
description: >
  Internal developer skill for inspecting Looker Data App Studio conversation state (`user_conversations:${me.id}`,
  `user_env:${me.id}`, `contentItems`, `hidden` tabs, and `obj_*` Looker Artifacts byte sizes) on a live Looker
  instance via `lkr --oauth-account=<account> code-mode sandbox`.
---

# Studio Conversation & Artifacts Debugger (`studio-conversation-debugger`)

Use this **repository-internal** skill (never bundled into `SANDBOX_AGENT_SKILL_FILES` or customer sandboxes) when debugging a live Studio conversation (`conv_<id>`), verifying `contentItems` / `hidden` tab persistence, or auditing `user_conversations:${me.id}` and `obj_*` Looker Artifacts payload sizes.

## 1. Mandatory `--oauth-account` Selection Rule (Zero Hardcoded Accounts)

1. **Never assume or hardcode an `--oauth-account` name.**
2. If the user did not explicitly specify which `--oauth-account=<account>` to target in their prompt:
   - Run `lkr auth list` first to see configured OAuth accounts on the machine (if any).
   - **Stop and ask the user** which `--oauth-account=<account>` to use before running `lkr --oauth-account=<account> code-mode sandbox`.

## 2. Running `scripts/inspect_conversation.py`

Once the user provides `<account>`, run `scripts/inspect_conversation.py` inside `lkr --oauth-account=<account> code-mode sandbox`:

```bash
# List all conversations for the authenticated Looker user (with byte sizes, tab counts, and bloat audit):
lkr --oauth-account="<account>" code-mode sandbox \
  --file=.agents/skills/studio-conversation-debugger/scripts/inspect_conversation.py

# Inspect a specific immutable conversation (`conv_<id>`) and its linked `obj_*` artifacts:
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

- **Identity & Sandbox Container**: Resolves `me("id,display_name,email")` (or uses `--var user_id`) and reads `user_env:<uid>` (`environmentId`).
- **Lightweight `user_conversations:<uid>` Check**: Reports total serialized byte size, conversation count, immutable `conv_` ID compliance, visible vs. `hidden` `contentItems` tabs, `activeContentTabKey`, `interactionId`, and flags any forbidden bloat keys (`activitySteps`, `images`, `contentItems[].rawCode`).
- **Linked `obj_*` Artifact Hygiene**: When `conversation_id` is provided, fetches referenced `obj_lookml_*`, `obj_app_*`, `obj_dashboard_*`, `obj_script_*`, `obj_health_check_*`, and `obj_ca_*` keys and verifies that duplicate `studio.messages` arrays are absent.
