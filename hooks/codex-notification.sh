#!/usr/bin/env bash
# Codex hook bridge for the Stream Deck agent-session plugin.
#
# Codex exposes lifecycle hooks, but unlike Claude Code it does not write a
# per-process session JSON file. This adapter creates a tiny record under
# ~/.codex/streamdeck/sessions and appends the same normalized NDJSON event
# format consumed by src/session-events.ts.

set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-${HOME}/.codex}"
SESSIONS_DIR="${CODEX_HOME_DIR}/streamdeck/sessions"
INPUT="$(cat)"

SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
TRANSCRIPT="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
PROMPT="$(printf '%s' "$INPUT" | jq -r '(.prompt // "") | .[0:200]' 2>/dev/null || true)"
LAUNCH_ID="${STREAMDECK_LAUNCH_ID:-}"
# The pid this records is load-bearing three times over: the plugin resolves the
# session's controlling tty from it to stamp the tab title (OSC-2), checks it for
# liveness, and signals it on a kill-hold. $PPID alone is not good enough --
# depending on how Codex spawns the hook, it can be a wrapping shell rather than
# the codex process, and a shell's tty/lifetime is not the session's. So walk up
# the parent chain to the nearest process that actually is codex. If $PPID IS
# codex the loop exits on the first step, so this is never worse.
resolve_codex_pid() {
  local p="${PPID:-}" depth=0 comm
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null && [ "$depth" -lt 8 ]; do
    comm="$(ps -o comm= -p "$p" 2>/dev/null || true)"
    case "$comm" in
      *codex*) printf '%s' "$p"; return 0 ;;
    esac
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
    depth=$((depth + 1))
  done
  # No codex ancestor found: emit nothing rather than a wrong pid. A missing pid
  # costs the tab stamp; a wrong one could get an unrelated process killed.
  return 1
}
HOOK_PARENT_PID="$(resolve_codex_pid || true)"

# A session somebody is typing into has its terminal on fd 0; an embedded codex
# core gets a pipe. The same ~/.codex (hooks included) is shared by every codex
# frontend: `codex mcp-server` under a Claude session and the ChatGPT desktop
# app's bundled `codex app-server` both fire these hooks, and both used to land
# on the deck as ghost codex tiles — one per MCP tool call, one per desktop-app
# thread (2026-08-21). Same doctrine as readProcessIo in src/process-scan.ts.
fd0_is_tty() {
  local out
  out="$(lsof -a -d 0 -p "$1" -Fftn 2>/dev/null || true)"
  printf '%s\n' "$out" | grep -q '^tCHR$' || return 1
  printf '%s\n' "$out" | grep -Eq '^n/dev/(tty|pts)'
}

