# Version 2 — direction and the thinking behind it

Written after v1.0.0 was tagged and deployed. Everything here was decided in
discussion; none of it is derivable from the code, and several of the rulings
came from playing experience rather than from reasoning about the software. It
is written down so it does not have to be argued out again.

## Where things stand

**v1.0.0** was an installable PWA drilling valve fingerings against notation,
judged by three on-screen buttons. Fully offline, no backend, no runtime network
requests at all — that last part is worth defending rather than an accident.

**v1.15.0 is deployed** to GitHub Pages, 481 tests. Since v1:

| | |
|---|---|
| Ties | Built. Over the bar line, Medium upwards. See *Ties, as built*. |
| `secondsBetween` | Built. The one seam a tempo map has to change. |
| Spelling on the note | Built. Took `fifths` out of the renderers. |
| `metre.ts` | Built. Bar length, pulse and numerator are now separate things. |
| The conductor | Built and on screen, off by default. |
| Key changes | Built. A set of keys, modulating between them. See *Key changes, in detail*. |
| Pattern cycles | Built. Scales are measured in times through, not bars. |
| Play-screen layout | Rebuilt around one shared unit; a real wide layout for tablets and desktops. |
| Commercial groundwork | The licence seam, and CI building the gated app. See *Selling it, one day*. |
| Themes | Built, as its own material kind. Written tunes played whole, measured in themes. See *Themes, and playing for as long as you like*. |

Push to `main` deploys: Actions runs `npm test`, then builds the app twice —
once with `VITE_GATED=true` to prove the paid path still compiles, then the
real build that gets published. The version in `package.json` is stamped into
the build and shown on the settings screen, so bump it with anything
user-visible — there must never be doubt about what a device is running.

**Every version is tagged**, `v1.0.0` through `v1.5.1`, annotated with what
shipped in it. This was not true for a long time — the tags stopped at `v1.2.0`
while ten more versions went out — and it was backfilled before starting the
tempo map deliberately. That is the item this document calls the highest risk
in the project, on the grounds that a bug in `timeForBeat` desynchronises sound
from notation, and the question when that happens is *which build was still
right*. `git bisect` needs named points to answer it.

The convention: a tag sits on the **last** commit at that version, so it covers
everything that shipped under the number rather than the moment the number
changed. Each tag's commit has that version in its `package.json`, and it is
worth keeping that true.

### The state of things, for someone picking this up cold

The last stretch of work went in four shippable stages, each verified in a
browser before the next began. That order was not incidental and is worth
repeating for anything of this size: the model first with no behaviour change
at all, then a visible fix that the feature happened to need, then the feature.

- **`Exercise.keys` replaced `Exercise.fifths`.** Ask it with `keyAt(beat)`. It
  is the same shape as `metre.ts` on purpose — "what is in force at beat b" is
  a question a part asks of its key as well as its metre.
- **Scales and arpeggios are measured in cycles**, and each cycle is padded out
  to its bar line. That padding is what makes a cycle boundary a bar line,
  which is what lets the key change between two of them.
- **A key change lands on a bar line and nowhere else.** Nearly everything
  downstream leans on that one rule; see *Key changes, in detail*.
- **Nothing is known to be broken.** The one outstanding fault is the gated
  settings screen, which no shipped build exercises — see *Selling it, one
  day*, which is written to be implemented from.

**A session handover for 2026-08-09/10 is in `handover.md`**, covering
v1.15.0 to v1.28.0 — dynamic tempo, endless play, compound time — with the
decisions worth not re-litigating and what is left.

### Where to look

| | |
|---|---|
| `src/domain/keys.ts` | `keyAt`, `orderByCloseness`, `widestKey`, spelling. The key model. |
| `src/domain/metre.ts` | Bar length, pulse, `barAt`. The model `keys.ts` was built to match. |
| `src/engine/clock.ts` | `timeForBeat`, `beatForTime`, `secondsBetween` — the three functions a tempo map replaces. |
| `src/exercise/generate.ts` | Rhythm, pitch, key placement. Patterns are generated the opposite way round from free material; the comment on `generateExercise` says why. |
| `src/exercise/ties.ts` | How the rest of the app reads a tie. |
| `src/exercise/theme.ts` | The theme format, its validator, and degrees into a key. |
| `src/exercise/themes.ts` | The corpus itself. Forty-two, hand-written, covering every difficulty in every metre the app offers. |
| `src/exercise/phrases.ts` | Choosing themes and laying them end to end. Named for the kind it first served; it now serves *Themes*. |
| `tools/theme-sheet.mts` | `npm run themes` — the whole corpus engraved on one page, for deciding what to keep. |
| `src/exercise/assemble.ts` | Slots and pitches into an `Exercise`. Shared by generated material and themes so the two cannot drift. |
| `src/render/stave.ts` | `layoutKeySignature` — one arithmetic shared by drawing and measuring, including the naturals that cancel an outgoing key. |
| `src/render/surface.ts` | Both reading modes. `staveSpaceCeiling` is the unit the whole play screen is sized from. |
| `src/render/conductor.ts` | Pattern geometry, ported from the spike. The 6/8 motion wants review; see `handover.md`. |
| `src/licensing/` | The only two files that know money exists. |
| `public/spike/` | Throwaway. The conductor and microphone spikes, and where shapes are argued about. |
| `tools/stave-to-svg.mts` | `npm run svg` — renders an exercise to SVG so engraving can be *looked at* without a browser. `--keys -3,-1` draws a key change. |
| `tools/render-svg.mts` | The drawing itself, shared by that tool and the engraving snapshots so the two cannot drift. |
| `src/render/__snapshots__/engraving/` | Nine committed SVGs, held to the byte by `engraving.test.ts`. Open them; they are pictures. |
| `tools/shots.mts` | `npm run shots` — drives the real app at five viewports and photographs it. The viewport list is the valuable part. |
| `input/` | Reference material, gitignored. Currently a conducting textbook chapter. |

`tools/` **is** typechecked now, by `tsconfig.tools.json`, which the root
project references — so `npm run build`, and therefore CI, catches a break
there. It is the same trick `tsconfig.test.json` uses, and for the same reason:
app code plus Node types, kept out of the app project where reaching for Node
would be a mistake worth catching.

It was added because the rot had happened twice. The second time,
`stave-to-svg.mts` had been passing no `clef` to `drawSystem` since that option
became required, so it drew **no clef on any system** while still exiting
cleanly — the tool used to check engraving by eye, silently wrong about the one
thing 1.2.2 was released to fix. Turning the compiler on found it in a minute.
Only the `.mts` tools are covered; the `.mjs` ones never reach into `src` and
cannot rot this way.

`tsx` is a declared dev dependency and `npm run svg` is the documented way in.
Both were `npx tsx` before, which fetched an undeclared package off the network
on every cold run — in an app whose whole point is needing no network.

### How this has been checked, and why the tests are not enough

Three faults in this stretch were found by looking at the thing rather than by
running the suite, and none of them would have been caught by a test written in
good faith beforehand:

- A stacked page drew stems and ledger lines in mid air below the last line,
  because it culled systems by their whole extent rather than by their stave.
- The first header-suppression attempt clipped the first notehead of every
  clef-less line — the spacing tests all measure notes *relative to each other*
  and so had nothing to say about the left edge.
- The cancelling naturals were drawn hard against the new signature.

So: `npm run shots` for the page, and `npm run svg` for the engraving.

**The browser route is a committed script now** — `tools/shots.mts`, driving
the real app at five viewports and photographing the settings and play screens.
It was rebuilt from memory each time before, which meant the viewport list, the
part actually worth keeping, was rewritten each time too. The sizes are chosen
against the breakpoints in `index.css` rather than from a device list: both
sides of the `landscape and max-height: 32rem` line, since a tablet on its side
took a phone's concessions for a long time. Nothing sits *near* 32rem, because
that line is deliberately in open country.

It starts the dev server itself, reading the port out of Vite's output rather
than assuming 5173, and `--tier free` photographs the gated screen — which is
the fastest way to see the blocker below, chip by ungreyed chip. `--theme dark`
and `--viewport <name>` narrow it down. The screenshots are **not** committed
and are not snapshots: they vary with the host's fonts and GPU, so diffing them
across machines would cry wolf. They are for looking at. The byte-for-byte
check is the SVG one.

**That SVG route now runs as a test.** `src/render/engraving.test.ts` draws
nine figures and holds each to a committed SVG, byte for byte. It was the
cheapest regression check available and it depended on somebody remembering to
do it; now it does not.

Be clear about what it buys, because a snapshot only knows what it was shown
first. **It cannot say a drawing is right** — all three faults above would have
been recorded as correct had this existed at the time. What it does is stop a
fixed thing from quietly un-fixing, which is exactly what had happened to the
clef. So a failure is a question, not a verdict: the diff says the engraving
moved, and whether it moved for the better is settled by opening the file,
since the snapshots are ordinary SVGs a browser will draw. Look before
accepting one with `vitest -u`, or it degrades into a test that records
whatever the code happens to do.

The figures are chosen for what has broken or what carries a rule this project
committed to, not for coverage: ties curving both ways, a key change *and* a
change into C major, a scale in cycles, 6/8, the bass clef, and two authored
themes — the plainest, and the modulating one, where both of that feature's
faults were. Two of them
depend on `seed: 6` putting the change mid-system — on a system break a change
draws nothing but the signature every line states anyway, so the double bar and
the cancelling naturals would go unexercised. A test asserts that seed still
does so, rather than leaving it to be lost silently.

`tools/render-svg.mts` holds the drawing, shared by the tool and the test. That
sharing is the point: a snapshot of a reimplementation would go on passing
while the tool drew something else.

## When a major version is warranted

Asked on 2026-08-12, and worth writing down because the number is stamped on the
settings screen and is the only thing that tells a player which app they have.

This project has no API consumers, so semver's breaking-change sense does not
apply. The question is not "did compatibility break" but **"would a player say
this is a different app?"** By that test there is one honest line:

> **2.0.0 lands when you can open your own part, and it is still there
> tomorrow.**

Three reasons for that line rather than "when import is finished":

- **It is the only category change available.** Forty-odd minor versions of
  "generated exercises, drilled better" is one coherent app. The moment it plays
  *your* music it stops being that app, and that is what a major number is for.
- **The player can check it; nobody can fudge it.** "Can I open a part and play
  it?" is yes or no. "Is the importer complete?" is a judgement that would slide.
- **It does not hostage the number to a feature list.** Import is never
  finished. v1.0.0 shipped with plenty unbuilt too.

**Reached in v2.0.0**, 2026-08-12: a MuseScore export opens, reads, plays, and is
still in My Music on a cold start. Known gaps were named in the release rather
than held against it — tempo marks unread, `<transpose>` ignored by design and
untested, the part chooser never tried on a real multi-part score, and no way to
start from a chosen bar.

## The direction

In order. Each step is useful on its own, so this need not be delivered as one
release.

1. ~~**Ties**~~ — built. ~~Tuplets~~ — built too; see *Triplets, as built*.
2. ~~**Key changes**~~ — built. See *Key changes, in detail*.
3. ~~**Themes**~~ — built, as a material kind of its own rather than as a better
   sight-reading. Written tunes stored as scale degrees, agnostic of key and
   tempo. The corpus is the work that remains. See *Themes, and playing for as
   long as you like*.
4. ~~**Windowed scoring**~~ — built. The score covers the last sixteen bars.
5. ~~**Endless play, with a grey horizon**~~ — built. Music continues past the
   chosen length in grey and a green button buys another block of it. See
   `endless-play-plan.md`, and note that the hard question — stopped or
   resting? — was answered by asking rather than by inferring.
6. ~~**A tempo map**~~ — built: step changes at boundaries, rits into every
   ending, printed marks, and the conductor's orb cooling through a rit.
   **The fermata is parked**, on the ruling that it needs a second hand; see
   *Fermata* and `tempo-map-plan.md`.
7. **The microphone as input**, instead of the buttons. Proven in a spike and
   parked; see *The microphone, parked*. It also answers the one hard question
   in 5 — it can hear that you have stopped.
8. **My Music** — a mode of its own for the player's own parts, imported from a
   local MusicXML file. Gated. See *My Music, and why it is not a material*.
9. **A server**, only if step 8 shows people want a library rather than their
   own files.
10. ~~**The key on a dial, turned mid-run**~~ — built, v2.13.0. See *The key on
    a dial*, which carries the rulings, the measurement and the one thing left
    open.
11. **The settings screen, in four steps** — agreed with the player on
    2026-08-15, and each step is useless before the one above it.
    1. ~~Subtractions and defaults~~ — built, v2.14.0. See *Fewer things to
       choose*.
    2. ~~The accordion~~ — built, v2.15.0. See *One box per material*.
    3. **Drills**: Scales and Arpeggios become one box with a selectable drill
       type, and the key choice moves down into it. The four arpeggios the box
       used to promise — subdominant, dominant, dominant 7th and relative minor
       — are wanted as selectable drills here; see *Nothing claims what it does
       not deliver* below for why the promise came off in the meantime. The generator is already
       built for this — `SCALE_PATTERNS` and `ARPEGGIO_PATTERNS` are lists of
       `{ rootDegree, intervals }`, and the comment above them has said since it
       was written that adding one is a matter of listing it and letting the
       player pick.
    4. **Named minor scales**: *A minor harmonic*, *A minor melodic*, chosen the
       way a book prints them rather than as a key signature plus a mode. The
       intervals are free; **the work is spelling**. `spellInKey` chooses
       accidentals by the key signature's direction, and a minor key takes its
       relative major's signature — so D harmonic minor is one flat and its
       raised seventh would come out as D♭ rather than C♯. The pattern has to
       carry which degree is raised, not just a semitone count. Melodic minor is
       already ruled: ascending melodic, descending natural.

**Before any of those, if the app is ever to be sold**: the gated settings
screen, which currently accepts choices it then silently overrides. It is a
blocker rather than a feature, and it is written up ready to build in
*Selling it, one day*.

Two smaller things worth doing whenever they are convenient, both noted where
they were found: the fourth exercise kind could use a second arpeggio pattern
(the list in `ARPEGGIO_PATTERNS` is deliberately one entry and says so), and
`FREE_TIER.playbackMode` is declared but never read.

### Why local import before a server

A server buys a library, sharing and sync. It costs hosting, availability,
auth, the offline guarantee, and a copyright question — hosting other people's
band parts is a materially different act from someone opening their own file.

The parser and the data model are identical either way. Build the importer
against a file picker; if a library proves worth having, the server serves the
same format and nothing in the app changes.

**MusicXML rather than MIDI.** MIDI discards spelling and key, which are the
two things this app cares most about.

## Nothing claims what it does not deliver — v2.15.1

The player's rule, given on 2026-08-15 and worth keeping as a rule rather than
as one correction: **nothing should make a claim of something it doesn't
deliver.**

What prompted it: the Arpeggios box read *"Tonic, subdominant, dominant,
dominant 7th and relative minor — all in key"*, and `ARPEGGIO_PATTERNS` has held
the tonic triad alone since it was written. The blurb was describing an
intention. Nothing connected the sentence to the list, so nothing noticed — and
a player choosing that box on the strength of it would have been reading one
chord and wondering where the other four were.

The sentence now names the one chord. The other four are wanted and are on the
list for the drills picker; **the promise comes back when they arrive, and not
before.** A test now ties the two together in both directions: it fails if the
blurb widens past the patterns, and it fails when a pattern is added without the
blurb widening — which is the reminder to write the sentence back.

