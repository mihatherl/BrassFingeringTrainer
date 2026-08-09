import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLISHED, PUBLISHED_PATH, themePageHtml } from '../../tools/theme-page.mts';

describe('the published theme page', () => {
  /*
   * The corpus is published as a static page so it can be looked at from a
   * phone without running anything, and a static page is exactly the kind of
   * thing that goes stale the first time a theme changes. `tools/` did precisely
   * this for four releases while every test passed.
   *
   * So: it is generated, committed, and checked. If this fails, the corpus has
   * moved and the page has not — regenerate it rather than editing it, since it
   * is output and not source.
   */
  it('is current with the corpus', () => {
    const published = readFileSync(PUBLISHED_PATH, 'utf8');
    expect(
      published === themePageHtml(PUBLISHED),
      `${PUBLISHED_PATH} is out of date — run \`npm run themes -- --publish\``,
    ).toBe(true);
  });

  it('makes no request of any kind to draw or to sound itself', () => {
    /*
     * It ships inside an app that makes none, and a review page that cannot
     * draw or play without the network is no use where music is played. The
     * script is inline and the tones are synthesised, so what is forbidden is
     * anything *fetched*: a remote URL, a stylesheet, a font, a src.
     */
    const published = readFileSync(PUBLISHED_PATH, 'utf8');
    expect(published, 'a remote URL').not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(published, 'an external stylesheet or font').not.toMatch(/<link|@import|@font-face/);
    expect(published, 'a fetched resource').not.toMatch(/\bsrc=|fetch\(|XMLHttpRequest/);
  });
});
