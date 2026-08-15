# Handover — the session of 2026-08-15

Written for whoever picks this up next, cold. It records what was built, what was
decided and why, and — carried over again because it keeps earning its place —
**where I was wrong**, since this session's faults were of a different kind from
the last two and are worth recognising on sight.

The durable rulings live in `v2-design.md`; the feature plans are
`tempo-map-plan.md`, `endless-play-plan.md` and `musicxml-import-plan.md`.
**Read this for the shape, those for the reasons.**

The app went from **v2.12.0 to v2.15.1** — seven releases, all deployed, and one
commit of documentation carrying no version because it changed nothing. It began
by clearing the faults the previous handover listed as inherited, built the
feature the player asked for on top, and ended in the settings screen, which is
half way through a planned reorganisation.

## What was built, in order

**Clearing the inherited faults**, all four of them named in the last handover:

| | |
|---|---|
| v2.12.1 | **A rewind takes the standing offer with it.** The offer to carry on is made once per committed end and remembered, so a rewind out of its window left the button green, the tone at half volume, and the question unaskable ever again. Also: **a bar waits only on the notes that can be judged** — one note above the top of a tuba held its bar grey for the rest of the run in paged reading. |
| v2.12.2 | **The rewind buttons stay live.** `canRewind` was written to grey them out at the top of a piece and was never wired to anything; the player ruled ◀5 in bar two should simply go back to the start, so it was deleted. |

**The key dial**, the session's largest piece:

| | |
|---|---|
| v2.13.0 | **The key is under the player's hand, mid-run.** A dial beside the tempo; the face follows the finger and the music is rewritten when the finger comes off. The paper is spliced in place at a bar line ahead of the playhead. Free material only. |
| v2.13.1 | **The smoothed clock never ticks backwards.** Found from a player report about paged reading flipping back towards the start — see below, because finding it is most of the story. |

**The settings screen**, steps 1 and 2 of four:

| | |
|---|---|
| v2.14.0 | **Three choices taken off it.** *Random notes*, Expert, and the three length settings that wore one label. The paywall moved from lengths to *playing on*. |
| v2.15.0 | **One box per material**, holding only the settings that apply to it. The open box is the material. |
| v2.15.1 | **Nothing claims what it does not deliver.** The Arpeggios box promised five chords and played one. |

## The decisions worth not re-litigating

**A key is a destination, not a path.** The key dial commits on release rather
than per detent — and the reason is musical, not computational. Two hundred bars
regenerate in about 4ms and engrave in half of one, measured before it was built.
Sliding from one flat to two sharps passes through C and G, and putting those on
the page on the way would show a player two keys they never asked to read.

**The splice lands on a bar line past the scheduling horizon, and that is what
makes note indices safe.** Everything below the splice keeps the index it had,
which is what lets a run change key without losing what has been played:
`judgements`, `noticed`, the screen's verdicts and per-note hint state are all
indexed into the note list. Past the horizon because nothing already handed to
the audio thread can be rewritten; on a bar line because an accidental depends on
the key *and* on what has occurred in its bar, and the notes either side of a
join were spelled by two different runs of the generator.

**The paper is spliced in place, not replaced.** The session, the renderer, the
hints and the play screen all hold the same `Exercise`, and several destructure
its `notes` at construction. One piece of paper, everybody reading it, and an
explicit call to say it changed.

**A key tour ends where the player names their own key.** The tour's changes are
the score's instruction and the dial is the player's — the same split
`changeTempo` draws between a written step and a turned one.

**Length is not a setting, and the paywall is *playing on*.** Every tier gets the
same material and the same default length; only a paid copy carries on past the
end of it. Enforced by not generating the horizon rather than by declining the
offer, so nothing has to say no and no green button turns out to be a shop. Every
material kind is free — a mode shown but unusable teaches nobody what the app is
for.

**The open box is the material.** One state, not two. A selected box and an
expanded box say almost the same thing, and two things saying almost the same
thing can disagree.

