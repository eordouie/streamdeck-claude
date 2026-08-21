/** Session state is a deterministic projection of an append-only NDJSON event
 *  log written by Claude Code or Codex hooks (one line per hook fire). The plugin reads
 *  `<sid>.events.ndjson` each tick and replays it through `reduceEvents()` —
 *  no mtime heuristics, no per-state sidecar files, no race conditions between
 *  drop/rm pairs. Adding a new state = one case in `applyEvent`. */

import { normaliseTerm, type TerminalKind } from "./terminal-kind.js";

export type TodoStatus = "pending" | "in_progress" | "completed";
const VALID_TODO_STATUS: ReadonlySet<TodoStatus> = new Set(["pending", "in_progress", "completed"]);

export interface SessionEvent {
  ts: number;
  event: string;
  tool?: string;
  /** CC's `notification_type` on Notification events. The enum GROWS across
   *  CC versions (seen live on 2.1.220: `permission_prompt`, `idle_prompt`,
   *  `auth_success`, `elicitation_dialog`, `elicitation_complete`,
   *  `elicitation_response`, `agent_needs_input`, `agent_completed`) — which
   *  is why the reducer whitelists the needs-you types instead of
   *  catch-all-ing the rest into "awaiting". Older logs from before the hook
   *  captured this field will be `undefined`. */
  notifType?: string;
  /** Present only for PostToolUse[TodoWrite] — snapshot of the new list's statuses. */
  todos?: TodoStatus[];
  /** Terminal host, present only on the SessionStart line. */
  term?: string;
  /** Claude Code transcript path, present only on the SessionStart line. */
  transcript?: string;
  /** Clipped prompt text, present only on UserPromptSubmit lines. */
  prompt?: string;
  /** Launch correlation ID supplied by the Stream Deck provider launcher. */
  launchId?: string;
  /** CC's `agent_id` — present on every hook fire that happened INSIDE a
   *  subagent (tool events included), absent on main-thread fires. This is
   *  the discriminator that makes depth-counting unnecessary: SubagentStart/
   *  SubagentStop are NOT a matched pair (measured live 2026-08-20: 21 starts
   *  vs 178 stops in one workflow session — workflow agents fire stops
   *  without ever firing starts). */
  agentId?: string;
  /** Ids of still-running subagents from CC's `background_tasks`, carried by
   *  SubagentStop ONLY (no other event has the field — probed live). An
   *  authoritative snapshot: present-but-empty means "none running", absent
   *  (undefined) means the event predates the hook capturing it. */
  bgIds?: string[];
}

/** What the icon needs, derived from the event log. The session's busy/idle
 *  flag still comes from the session JSON's `status` field — that's CC's own
 *  state, not ours to derive. */
export interface DerivedState {
  /** Generic in-turn Notification (non-permission). Catch-all for elicitation /
   *  unknown notifType values so the icon still flags "needs input." */
  awaiting: boolean;
  /** Notification[permission_prompt] in-turn — CC is asking to use a tool. */
  awaitingPermission: boolean;
  /** PreToolUse[AskUserQuestion] in-turn — CC is asking a UI question and
   *  hasn't received an answer yet (PostToolUse fires only after the user
   *  answers). Notification doesn't fire for AskUserQuestion. */
  awaitingQuestion: boolean;
  awaitingPlan: boolean;
  errored: boolean;
  subagentDepth: number;
  /** Most recent TodoWrite snapshot; empty until the agent calls TodoWrite. */
  todos: TodoStatus[];
  /** One timestamp per believed-live subagent: the ts of its last observed
   *  event (old-format entries with no agentId: the SubagentStart ts, never
   *  refreshed). Deliberately NOT reset at turn boundaries, unlike
   *  `subagentDepth`: background agents outlive the turn that spawned them,
   *  and the reset made them invisible the moment the turn ended. Ghost
   *  tolerance comes from the consumer (`liveBgAgents` ages entries out
   *  after BG_AGENT_TTL_MS) plus the authoritative `bgIds` snapshot on every
   *  new-format SubagentStop, which prunes ids CC no longer lists. Drives
   *  both the +N agents badge and the `subagent` family motif. */
  agentLastSeen: number[];
  /** Which terminal hosts this session (from the SessionStart hook stamp). */
  terminal: TerminalKind;
  /** Transcript path (from the SessionStart hook stamp); "" when unknown.
   *  Used to look up the session's title for tab-level focus. */
  transcriptPath: string;
  /** The FIRST substantial prompt (≥3 words) of the session, clipped by the
   *  hook — context for the one-time deck-name pick. "" until one lands. */
  firstPrompt: string;
  /** Launch correlation ID captured at SessionStart, if launched by the deck. */
  launchId?: string;
}

