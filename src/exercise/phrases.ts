/**
 * Sight-reading material, stitched from authored themes.
 *
 * Themes are laid end to end until the asked-for length is reached. The join is
 * why every theme starts and ends on a stable degree: two arbitrary phrases
 * butted together sound like a mistake, and one ending on the leading note
 * followed by one starting on the sixth sounds like a page turned two bars
 * early.
 *
 * A theme keeps whatever key it arrived in, and its own changes move it on from
 * there — so a set of themes chains harmonically rather than each one resetting
 * to the key the player picked. The exercise still opens in that key.
 *
 * Length works the way a pattern's does rather than the way free material's
 * does: a theme is a fixed shape, and how many bars it occupies is its own
 * business. Asking for eight bars therefore means "at least eight", stopping at
 * the end of whichever theme passes the mark, because cutting a phrase off mid
 * sentence is the one thing this material exists not to do.
 */

import type { Clef, Instrument } from '../domain/instruments';
import type { KeyChange } from '../domain/keys';
import type { Metre } from '../domain/metre';
import type { Slot } from './assemble';
import type { Rng } from './rng';
import { realiseTheme, type Theme } from './theme';
import { THEMES } from './themes';

/** Bars a key is given before another may take over. Matches free material. */
const MIN_BARS_PER_KEY = 4;

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
  /** Bars asked for. The result meets or passes it, never stops short. */
  bars: number;
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
export function themesFor(options: Omit<StitchOptions, 'rng' | 'bars' | 'keys'>): Theme[] {
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

  const wanted = options.bars * options.metre.barBeats;
  const set = options.keys?.length ? options.keys : [options.fifths];
  const minKeyBeats = MIN_BARS_PER_KEY * options.metre.barBeats;

  let beat = 0;
  let fifths = options.fifths;
  let lastChangeBeat = 0;
  let last: string | undefined;

  while (beat < wanted - 1e-9) {
    /*
     * Where the set has got to by this point in the exercise, changing only on
     * a theme boundary — which is a bar line, the only place a key change may
     * land. Spread by position rather than one key per theme, so a set of four
     * is not exhausted in the first third, and never sooner than four bars
     * after the last change: a set too large for the exercise uses fewer of its
     * keys rather than hurrying through them.
     */
    const target = set[Math.min(set.length - 1, Math.floor((beat / wanted) * set.length))];
    if (target !== fifths && beat - lastChangeBeat >= minKeyBeats - 1e-9) {
      fifths = target;
      lastChangeBeat = beat;
    }

    /*
     * Not the same theme twice running where there is a choice. Repetition
     * inside a theme is the point of the material; repetition *of* a theme is
     * how eight bars of practice becomes the same eight bars again, and the
     * player stops reading and starts remembering.
     */
    const choices = available.length > 1 ? available.filter((t) => t.id !== last) : available;
    const theme = options.rng.pick(choices);

    const realised = realiseTheme(theme, {
      instrument: options.instrument,
      clef: options.clef,
      fifths,
      metre: options.metre,
      fromBeat: beat,
    });
    // It fitted when the list was built, in the key the exercise opened in. A
    // later theme may arrive in a key that puts it out of reach, and skipping
    // it is better than forcing it.
    if (!realised) {
      if (choices.length === 1) break;
      continue;
    }

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

    fifths = realised.keys[realised.keys.length - 1].fifths;
    beat += realised.beats;
    last = theme.id;
  }

  if (slots.length === 0) return null;
  return { slots, pitches, keys, totalBeats: beat, used };
}