The same guard covers the Scales box, whose blurb must not mention a minor until
step 4 gives it one.

**The other nine blurbs were audited against the data and all hold.** Worth
recording that they were checked rather than assumed: every difficulty's range,
rhythm list, accidental, rest and tie chances say what the blurb says, including
the two that make claims about a *different* level — Medium's pattern blurb says
dotted rhythms wait for Hard, and Hard's pattern rhythms do indeed carry a dotted
quaver.

## The Playing section, in pairs — v2.15.4

The same problem as the sight-reading box and the same measure: 760 pixels on a
phone, against roughly 700 above the Start bar. It could not be seen in the
window it was opened in.

**Most of its settings are two-option questions**, and one card per line spent a
line saying what a second column says for nothing. A reading mode is scrolling or
paged; sound is on or off; what keeps time is a metronome, a conductor, or
neither. All three now sit two to a row.

**The fingering modes divide two and one**, which is what they actually are. The
two a player lives in — prompting where the trouble is, which is the default, and
no prompting at all — share a row. *Every note* is the one chosen deliberately
for a piece never seen before, and it takes the row below on its own. That is
also where the odd card of three lands: `.cards--two` gives a last-of-three the
full width rather than a gap beside it, so the rule and the meaning agree without
either being told about the other.

`FINGERING_MODES` was reordered to match, since the list is the display order and
nothing reads it by index. A test pins it, because the order now carries layout.

**A card's content sits at the top of it.** Side by side a card is as tall as the
tallest in its row, and without this a short blurb floated to the middle, away
from the name it belongs to — *Never* and *Just the music.* read as two separate
things.

760 pixels down to 602, and it fits.

## Getting the sight-reading box into one frame — v2.15.3

The player's reason, which is the thing to keep: *people will still get lost in
the settings screen.* An expanded box that runs off the bottom is most of how
that happens — you are shown the top half of the thing you just asked for, and
have to hunt for the rest.

**The key window came down from two rows to one and a half.** Two rows tall meant
that at either end of the list — the top being where an E flat player starts —
both visible rows were *whole*, and a window showing only whole rows looks like
the whole control. A player with no reason to think anything is missing has no
reason to swipe. Under two rows there is always part of a row cut off, which is
the only thing that says *there is more this way* without a scrollbar saying it.

**Difficulty is one row of four**, whatever the width. Equal columns rather than
wrapping, with the type a step down and the padding in with it — which is what
makes four labels fit a phone. The longest of them, the patterns' *2 oct · mixed*,
is the one that decides the size.

**A label and its dropdown share a line** where the control is small enough to
allow it. Stacking spent a whole line on a label with nothing beside it.

**The fields' margins were being added to the body's grid gap**, which put half a
centimetre of nothing between every control. The grid does the spacing now.

Those four together took the box from 461 pixels to 419.

**And an opened section comes to the top of the screen.** The box was never the
problem — 419 pixels fits an 844-pixel phone with room to spare — it was the 497
pixels of title, My Music, instrument and two collapsed material boxes sitting
above it. Scrolling the section up is what actually met the player's goal, and it
throws nothing away to do it.

Measured rather than eyeballed: on a 390×844 phone the whole expanded
sight-reading box now sits inside the frame, above the sticky Start bar. On a
360×740 phone it is still 74 pixels over. The remaining lever is the blurb under
each *collapsed* material name, which wraps to two lines and is read once — but
that is information being taken away rather than space being recovered, and it is
the player's call.

## The keys, in a window two rows tall — v2.15.2

Asked for by the player: the key chips were three quarters of a screen of
buttons, and a settings screen that has just been cleared of choices should not
then spend its height on fifteen of them.

**Three rows of five, in a window two rows tall.** One row shows whole with half
a row above and below — enough to say *there is more this way* without a
scrollbar having to say it, and enough that a thumb knows which way to move.
Rows snap, so a swipe lands on a row and never between two.

**Five to a row is not an arbitrary five.** Fifteen keys in rows of five puts B
flat, F, C, G and D — two flats to two sharps — in the middle row on their own,
which is where nearly all brass band reading lives. The rows either side hold the
keys a player goes looking for rather than the ones they land on. A test pins the
arrangement, because changing the row length would stop that being true silently.

**The window opens on the row holding the key the exercise starts in**, rather
than always on the middle one. Nearly always they are the same row. When they are
not — an E flat player, which is the default — a control that opened with the
current choice half out of sight would be hiding the one thing it most has to
say. At either end of the list this shows two whole rows rather than one and two
halves, because there is nothing beyond the end to show half of.

**The chip is three quarters of the height it was**, 61 pixels down to 46. It was
padded top and bottom around two short lines, carrying the empty room of a button
built for one. It now has an explicit height and is centred in it — which is also
what makes the window's height arithmetic rather than a guess, since two chips
and two gaps is exactly one row plus the two halves.

The window is capped at 22rem wide. It is a thumb control, and five chips
stretched across a desktop panel are both ugly and further apart than one hand
can work.

## One box per material — v2.15.0

The second of the four steps. Pure presentation: not a line of the model, the
generator or the storage changed, and every control is the same control it was.

**The open box is the material.** Deliberately not two states. A selected box and
an expanded box say almost the same thing, and two states saying almost the same
thing can disagree — the screen would then have to answer what it means to
expand Themes while Scales is chosen, and there is no good answer to that. So
there is one state, `settings.kind`, and the open box shows it. Which is also why
the open box does not close: closing it would leave no material chosen, and an
exercise has to be made of something.

**A box holds only what applies to it**, which is the whole reason to have boxes.
Most of what used to sit in one column belongs to one material and is noise
beside the others:

| | Keys | Difficulty | Time signature | Range | Register |
|---|---|---|---|---|---|
| Scales | ✓ | ✓ *(as a span)* | — | — | ✓ |
| Arpeggios | ✓ | ✓ *(as a span)* | — | — | ✓ |
| Sight-reading | ✓ | ✓ | ✓ | ✓ | — |
| Themes | ✓ | ✓ | ✓ | — | — |

A register is a question about where a scale sits on the horn and means nothing
to a written tune. A range is a question about the pool free material is drawn
from, and neither a pattern placed by its tonic nor a theme already written has
a pool. A scale is a shape played against a click rather than a piece with a
metre, so it has no time signature to choose — that was a *disabled* dropdown
reading "4/4" before, which is a control explaining itself where no control was
wanted.

The fields are values built once in the component and placed by the accordion,
rather than laid out in a fixed column with guards on each. Only one of each is
ever rendered, which is what keeps them plainly the same control wherever shown.

**Both `aria-pressed` and `aria-expanded`** sit on each box's button, because
both are true of it and neither implies the other to a screen reader: it is the
pressed one, and it is the expanded one.

## Fewer things to choose — v2.14.0

The first of four steps through the settings screen, agreed with the player on
2026-08-15. This one is subtraction only; the accordion, *Drills* and the named
minor scales follow, in that order, and each is useless before the one above it.

### What went, and what it cost

**Random notes.** The player's verdict: not different enough from sight-reading
to be worth a choice. What actually differed was that its walk leapt freely
inside the difficulty's maximum interval where sight-reading moves by step —
angular interval reading rather than melodic reading. If it is ever missed, it
comes back as **a difficulty trait rather than a mode**: how far a line may leap
and how often is a dial, not a category. The player has separately asked for
leaps to be reconsidered against *what is plausible for this instrument at this
difficulty*, which is the same question and the place this belongs.

Its walk had one caller left after the mode went — a pattern too wide for the
instrument, which falls back to free material — and handing that player a mode
that no longer exists made no sense, so the fallback is phrases too.

**It cost something real, and it is written down rather than papered over.** The
generator steers free material away from open notes just past a block boundary,
because carrying on playing is how the offer of more music is taken and a valve
going down is the only unambiguous thing a set of buttons can say. Measured with
the preference in and out, sight-reading's open-note rate past a boundary is
0.229 against 0.236 — **the steering is very nearly inert for stepwise
material**, which has two or three notes to choose between at any moment and
cannot do better. The hard guarantee — that no window is open from end to end —
still holds everywhere. What has gone is the margin, and winning it back means
letting a phrase leap further in those four beats: the leap question again.

**Expert.** Dropped as impractical on phone hardware — relentless semiquavers
against valve buttons. Stored settings migrate themselves, since `sanitise`
already falls back for a difficulty it does not recognise.

It orphaned eight written themes, every one of them failing on a leap of a tenth
and on nothing else. The player's ruling was to file them as Hard, which forced
a rule apart that should never have been one rule: **`difficulty.maxInterval`
constrains a random walk, and an authored tune is not a random walk.** A
generated line picking freely inside a wide interval is a sequence of unrelated
jumps; a composer's tenth is placed, prepared and resolved. Themes are now
checked against `THEME_MAX_LEAP` instead — still a ceiling, because it catches
the thing worth catching, which is a typo in a degree landing two octaves out.

The player's observation alongside it, worth keeping for later: **the corpus's
difficulty labels are miscalibrated**, themes reading easier than the
sight-reading of the same name. Recategorising them and writing more is its own
piece of work.

**Length.** Three fields — `bars`, `cycles` and `themeCount`, one per material —
behind a single label, only ever one of them on screen. Dropped because *people's
attention span will snap when presented with too many options*. Every material
now opens on a figure the player chose as worth one sitting: sixteen bars of
reading, four times through a scale, eight through an arpeggio (shorter, so more
of them) and four whole tunes. See `DEFAULT_LENGTHS`.

Removing it took away a decision rather than a capability, because the mechanism
that replaces it was already there and is better: a valve going down past the
committed end takes the offer without a hand leaving the instrument. A player who
wants more plays on; one who wants less presses Stop, which has always scored
what was actually played.

### The paywall moved, and it now refuses by not offering

Length was one of the levers the paid tier pulled, and dropping the setting
dropped the lever. What replaced it is better aimed: **every tier gets the same
material and the same default length; only a paid copy may carry on past the end
of it.**

Enforced by not generating the horizon at all — `horizonBarsFor` — rather than by
declining the offer. With no paper past the committed end `Session.canContinue`
is false, the question is never raised, and there is no moment at which the app
has to say no. No green button that turns out to be a shop.

And with that as the lever, **every material kind is free**: sight-reading,
scales, arpeggios and themes. A mode shown but not usable teaches nobody what the
app is for. `allMaterial` is kept as a mechanism rather than torn out — which
material is free is a pricing question, and the answer has already moved once —
but it currently gates nothing, and the limitation notice knows to stay quiet
about a list that names everything.

### Ruled for the steps that follow

- **Melodic minor is drilled ascending melodic and descending natural**, which is
  how the books print it. Settled on 2026-08-15, before the code that needs it
  exists, because it is a question about music rather than about software.
- **Leaps want reconsidering against the instrument**, not just the difficulty —
  what is plausible on a tuba is not what is plausible on a cornet. It is now the
  answer to two separate things: the interval reading that left with *Random
  notes*, and the open-note margin past a block boundary.
- **The theme corpus needs recategorising and extending**, its labels currently
  reading easier than the generated material of the same name.

## The key on a dial — built, v2.13.0

Asked for by the player on 2026-08-14: the key signature on a dial beside the
stave, turned mid-run the way the tempo is. The third dial in the app and the
same gesture as the other two — `useDial` already carries it, a detent per step
round the circle of fifths.

**The dial takes over from the settings screen, and keeps it.** The player's
ruling, stated plainly: the key chosen in settings is honoured until the dial is
touched, and from that moment the run stays in whatever the dial says until the
dial is moved again. So the settings key is the key a run *opens* in, not a key
it is held to. Nothing needs to remember the old one.

**The change lands on a bar line ahead of the playhead, never at it.** Two
reasons, and the second is the binding one. Musically a key signature belongs at
a bar line, and a player needs to see it before they are asked to play it. And
mechanically the scheduling horizon is already on the audio thread — the same
constraint `changeTempo` works around by appending its step at the next whole
beat past it. The key wants the same rule rounded up to the next bar line, plus
whatever reading room a play-test says it needs.

### The rewrite waits for the hand to come off — but not for the reason it looks like

The player's concern was cost: two hundred bars are pre-written, and sliding
from one flat to two sharps is three detents, which would be three rewrites of
the whole remaining paper in quick succession.

Measured rather than assumed, on this machine, for two hundred bars of medium
sight-reading:

| | |
|---|---|
| generating the paper | ~4ms (1032 notes) |
| engraving the paged layout | ~0.5ms |
| three keys back to back | ~11ms |

So the rewrite is not the expensive thing, and a tablet several times slower
still lands inside a frame or two. **Debouncing on release is right anyway, and
for a musical reason:** a key is a destination, not a path. Passing through Bb
and F on the way to D should not put Bb and F on the page, and a player watching
the notation respell itself twice on the way to somewhere they never chose is
being shown work rather than music. The dial names the key it is pointing at
while it turns; the paper is rewritten when it is let go.

That is the difference between what the rule costs and what it *means* — the
same trap as the hint timing rule in v2.12.0, and worth naming before it is
built rather than after.

### What is already built, and what is genuinely new

**Mid-piece key changes are a solved problem.** `Exercise.keys` is a list of
`KeyChange`s with a `fromBeat`, `keyAt` answers what is in force, and
`signatureChangesIn` and `drawSignatureChange` already engrave a change mid-line
— the key tour generates exactly this shape today. Nothing in the model or the
renderers has to learn anything.

**The new part is splicing a live exercise.** Regenerating the tail past the
change beat and leaving the head alone, while a run is in progress. The hazards,
in the order they will bite:

- **Everything keyed by note index.** `judgements`, `noticed`, the hint state and
  the weak-note stats are all indexed into `exercise.notes`. This is safe *only*
  because the change lands ahead of the playhead: every judged note is below the
  splice point, so indices below it never move. That invariant is the whole
  design and deserves an assertion rather than a comment.
- **`noticed` is sized once, in the constructor.** It has to be resized with the
  note list, and the hints re-measured, exactly as `retime` does for tempo.
- **A key tour ends where the player names their own key.** Ruled on
  2026-08-14. The tour's remaining changes are the score's instruction and the
  dial is the player's — the same split `changeTempo` draws between a written
  step and a turned one — and the dial wins from the moment it is touched. A
  tour is a sequence, and re-entering one partway to a key the player did not
  choose would be the app arguing with the dial.

**A narrow range in a distant key needs no handling at all**, which was worth
checking rather than assuming — the first draft of this section called it a
hazard and it is not one:

- **The candidate pool is chromatic and key-agnostic.** `candidatePitches`
  walks every semitone of the range and keeps whatever the instrument can play;
  it never looks at `fifths`. So *No playable notes in range* cannot be provoked
  by a key at all. It fires only when the range itself holds no playable note,
  which is a settings-screen condition that `sanitiseRange` already guards.
- **The key is a preference, and it already degrades to accidentals.**
  `chooseNext` filters the reachable notes for diatonic-or-chromatic as the
  difficulty's `accidentalChance` asks, then falls straight back to the whole
  reachable set when that filter empties — the same `prefer` discipline used for
  the fingering rules, on the standing rule that *a duller exercise is better
  than none*. A narrow range in a distant key therefore yields notes accidental
  to the key, which is what the player proposed and what the code has always
  done.

