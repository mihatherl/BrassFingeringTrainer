/**
 * Fingering hints: the answer written over the notes that keep going wrong.
 *
 * A hint is only worth printing where it can actually be used. Three things
 * decide that, and all three have to hold.
 *
 * **The note must be one the player struggles with.** Printing fingerings over
 * notes already known is not a reminder, it is a wall of digits to read past,
 * and it teaches reading digits rather than reading notes.
 *
 * **There must be time to use it.** Reading a hint, deciding, and moving takes
 * roughly a fifth of a second before anything else happens, so a note that has
 * come and gone in that time cannot be helped by one — the player is already
 * committed. That is a question about seconds rather than note values: a
 * crotchet at 200bpm is shorter than a quaver at 60. Hence the tempo.
 *
 * **There must not be too many.** One a bar at most. Beyond that the hints stop
 * being prompts and become the part being read, and the exercise quietly turns
 * into a fingering chart that happens to scroll.
 *
 * Whether a hint physically fits on the page is decided later, when the layout
 * is known — see `drawFingeringHint`.
 */

import { formatMask } from '../domain/fingering';
import { barAt } from '../domain/metre';
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

/**
 * Which notes get their fingering printed, by note index.
 *
 * Empty when nothing qualifies, which is the normal state for a player who is
 * getting on fine — the hints appear where the trouble is and nowhere else.
 */
export function fingeringHints(options: HintOptions): Map<number, string> {
  const { exercise, stats, secondsBetween } = options;
  const { notes, metre } = exercise;
  const hints = new Map<number, string>();

  // The space over a note at a tempo change belongs to the metronome mark.
  // Two things printed in the same air read as neither, and of the two the
  // mark is the one the player cannot do without.
  const marked = new Set(
    exercise.tempo.filter((e) => e.kind === 'tempo').map((e) => ('atBeat' in e ? e.atBeat : 0)),
  );

  // Worst first within each bar, so a bar containing two weak notes hints the
  // one that needs it more rather than whichever came first.
  const candidates: Array<{ index: number; bar: number; accuracy: number }> = [];

  notes.forEach((note, index) => {
    // Nothing to finger at the far end of a tie, so nothing to prompt.
    if (isTieContinuation(notes, index)) return;
    if (marked.has(note.startBeat)) return;

    const stat = stats.get(note.writtenMidi);
    if (!stat || stat.attempts < MIN_ATTEMPTS_TO_JUDGE) return;

    const accuracy = stat.correct / stat.attempts;
    if (accuracy >= STRUGGLING_BELOW) return;

    // Room is measured to the next note the player has to do something about,
    // rather than by this note's written value: a crotchet followed at once by
    // a run has no more room above it than the run does, a note before a rest
    // has plenty, and a tie buys every beat it is held for.
    const next = nextSoundedIndex(notes, index);
    const until =
      next !== null ? notes[next].startBeat : note.startBeat + tiedBeats(notes, index);
    if (secondsBetween(note.startBeat, until) < MIN_SECONDS_TO_READ) return;

    candidates.push({ index, bar: barAt(metre, note.startBeat), accuracy });
  });

  const takenBars = new Set<number>();
  for (const candidate of [...candidates].sort((a, b) => a.accuracy - b.accuracy)) {
    if (takenBars.has(candidate.bar)) continue;
    takenBars.add(candidate.bar);
    hints.set(candidate.index, formatMask(notes[candidate.index].primaryMask));
  }

  return hints;
}
