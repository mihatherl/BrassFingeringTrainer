/**
 * Reading one part of a MusicXML score into an `Exercise`.
 *
 * The third and largest piece of the importer. `unfold.ts` decides which
 * measures are played and in what order; this reads what is in them and hands
 * the result to `assembleExercise`, which is the same function the generator
 * ends at — so an imported part is beamed, bracketed and given its accidentals
 * by exactly the code that draws generated material, rather than by a second
 * set of rules that would drift.
 *
 * ## Everything is read in playing order, not written order
 *
 * MusicXML attributes are sticky: `divisions`, the key and the time signature
 * hold until something changes them. Once repeats are unfolded, "what is in
 * force here" is a question about where the *walk* has got to and not about
 * where the measure sits on the page — a key change inside a repeated section
 * comes into force twice, at two different beats. So the state is carried
 * through the playing order, and `keys` and `metres` are built from the beats
 * the changes actually land on.
 *
 * ## What is dropped, and the rule that decides it
 *
 * Settled with the player on 2026-08-11 and recorded in
 * `docs/musicxml-import-plan.md`:
 *
 * > **A rest is the correct substitute only for something that occupies time.**
 *
 * So articulations, dynamics and slurs go silently — they occupy no time and
 * change no fingering. Grace notes go and are counted. A chord gives up its
 * **top** note rather than becoming a rest, because a chord occupies time and
 * is playable, and on a single-line instrument the top note is the part. Only
 * something that occupies time and cannot be read becomes silence.
 *
 * Underneath all of it: **whatever is dropped, the bar count must not shift.**
 * A player navigates by bar number, and a substitution that shortened a bar
 * would misnumber every bar after it and make the part useless against the rest
 * of the band.
 */

import { soundingFromWritten, type Clef, type Instrument } from '../domain/instruments';
import { isPlayable } from '../domain/fingering';
import type { KeyChange } from '../domain/keys';
import { barAt, barCount, beatOfBar, metreFor, type Metre, type MetreChange } from '../domain/metre';
import { midiOf, type Letter, type SpelledPitch } from '../domain/pitch';
import { durationBeats, durationFromBeats, snapBeat, type Duration } from '../domain/rhythm';
import { assembleExercise, type Slot, type SlotPitch } from '../exercise/assemble';
import type { Exercise, RestEvent } from '../exercise/types';
import { parts, readNavigation } from './musicxml';
import { unfold } from './unfold';

/**
 * Which line to take where a part is divided.
 *
 * Brass band bass parts are written divided on one stave — most often the same
 * note an octave apart — and the section agrees who plays which. The app cannot
 * know that agreement, so it asks rather than choosing.
 *
 * **One line is read, not both**, because a choice is unavoidable: `NoteEvent`
 * holds one pitch and one sounding note, so exactly one notehead is drawn and
 * exactly one octave is heard. Drawing two while sounding one and accepting
 * either would be three different stories on one stem — the fault v1.33.0
 * exists to prevent.
 *
 * **What the choice does not cost is the fingering.** A tuba's octave is the
 * same valve combination on a different harmonic, so at the octave — which is
 * how a bass part nearly always divides — either line drills the same thing,
 * and picking the one your section did not give you costs you the octave you
 * read and hear rather than the practice. Where a part divides by something
 * other than an octave the fingerings do differ, and then the choice is the
 * whole of it.
 */
export type Divisi = 'upper' | 'lower';

/** A run of consecutive bars of the printed part, by measure index, inclusive. */
export interface BarSpan {
  from: number;
  to: number;
}

/**
 * The measures a run of *drawn* bars is made of.
 *
 * Three things count bars here and no two of them agree on a scanned part:
 *
 * | | on one real file |
 * |---|---|
 * | the bar as drawn, which a tap lands on | 78 |
 * | the measure in the file, which a reading walks | 84 |
 * | the number printed on the page | "82" |
 *
 * They coincide on a tidy export and separate everywhere else. A multi-bar rest
 * is one measure drawn as twenty bars. A scanner that splits a bar across two
 * measures gives two measures drawn as one bar, and both carry the same printed
 * number — which is how a part with 87 measures comes to have 82 bars numbered
 * up to 84.
 *
 * So a selection made by tapping has to be translated before it can be read,
 * and this is that translation. Without it the picker asked for measure 78 when
 * the player pointed at the bar printed 82, and got them music six bars early.
 *
 * The far end runs up to the bar *after* the last one chosen, so a bar made of
 * two measures gives up both. Where nothing follows, it runs to the end of the
 * part: `importPart` clamps, and "everything from here on" is what the last bar
 * of a selection means.
 */
export function measuresFor(bars: readonly ImportedBar[], span: BarSpan): BarSpan {
  const from = bars[span.from]?.source ?? span.from;
  const after = bars[span.to + 1]?.source;
  return { from, to: after === undefined ? Number.MAX_SAFE_INTEGER : after - 1 };
}

/**
 * Which measures are read, and in what order.
 *
 * Everything the importer can be asked for is a *walk* — a list of measure
 * indices — and these are the three walks worth naming. The whole apparatus
 * below reads whichever list it is given, so practising eight bars costs the
 * same machinery as playing the piece, and the music comes out beamed,
 * bracketed and spelled by exactly the code that does it for the whole part.
 *
 * - **played**: the piece as performed, repeats and jumps unfolded.
 * - **printed**: each measure once, in the order it sits on the page. What the
 *   score view draws, because bars are chosen off the page rather than off the
 *   performance.
 * - **passage**: the chosen runs of bars, one after another, a bar of rests
 *   between them, the lot repeated so there is more to play on Continue.
 *
 * **A passage takes each span once, whatever signs are inside it.** A repeat
 * within a selected run is not taken: the player pointed at bars on the page
 * and gets those bars, so eight selected is eight played. Ruled by the player
 * on 2026-08-13; selecting the same run twice is how to ask for it twice.
 */
