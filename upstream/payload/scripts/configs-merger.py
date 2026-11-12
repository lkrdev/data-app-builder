#!/usr/bin/env python3
"""Merge legacy configuration files into data-apps-config.json and reconcile URLs."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

CANONICAL_TOOLKIT_URL = "https://dl.google.com/looker-data-apps"
CANONICAL_BROWSER_ASSETS_URL = "https://www.gstatic.com/looker-data-apps"

OUR_RELEASE_BUCKET = re.compile(
    r"^https://storage\.googleapis\.com/"
    r"(?:canvas-dashboards-lit(?:/|$)|canvas-dashboards-shared(?!/looker-data-apps/dev/[^/]+)(?:/|$))"
)


def reconcile_urls(
    cfg: dict,
    default_toolkit_url: str = CANONICAL_TOOLKIT_URL,
    default_assets_url: str = CANONICAL_BROWSER_ASSETS_URL,
    canonical_toolkit_base: str = CANONICAL_TOOLKIT_URL,
    canonical_assets_base: str = CANONICAL_BROWSER_ASSETS_URL,
    installed_version: str = "",
    changed: list | None = None,
) -> bool:
    """Reconcile toolkit_url and browser_assets_url in cfg in-place.

    Returns True if any setting was modified, dropped, or migrated.
    """
    local_changed = [] if changed is None else changed

    if OUR_RELEASE_BUCKET.match(default_toolkit_url):
        default_toolkit_url = canonical_toolkit_base

    if cfg.pop("shared_assets_url", None) is not None:
        local_changed.append(("shared_assets_url", None, None))

    # Migrate legacy keys to modern keys first
    if "shared_base_url" in cfg:
        cfg["toolkit_url"] = cfg.pop("shared_base_url")
        local_changed.append(("migrated shared_base_url to toolkit_url", None, cfg["toolkit_url"]))
    if "shared_runtime_url" in cfg:
        cfg["browser_assets_url"] = cfg.pop("shared_runtime_url")
        local_changed.append(("migrated shared_runtime_url to browser_assets_url", None, cfg["browser_assets_url"]))

    # Reconcile toolkit_url
    if "toolkit_url" in cfg:
        old = cfg["toolkit_url"]
        if isinstance(old, str):
            cleaned_old = re.sub(r"/versions/[^/]+$", "", old.strip().rstrip("/")).rstrip("/")
            if default_toolkit_url == canonical_toolkit_base:
                if (
                    not cleaned_old
                    or cleaned_old == canonical_toolkit_base
                    or bool(OUR_RELEASE_BUCKET.match(cleaned_old))
                ):
                    cfg.pop("toolkit_url", None)
                    local_changed.append(("toolkit_url", old, None))
            else:
                if bool(OUR_RELEASE_BUCKET.match(cleaned_old)):
                    cfg["toolkit_url"] = default_toolkit_url
                    local_changed.append(("toolkit_url", old, default_toolkit_url))

    # Reconcile browser_assets_url
    superseded = (
        {f"{canonical_toolkit_base}/versions/{installed_version}", f"{canonical_assets_base}/versions/{installed_version}"}
        if installed_version
        else set()
    )
    if "browser_assets_url" in cfg:
        old = cfg["browser_assets_url"]
        if isinstance(old, str):
            old_stripped = old.strip().rstrip("/")
            cleaned_old = re.sub(r"/versions/[^/]+$", "", old_stripped).rstrip("/")
            is_retired = (
                bool(OUR_RELEASE_BUCKET.match(old_stripped))
                or bool(OUR_RELEASE_BUCKET.match(cleaned_old))
                or cleaned_old == canonical_toolkit_base
            )
            is_canonical = (not old_stripped) or (old_stripped == canonical_assets_base)
            is_previous = (old_stripped in superseded)
            if default_assets_url == canonical_assets_base:
                if is_retired or is_canonical or is_previous:
                    cfg.pop("browser_assets_url", None)
                    local_changed.append(("browser_assets_url", old, None))
            else:
                # Custom browser assets provided
                if is_retired or is_previous:
                    cfg["browser_assets_url"] = default_assets_url
                    local_changed.append(("browser_assets_url", old, default_assets_url))

    base_url = cfg.get("base_url") or ""
    target_url = cfg.get("target_url")
    host = urllib.parse.urlparse(base_url).hostname or "" if isinstance(base_url, str) else ""
    is_loopback = host in ("127.0.0.1", "localhost", "::1")
    if base_url and (target_url == base_url or not is_loopback):
        val = cfg.pop("target_url", None)
        if val is not None:
            local_changed.append(("target_url", val, None))
    if cfg.pop("use_proxy", None) is not None:
        local_changed.append(("use_proxy", None, None))
    if cfg.pop("proxy_port", None) is not None:
        local_changed.append(("proxy_port", None, None))

    return bool(local_changed)


def resolve_repo_root(custom_root: str | Path | None = None) -> Path:
    if custom_root:
        return Path(custom_root).expanduser().resolve()
    script_dir = Path(__file__).resolve().parent
    parent_dir = script_dir.parent
    if parent_dir.name == "dist" and (
        (parent_dir.parent / "scripts" / "publish.sh").is_file()
        or (parent_dir.parent / ".git").is_dir()
    ):
        return parent_dir.parent.resolve()
    return parent_dir.resolve()


def merge_configs(
    install_root: str | Path,
    default_toolkit_url: str | None = None,
    default_assets_url: str | None = None,
    canonical_toolkit_base: str = CANONICAL_TOOLKIT_URL,
    canonical_assets_base: str = CANONICAL_BROWSER_ASSETS_URL,
    previous_version: str | None = None,
    report: dict | None = None,
) -> int:
    root = Path(install_root).resolve()
    new_path = root / "data-apps-config.json"
    looker_path = root / "looker-config.json"
    skill_path = root / "skills" / "data-app-creator" / "config.json"
    canvas_path = root / "canvas-config.json"
    publish_path = root / "skills" / "data-app-publisher" / "config" / "publish-config.json"

    had_looker = looker_path.is_file()
    had_skill = skill_path.is_file()
    had_canvas = canvas_path.is_file()
    had_publish = publish_path.is_file()
    had_any_legacy = had_looker or had_skill or had_canvas or had_publish

    successful_legacy: list[Path] = []
    corrupt_legacy: list[Path] = []

    def _finish(rc: int) -> int:
        if report is not None:
            report["legacy_merged"] = bool(successful_legacy)
            report["corrupt"] = [p.name for p in corrupt_legacy]
        return rc

    if not had_any_legacy and not new_path.is_file():
        return _finish(0)

    merged: dict = {}
    if had_publish:
        try:
            with open(publish_path, "r", encoding="utf-8-sig") as f:
                p_cfg = json.load(f)
                if isinstance(p_cfg, dict):
                    merged.update(p_cfg)
                    successful_legacy.append(publish_path)
                else:
                    corrupt_legacy.append(publish_path)
        except Exception:
            corrupt_legacy.append(publish_path)

    if had_canvas:
        try:
            with open(canvas_path, "r", encoding="utf-8-sig") as f:
                c_cfg = json.load(f)
                if isinstance(c_cfg, dict):
                    merged.update(c_cfg)
                    successful_legacy.append(canvas_path)
                else:
                    corrupt_legacy.append(canvas_path)
        except Exception:
            corrupt_legacy.append(canvas_path)

    if had_looker:
        try:
            with open(looker_path, "r", encoding="utf-8-sig") as f:
                l_cfg = json.load(f)
                if isinstance(l_cfg, dict):
                    merged.update(l_cfg)
                    successful_legacy.append(looker_path)
                else:
                    corrupt_legacy.append(looker_path)
        except Exception:
            corrupt_legacy.append(looker_path)

    if had_skill:
        try:
            with open(skill_path, "r", encoding="utf-8-sig") as f:
                s_cfg = json.load(f)
                if isinstance(s_cfg, dict):
                    for k, v in s_cfg.items():
                        if k == "looker_instance_url":
                            merged["base_url"] = v
                        else:
                            merged[k] = v
                    successful_legacy.append(skill_path)
                else:
                    corrupt_legacy.append(skill_path)
        except Exception:
            corrupt_legacy.append(skill_path)

    if "canvas_assets_url" in merged:
        if "browser_assets_url" not in merged:
            merged["browser_assets_url"] = merged.pop("canvas_assets_url")
        else:
            merged.pop("canvas_assets_url", None)

    if "looker_instance_url" in merged:
        if "base_url" not in merged:
            merged["base_url"] = merged["looker_instance_url"]
        del merged["looker_instance_url"]

    if new_path.is_file():
        try:
            with open(new_path, "r", encoding="utf-8-sig") as f:
                existing = json.load(f)
                if isinstance(existing, dict):
                    merged.update(existing)
        except Exception:
            pass

    # If nothing valid was merged and data-apps-config.json does not exist, return without writing
    if not successful_legacy and not new_path.is_file():
        if had_any_legacy:
            print(
                "Warning: No valid configuration found in legacy files; skipping merge to protect existing files.",
                file=sys.stderr,
            )
            return _finish(1)
        return _finish(0)

    # Back up corrupt legacy files only when merge proceeds
    for corrupt in corrupt_legacy:
        if corrupt.is_file():
            ts = int(time.time())
            bak_path = corrupt.with_name(f"{corrupt.name}.corrupt.{ts}.bak")
            if bak_path.exists():
                counter = 1
                while True:
                    candidate = corrupt.with_name(f"{corrupt.name}.corrupt.{ts}.{counter}.bak")
                    if not candidate.exists():
                        bak_path = candidate
                        break
                    counter += 1
            try:
                os.replace(corrupt, bak_path)
                print(
                    f"Warning: Corrupt legacy configuration file {corrupt.name} backed up to {bak_path.name}.",
                    file=sys.stderr,
                )
            except Exception as err:
                print(
                    f"Warning: could not back up corrupt legacy file {corrupt.name}: {err}",
                    file=sys.stderr,
                )

    if default_toolkit_url is None:
        default_toolkit_url = (
            os.environ.get("DATA_APPS_TOOLKIT_URL")
            or os.environ.get("DATA_APPS_SHARED_BASE")
            or canonical_toolkit_base
        )
    default_toolkit_url = default_toolkit_url.rstrip("/")

    if default_assets_url is None:
        default_assets_url = (
            os.environ.get("DATA_APPS_BROWSER_ASSETS_URL")
            or os.environ.get("DATA_APPS_RUNTIME_ASSETS_URL")
            or os.environ.get("DATA_APPS_RUNTIME_URL")
            or canonical_assets_base
        )
    default_assets_url = default_assets_url.rstrip("/")

    if previous_version is None:
        previous_version = os.environ.get("DATA_APPS_PREVIOUS_VERSION", "")

    changed: list[tuple[str, str | None, str | None]] = []
    reconcile_urls(
        merged,
        default_toolkit_url=default_toolkit_url,
        default_assets_url=default_assets_url,
        canonical_toolkit_base=canonical_toolkit_base,
        canonical_assets_base=canonical_assets_base,
        installed_version=previous_version,
        changed=changed,
    )

    legacy_merged = bool(successful_legacy)

    if legacy_merged or changed:
        tmp_path = new_path.with_name(new_path.name + ".tmp")
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(merged, indent=2) + "\n")
        try:
            os.chmod(tmp_path, 0o600)
        except Exception:
            pass
        os.replace(tmp_path, new_path)
        try:
            os.chmod(new_path, 0o600)
        except Exception:
            pass
    else:
        if new_path.is_file():
            try:
                os.chmod(new_path, 0o600)
            except Exception:
                pass

    for old in successful_legacy:
        if old.is_file():
            try:
                old.unlink()
            except Exception:
                pass

    if legacy_merged:
        print("Merged legacy configuration files into data-apps-config.json and removed old files.")
    if changed:
        for key, old_val, new_val in changed:
            if new_val is None:
                if key == "shared_assets_url":
                    print(f"  dropped retired setting {key}")
                else:
                    print(f"  dropped redundant setting {key}")
            elif old_val is None:
                print(f"  {key}: {new_val}")
            else:
                print(f"  {key} advanced")
                print(f"    was: {old_val}")
                print(f"    now: {new_val}")

    return _finish(0)


def main() -> int:
    custom_root = None
    for arg in sys.argv[1:]:
        if arg in ("-h", "--help"):
            print("Usage: configs-merger.py [install_dir]")
            print("Merge legacy configuration files into data-apps-config.json and reconcile URLs.")
            return 0
        if arg.startswith("-"):
            print(f"error: unrecognized option '{arg}'", file=sys.stderr)
            print("Usage: configs-merger.py [install_dir]", file=sys.stderr)
            print("Merge legacy configuration files into data-apps-config.json and reconcile URLs.", file=sys.stderr)
            return 2
        if custom_root is None:
            custom_root = arg
        else:
            print("error: too many arguments", file=sys.stderr)
            print("Usage: configs-merger.py [install_dir]", file=sys.stderr)
            print("Merge legacy configuration files into data-apps-config.json and reconcile URLs.", file=sys.stderr)
            return 2

    install_root = resolve_repo_root(custom_root)
    return merge_configs(install_root)


if __name__ == "__main__":
    sys.exit(main())