**`maxInterval` constrains a random walk, not an authored tune.** A generated
line picking freely inside a wide interval is a sequence of unrelated jumps; a
composer's tenth is placed, prepared and resolved. Themes have their own ceiling.

**Nothing should make a claim of something it doesn't deliver.** The player's
rule, and now a test in both directions: a blurb may not widen past the patterns,
and adding a pattern without widening the blurb fails too.

**Melodic minor is drilled ascending melodic and descending natural.** Ruled
before the code that needs it exists.

## Where I was wrong

Not the two families of the last two sessions. These were failures of *method*
rather than of arithmetic, and all three cost more than the bugs did.

**I invented a hazard, wrote it into a plan, and had to take it back out.** The
key-dial plan warned that a narrow range in a distant key could leave the
generator with nothing to pick and throw. It cannot. `candidatePitches` walks
every semitone of the range and never reads `fifths` at all; the key enters later
as a *preference* in `chooseNext`, which falls back to the whole reachable set
when it empties. The player's proposed answer — "just give them accidentals" —
was what the code had always done. **A plan is read as fact by whoever picks it
up.** Check the code before writing a hazard into one; a hazard that is not real
costs the next session the time to find that out.

**My first model of a bug reproduced nothing, and I nearly believed the code was
innocent.** The player reported paged reading occasionally flipping back towards
the start. Two theories died: that a stitched theme's tempo steps made the beat
map non-monotonic — checked over the whole compiled map of a real themes
exercise, monotonic to the last decimal — and a synthetic clock test that had
`currentTime` lagging wall time *evenly*, which never overshoots and so passed.
Only sampling a real browser frame by frame found it: **four backwards steps in
twenty seconds, up to three hundredths of a beat.** A test that reproduces
nothing is evidence about the test.

**A test I had just written asserted something false, and mutation-testing caught
it.** Removing *Random notes* left sight-reading as the only free material, and I
rewrote the open-notes steering test as a comparison — in-window against
elsewhere. It passed. It also passed with the steering deleted. Measured, the
rates are 0.229 against 0.236: **the steering is very nearly inert for stepwise
material**, which has two or three notes to choose between at any moment. I
deleted the test rather than weaken its threshold to fit, and wrote the loss down
where the rule lives. A test that cannot fail is decoration, and it would have
read as a guarantee for years.

**Two mechanical own goals, both from editing files with scripts.** A greedy
deletion in `settings.ts` took `REGISTERS` out along with the constants either
side of it, and a restore from a `/tmp` backup older than the edit I was keeping
silently reverted two `export` keywords. The typecheck caught both within a
minute. **Assert what a scripted edit is about to remove**, and never restore
from a backup taken before the change you want to keep.

## What is left

**The settings screen**, half done. `v2-design.md` item 11 carries the plan.

- **Step 3 — Drills.** Scales and Arpeggios become one box with a selectable
  drill type, and the key choice moves into it. `SCALE_PATTERNS` and
  `ARPEGGIO_PATTERNS` are exported lists of `{ rootDegree, intervals }` and the
  picker is a matter of listing entries. The **four arpeggios the box used to
  promise** — subdominant, dominant, dominant 7th, relative minor — are wanted
  here, and the blurb guard fails the moment one is added, which is the reminder
  to write the sentence back.
- **Step 4 — named minor scales.** *A minor harmonic*, chosen as a book prints
  it. The intervals are free; **the work is spelling.** `spellInKey` picks
  accidentals by the key signature's direction, and a minor key takes its
  relative major's signature — so D harmonic minor is one flat and its raised
  seventh comes out as D♭ rather than C♯. The pattern must carry which degree is
  raised, not a semitone count.
- The picker ends up around ten entries once both land, which argues for a
  scrollable list rather than a row of chips.

**The engraving fault the key dial made prominent**, and the first thing to look
at if notation looks wrong at a change of key:

- **A key signature change on a scrolling line still collides with the music at
  some joins.** Room is now reserved where none was, which fixes the plain cases
  and is a strict improvement, but not every one. **Pre-existing** — a key tour
  collides identically with the dial untouched — and paged reading is unaffected.
  Finishing it wants measured glyph extents on a fixed seed, the way the range
  stave's crop was settled, rather than screenshots of randomly seeded runs.

