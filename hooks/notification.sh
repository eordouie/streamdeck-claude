#!/usr/bin/env bash
# Claude Code hook bridge for the streamdeck-claude plugin.
#
# Appends one JSON line per hook fire to <sid>.events.ndjson. The plugin
# reads the file each tick and replays the event stream through a state
# machine in src/session-events.ts to derive the icon state. To add a new
# event: register it in scripts/install-hook.sh + handle it in
# session-events.ts. No mapping table here.
#
# SessionStart truncates the log (clean reset). SessionEnd unlinks it.

set -euo pipefail

SESSIONS_DIR="${HOME}/.claude/sessions"
INPUT="$(cat)"

SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
# notification_type is set by CC on Notification events (permission_prompt,
# idle_prompt, elicitation_dialog, auth_success). Empty for non-Notification.
NOTIF_TYPE="$(printf '%s' "$INPUT" | jq -r '.notification_type // empty' 2>/dev/null || true)"

if [ -z "${SESSION_ID:-}" ] || [ -z "${EVENT:-}" ]; then
  echo '{}'
  exit 0
fi

mkdir -p "$SESSIONS_DIR"
TARGET="${SESSIONS_DIR}/${SESSION_ID}.events.ndjson"

# SessionEnd: drop the log and the one-time deck-name sidecar.
if [ "$EVENT" = "SessionEnd" ]; then
  rm -f "$TARGET" "${SESSIONS_DIR}/${SESSION_ID}.deckname"
  echo '{}'
  exit 0
fi

# SessionStart: truncate before appending so the file always begins with the
# matching SessionStart entry — bounds long-lived sessions from growing forever.
if [ "$EVENT" = "SessionStart" ]; then
  : > "$TARGET"
fi

# Terminal host, captured once at SessionStart for the focus-on-press feature.
# $TERM_PROGRAM is set by the terminal; VSCODE_* survive tmux/screen overwriting
# TERM_PROGRAM with "tmux". Canonical values mirror src/terminal-kind.ts.
# The transcript path is captured alongside: the plugin mines it for the
# session's aiTitle/customTitle, which is what the terminal tab is named.
TERM_KIND=""
TRANSCRIPT=""
if [ "$EVENT" = "SessionStart" ]; then
  TRANSCRIPT="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
fi
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

# The prompt text (UserPromptSubmit only, clipped to 200 codepoints) feeds the
# live "current discussion" key label — Claude's own aiTitle is generated once
# and stays sticky, so it can't track a topic change mid-session.
PROMPT=""
if [ "$EVENT" = "UserPromptSubmit" ]; then
  PROMPT="$(printf '%s' "$INPUT" | jq -r '(.prompt // "") | .[0:200]' 2>/dev/null || true)"
fi

# jq -nc builds the JSON so embedded quotes/backslashes in tool names can't
# corrupt the line. Atomic single-write append (line is well under PIPE_BUF).
# Perl (rather than `date +%s%3N`) because BSD date on macOS doesn't grok %N
# and emits a literal "3N" suffix — perl is present on both macOS and Ubuntu.
TS_MS="$(perl -MTime::HiRes -e 'printf "%d", Time::HiRes::time()*1000')"

# For TodoWrite we also snapshot the list's statuses so the plugin can draw a
# progress column. Project tool_input.todos[*].status into a JSON array; on
# any parse failure fall back to null (= don't emit the field).
TODOS_JSON='null'
if [ "$TOOL_NAME" = "TodoWrite" ]; then
  TODOS_JSON="$(printf '%s' "$INPUT" | jq -c '[(.tool_input.todos // [])[] | .status]' 2>/dev/null || echo 'null')"
  [ -z "$TODOS_JSON" ] && TODOS_JSON='null'
fi

jq -nc \
  --argjson ts "$TS_MS" \
  --arg event "$EVENT" \
  --arg tool "$TOOL_NAME" \
  --arg notifType "$NOTIF_TYPE" \
  --arg term "$TERM_KIND" \
  --arg transcript "$TRANSCRIPT" \
  --arg prompt "$PROMPT" \
  --argjson todos "$TODOS_JSON" \
  '{ts: $ts, event: $event}
   | (if $tool       != ""   then . + {tool:       $tool}       else . end)
   | (if $notifType  != ""   then . + {notifType:  $notifType}  else . end)
   | (if $term       != ""   then . + {term:       $term}       else . end)
   | (if $transcript != ""   then . + {transcript: $transcript} else . end)
   | (if $prompt     != ""   then . + {prompt:     $prompt}     else . end)
   | (if $todos      != null then . + {todos:      $todos}      else . end)' \
  >> "$TARGET"

echo '{}'
