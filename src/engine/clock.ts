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

import {
  beatAt,
  compileTempo,
  rampRatioAt,
  timeAt,
  type TempoEvent,
  type TempoMap,
} from '../domain/tempo';

export type ScheduleWindow = (fromBeat: number, toBeat: number) => void;

const LOOKAHEAD_SECONDS = 0.15;
const TICK_MS = 25;

/**
 * Ceiling on how far the visual clock may run ahead of the last audio update.
 * Comfortably longer than any realistic audio buffer, but short enough that a
 * genuinely stalled context freezes the display rather than sliding away from it.
 */
const MAX_EXTRAPOLATION_SECONDS = 0.1;

/**
 * Earliest beat a tempo change may be placed at.
 *
 * The map refuses events on or before beat zero — the region behind the music
 * is where the count-in lives and is flat by construction — so a change asked
 * for during the count-in lands as near the first note as the map allows.
 */
const MIN_CHANGE_BEAT = 1e-6;

export class Transport {
  private timer: number | null = null;
  private originTime = 0;
  private scheduledUntilBeat = 0;
  private onWindow: ScheduleWindow | null = null;

  /**
   * Seconds per crotchet at the written tempo.
   *
   * Named *nominal* because it is only the whole story while the tempo is
   * constant, and it is not the way to convert anything — `secondsBetween` is.
   * What survives a tempo map is a rate quoted at some reference point, which
   * is exactly what the scrolling display wants: how fast the music travels is
   * a property of the page, set once, not something that should surge and stall
   * through a rit.
   */
  readonly nominalSecondsPerBeat: number;

  /**
   * The beat↔time arithmetic.
   *
   * Anchored at a single origin, which is why it may only ever be *extended*:
   * re-anchoring it would retroactively move every note already scheduled, and
   * `setTempo` used to guard that with a throw. `changeTempo` extends instead —
   * it adds a step at a beat the scheduler has not reached, so every time
   * already computed stays exactly what it was.
   */
  private map: TempoMap;

  /** What the map is compiled from, kept so it can be recompiled with more. */
  private readonly nominalBpm: number;
  private readonly crotchetsPerBeat: number;
  private events: TempoEvent[];

  private readonly context: AudioContext;
  /** NaN so the first comparison always misses and anchors afresh. */
  private anchorAudioTime = Number.NaN;
  private anchorPerfTime = 0;

  /**
   * `tempo` and every event count the **conducted** beat; `crotchetsPerBeat`
   * says how long one of those is, which is `metre.pulseBeats`. It defaults to
   * 1 because that is every simple metre, where the two have always been the
   * same thing and nothing here changes.
   */
  constructor(
    context: AudioContext,
    tempo: number,
    events: readonly TempoEvent[] = [],
    crotchetsPerBeat = 1,
  ) {
    this.context = context;
    // Still seconds per *crotchet*, whatever the beat is: its customer is the
    // scrolling surface, which measures the page in the same crotchets every
    // note length is written in.
    this.nominalSecondsPerBeat = 60 / (tempo * crotchetsPerBeat);
    this.nominalBpm = tempo;
    this.crotchetsPerBeat = crotchetsPerBeat;
    this.events = [...events];
    this.map = compileTempo(tempo, this.events, crotchetsPerBeat);
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  timeForBeat(beat: number): number {
    return this.originTime + timeAt(this.map, beat);
  }

  beatForTime(time: number): number {
    return beatAt(this.map, time - this.originTime);
  }

  /**
   * How long the music lasts between two beats, in seconds.
   *
   * The only form of the question that survives a varying tempo, and therefore
   * the only one anything outside this class should be asking. "How long is
   * this note", "how much time before the next one", "how much slack does this
   * note get" are all this question, and none of them needs a rate.
   *
   * Under the tempo map it is the closed-form integral between the two
   * beats — see `domain/tempo.ts` — and with no events that degenerates to
   * the subtraction and multiply it always was. Every caller was phrased so
   * that nothing had to change when this stopped being constant, and nothing
   * did.
   */
  secondsBetween(fromBeat: number, toBeat: number): number {
    return timeAt(this.map, toBeat) - timeAt(this.map, fromBeat);
  }

  /** Current musical position, which may be negative during a count-in. */
  currentBeat(): number {
    return this.beatForTime(this.context.currentTime);
  }

  /**
   * How far the tempo has bent within the ramp in progress at a beat; exactly
   * 1 when none is. What the conductor's orb reads — see `rampRatioAt` for
   * why it is this and not the ratio to the nominal tempo.
   */
  rampRatio(beat: number): number {
    return rampRatioAt(this.map, beat);
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
    this.originTime = this.context.currentTime + 0.1 - timeAt(this.map, startAtBeat);
    this.scheduledUntilBeat = startAtBeat;

    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.onWindow = null;
  }

  /**
   * Changes the tempo from here on — the player's hand on the speed, mid-run.
   *
   * Placed at the **next whole beat at or after the scheduling horizon**, which
   * is what makes it safe and what keeps it cheap:
   *
   *  - *Safe*, because everything up to the horizon has already been handed to
   *    the audio thread at absolute times. A step beyond it cannot move a note
   *    that is already committed, and every beat behind the player keeps the
   *    time it always had — which is the invariant this map is anchored on.
   *  - *Cheap*, because a whole beat is a target a dragging finger keeps
   *    landing on: a change asking for the same beat replaces the one already
   *    pending rather than adding another. A drag becomes about one event per
   *    beat instead of one per frame.
   *
   * The delay is the scheduling horizon and a fraction of a beat — the tempo
   * gives way under the hand rather than a bar later, which is what a player
   * reaching for a slider mid-phrase is asking for.
   *
   * Two things it will not do. It will not touch the count-in, which lives at
   * negative beats where the map is flat by construction; a change made there
   * takes force as the music starts. And it will not split a rit., since a step
   * inside one has no meaning — it waits for the ramp to arrive.
   */
  changeTempo(bpm: number): void {
    let atBeat = Math.max(Math.ceil(this.scheduledUntilBeat), MIN_CHANGE_BEAT);

    for (const event of this.events) {
      if (event.kind === 'ramp' && atBeat > event.fromBeat && atBeat < event.toBeat) {
        atBeat = event.toBeat;
      }
    }

    const last = this.events[this.events.length - 1];
    const pending = last?.kind === 'tempo' && last.atBeat === atBeat;
    const events = pending ? this.events.slice(0, -1) : [...this.events];
    events.push({ kind: 'tempo', atBeat, bpm });

    // Compiled before it is adopted, so a tempo the map refuses leaves the
    // clock running on the one it had rather than half-changed.
    this.map = compileTempo(this.nominalBpm, events, this.crotchetsPerBeat);
    this.events = events;
  }

  private tick(): void {
    const horizonBeat = this.beatForTime(this.context.currentTime + LOOKAHEAD_SECONDS);
    if (horizonBeat <= this.scheduledUntilBeat) return;
    this.onWindow?.(this.scheduledUntilBeat, horizonBeat);
    this.scheduledUntilBeat = horizonBeat;
  }
}
