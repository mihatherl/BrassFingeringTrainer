/**
 * An exercise, engraved to a standalone SVG document.
 *
 * Shared by `stave-to-svg.mts`, which is how engraving gets looked at by eye,
 * and by `engraving.test.ts`, which holds a set of these to the byte. Those two
 * have to be the same drawing or the check is worthless: a snapshot of a
 * reimplementation would go on passing while the tool drew something else.
 *
 * Everything the stave renderer asks of a canvas is a shape, so `SvgContext`
 * answers the dozen methods it calls and the output is the same geometry the
 * app draws rather than a redrawing of it.
 */

import { barCount, beatOfBar } from '../src/domain/metre.ts';
import type { Exercise } from '../src/exercise/types.ts';
import { planReview } from '../src/render/review.ts';
import { staveMetrics } from '../src/render/stave.ts';
import { LIGHT_THEME } from '../src/render/surface.ts';
import { drawSystem, justifiedX } from '../src/render/system.ts';
import { SvgContext, SvgPath2D } from './svg-context.mts';

/**
 * The glyphs are SVG path data before they are `Path2D`, and `glyphPath` builds
 * them lazily, so standing this in before any drawing happens is enough. It has
 * to be in place before the first `glyphPath` call, not before the imports.
 */
function installPath2D(): void {
  (globalThis as { Path2D?: unknown }).Path2D = SvgPath2D;
}

export const DEFAULT_WIDTH = 900;

export function exerciseToSvg(exercise: Exercise, width = DEFAULT_WIDTH): string {
  installPath2D();

  const layout = planReview(width, exercise);
  const ctx = new SvgContext();
  const totalBars = barCount(exercise.metres, exercise.totalBeats);

  layout.systemStarts.forEach((firstBar, system) => {
    const lastBar = layout.systemStarts[system + 1] ?? totalBars;
    const final = lastBar >= totalBars;
    drawSystem(ctx as unknown as CanvasRenderingContext2D, {
      exercise,
      metrics: staveMetrics(
        exercise.clef,
        system * layout.systemHeight + layout.staveSpace * 3.5,
        layout.staveSpace,
      ),
      xForBeat: justifiedX(
        layout.spacing,
        beatOfBar(exercise.metres, firstBar),
        Math.min(exercise.totalBeats, beatOfBar(exercise.metres, lastBar)),
        layout.headerWidth,
        layout.usableWidth,
        !final,
      ),
      firstBar,
      lastBar,
      theme: LIGHT_THEME,
      colourFor: () => LIGHT_THEME.note,
      final,
      // Every system, matching the review this borrows its layout from — and
      // `planReview` reserves the room for one on each line regardless, so
      // anything less leaves a gap where the clef should be.
      clef: true,
    });
  });

  const height = layout.systems * layout.systemHeight;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${LIGHT_THEME.background}"/>` +
    ctx.out.join('') +
    `</svg>\n`
  );
}
