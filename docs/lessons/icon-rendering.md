# Icon rendering, animation and mascots — streamdeck-claude lessons

Part of streamdeck-claude LESSONS — split 2026-08-22.

## `<clipPath>` outside `<defs>` renders as a black box

Making the `working` mascot walk off one edge and back in the other needed
the character hidden at the frame. The first attempt clipped the motif with
a `<clipPath>` emitted as a plain child of the motif group. On the deck the
key turned into a black rectangle with only two slivers of border showing:
the Stream Deck app painted the clip's `<rect>` as ordinary content — the
128x264 rect, default black fill, covering everything but the left and right
edges.

Clipping itself is fine. `icons/text.ts` has clipped the marquee since day
one — the difference is that it wraps its `<clipPath>` in `<defs>`. Outside
`<defs>`, the element is drawn.

Two things worth keeping from this:

- **resvg is more forgiving than the deck.** The local `@resvg/resvg-js`
  preview honoured the stray clip and looked perfect, so the filmstrip
  actively hid the bug. A preview proves geometry, never renderer support —
  anything relying on an SVG feature has to be seen on the hardware.
- **Paint order beat the clip anyway.** Drawing the border *after* the motif
  gets the same result with nothing but z-order, and it is what the effect
  wanted in the first place: the mascot passes behind the frame. Reach for
  ordering before reaching for a renderer feature.

A third trap, in the preview harness rather than the plugin: compositing
tiles into one sheet with `<g transform>` lets a tile's off-screen wrap copy
paint over its neighbour, which looked exactly like a duplicate-sprite bug.
Each key on the deck is its own 144x144 image and has no neighbours. Use a
nested `<svg>` per tile — it establishes a viewport and clips to it — or the
harness will invent bugs the product doesn't have.

## Desync is about when things change, not what they look like

The `subagent` motif walks the slot's mascot with three small copies of itself
in tow. Drawn from one sprite they read as one object stamped four times, so
each member runs its own frame offset (legs, breathing) and blink phase. Two
traps, both invisible in a still frame and only findable by doing the
arithmetic:

- **Offsets alias against the cycle they are offsetting.** The first blink
  stagger was `(i+1) * 1130 ms`. It looks like three distinct phases until you
  notice `3 x 1130 = 3390`, essentially the 3400 ms blink period — so the last
  baby blinked in lockstep with the parent, which is precisely what the offset
  existed to prevent. Any stagger has to be checked modulo the period it is
  spreading across, not just eyeballed for distinctness.
- **An offset cannot desynchronise more members than the cycle has residues.**
  The leg cycle switches every 3 frames, so it has exactly three residues. The
  parent takes one, leaving two for three babies — by pigeonhole two must
  share. Two offsets sharing a residue differ by a multiple of 3, which pins
  them to the same switch frame forever: identical pose if the multiple is
  even, exactly mirrored if it is odd. **Mirrored-and-locked is still locked**
  — opposite pose, identical rhythm, which is what "in sync" looks like in
  motion.

  The first fix here was offsets `[1, 2, 4]`, chosen so none was a multiple of
  3. That correctly unlocked every baby from the *parent* and quietly locked
  babies 1 and 3 to *each other*, because `4 - 1 = 3`. Fixing one pairing in a
  set is not fixing the set: with N members every pair needs checking, not just
  every member against the leader.

  The way out is to stop offsetting a shared cycle and give each member its own
  cadence — here `[94, 83, 101]` ms per leg unit, so step periods of 282 / 249 /
  303 ms drift against the parent's 360 ms and against each other. No pigeonhole
  applies to distinct periods. It is also the physically right answer: small
  animals take quicker steps.

All three were found by printing the phases, the switch frames, and a
pose-agreement matrix over a long sample — never by looking at a render. A
still frame cannot show a rhythm, and the mirror-lock in particular looks
*correct* in every individual frame.

## Judging mascot cuteness needs an actual render, and sometimes needs a different animal

The hen went through four rebuilds across two review rounds (kawaii,
classic-refined, round-loaf, big-eye, front-facing, rounded-plush — see git
history on `src/icons/motifs.ts`) and was rejected every time. The panda
took two rebuilds to land. Two things made the difference:

- **Never judge pixel art from the coordinates.** Every "fixed" hen looked
  right on paper (comb touching the head, tail flush with the body, eye
  catchlight not cutting a corner) and still read as ugly or still had bugs
  the coordinates didn't reveal — a stray `translate()` wrapper once put an
  entire animal's body 6-7 units off from where its legs were drawn, and it
  only showed up once rendered. Rasterize every candidate (`@resvg/resvg-js`
  against the actual `renderIcon()` output, not a hand-rolled approximation)
  before showing it or committing it. A contact sheet of several candidates
  side by side made preferences legible in one round instead of several.
- **Iterating a design isn't the only move — sometimes the animal is wrong.**
  After the hen's fourth rejected rebuild, the fix wasn't a fifth rebuild; it
  was swapping the animal entirely (hen/chick → cat/kitten). Two hours of
  polishing comb shapes never fixed what a different silhouette fixed
  immediately. If N rebuilds of the same concept all get rejected, propose
  changing the concept before attempting N+1.

Two follow-ups landed after that entry was written, both worth recording
so they aren't re-litigated: the first cat (ginger, a longer lower-slung
body) was *also* rejected — the animal-swap fixed the hen's specific
failure mode, but didn't make every subsequent attempt automatically cute.
It took a second pass (beige palette, proportions pulled back in line with
the elephant/llama bar — bigger head, shorter torso, one tail segment fewer)
to land. And the panda's chibi/sitting redesign, despite surviving its own
contact-sheet review, was reverted back to the original side-profile
version after living on the deck for a while — a design can win a side-by-side
comparison and still lose to "the one I'm used to seeing" once it's the
thing actually sitting on the key. Don't re-propose the chibi panda or the
ginger cat without a specific reason.

Update: the beige cat was rejected too, on the very next round. Rather than
a third cat attempt, that slot became a stegosaurus — and it landed
immediately, on the first try, no contact sheet needed. The difference
looks like it was picking an animal with an iconic, simple, already-graphic
silhouette (round body, small head, a row of plates, a spiked tail) instead
of one whose "cute" depends on getting a lot of small proportions right
(a cat's ear angle, muzzle length, tail curl). When redesigning a mascot
that keeps failing, ask whether the animal itself has a strong enough
silhouette to carry sparse pixel-art detail before spending another round
tuning the same one's proportions.

Unrelated finding from the same session, in case it resurfaces: the
project's pinned `@resvg/resvg-js` occasionally panics
(`geom.rs` `Option::unwrap()` on `None`) rendering the `subagent` family
state, reproducible on stock, untouched mascots (e.g. the sauropod) — so
it's a latent bug in that dependency or its interaction with `Date.now()`
-driven blink timing, not a regression from any mascot's SVG. Harmless: the
live plugin never calls resvg for the animated per-slot icons (those go
straight from `renderIcon()` to `setImage` over the Elgato bridge); resvg
is only wired to the static manifest PNGs in
`scripts/render-static-pngs.mjs`. Worth a real fix only if it starts hitting
that script.

## The key already has two free text lines — measure before deleting one

`splitLabel` fills `top` (y=30, font 19) plus `line1`/`line2` (y=112/132, font
17). For a one-token label — which is every session once the namer assigns a
deck word — **both bottom slots render nothing**. Adding a second line there
costs no shrinkage.

This was nearly missed: a design discussion chose to *replace* the deck word
with model+effort specifically to avoid shrinking text that was never going to
shrink. Read `icons/theme.ts` before trading one piece of information for
another on a key face.
