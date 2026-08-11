import { describe, expect, it } from 'vitest';
import {
  barAt,
  barCount,
  beatOfBar,
  changesMetre,
  metreAt,
  metreFor,
  pulseAt,
  type MetreChange,
} from './metre';

/** A piece that holds one metre throughout: a change list of one. */
const only = (beats: number, unit: number): MetreChange[] => [
  { fromBeat: 0, metre: metreFor(beats, unit) },
];

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
    const sixEight = only(6, 8);
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
      const metres = only(beats, unit);
      for (let bar = 0; bar < 8; bar++) {
        expect(barAt(metres, beatOfBar(metres, bar)), `${beats}/${unit} bar ${bar}`).toBe(bar);
      }
    }
  });

  it('counts the count-in, which sits at negative beats', () => {
    // Before the first change the first metre applies, downwards as well as
    // up: bar -1 is the bar of count-in before the music starts.
    const fourFour = only(4, 4);
    expect(barAt(fourFour, -1)).toBe(-1);
    expect(barAt(fourFour, -4)).toBe(-1);
    expect(barAt(fourFour, -5)).toBe(-2);
    expect(beatOfBar(fourFour, -1)).toBe(-4);
  });

  it('numbers the bars of an unfinished last one', () => {
    // A partial bar is still a bar: it has to be drawn and fitted on a line.
    expect(barCount(only(4, 4), 12)).toBe(3);
    expect(barCount(only(4, 4), 13)).toBe(4);
    expect(barCount(only(6, 8), 3)).toBe(1);
    // Never fewer than one, so an empty exercise has a bar to put its clef in.
    expect(barCount(only(4, 4), 0)).toBe(1);
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

/**
 * A part changes time signature, and `beat / barBeats` is right up to the
 * change and wrong for every bar after it. These are the cases where the
 * single-metre arithmetic the app used to do gives a different answer — which
 * is the only reason the list exists.
 */
describe('a metre that changes', () => {
  // Two bars of 2/4, then 6/8 from beat 4. Bar lines at 0, 2, 4, 7, 10, 13.
  const changing: MetreChange[] = [
    { fromBeat: 0, metre: metreFor(2, 4) },
    { fromBeat: 4, metre: metreFor(6, 8) },
  ];

  it('says which metre is in force, and whether it ever moves', () => {
    expect(metreAt(changing, 0).beatsPerBar).toBe(2);
    expect(metreAt(changing, 3.99).beatsPerBar).toBe(2);
    expect(metreAt(changing, 4).beatsPerBar).toBe(6);
    expect(changesMetre(changing)).toBe(true);
    expect(changesMetre(only(4, 4))).toBe(false);
  });

  it('carries the bar count across the change', () => {
    // Bar 2 is the first of the 6/8, and bar 3 is three crotchets later — not
    // two, which is what the opening metre would have said.
    expect(barAt(changing, 0)).toBe(0);
    expect(barAt(changing, 2)).toBe(1);
    expect(barAt(changing, 4)).toBe(2);
    expect(barAt(changing, 6.99)).toBe(2);
    expect(barAt(changing, 7)).toBe(3);
    expect(barAt(changing, 10)).toBe(4);
  });

  it('is still the exact inverse of itself at every bar line', () => {
    expect([0, 1, 2, 3, 4, 5].map((bar) => beatOfBar(changing, bar))).toEqual([
      0, 2, 4, 7, 10, 13,
    ]);
    for (let bar = -2; bar < 8; bar++) {
      expect(barAt(changing, beatOfBar(changing, bar)), `bar ${bar}`).toBe(bar);
    }
  });

  it('counts the count-in in the metre the piece opens in', () => {
    // The count-in is bars of the opening 2/4, whatever the piece turns into.
    expect(beatOfBar(changing, -1)).toBe(-2);
    expect(barAt(changing, -2)).toBe(-1);
  });

  it('counts bars through the change rather than dividing the length', () => {
    // Ten crotchets is four bars here — two of 2/4 and two of 6/8. Dividing by
    // either bar length gives five or three, and both are wrong.
    expect(barCount(changing, 10)).toBe(4);
    expect(barCount(changing, 11)).toBe(5);
  });

  it('answers rather than throwing when the list is empty', () => {
    // A renderer midway through a frame is no place to discover a malformed
    // exercise, so an empty list reads as common time.
    expect(metreAt([], 9).beatsPerBar).toBe(4);
    expect(barAt([], 9)).toBe(2);
    expect(beatOfBar([], 2)).toBe(8);
    expect(barCount([], 9)).toBe(3);
  });
});
