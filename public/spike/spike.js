/**
 * The spike: microphone in, pitch out, and a plot of the last few seconds.
 *
 * Everything here exists to answer one question, so it is deliberately plain —
 * no framework, no build step, no tests. What it has to show is not a number
 * but a *history*: a single reading tells you nothing about whether a detector
 * is usable, and the octave errors that sink autocorrelation on brass are
 * obvious in a plot and invisible in a readout.
 */

import { fingeringFor, noteFromHz, yin } from './pitch.js';

/*
 * The analysis chain.
 *
 * A low E flat bass fundamental is 38.9 Hz, a period of 25.7ms, and a period
 * detector needs two or three of them — so the window cannot be shorter than
 * about 50ms whatever else is done. 4096 samples at 48kHz is 85ms, which
 * clears that with something in hand.
 *
 * Working at the full rate would then mean testing 2000-odd candidate periods
 * against 4096 samples every frame, which is far too much arithmetic. Since no
 * brass instrument in the band sounds above about 1kHz, the signal is filtered
 * and then decimated by eight — the same 85ms of music in an eighth of the
 * samples, and a sixty-fourth of the work.
 *
 * The filter is load-bearing for correctness and not merely for cheapness, and
 * anyone tempted to simplify it should read `check.mjs` first. Two things go
 * wrong without it: harmonics above 3kHz fold back down and land on top of the
 * fundamental, and — the one that actually bit — a bright tone at the top of
 * the cornet range gets reported an octave low, because six samples to a period
 * is too few for the difference function to land near its true minimum, so it
 * settles into the dip at twice the period instead.
 */
const DECIMATION = 8;
const ANTI_ALIAS_HZ = 1400;
const ANTI_ALIAS_STAGES = 3;

const PLOT_SECONDS = 12;
const RECORD_SECONDS = 15;
/** Below this, a reading is treated as no reading at all. */
const MIN_CONFIDENCE = 0.6;

/*
 * What it takes for a run of readings to count as a note.
 *
 * The single most useful thing the spike can report is not how often a *frame*
 * is wrong but how often a *note* is, because nothing downstream will ever act
 * on one frame. A stray reading lasting two frames is forty milliseconds; a
 * note lasts several hundred. Requiring a note to be held is what makes the
 * difference between a detector that looks unreliable and one that is.
 */
const HELD_SECONDS = 0.08;
const SAME_NOTE_CENTS = 60;

const el = (id) => document.getElementById(id);
const ui = {
  start: el('start'),
  pause: el('pause'),
  record: el('record'),
  download: el('download'),
  instrument: el('instrument'),
  status: el('status'),
  level: el('level'),
  name: el('name'),
  fingering: el('fingering'),
  centsText: el('cents-text'),
  needle: el('needle'),
  hz: el('hz'),
  confidence: el('confidence'),
  voiced: el('voiced'),
  jumps: el('jumps'),
  window: el('window'),
  rate: el('rate'),
  windowSize: el('window-size'),
  plot: el('plot'),
  file: el('file'),
  fileStatus: el('file-status'),
  notes: el('notes'),
};

const state = {
  /** Seconds across the plot. The live view rolls; a file shows all of itself. */
  span: PLOT_SECONDS,
  running: false,
  frozen: false,
  history: [], // { at, midi, cents, confidence }
  frames: 0,
  voicedFrames: 0,
  jumps: 0,
  lastMidi: null,
  analysisTimes: [],
  recorder: null,
};

ui.start.addEventListener('click', () => void start());
ui.pause.addEventListener('click', () => {
  state.frozen = !state.frozen;
  ui.pause.textContent = state.frozen ? 'Resume' : 'Freeze';
});

