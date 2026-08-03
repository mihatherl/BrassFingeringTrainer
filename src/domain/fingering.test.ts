import { describe, expect, it } from 'vitest';
import { midiFromName } from './pitch';
import {
  instrumentById,
  soundingFromWritten,
  writtenFromSounding,
  writtenRange,
  type Clef,
  type Instrument,
} from './instruments';
import {
  acceptedMasks,
  formatMask,
  maskOf,
  primaryFingering,
  soundedPitch,
} from './fingering';

/**
 * The harmonic-series model is elegant, but elegance proves nothing. These
 * tables are taken from standard published fingering charts; if the model and
 * the charts ever disagree, the charts are right.
 */

function fingeringOf(written: string, instrument: Instrument, clef: Clef): string {
  const sounding = soundingFromWritten(midiFromName(written), instrument, clef);
  const fingering = primaryFingering(sounding, instrument);
  if (!fingering) return 'unplayable';
  return formatMask(fingering.mask);
}

/** Written note -> the buttons the player must hold. */
type Chart = ReadonlyArray<readonly [string, string]>;

const cornet = instrumentById('cornet');
const ebBass = instrumentById('eb-bass');
const euphonium = instrumentById('euphonium');

/**
 * Bb cornet / trumpet, treble clef — the chart every brass player learns first.
 * Covers the full written range from low F# to top C.
 */
const CORNET_TREBLE: Chart = [
  ['F#3', '1-2-3'],
  ['G3', '1-3'],
  ['Ab3', '2-3'],
  ['A3', '1-2'],
  ['Bb3', '1'],
  ['B3', '2'],
  ['C4', 'open'],
  ['C#4', '1-2-3'],
  ['D4', '1-3'],
  ['Eb4', '2-3'],
  ['E4', '1-2'],
  ['F4', '1'],
  ['F#4', '2'],
  ['G4', 'open'],
  ['Ab4', '2-3'],
  ['A4', '1-2'],
  ['Bb4', '1'],
  ['B4', '2'],
  ['C5', 'open'],
  ['C#5', '1-2'],
  ['D5', '1'],
  ['Eb5', '2'],
  ['E5', 'open'],
  ['F5', '1'],
  ['F#5', '2'],
  ['G5', 'open'],
  // The 7th-partial trap: if that harmonic were allowed, these two would come
  // out as "2" and "open" respectively, and both would be wrong.
  ['A5', '1-2'],
  ['Bb5', '1'],
  ['B5', '2'],
  ['C6', 'open'],
];

/**
 * Eb bass, treble clef. The expected values below the low-F# extension are the
 * three-valve remainder of the real four-valve fingering, by design.
 */
const EB_BASS_TREBLE: Chart = [
  ['C#3', '1-2-3'],
  ['D3', '1-3'],
  ['Eb3', '2-3'],
  ['E3', '1-2'],
  ['F3', '1'],
  ['F#3', '1-2-3'],
  ['G3', '1-3'],
  ['A3', '1-2'],
  ['Bb3', '1'],
  ['C4', 'open'],
  ['D4', '1-3'],
  ['E4', '1-2'],
  ['G4', 'open'],
  ['A4', '1-2'],
  ['C5', 'open'],
];

/** Euphonium, bass clef — concert pitch, so an entirely different chart. */
const EUPHONIUM_BASS: Chart = [
  ['Eb2', '1'],
  ['E2', '1-2-3'],
  ['F2', '1-3'],
  ['F#2', '2-3'],
  ['G2', '1-2'],
  ['Ab2', '1'],
  ['A2', '2'],
  ['Bb2', 'open'],
  ['B2', '1-2-3'],
  ['C3', '1-3'],
  ['D3', '1-2'],
  ['Eb3', '1'],
  ['E3', '2'],
  ['F3', 'open'],
  ['G3', '1-2'],
  ['A3', '2'],
  ['Bb3', 'open'],
  ['C4', '1'],
  ['D4', 'open'],
  ['Eb4', '1'],
  ['F4', 'open'],
];

