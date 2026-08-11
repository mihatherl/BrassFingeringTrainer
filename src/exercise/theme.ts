/**
 * Authored melodic material, written in scale degrees rather than in pitches.
 *
 * A random walk cannot produce the three things that make a line read as music
 * — repetition, an answering phrase, and a cadence — so sight-reading material
 * that is worth the name has to be written rather than generated. What is
 * written down here is the *shape*: degrees of the scale, and a rhythm.
 *
 * Degrees rather than notes is what makes a theme reusable. The same eight bars
 * are playable in any key on any instrument in either clef, transposed by the
 * ordinary machinery, and a theme can still carry a change of key *relative to
 * wherever it started* — "up a fifth at bar nine" survives being played in E
 * flat or in D. It is also the only honest way to store material for an app
 * whose whole point is that the player picks the key.
 *
 * A theme is generated the same way round as a scale — contour first, with the
 * rhythm holding it — which is why it shares `assembleExercise` with the
 * patterns rather than the free-material path.
 */

import { writtenRange, type Clef, type Instrument } from '../domain/instruments';
import { MAJOR_SCALE, tonicPitchClass, type KeyChange } from '../domain/keys';
import { metreFor, type Metre } from '../domain/metre';
import { durationBeats, durationFromBeats, snapBeat } from '../domain/rhythm';
import { assembleExercise, type Slot } from './assemble';
import { DIFFICULTIES } from './difficulty';
import type { Exercise } from './types';

/** One sounded note of a theme, placed by degree rather than by pitch. */
export interface ThemeNote {
  /** Degree of the major scale of whatever key is in force, 1–7. */
  degree: number;
  /** Chromatic inflection of that degree: -1 flattened, +1 raised. */
  alter?: number;
  /** Octaves away from the theme's home octave. */
  octave?: number;
  /** Length in crotchets. Must be a value that can actually be written. */
  beats: number;
  /**
   * Held into the note that follows, which must be the same degree.
   *
   * Only ever across a bar line, because that is the only reason this app
   * writes a tie at all — a note that fits inside its bar is written as one
   * note. See *Ties, as built*.
   */
  tied?: boolean;
}

export interface ThemeRest {
  rest: true;
  beats: number;
}

export type ThemeEvent = ThemeNote | ThemeRest;

export function isRest(event: ThemeEvent): event is ThemeRest {
  return 'rest' in event;
}

/**
 * A change of key, relative to the key the theme is being played in.
 *
 * Stored as a delta so it survives transposition: a theme that lifts a fifth at
 * bar nine does so whether it started in E flat or in D. It lands on a bar line
 * because there is nowhere else a key change may land.
 */
export interface ThemeKeyChange {
  /** Bar it lands on, counting the first bar of the theme as 1. */
  atBar: number;
  /** Steps around the circle of fifths from the key being left. */
  fifths: number;
}

export interface Theme {
  id: string;
  /** Shown to nobody yet; it is for whoever is reading the corpus. */
  name: string;
  /** Which of the five levels this belongs to. */
  difficulty: string;
  /**
   * Metres the theme is legal in, as numerator and denominator.
   *
   * A tune in three is not a tune in four, so this is declared rather than
   * inferred. Most themes name one.
   */
  metres: ReadonlyArray<readonly [number, number]>;
  bars: number;
  events: readonly ThemeEvent[];
  keyChanges?: readonly ThemeKeyChange[];
}

/** Degrees a phrase may begin and end on, so that any two themes can abut. */
const STABLE_DEGREES = [1, 3, 5];

/**
 * Where a theme's tonic is allowed to sit, as a written pitch.
 *
 * A ruling from playing rather than from arithmetic. Placing a theme by
 * centring whatever it happens to span puts the same tune somewhere different
 * in every key, and puts a wide one somewhere nobody would write it — the tonic
 * is what a player feels the music sitting on, so that is what gets placed.
 *
 * Written rather than sounding, because this is about where the notes land on
 * the page in front of the player. An octave from just below the stave to just
 * inside it, which on a treble-clef tuba part is low G up to the G the clef
 * curls around, and on everything else in treble is the ledger C up to the C in
 * the stave. Bass clef is the same octave where that clef puts it.
 *
 * Clamped to what the instrument can actually reach, so the window can never
 * ask for a note that does not exist.
 */
