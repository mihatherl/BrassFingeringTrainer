/**
 * Session orchestration: ties the transport, synth, metronome, input and judge
 * together for one run through an exercise.
 *
 * The count-in occupies negative beats, so exercise beat 0 is the first note and
 * every other part of the app can use the exercise's own beat numbers without
 * an offset to remember.
 */

import { isUnplayable, type Exercise } from '../exercise/types';
import { barLineAtOrAfter, rekeyFrom, type Rekeyed } from '../exercise/rekey';
import { isTieContinuation, tiedBeats } from '../exercise/ties';
import { BrassSynth } from '../audio/synth';
import type { Voice } from '../audio/sampler';
import { Metronome } from '../audio/metronome';
import { barAt, beatOfBar, metreAt, type Metre } from '../domain/metre';
import { Transport } from './clock';
import type { PlayerInput } from './player-input';
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
  /**
   * What the player is playing with.
   *
   * The buttons today — a `ValveInput`, made by whoever is showing them, since
   * they are pressed by the screen and read by the session. Anything answering
   * `PlayerInput` will do, which is the point: a microphone is a new input and
   * nothing else, and everything in this file is written to be the "everything
   * else". See `player-input.ts`.
   */
  input: PlayerInput;
  tempo: number;
  countInBars: number;
  metronomeEnabled: boolean;
  /**
   * Asked of each bar's metre when the metronome is off: does the beat still
   * need sounding here?
   *
   * The conductor withdraws where it has no taught pattern for the metre — an
   * imported bar of five, most likely — and its own documentation assumes the
   * metronome carries on. It does not, unless the player has it switched on,
   * and then there is nothing at all saying where the beat is for exactly the
   * bar that is hardest to count. So the caller is asked, per bar.
   *
   * A predicate rather than a `conductorEnabled` flag because which metres the
   * conductor can beat is the conductor's business, and `engine/` reaches only
   * into `audio/`, `domain/` and `exercise/`. Passing the question out keeps it
   * that way.
   */
  needsBeatSounded?: (metre: Metre) => boolean;
  playbackMode: PlaybackMode;
  /**
   * The recorded brass voice, once loaded. Absent falls back to synthesis, so a
   * failed or slow download costs quality rather than a working exercise.
   */
  brassVoice?: Voice;
  /** Multiplies the judging window, where 1 is the default. */
  timingTolerance?: number;
  /**
   * How early to hand every sound to the audio thread, in seconds, so it is
   * heard when the clock says. The output device's latency, calibrated by the
   * player; zero for the phone's own speaker. See `Transport.audioLead`.
   */
  audioLead?: number;
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
   * Raised when the run jumps backwards, with the first note index that is now
   * unplayed again.
   *
   * Everything from there on has been taken out of the score and will be
   * judged afresh, so whatever is showing verdicts has to let go of them too.
   */
  onRewind?: (fromNoteIndex: number) => void;
  /**
   * Raised when the music is about to run out and the player may ask for
   * more, and again when the offer is taken up or has passed.
   *
   * The screen turns this into a button; the session does not care how it is
   * answered, only that `continuePlaying` is called before the music ends.
   */
  onOffer?: (offering: boolean) => void;
  /**
   * Raised when the player has changed key mid-run, with what the splice did.
   *
   * Everything holding a copy of the paper by note index has to let go of it
   * from `fromNoteIndex` on — the colours on the screen, the hints — for the
   * same reason `onRewind` exists. The difference is that a rewind puts notes
   * back to unplayed and this replaces them outright.
   */
  onKeyChange?: (change: Rekeyed) => void;
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
 * What the reference tone drops to while the fingering is wrong.
 *
 * The tone follows the fingers: full while the player holds a fingering that
 * answers the note sounding — an open note only from a player who has been
 * playing, see `ValveInput.answers` — and half otherwise. So the tone is heard
 * to agree with the hands rather than sail on regardless, and a run played
 * by nobody is heard at half volume throughout. Asked every tick of the
 * resolve loop, so it answers within a hundredth of a second of the fingers.
 */
const WRONG_FINGERING_VOLUME = 0.5;

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

/**
 * How much warning a player gets of a key change they asked for, in bars.
 *
 * A key signature has to be read before the bar it governs is played, and one
 * bar is the least that leaves time to take it in while playing the bar before.
 * The change then lands on the *next* bar line past that, so the warning is
 * between one and two bars depending on where in a bar the dial was let go.
 *
 * It is a floor on top of the scheduling horizon rather than instead of it:
 * the horizon is what makes the change *possible* — nothing already handed to
 * the audio thread can be rewritten — and this is what makes it *readable*.
 */