What the range *does* still bear on is patterns, and it is the one thing here
left to settle. A scale needs a root with two octaves of headroom inside the
range, and which roots qualify changes with the key — so a dial turned far
enough could leave a scale exercise unable to form its shape, at which point
`patterned` goes false and the material falls back to free notes mid-run. That
is a visible change of material rather than of key. It may also be the right
answer, a scale in a new key being a different scale; it wants the player's eye
before the dial is offered on pattern material.

### Which material the dial applies to

Free material — random notes and sight-reading — is the clear case, and the one
the player had in mind. The others are not all the same:

- **Themes ignore the range entirely** (they return before `candidatePitches` is
  reached) but are stored as scale degrees and are *already* key-agnostic, so a
  key change is the cheapest of all of them here.
- **Patterns use the range** to decide which roots a shape fits from, which is
  the fallback question above.

### What building it turned up

**A key change had never had room made for it on a scrolling line.** Found by
driving the app, not by reading the code. Scrolling music is spaced by how fast
it should travel — a beat is always the same distance — so the double bar and the
new signature were drawn straight over the first bar of the key they announced.
The engraved mode has had an answer since it was written (`signatureRoomAt` feeds
`engraveSpacing`); the scrolling map simply had nowhere to put one.

**It is pre-existing and was reachable before this feature.** Confirmed by
running a key tour with the dial untouched, which collides identically. The dial
did not cause it; it made it happen every time instead of only in a tour.

`xAt` now adds the apparatus's width as a step at each change. What that costs is
one jump, and it lands behind the player: the origin takes the step at the same
instant the music does, so notes ahead of the strike line never move and the bar
just played slides left by the width of the signature. Music behind the strike
line is music already read — the one part of the display that can afford to move,
and cheaper than easing the step in over the preceding beat, which is the surge
uniform spacing exists to prevent.

**It is better and it is not finished.** Driving it again shows the apparatus
clear of the notes at some changes and still tight or overlapping at others,
depending on what the generator put either side of the join — an accidental on the
downbeat note is one known contributor and has room of its own now, but it is not
the only one. Diagnosing the rest wants what the range-stave crop got: measured
glyph extents on a fixed seed, rather than screenshots of randomly seeded runs.
**The paged reading mode is unaffected throughout** — it engraves properly and
always did.

### Left for playing

How far ahead the change should land; whether the reference tone should follow
the key immediately or at the change; and whether an imported part should have
the dial at all — a real part's key is the composer's, and transposing one is a
different act from choosing what to practise in.

## What the model costs

Sized against the code as it stood at v1.

| | Cost | Where the work is |
|---|---|---|
| Ties | Small | A flag on the note, one judging rule, a bezier |
| Triplets | Moderate | Bracket, numeral, beaming |
| Fermata | Small to draw | But see below |
| Key changes | Moderate–high | ~97 references to `fifths` |
| Tempo changes | High risk, low volume | `timeForBeat` — three lines that hold everything up |

**Triplets are already half-built.** Timing works in beats as floating-point
numbers and `timeForBeat` is a single multiplication, so a triplet crotchet at
⅔ of a beat already schedules, judges and spaces correctly. What is missing is
purely notational.

### Ties, as built

The estimate held: a flag on the note, one judging rule, a bezier. What was
decided while building it:

**Ties come from crossing the bar line, and nothing else.** A note that fits
inside its bar can be written as one note and should be. The rhythm generator
therefore runs across the whole exercise rather than a bar at a time, and its
one liberty is letting a note overrun, with the remainder written again on the
downbeat. Both halves have to be real note values, so a tie is never a way of
writing an arbitrary length.

**They arrive at Easy**, and never in a scale or arpeggio — that drill is the
shape and the fingering, and a tie there is a reading problem laid on top of a
different exercise.

They arrived at Medium originally, and were moved down by ruling rather than by
argument: a note held over a bar line is ordinary notation that a player meets
in the second thing they ever read, not a technique to be earned. `tieChance` is
conditional — how often a bar end that *could* be tied over is, rather than a
rate diluted by every position that could never have produced one. Measured
across two hundred sixteen-bar exercises: **one tie every 4.6 bars at Easy,
every 3.0 at Medium, every 2.6 at Hard**, which is the gradient wanted.

The generator needed nothing for the move. `tieChance` was always a number
rather than a level, and the tie test already asked the difficulty what its
chance was instead of naming the levels that had one — so the machinery
followed the ruling without being touched.

**The far end of a tie is not judged, and that is the whole rule.** It is not
sounded either — the synth plays the chain's full length as one note — and it
takes no accidental, no hint and no place in the totals. Judging it would mark
the player correct for holding a fingering they were already holding, which
would inflate both the score and the per-note accuracy that weak-note drilling
and hints read from. It does take its head's *colour*, since one sound should
not be half green.

**A tie broken across a system is the ordinary case, not an edge case** — the
thing exists to cross a bar line, and a system break is a bar line. Each end is
placed independently, against its notehead or against the margin.

`tools/stave-to-svg.mts` renders an exercise to SVG so engraving can be looked
at without a browser. It found the one thing the tests could not: the first
ties drawn were specks, because clearing half a notehead at each end ate most of
a crotchet's column. A tie's tip sits a stave space off the head's centre, where
the ellipse has already narrowed, so it need not clear the full width.

### Triplets, as built

The estimate held: purely notational, and nothing about timing changed, because
everything was already in floating-point beats.

**A triplet is a flag on an ordinary value, not a sixth note value.** A triplet
quaver is a quaver that lasts two thirds of one, drawn with the same notehead,
stem and beam — what marks it is the bracket and the numeral over the group. So
`Duration` gained `tuplet?: 3` and `durationBeats` multiplies by two thirds.
Plain and dotted spellings are still tried first, so nothing writable the
ordinary way sprouts a bracket.

**The bracket is its own grouping, not the beam's.** They look the same in the
easy case and are different questions: a beam asks how notes group, a bracket
asks how the beat divides. Three triplet crotchets are bracketed and never
beamed, and two triplet beats in a row want a numeral each — a run-length rule
swallows both into one bracket over six, which reads as a sextuplet, a different
rhythm. So exactly three to a bracket, and the beams carry on breaking at the
pulse as they always did.

**Thirds are not exact in binary, and that is the only thing here with teeth.**
Three triplet quavers came to 0.9999999999999999 and sixteen bars of them ended
at 15.999999999999995. Nothing sounds different — the error is far below a
millisecond — but every *comparison* is wrong at the boundary, and the
boundaries are bar lines: a note at 11.999999999999998 was drawn in the bar
before its own, and the system it belonged to lost it. `snapBeat` puts every
accumulated position on a twenty-fourth of a crotchet, which every writable
duration sits on exactly — a semiquaver is six, a triplet quaver eight, a dotted
semiquaver nine. Applied once in `assembleExercise`, where every producer meets,
rather than in three generators and hoping.

The engraving snapshots said the change was inert on everything that has no
triplets in it, which is exactly what they are for.

### Groundwork, laid before the dynamic work

Two refactors done together after ties. Both are behaviour-preserving — the 354
tests were green either side — and both were worth doing on their own merits.
They change the costings above.

**Everything asks the clock for seconds now, not for a tempo.** Every use of
`secondsPerBeat` outside the clock turned out to be the same question in
disguise: *how many seconds between these two beats*. A note's own length, the
gap before the next note, the slack a note gets — all of it. So `Transport`
grew `secondsBetween(fromBeat, toBeat)` and the field became
`nominalSecondsPerBeat`, which is now used by exactly one thing.

`toleranceFor` is the clearest case. Its old body was
`0.3 × secondsPerBeat × durationInBeats`, which is `0.3 ×` the note's length in
seconds and never anything else; it now takes that directly. The note in this
document that it "needs the local tempo at the note being judged" was wrong —
it needs no tempo at all, and neither does anything else.

So a tempo map changes the body of `timeForBeat`, `beatForTime` and
`secondsBetween` and nothing else. **The one exception is deliberate**: the
scrolling display multiplies `scrollSpeed` by the *nominal* rate, because how
far a beat travels is a property of the page. Spacing that tracked a varying
tempo would bunch the notes during a rit. and lie about the notation.

**Notes carry their own spelling.** `SpelledPitch` moved onto `NoteEvent`,
settled at generation time for the same reason the fingerings and the
accidental already were: it depends on the key, and the key is something the
generator knows and the renderers should not have to. F sharp and G flat are
the same sound and a different thing to read.

That removes `fifths` from the renderers entirely bar the key signature glyphs
themselves, which is most of what made key changes look expensive. It also
stopped `drawSystem` re-spelling every visible note on every frame.

### The order agreed

Revised from the list at the top of this document once the conductor gave the
tempo map a second customer, and agreed rather than assumed.

1. ~~`secondsBetween`~~ — done
2. ~~The conductor~~ — done, and on screen
3. ~~Spelling onto `NoteEvent`~~ — done
4. ~~**Key changes**~~ — built. The groundwork made them cheaper
   than the tempo map rather than dearer. See *Key changes, in detail*.
5. **Themes, windowed scoring, then endless play** — agreed in that order after
   the tooling work, and ahead of the tempo map because none of the three needs
   it. See *Themes, and playing for as long as you like*.
6. **The tempo map**, behind the three clock functions
7. **The microphone**, which is additive and touches almost nothing else — and
   which settles the one question endless play cannot answer with buttons
8. Fermata — needs the tempo map *and* a change to the transport's contract

**Fermata is not a tempo problem, and grouping the two will mislead.** A tempo
map is known in advance: closed form, schedulable, testable. A fermata's
release is not — it comes when the conductor releases or the microphone hears
you stop. But `Transport.tick` marches `scheduledUntilBeat` forward over a
150ms horizon and the session pushes notes onto the audio thread before they
sound, so **nothing can be scheduled past a hold of unknown length**. The
transport has to stop advancing its horizon at the fermata and resume on
release. That is a change to its contract, not to its arithmetic, and it is the
one item here that touches the invariant this document calls the fault a rhythm
trainer cannot have.

**Key changes rippled, and now do not.** That estimate was made before spelling
moved onto the note. The renderers no longer see `fifths` at all bar the key
signature glyphs, so most of those references have gone. See *Key changes, in
detail*.

**Tempo changes are the risk.** `timeForBeat` is the foundation of scheduling,
judging and the render loop, and a bug there desynchronises sound from notation
— the one fault a rhythm trainer cannot have. The volume of code is small; the
tests should be brutal. Since the groundwork below, the whole of that risk sits
in three functions and nothing outside the clock has to change.

## Key changes, in detail

**Built.** What follows is the design as it was agreed; the notes below record
where it landed differently, and what the building of it turned up.

**A set of keys, ordered by the generator.** The key picker still chooses what
the exercise opens in; a set of chips beside it says which keys are in play, up
to four. `orderByCloseness` puts them in an order that steps around the circle
rather than jumping, ties going to the flat side. Changes are spread evenly, at
least four bars apart, and a set too large for the exercise simply uses fewer of
its keys rather than hurrying.

**Patterns change key only between cycles**, and each cycle is rebuilt on its
own tonic — a scale in B flat is a different set of notes, not the same shape
under a new signature. This is what pattern cycles were for: a cycle boundary
is a bar line, so a change never lands mid-scale.

*Refined in v1.27.0.* A cycle boundary is padded out to a bar line **where
the key moves across it**, which is all the padding was ever for. Where the
key holds, cycles run straight on: a rest in the middle of a scale is a gap
in the scale, and two cycles of an octave are twenty-eight crotchets, which
is seven bars of four-four exactly. The closing tonic is then held out to the
last bar line rather than played short and rested after, as the second-time
bar of any method book's scale is — so a pattern now contains no rests at
all. Patterns are also fixed in **four-four** whatever signature is set: a
scale is a shape played against a click, not a piece with a metre, and the
player's own choice is untouched and returns with the next material that has
one.

**Two things worth knowing that are not obvious from the code.**

- *`Candidate.diatonic` had to go.* It was computed once for the whole exercise,
  and is the assumption key changes break most quietly: everything still
  generates, and every accidental after the first change is reckoned against the
  wrong key. It is now `diatonicIn(midi, fifths)`, memoised per key.
- *A pattern's key changes are read back off its cycles rather than planned.*
  Planning them separately let the two disagree about which key a cycle was in,
  and the notes would then be laid out to the wrong shape. Only free material
  plans its changes.

**`assignAccidentals` needed no new trigger.** It already resets per bar, and a
change always lands on a bar line, so the old key's accidentals are cleared
before the new key ever sees them. Ties needed nothing either: a tie's tail
clones its head and is skipped outright, which is exactly right across a change,
since one sound continuing takes no accidental. Both have tests saying so.

The original design follows, and still holds.

### What a real part does

`Pendennis!` (Goff Richards, Eb bass part) has **seven key changes in 165
bars**, several of them **mid-system**. So the expensive case is required, not
optional. It is 2/4 throughout — not one change of metre — which is why metre
changes are not urgent even though the machinery is shared.

### The symbology, agreed against that part

**Double bar line, then the naturals cancelling the outgoing key, then the new
signature.** Four cases, and the cancellation differs in each:

- **Sharps to flats, or flats to sharps** — cancel everything, then state the new
  key in full.
- **Fewer of the same sign** — cancel only the surplus accidentals. (Some modern
  engravers drop this and print the new signature alone; the 1997 Obrasso plate
  uses the cancellation, so that is what was chosen.)
- **Into C major** — nothing to state, so the naturals are the whole message.
  The one case where a key change is *only* a cancellation, and the easiest to
  miss at speed.

Cancelling naturals go **in the positions the old accidentals occupied**, which
is what makes them read as "these are no longer sharp" rather than as a row of
unrelated naturals. `SIGNATURE_OCTAVES` in `stave.ts` already holds those
positions.

**Paged reading keeps the cautionary**: the incoming signature printed at the
right-hand end of the system *before* the change, as the part does.

**Scrolling reading does not, and must not.** The cautionary exists because on
paper a change arrives without warning. Scrolling music has no such problem —
the change slides toward you from the right, in view for seconds. So: draw the
change inline where it falls, and let the fixed clef-and-key panel take the new
signature as the change crosses the strike line.

A mockup drawn with the app's own glyphs is reproducible from
`tools/svg-context.mts`; the drawing needs `drawKeySignature`, `drawBarLine` and
`accidentalNatural`, all of which exist.

### The model

`Exercise.fifths: number` becomes a list of `{ fromBeat, fifths }` with a
`keyAt(beat)` helper — the same shape as `metre.ts`, and deliberately so. Build
the "what is in force at beat b" mechanism once and let both metre and key ride
on it, or the same surgery gets done twice.

### What is already paid for

- **Spelling is on the note**, settled at generation time. The generator spells
  with the key in force at that beat and nothing downstream needs to know.
- **`showAccidental` is on the note** too, decided against the key and against
  what has already happened in the bar.
- **`barAt`** exists, so bar arithmetic is not scattered.

### What still costs

- **`measureStaveHeader` feeds `headerWidth`, which feeds `strikeX`, which feeds
  the whole scrolling layout**, and it is computed once in `layout()`. Paged
  reading needs it per system. Scrolling is the harder one: the header there is
  a fixed opaque panel the music slides *under*.
- **A mid-system change needs room reserved.** `spacing.ts` `columnBeats` needs a
  column at the change beat, and `extraWidthFor` an allowance — it currently
  knows only about accidentals and dots.
- **Accidentals across a change.** A tie continuation crossing a key change
  carries its own sounding pitch; a note repeating a pitch after a change wants
  a cautionary. The existing rule in `assignAccidentals` resets per bar, which is
  the right shape to extend.

