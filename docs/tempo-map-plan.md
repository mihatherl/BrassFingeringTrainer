# Dynamic tempo — analysis and plan

**Status: agreed.** Written 2026-08-09 after reading the code and
`v2-design.md`; the open decisions were put to the player the same day and
ruled — see *Decisions, as ruled* at the end. Stage 0 began immediately
after.

The ask: rits, fermatas, and tempo changes between themes — the things a band
player actually has to follow — driven by the on-screen conductor, and switched
on from the settings pane near the bpm slider.

## What the analysis found: the beat is less baked in than it looks

The steady beat is *not* structurally load-bearing. The last two versions of
groundwork were spent making sure of exactly that, and it held up under
inspection of every caller:

- **The whole beat↔time relationship lives in three functions** —
  `timeForBeat`, `beatForTime`, `secondsBetween` in `src/engine/clock.ts`.
  Everything else already asks in a form that survives a varying tempo:
  the session schedules synth notes and metronome clicks through
  `timeForBeat`; the judge takes a note's length in *seconds*
  (`toleranceFor`); hints take a `secondsBetween` function; nothing outside
  the clock ever multiplies by a rate.
- **The renderers follow for free.** Scrolling mode positions music linearly in
  *beats* and reads `visualBeat()` each frame, so when beats arrive slower the
  page physically slows — which is the agreed behaviour (spacing fixed, motion
  varies; `scrollSpeed` is pixels per second *at the nominal tempo*, and
  `nominalSecondsPerBeat` has exactly one caller, the scroll layout). Paged
  mode was decoupled from tempo entirely.
- **The conductor follows for free**, almost. Hand position is a pure function
  of `visualBeat()`, so a rit slows the gesture including the acceleration
  into each ictus — the spike already proved a rit can be followed this way.
  The one place this breaks is the fermata; see below.
- **The maths is already derived.** `v2-design.md` (*The tempo map*) has the
  closed forms for linear-in-beat bpm spans, both directions, no numerical
  integration, with the three rules: total over negative beats (the count-in
  lives there), anchored so change only affects the future, nominal stays a
  scalar.

What is genuinely missing, and is therefore the actual work:

| | |
|---|---|
| A tempo data model | Nothing carries tempo events. `Exercise` has `keys` and `metre` but no tempo; the `Theme` format has no tempo field (the design table lists "relative tempo change — carried, inert", but it was never added). |
| Theme boundaries | `stitchThemes` returns which themes were used but not where each one starts, and "a change between themes" needs the beat of every join. |
| The map itself | `Transport` holds a scalar and anchors `originTime` by multiplication. |
| Fermata | No glyph (Bravura `fermataAbove` U+E4C0 is not in `glyphs.ts`), no hold concept anywhere. |
| Printed marks | A tempo change with nothing printed is the page lying about the music, which is the one thing this project's notation is not allowed to do. "rit.", "a tempo", a metronome mark, and the fermata all need engraving. |
| The setting | Nothing in `Settings`, the Playback panel, `sanitise`, or the summary line. |
| A plan generator | Something has to decide *where* the tempo moves and by how much, seeded so Repeat repeats it. |

## The model

### A `TempoMap`, shaped like `metre.ts` and `keys.ts`

"What tempo is in force at beat b" is the same question a part asks of its key
and its metre, so the model goes in `src/domain/tempo.ts` and follows the same
pattern: plain data describing changes, plus the arithmetic that answers
questions about it. The `Transport` consumes a map; it does not define one.

Proposed event vocabulary (three kinds, and the first release only needs two):

```ts
type TempoEvent =
  | { kind: 'tempo'; atBeat: number; bpm: number }                    // step change
  | { kind: 'ramp';  fromBeat: number; toBeat: number; toBpm: number } // rit./accel., linear in beats
  | { kind: 'hold';  atBeat: number; seconds: number };               // fermata dwell — see below
```

The map compiles these once into segments with cumulative times at each
boundary, then answers `secondsFromStart(beat)` and `beatAtSeconds(s)` by
segment lookup plus the closed form inside one segment:

```
bpm(b) = m·b + c
t(b)   = t₀ + (60/m)·ln((m·b + c) / (m·b₀ + c))     — and 60/c·(b−b₀) when m = 0
b(t)   = ((m·b₀ + c)·e^(m(t−t₀)/60) − c) / m
```

