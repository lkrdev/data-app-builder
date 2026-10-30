#!/usr/bin/env python3
"""
Local development server + Looker query proxy for Lit Data Apps.

Used during Data App authoring to host local assets,
scan app directories (`/api/apps`), and proxy Looker queries (`POST /api/query`).

Responsibilities:
  - Serve static files out of the project root for `preview-server/index.html`.
  - Expose `POST /api/query` — proxies inline queries to Looker with server-side authentication.
  - Expose `GET /api/apps` — discovers all Data Apps under `apps/` and `examples/`.

Foreground vs Background Execution:
  - Developers / Humans: run `make start` or `python3 dist/preview-server/serve.py [apps/<name>/app.js]` directly.
    This runs in the foreground, streams live request logging, and cleanly exits on Ctrl+C.
  - AI Agents / Scripts: run `python3 skills/data-app-previewer/tools/start-preview.py [apps/<name>/app.js]`.
    This launches `serve.py` as a detached daemon process, returning control immediately to the caller.

Run:  make start (or python3 dist/preview-server/serve.py [apps/<name>/app.js])
URL:  http://localhost:8765/preview-server/
"""

import argparse
import errno
import ipaddress
import json
import math
import os
import re
import signal
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

def _find_repo_root(start_path):
    curr = start_path.resolve()
    # 1. Developer checkout: <repo>/dist/preview-server, mirroring bootstrap.sh
    parent = curr.parent
    if parent.name == "dist" and (
        (parent.parent / "scripts" / "publish.sh").is_file()
        or (parent.parent / ".git").is_dir()
    ):
        return parent.parent
    # 2. Customer install: first config file going up
    c = curr
    while c != c.parent:
        if (c / "data-apps-config.json").is_file() or (c / "looker-config.json").is_file():
            return c
        c = c.parent
    return curr.parent

ROOT = _find_repo_root(Path(__file__).parent)
CONFIG_PATH = ROOT / "data-apps-config.json"

# Config is loaded on first use, not at import. Everything in this module that
# doesn't touch Looker -- the error-shaping helpers, the fan-out detector, the
# request handler -- is importable and unit-testable without credentials on
# disk. Exiting at import time meant `import serve` killed the interpreter,
# which is how the test suite failed in CI while passing on a dev machine.
_config = None


def get_config():
    """Looker credentials. Loads from environment variables (LOOKERSDK_BASE_URL / LOOKER_BASE_URL,
    LOOKERSDK_CLIENT_ID / LOOKER_CLIENT_ID, LOOKERSDK_CLIENT_SECRET / LOOKER_CLIENT_SECRET)
    or data-apps-config.json. Raises SystemExit when credentials cannot be resolved."""
    global _config
    if _config is None:
        cfg = {}
        if CONFIG_PATH.exists():
            try:
                cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            except Exception:
                cfg = {}

        base_url = (os.environ.get("LOOKERSDK_BASE_URL") or
                    os.environ.get("LOOKER_BASE_URL") or
                    cfg.get("base_url") or
                    cfg.get("looker_instance_url"))
        client_id = (os.environ.get("LOOKERSDK_CLIENT_ID") or
                     os.environ.get("LOOKER_CLIENT_ID") or
                     cfg.get("client_id"))
        client_secret = (os.environ.get("LOOKERSDK_CLIENT_SECRET") or
                         os.environ.get("LOOKER_CLIENT_SECRET") or
                         cfg.get("client_secret"))

        if not (base_url and client_id and client_secret):
            sys.stderr.write(f"error: Looker credentials not found.\n")
            sys.stderr.write("Please set LOOKERSDK_BASE_URL, LOOKERSDK_CLIENT_ID, LOOKERSDK_CLIENT_SECRET in your environment\n")
            sys.stderr.write(f"or create {CONFIG_PATH} via scripts/bootstrap.sh.\n")
            raise SystemExit(1)

        cfg["base_url"] = str(base_url).rstrip("/")
        cfg["client_id"] = str(client_id)
        cfg["client_secret"] = str(client_secret)
        _config = cfg
    return _config


def get_base_url():
    return get_config()["base_url"].rstrip("/")


PORT = int(os.environ.get("PORT", 8765))
# Bind to localhost by default. The preview server holds Looker API
# credentials in memory and proxies queries on the customer's behalf;
# we don't want it reachable from anyone else on the LAN. Pass
# `--host 0.0.0.0` if you genuinely need cross-device preview.
DEFAULT_HOST = os.environ.get("HOST", "127.0.0.1")

