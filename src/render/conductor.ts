/**
 * The on-screen conductor: a baton beating the metre, above the music.
 *
 * A click tells you where the beat *is*; a conductor tells you where it is
 * going to be. Practising only to a click teaches a player to be led by the
 * beat rather than to anticipate it, and no metronome can teach a rit. at all.
 *
 * The geometry was worked out in `public/spike/conductor-shape.js` against
 * conducting diagrams and Lesley Mann's *Music in Motion*; `docs/v2-design.md`
 * records how a pattern is read off a diagram and why each part is as it is.
 * The three things that matter most here:
 *
 * **Patterns are drawn as the band sees them**, which is the mirror of every
 * published diagram — those are all from the conductor's own side.
 *
 * **They are keyed by pulses, never by the numerator.** 6/8 is beaten in two,
 * 9/8 in three, 12/8 in four, so compound time needs no pattern of its own.
 *
 * **The bar is one closed curve and the beat is a point on it.** Drawing each
 * stroke as its own curve makes every ictus a seam where two tangents
 * disagree, so the tip turns a corner — which a hand with mass cannot do.
 * Shape and timing are then separate: the curve says where the tip goes, the
 * phase warp says when.
 */

import type { Metre } from '../domain/metre';

export interface ConductorPoint {
  x: number;
  y: number;
}

interface Beat extends ConductorPoint {
  /** How high the arc leaving this beat rises. */
  rebound: number;
  /**
   * Points the stroke leaving this beat must pass through, where the single
   * default apex cannot draw it. The two pattern needs them: its hand sweeps
   * *past* beat two and comes back so the second hook curls the other way, and
   * one turning point out there would flatten beat one's hook instead.
   */
  path?: ConductorPoint[];
}

export type ConductorPattern = Beat[];

/**
 * Where the tip lands, per pulse count. All coordinates are normalised: x runs
 * left to right, y downward.
 *
 * Only two, three and four exist. Anything else has no pattern and gets no
 * conductor — see `patternFor`.
 */
const PATTERNS: Record<number, ConductorPattern> = {
  // A J and a reverse J. Beat two sits above the downbeat, and the hand sweeps
  // past it and back so the two hooks curl in opposite senses.
  2: [
    {
      x: 0,
      y: 1,
      rebound: 0.38,
      path: [
        { x: -0.15, y: 0.62 },
        { x: -0.44, y: 0.42 },
      ],
    },
    { x: -0.3, y: 0.72, rebound: 1.05 },
  ],
  // Two beats on the floor, the upbeat above the second of them, then one long
  // diagonal climbing the width of the pattern to the top.
  3: [
    { x: 0, y: 1, rebound: 0.26 },
    { x: -0.74, y: 1, rebound: 0.42 },
    { x: -0.76, y: 0.78, rebound: 1.05 },
  ],
  // All four on one floor: a low lobe out, the long stroke across, the lobe
  // back, then straight up and straight down. The eight is where that long
  // stroke passes through the vertical.
  4: [
    { x: 0, y: 1, rebound: 0.34 },
    { x: 0.78, y: 1, rebound: 0.5 },
    { x: -0.78, y: 1, rebound: 0.34 },
    { x: -0.16, y: 1, rebound: 1.15 },
  ],
};

/**
 * The pattern for a metre, or null when there is none.
 *
 * **Null means the conductor switches off and the metronome carries on.** A
 * conducting pattern is a specific taught shape, not something to interpolate:
 * a five is not a four with a beat wedged in, and an invented one would teach a
 * player to follow a gesture no conductor will ever make. Imported music will
 * bring metres we have no pattern for, and silence from the conductor is honest
 * where a plausible-looking wrong pattern is not.
 */
export function patternFor(metre: Metre): ConductorPattern | null {
  return PATTERNS[metre.pulsesPerBar] ?? null;
}

/** How far the departing arc swings outward, away from the pattern's middle. */
const SWING = 0.22;
/** How much of the pattern the grip travels, against the tip's whole excursion. */
const GRIP_TRAVEL = 0.3;

function centreOf(pattern: ConductorPattern): ConductorPoint {
  const sum = pattern.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pattern.length, y: sum.y / pattern.length };
}

/**
 * The apex between two beats: a real point on the path, not a control point.
 *
 * The last apex of the bar sits directly over the downbeat rather than half way
 * back to it. Mann's "the final rebound must return to the starting point of
 * the downbeat" is geometry rather than size — the starting point of a downbeat
 * is the top of its own descent — and that vertical drop is the most
 * recognisable stroke in any pattern.
 */
