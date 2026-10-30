#!/usr/bin/env bash
# In-place self-updater for Looker Data Apps toolkit.
#
# Protocol:
#   1. Snapshot current installation into backups/toolkit/<TIMESTAMP>_v<OLD_VERSION>/
#   2. Download the target version's install.sh
#   3. Execute installer non-interactively (DATA_APPS_SKIP_VERIFY=1, stdin from /dev/null)
#   4. Validate target VERSION; on failure, roll back from backup
#   5. Prune toolkit backups to KEEP_BACKUPS (default 3)
#
# Re-pinning the runtime URL is not done here. The installer bakes in the
# directory it was published from and bootstrap.sh reconciles the config
# against it, so the pin follows the payload rather than being recomputed by
# two scripts that can disagree.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# In the data-apps developer repository, resolve to repo root so tools are not run against dist/.
# In a customer install, this script lives at <root>/skills/toolkit-updater/tools/self-update.sh,
# so PARENT_DIR is the positional install root.
if [ "$(basename "$PARENT_DIR")" = "dist" ] && [ -d "$PARENT_DIR/skills" ] && { [ -f "$PARENT_DIR/../scripts/publish.sh" ] || [ -d "$PARENT_DIR/../.git" ]; }; then
  REPO_ROOT="$(cd "$PARENT_DIR/.." && pwd)"
elif [ "$(basename "$PARENT_DIR")" = ".claude" ]; then
  REPO_ROOT="$(cd "$PARENT_DIR/.." && pwd)"
else
  REPO_ROOT="$PARENT_DIR"
fi

TARGET_VERSION=""
INSTALL_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --target)
      TARGET_VERSION="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: self-update.sh [--root <install_dir>] [--target <version>]

Performs a safe, in-place upgrade of the Looker Data Apps toolkit with
pre-upgrade snapshot backup and automatic rollback on failure.

Options:
  --root <dir>        Target installation directory (default: parent directory of toolkit)
  --target <version>  Target version to upgrade to (default: resolved from .update-check.json or remote stable)
  --help, -h          Show this help message
USAGE
      exit 0
      ;;
    *)
      echo "error: unrecognized argument '$1'" >&2
      exit 1
      ;;
  esac
done

if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="$REPO_ROOT"
fi

if [ ! -d "$INSTALL_DIR" ]; then
  echo "error: installation directory '$INSTALL_DIR' does not exist." >&2
  exit 1
fi
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"

if [ "$INSTALL_DIR" = "/" ] || [ "$INSTALL_DIR" = "${HOME:-}" ]; then
  echo "error: refusing to update dangerous root '$INSTALL_DIR'" >&2
  exit 1
fi

if [ -f "$INSTALL_DIR/scripts/publish.sh" ] || [ -d "$INSTALL_DIR/dist/skills" ] || { [ -d "$INSTALL_DIR/.git" ] && [ -d "$INSTALL_DIR/tests" ]; }; then
  echo "error: refusing to update developer repository checkout '$INSTALL_DIR'" >&2
  echo "       Self-update is designed for customer installations, not the source repository." >&2
  exit 1
fi

if [ ! -f "$INSTALL_DIR/data-apps-config.json" ] && [ ! -f "$INSTALL_DIR/looker-config.json" ]; then
  echo "error: '$INSTALL_DIR' does not appear to be a Looker Data Apps installation (missing data-apps-config.json or looker-config.json)" >&2
  exit 1
fi

if [ ! -f "$INSTALL_DIR/VERSION" ] && [ ! -f "$INSTALL_DIR/dist/VERSION" ]; then
  echo "error: '$INSTALL_DIR' does not appear to be a versioned installation (missing VERSION file)" >&2
  exit 1
fi

