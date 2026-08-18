// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared context, and what happens when iOS leaves it for dead.
 *
 * A fake `AudioContext` whose state and clock the test drives: one that
 * runs and ticks, one that reports running over a clock that never moves,
 * and one that no `resume()` brings back. The player's report on
 * 2026-08-16: after the phone had been away, "Try again" did nothing and
 * only a refresh helped — because it asked the dead context to resume.
 */
class FakeContext {
  static made: FakeContext[] = [];
  state = 'suspended';
  currentTime = 0;
  closed = false;
  readonly behaviour: 'lively' | 'frozen' | 'dead';
  constructor(behaviour: 'lively' | 'frozen' | 'dead' = 'lively') {
    this.behaviour = behaviour;
    FakeContext.made.push(this);
  }
  addEventListener() {}
  async resume() {
    if (this.behaviour !== 'dead') this.state = 'running';
  }
  async close() {
    this.closed = true;
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { connect() {}, start() {} };
  }
  get destination() {
    return {};
  }
}

let behaviours: Array<'lively' | 'frozen' | 'dead'> = [];

beforeEach(() => {
  vi.useFakeTimers();
  FakeContext.made = [];
  behaviours = [];
  // Each new context takes the next behaviour on the list.
  vi.stubGlobal(
    'AudioContext',
    class extends FakeContext {
      constructor() {
        super(behaviours.shift() ?? 'lively');
      }
    },
  );
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets a lively context's clock tick while a promise settles. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    for (const ctx of FakeContext.made) if (ctx.behaviour === 'lively') ctx.currentTime += 0.05;
    await vi.advanceTimersByTimeAsync(25);
  }
  return promise;
}

describe('the audio context', () => {
  it('is one context, kept, while it runs and its clock moves', async () => {
    behaviours = ['lively'];
    const { getAudioContext, ensureRunning } = await import('./context');
    const first = getAudioContext();
    expect(await settle(ensureRunning())).toBe(true);
    expect(getAudioContext()).toBe(first);
    expect(FakeContext.made).toHaveLength(1);
  });

  it('is replaced when it reports running over a clock that never moves', async () => {
    behaviours = ['frozen', 'lively'];
    const { getAudioContext, ensureRunning } = await import('./context');
    const first = getAudioContext();
    expect(await settle(ensureRunning())).toBe(false);
    const second = getAudioContext();
    expect(second).not.toBe(first);
    expect((first as unknown as FakeContext).closed).toBe(true);
    expect(await settle(ensureRunning())).toBe(true);
  });

  it('is replaced when nothing can resume it', async () => {
    behaviours = ['dead', 'lively'];
    const { getAudioContext, ensureRunning } = await import('./context');
    const first = getAudioContext();
    expect(await settle(ensureRunning())).toBe(false);
    expect(getAudioContext()).not.toBe(first);
  });

  it('is replaced on the word of whoever watched its clock stand still', async () => {
    behaviours = ['lively', 'lively'];
    const { getAudioContext, markStuck } = await import('./context');
    const first = getAudioContext();
    markStuck();
    const second = getAudioContext();
    expect(second).not.toBe(first);
    // And only once: the fresh one is trusted until someone says otherwise.
    expect(getAudioContext()).toBe(second);
  });

  /**
   * A verdict is about the context that was watched, not about whatever is
   * current when it arrives.
   *
   * The play screen watches one run's clock for 600ms and reports what it
   * saw. By then the context it watched may already have been replaced — and
   * on iOS the replacement was brought up inside a tap, which cannot be had
   * again without another one. Discarding it on a report about its
   * predecessor would throw away the only working context in the room.
   */
  it('ignores a report about a context that has already been replaced', async () => {
    behaviours = ['lively', 'lively'];
    const { getAudioContext, markStuck } = await import('./context');
    const first = getAudioContext();
    markStuck();
    const second = getAudioContext();
    expect(second).not.toBe(first);

    // The stall check for the run that was using `first`, arriving late.
    markStuck(first);
    expect(getAudioContext()).toBe(second);
    expect((second as unknown as FakeContext).closed).toBe(false);

    // And a report about the context in hand is still heeded.
    markStuck(second);
    expect(getAudioContext()).not.toBe(second);
  });

  it('brings up a fresh context inside unlockAudio when the one in hand is dead', async () => {
    behaviours = ['dead', 'lively'];
    const { getAudioContext, unlockAudio } = await import('./context');
    const first = getAudioContext();
    const ctx = await settle(unlockAudio());
    expect(ctx).not.toBe(first);
    expect((ctx as unknown as FakeContext).state).toBe('running');
  });
});
