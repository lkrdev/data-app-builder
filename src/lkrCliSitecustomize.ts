import { normalizeLookerApiPath } from './lookerTransport'

export const LKR_DEV_CLI_VERSION = '0.0.69'
export const LKR_DEV_CLI_SPEC = `lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION}`

export interface LkrExtensionToolRequest {
  kind: 'codemode' | 'sdk_request' | 'file_ref'
  cache_key?: string
  req_path?: string
  code?: string
  vars?: Record<string, unknown>
  dev_mode?: boolean
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | string
  path?: string
  query_params?: Record<string, unknown> | null
  body?: unknown
  thought?: string
}

export const LKR_CLI_SITECUSTOMIZE_PY = `"""Antigravity Looker Extension Bridge for lkr-dev-cli (sitecustomize.py).

Intercepts online lkr-dev-cli calls (lkr.codemode.main.sandbox / run_python_code and
lkr.auth_service.init_sdk / get_auth / RequestsTransport.request) when no Looker
credentials exist in the container environment, checks /workspace/.lkr_extension_cache/<key>.json,
and emits <LKR_EXTENSION_TOOL_REQUEST>{...}</LKR_EXTENSION_TOOL_REQUEST> on cache misses.
"""
import builtins
import functools
import hashlib
import json
import os
import re
import sys
import types
from pathlib import Path

def _bridge_enabled() -> bool:
    if os.environ.get("LKR_DISABLE_EXTENSION_BRIDGE") in ("1", "true", "yes"):
        return False
    return not (
        os.environ.get("LOOKERSDK_BASE_URL")
        and os.environ.get("LOOKERSDK_CLIENT_ID")
        and os.environ.get("LOOKERSDK_CLIENT_SECRET")
        and os.environ.get("LKR_FORCE_EXTENSION_BRIDGE") not in ("1", "true", "yes")
    )

if _bridge_enabled():
    os.environ.setdefault("LOOKERSDK_BASE_URL", "https://extension.looker.local")

def _normalize_bridge_path(raw_path: str) -> str:
    p = re.sub(r"^https?://[^/]+", "", str(raw_path or "").strip())
    p = re.sub(r"^/api/4\\.0(?=/|$)", "", p)
    return p if p.startswith("/") else f"/{p}"

def _clean_query_params(qp):
    cleaned = {str(k): v for k, v in qp.items() if v is not None} if isinstance(qp, dict) else {}
    return cleaned or None

def _parse_body(body):
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8", errors="replace")
    if isinstance(body, str):
        s = body.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return s
    return body

def _compute_cache_key(payload: dict) -> str:
    if payload.get("kind") == "sdk_request":
        norm = {
            "kind": "sdk_request",
            "method": str(payload.get("method") or "GET").upper(),
            "path": _normalize_bridge_path(payload.get("path") or "/"),
            "query_params": _clean_query_params(payload.get("query_params")),
            "body": _parse_body(payload.get("body")),
            "dev_mode": bool(payload.get("dev_mode", False)),
        }
    else:
        raw_vars = payload.get("vars") or {}
        norm = {
            "kind": "codemode",
            "code": str(payload.get("code") or "").strip(),
            "vars": {str(k): v for k, v in sorted(raw_vars.items())} if isinstance(raw_vars, dict) else {},
            "dev_mode": bool(payload.get("dev_mode", False)),
        }
    canonical = json.dumps(norm, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def _cache_dirs() -> list[Path]:
    cands = [
        os.environ.get("LKR_EXTENSION_CACHE_DIR"),
        str(Path(os.environ.get("WORKSPACE_DIR", "/workspace")) / ".lkr_extension_cache"),
        str(Path.cwd() / ".lkr_extension_cache"),
    ]
    return [Path(p) for p in dict.fromkeys(c for c in cands if c)]

def _read_cache(cache_key: str):
    for d in _cache_dirs():
        f = d / f"{cache_key}.json"
        if f.is_file():
            txt = f.read_text(encoding="utf-8")
            if "PermissionError:" in txt:
                continue
            raw = json.loads(txt)
            val = raw["result"] if isinstance(raw, dict) and "result" in raw and (raw.get("__lkr_bridge_envelope__") or set(raw.keys()) <= {"cacheKey", "cache_key", "result", "ok"}) else raw
            if isinstance(val, dict) and val.get("__lookml_pull__") and not (val.get("files") or {}):
                try: f.unlink()
                except Exception: pass
                return False, None
            return True, val
    return False, None

def _format_bridge_tag(req_dict: dict) -> str:
    raw_json = json.dumps(req_dict, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    if len(raw_json) > 8000 and os.environ.get("LKR_EXTENSION_CACHE_DIR") is None:
        cdir = Path(os.environ.get("WORKSPACE_DIR", "/workspace")) / ".lkr_extension_cache"
        cdir.mkdir(parents=True, exist_ok=True)
        rfile = cdir / f"_req_{req_dict.get('cache_key')}.json"
        rfile.write_text(raw_json, encoding="utf-8")
        ref_obj = {"kind": "file_ref", "cache_key": req_dict.get("cache_key"), "req_path": str(rfile), "dev_mode": bool(req_dict.get("dev_mode", False))}
        raw_json = json.dumps(ref_obj, sort_keys=True, separators=(",", ":"))
    return "<LKR_EXTENSION_TOOL_REQUEST>" + raw_json + "</LKR_EXTENSION_TOOL_REQUEST>"

def _emit_bridge_request(req_dict: dict):
    tag = _format_bridge_tag(req_dict)
    sys.stdout.write(tag + "\\n")
    sys.stdout.flush()
    sys.stderr.write(
        f"[lkr-extension-bridge] Online Looker call routed to host extension (cache_key={req_dict.get('cache_key')}). "
        f"Call tool lkr_cli_extension_bridge with the JSON inside <LKR_EXTENSION_TOOL_REQUEST> (never call run_looker_codemode with open()); if replay_needed is true, write result to /workspace/.lkr_extension_cache/{req_dict.get('cache_key')}.json and replay (skip cache write and CLI replay when replay_needed is false).\\n{tag}\\n"
    )
    sys.stderr.flush()
    raise SystemExit(2)

def _parse_var_list(var_list) -> dict:
    return {k.strip(): v for item in (var_list or []) if isinstance(item, str) and "=" in item for k, v in [item.split("=", 1)]}

def _handle_codemode(code_str: str, vars_dict: dict, is_dev_mode: bool) -> str:
    req = {
        "kind": "codemode",
        "code": str(code_str or "").strip(),
        "vars": dict(sorted((vars_dict or {}).items())),
        "dev_mode": bool(is_dev_mode),
    }
    req["cache_key"] = _compute_cache_key(req)
    hit, val = _read_cache(req["cache_key"])
    if hit:
        return val if isinstance(val, str) else json.dumps(val, indent=2, default=str)
    _emit_bridge_request(req)

class ExtensionBridgeTransport:
    def __init__(self, dev_mode: bool = False):
        self.dev_mode = bool(dev_mode)

    @classmethod
    def configure(cls, settings=None):
        return cls()

    def request(self, method, path: str, query_params=None, body=None, authenticator=None, transport_options=None):
        from looker_sdk.rtl import transport as rtl_transport
        method_str = getattr(method, "name", str(method)).upper().replace("HTTPMETHOD.", "")
        clean_path = _normalize_bridge_path(path)
        parsed_body = _parse_body(body)
        clean_qp = _clean_query_params(query_params)
        if clean_path == "/session" and method_str == "PATCH" and isinstance(parsed_body, dict):
            if parsed_body.get("workspace_id") in ("dev", "production"):
                self.dev_mode = parsed_body["workspace_id"] == "dev"
            ws = "dev" if self.dev_mode else "production"
            return rtl_transport.Response(True, json.dumps({"workspace_id": ws}).encode("utf-8"), rtl_transport.ResponseMode.STRING, "utf-8")
        req = {
            "kind": "sdk_request",
            "method": method_str,
            "path": clean_path,
            "query_params": clean_qp,
            "body": parsed_body,
            "dev_mode": bool(self.dev_mode),
        }
        req["cache_key"] = _compute_cache_key(req)
        hit, val = _read_cache(req["cache_key"])
        if hit:
            raw_bytes = (val if isinstance(val, str) else json.dumps(val, default=str)).encode("utf-8")
            return rtl_transport.Response(True, raw_bytes, rtl_transport.ResponseMode.STRING, "utf-8")
        _emit_bridge_request(req)

def _build_bridge_sdk(use_production: bool = True):
    from looker_sdk.rtl import serialize
    from lkr.extended_sdk_methods import ExtendedLooker40SDK
    bridge_transport = ExtensionBridgeTransport(dev_mode=not bool(use_production))
    settings = types.SimpleNamespace(
        base_url=os.environ.get("LOOKERSDK_BASE_URL") or "https://extension.looker.local",
        agent_tag="lkr-extension-bridge",
        read_config=lambda: {"base_url": "https://extension.looker.local"},
        is_configured=lambda: True,
    )
    auth = types.SimpleNamespace(
        settings=settings,
        transport=bridge_transport,
        authenticate=lambda *a, **kw: {"Authorization": "Bearer extension-bridge"},
    )
    return ExtendedLooker40SDK(auth, serialize.deserialize40, serialize.serialize40, bridge_transport, "4.0")

class ExtensionBridgeAuth:
    def __init__(self, use_production: bool = True):
        self.use_production = bool(use_production)
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc_val, exc_tb):
        pass
    def get_current_instance(self) -> str:
        return "extension-bridge"
    def get_current_sdk(self, **kwargs):
        return _build_bridge_sdk(use_production=self.use_production)
    def list_auth(self):
        return [("extension-bridge", "https://extension.looker.local", True, self.use_production)]

def _patch_auth_service(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_get_auth, orig_init_sdk = getattr(mod, "get_auth", None), getattr(mod, "init_sdk", None)
    if not orig_get_auth or not orig_init_sdk:
        return

    def _patched_get_auth(ctx):
        if not _bridge_enabled():
            return orig_get_auth(ctx)
        lkr_ctx = ctx.obj.get("ctx_lkr") if hasattr(ctx, "obj") and isinstance(getattr(ctx, "obj", None), dict) else ctx
        return ExtensionBridgeAuth(use_production=bool(getattr(lkr_ctx, "use_production", True)))

    def _patched_init_sdk(*args, **kwargs):
        if not _bridge_enabled() or (kwargs.get("base_url") and kwargs.get("client_id") and kwargs.get("client_secret")):
            return orig_init_sdk(*args, **kwargs)
        use_prod = kwargs.get("use_production", args[4] if len(args) > 4 else True)
        return _build_bridge_sdk(use_production=use_prod)

    mod.get_auth, mod.init_sdk, mod._lkr_extension_patched = _patched_get_auth, _patched_init_sdk, True
    if "lkr" in sys.modules:
        setattr(sys.modules["lkr"], "init_sdk", _patched_init_sdk)
    req_transport = getattr(mod, "RequestsTransport", None)
    if req_transport and not getattr(req_transport, "_lkr_extension_patched", False):
        orig_req = req_transport.request
        req_transport.request = lambda self, method, path, query_params=None, body=None, authenticator=None, transport_options=None: (
            ExtensionBridgeTransport(dev_mode=False).request(method, path, query_params=query_params, body=body, authenticator=authenticator, transport_options=transport_options)
            if _bridge_enabled()
            else orig_req(self, method, path, query_params=query_params, body=body, authenticator=authenticator, transport_options=transport_options)
        )
        req_transport._lkr_extension_patched = True

def _patch_codemode(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_sandbox, orig_run_python = getattr(mod, "sandbox", None), getattr(mod, "run_python_code", None)
    if not orig_sandbox or not orig_run_python:
        return

    @functools.wraps(orig_run_python)
    def _patched_run_python_code(code: str, dev_mode: bool = False, allow_update_session: bool = False, **kwargs) -> str:
        if not _bridge_enabled():
            return orig_run_python(code, dev_mode=dev_mode, allow_update_session=allow_update_session)
        ctx_lkr = kwargs.get("ctx_lkr") or getattr(mod, "ctx_lkr", None)
        is_dev = bool(dev_mode) or bool(ctx_lkr is not None and getattr(ctx_lkr, "use_production", True) is False)
        return _handle_codemode(code, {}, is_dev)

    @functools.wraps(orig_sandbox)
    def _patched_sandbox(ctx, code=None, file=None, dev_mode=False, allow_update_session=False, var=None):
        code = code if isinstance(code, str) else None
        file = file if isinstance(file, (str, Path)) else None
        dev_mode = dev_mode if isinstance(dev_mode, bool) else False
        var = var if isinstance(var, (list, tuple)) else None
        if not _bridge_enabled() or (not code and not file) or (code and file):
            return orig_sandbox(ctx=ctx, code=code, file=file, dev_mode=dev_mode, allow_update_session=allow_update_session, var=var)
        code_to_run = Path(file).read_text(encoding="utf-8") if file else str(code or "")
        ctx_lkr = ctx.obj.get("ctx_lkr") if (ctx and isinstance(getattr(ctx, "obj", None), dict)) else None
        is_dev = bool(dev_mode) or bool(ctx_lkr is not None and getattr(ctx_lkr, "use_production", True) is False)
        print(_handle_codemode(code_to_run, _parse_var_list(var), is_dev))

    mod.run_python_code, mod.sandbox, mod._lkr_extension_patched = _patched_run_python_code, _patched_sandbox, True
    for cmd in getattr(getattr(mod, "group", None), "registered_commands", []) or []:
        if getattr(cmd, "name", None) == "sandbox" or getattr(getattr(cmd, "callback", None), "__name__", "") == "sandbox":
            cmd.callback = _patched_sandbox

_PUSH_CODEMODE_PY = """
def _re_perm(e):
    if "PermissionError" in str(e): raise e
try: update_session({"workspace_id": "dev"})
except Exception: pass
try: _cp = bool(create_project)
except Exception: _cp = False
existing_remote = []
new_project = False
if not reset and not _cp:
    try:
        existing_remote = all_project_files(project_id) or []
    except Exception:
        new_project = True
if reset or _cp or new_project:
    existing_projects = {}
    try:
        existing_projects = {pr.get("id"): pr for pr in (all_projects(fields="id,uses_git,git_service_name") or []) if isinstance(pr, dict) and pr.get("id")}
    except Exception:
        existing_projects = {}
    new_project = project_id not in existing_projects
    p = create_project({"name": project_id}) if new_project else existing_projects[project_id]
    if not p.get("uses_git") and p.get("git_service_name") != "bare":
        try: update_project(project_id, {"git_service_name": "bare"})
        except Exception as _e: _re_perm(_e)
    if reset and not new_project:
        try: reset_project_to_production(project_id)
        except Exception as _e:
            _re_perm(_e)
            try: create_developer_copy(project_id)
            except Exception as _e2: _re_perm(_e2)
    if not new_project:
        try:
            existing_remote = all_project_files(project_id) or []
        except Exception:
            existing_remote = []
remote_paths = {(rf.get("path") or rf.get("id") or "") for rf in existing_remote if isinstance(rf, dict)}
created_dirs = set()
for rp in remote_paths:
    cur_rp = ""
    for part in [x for x in rp.split("/")[:-1] if x]:
        cur_rp = f"{cur_rp}/{part}" if cur_rp else part
        created_dirs.add(cur_rp)
pushed_paths = set()
for f in files_to_push:
    fpath = f["path"]
    content = f["content"]
    if fpath in remote_paths:
        if not reset and content.lstrip().startswith("# AUTOGENERATED"):
            pushed_paths.add(fpath)
            continue
        try:
            update_file(project_id, {"path": fpath, "content": content})
            pushed_paths.add(fpath)
            continue
        except Exception as _e: _re_perm(_e)
    dpath = "/".join(fpath.split("/")[:-1])
    if dpath and dpath not in created_dirs:
        cur = ""
        for part in [x for x in dpath.split("/") if x]:
            cur = f"{cur}/{part}" if cur else part
            if cur not in created_dirs:
                try: create_project_directory(project_id, cur)
                except Exception as _e: _re_perm(_e)
                created_dirs.add(cur)
    try: create_file(project_id, {"path": fpath, "content": content})
    except Exception as _e:
        _re_perm(_e)
        update_file(project_id, {"path": fpath, "content": content})
    pushed_paths.add(fpath)
if reset and not single_file:
    for rpath in remote_paths:
        if rpath and rpath not in pushed_paths and not rpath.endswith(".gitkeep") and rpath != "manifest.lkml":
            try: delete_file(project_id, rpath)
            except Exception as _e: _re_perm(_e)
model_files = [f for f in files_to_push if f["root_name"].endswith(".model.lkml") and (reset or f["path"] not in remote_paths)]
if model_files:
    existing_models = {m.get("name"): m for m in (all_lookml_models(fields="name,project_name,allowed_db_connection_names") or []) if isinstance(m, dict) and m.get("name")}
    for mf in model_files:
        mname = mf["root_name"][:-11]
        conn_name = mf.get("connection")
        allowed = [conn_name] if conn_name else []
        if mname not in existing_models:
            try: create_lookml_model({"name": mname, "project_name": project_id, "allowed_db_connection_names": allowed})
            except Exception as _e: _re_perm(_e)
        else:
            cur_allowed = list(existing_models[mname].get("allowed_db_connection_names") or [])
            if conn_name and conn_name not in cur_allowed:
                cur_allowed.append(conn_name)
            try: update_lookml_model(mname, {"name": mname, "project_name": project_id, "allowed_db_connection_names": cur_allowed})
            except Exception as _e: _re_perm(_e)
if deploy:
    try: commit(project_id, {"message": message})
    except Exception as _e: _re_perm(_e)
    try: deploy_to_production(project_id)
    except Exception as _e: _re_perm(_e)
return {"ok": True, "project_id": project_id, "pushed": sorted(pushed_paths)}
""".strip()

_PULL_CODEMODE_PY = """
files_out = {}
try:
    remote_list = all_project_files(project_id) or []
except Exception:
    remote_list = []
for rf in remote_list:
    if not isinstance(rf, dict):
        continue
    rpath = str(rf.get("path") or rf.get("id") or "").lstrip("/")
    if not rpath or rpath.endswith(".gitkeep"):
        continue
    if not sync_hidden and any(part.startswith(".") for part in rpath.split("/")):
        continue
    try:
        files_out[rpath] = get_file_content(project_id, rpath) or ""
    except Exception:
        pass
return {"__lookml_pull__": True, "project_id": project_id, "files": files_out}
""".strip()

def _patch_auth_cli(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_add = getattr(mod, "add_access_token", None)
    if not orig_add:
        return
    @functools.wraps(orig_add)
    def _patched_add_access_token(ctx, *args, **kwargs):
        if not _bridge_enabled():
            return orig_add(ctx, *args, **kwargs)
        print("Authenticated via Looker Extension Bridge.")
    mod.add_access_token, mod._lkr_extension_patched = _patched_add_access_token, True
    for cmd in getattr(getattr(mod, "group", None), "registered_commands", []) or []:
        if getattr(cmd, "name", None) == "add-access-token" or getattr(getattr(cmd, "callback", None), "__name__", "") == "add_access_token":
            cmd.callback = _patched_add_access_token

def _patch_lookml(mod):
    if getattr(mod, "_lkr_extension_patched", False):
        return
    orig_push = getattr(mod, "push", None)
    orig_pull = getattr(mod, "pull", None)
    if not orig_push:
        return

    if orig_pull:
        @functools.wraps(orig_pull)
        def _patched_pull(ctx, folder_name, project_id_opt=None, file_opt=None, deploy=False, message="pull from lkr cli then commit and deploy", sync_hidden=False, **kwargs):
            if not _bridge_enabled():
                return orig_pull(ctx=ctx, folder_name=folder_name, project_id_opt=project_id_opt, file_opt=file_opt, deploy=deploy, message=message, sync_hidden=sync_hidden, **kwargs)
            project_id = mod._resolve_project_id(folder_name, project_id_opt)
            lookml_dir = Path(os.path.abspath(folder_name))
            lookml_dir.mkdir(parents=True, exist_ok=True)
            non_pull_keys = [
                cf.stem for d in _cache_dirs() if d.is_dir() for cf in d.glob("*.json")
                if "__lookml_pull__" not in cf.read_text(encoding="utf-8", errors="ignore")
            ]
            epoch = hashlib.sha256(",".join(sorted(set(non_pull_keys))).encode("utf-8")).hexdigest()[:12]
            req = {"kind": "codemode", "code": _PULL_CODEMODE_PY, "vars": {"epoch": epoch, "project_id": project_id, "sync_hidden": bool(sync_hidden)}, "dev_mode": True}
            req["cache_key"] = _compute_cache_key(req)
            hit, val = _read_cache(req["cache_key"])
            if not hit:
                _emit_bridge_request(req)
            parsed = json.loads(val) if isinstance(val, str) else (val or {})
            files_map = parsed.get("files") if isinstance(parsed, dict) else {}
            if isinstance(files_map, dict):
                target_rel = str(file_opt).lstrip("/") if file_opt else None
                for rpath, content in files_map.items():
                    if target_rel and rpath != target_rel:
                        continue
                    dst = lookml_dir / rpath
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    dst.write_text(str(content), encoding="utf-8")
            elif file_opt and str(file_opt).endswith(".gitkeep"):
                dst = lookml_dir / str(file_opt).lstrip("/")
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.touch()
            return

    @functools.wraps(orig_push)
    def _patched_push(ctx, folder_name, project_id_opt=None, file_opt=None, deploy=False, reset=True, message="push from lkr cli", sync_hidden=False, only_changed=False, create_project=False, **kwargs):
        if not _bridge_enabled():
            return orig_push(ctx=ctx, folder_name=folder_name, project_id_opt=project_id_opt, file_opt=file_opt, deploy=deploy, reset=reset, message=message, sync_hidden=sync_hidden, only_changed=only_changed, **({"create_project": create_project} if "create_project" in orig_push.__code__.co_varnames else {}), **kwargs)
        if file_opt is None and os.path.isfile(folder_name):
            file_opt = folder_name
            folder_name = os.path.dirname(os.path.abspath(folder_name))
        project_id = mod._resolve_project_id(folder_name, project_id_opt)
        lookml_dir = os.path.abspath(folder_name)
        valid_exts = getattr(mod, "VALID_EXTENSIONS", (".lkml", ".lookml", ".md", ".json", ".js", ".css"))
        ignored_files = getattr(mod, "IGNORED_FILES", set())
        files_to_push = []
        def _add_file(full_p, rel_p, fname):
            content = Path(full_p).read_text(encoding="utf-8")
            m = re.search(r'^\\s*connection:\\s*["\\']?([^"\\'\\s;#]+)["\\']?', content, re.MULTILINE) if fname.endswith(".model.lkml") else None
            files_to_push.append({"path": rel_p, "root_name": fname, "content": content, "connection": m.group(1).strip() if m else None})
        if file_opt:
            fp = file_opt if os.path.isabs(file_opt) else os.path.join(lookml_dir, file_opt)
            fp = os.path.abspath(fp)
            _add_file(fp, os.path.relpath(fp, lookml_dir).replace("\\\\", "/"), os.path.basename(fp))
        else:
            for root, dirs, files in os.walk(lookml_dir):
                dirs[:] = [d for d in dirs if (d != ".git" if sync_hidden else not d.startswith("."))]
                for fname in sorted(files):
                    if fname in ignored_files or not any(fname.endswith(ext) for ext in valid_exts):
                        continue
                    fp = os.path.join(root, fname)
                    rel_p = os.path.relpath(fp, lookml_dir).replace("\\\\", "/")
                    if not sync_hidden and any(part.startswith(".") for part in rel_p.split("/")):
                        continue
                    _add_file(fp, rel_p, fname)
        vars_dict = {"project_id": project_id, "files_to_push": files_to_push, "single_file": bool(file_opt), "deploy": bool(deploy), "reset": bool(reset), "message": str(message), **({"create_project": True} if create_project else {})}
        req = {"kind": "codemode", "code": _PUSH_CODEMODE_PY, "vars": dict(sorted(vars_dict.items())), "dev_mode": True}
        req["cache_key"] = _compute_cache_key(req)
        hit, val = _read_cache(req["cache_key"])
        if hit:
            print(val if isinstance(val, str) else json.dumps(val, indent=2, default=str))
            return
        tag = _format_bridge_tag(req)
        sys.stdout.write(tag + "\\n" + json.dumps({"ok": True, "project_id": project_id, "pushed": [f["path"] for f in files_to_push]}) + "\\n")
        sys.stdout.flush()

    mod.push, mod._lkr_extension_patched = _patched_push, True
    if orig_pull:
        mod.pull = _patched_pull
    for cmd in getattr(getattr(mod, "lookml_group", None), "registered_commands", []) or []:
        if getattr(cmd, "name", None) == "push" or getattr(getattr(cmd, "callback", None), "__name__", "") == "push":
            cmd.callback = _patched_push
        elif orig_pull and (getattr(cmd, "name", None) == "pull" or getattr(getattr(cmd, "callback", None), "__name__", "") == "pull"):
            cmd.callback = _patched_pull

def _apply_lkr_patches():
    if mod_auth := sys.modules.get("lkr.auth_service"):
        _patch_auth_service(mod_auth)
        for m in list(sys.modules.values()):
            if getattr(m, "__name__", "").startswith("lkr.") and hasattr(m, "get_auth"):
                setattr(m, "get_auth", mod_auth.get_auth)
    if mod_auth_cli := sys.modules.get("lkr.auth.main"):
        _patch_auth_cli(mod_auth_cli)
    if mod_cm := sys.modules.get("lkr.codemode.main"):
        _patch_codemode(mod_cm)
    if mod_lk := sys.modules.get("lkr.tools.lookml"):
        _patch_lookml(mod_lk)

_orig_import = builtins.__import__
def _bridged_import(name, globals=None, locals=None, fromlist=(), level=0):
    res = _orig_import(name, globals, locals, fromlist, level)
    if name == "lkr" or name.startswith("lkr."):
        _apply_lkr_patches()
    return res

builtins.__import__ = _bridged_import
try:
    import lkr.auth_service  # noqa: F401
    import lkr.auth.main  # noqa: F401
    import lkr.codemode.main  # noqa: F401
    import lkr.tools.lookml  # noqa: F401
    _apply_lkr_patches()
except Exception:
    pass
`

