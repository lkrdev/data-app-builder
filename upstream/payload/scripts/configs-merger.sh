#!/usr/bin/env bash
# Merge legacy looker-config.json and skills/data-app-creator/config.json
# into a single consolidated data-apps-config.json, reconcile URLs,
# and delete the old files.
set -euo pipefail

if [ -z "${1:-}" ]; then
  # In the data-apps developer repository, resolve to repository root so configs are never merged into dist/.
  # Mirrors the developer-checkout detection in bootstrap.sh and serve.py.
  if [ "$(basename "$(cd "$(dirname "$0")/.." && pwd)")" = "dist" ] && { [ -f "$(dirname "$0")/../../scripts/publish.sh" ] || [ -d "$(dirname "$0")/../../.git" ]; }; then
    REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  else
    REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  fi
else
  REPO_ROOT="$(cd "$1" && pwd)"
fi

CANONICAL_TOOLKIT_URL="https://dl.google.com/looker-data-apps"
CANONICAL_BROWSER_ASSETS="https://www.gstatic.com/looker-data-apps"
TOOLKIT_URL="${DATA_APPS_TOOLKIT_URL:-${DATA_APPS_SHARED_BASE:-$CANONICAL_TOOLKIT_URL}}"
TOOLKIT_URL="${TOOLKIT_URL%/}"
BROWSER_ASSETS_URL="${DATA_APPS_BROWSER_ASSETS_URL:-${DATA_APPS_RUNTIME_URL:-$CANONICAL_BROWSER_ASSETS}}"
BROWSER_ASSETS_URL="${BROWSER_ASSETS_URL%/}"
PREVIOUS_VERSION="${DATA_APPS_PREVIOUS_VERSION:-}"

LOOKER_CONFIG="$REPO_ROOT/looker-config.json"
SKILL_CONFIG="$REPO_ROOT/skills/data-app-creator/config.json"
NEW_CONFIG="$REPO_ROOT/data-apps-config.json"

if [ ! -f "$LOOKER_CONFIG" ] && [ ! -f "$SKILL_CONFIG" ] && [ ! -f "$NEW_CONFIG" ]; then
  exit 0
fi

