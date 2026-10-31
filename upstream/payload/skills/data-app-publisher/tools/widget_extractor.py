"""Publish-time widget extraction for Data Apps.

Reads app.js as text (it never runs the app), gives every widget an identity
in the published copy, and works out each widget's saved Looker query the way
data-app.js `_buildQuery()` would. Used by publish-data-app.py; checked against
the real runtime by tests/parity_harness.mjs. See go/data-apps-ca.
"""

from __future__ import annotations

import html as _html
import json
import math
import re
import traceback
import unicodedata
from pathlib import Path


WIDGET_TAGS = ("app-kpi", "app-chart", "app-grid")
# Elements with no closing tag, skipped when tracking which element wraps a widget.
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

# Each widget's attributes as declared in its `static properties` in
# data-app.js (locked by a test): attribute -> (property, conversion, part).
# Conversion is how Lit turns the attribute into the property: "S" string,
# "J" JSON (Array/Object; a value that isn't JSON becomes null), "spark" the
# KPI sparkline converter. Part decides what a value that can't be worked
# out at publish time means: "model"/"explore"/"fields" skip the widget,
# "other" registers without it, "filters" are left out (forwarded live on
# click), "label"/"data" don't affect the saved query. An attribute a widget
# doesn't declare never becomes a property.
_SHARED_ATTRS = {
    "looker-model": ("lookerModel", "S", "model"), "explore": ("explore", "S", "explore"),
    "query": ("query", "J", "fields"), "fields": ("fields", "S", "fields"), "filters": ("filters", "J", "filters"),
}
WIDGET_ATTRS = {
    "app-kpi": {
        **_SHARED_ATTRS, "query-field": ("queryField", "S", "fields"), "sparkline": ("sparkline", "spark", "fields"),
        "label": ("label", "S", "label"), "value": ("value", "S", "data"),
    },
    "app-chart": {
        **_SHARED_ATTRS, "dimensions": ("dimensions", "S", "fields"), "measures": ("measures", "S", "fields"),
        "pivots": ("pivots", "J", "fields"), "pivot-by": ("pivotBy", "S", "fields"),
        "sorts": ("sorts", "J", "other"), "limit": ("limit", "S", "other"),
        "title": ("title", "S", "label"), "data": ("data", "J", "data"),
    },
    "app-grid": {
        **_SHARED_ATTRS, "sorts": ("sorts", "J", "other"), "limit": ("limit", "S", "other"),
        "title": ("title", "S", "label"), "data": ("data", "J", "data"),
    },
}
# Property bindings (`.prop=${…}`) set the property directly, declared or not.
PROP_PARTS = {prop: part for attrs in WIDGET_ATTRS.values() for prop, _, part in attrs.values()}
# Attributes every element maps to a property (HTMLElement.id / .title).
NATIVE_ATTRS = {"id", "title"}
# Keys of a `.query` object, by part; any other key is "other".
QUERY_KEY_PARTS = {
    "model": "model", "explore": "explore", "view": "explore", "fields": "fields",
    "dimensions": "fields", "measures": "fields", "pivots": "fields", "...": "fields",
}
# Parts that belong to the saved query (a failure there is reported).
_QUERY_PARTS = {"model", "explore", "fields", "other"}
# Default query limits and sort direction as declared in `WIDGET_QUERY_DEFAULTS` in data-app.js (locked by a test).
WIDGET_QUERY_DEFAULTS = {
    "chartLimit": "500",
    "gridLimit": "100",
    "kpiLimit": "1",
    "kpiSparklineLimit": "24",
    "kpiSparklineSortDir": "desc",
}

# Placeholders for masked `${…}` bindings: characters from the Unicode
# private-use area, each indexing an entry of the expression store.
EXPR_BASE, EXPR_MAX = 0xE000, 0xF8FF - 0xE000
EXPR_CHAR_RE = re.compile(r"[\uE000-\uF8FF]")
# Pads the rest of a masked binding so offsets don't move; dropped when reading values.
FILLER = "\x00"
# A template inside one of these renders once per item (loops, callbacks).
REPEATED_EXPR_RE = re.compile(r"=>|\bfunction\b|\brepeat\s*\(|\.(?:flatMap|map|forEach)\s*\(")
# A `/` starts a regex literal after these tokens; after `)`, `]`, an
# identifier or a number it is division.
_REGEX_PREV_PUNCT = frozenset("(,=:[!&|?{};+-*%<>~^")
_REGEX_PREV_KEYWORDS = frozenset({
    "return", "typeof", "case", "do", "else", "in", "instanceof", "new",
    "delete", "void", "throw", "yield", "await",
})
# The runtime names unstamped widgets with this prefix; the publisher never does.
LOCAL_ID_PREFIX = "da-local-"


def canonical_query_json(query: dict) -> str:
    """Stable JSON for comparing and de-duplicating queries."""
    return json.dumps(query, sort_keys=True, separators=(",", ":"))


def _convert_attr(value: str, kind: str):
    """Convert a static attribute value the way Lit would for a property of `kind`."""
    if kind == "J":
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    if kind == "spark":
        if value in ("", "true"):
            return True
        if value == "false":
            return False
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return True
        return parsed if isinstance(parsed, list) else True
    return value


class ExtractionResult:
    """What extract_widget_queries found. (Not a dataclass: those break when the
    module is loaded from its file path, as scripts/check-python-compat.py does.)
    """

    def __init__(self, widgets=None, skipped=None, warnings=None, stamped_code=None, descriptors=None, error=None):
        self.widgets = widgets or []          # [{widget_id, title, query}] to register
        self.skipped = skipped or []          # "<widget>: <reason>" with no registered query
        self.warnings = warnings or []        # registered, but the saved query may differ at runtime
        self.stamped_code = stamped_code      # source with ids/keys stamped; None on failure
        self.descriptors = descriptors or []  # inputs for tests/parity_harness.mjs
        self.error = error                    # {type, message, traceback} on a crash


def _to_slug(s: str, max_len: int = 48) -> str:
    """Name slug, matching the runtime's toSlug() (including its UTF-16 length cap)."""
    cleaned = "".join(c if unicodedata.category(c)[0] in ("L", "N") else "-" for c in (s or "").lower())
    return re.sub(r"-+", "-", cleaned).lstrip("-").encode("utf-16-le")[: max_len * 2].decode("utf-16-le", errors="ignore").rstrip("-")


def _normalize_query_payload(query: dict | None) -> dict | None:
    """Port of the runtime's normalizeQueryPayload(): limit as a string, filter
    values as Looker filter expressions."""
    if not query or not isinstance(query, dict):
        return query
    is_unset = lambda v: v is None or (not isinstance(v, bool) and isinstance(v, float) and not math.isfinite(v))
    out = dict(query)
    if "limit" in out:
        lim = out["limit"]
        if not isinstance(lim, bool) and isinstance(lim, float) and not math.isfinite(lim):
            del out["limit"]
        elif lim is not None and not isinstance(lim, str):
            out["limit"] = ("true" if lim else "false") if isinstance(lim, bool) else (str(int(lim)) if isinstance(lim, float) and lim.is_integer() else str(lim))
    if isinstance(out.get("filters"), dict):
        filters: dict[str, str] = {}
        for k, v in out["filters"].items():
            if is_unset(v):
                continue
            if isinstance(v, str):
                filters[k] = v
            elif isinstance(v, bool):
                filters[k] = "Yes" if v else "No"
            elif isinstance(v, list):
                items = [
                    ("Yes" if it else "No") if isinstance(it, bool)
                    else re.sub(r"[\^,]", lambda m: "^" + m.group(0), str(int(it)) if isinstance(it, float) and it.is_integer() else str(it))
                    for it in v if not is_unset(it)
                ]
                if items:
                    filters[k] = ",".join(items)
            else:
                filters[k] = str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
        out["filters"] = filters
    return out


