import { NativeContentState } from './lookerApi'
import { LKR_DEV_CLI_SPEC, LKR_DEV_CLI_VERSION } from './lookmlTool'
export { LKR_CLI_SITECUSTOMIZE_PY } from './lookmlTool'

export const DASHBOARD_CODEMODE_PREAMBLE_PY = `# ponytail: pre-injected Monty Python macros for UDDs, LookML Dashboards (.dashboard.lookml), Looks, Boards & Schedules
import json

try: dashboard_layouts = dashboard_dashboard_layouts
except Exception: pass
try: _active = active_content or {}
except Exception: _active = {}
try: _t_model = target_model or ""
except Exception: _t_model = ""
try: _t_explore = target_explore or ""
except Exception: _t_explore = ""
try: _t_folder_id = target_folder_id or ""
except Exception: _t_folder_id = ""
try: _t_project_id = target_project_id or ""
except Exception: _t_project_id = ""
try: _t_explores = list(target_explores or [])
except Exception: _t_explores = []
try: _cached_schemas = dict(cached_explore_schemas or {})
except Exception: _cached_schemas = {}
_qcache = dict(_active.get("query_cache") or _active.get("queryCache") or {})
_fcache = dict(_active.get("filter_cache") or _active.get("filterCache") or {})

def _canonical_qkey(q):
    return json.dumps({"model": q.get("model"), "view": q.get("view") or q.get("explore"), "fields": list(q.get("fields") or []), "filters": dict(q.get("filters") or {}), "sorts": list(q.get("sorts") or []), "pivots": list(q.get("pivots") or []), "limit": str(q.get("limit") or "500"), "vis_config": dict(q.get("vis_config") or {})}, sort_keys=True)

def _norm_box(spec, idx=0):
    default_boxes = [(0, 0, 8, 4), (0, 8, 8, 4), (0, 16, 8, 4), (4, 0, 12, 8), (4, 12, 12, 8), (12, 0, 24, 8)]
    dr, dc, dw, dh = default_boxes[idx] if idx < len(default_boxes) else (12 + ((idx - 6) // 2) * 8, ((idx - 6) % 2) * 12, 12, 8)
    r, c = max(0, int(spec.get("row", dr))), min(23, max(0, int(spec.get("col", spec.get("column", dc)))))
    return {"row": r, "col": c, "column": c, "width": min(24 - c, max(1, int(spec.get("width", dw)))), "height": max(2, int(spec.get("height", dh)))}

def reflow_24col(dashboard_id, boxes, layout_id=None, comp_map=None):
    did = str(dashboard_id)
    cmap = dict(comp_map or _active.get("layout_component_ids") or _active.get("layoutComponentIds") or {})
    lid = str(layout_id or _active.get("layout_id") or _active.get("layoutId") or "")
    if not cmap or not lid:
        layouts = dashboard_dashboard_layouts(did)
        lay = layouts[0] if isinstance(layouts, list) and len(layouts) > 0 else (layouts if isinstance(layouts, dict) else {})
        lid = str(lay.get("id") or "")
        for c in (lay.get("dashboard_layout_components") or []):
            if c.get("dashboard_element_id") and c.get("id"): cmap[str(c["dashboard_element_id"])] = str(c["id"])
    for idx, b in enumerate(boxes or []):
        eid = str(b.get("element_id") or b.get("dashboard_element_id") or "")
        cid = str(b.get("component_id") or cmap.get(eid) or "")
        if cid and lid:
            nb = _norm_box(b, idx)
            update_dashboard_layout_component(cid, {"dashboard_layout_id": lid, "dashboard_element_id": eid, "row": nb["row"], "column": nb["column"], "width": nb["width"], "height": nb["height"]})
    return {"layout_id": lid, "layout_component_ids": cmap}

_exp_field_cache = {}

def _re_perm(e):
    if "PermissionError" in str(e): raise e

def _valid_explore_fields(tm, te):
    key = f"{tm}::{te}"
    if key in _exp_field_cache: return _exp_field_cache[key]
    dims, meas, flts, prms = [], [], [], []
    if tm and te:
        try:
            exp = lookml_model_explore(tm, te, fields="fields(dimensions(name),measures(name),filters(name),parameters(name))") or {}
            ef = exp.get("fields") if isinstance(exp, dict) else {}
            if isinstance(ef, dict):
                dims, meas, flts, prms = [[str(x["name"]) for x in (ef.get(k) or []) if isinstance(x, dict) and x.get("name")] for k in ("dimensions", "measures", "filters", "parameters")]
        except Exception: pass
    res = {"all": set(dims + meas + flts + prms), "dims": dims, "meas": meas}
    _exp_field_cache[key] = res
    return res

def _check_dashboard_fields(default_model, default_explore, filters=None, tiles=None):
    missing, probe_by_exp, probe_flts, f_dv_by_name = {}, {}, {}, {}
    for f in (filters or []):
        if not isinstance(f, dict): continue
        fm, fe = str(f.get("model") or default_model or ""), str(f.get("explore") or default_explore or "")
        fd, dv = str(f.get("dimension") or f.get("field") or "").strip(), str(f.get("default_value") or "").strip()
        fname = str(f.get("name") or f.get("title") or "").replace(".", "_").strip()
        if dv and fname: f_dv_by_name[fname] = dv
        if not fd: continue
        if fm and fe and dv: probe_flts.setdefault((fm, fe), {}).setdefault(fd, dv)
        vf = _valid_explore_fields(fm, fe)
        if vf["all"] and fd not in vf["all"]:
            missing.setdefault((fm, fe), []).append(f"filter '{f.get('name') or f.get('title') or fd}': {fd}")
    for idx, t in enumerate(tiles or []):
        if not isinstance(t, dict): continue
        q = t.get("query") if isinstance(t.get("query"), dict) else t
        tm = str(q.get("model") or t.get("model") or default_model or "")
        te = str(q.get("view") or q.get("explore") or t.get("explore") or default_explore or "")
        flds = [str(x).strip() for x in (q.get("fields") or t.get("fields") or []) if str(x).strip()]
        tlabel = str(t.get("title") or t.get("name") or f"tile_{idx + 1}")
        vt = str((q.get("vis_config") or t.get("vis_config") or {}).get("type") or t.get("type") or "vis")
        if vt != "text" and t.get("type") != "text" and not flds:
            raise ValueError(f"Tile '{tlabel}' ({tm}::{te}) has empty fields=[] — query at least one dimension or measure.")
        raw_dyn = q.get("dynamic_fields") or t.get("dynamic_fields")
        if isinstance(raw_dyn, str) and raw_dyn.strip().startswith("["):
            try: raw_dyn = json.loads(raw_dyn)
            except Exception: raw_dyn = []
        dyn = set([str(df.get("measure") or df.get("dimension") or df.get("table_calculation") or "") for df in (raw_dyn if isinstance(raw_dyn, list) else []) if isinstance(df, dict)])
        tflts = dict(q.get("filters") or t.get("filters") or {})
        lsn = t.get("listen") or q.get("listen")
        lpairs = [(str(k).replace(".", "_").strip(), str(v).strip()) for k, v in lsn.items()] if isinstance(lsn, dict) else [(str(li.get("dashboard_filter_name") or "").replace(".", "_").strip(), str(li.get("field") or "").strip()) for li in (lsn or []) if isinstance(li, dict)]
        lvals = [lv for _, lv in lpairs if lv]
        if tm and te:
            for fk, fv in tflts.items():
                if fk and fv is not None and str(fv).strip() and fk not in dyn:
                    probe_flts.setdefault((tm, te), {}).setdefault(str(fk).strip(), str(fv).strip())
            for lk, lv in lpairs:
                if lk in f_dv_by_name and lv and lv not in dyn:
                    probe_flts.setdefault((tm, te), {}).setdefault(lv, f_dv_by_name[lk])
            if flds:
                pf = probe_by_exp.setdefault((tm, te), [])
                for xf in flds:
                    if xf not in dyn and xf not in pf: pf.append(xf)
        vf = _valid_explore_fields(tm, te)
        if not vf["all"]: continue
        refs = flds + [str(x).strip() for x in list(q.get("pivots") or t.get("pivots") or []) + list(tflts.keys()) + lvals if x and str(x).strip()] + [str(s).split()[0] for s in (q.get("sorts") or t.get("sorts") or []) if str(s).strip()]
        for rf in refs:
            if rf not in vf["all"] and rf not in dyn:
                missing.setdefault((tm, te), []).append(f"tile '{tlabel}': {rf}")
    if missing:
        raise ValueError(" | ".join([f"Unknown/excluded field(s) on {em}::{ee}: {', '.join(bad)}. Valid measures: {_valid_explore_fields(em, ee)['meas'][:40]}; Valid dimensions: {_valid_explore_fields(em, ee)['dims'][:40]}" for (em, ee), bad in missing.items()]))
    try: _riq = run_inline_query
    except Exception: _riq = None
    if _riq is not None:
        for (tm, te), pfields in probe_by_exp.items():
            seen_v, probe_fields = set(), pfields[:] if len(pfields) <= 20 else []
            for pass_v in (() if probe_fields else (True, False)):
                for x in pfields:
                    vp = x.split(".", 1)[0]
                    if len(probe_fields) < 20 and x not in probe_fields and (not pass_v or vp not in seen_v):
                        seen_v.add(vp)
                        probe_fields.append(x)
            if not probe_fields: continue
            pbody, fmap = {"model": tm, "view": te, "fields": probe_fields, "limit": "1"}, probe_flts.get((tm, te))
            qerrs, qexc = [], None
            for flts in ([fmap, None] if fmap else [None]):
                qerrs, qexc = [], None
                try: qres = _riq("json_detail", dict(pbody, filters=flts) if flts else pbody)
                except Exception as exc:
                    qexc = exc
                    if flts and "filter" in str(exc).lower(): continue
                    break
                if isinstance(qres, str) and qres.strip().startswith(("{", "[")):
                    try: qres = json.loads(qres)
                    except Exception: pass
                qerrs = (qres.get("errors") or ([qres["error"]] if qres.get("error") else [])) if isinstance(qres, dict) else ([qres[0]["looker_error"]] if isinstance(qres, list) and qres and isinstance(qres[0], dict) and qres[0].get("looker_error") else [])
                if not qerrs or not (flts and "filter" in str(qerrs).lower()): break
            if qexc is not None: raise ValueError(f"Live 1-row SQL check failed on {tm}::{te}: {qexc}")
            if qerrs:
                emsgs = [" — ".join([str(x).strip() for x in (e.get("message"), e.get("message_details")) if x and str(x).strip()]) if isinstance(e, dict) else str(e) for e in qerrs]
                raise ValueError(f"Live 1-row SQL check failed on {tm}::{te}: {'; '.join([x for x in emsgs if x]) or qerrs}")

def upsert_udd(title, folder_id=None, filters=None, tiles=None, dashboard_id=None, model=None, explore=None, _checked=False):
    dm, de = str(model or _t_model or ""), str(explore or _t_explore or "")
    if not _checked: _check_dashboard_fields(dm, de, filters=filters, tiles=tiles)
    fid, did = str(folder_id or _t_folder_id or _active.get("folderId") or _active.get("folder_id") or "1"), str(dashboard_id or _active.get("id") or "")
    if did and "::" not in did: d = update_dashboard(did, {"title": title})
    else:
        d = create_dashboard({"title": title, "folder_id": fid, "show_filters_bar": True})
        did = str(d.get("id"))
    f_names = list(_active.get("filter_names") or _active.get("filterNames") or [])
    for f in (filters or []):
        fname, fdim = str(f.get("name") or f.get("title") or "Filter").replace(".", "_"), str(f.get("dimension") or f.get("field") or "").strip()
        raw_ft = str(f.get("type") or "").strip()
        ft = "field_filter" if fdim else (raw_ft if raw_ft in ("date_filter", "number_filter", "string_filter") else "date_filter")
        fbody = {"dashboard_id": did, "name": fname, "title": str(f.get("title") or fname), "type": ft, "default_value": str(f.get("default_value") or ""), "row": int(f.get("row", 0))}
        if fdim: fbody.update({"model": f.get("model") or dm, "explore": f.get("explore") or de, "dimension": fdim, "allow_multiple_values": bool(f.get("allow_multiple_values", True))})
        if f.get("ui_config"): fbody["ui_config"] = f["ui_config"]
        if fname in _fcache: update_dashboard_filter(str(_fcache[fname]), fbody)
        elif fname not in f_names:
            cf = create_dashboard_filter(fbody)
            if cf and cf.get("id"): _fcache[fname] = str(cf["id"])
            f_names.append(fname)
    el_ids = list(_active.get("element_ids") or _active.get("elementIds") or [])
    elements_meta, boxes = [], []
    for idx, t in enumerate(tiles or []):
        q = t.get("query") or t
        qbody = {"model": q.get("model") or t.get("model") or dm, "view": q.get("view") or q.get("explore") or t.get("explore") or de, "fields": list(q.get("fields") or []), "filters": dict(q.get("filters") or {}), "sorts": list(q.get("sorts") or []), "limit": str(q.get("limit") or "500"), "vis_config": dict(q.get("vis_config") or t.get("vis_config") or {"type": t.get("vis_type") or "looker_grid"})}
        if q.get("pivots"): qbody["pivots"] = list(q["pivots"])
        qk = _canonical_qkey(qbody)
        qid = _qcache.get(qk)
        if not qid:
            qid = str(create_query(qbody)["id"])
            _qcache[qk] = qid
        raw_listen, listen_arr = t.get("listen"), []
        if isinstance(raw_listen, dict):
            for k, v in raw_listen.items(): listen_arr.append({"dashboard_filter_name": str(k).replace(".", "_"), "field": str(v)})
        elif isinstance(raw_listen, list):
            for item in raw_listen:
                if isinstance(item, dict) and item.get("dashboard_filter_name") and item.get("field"):
                    listen_arr.append({"dashboard_filter_name": str(item["dashboard_filter_name"]).replace(".", "_"), "field": str(item["field"])})
        ebody = {"dashboard_id": did, "title": str(t.get("title") or f"Tile {idx + 1}"), "type": "vis", "query_id": qid}
        if listen_arr: ebody["result_maker"] = {"filterables": [{"model": qbody["model"], "view": qbody["view"], "listen": listen_arr}]}
        eid = str(t.get("element_id") or (el_ids[idx] if idx < len(el_ids) and t.get("in_place", True) else ""))
        if eid: eid = str(update_dashboard_element(eid, ebody).get("id") or eid)
        else:
            eid = str(create_dashboard_element(ebody).get("id"))
            el_ids.append(eid)
        nb = _norm_box(t, idx)
        nb["element_id"] = eid
        boxes.append(nb)
        elements_meta.append({"id": eid, "title": ebody["title"], "type": qbody["vis_config"].get("type", "vis"), "model": qbody["model"], "explore": qbody["view"], **nb})
    lay_res = reflow_24col(did, boxes)
    return {"dashboard_id": did, "title": title, "folder_id": fid, "layout_id": lay_res["layout_id"], "element_ids": el_ids, "filter_names": f_names, "layout_component_ids": lay_res["layout_component_ids"], "query_cache": _qcache, "filter_cache": _fcache, "tile_count": len(el_ids), "filter_count": len(f_names), "elements": elements_meta}

def upsert_lookml_dashboard(project_id="", model="", dashboard_name="executive_pulse", title="Executive Pulse", tiles=None, filters=None, yaml_content=None, folder_id=None, sync_udd_id=None, model_file_path=None):
    proj = str(project_id or _t_project_id or _active.get("projectId") or _active.get("project_id") or "")
    m = str(model or _t_model or _active.get("model") or (proj.replace("-", "_") if proj else ""))
    if not proj and m:
        try: proj = str(lookml_model(m).get("project_name") or "")
        except Exception: proj = ""
    raw_slug = str(dashboard_name or "executive_pulse").replace(".dashboard.lookml", "").strip()
    if "::" in raw_slug: m, raw_slug = raw_slug.split("::", 1)
    slug = raw_slug.replace(".", "_").replace(" ", "_").lower()
    inferred_exp = ""
    for _t0 in (tiles or []):
        _q0 = _t0.get("query") or _t0
        inferred_exp = str(_q0.get("view") or _q0.get("explore") or _t0.get("explore") or ((_q0.get("fields") or _t0.get("fields") or [""])[0].split(".", 1)[0] if (_q0.get("fields") or _t0.get("fields")) else "")).strip()
        if inferred_exp: break
    lookml_id, default_exp = f"{m}::{slug}", str(_t_explore or inferred_exp or "")
    if yaml_content:
        ytxt = str(yaml_content).strip()
        if not ytxt.startswith("- dashboard:"):
            ytxt = f"- dashboard: {slug}\\n  title: {json.dumps(str(title or slug))}\\n  layout: newspaper\\n  " + ytxt
    else:
        _check_dashboard_fields(m, default_exp, filters=filters, tiles=tiles)
        lines = [f"- dashboard: {slug}", f"  title: {json.dumps(str(title or slug))}", "  layout: newspaper", "  preferred_viewer: dashboards-next", "  crossfilter_enabled: true", "  query_timezone: user_timezone"]
        if filters:
            lines.append("  filters:")
            for f in filters:
                fn = str(f.get("name") or f.get("title") or "filter").replace(".", "_").replace(" ", "_").lower()
                fld, dv = str(f.get("dimension") or f.get("field") or "").strip(), json.dumps(str(f.get("default_value") or ""))
                lines.extend([f"  - name: {fn}", f"    title: {json.dumps(str(f.get('title') or fn))}"])
                if fld:
                    lines.extend(["    type: field_filter", f"    model: {str(f.get('model') or m)}", f"    explore: {str(f.get('explore') or default_exp)}", f"    field: {fld}", f"    default_value: {dv}", f"    allow_multiple_values: {'true' if f.get('allow_multiple_values', True) else 'false'}"])
                else:
                    ft = str(f.get("type") or "").strip()
                    lines.extend([f"    type: {ft if ft in ('date_filter', 'number_filter', 'string_filter') else 'date_filter'}", f"    default_value: {dv}"])
        if tiles:
            lines.append("  elements:")
            for idx, t in enumerate(tiles):
                q = t.get("query") or t
                vc = dict(q.get("vis_config") or t.get("vis_config") or {})
                vt = str(vc.get("type") or t.get("type") or "looker_grid")
                en = str(t.get("name") or t.get("title") or f"tile_{idx + 1}").replace(".", "_").replace(" ", "_").lower()
                tm, te = str(q.get("model") or t.get("model") or m), str(q.get("view") or q.get("explore") or t.get("explore") or default_exp)
                flds, pvts, srts = list(q.get("fields") or t.get("fields") or []), list(q.get("pivots") or t.get("pivots") or []), list(q.get("sorts") or t.get("sorts") or [])
                lim, nb = str(q.get("limit") or t.get("limit") or "500"), _norm_box(t, idx)
                lines.extend([f"  - name: {en}", f"    title: {json.dumps(str(t.get('title') or en))}", f"    model: {tm}", f"    explore: {te}", f"    type: {vt}", f"    fields: [{', '.join(str(x) for x in flds)}]"])
                if pvts: lines.append(f"    pivots: [{', '.join(str(x) for x in pvts)}]")
                if srts: lines.append(f"    sorts: [{', '.join(str(x) for x in srts)}]")
                lines.append(f"    limit: {lim}")
                for vk, vv in vc.items():
                    if vk != "type" and isinstance(vv, (str, int, float, bool)): lines.append(f"    {vk}: {json.dumps(vv)}")
                lsn = t.get("listen")
                if isinstance(lsn, dict) and lsn:
                    lines.append("    listen:")
                    for fk, fv in lsn.items(): lines.append(f"      {str(fk).replace('.', '_')}: {fv}")
                elif isinstance(lsn, list) and lsn:
                    lines.append("    listen:")
                    for item in lsn:
                        if isinstance(item, dict) and item.get("dashboard_filter_name") and item.get("field"):
                            lines.append(f"      {str(item['dashboard_filter_name']).replace('.', '_')}: {item['field']}")
                lines.extend([f"    row: {nb['row']}", f"    col: {nb['col']}", f"    width: {nb['width']}", f"    height: {nb['height']}"])
        ytxt = "\\n".join(lines) + "\\n"
    fpath = f"dashboards/{slug}.dashboard.lookml"
    if proj:
        try: create_project_directory(proj, "dashboards")
        except Exception as _e: _re_perm(_e)
        try: create_file(proj, {"path": fpath, "content": ytxt})
        except Exception as _e:
            _re_perm(_e)
            try: update_file(proj, {"path": fpath, "content": ytxt})
            except Exception as _e2:
                _re_perm(_e2)
                fpath = f"{slug}.dashboard.lookml"
                try: create_file(proj, {"path": fpath, "content": ytxt})
                except Exception as _e3:
                    _re_perm(_e3)
                    update_file(proj, {"path": fpath, "content": ytxt})
        mpath, mc = model_file_path or f"models/{m}.model.lkml", ""
        try: mc = str(get_file_content(proj, mpath) or "")
        except Exception:
            mpath = f"{m}.model.lkml"
            try: mc = str(get_file_content(proj, mpath) or "")
            except Exception: mc = ""
        if mc and ".dashboard.lookml" not in mc:
            inc = 'include: "/dashboards/*.dashboard.lookml"\\n' if fpath.startswith("dashboards/") else 'include: "*.dashboard.lookml"\\n'
            try: update_file(proj, {"path": mpath, "content": inc + mc})
            except Exception as _e: _re_perm(_e)
        try: val_res = validate_project(proj)
        except Exception: val_res = None
        if isinstance(val_res, dict):
            bad_diags = []
            for d in (val_res.get("errors") or []):
                sev = str(d.get("severity") or "").lower() if isinstance(d, dict) else ""
                hay = f"{d.get('file_path') or ''} {d.get('message') or ''} {d.get('details') or ''}" if sev in ("fatal", "warning") else ""
                if hay and (fpath in hay or f"{slug}.dashboard.lookml" in hay or "unknown field" in hay.lower()):
                    bad_diags.append(f"[{sev}] {d.get('file_path') or ''}: {d.get('message') or ''}".strip())
            if bad_diags:
                raise ValueError(f"LookML dashboard validation failed for {fpath}: " + "; ".join(bad_diags))
    synced_udd, fid = str(sync_udd_id or ""), str(folder_id or _t_folder_id or _active.get("folderId") or _active.get("folder_id") or "")
    if synced_udd:
        try: sync_lookml_dashboard(lookml_id, dashboard_ids=[synced_udd])
        except Exception as _e: _re_perm(_e)
    elif fid:
        try:
            imp = import_lookml_dashboard(lookml_id, fid)
            if imp and imp.get("id"): synced_udd = str(imp["id"])
        except Exception as _e: _re_perm(_e)
        if not synced_udd:
            try:
                udd_res = upsert_udd(title, folder_id=fid, filters=filters, tiles=tiles, model=m, explore=default_exp, _checked=not bool(yaml_content))
                if udd_res and udd_res.get("dashboard_id"): synced_udd = str(udd_res["dashboard_id"])
            except ValueError: raise
            except Exception as _e: _re_perm(_e)
    return {"id": lookml_id, "lookml_dashboard_id": lookml_id, "dashboard_id": synced_udd or lookml_id, "content_type": "lookml_dashboard", "project_id": proj, "model": m, "file_path": fpath, "folder_id": fid, "sync_action": "import_lookml_dashboard", "title": title, "embed_path": f"/embed/dashboards/{synced_udd or lookml_id}", "tile_count": len(tiles or []), "filter_count": len(filters or [])}

def pin_to_board(title, description="", section_title="Executive Overview", dashboard_id=None, lookml_dashboard_id=None, look_id=None, board_id=None):
    bid = str(board_id or _active.get("boardId") or _active.get("board_id") or "")
    b = update_board(bid, {"title": title, "description": description}) if bid else create_board({"title": title, "description": description})
    bid = str(b.get("id") or bid)
    sid = str(create_board_section({"board_id": bid, "title": section_title}).get("id"))
    items = []
    if dashboard_id:
        if "::" in str(dashboard_id) and not lookml_dashboard_id:
            lookml_dashboard_id = str(dashboard_id)
        else:
            items.append(str(create_board_item({"board_section_id": sid, "dashboard_id": str(dashboard_id), "custom_description": "Primary UDD KPI & trend breakdown", "use_custom_description": True}).get("id")))
    if lookml_dashboard_id:
        items.append(str(create_board_item({"board_section_id": sid, "lookml_dashboard_id": str(lookml_dashboard_id), "custom_description": "Version-controlled LookML Dashboard", "use_custom_description": True}).get("id")))
    if look_id:
        items.append(str(create_board_item({"board_section_id": sid, "look_id": str(look_id), "custom_description": "Top-customer cohort retention Look", "use_custom_description": True}).get("id")))
    return {"board_id": bid, "section_id": sid, "item_ids": items}

def schedule_dashboard(dashboard_id, name="Weekly Executive Digest", crontab="0 9 * * 1", email="exec-team@example.com", fmt="wysiwyg_pdf", filters_string=""):
    did = str(dashboard_id or _active.get("id") or "")
    fstr = str(filters_string or "").strip()
    if fstr and not fstr.startswith("?"):
        fstr = "?" + fstr.replace(" ", "%20")
    body = {"name": name, "crontab": crontab, "datagroup": None, "filters_string": fstr, "require_results": False, "require_no_results": False, "require_change": False, "send_all_results": False, "scheduled_plan_destination": [{"format": fmt or "wysiwyg_pdf", "apply_formatting": True, "apply_vis": True, "address": email, "type": "email", "message": "Automated weekly KPI digest."}]}
    if "::" in did:
        body["lookml_dashboard_id"] = did
    else:
        body["dashboard_id"] = int(did) if did.isdigit() else did
    return str(create_scheduled_plan(body).get("id") or "")

schedule_udd = schedule_dashboard

def emit_native_bundle(state=None, **extra):
    merged = {}
    if isinstance(state, dict):
        merged.update(state)
    elif isinstance(state, str) and state:
        merged["content_type"] = state
    if isinstance(extra.get("state"), dict):
        merged.update(extra.pop("state"))
    merged.update(extra)
    cid = str(merged.get("id") or merged.get("dashboard_id") or merged.get("lookml_dashboard_id") or merged.get("board_id") or merged.get("look_id") or _active.get("id") or "")
    ctype = str(merged.get("content_type") or merged.get("contentType") or ("lookml_dashboard" if "::" in cid else "dashboard"))
    fid = str(merged.get("folder_id") or merged.get("folderId") or _t_folder_id or _active.get("folderId") or "1")
    title = str(merged.get("title") or _active.get("title") or f"Native {ctype} #{cid}")
    epath = merged.get("embed_path") or (f"/embed/looks/{cid}" if ctype == "look" else (f"/boards/{cid}" if ctype == "board" else f"/embed/dashboards/{cid}"))
    exps = list(merged.get("explores") or _t_explores or _active.get("explores") or [])
    payload = dict(merged)
    payload.update({"id": cid, "content_type": ctype, "contentType": ctype, "title": title, "folder_id": fid, "folderId": fid, "embed_path": epath, "url": epath, "summary": str(merged.get("summary") or title), "explores": exps, "query_cache": _qcache, "filter_cache": _fcache})
    payload.pop("NATIVE_CONTENT_BUNDLE", None)
    return {"NATIVE_CONTENT_BUNDLE": payload, **payload}
`

