import { PATTERNS, shapeParts, tipAt } from './conductor-shape.js';

/**
 * The fermata spike: a hold of unknown length, a drawn release, and the
 * question of whether a player can come in together off it.
 *
 * The gesture under test is the ruled one. The hand beats normally, gives the
 * held note its ictus, and stops beating time — Robertson: "the conducting
 * pattern should stop only after all the rhythmic activity in the score
 * stops". The sustain is a meld, drifting slowly toward the point the release
 * will fall from, its direction anticipating the prep. Then the release: a
 * tiny lift — the breath — and the drop to the contact line, taking one pulse
 * of the resumed tempo, or two when the tempo changes at the hold, which is
 * the extra beat that establishes the new speed. The orb builds violet
 * through the sustain and discharges on the release ictus.
 *
 * The figure that decides is the spread of re-entries in milliseconds,
 * measured from taps or from the microphone's amplitude onset. Light says
 * soon; the lift-and-drop says now. If the spread will not come down, the
 * gesture is not right yet, and the app keeps fermatas drawn-but-unscheduled
 * until it is.
 */

const TRAIL_SECONDS = 0.45;
const VIEW = { minX: -0.95, maxX: 0.95, minY: -0.85, maxY: 1.1 };

/** The same palette the app's tempo plan steps by, so the drop teaches truly. */
const TEMPO_FACTORS = [0.8, 0.9, 1.1, 1.25];

/** How much of a one-pulse release is the lift; the rest is the drop. */
const LIFT_SHARE = 0.35;

/** The orb's violet, per the ruling: off the verdict palette, warm not red. */
const ORB_RGB = '192, 38, 211';

const el = (id) => document.getElementById(id);
const ui = {
  start: el('start'),
  beats: el('beats'),
  bars: el('bars'),
  newTempo: el('newTempo'),
  click: el('click'),
  sound: el('sound'),
  reveal: el('reveal'),
  mic: el('mic'),
  tempo: el('tempo'),
  tempoValue: el('tempo-value'),
  holdMin: el('holdMin'),
  holdMax: el('holdMax'),
  holdRange: el('hold-range'),
  lift: el('lift'),
  liftValue: el('lift-value'),
  rebound: el('rebound'),
  styleValue: el('style-value'),
  build: el('build'),
  buildValue: el('build-value'),
  throb: el('throb'),
  throbValue: el('throb-value'),
  status: el('status'),
  stage: el('stage'),
  canvas: el('canvas'),
  beatNumber: el('beat-number'),
  spread: el('spread'),
  trials: el('trials'),
  reset: el('reset'),
  level: el('level'),
  levelFill: el('level-fill'),
};

const STYLES = [
  { upTo: 32, name: 'smooth' },
  { upTo: 47, name: 'flowing' },
  { upTo: 62, name: 'lively' },
  { upTo: 77, name: 'crisp' },
  { upTo: 100, name: 'marcato' },
];

const holdRange = () => {
  let min = Number(ui.holdMin.value) / 10;
  let max = Number(ui.holdMax.value) / 10;
  if (min > max) [min, max] = [max, min];
  return { min, max };
};

const showLabels = () => {
  ui.tempoValue.textContent = `${ui.tempo.value} bpm`;
  const { min, max } = holdRange();
  ui.holdRange.textContent = `holds ${min.toFixed(1)}–${max.toFixed(1)}s`;
  ui.liftValue.textContent = `lift ${ui.lift.value}%`;
  ui.styleValue.textContent = STYLES.find((s) => Number(ui.rebound.value) <= s.upTo).name;
  ui.buildValue.textContent = `build curve ${(Number(ui.build.value) / 10).toFixed(1)}`;
  ui.throbValue.textContent = `throb ${(Number(ui.throb.value) / 10).toFixed(1)} Hz`;
};
for (const input of [ui.tempo, ui.holdMin, ui.holdMax, ui.lift, ui.rebound, ui.build, ui.throb]) {
  input.addEventListener('input', showLabels);
}
showLabels();

/** Every trial taken: { hold, offset, source }. Offsets in seconds. */
const trials = [];

