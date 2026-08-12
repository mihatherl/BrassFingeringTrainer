# My Music — MusicXML import

**Status: built and shipping, v2.0.0.** A part exported from MuseScore can be
opened, read, played, and is still there on a cold start. What is left is named
under *What is still to do* and none of it blocks using the feature.

This page records what was established rather than what was guessed, and every
claim in it was checked against the schema, the binding or a real file. Where an
earlier version of it was wrong, the correction is left in place and marked, so
that nobody re-derives the mistake from confident-sounding prose.

The scope was set by the player and is worth quoting, because it settles a
question that would otherwise recur:

> I'd separate here my own personal usage of it from that of an app I one day
> might ship. **The app would have to presume that the user can import
> MusicXML, how they get it is up to them.**

So scanning is not the app's problem. Audiveris was installed and tried this
session — it reads clean synthetic engraving at about 95% pitch accuracy and
was structurally unusable on a phone photograph of a real part (160 measures
where there are about 105, no segno, no coda, no text, because no OCR
languages are installed). That is a finding about *scanning*, not about the
app, and it does not block anything here.

## Does MusicXML carry the navigation? Yes.

Verified against the **ProxyMusic 4.0.3** binding bundled with Audiveris
(`/opt/audiveris/lib/app/proxymusic-4.0.3.jar`) — a generated JAXB binding, so
its fields *are* the schema rather than a recollection of it.

MusicXML states navigation in **two layers**, and the distinction is the whole
answer:

**The visual layer** — `<direction-type>` holding `<segno/>`, `<coda/>`, and
`<words>D.S. al Coda</words>`. This is what gets engraved. Reading it means
parsing English out of free text.

**The semantic layer** — the `<sound>` element, which exists so that software
can play the piece. Confirmed accessors on `Sound`:

| attribute | meaning |
|---|---|
| `segno` | this point is a segno, under this label |
| `dalsegno` | jump to the segno of that name |
| `coda` | this point is a coda |
| `tocoda` | jump to the coda of that name |
| `dacapo` | back to the beginning |
| `fine` | stop here |
| `forward-repeat` | a forward repeat |
| `time-only` | applies only on the listed passes, e.g. `"2"` or `"1,3"` |

Because `dalsegno` *names* its target, a piece with two segnos is unambiguous.
This is the layer an unfolder should read; the visual layer is for drawing.

**First and second time bars** — `Ending`, with `number` (a string, and a list:
`"1,2"` is legal), `type` (`StartStopDiscontinue`: start / stop / discontinue),
and `value` (the visible text, which may differ from the number).

**Repeats** — `Repeat`, with `direction` (`BackwardForward`), `times`, `winged`,
and **`after-jump`**. That last one is the subtle case that makes hand-rolled
unfolders wrong: a repeat marked `after-jump="yes"` is taken only *after* a
D.S. or D.C., not on the first pass.

**Multi-bar rests** — `MultipleRest`, with a bar count and `use-symbols`. An
eight-bar rest is one element, not eight empty bars. Brass band parts are full
of these and the count must survive import intact.

## The unfolder — built, v1.40.0

`src/import/unfold.ts` and `src/import/musicxml.ts`. In, the navigation marks of
each written measure; out, the source measures in playing order.

**Split in two, and the split is what makes it testable.** `unfold.ts` holds the
algorithm and has never heard of XML; `musicxml.ts` knows the format and holds no
algorithm. Neither test has to set up the other half to say anything.

**Five rules where the obvious reading is wrong**, each pinned by a test and each
confirmed to bite under mutation:

| rule | why the obvious reading fails |
|---|---|
| `times` counts **playings**, not jumps | `times="3"` is two jumps back, not three |
| a jump is taken **once** | arriving at the same D.C. again means it has done its work; without this the commonest shape in the repertoire is an endless loop |
| Fine and To Coda act **only after a jump** | on the way through they are instructions for later; obeying them the first time ends the piece halfway and looks deliberate |
| an ordinary repeat is **not** taken past a jump, an `after-jump` one **only** there | the ordinary reading of D.C.; and an opt-in attribute cannot be describing the default |
| past a jump, the **last** ending is played | a first-time bar exists to lead back into the repeat, and a D.C. is not repeating |

