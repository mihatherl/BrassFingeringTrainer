# Windowed scoring and endless play — the plan

**Status: agreed direction.** Chosen by the player on 2026-08-10 as the next
work after fermatas were parked, from the order `v2-design.md` already
lists. That document carries the design rulings (*Playing for as long as you
like*, *The hard part: stopped, or resting?*, *What the score covers*); this
one only sequences the build and records what got settled on the way. The
rolling window — recommended there, with blocks as the alternative — is
taken as ratified by the player choosing this pair with that recommendation
attached.

## What v2-design already rules, restated in one breath

Do not let `Exercise` grow: pre-generate to a generous cap and make white
against grey a matter of drawing and scoring alone. Grey is one more state
in `colourFor`, which already exists. Score the *window*; record weak-note
stats for the *whole* session — `summarise` takes the judgements it is
given, so the window is a filter at the call site rather than surgery. The
stopped-or-resting rule should be the simplest thing that works, written to
be replaced by the microphone rather than refined.

## The stages

**Stage A — windowed scoring. Built, v1.18.0.** The score becomes the last `SCORE_WINDOW`
bars (16 to start, settled by playing). The play screen's live percentage
reads the window, so a bad patch stops haunting the rest of a session; the
results screen keeps the whole-run review stave and streak, adds the
windowed figure as the headline where the run is longer than the window,
and keeps feeding whole-session stats to weak-note drilling exactly as
today. A pure helper beside `summarise`, tests beside it, no engine change.

**Stage B — the horizon. Built, v1.19.0** — free material only, per the
stage; two finds from driving it are worth keeping. The play screen's
denominator became the *chosen* length's notes, with the count standing
alone beyond it, because "10 of 910" was the cap talking. And the results
review engraves only as far as the run reached — two hundred bars of
unplayed ink was burying the bars that mattered. The stop rule's
open-fingering clause proved itself in the first headless run: a ghost that
touches nothing still gets bars containing open notes credited as played,
which for a real player is exactly what stops a bar of open notes ending
their run. Original stage text follows. Generation takes a `horizonBars` cap (the app
asks for it; tools, figures and tests keep asking for exact lengths, so
every committed snapshot stays byte-identical). Past the chosen length the
music draws grey; playing into it turns it white a bar at a time. The
session's end condition becomes: from the chosen end onwards, a whole bar
containing notes with no input at all ends the run — wrong notes are input,
so fluffing four bars and carrying on survives, per the doc's shape, with
the thresholds settled against the instrument. The results screen reports
how far the run reached alongside the windowed score.

**Stage C — the seams. Built, v1.20.0.** Themes stitch whole tunes to the
cap and patterns fill whole cycles to it, each in its own unit, with the
cap a floor for whole units rather than a ceiling. The key tour wraps
beyond the chosen count — the next block takes the next key round the
circle again — and a pattern's closing tonic moved to the true end of the
paper, where the resolution belongs. The exact-length path is preserved to
the byte, which the engraving snapshots held still to prove. The theme
joins in the grey take steps and rits by construction, since the plan
already reads every join the stitching reports. What remains of this plan
is playing: the stop rule's patience, the window size, and whatever else
the instrument turns up.

## What playing turned up, and what it cost

**The stop rule never fired, and the reason is a ruling this project had
already written down.** It credited a bar as played if any note in it was
judged correct — meant to protect a bar of open notes played perfectly. But
with buttons, holding nothing *is* holding open, so a player who had walked
away had every open note marked correct beneath them. Measured on the app's
own defaults: 83% of random bars contain an open note, 87% of sight-reading
bars, and **100% of scale bars** — a real exercise ran nine bars past the
chosen end before stopping, and a scale would have run to the cap. The clause
could only ever suppress the rule, never inform it, because it fired
precisely when the evidence was ambiguous. *v2-design.md* said as much before
any of this was built: "with buttons, silence is ambiguous. Resting, missing
a passage badly, and putting the instrument down all look identical."

So a bar every note of which could be played open now proves nothing and is
passed over, exactly like a bar of rests, and the evidence wanted is a valve
down rather than a correct answer. Patience went to **two consecutive**
demanding silent bars, because a player who loses their place and drops out
to find it is resting, not finished — around five seconds at an ordinary
tempo. Measured in the real app: stopping now reaches the results screen in
2–5 seconds.

**The white promotes a block at a time**, a block being the length the player
chose — the promotion this plan's parent document proposed and the first
build quietly dropped in favour of one bar at a time. Revealing bar by bar
looks equivalent and is worse for the reason the whole feature exists: the
bar you are *about* to play stays grey until you are inside it, so a player
reading ahead is always reading grey. `horizon.ts` holds the arithmetic,
clamped at both ends and tested against absurd beats, so the number the
renderer greys against can never run past the paper.

## Still open, and known

- **The Stop button discards the run.** It returns to settings with no
  results, which was harmless when exercises ended by themselves and is not
  now that stopping is the designed ending.
- **Variable tempo is sparse across the grey** for free material and
  patterns: the plan is given one interior boundary, the chosen end, so a
  two-hundred-bar run gets a single step and a closing rit. Themes are fine,
  having a join per tune. Block boundaries are the obvious candidate, with a
  minimum spacing so a four-bar block does not change speed every four bars.

## Decisions deliberately left to playing

The window size; the cap per material kind (200 bars of free material is
around eight minutes — themes and cycles round to their own units); and the
stopped rule's exact patience. All three are numbers, and numbers here get
settled the way every figure before them was.
