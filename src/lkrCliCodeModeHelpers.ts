// ponytail: leaf helper module for LkrCodeMode OpenAPI body templates (describe_body/api_template),
// Henry system__activity health/vacuum checks, and portable Dashboard/Look JSON export/import.
export interface CodeModeSchemaRuntimeLike { init?: () => Promise<unknown>; lookup?: (name: string) => string; lookupType?: (typeName: string) => string }
export interface DescribedBodyField { name: string; type: string; is_array: boolean; required: boolean; read_only: boolean; secret: boolean; description: string; ref_type?: string; cycle?: boolean; truncated_depth?: boolean; children?: DescribedBodyField[] }
export interface DescribedBodySchema { target: string; method?: string; type: string | null; is_array?: boolean; fields: DescribedBodyField[]; error?: string }
type CodeModeRequestHandler = (m: string, p: string, q?: unknown, b?: unknown, o?: unknown) => Promise<unknown> | unknown
const SECRET_FIELD_RE = /password|secret|certificate|private_key|token/i
const READONLY_MARKER_RE = /\[read[- ]?only\]|\(\s*read[- ]?only\s*\)/i
const WRAPPER_TYPES = new Set(['Optional', 'Sequence', 'MutableMapping', 'Mapping', 'Any', 'None', 'TransportOptions', 'List', 'Dict', 'Union'])
const ADMIN_UI_PLACEHOLDER = '<CONFIGURE_IN_LOOKER_ADMIN_UI>'
const singularize = (s: string): string => s.endsWith('ies') ? `${s.slice(0, -3)}y` : s.endsWith('ses') ? s.slice(0, -2) : s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s
const toSnake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase()
const extractTypeBlockLines = (rt: CodeModeSchemaRuntimeLike, t: string): string[] => {
  const raw = typeof rt.lookupType === 'function' ? String(rt.lookupType(t) || '') : ''
  return raw.startsWith('Type: ') ? (raw.split(/\n\s*\n/).find((b) => b.startsWith(`Type: ${t}`)) || raw.split(/\n\s*\n/)[0] || '').split('\n').slice(1) : []
}

