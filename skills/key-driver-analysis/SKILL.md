---
name: key-driver-analysis
description: Run, explain, and recursively drill through Key Driver Analysis (KDA) in Looker via `lkr code-mode sandbox` across any Explore URL/Query ID, Look URL/ID, Dashboard URL/ID, or Conversational Analytics Conversation URL/ID on any unknown LookML data model.
---

# Looker Key Driver Analysis (`run_key_driver_analysis`) Skill

Use this skill whenever asked to run Key Driver Analysis (KDA), explain why a Looker metric changed between two periods or cohorts, analyze drivers behind an Explore, Query, Look, Dashboard, or Conversational Analytics Conversation, or drill deeper into root causes using `lkr code-mode`.

---

## 1. Fast Start (`lkr code-mode sandbox`)

> [!IMPORTANT]
> 1. **Do NOT `read_file` `skills/key-driver-analysis/scripts/kda_toolkit.py`** — its complete API and return schemas are documented below.
> 2. **Single-Pass Execution with `print_kda_summary(out)`**: Prepend `skills/key-driver-analysis/scripts/kda_toolkit.py` to your script, run all targets in **one** `lkr code-mode sandbox -f` call, and call `print_kda_summary(out)` at the end (instead of `print(json.dumps(out))`, which gets double-escaped and truncated above 10 KB). `print_kda_summary(out)` emits a compact ~3.5 KB quote-free summary so `run_command` returns 100% of the results inline in a single turn with zero follow-up `read_file` calls.

```bash
cat skills/key-driver-analysis/scripts/kda_toolkit.py /tmp/kda_job.py > /tmp/run_kda_job.py && lkr --oauth-account=prod-demowest code-mode sandbox -f /tmp/run_kda_job.py
```

### Complete Toolkit API & Return Schemas (`kda_toolkit.py`)

1. **`resolve_source(target) -> dict`**
   - Accepts **any** Explore URL, Query ID/slug, Look URL/ID, Dashboard URL/ID, or Conversation URL/ID.
   - Returns:
     ```python
     {
       "type": "dashboard" | "look" | "conversation" | "explore_query" | "explore" | "query",
       "id": str,
       "title": str,
       "targets": [
         {"title": str, "model": str, "explore": str, "fields": list[str], "filters": dict[str, str], "slug": str}
       ]
     }
     ```

2. **`inspect_explore_for_kda(model_name, explore_name) -> dict`**
   - Dynamically inspects `lookml_model_explore(model_name, explore_name, fields="fields,joins")` on **any unknown model** (cache per `(model, explore)`).
   - Automatically excludes `inner` joins, Liquid `{% parameter %}` views, primary keys/IDs, and leaf SKU/item-name/address fields, ranking macro business dimensions (`status`, `department`, `traffic_source`, `gender`, `country`, `event_type`, `channel`, `segment`, `category`, `browser`, `state`, `brand`) first.
   - Returns:
     ```python
     {
       "additive_measures": list[str], # sum, count, sum_distinct
       "measure_map": dict[str, {"type": str, "sql": str, "view": str, "has_filters": bool}],
       "timeframes": list[str],        # date/time dimensions
       "candidate_dimensions": list[str]
     }
     ```

3. **`analyze_target(target, baseline_filters, breach_filters, explore_info=None, drill=False, sub_timeframe=None, top_k=6) -> dict`**
   - **One-call KDA runner** for any element of `resolve_source(x)["targets"]`:
     - Automatically pads up to 6 `candidate_dimensions`.
     - Automatically decomposes non-additive measures (`average`, `median`, `number` rates/ratios) into their additive numerator & denominator via `decompose_measure(m, info)`.
     - Strips colliding relative timeframe filters from `target["filters"]`.
     - When `drill=True`, automatically runs `drill_top_driver(...)` (Pass 2 Recursive KDA + `breach_sub_trend` + `unit_economics` + `follow_up_questions`).
   - Returns:
     ```python
     {
       "title": str, "model": str, "explore": str, "original_measures": list[str],
       "results": {
         "<additive_measure>": {
           "kda": {
             "status": "SUCCESS", "dimensions": list[str],
             "dropped_null_rows": {"test": int, "control": int},
             "drivers": [
               {
                 "drivers": list[str], # ["all"] or ["dim=val", ...]
                 "archetype": "HEADLINE_TOTAL" | "PRIMARY_ACCELERATOR" | "TIDE_FOLLOWER" | "HIDDEN_DRAG" | "OUTLIER_SURGE" | "COUNTER_TREND_OFFSET",
                 "metric_test": float, "metric_control": float,
                 "difference": float, "relative_difference": float,
                 "unexpected_difference": float, "relative_unexpected_difference": float,
                 "apriori_support": float, "contribution": float, "share_of_total_change": float
               }
             ]
           },
           "drill": { # Present when drill=True
             "locked_driver": dict,
             "pass2_kda": dict,            # Recursive KDA with min_support=0.02
             "breach_sub_trend": list[dict], # Sub-period rows sorted ascending
             "unit_economics": {"control": dict, "test": dict}, # Volume + sum + average/rate
             "follow_up_questions": list[str]
           }
         }
       }
     }
     ```

