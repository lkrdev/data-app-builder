#!/usr/bin/env bash
# Copies (or builds) the single-file Looker Code Mode WASM bundle from
# ~/lkrdev/cli/dist/codemode.js into src/vendor/codemode.js.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${LKR_CLI_DIR:-/usr/local/google/home/bryanweber/lkrdev/cli}"
SRC_BUNDLE="${CLI_DIR}/dist/codemode.js"
DEST_BUNDLE="${ROOT_DIR}/src/vendor/codemode.js"

mkdir -p "${ROOT_DIR}/src/vendor"

if [ ! -f "${SRC_BUNDLE}" ]; then
  echo "Building ${SRC_BUNDLE} via ${CLI_DIR}/scripts/build_codemode_wasm.py..."
  python3 "${CLI_DIR}/scripts/build_codemode_wasm.py"
fi

cp "${SRC_BUNDLE}" "${DEST_BUNDLE}"
echo "Synced ${SRC_BUNDLE} -> ${DEST_BUNDLE} ($(wc -c < "${DEST_BUNDLE}") bytes)"
