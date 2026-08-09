import { describe, expect, it } from 'vitest';
import { instrumentById, writtenRange } from '../domain/instruments';
import { keyAt } from '../domain/keys';
import { metreFor } from '../domain/metre';
import { midiOf } from '../domain/pitch';
import { exerciseFromTheme, realiseTheme, validateTheme, type Theme } from './theme';
import { THEMES } from './themes';

const EB_BASS = { instrument: instrumentById('eb-bass'), clef: 'treble' as const };

function themeOf(overrides: Partial<Theme>): Theme {
  return {
    id: 'test',
    name: 'Test',
    difficulty: 'easy',
    metres: [[4, 4]],
    bars: 1,
    events: [{ degree: 1, beats: 4 }],
    ...overrides,
  };
}

describe('validateTheme', () => {
  /*
   * The corpus is authored by hand or by a model, and neither can be trusted to
   * count. This is the guard that keeps the data honest, so it is worth knowing
   * it fails on the things it claims to.
   */
  it('passes every theme in the corpus', () => {
    for (const theme of THEMES) {
      expect(validateTheme(theme), theme.id).toEqual([]);
    }
  });

  it('catches bars that do not add up', () => {
    const problems = validateTheme(themeOf({ events: [{ degree: 1, beats: 3 }] }));
    expect(problems.join()).toMatch(/3 beats but 1 bars of 4\/4 is 4/);
  });

  it('catches a length no note can be written as', () => {
    // Five crotchets is not a note. It is two, tied — which is the point.
    const problems = validateTheme(themeOf({ bars: 5, events: [{ degree: 1, beats: 20 }] }));
    expect(problems.join()).toMatch(/cannot be written/);
  });

  it('catches a note crossing a bar line', () => {
    const problems = validateTheme(
      themeOf({
        bars: 2,
        events: [
          { degree: 1, beats: 2 },
          // A semibreve starting on beat three spills into the next bar.
          { degree: 1, beats: 4 },
          { degree: 1, beats: 2 },
        ],
      }),
    );
    expect(problems.join()).toMatch(/crosses a bar line/);
  });

  it('catches an unstable end, since themes abut', () => {
    const problems = validateTheme(
      themeOf({ events: [{ degree: 1, beats: 2 }, { degree: 7, beats: 2 }] }),
    );
    expect(problems.join()).toMatch(/last note is degree 7/);
  });

  it('catches a tie to a different note, which is a slur', () => {
    const problems = validateTheme(
      themeOf({
        bars: 2,
        events: [
          { degree: 1, beats: 4, tied: true },
          { degree: 3, beats: 4 },
        ],
      }),
    );
    expect(problems.join()).toMatch(/tied to a different note/);
  });

  it('catches a key change that is not inside the theme', () => {
    const problems = validateTheme(themeOf({ keyChanges: [{ atBar: 4, fifths: 1 }] }));
    expect(problems.join()).toMatch(/not inside the theme/);
  });
});

