# Handover — the session of 2026-08-13, into the 14th

Written for whoever picks this up next, cold. It records what was built, what
was decided and why, and — carried over again because it keeps earning its
place — **where I was wrong**, since the faults came in two families and both
are worth recognising on sight.

The durable rulings live in `v2-design.md`; the feature plans are
`tempo-map-plan.md`, `endless-play-plan.md` and `musicxml-import-plan.md`.
**Read this for the shape, those for the reasons.**

The app went from **v2.6.0 to v2.12.0** — eleven releases, all deployed. It
began as a refinement of one settings control and turned into a rebuild of the
play screen around the thing this app is named after.

## What was built, in order

**The range control** — finishing what the previous session started:

| | |
|---|---|
| v2.7.0 | **The range is turned, not picked from a list.** Two dropdowns of thirty-six notes became two dials, a stave step of the key to a detent, each detent clicking and tapping the hand. The ends of the compass stay reachable whatever the key — an Eb bass bottoms out on a note in no flat key at all. |
| v2.7.1 | **The dials moved either side of the stave**, halving the control's height. That freed the notes from lining up with them, so the clef and key signature are *measured* and the notes placed after them — which is what keeps seven flats and two bounds inside half the width. |

**The fingering callout:**

| | |
|---|---|
| v2.8.0 | **A fingering is a callout.** Valve numbers stacked in a capsule on a tapered tail pointing at its note; open is written `0`. Stacked because the room a hint needs is horizontal — `1-2-3` as text is three characters wide in the one direction a stave has none to spare, and hints were being dropped for want of it. The bar numbers moved out from under them. |

**Two faults in the engraving, both found by the player in a real hymn:**

| | |
|---|---|
| v2.8.1 | **A tie is marked a bar at a time.** A G held over four bars turned green in all four the moment it was started: the far end of a tie wears the verdict of the note it is tied from, and that verdict lands at the attack. |
| v2.8.2 | **A level beam clears its highest note.** Its height was measured from the note *furthest* from it, so a beamed octave left the nearest note with no stem and the beam ran into the notehead. |

**The play screen, rebuilt around the fingerings:**

| | |
|---|---|
| v2.9.0 | **The notes list is gone; mistakes are answered on the note.** The player's verdict on the list — *you can never pay enough attention to it to see what the fingering was supposed to be* — is the whole case. A wrong note now prints its fingering over itself and over every later note of that pitch, immediately, with no cap. The space became a tempo control that moves the clock mid-run. |
| v2.9.1 | **That control is a dial.** A slider had to fit 40–220 into the width beside the stave; a dial gives the same travel to every beat a minute. `useDial` carries the gesture for both dials in the app. |
| v2.10.0 | **Pause, and take it from a bar or five back.** A pause freezes the clock rather than the scheduler. Starting again counts in one *real* bar — the transport starts a bar early with the scheduler pointed past it, so the clicks are that bar's true metrical positions. A rewind un-judges everything after it. |
| v2.10.1 | **A rewind plays at the tempo on the dial**, and the dial turns twice as far for a swipe. |
| v2.11.0 | **The hint rules, worked through with the player** — the section below. |
| v2.12.0 | **A note in a run gets the hint it has earned.** The timing rule was measuring the note's length and calling it reading time. |

## The decisions worth not re-litigating

**Trouble is filed under the written note, and travels nowhere.** The session's
largest ruling, and the one to start from if the hints are ever reopened. With
valve buttons and no microphone the app sees which combination went down and
nothing else: it cannot tell a player who chose the *wrong fingering* from one
who chose the right fingering and *mispitched*, so it must not pretend to teach
either. What it can honestly see is whether a note on the page was recognised.
So trouble attaches to the written note as it appears on the stave for this
instrument and clef — not to the valve combination, and not to the same letter
in another octave. The player's own case: *I don't know what high B looks like,
but I have no trouble with the B above middle C.* **Revisit when the microphone
lands**, which the player expects to be soon; a wrong fingering and a mispitch
are different faults with different answers.

**A prompt retires, and comes back.** Two of that note played right and it
stops. This does not overturn "a hint that came and went would be worse than
none": it goes away for a reason the player can feel.

**Wrong valves and a missed note are not the same evidence.** Wrong valves are a
fingering reached for and missed, and prompt at once. Nothing held at all is as
likely to mean lost, behind, or resting a lip — two of those before it prompts.

**Three modes, because the app is used in three frames of mind.** Reading
something new with the answers in front of you; practising with a prompt where
the trouble is; playing it for real.

**A live tempo change extends the map and never re-anchors it.** The beat↔time
map is anchored at one origin, and `setTempo` was once a method that threw for
that reason. `changeTempo` appends a step at the next whole beat past the
scheduling horizon — beyond everything already committed to the audio thread,
and a target a dragging finger keeps landing on, so changes replace rather than
stack. `rebaseTempo` is the exception and is safe *only* because its one caller
re-anchors immediately afterwards.

**A pause freezes the clock, not the scheduler.** The audio context's time is
the sound card's and never stops.

**A figure sizes itself to its ink, furniture included.** `headerExtent` and
`fingeringHintY` publish the numbers the drawing uses; nothing measures a canvas
by a second opinion.

## Where I was wrong

**Family one: a jump backwards is a state reset, and I kept finding another
piece of state that was not in it.** Three faults, one shape:

