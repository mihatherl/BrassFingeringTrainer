import { PATTERNS, scaledPattern, tipAt } from './conductor-shape.js';

/**
 * The gesture bench: define the two ends of the style axis, see every pattern.
 *
 * The conductor spike asks whether the beat can be found in the motion. This
 * asks a different question — what the gesture should *be* — and it exists
 * because that one turned out to be unanswerable there. Tuning coupling curves
 * through a row of unlabelled sliders, one pattern at a time, with the shape
 * moving as you watched, gave no way to hold two settings side by side and say
 * which was better.
 *
 * So: set the two ends, and everything between is interpolated. Every pattern
 * is drawn at once, still, in a grid — a still trace is the right way to
 * compare shapes, because the eye can hold five of them at a time and cannot
 * hold five animations. The one animated panel is for the lag, which is the
 * only parameter here that a still cannot show.
 *
 * The configuration prints itself at the bottom in a form meant to be copied
 * back into a conversation. That is the whole point of the page: the numbers
 * are the deliverable, not the drawing.
 */

const PULSES = [2, 3, 4, 6];
const COLUMNS = 5;

/**
 * What is adjustable, and why each one earns a dial.
 *
 * Deliberately five and not thirty. Every beat of every pattern has an x, a y
 * and a rebound, and the six pattern has five path points on top of that — a
 * bench exposing all of them would be a coordinate editor, and nobody can hold
 * a hundred numbers in their head. These are the five that describe how a
 * gesture *behaves*, and the drawn patterns remain what they are.
 */
const DIALS = [
  { key: 'width', label: 'Width', min: 40, max: 130, hint: 'how far the hand travels sideways' },
  { key: 'arcs', label: 'Arcs', min: 5, max: 150, hint: 'how high it rises between beats' },
  {
    key: 'downbeat',
    label: 'Downbeat',
    min: 5,
    max: 200,
    hint: 'the height the downbeat falls from, on its own curve',
  },
  {
    key: 'beats',
    label: 'Beat spread',
    min: 0,
    max: 130,
    hint: 'how far apart the ictus points sit vertically',
  },
  {
    key: 'lag',
    label: 'Lag',
    min: 0,
    max: 92,
    hint: 'how much it hangs between beats and snaps through them',
  },
];

/** Where the axis starts and ends. Everything between is a straight line. */
const ENDS = {
  flowing: { width: 100, arcs: 25, downbeat: 36, beats: 45, lag: 42 },
  marcato: { width: 100, arcs: 100, downbeat: 100, beats: 100, lag: 86 },
};

const el = (id) => document.getElementById(id);

function buildDials() {
  for (const end of ['flowing', 'marcato']) {
    const host = el(`dials-${end}`);
    for (const dial of DIALS) {
      const row = document.createElement('label');
      row.className = 'dial';
      row.innerHTML =
        `<span class="dial__name">${dial.label}</span>` +
        `<input type="range" min="${dial.min}" max="${dial.max}" step="1" ` +
        `value="${ENDS[end][dial.key]}" data-end="${end}" data-key="${dial.key}" />` +
        `<span class="dial__value" id="value-${end}-${dial.key}"></span>` +
        `<span class="dial__hint">${dial.hint}</span>`;
      host.append(row);
    }
  }
  for (const input of document.querySelectorAll('.dial input')) {
    input.addEventListener('input', () => {
      ENDS[input.dataset.end][input.dataset.key] = Number(input.value);
      render();
    });
  }
}

/** The settings a fraction of the way along the axis. */
function paramsAt(t) {
  const at = {};
  for (const { key } of DIALS) at[key] = ENDS.flowing[key] + (ENDS.marcato[key] - ENDS.flowing[key]) * t;
  return at;
}

function patternAt(pulses, p) {
  return scaledPattern(PATTERNS[pulses], p.width / 100, 1, {
    arcs: p.arcs / 100,
    prep: p.downbeat / 100,
    flatten: p.beats / 100,
  });
}

/**
 * The tip's path round one bar.
 *
 * `tipAt` takes a style and turns it into a lag; this bench sets the lag
 * directly, so it passes a style of zero and puts the whole figure in the extra
 * term — `lagFor(0, lag - 0.3)` is `lag`, subject to the 0.92 cap that stops
 * the tip from running backwards. Going through the existing parameter rather
 * than adding another keeps one definition of the warp.
 */
function traceOf(pattern, lag) {
  const points = [];
  const steps = 160 * pattern.length;
  for (let i = 0; i <= steps; i++) {
    points.push(tipAt(pattern, (i / steps) * pattern.length, 0, lag / 100 - 0.3));
  }
  return points;
}

/**
 * What a whole row occupies, so its cells can share a frame and be comparable.
 *
 * Cached against the dials, because the animated panel wants this every frame
 * and working it out costs five full traces — some thousands of spline
 * evaluations, each allocating the loop afresh. Uncached it was doing that
 * sixty times a second for a figure that only changes when a slider moves.
 */
const extents = new Map();
function rowExtent(pulses) {
  const key = `${pulses}|${JSON.stringify(ENDS)}`;
  const cached = extents.get(key);
  if (cached) return cached;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let column = 0; column < COLUMNS; column++) {
    const p = paramsAt(column / (COLUMNS - 1));
    for (const point of traceOf(patternAt(pulses, p), p.lag)) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
  }
  const extent = { minX, maxX, minY, maxY };
  // One entry per pattern per dial setting; dragging a slider makes a few
  // hundred at worst, which is nothing, and clearing on every change would
  // throw away exactly the ones being compared.
  extents.set(key, extent);
  return extent;
}

