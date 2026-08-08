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

import { useEffect, useRef } from 'react';
import type { Metre } from '../domain/metre';
import { pulseAt } from '../domain/metre';
import type { Transport } from '../engine/clock';
import {
  extentOf,
  gripFor,
  patternFor,
  tipAt,
  type ConductorPoint,
} from '../render/conductor';
import { currentTheme, type StaveTheme } from '../render/surface';

interface ConductorPanelProps {
  transport: Transport;
  metre: Metre;
}

/**
 * How lively the gesture is, from smooth through to marcato.
 *
 * Fixed for now at what the spike's slider calls "lively". It wants to become a
 * setting — it is a genuine difficulty axis, since a smooth conductor is
 * markedly harder to follow and learning to find the beat in a vague gesture is
 * a real skill — but that is a separate decision from whether the thing appears
 * at all.
 */
const STYLE = 0.55;

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

export function ConductorPanel({ transport, metre }: ConductorPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pattern = patternFor(metre);

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
    const extent = extentOf(pattern, STYLE);
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
      const pulse = pulseAt(metre, transport.visualBeat());
      const tip = tipAt(pattern, pulse, STYLE);
      const grip = gripFor(pattern, tip);

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
      const tipAtPx = px(tip);
      const gripAtPx = px(grip);
      ctx.lineWidth = Math.max(1.5, scale * 0.018);
      ctx.beginPath();
      ctx.moveTo(gripAtPx.x, gripAtPx.y);
      ctx.lineTo(tipAtPx.x, tipAtPx.y);
      ctx.stroke();

      ctx.fillStyle = theme.note;
      ctx.beginPath();
      ctx.arc(gripAtPx.x, gripAtPx.y, Math.max(2, scale * 0.032), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tipAtPx.x, tipAtPx.y, Math.max(1.5, scale * 0.018), 0, Math.PI * 2);
      ctx.fill();
    };

    frame = requestAnimationFrame(draw);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      colourScheme?.removeEventListener('change', onSchemeChange);
    };
  }, [transport, metre, pattern]);

  // No pattern for this metre means no conductor, and the metronome carries on
  // alone. Guessing a shape would teach a gesture no conductor will ever make.
  if (!pattern) return null;

  return (
    <div className="conductor" aria-hidden="true">
      <canvas ref={canvasRef} className="conductor__canvas" />
    </div>
  );
}
