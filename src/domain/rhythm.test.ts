import { describe, expect, it } from 'vitest';
import {
  durationBeats,
  durationFromBeats,
  isBeamable,
  snapBeat,
  NOTE_VALUES,
  NOTE_VALUE_FLAGS,
} from './rhythm';

describe('triplets', () => {
  it('is three in the time of two', () => {
    // A triplet quaver lasts two thirds of a quaver, so three of them fill one
    // crotchet where two would.
    expect(durationBeats({ value: 'eighth', dotted: false, tuplet: 3 })).toBeCloseTo(1 / 3, 12);
    expect(durationBeats({ value: 'quarter', dotted: false, tuplet: 3 })).toBeCloseTo(2 / 3, 12);
    expect(durationBeats({ value: 'sixteenth', dotted: false, tuplet: 3 })).toBeCloseTo(1 / 6, 12);
  });

  it('reads a third of a beat back as a triplet quaver', () => {
    expect(durationFromBeats(1 / 3)).toEqual({ value: 'eighth', dotted: false, tuplet: 3 });
    expect(durationFromBeats(2 / 3)).toEqual({ value: 'quarter', dotted: false, tuplet: 3 });
  });

  it('prefers the ordinary spelling where a length has one', () => {
    // Nothing writable plainly should come back as a triplet, or a corpus full
    // of crotchets would sprout brackets.
    for (const beats of [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]) {
      expect(durationFromBeats(beats)?.tuplet, `${beats} beats`).toBeUndefined();
    }
  });

  it('is still drawn as the note value it is', () => {
    // A triplet quaver beams like a quaver. What marks it is the bracket.
    expect(isBeamable({ value: 'eighth', dotted: false, tuplet: 3 })).toBe(true);
    expect(isBeamable({ value: 'quarter', dotted: false, tuplet: 3 })).toBe(false);
  });

  it('still refuses a length no notation has', () => {
    expect(durationFromBeats(5 / 3)).toBeNull();
    expect(durationFromBeats(0.3)).toBeNull();
  });
});

describe('snapBeat', () => {
  /*
   * The fault this exists for: thirds are not exact in binary, so a bar of
   * triplets lands a hair short and every comparison at a bar line is wrong.
   * A note at 11.999999999999998 is drawn in the bar before its own.
   */
  it('makes a bar of triplets come to exactly one bar', () => {
    let beat = 0;
    for (let i = 0; i < 12; i++) beat = snapBeat(beat + 1 / 3);
    expect(beat).toBe(4);
  });

  it('leaves every writable length exactly where it is', () => {
    for (const beats of [0.25, 1 / 3, 0.375, 0.5, 1 / 6, 2 / 3, 0.75, 1, 1.5, 2, 4]) {
      expect(snapBeat(beats), `${beats}`).toBeCloseTo(beats, 12);
    }
  });

  it('accumulates sixteen bars of triplets without drifting', () => {
    let beat = 0;
    for (let i = 0; i < 48; i++) beat = snapBeat(beat + 1 / 3);
    expect(beat).toBe(16);
  });
});

/**
 * The demisemiquaver, which exists for imported music and for nothing else.
 *
 * A real part turned up with one, and the shortest value the app could write
 * was a semiquaver — so the note was dropped and the player never played it.
 * Nothing *generates* one: the difficulty tables name the values they draw
 * from, and none of them names this.
 */
describe('the shortest value', () => {
  it('is an eighth of a beat, and writable', () => {
    expect(durationFromBeats(0.125)).toEqual({ value: 'thirtySecond', dotted: false });
    expect(durationBeats({ value: 'thirtySecond', dotted: false })).toBe(0.125);
  });

  it('carries three beams', () => {
    expect(NOTE_VALUE_FLAGS.thirtySecond).toBe(3);
  });

  it('is reached last, so nothing that already resolved resolves differently', () => {
    // It sits at the end of `NOTE_VALUES`, which the searches walk in order.
    expect(NOTE_VALUES[NOTE_VALUES.length - 1]).toBe('thirtySecond');
    expect(durationFromBeats(0.25)).toEqual({ value: 'sixteenth', dotted: false });
    expect(durationFromBeats(1)).toEqual({ value: 'quarter', dotted: false });
  });
});
