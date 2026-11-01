import React, { useState } from 'react'
import type { Looker40SDK } from '@looker/sdk'
import {
  getArtifactJson,
  getArtifactNamespace,
  PersistedChatTurn,
  putArtifacts,
  rawLookerRequest,
  searchArtifactsRaw,
} from './lookerApi'
export { getArtifactNamespace } from './lookerApi'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LkrCodeMode = require('./vendor/codemode.js')

export interface LookmlFileChange {
  path: string
  action?: 'created' | 'updated' | 'deleted'
  content?: string
  diff?: string
}

export interface LookmlTestResult {
  test_name: string
  model_name?: string
  file_id?: string
  success: boolean
  errors?: Array<{ message?: string }>
}

export interface LookmlParityQuery {
  query_index?: number
  label?: string
  sql_slug?: string
  sql_runner_url?: string
  explore_slug?: string
  explore_url?: string
  parity_status?: string
  mismatches?: string[]
}

export interface LookmlBundle {
  id: string
  title: string
  project_id: string
  model_name?: string
  branch_name?: string
  files: LookmlFileChange[]
  validation?: {
    passed: boolean
    error_count?: number
    errors?: Array<{ message: string; file_path?: string; line_number?: number; severity?: string }>
  }
  tests?: LookmlTestResult[]
  queries?: LookmlParityQuery[]
  summary_markdown?: string
}

export interface LookmlSessionIndex {
  id: string
  type: 'lookml'
  title: string
  updatedAt: string
  createdBy: string
  targetId: string
  branchName?: string
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
}

export interface LookmlArtifactPayload {
  id: string
  type: 'lookml'
  title: string
  updatedAt: string
  createdBy: string
  bundle: LookmlBundle
  studio?: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
    messages?: PersistedChatTurn[]
  }
}

export const LKR_DEV_CLI_VERSION = '0.0.61'
export const LKR_DEV_CLI_SPEC = `lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION}`
export const BOOTSTRAP_SANDBOX_SH = `command -v uv >/dev/null 2>&1 || pip install --break-system-packages --quiet uv || python3 -m pip install --break-system-packages --quiet uv; lkr --version 2>/dev/null | grep -q "${LKR_DEV_CLI_VERSION}" || UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"`

export interface LkrExtensionToolRequest {
  kind: 'codemode' | 'sdk_request'
  cache_key?: string
  code?: string
  vars?: Record<string, any>
  dev_mode?: boolean
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | string
  path?: string
  query_params?: Record<string, any> | null
  body?: any
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
            raw = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and "result" in raw and (raw.get("__lkr_bridge_envelope__") or set(raw.keys()) <= {"cacheKey", "cache_key", "result", "ok"}):
                return True, raw["result"]
            return True, raw
    return False, None

def _emit_bridge_request(req_dict: dict):
    tag = "<LKR_EXTENSION_TOOL_REQUEST>" + json.dumps(req_dict, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str) + "</LKR_EXTENSION_TOOL_REQUEST>"
    sys.stdout.write(tag + "\\n")
    sys.stdout.flush()
    sys.stderr.write(
        f"[lkr-extension-bridge] Online Looker call routed to host extension (cache_key={req_dict.get('cache_key')}). "
        f"Seed /workspace/.lkr_extension_cache/{req_dict.get('cache_key')}.json and replay.\\n{tag}\\n"
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

def _apply_lkr_patches():
    if mod_auth := sys.modules.get("lkr.auth_service"):
        _patch_auth_service(mod_auth)
    if mod_cm := sys.modules.get("lkr.codemode.main"):
        _patch_codemode(mod_cm)

_orig_import = builtins.__import__
def _bridged_import(name, globals=None, locals=None, fromlist=(), level=0):
    res = _orig_import(name, globals, locals, fromlist, level)
    if name == "lkr" or name.startswith("lkr."):
        _apply_lkr_patches()
    return res

builtins.__import__ = _bridged_import
try:
    import lkr.auth_service  # noqa: F401
    import lkr.codemode.main  # noqa: F401
    _apply_lkr_patches()
except Exception:
    pass
`

export const BOOTSTRAP_LOOKML_PY = `#!/usr/bin/env python3
"""Sandbox helper for Agentic LookML:
1. Bootstraps uv (via pip install --break-system-packages --quiet uv) + lkr-dev-cli[tools,code-mode,parse]==${LKR_DEV_CLI_VERSION} (via UV_TOOL_BIN_DIR=/usr/local/bin uv tool install), installs sitecustomize.py into ~/.local/share/uv/tools/lkr-dev-cli/lib/python3.*/site-packages/, and unpacks lkrdev/cli/skills/ into /workspace.
2. Computes unified diffs between /workspace/lookml_baseline and /workspace/data/$RUN_ID/lookml (or /workspace/lookml).
3. Emits <LOOKML_BUNDLE>{...}</LOOKML_BUNDLE> for the host Looker extension.
"""
import difflib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))
SKILLS_ROOT = WORKSPACE_DIR / ".agents/skills"
SKILLS_ALIAS = WORKSPACE_DIR / "skills"
LOOKML_DIR = Path(os.environ.get("LOOKML_DIR", str(WORKSPACE_DIR / "lookml")))
BASELINE_DIR = Path(os.environ.get("LOOKML_BASELINE_DIR", str(WORKSPACE_DIR / "lookml_baseline")))
CACHE_DIR = WORKSPACE_DIR / ".lkr_extension_cache"
_PINNED_CLI_VERSION = "${LKR_DEV_CLI_VERSION}"
LKR_DEV_CLI_VERSION = os.environ.get(
    "LKR_DEV_CLI_VERSION",
    "0.0.61" if _PINNED_CLI_VERSION.startswith("$") else _PINNED_CLI_VERSION,
)
CLI_TARBALL_URL = os.environ.get(
    "LKR_CLI_TARBALL_URL",
    "https://codeload.github.com/lkrdev/cli/tar.gz/refs/heads/main",
)
REQUIRED_SKILLS = (
    "agentic-lookml-workflow",
    "agentic-lookml",
    "generate-view-from-table",
    "lookml-field-curation",
    "lookml",
    "looker-filters",
    "looker-expressions",
)