export type Reading =
  | { kind: 'played' }
  | { kind: 'printed' }
  | {
      kind: 'passage';
      spans: readonly BarSpan[];
      /** Times round the whole selection. Absent lets `passesFor` decide. */
      times?: number;
    };

/**
 * In a walk, a bar of silence rather than a measure of the file.
 *
 * How the join between two selections is written. It is not a measure of the
 * part — nothing in the file corresponds to it — so it cannot be an index, and
 * a sentinel keeps the walk one list rather than a list with a parallel one
 * beside it saying where the gaps go.
 */
const REST_BAR = -1;

/**
 * Bars of practice worth having ready behind the chosen length.
 *
 * Its own figure rather than the generator's `HORIZON_BARS`, which is 200 and
 * sized for material that is being invented as it goes. A selection is music
 * the player already has, laid out again, so every bar past the first pass
 * costs note events for something they may never reach.
 */
const PRACTICE_HORIZON_BARS = 96;

/**
 * How many times round a selection, when the caller does not say.
 *
 * Enough music that Continue has somewhere to go, which is the whole reason to
 * repeat at all: the offer at the end of a run reads `totalBeats` past
 * `chosenBeats`, so a selection built once through would end with nothing to
 * offer. Bounded both ways — a two-bar selection does not want two hundred
 * passes, and a hundred-bar one does not want its notes multiplied by twelve.
 */
export function passesFor(bars: number): number {
  if (bars <= 0) return 1;
  return Math.max(2, Math.min(12, Math.ceil(PRACTICE_HORIZON_BARS / bars)));
}

export interface ImportOptions {
  /** The instrument the player is reading on, which decides the fingerings. */
  instrument: Instrument;
  /** Which line to read where the part divides. Upper if not said. */
  divisi?: Divisi;
  /** Which part of the score. `partNames` is there to ask with. */
  partIndex?: number;
  /**
   * The clef to read in, where the part does not say or says something the app
   * has no stave for. The part's own clef wins when it is one of the two.
   */
  clef?: Clef;
  /** Which measures to read. The whole piece as performed, if not said. */
  reading?: Reading;
}

/**
 * One bar of what came out, against the page it came from.
 *
 * The importer knows every bar's printed number and then threw it away, which
 * was fine while the only thing to do with a part was play it from the top.
 * Choosing bars needs the numbers on the player's own page — "from 17 to 24"
 * has to mean the bars printed 17 and 24, not the seventeenth and
 * twenty-fourth things that happen to be played.
 */
export interface ImportedBar {
  /** As printed. Null for a bar the app inserted, which the page does not have. */
  number: string | null;
  /** Index into the part's measures, or -1 for an inserted bar of rests. */
  source: number;
  /** Where it begins, in crotchets from the start of the exercise. */
  startBeat: number;
}

export interface Imported {
  /** Null only when there was nothing playable to build from. */
  exercise: Exercise | null;
  /**
   * Every bar of the exercise, in order, against the page it came from.
   *
   * What a score view labels its bars with and what a selection is expressed
   * in. Empty when there is no exercise.
   */
  bars: ImportedBar[];
  /**
   * What could not be imported, counted and located.
   *
   * Countable and never vague — "3 chords reduced to their top note" can be
   * checked against the printed part and "some content could not be imported"
   * cannot. The same principle as v1.33.0's gated settings screen: never show
   * one thing and hold another.
   */
  problems: string[];
}

/** MusicXML writes note letters as `<step>`; the app calls them letters. */
const STEPS: Record<string, Letter> = {
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
  G: 'G',
  A: 'A',
  B: 'B',
};

function text(parent: Element, selector: string): string | null {
  return parent.querySelector(selector)?.textContent?.trim() ?? null;
}

