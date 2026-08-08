import { metreFor } from '../domain/metre';
import { describe, expect, it } from 'vitest';
import type { Duration } from '../domain/rhythm';
import { spellInKey } from '../domain/keys';
import type { Exercise, NoteEvent } from '../exercise/types';
import { engraveSpacing } from './spacing';
import { justifiedX } from './system';

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
        pitch: spellInKey(67, 0),
        soundingMidi: 46,
        startBeat: beat,
        duration: duration(value),
        acceptedMasks: [0],
        primaryMask: 0,
        beamGroup: -1,
        tiedToNext: false,
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
    keys: [{ fromBeat: 0, fifths: -3 }],
    metre: metreFor(beatsPerBar, 4),
    totalBeats: bars.length * beatsPerBar,
    seed: 1,
    kind: 'random',
  };
}

/** Narrowest gap between consecutive columns, which is where a collision shows. */
function narrowestGap(exercise: Exercise, options: Parameters<typeof engraveSpacing>[1]): number {
  const spacing = engraveSpacing(exercise, options);
  const beats = [...new Set(exercise.notes.map((n) => n.startBeat))].sort((a, b) => a - b);
  let narrowest = Infinity;
  for (let i = 1; i < beats.length; i++) {
    narrowest = Math.min(narrowest, spacing.xOf(beats[i]) - spacing.xOf(beats[i - 1]));
  }
  return narrowest;
}

