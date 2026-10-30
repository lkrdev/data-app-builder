---
name: toolkit-updater
description: |
  Check for, report, and perform safe in-place upgrades of the Looker Data Apps devtools
  and runtime, manage toolkit backups, and coordinate local app migrations.
  Trigger when checking for updates, upgrading the toolkit, or upgrading existing Lit apps in `apps/` to the latest runtime. Legacy HTML Canvas Dashboards use `data-app-upgrader`.
---

# Toolkit Updater

This skill defines the authoritative workflow for discovering, reporting, and executing safe in-place upgrades of the Looker Data Apps installation (`~/looker-data-apps`).

---

## Universal Safety Invariants

1. **Nothing destructive happens before the backup completes.** Every upgrade and migration creates a full snapshot before modifying any files on disk.
2. **Nothing moves; backups are copies.** `apps/` is never relocated. Declining an upgrade or migration leaves all files in place and fully functional.
3. **Each gate is a separate turn requiring explicit human confirmation.** Never combine a report and an upgrade into the same turn.
4. **Live published tiles are unaffected.** A published Looker tile imports its runtime bundle directly from `looker-data-apps/versions/<VERSION>/data-app.js`, frozen at publish time. Upgrading local devtools changes nothing in Looker until a dashboard is selectively re-published.

---

## The Four Gates Protocol

```
Gate 1: Version Check & Changelog Report  ──[User says Yes]──►  Gate 2: Devtools Self-Update
                  │                                                       │
         [User says No / Dismiss]                                         ▼
                  │                                             Gate 3: App Snapshot & Migration
                  ▼                                                       │
           Resume Task                                            [User says Yes]
                                                                          │
                                                                          ▼
                                                                Gate 4: Preview & Selective Re-Publish
```

---

### Gate 1: Version Check & Changelog Report

Before beginning authoring workflows or upon request, check if a newer release exists (on Windows where `python3` is absent or points to the Microsoft Store stub, substitute `python` or `py -3` in all `python3` commands below):

```bash
python3 skills/toolkit-updater/tools/check-for-update.py
```

- **If `update_available` is false** (`status` is `up_to_date`, `check_skipped_recent`, `check_failed_offline`, or `check_disabled`):
  Proceed immediately with the user's primary task.
- **If `update_available` is true:**
  1. Inspect the remote `CHANGELOG.md` via `changelog_url` (or fetch from the stable release bucket).
  2. Summarize changes in the range `(installed_version, latest_version]` in plain English.
  3. **Classify the bump** by comparing `installed_version` with `latest_version`, and say which it is in your report:
     - **patch** (`1.0.0` → `1.0.1`) — every published app keeps working. Gate 3 will have nothing to do.
     - **minor** (`1.0.0` → `1.1.0`) or **major** (`1.0.0` → `2.0.0`) — apps must be migrated to the new runtime before they are re-published. Tell the user this *before* they consent, so they are agreeing to the migration and not only to the download.

     Read this from the version numbers and the changelog's own preamble, which states the contract. Do not infer it from how large the diff looks.
  4. Inform the user of the new version and its highlights.
  5. **STOP AND ASK:** Prompt the user if they would like to upgrade devtools in place. **Never execute the upgrade in the same turn as the report.**
  6. **If the user declines:**
     ```bash
     python3 skills/toolkit-updater/tools/check-for-update.py --dismiss <latest_version>
     ```
     Resume the user's primary task.

---

### Gate 2: Devtools Self-Update

When the user explicitly confirms the devtools upgrade:

1. Run the self-update engine:
   ```bash
   bash skills/toolkit-updater/tools/self-update.sh --target <latest_version>
   ```
