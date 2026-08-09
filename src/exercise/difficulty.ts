/**
 * Difficulty presets.
 *
 * A preset is nothing but a bundle of generator parameters — there is no
 * separate notion of "level" anywhere else in the app. That keeps difficulty
 * honest: every step up is a specific, visible change to what gets generated.
 */

import type { Duration } from '../domain/rhythm';

export interface RhythmWeight {
  duration: Duration;
  weight: number;
}

/**
 * How scales and arpeggios behave, which is deliberately not how free material
 * behaves.
 *
 * A scale drill is about the fingering and the shape, so at the easier levels it
 * is plain crotchets from end to end with nothing rhythmic to read. Reading is
 * what the other exercise kinds are for, and it starts being mixed into scales
 * from Medium upwards.
 */
export interface PatternSettings {
  /**
   * How far above the tonic the pattern reaches, in semitones — 7 for the first
   * five notes, 12 for an octave, 24 for two. Measured in semitones rather than
   * octaves so that the easiest level can stop at a fifth.
   *
   * Subject to the instrument's compass: two octaves needs 24 semitones of
   * headroom above the tonic, which not every key affords on every instrument.
   */
  spanSemitones: number;
  /** Shown in place of the difficulty name when a scale or arpeggio is chosen. */
  label: string;
  /** Shown beneath the difficulty buttons in place of the usual blurb. */
  blurb: string;
  /** Rhythm for scales and arpeggios; falls back to the general pool. */
  rhythms?: RhythmWeight[];
  /** Rest frequency for scales and arpeggios; falls back to the general one. */
  restChance?: number;
}

export interface Difficulty {
  id: string;
  name: string;
  blurb: string;
  patterns: PatternSettings;
  /** Width of the pitch range in semitones, centred on the instrument's range. */
  rangeSemitones: number;
  /** Largest permitted leap between consecutive notes, in semitones. */
  maxInterval: number;
  /** Probability that a note is chromatic rather than in key. */
  accidentalChance: number;
  /** Probability that a beat becomes a rest, in generators that use rests. */
  restChance: number;
  /**
   * Probability that a note which *could* cross the bar line does, and is
   * written as a tied pair.
   *
   * Conditional rather than absolute, so the number means something a player
   * would recognise: how often a bar end that could be tied over actually is.
   * Most positions in a bar cannot produce one at all, since it takes a note
   * longer than the room left in the bar.
   *
   * Scales and arpeggios never tie, for the same reason they get a rhythm pool
   * of their own — the exercise is the shape and the fingering, and a tie there
   * is a reading problem laid on top of a different drill.
   */
  tieChance: number;
  rhythms: RhythmWeight[];
}

const q = (value: Duration['value'], dotted = false): Duration => ({ value, dotted });

export const DIFFICULTIES: readonly Difficulty[] = [
  {
    id: 'beginner',
    name: 'Beginner',
    blurb: 'Steps and thirds over an octave, crotchets and minims. No accidentals.',
    patterns: {
      spanSemitones: 7,
      label: 'Fifth',
      blurb: 'The first five notes of the key, up and down, in plain crotchets.',
      rhythms: [{ duration: q('quarter'), weight: 1 }],
      restChance: 0,
    },
    rangeSemitones: 12,
    maxInterval: 4,
    accidentalChance: 0,
    restChance: 0,
    tieChance: 0,
    rhythms: [
      { duration: q('half'), weight: 2 },
      { duration: q('quarter'), weight: 5 },
    ],
  },
  {
    id: 'easy',
    name: 'Easy',
    blurb: 'An octave and a half, quavers, the occasional accidental and tie.',
    patterns: {
      spanSemitones: 12,
      label: '1 octave',
      blurb: 'A full octave, up and down, in plain crotchets.',
      rhythms: [{ duration: q('quarter'), weight: 1 }],
      restChance: 0,
    },
    rangeSemitones: 17,
    maxInterval: 5,
    accidentalChance: 0.05,
    restChance: 0.05,
    /*
     * Ties arrive here rather than at Medium, by convention rather than by
     * argument: a note held over a bar line is ordinary notation that a player
     * meets in the second thing they ever read, not a technique. Sparingly —
     * this is the chance that a bar end which *could* be tied over is, so a
     * reader meets one every few lines rather than every few bars.
     */
    tieChance: 0.15,
    rhythms: [
      { duration: q('half'), weight: 1 },
      { duration: q('quarter'), weight: 5 },
      { duration: q('eighth'), weight: 3 },
    ],
  },
  {
    id: 'medium',
    name: 'Medium',
    blurb: 'Wider leaps, dotted rhythms, ties over the bar line, accidentals in earnest.',
    patterns: {
      spanSemitones: 24,
      label: '2 octaves',
      blurb: 'Two octaves, with quavers mixed in. Dotted rhythms wait for Hard.',
      // Crotchets and quavers only. The step up from Easy here is the second
      // octave; dotted rhythms are what Hard adds, and piling both onto the same
      // level leaves nothing between them.
      rhythms: [
        { duration: q('quarter'), weight: 4 },
        { duration: q('eighth'), weight: 6 },
      ],
    },
    rangeSemitones: 22,
    maxInterval: 7,
    accidentalChance: 0.12,
    restChance: 0.08,
    tieChance: 0.3,
    rhythms: [
      { duration: q('quarter'), weight: 4 },
      { duration: q('quarter', true), weight: 1 },
      { duration: q('eighth'), weight: 6 },
    ],
  },
  {
    id: 'hard',
    name: 'Hard',
    blurb: 'Two octaves, semiquaver runs, frequent accidentals.',
    patterns: {
      spanSemitones: 24,
      label: '2 oct · mixed',
      blurb: 'Two octaves, with semiquaver runs and the occasional rest.',
    },
    rangeSemitones: 26,
    maxInterval: 12,
    accidentalChance: 0.25,
    restChance: 0.06,
    tieChance: 0.3,
    rhythms: [
      { duration: q('quarter'), weight: 2 },
      { duration: q('eighth'), weight: 6 },
      { duration: q('eighth', true), weight: 1 },
      { duration: q('sixteenth'), weight: 4 },
    ],
  },
  {
    id: 'expert',
    name: 'Expert',
    blurb: 'Full range, relentless semiquavers, heavily chromatic.',
    patterns: {
      spanSemitones: 24,
      label: '2 oct · runs',
      blurb: 'Two octaves of relentless semiquavers, with rests and dotted rhythms.',
    },
    rangeSemitones: 48,
    maxInterval: 16,
    accidentalChance: 0.4,
    restChance: 0.03,
    tieChance: 0.35,
    rhythms: [
      { duration: q('eighth'), weight: 3 },
      { duration: q('sixteenth'), weight: 8 },
    ],
  },
];

export function difficultyById(id: string): Difficulty {
  const found = DIFFICULTIES.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown difficulty: ${id}`);
  return found;
}
