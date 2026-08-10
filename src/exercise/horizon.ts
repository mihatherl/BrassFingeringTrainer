/**
 * The horizon: how much of the paper is white, and when more of it turns.
 *
 * The music runs past the length the player chose, drawn grey until it is
 * theirs. **It turns white a block at a time, a block being the length they
 * asked for** — choose eight bars and the grey promotes eight bars at a
 * stroke, the moment you play into it. This is the promotion `v2-design.md`
 * proposed: finishing a block is a moment, and a moment is worth having.
 *
 * The alternative, revealing one bar at a time as the playhead entered it,
 * was built first and is worse for the reason it looks better on paper: the
 * bar you are *about* to play stays grey until you are in it, so a player
 * reading ahead — which is the whole skill — is always reading grey. A block
 * hands over a stretch of music to read into.
 *
 * Everything here is pure arithmetic on the exercise, so it can be tested
 * without a clock, and it is clamped to the paper at both ends: the white
 * never begins before the chosen length nor runs past what was generated,
 * whatever beat it is handed.
 */

import type { Exercise } from './types';

/**
 * The beat the white currently ends at.
 *
 * `totalBeats` for an exercise with no horizon, which greys nothing — no note
 * starts at or after the end of the paper. Handed the visual beat, so it may
 * be negative during the count-in, and the first block stands until the
 * player crosses into the grey.
 */
export function whiteUntilBeat(exercise: Exercise, beat: number): number {
  const { chosenBeats, totalBeats } = exercise;
  // No horizon, or nonsense: all white, which is what the app did before
  // there was a horizon at all.
  if (!(chosenBeats > 0) || chosenBeats >= totalBeats) return totalBeats;
  if (!Number.isFinite(beat)) return chosenBeats;

  // Blocks completed, plus the one being played. The epsilon promotes on
  // arrival at a boundary rather than a float's width after it.
  const blocks = Math.floor(beat / chosenBeats + 1e-9) + 1;
  // Clamped hard at the paper's end: this is the number the renderer greys
  // against and the one thing that must not run past what was generated.
  return Math.min(totalBeats, Math.max(chosenBeats, blocks * chosenBeats));
}

/**
 * Whether the white has reached the end of the paper — the last block is in
 * play and there is no more to promote.
 *
 * The player has somewhere to be told about: an endless session that has run
 * out of music should say so rather than simply stopping.
 */
export function atLastBlock(exercise: Exercise, beat: number): boolean {
  return whiteUntilBeat(exercise, beat) >= exercise.totalBeats - 1e-9;
}
