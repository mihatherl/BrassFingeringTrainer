/**
 * Sight-reading material, stitched from authored themes.
 *
 * Themes are laid end to end until the asked-for length is reached. The join is
 * why every theme starts and ends on a stable degree: two arbitrary phrases
 * butted together sound like a mistake, and one ending on the leading note
 * followed by one starting on the sixth sounds like a page turned two bars
 * early.
 *
 * Length is a count of themes, not a number of bars — the same reason a pattern
 * is measured in cycles. A theme is a written shape and how many bars it fills
 * is its own business, so asking for twelve bars of them asks for one and a
 * half of something meant to be played whole.
 *
 * The key set is dealt across those themes in contiguous blocks, exactly as a
 * pattern deals its keys across cycles, and a change lands only where one theme
 * ends and the next begins. Changing key inside a tune that was not written to
 * do so is a signature laid over somebody else's phrase.
 */

import type { Clef, Instrument } from '../domain/instruments';
import type { KeyChange } from '../domain/keys';
import type { Metre } from '../domain/metre';
import { snapBeat } from '../domain/rhythm';
import type { Slot } from './assemble';
import type { Rng } from './rng';
import { realiseTheme, type Theme } from './theme';
import { THEMES } from './themes';

export interface StitchOptions {
  instrument: Instrument;
  clef: Clef;
  /** Key the first theme opens in; later themes carry on from where it ends. */
  fifths: number;
  /**
   * Every key the exercise may move through, closest-ordered, `fifths` first.
   *
   * The set governs the joins and a theme governs its own inside: each theme
   * opens in the key the set has reached, and whatever it does internally is
   * part of the tune. Without this a player who picks four keys and
   * sight-reading gets none of them, which is worse than not offering it.
   */
  keys?: readonly number[];
  difficulty: string;
  metre: Metre;
  /** Whole themes to play, end to end. */
  count: number;
  rng: Rng;
  /**
   * The themes to draw from. Defaults to the shipped corpus.
   *
   * Injectable because selection is the part with rules in it — do not repeat,
   * carry the key on, skip what will not fit — and while the corpus holds one
   * theme per difficulty none of those rules has anything to choose between.
   * Tests supply their own so the rules are exercised rather than assumed.
   */
  corpus?: readonly Theme[];
}

export interface StitchedPhrases {
  slots: Slot[];
  pitches: number[];
  keys: KeyChange[];
  totalBeats: number;
  /** Which themes were used, in order. For tests and for the results screen. */
  used: string[];
}

/** Themes this instrument, difficulty and metre can actually take. */
export function themesFor(options: Omit<StitchOptions, 'rng' | 'count' | 'keys'>): Theme[] {
  const { beatsPerBar, beatUnit } = options.metre;
  return (options.corpus ?? THEMES).filter((theme) => {
    if (theme.difficulty !== options.difficulty) return false;
    if (!theme.metres.some(([n, d]) => n === beatsPerBar && d === beatUnit)) return false;
    // Range is asked of the real placement rather than guessed at: a theme is a
    // fixed shape, so a compass that will not hold it means another theme.
    return realiseTheme(theme, { ...options, metre: options.metre }) !== null;
  });
}

/**
 * Lays themes end to end until the asked-for length is met.
 *
 * Returns null when nothing fits, which is a real answer and not a failure:
 * the caller falls back to generated material, the way a pattern that will not
 * fit the instrument does.
 */
export function stitchThemes(options: StitchOptions): StitchedPhrases | null {
  const available = themesFor(options);
  if (available.length === 0) return null;

  const slots: Slot[] = [];
  const pitches: number[] = [];
  const keys: KeyChange[] = [];
  const used: string[] = [];

  const set = options.keys?.length ? options.keys : [options.fifths];

  let beat = 0;
  let fifths = options.fifths;
  let last: string | undefined;

  for (let played = 0; played < options.count; played++) {
    /*
     * Which key this theme is played in.
     *
     * Dealt across the themes in contiguous blocks, exactly as a pattern deals
     * its keys across cycles: a key is finished with before the next is taken
     * up, and a set too large for the exercise simply uses fewer of its keys
     * rather than hurrying through them. A theme is where a key change may
     * land, and a theme is the only place — the tune is a whole thought, and
     * changing key inside one that was not written to would be a change of
     * signature laid over somebody else's phrase.
     */
    fifths = set[Math.floor((played * set.length) / options.count)];

    const place = (theme: Theme) =>
      realiseTheme(theme, {
        instrument: options.instrument,
        clef: options.clef,
        fifths,
        metre: options.metre,
        fromBeat: beat,
      });

    /*
     * Only themes that fit *this* key. The list was built against the key the
     * exercise opens in, and a later key can put a wide theme out of reach —
     * so it is asked again rather than assumed, and a theme that will not go is
     * never picked instead of being picked and skipped, which would quietly
     * spend one of the themes asked for.
     */
    const fitting = available.filter((theme) => place(theme) !== null);
    if (fitting.length === 0) break;

    /*
     * Not the same theme twice running where there is a choice. Repetition
     * inside a theme is the point of the material; repetition *of* a theme is
     * how eight bars of practice becomes the same eight bars again, and the
     * player stops reading and starts remembering.
     */
    const choices = fitting.length > 1 ? fitting.filter((t) => t.id !== last) : fitting;
    const theme = options.rng.pick(choices);
    const realised = place(theme)!;

    slots.push(...realised.slots);
    pitches.push(...realised.pitches);
    /*
     * Kept only where the key actually moves. A theme states the key it opens
     * in, which is usually the one the previous theme left off in — and a
     * change to the key already in force draws a double bar and a signature
     * restating what is already true. Dropping the first entry outright is the
     * obvious version of this and is wrong: when the set moves the key at a
     * join, that first entry *is* the change.
     */
    for (const key of realised.keys) {
      if (keys[keys.length - 1]?.fifths !== key.fifths) keys.push(key);
    }
    used.push(theme.id);
    // Every theme's length is exact; the running total has to stay so, or the
    // join after a theme of triplets is no longer a bar line.
    beat = snapBeat(beat + realised.beats);
    last = theme.id;
  }

  if (slots.length === 0) return null;
  return { slots, pitches, keys, totalBeats: beat, used };
}
