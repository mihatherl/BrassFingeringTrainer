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
import { TEMPO_RANGE } from '../domain/tempo';
import { CONDUCTOR_STYLE_RANGE } from '../render/conductor';
import type { ExerciseKind } from '../exercise/types';
import type { PatternRegister } from '../exercise/generate';

// Re-exported from the domain, where the tempo plan clamps against the same
// figures; the settings screen was this range's first customer, not its owner.
export { TEMPO_RANGE };
// The same arrangement for the conductor's style: `render/conductor.ts` decides
// what the number means, and this is where it gets stored.
export { CONDUCTOR_STYLE_RANGE };

export interface Settings {
  instrumentId: string;
  clef: Clef;
  /** Written key signature the exercise opens in, on the circle of fifths. */
  fifths: number;
  /**
   * Every key the exercise may move through, `fifths` among them.
   *
   * One entry means no key changes, which is the default and what most
   * practice wants. More than one and the generator modulates between them,
   * ordering them by closeness on the circle of fifths so the joins sound like
   * music rather than like a list.
   */
  keySet: number[];
  tempo: number;
  /**
   * Whether the tempo moves at the material's boundaries: a new speed where
   * one theme ends and the next begins, and eventually rits and holds.
   *
   * Off by default for the same reason the conductor is — an installed app
   * should not start taking liberties with the beat because it updated.
   */
  variableTempo: boolean;
  difficultyId: string;
  kind: ExerciseKind;
  /** Themes played end to end, for the Themes kind. Ignored by everything else. */
  themeCount: number;
  /** How long free material runs. Scales and arpeggios use `cycles` instead. */
  bars: number;
  /**
   * How many times a scale or arpeggio is played through, up and back down.
   *
   * Patterns are measured in their own unit rather than in bars: a cycle is
   * the thing being practised, and how many bars it fills is a consequence of
   * how many notes it has. Asking for bars is what used to leave a scale
   * stopping half way up.
   */
  cycles: number;
  /**
   * Which end of the instrument scales and arpeggios are practised in, where
   * the compass leaves a choice. Ignored by everything else.
   */
  register: PatternRegister;
  beatsPerBar: number;
  beatUnit: number;
  countInBars: number;
  metronomeEnabled: boolean;
  /**
   * Whether the conductor beats the metre beside the recent notes.
   *
   * Off by default. It is the newest thing on the screen and an installed app
   * should not sprout a moving object next to the notation because it updated;
   * anyone who wants it can ask for it, as with the metronome.
   */
  conductorEnabled: boolean;
  /**
   * How lively the conductor's gesture is, from smooth through to marcato.
   *
   * A difficulty axis as much as a style one, which is why it is a setting and
   * not a constant. A conductor beating a lyrical phrase uses a smooth,
   * continuous gesture with little rebound; one driving a march gives a sharp
   * ictus and lets the hand stop between beats. Both are correct conducting and
   * a player has to read either — and the smooth one is markedly harder,
   * because finding the beat in a vague gesture is a skill in itself.
   */
  conductorStyle: number;
  playbackMode: PlaybackMode;
  /**
   * Multiplies the window either side of the beat within which a fingering
   * counts, where 1 is the strict default.
   */
  timingTolerance: number;
  weakNoteDrilling: boolean;
  /**
   * Whether to print the fingering above notes the player keeps getting wrong.
   * A prompt where the trouble is, not a fingering chart that happens to scroll.
   */
  fingeringHints: boolean;
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
      'Notes stay put and the page turns as you approach the end. Nothing in the music marks the beat — you count for yourself, as you would from a part, against the metronome or the conductor. Each bar reveals how you did only once you finish it, so you know which bar you are in without being told the beat.',
  },
];

export const DEFAULT_SETTINGS: Settings = {
  instrumentId: 'eb-bass',
  clef: 'treble',
  fifths: -3, // Eb major — brass band home turf
  // Just the one, so nothing changes key until it is asked to.
  keySet: [-3],
  tempo: 80,
  variableTempo: false,
  difficultyId: 'easy',
  kind: 'random',
  themeCount: 2,
  bars: 8,
  cycles: 4,
  register: 'middle',
  beatsPerBar: 4,
  beatUnit: 4,
  countInBars: 1,
  metronomeEnabled: true,
  conductorEnabled: false,
  // What the spike's slider calls "lively", which is where the fixed value sat
  // for as long as there was one: clearly beaten, without being a march.
  conductorStyle: 0.55,
  playbackMode: 'reference',
  timingTolerance: 1.5,
  weakNoteDrilling: true,
  fingeringHints: true,
  scrollSpeed: 110,
  readingMode: 'scrolling',
};

const STORAGE_KEY = 'brass-trainer:settings';

export const BARS_OPTIONS = [4, 8, 12, 16, 24] as const;
/**
 * Times through a scale or arpeggio.
 *
 * Smaller numbers than the bar counts beside them, and deliberately: one cycle
 * of a two-octave scale is already eight bars, so four times through is a
 * substantial exercise rather than a short one.
 */
export const CYCLE_OPTIONS = [1, 2, 4, 8] as const;

export const REGISTERS: ReadonlyArray<{ id: PatternRegister; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'middle', label: 'Middle' },
  { id: 'high', label: 'High' },
];