async function start() {
  ui.start.disabled = true;
  ui.status.textContent = 'Asking for the microphone…';

  let stream;
  try {
    /*
     * Every piece of "helpful" processing turned off.
     *
     * Automatic gain control, noise suppression and echo cancellation are all
     * built for speech, and all three mangle a sustained tone — iOS applies
     * them by default and will happily hand over a signal no pitch detector
     * can read.
     */
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (error) {
    ui.status.textContent = `No microphone: ${String(error)}`;
    ui.start.disabled = false;
    return;
  }

  const context = new AudioContext();
  await context.resume();

  const source = context.createMediaStreamSource(stream);

  let node = source;
  for (let stage = 0; stage < ANTI_ALIAS_STAGES; stage++) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = ANTI_ALIAS_HZ;
    filter.Q.value = 0.707;
    node.connect(filter);
    node = filter;
  }

  const analyser = context.createAnalyser();
  node.connect(analyser);

  // A second tap, before the filter, so the level meter shows what the
  // microphone actually hears rather than what survived the anti-aliasing.
  const raw = context.createAnalyser();
  raw.fftSize = 2048;
  source.connect(raw);
  const rawSamples = new Float32Array(raw.fftSize);

  const rate = context.sampleRate;
  const decimatedRate = rate / DECIMATION;

  let full = new Float32Array(0);
  let decimated = new Float32Array(0);
  const resize = () => {
    const size = Number(ui.windowSize.value);
    analyser.fftSize = size;
    full = new Float32Array(size);
    decimated = new Float32Array(size / DECIMATION);
    ui.window.textContent = `${Math.round((size / rate) * 1000)} ms`;
  };
  resize();
  ui.windowSize.addEventListener('change', resize);

  state.running = true;
  ui.pause.disabled = false;
  ui.record.disabled = false;
  ui.status.textContent = 'Listening. Play something.';
  setUpRecording(context, source, rate);

  const loop = () => {
    if (!state.running) return;
    requestAnimationFrame(loop);
    if (state.frozen) return;

    const began = performance.now();
    analyser.getFloatTimeDomainData(full);
    for (let i = 0; i < decimated.length; i++) decimated[i] = full[i * DECIMATION];

    raw.getFloatTimeDomainData(rawSamples);
    let sumSquares = 0;
    for (let i = 0; i < rawSamples.length; i++) sumSquares += rawSamples[i] * rawSamples[i];
    const rms = Math.sqrt(sumSquares / rawSamples.length);
    ui.level.style.width = `${Math.min(100, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) * 1.6))}%`;

    const { hz, confidence } = yin(decimated, decimatedRate, { minHz: 25, maxHz: 1200 });
    record(hz, confidence);
    draw();

    // Re-segmented a few times a second rather than every frame: the list is
    // for reading, and one that reflowed sixty times a second could not be.
    if (state.frames % 12 === 0) renderNotes(segment(state.history));

    state.analysisTimes.push(performance.now() - began);
    if (state.analysisTimes.length > 60) state.analysisTimes.shift();
  };
  requestAnimationFrame(loop);
}

function record(hz, confidence) {
  state.frames++;
  const voiced = hz > 0 && confidence >= MIN_CONFIDENCE;
  const now = performance.now() / 1000;

  if (voiced) {
    state.voicedFrames++;
    const note = noteFromHz(hz);

    // An octave jump between consecutive readings is almost never a player and
    // almost always the detector. Counting them is the point of the exercise.
    if (state.lastMidi !== null && Math.abs(Math.abs(note.midi - state.lastMidi) - 12) <= 1) {
      state.jumps++;
    }
    state.lastMidi = note.midi;

    state.history.push({ at: now, midi: note.midi + note.cents / 100, confidence });
    show(note, hz, confidence);
  } else {
    state.lastMidi = null;
    state.history.push({ at: now, midi: null, confidence });
    ui.name.classList.add('note__name--quiet');
    ui.confidence.textContent = confidence.toFixed(2);
  }

  while (state.history.length && state.history[0].at < now - state.span) state.history.shift();

  ui.voiced.textContent = `${Math.round((state.voicedFrames / Math.max(1, state.frames)) * 100)}%`;
  ui.jumps.textContent = String(state.jumps);
  if (state.analysisTimes.length) {
    const mean = state.analysisTimes.reduce((a, b) => a + b, 0) / state.analysisTimes.length;
    ui.rate.textContent = `${mean.toFixed(1)} ms`;
  }
}

