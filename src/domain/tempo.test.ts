import { describe, expect, it } from 'vitest';
import {
  beatAt,
  compileTempo,
  rampRatioAt,
  steppedTempoAt,
  tempoAt,
  timeAt,
  type TempoEvent,
} from './tempo';

/**
 * The clock is the one place a bug desynchronises sound from notation — the
 * fault a rhythm trainer cannot have — so the map is held to properties, not
 * examples: the closed forms against numerical integration, the inverse
 * against the forward map, and additivity across every kind of boundary.
 */

/** Riemann midpoint integral of 60/bpm across [from, to], for checking. */
function integrated(bpmAtBeat: (b: number) => number, from: number, to: number): number {
  const steps = 20000;
  const width = (to - from) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += (60 / bpmAtBeat(from + (i + 0.5) * width)) * width;
  return sum;
}

describe('a constant tempo', () => {
  const map = compileTempo(120);

  it('is the multiplication it always was, both ways', () => {
    expect(timeAt(map, 2)).toBeCloseTo(1, 12);
    expect(timeAt(map, 0)).toBe(0);
    expect(beatAt(map, 1)).toBeCloseTo(2, 12);
  });

  it('is total over the count-in', () => {
    expect(timeAt(map, -4)).toBeCloseTo(-2, 12);
    expect(beatAt(map, -2)).toBeCloseTo(-4, 12);
  });

  it('is in force everywhere', () => {
    expect(tempoAt(map, -4)).toBe(120);
    expect(tempoAt(map, 100)).toBe(120);
  });
});

describe('a step change', () => {
  const map = compileTempo(120, [{ kind: 'tempo', atBeat: 4, bpm: 60 }]);

  it('splits time piecewise at the boundary', () => {
    expect(timeAt(map, 4)).toBeCloseTo(2, 12);
    expect(timeAt(map, 6)).toBeCloseTo(4, 12);
    expect(beatAt(map, 3)).toBeCloseTo(5, 12);
  });

  it('adds up across the boundary', () => {
    const between = (a: number, b: number) => timeAt(map, b) - timeAt(map, a);
    expect(between(0, 6)).toBeCloseTo(between(0, 3) + between(3, 6), 12);
  });

  it('takes force on the boundary itself, like keyAt', () => {
    expect(tempoAt(map, 4 - 1e-6)).toBeCloseTo(120, 3);
    expect(tempoAt(map, 4)).toBe(60);
  });

  it('leaves the count-in at the opening tempo', () => {
    expect(timeAt(map, -4)).toBeCloseTo(-2, 12);
  });
});

describe('a ramp', () => {
  const map = compileTempo(120, [{ kind: 'ramp', fromBeat: 4, toBeat: 8, toBpm: 60 }]);
  const bpmAtBeat = (b: number) => 120 + ((60 - 120) / 4) * (b - 4);

  it('matches the integral it claims to be in closed form', () => {
    const closed = timeAt(map, 8) - timeAt(map, 4);
    expect(closed).toBeCloseTo(integrated(bpmAtBeat, 4, 8), 6);
    // And part-way through, not only across the whole span.
    expect(timeAt(map, 5.3) - timeAt(map, 4)).toBeCloseTo(integrated(bpmAtBeat, 4, 5.3), 6);
  });

  it('inverts exactly, which the render loop leans on sixty times a second', () => {
    for (const beat of [-3, 0, 2, 4, 4.7, 6, 7.999, 8, 11]) {
      expect(beatAt(map, timeAt(map, beat))).toBeCloseTo(beat, 9);
    }
  });

  it('arrives, and the arrival tempo stays in force', () => {
    expect(tempoAt(map, 6)).toBeCloseTo(90, 9);
    expect(tempoAt(map, 8)).toBe(60);
    expect(tempoAt(map, 20)).toBe(60);
    expect(timeAt(map, 9) - timeAt(map, 8)).toBeCloseTo(1, 12);
  });

  it('degenerates continuously as the slope vanishes', () => {
    const flat = compileTempo(120, [{ kind: 'ramp', fromBeat: 4, toBeat: 8, toBpm: 120 }]);
    const nearly = compileTempo(120, [
      { kind: 'ramp', fromBeat: 4, toBeat: 8, toBpm: 120 + 1e-7 },
    ]);
    expect(timeAt(flat, 8)).toBeCloseTo(4, 12);
    expect(timeAt(nearly, 8)).toBeCloseTo(4, 8);
  });
});