export function tonicWindow(instrument: Instrument, clef: Clef): [number, number] {
  const TUBAS = ['eb-bass', 'bb-bass'];
  const [low, high] =
    clef === 'bass' ? [48, 60] : TUBAS.includes(instrument.id) ? [55, 67] : [60, 72];

  const [lowest, highest] = writtenRange(instrument, clef);
  return [Math.max(low, lowest), Math.min(high, highest)];
}

/**
 * Everything wrong with a theme, or an empty list.
 *
 * Written as a list rather than a throw because the point is to check a whole
 * corpus and see all of it at once. A theme that fails is discarded rather than
 * argued with — the corpus is cheap to write again, and a tune that does not
 * add up is not a tune.
 */
export function validateTheme(theme: Theme): string[] {
  const problems: string[] = [];
  const at = (what: string) => `${theme.id}: ${what}`;

  if (!DIFFICULTIES.some((d) => d.id === theme.difficulty)) {
    problems.push(at(`unknown difficulty "${theme.difficulty}"`));
  }
  if (theme.metres.length === 0) problems.push(at('names no metre'));
  if (theme.bars < 1) problems.push(at('has no bars'));
  if (theme.events.length === 0) problems.push(at('has no events'));

  for (const [index, event] of theme.events.entries()) {
    if (!durationFromBeats(event.beats)) {
      problems.push(at(`event ${index} is ${event.beats} beats, which cannot be written`));
    }
    if (isRest(event)) continue;
    if (!Number.isInteger(event.degree) || event.degree < 1 || event.degree > 7) {
      problems.push(at(`event ${index} is degree ${event.degree}, outside 1–7`));
    }
    if (event.alter !== undefined && Math.abs(event.alter) > 1) {
      problems.push(at(`event ${index} is altered by ${event.alter}, beyond a semitone`));
    }
  }

  const sounded = theme.events.filter((e): e is ThemeNote => !isRest(e));
  const ends = [sounded[0], sounded[sounded.length - 1]];
  for (const [which, note] of ['first', 'last'].map((w, i) => [w, ends[i]] as const)) {
    if (note && !STABLE_DEGREES.includes(note.degree)) {
      problems.push(
        at(`${which} note is degree ${note.degree}; themes abut, so both ends must be stable`),
      );
    }
  }

  for (const [index, event] of theme.events.entries()) {
    if (isRest(event) || !event.tied) continue;
    const next = theme.events[index + 1];
    if (!next || isRest(next)) {
      problems.push(at(`event ${index} is tied into a rest or into nothing`));
    } else if (next.degree !== event.degree || (next.alter ?? 0) !== (event.alter ?? 0) ||
      (next.octave ?? 0) !== (event.octave ?? 0)) {
      problems.push(at(`event ${index} is tied to a different note, which is a slur`));
    }
  }

  /*
   * The difficulty tag, held to what the difficulty actually says.
   *
   * A tag is a claim, and an unchecked one drifts: a theme labelled Beginner
   * with a leap of a tenth in it is worse than no theme, because a player
   * meeting it has been told it is within reach. `difficulty.ts` already states
   * these numbers for generated material, so a theme is measured against the
   * same ones rather than against an opinion.
   *
   * Only the unambiguous claims are checked. Note *values* are not: the pool
   * says what the generator draws from, and a dotted minim is plainly fine for
   * a beginner without appearing in it. The shortest note is checked, because
   * that one really is a difficulty.
   */
  const difficulty = DIFFICULTIES.find((d) => d.id === theme.difficulty);
  if (difficulty) {
    const shortest = Math.min(...difficulty.rhythms.map((r) => durationBeats(r.duration)));
    for (const [index, event] of theme.events.entries()) {
      if (event.beats < shortest - 1e-9) {
        problems.push(
          at(`event ${index} is shorter than ${theme.difficulty} reads: ${event.beats} beats`),
        );
      }
    }

    if (difficulty.accidentalChance === 0 && sounded.some((n) => (n.alter ?? 0) !== 0)) {
      problems.push(at(`${theme.difficulty} takes no accidentals`));
    }
    if (difficulty.restChance === 0 && theme.events.some(isRest)) {
      problems.push(at(`${theme.difficulty} takes no rests`));
    }
    if (difficulty.tieChance === 0 && sounded.some((n) => n.tied)) {
      problems.push(at(`${theme.difficulty} takes no ties`));
    }

    /*
     * Intervals and span are measured in the theme's own degree space, which is
     * what the author wrote and can control. A theme that changes key is
     * measured within each key rather than across the join, since where the
     * join lands is decided later, by the compass.
     */
    const offsets = sounded.map(semitonesAbove);
    const span = Math.max(...offsets) - Math.min(...offsets);
    if (span > difficulty.rangeSemitones) {
      problems.push(
        at(`spans ${span} semitones; ${theme.difficulty} reads ${difficulty.rangeSemitones}`),
      );
    }
    let widestLeap = 0;
    for (let i = 1; i < sounded.length; i++) {
      if (sounded[i - 1].tied) continue;
      const leap = Math.abs(offsets[i] - offsets[i - 1]);
      widestLeap = Math.max(widestLeap, leap);
      if (leap > difficulty.maxInterval) {
        problems.push(
          at(`leaps ${leap} semitones at note ${i}; ${theme.difficulty} leaps ${difficulty.maxInterval}`),
        );
      }
    }

    /*
     * And the floor, which is the half that was missing.
     *
     * Every check above is a ceiling, so a theme of plain crotchets passed at
     * Expert — which is exactly what shipped, and what a player reading it said
     * about it: the hardest material in the corpus read like the middle of the
     * range. A tag has to mean something in both directions or it means very
     * little in either.
     *
     * The rule: a theme must be harder than the level below it in at least one
     * respect, or it belongs on that level. Which respect is deliberately left
     * open — a tune earns Hard by leaping, or by moving faster, or by its
     * range, and insisting on all three would describe one tune rather than a
     * level.
     */
    const below = DIFFICULTIES[DIFFICULTIES.indexOf(difficulty) - 1];
    if (below) {
      const shortest = Math.min(...theme.events.map((e) => e.beats));
      const belowShortest = Math.min(...below.rhythms.map((r) => durationBeats(r.duration)));
      const harder =
        shortest < belowShortest - 1e-9 ||
        widestLeap > below.maxInterval ||
        span > below.rangeSemitones ||
        (below.accidentalChance === 0 && sounded.some((n) => (n.alter ?? 0) !== 0)) ||
        (below.restChance === 0 && theme.events.some(isRest)) ||
        (below.tieChance === 0 && sounded.some((n) => n.tied));
      if (!harder) {
        problems.push(
          at(
            `is no harder than ${below.id}: nothing shorter than ${belowShortest} beats, ` +
              `no leap past ${below.maxInterval}, span ${span} within ${below.rangeSemitones}`,
          ),
        );
      }
    }

    /*
     * And it has to move at the pace of its level.
     *
     * The rhythm pool says what the generator draws from, and its *longest*
     * value says how fast the level goes: Expert holds nothing longer than a
     * quaver, which is what "relentless semiquavers" in its own blurb means. A
     * median rather than a maximum, so a theme may still end on a long note —
     * a cadence needs one, and a level is set by how the tune moves rather than
     * by how it stops.
     */
    const lengths = theme.events.map((e) => e.beats).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const slowest = Math.max(...difficulty.rhythms.map((r) => durationBeats(r.duration)));
    if (lengths.length > 0 && median > slowest + 1e-9) {
      problems.push(
        at(`moves in ${median}-beat notes; ${theme.difficulty} moves in ${slowest} at the slowest`),
      );
    }
  }

  // Bar arithmetic, per metre, since a theme may be legal in more than one.
  for (const [numerator, denominator] of theme.metres) {
    const metre = metreFor(numerator, denominator);
    const total = theme.events.reduce((sum, e) => sum + e.beats, 0);
    const expected = theme.bars * metre.barBeats;
    if (Math.abs(total - expected) > 1e-9) {
      problems.push(
        at(`is ${total} beats but ${theme.bars} bars of ${numerator}/${denominator} is ${expected}`),
      );
    }

    /*
     * Nothing may cross a bar line. A note that wants to is written as two,
     * joined by a tie — which is exactly what the rest of the app means by one,
     * and the only construction its judging and drawing understand.
     */
    let beat = 0;
    for (const [index, event] of theme.events.entries()) {
      const bar = Math.floor(beat / metre.barBeats + 1e-9);
      const endsIn = Math.floor((beat + event.beats - 1e-9) / metre.barBeats);
      if (bar !== endsIn) {
        problems.push(
          at(`event ${index} crosses a bar line in ${numerator}/${denominator}; tie it instead`),
        );
      }
      beat += event.beats;
    }

    for (const change of theme.keyChanges ?? []) {
      if (!Number.isInteger(change.atBar) || change.atBar < 2 || change.atBar > theme.bars) {
        problems.push(at(`changes key at bar ${change.atBar}, which is not inside the theme`));
      }
    }
  }

  return problems;
}

