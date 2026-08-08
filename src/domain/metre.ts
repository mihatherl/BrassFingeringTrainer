/**
 * Metre: the difference between what is written, how long a bar is, and what
 * you actually feel.
 *
 * Three things get called "the beat" and they are only the same thing in simple
 * time, which is why they are separated here before anything depends on it.
 *
 *  - **The time unit** is the crotchet. Everything in the app measures duration
 *    in crotchets, so `timeForBeat` is a multiplication and a dotted crotchet is
 *    just 1.5. That choice is right and is not what varies.
 *  - **The written signature** is the pair of numbers on the stave. 6/8 says
 *    six quavers; it does not say a bar is six of anything the clock counts.
 *  - **The pulse** is what a conductor beats and a metronome should click. In
 *    6/8 that is a dotted crotchet, two to a bar — *not* six.
 *
 * The numerator and the length of a bar in crotchets are equal only while the
 * denominator is 4, which is every metre the app currently offers. So the two
 * have been indistinguishable so far and would silently diverge the first time
 * anyone chose 6/8: bar lines in the wrong place, quavers beamed in twos where
 * they should be in threes, and a metronome clicking three times a bar in
 * musically meaningless places.
 */

export interface Metre {
  /** Top number of the written time signature — the 6 in 6/8. */
  beatsPerBar: number;
  /** Bottom number — the 8 in 6/8. */
  beatUnit: number;
  /**
   * Length of a bar in crotchets: 4 for 4/4, but 3 for 6/8.
   *
   * The number every piece of bar arithmetic wants, and the one the numerator
   * is mistaken for.
   */
  barBeats: number;
  /** Length of one conducted pulse in crotchets: 1 for 4/4, 1.5 for 6/8. */
  pulseBeats: number;
  /** Pulses in a bar: 4 for 4/4, 2 for 6/8. Conducting patterns are indexed by this. */
  pulsesPerBar: number;
  /** Whether the beat divides into three rather than two. */
  isCompound: boolean;
}

/**
 * Whether a signature is compound.
 *
 * A numerator divisible by three, over a division of the beat smaller than a
 * crotchet. 3/8 is excluded deliberately: it is three quavers felt as three,
 * not one dotted crotchet felt as one — a bar of 3/8 is conducted in three at
 * anything but a very fast tempo, and treating it as compound would beam a
 * whole bar together and click once.
 */
function compound(beatsPerBar: number, beatUnit: number): boolean {
  return beatUnit >= 8 && beatsPerBar > 3 && beatsPerBar % 3 === 0;
}

export function metreFor(beatsPerBar: number, beatUnit: number): Metre {
  // A crotchet is 4 of whatever the denominator counts, so this converts the
  // written signature into the unit everything else is measured in.
  const writtenBeat = 4 / beatUnit;
  const isCompound = compound(beatsPerBar, beatUnit);
  const barBeats = beatsPerBar * writtenBeat;
  // Compound time groups its written beats in threes, and the group is the
  // pulse: three quavers make the dotted crotchet that gets conducted.
  const pulseBeats = isCompound ? writtenBeat * 3 : writtenBeat;

  return {
    beatsPerBar,
    beatUnit,
    barBeats,
    pulseBeats,
    pulsesPerBar: Math.round(barBeats / pulseBeats),
    isCompound,
  };
}

/** Which bar a beat falls in, counting from zero. */
export function barAt(metre: Metre, beat: number): number {
  return Math.floor(beat / metre.barBeats);
}

/** Where a bar starts, in crotchets. */
export function beatOfBar(metre: Metre, bar: number): number {
  return bar * metre.barBeats;
}

/**
 * Which pulse of the bar a beat falls on, counting from zero.
 *
 * Fractional between pulses, so a conductor can read its position in the
 * pattern straight from it and a metronome can take the whole numbers.
 */
export function pulseAt(metre: Metre, beat: number): number {
  return beat / metre.pulseBeats;
}
