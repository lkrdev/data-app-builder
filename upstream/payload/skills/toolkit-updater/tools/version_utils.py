#!/usr/bin/env python3
"""Shared version helpers for the toolkit tools.

`check-for-update.py` decides whether to *offer* an upgrade and
`self-update.py` decides whether to *perform* one. Both compare versions
here, so they cannot disagree about which version is newer. The other tools
read an app's `@toolkit-version` tag and the installed `VERSION` here too.
"""

from __future__ import annotations

import re
from pathlib import Path

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
        if p.isascii() and p.isdigit():
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


# An app pins its toolkit with `@toolkit-version X.Y.Z` in the JSDoc block that
# opens app.js. The tag lives in the JS because the published bundle is the only
# copy of an app that Looker keeps.
_PIN_RE = re.compile(
    r"^[^\S\r\n]*\*[^\S\r\n]*@toolkit-version[^\S\r\n]+(?P<version>\S+)[^\S\r\n]*$",
    re.MULTILINE,
)
_SEMVER_RE = re.compile(r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$")


def find_header(source):
    """Return the regex match for a leading `/** ... */` JSDoc block, or None.

    Matches directly on `str(source)` so `match.start()` and `match.end()` are
    exact indices into `source` even when the file uses CRLF line endings.
    """
    raw = str(source)
    m = re.search(r"/\*\*([\s\S]*?)\*/", raw)
    if not m:
        return None
    prefix = raw[:m.start()].lstrip("\ufeff")
    if prefix.startswith("#!"):
        parts = re.split(r"\r?\n", prefix, maxsplit=1)
        prefix = parts[1] if len(parts) > 1 else ""
    cleaned = re.sub(r"/\*[\s\S]*?\*/", "", prefix)
    cleaned = re.sub(r"//[^\r\n]*", "", cleaned)
    if cleaned.strip():
        return None
    return m


def read_pin(app_source):
    """Read `@toolkit-version X.Y.Z` from the leading JSDoc header of `app_source`."""
    if not app_source:
        return None
    m = find_header(app_source)
    if not m:
        return None
    body = m.group(1).replace("\r\n", "\n").replace("\r", "\n")
    tag_match = _PIN_RE.search(body)
    if not tag_match:
        return None
    raw_ver = tag_match.group(1).strip()
    if not _SEMVER_RE.match(raw_ver):
        return None
    return raw_ver


_COMMENT_TAG_LINE_RE = re.compile(
    r"@toolkit-version(?:[^\S\r\n]+([^\s*]+|\S+?))?(?=\s*(?:\*/|$))"
)


def find_comment_tag(source):
    """Find @toolkit-version tag within comments, ignoring string literals.

    Returns (True, val) where val is the stripped token string (or "" if bare tag),
    or (False, None) if no @toolkit-version tag appears in any comment.
    """
    if not source:
        return (False, None)
    raw = str(source)
    n = len(raw)
    i = 0
    comments = []
    while i < n:
        c = raw[i]
        if c in ("'", '"', "`"):
            quote = c
            i += 1
            while i < n:
                if raw[i] == "\\":
                    i += 2
                    continue
                if raw[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == "/" and i + 1 < n:
            next_c = raw[i + 1]
            if next_c == "/":
                start = i + 2
                end = start
                while end < n and raw[end] not in ("\r", "\n"):
                    end += 1
                comments.append(raw[start:end])
                i = end
                continue
            if next_c == "*":
                start = i + 2
                end = raw.find("*/", start)
                if end == -1:
                    comments.append(raw[start:])
                    i = n
                else:
                    comments.append(raw[start:end])
                    i = end + 2
                continue
        i += 1

    for c_text in comments:
        for line in c_text.splitlines():
            m = _COMMENT_TAG_LINE_RE.search(line)
            if m:
                val = m.group(1).strip() if m.group(1) else ""
                return (True, val)
    return (False, None)


CANONICAL_BROWSER_ASSETS = "https://www.gstatic.com/looker-data-apps"
CANONICAL_TOOLKIT_URL = "https://dl.google.com/looker-data-apps"

RETIRED_GCS_TOOLKIT_RE = re.compile(
    r"^https://storage\.googleapis\.com/"
    r"(?:canvas-dashboards-lit(?:/.*)?|canvas-dashboards-shared(?!/looker-data-apps/dev/[^/]+)(?:/.*)?)$"
)


def normalize_toolkit_url(raw_url=None, default_url=CANONICAL_TOOLKIT_URL):
    """Normalize toolkit discovery base URL.

    Strips trailing slashes and version paths, maps retired GCS release buckets
    to default_url (canonical dl.google.com), while preserving active dev
    channels and custom self-hosted buckets.
    """
    if not isinstance(raw_url, str) or not raw_url.strip():
        return default_url
    cleaned = re.sub(r"/versions/[^/]+$", "", raw_url.strip().rstrip("/")).rstrip("/")
    if not cleaned or RETIRED_GCS_TOOLKIT_RE.match(cleaned):
        return default_url
    return cleaned

# Toolkits before 1.3.0 wrote @toolkit-version only at publish, and their bulk
# migration kept the old tag while it changed the code, so an older tag can be
# older than the app's code. Only tags from this version on name a runtime the
# code is known to target.
FIRST_TRUSTED_TAG = "1.3.0"


def tag_is_trusted(pin):
    """True if `pin` is a tag written by a toolkit that keeps it current (1.3.0 or later)."""
    return bool(pin) and compare(FIRST_TRUSTED_TAG, pin) >= 0


def read_installed_version(root):
    """Return the installed toolkit VERSION under `root`, or None.

    Reads `<root>/VERSION` (customer install) or `<root>/dist/VERSION`
    (developer checkout). A leading `v` is dropped.
    """
    for candidate in (Path(root) / "VERSION", Path(root) / "dist" / "VERSION"):
        try:
            value = candidate.read_text(encoding="utf-8").strip().lstrip("v")
        except OSError:
            continue
        if value:
            return value
    return None


def assets_root(browser_assets_url=None):
    """Return the browser asset base that holds `versions/<V>/` and `vendor/`.

    Mirrors how the publisher derives its vendor URL from `browser_assets_url`:
    a base that names one version or a dev channel is cut back to its root.
    """
    base = str(browser_assets_url or CANONICAL_BROWSER_ASSETS).rstrip("/")
    for marker in ("/versions/", "/dev/"):
        if marker in base:
            return base.split(marker, 1)[0]
    if base.endswith("/dev"):
        return base[: -len("/dev")]
    return base