Rules the map must satisfy, all from `v2-design.md`:

- **Total over negative beats**: the first segment's bpm extends flat to −∞, so
  the count-in runs at the opening tempo — which is also what a real
  count-in does. Symmetrically, flat beyond the last event.
- **Anchored once**: the transport's `originTime` is set at `start()` and the
  map is immutable for the run. `setTempo` keeps its throw-while-running rule
  (it currently has no callers outside tests — worth confirming and possibly
  retiring during stage 0).
- **`nominalSecondsPerBeat` survives as a scalar** quoted at the settings bpm,
  still used only by the scroll layout.

A dwell (`hold`) is a segment where the beat stands still for a fixed number of
seconds: `secondsFromStart` steps up by `seconds` at that beat, and
`beatAtSeconds` returns the held beat throughout the plateau. The map stays
total and monotone in both directions; it merely stops being *strictly*
monotone, and no caller requires that — `Transport.tick`'s horizon plateaus at
the hold and scheduling pauses by itself, which is precisely the behaviour the
fermata needs.

`secondsBetween(a, c) = secondsBetween(a, b) + secondsBetween(b, c)` must hold
to float precision across every kind of boundary; that additivity, the
round-trip identity `beatAtSeconds(secondsFromStart(b)) = b` (away from
dwells), and continuity as a ramp's slope approaches zero are the property
tests worth writing before anything is wired in.

### Where the data lives

`Exercise` grows `tempo: TempoEvent[]` beside `keys` — same shape of addition,
settled at generation time. (The "do not let `Exercise` grow" ruling in
`v2-design.md` is about growth *during play*, not about new fields; the list
is fixed before the transport starts, so the rolling horizon gains no second
moving part.)

The fermata **glyph is derived, not stored**: a `hold` whose beat equals a
note's end beat puts the mark over that note. One source of truth, so the
drawing and the timing cannot drift — the same argument that put the SVG
renderer behind both the tool and the snapshot test. An empty `tempo` list is
today's behaviour and costs nothing, exactly as a one-entry key list does.

Events are stored **absolute** (bpm, beats) on the exercise, but *generated*
relative to the settings bpm (factors), so the player's chosen tempo remains
the reference everything is quoted against. Clamped inside `TEMPO_RANGE` so a
map can never ask for a tempo the settings themselves would refuse.

## The fermata ruling — the recommendation that departs from the doc

`v2-design.md` says a fermata "needs the tempo map *and* a change to the
transport's contract", because nothing can be scheduled past a hold of unknown
length. That reasoning is right **only when the release comes from outside** —
a human conductor, or the microphone hearing you stop. Neither exists yet.

**With the on-screen conductor, the app is the conductor — so the app knows
the length of its own hold.** It chooses each hold's duration when the exercise
is built (seeded, so Repeat repeats it, and the player still cannot predict it
within a run — which is the skill). A known hold is just a dwell segment in
the map: scheduling pauses at the horizon's plateau and resumes, the note under
the fermata sounds longer because `secondsBetween` says so, the next onset
moves later, judging windows follow. No contract change, no second moving part
in the horizon.

The transport-contract change (stop the horizon, resume on an external
release) is deferred to the microphone era, where it genuinely cannot be known
in advance. The doc's warning stays true; it just is not this feature's
problem yet.

Two consequences to carry into implementation:

- **The synth detach factor needs care.** A note's sounding length is
  `secondsBetween × 0.92`; with a three-second dwell inside it, 8% becomes a
  large articulation gap. Detach should subtract a short fixed gap (or apply
  0.92 to the written part only) rather than scale the whole held length.
- **Recorded samples do not loop.** A held note may outlast its FluidR3
  recording and decay early. Tolerable for a first release; loop points are a
  refinement, and the synth fallback sustains indefinitely.

## The baton under a moving tempo — what stays fixed, what becomes dynamic

The question was asked directly: the pattern runs on fixed points with one
fixed liveliness — does dynamic tempo mean the motion itself must become
dynamic?

