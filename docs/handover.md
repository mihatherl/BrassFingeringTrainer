# Handover — the session of 2026-08-16

Written for whoever picks this up next, cold. It records what was built, what
was decided and why, and — carried over again because it keeps earning its
place — **where I was wrong**, since this session's faults were of a new kind
and worth recognising on sight.

The durable rulings live in `v2-design.md`; the feature plans are
`tempo-map-plan.md`, `endless-play-plan.md`, `musicxml-import-plan.md` and,
new this session, `tunes-plan.md`. **Read this for the shape, those for the
reasons.**

The app went from **v2.15.5 to v2.23.3** — seventeen releases, all deployed.
It finished the settings work the last handover left half done, then spent
the rest of the session on the two things the player's ear kept returning to:
what the reference tone does, and whether the themes were as hard as they
said. Every one of the seventeen was asked for by the player at the phone,
usually within the hour of the release before it.

## What was built, in order

**The settings screen, steps 3 to 5 of five** — item 11 of the plan, done:

| | |
|---|---|
| v2.16.0 | **Drills.** Scales and Arpeggios are one box with a picker; the four arpeggios the box once promised are real; the blurb's full sentence is back and a guard refuses to compile when a drill is added without a claim. One kind, `drills`, with `drillId`; a stored `scales`/`arpeggios` migrates. |
| v2.18.0 | **Named minor scales.** Harmonic and melodic minor in the picker, chosen the way a book prints them: the key chips relabel to the minors — *Dm*, *C minor* — over the same signature. **The work was the spelling**: each drill note carries its letter step and `spellWithLetter` alters that letter, so D harmonic minor's seventh is C♯, not the D♭ one flat would choose. The one limit is the app's own rule: no double accidentals, so G♯/D♯/A♯ minor write the natural above, and the screen says so. |
| v2.19.0 | **A key and a difficulty per material.** `keySet`/`fifths`/`difficultyId` stay the pair *in force*; `materials` holds the rest, put away on leaving a material and taken out on return. Old files start with nothing remembered so their one pair still carries over. |

**Sound and timing**, which took most of the session:

| | |
|---|---|
| v2.16.1 | Tuba samples started early by their measured bloom, to land half level on the beat. **Withdrawn in v2.18.1** — see *Where I was wrong*. |
| v2.17.0 | **The headphones screen.** A per-device audio *lead*: every sound handed to the audio thread early so it is heard when the clock says. `Transport.audioLead`, one place. Calibrated by tapping along — a click a second, the median offset of the taps is the lead, measured again it converges. Outputs are a named list; the phone speaker is "none of these". |
| v2.20.1 | The output in use said beside Start, with a one-tap way back to the speaker — because the choice cannot follow the device. |
| v2.21.0 | **An open note asks for evidence, and the tone follows the fingers.** An open note counts only from a player who had a valve down within the two notes before; a run played by nobody scores at most its first note instead of a quarter. The reference tone halves whenever the fingers do not answer the note sounding. |
| v2.22.0–v2.23.0 | **The cushion.** Trialled behind `?voice=pad`, then adopted: a soft pad until the fingers are right, the recorded instrument once they are, both given every note and two gains deciding which is heard. The pad is a pad (no sweep, nothing that twangs); coming right mid-note re-attacks the instrument; its level is a setting in Advanced, half by default. `?voice=plain` is the way back to the instrument alone. |
| v2.23.1 | Response measured offline at 70–190ms to full level and brought to 15–20ms: a re-attack joins the recording where it has already *spoken*; the session answers the valves on the change, not the next tick. |
| v2.23.4 | **Three corrections to the above**, found on 2026-08-18 while checking a "no audio" report that turned out to be the phone's silent switch. The stall check watched whatever `getAudioContext()` handed back rather than the run's own context; `markStuck` could condemn a context that had already replaced the dead one; and the gate started runs whose final `ensureRunning` had failed. See *When the app has no sound* in `v2-design.md`, which also records why a YouTube video plays while the app does not. |
| v2.23.2 | **A dead AudioContext is replaced.** After the phone has been away, iOS leaves one reporting `running` over a clock that never moves; *Try again* used to ask it to resume, and only a refresh helped. `ensureRunning` watches the clock before trusting a context; a stuck one is closed and a fresh one made inside the tap; the voice is reloaded for it; the sample cache is per context. |

**Themes**, rebuilt:

