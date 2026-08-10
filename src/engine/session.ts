/**
 * Session orchestration: ties the transport, synth, metronome, input and judge
 * together for one run through an exercise.
 *
 * The count-in occupies negative beats, so exercise beat 0 is the first note and
 * every other part of the app can use the exercise's own beat numbers without
 * an offset to remember.
 */

import type { Exercise } from '../exercise/types';
import { isTieContinuation, tiedBeats } from '../exercise/ties';
import { BrassSynth } from '../audio/synth';
import type { Voice } from '../audio/sampler';
import { Metronome } from '../audio/metronome';
import { Transport } from './clock';
import { ValveInput } from './input';
import {
  isAlreadyCorrect,
  judgeNote,
  summarise,
  toleranceFor,
  type NoteJudgement,
  type SessionSummary,
} from './judge';

/**
 * What the player hears.
 *
 * `reference` sounds the exercise as written, on a brass tone — a demonstration.
 */
export type PlaybackMode = 'off' | 'reference';

export interface SessionOptions {
  context: AudioContext;
  exercise: Exercise;
  tempo: number;
  countInBars: number;
  metronomeEnabled: boolean;
  playbackMode: PlaybackMode;
  /**
   * The recorded brass voice, once loaded. Absent falls back to synthesis, so a
   * failed or slow download costs quality rather than a working exercise.
   */
  brassVoice?: Voice;
  /** Multiplies the judging window, where 1 is the default. */
  timingTolerance?: number;
  onJudgement?: (judgement: NoteJudgement) => void;
  /**
   * Fires the instant a note's fingering comes right, rather than when the note
   * is finally judged.
   *
   * A verdict cannot arrive until the timing window closes, which is a long way
   * after the act that earned it — long enough that a signal then has lost its
   * referent, and near enough the following note to be mistaken for a cue to
   * play it. Confirmation has to land on the action itself or not at all, so it
   * is reported separately and only when the answer is right.
   */
  onCorrect?: (noteIndex: number) => void;
  onFinish?: (summary: SessionSummary) => void;
}

/**
 * Ten milliseconds, so a note is confirmed within a tick of the fingers landing.
 * Anything slower and the green no longer reads as a response to what was done.
 */
const RESOLVE_INTERVAL_MS = 10;
const TAIL_BEATS = 1;

/**
 * Beats of silence past the chosen length that end a run.
 *
 * Beats rather than bars, so the wait is the same length of music whatever
 * the metre — a bar of 2/4 is half the patience of a bar of 4/4, and the
 * player feels beats going by rather than bar lines. Three is under two
 * seconds at an ordinary tempo: long enough that a breath or a fumbled entry
 * is not mistaken for leaving, short enough that putting the instrument down
 * ends the session while you are still putting it down.
 *
 * Silence alone is never enough — see `hasStopped`, which also asks whether
 * anything went past that actually needed a valve.
 */
const SILENT_BEATS_TO_STOP = 3;

/**
 * What the reference tone drops to past the chosen length, until the player
 * shows they mean to carry on.
 *
 * The music continuing into the grey is an offer, not an instruction, and an
 * offer should not be made at full volume. Playing on answers it and the
 * tone comes back up; playing nothing lets `SILENT_BEATS_TO_STOP` end the
 * run a moment later, so the quiet is also the sound of a session about to
 * finish.
 */
const GREY_VOLUME = 0.5;


export class Session {
  readonly transport: Transport;
  readonly input: ValveInput;
  readonly judgements: NoteJudgement[] = [];

  private readonly synth: Voice;
  private readonly metronome: Metronome;
  private readonly countInBeats: number;
  private resolveTimer: number | null = null;
  private nextNoteToSchedule = 0;
  private nextNoteToResolve = 0;
  /**
   * Beats of every note that cannot be played open, in order.
   *
   * The stop rule asks whether anything needing a valve went past unplayed,
   * and asks it a hundred times a second, so the question is answered by a
   * binary search of this rather than by walking the notes.
   */
  private readonly demandingBeats: number[];
  /** Where the player last had something down; -Infinity if they never have. */
  private lastHeldBeat = Number.NEGATIVE_INFINITY;
  /** Whether the reference tone has been dropped, and then answered. */
  private quietened = false;
  private carryingOn = false;
  /** Notes already confirmed as right, so each is announced only once. */
  private readonly noticed: boolean[];
  private finished = false;

  private readonly options: SessionOptions;

  constructor(options: SessionOptions) {
    this.options = options;
    this.noticed = new Array(options.exercise.notes.length).fill(false);
    const { context, exercise, tempo, countInBars } = options;
    // The exercise's own tempo events, so a step written on the page is a
    // step the clock actually takes; an empty list is the constant tempo.
    this.transport = new Transport(context, tempo, exercise.tempo);
    this.input = new ValveInput(() => context.currentTime);
    this.synth = options.brassVoice ?? new BrassSynth(context);
    this.metronome = new Metronome(context);
    // A count-in of whole bars, so it must be measured in the crotchets a bar
    // actually holds rather than in the numerator on the stave.
    this.countInBeats = countInBars * exercise.metre.barBeats;
    this.demandingBeats = exercise.notes
      .filter((note) => !note.acceptedMasks.includes(0))
      .map((note) => note.startBeat);
  }

