/**
 * A synthesised brass voice.
 *
 * The single most important characteristic of a brass tone is that its
 * brightness rises sharply during the attack and then settles — the spectrum
 * opens as the lips and air get going. Sweeping a lowpass filter over a pair of
 * detuned sawtooths reproduces enough of that to read unmistakably as "brass",
 * at a few dozen lines and no download.
 */

export interface VoiceOptions {
  /** 0..1 */
  velocity?: number;
}

const DETUNE_CENTS = 7;
const ATTACK = 0.035;
const RELEASE = 0.09;
const SUSTAIN_RATIO = 0.78;
const VIBRATO_MINIMUM_DURATION = 0.45;

export class BrassSynth {
  private readonly master: GainNode;
  private readonly context: AudioContext;
  private active: { gain: GainNode; oscillators: OscillatorNode[] } | null = null;

  constructor(context: AudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.3;
    this.master.connect(destination);
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * 0.3, this.context.currentTime, 0.01);
  }

  get output(): AudioNode {
    return this.master;
  }

  /** Cuts short the note in progress, keeping the voice monophonic. */
  stop(time?: number): void {
    const active = this.active;
    if (!active) return;
    this.active = null;

    const at = Math.max(time ?? this.context.currentTime, this.context.currentTime);
    const floor = 0.0001;
    active.gain.gain.cancelScheduledValues(at);
    active.gain.gain.setValueAtTime(Math.max(active.gain.gain.value, floor), at);
    active.gain.gain.exponentialRampToValueAtTime(floor, at + 0.04);
    for (const osc of active.oscillators) {
      try {
        osc.stop(at + 0.05);
      } catch {
        // Already stopped.
      }
    }
  }

  /**
   * Schedules one note. All timings are absolute audio-context times, so this
   * can be called well ahead of when the note sounds.
   */
  play(midi: number, startTime: number, durationSeconds: number, options: VoiceOptions = {}): void {
    const ctx = this.context;
    const velocity = options.velocity ?? 0.9;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const endTime = startTime + Math.max(durationSeconds, ATTACK + 0.05);

    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;

    // Brightness envelope: open quickly on the attack, then settle back.
    const peak = Math.min(frequency * 7, ctx.sampleRate / 2.2);
    const settled = Math.min(frequency * 3.2, ctx.sampleRate / 2.5);
    filter.frequency.setValueAtTime(Math.max(frequency * 1.4, 120), startTime);
    filter.frequency.linearRampToValueAtTime(peak, startTime + ATTACK * 1.3);
    filter.frequency.exponentialRampToValueAtTime(settled, startTime + ATTACK + 0.22);

    // Amplitude envelope. Exponential ramps cannot touch zero, hence the floor.
    const floor = 0.0001;
    const sustain = Math.max(velocity * SUSTAIN_RATIO, floor * 2);
    const sustainReachedAt = startTime + ATTACK + 0.12;
    const releaseStart = Math.max(sustainReachedAt, endTime - RELEASE);

    gain.gain.setValueAtTime(floor, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(velocity, floor * 2), startTime + ATTACK);
    gain.gain.exponentialRampToValueAtTime(sustain, sustainReachedAt);
    gain.gain.setValueAtTime(sustain, releaseStart);
    gain.gain.exponentialRampToValueAtTime(floor, releaseStart + RELEASE);

    filter.connect(gain);
    gain.connect(this.master);

    const stopTime = releaseStart + RELEASE + 0.02;
    const oscillators: OscillatorNode[] = [];

    for (const detune of [-DETUNE_CENTS, DETUNE_CENTS]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, startTime);
      osc.detune.setValueAtTime(detune, startTime);
      osc.connect(filter);
      osc.start(startTime);
      osc.stop(stopTime);
      oscillators.push(osc);
    }

    // Only longer notes get vibrato; on a semiquaver run it would be a smear.
    if (durationSeconds >= VIBRATO_MINIMUM_DURATION) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = 5.2;
      depth.gain.setValueAtTime(0, startTime);
      depth.gain.linearRampToValueAtTime(6, startTime + 0.25);
      lfo.connect(depth);
      for (const osc of oscillators) depth.connect(osc.detune);
      lfo.start(startTime);
      lfo.stop(stopTime);
      oscillators.push(lfo);
    }

    this.active = { gain, oscillators };

    const last = oscillators[oscillators.length - 1];
    last.addEventListener('ended', () => {
      if (this.active?.gain === gain) this.active = null;
      gain.disconnect();
      filter.disconnect();
    });
  }
}
