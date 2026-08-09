import type { Clef } from '../domain/instruments';
import type { KeyChange } from '../domain/keys';
import type { Metre } from '../domain/metre';
import type { SpelledPitch } from '../domain/pitch';
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
  /**
   * How the written pitch is spelled: the letter, the alteration and the
   * octave, which is what decides where the notehead sits and which accidental
   * it might carry.
   *
   * Settled here rather than worked out downstream, for the same reason the
   * fingerings and the accidental are: it depends on the key, and the key is
   * something the generator knows and the renderers should not have to. F sharp
   * and G flat are the same sounding note and a different thing to read.
   */
  pitch: SpelledPitch;
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
   * Joined to the note that follows: same pitch, one sound, no second attack.
   *
   * Held on the first note of the pair rather than the second because that is
   * the one that sounds; see `ties.ts` for what the rest of the app does with
   * the note on the other end of it.
   */
  tiedToNext: boolean;
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
  /**
   * The written key, and any changes of it, in beat order starting at 0.
   *
   * A list rather than one number because a part changes key, often several
   * times — the same reason `metre` is a shape of its own rather than a loose
   * numerator. Ask it with `keyAt`; a single-key exercise is a list of one and
   * costs nothing.
   */
  keys: KeyChange[];
  /**
   * The time signature and everything that follows from it.
   *
   * One field rather than a loose numerator and denominator, because the
   * numerator is not the length of a bar and the two only agree while the
   * denominator is 4. See `metre.ts`.
   */
  metre: Metre;
  /** Length of the exercise in crotchets. */
  totalBeats: number;
  seed: number;
  /** How the material was generated, for the results screen. */
  kind: ExerciseKind;
}

export type ExerciseKind = 'random' | 'scales' | 'arpeggios' | 'phrases' | 'themes';

export const EXERCISE_KINDS: ReadonlyArray<{ id: ExerciseKind; name: string; blurb: string }> = [
  { id: 'random', name: 'Random notes', blurb: 'Unpredictable intervals — pure fingering reflex.' },
  { id: 'scales', name: 'Scales', blurb: 'The major scale of the key, up and down. No accidentals.' },
  {
    id: 'arpeggios',
    name: 'Arpeggios',
    blurb: 'Tonic, subdominant, dominant, dominant 7th and relative minor — all in key.',
  },
  { id: 'phrases', name: 'Sight-reading', blurb: 'Musical phrases with contour, leaps and rests.' },
  {
    id: 'themes',
    name: 'Themes',
    blurb: 'Written tunes with a shape you can see coming — played whole, one after another.',
  },
];