export function wrapDashboardCodeMode(code: string): string {
  const trimmed = String(code || '').trim()
  if (!trimmed || trimmed.includes('def upsert_udd(')) return trimmed
  return `${DASHBOARD_CODEMODE_PREAMBLE_PY}\n${trimmed}`
}

export const NATIVE_CONTENT_GUIDE_MD = `# Native Looker Content Studio (/dashboard) — Compact Recipe Guide

See \`/workspace/skills/looker-dashboard/SKILL.md\` and \`/workspace/skills/looker-field-profiler/SKILL.md\`.

## 1. Pre-Injected Monty Python Helpers in \`run_looker_codemode\`
- \`upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)\`: Validates \`lookml_model_explore\` + partition-pruned 1-row \`json_detail\` SQL per Explore (propagating \`default_value\` across \`listen:\` + tile \`filters\` — always set a concrete \`default_value\` on date filters for large tables), creates/updates a UDD, deduplicates \`create_query\`, wires \`listen\`, and lays out the 24-column grid.
- \`upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)\`: When \`tiles\` are passed (omitting \`yaml_content\`), validates \`lookml_model_explore\` + partition-pruned 1-row \`json_detail\` SQL and normalizes \`field_filter\`; writes \`dashboards/<name>.dashboard.lookml\` (\`layout: newspaper\`), wires \`include:\`, gates \`validate_project\` (\`fatal\` & \`warning\` \`Unknown field\`), and imports/syncs into \`folder_id\`. Never call \`update_session\` in \`run_looker_codemode\`.
- \`reflow_24col(dashboard_id, boxes)\`, \`pin_to_board(...)\`, \`schedule_dashboard(...)\`, \`emit_native_bundle(res, content_type=..., **extra)\`.
- \`profile_fields(model=m, view=e, fields=[...])\`: Profiles distributions (\`/workspace/skills/looker-field-profiler/SKILL.md\`) — \`profile:low_cardinality_enum\` for \`pivots:\`, \`looker_pie\` (\`limit: 6\`), and \`stats.top_values\` filters; \`profile:medium_cardinality_categorical\` for unpivoted \`looker_bar\`; \`profile:nullable\` for \`-NULL\`; \`profile:spiky_*\` for complete-period filters. Query \`_field_value_search_<model>\` (\`/workspace/skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md\`) first when resolving unknown entity literals.

## 2. 24-Column Grid & Clean Chat Summary Rules
- Layout: Row 0 (\`height: 4\`): 3 KPIs (\`col: 0, 8, 16, width: 8\`, \`single_value\`); Row 4 (\`height: 8\`): 2 charts (\`col: 0/12, width: 12\`, \`y_axes[].series\` objects \`[{"id": "view.m", "name": "Label", "axisId": "view.m"}]\`, \`defaults_version: 1\`); Row 12 (\`height: 8\`): full-width \`looker_grid\` (\`col: 0, width: 24\`). Filter/element \`name\` values use \`snake_case\` without periods (\`.\`).
- **Clean User-Facing Summary Rule**: NEVER include layout coordinates (\`Row 0\`, \`col\`, \`width\`, \`height\`, \`24-Column Grid\`) or internal Looker vis-type identifiers (\`single_value\`, \`looker_area\`, \`looker_pie\`, \`looker_column\`, \`looker_bar\`, \`looker_grid\`) in chat replies. Describe only the created tiles, filters, what each tile measures, and \`[Open <Dashboard Title>](/dashboards/<id>)\`.
`

