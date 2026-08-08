/**
 * Renders a generated exercise to an SVG file, so notation can be *looked at*
 * without a browser.
 *
 * The drawing code targets a canvas, but everything it asks of one is a shape:
 * rectangles, straight lines, quadratic curves, and glyph outlines that were
 * already SVG path data before they were Path2D. So a shim implementing the
 * dozen methods `drawSystem` actually calls can emit SVG directly, and what
 * comes out is the same geometry the app draws rather than a redrawing of it.
 *
 * For checking engraving by eye during development. Not part of the app, not
 * part of the build.
 *
 *   npx tsx tools/stave-to-svg.mts --difficulty hard --seed 3 > out.svg
 */

import { instrumentById } from '../src/domain/instruments.ts';
import { durationFromBeats } from '../src/domain/rhythm.ts';
import { metreFor } from '../src/domain/metre.ts';
import { difficultyById } from '../src/exercise/difficulty.ts';
import { generateExercise } from '../src/exercise/generate.ts';
import type { Exercise, NoteEvent } from '../src/exercise/types.ts';
import { planReview } from '../src/render/review.ts';
import { staveMetrics } from '../src/render/stave.ts';
import { LIGHT_THEME } from '../src/render/surface.ts';
import { drawSystem, justifiedX } from '../src/render/system.ts';
import { SvgContext, SvgPath2D } from './svg-context.mts';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

(globalThis as { Path2D?: unknown }).Path2D = SvgPath2D;

const width = Number(arg('width', '900'));

/**
 * A fixed figure rather than generated material: a crotchet tied over the bar
 * line into a quaver, once low on the stave and once high, so the tie is seen
 * curving on both sides of the notes.
 */
function demoExercise(): Exercise {
  const at = (startBeat: number, beats: number, midi: number, tiedToNext = false): NoteEvent => ({
    writtenMidi: midi,
    soundingMidi: midi - 21,
    startBeat,
    duration: durationFromBeats(beats)!,
    acceptedMasks: [0],
    primaryMask: 0,
    beamGroup: -1,
    tiedToNext,
    showAccidental: false,
  });

  return {
    notes: [
      at(0, 2, 64),
      at(2, 1, 67),
      at(3, 1, 60, true), // low: stem up, so the tie hangs below
      at(4, 0.5, 60),
      at(4.5, 1.5, 65),
      at(6, 1, 69),
      at(7, 1, 76, true), // high: stem down, so the tie arches above
      at(8, 0.5, 76),
      at(8.5, 1.5, 72),
      at(10, 2, 67),
    ],
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metre: metreFor(4, 4),
    totalBeats: 12,
    seed: 0,
    kind: 'random',
  };
}

const exercise = arg('demo', '') === 'on' ? demoExercise() : generateExercise({
  instrument: instrumentById(arg('instrument', 'eb-bass')),
  clef: 'treble',
  fifths: Number(arg('fifths', '-3')),
  // Comma-separated, e.g. --keys=-3,-1,2, for looking at key changes.
  keySet: arg('keys', '')
    ? arg('keys', '').split(',').map(Number)
    : undefined,
  difficulty: difficultyById(arg('difficulty', 'hard')),
  kind: arg('kind', 'random') as 'random' | 'scales' | 'arpeggios' | 'phrases',
  bars: Number(arg('bars', '8')),
  cycles: Number(arg('cycles', '2')),
  metre: metreFor(Number(arg('beats', '4')), Number(arg('unit', '4'))),
  seed: Number(arg('seed', '1')),
    });

const ties = exercise.notes.filter((n) => n.tiedToNext).length;
process.stderr.write(`${ties} tie(s) in this exercise\n`);

const layout = planReview(width, exercise);
const ctx = new SvgContext();
const totalBars = Math.ceil(exercise.totalBeats / exercise.metre.barBeats);

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
      firstBar * exercise.metre.barBeats,
      Math.min(exercise.totalBeats, lastBar * exercise.metre.barBeats),
      layout.headerWidth,
      layout.usableWidth,
      !final,
    ),
    firstBar,
    lastBar,
    theme: LIGHT_THEME,
    colourFor: () => LIGHT_THEME.note,
    final,
  });
});

const height = layout.systems * layout.systemHeight;
process.stdout.write(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${LIGHT_THEME.background}"/>` +
    ctx.out.join('') +
    `</svg>\n`,
);
