/**
 * A soft pad: what the trial voice plays until the fingers are right.
 *
 * Deliberately nothing like the brass synth. That one opens with a bright
 * filter sweep — the very thing that makes it read as brass — and on the
 * trial path every note that came right *after* its onset played that sweep
 * before the swap; the player heard it as a synthetic twang on notes they
 * had got right. So this has no sweep and no edge: two triangles a few cents
 * apart under a fixed, dark lowpass, an attack of a twelfth of a second, and
 * — by the player's setting — half the instrument's level. A note that is
 * right from its onset
 * never hears it at all; a note that comes right late hears a soft cushion
 * give way to the instrument.
 */

import type { Voice } from './sampler';

const ATTACK = 0.08;
const RELEASE = 0.12;
const DETUNE_CENTS = 5;

export class PadSynth implements Voice {
  private readonly master: GainNode;
  private readonly context: AudioContext;
  private active: { gain: GainNode; oscillators: OscillatorNode[] } | null = null;

  constructor(context: AudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    this.master = context.createGain();
    // The same level the sampler sits at, so a cushion "at half" is half the
    // instrument: the fraction is applied outside, in `FollowingVoice`.
    this.master.gain.value = 0.85;
    this.master.connect(destination);
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * 0.85, this.context.currentTime, 0.01);
  }

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

  play(midi: number, startTime: number, durationSeconds: number): void {
    const ctx = this.context;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const endTime = startTime + Math.max(durationSeconds, ATTACK + 0.05);

    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    // Fixed and dark: nothing about it moves, so nothing about it twangs.
    filter.frequency.value = Math.min(frequency * 2.5, 1800);

    const floor = 0.0001;
    const releaseStart = Math.max(startTime + ATTACK, endTime - RELEASE);
    gain.gain.setValueAtTime(floor, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + ATTACK);
    gain.gain.setValueAtTime(1, releaseStart);
    gain.gain.exponentialRampToValueAtTime(floor, releaseStart + RELEASE);

    filter.connect(gain);
    gain.connect(this.master);

    const stopTime = releaseStart + RELEASE + 0.02;
    const oscillators: OscillatorNode[] = [];
    for (const detune of [-DETUNE_CENTS, DETUNE_CENTS]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, startTime);
      osc.detune.setValueAtTime(detune, startTime);
      osc.connect(filter);
      osc.start(startTime);
      osc.stop(stopTime);
      oscillators.push(osc);
    }

    this.active = { gain, oscillators };
    oscillators[oscillators.length - 1].addEventListener('ended', () => {
      if (this.active?.gain === gain) this.active = null;
      gain.disconnect();
      filter.disconnect();
    });
  }
}