# What we actually bound, filled in by main(). The request guards need it to
# tell a request aimed at this server from one aimed at a name that merely
# resolves here (DNS rebinding).
BIND_HOST = DEFAULT_HOST
BIND_PORT = None

# Hostnames that can only ever mean this machine. A name outside this set can
# be pointed at 127.0.0.1 by whoever controls its DNS, which is the whole
# rebinding trick; an IP literal cannot.
LOOPBACK_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "[::1]"}

# LAN mode (`--host 0.0.0.0`) has no single legitimate name, so any extra
# hostname the operator expects has to be named explicitly.
EXTRA_ALLOWED_HOSTS = {
    h.strip().lower()
    for h in os.environ.get("PREVIEW_ALLOWED_HOSTS", "").split(",")
    if h.strip()
}

# Cap on /api/query POST body size. Inline Looker query JSON is tiny
# (typically <100 KB); 5 MB is ~50× the largest realistic payload and
# stops a malformed Content-Length from triggering a huge allocation.
MAX_BODY = 5 * 1024 * 1024

ROOT_RESOLVED = ROOT.resolve()

# Access-token cache. Looker tokens are typically valid for an hour;
# refresh ~60s before expiry to dodge clock skew.
_token = {"access_token": None, "expires_at": 0.0}


def _split_host_header(host):
    """('localhost:8765') -> ('localhost', '8765'). Handles [::1]:8765."""
    if host.startswith("["):
        hostname, _, rest = host.partition("]")
        return hostname + "]", rest.lstrip(":")
    hostname, _, port = host.partition(":")
    return hostname, port


def host_is_ours(host):
    """Is this Host header naming *this* server, rather than a name that
    happens to resolve to it? A credentialed proxy that answers to any name is
    reachable by DNS rebinding from a page the developer merely visited."""
    if not host:
        return False
    hostname, port = _split_host_header(host.strip().lower())
    # In remote development (e.g. Cloudtop with SSH or IDE port-forwarding via
    # Jetski or VS Code), the local client forwarded port often differs from
    # BIND_PORT (e.g. client localhost:8766 forwarded to remote 8765 when local
    # 8765 is occupied). Loopback hostnames cannot be reached via DNS rebinding
    # (which requires an external domain name), and cross-origin attacks are
    # separately blocked by check_same_origin() requiring Origin == Host.
    # We accept BIND_PORT, standard default preview ports (8765, 8766), tunnel
    # forward offsets (BIND_PORT + 1..10), and explicit PREVIEW_ALLOWED_PORTS.
    allowed_ports = {str(BIND_PORT), str(PORT), "8765", "8766"} if BIND_PORT is not None else set()
    if BIND_PORT is not None:
        try:
            base_port = int(BIND_PORT)
            allowed_ports.update(str(base_port + offset) for offset in range(1, 11))
        except (ValueError, TypeError):
            pass
    extra_ports = {p.strip() for p in os.environ.get("PREVIEW_ALLOWED_PORTS", "").split(",") if p.strip()}
    allowed_ports |= extra_ports
    if BIND_PORT is not None and port and port not in allowed_ports:
        return False
    if hostname in LOOPBACK_HOSTNAMES:
        return True
    if hostname in EXTRA_ALLOWED_HOSTS:
        return True
    if BIND_HOST in ("0.0.0.0", "::", ""):
        # Opt-in LAN mode. An IP literal is safe -- rebinding needs a name.
        try:
            ipaddress.ip_address(hostname.strip("[]"))
            return True
        except ValueError:
            return False
    return False


def check_same_origin(headers):
    """Returns None when the request demonstrably came from the preview page,
    otherwise an error envelope.

    This is an allowlist. A proxy holding Looker credentials that answers
    anything it cannot positively identify is one trick away from handing a
    developer's warehouse to a page they happened to open, so a request with
    neither Origin nor Sec-Fetch-Site is refused rather than assumed friendly.
    """
    host = headers.get("Host") or ""
    if not host_is_ours(host):
        return _error_envelope(
            error_type="forbidden_host",
            message=f"Unexpected Host header: {host or '(none)'}",
            hint="The preview server only answers to its own address. A name "
                 "that resolves here but is not localhost is refused, because "
                 "that is how DNS rebinding reaches a local port.",
            suggested_action="Open the preview at http://localhost:8765/preview-server/, "
                             "or set PREVIEW_ALLOWED_HOSTS for a deliberate hostname.",
        )

    origin = headers.get("Origin")
    if origin:
        if origin.lower() in (f"http://{host.lower()}", f"https://{host.lower()}"):
            return None
        return _error_envelope(
            error_type="forbidden_origin",
            message=f"Forbidden origin: {origin}",
            hint="Queries must come from the preview page itself. Another page "
                 "on localhost is still another origin, and is refused.",
            suggested_action="Use the preview server's own page at "
                             "http://localhost:8765/preview-server/.",
        )

    if headers.get("Sec-Fetch-Site") == "same-origin":
        return None

    return _error_envelope(
        error_type="forbidden_unverified",
        message="Request carries neither Origin nor Sec-Fetch-Site: same-origin.",
        hint="This endpoint runs Looker queries with the developer's API "
             "credentials, so it answers only requests it can positively place "
             "on its own page. Browsers send these headers; a script has to "
             "set Origin explicitly.",
        suggested_action="Call it from the preview page, or send "
                         "Origin: http://localhost:8765 from a script.",
    )


