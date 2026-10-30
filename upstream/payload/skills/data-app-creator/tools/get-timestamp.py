#!/usr/bin/env python3
"""
Get the current system timestamp in standard ISO 8601 format with local timezone offset.

Usage:
    python3 skills/data-app-creator/tools/get-timestamp.py
    python3 skills/data-app-creator/tools/get-timestamp.py --header
    python3 skills/data-app-creator/tools/get-timestamp.py --json

Useful for AI agents to accurately get system timestamps in Data App projects
in local timezone ISO format (e.g. 2026-08-08T13:52:05-07:00) without guessing.
"""

import argparse
from datetime import datetime, timezone
import json
import sys


def get_timestamps():
    now_local = datetime.now().astimezone()
    now_utc = datetime.now(timezone.utc)
    
    local_iso = now_local.isoformat(timespec="seconds")
    utc_iso = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    epoch = int(now_utc.timestamp())
    tz_name = now_local.tzname() or "Local"
    human_local = now_local.strftime(f"%A, %B %d, %Y at %I:%M:%S %p {tz_name}")
    
    return {
        "iso": local_iso,
        "local_iso": local_iso,
        "utc_iso": utc_iso,
        "epoch": epoch,
        "timezone": tz_name,
        "human_local": human_local,
    }


def main():
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    parser = argparse.ArgumentParser(description="Output current system timestamp in ISO 8601 local timezone format.")
    parser.add_argument("--header", action="store_true", help="Output a template JSDoc header comment for app.js")
    parser.add_argument("--json", action="store_true", help="Output timestamps as a structured JSON object")
    parser.add_argument("--title", default="Data App", help="Title to include when using --header")
    parser.add_argument("--description", default="Interactive Looker Data App", help="Description to include when using --header")
    args = parser.parse_args()

    data = get_timestamps()

    if args.json:
        print(json.dumps(data, indent=2))
    elif args.header:
        header = f"""/**
 * @title {args.title}
 * @description {args.description}
 */"""
        print(header)
    else:
        # Default to ISO 8601 with local timezone offset
        print(data["local_iso"])


if __name__ == "__main__":
    main()
