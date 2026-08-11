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

/** The metre everything falls back to when a list is empty. */
const COMMON_TIME = metreFor(4, 4);

/** A metre coming into force, and the beat it does so on. */
export interface MetreChange {
  /**
   * Beats from the start of the exercise. The first is always 0.
   *
   * **A change falls on a bar line** — the bar before it is a whole bar of the
   * metre it is leaving. Music does write a short bar before a change, but the
   * two are separable: that is a partial bar, which is its own thing, and not
   * something a reader should have to infer from a metre change landing in an
   * odd place. Bar counting here assumes the bar line and rounds if given
   * otherwise, rather than silently renumbering everything downstream.
   */
  fromBeat: number;
  metre: Metre;
}

/**
 * The metre in force at a beat.
 *
 * The same shape as `keyAt`, deliberately and for the same reason: a part
 * changes time signature as it changes key, and the two want asking the same
 * way rather than each inventing its own lookup. `metre.ts`'s own comment has
 * promised this since it was written.
 *
 * Total over negative beats, because the count-in sits there: before the first
 * change, the first metre applies. An empty list answers common time rather
 * than throwing, since a renderer midway through a frame is no place to
 * discover a malformed exercise.
 */
export function metreAt(changes: readonly MetreChange[], beat: number): Metre {
  let metre = changes[0]?.metre ?? COMMON_TIME;
  for (const change of changes) {
    if (change.fromBeat > beat) break;
    metre = change.metre;
  }
  return metre;
}

/** Whether the metre ever changes, for the many places that only care if it does. */
export function changesMetre(changes: readonly MetreChange[]): boolean {
  return changes.length > 1;
}

/**
 * Which bar a beat falls in, counting from zero.
 *
 * Takes the whole list rather than one metre because bar numbering is the thing
 * a metre change actually breaks: `beat / barBeats` is right up to the change
 * and wrong for every bar after it. The walk accumulates whole bars per segment,
 * so bar 30 of a piece that turns from 4/4 into 3/4 is where a player counting
 * from the top would put it.
 *
 * Negative beats extend the first segment downwards, which is where the
 * count-in lives.
 */
export function barAt(changes: readonly MetreChange[], beat: number): number {
  if (changes.length === 0) return Math.floor(beat / COMMON_TIME.barBeats);

  let bars = 0;
  for (let i = 0; i < changes.length; i++) {
    const { fromBeat, metre } = changes[i];
    const until = changes[i + 1]?.fromBeat ?? Infinity;
    if (beat < until) return bars + Math.floor((beat - fromBeat) / metre.barBeats);
    bars += Math.round((until - fromBeat) / metre.barBeats);
  }
  return bars;
}

/** Where a bar starts, in crotchets. The exact inverse of `barAt` at every bar line. */
export function beatOfBar(changes: readonly MetreChange[], bar: number): number {
  if (changes.length === 0) return bar * COMMON_TIME.barBeats;

  let bars = 0;
  for (let i = 0; i < changes.length; i++) {
    const { fromBeat, metre } = changes[i];
    const until = changes[i + 1]?.fromBeat ?? Infinity;
    // Infinite for the last segment, so it always answers and the loop is total.
    const inSegment = Math.round((until - fromBeat) / metre.barBeats);
    if (bar - bars < inSegment) return fromBeat + (bar - bars) * metre.barBeats;
    bars += inSegment;
  }
  return changes[changes.length - 1].fromBeat;
}

/**
 * How many bars a piece of this length occupies.
 *
 * The last bar counts even when the music stops part-way through it, because a
 * partial bar is still a bar to draw and to fit on a line. Never fewer than
 * one: an empty exercise still has a bar to put its clef in.
 *
 * Here rather than at the seven call sites that each wrote
 * `Math.ceil(totalBeats / barBeats)`, which is the same figure only while one
 * metre runs the whole piece.
 */
export function barCount(changes: readonly MetreChange[], totalBeats: number): number {
  const last = barAt(changes, totalBeats);
  const partial = beatOfBar(changes, last) < totalBeats - 1e-9;
  return Math.max(1, partial ? last + 1 : last);
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
