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
