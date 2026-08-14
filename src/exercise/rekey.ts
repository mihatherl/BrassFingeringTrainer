/**
 * Changing the key of a run that is already under way.
 *
 * The player turns a dial and the music from a bar line ahead of them is
 * rewritten in the new key. Everything behind that line — the notes they have
 * played, the verdicts they earned, the trouble the run has learned — is left
 * exactly as it was.
 *
 * **The paper is rewritten in place.** `notes` and `rests` are spliced rather
 * than replaced, and the `Exercise` keeps its identity. That is not an
 * optimisation: the session, the renderer, the hints and the play screen all
 * hold the same object, and several of them destructure `exercise.notes` at
 * construction, so a fresh array would leave half the app reading the old
 * paper. One piece of paper, everybody reading it, and an explicit call to say
 * it has changed.
 *
 * **The tail comes from a whole fresh exercise, generated in the new key.**
 * Nothing here generates music; the caller passes the exercise the generator
 * would have made had the player chosen that key to begin with, and this takes
 * its tail. Which is why the two have to be the same shape — see
 * `canRekey`.
 *
 * **The splice lands on a bar line, and that is what makes it correct rather
 * than merely convenient.** An accidental on a note depends on the key *and* on
 * what has already occurred in its bar, and the notes either side of the join
 * were spelled by two different runs of the generator. Joining mid-bar would
 * put one bar's worth of accidentals under two keys' authority. A bar line is
 * also where a key signature belongs in print, and where a player can be asked
 * to change without being asked to change their mind mid-phrase.
 */

import { keyAt } from '../domain/keys';
import { barAt, beatOfBar } from '../domain/metre';
import type { Exercise, ExerciseKind } from './types';

/**
 * Which material may be re-keyed mid-run.
 *
 * Free material only, and on structural grounds rather than taste. A generated
 * exercise of `bars` bars is that many bars in any key, so the fresh paper is
 * the same shape as the live paper and its tail drops straight in. The others
 * measure their length in something a key changes: a pattern in how many cycles
 * of its shape fit the instrument's compass, a stitched set of themes in which
 * tunes were chosen for the key. In those, changing key changes how long the
 * paper is — which is a change of material rather than of key, and wants its own
 * design. Imported music has no generator behind it and cannot be re-keyed at
 * all.
 */
export function canRekeyKind(kind: ExerciseKind): boolean {
  return kind === 'random' || kind === 'phrases';
}

/** What a splice did, for the callers that keep their own copies by index. */
export interface Rekeyed {
  /** The bar line the new key starts at. */
  changeBeat: number;
  /**
   * The first note index the new key owns.
   *
   * Every index below this one still names the note it named before, which is
   * the invariant the whole feature stands on — judgements, confirmations and
   * per-note hint state are all indexed into `notes`, and a splice that moved
   * an index the player had already been judged on would reassign their verdict
   * to a note they never played.
   */
  fromNoteIndex: number;
  fifths: number;
}

/**
 * Whether a fresh exercise can supply the tail of a live one.
 *
 * The two must agree about how long the paper is and where its bar lines fall,
 * since the head is measured in the live one's beats and the tail in the
 * fresh one's. Free material generated from the same settings always does
 * agree: the metre is fixed and the length is a bar count. Patterns and themes
 * do not, and are not offered the dial — a scale's length falls out of how many
 * cycles fit, and a stitched theme's out of which tunes were chosen, so a
 * change of key changes the length of the paper. That is a change of material
 * rather than of key, and wants its own design.
 */
export function canRekey(live: Exercise, fresh: Exercise): boolean {
  if (Math.abs(live.totalBeats - fresh.totalBeats) > 1e-9) return false;
  if (Math.abs(live.chosenBeats - fresh.chosenBeats) > 1e-9) return false;
  if (live.metres.length !== fresh.metres.length) return false;
  return live.metres.every((change, i) => {
    const other = fresh.metres[i];
    return (
      Math.abs(change.fromBeat - other.fromBeat) < 1e-9 &&
      change.metre.barBeats === other.metre.barBeats
    );
  });
}

/**
 * The first bar line at or after `beat` — where a change asked for now may land.
 *
 * Separate from the splice so the caller can decide *when* from its own
 * constraints (the scheduling horizon, how much reading room a player wants)
 * without this having to know about clocks.
 */
export function barLineAtOrAfter(exercise: Exercise, beat: number): number {
  const bar = barAt(exercise.metres, Math.max(0, beat));
  const line = beatOfBar(exercise.metres, bar);
  return line >= beat - 1e-9 ? line : beatOfBar(exercise.metres, bar + 1);
}

/**
 * Rewrites `live` from `changeBeat` onwards in `fresh`'s key.
 *
 * Returns what was done, or null when the two exercises are not the same shape
 * or the change would land past the end of the paper — in which case nothing is
 * touched. A caller that has already checked `canRekey` still gets a null for
 * the second reason, so the return is worth reading either way.
 */
export function rekeyFrom(live: Exercise, fresh: Exercise, changeBeat: number): Rekeyed | null {
  if (!canRekey(live, fresh)) return null;
  if (changeBeat >= live.totalBeats - 1e-9) return null;

  const fifths = keyAt(fresh.keys, changeBeat);
  // Already in that key from here on, and no change worth marking. The dial can
  // land back where the music already was, and a signature printed mid-line to
  // announce the key it is already in would be a lie about the music.
  if (keyAt(live.keys, changeBeat) === fifths && !changesKeyAfter(live, changeBeat)) return null;

  const keep = live.notes.findIndex((note) => note.startBeat >= changeBeat - 1e-9);
  const fromNoteIndex = keep === -1 ? live.notes.length : keep;

  /*
   * A note held across the join would be two notes in two keys, so the tie is
   * cut and the head note stands as written.
   *
   * It should not arise — generated rhythm ties across a bar line rather than
   * writing a note through one, so the note before a bar line ends on it — but
   * the cost of being wrong is a tie drawn to a notehead that is no longer
   * there, and the cost of the guard is one line.
   */
  const last = fromNoteIndex - 1;
  if (last >= 0) live.notes[last] = { ...live.notes[last], tiedToNext: false };

  live.notes.splice(
    fromNoteIndex,
    live.notes.length - fromNoteIndex,
    ...fresh.notes.filter((note) => note.startBeat >= changeBeat - 1e-9),
  );

  const restsFrom = live.rests.findIndex((rest) => rest.startBeat >= changeBeat - 1e-9);
  const restsKept = restsFrom === -1 ? live.rests.length : restsFrom;
  live.rests.splice(
    restsKept,
    live.rests.length - restsKept,
    ...fresh.rests.filter((rest) => rest.startBeat >= changeBeat - 1e-9),
  );

  /*
   * The key from here on, and nothing beyond it.
   *
   * Dropping the live exercise's later changes is what ends a key tour, ruled
   * by the player on 2026-08-14: the tour's changes are the score's instruction
   * and the dial is theirs, and re-entering a tour partway into a key nobody
   * chose would be the app arguing with the dial. The fresh exercise's own
   * changes are dropped for the same reason — it was generated as a whole run
   * and only its notes are wanted.
   */
  live.keys = [
    ...live.keys.filter((change) => change.fromBeat < changeBeat - 1e-9),
    { fromBeat: changeBeat, fifths },
  ];

  return { changeBeat, fromNoteIndex, fifths };
}

/** Whether anything after this beat would still change key. */
function changesKeyAfter(exercise: Exercise, beat: number): boolean {
  return exercise.keys.some((change) => change.fromBeat > beat + 1e-9);
}