def ensure_skills() -> list[str]:
    if not (SKILLS_ROOT / "agentic-lookml/SKILL.md").is_file():
        SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
        local_skills = os.environ.get("LKR_CLI_SKILLS_DIR")
        if local_skills and Path(local_skills).is_dir():
            for s in REQUIRED_SKILLS:
                src = Path(local_skills) / s
                if src.is_dir():
                    shutil.copytree(src, SKILLS_ROOT / s, dirs_exist_ok=True)
        else:
            tar_path = WORKSPACE_DIR / "lkrdev-cli.tar.gz"
            urllib.request.urlretrieve(CLI_TARBALL_URL, tar_path)
            extract_tmp = WORKSPACE_DIR / "_lkr_cli_extract"
            extract_tmp.mkdir(parents=True, exist_ok=True)
            with tarfile.open(tar_path, "r:gz") as tf:
                tf.extractall(extract_tmp)
            for child in extract_tmp.iterdir():
                skills_dir = child / "skills"
                if skills_dir.is_dir():
                    for s in skills_dir.iterdir():
                        if s.is_dir():
                            shutil.copytree(s, SKILLS_ROOT / s.name, dirs_exist_ok=True)
                    break
            shutil.rmtree(extract_tmp, ignore_errors=True)
    if not SKILLS_ALIAS.exists():
        try:
            SKILLS_ALIAS.symlink_to(SKILLS_ROOT)
        except Exception:
            pass
    return [d.name for d in SKILLS_ROOT.iterdir() if d.is_dir()]

def ensure_sitecustomize() -> list[str]:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ws_site = WORKSPACE_DIR / "sitecustomize.py"
    sibling_site = Path(__file__).resolve().parent / "sitecustomize.py"
    if not ws_site.is_file() and sibling_site.is_file() and sibling_site != ws_site:
        shutil.copyfile(sibling_site, ws_site)
    os.environ["PYTHONPATH"] = f"{WORKSPACE_DIR}:{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else str(WORKSPACE_DIR)
    installed = [str(ws_site)] if ws_site.is_file() else []
    uv_tool_lib = Path(os.environ.get("UV_TOOL_DIR", str(Path.home() / ".local/share/uv/tools"))) / "lkr-dev-cli/lib"
    site_targets = list(uv_tool_lib.glob("python3.*/site-packages"))
    if not site_targets:
        fallback_sp = uv_tool_lib / f"python{sys.version_info.major}.{sys.version_info.minor}/site-packages"
        fallback_sp.mkdir(parents=True, exist_ok=True)
        site_targets = [fallback_sp]
    if ws_site.is_file():
        for sp in site_targets:
            dst = sp / "sitecustomize.py"
            if dst.resolve() != ws_site.resolve():
                shutil.copyfile(ws_site, dst)
            installed.append(str(dst))
    return installed

def ensure_lkr_cli() -> str:
    if not shutil.which("uv"):
        for pip_cmd in (["pip"], [sys.executable, "-m", "pip"]):
            subprocess.run([*pip_cmd, "install", "--break-system-packages", "--quiet", "uv"], check=False)
            if shutil.which("uv"):
                break
    pkg_spec = f"lkr-dev-cli[tools,code-mode,parse]=={LKR_DEV_CLI_VERSION}"
    lkr_bin = shutil.which("lkr") or shutil.which("lkr-dev-cli")
    ver_out = subprocess.run([lkr_bin, "--version"], capture_output=True, text=True, check=False).stdout if lkr_bin else ""
    if LKR_DEV_CLI_VERSION not in ver_out:
        cmd = ["uv", "tool", "install", "--force", "--quiet", pkg_spec] if shutil.which("uv") else [sys.executable, "-m", "pip", "install", "--break-system-packages", "--quiet", pkg_spec]
        subprocess.run(cmd, env={**os.environ, "UV_TOOL_BIN_DIR": "/usr/local/bin"}, check=False)
    ensure_sitecustomize()
    return shutil.which("lkr") or shutil.which("lkr-dev-cli") or "lkr"