export const LKR_CLI_BRIDGE_TOOL = {
  type: 'function',
  name: 'lkr_cli_extension_bridge',
  description:
    'Execute a bridged online lkr-dev-cli request (<LKR_EXTENSION_TOOL_REQUEST>, either kind="codemode", kind="sdk_request", or kind="file_ref") against the host Looker Extension SDK and return { ok, cache_key, cache_path, replay_needed, result }. When replay_needed is true, write JSON.stringify(result) to cache_path (/workspace/.lkr_extension_cache/<cache_key>.json) and replay; when replay_needed is false, skip cache_path write and CLI replay.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['codemode', 'sdk_request', 'file_ref'], description: 'Bridge request kind emitted by /workspace/sitecustomize.py.' },
      req_path: { type: 'string', description: 'Sandbox file path (/workspace/.lkr_extension_cache/_req_<key>.json) when kind="file_ref".' },
      cache_key: { type: 'string', description: 'Deterministic SHA-256 cache key for /workspace/.lkr_extension_cache/<cache_key>.json.' },
      code: { type: 'string', description: 'Python code to execute in LkrCodeMode when kind="codemode".' },
      vars: { type: 'object', description: 'Injected top-level variables (-v key=value) when kind="codemode".' },
      dev_mode: { type: 'boolean', description: 'Whether to run in Looker development workspace ("dev").' },
      method: { type: 'string', description: 'HTTP method (GET, POST, PATCH, PUT, DELETE) when kind="sdk_request".' },
      path: { type: 'string', description: 'Looker API 4.0 endpoint path (e.g. "/user", "/projects") when kind="sdk_request".' },
      query_params: { type: 'object', description: 'Optional query parameters when kind="sdk_request".' },
      body: { type: 'object', description: 'Optional request body when kind="sdk_request".' },
      thought: { type: 'string', description: 'Concise 1-sentence summary of what this bridged lkr-dev-cli call is doing with the Looker API (falls back to "<method> <path>" when omitted).' },
    },
    required: ['kind'],
  },
}

