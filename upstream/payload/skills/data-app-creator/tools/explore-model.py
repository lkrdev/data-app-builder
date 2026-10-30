#!/usr/bin/env python3
"""
Explore and introspect LookML models, explores, dimensions, and measures.

Usage:
    # Introspect an explore and list its dimensions and measures:
    python3 skills/data-app-creator/tools/explore-model.py <model> <explore>

    # Introspect explore and show 5 sample data rows:
    python3 skills/data-app-creator/tools/explore-model.py <model> <explore> --sample

    # List all explores in a model:
    python3 skills/data-app-creator/tools/explore-model.py <model>

    # List all available models:
    python3 skills/data-app-creator/tools/explore-model.py --list-models
"""

from __future__ import annotations

import argparse
import concurrent.futures

VALUES_LIMIT = 50
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import http.client
import time
from pathlib import Path


def _base_ssl_context():
    """A usable CA bundle, nothing host-specific."""
    candidates = [
        "/etc/ssl/cert.pem",                       # macOS
        "/etc/pki/tls/certs/ca-bundle.crt",        # RHEL/CentOS
        "/etc/ssl/certs/ca-certificates.crt",      # Debian/Ubuntu
        "/opt/homebrew/etc/openssl@3/cert.pem",    # Homebrew (Apple Silicon)
        "/usr/local/etc/openssl@3/cert.pem",       # Homebrew (Intel)
    ]
    cafile = next((p for p in candidates if os.path.exists(p)), None)
    if cafile is None:
        try:
            import certifi  # type: ignore
            cafile = certifi.where()
        except ImportError:
            return ssl.create_default_context()
    return ssl.create_default_context(cafile=cafile)


def _looker_ssl_context():
    """The base context, plus trust for a private CA if the instance opted in.

    A Looker instance behind a private CA -- a local dev instance, or an
    internal deployment -- serves a certificate the base store has no reason
    to trust, and such certs sometimes carry a key below OpenSSL's default
    security level. Point LOOKER_CA_BUNDLE at that certificate to trust it.
    Verification stays on: the cert is added as an anchor, never bypassed.
    """
    ctx = _base_ssl_context()
    extra_ca = os.environ.get("LOOKER_CA_BUNDLE")
    if extra_ca and os.path.exists(extra_ca):
        ctx.load_verify_locations(cafile=extra_ca)
        # Scoped to this context, which only ever talks to the Looker
        # instance. Installed as the process default it would also lower the
        # cipher floor for any future non-Looker fetch added to this file --
        # a host that never opted in.
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    return ctx


# Unqualified urlopen() calls keep the base context; the Looker calls below
# pass _LOOKER_SSL_CTX explicitly.
urllib.request.install_opener(
    urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=_base_ssl_context())))

_LOOKER_SSL_CTX = _looker_ssl_context()


def load_config() -> dict:
    merged = {}
    candidates = [
        Path.cwd() / "data-apps-config.json",
    ]
    curr = Path(__file__).resolve().parent
    while curr != curr.parent:
        candidates.append(curr / "data-apps-config.json")
        if (curr / ".git").exists():
            break
        curr = curr.parent

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            try:
                data = json.loads(candidate.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    merged.update(data)
                    break
            except Exception:
                pass

    base_url = os.environ.get("LOOKERSDK_BASE_URL") or os.environ.get("LOOKER_BASE_URL")
    if base_url:
        merged["base_url"] = base_url
    client_id = os.environ.get("LOOKERSDK_CLIENT_ID") or os.environ.get("LOOKER_CLIENT_ID")
    if client_id:
        merged["client_id"] = client_id
    client_secret = os.environ.get("LOOKERSDK_CLIENT_SECRET") or os.environ.get("LOOKER_CLIENT_SECRET")
    if client_secret:
        merged["client_secret"] = client_secret
    return merged


def login(base_url, client_id, client_secret):
    body = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret}
    ).encode()
    req = urllib.request.Request(
        f"{base_url}/api/4.0/login", data=body, method="POST"
    )
    with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX) as r:
        return json.loads(r.read())["access_token"]


