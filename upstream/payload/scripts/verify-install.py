#!/usr/bin/env python3
"""Confirm this install can actually publish a Data App.

Publishing needs exactly one thing from the instance that ordinary API
access does not: the ability to store a Data App as an **inline extension**
and serve it back. Everything else publish-data-app.py does -- creating a
dashboard, adding an element, setting body_text, switching the layout -- is
stock 4.0 API that works anywhere.

So this verifies that one capability, end to end, by doing what publishing
does: create a throwaway extension with a known payload, read it back
through the bundle route Looker itself uses to load a tile, compare the
bytes, and delete it. A capability probe that writes is worth far more than
one that only reads -- the failure mode this catches in practice is a write
path that accepts a request and then cannot serve it back.

It deliberately does not check for a LookML project, a manifest, or a
registered model. Publishing stopped needing them when it moved to inline
extensions; probing for them would report failure on a perfectly good
install.

Exit 0: publishing will work. Non-zero: it will not, and the message says
which part is missing and who fixes it.
"""

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


def _base_ssl_context():
    """A usable CA bundle, nothing host-specific."""
    candidates = [
        "/etc/ssl/cert.pem",                       # macOS
        "/etc/pki/tls/certs/ca-bundle.crt",        # RHEL/CentOS
        "/etc/ssl/certs/ca-certificates.crt",      # Debian/Ubuntu
        "/opt/homebrew/etc/openssl@3/cert.pem",    # Homebrew (Apple Silicon)
        "/usr/local/etc/openssl@3/cert.pem",       # Homebrew (Intel)
    ]
    cafile = next((p for p in candidates if os.path.exists(p)), None)
    if cafile is None:
        try:
            import certifi  # type: ignore
            cafile = certifi.where()
        except ImportError:
            return ssl.create_default_context()
    return ssl.create_default_context(cafile=cafile)


def _looker_ssl_context():
    """The base context, plus trust for a private CA if the instance opted in.

    A Looker instance behind a private CA -- a local dev instance, or an
    internal deployment -- serves a certificate the base store has no reason
    to trust, and such certs sometimes carry a key below OpenSSL's default
    security level. Point LOOKER_CA_BUNDLE at that certificate to trust it.
    Verification stays on: the cert is added as an anchor, never bypassed.
    """
    ctx = _base_ssl_context()
    extra_ca = os.environ.get("LOOKER_CA_BUNDLE")
    if extra_ca and os.path.exists(extra_ca):
        ctx.load_verify_locations(cafile=extra_ca)
        # Scoped to this context, which only ever talks to the Looker
        # instance, rather than installed as the process default where it
        # would also lower the cipher floor for hosts that never opted in.
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    return ctx


_LOOKER_SSL_CTX = _looker_ssl_context()


def login(base_url, client_id, client_secret):
    body = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret}).encode()
    req = urllib.request.Request(
        f"{base_url}/api/4.0/login", data=body, method="POST")
    with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX, timeout=30) as r:
        return json.loads(r.read())["access_token"]


