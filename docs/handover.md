# Handover — the session of 2026-08-10/11

Written for whoever picks this up next, cold. It records what was built,
what was decided and why, and what is left. The durable rulings live in
`v2-design.md`; the feature plans are `tempo-map-plan.md`,
`endless-play-plan.md` and `musicxml-import-plan.md`, all kept up to date as
they were built. **Read this for the shape, those for the reasons.**

The app went from **v1.28.0 to v1.36.0** in this session, all deployed. Nearly
all of it was the conductor.

## What was built, in order

**The conductor's gesture**, which was one loose end at the start and became
the session:

| | |
|---|---|
| v1.29.0 | **Style exposed as a setting** — the legato-to-marcato axis had been threaded as a parameter and hardcoded at 0.55 since it was written. Five named stops: smooth, flowing, lively, crisp, marcato. |
| v1.30.0 | **The tempo means the beat you count.** `compileTempo` gained `crotchetsPerBeat`, so 6/8 at 60 is sixty dotted crotchets and not sixty crotchets. One conversion point, deliberately. |
| v1.31.0 | **A slow six-eight beaten in six**, from the player's diagram. `SUBDIVIDE_BELOW_BPM = 76`. |
| v1.32.0 | **The player's own gesture taken into the app** — see below, this is the important one. |
| v1.32.1 | Panel given more of the row and centred; it was "too small, too hidden in the corner". |
| v1.32.2 | Key changes shown coming in scrolling mode, instead of arriving unannounced. |
| v1.34.0 | **The one pattern** for very fast 2/4, 3/4, 3/8. `BEAT_IN_FEWER_ABOVE_BPM = 168`. |
| v1.35.0 | A fast four halved into the existing two pattern rather than left in four. |
| v1.36.0 | **The pattern changes with the tempo** when a variable-tempo step crosses a threshold. |

**Everything else:**

| | |
|---|---|
| v1.33.0 | **The gated settings screen stopped accepting choices it will not honour.** It displayed the constrained value and stored the real one, so a locked control looked obeyed and was not. |

## The four decisions worth not re-litigating

**Shape and timing are separate mechanisms, and conflating them is the bug
that keeps coming back.** The geometry is a Catmull-Rom spline through the
ictus points; the timing is a phase warp, `t + lag·sin(2πt)/(2π)`. A marcato
gesture is not a differently-shaped curve *or* a differently-timed one — it is
both, moved together. The style axis was invisible for most of a day because
only the timing half was wired.

**The axis has two ends, and everything between them is interpolation.** Five
numbers at each end — width, arcs, downbeat, beats, lag — set by the player on
a bench built for the purpose (`/spike/gesture.html`), read off, and pasted
back. The shipped values are:

```
flowing  width 110%  arcs 32%  downbeat 35%  beats 40%  lag 0.10
marcato  width  58%  arcs 54%  downbeat 65%  beats 69%  lag 0.64
```

They are in `ENDS` in the bench and `FLOWING`/`MARCATO` in
`render/conductor.ts`, and a test holds the two copies together — they drifted
once, and the player found it before the test did.

**Patterns are keyed by `pulsesPerBar`, except where tempo overrides.** A 6/8
is the two pattern because it has two pulses, not because anyone special-cased
6. The two overrides — slow compound subdivides, very fast simple beats in
fewer — are the only places tempo touches the choice, and both are one
constant each.

**The conductor's motion is far smaller than it looks right.** A stand-in
conductor's verdict, and it survived: "his vertical motion goes barely up and
down at all". Every instinct to make the gesture livelier has been wrong.

## What is left

**The conductor, named and worth doing:**

- **The compound lag/lift verdict is still unanswered.** `/spike/conductor.html`
  has both knobs and both sit at zero. "Compound needs nothing" is a
  legitimate answer and should be recorded as one if it is the one.
- **`BEAT_IN_FEWER_ABOVE_BPM = 168` and `SUBDIVIDE_BELOW_BPM = 76` are
  guesses** awaiting a play-test. One constant each.
- **The four pattern's beat 2 has no speed cue between styles 0.15 and 0.75.**
  Asserted in the tests as the sole exception, so it is known rather than
  lurking.
- **The panel wants a fixed reference scale before the gesture can scale with
  tempo.** Measured: the panel refits to 190×88px whatever the geometry does,
  so shrinking the gesture at speed currently shows nothing at all. The
  reference scale comes first; there is no point attempting the second without
  it.
- Five, seven, nine and twelve patterns are unbuilt.

**Elsewhere:**

- **Variable tempo is still sparse across the grey** for free material and
  patterns — one interior boundary and the closing rit. Carried over from the
  last handover, still true. Block boundaries are the obvious candidate, with
  a minimum spacing.
- **My Music is unblocked and is the next feature.** See
  `musicxml-import-plan.md`, which records what was established this session
  and what has not been decided.

## How this session worked, which is worth repeating

**Measurement beats inspection, and it was proven three times.** Mutation
testing found a hole no amount of reading would have — the style axis could be
replaced by a constant and 593 tests still passed. Pixel measurement explained
*why* the axis was invisible when eyes could only report that it was. The
panel measurement killed a feature before it was written.

**A test that duplicates the implementation's arithmetic tests nothing.** One
was written, spotted, and thrown away; the existing suite was parameterised
instead.

**Build the player a bench when the dials are the problem.** Three rounds of
"can you tell the difference now?" got nowhere. A page with every pattern at
every point on the axis, five dials per end and a copyable config block,
settled it in one exchange. The lesson is the copyable config — the answer
came back as data, not as prose to be interpreted.

**Say what the picture is showing.** Twice in this session a preview was built
whose controls did not say which state they described — the second time by
sharing a label with the row above it. Both were found by the player, not by
me.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint), tag every version on its last commit, and keep pure corrections
in their own release so patch numbers mean something — v1.32.1 and v1.32.2 are
this session's examples.
