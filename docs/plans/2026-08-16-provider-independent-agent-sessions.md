# Provider-Independent Agent Sessions Implementation Plan

> **Status:** implemented 2026-08-17. **The launch half is SUPERSEDED the same
> day** — Ehsan's call: a slot key opens a *bare* Ghostty tab and the agent is
> typed by hand, so there is no tap/hold gesture, no per-provider launch spec, and
> no `tapProvider`/`holdProvider`/`providerLaunches` anywhere. Everything about
> DISCOVERY (registry, adapters, normalized sessions, launch-id correlation,
> pending slot reservation) stands and is live. Read every "gesture selects a
> provider" statement below as history, not as the contract; the current contract
> is in `CLAUDE.md` under "A free slot opens a tab, it does not start an agent".
> No physical tap/hold test is owed any more — that gesture no longer exists.

> **For agentic workers:** REQUIRED SUB-SKILL: Use the executing-plans skill to implement this plan task-by-task (or per-task subagents via the Agent/Workflow tools — see Execution Handoff). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Claude's current Stream Deck experience while giving Codex and future AI CLIs the same behavior through independent provider adapters and declarative gesture mappings.

**Architecture:** The plugin core will consume a provider registry and normalized `AgentSession` records. Provider adapters will own launch metadata, lifecycle bridges, session discovery, liveness, focus, and termination; slot gestures and rendering will remain provider-neutral. The layout builder will emit provider IDs and launch specs, and a core pending-launch state will render a mascot before slow provider startup completes.

**Tech Stack:** TypeScript ESM, Node 20, `node:test`, pnpm, Rollup, Bash hooks, TOML layout configuration, Python profile generator, Stream Deck SDK.

## Global Constraints

- Preserve Claude's existing tap-to-launch, mascot, naming, tab-title, focus, state, and cleanup behavior.
- A Codex gesture launches only Codex; it must never invoke Claude or fall back to Claude.
- Provider-specific mechanics live behind adapters; shared slot and gesture code must not grow new provider branches.
- Keep the current macOS Ghostty safety checks, including focus assertion and new-tab race protection.
- Use `pnpm`, not npm or npx; run `pnpm test`, `pnpm build`, and `pnpm sd:validate` as the repository gate.
- Preserve unrelated uncommitted changes in `streamdeck-claude` and `dotfiles`.
- Do not push; commits are local only and use the workspace commit format.

---

## File map

### New files

- `src/provider-types.ts` — provider IDs, normalized session records, launch and adapter interfaces.
- `src/provider-registry.ts` — registry validation and provider lookup.
- `src/provider-registry.test.ts` — duplicate/unknown-provider and adapter contract tests.
- `src/pending-launch.ts` — pure pending-launch state machine and launch-ID matching.
- `src/pending-launch.test.ts` — pending launch lifecycle tests.
- `src/providers/claude.ts` — Claude adapter boundary around the existing reader/focus/termination behavior.
- `src/providers/codex.ts` — Codex adapter boundary around the existing bridge/reader/focus/termination behavior.
- `src/providers/index.ts` — built-in provider registry assembly.
- `src/launch-command.ts` — provider-neutral launch-ID and command-environment construction.
- `src/launch-command.test.ts` — launch-ID and environment isolation tests.
- `src/providers.test.ts` — provider fixture parity tests.
- `docs/specs/2026-08-16-provider-independent-agent-sessions-design.md` — approved design, already committed.

### External files in the shared dotfiles repo

- `/Users/ehsan/Projects/dotfiles/streamdeck/layout.toml` — provider declarations and gesture mappings.
- `/Users/ehsan/Projects/dotfiles/streamdeck/build_claude_page.py` — profile generation and validation.
- `/Users/ehsan/Projects/dotfiles/streamdeck/scripts/ghostty-new-agent.sh` — generic Ghostty launcher.
- `/Users/ehsan/Projects/dotfiles/streamdeck/SETUP.md` — shared layout documentation.

### Modified files