## Themes, and playing for as long as you like

Designed, not built. Agreed in discussion, and written down before any of it is
started because the first decision below is the kind that is expensive to
reverse once code leans on it.

**The complaint.** Sight-reading material is a random walk — `phrasePitches`,
mostly stepwise with a sense of direction that turns over every few notes. It
is better than the free material it shares a path with, and it is still not
*music*: what makes a line readable as music is repetition, an answering
phrase, and a cadence, and a walk cannot produce any of the three. A player
sight-reading real music is reading shapes they half recognise. That is the
skill, and nothing here trains it.

**The shape of the answer.** A corpus of short themes, 8–24 bars, stored as
scale degrees rather than pitches, stitched end to end for as long as someone
wants to play. Three separable features, and they are worth keeping separate —
one is free, one is small, and one touches the invariant this document is most
careful about.

### What a theme is

**Degrees, not pitches.** A theme is a contour in scale degrees with an
optional chromatic alteration and an octave offset, plus a rhythm in beats. It
is therefore agnostic of key in the absolute sense while still able to carry a
*relative* change — "up a fourth at bar 9" — and the generator spells it into
whatever key is in force, exactly as it already spells everything else.

This is not a new idea in this codebase, and that is the point: patterns are
already generated the opposite way round from free material, contour first with
the rhythm built to hold it. **A theme takes the pattern path, not the
free-material path.** `patternContour` and `patternSlots` are the shape to
follow, and `isPattern` is the switch that decides which way round generation
runs. A theme is a pattern whose contour was authored rather than computed.

What the format has to carry:

| | |
|---|---|
| Contour | Degree 1–7, alteration, octave offset. Rests too — a phrase that never breathes is not a phrase. |
| Rhythm | Beats, and ties across bar lines where they belong. |
| Metre | Which metres the theme is legal in. A tune in three is not a tune in four. |
| Relative key change | Bar number and a delta in fifths. Lands on a bar line by construction, which is the rule everything downstream leans on. |
| Relative tempo change | Carried, and **inert** until the tempo map exists. Data may be richer than the engine; it must not lie about it. |
| Difficulty | Which of the five levels the theme belongs to. |

**Every theme starts and ends on a stable degree** — 1, 3 or 5 — so any two can
abut without the join sounding like a mistake. That is a constraint on
authoring rather than something to fix up at stitch time.

Those three are the notes of the tonic chord, which is why any of them will do:
a theme opening on one of them lands on the key rather than away from it, and
the ear knows where it is at once. The tonic alone was considered and is not
wanted — every theme opening on the same note would make the joins predictable
and the corpus samey, and the thing a join must avoid is sounding *wrong*, not
sounding varied. The consequence is register rather than harmony: a theme
opening on the fifth begins a fifth higher up the stave, while its tonic still
sits in the window where it was placed.

**Range is checked, not assumed.** A theme is a fixed shape and an Eb bass in
treble clef has a different compass from a cornet. The machinery exists: a
pattern that will not fit the instrument is not a pattern and falls back to free
material. A theme that will not fit is skipped for that instrument, and the
corpus needs enough themes that skipping some still leaves a choice.

### What the first five turned up

**Built**: the format, the validator, five hand-written themes across the five
difficulties, and `exerciseFromTheme`, which takes one from degrees to a drawn
and playable stave. Not built: choosing themes and stitching them, which is the
next piece.

Two things were found by rendering them and looking, and neither would have been
caught by a test written beforehand.

**A key change has to rebuild the tune on the new tonic.** The first version
kept every degree rooted on the key the theme opened in and merely changed the
signature — which is precisely what this document already says a pattern must
not do, and it showed up as a line full of accidentals cancelling a signature
that was never true. Degrees are now read against the key in force where they
fall, which is the same rule the rest of the app follows.

**Where the new tonic goes is a separate question, and the obvious answer is
wrong.** Honouring the direction the delta names — "up a fifth" really lifting
by a fifth — moves a section bodily, which widens the whole theme's span by that
interval. Since a theme is then placed to centre what it spans, everything
*before* the change gets dragged down to make room: on an Eb bass the first six
bars went two ledger lines below the stave to buy a lift in the last six. Each
new tonic therefore goes as near the last as its pitch class allows, so the tune
stays in the register the player is in and the key moves underneath it, which is
what a modulating part actually does. A theme that wants a change of register
can say so per note.

`npm run svg -- --theme list` names them; `--theme <id> --fifths 2` draws one in
any key. Two are pinned by the engraving snapshots: the plainest, and the
modulating one, since that is where both faults were.

**Where a theme sits is settled, and it is the tonic that is placed.** A ruling
from playing rather than from arithmetic: centring whatever a theme happens to
span puts the same tune somewhere different in every key. The tonic is what a
player feels the music sitting on, so the tonic goes in a window — written
pitch, an octave from just below the stave to just inside it. On a treble-clef
tuba part that is low G up to the G the clef curls around; on everything else in
treble it is the ledger C up to the C in the stave; bass clef is the same octave
where that clef puts it. Outside the window is a fallback rather than a failure,
for a theme too wide to sit there.

### Themes are their own mode, measured in themes

**Built.** *Themes* is a material kind beside Random notes, Scales, Arpeggios
and Sight-reading — not a replacement for sight-reading, which keeps the random
walk it always had.

They were wired into sight-reading first and the join never sat right. A theme
is a fixed length, so asking for twelve bars of them asks for one and a half of
something written to be played whole, and any answer to that is a fudge: stop
short and the phrase is cut off, overshoot and the length setting is a
suggestion. **Kept apart, each mode is measured in the unit it actually has** —
bars of generated material, or whole themes — and neither has to apologise for
the other. Length is a count, exactly as a pattern is measured in cycles, with
its own `themeCount` rather than borrowing `cycles`: a theme is not played twice
over, the next one is a different tune, and calling both the same thing is how a
numerator ends up mistaken for a bar length.

How many bars that comes to is a consequence rather than a target, and that is
**agreed rather than tolerated**: three themes is twenty-eight bars where one of
them is twelve, and an approximate bar count is the right price for whole
phrases. The alternative — standardising the corpus on eight bars so that four
themes always means thirty-two — was considered and rejected. A page of nothing
but eight-bar phrases teaches a reader to expect the break rather than read for
it, and expecting the break is the habit sight-reading is supposed to break.

So the corpus should **vary its lengths on purpose**. Eight bars is the usual
shape and twelve is worth having; the point is that a reader cannot count on
either.

**A key change lands where one theme ends and the next begins, and nowhere
else.** The set is dealt across the themes in contiguous blocks, exactly as a
pattern deals its keys across cycles, so a key is finished with before the next
is taken up and a set too large simply uses fewer of its keys. Changing key
inside a tune that was not written to do so is a signature laid over somebody
else's phrase.

**A variation set answers a kind of sameness that more themes cannot** — every
theme being a different eight bars is its own monotony, since nothing ever comes
back. One tune was therefore written five times, plainer or more decorated, one
at each difficulty. **Four of the five were then binned**, and the reason is the
useful part: the same melody at *every* level is its own monotony too. A player
who meets Twinkle at Beginner, Easy, Medium, Hard and Expert has met one tune
five times, which is the sameness the set was meant to cure rather than a cure
for it.

So the rule that came out of it: **one or two treatments of a tune, at levels
far enough apart to be different music.** Three survive here — the tune dotted
at Medium, and two figuration variations at Hard — and they were kept while the
plain, filled, running and flourished versions went.

The tune is *Ah! vous dirai-je, maman*, French, about 1761, which Mozart wrote
variations on rather than writing — both long out of copyright, worth stating in
a corpus meant to be sold.

It also turned up something no argument would have. **A perfect fifth is seven
semitones, and Beginner leaps four while Easy leaps five** — so the best-known
tune in the language cannot be tagged below Medium. Those caps were set for a
random walk, where a fifth between unrelated notes really is hard; inside a tune
that a player already knows, it is the easiest interval there is. Rather than
loosen a number that the generated material depends on, the two lower variations
do what variations are for: the fifth is arpeggiated at Beginner and walked up
in quavers at Easy. Expect this to recur with any real tune — the ladder
measures difficulty as a random walk experiences it, and a theme is not a random
walk.

**A figuration variation keeps one melody note a bar and arpeggiates round it**,
which is what Mozart's variations do to this tune and what `twinkle-centred` and
`twinkle-figured` do here. They exist as a pair because the obvious rule and the
right one differ: taking the triad *centred* on the melody note — a third below,
a third above — is tidy and puts the note inside its own chord, but the triad it
lands on is not always the chord the bar is in. On the melody's fifth it gives
the mediant where the tune wants the tonic. Arpeggiating the bar's actual
harmony is less tidy as a rule and is what the music is doing anyway. Both are
kept so the difference can be heard rather than argued.

**Every difficulty now has themes in every metre the app offers** — 2/4, 3/4 and
4/4 — so the fallback below no longer fires for anything a player can actually
choose. 2/4 had nothing at all before this and is the metre most brass band
music is in.

**Syncopation is the drill from Medium up**, and in 2/4 especially: a quaver,
then a crotchet straddling beat two, then a quaver. It is read wrong far more
often than a wide leap is, and no amount of stepwise practice prepares anyone
for it. Worth writing several bars of it in a row — one bar of syncopation
reads as a misprint.

**Triplets are built** — see *Triplets, as built* — and seven themes use them,
spread across the metres rather than piled into 4/4: a hymn tune at Easy, which
is where a player actually meets their first; crotchet triplets at Medium in
both 4/4 and 3/4; quaver triplets at Hard in 4/4 and 2/4; and at Expert both
against semiquavers, so the division of the beat moves under the reader from
four to three and back.

A triplet reads differently for how much bar is left around it. Two beats of a
3/4 bar leaves one, and that single plain beat is the only thing telling a
reader where they are; two beats of a 4/4 bar leaves two, which is room to
recover; and a beat of triplets in 2/4 is half the bar gone before the counting
has caught up.

**Where a triplet is legal falls out of the rhythm ladder** rather than being
decided separately. A difficulty may not go shorter than its own shortest note,
so a triplet crotchet at two thirds of a beat is legal from Easy up and a
triplet quaver at one third only from Hard, where semiquavers already are. That
gradient is about right by accident: the crotchet triplet is the one a player
meets first, in hymn tunes, and the quaver triplet at speed is a different
animal.

**Generated material still has none, and cannot yet.** The rhythm pools in
`difficulty.ts` hold plain and dotted values, and a triplet cannot simply be
added to one: they come in threes, and a generator that picks a single triplet
quaver leaves a third of a beat that nothing writable can fill. Emitting them in
complete groups is a change to `generateRhythm` and its own piece of work — so
sight-reading, which is the random walk, will not show a triplet however long
anyone looks.

**There is one theme the app cannot select.** `six-eight-lilt` is in 6/8, and
`TIME_SIGNATURES` offers 4/4, 3/4 and 2/4 only — compound time is a future step,
noted under *How the patterns are built*, and the conductor already has the
patterns for it. The theme is written ahead of the app rather than orphaned, but
it is worth knowing it sits there unreachable.

**Every difficulty now has themes in 4/4** — three or four apiece, eighteen in
the corpus — so the fallback below no longer fires for the metre almost
everything is played in. 3/4 and 6/8 have one theme each and still fall back.

**It falls back to generated material** where the corpus has nothing for a
difficulty or metre — the same shape as a pattern that will not fit an
instrument, and the ordinary case while the corpus is small. That fallback is
silent, which is the one dishonest edge in this feature: a player choosing
Themes at a difficulty with none written gets a random walk and nothing says so.
It wants the same treatment as the gated settings screen — say what is not
there rather than substituting quietly.

**Themes are a paid kind.** `FREE_TIER.kinds` is random and scales, so nothing
new leaks into the free tier by having been added.

**The corpus is published**, at `spike/themes.html` on the deployed site — a
summary of what exists by difficulty and metre, an index of every theme, and a
click to see one engraved and *hear* it. From a phone, with nothing to run.

Three things it is for. The summary says where the gaps are, since a dash is a
difficulty and metre the app silently falls back to a random walk in. The index
says what each theme contains — rests, ties, accidentals, semiquavers, a key
change — so a reader can go to what they want to judge. And each theme can be marked *keep* or *bin*, or moved to another
difficulty, remembered in the browser and copied out as a list — because a
corpus is edited by a player's ear and there has to be a way to say so.

The move is answered on the spot. Every theme is validated against *every*
difficulty when the page is built, so suggesting a level says at once whether
the rules allow it and why not: "easy takes no ties", "is no harder than
beginner". **The suggestion is recorded either way.** The rules describe
difficulty as a random walk meets it, and a player is the better authority — an
objection is information rather than a veto, and the answer is sometimes to
change the tune rather than the tag. `dotted-conversation` is the case that
proved it: a player said it read as Easy, the page answered that one tie pinned
it to Medium, and the answer turned out to be that ties belong at Easy. Two
themes moved down as a result — that tie was the only thing either of them had
that Easy did not.

Playback is a few lines of WebAudio rather than the app's sampled instruments,
which are two megabytes and belong to the app. It sounds the **written** pitch:
an Eb bass part sounds two octaves and a sixth below where it is written, which
on a laptop is felt rather than heard, and the written pitch is what a reader
hums off the page. It is generated rather than
written, committed rather than built, and a test holds it to what the generator
produces right now: a static page of a moving corpus is exactly the thing that
goes stale, which `tools/` did for four releases while every test passed. If
that test fails, regenerate with `npm run themes -- --publish` rather than
editing the page, which is output and not source.

**How to review what gets written.** `npm run themes` draws the whole corpus on
one page, grouped by difficulty, with the validator's complaints printed under
each theme and an empty difficulty named rather than skipped. `--difficulty
medium`, `--fifths 2` and `--instrument cornet` narrow it. That is for seeing
whether a theme is *correct*; `?theme=<id>` on the running app plays one and
nothing else, which is the only way to find out whether it is any *good*. The
same shape of hook as `?tier=free`, and as forgiving — an id naming nothing
falls through to the ordinary exercise.

**A difficulty tag is a claim, and checking only its ceilings was half a
check.** The first corpus passed every test and a player read it and said the
hardest of it felt like the middle of the range — correctly, because every rule
was an upper bound, so a theme of plain crotchets sailed through at Expert. The
validator now checks floors as well:

- **A theme must be harder than the level below it** in at least one respect —
  a shorter note, a wider leap, a bigger span, or an accidental, rest or tie
  that level forbids. Which respect is left open on purpose: a tune earns Hard
  by leaping, or by moving faster, or by its range, and demanding all three
  would describe one tune rather than a level.
- **And it must move at the pace of its level.** The rhythm pool's *longest*
  value says how fast a level goes — Expert holds nothing longer than a quaver,
  which is what "relentless semiquavers" in its own blurb means. Measured as a
  median rather than a maximum, so a theme may still end on a long note; a
  cadence needs one, and a level is set by how a tune moves rather than by how
  it stops.

Four themes failed the moment those went in and were re-tagged downwards. The
lesson is worth keeping: **an unchecked tag drifts in whichever direction is
easiest to write**, and easy is easier to write than hard.

