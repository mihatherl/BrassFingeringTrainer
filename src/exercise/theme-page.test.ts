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

  it('needs nothing off the network to draw itself', () => {
    // It ships inside an app that makes no requests at all, and a review page
    // that cannot draw without one is no use on a bandstand.
    const published = readFileSync(PUBLISHED_PATH, 'utf8');
    expect(published).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)|<link|@import/);
  });
});
