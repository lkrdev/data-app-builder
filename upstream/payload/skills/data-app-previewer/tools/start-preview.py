#!/usr/bin/env python3
"""Start the local preview server and open a Data App in it.

Idempotent: an already-running server for this workspace is reused rather than
restarted. A server left running from a *different* workspace is reclaimed,
because the port is what the browser is pointed at.

Usage:
  python3 skills/data-app-previewer/tools/start-preview.py
  python3 skills/data-app-previewer/tools/start-preview.py apps/sales/app.js
  python3 skills/data-app-previewer/tools/start-preview.py apps/sales/app.js --no-open

Stdlib only, like every other tool here — no make, no lsof, no curl.
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import signal
import subprocess
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path

DEFAULT_PORT = int(os.environ.get("PORT", 8765))
LANDING_PAGE = "preview-server/"


def find_root(start):
    cur = Path(start).resolve()
    for candidate in [cur, *cur.parents]:
        if (candidate / "preview-server" / "serve.py").is_file() and candidate.name != "dist":
            return candidate
        if (candidate / "dist" / "skills").is_dir() and (
            (candidate / "scripts" / "publish.sh").is_file()
            or (candidate / ".git").is_dir()
        ):
            return candidate
        if candidate.name == "dist" and (candidate / "skills").is_dir() and (
            (candidate.parent / "scripts" / "publish.sh").is_file()
            or (candidate.parent / ".git").is_dir()
        ):
            return candidate.parent

    parents = cur.parents
    if len(parents) > 3 and parents[2].name == "skills":
        if parents[3].name == ".claude" and len(parents) > 4:
            return parents[4]
        if parents[3].name != "dist":
            return parents[3]

    for candidate in [cur, *cur.parents]:
        if (candidate / "data-apps-config.json").exists() or (candidate / "looker-config.json").exists() or (candidate / "VERSION").exists():
            return candidate
    for candidate in [cur, *cur.parents]:
        if (candidate / ".git").exists():
            return candidate
    if len(parents) > 3:
        fallback = parents[3]
        if fallback.name == ".claude" and len(parents) > 4:
            return parents[4]
        return fallback
    return cur


def resolve_app_arg(root: Path, app_arg: str) -> str | None:
    app_arg = app_arg.replace("\\", "/")
    if (root / app_arg).is_file():
        return app_arg
    if (root / app_arg / "app.js").is_file():
        return f"{app_arg.rstrip('/')}/app.js"
    if (root / "apps" / app_arg / "app.js").is_file():
        return f"apps/{app_arg}/app.js"
    if (root / "examples" / app_arg / "app.js").is_file():
        return f"examples/{app_arg}/app.js"
    return None


def probe(port, timeout=1.0):
    conn = None
    try:
        conn = http.client.HTTPConnection("localhost", port, timeout=timeout)
        conn.request(
            "GET",
            "/api/apps",
            headers={"Origin": f"http://localhost:{port}"},
        )
        resp = conn.getresponse()
        if resp.status == 200:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
        return None
    except (http.client.HTTPException, OSError, ValueError, TimeoutError):
        return None
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def read_pid(root):
    try:
        return int((root / ".preview-pid").read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def alive(pid):
    if not pid:
        return False
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes
            kernel32 = ctypes.windll.kernel32
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(0x1000, False, int(pid))
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD()
                if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return exit_code.value == 259
                return False
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def stop_pid(pid):
    sigs = (signal.SIGTERM, signal.SIGKILL) if hasattr(signal, "SIGKILL") else (signal.SIGTERM,)
    for sig in sigs:
        if not alive(pid):
            return True
        try:
            os.kill(pid, sig)
        except OSError:
            return True
        time.sleep(0.3)
    return not alive(pid)


def main(argv=None):
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("app", nargs="?", help="path to the app, e.g. apps/sales/app.js")
    ap.add_argument("--stop", action="store_true", help="stop any running preview server and exit")
    ap.add_argument("--no-open", action="store_true", help="don't launch a browser")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args(argv)

    root = find_root(__file__)

    if args.stop:
        tools_dir = Path(__file__).resolve().parent
        sys.path.insert(0, str(tools_dir))
        stop_argv = ["--port", str(args.port)]
        try:
            import importlib
            stop_mod = importlib.import_module("stop-preview")
            return stop_mod.main(stop_argv)
        except Exception:
            pid = read_pid(root)
            stopped = False
            if pid and alive(pid):
                stopped = stop_pid(pid)
            for f in (root / ".preview-pid", root / ".preview-port"):
                try:
                    f.unlink()
                except OSError:
                    pass
            print("preview server stopped." if stopped else "no active preview server found.")
            return 0
    port = args.port

    if args.app:
        resolved = resolve_app_arg(root, args.app)
        if not resolved:
            sys.exit(f"error: app not found at {root / args.app}")
        args.app = resolved

    running = probe(port)
    pid = None
    if running is not None:
        other = running.get("workspace_dir") or ""
        pid = (read_pid(Path(other)) if other else None) or read_pid(root)
    else:
        pid = read_pid(root)
        if not alive(pid):
            pid = None

    if running is not None or pid:
        if running is not None and running.get("workspace_dir") and Path(running["workspace_dir"]).resolve() != root.resolve():
            print(f"reclaiming port {port} from another workspace ({running['workspace_dir']})...")
        else:
            print(f"stopping previous preview server (PID {pid or 'unknown'})...")
        if pid and not stop_pid(pid):
            sys.exit(
                f"error: port {port} is held by process (PID {pid}) this script can't stop.\n"
                f"       Stop it manually and retry, or pass --port <other>."
            )
        for _ in range(15):
            if probe(port) is None:
                break
            time.sleep(0.2)

    port = int(args.port)
    if not (1 <= port <= 65535):
        sys.exit(f"error: invalid port {port}. Must be between 1 and 65535.")

    serve_rel = "preview-server/serve.py"
    if not (root / serve_rel).is_file():
        if (root / "dist" / "preview-server" / "serve.py").is_file():
            serve_rel = "dist/preview-server/serve.py"
        else:
            sys.exit(f"error: preview server script not found at {root / serve_rel}")

    print(f"starting {serve_rel} on port {port}...")
    log_path = root / ".preview-server.log"
    exe = sys.executable or "python3"
    exe_dir = str(Path(exe).parent)
    child_path = f"{exe_dir}{os.pathsep}{os.environ.get('PATH', '')}" if exe_dir and exe_dir != "." else os.environ.get("PATH", "")
    child_env = {**os.environ, "PATH": child_path, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    is_win_py = Path(exe).name.lower() in ("python.exe", "python")
    with open(log_path, "ab", buffering=0) as log:
        if serve_rel == "dist/preview-server/serve.py":
            if is_win_py:
                proc = subprocess.Popen(
                    ["python", "dist/preview-server/serve.py", "--port", str(port)],
                    executable=exe,
                    cwd=str(root),
                    stdout=log,
                    stderr=log,
                    env=child_env,
                    shell=False,
                    start_new_session=True,
                )
            else:
                proc = subprocess.Popen(
                    ["python3", "dist/preview-server/serve.py", "--port", str(port)],
                    executable=exe,
                    cwd=str(root),
                    stdout=log,
                    stderr=log,
                    env=child_env,
                    shell=False,
                    start_new_session=True,
                )
        else:
            if is_win_py:
                proc = subprocess.Popen(
                    ["python", "preview-server/serve.py", "--port", str(port)],
                    executable=exe,
                    cwd=str(root),
                    stdout=log,
                    stderr=log,
                    env=child_env,
                    shell=False,
                    start_new_session=True,
                )
            else:
                proc = subprocess.Popen(
                    ["python3", "preview-server/serve.py", "--port", str(port)],
                    executable=exe,
                    cwd=str(root),
                    stdout=log,
                    stderr=log,
                    env=child_env,
                    shell=False,
                    start_new_session=True,
                )
    (root / ".preview-pid").write_text(str(proc.pid), encoding="utf-8")
    (root / ".preview-port").write_text(str(port), encoding="utf-8")
    for _ in range(20):
        time.sleep(0.25)
        if probe(port) is not None:
            break
    else:
        sys.exit(f"error: the server did not come up. See {log_path}")

    url = f"http://localhost:{port}/{LANDING_PAGE}"
    if args.app:
        url += "?app=" + urllib.parse.quote(args.app)

    print()
    print("=" * 70)
    if args.app:
        print("  Looker Data App preview ready")
        print(f"  {url}")
        print(f"  sandbox (tile parity): {url}&sandbox=true")
    else:
        print("  Looker Data App gallery ready")
        print(f"  {url}")
    print("=" * 70)
    print()
    print("Stop it with: python3 skills/data-app-previewer/tools/stop-preview.py")

    if not args.no_open:
        webbrowser.open(url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
