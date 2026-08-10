import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shapeFor, CONDUCTOR_STYLE_RANGE } from './conductor';

/**
 * The bench and the app must agree about where the axis starts and ends.
 *
 * `/spike/gesture.html` is where the gesture is chosen: two ends dialled by eye
 * against every pattern at once, and a configuration copied out of it into
 * `conductor.ts`. That makes its defaults a copy, and a copy left alone goes
 * stale — this one did. The page opened on the values it was first written
 * with, so it showed a width that never changed from one end of the axis to the
 * other while the shipped gesture narrows from 110% to 58%. The first thing the
 * bench said was a contradiction of the app it exists to tune, and every
 * judgement made on it would have been against the wrong gesture.
 *
 * Read out of the source text rather than imported: the module builds its own
 * controls on load and wants a document. Crude, and it fails the moment the two
 * part company, which is the whole job.
 */
const BENCH = 'public/spike/gesture.js';

function benchEnds(): Record<string, Record<string, number>> {
  const source = readFileSync(BENCH, 'utf8');
  const literal = /const ENDS = \{([\s\S]*?)\n\};/.exec(source);
  expect(literal, `no ENDS literal in ${BENCH}`).toBeTruthy();

  const ends: Record<string, Record<string, number>> = {};
  for (const line of literal![1].split('\n')) {
    const named = /(\w+):\s*\{(.*)\}/.exec(line);
    if (!named) continue;
    ends[named[1]] = Object.fromEntries(
      named[2]
        .split(',')
        .map((pair) => pair.split(':').map((part) => part.trim()))
        .filter(([key]) => key)
        .map(([key, value]) => [key, Number(value)]),
    );
  }
  return ends;
}

describe('the gesture bench', () => {
  it('opens on the gesture the app actually ships', () => {
    const ends = benchEnds();
    // The bench works in whole percent and the app in fractions, which is the
    // only difference the two are allowed to have.
    for (const [end, style] of [
      ['flowing', CONDUCTOR_STYLE_RANGE.min],
      ['marcato', CONDUCTOR_STYLE_RANGE.max],
    ] as const) {
      const shipped = shapeFor(style);
      expect(ends[end], `${end} is missing from ${BENCH}`).toBeTruthy();
      for (const key of ['width', 'arcs', 'downbeat', 'beats', 'lag'] as const) {
        expect(
          ends[end][key],
          `${BENCH} has ${end} ${key} at ${ends[end][key]}%, the app ships ${shipped[key] * 100}%`,
        ).toBeCloseTo(shipped[key] * 100, 6);
      }
    }
  });
});
