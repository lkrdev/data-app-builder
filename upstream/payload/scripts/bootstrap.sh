#!/usr/bin/env bash
# Data Apps customer onboarding -- second-stage installer.
# Lightweight shim delegating to bootstrap.py.
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
  printf "error: Python 3.9+ is required (python3 is missing or older than 3.9).\n" >&2
  printf "Please install Python 3.9 or newer before running bootstrap.\n" >&2
  exit 1
fi
export DATA_APPS_PYTHON="$PYTHON_BIN"

CALLER_PWD="$(pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$PARENT_DIR"

if [ "$(basename "$PARENT_DIR")" = "dist" ] && { [ -f "$SCRIPT_DIR/../../scripts/publish.sh" ] || [ -d "$SCRIPT_DIR/../../.git" ]; }; then
  # Running from dist/ inside the data-apps developer repository
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  # Customer installation: search upwards for config files, stopping at install root
  CUR="$SCRIPT_DIR"
  while [ "$CUR" != "/" ]; do
    if [ -f "$CUR/data-apps-config.json" ] || [ -f "$CUR/looker-config.json" ]; then
      REPO_ROOT="$CUR"
      break
    fi
    CUR="$(cd "$CUR/.." && pwd)"
  done
fi
cd "$REPO_ROOT"

if [ "$#" -ge 1 ] && [[ "$1" != /* ]] && [[ "$1" != -* ]] && [[ "$1" != ~* ]] && ! [[ "$1" =~ ^[A-Za-z]:[/\\].* ]]; then
  set -- "$CALLER_PWD/$1" "${@:2}"
fi

SCRIPT_PY="$SCRIPT_DIR/bootstrap.py"
if [ ! -f "$SCRIPT_PY" ]; then
  for cand in \
    "${DATA_APPS_SOURCE_ROOT:-}/dist/scripts/bootstrap.py" \
    "$PWD/dist/scripts/bootstrap.py" \
    "$REPO_ROOT/dist/scripts/bootstrap.py" \
    "$REPO_ROOT/scripts/bootstrap.py"; do
    if [ -n "$cand" ] && [ -f "$cand" ]; then
      SCRIPT_PY="$cand"
      break
    fi
  done
fi

exec "$PYTHON_BIN" "$SCRIPT_PY" "$@"