function apexBetween(pattern: ConductorPattern, index: number): ConductorPoint {
  const count = pattern.length;
  const from = pattern[index];
  const to = pattern[(index + 1) % count];
  const centre = centreOf(pattern);
  const preparing = (index + 1) % count === 0;
  return {
    x: preparing ? to.x : (from.x + to.x) / 2 + (from.x - centre.x) * SWING,
    y: (from.y + to.y) / 2 - from.rebound,
  };
}

/** The whole bar as one closed loop: beat, its stroke's points, beat, … */
function loopPoints(pattern: ConductorPattern): { points: ConductorPoint[]; starts: number[] } {
  const points: ConductorPoint[] = [];
  const starts: number[] = [];
  for (let index = 0; index < pattern.length; index++) {
    starts.push(points.length);
    points.push({ x: pattern[index].x, y: pattern[index].y });
    for (const via of pattern[index].path ?? [apexBetween(pattern, index)]) {
      points.push({ x: via.x, y: via.y });
    }
  }
  return { points, starts };
}

/** Catmull-Rom through p1 and p2, shaped by the neighbours either side. */
function spline(
  p0: ConductorPoint,
  p1: ConductorPoint,
  p2: ConductorPoint,
  p3: ConductorPoint,
  s: number,
): ConductorPoint {
  const s2 = s * s;
  const s3 = s2 * s;
  const at = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3);
  return { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
}

/**
 * How far the beat runs ahead of even progress round the loop.
 *
 * The curve says where the tip goes; this says when. Traversed evenly a spline
 * gives an almost constant speed and the beat disappears — the shape can be
 * perfect and still unreadable. A thrown ball is slowest at the top of its arc
 * and quickest at the bottom, and so is a conductor's hand.
 *
 * Separating the two is what lets the path stay smooth while the motion stays
 * sharp, and it is what makes this the legato-to-marcato axis: near zero the
 * tip crawls round at an even rate, near one it very nearly stops between beats
 * and snaps through them.
 */
function warp(t: number, lag: number): number {
  return t + (lag * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
}

function lagFor(style: number): number {
  return Math.min(0.92, 0.3 + 0.62 * style);
}

/**
 * Where the tip is, given a position in the bar measured in pulses.
 *
 * Named for the tip and not the hand: the pattern is the path the far end of
 * the baton describes, and the grip is a smaller copy of it.
 */
export function tipAt(
  pattern: ConductorPattern,
  pulseInBar: number,
  style: number,
): ConductorPoint {
  const count = pattern.length;
  // Wrapped both ways: a count-in sits at negative beats, and JavaScript's
  // remainder keeps the sign of its left operand.
  const index = ((Math.floor(pulseInBar) % count) + count) % count;
  const t = pulseInBar - Math.floor(pulseInBar);

  const { points, starts } = loopPoints(pattern);
  const total = points.length;
  const start = starts[index];
  const span = ((((starts[(index + 1) % count] ?? 0) - start) % total) + total) % total || total;

  const along = warp(t, lagFor(style)) * span;
  const segment = Math.min(span - 1, Math.floor(along));
  const step = Math.min(1, Math.max(0, along - segment));

  const at = (offset: number) => points[(((start + segment + offset) % total) + total) % total];
  return spline(at(-1), at(0), at(1), at(2), step);
}

/**
 * Where the grip is: the same point on the same pattern, scaled towards its
 * middle.
 *
 * The drawn line between the two changes length, and should. A baton is rigid
 * in three dimensions and this is its shadow — pointed towards the band it
 * foreshortens to almost nothing, swept across the body it shows its full
 * length. Holding it to one length forces a three-dimensional gesture into a
 * constraint it never had.
 */
export function gripFor(pattern: ConductorPattern, tip: ConductorPoint): ConductorPoint {
  const centre = centreOf(pattern);
  return {
    x: centre.x + GRIP_TRAVEL * (tip.x - centre.x),
    y: centre.y + GRIP_TRAVEL * (tip.y - centre.y),
  };
}

/**
 * Everything the drawn gesture occupies, in normalised units.
 *
 * Measured off the curve rather than from the beat positions, because most of
 * a pattern's extent is the arcs between the beats and none of it is the beats
 * themselves. Computed once per pattern so a panel can be fitted to it without
 * knowing anything about conducting.
 */
export function extentOf(pattern: ConductorPattern, style: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const steps = 60 * pattern.length;
  for (let i = 0; i <= steps; i++) {
    const tip = tipAt(pattern, (i / steps) * pattern.length, style);
    minX = Math.min(minX, tip.x);
    maxX = Math.max(maxX, tip.x);
    minY = Math.min(minY, tip.y);
    maxY = Math.max(maxY, tip.y);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
