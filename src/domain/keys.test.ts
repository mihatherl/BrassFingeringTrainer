import { describe, expect, it } from 'vitest';
import {
  changesKey,
  describeFifths,
  keyAt,
  MAJOR_KEYS,
  needsAccidental,
  spellInKey,
} from './keys';
import { midiFromName } from './pitch';

/**
 * How a note is spelled decides what the player reads, and reading it wrongly
 * is worse than not drawing it at all — the fingering is worked out from the
 * pitch, so a misspelled note asks for one thing and shows another.
 */

/** "A♭4" and the like, from a spelling. */
function spell(midi: number, fifths: number): string {
  const p = spellInKey(midi, fifths);
  const sign = p.alter === 0 ? '' : p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return `${p.letter}${sign}${p.octave}`;
}

describe('spelling a note in a key', () => {
  it('needs no accidental for anything in the key', () => {
    // E flat major: the three flats of the signature carry the spelling.
    for (const name of ['Eb4', 'F4', 'G4', 'Ab4', 'Bb4', 'C5', 'D5']) {
      const pitch = spellInKey(midiFromName(name), -3);
      expect(needsAccidental(pitch, -3), name).toBe(false);
    }
  });

  it('spells chromatic notes in the direction of the key', () => {
    // A flat key lowers, so the note between F and G is G flat rather than F
    // sharp; a sharp key raises, so the same interval is F sharp.
    expect(spell(midiFromName('F#4'), -3)).toBe('Gb4');
    expect(spell(midiFromName('F#4'), 0)).toBe('F#4');
  });

  it('cancels the signature rather than doubling an accidental', () => {
    /*
     * The note above A flat in E flat major is A natural. Spelling it by
     * lowering B instead gives B double flat — the same pitch, drawn a step
     * higher on the stave and read as something else entirely.
     *
     * This was a real fault: chromatic notes in the default key were coming out
     * as double flats, and since the glyph table has no double flat they were
     * *drawn* as single flats. The player was shown a note a semitone away from
     * the one they had to finger.
     */
    expect(spell(midiFromName('A4'), -3)).toBe('A4');
    expect(spell(midiFromName('B4'), -3)).toBe('B4');

    // And the same the other way: F natural in G major is a natural sign, not
    // E sharp, even though both need only one accidental.
    expect(spell(midiFromName('F4'), 1)).toBe('F4');
  });

  it('never asks for a double accidental, in any key', () => {
    // There is a single-accidental spelling of every pitch class in every key,
    // and a practice app has no business printing what a publisher would not.
    for (const key of MAJOR_KEYS) {
      for (let midi = 36; midi <= 84; midi++) {
        const pitch = spellInKey(midi, key.fifths);
        expect(Math.abs(pitch.alter), `${midi} in ${key.name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('always spells the pitch it was given', () => {
    // Whatever else it chooses, the spelling has to sound the note asked for.
    for (const key of MAJOR_KEYS) {
      for (let midi = 36; midi <= 84; midi++) {
        expect(midiFromName(spell(midi, key.fifths)), `${midi} in ${key.name}`).toBe(midi);
      }
    }
  });
});

describe('the key in force at a beat', () => {
  const changes = [
    { fromBeat: 0, fifths: -3 },
    { fromBeat: 16, fifths: -1 },
    { fromBeat: 32, fifths: 2 },
  ];

  it('holds each key until the next one starts', () => {
    expect(keyAt(changes, 0)).toBe(-3);
    expect(keyAt(changes, 15.99)).toBe(-3);
    expect(keyAt(changes, 16)).toBe(-1);
    expect(keyAt(changes, 31)).toBe(-1);
    expect(keyAt(changes, 32)).toBe(2);
    expect(keyAt(changes, 999)).toBe(2);
  });

  it('answers for the count-in, which sits before the first beat', () => {
    // Negative beats are where the count-in lives; the opening key applies
    // there, not nothing.
    expect(keyAt(changes, -4)).toBe(-3);
  });

  it('is happy with a single key, which is the ordinary case', () => {
    const one = [{ fromBeat: 0, fifths: 4 }];
    expect(keyAt(one, 0)).toBe(4);
    expect(keyAt(one, 100)).toBe(4);
    expect(changesKey(one)).toBe(false);
    expect(changesKey(changes)).toBe(true);
  });

  it('answers C major rather than throwing when handed nothing', () => {
    // A renderer part-way through a frame is no place to discover a malformed
    // exercise.
    expect(keyAt([], 0)).toBe(0);
  });
});

describe('describing a key signature', () => {
  it('names the count and the sign', () => {
    expect(describeFifths(1)).toBe('1 sharp');
    expect(describeFifths(2)).toBe('2 sharps');
    expect(describeFifths(-1)).toBe('1 flat');
    expect(describeFifths(-3)).toBe('3 flats');
  });

  it('has a word for C major rather than "0 sharps"', () => {
    expect(describeFifths(0)).toBe('no sharps or flats');
  });
});