That last one was found by a test rather than reasoned out in advance.

**Validate rather than trust**, and the failure mode is the one already decided:
an unresolvable part plays straight through and says why. A ceiling guards
against a corrupt `times`, which is the one unbounded quantity in the format.

## The part reader — built, v1.41.0

`src/import/part.ts`. Reads what is in the measures and ends at
`assembleExercise` — the same function the generator ends at, so an imported
part is beamed, bracketed and given its accidentals by the code that draws
generated material rather than by a second set of rules.

Two small changes made that possible: `AssembleOptions` takes a metre list
rather than one metre, and a pitch handed to it may be a `SpelledPitch` rather
than a MIDI number. The generator chose a pitch and the key decides its
spelling; a publisher who wrote G flat is not to be second-guessed.

**Everything is read in playing order, not written order.** A key change inside
a repeated section comes into force twice at two different beats, and a D.S.
back to the top restores the opening key. Changes are recorded only where
something changed — a MuseScore export restates the signature every bar, and
`changesKey` counts entries.

Two rules the tests found rather than confirmed:

- **A length no single value says is written as tied notes, not silence.** Two
  and a half beats is a minim tied to a quaver. Only what falls off the grid
  entirely is dropped, and its time still passes.
- **A pickup is padded to the bar line.** Nearly every march has one, and every
  bar line is placed by counting whole bars from the start — a short first bar
  would put all of them adrift, and with them every bar number.

### A real part, end to end

On 2026-08-12 the player exported a part from MuseScore and it read correctly:
**42 written bars unfolding to 61 played**, every bar reached, the only warning
being the divided notes. It exercised, on genuine output rather than on anything
written here:

- a repeat with first- and second-time bars, and two more interior repeats
- a D.S. to a named segno, a To Coda that stayed silent until the jump armed it,
  and a coda
- a change of time signature, 4/4 into 3/4
- four key changes, landing at **played** beats 0, 12, 52 and 181 rather than
  where they sit on the page — the playing-order rule doing real work

Getting there took four fixes, and every one of them was found by the file
rather than by a test: `<forward>` ignored so two bars came out empty and six
beats short; a demisemiquaver dropped for want of a note value; a time signature
change never drawn; and bars nothing reached going unreported.

## The front door — built, v1.42.0 and after

My Music on the settings screen: a plain `<input type="file">` reading
`.musicxml` or `.mxl`, a part chooser where a score has more than one, the
warnings shown *before* anything is played, and Play it.

`.mxl` is opened without a dependency — a zip is a few offsets and
`DecompressionStream('deflate-raw')` is built in. Compressed or not is decided
from the first four bytes rather than the extension.

**Where a part divides**, the player says which line to read (v1.45.0). One line
is read, not both, because one notehead is drawn and one octave is heard, and
drawing two while sounding one would be three stories on one stem. At the octave
— how a bass part nearly always divides — the fingering is the same either way,
so the choice costs the octave you read and hear rather than the practice.

## What is still to do

- ~~Nothing is kept.~~ **Built in v2.0.0.** The library keeps the *file*, not
  the exercise, and re-reads it on open — so a piece improves when the importer
  does, and changing instrument re-fingers the music. Keeping the same part of
  the same file again replaces it rather than duplicating it, because
  re-exporting after a correction is the ordinary way to work.

  The store is behind an interface: the test environment has no IndexedDB, and
  adding a fake one is a dependency this app has managed without. The contract
  is tested against an in-memory store and the adapter was driven in a real
  browser across a cold start.
- **Tempo marks are not read.** `<sound tempo>` is quarter-notes per minute and
  the app's tempo names the *pulse*, so it needs the v1.30.0 conversion. Cheap,
  and deliberately left until the library exists.
- **`<transpose>` is ignored, by design and untested.** The written pitches are
  taken off the page and the player's own instrument decides the fingerings,
  which is what lets a tuba player read a cornet part. No file carrying a
  transposition has been through it yet.
