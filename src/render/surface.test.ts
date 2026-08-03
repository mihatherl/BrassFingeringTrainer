import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { Transport } from '../engine/clock';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import type { ExerciseKind } from '../exercise/types';
import { DARK_THEME, LIGHT_THEME, StaveRenderer } from './surface';

/**
 * A smoke test for the drawing path.
 *
 * The geometry tests prove the sums are right; this proves the code actually
 * runs — that every glyph the renderer reaches for exists, that beam groups and
 * ledger lines survive contact with real generated material, and that nothing
 * throws part-way through a frame. Without a browser it is the closest thing to
 * looking at the screen.
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

  return {
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
    rect: record('rect'),
    clip: record('clip'),
    setTransform: record('setTransform'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}

function mockCanvas(calls: RecordedCall[], width = 900, height = 320): HTMLCanvasElement {
  const context = mockContext(calls);
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  } as unknown as HTMLCanvasElement;
}

/** Just enough of an AudioContext for the transport to report a position. */
function fakeAudioContext(currentTime: number): AudioContext {
  return { currentTime } as AudioContext;
}

beforeAll(() => {
  // The renderer only touches devicePixelRatio during a draw; the module runs
  // under Node here, so it needs supplying.
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 2 };
  (globalThis as { Path2D?: unknown }).Path2D = class {
    d: string | undefined;
    constructor(d?: string) {
      this.d = d;
    }
  };
});

const KINDS: ExerciseKind[] = ['random', 'scales', 'arpeggios', 'phrases'];

function build(kind: ExerciseKind, clef: 'treble' | 'bass', fifths: number, seed: number) {
  return generateExercise({
    instrument: instrumentById(clef === 'bass' ? 'euphonium' : 'eb-bass'),
    clef,
    fifths,
    difficulty: difficultyById('hard'),
    kind,
    bars: 8,
    beatsPerBar: 4,
    beatUnit: 4,
    seed,
  });
}

