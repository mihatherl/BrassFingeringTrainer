import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../exercise/difficulty';
import { EXERCISE_KINDS } from '../exercise/types';
import { MAJOR_KEYS } from '../domain/keys';
import { DEFAULT_SETTINGS, constrainToEntitlements } from '../storage/settings';
import { FREE, FREE_TIER, FULL, entitlementsFor, isLimited } from './entitlements';

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
    expect(FREE_TIER.kinds).toContain('scales');
    expect(FREE_TIER.bars).toBeGreaterThanOrEqual(4);
  });
});

describe('constraining settings', () => {
  const paidSettings = {
    ...DEFAULT_SETTINGS,
    fifths: 4,
    bars: 24,
    difficultyId: 'expert',
    kind: 'phrases' as const,
    readingMode: 'paged' as const,
    playbackMode: 'fingered' as const,
    weakNoteDrilling: true,
  };

  it('leaves everything alone when unlocked', () => {
    expect(constrainToEntitlements(paidSettings, FULL)).toEqual(paidSettings);
  });

  it('pulls every locked choice back to the free tier', () => {
    const limited = constrainToEntitlements(paidSettings, FREE);

    expect(limited.fifths).toBe(FREE_TIER.fifths);
    expect(limited.bars).toBe(FREE_TIER.bars);
    expect(FREE_TIER.difficultyIds).toContain(limited.difficultyId);
    expect(FREE_TIER.kinds).toContain(limited.kind);
    expect(limited.readingMode).toBe('scrolling');
    expect(limited.playbackMode).toBe('reference');
    expect(limited.weakNoteDrilling).toBe(false);
  });

  it('leaves free-tier choices untouched rather than resetting them', () => {
    // Someone on the free tier who picked Easy and scales should keep them.
    const chosen = {
      ...DEFAULT_SETTINGS,
      fifths: 0,
      bars: 4,
      difficultyId: 'easy',
      kind: 'scales' as const,
    };
    expect(constrainToEntitlements(chosen, FREE)).toEqual({ ...chosen, weakNoteDrilling: false });
  });

  it('does not lengthen an exercise that is already short', () => {
    const short = { ...DEFAULT_SETTINGS, bars: 4 };
    expect(constrainToEntitlements(short, FREE).bars).toBe(4);
  });

  it('leaves the silent option alone, which is not a paid feature', () => {
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
    expect(limited.bars).toBeGreaterThan(0);
  });
});