4. **`print_kda_summary(out) -> None`**
   - Prints a compact, quote-free pipe-delimited summary of a single `analyze_target` dict or a `dict[str, dict | list[dict]]` of multiple `analyze_target` results (`DRV|<slice>|<archetype>|c=...|t=...|diff=...|share=...|unexp=...|sup=...`, plus `DRILL_PASS2`, `TREND`, `UNIT_ECON_CTRL/TEST`, and `Q1..Q3`). Always call `print_kda_summary(out)` instead of `print(json.dumps(out))` so multi-target outputs stay under 4 KB and never trigger `run_command` truncation.

5. **Lower-Level Primitives (when custom dimensions or custom metrics are needed)**:
   - `decompose_measure(measure_name, explore_info) -> list[str]`
   - `run_kda(model_name, explore_name, contribution_metric, dimensions, baseline_filters, breach_filters, base_filters=None, min_support=0.05, top_k=5) -> dict`
   - `drill_top_driver(model_name, explore_name, contribution_metric, pass1_result, drill_dimensions, baseline_filters, breach_filters, base_filters=None, sub_timeframe=None, explore_info=None) -> dict`

### Minimal 15-Line Multi-Source Template
```python
info_cache = {}
def get_info(m, e):
    if (m, e) not in info_cache:
        info_cache[(m, e)] = inspect_explore_for_kda(m, e)
    return info_cache[(m, e)]

base_yr, breach_yr = {"order_items.created_year": "2024"}, {"order_items.created_year": "2025"}
dash = resolve_source("https://demowest.cloud.looker.com/dashboards/thelook::business_pulse")
t_sales = [t for t in dash["targets"] if "Total Sales" in t["title"]][0]
t_aov = [t for t in dash["targets"] if "Average Order Sale Price" in t["title"]][0]

out = {
    "dash_sales": analyze_target(t_sales, base_yr, breach_yr, get_info(t_sales["model"], t_sales["explore"]), drill=True, sub_timeframe="order_items.created_month"),
    "dash_aov": analyze_target(t_aov, base_yr, breach_yr, get_info(t_aov["model"], t_aov["explore"])),
    "look_247": analyze_target(resolve_source("247")["targets"][0], base_yr, breach_yr, get_info("thelook", "order_items")),
    "slug_8CDyM4D": analyze_target(resolve_source("8CDyM4D")["targets"][0], base_yr, breach_yr, get_info("thelook", "order_items")),
    "conv": [analyze_target(t, base_yr, breach_yr, get_info(t["model"], t["explore"])) for t in resolve_source("a96583e4bac8437e8ab32f9b34ed2293")["targets"]],
}
print_kda_summary(out)
```

---

## 2. How `run_key_driver_analysis` Works & Unknown-Model Safeguards

1. **Two Cohort Queries & Power-Set (`2^d`) Evaluation**:
   - Evaluates up to 6 categorical dimensions across Control (`base_filters` $\cup$ `baseline_filters`) and Test (`base_filters` $\cup$ `breach_filters`).
   - Top 60 values per dimension by row frequency in Test are kept distinct; remaining values become `"{dim}_is_other"`.
   - Parent slices (`["A=x"]`) with identical `(metric_test, metric_control, difference, apriori_support)` to a child slice (`["A=x", "B=y"]`) are pruned, as are constant 100%-support columns and multi-way `2+ _is_other` combinations.
   - `run_kda()` calls native `run_key_driver_analysis` (`POST /api/4.0/internal/kda/analyze`) first and automatically falls back to exact BQML-parity calculation when Looker 26.20–26.22 throws HTTP 422 (`undefined method 'status' for KdaResponse::Success`) or HTTP 400 on string query slugs.
2. **Five Automatic Safeguards in `kda_toolkit.py`**:
   - **Non-Additive Measure Decomposition**: Never sum `type: average` or `type: number` rates/ratios across rows. `decompose_measure()` parses LookML `${...}` SQL references to run KDA on the additive numerator (`total_sale_price`, `returned_count`) and denominator (`count`, `users.count`) separately.
   - **Sparse `LEFT JOIN` Null-Row Protection**: KDA drops any row where *any* requested dimension is `None`. `run_kda()` automatically excludes dimensions that are `None` in `>25%` of `test_rows` (e.g., `product_viewed.department` on unfiltered `events`) so sparse joins never silently drop 78% of the dataset.
   - **Timeframe Collision Stripping**: Strips any relative date filter in `base_filters` (`90 days`, `12 months`, `7 days`) when `baseline_filters` or `breach_filters` specifies a timeframe filter.
   - **Macro-First Dimension Ranking**: Excludes leaf SKUs/item names/addresses and ranks macro business dimensions ahead of `yesno` flags.
   - **Adaptive `min_support`**: Uses `min_support=0.05` in Pass 1 and `min_support=0.02` in Pass 2 drill-downs so granular dimensions (`category`, `brand`, `state`) aren't blanked out by native KDA's `0.10` threshold.
   - **Pre-KDA Field Profiling (`profile_fields` in `skills/looker-field-profiler/SKILL.md`)**: When cohort dates or candidate dimensions are unknown, run `profile_fields` first to inspect `stats.spikiness[grain]` (`peak_period`, `trough_period`, `spikiness_ratio`, `cv`) on `datetime` fields to select anomaly windows for `breach_filters` vs. `baseline_filters`, and prune `profile:uuid_or_hash`, `profile:json_payload`, `profile:empty_or_null_only`, and `profile:constant_value` dimensions before calling `run_key_driver_analysis`.

