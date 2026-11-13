#!/usr/bin/env python3
"""Unpacks upstream Looker Data Apps (.sh + tarball) in a temp dir, strips local CLI/preview bloat, and repackages skills/data-apps/."""
import io, os, re, shutil, sys, tarfile, tempfile, urllib.request
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[4]
ROOT_DIR = Path(os.environ.get("DAB_ROOT_DIR", str(REPO_DIR)))
PREFIX_URL = os.environ.get("DATA_APPS_PREFIX_URL", "https://dl.google.com/looker-data-apps").rstrip("/")
EXTERNAL_SKILL_DIR = ROOT_DIR / "skills" / "data-apps"
PROMPTS_TS = ROOT_DIR / "src" / "antigravityPrompts.ts"

STUDIO_LIT_REF_SECTION_15 = r"""15. **Metric Selector Data App Standards (`date` Timeframe Key, Balanced `@container` KPI Grid, Custom 4-Row PoP KPIs, Card-Border Compare State Machine, Custom `Window:` Popover & PoP Variance Grid):**
    - **LookML `date` Timeframe Key (Never `*_day`)**: Key `PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 }`, `WINDOW_OPTIONS`, and `UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' }` directly by `'date'` (`Period` `Daily` -> `'date'`); forbid `${dateBase}_day` / `*_day`.
    - **Balanced `@container` KPI Card Grid (`4 -> 2x2 -> 1`, Never `3 + 1`)**: Forbid `repeat(auto-fit, ...)` and `repeat(auto-fill, ...)` on KPI card strips. Set `container-type: inline-size` on `.da-container` and step `.da-kpi-grid` explicitly: `grid-template-columns: repeat(4, minmax(0, 1fr))` -> `@container (max-width: 820px) { .da-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }` (`2x2`) -> `@container (max-width: 420px) { .da-kpi-grid { grid-template-columns: 1fr; } }` (`1x4`, never 3 columns; `N = 3`: `3 -> 1`; `N = 6`: `6 -> 3 -> 2 -> 1`).
    - **Custom 4-Row PoP KPI Cards (Forbid `<app-kpi>` on PoP Switcher Cards)**: Remove any `Metric` `<app-select>` dropdown and forbid `"ACTIVE METRIC"` badges or `<app-kpi>` on switcher cards. Query `2 * this.periodCount` periods (`sorts: ["${dateDim} asc"]`, dynamic `limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)))`) on matched lifecycle date groups (`created_*` / `returned_*` / `cancelled_*`), split `prevRows` (first `N`) vs `currRows` (last `N`), and render: (1) uppercase metric label, (2) standalone formatted headline (zero pill beside headline), (3) Row-3 inline flex (`display: flex; align-items: center; gap: 6px; margin-top: 4px`) placing `<span class="kpi-change ${tone}">${pctStr}</span>` directly before `<span>vs. prev ${N} ${UNITS[this.period]}</span>` (`polarity="higher-better|lower-better"`), and (4) `currRows` `<svg>` sparkline.
    - **Secondary KPI Card-Border Compare State Machine (No `"Compare against"` Dropdown), Layered Dual-Date `loadTrendData()` & Shared-When-Close Dual Y-Axis + Top-Right `⋮` Menu**: Delete `<app-select label="Compare against">`; set `--app-chart-2: #34a853;` on `.da-container`, styling Primary (`selectedMetric === key`) with `border: 2px solid var(--app-chart-1, #4285f4)` and Secondary (`compareMetric === key`) with `border: 2px solid var(--app-chart-2, #34a853)`. When `!compareMetric`, regular click selects `selectedMetric = key`, while `Shift+Click` (`e.shiftKey`) or right-click (`@contextmenu`, `e.preventDefault()` -> `Compare`) sets `compareMetric = key`. When `Boolean(compareMetric)`, regular click on `compareMetric` clears `compareMetric = ''`, regular click elsewhere keeps `selectedMetric` locked (`title` hint), and `shiftKey` or `contextmenu` (`Remove comparison`) on `compareMetric` or a 3rd metric clears `compareMetric = ''`. Whenever `this.compareMetric` is set (`m1 = METRICS[this.selectedMetric]`, `m2 = METRICS[this.compareMetric]`), always run two parallel `this.runQuery` trend queries via `Promise.all` in `loadTrendData()` (triggered from `connectedCallback()`, custom `onFiltersChanged()` called from `willUpdate(changed)` after `super.willUpdate(changed)` on `dashboardFilters`/`crossFilters`, `onRefresh()`, and explicit `Period`/`Window`/KPI handlers — never `updated(changed)`, never gated on `m1.dateBase !== m2.dateBase` / `!=`) on `d1 = \`\${m1.dateBase}_\${this.period}\`` and `d2 = \`\${m2.dateBase}_\${this.period}\`` (`filters: this.getEffectiveFilters({ [d]: win })`, `sorts: [\`\${d} asc\`]`, dynamic `limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)))`), initialize/reset `this.trendRows = null` while idle/in-flight (`(this.trendRows || []).map(...)`), key `map1`/`map2` by `String(r[d] ?? '')`, union and sort `periods`, set `this.trendRows = periods.map(p => ({ period: p, [m1.measure]: Number(map1.get(p) ?? 0), [m2.measure]: Number(map2.get(p) ?? 0) }))`, and pass `.data=${this.trendRows}` while omitting `.query`. Default Left `yAxis[0]` = Main Metric and Right `yAxis[1]` (`opposite: true`, `gridLineWidth: 0`) = Comparison Metric with `yAxis.title.text` (`m1.label` / `m2.label`), top-level `colors: ['var(--app-chart-1, #4285f4)', 'var(--app-chart-2, #34a853)']` (never raw `var(...)` in `series[i].color`), and `formatAxisValue` `labels.formatter` on both axes (plus `escapeHtml` + `formatValue` in `tooltip.formatter` when `m1.format !== m2.format`); compute `const shareScale = Boolean(m2 && m1.format === m2.format && max1 > 0 && max2 > 0 && (Math.max(max1, max2) / Math.min(max1, max2) <= 3));`, binding both series to `yAxis: 0` when `shareScale` is `true` (`series[1]` to `yAxis: 1` when `false`) with `yAxis[1]` `{ ...(shareScale ? { linkedTo: 0 } : {}), opposite: true, title: { text: m2.label }, labels: { formatter() { return formatAxisValue(this.value, m2.format); } }, gridLineWidth: 0 }`. Omit `"Longitudinal Trend"` titles, and keep only the top-right **3-dot (`⋮`) action menu** for `Chart Type` (`areaspline`/`line`/`column`/`bar`).
    - **Decoupled `Period` & `Window` Controls, Custom `Window:` Number Popover + Titleless Bottom PoP `<app-grid>`**: Declare `customWindowOpen` (`Boolean`) and `customWindowDraft` (`String`) in `static properties`, and wire separate `Period` and `Window` (`periodCount`) controls via `this.getEffectiveFilters(...)` to **all** widgets. Immediately right of preset `Window:` pills, render an active pill `${this.periodCount} ${UNITS[this.period]}` whenever `!WINDOW_OPTIONS[this.period].includes(this.periodCount)` plus a compact icon button (`this.customWindowOpen`, inline `<svg>` icon with `title="Custom window length"`, seeding `this.customWindowDraft = String(this.periodCount)` on open and closing on `Period`/preset clicks) opening an anchored popover containing `<input type="number" min="1" max="1000" .value=${this.customWindowDraft ?? String(this.periodCount)} @input=${(e) => { this.customWindowDraft = e.target.value; }}>` + `${UNITS[this.period]}` label + `Apply` button (`Enter` submit / `Escape` close -> `this.periodCount = Math.max(1, Math.min(1000, Math.round(Number(this.customWindowDraft) || this.periodCount)))` and `this.customWindowOpen = false`). Omit `title` on `<app-grid>`, provide a `"Dimensions"` multi-select (`this.selectedDimensions`, <= 5 categorical dimensions, `>= 1` active), and join current (`"${N} ${unit}"`) + prior (`"${2 * N} ${unit} ago for ${N} ${unit}"`) queries into `.data` with `<Metric> — This Period`, `<Metric> — Last Period`, and `<Metric> — Variance` (`percent1-signed`) columns for Metric 1 (and Metric 2 when `compareMetric` is active).
"""