function barWidths(
  exercise: Exercise,
  options: Parameters<typeof engraveSpacing>[1] = { minColumnWidth: MIN },
): number[] {
  const spacing = engraveSpacing(exercise, options);
  const widths: number[] = [];
  for (let bar = 0; bar * exercise.metre.barBeats < exercise.totalBeats; bar++) {
    widths.push(
      spacing.xOf((bar + 1) * exercise.metre.barBeats) - spacing.xOf(bar * exercise.metre.barBeats),
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

  it('leaves room in front of a note for its accidental', () => {
    // An accidental is drawn to the *left* of the note it alters, so it lives
    // in the gap before it. Counted as part of the note instead, a sharp simply
    // lands on top of whatever precedes it.
    const exercise = exerciseOf([['quarter', 'quarter', 'quarter', 'quarter']]);
    const sharp = 12;

    expect(narrowestGap(exercise, { minColumnWidth: MIN })).toBeCloseTo(MIN, 6);
    expect(
      narrowestGap(exercise, {
        minColumnWidth: MIN,
        extraWidthFor: () => ({ before: sharp, after: 0 }),
      }),
    ).toBeCloseTo(MIN + sharp, 6);
  });

  it('leaves room behind a dotted note for its dot', () => {
    const exercise = exerciseOf([['quarter', 'quarter', 'quarter', 'quarter']]);
    const dot = 6;

    expect(
      narrowestGap(exercise, {
        minColumnWidth: MIN,
        extraWidthFor: () => ({ before: 0, after: dot }),
      }),
    ).toBeCloseTo(MIN + dot, 6);
  });

  it('leaves room before a bar line for the note that precedes it', () => {
    // A bar line is drawn set back from its column into the gap the previous
    // note was given (see BAR_LINE_SETBACK in system.ts), so that gap has to be
    // wider than a note's ordinary clearance or the two collide. A bar of
    // semiquavers packs its columns to the floor, which is exactly where the
    // collision would show first.
    const exercise = exerciseOf([new Array(16).fill('sixteenth'), ['whole']]);
    const barLineRoom = 15;

    const plain = engraveSpacing(exercise, { minColumnWidth: MIN });
    const withBarLineRoom = engraveSpacing(exercise, { minColumnWidth: MIN, barLineRoom });

    // The bar line sits at beat 4, the last semiquaver at beat 3.75.
    expect(plain.xOf(4) - plain.xOf(3.75)).toBeCloseTo(MIN, 6);
    expect(withBarLineRoom.xOf(4) - withBarLineRoom.xOf(3.75)).toBeCloseTo(MIN + barLineRoom, 6);
  });

  it('does not spend bar-line room between two ordinary notes', () => {
    const exercise = exerciseOf([new Array(16).fill('sixteenth'), ['whole']]);
    const spacing = engraveSpacing(exercise, { minColumnWidth: MIN, barLineRoom: 15 });

    expect(spacing.xOf(0.25) - spacing.xOf(0)).toBeCloseTo(MIN, 6);
  });

  it('gives up elastic room before it gives up glyph room', () => {
    // A bar too wide for its line has to lose something. What the duration asks
    // for can go; what the glyphs physically occupy cannot, or the notes touch.
    //
    // The busy bar is deliberately mixed rather than solid semiquavers: a bar
    // made entirely of the shortest note is already at its floor everywhere and
    // has nothing elastic left to give.
    const exercise = exerciseOf([
      ['quarter', 'quarter', 'eighth', 'eighth', 'sixteenth', 'sixteenth', 'sixteenth', 'sixteenth'],
      ['quarter', 'quarter', 'quarter', 'quarter'],
    ]);
    // Small enough that the bar can still be made to fit around it.
    const sharp = 2;
    const roomy = { minColumnWidth: MIN, extraWidthFor: () => ({ before: sharp, after: 0 }) };
    const limit = Math.max(...barWidths(exercise, roomy)) * 0.9;
    const squeezed = { ...roomy, maxBarWidth: limit };

    expect(Math.max(...barWidths(exercise, squeezed))).toBeLessThanOrEqual(limit + 1e-6);
    // The room the noteheads and accidentals need survived it.
    expect(narrowestGap(exercise, squeezed)).toBeGreaterThanOrEqual(MIN + sharp - 1e-6);
  });

  it('crams only when the glyphs alone will not fit', () => {
    // Four noteheads will not go into two noteheads' room whatever is done, and
    // a cramped bar can at least be read slowly — one running off the side of
    // the screen cannot be read at all.
    const exercise = exerciseOf([['quarter', 'quarter', 'quarter', 'quarter']]);
    const gap = narrowestGap(exercise, { minColumnWidth: MIN, maxBarWidth: MIN * 2 });

    expect(gap).toBeLessThan(MIN);
    expect(gap).toBeGreaterThan(0);
  });

  it('stretches a line to its margin, keeping the proportions', () => {
    // Justification adds air evenly, so a busy bar stays wider than a sparse
    // one — it does not level them out.
    const exercise = exerciseOf([['whole'], ['quarter', 'quarter', 'quarter', 'quarter']]);
    const spacing = engraveSpacing(exercise, { minColumnWidth: MIN });
    const natural = spacing.xOf(8) - spacing.xOf(0);
    const margin = 40;

    const ragged = justifiedX(spacing, 0, 8, margin, natural * 1.5, false);
    const justified = justifiedX(spacing, 0, 8, margin, natural * 1.5, true);

    expect(ragged(8) - margin).toBeCloseTo(natural, 6);
    expect(justified(8) - margin).toBeCloseTo(natural * 1.5, 6);

    const ratio = (x: (beat: number) => number) => (x(4) - x(0)) / (x(8) - x(4));
    expect(ratio(justified)).toBeCloseTo(ratio(ragged), 6);
  });

  it('never squeezes a line to justify it', () => {
    // Deciding what fits is the spacing rule's job and it has already had its
    // say; justification only ever adds room.
    const exercise = exerciseOf([['quarter', 'quarter', 'quarter', 'quarter']]);
    const spacing = engraveSpacing(exercise, { minColumnWidth: MIN });
    const natural = spacing.xOf(4) - spacing.xOf(0);

    const cramped = justifiedX(spacing, 0, 4, 0, natural / 2, true);
    expect(cramped(4)).toBeCloseTo(natural, 6);
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