export function buildNativeContentGuide(params: {
  selectedExplores: string[]
  primaryModel: string
  primaryExplore: string
  folderId?: string
  lookmlProjectId?: string
  existingNativeContent?: NativeContentState | null
}): string {
  const { selectedExplores, primaryModel, primaryExplore, folderId = '1', lookmlProjectId = '', existingNativeContent } = params
  const exploreDirective =
    selectedExplores.length > 0
      ? `for explore(s): ${selectedExplores.map((id) => `"${id}"`).join(', ')}.`
      : lookmlProjectId
      ? `for project/model "${lookmlProjectId}"${primaryExplore ? ` (explore "${primaryExplore}")` : ' (reuse the verified LookML explore(s) and fields from conversation history)'}.`
      : `— pick the best \`model_id::explore_id\` from /workspace/schema.md or \`search_content(terms="...", types="lookml_explore")\`.`
  const existingNativeDirective = existingNativeContent
    ? `Active native Looker ${existingNativeContent.contentType}: id="${existingNativeContent.id}", title="${existingNativeContent.title}", folder_id="${existingNativeContent.folderId}" (\`active_content\`). Update it in place.`
    : `Create the requested native Looker content in folder_id=\`target_folder_id\` ("${folderId}").`
  const modelSlug = (primaryModel || lookmlProjectId || 'project').replace(/-/g, '_')
  const lookmlOnboardingDirective = lookmlProjectId
    ? `4. LookML Project Dashboard Rule: Reuse the verified LookML explore(s) and fields from conversation history (or inspect \`lookml_model("${modelSlug}")["explores"]\` + \`lookml_model_explore("${modelSlug}", exp_name)\`), call \`res = upsert_lookml_dashboard(project_id="${lookmlProjectId}", model="${modelSlug}", dashboard_name="${modelSlug}_overview", title="<Project Overview Title>", folder_id="${folderId}", filters=[...], tiles=[...])\` (passing an explicit \`"explore"\` on every tile and filter) and \`return emit_native_bundle(res, folder_id="${folderId}", title="<Project Overview Title>")\` in ONE \`run_looker_codemode\` call. In your reply (zero grid coordinates or internal \`looker_*\`/\`single_value\` strings), summarize the tiles and filters, **ask if the user wants a responsive metric selector Data App** switching between **day (date), week, month, and year** and chart types, and end with \`[Open <Dashboard Title>](/dashboards/<id>)\`.`
    : ''

  return [
    `Native Looker Content Studio (/dashboard/:id?) ${exploreDirective}`,
    existingNativeDirective,
    NATIVE_CONTENT_GUIDE_MD,
    `Execute in ONE \`run_looker_codemode\` call per turn (\`code_execution\` disabled; pass a 1-sentence \`thought\`; NEVER call \`update_session\`; SDK returns Python \`dict\`s):`,
    `1. On cold start (when fields are not in conversation history), discover fields via \`lookml_model_explore(m, e, fields="name,label,fields(dimensions(name,label,type),measures(name,label,type))")\`, then run \`upsert_udd\`, \`upsert_lookml_dashboard\`, \`create_look\`, \`pin_to_board\`, or \`schedule_dashboard\` in the SAME script.`,
    `2. End with \`return emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", summary="...")\` (\`target_folder_id\`="${folderId}", \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel || modelSlug}", \`target_explore\`="${primaryExplore}", \`target_project_id\`="${lookmlProjectId}").`,
    `3. CRITICAL: Never echo \`<NATIVE_CONTENT_BUNDLE>\`, layout coordinates, or internal vis strings in your chat reply — summarize only tiles, filters, what each tile measures, and end with \`[Open <Dashboard Title>](/dashboards/<id>)\`.`,
    ...(lookmlOnboardingDirective ? [lookmlOnboardingDirective] : []),
  ].join('\n')
}

export const CONVERSATION_LABEL_REQUEST_TAG = '[CONVERSATION_LABEL_REQUEST]'
export const STARTER_PROMPTS_REQUEST_TAG = '[STARTER_PROMPTS_REQUEST]'

export const AGENTS_MD = `# Looker Data Apps

Single-file Lit ES module Data Apps (\`apps/<name>/app.js\`) and agentic Looker workflows.

## AI Agent Routing (Pre-Mounted Skills in \`/workspace/skills/\`)

| Task / Intent | Skill to Load | What It Handles |
| --- | --- | --- |
| **Create/edit Data App** | \`skills/data-apps/SKILL.md\` | \`<app-kpi>\`, \`<app-chart>\`, \`<app-grid>\`, \`<app-select>\`, \`.da-*\` layout, dark mode, widget extraction |
| **Data Investigator** | \`skills/data-investigator/SKILL.md\` | Narrative Data Apps (\`doc\` / \`slides\`) with fixed dates (\`YYYY-MM-DD to YYYY-MM-DD\`) & sequential chapters |
| **Key Driver Analysis** | \`skills/key-driver-analysis/SKILL.md\` | \`run_key_driver_analysis\` via \`skills/key-driver-analysis/scripts/kda_toolkit.py\` |
| **Looker Dashboards** | \`skills/looker-dashboard/SKILL.md\` | \`profile_fields\`, \`upsert_udd\`, \`upsert_lookml_dashboard\`, \`reflow_24col\`, \`pin_to_board\`, \`schedule_dashboard\`, \`emit_native_bundle\`, 24-col \`newspaper\`, \`y_axes[].series\` objects, \`advanced_vis_config\` |
| **Onboard Looker project** | \`skills/looker-project-onboarding/SKILL.md\` | DB connection onboarding, \`snake_case\` \`project_name\`, \`5 × 5\` SDK schema/table discovery, bare Git, 5-layer measures |
| **Agentic LookML** | \`skills/agentic-lookml/SKILL.md\` & \`skills/agentic-lookml-workflow/SKILL.md\` | 14 SQL-to-LookML playbooks, Bronze/Silver/Gold Medallion modeling, \`.test.lkml\` tests, parity pre-gate |
| **Bronze views from tables** | \`skills/generate-view-from-table/SKILL.md\` | 1:1 physical \`bronze/:table.view.lkml\` generation |
| **Profile & Curate fields** | \`skills/looker-field-profiler/SKILL.md\` (\`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md\`) & \`skills/lookml-field-curation/SKILL.md\` | \`profile_fields\` quantiles/spikiness, \`description:\`/\`tags:\`/\`hidden:\`/\`suggestable:\`, \`_field_value_search_<model>\` (\`scripts/scratch_search.py\`) |
| **LookML & Expressions** | \`skills/lookml/SKILL.md\`, \`skills/looker-filters/SKILL.md\`, \`skills/looker-expressions/SKILL.md\` | Models, views, explores, refinements, Liquid, sets, access grants, OJOF, filter expressions, Table Calculations |
| **Code Mode, Review & RBAC** | \`skills/lkr-code-mode/SKILL.md\`, \`skills/lkr-project-helper/SKILL.md\`, \`skills/looker-architect/SKILL.md\`, \`skills/lookml-reviewer/SKILL.md\`, \`skills/looker-audit/SKILL.md\`, \`skills/looker-performance-optimizer/SKILL.md\`, \`skills/creating-looker-dashboard/SKILL.md\`, \`skills/looker-permissions/SKILL.md\` | Monty SDK recipes, LAMS review, governance/performance audits, 4-layer RBAC & Safe Mode |

## Looker Code Mode Tool Contract (\`run_looker_codemode\`)

Always pass both \`code\` and a concise 1-sentence \`thought\` string summarizing the Looker API action.

## Sandbox CLI Bootstrap (\`uv\` + \`lkr-dev-cli\`)

New environments (\`user_env:\${me.id}\`) bootstrap \`uv\` and \`lkr-dev-cli\` (\`${LKR_DEV_CLI_VERSION}\`) via \`/workspace/bootstrap_lookml.py\`:
1. \`pip install --break-system-packages --quiet uv\`
2. \`UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"\`

## Conversation Labeling (Stateless Side-Request)

When a prompt contains \`[CONVERSATION_LABEL_REQUEST]\`: return **only** a 3–6 word plain-text title (no quotes, markdown, trailing period, tags, or tool calls).

## Dynamic Starter Prompts (Stateless Side-Request)

When a prompt contains \`[STARTER_PROMPTS_REQUEST]\`: call **no** tools and reply with **only** 3–4 starter chips in \`<STARTER_PROMPTS>[...]</STARTER_PROMPTS>\` JSON (\`[{"id":"...","label":"3-6 word plain text without emojis","prompt":"1-sentence actionable prompt","useCase":"app|data-investigator|dashboard|conversational-analytics|lookml|health-check|tile"}]\`).

## Use Case Auto-Classification (Turn 1 Routing)

When \`useCase="auto"\`, emit \`<USE_CASE>...</USE_CASE>\` at the start of your reply restricted to \`Allowed use cases for this user: [...]\`:
- \`app\` (**Data App**): Interactive Lit Data Apps (\`apps/<name>/app.js\`, \`skills/data-apps/SKILL.md\`), metric switchers, \`<app-kpi>\`/\`<app-chart>\`/\`<app-grid>\`, screenshot-to-app.
- \`data-investigator\` (**Data Investigator**): Root-cause narrative Data Apps (\`doc\` default / \`slides\`) for \`"investigate"\`, \`"find out"\`, \`"figure out"\`, \`"dig into"\`, \`"what drove"\`, \`"what caused"\` (\`skills/data-investigator/SKILL.md\`, \`skills/key-driver-analysis/SKILL.md\`, \`skills/key-driver-analysis/scripts/kda_toolkit.py\`, \`run_key_driver_analysis\`, \`limit: '500'\`, fixed \`YYYY-MM-DD to YYYY-MM-DD\`, **Chart -> What This Chart Means -> Next Investigation Path**).
- \`dashboard\` (**Content Studio**): Native UDDs, LookML Dashboards (\`.dashboard.lookml\`), Saved Looks, Boards, Schedules (\`skills/looker-dashboard/SKILL.md\`, \`skills/looker-field-profiler/SKILL.md\`, \`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md\`, \`_field_value_search_<model>\`).
- \`lookml\` (**Agentic LookML**): LookML models/views/explores/refinements/tests (\`.lkml\`), project onboarding (\`skills/looker-project-onboarding/SKILL.md\`), SQL-to-LookML parity, field profiling/curation (\`_field_value_search_<model>\`).
- \`health-check\` (**Health Check**): 3-Pillar Looker & BigQuery audit (\`TECHNICAL_DESIGN_DOCUMENT.md\`).
- \`tile\` (**Python Tile**): \`LkrCodeMode\` Python script tiles (\`obj_script_<id>\`, \`vars.dashboard_filters\`, scheduler) and ad-hoc Looker SDK / folder / space / user / permission / content inventory lookups via \`run_looker_codemode\` (format folder lists via \`format_content_inventory(folders)\` with \`[Title](/dashboards/<id>)\`, \`[Title](/looks/<id>)\`, \`[Folder](/folders/<folder_id>)\`, saving full lists \`> 5\` items to \`/workspace/content_inventory.md\`, and offer to save as a Script).
- \`conversational-analytics\` (**Conversational Analytics**): Ad-hoc analytical Q&A; call \`search_agents()\` in \`run_looker_codemode\` and if a CA agent covers the domain/explores, emit \`<USE_CASE>conversational-analytics</USE_CASE>\` + \`<CA_AGENT_SELECTION>{"agent_id":"<matched_id>","rationale":"<1-sentence reason>"}</CA_AGENT_SELECTION>\` (include \`<model>::_field_value_search_<model>\` when configuring CA agents); otherwise answer via \`run_looker_codemode\`.
- **Conversational No-Op**: Answer greetings, help, and diagnostic meta-questions directly in chat with zero tools and no right-pane artifact.
- **Plain Unicode Only (No \`$...$\` LaTeX)**: Never emit \`$...$\` or \`$$...$$\` LaTeX operators (e.g. \`$\\rightarrow$\`, \`$\\times$\`, \`$\\ge$\`) in chat Markdown; use plain Unicode (\`→\`, \`×\`, \`>=\`, \`<=\`, \`≈\`).
`

export const APP_BUILDER_SYSTEM_PROMPT = AGENTS_MD

