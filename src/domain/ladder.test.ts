import { describe, expect, it } from 'vitest';
import { keyLadder, stepOnLadder } from './ladder';
import { midiFromName } from './pitch';

/**
 * The rungs a range dial moves between.
 *
 * Two properties carry the feature: the ladder is the key's own notes, and the
 * ends of the instrument are always reachable — an Eb bass bottoms out on a
 * note that belongs to no flat key, and that note is the one its player asks
 * for most.
 */

const EB_MAJOR = -3;
const C_MAJOR = 0;

/** How the picker builds it: the written compass of an Eb bass in treble clef. */
const BOTTOM = midiFromName('C#3');
const TOP = midiFromName('C6');

describe('the ladder', () => {
  it('holds the notes of the key, and nothing else between the ends', () => {
    const ladder = keyLadder(EB_MAJOR, midiFromName('C4'), midiFromName('C5'));
    const names = ['C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4', 'C5'].map(midiFromName);
    expect(ladder).toEqual(names);
  });

  it('reaches the bottom of the horn even where the key does not go there', () => {
    const ladder = keyLadder(EB_MAJOR, BOTTOM, TOP);

    expect(ladder[0]).toBe(BOTTOM);
    expect(ladder[ladder.length - 1]).toBe(TOP);
    // C#3 is in no flat key; it is on the ladder because it is the instrument.
    expect(ladder.filter((midi) => midi === BOTTOM)).toHaveLength(1);
  });

  it('counts an end that does belong to the key just once', () => {
    const ladder = keyLadder(C_MAJOR, midiFromName('C4'), midiFromName('G4'));
    expect(ladder).toEqual(['C4', 'D4', 'E4', 'F4', 'G4'].map(midiFromName));
  });

  it('is empty when there is no compass to fill', () => {
    expect(keyLadder(C_MAJOR, 60, 59)).toEqual([]);
  });
});

describe('stepping the ladder', () => {
  const ladder = keyLadder(EB_MAJOR, BOTTOM, TOP);
  const step = (name: string, delta: number) =>
    stepOnLadder(ladder, midiFromName(name), delta);

  it('moves one rung at a time, in the key', () => {
    expect(step('G4', 1)).toBe(midiFromName('Ab4'));
    expect(step('G4', -1)).toBe(midiFromName('F4'));
    expect(step('G4', 7)).toBe(midiFromName('G5'));
  });

  it('stops at the ends rather than running past them', () => {
    expect(step('C6', 1)).toBe(TOP);
    expect(step('C#3', -1)).toBe(BOTTOM);
    expect(stepOnLadder(ladder, TOP, 40)).toBe(TOP);
    expect(stepOnLadder(ladder, BOTTOM, -40)).toBe(BOTTOM);
  });

  it('moves one place from a note that is not on the ladder at all', () => {
    /*
     * What a key change leaves behind: bounds chosen in one key, read in
     * another. A click has to move one place from where the note actually is,
     * in the direction asked for — not stand still, and not count the jump onto
     * the ladder as the move.
     */
    const cMajor = keyLadder(C_MAJOR, BOTTOM, TOP);
    expect(stepOnLadder(cMajor, midiFromName('Bb4'), 1)).toBe(midiFromName('B4'));
    expect(stepOnLadder(cMajor, midiFromName('Bb4'), -1)).toBe(midiFromName('A4'));
    expect(stepOnLadder(cMajor, midiFromName('Bb4'), 2)).toBe(midiFromName('C5'));
  });

  it('holds still when asked for no movement', () => {
    expect(step('G4', 0)).toBe(midiFromName('G4'));
    expect(stepOnLadder(ladder, midiFromName('Bb4') + 1, 0)).toBe(midiFromName('Bb4') + 1);
  });

  it('copes with no ladder to step', () => {
    expect(stepOnLadder([], 60, 3)).toBe(60);
  });
});
