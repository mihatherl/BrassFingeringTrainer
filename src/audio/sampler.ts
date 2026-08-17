/**
 * A sampled instrument voice.
 *
 * Plays recorded brass rather than synthesised, choosing the nearest sampled
 * note and shifting it to pitch by playback rate. Because the samples sit three
 * semitones apart, nothing is ever shifted by more than a tone — far too little
 * to sound stretched, and a third of the download of a full chromatic set.
 *
 * The interface deliberately matches `BrassSynth.play`, so the session can hold
 * either without caring which, and fall back to synthesis if loading fails.
 */

import type { SampleSet } from '../domain/instruments';
import { SAMPLE_MANIFEST } from './sample-manifest';

/** Anything that can sound a note at an absolute audio-context time. */
export interface Voice {
  play(midi: number, startTime: number, durationSeconds: number): void;
  setVolume(volume: number): void;
  /** Cuts short whatever is currently sounding, so the voice stays monophonic. */
  stop(time?: number): void;
  /**
   * Told, where the voice wants to know, whether the fingers answer the note
   * sounding now — every tick, on every change. A voice with this changes its
   * *sound* on the fingering rather than having its volume halved; see
   * `FollowingVoice`, which is the one that does.
   */
  follow?(right: boolean): void;
}

const ATTACK = 0.006;
const RELEASE = 0.12;

/**
 * Where a looped sustain starts within the sample, in seconds.
 *
 * Past the recorded attack, which is over inside a tenth of a second — measured
 * rather than assumed: these samples hold 98–100% of peak from 0.1s to the very
 * end, with no decay and no release tail. They simply stop.
 */
const LOOP_FROM = 0.5;

/** Kept clear of the last moments of the buffer, where an editor may have faded. */
const LOOP_TAIL = 0.05;

/**
 * Fewest wave periods worth looping. Below this the loop is so short that any
 * imperfection in the recording's tuning beats audibly against itself.
 */
const MIN_LOOP_PERIODS = 8;

/** Equal-tempered frequency of a MIDI note, which is the sample's own pitch. */
function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Makes a source loop, where the note outlasts the recording.
 *
 * A sample runs three seconds; a tied note in a real part runs nine. Without
 * this the buffer simply ends and the note goes silent part way through — which
 * is what a four-bar tied G did, falling quiet after about two.
 *
 * **The loop is a whole number of wave periods.** A loop of arbitrary length
 * restarts the waveform at the wrong point in its cycle, and that phase jump is
 * a click, once per loop, for as long as the note lasts. Snapping the length to
 * the fundamental's period means the wave continues where it left off. The
 * sample's own MIDI number gives that frequency exactly, so nothing has to be
 * measured at runtime.
 */
function loopSustain(node: AudioBufferSourceNode, buffer: AudioBuffer, sampleMidi: number): void {
  const region = sustainLoop(buffer.duration, sampleMidi);
  if (!region) return;
  node.loop = true;
  node.loopStart = region.from;
  node.loopEnd = region.to;
}

/**
 * The stretch of a sample worth looping, or null if there is not enough of it.
 *
 * Exported for tests: that the region is a whole number of wave periods is the
 * whole point of it, and that is arithmetic rather than anything audible.
 * Measured against a real sample, snapping cut the worst sample-to-sample jump
 * at the loop from 0.028 to 0.009 — where the largest jump occurring naturally
 * inside that recording is 0.007, so the snapped loop is within a whisker of
 * the material and the unsnapped one is four times it.
 */
export function sustainLoop(
  bufferSeconds: number,
  sampleMidi: number,
): { from: number; to: number } | null {
  const from = Math.min(LOOP_FROM, bufferSeconds * 0.25);
  const until = bufferSeconds - LOOP_TAIL;
  const period = 1 / frequencyOf(sampleMidi);
  const periods = Math.floor((until - from) / period);
  if (periods < MIN_LOOP_PERIODS) return null;
  return { from, to: from + periods * period };
}

/** Decoded sample sets, kept for the life of the page so a replay is instant. */
const cache = new Map<SampleSet, Promise<Map<number, AudioBuffer>>>();

/** The sampled note used to reach a pitch: whichever lies closest. */
export function nearestSample(pitches: readonly number[], midi: number): number {
  return pitches.reduce((best, pitch) =>
    Math.abs(pitch - midi) < Math.abs(best - midi) ? pitch : best,
  );
}