LOCK_FILE="$INSTALL_DIR/.update.lock"
if ! (set -o noclobber; echo "$$" > "$LOCK_FILE") 2>/dev/null; then
  HOLDING_PID="$(cat "$LOCK_FILE" 2>/dev/null || echo "")"
  HOLDING_PID="$(printf '%s' "$HOLDING_PID" | tr -cd '0-9')"
  if [ -z "$HOLDING_PID" ] || { ! kill -0 "$HOLDING_PID" 2>/dev/null && ! ps -p "$HOLDING_PID" >/dev/null 2>&1 && ! (ps -W 2>/dev/null | awk '{print $1, $4}' | grep -qw "$HOLDING_PID"); }; then
    echo "removing stale lockfile from dead or empty pid ${HOLDING_PID:-empty}..." >&2
    rm -f "$LOCK_FILE"
    if ! (set -o noclobber; echo "$$" > "$LOCK_FILE") 2>/dev/null; then
      echo "error: failed to acquire update lock in ${INSTALL_DIR}" >&2
      exit 1
    fi
  else
    echo "error: another self-update is already running (pid ${HOLDING_PID:-unknown}) in ${INSTALL_DIR}" >&2
    exit 1
  fi
fi

INSTALL_RAN=0
cleanup() {
  if [ "${INSTALL_RAN:-0}" -ne 1 ] && [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf "$BACKUP_DIR"
  fi
  rm -f "${TMP_INSTALL:-}" "${LOCK_FILE:-}"
}
trap cleanup EXIT

short_path() {
  local p="$1"
  if [ -n "${HOME:-}" ] && { [ "$p" = "$HOME" ] || [ "${p#$HOME/}" != "$p" ]; }; then
    if [ "$p" = "$HOME" ]; then
      echo "~"
    else
      echo "~/${p#$HOME/}"
    fi
  else
    echo "$p"
  fi
}

OLD_VERSION="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || cat "$INSTALL_DIR/dist/VERSION" 2>/dev/null || echo "0.0.0")"
OLD_VERSION="$(printf '%s' "$OLD_VERSION" | tr -d '[:space:]')"
OLD_VERSION="${OLD_VERSION#v}"

CONFIG_PATH="$INSTALL_DIR/data-apps-config.json"
[ ! -f "$CONFIG_PATH" ] && [ -f "$INSTALL_DIR/looker-config.json" ] && CONFIG_PATH="$INSTALL_DIR/looker-config.json"

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
export DATA_APPS_PYTHON="$PYTHON_BIN"

# Upgrade within whichever prefix this install was made from, so a self-hosted
# bucket upgrades from its own copy rather than silently jumping to ours.
CANONICAL_SHARED_BASE="https://dl.google.com/looker-data-apps"
SHARED_BASE_URL="$( { "$PYTHON_BIN" - "$CONFIG_PATH" "$CANONICAL_SHARED_BASE" <<'PY'
import json, sys
cfg_path, fallback = sys.argv[1:3]
try:
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
print(str(cfg.get("toolkit_url") or cfg.get("shared_base_url") or fallback).rstrip("/"))
PY
} | tr -d '\r')"

# Resolve target version if not provided
if [ -z "$TARGET_VERSION" ]; then
  # Try reading from .update-check.json
  if [ -f "$INSTALL_DIR/.update-check.json" ]; then
    TARGET_VERSION="$("$PYTHON_BIN" -c "import json, sys; d = json.load(open(sys.argv[1], encoding='utf-8')); print(d.get('latest_version') or '')" "$INSTALL_DIR/.update-check.json" 2>/dev/null | tr -d '\r' || true)"
  fi
  # If still empty, read the release pointer
  if [ -z "$TARGET_VERSION" ]; then
    TARGET_VERSION="$(curl -fsSL "${SHARED_BASE_URL}/latest-version.txt" 2>/dev/null || true)"
    TARGET_VERSION="$(printf '%s' "$TARGET_VERSION" | tr -d '[:space:]')"
  fi
fi

# Normalize leading 'v' if present (e.g. v1.2.3 -> 1.2.3)
TARGET_VERSION="${TARGET_VERSION#v}"

