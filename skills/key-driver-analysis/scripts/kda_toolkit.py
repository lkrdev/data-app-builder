import json

TIME_SUFFIXES = ("_date", "_time", "_year", "_month", "_quarter", "_week", "_day", "_raw", "_hour", "_minute", "_fiscal_year", "_fiscal_quarter")
MACRO_TOKENS = ("status", "department", "traffic_source", "gender", "country", "event_type", "channel", "segment", "category", "browser", "state", "brand")


def _is_time_field(field_name):
    return any(field_name.endswith(suf) for suf in TIME_SUFFIXES)


def resolve_source(target):
    """Resolve an Explore URL/query_id/slug, Look URL/id, Dashboard URL/id, or Conversation URL/id into normalized KDA targets."""
    s = str(target).strip()
    url_params = {}
    if "?" in s:
        base_s, _, qs = s.partition("?")
        for kv in qs.split("&"):
            if "=" in kv:
                k, v = kv.split("=", 1)
                url_params[k] = v.replace("+", " ").replace("%20", " ")
    else:
        base_s = s

    # 1. Dashboard URL or LookML/UDD ID
    if "/dashboards/" in base_s or "/dashboards-next/" in base_s or ("::" in base_s and "/explore/" not in base_s):
        did = [p for p in base_s.split("/") if p][-1].replace("%3A%3A", "::") if "/" in base_s else base_s
        d = dashboard(did)
        df_vals = {df["name"]: df.get("default_value") for df in (d.get("dashboard_filters") or []) if df.get("default_value")}
        df_vals.update(url_params)
        tiles = []
        for e in d.get("dashboard_elements") or []:
            rm = e.get("result_maker") or {}
            q = e.get("query") or rm.get("query")
            if not q or not q.get("model") or not q.get("view"):
                continue
            tf = dict(q.get("filters") or {})
            for flt in rm.get("filterables") or []:
                for lsn in flt.get("listen") or []:
                    fn, fld = lsn.get("dashboard_filter_name"), lsn.get("field")
                    if fn in df_vals and fld and df_vals[fn]:
                        tf[fld] = df_vals[fn]
            tiles.append({
                "title": e.get("title") or e.get("id"),
                "model": q["model"],
                "explore": q["view"],
                "fields": q.get("fields") or [],
                "filters": tf,
                "slug": q.get("slug") or q.get("id"),
            })
        return {"type": "dashboard", "id": did, "title": d.get("title"), "targets": tiles}

    # 2. Look URL or ID
    if "/looks/" in base_s or s.isdigit():
        lid = [p for p in base_s.split("/") if p][-1]
        lk = look(lid)
        q = lk.get("query") or query(lk["query_id"])
        tf = dict(q.get("filters") or {})
        for k, v in url_params.items():
            if k.startswith("f[") and k.endswith("]"):
                tf[k[2:-1]] = v
        return {"type": "look", "id": str(lk["id"]), "title": lk.get("title"), "targets": [{
            "title": lk.get("title"),
            "model": q["model"],
            "explore": q["view"],
            "fields": q.get("fields") or [],
            "filters": tf,
            "slug": q.get("slug") or q.get("id"),
        }]}

    # 3. Conversation URL or ID (32-char hex UUID)
    clean_id = [p for p in base_s.split("/") if p][-1]
    if "/conversations/" in base_s or "/ca/" in base_s or (len(clean_id) == 32 and all(c in "0123456789abcdef" for c in clean_id.lower())):
        c = get_conversation(clean_id)
        msgs = all_conversation_messages(clean_id)
        turns, cur_q = [], None
        for m in msgs:
            msg = m.get("message") or {}
            if m.get("type") == "user":
                cur_q = (msg.get("userMessage") or {}).get("text")
            gq = ((msg.get("systemMessage") or {}).get("data") or {}).get("generatedLookerQuery")
            if gq and gq.get("model") and gq.get("explore"):
                flts = {fi["field"]: fi.get("value", "") for fi in (gq.get("filters") or []) if isinstance(fi, dict) and "field" in fi}
                turns.append({
                    "title": cur_q or f"Turn {len(turns) + 1}",
                    "model": gq["model"],
                    "explore": gq["explore"],
                    "fields": gq.get("fields") or [],
                    "filters": flts,
                })
        if not turns and c.get("sources"):
            src = c["sources"][0]
            turns.append({"title": c.get("name") or "Conversation", "model": src["model"], "explore": src["explore"], "fields": [], "filters": {}})
        return {"type": "conversation", "id": clean_id, "title": c.get("name"), "targets": turns}

    # 4. Explore URL or Query Slug
    if "/explore/" in base_s:
        after = base_s.split("/explore/", 1)[1]
        parts = [p for p in after.split("/") if p]
        model_name, explore_name = parts[0], parts[1]
        if "qid" in url_params:
            q = query_for_slug(url_params["qid"])
            return {"type": "explore_query", "id": url_params["qid"], "title": f"{q['model']}::{q['view']}", "targets": [{
                "title": f"{q['model']}::{q['view']} ({url_params['qid']})",
                "model": q["model"],
                "explore": q["view"],
                "fields": q.get("fields") or [],
                "filters": q.get("filters") or {},
            }]}
        fields = [f for f in url_params.get("fields", "").split(",") if f]
        flts = {k[2:-1]: v for k, v in url_params.items() if k.startswith("f[") and k.endswith("]")}
        return {"type": "explore", "id": f"{model_name}::{explore_name}", "title": f"{model_name}::{explore_name}", "targets": [{
            "title": f"{model_name}::{explore_name}",
            "model": model_name,
            "explore": explore_name,
            "fields": fields,
            "filters": flts,
        }]}

    q = query_for_slug(clean_id)
    return {"type": "query", "id": clean_id, "title": f"{q['model']}::{q['view']}", "targets": [{
        "title": f"{q['model']}::{q['view']} ({clean_id})",
        "model": q["model"],
        "explore": q["view"],
        "fields": q.get("fields") or [],
        "filters": q.get("filters") or {},
    }]}