# TLS trust for outbound Looker API calls. We build one context up front and
# pass it to every urlopen() instead of relying on the implicit default,
# because the default context's trust store depends entirely on how the end
# user's Python was installed — and one common install has an empty store:
#
#   - python.org macOS builds ship their own OpenSSL and do NOT read the
#     system keychain; the CA store is empty until the bundled
#     "Install Certificates.command" is run. If it never was, every HTTPS
#     call fails with CERTIFICATE_VERIFY_FAILED (unable to get local issuer).
#   - Slim/base Docker images and some minimal Linux installs can likewise
#     lack the `ca-certificates` package, leaving an empty store.
#
# Homebrew Python, system Python on most Linux distros, and Windows are
# already fine (they find a populated store), so for them this is a no-op.
# We only *add* fallbacks — SSL_CERT_FILE / SSL_CERT_DIR still override via
# OpenSSL — so a correctly configured host is never overridden, and a
# misconfigured one degrades to certifi (if installed) or a known system
# bundle rather than a hard failure.
def _make_ssl_context():
    ctx = ssl.create_default_context()
    # get_ca_certs() is empty when the default store loaded nothing (the
    # python.org / bare-container case). It can also read empty on hosts whose
    # trust comes from a hashed cert *directory*; the fallback below is a
    # harmless no-op there, so this stays a safe, additive check.
    if not ctx.get_ca_certs():
        try:
            import certifi  # best cross-platform source when it's installed
            ctx.load_verify_locations(certifi.where())
        except Exception:
            # Well-known system bundles: macOS (LibreSSL), Debian/Ubuntu,
            # RHEL/Fedora, Alpine.
            for path in (
                "/etc/ssl/cert.pem",
                "/etc/ssl/certs/ca-certificates.crt",
                "/etc/pki/tls/certs/ca-bundle.crt",
            ):
                if os.path.exists(path):
                    ctx.load_verify_locations(path)
                    break
    # A Looker instance behind a private CA — a local dev instance, or an
    # internal deployment — serves a certificate this store has no reason to
    # trust, and such certs sometimes carry a key below OpenSSL's default
    # security level. Point LOOKER_CA_BUNDLE at that certificate to trust it.
    # Verification stays on: the cert is added as an anchor, never bypassed.
    #
    # This context is never installed as the process default — it is passed
    # explicitly to the Looker calls that need it — so the lowered cipher
    # floor cannot reach a host that didn't opt into it.
    _extra_ca = os.environ.get("LOOKER_CA_BUNDLE")
    if _extra_ca and os.path.exists(_extra_ca):
        ctx.load_verify_locations(cafile=_extra_ca)
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    return ctx


_SSL_CTX = _make_ssl_context()


