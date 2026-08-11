/**
 * The conductor, beating the metre beside the recent-notes list.
 *
 * Its own canvas and its own frame loop rather than a corner of the stave: the
 * two are sized and positioned by entirely different rules, and the stave has
 * no pixels to spare. Both read the same audio clock, so nothing can drift
 * between them — the conductor needs no timing logic of its own at all.
 *
 * Portrait only. Sideways the stave is sized by the height of the screen, and
 * anything else taking a share of that comes straight out of the notation.
 * `.conductor` is hidden by the orientation rule in `index.css`; this component
 * still runs there, which costs one small canvas and keeps the markup honest
 * about what is on the page.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Metre } from '../domain/metre';
import type { Transport } from '../engine/clock';
import { steppedTempoAt, type TempoEvent } from '../domain/tempo';
import {
  extentOf,
  gripFor,
  panelAspect,
  patternFor,
  placeInPattern,
  shapeFor,
  shapedPattern,
  tipAt,
  type ConductorPoint,
} from '../render/conductor';
import { currentTheme, type StaveTheme } from '../render/surface';

interface ConductorPanelProps {
  transport: Transport;
  metre: Metre;
  /**
   * How lively the gesture is, from smooth through to marcato. The player's
   * setting; `render/conductor.ts` owns what the number means.
   */
  style: number;
  /** The opening tempo, in conducted beats per minute. */
  tempo: number;
  /**
   * Where the tempo moves, so the pattern can move with it.
   *
   * A step is a genuinely new speed — a join taking the music from 150 to 190
   * is beaten differently, and a conductor changes pattern there — so the
   * gesture follows one. A *ramp* it must not follow: a rit passing through a
   * threshold on its way somewhere would reorganise the hand mid-bend, which is
   * unfollowable exactly where following matters most, and it would flick back
   * a bar later. `steppedTempoAt` draws that line.
   */
  tempoEvents: readonly TempoEvent[];
}

/**
 * How long the tail behind the tip lasts, in seconds.
 *
 * Fixed in time rather than in distance, which makes it a speed readout: long
 * through the ictus where the hand is quick, barely there at the top of an arc
 * where it hangs. That matters more the smaller the panel is, because speed
 * survives being shrunk and detail does not.
 */
const TRAIL_SECONDS = 0.4;

/** Room left round the gesture so the tip never touches the edge. */
const PADDING = 0.08;

/**
 * The orb: conductor intent as light at the tip, on its own channel.
 *
 * Position carries the beat and must never carry anything else, so intent is
 * light instead — the same licence the trail takes, an invented graphic for a
 * true quantity. The quantity is the transport's ramp ratio: how far the
 * tempo has bent within the ramp now in progress, 1 wherever none is. So the
 * orb appears only while the speed is actually changing — cooling blue as a
 * rit takes energy out — and a settled tempo, whatever it is, shows nothing.
 *
 * The palette deliberately avoids the verdict colours: blue rather than
 * green for calm, and when accels one day warm the tip it will be the violet
 * family rather than red. Full strength by a third of the way to half speed,
 * so the glow is legible early in an ordinary rit rather than only at the
 * bottom of a deep one.
 */
const COOL_RGB = '59, 130, 246';
const WARM_RGB = '192, 38, 211';
const ORB_FULL_AT = 0.35;

