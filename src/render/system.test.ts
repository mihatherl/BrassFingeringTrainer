import { metreFor } from '../domain/metre';
import { beforeAll, describe, expect, it } from 'vitest';
import { spellInKey } from '../domain/keys';
import type { Exercise, NoteEvent } from '../exercise/types';
import { glyphPath } from './glyphs';
import { staveMetrics } from './stave';
import { LIGHT_THEME } from './surface';
import { drawSystem } from './system';

/**
 * The header option: the clef, key and time signature at the head of a system.
 *
 * Everything else about a system is exercised through `review.test.ts` and
 * `surface.test.ts`, which draw real, generated material. This is narrower on
 * purpose — it isolates the one thing neither of those can pin down precisely,
 * which is whether the courtesy header was drawn at all.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

function mockContext(calls: RecordedCall[]): CanvasRenderingContext2D {
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
    quadraticCurveTo: record('quadraticCurveTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    measureText: (text: string) => ({ width: text.length * 6 }),
  };

  const state: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  for (const [name, initial] of Object.entries(state)) {
    let value = initial;
    Object.defineProperty(context, name, {
      get: () => value,
      set: (next: unknown) => {
        value = next;
        calls.push({ method: `${name}=`, args: [next] });
      },
    });
  }

  return context as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D = class {
    d: string | undefined;
    constructor(d?: string) {
      this.d = d;
    }
  };
});

function exerciseOf(): Exercise {
  const notes: NoteEvent[] = [0, 1, 2, 3].map((beat) => ({
    writtenMidi: 67,
    pitch: spellInKey(67, 0),
    soundingMidi: 46,
    startBeat: beat,
    duration: { value: 'quarter', dotted: false },
    acceptedMasks: [0],
    primaryMask: 0,
    beamGroup: -1,
    tiedToNext: false,
    showAccidental: false,
  }));

  return {
    notes,
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    fifths: -3,
    metre: metreFor(4, 4),
    totalBeats: 4,
    seed: 1,
    kind: 'random',
  };
}

function draw(header: boolean): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const exercise = exerciseOf();
  drawSystem(mockContext(calls), {
    exercise,
    metrics: staveMetrics(exercise.clef, 0, 20),
    xForBeat: (beat) => 300 + beat * 40,
    firstBar: 0,
    lastBar: 1,
    theme: LIGHT_THEME,
    colourFor: () => LIGHT_THEME.note,
    final: true,
    header,
  });
  return calls;
}

describe('drawSystem header', () => {
  it('draws the clef only when asked', () => {
    const clef = glyphPath('gClef');
    const drawsClef = (calls: RecordedCall[]) =>
      calls.some((c) => c.method === 'fill' && c.args[0] === clef);

    expect(drawsClef(draw(true))).toBe(true);
    expect(drawsClef(draw(false))).toBe(false);
  });

  it('skips the key and time signature along with the clef', () => {
    // Every glyph fill is a `fill(Path2D)` call; a bare shape fill (a beam, a
    // tie) calls `fill()` with nothing. Noteheads and stems draw regardless of
    // the header, so the difference between the two runs is exactly what the
    // header contributed: the clef, the key signature and the two rows of a
    // time signature digit.
    const glyphFills = (calls: RecordedCall[]) =>
      calls.filter((c) => c.method === 'fill' && c.args.length > 0).length;

    expect(glyphFills(draw(false))).toBeLessThan(glyphFills(draw(true)));
  });
});
