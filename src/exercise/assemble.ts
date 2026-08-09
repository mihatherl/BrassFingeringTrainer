/**
 * The last step of building an exercise: slots and pitches in, an `Exercise`
 * out — noteheads paired with their fingerings, rests, beams and accidentals.
 *
 * Its own module because two things need it and neither owns it. Free material
 * and patterns arrive here from `generate.ts` having chosen their pitches by
 * walking or by contour; an authored theme arrives from `theme.ts` having been
 * told them. What happens after that point is identical, and has to stay
 * identical — a second copy of this would be a second set of rules about when a
 * note is beamed and when it takes an accidental.
 */

import { acceptedMasks as fingeringMasks, primaryFingering } from '../domain/fingering';
import { soundingFromWritten, type Clef, type Instrument } from '../domain/instruments';
import { keyAt, needsAccidental, spellInKey, type KeyChange } from '../domain/keys';
import { isBeamable, snapBeat, type Duration } from '../domain/rhythm';
import { barAt, type Metre } from '../domain/metre';
import type { Letter } from '../domain/pitch';
import type { TempoEvent } from '../domain/tempo';
import { isTieContinuation } from './ties';
import type { Exercise, ExerciseKind, NoteEvent, RestEvent } from './types';

/** One position in the rhythm, before it knows what pitch it holds. */
export interface Slot {
  startBeat: number;
  duration: Duration;
  isRest: boolean;
  /** The far end of a tie: same pitch as the slot before, and never a rest. */
  tiedFromPrevious: boolean;
}

export interface AssembleOptions {
  instrument: Instrument;
  clef: Clef;
  keys: KeyChange[];
  metre: Metre;
  totalBeats: number;
  seed: number;
  kind: ExerciseKind;
  /** Where the tempo moves. Absent means it does not, which is a list of none. */
  tempo?: TempoEvent[];
}

/**
 * Pairs each sounded slot with a pitch and builds the exercise around them.
 *
 * `pitches` holds one written MIDI number per slot that is neither a rest nor
 * the far end of a tie — a tie continuation is not a choice of pitch, it is the
 * note before it held, so it clones its head rather than consuming one.
 */
export function assembleExercise(
  slots: readonly Slot[],
  pitches: readonly number[],
  options: AssembleOptions,
): Exercise {
  const { instrument, clef, keys, metre } = options;

  /*
   * Every position snapped once, here, because this is where every producer
   * meets. Triplets do not divide exactly in binary and the error accumulates
   * into the bar lines — see `snapBeat`. Doing it at the one place they all
   * pass through beats doing it in three generators and hoping.
   */
  slots = slots.map((slot) => ({ ...slot, startBeat: snapBeat(slot.startBeat) }));
  const notes: NoteEvent[] = [];
  const rests: RestEvent[] = [];
  let pitchIndex = 0;

  for (const slot of slots) {
    if (slot.isRest) {
      rests.push({ startBeat: slot.startBeat, duration: slot.duration });
      continue;
    }
    if (slot.tiedFromPrevious) {
      const head = notes[notes.length - 1];
      head.tiedToNext = true;
      notes.push({
        ...head,
        startBeat: slot.startBeat,
        duration: slot.duration,
        acceptedMasks: [...head.acceptedMasks],
        beamGroup: -1,
        tupletGroup: -1,
        tiedToNext: false,
        showAccidental: false,
      });
      continue;
    }
    const writtenMidi = pitches[pitchIndex++];
    const soundingMidi = soundingFromWritten(writtenMidi, instrument, clef);
    const primary = primaryFingering(soundingMidi, instrument);
    notes.push({
      writtenMidi,
      soundingMidi,
      // Spelled in the key in force where it falls: F sharp and G flat are one
      // sound and two different things to read, and which one is right moves
      // with the key.
      pitch: spellInKey(writtenMidi, keyAt(keys, slot.startBeat)),
      startBeat: slot.startBeat,
      duration: slot.duration,
      acceptedMasks: [...fingeringMasks(soundingMidi, instrument)],
      primaryMask: primary?.mask ?? 0,
      beamGroup: -1,
      tupletGroup: -1,
      tiedToNext: false,
      showAccidental: false,
    });
  }

  assignTupletGroups(notes);
  assignBeamGroups(notes, rests, metre);
  assignAccidentals(notes, metre, keys);

  return {
    notes,
    rests,
    instrumentId: instrument.id,
    clef,
    keys,
    metre,
    tempo: options.tempo ?? [],
    totalBeats: snapBeat(options.totalBeats),
    seed: options.seed,
    kind: options.kind,
  };
}


