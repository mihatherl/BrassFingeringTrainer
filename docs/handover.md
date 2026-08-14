# Handover — the session of 2026-08-13

Written for whoever picks this up next, cold. It records what was built, what
was decided and why, and — carried over from the last one because it earned its
place — **where I was wrong**, since the errors in this session came in a family
and the family is worth recognising on sight.

The durable rulings live in `v2-design.md`; the feature plans are
`tempo-map-plan.md`, `endless-play-plan.md` and `musicxml-import-plan.md`, all
kept current as they were built. **Read this for the shape, those for the
reasons.**

The app went from **v2.1.1 to v2.6.0** — nine releases, all deployed. It began
as a consolidation and turned into three features and a long tail of
corrections.

## What was built, in order

**The consolidation that started it** — no version bumps; none of it is
user-visible:

| | |
|---|---|
| — | **A real `.mxl` in the test suite.** `TestPiece.mxl`, a MuseScore export, read from disk through unzip, parse, unfold, read, assemble. The only test that would notice a fault living *between* two stages. |
| — | **`storage/library.ts` tested directly** — the `movement-title` path every OMR import takes, and all six branches of `requestPersistence`. |
| — | **Nine dead exports deleted**, lint added to CI, two finished plan docs marked as shipped. |

**The importer:**

| | |
|---|---|
| v2.2.0 | **Every bar checked against the metre.** Pure arithmetic; the most valuable unbuilt thing in the last handover. Reported first among the warnings, because it is the only one that makes an import untrustworthy rather than incomplete. |
| v2.3.0 | **A bar longer than its time signature read as the bar it is** — five beats in a four-four piece becomes a one-bar 5/4, which `metres` could always express. |

**The conductor**, in the same release:

| | |
|---|---|
| v2.3.0 | It **follows the metre** now, instead of being handed bar 1's for the whole piece. Two faults fell out: `placeInPattern` was getting the absolute beat where it counts from the bar line, and an unbeatable metre unmounted the panel, which stopped the only loop watching the beat. And the **metronome covers the bars the conductor cannot beat**, since "the metronome carries on" was only true if the player had it on. |

**The screen:**

| | |
|---|---|
| v2.4.0 | **The settings screen quietened.** One key control instead of two, an Advanced section for the abstract knobs, the reading-mode cards cut from 95 words to about 20, and the tempo lifted out of the panels to sit with Start. |

**My Music — choosing what to practise:**

| | |
|---|---|
| v2.5.0 | **Choose bars off the page and practise those.** The importer learned to read a *passage*; the score view lets you pick one. |
| v2.5.1 | Rectangles off their bars; the wrong bars practised; the page shivering on every tap. |
| v2.5.2 | Bar numbers taken from the printed part; a tap beside a run grows it. |
| v2.5.3 | Drawn bars translated to measures before they are read. |
| v2.5.4 | The joining bar of rests counted as part of the block, so the grey stops creeping. |

**The range:**

| | |
|---|---|
| v2.6.0 | **The player says which notes free material is drawn from.** The band always existed and was centred on the compass; now it can be asked for, and an asked-for range is taken literally. |
| v2.7.0 | **And says it by turning a dial.** Two dropdowns became two dials under the two notes, turned with the finger, a stave step of the key to a detent, each one clicking as it passes. |
| v2.7.1 | **The dials moved to either side of the stave**, halving the height of the control. The settings screen is being kept short, and a row that stands between a player and Start has to earn it. |

**The fingerings:**

| | |
|---|---|
| v2.8.0 | **A fingering is a callout now** — valve numbers stacked in a capsule on a tapered tail pointing at its note. Stacked because the room a hint needs is horizontal, and the bar numbers moved out from under them. |

**The marking:**

| | |
|---|---|
| v2.8.1 | **A tie is marked a bar at a time.** A G held over four bars used to turn green in all four the moment it was started — the far end of a tie wears the verdict of the note it is tied from, and that verdict lands at the attack. Reported from a hymn. |
| v2.8.2 | **A level beam clears its highest note.** Its height was measured from the note furthest from it, so a beamed octave left the nearest note with no stem and the beam ran into the notehead. Reported from bar 41 of the same hymn. |

**The play screen:**

