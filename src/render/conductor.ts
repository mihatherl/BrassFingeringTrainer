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
 * 9/8 in three, 12/8 in four, so compound time needs no pattern of its own —
 * until it is slow enough that the pulses are too far apart to be followed,
 * where the taught shape subdivides and 6/8 really is beaten in six. That is
 * the one case where the numerator picks the pattern, and it is a property of
 * the tempo rather than of the metre; see `patternFor`.
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
 * One, two, three, four and six exist. Anything else has no pattern and gets no
 * conductor — see `patternFor`, which also decides when a metre takes a shape
 * other than its own pulse count.
 */
const PATTERNS: Record<number, ConductorPattern> = {
  /*
   * The one pattern: a series of downbeats with a single rebound.
   *
   * For a 2/4, 3/4 or 3/8 gone too fast to beat its pulses, where the whole bar
   * becomes one gesture. Straight down onto the ictus, a narrow hook round the
   * bottom, and straight back up.
   *
   * **The hook must stay narrow, and the sides near parallel.** The reference is
   * explicit that the beat must not become oval or U-shaped: a wide turn puts no
   * single instant at the bottom and the ictus stops being identifiable, which
   * is the only thing this pattern has to convey, having nothing else in it.
   * Narrow but never zero, though — a perfect retrace back up the line it came
   * down is a reversal no hand performs, and it would leave no continuous
   * tangent at the beat.
   *
   * Six via points rather than one or two, and that is what keeps it a hairpin
   * instead of a leaf. With a single point up each side the spline bows outward
   * between them and the widest part of the gesture lands half way up, where the
   * reference has the sides parallel and all the separation down at the turn. So
   * each side is pinned twice, low and high, and the top is a pair rather than a
   * single apex — one point up there leaves the descent overshooting outward as
   * it comes off the turn.
   *
   * Drawn by its path rather than by a rebound, because with one beat there is
   * no "between beats" for an apex to sit in. The rebound is documentary.
   *
   * Mirrored, as every published diagram must be: the reference descends on the
   * conductor's left and rises on their right, which the band sees reversed.
   */
  1: [
    {
      x: 0,
      y: 1,
      rebound: 1.5,
      path: [
        { x: -0.05, y: 0.88 },
        { x: -0.05, y: 0.1 },
        { x: -0.045, y: -0.46 },
        { x: 0.012, y: -0.46 },
        { x: 0.02, y: 0.1 },
        { x: 0.02, y: 0.88 },
      ],
    },
  ],
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
  /*
   * The subdivided six, for a compound bar too slow to be beaten in two.
   *
   * Read off a 6-beat German-style espressivo-legato diagram the player
   * supplied, and mirrored as every published diagram must be. Two groups of
   * three, each being a main beat, a small hook beside it, and a large gesture
   * *away* from the next main beat — which is the reference's own rule, "the
   * rebound of beat one moves away from the next big beat", and why three
   * swings one way while four is away to the other.
   *
   * Unlike the four, these beats share no floor. Three and six sit well above
   * the rest, each being the lift into the main beat after it, and six highest
   * of all because what follows it is the downbeat.
   */
  6: [
    { x: 0, y: 1, rebound: 0.55 },
    {
      x: -0.23,
      y: 0.93,
      // Documentary, as in the two pattern: the path is what draws this stroke.
      rebound: 0.52,
      /*
       * The long sweep out to three, which overshoots it and comes back down.
       *
       * **The turn is above beat three, not below it**, and that is a
       * departure from the diagram as read rather than a copy of it. The
       * drawn loop appears to pass under three and arrive from beneath, which
       * would leave that beat approached upwards — no downward ictus, and
       * nothing for a player to read the beat from. Every other pattern here
       * is held to the same rule and so is this one; where a diagram and the
       * ictus disagree, the ictus wins, because it is the thing a beat *is*.
       * The overshoot itself is kept: it is what makes three read as the lift
       * into four rather than as a point passed through.
       */
      path: [
        { x: 0.46, y: 0.27 },
        { x: 1.02, y: 0.42 },
      ],
    },
    { x: 0.67, y: 0.63, rebound: 0.53 },
    { x: -0.63, y: 0.91, rebound: 0.34 },
    { x: -1.03, y: 0.81, rebound: 0.51 },
    { x: -0.85, y: 0.51, rebound: 1.26 },
  ],
};

/**
 * Below this many conducted beats a minute, compound time is beaten in its
 * divisions rather than its pulses.
 *
 * The reference draws the line at Andante: "tempos that exceed Andante would
 * use the 'fast' pattern shape… slower than Andante, such as Largo or Grave
 * should use the 'slow' pattern shapes", the reason being that the ensemble
 * needs the beat clarified when there is that much time between pulses.
 *
 * A guess until played, like the rest of the numbers in this app that describe
 * musical judgement rather than arithmetic. It sits below the default tempo on
 * purpose: turning the setting down should be what reaches the six, not
 * leaving everything alone.
 */