def compute_diff(old_text: str, new_text: str, rel_path: str) -> str:
    return "".join(
        difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            n=3,
        )
    )

def collect_dir_diffs(lookml_dir: Path, baseline_dir: Path) -> list[dict]:
    cur = (
        {str(p.relative_to(lookml_dir)): p.read_text("utf-8") for p in lookml_dir.rglob("*.lkml") if p.is_file()}
        if lookml_dir.is_dir()
        else {}
    )
    base = (
        {str(p.relative_to(baseline_dir)): p.read_text("utf-8") for p in baseline_dir.rglob("*.lkml") if p.is_file()}
        if baseline_dir.is_dir()
        else {}
    )
    changes = []
    for rel in sorted(set(cur) | set(base)):
        old_t, new_t = base.get(rel, ""), cur.get(rel, "")
        if old_t == new_t and (rel in cur) == (rel in base):
            continue
        action = "created" if rel not in base else ("deleted" if rel not in cur else "updated")
        changes.append({"path": rel, "action": action, "content": new_t, "diff": compute_diff(old_t, new_t, rel)})
    return changes

def normalize_queries(raw_queries: list[dict]) -> list[dict]:
    out = []
    for i, q in enumerate(raw_queries or []):
        if not isinstance(q, dict):
            continue
        sql_slug = str(q.get("sql_slug") or q.get("sql_query_id") or "")
        exp_slug = str(q.get("explore_slug") or q.get("query_slug") or q.get("query_id") or "")
        out.append(
            {
                "query_index": q.get("query_index", i),
                "label": q.get("label") or f"Query #{q.get('query_index', i) + 1}",
                "sql_slug": sql_slug,
                "sql_runner_url": q.get("sql_runner_url") or (f"/sql/{sql_slug}" if sql_slug else ""),
                "explore_slug": exp_slug,
                "explore_url": q.get("explore_url") or (f"/x/{exp_slug}" if exp_slug else ""),
                "parity_status": q.get("parity_status") or ("matched" if q.get("passed") else "checked"),
                "mismatches": q.get("mismatches") or [],
            }
        )
    return out

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if cmd in ("cli", "bootstrap"):
        lkr_bin = ensure_lkr_cli()
        print(json.dumps({"ok": True, "uv": shutil.which("uv") or "uv", "lkr": lkr_bin, "version": LKR_DEV_CLI_VERSION}))
        return

    if cmd == "setup":
        skills = ensure_skills()
        lkr_bin = ensure_lkr_cli()
        site_paths = ensure_sitecustomize()
        LOOKML_DIR.mkdir(parents=True, exist_ok=True)
        BASELINE_DIR.mkdir(parents=True, exist_ok=True)
        print(json.dumps({"ok": True, "uv": shutil.which("uv") or "uv", "lkr": lkr_bin, "version": LKR_DEV_CLI_VERSION, "skills": sorted(skills), "sitecustomize": site_paths}))
        return

    if cmd == "bundle":
        spec_path = Path(sys.argv[2] if len(sys.argv) > 2 else str(WORKSPACE_DIR / "lookml_result.json"))
        run_dir = spec_path if spec_path.is_dir() else None
        raw = (
            json.loads((run_dir / "data.json").read_text("utf-8"))
            if run_dir and (run_dir / "data.json").is_file()
            else json.loads(spec_path.read_text("utf-8"))
            if spec_path.is_file()
            else {}
        )
        if not run_dir and (raw.get("run_id") or raw.get("id")):
            cand = WORKSPACE_DIR / "data" / str(raw.get("run_id") or raw.get("id"))
            if cand.is_dir():
                run_dir = cand
        active_lookml_dir = (run_dir / "lookml") if run_dir and (run_dir / "lookml").is_dir() else LOOKML_DIR
        summary_md = (
            (run_dir / "summary.md").read_text("utf-8")
            if run_dir and (run_dir / "summary.md").is_file()
            else ""
        )
        files = raw.get("files") or collect_dir_diffs(active_lookml_dir, BASELINE_DIR)
        for f in files:
            if not f.get("diff") and f.get("content"):
                old_file = BASELINE_DIR / f["path"]
                old_txt = old_file.read_text("utf-8") if old_file.is_file() else ""
                f["diff"] = compute_diff(old_txt, f["content"], f["path"])

        val_errors = raw.get("validation_errors") or (raw.get("validation") or {}).get("errors") or []
        bundle = {
            "id": str(raw.get("id") or raw.get("run_id") or raw.get("branch_name") or "lookml-session"),
            "title": str(raw.get("title") or f"LookML: {raw.get('project_id', 'Project')}"),
            "project_id": str(raw.get("project_id") or ""),
            "model_name": raw.get("model_name") or "",
            "branch_name": raw.get("branch_name") or "",
            "files": files,
            "validation": raw.get("validation")
            or {
                "passed": len(val_errors) == 0 and raw.get("passed", True) is not False,
                "error_count": len(val_errors),
                "errors": val_errors,
            },
            "tests": raw.get("tests") or [],
            "queries": normalize_queries(raw.get("queries") or []),
            "summary_markdown": raw.get("summary_markdown") or summary_md,
        }
        (WORKSPACE_DIR / "lookml_bundle.json").write_text(json.dumps(bundle), encoding="utf-8")
        print("<LOOKML_BUNDLE>" + json.dumps(bundle) + "</LOOKML_BUNDLE>")
        return

    sys.exit(f"Unknown command: {cmd}. Usage: bootstrap_lookml.py [setup|bundle]")