export const LOOKER_PROJECT_ONBOARDING_SKILL_MD = `---
name: looker-project-onboarding
description: Onboard a LookML project, bare Git repo, Bronze/Silver views and explores, LookML dashboard, and Metric Selector Data App from a Looker connection.
---

# Looker Project Onboarding (\`skills/looker-project-onboarding/SKILL.md\`)

Onboard a LookML project in 4 stages (Bronze -> Silver Metrics -> LookML Dashboard -> Data App) via \`run_looker_codemode\` (\`raw_api_request: yes\`) and \`lkr --dev tools lookml push\`. Never call \`update_session\` in \`run_looker_codemode\`.

## Step 1: Conversational Intake & Verify Connection (\`run_looker_codemode\`)
1. **Turn 1 Intake**: Without **connection name**, **project name**, and **target tables/schemas**, emit \`<USE_CASE>lookml</USE_CASE>\`. Make **0 tool calls** if \`Available Looker Connections\` are pre-injected; else run **1** \`run_looker_codemode\` call (\`all_connections(fields="name,dialect_name,database,schema")\` or fallback \`all_lookml_models(fields="name,project_name,allowed_db_connection_names")\` — bare globals). Ask for **Connection name** (\`[Open Looker Connections](/admin/connections)\`), **Project name** (\`snake_case\`), and **Target tables/schemas** (or SQL from \`[Open SQL Runner](/sql)\`). No \`code_execution\`.
2. **Turn 2 Schema Discovery (\`connection_schemas\`)**: Given \`<connection_name>\` + \`<project_name>\` and asked for schemas, emit \`<USE_CASE>lookml</USE_CASE>\`, run **1** \`run_looker_codemode\` call (\`connection_schemas(connection_name)\` with fallback \`all_connections(...)\` / \`connection_tables(connection_name, schema_name=..., table_limit=5)\` — bare globals), list schemas, and ask which to use (no \`code_execution\` or \`view_file\`).

## Step 2: \`project_name\` (\`snake_case\`) & Bounded \`5 × 5\` SDK Discovery (Never \`INFORMATION_SCHEMA\`)
1. Normalize \`project_name = re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')\`.
2. Use SDK globals (\`connection_schemas\`, \`connection_tables\`, \`generate_lookml_with_new_files\`, \`profile_fields\`, \`run_inline_query\`) — **never** \`INFORMATION_SCHEMA\`.
3. Bound to \`5 × 5\` (max 5 schemas × 5 tables, excluding \`LM_*\`, \`LR_*\`, \`YM_*\`, \`connection_reg*\`; prefer fact/FK tables over event/inventory logs). Normalize \`schema = raw_target.replace("\`", "").strip().removesuffix(".*").strip(".")\` and preserve \`<catalog>.<schema>\` verbatim in \`connection_tables(conn, schema_name=schema)\` (\`database, schema_name\` fallback when \`"." in schema\`), \`generate_lookml_with_new_files\`, and \`\`sql_table_name: \`\${schema}.\${t}\` ;;\`\` (never strip \`<catalog>.\` via \`connection_schemas\`).

## Step 3: Stage 1 (Turn 3) — Generate Bronze Views, Validate, Push & Ask to Profile
1. Emit \`<USE_CASE>lookml</USE_CASE>\`. In **1** \`run_looker_codemode\` call (no \`import re\`), discover tables and generate \`bronze/*.view.lkml\`:
   \`\`\`python
   conn, project_id = "<connection_name>", "<project_name>"
   schema = "<schema_name>".replace("\`", "").strip().removesuffix(".*").strip(".")
   db_ds = schema.split(".", 1) if "." in schema else None
   def _sc(fn, **kw):
       for q in ([{"schema_name": schema}] + ([{"database": db_ds[0], "schema_name": db_ds[1]}] if db_ds else [])):
           try:
               r = fn(conn, **dict(kw, **q))
               if r: return r
           except Exception: pass
       return []
   if project_id not in [p.get("id") for p in (all_projects(fields="id") or []) if isinstance(p, dict)]:
       create_project({"name": project_id})
   update_project(project_id, {"git_service_name": "bare"})
   try: create_project_directory(project_id, "bronze")
   except Exception: pass
   raw = _sc(connection_tables)
   tlist = (raw[0].get("tables") or []) if raw and isinstance(raw[0], dict) else []
   names = [t.get("name") for t in tlist if isinstance(t, dict) and t.get("name") and not t.get("name", "").startswith(("LM_", "LR_", "YM_", "connection_reg"))]
   core_tables = [t for t in names if "event" not in t and "inventory" not in t][:5] or names[:5]
   try: generate_lookml_with_new_files(project_id, {"tables": [{"schema": schema, "table_name": t, "base_view": True} for t in core_tables]}, connection=conn, model_name=project_id, folder_name="bronze", file_type_for_explores="none", generate_descriptions=True, add_autogenerated_header=True, allow_update_without_header=True)
   except Exception: pass
   raw_views, fields = {}, {}
   for t in core_tables:
       try: vtxt = get_file_content(project_id, f"bronze/{t}.view.lkml") or ""
       except Exception: vtxt = ""
       if vtxt and f"{schema}.{t}".lower() not in vtxt.lower():
           qtbl = f"\`{schema}.{t}\`" if ("\`" in vtxt or db_ds) else f"{schema}.{t}"
           vtxt = "\\n".join([f"  sql_table_name: {qtbl} ;;" if ln.strip().startswith("sql_table_name:") else ln for ln in vtxt.split("\\n")]) if "sql_table_name:" in vtxt else vtxt.replace(f"view: {t} {{", f"view: {t} {{\\n  sql_table_name: {qtbl} ;;", 1)
           try: update_file(project_id, {"path": f"bronze/{t}.view.lkml", "content": vtxt})
           except Exception: pass
       raw_views[t] = vtxt
       if not vtxt:
           cmeta = _sc(connection_columns, table_names=t)
           cols = (cmeta[0].get("columns") or []) if cmeta and isinstance(cmeta[0], dict) else []
           fields[t] = [[c["name"], "time" if any(k in str(c.get("data_type", "")).upper() for k in ("DATE", "TIME")) else ("number" if any(k in str(c.get("data_type", "")).upper() for k in ("INT", "NUM", "FLOAT", "DEC")) else "string")] for c in cols if isinstance(c, dict) and c.get("name")]
   return {"schema": schema, "tables": core_tables, "raw_views": raw_views, "fields": fields}
   \`\`\`
2. In **1** \`code_execution\` call (\`python3 - << 'PYEOF'\`, no \`silver/\` yet), write \`/workspace/lookml/\`, validate, push (\`create_lookml_model\` / \`update_lookml_model\`), and bundle:
   \`\`\`bash
   python3 /workspace/bootstrap_lookml.py setup
   python3 - << 'PYEOF'
   from pathlib import Path
   import json
   project_id, conn, fact_table = "<project_name>", "<connection_name>", "<fact_table>"
   schema = "<schema_name>".replace("\`", "").strip().removesuffix(".*").strip(".")
   raw_views, fields = <RAW_VIEWS_DICT_FROM_RUN_LOOKER_CODEMODE>, <FIELDS_DICT_FROM_RUN_LOOKER_CODEMODE>
   root = Path("/workspace/lookml")
   (root / "bronze/explores").mkdir(parents=True, exist_ok=True)
   (root / f"{project_id}.model.lkml").write_text(f'connection: "{conn}"\\ninclude: "/bronze/*.view.lkml"\\ninclude: "/bronze/explores/*.explore.lkml"\\n')
   (root / "bronze/explores" / f"{fact_table}_base.explore.lkml").write_text(f'include: "/bronze/*.view.lkml"\\nexplore: {fact_table}_base {{\\n  view_name: {fact_table}\\n}}\\n')
   for t in (raw_views or fields):
       vtxt = (raw_views or {}).get(t) or ""
       if vtxt:
           (root / "bronze" / f"{t}.view.lkml").write_text(vtxt if vtxt.endswith("\\n") else vtxt + "\\n")
       else:
           qtbl, col_set = f"\`{schema}.{t}\`" if "." in schema else f"{schema}.{t}", {cn for cn, _ in fields.get(t, [])}
           lines = [f"view: {t} {{", f"  sql_table_name: {qtbl} ;;"]
           for cn, ct in fields.get(t, []):
               dg = cn[:-3] if ct == "time" and cn.endswith("_at") and len(cn) > 3 and cn[:-3] not in col_set else cn
               lines.append(f"  dimension_group: {dg} {{ type: time timeframes: [raw, time, date, week, month, quarter, year] sql: \${{TABLE}}.{cn} ;; }}" if ct == "time" else f"  dimension: {cn} {{ {'primary_key: yes ' if cn == 'id' else ''}type: {ct} sql: \${{TABLE}}.{cn} ;; }}")
           lines.extend(["  measure: count { type: count }\\n}\\n"])
           (root / "bronze" / f"{t}.view.lkml").write_text("\\n".join(lines))
   Path("/workspace/lookml_result.json").write_text(json.dumps({"project_id": project_id, "model_name": project_id}))
   PYEOF
   lkr parse lookml-to-api --path /workspace/lookml --validate > /dev/null
   lkr --dev tools lookml push /workspace/lookml --project-id <project_name> --no-reset
   python3 /workspace/bootstrap_lookml.py bundle /workspace/lookml_result.json
   \`\`\`
3. **Stop after \`bronze/\`**, **ask to profile data and create metrics**, and end with \`[Open <project_name> in Looker IDE](/projects/<project_name>)\`.

## Step 4: Stage 2 (Turn 4) — Single-Table Refinements & Silver Explores, \`profile_fields\`, and Ask for Dashboard
1. Emit \`<USE_CASE>lookml</USE_CASE>\` and apply \`/workspace/skills/agentic-lookml/SKILL.md\` 5-layer synthesis on \`<fact_table>\`:
   - **Layer 1 — Bronze Refinements (\`bronze/<fact_table>.refinement.lkml\`)**: Leave \`bronze/<table>.view.lkml\` untouched; keep \`bronze/<fact_table>.refinement.lkml\` **strictly single-table** (cross-view \`\${<dim_table>.*}\` fields belong in \`silver/\`). Add \`primary_key: yes\` on \`id\` and \`dimension_group: cancelled { type: time timeframes: [raw, time, date, week, month, quarter, year] sql: CASE WHEN \${status} = 'Cancelled' THEN \${created_raw} END ;; }\` when \`status\` + lifecycle dates exist without \`cancelled\`.
   - **Layer 2 — Statistical Measures**: \`total_<num_col>\` (\`sum\`, \`usd\`), \`average_<num_col>\` (\`average\`, \`usd\`), \`<entity>_count\` (\`count_distinct\`).
   - **Layer 3 — Filtered Measures**: \`return_count\` (\`"Returned"\`), \`cancel_count\` (\`"Cancelled"\`), \`completed_count\` (\`"Complete"\`) from \`profile_fields\` (\`skills/looker-field-profiler/SKILL.md\`) \`stats.top_values\`; apply \`curation.lookml_snippet\` and \`NULLIF\` on \`profile:has_zeros\`.
   - **Layer 4 — ANSI Ratios (\`type: number\`)**: \`1.0 * \${numerator_measure} / NULLIF(\${denominator_measure}, 0)\` (\`return_rate\`, \`cancel_rate\` \`percent_2\`; \`average_order_value\` \`usd\`).
   - **Layer 5 — Silver Explores (\`silver/explores/<fact_table>.explore.lkml\`)**: Deconstruct SQL (\`grain_change_reagg\`, \`window_pre_groupby\`, \`union\`, \`non_equi_join\`, \`filter_dependent_cte\`), extend \`[<fact_table>_base]\` (\`hidden: no\`, \`view_name: <fact_table>\`), join \`<dim_table>\` (\`left_outer\`, \`many_to_one\`), and include \`"/bronze/*.refinement.lkml"\` + \`"/silver/explores/*.explore.lkml"\` in \`<project_name>.model.lkml\`. **Never** set \`fields: [ALL_FIELDS*, -...]\` exclusions on \`<fact_table>_base\` (strips dashboard tile \`fields\` to \`[]\`). Optionally scaffold \`_field_value_search_<project_name>\` (\`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md\`).
2. In **1** \`code_execution\` call, write files, validate (\`lkr parse lookml-to-api --path /workspace/lookml --validate\`), push (\`--no-reset\`), and run \`bootstrap_lookml.py bundle\`.
3. In **1** \`run_looker_codemode\` call, run \`profile_fields\` + 5-row \`run_inline_query\`, show results, **ask if they want a dashboard**, and end with \`[Open <project_name> in Looker IDE](/projects/<project_name>)\`.

## Step 5: Stage 3 (Turn 5) — Validated LookML Dashboard & Clean Chat Summary
1. Emit \`<USE_CASE>dashboard</USE_CASE>\`, call \`upsert_lookml_dashboard(project_id=project_name, model=project_name, dashboard_name="<dashboard_slug>", title="<Dashboard Title>", folder_id=target_folder_id, filters=[...], tiles=[...])\` (4+ Silver tiles; gates \`lookml_model_explore\`, 1-row \`json_detail\` SQL, and \`validate_project\` \`fatal\`/\`warning\` \`Unknown field\`) + \`return emit_native_bundle(res, folder_id=target_folder_id, title="<Dashboard Title>")\` in \`run_looker_codemode\`.
2. **Clean Summary Rule**: Never output coordinates (\`Row 0\`, \`col\`, \`width\`, \`height\`, \`24-Column Grid\`) or internal vis strings (\`single_value\`, \`looker_area\`, \`looker_pie\`, \`looker_column\`, \`looker_bar\`, \`looker_grid\`). Summarize tiles/filters, **ask if they want a responsive metric selector Data App** (\`day\`/\`date\`, \`week\`, \`month\`, \`year\`, chart types), and end with \`[Open <Dashboard Title>](/dashboards/<id>)\`.

## Step 6: Stage 4 (Turn 6) — Metric Selector Data App (\`date\` Grain, \`@container\` KPIs, PoP, Dual-Date Compare & Custom \`Window:\`)
1. Emit \`<USE_CASE>app</USE_CASE>\`; bundle in **1** \`code_execution\` call: \`python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "Metric Selector Explorer" << 'EOF'\` (never inspect \`/workspace/lookml\` or \`bundle_app.py\`).
2. **\`date\` Key (No \`*_day\`)**: \`PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 }\`, \`WINDOW_OPTIONS = { date: [14, 30, 60, 90, 180], week: [12, 26, 53, 104], month: [6, 12, 24, 60], year: [3, 5, 10] }\`, \`UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' }\` (\`Period\` \`Daily\` -> \`'date'\`).
3. **Balanced \`@container\` KPIs & 4-Row PoP**: No \`auto-fit\`/\`auto-fill\`, \`<app-kpi>\`, \`Metric\` \`<app-select>\`, or \`"ACTIVE METRIC"\`. \`.da-container { container-type: inline-size }\`; \`.da-kpi-grid\`: \`repeat(4, minmax(0, 1fr))\` -> \`@container (max-width: 820px)\` \`repeat(2, minmax(0, 1fr))\` -> \`420px\` \`1fr\` (\`N=3\`: \`3->1\`; \`N=6\`: \`6->3->2->1\`). On \`created_*\`/\`returned_*\`/\`cancelled_*\`, query \`2 * this.periodCount\` (\`sorts: ["\${dateDim} asc"]\`, \`limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)))\`), split \`prevRows\`/\`currRows\`, render: uppercase label, headline, \`<span class="kpi-change \${tone}">\${pctStr}</span>\` before \`vs. prev \${n} \${UNITS[this.period]}\` (\`lower-better\`), \`currRows\` \`<svg>\`.
4. **Card-Border Compare, Dual-Date \`loadTrendData()\` & \`shareScale\` Y-Axis**: No \`Compare against\` \`<app-select>\`; Primary: \`2px solid var(--app-chart-1, #4285f4)\`, Secondary: \`2px solid var(--app-chart-2, #34a853)\` (\`--app-chart-2: #34a853\`). \`!compareMetric\`: click->\`selectedMetric\`; \`shiftKey\`/\`@contextmenu\` (\`Compare\`)->\`compareMetric\`. Set: click \`compareMetric\`->\`''\`, elsewhere locks \`selectedMetric\`, \`shiftKey\`/\`contextmenu\` (\`Remove comparison\`)->\`''\`. In \`loadTrendData()\` (\`connectedCallback\`, custom \`onFiltersChanged\` from \`willUpdate\` on \`dashboardFilters\`/\`crossFilters\`, \`onRefresh\`, handlers — never \`updated()\` or \`dateBase !==\`/\`!=\`), keep \`this.trendRows = null\` idle (\`(this.trendRows || []).map(...)\`); when \`compareMetric\` is set (\`m1\`/\`m2\`), \`Promise.all([this.runQuery(...d1...), this.runQuery(...d2...)])\` on \`d1=\${m1.dateBase}_\${this.period}\` & \`d2=\${m2.dateBase}_\${this.period}\` (\`getEffectiveFilters\`, \`asc\`, dynamic \`limit\`), key \`map1\`/\`map2\` by \`String(r[d1] ?? '')\` / \`String(r[d2] ?? '')\`, sort union \`periods\`, set \`this.trendRows = periods.map(p => ({ period: p, [m1.measure]: Number(map1.get(p) ?? 0), [m2.measure]: Number(map2.get(p) ?? 0) }))\`, pass \`.data=\${this.trendRows}\` omitting \`.query\`. Left \`yAxis[0]\`=Main, Right \`yAxis[1]\` (\`opposite: true\`, \`gridLineWidth: 0\`)=Compare (\`yAxis.title.text\`, \`options.colors\`, \`formatAxisValue\` \`labels.formatter\` + \`escapeHtml\`/\`formatValue\` \`tooltip.formatter\` if \`m1.format !== m2.format\`); \`shareScale = Boolean(m2 && m1.format === m2.format && max1 > 0 && max2 > 0 && (Math.max(max1, max2) / Math.min(max1, max2) <= 3))\` -> \`true\`: both \`series\` \`yAxis: 0\` + \`yAxis[1]\` \`{ linkedTo: 0, opposite: true, ... }\`; \`false\`: \`series[1]\` \`yAxis: 1\`. No \`"Longitudinal Trend"\`; \`⋮\` (\`areaspline\`/\`line\`/\`column\`/\`bar\`) only.
5. **\`Period\`/\`Window\` (\`periodCount\`), Custom \`Window:\` & PoP \`<app-grid>\`**: \`customWindowOpen\`/\`customWindowDraft\` in \`static properties\`; active \`\${this.periodCount} \${UNITS[this.period]}\` pill when \`!WINDOW_OPTIONS[this.period].includes(this.periodCount)\` + \`<svg>\` (\`title="Custom window length"\`) \`type="number"\` (\`1..1000\`, \`Enter\`/\`Escape\`/\`Apply\`) popover. Wire \`getEffectiveFilters\` everywhere; titleless \`<app-grid>\` + \`"Dimensions"\` (\`selectedDimensions\`) joining \`ago for\` into \`.data\` (\`This Period\`, \`Last Period\`, \`Variance\`).
`