const renderTrials = () => {
  if (trials.length === 0) {
    ui.spread.textContent = 'no re-entries yet';
    ui.trials.innerHTML = '';
    return;
  }
  const offsets = trials.map((t) => t.offset);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const sd = Math.sqrt(offsets.reduce((a, x) => a + (x - mean) ** 2, 0) / offsets.length);
  const lateness = mean >= 0 ? `${Math.round(mean * 1000)}ms late` : `${Math.round(-mean * 1000)}ms early`;
  ui.spread.textContent =
    trials.length < 3
      ? `${trials.length} re-entr${trials.length === 1 ? 'y' : 'ies'} — keep going`
      : `spread ±${Math.round(sd * 1000)}ms over ${trials.length} (mean ${lateness})`;

  const recent = trials.slice(-10).reverse();
  ui.trials.innerHTML =
    '<tr><th>hold</th><th>offset</th><th>heard by</th></tr>' +
    recent
      .map(
        (t) =>
          `<tr><td>${t.hold.toFixed(1)}s</td><td>${t.offset >= 0 ? '+' : ''}${Math.round(
            t.offset * 1000,
          )}ms</td><td>${t.source}</td></tr>`,
      )
      .join('');
};
ui.reset.addEventListener('click', () => {
  trials.length = 0;
  renderTrials();
});

ui.start.addEventListener('click', () => void start(), { once: true });

