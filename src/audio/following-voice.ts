/**
 * A trial voice: a synth pad until the note is played right, the recorded
 * instrument once it is.
 *
 * Asked for by the player on 2026-08-16 as an experiment, and reachable only
 * by `?voice=pad` on the URL — the same door `?tier=free` uses — so it can be
 * tried on a phone without changing what anyone else hears. The question it
 * asks: is a *change of sound* on the right fingering a better answer than a
 * change of volume?
 *
 * Both voices are given every note, since notes are scheduled ahead of time
 * on the audio thread and cannot be re-decided when the fingers land. What
 * can be decided late is which is heard: two gains, one per voice, and the
 * session's word on whether the fingers answer the note sounding now moves
 * them — pad up and instrument down while they do not, the reverse the moment
 * they do — over twenty milliseconds, so the swap is a change of colour and
 * not a click.
 */

import type { SampleSet } from '../domain/instruments';
import { Sampler, type Voice } from './sampler';
import { BrassSynth } from './synth';

/** How long the swap between the two takes, in seconds. */
const SWAP = 0.02;

export class FollowingVoice implements Voice {
  private readonly context: AudioContext;
  private readonly padGain: GainNode;
  private readonly instrumentGain: GainNode;
  private readonly pad: BrassSynth;
  private readonly instrument: Sampler;

  private constructor(context: AudioContext, pad: BrassSynth, instrument: Sampler, gains: [GainNode, GainNode]) {
    this.context = context;
    this.pad = pad;
    this.instrument = instrument;
    [this.padGain, this.instrumentGain] = gains;
  }

  /** Loads the recorded instrument behind the pad; throws where the samples cannot be had. */
  static async load(context: AudioContext, set: SampleSet): Promise<FollowingVoice> {
    const padGain = context.createGain();
    const instrumentGain = context.createGain();
    // The pad is what is heard first: a run opens with nothing played.
    padGain.gain.value = 1;
    instrumentGain.gain.value = 0;
    padGain.connect(context.destination);
    instrumentGain.connect(context.destination);
    const pad = new BrassSynth(context, padGain);
    const instrument = await Sampler.load(context, set, instrumentGain);
    return new FollowingVoice(context, pad, instrument, [padGain, instrumentGain]);
  }

  play(midi: number, startTime: number, durationSeconds: number): void {
    this.pad.play(midi, startTime, durationSeconds);
    this.instrument.play(midi, startTime, durationSeconds);
  }

  setVolume(volume: number): void {
    this.pad.setVolume(volume);
    this.instrument.setVolume(volume);
  }

  stop(time?: number): void {
    this.pad.stop(time);
    this.instrument.stop(time);
  }

  /**
   * Which of the two is heard: the instrument while the fingers answer the
   * note sounding, the pad while they do not. The session's verdict, every
   * tick; see `Session.followFingers`.
   */
  follow(right: boolean): void {
    const now = this.context.currentTime;
    this.padGain.gain.setTargetAtTime(right ? 0 : 1, now, SWAP);
    this.instrumentGain.gain.setTargetAtTime(right ? 1 : 0, now, SWAP);
  }
}