export const SUBDIVIDE_BELOW_BPM = 76;

/**
 * Above this many conducted beats a minute, a simple bar is beaten in fewer
 * gestures than it has pulses.
 *
 * Past a certain speed a hand cannot make an ictus per pulse that anyone can
 * read, and beating fewer is clearer than beating a blur — the same reasoning
 * as `SUBDIVIDE_BELOW_BPM`, arriving from the other end.
 *
 * **Two and three go to one; four goes to two.** The reference gives the one
 * pattern to "very fast 2/4, 3/4 and 3/8", and a quick common time is beaten
 * alla breve rather than in one — which the player ruled takes the ordinary two
 * pattern, the same double J a 2/4 uses, rather than wanting a shape of its own.
 *
 * One threshold rather than two, and the arithmetic falls out neatly: above it
 * a 2/4 and a 4/4 both give a gesture every two crotchets, and a 3/4 one every
 * three. A guess until played, like every number here describing musical
 * judgement rather than arithmetic — 168 puts a waltz in one at about 56 bars a
 * minute, quick without being extreme.
 */
export const BEAT_IN_FEWER_ABOVE_BPM = 168;

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
export function patternFor(metre: Metre, bpm?: number): ConductorPattern | null {
  if (metre.isCompound && bpm !== undefined && bpm < SUBDIVIDE_BELOW_BPM) {
    const subdivided = PATTERNS[metre.beatsPerBar];
    if (subdivided) return subdivided;
  }
  // Too fast for its own pulses. A two or a three becomes one gesture for the
  // bar; a four is halved into the ordinary two pattern, which is alla breve.
  if (!metre.isCompound && bpm !== undefined && bpm > BEAT_IN_FEWER_ABOVE_BPM) {
    if (metre.pulsesPerBar === 2 || metre.pulsesPerBar === 3) return PATTERNS[1];
    if (metre.pulsesPerBar === 4) return PATTERNS[2];
  }
  return PATTERNS[metre.pulsesPerBar] ?? null;
}

/**
 * Where in its pattern a beat falls, counting from zero at the bar line.
 *
 * Not `pulseAt`, which answers a different question: the pulse is a property
 * of the metre, and this is a property of the *gesture*. They agree wherever
 * the conductor is beating the pulses — which is everywhere except a slow
 * compound bar, where the pattern has six positions to a bar of two pulses and
 * asking about pulses would run the hand round three times too slowly.
 *
 * Fractional between positions, and negative before the music starts, both of
 * which `tipAt` expects.
 */
