# toolkit-updater Tools

## Overview
Toolkit update checker, semver comparator, non-destructive user-app snapshotter, and locked self-updater with automatic rollback for installed Looker Data Apps environments.

## Interface
- `[check-for-update.py:main, check_for_update, find_root, read_installed_version, load_config, is_check_disabled, get_version_url, get_changelog_url, read_cache, write_cache, SCHEMA_VERSION]`: CLI (`--root`, `--config`, `--force`, `--dismiss`, `--version-url`, `--changelog-url`, `--timeout`, `--json`) checking remote `latest-version.txt` with `.update-check.json` TTL caching.
- `[self-update.sh:--root, --target, --help, DATA_APPS_PYTHON]`: Bash upgrader that snapshots the current toolkit, downloads and runs `install.sh` non-interactively, verifies the target version, and rolls back on failure.
- `[snapshot-apps.sh:--root, --label, --help]`: Bash pre-migration backup utility that archives `apps/` under `backups/apps/`, links a `.toolkit-backup` reference, and rewrites snapshot `runtime/*` imports for rollback isolation.
- `[version_utils.py:parse_version, compare, _main]`: Semver parser/comparator (`version_utils.py compare <installed> <target>` -> `older` | `same` | `newer`).

## Invariants
- `[check-for-update.py:main]`: Always exits `0` emitting JSON on stdout (`check_failed` on unexpected errors); `_http_only_opener` restricts schemes to `http`/`https`; remote pointer reads are capped at `MAX_POINTER_BYTES` (4096) and validated against `SEMVER_RE`; cache writes are atomic via PID-suffixed temp replacement.
- `[self-update.sh:INSTALL_DIR]`, `[self-update.sh:LOCK_FILE]`, `[self-update.sh:VERSION_ORDER]`: Refuses `/`, `$HOME`, dev checkouts, or directories missing config/`VERSION`; acquires `.update.lock` via `noclobber`; forbids downgrades (`version_utils.py compare` == `older`); keeps at least `KEEP_BACKUPS` (default 3) toolkit backups and protects backups referenced by `backups/apps/*/.toolkit-backup`.
- `[snapshot-apps.sh:SNAPSHOT_DIR]`: Exits `0` cleanly when `apps/` is missing or empty; sanitizes `--label` outside `[a-zA-Z0-9._-]`; never overwrites an existing snapshot directory and deletes partial snapshots on `ERR`/`INT`/`TERM`.
- `[version_utils.py:parse_version]`: Only the 3-part numeric dot-separated core before `-`/`+` participates in ordering; CLI exits `2` unless `len(argv) == 4` with `compare`.

## Side Effects
- `[check-for-update.py:check_for_update]`: Performs HTTP(S) GET to the version pointer URL and writes/replaces `<root>/.update-check.json`.
- `[self-update.sh]`: Creates/removes `.update.lock`, fetches `latest-version.txt` and `install.sh`, creates `backups/toolkit/<timestamp>_v<old>/` via `tar`, runs downloaded `install.sh` (`DATA_APPS_SKIP_VERIFY=1`), deletes/restores top-level install entries on rollback, and prunes old toolkit backups.
- `[snapshot-apps.sh]`: Creates `backups/apps/<timestamp>_<label>/` (and `backups/toolkit/...` if none exist), writes `.toolkit-backup`, and rewrites `runtime/data-app.js` / `runtime/lit.mjs` imports in-place across snapshot `app.js` files via `sed`.

## Verification
- Run: `npm test`
