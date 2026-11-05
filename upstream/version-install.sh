#!/usr/bin/env bash
# Looker Data Apps -- the versioned installer.
#
# Hosted at:
#   https://dl.google.com/looker-data-apps/versions/<VERSION>/install.sh
#
# Thin wrapper that delegates to install.py.

set -euo pipefail

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''
  BOLD=''
  NC=''
fi

VERSION="1.3.0"
PAYLOAD_BASE="https://dl.google.com/looker-data-apps/versions/1.3.0"
SHARED_BASE="https://dl.google.com/looker-data-apps"
export DATA_APPS_BROWSER_ASSETS_URL="${DATA_APPS_BROWSER_ASSETS_URL:-https://www.gstatic.com/looker-data-apps}"

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
  printf "%b" "${RED}${BOLD}error: Python 3.9+ is required (python3 is missing or older than 3.9).${NC}\n" >&2
  printf "%b" "${RED}Please install Python 3.9 or newer before running this installer.${NC}\n" >&2
  exit 1
fi
export DATA_APPS_PYTHON="$PYTHON_BIN"

export DATA_APPS_INSTALLER_VERSION="$VERSION"
export DATA_APPS_PAYLOAD_BASE="$PAYLOAD_BASE"

export DATA_APPS_SHARED_BASE="${DATA_APPS_SHARED_BASE:-$SHARED_BASE}"

DATA_APPS_BASE_URL="${DATA_APPS_BASE_URL:-$PAYLOAD_BASE}"
DATA_APPS_BASE_URL="${DATA_APPS_BASE_URL%/}"

INSTALL_PY=""
CLEANUP_TMP=""
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install.py" ] && [ -f "$SCRIPT_DIR/scripts/publish.sh" ]; then
  INSTALL_PY="$SCRIPT_DIR/install.py"
else
  CLEANUP_TMP="$(mktemp -d -t looker-data-apps-install-py.XXXXXX)"
  trap 'rm -rf "${CLEANUP_TMP:-}"' EXIT
  INSTALL_PY="$CLEANUP_TMP/install.py"
  if [[ "$DATA_APPS_BASE_URL" == file://* ]]; then
    cp "${DATA_APPS_BASE_URL#file://}/install.py" "$INSTALL_PY"
  elif [ -f "${DATA_APPS_BASE_URL}/install.py" ]; then
    cp "${DATA_APPS_BASE_URL}/install.py" "$INSTALL_PY"
  else
    if ! curl -fsSL "${DATA_APPS_BASE_URL}/install.py" -o "$INSTALL_PY"; then
      echo "error: failed to download install.py from ${DATA_APPS_BASE_URL}/install.py" >&2
      exit 1
    fi
  fi
fi

if [ -z "${BASH_SOURCE[0]:-}" ] && [ ! -t 0 ] && ( : </dev/tty ) 2>/dev/null && [ -z "${DATA_APPS_NON_INTERACTIVE:-}" ]; then
  "$PYTHON_BIN" "$INSTALL_PY" "$@" </dev/tty
else
  "$PYTHON_BIN" "$INSTALL_PY" "$@"
fi
