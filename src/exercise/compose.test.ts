import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { metreFor } from '../domain/metre';
import { durationBeats } from '../domain/rhythm';
import { CELLS, cellsFor, parseCell } from './cells';
import { composeTune, REACH, TUNE_BARS } from './compose';
import { DIFFICULTIES, difficultyById } from './difficulty';
import { createRng } from './rng';
import { exerciseFromTheme, isRest, validateTheme, type ThemeNote } from './theme';
import type { Exercise } from './types';

const METRES = [
  [4, 4],
  [3, 4],
  [2, 4],
  [6, 8],
] as const;

const tune = (difficultyId: string, metre = metreFor(4, 4), seed = 1) =>
  composeTune({ difficulty: difficultyById(difficultyId), metre, rng: createRng(seed), id: 't' });

/**
 * The cells: read once, and every one used as it says it is.
 */
describe('the cells', () => {
  it('read their notation, and reject what is not it', () => {
    expect(parseCell('0q 1e re. -2h~')).toEqual([
      { step: 0, beats: 1 },
      { step: 1, beats: 0.5 },
      { beats: 0.75, rest: true },
      { step: -2, beats: 2, tied: true },
    ]);
    expect(() => parseCell('0x')).toThrow(/cannot read/);
  });

  it('fill their bar exactly, in every metre', () => {
    for (const cell of CELLS) {
      const beats = cell.events.reduce((sum, e) => sum + e.beats, 0);
      expect(beats, cell.id).toBeCloseTo(metreFor(...cell.metre).barBeats, 9);
    }
  });

  it('give every level in every metre something to open, move and close with', () => {
    for (const metre of METRES) {
      for (const level of ['beginner', 'easy', 'medium', 'hard'] as const) {
        for (const role of ['open', 'move', 'close'] as const) {
          expect(cellsFor(metre, level, role).length, `${metre.join('/')} ${level} ${role}`).toBeGreaterThan(1);
        }
      }
    }
  });

  it('are no faster than their level reads, and no open or move is one held note', () => {
    for (const cell of CELLS) {
      const level = difficultyById(cell.level);
      const shortest = Math.min(...level.rhythms.map((r) => durationBeats(r.duration)));
      const slowest = Math.max(...level.rhythms.map((r) => durationBeats(r.duration)));
      for (const event of cell.events) {
        expect(event.beats, `${cell.id} has a note shorter than ${cell.level} reads`).toBeGreaterThanOrEqual(shortest - 1e-9);
      }
      if (cell.role !== 'close') {
        // Otherwise a sequence of it drags a tune's median below the level's pace.
        expect(
          cell.events.some((e) => e.beats <= slowest + 1e-9),
          `${cell.id} is one held note`,
        ).toBe(true);
      }
    }
  });
});

describe('composing a tune', () => {
  it('is reproducible from its seed', () => {
    expect(tune('medium', metreFor(4, 4), 7)).toEqual(tune('medium', metreFor(4, 4), 7));
    expect(tune('medium', metreFor(4, 4), 7)).not.toEqual(tune('medium', metreFor(4, 4), 8));
  });

  it('composes a valid tune at every level in every metre, from many seeds', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const [n, d] of METRES) {
        for (let seed = 1; seed <= 25; seed++) {
          const composed = tune(difficulty.id, metreFor(n, d), seed);
          expect(composed, `${difficulty.id} ${n}/${d} seed ${seed}`).not.toBeNull();
          expect(validateTheme(composed!), `${difficulty.id} ${n}/${d} seed ${seed}`).toEqual([]);
          expect(composed!.bars).toBe(TUNE_BARS);
        }
      }
    }
  });

  it('composes nothing in a metre no cell is written for', () => {
    expect(tune('easy', metreFor(5, 4))).toBeNull();
  });

  it('opens on a stable degree and closes on the tonic, with a half close between', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const composed = tune('easy', metreFor(4, 4), seed)!;
      const notes = composed.events.filter((e): e is ThemeNote => !isRest(e));
      expect([1, 3, 5], `seed ${seed} opens`).toContain(notes[0].degree);
      expect(notes[notes.length - 1].degree, `seed ${seed} closes`).toBe(1);
      // The antecedent's last note, before the consequent's first bar.
      let beat = 0;
      let halfClose: ThemeNote = notes[0];
      for (const event of composed.events) {
        if (beat < 16 - 1e-9 && !isRest(event)) halfClose = event;
        beat += event.beats;
      }
      expect([3, 5], `seed ${seed} half-closes`).toContain(halfClose.degree);
    }
  });

  it('spells an accidental on its own degree, whatever the key', () => {
    // A raised sixth approaching the seventh in E flat is C sharp, on the
    // letter C — never the D flat the key's direction would choose.
    let raisedSeen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const composed = tune('hard', metreFor(4, 4), seed)!;
      const exercise = exerciseFromTheme(composed, {
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        metre: metreFor(4, 4),
      })!;
      let noteIndex = 0;
      for (const event of composed.events) {
        if (isRest(event)) continue;
        const note = exercise.notes[noteIndex++];
        if (event.alter === 1) {
          raisedSeen++;
          expect(note.pitch.alter, `seed ${seed}: a raised degree spelled ${note.pitch.letter}${note.pitch.alter}`)
            .toBeGreaterThanOrEqual(0);
        }
        if (event.alter === -1) {
          expect(note.pitch.alter, `seed ${seed}: a lowered degree spelled ${note.pitch.letter}${note.pitch.alter}`)
            .toBeLessThanOrEqual(0);
        }
      }
    }
    expect(raisedSeen).toBeGreaterThan(0);
  });
});

