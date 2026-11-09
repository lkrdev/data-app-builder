# skills/toolkit-updater

## Overview
Skill package for checking remote Looker Data Apps releases, snapshotting user apps before upgrades, and performing locked self-updates with automatic rollback.

## Subdirectories & Boundaries
- [SKILL.md](./SKILL.md) - Update check, changelog narration, app snapshot, and toolkit upgrade instructions.
- [tools](./tools/EGM.md) - Update checker (`check-for-update.py`), semver comparator (`version_utils.py`), app snapshotter (`snapshot-apps.sh`), and atomic self-updater (`self-update.sh`).
