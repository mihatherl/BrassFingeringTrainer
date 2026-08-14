/**
 * Fingering hints: the answer written over the notes that keep going wrong.
 *
 * **What a mistake here actually means, and why the trouble is filed under the
 * written note.** With valve buttons and no microphone, the app sees which
 * combination went down and nothing else. It cannot tell a player who chose the
 * wrong fingering from one who chose the right fingering and mispitched, so it
 * must not pretend to teach either — what it *can* see is whether a note on the
 * page was recognised and answered. So trouble is filed under the written note,
 * exactly as it appears on the stave for this instrument and clef, and it does
 * not travel:
 *
 *  - **Not to other notes sharing its fingering.** That would be a claim about
 *    the valve combination, which is the thing the app cannot yet see.
 *  - **Not to the same letter in another octave.** The player's own case, and
 *    the clearest statement of what this feature is for: *I don't know what
 *    high B looks like, but I have no trouble with the B above middle C.* Those
 *    are two different reading problems and only one of them wants prompting.
 *
 * When the microphone lands this gets revisited: a wrong fingering and a right
 * fingering mispitched are different faults with different answers, and only
 * then can the two be told apart. Until then, this is note recognition.
 *
 * **A hint answers a mistake, and it answers it now.** The history a player
 * brings to a run decides which notes open with one; a note that goes wrong
 * during the run gets one immediately — over the note that went wrong, where
 * the eye already is, and over every later note of that pitch. A list of the
 * last few notes played used to carry that job and the player's verdict on it
 * is why it does not: *you can never pay enough attention to it to see what the
 * fingering was supposed to be.* The answer has to be on the note.
 *
 * **And it stops when it is no longer needed.** Two of that note played right
 * and the prompting stops, so the page quietens as the player improves. Which
 * is feedback in itself, and the reason the old "a hint that came and went
 * would be worse than none" is not violated: this one goes away for a reason
 * the player can feel.
 *
 * **A wrong answer and no answer are not the same evidence.** Wrong valves are
 * a fingering that was reached for and missed, and prompt at once. A missed
 * note is nothing held at all, which is as likely to mean the player was lost,
 * or behind, or resting a lip — so it takes two before it prompts.
 *
 * **A note in a run still gets its hint, if it has earned one.** There used to
 * be a rule that a note with less than a fifth of a second before the next one
 * was past helping, and it withheld hints from fast passages — which is where a
 * struggling player is most likely to be lost. The rule was also measuring the
 * wrong thing. It measured how long the *note* lasts, but the strike line sits
 * near the left of the display and the paged screen shows the whole page: a
 * hint is on screen, and readable, for seconds before its note is played. What
 * a run really costs is the ability to *act* on one mid-flight, and a hint you
 * could not act on this time is still the answer to a mistake you just made and
 * still there on the way round again.
 *
 * So in *where I struggle*, a hint prints wherever it physically fits, and
 * whether it fits is decided later when the layout is known; see
 * `drawFingeringHint`. In *every note* the timing rule stays, since that mode
 * is printing over music nothing is wrong with and a run of semiquavers under a
 * wall of digits helps nobody — hence `retime`, since the player can change the
 * tempo mid-run.
 *
 * **There is no cap on how many.** There was one — at most one a bar — and the
 * player asked for it gone: fingerings are what this app teaches, and a run
 * that has earned eight of them should be given eight.
 */

import { formatMask } from '../domain/fingering';
import type { NoteStats } from '../storage/stats';
import { isTieContinuation, nextSoundedIndex, tiedBeats } from './ties';
import type { Exercise } from './types';

/**
 * Least time a note may have before *every note* mode leaves it alone.
 *
 * A fifth of a second is roughly what reading a note and moving to it costs,
 * which is also the figure the timing tolerance is built around; half a second
 * leaves something in hand. Only that mode consults it — see above.
 */
const MIN_SECONDS_TO_READ = 0.45;

/** Above this, a note is not one the player is struggling with. */
const STRUGGLING_BELOW = 0.8;

/**
 * How much history a note needs before it opens a run with a hint.
 *
 * Deliberately higher than the figure the generator's weak-note drilling uses.
 * Drilling is invisible — it decides which notes turn up, and being eager about
 * that costs nothing. A hint is an intervention printed on the page, and one
 * mistake in two attempts is not yet evidence of anything. The run itself is
 * what catches the immediate case now, and it catches it on the first mistake.
 */
const MIN_ATTEMPTS_FOR_A_HINT = 4;

/** Notes of a pitch played right in a row before the prompting stops. */
const CORRECT_TO_RETIRE = 2;

/** Times a pitch may be missed outright before that counts as trouble. */
const MISSES_TO_PROMPT = 2;

/** What the player has asked to see. */
export type FingeringMode = 'always' | 'trouble' | 'never';

export interface HintOptions {
  exercise: Exercise;
  /** Accuracy history for this instrument and clef. */
  stats: NoteStats;
  /** Every note, only the troublesome ones, or none. */
  mode: FingeringMode;
  /**
   * How long the music lasts between two beats, in seconds — the transport's
   * own answer rather than a tempo to multiply by.
   *
   * Whether a hint can be read is a question about seconds, and under a tempo
   * that varies the seconds between two beats stop being derivable from any
   * single number. A note in a rit. has more time above it than the same note
   * written a bar earlier, and a hint is worth printing there when it would not
   * be here.
   */
  secondsBetween: (fromBeat: number, toBeat: number) => number;
}

/** A verdict, in the only two shapes this module cares about. */
export type HintVerdict = 'correct' | 'wrong' | 'missed';

