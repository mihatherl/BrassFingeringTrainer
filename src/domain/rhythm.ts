/**
 * Note durations.
 *
 * Everything is measured in beats, where one beat is a crotchet. Tempo in bpm
 * therefore converts to seconds with a single division, and the scrolling
 * display can work purely in beats without knowing the tempo at all.
 */

export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtySecond';

/**
 * Longest first, which is the order the searches below want.
 *
 * `thirtySecond` sits at the end and is reached last, so nothing that already
 * resolved resolves differently. **Nothing generates one**: the difficulty
 * tables name the values they draw from, and none of them names this. It is
 * here for imported music, where a demisemiquaver is somebody else's decision
 * and the alternative was dropping the note.
 */
export const NOTE_VALUES: readonly NoteValue[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtySecond',
];

/** Crotchet beats for each undotted value. */
export const NOTE_VALUE_BEATS: Record<NoteValue, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirtySecond: 0.125,
};

/** How many flags or beams the value carries. */
export const NOTE_VALUE_FLAGS: Record<NoteValue, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtySecond: 3,
};

export interface Duration {
  value: NoteValue;
  dotted: boolean;
  /**
   * Three of these in the time of two, or nothing.
   *
   * A triplet is not a note value and not a dot — it is an instruction about
   * how a group of them divides the beat, which is why it is a flag on an
   * ordinary value rather than a sixth entry in `NoteValue`. A triplet quaver
   * is a quaver that lasts two thirds of one, and it is still drawn as a
   * quaver: same notehead, same stem, same beam. What marks it is the bracket
   * and the numeral over the group, which is why nothing below this line needs
   * to know about it and the renderer does.
   *
   * Only the plain values take it. A dotted triplet is a real thing in the
   * hands of Brahms and has no business in a sight-reading trainer.
   */
  tuplet?: 3;
}

export function durationBeats(duration: Duration): number {
  const base = NOTE_VALUE_BEATS[duration.value];
  const dotted = duration.dotted ? base * 1.5 : base;
  return duration.tuplet ? (dotted * 2) / duration.tuplet : dotted;
}

export function quarterNote(): Duration {
  return { value: 'quarter', dotted: false };
}

/**
 * Nearest exact duration for a beat count, or null if it isn't representable.
 *
 * Plain and dotted values first, then triplets, so a length that is writable
 * both ways is written the ordinary way: two thirds of a beat is only ever a
 * triplet crotchet, but the order matters for anything that later divides three
 * ways and two ways at once. Undotted triplets only — see `Duration.tuplet`.
 */
export function durationFromBeats(beats: number): Duration | null {
  for (const value of NOTE_VALUES) {
    for (const dotted of [false, true]) {
      if (Math.abs(durationBeats({ value, dotted }) - beats) < 1e-9) {
        return { value, dotted };
      }
    }
  }
  for (const value of NOTE_VALUES) {
    if (Math.abs(durationBeats({ value, dotted: false, tuplet: 3 }) - beats) < 1e-9) {
      return { value, dotted: false, tuplet: 3 };
    }
  }
  return null;
}

/** Values that carry beams, i.e. can be grouped rather than flagged. */
export function isBeamable(duration: Duration): boolean {
  return NOTE_VALUE_FLAGS[duration.value] > 0;
}

/**
 * The finest division anything writable here lands on: a twenty-fourth of a
 * crotchet.
 *
 * Every duration the app can write is a whole number of these — a semiquaver is
 * six, a triplet quaver is eight, a dotted semiquaver is nine, a triplet
 * semiquaver is four.
 */
const BEAT_GRID = 24;

/**
 * Snaps an accumulated beat position onto that grid.
 *
 * Thirds are not exact in binary, so a bar of triplets accumulates error: three
 * triplet quavers come to 0.9999999999999999 and sixteen bars of them end at
 * 15.999999999999995. Nothing sounds different — the error is far below a
 * millisecond — but every *comparison* is wrong at the boundary, and the
 * boundaries are bar lines. A note landing at 11.999999999999998 is drawn in
 * the bar before the one it belongs to, and the system it belongs to loses it.
 *
 * So positions are snapped where they are accumulated rather than compared with
 * a tolerance everywhere: there is one grid, everything writable sits on it, and
 * the arithmetic stays exact after the snap rather than drifting further.
 */
export function snapBeat(beats: number): number {
  return Math.round(beats * BEAT_GRID) / BEAT_GRID;
}
