/**
 * Measuring an output device's latency by tapping along.
 *
 * The app cannot hear its own output, so the player's finger is the sensor:
 * clicks are scheduled at known clock times, the player taps in time with what
 * they *hear*, and each tap lands as late after its click as the device is
 * late in delivering the sound. The middle of those offsets is the latency.
 *
 * Tapping along to a steady beat is a prediction, not a reaction — the taps
 * cluster around the heard beat rather than trailing it by a reaction time —
 * so the offset measures the device and not the player. People do tend to
 * tap a shade *early* against a beat they can hear, by a few tens of
 * milliseconds; that bias is small beside a Bluetooth latency and it is why a
 * phone speaker measures near zero rather than at its own small delay, which
 * is the answer the player wants from it anyway.
 *
 * The median rather than the mean, because a fumbled tap is an outlier and a
 * mean would let one bad tap move the answer by a hundred milliseconds.
 */

/** Taps to make before an estimate is offered. */
export const MIN_TAPS = 6;

/**
 * Taps discarded from the front: the first are the player finding the beat,
 * and are the ones most likely to be wildly off.
 */
export const SETTLING_TAPS = 2;

/** Only the most recent taps count, so a player who tightens up is believed. */
export const TAPS_KEPT = 8;

/**
 * Clicks per minute during calibration. Slow enough that a tap can only be
 * matched to one click — half a beat at this speed is 500ms, which is the whole
 * range of lead the app allows — and slow enough to tap to cleanly.
 */
export const CALIBRATION_BPM = 60;

export interface LeadEstimate {
  /** The device's latency, in whole milliseconds; may be slightly negative. */
  leadMs: number;
  /** How scattered the taps were around it, in milliseconds. */
  spreadMs: number;
  /** How many taps the estimate rests on. */
  taps: number;
}

/**
 * How late the taps land after the clicks, in the same clock.
 *
 * `clicks` are the clock times the clicks were *meant* for — the beat, not
 * the earlier moment they were handed to the audio thread — and `leadInForce`
 * is how early they were handed over while tapping. So a tap that lands
 * exactly on its click means the lead in force is exactly the latency, and
 * the estimate is that lead plus whatever offset remains: calibrating again
 * with a lead already set converges on the same answer rather than doubling
 * it, and confirms it when the offset comes out at zero.
 *
 * Null until there are enough taps to say anything.
 */
export function estimateLead(
  taps: readonly number[],
  clicks: readonly number[],
  leadInForce = 0,
): LeadEstimate | null {
  if (taps.length < MIN_TAPS || clicks.length === 0) return null;

  const recent = taps.slice(SETTLING_TAPS).slice(-TAPS_KEPT);
  const offsets = recent
    .map((tap) => tap - nearest(clicks, tap))
    .sort((a, b) => a - b);

  const middle = median(offsets);
  const spread = median(offsets.map((o) => Math.abs(o - middle)));
  return {
    leadMs: Math.round((leadInForce + middle) * 1000),
    spreadMs: Math.round(spread * 1000),
    taps: offsets.length,
  };
}

function nearest(times: readonly number[], to: number): number {
  return times.reduce((best, t) => (Math.abs(t - to) < Math.abs(best - to) ? t : best));
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
