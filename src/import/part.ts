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

import type { Clef, Instrument } from '../domain/instruments';
import type { KeyChange } from '../domain/keys';
import { metreFor, type Metre, type MetreChange } from '../domain/metre';
import { midiOf, type Letter, type SpelledPitch } from '../domain/pitch';
import { durationBeats, durationFromBeats, snapBeat, type Duration } from '../domain/rhythm';
import { assembleExercise, type Slot, type SlotPitch } from '../exercise/assemble';
import type { Exercise, RestEvent } from '../exercise/types';
import { parts, readNavigation } from './musicxml';
import { unfold } from './unfold';

export interface ImportOptions {
  /** The instrument the player is reading on, which decides the fingerings. */
  instrument: Instrument;
  /** Which part of the score. `partNames` is there to ask with. */
  partIndex?: number;
  /**
   * The clef to read in, where the part does not say or says something the app
   * has no stave for. The part's own clef wins when it is one of the two.
   */
  clef?: Clef;
}

export interface Imported {
  /** Null only when there was nothing playable to build from. */
  exercise: Exercise | null;
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
}

/**
 * Reads one measure's notes into events, in the order they sound.
 *
 * Chords are the reason this buffers rather than mapping: a chord is written as
 * a first note followed by notes carrying `<chord/>`, and the top of it is
 * wanted, which cannot be known until the group has been seen.
 */
function readEvents(body: MeasureBody, divisions: number, tally: Tally): Event[] {
  const events: Event[] = [];
  let chord: Element[] = [];

  const flush = () => {
    if (chord.length === 0) return;
    const pitched = chord
      .map((note) => ({ note, pitch: readPitch(note) }))
      .filter((entry): entry is { note: Element; pitch: SpelledPitch } => entry.pitch !== null);

    if (chord.length > 1) tally.chords++;
    // The top note. A chord occupies time and is playable, so it gives up its
    // other notes rather than becoming a rest — and on a single-line brass
    // instrument the top note is the part.
    let best = pitched[0] ?? null;
    for (const entry of pitched) {
      if (midiOf(entry.pitch) > midiOf(best.pitch)) best = entry;
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
  const source = parts(doc)[partIndex];
  if (!source) return { exercise: null, problems: ['that part is not in this file'] };

  const { order, problems: navProblems } = unfold(readNavigation(doc, partIndex));
  problems.push(...navProblems);
  if (navProblems.length > 0) {
    problems.push('the repeats were not followed, so this is the part as printed');
  }

  const bodies = fillBarRepeats([...source.querySelectorAll(':scope > measure')].map(readBody));
  if (bodies.length === 0) return { exercise: null, problems: [...problems, 'this part has no bars'] };

  const tally: Tally = { grace: 0, chords: 0, voices: 0, unreadable: [] };
  const slots: Slot[] = [];
  const pitches: SlotPitch[] = [];
  const multiRests: RestEvent[] = [];
  const keys: KeyChange[] = [];
  const metres: MetreChange[] = [];

  // Sticky state, carried along the walk rather than read off the page, since a
  // repeated bar meets it twice at two different beats.
  let divisions = 1;
  let metre = metreFor(4, 4);
  let fifths = 0;
  let clef: Clef | null = null;
  let beat = 0;
  let previousSounded: SpelledPitch | null = null;

  for (let step = 0; step < order.length; step++) {
    const body = bodies[order[step]];
    if (!body) continue;

    if (body.divisions !== null && body.divisions > 0) divisions = body.divisions;
    if (body.clef !== null && clef === null) clef = body.clef;

    // Changes recorded at the beat they land on, and only when they change
    // something: a repeated bar carrying a key signature would otherwise add an
    // entry per pass, and `changesKey` counts entries.
    if (body.fifths !== null && (keys.length === 0 || fifths !== body.fifths)) {
      fifths = body.fifths;
      keys.push({ fromBeat: beat, fifths });
    }
    if (body.metre !== null && (metres.length === 0 || body.metre.barBeats !== metre.barBeats
      || body.metre.beatsPerBar !== metre.beatsPerBar || body.metre.beatUnit !== metre.beatUnit)) {
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
      const held = readEvents(body, divisions, { ...tally }).reduce((sum, e) => sum + e.beats, 0);
      const missing = metre.barBeats - held;
      if (missing > 1e-9) {
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
      beat += metre.barBeats * body.multiRest;
      step += body.multiRest - 1;
      previousSounded = null;
      continue;
    }

    for (const event of readEvents(body, divisions, tally)) {
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
        if (event.pitch !== null && index === 0 && !joins) pitches.push(event.pitch);
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

  problems.push(...describe(tally));

  if (slots.length === 0 && multiRests.length === 0) {
    return { exercise: null, problems: [...problems, 'this part has nothing playable in it'] };
  }

  const exercise = assembleExercise(slots, pitches, {
    instrument: options.instrument,
    clef: clef ?? options.clef ?? 'treble',
    keys,
    metres,
    totalBeats: beat,
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
    },
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
const WRITABLE = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25] as const;

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
function describe(tally: Tally): string[] {
  const said: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (tally.chords > 0) {
    said.push(`${plural(tally.chords, 'chord', 'chords')} reduced to the top note`);
  }
  if (tally.grace > 0) {
    said.push(`${plural(tally.grace, 'grace note', 'grace notes')} left out`);
  }
  if (tally.voices > 0) {
    said.push(
      `${plural(tally.voices, 'bar', 'bars')} had a second voice, and only the upper one was read`,
    );
  }
  if (tally.unreadable.length > 0) {
    const bars = [...new Set(tally.unreadable)];
    const shown = bars.slice(0, 6).join(', ');
    said.push(
      `rhythms that cannot be written were dropped, in ${
        bars.length > 6 ? `bars ${shown} and ${bars.length - 6} more` : `bar${bars.length > 1 ? 's' : ''} ${shown}`
      }`,
    );
  }
  return said;
}