def inspect_explore_for_kda(model_name, explore_name):
    """Discover additive measures, rate decompositions, timeframes, and ranked categorical driver dimensions on any unknown model."""
    exp = lookml_model_explore(model_name, explore_name, fields="fields,joins")
    flds = exp.get("fields") or {}
    dims = flds.get("dimensions") or []
    meas = flds.get("measures") or []
    inner_joins = {j.get("name") for j in (exp.get("joins") or []) if j.get("type") == "inner"}
    bad_views = inner_joins | {d.get("view") for d in dims if "{%" in (d.get("sql") or "")}

    additive_types = {"sum", "count", "sum_distinct"}
    additive_measures = [m["name"] for m in meas if not m.get("hidden") and m.get("type") in additive_types and m.get("view") not in bad_views]
    measure_map = {m["name"]: {"type": m.get("type"), "sql": m.get("sql") or "", "view": m.get("view"), "has_filters": bool(m.get("filters"))} for m in meas}

    timeframes = [d["name"] for d in dims if d.get("is_timeframe") or str(d.get("type") or "").startswith("date_")]
    macro_dims, other_str, yesno_dims = [], [], []
    for d in dims:
        name = d["name"]
        dtype = d.get("type") or ""
        if d.get("hidden") or d.get("primary_key") or d.get("is_timeframe") or dtype.startswith("date") or d.get("view") in bad_views:
            continue
        if dtype in ("location", "zipcode", "distance", "number"):
            continue
        low = name.lower()
        if low.endswith((".id", "_id", "_pk", ".pk", "_url", "_image", "_email", ".email", ".name", "_name", ".ip", "_ssn", "_tier", "_sequence_number", ".sku", "_sku", "_address", ".uri")):
            continue
        if any(tok in low for tok in ("reporting_period", "ytd", "mtd", "wtd", "months_since", "days_since", "days_to_", "days_between", "first_order", "latest_order", "latitude", "longitude", "postal")):
            continue
        if dtype == "yesno":
            yesno_dims.append(name)
        elif any(low.endswith("." + tok) or low.endswith("_" + tok) for tok in MACRO_TOKENS):
            macro_dims.append(name)
        else:
            other_str.append(name)

    def _mrank(x):
        low = x.lower()
        for idx, tok in enumerate(MACRO_TOKENS):
            if low.endswith("." + tok) or low.endswith("_" + tok):
                return (0 if x.startswith(explore_name + ".") else 1, idx)
        return (2, 99)

    macro_dims.sort(key=_mrank)
    return {
        "additive_measures": additive_measures,
        "measure_map": measure_map,
        "timeframes": timeframes,
        "candidate_dimensions": macro_dims + other_str + yesno_dims,
    }


