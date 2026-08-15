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

  /**
   * What the map is compiled from, kept so it can be recompiled with more.
   *
   * The two kinds of event are held apart because they answer to different
   * things. **The score's** are the music's own instructions — a written step,
   * a rit. — and they belong to the piece however often it is played. **The
   * player's** are the dial: not a fact about the music but about the speed
   * being practised at, which is why a rewind must not resurrect the ones they
   * have since turned away from. See `rebaseTempo`.
   */
  private nominalBpm: number;
  private readonly crotchetsPerBeat: number;
  private readonly scoreEvents: readonly TempoEvent[];
  private playerEvents: TempoEvent[] = [];
  /** The last speed the player asked for, or null if they never have. */
  private askedTempo: number | null = null;

  private readonly context: AudioContext;
  /** NaN so the first comparison always misses and anchors afresh. */
  private anchorAudioTime = Number.NaN;
  private anchorPerfTime = 0;
  /**
   * The furthest the smoothed position has reached, which it never goes back
   * behind on its own. Dropped only where the transport genuinely moves the
   * position backwards; see `visualBeat`.
   */
  private visualFloor = -Infinity;

  /**
   * Where the clock is standing still, or null while it is running.
   *
   * The audio context's time never stops — it is the sound card's clock — so
   * pausing cannot be a matter of not looking at it. Every reading of position
   * goes through `beatForTime`, and while this is set that is the answer: the
   * scheduler has nothing new to schedule and the notation stands where it was
   * left, rather than sliding on with nothing playing.
   */
  private frozenBeat: number | null = null;

  /**
   * How far ahead of the clock every sound is scheduled, in seconds, so that
   * it is *heard* on the beat the clock says.
   *
   * The audio context's time is when a sample is handed to the output, not
   * when it reaches an ear. Between the two sit the device's buffers, and on
   * a Bluetooth headset that is a fifth of a second and more — measured by the
   * player against three outputs, each late by a different amount, and the
   * phone's own speaker on the beat. Nothing else in the app moves: notation
   * and judging keep reading this clock as the truth, and the sound is sent
   * early enough to arrive when they say it should. Doing it the other way
   * round — delaying the display and the judge — would touch every reader of
   * the clock to fix one writer of sound.
   *
   * See `audioTimeForBeat`, which is the only place the lead is applied.
   */
  readonly audioLead: number;

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
    audioLead = 0,
  ) {
    this.context = context;
    this.audioLead = Math.max(0, audioLead);
    // Still seconds per *crotchet*, whatever the beat is: its customer is the
    // scrolling surface, which measures the page in the same crotchets every
    // note length is written in.
    this.nominalSecondsPerBeat = 60 / (tempo * crotchetsPerBeat);
    this.nominalBpm = tempo;
    this.crotchetsPerBeat = crotchetsPerBeat;
    this.scoreEvents = [...events];
    this.map = compileTempo(tempo, this.scoreEvents, crotchetsPerBeat);
  }

  private get events(): TempoEvent[] {
    return [...this.scoreEvents, ...this.playerEvents];
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  timeForBeat(beat: number): number {
    return this.originTime + timeAt(this.map, beat);
  }

  /**
   * When to hand a sound to the audio thread so that it is heard at `beat`.
   *
   * Everything that *sounds* asks this; everything that reads or judges asks
   * `timeForBeat`. The two differ by the output's lead and by nothing else.
   */
  audioTimeForBeat(beat: number): number {
    return this.timeForBeat(beat) - this.audioLead;
  }

  beatForTime(time: number): number {
    if (this.frozenBeat !== null) return this.frozenBeat;
    return beatAt(this.map, time - this.originTime);
  }

  /** Where the clock is standing still, or null while it is running. */
  get pausedAt(): number | null {
    return this.frozenBeat;
  }

  /**
   * Stops the clock where it stands.
   *
   * Position is frozen rather than merely unscheduled, because the two are not
   * the same thing: the audio clock carries on regardless, so a transport that
   * only stopped its timer would leave the notation scrolling past a strike
   * line with nothing behind it.
   */
  pause(): void {
    if (this.frozenBeat !== null) return;
    const beat = this.currentBeat();
    this.stop();
    this.frozenBeat = beat;
    // Held slightly behind wherever the display had extrapolated to, and the
    // held position is the true one.
    this.visualFloor = -Infinity;
  }

  /** Moves the frozen position, for a rewind made while paused. */
  seekTo(beat: number): void {
    if (this.frozenBeat === null) return;
    this.frozenBeat = beat;
    // A rewind made while paused, which is the display moving backwards on
    // purpose — the one thing the high-water mark must not stand in the way of.
    this.visualFloor = -Infinity;
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
   *
   * **And it only ever goes forward.** `currentTime` does not advance smoothly:
   * it can sit still for longer than a quantum and then move by one quantum
   * rather than by the wall time that has passed. Extrapolation runs at wall
   * rate meanwhile, so it ends up ahead, and re-anchoring to the audio clock's
   * own figure steps the reported beat *backwards* — measured in a browser at
   * several times a minute, by up to three hundredths of a beat.
   *
   * Too small to see as motion, and not too small to matter: anything keeping
   * state off this number sees a position that has gone back. The paged reader
   * turns the page back when the bar being played is behind the page's start,
   * so a step back across a bar line in the frame after a page turn takes the
   * page with it — the music flipping up towards the start and then returning,
   * which is how the player reported it. A page turn happens on a bar line,
   * which is exactly where a step this small can cross one.
   *
   * So the interpolated position is held at its high-water mark rather than
   * allowed to retreat: it stalls for the few milliseconds the audio clock takes
   * to catch up, and moves again after. Stalling is what this already does when
   * the clock stops altogether, and it is the honest failure — the music has not
   * gone backwards, so the display must not say it has. The mark is dropped
   * wherever position genuinely moves backwards, which is the transport's own
   * doing and never the clock's: starting, pausing and seeking, below.
   */
  visualBeat(): number {
    const audioTime = this.context.currentTime;
    const perfNow = performance.now() / 1000;

    let beat: number;
    if (audioTime !== this.anchorAudioTime) {
      this.anchorAudioTime = audioTime;
      this.anchorPerfTime = perfNow;
      beat = this.beatForTime(audioTime);
    } else {
      const elapsed = Math.min(
        Math.max(perfNow - this.anchorPerfTime, 0),
        MAX_EXTRAPOLATION_SECONDS,
      );
      beat = this.beatForTime(audioTime + elapsed);
    }

    if (beat < this.visualFloor) return this.visualFloor;
    this.visualFloor = beat;
    return beat;
  }

  /**
   * Starts the clock. `onWindow` is called repeatedly with the range of beats
   * that has come within the lookahead horizon and should now be scheduled;
   * each beat is passed exactly once.
   */
  start(onWindow: ScheduleWindow, startAtBeat = 0): void {
    if (this.isRunning) return;

    // Starting is what un-freezes it: the origin below is re-anchored, so the
    // beat it was standing at means nothing from here on.
    this.frozenBeat = null;
    // The position is about to be re-anchored, so how far the display had got
    // under the old origin says nothing about where it may go under this one.
    this.visualFloor = -Infinity;
    this.onWindow = onWindow;
    // A small offset gives the first scheduling pass room to run before the
    // origin passes, so the very first note is never late — and the lead on
    // top of it, since the first sound is handed over that much earlier still.
    this.originTime =
      this.context.currentTime + 0.1 + this.audioLead - timeAt(this.map, startAtBeat);
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
   * The last beat handed to the audio thread.
   *
   * Nothing at or before it can be altered — it is already scheduled at
   * absolute times — so it is the line anything changing the music mid-run has
   * to work beyond. `changeTempo` uses it directly below; a key change rounds
   * up from it to a bar line.
   */
  get committedBeat(): number {
    return this.scheduledUntilBeat;
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

    /*
     * Anything the player asked for at this beat or later is dropped.
     *
     * All of it lies beyond the scheduling horizon, so no time already computed
     * can move — and it is how a drag stays cheap: asking again for the same
     * beat replaces what is pending there instead of stacking another step
     * behind it. It also stops an abandoned speed lying in wait: rewind past a
     * change and play forward again, and the change would otherwise fire a
     * second time from a dial that has long since moved on.
     */
    const kept = this.playerEvents.filter(
      (event) => event.kind !== 'tempo' || event.atBeat < atBeat,
    );
    const mine = [...kept, { kind: 'tempo' as const, atBeat, bpm }];

    // Compiled before it is adopted, so a tempo the map refuses leaves the
    // clock running on the one it had rather than half-changed.
    this.map = compileTempo(
      this.nominalBpm,
      [...this.scoreEvents, ...mine],
      this.crotchetsPerBeat,
    );
    this.playerEvents = mine;
    this.askedTempo = bpm;
  }

  /**
   * Puts the speed on the dial in charge, for a jump that re-anchors the clock.
   *
   * A rewind replays music the player has already been through, and the steps
   * they made while going through it are still in the map — so the passage came
   * back at whatever speed it had the first time, while the dial went on
   * showing the speed they had chosen. Everything follows the clock, scoring
   * included, so the marking appeared to run ahead of the playing. Reported
   * from a hymn taken back five bars at a time.
   *
   * Safe only where the caller is about to re-anchor the origin, because it
   * rewrites the past as well as the future: with the player's steps gone the
   * whole run is at one speed, which is what they asked for by setting it.
   */
  rebaseTempo(): void {
    if (this.askedTempo === null) return;
    this.nominalBpm = this.askedTempo;
    this.playerEvents = [];
    this.map = compileTempo(this.nominalBpm, this.scoreEvents, this.crotchetsPerBeat);
  }

  private tick(): void {
    // The horizon reaches the lead further, so a beat whose *sound* is due
    // within the lookahead is scheduled in time — its clock time is that much
    // later than its audio time.
    const horizonBeat = this.beatForTime(
      this.context.currentTime + LOOKAHEAD_SECONDS + this.audioLead,
    );
    if (horizonBeat <= this.scheduledUntilBeat) return;
    this.onWindow?.(this.scheduledUntilBeat, horizonBeat);
    this.scheduledUntilBeat = horizonBeat;
  }
}
