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
  /**
   * Carrying on past the end of the exercise.
   *
   * The lever that replaced *lengths* in v2.14.0. Every tier now gets the same
   * default length for the material it chose — a length nobody has to pick, and
   * the settings screen is shorter for it — so what is on offer is not a longer
   * exercise but an endless one. A free run plays what it was given and stops;
   * a paid run is asked, in its last few beats, whether to carry on, and can be
   * answered by simply playing on.
   *
   * Enforced by not generating the horizon at all rather than by refusing the
   * offer: with no paper past the committed end, `Session.canContinue` is false
   * and the question is never raised. Nothing has to say no.
   */
  playOn: boolean;
  /** Difficulties above Easy. */
  allDifficulties: boolean;
  /**
   * Material kinds beyond the free tier's list.
   *
   * Currently gating nothing: the player ruled on 2026-08-15 that every kind
   * the generator can make is free, since being shown a mode you cannot use
   * teaches nobody anything about what the app is for. Kept as a mechanism —
   * `FREE_TIER.kinds` is the list, and re-gating is an edit to it — rather than
   * torn out, because *which* material is free is a pricing question and the
   * answer has already moved once.
   */
  allMaterial: boolean;
  /** Reading from a page rather than following a scrolling line. */
  pagedReading: boolean;
  /** Biasing exercises toward the notes you get wrong. */
  weakNoteDrilling: boolean;
}

export const FULL: Entitlements = {
  allKeys: true,
  playOn: true,
  allDifficulties: true,
  allMaterial: true,
  pagedReading: true,
  weakNoteDrilling: true,
};

export const FREE: Entitlements = {
  allKeys: false,
  playOn: false,
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
  difficultyIds: readonly string[];
  kinds: readonly ExerciseKind[];
  readingMode: ReadingMode;
} = {
  /** C major: no sharps or flats, and the natural key to start a brass player in. */
  fifths: 0,
  difficultyIds: ['beginner', 'easy'],
  /** Everything the generator can make; see `allMaterial`. */
  kinds: ['phrases', 'drills', 'themes'],
  readingMode: 'scrolling',
};

export function entitlementsFor(unlocked: boolean): Entitlements {
  return unlocked ? FULL : FREE;
}

/** Whether anything at all is being withheld, for deciding whether to mention it. */
export function isLimited(entitlements: Entitlements): boolean {
  return Object.values(entitlements).some((allowed) => !allowed);
}

/**
 * How far past the committed end to generate paper, for a given copy.
 *
 * The whole enforcement of `playOn`, in one place so it can be tested as a
 * rule rather than inferred from a screen. Withheld by *not generating* rather
 * than by declining: with no music past the committed end `Session.canContinue`
 * is false, the offer is never made, and there is no moment at which the app
 * has to say no — no green button that turns out to be a shop.
 */
export function horizonBarsFor(entitlements: Entitlements, horizon: number): number | undefined {
  return entitlements.playOn ? horizon : undefined;
}