if [ -z "$TARGET_VERSION" ]; then
  echo "error: could not determine target version to upgrade to." >&2
  exit 1
fi
echo "Updating Looker Data Apps toolkit:"
echo "  Location: $(short_path "$INSTALL_DIR")"
echo "  Current:  ${OLD_VERSION}"
echo "  Target:   ${TARGET_VERSION}"

# Refuse to move an installation backwards. A stale .update-check.json, a rolled-back
# release pointer, or a typo'd --target must not silently downgrade a customer, and
# there is no supported way to ask for one.
#
# Re-running the version that is already installed is allowed on purpose: it reinstalls
# the payload and re-runs bootstrap, which is how a customer repairs an installation
# that lost files. version_utils.py is the single implementation of this ordering,
# shared with check-for-update.py so the tool that offers an upgrade and the tool that
# performs it cannot disagree.
VERSION_ORDER="$("$PYTHON_BIN" "$SCRIPT_DIR/version_utils.py" compare "$OLD_VERSION" "$TARGET_VERSION" | tr -d '\r')"
if [ "$VERSION_ORDER" = "older" ]; then
  echo "error: target version ${TARGET_VERSION} is older than the installed version ${OLD_VERSION}; downgrades are not supported." >&2
  exit 1
fi
if [ "$VERSION_ORDER" = "same" ]; then
  echo "    ${TARGET_VERSION} is already installed; reinstalling it to repair this installation."
fi

# 1. Snapshot current installation into backups/toolkit/<TIMESTAMP>_v<OLD_VERSION>/
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_DIR="$INSTALL_DIR/backups/toolkit/${TIMESTAMP}_v${OLD_VERSION}"
mkdir -p "$BACKUP_DIR"

echo "    backing up current toolkit to $(short_path "$BACKUP_DIR")..."
(cd "$INSTALL_DIR" && find . -mindepth 1 -maxdepth 1 ! -name apps ! -name backups ! -name .update.lock ! -name .git -print0 | tar -cf - --null -T -) | (cd "$BACKUP_DIR" && tar -xf -)


rollback() {
  local code="${1:-$?}"
  [ "$code" -eq 0 ] && code=1
  trap - ERR INT TERM EXIT
  set +e
  echo "" >&2
  echo "error: upgrade failed (exit code $code). Rolling back to previous installation..." >&2
  if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
    echo "       A complete backup of your previous installation is preserved at:" >&2
    echo "       ${BACKUP_DIR}" >&2
    echo "       Restoring from backup..." >&2
    find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name apps ! -name backups ! -name .update.lock ! -name .git -exec rm -rf {} + 2>/dev/null || true
    if (cd "$BACKUP_DIR" && tar -cf - .) | (cd "$INSTALL_DIR" && tar -xf -); then
      echo "==> Successfully rolled back to v${OLD_VERSION}." >&2
    else
      echo "❌ ERROR: Automatic rollback failed during restore!" >&2
      echo "   Your files remain safe in the backup directory:" >&2
      echo "   ${BACKUP_DIR}" >&2
      echo "   To restore manually, run:" >&2
      echo "     cp -a \"${BACKUP_DIR}/.\" \"${INSTALL_DIR}/\"" >&2
    fi
  else
    echo "warning: backup directory ${BACKUP_DIR:-unknown} not found; cannot restore automatically." >&2
  fi
  rm -f "${TMP_INSTALL:-}" "${LOCK_FILE:-}"
  exit "$code"
}


# 2. Download the target version's install.sh
TMP_INSTALL="$(mktemp -t data-apps-self-update.XXXXXX)"

