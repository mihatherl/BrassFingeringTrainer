/**
 * Settings persistence.
 *
 * Stored values are merged over the defaults on load rather than trusted
 * wholesale, so a settings file written by an older version — or one naming an
 * instrument that no longer exists — degrades to something valid instead of
 * breaking the app.
 */

import { INSTRUMENTS, availableClefs, type Clef } from '../domain/instruments';
import type { ReadingMode } from '../render/surface';
import type { PlaybackMode } from '../engine/session';
import { FREE_TIER, type Entitlements } from '../licensing/entitlements';
import { DIFFICULTIES } from '../exercise/difficulty';
import { MAJOR_KEYS } from '../domain/keys';
import type { ExerciseKind } from '../exercise/types';

export interface Settings {
  instrumentId: string;
  clef: Clef;
  /** Written key signature on the circle of fifths. */
  fifths: number;
  tempo: number;
  difficultyId: string;
  kind: ExerciseKind;
  bars: number;
  beatsPerBar: number;
  beatUnit: number;
  countInBars: number;
  metronomeEnabled: boolean;
  playbackMode: PlaybackMode;
  /**
   * Level of the reference tone in "play what I finger" mode, where 1 is the
   * default. Your own sound should always be the one in front; this only decides
   * how far behind the backing sits.
   */
  backingLevel: number;
  /**
   * Multiplies the window either side of the beat within which a fingering
   * counts, where 1 is the strict default.
   */
  timingTolerance: number;
  weakNoteDrilling: boolean;
  /**
   * How fast the music travels, in pixels per second.
   *
   * The eye tracks absolute motion, so speed — not spacing — is what decides
   * whether notation is comfortable to read. Fixing it means the music reads at
   * the same rate on a phone and a tablet, and at any tempo; spacing and the
   * number of bars on screen fall out of it.
   */
  scrollSpeed: number;
  /**
   * Whether the music scrolls past a strike line, or sits still and turns the
   * page. Paged reading leaves the counting to the player, which is the part of
   * sight-reading a moving cursor otherwise does for them.
   */
  readingMode: ReadingMode;
}

export const SCROLL_SPEED_RANGE = { min: 50, max: 220 } as const;

export const TIMING_TOLERANCE_RANGE = { min: 0.5, max: 3 } as const;

export const PLAYBACK_MODES: ReadonlyArray<{ id: PlaybackMode; name: string; blurb: string }> = [
  {
    id: 'reference',
    name: 'Play the notes',
    blurb: 'A brass tone sounds the exercise as written, so you can hear what it should be.',
  },
  {
    id: 'fingered',
    name: 'Play what I finger',
    blurb:
      'A soft backing holds the written notes while the brass sounds your own valves — so a wrong fingering comes out as a wrong note, not just a mark on the screen.',
  },
  { id: 'off', name: 'Silent', blurb: 'Metronome only.' },
];

export const READING_MODES: ReadonlyArray<{ id: ReadingMode; name: string; blurb: string }> = [
  {
    id: 'scrolling',
    name: 'Scrolling line',
    blurb: 'Notes scroll to a fixed line, which tells you exactly when to play. Best for learning fingerings.',
  },
  {
    id: 'paged',
    name: 'Read the page',
    blurb:
      'Notes stay put and the page turns as you approach the end. Nothing marks the beat but the metronome — you count for yourself, as you would from a part.',
  },
];

export const DEFAULT_SETTINGS: Settings = {
  instrumentId: 'eb-bass',
  clef: 'treble',
  fifths: -3, // Eb major — brass band home turf
  tempo: 80,
  difficultyId: 'easy',
  kind: 'random',
  bars: 8,
  beatsPerBar: 4,
  beatUnit: 4,
  countInBars: 1,
  metronomeEnabled: true,
  playbackMode: 'reference',
  backingLevel: 1,
  timingTolerance: 1.5,
  weakNoteDrilling: true,
  scrollSpeed: 110,
  readingMode: 'scrolling',
};

const STORAGE_KEY = 'brass-trainer:settings';

export const TEMPO_RANGE = { min: 40, max: 220 } as const;
export const BARS_OPTIONS = [4, 8, 12, 16, 24] as const;
export const TIME_SIGNATURES = [
  { beatsPerBar: 4, beatUnit: 4, label: '4/4' },
  { beatsPerBar: 3, beatUnit: 4, label: '3/4' },
  { beatsPerBar: 2, beatUnit: 4, label: '2/4' },
] as const;

const PANELS_KEY = 'brass-trainer:open-panels';

