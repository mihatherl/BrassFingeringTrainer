import { describe, expect, it } from 'vitest';
import type { Duration } from '../domain/rhythm';
import type { Exercise, NoteEvent } from '../exercise/types';
import { engraveSpacing } from './spacing';

/**
 * Engraved spacing.
 *
 * Tested against exercises written by hand rather than generated, because the
 * whole point of the rule is what it does to *contrasting* material — a bar of
 * semiquavers beside a bar holding one semibreve — and no generator produces
 * that on demand.
 */

const HEAD = 10;
const MIN = HEAD * 1.15;

function duration(value: Duration['value']): Duration {
  return { value, dotted: false };
}

/** An exercise built from a list of bars, each a list of note durations. */
function exerciseOf(bars: Array<Array<Duration['value']>>, beatsPerBar = 4): Exercise {
  const lengths: Record<string, number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    sixteenth: 0.25,
  };

  const notes: NoteEvent[] = [];
  let beat = 0;
  bars.forEach((bar) => {
    for (const value of bar) {
      notes.push({
        writtenMidi: 67,
        soundingMidi: 46,
        startBeat: beat,
        duration: duration(value),
        acceptedMasks: [0],
        primaryMask: 0,
        beamGroup: -1,
        showAccidental: false,
      });
      beat += lengths[value];
    }
  });

  return {
    notes,
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    fifths: -3,
    beatsPerBar,
    beatUnit: 4,
    totalBeats: bars.length * beatsPerBar,
    seed: 1,
    kind: 'random',
  };
}

function barWidths(exercise: Exercise, maxBarWidth?: number): number[] {
  const spacing = engraveSpacing(exercise, { minColumnWidth: MIN, maxBarWidth });
  const widths: number[] = [];
  for (let bar = 0; bar * exercise.beatsPerBar < exercise.totalBeats; bar++) {
    widths.push(
      spacing.xOf((bar + 1) * exercise.beatsPerBar) - spacing.xOf(bar * exercise.beatsPerBar),
    );
  }
  return widths;
}

describe('engraved spacing', () => {
  it('gives a busy bar most of the line and a held note very little', () => {
    // The behaviour the whole thing exists for.
    const [semibreve, semiquavers] = barWidths(
      exerciseOf([['whole'], new Array(16).fill('sixteenth')]),
    );

    expect(semiquavers).toBeGreaterThan(semibreve * 3);
  });

  it('packs the shortest note in the exercise as tightly as it may go', () => {
    // The unit is anchored there: nothing is given less, and nothing longer is
    // given less than its share.
    const spacing = engraveSpacing(exerciseOf([new Array(16).fill('sixteenth')]), {
      minColumnWidth: MIN,
    });

    expect(spacing.xOf(0.25) - spacing.xOf(0)).toBeCloseTo(MIN, 6);
  });

  it('spreads a slow exercise no wider than a fast one packs its shortest note', () => {
    // An exercise of crotchets packs crotchets to the floor; one containing
    // semiquavers does not, because there a crotchet really is the long note.
    const crotchetsOnly = engraveSpacing(exerciseOf([new Array(4).fill('quarter')]), {
      minColumnWidth: MIN,
    });
    const mixed = engraveSpacing(
      exerciseOf([new Array(4).fill('quarter'), new Array(16).fill('sixteenth')]),
      { minColumnWidth: MIN },
    );

    expect(crotchetsOnly.xOf(1) - crotchetsOnly.xOf(0)).toBeCloseTo(MIN, 6);
    // A crotchet is two halvings above a semiquaver, so 1 / 0.75² as wide.
    expect(mixed.xOf(1) - mixed.xOf(0)).toBeCloseTo(MIN / 0.75 ** 2, 6);
  });

  it('grows sub-linearly: four times the duration is under twice the room', () => {
    // Proportional width would make a page of held notes almost entirely blank.
    const spacing = engraveSpacing(
      exerciseOf([['quarter', 'quarter', 'quarter', 'quarter'], ['whole']]),
      { minColumnWidth: MIN },
    );

    const crotchet = spacing.xOf(1) - spacing.xOf(0);
    const semibreve = spacing.xOf(8) - spacing.xOf(4);

    expect(semibreve).toBeGreaterThan(crotchet * 1.5);
    expect(semibreve).toBeLessThan(crotchet * 2);
  });

  it('scales the whole exercise down together when a bar will not fit', () => {
    // Squeezing only the offending bar would make the spacing lie about which
    // notes are quick.
    const exercise = exerciseOf([['whole'], new Array(16).fill('sixteenth')]);
    const free = barWidths(exercise);
    const squeezed = barWidths(exercise, Math.max(...free) / 2);

    expect(Math.max(...squeezed)).toBeCloseTo(Math.max(...free) / 2, 6);
    expect(squeezed[0] / squeezed[1]).toBeCloseTo(free[0] / free[1], 6);
  });

  it('maps beats to pixels and back again', () => {
    const spacing = engraveSpacing(
      exerciseOf([['quarter', 'eighth', 'eighth', 'half'], new Array(8).fill('eighth')]),
      { minColumnWidth: MIN },
    );

    for (const beat of [0, 0.5, 1, 2.75, 4, 6.25, 8]) {
      expect(spacing.beatAt(spacing.xOf(beat)), `beat ${beat}`).toBeCloseTo(beat, 6);
    }
  });

  it('runs on past both ends, for the count-in and the final bar line', () => {
    const spacing = engraveSpacing(exerciseOf([['quarter', 'quarter', 'quarter', 'quarter']]), {
      minColumnWidth: MIN,
    });

    expect(spacing.xOf(-2)).toBeLessThan(0);
    expect(spacing.xOf(6)).toBeGreaterThan(spacing.width);
  });

  it('always fits at least one bar, however little room there is', () => {
    // A page holding nothing would be worse than one holding a bar that spills.
    const exercise = exerciseOf([new Array(16).fill('sixteenth')]);
    const spacing = engraveSpacing(exercise, { minColumnWidth: MIN });

    expect(spacing.barsFitting(0, 1)).toBe(1);
  });

  it('fits more bars where the music is thinner', () => {
    const exercise = exerciseOf([
      new Array(16).fill('sixteenth'),
      ['whole'],
      ['whole'],
      ['whole'],
    ]);
    const spacing = engraveSpacing(exercise, { minColumnWidth: MIN });
    const room = spacing.width / 2;

    expect(spacing.barsFitting(1, room)).toBeGreaterThan(spacing.barsFitting(0, room));
  });
});
