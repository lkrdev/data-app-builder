#!/usr/bin/env bash
# Unpacks the upstream Looker Data Apps installer and tarball in a temp dir,
# strips local .sh/preview-server bloat, and repackages into skills/data-apps/.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "${ROOT_DIR}/.agents/skills/data-apps-sync/scripts/sync_data_apps.py" "$@"
