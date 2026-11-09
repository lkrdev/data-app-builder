# ruff: noqa: F821, BLE001
"""Inspect Studio conversations and Looker Artifacts hygiene via lkr --oauth-account=<account> code-mode sandbox."""

import json


def _g(fn, default=""):
    try:
        val = fn()
        return default if val is None else str(val).strip()
    except NameError:
        return default


def _parse_json(raw):
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return raw
    return raw


def _get_artifact_row(ns: str, key: str):
    try:
        rows = artifact(namespace=ns, key=key)  # ty: ignore[unresolved-reference]
    except Exception:
        return None
    if isinstance(rows, list):
        for r in rows:
            if isinstance(r, dict) and str(r.get("key") or "") == key:
                return r
        return rows[0] if rows else None
    return rows if isinstance(rows, dict) else None


def _audit_conversation(conv: dict) -> dict:
    cid = str(conv.get("id") or "")
    msgs = conv.get("messages") if isinstance(conv.get("messages"), list) else []
    items = conv.get("contentItems") if isinstance(conv.get("contentItems"), list) else []
    bloat_flags = []
    if any(isinstance(m, dict) and m.get("activitySteps") for m in msgs):
        bloat_flags.append("messages[].activitySteps")
    if any(isinstance(m, dict) and m.get("images") for m in msgs):
        bloat_flags.append("messages[].images")
    if any(isinstance(it, dict) and it.get("rawCode") for it in items):
        bloat_flags.append("contentItems[].rawCode")
    return {
        "id": cid,
        "immutable_conv_prefix": cid.startswith("conv_"),
        "type": conv.get("type"),
        "use_case": conv.get("use_case"),
        "label": conv.get("label"),
        "archived": bool(conv.get("archived", False)),
        "interactionId": conv.get("interactionId"),
        "environmentId": conv.get("environmentId"),
        "activeContentTabKey": conv.get("activeContentTabKey"),
        "message_count": len(msgs),
        "visible_tabs": [
            {"key": it.get("key"), "contentType": it.get("contentType"), "id": it.get("id"), "title": it.get("title")}
            for it in items
            if isinstance(it, dict) and not it.get("hidden")
        ],
        "hidden_tabs": [
            {"key": it.get("key"), "contentType": it.get("contentType"), "id": it.get("id"), "title": it.get("title")}
            for it in items
            if isinstance(it, dict) and it.get("hidden")
        ],
        "updatedAt": conv.get("updatedAt"),
        "bloat_flags": bloat_flags,
    }


def _collect_object_keys(conv: dict) -> list[str]:
    keys: list[str] = []
    content = conv.get("content") if isinstance(conv.get("content"), dict) else {}
    pairs = [
        ("lookml", content.get("sessionId")),
        ("app", content.get("dashboardId") if conv.get("type") in ("app", "data_app", "data-investigator") else None),
        ("dashboard", content.get("dashboardId") if conv.get("type") == "dashboard" else None),
        ("script", content.get("scriptId")),
        ("health_check", content.get("reportId")),
        ("conversational-analytics", content.get("caConversationId")),
    ]
    for prefix, target_id in pairs:
        if target_id:
            k = f"obj_{prefix}_{target_id}"
            if k not in keys:
                keys.append(k)
    for it in conv.get("contentItems") or []:
        if not isinstance(it, dict) or not it.get("id"):
            continue
        ct = str(it.get("contentType") or "")
        iid = str(it.get("id"))
        mapping = {
            "lookml": f"obj_lookml_{iid}",
            "data_app": f"obj_app_{iid}",
            "data-investigator": f"obj_app_{iid}",
            "dashboard": f"obj_dashboard_{iid}",
            "lookml_dashboard": f"obj_dashboard_{iid}",
            "look": f"obj_dashboard_{iid}",
            "board": f"obj_dashboard_{iid}",
            "script": f"obj_script_{iid}",
            "report": f"obj_health_check_{iid}",
            "conversational-analytics": f"obj_conversational-analytics_{iid}",
        }
        k = mapping.get(ct, "")
        if k and k not in keys:
            keys.append(k)
    return keys


def main():
    ns = _g(lambda: namespace, "data_app_builder::data_app_builder")  # ty: ignore[unresolved-reference]
    target_conv_id = _g(lambda: conversation_id, "")  # ty: ignore[unresolved-reference]
    explicit_uid = _g(lambda: user_id, "")  # ty: ignore[unresolved-reference]

    me_info = me("id,display_name,email") if not explicit_uid else {"id": explicit_uid}  # ty: ignore[unresolved-reference]
    uid = explicit_uid or str((me_info or {}).get("id") or "1")

    conv_key = f"user_conversations:{uid}"
    env_key = f"user_env:{uid}"
    conv_row = _get_artifact_row(ns, conv_key)
    env_row = _get_artifact_row(ns, env_key)

    raw_conv_str = conv_row.get("value", "") if isinstance(conv_row, dict) else ""
    conv_bytes = (
        len(raw_conv_str.encode("utf-8"))
        if isinstance(raw_conv_str, str)
        else len(json.dumps(raw_conv_str or []))
    )
    parsed_convs = _parse_json(raw_conv_str) if raw_conv_str else []
    if isinstance(parsed_convs, dict):
        parsed_convs = parsed_convs.get("conversations") or []
    conv_list = [c for c in (parsed_convs if isinstance(parsed_convs, list) else []) if isinstance(c, dict)]
    env_val = _parse_json(env_row.get("value")) if isinstance(env_row, dict) else None

    summaries = [_audit_conversation(c) for c in conv_list]
    result = {
        "namespace": ns,
        "user": {
            "id": uid,
            "display_name": (me_info or {}).get("display_name"),
            "email": (me_info or {}).get("email"),
        },
        "environment_artifact": {"key": env_key, "value": env_val},
        "conversations_artifact": {
            "key": conv_key,
            "version": conv_row.get("version") if isinstance(conv_row, dict) else None,
            "byte_size": conv_bytes,
            "count": len(conv_list),
        },
        "conversations": summaries,
    }

    if target_conv_id:
        matched = next((c for c in conv_list if str(c.get("id") or "") == target_conv_id), None)
        linked_artifacts = []
        if matched:
            for obj_key in _collect_object_keys(matched):
                row = _get_artifact_row(ns, obj_key)
                if not row:
                    linked_artifacts.append({"key": obj_key, "exists": False})
                    continue
                raw_val = row.get("value", "")
                parsed_obj = _parse_json(raw_val)
                studio_obj = (
                    parsed_obj.get("studio")
                    if isinstance(parsed_obj, dict) and isinstance(parsed_obj.get("studio"), dict)
                    else {}
                )
                has_dup_msgs = bool(
                    (isinstance(parsed_obj, dict) and parsed_obj.get("messages"))
                    or (isinstance(studio_obj, dict) and studio_obj.get("messages"))
                )
                linked_artifacts.append(
                    {
                        "key": obj_key,
                        "exists": True,
                        "version": row.get("version"),
                        "byte_size": (
                            len(raw_val.encode("utf-8"))
                            if isinstance(raw_val, str)
                            else len(json.dumps(raw_val))
                        ),
                        "has_duplicate_messages": has_dup_msgs,
                    }
                )
        result["target_conversation"] = _audit_conversation(matched) if matched else None
        result["target_messages"] = matched.get("messages", []) if matched else []
        result["linked_object_artifacts"] = linked_artifacts

    return result


main()