export interface RealiseOptions {
  instrument: Instrument;
  clef: Clef;
  /** The key the theme opens in. Its own changes are relative to this. */
  fifths: number;
  metre: Metre;
  /** Beat the theme starts at, so themes can be laid end to end. */
  fromBeat?: number;
}

/** A theme placed in a key and an octave, ready to be assembled or appended. */
export interface RealisedTheme {
  slots: Slot[];
  pitches: number[];
  keys: KeyChange[];
  beats: number;
}

/**
 * Keeps a key inside the seven signatures anyone writes.
 *
 * A theme that lifts a fifth twice from B major would arrive at nine sharps,
 * which is a real key and not one any part is printed in. Twelve steps round
 * the circle is the same sound spelled the other way.
 */
function readableKey(fifths: number): number {
  let k = fifths;
  while (k > 7) k -= 12;
  while (k < -7) k += 12;
  return k;
}

/** Semitones above the tonic for a degree, with any chromatic inflection. */
function semitonesAbove(note: ThemeNote): number {
  return MAJOR_SCALE[note.degree - 1] + (note.alter ?? 0) + (note.octave ?? 0) * 12;
}

/**
 * Places a theme in a key, choosing the octave that centres it in the compass.
 *
 * Returns null when it will not fit at any octave, which is not a failure: a
 * theme with a two-octave leap is playable on a euphonium and nowhere near a
 * beginner's range on an Eb bass. The caller picks a different theme, the way
 * a pattern that will not fit falls back rather than being forced.
 */
