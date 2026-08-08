/**
 * Ties.
 *
 * A tie joins two written notes of the same pitch into a single sound. It is the
 * only way to write a note that crosses a bar line, which is exactly what it is
 * for here: the generator lets a note overrun its bar, and the remainder is
 * written again on the downbeat and joined to it.
 *
 * The consequence that matters everywhere else is that the second note is never
 * played. Nothing is tongued, no valve moves, and a player who lifts to
 * re-articulate it has misread the music. So a tie continuation is drawn and is
 * otherwise invisible: it is not sounded, not judged, and not counted.
 *
 * Judging it would be worse than pointless. The fingering it wants is the one
 * already being held — by definition, since it is the same pitch — so it would
 * be marked correct for the act of doing nothing, and every tie would quietly
 * inflate the score and the per-note accuracy that weak-note drilling reads.
 */

import { durationBeats } from '../domain/rhythm';
import type { NoteEvent } from './types';

/** Whether this note is the far end of a tie, and so sounded by the one before. */
export function isTieContinuation(notes: readonly NoteEvent[], index: number): boolean {
  return index > 0 && notes[index - 1].tiedToNext;
}

/**
 * How long the note beginning at `index` actually sounds, in beats.
 *
 * The whole chain, not the written value: a crotchet tied to a minim is a
 * three-beat note however it is spelled, and both the synth and the judging
 * window want the length that is heard.
 */
export function tiedBeats(notes: readonly NoteEvent[], index: number): number {
  let beats = 0;
  for (let i = index; i < notes.length; i++) {
    beats += durationBeats(notes[i].duration);
    if (!notes[i].tiedToNext) break;
  }
  return beats;
}

/**
 * For each note, the index of the note that sounds it — itself, unless it is a
 * tie continuation, in which case the head of its chain.
 *
 * Verdicts are recorded against the note that was played, so anything showing
 * one has to look through the tie: a green head followed by an unmarked
 * continuation reads as half a note having gone right.
 */
export function soundingHeads(notes: readonly NoteEvent[]): number[] {
  const heads: number[] = [];
  for (let index = 0; index < notes.length; index++) {
    heads.push(isTieContinuation(notes, index) ? heads[index - 1] : index);
  }
  return heads;
}

/** The next note that is actually played, skipping the rest of any tie. */
export function nextSoundedIndex(notes: readonly NoteEvent[], index: number): number | null {
  for (let i = index + 1; i < notes.length; i++) {
    if (!isTieContinuation(notes, i)) return i;
  }
  return null;
}
