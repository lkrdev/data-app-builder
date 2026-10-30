#!/usr/bin/env python3
"""Check an app.js for things that work in the preview and break in the tile.

A published Data App runs in Looker's sandboxed, opaque-origin iframe. Storage
throws there, `window.open` returns null, inline `on*` handlers never fire, and
a second local import 404s -- none of which the plain local preview reproduces.
That gap is "false green": the app looks finished, publishes, and is broken.

The faithful way to catch it is to run the app in a real sandbox, but an opaque
origin is cross-origin to whatever is inspecting it, so an agent driving a
browser cannot read the DOM or click anything in there. Every rule below is a
literal string in the source, so reading the source instead costs no page load,
no query, and no browser at all.

The rules mirror SKILL.md's *Tile Sandbox Constraints* table one-for-one, plus
`duplicate-id`, which survived the retired check-editable.py lint.

Usage:
    python3 skills/data-app-creator/tools/check-tile-safety.py apps/sales/app.js
    python3 skills/data-app-creator/tools/check-tile-safety.py apps/*/app.js

Exit status is 1 when anything is found, so it can gate a publish.
Stdlib only.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments, preserving line numbering and length so
    reported line numbers still point at the real source. A rule name mentioned
    in a comment is not a violation. Tracks ${...} interpolations inside
    backtick template literals so comments inside Lit html`...` bindings are
    stripped."""
    out = list(src)
    i, n = 0, len(src)
    in_line = in_block = in_str = False
    quote = ""
    tpl_brace_stack: list[int] = []
    while i < n:
        c, nxt = src[i], src[i + 1] if i + 1 < n else ""
        if in_line:
            if c == "\n":
                in_line = False
            else:
                out[i] = " "
        elif in_block:
            if c == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                in_block = False
                i += 2
                continue
            if c != "\n":
                out[i] = " "
        elif in_str:
            if c == "\\":
                i += 2
                continue
            if quote == "`" and c == "$" and nxt == "{":
                tpl_brace_stack.append(0)
                in_str = False
                i += 2
                continue
            if c == quote:
                in_str = False
        elif c == "/" and nxt == "/":
            in_line = True
            out[i] = " "
        elif c == "/" and nxt == "*":
            in_block = True
            out[i] = " "
        elif c in "\"'`":
            in_str, quote = True, c
        elif tpl_brace_stack:
            if c == "{":
                tpl_brace_stack[-1] += 1
            elif c == "}":
                if tpl_brace_stack[-1] == 0:
                    tpl_brace_stack.pop()
                    in_str, quote = True, "`"
                else:
                    tpl_brace_stack[-1] -= 1
        i += 1
    return "".join(out)


# (id, regex, message). Each maps to a row of SKILL.md's constraint table.
RULES = [
    ("inline-handler",
     re.compile(r"""\bon(?:click|change|input|submit|load|error|mouse\w+|key\w+)\s*=\s*["']"""),
     "inline on* handler -- blocked by the tile's CSP. Use a Lit binding: @click=${() => ...}"),

    ("dialog",
     re.compile(r"(?<![.\w])(?:alert|confirm|prompt)\s*\("),
     "alert/confirm/prompt -- no-ops in the sandbox. Render a modal template instead."),

    ("storage",
     re.compile(r"\b(?:localStorage|sessionStorage)\b"),
     "storage throws in an opaque origin. Keep state in Lit component properties."),

    ("window-open",
     re.compile(r"""window\.open\s*\(|target\s*=\s*["']_blank["']"""),
     "window.open returns null in the sandbox. Render the view inside the app."),

    ("relative-asset",
     re.compile(r"""\b(?:src|href)\s*=\s*["']\.{1,2}/"""),
     "relative URL to an external asset -- there is no <base> in the tile. Use an absolute URL or inline SVG."),

    ("duplicate-connect",
     re.compile(r"\bconnectExtensionHost\s*\("),
     "connectExtensionHost() is already called by the runtime; a second handshake fails. Use this.runQuery()."),

    ("outer-dom-mutation",
     re.compile(r"""\bdocument\.(?:body|documentElement)\.(?:classList|style|setAttribute)\b"""),
     "document.body/documentElement mutation -- leaks or breaks in embedded sandboxes. Scope theme classes to your container: <div class=\"da-container ${this.isDark ? 'dark-theme' : ''}\">"),
]

# Any relative import is a second local file, which 404s after publish: only the
# data-app.js / lit.mjs specifiers are rewritten to hosted URLs.
IMPORT_RE = re.compile(r"""^\s*import\s[^;]*?from\s*["'](\.[^"']*)["']""", re.M)
ID_RE = re.compile(r"""\bid\s*=\s*["']([A-Za-z][\w:.-]*)["']""")


def check(path):
    """Returns a list of (line_no, rule_id, message, snippet)."""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as e:
        return [(0, "unreadable", str(e), "")]

    src = strip_comments(raw)
    raw_lines = raw.splitlines()
    findings = []

    def line_of(pos):
        return src.count("\n", 0, pos) + 1

    for rule_id, pattern, message in RULES:
        for m in pattern.finditer(src):
            ln = line_of(m.start())
            findings.append((ln, rule_id, message, raw_lines[ln - 1].strip()[:110]))

    for m in IMPORT_RE.finditer(src):
        ln = line_of(m.start())
        findings.append((ln, "second-module",
                         f"imports a second local file ({m.group(1)}) -- 404s in the tile. "
                         f"Keep the app to one file.",
                         raw_lines[ln - 1].strip()[:110]))

    seen = {}
    for m in ID_RE.finditer(src):
        seen.setdefault(m.group(1), []).append(line_of(m.start()))
    for elem_id, lines in seen.items():
        if len(lines) > 1:
            findings.append((lines[1], "duplicate-id",
                             f'id="{elem_id}" is used on {len(lines)} elements '
                             f'(lines {", ".join(map(str, lines))}) -- querySelector returns only the first.',
                             raw_lines[lines[1] - 1].strip()[:110]))

    return sorted(findings)


def main(argv=None):
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="app.js file(s) to check")
    args = ap.parse_args(argv)

    total = 0
    for path in args.paths:
        findings = check(path)
        total += len(findings)
        if not findings:
            print(f"✓ {path} — clean")
            continue
        print(f"\n✗ {path} — {len(findings)} issue(s) that would surface only after publish\n")
        for ln, rule_id, message, snippet in findings:
            print(f"  {path}:{ln}  [{rule_id}]")
            print(f"      {message}")
            if snippet:
                print(f"      > {snippet}")
        print()

    if total:
        print(f"{total} issue(s). These do not reproduce in the plain preview — "
              f"fix them before publishing.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