async function start() {
  const context = new AudioContext();
  await context.resume();

  ui.start.disabled = true;
  ui.status.textContent =
    'Watch the stick. Play — or tap the stage — on the drop, and only on the drop.';

  /*
   * One cycle: a phrase, the held last beat, the sustain, the release. Each is
   * laid out in seconds on the audio clock when it begins, because a dwell is
   * seconds during which no beats pass — the same shape the app's map gives
   * the transport, precomputed here because a spike earns no closed forms.
   */
  const buildCycle = (startTime, bpm) => {
    const count = Number(ui.beats.value);
    const beatsTotal = count * Number(ui.bars.value);
    const pulse = 60 / bpm;
    const heldIctus = startTime + (beatsTotal - 1) * pulse;
    const dwellStart = startTime + beatsTotal * pulse;

    const resumed = ui.newTempo.checked
      ? Math.round(Number(ui.tempo.value) * TEMPO_FACTORS[Math.floor(Math.random() * TEMPO_FACTORS.length)])
      : bpm;
    const prepPulses = resumed === bpm ? 1 : 2;
    const prepSec = (prepPulses * 60) / resumed;

    const { min, max } = holdRange();
    const floor = prepSec + 0.5;
    const hold = Math.max(floor, min) + Math.random() * Math.max(0.1, max - Math.max(floor, min));

    return {
      start: startTime,
      bpm,
      pulse,
      count,
      beatsTotal,
      heldIctus,
      dwellStart,
      hold,
      resumed,
      prepPulses,
      prepSec,
      liftStart: dwellStart + hold - prepSec,
      reentry: dwellStart + hold,
      clicked: 0,
      trialTaken: false,
      noteStarted: false,
    };
  };

  let cycle = buildCycle(context.currentTime + 1, Number(ui.tempo.value));
  cycle.isFirst = true;

  /** First onset in the armed window becomes the trial; the rest is playing. */
  const takeTrial = (at, source) => {
    const armFrom = cycle.liftStart + 0.12;
    if (cycle.trialTaken || at < armFrom || at > cycle.reentry + 1.2) return;
    cycle.trialTaken = true;
    trials.push({ hold: cycle.hold, offset: at - cycle.reentry, source });
    renderTrials();
  };

  ui.stage.addEventListener('pointerdown', () => takeTrial(context.currentTime, 'tap'));
  window.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      takeTrial(context.currentTime, 'tap');
    }
  });

  ui.mic.addEventListener('change', () => {
    if (ui.mic.checked) void listen();
  });

  /**
   * Amplitude onset from the microphone, timed by the audio block it lands in
   * rather than by whichever frame noticed — `playbackTime` plus the sample
   * offset is honest to a millisecond, and the whole page exists to measure
   * milliseconds.
   */
  async function listen() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (error) {
      ui.status.textContent = `No microphone: ${String(error)}`;
      ui.mic.checked = false;
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const tap = context.createScriptProcessor(1024, 1, 1);
    const THRESHOLD = 0.05;
    // One onset per sound: fires on the first loud sample, rearms only after
    // 300ms of quiet, so a sustained note is an attack rather than a stream.
    let armed = true;
    let quietSince = null;

    tap.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      let peak = 0;
      let onsetIndex = -1;
      for (let i = 0; i < samples.length; i++) {
        const level = Math.abs(samples[i]);
        if (level > peak) peak = level;
        if (onsetIndex < 0 && level > THRESHOLD) onsetIndex = i;
      }
      ui.levelFill.style.width = `${Math.min(100, peak * 300)}%`;

      if (onsetIndex >= 0) {
        if (armed) {
          takeTrial(event.playbackTime + onsetIndex / context.sampleRate, 'mic');
          armed = false;
        }
        quietSince = null;
      } else if (quietSince === null) {
        quietSince = event.playbackTime;
      } else if (event.playbackTime - quietSince > 0.3) {
        armed = true;
      }
    };

    source.connect(tap);
    tap.connect(context.destination);
    ui.level.hidden = false;
    ui.status.textContent = 'Listening. Headphones on, or held note and metronome off.';
  }

  /** A short click, accented on the first beat of the bar. */
  const click = (at, accented) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = accented ? 1600 : 1100;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accented ? 0.35 : 0.2, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(context.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  };

  /** The held note: sustains through the meld, and the lift takes it off. */
  const holdNote = (from, until) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = 233.08; // Bb3, a tuba-ish register without mud
    osc.type = 'triangle';
    gain.gain.setValueAtTime(0.0001, from);
    gain.gain.exponentialRampToValueAtTime(0.18, from + 0.04);
    gain.gain.setValueAtTime(0.18, until);
    gain.gain.exponentialRampToValueAtTime(0.0001, until + 0.08);
    osc.connect(gain).connect(context.destination);
    osc.start(from);
    osc.stop(until + 0.1);
  };

  const schedule = () => {
    const horizon = context.currentTime + 0.2;
    if (ui.click.checked) {
      while (cycle.clicked < cycle.beatsTotal && cycle.start + cycle.clicked * cycle.pulse < horizon) {
        const at = cycle.start + cycle.clicked * cycle.pulse;
        if (at >= context.currentTime - 0.01) click(Math.max(at, context.currentTime), cycle.clicked % cycle.count === 0);
        cycle.clicked++;
      }
    } else {
      cycle.clicked = Math.max(cycle.clicked, Math.ceil((horizon - cycle.start) / cycle.pulse));
    }
    if (!cycle.noteStarted && ui.sound.checked && cycle.heldIctus < horizon) {
      holdNote(cycle.heldIctus, cycle.liftStart);
      cycle.noteStarted = true;
    }
  };

  const easeInOut = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - (1 - t) ** 2;

  /**
   * Where the tip is, given the clock — beat-driven until the held ictus,
   * time-driven through the meld and the release, handing back at re-entry.
   */
  const tipNow = (now, pattern) => {
    const rebound = Number(ui.rebound.value) / 100;
    const p0 = pattern[0];
    const plast = pattern[pattern.length - 1];
    // The final apex: directly above the downbeat's landing, at the height
    // the pattern's own last rebound reaches. The drop from there is the
    // pattern's most recognisable stroke, which is why the release reuses it.
    const apexY = (plast.y + p0.y) / 2 - plast.rebound;
    const liftHeight = Number(ui.lift.value) / 100;

    if (now < cycle.heldIctus) {
      const beat = (now - cycle.start) / cycle.pulse;
      return tipAt(pattern, ((beat % pattern.length) + pattern.length) % pattern.length, rebound);
    }

    const meldTarget =
      cycle.prepPulses === 2 ? { x: plast.x, y: apexY } : { x: p0.x, y: apexY };

    if (now < cycle.liftStart) {
      // The meld: slow, its direction anticipating the prep.
      const progress = (now - cycle.heldIctus) / (cycle.liftStart - cycle.heldIctus);
      const eased = easeInOut(Math.min(1, progress));
      return {
        x: plast.x + (meldTarget.x - plast.x) * eased,
        y: plast.y + (meldTarget.y - plast.y) * eased,
      };
    }

    if (now < cycle.reentry) {
      const u = (now - cycle.liftStart) / cycle.prepSec;

      const liftDrop = (from, floor, t) => {
        if (t < LIFT_SHARE) {
          return { x: from.x, y: from.y - liftHeight * easeOut(t / LIFT_SHARE) };
        }
        const v = (t - LIFT_SHARE) / (1 - LIFT_SHARE);
        const top = from.y - liftHeight;
        // Accelerating into the landing: the ictus is carried by the change
        // of speed, so the drop must arrive quick, not settle.
        return { x: from.x + (floor.x - from.x) * v, y: top + (floor.y - top) * v * v };
      };

      if (cycle.prepPulses === 1) return liftDrop(meldTarget, p0, Math.min(1, u));

      // Two pulses: beat the bar's last pulse in the new tempo — lift and
      // drop onto it — then the pattern's own final stroke onto the downbeat.
      if (u < 0.5) return liftDrop(meldTarget, plast, u * 2);
      return tipAt(pattern, pattern.length - 1 + Math.min(1, (u - 0.5) * 2), rebound);
    }

    const beat = (now - cycle.reentry) / (60 / cycle.resumed);
    return tipAt(pattern, ((beat % pattern.length) + pattern.length) % pattern.length, rebound);
  };

  const trail = [];
  const loop = () => {
    requestAnimationFrame(loop);
    const now = context.currentTime;

    if (now >= cycle.reentry) {
      // The next phrase opens in the tempo the release established; with the
      // wandering off, it rejoins the slider instead. Sliders otherwise take
      // effect at the next cycle, never mid-gesture.
      const nextBpm = ui.newTempo.checked ? cycle.resumed : Number(ui.tempo.value);
      cycle = buildCycle(cycle.reentry, nextBpm);
    }
    schedule();

    const pattern = PATTERNS[Number(ui.beats.value)];
    trail.push({ at: now, ...tipNow(now, pattern) });
    while (trail.length && trail[0].at < now - TRAIL_SECONDS) trail.shift();

    draw(pattern, trail, now);

    const inHold = now >= cycle.heldIctus && now < cycle.reentry;
    const beat =
      now < cycle.heldIctus
        ? Math.floor(((now - cycle.start) / cycle.pulse) % cycle.count) + 1
        : cycle.count;
    ui.beatNumber.textContent = ui.reveal.checked ? (inHold ? '𝄐' : String(beat)) : '';
  };
  requestAnimationFrame(loop);

  function draw(pattern, trail, now) {
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

    const scale = Math.min(width / (VIEW.maxX - VIEW.minX), height / (VIEW.maxY - VIEW.minY));
    const midX = (VIEW.minX + VIEW.maxX) / 2;
    const midY = (VIEW.minY + VIEW.maxY) / 2;
    const px = (p) => ({
      x: width / 2 + (p.x - midX) * scale,
      y: height / 2 + (p.y - midY) * scale,
    });

    ctx.fillStyle = faint;
    for (const point of pattern) {
      const at = px(point);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // The fermata itself, standing instruction rather than surprise: an arc
    // and a dot, brighter while the hold is on.
    const inHold = now >= cycle.heldIctus && now < cycle.reentry;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.globalAlpha = inHold ? 0.9 : 0.25;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(width / 2, 34, 16, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width / 2, 30, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (!trail.length) return;
    const tip = trail[trail.length - 1];
    const tipPx = px(tip);

    /*
     * The orb: builds through the sustain, throbs at breath rate, and
     * discharges on the release ictus. Behind the trail and the stick, so
     * the gesture stays crisp over its own light.
     */
    const buildExp = Number(ui.build.value) / 10;
    const throbHz = Number(ui.throb.value) / 10;
    if (now >= cycle.heldIctus && now < cycle.reentry) {
      const progress = (now - cycle.heldIctus) / (cycle.reentry - cycle.heldIctus);
      const throb = 0.75 + 0.25 * Math.sin(2 * Math.PI * throbHz * (now - cycle.heldIctus));
      const strength = Math.min(1, progress ** buildExp) * throb;
      const radius = scale * (0.09 + 0.09 * strength);
      const glow = ctx.createRadialGradient(tipPx.x, tipPx.y, 0, tipPx.x, tipPx.y, radius);
      glow.addColorStop(0, `rgba(${ORB_RGB}, ${0.6 * strength})`);
      glow.addColorStop(1, `rgba(${ORB_RGB}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tipPx.x, tipPx.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (now - cycle.start < 0.35 && !cycle.isFirst) {
      // The discharge: a fast fading burst on the ictus the drop landed on.
      const age = (now - cycle.start) / 0.35;
      const radius = scale * 0.22 * (1 - age * 0.4);
      const glow = ctx.createRadialGradient(tipPx.x, tipPx.y, 0, tipPx.x, tipPx.y, radius);
      glow.addColorStop(0, `rgba(${ORB_RGB}, ${0.55 * (1 - age)})`);
      glow.addColorStop(1, `rgba(${ORB_RGB}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tipPx.x, tipPx.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

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

    const { strokes, circles } = shapeParts('baton', tip, pattern, 0.3);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineJoin = 'round';
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
      if (circle.fill) ctx.fill();
      else {
        ctx.lineWidth = Math.max(2, (circle.width ?? 0.03) * scale);
        ctx.stroke();
      }
    }
  }
}