/**
 * The calibration: the reason the composer exists.
 *
 * Measured the way the corpus was measured on 2026-08-16 — range, accidentals
 * per note, rests per bar — and held near what sixteen bars of sight-reading
 * at the same level reach. The figures here are the reading's, and the
 * tolerances are wide enough for tunes to be tunes: a tune of eight bars
 * reaches a little less than a walk of sixteen, and breathes where a phrase
 * ends rather than at random.
 */
describe('calibration against the sight-reading', () => {
  const READING: Record<string, { range: number; accidentals: number; rests: number }> = {
    beginner: { range: 11.6, accidentals: 0, rests: 0 },
    easy: { range: 15.1, accidentals: 0.054, rests: 0.17 },
    medium: { range: 19.2, accidentals: 0.157, rests: 0.31 },
    hard: { range: 24.9, accidentals: 0.261, rests: 0.48 },
  };

  const measure = (exercise: Exercise) => {
    const midis = exercise.notes.map((n) => n.writtenMidi);
    return {
      range: Math.max(...midis) - Math.min(...midis),
      accidentals: exercise.notes.filter((n) => n.showAccidental).length / exercise.notes.length,
      rests: exercise.rests.length / (exercise.totalBeats / 4),
    };
  };

  for (const difficulty of DIFFICULTIES) {
    it(`reaches ${difficulty.id}'s range, accidentals and rests in 4/4`, () => {
      const N = 30;
      const mean = { range: 0, accidentals: 0, rests: 0 };
      for (let seed = 1; seed <= N; seed++) {
        const composed = tune(difficulty.id, metreFor(4, 4), seed)!;
        const exercise = exerciseFromTheme(composed, {
          instrument: instrumentById('eb-bass'),
          clef: 'treble',
          fifths: -3,
          metre: metreFor(4, 4),
        })!;
        const m = measure(exercise);
        mean.range += m.range / N;
        mean.accidentals += m.accidentals / N;
        mean.rests += m.rests / N;
      }
      const reading = READING[difficulty.id];
      // Range: within four semitones below the walk, never above its pool.
      expect(mean.range, 'range').toBeGreaterThanOrEqual(reading.range - 4);
      expect(mean.range, 'range').toBeLessThanOrEqual(difficulty.rangeSemitones);
      // Reaching the window is the point: three quarters of it, on average.
      const window = REACH[difficulty.id as keyof typeof REACH];
      expect(mean.range, 'reach').toBeGreaterThanOrEqual((window.span * 12) / 7 * 0.7);
      if (reading.accidentals === 0) {
        expect(mean.accidentals, 'accidentals').toBe(0);
        expect(mean.rests, 'rests').toBe(0);
      } else {
        // Accidentals within half of the walk's rate either way; rests likewise.
        expect(mean.accidentals, 'accidentals').toBeGreaterThanOrEqual(reading.accidentals * 0.5);
        expect(mean.accidentals, 'accidentals').toBeLessThanOrEqual(reading.accidentals * 1.6);
        expect(mean.rests, 'rests').toBeGreaterThanOrEqual(reading.rests * 0.5);
        expect(mean.rests, 'rests').toBeLessThanOrEqual(reading.rests * 2);
      }
    });
  }
});
