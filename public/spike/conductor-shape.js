/**
 * Where the hand is, and what gets drawn round it.
 *
 * Kept apart from the page so it can be rendered without a browser — the shapes
 * are geometry, and geometry is worth looking at before it is played to. It is
 * also the honest way to compare them: all three hang off the same point on the
 * same measured path, and nothing here is a recording. A conductor drawn from
 * stored frames could not follow a rit., which is the whole reason for any of
 * this.
 *
 * All coordinates are normalised: x runs left to right, y downward, and one
 * unit is whatever the display decides. Widths and radii are fractions of that
 * same unit, so a shape scales as one piece.
 */

/*
 * The beat patterns, as the points where the tip lands.
 *
 * **Drawn as the band sees them, which is the mirror of how they are taught.**
 * Every conducting diagram is from the conductor's own point of view: four
 * beats are down, to their left, to their right, up. The player is standing in
 * front of them, so all of that arrives reversed — beat two of a four pattern
 * travels to the *player's* right. Getting this backwards is invisible when you
 * are only checking whether the beat can be found, and wrong every time
 * afterwards.
 *
 * Keyed by the number of pulses in a bar, never by the numerator: 6/8 is beaten
 * in two and takes the two pattern, 9/8 in three, 12/8 in four. See `metre.ts`.
 */
/*
 * **Every beat lands at the bottom of its own stroke.** This is the correction
 * that mattered most: the earlier version had beat four sitting high, as though
 * the pattern simply climbed back up to meet beat one. It does not. The ictus
 * of four is *low*, like every other ictus, and the climb happens afterwards —
 * the hand lifts high and drops again, and that lift is the preparation.
 *
 * With all four beats along the bottom and the strokes bowing over between
 * them, the path crosses itself and the shape becomes the flattened
 * figure-of-eight a four pattern actually traces.
 *
 * `rebound` is how high the arc leaving each beat rises. Holding it per beat
 * rather than deriving one arc height for the whole pattern is what lets the
 * lift before the downbeat be enormous while the turns between the middle beats
 * stay small — and it is the only way a pattern can describe a self-crossing
 * shape at all.
 */
