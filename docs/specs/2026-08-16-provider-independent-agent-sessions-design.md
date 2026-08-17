# Provider-Independent Agent Sessions

## Problem

Claude's current Stream Deck workflow is the reference experience: a gesture
launches one agent in Ghostty, the slot immediately becomes a mascot, the
session receives a stable identity, and pressing the mascot focuses the right
terminal session. Codex must provide that same experience without invoking,
depending on, or being routed through Claude.

The current implementation launches only the selected command on a hold, but
the control path is still Claude-shaped: slot settings use `emptyScript`, the
launcher is named `ghostty-new-claude.sh`, and shared code contains direct
Claude/Codex branches. Codex startup can also take long enough that its
`SessionStart` record arrives almost simultaneously with the first prompt.

## Goals

- Preserve Claude's current behavior exactly.
- Give Codex the same behavior independently: launch, mascot, naming, tab
  identity, focus, state display, and cleanup.
- Make provider choice declarative at the gesture boundary.
- Keep provider-specific mechanics inside provider adapters.
- Allow a future provider to be added with one adapter and configuration
  mapping, without changing shared slot or gesture logic.
- Show a provider-neutral pending mascot immediately after a launch gesture,
  before slow provider startup completes.

## Non-goals

- Separate Stream Deck plugins or separate slot pools per provider.
- Unifying provider lifecycle events that a provider does not expose.
- Hiding meaningful provider limitations; the normalized state must degrade
  honestly when an event has no provider equivalent.
- Changing Claude's user-facing gesture or mascot behavior.

## Design

### 1. Provider registry

The plugin core consumes a registry of provider adapters. The core knows only
the normalized contract:

```ts
interface AgentProvider {
  id: string;
  launch: LaunchSpec;
  discover(): Promise<AgentSession[]>;
  isLive(session: AgentSession): Promise<boolean>;
  focus(session: AgentSession): Promise<FocusResult>;
  terminate(session: AgentSession): Promise<TerminateResult>;
}
```

`AgentSession` is the provider-neutral session shape used by slot ordering,
state tracking, naming, rendering, and pending-launch matching. Provider IDs
remain metadata on the session; they do not select a separate rendering or
gesture path.

The Claude and Codex adapters own their actual differences:

- on-disk session source and lifecycle bridge;
- event normalization and liveness mechanism;
- terminal-focus details;
- safe termination command;
- provider-specific launch command and environment.

The shared core must not contain new `if provider === ...` branches for these
concerns. Adding a provider means registering an adapter.

### 2. Declarative gesture configuration

The layout source maps gestures to provider IDs, rather than embedding one
provider as the default empty-slot command:

```toml
[providers.claude]
script = "ghostty-new-agent.sh"
args = ["claude"]

[providers.codex]
script = "ghostty-new-agent.sh"
args = ["codex"]

[[key]]
pos = "0,0"
kind = "slot"
tap_provider = "claude"
hold_provider = "codex"
```

The layout builder emits provider IDs and launch specs into the profile. The
slot action selects exactly one provider on gesture resolution. A hold does
not invoke the tap provider first, and there is no Claude fallback in the
Codex path.

### 3. Generic Ghostty launcher

Rename the launcher to `ghostty-new-agent.sh`. It retains the existing safe
Ghostty tab creation, focus assertion, new-tab race protection, and argument
handling. It accepts the selected provider's command and arguments without
knowing whether they belong to Claude, Codex, or a future CLI.

Provider-specific environment cleanup belongs in the adapter's launch spec.
The generic launcher must not set or clear Claude-specific variables for every
provider.

Each launch receives a generated `STREAMDECK_LAUNCH_ID`. Provider bridges copy
that ID into their normalized `SessionStart` metadata so the core can match a
new session to the pending slot without relying on cwd or timing guesses.

### 4. Provider-neutral pending state

When a tap or hold resolves, the slot enters `starting` immediately and renders
the same mascot treatment used by a live working session. The selected launch
then runs exactly once.

- On matching `SessionStart`, the pending tile becomes the real session tile.
- On launch failure, timeout, or an explicitly reported startup failure, the
  slot returns to empty and shows the existing alert behavior.
- A pending launch is keyed by slot and launch ID, so simultaneous launches
  cannot steal each other's state.
- Pending state is core state and is not special-cased for Claude or Codex.

### 5. Shared experience contract

For every registered provider, the acceptance contract is:

1. Gesture selects exactly one provider.
2. The slot shows a mascot immediately.
3. The provider's session replaces the pending tile when it registers.
4. The same naming and tab-title identity rules apply.
5. Pressing the tile focuses that provider's terminal session.
6. Busy, idle, awaiting, finished, and error states use the same visual
   treatment wherever the provider exposes enough lifecycle information.
7. Unsupported provider events degrade to a documented normalized state rather
   than silently pretending parity.

Provider identity may remain available as small metadata on the tile, but it
must not change the interaction model.

## Migration

- Replace `emptyScript`, `emptyArgs`, and `emptyHoldArgs` with provider IDs and
  provider launch specs in `layout.toml` and generated profile settings.
- Rename `ghostty-new-claude.sh` to `ghostty-new-agent.sh` while preserving its
  current Ghostty safety behavior.
- Move Claude and Codex session reading/lifecycle code behind the registry.
- Preserve existing session files and deck names during the transition.
- Apply the regenerated Stream Deck profile once; no separate Claude or Codex
  profile is required.

## Verification

Automated coverage will test:

- tap selects only Claude and hold selects only Codex;
- no provider launch path invokes the other provider;
- pending state renders before a provider session record exists;
- launch IDs associate concurrent launches with the correct slots;
- Claude and Codex normalize into the same slot pipeline;
- a third fixture provider can register without modifying core slot logic;
- existing Claude tests and rendering snapshots remain unchanged.

Manual smoke verification will cover tap, hold, no-prompt startup visibility,
focus, naming, state transitions, and cleanup for both current providers.