describe('scrolling renderer', () => {
  it.each(KINDS)('draws a frame of %s material without throwing', (kind) => {
    const calls: RecordedCall[] = [];
    const exercise = build(kind, 'treble', -3, 11);
    const transport = new Transport(fakeAudioContext(0), 100);

    const renderer = new StaveRenderer({
      canvas: mockCanvas(calls),
      exercise,
      transport,
      theme: LIGHT_THEME,
      noteSpacing: 7,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });

    expect(() => renderer.draw()).not.toThrow();

    // Stave lines, glyphs and the strike line should all have been drawn.
    expect(calls.some((c) => c.method === 'stroke')).toBe(true);
    expect(calls.filter((c) => c.method === 'fill').length).toBeGreaterThan(5);
    expect(calls.some((c) => c.method === 'clip')).toBe(true);
  });

  it('draws every clef, key and verdict combination across a whole exercise', () => {
    // An unstarted transport has its origin at time zero, so the audio clock's
    // current time *is* the position in seconds — winding it forward scrubs
    // through the exercise.
    const secondsPerBeat = 60 / 140;

    for (const clef of ['treble', 'bass'] as const) {
      for (const fifths of [-7, -3, 0, 4, 7]) {
        const exercise = build('phrases', clef, fifths, fifths + 100);

        for (let beat = -4; beat <= exercise.totalBeats + 4; beat += 0.5) {
          const renderer = new StaveRenderer({
            canvas: mockCanvas([]),
            exercise,
            transport: new Transport(fakeAudioContext(beat * secondsPerBeat), 140),
            theme: fifths % 2 === 0 ? DARK_THEME : LIGHT_THEME,
            noteSpacing: 7,
            readingMode: 'scrolling',
            // Cycle the verdicts so every feedback colour is exercised.
            verdictFor: (index) => (['correct', 'wrong', 'missed', undefined] as const)[index % 4],
          });

          expect(() => renderer.draw(), `${clef} ${fifths} at beat ${beat}`).not.toThrow();
        }
      }
    }
  });

  function rendererFor(width: number, height: number, noteSpacing = 7) {
    return new StaveRenderer({
      canvas: mockCanvas([], width, height),
      exercise: build('random', 'treble', -3, 12),
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      noteSpacing,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });
  }

  it('keeps the same scale on a wider screen and shows more music instead', () => {
    // Short enough that height decides the stave size for both, so only the
    // width differs. This is a phone in landscape versus a tablet.
    const narrow = rendererFor(700, 220).scale;
    const wide = rendererFor(1400, 220).scale;

    expect(wide.staveSpace).toBe(narrow.staveSpace);

    // The scale must not stretch with the screen. Dividing the width by a target
    // beat count did exactly that, which spread the notes out and — because the
    // tempo is unchanged — made them fly past at roughly twice the speed.
    expect(wide.pixelsPerBeat).toBeCloseTo(narrow.pixelsPerBeat, 6);

    // The extra room buys more bars, which is the point.
    expect(wide.beatsVisible).toBeGreaterThan(narrow.beatsVisible * 1.8);
  });

  it('scrolls at the same speed in portrait and landscape', () => {
    // Rotating a phone changes both dimensions; the notes should not suddenly
    // travel at a different rate relative to their own size.
    const portrait = rendererFor(390, 450).scale;
    const landscape = rendererFor(780, 260).scale;

    const beatsPerStaveSpace = (s: { pixelsPerBeat: number; staveSpace: number }) =>
      s.pixelsPerBeat / s.staveSpace;

    // Allow for the narrow-screen floor tightening portrait a little, but they
    // must stay in the same ballpark rather than differing by a factor of two.
    expect(beatsPerStaveSpace(landscape) / beatsPerStaveSpace(portrait)).toBeLessThan(1.6);
  });

  it('honours the requested spacing exactly when there is room', () => {
    // Wide enough that even the loosest spacing still leaves the minimum
    // lookahead, so nothing is being clamped.
    for (const spacing of [5, 7, 10, 14]) {
      const { pixelsPerBeat, staveSpace } = rendererFor(1800, 220, spacing).scale;
      expect(pixelsPerBeat / staveSpace).toBeCloseTo(spacing, 6);
    }
  });

  it('draws notes larger in landscape than it used to', () => {
    // A wide screen was showing needlessly small notes and more bars than anyone
    // reads ahead. Bigger stave, nearer horizon — one lever does both, because
    // note spacing is a multiple of the stave size.
    const landscapePhone = rendererFor(780, 260).scale;
    const tablet = rendererFor(1180, 500).scale;

    expect(landscapePhone.staveSpace).toBeGreaterThan(20);
    expect(tablet.staveSpace).toBeGreaterThan(25);

    // Portrait is deliberately untouched: it was already tight for lookahead.
    expect(rendererFor(390, 450).scale.staveSpace).toBeCloseTo(13, 5);
  });

  it('sets the bar line back from the downbeat, not through it', () => {
    // A note is placed by its centre, so a bar line drawn at the same position
    // runs straight through the notehead.
    const calls: RecordedCall[] = [];
    const exercise = build('random', 'treble', -3, 12);

    const renderer = new StaveRenderer({
      canvas: mockCanvas(calls, 1200, 300),
      exercise,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      noteSpacing: 7,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });
    renderer.draw();

    const { strikeX, staveSpace } = renderer.scale;

    // Bar lines are the only vertical strokes spanning the full stave; stems are
    // shorter, at three and a half spaces.
    const verticals: number[] = [];
    for (let i = 0; i < calls.length - 1; i++) {
      const [from, to] = [calls[i], calls[i + 1]];
      if (from.method !== 'moveTo' || to.method !== 'lineTo') continue;
      const [x1, y1] = from.args as number[];
      const [x2, y2] = to.args as number[];
      if (x1 !== x2) continue;
      if (Math.abs(Math.abs(y2 - y1) - 4 * staveSpace) < 0.01) verticals.push(x1);
    }

    expect(verticals.length).toBeGreaterThan(0);
    // Beat 0 sits on the strike line, so its bar line must be to the left of it.
    const first = verticals.reduce((best, x) =>
      Math.abs(x - strikeX) < Math.abs(best - strikeX) ? x : best,
    );
    expect(first).toBeLessThan(strikeX);
    expect(strikeX - first).toBeGreaterThan(staveSpace); // clear of the notehead
  });

  it('never leaves a phone in portrait with under a bar of warning', () => {
    // The floor that stops a physical scale becoming unusable on a small screen.
    for (const spacing of [7, 10, 14]) {
      const { beatsVisible, strikeX } = rendererFor(390, 450, spacing).scale;
      expect(beatsVisible, `spacing ${spacing}`).toBeGreaterThanOrEqual(3);
      expect(strikeX).toBeLessThan(390 * 0.45);
    }
  });

  it('shows more music at tighter spacing on the same screen', () => {
    expect(rendererFor(1400, 320, 5).scale.beatsVisible).toBeGreaterThan(
      rendererFor(1400, 320, 12).scale.beatsVisible,
    );
  });

  it('draws no strike line in paged mode', () => {
    // The line would announce the beat, which is precisely what the player is
    // supposed to be working out for themselves.
    const strikeGlows = (readingMode: 'scrolling' | 'paged') => {
      const calls: RecordedCall[] = [];
      new StaveRenderer({
        canvas: mockCanvas(calls, 900, 320),
        exercise: build('phrases', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        noteSpacing: 7,
        readingMode,
        verdictFor: () => undefined,
      }).draw();
      return calls.filter(
        (c) => c.method === 'fillRect' && c.args[1] === 0 && c.args[3] === 320 && (c.args[2] as number) < 100,
      ).length;
    };

    expect(strikeGlows('scrolling')).toBeGreaterThan(0);
    expect(strikeGlows('paged')).toBe(0);
  });

  it('holds the page still, then turns it', () => {
    const exercise = build('random', 'treble', -3, 21);
    const secondsPerBeat = 60 / 100;

    const renderer = new StaveRenderer({
      canvas: mockCanvas([], 1400, 320),
      exercise,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      noteSpacing: 5,
      readingMode: 'paged',
      verdictFor: () => undefined,
    });

    const { barsPerPage } = renderer.scale;
    expect(barsPerPage).toBeGreaterThan(1);

    // Drive the same renderer forward so the page state carries across frames,
    // which is what makes a turn a turn rather than a scroll.
    const starts: number[] = [];
    for (let beat = 0; beat < exercise.totalBeats; beat += 0.25) {
      (renderer as unknown as { options: { transport: Transport } }).options.transport =
        new Transport(fakeAudioContext(beat * secondsPerBeat), 100);
      renderer.draw();
      starts.push(renderer.scale.pageStartBar);
    }

    // It must sit still for long stretches rather than creeping every frame.
    const distinct = [...new Set(starts)];
    expect(distinct.length).toBeGreaterThan(1); // it does turn
    expect(distinct.length).toBeLessThan(starts.length / 8); // but rarely

    // Never backwards, and never past the music.
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
    const totalBars = Math.ceil(exercise.totalBeats / exercise.beatsPerBar);
    expect(Math.max(...starts)).toBeLessThanOrEqual(totalBars - barsPerPage);
  });

  it('keeps the bar being played on screen at all times', () => {
    // The whole point of turning early and landing the current bar at the left:
    // you must never be asked to play a bar you cannot see.
    const exercise = build('random', 'treble', -3, 33);
    const secondsPerBeat = 60 / 100;

    const renderer = new StaveRenderer({
      canvas: mockCanvas([], 760, 300),
      exercise,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      noteSpacing: 7,
      readingMode: 'paged',
      verdictFor: () => undefined,
    });

    for (let beat = 0; beat < exercise.totalBeats; beat += 0.25) {
      (renderer as unknown as { options: { transport: Transport } }).options.transport =
        new Transport(fakeAudioContext(beat * secondsPerBeat), 100);
      renderer.draw();

      const { pageStartBar, barsPerPage } = renderer.scale;
      const currentBar = Math.floor(beat / exercise.beatsPerBar);
      expect(currentBar, `beat ${beat}`).toBeGreaterThanOrEqual(pageStartBar);
      expect(currentBar, `beat ${beat}`).toBeLessThan(pageStartBar + barsPerPage);
    }
  });

  it('always fits at least one whole bar on a page', () => {
    // Pages are measured in bars, so a page too narrow for one is meaningless.
    for (const [width, height] of [
      [390, 450],
      [760, 300],
      [1180, 500],
    ]) {
      const renderer = new StaveRenderer({
        canvas: mockCanvas([], width, height),
        exercise: build('random', 'treble', -3, 7),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        noteSpacing: 14, // widest spacing, the hardest case
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      expect(renderer.scale.barsPerPage, `${width}x${height}`).toBeGreaterThanOrEqual(1);
      expect(renderer.scale.beatsVisible).toBeGreaterThanOrEqual(4);
    }
  });

  describe('turning the page', () => {
    /**
     * Drives one renderer forward, with the wall clock under our control.
     *
     * Wide, tightly spaced and long: a page has to hold several bars for "turns
     * at the last one" to mean anything, and the music has to outlast several
     * pages or the paging clamps against the end instead of turning.
     */
    function pagedRenderer(width = 1800, height = 220, noteSpacing = 4) {
      const exercise = generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        difficulty: difficultyById('hard'),
        kind: 'random',
        bars: 32,
        beatsPerBar: 4,
        beatUnit: 4,
        seed: 21,
      });
      const renderer = new StaveRenderer({
        canvas: mockCanvas([], width, height),
        exercise,
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        noteSpacing,
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      const secondsPerBeat = 60 / 100;
      const drawAtBeat = (beat: number) => {
        (renderer as unknown as { options: { transport: Transport } }).options.transport =
          new Transport(fakeAudioContext(beat * secondsPerBeat), 100);
        renderer.draw();
      };
      return { renderer, exercise, drawAtBeat };
    }

    let realNow: () => number;
    let wall = 0;

    beforeEach(() => {
      realNow = performance.now;
      wall = 0;
      performance.now = () => wall;
    });

    afterEach(() => {
      performance.now = realNow;
    });

    it('waits until the last visible bar before turning', () => {
      // Turning halfway wastes the right of the screen and interrupts more often
      // than it needs to.
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const { barsPerPage } = renderer.scale;
      expect(barsPerPage).toBeGreaterThan(2);

      const beatsPerBar = exercise.beatsPerBar;
      // Still on the first page while the playhead is short of the last bar.
      drawAtBeat((barsPerPage - 2) * beatsPerBar);
      expect(renderer.scale.pageStartBar).toBe(0);

      // Reaching the last visible bar is what turns it.
      drawAtBeat((barsPerPage - 1) * beatsPerBar);
      expect(renderer.scale.pageStartBar).toBe(barsPerPage - 1);
    });

    it('slides to the new page rather than cutting to it', () => {
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const { barsPerPage } = renderer.scale;
      const beatsPerBar = exercise.beatsPerBar;

      drawAtBeat(0);
      const before = renderer.scale.shownOrigin;

      // Trigger the turn, then hold the music still and let only time pass, so
      // any movement is the slide and nothing else.
      const turnBeat = (barsPerPage - 1) * beatsPerBar;
      drawAtBeat(turnBeat);
      const atStart = renderer.scale.shownOrigin;
      expect(atStart).toBeCloseTo(before, 6); // eased from zero: no instant jump

      const positions: number[] = [];
      for (const elapsed of [100, 200, 300, 400, 500, 600]) {
        wall = elapsed;
        drawAtBeat(turnBeat);
        positions.push(renderer.scale.shownOrigin);
      }

      // Monotonic, and finishing on the new page.
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
      }
      expect(positions[positions.length - 1]).toBeCloseTo(
        renderer.scale.pageStartBar * beatsPerBar,
        6,
      );
    });

    it('eases in and out rather than moving at a constant rate', () => {
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const { barsPerPage } = renderer.scale;
      const turnBeat = (barsPerPage - 1) * exercise.beatsPerBar;

      drawAtBeat(0);
      const from = renderer.scale.shownOrigin;
      drawAtBeat(turnBeat);
      const to = renderer.scale.pageStartBar * exercise.beatsPerBar;

      const at = (ms: number) => {
        wall = ms;
        drawAtBeat(turnBeat);
        return (renderer.scale.shownOrigin - from) / (to - from);
      };

      // A gentle start and finish means less than a linear ramp would have
      // covered early on, and more of it by the same margin late on.
      expect(at(0.25 * 550)).toBeLessThan(0.25);
      expect(at(0.75 * 550)).toBeGreaterThan(0.75);
      // Halfway through time is halfway through the distance.
      expect(at(0.5 * 550)).toBeCloseTo(0.5, 2);
    });

    it('never jumps when one turn follows hard on another', () => {
      // A second turn arriving mid-slide must continue from where the first got
      // to, not from the page it was heading for.
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const beatsPerBar = exercise.beatsPerBar;
      const { barsPerPage } = renderer.scale;

      drawAtBeat(0);
      drawAtBeat((barsPerPage - 1) * beatsPerBar);
      wall = 100;
      drawAtBeat((barsPerPage - 1) * beatsPerBar);
      const midSlide = renderer.scale.shownOrigin;

      // Second turn, only a fraction of a second later.
      wall = 150;
      drawAtBeat((barsPerPage - 1) * 2 * beatsPerBar);
      const afterSecondTurn = renderer.scale.shownOrigin;

      // Continues from mid-slide rather than snapping.
      expect(Math.abs(afterSecondTurn - midSlide)).toBeLessThan(0.5);
    });
  });

  it('shows a countdown while the transport is still before the first beat', () => {
    const exercise = build('random', 'treble', -3, 3);
    const secondsPerBeat = 60 / 120;

    const drawAt = (beat: number) => {
      const calls: RecordedCall[] = [];
      new StaveRenderer({
        canvas: mockCanvas(calls),
        exercise,
        transport: new Transport(fakeAudioContext(beat * secondsPerBeat), 120),
        theme: LIGHT_THEME,
        noteSpacing: 7,
        readingMode: 'scrolling',
        verdictFor: () => undefined,
      }).draw();
      return calls;
    };

    // Two beats before the start, the player should see "2".
    const countingIn = drawAt(-2).filter((c) => c.method === 'fillText');
    expect(countingIn).toHaveLength(1);
    expect(countingIn[0].args[0]).toBe('2');

    // Once under way there is no countdown to show.
    expect(drawAt(1).filter((c) => c.method === 'fillText')).toHaveLength(0);
  });
});
