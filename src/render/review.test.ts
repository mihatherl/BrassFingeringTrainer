import { metreAt, metreFor } from '../domain/metre';
import { beforeAll, describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import type { Verdict } from '../engine/judge';
import { barAtPoint, barRects, drawReview, planReview } from './review';
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
  /** Baseline in force when the call was made, which is what tells text apart. */
  baseline?: string;
  /** Fill in force, which is what tells a wash from the notation drawn over it. */
  fill?: string;
}

/**
 * Text written *under* the stave, which is what a fingering annotation is.
 *
 * Not simply every `fillText`: the page also carries bar numbers, which are
 * furniture above the stave and would otherwise be counted as marks against
 * the player. The baseline is the honest discriminator — an annotation hangs
 * from the top of its box below the stave, a bar number sits on its own
 * alphabetic baseline above it.
 */
function annotations(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.method === 'fillText' && c.baseline === 'top');
}

function mockCanvas(calls: RecordedCall[], width = 600) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const context = {
    // Notation is drawn with `fillRect` too — stems, beams, bar lines — so the
    // colour in force is what tells a bar's wash apart from the music on it.
    fillRect: (...args: unknown[]) => {
      calls.push({ method: 'fillRect', args, fill: String(context.fillStyle) });
    },
    fillText: (...args: unknown[]) => {
      calls.push({ method: 'fillText', args, baseline: context.textBaseline });
    },
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    // Roughly proportional, which is all the layout needs: hints measure their
    // own text against the room available before printing.
    measureText: (text: string) => ({ width: text.length * 6 }),
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
    kind: 'phrases',
    bars,
    cycles: 2,
    themeCount: 2,
    metre: metreFor(4, 4),
    seed: 7,
  });
}

