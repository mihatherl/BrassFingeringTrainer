import { beforeAll, describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import type { Verdict } from '../engine/judge';
import { drawReview, planReview } from './review';
import { justifiedX } from './system';
import { LIGHT_THEME } from './surface';

/**
 * The marked exercise on the results screen.
 *
 * Two things matter here and neither is visible from the drawing itself: that
 * the music divides into systems that fit the width — with every bar landing on
 * exactly one of them — and that a fingering is written under the notes that
 * went wrong and nowhere else.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

function mockCanvas(calls: RecordedCall[], width = 600) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const context = {
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };

  return {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0 }),
  } as unknown as HTMLCanvasElement;
}

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 2 };
  (globalThis as { Path2D?: unknown }).Path2D = class {
    d: string | undefined;
    constructor(d?: string) {
      this.d = d;
    }
  };
});

function build(difficultyId: string, bars = 8) {
  return generateExercise({
    instrument: instrumentById('eb-bass'),
    clef: 'treble',
    fifths: -3,
    difficulty: difficultyById(difficultyId),
    kind: 'random',
    bars,
    beatsPerBar: 4,
    beatUnit: 4,
    seed: 7,
  });
}

describe('planning the review', () => {
  it('covers every bar exactly once, in order', () => {
    for (const width of [320, 390, 600, 900, 1400]) {
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard', 'expert']) {
        const exercise = build(difficultyId);
        const plan = planReview(width, exercise);
        const totalBars = Math.ceil(exercise.totalBeats / exercise.beatsPerBar);
        const where = `${width} ${difficultyId}`;

        expect(plan.systemStarts[0], where).toBe(0);
        for (let i = 1; i < plan.systemStarts.length; i++) {
          expect(plan.systemStarts[i], where).toBeGreaterThan(plan.systemStarts[i - 1]);
        }
        expect(plan.systemStarts[plan.systemStarts.length - 1], where).toBeLessThan(totalBars);
        expect(plan.systems, where).toBe(plan.systemStarts.length);
      }
    }
  });

  it('fits more bars to a line on a wider screen', () => {
    const exercise = build('easy');
    const phone = planReview(390, exercise);
    const desktop = planReview(1200, exercise);

    expect(desktop.systems).toBeLessThan(phone.systems);
  });

  it('sets the bars to different widths', () => {
    // Room follows the notes, not the barlines. Even spacing gave every bar the
    // width its busiest one needed; the rule itself is tested in spacing.test.
    const exercise = build('expert', 16);
    const { spacing } = planReview(900, exercise);
    const { beatsPerBar } = exercise;
    const totalBars = Math.ceil(exercise.totalBeats / beatsPerBar);

    const widths: number[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      widths.push(spacing.xOf((bar + 1) * beatsPerBar) - spacing.xOf(bar * beatsPerBar));
    }

    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 1.1);
  });

  it('justifies every line to the margin except the last', () => {
    // Engraved music does not leave a quarter of a line blank because the next
    // bar would not quite fit; the bars that did fit are stretched to fill it.
    const exercise = build('easy', 16);
    const plan = planReview(600, exercise);
    const totalBars = Math.ceil(exercise.totalBeats / exercise.beatsPerBar);
    expect(plan.systems).toBeGreaterThan(1);

    plan.systemStarts.forEach((start, i) => {
      const end = plan.systemStarts[i + 1] ?? totalBars;
      const final = end >= totalBars;
      const x = justifiedX(
        plan.spacing,
        start * exercise.beatsPerBar,
        Math.min(exercise.totalBeats, end * exercise.beatsPerBar),
        plan.headerWidth,
        plan.usableWidth,
        !final,
      );
      const used = x(Math.min(exercise.totalBeats, end * exercise.beatsPerBar)) - plan.headerWidth;

      if (final) {
        // Left ragged: stretching a couple of remaining bars across a full line
        // would imply a breadth that is not there.
        expect(used, `system ${i}`).toBeLessThanOrEqual(plan.usableWidth + 1e-6);
      } else {
        expect(used, `system ${i}`).toBeCloseTo(plan.usableWidth, 6);
      }
    });
  });

  it('never lets a bar overflow the line it is on', () => {
    for (const width of [320, 600, 1200]) {
      for (const difficultyId of ['easy', 'hard', 'expert']) {
        const exercise = build(difficultyId);
        const plan = planReview(width, exercise);
        const usable = width - plan.headerWidth - plan.staveSpace * 2;
        const totalBars = Math.ceil(exercise.totalBeats / exercise.beatsPerBar);

        plan.systemStarts.forEach((start, i) => {
          const end = plan.systemStarts[i + 1] ?? totalBars;
          const used =
            plan.spacing.xOf(end * exercise.beatsPerBar) -
            plan.spacing.xOf(start * exercise.beatsPerBar);
          // A single bar too wide for the screen is scaled to fit rather than
          // clipped, so every system must land inside the width.
          expect(used, `${width} ${difficultyId} system ${i}`).toBeLessThanOrEqual(usable + 0.001);
        });
      }
    }
  });
});

describe('drawing the review', () => {
  function verdictsFor(count: number, pattern: Array<Verdict | undefined>) {
    return Array.from({ length: count }, (_, i) => pattern[i % pattern.length]);
  }

  it('writes a fingering under the mistakes and nowhere else', () => {
    const calls: RecordedCall[] = [];
    const exercise = build('easy');
    const verdicts = verdictsFor(exercise.notes.length, ['correct', 'wrong', 'correct', 'missed']);

    drawReview(mockCanvas(calls), { exercise, verdicts, theme: LIGHT_THEME });

    const expected = verdicts.filter((v) => v !== undefined && v !== 'correct').length;
    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(expected);
  });

  it('leaves a clean run unmarked', () => {
    const calls: RecordedCall[] = [];
    const exercise = build('easy');

    drawReview(mockCanvas(calls), {
      exercise,
      verdicts: new Array(exercise.notes.length).fill('correct'),
      theme: LIGHT_THEME,
    });

    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(0);
    expect(calls.some((c) => c.method === 'stroke')).toBe(true);
  });

  it('sizes the canvas to the music and reports the height', () => {
    const canvas = mockCanvas([]);
    const exercise = build('easy', 16);
    const plan = planReview(600, exercise);

    const height = drawReview(canvas, {
      exercise,
      verdicts: new Array(exercise.notes.length).fill(undefined),
      theme: LIGHT_THEME,
    });

    expect(height).toBe(plan.systems * plan.systemHeight);
    expect(canvas.style.height).toBe(`${height}px`);
    // Backing store at device resolution, not CSS pixels.
    expect(canvas.height).toBe(Math.round(height * 2));
  });

  it('draws every difficulty and both clefs without throwing', () => {
    for (const clef of ['treble', 'bass'] as const) {
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard', 'expert']) {
        const exercise = generateExercise({
          instrument: instrumentById(clef === 'bass' ? 'euphonium' : 'eb-bass'),
          clef,
          fifths: clef === 'bass' ? 3 : -3,
          difficulty: difficultyById(difficultyId),
          kind: 'phrases',
          bars: 8,
          beatsPerBar: 4,
          beatUnit: 4,
          seed: 31,
        });
        const verdicts = verdictsFor(exercise.notes.length, [
          'correct',
          'wrong',
          'missed',
          undefined,
        ]);

        expect(() =>
          drawReview(mockCanvas([], 390), { exercise, verdicts, theme: LIGHT_THEME }),
          `${clef} ${difficultyId}`,
        ).not.toThrow();
      }
    }
  });
});