describe('fingering engine against published charts', () => {
  it.each(CORNET_TREBLE)('cornet, treble: written %s is %s', (note, expected) => {
    expect(fingeringOf(note, cornet, 'treble')).toBe(expected);
  });

  it.each(EB_BASS_TREBLE)('Eb bass, treble: written %s is %s', (note, expected) => {
    expect(fingeringOf(note, ebBass, 'treble')).toBe(expected);
  });

  it.each(EUPHONIUM_BASS)('euphonium, bass: written %s is %s', (note, expected) => {
    expect(fingeringOf(note, euphonium, 'bass')).toBe(expected);
  });
});

describe('brass band treble clef', () => {
  /**
   * The premise the whole instrument model rests on: in brass band treble clef
   * every valved instrument shares one fingering chart. This is not hard-coded
   * anywhere — it emerges from the transposition figures — so it is worth
   * asserting directly.
   */
  it('gives identical fingerings across the band for identical written notes', () => {
    const band = ['cornet', 'flugel', 'tenor-horn', 'baritone', 'euphonium', 'eb-bass', 'bb-bass']
      .map(instrumentById);

    for (const [note] of CORNET_TREBLE) {
      const written = midiFromName(note);
      const fingerings = band
        .filter((i) => {
          const [low, high] = writtenRange(i, 'treble');
          return written >= low && written <= high;
        })
        .map((i) => fingeringOf(note, i, 'treble'));

      expect(new Set(fingerings).size, `written ${note} differed across the band`).toBe(1);
    }
  });

  it('sounds different pitches for the same written note', () => {
    const written = midiFromName('C4');
    expect(soundingFromWritten(written, cornet, 'treble')).toBe(midiFromName('Bb3'));
    expect(soundingFromWritten(written, euphonium, 'treble')).toBe(midiFromName('Bb2'));
    expect(soundingFromWritten(written, ebBass, 'treble')).toBe(midiFromName('Eb2'));
  });

  it('agrees with bass clef about the same sounding note', () => {
    // Written C4 in treble and concert Bb2 in bass clef are the same note on a
    // euphonium, and must therefore have the same fingering.
    expect(fingeringOf('C4', euphonium, 'treble')).toBe(fingeringOf('Bb2', euphonium, 'bass'));
  });
});

describe('the virtual 4th valve', () => {
  it('is masked out of what the player must hold', () => {
    const sounding = soundingFromWritten(midiFromName('F3'), ebBass, 'treble');
    const fingering = primaryFingering(sounding, ebBass);
    expect(fingering?.valves).toEqual([1, 4]);
    expect(fingering?.usesFourth).toBe(true);
    expect(formatMask(fingering!.mask)).toBe('1');
  });

  it('never lets a masked fingering be mistaken for open valves', () => {
    // A 1-3 note must not also accept open, which is what would happen if the
    // bare {4} combination were ever offered as an alternate.
    const sounding = soundingFromWritten(midiFromName('D3'), ebBass, 'treble');
    expect(acceptedMasks(sounding, ebBass).has(maskOf([]))).toBe(false);
  });

  it('is not used by instruments that do not have one', () => {
    const belowRange = soundingFromWritten(midiFromName('F3'), cornet, 'treble');
    expect(primaryFingering(belowRange, cornet)).toBeNull();
  });
});

describe('alternate fingerings', () => {
  it('accepts the genuine alternate for top G on cornet', () => {
    const sounding = soundingFromWritten(midiFromName('G5'), cornet, 'treble');
    const masks = acceptedMasks(sounding, cornet);
    expect(masks.has(maskOf([]))).toBe(true); // open, on the 6th partial
    expect(masks.has(maskOf([1, 3]))).toBe(true); // 1-3, from the harmonic above
  });

  it('accepts 3 as well as 1-2', () => {
    const sounding = soundingFromWritten(midiFromName('A3'), cornet, 'treble');
    const masks = acceptedMasks(sounding, cornet);
    expect(masks.has(maskOf([1, 2]))).toBe(true);
    expect(masks.has(maskOf([3]))).toBe(true);
  });
});

