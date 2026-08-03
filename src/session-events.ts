/** Session state is a deterministic projection of an append-only NDJSON event
 *  log written by hooks (one line per Claude Code hook fire). The plugin reads
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
  /** Outstanding background-agent starts (event timestamps, oldest first).
   *  Deliberately NOT reset at turn boundaries, unlike `subagentDepth`:
   *  harness-tracked background agents outlive the turn that spawned them,
   *  and the reset made them invisible the moment the turn ended. Leak
   *  tolerance comes from the consumer instead — `liveBgAgents` ages every
   *  entry out after BG_AGENT_TTL_MS, so an unmatched start (they happen:
   *  observed start=30/stop=26 in real logs) fades instead of stranding a
   *  badge forever. Capped at BG_AGENT_CAP, newest kept. */
  bgAgentStartTimes: number[];
  /** Which terminal hosts this session (from the SessionStart hook stamp). */
  terminal: TerminalKind;
  /** Transcript path (from the SessionStart hook stamp); "" when unknown.
   *  Used to look up the session's title for tab-level focus. */
  transcriptPath: string;
  /** The FIRST substantial prompt (≥3 words) of the session, clipped by the
   *  hook — context for the one-time deck-name pick. "" until one lands. */
  firstPrompt: string;
}

/** Internal accumulator: same as DerivedState plus `inTurn`, which is true
 *  between UserPromptSubmit and Stop/StopFailure. Used to tell apart a real
 *  permission/input prompt (Notification fired mid-turn — CC actually needs
 *  the user) from an idle reminder (Notification fired ~60s after Stop —
 *  CC's bell-like "you've gone afk" nudge, not an actual question). */
interface ReducerState extends DerivedState {
  inTurn: boolean;
}

const ZERO: ReducerState = { awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: false, subagentDepth: 0, todos: [], bgAgentStartTimes: [], terminal: "unknown", transcriptPath: "", firstPrompt: "", inTurn: false };

/** How long an outstanding background-agent start stays visible without its
 *  SubagentStop. Long enough for real audits, short enough that a leaked
 *  start is a temporary +1, not a permanent lie. */
export const BG_AGENT_TTL_MS = 30 * 60_000;
const BG_AGENT_CAP = 16;

/** The badge count at `now`: outstanding starts younger than the TTL. */
export function liveBgAgents(starts: readonly number[], now: number): number {
  return starts.filter((t) => now - t < BG_AGENT_TTL_MS).length;
}

export function reduceEvents(events: readonly SessionEvent[]): DerivedState {
  let state = ZERO;
  for (const ev of events) state = applyEvent(state, ev);
  // Strip the internal flag — callers only get the public projection.
  const { inTurn: _inTurn, ...derived } = state;
  return derived;
}

function applyEvent(state: ReducerState, ev: SessionEvent): ReducerState {
  switch (ev.event) {
    case "SessionStart":
      return { ...ZERO, terminal: normaliseTerm(ev.term), transcriptPath: ev.transcript ?? "" };

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
      const next = state.subagentDepth === 0 ? { ...state, awaiting: false, awaitingPermission: false } : { ...state };
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
      const next = state.subagentDepth === 0 ? { ...state, awaiting: false, awaitingPermission: false } : { ...state };
      if (ev.tool === "ExitPlanMode") return { ...next, awaitingPlan: false };
      if (ev.tool === "AskUserQuestion") return { ...next, awaitingQuestion: false };
      if (ev.event === "PostToolUse" && ev.tool === "TodoWrite" && ev.todos) return { ...next, todos: ev.todos };
      return next;
    }

    case "PermissionDenied":
      // "No" is an answer: the prompt is gone, nothing is awaited anymore.
      return { ...state, awaiting: false, awaitingPermission: false };

    case "Stop":
      // A subagent cannot outlive the turn that spawned it, so depth is 0 once
      // the main turn stops — reset it to absorb any unmatched SubagentStart.
      return { ...state, inTurn: false, awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, subagentDepth: 0 };

    case "StopFailure":
      return { ...state, inTurn: false, awaiting: false, awaitingPermission: false, awaitingQuestion: false, awaitingPlan: false, errored: true, subagentDepth: 0 };

    case "SubagentStart":
      return {
        ...state,
        subagentDepth: state.subagentDepth + 1,
        bgAgentStartTimes: [...state.bgAgentStartTimes, ev.ts].slice(-BG_AGENT_CAP),
      };

    case "SubagentStop":
      return {
        ...state,
        subagentDepth: Math.max(0, state.subagentDepth - 1),
        // FIFO: retire the oldest outstanding start. With unpaired events the
        // bias favors newer spawns staying visible; ghosts age out via TTL.
        bgAgentStartTimes: state.bgAgentStartTimes.slice(1),
      };

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
        });
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}
