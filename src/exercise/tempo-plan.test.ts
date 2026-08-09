import { describe, expect, it } from 'vitest';
import { TEMPO_RANGE } from '../domain/tempo';
import { createRng } from './rng';
import { planTempoSteps } from './tempo-plan';

describe('the tempo plan', () => {
  const starts = [0, 32, 64, 96];

  it('steps at every interior boundary and never at the opening', () => {
    const events = planTempoSteps({ starts, bpm: 80, rng: createRng(1) });
    expect(events.map((e) => 'atBeat' in e && e.atBeat)).toEqual([32, 64, 96]);
    expect(events.every((e) => e.kind === 'tempo')).toBe(true);
  });

  it('is the same plan for the same seed, which is what Repeat leans on', () => {
    const a = planTempoSteps({ starts, bpm: 80, rng: createRng(7) });
    const b = planTempoSteps({ starts, bpm: 80, rng: createRng(7) });
    expect(a).toEqual(b);
  });

  it('always audibly changes: no step restates the tempo in force', () => {
    for (let seed = 0; seed < 20; seed++) {
      const events = planTempoSteps({ starts, bpm: 80, rng: createRng(seed) });
      let inForce = 80;
      for (const event of events) {
        if (event.kind !== 'tempo') continue;
        expect(event.bpm).not.toBe(inForce);
        inForce = event.bpm;
      }
    }
  });

  it('stays inside the range the settings enforce, in whole bpm', () => {
    for (const bpm of [TEMPO_RANGE.min, 80, 173, TEMPO_RANGE.max]) {
      const events = planTempoSteps({ starts, bpm, rng: createRng(3) });
      for (const event of events) {
        if (event.kind !== 'tempo') continue;
        expect(event.bpm).toBeGreaterThanOrEqual(TEMPO_RANGE.min);
        expect(event.bpm).toBeLessThanOrEqual(TEMPO_RANGE.max);
        expect(Number.isInteger(event.bpm)).toBe(true);
      }
    }
  });

  it('writes no mark where clamping makes a join change nothing', () => {
    // At the ceiling both quicker factors clamp to the ceiling itself, so a
    // draw of one is a join that cannot change — skipped, not restated.
    const events = planTempoSteps({
      starts: [0, 32, 64, 96, 128, 160],
      bpm: TEMPO_RANGE.max,
      rng: createRng(5),
    });
    let inForce: number = TEMPO_RANGE.max;
    for (const event of events) {
      if (event.kind !== 'tempo') continue;
      expect(event.bpm).not.toBe(inForce);
      inForce = event.bpm;
    }
  });

  it('gives material with no interior boundary no steps at all', () => {
    expect(planTempoSteps({ starts: [0], bpm: 80, rng: createRng(1) })).toEqual([]);
    expect(planTempoSteps({ starts: [], bpm: 80, rng: createRng(1) })).toEqual([]);
  });
});
