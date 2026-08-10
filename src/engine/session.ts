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
 * Consecutive silent bars past the chosen length that end a run.
 *
 * Two rather than one, because a player who loses their place and drops out
 * to find it again is resting, not finished — and a brass player does
 * exactly that. At an ordinary tempo this is around five seconds of holding
 * nothing while the music goes past, which nobody does by accident.
 */
const SILENT_BARS_TO_STOP = 2;


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
  /** Bar the stop rule examines next; starts where the chosen length ends. */
  private nextStopBar: number;
  /** Consecutive bars that asked for a valve and got nothing. */
  private silentBars = 0;
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
    // With no horizon this sits past the paper and the rule never wakes.
    this.nextStopBar = Math.ceil(exercise.chosenBeats / exercise.metre.barBeats - 1e-9);
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

    /*
     * Stopped, or resting? Past the chosen length, consecutive bars that ask
     * for a valve and get nothing end the run.
     *
     * **A bar every note of which could be played open proves nothing** and is
     * passed over, exactly like a bar of rests. With buttons, playing an open
     * note and having put the instrument down are the same input — the design
     * doc says so outright — so a bar that never demands a valve cannot tell
     * the two apart, and asking it to was this rule's first and worst bug: it
     * credited such a bar as played, and since four bars in five contain an
     * open note, a player who stopped was carried on for bar after bar.
     * Scales, every bar of which has one, were never stopped at all.
     *
     * Wrong valves are playing, so fluffing and carrying on survives — the
     * evidence wanted is a valve down at some instant, not a correct answer.
     * The whole rule remains the simplest one that works, written to be
     * replaced by the microphone — which can simply hear that you have
     * stopped — rather than refined.
     */
    if (this.stoppedPlaying(now)) {
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

  private stoppedPlaying(now: number): boolean {
    const { exercise } = this.options;
    const { barBeats } = exercise.metre;

    for (;;) {
      const barStart = this.nextStopBar * barBeats;
      const barEnd = barStart + barBeats;
      // The paper's own end is the natural finish's business, not this rule's.
      if (barEnd > exercise.totalBeats + 1e-9) return false;
      if (now < this.transport.timeForBeat(barEnd)) return false;

      const inBar = (beat: number) => beat >= barStart - 1e-9 && beat < barEnd - 1e-9;
      // Only a note that cannot be played open asks a question silence can
      // answer. Bars of rests, and bars a bugle could play, are transparent:
      // they neither end a run nor forgive one.
      const demanding = exercise.notes.some(
        (note) => inBar(note.startBeat) && !note.acceptedMasks.includes(0),
      );
      if (demanding) {
        const touched = this.input
          .statesDuring(this.transport.timeForBeat(barStart), this.transport.timeForBeat(barEnd))
          .some((state) => state.mask !== 0);
        this.silentBars = touched ? 0 : this.silentBars + 1;
        if (this.silentBars >= SILENT_BARS_TO_STOP) return true;
      }
      this.nextStopBar++;
    }
  }
}
