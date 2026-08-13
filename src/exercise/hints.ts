/**
 * Fingering hints: the answer written over the notes that keep going wrong.
 *
 * **A hint answers a mistake, and it answers it now.** The history a player
 * brings to a run decides which notes open with one; a note that goes wrong
 * during the run gets one immediately — over the note that went wrong, where
 * the eye already is, and over every later note of that pitch. That is the
 * whole instructional loop, and it used to take a session to close: the hints
 * were settled once from the stored statistics, so the answer to a mistake made
 * in bar three arrived the next time the player pressed Start.
 *
 * A list of the last few notes played used to carry that job instead, and the
 * player's verdict on it is the reason this changed: *you can never pay enough
 * attention to it to see what the fingering was supposed to be.* Nothing read
 * off to the side survives contact with sight-reading. The answer has to be on
 * the note.
 *
 * **There must be time to use it.** Reading a hint, deciding, and moving takes
 * roughly a fifth of a second before anything else happens, so a note that has
 * come and gone in that time cannot be helped by one — the player is already
 * committed. That is a question about seconds rather than note values: a
 * crotchet at 200bpm is shorter than a quaver at 60. Hence the tempo, and hence
 * `retime`, since the player can now change it mid-run.
 *
 * The note that just went wrong is exempt: it is behind the player, nothing is
 * being read in time for it, and what it is doing is telling them what they
 * should have held.
 *
 * **There is no cap on how many.** There was one — at most one a bar, on the
 * grounds that beyond that the hints stop being prompts and become the part
 * being read. The player asked for it gone: fingerings are what this app is for
 * teaching, they only ever appear where something has actually gone wrong, and
 * a run with a hint over every note is a run that has earned one. What limits
 * them now is the same thing that always limited whether one could be *used* —
 * whether there is time to read it, and whether it physically fits, which is
 * decided later when the layout is known; see `drawFingeringHint`.
 */

import { formatMask } from '../domain/fingering';
import { MIN_ATTEMPTS_TO_JUDGE, type NoteStats } from '../storage/stats';
import { isTieContinuation, nextSoundedIndex, tiedBeats } from './ties';
import type { Exercise } from './types';

/**
 * Least time a note may have before a hint over it is no use.
 *
 * A fifth of a second is roughly what reading a note and moving to it costs,
 * which is also the figure the timing tolerance is built around; a hint has to
 * be readable *before* that. Half a second leaves something in hand.
 */
const MIN_SECONDS_TO_READ = 0.45;

/** Above this, a note is not one the player is struggling with. */
const STRUGGLING_BELOW = 0.8;

export interface HintOptions {
  exercise: Exercise;
  /** Accuracy history for this instrument and clef. */
  stats: NoteStats;
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

/** The hints for one run, which the run itself can add to. */
export interface Hints {
  /** The fingering to print over a note, or nothing. */
  for(noteIndex: number): string | undefined;
  /**
   * Records a note that has just been played wrong or missed.
   *
   * That note is answered where it stands, and every later note of the same
   * written pitch is prompted from here on — the mistake is about the pitch,
   * not about the one place it happened to appear.
   */
  wentWrong(noteIndex: number): void;
  /** Re-measures what there is time to read, after the tempo has changed. */
  retime(): void;
}

/**
 * The hints a run opens with, and the handle it keeps to add more.
 *
 * Opens empty for a player who is getting on fine, which is the normal state:
 * the hints appear where the trouble is and nowhere else.
 */
export function fingeringHints(options: HintOptions): Hints {
  const { exercise, stats, secondsBetween } = options;
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
  const printable = notes.map(
    // Nothing to finger at the far end of a tie, so nothing to prompt.
    (note, index) => !isTieContinuation(notes, index) && !marked.has(note.startBeat),
  );

  /** Of those, the ones with time to be read before they have to be played. */
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

  /** Pitches the player struggled with before this run began. */
  const weak = new Set<number>();
  for (const [midi, stat] of stats) {
    if (stat.attempts < MIN_ATTEMPTS_TO_JUDGE) continue;
    if (stat.correct / stat.attempts < STRUGGLING_BELOW) weak.add(midi);
  }

  /** Notes that have gone wrong in this run, answered where they stand. */
  const answered = new Set<number>();
  /** And the note each pitch first went wrong at, so only later ones prompt. */
  const troubleFrom = new Map<number, number>();

  return {
    for(noteIndex) {
      if (answered.has(noteIndex) && printable[noteIndex]) {
        return formatMask(notes[noteIndex].primaryMask);
      }
      if (!readable[noteIndex]) return undefined;

      const { writtenMidi } = notes[noteIndex];
      const since = troubleFrom.get(writtenMidi);
      if (!weak.has(writtenMidi) && (since === undefined || noteIndex < since)) return undefined;
      return formatMask(notes[noteIndex].primaryMask);
    },

    wentWrong(noteIndex) {
      const note = notes[noteIndex];
      if (!note) return;
      answered.add(noteIndex);
      const since = troubleFrom.get(note.writtenMidi);
      if (since === undefined || noteIndex < since) troubleFrom.set(note.writtenMidi, noteIndex);
    },

    retime,
  };
}