**The geometry stays fixed, and that is load-bearing, not laziness.** Hand
position is a pure function of beat and style; tempo enters only through how
fast the beat advances. That is the property that lets the conductor
free-ride on the tempo map with no timing logic of its own, and it is not a
guess that it reads: the original spike was played against an Eb bass and "a
rit. can be followed by dragging the tempo" — fixed points, fixed rebounds,
tempo dragged underneath. Within one style, a real stick slowing uniformly
is what a rit looks like. Nothing about steps or ramps changes the pattern,
the rebounds, or the warp.

What does change, each with its trigger:

- **Style stops being a constant and becomes a threaded parameter now, a
  setting later.** `STYLE = 0.55` is hardcoded in `ConductorPanel`, and the
  design doc already rules it a difficulty axis — a smooth conductor is
  genuinely harder to read, and learning to read both legato and marcato is
  the point. The tempo work forces the plumbing anyway: the meld, the lift,
  the drop and the orb's build are all style-flavoured gestures, so the new
  code takes style as an argument from day one rather than baking in new
  constants beside the old one. Exposing the setting itself stays stage 4;
  the doc's floor warning stands (below some smoothness a gesture carries
  nothing, and the slider must not go there).
- **Two scoped windows where position stops being a function of beat.** The
  fermata takeover is one, built in stage 3. The pulse before a step change
  may be the other: a real conductor's upbeat before a new tempo is already
  *in* the new tempo — that is the prep doing its job — whereas a
  map-following hand changes speed exactly at the bar line, giving the
  player no warning beyond the printed mark. Stage 1 ships the honest
  map-following hand plus the printed metronome mark, and whether that is
  catchable is decided by playing; if it is not, the named remedy is a
  prep-window takeover on the final pulse before the step — the same
  machinery the fermata builds anyway, reused smaller.
- **Size is the one geometry–tempo coupling the book prescribes, held in
  reserve.** Mann's Size rule: "louder dynamics and/or slower tempos can
  take up more space." A gesture slowed to 0.6× has 0.6× the tip speed, and
  the flick — the measured quantity that makes the ictus readable — scales
  down with it. If the spike shows the flick falling below readability at
  the rit floor, the remedy is a draw-scale multiplier tracking local
  seconds-per-pulse (slower beat, larger gesture), applied where the panel
  already scales the pattern to its box — not surgery on the pattern
  geometry. If the flick stays readable, fixed size ships.
- **A new confusable, and the orb is its disambiguator.** With the style
  warp, the tip already lingers near apexes; slow the whole gesture through
  a deep rit and the between-beat hang starts to resemble a hold. The two
  must never be mistaken — one resumes on its own, one waits for a release —
  and the orb is what separates them: cooling blue through the rit, building
  violet through the hold. That quietly promotes the orb from expressive
  polish to a structural part of the vocabulary, which is worth knowing when
  deciding when it debuts.

The trail needs nothing: it is fixed in *time*, documented as a speed
readout, so it shortens through a rit and lengthens through an accel —
which is it telling the truth.

## The conductor at a hold — the one real unknown, so it gets a spike

Everywhere else the conductor needs nothing: position is a function of beat,
and beats slow through a rit. At a dwell the beat freezes, and a hand that is
a pure function of beat freezes with it — indistinguishable from a hung app,
and carrying no information about *when* the release is coming, which is the
entire skill. The **release** is motion driven by *time during a frozen
beat*, the one thing a pure function of beat cannot draw.

So during a dwell the conductor takes over from the beat: a time-driven hold
mode, fed by a small transport API (dwell progress). **The takeover begins at
the held note's own ictus, not at the dwell.** Robertson's *Fermate* chapter
(now in `input/conducting` with the rest of the book): "the conducting
pattern should stop only after all the rhythmic activity in the score stops"
— and for a solo part that is the fermata note's onset. So the hand beats the
held note's ictus, suppresses the rebound, and stops beating time there,
even though the map's beats keep passing under the note's written duration;
the takeover window is the note's start through the dwell's end, wider than
the dwell segment itself. This also dissolves a wrinkle the first draft of
this plan worked around: the dwell sits at the note's end beat, usually a
bar line, and a naive freeze would have parked the tip at the bottom of the
next downbeat's ictus — in the corrected design the hand never goes there at
all.

