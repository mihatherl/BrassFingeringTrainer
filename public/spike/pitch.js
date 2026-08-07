/**
 * Pitch detection by the YIN method, for one question: does it track a brass
 * instrument?
 *
 * Plain JavaScript with no build step, because a spike that has to be compiled
 * to be tried is a spike that will not be thrown away. If the answer turns out
 * to be yes, this gets rewritten in TypeScript with recorded fixtures behind
 * it; if no, it gets deleted. Neither outcome wants it entangled with the app.
 *
 * YIN (de Cheveigné & Kawahara, 2002) rather than plain autocorrelation. The
 * cumulative-mean normalisation in step 2 is the whole reason: it is what stops
 * the detector picking half the period and reporting the note an octave high,
 * which is the classic failure and which brass, rich in harmonics, provokes
 * more than most.
 */

/**
 * Estimates the fundamental of a buffer of samples.
 *
 * Returns 0 Hz when nothing convincing is found, which is the honest answer
 * between notes and during a breath.
 */
export function yin(buffer, sampleRate, options = {}) {
  const { threshold = 0.12, minHz = 25, maxHz = 1500 } = options;

  const maxTau = Math.min(Math.floor(buffer.length / 2), Math.ceil(sampleRate / minHz));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxTau <= minTau + 2) return { hz: 0, confidence: 0 };

  /*
   * Step 1: the difference function — how unlike itself the signal is when
   * shifted by tau. At the period, very like; hence a dip.
   *
   * The comparison window is fixed rather than "whatever is left after the
   * shift". Letting it shrink as tau grows makes the long shifts sum fewer
   * terms and so score lower for no musical reason, which tilts the detector
   * toward long periods — that is, toward reporting notes an octave low. Since
   * octave errors are the whole thing this spike exists to measure, the
   * detector had better not manufacture its own.
   */
  const window = buffer.length - maxTau;
  if (window < 2) return { hz: 0, confidence: 0 };

  const difference = new Float32Array(maxTau);
  for (let tau = 1; tau < maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  /*
   * Step 2: divide each dip by the average of everything before it.
   *
   * Without this the deepest dip is usually at some multiple of the period and
   * the shallowest at tau near zero, so a plain minimum finds neither. Dividing
   * by the running mean makes the *first* real dip the smallest value, which is
   * the one at the true period.
   */
  const normalised = new Float32Array(maxTau);
  normalised[0] = 1;
  let running = 0;
  for (let tau = 1; tau < maxTau; tau++) {
    running += difference[tau];
    normalised[tau] = running === 0 ? 1 : (difference[tau] * tau) / running;
  }

  // Step 3: the first dip below the threshold, not the deepest anywhere — the
  // deepest is as likely to be an octave down.
  let tau = minTau;
  while (tau < maxTau && normalised[tau] >= threshold) tau++;
  if (tau >= maxTau) return { hz: 0, confidence: 0 };
  while (tau + 1 < maxTau && normalised[tau + 1] < normalised[tau]) tau++;

  // Step 4: a parabola through the dip and its neighbours, so the period is not
  // limited to whole samples. Worth roughly a cent at these rates.
  let refined = tau;
  if (tau > minTau && tau + 1 < maxTau) {
    const before = normalised[tau - 1];
    const here = normalised[tau];
    const after = normalised[tau + 1];
    const divisor = 2 * (2 * here - after - before);
    if (divisor !== 0) refined = tau + (after - before) / divisor;
  }

  return { hz: sampleRate / refined, confidence: 1 - normalised[tau] };
}

const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Flats rather than sharps, this being a brass band. */
export function noteFromHz(hz, concertA = 440) {
  const exact = 69 + 12 * Math.log2(hz / concertA);
  const midi = Math.round(exact);
  return {
    midi,
    cents: Math.round((exact - midi) * 100),
    name: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
  };
}

/** Semitones each valve lowers the pitch. */
const VALVE_DROP = { 1: 2, 2: 1, 3: 3 };
/** The 7th is badly flat and no player uses it. */
const USABLE_PARTIALS = [1, 2, 3, 4, 5, 6, 8, 9, 10];

/**
 * The fingering a sounding pitch asks for, so the reading can be checked
 * against what was actually held. The same harmonic-series argument the app
 * uses, written out again rather than imported — the spike stays standalone.
 */
export function fingeringFor(soundingMidi, fundamentalMidi) {
  const combinations = [[], [2], [1], [1, 2], [2, 3], [1, 3], [1, 2, 3]];

  for (const partial of USABLE_PARTIALS) {
    const partialMidi = fundamentalMidi + Math.round(12 * Math.log2(partial));
    const offset = partialMidi - soundingMidi;
    if (offset < 0 || offset > 6) continue;

    for (const valves of combinations) {
      const drop = valves.reduce((total, valve) => total + VALVE_DROP[valve], 0);
      if (drop === offset) return valves.length === 0 ? 'open' : valves.join('-');
    }
  }
  return '—';
}
