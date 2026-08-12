/**
 * Pitch primitives.
 *
 * MIDI numbers follow scientific pitch notation: C4 = 60, A4 = 69.
 *
 * A pitch has two independent aspects that must not be conflated:
 *  - its MIDI number, which determines sound and fingering;
 *  - its spelling (letter + accidental), which determines where it sits on the
 *    stave and which accidental is drawn. F#4 and Gb4 sound identical but are
 *    drawn a stave position apart.
 */

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Semitones above C for each natural letter. */
export const LETTER_SEMITONES: Record<Letter, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Diatonic index of each letter within an octave, for vertical stave placement. */
export const LETTER_STEPS: Record<Letter, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

export interface SpelledPitch {
  letter: Letter;
  /** -2 (double flat) .. +2 (double sharp); 0 is natural. */
  alter: number;
  octave: number;
}

export function midiOf(p: SpelledPitch): number {
  return (p.octave + 1) * 12 + LETTER_SEMITONES[p.letter] + p.alter;
}

/**
 * Absolute diatonic step number, counting every letter name from C-1 upwards.
 * C4 -> 35. Vertical position on a stave is a linear function of this, which is
 * exactly why it ignores accidentals: F4 and F#4 sit on the same line.
 */
export function diatonicStep(p: SpelledPitch): number {
  return (p.octave + 1) * 7 + LETTER_STEPS[p.letter];
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function formatPitch(p: SpelledPitch): string {
  const acc = p.alter === 0 ? '' : p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return `${p.letter}${acc}${p.octave}`;
}

const PITCH_PATTERN = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)$/;

/** Parses names like "C4", "Bb2", "F#3", "Cbb0". Mainly for tests and presets. */
export function parsePitch(name: string): SpelledPitch {
  const m = PITCH_PATTERN.exec(name.trim());
  if (!m) throw new Error(`Unparseable pitch: ${name}`);
  const letter = m[1].toUpperCase() as Letter;
  const accidental = m[2] ?? '';
  let alter = 0;
  if (accidental === 'x') alter = 2;
  else if (accidental.startsWith('#')) alter = accidental.length;
  else if (accidental.startsWith('b')) alter = -accidental.length;
  return { letter, alter, octave: Number(m[3]) };
}

/** Convenience: "Bb2" -> 46. */
export function midiFromName(name: string): number {
  return midiOf(parsePitch(name));
}