export const DATA_INVESTIGATOR_GUIDE_MD = `# Data Investigator — Narrative Root-Cause Data Apps (Google Doc & Slides)

Author a Lit Data App (\`apps/<name>/app.js\`) as a **Google Doc** (\`this.viewMode = 'doc'\` default) or **Slides** (\`this.viewMode = 'slides'\` when prompt mentions \`slides\`/\`presentation\`/\`deck\`), rendering \`Doc View\` and \`Slides View\` buttons.
- **Doc (\`doc\`)**: Sticky outline + Overview (\`model::explore\`, fixed \`YYYY-MM-DD to YYYY-MM-DD\`) + sequential chapters: (1) Chart, (2) **What This Chart Means**, (3) **Next Investigation Path**, ending with a \`limit: '500'\` \`<app-grid>\`. **Slides (\`slides\`)**: Deck viewer (\`Previous\`/\`Next\` + \`ArrowLeft\`/\`ArrowRight\`).
- Pre-seeded \`/workspace/skills/key-driver-analysis/SKILL.md\`, \`/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py\`, \`profile_fields\` (\`skills/looker-field-profiler/SKILL.md\`), and \`_field_value_search_<model>\` (\`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md\`): use \`stats.spikiness\`, \`stats.top_values\`, \`[Drills: \`...\`]\`, \`limit: '500'\`, and \`run_key_driver_analysis\`.
- **Fixed Dates Only**: Never use relative date filters (\`"last 30 days"\`, \`"90 days"\`); use \`INVESTIGATION_ANCHOR_DATE\` and \`to_fixed_date_range(expr)\` for \`"YYYY-MM-DD to YYYY-MM-DD"\`.
`

export const DATA_APP_GUIDE_MD = `# Looker Lit Data Apps — Compact Sandbox Guide

## 1. ES Module Contract
- \`import { DataApp, html, nothing, keyed, formatValue, formatAxisValue, escapeHtml, createNumericCol, createCurrencyCol, createPercentageCol, createBadgeCol } from '/runtime/data-app.js';\`
- No TS decorators. Use \`static properties\`, \`customElements.define(tag, Cls)\`, \`this.lookerModel\` & \`this.explore\` in \`constructor()\`, and \`getEffectiveFilters(local = {}, { isTimeSeries = false } = {})\` spreading \`dashboardFilters\` & \`crossFilters\`.

## 2. Components (\`app-*\`) & Profiling
- \`<app-kpi>\`: \`label\`, \`subtitle\`, \`query-field\` (static KPIs only), \`.filters\`, \`format="usd|usd2|int|decimal1|percent1|percent-100"\`, \`polarity="higher-better|lower-better"\`, \`bare\`, \`cell\`.
- \`<app-chart>\`: \`title\`, \`type="areaspline|line|column|bar|donut|pie|treemap|funnel|gauge"\`, \`value-format\`, \`color\`, \`cross-filter\`, \`pivot-by\`, \`.query\` or \`.data\`, \`.loading\`, \`.filters\`, \`.options=\${{ chart: { spacing: [10, 15, 10, 10] } }}\`, \`bare\`, \`cell\`.
- \`<app-grid>\`: \`title\`, \`height="420px"\`, \`show-row-count\`, \`.query\` or \`.data\`, \`.filters\`, \`.columnDefs\`, \`@app-grid-row-click\`. \`<app-select>\`: \`label\`, \`.value\`, \`.options\`, \`@change=\${(e) => { this.val = e.detail.value; }}\`.
- **Profiling (\`profile_fields\` in \`skills/looker-field-profiler/SKILL.md\`)**: Use \`stats.top_values\`, \`approx_count_distinct\`, and \`_field_value_search_<model>\` (\`skills/looker-field-profiler/sub-skills/scratch-search/SKILL.md\`).

## 3. Layout (\`.da-*\`), \`@container\` KPI Grid & Dark Theme
- \`.da-container\`, \`.da-header\`, \`.da-filter-bar\`, \`.da-tabs\`, \`.da-tab-btn\` (\`.active\`), \`.da-kpi-grid\`, \`.da-grid-1\`, \`.da-grid-2\`, \`.da-grid-3\`, \`.da-grid-2-1\`, \`.da-grid-1-2\`, \`.da-section-card\`.
- **KPI Grid**: No \`auto-fit\`/\`auto-fill\`. \`.da-container { container-type: inline-size }\`; \`.da-kpi-grid\`: \`repeat(4, minmax(0, 1fr))\` -> \`@container (max-width: 820px)\` \`repeat(2, minmax(0, 1fr))\` -> \`420px\` \`1fr\` (\`N=3\`: \`3->1\`; \`N=6\`: \`6->3->2->1\`).
- Dark mode: \`this.isDark = true\`, \`<div class="da-container \${this.isDark ? 'dark-theme' : ''}">\`, \`\${this.renderThemeToggle()}\`, \`--app-*\` tokens — no \`document.body\`, \`onclick=\`, or \`localStorage\`.

## 4. Metric Selector / Timeframe Switcher Standards
1. **\`date\` Key (No \`*_day\`)**: \`PERIOD_DEFAULTS = { date: 90, week: 53, month: 60, year: 10 }\`, \`WINDOW_OPTIONS\`, \`UNITS = { date: 'days', week: 'weeks', month: 'months', year: 'years' }\` (\`Period\` \`Daily\` -> \`'date'\`).
2. **4-Row PoP KPIs (No \`<app-kpi>\`, Metric \`<app-select>\`, or \`"ACTIVE METRIC"\`)**: On \`created_*\`/\`returned_*\`/\`cancelled_*\`, query \`2 * this.periodCount\` (\`sorts: ["\${dateDim} asc"]\`, \`limit: String(Math.min(5000, Math.max(500, 2 * this.periodCount + 10)))\`), split \`prevRows\`/\`currRows\`, render: uppercase label, headline, \`<span class="kpi-change \${tone}">\${pctStr}</span>\` before \`vs. prev \${N} \${UNITS[this.period]}\` (\`lower-better\`), \`currRows\` \`<svg>\`.
3. **Card-Border Compare, Dual-Date \`loadTrendData()\` & \`shareScale\` Y-Axis**: No \`Compare against\` \`<app-select>\`; \`--app-chart-1\`/\`--app-chart-2\` (\`#34a853\`) borders: click->\`selectedMetric\`, \`shiftKey\`/\`@contextmenu\` (\`Compare\`/\`Remove comparison\`)->\`compareMetric\`. In \`loadTrendData()\` (\`connectedCallback\`, custom \`onFiltersChanged\` from \`willUpdate\` when \`this.hasUpdated\` on \`dashboardFilters\`/\`crossFilters\`, \`onRefresh\`, handlers — never \`updated()\` or \`dateBase !==\`/\`!=\`), keep \`this.trendRows = null\` idle; when \`compareMetric\` is set, \`Promise.all([this.runQuery(...d1...), this.runQuery(...d2...)])\` on \`d1\` & \`d2\` (dynamic \`limit\`), key by \`String(r[d] ?? '')\`, sort union \`periods\`, pass 3-key numeric \`.data=\${this.trendRows}\` (\`Number(...)\`) omitting \`.query\`. Left \`yAxis[0]\`=Main, Right \`yAxis[1]\` (\`opposite: true\`, \`gridLineWidth: 0\`)=Compare (\`yAxis.title.text\`, \`options.colors\`, \`formatAxisValue\` \`labels.formatter\` + \`escapeHtml\`/\`formatValue\` \`tooltip.formatter\` if \`m1.format !== m2.format\`); \`shareScale = Boolean(m2 && m1.format === m2.format && max1 > 0 && max2 > 0 && (Math.max(max1, max2) / Math.min(max1, max2) <= 3))\` -> \`true\`: both \`series\` \`yAxis: 0\` + \`yAxis[1]\` \`{ linkedTo: 0, opposite: true, ... }\`; \`false\`: \`series[1]\` \`yAxis: 1\`. No \`"Longitudinal Trend"\`; \`⋮\` menu only.
4. **\`Period\`/\`Window\` (\`periodCount\`), Custom \`Window:\` & PoP \`<app-grid>\`**: \`customWindowOpen\`/\`customWindowDraft\`; active \`\${this.periodCount} \${UNITS[this.period]}\` pill when \`!WINDOW_OPTIONS[this.period].includes(this.periodCount)\` + \`<svg>\` (\`title="Custom window length"\`) \`type="number"\` (\`1..1000\`, \`Enter\`/\`Escape\`/\`Apply\`) popover. Wire \`getEffectiveFilters\`; titleless \`<app-grid>\` + \`"Dimensions"\` (\`selectedDimensions\`) joining \`ago for\` into \`.data\` (\`This Period\`, \`Last Period\`, \`Variance\`).
- Bundle: \`python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "<App Title>" << 'EOF'\`
`

