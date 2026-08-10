/**
 * What a given copy of the app is allowed to do.
 *
 * Kept as a plain description of capabilities rather than as a notion of "paid"
 * or "trial", so that however unlocking eventually happens — an App Store
 * purchase, a licence key, a build flag, or nothing at all — the rest of the app
 * needs no idea about it. Only this module and `licence.ts` know that money
 * exists.
 *
 * The free tier is chosen to be genuinely usable rather than crippled: a player
 * can drill real fingerings in a real key and find out whether the thing suits
 * them. What is held back is variety — other keys, longer exercises, the harder
 * material, and the modes that make it a practice tool rather than a demo.
 */

import type { ExerciseKind } from '../exercise/types';
import type { ReadingMode } from '../render/surface';

export interface Entitlements {
  /** Any key signature, rather than C major alone. */
  allKeys: boolean;
  /** Exercise lengths beyond the shortest. */
  allLengths: boolean;
  /** Difficulties above Easy. */
  allDifficulties: boolean;
  /** Arpeggios and sight-reading, as well as random notes and scales. */
  allMaterial: boolean;
  /** Reading from a page rather than following a scrolling line. */
  pagedReading: boolean;
  /** Biasing exercises toward the notes you get wrong. */
  weakNoteDrilling: boolean;
}

export const FULL: Entitlements = {
  allKeys: true,
  allLengths: true,
  allDifficulties: true,
  allMaterial: true,
  pagedReading: true,
  weakNoteDrilling: true,
};

export const FREE: Entitlements = {
  allKeys: false,
  allLengths: false,
  allDifficulties: false,
  allMaterial: false,
  pagedReading: false,
  weakNoteDrilling: false,
};

/**
 * What the free tier is limited to, where a capability is a choice from a list.
 *
 * Typed against the real unions rather than left as loose strings, so renaming a
 * difficulty or an exercise kind breaks the build here instead of silently
 * leaving the free tier pointing at something that no longer exists.
 */
export const FREE_TIER: {
  fifths: number;
  bars: number;
  difficultyIds: readonly string[];
  kinds: readonly ExerciseKind[];
  readingMode: ReadingMode;
} = {
  /** C major: no sharps or flats, and the natural key to start a brass player in. */
  fifths: 0,
  bars: 4,
  difficultyIds: ['beginner', 'easy'],
  kinds: ['random', 'scales'],
  readingMode: 'scrolling',
};

export function entitlementsFor(unlocked: boolean): Entitlements {
  return unlocked ? FULL : FREE;
}

/** Whether anything at all is being withheld, for deciding whether to mention it. */
export function isLimited(entitlements: Entitlements): boolean {
  return Object.values(entitlements).some((allowed) => !allowed);
}