Through the hold the hand performs what the book names a **meld** — "a pause
in time-keeping to illustrate a held note … characterized by a hand that
slowly moves from the moment of pause to the next moment of time keeping" —
and Robertson adds the direction: the sustain movement "should anticipate
the needed movement of the subsequent cutoff or prep". So the drift is not
decoration; it is the slow travel from the held ictus to the point the
release will drop from, directly above the re-entry beat's landing.

### The orb: intent as light, on its own channel

Proposed by the player this app is for, and it fits: a real conductor's hold
is full of body language — gathering tension before a big release, visible
calm when taking energy out — and none of it is renderable as anatomy. The
proposal is a glow at the baton tip that carries that channel: **throbbing
violet-red as a hold builds toward its release; cooling toward blue through a
rit as energy comes out; nothing at all at a steady tempo.**

The precedent is the trail. No real baton leaves one, but it shipped because
it is an invented graphic that visualises a true quantity — the doc calls it
a speed readout. That is the line this project has already drawn: invented
visuals are honest when they encode something real, dishonest when they
fabricate a gesture no conductor makes. The orb stays on the right side of it
by being driven only by quantities the map actually holds.

The book gives it a slot of its own. Mann's expressivity chapter frames
every gestural decision as **SPIRIT** — Size, Plane dominance, Ictus shape,
Rebound speed, Image, Tension. Five of the six are kinetic and live in the
drawn gesture (rebound speed is essentially the existing legato–marcato
style axis). The sixth, **Image**, is "the ways we communicate non-verbally,
outside of the traditional pattern" — face and posture — and a canvas
conductor has neither. The orb is the app's Image channel: the one element
of the framework that had nowhere to live until now.

| State | Orb | Driven by |
|---|---|---|
| Steady tempo | None — today's plain dot | Nothing to say. An installed app should not sprout a throbbing light because it updated; same ruling that made the conductor off by default. |
| Rit / accel | Hue cools toward blue / warms, returning to neutral at *a tempo* | Ratio of local bpm to nominal, straight off the map |
| Hold | Throb and intensity build, eased so most of the change lands just before the release, then discharge on the release ictus | Dwell progress from the transport |

Three constraints, from perception and from the app's existing vocabulary:

- **The throb carries the signal; colour only flavours it.** The player is
  watching the stave with the conductor in peripheral vision, which is nearly
  blind to hue and sharp on flicker and luminance. Pulse-primary also makes
  the orb work for colour-blind players with no separate mode.
- **Stay off the verdict palette.** Green and red already mean correct and
  wrong. The hot end lives in violet/magenta, the calm end in blue rather
  than green, so the two vocabularies can never collide on screen.
- **Pulse at breath-and-heartbeat rates**, small in area — comfortable, and
  nowhere near photosensitivity territory. Glows read differently on the
  light theme (halos need a darker core on white); both themes get checked in
  the spike, not assumed.

### The release gesture, as ruled and as the text confirms

