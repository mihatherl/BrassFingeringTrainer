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
 * signature already alters, so no accidental need be drawn. Chromatic notes are
 * spelled in the direction of the key: sharp keys raise, flat keys lower. This
 * is what makes Eb major produce Ab rather than G#.
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
  for (const letter of LETTERS) {
    const alter = alters[letter] + direction;
    if (pitchClass(LETTER_SEMITONES[letter] + alter) === pc) {
      return withOctave(letter, alter, midi);
    }
  }

  // Unreachable for any key in MAJOR_KEYS, but spell something sane regardless.
  for (const letter of LETTERS) {
    for (const alter of [0, 1, -1, 2, -2]) {
      if (pitchClass(LETTER_SEMITONES[letter] + alter) === pc) {
        return withOctave(letter, alter, midi);
      }
    }
  }
  throw new Error(`Cannot spell MIDI ${midi}`);
}

/** The seven pitch classes of the key's major scale. */
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
