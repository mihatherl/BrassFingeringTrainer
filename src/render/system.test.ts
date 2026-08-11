import { metreFor, type MetreChange } from '../domain/metre';
import { beforeAll, describe, expect, it } from 'vitest';
import { spellInKey } from '../domain/keys';
import type { Exercise, NoteEvent } from '../exercise/types';
import { glyphPath } from './glyphs';
import { staveMetrics } from './stave';
import { LIGHT_THEME } from './surface';
import {
  drawSignatureChange,
  drawSystem,
  signatureChangeRoom,
  signatureChangesIn,
} from './system';

/**
 * The `clef` option: whether the courtesy clef is drawn at the head of a
 * system. The key and time signature are drawn regardless — see
 * `SystemOptions.clef` in `system.ts` for why the clef alone is optional.
 *
 * Everything else about a system is exercised through `review.test.ts` and
 * `surface.test.ts`, which draw real, generated material. This is narrower on
 * purpose — it isolates the one thing neither of those can pin down precisely,
 * which is whether the courtesy clef was drawn at all.
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
    tupletGroup: -1,
    tiedToNext: false,
    showAccidental: false,
  }));

  return {
    notes,
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: -3 }],
    metres: [{ fromBeat: 0, metre: metreFor(4, 4) }],
    tempo: [],
    totalBeats: 4,
    chosenBeats: 4,
    seed: 1,
    kind: 'random',
  };
}

function draw(clef: boolean, firstBar = 0): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const exercise = exerciseOf();
  drawSystem(mockContext(calls), {
    exercise,
    metrics: staveMetrics(exercise.clef, 0, 20),
    xForBeat: (beat) => 300 + beat * 40,
    firstBar,
    lastBar: firstBar + 1,
    theme: LIGHT_THEME,
    colourFor: () => LIGHT_THEME.note,
    final: true,
    clef,
  });
  return calls;
}

describe('drawSystem clef', () => {
  it('draws the clef only when asked', () => {
    const clefGlyph = glyphPath('gClef');
    const drawsClef = (calls: RecordedCall[]) =>
      calls.some((c) => c.method === 'fill' && c.args[0] === clefGlyph);

    expect(drawsClef(draw(true))).toBe(true);
    expect(drawsClef(draw(false))).toBe(false);
  });

  it('draws the key and time signature whether or not the clef does', () => {
    // Every glyph fill is a `fill(Path2D)` call; a bare shape fill (a beam, a
    // tie) calls `fill()` with nothing. Noteheads and stems draw regardless,
    // and so — now — do the key signature's three flats and the time
    // signature's two digit rows, on this exercise. So the only difference
    // between the two runs should be the clef glyph itself: exactly one fill.
    const glyphFills = (calls: RecordedCall[]) =>
      calls.filter((c) => c.method === 'fill' && c.args.length > 0).length;

    expect(glyphFills(draw(true)) - glyphFills(draw(false))).toBe(1);
  });
});

/**
 * Bar numbers, which are how a player says where something is — "from 47",
 * "four before B" — and the only way an import warning naming a bar can be
 * checked against the printed part.
 */
