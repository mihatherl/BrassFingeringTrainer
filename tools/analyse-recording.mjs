/**
 * Runs the pitch spike's detector over a recorded WAV, offline.
 *
 *   node tools/analyse-recording.mjs "spikefiles/brass-spike 4.wav" [--window 4096]
 *
 * The browser can already do this — the spike has a file picker — but a screen
 * only ever shows one answer. Here the same recording can be run a hundred
 * times against different settings and the results compared, which is the only
 * way to tell a fix from a coincidence.
 *
 * The filter chain is reimplemented rather than borrowed, because Web Audio is
 * not available outside a browser. It follows the same cookbook formulas
 * `BiquadFilterNode` uses, so the two agree to within rounding.
 */

import { readFileSync } from 'node:fs';
import { noteFromHz, yin } from '../public/spike/pitch.js';

const DECIMATION = 8;
const ANTI_ALIAS_HZ = 1400;
const ANTI_ALIAS_STAGES = 3;
const MIN_CONFIDENCE = 0.6;
const HELD_SECONDS = 0.08;
const SAME_NOTE_CENTS = 60;

function readWav(path) {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path} is not a WAV`);

  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bits = bytes.readUInt16LE(34);
  if (bits !== 16) throw new Error(`Only 16-bit WAVs are handled; this is ${bits}-bit`);

  // Walk the chunks rather than assuming the data starts at 44: some writers
  // put a LIST chunk in first.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'data') {
      const frames = Math.floor(size / 2 / channels);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        // Mono, or the first channel of many — the same downmix the browser does.
        samples[i] = bytes.readInt16LE(offset + 8 + i * 2 * channels) / 0x8000;
      }
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

/** One second-order lowpass, by the same formulas Web Audio uses. */
function lowpass(samples, sampleRate, cutoff, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);

  const a0 = 1 + alpha;
  const b0 = ((1 - cos) / 2) / a0;
  const b1 = (1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;

  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

function analyse(samples, sampleRate, windowSize) {
  let filtered = samples;
  for (let stage = 0; stage < ANTI_ALIAS_STAGES; stage++) {
    filtered = lowpass(filtered, sampleRate, ANTI_ALIAS_HZ);
  }

  const decimatedRate = sampleRate / DECIMATION;
  const length = windowSize / DECIMATION;
  const hop = Math.round(decimatedRate / 50);
  const buffer = new Float32Array(length);
  const points = [];

  for (let start = 0; start + windowSize < filtered.length; start += hop * DECIMATION) {
    for (let i = 0; i < length; i++) buffer[i] = filtered[start + i * DECIMATION];

    let energy = 0;
    for (let i = 0; i < length; i++) energy += buffer[i] * buffer[i];

    const { hz, confidence } = yin(buffer, decimatedRate, { minHz: 25, maxHz: 1200 });
    points.push({
      at: (start + windowSize / 2) / sampleRate,
      hz: hz > 0 && confidence >= MIN_CONFIDENCE ? hz : 0,
      confidence,
      level: Math.sqrt(energy / length),
    });
  }
  return points;
}

/** The same rule the spike uses: a pitch counts once it has been held. */
function segment(points) {
  const notes = [];
  let current = null;
  const close = () => {
    if (current && current.until - current.from >= HELD_SECONDS) notes.push(current);
    current = null;
  };

  for (const point of points) {
    if (point.hz === 0) { close(); continue; }
    const midi = 69 + 12 * Math.log2(point.hz / 440);
    if (current && Math.abs(midi - current.midi) * 100 <= SAME_NOTE_CENTS) {
      current.until = point.at;
      current.readings.push(midi);
      current.midi = current.readings.reduce((a, b) => a + b, 0) / current.readings.length;
    } else {
      close();
      current = { from: point.at, until: point.at, midi, readings: [midi] };
    }
  }
  close();
  return notes;
}

const [path, ...rest] = process.argv.slice(2);
if (!path) {
  console.error('Give it a WAV: node tools/analyse-recording.mjs "spikefiles/brass-spike 4.wav"');
  process.exit(2);
}
const windowArg = rest.indexOf('--window');
const windowSize = windowArg >= 0 ? Number(rest[windowArg + 1]) : 4096;

const { samples, sampleRate } = readWav(path);
const points = analyse(samples, sampleRate, windowSize);
const notes = segment(points);

const voiced = points.filter((p) => p.hz > 0).length;
console.log(
  `${path}\n  ${(samples.length / sampleRate).toFixed(1)}s at ${sampleRate} Hz, ` +
    `window ${((windowSize / sampleRate) * 1000).toFixed(0)}ms, ` +
    `${points.length} frames, ${Math.round((voiced / points.length) * 100)}% voiced\n`,
);

console.log(`  ${notes.length} notes held for ${HELD_SECONDS * 1000}ms or more:\n`);
notes.forEach((note, index) => {
  const rounded = Math.round(note.midi);
  const cents = Math.round((note.midi - rounded) * 100);
  const spread = Math.max(...note.readings) - Math.min(...note.readings);
  const previous = index > 0 ? Math.round(notes[index - 1].midi) : null;
  const step = previous === null ? '' : `${rounded - previous > 0 ? '+' : ''}${rounded - previous}`;
  const flag = Math.abs(Math.abs(rounded - (previous ?? rounded)) - 12) <= 1 ? '  <-- octave step' : '';

  console.log(
    `  ${String(index + 1).padStart(3)}. ${noteFromHz(440 * 2 ** ((rounded - 69) / 12)).name.padEnd(5)}` +
      `${String(cents >= 0 ? '+' + cents : cents).padStart(5)}c  ` +
      `${((note.until - note.from) * 1000).toFixed(0).padStart(5)}ms  ` +
      `spread ${(spread * 100).toFixed(0).padStart(3)}c  ${step.padStart(3)}${flag}`,
  );
});