  /** Transport beat at which the exercise ends. */
  get endBeat(): number {
    return this.options.exercise.totalBeats;
  }

  timeForNote(index: number): number {
    return this.transport.timeForBeat(this.options.exercise.notes[index].startBeat);
  }

  /**
   * How long a note sounds for, in seconds — the whole tie if it heads one.
   *
   * Asked of the transport rather than worked out from a tempo, so that a note
   * spanning a change of speed is measured rather than estimated.
   */
  private noteSeconds(index: number): number {
    const { notes } = this.options.exercise;
    const start = notes[index].startBeat;
    return this.transport.secondsBetween(start, start + tiedBeats(notes, index));
  }

  start(): void {
    // The voice is loaded once and reused across runs, so a session that
    // ended quietly in the grey must not hand the next one a quiet start.
    this.synth.setVolume(1);
    this.input.clearHistory();
    this.transport.start((from, to) => this.schedule(from, to), -this.countInBeats);
    this.noticed.fill(false);
    this.resolveTimer = window.setInterval(() => {
      // Confirming before resolving, so a note that comes right in the same tick
      // its window closes is confirmed rather than only judged.
      this.noticeCorrect();
      this.resolve();
    }, RESOLVE_INTERVAL_MS);
  }

  stop(): void {
    this.transport.stop();
    if (this.resolveTimer !== null) window.clearInterval(this.resolveTimer);
    this.resolveTimer = null;
    this.input.releaseAll();
  }

  /** Schedules everything falling in a beat window that has come into range. */
  private schedule(fromBeat: number, toBeat: number): void {
    const { exercise, metronomeEnabled, playbackMode } = this.options;

    if (metronomeEnabled) {
      /*
       * Clicks land on the pulse, not on the crotchet.
       *
       * The same thing in every metre the app currently offers, and the whole
       * difference in compound time: 6/8 is two clicks to a bar on the dotted
       * crotchets, not three on the crotchets — which is not where any of the
       * music is and not what anyone counts.
       */
      const { pulseBeats, pulsesPerBar } = exercise.metre;
      const firstPulse = Math.ceil(fromBeat / pulseBeats);
      for (let pulse = firstPulse; pulse * pulseBeats < toBeat; pulse++) {
        const beat = pulse * pulseBeats;
        if (beat > exercise.totalBeats) break;
        const positionInBar = ((pulse % pulsesPerBar) + pulsesPerBar) % pulsesPerBar;
        this.metronome.click(this.transport.timeForBeat(beat), positionInBar === 0);
      }
    }

    if (playbackMode === 'off') return;

    while (this.nextNoteToSchedule < exercise.notes.length) {
      const index = this.nextNoteToSchedule;
      const note = exercise.notes[index];
      if (note.startBeat >= toBeat) break;
      this.nextNoteToSchedule++;

      // The far end of a tie is already sounding, played by the note it is tied
      // from. Attacking it again is precisely what a tie says not to do.
      if (isTieContinuation(exercise.notes, index)) continue;

      const beats = tiedBeats(exercise.notes, index);
      this.synth.play(
        note.soundingMidi,
        this.transport.timeForBeat(note.startBeat),
        // Detached slightly so repeated notes articulate rather than slurring.
        this.transport.secondsBetween(note.startBeat, note.startBeat + beats) * 0.92,
      );
    }
  }

  /**
   * Announces notes the moment their fingering comes right.
   *
   * The same test the judge will apply, asked early and repeatedly rather than
   * once at the end: a note is right as soon as an accepted combination has
   * been held at any instant since its window opened. Asking every tick means
   * the answer arrives within a few milliseconds of the fingers, which is the
   * only thing that makes it read as confirmation of what was just played.
   *
   * Windows overlap at speed, so this scans forward rather than tracking a
   * single note — the note after next can come right before this one does.
   */
  private noticeCorrect(): void {
    const { exercise, context } = this.options;
    const now = context.currentTime;
    const scale = this.options.timingTolerance ?? 1;

    for (let index = this.nextNoteToResolve; index < exercise.notes.length; index++) {
      const note = exercise.notes[index];
      const onset = this.transport.timeForBeat(note.startBeat);
      const tolerance = toleranceFor(this.noteSeconds(index), scale);
      // Notes are in order, so once one is still to come, so is the rest.
      if (now < onset - tolerance) break;
      if (this.noticed[index]) continue;
      // Nothing happens at the far end of a tie, so there is nothing to
      // confirm; a green flash there would be applause for keeping still.
      if (isTieContinuation(exercise.notes, index)) continue;

      if (isAlreadyCorrect(note, onset, tolerance, this.input, now)) {
        this.noticed[index] = true;
        this.options.onCorrect?.(index);
      }
    }
  }

