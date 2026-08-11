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

## The one structural blocker, and the pattern that solves it

**`Exercise.metre` is singular.** A real part changes time signature; the type
holds one `Metre`. There are **42 non-test reads of `.metre`** across ten
files: `render/spacing.ts`, `render/review.ts`, `render/system.ts`,
`render/surface.ts`, `exercise/phrases.ts`, `exercise/theme.ts`,
`exercise/generate.ts`, `engine/session.ts`, `ui/PlayScreen.tsx`,
`ui/ResultsScreen.tsx`.

The fix is already written down in the same file. `Exercise.keys` is a list of
`KeyChange` for exactly this reason, and its comment names the parallel:

> A list rather than one number because a part changes key, often several
> times — **the same reason `metre` is a shape of its own** rather than a loose
> numerator. Ask it with `keyAt`; a single-key exercise is a list of one and
> costs nothing.

So the shape to copy exists and is proven: `keyAt(changes, beat)` in
`domain/keys.ts`, with `changesKey` for the many callers that only care
whether it ever changes. A `metreAt`/`changesMetre` pair alongside it, and the
42 sites migrated, is the work.

Worth doing before the importer rather than after: the importer would otherwise
have to either reject any part that changes metre, or silently keep the first
one.

## What has not been decided

1. **Unfold, or navigate live?** Unfolding produces a flat exercise that every
   existing consumer already understands, at the cost of a longer piece and of
   losing the printed structure. Live navigation keeps the page as written and
   follows the repeats during play, which is what a player actually reads from,
   but touches the transport, the renderer and the scoring window. The
   recommendation is **unfold first** — it is the smaller change, it is
   independently testable, and it can feed live navigation later — but this is
   the player's call.
2. **What happens to an unusable file.** Rejecting outright is honest;
   importing what can be read and naming what could not may be more useful.
3. **Whether multi-bar rests are played, skipped, or counted.** For practice
   there is a case for all three.
4. **Where imported music lives** — one at a time, or a library.
