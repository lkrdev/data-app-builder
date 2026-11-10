#!/usr/bin/env bash
# Purges all Looker Artifact namespaces used by Data App Studio / Ripper via lkr code-mode.
# Usage: npm run clean:artifacts <oauth-account>
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "${1:-}" ] || [[ "${1}" == -* ]]; then
  echo "Error: expected a single <oauth-account> argument." >&2
  echo "Usage: npm run clean:artifacts <oauth-account>" >&2
  exit 1
fi

LKR=(lkr); command -v lkr >/dev/null 2>&1 || LKR=(uvx --from "lkr-dev-cli[code-mode]" lkr)

exec "${LKR[@]}" --oauth-account="$1" code-mode sandbox --var "account=$1" --code '
candidates = {}
try:
    for r in artifact_namespaces() or []:
        ns, cnt = str(r.get("namespace") or ""), int(r.get("count") or 0)
        if cnt > 0 and (ns in ("data_app_builder", "ripper") or ns.endswith("::data_app_builder") or ns.endswith("::ripper")):
            candidates[ns] = cnt
except Exception:
    pids = ["data_app_builder", "ripper"]
    try:
        pids = pids + [str(p["id"]) for p in (all_projects(fields="id") or []) if p.get("id")]
    except Exception:
        pass
    candidates = {ns: 0 for ns in ["data_app_builder", "ripper"] + [p + "::" + a for p in pids for a in ("data_app_builder", "ripper")]}

cleared = []
for ns, cnt in candidates.items():
    keys = []
    if cnt == 0:
        keys = [str(r["key"]) for r in (search_artifacts(namespace=ns, key="%") or []) if r.get("key")]
        cnt = len(keys)
    if cnt == 0:
        continue
    try:
        purge_artifacts(ns)
    except Exception:
        keys = keys or [str(r["key"]) for r in (search_artifacts(namespace=ns, key="%") or []) if r.get("key")]
        if not keys:
            continue
        delete_artifact(ns, ",".join(keys))
        cnt = len(keys)
    cleared.append({"namespace": ns, "deleted": cnt})

return {"account": account, "cleared_namespaces": cleared, "total_deleted": sum([c["deleted"] for c in cleared])}
'
