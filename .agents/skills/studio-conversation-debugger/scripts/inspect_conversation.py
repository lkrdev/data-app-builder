# ruff: noqa: F821, BLE001
"""Audit Studio Pointers-Only Looker Artifacts (3-key schema, byte budgets, and legacy keys) via lkr code-mode sandbox."""

import json

FORBIDDEN_KEYS = {
    "messages",
    "text",
    "activitySteps",
    "images",
    "rawCode",
    "prod_code",
    "raw_code",
    "code",
    "files",
    "tddMarkdown",
    "telemetry",
    "elements",
    "alert_history_items",
    "queryCache",
    "filterCache",
}

ALLOWED_ENV_FIELDS = {"environmentId", "sourcesHash", "updatedAt"}
ALLOWED_CONFIG_FIELDS = {
    "userId",
    "agentName",
    "themeMode",
    "requirePermission",
    "busySendAction",
    "maxToolRounds",
    "selectedFolderId",
    "updatedAt",
}
ALLOWED_CONV_FIELDS = {
    "id",
    "objectId",
    "type",
    "label",
    "tags",
    "archived",
    "environmentId",
    "interactionId",
    "inFlight",
    "turnInteractionIds",
    "caConversationId",
    "explores",
    "activeContentTabKey",
    "content",
    "contentItems",
    "createdAt",
    "updatedAt",
}


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


def _utf8_bytes(raw_or_obj) -> int:
    if isinstance(raw_or_obj, str):
        return len(raw_or_obj.encode("utf-8"))
    return len(json.dumps(raw_or_obj).encode("utf-8"))


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


def _search_prefix(ns: str, pattern: str) -> list[str]:
    try:
        rows = search_artifacts(namespace=ns, key=pattern)  # ty: ignore[unresolved-reference]
    except Exception:
        return []
    if not isinstance(rows, list):
        return []
    return sorted({str(r.get("key") or "") for r in rows if isinstance(r, dict) and r.get("key")})


def _find_forbidden_paths(value, prefix: str = "") -> list[str]:
    hits: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            path = f"{prefix}.{k}" if prefix else str(k)
            if str(k) in FORBIDDEN_KEYS:
                hits.append(path)
            hits.extend(_find_forbidden_paths(v, path))
    elif isinstance(value, list):
        for idx, item in enumerate(value):
            hits.extend(_find_forbidden_paths(item, f"{prefix}[{idx}]"))
    return hits


def _audit_conversation(conv: dict, active_env_id: str) -> dict:
    cid = str(conv.get("id") or "")
    items = conv.get("contentItems") if isinstance(conv.get("contentItems"), list) else []
    turn_pairs = conv.get("turnInteractionIds") if isinstance(conv.get("turnInteractionIds"), list) else []
    tags = conv.get("tags") if isinstance(conv.get("tags"), list) else []
    entry_bytes = _utf8_bytes(conv)
    unknown_fields = sorted(set(conv.keys()) - ALLOWED_CONV_FIELDS)
    forbidden_paths = _find_forbidden_paths(conv)
    violations: list[str] = []
    if entry_bytes > 4096:
        violations.append(f"entry_bytes>{4096} ({entry_bytes})")
    if unknown_fields:
        violations.append(f"unknown_fields:{','.join(unknown_fields)}")
    if forbidden_paths:
        violations.extend(f"forbidden:{p}" for p in forbidden_paths)
    conv_env = str(conv.get("environmentId") or "")
    env_mismatch = bool(active_env_id and conv_env and conv_env != active_env_id)
    return {
        "id": cid,
        "immutable_conv_prefix": cid.startswith("conv_"),
        "byte_size": entry_bytes,
        "type": conv.get("type"),
        "label": conv.get("label"),
        "tags": tags,
        "archived": bool(conv.get("archived", False)),
        "inFlight": bool(conv.get("inFlight", False)),
        "interactionId": conv.get("interactionId"),
        "turn_pair_count": len(turn_pairs),
        "environmentId": conv_env or None,
        "environment_mismatch": env_mismatch,
        "activeContentTabKey": conv.get("activeContentTabKey"),
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
        "violations": violations,
    }


def _collect_legacy_object_keys(conv: dict) -> list[str]:
    keys: list[str] = []
    content = conv.get("content") if isinstance(conv.get("content"), dict) else {}
    pairs = [
        ("lookml", content.get("sessionId") or content.get("projectId")),
        ("app", content.get("dashboardId") if conv.get("type") in ("app", "data_app", "data-investigator") else None),
        ("dashboard", content.get("dashboardId") if conv.get("type") == "dashboard" else None),
        ("script", content.get("scriptId")),
        ("alert", content.get("alertId")),
        ("health_check", content.get("reportId")),
        ("conversational-analytics", content.get("caConversationId")),
    ]
    for prefix, target_id in pairs:
        if target_id:
            k = f"obj_{prefix}_{target_id}"
            if k not in keys:
                keys.append(k)
    if content.get("elementId"):
        keys.append(f"tile_element_{content.get('elementId')}")
    return keys


