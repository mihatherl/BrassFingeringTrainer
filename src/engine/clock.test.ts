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

  /**
   * The sawtooth, and why it matters far away from here.
   *
   * Extrapolation runs at wall-clock rate from the last audio reading. If a
   * frame lands further past that reading than the audio clock's next quantum
   * takes it, the extrapolated beat is *ahead* of where the audio clock lands
   * when it finally ticks — and re-anchoring to it steps the reported beat
   * backwards by the overshoot. Only a few milliseconds, and invisible in
   * anything that reads a position and draws it.
   *
   * It is not invisible in anything that keeps *state* off this number. The
   * paged reader turns the page when the current bar reaches the bottom line
   * and turns it back when the current bar is above the top one, so a beat that
   * steps back across a bar line one frame after a page turn takes the page
   * with it — reported by the player as the music flipping up towards the start
   * before coming back. A bar line is exactly where a page turn happens, so the
   * one moment the page is vulnerable is the one moment the beat is next to a
   * boundary.
   */
  it('never steps backwards when the audio clock catches up in a lump', () => {
    /*
     * Measured in a browser before it was modelled here: the reported beat
     * stepped backwards several times a minute, by up to 0.03 of a beat.
     *
     * `currentTime` does not advance smoothly. It can sit still for longer than
     * a render quantum and then move by one quantum rather than by the wall time
     * that has passed — the context updating in bursts, a busy main thread, a
     * frame dropped between the tick and our noticing it. Extrapolation mean-
     * while runs at wall-clock rate from the last reading, so it is *ahead*, and
     * re-anchoring to the audio clock's own figure steps the beat back.
     *
     * A few milliseconds, and invisible in anything that reads a position and
     * draws it. Not invisible in anything keeping *state* off this number: the
     * paged reader turns the page forward when the current bar reaches the end
     * of the page and back when it is behind the start, so a beat that steps
     * back across a bar line one frame after a page turn takes the page with it.
     * Reported by the player as the music flipping up towards the start before
     * coming back, and a page turn happens on a bar line, which is exactly where
     * a step of this size can cross one.
     */
    const t = transport();
    const seen: number[] = [];

    // A frame every 16ms; the audio clock stalls for three of them and then
    // moves by a single 25ms quantum.
    for (let frame = 0; frame <= 12; frame++) {
      perfTime = frame * 16;
      audioTime = perfTime < 64 ? 0 : Math.floor((perfTime - 64) / 25) * 0.025 + 0.025;
      seen.push(t.visualBeat());
    }

    const back = seen.filter((beat, i) => i > 0 && beat < seen[i - 1]);
    expect(back, `stepped backwards ${back.length} times: ${seen.join(', ')}`).toEqual([]);
  });

  /**
   * The other half of the high-water mark, and the more dangerous one: it must
   * not stand in the way of the display moving back when the *player* moves it.
   * A mark left in place through a rewind would pin the notation at the far end
   * of what had been played and never let go — a worse fault than the stutter it
   * was put there to stop.
   */
  it('lets go of its high-water mark when the run is moved backwards', () => {
    const t = transport();
    audioTime = 4.0;
    perfTime = 200;
    expect(t.visualBeat()).toBeCloseTo(8, 6);

    t.pause();
    // Paused, the held position is the truth however far the display had run on.
    expect(t.visualBeat()).toBeCloseTo(8, 6);

    t.seekTo(2);
    expect(t.visualBeat(), 'a rewind while paused moves the display with it').toBeCloseTo(2, 6);
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

  it('replays at the tempo on the dial, not the one the passage had before', () => {
    /*
     * The fault a player found by taking a hymn back five bars at a time: the
     * steps they had made were still in the map, so the passage came back at
     * whatever speed it had the first time through while the dial went on
     * showing what they had chosen. Everything follows the clock — the judging
     * included — so the marking appeared to race ahead of the playing.
     */
    const t = started();
    t.changeTempo(60);
    expect(t.secondsBetween(4, 8)).toBeCloseTo(4, 12);

    // What a rewind does: rebase, then re-anchor at the beat gone back to.
    t.stop();
    t.rebaseTempo();
    t.start(() => undefined, 0);

    // The whole of it at the speed asked for, count-in and all — no step left
    // at beat one to trip over on the way back through.
    expect(t.secondsBetween(0, 4)).toBeCloseTo(4, 12);
    expect(t.secondsBetween(-4, 0)).toBeCloseTo(4, 12);
    expect(t.secondsBetween(40, 44)).toBeCloseTo(4, 12);
  });

  it('leaves an abandoned speed nowhere to lie in wait', () => {
    // Two changes, the second before the first has been reached: the first is
    // dropped rather than kept to fire later from a dial that has moved on.
    const t = started();
    t.changeTempo(60);
    t.stop();
    t.start(() => undefined, 0);
    t.changeTempo(240);

    // Whatever beat it is asked about beyond the horizon, one speed answers.
    expect(t.secondsBetween(4, 8)).toBeCloseTo(1, 12);
    expect(t.secondsBetween(40, 44)).toBeCloseTo(1, 12);
  });

  it('does nothing on a rebase if the player never touched it', () => {
    const t = started();
    const before = t.timeForBeat(8);
    t.rebaseTempo();
    expect(t.timeForBeat(8)).toBe(before);
  });

  it('keeps running on the tempo it had if it is handed a bad one', () => {
    const t = started();
    expect(() => t.changeTempo(0)).toThrow();
    expect(t.secondsBetween(4, 8)).toBeCloseTo(2, 12);
  });
});

