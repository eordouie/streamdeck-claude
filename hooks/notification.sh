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

# agent_id is present on every hook fire that happened INSIDE a subagent
# (tool events included) and absent on main-thread fires. The reducer uses it
# as a live-set key: SubagentStart/Stop are NOT a matched pair (measured
# 2026-08-20: 21 starts vs 178 stops in one workflow session), so depth
# counting is broken without it.
AGENT_ID="$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null || true)"

# SubagentStop (and only it) carries background_tasks: the authoritative
# snapshot of still-running tasks. Project the running SUBAGENT ids; shells
# are the bg-job tiles' domain. Distinguish absent (null → no claim, old CC)
# from present-but-empty ([] → nothing running).
BGIDS_JSON='null'
if [ "$EVENT" = "SubagentStop" ]; then
  BGIDS_JSON="$(printf '%s' "$INPUT" | jq -c 'if (.background_tasks | type) == "array" then [.background_tasks[] | select(.type == "subagent" and .status == "running") | .id] else null end' 2>/dev/null || echo 'null')"
  [ -z "$BGIDS_JSON" ] && BGIDS_JSON='null'
fi

mkdir -p "$SESSIONS_DIR"
TARGET="${SESSIONS_DIR}/${SESSION_ID}.events.ndjson"

# SessionEnd: drop the log. The one-word .deckname sidecar deliberately
# survives — plain `claude --resume` reuses the session id, so the word is
# reclaimed after a reboot; dormant sidecars age out in the plugin's sweep.
if [ "$EVENT" = "SessionEnd" ]; then
  rm -f "$TARGET"
  echo '{}'
  exit 0
fi

# SessionStart: truncate before appending so the file always begins with the
# matching SessionStart entry — bounds long-lived sessions from growing forever.
# EXCEPT on compaction: CC fires SessionStart with source=compact mid-session
# (and possibly mid-turn). Truncating there wipes the reducer's inTurn state,
# after which every in-turn Notification — permission prompts included — is
# discarded for the rest of the turn. A compact changes nothing this log
# models, so skip the event entirely and keep state continuity.
if [ "$EVENT" = "SessionStart" ]; then
  SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null || true)"
  if [ "$SOURCE" = "compact" ]; then
    echo '{}'
    exit 0
  fi
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
LAUNCH_ID="${STREAMDECK_LAUNCH_ID:-}"

# jq -nc builds the JSON so embedded quotes/backslashes in tool names can't
# corrupt the line. Atomic single-write append (line is well under PIPE_BUF).
# Perl (rather than `date +%s%3N`) because BSD date on macOS doesn't grok %N
# and emits a literal "3N" suffix — perl is present on both macOS and Ubuntu.
# The date fallback (second precision) exists because this line runs under
# set -e: a missing/broken perl used to abort the script here, silently
# losing the event with no error anywhere.
TS_MS="$(perl -MTime::HiRes -e 'printf "%d", Time::HiRes::time()*1000' 2>/dev/null || echo "$(($(date +%s) * 1000))")"

# For TodoWrite we also snapshot the list's statuses so the plugin can draw a
# progress column. Project tool_input.todos[*].status into a JSON array; on
# any parse failure fall back to null (= don't emit the field).
TODOS_JSON='null'
if [ "$TOOL_NAME" = "TodoWrite" ]; then
  TODOS_JSON="$(printf '%s' "$INPUT" | jq -c '[(.tool_input.todos // [])[] | .status]' 2>/dev/null || echo 'null')"
  [ -z "$TODOS_JSON" ] && TODOS_JSON='null'
fi

# The printf fallback keeps the EVENT itself alive if jq dies mid-run (jq
# gone from PATH, OOM): tool/notif detail is lost but the reducer's turn
# bookkeeping survives — a silently dropped Stop or UserPromptSubmit is a
# stuck tile. $EVENT is jq-extracted upstream, so it is a plain identifier.
jq -nc \
  --argjson ts "$TS_MS" \
  --arg event "$EVENT" \
  --arg tool "$TOOL_NAME" \
  --arg notifType "$NOTIF_TYPE" \
  --arg term "$TERM_KIND" \
  --arg transcript "$TRANSCRIPT" \
  --arg prompt "$PROMPT" \
  --arg launchId "$LAUNCH_ID" \
  --arg agentId "$AGENT_ID" \
  --argjson todos "$TODOS_JSON" \
  --argjson bgIds "$BGIDS_JSON" \
  '{ts: $ts, event: $event}
   | (if $tool       != ""   then . + {tool:       $tool}       else . end)
   | (if $notifType  != ""   then . + {notifType:  $notifType}  else . end)
   | (if $term       != ""   then . + {term:       $term}       else . end)
   | (if $transcript != ""   then . + {transcript: $transcript} else . end)
   | (if $prompt     != ""   then . + {prompt:     $prompt}     else . end)
   | (if $launchId   != ""   then . + {launchId:   $launchId}   else . end)
   | (if $agentId    != ""   then . + {agentId:    $agentId}    else . end)
   | (if $todos      != null then . + {todos:      $todos}      else . end)
   | (if $bgIds      != null then . + {bgIds:      $bgIds}      else . end)' \
  >> "$TARGET" \
  || printf '{"ts":%d,"event":"%s"}\n' "$TS_MS" "$EVENT" >> "$TARGET" \
  || true

echo '{}'