// ponytail: 25-line dependency-free SHA-256 so Browser/Webpack and Node/Jest compute identical
// cache_key digests to Python's hashlib.sha256 without Node 'crypto' polyfills.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function sha256Hex(input: string): string {
  const bytes = Array.from(new TextEncoder().encode(input))
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while ((bytes.length % 64) !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255)
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Int32Array(64), rotr = (n: number, b: number) => (n >>> b) | (n << (32 - b))
  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      const k = i + j * 4
      w[j] = (bytes[k] << 24) | (bytes[k + 1] << 16) | (bytes[k + 2] << 8) | bytes[k + 3]
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('')
}

function canonicalJson(val: unknown): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return JSON.stringify(val)
  if (Array.isArray(val)) return `[${val.map(canonicalJson).join(',')}]`
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>
    return `{${Object.keys(rec).filter((k) => rec[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`
  }
  return JSON.stringify(String(val))
}

export function cleanQueryParams(qp?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!qp || typeof qp !== 'object') return null
  const entries = Object.entries(qp).filter(([, v]) => v !== undefined && v !== null)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function computeLkrExtensionCacheKey(req: LkrExtensionToolRequest): string {
  if (req.kind === 'sdk_request') {
    return sha256Hex(canonicalJson({
      kind: 'sdk_request', method: String(req.method || 'GET').toUpperCase(), path: normalizeLookerApiPath(req.path),
      query_params: cleanQueryParams(req.query_params), body: req.body !== undefined ? req.body : null, dev_mode: Boolean(req.dev_mode),
    }))
  }
  const rawVars = req.vars && typeof req.vars === 'object' ? req.vars : {}
  const sortedVars = Object.fromEntries(Object.keys(rawVars).sort().map((k) => [k, rawVars[k]]))
  return sha256Hex(canonicalJson({ kind: 'codemode', code: String(req.code || '').trim(), vars: sortedVars, dev_mode: Boolean(req.dev_mode) }))
}