if __name__ == "__main__":
    main()
`

export const LKR_CLI_BRIDGE_TOOL = {
  type: 'function',
  name: 'lkr_cli_extension_bridge',
  description:
    'Execute a bridged online lkr-dev-cli request (<LKR_EXTENSION_TOOL_REQUEST>, either kind="codemode" or kind="sdk_request") against the host Looker Extension SDK and return { cacheKey, result } for /workspace/.lkr_extension_cache/<cacheKey>.json.',
  parameters: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['codemode', 'sdk_request'],
        description: 'Bridge request kind emitted by /workspace/sitecustomize.py.',
      },
      cache_key: {
        type: 'string',
        description: 'Deterministic SHA-256 cache key for /workspace/.lkr_extension_cache/<cache_key>.json.',
      },
      code: {
        type: 'string',
        description: 'Python code to execute in LkrCodeMode when kind="codemode".',
      },
      vars: {
        type: 'object',
        description: 'Injected top-level variables (-v key=value) when kind="codemode".',
      },
      dev_mode: {
        type: 'boolean',
        description: 'Whether to run in Looker development workspace ("dev").',
      },
      method: {
        type: 'string',
        description: 'HTTP method (GET, POST, PATCH, PUT, DELETE) when kind="sdk_request".',
      },
      path: {
        type: 'string',
        description: 'Looker API 4.0 endpoint path (e.g. "/user", "/projects") when kind="sdk_request".',
      },
      query_params: {
        type: 'object',
        description: 'Optional query parameters when kind="sdk_request".',
      },
      body: {
        type: 'object',
        description: 'Optional request body when kind="sdk_request".',
      },
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
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255)
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255)
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Int32Array(64)
  const rotr = (n: number, b: number) => (n >>> b) | (n << (32 - b))
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
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('')
}

function canonicalJson(val: any): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return JSON.stringify(val)
  if (Array.isArray(val)) return `[${val.map(canonicalJson).join(',')}]`
  if (typeof val === 'object') {
    const keys = Object.keys(val).filter((k) => val[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(val[k])}`).join(',')}}`
  }
  return JSON.stringify(String(val))
}

function normalizeLookerBridgePath(rawPath?: string): string {
  const p = String(rawPath || '/')
    .trim()
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/api\/4\.0(?=\/|$)/, '')
  return p.startsWith('/') ? p : `/${p}`
}

function cleanQueryParams(qp?: Record<string, any> | null): Record<string, any> | null {
  if (!qp || typeof qp !== 'object') return null
  const entries = Object.entries(qp).filter(([, v]) => v !== undefined && v !== null)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function computeLkrExtensionCacheKey(req: LkrExtensionToolRequest): string {
  if (req.kind === 'sdk_request') {
    return sha256Hex(
      canonicalJson({
        kind: 'sdk_request',
        method: String(req.method || 'GET').toUpperCase(),
        path: normalizeLookerBridgePath(req.path),
        query_params: cleanQueryParams(req.query_params),
        body: req.body !== undefined ? req.body : null,
        dev_mode: Boolean(req.dev_mode),
      })
    )
  }
  const rawVars = req.vars && typeof req.vars === 'object' ? req.vars : {}
  const sortedVars = Object.fromEntries(Object.keys(rawVars).sort().map((k) => [k, rawVars[k]]))
  return sha256Hex(
    canonicalJson({
      kind: 'codemode',
      code: String(req.code || '').trim(),
      vars: sortedVars,
      dev_mode: Boolean(req.dev_mode),
    })
  )
}

export function extractLkrExtensionToolRequests(interactionOrText: any): LkrExtensionToolRequest[] {
  const texts: string[] =
    typeof interactionOrText === 'string'
      ? [interactionOrText]
      : [
          interactionOrText?.output_text,
          ...(interactionOrText?.outputs || []).map((o: any) => o?.text),
          ...(interactionOrText?.steps || []).flatMap((s: any) => [
            s?.output,
            s?.stdout,
            s?.stderr,
            s?.result,
            s?.text,
            s?.code_execution_result?.output,
            s?.code_execution_result?.stderr,
          ]),
        ].filter((x): x is string => typeof x === 'string')

  const combined = texts.join('\n')
  const matches = Array.from(
    combined.matchAll(/<LKR_EXTENSION_TOOL_REQUEST>([\s\S]*?)<\/LKR_EXTENSION_TOOL_REQUEST>/g)
  )
  const seen = new Set<string>()
  const out: LkrExtensionToolRequest[] = []
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (!parsed || (parsed.kind !== 'codemode' && parsed.kind !== 'sdk_request')) continue
      const normalized: LkrExtensionToolRequest =
        parsed.kind === 'sdk_request'
          ? {
              kind: 'sdk_request',
              method: String(parsed.method || 'GET').toUpperCase(),
              path: normalizeLookerBridgePath(parsed.path),
              query_params: cleanQueryParams(parsed.query_params),
              body: parsed.body ?? null,
              dev_mode: Boolean(parsed.dev_mode),
              cache_key: parsed.cache_key || computeLkrExtensionCacheKey(parsed),
            }
          : {
              kind: 'codemode',
              code: String(parsed.code || '').trim(),
              vars: parsed.vars && typeof parsed.vars === 'object' ? parsed.vars : {},
              dev_mode: Boolean(parsed.dev_mode),
              cache_key: parsed.cache_key || computeLkrExtensionCacheKey(parsed),
            }
      const key = normalized.cache_key!
      if (!seen.has(key)) {
        seen.add(key)
        out.push(normalized)
      }
    } catch {
      // Ignore malformed tag JSON
    }
  }
  return out
}

export async function executeLkrExtensionToolRequest(params: {
  sdk: Looker40SDK
  req: LkrExtensionToolRequest
  defaultVars?: Record<string, any>
  extensionSDK?: any
  requirePermission?: boolean
  approvedOperations?: Set<string>
  onPermissionRequest?: (req: any) => Promise<any>
}): Promise<{ cacheKey: string; result: any }> {
  const { sdk, req, defaultVars, extensionSDK, requirePermission, approvedOperations, onPermissionRequest } = params
  const cacheKey = req.cache_key || computeLkrExtensionCacheKey(req)
  const cleanPath = req.kind === 'sdk_request' ? normalizeLookerBridgePath(req.path) : ''

  if (req.dev_mode && cleanPath !== '/session') {
    try {
      if (typeof (sdk as any)?.update_session === 'function') {
        const p = (sdk as any).update_session({ workspace_id: 'dev' })
        await (typeof (sdk as any).ok === 'function' ? sdk.ok(p) : p)
      } else if (req.kind === 'sdk_request' && (sdk as any)?.authSession?.transport?.rawRequest) {
        await rawLookerRequest(sdk, 'PATCH', '/session', undefined, { workspace_id: 'dev' })
      }
    } catch {}
  }

  if (req.kind === 'sdk_request') {
    const method = String(req.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    const result = await rawLookerRequest(
      sdk,
      method,
      cleanPath,
      cleanQueryParams(req.query_params) || undefined,
      req.body !== null && req.body !== undefined ? req.body : undefined
    )
    return { cacheKey, result }
  }

  const rawOut = await LkrCodeMode.runPythonCode({
    code: String(req.code || ''),
    sdk,
    vars: { ...(defaultVars || {}), ...(req.vars || {}) },
    allowUpdateSession: Boolean(req.dev_mode),
    extensionSDK,
    requirePermission,
    approvedOperations,
    onPermissionRequest,
  })
  let result: any = rawOut
  if (typeof rawOut === 'string') {
    const trimmed = rawOut.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        result = JSON.parse(trimmed)
      } catch {
        result = rawOut
      }
    }
  }
  return { cacheKey, result }
}

export function extractLookmlBundleFromInteraction(interaction: any): LookmlBundle | null {
  const texts = [
    interaction?.output_text,
    ...(interaction?.outputs || []).map((o: any) => o?.text),
    ...(interaction?.steps || []).flatMap((s: any) => [s?.output, s?.result, s?.text]),
  ].filter((x): x is string => typeof x === 'string')
  const matches = Array.from(texts.join('\n').matchAll(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/g))
  return matches.length ? (JSON.parse(matches[matches.length - 1][1].trim()) as LookmlBundle) : null
}

export const LOOKML_TURN_SKILLS = [
  {
    id: 'lookml-field-curation',
    label: '📝 Descriptions & Curation',
    desc: 'Profile string fields, curate descriptions, group_label & hidden flags',
  },
  {
    id: 'lookml-tests',
    label: '🧪 Data Tests (.test.lkml)',
    desc: 'Author & run assert-based LookML data tests via run_lookml_test',
  },
  {
    id: 'lookml-snapshot',
    label: '📸 Snapshot & Parity',
    desc: 'Capture lkr parse lookml snapshot & verify SQL-to-Explore parity',
  },
  {
    id: 'generate-view-from-table',
    label: '🧱 Bronze View',
    desc: 'Scaffold or refresh Bronze base views from table metadata',
  },
  {
    id: 'agentic-lookml-workflow',
    label: '🔄 SQL Workflow',
    desc: 'Full SQL-to-LookML Bronze refinement + Silver/Gold layer workflow',
  },
] as const

export function buildLookmlSystemGuide(params: {
  selectedExplores: string[]
  primaryModel: string
  primaryExplore: string
  projectId?: string
  activatedSkills?: string[]
  developableProjects?: string[]
  canDeploy?: boolean
}): string {
  const {
    selectedExplores,
    primaryModel,
    primaryExplore,
    projectId,
    activatedSkills,
    developableProjects,
    canDeploy = true,
  } = params
  const activeSkillList =
    activatedSkills && activatedSkills.length > 0
      ? activatedSkills
      : ['lookml-field-curation', 'lookml-tests', 'lookml-snapshot']
  const devProjectsHint =
    developableProjects && developableProjects.length > 0
      ? `Developable LookML projects (via Model -> Project expansion): ${developableProjects.join(', ')}.`
      : ''
  const deployHint = canDeploy
    ? 'User holds `deploy` permission (`deploy_to_production` allowed only when explicitly requested).'
    : 'User does NOT hold `deploy` permission — do NOT call `deploy_to_production`.'
  const projHint = projectId?.trim()
    ? `Target LookML project_id: "${projectId.trim()}". ${devProjectsHint} ${deployHint}`.trim()
    : primaryModel
    ? `Resolve the LookML project_id from model "${primaryModel}" via \`lookml_model("${primaryModel}")["project_name"]\` or \`all_projects()\`. ${devProjectsHint} ${deployHint}`.trim()
    : `Discover the target LookML project_id via \`all_projects(fields="id,name,git_remote_url")\` or \`lookml_model(model_name)\`. ${devProjectsHint} ${deployHint}`.trim()

  return [
    `You are the **Agentic LookML** engineer powered by \`lkrdev/cli\` and the \`agentic-lookml\` skill suite.`,
    projHint,
    `Activated Turn Skills: ${activeSkillList.map((s) => `\`${s}\``).join(', ')}. Prioritize reading and executing the instructions for these activated skills on this turn.`,
    selectedExplores.length > 0
      ? `Selected Explore context: ${selectedExplores.join(', ')} (primary: ${primaryModel}::${primaryExplore}).`
      : `See /workspace/schema.md for available models and explores.`,
    `Follow these exact steps:`,
    `1. **Sandbox Bootstrap (\`/workspace\`)**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py setup\` in your Linux sandbox to install \`uv\` (\`pip install --break-system-packages --quiet uv\`), \`${LKR_DEV_CLI_SPEC}\` (\`UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force --quiet "${LKR_DEV_CLI_SPEC}"\`), and unpack \`/workspace/.agents/skills/\` (\`agentic-lookml-workflow\`, \`agentic-lookml\`, \`generate-view-from-table\`, \`lookml-field-curation\`, \`lookml\`). Read the SKILL.md files for your Activated Turn Skills (${activeSkillList.join(', ')}).`,
    `2. **Host-Bridged LookML Sync via Browser WASM \`run_looker_codemode(code, vars)\` (\`allowUpdateSession: true\`)**:`,
    `   - Zero sandbox Looker credentials are needed: \`run_looker_codemode\` runs in the browser extension with \`allowUpdateSession: true\`, accepts \`vars: {...}\`, and has all \`ExtendedLooker40SDK\` methods pre-bound.`,
    `   - Switch to the user's dev workspace (\`update_session({"workspace_id": "dev"})\`) and use whatever branch/state is already in the user's dev mode (inspect via \`git_branch(project_id)\` — do NOT reset to production or create a new git branch unless explicitly asked). Pull LookML files via \`all_project_files\` + \`get_file_content\` into \`/workspace/lookml_baseline/\` and \`/workspace/data/$RUN_ID/lookml/\`.`,
    `3. **100% Offline \`lkr-dev-cli[parse]\` CLI Commands in \`/workspace\`**:`,
    `   - Run offline CLI commands against \`/workspace/data/$RUN_ID/lookml\`: \`lkr parse sql --dialect bigquery --summary\`, \`lkr parse sql-lookml-compare --offline\`, \`lkr parse lookml-to-api --validate\`, \`lkr schema validate --explore-file\`, and \`lkr parse lookml snapshot\` & \`lkr parse curation-meta\`.`,
    `   - Author Bronze refinements, Silver/Gold views & explores, opinionated \`.test.lkml\` tests, and \`/workspace/data/$RUN_ID/summary.md\` according to the Activated Turn Skills (${activeSkillList.join(', ')}).`,
    `4. **Push Modified \`.lkml\` Files, Pre-Gate Parity & Validate via \`run_looker_codemode\`**:`,
    `   - Push changed/deleted \`.lkml\` files back to the user's current dev workspace using \`create_project_directory\`, \`create_file\`, \`update_file\`, \`delete_file\`, then run \`validate_project\` and \`run_lookml_test\`.`,
    `5. **Emit \`<LOOKML_BUNDLE>\`**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py bundle /workspace/data/$RUN_ID\` (or \`/workspace/lookml_result.json\`) and include the printed \`<LOOKML_BUNDLE>...</LOOKML_BUNDLE>\` tag in your final response.`,
  ].join('\n')
}