/** The hints for one run, which the run itself teaches as it goes. */
export interface Hints {
  /** The fingering to print over a note, or nothing. */
  for(noteIndex: number): string | undefined;
  /**
   * Records how a note was judged, which is the whole of the learning here.
   *
   * Wrong valves prompt that pitch at once and answer the note where it
   * stands; a second miss does the same; two right in a row retire it again.
   */
  judged(noteIndex: number, verdict: HintVerdict): void;
  /** Re-measures what there is time to read, after the tempo has changed. */
  retime(): void;
  /**
   * Re-reads the paper, after part of it has been rewritten in another key.
   *
   * Which notes a hint may be printed over at all is settled once from the note
   * list, and a key change replaces every note past the change — so that
   * settling has to be done again or the tail's ties and tempo marks would be
   * read off the notes that used to be there.
   *
   * What is *not* re-read is what the run has learned. Trouble is filed under
   * the written note rather than the note's position, so a player who cannot
   * read high B still cannot read it after the key moves; and the note index
   * each pitch's trouble started at is always behind the change, since the
   * change lands ahead of the playhead.
   */
  reread(): void;
}

/** What the run has learned about one written pitch. */
interface Trouble {
  /** Whether notes of this pitch are being prompted. */
  prompting: boolean;
  /** The note it started at, so only later ones are prompted. */
  from: number;
  /** Right answers in a row, which retire it at two. */
  correctRun: number;
  /** Times it has been missed outright. */
  misses: number;
}

/**
 * The hints a run opens with, and the handle it keeps to add more.
 *
 * Opens empty for a player who is getting on fine, which is the normal state:
 * the hints appear where the trouble is and nowhere else.
 */
export function fingeringHints(options: HintOptions): Hints {
  const { exercise, stats, mode, secondsBetween } = options;
  const { notes } = exercise;

  /*
   * The space over a note at a tempo change belongs to the mark — the
   * metronome figure at a step, "rit." at a ramp's start. Two things printed
   * in the same air read as neither, and of the two the mark is the one the
   * player cannot do without.
   */
  const marked = new Set<number>();
  for (const event of exercise.tempo) {
    if (event.kind === 'tempo') marked.add(event.atBeat);
    if (event.kind === 'ramp') marked.add(event.fromBeat);
  }

  /** Notes a hint may be printed over at all, whatever the reason for one. */
  let printable = notes.map(
    // Nothing to finger at the far end of a tie, so nothing to prompt.
    (note, index) => !isTieContinuation(notes, index) && !marked.has(note.startBeat),
  );

  /** Of those, the ones long enough for *every note* mode to bother with. */
  let readable = printable.slice();

  const retime = () => {
    readable = notes.map((note, index) => {
      if (!printable[index]) return false;
      // Room is measured to the next note the player has to do something about,
      // rather than by this note's written value: a crotchet followed at once by
      // a run has no more room above it than the run does, a note before a rest
      // has plenty, and a tie buys every beat it is held for.
      const next = nextSoundedIndex(notes, index);
      const until =
        next !== null ? notes[next].startBeat : note.startBeat + tiedBeats(notes, index);
      return secondsBetween(note.startBeat, until) >= MIN_SECONDS_TO_READ;
    });
  };
  retime();

  const reread = () => {
    printable = notes.map(
      (note, index) => !isTieContinuation(notes, index) && !marked.has(note.startBeat),
    );
    retime();
  };

  /** What is known about each pitch: history first, then the run's own lesson. */
  const trouble = new Map<number, Trouble>();
  const about = (midi: number): Trouble => {
    const known = trouble.get(midi);
    if (known) return known;
    const fresh: Trouble = { prompting: false, from: 0, correctRun: 0, misses: 0 };
    trouble.set(midi, fresh);
    return fresh;
  };

  if (mode === 'trouble') {
    for (const [midi, stat] of stats) {
      if (stat.attempts < MIN_ATTEMPTS_FOR_A_HINT) continue;
      if (stat.correct / stat.attempts >= STRUGGLING_BELOW) continue;
      about(midi).prompting = true;
    }
  }

  /** Notes that have gone wrong in this run, answered where they stand. */
  const answered = new Set<number>();

  const fingering = (index: number) => formatMask(notes[index].primaryMask);

  return {
    for(noteIndex) {
      if (mode === 'never' || !printable[noteIndex]) return undefined;
      // Answered outranks everything: this note is not being read for, it is
      // being told what it should have been.
      if (answered.has(noteIndex)) return fingering(noteIndex);
      if (mode === 'always') return readable[noteIndex] ? fingering(noteIndex) : undefined;

      const known = trouble.get(notes[noteIndex].writtenMidi);
      if (!known?.prompting || noteIndex < known.from) return undefined;
      return fingering(noteIndex);
    },

    judged(noteIndex, verdict) {
      const note = notes[noteIndex];
      if (!note || mode === 'never') return;
      const known = about(note.writtenMidi);

      if (verdict === 'correct') {
        known.correctRun += 1;
        if (known.correctRun >= CORRECT_TO_RETIRE) known.prompting = false;
        return;
      }

      known.correctRun = 0;
      if (verdict === 'missed') {
        known.misses += 1;
        if (known.misses < MISSES_TO_PROMPT) return;
      }

      answered.add(noteIndex);
      // Only the notes after it, and counted from this mistake if the pitch had
      // been let go of: what is behind the player is not worth lighting up.
      known.from = known.prompting ? Math.min(known.from, noteIndex) : noteIndex;
      known.prompting = true;
    },

    retime,
    reread,
  };
}