The player's ruling: the baton does not come straight down out of the hold.
It **lifts a tiny bit first** — the breath — and then drops to the line the
ictuses land on (the pattern's floor; "the contact line"). That is the
preparatory beat from the anatomy the conductor is already built on: Mann's
chapter defines every beat as ictus, rebound and prep, and the doc records
that "the prep is essentially the rebound of the prior beat". A hold has no
prior beat in motion, so the release must manufacture its prep — the lift is
it. Fonza's chapter confirms the two rules the plan leant on: "the prep
gesture typically comes the beat … before the entrance", and — load-bearing —
**"the prep must be in tempo to ensure unity from the ensemble."**

The rules, now with the book behind them:

- **The prep lasts one pulse of the *resumed* tempo** for a re-entry on a
  strong beat — which theme joins always are, since themes start on bar
  lines. **When the tempo changes at the fermata, the prep takes two**:
  Robertson, "unless there is a change in tempo after the fermata. In that
  case, an additional beat to establish the new tempo is advisable." So a
  plain fermata releases with one lift-and-drop, and a fermata that doubles
  as a tempo change beats one silent pulse first — the gesture says *now*
  and *this fast*, and gets a whole beat to say it in when *this fast* is
  news. (Partial-beat re-entries take a "gesture of syncopation" in the
  text; nothing in the app can produce one, and nothing should until
  imported music does.)
- **The drop reuses the pattern's signature stroke.** "The final rebound must
  return to the starting point of the downbeat" is already in the geometry as
  apex-directly-above-landing — the meld drifts to directly above the
  re-entry beat's floor position, the release drops vertically onto it, and
  beat-driven motion resumes from that exact point with no seam.
- **The lift must stay a prep, not a beat** — small enough not to read as an
  ictus of its own, large enough to clear the information floor the doc
  already warns about for vague gestures. Its height is a spike slider with a
  number beside it.

### The dwell decomposes, and the sound question answers itself

Robertson's three kinds of pause after a fermata name the scope: **short
pause** (the lift, *Luftpause*) is what gets built; long pause
(*Generalpause*) and the continuing fermata (no pause, gesture accelerating
straight into the prep with the sound unbroken) are named and deferred. And
the short pause "consist[s] of nothing more than the time needed for the
prep" — which decomposes the dwell exactly:

```
dwell of D seconds = sustain (D − prep) + prep (1 or 2 resumed pulses)
```

That also settles, from the text rather than from taste, where the held
note's sound ends: **the lift takes the sound off.** The synth's held note
sounds through the sustain and stops when the prep begins — which replaces
the earlier implementation worry about the 0.92 detach factor with a rule: a
fermata note's sounding length is its written length plus (D − prep), and
the prep is silence with the band breathing.

One consequence of the dwell convention, worked out in stage 0 and worth
stating before stage 3 meets it. The dwell sits between the beats: a beat on
the far side of it gets its time *after* the hold, so scheduling and judging
are automatically right — the re-entry note sounds, and is judged, at the
release. The inverse plateaus at the boundary beat, which means **the
scrolling display holds the re-entry note poised on the strike line for the
length of the hold**. That is not the display lying — the music genuinely
stands at the re-entry, suspended — but it does mean the strike line stops
being the thing that says *when* during a hold. That is what a fermata *is*:
nothing on the page tells you; the conductor does. The judge agrees (its
window opens at release, not at arrival on the line), so display and
judgement cannot disagree; the stage 3 copy should say plainly that a held
note waits on the line until the conductor releases it.

### What the spike must answer

The doubtful question, the way "can a rit be followed" was the conductor's:
**can a player come in together off the drawn release?** A swelling glow says
*soon*; the lift-and-drop says *now* — and *this fast* — with the orb
discharging on the ictus. The spike tests the combination in
`public/spike/conductor.html` with sliders for the meld's path, the lift
height, the build curve and the palette — the prep's *timing* is not a
slider, it is the one-or-two-pulse rule above — and reports the figure
beside it in the established tradition: randomised hold lengths, re-entries
played on a real instrument, **the spread of re-entry timing in
milliseconds** printed on the page. If re-entries land tight, the gesture
works; if not, fermatas stay drawn-but-unscheduled (a hold of zero) until it
does, and stages 0–2 lose nothing.

**The source material is saved.** The rest of *Music in Motion* is now in
`input/conducting` beside the beat-patterns chapter: *Preps, Cues, and
Releases* (Fonza), *Fermate* (Robertson), *Expressivity in Gesture* (Mann),
*The Baton*, and *Compound Meter Beat Patterns* — the rulings above cite
them. Two notes from the compound chapter for later, neither needed now: it
confirms pattern-by-pulse outright ("fast" 6/8 is the two-pattern), and it
*draws the subdivided "slow" patterns* — so if deep rits in compound time
ever want the subdivision a real conductor would switch to below roughly
Andante, the taught shapes exist in the reference and the no-invented-
patterns rule no longer forbids them.

The metronome through a hold falls out correctly with no work: no beats pass,
so no clicks sound, and the next click lands on the re-entry. But a
metronome-only player gets silence of unknown length and then a click —
unfollowable. Fermatas therefore want the conductor on, and the settings
screen already has the pattern for saying so (the paged-mode warning when
nothing keeps time).

## What gets printed

The notation must not lie, so every tempo event is visible on the page, drawn
by the shared renderer so the snapshots pin it:

- **Step change**: a metronome mark over the bar line it lands on (`♩ = 96`).
  The double-bar treatment key changes get is not needed; a tempo mark alone
  is how real parts do it.
- **Ramp**: `rit.` (or `accel.`) at the start beat. A dashed extender to the
  end is engraving polish, not first-release material. `a tempo` where a ramp
  resolves back.
- **Fermata**: the Bravura glyph over the derived note, added to `glyphs.ts`.

Text sits above the stave the way fingering hints already do, so there is
precedent for both the drawing and the room it takes. All metres on offer are
simple, so the mark quotes a crotchet; compound time would want the pulse
quoted instead, which can wait for compound time itself.

## The setting

One checkbox in the Playback panel, directly under the tempo slider it
qualifies, off by default (the conductor's own precedent: an installed app
does not change behaviour because it updated):

> **Variable tempo** — rits, holds, and changes of speed
>
> *The tempo you set is where the music starts. Themes change speed at their
> joins, ends broaden, and a fermata holds until the conductor releases it —
> watch the stick or listen for the click coming back.*

`Settings.variableTempo: boolean`, defaulted and coerced in `sanitise`, shown
in the panel's summary line ("80 bpm · variable"). A stored settings file from
an older version merges to `false` and nothing changes for anyone.

Where it applies (recommendation): **wherever the material has a boundary.**
Themes get the full treatment — steps at joins, a rit into the last bars,
a fermata on the final note, occasionally elsewhere. Every other kind gets a
closing rit and optional final fermata, because broadening the last two bars
of a scale is something every band player has done every week of their life,
and it keeps the setting honest globally rather than silently theme-only.

Whether variable tempo is free or gated is a commercial decision — the
entitlements seam takes one boolean either way, and `constrainToEntitlements`
is where it lands. Flagged as open; nothing in the build order depends on it.

## The plan generator

`src/exercise/tempo-plan.ts`: takes the assembled structure (theme-join beats,
total beats, metre, difficulty), the base bpm, and the exercise's own seeded
rng; returns `TempoEvent[]`. Themes' joins come from `stitchThemes`, which
starts returning each theme's opening beat alongside `used` (a two-line
change).

