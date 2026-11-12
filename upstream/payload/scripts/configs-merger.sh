#!/usr/bin/env bash
# Merge legacy looker-config.json and skills/data-app-creator/config.json
# into a single consolidated data-apps-config.json, reconcile URLs,
# and delete the old files.
# Lightweight shim delegating to configs-merger.py.
set -euo pipefail

CANONICAL_TOOLKIT_URL="https://dl.google.com/looker-data-apps"

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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PY="$SCRIPT_DIR/configs-merger.py"
if [ ! -f "$SCRIPT_PY" ]; then
  for cand in \
    "${DATA_APPS_SOURCE_ROOT:-}/dist/scripts/configs-merger.py" \
    "$PWD/dist/scripts/configs-merger.py" \
    "$(dirname "$SCRIPT_DIR")/dist/scripts/configs-merger.py"; do
    if [ -n "$cand" ] && [ -f "$cand" ]; then
      SCRIPT_PY="$cand"
      break
    fi
  done
fi

exec "$PYTHON_BIN" "$SCRIPT_PY" "$@"