def call(base, token, method, path, body=None):
    """Return (status, parsed_body). Never raises on an HTTP error status --
    every caller here wants to report the code rather than stack-trace."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{base}/api/4.0{path}", data=data, method=method,
        headers={"Authorization": f"token {token}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def fetch_bundle(base, token, ext_id):
    """Read the extension back through the route Looker uses to load a tile."""
    req = urllib.request.Request(
        f"{base}/api/4.0/inline_extension/{ext_id}/bundle.js",
        headers={"Authorization": f"token {token}"})
    try:
        with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX, timeout=30) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def resolve_config(explicit_path):
    """Resolve config: read data-apps-config.json (or explicit --config path).
    Environment variables override both."""
    repo_root = Path(__file__).resolve().parent.parent
    cfg = {}
    if explicit_path:
        cfg = json.loads(Path(explicit_path).read_text(encoding="utf-8"))
    else:
        cfg_file = repo_root / "data-apps-config.json"
        if cfg_file.is_file():
            cfg = json.loads(cfg_file.read_text(encoding="utf-8"))

    base_url = os.environ.get("LOOKERSDK_BASE_URL") or os.environ.get("LOOKER_BASE_URL")
    if base_url:
        cfg["base_url"] = base_url
    client_id = os.environ.get("LOOKERSDK_CLIENT_ID") or os.environ.get("LOOKER_CLIENT_ID")
    if client_id:
        cfg["client_id"] = client_id
    client_secret = os.environ.get("LOOKERSDK_CLIENT_SECRET") or os.environ.get("LOOKER_CLIENT_SECRET")
    if client_secret:
        cfg["client_secret"] = client_secret
    return cfg


LOOKER_NOT_FOUND_MSG = "not found"
SINATRA_NOT_FOUND_MARKER = "sinatra::notfound"
LOOKER_ROLE_ERR_DOC_PATH = "/r/err/"


def _is_role_denied_404(code, body):
    """Looker's authorize! answers 404 (not 403) with a JSON 'Not found' body
    and a route-specific '/r/err/' documentation_url when the API user's role
    lacks a required permission. When the inline_extensions feature flag is
    off, the before-filter 'halt 404' runs before route matching and returns a
    bare root documentation_url without '/r/err/'."""
    if code != 404 or not body:
        return False
    if isinstance(body, dict):
        msg = str(body.get("message") or "").lower()
        if LOOKER_NOT_FOUND_MSG not in msg:
            return False
        lowered = json.dumps(body).lower()
    elif isinstance(body, str):
        lowered = body.lower()
        if '"message"' not in lowered or LOOKER_NOT_FOUND_MSG not in lowered:
            return False
    else:
        return False
    return (
        SINATRA_NOT_FOUND_MARKER not in lowered
        and (LOOKER_ROLE_ERR_DOC_PATH in lowered or "documentation_url" not in lowered)
    )


def _explain_unavailable(code, body, base):
    """Say which part is missing and who fixes it.

    A missing route is an instance-admin change; a 403 or role-denied 404 is a
    role change. Reporting them the same way sends people to the wrong place.
    """
    text = body if isinstance(body, str) else json.dumps(body or {})
    lowered = text.lower()
    is_role = code == 403 or _is_role_denied_404(code, body)
    if code == 404 and SINATRA_NOT_FOUND_MARKER in lowered:
        why = ("this instance has no /data_app_extension endpoint at all, so the\n"
               "  `inline_extensions` feature is off or the Looker version "
               "predates it.")
    elif _is_role_denied_404(code, body):
        why = ("the API user is authenticated but its role is missing\n"
               "  dashboard author permissions (save_content, save_dashboards,\n"
               "  access_data). The full toolkit also needs explore and\n"
               "  see_user_dashboards.")
    elif code == 404:
        why = ("/data_app_extension returned 404 — the `inline_extensions` "
               "feature is\n  most likely off on this instance.")
    elif code == 403:
        why = ("the API user is authenticated but not allowed to use\n"
               "  /data_app_extension. Either the `inline_extensions` feature is "
               "off, or\n  this user's role lacks dashboard author permissions "
               "(save_content, save_dashboards, access_data).")
    else:
        why = f"/data_app_extension returned HTTP {code}."

    lines = [
        f"error: this install cannot publish to {base}:",
        f"  {why}",
    ]
    if not is_role:
        lines.append(
            "  Publishing requires the `inline_extensions` feature. Enable it "
            "on the\n  instance, or use a Data Apps release from "
            "before inline-only\n  publishing."
        )
    lines.append(f"  Looker's response: {text[:300]}")
    return "\n".join(lines)


def main():
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--config", help="Path to a config file (overrides the "
                                    "default data-apps-config.json)")
    args = p.parse_args()

    cfg = resolve_config(args.config)
    base = (cfg.get("base_url") or cfg.get("looker_instance_url") or "").rstrip("/")
    cid, sec = cfg.get("client_id"), cfg.get("client_secret")
    if not (base and cid and sec):
        sys.exit("error: config is missing base_url/client_id/client_secret.\n"
                 "  Populate it, set LOOKERSDK_BASE_URL / LOOKERSDK_CLIENT_ID /\n"
                 "  LOOKERSDK_CLIENT_SECRET, or re-run scripts/bootstrap.sh.")

    print(f"target: {base}")
    print()

    try:
        token = login(base, cid, sec)
    except Exception as e:
        sys.exit(f"error: could not log in to {base}: {e}\n"
                 "  Check the credentials in the config, and that the API port "
                 "is reachable.")
    print("  [1/4] Credentials accepted.")

    code, body = call(base, token, "GET", "/data_app_extension?limit=1")
    if code != 200:
        sys.exit(_explain_unavailable(code, body, base))
    print("  [2/4] Inline extensions feature is available.")

    # Write and read back. A name nothing else uses, so a failed run can
    # never collide with real extensions or with a concurrent check.
    probe_name = f"data-app-verify-{uuid.uuid4().hex[:12]}"
    payload = f"// looker-data-apps install check {probe_name}\nexport const ok = true;\n"
    ext_id = None
    try:
        code, body = call(base, token, "POST", "/data_app_extension", {
            "name": probe_name,
            "label": "Data App install check",
            "description": "Temporary; created and deleted by verify-install.py.",
            "code": payload,
        })
        if code == 403 or _is_role_denied_404(code, body):
            sys.exit(_explain_unavailable(code, body, base))
        if code != 200 or not isinstance(body, dict) or not body.get("id"):
            text = body if isinstance(body, str) else json.dumps(body or {})
            sys.exit(f"error: could not create a Data App extension on {base} "
                     f"(HTTP {code}).\n"
                     "  Listing them worked, so the feature is on and the "
                     "failure is in the\n  write path itself — the instance's "
                     "logs will have the exception.\n"
                     f"  Looker's response: {text[:300]}")
        ext_id = body["id"]
        print("  [3/4] Extension code can be stored.")

        code, served = fetch_bundle(base, token, ext_id)
        if code != 200:
            sys.exit(f"error: the extension was stored but its bundle will not "
                     f"serve (HTTP {code}).\n"
                     "  Looker fetches this route to load a tile, so dashboards "
                     "would render\n  empty. The write path works and the read "
                     "path does not — the\n  instance's logs will have the "
                     "exception.\n"
                     f"  Looker's response: {served[:300]}")
        if served != payload:
            sys.exit("error: the bundle served back does not match what was "
                     "stored.\n"
                     f"  sent {len(payload)} bytes, got {len(served)} — a tile "
                     "would load\n  corrupted code. This is a server-side "
                     "storage problem.")
        print("  [4/4] Extension bundle serves back byte-identical.")
    finally:
        if ext_id:
            code, _ = call(base, token, "DELETE", f"/data_app_extension/{ext_id}")
            if code not in (200, 204):
                print(f"  note: could not delete the temporary extension "
                      f"{probe_name} (HTTP {code}); remove it by hand.",
                      file=sys.stderr)

    print()
    print("OK — publishing will work.")

if __name__ == "__main__":
    main()
