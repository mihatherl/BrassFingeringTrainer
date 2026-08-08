/**
 * Renders a generated exercise to an SVG file, so notation can be *looked at*
 * without a browser.
 *
 * The drawing itself is in `render-svg.mts`, shared with the engraving
 * snapshots so that what is checked and what is looked at cannot drift apart.
 * This file is the way in from a command line: arguments, and a figure to draw.
 *
 * For checking engraving by eye during development. Not part of the app, not
 * part of the build.
 *
 *   npm run svg -- --difficulty hard --seed 3 > out.svg
 */

import { instrumentById } from '../src/domain/instruments.ts';
import { metreFor } from '../src/domain/metre.ts';
import { difficultyById } from '../src/exercise/difficulty.ts';
import { generateExercise } from '../src/exercise/generate.ts';
import { tiedFigure } from './figures.mts';
import { DEFAULT_WIDTH, exerciseToSvg } from './render-svg.mts';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const width = Number(arg('width', String(DEFAULT_WIDTH)));

const exercise = arg('demo', '') === 'on' ? tiedFigure() : generateExercise({
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

process.stdout.write(exerciseToSvg(exercise, width));
