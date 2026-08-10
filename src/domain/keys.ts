/**
 * Key signatures and note spelling.
 *
 * The key selected in the UI is the *written* key — what the player actually
 * sees on the stave — not the concert key. For a transposing instrument those
 * differ, and the written one is the only one relevant to reading and fingering.
 */

import {
  LETTERS,
  LETTER_SEMITONES,
  pitchClass,
  type Letter,
  type SpelledPitch,
} from './pitch';

export interface KeySignature {
  /** Position on the circle of fifths: -7 (Cb) .. +7 (C#). */
  fifths: number;
  /** Tonic name of the major key, e.g. "Eb". */
  name: string;
  /** Relative minor, for display. */
  relativeMinor: string;
}

/** A key coming into force, and the beat it does so on. */
export interface KeyChange {
  /** Beats from the start of the exercise. The first is always 0. */
  fromBeat: number;
  fifths: number;
}

/**
 * The key in force at a beat.
 *
 * Deliberately the same shape as `metre.ts`'s "what is in force at beat b" —
 * a piece can change key partway through, and one day metre as well, and both
 * want asking the same way rather than each inventing its own lookup.
 *
 * Total over negative beats, because the count-in sits there: before the first
 * change, the first key applies. A list is never empty in practice, but an
 * empty one answers C major rather than throwing, since a renderer midway
 * through a frame is no place to discover a malformed exercise.
 */
export function keyAt(changes: readonly KeyChange[], beat: number): number {
  let fifths = changes[0]?.fifths ?? 0;
  for (const change of changes) {
    if (change.fromBeat > beat) break;
    fifths = change.fifths;
  }
  return fifths;
}

/** Whether the key ever changes, for the many places that only care if it does. */
export function changesKey(changes: readonly KeyChange[]): boolean {
  return changes.length > 1;
}

/**
 * The key with the most accidentals the exercise ever reaches.
 *
 * For anything that has to reserve room once and keep it: a signature's width
 * follows its accidental count, and a header that grew mid-exercise would move
 * every note on the line with it.
 */
export function widestKey(changes: readonly KeyChange[]): number {
  let widest = 0;
  for (const change of changes) {
    if (Math.abs(change.fifths) > Math.abs(widest)) widest = change.fifths;
  }
  return widest;
}

/**
 * Which key a unit of material is played in, touring the set for as long as
 * the player keeps going.
 *
 * A unit is whatever the material is measured in — a cycle of a scale, a
 * whole theme. The set is dealt across the units the player asked for, each
 * key holding for a contiguous block, and **the tour then carries on round
 * the set indefinitely**, because the music does: past the chosen length the
 * paper continues, and a player working through four keys wants the fourth
 * as much as the first.
 *
 * Where the set is larger than the chosen length can hold, the keys are taken
 * **in order from the closest** rather than sampled across the set. Asking
 * for two cycles of four keys used to give the first and the third, skipping
 * a key the player had chosen for no reason they could see; now it gives the
 * first and the second, and the rest arrive if they play on.
 *
 * `unitsChosen` is what the player asked for, not what was generated: the
 * grey beyond it is more of the same tour rather than a new one.
 */
export function tourKey(
  ordered: readonly number[],
  unit: number,
  unitsChosen: number,
): number {
  // Units each key holds for. At least one, so a set larger than the chosen
  // length moves on every unit rather than standing still — which is what a
  // whole-number division silently did: four keys across one chosen cycle
  // advanced four places per cycle, and four places round a set of four is
  // no movement at all.
  const per = Math.max(1, Math.ceil(unitsChosen / ordered.length));
  return ordered[Math.floor(unit / per) % ordered.length];
}

/**
 * Puts a set of keys in an order that modulates rather than jumps.
 *
 * Distance on the circle of fifths is the measure, because that is what
 * closeness between keys actually means: a step of one is a move to the
 * dominant or the subdominant, the two modulations most music makes, and the
 * two keys share all but one note. Sorting by pitch instead would call C and
 * B adjacent, which is about as far apart as two keys get.
 *
 * Greedy from the starting key rather than globally optimal. The set is at
 * most a handful and every step being *locally* the smallest available is what
 * a listener hears; nothing is improved by a cleverer route with a worse first
 * move.
 */
export function orderByCloseness(start: number, keys: readonly number[]): number[] {
  const remaining = keys.filter((f) => f !== start);
  const ordered = [start];

  while (remaining.length > 0) {
    const from = ordered[ordered.length - 1];
    let nearest = 0;
    for (let i = 1; i < remaining.length; i++) {
      const closer = Math.abs(remaining[i] - from) < Math.abs(remaining[nearest] - from);
      // Ties go to the flat side, which is where brass band music lives.
      const tied = Math.abs(remaining[i] - from) === Math.abs(remaining[nearest] - from);
      if (closer || (tied && remaining[i] < remaining[nearest])) nearest = i;
    }
    ordered.push(remaining.splice(nearest, 1)[0]);
  }

  return ordered;
}

