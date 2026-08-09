import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { metreFor } from '../domain/metre';
import { durationBeats } from '../domain/rhythm';
import { difficultyById } from './difficulty';
import { generateExercise } from './generate';
import { createRng } from './rng';
import { stitchThemes, themesFor, type StitchOptions } from './phrases';
import { tonicWindow } from './theme';
import { THEMES } from './themes';

function stitchOptions(overrides: Partial<StitchOptions> = {}): StitchOptions {
  return {
    instrument: instrumentById('eb-bass'),
    clef: 'treble',
    fifths: -3,
    difficulty: 'beginner',
    metre: metreFor(4, 4),
    count: 3,
    rng: createRng(1),
    ...overrides,
  };
}

describe('themesFor', () => {
  it('offers only themes of the right difficulty and metre', () => {
    const found = themesFor(stitchOptions({ difficulty: 'easy', metre: metreFor(3, 4) }));
    expect(found.map((t) => t.id)).toEqual(['waltz-step']);
  });

  it('offers nothing where the corpus has nothing, rather than the wrong thing', () => {
    // No theme is written in 3/4 at beginner. Silence is the honest answer, and
    // the caller falls back to generated material.
    expect(themesFor(stitchOptions({ difficulty: 'beginner', metre: metreFor(3, 4) }))).toEqual([]);
  });
});

describe('stitchThemes', () => {
  it('plays exactly the number of themes asked for, whole', () => {
    for (const count of [1, 2, 3, 4, 6]) {
      const stitched = stitchThemes(stitchOptions({ difficulty: 'medium', count }))!;
      expect(stitched.used, `${count} themes`).toHaveLength(count);

      // Length is a consequence of which themes were drawn, not a target: the
      // total is the sum of their own lengths and nothing is cut.
      const barsUsed = stitched.used
        .map((id) => THEMES.find((t) => t.id === id)!.bars)
        .reduce((a, b) => a + b, 0);
      expect(stitched.totalBeats, `${count} themes`).toBe(barsUsed * 4);
    }
  });

  /*
   * Selection is tested against a corpus of its own rather than the shipped
   * one, which holds a single theme per difficulty — so nothing in it can
   * exercise a rule about *choosing*. These stay useful as the real corpus
   * grows, and they say what the rules are meant to be while it has not.
   */
  const pair = [
    {
      id: 'alpha',
      name: 'Alpha',
      difficulty: 'medium',
      metres: [[4, 4]] as const,
      bars: 2,
      events: [{ degree: 1, beats: 4 }, { degree: 1, beats: 4 }],
    },
    {
      id: 'beta',
      name: 'Beta',
      difficulty: 'medium',
      metres: [[4, 4]] as const,
      bars: 2,
      events: [{ degree: 5, beats: 4 }, { degree: 5, beats: 4 }],
    },
  ];

  it('does not play the same theme twice running where there is a choice', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const stitched = stitchThemes(
        stitchOptions({ difficulty: 'medium', count: 20, corpus: pair, rng: createRng(seed) }),
      )!;
      expect(stitched.used.length, `seed ${seed}`).toBeGreaterThan(2);
      for (let i = 1; i < stitched.used.length; i++) {
        expect(stitched.used[i], `seed ${seed} repeated ${stitched.used[i]}`).not.toBe(
          stitched.used[i - 1],
        );
      }
    }
  });

  it('draws on both themes rather than settling on one', () => {
    const stitched = stitchThemes(
      stitchOptions({ difficulty: 'medium', count: 20, corpus: pair }),
    )!;
    expect(new Set(stitched.used)).toEqual(new Set(['alpha', 'beta']));
  });

  it('lays every theme end to end with no gap and no overlap', () => {
    const stitched = stitchThemes(stitchOptions({ difficulty: 'medium', count: 4 }))!;
    let expected = 0;
    for (const slot of stitched.slots) {
      expect(slot.startBeat).toBeCloseTo(expected, 9);
      expected += durationBeats(slot.duration);
    }
    expect(stitched.totalBeats).toBeCloseTo(expected, 9);
  });

  it('states a key only where it actually moves', () => {
    const stitched = stitchThemes(stitchOptions({ difficulty: 'medium', count: 4 }))!;
    for (let i = 1; i < stitched.keys.length; i++) {
      expect(stitched.keys[i].fifths, 'a change to the key already in force').not.toBe(
        stitched.keys[i - 1].fifths,
      );
      expect(stitched.keys[i].fromBeat).toBeGreaterThan(stitched.keys[i - 1].fromBeat);
    }
  });

  it('moves through the key set the player chose', () => {
    const stitched = stitchThemes(
      stitchOptions({ difficulty: 'medium', count: 4, keys: [-3, -1] }),
    )!;
    const reached = new Set(stitched.keys.map((k) => k.fifths));
    expect(reached.has(-3)).toBe(true);
    expect(reached.has(-1)).toBe(true);
  });

  it('lands every key change on a bar line, which is the only place one may land', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const stitched = stitchThemes(
        stitchOptions({ difficulty: 'expert', count: 6, keys: [-3, -1, 0], rng: createRng(seed) }),
      );
      if (!stitched) continue;
      for (const key of stitched.keys) {
        expect(key.fromBeat % 4, `seed ${seed}, beat ${key.fromBeat}`).toBe(0);
      }
    }
  });
});

