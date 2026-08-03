import { beforeEach, describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import { IdleDetector } from './idle';

/**
 * `observe` takes the fingering held for a note and whether open was a correct
 * answer for it, and reports whether to sound the player's note.
 */
let idle: IdleDetector;

beforeEach(() => {
  idle = new IdleDetector();
});

const NOTHING = maskOf([]);
const FIRST = maskOf([1]);

describe('spotting that nobody is playing', () => {
  it('sounds the first wrong open note, then falls silent', () => {
    // One stray miss still deserves feedback — it might be a genuine mistake.
    expect(idle.observe(NOTHING, false)).toBe(true);
    // A second in a row is not a mistake, it is an empty chair.
    expect(idle.observe(NOTHING, false)).toBe(false);
    expect(idle.observe(NOTHING, false)).toBe(false);
    expect(idle.isIdle).toBe(true);
  });

  it('starts sounding again the moment a valve goes down', () => {
    idle.observe(NOTHING, false);
    idle.observe(NOTHING, false);
    expect(idle.isIdle).toBe(true);

    expect(idle.observe(FIRST, false)).toBe(true);
    expect(idle.isIdle).toBe(false);
  });

  it('never falls silent on someone playing open notes correctly', () => {
    // Open is a real fingering. A passage of open notes played right must not be
    // mistaken for an absent player.
    for (let i = 0; i < 20; i++) {
      expect(idle.observe(NOTHING, true)).toBe(true);
    }
    expect(idle.isIdle).toBe(false);
  });

  it('stays silent through open notes once it has decided nobody is there', () => {
    idle.observe(NOTHING, false);
    idle.observe(NOTHING, false);

    // Correct-by-accident open notes prove nothing, so the verdict stands.
    expect(idle.observe(NOTHING, true)).toBe(false);
    expect(idle.observe(NOTHING, true)).toBe(false);
    expect(idle.isIdle).toBe(true);
  });

  it('does not accumulate misses that are not consecutive', () => {
    // Someone playing badly is still playing.
    for (let i = 0; i < 10; i++) {
      expect(idle.observe(NOTHING, false)).toBe(true);
      expect(idle.observe(FIRST, false)).toBe(true);
    }
    expect(idle.isIdle).toBe(false);
  });

  it('tolerates a single fluffed note without going quiet', () => {
    idle.observe(maskOf([1, 2]), false);
    expect(idle.observe(NOTHING, false)).toBe(true);
    expect(idle.observe(maskOf([2]), false)).toBe(true);
    expect(idle.isIdle).toBe(false);
  });

  it('forgets everything on reset, so a new run starts clean', () => {
    idle.observe(NOTHING, false);
    idle.observe(NOTHING, false);
    expect(idle.isIdle).toBe(true);

    idle.reset();
    expect(idle.isIdle).toBe(false);
    expect(idle.observe(NOTHING, false)).toBe(true);
  });
});
