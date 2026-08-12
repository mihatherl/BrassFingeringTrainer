import type { Clef } from '../domain/instruments';
import type { KeyChange } from '../domain/keys';
import type { MetreChange } from '../domain/metre';
import type { SpelledPitch } from '../domain/pitch';
import type { Duration } from '../domain/rhythm';
import type { TempoEvent } from '../domain/tempo';

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
   * Which triplet this note belongs to, or -1.
   *
   * Its own grouping rather than a reuse of `beamGroup`, because the two are
   * not the same span and only look it in easy cases: a triplet of quavers is
   * beamed and bracketed identically, but three triplet crotchets are bracketed
   * and not beamed at all, and a beam can run across two triplets in a row that
   * want a numeral each. The bracket answers "how does this divide", the beam
   * answers "how does this group" — different questions with different answers.
   */
  tupletGroup: number;
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

/**
 * Whether the instrument in hand can play this note at all.
 *
 * A note outside the instrument's range resolves to no fingering, so
 * `acceptedMasks` is empty and nothing the player holds can ever match it. That
 * only arises with imported music — the generator asks `isPlayable` before it
 * chooses a pitch — and a part written for a cornet can easily reach above what
 * a tuba has.
 *
 * Such a note is **shown and sounded but not judged**, for the same reason the
 * far end of a tie is not: it asked nothing of the player that they could have
 * answered, so a verdict on it is not evidence of anything. Left in the totals
 * it would be a wrong answer nobody could have got right, quietly spoiling the
 * score for the whole run.
 */
export function isUnplayable(note: NoteEvent): boolean {
  return note.acceptedMasks.length === 0;
}

export interface RestEvent {
  startBeat: number;
  duration: Duration;
  /**
   * Bars this rest covers when it is a **multi-bar rest** — the thick bar with
   * a count over it that a brass part is full of. Absent for an ordinary rest,
   * which is the only kind the generator makes.
   *
   * Authoritative for how long the rest lasts, and `duration` stays honest
   * beside it: a whole-bar rest is written as a semibreve rest whatever the
   * metre, so `duration` says what *one* of these bars is written as while
   * `bars` says how many there are. The two only agree in 4/4 and are not
   * meant to.
   *
   * **A multi-bar rest is not unfolded.** It is how the music is read — twenty
   * bars rest is one object with "20" over it, and writing out twenty bars of
   * semibreve rests would fill the screen with something no publisher prints.
   * That is the opposite of a bar repeat, which *is* unfolded, because it is
   * shorthand for music that has to sound. See `musicxml-import-plan.md`.
   */
  bars?: number;
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
   * times — the same reason `metres` is a shape of its own rather than a loose
   * numerator. Ask it with `keyAt`; a single-key exercise is a list of one and
   * costs nothing.
   */
  keys: KeyChange[];
  /**
   * The time signature, and any changes of it, in beat order starting at 0.
   *
   * Each entry is a whole `Metre` rather than a loose numerator and denominator,
   * because the numerator is not the length of a bar and the two only agree
   * while the denominator is 4. See `metre.ts`.
   *
   * A list for the same reason `keys` is one: a real part changes time
   * signature, and everything that counts bars has to survive it. Ask it with
   * `metreAt`, and count bars with `barAt`, which walks the list — a generated
   * exercise is a list of one and costs nothing.
   */
  metres: MetreChange[];
  /**
   * Where the tempo moves, in beat order, with absolute bpm values.
   *
   * The same shape of addition as `keys`: settled at generation time, empty
   * for an exercise that holds its speed — which costs nothing, exactly as a
   * single-key exercise is a key list of one. The transport compiles it; the
   * renderers print it; neither may invent one, because a tempo change with
   * nothing printed would be the page lying about the music.
   */
  tempo: TempoEvent[];
  /** Length of the exercise in crotchets. */
  totalBeats: number;
  /**
   * Where the length the player chose ends, in crotchets.
   *
   * Equal to `totalBeats` for an exercise with no horizon, which is every
   * exercise a tool or a test asks for by exact length. Less than it when the
   * material carries on past the chosen length in grey: the music between the
   * two is real and generated, and whether the player meets it is up to them.
   */
  chosenBeats: number;
  seed: number;
  /** How the material was generated, for the results screen. */
  kind: ExerciseKind;
}

/**
 * Where an exercise came from.
 *
 * `imported` is deliberately **not** in `EXERCISE_KINDS`: that list drives the
 * chooser on the settings screen, and imported music is not something the
 * generator can be asked for — it arrives with a file. The union carries it so
 * that everything downstream can tell an imported part from a generated one,
 * and the chooser lists only what can actually be chosen.
 */
export type ExerciseKind =
  | 'random'
  | 'scales'
  | 'arpeggios'
  | 'phrases'
  | 'themes'
  | 'imported';

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
