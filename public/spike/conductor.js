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
 * The pattern as currently set: the metre's shape, cut down to the extent the
 * dynamic asks for. A conductor beating a quiet passage uses the same shape and
 * simply makes it smaller, in both directions and by different amounts.
 */
const currentPattern = () =>
  scaledPattern(
    PATTERNS[Number(ui.beats.value)],
    Number(ui.spread.value) / 100,
    Number(ui.height.value) / 100,
  );

const showRatio = () => {
  const value = Number(ui.rebound.value);
  const style = STYLES.find((s) => value <= s.upTo).name;
  const pattern = currentPattern();
  const rebound = value / 100;
  // The ictus is the change of direction, so that is the headline; the speed
  // contrast is worth reporting too but it is not what a beat *is*.
  ui.ratio.textContent =
    `${style} — weakest ictus ${weakestIctus(pattern, rebound).toFixed(1)}, ` +
    `speed ${readability(pattern, rebound).toFixed(1)}x`;
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

ui.rebound.addEventListener('input', showRatio);
ui.beats.addEventListener('change', showRatio);
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
  let nextClick = Math.ceil(clock.beatNow());
  const scheduleClicks = () => {
    if (!ui.click.checked) {
      nextClick = Math.ceil(clock.beatNow());
      return;
    }
    while (clock.timeForBeat(nextClick) < context.currentTime + 0.2) {
      const at = Math.max(clock.timeForBeat(nextClick), context.currentTime);
      const beats = PATTERNS[Number(ui.beats.value)].length;
      click(context, at, ((nextClick % beats) + beats) % beats === 0);
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
    trail.push({ at: context.currentTime, ...tipAt(pattern, beatInBar, rebound) });
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
function click(context, at, accented) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.frequency.value = accented ? 1600 : 1100;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(accented ? 0.35 : 0.2, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(gain).connect(context.destination);
  osc.start(at);
  osc.stop(at + 0.06);
}
