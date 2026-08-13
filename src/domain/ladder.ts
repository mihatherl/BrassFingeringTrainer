/**
 * The notes a dial steps through.
 *
 * A range is chosen by moving a note up and down a stave, and the useful unit
 * of that movement is a *stave step* rather than a semitone: one click, one
 * line or space, spelled by the key signature so nothing carries an accidental
 * the player did not ask for. Three octaves of tuba is then about twenty-one
 * stops instead of thirty-six, and every one of them is a note that belongs to
 * the key it will be read in.
 *
 * The ends of the compass are on the ladder whatever key is in force. An Eb
 * bass in treble clef bottoms out on written C#3, which is in no flat key at
 * all, and a picker that could not reach the bottom of the horn would be
 * refusing to say the one thing a low-brass player most often wants to say.
 *
 * None of this narrows what gets *generated*: the pool between two bounds is
 * every chromatic note in it, as it always was. The ladder governs where the
 * bounds may be put, not what is drawn from between them.
 */

import { scalePitchClasses } from './keys';
import { pitchClass } from './pitch';

/**
 * Every note of the key between two written pitches, ascending, with both ends
 * of the compass included whether they belong to the key or not.
 */
export function keyLadder(fifths: number, low: number, high: number): number[] {
  if (high < low) return [];
  const inKey = scalePitchClasses(fifths);
  const ladder: number[] = [];
  for (let midi = low; midi <= high; midi++) {
    if (midi === low || midi === high || inKey.has(pitchClass(midi))) ladder.push(midi);
  }
  return ladder;
}

/**
 * The note `delta` steps along the ladder from `from`, clamped at either end.
 *
 * `from` need not be on the ladder. A range chosen in E flat and then read in
 * C leaves its bounds sitting between two rungs, and a dial that refused to
 * move from there — or that jumped to the nearest rung and called that a step —
 * would be doing something the player cannot predict. Instead the first rung in
 * the direction of travel counts as the first step, so one click always moves
 * one place, and a second click carries on from a note that is now on the
 * ladder.
 *
 * Clamping rather than wrapping: the ends of this ladder are the ends of the
 * instrument, and an instrument does not wrap.
 */
export function stepOnLadder(values: readonly number[], from: number, delta: number): number {
  if (values.length === 0) return from;
  const last = values.length - 1;
  const at = (index: number) => values[Math.min(last, Math.max(0, index))];

  const exact = values.indexOf(from);
  if (exact >= 0) return at(exact + delta);
  if (delta === 0) return from;

  if (delta > 0) {
    const above = values.findIndex((value) => value > from);
    // Past the top rung there is nothing above to step to.
    return above === -1 ? values[last] : at(above + delta - 1);
  }

  let below = -1;
  for (let i = last; i >= 0; i--) {
    if (values[i] < from) {
      below = i;
      break;
    }
  }
  return below === -1 ? values[0] : at(below + delta + 1);
}