| | |
|---|---|
| v2.9.0 | **The notes list is gone; mistakes are answered on the note, and the tempo is under the player's hand.** A wrong note prints its fingering over itself and over every later note of that pitch, immediately, with no cap on how many. The space the list held is now a tempo control that moves the clock mid-run. |
| v2.12.0 | **A note in a run gets the hint it has earned.** The timing rule was measuring the note's length, not reading time — the strike line is near the left of the screen, so a hint is legible for seconds before its note arrives. It now applies to *every note* mode alone; *where I struggle* prints wherever one fits. |
| v2.11.0 | **The hint rules, worked through with the player.** Trouble is filed under the written note and does not travel to other octaves or to notes sharing a fingering — until the microphone lands, the app cannot tell a wrong fingering from a mispitch, so what it teaches is note recognition. Two right in a row retire a prompt; a miss takes two to earn one; history needs four attempts. And the switch became three modes: every note, where I struggle, never. |
| v2.10.1 | **A rewind plays at the tempo on the dial**, and the dial turns twice as far for a swipe. The player's tempo changes were living in the same list as the score's own, so going back replayed a passage at the speed it had the first time while the dial said otherwise — and the scoring, which follows the clock, appeared to race ahead of the playing. |
| v2.10.0 | **Pause, and take it from a bar or five back.** A pause freezes the clock rather than the scheduler; starting again counts in one real bar. A rewind goes to the top of a bar and un-judges everything after it, so the passage can be played again. The tempo dial grew, took the reading onto its face, and shows a big callout only while it turns. |
| v2.9.1 | **That control is a dial, with the reading above it.** A slider had to fit forty to two hundred and twenty into the width beside the stave; the dial gives the same travel to every beat a minute and takes a few spins to cross. The number is large and above, because the thumb covers the dial. `useDial` now carries the gesture for both dials in the app. |

## The decisions worth not re-litigating

**A selection is a walk, not a slice.** The importer has always read a list of
measure indices, and the unfolder has always produced one. So *played*,
*printed* and *passage* are three lists through the same apparatus — no
`Exercise` is ever cut up, and eight chosen bars come out beamed, bracketed and
spelled by the same `assembleExercise` that does the whole part.

**A passage takes each span once, whatever signs are inside it.** The player
pointed at bars on the page, so eight selected is eight played. Selecting the
same run twice is how to ask for it twice.

**The gap between selections is a bar of rests in the metre being landed in.**
It is preparation, not an ending; the count that helps is the one about to be
needed. It also belongs *inside* the block for Continue — it is the bar you
count through to come in again, not a pause between two things.

**Bar numbers come off the printed part.** Where a file has them they win, over
the app's own counting. The whole worth of a bar number is that it means the
same to the player, the app and whoever is saying "from bar thirty-three", and
a part with a pickup makes counting and printing disagree for its whole length.

**Infer a long bar, report a short one.** Measured, not reasoned: every one of
the eleven malformed bars in the OMR file to hand is *short*, and five are pairs
summing to one bar — bars the scanner split. A short bar is something missing
and the app cannot know what; a long bar has music that has to go somewhere.

**A range asked for is taken literally; unset, the middle is favoured.** All of
it, none of it favoured — someone asking for the bottom of the horn has said
something specific. Difficulty then governs the leaps, accidentals and rhythm
but not where the notes sit. Free material only: a pattern asks `register`
instead, and a theme finds its own octave. Written up in `v2-design.md`.

**An odd metre still gets no conductor.** The player confirmed the existing
ruling — a five is not a four with a beat wedged in — and the metronome now
covers those bars instead.

## Where I was wrong

**Every substantive bug this session was one quantity measured in one unit and
consumed as another.** Four of them shipped in the bar picker alone. If
something in that feature looks off, look here first:

| measured as | consumed as | what it cost |
|---|---|---|
| bar as drawn | measure in the file | practised music six bars early |
| positional index | printed bar number | the app a bar ahead of the paper |
| one pass's music | the loop's period | the grey creeping back a bar a cycle |
| note-column x | bar-line x | taps landing in the bar before |

**A test can share the bug's blind spot.** Twice. The bar-map test fixture had
`source === index` at the near end, so a translation that did nothing was
indistinguishable from one that worked — written into the very test meant to
catch it. And the first `barRects` tests checked internal consistency (bars
abutting, entries in order) rather than agreement with the drawing, so they
passed with the setback removed. **Mutation testing found both; neither was
visible by reading.**

**I sized a canvas for the notes and forgot the furniture.** The range stave
was measured for its two noteheads, their ledger lines and their fingerings, and
came out with a treble clef's tail cut off square along the bottom edge — and,
at the other end, the fingering over a note sitting quietly *inside* the stave,
where nothing looked like it needed room at all: a hint clears an imaginary
stem, so a note just below the middle line reaches higher than one above it.
Both were invisible to a suite that measures notes against each other and
visible in the first screenshot. The fix is the rule this codebase already had:
`headerExtent` and `fingeringHintY` publish the numbers the drawing uses, and
the figure sizes itself from those rather than from a second opinion.