function show(note, hz, confidence) {
  ui.name.textContent = note.name;
  ui.name.classList.remove('note__name--quiet');
  ui.hz.textContent = `${hz.toFixed(1)} Hz`;
  ui.confidence.textContent = confidence.toFixed(2);
  ui.centsText.textContent = `${note.cents > 0 ? '+' : ''}${note.cents} cents`;
  ui.fingering.textContent = fingeringFor(note.midi, Number(ui.instrument.value));

  const clamped = Math.max(-50, Math.min(50, note.cents));
  ui.needle.style.left = `calc(${50 + clamped}% - 1.5px)`;
  ui.needle.style.background = Math.abs(note.cents) <= 15 ? 'var(--good)' : 'var(--bad)';
}

function draw() {
  const canvas = ui.plot;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const styles = getComputedStyle(document.body);
  const ink = styles.getPropertyValue('--text').trim();
  const faint = styles.getPropertyValue('--border').trim();

  ctx.clearRect(0, 0, width, height);

  // One line an octave, labelled, so a jump of exactly one gap is unmistakable.
  const low = 24;
  const high = 84;
  const y = (midi) => height - ((midi - low) / (high - low)) * height;

  ctx.strokeStyle = faint;
  ctx.fillStyle = styles.getPropertyValue('--muted').trim();
  ctx.font = '10px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let midi = low; midi <= high; midi += 12) {
    const line = Math.round(y(midi)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, line);
    ctx.lineTo(width, line);
    ctx.stroke();
    ctx.fillText(`C${Math.floor(midi / 12) - 1}`, 2, line - 2);
  }

  if (state.history.length === 0) return;
  const now = state.history[state.history.length - 1].at;
  const x = (at) => width - ((now - at) / state.span) * width;

  ctx.fillStyle = ink;
  for (const point of state.history) {
    if (point.midi === null) continue;
    const size = 1.5 + point.confidence * 2;
    ctx.globalAlpha = 0.35 + point.confidence * 0.65;
    ctx.fillRect(x(point.at) - size / 2, y(point.midi) - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

/**
 * A flight recorder: the last few seconds, always, saved on demand.
 *
 * "Record fifteen seconds and try to make it go wrong" is the wrong way round
 * for an intermittent fault, because the interesting moment has passed by the
 * time you have reacted to it. Capturing continuously and keeping only the
 * recent past turns that into "play until you see it, then hit save", which is
 * a thing a person can actually do while holding a tuba.
 *
 * A deprecated node, knowingly: it is a few lines, works everywhere today, and
 * this page will not outlive the question it was written to answer.
 */
function setUpRecording(context, source, rate) {
  const chunks = [];
  let held = 0;

  const tap = context.createScriptProcessor(4096, 1, 1);
  tap.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    held += chunks[chunks.length - 1].length;
    while (held - chunks[0].length > RECORD_SECONDS * rate) held -= chunks.shift().length;
  };
  source.connect(tap);
  // Silent, but connected: a script processor gets no callbacks otherwise.
  const mute = context.createGain();
  mute.gain.value = 0;
  tap.connect(mute);
  mute.connect(context.destination);

  ui.record.textContent = `Save last ${RECORD_SECONDS}s`;
  ui.record.addEventListener('click', () => {
    if (chunks.length === 0) return;
    const url = URL.createObjectURL(wavFrom(chunks, rate));
    ui.download.href = url;
    ui.download.download = `brass-spike-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.wav`;
    ui.download.hidden = false;
  });
}

/** 16-bit PCM, because a fixture should be readable by anything. */
function wavFrom(chunks, rate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}


/*
 * Offline analysis of a recording.
 *
 * The same chain the microphone goes through — filter, decimate, YIN — run over
 * a whole file at once. Two things make this worth having over the live view:
 * a recording can be listened to again and argued about, and the plot shows the
 * entire take rather than the last twelve seconds, so an octave error in bar
 * three is still there to be seen when the scale finishes.
 *
 * It also decodes whatever the browser can, which is the easy answer to getting
 * audio off a phone: m4a needs no conversion, because Safari and Chrome both
 * decode AAC natively and hand back plain samples.
 */
ui.file.addEventListener('change', () => {
  const [file] = ui.file.files;
  if (file) void analyseFile(file);
});

async function analyseFile(file) {
  state.running = false;
  ui.fileStatus.textContent = `Decoding ${file.name}…`;
  ui.notes.replaceChildren();

  let samples;
  let rate;
  try {
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    await context.close();

    // Rendered through the same anti-aliasing the live path uses, and down to
    // one channel, so the detector sees exactly what it would from a microphone.
    const offline = new OfflineAudioContext(1, decoded.length, decoded.sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    let node = source;
    for (let stage = 0; stage < ANTI_ALIAS_STAGES; stage++) {
      const filter = offline.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = ANTI_ALIAS_HZ;
      filter.Q.value = 0.707;
      node.connect(filter);
      node = filter;
    }
    node.connect(offline.destination);
    source.start();

    const rendered = await offline.startRendering();
    samples = rendered.getChannelData(0);
    rate = decoded.sampleRate;
  } catch (error) {
    ui.fileStatus.textContent = `Could not decode that file: ${String(error)}`;
    return;
  }

  const decimatedRate = rate / DECIMATION;
  const windowLength = Number(ui.windowSize.value) / DECIMATION;
  const hop = Math.round(decimatedRate / 50);
  const buffer = new Float32Array(windowLength);

  const points = [];
  for (let start = 0; start + windowLength * DECIMATION < samples.length; start += hop * DECIMATION) {
    for (let i = 0; i < windowLength; i++) buffer[i] = samples[start + i * DECIMATION];
    const { hz, confidence } = yin(buffer, decimatedRate, { minHz: 25, maxHz: 1200 });
    // Timed at the middle of the window rather than its start, since that is
    // the moment the reading actually describes.
    const at = (start + (windowLength * DECIMATION) / 2) / rate;
    const voiced = hz > 0 && confidence >= MIN_CONFIDENCE;
    points.push({ at, midi: voiced ? noteFromHz(hz).midi + noteFromHz(hz).cents / 100 : null, confidence });
  }

  state.span = samples.length / rate;
  state.history = points;
  draw();
  renderNotes(segment(points));

  const voiced = points.filter((p) => p.midi !== null).length;
  ui.fileStatus.textContent =
    `${file.name} — ${state.span.toFixed(1)}s at ${rate} Hz, ` +
    `${Math.round((voiced / Math.max(1, points.length)) * 100)}% voiced.`;
}

/**
 * Groups the readings into notes.
 *
 * A first pass at the segmentation the next version needs, and the quickest way
 * to check a recording by eye: a chromatic scale should come out as a chromatic
 * scale, and anything the detector invented is obvious in a list where it was
 * arguable in a plot.
 */
function segment(points) {
  const notes = [];
  let current = null;
  const close = () => {
    if (current && current.until - current.from >= HELD_SECONDS) notes.push(current);
    current = null;
  };

  for (const point of points) {
    if (point.midi === null) {
      close();
      continue;
    }
    if (current && Math.abs(point.midi - current.midi) * 100 <= SAME_NOTE_CENTS) {
      current.until = point.at;
      current.readings.push(point.midi);
    } else {
      close();
      current = { from: point.at, until: point.at, midi: point.midi, readings: [point.midi] };
    }
  }
  close();
  return notes;
}

function renderNotes(notes) {
  ui.notes.replaceChildren(
    ...notes.map((note) => {
      const mean = note.readings.reduce((a, b) => a + b, 0) / note.readings.length;
      const rounded = Math.round(mean);
      const item = document.createElement('li');
      item.textContent = noteFromHz(440 * 2 ** ((rounded - 69) / 12)).name;
      const detail = document.createElement('span');
      const cents = Math.round((mean - rounded) * 100);
      detail.textContent = `${((note.until - note.from) * 1000).toFixed(0)}ms ${cents >= 0 ? '+' : ''}${cents}c`;
      item.append(detail);
      return item;
    }),
  );
}
