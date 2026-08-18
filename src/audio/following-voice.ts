/**
 * The reference voice: a soft pad until the note is played right, the
 * recorded instrument once it is.
 *
 * Trialled by the player on 2026-08-16 behind `?voice=pad`, and adopted the
 * same day: a *change of sound* on the right fingering, rather than a change
 * of volume. `?voice=plain` is the way back to the instrument alone, for
 * comparing.
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

/** The pad's level against the instrument's, out of the box: half. */
export const DEFAULT_CUSHION = 0.5;

export class FollowingVoice implements Voice {
  private readonly context: AudioContext;
  private readonly padGain: GainNode;
  private readonly instrumentGain: GainNode;
  /** The cushion's level against the instrument's; see `setCushion`. */
  private readonly cushionGain: GainNode;
  private readonly pad: PadSynth;
  private readonly instrument: Sampler;
  /** The note most recently given, so a late right can re-attack it. */
  private current: { midi: number; startTime: number; endTime: number } | null = null;
  private right = true;

  private constructor(
    context: AudioContext,
    pad: PadSynth,
    instrument: Sampler,
    gains: [GainNode, GainNode, GainNode],
  ) {
    this.context = context;
    this.pad = pad;
    this.instrument = instrument;
    [this.padGain, this.instrumentGain, this.cushionGain] = gains;
  }

  /**
   * Loads the recorded instrument behind the pad; throws where the samples
   * cannot be had. `cushion` is the pad's level against the instrument's,
   * the player's setting.
   */
  static async load(
    context: AudioContext,
    set: SampleSet,
    cushion = DEFAULT_CUSHION,
  ): Promise<FollowingVoice> {
    const padGain = context.createGain();
    const cushionGain = context.createGain();
    const instrumentGain = context.createGain();
    // The instrument is what is heard first: a run opens with the benefit of
    // the doubt, and the pad arrives with the first wrong fingering.
    padGain.gain.value = 0;
    instrumentGain.gain.value = 1;
    cushionGain.gain.value = cushion;
    // pad → its level against the instrument → the swap → out.
    cushionGain.connect(padGain);
    padGain.connect(context.destination);
    instrumentGain.connect(context.destination);
    const pad = new PadSynth(context, cushionGain);
    const instrument = await Sampler.load(context, set, instrumentGain);
    return new FollowingVoice(context, pad, instrument, [padGain, instrumentGain, cushionGain]);
  }

  /**
   * The pad's level against the instrument's, from nothing to as loud: the
   * player's setting, and the one thing about the cushion worth a control.
   */
  setCushion(level: number): void {
    this.cushionGain.gain.setTargetAtTime(
      Math.min(1, Math.max(0, level)),
      this.context.currentTime,
      0.01,
    );
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
