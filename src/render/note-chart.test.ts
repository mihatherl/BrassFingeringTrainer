import { beforeAll, describe, expect, it } from 'vitest';
import { drawNoteChart, type ChartNote } from './note-chart';
import { LIGHT_THEME } from './surface';

/**
 * The fingering chart on the results screen.
 *
 * What matters is that it draws notes rather than naming them, that the numbers
 * appear, and that a note needing an accidental gets one — the chart spells in
 * the key just played, so a flat that belongs to the key must not be drawn and
 * one that does not must be.
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

const G4: ChartNote = { writtenMidi: 67, fingering: '1-2', accuracy: 0.4 };
const C4: ChartNote = { writtenMidi: 60, fingering: 'open', accuracy: 0.6 };
/** A♭4 — belongs to E♭ major, but not to C major. */
const A_FLAT4: ChartNote = { writtenMidi: 68, fingering: '2-3', accuracy: 0.5 };

function draw(notes: ChartNote[], fifths = -3, width = 400) {
  const calls: RecordedCall[] = [];
  const canvas = mockCanvas(calls, width);
  const height = drawNoteChart(canvas, { notes, clef: 'treble', fifths, theme: LIGHT_THEME });
  return { calls, canvas, height, text: calls.filter((c) => c.method === 'fillText').map((c) => c.args[0]) };
}

describe('the fingering chart', () => {
  it('prints a fingering and a score for each note', () => {
    const { text } = draw([G4, C4]);

    expect(text).toContain('1-2');
    expect(text).toContain('open');
    expect(text).toContain('40%');
    expect(text).toContain('60%');
  });

  it('names no pitches at all', () => {
    // The whole point: a player who needs the practice should not have to
    // translate "G4" back into a position on a stave.
    const { text } = draw([G4, C4, A_FLAT4]);

    for (const printed of text) {
      expect(String(printed)).toMatch(/^(\d(-\d)*|open|—|\d+%)$/);
    }
  });

  it('draws the notes, the stave and the clef', () => {
    const { calls } = draw([G4, C4]);

    expect(calls.some((c) => c.method === 'stroke')).toBe(true);
    // Noteheads, clef and key signature are all glyph fills.
    expect(calls.filter((c) => c.method === 'fill').length).toBeGreaterThan(2);
  });

  it('orders by pitch rather than by how badly each went', () => {
    // Left to right on a stave should read as notation. The percentages say
    // which is worst; the contour should not have to.
    const { text } = draw([G4, C4]);
    expect(text.indexOf('60%')).toBeLessThan(text.indexOf('40%'));
  });

  it('draws an accidental only where the key does not already give one', () => {
    // Compared within one key, so the only difference is the note.
    const glyphs = (note: ChartNote, fifths: number) =>
      draw([note], fifths).calls.filter((c) => c.method === 'fill').length;

    // G is diatonic in both keys, so it is the control in both.
    const plain = { ...A_FLAT4, writtenMidi: 67 };
    expect(glyphs(A_FLAT4, 0)).toBe(glyphs(plain, 0) + 1);

    // And in E flat major, where that note belongs to the signature, it needs
    // no sign of its own.
    expect(glyphs(A_FLAT4, -3)).toBe(glyphs(plain, -3));
  });

  it('sizes the canvas to its width and reports the height', () => {
    const { canvas, height } = draw([G4]);

    expect(height).toBeGreaterThan(0);
    expect(canvas.style.height).toBe(`${height}px`);
    expect(canvas.height).toBe(Math.round(height * 2));
  });

  it('copes with nothing to show', () => {
    expect(() => draw([])).not.toThrow();
  });

  it('draws every clef and key without throwing', () => {
    for (const clef of ['treble', 'bass'] as const) {
      for (const fifths of [-7, -3, 0, 4, 7]) {
        const calls: RecordedCall[] = [];
        expect(() =>
          drawNoteChart(mockCanvas(calls), {
            notes: [G4, C4, A_FLAT4],
            clef,
            fifths,
            theme: LIGHT_THEME,
          }),
          `${clef} ${fifths}`,
        ).not.toThrow();
      }
    }
  });
});