const KEY_CHANGE_LEAD_BARS = 1;


export class Session {
  readonly transport: Transport;
  /**
   * Private, and worth keeping so: the input is made and driven by whoever is
   * showing it — the play screen presses the buttons it drew — and the session
   * only ever asks it questions. Nothing reaches through a session to get at
   * the thing the player is playing with.
   */
  private readonly input: PlayerInput;
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
  /** Whether the fingers answer the note sounding now; see `followFingers`. */
  private fingersRight = true;
  /** The note whose sound the fingers are held against, scanned forward. */
  private soundingIndex = 0;
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
    //
    // The *opening* metre, and only it: the transport is told the conversion
    // once, at construction. A part that changes metre changes what one of the
    // player's beats lasts, and this is the place that would have to learn to
    // follow it — recorded in `musicxml-import-plan.md` rather than guessed at
    // here, since nothing generates such an exercise yet.
    const opening = metreAt(exercise.metres, 0);
    this.transport = new Transport(
      context,
      tempo,
      exercise.tempo,
      opening.pulseBeats,
      options.audioLead ?? 0,
    );
    this.input = options.input;
    // The fingers are answered the instant they move, not at the next tick:
    // ten milliseconds is a tenth of what a player can feel, but a change of
    // sound that waits for it is a change of sound that waits.
    this.input.subscribe(() => {
      if (this.transport.isRunning && !this.finished) this.followFingers(context.currentTime);
    });
    this.synth = options.brassVoice ?? new BrassSynth(context);
    this.metronome = new Metronome(context);
    // A count-in of whole bars, so it must be measured in the crotchets a bar
    // actually holds rather than in the numerator on the stave.
    this.countInBeats = countInBars * opening.barBeats;
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
   * Ends the run here and reports what was played.
   *
   * What the Stop button does. Everything judged so far counts; the notes
   * that were never reached are simply not in the summary, exactly as when a
   * run reaches its committed end.
   */
  finishNow(): void {
    this.finish();
  }

  /**
   * Takes up the offer: another block of music, the same length as the one
   * the player chose, clamped to what was generated.
   *
   * Safe to call at any time and more than once — a second press inside one
   * offer window buys one block, not two, because the offer is withdrawn as
   * soon as it is accepted.
   */
  continuePlaying(): void {
    if (!this.offering || !this.canContinue) return;
    const { exercise } = this.options;
    this.playUntil = Math.min(
      exercise.totalBeats,
      this.playUntil + Math.max(exercise.chosenBeats, 1),
    );
    this.withdrawTheOffer();
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
    this.fingersRight = true;
    this.soundingIndex = 0;
    this.applyVolume();
    this.synth.follow?.(true);
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
    this.input.release();
  }

  get isPaused(): boolean {
    return this.transport.pausedAt !== null;
  }

  /**
   * Stops the run where it stands, keeping everything it has done.
   *
   * The clock freezes, so nothing is scheduled, nothing is judged and the
   * notation stays where the player left it. What is already committed to the
   * audio thread — the scheduling horizon is a seventh of a second — is not
   * recallable, so the sounding note is cut and a click may still land.
   */
  pause(): void {
    if (this.finished || this.isPaused) return;
    this.transport.pause();
    if (this.resolveTimer !== null) window.clearInterval(this.resolveTimer);
    this.resolveTimer = null;
    this.synth.stop();
    this.input.release();
  }

  /** Picks the run up where it was paused, a bar of counting in first. */
  resume(): void {
    if (this.finished || !this.isPaused) return;
    this.restartAt(this.transport.pausedAt ?? 0);
  }

  /**
   * Goes back this many bars and plays from there, counted in.
   *
   * From the top of the bar the player is in: "back one" from the middle of
   * bar six is the top of bar five, which is the bar of music before where
   * they are, rather than the fraction of bar six they happen to have left.
   *
   * Asking for more bars than there are behind you takes you to the start of
   * the piece, and pressing it there restarts from the top with a fresh bar of
   * counting in. The buttons are always live and deliberately so: there is
   * nothing to warn a player off, and "back to the beginning" is a perfectly
   * ordinary thing to want from ◀5. A `canRewind` getter written to grey them
   * out was carried unused for a release and has been deleted.
   */
  rewind(bars: number): void {
    if (this.finished) return;
    const { metres } = this.options.exercise;
    const here = this.transport.pausedAt ?? this.transport.currentBeat();
    const bar = Math.max(0, barAt(metres, Math.max(0, here)) - bars);
    const beat = beatOfBar(metres, bar);

    if (this.isPaused) {
      // Paused, a rewind moves where the run will pick up from — and moves the
      // notation with it, so the player can see where they are about to come in.
      this.unplay(beat);
      this.transport.seekTo(beat);
      return;
    }
    this.restartAt(beat);
  }

