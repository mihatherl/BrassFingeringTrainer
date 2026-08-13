import { metreAt, metreFor } from '../domain/metre';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { Transport } from '../engine/clock';
import type { Verdict } from '../engine/judge';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import type { Exercise, ExerciseKind, NoteEvent } from '../exercise/types';
import { spellInKey } from '../domain/keys';
import { glyphPath } from './glyphs';
import { drawFingeringHint, type LayoutNote } from './notes';
import { staveMetrics } from './stave';
import {
  DARK_THEME,
  LIGHT_THEME,
  revealByBar,
  revealTiesByBar,
  StaveRenderer,
  staveSpaceCeiling,
} from './surface';

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

  const context: Record<string, unknown> = {
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    closePath: record('closePath'),
    roundRect: record('roundRect'),
    stroke: record('stroke'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    rect: record('rect'),
    clip: record('clip'),
    setTransform: record('setTransform'),
    // Roughly proportional, which is all the layout needs: hints measure their
    // own text against the room available before printing.
    measureText: (text: string) => ({ width: text.length * 6 }),
  };

  // Drawing state is set by assignment rather than by calling anything, so the
  // colours a frame actually used are only visible if the properties record too.
  const state: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
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

function build(
  kind: ExerciseKind,
  clef: 'treble' | 'bass',
  fifths: number,
  seed: number,
  keySet?: number[],
) {
  return generateExercise({
    instrument: instrumentById(clef === 'bass' ? 'euphonium' : 'eb-bass'),
    clef,
    fifths,
    keySet,
    difficulty: difficultyById('hard'),
    kind,
    bars: 8,
    cycles: 2,
    themeCount: 2,
    metre: metreFor(4, 4),
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
      scrollSpeed: 110,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });

    expect(() => renderer.draw()).not.toThrow();

    // Stave lines, glyphs and the strike line should all have been drawn.
    expect(calls.some((c) => c.method === 'stroke')).toBe(true);
    expect(calls.filter((c) => c.method === 'fill').length).toBeGreaterThan(5);
    expect(calls.some((c) => c.method === 'clip')).toBe(true);
  });

  it('numbers every fifth bar, since a scrolling line has no system heads', () => {
    /*
     * A printed part numbers the start of each system. A scrolling line is one
     * unbroken system and has none, so it numbers periodically instead — and
     * the opening bar is still not numbered, as no part labels its own first.
     */
    const calls: RecordedCall[] = [];
    const exercise = build('random', 'treble', -3, 24);
    // Far enough in that a numbered bar is in the reading area: at 100 the beat
    // is 0.6s, and bar 6 — index 5 — starts at beat 20.
    const transport = new Transport(fakeAudioContext(19 * 0.6), 100);

    new StaveRenderer({
      canvas: mockCanvas(calls),
      exercise,
      transport,
      theme: LIGHT_THEME,
      scrollSpeed: 110,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    }).draw();

    const numbers = calls
      .filter((c) => c.method === 'fillText')
      .map((c) => Number(c.args[0]))
      .filter((n) => Number.isInteger(n));
    expect(numbers.length).toBeGreaterThan(0);
    // Every one is a bar counted from one at a multiple of five bars in: bars
    // 6, 11, 16 and so on. Never 1.
    for (const n of numbers) expect((n - 1) % 5, `bar ${n}`).toBe(0);
    expect(numbers).not.toContain(1);
  });

  it('prints the metronome mark where the tempo steps', () => {
    const calls: RecordedCall[] = [];
    const exercise = build('random', 'treble', -3, 11);
    // A step early enough to be inside the opening frame's view.
    exercise.tempo = [{ kind: 'tempo', atBeat: 4, bpm: 96 }];

    const renderer = new StaveRenderer({
      canvas: mockCanvas(calls),
      exercise,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      scrollSpeed: 110,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });
    renderer.draw();

    // The cue-note is glyph and rectangle, which the smoke assertions cover;
    // the figure itself is text, and it is the part a player reads.
    expect(calls.some((c) => c.method === 'fillText' && c.args[0] === '= 96')).toBe(true);
  });

  it('shows a key change coming, rather than springing it at the strike line', () => {
    /*
     * Reported from playing: the change arrived without warning. It was never
     * drawn in the travelling music at all — only the signature in the fixed
     * header changed, and that happens as the playhead crosses it, which is the
     * one moment the information is no use.
     *
     * Looked for as the *double bar*, which is the thing a change brings and
     * nothing else on the stave has: two vertical strokes a fraction of a stave
     * space apart, where ordinary bar lines stand a whole bar from each other.
     * That is what makes this fail against the old renderer, which drew the
     * plain bar line at that beat and nothing more.
     */
    const calls: RecordedCall[] = [];
    const exercise = build('random', 'treble', -3, 24, [-3, -1]);
    expect(exercise.keys.map((k) => k.fromBeat)).toEqual([0, 16]);

    // Beat 13 at 100bpm, so the change three beats ahead is well in view and
    // still comfortably in front of the strike line.
    new StaveRenderer({
      canvas: mockCanvas(calls),
      exercise,
      transport: new Transport(fakeAudioContext(13 * 0.6), 100),
      theme: LIGHT_THEME,
      scrollSpeed: 110,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    }).draw();

    /*
     * Bar lines are the vertical strokes spanning the whole stave, top line to
     * bottom — derived from the stave lines the same frame drew rather than
     * from a guessed pixel figure. Filtering on "vertical and reasonably long"
     * is not enough: note stems are vertical too, and a beamed group puts them
     * close enough together to look like a double bar. That version passed
     * against a renderer with the fix taken out.
     */
    const pairs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let i = 0; i < calls.length - 1; i++) {
      if (calls[i].method !== 'moveTo' || calls[i + 1].method !== 'lineTo') continue;
      const [x1, y1] = calls[i].args as number[];
      const [x2, y2] = calls[i + 1].args as number[];
      pairs.push({ x1, y1, x2, y2 });
    }

    // The stave's own lines: horizontal and running the width of the canvas,
    // where a ledger line is horizontal and short.
    const staveYs = pairs
      .filter((p) => p.y1 === p.y2 && Math.abs(p.x2 - p.x1) > 100)
      .map((p) => p.y1);
    expect(staveYs.length).toBeGreaterThanOrEqual(5);
    const top = Math.min(...staveYs);
    const bottom = Math.max(...staveYs);

    // Within a pixel rather than exactly: the stave's lines are crisped onto
    // half-pixels and a bar line is not, so they span the same distance from
    // two figures that differ in the last place.
    const barLines = pairs
      .filter(
        (p) =>
          p.x1 === p.x2 &&
          Math.abs(Math.min(p.y1, p.y2) - top) < 1.5 &&
          Math.abs(Math.max(p.y1, p.y2) - bottom) < 1.5,
      )
      .map((p) => p.x1)
      .sort((a, b) => a - b);

    const closest = barLines
      .slice(1)
      .reduce((least, x, index) => Math.min(least, x - barLines[index]), Infinity);

    // The double bar's two lines sit a fraction of a stave space apart, where
    // one bar of 4/4 at this speed is several hundred pixels.
    expect(barLines.length, 'bar lines drawn').toBeGreaterThanOrEqual(2);
    expect(closest, `bar lines at ${barLines.map((x) => x.toFixed(0)).join(', ')}`).toBeLessThan(20);
  });

  it('greys the music past the white, whatever its verdicts would be', () => {
    const calls: RecordedCall[] = [];
    const exercise = build('random', 'treble', -3, 11);

    const renderer = new StaveRenderer({
      canvas: mockCanvas(calls),
      exercise,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      scrollSpeed: 110,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
      whiteUntil: () => 2,
    });
    renderer.draw();

    // Notes beyond beat 2 paint in the horizon grey; notes before it in ink.
    expect(calls.some((c) => c.method === 'fillStyle=' && c.args[0] === LIGHT_THEME.horizon)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'fillStyle=' && c.args[0] === LIGHT_THEME.note)).toBe(
      true,
    );
  });

  it('prints rit. where a ramp begins', () => {
    const calls: RecordedCall[] = [];
    const exercise = build('random', 'treble', -3, 11);
    exercise.tempo = [{ kind: 'ramp', fromBeat: 4, toBeat: 8, toBpm: 60 }];

    const renderer = new StaveRenderer({
      canvas: mockCanvas(calls),
      exercise,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      scrollSpeed: 110,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });
    renderer.draw();

    expect(calls.some((c) => c.method === 'fillText' && c.args[0] === 'rit.')).toBe(true);
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
            scrollSpeed: 110,
            readingMode: 'scrolling',
            // Cycle the verdicts so every feedback colour is exercised.
            verdictFor: (index) => (['correct', 'wrong', 'missed', undefined] as const)[index % 4],
          });

          expect(() => renderer.draw(), `${clef} ${fifths} at beat ${beat}`).not.toThrow();
        }
      }
    }
  });

  function rendererFor(width: number, height: number, scrollSpeed = 110) {
    return new StaveRenderer({
      canvas: mockCanvas([], width, height),
      // Crotchets and minims: sparse enough that the legibility floor never
      // binds, so these tests measure the speed rule and nothing else.
      exercise: generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        difficulty: difficultyById('beginner'),
        kind: 'random',
        bars: 8,
        cycles: 2,
        themeCount: 2,
        metre: metreFor(4, 4),
        seed: 12,
      }),
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      scrollSpeed,
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

  it('travels at exactly the speed asked for', () => {
    // Wide enough that the minimum lookahead never binds, and sparse enough
    // material that the legibility floor does not either.
    const secondsPerBeat = 60 / 100;
    for (const speed of [60, 110, 160, 200]) {
      const { pixelsPerBeat } = rendererFor(1800, 220, speed).scale;
      expect(pixelsPerBeat / secondsPerBeat).toBeCloseTo(speed, 6);
    }
  });

  it('travels at the same speed whatever the screen', () => {
    // The complaint this replaces: a bigger stave meant a bigger distance per
    // beat, so fixing legibility on a wide screen made the music fly past.
    const secondsPerBeat = 60 / 100;
    const speedOf = (w: number, h: number) => rendererFor(w, h).scale.pixelsPerBeat / secondsPerBeat;

    const landscape = speedOf(780, 260);
    const tablet = speedOf(1180, 500);
    const desktop = speedOf(1800, 220);

    for (const speed of [landscape, tablet, desktop]) {
      expect(speed).toBeLessThanOrEqual(110 + 1);
    }
    // And the wider screens hit it exactly rather than being clamped down.
    expect(tablet).toBeCloseTo(110, 5);
    expect(desktop).toBeCloseTo(110, 5);
  });

  it('keeps short notes apart even where that outruns the chosen speed', () => {
    // Semiquavers at a slow speed would otherwise overlap. Unreadable and slow
    // is no improvement on unreadable and quick.
    const dense = generateExercise({
      instrument: instrumentById('eb-bass'),
      clef: 'treble',
      fifths: -3,
      difficulty: difficultyById('expert'),
      kind: 'random',
      bars: 8,
      cycles: 2,
      themeCount: 2,
      metre: metreFor(4, 4),
      seed: 5,
    });

    const renderer = new StaveRenderer({
      canvas: mockCanvas([], 1800, 220),
      exercise: dense,
      transport: new Transport(fakeAudioContext(0), 100),
      theme: LIGHT_THEME,
      scrollSpeed: 50,
      readingMode: 'scrolling',
      verdictFor: () => undefined,
    });

    const { pixelsPerBeat, staveSpace } = renderer.scale;
    const shortest = 0.25; // expert material runs to semiquavers
    const noteheadWidth = 1.18 * staveSpace;
    expect(pixelsPerBeat * shortest).toBeGreaterThan(noteheadWidth);
  });

  it('draws notes larger in landscape than a phone, up to a ceiling', () => {
    // A wide screen was once showing needlessly small notes and more bars than
    // anyone reads ahead, so the stave was allowed to grow with the width.
    // It then grew too far: on a tablet the notation was larger than reading
    // needs and the room would have been better spent on more bars in view,
    // so the growth now stops at a ceiling. See `staveSpaceCeiling`.
    const landscapePhone = rendererFor(780, 260).scale;
    const tablet = rendererFor(1180, 500).scale;

    expect(landscapePhone.staveSpace).toBeGreaterThan(20);
    expect(tablet.staveSpace).toBeGreaterThan(landscapePhone.staveSpace * 0.9);
    expect(tablet.staveSpace).toBeLessThanOrEqual(staveSpaceCeiling(1180));

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
      scrollSpeed: 110,
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

  it('shows more music at a slower speed on the same screen', () => {
    expect(rendererFor(1400, 320, 60).scale.beatsVisible).toBeGreaterThan(
      rendererFor(1400, 320, 200).scale.beatsVisible,
    );
  });

  describe('the shared stave unit', () => {
    /*
     * The play screen measures the conductor and the band beside it in this
     * too, so that the notation and the things beside it grow together. Twice
     * they did not, and the conductor ended up looking like an afterthought on
     * a tablet; these are the properties that stop it happening again.
     */
    it('depends on width alone', () => {
      // Load-bearing, not incidental. What is sized from this consumes height,
      // so a unit that read the height would be changed by its own effect and
      // the layout would oscillate.
      expect(staveSpaceCeiling(390)).toBe(staveSpaceCeiling(390));
      for (const width of [320, 390, 744, 834, 1024, 1920]) {
        expect(Number.isFinite(staveSpaceCeiling(width)), `${width}`).toBe(true);
      }
    });

    it('grows with the screen, then stops', () => {
      // Notation stops becoming easier to read well short of as-large-as-it-
      // will-go; past that the room is better spent on more bars in view.
      expect(staveSpaceCeiling(744)).toBeGreaterThan(staveSpaceCeiling(390));
      expect(staveSpaceCeiling(1920)).toBe(staveSpaceCeiling(1024));
    });

    it('is what the renderer actually lays out against', () => {
      // The published number has to be the one the notation is drawn at, or
      // the two drift apart again — which is the whole fault being fixed.
      const reported: number[] = [];
      new StaveRenderer({
        canvas: mockCanvas([], 834, 600),
        exercise: build('random', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'paged',
        verdictFor: () => undefined,
        onLayout: (unit) => reported.push(unit),
      });

      expect(reported.length).toBeGreaterThan(0);
      expect(reported[reported.length - 1]).toBe(staveSpaceCeiling(834));
    });

    it('leaves a phone exactly where it was', () => {
      // The regression bar for the whole exercise: a phone is the device this
      // was tuned on and the one place nothing may move.
      expect(staveSpaceCeiling(390)).toBeCloseTo(13, 6);
    });
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
        scrollSpeed: 110,
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
      scrollSpeed: 110,
      readingMode: 'paged',
      verdictFor: () => undefined,
    });

    for (let beat = 0; beat < exercise.totalBeats; beat += 0.25) {
      (renderer as unknown as { options: { transport: Transport } }).options.transport =
        new Transport(fakeAudioContext(beat * secondsPerBeat), 100);
      renderer.draw();

      const { pageStartBar, barsPerPage } = renderer.scale;
      const currentBar = Math.floor(beat / metreAt(exercise.metres, 0).barBeats);
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
        scrollSpeed: 220, // fastest, which leaves the least room for a bar
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      expect(renderer.scale.barsPerPage, `${width}x${height}`).toBeGreaterThanOrEqual(1);
      expect(renderer.scale.beatsVisible).toBeGreaterThanOrEqual(4);
    }
  });

  describe('printing a fingering hint', () => {
    function withHint(hint: string | undefined) {
      const calls: RecordedCall[] = [];
      new StaveRenderer({
        canvas: mockCanvas(calls, 900, 320),
        exercise: build('random', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'scrolling',
        verdictFor: () => undefined,
        hintFor: (index) => (index === 0 ? hint : undefined),
      }).draw();
      return calls.filter((c) => c.method === 'fillText').map((c) => c.args[0]);
    }

    it('prints nothing when no note asks for one', () => {
      expect(withHint(undefined)).toHaveLength(0);
    });

    it('prints the fingering above the note that asked, a valve to a row', () => {
      // Stacked, not written along the stave: "1-2" is two rows of one digit,
      // which is what keeps a hint out of the bar numbers and out of the way of
      // the next note.
      expect(withHint('1-2')).toEqual(['1', '2']);
    });

    it('writes open as the nought a fingering chart prints', () => {
      // The word will not go in a circle, and every chart a player has met
      // prints a nought for it.
      expect(withHint('open')).toEqual(['0']);
    });

    it('keeps quiet when there is no room for one', () => {
      // "If space permits" is settled by the layout rather than by `hints.ts`:
      // which notes deserve one is a musical question, whether one fits is a
      // question only the drawing can answer.
      const metrics = staveMetrics('treble', 40, 12);
      const note: LayoutNote = {
        x: 100,
        pitch: { letter: 'G', alter: 0, octave: 4 },
        duration: { value: 'quarter', dotted: false },
        showAccidental: false,
        colour: '#000',
      };

      const printed = (room: number) => {
        const calls: RecordedCall[] = [];
        drawFingeringHint(mockContext(calls), metrics, note, '1-2-3', room, '#888', '#fff');
        return calls.some((c) => c.method === 'fillText');
      };

      expect(printed(4)).toBe(false);
      expect(printed(400)).toBe(true);
    });

    it('needs no more room for three valves than for one', () => {
      // The reason for stacking them. Written along the stave "1-2-3" is three
      // times the width of "1", and the difference decided whether a hint was
      // printed at all.
      const metrics = staveMetrics('treble', 40, 12);
      const note: LayoutNote = {
        x: 100,
        pitch: { letter: 'G', alter: 0, octave: 4 },
        duration: { value: 'quarter', dotted: false },
        showAccidental: false,
        colour: '#000',
      };

      const fits = (text: string, room: number) => {
        const calls: RecordedCall[] = [];
        drawFingeringHint(mockContext(calls), metrics, note, text, room, '#888', '#fff');
        return calls.some((c) => c.method === 'fillText');
      };

      const room = 14;
      expect(fits('1', room)).toBe(true);
      expect(fits('1-2-3', room)).toBe(true);
    });

    it('draws it in the hint colour, not the note colour', () => {
      // Present enough to read, quiet enough to read past.
      const calls: RecordedCall[] = [];
      new StaveRenderer({
        canvas: mockCanvas(calls, 900, 320),
        exercise: build('random', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'scrolling',
        verdictFor: () => undefined,
        hintFor: (index) => (index === 0 ? '1-2' : undefined),
      }).draw();

      const beforeText = calls.slice(0, calls.findIndex((c) => c.method === 'fillText'));
      const lastFill = [...beforeText].reverse().find((c) => c.method === 'fillStyle=');
      expect(lastFill?.args[0]).toBe(LIGHT_THEME.hint);
    });
  });

  describe('confirming a note', () => {
    /*
     * Green, the instant the fingering comes right, and nothing otherwise.
     *
     * A verdict is not known until the timing window closes, which can be most
     * of a note after the act that earned it — too late to point at anything
     * the player can place, and near enough the next note to be taken for a cue
     * to play it. So the line confirms and never corrects.
     */
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

    function scrollingRenderer(calls: RecordedCall[] = []) {
      return new StaveRenderer({
        canvas: mockCanvas(calls, 900, 320),
        exercise: build('random', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'scrolling',
        verdictFor: () => undefined,
      });
    }

    it('fades out and then stops', () => {
      const renderer = scrollingRenderer();
      expect(renderer.correctFlash).toBe(0);

      renderer.flashCorrect();
      expect(renderer.correctFlash).toBe(1);

      wall = 160;
      expect(renderer.correctFlash).toBeGreaterThan(0);
      expect(renderer.correctFlash).toBeLessThan(1);

      // Well before the next note at any playable tempo.
      wall = 400;
      expect(renderer.correctFlash).toBe(0);
    });

    it('paints the line green while it lasts, and blue otherwise', () => {
      const calls: RecordedCall[] = [];
      const renderer = scrollingRenderer(calls);
      const strokes = () =>
        calls.filter((c) => c.method === 'strokeStyle=').map((c) => c.args[0]);

      renderer.draw();
      expect(strokes()).toContain(LIGHT_THEME.strikeLine);
      expect(strokes()).not.toContain(LIGHT_THEME.correct);

      calls.length = 0;
      renderer.flashCorrect();
      renderer.draw();
      expect(strokes()).toContain(LIGHT_THEME.correct);

      // And back to normal once it has run its course.
      wall = 400;
      calls.length = 0;
      renderer.draw();
      expect(strokes()).toContain(LIGHT_THEME.strikeLine);
      expect(strokes()).not.toContain(LIGHT_THEME.correct);
    });

    it('says nothing in paged mode, where the notes themselves stay put', () => {
      // There is no strike line to flash, and none is wanted: a marker showing
      // where the beat has got to would give away what the player is counting.
      const calls: RecordedCall[] = [];
      const renderer = new StaveRenderer({
        canvas: mockCanvas(calls, 900, 320),
        exercise: build('random', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'paged',
        verdictFor: () => undefined,
      });

      renderer.flashCorrect();
      renderer.draw();
      expect(
        calls.some((c) => c.method === 'strokeStyle=' && c.args[0] === LIGHT_THEME.correct),
      ).toBe(false);
    });

    it('withholds a note colour in paged mode until its bar is judged, unlike scrolling', () => {
      // Beginner rhythm never runs longer than a minim, so a 4/4 bar always
      // holds at least two notes — judging only the first always leaves the
      // bar incomplete, which is the case this needs.
      const exercise = generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        difficulty: difficultyById('beginner'),
        kind: 'random',
        bars: 2,
        cycles: 2,
        themeCount: 2,
        metre: metreFor(4, 4),
        seed: 4,
      });

      const colourShown = (readingMode: 'scrolling' | 'paged') => {
        const calls: RecordedCall[] = [];
        new StaveRenderer({
          canvas: mockCanvas(calls, 900, 320),
          exercise,
          transport: new Transport(fakeAudioContext(0), 100),
          theme: LIGHT_THEME,
          scrollSpeed: 110,
          readingMode,
          // Only the very first note has been judged; whatever shares its bar
          // has not.
          verdictFor: (index) => (index === 0 ? 'correct' : undefined),
        }).draw();
        return calls.some((c) => c.method === 'fillStyle=' && c.args[0] === LIGHT_THEME.correct);
      };

      expect(colourShown('scrolling')).toBe(true);
      expect(colourShown('paged')).toBe(false);
    });
  });

  describe('turning the page', () => {
    /**
     * Drives one renderer forward, with the wall clock under our control.
     *
     * Wide, tightly spaced and long: a page has to hold several bars for "turns
     * at the last one" to mean anything, and the music has to outlast several
     * pages or the paging clamps against the end instead of turning.
     */
    function pagedRenderer(width = 1800, height = 220, scrollSpeed = 110, tempo = 100) {
      const exercise = generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        difficulty: difficultyById('hard'),
        kind: 'random',
        bars: 32,
        cycles: 2,
        themeCount: 2,
        metre: metreFor(4, 4),
        seed: 21,
      });
      const renderer = new StaveRenderer({
        canvas: mockCanvas([], width, height),
        exercise,
        transport: new Transport(fakeAudioContext(0), tempo),
        theme: LIGHT_THEME,
        scrollSpeed,
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      const secondsPerBeat = 60 / tempo;
      const drawAtBeat = (beat: number) => {
        (renderer as unknown as { options: { transport: Transport } }).options.transport =
          new Transport(fakeAudioContext(beat * secondsPerBeat), tempo);
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

    it('spaces the page by legibility alone, not by tempo or scroll speed', () => {
      // Nothing on a page moves, so neither has any bearing on how it is set.
      // Tying them together made the page emptier the slower the exercise ran,
      // which then turned every bar or two however much screen there was.
      const layouts = [
        pagedRenderer(1800, 220, 60),
        pagedRenderer(1800, 220, 220),
      ].map(({ renderer }) => renderer.scale);

      expect(layouts[0].pixelsPerBeat).toBe(layouts[1].pixelsPerBeat);
      expect(layouts[0].barsPerPage).toBe(layouts[1].barsPerPage);

      // The same page whether the exercise runs at 60 or at 160.
      const slow = pagedRenderer(1800, 220, 110, 60).renderer.scale;
      const fast = pagedRenderer(1800, 220, 110, 160).renderer.scale;
      expect(slow.pixelsPerBeat).toBe(fast.pixelsPerBeat);
    });

    /** A page tall enough to stack: a phone held upright. */
    function stackedRenderer(width = 390, height = 402, difficultyId = 'easy') {
      const exercise = generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        difficulty: difficultyById(difficultyId),
        kind: 'random',
        bars: 16,
        cycles: 2,
        themeCount: 2,
        metre: metreFor(4, 4),
        seed: 9,
      });
      const renderer = new StaveRenderer({
        canvas: mockCanvas([], width, height),
        exercise,
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      const drawAtBeat = (beat: number) => {
        (renderer as unknown as { options: { transport: Transport } }).options.transport =
          new Transport(fakeAudioContext(beat * 0.6), 100);
        renderer.draw();
      };
      return { renderer, exercise, drawAtBeat };
    }

    it('stacks lines of music on a page tall enough to hold them', () => {
      // A phone held upright has room for three lines above the buttons and was
      // showing one, which is peering through a slot rather than reading a page.
      const upright = stackedRenderer().renderer.scale;
      expect(upright.systemsShown).toBeGreaterThan(1);

      // Sideways there is no spare height, so it stays a single line.
      const sideways = stackedRenderer(750, 217).renderer.scale;
      expect(sideways.systemsShown).toBe(1);
    });

    it('never draws a line whose stave is off the page', () => {
      /*
       * A system is clearance, then the stave, then clearance again. Culling
       * a line by its whole extent let one whose stave sat below the canvas
       * still draw the clearance above it — so the tops of stems and the
       * ledger lines of high notes appeared in mid air, with no stave under
       * them, in the margin below the last line. It read as a stray mark.
       *
       * Every stave line runs the width of its system, so a horizontal rule
       * is the giveaway: count them, and none may sit outside the canvas.
       */
      const calls: RecordedCall[] = [];
      const height = 834;
      const renderer = new StaveRenderer({
        canvas: mockCanvas(calls, 1194, height),
        exercise: build('random', 'treble', -3, 5),
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      renderer.draw();

      const horizontals: number[] = [];
      for (let i = 0; i < calls.length - 1; i++) {
        const [from, to] = [calls[i], calls[i + 1]];
        if (from.method !== 'moveTo' || to.method !== 'lineTo') continue;
        const [, y1] = from.args as number[];
        const [, y2] = to.args as number[];
        if (Math.abs(y1 - y2) < 0.01) horizontals.push(y1);
      }

      expect(horizontals.length).toBeGreaterThan(0);
      for (const y of horizontals) {
        expect(y, `stave line at ${y} outside 0..${height}`).toBeGreaterThanOrEqual(0);
        expect(y, `stave line at ${y} outside 0..${height}`).toBeLessThanOrEqual(height);
      }
    });

    it('shows several times as many bars for it', () => {
      const stacked = stackedRenderer().renderer.scale;
      const oneLine = stackedRenderer(390, 150).renderer.scale;

      expect(oneLine.systemsShown).toBe(1);
      expect(stacked.barsPerPage).toBeGreaterThan(oneLine.barsPerPage * 2);
    });

    it('draws the clef on the first line of the piece, and never again once the page turns', () => {
      // The clef, key and time signature never change within an exercise, so
      // repeating them on every stacked line spends a phone's narrowest
      // dimension on furniture instead of music — and a player who has seen
      // them once at the start does not need them shown again just because a
      // later line has scrolled to the top of the stack.
      const calls: RecordedCall[] = [];
      const exercise = generateExercise({
        instrument: instrumentById('eb-bass'),
        clef: 'treble',
        fifths: -3,
        difficulty: difficultyById('easy'),
        kind: 'random',
        bars: 16,
        cycles: 2,
        themeCount: 2,
        metre: metreFor(4, 4),
        seed: 9,
      });
      const renderer = new StaveRenderer({
        canvas: mockCanvas(calls, 390, 402),
        exercise,
        transport: new Transport(fakeAudioContext(0), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode: 'paged',
        verdictFor: () => undefined,
      });
      const drawAtBeat = (beat: number) => {
        (renderer as unknown as { options: { transport: Transport } }).options.transport =
          new Transport(fakeAudioContext(beat * 0.6), 100);
        renderer.draw();
      };
      const clef = glyphPath('gClef');
      const clefDraws = () => calls.filter((c) => c.method === 'fill' && c.args[0] === clef).length;

      expect(renderer.scale.systemsShown).toBeGreaterThan(1);
      drawAtBeat(0);
      expect(clefDraws()).toBe(1);

      // Deep enough into the piece that the stack has turned at least once —
      // this is the case the top-of-the-visible-stack version got wrong. Two
      // draws: the first starts the turn, the second — once the slide has
      // had time to finish — is the settled frame actually being checked.
      drawAtBeat(exercise.totalBeats * 0.75);
      wall += 600;
      calls.length = 0;
      drawAtBeat(exercise.totalBeats * 0.75);
      expect(renderer.scale.pageStartBar).toBeGreaterThan(0);
      expect(clefDraws()).toBe(0);
    });

    it('keeps the bar being played on screen, all the way through', () => {
      // The invariant that matters: whatever the stack does, the player can see
      // the bar they are on.
      const { renderer, exercise, drawAtBeat } = stackedRenderer();
      const beatsPerBar = metreAt(exercise.metres, 0).barBeats;
      let previousStart = 0;

      for (let beat = 0; beat < exercise.totalBeats; beat += 0.5) {
        wall += 600; // let each scroll finish
        drawAtBeat(beat);
        const { pageStartBar, barsPerPage } = renderer.scale;
        const bar = Math.floor(beat / beatsPerBar);

        expect(pageStartBar, `beat ${beat}`).toBeGreaterThanOrEqual(previousStart);
        expect(bar, `beat ${beat}`).toBeGreaterThanOrEqual(pageStartBar);
        expect(bar, `beat ${beat}`).toBeLessThan(pageStartBar + barsPerPage);
        previousStart = pageStartBar;
      }
    });

    it('holds still while there is a line left in hand', () => {
      // Reaching the *bottom* line is what moves the stack, not reaching the
      // end of the line being read — so there is always one line spare.
      const { renderer, exercise, drawAtBeat } = stackedRenderer();
      const beatsPerBar = metreAt(exercise.metres, 0).barBeats;

      drawAtBeat(0);
      const firstScreen = renderer.scale;
      // The first line's worth of bars cannot move it; the stack has more below.
      const barsOnFirstLine = Math.floor(firstScreen.barsPerPage / firstScreen.systemsShown);

      wall += 600;
      drawAtBeat(Math.max(0, barsOnFirstLine - 1) * beatsPerBar);
      expect(renderer.scale.pageStartBar).toBe(0);
    });

    it('slides rather than cutting when it does move', () => {
      const { renderer, exercise, drawAtBeat } = stackedRenderer();
      const beatsPerBar = metreAt(exercise.metres, 0).barBeats;

      drawAtBeat(0);
      const before = renderer.scale.shownOrigin;

      // Far enough in to have reached the bottom line.
      const late = Math.floor(exercise.totalBeats / beatsPerBar / 2) * beatsPerBar;
      drawAtBeat(late);
      expect(renderer.scale.pageStartBar).toBeGreaterThan(0);
      // Eased from where it was, so nothing jumps.
      expect(renderer.scale.shownOrigin).toBeCloseTo(before, 6);

      wall += 600;
      drawAtBeat(late);
      expect(renderer.scale.shownOrigin).toBeCloseTo(renderer.scale.pageOrigin, 6);
    });

    it('waits until the last visible bar before turning', () => {
      // Turning halfway wastes the right of the screen and interrupts more often
      // than it needs to.
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const { barsPerPage } = renderer.scale;
      expect(barsPerPage).toBeGreaterThan(2);

      const beatsPerBar = metreAt(exercise.metres, 0).barBeats;
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
      const beatsPerBar = metreAt(exercise.metres, 0).barBeats;

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
      expect(positions[positions.length - 1]).toBeCloseTo(renderer.scale.pageOrigin, 6);
    });

    it('eases in and out rather than moving at a constant rate', () => {
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const { barsPerPage } = renderer.scale;
      const turnBeat = (barsPerPage - 1) * metreAt(exercise.metres, 0).barBeats;

      drawAtBeat(0);
      const from = renderer.scale.shownOrigin;
      drawAtBeat(turnBeat);
      const to = renderer.scale.pageOrigin;

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

    it('sits still for long stretches rather than creeping', () => {
      // The distinction between turning a page and scrolling one.
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const starts: number[] = [];

      for (let beat = 0; beat < exercise.totalBeats; beat += 0.25) {
        wall += 600; // let each slide finish, so only real turns are counted
        drawAtBeat(beat);
        starts.push(renderer.scale.pageStartBar);
      }

      const distinct = [...new Set(starts)];
      expect(distinct.length).toBeGreaterThan(1); // it does turn
      expect(distinct.length).toBeLessThan(starts.length / 8); // but rarely

      // Never backwards, and never past the end of the music.
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
      }
      // Whatever the last page starts on, the final bar is on it. Pages hold
      // different numbers of bars now, so "total less a page" is no longer a
      // number that means anything.
      const totalBars = Math.ceil(exercise.totalBeats / metreAt(exercise.metres, 0).barBeats);
      wall += 600;
      drawAtBeat(exercise.totalBeats - 0.25);
      const lastPage = renderer.scale;
      expect(lastPage.pageStartBar + lastPage.barsPerPage).toBeGreaterThanOrEqual(totalBars);
    });


    it('never jumps when one turn follows hard on another', () => {
      // A second turn arriving mid-slide must continue from where the first got
      // to, not from the page it was heading for.
      const { renderer, exercise, drawAtBeat } = pagedRenderer();
      const beatsPerBar = metreAt(exercise.metres, 0).barBeats;
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
        scrollSpeed: 110,
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

describe('revealByBar', () => {
  // Beginner rhythm never runs longer than a minim, so a 4/4 bar always holds
  // at least two notes — the guarantee every case here relies on.
  function twoBarExercise() {
    return generateExercise({
      instrument: instrumentById('eb-bass'),
      clef: 'treble',
      fifths: -3,
      difficulty: difficultyById('beginner'),
      kind: 'random',
      bars: 2,
      cycles: 2,
      themeCount: 2,
      metre: metreFor(4, 4),
      seed: 4,
    });
  }

  it('withholds every note in a bar until the whole bar is judged', () => {
    const exercise = twoBarExercise();
    const { barBeats } = metreAt(exercise.metres, 0);
    const barOf = (index: number) => Math.floor(exercise.notes[index].startBeat / barBeats);
    const firstBarCount = exercise.notes.filter((_, index) => barOf(index) === 0).length;
    expect(firstBarCount).toBeGreaterThan(1);

    const verdicts = new Array<Verdict | undefined>(exercise.notes.length).fill(undefined);
    const reveal = revealByBar(exercise, (index) => verdicts[index]);

    // Every note but the last in the bar has been judged; the bar stays hidden.
    for (let i = 0; i < firstBarCount - 1; i++) verdicts[i] = 'correct';
    for (let i = 0; i < firstBarCount; i++) expect(reveal(i), `note ${i}`).toBeUndefined();

    // The last note completes it: the whole bar reveals together.
    verdicts[firstBarCount - 1] = 'wrong';
    for (let i = 0; i < firstBarCount - 1; i++) expect(reveal(i), `note ${i}`).toBe('correct');
    expect(reveal(firstBarCount - 1)).toBe('wrong');

    // The following bar is untouched by the first one completing.
    expect(reveal(firstBarCount)).toBeUndefined();
  });

  it('treats a missed note as judged, same as a correct or wrong one', () => {
    const exercise = twoBarExercise();
    const { barBeats } = metreAt(exercise.metres, 0);
    const firstBarCount = exercise.notes.filter(
      (note) => Math.floor(note.startBeat / barBeats) === 0,
    ).length;

    const verdicts: Array<Verdict | undefined> = new Array(exercise.notes.length).fill('missed');
    const reveal = revealByBar(exercise, (index) => verdicts[index]);

    for (let i = 0; i < firstBarCount; i++) expect(reveal(i), `note ${i}`).toBe('missed');
  });
});

describe('revealTiesByBar', () => {
  /**
   * The hymn case, reported from a real part: a G held across four bars, then
   * an ordinary note after it. Only the first of the five is ever judged — the
   * rest are the far end of the tie — so all four bars used to turn green the
   * instant the attack was confirmed.
   */
  function heldAcrossBars(): Exercise {
    const held: NoteEvent[] = [0, 1, 2, 3].map((bar) => ({
      writtenMidi: 67,
      pitch: spellInKey(67, 0),
      soundingMidi: 46,
      startBeat: bar * 4,
      duration: { value: 'whole' as const, dotted: false },
      acceptedMasks: [0],
      primaryMask: 0,
      beamGroup: -1,
      tupletGroup: -1,
      tiedToNext: bar < 3,
      showAccidental: false,
    }));

    return {
      notes: [
        ...held,
        { ...held[0], startBeat: 16, duration: { value: 'quarter', dotted: false }, tiedToNext: false },
      ],
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metres: [{ fromBeat: 0, metre: metreFor(4, 4) }],
      tempo: [],
      totalBeats: 17,
      chosenBeats: 17,
      seed: 1,
      kind: 'random',
    };
  }

  /** Every note wears the head's verdict, as `PlayScreen` hands them over. */
  function reveal(beat: () => number) {
    const exercise = heldAcrossBars();
    return revealTiesByBar(exercise, () => 'correct', beat);
  }

  it('marks a bar of a tie only once that bar has been played through', () => {
    let beat = 0;
    const shown = reveal(() => beat);

    // A quarter of the way into the first bar: the attack is confirmed, and
    // nothing on the page says anything about the three bars still to hold.
    beat = 1;
    for (let i = 0; i < 4; i++) expect(shown(i), `note ${i}`).toBeUndefined();

    // The first bar closes and takes its own notehead with it, and no more.
    beat = 4;
    expect(shown(0)).toBe('correct');
    for (let i = 1; i < 4; i++) expect(shown(i), `note ${i}`).toBeUndefined();

    // Then one at a time, behind the player.
    beat = 8;
    expect(shown(1)).toBe('correct');
    expect(shown(2)).toBeUndefined();

    beat = 16;
    for (let i = 0; i < 4; i++) expect(shown(i), `note ${i}`).toBe('correct');
  });

  it('holds an untied note back for nothing', () => {
    // The rule is about a sound that outlives its bar. An ordinary note is over
    // inside its own, and the strike line has already said what it made of it.
    const shown = reveal(() => 16);
    expect(shown(4)).toBe('correct');
  });

  it('is what the renderer actually colours a tie with', () => {
    /*
     * The wiring, not the rule: the wrapper is composed in the constructor and
     * a tie held back by it would still be drawn green if the composition were
     * wrong — or in paged mode, if the two wrappers were nested the other way
     * round.
     */
    const paints = (seconds: number, readingMode: 'scrolling' | 'paged') => {
      const calls: RecordedCall[] = [];
      new StaveRenderer({
        canvas: mockCanvas(calls),
        exercise: heldAcrossBars(),
        transport: new Transport(fakeAudioContext(seconds), 100),
        theme: LIGHT_THEME,
        scrollSpeed: 110,
        readingMode,
        // The tie only: the plain note after it is another bar's business, and
        // it would paint green at any beat, which is the point of it.
        verdictFor: (index) => (index < 4 ? 'correct' : undefined),
      }).draw();
      return calls.some((c) => c.method === 'fillStyle=' && c.args[0] === LIGHT_THEME.correct);
    };

    // A beat into the first bar of the tie, and a beat past the end of it.
    // One beat is 0.6s at 100bpm.
    for (const mode of ['scrolling', 'paged'] as const) {
      expect(paints(0.6, mode), `${mode} inside the bar`).toBe(false);
      expect(paints(3.0, mode), `${mode} past the bar`).toBe(true);
    }
  });

  it('says nothing where there is no verdict yet', () => {
    const exercise = heldAcrossBars();
    const shown = revealTiesByBar(exercise, () => undefined, () => 99);
    for (let i = 0; i < 5; i++) expect(shown(i), `note ${i}`).toBeUndefined();
  });
});