Guardrails rather than taste, all tunable by playing:

- Steps within roughly ±25% of base, and always inside `TEMPO_RANGE`.
- A rit reaches somewhere near 0.6–0.75× over one to two bars.
- Holds run 1.5–3 seconds, chosen per fermata.
- No event before beat 0 or on it — the count-in and the opening are the
  settings bpm by definition — and at most one event per join, so the map
  stays sparse and legible.

Deterministic per seed, so Repeat practises the same interpretation and the
snapshots and tests hold still.

## What every consumer does under the map

The point of the table is how short the right-hand column is.

| Consumer | Change |
|---|---|
| `Session` scheduling (synth, metronome) | Nothing — already asks `timeForBeat`/`secondsBetween`. Clicks spread through a rit and pause through a hold by construction. |
| Judging (`toleranceFor`, windows) | Nothing — seconds in, seconds out. Windows breathe with the music, which is the honest reading of a rit. Possibly widen the first window after a hold; decide by playing. |
| Hints | Nothing — already handed `secondsBetween`, and the comment in `hints.ts` anticipated exactly this. |
| Scrolling display | Nothing — linear in beat, reads `visualBeat()`; slows physically. `scrollSpeed × nominalSecondsPerBeat` deliberately unchanged. |
| Paged display | Nothing — decoupled from tempo by design. |
| Conductor | Nothing for steps and ramps — see *The baton under a moving tempo*. Hold/release is stage 3's spiked gesture plus a small transport API for dwell progress; style becomes a threaded parameter. |
| Engraving | New: marks and the fermata glyph, in the shared renderer, pinned by new snapshot figures. |
| Settings/storage | New checkbox, `sanitise`, summary line, possibly an entitlement. |

The one place judging deserves a second look is not the map at all: in
scrolling mode the strike line does the rit *for* the player (the display
slows, notes still arrive exactly on time at the line). The skill this feature
teaches lives in paged mode with the conductor — worth a sentence of honest UI
copy, not a gate.

## Stages — each shippable, each tagged