  /**
   * The bar line a key change asked for now would land on.
   *
   * Past the scheduling horizon so nothing already sounding can be rewritten,
   * then a bar of reading room, then up to the next bar line. Public so the
   * screen can show the player where the change is going to happen before they
   * let go of the dial.
   *
   * During the count-in this is beat 0 — the whole exercise. Turning the dial
   * before playing a note changes the key of the lot, which is what a player
   * doing it at that moment means by it.
   */
  get keyChangeBeat(): number {
    const { exercise } = this.options;
    const here = this.transport.pausedAt ?? this.transport.currentBeat();
    const ahead = Math.max(here, this.transport.committedBeat);
    const { barBeats } = metreAt(exercise.metres, Math.max(0, ahead));
    return barLineAtOrAfter(exercise, ahead + KEY_CHANGE_LEAD_BARS * barBeats);
  }

  /**
   * Rewrites the paper from `keyChangeBeat` on, in the key of `fresh`.
   *
   * `fresh` is a whole exercise the generator would have made from the same
   * settings in the new key; only its tail is taken. Nothing is generated here
   * — the session knows when a change may land and nothing about how music is
   * written.
   *
   * **Why the note indices below the splice are safe.** The splice point is
   * derived from the transport's own committed beat in the line above, so every
   * note at or past it is one the audio thread has never been told about and the
   * player has certainly not been judged on. `judgements`, `noticed` and the
   * screen's verdicts are all indexed into `notes`, and every entry any of them
   * holds names a note below the splice. Nothing has to be re-indexed; only the
   * space above the splice is new, and it is new in every sense.
   *
   * Returns null and changes nothing where the key is already what was asked
   * for, where the change would land past the end of the paper, or where the
   * material is not the kind that can be re-keyed at all — see `canRekey`.
   */
  changeKey(fresh: Exercise): Rekeyed | null {
    if (this.finished) return null;

    const spliced = rekeyFrom(this.options.exercise, fresh, this.keyChangeBeat);
    if (!spliced) return null;

    /*
     * The confirmations, resized with the paper.
     *
     * A note is only confirmed once, and the array saying so is as long as the
     * note list — which has just changed length, since a bar of quavers in one
     * key may be a bar of crotchets in another. The tail is unconfirmed by
     * definition: it is music nobody has seen yet.
     */
    const { notes } = this.options.exercise;
    this.noticed.length = notes.length;
    for (let i = spliced.fromNoteIndex; i < this.noticed.length; i++) this.noticed[i] = false;

    this.options.onKeyChange?.(spliced);
    return spliced;
  }

  /**
   * Starts playing again from a beat, after one bar of counting in.
   *
   * The count-in is the same device the run opens with — the transport starts a
   * bar early and the scheduler is pointed at the first note that is actually
   * wanted, so the bar before it clicks but neither sounds nor judges. Which
   * means the count-in is the real bar before, in its real metrical positions,
   * rather than four anonymous beats: the player hears where "one" is.
   */
  private restartAt(beat: number): void {
    /*
     * Stopped first, and not only when it was paused.
     *
     * `Transport.start` is a no-op on a running clock — it must be, or a stray
     * second call would re-anchor the origin under everything already
     * scheduled. So a rewind made *while playing* silently did nothing at all
     * until this line: the score gave up its bars and the music carried
     * blithely on.
     */
    this.transport.stop();
    this.synth.stop();

    // `unplay` puts the tone back to full volume with the offer it withdraws.
    this.unplay(beat);
    this.input.clearHistory();

    /*
     * At the speed the dial is showing, not the speed this passage had the
     * first time through. Safe here and only here: `start` below re-anchors the
     * clock, which is the condition `rebaseTempo` asks for.
     */
    this.transport.rebaseTempo();

    const { barBeats } = metreAt(this.options.exercise.metres, Math.max(0, beat));
    this.transport.start((from, to) => this.schedule(from, to), beat - barBeats);

    if (this.resolveTimer === null) {
      this.resolveTimer = window.setInterval(() => {
        this.noticeCorrect();
        this.resolve();
      }, RESOLVE_INTERVAL_MS);
    }
  }

