/**
 * Working out whether the player has stopped playing.
 *
 * The app has no way of hearing the player, so it infers the note from the
 * valves. That leaves one blind spot: open is a real fingering, and doing
 * nothing at all looks exactly like it. Someone who puts the instrument down
 * mid-exercise is therefore heard as playing the open harmonic series —
 * C, G, C, E, G — which is both wrong and irritating.
 *
 * Holding no valves where open was correct proves nothing either way, so it is
 * ignored. Holding no valves where open was *wrong* is evidence, and a run of it
 * means nobody is playing. Pressing any valve is proof to the contrary and
 * clears the count at once.
 *
 * This only silences the player's voice. Judging is untouched: the notes are
 * still there and still marked wrong, which is the honest answer — they were not
 * played.
 */

/** Consecutive wrong open notes before the player is assumed to have stopped. */
export const IDLE_AFTER_MISSES = 2;

export class IdleDetector {
  private misses = 0;

  get isIdle(): boolean {
    return this.misses >= IDLE_AFTER_MISSES;
  }

  /**
   * Records the fingering held for one note, and reports whether the player's
   * own note should be sounded.
   */
  observe(mask: number, openIsAccepted: boolean): boolean {
    if (mask !== 0) {
      // Unambiguously playing.
      this.misses = 0;
    } else if (!openIsAccepted) {
      this.misses++;
    }
    return !this.isIdle;
  }

  reset(): void {
    this.misses = 0;
  }
}