function number(parent: Element, selector: string): number | null {
  const raw = text(parent, selector);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** What one written measure holds, before anything is decided about order. */
interface MeasureBody {
  /** Ticks per crotchet in force from this measure, when it says. */
  divisions: number | null;
  fifths: number | null;
  metre: Metre | null;
  clef: Clef | null;
  /** Bars covered, when this measure opens a multi-bar rest. */
  multiRest: number | null;
  /**
   * A `measure-repeat` beginning or ending here, and how many bars its pattern
   * covers. `null` where the measure says nothing about one.
   */
  repeatStyle: { type: string; bars: number } | null;
  /**
    * The measure's timeline: notes, and the `<forward>` and `<backup>` elements
    * that move the cursor without sounding anything, in document order.
    *
    * All three together rather than the notes alone, because the cursor is what
    * decides where the next note falls — a measure whose notes are read without
    * its forwards is a measure that comes out short, and every bar line after it
    * lands adrift by that much.
    */
  items: Element[];
  /** A short bar the engraver has told us not to count — a pickup. */
  implicit: boolean;
  number: string;
}

function readRepeatStyle(measure: Element): { type: string; bars: number } | null {
  const element = measure.querySelector('attributes > measure-style > measure-repeat');
  if (!element) return null;
  const bars = Number(element.textContent?.trim());
  return {
    type: element.getAttribute('type') ?? 'start',
    // One if the file does not say, which is what a lone percent sign means.
    bars: Number.isFinite(bars) && bars > 0 ? bars : 1,
  };
}

function readClef(measure: Element): Clef | null {
  const sign = text(measure, 'attributes > clef > sign');
  if (sign === 'G') return 'treble';
  if (sign === 'F') return 'bass';
  return null;
}

function readMetre(measure: Element): Metre | null {
  const beats = number(measure, 'attributes > time > beats');
  const unit = number(measure, 'attributes > time > beat-type');
  if (beats === null || unit === null || beats < 1 || unit < 1) return null;
  return metreFor(beats, unit);
}

/** What is in force at a measure, having read down the page as far as it. */
interface Prevailing {
  divisions: number;
  fifths: number;
  metre: Metre;
  clef: Clef | null;
}

/**
 * The state each measure inherits, read straight down the printed part.
 *
 * MusicXML attributes are sticky and most of them are stated **once**, at the
 * top: `<divisions>` almost always, the key and the metre until they change. A
 * walk that starts at bar 40 therefore inherits nothing, and the failure is not
 * subtle — with divisions defaulting to 1 against a file that declares 24,
 * every duration comes out twenty-four times too long, so four bars of
 * crotchets arrived as ninety-six semibreves.
 *
 * Read once down the page rather than from the walk, because that is what
 * "in force here" means for the page: the walk may start anywhere, but the
 * engraver wrote the part to be read from the top.
 */
function prevailingAt(bodies: readonly MeasureBody[]): Prevailing[] {
  const state: Prevailing[] = [];
  let divisions = 1;
  let fifths = 0;
  let metre = metreFor(4, 4);
  let clef: Clef | null = null;

  for (const body of bodies) {
    if (body.divisions !== null && body.divisions > 0) divisions = body.divisions;
    if (body.fifths !== null) fifths = body.fifths;
    if (body.metre !== null) metre = body.metre;
    if (body.clef !== null && clef === null) clef = body.clef;
    state.push({ divisions, fifths, metre, clef });
  }
  return state;
}

function readBody(measure: Element): MeasureBody {
  return {
    divisions: number(measure, 'attributes > divisions'),
    fifths: number(measure, 'attributes > key > fifths'),
    metre: readMetre(measure),
    clef: readClef(measure),
    multiRest: number(measure, 'attributes > measure-style > multiple-rest'),
    repeatStyle: readRepeatStyle(measure),
    items: [...measure.children].filter((child) =>
      child.tagName === 'note' || child.tagName === 'forward' || child.tagName === 'backup',
    ),
    implicit: measure.getAttribute('implicit') === 'yes',
    number: measure.getAttribute('number') ?? '?',
  };
}

/**
 * Gives the notes back to a bar left empty under a repeat sign.
 *
 * A `measure-repeat` is a **display style**, not missing music. The schema is
 * explicit: "the actual music being repeated needs to be repeated within each
 * measure of the MusicXML file". So a conforming export needs nothing done to
 * it, and this function leaves every measure that has notes exactly as it is.
 *
 * What it defends against is the careless exporter — one that draws the sign
 * and leaves the measure empty. OMR output is the plausible source. A bar of
 * silence under a repeat sign is silence that looks deliberate, and the pattern
 * to fill it from is sitting immediately before the region.
 *
 * The pattern is the `bars` measures preceding the start, taken round in turn,
 * so a two-bar repeat copies a pair rather than the same bar twice.
 */
function fillBarRepeats(bodies: MeasureBody[]): MeasureBody[] {
  const filled = [...bodies];
  let from = -1;
  let pattern = 0;

  for (let i = 0; i < filled.length; i++) {
    const style = filled[i].repeatStyle;
    if (style?.type === 'stop') {
      from = -1;
      continue;
    }
    if (style && style.type !== 'stop') {
      from = i;
      pattern = style.bars;
    }
    if (from < 0 || pattern < 1 || from - pattern < 0) continue;
    // Already written out, which is what the format asks for. Leave it alone
    // rather than overwriting a bar the publisher varied on purpose.
    if (filled[i].items.some((item) => item.tagName === 'note')) continue;
    filled[i] = { ...filled[i], items: filled[from - pattern + ((i - from) % pattern)].items };
  }

  return filled;
}

/** The spelling MusicXML states outright: a letter, an alteration and an octave. */
function readPitch(note: Element): SpelledPitch | null {
  const step = text(note, 'pitch > step');
  const octave = number(note, 'pitch > octave');
  if (step === null || octave === null || !(step in STEPS)) return null;
  return { letter: STEPS[step], alter: number(note, 'pitch > alter') ?? 0, octave };
}

/**
 * One event of the part, once the format has been read off it.
 *
 * A rest and a note are the same shape here because what matters downstream is
 * where it starts and how long it lasts; only `pitch` tells them apart.
 */
interface Event {
  beats: number;
  pitch: SpelledPitch | null;
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
}

/** Counts of things dropped, so the warning can say how many rather than that there were some. */
interface Tally {
  grace: number;
  chords: number;
  voices: number;
  unreadable: string[];
  /** Bars holding a note the chosen instrument has no fingering for. */
  outOfRange: string[];
  /**
   * Bars whose content does not add up to the metre in force.
   *
   * Nothing else here notices this. Every other reading fault is something the
   * importer had to decide about — a chord, a grace note, a rhythm off the grid
   * — and a bar that simply does not add up asks nothing and so passed
   * silently. An OMR result of a real part had 27 of 84 bars not holding three
   * beats and imported without a word.
   *
   * It matters more than it sounds. A bar half a beat short does not stay half
   * a beat short: every bar line after it lands early by that much, so bar 40
   * on screen is no longer bar 40 on the page, and the part becomes useless
   * against the rest of the band — which is the whole point of importing it.
   */
  wrongLength: string[];
  /**
   * Bars read as a time signature of their own, the file having declared none.
   *
   * Told rather than done quietly. The app has decided something about the
   * music here that the page does not state, and a player looking at a printed
   * bar of five with no signature over it is owed the same reading the app
   * made — not least because if the app has it wrong, this is the sentence that
   * lets them see so.
   */
  irregular: string[];
}

/**
 * How far a bar may be off before it is called wrong, in crotchets.
 *
 * Not a musical tolerance — a floating-point one. Durations arrive as ticks
 * over `<divisions>`, and a file dividing the crotchet into thirds gives
 * lengths with no exact binary form, so twelve of them summed land a few parts
 * in 10^16 away from the beat they add up to. This sits far above that and far
 * below anything writable: the shortest note the reader knows is a
 * demisemiquaver, an eighth of a beat, so a real fault misses by 125,000 times
 * this.
 */
const BAR_TOLERANCE = 1e-6;

/**
 * Whether two metres are the same time signature.
 *
 * By what is written rather than by identity: `metreFor` builds a fresh object
 * each time, and 6/8 and 3/4 fill a bar with the same three crotchets while
 * being different signatures to read, count and conduct. So all three of the
 * written numbers have to agree, not just `barBeats`.
 */
function sameMetre(a: Metre, b: Metre): boolean {
  return (
    a.barBeats === b.barBeats && a.beatsPerBar === b.beatsPerBar && a.beatUnit === b.beatUnit
  );
}

/**
 * The largest numerator worth believing in an inferred time signature.
 *
 * A bar of 33/4 is not an irregular bar, it is a file that has gone wrong, and
 * naming a signature nobody would write lends it a credibility it has not
 * earned. Twelve is the largest in ordinary use; this is well past it and still
 * short of absurd.
 */
const MAX_INFERRED_BEATS = 16;

/**
 * The time signature a bar of this length is written in, or null where its
 * length says nothing believable.
 *
 * **Only where the bar is longer than the metre in force.** That asymmetry is
 * not tidiness, it is what the one corrupt file to hand actually looks like:
 * all eleven of its malformed bars are *short*, and five of them are pairs
 * summing to exactly one bar — single printed bars that the scanner split in
 * two. A short bar is nearly always something missing, and the app cannot know
 * what. A long bar has music in it that has to go somewhere, and putting the
 * bar line after all of it is the reading that keeps every note.
 *
 * Two further refusals, both arithmetic:
 *
 * - **A whole multiple of the bar is two bars merged, not one long one.** Six
 *   beats where three are expected is a missing bar line; 6/4 would be a
 *   plausible-looking lie, and worse than the warning it replaced.
 * - **The length must name a signature**, being a whole number of the unit the
 *   metre is written in — five crotchets in 4/4 gives 5/4, seven quavers in 6/8
 *   gives 7/8, and two and a half crotchets in 4/4 gives nothing at all.
 */
function inferMetre(held: number, metre: Metre): Metre | null {
  if (held <= metre.barBeats + BAR_TOLERANCE) return null;

  const multiple = held / metre.barBeats;
  if (Math.abs(multiple - Math.round(multiple)) < BAR_TOLERANCE) return null;

  // The written unit in crotchets: a quarter is 1, an eighth 0.5.
  const unit = 4 / metre.beatUnit;
  const beats = held / unit;
  if (Math.abs(beats - Math.round(beats)) > BAR_TOLERANCE) return null;

  const numerator = Math.round(beats);
  if (numerator < 1 || numerator > MAX_INFERRED_BEATS) return null;
  return metreFor(numerator, metre.beatUnit);
}

/**
 * Drops entries that never come into force, and entries that change nothing.
 *
 * An inferred odd bar records a change at its own bar line and another back at
 * the next, and either can land on a beat that is already spoken for — a second
 * odd bar straight after the first, where the restore and the new inference
 * share a beat, or a declared change on the very next bar.
 *
 * Two entries at one beat leave the earlier one in force for no time at all.
 * Two entries naming the same signature are a change that does not change
 * anything, which is what a second odd bar of the same length produces. Every
 * consumer survives both — `metreAt` takes the last, a zero-length segment
 * contributes no bars, and the renderer keys its signature changes by beat —
 * but `changesMetre` counts entries, and a list saying the metre changed where
 * it did not is a trap for whoever reads it next.
 */
/**
 * One entry per bar of the exercise, in bar order.
 *
 * The walk records a bar as it reads a measure, and for well-formed music the
 * two line up one to one. They stop lining up wherever a measure is not a bar:
 * a multi-bar rest is one measure covering twenty, and a malformed file can put
 * two short measures inside one bar.
 *
 * That mismatch is not cosmetic. Anything choosing bars off the drawn page
 * counts *bars* — the renderer lays out one rectangle per bar — so a list keyed
 * by measure hands back the wrong music, further out the further in you go, and
 * a passage chosen near the end of a part with rests in it comes out as
 * somewhere else entirely.
 *
 * So the entries are re-keyed by the bar they start in, and any bar no measure
 * starts in inherits the one before it, carrying no printed number of its own.
 */
function barsByIndex(
  entries: readonly ImportedBar[],
  metres: readonly MetreChange[],
  totalBars: number,
): ImportedBar[] {
  const byBar: Array<ImportedBar | undefined> = [];
  for (const entry of entries) {
    const index = barAt(metres, entry.startBeat);
    if (index >= 0 && byBar[index] === undefined) byBar[index] = entry;
  }

  const settled: ImportedBar[] = [];
  let last: ImportedBar | null = null;
  for (let bar = 0; bar < totalBars; bar++) {
    const here = byBar[bar];
    if (here) last = here;
    settled.push(
      here ?? {
        number: null,
        source: last?.source ?? REST_BAR,
        startBeat: beatOfBar(metres, bar),
      },
    );
  }
  return settled;
}

function settleChanges(changes: MetreChange[]): MetreChange[] {
  const settled: MetreChange[] = [];
  for (const change of changes) {
    const last = settled[settled.length - 1];
    // Never in force: the next entry starts at the same beat.
    if (last && last.fromBeat === change.fromBeat) settled.pop();
    const kept = settled[settled.length - 1];
    if (kept && sameMetre(kept.metre, change.metre)) continue;
    settled.push(change);
  }
  return settled;
}

/**
 * Reads one measure's notes into events, in the order they sound.
 *
 * Chords are the reason this buffers rather than mapping: a chord is written as
 * a first note followed by notes carrying `<chord/>`, and the top of it is
 * wanted, which cannot be known until the group has been seen.
 */
function readEvents(
  body: MeasureBody,
  divisions: number,
  divisi: Divisi,
  tally: Tally,
): Event[] {
  const events: Event[] = [];
  let chord: Element[] = [];

  const flush = () => {
    if (chord.length === 0) return;
    const pitched = chord
      .map((note) => ({ note, pitch: readPitch(note) }))
      .filter((entry): entry is { note: Element; pitch: SpelledPitch } => entry.pitch !== null);

    if (chord.length > 1) tally.chords++;
    // One line of it. A chord occupies time and is playable, so it gives up its
    // other notes rather than becoming a rest; which line is the player's
    // agreement with their section, so it is asked for rather than assumed.
    let best = pitched[0] ?? null;
    for (const entry of pitched) {
      const higher = midiOf(entry.pitch) > midiOf(best.pitch);
      if (divisi === 'upper' ? higher : !higher) best = entry;
    }

    const lead = chord[0];
    const ticks = number(lead, 'duration') ?? 0;
    events.push({
      beats: ticks / divisions,
      pitch: best?.pitch ?? null,
      tiedFromPrevious: lead.querySelector('tie[type="stop"]') !== null,
      tiedToNext: lead.querySelector('tie[type="start"]') !== null,
    });
    chord = [];
  };

  for (const item of body.items) {
    /*
     * A `<backup>` winds the cursor back to write another voice over the same
     * bar. Only the first voice is read, so this measure is finished — reading
     * on would lay the second voice end-to-end after the first and double the
     * bar's length.
     */
    if (item.tagName === 'backup') {
      tally.voices++;
      break;
    }

    /*
     * A `<forward>` moves the cursor without sounding anything, which is how a
     * bar of nothing is written. It is silence and becomes a rest: skipping it
     * would leave the bar short and every bar line after it adrift — which is
     * exactly what a real part did, six beats' worth, before this existed.
     */
    if (item.tagName === 'forward') {
      flush();
      const ticks = number(item, 'duration') ?? 0;
      const beats = ticks / divisions;
      if (beats > 0) {
        events.push({ beats, pitch: null, tiedFromPrevious: false, tiedToNext: false });
      }
      continue;
    }

    const note = item;
    // A grace note occupies no counted time, so dropping it moves nothing.
    if (note.querySelector(':scope > grace')) {
      tally.grace++;
      continue;
    }
    if (note.querySelector(':scope > chord')) {
      chord.push(note);
      continue;
    }
    flush();
    if (note.querySelector(':scope > rest')) {
      const ticks = number(note, 'duration') ?? 0;
      events.push({ beats: ticks / divisions, pitch: null, tiedFromPrevious: false, tiedToNext: false });
      continue;
    }
    chord = [note];
  }
  flush();

  return events;
}

/**
 * Builds an exercise from one part of a parsed score.
 *
 * The clef, the key and the metre come from the part; the instrument comes from
 * the player, because the written pitches are what is on the page and the
 * sounding ones follow from whatever they are holding. That is also what lets a
 * tuba player read a cornet part, which is a feature rather than an accident.
 */
export function importPart(doc: Document, options: ImportOptions): Imported {
  const problems: string[] = [];
  const partIndex = options.partIndex ?? 0;
  const divisi = options.divisi ?? 'upper';
  const source = parts(doc)[partIndex];
  if (!source) return { exercise: null, bars: [], problems: ['that part is not in this file'] };

  const bodies = fillBarRepeats([...source.querySelectorAll(':scope > measure')].map(readBody));
  if (bodies.length === 0) {
    return { exercise: null, bars: [], problems: [...problems, 'this part has no bars'] };
  }

  const reading = options.reading ?? { kind: 'played' };
  /**
   * How many times the chosen selection is laid out, and how long one pass is.
   *
   * Only a passage has these. `chosenBeats` ends the first pass, so the offer
   * to carry on at the end of a run has somewhere to go — the same mechanism
   * generated material uses for its horizon, doing the same job.
   */
  let passLength: number | null = null;

  let order: number[];
  if (reading.kind === 'printed') {
    // Each measure once, in the order it sits on the page. The navigation is
    // deliberately not consulted: this is the page, not the performance.
    order = bodies.map((_, index) => index);
  } else if (reading.kind === 'passage') {
    const spans = reading.spans
      .map((span) => ({
        from: Math.max(0, Math.min(bodies.length - 1, Math.min(span.from, span.to))),
        to: Math.max(0, Math.min(bodies.length - 1, Math.max(span.from, span.to))),
      }))
      .sort((a, b) => a.from - b.from);

    const once: number[] = [];
    for (const span of spans) {
      // A bar of rests between one selection and the next, and none before the
      // first: the count-in already covers coming in at the top.
      if (once.length > 0) once.push(REST_BAR);
      for (let index = span.from; index <= span.to; index++) once.push(index);
    }
    if (once.length === 0) {
      return { exercise: null, bars: [], problems: [...problems, 'no bars were chosen'] };
    }

    const times = Math.max(1, reading.times ?? passesFor(once.length));
    order = [];
    for (let pass = 0; pass < times; pass++) {
      // The join between passes is the same join as between selections, so
      // going round again reads like the next selection rather than a restart.
      if (pass > 0) order.push(REST_BAR);
      order.push(...once);
    }
    passLength = once.length;
  } else {
    const nav = readNavigation(doc, partIndex);
    const unfolded = unfold(nav);
    order = unfolded.order;
    problems.push(...unfolded.problems);
    if (unfolded.problems.length > 0) {
      problems.push('the repeats were not followed, so this is the part as printed');
    }
    /*
     * A stretch of bars the navigation never arrives at. Almost always a jump
     * in the wrong place — and invisible from the page, since nothing about a
     * D.S. sitting a page too early looks wrong until you count what it
     * skipped.
     *
     * Only worth saying about the whole piece. A player who chose eight bars
     * has not asked about the navigation and is not being told the other
     * thirty-four are unreached.
     */
    if (unfolded.unreached.length > 0) {
      const named = unfolded.unreached.map((i) => nav[i].number ?? String(i + 1));
      const span =
        named.length > 3 ? `bars ${named[0]}–${named[named.length - 1]}` : `bar${named.length > 1 ? 's' : ''} ${named.join(', ')}`;
      problems.push(
        `${named.length} of ${nav.length} bars are never reached — ${span}. Check where the jumps sit.`,
      );
    }
  }

  const tally: Tally = {
    grace: 0,
    chords: 0,
    voices: 0,
    unreadable: [],
    outOfRange: [],
    wrongLength: [],
    irregular: [],
  };
  const slots: Slot[] = [];
  const pitches: SlotPitch[] = [];
  const multiRests: RestEvent[] = [];
  const keys: KeyChange[] = [];
  const metres: MetreChange[] = [];
  const bars: ImportedBar[] = [];

  // Sticky state, carried along the walk rather than read off the page, since a
  // repeated bar meets it twice at two different beats.
  /*
   * Seeded from what the page has in force where the walk starts, rather than
   * from the defaults.
   *
   * The same values for a walk that begins at bar 1, which is every reading of
   * a whole piece — so this changes nothing there. It is everything for a
   * passage: a selection starting at bar 40 inherits the divisions, the key and
   * the metre that were declared at the top and never repeated.
   */
  const prevailing = prevailingAt(bodies);
  const opensAt = order.find((index) => index !== REST_BAR) ?? 0;
  let divisions = prevailing[opensAt]?.divisions ?? 1;
  let metre = prevailing[opensAt]?.metre ?? metreFor(4, 4);
  let fifths = prevailing[opensAt]?.fifths ?? 0;
  let clef: Clef | null = prevailing[opensAt]?.clef ?? null;
  let beat = 0;
  let previousSounded: SpelledPitch | null = null;
  /**
   * How long the pickup is, in crotchets; 0 where the part does not open with one.
   *
   * Kept because the last bar of a part that opens with a pickup is
   * conventionally short by exactly this much — the two together make one bar,
   * which is why the printed part numbers neither of them. Without this the
   * fullness check below would name that bar on nearly every march ever
   * engraved, and a warning that fires on correct files is worse than no
   * warning at all.
   */
  let pickupBeats = 0;
  /**
   * The metre to go back to once an inferred odd bar has passed.
   *
   * Null except across the one bar. A bar whose own length is its time
   * signature interrupts the metre rather than changing it — the four-four
   * resumes at the next bar line, exactly as the printed part does.
   */
  let restoreMetre: Metre | null = null;

  for (let step = 0; step < order.length; step++) {
    /*
     * The join between two selections: a bar of rests, counted in the metre of
     * the passage being landed in rather than the one being left.
     *
     * That way round because the empty bar is preparation, not an ending — its
     * whole job is to be counted through, and the count that helps is the one
     * the player is about to need. Jumping from a bar of four into a passage in
     * three, a rest bar counted in four would put them in at the wrong moment,
     * which is exactly the fault the gap exists to prevent.
     */
    if (order[step] === REST_BAR) {
      // What is in force *at* the landing bar, not what it happens to declare:
      // a passage landing on bar 40 of a piece that turned into three-four at
      // bar 5 is in three, and bar 40 says nothing about it.
      const landing = prevailing[order[step + 1]]?.metre ?? metre;
      if (!sameMetre(landing, metre)) {
        metre = landing;
        metres.push({ fromBeat: beat, metre });
      }
      bars.push({ number: null, source: REST_BAR, startBeat: snapBeat(beat) });
      for (const duration of writeAs(metre.barBeats).pieces) {
        slots.push({ startBeat: beat, duration, isRest: true, tiedFromPrevious: false });
        beat += durationBeats(duration);
      }
      // Nothing sounds across a gap, so a tie reaching into it is not a tie.
      previousSounded = null;
      continue;
    }

    const body = bodies[order[step]];
    if (!body) continue;

    bars.push({ number: body.number, source: order[step], startBeat: snapBeat(beat) });

    if (body.divisions !== null && body.divisions > 0) divisions = body.divisions;
    if (body.clef !== null && clef === null) clef = body.clef;

    // Changes recorded at the beat they land on, and only when they change
    // something: a repeated bar carrying a key signature would otherwise add an
    // entry per pass, and `changesKey` counts entries.
    if (body.fifths !== null && (keys.length === 0 || fifths !== body.fifths)) {
      fifths = body.fifths;
      keys.push({ fromBeat: beat, fifths });
    }
    /*
     * The odd bar is behind us, so the metre goes back to what it interrupted.
     * Recorded before the file's own change is considered, so that a measure
     * which does declare one is compared against the metre actually in force
     * rather than against the single bar that borrowed it.
     */
    if (restoreMetre !== null) {
      metre = restoreMetre;
      restoreMetre = null;
      if (body.metre === null || sameMetre(body.metre, metre)) {
        metres.push({ fromBeat: beat, metre });
      }
    }
    if (body.metre !== null && (metres.length === 0 || !sameMetre(body.metre, metre))) {
      metre = body.metre;
      metres.push({ fromBeat: beat, metre });
    }
    if (keys.length === 0) keys.push({ fromBeat: 0, fifths });
    if (metres.length === 0) metres.push({ fromBeat: 0, metre });

    /*
     * A pickup: the part begins part-way through its first bar, which nearly
     * every march does. Padded with silence up to the bar line rather than
     * left short, because every bar line in the piece is placed by counting
     * whole bars from the start — a short first bar would put all of them
     * adrift of the music by the length of the pickup, and with them every bar
     * number the player navigates by.
     *
     * The pickup's own notes land where they belong: a one-beat pickup into
     * four-four ends up on the fourth beat of bar 1, which is where a player
     * counts it.
     */
    if (step === 0 && body.implicit) {
      const held = readEvents(body, divisions, divisi, {
        ...tally,
        outOfRange: [],
        wrongLength: [],
        irregular: [],
      }).reduce((sum, e) => sum + e.beats, 0);
      const missing = metre.barBeats - held;
      if (missing > 1e-9) {
        pickupBeats = held;
        for (const duration of writeAs(missing).pieces) {
          slots.push({ startBeat: beat, duration, isRest: true, tiedFromPrevious: false });
          beat += durationBeats(duration);
        }
      }
    }

    /*
     * A multi-bar rest is one object covering several bars, and it is not
     * expanded — the count is the notation. The measures it covers are still in
     * the file, so the walk steps over them here rather than reading them.
     */
    if (body.multiRest !== null && body.multiRest > 1) {
      multiRests.push({
        startBeat: snapBeat(beat),
        duration: { value: 'whole', dotted: false },
        bars: body.multiRest,
      });
      /*
       * One entry per bar it covers, not one for the symbol.
       *
       * The rest is drawn as a single object and the walk steps over the
       * measures underneath it — but they are still bars, they are still
       * numbered on the printed part, and anything choosing bars off that page
       * counts them. Their numbers come from the measures being stepped over,
       * which is where the engraver put them.
       *
       * The first is already recorded above; these are the rest.
       */
      for (let covered = 1; covered < body.multiRest; covered++) {
        const under = order[step + covered];
        bars.push({
          number: bodies[under]?.number ?? null,
          source: under ?? REST_BAR,
          startBeat: snapBeat(beat + covered * metre.barBeats),
        });
      }
      beat += metre.barBeats * body.multiRest;
      step += body.multiRest - 1;
      previousSounded = null;
      continue;
    }

    const events = readEvents(body, divisions, divisi, tally);

    /*
     * Does this bar hold a bar's worth? Pure arithmetic against the metre in
     * force, and the only thing here that checks the file rather than reads it.
     *
     * Three bars are exempt, all of them deliberately short and none of them a
     * fault:
     *
     * - **A bar the engraver marked `implicit`.** That attribute means "do not
     *   count this one", which is exactly the claim being checked. A pickup is
     *   the usual case and it has already been padded above.
     * - **The last bar of a part that opened with a pickup**, short by exactly
     *   the length of the pickup. The two are one bar between them, which is
     *   why the printed part numbers neither.
     * - **A multi-bar rest**, which never reaches here — the walk steps over
     *   the measures it covers rather than reading them.
     *
     * Read in playing order like everything else, so a bad bar inside a repeat
     * is met once per pass; `describe` reports written bar numbers and counts
     * each one once, because it is one bar on the page and one place to look.
     */
    const held = events.reduce((sum, event) => sum + event.beats, 0);
    const shortfall = metre.barBeats - held;
    const completesPickup =
      order[step] === bodies.length - 1 &&
      pickupBeats > 0 &&
      Math.abs(shortfall - pickupBeats) < BAR_TOLERANCE;
    if (!body.implicit && !completesPickup && Math.abs(shortfall) > BAR_TOLERANCE) {
      /*
       * A bar that is longer than its metre and whose length names a signature
       * is read as that signature, for this bar only. Real music does this —
       * five beats in the middle of a four-four piece, written without a change
       * of signature because it interrupts the metre rather than replacing it —
       * and the app can represent it exactly, `metres` being a list.
       *
       * Getting it wrong is not cosmetic. Left as a plain four-four bar, the
       * five beats push a bar line into the middle of the bar, every downbeat
       * after it lands a beat early, and the conductor beats four across five
       * for the rest of the piece.
       *
       * Anything this cannot name is reported instead and left alone.
       */
      const inferred = inferMetre(held, metre);
      if (inferred) {
        restoreMetre = metre;
        metre = inferred;
        metres.push({ fromBeat: beat, metre });
        tally.irregular.push(body.number);
      } else {
        tally.wrongLength.push(body.number);
      }
    }

    for (const event of events) {
      const { pieces, leftover } = writeAs(event.beats);

      /*
       * A tie is honoured only where its two ends meet in the *played* order
       * and agree about the pitch. Unfolding can separate them — a tie out of
       * the last bar of a repeat lands somewhere else on the second pass — and
       * a tie to nothing would have the assembler clone a note that is not
       * there.
       */
      const joins =
        event.pitch !== null &&
        event.tiedFromPrevious &&
        previousSounded !== null &&
        previousSounded.letter === event.pitch.letter &&
        previousSounded.alter === event.pitch.alter &&
        previousSounded.octave === event.pitch.octave;

      pieces.forEach((duration, index) => {
        slots.push({
          startBeat: beat,
          duration,
          isRest: event.pitch === null,
          // The pieces after the first are the far end of the tie that holds a
          // split note together, and take no pitch of their own.
          tiedFromPrevious: event.pitch !== null && (index > 0 || joins),
        });
        if (event.pitch !== null && index === 0 && !joins) {
          pitches.push(event.pitch);
          /*
           * A note this instrument cannot reach. Kept, drawn and sounded — it
           * is what the part says — but noticed, because it is not judged and a
           * player is owed the reason their score covers fewer notes than the
           * page shows. A cornet part read on a tuba is the ordinary way in.
           */
          const readIn = clef ?? options.clef ?? 'treble';
          const sounds = soundingFromWritten(midiOf(event.pitch), options.instrument, readIn);
          if (!isPlayable(sounds, options.instrument)) {
            tally.outOfRange.push(body.number);
          }
        }
        beat += durationBeats(duration);
      });

      if (leftover > 1e-9) {
        // Off the grid entirely: shorter than a semiquaver and not a triplet.
        // The time still passes, so the bar after it starts where it should.
        tally.unreadable.push(body.number);
        beat += leftover;
      }

      previousSounded = event.pitch !== null && event.tiedToNext ? event.pitch : null;
    }
  }

  problems.push(...describe(tally, divisi, options.instrument.name));

  if (slots.length === 0 && multiRests.length === 0) {
    return { exercise: null, bars: [], problems: [...problems, 'this part has nothing playable in it'] };
  }

  const settledMetres = settleChanges(metres);

  /*
   * Where the first time through the selection ends — the bar of rests after
   * it included, not stopping at the last note.
   *
   * The rest of what was built is the same selection again, and it is behind
   * the horizon: drawn grey, not scheduled, not judged, and played only if the
   * offer at the end is taken. Exactly what a generated exercise does past its
   * chosen length, so Continue needed nothing added to it.
   *
   * **But Continue extends by exactly this figure**, so it has to be the whole
   * period of the loop and not merely the music in it. Measured to the last
   * note, every cycle came up one gap bar short of the next: the grey crept
   * back into the music by a bar a time, and by the third pass a player was
   * being shown the end of their own selection as something they had not
   * asked for. Which is how the player found it.
   *
   * Counting the gap as part of the block is also the truer reading of it. That
   * empty bar is not a pause between two runs, it is the bar you count through
   * to come in again — so it belongs to the music being played, and greying it
   * would tell the player it was somebody else's.
   */
  const chosenBeats =
    passLength === null ? beat : (bars[passLength + 1]?.startBeat ?? beat);

  const located = barsByIndex(bars, settledMetres, barCount(settledMetres, beat));

  const exercise = assembleExercise(slots, pitches, {
    instrument: options.instrument,
    clef: clef ?? options.clef ?? 'treble',
    keys,
    metres: settledMetres,
    totalBeats: beat,
    chosenBeats,
    seed: 0,
    kind: 'imported',
  });

  return {
    // Multi-bar rests are added after assembly rather than passed as slots: a
    // slot is measured by its written value, and a multi-bar rest's length is
    // its bar count, which is the whole distinction `RestEvent.bars` draws.
    exercise: {
      ...exercise,
      rests: [...exercise.rests, ...multiRests].sort((a, b) => a.startBeat - b.startBeat),
      /*
       * The page's own numbers travel with the music.
       *
       * Without them the stave counts bars instead, and a part opening with a
       * pickup is numbered one ahead of the paper for its whole length — the
       * app padding that pickup into a full bar is exactly what makes it
       * count as the first. A player following "from bar thirty-three" would
       * be a bar out, which is the one thing a bar number must never be.
       */
      barNumbers: located.map((bar) => bar.number),
    },
    bars: located,
    problems,
  };
}

/**
 * Written values, longest first, that between them say any length in quarters
 * of a beat.
 *
 * Longest-first is what an engraver writes: three beats is a dotted minim, not
 * six quavers.
 */
const WRITABLE = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125] as const;