def _regex_allowed(s, j: int) -> bool:
    """Whether the `/` at s[j] starts a regex literal (s may be a str or list)."""
    k = j - 1
    while k >= 0 and s[k] in " \t\r\n":
        k -= 1
    if k < 0:
        return True
    c = s[k]
    if c in _REGEX_PREV_PUNCT:
        return True
    if c.isalnum() or c in "_$":
        end = k + 1
        while k >= 0 and (s[k].isalnum() or s[k] in "_$"):
            k -= 1
        return "".join(s[k + 1 : end]) in _REGEX_PREV_KEYWORDS
    return False


def _skip_regex(s: str, j: int) -> int:
    """Index just past the regex literal starting at s[j] (escapes, classes, flags)."""
    n, i, in_cls = len(s), j + 1, False
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "\n":
            return j + 1  # not a regex after all
        if in_cls:
            if c == "]":
                in_cls = False
        elif c == "[":
            in_cls = True
        elif c == "/":
            i += 1
            while i < n and (s[i].isalnum() or s[i] in "_$"):
                i += 1
            return i
        i += 1
    return j + 1


def _skip_js_expr(s: str, j: int) -> int:
    """Index just past the `}` closing the brace before s[j], skipping strings,
    comments and regex literals."""
    n, depth, sub_str, sub_q = len(s), 1, False, ""
    while j < n and depth > 0:
        sc, nxt = s[j], (s[j + 1] if j + 1 < n else "")
        if sub_str:
            if sc == "\\":
                j += 2
                continue
            if sub_q == "`" and sc == "$" and nxt == "{":
                j = _skip_js_expr(s, j + 2)
                continue
            if sc == sub_q:
                sub_str = False
        elif sc == "/" and nxt in ("/", "*"):
            end = s.find("\n" if nxt == "/" else "*/", j + 2)
            j = n if end < 0 else end + (1 if nxt == "/" else 2)
            continue
        elif sc == "/" and _regex_allowed(s, j):
            j = _skip_regex(s, j)
            continue
        elif sc in ('"', "'", "`"):
            sub_str, sub_q = True, sc
        elif sc in ("{", "}"):
            depth += 1 if sc == "{" else -1
        j += 1
    return j


def _skip_string(s: str, i: int) -> int:
    """Index just past the string or template literal starting at s[i]."""
    q, j, n = s[i], i + 1, len(s)
    while j < n:
        if s[j] == "\\":
            j += 2
            continue
        if q == "`" and s[j] == "$" and j + 1 < n and s[j + 1] == "{":
            j = _skip_js_expr(s, j + 2)
            continue
        if s[j] == q:
            return j + 1
        j += 1
    return n


def _depth_at(s: str, start: int, pos: int) -> int:
    """Brace depth at s[pos], counting from s[start] (comments already blanked)."""
    depth, i = 0, start
    while i < pos:
        c = s[i]
        if c in "'\"`":
            i = _skip_string(s, i)
            continue
        if c == "/" and _regex_allowed(s, i):
            i = _skip_regex(s, i)
            continue
        depth += (c == "{") - (c == "}")
        i += 1
    return depth


def _is_expr_repeated(s: str) -> bool:
    """Whether a JS snippet is inside an unfinished loop or callback. Balanced
    (…) groups are dropped first, so a finished call like `a.map(f)` doesn't count."""
    while (nxt := re.sub(r"\([^()]*\)", "", s)) != s:
        s = nxt
    return bool(REPEATED_EXPR_RE.search(s))


def _strip_comments_and_mask_expressions(src: str):
    """Blank comments and mask attribute `${…}` bindings with placeholder chars.

    Returns (masked, expr_store, repeated_ranges, string_ranges, expr_ranges,
    closed_templates):
    - masked: same length as src, so offsets map 1:1. Each placeholder is a
      private-use char indexing expr_store; private-use chars already in the
      source are stored as string literals so they round-trip.
    - repeated_ranges: html`…` templates that render once per item.
    - string_ranges: plain '…'/"…" strings (markup there is never stamped).
    - expr_ranges: template `${…}` expressions that weren't masked.
    - closed_templates: the span of every html`…` template.
    """
    out, expr_store, repeated_ranges, closed_tpl, string_ranges, expr_ranges = list(src), [], [], [], [], []
    i, n, in_line, in_block, in_str, quote, str_start = 0, len(src), False, False, False, "", 0
    tpl_braces, expr_starts, tpl_frames = [], [], []

    def token(expr: str) -> str:
        """Store `expr` and return the placeholder char that stands for it."""
        if len(expr_store) > EXPR_MAX:
            raise ValueError("app.js has too many template bindings or private-use characters to extract widget queries")
        expr_store.append(expr)
        return chr(EXPR_BASE + len(expr_store) - 1)

    while i < n:
        c, nxt = src[i], (src[i + 1] if i + 1 < n else "")
        if not (in_line or in_block) and "\ue000" <= c <= "\uf8ff":
            out[i] = token(f'"{c}"')
            i += 1
            continue
        if in_line:
            if c == "\n":
                in_line = False
            else:
                out[i] = " "
        elif in_block:
            if c == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                in_block, i = False, i + 2
                continue
            if c != "\n":
                out[i] = " "
        elif in_str:
            if c == "\\":
                i += 2
                continue
            if quote == "`" and src.startswith("<!--", i):
                end = src.find("-->", i + 4)
                end = n if end < 0 else end + 3
                for k in range(i, end):
                    out[k] = "\n" if out[k] == "\n" else " "
                i = end
                continue
            if quote == "`" and c == "$" and nxt == "{":
                prev = "".join(out[max(0, i - 200) : i])
                if re.search(r"=\s*$", prev):
                    # Unquoted binding (attr=${…}): becomes "<placeholder>".
                    j = _skip_js_expr(src, i + 2)
                    tok = f'"{token(src[i + 2 : j - 1])}"'
                    for k in range(i, j):
                        out[k] = tok[k - i] if k - i < len(tok) else ("\n" if out[k] == "\n" else FILLER)
                    i = j
                    continue
                if re.search(r"=\s*[\"'][^\"'<>]*$", prev):
                    # Inside a quoted value (attr="…${…}…"): the placeholder
                    # takes the binding's place and the text around it stays.
                    j = _skip_js_expr(src, i + 2)
                    out[i] = token(src[i + 2 : j - 1])
                    for k in range(i + 1, j):
                        out[k] = "\n" if out[k] == "\n" else FILLER
                    i = j
                    continue
                tpl_braces.append(0)
                expr_starts.append(i + 2)
                in_str, i = False, i + 2
                continue
            if c == quote:
                in_str = False
                if quote == "`" and tpl_frames:
                    frame = tpl_frames.pop()
                    closed_tpl.append((frame["start"], i + 1))
                    if frame["repeated"]:
                        repeated_ranges.append((frame["start"], i))
                elif quote != "`":
                    string_ranges.append((str_start, i))
        elif c == "/" and nxt in ("/", "*"):
            in_line, in_block, out[i] = (nxt == "/"), (nxt == "*"), " "
        elif c == "/" and _regex_allowed(out, i):
            i = _skip_regex(src, i)
            continue
        elif c in ('"', "'", "`"):
            in_str, quote, str_start = True, c, i
            if c == "`":
                repeated = bool(tpl_frames and tpl_frames[-1]["repeated"])
                if not repeated and expr_starts:
                    es = expr_starts[-1]
                    seg = list(out[es:i])
                    for cs, ce in closed_tpl:
                        if cs >= es and ce <= i:
                            seg[cs - es : ce - es] = [" "] * (ce - cs)
                    repeated = _is_expr_repeated("".join(seg))
                tpl_frames.append({"start": i, "repeated": repeated})
        elif tpl_braces:
            if c == "{":
                tpl_braces[-1] += 1
            elif c == "}":
                if tpl_braces[-1] == 0:
                    tpl_braces.pop()
                    expr_ranges.append((expr_starts.pop(), i))
                    in_str, quote = True, "`"
                else:
                    tpl_braces[-1] -= 1
        i += 1
    return "".join(out), expr_store, repeated_ranges, string_ranges, expr_ranges, closed_tpl