/** Internal accumulator: same as DerivedState plus `inTurn`, which is true
 *  between UserPromptSubmit and Stop/StopFailure. Used to tell apart a real
 *  permission/input prompt (Notification fired mid-turn — CC actually needs
 *  the user) from an idle reminder (Notification fired ~60s after Stop —
 *  CC's bell-like "you've gone afk" nudge, not an actual question). */
interface ReducerState extends Omit<DerivedState, "agentLastSeen"> {
  inTurn: boolean;
  /** Old-format SubagentStart timestamps (events carrying no agentId), FIFO,
   *  capped at BG_AGENT_CAP. Kept only for logs written before the hook
   *  captured agent_id; superseded whenever a bgIds snapshot arrives. */
  legacyStarts: number[];
  /** agentId → ts of its last observed event. The live-set replacement for
   *  depth counting: upserted by ANY event fired inside that agent, removed
   *  by its own SubagentStop, reconciled by bgIds snapshots. */
  agentsSeen: Record<string, number>;
}

const ZERO: ReducerState = { awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: false, subagentDepth: 0, todos: [], legacyStarts: [], agentsSeen: {}, terminal: "unknown", transcriptPath: "", firstPrompt: "", launchId: undefined, inTurn: false };

/** How long an agent stays believed-live with no further sighting. Must
 *  exceed the longest legitimate silent gap — an agent inside one long tool
 *  call emits nothing between its PreToolUse and PostToolUse, and the Bash
 *  tool caps at 10 min — so 15 min. In practice ghosts die much sooner: any
 *  later SubagentStop carries the authoritative bgIds snapshot that prunes
 *  ids CC no longer lists; this TTL only covers the no-more-stops tail. */
export const BG_AGENT_TTL_MS = 15 * 60_000;
const BG_AGENT_CAP = 16;

/** The live-agent count at `now`: entries seen within the TTL. */
export function liveBgAgents(lastSeen: readonly number[], now: number): number {
  return lastSeen.filter((t) => now - t < BG_AGENT_TTL_MS).length;
}

export function reduceEvents(events: readonly SessionEvent[]): DerivedState {
  let state = ZERO;
  for (const ev of events) state = applyEvent(state, ev);
  // Strip the internal bookkeeping — callers only get the public projection.
  const { inTurn: _inTurn, legacyStarts, agentsSeen, ...derived } = state;
  return { ...derived, agentLastSeen: [...legacyStarts, ...Object.values(agentsSeen)] };
}

