# Headless helpers (the deck namer) — streamdeck-claude lessons

Part of streamdeck-claude LESSONS — split 2026-08-22.

## A tool that drives Claude Code will meet its own reflection

Two self-reference traps hit within an hour of each other (2026-07-31), both
in the deck-name feature:

- The namer picks a session's word with a headless `claude -p` call — which
  *is* a Claude Code session, so it appeared on the deck, took a slot, and
  triggered naming for itself, recursively. Fix: run it from a sentinel cwd
  (`~/.claude/deck-namer`) that the session reader filters out. Any component
  that shells out to the thing it monitors needs a way to recognise its own
  reflection.
- The tab's canonical name first fell back to the session's display label,
  which falls back to the cwd basename — so five sessions started in the same
  directory were all named "Projects", and exact matching became a coin flip.
  A name used as an identity must be unique **by construction**, not by
  coincidence; derive it from something already unique (the pid, or a word the
  namer refuses to reuse).

## `claude -p` names things after ITS cwd, not the subject you asked about

The deck namer runs a headless `claude -p` from a sentinel directory
(`~/.claude/deck-namer`) so its own session can be filtered off the deck. That
directory is not neutral: `claude -p` reports its working directory to the model
as context, and when the session being NAMED is thin the model reaches for it.

Measured 2026-08-17, same prompt, only the cwd differing:

| Run from | First request | Word |
|---|---|---|
| `~/.claude/deck-namer` | "what is the latest news" | `deck`, `deckname` |
| a neutral temp dir | "what is the latest news" | `news`, `briefing` |

Ten `.deckname` sidecars on this machine had quietly collected `deck`,
`deckname`, `decknamer` or `namer` — sessions named after the labelling tool.
Both providers were hit (two of the four `deck` sids were Claude's), so this was
never a Codex bug; it just SHOWS up on Codex, because a Codex rollout carries no
`customTitle`/`aiTitle`, leaving `firstPrompt` as the only signal where a Claude
session has two.

Two things did NOT fix it, worth knowing before trying them again:

- `--settings '{}' --strict-mcp-config --mcp-config '{"mcpServers":{}}'` —
  still `deck`. The leak is the working-directory PATH in the model's context,
  not settings, hooks, or MCP.
- Making the prompt more emphatic about "the specific subject" — the original
  prompt already said that.

What fixed it: telling the model outright that the session it is naming is not
the session it is running in, and to ignore its own working directory. Verified
4/4 sensible (`news`, `briefing`, `headlines`, `news`) from the real sentinel
cwd, with rich prompts still naming well (`stagnation`, `lighttools`).
`selfReferentialWords` in `naming-policy.ts` is the backstop for when the model
doesn't listen — derived from the sentinel path, so renaming the directory moves
the guard with it instead of leaving a stale blocklist.

Generalisation for any headless-LLM helper in this repo: **the helper's own
environment is part of its prompt whether you wrote it or not.** If the answer
must be about the caller's data, say so explicitly, and check the output against
the helper's own vocabulary before trusting it.
