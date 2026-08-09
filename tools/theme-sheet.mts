/**
 * The whole corpus on one page, engraved, for deciding what to keep.
 *
 * Reviewing themes one command at a time is how a corpus ends up inconsistent:
 * the question is rarely "is this theme sound" but "is this one worth having
 * next to those". So every theme is drawn on a single page, grouped by
 * difficulty, with whatever the validator says about it printed underneath in
 * the same place a reader is already looking.
 *
 *   npm run themes                       every theme, in the player's key
 *   npm run themes -- --difficulty medium
 *   npm run themes -- --fifths 2         the same corpus in D
 *   npm run themes -- --instrument cornet
 *
 * Writes an HTML file and prints its path. Open it in a browser.
 */

import { writeFileSync } from 'node:fs';
import { instrumentById } from '../src/domain/instruments.ts';
import { describeFifths } from '../src/domain/keys.ts';
import { metreFor } from '../src/domain/metre.ts';
import { exerciseFromTheme, validateTheme } from '../src/exercise/theme.ts';
import { THEMES } from '../src/exercise/themes.ts';
import { DIFFICULTIES } from '../src/exercise/difficulty.ts';
import { exerciseToSvg } from './render-svg.mts';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const instrument = instrumentById(arg('instrument', 'eb-bass'));
const clef = arg('clef', 'treble') as 'treble' | 'bass';
const fifths = Number(arg('fifths', '-3'));
const width = Number(arg('width', '1000'));
const out = arg('out', 'themes.html');

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sections: string[] = [];

const only = arg('difficulty', '');

for (const difficulty of DIFFICULTIES) {
  if (only && difficulty.id !== only) continue;
  const themes = THEMES.filter((theme) => theme.difficulty === difficulty.id);
  const heading =
    `<h2>${escape(difficulty.name)} <span class="count">${themes.length} ` +
    `theme${themes.length === 1 ? '' : 's'}</span></h2>`;

  if (themes.length === 0) {
    // Named rather than skipped: an empty difficulty is the thing this page is
    // most useful for saying, since it falls back to generated material in the
    // app and nothing on screen there admits it.
    sections.push(`${heading}<p class="empty">Nothing written yet — falls back to a random walk.</p>`);
    continue;
  }

  const drawn = themes.map((theme) => {
    const problems = validateTheme(theme);
    const [beatsPerBar, beatUnit] = theme.metres[0];
    const exercise = exerciseFromTheme(theme, {
      instrument,
      clef,
      fifths,
      metre: metreFor(beatsPerBar, beatUnit),
    });

    const label =
      `<h3>${escape(theme.name)} <code>${escape(theme.id)}</code></h3>` +
      `<p class="meta">${theme.bars} bars · ${beatsPerBar}/${beatUnit}` +
      `${theme.keyChanges?.length ? ` · changes key at bar ${theme.keyChanges.map((k) => k.atBar).join(', ')}` : ''}</p>`;

    const body = exercise
      ? exerciseToSvg(exercise, width)
      : `<p class="problem">Does not fit ${escape(instrument.name)} at this key.</p>`;

    const said = problems.length
      ? `<ul class="problem">${problems.map((p) => `<li>${escape(p)}</li>`).join('')}</ul>`
      : '';

    return `<section>${label}${body}${said}</section>`;
  });

  sections.push(heading + drawn.join(''));
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Themes — ${escape(instrument.name)}, ${escape(describeFifths(fifths))}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: ${width + 80}px;
         background: #fbfaf7; color: #24211c; }
  h1 { margin-bottom: 0; }
  h1 + p { margin-top: .25rem; color: #6b6355; }
  h2 { margin-top: 2.5rem; border-bottom: 2px solid #d9d2c4; padding-bottom: .25rem; }
  h3 { margin-bottom: 0; }
  h3 code { margin-left: .5rem; font-weight: 400; font-size: .8em; color: #6b6355; }
  .count { font-weight: 400; font-size: .8em; color: #6b6355; }
  .meta { margin-top: .1rem; color: #6b6355; font-size: .9em; }
  .empty { color: #6b6355; font-style: italic; }
  .problem { color: #9b2c1f; }
  section { margin-bottom: 2rem; }
  svg { max-width: 100%; height: auto; }
</style></head><body>
<h1>Themes</h1>
<p>${escape(instrument.name)} · ${escape(clef)} clef · ${escape(describeFifths(fifths))} ·
${THEMES.length} in the corpus</p>
${sections.join('')}
</body></html>
`;

writeFileSync(out, page);
process.stderr.write(`${out}\n`);