- **The part chooser has not met a real multi-part score.** Its logic is
  covered; a real one has not been tried.
- **The long-rest skip is not offered.** The ruling — over ten seconds at the
  designated tempo, ask, and come back in at the bar before — needs a screen to
  ask on.
- **`.mxl` is not opened.** The mechanism was confirmed to exist
  (`DecompressionStream('deflate-raw')`, no dependency) and is not built.

**Not every exporter writes the `<sound>` layer.** MuseScore, Sibelius and
Finale do; it is what it is for. The Audiveris output generated this session
wrote 26 `<sound>` elements and zero segno or coda — but only because OMR never
recognised the symbols. A well-formed export from notation software is a
different proposition from an OMR result, and the importer should be written
against the former.

## What was checked about the tooling

- **No dependency is needed to parse.** `DOMParser` is built in.
- **Tests must opt into a DOM.** Vitest defaults to node here, where
  `DOMParser` is undefined; the repo's convention is the
  `// @vitest-environment happy-dom` pragma, and happy-dom parses MusicXML
  correctly including `sound`, `ending` and `repeat` attributes. Verified.
- **Malformed XML does not throw.** `DOMParser` returns a document containing
  a `parsererror` node, so the importer must check for one explicitly.
  Verified.
- **`.mxl` is a zip.** `DecompressionStream` exists in both the browser and the
  test environment and supports `deflate-raw`, which is what zip entries use —
  so a compressed MusicXML file can be opened with a small central-directory
  reader and no dependency. Not built; the mechanism was confirmed to exist.

## The structural blocker — done

**`Exercise.metre` was singular.** It is now `Exercise.metres: MetreChange[]`,
built on the shape `keys` had already proven. Done on 2026-08-11, before the
importer rather than after, because the alternative was an importer that either
rejected any part changing time signature or silently kept the first one — and
silently keeping the first one is the fault v1.33.0 had just fixed elsewhere.

`domain/metre.ts` gained:

| | |
|---|---|
| `MetreChange` | `{ fromBeat, metre }`, in beat order from 0 |
| `metreAt(changes, beat)` | the metre in force, exactly as `keyAt` |
| `changesMetre(changes)` | for callers that only care whether it ever moves |
| `barCount(changes, totalBeats)` | replaced seven copies of `Math.ceil(totalBeats / barBeats)` |

and **`barAt` / `beatOfBar` now take the list**, because bar numbering is the
thing a metre change actually breaks: `beat / barBeats` is right up to the
change and wrong for every bar after it. There is one way to ask, not two.

A generated exercise is a list of one and behaves exactly as before — 620 tests,
build and lint green on the migration. The generator still works in a single
`Metre` internally and `assembleExercise` wraps it, which keeps the plural shape
at the one boundary that needs it.

**A change is assumed to fall on a bar line.** Music does write a short bar
before one, but that is a *partial bar* — its own thing, and not something to be
inferred from a change landing in an odd place. Recorded in `MetreChange`.

### What the migration deliberately did not do

Three places take the metre the piece **opens in** and would have to learn to
follow a change. None of them can be exercised yet, since nothing generates such
a part; all three are commented at the call site.

- **The transport** (`engine/session.ts`) is told `pulseBeats` once at
  construction. That is the conversion from the player's chosen beat to
  crotchets, so a part turning from 4/4 into 6/8 changes what their number
  means. The metronome *does* follow the change — it walks bar by bar, and a
  test holds it to 2/4 then 6/8.
- **The conductor panel** (`ui/PlayScreen.tsx`) gets one `Metre`. It already
  changes pattern when the tempo steps across a threshold (v1.36.0); doing the
  same on a metre change is the same kind of move.
- **The renderer draws no mid-line signature.** Bar lines land correctly through
  a change and each system's header states what is in force where the line
  begins, but a change part-way along a line is not engraved where it falls.
  Key changes already are — `drawKeyChange` in `render/system.ts` is the model,
  and this is the same job.

