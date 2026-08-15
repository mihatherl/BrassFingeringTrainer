/**
 * A sheet of composed tunes, for looking at by the dozen.
 *
 * The composer is judged by ear and eye, and neither can be applied to a
 * function. This writes an HTML page of tunes composed at one level in one
 * metre — as many as asked for, each from its own seed, so a run of them shows
 * what the level sounds like and where a cell reads badly. Self-contained:
 * inline styles, inline SVG.
 *
 *   npm run tunes -- --difficulty medium --metre 4/4 --count 12 --out tunes.html
 *
 * The seeds are printed under each tune, so one worth discussing can be named.
 */

import { writeFileSync } from 'node:fs';
import { instrumentById } from '../src/domain/instruments.ts';
import { metreFor } from '../src/domain/metre.ts';
import { composeTune } from '../src/exercise/compose.ts';
import { DIFFICULTIES, difficultyById } from '../src/exercise/difficulty.ts';
import { createRng } from '../src/exercise/rng.ts';
import { exerciseFromTheme } from '../src/exercise/theme.ts';
import { exerciseToSvg } from './render-svg.mts';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const instrument = instrumentById(arg('instrument', 'eb-bass'));
const clef = arg('clef', 'treble') as 'treble' | 'bass';
const fifths = Number(arg('fifths', '-3'));
const [beats, unit] = arg('metre', '4/4').split('/').map(Number);
const metre = metreFor(beats, unit);
const count = Number(arg('count', '12'));
const width = Number(arg('width', '900'));
const levels = arg('difficulty', '') ? [difficultyById(arg('difficulty', ''))] : DIFFICULTIES;
const firstSeed = Number(arg('seed', '1'));

const sections = levels.map((difficulty) => {
  const tunes: string[] = [];
  for (let seed = firstSeed; seed < firstSeed + count; seed++) {
    const tune = composeTune({ difficulty, metre, rng: createRng(seed), id: `seed ${seed}` });
    if (!tune) {
      tunes.push(`<p class="none">seed ${seed}: nothing composed</p>`);
      continue;
    }
    const exercise = exerciseFromTheme(tune, { instrument, clef, fifths, metre });
    if (!exercise) {
      tunes.push(`<p class="none">seed ${seed}: would not fit the instrument</p>`);
      continue;
    }
    tunes.push(
      `<figure>${exerciseToSvg(exercise, width)}<figcaption>${difficulty.name} · seed ${seed}</figcaption></figure>`,
    );
  }
  return `<section><h2>${difficulty.name}</h2>${tunes.join('\n')}</section>`;
});

const html = `<!doctype html>
<meta charset="utf-8">
<title>Composed tunes — ${beats}/${unit}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 2rem auto; max-width: ${width + 40}px; padding: 0 1rem; color: #222; background: #fff; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.15rem; margin-top: 2.5rem; border-bottom: 1px solid #ddd; }
  figure { margin: 1.5rem 0; } figcaption { color: #666; font-size: 0.85rem; }
  svg { max-width: 100%; height: auto; display: block; }
  .none { color: #a33; }
</style>
<h1>Composed tunes — ${beats}/${unit}, ${instrument.name}, ${fifths} fifths</h1>
${sections.join('\n')}
`;

const out = arg('out', 'tunes.html');
writeFileSync(out, html);
process.stderr.write(`${out}\n`);