describe('realiseTheme', () => {
  const metre = metreFor(4, 4);

  it('spells a degree into whatever key it is played in', () => {
    // Degree 3 of E flat is G; of D major it is F sharp. Same theme, and the
    // whole reason a theme is stored in degrees.
    const theme = themeOf({ events: [{ degree: 3, beats: 4 }] });

    const inEFlat = exerciseFromTheme(theme, { ...EB_BASS, fifths: -3, metre })!;
    const inD = exerciseFromTheme(theme, { ...EB_BASS, fifths: 2, metre })!;

    expect(inEFlat.notes[0].pitch.letter).toBe('G');
    expect(inEFlat.notes[0].pitch.alter).toBe(0);
    expect(inD.notes[0].pitch.letter).toBe('F');
    expect(inD.notes[0].pitch.alter).toBe(1);
  });

  it('keeps the written pitch and the spelling agreeing', () => {
    for (const theme of THEMES) {
      const exercise = exerciseFromTheme(theme, {
        ...EB_BASS,
        fifths: -3,
        metre: metreFor(...theme.metres[0]),
      });
      expect(exercise, theme.id).not.toBeNull();
      for (const note of exercise!.notes) {
        expect(midiOf(note.pitch), `${theme.id} ${note.startBeat}`).toBe(note.writtenMidi);
      }
    }
  });

  it('places a key change relative to the key it is played in', () => {
    // Up a fifth from E flat is B flat; from C it is G. The delta travels, the
    // absolute key does not.
    const theme = themeOf({
      bars: 2,
      keyChanges: [{ atBar: 2, fifths: 1 }],
      events: [{ degree: 1, beats: 4 }, { degree: 1, beats: 4 }],
    });

    const fromEFlat = realiseTheme(theme, { ...EB_BASS, fifths: -3, metre })!;
    const fromC = realiseTheme(theme, { ...EB_BASS, fifths: 0, metre })!;

    expect(keyAt(fromEFlat.keys, 4)).toBe(-2);
    expect(keyAt(fromC.keys, 4)).toBe(1);
    // And it lands on the bar line, which is the only place one may land.
    expect(fromEFlat.keys[1].fromBeat).toBe(4);
  });

  it('keeps a key inside the seven signatures anyone writes', () => {
    // F sharp major is six sharps. Lift a fifth twice and the arithmetic
    // arrives at eight, which is a real key that no part is ever printed in —
    // G sharp major. Written the other way round it is A flat, four flats.
    const theme = themeOf({
      bars: 3,
      keyChanges: [{ atBar: 2, fifths: 1 }, { atBar: 3, fifths: 1 }],
      events: [
        { degree: 1, beats: 4 },
        { degree: 1, beats: 4 },
        { degree: 1, beats: 4 },
      ],
    });
    const realised = realiseTheme(theme, { ...EB_BASS, fifths: 6, metre })!;
    for (const key of realised.keys) {
      expect(Math.abs(key.fifths)).toBeLessThanOrEqual(7);
    }
    expect(keyAt(realised.keys, 4)).toBe(7);
    expect(keyAt(realised.keys, 8)).toBe(-4);
  });

  it('refuses a theme that will not fit the compass rather than forcing it', () => {
    const tooWide = themeOf({
      bars: 2,
      events: [
        { degree: 1, beats: 4, octave: -3 },
        { degree: 1, beats: 4, octave: 3 },
      ],
    });
    expect(realiseTheme(tooWide, { ...EB_BASS, fifths: 0, metre })).toBeNull();
  });

  it('lays every corpus theme inside the compass it is realised for', () => {
    for (const theme of THEMES) {
      for (const id of ['eb-bass', 'cornet', 'euphonium']) {
        const instrument = instrumentById(id);
        const realised = realiseTheme(theme, {
          instrument,
          clef: 'treble',
          fifths: -3,
          metre: metreFor(...theme.metres[0]),
        });
        // Null is a legitimate answer — the caller picks another theme — but a
        // realised one must actually be playable.
        if (!realised) continue;
        const [low, high] = writtenRange(instrument, 'treble');
        for (const midi of realised.pitches) {
          expect(midi, `${theme.id} on ${id}`).toBeGreaterThanOrEqual(low);
          expect(midi, `${theme.id} on ${id}`).toBeLessThanOrEqual(high);
        }
      }
    }
  });

  it('carries a tie across the bar line as two notes, not one long one', () => {
    const theme = THEMES.find((t) => t.id === 'dotted-conversation')!;
    const exercise = exerciseFromTheme(theme, { ...EB_BASS, fifths: -3, metre })!;
    const heads = exercise.notes.filter((note) => note.tiedToNext);

    expect(heads).toHaveLength(1);
    const head = exercise.notes.indexOf(heads[0]);
    const tail = exercise.notes[head + 1];
    expect(tail.writtenMidi).toBe(heads[0].writtenMidi);
    // The far end takes no accidental of its own: it is one sound continuing.
    expect(tail.showAccidental).toBe(false);
  });
});
