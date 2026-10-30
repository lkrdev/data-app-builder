#!/usr/bin/env bash
# Redownloads and extracts the upstream Looker Data Apps installer and toolkit
# into ./upstream/ so git status / git diff shows any upstream changes.
set -euo pipefail

PREFIX_URL="${DATA_APPS_PREFIX_URL:-https://dl.google.com/looker-data-apps}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/upstream"

rm -rf "${UPSTREAM_DIR}"
mkdir -p "${UPSTREAM_DIR}/payload"

echo "1. Fetching ${PREFIX_URL}/install.sh -> upstream/install.sh"
curl -fsSL "${PREFIX_URL}/install.sh" | tr -d '\r' > "${UPSTREAM_DIR}/install.sh"

echo "2. Fetching ${PREFIX_URL}/latest-version.txt -> upstream/latest-version.txt"
VERSION="$(curl -fsSL "${PREFIX_URL}/latest-version.txt" | tr -d '[:space:]')"
printf "%s\n" "${VERSION}" > "${UPSTREAM_DIR}/latest-version.txt"

echo "3. Fetching ${PREFIX_URL}/versions/${VERSION}/install.sh -> upstream/version-install.sh"
curl -fsSL "${PREFIX_URL}/versions/${VERSION}/install.sh" | tr -d '\r' > "${UPSTREAM_DIR}/version-install.sh"

echo "4. Extracting ${PREFIX_URL}/versions/${VERSION}/looker-data-apps.tar.gz -> upstream/payload/"
curl -fsSL "${PREFIX_URL}/versions/${VERSION}/looker-data-apps.tar.gz" | tar -zx -C "${UPSTREAM_DIR}/payload"

echo "Done! Synced Looker Data Apps v${VERSION} into ${UPSTREAM_DIR}"