def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()

def _scrub_text(txt: str) -> str:
    for a, b in [("dist/skills/data-app-creator/recipes/", "skills/data-apps/recipes/"), ("skills/data-app-creator/", "skills/data-apps/"), ("explore-model.py", "run_looker_codemode")]:
        txt = txt.replace(a, b)
    for a, b in [("the" + "look", "commerce"), ("argolis_" + "scratch", "analytics"), ("default_bigquery_" + "connection", "bq_warehouse"), ("demo" + "west", "prod_instance"), ("looker-private-" + "demo", "corp_dw")]:
        txt = re.sub(re.escape(a), b, txt, flags=re.I)
    return txt

def unpack_and_repackage(source_dir: Path | None = None) -> dict:
    with tempfile.TemporaryDirectory(prefix="dab-data-apps-sync-") as tmp:
        sh_text = ""
        if source_dir is not None:
            payload_dir = source_dir.resolve()
        else:
            version_ptr = _fetch(f"{PREFIX_URL}/latest-version.txt").decode("utf-8").strip()
            sh_text = _fetch(f"{PREFIX_URL}/versions/{version_ptr}/install.sh").decode("utf-8")
            payload_dir = Path(tmp) / "payload"
            payload_dir.mkdir(parents=True, exist_ok=True)
            with tarfile.open(fileobj=io.BytesIO(_fetch(f"{PREFIX_URL}/versions/{version_ptr}/looker-data-apps.tar.gz")), mode="r:gz") as tf:
                tf.extractall(payload_dir, filter="data") if hasattr(tarfile, "data_filter") else tf.extractall(payload_dir)

        sh_ver_m = re.search(r'^VERSION="([^"]+)"', sh_text, re.M)
        ver_file = payload_dir / "VERSION"
        version = (ver_file.read_text(encoding="utf-8").strip() if ver_file.is_file() else "") or (sh_ver_m.group(1) if sh_ver_m else "1.3.0")

        studio_ms_text = next((p.read_text(encoding="utf-8") for p in (EXTERNAL_SKILL_DIR / "recipes/metric-switcher.md", REPO_DIR / "skills/data-apps/recipes/metric-switcher.md") if p.is_file() and "loadTrendData" in p.read_text(encoding="utf-8")), "")

        (EXTERNAL_SKILL_DIR / "reference").mkdir(parents=True, exist_ok=True)
        (EXTERNAL_SKILL_DIR / "recipes").mkdir(parents=True, exist_ok=True)
        (EXTERNAL_SKILL_DIR / "VERSION").write_text(f"{version}\n", encoding="utf-8")

        prompts_txt = PROMPTS_TS.read_text(encoding="utf-8")
        updated_prompts = re.sub(r'DEFAULT_VERSION = "[^"]+"', f'DEFAULT_VERSION = "{version}"', prompts_txt)
        if updated_prompts != prompts_txt:
            PROMPTS_TS.write_text(updated_prompts, encoding="utf-8")
        guide_m = re.search(r"export const DATA_APP_GUIDE_MD = `([\s\S]*?)`\n", updated_prompts)
        if not guide_m:
            raise RuntimeError("Could not extract DATA_APP_GUIDE_MD from src/antigravityPrompts.ts")
        (EXTERNAL_SKILL_DIR / "SKILL.md").write_text(guide_m.group(1).replace("\\`", "`").replace("\\$", "$"), encoding="utf-8")

        src_ref = payload_dir / "skills" / "data-app-creator" / "reference" / "LIT_DATA_APPS.md"
        if src_ref.is_file():
            ref_txt = _scrub_text(src_ref.read_text(encoding="utf-8"))
            if "Metric Selector Data App Standards" not in ref_txt:
                ref_txt = ref_txt.rstrip() + "\n" + STUDIO_LIT_REF_SECTION_15
            (EXTERNAL_SKILL_DIR / "reference" / "LIT_DATA_APPS.md").write_text(ref_txt, encoding="utf-8")

        src_recipes = payload_dir / "skills" / "data-app-creator" / "recipes"
        if src_recipes.is_dir():
            for rf in sorted(src_recipes.glob("*.md")):
                raw = studio_ms_text if (rf.name == "metric-switcher.md" and studio_ms_text) else rf.read_text(encoding="utf-8")
                (EXTERNAL_SKILL_DIR / "recipes" / rf.name).write_text(_scrub_text(raw), encoding="utf-8")

        if (ROOT_DIR / "upstream").exists():
            shutil.rmtree(ROOT_DIR / "upstream")

        return {"version": version, "skill_dir": str(EXTERNAL_SKILL_DIR.relative_to(ROOT_DIR))}

if __name__ == "__main__":
    src_arg = Path(sys.argv[-1].split("=", 1)[-1]) if any(a.startswith("--source-dir") for a in sys.argv[1:]) else None
    res = unpack_and_repackage(src_arg)
    print(f"Synced Looker Data Apps v{res['version']} -> {res['skill_dir']} (local .sh & preview-server stripped)")
