import { describe, expect, it } from 'vitest';
import { instrumentById, writtenRange } from '../domain/instruments';
import { metreFor } from '../domain/metre';
import { durationBeats } from '../domain/rhythm';
import { difficultyById } from './difficulty';
import { generateExercise } from './generate';
import { createRng } from './rng';
import { stitchThemes, themesFor, type StitchOptions } from './phrases';
import { exerciseFromTheme, tonicWindow } from './theme';
import { themeById, THEMES } from './themes';

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
    /*
     * Five-four, because nothing is written in it and nothing will be while the
     * app does not offer it. This used to name beginner in 3/4, which was a real
     * gap at the time and has since been filled — a test that encodes a gap
     * fails the day the gap closes, which is the wrong thing to be told.
     */
    expect(themesFor(stitchOptions({ difficulty: 'beginner', metre: metreFor(5, 4) }))).toEqual([]);
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

  it('reports where each theme begins, which is where a tempo may step', () => {
    const stitched = stitchThemes(stitchOptions({ difficulty: 'medium', count: 3 }))!;
    expect(stitched.starts).toHaveLength(stitched.used.length);
    expect(stitched.starts[0]).toBe(0);

    // Each start is the sum of the lengths before it, and lands on a bar line.
    let expected = 0;
    stitched.used.forEach((id, index) => {
      expect(stitched.starts[index], id).toBe(expected);
      expect(expected % 4, `${id} on a bar line`).toBe(0);
      expected += THEMES.find((t) => t.id === id)!.bars * 4;
    });
  });

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

  it('puts the tonic in the register the instrument reads it in', () => {
    /*
     * A ruling from playing: the same tune should sit in the same part of the
     * instrument whichever key it is played in, and the tonic is what a player
     * feels the music sitting on. On a treble-clef tuba part that window is
     * low G up to the G the clef curls around.
     *
     * It is the *tonic* that is placed, not the first note. A theme may open on
     * the third or the fifth — those are stable enough to abut — so its opening
     * note can sit a fifth above the window and be correctly placed. Checked
     * against a theme that does open on the tonic, where the two coincide and
     * the assertion means what it says.
     */
    const instrument = instrumentById('eb-bass');
    const [low, high] = tonicWindow(instrument, 'treble');
    const opensOnTheTonic = themeById('plain-answer')!;

    for (const fifths of [-5, -3, -1, 0, 2, 4]) {
      const exercise = exerciseFromTheme(opensOnTheTonic, {
        instrument,
        clef: 'treble',
        fifths,
        metre: metreFor(4, 4),
      })!;
      const tonic = exercise.notes[0].writtenMidi;
      expect(tonic, `tonic in ${fifths} fifths`).toBeGreaterThanOrEqual(low);
      expect(tonic, `tonic in ${fifths} fifths`).toBeLessThanOrEqual(high);
    }
  });

  it('keeps every stitched note inside the compass, whatever it opens on', () => {
    // The window places the tonic; the compass is the hard limit, and a theme
    // that opens on the fifth still has to be playable end to end.
    const instrument = instrumentById('eb-bass');
    const [lowest, highest] = writtenRange(instrument, 'treble');
    for (const difficulty of ['beginner', 'easy', 'medium', 'hard', 'expert']) {
      for (const fifths of [-5, -3, 0, 2, 4]) {
        const exercise = themed({ fifths, difficulty: difficultyById(difficulty), themeCount: 3 });
        for (const note of exercise.notes) {
          expect(note.writtenMidi, `${difficulty} in ${fifths}`).toBeGreaterThanOrEqual(lowest);
          expect(note.writtenMidi, `${difficulty} in ${fifths}`).toBeLessThanOrEqual(highest);
        }
      }
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
