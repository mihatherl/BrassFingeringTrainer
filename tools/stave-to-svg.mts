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
 *   npm run svg -- --difficulty hard --seed 3 --out out.svg
 *   npm run svg -- --theme list
 *   npm run svg -- --theme lift-a-fifth --fifths -1 --out theme.svg
 */

import { writeFileSync } from 'node:fs';
import { instrumentById } from '../src/domain/instruments.ts';
import { metreFor } from '../src/domain/metre.ts';
import { difficultyById } from '../src/exercise/difficulty.ts';
import { generateExercise } from '../src/exercise/generate.ts';
import { exerciseFromTheme } from '../src/exercise/theme.ts';
import { themeById, THEMES } from '../src/exercise/themes.ts';
import { tiedFigure } from './figures.mts';
import { DEFAULT_WIDTH, exerciseToSvg } from './render-svg.mts';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const width = Number(arg('width', String(DEFAULT_WIDTH)));

/**
 * An authored theme, drawn in whatever key is asked for.
 *
 * `--theme list` names them; a theme is played in its own first metre, since a
 * tune in three is not a tune in four.
 */
function themeExercise(id: string) {
  if (id === 'list') {
    for (const theme of THEMES) {
      process.stderr.write(`${theme.id.padEnd(22)} ${theme.difficulty.padEnd(9)} ${theme.name}\n`);
    }
    process.exit(0);
  }
  const theme = themeById(id);
  if (!theme) throw new Error(`No theme "${id}". Try --theme list.`);

  const exercise = exerciseFromTheme(theme, {
    instrument: instrumentById(arg('instrument', 'eb-bass')),
    clef: 'treble',
    fifths: Number(arg('fifths', '-3')),
    metre: metreFor(...theme.metres[0]),
  });
  if (!exercise) throw new Error(`"${id}" does not fit that instrument's compass.`);
  return exercise;
}

const exercise = arg('theme', '')
  ? themeExercise(arg('theme', ''))
  : arg('demo', '') === 'on' ? tiedFigure() : generateExercise({
  instrument: instrumentById(arg('instrument', 'eb-bass')),
  clef: 'treble',
  fifths: Number(arg('fifths', '-3')),
  // Comma-separated, e.g. --keys=-3,-1,2, for looking at key changes.
  keySet: arg('keys', '')
    ? arg('keys', '').split(',').map(Number)
    : undefined,
  difficulty: difficultyById(arg('difficulty', 'hard')),
  kind: arg('kind', 'random') as 'random' | 'scales' | 'arpeggios' | 'phrases' | 'themes',
  bars: Number(arg('bars', '8')),
  cycles: Number(arg('cycles', '2')),
  themeCount: Number(arg('themes', '2')),
  metre: metreFor(Number(arg('beats', '4')), Number(arg('unit', '4'))),
  seed: Number(arg('seed', '1')),
    });

const ties = exercise.notes.filter((n) => n.tiedToNext).length;
process.stderr.write(`${ties} tie(s) in this exercise\n`);

const svg = exerciseToSvg(exercise, width);
const out = arg('out', '');
if (out) {
  writeFileSync(out, svg);
  process.stderr.write(`${out}\n`);
} else {
  /*
   * Redirecting this needs `npm run --silent`, or npm's own banner lands in the
   * file ahead of the document and what comes out is not an SVG. `--out` writes
   * the file directly and sidesteps it, which is why it exists.
   */
  process.stdout.write(svg);
}
