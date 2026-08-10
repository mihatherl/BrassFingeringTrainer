import { describe, expect, it } from 'vitest';
import { metreFor } from '../domain/metre';
import { atLastBlock, whiteUntilBeat } from './horizon';
import type { Exercise } from './types';

/**
 * The white must never run past the paper, whatever beat it is asked about —
 * that number is what the renderer greys against, and an exercise holds only
 * as many bars as were generated.
 */
function exercise(chosenBeats: number, totalBeats: number): Exercise {
  return {
    notes: [],
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metre: metreFor(4, 4),
    tempo: [],
    totalBeats,
    chosenBeats,
    seed: 1,
    kind: 'random',
  };
}

describe('the white, promoted a block at a time', () => {
  // Eight bars chosen, two hundred generated: the app's own shape.
  const eight = exercise(32, 800);

  it('stands at the chosen length through the count-in and the first block', () => {
    expect(whiteUntilBeat(eight, -4)).toBe(32);
    expect(whiteUntilBeat(eight, 0)).toBe(32);
    expect(whiteUntilBeat(eight, 31.9)).toBe(32);
  });

  it('promotes a whole block the instant the player crosses into the grey', () => {
    // Not one bar: the eight bars ahead go white together, which is what
    // gives a reader something to read into.
    expect(whiteUntilBeat(eight, 32)).toBe(64);
    expect(whiteUntilBeat(eight, 33)).toBe(64);
    expect(whiteUntilBeat(eight, 63.9)).toBe(64);
    expect(whiteUntilBeat(eight, 64)).toBe(96);
  });

  it('never runs past the paper, however far the beat goes', () => {
    expect(whiteUntilBeat(eight, 768)).toBe(800);
    expect(whiteUntilBeat(eight, 799)).toBe(800);
    // Past the end, and absurdly past it: still the paper's own length.
    expect(whiteUntilBeat(eight, 800)).toBe(800);
    expect(whiteUntilBeat(eight, 10_000)).toBe(800);
    expect(whiteUntilBeat(eight, Number.MAX_SAFE_INTEGER)).toBe(800);
  });

  it('clamps a last block that does not divide evenly', () => {
    // Themes and cycles stitch to the cap, so the paper is rarely a whole
    // number of blocks: the final promotion is short rather than over.
    const ragged = exercise(24, 100);
    expect(whiteUntilBeat(ragged, 72)).toBe(96);
    expect(whiteUntilBeat(ragged, 96)).toBe(100);
    expect(whiteUntilBeat(ragged, 99.9)).toBe(100);
  });

  it('greys nothing when there is no horizon', () => {
    const plain = exercise(32, 32);
    expect(whiteUntilBeat(plain, 0)).toBe(32);
    expect(whiteUntilBeat(plain, 31)).toBe(32);
  });

  it('survives a degenerate exercise rather than dividing by zero', () => {
    expect(whiteUntilBeat(exercise(0, 64), 8)).toBe(64);
    expect(whiteUntilBeat(eight, Number.NaN)).toBe(32);
  });

  it('knows when the last block is in play, so the end can be announced', () => {
    expect(atLastBlock(eight, 0)).toBe(false);
    expect(atLastBlock(eight, 700)).toBe(false);
    expect(atLastBlock(eight, 768)).toBe(true);
    expect(atLastBlock(exercise(32, 32), 0)).toBe(true);
  });
});
