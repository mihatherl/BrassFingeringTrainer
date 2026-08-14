import { metreFor } from '../domain/metre';
import { beforeAll, describe, expect, it } from 'vitest';
import { spellInKey } from '../domain/keys';
import { durationFromBeats } from '../domain/rhythm';
import type { Exercise, NoteEvent } from '../exercise/types';
import { LIGHT_THEME } from './surface';
import { staveMetrics } from './stave';
import { BAR_LINE_SETBACK, drawSystem } from './system';

/**
 * Where a tie is drawn, and in particular what happens to one whose two notes
 * end up on different lines.
 *
 * That is not an edge case here but the ordinary one: a tie exists to cross a
 * bar line, and a system break is a bar line. Half the ties on a page will have
 * a note on each side of one.
 */

interface RecordedCall {
  method: string;
  args: number[];
}

function mockContext(calls: RecordedCall[]): CanvasRenderingContext2D {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args: args as number[] });
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
    setTransform: record('setTransform'),
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
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

const STAVE_SPACE = 12;
const PIXELS_PER_BEAT = 60;
/** A plain linear layout, so a tie's endpoints can be reasoned about directly. */
const xForBeat = (beat: number) => 100 + beat * PIXELS_PER_BEAT;

function note(startBeat: number, beats: number, tiedToNext = false): NoteEvent {
  return {
    writtenMidi: 71, // B4 — above the middle line, so its stem points down.
    pitch: spellInKey(71, 0),
    soundingMidi: 71,
    startBeat,
    duration: durationFromBeats(beats)!,
    acceptedMasks: [0],
    primaryMask: 0,
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext,
    showAccidental: false,
  };
}

/** Two bars of 2/4, with the second note tied over the bar line into the third. */
function tiedExercise(): Exercise {
  return {
    notes: [note(0, 1), note(1, 1, true), note(2, 1), note(3, 1)],
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
    tempo: [],
    totalBeats: 4,
    chosenBeats: 4,
    seed: 1,
    kind: 'phrases',
  };
}

/**
 * The ties drawn by one call, as the x each one runs between.
 *
 * `quadraticCurveTo` is used by nothing else on a stave — noteheads and clefs
 * are filled paths, stems and bar lines are straight lines, beams are
 * rectangles — so a pair of them is a tie, and the third argument of each is an
 * endpoint.
 */
function tiesDrawn(exercise: Exercise, firstBar: number, lastBar: number, final: boolean) {
  const calls: RecordedCall[] = [];
  drawSystem(mockContext(calls), {
    exercise,
    metrics: staveMetrics(exercise.clef, 40, STAVE_SPACE),
    xForBeat,
    firstBar,
    lastBar,
    theme: LIGHT_THEME,
    colourFor: () => LIGHT_THEME.note,
    final,
    clef: true,
  });

  const curves = calls.filter((c) => c.method === 'quadraticCurveTo');
  expect(curves.length % 2, 'a tie is two curves').toBe(0);

  const ties: Array<{ fromX: number; toX: number; crownY: number; endY: number }> = [];
  for (let i = 0; i < curves.length; i += 2) {
    ties.push({
      toX: curves[i].args[2],
      fromX: curves[i + 1].args[2],
      crownY: curves[i].args[1],
      endY: curves[i].args[3],
    });
  }
  return ties;
}

describe('drawing a tie', () => {
  it('joins the two noteheads when both are on the line', () => {
    const exercise = tiedExercise();
    const ties = tiesDrawn(exercise, 0, 2, true);

    expect(ties).toHaveLength(1);
    // Clear of both noteheads, and between them rather than through them.
    expect(ties[0].fromX).toBeGreaterThan(xForBeat(1));
    expect(ties[0].toX).toBeLessThan(xForBeat(2));
    expect(ties[0].fromX).toBeLessThan(ties[0].toX);
  });

  it('curves away from the stem', () => {
    // B4 sits above the middle line, so its stem points down and the tie must
    // arch above the notehead — anywhere else and it runs into the stem.
    const ties = tiesDrawn(tiedExercise(), 0, 2, true);
    expect(ties[0].crownY, 'the crown is above the ends').toBeLessThan(ties[0].endY);
  });

  it('runs out to the margin on the line its head is on', () => {
    const exercise = tiedExercise();
    // Only the first bar, so the note the tie leads to is on the system below.
    const ties = tiesDrawn(exercise, 0, 1, false);

    expect(ties).toHaveLength(1);
    expect(ties[0].fromX, 'still anchored to its notehead').toBeGreaterThan(xForBeat(1));
    // Out to the bar line that closes the system, which is where the line of
    // music ends — not to where the tail note would have been had it fitted.
    expect(ties[0].toX).toBeCloseTo(xForBeat(2) - BAR_LINE_SETBACK * STAVE_SPACE, 6);
  });

  it('leads in from the margin on the line its tail is on', () => {
    const exercise = tiedExercise();
    // Only the second bar. The note the tie comes from is on the system above,
    // so this half starts at the head of the line instead.
    const ties = tiesDrawn(exercise, 1, 2, true);

    expect(ties).toHaveLength(1);
    expect(ties[0].toX, 'still anchored to its notehead').toBeLessThan(xForBeat(2));
    // Well left of the head note's own position, i.e. at the margin rather than
    // at a position carried over from the line above.
    expect(ties[0].fromX).toBeLessThan(xForBeat(1));
    expect(ties[0].fromX).toBeGreaterThan(0);
  });

  it('draws nothing on a line that holds neither end', () => {
    const exercise = tiedExercise();
    exercise.notes = [...exercise.notes, note(4, 1), note(5, 1)];
    exercise.totalBeats = 6;

    expect(tiesDrawn(exercise, 2, 3, true)).toHaveLength(0);
  });

  it('draws nothing at all when nothing is tied', () => {
    const exercise = tiedExercise();
    exercise.notes[1].tiedToNext = false;

    expect(tiesDrawn(exercise, 0, 2, true)).toHaveLength(0);
  });
});
