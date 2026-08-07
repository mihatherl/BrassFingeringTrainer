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

/*
 * The beat patterns, as the points where the hand lands.
 *
 * Standard shapes: four beats are down, left, right, up; three are down, right,
 * up; two are down and up. x runs left to right, y downward, both normalised.
 */
const PATTERNS = {
  2: [
    { x: 0, y: 1 },
    { x: 0.5, y: 0.45 },
  ],
  3: [
    { x: 0, y: 1 },
    { x: 0.7, y: 0.72 },
    { x: 0.35, y: 0.35 },
  ],
  4: [
    { x: 0, y: 1 },
    { x: -0.75, y: 0.72 },
    { x: 0.75, y: 0.72 },
    { x: 0.3, y: 0.35 },
  ],
};

/*
 * The rebound above the line between two ictus points, and the whole design.
 *
 * A parabola, because that is what a thrown ball does: slowest at the top of
 * the arc, fastest at the bottom. So the hand is quick through the ictus and
 * nearly still between beats, which is what a conductor's hand does and what
 * makes a beat readable at all. Move the dot round the same path at a constant
 * rate and the beat disappears entirely.
 *
 * Two things were measured rather than assumed. Easing the sideways travel — the
 * obvious thing to do — makes the horizontal speed peak between beats and
 * cancels most of the vertical whip: it took the ratio of ictus speed to apex
 * speed down from 3.2 to 1.9. Sideways travel is therefore linear. And peaking
 * the arc early, so the hand "falls into" the next beat, makes it worse rather
 * than better, because a longer descent from a fixed height is a slower one.
 * The symmetric parabola wins; what asymmetry remains comes from the pattern's
 * own geometry and is honest.
 *
 * The depth is the one number worth arguing about, so it is on a slider in the
 * page rather than fixed here.
 */

const TRAIL_SECONDS = 0.55;

const el = (id) => document.getElementById(id);
const ui = {
  start: el('start'),
  beats: el('beats'),
  tempo: el('tempo'),
  tempoValue: el('tempo-value'),
  click: el('click'),
  reveal: el('reveal'),
  plain: el('plain'),
  rebound: el('rebound'),
  ratio: el('ratio'),
  canvas: el('canvas'),
  status: el('status'),
  beatNumber: el('beat-number'),
};

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

/** Where the hand is, given a position in the bar. */
function handAt(pattern, beatInBar, rebound) {
  const index = Math.floor(beatInBar) % pattern.length;
  const u = beatInBar - Math.floor(beatInBar);
  const from = pattern[index];
  const to = pattern[(index + 1) % pattern.length];

  return {
    x: from.x + (to.x - from.x) * u,
    y: from.y + (to.y - from.y) * u - rebound * 4 * u * (1 - u),
  };
}

/**
 * How much faster the hand moves at the ictus than at its slowest.
 *
 * Shown on screen because it is the number that decides whether any of this
 * works, and because a figure that can be reported back is worth more than an
 * impression. Measured across the busiest stroke of the pattern.
 */
function readability(pattern, rebound) {
  let worst = Infinity;
  for (let beat = 0; beat < pattern.length; beat++) {
    const speeds = [];
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      const d = 1e-4;
      const a = handAt(pattern, beat + Math.max(0, u - d), rebound);
      const b = handAt(pattern, beat + Math.min(1, u + d), rebound);
      speeds.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const slowest = Math.min(...speeds);
    worst = Math.min(worst, Math.max(speeds[0], speeds[100]) / (slowest || 1e-9));
  }
  return worst;
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

const showRatio = () => {
  const pattern = PATTERNS[Number(ui.beats.value)];
  const value = Number(ui.rebound.value);
  const style = STYLES.find((s) => value <= s.upTo).name;
  ui.ratio.textContent = `${style} — ictus ${readability(pattern, value / 100).toFixed(1)}x`;
};
ui.rebound.addEventListener('input', showRatio);
ui.beats.addEventListener('change', showRatio);
showRatio();

async function start() {
  const context = new AudioContext();
  await context.resume();
  const clock = new Clock(context, Number(ui.tempo.value));

  ui.start.disabled = true;
  ui.status.textContent = 'Watch the dot. Try to play, or clap, on the beat.';

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

    const pattern = PATTERNS[Number(ui.beats.value)];
    const beat = clock.beatNow();
    const beatInBar = ((beat % pattern.length) + pattern.length) % pattern.length;

    scheduleClicks();
    const rebound = Number(ui.rebound.value) / 100;
    trail.push({ at: context.currentTime, ...handAt(pattern, beatInBar, rebound) });
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

  // Normalised space to pixels, with room round the edges for the rebound.
  const scale = Math.min(width / 2.6, height / 1.7);
  const px = (p) => ({ x: width / 2 + p.x * scale, y: height * 0.18 + p.y * scale });

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
  if (trail.length) {
    const head = px(trail[trail.length - 1]);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(8, scale * 0.035), 0, Math.PI * 2);
    ctx.fill();
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