def api_call(base_url, token, path, method="GET", body=None):
    url = f"{base_url}/api/4.0{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"token {token}",
        "Content-Type": "application/json",
    }
    # Looker's metadata payloads are large (~120KB) and the read is sometimes
    # cut off mid-transfer — urllib raises IncompleteRead and the whole call
    # fails, which used to force the agent to re-run the command (a wasted turn).
    # These are transient, so retry the request a few times. A real HTTP status
    # error (4xx/5xx) is not transient and is raised immediately, not retried.
    last_err = None
    for attempt in range(4):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw_err = e.read().decode("utf-8", errors="ignore")
            clean_msg = raw_err
            try:
                parsed = json.loads(raw_err)
                if isinstance(parsed, dict) and "message" in parsed:
                    clean_msg = parsed["message"]
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code}: {clean_msg}") from e
        except (http.client.IncompleteRead, http.client.HTTPException,
                urllib.error.URLError, ConnectionError, TimeoutError,
                json.JSONDecodeError) as e:
            last_err = e
            if attempt < 3:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(
        f"transient network error after 4 tries (last: {last_err})") from last_err


def render_dense_schema(model: str, explore: str, explore_meta: dict, notes: str | None = None, scopes: list | None = None) -> str:
    fields = explore_meta.get("fields", {})
    dims = [d for d in fields.get("dimensions", []) if not d.get("hidden")]
    measures = [m for m in fields.get("measures", []) if not m.get("hidden")]

    lines = [f"\n# Explore: `{model}.{explore}`"]
    label = explore_meta.get("label", explore)
    if label and label != explore:
        lines.append(f"**Label:** {label}")
    if explore_meta.get("description"):
        lines.append(f"**Description:** {explore_meta.get('description')}")
    if scopes:
        lines.append(f"**Joined Views:** " + ", ".join(f"`{s}`" for s in scopes))
    if notes:
        lines.append(f"\n> [!NOTE]\n> **Explore Notes & Known Quirks:** {notes}")

    # Detect if measures span multiple unnested array views
    array_views = set()
    for m in measures:
        parts = m.get("name", "").split(".")
        if len(parts) >= 2 and "__" in parts[0]:
            base, sub = parts[0].rsplit("__", 1)
            array_views.add((base, sub))
    bases = {}
    for base, sub in array_views:
        bases.setdefault(base, set()).add(sub)

    for base, subs in bases.items():
        if len(subs) > 1:
            views_list = ", ".join(f"`{base}__{s}`" for s in sorted(subs))
            lines.append(
                f"\n> [!TIP]\n> **Multi-Array Views Detected:** This explore contains multiple unnested array views ({views_list}).\n> In LookML/BigQuery, measures from different unnested array views cannot be combined in a single chart query (causes SQL cartesian fan-out timeouts). Place them in separate charts or KPIs.\n"
            )

    def _sql_of(f):
        s = " ".join(str(f.get("sql") or "").split())
        return f"[sql: {s}]" if s else ""

    def _filters_of(f):
        fl = f.get("filters") or []
        if not fl:
            return ""
        return "[filters: " + "; ".join(
            f"`{x.get('field')} {x.get('condition')}`" for x in fl if isinstance(x, dict)
        ) + "]"

    lines.append("\n## Measures (Metrics):")
    if not measures:
        lines.append("  (none)")
    for m in measures:
        name = m.get("name", "")
        m_type = m.get("type", "number")
        label = m.get("label_short") or m.get("label", name)
        desc = m.get("description")
        desc_str = f" - {desc}" if desc else (f" - {label}" if label and label != name else "")
        sql_str = f" {_sql_of(m)}" if _sql_of(m) else ""
        flt_str = f" {_filters_of(m)}" if _filters_of(m) else ""
        lines.append(f"  • `{name}` ({m_type}){desc_str}{sql_str}{flt_str}")

    lines.append("\n## Dimensions (Attributes & Groupings):")
    if not dims:
        lines.append("  (none)")
    for d in dims:
        name = d.get("name", "")
        d_type = d.get("type", "string")
        label = d.get("label_short") or d.get("label", name)
        desc = d.get("description")
        desc_str = f" - {desc}" if desc else (f" - {label}" if label and label != name else "")
        lines.append(f"  • `{name}` ({d_type}){desc_str}")

    return "\n".join(lines)


