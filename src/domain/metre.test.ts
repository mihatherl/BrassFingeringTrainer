import { describe, expect, it } from 'vitest';
import { barAt, beatOfBar, metreFor, pulseAt } from './metre';

/**
 * Compound time is not reachable from the settings screen yet, which is exactly
 * why these exist. The numerator and the length of a bar agree in every metre
 * the app currently offers, so nothing in the suite would notice the two being
 * confused until the day someone adds 6/8 — and by then the confusion would be
 * spread across bar lines, beaming and the metronome.
 */

describe('simple time', () => {
  it('makes a bar as long as its numerator', () => {
    for (const [beats, unit] of [
      [4, 4],
      [3, 4],
      [2, 4],
    ] as const) {
      const metre = metreFor(beats, unit);
      expect(metre.barBeats, `${beats}/${unit}`).toBe(beats);
      expect(metre.pulseBeats).toBe(1);
      expect(metre.pulsesPerBar).toBe(beats);
      expect(metre.isCompound).toBe(false);
    }
  });

  it('counts a bar of cut common in minims', () => {
    // 2/2 is two beats to a bar, each a minim. Four crotchets long, conducted
    // in two — the case that proves the pulse is not simply the crotchet.
    const metre = metreFor(2, 2);
    expect(metre.barBeats).toBe(4);
    expect(metre.pulseBeats).toBe(2);
    expect(metre.pulsesPerBar).toBe(2);
    expect(metre.isCompound).toBe(false);
  });

  it('treats three-eight as three, not as one', () => {
    // A numerator divisible by three, but felt as three quavers rather than as
    // one dotted crotchet. Calling it compound would beam the whole bar in one
    // and click once where a player counts three.
    const metre = metreFor(3, 8);
    expect(metre.isCompound).toBe(false);
    expect(metre.barBeats).toBe(1.5);
    expect(metre.pulseBeats).toBe(0.5);
    expect(metre.pulsesPerBar).toBe(3);
  });
});

describe('compound time', () => {
  it('makes six-eight two dotted crotchets, not six of anything', () => {
    const metre = metreFor(6, 8);
    // Three crotchets to a bar, which is the number the numerator is mistaken
    // for and the source of every bug this module exists to prevent.
    expect(metre.barBeats).toBe(3);
    expect(metre.pulseBeats).toBe(1.5);
    expect(metre.pulsesPerBar).toBe(2);
    expect(metre.isCompound).toBe(true);
  });

  it('handles nine-eight and twelve-eight', () => {
    const nine = metreFor(9, 8);
    expect(nine.barBeats).toBe(4.5);
    expect(nine.pulsesPerBar).toBe(3);

    const twelve = metreFor(12, 8);
    expect(twelve.barBeats).toBe(6);
    expect(twelve.pulsesPerBar).toBe(4);

    for (const metre of [nine, twelve]) {
      expect(metre.pulseBeats).toBe(1.5);
      expect(metre.isCompound).toBe(true);
    }
  });

  it('handles six-sixteen', () => {
    const metre = metreFor(6, 16);
    expect(metre.barBeats).toBe(1.5);
    expect(metre.pulseBeats).toBe(0.75);
    expect(metre.pulsesPerBar).toBe(2);
    expect(metre.isCompound).toBe(true);
  });
});

describe('locating a beat', () => {
  it('finds the bar from the crotchet count, not from the numerator', () => {
    const sixEight = metreFor(6, 8);
    // Bar 2 of 6/8 begins at three crotchets, not at six.
    expect(barAt(sixEight, 0)).toBe(0);
    expect(barAt(sixEight, 2.99)).toBe(0);
    expect(barAt(sixEight, 3)).toBe(1);
    expect(beatOfBar(sixEight, 2)).toBe(6);
  });

  it('is the exact inverse of itself at every bar line', () => {
    for (const [beats, unit] of [
      [4, 4],
      [3, 4],
      [2, 2],
      [6, 8],
      [9, 8],
    ] as const) {
      const metre = metreFor(beats, unit);
      for (let bar = 0; bar < 8; bar++) {
        expect(barAt(metre, beatOfBar(metre, bar)), `${beats}/${unit} bar ${bar}`).toBe(bar);
      }
    }
  });

  it('numbers the pulses within a bar', () => {
    const sixEight = metreFor(6, 8);
    // The second of the two beats in a bar of 6/8 falls at a dotted crotchet.
    expect(pulseAt(sixEight, 1.5)).toBe(1);
    expect(pulseAt(sixEight, 3)).toBe(2);
    // Fractional between pulses, so a conducting pattern can read its own
    // position straight from it.
    expect(pulseAt(sixEight, 0.75)).toBe(0.5);
  });
});
