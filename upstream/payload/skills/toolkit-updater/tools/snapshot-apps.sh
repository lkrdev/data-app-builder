#!/usr/bin/env bash
# Snapshot local apps before migration.
#
# Copies apps/ to backups/apps/<TIMESTAMP>_<label>/
# These backups are NEVER pruned, providing an immutable history of pre-migration states.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# In the data-apps developer repository, resolve to repo root so tools are not run against dist/.
# In a customer install, this script lives at <root>/skills/toolkit-updater/tools/snapshot-apps.sh,
# so PARENT_DIR is the positional install root.
if [ "$(basename "$PARENT_DIR")" = "dist" ] && [ -d "$PARENT_DIR/skills" ] && { [ -f "$PARENT_DIR/../scripts/publish.sh" ] || [ -d "$PARENT_DIR/../.git" ]; }; then
  REPO_ROOT="$(cd "$PARENT_DIR/.." && pwd)"
elif [ "$(basename "$PARENT_DIR")" = ".claude" ]; then
  REPO_ROOT="$(cd "$PARENT_DIR/.." && pwd)"
else
  REPO_ROOT="$PARENT_DIR"
fi

LABEL=""
INSTALL_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --label)
      LABEL="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: snapshot-apps.sh [--root <install_dir>] [--label <name>]

Snapshots local apps/ directory to backups/apps/<TIMESTAMP>_<label>/
prior to migration or upgrade.
USAGE
      exit 0
      ;;
    -*)
      echo "error: unknown option '$1'" >&2
      exit 1
      ;;
    *)
      echo "error: unexpected argument '$1'. Use --root and --label flags (see --help)." >&2
      exit 1
      ;;
  esac
done

INSTALL_DIR="${INSTALL_DIR:-$REPO_ROOT}"
if [ ! -d "$INSTALL_DIR" ]; then
  echo "error: install directory not found at $INSTALL_DIR" >&2
  exit 1
fi
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"

# Verify INSTALL_DIR has a VERSION file
if [ ! -f "$INSTALL_DIR/VERSION" ] && [ ! -f "$INSTALL_DIR/dist/VERSION" ]; then
  echo "error: $INSTALL_DIR does not appear to be a Looker Data Apps installation (missing VERSION file)" >&2
  exit 1
fi

if [ -z "$LABEL" ]; then
  LABEL="pre-migration"
fi
LABEL="$(printf '%s' "$LABEL" | tr -c 'a-zA-Z0-9._-' '_')"

APPS_DIR="$INSTALL_DIR/apps"
if [ ! -d "$APPS_DIR" ] || [ -z "$(ls -A "$APPS_DIR" 2>/dev/null)" ]; then
  if [ ! -d "$APPS_DIR" ]; then
    echo "No apps directory found at $APPS_DIR. Nothing to snapshot." >&2
  else
    echo "apps directory is empty. Nothing to snapshot." >&2
  fi
  exit 0
fi

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

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BASE_SNAPSHOT_DIR="$INSTALL_DIR/backups/apps/${TIMESTAMP}_${LABEL}"
SNAPSHOT_DIR="$BASE_SNAPSHOT_DIR"
COUNTER=1
while [ -e "$SNAPSHOT_DIR" ]; do
  SNAPSHOT_DIR="${BASE_SNAPSHOT_DIR}_${COUNTER}"
  COUNTER=$((COUNTER + 1))
done
mkdir -p "$SNAPSHOT_DIR"
trap 'rm -rf "$SNAPSHOT_DIR"' ERR INT TERM

echo "Creating snapshot of local apps in $(short_path "$SNAPSHOT_DIR")..." >&2
(cd "$APPS_DIR" && tar -cf - .) | (cd "$SNAPSHOT_DIR" && tar -xf -)

# Locate matching toolkit backup in backups/toolkit/
CURRENT_VERSION=""
if [ -f "$INSTALL_DIR/VERSION" ]; then
  CURRENT_VERSION="$(tr -d '[:space:]' < "$INSTALL_DIR/VERSION")"
elif [ -f "$INSTALL_DIR/dist/VERSION" ]; then
  CURRENT_VERSION="$(tr -d '[:space:]' < "$INSTALL_DIR/dist/VERSION")"
fi
CUR_VERSION="${CURRENT_VERSION#v}"
[ -z "$CUR_VERSION" ] && CUR_VERSION="0.0.0"

TOOLKIT_BACKUPS_DIR="$INSTALL_DIR/backups/toolkit"
TOOLKIT_BACKUP_NAME=""

if [ -d "$TOOLKIT_BACKUPS_DIR" ]; then
  # 1. Pick the newest backup whose VERSION differs from $INSTALL_DIR/VERSION
  for bkp in $(ls -1d "$TOOLKIT_BACKUPS_DIR"/* 2>/dev/null | sort -r); do
    if [ -d "$bkp" ]; then
      if [ -f "$bkp/VERSION" ]; then
        BKP_VERSION="$(tr -d '[:space:]' < "$bkp/VERSION")"
        BKP_VERSION="${BKP_VERSION#v}"
        if [ -n "$CUR_VERSION" ] && [ "$BKP_VERSION" != "$CUR_VERSION" ]; then
          TOOLKIT_BACKUP_NAME="$(basename "$bkp")"
          break
        fi
      fi
    fi
  done
  # 2. If all match or none had differing VERSION, pick the newest backup in backups/toolkit/
  if [ -z "$TOOLKIT_BACKUP_NAME" ]; then
    for bkp in $(ls -1d "$TOOLKIT_BACKUPS_DIR"/* 2>/dev/null | sort -r); do
      if [ -d "$bkp" ]; then
        TOOLKIT_BACKUP_NAME="$(basename "$bkp")"
        break
      fi
    done
  fi
fi

# 3. If backups/toolkit/ has no backups at all, create a toolkit snapshot
if [ -z "$TOOLKIT_BACKUP_NAME" ]; then
  TK_SNAPSHOT_NAME="${TIMESTAMP}_v${CUR_VERSION}"
  TK_SNAPSHOT_DIR="$TOOLKIT_BACKUPS_DIR/$TK_SNAPSHOT_NAME"
  mkdir -p "$TK_SNAPSHOT_DIR"
  (cd "$INSTALL_DIR" && find . -mindepth 1 -maxdepth 1 ! -name apps ! -name backups ! -name .update.lock ! -name .git -print0 | tar -cf - --null -T -) | (cd "$TK_SNAPSHOT_DIR" && tar -xf -)
  TOOLKIT_BACKUP_NAME="$TK_SNAPSHOT_NAME"
fi

# Record the toolkit backup directory name for this snapshot
printf '%s\n' "$TOOLKIT_BACKUP_NAME" > "$SNAPSHOT_DIR/.toolkit-backup"

# Rewrite runtime and lit imports in all app.js files inside the snapshot
find "$SNAPSHOT_DIR" -type f -name "app.js" | while read -r app_file; do
  LC_ALL=C sed -E -i.bak \
    -e "s#['\"]((\.\./)*|/)runtime/data-app\.js['\"]#'/backups/toolkit/${TOOLKIT_BACKUP_NAME}/runtime/data-app.js'#g" \
    -e "s#['\"]((\.\./)*|/)runtime/lit\.mjs['\"]#'/backups/toolkit/${TOOLKIT_BACKUP_NAME}/runtime/lit.mjs'#g" \
    "$app_file"
  rm -f "${app_file}.bak"
done

trap - ERR INT TERM

echo "App snapshot complete. Snapshot preserved at $(short_path "$SNAPSHOT_DIR")." >&2
echo "$SNAPSHOT_DIR"