export function getLookmlArtifactKeys(userId: string, id: string) {
  const cleanUser = String(userId || 'anon').trim()
  const cleanId = String(id || 'default').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    id: cleanId,
    userKey: `user_${cleanUser}_lookml_${cleanId}`,
    objKey: `obj_lookml_${cleanId}`,
  }
}

// ponytail: persist two-tier Looker Artifacts (`user_${userId}_lookml_${id}` compact index + `obj_lookml_${id}` full payload)
// via shared putArtifacts so LookML sessions are searchable per user and shareable by URL.
export async function saveLookmlSessionArtifact(params: {
  sdk: Looker40SDK
  extensionSDK?: any
  userId: string
  bundle: LookmlBundle
  studio: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
    messages?: PersistedChatTurn[]
  }
}) {
  const { sdk, extensionSDK, userId, bundle, studio } = params
  const namespace = getArtifactNamespace(extensionSDK)
  const rawId =
    bundle.id ||
    bundle.branch_name ||
    `${bundle.project_id || 'lookml'}_${Date.now().toString(36)}`
  const { id, userKey, objKey } = getLookmlArtifactKeys(userId, rawId)
  const updatedAt = new Date().toISOString()

  const index: LookmlSessionIndex = {
    id,
    type: 'lookml',
    title: bundle.title || `LookML (${bundle.project_id || id})`,
    updatedAt,
    createdBy: String(userId),
    targetId: bundle.project_id || '',
    branchName: bundle.branch_name,
    explores: studio.explores || [],
    lastInteractionId: studio.lastInteractionId,
    environmentId: studio.environmentId,
  }

  const payload: LookmlArtifactPayload = {
    id,
    type: 'lookml',
    title: index.title,
    updatedAt,
    createdBy: String(userId),
    bundle: { ...bundle, id },
    studio: {
      explores: studio.explores || [],
      lastInteractionId: studio.lastInteractionId,
      environmentId: studio.environmentId,
      messages: (studio.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-200),
    },
  }

  await putArtifacts(
    sdk,
    [
      { key: userKey, value: index },
      { key: objKey, value: payload },
    ],
    namespace
  )
  return { id, userKey, objKey, index, payload }
}

