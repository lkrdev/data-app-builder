#!/usr/bin/env bash
# Looker Data Apps -- install entry point.
#
# Hosted at:
#   https://dl.google.com/looker-data-apps/install.sh
#
# Customer one-liner:
#   bash <(curl -fsSL https://dl.google.com/looker-data-apps/install.sh)
#
# This script does one thing: read `latest-version.txt` and hand over to that
# version's own installer. The install *procedure* is therefore versioned
# alongside the payload it installs, and this file never has to change from one
# release to the next -- which is what lets an old versioned installer and the
# current one-liner keep working side by side.
#
# All arguments and the environment pass through untouched.

set -euo pipefail

# Rewritten by scripts/publish.sh when publishing to a non-canonical target.
DATA_APPS_PREFIX_URL="${DATA_APPS_PREFIX_URL:-${DATA_APPS_BASE_URL:-https://dl.google.com/looker-data-apps}}"
DATA_APPS_PREFIX_URL="${DATA_APPS_PREFIX_URL%/}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''
  BOLD=''
  NC=''
fi

# The versioned installer never re-invokes this shim, so a second delegation
# means something upstream is pointing back here -- a pointer naming a version
# whose install.sh is itself a shim, most likely. Fail loudly instead of
# recursing until the machine runs out of processes.
if [ "${DATA_APPS_DELEGATED:-0}" = "1" ]; then
  printf "%b" "${RED}${BOLD}error: install delegation loop detected.${NC}\n" >&2
  printf "%b" "${RED}${DATA_APPS_PREFIX_URL} resolved to another delegating installer.${NC}\n" >&2
  exit 1
fi

POINTER_URL="${DATA_APPS_PREFIX_URL}/latest-version.txt"

VERSION="$(curl -fsSL "$POINTER_URL" 2>/dev/null | tr -d '[:space:]' || true)"
if [ -z "$VERSION" ]; then
  printf "%b" "${RED}${BOLD}error: could not read the current version from ${POINTER_URL}.${NC}\n" >&2
  printf "%b" "${RED}Check your network connection and try again; if it persists, contact your Google rep.${NC}\n" >&2
  exit 1
fi

INSTALLER_URL="${DATA_APPS_PREFIX_URL}/versions/${VERSION}/install.sh"

TMP_INSTALL="$(mktemp -t looker-data-apps-install.XXXXXX)"
trap 'rm -f "${TMP_INSTALL:-}"' EXIT

if ! curl -fsSL "$INSTALLER_URL" -o "$TMP_INSTALL"; then
  printf "%b" "${RED}${BOLD}error: ${POINTER_URL} names version ${VERSION}, but ${INSTALLER_URL} is not there.${NC}\n" >&2
  printf "%b" "${RED}The release may be mid-publish. Wait a moment and re-run.${NC}\n" >&2
  exit 1
fi

# If DATA_APPS_BASE_URL was inherited as the prefix root, unset it before
# delegating so install.sh is not fooled into looking for its payload tarball
# at the prefix root instead of its own PAYLOAD_BASE.
unset DATA_APPS_BASE_URL
export DATA_APPS_DELEGATED=1
bash "$TMP_INSTALL" "$@"