export const BUNDLE_APP_PY = `#!/usr/bin/env python3
"""Self-contained sandbox verifier, widget query extractor, and bundler for Looker Data Apps."""
import base64, json, os, sys, zlib
from pathlib import Path

TOOLKIT_DIR = Path(os.environ.get("TOOLKIT_DIR", "/workspace/toolkit"))
DEFAULT_VERSION = "1.2.0"
_CORE_B64 = "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"
exec(zlib.decompress(base64.b64decode(_CORE_B64)).decode("utf-8"), globals())

def ensure_toolkit() -> str:
    vf = TOOLKIT_DIR / "VERSION"
    return vf.read_text(encoding="utf-8").strip() if vf.is_file() and vf.read_text(encoding="utf-8").strip() else DEFAULT_VERSION

def main():
    raw_args = sys.argv[1:]
    app_dir = os.environ.get("APP_DIR", "/workspace/apps/current")
    args = []
    i = 0
    while i < len(raw_args):
        if raw_args[i] == "--app-dir" and i + 1 < len(raw_args):
            app_dir = raw_args[i + 1]
            i += 2
        elif raw_args[i].startswith("--app-dir="):
            app_dir = raw_args[i].split("=", 1)[1]
            i += 1
        else:
            args.append(raw_args[i])
            i += 1
    default_app_path = str(Path(app_dir) / "app.js")
    if not args:
        sys.exit("Usage: python3 /workspace/bundle_app.py [--app-dir <dir>] <path/to/app.js> [title] OR --stdin [title] [output_path]")
    if args[0] == "--stdin":
        title = args[1] if len(args) > 1 else "Data App"
        app_path = Path(args[2] if len(args) > 2 else default_app_path).resolve()
        app_path.parent.mkdir(parents=True, exist_ok=True)
        app_path.write_text(sys.stdin.read(), encoding="utf-8")
    else:
        cand = Path(args[0]).resolve()
        if cand.is_dir():
            cand = cand / "app.js"
        app_path, title = cand, (args[1] if len(args) > 1 else "Data App")
        if not app_path.is_file() and Path(default_app_path).is_file():
            app_path = Path(default_app_path).resolve()
        if not app_path.is_file():
            sys.exit(f"error: {app_path} does not exist")

    version = ensure_toolkit()
    syn = check_syntax(app_path)
    if not syn.get("ok"):
        print(json.dumps({"stage": "syntax", "error": syn}, indent=2), file=sys.stderr)
        sys.exit(1)
    safety, warnings = check_tile_safety(app_path), check_composition(app_path)
    raw_js = app_path.read_text(encoding="utf-8")
    clean_js, raw_lines = strip_comments(raw_js), raw_js.splitlines()
    for dm in re.finditer("""(?:[.][a-z0-9_]+(?<!_hour_of)|[$][{][^}]+[}])_day(?![a-zA-Z0-9_])""", clean_js):
        ln = raw_js.count(chr(10), 0, dm.start()) + 1
        safety.append({"line": ln, "rule": "invalid-lookml-day-timeframe", "message": "Replace '*_day' with '*_date' and key PERIOD_DEFAULTS/WINDOW_OPTIONS/UNITS by 'date'.", "snippet": raw_lines[ln - 1].strip()[:100]})
    if re.search("""_[$][{][^}]*period(?![a-zA-Z0-9_])""", clean_js):
        dm_day = re.search("""(?<![a-zA-Z0-9_.$])day[ ]*:|(?<![a-zA-Z0-9_$])(?:value|period)[ ]*[:=]=?[ ]*['"]day['"]""", clean_js)
        if dm_day:
            ln = raw_js.count(chr(10), 0, dm_day.start()) + 1
            safety.append({"line": ln, "rule": "invalid-lookml-day-timeframe", "message": "Key PERIOD_DEFAULTS, WINDOW_OPTIONS, UNITS, and Period options by 'date' (never 'day').", "snippet": raw_lines[ln - 1].strip()[:100]})
    ws_ch = "[ " + chr(9) + chr(10) + chr(13) + "]"
    ws_cls, ws_one = ws_ch + "*", ws_ch + "+"
    css_js = re.sub("""/[*][^*]*[*]+(?:[^/*][^*]*[*]+)*/""", lambda m: "".join(ch if ch == chr(10) else " " for ch in m.group(0)), clean_js)
    def _kpi_sub(src, idx):
        d, cur = 1, idx
        for tm in re.finditer("""<(/?)(?:div|section)(?![a-zA-Z0-9_-])""", src[idx:], re.I):
            d += -1 if tm.group(1) else 1
            if d <= 0:
                return src[idx:idx + tm.start()]
            cur = idx + tm.end()
        return src[idx:cur + 400]
    def _is_kpi_sub(s):
        return ("<app-kpi" in s or "kpi-change" in s) and "<app-chart" not in s and "<app-grid" not in s
    kpi_msg = "Forbid repeat(auto-fit/auto-fill) on .da-kpi-grid; set container-type: inline-size and @container 4 -> 2 -> 1 columns."
    sel_excl, kpi_offs = "[^{};<>=" + chr(96) + "]*", []
    for km in re.finditer("""([.#][a-zA-Z0-9_-]+""" + sel_excl + """)[{][^}]*repeat[(]""" + ws_cls + """auto-(?:fit|fill)""", css_js, re.I):
        sel_hdr = km.group(1)
        if "kpi" in sel_hdr.lower() or any(_is_kpi_sub(_kpi_sub(css_js, m.end())) for ctok in re.findall("[.#][a-zA-Z0-9_-]+", sel_hdr) for m in re.finditer(("id" if ctok[0] == "#" else "class") + ws_cls + """=""" + ws_cls + """['"](?:[^'"]*""" + ws_one + """)?""" + ctok[1:] + """(?:""" + ws_one + """[^'"]*)?['"](?:[^>]|=>)*?>""", css_js, re.I)):
            kpi_offs.append(km.start())
    for im in re.finditer("""<(?:div|section)(?:[^>]|=>)*?style""" + ws_cls + """=""" + ws_cls + """['"][^'"]*repeat[(]""" + ws_cls + """auto-(?:fit|fill)[^'"]*['"](?:[^>]|=>)*?>""", css_js, re.I):
        if "kpi" in im.group(0).lower() or _is_kpi_sub(_kpi_sub(css_js, im.end())):
            kpi_offs.append(im.start())
    if "kpi-change" in css_js:
        base_css = re.sub("""@container[^{]*[{](?:[^{}]*[{][^}]*[}])*[^}]*[}]""", "", css_js)
        if "@container" not in css_js or "container-type" not in css_js or ("da-kpi-grid" in css_js and not re.search("""[.]da-kpi-grid""" + sel_excl + """[{][^}]*grid-template-columns""", base_css, re.I)):
            kpi_offs.append(max(0, css_js.find("da-kpi-grid") if "da-kpi-grid" in css_js else css_js.find("kpi-change")))
    for off in kpi_offs:
        ln = raw_js.count(chr(10), 0, off) + 1
        safety.append({"line": ln, "rule": "unbalanced-kpi-grid", "message": kpi_msg, "snippet": raw_lines[ln - 1].strip()[:100]})
    masked_js, expr_store, _, str_ranges = _strip_comments_and_mask_expressions(clean_js)[:4]
    _um = lambda s: "".join("" if c == FILLER else expr_store[ord(c) - EXPR_BASE] if 0 <= ord(c) - EXPR_BASE < len(expr_store) else c for c in s)
    for sm in re.finditer("""<app-select(?![a-zA-Z0-9_-])[^>]*>""", masked_js, re.I):
        if re.search("""compare""" + ws_one + """against""", _um(sm.group(0)), re.I):
            ln = raw_js.count(chr(10), 0, sm.start()) + 1
            safety.append({"line": ln, "rule": "forbidden-compare-against-dropdown", "message": "Forbid <app-select label='Compare against'>; use KPI card-border compare (--app-chart-1 / --app-chart-2).", "snippet": raw_lines[ln - 1].strip()[:100]})
    ns = list(clean_js)
    for sa, sb in str_ranges:
        ns[sa:sb + 1] = [c if c == chr(10) else " " for c in ns[sa:sb + 1]]
    cns = "".join(ns)
    cm_m = re.search("""(?<![a-zA-Z0-9_$])compareMetric(?![a-zA-Z0-9_$])""", cns)
    if cm_m:
        cts = [m.group(0) for m in re.finditer("""<app-chart(?![a-zA-Z0-9_-])[^>]*>""", masked_js, re.I)]
        dq = lambda t, p: bool(re.search(p + ws_cls + """=""", t, re.I))
        def _bad_q(t):
            qm = re.search("""[.]query""" + ws_cls + """=""" + ws_cls + """['"]?([^'""" + chr(34) + ws_ch[1:-1] + """>]+)""", t, re.I)
            return bool(qm) and any(bool(re.search("""(?<![a-zA-Z0-9_$])compareMetric(?![a-zA-Z0-9_$])|[.][.][.]""" + ws_cls + """[(]""", (_extract_balanced_brackets(_um(qm.group(1)), fm.end() - 1) or ("", 0))[0])) for fm in re.finditer("""fields""" + ws_cls + """:""" + ws_cls + re.escape("["), _um(qm.group(1))))
        ok_ct = any(dq(t, "[.]data") for t in cts) and not any(dq(t, "[.]data") and dq(t, "[.]query") for t in cts) and not any(_bad_q(t) for t in cts)
        lm = re.search("""(?<![a-zA-Z0-9_$])loadTrendData""" + ws_cls + """[(][^)]*[)]""" + ws_cls + """[{]""", cns)
        sc = ((_extract_balanced_braces(cns, lm.end() - 1) or (cns, 0))[0]) if lm else cns
        ok_rq = bool(re.search("""Promise""" + ws_cls + """[.]""" + ws_cls + """all""" + ws_cls + """[(]""", sc) and re.search("""(?<![a-zA-Z0-9_$])runQuery(?![a-zA-Z0-9_$])""", cns))
        ok_ax = bool(re.search("""(?<![a-zA-Z0-9_$])linkedTo(?![a-zA-Z0-9_$])""", cns) and re.search("""(?<![a-zA-Z0-9_$])opposite""" + ws_cls + """:""" + ws_cls + """true(?![a-zA-Z0-9_$])""", cns)) and not re.search("""dateBase""" + ws_cls + """[)]*""" + ws_cls + """[!=]==?[^;:""" + chr(10) + """{}&,|]*dateBase""", cns) and not any(bool(re.search("""(?<![a-zA-Z0-9_$])loadTrendData(?![a-zA-Z0-9_$])""", (_extract_balanced_braces(cns, um.end() - 1) or ("", 0))[0])) for um in re.finditer("""(?<![a-zA-Z0-9_$])updated""" + ws_cls + """[(][^)]*[)]""" + ws_cls + """[{]""", cns))
        if not (ok_ct and ok_rq and ok_ax):
            ln = raw_js.count(chr(10), 0, cm_m.start()) + 1
            safety.append({"line": ln, "rule": "invalid-metric-comparison-query-or-axis", "message": "Use Promise.all + runQuery in loadTrendData() -> <app-chart .data=...> (no .query, updated(), or dateBase !==) + yAxis[1] (opposite: true, linkedTo: 0 when shareScale).", "snippet": raw_lines[ln - 1].strip()[:100]})
    if safety:
        print(json.dumps({"stage": "safety", "violations": safety}, indent=2), file=sys.stderr)
        sys.exit(1)
    extraction = extract_widget_queries(app_path)
    if extraction.stamped_code is None:
        print(json.dumps({"stage": "widget_extraction", "error": extraction.error}, indent=2), file=sys.stderr)
        sys.exit(1)
    runtime_url, vendor_url = resolve_shared_urls({}, TOOLKIT_DIR, version)
    bundle = {
        "title": title,
        "version": version,
        "raw_code": app_path.read_text(encoding="utf-8"),
        "prod_code": prepare_production_content(extraction.stamped_code, runtime_url, vendor_url),
        "widgets": extraction.widgets,
        "warnings": list(warnings) + list(extraction.warnings),
    }
    bpath = app_path.parent / "bundle.json" if app_path.parent != Path("/workspace") else Path("/workspace/bundle.json")
    try:
        bpath.write_text(json.dumps(bundle), encoding="utf-8")
    except Exception:
        pass
    print("<DATA_APP_BUNDLE>" + json.dumps(bundle) + "</DATA_APP_BUNDLE>")

if __name__ == "__main__":
    main()
`

