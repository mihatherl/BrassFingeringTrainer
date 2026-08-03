import type { Clef } from '../domain/instruments';
import type { Duration } from '../domain/rhythm';

/**
 * One note in a generated exercise.
 *
 * Both pitches are stored: the written one drives notation and is what the
 * player reads, the sounding one drives playback. Fingerings are resolved at
 * generation time so neither the scheduler nor the judge has to think about
 * instruments.
 */
export interface NoteEvent {
  writtenMidi: number;
  soundingMidi: number;
  /** Beats from the start of the exercise, one beat being a crotchet. */
  startBeat: number;
  duration: Duration;
  /** Every button state accepted as correct, including alternate fingerings. */
  acceptedMasks: number[];
  /** The fingering a player would be taught, for hints and the results screen. */
  primaryMask: number;
  /** Index of the beam group, or -1 when the note stands alone. */
  beamGroup: number;
  /**
   * Whether an accidental must be drawn. Decided once at generation time, since
   * it depends on the key signature and on what has already occurred in the bar.
   */
  showAccidental: boolean;
}

export interface RestEvent {
  startBeat: number;
  duration: Duration;
}

export interface Exercise {
  notes: NoteEvent[];
  rests: RestEvent[];
  instrumentId: string;
  clef: Clef;
  /** Written key signature, on the circle of fifths. */
  fifths: number;
  beatsPerBar: number;
  beatUnit: number;
  totalBeats: number;
  seed: number;
  /** How the material was generated, for the results screen. */
  kind: ExerciseKind;
}

export type ExerciseKind = 'random' | 'scales' | 'arpeggios' | 'phrases';

export const EXERCISE_KINDS: ReadonlyArray<{ id: ExerciseKind; name: string; blurb: string }> = [
  { id: 'random', name: 'Random notes', blurb: 'Unpredictable intervals — pure fingering reflex.' },
  { id: 'scales', name: 'Scales', blurb: 'The major scale of the key, up and down. No accidentals.' },
  {
    id: 'arpeggios',
    name: 'Arpeggios',
    blurb: 'Tonic, subdominant, dominant, dominant 7th and relative minor — all in key.',
  },
  { id: 'phrases', name: 'Sight-reading', blurb: 'Musical phrases with contour, leaps and rests.' },
];