function resolveBodyTarget(rt: CodeModeSchemaRuntimeLike, rawTarget: string): { method?: string; typeName: string | null; isArray?: boolean } {
  const clean = String(rawTarget || '').trim().replace(/^sdk\./i, ''), hasType = (t: string) => Boolean(t && String(rt.lookupType!(t) || '').startsWith('Type: '))
  if (!clean || typeof rt.lookupType !== 'function') return { typeName: null }
  if (!/\s/.test(clean) && hasType(clean)) return { typeName: clean }
  const tryMethod = (fn: string): { method: string; typeName: string; isArray: boolean } | null => {
    const doc = fn && typeof rt.lookup === 'function' ? String(rt.lookup(fn) || '') : ''
    const bodyExpr = doc.includes('Function: ') ? (doc.match(/Inputs:\s*\n([\s\S]*?)(?:\n\nOutputs:|$)/)?.[1] || '').match(/^\s*-\s*body\*?\s*:\s*(.+)$/m)?.[1]?.trim() || '' : ''
    const model = Array.from(bodyExpr.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)).map((m) => m[1]).find((t) => !WRAPPER_TYPES.has(t))
    return model && hasType(model) ? { method: fn, typeName: model, isArray: /\bSequence\[|\bArray\s+of\b/i.test(bodyExpr) } : null
  }
  const alias = clean.match(/^(?:Write|Create|Update)([A-Z]\w*)$/)?.[1], stem = alias ? toSnake(alias) : '', p = clean.toLowerCase().split(/[\s/:.]+/).filter(Boolean)
  for (const cand of (stem ? [`create_${stem}`, `update_${stem}`, `create_${singularize(stem)}`, `update_${singularize(stem)}`] : []).concat(!/\s/.test(clean) ? [clean.toLowerCase()] : [], p.length >= 2 ? [`${p[1]}_${singularize(p[0])}`, `${p[1]}_${p[0]}`, `${p[0]}_${singularize(p[1])}`, `${p[0]}_${p[1]}`] : [])) {
    const m = tryMethod(cand); if (m) return m
  }
  const pascal = !/\s/.test(clean) ? clean.split(/[_-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') : ''
  return pascal && hasType(pascal) ? { typeName: pascal } : { typeName: null }
}
function parseTypeFields(rt: CodeModeSchemaRuntimeLike, typeName: string) {
  const lines = extractTypeBlockLines(rt, typeName)
  if (!lines.length) return []
  const wLines = !/^(?:Write|Create|Update)/.test(typeName) ? ['Write', 'Create', 'Update'].map((px) => extractTypeBlockLines(rt, `${px}${typeName}`)).find((w) => w.length) : undefined
  const writableNames = wLines ? new Set(wLines.map((l) => l.match(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1]).filter((x): x is string => Boolean(x))) : null
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const fm = lines[i].match(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)(\*?)\s*:\s*(.+)$/)
    if (!fm) continue
    const [, name, star, rawType] = fm, descParts: string[] = []
    while (i + 1 < lines.length && /^\s*#/.test(lines[i + 1])) descParts.push(lines[++i].replace(/^\s*#\s?/, '').trim())
    const description = descParts.join(' ').trim(), meta = `${rawType} ${description}`, stripped = rawType.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s*\(Ref\)\s*$/i, '').trim()
    const readOnly = READONLY_MARKER_RE.test(meta) || (writableNames !== null && !writableNames.has(name)) || (name === 'can' && /operations the current user/i.test(description)) || (!/^(?:Write|Create|Update)/.test(typeName) && name === 'id' && /^unique id\b/i.test(description))
    const arrItem = stripped.match(/^(?:Array\s+of\s+|Sequence\[)([^[\]]+?)\]?$/i)?.[1]?.replace(/\s*\(Ref\)\s*$/i, '').trim(), isArray = Boolean(arrItem), base = (arrItem || stripped).trim()
    const refType = /^[A-Z][A-Za-z0-9_]*$/.test(base) && !/^(?:Any|Object|String|Integer|Number|Boolean)$/i.test(base) ? base : undefined
    out.push({ name, cleanType: isArray ? `Array<${base}>` : base, isArray, refType, required: star === '*' || /\[required\]|\(\s*required\s*\)/i.test(meta), readOnly, secret: SECRET_FIELD_RE.test(name), description })
  }
  return out
}
function walkDescribeFields(rt: CodeModeSchemaRuntimeLike, typeName: string, visited: Set<string>, depth: number, maxDepth: number): DescribedBodyField[] {
  return parseTypeFields(rt, typeName).map((f) => {
    const item: DescribedBodyField = Object.assign({ name: f.name, type: f.cleanType, is_array: f.isArray, required: f.required, read_only: f.readOnly, secret: f.secret, description: f.description }, f.refType ? { ref_type: f.refType } : null)
    if (!f.refType || visited.has(f.refType) || depth + 1 >= maxDepth) return !f.refType ? item : Object.assign(item, visited.has(f.refType) ? { cycle: true, children: [] } : { truncated_depth: true, children: [] })
    const next = new Set(visited); next.add(f.refType)
    return Object.assign(item, { children: walkDescribeFields(rt, f.refType, next, depth + 1, maxDepth) })
  })
}
function fieldsToTemplate(fields: DescribedBodyField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (!f.read_only) out[f.name] = f.secret ? ADMIN_UI_PLACEHOLDER : f.ref_type ? (f.cycle || f.truncated_depth || !f.children ? (f.is_array ? [] : {}) : (f.is_array ? [fieldsToTemplate(f.children)] : fieldsToTemplate(f.children))) : f.is_array ? [] : /^(?:boolean|bool)$/i.test(f.type) ? false : /^(?:integer|int|number|float)$/i.test(f.type) ? 0 : /^(?:object|dict|mutablemapping)/i.test(f.type) ? {} : ''
  }
  return out
}

export function buildDescribeBody(rt: CodeModeSchemaRuntimeLike, target: string, maxDepth = 3): DescribedBodySchema {
  const r = resolveBodyTarget(rt, target)
  return r.typeName ? Object.assign({ target: String(target || ''), type: r.typeName, fields: walkDescribeFields(rt, r.typeName, new Set([r.typeName]), 0, maxDepth) }, r.method ? { method: r.method } : null, r.isArray ? { is_array: true } : null) : { target: String(target || ''), type: null, fields: [], error: `Unknown Looker API method or body model: ${target}` }
}
export function buildApiTemplate(rt: CodeModeSchemaRuntimeLike, target: string, maxDepth = 3): Record<string, unknown> | Array<Record<string, unknown>> {
  const desc = buildDescribeBody(rt, target, maxDepth)
  return !desc.type ? {} : desc.is_array ? [fieldsToTemplate(desc.fields)] : fieldsToTemplate(desc.fields)
}