export const KDA_SKILL_MD = `---
name: key-driver-analysis
description: Run, explain, and recursively drill through Key Driver Analysis (KDA) in Looker via \`lkr code-mode sandbox\` across any Explore URL/Query ID, Look URL/ID, Dashboard URL/ID, or Conversational Analytics Conversation URL/ID on any unknown LookML data model.
---

# Looker Key Driver Analysis (\`run_key_driver_analysis\`) Skill

Use this skill whenever asked to run Key Driver Analysis (KDA), explain why a Looker metric changed between two periods or cohorts, analyze drivers behind an Explore, Query, Look, Dashboard, or Conversational Analytics Conversation, or drill deeper into root causes using \`lkr code-mode\`.

---

## 1. Fast Start (\`lkr code-mode sandbox\`)

> [!IMPORTANT]
> 1. **Do NOT \`read_file\` \`skills/key-driver-analysis/scripts/kda_toolkit.py\`** — its complete API and return schemas are documented below.
> 2. **Single-Pass Execution with \`print_kda_summary(out)\`**: Prepend \`skills/key-driver-analysis/scripts/kda_toolkit.py\` to your script, run all targets in **one** \`lkr code-mode sandbox -f\` call, and call \`print_kda_summary(out)\` at the end (instead of \`print(json.dumps(out))\`, which gets double-escaped and truncated above 10 KB). \`print_kda_summary(out)\` emits a compact ~3.5 KB quote-free summary so \`run_command\` returns 100% of the results inline in a single turn with zero follow-up \`read_file\` calls.

\`\`\`bash
cat skills/key-driver-analysis/scripts/kda_toolkit.py /tmp/kda_job.py > /tmp/run_kda_job.py && lkr code-mode sandbox -f /tmp/run_kda_job.py
\`\`\`

### Complete Toolkit API & Return Schemas (\`kda_toolkit.py\`)

1. **\`resolve_source(target) -> dict\`**
   - Accepts **any** Explore URL, Query ID/slug, Look URL/ID, Dashboard URL/ID, or Conversation URL/ID.
   - Returns:
     \`\`\`python
     {
       "type": "dashboard" | "look" | "conversation" | "explore_query" | "explore" | "query",
       "id": str,
       "title": str,
       "targets": [
         {"title": str, "model": str, "explore": str, "fields": list[str], "filters": dict[str, str], "slug": str}
       ]
     }
     \`\`\`

2. **\`inspect_explore_for_kda(model_name, explore_name) -> dict\`**
   - Dynamically inspects \`lookml_model_explore(model_name, explore_name, fields="fields,joins")\` on **any unknown model** (cache per \`(model, explore)\`).
   - Automatically excludes \`inner\` joins, Liquid \`{% parameter %}\` views, primary keys/IDs, and leaf SKU/item-name/address fields, ranking macro business dimensions (\`status\`, \`department\`, \`traffic_source\`, \`gender\`, \`country\`, \`event_type\`, \`channel\`, \`segment\`, \`category\`, \`browser\`, \`state\`, \`brand\`) first.
   - Returns:
     \`\`\`python
     {
       "additive_measures": list[str], # sum, count, sum_distinct
       "measure_map": dict[str, {"type": str, "sql": str, "view": str, "has_filters": bool}],
       "timeframes": list[str],        # date/time dimensions
       "candidate_dimensions": list[str]
     }
     \`\`\`

3. **\`analyze_target(target, baseline_filters, breach_filters, explore_info=None, drill=False, sub_timeframe=None, top_k=6) -> dict\`**
   - **One-call KDA runner** for any element of \`resolve_source(x)["targets"]\`:
     - Automatically pads up to 6 \`candidate_dimensions\`.
     - Automatically decomposes non-additive measures (\`average\`, \`median\`, \`number\` rates/ratios) into their additive numerator & denominator via \`decompose_measure(m, info)\`.
     - Strips colliding relative timeframe filters from \`target["filters"]\`.
     - When \`drill=True\`, automatically runs \`drill_top_driver(...)\` (Pass 2 Recursive KDA + \`breach_sub_trend\` + \`unit_economics\` + \`follow_up_questions\`).
   - Returns:
     \`\`\`python
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
     \`\`\`

4. **\`print_kda_summary(out) -> None\`**
   - Prints a compact, quote-free pipe-delimited summary of a single \`analyze_target\` dict or a \`dict[str, dict | list[dict]]\` of multiple \`analyze_target\` results (\`DRV|<slice>|<archetype>|c=...|t=...|diff=...|share=...|unexp=...|sup=...\`, plus \`DRILL_PASS2\`, \`TREND\`, \`UNIT_ECON_CTRL/TEST\`, and \`Q1..Q3\`). Always call \`print_kda_summary(out)\` instead of \`print(json.dumps(out))\` so multi-target outputs stay under 4 KB and never trigger \`run_command\` truncation.

5. **Lower-Level Primitives (when custom dimensions or custom metrics are needed)**:
   - \`decompose_measure(measure_name, explore_info) -> list[str]\`
   - \`run_kda(model_name, explore_name, contribution_metric, dimensions, baseline_filters, breach_filters, base_filters=None, min_support=0.05, top_k=5) -> dict\`
   - \`drill_top_driver(model_name, explore_name, contribution_metric, pass1_result, drill_dimensions, baseline_filters, breach_filters, base_filters=None, sub_timeframe=None, explore_info=None) -> dict\`

### Minimal 15-Line Multi-Source Template
\`\`\`python
info_cache = {}
def get_info(m, e):
    if (m, e) not in info_cache:
        info_cache[(m, e)] = inspect_explore_for_kda(m, e)
    return info_cache[(m, e)]

base_yr, breach_yr = {"<view>.created_year": "2024"}, {"<view>.created_year": "2025"}
dash = resolve_source("https://<looker_host>/dashboards/<model>::<dashboard_slug>")
t_sales = [t for t in dash["targets"] if "Total Sales" in t["title"]][0]
t_aov = [t for t in dash["targets"] if "Average Order Sale Price" in t["title"]][0]

out = {
    "dash_sales": analyze_target(t_sales, base_yr, breach_yr, get_info(t_sales["model"], t_sales["explore"]), drill=True, sub_timeframe="<view>.created_month"),
    "dash_aov": analyze_target(t_aov, base_yr, breach_yr, get_info(t_aov["model"], t_aov["explore"])),
    "look_247": analyze_target(resolve_source("247")["targets"][0], base_yr, breach_yr, get_info("<model>", "<explore>")),
    "slug_8CDyM4D": analyze_target(resolve_source("8CDyM4D")["targets"][0], base_yr, breach_yr, get_info("<model>", "<explore>")),
    "conv": [analyze_target(t, base_yr, breach_yr, get_info(t["model"], t["explore"])) for t in resolve_source("a96583e4bac8437e8ab32f9b34ed2293")["targets"]],
}
print_kda_summary(out)
\`\`\`

---

## 2. How \`run_key_driver_analysis\` Works & Unknown-Model Safeguards

1. **Two Cohort Queries & Power-Set (\`2^d\`) Evaluation**:
   - Evaluates up to 6 categorical dimensions across Control (\`base_filters\` $\\cup$ \`baseline_filters\`) and Test (\`base_filters\` $\\cup$ \`breach_filters\`).
   - Top 60 values per dimension by row frequency in Test are kept distinct; remaining values become \`"{dim}_is_other"\`.
   - Parent slices (\`["A=x"]\`) with identical \`(metric_test, metric_control, difference, apriori_support)\` to a child slice (\`["A=x", "B=y"]\`) are pruned, as are constant 100%-support columns and multi-way \`2+ _is_other\` combinations.
   - \`run_kda()\` calls native \`run_key_driver_analysis\` (\`POST /api/4.0/internal/kda/analyze\`) first and automatically falls back to exact BQML-parity calculation when Looker 26.20–26.22 throws HTTP 422 (\`undefined method 'status' for KdaResponse::Success\`) or HTTP 400 on string query slugs.
2. **Five Automatic Safeguards in \`kda_toolkit.py\`**:
   - **Non-Additive Measure Decomposition**: Never sum \`type: average\` or \`type: number\` rates/ratios across rows. \`decompose_measure()\` parses LookML \`\${...}\` SQL references to run KDA on the additive numerator (\`total_sale_price\`, \`returned_count\`) and denominator (\`count\`, \`users.count\`) separately.
   - **Sparse \`LEFT JOIN\` Null-Row Protection**: KDA drops any row where *any* requested dimension is \`None\`. \`run_kda()\` automatically excludes dimensions that are \`None\` in \`>25%\` of \`test_rows\` (e.g., \`product_viewed.department\` on unfiltered \`events\`) so sparse joins never silently drop 78% of the dataset.
   - **Timeframe Collision Stripping**: Strips any relative date filter in \`base_filters\` (\`90 days\`, \`12 months\`, \`7 days\`) when \`baseline_filters\` or \`breach_filters\` specifies a timeframe filter.
   - **Macro-First Dimension Ranking**: Excludes leaf SKUs/item names/addresses and ranks macro business dimensions ahead of \`yesno\` flags.
   - **Adaptive \`min_support\`**: Uses \`min_support=0.05\` in Pass 1 and \`min_support=0.02\` in Pass 2 drill-downs so granular dimensions (\`category\`, \`brand\`, \`state\`) aren't blanked out by native KDA's \`0.10\` threshold.
   - **Pre-KDA Field Profiling (\`profile_fields\` in \`skills/looker-field-profiler/SKILL.md\`)**: When cohort dates or candidate dimensions are unknown, run \`profile_fields\` first to inspect \`stats.spikiness[grain]\` (\`peak_period\`, \`trough_period\`, \`spikiness_ratio\`, \`cv\`) on \`datetime\` fields to select anomaly windows for \`breach_filters\` vs. \`baseline_filters\`, and prune \`profile:uuid_or_hash\`, \`profile:json_payload\`, \`profile:empty_or_null_only\`, and \`profile:constant_value\` dimensions before calling \`run_key_driver_analysis\`.

---

## 3. Smart Multi-KDA Strategies for Dashboards & Conversations

When given a **Dashboard** or a multi-turn **Conversation**, run KDA smartly across content:
1. **Headline KPI Sweep**: Run KDA across key additive KPI tiles (\`Total Sales\`, \`Total Orders\`, \`New Users\`) to compare whether top-line movements share the same root driver.
2. **Rate / Average Tile Decomposition**: Pass rate/average tiles (\`Average Order Sale Price\`, \`Return Rate\`, \`Gross Margin %\`) to \`analyze_target()\` so it runs KDA on both the additive **numerator** and **denominator**, then compare which side drove the rate change.
3. **Cross-Explore Funnel Audit**: When tiles or conversation turns span multiple explores (\`events\` traffic vs. \`order_items\` revenue), run parallel KDAs on shared dimensions (\`traffic_source\`, \`country\`, \`state\`, \`gender\`).
4. **Sequential Conversation Turn Chain**: Run KDA on each turn in \`resolve_source(cid)["targets"]\`—preserving Turn 2/Turn 3's user filters (e.g., \`order_items.status: "Cancelled"\`) as \`base_filters\`.

---

## 4. Explaining KDA Results: Raw \`difference\` vs. \`unexpected_difference\`

Always contrast **raw contribution** (\`difference = M_t - M_c\`) against **peer-adjusted outperformance** (\`unexpected_difference\`):
- **Rest-of-Business Growth Ratio**: $R_{\\text{rest}} = \\frac{T_t - M_t}{T_c - M_c}$
- **Expected Test Volume**: $E_t = M_c \\times R_{\\text{rest}}$
- **Unexpected Difference**: $\\text{unexpected\\_difference} = M_t - E_t$
- **Relative Unexpected Difference**: $\\text{relative\\_unexpected\\_difference} = \\frac{M_t}{E_t} - 1$

| Archetype | Condition | Narrative Interpretation |
| :--- | :--- | :--- |
| **\`PRIMARY_ACCELERATOR\`** | \`difference\` and \`unexpected_difference\` share headline sign, high support | **True Root Driver**: Actively pulled the company average up (or down). Lead your explanation here. |
| **\`TIDE_FOLLOWER\`** | \`abs(relative_unexpected_difference) < 1.5%\` | **Passive Passenger**: High raw \`contribution\` only because the segment is large (\`apriori_support\`), growing at the same rate as peers. Call this out so the user isn't misled by raw size. |
| **\`HIDDEN_DRAG\`** | \`difference\` shares headline sign, but \`unexpected_difference\` has the **opposite** sign | **Silent Underperformer**: Grew in absolute terms (e.g., \`users.gender=Female\` grew \`+$652.6K\` / \`+43.7%\`), but lagged peer growth (\`+46.5%\`), costing \`-$41.8K\` in \`unexpected_difference\`. Always highlight Hidden Drags. |
| **\`OUTLIER_SURGE\`** | \`apriori_support < 20%\` and \`abs(relative_unexpected_difference) >= 8%\` | **Emerging Pocket / Anomaly**: Smaller segment punching far above its weight in excess growth or decline. |
| **\`COUNTER_TREND_OFFSET\`** | \`difference\` has the **opposite** sign of headline change | **Masking Force**: Moved opposite to the overall business, partially masking the headline shift. |

---

## 5. Drilling Through & Asking Follow-Up Questions

When drilling into a top driver (automated via \`analyze_target(..., drill=True, sub_timeframe=...)\` or \`drill_top_driver(...)\`):
1. **Pass 2 Recursive KDA (\`drill["pass2_kda"]\`)**: Locks the #1 Pass 1 driver into \`base_filters\` and evaluates the next 6 candidate dimensions at \`min_support=0.02\`.
2. **Sub-Period Trend (\`drill["breach_sub_trend"]\`)**: Breaks down the locked driver across \`_month\` or \`_week\` inside the breach window to distinguish a steady structural trend from a single-period spike or fulfillment pipeline lag.
3. **Unit-Economics Check (\`drill["unit_economics"]\`)**: Compares Control vs. Test across volume (\`count\`, \`order_count\`), total (\`sum\`), and unit rate (\`average_sale_price\`, \`return_rate\`) to prove whether the driver is **volume-driven** or **price/rate-driven**.
4. **3 Falsifiable Follow-Up Questions (\`drill["follow_up_questions"]\`)**: Conclude with 3 LookML-grounded next questions covering (a) child sub-segment isolation, (b) temporal/status cadence, and (c) unit economics or cross-funnel conversion.
`

export const KDA_TOOLKIT_PY = `import json

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
        for part in sql.split("\${")[1:]:
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
        f"Within \`{drv_str}\` ({arch}), which specific sub-segment in \`{', '.join(next_dims[:3])}\` explains the \`{top_drv.get('unexpected_difference')}\` unexpected variance vs the rest of the business?",
        f"Did the change in \`{drv_str}\` occur evenly across \`{sub_timeframe or 'the breach window'}\` or spike in a single sub-period?",
        f"Is \`{drv_str}\` driven by volume (\`{ue_fields[1] if len(ue_fields) > 1 else 'count'}\`) or unit economics (\`{rate_fld}\`)?",
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

`

