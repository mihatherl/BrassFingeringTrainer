import {
  PATTERNS,
  shapeFingerprint,
  readability,
  scaledPattern,
  shapeParts,
  tipAt,
  weakestIctus,
} from './conductor-shape.js';

/**
 * The conductor spike: one dot, and the question of whether you can find the
 * beat in its motion.
 *
 * Deliberately a dot and nothing else. No flash on the beat, no colour change,
 * no number by default — every one of those would answer the question by some
 * other means and prove nothing about the movement. If the ictus does not read
 * from a moving dot it will not read from a beautifully drawn conductor either.
 *
 * The second question is the doubtful one and the reason for the tempo slider:
 * dragging it is a rit., and a metronome cannot teach anyone to follow one.
 */

const TRAIL_SECONDS = 0.55;

/**
 * The area every shape is drawn inside, in normalised units.
 *
 * Wide enough for the figure standing to the right of the pattern and tall
 * enough for the deepest rebound above it, so nothing is clipped and no shape
 * changes the scale of the beat.
 */
const VIEW = { minX: -0.85, maxX: 1.35, minY: -0.9, maxY: 1.05 };

const el = (id) => document.getElementById(id);
const ui = {
  start: el('start'),
  beats: el('beats'),
  tempo: el('tempo'),
  tempoValue: el('tempo-value'),
  click: el('click'),
  reveal: el('reveal'),
  plain: el('plain'),
  shape: el('shape'),
  travel: el('travel'),
  travelValue: el('travel-value'),
  spread: el('spread'),
  height: el('height'),
  extent: el('extent'),
  rebound: el('rebound'),
  ratio: el('ratio'),
  bounce: el('bounce'),
  bounceValue: el('bounce-value'),
  prep: el('prep'),
  shapeWithStyle: el('shape-with-style'),
  compoundLag: el('compound-lag'),
  compoundLift: el('compound-lift'),
  compoundValue: el('compound-value'),
  compoundControls: el('compound-controls'),
  canvas: el('canvas'),
  status: el('status'),
  beatNumber: el('beat-number'),
  build: el('build'),
};

ui.build.textContent = `shape ${shapeFingerprint()}`;

/**
 * Piecewise-constant tempo, exact within each segment.
 *
 * Accumulating a beat count frame by frame would drift, and drift is the one
 * thing a timing spike must not have. Instead every tempo change starts a new
 * segment from the current beat and the current clock, so the answer is always
 * one multiplication away from a known origin — the same shape the app's
 * transport uses, and the same shape a real tempo map will need.
 */
class Clock {
  constructor(context, bpm) {
    this.context = context;
    this.bpm = bpm;
    this.originTime = context.currentTime;
    this.originBeat = 0;
  }

  beatNow() {
    return this.originBeat + ((this.context.currentTime - this.originTime) * this.bpm) / 60;
  }

  timeForBeat(beat) {
    return this.originTime + ((beat - this.originBeat) * 60) / this.bpm;
  }

  setTempo(bpm) {
    this.originBeat = this.beatNow();
    this.originTime = this.context.currentTime;
    this.bpm = bpm;
  }
}

ui.start.addEventListener('click', () => void start(), { once: true });
ui.tempo.addEventListener('input', () => {
  ui.tempoValue.textContent = `${ui.tempo.value} bpm`;
});

/*
 * The rebound depth is not a preference, it is the legato-to-marcato axis.
 *
 * A conductor beating a lyrical phrase uses a smooth, continuous gesture with
 * little rebound; one driving a march gives a sharp ictus and lets the hand
 * stop between beats. Both are correct conducting, and a player has to read
 * either — so the setting is a difficulty axis as much as a style one. A smooth
 * conductor is genuinely harder to follow, which is the point of practising it.
 */
const STYLES = [
  { upTo: 32, name: 'smooth' },
  { upTo: 47, name: 'flowing' },
  { upTo: 62, name: 'lively' },
  { upTo: 77, name: 'crisp' },
  { upTo: 100, name: 'marcato' },
];

/**
 * The metre as selected, split into the two things that are not the same.
 *
 * The written signature says 6/8; the *pulse count* says two, and the pulse
 * count is what picks the pattern. Keeping them apart here is the same
 * separation `domain/metre.ts` makes in the app, and for the same reason: 6/8
 * conducted by its numerator would be beaten in six, which is a thing
 * conductors do only very slowly.
 */
