#!/usr/bin/env bash
# Data Apps customer onboarding -- second-stage installer.
#
# Invoked by install.sh after the tarball is extracted (or directly
# from a git checkout for development). Walks the customer through:
#   1. Looker credentials & settings prompt -> data-apps-config.json.
#   2. Verify the instance can actually publish.
#
# There is no LookML step. Publishing stores the tile host as an inline
# extension, so there is no project to create, no manifest to push, no dev
# workspace, and no manual "Deploy to Production" in the Looker IDE -- which
# used to be the only part of this installer a person could get wrong.
#
# Idempotent: re-running is safe. Existing config files are shown
# with a keep/re-enter prompt rather than silently skipped.

set -euo pipefail

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[1;34m'
  CYAN='\033[1;36m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  BOLD=''
  NC=''
fi

resolve_python() {
  local candidate py_exec
  for candidate in "${DATA_APPS_PYTHON:-}" "${PYTHON:-}" python3 python "py -3"; do
    [ -n "$candidate" ] || continue
    if [ "$candidate" = "py -3" ]; then
      if command -v py >/dev/null 2>&1; then
        py_exec="$(py -3 -c "import sys; print(sys.executable.replace('\\\\', '/')) if sys.version_info >= (3, 9) else sys.exit(1)" 2>/dev/null | tr -d '\r')" || true
        if [ -n "$py_exec" ] && "$py_exec" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
          printf '%s\n' "$py_exec"
          return 0
        fi
      fi
    elif "$candidate" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(resolve_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  printf "%b" "${RED}${BOLD}error: Python 3.9+ is required (python3 is missing or older than 3.9).${NC}\n" >&2
  printf "%b" "${RED}Please install Python 3.9 or newer before running bootstrap.${NC}\n" >&2
  exit 1
fi
export DATA_APPS_PYTHON="$PYTHON_BIN"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$PARENT_DIR"

if [ "$(basename "$PARENT_DIR")" = "dist" ] && { [ -f "$SCRIPT_DIR/../../scripts/publish.sh" ] || [ -d "$SCRIPT_DIR/../../.git" ]; }; then
  # Running from dist/ inside the data-apps developer repository
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  # Customer installation: search upwards for config files, stopping at install root
  CUR="$SCRIPT_DIR"
  while [ "$CUR" != "/" ]; do
    if [ -f "$CUR/data-apps-config.json" ] || [ -f "$CUR/looker-config.json" ]; then
      REPO_ROOT="$CUR"
      break
    fi
    CUR="$(cd "$CUR/.." && pwd)"
  done
fi
cd "$REPO_ROOT"

CONFIG_PATH="$REPO_ROOT/data-apps-config.json"

short_path() {
  local p="$1"
  if [ -n "${HOME:-}" ] && { [ "$p" = "$HOME" ] || [ "${p#$HOME/}" != "$p" ]; }; then
    if [ "$p" = "$HOME" ]; then
      echo "~"
    else
      echo "~/${p#$HOME/}"
    fi
  else
    echo "$p"
  fi
}

MIGRATED_LEGACY=0
if [ -f "$CONFIG_PATH" ] || [ -f "$REPO_ROOT/looker-config.json" ] || [ -f "$REPO_ROOT/skills/data-app-creator/config.json" ]; then
  if [ -f "$SCRIPT_DIR/configs-merger.sh" ]; then
    had_legacy=0
    if [ -f "$REPO_ROOT/looker-config.json" ] || [ -f "$REPO_ROOT/skills/data-app-creator/config.json" ]; then
      had_legacy=1
    fi
    if bash "$SCRIPT_DIR/configs-merger.sh" "$REPO_ROOT"; then
      if [ "$had_legacy" -eq 1 ]; then
        MIGRATED_LEGACY=1
      fi
    fi
  fi
fi

VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || cat "$SCRIPT_DIR/../VERSION" 2>/dev/null || echo "0.9.0")"

# What this installer was published against. install.sh bakes both URLs in and
# exports them; running bootstrap directly out of the repo falls back to the
# canonical prefix. They are separate values because vendored libraries are
# shared by every version and live at the prefix root, so the runtime directory
# is no longer their parent.
CANONICAL_TOOLKIT_URL="https://dl.google.com/looker-data-apps"
CANONICAL_BROWSER_ASSETS="https://www.gstatic.com/looker-data-apps"
TOOLKIT_URL="${DATA_APPS_TOOLKIT_URL:-${DATA_APPS_SHARED_BASE:-$CANONICAL_TOOLKIT_URL}}"
TOOLKIT_URL="${TOOLKIT_URL%/}"
BROWSER_ASSETS_URL="${DATA_APPS_BROWSER_ASSETS_URL:-${DATA_APPS_RUNTIME_URL:-$CANONICAL_BROWSER_ASSETS}}"
BROWSER_ASSETS_URL="${BROWSER_ASSETS_URL%/}"

_PINNED_URL="${CANVAS_RUNTIME_URL:-$BROWSER_ASSETS_URL}"
_PINNED_URL="${_PINNED_URL%/}"

# Yes/no prompt defaulting to yes. Returns 0 unless the answer is n/N.
ask_yn() {
  read -rp "$(echo -e "\n${BOLD}$1 [Y/n]: ${NC}")" ans || true
  [ "${ans:-Y}" != "n" ] && [ "${ans:-Y}" != "N" ]
}

# show_config <json-file> <key>... — print the named keys so a re-run
# can offer keep/re-enter. Secrets print as "(hidden)".
show_config() {
  "$PYTHON_BIN" - "$@" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    cfg = json.load(f)
keys = sys.argv[2:]

if "target_url" in keys or "base_url" in keys:
    target = cfg.get("target_url")
    base = cfg.get("base_url")
    if target and base and target != base:
        looker_url = f"{target} (proxied via {base})"
    else:
        looker_url = target or base or "(missing)"
    print(f"    \033[1mLooker URL\033[0m: \033[0;33m{looker_url}\033[0m")
    for k in ["client_id", "client_secret", "publish_folder_id", "toolkit_url", "browser_assets_url"]:
        if k in keys and k in cfg:
            val = cfg.get(k, "(missing)")
            if k == "client_secret" and val != "(missing)": val = "(hidden)"
            print(f"    \033[1m{k}\033[0m: \033[0;33m{val}\033[0m")
else:
    for k in keys:
        default_missing = "(none)" if k in ("default_model", "default_explores") else "(missing)"
        val = cfg.get(k, default_missing)
        if isinstance(val, list): val = ", ".join(val)
        if k == "client_secret" and val != "(missing)":
            val = "(hidden)"
        print(f"    \033[1m{k}\033[0m: \033[0;33m{val}\033[0m")
PY
}

print_banner() {
  local version="${1:-$VERSION}"
  local v_str="v${version}"
  local w=56
  local pad_len=$(( w - ${#v_str} - 3 ))
  if [ "$pad_len" -lt 0 ]; then pad_len=0; fi
  local pad
  pad=$(printf "%*s" "$pad_len" "")

  echo -e "${BLUE}┌────────────────────────────────────────────────────────┐${NC}"
  echo -e "${BLUE}│${NC}                                                        ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}            ${CYAN}_                 _${NC}                         ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}| |    ___   ___  | | _____ _ __${NC}             ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}| |   / _ \ / _ \ | |/ / _ \ '__|${NC}            ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}| |__| (_) | (_) ||   <  __/ |${NC}               ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}           ${CYAN}|_____\___/ \___/ |_|\_\___|_|${NC}               ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}                                                        ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}     ${GREEN}____        _            _${NC}                         ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}|  _ \  __ _| |_ __ _    / \   _ __  _ __  ___${NC}      ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}| | | |/ _\` | __/ _\` |  / _ \ | '_ \| '_ \/ __|${NC}     ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}| |_| | (_| | || (_| | / ___ \| |_) | |_) \__ \ ${NC}    ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}    ${GREEN}|____/ \__,_|\__\__,_|/_/   \_\ .__/| .__/|___/${NC}     ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}                                  ${GREEN}|_|   |_|${NC}             ${BLUE}│${NC}"
  echo -e "${BLUE}│${NC}${pad}${YELLOW}${v_str}${NC}   ${BLUE}│${NC}"
  echo -e "${BLUE}└────────────────────────────────────────────────────────┘${NC}"
  echo ""
}

if [ -z "${DATA_APPS_BANNER_SHOWN:-}" ]; then
  print_banner "$VERSION"
else
  echo -e "${BOLD}Data Apps bootstrap — v${VERSION}${NC}\n"
fi
echo -e "${BOLD}[1/2]${NC} using install dir: ${BOLD}$(short_path "$REPO_ROOT")${NC}"

prompt_config() {
  echo ""
  echo "  Your Looker API credentials and settings will be stored locally in"
  echo -e "  $(short_path "$CONFIG_PATH"), readable only by you."
  echo "  They are used only against the Looker URL you provide — never sent to Google, Anthropic,"
  echo "  or any third party. See SECURITY.md."
  echo ""
  while true; do
    read -rp "$(echo -e "  ${BOLD}Looker instance URL (e.g. ${YELLOW}https://mycompany.looker.com${NC}${BOLD}): ${NC}")" LOOKER_URL_IN
    LOOKER_URL="$( { "$PYTHON_BIN" - "$LOOKER_URL_IN" <<'PY'
import sys, urllib.parse
raw = sys.argv[1].strip().strip('"').strip("'")
if not raw:
    sys.exit(1)
if "://" not in raw:
    raw = "https://" + raw
parts = urllib.parse.urlsplit(raw)
if parts.scheme not in ("http", "https") or not parts.netloc:
    sys.exit(1)
print(urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", "")))
PY
} | tr -d '\r')" && [ -n "$LOOKER_URL" ] && break
    echo -e "  ${RED}Please enter a valid Looker URL, e.g. https://mycompany.looker.com${NC}"
  done
  if [ "$LOOKER_URL" != "$LOOKER_URL_IN" ]; then
    echo -e "  Using ${YELLOW}${LOOKER_URL}${NC}"
  fi
  read -rp "$(echo -e "  ${BOLD}Looker API client_id: ${NC}")" LOOKER_CLIENT_ID_IN
  read -rsp "$(echo -e "  ${BOLD}Looker API client_secret: ${NC}")" LOOKER_CLIENT_SECRET_IN
  echo ""
  PREV_FOLDER="$("$PYTHON_BIN" -c "import json, sys; print(json.load(open(sys.argv[1], encoding='utf-8')).get('publish_folder_id', '1'))" "$CONFIG_PATH" 2>/dev/null | tr -d '\r' || true)"
  [ -z "$PREV_FOLDER" ] && PREV_FOLDER="1"
  read -rp "$(echo -e "  ${BOLD}Looker folder ID to publish dashboards into [${YELLOW}${PREV_FOLDER}${NC}${BOLD}]: ${NC}")" FOLDER_IN
  FOLDER="${FOLDER_IN:-$PREV_FOLDER}"
  echo ""
  "$PYTHON_BIN" - "$CONFIG_PATH" "$LOOKER_URL" "$LOOKER_CLIENT_ID_IN" "$LOOKER_CLIENT_SECRET_IN" "$FOLDER" "$_PINNED_URL" "$TOOLKIT_URL" "$CANONICAL_TOOLKIT_URL" "$CANONICAL_BROWSER_ASSETS" <<'PY'
import json, os, sys
path, url, cid, sec, folder, pinned_url, toolkit_url, canonical_toolkit, canonical_browser = sys.argv[1:10]
try:
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
except Exception:
    cfg = {}

url = url.strip().rstrip("/")
cfg["base_url"] = url
cfg["client_id"] = cid
cfg["client_secret"] = sec
cfg["publish_folder_id"] = folder.strip()

if toolkit_url != canonical_toolkit:
    cfg["toolkit_url"] = toolkit_url
else:
    cfg.pop("toolkit_url", None)
cfg.pop("shared_base_url", None)

if pinned_url != canonical_browser:
    cfg["browser_assets_url"] = pinned_url
else:
    cfg.pop("browser_assets_url", None)
cfg.pop("shared_runtime_url", None)

cfg.pop("use_proxy", None)
cfg.pop("proxy_port", None)
if cfg.get("target_url") == url or not ("127.0.0.1" in url or "localhost" in url):
    cfg.pop("target_url", None)

with open(path, "w", encoding="utf-8") as f:
    f.write(json.dumps(cfg, indent=2) + "\n")

# The file now holds a plaintext client_secret. The toolkit ships no
# .gitignore and nothing else guards this path, so do not leave it at
# whatever the umask happened to be -- usually world-readable 0644.
# chmod after the write rather than opening with a mode, because O_CREAT's
# mode is ignored when the file already exists, which is the upgrade case.
os.chmod(path, 0o600)
PY
  echo -e "  Wrote ${YELLOW}$(short_path "$CONFIG_PATH")${NC}, readable only by you."
}

if [ ! -f "$CONFIG_PATH" ]; then
  echo -e "\n${BOLD}[2/2]${NC} Configuration"
  prompt_config
else
  if [ "${MIGRATED_LEGACY:-0}" -eq 1 ]; then
    echo -e "\n${BOLD}[2/2]${NC} Consolidated settings from legacy config files into $(short_path "$CONFIG_PATH"):"
  else
    echo -e "\n${BOLD}[2/2]${NC} Existing data-apps-config.json found:"
  fi
  echo ""
  show_config "$CONFIG_PATH" base_url client_id client_secret publish_folder_id toolkit_url browser_assets_url
  if ask_yn "  Keep these settings?"; then
    echo -e "  Keeping existing configuration.${NC}"
  else
    prompt_config
  fi
fi

# Ensure project-scoped Claude Code skill directory links are ready
mkdir -p "$REPO_ROOT/.claude/skills"
for s in "$REPO_ROOT"/skills/*; do
  if [ -d "$s" ]; then
    sname="$(basename "$s")"
    rm -rf "$REPO_ROOT/.claude/skills/$sname" 2>/dev/null || true
    ln -snf "../../skills/$sname" "$REPO_ROOT/.claude/skills/$sname" 2>/dev/null || true
  fi
done

# An explicit pin has to beat a preserved config, not just the default: a
# config already on a live channel is not stale, so the reconciliation above
# leaves it alone and the pin would otherwise be silently ignored on any re-run.
if [ -n "${CANVAS_RUNTIME_URL:-}" ]; then
  "$PYTHON_BIN" - "$CONFIG_PATH" "$_PINNED_URL" <<'PY'
import json, sys

path, url = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data["browser_assets_url"] = url
data.pop("shared_runtime_url", None)
with open(path, "w", encoding="utf-8") as f:
    f.write(json.dumps(data, indent=2) + "\n")
print(f"  pinned runtime URL: {url}")
PY
fi

case "${DATA_APPS_SKIP_VERIFY:-}" in
  1|true|yes|on)
    echo -e "\n${BOLD}Skipping the Looker capability check (toolkit upgrade).${NC}"
    ;;
  *)
    echo -e "\n${BOLD}Verifying this install can publish...${NC}"
    # A capability check, not a formality: it creates a throwaway inline
    # extension, reads it back through the route Looker uses to load a tile, and
    # deletes it. That exercises the one thing publishing needs from the instance
    # and nothing else does, so a green result here means publishing will work.
    if "$PYTHON_BIN" "$REPO_ROOT/scripts/verify-install.py" --config "$CONFIG_PATH"; then
      :
    else
      echo ""
      echo -e "${YELLOW}The install is in place, but this instance cannot publish yet.${NC}"
      echo "The message above says which part is missing and who can fix it."
      echo "Everything else is set up; re-run the check once it's resolved:"
      printf '  %b%s %s/scripts/verify-install.py%b\n' "$YELLOW" "$PYTHON_BIN" "$REPO_ROOT" "$NC"
    fi
    ;;
esac

# ----------------------------------------------------------------------
# 3. Done
# ----------------------------------------------------------------------

echo -e "\n${GREEN}Installation complete.${NC}\n"

echo -e "${BLUE}Next steps:${NC}"
echo -e "  ${BOLD}1.${NC} cd $(short_path "$REPO_ROOT")"
echo -e "  ${BOLD}2.${NC} Open your AI agent (Claude Code, Antigravity, Codex...)"
echo -e "  ${BOLD}3.${NC} Ask it to build your first app."
echo -e "     The data-app-creator skill inspects your LookML explores, builds"
echo -e "     the app, previews it locally, and publishes when you say so.\n"

echo -e "${BOLD}Install dir:${NC} $(short_path "$REPO_ROOT")"
echo -e "${BOLD}Config:${NC}      $(short_path "$CONFIG_PATH")"
echo -e "${BOLD}Version:${NC}     $VERSION\n"

echo -e "Data handling: see SECURITY.md and PRIVACY.md."