export function placeInPattern(
  metre: Metre,
  pattern: ConductorPattern,
  beat: number,
): number {
  return (beat / metre.barBeats) * pattern.length;
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

/**
 * The two ends of the style axis, as complete gestures.
 *
 * Not a coupling curve any more. Every attempt to derive the whole axis from
 * one knob failed the same way — the player could not hold two settings side by
 * side to compare them — so the ends are stated outright and everything between
 * is a straight line. These five numbers came off `/spike/gesture.html`, chosen
 * by eye against every pattern at once.
 *
 * **The width runs the other way**, which is the part no reasoning would have
 * produced: a marcato gesture is *narrower* than a flowing one, not larger. A
 * march is beaten tight and close; a lyrical phrase is broad. Everything else —
 * the arcs, the downbeat, the vertical spread of the beats, the lag — grows
 * from flowing to marcato, and the width alone shrinks.
 *
 * Both ends sit well under the drawn pattern. The shapes in `PATTERNS` are
 * diagram-faithful, and a diagram exaggerates to teach: read literally they
 * gave a hand bouncing three quarters of its own width, which a conductor
 * watching it called extremely lively. Nothing here changes what is drawn; this
 * is how much of it is used.
 */
export interface GestureShape {
  /** How far the hand travels sideways, against the drawn pattern. */
  width: number;
  /** How high it rises between beats. */
  arcs: number;
  /** The height the downbeat falls from — its own number, not one of the arcs. */
  downbeat: number;
  /** How far apart the ictus points sit vertically. */
  beats: number;
  /** How much the tip hangs between beats and snaps through them. */
  lag: number;
}

const FLOWING: GestureShape = { width: 1.1, arcs: 0.32, downbeat: 0.35, beats: 0.4, lag: 0.1 };
const MARCATO: GestureShape = { width: 0.58, arcs: 0.54, downbeat: 0.65, beats: 0.69, lag: 0.64 };

/** The gesture a style setting asks for. */
export function shapeFor(style: number): GestureShape {
  const t = Math.min(1, Math.max(0, style));
  const between = (from: number, to: number) => from + (to - from) * t;
  return {
    width: between(FLOWING.width, MARCATO.width),
    arcs: between(FLOWING.arcs, MARCATO.arcs),
    downbeat: between(FLOWING.downbeat, MARCATO.downbeat),
    beats: between(FLOWING.beats, MARCATO.beats),
    lag: between(FLOWING.lag, MARCATO.lag),
  };
}

/**
 * A drawn pattern at a given gesture, scaled about its own centre.
 *
 * The downbeat's rebound is scaled apart from the others deliberately. Mann
 * ties it to the drop that follows — "the final rebound must return to the
 * starting point of the downbeat" — so it is the height the downbeat falls
 * from rather than another arc, and treating it as one fails at both ends: the
 * downbeat vanishes where the gesture is most legato, exactly where a player
 * most needs to find it, and grows to a length no arm could hold a baton at
 * where it is most marcato.
 */
export function shapedPattern(pattern: ConductorPattern, shape: GestureShape): ConductorPattern {
  const centre = centreOf(pattern);
  const last = pattern.length - 1;
  const place = (p: ConductorPoint): ConductorPoint => ({
    x: centre.x + shape.width * (p.x - centre.x),
    y: centre.y + shape.beats * (p.y - centre.y),
  });
  return pattern.map((beat, index) => ({
    ...place(beat),
    /*
     * Scaled by the arcs alone, and deliberately *not* by `beats` as well.
     *
     * The two are separate quantities: how far apart the ictus points sit and
     * how high the hand rises between them. Applying both to a rebound compounds
     * them — at the flowing end that is 0.4 × 0.32, an arc an eighth of what is
     * drawn — which is not the gesture that was chosen on the bench, where the
     * beats' compression never touched the arcs. It flattened the three
     * pattern's first rebound to about ten microns of normalised space, at which
     * point the beat has no ictus left at all.
     */
    rebound: beat.rebound * (index === last ? shape.downbeat : shape.arcs),
    path: beat.path?.map(place),
  }));
}

/**
 * The ends of the legato-to-marcato axis.
 *
 * The whole of it, unlike before. The floor used to sit at 0.3 because below
 * that the four pattern's second beat lost its speed cue — but that was a
 * property of one fixed geometry, and the geometry now moves with the style.
 * Both ends are gestures somebody chose by eye, so both are worth offering.
 */
export const CONDUCTOR_STYLE_RANGE = { min: 0, max: 1 } as const;

/**
 * What to call a point on the axis.
 *
 * A number from zero to one is meaningless to a player, and the quantities
 * underneath — arc heights, a phase lag — are not things anyone should have to
 * think in. The words are the ones a musician already has for the same axis.
 */
const STYLE_NAMES: ReadonlyArray<{ upTo: number; name: string }> = [
  { upTo: 0.2, name: 'smooth' },
  { upTo: 0.4, name: 'flowing' },
  { upTo: 0.6, name: 'lively' },
  { upTo: 0.8, name: 'crisp' },
  { upTo: 1, name: 'marcato' },
];

export function styleName(style: number): string {
  return (STYLE_NAMES.find((band) => style <= band.upTo) ?? STYLE_NAMES.at(-1)!).name;
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
  lag: number,
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

  const along = warp(t, lag) * span;
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
/**
 * Proportions a panel can be given for a gesture, clamped to something usable.
 *
 * The panel takes the gesture's own aspect ratio so that a shape is not
 * letterboxed inside a box guessed for a different one. That works while the
 * shapes are within reach of each other, and the one pattern is not: it is a
 * vertical line, a twenty-fifth as wide as it is tall, and asking for that
 * literally gives a five-pixel sliver beside the note list. Clamped, the panel
 * stays a panel and the gesture centres inside it — which is honest, because a
 * one pattern really is a line and there is nothing else to show.
 */
export const PANEL_ASPECT_RANGE = { min: 0.3, max: 5 } as const;

export function panelAspect(extent: { width: number; height: number }): number {
  const aspect = extent.width / extent.height;
  if (!Number.isFinite(aspect)) return 1;
  return Math.min(PANEL_ASPECT_RANGE.max, Math.max(PANEL_ASPECT_RANGE.min, aspect));
}

export function extentOf(pattern: ConductorPattern, lag: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const steps = 60 * pattern.length;
  for (let i = 0; i <= steps; i++) {
    const tip = tipAt(pattern, (i / steps) * pattern.length, lag);
    minX = Math.min(minX, tip.x);
    maxX = Math.max(maxX, tip.x);
    minY = Math.min(minY, tip.y);
    maxY = Math.max(maxY, tip.y);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
