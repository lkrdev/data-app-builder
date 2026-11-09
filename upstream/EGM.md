# upstream

## Overview
Release bootstrapper and distributable payload root for Looker Data Apps, providing the two-stage `install.sh` -> `version-install.sh` installer pipeline, release version pointer (`latest-version.txt`), and packaged toolkit payload (`./payload/EGM.md`).

## Interface
- `[latest-version.txt:1]`: Static release pointer containing `"1.2.0"` fetched by `install.sh`.
- `[install.sh:DATA_APPS_PREFIX_URL, DATA_APPS_BASE_URL, NO_COLOR, DATA_APPS_DELEGATED, $@]`: Stage-1 bootstrapper that fetches `latest-version.txt` and `versions/${VERSION}/install.sh`, forwards CLI arguments, and prevents recursive delegation (`DATA_APPS_DELEGATED=1`).
- `[version-install.sh:--reset, -r, INSTALL_DIR, DATA_APPS_INSTALL_DIR, DATA_APPS_PYTHON, PYTHON, DATA_APPS_BASE_URL, TARBALL_URL, DATA_APPS_BROWSER_ASSETS_URL, DATA_APPS_RUNTIME_URL, DATA_APPS_SHARED_BASE, DATA_APPS_PREVIOUS_VERSION, DATA_APPS_BANNER_SHOWN, VERSION, PAYLOAD_BASE, SHARED_BASE, NO_COLOR, short_path, print_banner, resolve_python]`: Stage-2 versioned installer (`VERSION = 1.2.0`) that resolves Python 3.9+, verifies tarball SHA-256, preserves user apps and configs, extracts the payload, and hands off to `scripts/bootstrap.sh`.
- Child contracts: [payload](./payload/EGM.md) — Distributable Looker Data Apps runtime, preview server, setup scripts, bundled skills, and vendored browser dependencies.

## Invariants
- `[install.sh:set]` & `[version-install.sh:set]`: Both scripts enforce `set -euo pipefail`.
- `[install.sh:DATA_APPS_DELEGATED]`: Fails with exit `1` if `DATA_APPS_DELEGATED=1`; unsets `DATA_APPS_BASE_URL` before invoking the delegated versioned installer.
- `[version-install.sh:resolve_python]` & `[version-install.sh:184-189]`: Requires Python >= 3.9 and refuses to install into a developer repository (`scripts/publish.sh`, `dist/skills`, or `.git` + `tests`).
- `[version-install.sh:EXPECTED]` / `[version-install.sh:ACTUAL]`: Verifies SHA-256 of `looker-data-apps.tar.gz` against `.sha256` (`shasum -a 256` or `sha256sum`) and aborts on empty or mismatched digests.
- `[version-install.sh:CANDIDATES]`, `[version-install.sh:PRESERVE]`, `[version-install.sh:DELETIONS]`: Excludes `apps`, `backups`, `.update.lock`, `.git`, and `*.json` from pre-extract purge; preserves `data-apps-config.json`, `looker-config.json`, and `skills/data-app-creator/config.json`; requires TTY `[y/N]` confirmation before removing unknown obsolete top-level files.
- `[version-install.sh:378-381]`: Clears temp files and `EXIT` trap before `exec bash scripts/bootstrap.sh` because `exec` bypasses shell `EXIT` traps.

## Side Effects
- `[install.sh:POINTER_URL]` / `[install.sh:TMP_INSTALL]`: Downloads `latest-version.txt` and `versions/${VERSION}/install.sh` via `curl -fsSL` into a `mktemp` file and executes `bash "$TMP_INSTALL" "$@"`.
- `[version-install.sh]`: Optionally deletes `${INSTALL_DIR}/apps/*` on `--reset`/`-r`, stops running preview servers via `stop-preview.py` / `kill`, downloads and extracts `looker-data-apps.tar.gz` into `$INSTALL_DIR`, restores backed-up config JSON files, exports `DATA_APPS_*` env vars, and `exec`s `bash scripts/bootstrap.sh`.

## Verification
- Run: `npm test`
