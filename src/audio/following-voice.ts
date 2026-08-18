/**
 * A trial voice: a soft pad until the note is played right, the recorded
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
 * can be decided late is which is heard, and — for the instrument — when it
 * speaks. Two gains, one per voice, and the session's word on whether the
 * fingers answer the note sounding now moves them. And when the fingers come
 * right part-way through a note, the instrument is not merely unmuted into
 * its sustain: it is started afresh from that moment for the rest of the
 * note, so it *speaks* when the fingering lands, as a player's own note
 * would. The first version unmuted the running note and the player heard the
 * pad's attack, then a sustain with no beginning; see `pad.ts` for the other
 * half of that fix.
 */

import type { SampleSet } from '../domain/instruments';
import { PadSynth } from './pad';
import { Sampler, type Voice } from './sampler';

/** How long the swap between the two takes, in seconds. */
const SWAP = 0.02;

/**
 * The least of a note that is worth re-attacking the instrument for. Coming
 * right in the last few hundredths of a note is a note gone; the next one
 * will speak on its own.
 */
const MIN_REATTACK = 0.08;

export class FollowingVoice implements Voice {
  private readonly context: AudioContext;
  private readonly padGain: GainNode;
  private readonly instrumentGain: GainNode;
  private readonly pad: PadSynth;
  private readonly instrument: Sampler;
  /** The note most recently given, so a late right can re-attack it. */
  private current: { midi: number; startTime: number; endTime: number } | null = null;
  private right = true;

  private constructor(context: AudioContext, pad: PadSynth, instrument: Sampler, gains: [GainNode, GainNode]) {
    this.context = context;
    this.pad = pad;
    this.instrument = instrument;
    [this.padGain, this.instrumentGain] = gains;
  }

  /** Loads the recorded instrument behind the pad; throws where the samples cannot be had. */
  static async load(context: AudioContext, set: SampleSet): Promise<FollowingVoice> {
    const padGain = context.createGain();
    const instrumentGain = context.createGain();
    // The instrument is what is heard first: a run opens with the benefit of
    // the doubt, and the pad arrives with the first wrong fingering.
    padGain.gain.value = 0;
    instrumentGain.gain.value = 1;
    padGain.connect(context.destination);
    instrumentGain.connect(context.destination);
    const pad = new PadSynth(context, padGain);
    const instrument = await Sampler.load(context, set, instrumentGain);
    return new FollowingVoice(context, pad, instrument, [padGain, instrumentGain]);
  }

  play(midi: number, startTime: number, durationSeconds: number): void {
    this.current = { midi, startTime, endTime: startTime + durationSeconds };
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
   * note sounding, the pad while they do not. The session's verdict, on every
   * change; see `Session.followFingers`. Coming right inside a note starts
   * the instrument's note again from now, so it has an attack of its own.
   */
  follow(right: boolean): void {
    const now = this.context.currentTime;
    const wasRight = this.right;
    this.right = right;
    this.padGain.gain.setTargetAtTime(right ? 0 : 1, now, SWAP);
    this.instrumentGain.gain.setTargetAtTime(right ? 1 : 0, now, SWAP);

    const note = this.current;
    if (right && !wasRight && note && now > note.startTime && note.endTime - now > MIN_REATTACK) {
      // The running instrument note has been silent under its gain; let it
      // go, and speak the note from here for what is left of it.
      this.instrument.stop(now);
      this.instrument.play(note.midi, now, note.endTime - now);
    }
  }
}