/**
 * Marks which notes belong to which triplet.
 *
 * A run of triplet notes of the same value is one bracket. The run ends where
 * the value changes or an ordinary note interrupts, which is what a reader
 * expects: three, then three again, is two brackets and two numerals rather
 * than one over six.
 *
 * A lone triplet note cannot happen — three of them are what fills the time of
 * two — but a run that is not a multiple of three would mean the generator has
 * produced something unwritable, so it is bracketed as it stands rather than
 * silently dropped. Better a wrong-looking bracket than a rhythm that does not
 * add up and says nothing.
 */
function assignTupletGroups(notes: NoteEvent[]): void {
  let group = 0;
  let index = 0;

  while (index < notes.length) {
    const { duration } = notes[index];
    if (!duration.tuplet) {
      index++;
      continue;
    }

    /*
     * Exactly three to a bracket, not however many happen to be adjacent.
     *
     * Two triplet beats in a row are the same value and the same tuplet, so a
     * run-length rule swallows both into one bracket over six — which reads as
     * a sextuplet, a different rhythm. The beams get this right on their own
     * because they break at the pulse; the bracket has to be told.
     */
    let end = index;
    while (
      end + 1 < notes.length &&
      end + 1 - index < duration.tuplet &&
      notes[end + 1].duration.tuplet === duration.tuplet &&
      notes[end + 1].duration.value === duration.value
    ) {
      end++;
    }

    for (let i = index; i <= end; i++) notes[i].tupletGroup = group;
    group++;
    index = end + 1;
  }
}

/**
 * Beams runs of quavers and shorter within a beat.
 *
 * Grouping by beat is what makes a bar of semiquavers readable at a glance;
 * anything crossing a beat, or interrupted by a rest or a longer note, starts a
 * new group.
 */
function assignBeamGroups(notes: NoteEvent[], rests: RestEvent[], metre: Metre): void {
  // Grouped by pulse rather than by crotchet, which is the same thing in simple
  // time and the difference between beaming in twos and in threes once it is
  // not: 6/8 beams three quavers to a dotted crotchet.
  const pulseOf = (beat: number) => Math.floor(beat / metre.pulseBeats + 1e-9);
  const restBeats = new Set(rests.map((r) => pulseOf(r.startBeat)));
  let group = 0;
  let index = 0;

  while (index < notes.length) {
    const note = notes[index];
    if (!isBeamable(note.duration)) {
      index++;
      continue;
    }

    const beat = pulseOf(note.startBeat);
    const bar = barAt(metre, note.startBeat);
    let end = index;
    while (
      end + 1 < notes.length &&
      isBeamable(notes[end + 1].duration) &&
      pulseOf(notes[end + 1].startBeat) === beat &&
      barAt(metre, notes[end + 1].startBeat) === bar &&
      !restBeats.has(beat)
    ) {
      end++;
    }

    if (end > index) {
      for (let i = index; i <= end; i++) notes[i].beamGroup = group;
      group++;
    }
    index = end + 1;
  }
}

/**
 * Decides which notes need an accidental drawn.
 *
 * An accidental holds for the rest of the bar at that letter and octave, so a
 * repeated F# is marked once. Conversely a note that reverts to the key
 * signature after an accidental needs a natural to cancel it.
 *
 * A tie continuation never takes one. It is not a new note, so there is nothing
 * to alter; the accidental on the head of the tie carries across the bar line
 * with the sound. Nor does it establish anything in the bar it lands in, which
 * means a later note of that pitch in that bar gets an accidental of its own —
 * the cautionary an engraver would write there anyway.
 */
function assignAccidentals(notes: NoteEvent[], metre: Metre, keys: readonly KeyChange[]): void {
  let currentBar = -1;
  let altered = new Map<string, number>();

  for (const [index, note] of notes.entries()) {
    const bar = barAt(metre, note.startBeat);
    if (bar !== currentBar) {
      currentBar = bar;
      altered = new Map();
    }

    if (isTieContinuation(notes, index)) {
      note.showAccidental = false;
      continue;
    }

    // Spelling is already settled; this only decides what has to be drawn.
    const spelled = note.pitch;
    const key = `${spelled.letter as Letter}${spelled.octave}`;
    const established = altered.get(key);

    if (established === spelled.alter) {
      note.showAccidental = false;
      continue;
    }

    // Against the key in force here. A change always lands on a bar line, so
    // the per-bar reset above already clears what the old key established —
    // there is nothing left over for the new one to argue with.
    const differsFromKey = needsAccidental(spelled, keyAt(keys, note.startBeat));
    // Needed either because it departs from the signature, or because it must
    // cancel an accidental earlier in the bar.
    note.showAccidental = differsFromKey || established !== undefined;

    if (note.showAccidental) altered.set(key, spelled.alter);
  }
}