describe('a hold', () => {
  const map = compileTempo(120, [{ kind: 'hold', atBeat: 8, seconds: 2 }]);

  it('sits between the beats: the far side answers after the dwell', () => {
    expect(timeAt(map, 8 - 1e-9)).toBeCloseTo(4, 6);
    // The re-entry note on the boundary sounds at the release, not the arrival.
    expect(timeAt(map, 8)).toBeCloseTo(6, 12);
    expect(timeAt(map, 9)).toBeCloseTo(6.5, 12);
  });

  it('plateaus the inverse, which is the display honestly standing still', () => {
    expect(beatAt(map, 4)).toBe(8);
    expect(beatAt(map, 5)).toBe(8);
    expect(beatAt(map, 6 - 1e-9)).toBe(8);
    expect(beatAt(map, 6)).toBeCloseTo(8, 12);
    expect(beatAt(map, 6.5)).toBeCloseTo(9, 12);
  });

  it('is spanned by secondsBetween, so a held note sounds through it', () => {
    expect(timeAt(map, 9) - timeAt(map, 7)).toBeCloseTo(0.5 + 2 + 0.5, 12);
  });

  it('still inverts on either side', () => {
    for (const beat of [-2, 0, 7.9, 8, 8.1, 12]) {
      expect(beatAt(map, timeAt(map, beat))).toBeCloseTo(beat, 9);
    }
  });

  it('tolerates a zero-length dwell', () => {
    const zero = compileTempo(120, [{ kind: 'hold', atBeat: 8, seconds: 0 }]);
    expect(timeAt(zero, 8)).toBeCloseTo(4, 12);
    expect(beatAt(zero, 4)).toBeCloseTo(8, 12);
  });
});

describe('the band cliché: rit into a fermata into the new tempo', () => {
  // Broaden through the last bar, hold, then off again quicker — the join
  // every test piece has, and the reason event order at one beat is a rule.
  const events: TempoEvent[] = [
    { kind: 'ramp', fromBeat: 8, toBeat: 12, toBpm: 84 },
    { kind: 'hold', atBeat: 12, seconds: 2 },
    { kind: 'tempo', atBeat: 12, bpm: 96 },
  ];
  const map = compileTempo(120, events);

  it('runs the hold in the old tempo and re-enters in the new', () => {
    expect(tempoAt(map, 12 - 1e-6)).toBeCloseTo(84, 2);
    expect(tempoAt(map, 12)).toBe(96);
  });

  it('accounts for every second, in order', () => {
    const rit = integrated((b) => 120 + ((84 - 120) / 4) * (b - 8), 8, 12);
    expect(timeAt(map, 12)).toBeCloseTo(4 + rit + 2, 6);
    expect(timeAt(map, 13) - timeAt(map, 12)).toBeCloseTo(60 / 96, 12);
  });

  it('holds the display at the join for the whole dwell', () => {
    const arrival = timeAt(map, 12) - 2;
    expect(beatAt(map, arrival + 0.001)).toBe(12);
    expect(beatAt(map, arrival + 1.999)).toBe(12);
  });

  it('survives the events arriving in any order', () => {
    const shuffled = compileTempo(120, [events[2], events[0], events[1]]);
    expect(timeAt(shuffled, 13)).toBeCloseTo(timeAt(map, 13), 12);
  });
});

describe('the ramp ratio, which is what the orb reads', () => {
  const map = compileTempo(120, [
    { kind: 'tempo', atBeat: 4, bpm: 96 },
    { kind: 'ramp', fromBeat: 8, toBeat: 12, toBpm: 72 },
  ]);

  it('is 1 wherever no ramp is running, whatever steps have done', () => {
    expect(rampRatioAt(map, -4)).toBe(1);
    expect(rampRatioAt(map, 2)).toBe(1);
    // After the step the tempo is different and the ratio still 1: a settled
    // tempo has no energy coming out of it.
    expect(rampRatioAt(map, 6)).toBe(1);
  });

  it('slides through the ramp and settles at 1 on arrival', () => {
    expect(rampRatioAt(map, 8)).toBeCloseTo(1, 12);
    expect(rampRatioAt(map, 10)).toBeCloseTo(84 / 96, 12);
    expect(rampRatioAt(map, 12 - 1e-9)).toBeCloseTo(72 / 96, 6);
    expect(rampRatioAt(map, 12)).toBe(1);
    expect(rampRatioAt(map, 20)).toBe(1);
  });
});