const currentMetre = () => {
  const value = ui.beats.value;
  if (!value.includes('-')) return { pulses: Number(value), compound: false, label: `${value}/4` };
  const [top, unit] = value.split('-').map(Number);
  return { pulses: top / 3, compound: true, label: `${top}/${unit}` };
};

/** How much deeper the warp goes in compound time, at the same style setting. */
const extraLag = () => (currentMetre().compound ? Number(ui.compoundLag.value) / 100 : 0);

/** How much higher the arcs rise in compound time. 1 is no difference. */
const compoundLift = () => (currentMetre().compound ? Number(ui.compoundLift.value) / 100 : 1);

/*
 * The shape half of the style axis, which never existed until now.
 *
 * The axis was always documented as "little rebound" for a lyrical phrase
 * against "a sharp ictus and the hand stopping" for a march — timing *and*
 * shape — and only the timing half was ever built, though the variable
 * carrying it is still called `rebound`. That is why smooth and marcato were
 * indistinguishable: at every setting the slowest frame moves less than a
 * pixel, so the hand reads as stopped throughout and the quickest frame
 * differs by under a fifth. The drawn curve was identical at both ends.
 *
 * The baseline was too tall as well. A conductor's verdict was that the
 * horizontal motion barely goes up and down at all, where ours rose about
 * three quarters of its own width.
 */

/**
 * How low the arcs go at the smooth end, as a fraction of what is drawn.
 *
 * The player's floor, found by dragging: on a four pattern even the smoothest
 * gesture wants no less than a quarter of the drawn arc, or the beats stop
 * being beats.
 */
const ARCS_AT_SMOOTH = 0.25;

/**
 * How far the beats themselves converge at the smooth end.
 *
 * Only the four pattern already has its beats on one floor. Everywhere else two
 * ictus points sit at different heights, and until now that separation was
 * fixed however smooth the gesture got — so a legato two pattern still had its
 * second beat riding well above the first, which reads as a bounce the style
 * setting was supposedly taking out.
 */
const BEATS_AT_SMOOTH = 0.45;

/**
 * How far along the axis the style sits, from its own smooth end to its own
 * marcato end.
 *
 * Measured across the *usable* range rather than from a notional zero, which
 * matters more than it sounds: with the floor read from zero, "the arcs bottom
 * out at a quarter" described a setting nobody could select — the smoothest
 * reachable style still gave 40%, and the constant was quietly describing a
 * gesture off the end of the slider. Normalised here, the numbers in this file
 * are the numbers a player can actually reach.
 */
const styleFraction = () => {
  const min = Number(ui.rebound.min);
  const max = Number(ui.rebound.max);
  return (Number(ui.rebound.value) - min) / (max - min);
};

/**
 * The gesture's shape at the current settings.
 *
 * The preparatory stroke is deliberately *not* on the same curve as the rest,
 * and that is the whole of this function's reason for existing. Scaled with the
 * other arcs it does two wrong things at once: it disappears at the smooth end,
 * where a recognisable downbeat is wanted however legato the phrase, and it
 * grows past any length an arm could hold a baton at when the arcs go up. So it
 * *follows* the arcs rather than matching them, and how closely is the slider.
 *
 * The default is the player's own pairing: with the arcs at a quarter, the
 * downbeat wants to be about a third — which leaves it three or four times the
 * height of the strokes around it, recognisable without being a mast.
 */
const shapeNow = () => {
  const bounce = Number(ui.bounce.value) / 100;
  const follow = Number(ui.prep.value) / 100;

  let arcs = bounce;
  let flatten = 1;
  if (ui.shapeWithStyle.checked) {
    const along = styleFraction();
    arcs *= ARCS_AT_SMOOTH + (1 - ARCS_AT_SMOOTH) * along;
    flatten = BEATS_AT_SMOOTH + (1 - BEATS_AT_SMOOTH) * along;
  }
  arcs *= compoundLift();

  // At follow = 1 the prep is just another arc, which is what it was. At 0 it
  // holds its drawn height whatever the arcs do, so the downbeat is a constant.
  return { arcs, prep: 1 + follow * (arcs - 1), flatten };
};

/**
 * The pattern as currently set: the metre's shape, cut down to the extent the
 * dynamic asks for. A conductor beating a quiet passage uses the same shape and
 * simply makes it smaller, in both directions and by different amounts.
 */
const currentPattern = () =>
  scaledPattern(
    PATTERNS[currentMetre().pulses],
    Number(ui.spread.value) / 100,
    Number(ui.height.value) / 100,
    shapeNow(),
  );