def decompose_measure(measure_name, explore_info):
    """Return additive KDA measures for a given measure (decomposing averages/rates into numerator & denominator)."""
    mmap = explore_info.get("measure_map") or {}
    m = mmap.get(measure_name)
    if not m:
        return [measure_name]
    mtype, sql, view = m.get("type"), m.get("sql") or "", m.get("view") or ""
    if mtype in ("sum", "count", "sum_distinct"):
        return [measure_name]
    if mtype in ("average", "average_distinct", "median"):
        unfiltered = [k for k, v in mmap.items() if v.get("view") == view and v.get("type") in ("sum", "sum_distinct") and v.get("sql") == sql and not v.get("has_filters")]
        any_sum = unfiltered or [k for k, v in mmap.items() if v.get("view") == view and v.get("type") in ("sum", "sum_distinct") and v.get("sql") == sql]
        den = [f"{view}.count"] if f"{view}.count" in mmap else []
        return (any_sum + den) or [measure_name]
    if mtype == "number":
        refs = []
        for part in sql.split("${")[1:]:
            if "}" in part:
                tok = part.split("}", 1)[0].strip()
                qual = tok if "." in tok else f"{view}.{tok}"
                if qual in mmap and qual not in refs:
                    refs.append(qual)
        if refs:
            return refs
    return [measure_name]