describe('what a button state sounds', () => {
  /**
   * The written note that sounds, as a MIDI number. Compared numerically rather
   * than by name so that B flat and A sharp cannot fail a test for being the
   * same pitch spelled differently.
   */
  function sounds(written: string, valves: number[], instrument: Instrument, clef: Clef): number {
    const target = soundingFromWritten(midiFromName(written), instrument, clef);
    const pitch = soundedPitch(maskOf(valves), target, instrument);
    return writtenFromSounding(pitch, instrument, clef);
  }

  const expectSounds = (
    written: string,
    valves: number[],
    instrument: Instrument,
    clef: Clef,
    expected: string,
  ) =>
    expect(
      sounds(written, valves, instrument, clef),
      `${written} fingered ${valves.join('-') || 'open'} should sound ${expected}`,
    ).toBe(midiFromName(expected));

  it('gives the target exactly when the fingering is right', () => {
    for (const [note, valves] of [
      ['C4', []],
      ['B3', [2]],
      ['Bb3', [1]],
      ['A3', [1, 2]],
      ['G3', [1, 3]],
      ['F#3', [1, 2, 3]],
      ['G4', []],
      ['A4', [1, 2]],
      ['C5', []],
      ['E5', []],
    ] as Array<[string, number[]]>) {
      expectSounds(note, valves, cornet, 'treble', note);
    }
  });

  it('drops to the nearest note the held valves can reach', () => {
    // Valve 1 where valve 2 was wanted comes out a semitone flat.
    expectSounds('F#4', [1], cornet, 'treble', 'F4');
    expectSounds('B3', [1], cornet, 'treble', 'Bb3');
  });

  it('sounds wrong when the fingering is wrong', () => {
    // Open where 1-2 was wanted overshoots to the harmonic above.
    expectSounds('A4', [], cornet, 'treble', 'G4');
    // Valve 1 on an open note falls a tone.
    expectSounds('C4', [1], cornet, 'treble', 'Bb3');
    // All three valves down where open was wanted lands a semitone *above*, on
    // the harmonic beyond — nearer than the note a fourth below, and what a
    // player aiming at C would actually produce with those valves down.
    expectSounds('C5', [1, 2, 3], cornet, 'treble', 'C#5');
  });

  it('honours the 4th valve when, and only when, the note needs it', () => {
    // Written low F really is 1 plus the 4th, and the app asks only for 1 — so
    // holding 1 must sound low F, not something five semitones away.
    expectSounds('F3', [1], ebBass, 'treble', 'F3');
    expectSounds('E3', [1, 2], ebBass, 'treble', 'E3');

    // But a note that does not need the 4th must not get its help: valve 1 on a
    // note fingered open still comes out a tone flat.
    expectSounds('C4', [1], ebBass, 'treble', 'Bb3');
  });

  it('never returns the target for a fingering that cannot produce it', () => {
    // Sweeping the range: if the held mask is not an accepted fingering, the
    // note that sounds must differ from the one that was wanted.
    const [low, high] = writtenRange(cornet, 'treble');
    for (let written = low; written <= high; written++) {
      const target = soundingFromWritten(written, cornet, 'treble');
      const accepted = acceptedMasks(target, cornet);
      for (let mask = 0; mask < 8; mask++) {
        const pitch = soundedPitch(mask, target, cornet);
        if (accepted.has(mask)) expect(pitch).toBe(target);
        else expect(pitch, `written ${written} mask ${mask}`).not.toBe(target);
      }
    }
  });
});

describe('playable range', () => {
  it('gives every note in an instrument written range a fingering', () => {
    for (const instrument of [cornet, ebBass, euphonium]) {
      for (const clef of ['treble', 'bass'] as const) {
        if (instrument.transposition[clef] === undefined) continue;
        const [low, high] = writtenRange(instrument, clef);
        for (let written = low; written <= high; written++) {
          const sounding = soundingFromWritten(written, instrument, clef);
          expect(
            primaryFingering(sounding, instrument),
            `${instrument.name} ${clef} written ${written}`,
          ).not.toBeNull();
        }
      }
    }
  });
});
