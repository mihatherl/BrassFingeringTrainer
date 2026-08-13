import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transport } from './clock';

/**
 * `AudioContext.currentTime` advances a render quantum at a time. On a phone
 * that quantum can be tens of milliseconds, so reading it once per frame makes
 * the display lurch in steps — which looks like a terrible frame rate even
 * though every frame is being drawn.
 *
 * Both clocks are driven by hand here: a fake audio clock that only ticks when
 * told, and a stubbed `performance.now`.
 */

let audioTime = 0;
let perfTime = 0;
let realPerformanceNow: () => number;

const context = {
  get currentTime() {
    return audioTime;
  },
} as AudioContext;

beforeEach(() => {
  audioTime = 0;
  perfTime = 0;
  realPerformanceNow = performance.now;
  performance.now = () => perfTime;
});

afterEach(() => {
  performance.now = realPerformanceNow;
});

/** 120bpm — half a second per beat, so the arithmetic stays legible. */
function transport(): Transport {
  return new Transport(context, 120);
}

describe('the visual clock', () => {
  it('reads the audio clock exactly when it has just ticked', () => {
    const t = transport();
    audioTime = 1.0;
    expect(t.visualBeat()).toBeCloseTo(2, 6);
  });

  it('keeps moving between audio ticks instead of freezing', () => {
    const t = transport();
    audioTime = 1.0;
    t.visualBeat(); // anchor

    // The audio clock has not ticked, but 8ms of wall time has passed — roughly
    // one frame. Without interpolation this would return exactly the same beat
    // and the notes would sit still.
    perfTime = 8;
    const afterOneFrame = t.visualBeat();
    expect(afterOneFrame).toBeGreaterThan(2);
    expect(afterOneFrame).toBeCloseTo(2 + 0.008 / 0.5, 6);

    perfTime = 16;
    expect(t.visualBeat()).toBeGreaterThan(afterOneFrame);
  });

  it('re-anchors when the audio clock ticks, so it cannot drift', () => {
    const t = transport();
    audioTime = 1.0;
    t.visualBeat();

    // Interpolate across a long quantum, then let the audio clock catch up.
    perfTime = 40;
    t.visualBeat();

    audioTime = 1.04;
    perfTime = 41;
    // Back to the audio clock's own figure, with no accumulated error.
    expect(t.visualBeat()).toBeCloseTo(1.04 / 0.5, 6);
  });

  it('will not run away if the audio clock stalls', () => {
    const t = transport();
    audioTime = 1.0;
    t.visualBeat();

    perfTime = 5000; // five seconds with no audio progress at all
    // Capped at 100ms ahead, so a suspended context freezes the display rather
    // than sending it sliding off into the distance.
    expect(t.visualBeat()).toBeCloseTo((1.0 + 0.1) / 0.5, 6);
  });

  it('never goes backwards if the wall clock misbehaves', () => {
    const t = transport();
    audioTime = 1.0;
    perfTime = 100;
    t.visualBeat();

    perfTime = 90; // clock stepped backwards
    expect(t.visualBeat()).toBeCloseTo(2, 6);
  });

  it('goes nowhere at all if the audio clock is stopped', () => {
    /*
     * Why a suspended AudioContext has to be caught before an exercise starts.
     *
     * Musical position is derived entirely from `currentTime`. A context that
     * is not running has a clock that does not advance, so every beat query
     * returns the same answer: the count-in sticks on its first number, the
     * scheduler's horizon never moves, and not one metronome click is ever
     * scheduled. Nothing throws. It simply stops.
     */
    const t = transport();
    audioTime = 0; // frozen: a suspended context never advances this

    const first = t.currentBeat();
    perfTime = 250;
    const later = t.currentBeat();
    perfTime = 3000;
    const muchLater = t.currentBeat();

    expect(later).toBe(first);
    expect(muchLater).toBe(first);

    // And the smoothing cannot paper over it: it is capped precisely so that a
    // stopped clock reads as stopped rather than drifting off on its own.
    expect(t.visualBeat() - first).toBeLessThanOrEqual(0.1 / 0.5);
  });

  it('leaves the judging clock unsmoothed', () => {
    const t = transport();
    audioTime = 1.0;
    t.visualBeat();

    perfTime = 40;
    // Judging must use the real audio clock; interpolation is for the eye only,
    // and marking a note against an estimated time would be unfair.
    expect(t.currentBeat()).toBeCloseTo(2, 6);
    expect(t.visualBeat()).toBeGreaterThan(t.currentBeat());
  });
});