- `src/sessions.ts` — consume adapter readers and return the normalized provider-neutral session list.
- `src/live-pids.ts` — expose shared liveness primitives to adapters without selecting providers.
- `src/terminal-focus.ts` — route focus through the owning provider adapter while preserving terminal backends.
- `src/kill-session.ts` — remove Claude-only process assumptions and accept the provider termination contract.
- `src/slot-action.ts` — resolve gestures to provider IDs, create pending launches, and launch exactly once.
- `src/render-loop.ts` — reserve pending slots and render the shared startup mascot until session correlation succeeds.
- `src/plugin.ts` — register provider adapters and include pending launches in animation/render scheduling.
- `src/spawn-capture.ts` — support explicit child environment overrides for launch correlation.
- `src/session-events.ts` — carry launch ID from `SessionStart` into normalized derived state.
- `src/session-events.test.ts` — verify launch-ID preservation through event reduction.
- `hooks/notification.sh` — record `STREAMDECK_LAUNCH_ID` for Claude sessions.
- `hooks/notification.ps1` — mirror launch-ID recording on Windows Claude sessions.
- `hooks/codex-notification.sh` — record launch ID in Codex event and metadata records.
- `hooks/codex-notification.ps1` — mirror launch-ID recording for Windows-native Codex.
- `streamdeck/layout.toml` — declare provider launch specs and gesture-to-provider mappings.
- `streamdeck/build_claude_page.py` — emit provider IDs/specs instead of `emptyScript`/`emptyArgs`/`emptyHoldArgs`.
- `streamdeck/scripts/ghostty-new-agent.sh` — generic Ghostty launcher with provider-neutral environment handling.
- `streamdeck/scripts/ghostty-new-claude.sh` — compatibility wrapper or removal after the generated profile no longer references it.
- `streamdeck/SETUP.md` — document provider mappings and profile application.
- `README.md` — document provider adapter and gesture behavior.

---

### Task 1: Add provider contracts and registry

**Files:**

- Create: `src/provider-types.ts`
- Create: `src/provider-registry.ts`
- Create: `src/provider-registry.test.ts`

**Interfaces:**

- `ProviderId = string`.
- `LaunchSpec = { script: string; args: readonly string[] }`.
- `AgentSession` contains the current `SessionInfo` fields, with `provider: ProviderId` and optional `launchId: string`.
- `FocusResult` remains the existing `{ matched: boolean; reason: string; alreadyFront?: boolean }` shape.
- `TerminateResult = { terminated: boolean; reason: string }`.
- `AgentProvider = { id: ProviderId; launch: LaunchSpec; readSessions(): Promise<AgentSession[]>; filterLive(sessions: readonly AgentSession[]): Promise<Set<string>>; focus(session: AgentSession): Promise<FocusResult>; terminate(session: AgentSession): Promise<TerminateResult> }`.
- `ProviderRegistry.get(id: ProviderId): AgentProvider` throws an error containing the unknown ID.
- `ProviderRegistry.ids(): readonly ProviderId[]` returns registration order.

- [ ] **Step 1: Write failing registry tests.** Test that two providers register in order, duplicate IDs are rejected, and unknown IDs fail with the requested ID in the error.

- [ ] **Step 2: Run the focused test.**

Run: `pnpm exec tsx --test src/provider-registry.test.ts`

Expected: FAIL because the provider contract and registry do not exist.

- [ ] **Step 3: Implement the minimal types and registry.** Keep the registry independent of Stream Deck SDK imports; use type-only imports for session/focus contracts.

- [ ] **Step 4: Run the focused test.**