  /**
   * Takes everything from a beat onwards out of the score.
   *
   * A note played before a rewind was played in a pass that is being dropped,
   * so its verdict goes with it: leaving it would mean a bar could be scored
   * twice, and — since a rewind is what a player does when a passage is not
   * working — scored on the attempt they went back to disown.
   *
   * A standing offer goes with them, for the same reason: it was made about a
   * moment the run is no longer in. Withdrawn unconditionally rather than only
   * when the player lands behind the window, because `makeTheOffer` is checked
   * every resolve and will simply put it straight back if they did not.
   */
  private unplay(beat: number): void {
    const { notes } = this.options.exercise;
    const from = notes.findIndex((note) => note.startBeat >= beat - 1e-9);
    const first = from === -1 ? notes.length : from;

    this.nextNoteToSchedule = Math.min(this.nextNoteToSchedule, first);
    this.nextNoteToResolve = Math.min(this.nextNoteToResolve, first);
    this.soundingIndex = Math.min(this.soundingIndex, first);
    for (let index = first; index < this.noticed.length; index++) this.noticed[index] = false;

    for (let i = this.judgements.length - 1; i >= 0; i--) {
      if (this.judgements[i].noteIndex >= first) this.judgements.splice(i, 1);
    }

    this.withdrawTheOffer();
    this.options.onRewind?.(first);
  }