**A difficulty tag is also a ceiling.** `difficulty.ts` already
states the numbers for generated material, and a theme is now held to the same
ones: nothing shorter than that difficulty's shortest note, no accidental where
the chance is zero, no rest, no tie, no leap beyond its `maxInterval`, no span
beyond its `rangeSemitones`. A theme labelled Beginner with a leap of a tenth is
worse than no theme, because a player meeting it has been told it is within
reach. Note *values* are deliberately not checked against the pool — that says
what the generator draws from, and a dotted minim is plainly fine for a beginner
without appearing in it.

**The corpus is injectable, and that is not gold-plating.** Selection is where
the rules are — do not repeat, carry the key on, skip what will not fit — and
with one theme per difficulty none of them has anything to choose between. The
tests supply a corpus of two so the rules are exercised rather than asserted.
Rendering 24 bars at Medium today draws the same eight bars three times, which
is not a fault in the stitching but the corpus doing what a corpus of one must.
**Coverage is the next thing this needs**: several themes per difficulty in at
least one metre, so that a session does not repeat itself.

### Where the themes come from

**Authored offline, committed as data.** A model writes them, a tool validates
them, and what ships is a file. Generating at runtime would mean a network
request, and this app makes none — that is a commercial asset as much as a
technical one, and it is not being spent on this.

Three things the pipeline needs, none of them optional:

- **A validator.** A model will produce plausible JSON with bars that do not add
  up and degrees outside any compass. `metre.ts` can check bar lengths
  mechanically. Anything that fails is discarded rather than debugged — the
  corpus is cheap to regenerate and a theme is not worth arguing with.
- **An eye.** Every theme rendered through `npm run svg` and looked at, and the
  corpus pinned by the engraving snapshots. A corpus is exactly the kind of
  thing that is wrong in ways a test cannot see.
- **A copyright pass.** A model asked for a melody can return a real one, and
  the intention is to sell this. Ask for abstract degree sequences rather than
  music in the style of anyone, and check the result against well-known
  incipits. Cheap now; not cheap after distribution.

**The format is the durable artefact, not the model.** If what comes back is
disappointing, twenty hand-authored themes in the same format still ship the
feature. Nothing downstream knows or cares which wrote them.

Coverage sizes the work honestly: five difficulties against three metres, with
enough themes at each that a session does not repeat itself. That is the real
cost of this feature, and it is authoring rather than engineering.

### Playing for as long as you like

The idea: past the length the player chose, the music carries on in grey. Stop
at the end of the white and the session ends. Play on into the grey and it turns
white, with fresh grey beyond it, for as long as they like.

**Do not let `Exercise` grow.** This is the decision worth not reversing.
`totalBeats` is load-bearing in more places than is obvious — the session's end
condition, the metronome loop, the system layout, and `noticed`, which is sized
from the note count at construction. Worse, a growing note list puts a second
moving part inside the transport's rolling horizon, and that is the invariant
the fermata note already says cannot take one: nothing can be scheduled past a
hold of unknown length.

**So pre-generate long and reveal progressively.** Generate to a generous cap —
200 bars is around eight minutes of continuous playing — and make white against
grey a matter of drawing and scoring alone. The exercise stays a closed value,
everything downstream keeps the assumption it already makes, and the same seed
still renders the same bytes, which is what the engraving snapshots are built
on. An upheaval becomes a colour rule and an end condition.

**Grey is not a new rendering path.** `colourFor` is already asked per note, and
`revealByBar` already proves a colour can be withheld on a rule. Grey is one
more state in a function that exists.

### The hard part: stopped, or resting?

With buttons, silence is ambiguous. Resting, missing a passage badly, and
putting the instrument down all look identical, and a theme that opens with a
rest would end the session under a naive rule.

Something like *no input during a whole bar that contains notes* is the shape of
it, and it has to survive a player who fluffs four bars and carries on. This
wants deciding against a real instrument rather than reasoned about, which is
the sort of question this project has settled by playing before.

**The microphone answers this properly**, which is worth knowing before anyone
builds an elaborate heuristic: it can hear that you have stopped. The rule
written now should be the simplest one that works, on the understanding that it
is replaced rather than refined.

### What the score covers

The score reports the last so many bars rather than everything played, which is
what makes an endless session meaningful.

**One distinction to keep.** Score the *window*, but record weak-note stats for
the *whole* session. Weak-note drilling is the feature that improves the longer
it is used; throwing away everything outside the window would work against the
one thing that gets better with time. `summarise` already takes the judgements
it is given, so the window is a filter at the call site rather than surgery.

**An open decision, and the only one that changes what gets built.** Blocks or a
rolling window. Blocks are what was proposed: the grey promotes itself a block
at a time, and finishing one is a moment. A rolling window is simpler — the
session has no end, only a scored window of the last so many bars, and grey
merely marks where that window begins. Both land in the same place for the
player. The recommendation is the rolling window, on simplicity; the argument
against is that "you have completed one" is motivating and the results screen is
built around it.

## The tempo map

With tempo varying linearly across a span, both directions are closed form. No
numeric integration, no accumulated drift, and the inverse is a real inverse
rather than a search — which matters, because the render loop needs time → beat
sixty times a second while the scheduler needs beat → time.

Where `bpm(b) = m·b + c`:

```
t(b) = t₀ + (60/m)·ln((m·b + c) / (m·b₀ + c))
b(t) = ((m·b₀ + c)·e^(m(t−t₀)/60) − c) / m
```

`m = 0` degenerates to the constant-tempo case and needs guarding.

### The seam is already cut

**Change `timeForBeat`, `beatForTime` and `secondsBetween` in `clock.ts`, and
nothing else.** Every caller already asks in a form that survives: not "what is
the tempo" but "how many seconds between these two beats". `toleranceFor` takes
a note's length in seconds, `hints.ts` takes a `secondsBetween` function, the
session gets a note's sounding length from the transport.

Three things to get right:

- **The map must be total over negative beats.** The count-in sits there.
- **It must be anchored so a change only ever affects the future.** `setTempo`
  throws while the transport is running for exactly this reason: the beat/time
  map is linear from a single origin, and changing its slope retroactively moves
  every note already scheduled. The closed forms above have `t₀`/`b₀` for this.
- **`nominalSecondsPerBeat` stays a scalar and stays used by one caller** — the
  scrolling display. How far a beat travels is a property of the page; spacing
  that tracked a varying tempo would bunch the notes during a rit.

**The conductor needs nothing.** It reads `visualBeat()`, so it slows down with
the music including the acceleration into each ictus.

### What a tempo map changes elsewhere

- **Paged reading is unaffected.** Its spacing was deliberately decoupled from
  tempo in v1 — room follows the notes, not the clock.
- **Scrolling has to speed up and slow down.** Spacing stays fixed and the music
  physically moves faster, because it *is* going faster. Varying the spacing
  instead, to hold pixels-per-second constant, would make notes visibly bunch
  during a rit. and lie about the notation. So `scrollSpeed` becomes "pixels per
  second at the nominal tempo".
- `toleranceFor` needs the local tempo at the note being judged, not a global
  one.

## The on-screen conductor — built

Shipped in v1.2.0. A setting beside the metronome, **off by default**, top right
in portrait beside the notes already played, hidden in landscape. Geometry in
`src/render/conductor.ts`; `public/spike/conductor.html` stays as the place to
argue about shapes, with sliders the app does not expose.

Originally spiked on 2026-08-08 against an Eb bass: the beat reads from a bare
moving dot, and **a rit. can be followed** by dragging the tempo. That second
one was the doubtful question and the reason for building a spike at all.

### Still open on it

- **The gesture is scaled to fill its panel, so absolute size cannot be shown.**
  `extentOf` is measured per shape and the draw loop fits it to the box, which
  means a uniformly smaller gesture draws at exactly the same size — halving the
  geometry gives 190×88px, as does leaving it alone. Relative *proportion*
  survives, because the panel takes the gesture's aspect ratio; magnitude does
  not. This blocks anything that wants to say "smaller", and it is the first
  thing to fix if either idea below is taken up: the panel would need one
  reference scale, fitted to the largest gesture the settings can produce, with
  everything else drawn against it.

- **Size should probably fall as the tempo rises**, raised by the player: there
  is a maximum speed a hand can move at, and a conductor beating 160 does not
  make the excursion they make at 60. The geometry is a pure function of style
  today; it would become a function of style *and* tempo, which `patternFor`
  already takes. Blocked on the fixed scale above — without it the panel would
  simply re-inflate whatever was taken away.

- **The pattern depends on tempo, and the one pattern is built.** A very fast
  2/4, 3/4 or 3/8 stops being beaten in its pulses at all: the bar becomes a
  single gesture, straight down onto the ictus, a narrow hook, and straight back
  up. `BEAT_IN_FEWER_ABOVE_BPM` is 168 and a guess until played. Four is excluded
  — a quick common time goes to *two*, which is a different shape and is not
  drawn — and compound is excluded, 6/8 in two being already what a fast one
  wants.

  Two things it taught. The hook has to be a hairpin rather than a leaf, which
  takes six via points: with one up each side the spline bows out and the widest
  part of the gesture lands half way up, where the reference has the sides
  parallel and all the separation at the turn. And it is the first shape whose
  proportions a panel cannot use — a twenty-fifth as wide as it is tall, which
  asked for literally gives a five-pixel sliver beside the note list. Hence
  `panelAspect`, which clamps; the test says *which* patterns need the clamp
  rather than merely that clamping works.

  A fast **four** is halved rather than taken to one: alla breve, which the
  player ruled takes the ordinary two pattern — the same double J a 2/4 uses —
  rather than wanting a shape of its own.

  **The pattern follows a step and not a ramp**, which is one distinction and
  not two rules. A join moving the music from 150 to 190 is a genuinely new
  speed and a conductor beats it differently, so the gesture changes with it; a
  rit passing through a threshold on its way somewhere must not reorganise the
  hand mid-bend, which is unfollowable exactly where following matters most and
  would flick back a bar later. `steppedTempoAt` in `domain/tempo.ts` draws the
  line, answering what speed has been *declared* rather than what the clock is
  doing this instant. One threshold serves both, and the
  arithmetic falls out: above it a 2/4 and a 4/4 each give a gesture every two
  crotchets, a 3/4 one every three. `placeInPattern` needed nothing, deriving
  the positions from the bar rather than the pulse, so two gestures across four
  crotchets land on the minims without being told to.

- **Five and seven patterns** are drawn on the reference sheet in `input/` and can
  be added from it. Until then those metres get no conductor.

- **9/8 and 12/8 have no subdivided pattern**, so they keep their fast shape at
  any tempo. Nine and twelve are drawn in the compound chapter.

**The reason it is worth building**: a click tells you where the beat *is*; a
conductor tells you where it is going to be. Players who only practise to a
click get led by the beat rather than anticipating it. And a metronome cannot
teach you to follow a rit. by definition, so a conductor with a tempo map is the
only way to practise the hardest ensemble skill there is.

**The thing that decides whether it works: the ictus is carried by
acceleration, not position.** A conductor's hand speeds up into the beat and
slows after it, and that change of speed is the whole information. Animated at
constant speed round the pattern, the beat is invisible and the feature is worse
than nothing.

**It needs no tempo logic of its own.** Hand position is a pure function of
beat, read from `visualBeat()`. When beats arrive slower the hand moves slower,
including the acceleration into each ictus.

**Where it cannot go**: landscape on a phone. The stave there is sized by the
height and a conductor above the music comes straight out of the notation.
Portrait and tablets have the room.

**Keep the metronome.** Not either/or — watch the stick while hearing the click,
then turn the click off. That is how you would teach it to a person.

**What the spike measured, and then had to unlearn.** The first model drew
straight lines between the beat points and subtracted a parabola, and the
measurement was the ratio of speed at the ictus to speed between beats — 3.2x
with linear sideways travel, 1.9x if the sideways travel was eased. Both the
model and the measurement were later replaced; see *How the patterns are built*
below. Two things from that round survived and are worth keeping:

- Easing the sideways travel makes horizontal speed peak *between* beats and
  cancels the vertical whip. Whatever the model, the sideways motion must not be
  eased independently of the vertical.
- A figure reported on screen beats an impression. Every change since has been
  argued with a number beside it.

**The rebound depth is the legato-to-marcato axis, and it should stay
configurable.** A conductor beating a lyrical phrase uses a smooth continuous
gesture with little rebound; one driving a march gives a sharp ictus and lets
the hand stop between beats. Both are correct conducting, and the user described
the default as "a lively conductor" — so the setting is named in those terms
rather than in numbers.

It is also a **difficulty axis**, which is the part worth building on: a smooth
conductor is genuinely harder to follow, and learning to find the beat in a
vague gesture is a real skill that no metronome can teach. And it could vary
through a piece, since a real conductor changes style with the music — an
obvious thing for imported music to carry, alongside the tempo marks.

One caution: there is a floor below which the gesture stops being vague and
starts carrying no information at all. The measured ratio is the guide, and the
app should not let the slider go below whatever proves unreadable.

**What this does to the order.** The tempo map now has two customers rather than
one — the conductor needs it as much as imported music does, and it is what
makes a fermata practisable. There is a case for moving it ahead of key
changes.

## How the patterns are built

Arrived at over several rounds of comparing the drawn shape against conducting
diagrams and against Lesley Mann's *Music in Motion* (Belmont University,
CC-BY), a copy of which is in `input/conducting`. Written down because almost
every step of it was got wrong first, and the wrong versions all looked
plausible.

### Reading a diagram into a pattern

**Mirror it.** Every conducting diagram ever published is drawn from the
conductor's own point of view — four beats are down, to *their* left, to *their*
right, up. The player stands in front of them, so all of it arrives reversed.
Getting this backwards is invisible while you are only checking whether the beat
can be found, and wrong every time afterwards. It was wrong in the three pattern
for several rounds without anyone noticing.

**Key the pattern by pulses, never by the numerator.** 6/8 is beaten in two,
9/8 in three, 12/8 in four, and Mann's own sheet says so outright: 6/8 is "the
same pattern as 2/4 but with a triplet feel". `metre.ts` already computes
`pulsesPerBar`, and that is the index. This is also why compound time needs no
new patterns at all.

**Structural roles come first.** Mann: the cycle "begins with a characteristic
downward movement of the arm, the downbeat, and ends with an upward movement, or
the upbeat. If there are more than two beats in the meter, then additional
horizontal movements are added." So a two pattern is down and up with no
horizontal beat at all; a three adds one sideways; a four adds two. Place the
beats to that rule before fiddling with any curve.

**The floor is not universal.** The four pattern really does put all four
ictuses on one level. The two and the three lift their final beat above it — the
upbeat sits higher. Generalising the four's flat floor to the others flattened
the two into a plain dome and had to be undone.

**The last apex sits above the downbeat, not between the beats.** Mann's "the
final rebound must return to the starting point of the downbeat" is geometry,
not size: the starting point of a downbeat is the top of its own descent, which
is directly above where it lands. The hand sweeps up and across from the last
beat and then drops *straight*. Placing that apex at the midpoint made the
descent a diagonal and cost every pattern its most recognisable stroke.

**Some strokes need explicit via points.** The default — one apex per stroke —
cannot draw the two pattern, whose hand sweeps *past* beat two, reverses, and
comes back so the second hook curls the opposite way. One turning point out
beyond beat two drags beat one's tangent diagonal and destroys its hook instead.
So a stroke may carry its own list of points, threaded onto the same curve.

### The three parts of a beat

Mann again, and all three are worth naming separately because they are
separately adjustable:

