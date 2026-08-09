# Version 2 — direction and the thinking behind it

Written after v1.0.0 was tagged and deployed. Everything here was decided in
discussion; none of it is derivable from the code, and several of the rulings
came from playing experience rather than from reasoning about the software. It
is written down so it does not have to be argued out again.

## Where things stand

**v1.0.0** was an installable PWA drilling valve fingerings against notation,
judged by three on-screen buttons. Fully offline, no backend, no runtime network
requests at all — that last part is worth defending rather than an accident.

**v1.7.0 is deployed** to GitHub Pages, 472 tests. Since v1:

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

### Where to look

| | |
|---|---|
| `src/domain/keys.ts` | `keyAt`, `orderByCloseness`, `widestKey`, spelling. The key model. |
| `src/domain/metre.ts` | Bar length, pulse, `barAt`. The model `keys.ts` was built to match. |
| `src/engine/clock.ts` | `timeForBeat`, `beatForTime`, `secondsBetween` — the three functions a tempo map replaces. |
| `src/exercise/generate.ts` | Rhythm, pitch, key placement. Patterns are generated the opposite way round from free material; the comment on `generateExercise` says why. |
| `src/exercise/ties.ts` | How the rest of the app reads a tie. |
| `src/exercise/theme.ts` | The theme format, its validator, and degrees into a key. |
| `src/exercise/themes.ts` | The corpus itself. Eighteen, hand-written; every difficulty covered in 4/4. |
| `src/exercise/phrases.ts` | Choosing themes and laying them end to end. Named for the kind it first served; it now serves *Themes*. |
| `tools/theme-sheet.mts` | `npm run themes` — the whole corpus engraved on one page, for deciding what to keep. |
| `src/exercise/assemble.ts` | Slots and pitches into an `Exercise`. Shared by generated material and themes so the two cannot drift. |
| `src/render/stave.ts` | `layoutKeySignature` — one arithmetic shared by drawing and measuring, including the naturals that cancel an outgoing key. |
| `src/render/surface.ts` | Both reading modes. `staveSpaceCeiling` is the unit the whole play screen is sized from. |
| `src/render/conductor.ts` | Pattern geometry, ported from the spike. |
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

## The direction

In order. Each step is useful on its own, so this need not be delivered as one
release.

1. ~~**Ties**~~ — built. Tuplets are not, and are still worth having: timing
   already works in floating-point beats, so a triplet crotchet at ⅔ of a beat
   schedules, judges and spaces correctly today. What is missing is purely
   notational — bracket, numeral, beaming.
2. ~~**Key changes**~~ — built. See *Key changes, in detail*.
3. ~~**Themes**~~ — built, as a material kind of its own rather than as a better
   sight-reading. Written tunes stored as scale degrees, agnostic of key and
   tempo. The corpus is the work that remains. See *Themes, and playing for as
   long as you like*.
4. **Windowed scoring** — the score covers the last so many bars rather than
   the whole session. Small, independent, and useful on its own.
5. **Endless play, with a grey horizon** — music continues past the chosen
   length in grey; play on and it goes white. The invasive one, and cheaper
   after 3, since a theme boundary is already a bar line.
6. **A tempo map** — step changes first. The only thing between here and a
   fermata, and the conductor's best argument: a metronome cannot teach anyone
   to follow a rit. by definition. It slots either side of 3–5; it decides only
   whether a theme's rit. breathes.
7. **The microphone as input**, instead of the buttons. Proven in a spike and
   parked; see *The microphone, parked*. It also answers the one hard question
   in 5 — it can hear that you have stopped.
8. **MusicXML import from a local file.**
9. **A server**, only if step 8 shows people want a library rather than their
   own files.

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

**They arrive at Medium**, alongside dotted rhythms, and never in a scale or
arpeggio — that drill is the shape and the fingering, and a tie there is a
reading problem laid on top of a different exercise. `tieChance` is conditional:
how often a bar end that *could* be tied over is, rather than a rate diluted by
every position that could never have produced one. Measured at roughly one tie
every three bars.

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

**The corpus is published**, at `spike/themes.html` on the deployed site — every
theme engraved, from a phone, with nothing to run. It is generated rather than
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

- **The style is fixed at "lively"** with no control in the app. It wants to be a
  setting, and specifically a *difficulty* one: a smooth conductor is markedly
  harder to follow, and finding the beat in a vague gesture is a real skill no
  metronome can teach. Imported music could carry it, alongside the tempo marks.
- **Five and seven patterns** are drawn on the reference sheet in `input/` and can
  be added from it. Until then those metres get no conductor.
- Only 2, 3 and 4 pulse patterns exist, which covers every metre the settings
  screen offers plus 6/8, 9/8 and 12/8.

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

## Fermata

Draw it whenever, but it has no honest meaning against a metronome. A fermata
means "hold until released" and there is no conductor to release you. It becomes
practisable exactly when there is something that can release you — the on-screen
conductor, or the microphone hearing you stop.

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

### The gated settings screen — the blocker, and how to fix it

**The fault.** On a gated build the settings screen offers everything, accepts
the choice, shows it as selected — and then something else happens. `App.tsx`
hands *unconstrained* settings to `SettingsScreen` (`App.tsx:131` passes
`chosen`, while only `build` and `PlayScreen` get the constrained copy), and
`SettingsScreen` never imports entitlements at all. `constrainToEntitlements`
substitutes at exercise-build time instead, silently. Verified in a browser
against `VITE_GATED=true`: asking for 24 bars of Expert in D major produced
four bars of Easy in C major with nothing on screen admitting it. `isLimited`
in `entitlements.ts` exists for precisely this and is called nowhere.

Nobody is affected today — the shipped build is ungated and withholds nothing —
and CI compiling the gated app cannot catch this, because it compiles fine. But
it must be fixed before anything is sold. Silently ignoring a choice is worse
than refusing it: a player who picks D major and is given C will conclude the
app is broken, not that it is limited, and that is the worst possible first
impression for something asking to be paid for.

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

## What imported music will actually contain

Learned from `Pendennis!`, and worth knowing before the importer is designed.

**A part is not read top to bottom.** That one has a segno, *To Coda*, *D.S. al
Coda*, a coda sign, first and second time bars, and repeats. Either the importer
unfolds all of it into playing order, or the app navigates it live. This is the
thing most likely to be underestimated: it is a bigger question than key changes.

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