describe('themes through the generator', () => {
  function themed(overrides: Record<string, unknown> = {}) {
    return generateExercise({
      instrument: instrumentById('eb-bass'),
      clef: 'treble',
      fifths: -3,
      difficulty: difficultyById('beginner'),
      kind: 'themes',
      bars: 16,
      themeCount: 2,
      cycles: 2,
      metre: metreFor(4, 4),
      seed: 3,
      ...overrides,
    });
  }

  it('opens on the tonic, in the register the instrument reads it in', () => {
    /*
     * A ruling from playing: the same tune should sit in the same part of the
     * instrument whichever key it is played in, and the tonic is what a player
     * feels the music sitting on. On a treble-clef tuba part that window is
     * low G up to the G the clef curls around.
     */
    const [low, high] = tonicWindow(instrumentById('eb-bass'), 'treble');
    for (const fifths of [-5, -3, -1, 0, 2, 4]) {
      const exercise = themed({ fifths });
      const opening = exercise.notes[0].writtenMidi;
      expect(opening, `opening note in ${fifths} fifths`).toBeGreaterThanOrEqual(low);
      expect(opening, `opening note in ${fifths} fifths`).toBeLessThanOrEqual(high);
    }
  });

  it('falls back to generated material where the corpus has nothing', () => {
    // Nothing is written in 5/4, and an exercise is still owed. The fallback is
    // free material, so it is measured in bars again.
    const exercise = themed({ metre: metreFor(5, 4), bars: 8 });
    expect(exercise.notes.length).toBeGreaterThan(0);
    expect(exercise.totalBeats).toBe(8 * exercise.metre.barBeats);
  });

  it('is reproducible from its seed, like everything else generated', () => {
    expect(themed().notes.map((n) => n.writtenMidi)).toEqual(
      themed().notes.map((n) => n.writtenMidi),
    );
  });

  it('leaves sight-reading to the random walk it always had', () => {
    /*
     * Themes were wired into sight-reading first and it never sat right: a
     * theme is a fixed length, and asking for twelve bars of them asks for one
     * and a half of something written to be played whole. Sight-reading is
     * measured in bars, exactly, as free material always has been.
     */
    for (const bars of [4, 12, 16]) {
      const exercise = themed({ kind: 'phrases', bars, difficulty: difficultyById('medium') });
      expect(exercise.totalBeats, `${bars} bars`).toBe(bars * exercise.metre.barBeats);
    }
  });
});
