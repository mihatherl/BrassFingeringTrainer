/**
 * The click a dial makes as it passes a detent.
 *
 * A control you turn with your finger has nothing else to tell you it moved:
 * the note it lands on is a small change a long way from the thumb doing the
 * turning, and a dial that slides silently feels like a dial that is stuck. So
 * each step reports itself twice over — a tap on the speaker and a tap on the
 * hand — which is what a physical detent does and the reason it exists.
 *
 * Shorter and quieter than the metronome's beat, and higher, so nobody mistakes
 * one for the other: this is a control acknowledging a touch, not a pulse to
 * play to.
 *
 * Everything here is best-effort. There is no audio on a settings screen until
 * something asks for it, a browser may refuse until a gesture it likes, and
 * haptics exist on some phones and no desktops. A dial that threw because it
 * could not click would be a far worse control than a silent one.
 */

import { getAudioContext } from './context';

const FREQUENCY = 2000;
/**
 * Least time between two clicks.
 *
 * A note dial passes a detent every few hundred milliseconds and every one of
 * them should be heard. A tempo dial spun hard passes thirty in a second, and
 * thirty of these in a second is not a ratchet but a buzz — and thirty
 * vibrations is a phone that feels broken. Dropping the ones that fall inside
 * this leaves a ratchet at about eight a second however fast the finger goes,
 * which is what a fast-moving detent sounds like anyway.
 */
const MIN_GAP_MS = 120;
const DECAY = 0.016;
const LEVEL = 0.09;
/** Long enough to feel, short enough not to buzz. */
const VIBRATION_MS = 8;

let lastClick = 0;

export function detentClick(): void {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  if (now - lastClick < MIN_GAP_MS) return;
  lastClick = now;

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(VIBRATION_MS);
    } catch {
      // Some browsers expose it and refuse it; the sound still lands.
    }
  }

  try {
    const ctx = getAudioContext();
    // A dial is turned with a finger, so the gesture a browser wants is already
    // happening; resuming here is what makes the first click of a session
    // audible. Not awaited — a click that arrives late is worse than none.
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(FREQUENCY, now);

    gain.gain.setValueAtTime(LEVEL, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + DECAY);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + DECAY + 0.01);
    osc.addEventListener('ended', () => gain.disconnect());
  } catch {
    // No AudioContext at all — a test environment, or a browser refusing one.
  }
}
