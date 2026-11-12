#!/usr/bin/env bash
# Syncs the single-file Looker Code Mode WASM bundle from cdn.lkr.dev (matching
# lkr-dev-cli-version.txt) into src/vendor/codemode.js for byte-for-byte CDN parity.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "${ROOT_DIR}/lkr-dev-cli-version.txt")"
CDN_URL="${CODEMODE_CDN_URL:-https://cdn.lkr.dev/cli/codemode/${VERSION}/codemode.js}"
DEST_BUNDLE="${ROOT_DIR}/src/vendor/codemode.js"

mkdir -p "${ROOT_DIR}/src/vendor"
curl -fsSL "${CDN_URL}" -o "${DEST_BUNDLE}"
echo "Synced ${CDN_URL} -> ${DEST_BUNDLE} ($(wc -c < "${DEST_BUNDLE}") bytes)"
