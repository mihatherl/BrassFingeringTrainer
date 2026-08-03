/**
 * Session orchestration: ties the transport, synth, metronome, input and judge
 * together for one run through an exercise.
 *
 * The count-in occupies negative beats, so exercise beat 0 is the first note and
 * every other part of the app can use the exercise's own beat numbers without
 * an offset to remember.
 */

import type { Exercise, NoteEvent } from '../exercise/types';
import { durationBeats } from '../domain/rhythm';
import { soundedPitch } from '../domain/fingering';
import { instrumentById, middleSounding, type Instrument } from '../domain/instruments';
import { restTarget } from './rest-voicing';
import { playerShouldSound } from './sounding';
import { BrassSynth } from '../audio/synth';
import { PadSynth } from '../audio/pad';
import type { Voice } from '../audio/sampler';
import { Metronome } from '../audio/metronome';
import { Transport } from './clock';
import { ValveInput } from './input';
import { IdleDetector } from './idle';
import { SettledMask } from './settled-mask';
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
 * `fingered` puts the written notes on a soft pad underneath and gives the brass
 * tone to the player instead, sounding whatever their valves are actually
 * saying, so a wrong fingering is heard as a wrong note rather than merely
 * marked as one afterwards.
 */
export type PlaybackMode = 'off' | 'reference' | 'fingered';

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
  /** Level of the reference tone, where 1 is the default. */
  backingLevel?: number;
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
 * Ten milliseconds, because this loop also decides when the player's own note
 * sounds — and unlike the written notes, that cannot be scheduled in advance.
 */
const RESOLVE_INTERVAL_MS = 10;
const TAIL_BEATS = 1;


/** A silence between two notes, long enough to be worth sounding through. */
interface Gap {
  startBeat: number;
  endBeat: number;
  /** Index of the note before, or -1 before the first note. */
  previousIndex: number;
  /** Index of the note after, or -1 after the last. */
  nextIndex: number;
}

/** Shortest silence worth treating as a rest rather than note articulation. */
const MIN_GAP_BEATS = 0.05;

/**
 * How long a single fingering keeps sounding before it gives up.
 *
 * There is no way to tell a player holding valves and blowing from one holding
 * valves and doing nothing, so a note that nothing displaces has to fade of its
 * own accord rather than drone for the rest of the exercise.
 */
const SUSTAIN_BEATS = 4;
const MAX_SUSTAIN_SECONDS = 3;

/**
 * Where the written notes leave silence.
 *
 * Derived from the notes themselves rather than from the rest events, because
 * what matters here is when nothing is sounding — which includes the tail of a
 * detached note as much as a written rest.
 */
function findGaps(exercise: Exercise): Gap[] {
  const gaps: Gap[] = [];
  const { notes, totalBeats } = exercise;

  if (notes.length === 0) return gaps;
  if (notes[0].startBeat > MIN_GAP_BEATS) {
    gaps.push({ startBeat: 0, endBeat: notes[0].startBeat, previousIndex: -1, nextIndex: 0 });
  }

  for (let i = 0; i < notes.length; i++) {
    const end = notes[i].startBeat + durationBeats(notes[i].duration);
    const nextStart = i + 1 < notes.length ? notes[i + 1].startBeat : totalBeats;
    if (nextStart - end > MIN_GAP_BEATS) {
      gaps.push({
        startBeat: end,
        endBeat: nextStart,
        previousIndex: i,
        nextIndex: i + 1 < notes.length ? i + 1 : -1,
      });
    }
  }
  return gaps;
}

export class Session {
  readonly transport: Transport;
  readonly input: ValveInput;
  readonly judgements: NoteJudgement[] = [];

  private readonly synth: Voice;
  private readonly pad: PadSynth;
  private readonly metronome: Metronome;
  private readonly instrument: Instrument;
  private readonly idle = new IdleDetector();
  private readonly settledMask = new SettledMask();
  private readonly countInBeats: number;
  private resolveTimer: number | null = null;
  private nextNoteToSchedule = 0;
  private nextNoteToVoice = 0;
  private nextNoteToResolve = 0;
  /** Notes already confirmed as right, so each is announced only once. */
  private readonly noticed: boolean[];
  private finished = false;

  private readonly options: SessionOptions;
  /** Silences between notes, where the player may still be making a sound. */
  private readonly gaps: Gap[];
  /** Last fingering actually sounded, for spotting a change. */
  private voicedMask = 0;
  /** Fingering held at the previous note, which is what "carrying over" means. */
  private maskAtLastNote = 0;
  private hasSounded = false;
  private isSounding = false;

  constructor(options: SessionOptions) {
    this.options = options;
    this.gaps = findGaps(options.exercise);
    this.noticed = new Array(options.exercise.notes.length).fill(false);
    const { context, exercise, tempo, countInBars } = options;
    this.transport = new Transport(context, tempo);
    this.input = new ValveInput(() => context.currentTime);
    this.synth = options.brassVoice ?? new BrassSynth(context);
    this.pad = new PadSynth(context);
    this.pad.setVolume(options.backingLevel ?? 1);
    this.metronome = new Metronome(context);
    this.instrument = instrumentById(exercise.instrumentId);
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
    this.idle.reset();
    this.settledMask.reset();
    this.transport.start((from, to) => this.schedule(from, to), -this.countInBeats);
    this.noticed.fill(false);
    this.resolveTimer = window.setInterval(() => {
      this.voice();
      // Before resolving, so a note that comes right in the same tick its
      // window closes is still confirmed rather than only judged.
      this.noticeCorrect();
      this.resolve();
    }, RESOLVE_INTERVAL_MS);
  }