The header widths in `render/review.ts` and `render/surface.ts` already reserve
room for the **widest signature the piece reaches**, on the same reasoning that
made them reserve room for the widest key: a panel that resized mid-exercise
would shift the strike line and the notation would appear to lurch.

## What has been decided

**Unfold.** Settled by the player on 2026-08-11. The importer resolves repeats,
endings and jumps once, and hands the rest of the app a flat list of measures in
playing order — the shape every existing consumer already understands, so the
renderer, the transport and the scoring window need no change at all.

The cost is accepted and worth stating so it is not rediscovered as a bug: an
unfolded piece is **longer than the printed part**, and the printed structure is
**gone from the page**. A part with a repeat renders as two passes written out.
That is the trade, and live navigation — which keeps the page as engraved and
jumps the playhead — remains possible later without being the price of the first
version.

## An unusable file — three tiers, not two

Settled on 2026-08-11. The player's framing was "if it does not parse, fail
gracefully; if it parses but is missing bits, warn and substitute rests". Right
at both ends; the middle tier is the one where rests would be actively wrong.

**Tier 1 — nothing to read.** Not XML, or XML that is not MusicXML. Refuse, and
name why. Note the trap: `DOMParser` **does not throw** — it returns a document
containing a `parsererror` node, so the importer has to go looking for one.

**Tier 2 — the music reads, the navigation does not.** A `dalsegno` naming a
segno that is not in the file, a backward repeat with nothing to repeat to, an
`ending` that starts and never stops. **Nothing is missing here**, so nothing
should be replaced by a rest: every note is present and correct, and only the
route through them is broken. Import it **as printed and play it straight
through**, saying the repeats were not followed. A piece played once through is
a legitimate practice object; a piece unfolded halfway is not.

**Tier 3 — the music reads, but some of it is not representable.** Here rests
are right, under one rule:

> **A rest is the correct substitute only for something that occupies time.**

| what | what happens |
|---|---|
| dynamics, articulations, slurs, text | occupy no time, change no fingering — dropped silently |
| grace notes | occupy no counted time — dropped, mentioned once as a count |
| chords | occupy time and are *playable* — take the top note, since the instrument is single-line and the top note is the part |
| a bar that cannot be read at all | a rest of exactly the right length |

And the principle underneath all of it, which is the actual reason a rest is the
fallback:

> **Whatever is dropped, the bar count must not shift.**

A player navigates by bar number — "from 47", "four before B". A dropped element
that silently shortened a bar would misnumber every bar after it and make the
part useless against the rest of the band. So every substitution preserves time,
and a rest is the only thing that occupies time while asking nothing.

**Warnings are countable, never vague.** "Bars 12, 45, 46 unreadable, replaced
by rests" can be checked against the printed part; "some content could not be
imported" cannot. The same principle as v1.33.0: never show one thing and hold
another.

## Multi-bar rests — skip the long ones, on the player's say-so

Settled on 2026-08-11, by the player, in this form: **a multi-bar rest lasting
more than ten seconds at the designated tempo offers to be skipped, and the skip
comes back in at the bar directly before it.**

Under ten seconds it is played as written — silence you can count through is
part of the practice.

Three things follow:

- **"The designated tempo" already has a mechanism.** `steppedTempoAt` draws
  exactly that line: what has been *declared* over the stave, as against what
  the clock is doing this instant. A sixteen-bar rest printed under 60 is
  measured at 60 even if a rit. is bending through it.
- **Keeping the bar before is musically exact** — you need a bar to get the
  instrument up. It is distinct from the app's count-in, which is a separate
  thing at the start of a run.
- **Asked once per import, not once per rest.** "This part has 4 rests over ten
  seconds — 22, 16, 31 and 12 bars. Skip them?" Four questions during one import
  is worse than one.

**Both pieces of missing work this exposed are now built**, since brass band
parts make them unavoidable rather than optional:

- **Bar numbers** — v1.38.0. At the head of each system, every fifth bar on the
  scrolling line, counted from one, never on the opening bar.
- **The multi-bar rest** — v1.39.0. `RestEvent.bars`, drawn as the thick bar
  with its count in the time-signature figures.

## Bar repeats — a display style, not missing music