function applyEvent(state: ReducerState, ev: SessionEvent): ReducerState {
  // Any event carrying agentId was fired from inside that subagent — proof it
  // is alive right now. Upserting on EVERY such event (not just
  // SubagentStart) is what makes workflow agents visible at all: they fire
  // stops without starts, so their first tool call is the only birth
  // certificate they ever present. SubagentStop is excluded — it is the
  // agent announcing its own death, handled in its case below.
  if (ev.agentId !== undefined && ev.event !== "SubagentStop") {
    state = { ...state, agentsSeen: { ...state.agentsSeen, [ev.agentId]: ev.ts } };
  }
  switch (ev.event) {
    case "SessionStart":
      return { ...ZERO, terminal: normaliseTerm(ev.term), transcriptPath: ev.transcript ?? "", launchId: ev.launchId };

    case "SessionEnd":
      return ZERO;

    case "UserPromptSubmit": {
      // A fresh turn always starts with zero in-flight subagents. Resetting
      // subagentDepth here (and at Stop) keeps a missed SubagentStop — a
      // subagent killed or a hook that didn't fire — from leaking across the
      // turn boundary and stranding the session on the "subagent" icon.
      const next = { ...state, inTurn: true, awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: false, subagentDepth: 0 };
      // Capture the FIRST substantial prompt only — trivial openers
      // ("continue", "hi") don't count as naming context, and neither do
      // machine-injected turns (background-task notifications arrive as
      // UserPromptSubmit with an XML body): a session named after harness
      // plumbing instead of the user's actual request is worse than unnamed.
      const machine = /^\s*(\[SYSTEM NOTIFICATION|<task-notification)/.test(ev.prompt ?? "");
      if (!state.firstPrompt && !machine && ev.prompt !== undefined && ev.prompt.trim().split(/\s+/).length >= 3) {
        next.firstPrompt = ev.prompt.trim();
      }
      return next;
    }

    case "Notification":
      // Only an in-turn Notification is a real prompt to the user. After Stop,
      // CC keeps firing Notification every ~60 s as an idle reminder — those
      // would falsely flip the icon to awaiting while the user is afk.
      //
      // WHITELIST, not catch-all: the notifType enum grows across CC versions
      // and includes RESOLUTION events (elicitation_complete, agent_completed,
      // auth_success). The old "anything else means needs-input" turned each
      // of those into a fresh strobe for a thing that had just finished.
      // Unknown types are ignored — erring quiet beats erring needy, and the
      // prompts that matter have their own named types.
      if (!state.inTurn) return state;
      if (ev.notifType === "permission_prompt") return { ...state, awaitingPermission: true };
      if (ev.notifType === "elicitation_dialog" || ev.notifType === "agent_needs_input") {
        return { ...state, awaiting: true };
      }
      return state;

    case "PreToolUse": {
      // Tool activity is proof the user resolved a pending Notification ONLY
      // when no subagents are in flight: subagent tool calls hook-fire into
      // this same session log (verified live — WebSearch/Bash events inside
      // SubagentStart/Stop windows), so with depth > 0 a tool event says
      // nothing about the main thread, which can still be blocked on a real
      // padlock. The cost of the gate is the benign direction: a prompt
      // GRANTED mid-subagent-run keeps its padlock until the turn's flags
      // next reset, instead of a real prompt being silently hidden.
      // Order is safe: the PreToolUse that *triggers* a permission_prompt fires
      // BEFORE its Notification, so this never clears the prompt it raises.
      // errored clears unconditionally, outside the subagent gate: a tool call
      // anywhere in this session — main thread or subagent — proves the session
      // is running, which is exactly what an error tile claims it is not. Before
      // this, errored had ONE escape hatch (UserPromptSubmit), so a slot stayed
      // red through 24 h of healthy activity until someone typed in that tab.
      const next = state.subagentDepth === 0
        ? { ...state, awaiting: false, awaitingPermission: false, errored: false }
        : { ...state, errored: false };
      if (ev.tool === "ExitPlanMode") return { ...next, awaitingPlan: true };
      if (ev.tool === "AskUserQuestion") return { ...next, awaitingQuestion: true };
      return next;
    }

    // PostToolUseFailure is the DENIAL path of the same lifecycle: a rejected
    // plan or an ESC'd question fires it instead of PostToolUse, and the
    // pre-set flag must clear on both or the tile shows "awaiting plan
    // approval" for the rest of a turn in which nothing is awaited.
    case "PostToolUse":
    case "PostToolUseFailure": {
      // errored clears here too, and for the same reason as PreToolUse: a tool
      // that RETURNED is proof of life.
      const next = state.subagentDepth === 0
        ? { ...state, awaiting: false, awaitingPermission: false, errored: false }
        : { ...state, errored: false };
      if (ev.tool === "ExitPlanMode") return { ...next, awaitingPlan: false };
      if (ev.tool === "AskUserQuestion") return { ...next, awaitingQuestion: false };
      if (ev.event === "PostToolUse" && ev.tool === "TodoWrite" && ev.todos) return { ...next, todos: ev.todos };
      return next;
    }

    case "PermissionRequest":
      // Codex exposes the approval boundary as its own lifecycle event rather
      // than Claude Code's Notification[permission_prompt].
      return { ...state, awaitingPermission: true };

    case "PermissionDenied":
      // "No" is an answer: the prompt is gone, nothing is awaited anymore.
      return { ...state, awaiting: false, awaitingPermission: false };

    case "Stop":
      // A subagent cannot outlive the turn that spawned it, so depth is 0 once
      // the main turn stops — reset it to absorb any unmatched SubagentStart.
      // errored clears: a turn that reached a clean Stop is a turn that worked.
      return { ...state, inTurn: false, awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: false, subagentDepth: 0 };

    case "StopFailure":
      // A Stop HOOK exiting non-zero is NOT the session failing, and this event
      // cannot tell the two apart on its own. Two facts make the difference
      // (both measured 2026-08-18, session "lever"):
      //   - Stop hooks here exit non-zero BY DESIGN: deck-capture-nudge.py
      //     blocks to force a capture, and a block is reported as a failure.
      //   - CC fires StopFailure against an ALREADY-STOPPED session — observed
      //     16 s after a clean Stop, and again two minutes after an idle_prompt.
      // So only a StopFailure that interrupts a turn still in progress is
      // evidence that anything failed. Post-turn ones are hook bookkeeping and
      // must leave the tile alone; `errored: state.inTurn` is that whole rule.
      // A failing hook is a CONFIG problem and belongs on the setup key's
      // hook-warning surface, never on a per-session alarm.
      return { ...state, inTurn: false, awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: state.inTurn, subagentDepth: 0 };

    case "SubagentStart":
      return {
        ...state,
        // Proof of life, like the tool events: a subagent starting or stopping
        // means this session is doing work. In the 2026-08-18 "lever" case a
        // SubagentStop landed five minutes after the last StopFailure, and
        // ignoring it is what let the red tile outlive the truth by a day.
        errored: false,
        subagentDepth: state.subagentDepth + 1,
        // New-format starts (agentId) are already in agentsSeen via the
        // upsert above; only old-format events feed the legacy FIFO list.
        legacyStarts: ev.agentId === undefined ? [...state.legacyStarts, ev.ts].slice(-BG_AGENT_CAP) : state.legacyStarts,
      };

    case "SubagentStop": {
      let agentsSeen = state.agentsSeen;
      let legacyStarts = state.legacyStarts;
      if (ev.bgIds !== undefined) {
        // Authoritative snapshot of still-running subagents: prune ids CC no
        // longer lists, adopt ids we never saw an event for (stamped at this
        // event's ts), keep known timestamps. The legacy list is superseded —
        // any old-format agent still running is in the snapshot by id.
        const next: Record<string, number> = {};
        for (const id of ev.bgIds) next[id] = agentsSeen[id] ?? ev.ts;
        agentsSeen = next;
        legacyStarts = [];
      }
      if (ev.agentId !== undefined) {
        // The stopper can appear in its own snapshot (observed live
        // 2026-08-20) — it is stopping, so remove it AFTER applying it.
        if (ev.agentId in agentsSeen) {
          agentsSeen = { ...agentsSeen };
          delete agentsSeen[ev.agentId];
        }
      } else {
        // Old-format stop: FIFO-retire the oldest outstanding start. With
        // unpaired events the bias favors newer spawns staying visible.
        legacyStarts = legacyStarts.slice(1);
      }
      return {
        ...state,
        errored: false,
        subagentDepth: Math.max(0, state.subagentDepth - 1),
        agentsSeen,
        legacyStarts,
      };
    }

    default:
      return state;
  }
}

/** Tolerant NDJSON parser: skips blank lines, malformed JSON, and entries
 *  missing the required `ts`/`event` fields. The last line may be a partial
 *  write (hook in progress) — silently dropped. */
export function parseEventLog(text: string): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.ts === "number" && typeof obj.event === "string") {
        const todos = Array.isArray(obj.todos)
          && obj.todos.every((s: unknown) => typeof s === "string" && VALID_TODO_STATUS.has(s as TodoStatus))
          ? (obj.todos as TodoStatus[])
          : undefined;
        out.push({
          ts: obj.ts,
          event: obj.event,
          tool: typeof obj.tool === "string" ? obj.tool : undefined,
          notifType: typeof obj.notifType === "string" ? obj.notifType : undefined,
          todos,
          term: typeof obj.term === "string" ? obj.term : undefined,
          transcript: typeof obj.transcript === "string" ? obj.transcript : undefined,
          prompt: typeof obj.prompt === "string" ? obj.prompt : undefined,
          launchId: typeof obj.launchId === "string" ? obj.launchId : undefined,
          agentId: typeof obj.agentId === "string" ? obj.agentId : undefined,
          bgIds:
            Array.isArray(obj.bgIds) && obj.bgIds.every((s: unknown) => typeof s === "string")
              ? (obj.bgIds as string[])
              : undefined,
        });
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/** Displayed state for a LIVE interactive session, from CC's own pid.json
 *  status plus the event-log flags. Pure and here (not sessions.ts) so it is
 *  unit-testable — sessions.ts sits behind the SDK import chain.
 *
 *  The awaiting* flags outrank rawStatus while CC says "busy" OR "waiting":
 *  CC flips pid.json to "waiting" when a user-facing dialog opens
 *  (AskUserQuestion observed live 2026-08-04 — the old busy-only gate read
 *  that as idle and masked the question). "waiting" with no flag still shows
 *  a generic prompt: CC itself says it is blocked on the user, and a lost
 *  hook event must not fake an idle. An INTERRUPT emits no hook event at
 *  all — the flags stay set in the log while pid.json flips "idle" — so an
 *  idle rawStatus always ignores the awaiting* flags, or tiles freeze on
 *  prompts that no longer exist. The one thing that outranks idle is
 *  subagentActive: background agents outlive the turn, and a session whose
 *  agents are still working is not idle to the user. */
export function interactiveState(
  rawStatus: string,
  s: {
    awaiting: boolean;
    awaitingPermission: boolean;
    awaitingQuestion: boolean;
    awaitingPlan: boolean;
    subagentActive: boolean;
  },
): "awaiting_plan" | "awaiting_permission" | "awaiting_question" | "awaiting" | "subagent" | "working" | "idle" {
  if (rawStatus === "busy" || rawStatus === "waiting") {
    if (s.awaitingPlan) return "awaiting_plan";
    if (s.awaitingPermission) return "awaiting_permission";
    if (s.awaitingQuestion) return "awaiting_question";
    if (s.awaiting) return "awaiting";
    if (rawStatus === "waiting") return "awaiting";
    return s.subagentActive ? "subagent" : "working";
  }
  // The turn can end while background subagents keep working — they outlive
  // it by design, and CC flips pid.json to idle the moment the main loop
  // stops. The session's WORK is still running, so the family keeps walking
  // until the agents actually finish (subagentActive ages out via the
  // liveBgAgents TTL and the bgIds snapshots). Interrupt semantics survive:
  // the awaiting* flags are still ignored when idle.
  if (s.subagentActive) return "subagent";
  return "idle";
}
