import { describe, expect, it } from 'vitest';
import { maskOf, soundedPitch } from '../domain/fingering';
import { instrumentById, middleSounding, writtenFromSounding } from '../domain/instruments';
import { midiFromName } from '../domain/pitch';
import { restTarget, type RestVoicing } from './rest-voicing';

const NOTHING = maskOf([]);
const FIRST = maskOf([1]);
const FIRST_SECOND = maskOf([1, 2]);
const THIRD = maskOf([3]);

const MIDDLE = 64;

function voicing(overrides: Partial<RestVoicing> = {}): RestVoicing {
  return {
    mask: NOTHING,
    previousMask: NOTHING,
    previousTarget: null,
    nextAccepted: [],
    nextTarget: null,
    middleTarget: MIDDLE,
    ...overrides,
  };
}

describe('what the player is aiming at during a rest', () => {
  it('carries the previous note over when the fingering has not changed', () => {
    expect(
      restTarget(voicing({ mask: FIRST_SECOND, previousMask: FIRST_SECOND, previousTarget: 70 })),
    ).toBe(70);
  });

  it('does not carry an open note over into a rest', () => {
    // Someone genuinely holding an open note through a rest looks exactly like
    // someone who has stopped playing, and stopping is far likelier.
    expect(
      restTarget(voicing({ mask: NOTHING, previousMask: NOTHING, previousTarget: 67 })),
    ).toBeNull();
  });

  it('stays silent with no valves down, whatever else fits', () => {
    // None of the three rules may override an empty hand: not a carry-over, not
    // an open note coming up next, nothing.
    expect(
      restTarget(
        voicing({
          mask: NOTHING,
          previousMask: NOTHING,
          previousTarget: 67,
          nextAccepted: [NOTHING],
          nextTarget: 60,
        }),
      ),
    ).toBeNull();
  });

  it('takes the coming note when the player enters early', () => {
    // Not what they were holding, but a correct fingering for what is next.
    expect(
      restTarget(
        voicing({
          mask: THIRD,
          previousMask: FIRST,
          previousTarget: 70,
          nextAccepted: [THIRD, FIRST_SECOND],
          nextTarget: 62,
        }),
      ),
    ).toBe(62);
  });

  it('prefers carrying over to guessing at the next note', () => {
    // An unchanged fingering means they never stopped, even if it happens to
    // also fit what is coming.
    expect(
      restTarget(
        voicing({
          mask: FIRST,
          previousMask: FIRST,
          previousTarget: 70,
          nextAccepted: [FIRST],
          nextTarget: 62,
        }),
      ),
    ).toBe(70);
  });

  it('falls back to the middle of the range for anything else', () => {
    expect(
      restTarget(
        voicing({
          mask: THIRD,
          previousMask: FIRST,
          previousTarget: 70,
          nextAccepted: [FIRST_SECOND],
          nextTarget: 62,
        }),
      ),
    ).toBe(MIDDLE);
  });

  it('stays silent for an unaccounted-for open fingering', () => {
    // The trap: no valves is indistinguishable from no player. Guessing here
    // would invent a note every time the instrument was put down in a rest.
    expect(
      restTarget(
        voicing({
          mask: NOTHING,
          previousMask: FIRST,
          previousTarget: 70,
          nextAccepted: [FIRST_SECOND],
          nextTarget: 62,
        }),
      ),
    ).toBeNull();
  });

  it('stays silent at the very start when nothing is held', () => {
    expect(restTarget(voicing())).toBeNull();
  });

  it('still sounds a valve held before the first note', () => {
    expect(restTarget(voicing({ mask: FIRST }))).toBe(MIDDLE);
  });

  it('sounds an early entry into the first note', () => {
    expect(restTarget(voicing({ mask: FIRST, nextAccepted: [FIRST], nextTarget: 58 }))).toBe(58);
  });
});

describe('the fallback register', () => {
  it('sits in a comfortable part of each instrument’s range', () => {
    // For an Eb bass reading treble clef this lands on written E4, in the middle
    // of the C4–G4 region where idle noodling naturally sits.
    const ebBass = instrumentById('eb-bass');
    const middle = middleSounding(ebBass, 'treble');
    expect(writtenFromSounding(middle, ebBass, 'treble')).toBe(midiFromName('E4'));
  });

  it('is inside the playable range for every instrument and clef', () => {
    for (const id of ['cornet', 'flugel', 'tenor-horn', 'baritone', 'euphonium', 'eb-bass', 'bb-bass']) {
      const instrument = instrumentById(id);
      for (const clef of ['treble', 'bass'] as const) {
        if (instrument.transposition[clef] === undefined) continue;
        const middle = middleSounding(instrument, clef);
        const [low, high] = instrument.soundingRange;
        expect(middle, `${id} ${clef}`).toBeGreaterThanOrEqual(low);
        expect(middle, `${id} ${clef}`).toBeLessThanOrEqual(high);
      }
    }
  });

  it('produces a real note when resolved through a held fingering', () => {
    // The fallback is a target, not a pitch — it still goes through the harmonic
    // column, so what actually sounds must be something the instrument can play.
    const ebBass = instrumentById('eb-bass');
    const middle = middleSounding(ebBass, 'treble');
    for (let mask = 1; mask < 8; mask++) {
      const pitch = soundedPitch(mask, middle, ebBass);
      expect(Math.abs(pitch - middle), `mask ${mask}`).toBeLessThanOrEqual(6);
    }
  });
});
