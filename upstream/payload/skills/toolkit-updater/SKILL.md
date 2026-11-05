---
name: toolkit-updater
description: |
  Check for, report, and perform safe in-place upgrades of the Looker Data Apps devtools
  and runtime, and upgrade individual Lit apps on edit.
  Trigger when checking for updates, upgrading devtools, or upgrading an existing Lit app in `apps/` to the installed runtime. Legacy HTML Canvas Dashboards use `data-app-upgrader`.
---

# Toolkit Updater

This skill defines the authoritative workflow for discovering, reporting, and executing safe in-place upgrades of the Looker Data Apps installation (`~/looker-data-apps`).

---

## Universal Safety Invariants

1. **Nothing destructive happens before the backup completes.** Every devtools upgrade creates a temporary rollback snapshot before modifying files on disk, removed on success. Every app upgrade creates a snapshot of the app before editing.
2. **Nothing moves; backups are copies.** `apps/` is never relocated. Declining an upgrade leaves all files in place and fully functional.
3. **Actions require explicit human confirmation.** Never combine a report and an upgrade into the same turn. Prompt before devtools update, and prompt once before upgrading an app on edit. Once the user confirms a devtools upgrade in Gate 1, Gate 2 completes the upgrade to the latest available release (including across an intermediate distribution host migration if one occurs) without stopping mid-way.
4. **Live published tiles are unaffected.** A published Looker tile imports its runtime bundle directly from `looker-data-apps/versions/<VERSION>/data-app.js`, frozen at publish time. Upgrading local devtools changes nothing in Looker until a dashboard is selectively re-published.

---

## The Update Protocol

```
Gate 1: Version Check & Changelog Report  ──[User says Yes]──►  Gate 2: Devtools Self-Update
                  │
         [User says No / Dismiss]
                  │
                  ▼
            Resume Task
```

The installer never changes apps. Updating devtools replaces the local `runtime/` and devtools (and removes any legacy local `vendor/` directory from 1.2.0 or older, since vendor libraries now load from gstatic). Apps tagged with another version from 1.3.0 on preview on that version from gstatic; untagged apps, apps tagged before 1.3.0, and apps tagged with the installed `VERSION` use the local runtime. Apps are upgraded individually when edited (see **Upgrade One App** below).

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
  2. Summarize only the human-facing sections (`### Added`, `### Changed`, `### Removed`, `### Fixed`) across `(installed_version, latest_version]` in plain English. Do not display `### Upgrade steps for AI agents` or raw `**Breaking**` symbol, attribute, or CSS rename lists to the user. The migration rules are applied later, when an app is upgraded on edit.
  3. **Classify the bump** by comparing `installed_version` with `latest_version`, and say which it is in your report:
     - **patch** (`1.0.0` → `1.0.1`): every published app keeps working.
     - **minor** (`1.0.0` → `1.1.0`) or **major** (`1.0.0` → `2.0.0`): the update replaces the local `runtime/`. Apps tagged with another version from 1.3.0 on preview on that version from gstatic; untagged apps, apps tagged before 1.3.0, and apps tagged with the installed `VERSION` use the local runtime. The installer never changes apps. When an author later edits an app, the agent upgrades that app to the installed runtime before making changes.

     Read this from the version numbers and the changelog's own preamble, which states the contract. Do not infer it from how large the diff looks.
  4. Inform the user of the new version and its human-facing highlights. Existing tagged apps keep previewing on their tagged version until they are edited.
  5. **STOP AND ASK:** Prompt the user if they would like to upgrade devtools in place. **Never execute the upgrade in the same turn as the report.**
  6. **If the user declines:**
     ```bash
     python3 skills/toolkit-updater/tools/check-for-update.py --dismiss <latest_version>
     ```
     Resume the user's primary task.

---

### Gate 2: Devtools Self-Update

When the user explicitly confirms the devtools upgrade:

1. Run the self-update engine (on Windows use `python skills\toolkit-updater\tools\self-update.py`):
   ```bash
   python3 skills/toolkit-updater/tools/self-update.py
   ```
   The command queries the live release pointer and follows any distribution host migration directly to the latest version.
2. The script executes the following automated sequence:
   - Resolves the live `latest-version.txt` pointer first and automatically continues across distribution host migrations (up to 3 hops) inside one rollback snapshot.
   - Takes a temporary rollback snapshot of the toolkit under `backups/` (everything except `apps/`, `backups/`, `.update.lock`, and `.git`).
   - Downloads the target version's installer (`install.py`, or fallback `install.sh`), which replaces the local `runtime/` and devtools (and removes any legacy local `vendor/` directory from 1.2.0 or older, since vendor libraries now load from gstatic).
   - Executes the installer unattended (input from `/dev/null`).
   - Verifies the installed `VERSION` matches the target and checks `runtime/data-app.js` and `preview-server/serve.py`.
   - On error, automatically rolls back from the temporary snapshot.
   - On success, removes the temporary rollback snapshot. Older backups in `backups/` are left untouched.
   - The installer never changes apps in `apps/`. Apps tagged with another version from 1.3.0 on preview on that version from gstatic; untagged apps, apps tagged before 1.3.0, and apps tagged with the installed `VERSION` use the local runtime.
3. **If the script exits non-zero:**
   Report the failure verbatim. Do not retry, and do not claim a rollback happened
   unless the output says so. Several failures happen *before* anything is modified:
   a refusal to run against `/` or `$HOME`, a refusal to run inside a development
   checkout, a missing configuration file, another update already holding
   `.update.lock`, or a failed installer download. In those cases the
   installation was never touched. A rollback only occurs once the script has
   started the installer. If automatic restore fails, the script preserves the
   temporary backup and prints its path. Report that path when it is present.
