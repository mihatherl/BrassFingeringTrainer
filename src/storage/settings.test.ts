// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { instrumentById, writtenRange } from '../domain/instruments';
import {
  DEFAULT_SETTINGS,
  PLAYBACK_MODES,
  loadSettings,
  sanitise,
  saveSettings,
} from './settings';

const STORAGE_KEY = 'brass-trainer:settings';

afterEach(() => localStorage.clear());

function store(value: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

describe('loading settings', () => {
  it('falls back to the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values and fills the gaps from the defaults', () => {
    store({ tempo: 132, instrumentId: 'cornet' });
    const settings = loadSettings();
    expect(settings.tempo).toBe(132);
    expect(settings.instrumentId).toBe('cornet');
    expect(settings.difficultyId).toBe(DEFAULT_SETTINGS.difficultyId);
  });

  it('round-trips through saving', () => {
    const settings = { ...DEFAULT_SETTINGS, tempo: 96, playbackMode: 'off' as const };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });
});

describe('variable tempo, arriving in old settings files', () => {
  it('lands on off for anyone whose stored settings predate it', () => {
    store({ tempo: 96 });
    expect(loadSettings().variableTempo).toBe(false);
  });

  it('keeps an explicit choice', () => {
    store({ variableTempo: true });
    expect(loadSettings().variableTempo).toBe(true);
  });

  it('coerces anything that is not a real boolean to off', () => {
    store({ variableTempo: 'yes' });
    expect(loadSettings().variableTempo).toBe(false);
  });
});

describe('migrating the old playback switch', () => {
  it('keeps playback off for anyone who had turned it off', () => {
    // Playback used to be a boolean. Turning sound back on unasked would be a
    // rude surprise, particularly mid-rehearsal.
    store({ playbackEnabled: false });
    expect(loadSettings().playbackMode).toBe('off');
  });

  it('gives everyone else the reference tone they already had', () => {
    store({ playbackEnabled: true });
    expect(loadSettings().playbackMode).toBe('reference');
  });

  it('does not override an explicit choice', () => {
    store({ playbackEnabled: false, playbackMode: 'reference' });
    expect(loadSettings().playbackMode).toBe('reference');
  });
});

describe('a playback mode that no longer exists', () => {
  it('is not offered', () => {
    expect(PLAYBACK_MODES.map((mode) => mode.id)).toEqual(['reference', 'off']);
  });

  it('falls back for anyone who had it stored', () => {
    // "Play what I finger" was withdrawn. This list is the only thing deciding
    // what can be chosen, so a stored setting naming a mode that has gone must
    // degrade to something valid rather than to nothing at all.
    store({ playbackMode: 'fingered' });
    expect(loadSettings().playbackMode).toBe(DEFAULT_SETTINGS.playbackMode);
  });
});


describe('sanitising', () => {
  it('rejects an instrument that no longer exists', () => {
    expect(sanitise({ ...DEFAULT_SETTINGS, instrumentId: 'sackbut' }).instrumentId).toBe(
      DEFAULT_SETTINGS.instrumentId,
    );
  });

  it('moves to a clef the instrument can actually read', () => {
    // A cornet does not read bass clef, so a stored preference for it must not
    // survive into an exercise.
    const settings = sanitise({ ...DEFAULT_SETTINGS, instrumentId: 'cornet', clef: 'bass' });
    expect(settings.clef).toBe('treble');
  });

  it('leaves a clef the instrument does read', () => {
    const settings = sanitise({ ...DEFAULT_SETTINGS, instrumentId: 'euphonium', clef: 'bass' });
    expect(settings.clef).toBe('bass');
  });

  it('clamps values that are out of range', () => {
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      tempo: 10_000,
      scrollSpeed: -5,
      countInBars: 99,
      bars: 0,
      conductorStyle: -5,
    });
    expect(settings.tempo).toBeLessThanOrEqual(220);
    expect(settings.scrollSpeed).toBeGreaterThanOrEqual(4);
    expect(settings.countInBars).toBeLessThanOrEqual(2);
    expect(settings.bars).toBeGreaterThanOrEqual(1);
    // The style is fed straight to the phase warp. Above the range it is
    // harmless — the lag is capped — but below zero the warp inverts and the
    // tip travels backwards through the beat, so the floor is the one with
    // teeth and both ends are held anyway.
    expect(settings.conductorStyle).toBeGreaterThanOrEqual(0);
  });

  it('rejects nonsense numbers rather than passing them on', () => {
    const settings = sanitise({ ...DEFAULT_SETTINGS, tempo: Number.NaN });
    expect(Number.isFinite(settings.tempo)).toBe(true);
  });

  it('rejects unknown modes', () => {
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      readingMode: 'sideways' as never,
      playbackMode: 'kazoo' as never,
    });
    expect(settings.readingMode).toBe(DEFAULT_SETTINGS.readingMode);
    expect(settings.playbackMode).toBe(DEFAULT_SETTINGS.playbackMode);
  });

  it('rejects a key signature off the circle of fifths', () => {
    expect(sanitise({ ...DEFAULT_SETTINGS, fifths: 42 }).fifths).toBe(DEFAULT_SETTINGS.fifths);
  });
});

describe('a chosen range', () => {
  /*
   * Written pitch, so it moves with the clef and the instrument: a range picked
   * on an Eb bass in treble names different numbers on a euphonium in bass.
   * Clamped rather than cleared, because clearing would silently drop a choice
   * on a mis-tap and the stave beside the control shows where a clamped one
   * ended up.
   */
  const [low, high] = writtenRange(instrumentById('eb-bass'), 'treble');

  it('is left alone when it fits', () => {
    const range = { low: low + 3, high: low + 15 };
    expect(sanitise({ ...DEFAULT_SETTINGS, range }).range).toEqual(range);
  });

  it('is pulled inside the horn when it does not fit', () => {
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      range: { low: low - 20, high: high + 20 },
    });
    expect(settings.range).toEqual({ low, high });
  });

  it('is put the right way round', () => {
    // A stored file can say anything, and a backwards range would otherwise
    // reach the generator as an empty pool.
    const settings = sanitise({ ...DEFAULT_SETTINGS, range: { low: low + 12, high: low + 4 } });
    expect(settings.range).toEqual({ low: low + 4, high: low + 12 });
  });

  it('follows the clef, which restates every written pitch', () => {
    // Treble E flat bass and bass-clef euphonium share no written pitches at
    // all; a range kept from one is meaningless in the other, and comes back
    // as the nearest thing the new instrument can play.
    const [bassLow, bassHigh] = writtenRange(instrumentById('euphonium'), 'bass');
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      instrumentId: 'euphonium',
      clef: 'bass',
      range: { low: low + 3, high: low + 15 },
    });
    expect(settings.range!.low).toBeGreaterThanOrEqual(bassLow);
    expect(settings.range!.high).toBeLessThanOrEqual(bassHigh);
  });

  it('is nothing at all where nothing was chosen', () => {
    // Null is the difficulty deciding, which is the default and is not the
    // same as a range of none.
    expect(sanitise({ ...DEFAULT_SETTINGS, range: null }).range).toBeNull();
    expect(sanitise({ ...DEFAULT_SETTINGS, range: { low: NaN, high: 4 } }).range).toBeNull();
    expect(sanitise({ ...DEFAULT_SETTINGS, range: 'wide' as never }).range).toBeNull();
  });
});
