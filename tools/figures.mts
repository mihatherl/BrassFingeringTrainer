/**
 * Hand-written exercises, for the cases worth drawing on purpose.
 *
 * Generated material covers most of what wants looking at, but not the case
 * that has to hold a particular shape still — so these are fixed figures with
 * every note chosen, shared by the command-line tool and the engraving
 * snapshots for the same reason the drawing is: two copies would drift.
 */

import { spellInKey } from '../src/domain/keys.ts';
import { metreFor } from '../src/domain/metre.ts';
import { durationFromBeats } from '../src/domain/rhythm.ts';
import { instrumentById } from '../src/domain/instruments.ts';
import { assembleExercise, type Slot } from '../src/exercise/assemble.ts';
import type { Exercise, NoteEvent } from '../src/exercise/types.ts';

function note(startBeat: number, beats: number, midi: number, tiedToNext = false): NoteEvent {
  return {
    writtenMidi: midi,
    soundingMidi: midi - 21,
    // These figures are in C, so they spell against no signature.
    pitch: spellInKey(midi, 0),
    startBeat,
    duration: durationFromBeats(beats)!,
    acceptedMasks: [0],
    primaryMask: 0,
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext,
    showAccidental: false,
  };
}

/**
 * A crotchet tied over the bar line into a quaver, once low on the stave and
 * once high, so the tie is seen curving on both sides of the notes.
 *
 * Both directions in one figure on purpose: a tie hangs below a stem-up note
 * and arches above a stem-down one, and the two are placed by different arms of
 * the same code. Generated material will produce one of them or the other
 * depending on the seed, and so can pin only half of it.
 */
export function tiedFigure(): Exercise {
  return {
    notes: [
      note(0, 2, 64),
      note(2, 1, 67),
      note(3, 1, 60, true), // low: stem up, so the tie hangs below
      note(4, 0.5, 60),
      note(4.5, 1.5, 65),
      note(6, 1, 69),
      note(7, 1, 76, true), // high: stem down, so the tie arches above
      note(8, 0.5, 76),
      note(8.5, 1.5, 72),
      note(10, 2, 67),
    ],
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metre: metreFor(4, 4),
    totalBeats: 12,
    seed: 0,
    kind: 'random',
  };
}

/**
 * Triplets, in the three shapes that have to look right.
 *
 * Quaver triplets beamed in threes, where the bracket and the beam say the same
 * thing; crotchet triplets, which are bracketed and *not* beamed, and are the
 * case a beam-shaped implementation gets wrong; and two triplet beats running
 * together, which want a numeral each rather than one over six.
 *
 * Built through `assembleExercise` rather than as a literal, so the beaming and
 * the bracketing are the ones the app works out rather than ones written here
 * to look right. The first version of this figure was a literal and drew
 * nothing at all, because nothing had grouped it.
 */
export function tripletFigure(): Exercise {
  const third = 1 / 3;
  const twoThirds = 2 / 3;

  const shape: Array<[number, number]> = [
    // A beat of quaver triplets, then plain crotchets.
    [third, 60], [third, 64], [third, 67],
    [1, 65], [1, 64], [1, 62],
    // Two triplet beats running together: two brackets, not one.
    [third, 60], [third, 62], [third, 64],
    [third, 65], [third, 67], [third, 69],
    [1, 71], [1, 72],
    // Crotchet triplets — bracketed, and not beamed at all.
    [twoThirds, 76], [twoThirds, 74], [twoThirds, 72],
    [twoThirds, 71], [twoThirds, 69], [twoThirds, 67],
    // A plain close.
    [4, 60],
  ];

  const slots: Slot[] = [];
  let beat = 0;
  for (const [beats] of shape) {
    slots.push({
      startBeat: beat,
      duration: durationFromBeats(beats)!,
      isRest: false,
      tiedFromPrevious: false,
    });
    beat += beats;
  }

  return assembleExercise(
    slots,
    shape.map(([, midi]) => midi),
    {
      instrument: instrumentById('eb-bass'),
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metre: metreFor(4, 4),
      totalBeats: beat,
      seed: 0,
      kind: 'random',
    },
  );
}