export function ConductorPanel({
  transport,
  metre,
  style,
  tempo,
  tempoEvents,
}: ConductorPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * The speed the music has settled at, which is what picks the pattern.
   *
   * State rather than a value read in the loop, because the pattern decides the
   * panel's proportions as well as its drawing — a four going alla breve is a
   * different shape in a differently shaped box. Set from the frame loop and
   * guarded, so the re-render happens on the handful of beats where a step
   * actually crosses a threshold and never otherwise.
   */
  const [settled, setSettled] = useState(tempo);
  const settledRef = useRef(tempo);
  const drawn = patternFor(metre, settled);
  /*
   * The gesture, worked out once rather than per frame.
   *
   * `shapeFor` reads the style setting and `shapedPattern` applies it, so what
   * the rest of this component handles is already the shape that will be drawn
   * — the raw entry in `PATTERNS` is a diagram and never reaches the canvas.
   *
   * **Memoised because the effect below owns an animation, not because this is
   * expensive.** Both of these build fresh objects, so unmemoised they were new
   * on every render — and the effect lists them, so it tore down the frame loop
   * and started another every time the play screen re-rendered. That is once a
   * note: measured at thirteen restarts across eleven judged notes, each of them
   * throwing away the trail, which is the one part of the drawing that carries
   * how fast the hand is moving. `patternFor` returns a shared entry from
   * `PATTERNS`, so `drawn` is stable of itself.
   */
  const shape = useMemo(() => shapeFor(style), [style]);
  const pattern = useMemo(() => (drawn ? shapedPattern(drawn, shape) : null), [drawn, shape]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let theme: StaveTheme = currentTheme();
    const colourScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSchemeChange = () => {
      theme = currentTheme();
    };
    colourScheme?.addEventListener('change', onSchemeChange);

    // The gesture's own bounds, so the panel fits the pattern rather than the
    // pattern being drawn at whatever size a guessed aspect ratio allows.
    const extent = extentOf(pattern, shape.lag);
    const trail: Array<ConductorPoint & { at: number }> = [];
    let frame: number | null = null;

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      // Sideways the panel is display:none and has no size at all. Bail rather
      // than animate something nobody can see.
      if (rect.width < 1 || rect.height < 1) return;
      const width = rect.width;
      const height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const scale = Math.min(
        (width * (1 - PADDING * 2)) / extent.width,
        (height * (1 - PADDING * 2)) / extent.height,
      );
      const px = (p: ConductorPoint) => ({
        x: width / 2 + (p.x - (extent.minX + extent.maxX) / 2) * scale,
        y: height / 2 + (p.y - (extent.minY + extent.maxY) / 2) * scale,
      });

      // Interpolated rather than raw, so the gesture is smooth between audio
      // ticks — the same reading the notation is positioned from.
      const beat = transport.visualBeat();
      // Cheap: a handful of events, walked once a frame, and `setSettled` is
      // guarded so React sees a change only when the pattern really moves.
      const declared = steppedTempoAt(tempo, tempoEvents, beat);
      if (declared !== settledRef.current) {
        settledRef.current = declared;
        setSettled(declared);
      }
      const place = placeInPattern(metre, pattern, beat);
      const tip = tipAt(pattern, place, shape.lag);
      const grip = gripFor(pattern, tip);
      const tipPx = px(tip);

      // Behind everything, so the gesture stays crisp over its own light.
      const ratio = transport.rampRatio(beat);
      const bend = Math.abs(1 - ratio);
      if (bend > 0.02) {
        const strength = Math.min(1, bend / ORB_FULL_AT);
        const rgb = ratio < 1 ? COOL_RGB : WARM_RGB;
        const radius = scale * (0.1 + 0.08 * strength);
        const glow = ctx.createRadialGradient(tipPx.x, tipPx.y, 0, tipPx.x, tipPx.y, radius);
        glow.addColorStop(0, `rgba(${rgb}, ${0.5 * strength})`);
        glow.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(tipPx.x, tipPx.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      const now = performance.now() / 1000;
      trail.push({ ...tip, at: now });
      while (trail.length > 0 && trail[0].at < now - TRAIL_SECONDS) trail.shift();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = theme.note;
      for (let i = 1; i < trail.length; i++) {
        const age = (now - trail[i].at) / TRAIL_SECONDS;
        const from = px(trail[i - 1]);
        const to = px(trail[i]);
        ctx.globalAlpha = Math.max(0, 0.35 * (1 - age) ** 2);
        ctx.lineWidth = Math.max(1, scale * 0.012 * (1 - age));
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      const gripAtPx = px(grip);
      ctx.lineWidth = Math.max(1.5, scale * 0.018);
      ctx.beginPath();
      ctx.moveTo(gripAtPx.x, gripAtPx.y);
      ctx.lineTo(tipPx.x, tipPx.y);
      ctx.stroke();

      ctx.fillStyle = theme.note;
      ctx.beginPath();
      ctx.arc(gripAtPx.x, gripAtPx.y, Math.max(2, scale * 0.032), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tipPx.x, tipPx.y, Math.max(1.5, scale * 0.018), 0, Math.PI * 2);
      ctx.fill();
    };

    frame = requestAnimationFrame(draw);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      colourScheme?.removeEventListener('change', onSchemeChange);
    };
  }, [transport, metre, pattern, shape.lag, tempo, tempoEvents]);

  // No pattern for this metre means no conductor, and the metronome carries on
  // alone. Guessing a shape would teach a gesture no conductor will ever make.
  if (!pattern) return null;

  /*
   * The box takes the gesture's own proportions.
   *
   * A pattern is nothing like square and no two metres agree: beaten in two
   * it is roughly three times as tall as it is wide, in four it is wider than
   * it is tall. A fixed box fits whichever it was guessed for and letterboxes
   * the rest — the two pattern was drawing at under half the size its panel
   * could hold, in the corner of the screen where it is least visible anyway.
   *
   * The draw loop already fits the gesture to whatever box it is given, so
   * this only has to stop the box lying about the shape it holds.
   */
  const extent = extentOf(pattern, shape.lag);

  return (
    <div
      className="conductor"
      aria-hidden="true"
      style={{ aspectRatio: String(panelAspect(extent)) }}
    >
      <canvas ref={canvasRef} className="conductor__canvas" />
    </div>
  );
}
