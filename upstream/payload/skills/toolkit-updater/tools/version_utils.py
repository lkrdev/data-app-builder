#!/usr/bin/env python3
"""Shared version helpers for the toolkit updater.

Two tools compare toolkit versions and they have to agree: `check-for-update.py`
decides whether to *offer* an upgrade, and `self-update.sh` decides whether to
*perform* one. A second, independently written copy of "which of these is
newer" is how a toolkit ends up offering an upgrade that the updater then
refuses, so both read this module -- python by import, shell through the CLI
below.

CLI:
    python3 version_utils.py compare <installed> <target>

prints `older`, `same`, or `newer`, describing <target> relative to
<installed>, and exits 0. Any other invocation exits 2.
"""

import re
import sys

# A version may carry a pre-release or build suffix (`1.2.3-dev.abc`,
# `1.2.3+build7`); only the numeric core participates in ordering.
_SUFFIX_RE = re.compile(r"[-+]")


def parse_version(v_str):
    """Parse a version string into a comparable `(major, minor, patch)` tuple.

    Accepts an optional leading `v` and an optional `-`/`+` suffix. Parsing
    stops at the first component that is not a plain integer and the remaining
    components are zero-filled, so a corrupt or missing VERSION file reads as
    an old version rather than raising: the caller's job is to update the
    toolkit, not to validate it.
    """
    if not v_str:
        return (0, 0, 0)
    cleaned = str(v_str).strip().lstrip("v")
    base = _SUFFIX_RE.split(cleaned)[0]
    parts = []
    for p in base.split("."):
        if p.isdigit():
            parts.append(int(p))
        else:
            break
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def compare(installed, target):
    """Return -1, 0 or 1 as `target` is older than, same as, or newer than `installed`."""
    installed_parts = parse_version(installed)
    target_parts = parse_version(target)
    if target_parts < installed_parts:
        return -1
    if target_parts > installed_parts:
        return 1
    return 0


def _main(argv):
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    if len(argv) != 4 or argv[1] != "compare":
        print("usage: version_utils.py compare <installed> <target>", file=sys.stderr)
        return 2
    print({-1: "older", 0: "same", 1: "newer"}[compare(argv[2], argv[3])])
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
