# Handover — the session of 2026-08-11/12

Written for whoever picks this up next, cold. It records what was built, what
was decided and why, and — new in this one — **where I was confidently wrong**,
because four separate claims in this session sounded authoritative and were not.

The durable rulings live in `v2-design.md`; the feature plans are
`tempo-map-plan.md`, `endless-play-plan.md` and `musicxml-import-plan.md`, all
kept current as they were built. **Read this for the shape, those for the
reasons.**

The app went from **v1.36.0 to v2.1.1** in this session, all deployed. Nearly
all of it was My Music: MusicXML import, end to end.

## What was built, in order

**The groundwork the importer needed:**

| | |
|---|---|
| v1.37.0 | **`Exercise.metre` became `metres`, a list.** The structural blocker. `barAt`/`beatOfBar` now walk the list, because `beat / barBeats` is right up to a change and wrong after it. |
| v1.38.0 | **Bar numbers.** At the head of each system; every fifth bar on the scrolling line. A player navigates by them and every import warning names them. |
| v1.39.0 | **The multi-bar rest.** `RestEvent.bars`, drawn as the H-bar with its count. Not unfolded — the count *is* the notation. |

**The importer:**

| | |
|---|---|
| v1.40.0 | **The unfolder.** Repeats, endings, D.S./D.C., coda, Fine. Split from the MusicXML reader so the algorithm is testable without XML. |
| v1.41.0 | **The part reader.** Notes, ties, keys, metres — read in *playing* order — ending at `assembleExercise`, the same function the generator ends at. |
| v1.41.1 | Bar-repeat correction. See *Where I was wrong*. |
| v1.42.0 | **The front door.** My Music, a file picker, `.mxl` unzipped without a dependency, warnings shown before playing. |
| v1.43.0 | **A change of time signature drawn where it falls.** One apparatus for key and metre together. |
| v1.43.1 | `<forward>` and `<backup>` honoured, so a bar cannot come out short. |
| v1.44.0 | The demisemiquaver, so a real part's note is not dropped. |
| v1.45.0 | **Which line to read where a bass part divides**, asked rather than assumed. |
| v1.46.0 | Bars the navigation never reaches, reported. |

**Version 2:**

| | |
|---|---|
| **v2.0.0** | **The library.** Open your own part and it is still there tomorrow — the line agreed in advance for what a major version means here. |
| v2.0.1 | My Music moved to the top of the settings screen, where it can be found. |
| v2.0.2 | The file picker's `accept` filter removed; it was hiding `.mxl` on Android. |
| v2.1.0 | A note the instrument cannot play is no longer marked wrong. |
| v2.1.1 | A long note keeps sounding past the end of its sample. |

## The decisions worth not re-litigating

**Unfold, do not navigate live.** The player's call. A flat run is the shape
every existing consumer already understands, so the renderer, transport and
scoring window needed no change at all. The cost — a piece longer than the
printed part, its structure gone from the page — is accepted, not an oversight.

**What is kept in the library is the file, not the exercise.** A stored
`Exercise` would freeze at the importer version that made it, and this session
alone fixed six faults in that importer. Opening re-reads the bytes with today's
instrument, which is also what lets changing instrument re-finger the music.

**One line of a divided part, chosen by the player.** Both cannot be rendered:
`NoteEvent` holds one pitch and one sounding note, so drawing two while sounding
one would be three stories on one stem.

**The instrument stays the player's, not the file's.** Written pitches come off
the page; fingerings follow from what is in their hands. That is what lets a tuba
player read a cornet part — and is why a note can land out of reach, which is now
shown, sounded and not judged.

**A major version lands on a change of category**, not on a feature list. There
are no API consumers here, so the only question the number answers is whether a
player would say this is a different app. Recorded in `v2-design.md`.

## Where I was wrong

Four claims that sounded authoritative and were not. Every one was caught by
checking rather than by thinking harder, and they are listed because the *shape*
of the error repeats.

**`measure-repeat` leaves its bars empty.** It does not. The schema — bundled in
the same jar as the binding I had verified the *fields* against — says the music
"needs to be repeated within each measure of the MusicXML file". I had checked
the fields and then reasoned about the meaning from memory. Corrected in
v1.41.1; the plan doc keeps the wrong version visible and marked.

