import { describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import { playerShouldSound, type SoundingContext } from './sounding';

function context(overrides: Partial<SoundingContext> = {}): SoundingContext {
  return {
    beat: 4,
    totalBeats: 32,
    target: 60,
    mask: maskOf([1, 2]),
    openIsCorrect: false,
    idle: false,
    ...overrides,
  };
}

describe('whether the player should be making a sound', () => {
  it('sounds while the music is running and a valve is down', () => {
    expect(playerShouldSound(context())).toBe(true);
  });

  it('stops when the fingers lift and nothing is being aimed at', () => {
    // A rest with no valves down: restTarget returns null, and this must be
    // acted on every tick, not only at the moment the fingers move.
    expect(playerShouldSound(context({ mask: maskOf([]), target: null }))).toBe(false);
  });

  it('stops once the exercise has ended, whatever is still held', () => {
    // The complaint this exists for: the last note carrying on past the end.
    expect(playerShouldSound(context({ beat: 32, totalBeats: 32 }))).toBe(false);
    expect(playerShouldSound(context({ beat: 40, totalBeats: 32 }))).toBe(false);
  });

  it('keeps sounding right up to the final beat', () => {
    expect(playerShouldSound(context({ beat: 31.9, totalBeats: 32 }))).toBe(true);
  });

  it('stays silent through the count-in', () => {
    expect(playerShouldSound(context({ beat: -4 }))).toBe(false);
    expect(playerShouldSound(context({ beat: -0.01 }))).toBe(false);
    expect(playerShouldSound(context({ beat: 0 }))).toBe(true);
  });

  it('stays silent for someone who has put the instrument down', () => {
    expect(playerShouldSound(context({ mask: maskOf([]), idle: true }))).toBe(false);
  });

  it('still sounds a held valve from someone flagged as idle', () => {
    // Idle only silences an empty hand; pressing a valve is proof of life.
    expect(playerShouldSound(context({ mask: maskOf([1]), idle: true }))).toBe(true);
  });

  it('sounds an open hand on a note that really is open', () => {
    expect(playerShouldSound(context({ mask: maskOf([]), openIsCorrect: true }))).toBe(true);
  });

  it('stays silent for an open hand on a note that needs valves', () => {
    // The exception this rule exists for: open is the only fingering an idle
    // pair of hands produces, so on a note needing valves it means "not
    // playing", not "playing the wrong note".
    expect(playerShouldSound(context({ mask: maskOf([]), openIsCorrect: false }))).toBe(false);
  });

  it('still sounds a wrong fingering that took some effort', () => {
    // Everything other than open is a deliberate act, and hearing your own
    // mistake is the whole point of the mode.
    expect(playerShouldSound(context({ mask: maskOf([3]), openIsCorrect: false }))).toBe(true);
    expect(playerShouldSound(context({ mask: maskOf([1, 2, 3]), openIsCorrect: true }))).toBe(true);
  });
});
