/**
 * Draws the whole corpus on one page, for deciding what to keep.
 *
 * Reviewing themes one command at a time is how a corpus ends up inconsistent:
 * the question is rarely "is this theme sound" but "is this one worth having
 * next to those". The page itself is built by `theme-page.mts`, shared with the
 * copy published under `public/spike/` so the two cannot drift.
 *
 *   npm run themes                          every theme, in the player's key
 *   npm run themes -- --difficulty medium
 *   npm run themes -- --fifths 2            the same corpus in D
 *   npm run themes -- --instrument cornet
 *   npm run themes -- --publish             refresh the published spike page
 *
 * Writes an HTML file and prints its path. Open it in a browser.
 */

import { writeFileSync } from 'node:fs';
import { PUBLISHED, PUBLISHED_PATH, themePageHtml } from './theme-page.mts';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const publishing = process.argv.includes('--publish');

const out = publishing ? PUBLISHED_PATH : arg('out', 'themes.html');
const html = publishing
  ? themePageHtml(PUBLISHED)
  : themePageHtml({
      instrumentId: arg('instrument', 'eb-bass'),
      clef: arg('clef', 'treble') as 'treble' | 'bass',
      fifths: Number(arg('fifths', '-3')),
      width: Number(arg('width', '1000')),
      difficulty: arg('difficulty', '') || undefined,
    });

writeFileSync(out, html);
process.stderr.write(`${out}\n`);