export interface LkrCliBridgeInteractionLike {
  output_text?: string
  outputs?: Array<{ text?: string; result?: string; output?: string; content?: unknown }>
  steps?: Array<{
    output?: string; stdout?: string; stderr?: string; result?: string; text?: string; content?: unknown
    code_execution_result?: { output?: string; stderr?: string; result?: string; content?: unknown }
  }>
}

export function extractLkrExtensionToolRequests(
  interactionOrText: string | LkrCliBridgeInteractionLike | null | undefined
): LkrExtensionToolRequest[] {
  const flattenContent = (val: unknown): Array<string | undefined> =>
    typeof val === 'string' ? [val] : Array.isArray(val) ? val.flatMap((c) => (typeof c === 'string' ? [c] : [(c as { text?: string })?.text])) : []
  const texts: string[] =
    typeof interactionOrText === 'string'
      ? [interactionOrText]
      : [
          interactionOrText?.output_text,
          ...(interactionOrText?.outputs || []).flatMap((o) => [o?.text, o?.result, o?.output, ...flattenContent(o?.content)]),
          ...(interactionOrText?.steps || []).flatMap((s) => [
            s?.output, s?.stdout, s?.stderr, s?.result, s?.text, ...flattenContent(s?.content),
            s?.code_execution_result?.output, s?.code_execution_result?.stderr, s?.code_execution_result?.result, ...flattenContent(s?.code_execution_result?.content),
          ]),
        ].filter((x): x is string => typeof x === 'string')

  const matches = Array.from(texts.join('\n').matchAll(/<LKR_EXTENSION_TOOL_REQUEST>([\s\S]*?)<\/LKR_EXTENSION_TOOL_REQUEST>/g))
  const seen = new Set<string>()
  const out: LkrExtensionToolRequest[] = []
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (!parsed || (parsed.kind !== 'codemode' && parsed.kind !== 'sdk_request' && parsed.kind !== 'file_ref')) continue
      const thoughtProp = typeof parsed.thought === 'string' && parsed.thought.trim() ? { thought: parsed.thought.trim() } : {}
      const normalized: LkrExtensionToolRequest =
        parsed.kind === 'file_ref'
          ? { kind: 'file_ref', req_path: String(parsed.req_path || '').trim(), dev_mode: Boolean(parsed.dev_mode), cache_key: String(parsed.cache_key || '').trim() || computeLkrExtensionCacheKey(parsed), ...thoughtProp }
          : parsed.kind === 'sdk_request'
          ? { kind: 'sdk_request', method: String(parsed.method || 'GET').toUpperCase(), path: normalizeLookerApiPath(parsed.path), query_params: cleanQueryParams(parsed.query_params), body: parsed.body ?? null, dev_mode: Boolean(parsed.dev_mode), cache_key: parsed.cache_key || computeLkrExtensionCacheKey(parsed), ...thoughtProp }
          : { kind: 'codemode', code: String(parsed.code || '').trim(), vars: parsed.vars && typeof parsed.vars === 'object' ? parsed.vars : {}, dev_mode: Boolean(parsed.dev_mode), cache_key: parsed.cache_key || computeLkrExtensionCacheKey(parsed), ...thoughtProp }
      const key = normalized.cache_key!
      if (!seen.has(key)) { seen.add(key); out.push(normalized) }
    } catch { /* ignore */ }
  }
  return out
}