/**
 * How a length is written: one value, or several to be tied together.
 *
 * A note of two and a half beats is not unwritable — it is a minim **tied** to
 * a quaver, which is exactly what a publisher prints, and treating it as
 * unreadable would throw away a note the part plainly contains. So a length
 * that no single value says is split, and the pieces are joined.
 *
 * `leftover` is what no value could cover: something shorter than a semiquaver
 * and off the triplet grid, which is the genuinely unreadable case. It is
 * reported rather than rounded away, because rounding it would move every bar
 * after it.
 */
function writeAs(beats: number): { pieces: Duration[]; leftover: number } {
  // One value first, which also picks up the triplets — a length writable both
  // ways should be written the ordinary way.
  const exact = durationFromBeats(beats);
  if (exact) return { pieces: [exact], leftover: 0 };

  const pieces: Duration[] = [];
  let left = beats;
  while (left > 1e-9) {
    const fits = WRITABLE.find((length) => length <= left + 1e-9);
    const duration = fits === undefined ? null : durationFromBeats(fits);
    if (!duration) break;
    pieces.push(duration);
    left -= durationBeats(duration);
  }
  return { pieces, leftover: Math.max(0, left) };
}

/** Turns the tally into sentences a player can check against the printed part. */
function describe(tally: Tally, divisi: Divisi, instrumentName: string): string[] {
  const said: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  /** Bars named once each, however many times a repeat carried the walk through them. */
  const named = (numbers: string[], shown: number) => {
    const bars = [...new Set(numbers)];
    const list = bars.slice(0, shown).join(', ');
    return bars.length > shown
      ? `bars ${list} and ${bars.length - shown} more`
      : `bar${bars.length > 1 ? 's' : ''} ${list}`;
  };

  /*
   * First, and in the plainest words available, because it is the one warning
   * here that makes the whole import untrustworthy rather than merely
   * incomplete. Everything else says a note was changed; this says the bar
   * numbers are wrong, and a part whose bar numbers are wrong cannot be
   * practised against a band.
   */
  if (tally.wrongLength.length > 0) {
    const bars = [...new Set(tally.wrongLength)];
    said.push(
      `${plural(bars.length, 'bar does', 'bars do')} not hold a full bar of music` +
        ` (${named(tally.wrongLength, 6)})` +
        ' — every bar line after them is adrift, so the numbering will not match the printed part',
    );
  }
  if (tally.irregular.length > 0) {
    const bars = [...new Set(tally.irregular)];
    said.push(
      `${plural(bars.length, 'bar is', 'bars are')} longer than the time signature says` +
        ` (${named(tally.irregular, 6)})` +
        ' — read as written, with the bar line where the music ends',
    );
  }
  if (tally.chords > 0) {
    // Named rather than merely counted: which line was taken is the thing the
    // player needs to check against what their section agreed.
    said.push(`${plural(tally.chords, 'divided note', 'divided notes')} read on the ${divisi} line`);
  }
  if (tally.grace > 0) {
    said.push(`${plural(tally.grace, 'grace note', 'grace notes')} left out`);
  }
  if (tally.voices > 0) {
    said.push(
      `${plural(tally.voices, 'bar', 'bars')} had a second voice, and only the upper one was read`,
    );
  }
  if (tally.outOfRange.length > 0) {
    said.push(
      `${plural(tally.outOfRange.length, 'note is', 'notes are')} outside what ${instrumentName} can play` +
        ` (${named(tally.outOfRange, 4)})` +
        ` — shown and sounded, but not marked`,
    );
  }
  if (tally.unreadable.length > 0) {
    said.push(`rhythms that cannot be written were dropped, in ${named(tally.unreadable, 6)}`);
  }
  return said;
}
