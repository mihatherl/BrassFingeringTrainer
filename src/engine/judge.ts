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
 */

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
 * Scaled by the note's length so that a run of semiquavers at 160bpm demands
 * genuine precision while a minim does not, then clamped so the window never
 * becomes either unfairly tight or absurdly loose.
 *
 * `scale` is the player's own setting. It has a real bearing on how the app
 * feels: reading a note and then moving takes most people something like a fifth
 * of a second, which is already at the edge of the default window, so anyone
 * reading rather than reciting will want more room than the strict default.
 */
export function toleranceFor(
  durationInBeats: number,
  secondsPerBeat: number,
  scale = 1,
): number {
  const scaled = 0.3 * secondsPerBeat * durationInBeats;
  return scale * Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, scaled));
}

export function judgeNote(
  note: NoteEvent,
  noteIndex: number,
  onsetTime: number,
  durationInBeats: number,
  secondsPerBeat: number,
  input: ValveInput,
  toleranceScale = 1,
): NoteJudgement {
  const tolerance = toleranceFor(durationInBeats, secondsPerBeat, toleranceScale);
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
  };
}