export const PATTERNS = {
  /*
   * Every pattern has the same three structural roles, which is Mann's rule and
   * not a stylistic choice: the cycle "begins with a characteristic downward
   * movement of the arm, the downbeat, and ends with an upward movement, or the
   * upbeat. If there are more than two beats in the meter, then additional
   * horizontal movements are added." So a two pattern is down and up with no
   * horizontal at all; a three adds one sideways beat; a four adds two.
   *
   * `rebound` is the one number each beat needs: the size of the arc leaving
   * it. There is no separate arrival height, because there is no separate
   * arrival — "the PREP comes before the ictus, and it is essentially the
   * rebound of the prior beat". One movement, named twice depending on which
   * end you are standing at, so it is stored once.
   *
   * That also makes the final beat's rule automatic. Its rebound "must return
   * to the starting point of the downbeat", and since the downbeat's approach
   * is by construction the previous beat's rebound, the two cannot drift apart.
   */
  /*
   * A tall narrow hook, not a wide dome.
   *
   * The two pattern is the one place Mann's rule bites hardest: with no
   * horizontal beat at all, almost the whole gesture is the long descent into
   * one and the long lift out of two. The sideways travel is a bulge at the
   * bottom of the hook rather than a journey — barely a quarter of the height —
   * and drawing it as wide as a four pattern was making the two look like a
   * three with a beat missing.
   */
  /*
   * A J and a reverse J, joined by a change of direction between the beats.
   *
   * Out of beat one's hook the hand does not travel to beat two — it sweeps
   * *past* it, reverses, and comes back, so the descent into beat two arrives
   * from the far side and turns the opposite way: the reverse J. The sense of
   * the turn is the whole point. Both hooks curl, but they curl in opposite
   * rotational senses, and only an approach from beyond beat two can produce
   * the second one.
   *
   * The stroke carries two via points of its own because one cannot do it: a
   * single apex out beyond beat two drags beat one's tangent diagonal and its
   * hook disappears — the descent just swooshes through. The first via keeps
   * the exit from beat one near vertical so the curl survives; the second is
   * the turning point past beat two.
   */
  2: [
    {
      x: 0,
      y: 1,
      // With an explicit path the rebound is documentary: the first via point
      // realises a curl of about this size, and the audit reads the field.
      rebound: 0.38,
      path: [
        { x: -0.15, y: 0.62 },
        // Far enough past beat two that the hand genuinely turns and comes
        // back — about a seventh of the pattern's width beyond it. Further out
        // and the two pattern starts travelling like a three.
        { x: -0.44, y: 0.42 },
      ],
    },
    { x: -0.3, y: 0.72, rebound: 1.05 },
  ],
  /*
   * Two beats on the floor and the upbeat above the second of them — not back
   * near the downbeat, which is where it had been sitting.
   *
   * The shape is a long shallow sweep from one to two, a hook that overshoots
   * outward and drops back onto three, and then a single long diagonal rising
   * across the whole pattern to the top, from which the downbeat falls.
   */
  3: [
    { x: 0, y: 1, rebound: 0.26 },
    { x: -0.74, y: 1, rebound: 0.42 },
    { x: -0.76, y: 0.78, rebound: 1.05 },
  ],
  /*
   * Four strokes, and they are not alike — which is the whole shape.
   *
   *   1 → 2  a low, round lobe out to the side
   *   2 → 3  the long stroke right across the pattern, arcing over the top
   *   3 → 4  the matching low lobe coming back
   *   4 → 1  straight up and straight back down
   *
   * The eight is where the long stroke passes through that vertical, and the
   * two lobes are what hang either side of it. Give every stroke the same arc
   * and there is no eight, only a row of humps.
   *
   * The last stroke is also how a piece begins: the baton is held up and swiped
   * down onto beat one, which is the descent this stroke ends with.
   */
  4: [
    { x: 0, y: 1, rebound: 0.34 },
    { x: 0.78, y: 1, rebound: 0.5 },
    { x: -0.78, y: 1, rebound: 0.34 },
    { x: -0.16, y: 1, rebound: 1.15 },
  ],
  /*
   * The subdivided six, for a compound bar too slow to be beaten in two.
   *
   * Read off the player's diagram — a 6-beat German-style espressivo-legato
   * pattern — and mirrored, as every published diagram must be. Its structure
   * is two groups of three: a main beat, a small hook beside it, and a large
   * gesture *away* from the next main beat. That last is the reference's rule
   * exactly, "the rebound of beat one moves away from the next big beat", and
   * it is why three swings right while four is away to the left.
   *
   * Unlike the four, the beats do not share a floor. Three and six sit well
   * above the rest, each being the lift into the main beat that follows, and
   * six is the highest because what follows it is the downbeat.
   *
   * Beats two and five carry paths for the same reason the two pattern does:
   * the hand travels past and turns back, and one apex out there would flatten
   * the hook it is supposed to be curling.
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
       * The turn sits *above* beat three rather than below it, which is a
       * departure from the diagram as read. Passing under three and arriving
       * from beneath leaves that beat approached upwards, with no downward
       * ictus and nothing to read the beat from — and the ictus wins over a
       * drawing every time. The overshoot is kept: it is what makes three read
       * as the lift into four rather than a point passed through.
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
/** Middle of a pattern, which the grip's damped travel is measured from. */
function centreOf(pattern) {
  const sum = pattern.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pattern.length, y: sum.y / pattern.length };
}

/**
 * Scales a pattern's extent about its own centre.
 *
 * How big a conductor beats is not a fixed property of the metre — it is how
 * loud they are asking for. A quiet passage is beaten small in *both*
 * directions, and the two are separate: a broad quiet phrase can be wide and
 * shallow, a tight loud one narrow and deep.
 *
 * Scaling about the centre leaves the centre alone, so the grip's own smaller
 * copy stays concentric whatever this does.
 *
 * `lift` raises the arcs *without* touching where the beats are, which is the
 * other reading of the reference's "more bounce, or air, between each beat" —
 * that the hand rises higher between beats rather than lingering longer up
 * there. It is here so the compound question is not settled by assuming which
 * of the two the sentence means.
 */