resolve_python() {
  local candidate py_exec
  for candidate in "${DATA_APPS_PYTHON:-}" "${PYTHON:-}" python3 python "py -3"; do
    [ -n "$candidate" ] || continue
    if [ "$candidate" = "py -3" ]; then
      if command -v py >/dev/null 2>&1; then
        py_exec="$(py -3 -c "import sys; print(sys.executable.replace('\\\\', '/')) if sys.version_info >= (3, 9) else sys.exit(1)" 2>/dev/null | tr -d '\r')" || true
        if [ -n "$py_exec" ] && "$py_exec" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
          printf '%s\n' "$py_exec"
          return 0
        fi
      fi
    elif "$candidate" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(resolve_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "error: Python 3.9+ is required (python3 is missing or older than 3.9)." >&2
  exit 1
fi

"$PYTHON_BIN" - "$REPO_ROOT" "$TOOLKIT_URL" "$BROWSER_ASSETS_URL" "$PREVIOUS_VERSION" "$CANONICAL_TOOLKIT_URL" "$CANONICAL_BROWSER_ASSETS" <<'PY'
import json, os, re, sys, urllib.parse

root, toolkit_url, browser_assets, previous_version, canonical_toolkit, canonical_browser = sys.argv[1:7]
new_path = os.path.join(root, "data-apps-config.json")
looker_path = os.path.join(root, "looker-config.json")
skill_path = os.path.join(root, "skills", "data-app-creator", "config.json")
had_looker = os.path.isfile(looker_path)
had_skill = os.path.isfile(skill_path)
legacy_merged = had_looker or had_skill

merged = {}
if had_looker:
    try:
        with open(looker_path, "r", encoding="utf-8") as f:
            l_cfg = json.load(f)
            if isinstance(l_cfg, dict):
                merged.update(l_cfg)
    except Exception:
        pass

if had_skill:
    try:
        with open(skill_path, "r", encoding="utf-8") as f:
            s_cfg = json.load(f)
            if isinstance(s_cfg, dict):
                for k, v in s_cfg.items():
                    if k == "looker_instance_url":
                        merged["base_url"] = v
                    else:
                        merged[k] = v
    except Exception:
        pass

if "looker_instance_url" in merged:
    if "base_url" not in merged:
        merged["base_url"] = merged["looker_instance_url"]
    del merged["looker_instance_url"]

if os.path.isfile(new_path):
    try:
        with open(new_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
            if isinstance(existing, dict):
                merged.update(existing)
    except Exception:
        pass

if not merged:
    if legacy_merged:
        print("Warning: No valid configuration found in legacy files; skipping merge to protect existing files.", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)

changed = []

RETIRED = re.compile(
    r"^https://storage\.googleapis\.com/canvas-dashboards-(?:lit|shared)/apps(?:/.*)?$"
)
OUR_BUCKET = re.compile(
    r"^https://storage\.googleapis\.com/canvas-dashboards-(?:lit|shared)/"
)

if merged.pop("shared_assets_url", None) is not None:
    changed.append(("shared_assets_url", None, None))

# Migrate legacy keys to modern keys first
if "shared_base_url" in merged:
    merged["toolkit_url"] = merged.pop("shared_base_url")
    changed.append(("migrated shared_base_url to toolkit_url", None, merged["toolkit_url"]))
if "shared_runtime_url" in merged:
    merged["browser_assets_url"] = merged.pop("shared_runtime_url")
    changed.append(("migrated shared_runtime_url to browser_assets_url", None, merged["browser_assets_url"]))

# Reconcile toolkit_url
if "toolkit_url" in merged:
    old = merged["toolkit_url"]
    if isinstance(old, str):
        if toolkit_url == canonical_toolkit:
            if old == canonical_toolkit or bool(OUR_BUCKET.match(old)) or bool(RETIRED.match(old)):
                merged.pop("toolkit_url", None)
                changed.append(("toolkit_url", old, None))
        else:
            if bool(OUR_BUCKET.match(old)) or bool(RETIRED.match(old)):
                merged["toolkit_url"] = toolkit_url
                changed.append(("toolkit_url", old, toolkit_url))

# Reconcile browser_assets_url
superseded = {f"{canonical_toolkit}/versions/{previous_version}", f"{canonical_browser}/versions/{previous_version}"} if previous_version else set()
if "browser_assets_url" in merged:
    old = merged["browser_assets_url"]
    if isinstance(old, str):
        is_retired = bool(RETIRED.match(old))
        is_canonical = (old == canonical_browser)
        is_previous = (old.rstrip("/") in superseded)
        if is_retired or is_canonical or is_previous or (bool(OUR_BUCKET.match(old)) and is_previous):
            merged.pop("browser_assets_url", None)
            changed.append(("browser_assets_url", old, None))
        elif browser_assets != canonical_browser:
            # Custom browser assets provided
            if bool(OUR_BUCKET.match(old)) or is_retired:
                merged["browser_assets_url"] = browser_assets
                changed.append(("browser_assets_url", old, browser_assets))

base_url = merged.get("base_url") or ""
target_url = merged.get("target_url")
host = urllib.parse.urlparse(base_url).hostname or "" if isinstance(base_url, str) else ""
is_loopback = host in ("127.0.0.1", "localhost", "::1")
if base_url and (target_url == base_url or not is_loopback):
    val = merged.pop("target_url", None)
    if val is not None:
        changed.append(("target_url", val, None))
if merged.pop("use_proxy", None) is not None:
    changed.append(("use_proxy", None, None))
if merged.pop("proxy_port", None) is not None:
    changed.append(("proxy_port", None, None))

if legacy_merged or changed:
    tmp_path = new_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(merged, indent=2) + "\n")
    try:
        os.chmod(tmp_path, 0o600)
    except Exception:
        pass
    os.replace(tmp_path, new_path)
else:
    if os.path.isfile(new_path):
        try:
            os.chmod(new_path, 0o600)
        except Exception:
            pass

for old in [looker_path, skill_path]:
    if os.path.isfile(old):
        try:
            os.remove(old)
        except Exception:
            pass

if legacy_merged:
    print("Merged legacy configuration files into data-apps-config.json and removed old files.")
if changed:
    for key, old, new in changed:
        if new is None:
            if key == "shared_assets_url":
                print(f"  dropped retired setting {key}")
            else:
                print(f"  dropped redundant setting {key}")
        elif old is None:
            print(f"  {key}: {new}")
        else:
            print(f"  {key} advanced")
            print(f"    was: {old}")
            print(f"    now: {new}")
PY
