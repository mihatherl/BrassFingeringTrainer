/**
 * The tempo plan: where the speed moves, and by how much.
 *
 * The map arithmetic lives in `domain/tempo.ts` and takes whatever it is
 * given; this is the taste. It is seeded from the exercise's own rng, so
 * Repeat practises the same interpretation and the same seed renders the same
 * marks — the property every snapshot and every drilled passage leans on.
 *
 * Events land only on boundaries the material already has. That is the same
 * rule key changes follow, and for the same reason: a theme is a whole
 * thought, and a conductor changes speed where one thought ends and the next
 * begins, not in the middle of somebody's phrase. Material with no interior
 * boundaries — a scale, a run of free bars — still has the one boundary
 * everything has, its end, and what a band does at an end is broaden into it.
 */

import type { Metre } from '../domain/metre';
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

/**
 * How deep a rit reaches, as factors of the tempo it broadens from.
 *
 * The closing rit digs deeper than one at a join: a final bar is allowed to
 * really settle, where a join has a new tempo waiting and too deep a bend
 * makes the step after it a lurch.
 */
const JOIN_RIT_FACTORS = [0.7, 0.75] as const;
const CLOSING_RIT_FACTORS = [0.6, 0.65, 0.7] as const;

/**
 * Whether a given join broadens into its change or takes it in stride.
 *
 * Half and half: every join ritting would teach that a change is always
 * telegraphed, and a band that relies on that gets caught by the ones that
 * are not. The closing rit is not drawn from this — ends always broaden.
 */
const JOIN_RIT_CHANCE = 0.5;

export interface TempoPlanOptions {
  /**
   * The beat each stretch of material begins at, the first being 0. For
   * themes these are the joins from `stitchThemes`; material with no interior
   * boundaries passes just the opening and gets only its closing rit.
   */
  starts: readonly number[];
  /** Where the music ends, which is the one boundary everything has. */
  totalBeats: number;
  /** For measuring rit spans in whole bars. */
  metre: Metre;
  /** Crotchets per minute the player chose; every step factor is of this. */
  bpm: number;
  rng: Rng;
}

function clamp(bpm: number): number {
  return Math.round(Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, bpm)));
}

/**
 * Steps at the interior boundaries, rits into some of them, and a closing rit
 * into the end.
 *
 * Step factors are of the chosen tempo rather than of each other, so a long
 * exercise wanders around the speed the player set instead of drifting away
 * from it; rit factors are of the tempo in force, because a rit is heard
 * against the speed it leaves. Everything is clamped to the range the
 * settings themselves enforce and rounded, because a printed mark says a
 * whole number — and an event that would change nothing is not written, since
 * a mark restating the speed in force is the page crying wolf.
 */
export function planTempo(options: TempoPlanOptions): TempoEvent[] {
  const { starts, totalBeats, metre, bpm, rng } = options;
  const events: TempoEvent[] = [];
  let factor = 1;
  let inForce = bpm;
  let previousBoundary = 0;

  /*
   * A rit spans whole bars of the stretch it closes: two where the stretch
   * has four or more, one where it has at least two, none where the material
   * is too short to broaden without the rit *being* the material.
   */
  const ritInto = (boundary: number, factors: readonly number[]): void => {
    const stretchBars = Math.floor((boundary - previousBoundary) / metre.barBeats + 1e-9);
    const ritBars = stretchBars >= 4 ? 2 : stretchBars >= 2 ? 1 : 0;
    if (ritBars === 0) return;

    const toBpm = clamp(inForce * rng.pick(factors));
    if (toBpm === inForce) return;

    events.push({
      kind: 'ramp',
      fromBeat: boundary - ritBars * metre.barBeats,
      toBeat: boundary,
      toBpm,
    });
    inForce = toBpm;
  };

  for (const atBeat of starts) {
    if (atBeat <= 0) continue;

    if (rng.chance(JOIN_RIT_CHANCE)) ritInto(atBeat, JOIN_RIT_FACTORS);

    const choices = STEP_FACTORS.filter((f) => f !== factor);
    factor = rng.pick(choices);
    const stepped = clamp(bpm * factor);
    if (stepped !== inForce) {
      events.push({ kind: 'tempo', atBeat, bpm: stepped });
      inForce = stepped;
    }

    previousBoundary = atBeat;
  }

  ritInto(totalBeats, CLOSING_RIT_FACTORS);
  return events;
}
