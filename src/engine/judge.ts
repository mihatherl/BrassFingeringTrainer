/**
 * Judging.
 *
 * A note is correct if an accepted button state was held at any point in a
 * window around its onset. Two consequences of that phrasing are deliberate:
 *
 *  - Consecutive notes sharing a fingering need no release and re-press. A
 *    player holding 1-2 through four notes that all use 1-2 is playing
 *    correctly, and would be wrong to lift.
 *  - Getting there slightly early still counts, which matches how valves are
 *    actually used — you set the fingering, then blow.
 *
 * Ties never reach here. The far end of one is not played, so the session
 * passes over it rather than presenting it for a verdict — see `ties.ts`. What
 * does arrive is the head of the tie, carrying the length of the whole chain,
 * since that is how long the note it stands for actually sounds.
 */

import { barAt, type Metre } from '../domain/metre';
import type { NoteEvent } from '../exercise/types';
import type { ValveInput } from './input';

export type Verdict = 'correct' | 'wrong' | 'missed';

export interface NoteJudgement {
  noteIndex: number;
  verdict: Verdict;
  /** What the player actually held, for feedback on the results screen. */
  heldMask: number;
  /** Seconds from the note's onset to the correct fingering, if it was reached. */
  timingOffset: number | null;
}

const MIN_TOLERANCE = 0.06;
const MAX_TOLERANCE = 0.2;

/**
 * How much slack a note gets, in seconds.
 *
 * A fixed share of the note's own length, so that a run of semiquavers at
 * 160bpm demands genuine precision while a minim does not, then clamped so the
 * window never becomes either unfairly tight or absurdly loose.
 *
 * Taking the note's length in seconds rather than in beats plus a tempo is
 * deliberate. It was always that product and nothing else, and asking for it
 * directly means this never has to learn what the tempo is doing — a question
 * that stops having one answer the moment the tempo can vary within a note.
 *
 * `scale` is the player's own setting. It has a real bearing on how the app
 * feels: reading a note and then moving takes most people something like a fifth
 * of a second, which is already at the edge of the default window, so anyone
 * reading rather than reciting will want more room than the strict default.
 */
export function toleranceFor(noteSeconds: number, scale = 1): number {
  return scale * Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, 0.3 * noteSeconds));
}

/**
 * Whether a note can already be called correct, part-way through its window.
 *
 * The same test `judgeNote` applies at the end, asked early: a note is right as
 * soon as an accepted combination has been held at any instant since the window
 * opened, and nothing later can take that back. Asking it every few
 * milliseconds is what lets the display confirm a note as it is played, rather
 * than waiting for a verdict that cannot be known until the window closes — by
 * which time the act that earned it is long past.
 *
 * It says nothing about a note being wrong. That is only knowable at the end,
 * since the player may still be on their way to the right fingering.
 */
export function isAlreadyCorrect(
  note: NoteEvent,
  onsetTime: number,
  tolerance: number,
  input: ValveInput,
  now: number,
): boolean {
  const accepted = new Set(note.acceptedMasks);
  return input.statesDuring(onsetTime - tolerance, now).some((s) => accepted.has(s.mask));
}

export function judgeNote(
  note: NoteEvent,
  noteIndex: number,
  onsetTime: number,
  noteSeconds: number,
  input: ValveInput,
  toleranceScale = 1,
): NoteJudgement {
  const tolerance = toleranceFor(noteSeconds, toleranceScale);
  const states = input.statesDuring(onsetTime - tolerance, onsetTime + tolerance);
  const accepted = new Set(note.acceptedMasks);

  for (const state of states) {
    if (!accepted.has(state.mask)) continue;
    // Held from before the window counts as on time, not early.
    const reachedAt = Math.max(state.from, onsetTime - tolerance);
    return {
      noteIndex,
      verdict: 'correct',
      heldMask: state.mask,
      timingOffset: reachedAt <= onsetTime ? 0 : reachedAt - onsetTime,
    };
  }

  // Report whatever they were holding at the onset itself, falling back to
  // whichever state they spent longest in.
  const atOnset = states.find((s) => s.from <= onsetTime && onsetTime < s.to);
  const longest = states.reduce((best, s) => (s.to - s.from > best.to - best.from ? s : best));
  const heldMask = atOnset?.mask ?? longest.mask;

  /*
   * An open hand is an absent answer, not a wrong one.
   *
   * Every other fingering takes a deliberate act, so holding it is evidence of
   * intent — the player meant to play *something*, and got it wrong. Open is the
   * exception: it is also what an instrument on its owner's lap produces. So
   * unless open happens to be correct here, the honest reading is that the note
   * was not played at all.
   */
  return {
    noteIndex,
    verdict: heldMask === 0 ? 'missed' : 'wrong',
    heldMask,
    timingOffset: null,
  };
}