**I proposed a rule without counting.** "Whole number of beats, and few of
them" as the test for whether a bar is music or corruption — then counted the
corrupt file and found every one of its malformed bars is a whole number of
crotchets. It would have inferred all eleven and hidden the fault it was built
to report.

**I recommended overriding a ruling I had not read.** The conductor's
"a five is not a four with a beat wedged in" is in `patternFor`, with a test
pinning it. I offered the opposite as a recommendation and the player took it.

**The handover's own "27 of 84 bars" was wrong.** Counted twice by
methods with no code in common: 87 measures, 13 not holding three beats, 11
once the pickup and its completing bar are set aside.

## What is left

**The bar picker** — the newest thing here and the least settled:

- **The split bars are the untested edge.** Bars 16/17, 23/24, 33/34, 49/50 and
  66/67 of the hymn are where the scanner cut one printed bar in two. Selecting
  a run that starts or ends on one exercises the half of `measuresFor` that
  takes both measures, and no real-file test covers it.
- **`times` is fixed at build.** A selection is laid out `passesFor(bars)` times
  and Continue walks through them. Past that there is no more to offer, and the
  run simply ends.
- **Nothing keeps a selection.** Choosing bars is per-visit; the library stores
  the file and the part, not a passage.

**The range**, newest of all:

- **Imported music has no range control**, and arguably wants one least — the
  part says what the notes are. But a passage above what the player can reach is
  exactly the case the out-of-range warning already reports, and a range would
  be a different answer to it.
- **Themes ignore it**, which is right for now and worth revisiting if a player
  asks to drill a tune in a register other than the one it lands in.

**The importer, in rough order of value:**

- **Tempo marks are not read.** `<sound tempo>` is quarter-notes per minute and
  the app's tempo names the *pulse*, so it wants the v1.30.0 conversion.
- **`<transpose>` is ignored by design and never tested.** A real brass band
  part will carry one.
- **The part chooser has not met a real multi-part score.**
- **The long-rest skip is not offered.** The ruling stands — over ten seconds at
  the designated tempo, ask, and come back in at the bar before.

**The conductor:**

- The compound lag/lift verdict is still unanswered. "Compound needs nothing" is
  a legitimate answer and should be recorded as one if it is the one.
- `BEAT_IN_FEWER_ABOVE_BPM = 168` and `SUBDIVIDE_BELOW_BPM = 76` are guesses
  awaiting a play-test. One constant each.
- Five, seven, nine and twelve patterns are unbuilt — and now reachable, since
  an imported bar can be inferred into 5/4 or 7/8.

**Elsewhere:** variable tempo is still sparse across the grey for free material
and patterns. And **Advanced is where a beginner will never look, including when
they should**: the timing tolerance is the likeliest setting to make a player
think the app is wrong about them, and nothing on the main screen says it
exists.

## How this session worked, which is worth repeating

**The player found every picker bug, and each report was precise enough to
trace.** "Bars 82 and 83 give me the last note of 77, all of 78 and the first
beat of 79" is a bug report with the arithmetic already in it. The right first
move each time was to reproduce the exact case against the real file rather than
to reason about the code — and each time the reproduction named the fault in one
line.

**Mutation testing is the only thing that caught the tests that could not fail.**
Run it on the test you just wrote, not only on the code. Twice this session a
new test passed against the mutation it was written to catch.

**Measure before choosing a constant, and count before proposing a rule.** The
score view's stave size came from measuring the fixture at five scales (29
systems and 4324 pixels at the reading size, eleven and about a screen and a
half at the scanning one). The inference rule came from counting a corrupt
file's bars, which killed the rule I had already proposed.

**Look at the picture.** Two faults in the picker were visible only in a
screenshot and invisible to every test: the score was drawn at reading size when
it needed scanning size, and the line naming what you had chosen was rendering
behind the sticky strip.

**Say what the app decided, where the page does not.** An inferred 5/4 bar is
reported, because the app has decided something the printed part does not
state — and if it decided wrongly, that sentence is what lets the player see it.

**Look for the feature that is already built.** The range control was most of a
day's work expected and an afternoon's actual, because `candidatePitches` had
always computed a band — the difficulty's width, centred on the compass. Nothing
had to be invented; a computed thing had to become an asked-for one, with the
old behaviour kept as the unasked default. Worth a look before designing
anything here: this app tends to have the machinery and be missing the question.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint), tag every version on its last commit, and keep pure corrections in
their own release so patch numbers mean something — v2.5.1 through v2.5.4 are
this session's examples.
