// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { instrumentById, writtenRange } from '../domain/instruments';
import {
  AUDIO_LEAD_RANGE,
  audioLeadFor,
  DEFAULT_SETTINGS,
  PLAYBACK_MODES,
  loadSettings,
  sanitise,
  saveSettings,
  switchMaterial,
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
      conductorStyle: -5,
    });
    expect(settings.tempo).toBeLessThanOrEqual(220);
    expect(settings.scrollSpeed).toBeGreaterThanOrEqual(4);
    expect(settings.countInBars).toBeLessThanOrEqual(2);
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

describe('the drills, which used to be two materials', () => {
  /*
   * Scales and Arpeggios each had a box of their own until v2.16.0 merged them
   * into Drills with a picker. A stored kind naming either is somebody who
   * chose that material, and they must land on the drill their box played —
   * not on the default material, which is what an unrecognised kind falls to.
   */
  it('reads a stored Scales as the major scale drill', () => {
    const settings = sanitise({ ...DEFAULT_SETTINGS, kind: 'scales' } as never);
    expect(settings.kind).toBe('drills');
    expect(settings.drillId).toBe('major-scale');
  });

  it('reads a stored Arpeggios as the tonic arpeggio drill', () => {
    const settings = sanitise({ ...DEFAULT_SETTINGS, kind: 'arpeggios' } as never);
    expect(settings.kind).toBe('drills');
    expect(settings.drillId).toBe('tonic-arpeggio');
  });

  it('keeps a modern kind and drill as they are', () => {
    const settings = sanitise({ ...DEFAULT_SETTINGS, kind: 'drills', drillId: 'dominant-7th' });
    expect(settings.kind).toBe('drills');
    expect(settings.drillId).toBe('dominant-7th');
  });

  it('still opens an unrecognised kind on the default material', () => {
    // *Random notes* was dropped in v2.14.0; a file naming it predates the
    // drills too, so there is no better answer than the default.
    const settings = sanitise({ ...DEFAULT_SETTINGS, kind: 'random' } as never);
    expect(settings.kind).toBe(DEFAULT_SETTINGS.kind);
  });

  it('falls back to the major scale for a drill that does not exist', () => {
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      kind: 'drills',
      drillId: 'whole-tone' as never,
    });
    expect(settings.drillId).toBe('major-scale');
  });
});

describe('the fingering setting, which used to be a switch', () => {
  /*
   * It was a boolean — "show fingerings for notes I get wrong" — and became
   * three modes, because a fingering trainer is used in three frames of mind:
   * reading something new with the answers in front of you, practising with a
   * prompt where the trouble is, and playing it for real. Anyone updating the
   * app has one of the two old answers stored, and neither may be lost.
   */
  it('reads an old switch as the mode it meant', () => {
    const on = sanitise({ ...DEFAULT_SETTINGS, fingerings: undefined, fingeringHints: true } as never);
    const off = sanitise({ ...DEFAULT_SETTINGS, fingerings: undefined, fingeringHints: false } as never);

    expect(on.fingerings).toBe('trouble');
    expect(off.fingerings).toBe('never');
  });

  it('keeps a mode that is already one of the three', () => {
    expect(sanitise({ ...DEFAULT_SETTINGS, fingerings: 'always' }).fingerings).toBe('always');
    expect(sanitise({ ...DEFAULT_SETTINGS, fingerings: 'never' }).fingerings).toBe('never');
  });

  it('falls back to prompting where the trouble is', () => {
    // Nonsense in storage, or a settings file from before either existed.
    const odd = sanitise({ ...DEFAULT_SETTINGS, fingerings: 'sometimes' } as never);
    expect(odd.fingerings).toBe(DEFAULT_SETTINGS.fingerings);
  });
});

describe('the calibrated outputs', () => {
  /*
   * A list of headsets, each with how far behind the clock it is heard, and
   * which is in the ears. The phone's speaker is what "none of these" means.
   */
  const bose = { id: 'a', name: 'Bose', leadMs: 180 };
  const buds = { id: 'b', name: 'Buds', leadMs: 260 };

  it('keeps a well-formed list and the choice from it', () => {
    const settings = sanitise({ ...DEFAULT_SETTINGS, audioOutputs: [bose, buds], audioOutputId: 'b' });
    expect(settings.audioOutputs).toEqual([bose, buds]);
    expect(settings.audioOutputId).toBe('b');
    expect(audioLeadFor(settings)).toBeCloseTo(0.26, 9);
  });

  it('means the phone speaker, and no lead, when nothing is chosen or the choice has gone', () => {
    expect(audioLeadFor(sanitise({ ...DEFAULT_SETTINGS, audioOutputs: [bose] }))).toBe(0);
    const gone = sanitise({ ...DEFAULT_SETTINGS, audioOutputs: [bose], audioOutputId: 'zzz' });
    expect(gone.audioOutputId).toBeNull();
    expect(audioLeadFor(gone)).toBe(0);
  });

  it('drops what is not an output and clamps a lead out of range', () => {
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      audioOutputs: [
        bose,
        { id: '', name: 'nameless', leadMs: 10 },
        { id: 'c', name: 'Slow', leadMs: 9000 },
        { id: 'a', name: 'Duplicate', leadMs: 1 },
        { id: 'd', name: '  ', leadMs: 50 },
        'not an output',
        null,
      ] as never,
      audioOutputId: 'c',
    });
    expect(settings.audioOutputs).toEqual([
      bose,
      { id: 'c', name: 'Slow', leadMs: AUDIO_LEAD_RANGE.max },
      { id: 'd', name: 'Headphones', leadMs: 50 },
    ]);
    expect(settings.audioOutputId).toBe('c');
  });

  it('starts empty for a settings file that predates it', () => {
    store({ tempo: 90 });
    const settings = loadSettings();
    expect(settings.audioOutputs).toEqual([]);
    expect(settings.audioOutputId).toBeNull();
  });
});