const showRatio = () => {
  const value = Number(ui.rebound.value);
  const style = STYLES.find((s) => value <= s.upTo).name;
  const pattern = currentPattern();
  const rebound = value / 100;
  const extra = extraLag();
  // The ictus is the change of direction, so that is the headline; the speed
  // contrast is worth reporting too but it is not what a beat *is*. Both are
  // measured with the compound settings applied, so the numbers describe what
  // is actually on the screen rather than its simple-time twin.
  ui.ratio.textContent =
    `${style} — weakest ictus ${weakestIctus(pattern, rebound, extra).toFixed(1)}, ` +
    `speed ${readability(pattern, rebound, extra).toFixed(1)}x`;
};

const showCompound = () => {
  const metre = currentMetre();
  // The sliders are only meaningful in compound time, and a control that does
  // nothing is worse than one that is not there.
  ui.compoundControls.style.opacity = metre.compound ? '1' : '0.35';
  ui.compoundLag.disabled = !metre.compound;
  ui.compoundLift.disabled = !metre.compound;

  if (metre.compound) {
    const lag = Number(ui.compoundLag.value);
    const rise = Number(ui.compoundLift.value);
    const parts = [];
    if (lag > 0) parts.push(`lag +${(lag / 100).toFixed(2)}`);
    if (rise > 100) parts.push(`lift ${rise}%`);
    ui.compoundValue.textContent =
      `${metre.label} beaten in ${metre.pulses} — ` +
      (parts.length ? parts.join(', ') : 'no difference from simple time yet');
  } else {
    ui.compoundValue.textContent = `${metre.label} is simple — no compound difference to set`;
  }

  // Always, and not only in the compound branch: leaving a compound metre has
  // to put the measurements back too, or the numbers go on describing a shape
  // that is no longer on the screen.
  showRatio();
};
const showExtent = () => {
  ui.extent.textContent = `${ui.spread.value}% wide, ${ui.height.value}% tall`;
  showRatio();
};
const showTravel = () => {
  ui.travelValue.textContent = `grip travels ${ui.travel.value}%`;
};
ui.travel.addEventListener('input', showTravel);
showTravel();

const showBounce = () => {
  const { arcs, prep, flatten } = shapeNow();
  ui.bounceValue.textContent =
    `arcs ${Math.round(arcs * 100)}%, downbeat ${Math.round(prep * 100)}%` +
    (flatten < 1 ? `, beats ${Math.round(flatten * 100)}% apart` : '');
  showRatio();
};
ui.bounce.addEventListener('input', showBounce);
ui.prep.addEventListener('input', showBounce);
ui.shapeWithStyle.addEventListener('change', showBounce);

ui.rebound.addEventListener('input', showBounce);
ui.beats.addEventListener('change', showCompound);
ui.compoundLag.addEventListener('input', showCompound);
ui.compoundLift.addEventListener('input', showCompound);
showCompound();
showBounce();
ui.spread.addEventListener('input', showExtent);
ui.height.addEventListener('input', showExtent);
showExtent();

