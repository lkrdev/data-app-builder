#!/usr/bin/env python3
"""Checks if a newer version of the Looker Data Apps toolkit is available.

Non-blocking, cached, stdlib-only.
Always exits 0; callers inspect the JSON stdout for `status` and `update_available`.
"""

import argparse
import datetime
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# This script is executed by path (`python3 .../check-for-update.py`), not
# imported as part of a package, so the sibling shared helper is not importable
# until its directory is on the path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from version_utils import parse_version  # noqa: E402


SCHEMA_VERSION = 1
CACHE_FILENAME = ".update-check.json"
DEFAULT_TTL_SECONDS = 86400  # 24 hours
RETRY_TTL_SECONDS = 3600  # 1 hour retry on offline/network failure
DEFAULT_TIMEOUT_SECONDS = 5.0
DEFAULT_BASE_URL = "https://dl.google.com/looker-data-apps"
POINTER_FILENAME = "latest-version.txt"
# The release pointer is a single short version string. Anything larger is either a
# misconfigured URL or a hostile server; read a bounded prefix rather than the stream.
MAX_POINTER_BYTES = 4096
# A pointer is interpolated into an upgrade URL path by self-update.sh, so it must be
# a bare semantic version -- no slashes, no '..', no scheme.
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$")


def find_root(start):
    cur = Path(start).resolve()
    # 1. In the data-apps developer repository checkout, resolve to the repo root
    for candidate in [cur, *cur.parents]:
        if ((candidate / "scripts" / "publish.sh").is_file() or (candidate / ".git").is_dir()) and (candidate / "dist").is_dir():
            return candidate

    parents = cur.parents
    if len(parents) > 3 and parents[2].name == "skills":
        if parents[3].name == ".claude" and len(parents) > 4:
            return parents[4]
        if parents[3].name != "dist":
            return parents[3]

    # 2. Search upwards for data-apps-config.json or looker-config.json (customer install)
    for candidate in [cur, *cur.parents]:
        if (candidate / "data-apps-config.json").is_file() or (candidate / "looker-config.json").is_file():
            return candidate

    # 3. For customer installations without config yet, search upwards for VERSION
    for candidate in [cur, *cur.parents]:
        if (candidate / "VERSION").is_file():
            return candidate

    if len(parents) > 3:
        fallback = parents[3]
        if fallback.name == ".claude" and len(parents) > 4:
            return parents[4]
        return fallback
    return cur


def read_installed_version(root: Path) -> str:
    for candidate in [root / "VERSION", root / "dist" / "VERSION"]:
        if candidate.is_file():
            try:
                v = candidate.read_text(encoding="utf-8").strip()
                if v:
                    return v
            except OSError:
                pass
    return "0.0.0"


def load_config(root: Path, config_arg: str = None) -> dict:
    candidates = []
    if config_arg:
        candidates.append(Path(config_arg))
    candidates.extend([root / "data-apps-config.json", root / "looker-config.json"])
    for p in candidates:
        if p.is_file():
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def is_check_disabled(cfg: dict) -> bool:
    if cfg.get("update_check") is False:
        return True
    env_val = os.environ.get("DATA_APPS_NO_UPDATE_CHECK", "").strip().lower()
    if env_val in ("1", "true", "yes", "on"):
        return True
    return False


def _http_only_opener() -> urllib.request.OpenerDirector:
    """An opener that can speak HTTP(S) and nothing else.

    urllib's default opener installs FileHandler, FTPHandler and DataHandler,
    so `urlopen("file:///etc/passwd")` reads the file. The version URL is
    configurable (`toolkit_url` in data-apps-config.json, or
    --version-url), so the default opener would turn a mis-configured or
    hostile config into an arbitrary-file read.

    The caller also enforces an http/https allowlist on the URL. This opener is
    the second, independent control: even if that check were bypassed or a
    redirect pointed somewhere else, there is simply no handler installed that
    could serve a file://, ftp:// or data:// URL.
    """
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


def get_version_url(cfg: dict, override: str = None) -> str:
    """The URL naming the newest published version.

    A single small object at the prefix root, outside every channel directory.
    That is what makes the discovery endpoint a constant: a release flips the
    pointer without any published copy of this script needing its own URL
    rewritten, and an install can never end up polling the very version
    directory it was installed from.
    """
    if override:
        return override
    env_val = os.environ.get("DATA_APPS_VERSION_URL")
    if env_val:
        return env_val
    if cfg.get("version_url"):
        return cfg["version_url"]
    base = str(cfg.get("toolkit_url") or "").rstrip("/")
    if base:
        return f"{base}/{POINTER_FILENAME}"
    return f"{DEFAULT_BASE_URL}/{POINTER_FILENAME}"



def get_changelog_url(cfg: dict, version_url: str, override: str = None) -> str:
    if override:
        return override
    env_val = os.environ.get("DATA_APPS_CHANGELOG_URL")
    if env_val:
        return env_val
    if cfg.get("changelog_url"):
        return cfg["changelog_url"]
    suffix = "/" + POINTER_FILENAME
    if version_url.endswith(suffix):
        return version_url[:-len(suffix)] + "/CHANGELOG.md"
    return f"{DEFAULT_BASE_URL}/CHANGELOG.md"