describe('a beat that is not a crotchet', () => {
  /*
   * The compound case. A tempo names the beat that is conducted — a dotted
   * crotchet in 6/8 — while every beat the map is *asked* about is a crotchet,
   * because that is what note lengths are written in. `crotchetsPerBeat` is
   * the whole of the difference between the two.
   */
  const DOTTED = 1.5;

  it('makes the setting mean the beat the player counts', () => {
    const map = compileTempo(80, [], DOTTED);
    // Eighty dotted crotchets a minute is one every 0.75s, and a bar of 6/8
    // is two of them.
    expect(timeAt(map, DOTTED)).toBeCloseTo(0.75, 12);
    expect(timeAt(map, 3)).toBeCloseTo(1.5, 12);
  });

  it('leaves simple time exactly where it was', () => {
    // The default is 1, so every existing caller compiles the same map it did
    // before the parameter existed.
    expect(timeAt(compileTempo(80, []), 4)).toBe(timeAt(compileTempo(80, [], 1), 4));
  });

  it('carries the beat into every event, not just the nominal', () => {
    // A step written as 120 means 120 of the conducted beat too. Compiled
    // against a plain crotchet it would run half again too slow from there on,
    // which is the failure that would have survived converting only the
    // nominal tempo.
    const events: TempoEvent[] = [{ kind: 'tempo', atBeat: 3, bpm: 120 }];
    const map = compileTempo(80, events, DOTTED);
    const afterStep = timeAt(map, 3 + DOTTED) - timeAt(map, 3);
    expect(afterStep).toBeCloseTo(0.5, 12);
  });

  it('bends a ramp in the player’s beat as well', () => {
    const events: TempoEvent[] = [{ kind: 'ramp', fromBeat: 3, toBeat: 6, toBpm: 40 }];
    const map = compileTempo(80, events, DOTTED);
    // Half the speed by the end of the rit, so the last beat of it takes
    // longer than the first — measured against the integral, which knows
    // nothing about the unit it was compiled in.
    const bpmAt = (b: number) =>
      b <= 3 ? 120 : b >= 6 ? 60 : 120 + ((b - 3) / 3) * (60 - 120);
    expect(timeAt(map, 6)).toBeCloseTo(integrated(bpmAt, 0, 6), 6);
  });
});

describe('the tempo the music has settled at', () => {
  /*
   * What picks the conductor's pattern, and why it is not `tempoAt`.
   *
   * A step is a genuinely new speed and the hand should change with it; a rit
   * passing through a threshold on its way somewhere should not reorganise the
   * gesture mid-bend and flick back a bar later.
   */
  const events: TempoEvent[] = [
    { kind: 'ramp', fromBeat: 4, toBeat: 8, toBpm: 60 },
    { kind: 'tempo', atBeat: 8, bpm: 190 },
  ];

  it('holds the opening tempo until something is declared', () => {
    expect(steppedTempoAt(120, events, 0)).toBe(120);
    expect(steppedTempoAt(120, events, 3.9)).toBe(120);
    // Including behind the music, where the count-in lives.
    expect(steppedTempoAt(120, events, -4)).toBe(120);
  });

  it('does not move while a rit is bending', () => {
    // Half way through the ramp the clock is somewhere near 90 and falling;
    // the declared speed is still the 120 the music was written at.
    expect(tempoAt(compileTempo(120, events), 6)).toBeLessThan(120);
    expect(steppedTempoAt(120, events, 6)).toBe(120);
  });

  it('takes a step the moment it lands, and keeps it', () => {
    expect(steppedTempoAt(120, events, 8)).toBe(190);
    expect(steppedTempoAt(120, events, 40)).toBe(190);
  });

  it('is unmoved by an exercise that holds its speed', () => {
    expect(steppedTempoAt(96, [], 100)).toBe(96);
  });
});

describe('what the compiler refuses', () => {
  it('an event on or before the music starts', () => {
    expect(() => compileTempo(120, [{ kind: 'tempo', atBeat: 0, bpm: 90 }])).toThrow(/start/);
    expect(() => compileTempo(120, [{ kind: 'hold', atBeat: -2, seconds: 1 }])).toThrow(/start/);
  });

  it('an event inside a ramp', () => {
    expect(() =>
      compileTempo(120, [
        { kind: 'ramp', fromBeat: 4, toBeat: 8, toBpm: 60 },
        { kind: 'tempo', atBeat: 6, bpm: 90 },
      ]),
    ).toThrow(/overlaps/);
  });

  it('tempi that are not tempi', () => {
    expect(() => compileTempo(0)).toThrow(/positive/);
    expect(() => compileTempo(120, [{ kind: 'tempo', atBeat: 4, bpm: -60 }])).toThrow(/positive/);
    expect(() => compileTempo(120, [{ kind: 'ramp', fromBeat: 4, toBeat: 4, toBpm: 60 }])).toThrow(
      /width/,
    );
    expect(() => compileTempo(120, [{ kind: 'hold', atBeat: 4, seconds: -1 }])).toThrow(
      /non-negative/,
    );
  });
});