The order the last stretch proved out: model first with no behaviour change,
then the feature in visible slices. `timeForBeat` is the highest-risk code in
the project (a bug desynchronises sound from notation), so every stage ends
green, versioned, tagged, and checked by eye with `npm run svg` and
`npm run shots`.

**Stage 0 — the map, invisibly. Built.** `domain/tempo.ts` with compile,
both directions, and the property tests (round-trip, additivity, m→0
continuity, negative beats, dwell plateaus, the rit-into-fermata-into-new-
tempo ordering). `Transport` takes optional events and routes its three
functions through the map; with none it is arithmetically the transport it
was, and the pre-existing clock tests passed unmodified. `setTempo` was
retired rather than adapted: it had no callers, and its invariant — no
change while running — is now true by construction, the map being compiled
once and immutable. 507 tests, build and lint green.

**Stage 1 — step changes between themes.** The setting, `Exercise.tempo`,
theme-join beats out of `stitchThemes`, the plan generator emitting steps
only, the printed metronome mark, session tests for click and onset times
across a step. Ship; the feature exists.

**Stage 2 — rits.** Ramp segments (the closed forms), `rit.`/`a tempo`
marks, closing rit for every material kind, snapshot figures for the marks.
Optionally the orb's calm half debuts here — cooling through a rit, where it
is redundant with the slowing gesture — so the vocabulary is learned in a
low-stakes place before the hold makes it the only signal. Ship.

**Stage 3 — fermata.** Spike first, against an instrument: the hold pose,
the orb's build and discharge, the release gesture, judged by the re-entry
spread. Then: `hold` events from the plan, the derived glyph, the conductor's
hold mode and release, the detach fix for held notes, the settings warning
when nothing can release you. Ship.

**Stage 4 — later, separately.** Authored tempo character in the theme corpus
(the format finally growing the "carried, inert" field, now that the engine
honours it); the style *setting*, and eventually the style *map* — imported
music carrying legato/marcato sections so the baton tells the piece's story,
per the scope ruling; the microphone-era transport contract change; loop
points for held samples.

## Risks, and what holds them

- **Desync is the fault that cannot happen.** Closed forms (no accumulated
  drift), stage 0's identity regression, property tests over the map, and the
  audio/visual clocks continuing to read the *same* map — they cannot
  disagree with each other, only both be wrong, which the round-trip tests
  guard.
- **Bisectability.** Every stage tagged on its last commit with the version in
  `package.json`, per the convention — named points for `git bisect` if a
  timing fault ever surfaces later.
- **The gesture might not work.** That risk is quarantined in the stage 3
  spike, with stages 0–2 whole without it.
- **Float discipline.** Map boundaries land on bar lines and note ends, which
  triplets make non-dyadic; boundary comparisons use the same epsilon
  conventions as `snapBeat` and the validator, and the additivity test runs
  over triplet-bearing exercises specifically.

## Decisions, as ruled

Put to the player and ruled on 2026-08-09.

1. **Fermata mechanics: the dwell.** App-chosen hold lengths, seeded, in the
   map. The transport-contract change waits for the microphone, the first
   customer that genuinely cannot know a release in advance.
2. **Scope: everywhere the material has a boundary.** Themes get steps,
   rits and fermatas; every other kind gets a closing rit and optional final
   fermata. The ruling came with a rider worth keeping: imported MusicXML
   will one day bring pieces with their own markings, and the app will have
   to decide how to *conduct* them — including legato/marcato sections,
   where "the conductor's baton will be telling a story". That is a **style
   map beside the tempo map**, and it is why style threads as a per-call
   parameter now (see *The baton under a moving tempo*): a style-at-beat
   source slots into `tipAt` without rework when imported music arrives.
3. **Free for now.** Built ungated; the entitlement question is answered
   when the selling work happens, and adding the boolean then is trivial.
4. **When the orb debuts: stage 2, with rits** — vocabulary learned where it
   is redundant, and in place before deep rits and holds need disambiguating.

Still open, deliberately:

- **Naming and copy**: "Variable tempo" is a placeholder; the project names
  things in players' terms, and the player of record has the better ear.
- **The numbers**: step range, rit depth, hold lengths — starting points
  proposed above, settled by playing, which is how every figure like them
  has been settled so far.
