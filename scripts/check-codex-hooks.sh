#!/usr/bin/env bash
# Verify the optional Codex hook bridge registration.

set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-${HOME}/.codex}"
SETTINGS_PATH="${CODEX_HOME_DIR}/hooks.json"
TARGET="wsl"
for arg in "$@"; do
  case "$arg" in
    --target=wsl|--target=windows) TARGET="${arg#--target=}" ;;
    *) echo "usage: $0 [--target=wsl|--target=windows]" >&2; exit 2 ;;
  esac
done
if [ "$TARGET" = "windows" ]; then
  WIN_USER="${WIN_USER:-julie}"
  CODEX_HOME_DIR="/mnt/c/Users/${WIN_USER}/.codex"
  SETTINGS_PATH="${CODEX_HOME_DIR}/hooks.json"
fi
HOOK_REGEX="streamdeck-claude.*codex-notification\\.(sh|ps1)"
EXPECTED_EVENTS=(SessionStart UserPromptSubmit PreToolUse PermissionRequest PostToolUse SubagentStart SubagentStop Stop SessionEnd)

if [ ! -f "$SETTINGS_PATH" ]; then
  echo "Codex hooks missing: $SETTINGS_PATH"
  exit 1
fi
if ! jq empty "$SETTINGS_PATH" 2>/dev/null; then
  echo "Codex hooks invalid JSON: $SETTINGS_PATH"
  exit 1
fi

ALL_OK=1
for event in "${EXPECTED_EVENTS[@]}"; do
  if jq -e --arg event "$event" --arg re "$HOOK_REGEX" '
      any(.hooks[$event][]?;
        (.matcher // "") == "" and any(.hooks[]?; (((.command // "") + (.commandWindows // "")) | test($re))))
    ' "$SETTINGS_PATH" >/dev/null 2>&1; then
    echo "ok  $event"
  else
    echo "missing  $event"
    ALL_OK=0
  fi
done

if [ "$ALL_OK" -eq 1 ]; then
  echo "Codex hooks verified."
else
  if [ "$TARGET" = "windows" ]; then
    echo "Run: pnpm install:codex-hook:windows"
  else
    echo "Run: pnpm install:codex-hook"
  fi
  exit 1
fi
