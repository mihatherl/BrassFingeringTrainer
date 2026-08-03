/**
 * Whether the player's own voice should be making any sound at all.
 *
 * Kept apart from the question of *what* to sound, and — importantly — asked on
 * every tick rather than only when the fingering changes. Deciding this only on
 * a change leaves a note ringing whenever the reason to stop is not a change:
 * fingers already lifted and left alone, or the music simply running out. Both
 * of those are silences the player expects and neither announces itself.
 */

export interface SoundingContext {
  /** Musical position; negative during the count-in. */
  beat: number;
  /** Beat at which the exercise ends. */
  totalBeats: number;
  /** The note being aimed at, or null where the context offers nothing. */
  target: number | null;
  /** Button state currently held. */
  mask: number;
  /** Whether open is a correct fingering for whatever is being aimed at. */
  openIsCorrect: boolean;
  /** Whether the player appears to have stopped altogether. */
  idle: boolean;
}

export function playerShouldSound(context: SoundingContext): boolean {
  // Nothing before the first beat: the count-in belongs to the metronome.
  if (context.beat < 0) return false;

  // Nothing after the last: the exercise is over, whatever is still being held.
  if (context.beat >= context.totalBeats) return false;

  // Nothing to aim at — a rest with no valves down, most often.
  if (context.target === null) return false;

  if (context.mask === 0) {
    /*
     * Open sounds only where open is right.
     *
     * Any other fingering is a deliberate act, and is played back however wrong
     * it turns out to be — hearing your own mistake is the point. Open is the
     * exception, because it is also what an instrument nobody is holding
     * produces. On a note that needs valves it therefore means "not playing"
     * rather than "playing the wrong note", and the right response is silence.
     */
    if (!context.openIsCorrect) return false;

    // Even where open is right, someone who has already stopped twice over is
    // probably still stopped.
    if (context.idle) return false;
  }

  return true;
}