/**
 * How many themes a Themes exercise plays, end to end.
 *
 * Its own field rather than borrowing `cycles`, which means times through one
 * shape. A theme is not played twice over; the next one is a different tune,
 * and calling both "cycles" is how a numerator ends up mistaken for a bar
 * length. See `metre.ts` for the version of that mistake this project has
 * already made once.
 */
export const THEME_OPTIONS = [1, 2, 3, 4, 6] as const;

/**
 * Most keys one exercise may move through.
 *
 * Four is a drill; more is a tour. It also bounds a real cost: the scrolling
 * header is sized for the widest key in the set and holds that width
 * throughout, so a set reaching seven sharps spends the room on every bar of
 * the exercise whether it gets there or not.
 */
export const MAX_KEYS_IN_PLAY = 4;
/**
 * The metres on offer.
 *
 * 6/8 is compound and behaves differently everywhere it matters: two beats
 * to a bar rather than six, quavers beamed in threes, the metronome on the
 * dotted crotchet, and rhythm generated a whole pulse at a time. All of that
 * was built and tested well before this list offered it — see `metre.ts`,
 * which was written for exactly this and says so. A brass band player meets
 * six-eight in marches before almost anything else, so its absence here was
 * the most conspicuous gap on the screen.
 */
export const TIME_SIGNATURES = [
  { beatsPerBar: 4, beatUnit: 4, label: '4/4' },
  { beatsPerBar: 3, beatUnit: 4, label: '3/4' },
  { beatsPerBar: 2, beatUnit: 4, label: '2/4' },
  { beatsPerBar: 6, beatUnit: 8, label: '6/8' },
] as const;

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

  /*
   * The set always holds the key the exercise starts in, whatever a stored
   * file says.
   *
   * That single rule does three jobs: it repairs a set edited to nonsense, it
   * keeps the set honest after the starting key is changed, and it migrates a
   * settings file written before the set existed — where the merge over the
   * defaults would otherwise leave someone playing in B flat with E flat's
   * default set.
   */
  const chosen = Array.isArray(settings.keySet) ? settings.keySet : [];
  const keySet = [
    fifths,
    ...chosen.filter((f) => f !== fifths && MAJOR_KEYS.some((k) => k.fifths === f)),
  ]
    .filter((f, index, all) => all.indexOf(f) === index)
    .slice(0, MAX_KEYS_IN_PLAY);

  const timeSignature =
    TIME_SIGNATURES.find(
      (t) => t.beatsPerBar === settings.beatsPerBar && t.beatUnit === settings.beatUnit,
    ) ?? TIME_SIGNATURES[0];

  return {
    ...settings,
    instrumentId: instrument.id,
    clef,
    fifths,
    keySet,
    difficultyId: difficulty,
    beatsPerBar: timeSignature.beatsPerBar,
    beatUnit: timeSignature.beatUnit,
    tempo: clamp(settings.tempo, TEMPO_RANGE.min, TEMPO_RANGE.max),
    // Coerced to a real boolean: a settings file written by an older version
    // has nothing here, and the merge above must land on "off".
    variableTempo: settings.variableTempo === true,
    bars: clamp(settings.bars, 1, 64),
    cycles: clamp(settings.cycles, 1, 16),
    register: REGISTERS.some((r) => r.id === settings.register)
      ? settings.register
      : DEFAULT_SETTINGS.register,
    themeCount: clamp(settings.themeCount, 1, 8),
    countInBars: clamp(settings.countInBars, 0, 2),
    scrollSpeed: clamp(settings.scrollSpeed, SCROLL_SPEED_RANGE.min, SCROLL_SPEED_RANGE.max),
    readingMode: READING_MODES.some((m) => m.id === settings.readingMode)
      ? settings.readingMode
      : DEFAULT_SETTINGS.readingMode,
    playbackMode: PLAYBACK_MODES.some((m) => m.id === settings.playbackMode)
      ? settings.playbackMode
      : DEFAULT_SETTINGS.playbackMode,
    timingTolerance: clamp(
      settings.timingTolerance,
      TIMING_TOLERANCE_RANGE.min,
      TIMING_TOLERANCE_RANGE.max,
    ),
    conductorStyle: clamp(
      settings.conductorStyle,
      CONDUCTOR_STYLE_RANGE.min,
      CONDUCTOR_STYLE_RANGE.max,
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

  if (!entitlements.allKeys) {
    // Key changes ride on the same entitlement as key choice, which needs no
    // gate of its own: a copy allowed only one key has nothing to change to.
    limited.fifths = FREE_TIER.fifths;
    limited.keySet = [FREE_TIER.fifths];
  }
  if (!entitlements.allLengths) limited.bars = Math.min(limited.bars, FREE_TIER.bars);
  if (!entitlements.allDifficulties && !FREE_TIER.difficultyIds.includes(limited.difficultyId)) {
    limited.difficultyId = FREE_TIER.difficultyIds[0];
  }
  if (!entitlements.allMaterial && !FREE_TIER.kinds.includes(limited.kind)) {
    limited.kind = FREE_TIER.kinds[0];
  }
  if (!entitlements.pagedReading) limited.readingMode = FREE_TIER.readingMode;
  if (!entitlements.weakNoteDrilling) limited.weakNoteDrilling = false;

  return limited;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
