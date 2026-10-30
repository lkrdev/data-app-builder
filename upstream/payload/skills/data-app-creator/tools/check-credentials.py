#!/usr/bin/env python3
"""Looker credentials preflight validator and discovery gate.

Mandatory first move in the Data App creation workflow:
Verifies that data-apps-config.json credentials work against the Looker API
before an agent explores models or writes code.

If credentials fail, it halts with a clear Human-In-The-Loop (HITL) alert
explaining what is wrong (e.g. SSO proxy offline, 401 Unauthorized, missing config)
and what the user must do to fix it.

Usage:
    python3 skills/data-app-creator/tools/check-credentials.py
    python3 skills/data-app-creator/tools/check-credentials.py --json
    python3 skills/data-app-creator/tools/check-credentials.py --config /path/to/data-apps-config.json

Exit 0: Credentials work, prints available LookML models.
Exit 1: Credentials failed, prints actionable HITL stop instructions.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
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
    """SSL context supporting custom LOOKER_CA_BUNDLE if set."""
    ctx = _base_ssl_context()
    extra_ca = os.environ.get("LOOKER_CA_BUNDLE")
    if extra_ca and os.path.exists(extra_ca):
        ctx.load_verify_locations(cafile=extra_ca)
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    return ctx


_LOOKER_SSL_CTX = _looker_ssl_context()


def load_config(custom_path=None) -> tuple[dict, str | None]:
    """Resolve Looker credentials from config file or environment variables."""
    cfg = {}
    config_source = None

    if custom_path:
        p = Path(custom_path)
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    cfg.update(data)
                    config_source = str(p)
            except json.JSONDecodeError as e:
                cfg["_parse_error"] = str(e)
                config_source = str(p)
            except Exception:
                pass
    else:
        candidates = [
            Path.cwd() / "data-apps-config.json",
        ]
        curr = Path(__file__).resolve().parent
        while curr != curr.parent:
            candidates.append(curr / "data-apps-config.json")
            if (curr / ".git").exists():
                break
            curr = curr.parent

        for cand in candidates:
            if cand.is_file():
                try:
                    data = json.loads(cand.read_text(encoding="utf-8"))
                    if isinstance(data, dict):
                        cfg.update(data)
                        config_source = str(cand)
                        break
                except json.JSONDecodeError as e:
                    cfg["_parse_error"] = str(e)
                    config_source = str(cand)
                    break
                except Exception:
                    pass

    # Environment variables take precedence over config file
    env_base = os.environ.get("LOOKERSDK_BASE_URL") or os.environ.get("LOOKER_BASE_URL")
    if env_base:
        cfg["base_url"] = env_base
        config_source = "environment (LOOKERSDK_BASE_URL)"
    env_id = os.environ.get("LOOKERSDK_CLIENT_ID") or os.environ.get("LOOKER_CLIENT_ID")
    if env_id:
        cfg["client_id"] = env_id
    env_secret = os.environ.get("LOOKERSDK_CLIENT_SECRET") or os.environ.get("LOOKER_CLIENT_SECRET")
    if env_secret:
        cfg["client_secret"] = env_secret

    return cfg, config_source


def check_port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """Test TCP connectivity to a host and port."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, TimeoutError):
        return False


