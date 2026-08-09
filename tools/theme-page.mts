/**
 * The corpus as a self-contained page.
 *
 * A pure function rather than a script, because two things want it: the
 * command-line sheet used while writing themes, and the copy published under
 * `public/spike/`, which a test holds to what this produces so the published
 * one cannot quietly go stale — the exact fault `tools/` had for four releases.
 *
 * Self-contained on purpose: inline styles, inline SVG, no requests. It ships
 * inside an app that makes none, and a review page that needs the network to
 * draw is no use on a bandstand.
 */

import { describeFifths } from '../src/domain/keys.ts';
import { metreFor } from '../src/domain/metre.ts';
import { instrumentById, type Clef } from '../src/domain/instruments.ts';
import { DIFFICULTIES } from '../src/exercise/difficulty.ts';
import { exerciseFromTheme, validateTheme } from '../src/exercise/theme.ts';
import { THEMES } from '../src/exercise/themes.ts';
import { exerciseToSvg } from './render-svg.mts';

export interface ThemePageOptions {
  instrumentId: string;
  clef: Clef;
  fifths: number;
  width: number;
  /** One difficulty only, or every one. */
  difficulty?: string;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function themePageHtml(options: ThemePageOptions): string {
  const instrument = instrumentById(options.instrumentId);
  const { clef, fifths, width } = options;
  const sections: string[] = [];

  for (const difficulty of DIFFICULTIES) {
    if (options.difficulty && difficulty.id !== options.difficulty) continue;
    const themes = THEMES.filter((theme) => theme.difficulty === difficulty.id);
    const heading =
      `<h2>${escape(difficulty.name)} <span class="count">${themes.length} ` +
      `theme${themes.length === 1 ? '' : 's'}</span></h2>`;

    if (themes.length === 0) {
      // Named rather than skipped: an empty difficulty is the thing this page is
      // most useful for saying, since the app falls back to a random walk there
      // and nothing on screen admits it.
      sections.push(
        `${heading}<p class="empty">Nothing written yet — falls back to a random walk.</p>`,
      );
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

      const changes = theme.keyChanges?.length
        ? ` · changes key at bar ${theme.keyChanges.map((k) => k.atBar).join(', ')}`
        : '';

      const label =
        `<h3>${escape(theme.name)} <code>${escape(theme.id)}</code></h3>` +
        `<p class="meta">${theme.bars} bars · ${beatsPerBar}/${beatUnit}${changes}</p>`;

      const body = exercise
        ? exerciseToSvg(exercise, width)
        : `<p class="problem">Does not fit ${escape(instrument.name)} in this key.</p>`;

      const said = problems.length
        ? `<ul class="problem">${problems.map((p) => `<li>${escape(p)}</li>`).join('')}</ul>`
        : '';

      return `<section>${label}${body}${said}</section>`;
    });

    sections.push(heading + drawn.join(''));
  }

  const shown = options.difficulty
    ? `${escape(options.difficulty)} only`
    : `${THEMES.length} in the corpus`;

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Themes — Brass Fingering Trainer</title>
    <style>
      :root { color-scheme: light dark; --bg: #fbfaf7; --text: #16150f; --muted: #6b6960;
              --border: #ddd9d0; --bad: #c02b2b; --paper: #ffffff; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #16171b; --text: #f2f1ec; --muted: #9a9ba3; --border: #333640;
                --bad: #f87171; --paper: #f4f2ec; }
      }
      * { box-sizing: border-box; }
      body { margin: 0 auto; padding: 1.5rem 1rem 4rem; max-width: ${width + 64}px;
             background: var(--bg); color: var(--text);
             font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
      h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
      h2 { margin: 2.5rem 0 .25rem; padding-bottom: .25rem; font-size: 1.2rem;
           border-bottom: 2px solid var(--border); }
      h3 { margin: 0 0 .1rem; font-size: 1rem; }
      h3 code { margin-left: .5rem; font-weight: 400; font-size: .85em; color: var(--muted); }
      p { margin: 0; }
      .lede, .meta, .count, .empty { color: var(--muted); font-size: .9rem; }
      .count { font-weight: 400; }
      .empty { font-style: italic; }
      .problem { color: var(--bad); }
      section { margin: 1rem 0 2.5rem; }
      /* The engraving is drawn on paper, whatever the page is on. */
      svg { max-width: 100%; height: auto; background: var(--paper); border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Themes</h1>
    <p class="lede">${escape(instrument.name)} · ${escape(clef)} clef ·
      ${escape(describeFifths(fifths))} · ${shown}</p>
    <p class="lede">Authored sight-reading material, written in scale degrees so the same
      theme plays in any key on any instrument. This page is for looking at; to hear one,
      open the app with <code>?theme=</code> and its id.</p>
    ${sections.join('\n    ')}
  </body>
</html>
`;
}

/** What the published copy under `public/spike/` is generated with. */
export const PUBLISHED: ThemePageOptions = {
  instrumentId: 'eb-bass',
  clef: 'treble',
  fifths: -3,
  width: 1000,
};

export const PUBLISHED_PATH = 'public/spike/themes.html';
