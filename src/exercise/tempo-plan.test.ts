import { describe, expect, it } from 'vitest';
import { metreFor } from '../domain/metre';
import { TEMPO_RANGE, type TempoEvent } from '../domain/tempo';
import { createRng } from './rng';
import { planTempo } from './tempo-plan';

const metre = metreFor(4, 4);

function plan(overrides: Partial<Parameters<typeof planTempo>[0]> = {}): TempoEvent[] {
  return planTempo({
    starts: [0, 32, 64, 96],
    totalBeats: 128,
    metre,
    bpm: 80,
    rng: createRng(1),
    ...overrides,
  });
}

/** The tempo in force just before a beat, walked off the events. */
function inForceBefore(events: TempoEvent[], beat: number, opening: number): number {
  let bpm = opening;
  for (const event of events) {
    if (event.kind === 'tempo' && event.atBeat < beat) bpm = event.bpm;
    if (event.kind === 'ramp' && event.toBeat <= beat) bpm = event.toBpm;
  }
  return bpm;
}

describe('the tempo plan', () => {
  it('steps at interior boundaries and never at the opening', () => {
    const steps = plan().filter((e) => e.kind === 'tempo');
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect([32, 64, 96]).toContain('atBeat' in step && step.atBeat);
    }
  });

  it('always ends broadening: a closing rit into the final bar line', () => {
    for (let seed = 0; seed < 10; seed++) {
      const events = plan({ rng: createRng(seed) });
      const last = events[events.length - 1];
      expect(last.kind).toBe('ramp');
      if (last.kind !== 'ramp') continue;
      expect(last.toBeat).toBe(128);
      expect(last.toBeat - last.fromBeat).toBe(2 * metre.barBeats);
      expect(last.toBpm).toBeLessThan(inForceBefore(events, last.fromBeat, 80));
    }
  });

  it('gives boundary-less material its closing rit and nothing else', () => {
    const events = plan({ starts: [0], totalBeats: 32 });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('ramp');
  });

  it('rits into some joins and not others, ending where the join is', () => {
    // Across seeds both behaviours must occur, or the chance is a constant.
    let ritted = 0;
    let plain = 0;
    for (let seed = 0; seed < 30; seed++) {
      const events = plan({ rng: createRng(seed) });
      for (const join of [32, 64, 96]) {
        const rit = events.find((e) => e.kind === 'ramp' && e.toBeat === join);
        if (rit) ritted++;
        else plain++;
        if (rit && rit.kind === 'ramp') {
          expect(rit.fromBeat).toBe(join - 2 * metre.barBeats);
          expect(rit.toBpm).toBeLessThan(inForceBefore(events, rit.fromBeat, 80));
        }
      }
    }
    expect(ritted).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(0);
  });

  it('is the same plan for the same seed, which is what Repeat leans on', () => {
    expect(plan({ rng: createRng(7) })).toEqual(plan({ rng: createRng(7) }));
  });

  it('never writes an event that changes nothing', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const bpm of [TEMPO_RANGE.min, 80, TEMPO_RANGE.max]) {
        const events = plan({ bpm, rng: createRng(seed) });
        for (const event of events) {
          if (event.kind === 'tempo') {
            expect(event.bpm).not.toBe(inForceBefore(events, event.atBeat, bpm));
          }
          if (event.kind === 'ramp') {
            expect(event.toBpm).not.toBe(inForceBefore(events, event.fromBeat, bpm));
          }
        }
      }
    }
  });

  it('stays inside the range the settings enforce, in whole bpm', () => {
    for (const bpm of [TEMPO_RANGE.min, 80, 173, TEMPO_RANGE.max]) {
      for (const event of plan({ bpm, rng: createRng(3) })) {
        const value = event.kind === 'tempo' ? event.bpm : event.kind === 'ramp' ? event.toBpm : 0;
        expect(value).toBeGreaterThanOrEqual(TEMPO_RANGE.min);
        expect(value).toBeLessThanOrEqual(TEMPO_RANGE.max);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it('shortens the rit where the stretch is short, and forgoes it where there is no room', () => {
    // A two-bar stretch takes a one-bar rit.
    const short = planTempo({ starts: [0], totalBeats: 8, metre, bpm: 80, rng: createRng(1) });
    expect(short).toHaveLength(1);
    expect(short[0].kind === 'ramp' && short[0].toBeat - short[0].fromBeat).toBe(metre.barBeats);

    // One bar of music cannot broaden without the rit being the material.
    expect(planTempo({ starts: [0], totalBeats: 4, metre, bpm: 80, rng: createRng(1) })).toEqual(
      [],
    );
  });

  it('keeps every event in beat order with no overlap, ready for the compiler', () => {
    for (let seed = 0; seed < 30; seed++) {
      const events = plan({ rng: createRng(seed) });
      let reached = 0;
      for (const event of events) {
        const from = event.kind === 'ramp' ? event.fromBeat : 'atBeat' in event ? event.atBeat : 0;
        expect(from).toBeGreaterThanOrEqual(reached);
        reached = event.kind === 'ramp' ? event.toBeat : from;
      }
    }
  });
});