Run: `pnpm exec tsx --test src/provider-registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the isolated registry.**

Run: `git add src/provider-types.ts src/provider-registry.ts src/provider-registry.test.ts`

Run: `git commit -m "v0.1.1: added provider registry contracts"`

### Task 2: Normalize session types and adapter boundaries

**Files:**

- Modify: `src/sessions.ts`
- Modify: `src/live-pids.ts`
- Modify: `src/terminal-focus.ts`
- Modify: `src/kill-session.ts`
- Create: `src/providers/claude.ts`
- Create: `src/providers/codex.ts`
- Create: `src/providers/index.ts`
- Create: `src/providers.test.ts`

**Interfaces:**

- `AgentSession.provider` uses `ProviderId`, not a closed Claude/Codex union.
- `ClaudeProvider` and `CodexProvider` implement `AgentProvider`.
- `createBuiltinProviders(): readonly AgentProvider[]` returns Claude then Codex.
- `readAllSessions()` calls provider adapters and merges their normalized results; it does not contain provider-specific reader branches.
- Liveness, focus, and termination receive an `AgentSession` and dispatch through the adapter that owns it.

- [ ] **Step 1: Add provider-fixture tests before extraction.** Build minimal Claude and Codex session fixtures with the same normalized fields and assert both can pass through the common session sort/state pipeline; assert their provider IDs remain metadata only.

- [ ] **Step 2: Run the focused fixture test.**

Run: `pnpm exec tsx --test src/providers.test.ts`

Expected: FAIL because the adapter modules and normalized provider interface are not wired.

- [ ] **Step 3: Move the existing Claude reader into `src/providers/claude.ts`.** Preserve its path, title, naming, event-log, background-agent, and session JSON behavior byte-for-byte where possible; export the adapter rather than changing semantics.

- [ ] **Step 4: Move the existing Codex reader into `src/providers/codex.ts`.** Preserve its bridge-record path, event-log reduction, metadata handling, and Codex-only file pruning; do not call Claude code from the adapter.

- [ ] **Step 5: Extract shared PID liveness and terminal focus helpers.** Make `live-pids.ts` expose generic primitives; provider adapters choose the process identity or fallback policy. Keep Ghostty, VS Code, Warp, and clipboard behavior unchanged.

- [ ] **Step 6: Route termination through adapters.** Replace the hardcoded Claude process check in `kill-session.ts` with a provider-owned `terminate()` operation and preserve the current safe failure behavior.

- [ ] **Step 7: Replace the provider branches in `sessions.ts` with registry iteration.** Keep the existing cache and prune semantics, but make the core consume adapter results.

- [ ] **Step 8: Run the provider fixture and existing suites.**

Run: `pnpm test`

Expected: all existing tests plus `providers.test.ts` pass.

- [ ] **Step 9: Commit the adapter boundary.**

Run: `git add src/provider-types.ts src/providers src/sessions.ts src/live-pids.ts src/terminal-focus.ts src/kill-session.ts src/providers.test.ts`

Run: `git commit -m "v0.1.1: isolated Claude and Codex providers"`

### Task 3: Make the launcher and layout provider-driven

**Files:**

- Create: `/Users/ehsan/Projects/dotfiles/streamdeck/scripts/ghostty-new-agent.sh`
- Modify: `/Users/ehsan/Projects/dotfiles/streamdeck/scripts/ghostty-new-claude.sh`
- Modify: `/Users/ehsan/Projects/dotfiles/streamdeck/layout.toml`
- Modify: `/Users/ehsan/Projects/dotfiles/streamdeck/build_claude_page.py`
- Modify: `/Users/ehsan/Projects/dotfiles/streamdeck/SETUP.md`

**Interfaces:**

- Layout TOML defines `[providers.<id>]` launch specs.
- Each slot defines `tap_provider` and optional `hold_provider`.
- Generated settings contain `providerLaunches`, `tapProvider`, and `holdProvider`; no generated slot contains `emptyScript`, `emptyArgs`, or `emptyHoldArgs`.
- `ghostty-new-agent.sh` accepts one provider command as its argument vector and does not invoke another provider.

- [ ] **Step 1: Add layout validation to `build_claude_page.py`.** Assert every referenced provider exists, every provider has a non-empty script and argument list, and no slot still uses the legacy `empty*` fields. Expose it through the existing `--dry-run` path so the generator remains the single validator.

- [ ] **Step 2: Run the validation before changing the layout.**

Run: `python3 /Users/ehsan/Projects/dotfiles/streamdeck/build_claude_page.py --dry-run`

Expected: FAIL because the current layout still uses legacy empty-slot settings.

- [ ] **Step 3: Add provider declarations and gesture mappings to `streamdeck/layout.toml`.** Preserve tap-to-Claude and hold-to-Codex behavior exactly.

- [ ] **Step 4: Add `ghostty-new-agent.sh`.** Copy the current Ghostty safety logic, generalize its naming and comments, retain argument-array handling, and move only provider-neutral inherited-agent scrubbing into the generic path. Encode Claude's title-disable setting in the Claude launch spec rather than applying it to Codex.

- [ ] **Step 5: Update `build_claude_page.py`.** Emit the new provider launch table and per-slot gesture IDs; reject unknown provider IDs and remove the legacy settings from generated actions.

- [ ] **Step 6: Keep the old launcher as a compatibility wrapper until the profile migration is verified.** The wrapper must delegate to the generic launcher and must not be referenced by the generated profile.

- [ ] **Step 7: Run layout validation and dry-run generation.**

Run: `python3 /Users/ehsan/Projects/dotfiles/streamdeck/build_claude_page.py --dry-run`

Expected: validation passes; dry-run lists the same eight session slots and reports the provider mappings without modifying the deck.

- [ ] **Step 8: Commit the declarative layout in dotfiles.**

Run: `git -C /Users/ehsan/Projects/dotfiles add streamdeck/scripts/ghostty-new-agent.sh streamdeck/scripts/ghostty-new-claude.sh streamdeck/layout.toml streamdeck/build_claude_page.py streamdeck/SETUP.md`

Run: `git -C /Users/ehsan/Projects/dotfiles commit -m "v0.1.1: made Stream Deck launches provider-driven"`

### Task 4: Add launch IDs and provider-neutral pending mascots

**Files:**

- Create: `src/pending-launch.ts`
- Create: `src/pending-launch.test.ts`
- Create: `src/launch-command.ts`
- Create: `src/launch-command.test.ts`
- Modify: `src/spawn-capture.ts`
- Modify: `src/slot-action.ts`
- Modify: `src/render-loop.ts`
- Modify: `src/plugin.ts`
- Modify: `src/session-events.ts`
- Modify: `src/session-events.test.ts`

**Interfaces:**

- `PendingLaunch = { id: string; provider: ProviderId; actionId: string; startedAt: number }`.
- `PendingLaunches.start(actionId, provider, now): PendingLaunch` creates a unique launch ID.
- `PendingLaunches.match(session): string | undefined` returns the action ID only for a matching provider and launch ID.
- `PendingLaunches.fail(actionId): void` removes a failed launch.
- `renderAll()` reserves pending slots and renders the existing `working` mascot until the matching real session arrives.
- `spawnCapture` accepts `env?: NodeJS.ProcessEnv` and merges it over the parent environment.

- [ ] **Step 1: Write pure pending-state tests.** Cover immediate start, provider mismatch, launch-ID mismatch, successful match, failure cleanup, and two simultaneous launches remaining distinct.

- [ ] **Step 2: Run the focused pending test.**

Run: `pnpm exec tsx --test src/pending-launch.test.ts`

Expected: FAIL because the pending state machine is absent.

- [ ] **Step 3: Implement the pure pending state machine.** Use `crypto.randomUUID()` for IDs and keep all time values injectable for deterministic tests.

- [ ] **Step 4: Write launch-command tests.** Assert that a launch ID is exported into the command environment, Claude title configuration is present only in Claude's launch spec, and Codex launch construction contains no Claude command or Claude title variable.

- [ ] **Step 5: Implement launch-command construction and `spawnCapture` environment merging.** The shell launcher receives the launch ID through the child environment and exports it into the Ghostty shell before invoking the selected command.

- [ ] **Step 6: Add launch ID to normalized events.** Extend `SessionEvent` and `DerivedState` with `launchId`; preserve it from `SessionStart` through subsequent events.

- [ ] **Step 7: Refactor `SlotAction` gesture resolution.** Replace `empty*` settings with provider IDs and launch specs. On tap or hold, create a pending record before spawning; pass exactly the selected provider's command and `STREAMDECK_LAUNCH_ID`; clear only on launch failure or matching session.

- [ ] **Step 8: Reserve pending slots in `render-loop.ts`.** A pending launch renders the same mascot/working treatment immediately, is included in animation scheduling, and cannot be overwritten by an empty-slot render while startup is in progress.

- [ ] **Step 9: Wire pending state into `plugin.ts`.** Ensure slow and animation ticks render pending launches even when no provider record exists yet, and reconcile matching sessions before normal slot ordering.

- [ ] **Step 10: Run focused and full tests.**

Run: `pnpm exec tsx --test src/pending-launch.test.ts src/launch-command.test.ts src/session-events.test.ts`

Run: `pnpm test`

Expected: all tests pass and the new tests prove Codex does not pass through Claude.

- [ ] **Step 11: Commit pending launch behavior.**

Run: `git add src/pending-launch.ts src/pending-launch.test.ts src/launch-command.ts src/launch-command.test.ts src/spawn-capture.ts src/slot-action.ts src/render-loop.ts src/plugin.ts src/session-events.ts src/session-events.test.ts`

Run: `git commit -m "v0.1.1: added provider-neutral pending launches"`

### Task 5: Carry launch identity through both lifecycle bridges

**Files:**

- Modify: `hooks/notification.sh`
- Modify: `hooks/notification.ps1`
- Modify: `hooks/codex-notification.sh`
- Modify: `hooks/codex-notification.ps1`
- Modify: `scripts/install-hook.sh`
- Modify: `scripts/install-codex-hook.sh`
- Modify: `src/providers.test.ts`

**Interfaces:**

- Claude and Codex `SessionStart` records include `launchId` when `STREAMDECK_LAUNCH_ID` is present.
- Existing sessions without a launch ID remain valid and continue to appear normally.
- The bridges never call the other provider's hook or executable.

- [ ] **Step 1: Add bridge fixture tests.** Feed synthetic SessionStart inputs with and without `STREAMDECK_LAUNCH_ID`; assert the normalized event/meta output preserves the ID only when present.

- [ ] **Step 2: Run the bridge tests before implementation.**

Run: `pnpm exec tsx --test src/providers.test.ts`

Expected: FAIL for launch-ID fixtures.

- [ ] **Step 3: Update the Claude Bash and PowerShell bridges.** Capture the environment variable at SessionStart, add it to the event line and session metadata, and preserve existing logs for resumed/legacy sessions.

- [ ] **Step 4: Update the Codex Bash and PowerShell bridges.** Mirror the same field and preserve Codex's existing pid, status, and active-record behavior.

- [ ] **Step 5: Verify hook syntax and provider isolation.**

Run: `bash -n hooks/notification.sh`

Run: `bash -n hooks/codex-notification.sh`

Run: `bash scripts/check-codex-hooks.sh`

Expected: syntax and installed hook checks pass.

- [ ] **Step 6: Run the full TypeScript suite.**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 7: Commit the bridge changes.**

Run: `git add hooks scripts/install-hook.sh scripts/install-codex-hook.sh src/providers.test.ts`

Run: `git commit -m "v0.1.1: correlated provider lifecycle launches"`

### Task 6: Complete profile migration and documentation

**Files:**

- Modify: `/Users/ehsan/Projects/dotfiles/streamdeck/SETUP.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `package.json` only if a focused layout test command is needed.

