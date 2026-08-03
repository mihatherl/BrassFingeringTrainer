/**
 * Seeded random numbers.
 *
 * Exercises are generated from a seed rather than Math.random so that any
 * exercise can be replayed exactly — useful for retrying a run you fluffed, and
 * essential for tests that assert on generated material.
 */

export interface Rng {
  (): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Picks by weight; weights need not sum to anything in particular. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  chance(probability: number): boolean;
}

/** mulberry32 — small, fast and statistically fine for this. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = next as Rng;

  rng.int = (min, max) => min + Math.floor(next() * (max - min + 1));

  rng.pick = (items) => {
    if (items.length === 0) throw new Error('Cannot pick from an empty list');
    return items[Math.floor(next() * items.length)];
  };

  rng.weighted = (items, weightOf) => {
    if (items.length === 0) throw new Error('Cannot pick from an empty list');
    const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
    if (total <= 0) return rng.pick(items);
    let target = next() * total;
    for (const item of items) {
      target -= Math.max(0, weightOf(item));
      if (target <= 0) return item;
    }
    return items[items.length - 1];
  };

  rng.chance = (probability) => next() < probability;

  return rng;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