def login():
    now = time.time()
    if _token["access_token"] and now < _token["expires_at"] - 60:
        return _token["access_token"]
    body = urllib.parse.urlencode(
        {"client_id": get_config()["client_id"], "client_secret": get_config()["client_secret"]}
    ).encode()
    req = urllib.request.Request(
        f"{get_base_url()}/api/4.0/login", data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as resp:
        data = json.loads(resp.read())
    _token["access_token"] = data["access_token"]
    _token["expires_at"] = now + float(data["expires_in"])
    return _token["access_token"]


def _normalize_query_payload(query):
    """Coerce query filter values and limit to strings so Looker's
    queries_controller.rb validator does not reject non-string filter values
    with HTTP 422 ('filter values must be strings').

    Mirrors normalizeQueryPayload in runtime/data-app.js: list items escape ^
    and , so a comma inside an item is not read as a separator (other filter
    syntax such as % and _ wildcards or a leading - still applies), and None,
    NaN, and infinite values, including a non-finite limit, are left out."""
    if not isinstance(query, dict):
        return query

    def unset(v):
        return v is None or (isinstance(v, float) and not math.isfinite(v))

    out = dict(query)
    if isinstance(out.get("limit"), float) and not math.isfinite(out["limit"]):
        del out["limit"]
    elif out.get("limit") is not None and not isinstance(out["limit"], str):
        out["limit"] = str(out["limit"])
    raw_filters = out.get("filters")
    if isinstance(raw_filters, dict):
        normalized = {}
        for k, v in raw_filters.items():
            if unset(v):
                continue
            if isinstance(v, str):
                normalized[k] = v
            elif isinstance(v, bool):
                normalized[k] = "Yes" if v else "No"
            elif isinstance(v, (list, tuple)):
                items = [
                    ("Yes" if item else "No") if isinstance(item, bool)
                    else str(item).replace("^", "^^").replace(",", "^,")
                    for item in v
                    if not unset(item)
                ]
                if items:
                    normalized[k] = ",".join(items)
            else:
                normalized[k] = str(v)
        out["filters"] = normalized
    return out


def run_inline_query(query):
    """POST a Looker inline query, return parsed JSON rows."""
    token = login()
    normalized = _normalize_query_payload(query)
    body = json.dumps(normalized).encode()
    req = urllib.request.Request(
        f"{get_base_url()}/api/4.0/queries/run/json",
        data=body, method="POST",
        headers={
            "Authorization": f"token {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as resp:
        return json.loads(resp.read())


# Structured error envelope. Returned to the runtime (and surfaced in the
# tile error card) AND read by AI-agent authoring loops — the `hint` field
# is the agent's chance to self-correct without a round trip to the user.
# We deliberately do NOT include the raw query in the response: serve.py
# is a server-side proxy with credentials, and echoing the query (model,
# view, fields, filters) back to the browser would surface LookML field
# names into network responses that a developer-tools observer can read.
# The agent reading errors does so via publish-data-app.py's stderr
# ERROR_ENVELOPE_JSON line, not via /api/query.
def _error_envelope(error_type, message, hint, suggested_action):
    return {
        "error_type": error_type,
        "message": message,
        "hint": hint,
        "suggested_action": suggested_action,
    }


def _detect_fan_out_risk(query):
    """Detect if a query attempts to combine measures/fields from multiple distinct
    UNNESTed array views (e.g. *.line_details.* and *.branch_details.*).
    Cross-joining sibling unnested arrays causes massive cartesian fan-out
    and 30s BigQuery gateway timeouts."""
    fields = query.get("fields", [])
    if not isinstance(fields, list) or len(fields) < 2:
        return None

    # Look for view prefixes with double underscores (e.g. view__array_1 and view__array_2)
    array_views = set()
    for f in fields:
        parts = str(f).split(".")
        if len(parts) >= 2:
            view = parts[0]
            if "__" in view:
                base, sub = view.rsplit("__", 1)
                array_views.add((base, sub))

    # Check if multiple different sub-arrays exist for the same base view
    bases = {}
    for base, sub in array_views:
        bases.setdefault(base, set()).add(sub)

    for base, subs in bases.items():
        if len(subs) > 1:
            conflicting = [f"{base}__{s}" for s in sorted(subs)]
            return _error_envelope(
                error_type="fan_out_risk",
                message=f"Query combines fields from conflicting unnested array views: {', '.join(conflicting)}",
                hint="In LookML/BigQuery, cross-joining measures from multiple unnested array views causes massive cartesian SQL fan-out and query timeouts. Split these measures into separate single-view chart/KPI queries instead.",
                suggested_action=f"Split query: query {conflicting[0]} and {conflicting[1]} in separate widgets.",
            )
    return None


LOOKER_NOT_FOUND_MSG = "not found"
SINATRA_NOT_FOUND_MARKER = "sinatra::notfound"
LOOKER_ROLE_ERR_DOC_PATH = "/r/err/"


def _is_role_denied_404(code, lowered):
    """Return True when a 404 response matches Looker's JSON authorize! denial
    rather than an unrouted endpoint, disabled feature flag, or HTML gateway 404."""
    return (
        code == 404
        and '"message"' in lowered
        and LOOKER_NOT_FOUND_MSG in lowered
        and SINATRA_NOT_FOUND_MARKER not in lowered
        and (LOOKER_ROLE_ERR_DOC_PATH in lowered or "documentation_url" not in lowered)
    )


def _shape_looker_error(code, raw_body):
    """Map a Looker API HTTP error into the envelope shape, with hints
    tuned to the most common authoring mistakes."""
    body_text = raw_body or ""
    lowered = body_text.lower()

    if "invalid locale for user" in lowered:
        env = _error_envelope(
            error_type="invalid_locale",
            message=f"Looker rejected the query (HTTP {code}): {body_text[:1500]}",
            hint="The current Looker user's locale attribute (for example 'en') does not match any <locale>.strings.json file in the LookML project.",
            suggested_action="Update the user's Locale under Looker Admin -> Users -> Edit User -> Locale to match the project's default_locale (e.g. 'en_US'), or add the missing <locale>.strings.json file to the LookML project.",
        )
        env["error_code"] = "invalid_locale"
        return env

    # Field-not-found in an explore. Match Looker's specific phrasings
    # only — "Could not find field X" / "Field X not found in explore" —
    # which are unambiguous. We deliberately do NOT match the generic
    # "X does not exist" because that wording also appears on sort,
    # filter, and connection errors.
    if ("could not find field" in lowered or
        "field not found" in lowered):
        return _error_envelope(
            error_type="field_not_found",
            message=f"Looker rejected the query (HTTP {code}): {body_text[:1500]}",
            hint="One of the LookML fields referenced in this query "
                 "doesn't exist on the explore. Common causes: a typo, a "
                 "field that's on a different view, or a measure that's "
                 "been renamed. Validate field names with "
                 "`explore-model.py <model> <explore>` (direct Looker API) "
                 "before re-publishing.",
            suggested_action="Re-run `python3 skills/data-app-creator/"
                             "tools/explore-model.py <model> <explore>`, "
                             "swap the bad field for an existing one, and retry.",
        )
    if code == 422:
        if "filter values must be strings" in lowered:
            return _error_envelope(
                error_type="query_validation",
                message=f"Looker rejected the query (HTTP 422): {body_text[:1500]}",
                hint="Looker requires every value in `query.filters` to be a string "
                     "(e.g. `'2017'` instead of `2017`, `'Yes'` instead of `true`).",
                suggested_action="Coerce filter values to strings in `getEffectiveFilters()` or widget `.filters` and retry.",
            )
        return _error_envelope(
            error_type="query_validation",
            message=f"Looker rejected the query (HTTP 422): {body_text[:1500]}",
            hint="The query is structurally invalid — usually a bad sort "
                 "expression, an unknown filter operator, or a measure "
                 "without a value_format. Check the body for the specific "
                 "field name.",
            suggested_action="Inspect the `message` text for the field, "
                             "fix the chart's JSON options or LookML "
                             "measure, and retry.",
        )
    if code == 403 or _is_role_denied_404(code, lowered):
        return _error_envelope(
            error_type="permission_denied",
            message=f"Looker denied the query (HTTP {code}): {body_text[:1500]}",
            hint="The API user can authenticate but cannot run this "
                 "query — usually a missing role permission (Looker "
                 "returns HTTP 404 from authorize!) or a model access / "
                 "row-level filter rule (HTTP 403). The API user needs "
                 "`access_data` and `explore` on that model.",
            suggested_action="Have the customer grant the API user "
                             "`access_data` and `explore` and add it to the "
                             "model's access set.",
        )
    if code in (502, 503, 504):
        return _error_envelope(
            error_type="upstream_timeout",
            message=f"Looker timed out (HTTP {code}): {body_text[:200]}",
            hint="The query took too long for Looker's edge or the "
                 "warehouse to return (HTTP 502/504). If this query combines "
                 "multiple unnested array views or un-aggregated metrics, "
                 "this is a LookML fan-out trap.",
            suggested_action="Split queries combining multiple array views "
                             "into separate tiles (see recipes/multi-metric-array-views.md), "
                             "or add constraints/limits.",
        )
    return _error_envelope(
        error_type="looker_http_error",
        message=f"Looker returned HTTP {code}: {body_text[:1500]}",
        hint="Unmapped Looker API error. Read the full `message` for "
             "context; rerun with --verbose if available.",
        suggested_action="Open the Looker API docs for this endpoint and "
                         "match the error against the documented shape.",
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'application/javascript',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
    }

    # Quieter log line — only path + status.
    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.command} {self.path}  {fmt % args}\n")


    def translate_path(self, path):
        clean_path = path.split("?", 1)[0]
        clean_stripped = clean_path.rstrip("/")
        if clean_stripped in ("", "/", "/index.html", "/preview-server"):
            cand = ROOT / "preview-server" / "index.html"
            if not cand.exists():
                cand = ROOT / "dist" / "preview-server" / "index.html"
            if cand.exists():
                return str(cand)

        rel = clean_path.lstrip("/")
        root_str = str(ROOT_RESOLVED)
        for base in (ROOT, ROOT / "dist", ROOT / "dist" / "preview-server", ROOT / "preview-server"):
            cand = (base / rel).resolve()
            try:
                if cand.is_file() and os.path.commonpath([root_str, str(cand)]) == root_str:
                    return str(cand)
            except ValueError:
                continue

        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        # Anti-clickjacking & framing security headers
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
        # Cross-Origin Isolation headers
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # The ?sandbox=true frame runs at an opaque origin (no allow-same-origin,
        # for tile parity), so every ES-module fetch from it is cross-origin and
        # needs CORS or the app can't load at all. `<script src>`/`<link>` tags
        # fetch in no-cors mode though, where CORS doesn't apply — only
        # Cross-Origin-Resource-Policy does, and Cross-Origin-Embedder-Policy:
        # require-corp (above) blocks anything missing it. Without this, the
        # opaque-origin sandbox can't load data-app.css / ag-grid / highcharts
        # at all, so nothing in the tile-parity preview renders.
        #
        # Static files only. The /api/ endpoints answer with query results and
        # the developer's app catalogue; making those readable by any page the
        # developer visits is the other half of the CSRF the guards below
        # refuse, and the sandbox frame never calls them (the parent brokers).
        if not self.path.split("?", 1)[0].startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def _send_json(self, status, payload):
        try:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        clean_path = self.path.split("?", 1)[0]
        if clean_path.startswith("/api/") and not self._guard():
            return

        if clean_path == "/api/apps":
            def scan_dir(sub_dir, exclude_prefix=None):
                results = []
                base = ROOT / sub_dir
                if not base.exists():
                    base = ROOT / "dist" / sub_dir
                if not base.exists():
                    return results
                matched_files = set(base.glob("**/app.js")) | set(base.glob("**/*.app.js"))
                for p in sorted(matched_files):
                    try:
                        rel = p.relative_to(ROOT).as_posix()
                    except ValueError:
                        rel = p.relative_to(ROOT / "dist").as_posix()
                    if "/.venv" in rel or "/node_modules" in rel or "/site-packages" in rel:
                        continue
                    if exclude_prefix and (rel.startswith(exclude_prefix) or rel.startswith(f"dist/{exclude_prefix}")):
                        continue
                    if p.name == "app.js":
                        raw_name = p.parent.name
                    else:
                        raw_name = p.name[:-7] if p.name.endswith(".app.js") else p.stem
                    title = raw_name.replace("-", " ").replace("_", " ").title()
                    desc = f"Data App component in {sub_dir}"
                    try:
                        content = p.read_text(encoding="utf-8")
                        import re
                        model_match = re.search(r"(?:lookerModel|const MODEL)\s*=\s*['\"]([^'\"]+)['\"]", content)
                        explore_match = re.search(r"(?:explore|const EXPLORE)\s*=\s*['\"]([^'\"]+)['\"]", content)
                        meta_parts = []
                        if model_match:
                            meta_parts.append(f"Model: {model_match.group(1)}")
                        if explore_match:
                            meta_parts.append(f"Explore: {explore_match.group(1)}")
                        if meta_parts:
                            desc = " · ".join(meta_parts)
                        
                        desc_match = re.search(r'@(?:description|desc)\s+([^\n]+)', content)
                        if desc_match:
                            desc = desc_match.group(1).strip()
                        title_match = re.search(r'@title\s+([^\n]+)', content)
                        if title_match:
                            title = title_match.group(1).strip()

                        # Parse strict ISO UTC @updated-at / @created-at / @published-at metadata
                        import datetime
                        date_match = (
                            re.search(r'@updated-at\s+([^\n]+)', content)
                            or re.search(r'@created-at\s+([^\n]+)', content)
                            or re.search(r'@published-at\s+([^\n]+)', content)
                        )
                        if date_match:
                            try:
                                raw_p = date_match.group(1).strip().replace('Z', '+00:00')
                                dt = datetime.datetime.fromisoformat(raw_p)
                                published_epoch = int(dt.timestamp())
                            except Exception:
                                published_epoch = 0
                        else:
                            published_epoch = 0
                    except Exception:
                        published_epoch = 0

                    try:
                        fs_mtime = int(p.stat().st_mtime)
                    except Exception:
                        fs_mtime = 0

                    # Last edit = file mtime; last publish = @updated-at, @created-at, or legacy @published-at from header.
                    # Note: If apps/ is tracked in git, a fresh clone or branch switch
                    # resets file mtimes to checkout time, causing apps to temporarily
                    # appear updated at checkout time until files settle.
                    results.append({
                        "name": raw_name,
                        "title": title,
                        "path": "/" + rel,
                        "desc": desc,
                        "mtime": fs_mtime,
                        "published_at": published_epoch if published_epoch > 0 else None,
                    })
                # Order from most recently modified to oldest
                results.sort(key=lambda item: item.get("mtime", 0), reverse=True)
                return results

            self._send_json(200, {
                "pid": os.getpid(),
                "workspace_dir": str(ROOT),
                "my_apps": scan_dir("apps"),
                "examples": scan_dir("examples"),
                "evals": scan_dir("evals", exclude_prefix="evals/.venv"),
            })
            return

        # Everything else is a static file served from the repo root.
        return super().do_GET()

    def _read_body(self, max_bytes):
        """Read and return the raw request body, or None after emitting a 413
        payload-too-large envelope. Shared cap/negative-length guard."""
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > max_bytes:
            self._send_json(413, _error_envelope(
                error_type="payload_too_large",
                message=f"Request body length {length} is invalid "
                        f"(cap {max_bytes} bytes).",
                hint="A runaway payload or a malformed Content-Length "
                     "usually means an application bug.",
                suggested_action="Reload the preview page.",
            ))
            return None
        return self.rfile.read(length)

    def do_POST(self):
        route = self.path.split("?", 1)[0]
        if route == "/api/query":
            self._handle_query()
        else:
            self.send_error(404, "unknown endpoint")

    def _guard(self):
        """Refuse anything not positively placed on the preview page. Returns
        True when the request may proceed."""
        headers = getattr(self, "headers", None) or {}
        denial = check_same_origin(headers)
        if denial is not None:
            self._send_json(403, denial)
            return False

        route = self.path.split("?", 1)[0]
        # The mutating endpoint (/api/query) requires the
        # X-Looker-Preview-Client header. Because cross-origin browser requests
        # cannot set custom headers without a preflight that serve.py refuses,
        # this provides defense-in-depth against CSRF.
        if route == "/api/query":
            if headers.get("X-Looker-Preview-Client") != "1":
                self._send_json(403, _error_envelope(
                    error_type="forbidden_custom_header",
                    message="Missing required custom header: X-Looker-Preview-Client: 1",
                    hint="Requests to /api/query must include "
                         "'X-Looker-Preview-Client: 1' to ensure they originate "
                         "from the preview client.",
                    suggested_action="Use the preview server's UI or set the header in your script.",
                ))
                return False

        return True

    def _handle_query(self):
        if not self._guard():
            return

        raw = self._read_body(MAX_BODY)
        if raw is None:
            return
        try:
            query = json.loads(raw)
        except Exception as e:
            self._send_json(400, _error_envelope(
                error_type="bad_request_body",
                message=str(e),
                hint="The runtime sent a non-JSON body to /api/query. "
                     "Re-check the request payload.",
                suggested_action="Reload the preview page.",
            ))
            return
        # Check for client-side fan-out risk before sending to Looker
        fan_out_err = _detect_fan_out_risk(query)
        if fan_out_err:
            self._send_json(400, fan_out_err)
            return

        try:
            rows = run_inline_query(query)
            self._send_json(200, rows)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            self._send_json(e.code, _shape_looker_error(e.code, err_body))
        except Exception as e:
            self._send_json(500, _error_envelope(
                error_type="unexpected",
                message=str(e),
                hint="An unhandled exception escaped serve.py. Re-run "
                     "with the same query and capture the traceback "
                     "from the terminal where serve.py is running.",
                suggested_action="Restart serve.py if errors persist.",
            ))


def _probe_apps(port, timeout=1.0):
    conn = None
    try:
        import http.client
        conn = http.client.HTTPConnection("localhost", port, timeout=timeout)
        conn.request("GET", "/api/apps", headers={"Origin": f"http://localhost:{port}"})
        resp = conn.getresponse()
        if resp.status == 200:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
        return None
    except Exception:
        return None
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _is_pid_alive(pid):
    if not pid:
        return False
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes
            kernel32 = ctypes.windll.kernel32
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(0x1000, False, int(pid))
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD()
                if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return exit_code.value == 259
                return False
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _reclaim_existing_preview_server(port):
    """If an existing preview server for ROOT is running on `port`, stop it and return True.
    If the port is held by another workspace or an unknown process, print who holds it and return False."""
    info = _probe_apps(port)
    if not isinstance(info, dict):
        print(f"error: cannot bind port {port} -- port is in use by an unknown process.", file=sys.stderr)
        return False

    server_ws = info.get("workspace_dir")
    is_same_workspace = False
    if server_ws:
        try:
            is_same_workspace = (Path(server_ws).resolve() == ROOT.resolve())
        except Exception:
            is_same_workspace = False

    pid = None
    if info.get("pid"):
        try:
            pid = int(info["pid"])
        except (ValueError, TypeError):
            pass

    if not is_same_workspace:
        ws_display = server_ws or "unknown workspace"
        pid_display = f", pid {pid}" if pid else ""
        print(f"error: cannot bind port {port} -- port is held by another preview server ({ws_display}{pid_display}).", file=sys.stderr)
        return False

    if not pid or pid == os.getpid() or not _is_pid_alive(pid):
        print(f"error: cannot bind port {port} -- port is in use.", file=sys.stderr)
        return False

    print(f"Stopping existing preview server on port {port} for {ROOT} (pid {pid})", flush=True)
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
    time.sleep(0.3)
    if _is_pid_alive(pid):
        try:
            os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))
        except OSError:
            pass
    for _ in range(15):
        time.sleep(0.2)
        if _probe_apps(port) is None or not _is_pid_alive(pid):
            break
    return True