async function start() {
  const context = new AudioContext();
  await context.resume();
  const clock = new Clock(context, Number(ui.tempo.value));

  ui.start.disabled = true;
  ui.status.textContent = 'Watch it. Try to play, or clap, on the beat.';

  ui.tempo.addEventListener('input', () => clock.setTempo(Number(ui.tempo.value)));

  /*
   * Clicks are scheduled ahead against the audio clock rather than fired when a
   * frame notices the beat has passed. A frame-accurate click would jitter by
   * up to a frame, and the whole point here is to compare the *visual* ictus
   * against an audible one — so the audible one had better be exact.
   */
  /*
   * Counted in *divisions* rather than pulses, so compound time can tick its
   * three-under-the-beat.
   *
   * The clock's "beat" is the conducted pulse throughout — the dotted crotchet
   * in 6/8 — so a compound bar is three divisions to each of those and a simple
   * one is a single division per pulse, which leaves the simple case ticking
   * exactly as it always did. This matters more than it looks: judging whether
   * compound time wants a different motion is impossible without the compound
   * division actually sounding, since otherwise 6/8 and 2/4 are the same two
   * clicks a bar and the ear has nothing to tell them apart by.
   */
  let nextClick = 0;
  let divisionsSoFar = 0;
  const scheduleClicks = () => {
    const metre = currentMetre();
    const perPulse = metre.compound ? 3 : 1;
    if (!ui.click.checked) {
      nextClick = Math.ceil(clock.beatNow() * perPulse);
      divisionsSoFar = perPulse;
      return;
    }
    // A change of metre mid-run would otherwise leave the counter measured in
    // the old division and the clicks would land nowhere in particular.
    if (perPulse !== divisionsSoFar) {
      nextClick = Math.ceil(clock.beatNow() * perPulse);
      divisionsSoFar = perPulse;
    }
    while (clock.timeForBeat(nextClick / perPulse) < context.currentTime + 0.2) {
      const at = Math.max(clock.timeForBeat(nextClick / perPulse), context.currentTime);
      const divisions = metre.pulses * perPulse;
      const place = ((nextClick % divisions) + divisions) % divisions;
      // Three voices, not two: the bar, the pulse, and the quavers under it.
      // The subdivision is deliberately quiet — it is there to be felt rather
      // than followed, and a loud one would drown the thing being judged.
      if (place === 0) click(context, at, true);
      else if (place % perPulse === 0) click(context, at, false);
      else if (perPulse > 1) click(context, at, false, 0.06);
      nextClick++;
    }
  };

  const trail = [];
  const loop = () => {
    requestAnimationFrame(loop);

    const pattern = currentPattern();
    const beat = clock.beatNow();
    const beatInBar = ((beat % pattern.length) + pattern.length) % pattern.length;

    scheduleClicks();
    const rebound = Number(ui.rebound.value) / 100;
    trail.push({ at: context.currentTime, ...tipAt(pattern, beatInBar, rebound, extraLag()) });
    while (trail.length && trail[0].at < context.currentTime - TRAIL_SECONDS) trail.shift();

    draw(pattern, trail);
    ui.beatNumber.textContent = ui.reveal.checked ? String(Math.floor(beatInBar) + 1) : '';
  };
  requestAnimationFrame(loop);
}

function draw(pattern, trail) {
  const canvas = ui.canvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.body);
  const ink = styles.getPropertyValue('--text').trim();
  const faint = styles.getPropertyValue('--border').trim();

  /*
   * Normalised space to pixels.
   *
   * One framing for every shape, sized to hold the largest of them. The beat
   * pattern therefore appears at exactly the same size whichever is selected,
   * which it has to: a comparison where one option is drawn bigger than another
   * is a comparison of sizes.
   */
  const scale = Math.min(width / (VIEW.maxX - VIEW.minX), height / (VIEW.maxY - VIEW.minY));
  const midX = (VIEW.minX + VIEW.maxX) / 2;
  const midY = (VIEW.minY + VIEW.maxY) / 2;
  const px = (p) => ({
    x: width / 2 + (p.x - midX) * scale,
    y: height / 2 + (p.y - midY) * scale,
  });

  if (!ui.plain.checked) {
    ctx.fillStyle = faint;
    for (const point of pattern) {
      const at = px(point);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const now = trail.length ? trail[trail.length - 1].at : 0;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const age = (now - trail[i].at) / TRAIL_SECONDS;
    const from = px(trail[i - 1]);
    const to = px(trail[i]);
    ctx.globalAlpha = Math.max(0, 0.5 * (1 - age) ** 2);
    ctx.lineWidth = 2 + 6 * (1 - age) ** 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  if (!trail.length) return;

  /*
   * Whatever the shape is, it hangs off the point the trail just reached.
   *
   * The shapes themselves are described in `conductor-shape.js` as plain lines
   * and circles, so the same description can be drawn here and rendered to a
   * still image for inspection. Nothing about any of them is a stored frame:
   * every point is derived from the beat, which is what lets a rit. be followed
   * at all.
   */
  const tip = trail[trail.length - 1];
  const { strokes, circles } = shapeParts(
    ui.shape.value,
    tip,
    pattern,
    Number(ui.travel.value) / 100,
  );

  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const stroke of strokes) {
    ctx.lineWidth = Math.max(2, stroke.width * scale);
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const at = px(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
  }

  for (const circle of circles) {
    const at = px(circle.at);
    ctx.beginPath();
    ctx.arc(at.x, at.y, Math.max(3, circle.radius * scale), 0, Math.PI * 2);
    if (circle.fill) {
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(2, (circle.width ?? 0.03) * scale);
      ctx.stroke();
    }
  }
}

/** A short click, accented on the first beat of the bar. */
function click(context, at, accented, level) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.frequency.value = accented ? 1600 : 1100;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level ?? (accented ? 0.35 : 0.2), at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(gain).connect(context.destination);
  osc.start(at);
  osc.stop(at + 0.06);
}