# Test seam: DATA_APPS_INSTALL_URL (or legacy CANVAS_INSTALL_URL) redirects where the installer is fetched from
INSTALLER_URL="${DATA_APPS_INSTALL_URL:-${CANVAS_INSTALL_URL:-}}"
if [ -z "$INSTALLER_URL" ]; then
  case "$TARGET_VERSION" in
    *-dev*)
      DEV_CHANNEL="${DEV_CHANNEL:-${USER:-$(id -un 2>/dev/null || whoami 2>/dev/null || echo "dev")}}"
      INSTALLER_URL="${SHARED_BASE_URL}/dev/${DEV_CHANNEL}/install.sh"
      ;;
    *)      INSTALLER_URL="${SHARED_BASE_URL}/versions/${TARGET_VERSION}/install.sh" ;;
  esac
fi

echo "    downloading installer from ${INSTALLER_URL}..."
if [[ "$INSTALLER_URL" == file://* ]]; then
  cp "${INSTALLER_URL#file://}" "$TMP_INSTALL"
else
  if ! curl -fsSL "$INSTALLER_URL" -o "$TMP_INSTALL"; then
    echo "error: failed to download installer from ${INSTALLER_URL}" >&2
    exit 1
  fi
fi

# 3. Execute the installer
export DATA_APPS_INSTALL_DIR="$INSTALL_DIR"
# DATA_APPS_SKIP_VERIFY skips bootstrap.sh's Looker capability probe (verify-install.py),
# not the tarball checksum, which install.sh still verifies against the .sha256 manifest.
export DATA_APPS_SKIP_VERIFY=1

trap 'rollback $?' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
trap 'rollback 129' HUP

INSTALL_RAN=1
echo "    running installer non-interactively..."
bash "$TMP_INSTALL" </dev/null


# 4. Verify version
NEW_VERSION="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || cat "$INSTALL_DIR/dist/VERSION" 2>/dev/null || echo "")"
NEW_VERSION="$(printf '%s' "$NEW_VERSION" | tr -d '[:space:]')"
NEW_VERSION="${NEW_VERSION#v}"

NEW_BUILD_INFO="$(cat "$INSTALL_DIR/BUILD_INFO" 2>/dev/null || cat "$INSTALL_DIR/dist/BUILD_INFO" 2>/dev/null || echo "")"
NEW_BUILD_INFO="$(printf '%s' "$NEW_BUILD_INFO" | tr -d '[:space:]')"
NEW_BUILD_INFO="${NEW_BUILD_INFO#v}"

if [ "$NEW_VERSION" != "$TARGET_VERSION" ] && [ "$NEW_BUILD_INFO" != "$TARGET_VERSION" ]; then
  echo "error: VERSION after upgrade (${NEW_VERSION}) does not match target (${TARGET_VERSION})" >&2
  rollback 1
fi

# Disable rollback trap now that upgrade succeeded
trap - ERR INT TERM

# 5. Prune old toolkit backups (keep KEEP_BACKUPS newest, default 3)
KEEP_BACKUPS="${KEEP_BACKUPS:-3}"
if ! [[ "$KEEP_BACKUPS" =~ ^[0-9]+$ ]] || [ "$KEEP_BACKUPS" -lt 1 ]; then
  KEEP_BACKUPS=3
fi
if [ -d "$INSTALL_DIR/backups/toolkit" ]; then
  TO_PRUNE="$(find "$INSTALL_DIR/backups/toolkit" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | sort -r | tail -n +"$((KEEP_BACKUPS + 1))" || true)"
  if [ -n "$TO_PRUNE" ]; then
    while IFS= read -r d; do
      [ -z "$d" ] && continue
      tk_name="$(basename "$d")"
      if [ -d "$INSTALL_DIR/backups/apps" ] && grep -rq "/backups/toolkit/${tk_name}/" "$INSTALL_DIR/backups/apps" 2>/dev/null; then
        continue
      fi
      [ -d "$d" ] && rm -rf "$d"
    done <<< "$TO_PRUNE"
  fi
fi

echo ""
echo "==> Successfully upgraded Looker Data Apps toolkit to v${NEW_VERSION}."
echo "    Backup preserved at $(short_path "$BACKUP_DIR")."
exit 0