def _split_top_level(s: str, sep: str = ",") -> list[str]:
    """Split s on `sep` outside brackets, strings, comments and regex literals."""
    parts, start, i, n, db, dk, dp = [], 0, 0, len(s), 0, 0, 0
    while i < n:
        ch, nxt = s[i], (s[i + 1] if i + 1 < n else "")
        if ch in ("'", '"', "`"):
            i = _skip_string(s, i)
            continue
        if ch == "/" and nxt in ("/", "*"):
            end = s.find("\n" if nxt == "/" else "*/", i + 2)
            i = n if end < 0 else end + (1 if nxt == "/" else 2)
            continue
        if ch == "/" and _regex_allowed(s, i):
            i = _skip_regex(s, i)
            continue
        db += (ch == "{") - (ch == "}")
        dk += (ch == "[") - (ch == "]")
        dp += (ch == "(") - (ch == ")")
        if ch == sep and db == 0 and dk == 0 and dp == 0:
            parts.append(s[start:i])
            start = i + 1
        i += 1
    parts.append(s[start:])
    return parts


def _strip_leading_js_comments(s: str) -> str:
    """s without surrounding whitespace and leading // or /* */ comments."""
    s = s.strip()
    while s.startswith(("//", "/*")):
        end = s.find("\n" if s.startswith("//") else "*/")
        s = "" if end < 0 else s[end + (1 if s.startswith("//") else 2) :].strip()
    return s