export async function loadLookmlSessionArtifact(
  sdk: Looker40SDK,
  extensionSDK: any,
  rawId: string
): Promise<LookmlArtifactPayload> {
  const namespace = getArtifactNamespace(extensionSDK)
  const objKey = `obj_lookml_${rawId.trim().replace(/^obj_lookml_/, '')}`
  const found = await getArtifactJson<LookmlArtifactPayload>(sdk, objKey, namespace)
  if (!found) throw new Error(`LookML session artifact "${objKey}" not found.`)
  return found
}

export async function listUserLookmlSessions(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string
): Promise<LookmlSessionIndex[]> {
  try {
    const res = await searchArtifactsRaw(
      sdk,
      getArtifactNamespace(extensionSDK),
      `user_${String(userId || 'anon').trim()}_lookml_%`
    )
    return res
      .map((item) => {
        try {
          return typeof item?.value === 'string' ? JSON.parse(item.value) : item?.value
        } catch {
          return null
        }
      })
      .filter((x): x is LookmlSessionIndex => Boolean(x && x.id && x.type === 'lookml'))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  } catch {
    return []
  }
}

export const LookmlPreviewPane: React.FC<{
  bundle: LookmlBundle | null
  hostUrl: string
  extensionSDK?: any
  canDeploy?: boolean
}> = ({ bundle, hostUrl, extensionSDK, canDeploy = true }) => {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
  const [viewMode, setViewMode] = useState<'diff' | 'content'>('diff')

  if (!bundle) {
    return (
      <div className="dab-placeholder">
        <p>
          <strong>Agentic LookML Workspace</strong>
        </p>
        <p className="dab-muted" style={{ maxWidth: 480, textAlign: 'center' }}>
          Enter a SQL query, metric definition, or LookML task on the left. Antigravity will
          switch to your Looker <code>dev</code> workspace via <code>LkrCodeMode</code>,
          run offline <code>lkr parse</code> &amp; <code>lkr schema validate</code>, push
          modified <code>.lkml</code> files, and render diffs, LookML Validator /{' '}
          <code>run_lookml_test</code> status, and clickable <code>/sql/:slug</code> +{' '}
          <code>/x/:slug</code> parity links here.
        </p>
      </div>
    )
  }

  const files = bundle.files || []
  const activeFile = files[selectedFileIdx] || files[0] || null
  const valPassed = bundle.validation ? bundle.validation.passed : true
  const valErrors = bundle.validation?.errors || []
  const tests = bundle.tests || []
  const passedTests = tests.filter((t) => t.success).length
  const queries = bundle.queries || []
  const cleanHost = hostUrl.replace(/\/$/, '')
  const cardStyle: React.CSSProperties = {
    background: '#fff',
    padding: 12,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
  }

  const openLink = (pathOrUrl: string) => {
    const target = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${cleanHost}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
    if (extensionSDK?.openBrowserWindow) extensionSDK.openBrowserWindow(target, '_blank')
    else window.open(target, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: 16, gap: 12 }}>
      <div className="dab-controls" style={cardStyle}>
        <div>
          <strong>Project:</strong> <code>{bundle.project_id || 'default'}</code>
        </div>
        {bundle.model_name && (
          <div>
            <strong>Model:</strong> <code>{bundle.model_name}</code>
          </div>
        )}
        <span className="dab-badge" title="Uses whatever branch is active in the user's Looker Dev Mode">
          ⎇ {bundle.branch_name || 'user dev mode'}
        </span>
        <span className="dab-msg-pill" style={valPassed ? undefined : { background: '#fee2e2', color: '#991b1b' }}>
          {valPassed
            ? '✓ LookML Validator Passed'
            : `✗ LookML Validator (${valErrors.length} error${valErrors.length === 1 ? '' : 's'})`}
        </span>
        {tests.length > 0 && (
          <span
            className="dab-msg-pill"
            style={passedTests === tests.length ? undefined : { background: '#fee2e2', color: '#991b1b' }}
          >
            {passedTests === tests.length ? '✓' : '✗'} run_lookml_test ({passedTests}/{tests.length} passed)
          </span>
        )}
        {!canDeploy && (
          <span
            className="dab-badge"
            style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}
            title="Requires Looker 'deploy' or 'admin' permission to run deploy_to_production"
          >
            🔒 deploy_to_production disabled (missing deploy)
          </span>
        )}
      </div>

      {queries.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            SQL-to-LookML Parity Queries (<code>/sql/:slug</code> &amp; <code>/x/:slug</code>)
          </div>
          {queries.map((q, i) => {
            const sqlPath = q.sql_runner_url || (q.sql_slug ? `/sql/${q.sql_slug}` : '')
            const explorePath = q.explore_url || (q.explore_slug ? `/x/${q.explore_slug}` : '')
            return (
              <div key={i} className="dab-inspector-bar" style={{ padding: '4px 0' }}>
                <div className="dab-controls">
                  <strong>{q.label || `Query #${(q.query_index ?? i) + 1}`}</strong>
                  {q.parity_status && <span className="dab-msg-pill">{q.parity_status}</span>}
                </div>
                <div className="dab-controls">
                  {sqlPath && (
                    <button type="button" className="dab-btn-secondary" onClick={() => openLink(sqlPath)}>
                      <code>{q.sql_slug ? `/sql/${q.sql_slug}` : 'SQL Runner'}</code> ↗
                    </button>
                  )}
                  {explorePath && (
                    <button type="button" className="dab-btn-secondary" onClick={() => openLink(explorePath)}>
                      <code>{q.explore_slug ? `/x/${q.explore_slug}` : 'Explore'}</code> ↗
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(valErrors.length > 0 || tests.length > 0) && (
        <div style={cardStyle}>
          {valErrors.map((e, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, color: '#991b1b' }}>
              {e.file_path ? `${e.file_path}${e.line_number ? `:${e.line_number}` : ''} — ` : ''}
              {e.message}
            </div>
          ))}
          {tests.length > 0 && (
            <div className="dab-controls" style={{ marginTop: valErrors.length ? 6 : 0 }}>
              {tests.map((t, i) => (
                <span
                  key={i}
                  className="dab-msg-pill"
                  style={t.success ? undefined : { background: '#fee2e2', color: '#991b1b' }}
                >
                  {t.success ? '✓' : '✗'} {t.test_name}
                  {t.file_id ? ` (${t.file_id})` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ ...cardStyle, padding: 0, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 240, overflow: 'hidden' }}>
        <div className="dab-inspector-bar" style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div className="dab-controls">
            {files.length === 0 ? (
              <span className="dab-muted">No modified .lkml files recorded</span>
            ) : (
              files.map((f, idx) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedFileIdx(idx)}
                  className={idx === selectedFileIdx ? 'dab-btn-primary' : 'dab-btn-secondary'}
                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                >
                  {f.action === 'created' ? '+ ' : f.action === 'deleted' ? '- ' : 'Δ '}
                  {f.path}
                </button>
              ))
            )}
          </div>
          {activeFile && (
            <div className="dab-controls">
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() => setViewMode((m) => (m === 'diff' ? 'content' : 'diff'))}
              >
                {viewMode === 'diff' ? 'Show Full .lkml' : 'Show Unified Diff'}
              </button>
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() => navigator.clipboard?.writeText(activeFile.content || activeFile.diff || '')}
              >
                Copy .lkml
              </button>
            </div>
          )}
        </div>
        <pre style={{ margin: 0, padding: 12, flex: 1, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', fontSize: 12 }}>
          {activeFile
            ? (viewMode === 'diff' && activeFile.diff ? activeFile.diff : activeFile.content || activeFile.diff || '')
                .split('\n')
                .map((line, i) => {
                  const isAdd = viewMode === 'diff' && line.startsWith('+') && !line.startsWith('+++')
                  const isDel = viewMode === 'diff' && line.startsWith('-') && !line.startsWith('---')
                  return (
                    <div
                      key={i}
                      style={{
                        color: isAdd ? '#4ade80' : isDel ? '#f87171' : line.startsWith('@@') ? '#38bdf8' : '#e2e8f0',
                      }}
                    >
                      {line}
                    </div>
                  )
                })
            : 'No .lkml file selected.'}
        </pre>
      </div>

      {bundle.summary_markdown && (
        <details open style={cardStyle}>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>
            Agentic LookML Diagnostic Summary (<code>summary.md</code>)
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '8px 0 0' }}>
            {bundle.summary_markdown}
          </pre>
        </details>
      )}
    </div>
  )
}