def read_cache(cache_path: Path) -> dict:
    if not cache_path.is_file():
        return {}
    try:
        with open(cache_path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _cached_epoch(cache: dict, now: float) -> float:
    """Return a usable last-check timestamp, or 0.0 when the cache is unusable.

    A non-numeric value would otherwise raise before the cache is rewritten, freezing
    the check permanently; a timestamp in the future (clock skew, or a restored disk
    image) would suppress checks until wall-clock caught up. Both are treated as
    "never checked" so the next run repairs the cache.
    """
    try:
        last = float(cache.get("last_checked_epoch") or 0)
    except (TypeError, ValueError):
        return 0.0
    if last > now:
        return 0.0
    return last


def write_cache(cache_path: Path, data: dict):
    tmp_path = None
    try:
        tmp_path = cache_path.with_name(f"{cache_path.name}.{os.getpid()}.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        tmp_path.replace(cache_path)
    except OSError:
        pass
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


def check_for_update(
    root: Path,
    cfg: dict,
    force: bool = False,
    dismiss_version: str = None,
    version_url_override: str = None,
    changelog_url_override: str = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict:
    cache_path = root / CACHE_FILENAME
    installed_version = read_installed_version(root)
    cache = read_cache(cache_path)

    # If --dismiss was passed, record dismissal and evaluate status against cached/remote
    if dismiss_version:
        cache["schema_version"] = SCHEMA_VERSION
        cache["dismissed_version"] = dismiss_version
        write_cache(cache_path, cache)
        latest = cache.get("latest_version")
        if (
            latest
            and parse_version(latest) > parse_version(dismiss_version)
            and parse_version(latest) > parse_version(installed_version)
        ):
            c_url = cache.get("changelog_url") or get_changelog_url(
                cfg, get_version_url(cfg, version_url_override), changelog_url_override
            )
            return {
                "status": "update_available",
                "update_available": True,
                "installed_version": installed_version,
                "latest_version": latest,
                "dismissed_version": dismiss_version,
                "changelog_url": c_url,
                "message": f"A newer version of Looker Data Apps toolkit is available ({installed_version} -> {latest}).",
            }
        return {
            "status": "up_to_date",
            "update_available": False,
            "installed_version": installed_version,
            "latest_version": latest or installed_version,
            "dismissed_version": dismiss_version,
            "message": f"Version {dismiss_version} has been dismissed.",
        }

    # If update checks are disabled
    if is_check_disabled(cfg):
        return {
            "status": "check_disabled",
            "update_available": False,
            "installed_version": installed_version,
            "latest_version": None,
            "message": "Update check is disabled via configuration or environment variable.",
        }

    # Check cache validity
    now = time.time()
    last_epoch = _cached_epoch(cache, now)
    prev_status = cache.get("status")
    installed_at_check = cache.get("installed_version_at_check")
    ttl = RETRY_TTL_SECONDS if prev_status == "check_failed_offline" else DEFAULT_TTL_SECONDS

    is_cache_fresh = (
        not force
        and cache.get("schema_version") == SCHEMA_VERSION
        and installed_at_check == installed_version
        and (now - last_epoch < ttl)
    )

    if is_cache_fresh:
        cached_latest = cache.get("latest_version")
        dismissed = cache.get("dismissed_version")
        if cached_latest:
            latest_tuple = parse_version(cached_latest)
            installed_tuple = parse_version(installed_version)
            dismissed_tuple = parse_version(dismissed) if dismissed else None
            if latest_tuple > installed_tuple:
                if dismissed_tuple and latest_tuple <= dismissed_tuple:
                    status = "up_to_date"
                    update_available = False
                    msg = f"Latest version {cached_latest} has been dismissed."
                else:
                    status = "update_available"
                    update_available = True
                    msg = f"A newer version of Looker Data Apps toolkit is available ({installed_version} -> {cached_latest})."
                return {
                    "status": status,
                    "update_available": update_available,
                    "installed_version": installed_version,
                    "latest_version": cached_latest,
                    "dismissed_version": dismissed,
                    "changelog_url": cache.get("changelog_url"),
                    "message": msg,
                }
        return {
            "status": "check_skipped_recent",
            "update_available": False,
            "installed_version": installed_version,
            "latest_version": cached_latest,
            "dismissed_version": dismissed,
            "changelog_url": cache.get("changelog_url"),
            "message": "Version check skipped (recently checked within cache TTL).",
        }

    # Network check
    v_url = get_version_url(cfg, version_url_override)
    c_url = get_changelog_url(cfg, v_url, changelog_url_override)
    dismissed = cache.get("dismissed_version")

    try:
        parsed = urllib.parse.urlparse(v_url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Invalid version URL scheme '{parsed.scheme}'; only http and https are allowed")
        req = urllib.request.Request(
            v_url,
            headers={"User-Agent": f"looker-data-apps/{installed_version}"}
        )
        resp = _http_only_opener().open(req, timeout=timeout)
        # An OpenerDirector with no handler for the scheme returns None rather
        # than raising, which would surface later as an AttributeError outside
        # this except clause. Turn it into an error this function handles.
        if resp is None:
            raise ValueError(f"No HTTP handler could serve {v_url!r}")
        with resp:
            remote_raw = resp.read(MAX_POINTER_BYTES).decode("utf-8").strip()
            if remote_raw:
                remote_raw = remote_raw.splitlines()[0].strip()
            else:
                raise ValueError("Empty remote version received")
        candidate = remote_raw[1:] if remote_raw.startswith("v") else remote_raw
        if not SEMVER_RE.match(candidate):
            raise ValueError(f"Remote version {remote_raw!r} is not a bare semantic version")
    except (urllib.error.URLError, OSError, TimeoutError, ValueError, http.client.HTTPException) as err:
        cached_latest = cache.get("latest_version")
        cached_latest_clean = cached_latest.lstrip("v") if cached_latest else None
        cached_tuple = parse_version(cached_latest_clean) if cached_latest_clean else (0, 0, 0)
        installed_tuple = parse_version(installed_version)
        dismissed_tuple = parse_version(dismissed) if dismissed else None
        update_avail = False
        changelog_url = None
        if cached_tuple > installed_tuple:
            if not (dismissed_tuple and cached_tuple <= dismissed_tuple):
                update_avail = True
                changelog_url = c_url

        cache_data = {
            "schema_version": SCHEMA_VERSION,
            "last_checked_epoch": now,
            "last_checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "status": "check_failed_offline",
            "installed_version_at_check": installed_version,
            "latest_version": cached_latest,
            "dismissed_version": dismissed,
            "error": str(err),
        }
        write_cache(cache_path, cache_data)
        res = {
            "status": "check_failed_offline",
            "update_available": update_avail,
            "installed_version": installed_version,
            "latest_version": cached_latest,
            "message": f"Update check failed (offline or network error): {err}",
        }
        if changelog_url:
            res["changelog_url"] = changelog_url
        return res

    latest_version = candidate
    latest_tuple = parse_version(latest_version)
    installed_tuple = parse_version(installed_version)
    dismissed_tuple = parse_version(dismissed) if dismissed else None

    if latest_tuple > installed_tuple:
        if dismissed_tuple and latest_tuple <= dismissed_tuple:
            status = "up_to_date"
            update_available = False
            msg = f"Latest version {latest_version} has been dismissed."
        else:
            status = "update_available"
            update_available = True
            msg = f"A newer version of Looker Data Apps toolkit is available ({installed_version} -> {latest_version})."
    else:
        status = "up_to_date"
        update_available = False
        msg = "Looker Data Apps toolkit is up to date."

    cache_data = {
        "schema_version": SCHEMA_VERSION,
        "last_checked_epoch": now,
        "last_checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": status,
        "installed_version_at_check": installed_version,
        "latest_version": latest_version,
        "dismissed_version": dismissed,
        "changelog_url": c_url,
    }
    write_cache(cache_path, cache_data)

    return {
        "status": status,
        "update_available": update_available,
        "installed_version": installed_version,
        "latest_version": latest_version,
        "dismissed_version": dismissed,
        "changelog_url": c_url,
        "message": msg,
    }


def main():
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    parser = argparse.ArgumentParser(description="Check for Looker Data Apps updates.")
    parser.add_argument("--root", help="Install root directory")
    parser.add_argument("--config", help="Path to data-apps-config.json")
    parser.add_argument("--force", action="store_true", help="Force remote check, ignoring cache TTL")
    parser.add_argument("--dismiss", metavar="VERSION", help="Dismiss update notification for this version")
    parser.add_argument("--version-url", help=argparse.SUPPRESS)
    parser.add_argument("--changelog-url", help=argparse.SUPPRESS)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS, help=argparse.SUPPRESS)
    parser.add_argument("--json", action="store_true", default=True, help=argparse.SUPPRESS)

    args = parser.parse_args()

    try:
        root = Path(args.root).resolve() if args.root else find_root(__file__)
        cfg = load_config(root, args.config)

        res = check_for_update(
            root=root,
            cfg=cfg,
            force=args.force,
            dismiss_version=args.dismiss,
            version_url_override=args.version_url,
            changelog_url_override=args.changelog_url,
            timeout=args.timeout,
        )
    except Exception as err:
        res = {
            "status": "check_failed",
            "update_available": False,
            "error": str(err),
            "message": f"Update check encountered an unexpected error: {err}",
        }
        try:
            root = Path(args.root).resolve() if args.root else find_root(__file__)
            cache_path = root / CACHE_FILENAME
            write_cache(cache_path, {
                "schema_version": SCHEMA_VERSION,
                "last_checked_epoch": int(time.time()),
                "last_checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "status": "check_failed",
                "installed_version_at_check": read_installed_version(root),
                "latest_version": None,
                "dismissed_version": args.dismiss,
                "error": str(err),
            })
        except Exception:
            pass

    print(json.dumps(res, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
