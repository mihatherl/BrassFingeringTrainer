/**
 * Deciding what a player is aiming at during a rest.
 *
 * Over a written note the answer is obvious — they are aiming at that note, so
 * their fingering is resolved against it. In a rest there is no note to aim at,
 * yet a player with valves down is still making a sound and the app has to
 * decide which one. Three situations cover it:
 *
 *  1. **Carrying over.** The fingering has not changed since the last note, so
 *     they are still on that note and it should simply continue.
 *  2. **Coming in early.** The fingering is a correct one for the note *after*
 *     the rest, so they have jumped in ahead of the beat — resolve against that.
 *  3. **Neither.** Nothing to go on, so fall back to the middle of the
 *     instrument's range, which is where idle noodling tends to sit.
 *
 * With one exception that matters more than any of them: holding no valves is
 * indistinguishable from holding no instrument. So an unrecognised *open*
 * fingering is silence, not a guess — otherwise putting the thing down in a rest
 * would conjure a note out of nowhere.
 */

export interface RestVoicing {
  /** Button state currently held. */
  mask: number;
  /** Button state held for the note before the rest. */
  previousMask: number;
  /** Sounding pitch of the note before the rest, if there was one. */
  previousTarget: number | null;
  /** Accepted fingerings for the note after the rest. */
  nextAccepted: readonly number[];
  /** Sounding pitch of the note after the rest, if there is one. */
  nextTarget: number | null;
  /** Middle of the instrument's compass, for anything unrecognisable. */
  middleTarget: number;
}

/**
 * The pitch to resolve the held fingering against, or null to stay silent.
 *
 * Returns a *target*, not a pitch: the caller still passes it through
 * `soundedPitch`, so the same rules about harmonic columns and the virtual 4th
 * valve apply exactly as they do on a written note.
 */
export function restTarget(voicing: RestVoicing): number | null {
  const { mask, previousMask, previousTarget, nextAccepted, nextTarget, middleTarget } = voicing;

  // Nothing held, nothing meant. In a silence, no valves down is taken as not
  // playing rather than as an intention to sound an open note — even where an
  // open note would have been carried over or would fit what comes next. A
  // player really holding an open note through a rest is indistinguishable from
  // one who has simply stopped, and stopping is much the likelier of the two.
  if (mask === 0) return null;

  // 1. Unchanged since the last note: they are still playing it.
  if (mask === previousMask && previousTarget !== null) return previousTarget;

  // 2. A correct fingering for what comes next: an early entry.
  if (nextTarget !== null && nextAccepted.includes(mask)) return nextTarget;

  // 3. Something else entirely.
  return middleTarget;
}