/**
 * The output's lead: sound scheduled early so it is heard when the clock says.
 * The clock itself is unchanged by it — only the moment a sound is handed over,
 * and how far ahead the scheduler must therefore look.
 */
describe('the audio lead', () => {
  it('puts audio time the lead ahead of clock time, and nowhere else', () => {
    const t = new Transport(context, 120, [], 1, 0.2);
    t.start(() => {});
    for (const beat of [0, 1, 7.5]) {
      expect(t.audioTimeForBeat(beat)).toBeCloseTo(t.timeForBeat(beat) - 0.2, 9);
    }
    // Reading the clock knows nothing of it.
    audioTime = t.timeForBeat(3);
    expect(t.currentBeat()).toBeCloseTo(3, 9);
    t.stop();
  });

  it('keeps the horizon a lookahead ahead of now in *audio* time, whatever the lead', () => {
    /*
     * The scheduler's promise is that every sound is handed over a lookahead
     * before it is due on the audio thread. A led sound is due earlier than
     * its beat, so the horizon has to reach further in beats by exactly the
     * lead — or the sound for the last beat in the window would already be in
     * the past when the window arrives.
     */
    for (const lead of [0, 0.2, 0.45]) {
      const windows: Array<[number, number]> = [];
      const t = new Transport(context, 120, [], 1, lead);
      audioTime = 3;
      t.start((from, to) => windows.push([from, to]));
      const reached = Math.max(...windows.map(([, to]) => to));
      expect(t.audioTimeForBeat(reached), `lead ${lead}`).toBeCloseTo(3 + 0.15, 6);
      t.stop();
    }
  });

  it('gives the first sound its whole lead of room', () => {
    // The origin sits the lead further from now, so the audio time of beat 0
    // is where the origin would have been without one: never in the past.
    audioTime = 10;
    const t = new Transport(context, 120, [], 1, 0.3);
    t.start(() => {});
    expect(t.audioTimeForBeat(0)).toBeCloseTo(10.1, 9);
    expect(t.timeForBeat(0)).toBeCloseTo(10.4, 9);
    t.stop();
  });

  it('is nothing at all by default', () => {
    const t = transport();
    t.start(() => {});
    expect(t.audioTimeForBeat(2)).toBe(t.timeForBeat(2));
    t.stop();
  });
});
