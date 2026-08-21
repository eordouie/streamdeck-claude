# Codex hook bridge for Windows-native Codex sessions.
# Mirrors hooks/codex-notification.sh and writes the same bridge records under
# %USERPROFILE%\.codex\streamdeck\sessions (or %CODEX_HOME%).

$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$payload = [Console]::In.ReadToEnd()

try { $obj = $payload | ConvertFrom-Json } catch { Write-Output '{}'; exit }
$sessionId = [string]$obj.session_id
$eventName = [string]$obj.hook_event_name
if (-not $sessionId -or -not $eventName -or $sessionId -notmatch '^[A-Za-z0-9._-]+$') {
    Write-Output '{}'
    exit
}

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$sessionsDir = Join-Path $codexHome 'streamdeck\sessions'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$target = Join-Path $sessionsDir "$sessionId.events.ndjson"
$metaPath = Join-Path $sessionsDir "$sessionId.json"

if ($eventName -eq 'SessionStart' -and [string]$obj.source -eq 'compact') {
    Write-Output '{}'
    exit
}
# Partial mirror of the .sh gate: events for a session that has no record must
# not create one. The .sh side also refuses the record's BIRTH when the codex
# process has no tty on fd 0 (ghost tiles from `codex mcp-server` and the
# ChatGPT desktop app's `codex app-server`, which share CODEX_HOME and its
# hooks); Windows has no cheap fd-0 probe from a hook, so that half is
# unmirrored here.
if ($eventName -ne 'SessionStart' -and -not (Test-Path $metaPath)) {
    Write-Output '{}'
    exit
}
New-Item -ItemType Directory -Force -Path $sessionsDir | Out-Null
if ($eventName -eq 'SessionStart') {
    [System.IO.File]::WriteAllText($target, '', $utf8NoBom)
}

$cwd = [string]$obj.cwd
$transcript = [string]$obj.transcript_path
$prompt = [string]$obj.prompt
if ($prompt.Length -gt 200) { $prompt = $prompt.Substring(0, 200) }
$launchId = [string]$env:STREAMDECK_LAUNCH_ID
$termKind = ''
if ($eventName -eq 'SessionStart') {
    if ($env:TERM_PROGRAM -eq 'vscode' -or $env:VSCODE_PID -or $env:VSCODE_GIT_IPC_HANDLE) {
        $termKind = 'vscode'
    } elseif ($env:TERM_PROGRAM -eq 'WarpTerminal') {
        $termKind = 'warp'
    } elseif ($env:TERM_PROGRAM -eq 'ghostty') {
        $termKind = 'ghostty'
    } else {
        $termKind = 'other'
    }
}

$ts = [int64](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds())
$entry = [ordered]@{ ts = $ts; event = $eventName }
if ($obj.tool_name) { $entry.tool = [string]$obj.tool_name }
if ($termKind) { $entry.term = $termKind }
if ($transcript) { $entry.transcript = $transcript }
if ($prompt) { $entry.prompt = $prompt }
if ($launchId) { $entry.launchId = $launchId }
$line = $entry | ConvertTo-Json -Compress
[System.IO.File]::AppendAllText($target, $line + [Environment]::NewLine, $utf8NoBom)

$startedAt = $ts
$previousTranscript = ''
$previousLaunchId = ''
if (Test-Path $metaPath) {
    try {
        $old = Get-Content $metaPath -Raw | ConvertFrom-Json
        if ($old.startedAt) { $startedAt = [int64]$old.startedAt }
        $previousTranscript = [string]$old.transcriptPath
        $previousLaunchId = [string]$old.launchId
    } catch {}
}
if ($eventName -eq 'SessionStart') { $startedAt = $ts }
if (-not $transcript) { $transcript = $previousTranscript }
if ($eventName -ne 'SessionStart' -or -not $launchId) { $launchId = $previousLaunchId }

$status = 'idle'
if ($eventName -in @('UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart')) { $status = 'busy' }
if ($eventName -eq 'PermissionRequest') { $status = 'waiting' }
$active = $eventName -ne 'SessionEnd'
$metadata = [ordered]@{
    sessionId = $sessionId
    cwd = $cwd
    startedAt = $startedAt
    updatedAt = $ts
    active = $active
    status = $status
}
if ($transcript) { $metadata.transcriptPath = $transcript }
if ($termKind) { $metadata.terminal = $termKind }
if ($launchId) { $metadata.launchId = $launchId }

$tmp = Join-Path $sessionsDir ".session-$([guid]::NewGuid()).json"
[System.IO.File]::WriteAllText($tmp, ($metadata | ConvertTo-Json -Compress), $utf8NoBom)
Move-Item -Force -Path $tmp -Destination $metaPath

Write-Output '{}'