export function scaledPattern(pattern, spread, height, shape = {}) {
  /*
   * `shape` is the style's business, where `spread` and `height` are the
   * dynamic's. Three separate things, because playing with them proved they
   * are not one:
   *
   *   `arcs`     how high the rebounds between beats rise.
   *   `prep`     how high the *last* one rises, which is a different question:
   *              it is the height the downbeat falls from, so it is what makes
   *              the downbeat recognisable. Flattening it with the rest loses
   *              the downbeat long before the gesture is as legato as it wants
   *              to be, and raising it with the rest gives a baton no arm could
   *              hold. Defaults to `arcs`, which is the old single-knob shape.
   *   `flatten`  how far the beats converge towards one another vertically.
   *              Only the four pattern has its beats on one floor already; in
   *              every other one two ictus points sit at different heights, and
   *              a legato gesture wants those closer together rather than the
   *              arcs alone coming down around them.
   */
  const { arcs = 1, prep = arcs, flatten = 1 } = shape;
  const centre = centreOf(pattern);
  const last = pattern.length - 1;
  /*
   * The last beat's rebound and the downbeat's drop are one gesture.
   *
   * Mann is explicit about why the final rebound is the exception to every
   * other one in the bar: it "must return to the starting point of the
   * downbeat". So its height is not a free number — it *is* the height the
   * downbeat falls from, and the two were drifting apart by a fifth while both
   * were tuned by hand. Tied together here so they cannot — which is also why
   * `prep` can be given its own scaling without the drop and the lift parting
   * company.
   */
  return pattern.map((p, index) => ({
    x: centre.x + spread * (p.x - centre.x),
    y: centre.y + height * flatten * (p.y - centre.y),
    // The lifts are most of the pattern's vertical extent now that the beats
    // all sit along the bottom, so they shrink with it rather than towering
    // over a flattened shape.
    rebound: p.rebound * height * (index === last ? prep : arcs),
    path: p.path?.map((via) => ({
      x: centre.x + spread * (via.x - centre.x),
      y: centre.y + height * flatten * (via.y - centre.y),
    })),
  }));
}

/**
 * How far the departing control point swings *outward*, away from the middle
 * of the pattern.
 *
 * Small. Enough to bend the rebound away from the next beat, which is what puts
 * the crossing in, but not so much that the hand leaves a beat travelling
 * sideways — an outward swing that outweighs the flick turns every side beat
 * into a lazy loop and takes the ictus with it.
 *
 * This is the piece that was missing, and without it the trace can only ever be
 * a row of domes. The rebound out of a beat does not head for the next beat —
 * it carries on outward first, away from the centre, and only then turns back.
 * At the side beats that overshoot is what makes the path pass beyond the ictus
 * and curl back on itself, which is where the loops come from and therefore
 * where the figure of eight comes from.
 *
 * At the middle beats it is nearly nothing, because they sit at the centre and
 * there is no outward for them to go — so the hand leaves them straight up,
 * which is exactly what the tall spike before a downbeat is.
 */
const SWING = 0.22;

/**
 * The apex between two beats: the top of the arc the hand travels over.
 *
 * A real point on the path rather than a control point pulling at it, because
 * the path is now one continuous curve and every point on it is somewhere the
 * tip actually goes.
 */
function apexBetween(pattern, index) {
  const count = pattern.length;
  const from = pattern[index];
  const to = pattern[(index + 1) % count];
  const centre = centreOf(pattern);
  /*
   * The last apex of the bar sits directly over the downbeat, not half way
   * back to it.
   *
   * This is Mann's "the final rebound must return to the starting point of the
   * downbeat", read as geometry rather than as size: the starting point of a
   * downbeat is the top of its own descent, which is above where it lands. So
   * the hand sweeps up and across from the last beat and then drops straight —
   * and that vertical drop is the most recognisable stroke in any pattern.
   * Putting this apex at the midpoint made the descent a diagonal instead.
   */
  const preparing = (index + 1) % count === 0;
  return {
    x: preparing ? to.x : (from.x + to.x) / 2 + (from.x - centre.x) * SWING,
    y: (from.y + to.y) / 2 - from.rebound,
  };
}

/** The stroke leaving a beat: its own via points, or the single default apex. */
function strokePoints(pattern, index) {
  const from = pattern[index];
  return from.path ?? [apexBetween(pattern, index)];
}

/**
 * The whole bar as one closed loop of points: beat, apex, beat, apex…
 *
 * **The ictus is a point on the curve, not the seam between two of them.** This
 * is the correction that matters most about the shape. Building each stroke as
 * its own cubic, starting and ending at a beat, makes every ictus a joint —
 * and at a joint the tangent jumps, so the tip turns a hard corner. A hand has
 * mass and cannot do that. What it does instead is decelerate, pass through the
 * turn, and accelerate away, which on paper is a smooth curve with a lot of
 * bend in it and no corner anywhere.
 *
 * So the beats and the apexes above them are threaded onto a single closed
 * spline. Every beat is then an interior point with one tangent rather than two
 * disagreeing ones, and the reversal is something the curve *does* rather than
 * something done to it.
 */
