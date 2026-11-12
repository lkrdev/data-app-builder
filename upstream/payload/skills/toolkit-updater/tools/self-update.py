#!/usr/bin/env python3
"""In-place self-updater for Looker Data Apps toolkit.

Protocol:
  1. Stage a temporary rollback copy under backups/
  2. Download the target version's installer (install.py, or fallback to install.sh)
  3. Execute installer non-interactively (DATA_APPS_SKIP_VERIFY=1)
  4. Validate target VERSION and runtime; on failure, roll back from the temporary copy; on success, remove the temporary copy

Re-pinning the runtime URL is not done here. The installer bakes in the
directory it was published from and bootstrap reconciles the config
against it, so the pin follows the payload rather than being recomputed by
two scripts that can disagree.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Ensure standard UTF-8 stream encoding across platforms (Windows cmd.exe / POSIX)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

# Flush progress lines immediately when piped
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

SCRIPT_DIR = Path(__file__).resolve().parent

# Ensure sibling tools (version_utils.py) can be imported
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from version_utils import compare, CANONICAL_TOOLKIT_URL, normalize_toolkit_url

CANONICAL_SHARED_BASE = CANONICAL_TOOLKIT_URL


def _http_opener() -> urllib.request.OpenerDirector:
    """Opener restricted to HTTP(S) protocol."""
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.HTTPHandler(),
        urllib.request.HTTPSHandler(),
        urllib.request.HTTPRedirectHandler(),
        urllib.request.HTTPErrorProcessor(),
        urllib.request.HTTPDefaultErrorHandler(),
    ):
        opener.add_handler(handler)
    return opener


def _is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.windll.kernel32
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [
                wintypes.HANDLE,
                ctypes.POINTER(wintypes.DWORD),
            ]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            # Win32 process query rights and active process status code
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD()
                if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return exit_code.value == STILL_ACTIVE
                return False
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        # Process exists but is owned by another user or lacks permission to signal
        return True
    except (OSError, ProcessLookupError):
        return False


def _file_url_to_path(url: str) -> Path:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc and parsed.netloc != "localhost":
        raw = f"//{parsed.netloc}{parsed.path}"
        if len(parsed.netloc) == 2 and parsed.netloc[1] == ":":
            raw = f"{parsed.netloc}{parsed.path}"
    else:
        raw = parsed.path
    return Path(urllib.request.url2pathname(raw))


def _read_install_cfg(install_dir: Path) -> dict:
    candidates = [
        install_dir / "data-apps-config.json",
        install_dir / "looker-config.json",
        install_dir / "canvas-config.json",
    ]
    for p in candidates:
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8-sig"))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
    return {}


def _resolve_shared_base(cfg: dict) -> str:
    env_shared_base = os.environ.get("DATA_APPS_SHARED_BASE")
    env_base_url = (
        os.environ.get("DATA_APPS_BASE_URL")
        or os.environ.get("CANVAS_BASE_URL")
        or ""
    ).strip().rstrip("/")
    if env_shared_base and env_shared_base.strip():
        return env_shared_base.strip().rstrip("/")
    if env_base_url:
        return re.sub(r"/versions/[^/]+$", "", env_base_url).rstrip("/")
    raw_base = cfg.get("toolkit_url") or cfg.get("shared_base_url")
    if not raw_base:
        ver_url = (
            os.environ.get("DATA_APPS_VERSION_URL")
            or (cfg.get("version_url") if isinstance(cfg.get("version_url"), str) else "")
        ).strip()
        if ver_url.endswith("/latest-version.txt"):
            raw_base = ver_url[: -len("/latest-version.txt")]
    return normalize_toolkit_url(raw_base, CANONICAL_SHARED_BASE)


def _resolve_post_hop_shared_base(install_dir: Path) -> str:
    post_cfg = _read_install_cfg(install_dir)
    tools_dir = install_dir / "skills" / "toolkit-updater" / "tools"
    ver_utils_path = tools_dir / "version_utils.py"
    if ver_utils_path.is_file():
        try:
            spec = importlib.util.spec_from_file_location(
                "_post_hop_version_utils", ver_utils_path
            )
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                norm_fn = getattr(mod, "normalize_toolkit_url", None)
                canon_url = getattr(mod, "CANONICAL_TOOLKIT_URL", None)
                if callable(norm_fn) and isinstance(canon_url, str) and canon_url:
                    raw_base = post_cfg.get("toolkit_url") or post_cfg.get("shared_base_url")
                    return str(norm_fn(raw_base, canon_url)).rstrip("/")
        except (Exception, SystemExit):
            pass
    for cand_file, attr_re in (
        (tools_dir / "version_utils.py", r'^CANONICAL_TOOLKIT_URL\s*=\s*"([^"]+)"'),
        (tools_dir / "self-update.sh", r'^CANONICAL_SHARED_BASE="([^"]+)"'),
    ):
        if cand_file.is_file():
            try:
                m = re.search(attr_re, cand_file.read_text(encoding="utf-8"), re.M)
                if m:
                    raw_base = post_cfg.get("toolkit_url") or post_cfg.get("shared_base_url")
                    return normalize_toolkit_url(raw_base, m.group(1))
            except Exception:
                pass
    return _resolve_shared_base(post_cfg)


def _fetch_live_pointer(shared_base_url: str, pointer_url_override: str | None = None) -> str | None:
    pointer_url = (
        pointer_url_override.strip()
        if pointer_url_override and pointer_url_override.strip()
        else f"{str(shared_base_url).rstrip('/')}/latest-version.txt"
    )
    try:
        if pointer_url.startswith("file://"):
            p_path = _file_url_to_path(pointer_url)
            if p_path.is_file():
                raw = p_path.read_text(encoding="utf-8")
            else:
                return None
        else:
            req = urllib.request.Request(
                pointer_url, headers={"User-Agent": "data-apps-updater"}
            )
            with _http_opener().open(req, timeout=10) as resp:
                raw = resp.read(4096).decode("utf-8", errors="replace")
        for line in raw.splitlines():
            cand = line.strip().lstrip("v")
            if cand and re.match(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$", cand):
                return cand
    except Exception:
        pass
    return None


def short_path(p: Path | str) -> str:
    p_str = str(p)
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    if home:
        if p_str == home:
            return "~"
        if p_str.startswith(home + "/") or p_str.startswith(home + "\\"):
            return "~/" + p_str[len(home) + 1 :].replace("\\", "/")
    return p_str.replace("\\", "/")


def print_usage():
    print(
        """Usage: self-update.py [--root <install_dir>] [--target <version>]