**Three things ruled but not built**, all from the settings work:

- **Leaps want reconsidering per instrument, not just per difficulty.** It is now
  the answer to two separate things: the angular interval reading that left with
  *Random notes*, and the open-note margin past a block boundary that stepwise
  material cannot hold on its own.
- **The theme corpus needs recategorising and extending.** Its difficulty labels
  read easier than the generated material of the same name — the player's own
  observation, made while eight themes were being refiled out of Expert.
- **Melodic minor's shape** is settled and waiting for step 4.

**The microphone**, which the player expects to pick up, and which several things
wait on:

- The hint ruling — trouble filed under the written note — is explicitly
  provisional until it lands.
- The fermata is parked on it: "hold until released", and only the microphone can
  release the player.

**Pause and rewind:**

- **A stray metronome click can land after a pause**, since the scheduling
  horizon is already on the audio thread. The sounding note is cut; a click
  cannot be. Not fixable from this side.

**The fingering hints:**

- **The reach-back was designed and not built.** For a passage too dense for a
  capsule, the idea was to hang it over an earlier note with the tail reaching to
  the one it names. Dropped because a tail crossing a beam into a cluster of
  semiquavers is worse than silence — but if a player asks, `hints.ts` should
  decide the anchor and the renderers draw a slanted tail.

**The bar picker** — still the least settled part of My Music:

- **The split bars are the untested edge.** Bars 16/17, 23/24, 33/34, 49/50 and
  66/67 of the hymn are where the scanner cut one printed bar in two.
- **`times` is fixed at build**, and nothing keeps a selection between visits.

**The importer, in rough order of value:**

- **Tempo marks are not read.** `<sound tempo>` is quarter-notes per minute and
  the app's tempo names the *pulse*, so it wants the v1.30.0 conversion.
- **`<transpose>` is ignored by design and never tested.** A real brass band part
  will carry one.
- **The part chooser has not met a real multi-part score.**
- **The long-rest skip is not offered.** Over ten seconds at the designated
  tempo, ask, and come back in at the bar before.

**The conductor:** the compound lag/lift verdict is still unanswered;
`BEAT_IN_FEWER_ABOVE_BPM = 168` and `SUBDIVIDE_BELOW_BPM = 76` are guesses
awaiting a play-test; five, seven, nine and twelve patterns are unbuilt.

**Elsewhere:** variable tempo is still sparse across the grey for free material
and patterns, and it interacts with the tempo dial — a planned step overrides
what the player set, which is documented but has never been played.

## How this session worked, which is worth repeating

**Drive the thing and measure it — and measure the thing you are about to
assert.** Every finding that mattered came from running the app or the generator
and counting: 4ms to regenerate two hundred bars, which decided *why* the key
dial commits on release; four backwards clock steps in twenty seconds, which
found a bug two theories had missed; 0.229 against 0.236, which killed a test.
Reading the code found none of them, and in one case reading the code produced a
hazard that was not there.

**Reproduce before fixing, and distrust a model that reproduces nothing.** The
clock bug took three attempts: two theories and a synthetic test that was too
kind to the audio clock. The fix took ten minutes once it could be seen.

**Mutation-test every new test.** Every rule added this session was checked by
breaking the code it guards, and every one earned its keep — including the time
it revealed that the *test* was false rather than the code.

**Ask what the rule is actually measuring.** `maxInterval` was one rule doing two
jobs, and only one of them was its own. Splitting it re-homed eight written tunes
that would otherwise have been deleted.

**Check the code before writing a hazard into a plan.** See above; this is the
one I would most want the next session to have.

**Take the player's reasoning, not just their answer.** Twice their one-line
verdict — *not enough differentiation*, *nothing should claim what it doesn't
deliver* — was worth more as a rule applied everywhere than as the single change
requested. The second produced an audit of ten blurbs, of which exactly one lied.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint), tag every version on its last commit, keep pure corrections in
their own release, and confirm the deploy afterwards rather than assuming it.
