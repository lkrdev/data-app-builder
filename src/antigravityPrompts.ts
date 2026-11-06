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
    return json.dumps({
        "model": q.get("model"),
        "view": q.get("view") or q.get("explore"),
        "fields": list(q.get("fields") or []),
        "filters": dict(q.get("filters") or {}),
        "sorts": list(q.get("sorts") or []),
        "pivots": list(q.get("pivots") or []),
        "limit": str(q.get("limit") or "500"),
        "vis_config": dict(q.get("vis_config") or {}),
    }, sort_keys=True)

def _norm_box(spec, idx=0):
    default_boxes = [
        (0, 0, 8, 4), (0, 8, 8, 4), (0, 16, 8, 4),
        (4, 0, 12, 8), (4, 12, 12, 8),
        (12, 0, 24, 8),
    ]
    dr, dc, dw, dh = default_boxes[idx] if idx < len(default_boxes) else (12 + ((idx - 6) // 2) * 8, ((idx - 6) % 2) * 12, 12, 8)
    r = max(0, int(spec.get("row", dr)))
    c = min(23, max(0, int(spec.get("col", spec.get("column", dc)))))
    w = min(24 - c, max(1, int(spec.get("width", dw))))
    h = max(2, int(spec.get("height", dh)))
    return {"row": r, "col": c, "column": c, "width": w, "height": h}

def reflow_24col(dashboard_id, boxes, layout_id=None, comp_map=None):
    did = str(dashboard_id)
    cmap = dict(comp_map or _active.get("layout_component_ids") or _active.get("layoutComponentIds") or {})
    lid = str(layout_id or _active.get("layout_id") or _active.get("layoutId") or "")
    if not cmap or not lid:
        layouts = dashboard_dashboard_layouts(did)
        lay = layouts[0] if isinstance(layouts, list) and len(layouts) > 0 else (layouts if isinstance(layouts, dict) else {})
        lid = str(lay.get("id") or "")
        for c in (lay.get("dashboard_layout_components") or []):
            if c.get("dashboard_element_id") and c.get("id"):
                cmap[str(c["dashboard_element_id"])] = str(c["id"])
    for idx, b in enumerate(boxes or []):
        eid = str(b.get("element_id") or b.get("dashboard_element_id") or "")
        cid = str(b.get("component_id") or cmap.get(eid) or "")
        if cid and lid:
            nb = _norm_box(b, idx)
            update_dashboard_layout_component(cid, {
                "dashboard_layout_id": lid,
                "dashboard_element_id": eid,
                "row": nb["row"],
                "column": nb["column"],
                "width": nb["width"],
                "height": nb["height"],
            })
    return {"layout_id": lid, "layout_component_ids": cmap}

def upsert_udd(title, folder_id=None, filters=None, tiles=None, dashboard_id=None):
    fid = str(folder_id or _t_folder_id or _active.get("folderId") or _active.get("folder_id") or "1")
    did = str(dashboard_id or _active.get("id") or "")
    if did and "::" not in did:
        d = update_dashboard(did, {"title": title})
    else:
        d = create_dashboard({"title": title, "folder_id": fid, "show_filters_bar": True})
        did = str(d.get("id"))
    f_names = list(_active.get("filter_names") or _active.get("filterNames") or [])
    for f in (filters or []):
        fname = str(f.get("name") or f.get("title") or "Filter").replace(".", "_")
        fbody = {
            "dashboard_id": did,
            "name": fname,
            "title": str(f.get("title") or fname),
            "type": str(f.get("type") or "field_filter"),
            "model": f.get("model") or _t_model,
            "explore": f.get("explore") or _t_explore,
            "dimension": f.get("dimension") or f.get("field"),
            "default_value": str(f.get("default_value") or ""),
            "allow_multiple_values": bool(f.get("allow_multiple_values", True)),
            "row": int(f.get("row", 0)),
        }
        if f.get("ui_config"):
            fbody["ui_config"] = f["ui_config"]
        if fname in _fcache:
            update_dashboard_filter(str(_fcache[fname]), fbody)
        elif fname not in f_names:
            cf = create_dashboard_filter(fbody)
            if cf and cf.get("id"):
                _fcache[fname] = str(cf["id"])
            f_names.append(fname)
    el_ids = list(_active.get("element_ids") or _active.get("elementIds") or [])
    elements_meta = []
    boxes = []
    for idx, t in enumerate(tiles or []):
        q = t.get("query") or t
        qbody = {
            "model": q.get("model") or _t_model,
            "view": q.get("view") or q.get("explore") or _t_explore,
            "fields": list(q.get("fields") or []),
            "filters": dict(q.get("filters") or {}),
            "sorts": list(q.get("sorts") or []),
            "limit": str(q.get("limit") or "500"),
            "vis_config": dict(q.get("vis_config") or t.get("vis_config") or {"type": t.get("vis_type") or "looker_grid"}),
        }
        if q.get("pivots"):
            qbody["pivots"] = list(q["pivots"])
        qk = _canonical_qkey(qbody)
        qid = _qcache.get(qk)
        if not qid:
            cq = create_query(qbody)
            qid = str(cq["id"])
            _qcache[qk] = qid
        raw_listen = t.get("listen")
        listen_arr = []
        if isinstance(raw_listen, dict):
            for k, v in raw_listen.items():
                listen_arr.append({"dashboard_filter_name": str(k).replace(".", "_"), "field": str(v)})
        elif isinstance(raw_listen, list):
            for item in raw_listen:
                if isinstance(item, dict) and item.get("dashboard_filter_name") and item.get("field"):
                    listen_arr.append({"dashboard_filter_name": str(item["dashboard_filter_name"]).replace(".", "_"), "field": str(item["field"])})
        ebody = {
            "dashboard_id": did,
            "title": str(t.get("title") or f"Tile {idx + 1}"),
            "type": "vis",
            "query_id": qid,
        }
        if listen_arr:
            ebody["result_maker"] = {"filterables": [{"model": qbody["model"], "view": qbody["view"], "listen": listen_arr}]}
        eid = str(t.get("element_id") or (el_ids[idx] if idx < len(el_ids) and t.get("in_place", True) else ""))
        if eid:
            el = update_dashboard_element(eid, ebody)
            eid = str(el.get("id") or eid)
        else:
            el = create_dashboard_element(ebody)
            eid = str(el.get("id"))
            el_ids.append(eid)
        nb = _norm_box(t, idx)
        nb["element_id"] = eid
        boxes.append(nb)
        elements_meta.append({"id": eid, "title": ebody["title"], "type": qbody["vis_config"].get("type", "vis"), "model": qbody["model"], "explore": qbody["view"], **nb})
    lay_res = reflow_24col(did, boxes)
    return {
        "dashboard_id": did,
        "title": title,
        "folder_id": fid,
        "layout_id": lay_res["layout_id"],
        "element_ids": el_ids,
        "filter_names": f_names,
        "layout_component_ids": lay_res["layout_component_ids"],
        "query_cache": _qcache,
        "filter_cache": _fcache,
        "tile_count": len(el_ids),
        "filter_count": len(f_names),
        "elements": elements_meta,
    }

def upsert_lookml_dashboard(project_id="", model="", dashboard_name="executive_pulse", title="Executive Pulse", tiles=None, filters=None, yaml_content=None, folder_id=None, sync_udd_id=None, model_file_path=None):
    m = str(model or _t_model or _active.get("model") or "thelook")
    proj = str(project_id or _t_project_id or _active.get("projectId") or _active.get("project_id") or "")
    if not proj and m:
        try:
            proj = str(lookml_model(m).get("project_name") or "")
        except Exception:
            proj = ""
    raw_slug = str(dashboard_name or "executive_pulse").replace(".dashboard.lookml", "").strip()
    if "::" in raw_slug:
        m, raw_slug = raw_slug.split("::", 1)
    slug = raw_slug.replace(".", "_").replace(" ", "_").lower()
    lookml_id = f"{m}::{slug}"
    if yaml_content:
        ytxt = str(yaml_content).strip()
        if not ytxt.startswith("- dashboard:"):
            ytxt = f"- dashboard: {slug}\\n  title: {json.dumps(str(title or slug))}\\n  layout: newspaper\\n  " + ytxt
    else:
        lines = [
            f"- dashboard: {slug}",
            f"  title: {json.dumps(str(title or slug))}",
            "  layout: newspaper",
            "  preferred_viewer: dashboards-next",
            "  crossfilter_enabled: true",
            "  query_timezone: user_timezone",
        ]
        if filters:
            lines.append("  filters:")
            for f in filters:
                fn = str(f.get("name") or f.get("title") or "filter").replace(".", "_").replace(" ", "_").lower()
                lines.extend([
                    f"  - name: {fn}",
                    f"    title: {json.dumps(str(f.get('title') or fn))}",
                    f"    type: {str(f.get('type') or 'field_filter')}",
                    f"    model: {str(f.get('model') or m)}",
                    f"    explore: {str(f.get('explore') or _t_explore or 'order_items')}",
                    f"    field: {str(f.get('dimension') or f.get('field') or '')}",
                    f"    default_value: {json.dumps(str(f.get('default_value') or ''))}",
                    "    allow_multiple_values: true",
                ])
        if tiles:
            lines.append("  elements:")
            for idx, t in enumerate(tiles):
                q = t.get("query") or t
                vc = dict(q.get("vis_config") or t.get("vis_config") or {})
                vt = str(vc.get("type") or t.get("type") or "looker_grid")
                en = str(t.get("name") or t.get("title") or f"tile_{idx + 1}").replace(".", "_").replace(" ", "_").lower()
                tm = str(q.get("model") or t.get("model") or m)
                te = str(q.get("view") or q.get("explore") or t.get("explore") or "order_items")
                flds = list(q.get("fields") or t.get("fields") or [])
                srts = list(q.get("sorts") or t.get("sorts") or [])
                lim = str(q.get("limit") or t.get("limit") or "500")
                nb = _norm_box(t, idx)
                lines.extend([
                    f"  - name: {en}",
                    f"    title: {json.dumps(str(t.get('title') or en))}",
                    f"    model: {tm}",
                    f"    explore: {te}",
                    f"    type: {vt}",
                    f"    fields: [{', '.join(str(x) for x in flds)}]",
                ])
                if srts:
                    lines.append(f"    sorts: [{', '.join(str(x) for x in srts)}]")
                lines.append(f"    limit: {lim}")
                for vk, vv in vc.items():
                    if vk != "type" and isinstance(vv, (str, int, float, bool)):
                        lines.append(f"    {vk}: {json.dumps(vv)}")
                lsn = t.get("listen")
                if isinstance(lsn, dict) and lsn:
                    lines.append("    listen:")
                    for fk, fv in lsn.items():
                        lines.append(f"      {str(fk).replace('.', '_')}: {fv}")
                elif isinstance(lsn, list) and lsn:
                    lines.append("    listen:")
                    for item in lsn:
                        if isinstance(item, dict) and item.get("dashboard_filter_name") and item.get("field"):
                            lines.append(f"      {str(item['dashboard_filter_name']).replace('.', '_')}: {item['field']}")
                lines.extend([
                    f"    row: {nb['row']}",
                    f"    col: {nb['col']}",
                    f"    width: {nb['width']}",
                    f"    height: {nb['height']}",
                ])
        ytxt = "\\n".join(lines) + "\\n"
    fpath = f"dashboards/{slug}.dashboard.lookml"
    if proj:
        try:
            create_project_directory(proj, "dashboards")
        except Exception:
            pass
        try:
            create_file(proj, {"path": fpath, "content": ytxt})
        except Exception:
            try:
                update_file(proj, {"path": fpath, "content": ytxt})
            except Exception:
                fpath = f"{slug}.dashboard.lookml"
                try:
                    create_file(proj, {"path": fpath, "content": ytxt})
                except Exception:
                    update_file(proj, {"path": fpath, "content": ytxt})
        mpath = model_file_path or f"models/{m}.model.lkml"
        mc = ""
        try:
            mc = str(get_file_content(proj, mpath) or "")
        except Exception:
            mpath = f"{m}.model.lkml"
            try:
                mc = str(get_file_content(proj, mpath) or "")
            except Exception:
                mc = ""
        if mc and ".dashboard.lookml" not in mc:
            inc = 'include: "/dashboards/*.dashboard.lookml"\\n' if fpath.startswith("dashboards/") else 'include: "*.dashboard.lookml"\\n'
            try:
                update_file(proj, {"path": mpath, "content": inc + mc})
            except Exception:
                pass
    synced_udd = str(sync_udd_id or "")
    fid = str(folder_id or _t_folder_id or _active.get("folderId") or _active.get("folder_id") or "")
    if synced_udd:
        try:
            sync_lookml_dashboard(lookml_id, dashboard_ids=[synced_udd])
        except Exception:
            pass
    elif fid:
        try:
            imp = import_lookml_dashboard(lookml_id, fid)
            if imp and imp.get("id"):
                synced_udd = str(imp["id"])
        except Exception:
            pass
        if not synced_udd:
            try:
                udd_res = upsert_udd(title, folder_id=fid, filters=filters, tiles=tiles)
                if udd_res and udd_res.get("dashboard_id"):
                    synced_udd = str(udd_res["dashboard_id"])
            except Exception:
                pass
    return {
        "id": lookml_id,
        "lookml_dashboard_id": lookml_id,
        "dashboard_id": synced_udd or lookml_id,
        "content_type": "lookml_dashboard",
        "project_id": proj,
        "model": m,
        "file_path": fpath,
        "folder_id": fid,
        "sync_action": "import_lookml_dashboard",
        "title": title,
        "embed_path": f"/embed/dashboards/{synced_udd or lookml_id}",
        "tile_count": len(tiles or []),
        "filter_count": len(filters or []),
    }

def pin_to_board(title, description="", section_title="Executive Overview", dashboard_id=None, lookml_dashboard_id=None, look_id=None, board_id=None):
    bid = str(board_id or _active.get("boardId") or _active.get("board_id") or "")
    if bid:
        b = update_board(bid, {"title": title, "description": description})
        bid = str(b.get("id") or bid)
    else:
        b = create_board({"title": title, "description": description})
        bid = str(b.get("id"))
    sec = create_board_section({"board_id": bid, "title": section_title})
    sid = str(sec.get("id"))
    items = []
    if dashboard_id:
        if "::" in str(dashboard_id) and not lookml_dashboard_id:
            lookml_dashboard_id = str(dashboard_id)
        else:
            it = create_board_item({"board_section_id": sid, "dashboard_id": str(dashboard_id), "custom_description": "Primary UDD KPI & trend breakdown", "use_custom_description": True})
            items.append(str(it.get("id")))
    if lookml_dashboard_id:
        it = create_board_item({"board_section_id": sid, "lookml_dashboard_id": str(lookml_dashboard_id), "custom_description": "Version-controlled LookML Dashboard", "use_custom_description": True})
        items.append(str(it.get("id")))
    if look_id:
        it = create_board_item({"board_section_id": sid, "look_id": str(look_id), "custom_description": "Top-customer cohort retention Look", "use_custom_description": True})
        items.append(str(it.get("id")))
    return {"board_id": bid, "section_id": sid, "item_ids": items}

def schedule_dashboard(dashboard_id, name="Weekly Executive Digest", crontab="0 9 * * 1", email="exec-team@example.com", fmt="wysiwyg_pdf", filters_string=""):
    did = str(dashboard_id or _active.get("id") or "")
    fstr = str(filters_string or "").strip()
    if fstr and not fstr.startswith("?"):
        fstr = "?" + fstr.replace(" ", "%20")
    body = {
        "name": name,
        "crontab": crontab,
        "datagroup": None,
        "filters_string": fstr,
        "require_results": False,
        "require_no_results": False,
        "require_change": False,
        "send_all_results": False,
        "scheduled_plan_destination": [{
            "format": fmt or "wysiwyg_pdf",
            "apply_formatting": True,
            "apply_vis": True,
            "address": email,
            "type": "email",
            "message": "Automated weekly KPI digest."
        }],
    }
    if "::" in did:
        body["lookml_dashboard_id"] = did
    else:
        body["dashboard_id"] = int(did) if did.isdigit() else did
    sp = create_scheduled_plan(body)
    return str(sp.get("id") or "")

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
    payload.update({
        "id": cid,
        "content_type": ctype,
        "contentType": ctype,
        "title": title,
        "folder_id": fid,
        "folderId": fid,
        "embed_path": epath,
        "url": epath,
        "summary": str(merged.get("summary") or title),
        "explores": exps,
        "query_cache": _qcache,
        "filter_cache": _fcache,
    })
    payload.pop("NATIVE_CONTENT_BUNDLE", None)
    return {"NATIVE_CONTENT_BUNDLE": payload, **payload}
`

export function wrapDashboardCodeMode(code: string): string {
  const trimmed = String(code || '').trim()
  if (!trimmed || trimmed.includes('def upsert_udd(')) return trimmed
  return `${DASHBOARD_CODEMODE_PREAMBLE_PY}\n${trimmed}`
}

export const NATIVE_CONTENT_GUIDE_MD = `# Native Looker Content Studio (/dashboard) — Compact Recipe Guide

## 1. Pre-Injected Monty Python Helpers in \`run_looker_codemode\`
- \`upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)\`: Creates/updates a User-Defined Dashboard (UDD), deduplicates \`create_query\`, wires \`create_dashboard_filter\` + \`result_maker.filterables[].listen\`, and positions all tiles on Looker's 24-column grid via \`dashboard_dashboard_layouts\` + \`update_dashboard_layout_component\`.
- \`upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)\`: Writes \`dashboards/<name>.dashboard.lookml\` (\`create_file\` / \`update_file\`) with \`- dashboard:\`, \`layout: newspaper\`, \`filters:\`, \`elements:\`, \`listen:\`, and 24-col \`row\`/\`col\`/\`width\`/\`height\`, ensures \`include: "*.dashboard.lookml"\` in \`{model}.model.lkml\`, and imports/syncs a linked UDD into \`folder_id\` (\`import_lookml_dashboard\` / \`sync_lookml_dashboard\` / \`upsert_udd\`). Never call \`update_session\` in \`run_looker_codemode\`.
- \`reflow_24col(dashboard_id, boxes)\`: Reflows 24-column \`dashboard_layout_components\` in place without duplicating or orphaning existing tiles.
- \`pin_to_board(title, description, section_title, dashboard_id=..., lookml_dashboard_id=..., look_id=...)\`: Creates a Board + Section (\`create_board\`, \`create_board_section\`, \`create_board_item\`) pinning UDDs, LookML Dashboards (\`lookml_dashboard_id\`), and Saved Looks (\`create_look\`).
- \`schedule_dashboard(dashboard_id, name, crontab="0 9 * * 1", email="...", fmt="wysiwyg_pdf", filters_string="...")\`: Attaches a weekly Scheduled Plan (\`create_scheduled_plan\`) with normalized \`scheduled_plan_destination\` defaults.
- \`emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", id=..., title=..., **extra)\`: Returns \`NATIVE_CONTENT_BUNDLE\` directly from \`run_looker_codemode\` so the host captures it with zero LLM echo tokens.

## 2. 24-Column Grid & Visualization Standards
- Row 0 (\`height: 4\`): 3 KPI scorecards at \`col: 0, 8, 16, width: 8\` (\`type: "single_value"\`, \`value_format: "$#,##0"\`, \`show_comparison: True\`, \`comparison_type: "change"\`).
- Row 4 (\`height: 8\`): 2 side-by-side Cartesian charts at \`col: 0, width: 12\` and \`col: 12, width: 12\` (\`looker_line\` / \`looker_column\`, dual unpinned Y-axes \`y_axis_combined: False\`, \`reference_lines\`, \`advanced_vis_config\` JSON string with \`defaults_version: 1\`).
- Row 12 (\`height: 8\`): Full-width \`looker_grid\` at \`col: 0, width: 24\` (or 2 cross-explore tiles at \`row: 12, col: 0/12, width: 12\` + full-width \`looker_grid\` reflowed to \`row: 20, col: 0, width: 24, height: 8\`).
- Filter & element \`name\` identifiers must NEVER contain periods (\`.\`); use underscores (e.g. \`date_range\`, \`order_status\`, \`min_sale_price\`).
`

export function buildNativeContentGuide(params: {
  selectedExplores: string[]
  primaryModel: string
  primaryExplore: string
  folderId?: string
  lookmlProjectId?: string
  existingNativeContent?: NativeContentState | null
}): string {
  const {
    selectedExplores,
    primaryModel,
    primaryExplore,
    folderId = '1',
    lookmlProjectId = '',
    existingNativeContent,
  } = params
  const exploreDirective =
    selectedExplores.length > 0
      ? `for selected Looker explore(s): ${selectedExplores.map((id) => `"${id}"`).join(', ')}.`
      : lookmlProjectId
      ? `for LookML project/model "${lookmlProjectId}" (default explore "${primaryExplore || 'order_items'}").`
      : `where no explore was pre-selected — pick the best \`model_id::explore_id\` from /workspace/schema.md or \`search_content(terms="...", types="lookml_explore")\`.`
  const existingNativeDirective = existingNativeContent
    ? `Active native Looker ${existingNativeContent.contentType}: id="${existingNativeContent.id}", title="${existingNativeContent.title}", folder_id="${existingNativeContent.folderId}" (pre-injected in CodeMode as \`active_content\`). Update it in place without redundant read calls unless the user asks for a brand-new item.`
    : `Create the requested native Looker content in folder_id=\`target_folder_id\` ("${folderId}").`
  const lookmlOnboardingDirective = lookmlProjectId
    ? `4. LookML Project Onboarding Dashboard Rule: Because \`target_project_id\`="${lookmlProjectId}" is active, call \`res = upsert_lookml_dashboard(project_id="${lookmlProjectId}", model="${primaryModel || lookmlProjectId}", dashboard_name="ecommerce_overview", title="E-Commerce Performance Overview", folder_id="${folderId}", filters=[...], tiles=[...])\` and \`return emit_native_bundle(res, folder_id="${folderId}", title="E-Commerce Performance Overview")\` so the LookML dashboard (\`dashboards/ecommerce_overview.dashboard.lookml\`) is both saved to the LookML project and copied/imported into folder_id="${folderId}". In your text response, confirm the LookML dashboard (\`.dashboard.lookml\`) was created and copied to the selected folder, and **ask the user if they want a responsive metric selector Data App** that takes these measures and switches between **day (date), week, month, and year** and different chart types.`
    : ''

  return [
    `You are operating in Native Looker Content Studio mode (/dashboard/:id?) ${exploreDirective}`,
    existingNativeDirective,
    NATIVE_CONTENT_GUIDE_MD,
    `Follow these exact steps in ONE \`run_looker_codemode\` call per turn (remote bash \`code_execution\` is disabled in /dashboard mode; always pass a concise 1-sentence \`thought\` string describing the Looker API action; NEVER call \`update_session\`):`,
    `1. On cold start, discover fields via \`lookml_model_explore(m, e, fields="name,label,fields(dimensions(name,label,type),measures(name,label,type))")\` (or reuse fields from conversation history), then build/update the UDD (\`upsert_udd\`), LookML Dashboard (\`upsert_lookml_dashboard\` + \`import_lookml_dashboard\` / \`sync_lookml_dashboard\`), Saved Look (\`create_look\`), Board (\`pin_to_board\`), or Schedule (\`schedule_dashboard\`) in the SAME \`run_looker_codemode\` script.`,
    `2. End your Python script with \`return emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", summary="...")\` (with \`target_folder_id\`="${folderId}", \`target_explores\`=${JSON.stringify(selectedExplores)}, \`target_model\`="${primaryModel || lookmlProjectId}", \`target_explore\`="${primaryExplore || 'order_items'}", \`target_project_id\`="${lookmlProjectId}").`,
    `3. CRITICAL: The host extracts \`<NATIVE_CONTENT_BUNDLE>\` / \`NATIVE_CONTENT_BUNDLE\` directly from your \`run_looker_codemode\` return value. Do NOT echo or repeat \`<NATIVE_CONTENT_BUNDLE>...</NATIVE_CONTENT_BUNDLE>\` in your final text response — reply with a concise 1–2 sentence summary only.`,
    ...(lookmlOnboardingDirective ? [lookmlOnboardingDirective] : []),
  ].join('\n')
}

export const CONVERSATION_LABEL_REQUEST_TAG = '[CONVERSATION_LABEL_REQUEST]'
export const STARTER_PROMPTS_REQUEST_TAG = '[STARTER_PROMPTS_REQUEST]'

export const AGENTS_MD = `# Looker Data Apps

This directory is an installed Looker Data Apps environment. A **Data App** is a
code-first application for Looker, authored as a single self-contained ES module
in \`apps/<name>/app.js\` and published directly into Looker dashboard tiles.

## Looker Code Mode Tool Contract (\`run_looker_codemode\`)

Whenever calling \`run_looker_codemode\`, you **must** always pass both \`code\` and a concise 1-sentence \`thought\` string summarizing what the Code Mode snippet is doing with the Looker API calls (e.g. \`"Querying monthly revenue and brand share from thelook::order_items"\` or \`"Creating executive KPI dashboard with 4 tiles"\`).

## Sandbox CLI Bootstrap (\`uv\` + \`lkr-dev-cli\`)

New Antigravity sandbox environments (\`user_env:\${me.id}\`) bootstrap \`uv\` and a pinned release of \`lkr-dev-cli\` (\`${LKR_DEV_CLI_VERSION}\`) into \`/usr/local/bin\` via \`/workspace/bootstrap_lookml.py\` so both persist in the container's GCS overlay snapshot (\`{env_id}/snapshot.tar\`):
1. \`pip install --break-system-packages --quiet uv\` (if \`uv\` is not on \`PATH\`).
2. \`UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"\`.

## Conversation Labeling (Stateless Side-Request)

When a prompt starts with or contains \`[CONVERSATION_LABEL_REQUEST]\`, you are handling an out-of-band, stateless conversation labeling request:
1. Return **only** a single-line concise title of **3–6 words** in plain text (no quotes, no markdown formatting, no trailing period, no tags).
2. **Never** call \`lookup_skill\`, \`code_execution\`, \`run_looker_codemode\`, or read any \`.agents/skills/*\` file.

## Dynamic Starter Prompts (Stateless Side-Request)

When a prompt starts with or contains \`[STARTER_PROMPTS_REQUEST]\`, you are handling an out-of-band, stateless starter prompt synthesis request:
1. Inspect the active \`useCase\`, permitted use cases, discovered LookML explore/field metadata (\`model::explore\`, dimensions, measures), and recent user content (\`content_summary\` dashboards and Looks).
2. Do **not** call any tools (\`lookup_skill\`, \`code_execution\`, \`run_looker_codemode\`) or read any skill files.
3. Reply with **only** 3–4 concise, tailored starter chips wrapped in \`<STARTER_PROMPTS>[...]</STARTER_PROMPTS>\` JSON (\`[{"id":"...","label":"3-6 word plain text without emojis","prompt":"1-sentence actionable prompt","useCase":"app|data-investigator|dashboard|conversational-analytics|lookml|health-check|tile"}]\`).

## Use Case Auto-Classification (Turn 1 Routing)

When handling a Studio turn (\`useCase="auto"\`), classify the current turn's prompt into **one** of the user's permitted Studio use cases and emit \`<USE_CASE>...</USE_CASE>\` at the start of your response before executing the matching workflow:

| Use Case ID | Label | Routing Intent & Trigger Signals |
| --- | --- | --- |
| \`app\` | **Data App** | Custom interactive Lit web component Data App (\`apps/<name>/app.js\`, \`skills/data-apps/SKILL.md\`), metric switchers, custom UI layouts, \`<app-kpi>\`, \`<app-chart>\`, \`<app-grid>\`, or screenshot-to-app conversion |
| \`data-investigator\` | **Data Investigator** | Point-in-time root-cause narrative Data App in Google Doc (\`doc\`, default) or Google Presentation (\`slides\` / \`presentation\` / \`deck\`) format for prompts asking to \`"investigate"\`, \`"find out"\`, \`"figure out"\`, \`"dig into"\`, \`"what drove"\`, or \`"what caused"\` across data, metrics, dashboards, Looks, or explores using \`skills/data-investigator/SKILL.md\` and \`skills/key-driver-analysis/SKILL.md\` (\`skills/key-driver-analysis/scripts/kda_toolkit.py\`, \`run_key_driver_analysis\`), LookML \`drill_fields\` (\`limit: '500'\`), fixed date ranges (\`YYYY-MM-DD to YYYY-MM-DD\`), and sequential **Chart -> What This Chart Means -> Next Investigation Path** chapters |
| \`dashboard\` | **Content Studio** | Native Looker User-Defined Dashboards (UDDs), LookML Dashboards (\`.dashboard.lookml\`), Saved Looks, Boards, or Scheduled Plans (\`upsert_udd\`, \`upsert_lookml_dashboard\`, \`pin_to_board\`, \`schedule_dashboard\`) |
| \`lookml\` | **Agentic LookML** | Authoring or refactoring LookML models, views, explores, refinements (\`.lkml\`), onboarding a new Looker project from a database connection (\`skills/looker-project-onboarding/SKILL.md\`), SQL-to-LookML parity, field curation/descriptions, or LookML data tests (\`.test.lkml\`) |
| \`health-check\` | **Health Check** | 3-Pillar Looker & BigQuery Health Check audit (System Activity Pillar 1, LookML 0–4 Transcriber Rubric Pillar 2, BigQuery \`INFORMATION_SCHEMA\` Pillar 3, \`TECHNICAL_DESIGN_DOCUMENT.md\`) |
| \`tile\` | **Python Tile** | Custom \`LkrCodeMode\` Monty Python script tile (\`obj_script_<id>\`, \`vars.dashboard_filters\`, custom Python table/markdown/dict output, or script scheduler), plus ad-hoc Looker SDK / instance / space / folder / personal space / user / permission / schedule inspection queries via \`run_looker_codemode\` (e.g. \`"tell me what my personal space is"\`, \`"can you find me all personal spaces that don't have dashboards"\`) |
| \`conversational-analytics\` | **Conversational Analytics** | Ad-hoc natural-language analytical Q&A, explore data questions, KPI lookups, or trend explanations without building a persistent app or LookML file |

- **Conversational & Follow-Up Questions (No-Op)**: When the prompt is a greeting, help request, meta/diagnostic question about prior turns or errors (\`"can you summarize the errors you experienced"\`, \`"what went wrong?"\`, \`"how can I make you better?"\`), or a conversational follow-up question that does not ask for a new or updated right-pane artifact (\`"hello"\`, \`"hi"\`, \`"help"\`, \`"what can you do?"\`), answer directly in chat (calling zero tools for greetings/meta-questions) and do **not** create or open any right-pane content item or redirect to an isolated CA sub-agent.
- **Script (\`tile\`) Routing for Ad-Hoc Looker Instance / Folder / Content Inventory / SDK Queries**: Route prompts asking to inspect or query Looker spaces, folders, personal spaces, favorite dashboards, dashboards/Looks in folders, users, permissions, schedules, or instance metadata via SDK (e.g. \`"tell me what my personal space is"\`, \`"What dashboards are in my personal"\`, \`"what are my favorite dashboards"\`, \`"can you find me all personal spaces that don't have dashboards"\`) to \`<USE_CASE>tile</USE_CASE>\` / \`run_looker_codemode\` without creating a Data App, Dashboard, or unprompted right-pane Script. Format folder/content lists with clickable links (\`[Title](/dashboards/<id>)\`, \`[Title](/looks/<id>)\`, \`[Folder](/folders/<folder_id>)\`) using \`format_content_inventory(folders)\` (showing all items when \`<= 5\` items in a single folder, or grouping by folder with at most **2** links per folder + \`"See all <count> items in [Folder](/folders/<folder_id>)"\` + saving the full unfiltered list to \`/workspace/content_inventory.md\` when \`> 5\` total items or multiple folders), and ask the user if they want to save the lookup as a reusable Script.
- **Open-Ended Analytical Questions & \`search_agents()\` in \`run_looker_codemode\`**: When an open-ended analytical question is asked without an explicit artifact request, call \`search_agents()\` inside \`run_looker_codemode\` to inspect accessible Looker Conversational Analytics (CA) agents (\`name\`, \`description\`, \`explores\`, \`golden_queries\`). Compare the user's question against CA agents vs. direct Looker SDK calls: if a CA agent covers the domain/explores, emit \`<USE_CASE>conversational-analytics</USE_CASE>\` and \`<CA_AGENT_SELECTION>{"agent_id":"<matched_id>","rationale":"<1-sentence reason>"}</CA_AGENT_SELECTION>\`; if no CA agent matches or it is an instance/metadata question, answer directly via \`run_looker_codemode\`.

Always restrict your \`<USE_CASE>\` choice to the allowed modes list provided in the prompt (\`Allowed use cases for this user: [...]\`). Emit \`<USE_CASE>...</USE_CASE>\` for the current turn's target workflow on every turn so Studio routes dynamically and appends or updates the resulting item in the conversation's \`contentItems\` tabs.
`

export const APP_BUILDER_SYSTEM_PROMPT = AGENTS_MD

export const LOOKER_PROJECT_ONBOARDING_SKILL_MD = `---
name: looker-project-onboarding
description: End-to-end Looker Project Onboarding skill for creating a new LookML project, bare Git repo, model, Bronze/Silver Medallion views and explores, LookML dashboard, and Metric Selector Data App from an existing Looker database connection.
---

# Looker Project Onboarding (\`skills/looker-project-onboarding/SKILL.md\`)

Use this skill when a user asks to onboard or create a new Looker project, scaffold a new LookML project from a database connection, or walk through the staged onboarding workflow (Model & Bronze -> Data Profiling & Silver Metrics -> LookML Dashboard -> Metric Selector Data App). All Looker API calls execute through \`run_looker_codemode\` routed via \`transport.rawRequest\` (\`raw_api_request: yes\`, requiring zero \`core_api_methods\` in \`manifest.lkml\`) and \`lkr --dev tools lookml push\`. Never call \`update_session\` inside \`run_looker_codemode\` — dev mode is controlled by the app session or the \`--dev\` CLI flag.

## Step 1: Conversational Intake & Verify Database Connection (\`run_looker_codemode\`)
1. **Turn 1 Intake (Missing Inputs -> Ask Immediately with 0 Tool Calls)**:
   When the user says \`"create a new project"\` (or asks to onboard a new project) without providing a **connection name**, **project name**, and **target tables or schemas**, emit \`<USE_CASE>lookml</USE_CASE>\` and **immediately ask the user** for:
   - **Connection name** (or check \`[Open Looker Connections](/admin/connections)\` \`/admin/connections\`)
   - **Project name** (\`snake_case\`)
   - **Target tables or schemas** (or SQL queries from \`[Open SQL Runner](/sql)\` \`/sql\`).
   Do **not** call \`run_looker_codemode\` or \`code_execution\` on Turn 1 when these inputs are not yet provided.
2. **Turn 2 Schema Discovery (\`connection_schemas\`)**:
   When the user provides a connection name (e.g. \`default_bigquery_connection\`) and project name and asks what schemas it has access to, emit \`<USE_CASE>lookml</USE_CASE>\`, run **one** \`run_looker_codemode\` call (\`sdk.connection_schemas(connection_name)\` with fallback to \`sdk.all_connections(fields="name,dialect_name,database,schema,snippets")\` and \`sdk.connection_tables(connection_name, schema_name=..., table_limit=5)\`), list out the accessible schemas clearly (e.g. \`argolis_scratch\`, \`cymbal_lakehouse\`, \`streaming_analytics\`, \`thelook\`), and ask which schema/dataset to use.

## Step 2: Require \`project_name\` (\`snake_case\`) & Discover Schemas, Tables, or User SQL Queries
1. \`project_name\` is required before creating any project or model. Normalize any user-supplied project name to strict lowercase \`snake_case\`:
   \`project_name = re.sub(r'_+', '_', re.sub(r'[^a-z0-9_]', '_', raw_name.strip().lower())).strip('_')\`
   If the user has not provided a \`project_name\`, ask them for one.
2. Ask the user which schemas/tables to include or whether they have 1 or more SQL queries from SQL Runner (\`[Open SQL Runner](/sql)\`, \`/sql\`) representing their core reporting workload.
3. Bound schema/table auto-discovery to at most **5 schemas** and **5 tables per schema** (\`5 × 5\` cap: \`schemas[:5]\` and \`connection_tables(conn_name, schema_name=sname, table_limit=5)\` \`tables[:5]\`) plus \`sdk.connection_columns(conn_name, schema_name=sname, table_names=",".join(tables))\`. When the user names \`thelook\` (\`argolis_scratch\` / \`looker-private-demo.thelook\`), target the core tables (\`order_items\`, \`users\`, \`products\`, \`distribution_centers\`) in \`argolis_scratch\` (or the matching schema on the connection).

## Step 3: Stage 1 (Turn 3) — Create Project, Scaffold Model & \`bronze/\` Folders Only, Push via \`lkr --dev tools lookml push\`, and Ask to Profile Data
1. Do **not** call \`update_session\` in \`run_looker_codemode\`. \`lkr --dev tools lookml push\` automatically creates the project (\`sdk.create_project({"name": project_name})\` / \`sdk.project(project_name)\`), configures bare Git (\`sdk.update_project(project_name, {"git_service_name": "bare"})\`), creates remote directories, and creates/updates the LookML model (\`sdk.create_lookml_model\` / \`sdk.update_lookml_model\`). Only call \`run_looker_codemode\` on Turn 3 if you need \`sdk.connection_columns(conn_name, schemas=sname, table_names=",".join(tables))\` for an unknown schema (for \`thelook\` / \`argolis_scratch\`, the core tables \`order_items\`, \`users\`, \`products\`, \`distribution_centers\` are known — skip extra discovery calls).
2. In \`/workspace/lookml/\`, create **only** the model file and the **\`bronze/\` folder** base views and base explores on this turn in **ONE** \`code_execution\` call (do **not** create refinements or \`silver/\` files yet):
   - \`/workspace/lookml/<project_name>.model.lkml\` (\`connection: "<conn_name>"\`, \`include: "/bronze/*.view.lkml"\`, \`include: "/bronze/explores/*.explore.lkml"\`).
   - \`/workspace/lookml/bronze/<table>.view.lkml\` (\`sql_table_name: \\\`argolis_scratch.<table>\\\` ;;\`) for \`order_items\`, \`users\`, \`products\`, \`distribution_centers\` with raw dimensions (\`id\`, foreign keys \`order_id\`, \`user_id\`, \`product_id\`, \`inventory_item_id\`, \`distribution_center_id\`, \`status\`, \`sale_price\`, \`cost\`, \`retail_price\`, \`category\`, \`brand\`, \`department\`, \`name\`, \`country\`, \`state\`, \`gender\`, \`traffic_source\`), \`dimension_group\`s (\`created\`, \`shipped\`, \`delivered\`, \`returned\` with \`timeframes: [raw, time, date, week, month, quarter, year]\`), and base \`measure: count { type: count }\`.
   - \`/workspace/lookml/bronze/explores/order_items_base.explore.lkml\` (\`include: "/bronze/*.view.lkml"\`, \`explore: order_items_base { view_name: order_items label: "Order Items (Bronze)" }\`).
3. In that **same** \`code_execution\` call, push all files to Looker using \`lkr --dev tools lookml push\` and emit \`<LOOKML_BUNDLE>\`:
   \`\`\`bash
   python3 /workspace/bootstrap_lookml.py setup
   lkr --dev tools lookml push /workspace/lookml --project-id <project_name> --no-reset
   python3 /workspace/bootstrap_lookml.py bundle /workspace/lookml_result.json
   \`\`\`
   (where \`/workspace/lookml_result.json\` contains \`{"project_id": "<project_name>", "model_name": "<project_name>"}\`).
4. **Stop after creating the model and \`bronze/\` folder** and **ask the user if they want you to profile the data and take a stab at making metrics** (refinements and Silver explores with joins).

## Step 4: Stage 2 (Turn 4) — Profile Data, Create Refinements (\`bronze/*.refinement.lkml\`) & Silver Explores (\`silver/explores/*.explore.lkml\`), Show Example Query Data, and Ask for a Dashboard
1. When the user confirms profiling the data and making metrics, emit \`<USE_CASE>lookml</USE_CASE>\` and profile categorical values (e.g. distinct \`status\` in \`order_items\`: \`'Complete'\`, \`'Cancelled'\`, \`'Returned'\`, \`'Processing'\`, \`'Shipped'\`).
2. Follow \`agentic-lookml\` and the 5-layer measure synthesis methodology:
   - **Layer 1 — Medallion Refinements (\`bronze/<table>.refinement.lkml\`)**: Leave \`bronze/<table>.view.lkml\` untouched; create \`/workspace/lookml/bronze/<table>.refinement.lkml\` starting with \`include: "/bronze/<table>.view.lkml"\` and \`view: +<table> { ... }\` with \`dimension: id { primary_key: yes }\`. On \`order_items.refinement.lkml\`, also add a \`cancelled\` \`dimension_group\` (\`dimension_group: cancelled { type: time timeframes: [raw, time, date, week, month, quarter, year] sql: CASE WHEN \${status} = 'Cancelled' THEN \${created_raw} END ;; }\`) alongside \`returned\`, \`created\`, \`shipped\`, and \`delivered\`.
   - **Layer 2 — Core Statistical Measures per Numeric & Entity Column**: \`order_count\` (\`type: count_distinct\`, \`sql: \${order_id} ;;\`), \`user_count\` (\`type: count_distinct\`, \`sql: \${user_id} ;;\`), \`total_sale_price\` (\`type: sum\`, \`sql: \${sale_price} ;;\`, \`value_format_name: usd\`), \`average_sale_price\` (\`type: average\`, \`sql: \${sale_price} ;;\`, \`value_format_name: usd\`).
   - **Layer 3 — Data-Grounded Filtered Measures (Must Include \`return_count\` and \`cancel_count\`)**:
     - \`measure: return_count { type: count filters: [status: "Returned"] label: "Return Count" }\`
     - \`measure: cancel_count { type: count filters: [status: "Cancelled"] label: "Cancel Count" }\`
     - \`measure: completed_order_count { type: count filters: [status: "Complete"] label: "Completed Order Count" }\`
   - **Layer 4 — Portable ANSI Derived Ratios (\`type: number\`)**: Compose ratios from LookML measures via \`1.0 * \${numerator_measure} / NULLIF(\${denominator_measure}, 0)\` (e.g. \`return_rate\`, \`cancel_rate\`, \`average_order_value\`).
   - **Layer 5 — Silver Explores with Joins (\`silver/explores/order_items.explore.lkml\`)**: Deconstruct workload SQL (\`grain_change_reagg\`, \`window_pre_groupby\`, \`union\`, \`non_equi_join\`, \`filter_dependent_cte\`) and create \`/workspace/lookml/silver/explores/order_items.explore.lkml\` (\`extends: [order_items_base]\`, \`hidden: no\`, \`view_name: order_items\`) joining \`users\` (\`\${order_items.user_id} = \${users.id}\`, \`many_to_one\`), \`products\` (\`\${order_items.product_id} = \${products.id}\`, \`many_to_one\`), and \`distribution_centers\` (\`\${products.distribution_center_id} = \${distribution_centers.id}\`, \`many_to_one\`). Update \`/workspace/lookml/<project_name>.model.lkml\` to include \`"/bronze/*.refinement.lkml"\` and \`"/silver/explores/*.explore.lkml"\`.
3. Push and bundle via CLI:
   \`\`\`bash
   lkr --dev tools lookml push /workspace/lookml --project-id <project_name> --no-reset
   python3 /workspace/bootstrap_lookml.py bundle /workspace/lookml_result.json
   \`\`\`
4. **Query & Show Live Example Data**: In \`run_looker_codemode\`, run \`run_inline_query("json", {"model": project_name, "view": "order_items", "fields": ["products.department", "order_items.count", "order_items.total_sale_price", "order_items.return_count", "order_items.cancel_count"], "sorts": ["order_items.total_sale_price desc"], "limit": "5"})\`, render the returned rows in your response, and **ask the user if they want a dashboard with these metrics**.

## Step 5: Stage 3 (Turn 5) — Create LookML Dashboard, Copy into Selected UI Folder, and Offer Metric Selector Data App
1. When the user asks to create a dashboard with these metrics, emit \`<USE_CASE>dashboard</USE_CASE>\`.
2. In \`run_looker_codemode\`, call \`upsert_lookml_dashboard(project_id=project_name, model=project_name, dashboard_name="ecommerce_performance", title="E-Commerce Performance Overview", folder_id=target_folder_id, filters=[...], tiles=[...])\` (which creates \`dashboards/ecommerce_performance.dashboard.lookml\` and imports/copies it into \`target_folder_id\` via \`import_lookml_dashboard(lookml_id, str(target_folder_id), {"title": title})\` with fallback to \`upsert_udd\` in \`target_folder_id\`) and \`return emit_native_bundle(res, folder_id=target_folder_id, title="E-Commerce Performance Overview")\`.
3. In your text response, confirm the LookML dashboard was created and copied into the selected folder, and **ask the user if they want a responsive metric selector Data App** that takes the measures (\`total_sale_price\`, \`count\`, \`return_count\`, \`cancel_count\`) and switches between **date (day), week, month, and year** and **different chart types**.

## Step 6: Stage 4 (Turn 6) — Responsive Metric Selector Data App (90d/53w/60m/10y & Measure-Matched Date Dimensions)
1. When the user confirms building the metric selector Data App, emit \`<USE_CASE>app</USE_CASE>\` and write + bundle the Lit Data App in **ONE** \`code_execution\` call via \`python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "Metric Selector Explorer" << 'EOF'\` (do **not** inspect or decompile \`/workspace/bundle_app.py\` or \`/runtime\`).
2. **Required Timeframe Switcher & Default Lookback Windows**:
   - Switching timeframe granularity between \`day\` (\`date\`), \`week\`, \`month\`, and \`year\` MUST default the date filter window to:
     - \`day\` (\`date\`): \`'90 days'\`
     - \`week\`: \`'53 weeks'\`
     - \`month\`: \`'60 months'\`
     - \`year\`: \`'10 years'\`
3. **Required Measure Switcher, Chart Type Switcher & Measure-Matched Date Dimensions**:
   - Allow switching between measures (\`order_items.total_sale_price\`, \`order_items.count\`, \`order_items.return_count\`, \`order_items.cancel_count\`) and chart types (\`line\`, \`column\`, \`bar\`, \`areaspline\`).
   - **Date dimension MUST match the selected measure**:
     - When \`order_items.return_count\` (or a return metric) is selected, use the **\`returned\`** date dimension group (\`order_items.returned_date\`, \`order_items.returned_week\`, \`order_items.returned_month\`, \`order_items.returned_year\`).
     - When \`order_items.cancel_count\` (or a cancel metric) is selected, use the **\`cancelled\`** date dimension group (\`order_items.cancelled_date\`, \`order_items.cancelled_week\`, \`order_items.cancelled_month\`, \`order_items.cancelled_year\`).
     - When standard order/revenue metrics (\`order_items.total_sale_price\`, \`order_items.count\`) are selected, use the **\`created\`** date dimension group (\`order_items.created_date\`, \`order_items.created_week\`, \`order_items.created_month\`, \`order_items.created_year\`).
`

export const DATA_INVESTIGATOR_GUIDE_MD = `# Data Investigator — Narrative Root-Cause Data Apps (Google Doc & Slides)

When building a **Data Investigator** (\`data-investigator\`) app, author a self-contained Lit Data App (\`apps/<name>/app.js\`) that presents a point-in-time root-cause investigation as a structured **Google Doc** (default) or **Google Presentation (Slides)** narrative.

## 1. Format Selection & Header Mode Switcher (\`Doc View\` / \`Slides View\`)
- **Default Format = Google Doc Narrative (\`this.viewMode = 'doc'\`)** unless the user prompt explicitly mentions \`"slides"\`, \`"presentation"\`, \`"deck"\`, or \`"google presentation"\` (in which case initialize \`this.viewMode = 'slides'\` in \`constructor()\`).
- Always render an in-app header switcher (\`Doc View\` and \`Slides View\` buttons updating \`this.viewMode\`) so the reader can toggle between document and presentation layouts at any time.
- **Google Doc Mode (\`doc\`)**:
  - Render a clean document page container with a sticky chapter outline and an **Overview / Executive Summary** section stating the initial question/input, target Explore (\`model::explore\`), and the **fixed point-in-time date window** (\`YYYY-MM-DD to YYYY-MM-DD\`).
  - Follow the overview with sequential investigation chapters. Each chapter MUST contain three subsections in order:
    1. **Chart / Visual Evidence (\`<app-chart>\` / \`<app-kpi>\`)**
    2. **What This Chart Means** — quantitative callouts, segment shares, period deltas, and unexpected anomalies discovered in the query output.
    3. **Next Investigation Path** — the explicit drill hypothesis explaining *why* the next dimension or LookML \`drill_fields\` path is examined next.
  - Conclude with a root-driver chapter and a final \`limit="500"\` \`<app-grid>\` evidence table.
- **Google Presentation Mode (\`slides\`)**:
  - Render an interactive slide deck viewer (\`Slide \${this.activeSlide + 1} of \${slides.length}\`, \`Previous\` / \`Next\` buttons + \`ArrowLeft\` / \`ArrowRight\` keyboard navigation).
  - Each investigation step renders as a self-contained slide with a headline takeaway, \`<app-chart>\` / \`<app-kpi>\`, a **"What This Means"** bullet summary, and a **"Next Investigation Path"** footer transition.

## 2. LookML \`drill_fields\`, \`limit: '500'\`, & \`run_key_driver_analysis\` (\`skills/key-driver-analysis/SKILL.md\`)
- **Key Driver Analysis Skill & Toolkit**: \`/workspace/skills/key-driver-analysis/SKILL.md\` and \`/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py\` (\`resolve_source\`, \`inspect_explore_for_kda\`, \`analyze_target\`, \`run_kda\`, \`drill_top_driver\`, \`print_kda_summary\`) are pre-seeded in \`/workspace\`. Load \`/workspace/skills/key-driver-analysis/SKILL.md\` when running multi-target or recursive KDA across Explores, Queries, Looks, Dashboards, or Conversations.
- **Prioritize Predefined LookML \`drill_fields\`**: Inspect \`[Drills: \`...\`]\` annotations in \`/workspace/schema.md\` (or \`f.get("drill_fields")\` from \`lookml_model_explore\`) and follow the measure/dimension \`drill_fields\` hierarchy and related explore dimensions along the investigation path.
- **Enforce \`limit: '500'\`**: Set \`limit: '500'\` on all drill, breakdown, and evidence queries in \`data-investigator\` mode (\`run_inline_query("json", { ..., "limit": "500" })\` and \`.query=\${{ ..., limit: '500' }}\`).
- **Pre-Injected \`run_key_driver_analysis(body)\` (\`POST /api/4.0/internal/kda/analyze\`)**:
  - Available directly in \`run_looker_codemode\` as a read-only helper (\`requiresPermission: false\`).
  - Call \`run_key_driver_analysis({ "data_source": { "model_name": m, "explore_name": e }, "contribution_metric": "<view.measure>", "dimensions": ["<dim1>", "<dim2>"], "base_filters": { ... }, "baseline_filters": { "<date_dim>": "<fixed_baseline_range>" }, "breach_filters": { "<date_dim>": "<fixed_breach_range>" } })\` (up to 6 dimensions, or \`"data_source": { "query_id": qid }\`) to rank the dimensional segments driving the metric change. If KDA is unavailable on the instance, gracefully fall back to \`run_inline_query\` breakdowns across the top \`drill_fields\` dimensions with \`limit: "500"\`.

## 3. Strict Point-in-Time Fixed Dates Rule (\`YYYY-MM-DD to YYYY-MM-DD\`)
- A Data Investigation is a point-in-time record. **NEVER** use relative Looker date strings (\`"last 30 days"\`, \`"90 days"\`, \`"last quarter"\`, \`"this month"\`, \`"this year"\`, \`"yesterday"\`, \`"today"\`) in \`<app-kpi>\`, \`<app-chart>\`, or \`<app-grid>\` \`.query.filters\`.
- In \`run_looker_codemode\`, use pre-injected \`INVESTIGATION_ANCHOR_DATE\` and \`to_fixed_date_range(expr)\` (e.g. \`to_fixed_date_range("last 30 days")\` -> \`"2026-02-28 to 2026-03-30"\`) so every query and widget filter uses an explicit fixed date range (\`"YYYY-MM-DD to YYYY-MM-DD"\`).
`

export const DATA_APP_GUIDE_MD = `# Looker Lit Data Apps — Compact Sandbox Guide

## 1. Zero-Build ES Module Contract
- Import from \`/runtime/data-app.js\`:
  \`import { DataApp, html, nothing, keyed, formatValue, createNumericCol, createCurrencyCol, createPercentageCol, createBadgeCol } from '/runtime/data-app.js';\`
- No TypeScript decorators (\`@customElement\`, \`@property\`). Use \`static properties = { ... }\` and \`customElements.define(elementName, AppClass)\`.
- In \`constructor()\`, always assign literal strings \`this.lookerModel = '<model>'\` and \`this.explore = '<explore>'\`, plus initial reactive state (e.g. \`this.selectedMetric = 'order_items.total_sale_price'\`).
- Always route widget filters through \`getEffectiveFilters(local = {}, { isTimeSeries = false } = {})\` spreading \`{ ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) }\`.

## 2. Live Query Components (\`app-*\`)
- \`<app-kpi>\`: \`label\` (1-3 words), \`subtitle\`, \`query-field="view.measure"\` (or \`.query=\${{ fields: ['view.date_month', 'view.measure'], sorts: ['view.date_month desc'], limit: '12' }}\`), \`.filters=\${this.getEffectiveFilters()}\`, \`format="usd|usd2|int|decimal1|percent1|percent-100"\`, \`sparkline\`, \`sparkline-agg="sum|avg|last"\`, \`change="+12.4%"\`, \`change-type="positive|negative|neutral"\`, \`polarity="higher-better|lower-better"\`, \`bare\`, \`cell\`.
- \`<app-chart>\`: \`title\`, \`type="areaspline|line|column|bar|donut|pie|treemap|funnel|gauge"\`, \`value-format="usd|int|percent1"\`, \`color="var(--app-primary)"\`, \`cross-filter\` (or \`cross-filter="view.dim"\` on segmented charts: \`column|bar|donut|pie|treemap|funnel\`), \`pivot-by="view.dim2"\`, \`.query=\${{ fields: [...], filters: ..., sorts: [...], limit: '500' }}\`, \`.filters=\${this.getEffectiveFilters()}\`, \`.options=\${{ chart: { spacing: [10, 15, 10, 10] } }}\`, \`bare\`, \`cell\`.
- \`<app-grid>\`: \`title\`, \`height="420px"\`, \`show-row-count\`, \`.query=\${{ fields: [...], filters: ..., sorts: [...], limit: String(this.topLimit || '50') }}\`, \`.filters=\${this.getEffectiveFilters()}\`, \`.columnDefs=\${[ { field: 'view.id', headerName: 'ID', width: 110 }, createCurrencyCol({ field: 'view.revenue', headerName: 'Revenue' }) ]}\`, \`@app-grid-row-click=\${(e) => { this.selectedRow = e.detail.row; }}\`.
- \`<app-select>\`: \`label\`, \`.value=\${this.val}\`, \`.options=\${['All', ...]}\` or \`[{ label, value }]\`, \`@change=\${(e) => { this.val = e.detail.value; }}\`.

## 3. Layout & Dark Theme (\`.da-*\`)
- Layout wrappers use standard HTML elements: \`.da-container\`, \`.da-header\`, \`.da-filter-bar\`, \`.da-tabs\`, \`.da-tab-btn\` (\`.active\`), \`.da-kpi-grid\`, \`.da-grid-1\`, \`.da-grid-2\`, \`.da-grid-3\`, \`.da-grid-2-1\`, \`.da-grid-1-2\`, \`.da-section-card\`.
- Dark mode: set \`this.isDark = true\` in \`constructor()\`, render \`<div class="da-container \${this.isDark ? 'dark-theme' : ''}">\`, and include \`\${this.renderThemeToggle()}\` in header. Use CSS variables (\`--app-bg\`, \`--app-card-bg\`, \`--app-border\`, \`--app-text\`, \`--app-muted\`, \`--app-primary\`) — never mutate \`document.body\` directly or use inline \`onclick=\` / \`localStorage\`.

## 4. Static Widget Extraction & Dynamic Metric Switchers
- \`bundle_app.py\` statically extracts every \`<app-kpi>\`, \`<app-chart>\`, and \`<app-grid>\` query at publish time.
- For dynamic metric switchers (\`this.selectedMetric\`), initialize \`this.selectedMetric = 'view.default_measure'\` in \`constructor()\`, and include ALL candidate metric fields in \`<app-grid>\` \`.query.fields\` so every \`.columnDefs\` \`field\` is present in \`.query.fields\`.
- For **Metric Selector / Timeframe Switcher** apps switching between \`day\` (\`date\`), \`week\`, \`month\`, and \`year\`, default the date filter window per granularity to \`day\`: \`'90 days'\`, \`week\`: \`'53 weeks'\`, \`month\`: \`'60 months'\`, \`year\`: \`'10 years'\`, and dynamically match the date dimension group to the active measure (\`return_count\` -> \`returned_date\`/\`returned_week\`/\`returned_month\`/\`returned_year\`; \`cancel_count\` -> \`cancelled_date\`/\`cancelled_week\`/\`cancelled_month\`/\`cancelled_year\`; standard measures -> \`created_date\`/\`created_week\`/\`created_month\`/\`created_year\`).
- Write, verify, and bundle in a single sandbox call (isolated per conversation under \`/workspace/apps/$CONV_ID\`):
  \`python3 /workspace/bundle_app.py --app-dir /workspace/apps/$CONV_ID --stdin "<App Title>" << 'EOF'\`
`

export const BUNDLE_APP_PY = `#!/usr/bin/env python3
"""Self-contained sandbox verifier, widget query extractor, and bundler for Looker Data Apps."""
import base64, json, os, sys, zlib
from pathlib import Path

TOOLKIT_DIR = Path(os.environ.get("TOOLKIT_DIR", "/workspace/toolkit"))
DEFAULT_VERSION = "1.2.0"
_CORE_B64 = "eJztvet220ayMPpfT9GBc0aADFKyk/2d+WjT2k6szHjGSbxtZ2bPRzIUSDZFWCAAo0FdRtJe8zTzYPMkZ1VVX4EGRTnJ3metc7RWYhDorr5VV9etq5ZVsWbT6XJTbyo+nbJ0XRZVzZI8L+qkTotc7MlXq3qdsUSwKTzE7KMo8pitk3oVs0LErOIxE6tNnWYxE5tZWRVzLkTMxLWIWV0lcz5L5ucx2+TpvFjwRVIne0tovEzqVZbOVMtvk3q1t+BLJuoqLafzYr3meS1CUc0H8C5ivRfw72CPMcaCIPgmS/JzVmxqdnjIknzBDg/YwSFTFWNWVlzw6iLNz1iW5pzlm/WMV/ATSmc8P6tXTBQIr+LQCb6wSwom6jTLWFmkec2SmtUrziqeZEwUm2rO++wlqzYZZ3my5gwaTYucLxBemrNEdYWlguVFzRJ2kRYZTm6ffaiS+blgX970+/07luY1r0r5UbA0F+mCIyCYvDqdn7Oar8ssqTnL0ppXSSaYKPRgZQ32JqX1Ou33+6dsluaLND8TLKkIGE5tyRf9IAjwBczekGWpqGGeI+p6zHI2ZEcxTJH1Op/i3AzhaZYV83N6FHXFhuy7JBPUxqdNUUMp2UJdZtMZYMFU1Mn8fICNjdK8nrAhG02wzOUqzThL2XOW0+rC3zxm+RX0TlTzUTqJ6V/2mD2ZsHTJ8AlqMJ4JrlrDji5VXw0w+X7OhkMWjPPA/eIOzwxF/UEL7RrFph6lMIqAmcZ5Rs3jBHW0fxAgAuLohiw49PRGw8YHGrTbkNVvtRjtjmMB9njInrZez4u8TvMNb3fxi64p2jpgvTNbwx2PfdP9sF5JpBqy4JQmj0B/6c7kjaehBv71k7Lk+SI8inwz2cTlXzSPwyF124trvpZwKucSJ7aiiEHWD1Wj6e5F8kI+aENW6PQg0GnOgnGwf9oGJ+oq1kQBYMZs7tZukgg/Gu2wuKPekwms0pPG7tUw7nyY2OoAghkO2VG7sKfRflmUYRubukcfnLZ3sZ/CdA2xZw8xNSOueL2pchYE/Y9FmofFpo729vYesTBdwDl9xq9ituZCJGc86rOTZL5i66QUrC5YwqrikhVL9v7Pr9+86a8X+wJQW9RVAodfncwy3t9799Obk/dAt7G5MEhzQMPeKskXGa+CmDpV8f68WJdpxsMqCILxrMjD48E8S+fnt/NVkp/x2zQvN/Wt2MzWaX2bFcnilldVUd2ui43g48vHt+f8enz5OBqLg+FYHIyC/UkQBJFsQLbLivyAybZZr8cQcfmCza7xpK7TjO8L9u37t332k+AswdNRnokD9u/YoeGXN2HEhi8YHMPQgBzZIk2y4sw7ovD4+Rej/vhyEoXHgyTjVX07L/JlWq1vy6pYlzX0ehya3mKZQ1nmkMpAf/OiV5RwdGN3RZIvZsVVn73j+YJXLGHrYpFk5txPc1HzZNG3einqokrOuLeb41l4PMiKeZK9p1K3gguRFrn8GY1nposSEKtXVXGJXUpyVpTJpw1nRZWepXmf/ZnzkomauoJzCY0VOXA4ZVWUvKpTLuzuXab5orjsFSXPO3CDSoz7UARn7bZOqjNeW+s+nQGf18QAqoj1JNoLlm+yrGs24d1Fyi8VowS/k7K0e1txYL8ueC8RgtedyBweD0Q1v11VfGmj57h/8yR+endod1JBZD+9e4ObLGf8quZVngBDLThiQb3iFScWkT2fJYK/UGMABJaom7NkJopsUxOsomJyC7z/yx/sMSw2ZZbOk5r35kWe87l/GOOZ/HpyVfMccOKPhagbWOsrEkbQ0SSreLK4ZvMky8x2qzZ5na75M5YwwedFvsCtKVbJOWfLJM0EDaVepaJfbfL/2PDqOozszhebmle9RbHurTckg3QuwqKYb4DxHffD48GsWFzfqjcnGYd/IvwyzxIh3qSivhX1dQY7oH5Z11U629SI/9Zaqfp9gHbYgMZUh2DBMp6cC1iCWYVPac74esYXC75QaMdFn72fFyXi2Zoz7AdHQntdbCpkGpI059WAPV+kF/R9OA4WSU9/Yl/e4Fyl4lVSnbNjtr9IqvMeAtxnA7a/fzcOXsAAJkDjX+bXTOObFKlgrdRiICVgyzTjMfDb8xX7+uhrwZJlzStWbmZZKlYDVuQZrubeIwaCWg+2yEfBDkHo6K8/CiZKPk+XKQhHSQXS0GWV1jXPYWirQoAE9dO7N6K/9/r7tz+++zB9d8KGzeX7eSwOqIdjMfr52eTgGORBuY/CcX/0c7A/OYjkloeTq/99tPf6lRfYeJYurG0Yjl72/k/S+/tkNL4c9HsGTLSHwuV8xefnU3Gd18lVCBLoAAVPFC4X6bzW0uW3UJD9KblI3s+rtKwZ1UEkFuw0Lxac9XoI7hR4iOQiSTM4JQmhLtN6xRL29rpeFTlbJlkGghxbFhXb5LMkS/I5XxBjANPbEu60hAYyMxuisNyHbTet+VUd8nxewDE2DDb1svf7gPgPoAiCDbFOX5RZWuObMKId9og96bO3FV/yiv0ARWA9cVQ0Lbwi2UnUuLGxDoxzOktBICQhv4/IEwbwQTabLnUxw8PU1bXL0FTYNaMhACIQtlieEQGOWdDrIZPQq69LPlwXi00mX2Nf8TGYxB7eutzUQ5iB9rd5UqK2o9jUUAjZsTZPya+6PjVn3VMCuBgxDCpeZsmce0oAjSw29fDJkad/MLIhCgXtj2LFs8z30eU90yXMdJ/ORESeL7ycLK8qRCXcUaIv6gWvKqBq8lexqVt1AJumecGG7Icib0tI8yLb8nVNe1fwpJqvkI0ajEeiXqT5eHI7GIuD20EUjhePgasa4EN0HMS6nx55bcnWfp7Z9DPN63DdP6uKTRk+iTq49CVTRZ5GfoDO6GyYTyO5t+w/kYOShRQrORcj1Z2eVF2o36iFks/Ph6htwQpRS6Wh/lbAiw9Z0CJLhHh9j3pgyYL9AM4o1StoNcmvw7o457n1oZ8Vl7wKI6RR+uMoKPZXSYVbr9ifA4dNj8GkY65UH3/KuZgnJV+wpCxEXRXliivuK2Eizc8y3kMCuEC9VH5GDMKi2MwyrkgjHLNSAyZi+EVAib6Ox/ueIaO8F2xyflXyOUBPF6Cag0MLJ0JhlB4wzIg7SbuOjEZBfT30DhMHpqh6xwDbQ2o1LyW7G2+/guI8GLAOsoEFeH6W5jwYMEldO0oBDgUDM0GoLgyjjuIZgZQY3FFoXmSbdR4M5PbpKCWnPRhoZJRNjwZPjo48VB5rwXoEA1yWdom7xuFD80dTJeXwxqyYGvxqzsuaneA/aZG76PAIpjpDUWlztgLGp6RTHsm3U7RMhFBn79M+e7upuGIJvlMsQUjagd8xkPLPec0kd8DEPMnzND+Th6wQGzxBpc70ESMOhTiK9lbTKmHfThMDCeP7pJ5D2cuiWgg2q3Dbz65B4Nh4sZyFwKBWyRwV1TErC4Fi5QUXMerBBcvSc85+3P9jUvHIaISnOIBpxdssHAjU43G0Hx4PRj/vj8fjfHI7Hvejg+PxLBwlvb+/7P2fCZwLsph5hXwdNAGzkC6uYlLfwybPN2teJTUnkhqzJxa5gqPI7ZQ6lqCwOSXaJwytglIitrej2hTQl/ZHg+ZQ7D4c1/txGbzfCEnLfEuNhMuzyiznScX2b8wBeGd+PI3u9vseSqB2VfAtamqA58kKgK4IVl00KFg4Dvr9/jiILFpG4rXuYDge70fN1u7k0Qk8J06rmeplWgkgtfR+dDTRX7yEsJMAWluc9ugUN5VRVbWmGhoeyZ+NNVFrK8vgr2YRs8KylHrRLChnWZbCX1aRuz1bn9dFtRpDuiMJZ8qvcH9OlZQxXfAsXYcCrWgxaHCqepourgbAycQMVCjT+Up+hcXm6idKRfWmzPgIP6LV5hbZu4FaOg2OvSAWRiAeiJH+MAEOVLXSXEjNKi54Wa/A7ESA77UrSSuVbkVaq2jz+g1KUHyUTuzt/ZsbLj7fDLBVo+5Tz6sJmjchDT3Tb6bc0ZebGhoRPFV6TRV7ulTr55U15FpbOAEWrQEY9dItemzEjS6kRp246MDqexFXttC5V2IbsYIbYHnvQIWwpTPnvP5v6s4IujPZ0p0yqXj+39SZEDoTmc6sEjGti3Ka8QueoRU/kR3BhmdFkQ1+yYY/+v83eudGB0g3ozDYdZtD+btJ1GxYbeYXvr3soQCWgS0m62IXMZCo5Yyove9pliQ+kTcIMTRTpR3rcAp5mDfDPfjWjVroj/DLkMtrSrUhKu8GvyR6v1fAb4687DP8In4VXL/X3unQRBA7lynPFgp3wmL2cQo6fkkc4Wde4PrtxPIEQXBCsBvCPbtIsg1H9Ef6yIrlEkw8IJokbB87sa8MZdfKQQikY+gDn9da5dvUlIGENPj5NgZzE4IZiwNQmIWj/eB0EqGO3AxD62TXoP83Hb8PMgJD8PjU0QbM3LYWmmydFLMWV2zI1n0QmiLQg1nf5nAIKNAjXZ42WGokNWIa8C1saNjNbofmq6QS0r9I1NW9/kV2s+5+1hsXV7NjL2JzShI0gHBXNlSy7c3Y2ojOJmyxXQ1Ex6ajmK37iGmW94HTqXm0ZdP4mKuzKl1MRZnk4TzjSS53CL2Fhpr8A8oPsEMGerFMYfYY1yh4npRlD15LUV0tHjaxKzEmDwiXZehcVYT8/8Xzn9xkJNK+YEfkKUWzQdpncppyG7Lnts0l2F9bDMFW55xOuOx+pxy7bhevcdjYns5oH6vRvgi8W8ngaYwQnvpaaNYlmahOzgAxnx8qxH4ReEoRycPu9Jcp7EZVmRp84tKInF/R/nMrWbvHWw26qpv7Ysh6T3AWQgscviwqq9xz05pHh++ZIFP1sdy6cijRLlO7zVXJLpvv2SZacH6YimTJ6+umnRYpPBhrJd2pkstdLaRVcjlVVtIquXSNpAw1T9JlFg8PKahIk02xDMtCRK3DDgDNi01eh+A3GQOvCeVw6HQywYKissLxbK6SS6kCAx4BPImn4KhVJjX4iGhXLSAQ6Hhl6ceKCg7fXJVFZAE2RFJVd1WzXJqiYAT6zHDXTo37ftVmlnuUhtD5YKDH0C4gxxIM1Ki2qkf1Mo2yHAnXNl3pnTWJOCna9aB7Wu6bku3T0TUVahoC8rnoKau1W8hMxTIgNwivmwYLbcVtBJ4n6LEBzkHoGIT+WElZgkb2CVZpalg/Z0bVbArOYY5u7hpz+2rrvEKtvuD1gi+TTWbbXmM2mkRqOtszb9T4PONr3Ae0T0G3DUDTmq9FaDUFhlRjMX3Bngw+F6FxWp74NPBqPY1bFRDibdi93E8Xw+BGDuIuYBvBF6zI2XqT1WmZcRwfuuxT1xkql4ivWydliCwXDSq6i/r7u+4TOYidd8sj9m6T8QFS4B7JIT3k/uXXJ31pYFrxrOQVOnuJAZtXPKn5W17NeV4nZ/zbIovlyx/A4pLOrTffbqqK5/Nr69U3yQIrYSsEegqgPYah8SykOuHxwDR4K5u5VcBvEWT0bZEpv0sXY91GulG3rLhyiCAmYqCxc9Kv5Iza2KcqgFQjwHgbBstNjoYxsoVsKXAQNGh0i62U3carJUNm9pEugCpd1PR1iFeMnG5w5GzYrSbE0cYNeM5INZSWuOftelKdCZSGYjYl9xKs7X5XV1HY0JTve2YZL87YFf6nzragtVPuoQTBjbWGd+HNDfgYs7s79KFcpwKNakovEBYV20cNwh84HOn7SPDnPMsEu4RLSBX5saIzrNdu9/mnp3pEzteZ69HRxMveky9Xp1LegRGzoxbPCvXlpag2PsEfYQ/PJUjColYpcE7PYBaHjW6bimBnmLTwyuqKgkGoI7dpHJBXiPo4soB0uBztgIfq73581Iu6BS91mYfgp67UjacRq5NzLsgBnK6jkX6K3dwwhBuzFU8WvPohWfNYInWMi1kWIoUq4N9cnaEHrfAhq+7GZyKt+rvzT7BXRmcSraSaDPDXr1s2GiX7D3yK+v1+gONMcxtUh7dQIkjzyIZo9Wj7Oqq/hldcQ9MH7nC38e2XURDbjfpHDn/ow7ezjg81e/4hs5ZzoT22iySbniGt+swBWtRODXMc/qojtVr4ZeOV55BZUrxCJd+Yieh2HnwIeWAPIhFsRzLBPpdUsP/RY83pxS+kFmyX405r4wC7vNZMp8r/mKj9S9mR/w4y/0slenSaIylE68FeaAGKVCtFNgXRsMOxbPBZIgT87+Z2fOP6l6Guag0Oc4AktihRGTXdeBbErCla2FoufOb5wuafGnr32GqqjUL4zRFULAW9gj4xLqSf4KINkS3LfZBJKm5/nZ7z65aS+pMcsms4Gvexorx4Mf5yDFKs7pnDwEsADcUxSizyE8ktznep20dlJUj5BjSSXv1zBJaifipEmcy5jzdDpaXHXWVH0J3KbRBqPm3jgTWcmDnilNUHgrGVD6YVcGWpT36m0r9OM1paac0bg+vIp2n38ZcuFaDus6wDbVpmCvtPOshISXVpr7sjr/qmedk5zehyo6bHaqL7XJWzvrx/1vW80hjdJVjuUuU+PtOC3N1h5mE9Xfjovf7lTfMrgNVsio0S8oLU9MtJELugtlx+UH8NYiKJYJJlSG+RyQpHP8M/jyP8heyWd6SSp3Ig2mxVE8Ua6r1pUuPkugyghe/mRhhcJ3tsrpN5yBRTqA9A27PQJKFLdXjhubDEWceqWktDhgUSJAGwqmDRZVxVOr9f8aXA6we6a00NSzZd8KXoIMUGyL30WDbsAvRTzWGjlIdKs1+TUrMuas0eTrFHHorNlDqsyLqVF0hR7iPdzNKKAbCdaImezIZirMjaeo1WHTKoD5lyguiukWrzuPezNr7bvemmPrS4c7CxzztckbxFyQjpNDKap9byo0Gy+Rl57zhqqkY7xunFE/sP8DwFr+T7us7wgOLJ+dZSa1gruSskx9nHjRE2lnae3kvOEdYunQIruNTuQpUdTkz1B8hVzD5uY1Ea/datbe8+M9gP8Hc+SNWfcpVpqfcA3M4Q7jtcXdege8cjppaZQOkzaMq3Xx5s/qFC4OxejUjz7zM0JE2Pr13+Plth8rDp3H2qkqyW2+ph80X8UJpbs/C5k2CmAAIG8CyjiBG8up2v0mxR8Tz675n8zub/e5aCvCSJl/81kNenv/wtps2jzvwtpshSAV6c7UbprGoNAmPzuWbe7bdyY+zeEPydZcUsydDntSxE0xuvwU08NgT/QY04Ki63xd0XlT1Yx+n721Xv6a37ubpQLzCjZwssTZV0713wZZqjwuw3V5F6O/crqE19fx3GF98fqlptKepheE1bpGF07Pbs/jw6w6QMqNt6MGdj/+neSel3Kr3Bh6aBB8OUghtZIKS0//mTqv7kFqZu7UI2QsOWgj8ie+yM8LP64KMpukMPW0L1JxUHxCQaFxt7vj4X8C8lW+rvl5AvDePXJGMaqG02aNMzQsD9G42Md/tqs6Q5I81wX2pLwhuzEHe/NmXT/f2NKJz625HSofDtuB7sVq3LWu0UsvUxSmC+V/zt8i33/bW9yjv7soPwzR6mPbA73VILdLrob+9g23e/s/wuK3BfFzt8/7f3cTcMYTspKB4C2bkwcH+nUTqHQHUPUCfcpwZhaseEGjr4L+KRovQL2KR1DlNgnHDu8YTfMsIubaB3hNPZduXgLx/ldOYd53T2y0favPq5faTlVq/AXz7O0j/O8rPH2RUjtdEJxP49Zl08x9DeoTq5Y3bOr4dZsp4tEnY1YFcqmIMTIw6DW5Kd23cB4cFXD7ZdAoDvl0mVN24eoBfuD4UxfrM6OcMvUqy0BePtJmgFXXEtwQ8FW/A6STOK7cpCc85HffZhxZn04WbWRLA0n2ebBYQtyjnb5BkXAmN9bARELBUQfZXuO67TPF0nGcuS62JT9wPbov8dv8SInEnOvqKxwbW1GiR9Z6Tk617UCbmOYqGpMY3zlgXqOQRkVeBuFajImhA1eagDb8GL2HP21ZY5czqO1cUh1BdsWWzyxQ7TlmD8N1YD5xOzhKj6orjMCVxM0bmclbHm7qs+k64LbJ1cDfTNUxnp5/rlVSqa3hwF3jPF+dVRqfrgaK5jDmoHh3Xbr2EMRcmtuo1T89UmP9deCNrbxfhNw72qo6Mj5yJeC2Wxb7REAI9sOnYpHJYyYN+Mfr6bQGCgdXKl3i0e68oufWgt4B+TaoFJCORcrZMrZFlhPiI9IRSm67on5knGe6j/hWk0vX2hYvFCwOQVwQSRfp1c9QOXiNGxrdAumFeFEL1lmtUyGBldtNRV2kHynn8BUUDH/eiM1yfLJZ9DgM/vEIDAhRn9HE0Oxui4cuPiOfOGMCLpDe8rsZZjhO1I7tYCfzy8Xer6kDCPCZC6gOtoN+YNJ4DmTHlpT136dXq0xCJDtn+z7yf+dhNevofORwJytwOQVnQTqy/O5HVGCGed/JqZRn1Jd+XxDfGZQdGgP9R3gA2klnWXsEziiOOwSs4CYlPyqu/BJ6dse2jN7eQdu4PicNILXsdstqmZp8EwYouCEzcgSjhBKT6wPYAY81xArG4pNUJhCR6OHmISL9PFGa9Fn71cLMBXLWzBYbe37OYu8gQMjBxmQY1yb++vr1/94eTD9MPLP0DM8zCA/X9epqBM0KRA/ZAXnB+xE3W9B8P55QVT4bPw5qc4p0sPlysImQs8JXyieLzSr41dVhCTPZFD6u/95cfXr1QnboKk4gk0CpGi8d8K/j8vMvgH4xDDwwrfpusz/AdCosJDluYYvXHNa4RRJlWyhgfKZwJP2Cd4uJxhRKlHFCae+rIvWKLCJwtICbPg8yypIMRiztJasFMID57OrXDgpyzNG8GEQxOmPWE1F3U0MGCBvQpVkIQYJLMLXkH4abgXWdVRf+8R+1a/BPxaFZcYjJxigGPgMQ0szesCXymIAxa8D2TghnjvEQv+FLA/vf/xBxa+rKrk+vBHPDQhhjVFc6hXCSjv8/2ais34vIAYdxBqPIKJK5PqPJARk//89jXDFxiEjrpe86rP3sLpu+DzFFiASwDpwJ8nAH/GIQrfOV/sPcJAJkmtwjITz7DmSS4GLFgXC54FhwG/KrOi4sFhQBqWAJELR0urhePD3RFA8P9U4C4AtATwaR2zYKn2PcRyzviyxpbDZVFdJtUCs+FcQJj9vUe0A2HIWTLD9mFJA7YooO8J7msZeP0CAxuDDoi9zK3FUBgN6FBwnFOJPyznF6AHkpOb6OXq703f//Hlu5NX05cfPrzDDYBbNciK4pxXPZqLAQvli+/xdwyLHKuZgj6ruYKS6lmVUr9lmMsAu44l6SkGJMG5wlmOzCOUkY8KmFOI5pZK0bOBRb+jeO9OkZnGCBWxGVix7g4OnOmIZWelvk93+TtS/7W7pJETy5pfGpHt4rpVueI4y/ikINMvAIzIjCXoSZVAHJGg7mIzMCKd24e2SNcUeJ6m0PrpGdmaJ2JTcSqqf7QKmjGV6UVRU3H56Fln/NKbXZti31xvAwpyJsGkJwWSNiFunnSd1jSV+KSAqRIGVp3WGU0pPbUnHScXpyYhcv6nbVOOB9T2Gf9/Yffv9h6xtypkjk5nFZ72gUIMv7z51z/+eXcaAY/hkHm2SCs+r7Pr2BxRRQWcQ3/v7bsf307fvnz3ATcb1Bjg0UKCa11XKHbam7KPSC2kux/UiNmUziMM4wN1dBno8UtzSAJhu9ZHu8m2onsa/vHD928k09BPF+yQ9XHGov7eDy8/vP7LiSEMAUaBkBMK7fyZXwsQQRJ2Slr3Uyn1xXC4Qv+eQahnySKBiTkVarH6e//x08m7v03/fPI3MxuELoqqygeHftrkE/JpNF5pyqgJI4F0NrNFNK19a73Vm9N6Bw4fNljEDJDA6Qyd8awAJqtoHkIsTDD9BITe1ak2VLa3qL83pWnQU9AedGx3gyYPGn8l5XxqBfcDObDC5pEICCxKg006lZhFzb46+e7lT28+vAc26R4mqb/nrWmWDYnqG7lDg387OlKTD1tfv39i3p+XqXltvXyvDgb99enXvs/vi6p+lVZ4QZ6LOS4KrApEvl8V2QLYDdQrkGLoVG5XvY8HqJdI5siXYEpAWLufKE/g3iNWVukF3LnfQAaUiicx4wlevljwK8rix3heV9ewBaAmv4KMf8gXQj4b3t87+c+376bfvHx/EjN8/P7lf4J/5NXJ0dFRzI6uvvv9d9+xnnxBpb/948t3nkQTo/EGyvTGG6gzQVb/bbIQMiegqGkfyqHKEYLkQlZRIRmldXHBn7FFVRgpAKQeKEsEpL/33es3b07egaQ3vjo6CoCcODmAQIUD2jcatODSigYquTlncFUfvBMBgYpSxHhvH+JMi6i/9+7k7cnLDyevpjjS9iCHL27HM3VFfTy7Hc8qXvKEMsPcYkaVZZbU3yfl7Topb5dFBcKBvnYPPT09PKXwZ8DGYcopraWiVCPUZ4wvL57Jd6fRacxOJ6eg/tp7ZMVrZ6hLpGyMLMWEJov0IoUl7u9N35384eQ/p2/fnfxl+vanH779AMb1qvg7zwWvwyCMh4PRF7+7Pb65e/a4d/B/PX/xXz8HkVPrzyd/++uP7169dyrK3UTSINLb65IXS5SypMy1KJA+ZPQrzen/ogYFOpXM+aUmfTzjNdHLQhJwSLIED9eKUUsuEzhN9+5gEj+YZDoyovYGYK8RY0jMJeESRFwIMrBMr57R8UfyAq8kQw1sdn/vzY/fvnwzff0Kxvzda9gAkGcGA430AhVzJ8mLPJ0nmXS7hySfZCsfYFqUVvLN96Q1RqFoic686zLRuTUXvKdCZlDkaF5haigZzUtK2tBIf7FZl4KaipF0giuUoAQcTHAQUWtIqQG+9DELBkGkY/xJCQs970PcPjJi2XmaLyian0nnQmUxJD+KqEYuUZIYZ5fJNYqSl8UmU4psfVAXS3YKgE/1MNIltoSWlz9ZlhdP6hMzXkh2Jqi31lVECjgf/gVen0Dw6Zh9uC7pMfIC0xH27F4QF+/ESKHRpTkLA5LvN7zpYO2NyqlqAtgl3Ajzx9FyL4u1Rl4mlcAYD7/q2J2eyneyJQwmrvZiSC9jNNjIrBq6rqyHvdnb28MUTEyGdkyL/B0Xm8ykA/orMBnKVka7cCrRWin/wx8wxyuc4ghswOpVIThpAqXGZ0VtU2AgIGcwJWA0gdMPGAiM/FNict1EMIE5PsQhWqR6FO+7h1ut7pfXtL8j1UUTrWo6BX+z6TQUPFvGimgMAWW0Ckr+Utou9ZHozBROYPkKjnboBWxCeoPR0fHZifyTLfuKPA01oSoqNpqYBXzERjdy9iDED7KyMbFQdxPg3pSiwoWr1GZDrUBrwQ2eE9wXA/a84oko8heB1sEpqIopbPTaWN70owP/kQWAdJlNJnOdgMyxhMxKSa2od2MM1tRS4HLzU7ZCajjqdboQh0AJVcFnZC7FZFLIzbrQrVViQ3vN1EgeUWYk4siAoRSHQLDr6+kqqXLIx7T+KFyYuM7g0oL/ev4esRs4HHWkMivf8500PFWJWCl6XRdTkW3OdFzqdXI1zXiOUSXZkH39+9YpA1ePGdTBhNPzFepRzfG4D8LUewAZsZBsbFAC9tFPH77rPflfKsnzPCkjk1ELrA2ITDqeJpANKz91H0I9nRXVdTiP5J3wMHgD5POHQCXn6QV07uFHnOUgiFRKmcimMGDP2czCKug9pqxVsepC1M/IOynoBVEfzcY8RKPxk//Vy3gQjQZqktgBezrpL3izSKxTTqVnOaqxVKwigKlmPi+qdZKlf+fyeC+TayA89gkvg9zqRGjNoLdvCwxp25h+DRjT+b2VYKMByUNAwlQOnFjq7BEe8brw+Q3q7ZQ+33Dwwj5l9T1BKcTbJF5yDsiktCLzmc2eiukmJwdMafi/GLALFdAI4IYNwBcxusGTHct9v8yKRF4+g0qQC72fCnTy5eGFXH0KRg39oj5q27PUneDthY110y9L1zLhsyzh2E0bvcvSdUf/8MvWHmbpunGuLnjmbxhtZ9Ax22VDQW022r5CasNEEwqyH0zCpI1EzEXUOLmt8ZGHiKirEDJvQee9ha0hZ+m6n4opJFU/wwxPCAIgYG21EBYE8FE4A6nBaGabKCW/0G4ZycD6GGX4xmQOApJwHgNi5TR4BW/SDmCne0GYGV547r11RZt18dF/d1c2PTqHPl44nylpdxvX7wES/I0LXL0LuXY/FMF9cJH18twwhdnQmYSbf6FuKa1NU81lBxMGdtsLA6tp2jsa/xzDhWe5+dcDFvwcsMc6sNpRhNOIKJbWLQyDpiwES+sO/IKq3t5ggiJUF15Yd0Jo4VNPcjuvJRwnzW9ydtcplgcbVogaS+TzonKqq3m4aE2DS/suOibhwgpS5+wB9H7HZ/t8hEyD8pxChcE0yeAYXUCmiY8m5LTJHIHsOEedJpxGoHJIaiZGHyddqodQIIc2kynZgNwjXupDBtxYPup7leTQcA53RymGMk4M+NKycT2uxrklC50bfwGQxNhz2ymgKa9QZorziSqO3ENLj9FdH6r0U5Fk+WYtL9Fit6Z2TGcKLnLu+B+3RhRCN1xQepDTL5sS4rnrFNEIRy5G2BgbQNOTqDkmpWWx19xN8XCelrT0mjW01j3NjRT2GlR/7ONG1JBarZbKN3ulEQFQDSExIqSMVKAJoyS8gMLJmTBrn8eQJCLNp3O8GE7ZRWL2EcYUWwLuzrlGOoKKPyQMfODgmDVx2CvgvDEuohw8adHsEIsU8XyeidZxQ+AnvoDnaga8Ucp9jrS6hiOQOyG6PVPgurVYs6oQM20hZtqFmB1A5WRtSy70kS7SWxj4UUyB//wcHDy9OzV+HitObkJsxpdFxRENpdiNOmHKwEfaQeUGKp3eLEwWNn5iIPQYkudOifHYzDD6jMJVhaexm7zko55VT/x2MY9ZjlGEqIOhGH2ksOnpUqIZ1JapSB2PMtmPFm6JLeH0Pz4snL4c4ZAFpxTmXcL+kn5hxzuc1/HOu7uitJufto/ZzuaxNexEuwE5fP9OEU5weugnSo+HIPq1or4SqRYy1vs4R5ZHje0wkJN/AJU9A4CB5lADwDxnR1Qcfjxm4RMfqAaA1ug9I/CcyY1BmPmWNByK7NYOTM1+sB9D+tUYlroBuoXwUi0890LSebqawo3KQGDh6I2ckZ4hHB/bNMKhD7RxNXlIdycPMlEMKl7cPN+N8yqd6F3/KWYfZYq7ESZKo+Oolfvqo3sewQjh2PPuQ88e9J1A7r5T0OTO++ikW9A0w7cZd92Ivj6oZj91n4JbFk6lEqAMEtOkdnOhycyHZSH8a/gNkm/CG1yXshATcEYDvUd+Rtpamc1uAnFOFBHPwJh3TRfaQL2jFlPS75QSUWG9BksBfbmHqYATcH8ctPKE6FlWCBqz9P4JvmeTp01Btb3J72tE77tQbTmIXBKqpB/bktNgVbWGKSHPlGyR0D1fOjlLKEjYn97rdNepToSLOW1BBSJW4NlWFCUy0NI+2mffyBswCC781z/+GTGUDQV6xymbLWbsRJ/UhGlgeKkf896eJuhMvoxOtZMboo1GBVryECjzYGjkU/DjDtGRG2hYEDMRRZDQw8IKYLTyq9qeJ4zT0LTqKu9xYSxl7p2TaZLDlQdxPrX0bSalmtkGgMYuiwK1LNNZy6RPuuvSeADIjERkm3jHyUkzJDN5jPq+KdrqY6aWd1pB3lnMMoghXdRPwgH6QbwTZCGBKzdEUlVijp40wg+YAO2x1ACDMaWax7ZFfp2U7MngSZ88XO0+p4IlctptHwQYivE+MH1/1iplSEFqjD5M6fcBnbDiArvlZBET0MN6xa9ZBValHixcX46rMUMDtqrX2em//vHPU32uSG8YebHW8QhQUJxpHcC405zt/+sf/9w/DP71j38q71hcpep8UxqvGTIqS3tEpOBZ6zIw55vGDAvFqG+XvOLoCoGrpKA0F3NAB2cJ4UmX0ouqPdy+QlX8t9jU96CUaqXMtqGXnUMQ0lY0/yNRPEbBMcfbxvgwA5edWOZtiuk+KDajw3dZSQg1w+7+AzufwnfVZSYvVuoxgWojxg/LCv0Chnan5EGzJN+KEOp4UiQyZb4HyeQUCp1K2QMJCnoRNHYvLRtogBZC6rE0NWPmOpWZeMjGodxtGsd3kgrOjKUXferB3WmVgCmnYGtwV9NIpKkKut25W0y6DdWFsspKk6NyNghsC7Pqmbq5AG/Mdzn2+aoKtcOQzHRkD6oHFxS3aAK0OIX5IUGgggctUqVbRSoQ50OJTTBchU+kaQvGG350dBSw50M2h/8F483y98tlgxXQmRcJBZb7wc38Ltj3ZKNzxWUffyD70qE/aKknGKkDsPu/RqpINf6O9g9cMbCpZ3Bg358s0+xd1fdmUrDOmdK9+qJrVraO8bfNSSev9FvMfDV38hw8/6IH5sgms8eMaFrNpXDa672QKci+bovRVLhLFv2qVR7NJHjbEAhumGIsuI6wfzB/pNWW8rF6Id/QbvLmQMVoDJ8/WztrHMqKX1jmZOjgOrkKj2C+enAFMmIDlk48F73c+5AQu/PLIEZ4HbPxiP2UY0eNk2EI/Jj0hY4G+hZF8Nwi5C+CvhecR0QDLin1a0vgry5AVw6khYiMInJP2YA06JPoLtj3Vm2velOVYP/pda+L89E567F0Qhr2HlJeoM51ca7Mg9uQgzwqO+J4guLf+6UzKIRn0UbjYH8y+nkc7D9/Mbl/CV+ri7hyJcnTitYReDBaS2DGokHzSO4AScHcUfdIaLEvqBblMVlxhiHDE+QqwRIl6uRa/FpI0Th4PDixE0KQimMnpLh/vX+t5TaMmOIejjwE0HBoqlTHdCn28BccNZ+Vq5l1EDnDTnYYFivKQGXK9cvCl0uHWSJZmalZCLHOKMC5CZQeq8NICuG3qLji3INJNy40uPvuFj2tyYBkMBdf4Fz4m3FkBN2AZuld2O3UpPdofz3Cg95IoWFtotj8OsCrM+282t26HBSK7tXm4P7eRWl7v852i/xD2ltoys/z+JZBrbKKSmmJPy76jnpPJjbieE9bCpohIUJ9a+P6UQDFLKsUNOPHFX6mBEdYRS4GvhOfSbI3B2mUUwQAtWe6UR1mSIDxVo56zkEISLdHQxH8bDQXIKELNoAq8IRZsQMWTNgBC/HdvCMOmjXxbRWcNv3yM8/usmiFCpImt+MA5GazSAPdSjMvi6G6Hfyxjw8zlWCVHpx02GkWIXRf8bdOhW5yaOkUNPGwTwqs6SdQrLmT9PYJTtusbndonMaAHDN+W+9qcbDR52vnLJTWCkgIh28y6Rh1PC/xiZxWTHZf8Kwydw2gMoMLLuxU8PIUqCQyUCooU6yNqjsZVEtSpCgSjoqcxSxmi/OYLUqpVTmKtbomUr+25R1fGWsqCf87i/6UTyZEckqEtU1TP1PHv/ptbJEe1ib91W2Rrf7/NkaKGVkoVo6JYtWyUSzO7XIjp9zELlfa5UKnXNRad7AxQxJfsNDPkNrQ87n1XHqoUGkzmtIQ1TpudNKArhzcXigTx3cZi7hWhIzuq4FsoINYCY+mMQgCE21AbCqUPGS0i5pjHgBy1pT33w4PQe91eMAODvUu1ltWIGraaRxpFwpbnREGh4jahwdBZGGGF7GdilAvMghuplGgVN9CazGyEbsL1NOINVJPqnBkakI5pI5TMpZW2MaQ1HkK946ks2ks74vAhSdR65e4ESBcW52qe1sD5JGMZEH3XB0HbzZk1s2NIAhOQPoEbSsq3NdgyQLz2WYG3tLqGsdGcB1uSsQsgWAZIpa3jUEpDdFWrjBeh6hb5h6Ub2O8uABWH7CMYDjZmkd99lewGHnGAhd3VdgRBKfuOMPJlNd488YNn8HlSBZuOAsrVtOS0nkiOLzwtSoyLkfxjJ3SdJ3CpxyCPGYwOPiV4u1pQfGxoMwooMFIV2klY2MhaYFJFpicG4dpV8QXIJfQCaWnggJ80KoALOkp2YAUuCYPYTIg+Pal0XN7tgtSJ9QKWgmKI/kODr72qR0jERsdTSIgSnQ4gnzvGim3EYrRk0HviaYxZvCSu3dzV2HkqxkZQ/eY4eAtntC6DRdLBskCqyoJOvjQ+zzWLuctKKFAOk135GKzibrgQRQYgLfJMcQ3hd7JixruqXjAUye7oYbu8ux7lmc/iNAlzi26H+y3isI7T1HgLVpQ1Ts7jZRo998Yq8dhH+zUVTB+AqsjF9U1ZtEmsy8EqllGF2LAHEyBhBchBJFM8DoWkQ+QvCVoTEcGbJkIoaZQ52Spgp8pbppJdzUaX35JyjnP2EJNc0di9G+DyUT3AZAqIpeUfxugH6IuKnWPNvJhaV9vdu2HQ+pHYuLORaSxzynn6QgVVz1ZTxeFcjjQXQqbfQqPB+0Jix5Hzb4iV4A5aRZF3cp51XfZHCysEknDmjQkr/mmillxHjO8uabnlnhvrAz2xCeIoATribsKcTv1HCgGz9sC0XxT2U2MFLi2QK9GSCWeDuwbMU1Ryx2Asy54p0RNQBSbuWguYOzR2Ll9eGL1AcOQAIyyrbfAoTfvBGEXG/dZ3EmZbyrq7C63BdAE4HZYoS+2pEgcbfHi3IOeKmxdi38aeejTxCamqNBK8utppQzgbk/IQs0xmGX7BCNSFaO02Zo4MsJCbicBe2XLOQaFIt9k+pS2F0lmMT+UxMDm/KjF2MZoBzncJdFDlw+QH0U0R0Kt+bRpreOSwDgl4TaUFAsuEut6jbmwodfYqt1ayhvPUt61lpL4nCkE+tNDu7lrHAFGvuK4TDzUd/wxmu/AcwcKCTDwXNszOVCZvuC1jNyKoMGlIlKTcM6voz0HwSjuyGdiGFa+F8Ww1M44hiIKgnWWAKLmeEDch5ES1OirwWRXtLQGSIBb9yahzQ4apJBuUy4gWa+DdPbf/bhvL/6WhBga6fSVJAnOhMRLMTZANwRlu7pI7snSg0ZLsDLoiHBbi8MfYriUFGJ23mFs2WKg9MmGXiDUkhRmZJilBza3Awuu/s4vUDxobBmJbRTdo4nVwAWcX0Bk5qdeje3OI+1ccr0fh9YadRqoVOHdFrQxvbLybzjB0yq5jNnFlAKTbyEv5xfEkgQDqfM9vwAeI3IUFhosZgVD4ETeUFzB364CRuowIyL8VEATf+uzVJFgge6zEkiSEg9dAnVB49yNNG05Dx+CQLCPYR52Wngb2zozI2+PaN/AHTyEfOV+DbzxEFY9+U7B7l3UnBu6IqqAtFbErC1iCr++Z0c1SGJzMtAPgF/jVWeLans4ltB027/6hJo0ETr0elnk1xCTfcDEpkSmYs3rKp33ALXneBWVV3mCWqlwXuQLdswSNmCzCNBZhuACldbtLZuxQ5aw42P4KMHzT5skS2tUeg2HQ6wmrRvG4zhcJ+UINW2Cg2qKL77HPkwo2U5EKiUZ34jUnf2+jA/zaarECa9W5zhwQuPL0hGYHJ/q+/7y7ehoYjF0x0HUKoBZdyyq0A+oCTt2fJEvgOTaQJuUB8KqYZngWGVvmmphKLJAZUXePTyC0jhcVAoAU5XG2pDspkiO5lPYhPCvh1WigexKirAnSxyU1bY1eIsg2wU6KfOsSvL5CgHCXAFZhpWgLlMIdtCr4UgU1Q1lSVkI3y2bp9KMxj6TY5/5xq4afwAhnpmOUfPtnb5Ly8vdG1VXJVyooa18BHu8JGMzs+mBwytK0vQdHwMK397azDSItvi5KYEvrqZF2crDrKPkw8fnXuWpBVmMZMmBqvKYPUUdSlFuUdCOrOIghBQlnPKoQPEfNNlKxKxaoX1lNKC6FjLqbqAzV3uLNnqdraThdbWF985oJTK5EplvfbFbuwseVhcA+zODZCG25oQvoXWDo+r4WNoicY9ktEe2c+cSm+QY1JHSQKZs2ozK74CgupUcf+Ubf/V541eKWrcFX/dQdPJ2Uy24TqKD8u6nqdoKw+EQ9sIX9I/60dgYunwDD9ZT/onZWshl8HPYf3wMMSRvKt6ny/ohVo/uIHtsX6ofgXfpv2/REwDYXrEMAo8sY5Z5phZqaJ3lQya5uohZtYxZtR3o0wcBVRi71IdotfRjoNKwhdkFIG91EemJdkT+obI/QsEvsGDUjakSEzTRwykF1uEeZXF/chCNkcfA6J+U55f+bSmQoUR0234PH4Yv5CKPnWU2U5BUEpvhgfAZnrxrAN150NJiAgRUZFtVn6LZxHn1lVWlQpco5/PX7bNZrqvqdFMZokdFkQkx6w+9chffVmZ6C2CXLmJWLmM2bU1JiQHrrHm4OTho6J1xCgbYiCfNoRxGSehZXmxFTYDhmE1857Acxeho0omUtL4GIR9owHKpDvHxSqacwv2iYdu8xFTkxIqXGTguhetpU1GVFzkGTfWAdHm8i5jVS4iF58PR+sG0xyOb1W2Nb73EDzqkWXulnBnwyqTaC8y3cBDZp76wuXPMU75g9i3WL8c3IWRoehyN74LYTKcxEjZ3iOmV96a3aqUbWWw5rcw2Yrug89gVdEwFS9aBZGKl2tGWscWUNV29IH8IH5KNJh47JnPMNxpiw71HbujSg0GlYc4+G33KNvqUiD7lL0KfdsojmB3tYFRXYXkRPRQBlEsigOo+xxwswDMMcig1jzA4ZkZ4RP08ngCOioPxJISD6/jYY/g8aBk+IemOlCPgSQoo8Ojd6+niylhHYSskcx4GxygO94OdVvCcX1OD8EDtwdM9ze3Gg5DlTwcSttZEj655bpkJoKjQKGDKdy2rKDh1yG9oWwQMkOOhyGLQlBqX1F2YEpiHSlYnhiaH5IqYmE6DVVkXmm74Ow7CnL7+QQAvnG+AQwDPBNMzT9ct+HrNQgwzQRHTJFN2tGWSRrI51K4eoYe3bJ/ERVVOgtLVjhqW4YpY71FpKA1QaLTOVwHiehAzG1++imQAUyQFE99KagNxVZTNsHDGvEw9a6IUQOi0wanbt5bhuLm71Q4rKon8ZqPDbiIHEpk2sNPhonObP+5wxXC3l3jgBt5j92tgpRsgIjEkYuV5HUKk4SKXls3OCCUn+UIFY1WRZOgSmR1PhkBh8BIWQmZ3iqdI6azAB9COsQrfX5BPF9VrT0hZ0LGBOfss4AqEdqJtT6Vzm4yq4uhM1ldTf9Su71V2mB6AlRKcBNAx7bGCi+gxCQj9TVFCUWucVvPb/LCdoUg3bGskBGY9BVf1xrFzPACPslv0OrsFn7Hb3vF48Ri9bcaLx9ExZSi1O+k64eJ4EDRlZqQTLlOxMWFdlIvuPMmniRDpWS7Ty9roVCfVGa+V/2iZ1A/wN0UUdCICfwd6AQidgSPF+PhlUp+ykDJmPgGP8GTNgYMil21KZiLxNaYQGDo6hnHeNFlNZYdHAGbSJ+ev7U6fMjy4RmxvWtMyqdVsW+sLjRBODnVUUGDSm9kwSY8H5Z7bWKQuHKhN0U8F+jg3I77iYtq3MMg92UcELLxiyvi4YC/cWEGsaTRrS4EWYkGAxgdoaw1/5rlsY62NtLrs7U1ff//2x3cfPLlFxrN0DXYTzFOKMsJBNAYNDwRTgiu0++NgMvoZ/n+gEuGM+x8Fvoe8Hd++efn+vRcwBnYci8c+zcNjnNGF53NfaiZuAPj3Jx/++OMrD/TweBAeD8imcpuI63x+e8brW8FrAB4dhI+OvfqOkPKyRmPTxnevT968mr589+7Hv/obolYA7HEH2CHpWbAfY3EQHaPSRTe1TcdigoHDPpgCCuC8hTpajh36J8Rv6pYj5hq1n+G2vjp/KHECTXM7PvurpE5elqX0CP9e5m0+la9PMdQFRs5KEysHkJ0JidDmGVrRBAM7GqsLhEZe0pWoZR8o1g6mUHC9pIF/QLeiQLYb3LnUwaCtoRI0L3YAaAg+DpdhwXmv5fXY8vZRYihUkYVa+4vKGM9G6SWpeumxjcBI+sliIb0KtUQtg5uqG4h6t7TG4zhSy1peT2U6z2AAwHaHcxPuXrWF0Wi1zkyy6yCkyQJwHNvnmM4LrYlq3OAMVFwo+RnNIzrbC2LkmterYiH0BTKDmjKom8JPwzfB6aUR+waWY8BCVHuZS2CA0HeED9SAUskVlz2VEIlRFjBK9EQYB43ps0bWjFkpPdhM30xwHmT84GiekkysOu5yeMzh8lRra455kKycpIlslKIEwEKxuih7yB+x02e4vXJ+CbeMnZA9s+up4OvUqySR94DUPAJr9QxZK7u2jPOyU+1x7lbX+iS4nvQYEhyE6zQPUcKhfkXk/CvbAfW1G3kH7Gd6nZsHs/VNBZQtrdOYAsqWtNGetTatezbDFgWuuN0Ya+k7YKuYc0Syf4ANbjJuCqMm+bjnXaAlU9AMnqj2hWtTIbwbGZqEF8jXemsajZG1AwHjG0Nvh0tpuZbgIN2DrHOk7og+dSQW7xjpJ5QMKBplY0HF6JOKN6lijtt76tNOs2NND3bW+mWZChH8uikk/4rzWVImGKv7ZQT+IJSxUW74EAlPrDw7ZKgACFDoUFcaqAmlLorsgk+JaIWfFGt/qR4O4LJSx43b74jSqZxY7pGuQFOhMGKzTSpLrwd2LspzTorxyzQXrLiQ4dplmC47x/N6neioc8jFA1WJmUohxoWKvti3Qr0NTL9NSnrtlQmDcyyS6HkLXnGDIQs/oSrjvKnH+GSrtUyZJkJcyi9NW3FrdaE3SxQqoWG3LfRfs/JSgeqrSi5tfqLtPhziHQ4outRYSL2t1b0dJ6WI+rMcumsHaazY+1ynvppiSpmQX80H7JtE8BO8e4NCTvM4hVx1p1j8FE+qvJVBi9Ko5fICDxyjMw5s4irJF5m1orJDN5huLxgw+Ae6EPWnUzizp1NMF4p5hgI8/PGrTFmOOYeglnruLyEzTT3lV3PIyUpj9OfvChd8OYWUW3QT/Za9TeoVDrUzG9g7eScP+FOIXIehdfIFJvDGO4fcSZqOXCOSLis5Nh1oJxjZUO6JOjljeN0yyWUSxFpFkNS5/RZsXpTXA3aaLjBWUHDqphYDGHZGyBhSHqww++gpstWLpHfOr526aa2rUAC+dM1J1aOySOpgECuelbwSz2yaILMUzosSvN9On5/z6xf/9Rzd1l6cRhRfUxICHOYlpkUjX7t5kpvM5zh1WgiQ0TIxXSvgBseUfBJZIB1XlSA+bTDWJXFFC6kj7LPv5PVJ321MTOwHI0NgF0mVYjJD59aolG6cTLL2mGWOdCJ7kCIdKQAmSYc7rTJNI44UM8piiATIJwutS06ykfid0r7LzF4q0RkGVIVA/5DSrM9eUkothhFM1c6T16gvuHDTigHJciUh9z5ecqmykQHK630Atgqk8CE8JRCV86oOMT1Vmp8NMfvU76UdTd7L0yQCtgMQjia319xKISWR81IdV0axroQug+fhzf7tPlmEZDrcDy//8D66kyo0OSL0InjdVt61euHku1O1I89UKZWwpCCApFNC0NCt9htNiEukve2bO/iddAvINdKoGV+lGP3GRxAhIBEkNazwaiWIh1j/SZ99D+F/rb2prjDju6Qs9wXdAE8gAoe8ysiUp8EpXRI/VTMh0LeVdAhQpNrMa0j+KK80JhQ7vYYwzUtJn8JIhp192mda/WiI5wAyLUNgkEsZCdoibBgLF5MRKwKns5Wjuwu0hRv1UO1TTNez4lVaC3NZm7QVOr839earPvsGeKAG2SeqgX49oAPAol/32XvAORnStk7OCLa8bY7dUHklrXSIlD+CpFKVo9Dd2RUK/y2skmrpXxhv2YroYm4VbA8n7e6KR+xbKt1bVpw7iQ4rjmHwZfwW4BZURmSNSgM5AAlKh4WlUIcUbl34ojA3zxIqDuwB7dX8YiqquRW6Ue/SEIJ2gAHBjry6skOv6sCTyEXauaOlRLSe6+CEDGNIrDH0kMzvTKLF3JLlUL+yiqFYmrO/p2VoyJlU3mBZ7ZP+pM9elqWZJhoUafbQPuzV9EW2sgJKuYoVhSoSzOjJxDw/neBYVQs4BJn8rOFVZK5IkypElmrbJ+QSjAa6kaPJpNWILNVQV+sN3PgDnXB4PMBCtxmvby+SKurQD6NKNbhPJQ6IYNEotCnJCTOEfQoe4lKfNJ+SXKukT6e2UYXAT4mBaiIkiAFCoJLuNRGss5ZeNyZWgtUA6p9RJ6y0z7ECH21tGiFL1cSgIZPrJbBLRbhUskcytlHHQqv2nKnWQR76n7c2mraoM2fB5xnyutbpQdow6wzBCxqQsT3Prp9BfvFE5mp9ZOrXlynxnsl6lp5tio2QXNayZptc8kcqCDoBVnfxZdLHDjSisp0YpCMLVk0MkhUtNZxWL0IxiqaOTDclQpGQIif6D5mCrDW39KeVwThEEEhb4KQ7TPO6ke4Q/eFkeJlWHsSW3Q335YN2ZctIJ2fR5PVQlrIjSxmDiRM8cdu8F6VyCm9pFEANkR4mQRu56CeK/2QuPHKnV3bP6JrwUhMOOcBbBjY4r08+zigGhqMGMFbPbiNRpkvav49ZaKyTI/l2MAGVuu+9ykQbNZSLol7X/ls1jvG9oSFmD7FrMmPbHA7bxk0Di+zg/osP9bo2qmbtu4dhw7aXRX1wva69/fHYWtkvs7feHBw41CJmBwe45t3Ot10GWI0ujg1WfXFaURersXhkrBHFZc6rabEMtaOJY394WZY9ZXoAKoR4l6TAfbLTshCnz8yNChmSj9haKt7MEoAO0XSs+139JIlrWdxiFk4dU41FPTvzqhJlfD6UpvqWit1qWB8ArGEC0xM1hQwvUwjYWhRlWPGlLy8la6ahwbQwSQ2BpZanTIDooHLRMFGnWdYrSp5TKhqdh8YEGoDcyNriKRNJJSYLc5rnvFoXcJABFJ1xIwQhSq1HoqGprApxG5LWQMOtQ2SmmwlFZDoTczigPBDLM7EW7RChqLKV5ZxsOpCDRcM5/fIG1w+T5oQRG76QocTCKIKcekgvMeP66Zc3KrXOHei+dTktT2JnTuXdSwMVmx6Y4mxR5Pt1314x/QwTicPA0CIJ6S5jNgN8sxOEAH8KqFXxJVgnDOEzx/FVaIBRGBQDm3h/sHvRqV3hXc05nmIVX0bG1Bo8u7kL3DPGijNL1aXJreLLSUOYuDfGrI4rS/02oWUBw1u7RQeUpdIypqzMgrUtrKzSntwTRlbvNlIymmJks5UBQyFh/LIq/s5lOm/9jPbirfuR4Gpilij3crYmTyRINqNS5ihm0SFiZDW2uDKkvPbJR0b9pJmmt5nIld4tEc0qxbeQ8NvimpaaSbZuSKFn1V14/AXyTBCMS0p3TlfopF8K5EOe7NQlFCyWojGmJL8OE/ZcIbyzMRqKhOj+ZlIPQd2hGlTh4Iuqjy2oZ0OVJays7upNjphjvRmSZ8Yuc2Iy1lptgAFS8fK4n5tIS+UIY9ktQ8eDOwvJlYHuIsnCC4ndboDHVNCFdOQdHhzakTXCOya5lbgLubIBasFzN+OP8qcTqOkyGp1n1kFyVbfyfAlKtFbzqizg3Fj0dwv/aO+uC5l7+sI4y5OyJHZC5sKmufBduJJXaodDGS3Mo5PpwM52JE7Sko2KakG3dHViIJed0/qOdhiBobN8asGG9I/pN9xckAFz6IqGCnjhCXyE12nC9bZ7SWqSNSR3uNuj/rjjNqnR752A9o2TVj/k6ORQwQbSKtGO5qPvgKDx09nYtilVpoG3Lantwweyh/U3uaSfDm7A5SWc25jhZUn/RFomrGnFG/57200TcMdk9PMLyBJyOw4gUcjkYBzc7o9+3p8c7EcH0YtAmizI9JCctVsInoeHx1E4Snp/n8D/jnr/uwfC8kOBAxHwQA9H/eN/nyivw6Pe/572Jo8j8C/UbofjICToEYAPEX60fwsvBTR/OHkcRZEKJUEKH44KkSxZzxYJM3QsdKw6+nyDAuATCpeKlcIo0mqep8qwBhMkVNDVtGrp4wE/pdENHpVC3wr9hyJ8kBXFOa++h5KOMz99ldXkcDRMa7eqVxovkYFS427A11AkXBeONjr4IZm+6POjTCrBleVG7wW0gpBTd42ZFyrv0TKvr9QM6UfZIVogei+bdX40iqnzjn5bpOlSkYjLKXSFfO1qPp1BHGgy1WEX0XgMO3iTLxo6Yzg80bnG/sewuHRxzERzr7n6IQmxBCRrW+qpVUIHUDqfgk0cO8KG+Jr0FSq3UosMI+ND13FpHxlGTU1484hJLqdSyZQYxVCTDVelnKuu/w75fyA6zAXPa2T5eQ5HLUowLFkubYuRewmVdWmJ3HlHV1LVttspmAy8rI+8n+r5mesPA9Nxhh4uT2P2Vcy+bqiPAPQFLkTiOlwl2zyuTHNfuYW/2lr4a+Wg1XDEqvgyvQJ6J8eJATiX7s+cBX0VDaJx/1Uuni7+ZIDVJVisob65xyAhFa4q3H+oPP6/smtDuE7kudiNjENJIiUpQt6++/Ht9O3Ldx/eay3kLhE7RclB0y/PpZcfPrx7P6qTswkCgY62tU9O4yEAwDvb+CANQQhVLkINRKatrUyXEpE8UU4EpvTG62owA4jE7dwWqGxDPsXDQOIpZvhoiW6GL4M2DDlAD6zpJ3NJbZepu6/9EKSFxmIaTGrGMm5pGQ1gbxwYmv97Q45ZpBW39JY4dng/EsGC4/t//HTy7m+EUB1h8ywqO4K1msiQtHstoNa8+MdSqRgiqnexWvWOqCvNYeHlw186Iuuk2AJU9ddgph/aI+XvOPzyBnVMn0AFh6rOXEaWVzeaZDI3CjrvJ9kEEcxOylmJ0I0s2SCR6Qt+eFD5E7hRjj65GbbG7EGWv8a8JQ3uH3Pr2Wy/krDwwzYZy2TlC9q7mRlV8D1x66FbUTOebHdwnuaqKsRqk1y5qHDwU5C6sBkhqKjsfelptIN/8MWh1u3helkNSn9NGRUZ7t7u1GyTP8E2m40C7Hspy/azhxkWTm/7rnioFu927za1ieRuraK80BkSlkIJduOF5D5H8H9MHOjLnkRAHByQ0QvVO6Te/laQmyImhwRVKC+5Jy2Qdva/2T8FrWuwcOZuG607d2D/ueBVjY2ECrY8xbvSMuJ8IEqnOfvh5YfXfzkhluH+dluj8HLryhx1Q5u0H7DH7HzAiHL/+eRvFoNzHrMAneGDyDh3y/OcxDQdIHM0iSwjmkUP2C1c/bKa6oCkgksCIA0HpJ50ntbTdCHVU5e2kJgugua1AEfKSBeKOJDY63Df7HfsBiDAbXL65zhdBPYgVkVVT8Gldwgy7+hrKwg88E5OVyTBa/iZ+4o4l/Vtq720QQEm96RqvnWRIDaSXUDvoOOLdM1z9PwK0E87EZsKknBbY8k2MIxpXUzhMWxNZZ3WGafZdN5nyQzk59Z7HAxeQqCPuvdKCNBNk+EJlo/XoYOIOn6ErUckz/9gTXJ7uz+2VN8Ib0YidUNP8BB4zVgxuBdlVUBYGsourZqgAy4wLe+jMrwp/O8AeIvuwGqpSS39sBqaGi8seimDs2MtILA0BBU0rbsipWSg0YbKWu30gliVWSLS+RQcCteBDxu0BgYAyXcXKb/0LKgu2rilnXIIzZzyyxZqfA5wP6aoz1244uvENkyxnNY9OqB7Qd+jRNqCLz5olqIs9qjSdH3joAX2tTPSUkCgngVyXGorutgIaVb19Dkt4xdD6uSTmWEKZjNLLOcpeV8JSE5RgTWoNNlR4DYjJmPE6CyxllwcwiS9GhwRUJ6D7hG33GSmlZvOZtACZo7EO9ZjN1oMu7NoJZxQcKGr9oQGso6jIQvOy7TBwclrDcP27bOHHRpNdjb8tIR7T53UX17YWiqemlrwhLDC9+om1Kel25Aok+q8eajiS7iFGrS1Y6oC/dtkHp23ZD1UIY7wU6SUQhT4GlNSNQfeNRCpVaEmVDRYKrwl1qu9tDdyDwwUYSZ6M5D7Ti3SQHYhthQQikBpFUOLRjlfQAMbAH5aVeknfh4tgxtqY3Q0uWM3UkVFvOCrk+9e/vTmw/vR/nmZvldL8b6o6ldptT+5gzRqQZau09rApp8I2w8rsGG9wdKTu9aEdcdm/6xpHH1amos/4OP8S2dUjbp7jN6hoU/vktcYw8flv0hAjfyCaUv0NFG/w62oGG2h8TvRi4Nw1EkyyvSiqM3TN9cOHZm0aRZcC6ilck6DnUQtitO18f4Ht1A3mrvcpHkfduAGToLEju1T1AHgrEoXsn7U3jkAEfa3ddPW3vAueaX3HXodPdsjWXAijzrRjdMoZjltoKInMvhK+oSUX1qnHqBwll5wy1aIxXbizxp8km3O6+TeWvbpG2dIQZ2cwXVWuB4UAE6Z4xPVBfhGmtUCV6iEpNqubc2FrHn2YGCz8kGTl7c/K9V3G5Ia0MBl9YI2r+cW8UO0hO1gYIveMQssaToY2LK1P6F4A/I5v3Y+4/6wBXSFHVajUQOGT+snu9J8LfvrUExZ1HnXaMHSd+MdZ8teGtjsIRAVx/oZWLydrqm+Weq5YGAr6xqtY5g9nPllsEh6N5ou3PVuQGS/o8y5IMdTzoBGqUCOGkoE0s4Pz815bAh0ioCaN5hSU7HwwcDi5+EEINY6GCgmW41+ucnU0JebrNGmJiVye+BzzIJUrV0wkAdZU62rEKNJIojEqi/eaoYwWVNwZ3kV4wUtWXWdlOQMp3yxXZu969X1ekkO2E2n4jQ/yzg7JXdakCFGMQSRnKBnLXjAnP7rH/88jU4pHINxDpahJcDELI0X+rom2B/mdXrBdciGKNbByFFMidHbdop+j9gcPbrOXTwHJ1TSWY9C8B2M7nWvJc/tmeOJiHtUwfI6czlSC95knEmPXF0Pg6gOpVdKNWCVDlXEjL9jBQ6PHHpQkcNjlcTwuKvLo9sP1bS8QzkKMW0yp0mgZ9dTF62D0HotzFzU6J3LrSlZLfRNIXuEFHTZM0pp/Hb7o8MIanwwTsbqphAXA9nW57sZc2H5GEtoW/yMuVBOxlxs9zBe8WSBrqG2R7FRBCXldC1Dj8lRNe4lwYa5P5A9eUPF3m/R8fYw90EsO+nqGoFbtrq3xVHXQac1Rq039Wx33WRZ41RQc6O1vtHn7KO2MzbWQ6rm3Cw8vv3d727Ht+Pb2/EsXeI1eyp5fy9nfEm8lOzKgK31Ja1Jv+qImU+17ocOOhcs2pUplFkO+RTEzNL8486loFMIBGONxayH/0UG+Oh8IqOS0m0i5z4TFYEMfSoftgQWIZTmJpBXUnx303wDxFqQqgrWCThS6hC5+2/LSLsmY4W9jDvm+qWQ13IQPqsigP683kPNtvuTL2czoJiuuQOaudksHeeMVqJVArrVhVWni2PyLroViRhl40ZOSwriIz+2bJFezMXjEubEuikINybX7XwTeJzaRZ+2RAfsBcGUx6/tqyrc6Ejou6a9WLeEO6TQBNKnzYmJqhRXsQn8fzgWmNE6AKWq7mjrSMVTXZOA1k0CJwJBa+FFX0V3lQq8ZfD8BvjOF3DHqlgu4T7IjYZ+N1CRIdZJdb5BDWgCLuu6oZhupOm7Ts8ouTyFBGno+1q+dHgHwb6LYK6fWusjhY0hC9UNiu7RN5kKr0gMOamwZeko2lUopFJfWLcUgHzJurkT5rB5cwEL2RdB9cVm96JzulSz0LwL4dx9NlK2qMm4OHIDltdrivV75kFIODP0kdGMtwXsRszqKbnGkZEbM6HZ8XtrKxCeRtzas9MknhI46JHlxY25NfSHv/z4+hW+3vGOMfA/0FePRho82RdX7oGE0+SeR379CB0p83MIHD8Zoc4ADyvqabe1HsxhuuKgnf1c/bUTOujg+nKylc3bOoIPfV46lC8ZdGZSsYE9bOuOlhS+KdbuB5axRhpKe2tlKbXNNZZmpcNLoxEyYbk/nt1AK3fGwR3828G9Pbgdg3v7GPzbx/vRvsYt24/esxjJunvOW3eGbb9FyzHY8Xd94vF3tTxn/dcvWvOuEmMq66dt99yW4lhXZo9ZoLQ4AKhhblN/iFKKOFP66kbibp5ANkbMp+3OFIQcdq4JWeGFC8GFJfMxnuFdVbqYSnGwzvn1qSNtMolLYqozdVdwNVnwhdxeXqOKLE6eJ+64u1SUzQj/O4DdDkoWxkVr2nhbLTacSreY5pEHpulXnghOtS1WWruqeymCSWaGXEL91xEME2Hccrf0896LB+bKgduHUbBG5Fw33m7yCmIrEeY2BQh9QqNbXvs0Mydp48xEvU/HuekuL+h0pmm+LHREnqbCx4oi2hGH3cDYmsqeitkqmVjzjxqE58jCuH3Osaz+5PlETmOw8SibYs54vlnzimIKqEa7Tqnajo1yc3CgnbOxiwMNt30cyOHjGLpJq9UAplBBzzfZa28lGrGiVDthrtXGL0VfoBJRm2R7sJX6qUtKfl71Gyrou1EfLgvN7+PdTApeCHEnN/UKV1GFGyzqFfBtLK0H7Az0ehi1LJVGlUf4DYifE+6whjiR5LSGAQ8pyONRpCOSyYhaSnt+X/QYSmxnZBE3WGtajxxbwETvOfhCuvxGlppGy6MWiAn5ONuFkCC3CjpRXX6FfuK7HbrXstvbMIb4S0fEpcZs799H7AdYHWM1YSnEKs+lTrgnb7orHIFYlxUXvAInGQyi/4xidygkwCvzUoDCGouk97xOzl70noNO/0XM8g1EJ+YL4lGfsmReFUKwl2/eqFYkLAg/iilpMEA8RheU8diKasErwpw6OecQmOimPaetNdh56n8jXIMPl6lZFqf6drGx5JyCS1jJmaxRlSNthUFOHqCbF9riXnZ1udQ9bgcCwKYt132Arc01E/3KNCcdAXBltk+ArrNFKZVjSrYhzYAMVJXW7fhJFMY9nCeUg3QZAEbsyxb2J3e9G4QEYTH8nTONObHcm/2GBixlxznP0XddF9GkVYVsjBvRGGOL7s2Tst5UfDGdXaO1stjUyvyWJaKWQwc7PmQFPLJMQDnEKc7Sv/MF8X10Z5zYZyvzjnXN38Fe4hUtMxYGNJJvLSPa5H6tVDXDuGBY05jLWsaXaqZ0XdWs5dhqvzYGcvut9IrYQa1nZgY4J/1LXapPrrMiWYTVTLpIGNS7NOO4tFESPKb55TZn6cbXTj9pdM6Q8VeZviCErmrWBFo2+Qm6elMx8Pampzs6PkPucwfRQHM1GNs6PFFXbFQdR33p9K8DgFoYM82NTjSjDOhiEJ3MusLlXqRTIZV0cQvX1f4hTLdxXOWmAjZMXljm67SeLriYV2lZF1XrfnHnMqO/uPTVVwtq+ZarV5ZbubPslke56ZPlxSSvgy6DG/P5joU31O5dFGzfnjtoNW+wjbuBssqSA4tnv3ha6t7ylyuOtpgAgqDK0KgUBdtEwAZHL4qRk1RnG5CyAwu29rKQOdQCb/zqWoUqxyi7zVSy24Z7s4/bQcZQoEb3zYD2J9Edu8Fh3G2fjg7K4aGwDeOTrubNgrq99+tUkHqiGebb31e7YYNIaEV1zpK2JTXJizydqzAj04+iyEO3zsgAnIwkHZmgadFb2YzbI8FtH7RmSBWrmFIo4xRc9HbFWeXR4dkbOtZxu2lFTGSMdMC9m/24gT0SNKJOuAO6Rq7vv003wb3kYT1sd0cBwv64QemfsROFOCXPRSPmv/TNNBqbzvVGJasSZhfoQ6a+Qa4EpIODX4E24tVmdTPW2jp3nvlrOvw0E4xuQd5W1daVR2jGPSqMLxc1b8th1muNds0PXcsNLZgIFecDxi/BOqxNyrK67W6Fvhb08fKuuZP1Gao4bTOL7X1oGt9+/lrwLcbGqu1hcPyqFVNH0xA57gsac8wuoNeecvb1hXPyb1dXDVobyKyb3kM3rf50Y7RxWlPTr2QR1xtNfjUCT2zcDZWzmizjiFZRO8q0tGHI0mh1sfwyMfiv/EbvJrBTlPudmS0PYFgrgdGUpYOmhGN8NrElVco4X1rl1MuJD766YxUM7KtXgeWyKr8YT872FncBq8sjW6Tsy5itY3gtxcVLGAY8rNXDpSM82hxcm0i1aVQHiXL4NsO2SX5Ns2u6yCMnND+NIta5BJT1v1aB/VFmN6eQuYoPlswMlRno3aNtOa6sq0VEhfUq2vtIS4yW7ZM9VmBdR7VuHcWSrrjLfC+axkCFpnDS3v+tzi33mZM9Bmcx2Pek3VZqBeWr24DugwypbFoALbnZMwt7zUlwNq0dNuDNj9++fDN9/Wr69t3Jd6//0+NW4DnC5QkOKjQdcAHVqvs3DXh3+w1dWlGxTW5ObrkZgsaqSdd0W5/3wJ6xfVSMWOPen9ztA+e6EZRr145qqRi0ZxgIFV+kNvZCmhJagsaSNhWZrbn+VXqt0w85gTifKdsEzDCAWFAfVXKhwLIvKsU5khiaXa1Ld+ZevXX7rd5OP6F27hOu4ye0QHcJEBvy3dxAIVVdZqyzrDST5q60W0LpH2bUFtuA0gDhuPEy658i0zUL1B1dtun0MJhuYrYxxlBjvtE99zMBTZldwogVIf2vGwQOvt9oi9wSq3yvCybkesPDHC0jVO5+6miSZIu+8XRC506XoWxc8kaBxs6SZJxGdaNOjrSKi71vX/7w4w+vYeN/8+7Hv74/eTd9+f79yYf3UHlV16UYHB5eXl72z0hkh7h6h9JdQeWyFcGeHfaTcnJNN1UmICb+Mj3TmpCiyM6BoU2rASZmihlYrlUab2jySf9p/yhAxWC9KTNOFhaTwu9iCklwwRPGwGKHLPjLybv3r3/8QSd9p3L9VOC/MmC6fLkl85Py+jAoIzsIMUJ2ro2VgVujY7lriu8OJXBxeCOf7pyUccvgBqDcHVpZg4PYvL7g+aKoaPbLipdJxYEBW2woyxLgJ/hyyn+l9knavWB95BsCo1/g5EN4vT2F5OCTMDQucRCWEZQst5TAGLyAR+Orp//3OJiAI/GhbOHQTnZ9O+47v6NQV4EYjstgfPb8yYsbq3N347PnT8G5WPaggbk79EXOzyE4vNCrxx3Nmhm4O8Rmx2fPv7Lb/n8ATJEMHw=="
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
cat skills/key-driver-analysis/scripts/kda_toolkit.py /tmp/kda_job.py > /tmp/run_kda_job.py && lkr --oauth-account=prod-demowest code-mode sandbox -f /tmp/run_kda_job.py
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