function paint(canvas, pattern, points, extent, ink, faint) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = 10;
  const scale = Math.min(
    (width - pad * 2) / (extent.maxX - extent.minX || 1),
    (height - pad * 2) / (extent.maxY - extent.minY || 1),
  );
  const px = (p) => ({
    x: width / 2 + (p.x - (extent.minX + extent.maxX) / 2) * scale,
    y: height / 2 + (p.y - (extent.minY + extent.maxY) / 2) * scale,
  });

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    const at = px(point);
    if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
  });
  ctx.stroke();

  // The ictus points, so where the beats actually land is visible rather than
  // inferred from the curve.
  ctx.fillStyle = faint;
  pattern.forEach((beat) => {
    const at = px(beat);
    ctx.beginPath();
    ctx.arc(at.x, at.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function buildGrid() {
  const grid = el('grid');
  grid.style.gridTemplateColumns = `4rem repeat(${COLUMNS}, 1fr)`;
  grid.append(cell('', 'grid__corner'));
  for (let column = 0; column < COLUMNS; column++) {
    const t = column / (COLUMNS - 1);
    grid.append(cell(t === 0 ? 'flowing' : t === 1 ? 'marcato' : `${Math.round(t * 100)}%`, 'grid__head'));
  }
  for (const pulses of PULSES) {
    grid.append(cell(pulses === 6 ? 'six' : `${pulses}`, 'grid__row-head'));
    for (let column = 0; column < COLUMNS; column++) {
      const holder = document.createElement('div');
      holder.className = 'grid__cell';
      const canvas = document.createElement('canvas');
      canvas.id = `cell-${pulses}-${column}`;
      holder.append(canvas);
      grid.append(holder);
    }
  }
}

function cell(text, className) {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = text;
  return node;
}

function theme() {
  const styles = getComputedStyle(document.body);
  return {
    ink: styles.getPropertyValue('--text').trim(),
    faint: styles.getPropertyValue('--accent').trim(),
  };
}

function render() {
  const { ink, faint } = theme();

  for (const end of ['flowing', 'marcato']) {
    for (const { key } of DIALS) {
      const value = ENDS[end][key];
      el(`value-${end}-${key}`).textContent = key === 'lag' ? (value / 100).toFixed(2) : `${value}%`;
    }
  }

  for (const pulses of PULSES) {
    const extent = rowExtent(pulses);
    for (let column = 0; column < COLUMNS; column++) {
      const p = paramsAt(column / (COLUMNS - 1));
      const pattern = patternAt(pulses, p);
      paint(el(`cell-${pulses}-${column}`), pattern, traceOf(pattern, p.lag), extent, ink, faint);
    }
  }

  el('config').textContent =
    ['flowing', 'marcato']
      .map(
        (end) =>
          `${end.padEnd(7)} ` +
          DIALS.map(({ key }) =>
            key === 'lag' ? `lag ${(ENDS[end].lag / 100).toFixed(2)}` : `${key} ${ENDS[end][key]}%`,
          ).join('  '),
      )
      .join('\n');
}

/**
 * One pattern, moving, because the lag is the only dial a still cannot show.
 *
 * Timed off `performance.now` rather than an audio clock. That is not good
 * enough to schedule sound against and would be wrong in the app, but nothing
 * here is being played to — this panel exists so the hang and the snap can be
 * seen, and a frame of jitter does not change how a gesture reads.
 */
function animate() {
  const canvas = el('preview');
  const trail = [];
  const TRAIL = 0.5;

  const frame = () => {
    requestAnimationFrame(frame);
    const pulses = Number(el('preview-metre').value);
    const t = Number(el('preview-position').value) / 100;
    const bpm = Number(el('preview-tempo').value);
    el('preview-position-value').textContent =
      t === 0
        ? 'flowing'
        : t === 1
          ? 'marcato'
          : t === 0.5
            ? 'halfway'
            : `${Math.round(t * 100)}% toward marcato`;
    el('preview-tempo-value').textContent = `${bpm} bpm`;

    const p = paramsAt(t);
    const pattern = patternAt(pulses, p);
    // Said outright rather than left to be inferred from the slider's position.
    el('preview-values').textContent = DIALS.map(({ key, label }) =>
      key === 'lag' ? `${label} ${(p.lag / 100).toFixed(2)}` : `${label} ${Math.round(p[key])}%`,
    ).join('   ');
    const now = performance.now() / 1000;
    const beat = (now * bpm) / 60;
    const at = ((beat % pattern.length) + pattern.length) % pattern.length;

    trail.push({ at: now, ...tipAt(pattern, at, 0, p.lag / 100 - 0.3) });
    while (trail.length && trail[0].at < now - TRAIL) trail.shift();

    const extent = rowExtent(pulses);
    const { ink, faint } = theme();
    paint(canvas, pattern, trail, extent, ink, faint);
  };
  requestAnimationFrame(frame);
}

el('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(el('config').textContent);
  el('copy').textContent = 'Copied';
  setTimeout(() => (el('copy').textContent = 'Copy'), 1200);
});

for (const id of ['preview-metre', 'preview-position', 'preview-tempo']) {
  el(id).addEventListener('input', render);
}

buildDials();
buildGrid();
render();
animate();
window.addEventListener('resize', render);
