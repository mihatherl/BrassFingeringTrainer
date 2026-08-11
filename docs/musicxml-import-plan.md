# My Music — MusicXML import

**Status: researched, not agreed, not started.** No code exists. This records
what was established on 2026-08-11 so the next session does not re-derive it,
and states plainly which decisions are still the player's to make.

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

## What the unfolder would do

Input: a parsed document. Output: a flat list of measures in playing order.
Nothing else — no rendering, no generation, no audio.

The algorithm is well defined. Walk measures in order, holding a repeat stack
and a pass counter per repeat. Honour `time-only` and `ending number` to pick
the right pass. On `dalsegno`/`dacapo`, jump, and set a flag that both enables
`after-jump` repeats and arms `tocoda`. Stop at `fine`.

This is a self-contained job with a clean input and a clean output, testable
entirely on synthetic MusicXML written for the purpose, and independent of the
microphone, of Audiveris, and of everything in `render/`.

**Validate rather than trust.** A file with a `dalsegno` and no matching
`segno` cannot be unfolded, and the honest response is to say so — the same
principle as v1.33.0's gated settings screen, where refusing beat silently
doing something else.

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

## What has not been decided

1. **What happens to an unusable file.** Rejecting outright is honest;
   importing what can be read and naming what could not may be more useful.
2. **Whether multi-bar rests are played, skipped, or counted.** For practice
   there is a case for all three.
3. **Where imported music lives** — one at a time, or a library.
