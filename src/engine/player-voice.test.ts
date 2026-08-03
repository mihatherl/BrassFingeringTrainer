import { describe, expect, it } from 'vitest';
import { maskOf, soundedPitch } from '../domain/fingering';
import { instrumentById, soundingFromWritten } from '../domain/instruments';
import { midiFromName } from '../domain/pitch';

/**
 * The scale that ran backwards.
 *
 * Reported symptom: playing a C major scale, every note sounded as the one
 * before it. Going up this is nearly impossible to hear — each note is simply a
 * step flat — but on the way back down from top C the pitch went *up* as the
 * player went down, which gives the game away.
 *
 * The cause was reading the valves at a fixed moment near each note's onset. A
 * player reads a note and then moves, so at any such moment the valves still
 * hold the previous note's fingering. No choice of moment fixes it; the reading
 * had to go, in favour of following the fingers.
 *
 * These tests pin the arithmetic underneath: resolving the *held* fingering
 * against the *current* note gives the right note, and against the wrong one
 * reproduces the fault exactly.
 */

const cornet = instrumentById('cornet');
const target = (note: string) => soundingFromWritten(midiFromName(note), cornet, 'treble');

/** A C major scale on a cornet, with the fingering for each written note. */
const SCALE: Array<[string, number[]]> = [
  ['C4', []],
  ['D4', [1, 3]],
  ['E4', [1, 2]],
  ['F4', [1]],
  ['G4', []],
  ['A4', [1, 2]],
  ['B4', [2]],
  ['C5', []],
];

describe('reading the fingering one note behind', () => {
  it('reproduces the reported fault', () => {
    // Each note sounded with the fingering left over from the note before it.
    for (let i = 1; i < SCALE.length; i++) {
      const [note] = SCALE[i];
      const [previousNote, previousValves] = SCALE[i - 1];
      const heard = soundedPitch(maskOf(previousValves), target(note), cornet);
      expect(heard, `${note} should have sounded as ${previousNote}`).toBe(target(previousNote));
    }
  });

  it('makes the pitch rise at the moment the player turns round', () => {
    // Up the scale, a one-note lag is nearly inaudible: every note is simply a
    // step flat. It gives itself away at the top, where the player turns down
    // from C5 to B4 and hears the pitch go *up* instead.
    const played = [...SCALE, ...[...SCALE].reverse().slice(1)];
    const heard = played.map(([note], i) =>
      soundedPitch(maskOf(i === 0 ? [] : played[i - 1][1]), target(note), cornet),
    );

    const turn = SCALE.length - 1; // the top C
    expect(played[turn][0]).toBe('C5');
    expect(played[turn + 1][0]).toBe('B4');

    // Played goes down, heard goes up.
    expect(target(played[turn + 1][0])).toBeLessThan(target(played[turn][0]));
    expect(heard[turn + 1]).toBeGreaterThan(heard[turn]);
  });

  it('sounds each note as the one the player played before it', () => {
    const played = [...SCALE, ...[...SCALE].reverse().slice(1)];
    for (let i = 1; i < played.length; i++) {
      const [note] = played[i];
      const [previousNote, previousValves] = played[i - 1];
      expect(
        soundedPitch(maskOf(previousValves), target(note), cornet),
        `${note} should have sounded as ${previousNote}`,
      ).toBe(target(previousNote));
    }
  });
});

describe('following the fingers instead', () => {
  it('sounds exactly what is held, at every step of the scale', () => {
    for (const [note, valves] of SCALE) {
      expect(soundedPitch(maskOf(valves), target(note), cornet), note).toBe(target(note));
    }
  });

  it('rises going up and falls coming down', () => {
    const heard = SCALE.map(([note, valves]) => soundedPitch(maskOf(valves), target(note), cornet));

    for (let i = 1; i < heard.length; i++) {
      expect(heard[i], `${SCALE[i][0]} did not rise`).toBeGreaterThan(heard[i - 1]);
    }
    const descending = [...heard].reverse();
    for (let i = 1; i < descending.length; i++) {
      expect(descending[i]).toBeLessThan(descending[i - 1]);
    }
  });

  it('still sounds wrong when the fingering is genuinely wrong', () => {
    // The point is not to flatter the player: an incorrect fingering held at the
    // right moment must still come out as the wrong note.
    expect(soundedPitch(maskOf([1]), target('C4'), cornet)).not.toBe(target('C4'));
    expect(soundedPitch(maskOf([]), target('D4'), cornet)).not.toBe(target('D4'));
  });
});