if [ -z "${SESSION_ID:-}" ] || [ -z "${EVENT:-}" ] || ! [[ "$SESSION_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo '{}'
  exit 0
fi

# A compaction SessionStart is a context event, not a new session. Keeping the
# existing log preserves inTurn and prevents a mid-turn approval from vanishing.
if [ "$EVENT" = "SessionStart" ]; then
  SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null || true)"
  if [ "$SOURCE" = "compact" ]; then
    echo '{}'
    exit 0
  fi
fi

TARGET="${SESSIONS_DIR}/${SESSION_ID}.events.ndjson"
META="${SESSIONS_DIR}/${SESSION_ID}.json"

# Record only terminal sessions. SessionStart is the gate: no codex ancestor or
# no tty on its fd 0 means no record is born. Every later event requires the
# record to already exist, so a rejected session's PostToolUse/Stop stream can
# never resurrect it — and a TUI session's later events (whose META exists)
# pass untouched.
if [ "$EVENT" = "SessionStart" ]; then
  if [ -z "$HOOK_PARENT_PID" ] || ! fd0_is_tty "$HOOK_PARENT_PID"; then
    echo '{}'
    exit 0
  fi
elif [ ! -f "$META" ]; then
  echo '{}'
  exit 0
fi

mkdir -p "$SESSIONS_DIR"

if [ "$EVENT" = "SessionStart" ]; then
  : > "$TARGET"
fi

TERM_KIND=""
if [ "$EVENT" = "SessionStart" ]; then
  if [ "${TERM_PROGRAM:-}" = "vscode" ] || [ -n "${VSCODE_PID:-}" ] || [ -n "${VSCODE_GIT_IPC_HANDLE:-}" ]; then
    TERM_KIND="vscode"
  elif [ "${TERM_PROGRAM:-}" = "WarpTerminal" ]; then
    TERM_KIND="warp"
  elif [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then
    TERM_KIND="iterm"
  elif [ "${TERM_PROGRAM:-}" = "ghostty" ]; then
    TERM_KIND="ghostty"
  else
    TERM_KIND="other"
  fi
fi

TS_MS="$(perl -MTime::HiRes -e 'printf "%d", Time::HiRes::time()*1000' 2>/dev/null || echo "$(($(date +%s) * 1000))")"

# Keep the normalized event shape deliberately boring: the same reducer can
# now consume Claude Code and Codex without knowing which hook emitted it.
jq -nc \
  --argjson ts "$TS_MS" \
  --arg event "$EVENT" \
  --arg tool "$TOOL_NAME" \
  --arg term "$TERM_KIND" \
  --arg transcript "$TRANSCRIPT" \
  --arg prompt "$PROMPT" \
  --arg launchId "$LAUNCH_ID" \
  '{ts: $ts, event: $event}
   | (if $tool       != "" then . + {tool: $tool}             else . end)
   | (if $term       != "" then . + {term: $term}             else . end)
   | (if $transcript != "" then . + {transcript: $transcript} else . end)
   | (if $prompt     != "" then . + {prompt: $prompt}         else . end)
   | (if $launchId   != "" then . + {launchId: $launchId}     else . end)' \
  >> "$TARGET" \
  || true

PREVIOUS_STARTED="0"
PREVIOUS_TRANSCRIPT=""
PREVIOUS_PID=""
PREVIOUS_LAUNCH_ID=""
if [ -f "$META" ]; then
  PREVIOUS_STARTED="$(jq -r '.startedAt // 0' "$META" 2>/dev/null || echo 0)"
  PREVIOUS_TRANSCRIPT="$(jq -r '.transcriptPath // empty' "$META" 2>/dev/null || true)"
  PREVIOUS_PID="$(jq -r '.pid // empty' "$META" 2>/dev/null || true)"
  PREVIOUS_LAUNCH_ID="$(jq -r '.launchId // empty' "$META" 2>/dev/null || true)"
fi
if ! [[ "$PREVIOUS_STARTED" =~ ^[0-9]+$ ]] || [ "$PREVIOUS_STARTED" -le 0 ] || [ "$EVENT" = "SessionStart" ]; then
  PREVIOUS_STARTED="$TS_MS"
fi
[ -n "$TRANSCRIPT" ] || TRANSCRIPT="$PREVIOUS_TRANSCRIPT"
if [ "$EVENT" != "SessionStart" ]; then
  HOOK_PARENT_PID="$PREVIOUS_PID"
elif ! [[ "$HOOK_PARENT_PID" =~ ^[0-9]+$ ]] || [ "$HOOK_PARENT_PID" -le 0 ]; then
  HOOK_PARENT_PID="$PREVIOUS_PID"
fi
if [ "$EVENT" != "SessionStart" ] || [ -z "$LAUNCH_ID" ]; then
  LAUNCH_ID="$PREVIOUS_LAUNCH_ID"
fi

STATUS="idle"
case "$EVENT" in
  UserPromptSubmit|PreToolUse|PostToolUse|SubagentStart) STATUS="busy" ;;
  PermissionRequest) STATUS="waiting" ;;
  Stop|SessionEnd) STATUS="idle" ;;
esac

ACTIVE=true
if [ "$EVENT" = "SessionEnd" ]; then ACTIVE=false; fi

# Write metadata atomically so the plugin never parses a half-written record.
TMP="$(mktemp "${SESSIONS_DIR}/.session.XXXXXX")"
jq -n \
  --arg sid "$SESSION_ID" \
  --arg cwd "$CWD" \
  --arg transcript "$TRANSCRIPT" \
  --arg term "$TERM_KIND" \
  --arg status "$STATUS" \
  --arg pid "$HOOK_PARENT_PID" \
  --arg launchId "$LAUNCH_ID" \
  --argjson startedAt "$PREVIOUS_STARTED" \
  --argjson updatedAt "$TS_MS" \
  --argjson active "$ACTIVE" \
  '{sessionId: $sid, cwd: $cwd, startedAt: $startedAt, updatedAt: $updatedAt,
    active: $active, status: $status}
   | (if $transcript != "" then . + {transcriptPath: $transcript} else . end)
   | (if $term != "" then . + {terminal: $term} else . end)
   | (if $launchId != "" then . + {launchId: $launchId} else . end)
   | (if ($pid | test("^[0-9]+$")) then . + {pid: ($pid | tonumber)} else . end)' \
  > "$TMP"
mv -f "$TMP" "$META"

# Codex expects JSON for Stop/SubagentStop hooks; {} is a successful no-op for
# every event and keeps this bridge from steering the agent loop.
echo '{}'