describe('a key and a difficulty per material', () => {
  /*
   * The pair in force stays where everything reads it; each material's own
   * pair waits in `materials`, put away on leaving and taken out on return.
   */
  const inDrills = sanitise({
    ...DEFAULT_SETTINGS,
    kind: 'drills',
    keySet: [2, 4],
    difficultyId: 'hard',
  });

  it('mirrors the pair in force under the material in force', () => {
    expect(inDrills.materials.drills).toEqual({ keySet: [2, 4], difficultyId: 'hard' });
    expect(inDrills.fifths).toBe(2);
  });

  it('carries the pair over to a material never chosen, and puts the old one away', () => {
    const inThemes = switchMaterial(inDrills, 'themes');
    expect(inThemes.kind).toBe('themes');
    expect(inThemes.keySet).toEqual([2, 4]);
    expect(inThemes.difficultyId).toBe('hard');
    expect(inThemes.materials.drills).toEqual({ keySet: [2, 4], difficultyId: 'hard' });
  });

  it('brings a material its own pair back when it is chosen again', () => {
    const inThemes = sanitise({
      ...switchMaterial(inDrills, 'themes'),
      keySet: [-2],
      difficultyId: 'beginner',
    });
    const back = switchMaterial(inThemes, 'drills');
    expect(back.keySet).toEqual([2, 4]);
    expect(back.fifths).toBe(2);
    expect(back.difficultyId).toBe('hard');
    // And themes' own pair is waiting for next time.
    expect(back.materials.themes).toEqual({ keySet: [-2], difficultyId: 'beginner' });
    expect(switchMaterial(back, 'themes').keySet).toEqual([-2]);
  });

  it('changes nothing for the material already chosen, or for imported music', () => {
    expect(switchMaterial(inDrills, 'drills')).toBe(inDrills);
    expect(switchMaterial(inDrills, 'imported')).toBe(inDrills);
  });

  it('drops a remembered pair that names keys or a difficulty that do not exist', () => {
    // Themes is in force here, so its entry is whatever is in force; the
    // other two are what was remembered, kept or dropped on their merits.
    const settings = sanitise({
      ...DEFAULT_SETTINGS,
      kind: 'themes',
      materials: {
        drills: { keySet: [1], difficultyId: 'impossible' },
        phrases: { keySet: [1, 1, 3], difficultyId: 'easy' },
      } as never,
    });
    expect(settings.materials.drills).toBeUndefined();
    expect(settings.materials.phrases).toEqual({ keySet: [1, 3], difficultyId: 'easy' });
    expect(settings.materials.themes).toEqual({ keySet: [-3], difficultyId: 'easy' });

    const badKeys = sanitise({
      ...DEFAULT_SETTINGS,
      kind: 'themes',
      materials: { drills: { keySet: [42], difficultyId: 'easy' } },
    });
    expect(badKeys.materials.drills).toBeUndefined();
  });

  it('starts with nothing remembered for a settings file that predates it', () => {
    store({ kind: 'themes', keySet: [1], difficultyId: 'easy' });
    const settings = loadSettings();
    // Only the material in force, mirrored from what was stored.
    expect(settings.materials).toEqual({ themes: { keySet: [1], difficultyId: 'easy' } });
  });
});

describe('the cushion', () => {
  it('sits at half the instrument by default, and is held between silent and as loud', () => {
    expect(DEFAULT_SETTINGS.cushionLevel).toBe(0.5);
    expect(sanitise({ ...DEFAULT_SETTINGS, cushionLevel: 3 }).cushionLevel).toBe(1);
    expect(sanitise({ ...DEFAULT_SETTINGS, cushionLevel: -1 }).cushionLevel).toBe(0);
    expect(sanitise({ ...DEFAULT_SETTINGS, cushionLevel: Number.NaN }).cushionLevel).toBe(0);
    expect(sanitise({ ...DEFAULT_SETTINGS, cushionLevel: 0.25 }).cushionLevel).toBe(0.25);
  });

  it('is half for a settings file that predates it', () => {
    store({ tempo: 90 });
    expect(loadSettings().cushionLevel).toBe(0.5);
  });
});