const ROUTE_TRAVERSAL_RE = /(?:^|[\\/]|%(?:25)*(?:2f|5c))(?:\.|%(?:25)*2e){1,2}(?:$|[\\/]|%(?:25)*(?:2f|5c))|\\|%(?:25)*5c|%25(?:25)*(?:2e|2f|5c)/i

export function canonicalizeLookerRoute(rawPath?: string): { path: string; hasTraversal: boolean } {
  const stripped = String(rawPath || '').trim().replace(/^https?:\/\/[^/?#]+/i, '').split(/[?#]/)[0]
  if (!stripped) return { path: '/', hasTraversal: false }
  const hasTraversal = ROUTE_TRAVERSAL_RE.test(stripped)
  if (!hasTraversal) {
    const clean = `/${stripped.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/').replace(/^\/api\/[0-9.]+(?=\/|$)/i, '')
    return { path: clean.startsWith('/') ? clean : clean ? `/${clean}` : '/', hasTraversal: false }
  }
  const resolveUrlPath = (s: string): string => {
    const withLead = `/${s.replace(/^\/+/, '')}`
    try { return new URL(withLead, 'https://looker.local').pathname } catch { return withLead }
  }
  let unescaped = stripped.replace(/\\/g, '/')
  while (/%25(2e|2f|5c|25)/i.test(unescaped)) unescaped = unescaped.replace(/%25(2e|2f|5c|25)/gi, '%$1')
  const pass1 = resolveUrlPath(unescaped.replace(/%(?:2e|5c)/gi, (m) => (m.toLowerCase() === '%2e' ? '.' : '/')))
  const pass2 = resolveUrlPath(pass1.replace(/%2f/gi, '/'))
  const collapsed = pass2.replace(/\/+/g, '/').replace(/^\/api\/[0-9.]+(?=\/|$)/i, '').replace(/\/+$/, '')
  return { path: collapsed ? (collapsed.startsWith('/') ? collapsed : `/${collapsed}`) : '/', hasTraversal: true }
}

export function classifyLookerOperation(
  httpMethod?: string,
  rawPath?: string,
  code?: string
): { operation: string; requiresPermission: boolean } {
  const verb = String(httpMethod || 'GET').toUpperCase()
  const { path: p, hasTraversal } = canonicalizeLookerRoute(rawPath)
  const readOnlyPost =
    verb === 'POST' && !hasTraversal &&
    (/^\/(queries|sql_queries|merge_queries)(\/|$)/.test(p) || /^\/content_validation\/?$/.test(p) ||
      /^\/projects\/[^/]+\/(validate|lookml_tests\/run|git_connection_tests)\/?$/.test(p) || /^\/(?:internal\/)?kda\/analyze\/?$/.test(p))
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS' || readOnlyPost || (verb === 'PATCH' && !hasTraversal && /^\/session\/?$/.test(p))) {
    return { operation: `read_${p.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '_')}`, requiresPermission: false }
  }
  const prefix = verb === 'POST' ? 'create' : verb === 'DELETE' ? 'delete' : 'update'
  if (rawPath && p !== '/') {
    const pm = p.match(/^\/projects\/[^/]+\/(deploy_ref_to_production|deploy_to_production|reset_to_production|reset_to_remote|developer_copy|git\/deploy_key|(?:git\/)?commit|generate_lookml[^/]*|git_branch|files|directories)(\/|$)/)
    if (pm) {
      const projOpMap: Record<string, string> = {
        deploy_ref_to_production: 'deploy_ref_to_production', deploy_to_production: 'deploy_to_production',
        reset_to_production: 'reset_project_to_production', reset_to_remote: 'reset_project_to_remote',
        developer_copy: 'create_developer_copy', 'git/deploy_key': 'create_git_deploy_key',
        commit: 'commit', 'git/commit': 'commit', git_branch: `${prefix}_git_branch`, files: `${prefix}_file`, directories: `${prefix}_project_directory`,
      }
      return { operation: projOpMap[pm[1]] || 'generate_lookml_with_new_files', requiresPermission: true }
    }
    const dm = p.match(/^\/dashboards\/[^/]+\/(import|sync)(\/|$)/)
    if (dm) return { operation: `${dm[1]}_lookml_dashboard`, requiresPermission: true }
    if (/^\/data_app_extension(\/|$)/.test(p)) return { operation: 'publish_data_app_extension', requiresPermission: true }
    if (verb === 'POST' && /^\/alerts\/[^/]+\/enqueue\/?$/.test(p)) return { operation: 'enqueue_alert', requiresPermission: true }
    if (verb === 'POST' && /^\/alerts\/[^/]+\/follow\/?$/.test(p)) return { operation: 'follow_alert', requiresPermission: true }
    if (verb === 'DELETE' && /^\/alerts\/[^/]+\/follow\/?$/.test(p)) return { operation: 'unfollow_alert', requiresPermission: true }
    if (verb === 'PATCH' && /^\/alerts\/[^/]+\/?$/.test(p)) return { operation: 'update_alert_field', requiresPermission: true }
    if (verb === 'POST' && /^\/alert_notifications\/[^/]+\/read\/?$/.test(p)) return { operation: 'read_alert_notification', requiresPermission: true }
    const seg = p.split('/').filter(Boolean)[0] || 'resource'
    return { operation: `${prefix}_${seg.replace(/ies$/, 'y').replace(/([^s])s$/, '$1')}`, requiresPermission: true }
  }
  const callMatches = String(code || '').match(/\b([a-z_][a-z0-9_]*)\s*\(/g) || []
  for (const match of callMatches) {
    const fn = match.replace(/\s*\($/, '')
    if (/^(create|update|delete|deploy|commit|publish|unpublish|repair|enqueue|follow|unfollow|read)_/.test(fn) || fn === 'commit') {
      return { operation: fn, requiresPermission: true }
    }
  }
  return { operation: `${prefix}_resource`, requiresPermission: true }
}