| what was not reset | what it cost |
|---|---|
| the transport itself (`start` no-ops while running) | a rewind made *while playing* did nothing at all — the score gave up its bars and the music carried on |
| the screen's copy of the verdicts | `onRewind` existed in the session and was never wired into `PlayScreen`, so the colours stayed |
| the player's own tempo steps | a passage replayed at the speed it had the first time while the dial said otherwise |

If anything about pause, rewind or restart looks wrong, **ask what else is
still holding the old pass's state**. `Session.restartAt` and `unplay` are where
the answer belongs, and `offering` is still not in them — see below.

**Family two: measuring the wrong quantity.** Last session's was "measured in
one unit, consumed as another"; this one is subtler and worse, because the
arithmetic is right and the *question* is wrong:

- The beam's height was measured from the note furthest from it, which spends
  the whole stem on the note that needs it least.
- The hint's timing rule measured how long a note *lasts* and called it reading
  time — but the strike line sits near the left of the display, so a hint is on
  screen for seconds before its note arrives. The rule withheld hints from fast
  passages for a reason that was never true.
- The range stave was measured for its notes and not its furniture, and cropped
  a treble clef's tail.

**The player found every one of the bugs that shipped, and one I could not
reproduce by reasoning.** The tempo-after-rewind fault took a measurement in a
browser to see: notes judged per second, 3.8 at 200bpm, 0.5 wound down to 40,
3.2 after a rewind. Two hours of reading the code had produced four wrong
theories.

**I believed a null result from my own harness.** A screenshot script pressed
60px above the dial's centre — outside it — and reported that three spins moved
the tempo not at all. The dial was fine. *Check the harness before believing
what it says about the code.*

## What is left

**The microphone**, which the player expects to pick up next, and which several
things here are waiting on:

- The hint ruling above is explicitly provisional until it lands.
- `docs/v2-design.md` has the fermata parked on it too — a fermata means "hold
  until released", and only the microphone can release the player.

**Pause and rewind**, the newest thing here:

- **`offering` is not reset by a rewind.** Rewind from inside the offer window
  back to the start and the button stays green, the reference tone stays at
  half volume, and the offer can never be made again. Generated exercises only;
  an imported part is committed to its whole length.
- **A stray metronome click can land after a pause**, since the scheduling
  horizon is already on the audio thread. The sounding note is cut; a click
  cannot be.
- **A rewind during the count-in** works but is untested against a piece whose
  first bar is a pickup.

**The fingering hints:**

- **The reach-back was designed and not built.** For a passage too dense for a
  capsule to fit, the idea was to hang it over an earlier note with the tail
  reaching to the one it names. It was dropped because a tail crossing a beam
  into a cluster of semiquavers is a worse answer than silence — but if a
  player asks for it, `hints.ts` should decide the anchor and the renderers
  draw a slanted tail.
- **"Every note" at Expert is a dense row of capsules.** Legible, but busy;
  worth the player's eye before it is called finished.
- **A bar containing a note the instrument cannot play never reveals its
  verdicts in paged reading.** `revealByBar` waits for every note in the bar,
  and an unplayable note is never judged. Pre-existing and reachable from
  imported parts.

**The bar picker** — still the least settled part of My Music:

- **The split bars are the untested edge.** Bars 16/17, 23/24, 33/34, 49/50 and
  66/67 of the hymn are where the scanner cut one printed bar in two.
- **`times` is fixed at build**, and nothing keeps a selection between visits.

**The importer, in rough order of value:**

- **Tempo marks are not read.** `<sound tempo>` is quarter-notes per minute and
  the app's tempo names the *pulse*, so it wants the v1.30.0 conversion.
- **`<transpose>` is ignored by design and never tested.** A real brass band
  part will carry one.
- **The part chooser has not met a real multi-part score.**
- **The long-rest skip is not offered.** Over ten seconds at the designated
  tempo, ask, and come back in at the bar before.

**The conductor:** the compound lag/lift verdict is still unanswered;
`BEAT_IN_FEWER_ABOVE_BPM = 168` and `SUBDIVIDE_BELOW_BPM = 76` are guesses
awaiting a play-test; five, seven, nine and twelve patterns are unbuilt.

**Elsewhere:** variable tempo is still sparse across the grey for free material
and patterns, and it now interacts with the dial — a planned step overrides
what the player set, which is documented but has never been played.

## How this session worked, which is worth repeating

**Drive the thing and measure it.** Every fault that mattered was found by
running the app under Playwright and either looking at the picture or counting
something: notes judged per second for the tempo bug, the ink extents of every
glyph for the cropping, three thumb-spins for the dial. Reading the code found
none of them.

**Look at the picture, then look at the extremes.** The callout over the Stop
button, the beam through a notehead, the wall of capsules at Expert — all
screenshots, none of them visible to a test that measures notes against each
other.

**Mutation-test the test you just wrote.** Twice again this session a new test
was checked by breaking the code it was written to guard, and twice it earned
its keep. The range-stave crop test and the beam floor both fail on the old
arithmetic.

**Ask what the rule is actually measuring.** Two of the three bugs in family two
were arithmetic that worked perfectly on the wrong quantity. "Is this the
question I meant to ask?" would have caught both.

**Workshop the central feature with the player before touching it.** Presenting
the whole hint rule set as it stood, with the tensions named and a
recommendation on each, produced a better answer than any of my proposals — the
microphone ruling in particular, which no amount of code-reading would have
reached.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint), tag every version on its last commit, keep pure corrections in
their own release, and confirm the deploy afterwards rather than assuming it.
