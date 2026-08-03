/**
 * Ignoring fingerings that were never meant.
 *
 * Fingers do not move together. Lifting 1-2 releases one valve a few
 * milliseconds before the other, so between the two there is a moment where the
 * hand reads as 1, or as 2 — a fingering the player never intended and never
 * noticed making. Sampled ten times a second, those moments are caught and
 * sounded like anything else.
 *
 * In the middle of a note it barely shows, because a stray fingering still
 * resolves against the note being aimed at. In a rest it is glaring: an
 * unrecognised fingering falls back to the middle of the instrument's range, so
 * simply taking the hand off produces a stray note on the way past.
 *
 * So a fingering has to hold still briefly before it counts. Judging is
 * untouched and still reads the raw history — a transient is not something the
 * player did wrong, but it is not something they should hear either.
 */

/** How long a fingering must hold before it is acted on. */
export const FINGER_SETTLE_SECONDS = 0.035;

export class SettledMask {
  private settled = 0;
  private pending = 0;
  private pendingSince = -Infinity;
  private readonly settleSeconds: number;

  constructor(settleSeconds: number = FINGER_SETTLE_SECONDS) {
    this.settleSeconds = settleSeconds;
  }

  /**
   * Feeds in the live button state and returns the one to act on — which is the
   * previous state until the new one has stood still long enough.
   */
  update(mask: number, now: number): number {
    if (mask !== this.pending) {
      this.pending = mask;
      this.pendingSince = now;
    }
    if (now - this.pendingSince >= this.settleSeconds) {
      this.settled = mask;
    }
    return this.settled;
  }

  get value(): number {
    return this.settled;
  }

  reset(): void {
    this.settled = 0;
    this.pending = 0;
    this.pendingSince = -Infinity;
  }
}