def run_kda(model_name, explore_name, contribution_metric, dimensions, baseline_filters, breach_filters, base_filters=None, min_support=0.05, top_k=5):
    """Execute KDA via native run_key_driver_analysis with automatic timeframe-collision stripping, sparse-join protection, BQML-parity fallback, and driver archetype tagging."""
    base = dict(base_filters or {})
    if any(_is_time_field(k) for k in list(baseline_filters or {}) + list(breach_filters or {})):
        base = {k: v for k, v in base.items() if not _is_time_field(k)}

    dims = list(dimensions)[:6]
    if min_support == 0.1 and top_k == 5:
        try:
            res = run_key_driver_analysis(body={
                "data_source": {"model_name": model_name, "explore_name": explore_name},
                "contribution_metric": contribution_metric,
                "dimensions": dims,
                "base_filters": base,
                "baseline_filters": baseline_filters,
                "breach_filters": breach_filters,
            })
            if res and res.get("drivers") is not None:
                return res
        except Exception:
            pass

    # ponytail: BQML-parity fallback for Looker 26.20-26.22 KdaResponse::Success.status 422 bug and custom min_support/top_k
    fields = list(dict.fromkeys(dims + [contribution_metric]))
    ctrl_f = dict(base)
    ctrl_f.update(baseline_filters or {})
    test_f = dict(base)
    test_f.update(breach_filters or {})

    ctrl_raw = run_inline_query("json", {"model": model_name, "view": explore_name, "fields": fields, "filters": ctrl_f, "limit": "50000"})
    test_raw = run_inline_query("json", {"model": model_name, "view": explore_name, "fields": fields, "filters": test_f, "limit": "50000"})
    ctrl_rows = json.loads(ctrl_raw) if isinstance(ctrl_raw, str) else (ctrl_raw or [])
    test_rows = json.loads(test_raw) if isinstance(test_raw, str) else (test_raw or [])
    if not ctrl_rows or not test_rows:
        return {"status": "FAILED", "dimensions": dims, "drivers": [], "error": "Empty baseline or breach cohort"}

    min_non_null = 0.75 * len(test_rows)
    kept_dims = [d for d in dims if sum(1 for r in test_rows if r.get(d) is not None) >= min_non_null]
    if not kept_dims:
        kept_dims = [d for d in dims if any(r.get(d) is not None for r in test_rows) or any(r.get(d) is not None for r in ctrl_rows)]
    if not kept_dims:
        return {"status": "FAILED", "dimensions": dims, "drivers": [], "error": "All dimensions null"}

    allowed = {}
    for d in kept_dims:
        counts = {}
        for r in test_rows:
            v = r.get(d)
            if v is not None:
                sv = str(v)
                counts[sv] = counts.get(sv, 0) + 1
        allowed[d] = set(k for k, _ in sorted(counts.items(), key=lambda x: x[1], reverse=True)[:60])

    def prep(rows):
        out, tot, dropped = [], 0.0, 0
        for r in rows:
            if any(r.get(d) is None for d in kept_dims):
                dropped += 1
                continue
            vals = [str(r.get(d)) if str(r.get(d)) in allowed[d] else "__OTHER__" for d in kept_dims]
            m = float(r.get(contribution_metric) or 0.0)
            out.append((vals, m))
            tot += m
        return out, tot, dropped

    test_cohort, tot_test, drop_test = prep(test_rows)
    ctrl_cohort, tot_ctrl, drop_ctrl = prep(ctrl_rows)
    if tot_test <= 0 and tot_ctrl <= 0:
        return {"status": "FAILED", "dimensions": kept_dims, "drivers": [], "error": "Total volume <= 0"}

    overall_diff = tot_test - tot_ctrl
    n = len(kept_dims)
    raw_insights = []
    for mask in range(1 << n):
        idxs = [i for i in range(n) if (mask >> i) & 1]
        agg = {}
        for vals, m in test_cohort:
            k = tuple(vals[i] for i in idxs)
            cur = agg.get(k)
            if cur is None:
                agg[k] = [m, 0.0]
            else:
                cur[0] += m
        for vals, m in ctrl_cohort:
            k = tuple(vals[i] for i in idxs)
            cur = agg.get(k)
            if cur is None:
                agg[k] = [0.0, m]
            else:
                cur[1] += m
        for k, (mt, mc) in agg.items():
            if sum(1 for v in k if v == "__OTHER__") > 1:
                continue
            sup = max(mt / tot_test if tot_test else 0.0, mc / tot_ctrl if tot_ctrl else 0.0)
            if sup < min_support:
                continue
            diff = mt - mc
            rel_diff = (diff / mc) if mc != 0.0 else None
            t_rest, c_rest = tot_test - mt, tot_ctrl - mc
            if idxs and t_rest == 0.0 and c_rest == 0.0:
                continue
            if t_rest == 0.0 and c_rest == 0.0:
                unexp, rel_unexp = diff, rel_diff
            elif c_rest == 0.0:
                unexp, rel_unexp = None, None
            else:
                unexp = mt - (mc * (t_rest / c_rest))
                rel_unexp = ((mt / t_rest) * (c_rest / mc) - 1.0) if (t_rest != 0.0 and mc != 0.0) else None
            drv = ["all"] if not idxs else [f"{d}_is_other" if v == "__OTHER__" else f"{d}={v}" for d, v in sorted((kept_dims[idxs[j]], k[j]) for j in range(len(idxs)))]

            if drv == ["all"]:
                archetype = "HEADLINE_TOTAL"
            elif overall_diff != 0 and (diff * overall_diff) < 0:
                archetype = "COUNTER_TREND_OFFSET"
            elif rel_unexp is not None and abs(rel_unexp) < 0.015:
                archetype = "TIDE_FOLLOWER"
            elif unexp is not None and overall_diff != 0 and (unexp * overall_diff) < 0:
                archetype = "HIDDEN_DRAG"
            elif sup < 0.20 and rel_unexp is not None and abs(rel_unexp) >= 0.08:
                archetype = "OUTLIER_SURGE"
            else:
                archetype = "PRIMARY_ACCELERATOR"

            raw_insights.append({
                "drivers": drv,
                "archetype": archetype,
                "metric_test": round(mt, 2),
                "metric_control": round(mc, 2),
                "difference": round(diff, 2),
                "relative_difference": round(rel_diff, 4) if rel_diff is not None else None,
                "unexpected_difference": round(unexp, 2) if unexp is not None else None,
                "relative_unexpected_difference": round(rel_unexp, 4) if rel_unexp is not None else None,
                "apriori_support": round(sup, 4),
                "contribution": round(abs(diff), 2),
                "share_of_total_change": round(diff / overall_diff, 4) if overall_diff != 0 else None,
            })

    groups = {}
    for ins in raw_insights:
        fp = (ins["metric_test"], ins["metric_control"], ins["difference"], ins["apriori_support"])
        groups.setdefault(fp, []).append(ins)

    pruned = []
    for grp in groups.values():
        if len(grp) == 1:
            pruned.append(grp[0])
            continue
        grp_sorted = sorted(grp, key=lambda x: len(x["drivers"]))
        for i, cur in enumerate(grp_sorted):
            if cur["drivers"] == ["all"] or not any(len(cur["drivers"]) < len(o["drivers"]) and set(cur["drivers"]).issubset(set(o["drivers"])) for o in grp_sorted[i + 1:]):
                pruned.append(cur)

    pruned.sort(key=lambda x: x["contribution"], reverse=True)
    return {
        "status": "SUCCESS",
        "dimensions": kept_dims,
        "dropped_null_rows": {"test": drop_test, "control": drop_ctrl},
        "drivers": pruned[:top_k] if top_k else pruned,
    }


