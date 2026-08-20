#!/usr/bin/env bash
# Idempotently installs the optional Codex lifecycle bridge into
# ~/.codex/hooks.json (or the Windows-side equivalent). Claude Code's hook installer is intentionally separate:
# the two products own different config files, but they converge on the same
# normalized event log inside the plugin.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="wsl"
for arg in "$@"; do
  case "$arg" in
    --target=wsl|--target=windows) TARGET="${arg#--target=}" ;;
    *) echo "usage: $0 [--target=wsl|--target=windows]" >&2; exit 2 ;;
  esac
done

case "$TARGET" in
  wsl)
    CODEX_HOME_DIR="${CODEX_HOME:-${HOME}/.codex}"
    SETTINGS_PATH="${CODEX_HOME_DIR}/hooks.json"
    HOOK_CMD="${ROOT}/hooks/codex-notification.sh"
    ;;
  windows)
    if [ "$(uname -s)" = "Darwin" ]; then
      echo "error: --target=windows is not supported on macOS" >&2
      exit 2
    fi
    WIN_USER="${WIN_USER:-julie}"
    WIN_HOME="/mnt/c/Users/${WIN_USER}"
    WSL_DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"
    if [ ! -d "$WIN_HOME" ]; then
      echo "error: Windows user dir not found at $WIN_HOME (set WIN_USER env var)" >&2
      exit 1
    fi
    CODEX_HOME_DIR="${WIN_HOME}/.codex"
    SETTINGS_PATH="${CODEX_HOME_DIR}/hooks.json"
    PS1_UNC="//wsl.localhost/${WSL_DISTRO}${ROOT}/hooks/codex-notification.ps1"
    HOOK_CMD="powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${PS1_UNC}"
    ;;
esac

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 2
fi
if [ "$TARGET" = "wsl" ] && [ ! -x "$HOOK_CMD" ]; then
  chmod +x "$HOOK_CMD"
fi

mkdir -p "$CODEX_HOME_DIR"
if [ ! -f "$SETTINGS_PATH" ]; then
  echo '{}' > "$SETTINGS_PATH"
fi
BACKUP="${SETTINGS_PATH}.bak.$(date +%Y%m%d)"
[ -f "$BACKUP" ] || cp "$SETTINGS_PATH" "$BACKUP"

# Remove only this bridge's previous entries. Other Codex hooks remain intact.
PRUNE_FILTER='
  .hooks //= {}
  | .hooks |= with_entries(
      .value |= map(
        .hooks |= map(
          select((.command // "") | test("streamdeck-claude.*codex-notification\\.(sh|ps1)") | not)
        )
        | select(.hooks | length > 0)
      )
      | select(.value | length > 0)
    )
'
TMP="$(mktemp)"
jq "$PRUNE_FILTER" "$SETTINGS_PATH" > "$TMP"
mv "$TMP" "$SETTINGS_PATH"

if [ "$TARGET" = "windows" ]; then
  JQ_FILTER='
    .hooks //= {}
    | .hooks[$event] //= []
    | .hooks[$event] += [{"matcher": "", "hooks": [{"type": "command", "command": $cmd, "commandWindows": $cmd}]}]
  '
else
  JQ_FILTER='
    .hooks //= {}
    | .hooks[$event] //= []
    | .hooks[$event] += [{"matcher": "", "hooks": [{"type": "command", "command": $cmd}]}]
  '
fi

for event in SessionStart UserPromptSubmit PreToolUse PermissionRequest PostToolUse SubagentStart SubagentStop Stop SessionEnd; do
  TMP="$(mktemp)"
  jq --arg event "$event" --arg cmd "$HOOK_CMD" "$JQ_FILTER" "$SETTINGS_PATH" > "$TMP"
  mv "$TMP" "$SETTINGS_PATH"
done

echo "Codex hook command:"
echo "  $HOOK_CMD"
echo "Registered for: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, SubagentStart, SubagentStop, Stop, SessionEnd"
echo "Settings: $SETTINGS_PATH (backup at $BACKUP)"
if [ "$TARGET" = "windows" ]; then
  echo "Windows hook uses: hooks/codex-notification.ps1"
fi
echo "Review/trust it in Codex with /hooks, then start a new Codex session."
