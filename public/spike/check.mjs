/**
 * A synthetic check on the detector, runnable without a microphone:
 *
 *   node public/spike/check.mjs
 *
 * Real audio is what will settle whether this is usable, and recordings from an
 * actual instrument are the next step. But synthetic tones catch the failures
 * that are about arithmetic rather than about rooms, and they caught one here:
 * fed brass-like harmonics *unfiltered*, the detector reported the top of the
 * cornet range an octave low, because at six thousand samples a second a 932 Hz
 * period is only six samples long and the difference function cannot land near
 * its true minimum between them. It finds the dip at twice the period instead.
 *
 * The anti-aliasing filter is what saves it, by removing those harmonics before
 * the signal is decimated — so the filter is load-bearing for correctness and
 * not merely for cheapness. That is worth knowing before anyone "optimises" it
 * away, and is why this script models the filter rather than testing the
 * detector on a signal it will never actually be given.
 */

import { noteFromHz, yin } from './pitch.js';

/** Three cascaded second-order Butterworth lowpasses, as the audio graph builds. */
const filterGain = (hz, cutoff = 1400) => (1 + (hz / cutoff) ** 4) ** -1.5;

/**
 * A brass-like tone: many harmonics, and a fundamental weaker than the first
 * few above it, which is what makes brass hard for a naive detector.
 */
function tone(hz, sampleRate, length) {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    for (let harmonic = 1; harmonic * hz < sampleRate * 0.475; harmonic++) {
      const amplitude = (harmonic === 1 ? 0.3 : 1 / harmonic) * filterGain(harmonic * hz);
      // The phase offset stops every harmonic starting at zero together, which
      // real instruments never do and which flatters the difference function.
      samples[i] += amplitude * Math.sin(2 * Math.PI * harmonic * hz * t + harmonic);
    }
  }
  return samples;
}

/** Sounding pitches from the bottom of a B flat bass to the top of a cornet. */
const BAND = [29.1, 38.9, 46.2, 58.3, 77.8, 98, 116.5, 155, 175, 233, 293, 349, 440, 466, 587, 698, 932];

const DECIMATION = 8;
const rate = 48000 / DECIMATION;
let failures = 0;

console.log(`Detector check at ${rate} Hz, ${BAND.length} pitches across the band.\n`);

for (const size of [4096 / DECIMATION, 8192 / DECIMATION]) {
  console.log(`Window ${((size / rate) * 1000).toFixed(0)} ms:`);

  for (const hz of BAND) {
    const { hz: found, confidence } = yin(tone(hz, rate, size), rate, { minHz: 25, maxHz: 1200 });
    const cents = found > 0 ? 1200 * Math.log2(found / hz) : Number.NaN;
    const ok = Math.abs(cents) < 25;
    if (!ok) failures++;

    const detected = found > 0 ? `${noteFromHz(found).name} ${found.toFixed(1)} Hz` : 'nothing';
    const drift = Number.isNaN(cents) ? '' : ` ${cents > 0 ? '+' : ''}${cents.toFixed(0)}c`;
    console.log(
      `  ${ok ? ' ' : '✗'} ${noteFromHz(hz).name.padEnd(4)} ${String(hz).padStart(6)} Hz  →  ` +
        `${detected}${drift}  confidence ${confidence.toFixed(2)}`,
    );
  }
  console.log('');
}

console.log(failures === 0 ? 'All within 25 cents.' : `${failures} wrong by more than 25 cents.`);
process.exit(failures === 0 ? 0 : 1);