export const LOOKER_DASHBOARD_SKILL_MD = `---
name: looker-dashboard
description: Unified Looker Dashboarding skill (\`skills/looker-dashboard/SKILL.md\`) for UDDs, LookML Dashboards (\`.dashboard.lookml\`), Looks, Boards, Schedules, \`profile_fields\`, Highcharts \`advanced_vis_config\`, and \`lookml-dashboard-to-query\`.
---

# Unified Looker Dashboarding Skill (\`looker-dashboard\`)

Create, update, and validate UDDs, LookML Dashboards (\`.dashboard.lookml\`), Looks, Boards, and Schedules via \`run_looker_codemode\`, Looker MCP, or \`lkr-dev-cli\`.

## Step 1 — Field & Distribution Discovery (\`profile_fields\`)
Profile fields via \`profile_fields(model=m, view=e, fields=[...])\` (\`skills/looker-field-profiler/SKILL.md\`):
- \`profile:low_cardinality_enum\` (<= 15): Safe for \`pivots:\`, stacked series, \`looker_pie\` (\`limit: 6\`), and \`stats.top_values\` filters.
- \`profile:medium_cardinality_categorical\` (16–100): \`looker_bar\`/\`looker_grid\` (\`limit: "20"\`); **never pivot**.
- \`profile:searchable_entity_label\` (> 100): Top-N \`looker_grid\`/\`looker_bar\` (\`sorts: ["measure desc"]\`, \`limit: "25"\`); \`ui_config: {type: "advanced", display: "popover"}\`.
- \`profile:skewed_distribution\`: Pair \`average\` with \`median\` (\`APPROX_QUANTILES\`).
- \`profile:nullable\`: Add \`filters: {"view.dim": "-NULL"}\` on breakdowns.
- \`profile:has_zeros\`: Guard denominators with \`nullif(\${view.field}, 0)\`.
- \`profile:rare_or_skewed_boolean\` (< 5%): Filtered measure or rate \`single_value\` KPI.
- \`profile:spiky_year\` / \`profile:spiky_month\` / \`profile:spiky_day\`: Exclude incomplete \`stats.spikiness[grain]["trough_period"]\`.

## Step 2 — Execution Workflows, Compile Gate & Clean Chat Summary Rule
1. **Studio Code Mode (\`run_looker_codemode\`, 1 call, never \`update_session\`)**:
   - \`upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)\`: Gates \`lookml_model_explore\` + 1-row \`run_inline_query("json_detail", ..., limit="1")\` SQL per Explore (propagating \`default_value\` across \`listen:\` + tile \`filters\` for partition pruning, with filter-error-only fallback), creates/updates UDD, deduplicates \`create_query\`, wires \`listen\`, and lays out 24-col grid.
   - \`upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)\`: When \`tiles\` are passed (omitting \`yaml_content\`), gates \`lookml_model_explore\` + partition-pruned 1-row \`json_detail\` SQL and normalizes field filters to \`type: field_filter\` (always set a concrete \`default_value\` on date filters for large tables); writes \`dashboards/<slug>.dashboard.lookml\`, wires \`include:\`, gates \`validate_project(project_id)\` (\`ValueError\` on \`"fatal"\` & \`"warning"\` \`Unknown field\`), and imports/syncs into \`folder_id\`.
   - \`reflow_24col(dashboard_id, boxes)\`, \`pin_to_board(...)\`, \`schedule_dashboard(...)\`, \`emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", ...)\`.
2. **Clean Summary Rule**: **NEVER** include coordinates (\`Row 0\`, \`col\`, \`width\`, \`height\`, \`24-Column Grid\`) or vis identifiers (\`single_value\`, \`looker_area\`, \`looker_pie\`, \`looker_column\`, \`looker_bar\`, \`looker_grid\`) in chat replies; summarize tiles/filters and end with \`[Open <Dashboard Title>](/dashboards/<id>)\`.
3. **MCP & CLI**: MCP \`make_dashboard\`/\`create_lookml_dashboard\`; CLI \`lkr parse lookml-to-api --path /workspace/lookml --validate\` && \`lkr --dev tools lookml push /workspace/lookml --project-id <project_id> --file dashboards/<name>.dashboard.lookml --no-reset\`.

## Step 3 — 24-Column \`newspaper\` Layout & Native \`tabs:\`
1. **24-Column Grid (\`layout: newspaper\`, \`preferred_viewer: dashboards-next\`, \`col + width <= 24\`)**: Row 0 (\`height: 4\`): 3 (\`width: 8\`, \`col: 0, 8, 16\`) or 4 (\`width: 6\`) \`single_value\` KPIs; Row 4 (\`height: 8\`): 2 (\`width: 12\`) trend charts (\`looker_line\`, \`looker_area\`, \`looker_column\`); Row 12 (\`height: 8\`): breakdowns (\`looker_bar\`, \`looker_pie\`, \`looker_funnel\`, \`looker_google_map\`); Row 20 (\`height: 8\`): \`col: 0, width: 24\` \`looker_grid\` (\`table_theme: modern\`).
2. **Native Tabs (\`tabs:\` + \`tab_name:\`)**: Group multi-topic or $> 25$-tile dashboards into 2–4 root \`tabs: [{name, label}]\`; forbid HTML nav bars in \`type: text\` tiles.

## Step 4 — Four Canonical Archetypes (\`get_lookml_dashboard_examples\`)
1. **Executive Pulse (\`business_pulse\`)**: 4 PoP \`single_value\` KPIs + \`looker_area\` & \`looker_pie\` + \`looker_column\` & \`looker_google_map\` + \`looker_grid\`.
2. **Entity Deep-Dive (\`brand_lookup\`)**: Entity filter + scorecards, affinity bars, map, leaderboard.
3. **360° Inspector (\`customer_lookup\`)**: \`looker_single_record\` (\`show_null_labels: false\`) + KPIs + chronological \`looker_grid\`.
4. **Funnel (\`web_analytics_overview\`)**: \`looker_funnel\` + conversion trends + attribution grid.

## Step 5 — Visualization Matrix & Query Shape Rules (All 22 Types)
- **\`single_value\`**: 1 date dim + 1 measure (\`sorts: [date desc]\`, \`limit: 2\`, \`show_comparison: true\`, \`comparison_type: change_percentage\`) or 2 measures (\`comparison_reverse_colors: true\` when lower is better).
- **\`looker_grid\`**: \`table_theme: modern\`, \`show_view_names: false\`, \`size_to_fit: true\`, \`enable_conditional_formatting: true\`, \`series_cell_visualizations\`.
- **Cartesian Dual Y-Axes (\`looker_line\`, \`looker_column\`, \`looker_area\`, \`looker_bar\`, \`looker_scatter\`)**: \`y_axis_combined: false\`, \`y_axis_unpinned: true\`, and \`y_axes[].series\` **MUST** be objects \`[{id: "view.m", name: "Label", axisId: "view.m"}]\`.
- **Donut (\`looker_pie\`)**: 1 dim, 1 measure, 0 pivots, \`limit: 6\`, \`show_donut: true\`, \`inner_radius: 50\`.
- **Maps & Others**: \`looker_google_map\`, \`looker_map\`, \`looker_geo_choropleth\`, \`looker_geo_coordinates\` (\`map_marker_radius_min: 3\`, \`map_marker_radius_max: 25\`); \`looker_waterfall\`, \`looker_boxplot\`, \`looker_histogram\`, \`looker_funnel\`, \`looker_timeline\`, \`looker_sankey\`, \`treemap\`, \`sunburst\`, \`looker_wordcloud\`, \`looker_bullet\`, \`looker_single_record\`, \`table\`.

## Step 6 — Highcharts \`advanced_vis_config\` Guardrails
1. **Allowed (14 Highcharts types only)**: \`looker_column\`, \`looker_bar\`, \`looker_line\`, \`looker_area\`, \`looker_scatter\`, \`looker_pie\`, \`looker_funnel\`, \`looker_timeline\`, \`looker_waterfall\`, \`looker_boxplot\`, \`looker_wordcloud\`, \`looker_histogram\`, \`looker_bullet\`, \`looker_sankey\` (never \`single_value\`, \`looker_grid\`, \`table\`, \`looker_single_record\`, or maps).
2. **JSON & Security**: \`defaults_version: 1\`, valid JSON, zero JS \`formatter\` functions (use \`format\` strings like \`"{point.y:,.0f}"\`), \`borderRadius: 8\`, \`"backgroundColor": "rgba(0, 0, 0, 0)"\`.

## Step 7 — YAML Safety, Medallion Field Scoping & Self-Healing (\`lookml-dashboard-to-query\`)
1. **YAML & Filters**: Quote strings; \`snake_case\` \`name:\` without periods; \`crossfilter_enabled: true\`; use \`type: field_filter\` whenever \`model\`/\`explore\`/\`field\` is set (reserve \`type: date_filter\`/\`number_filter\`/\`string_filter\` for fieldless filters without \`model\`/\`explore\`/\`field\`/\`allow_multiple_values\`); omit \`access_filter\` duplicates.
2. **Medallion Scoping**: Keep \`bronze/<fact>.refinement.lkml\` **single-table** (cross-view fields in \`silver/\`), and **never** set \`fields: [ALL_FIELDS*, -...]\` exclusions on \`<fact>_base\` when extended by Silver.
3. **Self-Healing (\`lookml-dashboard-to-query\`)**: Verify tile SQL via \`run_inline_query("sql", body)\`, add missing fields to \`bronze/\` or \`silver/\`, re-run \`validate_project\`, and \`sync_lookml_dashboard\`.
`

export const LOOKER_FIELD_PROFILER_SKILL_MD = `---
name: looker-field-profiler
description: >
  Profile Looker Explore fields (\`string\`, \`number\`, \`yesno\`, \`datetime\`) using \`profile_fields\` in
  \`lkr code-mode sandbox\` or \`ExtendedLooker40SDK\`. Computes \`APPROX_COUNT_DISTINCT\` & \`APPROX_QUANTILES\`
  (\`limit=5000\`, \`total=True\`), expands date/time grains for temporal spikiness, walks measure leaf
  dimensions, and emits \`profile:*\` \`suggested_tags\`, \`decisions\`, and \`curation.lookml_snippet\`.
---

# Looker Field Value Profiler (\`looker-field-profiler\`)

\`profile_fields\` is pre-bound as a global in \`run_looker_codemode\` / \`lkr code-mode sandbox\` (no imports or \`sdk.\` prefix) and profiles Explore dimensions and measures within Looker's \`5000\`-row cap (\`limit="5000"\`, \`total=True\`).

## 1. Signature & Invocation

\`\`\`python
profile_fields(
    body=None, model=None, view=None, fields=None, filters=None,
    types_only=False,   # Metadata-only bucketing (0 SQL queries)
    group_fields=False, # 1 combined query for non-datetime fields -> grouped_rows
    limit=5000,
)
\`\`\`

- **Measures & \`dimension_group\`s**: Passing a measure evaluates its scalar total in \`"measures"\` and profiles its leaf \`\${...}\` dimensions; bare \`dimension_group\` names resolve to \`_date\`/\`_time\`.
- **Return dict**: \`type_buckets\` (\`string\`/\`number\`/\`yesno\`/\`datetime\`), \`profiles[field]\` (\`root_type\`, \`subtype\`, \`total_rows\`, \`approx_count_distinct\`, \`null_count\`, \`null_pct\`, \`stats\` with \`top_values\` / \`spikiness\` / \`subtotals_by_grain\`, \`suggested_tags\`, \`decisions\`, \`curation\` with \`recommended_hidden\`, \`recommended_suggestable\`, \`recommended_description\`, \`lookml_snippet\`), \`measures\`, and \`grouped_rows\`.

## 2. Subtypes & \`profile:*\` Tags

- **Cross-type**: \`profile:foreign_key\` (non-PK \`*_id\`/\`*_fk\`), \`profile:nullable\` (\`null_count > 0\`), \`profile:unique_key_candidate\` (\`approx_count_distinct == total_rows\`, \`null_count == 0\`).
- **\`string\` (first match wins)**:
  1. \`tier\`/\`location\` -> \`profile:tier\` (\`suggestable: yes\`) / \`profile:location\` (\`suggestable: no\`).
  2. \`json\` -> \`profile:json_payload\` (\`hidden: yes\`, \`suggestable: no\`).
  3. \`id_or_code\` (UUID/hash) -> \`profile:uuid_or_hash\` (\`hidden: yes\`, \`suggestable: no\`).
  4. \`id_or_code\` (PK, \`_fivetran_*\`/\`_airbyte_*\`/\`_sdc_*\`/\`etl_*\`, or \`*_id\` > 100 distinct) -> \`hidden: yes\`, \`suggestable: no\`.
  5. \`empty_or_null\` -> \`profile:empty_or_null_only\` (\`hidden: yes\`, \`suggestable: no\`).
  6. \`free_text\` (\`max_length > 120\` / \`avg_length > 60\` / notes) -> \`profile:opaque_code_or_free_text\` (\`hidden: no\`, \`suggestable: no\`).
  7. \`id_or_code\` (\`sku\`/\`code\`/\`zip\`/\`email\`/\`phone\`/\`url\`/\`ip\`/\`token\`) -> \`profile:opaque_code_or_free_text\` (\`hidden: no\`, \`suggestable: no\`).
  8. \`enum\` ($1..15$) -> \`profile:low_cardinality_enum\` (\`suggestable: yes\`).
  9. \`categorical\` ($16..100$) -> \`profile:medium_cardinality_categorical\` (\`suggestable: yes\`).
  10. \`entity_label\` ($> 100$) -> \`profile:searchable_entity_label\` (\`suggestable: yes\`).
  - PII: \`profile:pii\` + \`profile:email\` / \`profile:phone\` (or SSN/tax/name/address/IP tokens).
- **\`number\`**: \`empty_or_null\` (\`profile:empty_or_null_only\`, \`hidden: yes\`), \`id_or_key\` (\`hidden: yes\`), \`constant\` (\`profile:constant_value\`), \`duration\` (\`profile:duration\`), \`percentage_or_ratio\` (\`profile:percentage_or_ratio\`), \`currency_or_decimal\` (\`profile:currency_or_decimal\`), \`discrete_integer\` (\`profile:discrete_integer\`), \`continuous_number\` (\`profile:continuous_number\`); plus \`profile:has_zeros\`, \`profile:has_negatives\`, \`profile:skewed_distribution\` ($|\\text{avg}-\\text{median}|/|\\text{median}| \\ge 0.5$ via \`APPROX_QUANTILES\`).
- **\`yesno\`**: \`empty_or_null\` (\`hidden: yes\`), \`constant_boolean\` (\`profile:constant_boolean\`), \`rare_or_skewed_boolean\` (\`min_pct < 5%\`, \`profile:rare_or_skewed_boolean\`), \`balanced_boolean\` (\`profile:balanced_boolean\`).
- **\`datetime\` & Spikiness (\`stats.spikiness[grain]\`)**: \`timestamp_or_raw\` (\`[date, hour]\`), \`calendar_date\` / \`period_grain\` (\`[year, month, date]\`), \`calendar_cycle\`. Emits \`profile:spiky_year\` / \`profile:spiky_month\` / \`profile:spiky_day\` / \`profile:spiky_hour\` when \`spikiness_ratio >= 2.0\` or \`cv >= 0.5\`, and \`profile:steady_volume\` when \`0 < cv < 0.25\`.

## 3. Action Playbook

- **LookML Refinements (\`bronze/:table.refinement.lkml\`)**: Paste \`curation["lookml_snippet"]\` into \`view: +:table\` (never edit \`bronze/:table.view.lkml\`); hide \`json_payload\`/\`uuid_or_hash\`/\`empty_or_null_only\`/surrogate keys; set \`suggestable: no\` on \`profile:opaque_code_or_free_text\`; guard \`profile:pii\` with \`required_access_grants:\` & \`lkr parse lookml snapshot\`; assert \`profile:unique_key_candidate\` in \`.test.lkml\`.
- **Charts & Filters**: \`profile:low_cardinality_enum\` -> safe for \`pivots:\`, donuts (\`limit: 6\`), and \`stats.top_values\` filters; \`profile:medium_cardinality_categorical\` -> unpivoted bars/grids (\`limit: "20"\`); \`profile:searchable_entity_label\` -> top-N leaderboards (\`limit: "25"\`); \`profile:skewed_distribution\` -> pair \`average\` with \`median\`; \`profile:has_zeros\` -> \`nullif(\${field}, 0)\`; \`profile:nullable\` -> \`-NULL\` on breakdowns; \`profile:rare_or_skewed_boolean\` -> filtered measure/rate KPI; \`profile:spiky_*\` -> exclude incomplete \`trough_period\` and run \`run_key_driver_analysis\` on \`peak_period\`.

## 4. Sub-Skill — Scratch Schema Value Search (\`sub-skills/scratch-search/SKILL.md\`)

- **Build (\`scripts/scratch_search.py\`)**: Profiles searchable string dims (excluding PII/JSON/UUID/empty), compiles SQL branches across BigQuery/Snowflake/Postgres/Databricks/DuckDB (\`scripts/dialects/*.py\`), and writes \`view: _field_value_search_<model>\` + \`explore: _field_value_search_<model> { hidden: yes }\`.
- **Query (\`run_inline_query\`)**: Query \`_field_value_search_<model>\` with \`filters: {"_field_value_search_<model>.field_value": "%<term>%"}\` (\`limit: "20"\`) to resolve unknown or misspelled literals to exact \`(explore_name, field_name, field_value)\` tuples in one indexed lookup.
`