/** Twelfth root of two per semitone — the ratio that defines the scale. */
export function playbackRateFor(midi: number, sample: number): number {
  return 2 ** ((midi - sample) / 12);
}

function sampleUrl(set: SampleSet, midi: number): string {
  // Relative to the deployed base, so it survives being served from a subpath.
  return `${import.meta.env.BASE_URL}samples/${set}/${midi}.mp3`;
}

async function loadBuffers(
  context: AudioContext,
  set: SampleSet,
): Promise<Map<number, AudioBuffer>> {
  const midis = SAMPLE_MANIFEST[set];
  const buffers = await Promise.all(
    midis.map(async (midi) => {
      const response = await fetch(sampleUrl(set, midi));
      if (!response.ok) throw new Error(`${set}/${midi}: HTTP ${response.status}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }),
  );
  return new Map(midis.map((midi, index) => [midi, buffers[index]]));
}

export class Sampler implements Voice {
  private readonly master: GainNode;
  private readonly context: AudioContext;
  private readonly buffers: Map<number, AudioBuffer>;
  private readonly pitches: number[];
  private active: { gain: GainNode; node: AudioBufferSourceNode } | null = null;

  private constructor(
    context: AudioContext,
    buffers: Map<number, AudioBuffer>,
    destination: AudioNode,
  ) {
    this.context = context;
    this.buffers = buffers;
    this.pitches = [...buffers.keys()].sort((a, b) => a - b);
    this.master = context.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(destination);
  }

  /**
   * Loads a voice, decoding every sample up front.
   *
   * Decoding mid-exercise would drop notes, so it all happens behind the start
   * gate. Repeat loads are served from cache.
   */
  static async load(
    context: AudioContext,
    set: SampleSet,
    destination: AudioNode = context.destination,
  ): Promise<Sampler> {
    let pending = cache.get(set);
    if (!pending) {
      pending = loadBuffers(context, set);
      cache.set(set, pending);
    }
    try {
      return new Sampler(context, await pending, destination);
    } catch (error) {
      // A failed load must not be remembered, or a retry could never succeed.
      cache.delete(set);
      throw error;
    }
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * 0.85, this.context.currentTime, 0.01);
  }

  /**
   * Silences the note in progress with a short fade.
   *
   * The player's voice is one instrument and can only sound one note at a time,
   * so a new note has to displace the old rather than pile on top of it.
   */
  stop(time?: number): void {
    const active = this.active;
    if (!active) return;
    this.active = null;

    const at = Math.max(time ?? this.context.currentTime, this.context.currentTime);
    const floor = 0.0001;
    active.gain.gain.cancelScheduledValues(at);
    active.gain.gain.setValueAtTime(Math.max(active.gain.gain.value, floor), at);
    active.gain.gain.exponentialRampToValueAtTime(floor, at + 0.04);
    try {
      active.node.stop(at + 0.05);
    } catch {
      // Already stopped; nothing to do.
    }
  }

  play(midi: number, startTime: number, durationSeconds: number): void {
    if (this.pitches.length === 0) return;
    const source = nearestSample(this.pitches, midi);
    const buffer = this.buffers.get(source);
    if (!buffer) return;

    const ctx = this.context;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = playbackRateFor(midi, source);

    const gain = ctx.createGain();
    const end = startTime + Math.max(durationSeconds, ATTACK + 0.03);
    const floor = 0.0001;

    // The recording carries its own attack, so this envelope only removes the
    // click at each edge and stops the note when it is over.
    gain.gain.setValueAtTime(floor, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + ATTACK);
    gain.gain.setValueAtTime(1, Math.max(startTime + ATTACK, end - RELEASE));
    gain.gain.exponentialRampToValueAtTime(floor, end);

    /*
     * `loopStart` and `loopEnd` are positions in the buffer, so they are not
     * affected by the playback rate — but how long the buffer *lasts* is, since
     * a note played below the sample's pitch is slowed down. That is what
     * decides whether looping is needed at all.
     */
    if (end - startTime > buffer.duration / node.playbackRate.value) {
      loopSustain(node, buffer, source);
    }

    node.connect(gain);
    gain.connect(this.master);
    node.start(startTime);
    node.stop(end + 0.02);

    this.active = { gain, node };
    node.addEventListener('ended', () => {
      if (this.active?.node === node) this.active = null;
      gain.disconnect();
    });
  }
}