- **The ictus** is "the change in direction that is interpreted by an ensemble
  as the actual beat", seen at the tip of the baton. Not a speed maximum, not a
  position. Scoring patterns by speed instead quietly rewarded long lazy loops
  and steered the design wrong for several rounds.
- **The rebound** is the movement immediately after, "typically one-third to
  one-half the size of the ictus" — except the final beat of the bar, which is
  large because it has to get back up to the downbeat's starting point.
- **The prep** is "essentially the rebound of the prior beat". One movement
  named twice, so it is stored once: each beat carries a single `rebound` and
  the arrival is the tail of the previous beat's.

That last point is what makes the final-beat rule automatic rather than
hand-maintained, and the two had drifted 12–22% apart while both were tuned by
eye.

The one-third-to-one-half ratio is checked by an audit script rather than
trusted. Two beats currently sit outside it — the beat before the long
horizontal stroke, in both the three and the four — and that is a deliberate
disagreement with the text on the strength of the diagrams and of playing to it.

### Shape and timing are separate mechanisms

The whole bar is **one closed spline** through the beats and the apexes between
them, and the ictus is a point *on* that curve. Building each stroke as its own
curve, starting and ending at a beat, makes every ictus a seam where two
tangents disagree — so the tip turns a hard corner, which a hand with mass
cannot do. Measured, that was a 180° tangent flip; on one curve it is 0.4°.

Timing is then a separate phase warp: hurry through the beat, linger at the
apex, like a thrown ball. Keeping them apart is what lets the path stay smooth
while the motion stays sharp. In the old model they were the same mechanism,
which is exactly why every attempt to make a beat readable cost the shape and
vice versa. The legato-to-marcato setting drives the warp, not the geometry.

### The two figures worth reporting

- **Flick** — the vertical reversal, sampled a short way either side of the beat
  rather than at it, since on a smooth curve the vertical velocity is exactly
  zero at the ictus however sharp the turn. This is the ictus as Mann defines it.
- **Speed contrast** — how much faster the tip moves at the beat than between
  beats. Useful, but secondary; it is not what a beat *is*.

The page also prints a fingerprint of the drawn geometry, sampled off the curve
rather than hashed from the numbers behind it — the shape changed twice without
a single coordinate moving, and a fingerprint of the inputs would have said "no
change" both times.

### Compound time, offered at last

**6/8 is on the settings screen from v1.24.0.** Everything it needs had been
built for a long time — `metre.ts` for the pulse, beaming in threes, the
metronome on the dotted crotchet, the conductor's two-pattern, a committed
engraving snapshot — and the picker simply never offered it, so none of it
could be reached. A brass band player meets six-eight in marches before
almost anything else, which made it the most conspicuous gap on that screen.

Turning it on found four faults, all of the same shape: **code that was
right about bars and silent about the pulse.**

- *Rhythm was generated to fit the bar*, so 6/8 came out as 3/4 in disguise —
  crotchets laid straight across the dotted-crotchet beat. Free material now
  fills a whole pulse at a time from figures derived from the difficulty's own
  pool, which is why a beginner's 6/8 is the beat and nothing else: minims and
  crotchets cannot fill a dotted-crotchet pulse in any combination.
- *Patterns lay their notes end to end* and broke it by a different route — a
  vocabulary that divides the pulse is not enough, since a run of such values
  lands wherever it lands. The pulse is a ceiling as well as a vocabulary.
- *Rests respected the middle of the bar*, tested by whether half a bar was a
  whole number of crotchets. Half a bar of 6/8 is a beat and a half, so the
  test failed and compound time got no division to respect at all.
- *Beams were refused to any pulse containing a rest*, which is the same thing
  as breaking at the rest while a beat holds two quavers — and visibly wrong
  once a beat holds three. They now break at the rest itself, which improved
  simple time too.

The lesson worth keeping: `metre.ts` separated the numerator, the bar and the
pulse years before anything used the distinction, and every one of these bugs
was a place that had quietly gone on using the bar where it meant the pulse.

### Metres we have no pattern for

There will always be some, and imported music guarantees it. **The conductor
switches off and the metronome carries on**, rather than guessing. A conducting
pattern is a specific taught shape, not something to interpolate: a five is not
a four with a beat wedged in, and an invented one would teach a player to follow
a gesture no conductor will ever make. Silence from the conductor is honest; a
plausible-looking wrong pattern is not.

Patterns exist for two, three and four pulses, which covers every simple metre
the app offers today and 6/8, 9/8 and 12/8 when compound time arrives. Five and
seven are drawn on the reference sheet in `input/conducting` and can be added
from it when wanted.

## The range free material is drawn from — built, v2.6.0

Asked for by the player on 2026-08-13, having seen it elsewhere. The band
already existed and was simply nobody's to set: `candidatePitches` opened one as
wide as the difficulty said, centred on the middle of the compass. An Eb bass in
treble spans Db3 to C6 and Easy asks for seventeen semitones, so the bottom
fifth of the horn was unreachable at every level below Expert.

**A range asked for is taken literally — all of it, none of it favoured.** The
player's ruling. Someone asking for the bottom of the instrument has said
something specific, and pulling the notes back towards the middle would be the
app disagreeing with them about the thing they came to practise. Difficulty
keeps the leaps, the accidentals, the rhythms and the rests, and stops governing
where the notes sit.

**Where no range is asked for, the middle is favoured.** Unchanged behaviour,
and what an exercise wants when nobody has said otherwise. `Settings.range` is
null by default, and null means *the difficulty deciding* — not a range of none.

**Free material only.** A pattern is placed by its tonic and its span and asks
`register` which end of the horn to sit at; a theme is written in degrees and
finds its own octave. Both would mean something different by a range, so the
control appears opposite the register: one or the other, never both and never
neither.

**Named and drawn.** The two bounds are semibreves on a stave with the fingering
over each, which is the reasoning `note-chart.ts` already sets out for the
weak-note chart: a letter and an octave number ask the reader to translate, and
translating is the thing someone practising this is not yet fluent at.

Written pitch, so it moves with the clef. `sanitise` clamps rather than clears
when the instrument or clef changes: clearing would silently drop a choice on a
mis-tap, and the stave shows where a clamped one landed.

### The dials — v2.7.0

Two dropdowns operated it to begin with, which is a list of thirty-six notes to
hunt through for a choice that is really *a place on the horn*. Asked for by the
player on 2026-08-13 as a dial under each note, turned with the finger.

**A turn is a stave step in the key, not a semitone.** The player's call, and
the figure above agrees with it: one turn, one line or space, spelled by the
signature so no bound arrives carrying an accidental nobody asked for. Three
octaves of tuba is about twenty-one stops rather than thirty-six. It narrows
nothing — the pool between two bounds is every chromatic note in it, as it
always was.

**The ends of the compass are always on the ladder**, key or no key. An Eb bass
in treble bottoms out on a written C#3, which is in no flat key at all, and a
dial that could not reach the bottom of the horn would be refusing to say the
thing a low-brass player most often wants to say. `domain/ladder.ts` holds both
that rule and the stepping, including from a note left off the ladder by a key
change — one click moves one place from where the note actually is.

**The dials block rather than shove.** A lower bound driven up into the upper
one stops there. Shoving would move a note the player is not touching, and the
pair would walk up the horn together with nothing on screen to say why. They may
still meet on one note, which is a thing worth asking for and reads as one.

**Each detent clicks and taps.** A control turned by a finger has nothing else
to say it moved: the note is a small change a long way from the thumb, and a
silent dial feels like a stuck one. Sound and haptics both, best-effort — no
audio on this screen until something asks for it, and no vibration on a desktop.

**A dial either side of the stave, not under each note — v2.7.1.** Beneath the
notes they were plainly paired with them, on one set of fractions the canvas was
drawn to, and the control was twice as tall as it needed to be. This is a
settings screen being kept short: every row of it stands between a player and
the Start button, and one row of dial-stave-dial is worth more than a diagram of
which dial does what, which the stave says anyway by having its low note on the
left. About 400 pixels became about 200.

Losing that pairing is what frees the figure: nothing outside the canvas depends
on where in it a note lands, so the clef and key signature can be **measured**
and the notes placed after them. That is what keeps seven flats and two notes in
half the width — and the notation is capped at fourteen pixels to the space
rather than the chart's twenty-two, because a compass is thirteen spaces tall
and on a wide window a bigger stave buys nothing but height.

**A figure sizes itself to its ink, furniture included.** `range-stave.ts` is
its own renderer rather than another caller of `note-chart.ts` for this reason:
the chart reserves a fixed thirteen spaces, which crops the ends of a brass
compass, and the first two things this cropped were not the extremes at all but
a treble clef's tail and a fingering over a note sitting quietly inside the
stave. Extents come from `headerExtent` and `fingeringHintY`, which are the
numbers the drawing itself uses — the same "laid out rather than drawn" rule
`layoutKeySignature` was written under.

## The page that flipped back towards the start — v2.13.1

Reported by the player against paged reading: *occasionally the bars on the
screen flip up and down, before returning to where I am playing.* Occasional,
and not tied to anything they did — no rewind, no change of tempo.

**The smoothed clock could tick backwards, and the page kept state off it.**
`visualBeat` anchors to `AudioContext.currentTime` and fills the gaps between
its ticks from the wall clock, which is what stops the notation moving in
staircase steps on a phone. But `currentTime` does not advance smoothly: it can
sit still for longer than a render quantum and then move by one quantum rather
than by the wall time that has passed. Extrapolation meanwhile runs at wall
rate, so it ends up *ahead*, and re-anchoring to the audio clock's own figure
steps the reported beat back.

Measured in a browser before it was modelled: **four backwards steps in twenty
seconds, up to three hundredths of a beat.** Far too small to see as motion, and
that is exactly why it survived — nothing that merely reads a position and draws
it can tell. The paged reader does not merely read it. It turns the page forward
when the bar being played reaches the end of the page and back when that bar is
behind the page's start, so a step back across a bar line in the frame after a
turn takes the page with it. A turn happens *on* a bar line, which is the one
place a step that small can cross one — the page was only ever vulnerable at the
exact moment it had just moved.

The fix is a high-water mark: the interpolated position is held rather than
allowed to retreat, so it stalls for the few milliseconds the audio clock takes
to catch up and moves again after. Stalling is what it already did when the
clock stopped altogether, and it is the honest failure — the music has not gone
backwards, so the display must not say it has.

**The dangerous half is letting go of the mark**, and it wants more care than
the mark itself. A mark left in place through a rewind would pin the notation at
the far end of what had been played and never release it, which is a worse fault
than the stutter. It is dropped wherever the transport genuinely moves the
position backwards — `start`, `pause` and `seekTo` — which is the transport's own
doing and never the clock's. Both halves are pinned by tests, and both tests were
checked by breaking the code they guard.

**Two wrong theories first, and both were killed by measurement rather than by
reading.** That the beat map was non-monotonic across the tempo steps a stitched
theme takes at its joins — checked over the whole compiled map of a real themes
exercise, and it is monotonic to the last decimal. And a first model of the audio
clock in a test that reproduced nothing, because it had `currentTime` lagging
wall time evenly, which never overshoots. Only sampling a real browser frame by
frame showed the step, and only then could the test be written to fail.

## Two things a rewind and a bar were waiting on for ever — v2.12.1

Both were written down as inherited faults at the end of the last session and
neither had been played into. Corrections only, in their own release.

**A rewind takes the standing offer back with it.** The offer to carry on is
made once per committed end and remembers that it has been made — which is what
kept it standing after a rewind out of the window it belonged to. The button
stayed green, the reference tone stayed at half volume, and since the flag was
never cleared the question could not be asked a second time: a run rewound from
its last four beats could never be extended again. The withdrawal now lives in
one place and both endings go through it, the accepted one included.

What a rewind does *not* take back is the player's answer. `playUntil` keeps
whatever was bought, because asking for more music is a decision about how long
the run is rather than a verdict on a bar, and a rewind disowns verdicts only.
This is the fourth member of the family the last session named — *a jump
backwards is a state reset, and there is always one more piece of state in it* —
and `unplay` is the right home for the next one too.

**A bar waits only on the notes that can be judged.** A note outside the
instrument's range is shown and sounded but never judged, deliberately: it asked
nothing the player could have answered. But paged reading withholds a bar's
verdicts until every note in it has one, and it counted the unjudgeable note
among them — so one note above the top of a tuba held its bar grey for the rest
of the run, and the player got no reading at all of a bar they had played every
reachable note of. Imported parts only; a cornet part handed to a bass can be
full of them.

**And the count-in was rewound into, which had never been tested.** Nothing
disables the transport buttons before the music starts, so it is reachable.
It behaves: the rewind lands at beat 0, counts a bar in afresh, and judges
nothing until the music actually arrives. There is no pickup case hiding behind
it either — an imported part that begins part-way through a bar is padded up to
the bar line by the importer, so an exercise's beat 0 is always a bar line.
`Session.canRewind` was written to grey those buttons out and was never wired to
anything. **Deleted in v2.12.2** on the player's ruling: the buttons stay live
and ◀5 in bar two simply goes back to the start, which is most of what it is for
early in a piece. There is nothing to warn anyone off, so there was nothing for
the getter to do.

## What a fingering hint answers, and for how long — v2.11.0

Worked through with the player on 2026-08-14, going over the whole rule set,
since this is the fingering trainer and the hints are the thing it teaches
with.

**The trouble is filed under the written note, and it does not travel.** This
is the ruling everything else hangs off, and it is a consequence of not having
the microphone yet. With valve buttons alone the app sees which combination
went down and nothing more: it cannot tell a player who chose the *wrong
fingering* from one who chose the right fingering and *mispitched*. So it must
not pretend to teach either, and what it can honestly see is whether a note on
the page was recognised and answered. Trouble therefore attaches to the written
note as it appears on the stave for this instrument and clef — not to the valve
combination, which would be a claim about fingering, and not to the letter in
other octaves. The player's own case: *I don't know what high B looks like, but
I have no trouble with the B above middle C.* Two different reading problems;
only one of them wants prompting.

**Revisit when the microphone lands.** A wrong fingering and a right fingering
mispitched are different faults with different answers, and only then can they
be told apart.

**Two of that note played right and the prompting stops.** The page quietens as
the player improves, which is feedback in itself. It does not overturn the old
"a hint that came and went would be worse than none" — this one goes away for a
reason they can feel, and comes back if the note does.

**Wrong valves prompt at once; a miss takes two.** They are not the same
evidence. Wrong valves are a fingering reached for and missed. Nothing held at
all is as likely to mean the player was lost, behind, or resting a lip, and
answering that with a fingering is noise.

**History needs four attempts, not two.** The stats gate is deliberately
stricter than the generator's weak-note drilling, which still judges on two:
drilling is invisible and being eager about it costs nothing, while a hint is
an intervention printed on the page. One mistake in two attempts is not
evidence, and the run itself now catches the immediate case on the first
mistake.

**Three modes, not a switch.** *Every note* is reading something new with the
answers in front of you; *where I struggle* is the rule above; *never* is
playing it for real. A fingering trainer is used in all three frames of mind,
and the old boolean could only say two of them. A stored `true` reads as
*where I struggle* and `false` as *never*, in `sanitise`, so nobody's setting
is lost.

Still true, and unchanged: nothing is printed over the far end of a tie or in
the air a tempo mark owns, and there is no cap on how many a page may carry.

### The timing rule was measuring the wrong thing — v2.12.0

