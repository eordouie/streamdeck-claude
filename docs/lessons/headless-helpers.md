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

## The namer's default context pulled words toward the project (2026-10-06)

Of 15 recent words, `hive`, `nebula`, `mirror`, `lighttools` and `lenses` named
the repo or product, not the subject, and `vacant` / `labeling` came from a
thin first prompt. Two causes, both measured:

- A plain `claude -p` loads the user's global CLAUDE.md and settings. Asked to
  list project names it saw, the default call named hive, terrawatt, fresnel,
  lt-automation and more; with `--system-prompt … --setting-sources "" --tools ""`
  only the sentinel dir and the org instructions remained. The org-level
  managed instructions still load — no flag removes them. `--bare` would, but
  it drops OAuth ("Not logged in"), so it is not usable here.
- One prompt is too little context. The namer now waits for three human
  prompts (or one of 30+ words), and the prompt bans words that name what
  many sessions share (`broadWords`: a fixed product list plus every folder on
  the session's path).

Escape hatch for a bad word: rename the Ghostty tab; `adoptHandRenamedTabs`
copies the tab's word into the `.deckname` sidecar.

**Follow-up (2026-10-20): the three-prompt bar starved one-task sessions.** A
session whose whole job was one 17-word prompt ("set up my bamboo 3d
printer…") sat on `Projects` for an hour, and so did a two-prompt / 28-word
one — Ehsan read both as "no label anymore". Readiness is back to the first
human prompt; the thin-opener case moved into the prompt itself: the model may
answer `unknown`, which the namer treats as "ask again when another prompt
arrives" (`askedWith`), not as a failure. Separately, "EXACTLY ONE word" made
Sonnet glue two together — `asphaltsiting`, `capacityfactor`, `selfassessment`
— and the 12-character cap rejected each three times, after which the namer
gave up on the session. Now: one word of 3-16, or two short ones joined by a
hyphen (`DECK_WORD_RE`), and the prompt offers the hyphen outright. First live
run after the change: `asphalt-siting`, `bambu-printer`, `austin-lighthouse`
within 8 s for the three stuck sessions.

## The namer's input was 200 characters of dictation, and its shape rule threw away good answers (2026-10-31)

Two findings from the plugin log (2026-10-19 … 10-31, 50 words assigned),
log `docs/log/2026-10-31-deck-naming-quality.md`:

- **Missing words came from the shape rule, not the model.** `DECK_WORD_RE`
  refused `cone-visualization`, `hotel-reimbursement`, `amt-3921` and
  `az-el` (second part over 11 letters, a digit first, a part under 3
  letters); the namer re-sent the IDENTICAL prompt, got the same answer three
  times, and gave up — three sessions never got a word. Every refused label
  was fine. A validator that can refuse a model's answer needs two things:
  the re-ask must carry the reason (`rejectionReason`), and the last resort
  must be a clipped answer (`clipWord`), never silence.
- **Poor words came from thin input.** The namer saw the hook's 200-char
  clip of a voice-dictated prompt and an empty "Session title": Claude Code
  has written no `aiTitle` into any real transcript since
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (9 of 393 recent transcripts have
  one — all the namer's own headless sessions, which run without that env).
  So Handy's `heresder` became `headersd`. The assistant's first reply
  restates the request in clean words ("Reading the herdr evaluation
  log…"); measured with one call each from the sentinel cwd:

  | Session | Sonnet, 200-char clip | Sonnet, full prompt + reply |
  |---|---|---|
  | herdr review | `heresder` | `herdr upgrade` |
  | Performance-tab visibility | `view-toggle` | `source visibility` |
  | receiver STEP files | `report-update` | `crucible report` |
  | this plugin's tab naming | `tabnaming` | `tab labeling` |

  Opus gave the same words at rich context and copied the mis-hearing at
  thin context (`heresder-upgrade`), so the model stays Sonnet; the context
  is what moved. "Reply with ONE word" also glued pairs together
  (`viewvisibility`, `channelupdates`, `weeklyupdate`); the prompt now asks
  for one or two words separated by a space and the plugin hyphenates.

Readiness therefore waits for the reply (`NAMING_REPLY_WAIT_MS` = 90 s cap);
Ehsan chose the minute's wait over a provisional word that changes.

**The reply is not in the transcript head.** The first build read a 256 KB
head chunk, like the title reader, and the first live run after it named
at the 90 s cap although the reply had landed at 29 s. Measured over twelve
transcripts: the first prompt starts at byte ~1500, the first assistant
text at 240–560 KB, with 22–31 entries between them — the CLAUDE.md,
memory and skill attachments Claude Code injects after the prompt. The
miner is now an incremental scan (resume at the last complete line; a
complete context is final). A transcript's shape is not the shape of the
conversation: measure offsets before sizing a chunk.
Generalisation: **when a headless helper names or judges a conversation,
give it the first exchange, not the first message** — the reply is the
cleanest statement of what the conversation is about.