describe('the transport under a tempo map', () => {
  /*
   * The map's own arithmetic is held to properties in `domain/tempo.test.ts`;
   * these only pin that the transport routes through it — and that with no
   * events it is the transport the rest of this file already describes.
   */

  it('is unchanged by an empty map', () => {
    const plain = new Transport(context, 120);
    expect(plain.timeForBeat(6)).toBeCloseTo(3, 12);
    expect(plain.beatForTime(3)).toBeCloseTo(6, 12);
    expect(plain.secondsBetween(-4, 0)).toBeCloseTo(2, 12);
  });

  it('schedules and reads through a step change', () => {
    const t = new Transport(context, 120, [{ kind: 'tempo', atBeat: 4, bpm: 60 }]);
    expect(t.timeForBeat(6)).toBeCloseTo(4, 12);
    expect(t.secondsBetween(2, 6)).toBeCloseTo(3, 12);
    audioTime = 3;
    expect(t.currentBeat()).toBeCloseTo(5, 12);
  });

  it('stands still through a hold, and so does the display', () => {
    const t = new Transport(context, 120, [{ kind: 'hold', atBeat: 4, seconds: 2 }]);
    // The re-entry beat sounds at the release, not the arrival...
    expect(t.timeForBeat(4)).toBeCloseTo(4, 12);
    // ...while the clock reads the held beat for the whole dwell, which is
    // what parks the scheduling horizon as well as the notation.
    audioTime = 2.5;
    expect(t.currentBeat()).toBe(4);
    audioTime = 3.9;
    expect(t.currentBeat()).toBe(4);
    audioTime = 4.5;
    expect(t.currentBeat()).toBeCloseTo(5, 12);
  });
});

/**
 * Changing tempo mid-run, which is the play screen's slider.
 *
 * The map is anchored at one origin, so the only safe change is one that
 * *extends* it: everything the scheduler has already handed to the audio thread
 * must keep the time it was given, or the notes already committed play at the
 * wrong moment. Every case here is that property in one form or another.
 */
describe('changing tempo while running', () => {
  /** `start` reaches for the window's timers; nothing here needs them to fire. */
  function started(bpm = 120, events: ConstructorParameters<typeof Transport>[2] = [], from = 0) {
    (globalThis as { window?: unknown }).window = {
      setInterval: () => 1,
      clearInterval: () => undefined,
    };
    const t = new Transport(context, bpm, events);
    t.start(() => undefined, from);
    return t;
  }

  it('leaves every beat already scheduled exactly where it was', () => {
    const t = started();
    const before = [-4, -1, 0, 0.25, 0.5].map((beat) => t.timeForBeat(beat));

    t.changeTempo(60);

    expect([-4, -1, 0, 0.25, 0.5].map((beat) => t.timeForBeat(beat))).toEqual(before);
  });

  it('takes force at the next whole beat past the horizon', () => {
    // The horizon a fresh start leaves is a fraction of a beat in, so the step
    // lands on beat 1: half a second a beat before it, a second a beat after.
    const t = started();

    t.changeTempo(60);

    expect(t.secondsBetween(0, 1)).toBeCloseTo(0.5, 12);
    expect(t.secondsBetween(1, 2)).toBeCloseTo(1, 12);
  });

  it('does not stack up while a finger is dragging', () => {
    /*
     * A slider reports every pixel, and each report used to be another step in
     * the map — hundreds of them in a run, all of them scanned on every query.
     * Asking for the same beat replaces what is pending there, so a drag ends
     * up indistinguishable from having asked once for where it stopped.
     */
    const dragged = started();
    for (const bpm of [110, 100, 90, 80, 70, 60]) dragged.changeTempo(bpm);

    const once = started();
    once.changeTempo(60);

    for (const beat of [1, 2, 8, 40]) {
      expect(dragged.timeForBeat(beat), `beat ${beat}`).toBeCloseTo(once.timeForBeat(beat), 12);
    }
  });

  it('waits for a rit. to arrive rather than splitting it', () => {
    // Started inside the ramp, so the change has nowhere to go until it ends.
    const ramp = { kind: 'ramp' as const, fromBeat: 2, toBeat: 6, toBpm: 60 };
    const t = started(120, [ramp], 3);
    const throughTheRamp = t.secondsBetween(3, 6);

    t.changeTempo(120);

    // The bend is untouched, and the new tempo holds from where it arrives.
    expect(t.secondsBetween(3, 6)).toBeCloseTo(throughTheRamp, 12);
    expect(t.secondsBetween(6, 8)).toBeCloseTo(1, 12);
  });

  it('leaves the count-in alone and starts the music at the new speed', () => {
    // Nothing can be placed behind beat zero — that region is flat by
    // construction and is where the count-in lives.
    const t = started(120, [], -4);
    const countIn = t.secondsBetween(-4, 0);

    t.changeTempo(60);

    expect(t.secondsBetween(-4, 0)).toBeCloseTo(countIn, 12);
    // A millionth of a beat of the old tempo is left at the very start, which
    // is where the map allows the step to sit; it is half a microsecond.
    expect(t.secondsBetween(0, 4)).toBeCloseTo(4, 5);
  });

  it('keeps running on the tempo it had if it is handed a bad one', () => {
    const t = started();
    expect(() => t.changeTempo(0)).toThrow();
    expect(t.secondsBetween(4, 8)).toBeCloseTo(2, 12);
  });
});