  stop(): void {
    this.transport.stop();
    if (this.resolveTimer !== null) window.clearInterval(this.resolveTimer);
    this.resolveTimer = null;
    this.input.releaseAll();
    // Otherwise a fingering still held when the run ends carries on sounding.
    this.isSounding = true;
    this.silence();
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

    // The written notes are known in advance, so they are scheduled ahead in the
    // usual way. In `fingered` mode they move to the pad and the brass is left
    // for the player — see `voice`.
    const voice = playbackMode === 'fingered' ? this.pad : this.synth;

    while (this.nextNoteToSchedule < exercise.notes.length) {
      const note = exercise.notes[this.nextNoteToSchedule];
      if (note.startBeat >= toBeat) break;
      const beats = durationBeats(note.duration);
      voice.play(
        note.soundingMidi,
        this.transport.timeForBeat(note.startBeat),
        // Detached slightly so repeated notes articulate rather than slurring.
        beats * this.transport.secondsPerBeat * 0.92,
      );
      this.nextNoteToSchedule++;
    }
  }

  /**
   * Sounds the player's own note, following their fingers.
   *
   * Sampling the valves at a fixed moment near each note's onset does not work,
   * and cannot be made to work by choosing a better moment. A player reads the
   * note, then moves — a fifth of a second later at best — so at any instant
   * near the beat the valves still hold the *previous* note's fingering. Sound
   * it and every note comes out one behind, which is inaudible on the way up a
   * scale and unmistakable on the way back down.
   *
   * A real instrument has no such problem because nothing samples anything: the
   * pitch changes when the valves do. So this does the same. The beat decides
   * what the player is *aiming* at, and therefore which note of the harmonic
   * column their fingering picks out — but never when they hear it.
   */
  private voice(): void {
    if (this.options.playbackMode !== 'fingered') return;
    const { exercise, context } = this.options;
    const now = context.currentTime;
    const beat = this.transport.currentBeat();
    // Settled rather than live: mid-release a hand briefly reads as a fingering
    // nobody chose, and sounding those is worse than being 35ms late.
    const mask = this.settledMask.update(this.input.mask, now);

    // Track note onsets purely for bookkeeping: what counts as "carrying over"
    // into a rest, and whether anyone appears to be playing at all.
    let reachedNote = false;
    while (this.nextNoteToVoice < exercise.notes.length) {
      const note = exercise.notes[this.nextNoteToVoice];
      if (this.transport.timeForBeat(note.startBeat) > now) break;

      this.idle.observe(mask, note.acceptedMasks.includes(0));
      this.maskAtLastNote = mask;
      this.nextNoteToVoice++;
      reachedNote = true;
    }

    // Asked every tick, not only when the fingering changes: lifting the fingers
    // and leaving them lifted is not a change, and nor is the music running out.
    const note = this.noteAt(beat);
    const target = note ? note.soundingMidi : this.restTargetAt(beat, mask);
    const shouldSound =
      target !== null &&
      playerShouldSound({
        beat,
        totalBeats: exercise.totalBeats,
        target,
        mask,
        openIsCorrect: note?.acceptedMasks.includes(0) ?? false,
        idle: this.idle.isIdle,
      });

    if (!shouldSound) {
      this.silence(now);
      this.voicedMask = mask;
      return;
    }

    // Articulate on a change of fingering, and once at the first note so that a
    // fingering set during the count-in is heard at all.
    const firstNote = reachedNote && !this.hasSounded;
    if (mask === this.voicedMask && !firstNote) return;

    this.voicedMask = mask;
    this.silence(now);
    this.synth.play(
      soundedPitch(mask, target, this.instrument),
      now,
      Math.min(SUSTAIN_BEATS * this.transport.secondsPerBeat, MAX_SUSTAIN_SECONDS),
    );
    this.hasSounded = true;
    this.isSounding = true;
  }

  /** Cuts the player's note, if one is sounding. */
  private silence(now?: number): void {
    if (!this.isSounding) return;
    this.isSounding = false;
    this.synth.stop(now);
  }

  /** The written note sounding at a given beat, if any. */
  private noteAt(beat: number): NoteEvent | null {
    const { notes } = this.options.exercise;
    for (let i = this.nextNoteToVoice - 1; i >= 0 && i >= this.nextNoteToVoice - 2; i--) {
      const note = notes[i];
      if (beat >= note.startBeat && beat < note.startBeat + durationBeats(note.duration)) {
        return note;
      }
    }
    return null;
  }

  /**
   * What the player is aiming at during a silence, where there is no written
   * note to resolve their fingering against.
   */
  private restTargetAt(beat: number, mask: number): number | null {
    const { notes, clef } = this.options.exercise;

    const gap = this.gaps.find((g) => beat >= g.startBeat && beat < g.endBeat);
    if (!gap) return null;

    const previous = gap.previousIndex >= 0 ? notes[gap.previousIndex] : null;
    const next = gap.nextIndex >= 0 ? notes[gap.nextIndex] : null;
    return restTarget({
      mask,
      previousMask: this.maskAtLastNote,
      previousTarget: previous?.soundingMidi ?? null,
      nextAccepted: next?.acceptedMasks ?? [],
      nextTarget: next?.soundingMidi ?? null,
      middleTarget: middleSounding(this.instrument, clef),
    });
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
