/**
 * The quiet reference tone that marks what the note *should* be.
 *
 * This is not meant to be an instrument. Its whole job is to indicate a pitch
 * while the player's own sound stays plainly in front, so it is built to be as
 * unlike brass as possible: a triangle wave, whose harmonics fall away fast,
 * rather than the sawtooth-plus-filter that makes a brass tone brass. An earlier
 * version used sawtooths and, however differently it was constructed, it simply
 * sounded like a second player doubling the first — a bit louder.
 *
 * So: pure, soft-edged, well down in the mix, and slightly to the sides while
 * the player's voice holds the centre.
 */

const ATTACK = 0.05;
const RELEASE = 0.26;
const SUSTAIN_RATIO = 0.8;

/** Deliberately low. This should be audible, never prominent. */
const LEVEL = 0.1;

export class PadSynth {
  private readonly master: GainNode;
  private readonly context: AudioContext;

  constructor(context: AudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = LEVEL;
    this.master.connect(destination);
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume * LEVEL, this.context.currentTime, 0.01);
  }

  /** Schedules a note at an absolute audio-context time. */
  play(midi: number, startTime: number, durationSeconds: number, velocity = 0.8): void {
    const ctx = this.context;
    const frequency = 440 * 2 ** ((midi - 69) / 12);

    const attack = Math.min(ATTACK, Math.max(0.02, durationSeconds * 0.3));
    const endTime = startTime + Math.max(durationSeconds, attack + 0.05);

    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    // A triangle is already dark; this only takes the edge off the top.
    filter.frequency.setValueAtTime(Math.min(3000, Math.max(600, frequency * 8)), startTime);

    const floor = 0.0001;
    const sustain = Math.max(velocity * SUSTAIN_RATIO, floor * 2);
    const peakAt = startTime + attack;
    const releaseStart = Math.max(peakAt, endTime - RELEASE * 0.5);

    gain.gain.setValueAtTime(floor, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(velocity, floor * 2), peakAt);
    gain.gain.exponentialRampToValueAtTime(sustain, peakAt + 0.08);
    gain.gain.setValueAtTime(sustain, releaseStart);
    gain.gain.exponentialRampToValueAtTime(floor, releaseStart + RELEASE);

    filter.connect(gain);
    gain.connect(this.master);

    const stopTime = releaseStart + RELEASE + 0.02;

    // Fundamental, with a quiet octave above for definition — enough to pitch
    // it clearly at the bottom of a tuba's range without adding any bite.
    const parts: Array<{ ratio: number; level: number; pan: number }> = [
      { ratio: 1, level: 1, pan: -0.25 },
      { ratio: 2, level: 0.22, pan: 0.25 },
    ];

    const nodes: AudioNode[] = [];
    let last: OscillatorNode | null = null;

    for (const part of parts) {
      const osc = ctx.createOscillator();
      const level = ctx.createGain();
      const panner = ctx.createStereoPanner();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency * part.ratio, startTime);
      level.gain.setValueAtTime(part.level, startTime);
      panner.pan.setValueAtTime(part.pan, startTime);
      osc.connect(level);
      level.connect(panner);
      panner.connect(filter);
      osc.start(startTime);
      osc.stop(stopTime);
      nodes.push(level, panner);
      last = osc;
    }

    last?.addEventListener('ended', () => {
      gain.disconnect();
      filter.disconnect();
      for (const node of nodes) node.disconnect();
    });
  }
}
