/**
 * Metronome clicks.
 *
 * A short pitched blip with a fast exponential decay: audible over a synth line
 * without being tiring, and cheap enough to schedule hundreds of.
 */

const ACCENT_FREQUENCY = 1800;
const BEAT_FREQUENCY = 1200;
const DECAY = 0.05;

export class Metronome {
  private readonly master: GainNode;
  private readonly context: AudioContext;

  constructor(context: AudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(destination);
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * 0.25, this.context.currentTime, 0.01);
  }

  /** Schedules a click at an absolute audio-context time. */
  click(time: number, accent = false): void {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(accent ? ACCENT_FREQUENCY : BEAT_FREQUENCY, time);

    gain.gain.setValueAtTime(accent ? 0.9 : 0.55, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + DECAY);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + DECAY + 0.01);
    osc.addEventListener('ended', () => gain.disconnect());
  }
}