def _eval_js_expr(expr: str, app_props: dict, module_consts: dict, allow_partial_query: bool = False, report: dict | None = None):
    """Evaluate the small JS subset widgets use: literals, arrays, objects, this.x, consts.

    Returns (value, failed, reads_state). With allow_partial_query (a widget's
    `.query`), entries that can't be evaluated are left out instead of failing
    the whole object; `report` then collects their keys in report["failed"]
    and the keys that read app state in report["state"], and reads_state means
    "the filters read app state".
    """
    s = _strip_leading_js_comments(expr)
    while s.startswith("(") and s.endswith(")") and len(_split_top_level(s, ")")[0]) == len(s) - 1:
        s = _strip_leading_js_comments(s[1:-1])
    reads_state = bool(re.search(r"\bthis\b", s))
    if not s:
        return None, True, reads_state
    if s in ("true", "false"):
        return (s == "true"), False, reads_state
    if s in ("null", "undefined", "nothing"):
        return None, False, reads_state
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')) or (s.startswith("`") and s.endswith("`") and "${" not in s):
        return re.sub(r"\\(.)", r"\1", s[1:-1]), False, False
    try:
        return (float(s) if "." in s else int(s)), False, False
    except ValueError:
        pass
    if re.match(r"^this\.[A-Za-z_$][\w$]*$", s):
        return (app_props[s[5:]], False, True) if s[5:] in app_props else (None, True, True)
    if re.match(r"^[A-Za-z_$][\w$]*$", s):
        return (module_consts[s], False, False) if s in module_consts else (None, True, False)
    if m_dot := re.match(r"^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$", s):
        parts = m_dot.group(1).split(".")
        if parts[0] == "this":
            cur, ok, rs = app_props, len(parts) > 1 and parts[1] in app_props, True
            if ok:
                cur = app_props[parts[1]]
                parts = parts[2:]
        else:
            cur, ok, rs = module_consts.get(parts[0]), parts[0] in module_consts, False
            parts = parts[1:]
        for p in parts:
            if ok and isinstance(cur, dict):
                cur = cur.get(p)
            else:
                ok = False
        return (cur, False, rs) if ok else (None, True, rs)
    if s.startswith("[") and s.endswith("]"):
        out, any_rs = [], False
        for item in _split_top_level(s[1:-1], ","):
            if not (item_s := _strip_leading_js_comments(item)):
                continue
            val, failed, rs = _eval_js_expr(item_s, app_props, module_consts)
            any_rs = any_rs or rs
            if failed:
                return None, True, any_rs
            out.append(val)
        return out, False, any_rs
    if s.startswith("{") and s.endswith("}"):
        out, filter_rs, any_rs = {}, False, False

        def note(kind: str, key: str):
            if report is not None:
                report.setdefault(kind, []).append(key)

        for entry in _split_top_level(s[1:-1], ","):
            if not (entry_s := _strip_leading_js_comments(entry)):
                continue
            if entry_s.startswith("..."):
                val, failed, rs = _eval_js_expr(entry_s[3:], app_props, module_consts)
                if not failed and isinstance(val, dict):
                    out.update(val)
                    any_rs = any_rs or rs
                    if rs:
                        filter_rs = filter_rs or "filters" in val
                        for k in val:
                            if k != "filters":
                                note("state", k)
                    continue
                if allow_partial_query:
                    note("failed", "...")
                    continue
                return None, True, reads_state
            kv = _split_top_level(entry_s, ":")
            if len(kv) < 2:
                if allow_partial_query:
                    filter_rs = filter_rs or (entry_s == "filters")
                    if entry_s != "filters":
                        note("failed", entry_s)
                    continue
                return None, True, reads_state
            k_raw, v_raw = _strip_leading_js_comments(kv[0]), ":".join(kv[1:]).strip()
            key = k_raw[1:-1] if (k_raw.startswith(("'", '"')) and k_raw.endswith(("'", '"'))) else k_raw
            val, failed, val_state = _eval_js_expr(v_raw, app_props, module_consts)
            if failed:
                if allow_partial_query:
                    if key == "filters":
                        filter_rs = True
                    else:
                        note("failed", key)
                    continue
                return None, True, reads_state
            any_rs = any_rs or val_state
            filter_rs = filter_rs or (key == "filters" and val_state)
            if val_state and key != "filters":
                note("state", key)
            out[key] = val
        return out, False, (filter_rs if allow_partial_query else any_rs)

    # ponytail: support metric-switcher ternaries (cond ? a : b), fallbacks (a || b / a ?? b),
    # equality (a === b), bracket indexing (map[this.selectedMetric].field), and static .find(...)
    q_parts = _split_top_level(s, "?")
    if len(q_parts) >= 2 and not q_parts[0].endswith("?") and not q_parts[1].startswith((".", "?")):
        cond_s = q_parts[0].strip()
        rest_s = "?".join(q_parts[1:])
        colon_parts = _split_top_level(rest_s, ":")
        if len(colon_parts) >= 2:
            c_val, c_fail, c_rs = _eval_js_expr(cond_s, app_props, module_consts)
            t_s, f_s = colon_parts[0].strip(), ":".join(colon_parts[1:]).strip()
            branch_s = t_s if (not c_fail and bool(c_val)) else (t_s if c_fail else f_s)
            b_val, b_fail, b_rs = _eval_js_expr(branch_s, app_props, module_consts)
            if b_fail and c_fail:
                b_val, b_fail, b_rs = _eval_js_expr(f_s, app_props, module_consts)
            return b_val, b_fail, (reads_state or c_rs or b_rs)

    for op in ("??", "||"):
        if op in s:
            parts = _split_top_level(s, op[0])
            # Re-verify top-level double-char operator
            idx_op = 0
            while idx_op < len(s) - 1:
                if s[idx_op : idx_op + 2] == op and len(_split_top_level(s[: idx_op + 1], op[0])) > 1:
                    lhs, rhs = s[:idx_op].strip(), s[idx_op + 2 :].strip()
                    if lhs and rhs:
                        l_val, l_fail, l_rs = _eval_js_expr(lhs, app_props, module_consts)
                        if not l_fail and (l_val is not None if op == "??" else bool(l_val)):
                            return l_val, False, (reads_state or l_rs)
                        r_val, r_fail, r_rs = _eval_js_expr(rhs, app_props, module_consts)
                        return r_val, r_fail, (reads_state or l_rs or r_rs)
                idx_op += 1

    for eq_op in ("===", "!==", "==", "!="):
        if eq_op in s:
            m_eq = re.match(rf"^(.+?)\s*{re.escape(eq_op)}\s*(.+)$", s, re.S)
            if m_eq:
                lv, lf, lrs = _eval_js_expr(m_eq.group(1), app_props, module_consts)
                rv, rf, rrs = _eval_js_expr(m_eq.group(2), app_props, module_consts)
                if not lf and not rf:
                    res_eq = (lv == rv) if eq_op.startswith("=") else (lv != rv)
                    return res_eq, False, (reads_state or lrs or rrs)

    if m_find := re.match(r"^([A-Za-z_$][\w$.]*)\.find\s*\(\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s*=>\s*(.+)\)$", s, re.S):
        arr_val, arr_fail, arr_rs = _eval_js_expr(m_find.group(1), app_props, module_consts)
        param = m_find.group(2) or m_find.group(3)
        pred = m_find.group(4).strip()
        if not arr_fail and isinstance(arr_val, list) and arr_val:
            for item in arr_val:
                pv, pf, _ = _eval_js_expr(pred, app_props, {**module_consts, param: item})
                if not pf and pv:
                    return item, False, True
            return arr_val[0], False, (reads_state or arr_rs)

    if m_idx := re.match(r"^([A-Za-z_$][\w$.]*)\[\s*([^\]]+)\s*\]((?:\??\.[A-Za-z_$][\w$]*)*)$", s):
        base_val, base_fail, base_rs = _eval_js_expr(m_idx.group(1).replace("?.", "."), app_props, module_consts)
        key_val, key_fail, key_rs = _eval_js_expr(m_idx.group(2), app_props, module_consts)
        tail = m_idx.group(3) or ""
        if not base_fail and isinstance(base_val, dict) and base_val:
            cur = base_val.get(str(key_val)) if not key_fail and str(key_val) in base_val else next(iter(base_val.values()))
            for prop in [p for p in re.split(r"\??\.", tail) if p]:
                cur = cur.get(prop) if isinstance(cur, dict) else None
            if cur is not None:
                return cur, False, (reads_state or base_rs or key_rs)
        elif not base_fail and isinstance(base_val, list) and base_val:
            idx_num = int(key_val) if not key_fail and isinstance(key_val, (int, float)) else 0
            cur = base_val[idx_num] if 0 <= idx_num < len(base_val) else base_val[0]
            for prop in [p for p in re.split(r"\??\.", tail) if p]:
                cur = cur.get(prop) if isinstance(cur, dict) else None
            if cur is not None:
                return cur, False, (reads_state or base_rs or key_rs)

    if "?." in s and re.match(r"^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$", s):
        return _eval_js_expr(s.replace("?.", "."), app_props, module_consts)

    return None, True, reads_state


def _value_extent(region: str, pos: int) -> int:
    """End of the literal value starting at region[pos] (pos if it isn't one)."""
    if pos >= len(region):
        return pos
    ch = region[pos]
    if ch == "{":
        return _skip_js_expr(region, pos + 1)
    if ch == "[":
        return len(_split_top_level(region[pos:], "]")[0]) + pos + 1 if "]" in region[pos:] else len(region)
    if ch in ("'", '"', "`"):
        return _skip_string(region, pos)
    m_lit = re.match(r"^(?:true|false|null|-?\d+(?:\.\d+)?)\b", region[pos:])
    return pos + m_lit.end() if m_lit else pos


def _scan_assignments(region: str, target: dict, pat: str, app_props: dict, module_consts: dict) -> None:
    """For each match of `pat` (group 1 = name) followed by a literal, store the
    evaluated literal in target[name]. Values that can't be evaluated are skipped."""
    for m in re.finditer(pat, region):
        name, pos = m.group(1), m.end()
        while pos < len(region) and region[pos].isspace():
            pos += 1
        end = _value_extent(region, pos)
        if end > pos:
            val, failed, _ = _eval_js_expr(region[pos:end], app_props, module_consts)
            if not failed:
                target[name] = val


