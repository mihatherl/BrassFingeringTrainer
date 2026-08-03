/**
 * Session orchestration: ties the transport, synth, metronome, input and judge
 * together for one run through an exercise.
 *
 * The count-in occupies negative beats, so exercise beat 0 is the first note and
 * every other part of the app can use the exercise's own beat numbers without
 * an offset to remember.
 */

import type { Exercise } from '../exercise/types';
import { durationBeats } from '../domain/rhythm';
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
  /** Notes already confirmed as right, so each is announced only once. */
  private readonly noticed: boolean[];
  private finished = false;

  private readonly options: SessionOptions;

  constructor(options: SessionOptions) {
    this.options = options;
    this.noticed = new Array(options.exercise.notes.length).fill(false);
    const { context, exercise, tempo, countInBars } = options;
    this.transport = new Transport(context, tempo);
    this.input = new ValveInput(() => context.currentTime);
    this.synth = options.brassVoice ?? new BrassSynth(context);
    this.metronome = new Metronome(context);
    this.countInBeats = countInBars * exercise.beatsPerBar;
  }

  get secondsPerBeat(): number {
    return this.transport.secondsPerBeat;
  }

  /** Transport beat at which the exercise ends. */
  get endBeat(): number {
    return this.options.exercise.totalBeats;
  }

  timeForNote(index: number): number {
    return this.transport.timeForBeat(this.options.exercise.notes[index].startBeat);
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
      const firstClick = Math.ceil(fromBeat);
      for (let beat = firstClick; beat < toBeat; beat++) {
        if (beat > exercise.totalBeats) break;
        const positionInBar = ((beat % exercise.beatsPerBar) + exercise.beatsPerBar) % exercise.beatsPerBar;
        this.metronome.click(this.transport.timeForBeat(beat), positionInBar === 0);
      }
    }

    if (playbackMode === 'off') return;

    while (this.nextNoteToSchedule < exercise.notes.length) {
      const note = exercise.notes[this.nextNoteToSchedule];
      if (note.startBeat >= toBeat) break;
      const beats = durationBeats(note.duration);
      this.synth.play(
        note.soundingMidi,
        this.transport.timeForBeat(note.startBeat),
        // Detached slightly so repeated notes articulate rather than slurring.
        beats * this.transport.secondsPerBeat * 0.92,
      );
      this.nextNoteToSchedule++;
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
      const tolerance = toleranceFor(
        durationBeats(note.duration),
        this.transport.secondsPerBeat,
        scale,
      );
      // Notes are in order, so once one is still to come, so is the rest.
      if (now < onset - tolerance) break;
      if (this.noticed[index]) continue;

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
      const note = exercise.notes[index];
      const beats = durationBeats(note.duration);
      const onset = this.transport.timeForBeat(note.startBeat);
      const scale = this.options.timingTolerance ?? 1;
      const tolerance = toleranceFor(beats, this.transport.secondsPerBeat, scale);
      if (now < onset + tolerance) break;

      const judgement = judgeNote(
        note,
        index,
        onset,
        beats,
        this.transport.secondsPerBeat,
        this.input,
        scale,
      );
      this.judgements.push(judgement);
      this.options.onJudgement?.(judgement);
      this.nextNoteToResolve++;
    }

    if (this.finished) return;
    const endTime = this.transport.timeForBeat(this.endBeat + TAIL_BEATS);
    if (this.nextNoteToResolve >= exercise.notes.length && now >= endTime) {
      this.finished = true;
      this.stop();
      this.options.onFinish?.(summarise(exercise.notes, this.judgements));
    }
  }
}