def verify_credentials(config: dict, config_path: str | None) -> dict:
    """Perform comprehensive connection & auth validation.
    Returns a result dict with status, error details, and available models."""
    if "_parse_error" in config:
        src = config_path or "data-apps-config.json"
        return {
            "ok": False,
            "error_type": "invalid_configuration",
            "message": f"Failed to parse {src}: {config['_parse_error']}",
            "hint": f"JSON syntax error in {src}.",
            "suggested_action": f"Fix the JSON syntax error in {src}.",
            "hitl": True,
        }

    base_url = (
        config.get("base_url")
        or config.get("looker_url")
        or config.get("looker_instance_url")
    )
    client_id = config.get("client_id")
    client_secret = config.get("client_secret")

    # 1. Missing credentials
    if not base_url or not client_id or not client_secret:
        missing = []
        if not base_url:
            missing.append("base_url")
        if not client_id:
            missing.append("client_id")
        if not client_secret:
            missing.append("client_secret")
        return {
            "ok": False,
            "error_type": "missing_credentials",
            "message": f"Looker configuration is incomplete (missing: {', '.join(missing)}).",
            "hint": "No API credentials configured. Run scripts/bootstrap.sh or provide data-apps-config.json.",
            "suggested_action": "Run `bash scripts/bootstrap.sh` to configure Looker credentials interactively, "
                                "or create data-apps-config.json at workspace root.",
            "hitl": True,
        }

    clean_base = str(base_url).rstrip("/")
    parsed = urllib.parse.urlparse(clean_base)

    # 2. Local SSO Proxy reachability check
    is_localhost = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if is_localhost and parsed.port:
        if not check_port_open(parsed.hostname, parsed.port):
            target_url = config.get("target_url") or "https://<your-looker-url>"
            return {
                "ok": False,
                "error_type": "proxy_offline",
                "message": f"Looker SSO proxy is not running on {parsed.hostname}:{parsed.port} (connection refused).",
                "hint": "The configured base_url points to a local proxy port that is currently offline.",
                "suggested_action": f"Start your SSO proxy in a separate terminal before proceeding:\n"
                                    f"  python3 /path/to/looker_sso_proxy.py --target {target_url} --port {parsed.port}",
                "hitl": True,
            }

    # 3. Test API Login (POST /api/4.0/login)
    token = None
    login_url = f"{clean_base}/api/4.0/login"
    login_body = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            login_url,
            data=login_body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            token = data.get("access_token")
    except urllib.error.HTTPError as e:
        raw_body = e.read().decode("utf-8", errors="ignore")
        clean_msg = raw_body
        try:
            parsed_err = json.loads(raw_body)
            if isinstance(parsed_err, dict) and "message" in parsed_err:
                clean_msg = parsed_err["message"]
        except Exception:
            pass

        if e.code == 401 or e.code == 400:
            return {
                "ok": False,
                "error_type": "authentication_failed",
                "message": f"Looker authentication failed (HTTP {e.code}): {clean_msg}",
                "hint": "Invalid client_id or client_secret in data-apps-config.json.",
                "suggested_action": "Check data-apps-config.json and ensure client_id and client_secret are valid and unexpired.",
                "hitl": True,
            }
        elif e.code == 404:
            return {
                "ok": False,
                "error_type": "endpoint_not_found",
                "message": f"Looker API login endpoint not found (HTTP 404) at {login_url}.",
                "hint": "The base_url in data-apps-config.json may have an invalid path or port.",
                "suggested_action": f"Verify the base_url ({clean_base}) matches your Looker instance URL (e.g. https://instance.looker.com).",
                "hitl": True,
            }
        else:
            return {
                "ok": False,
                "error_type": "http_error",
                "message": f"Looker returned HTTP {e.code} during login: {clean_msg}",
                "hint": "Looker API returned an unexpected error.",
                "suggested_action": "Inspect server status or check Looker API credentials.",
                "hitl": True,
            }
    except ssl.SSLError as e:
        return {
            "ok": False,
            "error_type": "ssl_verification_failed",
            "message": f"TLS/SSL verification failed when connecting to {clean_base}: {e}",
            "hint": "The server certificate could not be verified (common for internal or private CA instances).",
            "suggested_action": "Set LOOKER_CA_BUNDLE to your internal certificate authority bundle path: "
                                "export LOOKER_CA_BUNDLE=/path/to/ca.pem",
            "hitl": True,
        }
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
        return {
            "ok": False,
            "error_type": "network_unreachable",
            "message": f"Could not connect to Looker at {clean_base}: {e}",
            "hint": "Network connection failed or host timed out.",
            "suggested_action": "Check VPN connection, internet reachability, and instance host address.",
            "hitl": True,
        }

    if not token:
        return {
            "ok": False,
            "error_type": "token_missing",
            "message": "Login succeeded but no access_token was returned.",
            "hint": "Looker login payload was missing the expected access_token field.",
            "suggested_action": "Check Looker API version and instance health.",
            "hitl": True,
        }

    # 4. Fetch available models (GET /api/4.0/lookml_models)
    now_iso = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    models_url = f"{clean_base}/api/4.0/lookml_models"
    models_list = []
    try:
        req = urllib.request.Request(
            models_url,
            headers={"Authorization": f"token {token}", "Content-Type": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(req, context=_LOOKER_SSL_CTX, timeout=20) as resp:
            raw_models = json.loads(resp.read().decode("utf-8"))
            for m in raw_models:
                name = m.get("name")
                if not name:
                    continue
                explores = [e.get("name") for e in m.get("explores", []) if e.get("name")]
                models_list.append({
                    "name": name,
                    "label": m.get("label") or name,
                    "explores": explores,
                })
    except Exception as e:
        # If model listing fails due to permissions, return warning but auth succeeded
        return {
            "ok": True,
            "base_url": clean_base,
            "config_source": config_path,
            "timestamp": now_iso,
            "models": [],
            "warning": f"Authenticated successfully, but listing models returned: {e}",
        }

    return {
        "ok": True,
        "base_url": clean_base,
        "config_source": config_path,
        "timestamp": now_iso,
        "models": models_list,
    }


def main(argv=None):
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    parser = argparse.ArgumentParser(
        description="Verify Looker API credentials and list available LookML models."
    )
    parser.add_argument("--config", default=None, help="Path to data-apps-config.json")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    args = parser.parse_args(argv)

    cfg, source = load_config(args.config)
    res = verify_credentials(cfg, source)

    if args.json:
        print(json.dumps(res, indent=2))
        return 0 if res["ok"] else 1

    if not res["ok"]:
        print("\n" + "=" * 64)
        print("🛑 LOOKER CREDENTIALS CHECK FAILED [HITL STOP]")
        print("=" * 64)
        print(f"Error Type: {res['error_type']}")
        print(f"Message:    {res['message']}")
        print(f"Hint:       {res['hint']}")
        print("\n" + "-" * 64)
        print("REQUIRED HUMAN ACTION:")
        print(res["suggested_action"])
        print("-" * 64)
        print("\nAgent instruction: STOP IMMEDIATELY. Do not generate code or guess models.")
        print("Ask the user to resolve the credentials issue above before continuing.\n")
        return 1

    print("\n" + "=" * 64)
    print("✓ LOOKER CREDENTIALS VERIFIED")
    print("=" * 64)
    print(f"Instance:  {res['base_url']}")
    if res.get("timestamp"):
        print(f"Timestamp: {res['timestamp']}")
    if res.get("config_source"):
        print(f"Config:    {res['config_source']}")

    models = res.get("models", [])
    if models:
        active_models = [m for m in models if m.get("explores")]
        if active_models:
            print(f"\nAvailable LookML Models ({len(active_models)}):")
            for m in active_models:
                explores_preview = ", ".join(m["explores"][:4])
                if len(m["explores"]) > 4:
                    explores_preview += f", ... (+{len(m['explores']) - 4} more)"
                print(f"  • {m['name']} (explores: {explores_preview})")
        else:
            print(f"\nAvailable LookML Models (0 active):")
            print(f"  ({len(models)} model(s) visible, but none expose active explores -- verify API user model-set permissions)")
    elif res.get("warning"):
        print(f"\nWarning: {res['warning']}")

    print("\n✓ Connection ready. You may proceed with model discovery and dashboard creation.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