_IMPORT_RE = re.compile(r"\bimport\s*\{([^}]*)\}\s*from\s*['\"][^'\"]*data-app\.js['\"]")
_CLASS_RE = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$.]*)\s*\{")
_METHOD_RE = re.compile(r"(?:(?:static|async|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{")
_FIELD_ARROW_RE = re.compile(r"(?:static\s+)?(#?[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*")


def _find_app_class(masked: str):
    """(class_start, body_start, body_end) of the class extending the runtime's DataApp.

    Matches `DataApp` or its alias from the data-app.js import; falls back to
    the first class in the file.
    """
    bases = {"DataApp"}
    for m in _IMPORT_RE.finditer(masked):
        for name in m.group(1).split(","):
            parts = name.split()
            if parts and parts[0] == "DataApp":
                bases.add(parts[-1])
    classes = list(_CLASS_RE.finditer(masked))
    if not classes:
        return None
    m = next((c for c in classes if c.group(2) in bases), classes[0])
    return m.start(), m.end(), _skip_js_expr(masked, m.end()) - 1


def _class_methods(s: str, body_start: int, body_end: int) -> dict:
    """{name: (params, start, end)} for methods and arrow-function fields of a class body."""
    methods, p = {}, body_start

    def statement_end(start: int) -> int:
        """End of a class member that isn't a method: the next top-level `;` or newline."""
        by_semi = _split_top_level(s[start:body_end], ";")[0]
        by_line = _split_top_level(s[start:body_end], "\n")[0]
        return start + max(min(len(by_semi), len(by_line)), 1)

    while p < body_end:
        while p < body_end and (s[p].isspace() or s[p] == ";"):
            p += 1
        if p >= body_end:
            break
        m = _METHOD_RE.match(s, p)
        if m and m.end() <= body_end:
            end = _skip_js_expr(s, m.end())
            methods[m.group(1)] = (m.group(2).strip(), m.start(), end)
            p = end
            continue
        m = _FIELD_ARROW_RE.match(s, p)
        if m:
            q = m.end()
            end = _skip_js_expr(s, q + 1) if q < body_end and s[q] == "{" else statement_end(q)
            methods[m.group(1)] = ((m.group(2) if m.group(2) is not None else m.group(3) or "").strip(), m.start(), end)
            p = end
            continue
        p = statement_end(p)  # other member (field, static block, …)
    return methods


def _resolve_fields(q: dict, w: dict, *keys) -> list[str]:
    """Fields the way the runtime's _resolveFields() builds them: a `.query` key
    wins over the widget property, comma strings are split, duplicates dropped."""
    out: list[str] = []
    for k in keys:
        if not (raw := (q.get(k) if isinstance(q, dict) and q.get(k) is not None else w.get(k))):
            continue
        for f in (raw if isinstance(raw, list) else str(raw).split(",")):
            if (t := str(f).strip()) and t not in out:
                out.append(t)
    return out


def _extraction_error(exc: BaseException) -> dict:
    """The `error` of an ExtractionResult for an exception being handled."""
    return {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}


def extract_widget_queries(def_path: str | Path) -> ExtractionResult:
    """Read app.js as text and work out each widget's name and saved query.

    Every widget tag gets an identity in the published copy: `id="…"` when the
    tag renders once, a shared `data-da-key="…"` when it renders many times
    (loops, repeated helpers; the runtime names copies `<key>~<index>`). Each
    widget whose query can be worked out from the source is returned for
    registration under that id or key. Filters that read app state or a loop
    variable are left out of the saved query (the runtime forwards them on
    click). Widgets whose model, explore or fields can't be worked out are
    skipped with a reason. A crash sets `error` and leaves stamped_code None.
    """
    try:
        raw_code = Path(def_path).resolve().read_text(encoding="utf-8")
    except Exception as exc:
        return ExtractionResult(error=_extraction_error(exc))
    if not re.search(rf"<({'|'.join(WIDGET_TAGS)})\b", raw_code, re.I):
        return ExtractionResult(stamped_code=raw_code)
    try:
        return _extract_from_source(raw_code)
    except Exception as exc:
        return ExtractionResult(error=_extraction_error(exc))


def _extract_from_source(raw_code: str) -> ExtractionResult:
    """The work behind extract_widget_queries, in four passes:

    1. Mask the source and read the app's constants (module consts, `this.x`
       set in the constructor, consts at the top of render()).
    2. For each widget tag: decide whether it renders once or many times,
       find the model/explore it inherits, and read its attributes.
    3. Build each widget's query and name.
    4. Stamp every tag, and collect the queries to register, skips and warnings.
    """
    res = ExtractionResult()
    masked, expr_store, repeated_ranges, string_ranges, expr_ranges, closed_tpl = _strip_comments_and_mask_expressions(raw_code)
    # Comment-free source with real strings, for reading constants: masked
    # bindings become blanks; private-use chars from the source come back.
    env_src = "".join(
        ((ch if "\ue000" <= ch <= "\uf8ff" else " ") if EXPR_CHAR_RE.match(mc) else (" " if mc == FILLER else mc))
        for ch, mc in zip(raw_code, masked)
    )

    # 1. App constants.
    app_cls = _find_app_class(masked)
    methods = _class_methods(masked, app_cls[1], app_cls[2]) if app_cls else {}
    module_consts, app_props = {}, {}
    _scan_assignments(env_src[: app_cls[0]] if app_cls else env_src, module_consts,
                      r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*", app_props, module_consts)
    if "constructor" in methods:
        _, c_start, c_end = methods["constructor"]
        ctor_src = env_src[c_start:c_end]
    else:
        ctor_m = re.search(r"\bconstructor\s*\([^)]*\)\s*\{", env_src)
        ctor_src = env_src[ctor_m.end() : _skip_js_expr(env_src, ctor_m.end())] if ctor_m else ""
    _scan_assignments(ctor_src, app_props, r"\bthis\.([A-Za-z_$][\w$]*)\s*=\s*", app_props, module_consts)

    # Constants declared at the top level of render() (const only; a name
    # declared twice is ambiguous and left unresolved).
    render_consts = dict(module_consts)
    if "render" in methods:
        _, r_start, r_end = methods["render"]
        body_start = masked.index("{", r_start) + 1
        region = env_src[body_start:r_end]
        counts: dict[str, int] = {}
        local: dict = {}
        for m in re.finditer(r"\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*", region):
            if _depth_at(region, 0, m.start()) != 0:
                continue
            name = m.group(2)
            counts[name] = counts.get(name, 0) + 1
            if m.group(1) != "const" or counts[name] > 1:
                local.pop(name, None)
                continue
            pos = m.end()
            while pos < len(region) and region[pos].isspace():
                pos += 1
            end = _value_extent(region, pos)
            if end == pos:
                stmt = _split_top_level(region[pos:], ";")[0]
                stmt_line = _split_top_level(stmt, "\n")[0]
                end = pos + (len(stmt_line) if stmt_line.strip() else len(stmt))
            if end > pos:
                val, failed, _ = _eval_js_expr(region[pos:end], app_props, {**render_consts, **local})
                if not failed:
                    local[name] = val
        render_consts.update(local)

    def owner_of(pos: int):
        """App-class method containing `pos`; None if outside every method."""
        if not app_cls:
            return "render"
        for name, (_, start, end) in methods.items():
            if start <= pos < end:
                return name
        return None

    def _call_in_loop(ref: int) -> bool:
        """Whether a call at `ref` sits inside a still-open loop callback.

        Looks back to the start of the innermost open `${…}` (or, outside a
        template, the start of the statement), blanks templates that already
        closed, and lets _is_expr_repeated drop closed (…) groups, so
        `${items.map(() => this.x())}` counts but `${a.map(f)} … this.x()`
        and `cond ? items.map(…) : this.x()` don't.
        """
        open_exprs = [a for a, b in expr_ranges if a <= ref < b]
        start = max(open_exprs) if open_exprs else max(masked.rfind(c, 0, ref) for c in ";{}") + 1
        seg = list(masked[start:ref])
        for cs, ce in closed_tpl:
            if cs >= start and ce <= ref:
                seg[cs - start : ce - start] = [" "] * (ce - cs)
        return _is_expr_repeated("".join(seg))

    def helper_repeated(name: str, seen: frozenset = frozenset()) -> bool:
        """Whether a helper method can render more than once per render()."""
        params = methods[name][0]
        if params:
            return True
        refs = [r.start() for r in re.finditer(rf"\bthis\.{re.escape(name)}(?![\w$])", masked)]
        if len(refs) != 1:
            return True
        ref = refs[0]
        if any(a < ref < b for a, b in repeated_ranges):
            return True
        if _call_in_loop(ref):
            return True
        caller = owner_of(ref)
        if caller is None or caller in seen or caller == name:
            return True
        return False if caller == "render" else helper_repeated(caller, seen | {name})

    def resolve_val(v: str, consts: dict, is_query_prop: bool = False, report: dict | None = None):
        """Evaluate an attribute value: a lone placeholder evaluates its expression;
        text with placeholders is interpolated. Returns (value, failed, reads_state)."""
        v = str(v).replace(FILLER, "")
        s = v.strip()
        if len(s) == 1 and EXPR_CHAR_RE.match(s):
            return _eval_js_expr(expr_store[ord(s) - EXPR_BASE], app_props, consts, allow_partial_query=is_query_prop, report=report)
        any_failed = any_state = False

        def _repl(m):
            nonlocal any_failed, any_state
            r, failed, rs = _eval_js_expr(expr_store[ord(m.group(0)) - EXPR_BASE], app_props, consts)
            any_failed, any_state = any_failed or failed, any_state or rs
            return "" if (r is None or isinstance(r, bool)) else str(r)
        return _html.unescape(EXPR_CHAR_RE.sub(_repl, v)), any_failed, any_state

    widget_re = re.compile(rf"<({'|'.join(WIDGET_TAGS)})\b((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>", re.I)
    tag_re = re.compile(r"<(/?)([a-z][a-z0-9-]*)\b((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>", re.I)
    attr_re = re.compile(r"([.?@]?[A-Za-z0-9_-]+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>\"'/]+)))?")
    ctor_sets = lambda prop: bool(re.search(rf"\bthis\.{prop}\s*=", ctor_src))

    # 2. Widget tags and their attributes.
    app_model, app_explore = app_props.get("lookerModel"), app_props.get("explore")
    app_model_failed = app_model is None and ctor_sets("lookerModel")
    app_explore_failed = app_explore is None and ctor_sets("explore")

    def parse_widget_instance(tag: str, attr_str: str, consts: dict, ctx_model, ctx_model_failed: bool, ctx_explore, ctx_explore_failed: bool, repeated: bool):
        w_props, w_attrs, state_bound, raw_attr_names, bound_props = {}, {}, set(), set(), set()
        failed_parts, state_parts, partial = {}, set(), {}
        has_static_data_attr = has_value_binding = False

        for am in attr_re.finditer(attr_str):
            raw_name = am.group(1)
            if raw_name.startswith("@"):  # event listeners don't affect the query
                continue
            raw_attr_names.add(raw_name)
            has_eq = any(am.group(g) is not None for g in (2, 3, 4))
            raw_val = am.group(2) if am.group(2) is not None else (am.group(3) if am.group(3) is not None else (am.group(4) or ""))
            prefix = raw_name[0] if raw_name[0] in ".?" else ""
            name = raw_name[1:] if prefix else raw_name
            attr = name.lower()
            if prefix == ".":
                prop, part = name, PROP_PARTS.get(name)
            else:
                spec = WIDGET_ATTRS[tag].get(attr)
                prop, part = (spec[0], spec[2]) if spec else (attr, None)
            if has_eq:
                is_q = prop == "query"
                val, eval_failed, reads_state = resolve_val(raw_val, consts, is_q, partial if is_q else None)
            else:
                val, eval_failed, reads_state = (True if prefix == "?" else ""), False, False

            if eval_failed:
                if part == "filters":
                    state_bound.add("filters")
                elif part in _QUERY_PARTS:
                    failed_parts[prop] = part
            elif reads_state:
                if prop in ("filters", "query"):
                    state_bound.add(prop)
                elif part in _QUERY_PARTS:
                    state_parts.add(prop)
                if prop == "query":
                    # `.query=${this.q}` (not an object literal): the whole query
                    # is app state, read from its starting value.
                    tok = raw_val.strip()
                    expr_txt = expr_store[ord(tok) - EXPR_BASE] if len(tok) == 1 and EXPR_CHAR_RE.match(tok) else ""
                    if not _strip_leading_js_comments(expr_txt).startswith("{"):
                        state_parts.add("query")
            if prop == "data" and (val is not None or eval_failed):
                has_static_data_attr = True
            if prop == "value" and (val not in (None, "") or eval_failed):
                has_value_binding = True

            if not eval_failed:
                if prefix == ".":
                    w_props[prop] = val
                    bound_props.add(prop)
                elif prefix == "?":
                    w_props[prop] = bool(val)
                    if val:
                        w_attrs[attr] = ""
                elif val is not None and val is not False:
                    attr_val = "" if not has_eq else str(val)
                    w_attrs[attr] = attr_val
                    if spec:
                        w_props[prop] = _convert_attr(attr_val, spec[1])
                    elif attr in NATIVE_ATTRS:
                        w_props[attr] = attr_val

        failed_parts.update({"query." + k: QUERY_KEY_PARTS.get(k, "other") for k in partial.get("failed", [])})
        state_parts |= {"query." + k for k in partial.get("state", [])}
        explicit_id = str(w_props.get("id") or "").strip()
        has_id_attr = bool(raw_attr_names & {"id", ".id", "?id"})
        short_tag = tag[4:]
        q = w_props.get("query") if isinstance(w_props.get("query"), dict) else {}
        fallback = "-".join(_resolve_fields(q, w_props, "fields", "dimensions", "measures"))
        slug = _to_slug(str(w_props.get("title") or w_props.get("label") or w_props.get("queryField") or fallback or ""))

        groups = set(failed_parts.values())
        if q.get("model") or w_props.get("lookerModel"):
            model, model_failed = q.get("model") or w_props.get("lookerModel"), False
        elif "model" in groups:
            model, model_failed = None, True
        elif ctx_model or ctx_model_failed:
            model, model_failed = ctx_model, ctx_model_failed
        else:
            model, model_failed = app_model, app_model_failed
        model_defaulted = not model and not model_failed
        model = model or (None if model_failed else "basic_ecomm")
        if q.get("explore") or q.get("view") or w_props.get("explore"):
            view, view_failed = q.get("explore") or q.get("view") or w_props.get("explore"), False
        elif "explore" in groups:
            view, view_failed = None, True
        elif ctx_explore or ctx_explore_failed:
            view, view_failed = ctx_explore, ctx_explore_failed
        else:
            view, view_failed = app_explore, app_explore_failed
        unresolved = [g for g, bad in (("model", model_failed), ("explore", view_failed), ("fields", "fields" in groups)) if bad]
        dropped = sorted(p.split(".", 1)[-1] for p, part in failed_parts.items() if part == "other")
        stateful = sorted({p.split(".", 1)[-1] for p in state_parts} - {"filters"})

        raw_built = None
        if short_tag == "kpi":
            fields = _resolve_fields(q, w_props, "fields", "dimensions", "measures")
            if (qf := w_props.get("queryField")) and qf not in fields:
                fields.append(qf)
            spark = w_props.get("sparkline")
            has_spark = spark is not None and spark is not False and str(spark).lower() != "false"
            if fields:
                if has_spark and len(fields) > 1:
                    raw_built = {"model": model, "view": view, "fields": fields, "filters": q.get("filters") or w_props.get("filters") or {}, "sorts": q.get("sorts") or [f"{fields[0]} {WIDGET_QUERY_DEFAULTS['kpiSparklineSortDir']}"], "limit": q.get("limit") or WIDGET_QUERY_DEFAULTS["kpiSparklineLimit"]}
                else:
                    raw_built = {"model": model, "view": view, "fields": [qf or fields[0]], "filters": q.get("filters") or w_props.get("filters") or {}, "limit": WIDGET_QUERY_DEFAULTS["kpiLimit"]}
            skip_fetch = (w_props.get("value") not in (None, "") or has_value_binding) and not (has_spark and len(fields) > 1)
        else:
            fields = _resolve_fields(q, w_props, *(["fields", "dimensions", "pivots", "pivotBy", "measures"] if short_tag == "chart" else ["fields"]))
            if fields:
                raw_built = {"model": model, "view": view, "fields": fields, "filters": q.get("filters") or w_props.get("filters") or {}, "limit": q.get("limit") or w_props.get("limit") or (WIDGET_QUERY_DEFAULTS["chartLimit"] if short_tag == "chart" else WIDGET_QUERY_DEFAULTS["gridLimit"])}
                if sorts := (q.get("sorts") or w_props.get("sorts")):
                    raw_built["sorts"] = sorts
            skip_fetch = bool(w_props.get("data")) and not bool(view)

        has_live_explore = bool(q.get("explore") or q.get("view") or ctx_explore or app_explore or w_props.get("explore"))
        return {
            "tag": tag, "w": w_props, "attrs": w_attrs, "raw_attr_names": raw_attr_names,
            "ctx_model": ctx_model, "ctx_model_failed": ctx_model_failed,
            "ctx_explore": ctx_explore, "ctx_explore_failed": ctx_explore_failed,
            "explicit_id": explicit_id, "has_id_attr": has_id_attr, "repeated": repeated,
            "keyed": repeated or (has_id_attr and not explicit_id),
            "has_static_data_attr": has_static_data_attr, "has_value_binding": has_value_binding,
            "state_bound": state_bound, "failed_parts": failed_parts, "state_parts": state_parts, "bound_props": bound_props,
            "base_id": f"da-{short_tag}-{slug}" if slug else f"da-{short_tag}", "has_slug": bool(slug),
            "model_defaulted": model_defaulted, "unresolved": unresolved, "dropped": dropped, "stateful": stateful,
            "raw_built": raw_built, "is_static": (has_static_data_attr and not has_live_explore) or (not has_static_data_attr and skip_fetch),
        }

    def _find_static_map_loop(pos: int, consts: dict):
        """If `pos` sits inside a single `.map((item[, idx]) => html`…`)` over a
        static list (not a `this.x` reactive property), return (items, item_param, idx_param)."""
        enclosing = [(a, b) for a, b in expr_ranges if a <= pos < b]
        if not enclosing:
            return None
        es, eb = max(enclosing, key=lambda r: r[0])
        if any(ra < es < rb for ra, rb in repeated_ranges):
            return None
        enclosing_tpl = [(ts, te) for ts, te in closed_tpl if es < ts <= pos < te <= eb]
        hdr_end = max(enclosing_tpl, key=lambda r: r[0])[0] if enclosing_tpl else pos
        seg = list(env_src[es:hdr_end])
        for cs, ce in closed_tpl:
            if cs >= es and ce <= hdr_end:
                seg[cs - es : ce - es] = [" "] * (ce - cs)
        header = "".join(seg)
        map_matches = list(re.finditer(r"\.map\s*\(\s*(?:\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*\)|([A-Za-z_$][\w$]*))\s*=>", header))
        if len(map_matches) != 1:
            return None
        mm = map_matches[0]
        after = header[mm.end() :]
        if _is_expr_repeated(after) or re.search(r"\?|&&|\|\||\bif\b", after):
            return None
        before = header[: mm.start()].rstrip()
        if not before:
            return None
        if before.endswith("]"):
            start = next((k for k in range(len(before) - 1, -1, -1) if before[k] == "[" and _value_extent(before, k) == len(before)), -1)
            if start < 0:
                return None
            iter_expr = before[start:]
        else:
            m_id = re.search(r"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$", before)
            if not m_id:
                return None
            iter_expr = m_id.group(1)
        if re.match(r"^this\b", iter_expr):
            return None
        val, failed, reads_state = _eval_js_expr(iter_expr, app_props, consts)
        if failed or reads_state or not isinstance(val, list) or not val:
            return None
        item_p = mm.group(1) or mm.group(3)
        idx_p = mm.group(2)
        return val, item_p, idx_p

    widgets = []
    for m in widget_re.finditer(masked):
        tag, attr_str = m.group(1).lower(), re.sub(r"/\s*$", "", m.group(2))
        if any(a <= m.start() < b for a, b in string_ranges):
            res.skipped.append(f"<{tag}> at offset {m.start()}: widget markup in a plain string, not a template; not stamped")
            continue
        owner = owner_of(m.start())
        repeated = (any(a < m.start() < b for a, b in repeated_ranges)
                    or owner is None
                    or (owner != "render" and owner in methods and helper_repeated(owner)))
        consts = render_consts if owner == "render" else module_consts

        stack = []
        for tm in tag_re.finditer(masked[: m.start()]):
            close, t_name, t_attrs = tm.group(1), tm.group(2).lower(), tm.group(3)
            if t_name in WIDGET_TAGS or t_name in VOID_TAGS:
                continue
            if close:
                for idx in range(len(stack) - 1, -1, -1):
                    if stack[idx]["tag"] == t_name:
                        del stack[idx:]
                        break
            elif not t_attrs.strip().endswith("/"):
                entry = {"tag": t_name}
                for key, attr in (("model", "looker-model"), ("explore", "explore")):
                    am = re.search(rf'\b{attr}\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', t_attrs, re.I)
                    if am:
                        val, failed, _ = resolve_val(am.group(1) if am.group(1) is not None else am.group(2), consts)
                        entry[key] = None if failed else val
                        entry[key + "_failed"] = failed
                stack.append(entry)

        def nearest(key):
            """(value, failed) of the closest enclosing element that sets `key`."""
            for s_entry in reversed(stack):
                if s_entry.get(key + "_failed"):
                    return None, True
                if s_entry.get(key):
                    return s_entry[key], False
            return None, False

        ctx_model, ctx_model_failed = nearest("model")
        ctx_explore, ctx_explore_failed = nearest("explore")
        item = parse_widget_instance(tag, attr_str, consts, ctx_model, ctx_model_failed, ctx_explore, ctx_explore_failed, repeated)
        item["m"] = m
        item["unrolled"] = None
        if repeated and (owner == "render" or (owner in methods and not helper_repeated(owner))):
            loop_info = _find_static_map_loop(m.start(), consts)
            if loop_info is not None:
                loop_items, item_p, idx_p = loop_info
                copies = []
                for idx_val, elem_val in enumerate(loop_items):
                    iter_consts = {**consts, item_p: elem_val}
                    if idx_p:
                        iter_consts[idx_p] = idx_val
                    copies.append(parse_widget_instance(tag, attr_str, iter_consts, ctx_model, ctx_model_failed, ctx_explore, ctx_explore_failed, True))
                item["unrolled"] = copies
        widgets.append(item)

    # Two widgets with the same author id can't both own it: give each its
    # own key (the runtime then names them <key>~0) and warn.
    explicit_counts: dict[str, int] = {}
    for it in widgets:
        if it["explicit_id"] and not it["keyed"]:
            explicit_counts[it["explicit_id"]] = explicit_counts.get(it["explicit_id"], 0) + 1
    for it in widgets:
        if it["explicit_id"] and not it["keyed"] and explicit_counts[it["explicit_id"]] > 1:
            it["keyed"] = it["duplicate_id"] = True

    # Names: explicit ids on single-render widgets are reserved first; every
    # other widget gets da-<tag>-<slug>, numbered -1, -2 across ALL widgets
    # sharing a base, in source order.
    taken = {it["explicit_id"] for it in widgets if it["explicit_id"] and not it["keyed"]}
    for it in widgets:
        if it["explicit_id"] and not it["keyed"]:
            it["wid"] = it["explicit_id"]
            continue
        peers = [p for p in widgets if p["base_id"] == it["base_id"] and not (p["explicit_id"] and not p["keyed"])]
        if len(peers) == 1 and it["has_slug"] and it["base_id"] not in taken:
            it["wid"] = it["base_id"]
        else:
            n_idx = peers.index(it) + 1
            while (cand := f"{it['base_id']}-{n_idx}") in taken:
                n_idx += 1
            it["wid"] = cand
        taken.add(it["wid"])

    # 4. Stamp, register, skip, warn.
    captured_by_id, out_parts, last_idx = {}, [], 0

    def _normalized_entry_query(entry: dict) -> dict | None:
        if entry["is_static"] or entry["unresolved"]:
            return None
        rb = entry["raw_built"]
        if not rb or not rb.get("model") or not rb.get("view") or not rb.get("fields"):
            return None
        normalized = _normalize_query_payload(rb) or {}
        ew = entry["w"]
        eq = ew.get("query") if isinstance(ew.get("query"), dict) else {}
        filter_source = "query" if (entry["raw_attr_names"] & {"query", ".query"}) and (eq.get("filters") or "query" in entry["state_bound"]) else "filters"
        if filter_source in entry["state_bound"] or not normalized.get("filters"):
            normalized.pop("filters", None)
        return normalized

    def _register_entry(entry: dict, target_wid: str, emit_descriptor: bool):
        ew = entry["w"]
        elabel = str(ew.get("title") or ew.get("label") or ew.get("queryField") or target_wid)
        ename = f"{target_wid} ({elabel})"
        if entry["is_static"]:
            res.skipped.append(f"{ename}: static data")
            return
        if entry["unresolved"]:
            where = "comes from a loop variable or helper argument" if entry["repeated"] else "can't be worked out at publish time"
            res.skipped.append(f"{ename}: {' and '.join(entry['unresolved'])} {where}")
            return
        normalized = _normalized_entry_query(entry)
        if normalized is None:
            res.skipped.append(f"{ename}: missing explore or fields")
            return

        if target_wid in captured_by_id:
            if canonical_query_json(captured_by_id[target_wid]["query"]) != canonical_query_json(normalized):
                res.skipped.append(f"{ename}: duplicate widget id collision")
            return
        if entry["dropped"]:
            res.warnings.append(f"{ename}: registered without {', '.join(entry['dropped'])} (can't be worked out at publish time)")
        if entry["stateful"]:
            res.warnings.append(f"{ename}: {', '.join(entry['stateful'])} read app state; Explore opens the published value")
        captured_by_id[target_wid] = {"widget_id": target_wid, "title": str(ew.get("title") or ew.get("label") or ew.get("queryField") or ""), "query": normalized}
        if entry["model_defaulted"]:
            captured_by_id[target_wid]["model_defaulted"] = True

        if emit_descriptor and not entry["keyed"] and not entry["dropped"] and not entry["stateful"]:
            desc_props = {k: ew[k] for k in entry["bound_props"] if k in ew}
            if "filters" not in normalized:
                desc_props.pop("filters", None)
                if isinstance(desc_props.get("query"), dict):
                    desc_props["query"] = {k: v for k, v in desc_props["query"].items() if k != "filters"}
            res.descriptors.append({
                "widget_id": target_wid, "base_id": entry["base_id"], "has_slug": entry["has_slug"], "explicit": bool(entry["explicit_id"]),
                "tag": entry["tag"], "attrs": dict(entry["attrs"]), "props": desc_props,
                "ancestor_model": entry["ctx_model"], "ancestor_explore": entry["ctx_explore"],
                "app_model": app_model, "app_explore": app_explore, "query": normalized,
            })

    for it in widgets:
        w, m, wid = it["w"], it["m"], it["wid"]
        label = str(w.get("title") or w.get("label") or w.get("queryField") or wid)
        name = f"{wid} ({label})"

        # Stamp every widget, whether or not its query gets registered.
        tag_len = len(m.group(1)) + 1
        out_parts.append(raw_code[last_idx : m.start() + tag_len])
        if it["keyed"]:
            if "data-da-key" not in it["raw_attr_names"]:
                out_parts.append(f' data-da-key="{wid}"')
        elif not it["has_id_attr"]:
            out_parts.append(f' id="{wid}"')
        last_idx = m.start() + tag_len

        if it["explicit_id"].startswith(LOCAL_ID_PREFIX):
            res.warnings.append(f"{name}: ids starting with '{LOCAL_ID_PREFIX}' are reserved for unpublished widgets")
        if it.get("duplicate_id"):
            res.warnings.append(f"{name}: id '{it['explicit_id']}' is used by more than one widget; this one is registered as {wid}")
        elif it["keyed"] and it["explicit_id"]:
            res.warnings.append(f"{name}: id '{it['explicit_id']}' renders more than once; copies are named {wid}~<index>")

        unrolled = it.get("unrolled")
        if unrolled:
            unrolled_qs = [q for q in (_normalized_entry_query(u) for u in unrolled) if q is not None]
            if unrolled_qs and (it["unresolved"] or len({canonical_query_json(q) for q in unrolled_qs}) > 1):
                for idx_u, u_entry in enumerate(unrolled):
                    _register_entry(u_entry, f"{wid}~{idx_u}", False)
                continue

        _register_entry(it, wid, True)

    out_parts.append(raw_code[last_idx:])
    res.widgets = list(captured_by_id.values())
    res.stamped_code = "".join(out_parts)
    return res
