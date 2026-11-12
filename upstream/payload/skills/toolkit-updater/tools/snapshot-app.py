#!/usr/bin/env python3
"""Create a pre-upgrade snapshot of a single local Data App.

The app folder is copied as is, so the snapshot keeps the app's own
`@toolkit-version` tag (or none) and previews the way the app did before the
upgrade.
"""

from __future__ import annotations

import datetime
import os
import shutil
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from version_utils import read_installed_version, read_pin


def snapshot_app(target_arg: str) -> Path:
    raw = Path(target_arg).expanduser()
    app_dir = (raw.parent if raw.name == "app.js" else raw).expanduser().absolute()
    app_js = app_dir / "app.js"
    if not app_dir.is_dir() or not app_js.is_file():
        raise ValueError(f"not a Data App directory (missing app.js): {raw}")

    apps_dir = None
    install_dir = None
    first_apps_parent = None
    for anc in app_dir.parents:
        if anc.name != "apps":
            continue
        cand_root = anc.parent
        if first_apps_parent is None:
            first_apps_parent = cand_root
        if read_installed_version(cand_root):
            install_dir = cand_root
            apps_dir = anc
            break

    if first_apps_parent is None:
        raise ValueError(f"app must sit inside an apps/ directory: {app_dir}")
    if install_dir is None:
        if first_apps_parent.name == "backups":
            raise ValueError("this is a snapshot in backups/apps/; snapshot the app in apps/ instead")
        raise ValueError(f"install root is missing VERSION: {first_apps_parent}")

    pin = read_pin(app_js.read_text(encoding="utf-8", errors="replace"))
    label = f"v{pin}" if pin else "untagged"
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    backups_apps = install_dir / "backups" / "apps"
    backups_apps.mkdir(parents=True, exist_ok=True)

    app_rel = app_dir.relative_to(apps_dir).as_posix()
    app_slug = app_rel.replace("/", "__")
    base_name = f"{app_slug}-{label}-{ts}"
    snapshot_dir = backups_apps / base_name
    counter = 1
    while snapshot_dir.exists() or snapshot_dir.is_symlink() or os.path.islink(snapshot_dir):
        snapshot_dir = backups_apps / f"{base_name}-{counter}"
        counter += 1

    try:
        shutil.copytree(app_dir, snapshot_dir, symlinks=True)
    except FileExistsError:
        raise
    except BaseException:
        if snapshot_dir.is_symlink() or os.path.islink(snapshot_dir):
            snapshot_dir.unlink(missing_ok=True)
        elif snapshot_dir.is_dir():
            shutil.rmtree(snapshot_dir, ignore_errors=True)
        raise

    return snapshot_dir


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args in (["-h"], ["--help"]):
        print("Usage: snapshot-app.py <app_dir_or_app_js>")
        return 0
    if len(args) != 1 or args[0].startswith("-"):
        print("error: usage: snapshot-app.py <app_dir_or_app_js>", file=sys.stderr)
        return 1
    try:
        snap = snapshot_app(args[0])
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(snap)
    return 0


if __name__ == "__main__":
    sys.exit(main())
