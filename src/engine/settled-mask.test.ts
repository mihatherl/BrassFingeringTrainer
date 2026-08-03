import { beforeEach, describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import { SettledMask } from './settled-mask';

const NOTHING = maskOf([]);
const FIRST = maskOf([1]);
const SECOND = maskOf([2]);
const FIRST_SECOND = maskOf([1, 2]);

const SETTLE = 0.035;
let settled: SettledMask;

beforeEach(() => {
  settled = new SettledMask(SETTLE);
});

describe('settling a fingering', () => {
  it('adopts a state that holds still', () => {
    expect(settled.update(FIRST_SECOND, 0)).toBe(NOTHING);
    expect(settled.update(FIRST_SECOND, 0.05)).toBe(FIRST_SECOND);
  });

  it('ignores the stray fingering left mid-release', () => {
    // Lifting 1-2: valve 2 comes up a few milliseconds before valve 1, so the
    // hand reads as "1" in between. Nobody chose that, and nobody should hear it.
    settled.update(FIRST_SECOND, 0);
    settled.update(FIRST_SECOND, 0.05);
    expect(settled.value).toBe(FIRST_SECOND);

    expect(settled.update(FIRST, 0.2)).toBe(FIRST_SECOND); // transient begins
    expect(settled.update(NOTHING, 0.208)).toBe(FIRST_SECOND); // 8ms later, gone
    expect(settled.update(NOTHING, 0.25)).toBe(NOTHING); // the hand is off
  });

  it('ignores a stray fingering on the way into a note as well', () => {
    // Pressing 1-2 rarely lands both at once either.
    expect(settled.update(SECOND, 0.1)).toBe(NOTHING);
    expect(settled.update(FIRST_SECOND, 0.107)).toBe(NOTHING);
    expect(settled.update(FIRST_SECOND, 0.15)).toBe(FIRST_SECOND);
  });

  it('restarts the clock on every change', () => {
    // A hand still moving never settles, however long it has been moving for.
    let time = 0;
    for (const mask of [FIRST, FIRST_SECOND, SECOND, FIRST, NOTHING, FIRST]) {
      time += 0.02;
      expect(settled.update(mask, time)).toBe(NOTHING);
    }
    expect(settled.update(FIRST, time + 0.05)).toBe(FIRST);
  });

  it('settles on the state actually held, not the one that started the wait', () => {
    settled.update(FIRST, 0);
    settled.update(SECOND, 0.01);
    // The wait restarted at 0.01, so 0.05 is long enough — and what settles is
    // the second state, not the first.
    expect(settled.update(SECOND, 0.05)).toBe(SECOND);
  });

  it('treats holding nothing at the start as already settled', () => {
    expect(settled.update(NOTHING, 0)).toBe(NOTHING);
  });

  it('forgets everything on reset', () => {
    settled.update(FIRST_SECOND, 0);
    settled.update(FIRST_SECOND, 0.05);
    expect(settled.value).toBe(FIRST_SECOND);

    settled.reset();
    expect(settled.value).toBe(NOTHING);
    expect(settled.update(FIRST, 1)).toBe(NOTHING);
  });
});
