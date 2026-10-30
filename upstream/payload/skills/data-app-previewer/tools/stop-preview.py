#!/usr/bin/env python3
"""Stop the local preview server for this workspace.

Usage:
  python3 skills/data-app-previewer/tools/stop-preview.py
  python3 skills/data-app-previewer/tools/stop-preview.py --port 8765

Stdlib only — no make, no lsof, no pgrep.
"""

import argparse
import http.client
import json
import os
import signal
import sys
import time
from pathlib import Path


DEFAULT_PORT = int(os.environ.get("PORT", 8765))
PROC_PATH = Path("/proc")


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


def stop_server(pid=None, roots=None, port=None):
    stopped = False
    if roots is None:
        roots = []
        for r in (find_root(Path.cwd()), find_root(__file__)):
            if r not in roots:
                roots.append(r)
        customer_install = Path.home() / "looker-data-apps"
        if customer_install.is_dir() and customer_install not in roots:
            roots.append(customer_install)
    resolved_roots = [str(r.resolve()) for r in roots]

    pids_to_stop = []
    if pid:
        pids_to_stop.append(pid)

    # 1. Read PID files across roots
    for root in roots:
        pid_file = root / ".preview-pid"
        port_file = root / ".preview-port"
        if port is not None and port_file.exists():
            try:
                recorded_port = int(port_file.read_text(encoding="utf-8").strip())
                if recorded_port != port:
                    continue
            except (OSError, ValueError):
                pass
        try:
            val = int(pid_file.read_text(encoding="utf-8").strip())
            if val not in pids_to_stop:
                pids_to_stop.append(val)
        except (OSError, ValueError):
            pass

    # 2. Probe HTTP port(s) to discover live PID if not recorded or if started manually
    ports_to_check = set()
    if port is not None:
        ports_to_check.add(port)
    else:
        ports_to_check.add(DEFAULT_PORT)
        for root in roots:
            port_file = root / ".preview-port"
            if port_file.exists():
                try:
                    ports_to_check.add(int(port_file.read_text(encoding="utf-8").strip()))
                except (OSError, ValueError):
                    pass

    for p in ports_to_check:
        info = probe(p)
        if isinstance(info, dict) and info.get("pid"):
            ws = info.get("workspace_dir")
            if isinstance(ws, str) and ws.strip():
                try:
                    ws_resolved = str(Path(ws).resolve())
                    if not any(ws_resolved == r or ws_resolved.startswith(r + os.sep) for r in resolved_roots):
                        continue
                except OSError:
                    continue
            try:
                found_pid = int(info["pid"])
                if found_pid not in pids_to_stop:
                    pids_to_stop.append(found_pid)
            except (ValueError, TypeError):
                pass

    # 3. On Linux, scan /proc for running serve.py instances in workspace roots
    try:
        proc_path = PROC_PATH
        if proc_path.is_dir():
            my_pid = os.getpid()
            for proc_dir in proc_path.glob("[0-9]*"):
                try:
                    p_val = int(proc_dir.name)
                    if p_val == my_pid:
                        continue
                    cmdline_raw = (proc_dir / "cmdline").read_bytes()
                    cmdline_parts = cmdline_raw.decode("utf-8", errors="replace").split("\0")
                    cmdline = " ".join(cmdline_parts)
                    if "serve.py" in cmdline and not "stop-preview" in cmdline:
                        try:
                            proc_cwd = os.readlink(str(proc_dir / "cwd"))
                        except OSError:
                            proc_cwd = None
                        is_match = False
                        if proc_cwd and any(proc_cwd == r or proc_cwd.startswith(r + os.sep) for r in resolved_roots):
                            is_match = True
                        if not is_match:
                            for part in cmdline_parts:
                                if "serve.py" in part:
                                    try:
                                        sp = Path(part)
                                        if not sp.is_absolute() and proc_cwd:
                                            sp = Path(proc_cwd) / sp
                                        sp_resolved = str(sp.resolve())
                                        if any(sp_resolved == r or sp_resolved.startswith(r + os.sep) for r in resolved_roots):
                                            is_match = True
                                            break
                                    except Exception:
                                        pass
                        if is_match and port is not None:
                            proc_port = DEFAULT_PORT
                            for idx, arg in enumerate(cmdline_parts):
                                if arg == "--port" and idx + 1 < len(cmdline_parts):
                                    try:
                                        proc_port = int(cmdline_parts[idx + 1])
                                    except ValueError:
                                        pass
                                elif arg.startswith("--port="):
                                    try:
                                        proc_port = int(arg.split("=", 1)[1])
                                    except ValueError:
                                        pass
                            if proc_port != port:
                                is_match = False
                        if is_match and p_val not in pids_to_stop:
                            pids_to_stop.append(p_val)
                except (OSError, PermissionError, ValueError):
                    pass
    except Exception:
        pass

    # 4. Terminate all discovered PIDs
    for p in pids_to_stop:
        if alive(p):
            print(f"stopping preview server (PID {p})...")
            sigs = (signal.SIGTERM, signal.SIGKILL) if hasattr(signal, "SIGKILL") else (signal.SIGTERM,)
            for sig in sigs:
                try:
                    os.kill(p, sig)
                except OSError:
                    break
                time.sleep(0.3)
                if not alive(p):
                    break
            if not alive(p):
                stopped = True

    # 5. Clean up pid and port markers
    for root in roots:
        port_file = root / ".preview-port"
        pid_file = root / ".preview-pid"
        if port is not None:
            if not port_file.exists():
                continue
            try:
                if port_file.read_text(encoding="utf-8").strip() != str(port):
                    continue
            except (OSError, ValueError):
                continue
        for f in (pid_file, port_file):
            try:
                f.unlink()
            except OSError:
                pass

    return stopped


def main(argv=None):
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=None, help="port of preview server to stop")
    args = ap.parse_args(argv)

    roots = []
    for r in (find_root(Path.cwd()), find_root(__file__)):
        if r not in roots:
            roots.append(r)
    customer_install = Path.home() / "looker-data-apps"
    if customer_install.is_dir() and customer_install not in roots:
        roots.append(customer_install)

    stopped = stop_server(roots=roots, port=args.port)
    print("preview server stopped." if stopped else "no active preview server found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
