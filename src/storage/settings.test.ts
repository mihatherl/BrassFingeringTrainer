// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PLAYBACK_MODES,
  loadOpenPanels,
  loadSettings,
  sanitise,
  saveOpenPanels,
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

describe('which settings sections are open', () => {
  it('uses the given defaults when nothing is stored', () => {
    expect(loadOpenPanels(['exercise'])).toEqual(['exercise']);
  });

  it('round-trips a choice', () => {
    saveOpenPanels(['instrument', 'playback']);
    expect(loadOpenPanels(['exercise'])).toEqual(['instrument', 'playback']);
  });

  it('remembers everything being closed, rather than falling back to defaults', () => {
    // Collapsing the lot is a deliberate choice and must survive a reload.
    saveOpenPanels([]);
    expect(loadOpenPanels(['exercise'])).toEqual([]);
  });

  it('ignores rubbish in storage', () => {
    localStorage.setItem('brass-trainer:open-panels', '{"not":"an array"}');
    expect(loadOpenPanels(['exercise'])).toEqual(['exercise']);

    localStorage.setItem('brass-trainer:open-panels', 'not json');
    expect(loadOpenPanels(['exercise'])).toEqual(['exercise']);
  });

  it('discards non-string entries', () => {
    localStorage.setItem('brass-trainer:open-panels', '["exercise", 7, null]');
    expect(loadOpenPanels([])).toEqual(['exercise']);
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
    });
    expect(settings.tempo).toBeLessThanOrEqual(220);
    expect(settings.scrollSpeed).toBeGreaterThanOrEqual(4);
    expect(settings.countInBars).toBeLessThanOrEqual(2);
    expect(settings.bars).toBeGreaterThanOrEqual(1);
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