The last of the six, and it turned into a correction rather than the feature it
looked like. The complaint was that **fast passages get no hints at all** —
withheld precisely where a struggling player is most likely to be lost — and
the proposal was to move the hint back to a note with room, the fingering being
something that has to be in the hand before a run starts.

Looking at what the rule actually measured settled it differently. It compared
the gap to the next note against a fifth of a second, on the grounds that a
hint arriving later than that cannot be read in time. But **the strike line
sits near the left of the display**: notes scroll in from the right and are on
screen, hint and all, for seconds before they are played, and the paged screen
shows the whole page at once. Reading time was never the scarce thing. What a
run really costs is the ability to *act* on a hint mid-flight — and a hint you
could not act on this time is still the answer to the mistake you just made,
and still there on the way round again.

So the rule now belongs to one mode only:

- **Where I struggle** prints wherever a hint physically fits. Whether it fits
  is a question for the drawing, which already refuses one wider than the gap
  to the next note — two adjacent capsules may touch but cannot overlap.
- **Every note** keeps the timing rule, because that mode prints over music
  nothing is wrong with, and a run of semiquavers under a wall of digits helps
  nobody.

The reach-back was not built. With the timing rule gone from the mode that
wanted it, the case it addressed is a passage dense enough that the capsule
will not fit at all — and a callout hanging over an earlier note with its tail
crossing a beam to land in a cluster of semiquavers is a worse answer to that
than silence.

## A rewind plays at the tempo on the dial — v2.10.1

Found by the player taking a hymn back five bars at a time: the passage came
back at the speed it had the *first* time through, while the dial went on
showing the speed they had chosen. Everything follows the clock, the judging
included, so the marking appeared to race ahead of the playing — "bars being
scored before they are complete".

The cause is that the two kinds of tempo event were kept in one list. **The
score's** are the music's own instructions — a written step, a rit. — and they
belong to the piece however often it is played. **The player's** are the dial:
not a fact about the music but about the speed being practised at. Held apart,
two rules follow:

- **A change drops the player's own steps at or after it.** All of them lie
  beyond the scheduling horizon, so nothing already computed can move — and it
  stops an abandoned speed lying in wait to fire from a dial that has long
  since moved on.
- **A jump rebases on the dial.** `rebaseTempo` throws the player's steps away
  and makes their current speed the nominal one, count-in included. It rewrites
  the past as well as the future, which is safe *only* because the caller is
  about to re-anchor the origin — `Session.restartAt` is the one caller, and
  re-anchoring is exactly what it does next.

Measured in a browser rather than argued: at 200 the run judged 3.8 notes a
second, wound down to 40 it judged 0.5, and after a rewind it judged 3.2 —
which is the fault. It now judges 0.5.

## Hold it, and take it from a bar back — v2.10.0

The two things said most often in a practice room, and neither was possible:
the only way to have another go at a passage was to end the run and generate a
different exercise. Asked for by the player on 2026-08-14, along with the dial
below.

**A pause freezes the clock, not merely the scheduler.** The audio context's
time is the sound card's and never stops, so a transport that only stopped its
timer would leave the notation scrolling past the strike line with nothing
playing. `Transport.pause` freezes the beat and every reading of position goes
through it, which stops the display, the scheduler and the judging together.
What is already committed to the audio thread — a seventh of a second of
scheduling horizon — cannot be recalled, so the sounding note is cut and a
click may still land.

**Starting again counts a bar in, and it is the real bar.** The count-in is the
device the run already opens with: the transport starts a bar early and the
scheduler is pointed at the first note actually wanted, so the bar before it
clicks but neither sounds nor judges. Which means the clicks are the true
metrical positions of the bar the player is about to come in on, rather than
four anonymous beats — they hear where "one" is. It also means the count-in is
silent if the metronome is off, exactly as the opening one is.

**A rewind goes to the top of a bar, and takes its bars out of the score.**
"Back one" from the middle of bar six is the top of bar five — the bar of music
before where they are, not the fraction of six they have left. Everything from
there on is un-judged: a bar gone back to is a bar to be played again, and
scoring both attempts would score the one the player went back to disown.
`onRewind` tells the screen, which lets go of the colours on the page.

**Rewinding while paused moves where it will pick up from**, notation and all,
so the player can see where they are about to come in. Rewinding while playing
restarts from there with the same bar of counting in.

**`Transport.start` is a no-op on a running clock, and that nearly hid this.**
It must be — a stray second call would re-anchor the origin under everything
already scheduled — so a rewind made while playing silently did nothing at all:
the score gave up its bars and the music carried blithely on. The session stops
the transport before restarting it. A test caught it; the browser would have,
eventually.

## The play screen answers mistakes, and holds the tempo — v2.9.0

Three changes the player asked for on 2026-08-14, which turn out to be one
change: **the play screen should teach, and everything on it should earn its
space.**

**The list of recent notes is gone.** It sat beside the stave showing the last
five notes played, what was held and what was wanted. The player's verdict:
*you can never pay enough attention to it to see what the fingering was
supposed to be.* That is the whole case. Nothing read off to the side survives
contact with sight-reading — the eye is on the note coming, and a list is a
second place to look at exactly the moment there is no attention to spare.

**So the answer moved onto the note.** A note played wrong or missed now gets
its fingering printed over it as it happens — over that note, where the eye
already is, and over every later note of the same pitch. The hints used to be
settled once per run from the stored statistics, which meant the answer to a
mistake made in bar three arrived the *next* time the player pressed Start. An
answer that late is not instruction.

**And the cap on how many is gone.** There was one — at most one a bar, on the
grounds that beyond that the hints become the part being read. The player asked
for it removed, and the reasoning holds up: fingerings are what this app
teaches, a hint only ever appears where something has actually gone wrong, and
a run that has earned eight of them should be given eight. What still limits
them is what always decided whether one could be *used*: whether there is time
to read it before it has to be played, and whether it physically fits, which
the callout's stacked shape made far easier to satisfy.

The note that just went wrong is exempt from the reading rule. It is behind the
player and nothing is going to be played to it; what it is doing is telling
them what they should have held, which is the job the list was doing badly.

**The tempo went into the space.** It is the setting a player reaches for
constantly, and reaching for it used to mean stopping, walking back to the
settings screen and starting the exercise again — an absurd amount of ceremony
for the most common instruction in any practice room.

**A dial, not a slider — v2.9.1.** It shipped as a slider and the player's
objection was immediate and correct: a slider has to fit the whole range into
whatever width is beside the stave, so every pixel is worth a couple of beats a
minute and "a shade slower" becomes a lottery. A dial gives the same finger
travel to every beat a minute wherever it starts from. Crossing the range then
takes several spins, which is the trade and the right way round — the small
adjustment is the one made constantly, and the player said as much when asking
for it.

**The reading sits above the dial, and large.** The thumb turning it covers the
dial itself, and the other hand is on the valves with the eye on the stave, so
the number has to be catchable at the edge of vision *and* somewhere a hand
cannot be. That is the whole reason it is not written on the face.

**The reading is on the face, and again above it while turning — v2.10.0.** On
the face because that is where a control's setting belongs, and it is legible
at a glance the rest of the time. Above it while a finger is on it because the
finger is covering the face — the same trick a phone keyboard uses for the key
under the thumb, and for the same reason. Upright the callout steps *beside*
the dial rather than above it: above is the play bar, and nothing transient may
cover the button that ends the run.

**One gesture, two dials.** `useDial` is the range picker's feel with nothing
note-shaped left in it: travel to a detent, a click and a tap of the hand at
each one, resistance at the ends, and a keyboard and a wheel for anyone not
using a finger. The caller supplies only where a number of detents from a value
lands. And the click is rate-limited in `audio/tick.ts` — a note dial passes a
detent every few hundred milliseconds and every one should be heard, but a
tempo dial spun hard passes thirty a second, which is a buzz rather than a
ratchet and a phone that feels broken.

**A live tempo change extends the map; it never re-anchors it.** This is the
part that had to be right. `Transport`'s beat↔time map is anchored at a single
origin, and `setTempo` was once a method that threw for exactly that reason:
re-anchoring would retroactively move every note already handed to the audio
thread. `changeTempo` instead appends a step at **the next whole beat at or
after the scheduling horizon** — beyond everything already committed, so no
time already computed can move — and a whole beat is a target a dragging finger
keeps landing on, so a change asking for the same beat replaces the one pending
there instead of adding another. A drag costs about one event a beat rather
than one a frame. It will not place a step inside a rit., which has no meaning;
it waits for the ramp to arrive. And it cannot touch the count-in, which lives
at negative beats where the map is flat by construction.

The tempo the player settles on is written back to the settings when the run
ends — never while it moves, because the play surface is rebuilt when the
settings change and that would restart the exercise under their fingers.

## A level beam clears its highest note — v2.8.2

Reported from bar 41 of a hymn on 2026-08-14: a beamed run from middle C to the
C above came out with a normal stem on the first note and none at all on the
last, the beam running straight into the notehead.

Beams are kept horizontal in this app on purpose — a level beam is easier to
read on a display that scrolls, and it removes a class of layout edge cases — so
the beam's *height* is the whole of the question, one line serving every note
under it. It was measured a stem's length from the note **furthest** from it,
which spends the whole stem on the note that needs it least: every other note in
the group then loses the interval, and at exactly an octave the nearest note has
nothing left.

**Measured from the note nearest the beam instead**, so the notes further away
grow longer stems to reach it. The floor that matters, and the one the tests
state: no note in a group ever reaches the beam in less than a full stem,
whatever the spread. A long stem is what a level beam over a wide interval costs
and what an engraver draws; a missing one is a mistake on the page.

`beamPlacement` is exported rather than kept inside the drawing, because the
tuplet bracket and anything else that has to clear a beam wants the same answer.

## A tie is marked a bar at a time — v2.8.1

Reported from a hymn on 2026-08-14: a G tied across three or four bars turned
green in every one of them the moment the player started it.

The cause is a rule that is right on its own. A tie is one sound written as
several noteheads, and only the first is judged — the far end asks nothing of
the player, so `PlayScreen` hands it the verdict of the note it is tied from,
because a green head beside an unmarked continuation reads as half a note having
gone right. But that verdict lands within a fraction of a second of the attack,
so the page was claiming three bars the player was still in the middle of
holding.

**Each notehead of a tie keeps its verdict until the bar it stands in has been
played through** (`revealTiesByBar`). The green then spreads across the tie a
bar at a time, behind the player, which is the player's own description of what
it should do.

**Only notes in a tie wait.** An untied note is over inside its own bar, and in
scrolling reading the strike line has already said what it made of it the
instant the fingering came right. Nothing here changes what is *judged* — this
decides when a verdict is shown, and the confirming flash at the strike line
still lands on the act that earned it.

It composes underneath `revealByBar`, not over it: a bar holding the far end of
a tie is not finished being judged until that end can show its verdict.

## The fingering callout — v2.8.0

A fingering used to be printed as a line of text over its note: `1-2-3`, set in
the same band as the bar numbers, which is where the player found the two
written on top of each other. Their design, asked for on 2026-08-13: the valve
numbers stacked in a small capsule with a long tapered tail pointing down at the
note.

**Stacked, because the room a hint needs is horizontal.** `1-2-3` is three
characters wide in the one direction a stave has nothing to spare, and
`drawFingeringHint` will not print a hint wider than the gap to the next note —
so the fingerings most worth having were the first to be dropped, three valves
being both the hardest to remember and the widest to print. One number wide and
three tall costs nothing horizontally, and hints can now sit over consecutive
notes. **Open is written `0`**, which is what a published chart prints and the
only form of the word that fits in a circle.

**The tail is what keeps it legible.** A capsule floating in a lane of its own
has stopped saying which note it belongs to; a line drawn to the note says it
exactly. Tapered, because the end that has to be *precise* is a point and the
end that has to be *seen* is broad — and it aims at the note's own ink, so on a
stemmed note it stops at the stem's tip rather than crossing it.

**The capsule sits in a lane; the tail is what varies.** Never lower than the
top line, so every note in or below the stave gets its capsule at the same
height with a longer tail the further down it lives. A row of hints then reads
as a row rather than as marks scattered at the heights of their notes. A note
*above* the stave takes its capsule with it, since a fixed lane would be
underneath it.

**The bar number gives way, not the fingering.** It is furniture — it belongs to
the page rather than to the music — so it is the one that moved: tucked against
the stave, set smaller, and on the scrolling line drawn at its bar line instead
of at the downbeat, which is exactly where the note carrying the callout stands.
The tail passes through that band on its way down, which is a thin line crossing
a number rather than two things written over each other, and the capsule is
filled so anything it does meet is passed over cleanly.

**A taller thing above the stave means more room above the stave.** A paged
system went from eleven spaces to twelve, four and a half of them above the top
line: three valves stacked stand that far over it. Both charts size themselves
from `fingeringHintY` and `fingeringHintRise` rather than from a constant — the
weak-note chart was found to be cropping its own percentages while that constant
stood.

## Fermata

Draw it whenever, but it has no honest meaning against a metronome. A fermata
means "hold until released" and there is no conductor to release you. It becomes
practisable exactly when there is something that can release you — the on-screen
conductor, or the microphone hearing you stop.

**The conductor half was tried and ruled out, 2026-08-10.** A spike
(`public/spike/fermata.html`) drew the full release — the meld, the breath
of a lift, the drop to the contact line, the orb building through the hold —
and playing against it alongside further reading settled the matter: a
fermata is a two-handed act. Robertson's *Fermate* chapter has the left hand
carrying the sustain while the right keeps the pattern; sustain, cutoff and
release are a hand of their own, and one drawn baton flattens that into a
gesture no conductor makes. So the fermata waits for the microphone, which
releases the player by hearing them — the tempo map's dwell machinery is
built, tested and inert until then, and the spike stays as the workbench.

## The microphone, parked

Proven and then deliberately set aside in favour of the notation work above.
Nothing here is speculative; it was measured.

- **It works.** Tested on an Eb bass and a Bb cornet. Two recorded takes
  analysed offline: a G major scale (14 notes) and a chromatic octave and a half
  (18 notes), both with **zero** wrong notes and zero frame-level octave leaps.
  The recordings are in `spikefiles/` and the harness is
  `tools/analyse-recording.mjs`.
- **Notes settle after roughly 0.2s.** Part window-filling, part the lips
  genuinely not having found the pitch yet.
- **Therefore timing and correctness are two different measurements.** Onset
  from the amplitude envelope, which is reliable at the attack; pitch from the
  settled portion. Judging pitch at the onset would be judging exactly the
  200ms shown to be unreliable.
- **The instant green confirmation from v1 cannot survive.** The earliest honest
  confirmation is about 200ms after the attack.
- **The anti-aliasing filter is load-bearing for correctness**, not merely for
  cheapness. See the comment in `public/spike/spike.js` and `check.mjs`.
- **What it would buy beyond convenience**: the app would know what *came out*
  rather than what was pressed, so it could tell a cracked partial (a lip
  problem) from a wrong fingering (a knowledge problem). Those need entirely
  different practice.
- **Keep the buttons.** Practising fingerings without the instrument is half of
  what a fingering trainer is for, and the buttons are the fallback when the
  microphone is declined or the room is too loud. The microphone half must be
  additive: declining the prompt should leave exactly the app that exists today.

### How it would plug in

`ValveInput` is a timestamped history of button states, and `judgeNote` asks one
question of it: *was an accepted state held at any instant in a window around
this onset*. The microphone produces a timestamped history of **pitches**
instead, and the same question becomes *was an accepted pitch sounding*. So the
judge wants a source interface rather than a `ValveInput`, with two
implementations.

