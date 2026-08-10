# Handover — the session of 2026-08-09/10

Written for whoever picks this up next, cold. It records what was built,
what was decided and why, and what is left. The durable rulings live in
`v2-design.md`; the two feature plans are `tempo-map-plan.md` and
`endless-play-plan.md`, both kept up to date as they were built. **Read this
for the shape, those for the reasons.**

The app went from **v1.15.0 to v1.28.0** in this session, all deployed.

## What was built, in order

**Dynamic tempo** (`tempo-map-plan.md`, agreed with the player before any
code). Four stages, each shipped:

| | |
|---|---|
| v1.15.0 | `domain/tempo.ts` — the map: step changes, ramps, holds, closed-form both ways. `Transport` routes through it. Deliberately invisible; the pre-existing clock tests passed unmodified, which was the point. |
| v1.16.0 | Step changes at theme joins, behind **Variable tempo** in the Playback panel. `Exercise.tempo`, `tempo-plan.ts`, printed metronome marks. |
| v1.17.0 | Rits: a closing rit into every ending, chance rits into theme joins, italic *rit.* marks, and the conductor's **orb** — a cool glow at the baton tip while a rit is bending the speed. |
| — | **Fermata: spiked, then parked.** See below. |

**Endless play** (`endless-play-plan.md`), which took several attempts to get
honest and is worth reading in full before touching it:

| | |
|---|---|
| v1.18.0 | Windowed scoring — the last sixteen bars, not the whole run. |
| v1.19.0 | The grey horizon: 200 bars of paper past the chosen length. |
| v1.20.0 | Themes and patterns fill to the cap in their own units. |
| v1.21.0 | Stop-rule fix, and the white promoting a **block** at a time. |
| v1.22.0 | The key set actually touring; patience in beats; quieter tone. |
| v1.23.0 | **The inference replaced by a button.** Thumb-sized, red Stop / green Continue. Stop now scores the run instead of discarding it. |
| v1.28.0 | **Playing on restored** as an answer alongside the button. |

**Everything else:**

| | |
|---|---|
| v1.24.0 | **6/8 offered**, and the four faults turning it on exposed. |
| v1.24.1 | Key changes planned across the chosen length, not the paper. |
| v1.25.0 | Settings screen quietened; sections start shut; results buttons above the review. |
| v1.26.0 | Low brass reach written C6; readable pattern starts; **register** control. |
| v1.26.1 | The play button answers any finger, not just the first. |
| v1.27.0 | Patterns locked to **4/4**; cycles run together; closing tonic held. |

## The three decisions worth not re-litigating

**The fermata is parked, and it is not a tempo problem.** A spike was built
(`public/spike/fermata.html`, live at `/spike/fermata.html`) with the full
ruled gesture — the held ictus, the meld, the lift, the drop — and playing it
alongside further reading settled it: **a fermata is a two-handed act.**
Robertson's *Fermate* chapter gives the sustain to the left hand while the
right keeps the pattern, and one drawn baton flattens that into a gesture no
conductor makes. It waits for the **microphone**, which can release a player
by hearing them. The map's `hold` machinery is built, tested and inert; the
spike stays as the workbench. Nothing needs removing.

**Silence can never be read as leaving.** This was learned three times. With
buttons, an open note and an abandoned instrument are *the same input* —
`v2-design.md` said so before any of it was built. Every rule that tried to
infer intent from silence failed, and the last one failed while looking like
it worked. The direction that *is* honest is the opposite: **playing means
staying**, because a valve down is unambiguous. That is what v1.28.0 does,
and the generator now keeps open notes out of the few beats past each block
boundary so there is always a valve to put down.

**The chosen length is the unit; the paper is not.** The horizon broke three
separate things this way — the tempo plan, the key planner, and the pattern
placement — each time by spreading something across the 200 generated bars
rather than across what the player asked for. **When adding anything that
reads a length, ask which one it means.**

## What is left

**Named, and worth doing:**

- **The 6/8 conducting pattern wants review.** It currently uses the plain
  two-pattern with the same phase warp as 2/4, which is right as far as it
  goes — Mann: 6/8 is "the same pattern as 2/4 but with a triplet feel", and
  `patternFor` keys off `pulsesPerBar`, so no new shape is needed. But the
  compound chapter in `input/conducting` says the *motion* differs:
  "conducting in compound meters carries more bounce, or air, between each
  beat… the conductor should emphasize the arrival point more greatly than
  when traveling between gestures." That is the phase warp, not the geometry
  — `lagFor(style)` in `render/conductor.ts` — and compound time arguably
  wants a deeper lag than simple time at the same style setting. Worth
  spiking against `public/spike/conductor.html` and judging by eye and by
  playing to it. Two related notes from the same chapter: below Andante the
  taught shape is the **subdivided "slow" pattern** (six for 6/8), which is
  drawn in the reference and could be added when wanted; and `STYLE` in
  `ConductorPanel.tsx` is still hardcoded at 0.55, so any style work
  probably wants the setting exposed at the same time.
- **Variable tempo is sparse across the grey** for free material and
  patterns: the plan gets one interior boundary, the chosen end, so a long
  continued run has a single step and a closing rit. Themes are fine, having
  a join per tune. Block boundaries are the obvious candidate, with a
  minimum spacing so a four-bar block does not change speed every four bars.
- **The conductor's style setting** — the legato-to-marcato axis is threaded
  as a parameter and never exposed. It is a difficulty axis as much as a
  style one.

**The roadmap, from `v2-design.md`:** the microphone (the big one, and the
fermata's second hand), the gated settings screen (the selling blocker), My
Music via MusicXML import, then a server only if that shows demand.

**Numbers that are guesses until played:** `GRACE_BEATS` and `VALVED_BEATS`
(4 each), `OFFER_BEATS` (4), `SCORE_WINDOW_BARS` (16), `HORIZON_BARS` (200),
the tuba's written-C6 ceiling, and the tempo plan's step and rit factors.
Each is one constant.

## How this session worked, which is worth repeating

**Every visible change was looked at**, not just tested: `npm run svg` and a
headless browser for engraving, and the real app driven through Playwright
for anything with timing or touch in it. That caught, among others: a
register control that was inert in every configuration, a counter reading
"20 / 17", and a settings screen where the styles lost on source order and
left a correctly-sized button in the wrong colours.

**Two bugs were found by measuring rather than believing.** The stop rule
was proven dead by counting how many bars contain an open note (83–87%, and
100% of scale bars). The key-change fault was proven by printing where the
changes actually landed (bar 100 of 200). Both had passed their tests.

**A test that cannot fail is worth nothing.** The multi-touch fix was
verified by driving two simultaneous touches through the browser's input
pipeline *and* confirming the same test fails against the old handler.

**Watch the harness before blaming the feature.** Two verification runs
suggested playing-on was broken; both times the fault was keys pressed
before the play screen had mounted its listener.

**Conventions in force:** push without asking once the gate is green (tests,
build, lint), tag every version on its last commit, and keep pure
corrections in their own release so patch numbers mean something — v1.24.1
and v1.26.1 are the examples.