- [ ] **Step 1: Update documentation.** State that Claude and Codex share the slot pool and visual contract, but each has an independent adapter and launch path. Document how to add a future provider without mentioning a Claude fallback.

- [ ] **Step 2: Run the package checks.**

Run: `pnpm test`

Run: `pnpm build`

Run: `pnpm sd:validate`

Expected: all tests pass, Rollup completes, and the Stream Deck manifest validates.

- [ ] **Step 3: Apply the generated profile.** Quit/relaunch through the existing guarded script so the live `ProfilesV3` manifest contains provider mappings.

Run: `bash /Users/ehsan/Projects/dotfiles/streamdeck/apply-layout.sh`

Expected: the live profile contains `providerLaunches`, `tapProvider`, and `holdProvider`, and no `emptyScript`, `emptyArgs`, or `emptyHoldArgs`.

- [ ] **Step 4: Reload the plugin.**

Run: `pnpm sd:reload`

Expected: the plugin respawns and logs provider-neutral session polling without a hook or source-path error.

- [ ] **Step 5: Perform the manual parity check.** Tap an empty slot and verify Claude appears with the existing mascot workflow. Hold an empty slot and verify Codex appears with the same immediate pending mascot, then the real Codex session. Press each tile to focus its Ghostty tab; verify naming, state transitions, and cleanup.

- [ ] **Step 6: Commit documentation and final generated-source changes.**

Run: `git add README.md docs/architecture.md`

Run: `git commit -m "v0.1.1: documented provider-independent agent workflow"`

Run: `git -C /Users/ehsan/Projects/dotfiles add streamdeck/SETUP.md`

Run: `git -C /Users/ehsan/Projects/dotfiles commit -m "v0.1.1: documented provider-independent agent workflow"`

## Final review gate

- [ ] `pnpm test` passes with the complete suite.
- [ ] `pnpm build` and `pnpm sd:validate` pass.
- [ ] The live profile contains only provider-driven launch settings.
- [ ] A Codex hold produces no Claude command invocation.
- [ ] Claude tap behavior is unchanged.
- [ ] Both providers show the same pending/live mascot experience.
- [ ] Existing unrelated working-tree changes remain untouched.
