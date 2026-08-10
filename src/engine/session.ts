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
  /**
   * Raised when the music is about to run out and the player may ask for
   * more, and again when the offer is taken up or has passed.
   *
   * The screen turns this into a button; the session does not care how it is
   * answered, only that `continuePlaying` is called before the music ends.
   */
  onOffer?: (offering: boolean) => void;
}

/**
 * Ten milliseconds, so a note is confirmed within a tick of the fingers landing.
 * Anything slower and the green no longer reads as a response to what was done.
 */
const RESOLVE_INTERVAL_MS = 10;
const TAIL_BEATS = 1;

/**
 * How long before the music runs out the player is asked whether to carry on.
 *
 * Beats rather than bars, so the offer is the same length of music whatever
 * the metre. Four is a bar of four-four — long enough to notice a button
 * change colour and reach it while playing, short enough that the question
 * is plainly about the ending that is arriving rather than a standing
 * invitation.
 *
 * **Nothing is inferred from whether the player is playing.** An earlier
 * design read silence as leaving and sound as staying, and it could not be
 * made honest: with buttons, an open note and an abandoned instrument are
 * the same input, and even fixed it made a decision on the player's behalf
 * from evidence that never meant what it appeared to. Carrying on is now a
 * thing a player *asks* for.
 */
const OFFER_BEATS = 4;

/**
 * What the reference tone drops to while the offer stands.
 *
 * The continuation is an offer, and an offer should not be made at full
 * volume. Accepting brings the tone straight back; letting it pass lets the
 * music end, so the quiet is also the sound of a run about to finish.
 */
const OFFER_VOLUME = 0.5;

/**
 * How far past the committed end the music keeps going while it waits to
 * hear whether the player is coming with it.
 *
 * Carrying on *is* the answer, and always was the natural one: a player in
 * the middle of a phrase should not have to take a hand off the instrument
 * to say they have not finished. So the music does not stop dead at the
 * boundary — it plays on into the grey for a few beats, and a valve going
 * down in that stretch takes the offer exactly as the button does.
 *
 * What the first attempt at this got wrong was reading *silence* as leaving:
 * with buttons an open note and an abandoned instrument are the same input,
 * so nothing could be concluded. Reading *playing* as staying has no such
 * problem — a valve down is unambiguous — and the generator keeps open
 * notes out of this stretch so there is always a valve to put down. See
 * `VALVED_BEATS` in `generate.ts`.
 */