describe('planning the review', () => {
  it('covers every bar exactly once, in order', () => {
    for (const width of [320, 390, 600, 900, 1400]) {
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard', 'hard']) {
        const exercise = build(difficultyId);
        const plan = planReview(width, exercise);
        const totalBars = Math.ceil(exercise.totalBeats / metreAt(exercise.metres, 0).barBeats);
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
    const exercise = build('hard', 16);
    const { spacing } = planReview(900, exercise);
    const { barBeats } = metreAt(exercise.metres, 0);
    const totalBars = Math.ceil(exercise.totalBeats / barBeats);

    const widths: number[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      widths.push(spacing.xOf((bar + 1) * barBeats) - spacing.xOf(bar * barBeats));
    }

    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 1.1);
  });

  it('justifies every line to the margin except the last', () => {
    // Engraved music does not leave a quarter of a line blank because the next
    // bar would not quite fit; the bars that did fit are stretched to fill it.
    const exercise = build('easy', 16);
    const plan = planReview(600, exercise);
    const totalBars = Math.ceil(exercise.totalBeats / metreAt(exercise.metres, 0).barBeats);
    expect(plan.systems).toBeGreaterThan(1);

    plan.systemStarts.forEach((start, i) => {
      const end = plan.systemStarts[i + 1] ?? totalBars;
      const final = end >= totalBars;
      const x = justifiedX(
        plan.spacing,
        start * metreAt(exercise.metres, 0).barBeats,
        Math.min(exercise.totalBeats, end * metreAt(exercise.metres, 0).barBeats),
        plan.headerWidth,
        plan.usableWidth,
        !final,
      );
      const used = x(Math.min(exercise.totalBeats, end * metreAt(exercise.metres, 0).barBeats)) - plan.headerWidth;

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
      for (const difficultyId of ['easy', 'hard', 'hard']) {
        const exercise = build(difficultyId);
        const plan = planReview(width, exercise);
        const usable = width - plan.headerWidth - plan.staveSpace * 2;
        const totalBars = Math.ceil(exercise.totalBeats / metreAt(exercise.metres, 0).barBeats);

        plan.systemStarts.forEach((start, i) => {
          const end = plan.systemStarts[i + 1] ?? totalBars;
          const used =
            plan.spacing.xOf(end * metreAt(exercise.metres, 0).barBeats) -
            plan.spacing.xOf(start * metreAt(exercise.metres, 0).barBeats);
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
    expect(annotations(calls)).toHaveLength(expected);
  });

  it('leaves a clean run unmarked', () => {
    const calls: RecordedCall[] = [];
    const exercise = build('easy');

    drawReview(mockCanvas(calls), {
      exercise,
      verdicts: new Array(exercise.notes.length).fill('correct'),
      theme: LIGHT_THEME,
    });

    expect(annotations(calls)).toHaveLength(0);
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
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard', 'hard']) {
        const exercise = generateExercise({
          instrument: instrumentById(clef === 'bass' ? 'euphonium' : 'eb-bass'),
          clef,
          fifths: clef === 'bass' ? 3 : -3,
          difficulty: difficultyById(difficultyId),
          kind: 'phrases',
          bars: 8,
          cycles: 2,
          themeCount: 2,
          metre: metreFor(4, 4),
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

describe('finding a bar on the page', () => {
  /*
   * What turns a tap on the score into a bar to practise.
   *
   * The layout is not a grid: systems are filled greedily, so a line of held
   * notes carries far more bars than a line of semiquavers, and every line but
   * the last is justified to the margin. Nothing outside `review.ts` can work
   * out where bar 23 landed, which is why the arithmetic lives there and this
   * checks it rather than a screen re-deriving it.
   */
  const barsIn = (exercise: ReturnType<typeof build>) =>
    Math.ceil(exercise.totalBeats / metreAt(exercise.metres, 0).barBeats);

  it('gives every bar a place, and never two bars the same one', () => {
    for (const width of [320, 390, 600, 1400]) {
      const exercise = build('easy', 12);
      const rects = barRects(exercise, planReview(width, exercise));
      expect(rects, `${width}`).toHaveLength(barsIn(exercise));

      for (const rect of rects) {
        expect(rect.width, `${width}`).toBeGreaterThan(0);
        expect(rect.height, `${width}`).toBeGreaterThan(0);
      }

      // Bars on one line abut rather than overlapping or leaving a crack: the
      // gap between two bars has to belong to one of them, or a tap in it
      // selects nothing and the player taps again harder.
      for (let bar = 1; bar < rects.length; bar++) {
        const previous = rects[bar - 1];
        const here = rects[bar];
        if (here.y !== previous.y) continue;
        expect(here.x, `${width} bar ${bar}`).toBeCloseTo(previous.x + previous.width, 6);
      }
    }
  });

  it('covers the whole width of every line, edge to edge', () => {
    // A tap on the clef belongs to the first bar of its line, and a tap in the
    // margin after the last bar belongs to that one. Neither is nothing.
    const exercise = build('easy', 12);
    const layout = planReview(600, exercise);
    const rects = barRects(exercise, layout);
    const lines = new Map<number, typeof rects>();
    for (const rect of rects) lines.set(rect.y, [...(lines.get(rect.y) ?? []), rect]);

    for (const [, line] of lines) {
      expect(line[0].x).toBe(0);
      const last = line[line.length - 1];
      expect(last.x + last.width).toBeCloseTo(layout.headerWidth + layout.usableWidth, 6);
    }
  });

  it('meets the bar lines that are actually drawn', () => {
    /*
     * The property that makes a tap land where the eye says it should, and the
     * one that was wrong: `xForBeat` answers where a bar's first *note column*
     * sits, and the bar line before it is drawn a setback earlier. Taking the
     * note column as the edge put every rectangle about a notehead to the right
     * of its own bar.
     *
     * Checked against the lines the drawing actually puts down rather than
     * against the arithmetic that places them, which would only restate the
     * implementation. A bar line is a vertical stroke exactly the height of the
     * stave; a stem is vertical too, and shorter.
     */
    const calls: RecordedCall[] = [];
    const exercise = build('easy', 12);
    const width = 600;
    drawReview(mockCanvas(calls, width), { exercise, verdicts: [], theme: LIGHT_THEME });

    const layout = planReview(width, exercise);
    const staveHeight = layout.staveSpace * 4;
    const lines: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < calls.length - 1; i++) {
      if (calls[i].method !== 'moveTo' || calls[i + 1].method !== 'lineTo') continue;
      const [x1, y1] = calls[i].args as number[];
      const [x2, y2] = calls[i + 1].args as number[];
      if (Math.abs(x1 - x2) > 0.01) continue;
      if (Math.abs(Math.abs(y2 - y1) - staveHeight) > 0.5) continue;
      lines.push({ x: x1, y: Math.min(y1, y2) });
    }
    expect(lines.length).toBeGreaterThan(4);

    const rects = barRects(exercise, layout);
    const starts = new Set(layout.systemStarts);
    for (const [bar, rect] of rects.entries()) {
      // The first bar of a line begins at the margin, before any bar line.
      if (starts.has(bar)) continue;
      const nearest = Math.min(...lines.map((line) => Math.abs(line.x - rect.x)));
      expect(nearest, `bar ${bar} at x=${Math.round(rect.x)}`).toBeLessThan(1.5);
    }
  });

  it('finds the bar a point falls in', () => {
    const exercise = build('easy', 12);
    const rects = barRects(exercise, planReview(600, exercise));

    for (const [bar, rect] of rects.entries()) {
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      expect(barAtPoint(rects, x, y), `bar ${bar}`).toBe(bar);
    }
  });

  it('answers nothing for a point off the music', () => {
    // Below the last system, which is where a tap lands on a short piece with
    // room to spare underneath it.
    const exercise = build('easy', 4);
    const layout = planReview(600, exercise);
    const rects = barRects(exercise, layout);
    expect(barAtPoint(rects, 300, layout.systems * layout.systemHeight + 10)).toBeNull();
    expect(barAtPoint(rects, -5, 10)).toBeNull();
  });

  it('washes only the bars it is asked to', () => {
    // The shade is drawn behind every bar before any notation, so a selected
    // bar's wash cannot land on the stave lines of the bar beside it.
    const calls: RecordedCall[] = [];
    const exercise = build('easy', 8);
    drawReview(mockCanvas(calls, 600), {
      exercise,
      verdicts: [],
      theme: LIGHT_THEME,
      shade: (bar) => (bar === 2 ? LIGHT_THEME.selection : null),
    });

    const washes = calls.filter(
      (c) => c.method === 'fillRect' && c.fill === LIGHT_THEME.selection,
    );
    expect(washes).toHaveLength(1);

    // And nothing is washed when nothing is chosen.
    const none: RecordedCall[] = [];
    drawReview(mockCanvas(none, 600), { exercise, verdicts: [], theme: LIGHT_THEME });
    expect(none.some((c) => c.fill === LIGHT_THEME.selection)).toBe(false);
  });
});