  /**
   * Resolves notes whose judging window has closed.
   *
   * Deliberately separate from scheduling: notes are scheduled ahead of time but
   * can only be judged after the fact, once the player has had their chance.
   */
  private resolve(): void {
    const { exercise, context } = this.options;
    const now = context.currentTime;

    while (this.nextNoteToResolve < exercise.notes.length) {
      const index = this.nextNoteToResolve;
      // The far end of a tie asked nothing of the player, so there is no
      // verdict to reach. Passed over rather than judged, which keeps it out of
      // the totals and out of the per-note accuracy that weak-note drilling
      // reads — a note marked right for being held is not evidence of anything.
      if (isTieContinuation(exercise.notes, index)) {
        this.nextNoteToResolve++;
        continue;
      }

      const note = exercise.notes[index];
      const seconds = this.noteSeconds(index);
      const onset = this.transport.timeForBeat(note.startBeat);
      const scale = this.options.timingTolerance ?? 1;
      const tolerance = toleranceFor(seconds, scale);
      if (now < onset + tolerance) break;

      const judgement = judgeNote(note, index, onset, seconds, this.input, scale);
      this.judgements.push(judgement);
      this.options.onJudgement?.(judgement);
      this.nextNoteToResolve++;
    }

    if (this.finished) return;

    this.offerTheGrey(now);

    /*
     * Stopped, or resting? Past the chosen length, a few beats of silence
     * with something that needed a valve going past in them ends the run.
     *
     * **Notes that can be played open prove nothing** and are ignored, along
     * with rests. With buttons, playing an open note and having put the
     * instrument down are the same input — the design doc says so outright —
     * so a stretch of music that never demands a valve cannot tell the two
     * apart, and asking it to was this rule's first and worst bug: it counted
     * such music as played, and since four bars in five contain an open note,
     * a player who had stopped was carried on regardless. Scales, every bar
     * of which has one, were never stopped at all.
     *
     * Wrong valves are playing, so fluffing and carrying on survives — the
     * evidence wanted is a valve down at some instant, not a correct answer.
     * The whole rule remains the simplest one that works, written to be
     * replaced by the microphone — which can simply hear that you have
     * stopped — rather than refined.
     */
    if (this.hasStopped(now)) {
      this.finished = true;
      this.stop();
      this.options.onFinish?.(summarise(exercise.notes, this.judgements));
      return;
    }

    const endTime = this.transport.timeForBeat(this.endBeat + TAIL_BEATS);
    if (this.nextNoteToResolve >= exercise.notes.length && now >= endTime) {
      this.finished = true;
      this.stop();
      this.options.onFinish?.(summarise(exercise.notes, this.judgements));
    }
  }

  /** Whether the exercise carries on past the length that was asked for. */
  private get hasHorizon(): boolean {
    const { exercise } = this.options;
    return exercise.chosenBeats < exercise.totalBeats;
  }

  /**
   * Drops the reference tone as the music passes into the grey, and brings it
   * back the moment the player answers by playing something.
   *
   * Once only: after the first answer the player has plainly decided, and a
   * tone that ducked at every block boundary would be nagging rather than
   * asking.
   */
  private offerTheGrey(now: number): void {
    if (!this.hasHorizon || this.carryingOn) return;
    const { exercise } = this.options;
    if (this.transport.beatForTime(now) < exercise.chosenBeats) return;

    if (!this.quietened) {
      this.synth.setVolume(GREY_VOLUME);
      this.quietened = true;
    }
    if (this.input.maskAt(now) !== 0) {
      this.synth.setVolume(1);
      this.carryingOn = true;
    }
  }

  private hasStopped(now: number): boolean {
    if (!this.hasHorizon) return false;
    const { exercise } = this.options;

    const beat = this.transport.beatForTime(now);
    // The paper's own end is the natural finish's business, not this rule's.
    if (beat <= exercise.chosenBeats || beat > exercise.totalBeats) return false;

    if (this.input.maskAt(now) !== 0) {
      this.lastHeldBeat = beat;
      return false;
    }

    // Silence is only counted from the chosen end: whatever happened inside
    // the length the player asked for, they asked for it.
    const since = Math.max(this.lastHeldBeat, exercise.chosenBeats);
    if (beat - since < SILENT_BEATS_TO_STOP) return false;
    return this.demandedAValve(since, beat);
  }

  /** Whether any note needing a valve falls in `[from, to)`. */
  private demandedAValve(from: number, to: number): boolean {
    const beats = this.demandingBeats;
    let low = 0;
    let high = beats.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (beats[mid] < from) low = mid + 1;
      else high = mid;
    }
    return low < beats.length && beats[low] < to;
  }
}