def main():
    ns = _g(lambda: namespace, "data_app_builder::data_app_builder")  # ty: ignore[unresolved-reference]
    target_conv_id = _g(lambda: conversation_id, "")  # ty: ignore[unresolved-reference]
    explicit_uid = _g(lambda: user_id, "")  # ty: ignore[unresolved-reference]

    me_info = me("id,display_name,email") if not explicit_uid else {"id": explicit_uid}  # ty: ignore[unresolved-reference]
    uid = explicit_uid or str((me_info or {}).get("id") or "1")

    env_key = f"user_env:{uid}"
    cfg_key = f"user_config:{uid}"
    conv_key = f"user_conversations:{uid}"
    env_row = _get_artifact_row(ns, env_key)
    cfg_row = _get_artifact_row(ns, cfg_key)
    conv_row = _get_artifact_row(ns, conv_key)

    env_raw = env_row.get("value", "") if isinstance(env_row, dict) else ""
    env_val = _parse_json(env_raw) if env_raw else None
    env_bytes = _utf8_bytes(env_raw) if env_row else 0
    active_env_id = str(env_val.get("environmentId") or "") if isinstance(env_val, dict) else ""

    cfg_raw = cfg_row.get("value", "") if isinstance(cfg_row, dict) else ""
    cfg_val = _parse_json(cfg_raw) if cfg_raw else None
    cfg_bytes = _utf8_bytes(cfg_raw) if cfg_row else 0

    raw_conv_str = conv_row.get("value", "") if isinstance(conv_row, dict) else ""
    conv_bytes = _utf8_bytes(raw_conv_str) if conv_row else 0
    parsed_convs = _parse_json(raw_conv_str) if raw_conv_str else []
    if isinstance(parsed_convs, dict):
        parsed_convs = parsed_convs.get("conversations") or []
    conv_list = [c for c in (parsed_convs if isinstance(parsed_convs, list) else []) if isinstance(c, dict)]

    legacy_keys = sorted(
        set(_search_prefix(ns, "obj_%"))
        | set(_search_prefix(ns, "tile_element_%"))
        | set(_search_prefix(ns, f"user_{uid}_%"))
    )

    summaries = [_audit_conversation(c, active_env_id) for c in conv_list]
    schema_violations: list[str] = []
    if env_bytes > 512:
        schema_violations.append(f"{env_key}:byte_size>{512} ({env_bytes})")
    if isinstance(env_val, dict) and (set(env_val.keys()) - ALLOWED_ENV_FIELDS):
        schema_violations.append(f"{env_key}:unknown_fields")
    if cfg_bytes > 1024:
        schema_violations.append(f"{cfg_key}:byte_size>{1024} ({cfg_bytes})")
    if isinstance(cfg_val, dict) and (set(cfg_val.keys()) - ALLOWED_CONFIG_FIELDS):
        schema_violations.append(f"{cfg_key}:unknown_fields")
    if conv_bytes > 65536:
        schema_violations.append(f"{conv_key}:byte_size>{65536} ({conv_bytes})")
    for s in summaries:
        for v in s["violations"]:
            schema_violations.append(f"{s['id']}:{v}")

    result = {
        "namespace": ns,
        "user": {
            "id": uid,
            "display_name": (me_info or {}).get("display_name"),
            "email": (me_info or {}).get("email"),
        },
        "environment_artifact": {"key": env_key, "byte_size": env_bytes, "max_bytes": 512, "value": env_val},
        "config_artifact": {"key": cfg_key, "byte_size": cfg_bytes, "max_bytes": 1024, "value": cfg_val},
        "conversations_artifact": {
            "key": conv_key,
            "version": conv_row.get("version") if isinstance(conv_row, dict) else None,
            "byte_size": conv_bytes,
            "max_bytes": 65536,
            "count": len(conv_list),
        },
        "pointers_only_ok": len(schema_violations) == 0 and len(legacy_keys) == 0,
        "schema_violations": schema_violations,
        "legacy_non_pointer_keys": legacy_keys,
        "conversations": summaries,
    }

    if target_conv_id:
        matched = ([c for c in conv_list if str(c.get("id") or "") == target_conv_id] or [None])[0]
        legacy_checks = []
        if matched:
            for obj_key in _collect_legacy_object_keys(matched):
                row = _get_artifact_row(ns, obj_key)
                legacy_checks.append({"key": obj_key, "exists": bool(row)})
        result["target_conversation"] = _audit_conversation(matched, active_env_id) if matched else None
        result["legacy_object_artifacts"] = legacy_checks

    return result


main()
