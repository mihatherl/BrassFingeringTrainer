import { describe, expect, it } from 'vitest';
import { estimateLead, MIN_TAPS, SETTLING_TAPS, TAPS_KEPT } from './calibrate';

/**
 * The player's finger as a latency sensor: clicks at known clock times, taps
 * in time with what is heard, and the middle of the offsets is the device.
 */
describe('estimating an output lead from taps', () => {
  /** Clicks once a second from t=1. */
  const clicks = Array.from({ length: 20 }, (_, i) => 1 + i);
  /** Taps at each click plus `late` seconds, with a small alternating wobble. */
  const tapping = (late: number, count: number, wobble = 0.01) =>
    clicks.slice(0, count).map((c, i) => c + late + (i % 2 === 0 ? wobble : -wobble));

  it('says nothing until there are enough taps', () => {
    expect(estimateLead(tapping(0.2, MIN_TAPS - 1), clicks)).toBeNull();
    expect(estimateLead(tapping(0.2, MIN_TAPS), clicks)).not.toBeNull();
    expect(estimateLead(tapping(0.2, MIN_TAPS), [])).toBeNull();
  });

  it('reads a headset that is late as a lead of that much', () => {
    const estimate = estimateLead(tapping(0.21, 10), clicks)!;
    expect(estimate.leadMs).toBe(210);
    expect(estimate.spreadMs).toBeLessThanOrEqual(10);
    expect(estimate.taps).toBe(Math.min(10 - SETTLING_TAPS, TAPS_KEPT));
  });

  it('adds the lead already in force, so measuring again converges', () => {
    // With 200ms of lead applied the clicks are heard on time, the taps land
    // on them, and the estimate is the same 200ms rather than zero — or 400.
    const estimate = estimateLead(tapping(0, 10), clicks, 0.2)!;
    expect(estimate.leadMs).toBe(200);
  });

  it('is unmoved by one wild tap', () => {
    // A fumble a third of a second off would drag a mean by forty milliseconds.
    // (Not half a second: at 60 clicks a minute that is the point where a tap
    // is nearer the *next* click, and is honestly read as an early one.)
    const taps = tapping(0.15, 10);
    taps[6] += 0.3;
    expect(estimateLead(taps, clicks)!.leadMs).toBe(150);
  });

  it('lets the first taps go, which are the player finding the beat', () => {
    const taps = tapping(0.15, 10);
    for (let i = 0; i < SETTLING_TAPS; i++) taps[i] += 0.3;
    expect(estimateLead(taps, clicks)!.leadMs).toBe(150);
    // And they are not counted among what the estimate rests on: the median
    // would shrug two wild taps off anyway, so this is where it shows.
    expect(estimateLead(tapping(0.15, MIN_TAPS + 1), clicks)!.taps).toBe(
      MIN_TAPS + 1 - SETTLING_TAPS,
    );
  });

  it('believes the most recent taps over earlier ones', () => {
    // A player who tightens up half way through is measured on the tight half.
    const loose = tapping(0.3, 8);
    const tight = clicks.slice(8, 8 + TAPS_KEPT).map((c) => c + 0.15);
    expect(estimateLead([...loose, ...tight], clicks)!.leadMs).toBe(150);
  });

  it('can come out a little negative, for a player tapping ahead of a speaker', () => {
    expect(estimateLead(tapping(-0.02, 8), clicks)!.leadMs).toBe(-20);
  });
});