---

## 3. Smart Multi-KDA Strategies for Dashboards & Conversations

When given a **Dashboard** or a multi-turn **Conversation**, run KDA smartly across content:
1. **Headline KPI Sweep**: Run KDA across key additive KPI tiles (`Total Sales`, `Total Orders`, `New Users`) to compare whether top-line movements share the same root driver.
2. **Rate / Average Tile Decomposition**: Pass rate/average tiles (`Average Order Sale Price`, `Return Rate`, `Gross Margin %`) to `analyze_target()` so it runs KDA on both the additive **numerator** and **denominator**, then compare which side drove the rate change.
3. **Cross-Explore Funnel Audit**: When tiles or conversation turns span multiple explores (`events` traffic vs. `order_items` revenue), run parallel KDAs on shared dimensions (`traffic_source`, `country`, `state`, `gender`).
4. **Sequential Conversation Turn Chain**: Run KDA on each turn in `resolve_source(cid)["targets"]`—preserving Turn 2/Turn 3's user filters (e.g., `order_items.status: "Cancelled"`) as `base_filters`.

---

## 4. Explaining KDA Results: Raw `difference` vs. `unexpected_difference`

Always contrast **raw contribution** (`difference = M_t - M_c`) against **peer-adjusted outperformance** (`unexpected_difference`):
- **Rest-of-Business Growth Ratio**: $R_{\text{rest}} = \frac{T_t - M_t}{T_c - M_c}$
- **Expected Test Volume**: $E_t = M_c \times R_{\text{rest}}$
- **Unexpected Difference**: $\text{unexpected\_difference} = M_t - E_t$
- **Relative Unexpected Difference**: $\text{relative\_unexpected\_difference} = \frac{M_t}{E_t} - 1$

| Archetype | Condition | Narrative Interpretation |
| :--- | :--- | :--- |
| **`PRIMARY_ACCELERATOR`** | `difference` and `unexpected_difference` share headline sign, high support | **True Root Driver**: Actively pulled the company average up (or down). Lead your explanation here. |
| **`TIDE_FOLLOWER`** | `abs(relative_unexpected_difference) < 1.5%` | **Passive Passenger**: High raw `contribution` only because the segment is large (`apriori_support`), growing at the same rate as peers. Call this out so the user isn't misled by raw size. |
| **`HIDDEN_DRAG`** | `difference` shares headline sign, but `unexpected_difference` has the **opposite** sign | **Silent Underperformer**: Grew in absolute terms (e.g., `users.gender=Female` grew `+$652.6K` / `+43.7%`), but lagged peer growth (`+46.5%`), costing `-$41.8K` in `unexpected_difference`. Always highlight Hidden Drags. |
| **`OUTLIER_SURGE`** | `apriori_support < 20%` and `abs(relative_unexpected_difference) >= 8%` | **Emerging Pocket / Anomaly**: Smaller segment punching far above its weight in excess growth or decline. |
| **`COUNTER_TREND_OFFSET`** | `difference` has the **opposite** sign of headline change | **Masking Force**: Moved opposite to the overall business, partially masking the headline shift. |

---

## 5. Drilling Through & Asking Follow-Up Questions

When drilling into a top driver (automated via `analyze_target(..., drill=True, sub_timeframe=...)` or `drill_top_driver(...)`):
1. **Pass 2 Recursive KDA (`drill["pass2_kda"]`)**: Locks the #1 Pass 1 driver into `base_filters` and evaluates the next 6 candidate dimensions at `min_support=0.02`.
2. **Sub-Period Trend (`drill["breach_sub_trend"]`)**: Breaks down the locked driver across `_month` or `_week` inside the breach window to distinguish a steady structural trend from a single-period spike or fulfillment pipeline lag.
3. **Unit-Economics Check (`drill["unit_economics"]`)**: Compares Control vs. Test across volume (`count`, `order_count`), total (`sum`), and unit rate (`average_sale_price`, `return_rate`) to prove whether the driver is **volume-driven** or **price/rate-driven**.
4. **3 Falsifiable Follow-Up Questions (`drill["follow_up_questions"]`)**: Conclude with 3 LookML-grounded next questions covering (a) child sub-segment isolation, (b) temporal/status cadence, and (c) unit economics or cross-funnel conversion.
