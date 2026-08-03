/**
 * The musical clock.
 *
 * `AudioContext.currentTime` is the single source of truth for musical
 * position. Everything — audio scheduling, scrolling, judging — reads from it.
 *
 * This matters more than it might appear. `requestAnimationFrame` deltas drift
 * and stall whenever the browser is busy, and `Date.now()` is not synchronised
 * with the audio hardware at all. Driving notation from either produces a
 * display that gradually disagrees with what the player hears, which is exactly
 * the fault a rhythm trainer cannot have.
 *
 * Audio events are scheduled ahead of time onto the audio thread; the visual
 * layer merely *reads* the same clock each frame. Neither drives the other, so
 * a dropped frame cannot disturb the timing.
 */

export type ScheduleWindow = (fromBeat: number, toBeat: number) => void;

const LOOKAHEAD_SECONDS = 0.15;
const TICK_MS = 25;

/**
 * Ceiling on how far the visual clock may run ahead of the last audio update.
 * Comfortably longer than any realistic audio buffer, but short enough that a
 * genuinely stalled context freezes the display rather than sliding away from it.
 */
const MAX_EXTRAPOLATION_SECONDS = 0.1;

export class Transport {
  private timer: number | null = null;
  private originTime = 0;
  private scheduledUntilBeat = 0;
  private onWindow: ScheduleWindow | null = null;

  /** Seconds per crotchet. */
  secondsPerBeat: number;

  private readonly context: AudioContext;
  /** NaN so the first comparison always misses and anchors afresh. */
  private anchorAudioTime = Number.NaN;
  private anchorPerfTime = 0;

  constructor(context: AudioContext, tempo: number) {
    this.context = context;
    this.secondsPerBeat = 60 / tempo;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Tempo may only be changed while stopped: the beat/time mapping is linear
   * from a single origin, and changing its slope mid-run would retroactively
   * move every note already scheduled.
   */
  setTempo(bpm: number): void {
    if (this.isRunning) throw new Error('Cannot change tempo while the transport is running');
    this.secondsPerBeat = 60 / bpm;
  }

  timeForBeat(beat: number): number {
    return this.originTime + beat * this.secondsPerBeat;
  }

  beatForTime(time: number): number {
    return (time - this.originTime) / this.secondsPerBeat;
  }

  /** Current musical position, which may be negative during a count-in. */
  currentBeat(): number {
    return this.beatForTime(this.context.currentTime);
  }

  /**
   * The same position, smoothed for display.
   *
   * `AudioContext.currentTime` advances one audio render quantum at a time, so
   * it is a staircase rather than a ramp. On desktop the steps are a couple of
   * milliseconds and invisible, but on phones the buffer can be tens of
   * milliseconds — and reading it once per frame then makes notes jump in
   * chunks, which looks like a badly dropped frame rate and makes it genuinely
   * hard to see when a note meets the line.
   *
   * So: anchor to the audio clock whenever it ticks, and fill the gaps between
   * ticks from the wall clock. Because it re-anchors on every real update this
   * cannot drift — and since `currentTime` reports the *last completed* quantum,
   * extrapolating forward is closer to the truth rather than further from it.
   *
   * Judging deliberately does not use this. Only the eye needs interpolation.
   */
  visualBeat(): number {
    const audioTime = this.context.currentTime;
    const perfNow = performance.now() / 1000;

    if (audioTime !== this.anchorAudioTime) {
      this.anchorAudioTime = audioTime;
      this.anchorPerfTime = perfNow;
      return this.beatForTime(audioTime);
    }

    const elapsed = Math.min(Math.max(perfNow - this.anchorPerfTime, 0), MAX_EXTRAPOLATION_SECONDS);
    return this.beatForTime(audioTime + elapsed);
  }

  /**
   * Starts the clock. `onWindow` is called repeatedly with the range of beats
   * that has come within the lookahead horizon and should now be scheduled;
   * each beat is passed exactly once.
   */
  start(onWindow: ScheduleWindow, startAtBeat = 0): void {
    if (this.isRunning) return;

    this.onWindow = onWindow;
    // A small offset gives the first scheduling pass room to run before the
    // origin passes, so the very first note is never late.
    this.originTime = this.context.currentTime + 0.1 - startAtBeat * this.secondsPerBeat;
    this.scheduledUntilBeat = startAtBeat;

    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.onWindow = null;
  }

  private tick(): void {
    const horizonBeat = this.beatForTime(this.context.currentTime + LOOKAHEAD_SECONDS);
    if (horizonBeat <= this.scheduledUntilBeat) return;
    this.onWindow?.(this.scheduledUntilBeat, horizonBeat);
    this.scheduledUntilBeat = horizonBeat;
  }
}
