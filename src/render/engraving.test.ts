/*
 * The engraving, held to the byte.
 *
 * Every other test here measures one thing about the drawing — a width, a
 * position, a count of glyphs. Three faults in the key-change work got past all
 * of them and were found by looking at the picture instead: stems and ledger
 * lines drawn in mid air below the last stave, a first notehead clipped by the
 * left edge, and cancelling naturals crowding the signature they cancel. None
 * would have been caught by a test written in good faith beforehand, because
 * the spacing tests all measure notes *relative to each other* and so have
 * nothing to say about the margin or about what lies outside the system.
 *
 * So this renders whole exercises through the same code the app draws with, and
 * compares the result byte for byte with a committed SVG. Be clear about what
 * that does and does not buy:
 *
 * It cannot say a drawing is *right*. A snapshot only knows what it was shown
 * first, so all three of those faults would have been recorded as correct had
 * this existed at the time. What it does is stop a fixed thing from quietly
 * un-fixing — which is exactly what happened to the clef in `stave-to-svg`,
 * wrong for four releases while every test passed.
 *
 * Which makes a failure here *a question, not a verdict*. The diff says the
 * engraving moved; whether it moved for the better is decided by opening the
 * file, since these are ordinary SVGs a browser will draw. Look before
 * accepting a change with `vitest -u`, or this becomes a test that only ever
 * records what the code happens to do.
 *
 * The figures are chosen for the cases that have broken or that carry a rule
 * this project has committed to, rather than for coverage.
 */

import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { metreAt, metreFor } from '../domain/metre';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise, type GenerateOptions } from '../exercise/generate';
import { exerciseFromTheme } from '../exercise/theme';
import { themeById } from '../exercise/themes';
import type { Exercise } from '../exercise/types';
import { planReview } from './review';
import { tiedFigure, tripletFigure } from '../../tools/figures.mts';
import { DEFAULT_WIDTH, exerciseToSvg } from '../../tools/render-svg.mts';

/**
 * An Eb bass part in treble clef, which is what this app is mostly read on, at
 * a width that gives several systems so that breaks are exercised too.
 */
function generated(overrides: Partial<GenerateOptions> = {}): Exercise {
  return generateExercise({
    instrument: instrumentById('eb-bass'),
    clef: 'treble',
    fifths: -3,
    difficulty: difficultyById('hard'),
    kind: 'random',
    bars: 8,
    cycles: 2,
    themeCount: 2,
    metre: metreFor(4, 4),
    seed: 1,
    ...overrides,
  });
}

/**
 * This seed is not arbitrary, and swapping it loses most of what the two key
 * figures are for.
 *
 * A change landing on a system break draws nothing but the new signature at the
 * head of the next line, which every line states anyway — so the double bar and
 * the cancelling naturals, the part with arithmetic in it, go unexercised. This
 * seed puts the change in the middle of a system instead, and `keeps its change
 * mid-system` below fails if that ever stops being true.
 */
const KEY_CHANGE_MID_SYSTEM: Partial<GenerateOptions> = { keySet: [-3, -1], bars: 8, seed: 6 };

/**
 * Two themes with the tempo moving at their join, and the end broadening.
 * The join must actually step, and something must actually rit — the closing
 * one always does — and `keeps a step and a rit in the tempo figure` below
 * pins that this stays true if the corpus, the stitching or the plan ever
 * changes under the seed.
 */
const TEMPO_STEP_AT_JOIN: Partial<GenerateOptions> = {
  kind: 'themes',
  themeCount: 2,
  tempo: 80,
  variableTempo: true,
  seed: 3,
};

