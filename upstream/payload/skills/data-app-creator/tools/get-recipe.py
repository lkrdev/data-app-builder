#!/usr/bin/env python3
"""Batch recipe lookup tool for Looker Data Apps.

Fetches full recipe documentation for one or more visualization patterns
in a single command, eliminating multi-file reading round-trips.

Usage:
    python3 skills/data-app-creator/tools/get-recipe.py --list
    python3 skills/data-app-creator/tools/get-recipe.py line-trend filter-dropdown
    python3 skills/data-app-creator/tools/get-recipe.py kpi line column
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def find_recipes_dir() -> Path | None:
    candidates = [
        Path(__file__).resolve().parent.parent / "recipes",
        Path.cwd() / "skills" / "data-app-creator" / "recipes",
        Path.cwd() / "dist" / "skills" / "data-app-creator" / "recipes",
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return None


def main() -> int:
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    parser = argparse.ArgumentParser(description="Fetch full Data App recipe documentation for one or more patterns.")
    parser.add_argument("recipes", nargs="*", help="Recipe names or keywords (e.g. line-trend, filter-dropdown)")
    parser.add_argument("--list", "-l", action="store_true", help="List all available recipes")
    args = parser.parse_args()

    rdir = find_recipes_dir()
    if not rdir:
        print("Error: Could not locate recipes directory.", file=sys.stderr)
        return 1

    all_files = sorted(rdir.glob("*.md"))
    available = {f.stem.lower(): f for f in all_files if f.stem.lower() != "readme"}

    if args.list or not args.recipes:
        print("Available recipes:")
        for name in sorted(available.keys()):
            first_line = ""
            try:
                for l in available[name].read_text(encoding="utf-8").splitlines():
                    if l.startswith("#"):
                        first_line = l.lstrip("#").strip()
                        break
            except Exception:
                pass
            print(f"  • {name:<26} {first_line}")
        return 0

    found_any = False
    printed: set[Path] = set()
    for req in args.recipes:
        req_norm = req.lower().replace(".md", "").strip()
        matches = []
        if req_norm in available:
            matches.append(available[req_norm])
        else:
            for name, fpath in available.items():
                if req_norm in name and fpath not in matches:
                    matches.append(fpath)

        if not matches:
            print(f"--- Recipe: {req} (NOT FOUND) ---")
            print(f"No recipe matching '{req}'. Run with --list to see available patterns.\n")
            continue

        for m in matches:
            if m in printed:
                continue
            printed.add(m)
            found_any = True
            content = m.read_text(encoding="utf-8")
            print(f"=== Recipe: {m.stem} ===")
            print(content.strip())
            print()

    return 0 if found_any else 1


if __name__ == "__main__":
    sys.exit(main())