const GRACE_BEATS = 4;


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
   * The beat this run is committed to play until.
   *
   * The length the player chose, extended a block at a time by
   * `continuePlaying`. Everything downstream reads it rather than the length
   * of the paper: the music past it is generated, drawn grey, and will only
   * ever be played if it is asked for.
   */
  private playUntil: number;
  /** Whether the offer is currently standing, so it is made only once. */
  private offering = false;
  /** Notes already confirmed as right, so each is announced only once. */
  private readonly noticed: boolean[];
  private finished = false;

  private readonly options: SessionOptions;

  constructor(options: SessionOptions) {
    this.options = options;
    this.noticed = new Array(options.exercise.notes.length).fill(false);
    const { context, exercise, tempo, countInBars } = options;
    // The exercise's own tempo events, so a step written on the page is a
    // step the clock actually takes; an empty list is the constant tempo. The
    // metre's pulse is what turns the player's beat into crotchets — in 6/8
    // the number they set is dotted crotchets, and 1.5 crotchets is what one
    // of those lasts.
    this.transport = new Transport(context, tempo, exercise.tempo, exercise.metre.pulseBeats);
    this.input = new ValveInput(() => context.currentTime);
    this.synth = options.brassVoice ?? new BrassSynth(context);
    this.metronome = new Metronome(context);
    // A count-in of whole bars, so it must be measured in the crotchets a bar
    // actually holds rather than in the numerator on the stave.
    this.countInBeats = countInBars * exercise.metre.barBeats;
    this.playUntil = exercise.chosenBeats;
  }

  /** Transport beat at which this run ends, unless the player asks for more. */
  get endBeat(): number {
    return this.playUntil;
  }

  /** Whether there is more paper to be had beyond what is committed. */
  get canContinue(): boolean {
    return this.playUntil < this.options.exercise.totalBeats - 1e-9;
  }

  /**
   * How far the music actually sounds: the committed end, plus the grace the
   * offer is open for. Nothing past it is scheduled, drawn white or judged.
   */
  private get soundUntil(): number {
    const { exercise } = this.options;
    return this.canContinue
      ? Math.min(exercise.totalBeats, this.playUntil + GRACE_BEATS)
      : this.playUntil;
  }

  /**
   * Takes up the offer: another block of music, the same length as the one
   * the player chose, clamped to what was generated.
   *
   * Safe to call at any time and more than once — a second press inside one
   * offer window buys one block, not two, because the offer is withdrawn as
   * soon as it is accepted.
   */
  /**
   * Ends the run here and reports what was played.
   *
   * What the Stop button does. Everything judged so far counts; the notes
   * that were never reached are simply not in the summary, exactly as when a
   * run reaches its committed end.
   */
  finishNow(): void {
    this.finish();
  }

  continuePlaying(): void {
    if (!this.offering || !this.canContinue) return;
    const { exercise } = this.options;
    this.playUntil = Math.min(
      exercise.totalBeats,
      this.playUntil + Math.max(exercise.chosenBeats, 1),
    );
    this.offering = false;
    this.synth.setVolume(1);
    this.options.onOffer?.(false);
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
    // ended on an unanswered offer must not hand the next one a quiet start.
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
        if (beat > this.soundUntil) break;
        const positionInBar = ((pulse % pulsesPerBar) + pulsesPerBar) % pulsesPerBar;
        this.metronome.click(this.transport.timeForBeat(beat), positionInBar === 0);
      }
    }

    if (playbackMode === 'off') return;

    while (this.nextNoteToSchedule < exercise.notes.length) {
      const index = this.nextNoteToSchedule;
      const note = exercise.notes[index];
      if (note.startBeat >= toBeat) break;
      // Never sound music that has not been offered. The pointer stays put
      // rather than advancing, so accepting the offer picks the rest up on
      // the next pass instead of losing them.
      if (note.startBeat >= this.soundUntil - 1e-9) break;
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

    this.makeTheOffer(now);
    this.hearThePlayerOn(now);

    /*
     * The run ends where the offer runs out, not where the paper does.
     *
     * Everything this side of it has been judged and its tail has rung, so
     * there is nothing left to wait for. What was played past the committed
     * end and never taken up is dropped rather than scored — see `finish`.
     */
    const endTime = this.transport.timeForBeat(this.soundUntil + TAIL_BEATS);
    const next = exercise.notes[this.nextNoteToResolve];
    const allJudged = next === undefined || next.startBeat >= this.soundUntil - 1e-9;
    if (allJudged && now >= endTime) this.finish();
  }

  /**
   * Takes the offer on the player's behalf when they simply carry on.
   *
   * A valve down past the committed end says everything the button says, and
   * says it without taking a hand off the instrument. Only past the end:
   * inside the music they asked for, playing means playing, and reading it as
   * a request for more would make the length setting impossible to obey.
   */
  private hearThePlayerOn(now: number): void {
    if (!this.offering || !this.canContinue) return;
    if (this.transport.beatForTime(now) < this.playUntil) return;
    if (this.input.maskAt(now) === 0) return;
    this.continuePlaying();
  }

  /**
   * Ends the run, scoring what was asked for and no more.
   *
   * Notes past the committed end were on offer rather than set: they sounded,
   * they were drawn grey, and if the offer was let pass then the player never
   * agreed to play them. Scoring them would mean a run ended by declining
   * more music was punished for declining it.
   */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stop();

    const { exercise } = this.options;
    const asked = this.judgements.filter(
      (j) => exercise.notes[j.noteIndex].startBeat < this.playUntil - 1e-9,
    );
    this.options.onFinish?.(summarise(exercise.notes, asked));
  }

  /**
   * Asks, a few beats before the music runs out, whether the player wants
   * more — and drops the reference tone while the question stands.
   *
   * Made once per committed end: accepting withdraws it and moves the end on,
   * so the next block asks again in its own last beats. Nothing here reads
   * what the player is doing; the offer is answered by a button or not at all.
   */
  private makeTheOffer(now: number): void {
    if (this.offering || !this.canContinue) return;
    if (this.transport.beatForTime(now) < this.playUntil - OFFER_BEATS) return;

    this.offering = true;
    this.synth.setVolume(OFFER_VOLUME);
    this.options.onOffer?.(true);
  }
}
