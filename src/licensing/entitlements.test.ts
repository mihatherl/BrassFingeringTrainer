import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../exercise/difficulty';
import { EXERCISE_KINDS } from '../exercise/types';
import { MAJOR_KEYS } from '../domain/keys';
import { DEFAULT_SETTINGS, constrainToEntitlements } from '../storage/settings';
import {
  FREE,
  FREE_TIER,
  FULL,
  entitlementsFor,
  horizonBarsFor,
  isLimited,
  type Entitlements,
} from './entitlements';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import { metreFor } from '../domain/metre';

describe('entitlements', () => {
  it('withholds nothing when unlocked', () => {
    expect(entitlementsFor(true)).toEqual(FULL);
    expect(isLimited(FULL)).toBe(false);
  });

  it('withholds everything optional when locked', () => {
    expect(entitlementsFor(false)).toEqual(FREE);
    expect(isLimited(FREE)).toBe(true);
  });
});

describe('the free tier', () => {
  it('names things that actually exist', () => {
    // The point of typing these against the real unions: a renamed difficulty
    // or exercise kind must break the build, not the free tier at runtime.
    for (const id of FREE_TIER.difficultyIds) {
      expect(DIFFICULTIES.some((d) => d.id === id), id).toBe(true);
    }
    for (const kind of FREE_TIER.kinds) {
      expect(EXERCISE_KINDS.some((k) => k.id === kind), kind).toBe(true);
    }
    expect(MAJOR_KEYS.some((k) => k.fifths === FREE_TIER.fifths)).toBe(true);
  });

  it('is enough to be worth using', () => {
    // A trial that cannot drill a real scale in a real key teaches nobody
    // anything, and sells nothing either.
    expect(FREE_TIER.difficultyIds.length).toBeGreaterThan(1);
    // Every material the generator can make, since v2.14.0: a mode you are
    // shown but cannot use says nothing useful about what the app is for.
    for (const kind of EXERCISE_KINDS) expect(FREE_TIER.kinds).toContain(kind.id);
  });
});

/**
 * The lever that replaced *lengths* in v2.14.0. Both tiers are given the same
 * exercise; only a paid one may carry on past the end of it.
 */
describe('playing on', () => {
  it('gives a paid copy paper past the end, and a free one none', () => {
    expect(horizonBarsFor(FULL, 200)).toBe(200);
    expect(horizonBarsFor(FREE, 200)).toBeUndefined();
  });

  it('withholds it by not generating, so the offer is never raised', () => {
    /*
     * The end-to-end shape of the rule, at the seam where it matters. Without a
     * horizon the paper ends where the run is committed to — which is exactly
     * the condition `Session.canContinue` reads — so nothing has to refuse
     * anything, and no green button appears that turns out to be a shop.
     */
    const build = (entitlements: Entitlements) =>
      generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: 0,
        difficulty: difficultyById('easy'),
        kind: 'phrases',
        bars: 8,
        cycles: 2,
        themeCount: 2,
        metre: metreFor(4, 4),
        seed: 3,
        horizonBars: horizonBarsFor(entitlements, 200),
      });

    const free = build(FREE);
    expect(free.totalBeats, 'no paper past the committed end').toBe(free.chosenBeats);

    const paid = build(FULL);
    expect(paid.totalBeats, 'and a long way past it when paid for').toBeGreaterThan(
      paid.chosenBeats,
    );
  });
});

describe('constraining settings', () => {
  const paidSettings = {
    ...DEFAULT_SETTINGS,
    fifths: 4,
    difficultyId: 'hard',
    kind: 'phrases' as const,
    readingMode: 'paged' as const,
    weakNoteDrilling: true,
  };

  it('leaves everything alone when unlocked', () => {
    expect(constrainToEntitlements(paidSettings, FULL)).toEqual(paidSettings);
  });

  it('pulls every locked choice back to the free tier', () => {
    const limited = constrainToEntitlements(paidSettings, FREE);

    expect(limited.fifths).toBe(FREE_TIER.fifths);
    expect(FREE_TIER.difficultyIds).toContain(limited.difficultyId);
    expect(FREE_TIER.kinds).toContain(limited.kind);
    expect(limited.readingMode).toBe('scrolling');
    expect(limited.weakNoteDrilling).toBe(false);
  });

  it('leaves free-tier choices untouched rather than resetting them', () => {
    // Someone on the free tier who picked Easy and scales should keep them.
    const chosen = {
      ...DEFAULT_SETTINGS,
      fifths: 0,
      // The set always holds the key being started in; anything else is a
      // state `sanitise` would never hand out.
      keySet: [0],
      bars: 4,
      difficultyId: 'easy',
      kind: 'scales' as const,
    };
    expect(constrainToEntitlements(chosen, FREE)).toEqual({ ...chosen, weakNoteDrilling: false });
  });

  /**
   * Length is not a setting any more, so there is nothing here to pull back.
   * What the free tier is short of is the *horizon* — see `Entitlements.playOn`
   * — and that is withheld by not generating it, in `App.build`, rather than by
   * constraining anything. Nothing to assert here; the absence is the point.
   */

  it('leaves the silent option alone, which is not a paid feature', () => {
    // There is no playback entitlement and `FREE_TIER` no longer carries a
    // playback mode. It used to, unread, which is the sort of thing that has
    // people believing sound is behind the paywall when it never was — and the
    // line above this one asserted a value `constrainToEntitlements` simply
    // never touches, reading as if playback were pulled back with the rest.
    const silent = { ...DEFAULT_SETTINGS, playbackMode: 'off' as const };
    expect(constrainToEntitlements(silent, FREE).playbackMode).toBe('off');
  });

  it('is idempotent', () => {
    const once = constrainToEntitlements(paidSettings, FREE);
    expect(constrainToEntitlements(once, FREE)).toEqual(once);
  });

  it('never produces settings the app would reject', () => {
    // Constraining must yield something generatable, not merely something
    // smaller — every field still has to be a value the rest of the app knows.
    const limited = constrainToEntitlements(paidSettings, FREE);
    expect(DIFFICULTIES.some((d) => d.id === limited.difficultyId)).toBe(true);
    expect(EXERCISE_KINDS.some((k) => k.id === limited.kind)).toBe(true);
    expect(MAJOR_KEYS.some((k) => k.fifths === limited.fifths)).toBe(true);
  });
});