def drill_top_driver(model_name, explore_name, contribution_metric, pass1_result, drill_dimensions, baseline_filters, breach_filters, base_filters=None, sub_timeframe=None, explore_info=None):
    """Drill into the #1 non-'all' driver from pass1_result using Recursive KDA (Pass 2), sub-period trend, and unit-economics verification."""
    top_drv = None
    for d in pass1_result.get("drivers") or []:
        if d["drivers"] != ["all"] and not any(x.endswith("_is_other") for x in d["drivers"]):
            top_drv = d
            break
    if not top_drv:
        return {"status": "NO_DRILLABLE_DRIVER"}

    drill_base = dict(base_filters or {})
    if any(_is_time_field(k) for k in list(baseline_filters or {}) + list(breach_filters or {})):
        drill_base = {k: v for k, v in drill_base.items() if not _is_time_field(k)}

    locked_dims = []
    for item in top_drv["drivers"]:
        if "=" in item:
            k, v = item.split("=", 1)
            drill_base[k] = v
            locked_dims.append(k)

    next_dims = [d for d in drill_dimensions if d not in locked_dims][:6]
    pass2 = run_kda(
        model_name, explore_name, contribution_metric, next_dims,
        baseline_filters, breach_filters, base_filters=drill_base,
        min_support=0.02, top_k=5
    )

    trend_rows = []
    if sub_timeframe:
        tf = dict(drill_base)
        tf.update(breach_filters or {})
        raw = run_inline_query("json", {
            "model": model_name, "view": explore_name,
            "fields": [sub_timeframe, contribution_metric],
            "filters": tf, "sorts": [f"{sub_timeframe} asc"], "limit": "50"
        })
        trend_rows = json.loads(raw) if isinstance(raw, str) else (raw or [])

    # Automatic unit-economics check (count + contribution_metric + average/rate on same view)
    v_prefix = contribution_metric.split(".", 1)[0] + "."
    ue_fields = [contribution_metric]
    if explore_info:
        mmap = explore_info.get("measure_map") or {}
        cm_sql = (mmap.get(contribution_metric) or {}).get("sql")
        same_avg = [k for k, mv in mmap.items() if k.startswith(v_prefix) and mv.get("type") == "average" and cm_sql and mv.get("sql") == cm_sql]
        other_avg = [k for k, mv in mmap.items() if k.startswith(v_prefix) and mv.get("type") in ("average", "number") and k not in same_avg]
        for cand in [f"{v_prefix}count", f"{v_prefix}order_count"] + (same_avg + other_avg)[:2]:
            if cand in mmap and cand not in ue_fields:
                ue_fields.append(cand)
    cf, bf = dict(drill_base), dict(drill_base)
    cf.update(baseline_filters or {})
    bf.update(breach_filters or {})
    ue_ctrl = json.loads(run_inline_query("json", {"model": model_name, "view": explore_name, "fields": ue_fields, "filters": cf, "limit": "1"}))
    ue_test = json.loads(run_inline_query("json", {"model": model_name, "view": explore_name, "fields": ue_fields, "filters": bf, "limit": "1"}))

    drv_str = " & ".join(top_drv["drivers"])
    arch = top_drv.get("archetype")
    rate_fld = (same_avg or other_avg or [ue_fields[-1]])[0] if explore_info else ue_fields[-1]
    questions = [
        f"Within `{drv_str}` ({arch}), which specific sub-segment in `{', '.join(next_dims[:3])}` explains the `{top_drv.get('unexpected_difference')}` unexpected variance vs the rest of the business?",
        f"Did the change in `{drv_str}` occur evenly across `{sub_timeframe or 'the breach window'}` or spike in a single sub-period?",
        f"Is `{drv_str}` driven by volume (`{ue_fields[1] if len(ue_fields) > 1 else 'count'}`) or unit economics (`{rate_fld}`)?",
    ]
    return {
        "locked_driver": top_drv,
        "pass2_kda": pass2,
        "breach_sub_trend": trend_rows[:12],
        "unit_economics": {"control": ue_ctrl[0] if ue_ctrl else {}, "test": ue_test[0] if ue_test else {}},
        "follow_up_questions": questions,
    }