4. **If the script succeeds:**
   After `self-update.py` succeeds, run `python3 skills/toolkit-updater/tools/check-for-update.py --force` using the newly installed script (and re-read `skills/toolkit-updater/SKILL.md` if the minor or major version changed). If `update_available` is still `true` (for example, when upgrading from an older toolkit whose updater stepped onto an intermediate release that switched download hosts), immediately run `python3 skills/toolkit-updater/tools/self-update.py` again (up to 3 hops total) in the same turn without re-prompting the user. Inform the user once devtools reach the final latest version, summarizing any additional human-facing highlights (`### Added`, `### Changed`, `### Removed`, `### Fixed`) across `(initial_version, final_version]`. Do not paste the raw `CHANGELOG_SECTION_START` .. `CHANGELOG_SECTION_END` block to the user.

**Downgrades and repairs.** The script installs the release only if it is newer
than, or the same as, what is installed. Downgrades to an older version are
refused. Re-running `self-update.py` when already at the latest version
reinstalls that version in place (after taking a temporary rollback snapshot) to
repair an installation that lost files.

---

## Upgrade One App (Upgrade on Edit)

Editing or publishing an app with a missing or older `@toolkit-version` tag is not supported. Published and edited apps always target the installed toolkit.

### Trigger & Prompt

This flow runs when the user asks to change an existing app in `apps/<name>/` whose `@toolkit-version` tag in the top JSDoc is **missing** or **different** from the installed `VERSION`:

- **Tag newer than installed `VERSION`:** Update the toolkit first with Gate 1 using `python3 skills/toolkit-updater/tools/check-for-update.py --force` (a cached check can report up to date).
- **Tag older than installed `VERSION`, or missing:**
  1. **Say upgrading the app is required and ask once:**
     - If tagged: *"App `<name>` is tagged `@toolkit-version <old_version>`, but toolkit `<installed_version>` is installed. Upgrading the app is required before editing. Would you like to upgrade it now?"*
     - If untagged: *"App `<name>` has no `@toolkit-version` tag, and toolkit `<installed_version>` is installed. Upgrading the app to `<installed_version>` is required before editing. Would you like to upgrade it now?"*
  2. **If the user declines:**
     Stop. Do not modify the app.
  3. **If the user approves:**
     Proceed with the upgrade procedure below.

### Upgrade Procedure

1. **Snapshot the app before editing** (on Windows where `python3` is absent or points to the Microsoft Store stub, substitute `python` or `py -3` in all `python3` commands below):
   ```bash
   python3 skills/toolkit-updater/tools/snapshot-app.py apps/<name>
   ```
   This copies the app as is to `backups/apps/<name>-v<tag>-<YYYYMMDD-HHMMSS>/` (`<name>-untagged-<YYYYMMDD-HHMMSS>/` when the app has no tag; for a nested app the name is its path under `apps/` with `/` replaced by `__`).

2. **Migrate code using `CHANGELOG.md`:**
   - **Tag older than installed `VERSION`:** Read all **Breaking** entries (under `### Upgrade steps for AI agents`, and under `### Changed` or `### Removed` in earlier releases) in `(tag, installed_version]` from oldest to newest before editing `apps/<name>/app.js`. Merge and compose chained rules into their final target state (`A -> B` in an earlier version followed by `B -> C` in a later version becomes `A -> C` directly, and intermediate renames of items removed in a later version are skipped; keep an intermediate step only when a later rule depends on it). Apply the composed changes to `apps/<name>/app.js` in a single pass rather than stepping through intermediate versions one by one. A tag older than 1.3.0 can be older than the code, because toolkits before 1.3.0 wrote it only at publish. Applying a Breaking entry the code already follows changes nothing. When `(tag, installed_version]` has no **Breaking** entries, only the `@toolkit-version` tag changes.
   - **No tag:** The app may come from any version since `1.0.0`. Read the whole `CHANGELOG.md` from oldest to newest, compose all **Breaking** entries into their final target state (`A -> C`), and apply them in a single pass.
   - **Older than the oldest changelog entry:** Rewrite the app with `skills/data-app-creator/SKILL.md`, preserving its queries, layout intent, and publish metadata.
   - **Preserve metadata:** Keep all structured JSDoc header tags (`@title`, `@description`, `@looker-dashboard-id`, `@looker-instance`, `@created-at`, `@created-by`, `@updated-at`, `@updated-by`, and legacy `@published-at`, `@published-by`). Do not show raw rename lists to the user unless asked.

3. **Set the tag to the installed `VERSION`:**
   Set `@toolkit-version` in the top JSDoc header of `apps/<name>/app.js`:
   ```javascript
   * @toolkit-version <installed_version>
   ```

4. **Apply the user's requested edit:**
   Make the changes the user asked for in `apps/<name>/app.js`.

5. **Verify the upgraded app:**
   ```bash
   python3 skills/data-app-creator/tools/verify-app.py apps/<name>/app.js
   ```

6. **Side-by-side preview:**
   Share both preview links with the user so they can compare the upgraded app and the pre-upgrade snapshot:
   - **Upgraded app:** `http://localhost:8765/preview-server/?app=apps/<name>/app.js`
   - **Pre-upgrade snapshot:** `http://localhost:8765/preview-server/?app=backups/apps/<snapshot>/app.js`

7. **Restoring from snapshot:**
   If the upgrade needs to be reverted:
   ```bash
   cp backups/apps/<snapshot>/app.js apps/<name>/app.js
   ```
   (On Windows use `copy`.)