| | |
|---|---|
| v2.19.1 | Beginner sight-reading was writing D♭s it was not allowed — the one reachable step at the edge of the range band was chromatic and the walk took it. Found while measuring themes; fixed on its own. |
| v2.20.0 | **Themes composed from cells.** The hand-written corpus measured a level or two easy at every level; the player chose a composer over hundreds more tunes by hand. 140 one-bar cells across four metres, assembled into two four-bar phrases with joins, closes and reach chosen by level, then inflected with accidentals and breaths at the level's chance. Calibrated by the same measurement, held as a test. Sight-reading stays, on the player's ruling. See `tunes-plan.md`. |

And two small screen things: the drill list and the keys window are boxed with a thin scrollbar (v2.23.3); the Themes blurb says what it now is.

## The decisions worth not re-litigating

**The clock is the truth and the sound moves.** Every sound is sent early by
the output's lead; notation and judging read the clock as before. The other
way round would touch every reader of the clock to fix one writer of sound.
And a *reactive* sound — the instrument arriving when the fingers land —
cannot be brought forward across a headset's lead at all; that is physics,
and the cushion is at its best on the speaker.

**An open note asks for evidence.** The player's rule, stated as such: some
fingering on at least one of the two notes before. The first note of a run
gets the benefit of the doubt. The stated cost — four opens running from an
honest player will see the fourth marked missed — is the player's to loosen
if it ever bites; generated material rarely writes it, an imported bugle call
would.

**A change of sound, not of volume.** The half-volume rule lasted a day; the
cushion replaced it and the halving survives only on the synth-only fallback.
A voice that follows is told rather than halved: the change of sound is the
whole of the signal.

**Themes are composed; Sight-reading stays.** A composer over a corpus,
because the corpus was mis-calibrated and hand-writing hundreds of tunes to
calibrate them is not a session's work — and the walk held inside a stated
interval trains something a tune does not.

**An altered theme degree is spelled on its own letter**, in `realiseTheme`,
or a raised sixth in a flat key comes out as D♭ before D♮. The same lesson
the minor scales taught, met a second time.

**A minor drill's key is a label on the same control**, not a second setting;
that is what let step 5 be built once.

**A dead context is replaced, not resumed.** `getAudioContext` hands out a
fresh one when the last is marked stuck; nothing else in the app has to know.

## Where I was wrong

Not arithmetic and not method this time. **Twice I took a player's report,
found a real cause, and fixed the wrong one** — because a second cause was
sitting under it.

**I removed the sample fix on the strength of the wrong culprit.** The tuba
recordings genuinely bloom for up to a fifth of a second and v2.16.1 started
them early to land on the beat; the player then reported the speaker "on the
money". After the headphones screen, the player reported the tuba speaking
early on the speaker, and I took the sample fix out (v2.18.1). It was almost
certainly the *chosen output* — a headset left selected after moving back to
the speaker sends every note early — and the report came again unchanged
after the removal. What I should have done: read the three reports in
sequence before touching anything, and ask what changed between the second
and third. The sample fix is still out; the player has not asked for it back.
**When a symptom survives the fix, the fix was for something else.**

**I built the "test environment" as a URL flag and then read a follow-up ask
as adoption.** The player asked for a setting for the cushion's volume; I made
the cushion the default and said so plainly, with the flag as the way back.
That was probably right and I stated the judgement, but it was a judgement
about what the player wanted, made silently until the reply. Say it before
building, not after.

**A build failure went out because a shell chain let it through.** `npm run
build | grep error` succeeds when grep matches. One commit and one failed
deploy, corrected in minutes, the tag moved. **Never gate a commit on a pipe
whose last command is grep.**

**And an honest measurement, misused once**: I measured what a walk of sixteen
bars *reaches* and held tunes of eight bars near it, then reported the tunes
"3–4 semitones short" as if that were a fault. It is partly the length. The
plan says so now.

## What is left for version 2

Nothing on this list blocks version 3, and the player should say which of
these are worth doing before it. In the order I would take them:

- **The theme composer, stages 2 and 3** (`tunes-plan.md`). Accidentals at
  Medium and Hard sit at about six tenths of the walk's rate — the ceiling is
  how many notes of a tune are neighbours, passing notes or repeats, since
  every eligible one is already inflected — and range runs a little under a
  walk twice the length. Both are corpus work: cells with more
  chromatic-friendly shapes, and wider ones; sequences by more than a step,
  inversion, the consequent answering the antecedent's rhythm; ties at the
  level's chance. **The player has not yet said what their ear makes of the
  shape** — that is the input stage 2 wants, and it should be asked for
  before writing more cells.
