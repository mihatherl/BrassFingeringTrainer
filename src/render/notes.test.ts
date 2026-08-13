import { describe, expect, it } from 'vitest';
import { parsePitch, type SpelledPitch } from '../domain/pitch';
import { beamPlacement } from './notes';
import { staveMetrics, yForPitch } from './stave';

/**
 * Where a level beam sits over its group.
 *
 * Beams are kept horizontal here on purpose, which makes their height the whole
 * of the question: one line has to serve every note under it. Set from the note
 * furthest from it — which is what this did — the note nearest loses the
 * interval, and a beamed run of an octave arrives at a notehead with no stem at
 * all. Reported from bar 41 of a hymn: middle C up to the C above, the beam
 * running straight into the top note.
 *
 * So the property worth holding is not a number but a floor: **every note in
 * the group keeps a full stem**, whatever the spread.
 */

const SPACE = 12;
const STEM_LENGTH = 3.5;
const metrics = staveMetrics('treble', 100, SPACE);

const pitches = (...names: string[]): SpelledPitch[] => names.map(parsePitch);

/** Each note's stem, in stave spaces, as the drawing will render it. */
function stems(...names: string[]): number[] {
  const group = pitches(...names);
  const { up, y } = beamPlacement(metrics, group);
  return group.map((pitch) => (yForPitch(metrics, pitch) - y) * (up ? 1 : -1) / SPACE);
}

describe('where a beam sits', () => {
  it('leaves the note nearest it a full stem, and lengthens the rest', () => {
    // The reported bar: an octave, beamed, stems up.
    const [low, high] = stems('C4', 'C5');

    expect(high).toBeCloseTo(STEM_LENGTH);
    // Seven diatonic steps is three and a half spaces, all of it added to the
    // far note rather than taken off the near one.
    expect(low).toBeCloseTo(STEM_LENGTH + 3.5);
  });

  it('does the same with the beam underneath', () => {
    // High enough that the group takes down stems, and just as wide. The beam
    // is underneath, so the *lower* note is the one nearest it.
    const [high, low] = stems('C6', 'C5');

    expect(low).toBeCloseTo(STEM_LENGTH);
    expect(high).toBeCloseTo(STEM_LENGTH + 3.5);
  });

  it('never leaves a note without a stem, however wide the group', () => {
    /*
     * The floor, stated as a property rather than as a case: whatever the
     * spread and whichever way the group points, no note in it reaches the beam
     * in less than a full stem. A shorter one is the fault this file exists for
     * — at exactly an octave it was zero, and beyond that the beam crossed the
     * notehead and came out the other side.
     */
    const notes = ['C3', 'G3', 'C4', 'E4', 'G4', 'B4', 'C5', 'E5', 'C6'];
    for (const first of notes) {
      for (const second of notes) {
        for (const third of notes) {
          const group = [first, second, third];
          for (const stem of stems(...group)) {
            expect(stem, group.join(' ')).toBeGreaterThanOrEqual(STEM_LENGTH - 1e-9);
          }
        }
      }
    }
  });

  it('points the group away from whichever end is further from the middle', () => {
    // The direction rule, which the height rule reads and must not disturb.
    expect(beamPlacement(metrics, pitches('C4', 'E4')).up).toBe(true);
    expect(beamPlacement(metrics, pitches('C6', 'A5')).up).toBe(false);
    // A group straddling the middle line goes with its furthest note.
    expect(beamPlacement(metrics, pitches('C4', 'C5')).up).toBe(true);
  });
});
