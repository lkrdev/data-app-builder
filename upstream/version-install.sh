#!/usr/bin/env bash
# Looker Data Apps -- the versioned installer.
#
# Hosted at:
#   https://dl.google.com/looker-data-apps/versions/<VERSION>/install.sh
#
# Customers do not normally fetch this directly. The one-liner
#
#   bash <(curl -fsSL https://dl.google.com/looker-data-apps/install.sh)
#
# reads `latest-version.txt` and delegates here (see scripts/install-shim.sh),
# so the install procedure is versioned alongside the payload it installs.
#
# This script:
#   1. Downloads the curated tarball published next to it.
#   2. Extracts it to a customer-chosen directory (default
#      ~/looker-data-apps), preserving any existing data-apps-config.json
#      so re-running this acts as an upgrade.
#   3. Invokes scripts/bootstrap.sh in the extracted directory, which
#      walks the customer through the interactive setup.
#
# No git required, no internal-repo contents exposed.

set -euo pipefail

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[1;34m'
  CYAN='\033[1;36m'
  BOLD='\033[1m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  BOLD=''
  NC=''
fi

# scripts/publish.sh rewrites these three lines, whole, into every published
# copy. They are the installer's entire sense of where it came from: a script
# read over `bash <(curl ...)` cannot resolve anything relative to itself.
#   VERSION       the build label this copy installs (a dev copy carries a sha)
#   PAYLOAD_BASE  the directory holding this copy's tarball and runtime
#   SHARED_BASE   the prefix root, whose vendor/ every version shares
VERSION="1.2.0"
PAYLOAD_BASE="https://dl.google.com/looker-data-apps/versions/1.2.0"
SHARED_BASE="https://dl.google.com/looker-data-apps"

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

print_banner() {
  local version="${1:-$VERSION}"
  local v_str="v${version}"
  local w=56
  local pad_len=$(( w - ${#v_str} - 3 ))
  if [ "$pad_len" -lt 0 ]; then pad_len=0; fi
  local pad
  pad=$(printf "%*s" "$pad_len" "")

  echo -e "${BLUE}┌────────────────────────────────────────────────────────┐${NC}"
  echo -e "${BLUE}│${NC}                                                        ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}            ${CYAN}_                 _${NC}                         ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}| |    ___   ___  | | _____ _ __${NC}             ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}| |   / _ \ / _ \ | |/ / _ \ '__|${NC}            ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}| |__| (_) | (_) ||   <  __/ |${NC}               ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}|_____\___/ \___/ |_|\_\___|_|${NC}               ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}                                                        ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}     ${GREEN}____        _            _${NC}                         ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}|  _ \  __ _| |_ __ _    / \   _ __  _ __  ___${NC}      ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}| | | |/ _\` | __/ _\` |  / _ \ | '_ \| '_ \/ __|${NC}     ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}| |_| | (_| | || (_| | / ___ \| |_) | |_) \__ \ ${NC}    ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}|____/ \__,_|\__\__,_|/_/   \_\ .__/| .__/|___/${NC}     ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}                                  ${GREEN}|_|   |_|${NC}             ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}${pad}${YELLOW}${v_str}${NC}   ${BLUE}│${NC}"
  echo -e "${BLUE}└────────────────────────────────────────────────────────┘${NC}"
  echo ""
}

print_banner "$VERSION"
export DATA_APPS_BANNER_SHOWN=1

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

# Where this copy of the installer was published. scripts/publish.sh bakes it
# in per channel, so an installer fetched from one channel installs that
# channel's toolkit and runtime.
DATA_APPS_BASE_URL="${DATA_APPS_BASE_URL:-$PAYLOAD_BASE}"
DATA_APPS_BASE_URL="${DATA_APPS_BASE_URL%/}"
TARBALL_URL="${TARBALL_URL:-${DATA_APPS_BASE_URL}/looker-data-apps.tar.gz}"
DEFAULT_INSTALL_DIR="${HOME}/looker-data-apps"

# ----------------------------------------------------------------------
# 1. Pick install location & options
# ----------------------------------------------------------------------

# Note: DATA_APPS_INSTALL_DIR takes precedence over positional arguments so
# that automation (such as self-update.sh) can override positional defaults.
RESET_APPS=""
INSTALL_DIR="${DATA_APPS_INSTALL_DIR:-}"
for arg in "$@"; do
  case "$arg" in
    --reset|-r) RESET_APPS=1 ;;
    -*)
      echo -e "${RED}error: unrecognized option '$arg'${NC}" >&2
      exit 1
      ;;
    */*|~*|.*)
      [ -z "$INSTALL_DIR" ] && INSTALL_DIR="$arg"
      ;;
    *)
      if [ -d "$arg" ]; then
        [ -z "$INSTALL_DIR" ] && INSTALL_DIR="$arg"
      else
        echo -e "${RED}error: unrecognized argument or nonexistent directory '$arg'${NC}" >&2
        echo -e "To specify an install directory, provide a path containing '/' or '~' (e.g. ./${arg}).${NC}" >&2
        exit 1
      fi
      ;;
  esac
done

# DATA_APPS_INSTALL_DIR or a positional argument lets a caller name the target
# without a terminal. The prompt below only runs on a TTY, so piping input at
# this script does nothing and it silently installs to the default -- which,
# since this step purges before extracting, means a test run aimed elsewhere
# lands on a real install.
if [ -n "$INSTALL_DIR" ]; then
  : # already set from DATA_APPS_INSTALL_DIR or positional argument
elif [ -t 0 ]; then
  read -rp "$(echo -e "${BOLD}Install directory [${YELLOW}$(short_path "${DEFAULT_INSTALL_DIR}")${NC}${BOLD}]: ${NC}")" INSTALL_DIR
else
  # Non-interactive with no explicit target; use the default.
  INSTALL_DIR=""
fi
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
# Expand leading tilde to $HOME if the user typed it manually
INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"

# ----------------------------------------------------------------------
# 1.5. Safety check: prevent overwriting the developer repository
# ----------------------------------------------------------------------
if [ -f "$INSTALL_DIR/scripts/publish.sh" ] || [ -d "$INSTALL_DIR/dist/skills" ] || { [ -d "$INSTALL_DIR/.git" ] && [ -d "$INSTALL_DIR/tests" ]; }; then
  echo -e "${RED}${BOLD}error: $(short_path "$INSTALL_DIR") appears to be the Looker Data Apps developer repository!${NC}" >&2
  echo -e "${RED}Running the installer here will extract the tarball and overwrite the source code.${NC}" >&2
  echo -e "${RED}Please run the installer again and specify a different directory (e.g. ~/data-apps-install).${NC}" >&2
  exit 1
fi

if [ -n "$RESET_APPS" ] && [ -d "$INSTALL_DIR/apps" ]; then
  echo -e "${YELLOW}Reset flag passed: clearing $(short_path "$INSTALL_DIR")/apps/...${NC}"
  rm -rf "${INSTALL_DIR:?}/apps"/* 2>/dev/null || true
fi

# ----------------------------------------------------------------------
# 2. Preserve existing customer config across upgrades
# ----------------------------------------------------------------------

PRESERVE="$(mktemp -d -t looker-data-apps-preserve.XXXXXX)"
trap 'rm -f "${TARBALL:-}" "${TARBALL:-}.sha256"; rm -rf "${PRESERVE:-}"' EXIT
preserved=0
OLD_VERSION=""
if [ -f "${INSTALL_DIR}/VERSION" ]; then
  read -r OLD_VERSION < "${INSTALL_DIR}/VERSION" || true
fi

# 2.1 Same-directory upgrade preservation
if [ -f "${INSTALL_DIR}/data-apps-config.json" ]; then
  cp "${INSTALL_DIR}/data-apps-config.json" "$PRESERVE/data-apps-config.json"
  preserved=1
fi
if [ -f "${INSTALL_DIR}/looker-config.json" ]; then
  cp "${INSTALL_DIR}/looker-config.json" "$PRESERVE/looker-config.json"
  preserved=1
fi
if [ -f "${INSTALL_DIR}/skills/data-app-creator/config.json" ]; then
  mkdir -p "$PRESERVE/skills/data-app-creator"
  cp "${INSTALL_DIR}/skills/data-app-creator/config.json" \
     "$PRESERVE/skills/data-app-creator/config.json"
  preserved=1
fi

if [ "$preserved" = "1" ]; then
  echo "existing config detected in $(short_path "$INSTALL_DIR") -- preserving across upgrade."
fi

# ----------------------------------------------------------------------
# 3. Download + extract the tarball
# ----------------------------------------------------------------------

mkdir -p "$INSTALL_DIR"
echo -e "\nDownloading ${TARBALL_URL}..."
TARBALL="$(mktemp -t looker-data-apps.XXXXXX.tar.gz)"
curl -fsSL -o "$TARBALL" "$TARBALL_URL"
curl -fsSL -o "$TARBALL.sha256" "${TARBALL_URL}.sha256"

# Verify the checksum published next to the tarball before extracting.
# GCS serves both files, so this catches truncation/corruption in
# transit and any mismatch between what publish.sh built and what we
# received. (shasum on macOS, sha256sum on most Linux.)
echo -e "Verifying checksum..."
EXPECTED="$(cut -d' ' -f1 "$TARBALL.sha256")"
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"
else
  ACTUAL="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
fi
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo -e "${RED}${BOLD}error: checksum mismatch for looker-data-apps.tar.gz${NC}" >&2
  echo -e "${RED}  expected: ${EXPECTED:-<empty>}${NC}" >&2
  echo -e "${RED}  actual:   $ACTUAL${NC}" >&2
  echo -e "${RED}The download is corrupt or the bucket is mid-release. Re-run${NC}" >&2
  echo -e "${RED}the installer; if it persists, contact your Google rep.${NC}" >&2
  exit 1
fi
echo "Checksum OK (${ACTUAL})"

echo -e "Extracting into $(short_path "$INSTALL_DIR")..."
# ----------------------------------------------------------------------
# 3b. Replace, don't overlay -- and never delete silently
# ----------------------------------------------------------------------
# `tar -xzf` only ever adds and overwrites, so a file a past release shipped
# and this one dropped survives every upgrade and goes on being read by
# agents. Clearing the directory first fixes that, but a blanket delete of
# everything-but-apps-and-config would also take a customer's own notes.md,
# drafts/, or .env with it.
#
# So we distinguish the two. Anything the incoming tarball also contains is
# about to be rewritten -- deleting it first loses nothing. Anything else is
# a real deletion: either an obsolete product file or something the user put
# there, and we cannot tell those apart. Those get listed and confirmed.
# On a clean upgrade the list is empty and nothing is asked.

if [ -d "$INSTALL_DIR" ]; then
  # A preview server from the old install would keep running against files
  # that are about to disappear, and hold its port while doing it.
  if [ -f "$INSTALL_DIR/.preview-pid" ]; then
    OLD_PID="$(tr -d '[:space:]' < "$INSTALL_DIR/.preview-pid" 2>/dev/null || true)"
    if [ -f "$INSTALL_DIR/skills/data-app-previewer/tools/stop-preview.py" ]; then
      echo "stopping the preview server from the previous install (pid ${OLD_PID:-unknown})..."
      "$PYTHON_BIN" "$INSTALL_DIR/skills/data-app-previewer/tools/stop-preview.py" >/dev/null 2>&1 || true
    fi
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      echo "stopping the preview server from the previous install (pid $OLD_PID)..."
      kill "$OLD_PID" 2>/dev/null || true
    fi
  fi

  # Top-level names the incoming tarball will restore.
  INCOMING="$(tar -tzf "$TARBALL" 2>/dev/null \
    | sed -e 's|^\./||' -e 's|/.*$||' | sort -u)"

  # Plus the ones we generate rather than ship, which therefore aren't in the
  # tarball but are still ours and still come back: the preview tools rewrite
  # their own state on next start. Without this they get reported as files the
  # user might own -- and a prompt that cries wolf on every upgrade is a prompt
  # people learn to answer 'y' to without reading.
  REGENERATED="BUILD_INFO .claude .preview-pid .preview-port .preview-server.log __pycache__ .DS_Store"

  CANDIDATES="$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 \
    ! -name 'apps' ! -name 'backups' ! -name '.update.lock' ! -name '.git' ! -name '*.json' 2>/dev/null | sort)"


  # Split: rewritten by the tarball vs genuinely removed.
  REWRITTEN=""; DELETIONS=""
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    base="$(basename "$entry")"
    if printf '%s\n' "$INCOMING" | grep -qxF "$base" \
       || printf '%s\n' $REGENERATED | grep -qxF "$base"; then
      REWRITTEN="$REWRITTEN$entry\n"
    else
      DELETIONS="$DELETIONS$entry\n"
    fi
  done <<EOF
$CANDIDATES
EOF

  if [ -n "$DELETIONS" ]; then
    echo ""
    echo -e "${YELLOW}The following are in $(short_path "${INSTALL_DIR}") but not in this release.${NC}"
    echo -e "${YELLOW}They will be deleted (your apps/ and *.json config are never touched):${NC}"
    printf "$DELETIONS" | sed 's|^|  |'
    echo ""
    if [ -t 0 ]; then
      read -rp "$(echo -e "${BOLD}Continue and erase the files listed above? [y/N]: ${NC}")" ERASE_OK
      case "$ERASE_OK" in
        [yY]|[yY][eE][sS]) ;;
        *) echo "aborted -- nothing was changed."; exit 1 ;;
      esac
    else
      echo "non-interactive: keeping them. Remove by hand if they are obsolete."
      DELETIONS=""
    fi
  fi

  purged=0
  printf "$REWRITTEN$DELETIONS" | while IFS= read -r entry; do
    [ -n "$entry" ] && rm -rf "$entry"
  done
  purged="$(printf "$REWRITTEN$DELETIONS" | grep -c . || true)"
  if [ "$purged" -gt 0 ]; then
    echo "cleared $purged item(s) from $(short_path "$INSTALL_DIR") before extracting."
  fi
fi

tar -xzf "$TARBALL" -C "$INSTALL_DIR"

NEW_VERSION=""
if [ -f "${INSTALL_DIR}/VERSION" ]; then
  read -r NEW_VERSION < "${INSTALL_DIR}/VERSION" || true
fi
NEW_VERSION="${NEW_VERSION:-unknown}"
if [ -n "$OLD_VERSION" ]; then
  echo ""
  if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    echo -e "${BLUE}Reinstalling version ${NEW_VERSION}${NC}"
  else
    echo -e "${GREEN}Upgrading from ${OLD_VERSION} to ${BLUE}${NEW_VERSION}${NC}"
  fi
fi

# Restore preserved config (overwrites whatever was in the tarball,
# which is fine -- they're customer-specific files we never ship).
if [ -f "$PRESERVE/data-apps-config.json" ]; then
  cp "$PRESERVE/data-apps-config.json" "$INSTALL_DIR/data-apps-config.json"
fi
if [ -f "$PRESERVE/looker-config.json" ]; then
  cp "$PRESERVE/looker-config.json" "$INSTALL_DIR/looker-config.json"
fi
if [ -f "$PRESERVE/skills/data-app-creator/config.json" ]; then
  mkdir -p "$INSTALL_DIR/skills/data-app-creator"
  cp "$PRESERVE/skills/data-app-creator/config.json" \
     "$INSTALL_DIR/skills/data-app-creator/config.json"
fi

# Clean up temporary files prior to exec, as exec replaces the shell process without triggering EXIT traps.
rm -f "${TARBALL:-}" "${TARBALL:-}.sha256"
rm -rf "${PRESERVE:-}"
trap - EXIT

# ----------------------------------------------------------------------
# 4. Hand off to bootstrap
# ----------------------------------------------------------------------

# bootstrap.sh records these in data-apps-config.json, and the publisher reads
# them back to decide which runtime a published tile imports and where its
# vendored libraries resolve from. Deriving either by string surgery on the
# other has been a recurring source of 404s, so both are passed explicitly.
export DATA_APPS_RUNTIME_URL="${DATA_APPS_BASE_URL}"
export DATA_APPS_BROWSER_ASSETS_URL="${DATA_APPS_BROWSER_ASSETS_URL:-https://www.gstatic.com/looker-data-apps}"
export DATA_APPS_SHARED_BASE="${SHARED_BASE%/}"
# Which version this install replaced, so bootstrap can tell a pin the previous
# install wrote (advance it) from one the customer chose (leave it).
export DATA_APPS_PREVIOUS_VERSION="${OLD_VERSION}"

cd "$INSTALL_DIR"
exec bash scripts/bootstrap.sh