function loopPoints(pattern) {
  const points = [];
  const starts = [];
  for (let index = 0; index < pattern.length; index++) {
    starts.push(points.length);
    points.push({ x: pattern[index].x, y: pattern[index].y });
    for (const via of strokePoints(pattern, index)) points.push({ x: via.x, y: via.y });
  }
  return { points, starts };
}

/** Catmull-Rom through p1 and p2, shaped by the neighbours either side. */
function spline(p0, p1, p2, p3, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  const at = (a, b, c, d) =>
    0.5 *
    ((2 * b) + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3);
  return { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
}

/**
 * How far the beat runs ahead of even progress round the loop.
 *
 * The curve says where the tip goes; this says when. Left alone, a spline
 * traversed evenly gives an almost constant speed and the beat disappears — the
 * shape can be perfect and still unreadable. A thrown ball is slowest at the
 * top of its arc and quickest at the bottom, and so is a conductor's hand, so
 * the phase is warped to hurry through the ictus and linger at the apex.
 *
 * Separating the two is what lets the path stay smooth while the motion stays
 * sharp. The old model could only make the ictus readable by putting a corner
 * there.
 */
function warp(t, lag) {
  return t + (lag * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
}

/**
 * How sharply the phase is warped, from the style setting.
 *
 * At zero the tip crawls round the loop at an even rate and there is no beat to
 * see at all. Approaching one it comes very nearly to a stop between beats and
 * snaps through them, which is a march. The legato-to-marcato axis is this, not
 * the height of the arcs.
 *
 * `extra` is what the compound question is asking about. The reference says
 * conducting in compound meters "carries more bounce, or air, between each
 * beat", and that "the conductor should emphasize the arrival point more
 * greatly than when traveling between gestures" — both of which describe the
 * timing rather than the shape, and both of which are a deeper lag. It is a
 * separate number from the style so the two can be judged apart: the question
 * is whether 6/8 wants more of this than 2/4 does *at the same style setting*,
 * and the honest answer might be none.
 */
function lagFor(rebound, extra = 0) {
  return Math.min(0.92, 0.3 + 0.62 * rebound + extra);
}

/**
 * Where the *tip* is, given a position in the bar.
 *
 * Named for the tip and not the hand, because the two are not the same thing:
 * the pattern is the path the far end of the baton describes, and the grip is a
 * smaller copy of it.
 *
 * Two things decide it, and keeping them apart is the whole design. `loopPoints`
 * gives the shape — one closed curve with every beat and apex threaded on it, so
 * there is no seam anywhere and no corner at any ictus. `warp` gives the timing —
 * quick through the beat, lingering at the top of the arc. Shape and motion were
 * previously the same mechanism, which is why making the beat readable kept
 * costing the shape and vice versa.
 */
export function tipAt(pattern, beatInBar, rebound, extraLag = 0) {
  const count = pattern.length;
  // Wrapped both ways: a count-in sits at negative beats, and JavaScript's
  // remainder keeps the sign of its left operand.
  const index = ((Math.floor(beatInBar) % count) + count) % count;
  const t = beatInBar - Math.floor(beatInBar);

  const { points, starts } = loopPoints(pattern);
  const total = points.length;
  const start = starts[index];
  // Segments from this beat to the next: one more than the stroke's via count.
  const span = (((starts[(index + 1) % count] ?? 0) - start) % total + total) % total || total;
  // The warp decides how much of the stroke has been covered.
  const along = warp(t, lagFor(rebound, extraLag)) * span;
  const segment = Math.min(span - 1, Math.floor(along));
  const step = Math.min(1, Math.max(0, along - segment));

  const at = (offset) => points[((start + segment + offset) % total + total) % total];
  return spline(at(-1), at(0), at(1), at(2), step);
}

/**
 * How hard the tip reverses direction around a beat.
 *
 * **This is the ictus itself, not a proxy for it.** Mann defines it outright:
 * the ictus is "the change in direction that is interpreted by an ensemble as
 * the actual beat", seen "at the tip of the baton". Not a speed maximum, not a
 * position — a reversal.
 *
 * Sampled a short way either side rather than at the instant itself, and that
 * is not a detail. Now the path is smooth the vertical velocity passes through
 * zero exactly at the beat, so measuring there would report nothing at all
 * however sharp the turn. What a player sees is the hand descending shortly
 * before and rising shortly after, which is what this asks about.
 */
const ICTUS_WINDOW = 0.06;

export function ictusStrength(pattern, beat, rebound, extraLag = 0) {
  const d = 1e-4;
  const before = beat - ICTUS_WINDOW;
  const after = beat + ICTUS_WINDOW;
  const descending =
    (tipAt(pattern, before + d, rebound, extraLag).y -
      tipAt(pattern, before - d, rebound, extraLag).y) /
    (2 * d);
  const rising =
    (tipAt(pattern, after + d, rebound, extraLag).y -
      tipAt(pattern, after - d, rebound, extraLag).y) /
    (2 * d);
  // Downward on the way in and upward on the way out; anything else is drift.
  return Math.max(0, descending) + Math.max(0, -rising);
}

/** The weakest ictus in the bar, since a pattern is as readable as its worst beat. */
export function weakestIctus(pattern, rebound, extraLag = 0) {
  return pattern.reduce(
    (worst, _, beat) => Math.min(worst, ictusStrength(pattern, beat, rebound, extraLag)),
    Infinity,
  );
}

function speedAt(pattern, beat, rebound, extraLag = 0) {
  const d = 1e-4;
  const a = tipAt(pattern, beat - d, rebound, extraLag);
  const b = tipAt(pattern, beat + d, rebound, extraLag);
  return Math.hypot(b.x - a.x, b.y - a.y) / (2 * d);
}

/**
 * How much faster the tip moves at each beat than it does between beats.
 *
 * The number that decides whether any of this works, so it is reported rather
 * than assumed — and measured **per beat**, which the first version got wrong.
 * It compared the ends of each stroke against that stroke's own slowest point,
 * which quietly assumed every beat is announced by the hand *leaving* it. It is
 * not: an ictus can be carried by the arrival instead, and on the long sweep
 * across a four pattern that is exactly what happens. Measured the old way that
 * stroke scored 1.0x and looked broken, while a player would have read it
 * perfectly well.
 *
 * So each beat is scored on whichever side is faster, against the quietest
 * drift on either side of it. The worst beat is what comes back, because a
 * pattern is only as readable as the beat you cannot find.
 */
export function readability(pattern, rebound, extraLag = 0) {
  const count = pattern.length;
  const quietest = [];
  for (let stroke = 0; stroke < count; stroke++) {
    let slowest = Infinity;
    // The very ends belong to the beats either side rather than to the drift.
    for (let i = 5; i < 96; i++) {
      slowest = Math.min(slowest, speedAt(pattern, stroke + i / 100, rebound, extraLag));
    }
    quietest.push(slowest);
  }

  let worst = Infinity;
  for (let beat = 0; beat < count; beat++) {
    const sharpest = Math.max(
      speedAt(pattern, beat - 1e-3, rebound, extraLag),
      speedAt(pattern, beat + 1e-3, rebound, extraLag),
    );
    const drift = Math.min(quietest[(beat - 1 + count) % count], quietest[beat]);
    worst = Math.min(worst, sharpest / (drift || 1e-9));
  }
  return worst;
}

/*
 * The figure.
 *
 * A conductor beats below their own shoulders, so the shoulder sits above the
 * pattern rather than below it, and off to one side — a right hand appears on
 * that side of the body when you are looking at them. The reach is set so the
 * furthest beat very nearly straightens the arm and the nearest still leaves it
 * bent, because an arm that locks or folds through itself is the thing that
 * makes a stick figure look wrong.
 */
const SHOULDER = { x: 1.15, y: -0.35 };
const HEAD = { x: 1.15, y: -0.72 };
const HEAD_RADIUS = 0.13;
const NECK = { x: 1.15, y: -0.59 };
const HIP = { x: 1.15, y: 0.55 };

/*
 * The baton: one shape, drawn twice, at two sizes about the same centre.
 *
 * The grip travels the same pattern as the tip, smaller and concentric within
 * it. That is all there is to it, and the earlier attempts went wrong by trying
 * to be cleverer.
 *
 * **The drawn line does change length, and it must.** A baton is a rigid object
 * in three dimensions and what appears on screen is its projection. Pointed
 * towards the band it foreshortens to nearly nothing; swept across the body it
 * shows its full length. Holding the projected line to one length — which the
 * previous version did, on the grounds that a stretching stick looks wrong —
 * forces a three-dimensional gesture into a constraint it never had, and is why
 * the grip had to be dragged about to compensate.
 *
 * So the length is left alone and the geometry becomes a single scale factor.
 */
export const DEFAULT_GRIP_TRAVEL = 0.3;

/**
 * The elbow, given a hand.
 *
 * A drawn bend rather than a simulated joint, and that is a finding rather than
 * a shortcut. Proper two-bone inverse kinematics was tried first and is wrong
 * here for a structural reason: the reach from any fixed shoulder to this
 * pattern varies by about two and a half times, because the pattern is the path
 * of a *tip* and a real arm absorbs that range in depth, which a flat drawing
 * has not got. A fixed-length arm can only take up the slack by throwing its
 * elbow, and the elbow then travels further than the hand does — a second large
 * moving object competing with the one small movement that carries the beat.
 *
 * So the elbow simply sits half way along with a constant proportional bend.
 * The arm is not rigid, nobody will measure it, and it stays out of the way of
 * the thing being read.
 */
const ELBOW_BEND = 0.2;

export function elbowFor(hand) {
  const dx = hand.x - SHOULDER.x;
  const dy = hand.y - SHOULDER.y;
  const reach = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / reach;
  const uy = dy / reach;
  // Bent towards the body and down, which is the way an elbow goes when the
  // hand is out in front.
  return {
    x: SHOULDER.x + dx * 0.5 + uy * ELBOW_BEND * reach,
    y: SHOULDER.y + dy * 0.5 - ux * ELBOW_BEND * reach,
  };
}

export const SHAPES = ['dot', 'baton', 'arm'];

/**
 * Where the grip is, given where the tip is.
 *
 * The same point on the same pattern, scaled towards the middle of it. At a
 * travel of 0 the grip is pinned at the centre and the baton is a pointer on a
 * pivot; at 1 it sits on the tip and there is no baton left to see.
 */
export function gripFor(pattern, tip, travel = DEFAULT_GRIP_TRAVEL) {
  const centre = centreOf(pattern);
  return {
    x: centre.x + travel * (tip.x - centre.x),
    y: centre.y + travel * (tip.y - centre.y),
  };
}

export function shapeParts(shape, tip, pattern, travel = DEFAULT_GRIP_TRAVEL) {
  const strokes = [];
  const circles = [];

  if (shape === 'arm') {
    const elbow = elbowFor(tip);
    // Neck through to hip in one stroke, so the head is joined to the body
    // rather than floating above it.
    strokes.push({ points: [NECK, HIP], width: 0.03 });
    strokes.push({ points: [SHOULDER, elbow, tip], width: 0.038 });
    circles.push({ at: HEAD, radius: HEAD_RADIUS, fill: false, width: 0.03 });
  } else if (shape === 'baton') {
    const grip = gripFor(pattern, tip, travel);
    strokes.push({ points: [grip, tip], width: 0.026 });
    // A knob at the held end, so which end is which is never in doubt.
    circles.push({ at: grip, radius: 0.045, fill: true });
  }

  // The tip itself, in every shape — it is the thing carrying the beat.
  circles.push({ at: tip, radius: shape === 'dot' ? 0.035 : 0.024, fill: true });
  return { strokes, circles };
}

/**
 * A short fingerprint of the geometry this file currently describes.
 *
 * Shown on the page because "am I actually looking at the new version?" has
 * come up more than once, and a static page served down a tunnel gives no other
 * way to tell — the shape changes are often too subtle to identify by eye,
 * which is exactly when you most need to know.
 *
 * Derived from the numbers themselves rather than from a version string I have
 * to remember to bump, so it cannot go stale or lie.
 */
export function shapeFingerprint() {
  let hash = 2166136261;
  const take = (value) => {
    hash = Math.imul(hash ^ Math.round(value * 1000), 16777619);
  };
  /*
   * Sampled off the curve rather than read off the data, because the shape has
   * changed twice now without a single coordinate moving — the maths around it
   * changed instead. A fingerprint of the inputs would have said "no change"
   * both times, which is the one thing it must never do.
   */
  for (const [beats, raw] of Object.entries(PATTERNS)) {
    const pattern = scaledPattern(raw, 1, 1);
    take(Number(beats));
    for (let i = 0; i < 48; i++) {
      const point = tipAt(pattern, (i / 48) * pattern.length, 0.55);
      take(point.x);
      take(point.y);
    }
  }
  return (hash >>> 0).toString(36).slice(0, 5);
}