**"Fix the multi-bar rests and the OMR file is fine, fifteen minutes."** It had
**27 of 84 bars** not containing three beats, and the bar-number drift went in
*both* directions, which missing rests cannot cause. I had generalised from one
system that happened to look right.

**"The two lines of a divisi are different fingerings."** At the octave — which
is how a bass part nearly always divides — they are the *same* fingering on a
different harmonic. A test I wrote to prove my claim failed, correctly.

**Implying I judge music better than the OMR.** I did not read the score. I
compared the OMR's output against itself: printed bar numbers it had extracted
as text, and bar durations against its own time signature. **Verification is far
cheaper than transcription**, and that asymmetry is the honest summary of what
this kind of review is worth.

## What is left

**The importer, in rough order of value:**

- **Nothing checks that a bar holds a full bar of music.** The reader
  accumulates durations and trusts them; the OMR file above imported with no
  complaint at all. Pure arithmetic against the metre in force, and it would
  catch a whole class of bad file. The most valuable unbuilt thing here.
- **Tempo marks are not read.** `<sound tempo>` is quarter-notes per minute and
  the app's tempo names the *pulse*, so it wants the v1.30.0 conversion.
- **`<transpose>` is ignored by design and never tested**, because no file
  carrying one has been through it. A real brass band part will have one.
- **The part chooser has not met a real multi-part score.**
- **The long-rest skip is not offered.** The ruling stands — over ten seconds at
  the designated tempo, ask, and come back in at the bar before — and needs a
  screen to ask on.
- **Start from bar N.** Nobody practises a march from bar 1 every time. Bar
  numbers exist now, so this is mostly UI.

**The conductor, carried over untouched from the last handover:**

- The compound lag/lift verdict is still unanswered. "Compound needs nothing" is
  a legitimate answer and should be recorded as one if it is the one.
- `BEAT_IN_FEWER_ABOVE_BPM = 168` and `SUBDIVIDE_BELOW_BPM = 76` are guesses
  awaiting a play-test. One constant each.
- The panel wants a fixed reference scale before the gesture can scale with
  tempo. Measured: the panel refits to 190×88px whatever the geometry does.
- Five, seven, nine and twelve patterns are unbuilt.

**Elsewhere:** variable tempo is still sparse across the grey for free material
and patterns — one interior boundary and the closing rit.

## How this session worked, which is worth repeating

**One real file found six bugs that no synthetic test did.** The player exported
a part from MuseScore and it broke: `<forward>` ignored so two bars came out
empty and six beats short; a demisemiquaver dropped; a metre change never drawn;
unreached bars unreported; a picker filter that hid the file on Android; and a
tied note falling silent when its sample ran out. Every hand-written test in the
suite had passed throughout, because **I only ever wrote the cases I had already
thought of.** Ask for a real file early.

**Mutation testing keeps earning its place, including by disagreeing.** In
v2.1.0 the warning was covered by the first test written; the *behaviour* it
warned about survived every mutation, because nothing exercised it. A passing
test about a thing is not a test of the thing.

**Measure before choosing a constant.** The sample loop in v2.1.1 could have
been guessed. Rendering the sample offline showed a flat sustain with no release
tail — safe to loop anywhere — and rendering the loop two ways showed
period-snapping cutting the discontinuity from 0.028 to 0.009 against 0.007
occurring naturally in the recording. Neither fact was guessable.

**Look at the picture.** Every engraving change this session was rasterised and
looked at before its snapshot was accepted, and the multi-bar rest, the metre
change and the bar numbers were all confirmed by eye rather than by coordinates.

**Say what could not be read, countably.** Every import warning names a number
and a bar — "21 of 42 bars are never reached — bars 17–37" — because a warning
that cannot be checked against the printed part is not worth printing.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint), tag every version on its last commit, and keep pure corrections in
their own release so patch numbers mean something — v1.41.1, v2.0.1, v2.0.2 and
v2.1.1 are this session's examples.
