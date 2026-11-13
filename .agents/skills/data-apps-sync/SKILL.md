---
name: data-apps-sync
description: >
  Repository-internal developer skill that unpacks the upstream Looker Data Apps
  `.sh` installer and tarball in a temporary directory, strips all local-preview
  and `.sh` CLI artifacts (`bootstrap.sh`, `preview-server/`, `data-app-previewer`,
  `toolkit-updater`, `check-credentials.py`, `explore-model.py`, `vendor/`), and
  repackages the runtime contract, component reference, and recipes into the
  external Studio skill `skills/data-apps/` used by the app and evals.
---

# Upstream Data Apps Unpacker & External Skill Repackager (`data-apps-sync`)

Use this **repository-internal** skill (never bundled into `SANDBOX_AGENT_SKILL_FILES` or `dist/bundle.js`) whenever syncing or upgrading the upstream Looker Data Apps release (`https://dl.google.com/looker-data-apps`).

## 1. Why This Skill Exists

Looker's standalone Data Apps CLI distribution (`install.sh` -> `versions/<ver>/install.sh` -> `looker-data-apps.tar.gz`) includes local CLI scripts (`bootstrap.sh`, `configs-merger.sh`, `check-credentials.py`, `explore-model.py`), a local HTTP preview server (`preview-server/serve.py` on `localhost:8765`), headless Chrome Stage 4 screenshot checks, and 2.9 MB of local `vendor/` bundles.

In **Looker Data App Studio**, Data Apps are never tested on a local preview server—they are authored in the Antigravity sandbox, verified/bundled via `/workspace/bundle_app.py` (`BUNDLE_APP_PY`), and published directly onto Looker dashboard tiles (`src/dataAppPublisher.ts`).

`data-apps-sync` automates the full conversion on every upstream update (`npm run sync-upstream` and `.github/workflows/update-skills.yml`):
1. **Unpacks & Understands Upstream (`.sh` + tarball)** in a temporary directory (`tempfile.TemporaryDirectory()`):
   - Reads `latest-version.txt` and `versions/<VERSION>/install.sh` to extract `VERSION` (e.g. `1.2.0`) and the canonical CDN base (`https://www.gstatic.com/looker-data-apps/versions/<VERSION>`).
   - Verifies exported runtime symbols in `runtime/data-app.js` (`LookerDataApp`, `DataApp`, `html`, `nothing`, `keyed`, `formatValue`, `formatAxisValue`, `escapeHtml`, `create*Col`).
2. **Strips Local-Only `.sh` Scripts & Preview Server**:
   - Discards `install.sh`, `version-install.sh`, `scripts/bootstrap.sh`, `scripts/configs-merger.sh`, `scripts/verify-install.py`, `Makefile`, `preview-server/`, `skills/data-app-previewer/`, `skills/toolkit-updater/`, `skills/data-app-publisher/`, `skills/data-app-upgrader/`, `check-credentials.py`, `explore-model.py`, `config.example.json`, `vendor/`, and `runtime/`.
3. **Repackages into External Skill `skills/data-apps/`**:
   - `skills/data-apps/VERSION`: Pinned upstream runtime version (`1.2.0`), synced to `DEFAULT_VERSION` in `src/antigravityPrompts.ts`.
   - `skills/data-apps/SKILL.md`: Studio's canonical Data Apps skill (byte-identical to `DATA_APP_GUIDE_MD` in `src/antigravityPrompts.ts`, mounted at `/workspace/skills/data-apps/SKILL.md` in the sandbox and used by evals).
   - `skills/data-apps/reference/LIT_DATA_APPS.md`: Component reference sanitized of local CLI references and forbidden dataset names, with Studio's Metric Selector & PoP KPI contract (`#15`).
   - `skills/data-apps/recipes/*.md`: Sanitized pattern recipes including Studio's layered dual-date `Promise.all` + `shareScale` (`linkedTo: 0`) `metric-switcher.md`.

## 2. Running the Unpack & Repackage Sync

```bash
# Fetch latest upstream release from https://dl.google.com/looker-data-apps and repackage into skills/data-apps/:
npm run sync-upstream

# Or invoke the Python unpacker directly (supports --source-dir for offline unpacked payloads):
python3 .agents/skills/data-apps-sync/scripts/sync_data_apps.py
python3 .agents/skills/data-apps-sync/scripts/sync_data_apps.py --source-dir /path/to/unpacked/payload
```