const FIGURES: ReadonlyArray<{ name: string; why: string; exercise: () => Exercise }> = [
  {
    name: 'free-material',
    why: 'Beams, dotted rhythms, accidentals and ledger lines, over several systems.',
    exercise: () => generated(),
  },
  {
    name: 'ties-both-directions',
    why: 'A tie hangs below a stem-up note and arches above a stem-down one.',
    exercise: tiedFigure,
  },
  {
    name: 'key-change',
    why: 'Double bar, then naturals cancelling the outgoing key, then the new signature.',
    exercise: () => generated(KEY_CHANGE_MID_SYSTEM),
  },
  {
    name: 'key-change-into-c',
    why: 'The case where the naturals are the whole message, and the easiest to miss at speed.',
    exercise: () => generated({ ...KEY_CHANGE_MID_SYSTEM, keySet: [-3, 0] }),
  },
  {
    name: 'scale-cycles',
    why: 'Cycles running straight on into one another, with the tonic held at the end — no gap in the middle of a scale.',
    exercise: () => generated({ kind: 'scales', cycles: 2 }),
  },
  {
    name: 'compound-metre',
    why: '6/8 beamed in two pulses rather than six, per metre.ts.',
    exercise: () => generated({ metre: metreFor(6, 8), bars: 6 }),
  },
  {
    name: 'theme-plain',
    why: 'An authored theme, degrees spelled into the key the player chose.',
    exercise: () =>
      exerciseFromTheme(themeById('plain-answer')!, {
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        metre: metreFor(4, 4),
      })!,
  },
  {
    name: 'theme-modulating',
    why: 'A theme rebuilt on the new tonic at its key change, rather than reprinted under a new signature.',
    exercise: () =>
      exerciseFromTheme(themeById('lift-a-fifth')!, {
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        metre: metreFor(4, 4),
      })!,
  },
  {
    name: 'triplets',
    why: 'Bracket and numeral per three — beamed quaver triplets, two beats running together, and crotchet triplets which are bracketed and never beamed.',
    exercise: tripletFigure,
  },
  {
    name: 'tempo-mark',
    why: 'A metronome mark over the join where the tempo steps, and rit. where the music broadens — the page saying what the clock will do.',
    exercise: () => generated(TEMPO_STEP_AT_JOIN),
  },
  {
    name: 'tempo-mark-compound',
    why: 'The same mark in 6/8, where the beat it names is a dotted crotchet — the number counts those, so the note printed beside it has to be one. A plain crotchet here would misquote the clock by half again.',
    exercise: () => generated({ ...TEMPO_STEP_AT_JOIN, metre: metreFor(6, 8) }),
  },
  {
    name: 'bass-clef',
    why: 'The other clef, and the only figure here that draws an F clef at all.',
    exercise: () =>
      generated({ instrument: instrumentById('euphonium'), clef: 'bass', fifths: 0 }),
  },
];

describe('engraving', () => {
  for (const { name, why, exercise } of FIGURES) {
    it(`draws ${name} as committed — ${why}`, async () => {
      await expect(exerciseToSvg(exercise())).toMatchFileSnapshot(
        `./__snapshots__/engraving/${name}.svg`,
      );
    });
  }

  it('keeps its change mid-system in the key figures', () => {
    for (const keySet of [[-3, -1], [-3, 0]]) {
      const exercise = generated({ ...KEY_CHANGE_MID_SYSTEM, keySet });
      const changes = exercise.keys.slice(1);
      expect(changes.length, `${keySet} changes key at all`).toBeGreaterThan(0);

      const { systemStarts } = planReview(DEFAULT_WIDTH, exercise);
      for (const { fromBeat } of changes) {
        const bar = fromBeat / metreAt(exercise.metres, 0).barBeats;
        expect(systemStarts, `${keySet} change at bar ${bar} is not a line start`).not.toContain(
          bar,
        );
      }
    }
  });

  /*
   * The snapshots are worth nothing if the same exercise can render two ways,
   * and a failure here means the drawing has picked up something that is not
   * the exercise — an unseeded random, a date, an iteration order. Worth its
   * own test rather than being left to show up as an intermittent diff on an
   * unrelated branch.
   */
  it('keeps a step and a rit in the tempo figure', () => {
    const exercise = generated(TEMPO_STEP_AT_JOIN);
    expect(exercise.tempo.filter((e) => e.kind === 'tempo').length).toBeGreaterThan(0);
    expect(exercise.tempo.filter((e) => e.kind === 'ramp').length).toBeGreaterThan(0);
  });

  it('renders the same exercise identically twice', () => {
    for (const { name, exercise } of FIGURES) {
      const once = exerciseToSvg(exercise());
      const twice = exerciseToSvg(exercise());
      expect(twice, name).toBe(once);
    }
  });
});