def render_catalog_entry(model: str, explore: str, explore_meta: dict) -> str:
    label = explore_meta.get("label") or explore
    scopes = explore_meta.get("scopes") or []
    meas = [x for x in explore_meta.get("fields", {}).get("measures", []) if not x.get("hidden")]
    dims = [x for x in explore_meta.get("fields", {}).get("dimensions", []) if not x.get("hidden")]
    desc = explore_meta.get("description") or ""
    if len(desc) > 90:
        desc = desc[:87] + "..."

    lines = [f"• `{model}.{explore}` ({label})"]
    if desc:
        lines.append(f"  Description: {desc}")
    views_str = ", ".join(f"`{s}`" for s in scopes)
    if views_str:
        lines.append(f"  Views: {views_str}")

    meas_names = [f"`{x['name']}`" for x in meas]
    m_sample = ", ".join(meas_names[:6])
    m_suffix = f" ... (+{len(meas_names)-6} more)" if len(meas_names) > 6 else ""
    lines.append(f"  Measures ({len(meas_names)}): {m_sample}{m_suffix}")
    lines.append(f"  Dimensions: {len(dims)} fields (run `explore-model.py {model} {explore}` for full list)")
    return "\n".join(lines)


def main():
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    parser = argparse.ArgumentParser(
        description="Inspect LookML models, explores, fields, and test queries."
    )
    parser.add_argument("model", nargs="?", help="LookML model name (e.g. ecommerce, sales_analytics)")
    parser.add_argument("explore", nargs="?", help="Explore name (e.g. orders, users)")
    parser.add_argument("--probe", action="store_true", help="Preflight check fields with a live 1-row query each to verify SQL validity. One query PER FIELD -- scope it with --fields on wide explores.")
    parser.add_argument("--fields", default=None, metavar="A,B,C", help="Comma-separated field names to limit --probe to (e.g. orders.count,users.state). Strongly recommended: unscoped --probe runs one live query for every field in the explore.")
    parser.add_argument("--values", default=None, metavar="A,B",
                        help="List the distinct values of one or more dimensions, for building a filter dropdown. One small query per field.")
    parser.add_argument("--all-fields", action="store_true", help="Probe every field even on a wide explore. Slow: one live query per field.")
    parser.add_argument("--sample", action="store_true", help="Fetch 5 sample rows for the top dimensions & measures")
    parser.add_argument("--list-models", action="store_true", help="List all available LookML models")
    parser.add_argument("--full", action="store_true", help="Dump full dense schemas for every explore in the model (verbose)")
    parser.add_argument("--names-only", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--json", action="store_true", help="Output schema metadata in JSON format")
    args = parser.parse_args()

    cfg = load_config()
    raw_base = (
        cfg.get("base_url")
        or cfg.get("looker_url")
        or cfg.get("looker_instance_url")
        or "http://127.0.0.1:9966"
    )
    base_url = str(raw_base).rstrip("/")
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")

    token = None
    if client_id and client_secret:
        try:
            token = login(base_url, client_id, client_secret)
        except Exception as e:
            sys.stderr.write(f"warning: Looker API direct login failed ({e}).\n")

    if args.list_models:
        if not token:
            sys.exit("error: Direct Looker credentials required in data-apps-config.json to list all models.")
        models = api_call(base_url, token, "/lookml_models")
        if args.json:
            print(json.dumps(models, indent=2))
            return
        print("\n# Available LookML Models\n")
        print("| Model Name | Label | Explores |")
        print("| :--- | :--- | :--- |")
        for m in models:
            name = m.get("name", "")
            label = m.get("label", name)
            explores = ", ".join(e.get("name", "") for e in m.get("explores", []))
            print(f"| `{name}` | {label} | {explores} |")
        return

    if not args.model:
        # Instance catalog across all active models
        if not token:
            sys.exit("error: Direct Looker credentials required to explore models.")
        models_data = api_call(base_url, token, "/lookml_models?fields=name,explores")
        active = []
        for m in (models_data or []):
            name = m.get("name")
            if not name:
                continue
            explores = [e.get("name") for e in m.get("explores", []) if not e.get("hidden")]
            if explores:
                active.append((name, sorted(explores)))
        active.sort(key=lambda x: x[0])

        if not active:
            print("No active models or explores found.")
            return

        total_explores = sum(len(elist) for _, elist in active)
        print(f"\n# Looker Instance Catalog ({len(active)} active models, {total_explores} explores)\n")
        print("Run `explore-model.py <model> <explore>` for full dimension & measure details of a specific explore.\n")

        def fetch_mod_exp(mod_name, exp_name):
            try:
                res = api_call(base_url, token, f"/lookml_models/{mod_name}/explores/{exp_name}?fields=fields(dimensions(name,type,description,primary_key),measures(name,type,sql,description)),label,description,scopes")
                return mod_name, exp_name, res
            except Exception:
                return mod_name, exp_name, None

        tasks = [(m, e) for m, elist in active for e in elist]
        results_map = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            future_to_task = {executor.submit(fetch_mod_exp, m, e): (m, e) for m, e in tasks}
            for future in concurrent.futures.as_completed(future_to_task):
                mod_name, exp_name, emeta = future.result()
                results_map[(mod_name, exp_name)] = emeta

        for m, elist in active:
            for e in elist:
                emeta = results_map.get((m, e))
                if emeta:
                    print(render_catalog_entry(m, e, emeta))
                    print()
                else:
                    print(f"• `{m}.{e}`\n")
        return

    if not args.explore:
        # List explores in model (compact summary table by default; --full for dense schema dump)
        if not token:
            sys.exit("error: Direct Looker credentials required to list explores in model.")
        m = api_call(base_url, token, f"/lookml_models/{args.model}")
        if args.json:
            print(json.dumps(m.get("explores", []), indent=2))
            return
        explores_list = [e for e in m.get("explores", []) if not e.get("hidden")]

        if not args.full:
            print(f"\n# Explores in Model: `{args.model}`\n")
            print("| Explore Name | Label | Joined Views | Description |")
            print("| :--- | :--- | :--- | :--- |")
            scopes_map = {}
            def fetch_scopes(e_name):
                try:
                    res = api_call(base_url, token, f"/lookml_models/{args.model}/explores/{e_name}?fields=scopes")
                    return e_name, res.get("scopes", [])
                except Exception:
                    return e_name, []

            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                futures = {executor.submit(fetch_scopes, e.get("name", "")): e.get("name", "") for e in explores_list}
                for future in concurrent.futures.as_completed(futures):
                    ename, scopes = future.result()
                    scopes_map[ename] = scopes

            for e in explores_list:
                name = e.get("name", "")
                label = e.get("label", name)
                desc = e.get("description") or "—"
                scopes = scopes_map.get(name, [])
                views_str = ", ".join(f"`{s}`" for s in scopes) if scopes else f"`{name}`"
                print(f"| `{name}` | {label} | {views_str} | {desc} |")
            return

        # Full dense schema dump for all active explores in this model (--full)
        if not explores_list:
            print(f"\n# Explores in Model: `{args.model}`\n\n(no active explores)")
            return

        print(f"\n# Model Schema Dump: `{args.model}` ({len(explores_list)} explore(s))\n")

        def fetch_full_explore(e_name):
            try:
                res = api_call(base_url, token, f"/lookml_models/{args.model}/explores/{e_name}")
                if not res or "scopes" not in res:
                    try:
                        s_res = api_call(base_url, token, f"/lookml_models/{args.model}/explores/{e_name}?fields=scopes")
                        if s_res and "scopes" in s_res:
                            if not res:
                                res = {}
                            res["scopes"] = s_res["scopes"]
                    except Exception:
                        pass
                return e_name, res
            except Exception:
                return e_name, None

        results_map = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(fetch_full_explore, e.get("name", "")): e.get("name", "") for e in explores_list}
            for future in concurrent.futures.as_completed(futures):
                ename, emeta = future.result()
                results_map[ename] = emeta

        for e in explores_list:
            ename = e.get("name", "")
            emeta = results_map.get(ename)
            if emeta:
                enotes = cfg.get("explore_notes", {}).get(f"{args.model}.{ename}") or cfg.get("known_gotchas", {}).get(f"{args.model}.{ename}")
                print(render_dense_schema(args.model, ename, emeta, enotes, scopes=emeta.get("scopes")))
                print("\n" + "=" * 60)
            else:
                print(f"\n# Explore: `{args.model}.{ename}`")
                print(f"**Joined Views:** `{ename}`")
        return

    # Introspect explore
    explore_meta = None
    if token:
        try:
            explore_meta = api_call(base_url, token, f"/lookml_models/{args.model}/explores/{args.explore}")
            if explore_meta and "scopes" not in explore_meta:
                try:
                    s_res = api_call(base_url, token, f"/lookml_models/{args.model}/explores/{args.explore}?fields=scopes")
                    if s_res and "scopes" in s_res:
                        explore_meta["scopes"] = s_res["scopes"]
                except Exception:
                    pass
        except Exception as e:
            sys.stderr.write(f"API explore fetch error: {e}\n")

    if not explore_meta:
        sys.exit(f"error: Could not load metadata for explore `{args.model}.{args.explore}`.")

    fields = explore_meta.get("fields", {})
    dims = [d for d in fields.get("dimensions", []) if not d.get("hidden")]
    measures = [m for m in fields.get("measures", []) if not m.get("hidden")]

    notes = cfg.get("explore_notes", {}).get(f"{args.model}.{args.explore}") or cfg.get("known_gotchas", {}).get(f"{args.model}.{args.explore}")

    if args.json:
        payload = {
            "model": args.model,
            "explore": args.explore,
            "label": explore_meta.get("label", args.explore),
            "description": explore_meta.get("description"),
            "notes": notes,
            "measures": [{
                "name": m.get("name"),
                "type": m.get("type", "number"),
                "label": m.get("label_short") or m.get("label", m.get("name")),
                "description": m.get("description"),
            } for m in measures],
            "dimensions": [{
                "name": d.get("name"),
                "type": d.get("type", "string"),
                "label": d.get("label_short") or d.get("label", d.get("name")),
                "description": d.get("description"),
            } for d in dims],
        }
        print(json.dumps(payload, indent=2))
        return

    # `--values` is a focused request: list only the distinct values behind a
    # dimension (for a filter dropdown). If called without --probe, return
    # immediately to keep the output surgical.
    if args.values and token:
        print(f"# Filter Values: `{args.model}.{args.explore}`\n")
        wanted = [f.strip() for f in args.values.split(",") if f.strip()]
        known = {f.get("name") for f in dims + measures}
        for fname in wanted:
            if fname not in known:
                print(f"### `{fname}`\n\n> Not a field in this explore.\n")
                continue
            try:
                rows = api_call(base_url, token, "/queries/run/json", method="POST", body={
                    "model": args.model,
                    "view": args.explore,
                    "fields": [fname],
                    "sorts": [fname],
                    "limit": str(VALUES_LIMIT),
                })
            except Exception as e:
                print(f"### `{fname}`\n\n> Query failed: `{str(e).splitlines()[0]}`\n")
                continue
            vals = [r.get(fname) for r in (rows or [])]
            vals = [v for v in vals if v is not None]
            print(f"### `{fname}` — {len(vals)} value(s)"
                  + (f", showing first {VALUES_LIMIT}" if len(vals) >= VALUES_LIMIT else "") + "\n")
            if not vals:
                print("> No values returned (the column may be entirely null).\n")
            else:
                print(", ".join(f"`{v}`" for v in vals) + "\n")
        if not args.probe:
            return

    # When --probe and --fields are provided, skip dumping the 300-line schema
    # tables so that field verification stays surgical and token-efficient.
    skip_schema = bool(args.probe and args.fields)

    if not skip_schema:
        print(render_dense_schema(args.model, args.explore, explore_meta, notes, scopes=explore_meta.get("scopes")))

    if args.probe and token:
        print("\n## Field Health Preflight Probing (`--probe`)\n")
        print("Testing live SQL compilation for measures & dimensions in parallel...\n")

        def probe_field(field_obj, f_type):
            fname = field_obj.get("name")
            try:
                probe_body = {
                    "model": args.model,
                    "view": args.explore,
                    "fields": [fname],
                    "limit": "1",
                }
                res = api_call(base_url, token, "/queries/run/json", method="POST", body=probe_body)
                val = res[0].get(fname) if (res and len(res) > 0) else "null"
                return (True, fname, f_type, f"OK (sample: `{val}`)")
            except Exception as e:
                err_msg = str(e).split("\n")[0]
                return (False, fname, f_type, f"**FAILED (HTTP 400)**: `{err_msg}`")

        probe_items = [(m, "measure") for m in measures] + [(d, "dimension") for d in dims if not d.get("hidden")]

        # --fields scopes the probe to the candidates the author actually plans
        # to use. Unscoped, this is one live Looker query per field, which on a
        # 400-field enterprise explore is 400 queries -- enough that an agent
        # will (rightly) skip the step entirely.
        if args.fields:
            wanted = {f.strip() for f in args.fields.split(",") if f.strip()}
            probe_items = [it for it in probe_items if it[0].get("name") in wanted]
            missing = wanted - {it[0].get("name") for it in probe_items}
            if missing:
                print(f"> **Not found in this explore:** {', '.join(sorted(missing))}\n")
            if not probe_items:
                print("> No matching fields to probe. Check the names against the tables above.\n")

        # A warning here was not enough: agents ran the unscoped probe anyway and
        # burned minutes waiting on hundreds of live queries. Above the
        # threshold this now refuses, because the correct move is always to
        # name the handful of fields the first screen needs.
        PROBE_LIMIT = 25
        if not args.fields and not args.all_fields and len(probe_items) > PROBE_LIMIT:
            names = [it[0].get("name") for it in probe_items[:6] if it[0].get("name")]
            print(f"> [!WARNING]\n> **Refusing to probe {len(probe_items)} fields unscoped** "
                  f"-- that is {len(probe_items)} live queries and several minutes of waiting.\n>\n"
                  f"> Probe only what your first screen needs:\n>\n"
                  f"> `--fields {','.join(names[:4]) or 'view.field_a,view.field_b'}`\n>\n"
                  f"> The field tables above already show you what exists; the probe only\n"
                  f"> tells you whether a field *compiles*, which matters for the few you\n"
                  f"> are about to build against. Pass `--all-fields` to override.\n")
            sys.exit(2)

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_item = {executor.submit(probe_field, item[0], item[1]): item for item in probe_items}
            for future in concurrent.futures.as_completed(future_to_item):
                results.append(future.result())

        # Group results by view name
        by_view = {}
        for ok, fname, f_type, msg in results:
            vname = fname.split('.')[0] if '.' in fname else args.explore
            by_view.setdefault(vname, []).append((ok, fname, f_type, msg))

        # Print primary view first, then joined views
        views_sorted = sorted(by_view.keys(), key=lambda v: (0 if v == args.explore else 1, v))
        for vname in views_sorted:
            v_results = sorted(by_view[vname], key=lambda r: (0 if r[2] == "measure" else 1, r[1]))
            v_failed = [r for r in v_results if not r[0]]
            v_title = f"View: `{vname}`" + (" (Primary Explore View)" if vname == args.explore else " (Joined View)")
            print(f"\n### {v_title}\n")
            if v_failed:
                print(f"> [!WARNING]\n> **{len(v_failed)} field(s) in `{vname}` failed query compilation.**\n> If `{vname}` is a joined derived table that fails inside this explore, query it via its dedicated sibling explore (e.g. `explore: '{vname}'`) instead of through `{args.explore}`.\n")
            print("| Status | Field Name | Type | Result / Error |")
            print("| :--- | :--- | :--- | :--- |")
            for ok, fname, f_type, msg in v_results:
                status_icon = "`✓ Live`" if ok else "`✗ Error`"
                print(f"| {status_icon} | `{fname}` | {f_type} | {msg} |")

    # `--values` is handled earlier (before the schema tables) so it returns
    # values-only output. Looker carries no distinct values in field metadata
    # (`suggestions` is empty, `enumerations` set on almost nothing), so they can
    # only be fetched — a bare dimension with no measure is a cheap grouped scan.

    if args.sample:
        print("\n## Sample Data (Top 5 Rows)\n")

        # Sample fields must all come from ONE view. Picking the first couple of
        # dimensions and the first couple of measures regardless of view is how
        # this used to hang: in an explore with unnested arrays, dimensions from
        # `parent__line_details` plus measures from `parent__function_details`
        # cross-join into a Cartesian fan-out and the query never returns. A
        # sample is meant to show the shape of the data in seconds, so it should
        # never be the thing that stalls.
        def view_of(f):
            return f.get("name", "").split(".")[0]

        usable_dims = [d for d in dims if not d.get("hidden")]
        usable_meas = [m for m in measures if not m.get("hidden")]

        by_view = {}
        for f in usable_dims:
            by_view.setdefault(view_of(f), {"dims": [], "meas": []})["dims"].append(f["name"])
        for f in usable_meas:
            by_view.setdefault(view_of(f), {"dims": [], "meas": []})["meas"].append(f["name"])

        # Prefer the explore's own base view (usually the interesting grain);
        # otherwise the view offering the most to look at. Views with both a
        # dimension and a measure win over ones with only half the picture.
        # Completeness first: a sample with no measure is half a sample, and the
        # point of --sample is seeing what real values look like. The explore's
        # own view breaks ties, since that is the natural grain.
        def rank(item):
            view, fields = item
            complete = bool(fields["dims"]) and bool(fields["meas"])
            return (complete, view == args.explore, len(fields["dims"]) + len(fields["meas"]))

        # Try the best candidate view, then fall back. Two things make a single
        # static choice unreliable: a view can fail to compile at all (a joined
        # view with broken keys returns HTTP 400), and the "most complete" view
        # is not always a working one. A sample should degrade to something
        # rather than fail outright, so walk the ranked list.
        candidates = sorted(by_view.items(), key=rank, reverse=True)[:4]

        if not candidates or not token:
            print("*No sampleable fields found.*")
        else:
            for view, fields in candidates:
                sample_fields = fields["dims"][:2] + fields["meas"][:2]
                if not sample_fields:
                    continue
                try:
                    sample_rows = api_call(
                        base_url, token, "/queries/run/json", method="POST",
                        body={
                            "model": args.model,
                            "view": args.explore,
                            "fields": sample_fields,
                            "limit": "5",
                        },
                    )
                except Exception as e:
                    print(f"> Skipped `{view}`: {str(e).splitlines()[0]}\n")
                    continue

                print(f"> Sampling `{view}` only. Fields from two views can "
                      f"cross-join into a fan-out that never returns, so a sample "
                      f"never mixes them — use `--probe --fields a,b,c` to check "
                      f"specific fields across views.\n")
                if sample_rows:
                    print("| " + " | ".join(f"`{f}`" for f in sample_fields) + " |")
                    print("| " + " | ".join(":---" for _ in sample_fields) + " |")
                    for row in sample_rows:
                        print("| " + " | ".join(str(row.get(f, "—")) for f in sample_fields) + " |")
                else:
                    print("*No sample rows returned.*")
                break
            else:
                print("*No view in this explore returned a sample. "
                      "Try `--probe --fields <a,b,c>` on specific fields.*")


if __name__ == "__main__":
    main()