describe('drawSystem bar numbers', () => {
  const texts = (calls: RecordedCall[]) =>
    calls.filter((c) => c.method === 'fillText').map((c) => c.args[0]);

  it('counts from one, not from the index', () => {
    // Bar index 4 is the fifth bar, and a player counting from the top of the
    // page says five. Nobody outside the code has ever called it bar four.
    expect(texts(draw(true, 4))).toContain('5');
  });

  it('never numbers the opening bar', () => {
    // A part does not label its own first bar. The number exists to be found in
    // the middle of a piece, and "1" over the first bar answers nothing.
    expect(texts(draw(true, 0))).toEqual([]);
  });

  it('puts the number above the stave, clear of the metronome mark band', () => {
    const number = draw(true, 4).find((c) => c.method === 'fillText');
    const metrics = staveMetrics('treble', 0, 20);
    const y = (number?.args[2] as number) ?? 0;
    // Above the top line, and below where a metronome mark starts — the two
    // both anchor to a bar line, and a tempo change is written at one, so they
    // would meet constantly if they shared a band.
    expect(y).toBeLessThan(metrics.topLineY);
    expect(y).toBeGreaterThan(metrics.topLineY - 20 * 2.5);
  });

  it('draws it in the stave colour, not the note colour', () => {
    // Furniture, not music: a player glancing for the next note should not have
    // the glance answered by a number.
    const calls = draw(true, 4);
    const at = calls.findIndex((c) => c.method === 'fillText');
    const colourBefore = calls
      .slice(0, at)
      .filter((c) => c.method === 'fillStyle=')
      .pop();
    expect(colourBefore?.args[0]).toBe(LIGHT_THEME.stave);
    expect(LIGHT_THEME.stave).not.toBe(LIGHT_THEME.note);
  });
});

/**
 * Changes of signature drawn where they fall.
 *
 * Key changes were drawn from the start; a change of *metre* was not, so a part
 * that turned from 4/4 into 3/4 simply had shorter bars from then on with
 * nothing on the page saying why. That is the notation lying about the music,
 * and it was found by a real part rather than by a test.
 */
describe('drawSignatureChange', () => {
  const fourFour = metreFor(4, 4);
  const threeFour = metreFor(3, 4);

  function changing(keys: Array<{ fromBeat: number; fifths: number }>, metres: MetreChange[]) {
    const exercise = { ...exerciseOf(), keys, metres, totalBeats: 16, chosenBeats: 16 };
    return signatureChangesIn(exercise, 0, 16);
  }

  it('finds a change of metre, not only a change of key', () => {
    const changes = changing(
      [{ fromBeat: 0, fifths: 0 }],
      [
        { fromBeat: 0, metre: fourFour },
        { fromBeat: 4, metre: threeFour },
      ],
    );
    expect(changes.get(4)?.metre?.beatsPerBar).toBe(3);
  });

  it('joins a key and a metre landing on the same bar into one change', () => {
    // One double bar with two signatures after it, not two changes side by
    // side — which is what two mechanisms would have produced.
    const changes = changing(
      [
        { fromBeat: 0, fifths: 0 },
        { fromBeat: 4, fifths: 2 },
      ],
      [
        { fromBeat: 0, metre: fourFour },
        { fromBeat: 4, metre: threeFour },
      ],
    );
    expect(changes.size).toBe(1);
    expect(changes.get(4)).toEqual({ key: { from: 0, to: 2 }, metre: threeFour });
  });

  it('leaves the opening signature alone, since the head of the line states it', () => {
    const changes = changing(
      [{ fromBeat: 0, fifths: 2 }],
      [{ fromBeat: 0, metre: threeFour }],
    );
    expect(changes.size).toBe(0);
  });

  it('reserves room for the metre, or the double bar lands on the note before', () => {
    // The apparatus is laid out backwards from the downbeat, so the spacing has
    // to have reserved exactly what the drawing will use.
    const metrics = staveMetrics('treble', 0, 20);
    const keyOnly = signatureChangeRoom(metrics, { key: { from: 0, to: 2 } });
    const both = signatureChangeRoom(metrics, { key: { from: 0, to: 2 }, metre: threeFour });
    expect(both).toBeGreaterThan(keyOnly);
    expect(signatureChangeRoom(metrics, {})).toBe(0);
  });

  it('draws the double bar and the new signature ahead of the downbeat', () => {
    const calls: RecordedCall[] = [];
    const ctx = mockContext(calls);
    const metrics = staveMetrics('treble', 0, 20);

    drawSignatureChange(ctx, metrics, 500, { metre: threeFour }, LIGHT_THEME.stave);

    // Two bar lines for the double bar, and the digits of the new signature.
    const lines = calls.filter((c) => c.method === 'moveTo').length;
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c.method === 'fill' && c.args.length > 0)).toBe(true);
  });
});
