/**
 * @vitest-environment happy-dom
 *
 * The seam a purchase check will eventually run through.
 *
 * Nothing here is slow yet — the verdict comes from a build flag, a query
 * parameter and a `localStorage` read, all instant. These tests exist because
 * the *shape* is what matters: callers ask synchronously, the answer is held,
 * and a later answer replaces it and tells anything watching. Get that wrong
 * and it will not show until the day a store receipt is wired in, which is the
 * worst possible day to find out.
 *
 * The reference-stability test is the load-bearing one. `App` subscribes with
 * `useSyncExternalStore`, which compares snapshots by identity — a
 * `currentEntitlements` that built a fresh object each call would re-render
 * forever.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A fresh copy of the module per test, since the held verdict is module state
 * and these tests are precisely about how it is held.
 */
async function freshModule() {
  vi.resetModules();
  return import('./licence');
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe('holding the verdict', () => {
  it('hands back the same object every time, so a subscriber sees no change', async () => {
    const { currentEntitlements } = await freshModule();
    expect(currentEntitlements()).toBe(currentEntitlements());
  });

  it('keeps that identity across a refresh that changes nothing', async () => {
    const { currentEntitlements, refreshEntitlements } = await freshModule();
    const before = currentEntitlements();

    await refreshEntitlements();

    expect(currentEntitlements()).toBe(before);
  });
});

describe('an ungated build', () => {
  it('withholds nothing, whatever the unlock flag says', async () => {
    const { currentEntitlements, isGatedBuild } = await freshModule();
    expect(isGatedBuild()).toBe(false);
    expect(currentEntitlements().allKeys).toBe(true);
  });
});

describe('a gated build', () => {
  it('starts limited and opens up when a purchase is recorded', async () => {
    vi.stubEnv('VITE_GATED', 'true');
    const { currentEntitlements, setUnlocked, isGatedBuild } = await freshModule();

    expect(isGatedBuild()).toBe(true);
    expect(currentEntitlements().allKeys).toBe(false);

    setUnlocked(true);

    expect(currentEntitlements().allKeys).toBe(true);
  });

  it('tells anything watching when the verdict moves, and only then', async () => {
    vi.stubEnv('VITE_GATED', 'true');
    const { refreshEntitlements, setUnlocked, watchEntitlements } = await freshModule();

    let told = 0;
    const stop = watchEntitlements(() => {
      told += 1;
    });

    // Nothing has changed, so there is nothing to say.
    await refreshEntitlements();
    expect(told).toBe(0);

    setUnlocked(true);
    expect(told).toBe(1);

    // Unlocking again is not a change either.
    await refreshEntitlements();
    expect(told).toBe(1);

    stop();
    setUnlocked(false);
    expect(told).toBe(1);
  });
});