  /** Schedules everything falling in a beat window that has come into range. */
  private schedule(fromBeat: number, toBeat: number): void {
    const { exercise, metronomeEnabled, playbackMode, needsBeatSounded } = this.options;

    if (metronomeEnabled || needsBeatSounded) {
      /*
       * Clicks land on the pulse, not on the crotchet.
       *
       * The same thing in every metre the app currently offers, and the whole
       * difference in compound time: 6/8 is two clicks to a bar on the dotted
       * crotchets, not three on the crotchets — which is not where any of the
       * music is and not what anyone counts.
       */
      /*
       * Walked bar by bar rather than by one pulse length across the whole
       * window, because the pulse is a property of the metre in force and a
       * part changes metre. The bar is also what decides the strong click, so
       * counting within it is the same walk twice over rather than a pulse
       * index and a modulo that have to agree.
       */
      for (let bar = barAt(exercise.metres, fromBeat); ; bar++) {
        const barStart = beatOfBar(exercise.metres, bar);
        // Every pulse of this bar falls at or after its bar line, so one test
        // on the bar ends the walk rather than each pulse re-deciding it.
        if (barStart >= toBeat || barStart > this.soundUntil) break;
        const metre = metreAt(exercise.metres, barStart);
        /*
         * With the metronome off, only the bars nothing else is keeping time
         * through. The player switched the clicks off deliberately — counting
         * for yourself is most of what reading is — so this puts them back for
         * the one bar where the conductor has stopped and taken the beat with
         * it, and takes them away again at the next bar line.
         */
        if (!metronomeEnabled && !needsBeatSounded?.(metre)) continue;
        for (let pulse = 0; pulse < metre.pulsesPerBar; pulse++) {
          const beat = barStart + pulse * metre.pulseBeats;
          if (beat < fromBeat || beat >= toBeat || beat > this.soundUntil) continue;
          this.metronome.click(this.transport.audioTimeForBeat(beat), pulse === 0);
        }
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
      // At the audio time, not the clock time: everything that *sounds* is
      // handed over the output's lead early, so it is heard on the beat.
      this.synth.play(
        note.soundingMidi,
        this.transport.audioTimeForBeat(note.startBeat),
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
      // confirm; a green flash there would be applause for keeping still. And
      // nothing can be confirmed on a note the instrument cannot play.
      if (isTieContinuation(exercise.notes, index) || isUnplayable(note)) continue;

      if (isAlreadyCorrect(note, onset, tolerance, this.input, now, this.activeSince(index))) {
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
      if (
        isTieContinuation(exercise.notes, index) ||
        // Nor is a note this instrument cannot reach. Judged, it would be a
        // wrong answer nobody could have got right — see `isUnplayable`.
        isUnplayable(exercise.notes[index])
      ) {
        this.nextNoteToResolve++;
        continue;
      }

      const note = exercise.notes[index];
      const seconds = this.noteSeconds(index);
      const onset = this.transport.timeForBeat(note.startBeat);
      const scale = this.options.timingTolerance ?? 1;
      const tolerance = toleranceFor(seconds, scale);
      if (now < onset + tolerance) break;

      const judgement = judgeNote(
        note,
        index,
        onset,
        seconds,
        this.input,
        scale,
        this.activeSince(index),
      );
      this.judgements.push(judgement);
      this.options.onJudgement?.(judgement);
      this.nextNoteToResolve++;
    }

    if (this.finished) return;

    this.followFingers(now);
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
    if (!this.input.stateAt(now).playing) return;
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
   * From when valve activity counts as engagement for the note at `index`:
   * the opening of the window of the earlier of the two judged notes before
   * it, or null for the first note of the piece. Tie continuations and notes
   * the instrument cannot play are not notes the player was asked to answer,
   * so they are not counted among the two. Whether the look-back means
   * anything at all is the input's business, not this one's: the buttons need
   * it for an open note, a microphone would not.
   */
  private activeSince(index: number): number | null {
    const { notes } = this.options.exercise;
    const scale = this.options.timingTolerance ?? 1;
    let earliest: number | null = null;
    let counted = 0;
    for (let i = index - 1; i >= 0 && counted < 2; i--) {
      if (isTieContinuation(notes, i) || isUnplayable(notes[i])) continue;
      earliest =
        this.transport.timeForBeat(notes[i].startBeat) - toleranceFor(this.noteSeconds(i), scale);
      counted++;
    }
    return earliest;
  }

  /**
   * Holds the reference tone against the fingers: full while they answer the
   * note sounding now, half while they do not. The sound is scheduled ahead
   * on the audio thread, so this cannot decide what plays — only how loud it
   * is heard, which is what a player needs from it.
   */
  private followFingers(now: number): void {
    if (this.options.playbackMode === 'off') return;
    const { notes } = this.options.exercise;
    while (
      this.soundingIndex + 1 < notes.length &&
      this.transport.timeForBeat(notes[this.soundingIndex + 1].startBeat) <= now
    ) {
      this.soundingIndex++;
    }
    const index = this.soundingIndex;
    const note = notes[index];
    if (!note || this.transport.timeForBeat(note.startBeat) > now) return;
    const state = this.input.stateAt(now);
    const answers = (i: number) => this.input.answers(state, notes[i], this.activeSince(i), now);
    // The head of a tie stands for the whole chain; the far end asks nothing.
    const asked = isTieContinuation(notes, index) ? this.headOf(index) : index;
    /*
     * Or the note about to sound, once its own window has opened. A reader
     * sets the next fingering just ahead of the beat — the judge accepts it
     * as on time — and the tone must not hear that as leaving the note
     * before. Whichever of the two the fingers answer, they are right.
     */
    const scale = this.options.timingTolerance ?? 1;
    let next = index + 1;
    while (next < notes.length && (isTieContinuation(notes, next) || isUnplayable(notes[next]))) next++;
    const nextOpen =
      next < notes.length &&
      now >= this.transport.timeForBeat(notes[next].startBeat) - toleranceFor(this.noteSeconds(next), scale);
    const right = answers(asked) || (nextOpen && answers(next));
    if (right === this.fingersRight) return;
    this.fingersRight = right;
    // A voice that changes its sound on the fingering is told; every other is
    // halved. Not both — the change of sound is the whole of the signal.
    if (this.synth.follow) this.synth.follow(right);
    else this.applyVolume();
  }

  /** The head of the tie chain a continuation belongs to. */
  private headOf(index: number): number {
    const { notes } = this.options.exercise;
    let head = index;
    while (head > 0 && isTieContinuation(notes, head)) head--;
    return head;
  }

  /**
   * The tone's level, from everything that has a say in it: half while the
   * offer stands, half while the fingers are wrong, and half — not a quarter
   * — while both are true. Each is a reason for the tone to step back, not a
   * fraction to be compounded into a whisper.
   */
  private applyVolume(): void {
    const offer = this.offering ? OFFER_VOLUME : 1;
    const fingers = this.fingersRight || this.synth.follow ? 1 : WRONG_FINGERING_VOLUME;
    this.synth.setVolume(Math.min(offer, fingers));
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
    this.applyVolume();
    this.options.onOffer?.(true);
  }

  /**
   * Takes the standing offer back, leaving the question askable again.
   *
   * Both ways an offer ends come through here: accepted, or overtaken by a
   * rewind out of the window it was made in. The three things it undoes are the
   * three `makeTheOffer` does — the flag that keeps it to one asking, the
   * reference tone dropped under it, and the button that turned green — and
   * missing any one of them is what left a rewound run with a green Continue
   * button, a half-volume tone, and no way to be offered anything ever again.
   *
   * What it does *not* undo is the player's answer. `playUntil` keeps whatever
   * was bought: asking for more music is a decision about how long the run is,
   * not a verdict on a bar, and a rewind disowns verdicts only.
   */
  private withdrawTheOffer(): void {
    if (!this.offering) return;
    this.offering = false;
    this.applyVolume();
    this.options.onOffer?.(false);
  }
}