/**
 * Which settings sections are expanded.
 *
 * Kept apart from the settings themselves: it is a view preference, not
 * something that changes what gets generated, and it should not travel with a
 * shared or exported configuration.
 */
export function loadOpenPanels(fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(PANELS_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : fallback;
  } catch {
    return fallback;
  }
}

export function saveOpenPanels(ids: string[]): void {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(ids));
  } catch {
    // Not worth breaking the screen over.
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const stored = JSON.parse(raw) as Partial<Settings> & { playbackEnabled?: boolean };
    const merged = { ...DEFAULT_SETTINGS, ...stored };

    // Playback used to be a simple on/off switch. Anyone who had turned it off
    // meant it, so carry that across rather than surprising them with sound.
    if (stored.playbackMode === undefined && stored.playbackEnabled === false) {
      merged.playbackMode = 'off';
    }

    return sanitise(merged);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing and full quotas both land here; losing settings is not
    // worth breaking the app over.
  }
}

/** Forces a settings object into a state the rest of the app can rely on. */
export function sanitise(settings: Settings): Settings {
  const instrument =
    INSTRUMENTS.find((i) => i.id === settings.instrumentId) ??
    INSTRUMENTS.find((i) => i.id === DEFAULT_SETTINGS.instrumentId)!;

  const clefs = availableClefs(instrument);
  const clef = clefs.includes(settings.clef) ? settings.clef : clefs[0];

  const difficulty = DIFFICULTIES.find((d) => d.id === settings.difficultyId)
    ? settings.difficultyId
    : DEFAULT_SETTINGS.difficultyId;

  const fifths = MAJOR_KEYS.some((k) => k.fifths === settings.fifths)
    ? settings.fifths
    : DEFAULT_SETTINGS.fifths;

  const timeSignature =
    TIME_SIGNATURES.find(
      (t) => t.beatsPerBar === settings.beatsPerBar && t.beatUnit === settings.beatUnit,
    ) ?? TIME_SIGNATURES[0];

  return {
    ...settings,
    instrumentId: instrument.id,
    clef,
    fifths,
    difficultyId: difficulty,
    beatsPerBar: timeSignature.beatsPerBar,
    beatUnit: timeSignature.beatUnit,
    tempo: clamp(settings.tempo, TEMPO_RANGE.min, TEMPO_RANGE.max),
    bars: clamp(settings.bars, 1, 64),
    countInBars: clamp(settings.countInBars, 0, 2),
    scrollSpeed: clamp(settings.scrollSpeed, SCROLL_SPEED_RANGE.min, SCROLL_SPEED_RANGE.max),
    readingMode: READING_MODES.some((m) => m.id === settings.readingMode)
      ? settings.readingMode
      : DEFAULT_SETTINGS.readingMode,
    playbackMode: PLAYBACK_MODES.some((m) => m.id === settings.playbackMode)
      ? settings.playbackMode
      : DEFAULT_SETTINGS.playbackMode,
    backingLevel: clamp(settings.backingLevel, 0, 2),
    timingTolerance: clamp(
      settings.timingTolerance,
      TIMING_TOLERANCE_RANGE.min,
      TIMING_TOLERANCE_RANGE.max,
    ),
  };
}

/**
 * Forces settings back inside what this copy is entitled to.
 *
 * Applied when an exercise is built, not only when the settings screen is drawn.
 * The screen disables what is locked, but settings outlive it — saved before a
 * purchase lapsed, or edited in storage — and the generator should not be the
 * thing that has to notice.
 */
export function constrainToEntitlements(
  settings: Settings,
  entitlements: Entitlements,
): Settings {
  const limited = { ...settings };

  if (!entitlements.allKeys) limited.fifths = FREE_TIER.fifths;
  if (!entitlements.allLengths) limited.bars = Math.min(limited.bars, FREE_TIER.bars);
  if (!entitlements.allDifficulties && !FREE_TIER.difficultyIds.includes(limited.difficultyId)) {
    limited.difficultyId = FREE_TIER.difficultyIds[0];
  }
  if (!entitlements.allMaterial && !FREE_TIER.kinds.includes(limited.kind)) {
    limited.kind = FREE_TIER.kinds[0];
  }
  if (!entitlements.pagedReading) limited.readingMode = FREE_TIER.readingMode;
  if (!entitlements.fingeredPlayback && limited.playbackMode === 'fingered') {
    limited.playbackMode = FREE_TIER.playbackMode;
  }
  if (!entitlements.weakNoteDrilling) limited.weakNoteDrilling = false;

  return limited;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
