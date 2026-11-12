#!/usr/bin/env python3
"""Data Apps customer onboarding and second-stage bootstrapper."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.parse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Enable ANSI escape sequences in Windows Command Prompt (conhost)
ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004

if os.name == "nt":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        h_out = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_ulong()
        if kernel32.GetConsoleMode(h_out, ctypes.byref(mode)):
            # Enable ANSI color escape processing on Windows console
            kernel32.SetConsoleMode(h_out, mode.value | ENABLE_VIRTUAL_TERMINAL_PROCESSING)
    except Exception:
        pass

BOLD = RED = GREEN = YELLOW = BOLD_YELLOW = BLUE = CYAN = NC = ""


def setup_colors(enabled: bool | None = None) -> None:
    global BOLD, RED, GREEN, YELLOW, BOLD_YELLOW, BLUE, CYAN, NC
    if enabled is None:
        no_color = bool(os.environ.get("NO_COLOR"))
        enabled = sys.stdout.isatty() and not no_color
    if enabled:
        BOLD = "\033[1m"
        RED = "\033[0;31m"
        GREEN = "\033[0;32m"
        YELLOW = "\033[0;33m"
        BOLD_YELLOW = "\033[1;33m"
        BLUE = "\033[1;34m"
        CYAN = "\033[1;36m"
        NC = "\033[0m"
    else:
        BOLD = RED = GREEN = YELLOW = BOLD_YELLOW = BLUE = CYAN = NC = ""


setup_colors()

CANONICAL_TOOLKIT_URL = "https://dl.google.com/looker-data-apps"
CANONICAL_BROWSER_ASSETS_URL = "https://www.gstatic.com/looker-data-apps"


def normalize_url(raw: str) -> str:
    """Normalize user-entered Looker instance URL to scheme://host[:port].

    Returns empty string if invalid or if credentials are included.
    """
    if not isinstance(raw, str):
        return ""
    raw = raw.strip().strip('"').strip("'")
    if not raw:
        return ""
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parts = urllib.parse.urlsplit(raw)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return ""
        if parts.username or parts.password:
            return ""
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    except Exception:
        return ""


def write_config(
    config_file: Path | str,
    base_url: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    folder_id: str | None = None,
    toolkit_url: str | None = None,
    assets_url: str | None = None,
    canonical_toolkit_base: str = CANONICAL_TOOLKIT_URL,
    canonical_assets_base: str = CANONICAL_BROWSER_ASSETS_URL,
) -> None:
    """Write or update data-apps-config.json atomically with 0600 permissions."""
    path = Path(config_file)
    cfg: dict = {}
    if path.is_file():
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    cfg = loaded
        except Exception:
            cfg = {}

    if base_url is not None:
        url = base_url.strip().rstrip("/")
        cfg["base_url"] = url
        host = urllib.parse.urlparse(url).hostname or ""
        is_loopback = host in ("127.0.0.1", "localhost", "::1")
        if cfg.get("target_url") == url or not is_loopback:
            cfg.pop("target_url", None)
    if client_id is not None:
        cfg["client_id"] = client_id
    if client_secret is not None:
        cfg["client_secret"] = client_secret
    if folder_id is not None:
        if folder_id:
            cfg["publish_folder_id"] = folder_id.strip()
        else:
            cfg.pop("publish_folder_id", None)

    if toolkit_url is not None:
        if toolkit_url and toolkit_url != canonical_toolkit_base:
            cfg["toolkit_url"] = toolkit_url
        else:
            cfg.pop("toolkit_url", None)
        cfg.pop("shared_base_url", None)

    if assets_url is not None:
        if assets_url and (not canonical_assets_base or assets_url != canonical_assets_base):
            cfg["browser_assets_url"] = assets_url
        else:
            cfg.pop("browser_assets_url", None)
        cfg.pop("shared_runtime_url", None)

    cfg.pop("use_proxy", None)
    cfg.pop("proxy_port", None)

    tmp_path = path.with_name(path.name + ".tmp")
    try:
        tmp_path.unlink()
    except FileNotFoundError:
        pass
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(cfg, indent=2) + "\n")
    try:
        os.chmod(tmp_path, 0o600)
    except Exception:
        pass
    os.replace(tmp_path, path)
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def read_config_fields(config_file: Path | str) -> tuple[str, str, str, str]:
    """Read core Looker settings from config_file as (base_url, client_id, client_secret, folder_id)."""
    path = Path(config_file)
    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Config file {path} is not a JSON object")
    base_url = str(data.get("base_url") or "")
    client_id = str(data.get("client_id") or "")
    client_secret = str(data.get("client_secret") or "")
    folder_id = str(data.get("publish_folder_id") or "")
    return (base_url, client_id, client_secret, folder_id)


def read_input(prompt: str, secret: bool = False) -> str:
    """Read input from user.

    Uses getpass.getpass ONLY when secret is True and sys.stdin.isatty().
    When not sys.stdin.isatty(), reads directly from sys.stdin.readline() so piped
    inputs in unit tests and automated environments work identically to bash read.
    """
    if secret and sys.stdin.isatty():
        try:
            import getpass
            return getpass.getpass(prompt)
        except EOFError:
            return ""
        except Exception:
            pass
    if prompt:
        sys.stdout.write(prompt)
        sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        return ""
    return line.rstrip("\r\n")


def ask_yn(prompt: str) -> bool:
    ans = read_input(f"\n{BOLD}{prompt} [Y/n]: {NC}")
    ans = ans.strip().lower()
    return ans not in ("n", "no")


def short_path(p: Path | str) -> str:
    p_str = str(Path(p).resolve())
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or ""
    if home:
        home_res = str(Path(home).resolve())
        if p_str == home_res:
            return "~"
        if p_str.startswith(home_res + "/") or p_str.startswith(home_res + "\\"):
            return "~/" + p_str[len(home_res) + 1:].replace("\\", "/")
    return p_str


def resolve_repo_root(custom_root: str | Path | None = None) -> Path:
    if custom_root:
        return Path(custom_root).expanduser().resolve()
    script_dir = Path(__file__).resolve().parent
    parent_dir = script_dir.parent
    if parent_dir.name == "dist" and (
        (parent_dir.parent / "scripts" / "publish.sh").is_file()
        or (parent_dir.parent / ".git").is_dir()
    ):
        return parent_dir.parent.resolve()
    if (parent_dir / "VERSION").is_file():
        return parent_dir.resolve()
    cur = script_dir
    while cur.parent != cur:
        if (
            (cur / "data-apps-config.json").is_file()
            or (cur / "looker-config.json").is_file()
            or (cur / "canvas-config.json").is_file()
        ):
            return cur.resolve()
        cur = cur.parent
    return parent_dir.resolve()


def print_banner(version: str) -> None:
    v_str = f"v{version}"
    w = 56
    pad_len = max(0, w - len(v_str) - 3)
    pad = " " * pad_len
    print(f"{BLUE}┌────────────────────────────────────────────────────────┐{NC}")
    print(f"{BLUE}│{NC}                                                        {BLUE}│{NC}")
    print(f"{BLUE}│{NC}            {CYAN}_                 _{NC}                         {BLUE}│{NC}")
    print(f"{BLUE}│{NC}           {CYAN}| |    ___   ___  | | _____ _ __{NC}             {BLUE}│{NC}")
    print(f"{BLUE}│{NC}           {CYAN}| |   / _ \\ / _ \\ | |/ / _ \\ '__|{NC}            {BLUE}│{NC}")
    print(f"{BLUE}│{NC}           {CYAN}| |__| (_) | (_) ||   <  __/ |{NC}               {BLUE}│{NC}")
    print(f"{BLUE}│{NC}           {CYAN}|_____\\___/ \\___/ |_|\\_\\___|_|{NC}               {BLUE}│{NC}")
    print(f"{BLUE}│{NC}                                                        {BLUE}│{NC}")
    print(f"{BLUE}│{NC}     {GREEN}____        _            _{NC}                         {BLUE}│{NC}")
    print(f"{BLUE}│{NC}    {GREEN}|  _ \\  __ _| |_ __ _    / \\   _ __  _ __  ___{NC}      {BLUE}│{NC}")
    print(f"{BLUE}│{NC}    {GREEN}| | | |/ _` | __/ _` |  / _ \\ | '_ \\| '_ \\/ __|{NC}     {BLUE}│{NC}")
    print(f"{BLUE}│{NC}    {GREEN}| |_| | (_| | || (_| | / ___ \\| |_) | |_) \\__ \\{NC}    {BLUE}│{NC}")
    print(f"{BLUE}│{NC}    {GREEN}|____/ \\__,_|\\__\\__,_|/_/   \\_\\ .__/| .__/|___/{NC}     {BLUE}│{NC}")
    print(f"{BLUE}│{NC}                                  {GREEN}|_|   |_|{NC}             {BLUE}│{NC}")
    print(f"{BLUE}│{NC}{pad}{BOLD_YELLOW}{v_str}{NC}   {BLUE}│{NC}")
    print(f"{BLUE}└────────────────────────────────────────────────────────┘{NC}\n")


def show_config(config_path: Path) -> None:
    try:
        with open(config_path, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    target = cfg.get("target_url")
    base = cfg.get("base_url")
    if target and base and target != base:
        looker_url = f"{target} (proxied via {base})"
    else:
        looker_url = target or base or "(missing)"
    print(f"    {BOLD}Looker URL{NC}: {YELLOW}{looker_url}{NC}")
    for k in ["client_id", "client_secret", "publish_folder_id", "toolkit_url", "browser_assets_url"]:
        if k in cfg:
            val = cfg.get(k, "(missing)")
            if k == "client_secret" and val != "(missing)":
                val = "(hidden)"
            print(f"    {BOLD}{k}{NC}: {YELLOW}{val}{NC}")


def prompt_config(
    config_path: Path,
    toolkit_url: str,
    pinned_url: str,
    canonical_toolkit: str = CANONICAL_TOOLKIT_URL,
    canonical_browser: str = CANONICAL_BROWSER_ASSETS_URL,
) -> int:
    print("")
    print("  Your Looker API credentials and settings will be stored locally in")
    print(f"  {short_path(config_path)}, readable only by you.")
    print("  They are used only against the Looker URL you provide — never sent to Google, Anthropic,")
    print("  or any third party. See SECURITY.md.\n")

    looker_url = ""
    for _ in range(3):
        url_in = read_input(
            f"  {BOLD}Looker instance URL (e.g. {BOLD_YELLOW}https://mycompany.looker.com{NC}{BOLD}): {NC}"
        )
        norm_url = normalize_url(url_in)
        if norm_url:
            looker_url = norm_url
            if norm_url != url_in.strip().strip('"').strip("'"):
                print(f"  Using {BOLD_YELLOW}{looker_url}{NC}")
            break
        print(f"  {RED}Please enter a valid Looker URL, e.g. https://mycompany.looker.com{NC}")
    if not looker_url:
        print("Error: Invalid Looker URL entered.", file=sys.stderr)
        return 1

    client_id = read_input(f"  {BOLD}Looker API client_id: {NC}").strip()
    client_secret = read_input(f"  {BOLD}Looker API client_secret: {NC}", secret=True).strip()
    print("")

    if not client_id or not client_secret:
        print("Error: Client ID and Client Secret are required.", file=sys.stderr)
        return 1

    prev_folder = "1"
    if config_path.is_file():
        try:
            with open(config_path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
                prev_folder = str(data.get("publish_folder_id") or "1")
        except Exception:
            prev_folder = "1"

    folder_in = read_input(
        f"  {BOLD}Looker folder ID to publish dashboards into [{BOLD_YELLOW}{prev_folder}{NC}{BOLD}]: {NC}"
    ).strip()
    folder = folder_in if folder_in else prev_folder
    print("")

    write_config(
        config_path,
        looker_url,
        client_id,
        client_secret,
        folder,
        toolkit_url,
        pinned_url,
        canonical_toolkit,
        canonical_browser,
    )
    print(f"  Wrote {BOLD_YELLOW}{short_path(config_path)}{NC}, readable only by you.")
    return 0


def link_claude_skills(repo_root: Path) -> None:
    claude_skills = repo_root / ".claude" / "skills"
    skills_dir = repo_root / "skills"
    if not skills_dir.is_dir():
        return
    claude_skills.mkdir(parents=True, exist_ok=True)
    for s in skills_dir.iterdir():
        if s.is_dir():
            target_link = claude_skills / s.name
            target_rel = Path("../..") / "skills" / s.name
            try:
                if target_link.is_symlink() or target_link.is_file():
                    target_link.unlink()
                elif target_link.is_dir():
                    shutil.rmtree(target_link)
                target_link.symlink_to(target_rel, target_is_directory=True)
            except OSError:
                try:
                    shutil.copytree(s, target_link, dirs_exist_ok=True)
                except Exception:
                    pass


def pin_runtime_url(repo_root: Path, url: str) -> None:
    config_path = repo_root / "data-apps-config.json"
    if not url or not config_path.is_file():
        return
    try:
        write_config(config_path, assets_url=url, canonical_assets_base="")
        print(f"  pinned runtime URL: {url}")
    except Exception as e:
        print(f"Warning: Failed to pin runtime URL: {e}", file=sys.stderr)


def secure_credential_permissions(repo_root: Path) -> None:
    for rel in [
        "data-apps-config.json",
        "skills/data-app-creator/config.json",
    ]:
        p = repo_root / rel
        if p.is_file():
            try:
                os.chmod(p, 0o600)
            except (OSError, Exception):
                pass


def _free_backup_path(path: Path) -> Path:
    """Find an unused backup path, appending .1, .2... on same-second collision."""
    ts = int(time.time())
    bak_path = path.with_name(f"{path.name}.corrupt.{ts}.bak")
    if not bak_path.exists():
        return bak_path
    counter = 1
    while True:
        candidate = path.with_name(f"{path.name}.corrupt.{ts}.{counter}.bak")
        if not candidate.exists():
            return candidate
        counter += 1


def _wait_child(proc: subprocess.Popen) -> int:
    """Wait for child process; on KeyboardInterrupt give child up to 30s to clean up."""
    try:
        return proc.wait()
    except KeyboardInterrupt:
        # Child process receives the same SIGINT. Wait up to 30s for it to finish cleanup.
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        raise


def main() -> int:
    custom_root = None
    for arg in sys.argv[1:]:
        if arg in ("-h", "--help"):
            print("Usage: bootstrap.py [install_dir]")
            print("Set up Looker credentials and initialize the Data Apps environment.")
            return 0
        if arg.startswith("-"):
            print(f"error: unrecognized option '{arg}'", file=sys.stderr)
            print("Usage: bootstrap.py [install_dir]", file=sys.stderr)
            print("Set up Looker credentials and initialize the Data Apps environment.", file=sys.stderr)
            return 2
        if custom_root is None:
            custom_root = arg
        else:
            print("error: too many arguments", file=sys.stderr)
            print("Usage: bootstrap.py [install_dir]", file=sys.stderr)
            print("Set up Looker credentials and initialize the Data Apps environment.", file=sys.stderr)
            return 2

    repo_root = resolve_repo_root(custom_root)
    os.chdir(repo_root)

    config_path = repo_root / "data-apps-config.json"

    # 1. Run configs-merger
    merger_report: dict = {}
    merger_py = Path(__file__).resolve().parent / "configs-merger.py"
    if merger_py.is_file():
        try:
            spec = importlib.util.spec_from_file_location("configs_merger", merger_py)
            if spec and spec.loader:
                cm = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(cm)
                cm.merge_configs(repo_root, report=merger_report)
        except Exception as e:
            print(f"Warning: configs-merger failed: {e}", file=sys.stderr)

    migrated_legacy = bool(merger_report.get("legacy_merged")) and config_path.is_file()

    # Read VERSION
    version = "0.9.0"
    for cand in [repo_root / "VERSION", Path(__file__).resolve().parent.parent / "VERSION"]:
        if cand.is_file():
            try:
                raw_v = cand.read_text(encoding="utf-8").strip()
                if raw_v:
                    version = raw_v.splitlines()[0].strip()
                    break
            except Exception:
                pass

    canonical_toolkit = CANONICAL_TOOLKIT_URL
    canonical_browser = CANONICAL_BROWSER_ASSETS_URL
    toolkit_url = (
        os.environ.get("DATA_APPS_TOOLKIT_URL")
        or os.environ.get("DATA_APPS_SHARED_BASE")
        or canonical_toolkit
    ).rstrip("/")
    browser_assets_url = (
        os.environ.get("DATA_APPS_BROWSER_ASSETS_URL")
        or os.environ.get("DATA_APPS_RUNTIME_ASSETS_URL")
        or os.environ.get("DATA_APPS_RUNTIME_URL")
        or canonical_browser
    ).rstrip("/")
    pinned_url = os.environ.get("CANVAS_RUNTIME_URL", browser_assets_url).rstrip("/")

    skip_verify = os.environ.get("DATA_APPS_SKIP_VERIFY", "").lower() in ("1", "true", "yes", "on")
    upgrade_mode = os.environ.get("DATA_APPS_UPGRADE_MODE", "").lower() in ("1", "true", "yes", "on")

    # Print banner
    if not os.environ.get("DATA_APPS_BANNER_SHOWN"):
        print_banner(version)
    else:
        print(f"{BOLD}Data Apps bootstrap — v{version}{NC}\n")

    print(f"{BOLD}[1/2]{NC} using install dir: {BOLD}{short_path(repo_root)}{NC}")

    # Configuration step
    if not config_path.is_file():
        print(f"\n{BOLD}[2/2]{NC} Configuration")
        if prompt_config(config_path, toolkit_url, pinned_url, canonical_toolkit, canonical_browser) != 0:
            return 1
    else:
        is_corrupt = False
        cfg = {}
        try:
            with open(config_path, "r", encoding="utf-8-sig") as f:
                loaded = json.load(f)
                if not isinstance(loaded, dict):
                    is_corrupt = True
                else:
                    cfg = loaded
        except Exception:
            is_corrupt = True

        if is_corrupt:
            bak_path = _free_backup_path(config_path)
            print(
                f"\nWarning: Existing {config_path.name} is corrupted. Backing up to {bak_path.name} and re-prompting.",
                file=sys.stderr,
            )
            try:
                os.replace(config_path, bak_path)
                try:
                    os.chmod(bak_path, 0o600)
                except OSError:
                    pass
            except Exception as e:
                print(f"Warning: could not back up corrupt file {config_path.name}: {e}", file=sys.stderr)
            print(f"\n{BOLD}[2/2]{NC} Configuration")
            if prompt_config(config_path, toolkit_url, pinned_url, canonical_toolkit, canonical_browser) != 0:
                return 1
        else:
            if upgrade_mode:
                print(f"  Keeping existing configuration.{NC}")
                link_claude_skills(repo_root)
                if os.environ.get("CANVAS_RUNTIME_URL"):
                    pin_runtime_url(repo_root, pinned_url)
                secure_credential_permissions(repo_root)
                print(f"✅ Toolkit upgraded to {version}. Configuration preserved in data-apps-config.json.")
                return 0

            if migrated_legacy:
                print(f"\n{BOLD}[2/2]{NC} Consolidated settings from legacy config files into {short_path(config_path)}:")
            else:
                print(f"\n{BOLD}[2/2]{NC} Existing data-apps-config.json found:")
            print("")
            show_config(config_path)
            if ask_yn("  Keep these settings?"):
                print(f"  Keeping existing configuration.{NC}")
            else:
                if prompt_config(config_path, toolkit_url, pinned_url, canonical_toolkit, canonical_browser) != 0:
                    return 1

    # Link skills
    link_claude_skills(repo_root)

    # Explicit pin
    if os.environ.get("CANVAS_RUNTIME_URL"):
        pin_runtime_url(repo_root, pinned_url)

    # Creator config permissions if present
    secure_credential_permissions(repo_root)

    # Verify install
    if skip_verify:
        print(f"\n{BOLD}Skipping the Looker capability check (toolkit upgrade).{NC}")
    else:
        print(f"\n{BOLD}Verifying this install can publish...{NC}")
        verify_script = repo_root / "scripts" / "verify-install.py"
        if verify_script.is_file():
            proc = subprocess.Popen(
                ["python3", "scripts/verify-install.py", "--config", str(config_path)],
                executable=sys.executable,
                cwd=str(repo_root),
            )
            rc = _wait_child(proc)
            if rc != 0:
                print("")
                print(f"{YELLOW}The install is in place, but this instance cannot publish yet.{NC}")
                print("The message above says which part is missing and who can fix it.")
                print("Everything else is set up; re-run the check once it's resolved:")
                print(f"  {YELLOW}{sys.executable} {repo_root}/scripts/verify-install.py{NC}")

    if upgrade_mode:
        print(f"✅ Toolkit upgraded to {version}. Configuration preserved in data-apps-config.json.")
        return 0

    # Done
    print(f"\n{GREEN}Installation complete.{NC}\n")
    print(f"{BLUE}Next steps:{NC}")
    print(f"  {BOLD}1.{NC} cd {short_path(repo_root)}")
    print(f"  {BOLD}2.{NC} Open your AI agent (Claude Code, Antigravity, Codex...)")
    print(f"  {BOLD}3.{NC} Ask it to build your first app.")
    print("     The data-app-creator skill inspects your LookML explores, builds")
    print("     the app, previews it locally, and publishes when you say so.\n")

    print(f"{BOLD}Install dir:{NC} {short_path(repo_root)}")
    print(f"{BOLD}Config:{NC}      {short_path(config_path)}")
    print(f"{BOLD}Version:{NC}     {version}\n")

    print("Data handling: see SECURITY.md and PRIVACY.md.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nSetup cancelled.", file=sys.stderr)
        sys.exit(130)