2. The script executes the following automated sequence:
   - Takes a full snapshot of the toolkit into `backups/toolkit/<TIMESTAMP>_v<OLD_VERSION>/`.
   - Downloads the target version's `install.sh`. The installer carries the directory it was published from, and `bootstrap.sh` advances `browser_assets_url` in `data-apps-config.json` to match (omitted when canonical) — leaving a self-hosted bucket, a dev channel, or a deliberate older pin exactly as it found them.
   - Executes the installer unattended (`DATA_APPS_SKIP_VERIFY=1` skips `bootstrap.sh`'s Looker capability probe, not the tarball checksum, which `install.sh` still verifies; input from `/dev/null`).
   - Verifies the installed `VERSION` matches the target.
   - On error, automatically rolls back from `backups/toolkit/<TIMESTAMP>_v<OLD_VERSION>/`.
   - On success, prunes older toolkit backups to keep the 3 newest.
3. **If the script exits non-zero:**
   Report the failure verbatim. Do not retry, and do not claim a rollback happened
   unless the output says so. Several failures happen *before* anything is modified —
   a refusal to run against `/` or `$HOME`, a refusal to run inside a development
   checkout, a missing configuration file, another update already holding
   `.update.lock`, or a failed installer download — and in those cases the
   installation was never touched. A rollback only occurs once the script has
   started the installer, and when it does the script prints the backup directory it
   restored from. Report that path when it is present, and tell the user the backup
   is retained under `backups/toolkit/` either way.
4. **If the script succeeds:**
   Note the `Current:` version printed in `self-update.sh`'s output (you can pass this as the label for the app snapshot in Gate 3), then proceed to Gate 3.

**Which targets are accepted.** The script installs the target only if it is newer
than, or the same as, what is installed. A target older than the installed version is
refused and there is no override — downgrades are not supported. Passing the version
that is *already* installed is allowed on purpose and reinstalls it: that is the
supported way to repair an installation that lost files, and it still takes a backup
first.

---

### Gate 3: App Snapshot & Migration

If the user only asks to upgrade existing apps (no toolkit update), start at Gate 3.

After devtools are upgraded, prompt the user:

> *Devtools have been upgraded to `<latest_version>`. Would you also like to update your local apps in `apps/` for compatibility with the new runtime? (Live Looker dashboards keep running their pinned runtime until you selectively re-publish).*

- **If the user declines:**
  Stop here. Local apps remain untouched.
- **If the user approves:**
  1. Snapshot all local apps before making any edits:
     ```bash
     bash skills/toolkit-updater/tools/snapshot-apps.sh --label pre-migration
     ```
     *(Or pass `--label v<OLD_VERSION>`). If `--label` is omitted, it defaults to `pre-migration`. Note: App snapshots in `backups/apps/` are **never pruned**.*
  2. Migrate from `CHANGELOG.md`:
     - **Starting version:** read each app's `@toolkit-version` tag. Apply every **Breaking** entry newer than it, from oldest to newest, because a later entry can rename a name an earlier one produced. No tag: apply every Breaking entry in the file. Older than the oldest entry: rewrite the app with `skills/data-app-creator/SKILL.md`, keeping its queries, layout intent, and publish metadata.
     - **Inventory first:** count the apps and list which old names each one uses. Report the count before editing.
     - **Renames:** use a one-off script in your scratch directory (never checked in) only for exact 1:1 renames. Inspect structural changes per app.
     - **Batches:** about 5 apps per subagent when there are more than 5 apps or any app is large. Verify each batch (step 4) before the next. If verification fails only because the app's Looker model or explore is missing on this instance, keep the changes when the tile-safety and syntax stages pass. Restore from the snapshot only when an edit broke the app and cannot be fixed.
     - **Legacy HTML dashboards** (`*.canvasdashboard.html`) use `skills/data-app-upgrader/SKILL.md` instead.
     - **Let the bump decide, then confirm against the changelog.** A **patch** bump requires no source changes: say so and go straight to Gate 4. A **minor** or **major** bump means migration is expected, so a Breaking entry in `CHANGELOG.md` should exist for a minor or major bump. If none does, do not quietly skip it. Report the mismatch to the user, because either the release was numbered wrong or a Breaking entry is missing, and both are worth knowing before apps are re-published.
  3. **Preserve publish metadata:** Ensure all structured JSDoc header tags (`@looker-dashboard-id`, `@looker-instance`, `@created-at`, `@created-by`, `@updated-at`, `@updated-by`, `@toolkit-version`, and legacy `@published-at`, `@published-by`) survive migration untouched.
  4. Verify syntax, safety, queries, and visual rendering across each batch of migrated apps before the next batch:
     Start the preview server if needed (`python3 skills/data-app-previewer/tools/start-preview.py`), then run QA verification on each app in the batch:
     ```bash
     python3 skills/data-app-creator/tools/verify-app.py apps/<name>/app.js
     ```
     Inspect `apps/<name>/preview.png` with `view_file` for each migrated app to confirm visual layout.

---

### Gate 4: Side-by-Side Preview & Selective Re-Publish

Once migration is complete:

1. **Side-by-Side Preview:** Both the modernized app and the pre-migration snapshot can be viewed simultaneously on the local preview server:
   - **Modernized app:** `http://localhost:8765/preview-server/?app=apps/<name>/app.js`
   - **Pre-migration snapshot:** `http://localhost:8765/preview-server/?app=backups/apps/<snapshot>/<name>/app.js`
   *(The preview server only reads app files; it never writes to backups or anywhere else.)*

2. **Selective Re-Publish:**
   - Read the JSDoc header in each migrated `apps/<name>/app.js`.
   - Identify apps containing `@looker-dashboard-id`.
   - Report published apps to the user:
     > *Migrated `<N>` apps. The following apps are currently published in Looker:*
     > - **Sales Overview** (Dashboard #42, last published on toolkit 0.9.1)
     > - **Ops Daily** (Dashboard #57, last published on toolkit 0.9.5)
     >
     > *Please preview them and let me know which ones you would like to update in Looker.*
   - For each app the user selects to update, re-publish in place:
     ```bash
     python3 skills/data-app-publisher/tools/publish-data-app.py \
       --def apps/<name>/app.js \
       --dashboard-id <id>
     ```
     *(Note: `--dashboard-id` automatically preserves the existing dashboard title from Looker; pass `--title "<New Title>"` only if you want to rename it. Never pass `--confirm-replace` on the first run; if `user_mismatch` occurs because another user last updated the dashboard, prompt the user for confirmation before re-running with `--confirm-replace`.)*
   - Apps not selected remain live on their existing pinned runtime in Looker.

3. **Restoring an app from snapshot:**
   If a user prefers to revert a specific app to its pre-migration state:
   ```bash
   cp backups/apps/<snapshot>/<name>/app.js apps/<name>/app.js
   ```
   > [!NOTE]
   > Restoring `app.js` directly from a snapshot also reverts in-file JSDoc publish metadata headers (`@looker-dashboard-id`, `@created-at`, `@updated-at`, `@toolkit-version`) to the state at the time of the snapshot. If the app was published after the snapshot was taken, restore only the code body or carry the `@looker-dashboard-id` header forward to avoid creating an unintended duplicate dashboard upon next publish.