export function realiseTheme(theme: Theme, options: RealiseOptions): RealisedTheme | null {
  const { instrument, clef, metre } = options;
  const fromBeat = options.fromBeat ?? 0;
  const [lowest, highest] = writtenRange(instrument, clef);

  const keys: KeyChange[] = [{ fromBeat, fifths: readableKey(options.fifths) }];
  for (const change of theme.keyChanges ?? []) {
    const previous = keys[keys.length - 1].fifths;
    keys.push({
      fromBeat: fromBeat + (change.atBar - 1) * metre.barBeats,
      fifths: readableKey(previous + change.fifths),
    });
  }

  // Which key each event falls under, so a degree is read against the key it is
  // actually in. Walked once, since the events already run in beat order.
  const slots: Slot[] = [];
  const sounded: Array<{ note: ThemeNote; key: number }> = [];
  let beat = fromBeat;
  let previousTied = false;
  let keyIndex = 0;

  for (const event of theme.events) {
    while (keyIndex + 1 < keys.length && keys[keyIndex + 1].fromBeat <= beat + 1e-9) keyIndex++;
    const duration = durationFromBeats(event.beats)!;
    if (isRest(event)) {
      slots.push({ startBeat: beat, duration, isRest: true, tiedFromPrevious: false });
      previousTied = false;
    } else {
      slots.push({ startBeat: beat, duration, isRest: false, tiedFromPrevious: previousTied });
      // A tie continuation is the note before it held, not a pitch of its own.
      if (!previousTied) sounded.push({ note: event, key: keyIndex });
      previousTied = event.tied === true;
    }
    // Snapped as it goes, not at the end: thirds drift, and every bar line
    // after the first triplet is compared against this. See `snapBeat`.
    beat = snapBeat(beat + event.beats);
  }

  /*
   * A change of key rebuilds the tune on the new tonic; it does not reprint the
   * old notes under a new signature. That would be a change of signature and
   * nothing else, and every degree after it would be reckoned against a key it
   * is not in — which shows up as a line full of accidentals cancelling a
   * signature that was never true. The same rule the patterns follow: a scale
   * in B flat is a different set of notes, not the same shape wearing a new
   * key.
   *
   * Each new tonic goes as near the last as its pitch class allows, so the
   * music stays in the register the player is already in and the key moves
   * underneath it. That is what a modulating part actually does.
   *
   * The tempting alternative is to honour the direction the delta names — "up a
   * fifth" really lifting by a fifth — and it was tried and is worse. Moving a
   * section bodily widens the whole theme's span by that interval, and since
   * the theme is then placed to centre what it spans, everything before the
   * change is dragged down to make room: on an Eb bass the first six bars went
   * two ledger lines under the stave to buy a lift in the last six. A theme
   * that wants a register change can say so per note, which is what `octave`
   * is for.
   */
  function tonicsFrom(base: number): number[] {
    const placed = [base];
    for (let i = 1; i < keys.length; i++) {
      const from = ((tonicPitchClass(keys[i - 1].fifths) % 12) + 12) % 12;
      const to = ((tonicPitchClass(keys[i].fifths) % 12) + 12) % 12;
      placed.push(placed[i - 1] + ((((to - from + 6) % 12) + 12) % 12) - 6);
    }
    return placed;
  }

  function spanOf(base: number): [number, number] {
    const tonics = tonicsFrom(base);
    const pitched = sounded.map(({ note, key }) => tonics[key] + semitonesAbove(note));
    return [Math.min(...pitched), Math.max(...pitched)];
  }

  /*
   * The opening tonic may sit in any octave whose pitch class matches the key.
   * The one inside `tonicWindow` is the one wanted, so the same tune sits in
   * the same part of the instrument whichever key it is played in.
   *
   * Outside the window is a fallback rather than a failure: a theme that spans
   * more than the compass leaves above its tonic has to sit lower, and a tune
   * an octave from home is better than no tune. Every candidate is still tested
   * against the whole theme, since one that modulates upwards can fit at the
   * start and run off the top later.
   */
  const tonicClass = ((tonicPitchClass(keys[0].fifths) % 12) + 12) % 12;
  const [windowLow, windowHigh] = tonicWindow(instrument, clef);
  const bases: number[] = [];
  for (let midi = lowest - 24; midi <= highest + 24; midi++) {
    if (((midi % 12) + 12) % 12 === tonicClass) bases.push(midi);
  }

  const home = (windowLow + windowHigh) / 2;
  bases.sort((a, b) => Math.abs(a - home) - Math.abs(b - home));

  const holds = (candidate: number) => {
    const [low, high] = spanOf(candidate);
    return low >= lowest && high <= highest;
  };

  const base =
    bases.find((c) => c >= windowLow && c <= windowHigh && holds(c)) ?? bases.find(holds);
  if (base === undefined) return null;

  const tonics = tonicsFrom(base);
  const pitches = sounded.map(({ note, key }) => tonics[key] + semitonesAbove(note));

  return { slots, pitches, keys, beats: beat - fromBeat };
}

/**
 * One theme as a playable exercise, for looking at it and for testing.
 *
 * Stitching several together is the next piece of work; this is the one that
 * proves a theme survives the whole path from degrees to a drawn stave.
 */
export function exerciseFromTheme(theme: Theme, options: RealiseOptions): Exercise | null {
  const realised = realiseTheme(theme, options);
  if (!realised) return null;

  return assembleExercise(realised.slots, realised.pitches, {
    instrument: options.instrument,
    clef: options.clef,
    keys: realised.keys,
    metres: [{ fromBeat: 0, metre: options.metre }],
    totalBeats: realised.beats,
    seed: 0,
    kind: 'phrases',
  });
}