Performs a safe, in-place upgrade of the Looker Data Apps toolkit with
pre-upgrade snapshot backup and automatic rollback on failure.

Options:
  --root, --install-root <dir>        Target installation directory (default: parent directory of toolkit)
  --target, --target-version <version> Target version to upgrade to (default: latest version from remote release pointer)
  --help, -h                          Show this help message"""
    )


def _safe_write(stream, text: str) -> None:
    """Write text to stream, returning early if stream is None and ignoring errors."""
    if stream is None:
        return
    try:
        stream.write(text)
        if hasattr(stream, "flush"):
            stream.flush()
    except Exception:
        pass


def _kill_child_group(proc: subprocess.Popen | None) -> None:
    """Terminate the child and its entire process group (grandchildren)."""
    if proc is None:
        return
    if os.name == "nt":
        if proc.poll() is not None:
            return
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=5)
            except Exception:
                pass
    else:
        # On POSIX, always signal the process group even if the direct child already exited,
        # so orphaned background grandchildren in the same process group are killed.
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            pass
        if proc.poll() is None:
            try:
                proc.wait(timeout=10)
            except Exception:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    pass
                try:
                    proc.wait(timeout=5)
                except Exception:
                    pass
        # Wait briefly (about 1 s total, polling) after the SIGTERM phase,
        # then send SIGKILL once to eliminate grandchildren that ignore SIGTERM.
        pgid = proc.pid
        t_end = time.time() + 1.0
        while time.time() < t_end:
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError, OSError):
                break
            time.sleep(0.1)
        try:
            os.killpg(pgid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            pass


def _copy_item(src: Path, dest: Path) -> None:
    """Copy an item handling symlinks, directories, and platform constraints."""
    if src.is_symlink():
        target = os.readlink(src)
        try:
            resolved = src.resolve()
            if not resolved.exists():
                _safe_write(sys.stderr, f"warning: skipping dangling symlink {src}\n")
                return
        except Exception:
            _safe_write(sys.stderr, f"warning: skipping dangling symlink {src}\n")
            return

        is_dir_target = resolved.is_dir()

        try:
            if dest.is_symlink() or dest.exists():
                if dest.is_dir() and not dest.is_symlink():
                    shutil.rmtree(dest, ignore_errors=True)
                else:
                    dest.unlink(missing_ok=True)
            os.symlink(target, dest, target_is_directory=is_dir_target)
        except OSError:
            # Fall back to copying the target (e.g. Windows without SeCreateSymbolicLinkPrivilege)
            try:
                if resolved.is_dir():
                    _copy_item(resolved, dest)
                else:
                    shutil.copy2(resolved, dest)
            except Exception as e:
                _safe_write(sys.stderr, f"warning: failed to copy symlink target {src}: {e}\n")
                raise
    elif src.is_dir():
        if dest.is_symlink() or (dest.exists() and not dest.is_dir()):
            dest.unlink(missing_ok=True)
        dest.mkdir(exist_ok=True)
        errors = []
        for child in src.iterdir():
            try:
                _copy_item(child, dest / child.name)
            except Exception as err:
                errors.append(f"{child}: {err}")
        if errors:
            raise OSError(f"failed to copy {len(errors)} items in {src}: {'; '.join(errors)}")
    else:
        if dest.is_symlink():
            dest.unlink(missing_ok=True)
        elif dest.is_dir():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copy2(src, dest)


_SECTION_STOP_RE = re.compile(r"^(?:##\s+|\[[^\]]+\]:\s+\S+)", re.MULTILINE)


def _find_section_end(content: str, search_from: int) -> int:
    m = _SECTION_STOP_RE.search(content, search_from)
    return m.start() if m else len(content)


def extract_changelog_section(
    changelog_path: Path, target_version: str, old_version: str | None = None
) -> str:
    if not changelog_path.is_file():
        return ""
    try:
        content = changelog_path.read_text(encoding="utf-8")
    except Exception:
        return ""

    if (
        old_version
        and old_version != "0.0.0"
        and compare(old_version, target_version) == 1
    ):
        header_pattern = re.compile(
            r"^(##\s*\[?v?([0-9]+\.[0-9]+\.[0-9]+[^\s\]]*)\]?.*)$",
            re.MULTILINE,
        )
        matches = list(header_pattern.finditer(content))
        matched_sections = []
        for idx, m in enumerate(matches):
            ver_str = m.group(2).strip()
            if compare(old_version, ver_str) == 1 and compare(ver_str, target_version) >= 0:
                start_pos = m.start()
                end_pos = _find_section_end(content, m.end())
                matched_sections.append(content[start_pos:end_pos].strip())
        if matched_sections:
            return "\n\n".join(matched_sections)

    escaped_ver = re.escape(target_version.lstrip("v"))
    pattern = re.compile(
        rf"^(##\s*(?:\[v?{escaped_ver}\]|v?{escaped_ver}(?=\s|$)).*)$",
        re.MULTILINE,
    )
    match = pattern.search(content)
    if not match:
        return ""

    start_pos = match.start()
    end_pos = _find_section_end(content, match.end())
    return content[start_pos:end_pos].strip()


def main() -> int:
    original_cwd = None
    parent_dir = SCRIPT_DIR.parent.parent.parent

    # Detect developer repository checkout vs customer installation
    if (
        parent_dir.name == "dist"
        and (parent_dir / "skills").is_dir()
        and (
            (parent_dir.parent / "scripts" / "publish.sh").is_file()
            or (parent_dir.parent / ".git").is_dir()
        )
    ):
        repo_root = parent_dir.parent
    elif parent_dir.name == ".claude":
        repo_root = parent_dir.parent
    else:
        repo_root = parent_dir

    target_version = None
    install_dir_arg = None

    args = sys.argv[1:]
    idx = 0
    while idx < len(args):
        arg = args[idx]
        if arg in ("--root", "--install-root"):
            if idx + 1 >= len(args):
                _safe_write(sys.stderr, f"error: {arg} requires an argument\n")
                return 1
            install_dir_arg = args[idx + 1]
            idx += 2
        elif arg in ("--target", "--target-version", "--version", "--to"):
            if idx + 1 >= len(args):
                _safe_write(sys.stderr, f"error: {arg} requires an argument\n")
                return 1
            target_version = args[idx + 1]
            idx += 2
        elif arg in ("-h", "--help"):
            print_usage()
            return 0
        else:
            _safe_write(
                sys.stderr,
                f"error: unrecognized argument '{arg}'\n",
            )
            return 1

    install_dir_raw = install_dir_arg if install_dir_arg else str(repo_root)
    install_path = Path(install_dir_raw).expanduser()

    if not install_path.exists():
        _safe_write(
            sys.stderr,
            f"error: installation directory '{install_path}' does not exist.\n",
        )
        return 1

    try:
        install_dir = install_path.resolve()
    except Exception:
        install_dir = install_path.absolute()

    home_env = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    home_path = Path(home_env).resolve() if home_env else None

    # Check for dangerous roots (/, C:\, HOME)
    if (
        str(install_dir) == "/"
        or install_dir.parent == install_dir
        or (home_path and install_dir == home_path)
    ):
        _safe_write(sys.stderr, f"error: refusing to update dangerous root '{install_dir}'\n")
        return 1

    # Check developer repository checkout
    if (
        (install_dir / "scripts" / "publish.sh").is_file()
        or (install_dir / "dist" / "skills").is_dir()
        or ((install_dir / ".git").is_dir() and (install_dir / "tests").is_dir())
    ):
        _safe_write(
            sys.stderr,
            f"error: refusing to update developer repository checkout '{install_dir}'\n"
            "       Self-update is designed for customer installations, not the source repository.\n",
        )
        return 1

    # Check for config
    has_config = (
        (install_dir / "data-apps-config.json").is_file()
        or (install_dir / "looker-config.json").is_file()
        or (install_dir / "canvas-config.json").is_file()
    )
    if not has_config:
        _safe_write(
            sys.stderr,
            f"error: '{install_dir}' does not appear to be a Looker Data Apps installation "
            "(missing data-apps-config.json, looker-config.json, or canvas-config.json)\n",
        )
        return 1

    # Check for VERSION
    has_version = (install_dir / "VERSION").is_file() or (
        install_dir / "dist" / "VERSION"
    ).is_file()
    if not has_version:
        _safe_write(
            sys.stderr,
            f"error: '{install_dir}' does not appear to be a versioned installation (missing VERSION file)\n",
        )
        return 1

    # Acquire concurrency lockfile (.update.lock)
    lock_file = install_dir / ".update.lock"
    acquired_lock = False
    try:
        fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()}\n")
        acquired_lock = True
    except FileExistsError:
        holding_pid_str = ""
        try:
            holding_pid_str = re.sub(
                r"[^0-9]", "", lock_file.read_text(encoding="utf-8")
            )
        except Exception:
            pass

        is_alive = False
        if holding_pid_str:
            try:
                pid = int(holding_pid_str)
                if pid == os.getpid():
                    is_alive = True
                else:
                    is_alive = _is_pid_alive(pid)
            except ValueError:
                is_alive = False

        if not is_alive:
            _safe_write(
                sys.stderr,
                f"removing stale lockfile from dead or empty pid {holding_pid_str or 'empty'}...\n",
            )
            try:
                lock_file.unlink(missing_ok=True)
            except Exception:
                pass
            try:
                fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(f"{os.getpid()}\n")
                acquired_lock = True
            except Exception:
                _safe_write(sys.stderr, f"error: failed to acquire update lock in {install_dir}\n")
                return 1
        else:
            _safe_write(
                sys.stderr,
                f"error: another self-update is already running (pid {holding_pid_str or 'unknown'}) in {install_dir}\n",
            )
            return 1

    # Chdir to install_dir so running from inside a subfolder (e.g. skills/toolkit-updater/tools)
    # does not hold an open directory handle that blocks deleting or updating skills/ on Windows.
    try:
        original_cwd = os.getcwd()
    except OSError:
        original_cwd = None
    try:
        os.chdir(install_dir)
    except OSError:
        pass

    backup_dir = None
    backup_created = False
    preserve_backup = False
    tmp_dir = None
    tmp_install_path = None
    old_handlers = {}
    handlers_restored = False
    rolling_back = False
    in_download = False

    def restore_handlers():
        nonlocal handlers_restored
        if handlers_restored:
            return
        handlers_restored = True
        for sig, handler in old_handlers.items():
            try:
                signal.signal(sig, handler)
            except Exception:
                pass

    def cleanup():
        nonlocal backup_dir, tmp_dir, lock_file, acquired_lock, backup_created, preserve_backup
        if not preserve_backup and backup_created and backup_dir:
            try:
                if backup_dir.is_dir():
                    shutil.rmtree(backup_dir, ignore_errors=True)
                    backup_dir = None
            except OSError:
                pass
        if tmp_dir:
            try:
                if tmp_dir.is_dir():
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                    tmp_dir = None
            except OSError:
                pass
        if acquired_lock and lock_file:
            try:
                if lock_file.exists():
                    acquired_lock = False
                    try:
                        lock_file.unlink(missing_ok=True)
                    except Exception:
                        pass
            except OSError:
                pass

    try:
        old_version = "0.0.0"
        for vf in [install_dir / "VERSION", install_dir / "dist" / "VERSION"]:
            if vf.is_file():
                try:
                    val = vf.read_text(encoding="utf-8").strip().lstrip("v")
                    if val:
                        old_version = val
                        break
                except Exception:
                    pass

        initial_version = old_version
        explicit_cli_target = target_version

        cfg = _read_install_cfg(install_dir)
        shared_base_url = _resolve_shared_base(cfg)

        # Resolve target version if not provided on CLI
        used_cached_target = False
        if not target_version:
            initial_pointer_override = None
            env_ver_url = os.environ.get("DATA_APPS_VERSION_URL")
            if env_ver_url and env_ver_url.strip():
                initial_pointer_override = env_ver_url.strip()
            elif (
                not (os.environ.get("DATA_APPS_SHARED_BASE") and os.environ.get("DATA_APPS_SHARED_BASE").strip())
                and not (os.environ.get("DATA_APPS_BASE_URL") or os.environ.get("CANVAS_BASE_URL"))
                and isinstance(cfg.get("version_url"), str)
                and cfg.get("version_url").strip()
            ):
                initial_pointer_override = cfg.get("version_url").strip()
            # Query live pointer first
            live_ver = _fetch_live_pointer(shared_base_url, pointer_url_override=initial_pointer_override)
            if live_ver:
                target_version = live_ver
            else:
                # Fall back to .update-check.json ONLY if live pointer is unreachable
                cache_file = install_dir / ".update-check.json"
                if cache_file.is_file():
                    try:
                        cache_data = json.loads(cache_file.read_text(encoding="utf-8-sig"))
                        cached_ver = cache_data.get("latest_version")
                        if cached_ver:
                            cached_clean = str(cached_ver).strip().lstrip("v")
                            if (
                                re.match(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$", cached_clean)
                                and compare(old_version, cached_clean) >= 0
                            ):
                                target_version = cached_clean
                                used_cached_target = True
                    except Exception:
                        pass

        if not target_version:
            _safe_write(
                sys.stderr,
                "error: could not determine target version; pass --target-version <version>.\n",
            )
            return 1

        target_version = target_version.strip().lstrip("v")
        if (
            not re.match(r"^[A-Za-z0-9._-]+$", target_version)
            or set(target_version) == {"."}
            or ".." in target_version
        ):
            _safe_write(sys.stderr, f"error: invalid target version format: '{target_version}'\n")
            return 1

        print("Updating Looker Data Apps toolkit:")
        print(f"  Location: {short_path(install_dir)}")
        print(f"  Current:  {old_version}")
        print(f"  Target:   {target_version}")

        # Check version comparison: refuse downgrades (uses version_utils.py" compare)
        order = compare(old_version, target_version)
        version_order = {-1: "older", 0: "same", 1: "newer"}[order]

        if version_order == "older":
            _safe_write(
                sys.stderr,
                f"error: target version {target_version} is older than the installed version "
                f"{old_version}; downgrades are not supported.\n",
            )
            return 1
        if version_order == "same":
            print(
                f"    {target_version} is already installed; reinstalling it to repair this installation."
            )

        # Install signal handlers before backup step (U1)
        recorded_signal = None
        child_proc = None

        def sig_handler(signum, frame):
            nonlocal recorded_signal
            if recorded_signal is None:
                recorded_signal = signum
            if in_download and not rolling_back:
                raise KeyboardInterrupt(f"interrupted by signal {signum}")
            if child_proc is not None and child_proc.poll() is None:
                if os.name == "nt":
                    try:
                        child_proc.terminate()
                    except Exception:
                        pass
                else:
                    try:
                        os.killpg(child_proc.pid, signal.SIGTERM)
                    except (ProcessLookupError, OSError):
                        pass

        signals_to_handle = [signal.SIGINT, signal.SIGTERM]
        if hasattr(signal, "SIGHUP"):
            signals_to_handle.append(signal.SIGHUP)
        for sig in signals_to_handle:
            old_handlers[sig] = signal.signal(sig, sig_handler)

        def rollback(code=1):
            nonlocal rolling_back, preserve_backup
            if code == 0 or code is None:
                code = 1
            if rolling_back:
                try:
                    cleanup()
                except BaseException:
                    pass
                sys.exit(code)
            rolling_back = True

            def _print_manual_restore():
                if backup_dir is None:
                    return
                _safe_write(
                    sys.stderr,
                    "   Your files remain safe in the backup directory:\n",
                )
                _safe_write(sys.stderr, f"   {backup_dir}\n")
                _safe_write(sys.stderr, "   To restore manually, run:\n")
                if os.name == "nt":
                    _safe_write(
                        sys.stderr,
                        f'     robocopy "{backup_dir}" "{install_dir}" /E\n',
                    )
                else:
                    _safe_write(
                        sys.stderr,
                        f'     cp -a "{backup_dir}/." "{install_dir}/"\n',
                    )

            try:
                # Ignore signals so a second signal cannot re-enter or interrupt rollback (U1)
                for sig_name in ("SIGINT", "SIGTERM", "SIGHUP"):
                    sig = getattr(signal, sig_name, None)
                    if sig is not None:
                        try:
                            signal.signal(sig, signal.SIG_IGN)
                        except Exception:
                            pass

                # Terminate child group before wiping/restoring files (V3)
                try:
                    _kill_child_group(child_proc)
                except Exception:
                    pass

                _safe_write(sys.stderr, "\n")
                _safe_write(
                    sys.stderr,
                    f"error: upgrade failed (exit code {code}). Rolling back to previous installation...\n",
                )

                backup_is_dir = False
                if backup_dir:
                    try:
                        backup_is_dir = backup_dir.is_dir()
                    except OSError as probe_err:
                        # Cannot even check the backup (e.g. permission denied): report it like
                        # any other restore failure so the manual restore command is printed.
                        raise OSError(f"cannot access backup directory: {probe_err}") from probe_err

                if backup_dir and backup_is_dir:
                    _safe_write(
                        sys.stderr,
                        "       Restoring previous installation from the temporary backup...\n",
                    )
                    # Clear existing installation: symlinks and files first, then directories (U2)
                    for item in install_dir.iterdir():
                        if item.name in ("apps", "backups", ".update.lock", ".git"):
                            continue
                        if item.is_symlink() or item.is_file():
                            try:
                                item.unlink(missing_ok=True)
                            except Exception:
                                pass
                        elif item.is_dir():
                            shutil.rmtree(item, ignore_errors=True)

                    restore_ok = True
                    failed_items = []
                    for item in backup_dir.iterdir():
                        dest = install_dir / item.name
                        try:
                            _copy_item(item, dest)
                        except Exception as err:
                            restore_ok = False
                            failed_items.append((item.name, err))

                    if failed_items:
                        _safe_write(sys.stderr, "failed to restore the following items:\n")
                        for name, err in failed_items:
                            _safe_write(sys.stderr, f"  - {name}: {err}\n")

                    if restore_ok:
                        _safe_write(sys.stderr, f"==> Successfully rolled back to v{initial_version}.\n")
                    else:
                        preserve_backup = True
                        _safe_write(sys.stderr, "❌ ERROR: Automatic rollback failed during restore!\n")
                        _print_manual_restore()
                else:
                    _safe_write(
                        sys.stderr,
                        f"warning: backup directory {backup_dir or 'unknown'} not found; cannot restore automatically.\n",
                    )
            except BaseException as e:
                if not isinstance(e, SystemExit):
                    preserve_backup = True
                    _safe_write(sys.stderr, f"❌ ERROR: Automatic rollback failed during restore: {e}\n")
                    try:
                        _print_manual_restore()
                    except Exception:
                        pass
            finally:
                try:
                    cleanup()
                except BaseException:
                    pass
                sys.exit(code)

        # 1. Stage temporary rollback copy under backups/
        backups_root = install_dir / "backups"
        backups_root.mkdir(parents=True, exist_ok=True)
        backup_dir = Path(tempfile.mkdtemp(prefix="rollback-", dir=str(backups_root)))
        backup_created = True

        print(f"    backing up current toolkit to {short_path(backup_dir)}...")
        item = None
        try:
            for item in install_dir.iterdir():
                if recorded_signal is not None:
                    break
                if item.name in ("apps", "backups", ".update.lock", ".git"):
                    continue
                dest = backup_dir / item.name
                _copy_item(item, dest)
        except Exception as e:
            if backup_created and backup_dir:
                try:
                    if backup_dir.is_dir():
                        shutil.rmtree(backup_dir, ignore_errors=True)
                except OSError:
                    pass
            cleanup()
            item_desc = f" {item.name}" if item is not None else ""
            _safe_write(sys.stderr, f"error: failed to backup{item_desc}: {e}\n")
            return 1

        if recorded_signal is not None:
            if backup_created and backup_dir:
                try:
                    if backup_dir.is_dir():
                        shutil.rmtree(backup_dir, ignore_errors=True)
                except OSError:
                    pass
            cleanup()
            return 128 + recorded_signal

        def fetch_url(url: str, dest: Path) -> bool:
            if url.startswith("file://"):
                fp = _file_url_to_path(url)
                try:
                    if not fp.is_file():
                        return False
                    shutil.copy2(fp, dest)
                    return True
                except OSError:
                    return False
            else:
                try:
                    scheme = urllib.parse.urlparse(url).scheme
                    if scheme not in ("http", "https"):
                        return False
                    req = urllib.request.Request(
                        url, headers={"User-Agent": "data-apps-updater"}
                    )
                    with _http_opener().open(req, timeout=30) as resp:
                        with open(dest, "wb") as f_out:
                            shutil.copyfileobj(resp, f_out)
                    return True
                except Exception:
                    return False

        MAX_HOPS = 3
        hop_count = 0
        disk_modified = False
        visited_versions = {initial_version}
        new_version = old_version

        try:
            while True:
                hop_count += 1
                pre_hop_shared_base = shared_base_url
                target_version = target_version.strip().lstrip("v")
                is_dev_channel_base = bool(re.search(r"/dev/[^/]+$", shared_base_url))

                # 2. Download installer
                dev_chan = (
                    os.environ.get("DEV_CHANNEL")
                    or os.environ.get("USER")
                    or os.environ.get("USERNAME")
                    or "dev"
                )
                installer_url = os.environ.get("DATA_APPS_INSTALL_URL") or os.environ.get(
                    "CANVAS_INSTALL_URL"
                )
                fallback_installer_url = None
                if not installer_url:
                    if is_dev_channel_base:
                        installer_url = f"{shared_base_url}/install.py"
                        fallback_installer_url = f"{shared_base_url}/install.sh"
                    elif "-dev" in target_version:
                        installer_url = f"{shared_base_url}/dev/{dev_chan}/install.py"
                        fallback_installer_url = f"{shared_base_url}/dev/{dev_chan}/install.sh"
                    else:
                        installer_url = f"{shared_base_url}/versions/{target_version}/install.py"
                        fallback_installer_url = (
                            f"{shared_base_url}/versions/{target_version}/install.sh"
                        )

                # Download installer into a private temporary directory (V4)
                tmp_dir = Path(tempfile.mkdtemp(prefix="data-apps-self-update-"))
                tmp_install_path = tmp_dir / "installer"

                downloaded = False
                chosen_url = installer_url

                in_download = True
                try:
                    if recorded_signal is not None:
                        raise KeyboardInterrupt(f"interrupted by signal {recorded_signal}")
                    if fallback_installer_url:
                        print(f"    downloading installer from {installer_url}...")
                        if fetch_url(installer_url, tmp_install_path):
                            downloaded = True
                            chosen_url = installer_url
                        elif recorded_signal is not None:
                            # Signal recorded before trying fallback installer URL (V2a)
                            pass
                        else:
                            print(f"    downloading installer from {fallback_installer_url}...")
                            chosen_url = fallback_installer_url
                            if fetch_url(fallback_installer_url, tmp_install_path):
                                downloaded = True
                    else:
                        print(f"    downloading installer from {installer_url}...")
                        if fetch_url(installer_url, tmp_install_path):
                            downloaded = True
                except KeyboardInterrupt:
                    in_download = False
                    sig_ret = recorded_signal if recorded_signal is not None else signal.SIGINT
                    if disk_modified:
                        rollback(128 + sig_ret)
                    else:
                        cleanup()
                        restore_handlers()
                        return 128 + sig_ret
                finally:
                    in_download = False

                if recorded_signal is not None:
                    if disk_modified:
                        rollback(128 + recorded_signal)
                    else:
                        restore_handlers()
                        cleanup()
                        return 128 + recorded_signal

                if not downloaded:
                    _safe_write(sys.stderr, f"error: failed to download installer from {chosen_url}\n")
                    if disk_modified:
                        rollback(1)
                    else:
                        return 1

                # Step 3: Execute installer
                env_base_url = (
                    os.environ.get("DATA_APPS_BASE_URL")
                    or os.environ.get("CANVAS_BASE_URL")
                    or ""
                ).rstrip("/")
                if env_base_url and "/versions/" not in env_base_url:
                    payload_base_url = env_base_url
                elif is_dev_channel_base:
                    payload_base_url = shared_base_url
                elif "-dev" in target_version:
                    payload_base_url = f"{shared_base_url}/dev/{dev_chan}"
                else:
                    payload_base_url = f"{shared_base_url}/versions/{target_version}"

                is_bash = False
                has_stamped_payload_base = False
                has_stamped_shared_base = False
                try:
                    with open(tmp_install_path, "r", encoding="utf-8", errors="ignore") as f:
                        head_text = f.read(8192)
                    first_line = head_text.splitlines()[0].strip() if head_text else ""
                    if (
                        first_line.startswith("#!/usr/bin/env bash")
                        or first_line.startswith("#!/bin/bash")
                        or first_line.startswith("#!/bin/sh")
                        or chosen_url.endswith(".sh")
                    ):
                        is_bash = True
                    ver_m = re.search(r'^VERSION\s*=\s*"([^"]+)"', head_text, re.M)
                    pb_m = re.search(r'^PAYLOAD_BASE\s*=\s*"([^"]+)"', head_text, re.M)
                    sb_m = re.search(r'^SHARED_BASE\s*=\s*"([^"]+)"', head_text, re.M)
                    if (
                        ver_m
                        and ver_m.group(1) != "dev-local"
                        and pb_m
                        and pb_m.group(1).rstrip("/") == payload_base_url.rstrip("/")
                    ):
                        has_stamped_payload_base = True
                        if sb_m:
                            has_stamped_shared_base = True
                except Exception:
                    is_bash = chosen_url.endswith(".sh")

                env = dict(os.environ)
                env["DATA_APPS_INSTALL_DIR"] = str(install_dir)
                env["DATA_APPS_SKIP_VERIFY"] = "1"
                caller_set_base = bool(os.environ.get("DATA_APPS_BASE_URL") or os.environ.get("CANVAS_BASE_URL"))
                caller_set_shared = bool(os.environ.get("DATA_APPS_SHARED_BASE"))
                if caller_set_base or not has_stamped_payload_base:
                    env["DATA_APPS_BASE_URL"] = payload_base_url
                if caller_set_shared or caller_set_base or not has_stamped_shared_base:
                    env["DATA_APPS_SHARED_BASE"] = shared_base_url

                print("    running installer non-interactively...")

                popen_kwargs = {
                    "stdin": subprocess.DEVNULL,
                    "env": env,
                    "cwd": str(install_dir),
                }
                if os.name != "nt":
                    # start_new_session puts installer in a new process group so killpg reaches grandchildren
                    popen_kwargs["start_new_session"] = True
                # On Windows, omit CREATE_NEW_PROCESS_GROUP so console Ctrl+C reaches the full process tree

                disk_modified = True
                try:
                    if is_bash:
                        # V5: set DATA_APPS_UPGRADE_MODE=1 for bash fallback
                        env["DATA_APPS_UPGRADE_MODE"] = "1"
                        child_proc = subprocess.Popen(
                            ["bash", str(tmp_install_path)],
                            **popen_kwargs,
                        )
                    else:
                        # Uses runpy to keep the literal "python3" argv for Semgrep and run a temp file without .py extension.
                        child_proc = subprocess.Popen(
                            [
                                "python3",
                                "-c",
                                "import sys, runpy; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name='__main__')",
                                str(tmp_install_path),
                                "--upgrade",
                                str(install_dir),
                            ],
                            executable=sys.executable,
                            **popen_kwargs,
                        )

                    # Terminate child group immediately if signal arrived before Popen finished (V2c)
                    if recorded_signal is not None:
                        _kill_child_group(child_proc)

                    escalated = False
                    while True:
                        try:
                            retcode = child_proc.wait(timeout=0.5)
                            break
                        except subprocess.TimeoutExpired:
                            if recorded_signal is not None and not escalated:
                                escalated = True
                                _kill_child_group(child_proc)

                    if recorded_signal is not None:
                        rollback(128 + recorded_signal)
                    elif retcode != 0:
                        exit_code = 128 + abs(retcode) if retcode < 0 else retcode
                        rollback(exit_code)

                    # Step 4: Verify version and post-upgrade health
                    new_version = ""
                    for vf in [install_dir / "VERSION", install_dir / "dist" / "VERSION"]:
                        if vf.is_file():
                            try:
                                new_version = vf.read_text(encoding="utf-8").strip().lstrip("v")
                                if new_version:
                                    break
                            except Exception:
                                pass

                    new_build_info = ""
                    for bf in [install_dir / "BUILD_INFO", install_dir / "dist" / "BUILD_INFO"]:
                        if bf.is_file():
                            try:
                                new_build_info = bf.read_text(encoding="utf-8").strip().lstrip("v")
                                if new_build_info:
                                    break
                            except Exception:
                                pass

                    if new_version != target_version and new_build_info != target_version:
                        _safe_write(
                            sys.stderr,
                            f"error: VERSION after upgrade ({new_version}) does not match target ({target_version})\n",
                        )
                        rollback(1)

                    # Validate essential runtime files if they were present before or expected after (U4)
                    for check_rel in ("runtime/data-app.js", "preview-server/serve.py"):
                        required_if_prior = bool(backup_dir and (backup_dir / check_rel).exists())
                        tf = install_dir / check_rel
                        if tf.exists():
                            if tf.stat().st_size == 0:
                                _safe_write(sys.stderr, f"error: {check_rel} is empty after upgrade\n")
                                rollback(1)
                        elif required_if_prior:
                            _safe_write(sys.stderr, f"error: {check_rel} missing after upgrade\n")
                            rollback(1)

                    cfg_after = install_dir / "data-apps-config.json"
                    if cfg_after.exists():
                        try:
                            data = json.loads(cfg_after.read_text(encoding="utf-8-sig"))
                            if not isinstance(data, dict):
                                raise ValueError("data-apps-config.json is not a JSON object")
                        except Exception as e:
                            _safe_write(
                                sys.stderr,
                                f"error: data-apps-config.json corrupted after upgrade: {e}\n",
                            )
                            rollback(1)

                    # If a signal arrived during post-upgrade verification, rollback (V2)
                    if recorded_signal is not None:
                        rollback(128 + recorded_signal)

                except Exception as e:
                    _safe_write(sys.stderr, f"  ✗ error: {e}\n")
                    rollback(1)
                finally:
                    child_proc = None
                    if tmp_dir and tmp_dir.is_dir():
                        shutil.rmtree(tmp_dir, ignore_errors=True)
                        tmp_dir = None

                visited_versions.add(new_version)

                # Post-hop convergence check
                has_install_override = bool(
                    os.environ.get("DATA_APPS_INSTALL_URL") or os.environ.get("CANVAS_INSTALL_URL")
                )
                env_s_base = os.environ.get("DATA_APPS_SHARED_BASE")
                env_b_url = os.environ.get("DATA_APPS_BASE_URL") or os.environ.get("CANVAS_BASE_URL")
                if (
                    hop_count < MAX_HOPS
                    and not explicit_cli_target
                    and not has_install_override
                    and not env_s_base
                    and not env_b_url
                    and "-dev" not in target_version
                    and not is_dev_channel_base
                ):
                    post_hop_shared_base = _resolve_post_hop_shared_base(install_dir)
                    if (
                        post_hop_shared_base.rstrip("/") != pre_hop_shared_base.rstrip("/")
                        or used_cached_target
                    ):
                        used_cached_target = False
                        in_download = True
                        try:
                            if recorded_signal is not None:
                                raise KeyboardInterrupt(f"interrupted by signal {recorded_signal}")
                            next_ver = _fetch_live_pointer(post_hop_shared_base)
                        except KeyboardInterrupt:
                            in_download = False
                            sig_ret = recorded_signal if recorded_signal is not None else signal.SIGINT
                            rollback(128 + sig_ret)
                        finally:
                            in_download = False

                        if recorded_signal is not None:
                            rollback(128 + recorded_signal)

                        if (
                            next_ver
                            and compare(new_version, next_ver) == 1
                            and next_ver not in visited_versions
                        ):
                            print(
                                f"    continuing upgrade from {new_version} to latest {next_ver}..."
                            )
                            shared_base_url = post_hop_shared_base.rstrip("/")
                            target_version = next_ver
                            continue

                if recorded_signal is not None:
                    rollback(128 + recorded_signal)
                break
        except BaseException as exc:
            if (
                disk_modified
                and not rolling_back
                and not (isinstance(exc, SystemExit) and exc.code == 0)
            ):
                rollback(1)
            raise
        finally:
            restore_handlers()

        # Upgrade succeeded: remove temporary rollback copy
        if backup_created and backup_dir:
            try:
                if backup_dir.is_dir():
                    shutil.rmtree(backup_dir, ignore_errors=True)
                backup_dir = None
            except OSError:
                pass

        changelog_section = ""
        try:
            # Clear update check caches
            for cache_name in (".update-check.json", ".UpdateCheckCache"):
                cf = install_dir / cache_name
                if cf.exists():
                    try:
                        cf.unlink(missing_ok=True)
                    except Exception:
                        pass

            # Extract changelog section for the summary block
            for ch_path in [
                install_dir / "CHANGELOG.md",
                install_dir / "dist" / "CHANGELOG.md",
            ]:
                if ch_path.is_file():
                    changelog_section = extract_changelog_section(
                        ch_path, new_version, old_version=initial_version
                    )
                    if changelog_section:
                        break
        except KeyboardInterrupt:
            _safe_write(
                sys.stderr,
                "note: post-upgrade cleanup interrupted; upgrade completed successfully.\n",
            )

        # Success outputs
        print()
        print(f"==> Successfully upgraded Looker Data Apps toolkit to v{new_version}.")
        print("SELF_UPDATE_STATUS=SUCCESS")
        print(f"OLD_VERSION={initial_version}")
        print(f"NEW_VERSION={new_version}")
        print("CHANGELOG_SECTION_START")
        if changelog_section:
            print(changelog_section)
        print("CHANGELOG_SECTION_END")

        return 0

    except KeyboardInterrupt:
        return 130
    finally:
        restore_handlers()
        cleanup()
        if original_cwd is not None:
            try:
                os.chdir(original_cwd)
            except OSError:
                pass


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