/**
 * How many bars the score covers.
 *
 * The score reports the last so many bars rather than everything played,
 * which is what will make an endless session meaningful and already makes a
 * long one kinder: a bad patch stops haunting the rest of the run. Sixteen
 * to start with, settled by playing. Weak-note stats deliberately ignore
 * this and record whole sessions — drilling improves with every attempt it
 * remembers, and a window would work against the one thing that gets better
 * with time.
 */
export const SCORE_WINDOW_BARS = 16;

/**
 * The judgements inside the scoring window: the last `bars` bars, ending at
 * the latest bar anything was judged in.
 *
 * Anchored to what was *played* rather than to the exercise's end, so a run
 * that stops early is scored on its own last stretch. A run shorter than the
 * window comes back whole, which is why short exercises read exactly as they
 * always did. `summarise` takes whatever this returns — the window is a
 * filter in front of it, not a second scorer.
 */
export function windowJudgements(
  notes: readonly NoteEvent[],
  judgements: readonly NoteJudgement[],
  metre: Metre,
  bars = SCORE_WINDOW_BARS,
): NoteJudgement[] {
  let lastBar = -1;
  for (const judgement of judgements) {
    lastBar = Math.max(lastBar, barAt(metre, notes[judgement.noteIndex].startBeat));
  }
  const fromBar = lastBar - bars + 1;
  return judgements.filter((j) => barAt(metre, notes[j.noteIndex].startBeat) >= fromBar);
}

export interface SessionSummary {
  total: number;
  correct: number;
  wrong: number;
  missed: number;
  accuracy: number;
  /** Mean absolute lateness of correct notes, in seconds. */
  averageOffset: number;
  /** Accuracy per written pitch, feeding weak-note drilling. */
  byNote: Map<number, { attempts: number; correct: number }>;
  longestStreak: number;
  /**
   * Every verdict, in the order the notes were played.
   *
   * Carried through rather than summarised away so the results screen can put
   * the exercise back on a stave with each note in its own colour — the totals
   * say how it went, but only the notation says *where*.
   */
  judgements: NoteJudgement[];
}

export function summarise(notes: NoteEvent[], judgements: NoteJudgement[]): SessionSummary {
  const byNote = new Map<number, { attempts: number; correct: number }>();
  let correct = 0;
  let wrong = 0;
  let missed = 0;
  let offsetTotal = 0;
  let offsetCount = 0;
  let streak = 0;
  let longestStreak = 0;

  for (const judgement of judgements) {
    const note = notes[judgement.noteIndex];
    const stats = byNote.get(note.writtenMidi) ?? { attempts: 0, correct: 0 };
    stats.attempts++;

    if (judgement.verdict === 'correct') {
      correct++;
      stats.correct++;
      streak++;
      longestStreak = Math.max(longestStreak, streak);
      if (judgement.timingOffset !== null) {
        offsetTotal += Math.abs(judgement.timingOffset);
        offsetCount++;
      }
    } else {
      streak = 0;
      if (judgement.verdict === 'wrong') wrong++;
      else missed++;
    }

    byNote.set(note.writtenMidi, stats);
  }

  const total = judgements.length;
  return {
    total,
    correct,
    wrong,
    missed,
    accuracy: total === 0 ? 0 : correct / total,
    averageOffset: offsetCount === 0 ? 0 : offsetTotal / offsetCount,
    byNote,
    longestStreak,
    judgements,
  };
}