def main():
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--host", default=DEFAULT_HOST,
        help="Interface to bind. Default 127.0.0.1 (localhost only). "
             "Pass 0.0.0.0 to expose on the LAN (rare; not recommended "
             "while data-apps-config.json holds API credentials).")
    p.add_argument("--port", type=int, default=PORT)
    p.add_argument("app", nargs="?", help="optional path to a data app, e.g. apps/sales/app.js")
    args = p.parse_args()
    args.app = args.app.replace("\\", "/") if args.app else None

    global BIND_HOST, BIND_PORT
    BIND_HOST, BIND_PORT = args.host, args.port

    visible_host = "localhost" if args.host in ("127.0.0.1", "::1", "") else args.host
    gallery_url = f"http://{visible_host}:{args.port}/preview-server/"
    app_url = f"http://{visible_host}:{args.port}/preview-server/?app={args.app}" if args.app else None

    def _announce():
        print(f"serving http://{visible_host}:{args.port}  →  {ROOT}", flush=True)
        print(f"  proxy /api/query  →  {get_base_url()}/api/4.0/queries/run/json", flush=True)
        print(f"  bind: {args.host}:{args.port}", flush=True)
        print(flush=True)
        if app_url:
            print(f"✨ App Preview:       {app_url}", flush=True)
        print(f"✨ App Gallery Hub:   {gallery_url}", flush=True)
        print(flush=True)
    

    port_file = ROOT / ".preview-port"
    pid_file = ROOT / ".preview-pid"

    def _cleanup():
        if pid_file.exists():
            try:
                if pid_file.read_text(encoding="utf-8").strip() == str(os.getpid()):
                    pid_file.unlink()
                    if port_file.exists() and port_file.read_text(encoding="utf-8").strip() == str(args.port):
                        port_file.unlink()
            except OSError:
                pass

    import signal
    def handle_shutdown(signum, frame):
        print("\nshutting down")
        _cleanup()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    retried = False
    while True:
        try:
            # Bind first, announce second -- otherwise a failed bind is preceded by
            # a "serving http://..." banner for a server that never came up.
            with ThreadingHTTPServer((args.host, args.port), Handler) as httpd:
                port_file.write_text(str(args.port), encoding="utf-8")
                pid_file.write_text(str(os.getpid()), encoding="utf-8")
                _announce()
                httpd.serve_forever()
            break
        except OSError as e:
            if e.errno == errno.EADDRINUSE and not retried:
                retried = True
                if _reclaim_existing_preview_server(args.port):
                    continue
                sys.exit(1)
            # A taken port is the common case and used to surface as a raw
            # EADDRINUSE traceback in the log -- which start-preview.py then
            # reported only as "the server did not come up".
            if e.errno in (errno.EADDRINUSE, errno.EACCES):
                what = ("in use" if e.errno == errno.EADDRINUSE
                        else "not permitted (ports below 1024 need root)")
                print(
                    f"error: cannot bind {args.host}:{args.port} -- port {what}.\n"
                    f"       Stop the existing server:  "
                    f"python3 skills/data-app-previewer/tools/stop-preview.py\n"
                    f"       Or use another port:       "
                    f"PORT={args.port + 1} python3 skills/data-app-previewer/tools/start-preview.py",
                    file=sys.stderr,
                )
                sys.exit(1)
            raise
        except KeyboardInterrupt:
            print("\nshutting down")
            break
        finally:
            _cleanup()


if __name__ == "__main__":
    main()