- **The scrollbar on iOS.** The keys and drills windows are boxed with a thin
  bar styled in; whether iOS renders it persistently is unconfirmed. If not,
  draw one.
- **The settings screen on a short phone.** Playing is 70 points over on
  360×740; the one measurement still failing, and untouched this session.
- **The key-change collision on the scrolling line**, pre-existing, some joins
  only; wants measured glyph extents on a fixed seed.
- **Leaps per instrument, not just per difficulty** — now also the joins in
  the composer, which are a step count per level.
- **`FREE_TIER.playbackMode`** is declared and never read; and the free-tier
  screen has never been shown to a second player.
- **The sample fix** (v2.16.1), if the player's ear wants it back once the
  output selection is right on the speaker.
- **The conductor's** compound verdict, its two guessed thresholds, and the
  five/seven/nine/twelve patterns — unchanged, unplayed.
- **The importer's** four items — tempo marks, `<transpose>`, a real
  multi-part score, the long-rest skip — unchanged.

Refactorings I would want before a new mode is built on top of this:

- **`Session` has grown.** It now carries scheduling, judging, the offer, the
  key splice, the tone's level and the fingers' say over it. `followFingers`,
  `applyVolume` and the engagement look-back would sit better in a small
  *Monitor* of their own that the session drives; the microphone mode will
  want to replace the *input* and keep everything else, and the seam should
  be there before it is needed.
  **The input half was done on 2026-08-18** — `PlayerInput` in
  `src/engine/player-input.ts`, the session taking one rather than making one,
  and the buttons' rules moved behind it; see *How it plugs in* in
  `v2-design.md`. The *Monitor* half is still open, and is now the smaller of
  the two: `followFingers` reads the input through the seam like everything
  else, so moving it is tidying rather than untangling.
- **`SettingsScreen.tsx` is over nine hundred lines.** The material box, the
  keys window and the Advanced panel would each stand alone.
- **`generate.ts` is over sixteen hundred**, most of it the walk. The drills
  (`DRILLS`, `patternContour`, `spellDrillNote`) are a file of their own
  waiting to be cut out, as `compose.ts` already was.

## Version 3, and readiness

The microphone is a new *input* — pitch in, fingering out — that bypasses the
valve pad and asks the judge the same question by another route. Several
things filed under it: the hint ruling (trouble under the written note) is
provisional until it lands; the fermata is parked on it; and the mic pitch
spike of 2026-08-04 (notes settle after ~0.2s on E flat bass and cornet) is
the measurement it starts from.

**Both counts of readiness were settled on 2026-08-18.** The `Session`/input
seam exists — `PlayerInput`, six members, the session taking one rather than
making one — so the microphone replaces `ValveInput` and nothing else. And the
engagement rule — an open note counting only from a player who has been
playing — is now inside `ValveInput.answers` rather than in the judge, which is
the scoping that was asked for: it is a rule about *buttons*, where open and
absent are the same input, and a microphone hears the difference. A second
implementation (`HeardInput`, in `player-input.test.ts`) drives whole sessions
to prove both, and is deliberately not a microphone — it has no detector and no
onset measurement, only enough to show that nothing downstream knows which side
of the seam an answer came from.

What is left before the mode is the microphone's own work, unchanged by any of
this: the detector rewritten in TypeScript against the recordings in
`spikefiles/`, two measurements where the buttons give one (onset from the
envelope, pitch 200ms later), and the instant green confirmation giving way in
that mode only.

## How this session worked, which is worth repeating

**Measure the thing the player heard, before deciding what it is.** The
theme gap, the tuba bloom, the headset lead, the response time — every one
was a number before it was a fix, and the numbers are in the docs. The two
times I fixed the wrong thing were the two times I did not read the sequence
of reports as data first.

**Ship trials behind the URL** — `?tier=free`, `?voice=pad`, `?voice=plain` —
so a phone can try a thing without a second deployment, and graduate what
works.

**Mutation-test every new rule.** Every one earned its keep, and one showed a
test asserting a seed coincidence rather than the invariant.

**Look at the picture.** The engraving snapshots re-recorded five times this
session, and each was rendered and read before it was accepted; the tune
sheet (`npm run tunes`) exists so composed music can be looked at by the
dozen.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint — and check the build's exit, not grep's), tag every version on
its last commit, keep pure corrections in their own release, confirm the
deploy afterwards rather than assuming it, and write the ruling into
`v2-design.md` in the same release as the code.