The awkward part is that the microphone cannot answer it in one measurement.
Timing comes from the amplitude envelope, which is reliable at the attack;
pitch comes from the settled portion, ~200ms later. Two measurements of two
different things, where the buttons give one. Anything reading `heldMask` —
the results screen, the recent-notes list, weak-note stats — needs a pitch-
shaped answer as well as a fingering-shaped one.

`onCorrect` and the strike-line flash are the visible casualty: the earliest
honest confirmation is about 200ms after the attack, so the instant green cannot
survive in microphone mode. It can stay exactly as it is in button mode.

Both spikes are in `public/spike/` with the detector, a flight recorder, and
`tools/analyse-recording.mjs`. Recordings are in `spikefiles/`. If this resumes,
the detector gets rewritten in TypeScript with those recordings as fixtures.

### Two rulings from playing experience

**Accept any octave.** If an E was called for and any E was played, treat it as
correct. Measured: **19 of 19** octave pairs within the playable range share a
fingering, on both Eb bass and cornet, with no exceptions — a note an octave up
sits on partial 2n with the same valve offset. So the rule costs nothing. It
gives up detecting an octave *pop*, but cracking to an adjacent partial gives a
3rd, 4th or 5th, and those are all still caught.

**The 4th valve stays invisible, everywhere.** It was made virtual in v1 and
must not reappear, including in any tuning feature — amateur players rarely
adjust it and cornets have not got one. This is a correctness requirement as
well as a simplification: five notes on an Eb bass are 4th-valve notes wearing
three-valve clothes, and measuring the first slide on one of them would blame it
for the fourth's fault.

| Shows as | Really |
|---|---|
| F3 = 1 | 1-4 |
| E3 = 1-2 | 1-2-4 |
| E♭3 = 2-3 | 2-3-4 |
| D3 = 1-3 | 1-3-4 |
| D♭3 = 1-2-3 | 1-2-3-4 |

Any feature reasoning about physical slides must exclude notes where
`Fingering.usesFourth` is true. On a cornet, none are affected.

## Selling it, one day

The app is free and ungated as it stands, and the intention is that it keeps
being so on GitHub while a paid build stays possible. Most of what that needs
is already true, and is recorded here so it does not get undone by accident.

**The decisions already made, and worth not reversing.** `LICENSE` is
all-rights-reserved source-available: the code can be read, and the hosted app
used, but not forked and sold. That is the one choice that cannot be walked
back — a permissive licence, once published, applies to that code forever.
Both bundled assets are cleared for commercial use with attribution: Bravura
under the SIL OFL, the FluidR3_GM samples under CC-BY 3.0, neither share-alike.
And `VITE_GATED` means the free and paid builds are one codebase rather than a
fork, with entitlements described as capabilities so that only
`entitlements.ts` and `licence.ts` know money exists.

**Why the licence verdict is held rather than derived.** Everything deciding it
today is instant, but a store receipt is not — it is checked over the network
and lands after the first render. `licence.ts` therefore caches its answer and
exposes `refreshEntitlements` as the place a slow check will go, with
`watchEntitlements` for anything that has to notice a late answer. Deferring
that would have meant reworking the render path of whatever was asking.

**Why CI builds the gated app.** Nothing else ever does, and an unbuilt path
rots — `tools/` already has. `deploy.yml` builds it before the real build,
because both write to `dist/` and the last one wins; reversing that order would
publish the paid build to the free site.

**Two things deliberately not done yet.**

- *The conductor is ungated in every build.* `constrainToEntitlements` does not
  touch `conductorEnabled`, so the most distinctive thing here is currently
  free. That may well be right — it is a good reason to try the app at all —
  but it should be a decision rather than an omission.
- *Practice history cannot move.* Stats live only in `localStorage`, so
  someone moving from the free web app to a paid one loses their history, and
  with it weak-note drilling, which is the feature that improves the longer it
  is used. An export would also insure against a cleared browser.

The no-backend property is a commercial asset as much as a technical one: it
means selling once rather than by subscription, no hosting to fund, nothing to
keep running, and no privacy policy to write. Worth weighing before anything
proposes a server.

### The gated settings screen — built

**The fault, now fixed.** On a gated build the settings screen offered
everything, accepted the choice, showed it as selected — and then something else
happened. `App.tsx` handed *unconstrained* settings to `SettingsScreen`, which
never imported entitlements at all, and `constrainToEntitlements` substituted at
exercise-build time instead, silently. Asking for 24 bars of Expert in D major
produced four bars of Easy in C major with nothing on screen admitting it.
`isLimited` existed for precisely this and was called nowhere.

Silently ignoring a choice is worse than refusing it: a player who picks D major
and is given C concludes the app is broken, not that it is limited.

**What was built.** `App` passes `entitlements` alongside the player's own
settings — not the constrained copy, so a choice survives unlocking and a
purchase restores what was picked. The screen disables rather than hides what
this copy cannot use, marked with `.is-locked` so the fade never lands on the
key chips already disabled for other reasons. One `.notice` at the top names
what the copy *has*, assembled from `FREE_TIER` so it cannot drift, and says
nothing about buying: there is no price yet, and a screen that nags before there
is one is the wrong first impression.

**And a second half the original plan missed.** Disabling the controls stops a
withheld choice being *made*; it does nothing about one already held. A fresh
install defaults to E flat, so a free copy still sat there reading "Eb major"
while the generator built in C — the same dishonesty in a quieter place. The
screen now reads every gated value from `constrainToEntitlements(settings,
entitlements)` and writes every change to the stored settings underneath. What
is shown is what will be played; what is stored is what was asked for.

`FREE_TIER.playbackMode` is gone. It was declared and never read, and an
assertion beside it implied playback was pulled back with the rest when
`constrainToEntitlements` never touched it.

**Still true, and the reason the rest of this section stays:** the free tier's
limits are values rather than booleans, which is what lets a withheld control be
shown in its place.

**What is gated, and which control each maps to.** Six capabilities in
`Entitlements`, each already enforced in `constrainToEntitlements`
(`settings.ts:239-257`) and each with exactly one control:

| Entitlement | Free tier gets | Control | Where |
|---|---|---|---|
| `allKeys` | C major only | `<select>` | `SettingsScreen.tsx:186` |
| `allMaterial` | random, scales | `.cards` buttons | `:200` |
| `allDifficulties` | beginner, easy | `.segmented` buttons | `:217` |
| `allLengths` | 4 bars | `<select>` | `:263` |
| `pagedReading` | scrolling only | `.cards` buttons | `:277` |
| `weakNoteDrilling` | off | checkbox | `:373` |

Note the free tier's limits are *values*, not just booleans, and they live in
`FREE_TIER` — so the screen can say what is available rather than merely that
something is not.

**The shape of the fix.**

1. `App.tsx` passes `entitlements` to `SettingsScreen` alongside settings. It
   already has them (`App.tsx:49`); do **not** pass constrained settings
   instead — the player's real choice should survive unlocking, so that a
   purchase restores what they had picked rather than silently keeping the
   substitute. Constraining at build time is right and should stay.
2. `SettingsScreen` disables — not hides — the options a build cannot use.
   Hiding would make the app look smaller than it is and give no reason to buy;
   disabling shows the shape of what is on offer. The three control types each
   need their own treatment: `<option disabled>` for the two selects, a
   disabled attribute plus a muted style for the `.cards` and `.segmented`
   buttons, and a disabled checkbox.
3. Say why, once, near the top rather than six times. `isLimited(entitlements)`
   is the condition; the wording should name what is withheld rather than
   nag. This is the one genuinely new piece of UI and wants a deliberate
   decision about tone.
4. **`constrainToEntitlements` stays exactly as it is.** It is the backstop for
   settings that outlive the screen — saved before a purchase lapsed, or edited
   in storage — and the generator should not be the thing that has to notice.
   The screen is a second line, not a replacement.

**Traps.**

- `?tier=free` forces the free tier in any build (`forcedFree` in
  `licence.ts`), which is how to look at this without a gated build. Use it —
  `npm run shots -- --tier free` photographs it in one command, and the fault
  is plain in the picture: every key chip offered, none of them greyed.
- `FREE_TIER.playbackMode` is declared but never read — there is no playback
  entitlement. Either wire it up or delete the field; leaving it invites the
  belief that playback is gated when it is not.
- The conductor is ungated (see above). If that changes, it becomes a seventh
  row in the table and `conductorEnabled` needs adding to
  `constrainToEntitlements`.
- Entitlements can now change *after* mount — `App` subscribes via
  `watchEntitlements`, so a purchase mid-session re-renders the screen. Any
  disabled state must be derived during render, not captured once.

**How to verify.** `VITE_GATED=true npm run build` then serve `dist`, or just
append `?tier=free` to the dev server. Every withheld control should be
visibly unavailable, and what the exercise is actually built with must match
what the screen shows. `entitlements.test.ts` already asserts
`constrainToEntitlements` is idempotent and yields real values; the screen
wants its own test that a locked build renders the withheld controls disabled.

## The tuning function

Designed, not built. Parked with the microphone, since it needs one.

A chromatic tuner has no idea which valves were held, so it can tell you a note
is 20 cents sharp but not what to pull. This app knows the fingering *and* the
partial, so it can attribute the error:

```
measured = main slide + valve slides + partial physics + your lips
```

Three of those four are knowable; fit them by least squares over enough notes
and they separate. The partial offsets are known physics — the 5th partial is
about 14 cents flat by nature, and blaming a slide for that would send someone
chasing a fault that is not there.

The exercise generates itself from the fingering engine. For an Eb bass in
treble clef, excluding the 4th-valve notes above:

| Slide | Notes |
|---|---|
| open | C4 G4 C5 E5 G5 |
| 1 | B♭3 F4 B♭4 D5 F5 |
| 2 | B3 G♭4 B4 E♭5 G♭5 |
| 1-2 | A3 E4 A4 D♭5 |
| 2-3 | A♭3 E♭4 A♭4 |
| 1-3 | G3 D4 |
| 1-2-3 | G♭3 D♭4 |

1-3 and 1-2-3 have only two usable notes each, and those are the combinations
most likely to be sharp, so they want measuring twice rather than pronouncing on
one reading.

Advice can be in millimetres. An Eb bass fundamental of 38.9 Hz is about 4.41 m
of tubing, so **1 cent ≈ 2.5 mm of tubing ≈ 1.3 mm of slide pull**. Approximate,
because a real instrument is not an ideal pipe — so measure, adjust, measure
again rather than pronouncing once.

**Three limits worth stating in the UI.** Your lips will hide the fault, because
correcting sharp notes is what playing is; trust the *pattern* across
combinations more than any absolute number. A cold instrument is a flat one, so
it has to insist on warming up. And valve combinations are systematically sharp
by construction — finding exactly that pattern is a sign the measurement is
real rather than noise.

## My Music, and why it is not a material

Agreed in discussion, deferred deliberately, and written down because the shape
of it is settled even though none of it is built.

**A player's own band parts get their own mode, not another card beside Themes.**
The reason is countable: of the twenty-one things the settings screen controls,
**nine are fixed the moment a piece is chosen** — the key, the key set, the
difficulty, the material, the theme count, the bars, the cycles, and both halves
of the time signature. That is the entire Exercise panel. A mode that accepted
those choices and then ignored them would be the gated settings fault again,
which this document already calls a blocker rather than a feature: silently
overriding a choice is worse than refusing it.

The twelve that survive are the ones about *how* you play rather than *what*:
instrument and clef, tempo, count-in, metronome, conductor, reading mode,
playback, hints, tolerance, scroll speed, weak-note drilling.

**It is gated**, which gives the gated settings screen a second customer. That
work was already the one thing standing between here and being sellable; it is
now also the thing standing between here and this.

### The seam already exists, and it is `Exercise`

A piece is **not** a kind of theme. Themes go through the stitcher to become an
`Exercise`; a piece goes through a parser to become one; after that they play,
judge, engrave and score identically, and nothing downstream needs to know which
it was. That is the whole architecture of it — a second producer, not a new
category.

Forcing both into one type would leave it half empty in both directions. A theme
is degrees, a difficulty, legal metres, and **no identity** — nobody asks for
theme fourteen, and on its own it is not a piece of music. A part has a title, a
composer, an absolute key, real pitches, a hundred and sixty-five bars, and it
is the only one of the two anybody asks for by name.

There is a transposition asymmetry too, and it is not retrofittable. A theme is
stored in degrees *precisely* so it plays in any key the player picks. A band
part is in a key, and moving it is a different feature with different rules.

### What a category would be good for, and it is not this

The grouping actually missing is smaller and nearer: **the five Twinkle
variations belong together and nothing says so**. A `set` on a theme would let
the app offer them in order, beginner through expert, which is a real practice
exercise and reads as one piece of music rather than five strangers. Character
tags — scalic, chromatic, lyrical, leaping — would be the other useful axis,
letting a player drill a shape rather than a level. Both are cheap now and
awkward at eighty themes.

## What imported music will actually contain

Learned from `Pendennis!`, and worth knowing before the importer is designed.

**A part is not read top to bottom.** That one has a segno, *To Coda*, *D.S. al
Coda*, a coda sign, first and second time bars, and repeats. Either the importer
unfolds all of it into playing order, or the app navigates it live. This is the
thing most likely to be underestimated: it is a bigger question than key changes.

*Since answered, in part.* **MusicXML states all of it as data**, not as text to
be interpreted: `<sound>` carries `segno`, `dalsegno`, `coda`, `tocoda`,
`dacapo`, `fine`, `forward-repeat` and `time-only`, `<ending>` carries its
number and type, and `<repeat>` carries `after-jump`. Verified against the
4.0.3 binding. So unfolding is mechanical rather than heuristic — see
`musicxml-import-plan.md`. Which of unfold or navigate-live to build is still
open.

**Multi-bar rests.** Eight bars of counted rest in one place. A trainer needs a
position on whether it counts them for you.

**Triplets** appear twice. Already the other half of step one.

**Rehearsal marks, dynamics, hairpins, articulations, tempo text.** None of it is
needed to play the right notes at the right time, and all of it is on the page a
player is reading. Decide deliberately what is dropped rather than by accident.

## The spike itself

`public/spike/` is a deliberately plain page with no build step, excluded from
the service worker so it can neither be precached nor swallowed by the
navigation fallback. It has live pitch detection, note segmentation, offline
analysis of any audio file the browser can decode, and a flight recorder that
keeps the last 15 seconds so an intermittent fault can be caught *after* it
happens.

`node public/spike/check.mjs` runs the detector against synthetic tones across
the band, and `node tools/analyse-recording.mjs <file.wav>` runs it over a
recording and prints the notes it heard.

`public/spike/conductor.html` is the other one, and is still worth keeping: it
exposes sliders the app does not — grip travel, how wide and how tall the pattern
is beaten, the legato-to-marcato style — and prints the two figures a shape is
argued with. It also prints a **fingerprint** of the drawn geometry, sampled off
the curve rather than hashed from the numbers behind it, because the shape has
twice changed without a coordinate moving and "am I seeing the new version?" is
otherwise unanswerable down a tunnel.

Both are throwaway. The conductor geometry has already been ported to
`src/render/conductor.ts`; the spike survives only as somewhere to argue. If the
microphone work resumes, the detector gets rewritten in TypeScript with the
recordings as fixtures; if it does not, the directory gets deleted.