export const BODY_HELPER_PREAMBLE_PY = `_cm_body_fn = folder
def _cm_enc(t): return str(t or "").replace("%", "%25").replace("/", "%2F").replace("?", "%3F").replace("#", "%23")
def describe_body(target): return _cm_body_fn("__cm_helper__:desc:" + _cm_enc(target))
def api_template(target): return _cm_body_fn("__cm_helper__:tpl:" + _cm_enc(target))
`
export const HENRY_CODEMODE_PREAMBLE_PY = `import json
def _re_perm(e):
    if "PermissionError" in str(e): raise e
def _sa_err(lim, em):
    s = str(em or ""); st = "permission_denied" if any([k in s.lower() for k in ("403", "404", "forbidden", "not found", "access denied", "see_system_activity")]) else "error"
    return {"status": st, "rows": [], "row_count": 0, "limit": lim, "truncated": False, "vacuum_safe": False, "error": s}
def _sa_q(view, fields, filters=None, sorts=None, limit=500):
    lim = max(1, int(limit or 500)); q = {"model": "system__activity", "view": view, "fields": list(fields), "limit": str(lim)}
    if filters: q["filters"] = dict(filters)
    if sorts: q["sorts"] = list(sorts)
    try:
        raw = run_inline_query("json", q)
        if isinstance(raw, str):
            txt = raw.lstrip("\\ufeff").strip()
            if txt and txt[0] not in "[{": return _sa_err(lim, txt)
            raw = json.loads(txt) if txt else []
        if isinstance(raw, dict) and (raw.get("error") or raw.get("errors") or raw.get("message")): return _sa_err(lim, raw.get("error") or raw.get("errors") or raw.get("message"))
        if raw is None: raw = []
        if not isinstance(raw, list): return _sa_err(lim, raw)
        if len(raw) == 1 and isinstance(raw[0], dict) and raw[0].get("looker_error"): return _sa_err(lim, raw[0]["looker_error"])
        return {"status": "truncated" if len(raw) >= lim else "ok", "rows": raw, "row_count": len(raw), "limit": lim, "truncated": len(raw) >= lim, "vacuum_safe": len(raw) < lim}
    except Exception as e: _re_perm(e); return _sa_err(lim, e)
def _hv_env(st, rc, lim, tr, safe, days, err=None, **kw):
    d = dict(kw, status=st, row_count=rc, limit=lim, truncated=bool(tr), vacuum_safe=bool(safe), timeframe_days=days)
    if err: d["error"] = str(err)
    return d
def _hv_vfail(st, rc, tr, days, err=None, cap=False): return _hv_env(st, rc, 5000, tr, False, days, err, capped_explores=cap, unused_models=[], unused_explores=[], unused_joins=[], unused_fields=[])
def health_pulse(timeframe_days=7):
    days = max(1, int(timeframe_days or 7)); tf = str(days) + " days"
    h = _sa_q("history", ["history.status", "history.result_source", "history.query_run_count"], {"history.created_date": tf}, ["history.query_run_count desc"], 500)
    if h["status"] == "permission_denied": return _hv_env("permission_denied", 0, 500, False, False, days, h.get("error"), query_volume=None, error_queries=None, error_rate=None, cache_hits=None, cache_hit_ratio=None, slow_query_count=None, slow_queries=[], pdt_failure_count=None, pdt_failures=[], schedule_failure_count=None, schedule_failures=[], checks={"history": {k: v for k, v in h.items() if k != "rows"}})
    sl = _sa_q("history", ["query.id", "query.model", "query.view", "history.runtime", "history.status", "history.source", "history.created_time"], {"history.created_date": tf, "history.runtime": ">5"}, ["history.runtime desc"], 500)
    pd = _sa_q("pdt_event_log", ["pdt_event_log.view_name", "pdt_event_log.model_name", "pdt_event_log.action", "pdt_event_log.error_reason", "pdt_event_log.created_time"], {"pdt_event_log.action": "%error%", "pdt_event_log.created_date": tf}, ["pdt_event_log.created_time desc"], 500)
    sc = _sa_q("scheduled_plan", ["scheduled_plan.id", "scheduled_plan.name", "scheduled_job.status", "scheduled_job.status_detail"], {"scheduled_job.status": "failure", "scheduled_job.created_date": tf}, None, 500)
    sts = [x["status"] for x in (h, sl, pd, sc)]; errs = [x.get("error") for x in (h, sl, pd, sc) if x.get("error")]; hok = h["status"] in ("ok", "truncated")
    st = "permission_denied" if "permission_denied" in sts else ("error" if "error" in sts else ("truncated" if "truncated" in sts else "ok"))
    tot, err, cac = (sum([int(r.get("history.query_run_count") or 0) for r in h["rows"]]), sum([int(r.get("history.query_run_count") or 0) for r in h["rows"] if str(r.get("history.status") or "").lower() == "error"]), sum([int(r.get("history.query_run_count") or 0) for r in h["rows"] if str(r.get("history.result_source") or "").lower() == "cache"])) if hok else (None, None, None)
    return _hv_env(st, h["row_count"], 500, any([x["truncated"] for x in (h, sl, pd, sc)]), st == "ok", days, errs[0] if errs else None, query_volume=tot, error_queries=err, error_rate=(round(err / tot, 4) if tot else 0.0) if hok else None, cache_hits=cac, cache_hit_ratio=(round(cac / tot, 4) if tot else 0.0) if hok else None, slow_query_count=sl["row_count"] if sl["status"] in ("ok", "truncated") else None, slow_queries=sl["rows"][:25], pdt_failure_count=pd["row_count"] if pd["status"] in ("ok", "truncated") else None, pdt_failures=pd["rows"][:25], schedule_failure_count=sc["row_count"] if sc["status"] in ("ok", "truncated") else None, schedule_failures=sc["rows"][:25], checks={"history": {k: v for k, v in h.items() if k != "rows"}, "slow_queries": {k: v for k, v in sl.items() if k != "rows"}, "pdt_failures": {k: v for k, v in pd.items() if k != "rows"}, "schedule_failures": {k: v for k, v in sc.items() if k != "rows"}})
def health_analyze(project=None, model=None, timeframe_days=90):
    days = max(1, int(timeframe_days or 90)); m_err = None
    try:
        rm = all_lookml_models(fields="name,project_name,explores(name,hidden)")
        if rm is not None and not isinstance(rm, list): m_err = _sa_err(500, (rm.get("error") or rm.get("message") or rm) if isinstance(rm, dict) else rm)
    except Exception as e: _re_perm(e); m_err = _sa_err(500, e); rm = []
    if m_err: return _hv_env(m_err["status"], 0, 500, False, False, days, m_err.get("error"), models=[], explores=[], unused_models=[], unused_explores=[])
    tm = [(str(m["name"]), str(m.get("project_name") or ""), [x for x in (m.get("explores") or []) if isinstance(x, dict) and x.get("name")]) for m in (rm or []) if isinstance(m, dict) and m.get("name") and not (not model and not project and (str(m["name"]) == "system__activity" or str(m["name"]).startswith("marketplace_"))) and (not project or str(m.get("project_name") or "") == str(project)) and (not model or str(m["name"]) == str(model))]
    if (project or model) and not tm: return _hv_env("error", 0, 500, False, False, days, "No accessible LookML models matched scope", models=[], explores=[], unused_models=[], unused_explores=[])
    flts = {"history.created_date": str(days) + " days"}
    if model or project: flts["query.model"] = str(model) if model else ",".join([x[0] for x in tm])
    h = _sa_q("history", ["query.model", "query.view", "history.query_run_count"], flts, ["history.query_run_count desc"], 500); by_me, by_m, m_out, e_out = {}, {}, [], []
    for r in h["rows"]:
        if isinstance(r, dict) and r.get("query.model"):
            mn, vn, rc = str(r["query.model"]), str(r.get("query.view") or ""), int(r.get("history.query_run_count") or 0); by_m[mn] = by_m.get(mn, 0) + rc; by_me[(mn, vn)] = by_me.get((mn, vn), 0) + rc
    for mn, mp, exps in tm:
        m_out.append({"model": mn, "project_name": mp, "query_run_count": by_m.get(mn, 0), "explore_count": len(exps)})
        for ex in exps: e_out.append({"model": mn, "project_name": mp, "explore": str(ex["name"]), "hidden": bool(ex.get("hidden")), "query_run_count": by_me.get((mn, str(ex["name"])), 0)})
    safe = h["status"] == "ok"
    return _hv_env(h["status"], h["row_count"], 500, h["truncated"], safe, days, h.get("error"), models=m_out, explores=e_out, unused_models=[x["model"] for x in m_out if x["query_run_count"] == 0] if safe else [], unused_explores=[{"model": x["model"], "explore": x["explore"], "project_name": x["project_name"]} for x in e_out if x["query_run_count"] == 0] if safe else [])
def health_vacuum(project=None, model=None, timeframe_days=90, max_explores=20):
    p1 = health_analyze(project=project, model=model, timeframe_days=timeframe_days); mx = max(1, int(max_explores or 20)); exps = list(p1.get("explores") or []); capped = len(exps) > mx
    if not p1["vacuum_safe"] or capped: return _hv_vfail(p1["status"] if p1["status"] in ("permission_denied", "error") else ("truncated" if (p1["truncated"] or capped) else "ok"), p1["row_count"], p1["truncated"], p1["timeframe_days"], p1.get("error"), capped)
    if not exps: return _hv_env("ok", 0, 5000, False, True, p1["timeframe_days"], None, capped_explores=False, unused_models=p1["unused_models"], unused_explores=[], unused_joins=[], unused_fields=[])
    fu_f = {"field_usage.times_used": "0"}; m_names = [x["model"] for x in (p1.get("models") or []) if x.get("model")]
    if model or (project and m_names): fu_f["field_usage.model"] = str(model) if model else ",".join(m_names)
    fu = _sa_q("field_usage", ["field_usage.model", "field_usage.explore", "field_usage.view", "field_usage.field", "field_usage.times_used"], fu_f, None, 5000)
    if not fu["vacuum_safe"]: return _hv_vfail(fu["status"], fu["row_count"], fu["truncated"], p1["timeframe_days"], fu.get("error"))
    zmap, u_fields, u_joins = {}, [], []
    for r in fu["rows"]:
        if isinstance(r, dict):
            rm, rexp, rv, rf = str(r.get("field_usage.model") or ""), str(r.get("field_usage.explore") or ""), str(r.get("field_usage.view") or ""), str(r.get("field_usage.field") or "")
            ff = rf if ("." in rf or not rv) else (rv + "." + rf)
            if rexp and ff: zmap.setdefault((rm or "*", rexp), []).append(ff)
    for ex in exps[:mx]:
        mn, en = ex["model"], ex["explore"]
        try: meta = lookml_model_explore(mn, en, fields="name,joins(name,dependent_fields,required_joins),fields(dimensions(name,hidden),measures(name,hidden),filters(name),parameters(name))")
        except Exception as e: _re_perm(e); me = _sa_err(5000, e); return _hv_vfail(me["status"], fu["row_count"], False, p1["timeframe_days"], me.get("error"))
        if not isinstance(meta, dict) or meta.get("error") or meta.get("message") or not isinstance(meta.get("fields"), dict):
            me = _sa_err(5000, (meta.get("error") or meta.get("message") or meta) if isinstance(meta, dict) else "Invalid explore metadata"); return _hv_vfail(me["status"], fu["row_count"], False, p1["timeframe_days"], me.get("error"))
        zset = set((zmap.get((mn, en)) or []) + (zmap.get(("*", en)) or [])); ef = meta["fields"]; by_v = {}
        for cat in ("dimensions", "measures", "filters", "parameters"):
            for fd in (ef.get(cat) or []):
                if isinstance(fd, dict) and fd.get("name"):
                    fn = str(fd["name"]); by_v.setdefault(fn.split(".", 1)[0], []).append(fn)
                    if fn in zset: u_fields.append({"model": mn, "explore": en, "field": fn, "hidden": bool(fd.get("hidden"))})
        jlist = [x for x in (meta.get("joins") or []) if isinstance(x, dict) and x.get("name")]
        req_j = set([str(j["name"]) for j in jlist if any([x not in zset for x in (by_v.get(str(j["name"])) or [])])])
        for _ in jlist:
            for j in [x for x in jlist if str(x["name"]) in req_j]:
                for rj in (j.get("required_joins") or []): req_j.add(str(rj))
                for df in [str(d) for d in (j.get("dependent_fields") or []) if "." in str(d)]: req_j.add(df.split(".", 1)[0])
        for j in jlist:
            jn = str(j["name"]); jf = by_v.get(jn) or []
            if jn != en and jn not in req_j and jf and all([x in zset for x in jf]): u_joins.append({"model": mn, "explore": en, "join": jn})
    return _hv_env("ok", fu["row_count"], 5000, False, True, p1["timeframe_days"], None, capped_explores=False, unused_models=p1["unused_models"], unused_explores=p1["unused_explores"], unused_joins=u_joins, unused_fields=u_fields)
`
export const GAZER_JSON_PREAMBLE_PY = `import json
def _gz_fail(fn, cid, e):
    if "PermissionError" in str(e): raise e
    if cid:
        try: fn(cid, {"deleted": True})
        except Exception as e2:
            if "PermissionError" in str(e2): raise e2
    raise e
_GZ_RO = ("id", "user_id", "user_name", "folder", "folder_id", "space", "space_id", "content_metadata_id", "content_favorite_id", "slug", "created_at", "updated_at", "deleted_at", "last_updater_id", "last_updater_name", "last_updated_at", "last_accessed_at", "deleter_id", "view_count", "favorite_count", "last_viewed_at", "can", "url", "short_url", "embed_url", "public_url", "public_slug", "edit_uri", "lookml_link_id", "readonly", "refresh_interval_to_i", "alert_count", "dashboard_layout_id", "body_text_as_html", "note_text_as_html", "title_text_as_html", "subtitle_text_as_html", "look", "dashboard_title", "element_title", "element_title_hidden", "vis_type")
_GZ_RO_Q = ("id", "client_id", "slug", "share_url", "expanded_share_url", "url", "can", "created_at", "has_table_calculations")
_GZ_D_KEYS = ("description", "refresh_interval", "crossfilter_enabled", "preferred_viewer", "load_configuration", "query_timezone", "show_title", "text_tile_text_color", "tile_background_color", "tile_text_color", "title_color", "appearance")
def _gz_s(d, ex=()): return {k: v for k, v in dict(d or {}).items() if k not in _GZ_RO and k not in ex and v is not None}
def _gz_q(q): return {k: v for k, v in dict(q).items() if k not in _GZ_RO_Q and v is not None} if isinstance(q, dict) else None
def _gz_fid(folder_id):
    fid = "" if folder_id is None else str(folder_id).strip()
    if not fid or "/" in fid: raise ValueError("Valid non-empty folder_id is required")
    fr = folder(fid)
    if not isinstance(fr, dict) or fr.get("error") or fr.get("message"): raise ValueError("Invalid target folder: " + fid)
    return fid
def _gz_spec(src):
    if isinstance(src, dict): return dict(src)
    try: uf = dict(uploaded_files or {})
    except Exception: uf = {}
    s = str(src or "").strip(); b = s.split("/")[-1]; raw = uf[s] if s in uf else (uf["/workspace/uploads/" + b] if ("/workspace/uploads/" + b) in uf else (uf[b] if b in uf else src))
    if isinstance(raw, str) and raw.lstrip("\\ufeff").strip()[:1] in ("{", "["): raw = json.loads(raw.lstrip("\\ufeff").strip())
    if isinstance(raw, list) and len(raw) == 1 and isinstance(raw[0], dict): return dict(raw[0])
    if isinstance(raw, dict): return dict(raw)
    raise ValueError("Invalid portable JSON spec or unknown uploaded_files filename: " + s[:120])
def _gz_out(kind, cid, title, fid, **kw):
    ep = "/embed/" + kind + "s/" + cid; p = dict(kw, content_type=kind, contentType=kind, id=cid, title=title, folder_id=fid, folderId=fid, url=ep, embed_path=ep); p[kind + "_id"] = cid; return p
def export_dashboard_json(dashboard_id):
    did = str(dashboard_id); d = dict(dashboard(did) or {}); out = _gz_s(d, ("dashboard_elements", "dashboard_filters", "dashboard_layouts", "model")); out["dashboard_elements"] = []
    els = d["dashboard_elements"] if isinstance(d.get("dashboard_elements"), list) else (dashboard_dashboard_elements(did) or [])
    fls = d["dashboard_filters"] if isinstance(d.get("dashboard_filters"), list) else (dashboard_dashboard_filters(did) or [])
    lys = d["dashboard_layouts"] if isinstance(d.get("dashboard_layouts"), list) else (dashboard_dashboard_layouts(did) or [])
    for el in els:
        if isinstance(el, dict):
            ce = _gz_s(el, ("dashboard_id", "query_id", "result_maker_id", "query", "result_maker")); rm = el.get("result_maker") if isinstance(el.get("result_maker"), dict) else {}
            if el.get("id") is not None: ce["source_element_id"] = str(el["id"])
            rq = el.get("query") or rm.get("query") or (query(str(el["query_id"])) if el.get("query_id") else None)
            if isinstance(rq, dict): ce["query"] = _gz_q(rq)
            if rm.get("filterables"): ce["result_maker"] = {"filterables": [{"model": f.get("model"), "view": f.get("view"), "listen": list(f.get("listen") or [])} for f in rm["filterables"] if isinstance(f, dict)]}
            out["dashboard_elements"].append(ce)
    out["dashboard_filters"] = [_gz_s(fl, ("dashboard_id", "field")) for fl in fls if isinstance(fl, dict)]
    out["dashboard_layouts"] = [dict(_gz_s(ly, ("dashboard_id", "dashboard_layout_components")), dashboard_layout_components=[_gz_s(c) for c in (ly.get("dashboard_layout_components") or []) if isinstance(c, dict)]) for ly in lys if isinstance(ly, dict)]
    return out
def export_look_json(look_id):
    lk = dict(look(str(look_id)) or {}); out = _gz_s(lk, ("query", "query_id", "model", "image_embed_url", "excel_file_url", "google_spreadsheet_formula")); rq = lk.get("query") or (query(str(lk["query_id"])) if lk.get("query_id") else None)
    if isinstance(rq, dict): out["query"] = _gz_q(rq)
    return out
def import_dashboard_json(spec_or_filename, folder_id, title=None):
    spec = _gz_spec(spec_or_filename); fid = _gz_fid(folder_id); dtitle = str(title or spec.get("title") or "Imported Dashboard")
    new_id = str((create_dashboard(dict({k: spec[k] for k in _GZ_D_KEYS if spec.get(k) is not None}, title=dtitle, folder_id=fid, show_filters_bar=bool(spec.get("show_filters_bar", True)))) or {}).get("id") or "")
    if not new_id: raise ValueError("create_dashboard returned empty id")
    eid_map, fl_lsn, f_cnt, t_cnt = {}, {}, 0, 0
    try:
        for fl in (spec.get("dashboard_filters") or []):
            if isinstance(fl, dict):
                fname = str(fl.get("name") or fl.get("title") or "")
                for ek, fv in (fl["listen"].items() if isinstance(fl.get("listen"), dict) and fname else ()): fl_lsn.setdefault(str(ek), []).append({"dashboard_filter_name": fname, "field": str(fv)})
                create_dashboard_filter(dict(_gz_s(fl, ("dashboard_id", "field", "listen", "elements_to_update")), dashboard_id=new_id, row=int(fl.get("row", 0) or 0))); f_cnt += 1
        for el in (spec.get("dashboard_elements") or []):
            if isinstance(el, dict):
                old_eid = str(el.get("source_element_id") or el.get("id") or ""); rm = el.get("result_maker") if isinstance(el.get("result_maker"), dict) else {}; rq = el.get("query") or rm.get("query")
                qid = str((create_query(_gz_q(rq)) or {}).get("id") or "") if isinstance(rq, dict) and rq else ""; et = str(el.get("type") or ("vis" if qid else "text"))
                eb = dict(_gz_s(el, ("source_element_id", "dashboard_id", "query", "query_id", "result_maker", "result_maker_id", "listen")), dashboard_id=new_id, type=et)
                if qid: eb["query_id"] = qid
                lsn, l_arr, fb_m, fb_v = el.get("listen"), list(fl_lsn.get(old_eid) or []), (rq or {}).get("model"), (rq or {}).get("view")
                for fb_in in (rm.get("filterables") or []):
                    if isinstance(fb_in, dict): fb_m, fb_v = fb_m or fb_in.get("model"), fb_v or fb_in.get("view"); l_arr.extend([x for x in (fb_in.get("listen") or []) if isinstance(x, dict)])
                l_arr.extend([{"dashboard_filter_name": str(k), "field": str(v)} for k, v in lsn.items()] if isinstance(lsn, dict) else ([x for x in lsn if isinstance(x, dict)] if isinstance(lsn, list) else []))
                if l_arr and et not in ("text", "button"): eb["result_maker"] = {"filterables": [{"model": fb_m, "view": fb_v, "listen": l_arr}]}
                new_eid = str((create_dashboard_element(eb) or {}).get("id") or ""); t_cnt += 1
                if not new_eid: raise ValueError("create_dashboard_element returned empty id")
                if old_eid: eid_map[old_eid] = new_eid
        r_lys = spec.get("dashboard_layouts"); s_lys = [x for x in (r_lys if isinstance(r_lys, list) else []) if isinstance(x, dict)]
        for idx, sl in enumerate([x for x in s_lys if x.get("active")] + [x for x in s_lys if not x.get("active")]):
            s_cs = [x for x in (sl.get("dashboard_layout_components") or []) if isinstance(x, dict)]
            if idx == 0 and not s_cs: continue
            tl = (dashboard_dashboard_layouts(new_id) or []) if idx == 0 else None
            t_ly = (tl[0] if isinstance(tl, list) and tl else (tl if isinstance(tl, dict) else {})) if idx == 0 else (create_dashboard_layout(dict(_gz_s(sl, ("dashboard_id", "dashboard_layout_components")), dashboard_id=new_id, type=str(sl.get("type") or "newspaper"))) or {})
            lid = str(t_ly.get("id") or ""); l_cs = t_ly.get("dashboard_layout_components") or (dashboard_layout_dashboard_layout_components(lid) if lid else []) or []
            cmap = {str(c["dashboard_element_id"]): str(c["id"]) for c in l_cs if isinstance(c, dict) and c.get("dashboard_element_id") and c.get("id")}
            for sc in s_cs:
                meid = eid_map.get(str(sc.get("dashboard_element_id") or sc.get("element_id") or ""), "")
                if meid and lid and meid in cmap: update_dashboard_layout_component(cmap[meid], {"dashboard_layout_id": lid, "dashboard_element_id": meid, "row": int(sc.get("row", 0) or 0), "column": int(sc.get("column", sc.get("col", 0)) or 0), "width": int(sc.get("width", 12) or 12), "height": int(sc.get("height", 8) or 8)})
    except Exception as e: _gz_fail(update_dashboard, new_id, e)
    return _gz_out("dashboard", new_id, dtitle, fid, element_id_map=eid_map, tile_count=t_cnt, filter_count=f_cnt)
def import_look_json(spec_or_filename, folder_id, title=None):
    spec = _gz_spec(spec_or_filename); fid = _gz_fid(folder_id); ltitle = str(title or spec.get("title") or "Imported Look"); new_lid = ""
    try:
        rq = _gz_q(spec.get("query")); qid = str((create_query(rq) or {}).get("id") or "") if rq else ""
        if not rq or not qid: raise ValueError("Look JSON spec requires a valid query")
        new_lid = str((create_look(dict(_gz_s(spec, ("query", "query_id", "model", "image_embed_url", "excel_file_url", "google_spreadsheet_formula")), folder_id=fid, title=ltitle, query_id=qid)) or {}).get("id") or "")
        if not new_lid: raise ValueError("create_look returned empty id")
    except Exception as e: _gz_fail(update_look, new_lid, e)
    return _gz_out("look", new_lid, ltitle, fid)
`
const BODY_HELPER_ROUTE_RE = /^\/(?:api\/[0-9.]+\/)?folders\/__cm_helper__(?:%3A|:)(desc|tpl)(?:%3A|:)([\s\S]*)$/i
const needsHelper = (raw: string, fns: string[]): boolean => fns.some((fn) => new RegExp(`\\b${fn}\\b`).test(raw) && !new RegExp(`\\bdef\\s+${fn}\\b`).test(raw))
let codeModeMutexTail: Promise<void> = Promise.resolve()
let activeCodeModeHolder: { release: (() => void) | null } | null = null
const makeCodeModeAbortError = () => Object.assign(new Error('Code Mode execution aborted'), { name: 'AbortError', toJSON: () => 'Code Mode execution aborted' })
function acquireCodeModeSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(makeCodeModeAbortError())
  let releaseNext!: () => void
  const prevTail = codeModeMutexTail
  codeModeMutexTail = new Promise<void>((r) => { releaseNext = r })
  let released = false
  const release = () => {
    if (!released) {
      released = true
      if (activeCodeModeHolder?.release === release) activeCodeModeHolder.release = null
      releaseNext()
    }
  }
  return new Promise<() => void>((resolve, reject) => {
    let settled = false
    const onAbort = () => { if (!settled) { settled = true; reject(makeCodeModeAbortError()) } }
    signal?.addEventListener('abort', onAbort, { once: true })
    prevTail.then(() => {
      signal?.removeEventListener('abort', onAbort)
      if (settled || signal?.aborted) {
        release()
        if (!settled) { settled = true; reject(makeCodeModeAbortError()) }
        return
      }
      settled = true
      resolve(release)
    })
  })
}
export function enqueueCodeModeExecution<T>(fn: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
  return acquireCodeModeSlot(signal).then((initialRelease) => {
    const holder: { release: (() => void) | null } = { release: initialRelease }
    activeCodeModeHolder = holder
    return Promise.resolve().then(fn).then(
      (val) => { holder.release?.(); return val },
      (err) => { holder.release?.(); throw err }
    )
  })
}
export function yieldCodeModeExecution<T>(waitFn: () => Promise<T>, signal?: AbortSignal, onSuspend?: () => () => void): Promise<T> {
  const holder = activeCodeModeHolder
  if (!holder?.release) return waitFn()
  const rel = holder.release
  holder.release = null
  activeCodeModeHolder = null
  const resumeScope = onSuspend?.()
  rel()
  return waitFn().then(
    (val) => acquireCodeModeSlot(signal).then((nextRel) => { holder.release = nextRel; activeCodeModeHolder = holder; resumeScope?.(); return val }),
    (err) => acquireCodeModeSlot(signal).then((nextRel) => { holder.release = nextRel; activeCodeModeHolder = holder; resumeScope?.(); throw err }, () => { throw err })
  )
}
export function applyCodeModeHelpers(rt: CodeModeSchemaRuntimeLike, rawCode: string, currentCode: string, gatedHandler: CodeModeRequestHandler | undefined): { code: string; requestHandler: CodeModeRequestHandler | undefined } {
  let code = currentCode
  if (needsHelper(rawCode, ['export_dashboard_json', 'import_dashboard_json', 'export_look_json', 'import_look_json'])) code = GAZER_JSON_PREAMBLE_PY + code
  if (needsHelper(rawCode, ['health_pulse', 'health_analyze', 'health_vacuum'])) code = HENRY_CODEMODE_PREAMBLE_PY + code
  if (!needsHelper(rawCode, ['api_template', 'describe_body'])) return { code, requestHandler: gatedHandler }
  return {
    code: BODY_HELPER_PREAMBLE_PY + code,
    requestHandler: (m, p, q, b, o) => {
      const hit = String(m || 'GET').toUpperCase() === 'GET' ? String(p || '').match(BODY_HELPER_ROUTE_RE) : null
      if (hit) {
        let decoded = hit[2] || ''; try { decoded = decodeURIComponent(decoded) } catch { /* raw */ }
        return Promise.resolve(typeof rt.init === 'function' ? rt.init() : null).then(() => ({ ok: true, statusCode: 200, body: JSON.stringify(hit[1].toLowerCase() === 'desc' ? buildDescribeBody(rt, decoded) : buildApiTemplate(rt, decoded)) }))
      }
      if (!gatedHandler) return Promise.reject(Object.assign(new Error(`Looker SDK transport is not configured for ${m} ${p}`), { toJSON: () => `Looker SDK transport is not configured for ${m} ${p}` }))
      return gatedHandler(m, p, q, b, o)
    },
  }
}