/** Order in which sharps and flats are added to a key signature. */
export const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export const MAJOR_KEYS: readonly KeySignature[] = [
  { fifths: -7, name: 'Cb', relativeMinor: 'Ab' },
  { fifths: -6, name: 'Gb', relativeMinor: 'Eb' },
  { fifths: -5, name: 'Db', relativeMinor: 'Bb' },
  { fifths: -4, name: 'Ab', relativeMinor: 'F' },
  { fifths: -3, name: 'Eb', relativeMinor: 'C' },
  { fifths: -2, name: 'Bb', relativeMinor: 'G' },
  { fifths: -1, name: 'F', relativeMinor: 'D' },
  { fifths: 0, name: 'C', relativeMinor: 'A' },
  { fifths: 1, name: 'G', relativeMinor: 'E' },
  { fifths: 2, name: 'D', relativeMinor: 'B' },
  { fifths: 3, name: 'A', relativeMinor: 'F#' },
  { fifths: 4, name: 'E', relativeMinor: 'C#' },
  { fifths: 5, name: 'B', relativeMinor: 'G#' },
  { fifths: 6, name: 'F#', relativeMinor: 'D#' },
  { fifths: 7, name: 'C#', relativeMinor: 'A#' },
];

export function keyByFifths(fifths: number): KeySignature {
  const key = MAJOR_KEYS.find((k) => k.fifths === fifths);
  if (!key) throw new Error(`No key signature with ${fifths} fifths`);
  return key;
}

/** How a key signature's accidentals are usually described, e.g. "2 sharps". */
export function describeFifths(fifths: number): string {
  if (fifths === 0) return 'no sharps or flats';
  const count = Math.abs(fifths);
  const word = fifths > 0 ? 'sharp' : 'flat';
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Which letters the key signature alters, and by how much. */
export function keyAlterations(fifths: number): Record<Letter, number> {
  const alters: Record<Letter, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (let i = 0; i < fifths; i++) alters[SHARP_ORDER[i]] = 1;
  else for (let i = 0; i < -fifths; i++) alters[FLAT_ORDER[i]] = -1;
  return alters;
}

/** The letters carrying an accidental in the signature, in drawing order. */
export function signatureLetters(fifths: number): Letter[] {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths);
  return FLAT_ORDER.slice(0, -fifths);
}

/**
 * Chooses the spelling of a MIDI note within a key.
 *
 * Notes belonging to the key's diatonic scale are spelled with the letter the
 * signature already alters, so no accidental need be drawn.
 *
 * Chromatic notes are spelled by what a player expects to read, in this order:
 *
 * 1. Cancel the signature. Raising a flattened degree is written as a natural —
 *    the note above A flat in E flat major is A natural, never B double flat.
 * 2. Move in the direction of the key: sharp keys raise, flat keys lower. This
 *    is what makes E flat major produce G flat rather than F sharp.
 * 3. Failing both, whatever needs a single accidental.
 *
 * Cancelling comes first because the alternative is worse in exactly the cases
 * where it applies: F natural in G major is a natural sign, not E sharp.
 *
 * No spelling ever carries a double accidental. Every pitch class has one that
 * does not, and a practice app has no business asking a player to read
 * something a publisher would not print.
 */
export function spellInKey(midi: number, fifths: number): SpelledPitch {
  const alters = keyAlterations(fifths);
  const pc = pitchClass(midi);

  for (const letter of LETTERS) {
    if (pitchClass(LETTER_SEMITONES[letter] + alters[letter]) === pc) {
      return withOctave(letter, alters[letter], midi);
    }
  }

  const direction = fifths >= 0 ? 1 : -1;
  const preferences: Array<(letter: Letter) => number> = [
    () => 0,
    (letter) => alters[letter] + direction,
    () => direction,
    () => -direction,
  ];

  for (const alterFor of preferences) {
    for (const letter of LETTERS) {
      const alter = alterFor(letter);
      if (Math.abs(alter) > 1) continue;
      if (pitchClass(LETTER_SEMITONES[letter] + alter) === pc) {
        return withOctave(letter, alter, midi);
      }
    }
  }

  throw new Error(`Cannot spell MIDI ${midi}`);
}

/** The seven pitch classes of the key's major scale. */
/**
 * Semitones above the tonic for each degree of the major scale.
 *
 * Here rather than in the generator because two things now read it: the scale
 * patterns, and authored themes, which are written in degrees precisely so they
 * can be played in any key.
 */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

export function scalePitchClasses(fifths: number): Set<number> {
  const alters = keyAlterations(fifths);
  return new Set(LETTERS.map((l) => pitchClass(LETTER_SEMITONES[l] + alters[l])));
}

/** MIDI number of the key's tonic within a given octave. */
export function tonicPitchClass(fifths: number): number {
  // Each step round the circle of fifths moves the tonic up a fifth.
  return pitchClass(fifths * 7);
}

export function isDiatonic(midi: number, fifths: number): boolean {
  return scalePitchClasses(fifths).has(pitchClass(midi));
}

/** Does this note need an accidental drawn, given the key signature? */
export function needsAccidental(p: SpelledPitch, fifths: number): boolean {
  return keyAlterations(fifths)[p.letter] !== p.alter;
}

function withOctave(letter: Letter, alter: number, midi: number): SpelledPitch {
  // Derived rather than taken from the MIDI octave so that B#3 stays in octave 3
  // even though it sounds as C4.
  const octave = (midi - LETTER_SEMITONES[letter] - alter) / 12 - 1;
  return { letter, alter, octave };
}
