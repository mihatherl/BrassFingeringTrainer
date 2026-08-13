import { beforeAll, describe, expect, it } from 'vitest';
import { BOUND_X, drawRangeStave, type RangeBound } from './range-stave';
import { midiFromName } from '../domain/pitch';
import { INSTRUMENTS, availableClefs, writtenRange } from '../domain/instruments';
import { GLYPHS } from './glyphs';
import { LIGHT_THEME } from './surface';

/**
 * The stave in the range picker.
 *
 * The thing worth testing is the room it makes. The ends of a brass compass are
 * a long way outside a stave — an Eb bass in treble clef reads from written C#3
 * to C6, four and a half spaces below the bottom line and six above the top —
 * and a figure whose whole job is to show the extremes must not be the one that
 * crops them. The fingering chart's fixed height did exactly that, which is why
 * this is a renderer of its own.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

function mockCanvas(calls: RecordedCall[], width = 400) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const context: Record<string, unknown> = {
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
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };

  /*
   * Property assignments are recorded as well as calls, because the font is
   * set rather than passed — and without it a hint's height is unknown, which
   * is half of whether it fits on the canvas.
   */
  const recorded = new Proxy(context, {
    set(target, property, value) {
      calls.push({ method: String(property), args: [value] });
      target[String(property)] = value;
      return true;
    },
  });

  return {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => recorded,
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

const WIDTH = 400;

function bound(name: string, fingering: string): RangeBound {
  return { writtenMidi: midiFromName(name), fingering };
}

/**
 * The top and bottom of every mark the drawing makes, in CSS pixels.
 *
 * Glyphs are the point of this: a clef is drawn as a path through a translate
 * and a scale, so a test that only watched line and text coordinates would see
 * none of it — and the treble clef's tail is the very thing that hung out of
 * the bottom of this figure in the first place. The outlines are matched back
 * to their glyphs by their own path data, and measured through their bounding
 * boxes exactly as the browser would draw them.
 */
function inkBounds(calls: RecordedCall[]): { top: number; bottom: number } {
  const boxes = new Map(Object.values(GLYPHS).map((glyph) => [glyph.d, glyph.bbox]));
  let top = Infinity;
  let bottom = -Infinity;

  let originY = 0;
  let scale = 1;
  let fontSize = 0;
  const mark = (from: number, to: number) => {
    top = Math.min(top, from);
    bottom = Math.max(bottom, to);
  };

  for (const call of calls) {
    const [first, second, third] = call.args as [unknown, unknown, unknown];
    switch (call.method) {
      case 'translate':
        originY = Number(second);
        break;
      case 'scale':
        scale = Number(first);
        break;
      case 'font':
        fontSize = Number(/(\d+(?:\.\d+)?)px/.exec(String(first))?.[1] ?? 0);
        break;
      case 'moveTo':
      case 'lineTo':
        mark(Number(second), Number(second));
        break;
      case 'fillText':
        // Set on a `bottom` baseline, so the ink stands above the y given.
        mark(Number(third) - fontSize, Number(third));
        break;
      case 'fill': {
        const box = boxes.get((first as { d?: string })?.d ?? '');
        if (box) mark(originY + box.top * scale, originY + box.bottom * scale);
        break;
      }
    }
  }

  return { top, bottom };
}

function draw(low: RangeBound, high: RangeBound, fifths = -3, clef: 'treble' | 'bass' = 'treble') {
  const calls: RecordedCall[] = [];
  const canvas = mockCanvas(calls, WIDTH);
  const height = drawRangeStave(canvas, { low, high, clef, fifths, theme: LIGHT_THEME });
  return {
    calls,
    canvas,
    height,
    text: calls.filter((c) => c.method === 'fillText').map((c) => c.args[0]),
    ink: inkBounds(calls),
  };
}

describe('the range stave', () => {
  it('prints a fingering for each bound and names no pitches', () => {
    const { text } = draw(bound('G3', '1-2'), bound('C5', 'open'));

    expect(text).toContain('1-2');
    expect(text).toContain('open');
    for (const printed of text) {
      expect(String(printed)).toMatch(/^(\d(-\d)*|open|—)$/);
    }
  });

  it('crops nothing, for any instrument, clef, key or pair of notes', () => {
    /*
     * The figure exists to show the extremes, so it must not be the thing that
     * crops them — and what got cropped first was neither extreme but the
     * furniture: a treble clef's tail off the bottom, and a fingering off the
     * top of a note sitting quietly inside the stave, where nothing looked
     * like it needed room at all.
     *
     * Every pair worth drawing, since the height is a function of both notes
     * and the key they are spelled in, and the faults were all at the pair
     * level rather than in any one note.
     */
    for (const instrument of INSTRUMENTS) {
      for (const clef of availableClefs(instrument)) {
        const [lowest, highest] = writtenRange(instrument, clef);
        const middle = Math.round((lowest + highest) / 2);

        for (const fifths of [-7, -3, 0, 2, 7]) {
          for (const [low, high] of [
            [lowest, highest],
            [lowest, middle],
            [middle, highest],
            [middle, middle],
            [middle - 1, middle + 1],
            [highest, highest],
            [lowest, lowest],
          ]) {
            const { height, ink } = draw(
              { writtenMidi: low, fingering: '1-2-3-4' },
              { writtenMidi: high, fingering: 'open' },
              fifths,
              clef,
            );

            const where = `${instrument.id} ${clef} ${fifths} ${low}-${high}`;
            expect(ink.top, where).toBeGreaterThanOrEqual(0);
            expect(ink.bottom, where).toBeLessThanOrEqual(height);
          }
        }
      }
    }
  });

  it('grows and shrinks with the notes it is given', () => {
    const near = draw(bound('B4', 'open'), bound('C5', '1-3')).height;
    const far = draw(bound('C#3', '1-2-3-4'), bound('C6', 'open')).height;

    expect(far).toBeGreaterThan(near);
  });

  it('puts the bounds where the dials will be', () => {
    // The notes and the controls that move them are laid out on one set of
    // fractions; a note drawn somewhere else would be a control pointing at
    // nothing.
    const { calls } = draw(bound('G3', '1-2'), bound('C5', 'open'));
    const hints = calls.filter((c) => c.method === 'fillText');

    expect(Number(hints[0].args[1])).toBeCloseTo(BOUND_X[0] * WIDTH, 0);
    expect(Number(hints[1].args[1])).toBeCloseTo(BOUND_X[1] * WIDTH, 0);
  });

  it('sizes the canvas to its width and reports the height', () => {
    const { canvas, height } = draw(bound('G3', '1-2'), bound('C5', 'open'));

    expect(height).toBeGreaterThan(0);
    expect(canvas.style.height).toBe(`${height}px`);
    expect(canvas.height).toBe(Math.round(height * 2));
  });

  it('draws every clef and key without throwing', () => {
    for (const clef of ['treble', 'bass'] as const) {
      for (const fifths of [-7, -3, 0, 4, 7]) {
        expect(
          () => draw(bound('G3', '1-2'), bound('C5', 'open'), fifths, clef),
          `${clef} ${fifths}`,
        ).not.toThrow();
      }
    }
  });

  it('draws both ends even when they are the same note', () => {
    const { text } = draw(bound('G3', '1-2'), bound('G3', '1-2'));
    // One note asked for is still two bounds, each with a dial under it.
    expect(text.filter((t) => t === '1-2')).toHaveLength(2);
  });
});