The player raised the percent-like sign that means *play the previous bar
again*, and asked whether it needs unfolding.

**An earlier version of this page said it did, and that the bars carrying it are
empty in the file. That was wrong.** It was written from the ProxyMusic binding,
which gives the fields and not the meaning. The schema itself — `musicxml.xsd`,
bundled in the same jar — settles it:

> The measure-repeat element specifies a notation style for repetitions. **The
> actual music being repeated needs to be repeated within each measure of the
> MusicXML file.** This element specifies the notation that indicates the repeat.

`beat-repeat` carries the same sentence. So `measure-style` is an instruction
about **what to draw**, not about what to play: a conforming file already holds
the notes, and an importer that ignores it produces the right music written out
in full rather than as a percent sign. There was never silence to be had here.

What that costs, given the app already unfolds repeats and writes everything
out: nothing. The printed structure was given up when unfolding was chosen, and
a percent sign is printed structure.

| element | fields | what an importer must do |
|---|---|---|
| `measure-repeat` | `value` (1 or 2), `type` (start/stop), `slashes` | nothing — the notes are in the measures |
| `beat-repeat` / `slash` | `slash-type`, `use-dots`, `use-stems` | nothing, for the same reason |
| `multiple-rest` | `value` (bar count), `use-symbols` | **skip the measures it covers** — this one really is a count standing in for bars, and they are in the file as rests |

**The one thing worth defending against** is an exporter that does not conform —
one that writes the sign and leaves the measures empty. OMR output is the
plausible source, and a bar of silence under a repeat sign is silence that looks
deliberate. So the reader fills an *empty* measure inside a `measure-repeat`
region from the pattern before it, and leaves a measure that has notes alone.
Correct against a conforming file and against a careless one.

Two details worth keeping:

- **`value` is 1 or 2**, so a two-bar repeat copies a *pair*. The pattern is the
  N measures immediately before the region starts.
- **`slashes` is presentation, not meaning.** How many strokes to draw; it says
  nothing about how many bars are involved, and the two are easily conflated.

### The rule this was supposed to illustrate, corrected

The line still holds, but bar repeats are not an example of it:

> **Unfold what is shorthand for the order of the music. Keep what is shorthand
> for reading.**

A D.S., a first-time bar and a repeat sign change *which measures are played and
when*, so they are unfolded. A multi-bar rest is shorthand for reading — the
count is the notation, and expanding it destroys the only thing it carries. A
bar repeat is neither: it changes only what is *printed* in a measure whose
music is already there.

## Where imported music lives — an IndexedDB library

Settled on 2026-08-11. The player's instinct was that on an iPhone this would be
obvious — the app's own local data store — and it does translate; IndexedDB is
that thing. Chosen over picking a file each session, over a cache-with-re-link
scheme, and over pointing at a folder on disk.

**`localStorage` was ruled out rather than considered.** Roughly 5MB for the
whole origin, already shared with settings, stats and the licence flag,
synchronous so it blocks the main thread, and strings only. Everything the app
stores today lives there, which is exactly why music must not.

**The File System Access API was ruled out on reach.** `showDirectoryPicker` on
a folder of parts is elegant on a desktop and is Chromium-only — no Safari, no
Firefox, and not on iOS. For a player who may want this at a rehearsal on a
phone, the platform gap is the whole story.

So: **a library, in IndexedDB, holding many pieces with their metadata**, async,
quota a share of free disk rather than 5MB, working offline like the rest of the
app.

Two things hold whatever else changes:

- **Import is `<input type="file">`.** It works on every browser including iOS,
  needs no permission prompt and no API that might not be there.
- **Keep the original file bytes alongside the parsed result.** A later
  improvement to the importer can then re-import without asking the player to go
  and find the file again — which they may no longer have.

**Eviction is the one real risk and needs checking on a device before it is
relied on.** Browser storage is evictable; `navigator.storage.persist()` asks
for exemption, and installing to the Home Screen is understood to change what
Safari does about it. Neither is currently used anywhere in the app — treat the
behaviour as something to verify on the actual phone, not to assume.
