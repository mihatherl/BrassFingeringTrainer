/**
 * The tempo plan: where the speed moves, and by how much.
 *
 * The map arithmetic lives in `domain/tempo.ts` and takes whatever it is
 * given; this is the taste. It is seeded from the exercise's own rng, so
 * Repeat practises the same interpretation and the same seed renders the same
 * marks — the property every snapshot and every drilled passage leans on.
 *
 * A step lands only on a boundary the material already has. That is the same
 * rule key changes follow, and for the same reason: a theme is a whole
 * thought, and a conductor changes speed where one thought ends and the next
 * begins, not in the middle of somebody's phrase.
 */

import { TEMPO_RANGE, type TempoEvent } from '../domain/tempo';
import type { Rng } from './rng';

/**
 * How far a join may move the speed, as factors of the tempo the player set.
 *
 * A palette rather than a uniform draw, because a band is asked for
 * relationships, not percentages: noticeably steadier, a little steadier, a
 * little quicker, noticeably quicker. Everything within the ±25% the plan
 * agreed, and nothing inside the band where a change is too small to be
 * caught honestly — a step the player cannot perceive is a step they can only
 * fail.
 */
const STEP_FACTORS = [0.8, 0.9, 1.1, 1.25] as const;

export interface TempoPlanOptions {
  /**
   * The beat each stretch of material begins at, the first being 0. For
   * themes these are the joins from `stitchThemes`; material with no interior
   * boundaries passes just the opening and gets no steps at all.
   */
  starts: readonly number[];
  /** Crotchets per minute the player chose; every factor is of this. */
  bpm: number;
  rng: Rng;
}

/**
 * A step change at every interior boundary, each audibly different from the
 * tempo in force before it.
 *
 * Factors are of the chosen tempo rather than of each other, so a long
 * exercise wanders around the speed the player set instead of drifting away
 * from it. The factor in force is excluded from the next draw — a join where
 * nothing changes teaches nothing — and the result is clamped to the range
 * the settings themselves enforce, then rounded, because a printed metronome
 * mark says a whole number.
 */
export function planTempoSteps(options: TempoPlanOptions): TempoEvent[] {
  const { starts, bpm, rng } = options;
  const events: TempoEvent[] = [];
  let factor = 1;
  let inForce = bpm;

  for (const atBeat of starts) {
    if (atBeat <= 0) continue;

    const choices = STEP_FACTORS.filter((f) => f !== factor);
    factor = rng.pick(choices);

    const stepped = Math.round(
      Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, bpm * factor)),
    );
    // At the range's edges two factors can clamp to the same figure; a mark
    // restating the speed in force is not a change, so it is not written.
    if (stepped === inForce) continue;

    events.push({ kind: 'tempo', atBeat, bpm: stepped });
    inForce = stepped;
  }

  return events;
}