def analyze_target(target, baseline_filters, breach_filters, explore_info=None, drill=False, sub_timeframe=None, top_k=6):
    """One-call KDA runner for a resolved target dict: auto-discovers dimensions, decomposes non-additive measures, and optionally drills into the #1 driver."""
    model_name, explore_name = target["model"], target["explore"]
    info = explore_info or inspect_explore_for_kda(model_name, explore_name)
    mmap, tframes, flts = info["measure_map"], set(info["timeframes"]), target.get("filters") or {}
    q_fields = target.get("fields") or []
    measures = [f for f in q_fields if f in mmap] or info["additive_measures"][:1]
    q_dims = [f for f in q_fields if f not in mmap and f not in tframes and not _is_time_field(f)]
    dims = [d for d in dict.fromkeys(q_dims + info["candidate_dimensions"]) if d not in flts][:6]

    runs = {}
    for m in measures:
        for comp in decompose_measure(m, info):
            if comp not in runs:
                kda_res = run_kda(model_name, explore_name, comp, dims, baseline_filters, breach_filters, base_filters=target.get("filters"), top_k=top_k)
                entry = {"kda": kda_res}
                if drill and kda_res.get("status") == "SUCCESS":
                    entry["drill"] = drill_top_driver(model_name, explore_name, comp, kda_res, info["candidate_dimensions"], baseline_filters, breach_filters, base_filters=target.get("filters"), sub_timeframe=sub_timeframe, explore_info=info)
                runs[comp] = entry
    return {"title": target.get("title"), "model": model_name, "explore": explore_name, "original_measures": measures, "results": runs}


def _fmt_pct(v):
    return f"{round(v * 100, 2)}%" if v is not None else "n/a"


def _print_drv_block(kda_obj, prefix="  "):
    for d in kda_obj.get("drivers") or []:
        slc = " & ".join(d["drivers"])
        print(f"{prefix}DRV|{slc}|{d.get('archetype')}|c={d['metric_control']}|t={d['metric_test']}|diff={d['difference']}({_fmt_pct(d.get('relative_difference'))})|share={_fmt_pct(d.get('share_of_total_change'))}|unexp={d.get('unexpected_difference')}({_fmt_pct(d.get('relative_unexpected_difference'))})|sup={_fmt_pct(d.get('apriori_support'))}")


def print_kda_summary(out):
    """Print a compact, quote-free pipe-delimited summary of analyze_target result(s) so multi-KDA runs never exceed stdout limits."""
    items = list(out.items()) if isinstance(out, dict) and "results" not in out else [("target", out)]
    for key, val in items:
        seq = val if isinstance(val, list) else [val]
        for idx, tgt in enumerate(seq):
            if not isinstance(tgt, dict) or "results" not in tgt:
                continue
            print(f"=== {key}[{idx}] {tgt.get('title')} ({tgt.get('model')}::{tgt.get('explore')}) orig={tgt.get('original_measures')} ===")
            for m, res in (tgt.get("results") or {}).items():
                kda = res.get("kda") or {}
                print(f"METRIC|{m}|status={kda.get('status')}|dims={','.join(kda.get('dimensions') or [])}|null_drop={kda.get('dropped_null_rows')}")
                _print_drv_block(kda, "  ")
                dr = res.get("drill")
                if dr and dr.get("pass2_kda"):
                    ld = dr.get("locked_driver") or {}
                    print(f"  DRILL_PASS2|locked={' & '.join(ld.get('drivers') or [])}|dims={','.join(dr['pass2_kda'].get('dimensions') or [])}")
                    _print_drv_block(dr["pass2_kda"], "    ")
                    if dr.get("breach_sub_trend"):
                        tr_str = "; ".join([f"{list(r.values())[0]}:{round(float(list(r.values())[1] or 0), 2)}" for r in dr["breach_sub_trend"]])
                        print(f"  TREND|{tr_str}")
                    if dr.get("unit_economics"):
                        ue = dr["unit_economics"]
                        c_str = ", ".join([f"{k}={round(float(v or 0), 2)}" for k, v in (ue.get("control") or {}).items()])
                        t_str = ", ".join([f"{k}={round(float(v or 0), 2)}" for k, v in (ue.get("test") or {}).items()])
                        print(f"  UNIT_ECON_CTRL|{c_str}")
                        print(f"  UNIT_ECON_TEST|{t_str}")
                    for q_idx, q_txt in enumerate(dr.get("follow_up_questions") or []):
                        print(f"  Q{q_idx + 1}|{q_txt}")

