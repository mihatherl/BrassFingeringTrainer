import { metreAt, metreFor } from '../domain/metre';
import { describe, expect, it } from 'vitest';
import { isPlayable } from '../domain/fingering';
import { instrumentById, soundingFromWritten, writtenRange } from '../domain/instruments';
import { keyAt, needsAccidental, spellInKey, tonicPitchClass } from '../domain/keys';
import { durationBeats } from '../domain/rhythm';
import { DIFFICULTIES, difficultyById } from './difficulty';
import {
  defaultLengthFor,
  DRILLS,
  generateExercise,
  patternSpanFor,
  type Drill,
  type DrillId,
  type GenerateOptions,
} from './generate';
import { isTieContinuation } from './ties';
import { EXERCISE_KINDS, type ExerciseKind } from './types';

const ebBass = instrumentById('eb-bass');

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    instrument: ebBass,
    clef: 'treble',
    fifths: -3, // Eb major
    difficulty: difficultyById('medium'),
    kind: 'phrases',
    bars: 8,
    cycles: 2,
    themeCount: 2,
    metre: metreFor(4, 4),
    seed: 12345,
    ...overrides,
  };
}

const KINDS: ExerciseKind[] = ['drills', 'phrases'];

/*
 * The two shapes a drill comes in, for tests about shape-level behaviour —
 * rhythm pools, spans, metre — where one scale and one chord stand for the
 * rest. Tests about what the notes *are* run over the whole of `DRILLS`.
 */
const SHAPES: DrillId[] = ['major-scale', 'tonic-arpeggio'];

/** Every semitone above the root a drill visits, up or down, within `span`. */
const tonesOf = (drill: Drill, span = Infinity): number[] =>
  [...drill.up, ...(drill.down ?? [])]
    .map((n) => n.semitones)
    .filter((s) => s <= span)
    .filter((s, i, all) => all.indexOf(s) === i);

/** The drills whose every note is in the key: all but the two minor scales. */
const DIATONIC = DRILLS.filter((d) =>
  tonesOf(d).every((s) => [0, 2, 4, 5, 7, 9, 11].includes((d.rootDegree + s) % 12)),
);

describe('exercise generation', () => {
  it('is reproducible from its seed', () => {
    const a = generateExercise(options());
    const b = generateExercise(options());
    expect(a.notes).toEqual(b.notes);
  });

  it('produces different material for different seeds', () => {
    const a = generateExercise(options({ seed: 1 }));
    const b = generateExercise(options({ seed: 2 }));
    expect(a.notes.map((n) => n.writtenMidi)).not.toEqual(b.notes.map((n) => n.writtenMidi));
  });

  it.each(KINDS)('fills every bar exactly (%s)', (kind) => {
    const exercise = generateExercise(options({ kind }));
    const events = [...exercise.notes, ...exercise.rests];

    // Counted from the exercise rather than from the bars asked for: a scale
    // is measured in cycles, so how many bars it runs to is its own business.
    const bars = exercise.totalBeats / metreAt(exercise.metres, 0).barBeats;
    expect(bars, 'a whole number of bars').toBe(Math.round(bars));
    expect(bars).toBeGreaterThan(0);

    for (let bar = 0; bar < bars; bar++) {
      const inBar = events.filter(
        (e) => e.startBeat >= bar * 4 && e.startBeat < (bar + 1) * 4,
      );
      const total = inBar.reduce((sum, e) => sum + durationBeats(e.duration), 0);
      expect(total, `bar ${bar + 1}`).toBeCloseTo(4, 6);
    }
  });

  it.each(KINDS)('only generates notes the instrument can play (%s)', (kind) => {
    const exercise = generateExercise(options({ kind }));
    const [low, high] = writtenRange(ebBass, 'treble');

    for (const note of exercise.notes) {
      expect(note.writtenMidi).toBeGreaterThanOrEqual(low);
      expect(note.writtenMidi).toBeLessThanOrEqual(high);
      expect(isPlayable(note.soundingMidi, ebBass)).toBe(true);
      expect(note.acceptedMasks.length).toBeGreaterThan(0);
    }
  });

  it('always gives every note at least one accepted fingering, across every setting', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const kind of KINDS) {
        for (const fifths of [-5, -3, 0, 2, 4]) {
          const exercise = generateExercise(
            options({ difficulty, kind, fifths, seed: difficulty.id.length * 31 + fifths }),
          );
          for (const note of exercise.notes) {
            expect(
              note.acceptedMasks.length,
              `${difficulty.id}/${kind}/${fifths} note ${note.writtenMidi}`,
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('respects the difficulty maximum interval', () => {
    const difficulty = difficultyById('beginner');
    const exercise = generateExercise(options({ difficulty, kind: 'phrases' }));
    for (let i = 1; i < exercise.notes.length; i++) {
      const leap = Math.abs(exercise.notes[i].writtenMidi - exercise.notes[i - 1].writtenMidi);
      expect(leap).toBeLessThanOrEqual(difficulty.maxInterval);
    }
  });

  it('writes no accidentals at all on the beginner setting', () => {
    const exercise = generateExercise(options({ difficulty: difficultyById('beginner') }));
    for (const note of exercise.notes) {
      expect(needsAccidental(spellInKey(note.writtenMidi, keyAt(exercise.keys, note.startBeat)), keyAt(exercise.keys, note.startBeat))).toBe(
        false,
      );
    }
  });
});

describe('scales and arpeggios', () => {
  const KEYS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

  describe('measured in cycles rather than bars', () => {
    /*
     * The fault this fixes: a scale is fifteen notes for one octave up and
     * back, which is three and three quarter bars of crotchets. Asked for a
     * number of bars, generation stopped when the bars ran out — routinely
     * part way up the scale, which is the one place a scale should not stop.
     */
    // Every drill, not a representative pair: being measured in cycles is a
    // structural property, and each new chord earns the same guarantee.
    const PATTERNS = DRILLS.map((d) => d.id);

    it.each(PATTERNS)('plays each cycle through whole (%s)', (drillId) => {
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard']) {
        for (const cycles of [1, 2, 4]) {
          const exercise = generateExercise(
            options({
              kind: 'drills',
              drillId,
              cycles,
              difficulty: difficultyById(difficultyId),
              seed: cycles + 3,
            }),
          );
          const where = `${drillId} ${difficultyId} x${cycles}`;

          // Whole cycles, and then the one closing tonic — see `patternSlots`.
          const sounded = exercise.notes.length - 1;
          expect(sounded % cycles, where).toBe(0);

          // The shape really is repeated: the pitches of the first cycle are
          // the pitches of every other one.
          const perCycle = sounded / cycles;
          const first = exercise.notes.slice(0, perCycle).map((n) => n.writtenMidi);
          for (let c = 1; c < cycles; c++) {
            expect(
              exercise.notes.slice(c * perCycle, (c + 1) * perCycle).map((n) => n.writtenMidi),
              `${where}: cycle ${c + 1}`,
            ).toEqual(first);
          }
        }
      }
    });

    it.each(PATTERNS)('finishes on the note it started on (%s)', (drillId) => {
      /*
       * A cycle leaves out the root it would repeat at each join, which is
       * right for going round again and wrong for stopping: it left the
       * exercise hanging on the second degree. The closing root is added back
       * once, as the second-time bar of a scale in a method book does.
       */
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard']) {
        for (const cycles of [1, 2, 3]) {
          const exercise = generateExercise(
            options({
              kind: 'drills',
              drillId,
              cycles,
              difficulty: difficultyById(difficultyId),
              seed: cycles + 17,
            }),
          );
          const notes = exercise.notes;
          expect(
            notes[notes.length - 1].writtenMidi,
            `${drillId} ${difficultyId} x${cycles} did not close on its root`,
          ).toBe(notes[0].writtenMidi);
        }
      }
    });

    it.each(PATTERNS)('lands every key change on a bar line (%s)', (drillId) => {
      /*
       * What the padding is for, and all it is for. A cycle boundary is made
       * a bar line exactly where the key moves across it, because that is the
       * only place a key change may land; where the key holds, cycles run
       * straight on into one another.
       */
      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard']) {
        const exercise = generateExercise(
          options({
            kind: 'drills',
            drillId,
            cycles: 4,
            keySet: [-3, -1],
            difficulty: difficultyById(difficultyId),
            seed: 11,
          }),
        );
        const { barBeats } = metreAt(exercise.metres, 0);
        expect(
          exercise.keys.length,
          `${drillId} ${difficultyId}: no change to check`,
        ).toBeGreaterThan(1);
        for (const change of exercise.keys) {
          expect(
            change.fromBeat % barBeats,
            `${drillId} ${difficultyId}: a key change off the bar line`,
          ).toBeCloseTo(0, 9);
        }
      }
    });

    it.each(PATTERNS)('runs cycles together where the key holds (%s)', (drillId) => {
      // A rest in the middle of a scale is a gap in the scale, so cycles run
      // straight on into one another. The one rest permitted is padding after
      // the final held root, where the remainder of the last bar is not a
      // value one note can be written as — never between two sounded notes.
      const exercise = generateExercise(
        options({ kind: 'drills', drillId, cycles: 2, seed: 11 }),
      );
      const lastNote = exercise.notes[exercise.notes.length - 1];
      for (const rest of exercise.rests) {
        expect(
          rest.startBeat,
          `${drillId}: a rest at ${rest.startBeat}, inside the pattern`,
        ).toBeGreaterThan(lastNote.startBeat);
      }
      expect(exercise.totalBeats % metreAt(exercise.metres, 0).barBeats).toBe(0);
    });

    it.each(PATTERNS)('runs to a whole number of bars (%s)', (drillId) => {
      for (const cycles of [1, 2, 4, 8]) {
        const exercise = generateExercise(
          options({ kind: 'drills', drillId, cycles, seed: cycles }),
        );
        const bars = exercise.totalBeats / metreAt(exercise.metres, 0).barBeats;
        expect(bars, `${drillId} x${cycles}`).toBe(Math.round(bars));
        // And longer when asked for more, which is the whole of the control.
        expect(exercise.totalBeats).toBeGreaterThan(0);
      }
    });

    it('gets longer with more cycles', () => {
      const once = generateExercise(options({ kind: 'drills', cycles: 1,
 themeCount: 2, seed: 2 }));
      const twice = generateExercise(options({ kind: 'drills', cycles: 2,
 themeCount: 2, seed: 2 }));

      // Notes scale exactly, discounting the closing tonic each ends on.
      expect(twice.notes.length - 1).toBe((once.notes.length - 1) * 2);

      /*
       * Beats only grow, rather than doubling. Two things stop it being exact
       * and both are wanted: each length pads out to its own bar line, and
       * where the rhythm pool holds more than one value the two exercises draw
       * different durations. Asserting proportion here would be asserting a
       * coincidence.
       */
      expect(twice.totalBeats).toBeGreaterThan(once.totalBeats);
    });

    it('leaves free material measured in bars, untouched', () => {
      // `cycles` is a pattern's unit and must not leak into anything else.
      for (const bars of [4, 8, 16]) {
        const exercise = generateExercise(options({ kind: 'phrases', bars, cycles: 7,
 themeCount: 2, seed: bars }));
        expect(exercise.totalBeats, `random ${bars}`).toBe(bars * metreAt(exercise.metres, 0).barBeats);
      }
    });

    it('measures sight-reading in whole themes, and still owes nothing to cycles', () => {
      /*
       * Themed material is measured the way a pattern is rather than the way
       * free material is: a theme is a fixed shape, so the length asked for is
       * a floor and not a target. Cutting a phrase off mid sentence is the one
       * thing this material exists not to do.
       */
      for (const bars of [4, 8, 16]) {
        const seven = generateExercise(options({ kind: 'phrases', bars, cycles: 7,
 themeCount: 2, seed: bars }));
        const two = generateExercise(options({ kind: 'phrases', bars, cycles: 2,
 themeCount: 2, seed: bars }));

        expect(seven.totalBeats, `phrases ${bars}`).toBeGreaterThanOrEqual(
          bars * metreAt(seven.metres, 0).barBeats,
        );
        expect(seven.totalBeats % metreAt(seven.metres, 0).barBeats, 'ends part way through a bar').toBe(0);
        expect(two.totalBeats, `cycles leaked into phrases at ${bars}`).toBe(seven.totalBeats);
      }
    });
  });

  it.each(DIATONIC.map((d) => d.id))(
    'stays entirely in key, in every key (%s)',
    (drillId) => {
      // The whole point of the diatonic drills: a drill in Eb contains the
      // notes of Eb and nothing else — the dominant 7th and the minor arpeggio
      // included, which is precisely why they are built on their own degrees
      // rather than borrowed from another mode. A stray accidental means the
      // pattern was built on the wrong degree. (The two minor scales raise
      // degrees on purpose, and have a test of their own below.)
      for (const fifths of KEYS) {
        for (const instrumentId of ['cornet', 'euphonium', 'eb-bass']) {
          const instrument = instrumentById(instrumentId);
          const [low, high] = writtenRange(instrument, 'treble');
          const exercise = generateExercise(
            options({ kind: 'drills', drillId, fifths, instrument, seed: fifths + 50 }),
          );

          for (const note of exercise.notes) {
            const spelled = spellInKey(note.writtenMidi, fifths);
            expect(
              needsAccidental(spelled, fifths),
              `${drillId} in ${fifths} fifths on ${instrumentId}: ${spelled.letter}${spelled.alter}`,
            ).toBe(false);
            expect(note.showAccidental).toBe(false);
            expect(note.writtenMidi).toBeGreaterThanOrEqual(low);
            expect(note.writtenMidi).toBeLessThanOrEqual(high);
          }
        }
      }
    },
  );

  it('starts every drill on its own root, in every key', () => {
    // The subdominant arpeggio in Eb starts on Ab, the relative minor on C:
    // the root is the drill's own degree, not the key's tonic.
    for (const drill of DRILLS) {
      for (const fifths of KEYS) {
        const exercise = generateExercise(
          options({ kind: 'drills', drillId: drill.id, fifths, seed: 9 }),
        );
        const first = exercise.notes[0].writtenMidi;
        expect(((first % 12) + 12) % 12, `${drill.id} in ${fifths} fifths`).toBe(
          (tonicPitchClass(fifths) + drill.rootDegree) % 12,
        );
      }
    }
  });

  it('runs a scale up and back down rather than wandering', () => {
    const exercise = generateExercise(options({ kind: 'drills', fifths: -3, bars: 16, seed: 4 }));
    const pitches = exercise.notes.map((n) => n.writtenMidi);

    // Consecutive scale notes move by a step, never by a leap.
    for (let i = 1; i < pitches.length; i++) {
      const step = Math.abs(pitches[i] - pitches[i - 1]);
      expect(step).toBeLessThanOrEqual(2);
    }
    // And it genuinely changes direction rather than only ascending.
    expect(Math.max(...pitches)).toBeGreaterThan(pitches[0]);
    expect(pitches.some((p, i) => i > 0 && p < pitches[i - 1])).toBe(true);
  });

  it('uses each drill\'s own tones and nothing else', () => {
    // Choosing "C major" and being handed F-A-C is not a C major arpeggio —
    // and choosing the dominant 7th and being handed the tonic triad is no
    // better. Each drill's notes are exactly its own degrees, from its data.
    for (const drill of DRILLS) {
      for (const fifths of KEYS) {
        const root = (tonicPitchClass(fifths) + drill.rootDegree) % 12;
        const expected = new Set(tonesOf(drill).map((i) => (root + i) % 12));

        for (const seed of [1, 2, 3]) {
          const exercise = generateExercise(
            options({ kind: 'drills', drillId: drill.id, fifths, seed }),
          );
          const classes = new Set(exercise.notes.map((n) => ((n.writtenMidi % 12) + 12) % 12));

          for (const pc of classes) {
            expect(
              expected.has(pc),
              `${drill.id} key ${fifths} seed ${seed} contained pitch class ${pc}`,
            ).toBe(true);
          }
          // And every tone should be present, not just the ones that fitted:
          // the default span here is two octaves, room for all of them.
          expect(
            classes.size,
            `${drill.id} key ${fifths} seed ${seed} was missing tones`,
          ).toBe(expected.size);
        }
      }
    }
  });

  it('never truncates a pattern against the top of the range', () => {
    // The failure this guards against: a pattern running out of room part-way
    // through its chord, leaving G-B-G-B where an arpeggio should be. What
    // must be present is every degree the *fitted* span has room for — the
    // span may honestly shrink, but never mid-chord.
    for (const drill of DRILLS) {
      for (const difficulty of DIFFICULTIES) {
        for (const instrumentId of ['cornet', 'euphonium', 'eb-bass', 'bb-bass', 'tenor-horn']) {
          for (const fifths of KEYS) {
            const instrument = instrumentById(instrumentId);
            const span = patternSpanFor(instrument, 'treble', fifths, difficulty, drill);
            const root = (tonicPitchClass(fifths) + drill.rootDegree) % 12;
            const expected = new Set(tonesOf(drill, span).map((i) => (root + i) % 12));

            const exercise = generateExercise(
              options({
                kind: 'drills',
                drillId: drill.id,
                difficulty,
                fifths,
                instrument,
                seed: fifths + difficulty.id.length,
              }),
            );
            const classes = new Set(exercise.notes.map((n) => ((n.writtenMidi % 12) + 12) % 12));
            expect(
              classes,
              `${drill.id} ${instrumentId} ${difficulty.id} key ${fifths}`,
            ).toEqual(expected);
          }
        }
      }
    }
  });

  it.each(SHAPES)(
    'uses nothing but plain crotchets at Beginner and Easy (%s)',
    (drillId) => {
      // At these levels the exercise is about the fingering, not about reading a
      // rhythm at the same time. The closing tonic is the exception, held out
      // to the bar line as the second-time bar of any method book's scale is.
      for (const difficultyId of ['beginner', 'easy']) {
        for (let seed = 1; seed <= 6; seed++) {
          const exercise = generateExercise(
            options({ kind: 'drills', drillId, difficulty: difficultyById(difficultyId), seed, bars: 8 }),
          );

          for (const note of exercise.notes.slice(0, -1)) {
            expect(note.duration.value, difficultyId).toBe('quarter');
            expect(note.duration.dotted, difficultyId).toBe(false);
          }

          /*
           * Rests here are structural, never rhythmic: `restChance` is zero at
           * these levels, so the only ones that can appear are the padding that
           * carries a cycle out to its bar line. They therefore all sit at the
           * end of a cycle, which is to say in the last bar of one.
           */
          for (const rest of exercise.rests) {
            const endsOnBarLine =
              (rest.startBeat + durationBeats(rest.duration)) % metreAt(exercise.metres, 0).barBeats === 0;
            const runsToAnotherRest = exercise.rests.some(
              (other) =>
                Math.abs(other.startBeat - (rest.startBeat + durationBeats(rest.duration))) < 1e-9,
            );
            expect(
              endsOnBarLine || runsToAnotherRest,
              `${difficultyId}: rest at ${rest.startBeat} is not padding to a bar line`,
            ).toBe(true);
          }
        }
      }
    },
  );

  it('mixes the rhythm up again from Medium onwards', () => {
    const values = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const exercise = generateExercise(
        options({ kind: 'drills', difficulty: difficultyById('medium'), seed, bars: 8 }),
      );
      for (const note of exercise.notes) values.add(note.duration.value);
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('reaches a fifth, an octave, then two octaves as difficulty rises', () => {
    // Eb major on an Eb bass, which has the headroom for two octaves.
    const span = (difficultyId: string, drillId: DrillId) => {
      const exercise = generateExercise(
        options({
          kind: 'drills',
          drillId,
          difficulty: difficultyById(difficultyId),
          fifths: -3,
          seed: 4,
          bars: 16,
        }),
      );
      const pitches = exercise.notes.map((n) => n.writtenMidi);
      return Math.max(...pitches) - Math.min(...pitches);
    };

    for (const drillId of SHAPES) {
      expect(span('beginner', drillId), `beginner ${drillId}`).toBe(7);
      expect(span('easy', drillId), `easy ${drillId}`).toBe(12);
      expect(span('medium', drillId), `medium ${drillId}`).toBe(24);
      expect(span('hard', drillId), `hard ${drillId}`).toBe(24);
      expect(span('hard', drillId), `expert ${drillId}`).toBe(24);
    }
  });

  it('plays only the first five notes at Beginner', () => {
    // A fifth, not an octave: root, second, third, fourth, fifth and back down.
    const exercise = generateExercise(
      options({ kind: 'drills', difficulty: difficultyById('beginner'), fifths: -3, bars: 8 }),
    );
    const distinct = new Set(exercise.notes.map((n) => n.writtenMidi));
    expect(distinct.size).toBe(5);
  });

  it('uses root, third and fifth only for a Beginner arpeggio', () => {
    const exercise = generateExercise(
      options({
        kind: 'drills',
        drillId: 'tonic-arpeggio',
        difficulty: difficultyById('beginner'),
        fifths: -3,
        bars: 8,
      }),
    );
    const distinct = [...new Set(exercise.notes.map((n) => n.writtenMidi))].sort((a, b) => a - b);
    expect(distinct).toHaveLength(3);
    expect(distinct[1] - distinct[0]).toBe(4); // major third
    expect(distinct[2] - distinct[0]).toBe(7); // perfect fifth
  });

  it('shrinks the span where the instrument cannot hold it, and says so', () => {
    /*
     * Two octaves needs 24 semitones above the tonic, and where the compass
     * cannot give them the app has to say which it will get instead. A cornet
     * is the honest example now: G affords two octaves and D does not, its
     * only D sitting two semitones too high to reach a second one. The low
     * brass fit two octaves in every key since their tops were raised, which
     * is exactly what that was for.
     */
    const cornet = instrumentById('cornet');
    const medium = difficultyById('medium');

    expect(patternSpanFor(cornet, 'treble', 1, medium)).toBe(24); // G
    expect(patternSpanFor(cornet, 'treble', 2, medium)).toBe(12); // D
    expect(patternSpanFor(instrumentById('eb-bass'), 'treble', 0, medium)).toBe(24); // C

    // And what it reports must be what it actually generates.
    for (const fifths of [-5, -3, -2, 0, 2, 4]) {
      const exercise = generateExercise(
        options({ instrument: cornet, kind: 'drills', difficulty: medium, fifths, bars: 16 }),
      );
      const pitches = exercise.notes.map((n) => n.writtenMidi);
      expect(Math.max(...pitches) - Math.min(...pitches), `key ${fifths}`).toBe(
        patternSpanFor(cornet, 'treble', fifths, medium),
      );
    }
  });

  it('keeps patterns inside the instrument, shrinking rather than overflowing', () => {
    // Three octaves does not fit most brass; the span has to give way rather
    // than run off the top.
    for (const instrumentId of ['cornet', 'tenor-horn', 'euphonium', 'eb-bass', 'bb-bass']) {
      const instrument = instrumentById(instrumentId);
      const [low, high] = writtenRange(instrument, 'treble');

      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard', 'hard']) {
        const exercise = generateExercise(
          options({
            kind: 'drills',
            instrument,
            difficulty: difficultyById(difficultyId),
            seed: 9,
            bars: 16,
          }),
        );
        for (const note of exercise.notes) {
          expect(note.writtenMidi, `${instrumentId} ${difficultyId}`).toBeGreaterThanOrEqual(low);
          expect(note.writtenMidi, `${instrumentId} ${difficultyId}`).toBeLessThanOrEqual(high);
        }
      }
    }
  });

  it('leaves the other exercise kinds alone', () => {
    // Only scales and arpeggios get the simplified rhythm.
    const values = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const exercise = generateExercise(
        options({ kind: 'phrases', difficulty: difficultyById('easy'), seed, bars: 8 }),
      );
      for (const note of exercise.notes) values.add(note.duration.value);
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('spans at least a full octave, root to root', () => {
    for (const drillId of SHAPES) {
      const exercise = generateExercise(
        options({ kind: 'drills', drillId, fifths: 0, bars: 16, seed: 3 }),
      );
      const pitches = exercise.notes.map((n) => n.writtenMidi);
      expect(Math.max(...pitches) - Math.min(...pitches), drillId).toBeGreaterThanOrEqual(12);
    }
  });

  it('leaps by chord tones in arpeggios, not by step', () => {
    const exercise = generateExercise(
      options({ kind: 'drills', drillId: 'tonic-arpeggio', fifths: 0, bars: 16, seed: 6 }),
    );
    const pitches = exercise.notes.map((n) => n.writtenMidi);
    const leaps = pitches.slice(1).filter((p, i) => Math.abs(p - pitches[i]) >= 3);
    expect(leaps.length).toBeGreaterThan(pitches.length / 3);
  });
});

describe('fingering variety', () => {
  /** Notes that begin the exercise or follow a rest. */
  function freshStartIndices(exercise: ReturnType<typeof generateExercise>): number[] {
    const restEnds = exercise.rests.map((r) => r.startBeat + durationBeats(r.duration));
    return exercise.notes
      .map((note, index) => ({ note, index }))
      .filter(
        ({ note, index }) =>
          index === 0 || restEnds.some((end) => Math.abs(end - note.startBeat) < 1e-6),
      )
      .map(({ index }) => index);
  }

  it('rarely repeats a fingering on consecutive notes', () => {
    // Two notes on one fingering ask the player to do nothing between them,
    // which is the one thing a fingering drill should not do. It cannot always
    // be avoided, so this checks it is rare rather than absent.
    //
    // Ties are exempt, and not by concession: the far end of a tie is the same
    // note still sounding, so of course it carries the same fingering, and doing
    // nothing between the two is precisely what it asks for.
    let consecutive = 0;
    let total = 0;

    for (const kind of ['phrases'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const exercise = generateExercise(options({ kind, seed, bars: 16 }));
        for (let i = 1; i < exercise.notes.length; i++) {
          if (isTieContinuation(exercise.notes, i)) continue;
          total++;
          if (exercise.notes[i].primaryMask === exercise.notes[i - 1].primaryMask) consecutive++;
        }
      }
    }

    expect(total).toBeGreaterThan(200);
    expect(consecutive / total, 'too many repeated fingerings').toBeLessThan(0.05);
  });

  it('leaves the drills alone', () => {
    // Their notes are fixed by the pattern; a scale that skipped a degree to
    // vary the fingering would not be a scale.
    for (const drillId of SHAPES) {
      const exercise = generateExercise(options({ kind: 'drills', drillId, seed: 5, bars: 16 }));
      const steps = exercise.notes
        .slice(1)
        .map((note, i) => Math.abs(note.writtenMidi - exercise.notes[i].writtenMidi));
      expect(Math.max(...steps), drillId).toBeLessThanOrEqual(drillId === 'major-scale' ? 2 : 12);
    }
  });

  it('avoids starting on open valves, at the start and after every rest', () => {
    let openStarts = 0;
    let starts = 0;

    for (const kind of ['phrases'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const exercise = generateExercise(options({ kind, seed, bars: 16 }));
        for (const index of freshStartIndices(exercise)) {
          starts++;
          if (exercise.notes[index].primaryMask === 0) openStarts++;
        }
      }
    }

    expect(starts).toBeGreaterThan(20);
    expect(openStarts / starts, 'too many fresh starts on open valves').toBeLessThan(0.05);
  });

  it('still fills every bar and stays playable', () => {
    // The rules are preferences; they must not be able to starve the generator.
    for (const difficulty of DIFFICULTIES) {
      for (const kind of ['phrases'] as const) {
        const exercise = generateExercise(options({ kind, difficulty, seed: 3 }));
        expect(exercise.notes.length).toBeGreaterThan(0);
        for (const note of exercise.notes) {
          expect(isPlayable(note.soundingMidi, ebBass)).toBe(true);
        }
      }
    }
  });
});

describe('accidentals', () => {
  it('marks a repeated accidental only once per bar', () => {
    // A chromatic setting, so accidentals actually occur in quantity.
    const exercise = generateExercise(
      options({ difficulty: difficultyById('hard'), bars: 16, seed: 777 }),
    );

    // Tracks the alteration currently in force for each letter and octave.
    // Note that an intervening F natural legitimately requires the *next* F
    // sharp to be marked again, so only an unbroken repeat may go unmarked.
    let currentBar = -1;
    let inForce = new Map<string, number>();
    let checked = 0;

    for (const note of exercise.notes) {
      const bar = Math.floor(note.startBeat / metreAt(exercise.metres, 0).barBeats);
      if (bar !== currentBar) {
        currentBar = bar;
        inForce = new Map();
      }

      const spelled = spellInKey(note.writtenMidi, keyAt(exercise.keys, note.startBeat));
      const key = `${spelled.letter}${spelled.octave}`;

      if (inForce.get(key) === spelled.alter) {
        expect(note.showAccidental, `${key} repeated in bar ${bar + 1}`).toBe(false);
        checked++;
      }
      inForce.set(key, spelled.alter);
    }

    expect(checked, 'no repeated pitches occurred, so nothing was tested').toBeGreaterThan(0);
  });

  it('marks an accidental again after the bar line', () => {
    const exercise = generateExercise(
      options({ difficulty: difficultyById('hard'), bars: 16, seed: 777 }),
    );

    // The first note of each bar that departs from the key signature must carry
    // an accidental, regardless of what happened in the previous bar. Except a
    // tie continuation, which is not a new note at all: its accidental is on the
    // other side of the bar line, and the sound has never stopped.
    const barsSeen = new Set<number>();
    let checked = 0;

    for (const [index, note] of exercise.notes.entries()) {
      if (isTieContinuation(exercise.notes, index)) continue;
      const bar = Math.floor(note.startBeat / metreAt(exercise.metres, 0).barBeats);
      if (barsSeen.has(bar)) continue;

      const spelled = spellInKey(note.writtenMidi, keyAt(exercise.keys, note.startBeat));
      if (!needsAccidental(spelled, keyAt(exercise.keys, note.startBeat))) continue;

      expect(note.showAccidental, `first accidental of bar ${bar + 1}`).toBe(true);
      barsSeen.add(bar);
      checked++;
    }

    expect(checked).toBeGreaterThan(1);
  });

  it('marks the first departure from the key signature', () => {
    const exercise = generateExercise(
      options({ difficulty: difficultyById('hard'), bars: 12, seed: 4242 }),
    );

    const marked = new Set<string>();
    for (const [index, note] of exercise.notes.entries()) {
      // A tie continuation never takes one; see above.
      if (isTieContinuation(exercise.notes, index)) continue;
      const spelled = spellInKey(note.writtenMidi, keyAt(exercise.keys, note.startBeat));
      const bar = Math.floor(note.startBeat / metreAt(exercise.metres, 0).barBeats);
      const key = `${bar}:${spelled.letter}${spelled.octave}`;
      if (needsAccidental(spelled, keyAt(exercise.keys, note.startBeat)) && !marked.has(key)) {
        expect(note.showAccidental).toBe(true);
        marked.add(key);
      }
    }
    expect(marked.size).toBeGreaterThan(0);
  });
});

describe('beaming', () => {
  it('never beams across a beat', () => {
    const exercise = generateExercise(
      options({ difficulty: difficultyById('hard'), seed: 99 }),
    );
    const groups = new Map<number, number[]>();
    for (const note of exercise.notes) {
      if (note.beamGroup < 0) continue;
      const group = groups.get(note.beamGroup) ?? [];
      group.push(note.startBeat);
      groups.set(note.beamGroup, group);
    }

    expect(groups.size).toBeGreaterThan(0);
    for (const beats of groups.values()) {
      const beat = Math.floor(beats[0]);
      for (const b of beats) expect(Math.floor(b)).toBe(beat);
    }
  });

  it('never leaves a beam group with a single note', () => {
    const exercise = generateExercise(options({ difficulty: difficultyById('hard'), seed: 5 }));
    const counts = new Map<number, number>();
    for (const note of exercise.notes) {
      if (note.beamGroup < 0) continue;
      counts.set(note.beamGroup, (counts.get(note.beamGroup) ?? 0) + 1);
    }
    for (const count of counts.values()) expect(count).toBeGreaterThan(1);
  });
});

describe('weak-note drilling', () => {
  it('biases generation toward the notes it is told are weak', () => {
    const [low, high] = writtenRange(ebBass, 'treble');
    const centre = Math.round((low + high) / 2);
    const target = centre + 1;

    const weights = new Map<number, number>([[target, 40]]);

    const without = countOf(target, generateExercise(options({ bars: 24, seed: 31 })));
    const with_ = countOf(
      target,
      generateExercise(options({ bars: 24, seed: 31, noteWeights: weights })),
    );

    expect(with_).toBeGreaterThan(without);
  });

  it('still produces playable, in-range material when weighted', () => {
    const weights = new Map<number, number>([[60, 40]]);
    const exercise = generateExercise(options({ noteWeights: weights }));
    for (const note of exercise.notes) {
      expect(isPlayable(note.soundingMidi, ebBass)).toBe(true);
    }
  });
});

function countOf(midi: number, exercise: ReturnType<typeof generateExercise>): number {
  return exercise.notes.filter((n) => n.writtenMidi === midi).length;
}

describe('transposition', () => {
  it('keeps written and sounding pitch consistent for every note', () => {
    for (const instrumentId of ['cornet', 'euphonium', 'eb-bass']) {
      const instrument = instrumentById(instrumentId);
      for (const clef of ['treble', 'bass'] as const) {
        if (instrument.transposition[clef] === undefined) continue;
        const exercise = generateExercise(options({ instrument, clef, seed: 8 }));
        for (const note of exercise.notes) {
          expect(note.soundingMidi).toBe(soundingFromWritten(note.writtenMidi, instrument, clef));
        }
      }
    }
  });
});

describe('key changes', () => {
  /*
   * The rule underneath all of these: a change belongs on a bar line and
   * nowhere else. Everything downstream leans on it — `assignAccidentals`
   * resets per bar and so needs no special case, and the engraver reserves
   * room at a column it already has.
   */
  const barOf = (exercise: ReturnType<typeof generateExercise>, beat: number) =>
    beat / metreAt(exercise.metres, 0).barBeats;

  it('produces one key and no changes when only one was offered', () => {
    // The ordinary case, and the one that must not have changed.
    for (const kind of KINDS) {
      const exercise = generateExercise(options({ kind, fifths: -3, keySet: [-3] }));
      expect(exercise.keys, kind).toEqual([{ fromBeat: 0, fifths: -3 }]);
    }
  });

  it('opens in the key it was asked to start in', () => {
    for (const kind of KINDS) {
      const exercise = generateExercise(
        options({ kind, fifths: -3, keySet: [-3, -1, 2], bars: 24, cycles: 4 }),
      );
      expect(exercise.keys[0], kind).toEqual({ fromBeat: 0, fifths: -3 });
    }
  });

  it('changes only on a bar line', () => {
    for (const kind of KINDS) {
      for (let seed = 1; seed <= 4; seed++) {
        const exercise = generateExercise(
          options({ kind, fifths: -3, keySet: [-3, -2, -1], bars: 24, cycles: 4,
 themeCount: 2, seed }),
        );
        for (const change of exercise.keys) {
          expect(
            barOf(exercise, change.fromBeat),
            `${kind} seed ${seed}: change at beat ${change.fromBeat}`,
          ).toBe(Math.round(barOf(exercise, change.fromBeat)));
        }
      }
    }
  });

  it('moves by steps around the circle, never a jump', () => {
    // Eb, Bb, F are neighbours; visiting them from Eb can only be in that
    // order, so every change is one step.
    const exercise = generateExercise(
      options({ kind: 'phrases', fifths: -3, keySet: [-1, -3, -2], bars: 24 }),
    );
    expect(exercise.keys.map((k) => k.fifths)).toEqual([-3, -2, -1]);
  });

  it('leaves each key long enough to be established', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const exercise = generateExercise(
        options({ kind: 'phrases', fifths: -3, keySet: [-3, -2, -1, 0], bars: 16, seed }),
      );
      for (let i = 1; i < exercise.keys.length; i++) {
        const bars = barOf(exercise, exercise.keys[i].fromBeat - exercise.keys[i - 1].fromBeat);
        expect(bars, `seed ${seed}: a key lasted ${bars} bars`).toBeGreaterThanOrEqual(4);
      }
      // And the last one gets its share too.
      const last = exercise.keys[exercise.keys.length - 1];
      expect(barOf(exercise, exercise.totalBeats - last.fromBeat)).toBeGreaterThanOrEqual(4);
    }
  });

  it('changes a scale only between cycles, never inside one', () => {
    /*
     * Why cycles had to be padded to bar lines before any of this: a scale
     * interrupted half way up to change key would be neither scale.
     */
    const exercise = generateExercise(
      options({ kind: 'drills', fifths: -3, keySet: [-3, -2], cycles: 4,
 themeCount: 2, seed: 6 }),
    );
    expect(exercise.keys.length).toBeGreaterThan(1);

    // Every note of a cycle shares one key, so the pitch that opens a key's
    // block is that key's tonic.
    for (const change of exercise.keys) {
      const opening = exercise.notes.find((n) => n.startBeat >= change.fromBeat);
      expect(opening, `no note at beat ${change.fromBeat}`).toBeDefined();
      expect(opening!.startBeat, 'a key starts where a note does').toBe(change.fromBeat);
    }
  });

  it('rebuilds the pattern on the new tonic rather than just restating the key', () => {
    // A scale in B flat is a different set of notes from one in E flat. Only
    // redrawing the signature would be a change of clothes, not of key.
    const exercise = generateExercise(
      options({ kind: 'drills', fifths: -3, keySet: [-3, -2], cycles: 2,
 themeCount: 2, seed: 3 }),
    );
    const [first, second] = exercise.keys;
    expect(second).toBeDefined();

    const inFirst = exercise.notes.filter((n) => n.startBeat < second.fromBeat);
    const inSecond = exercise.notes.filter((n) => n.startBeat >= second.fromBeat);

    const classes = (notes: typeof exercise.notes) =>
      new Set(notes.map((n) => ((n.writtenMidi % 12) + 12) % 12));
    expect(classes(inFirst), 'the two keys used the same notes').not.toEqual(classes(inSecond));

    // And each block really is its own key's scale.
    for (const [change, notes] of [
      [first, inFirst],
      [second, inSecond],
    ] as const) {
      for (const note of notes) {
        expect(
          needsAccidental(spellInKey(note.writtenMidi, change.fifths), change.fifths),
          `a note foreign to the key at beat ${note.startBeat}`,
        ).toBe(false);
      }
    }
  });

  it('spells and marks every note against the key it falls in', () => {
    /*
     * The quiet failure this guards: everything still generates if spelling
     * is done against the opening key, and every accidental after the first
     * change is then reckoned wrongly.
     */
    for (const kind of ['phrases'] as const) {
      const exercise = generateExercise(
        options({ kind, fifths: -3, keySet: [-3, 3], bars: 16, seed: 12 }),
      );
      expect(exercise.keys.length).toBe(2);

      for (const note of exercise.notes) {
        const local = keyAt(exercise.keys, note.startBeat);
        expect(
          note.pitch,
          `${kind}: note at beat ${note.startBeat} spelled against the wrong key`,
        ).toEqual(spellInKey(note.writtenMidi, local));
      }
    }
  });

  it('takes no accidental on a tie carried across a change', () => {
    // A tie is one sound continuing; it is not re-attacked and so is never
    // re-spelled, whatever the signature does underneath it.
    for (let seed = 1; seed <= 20; seed++) {
      const exercise = generateExercise(
        options({
          kind: 'phrases',
          difficulty: difficultyById('medium'),
          fifths: -3,
          keySet: [-3, 2],
          bars: 16,
          seed,
        }),
      );
      exercise.notes.forEach((note, index) => {
        if (!isTieContinuation(exercise.notes, index)) return;
        expect(note.showAccidental, `seed ${seed}, beat ${note.startBeat}`).toBe(false);
      });
    }
  });
});

describe('variable tempo, at generation', () => {
  const themed = (overrides: Partial<GenerateOptions> = {}) =>
    generateExercise(
      options({ kind: 'themes', themeCount: 3, tempo: 80, variableTempo: true, ...overrides }),
    );

  it('writes steps on theme joins and rits on whole bars, nowhere else', () => {
    const exercise = themed();
    expect(exercise.tempo.length).toBeGreaterThan(0);
    for (const event of exercise.tempo) {
      if (event.kind === 'tempo') {
        expect(event.atBeat).toBeGreaterThan(0);
        expect(event.atBeat % metreAt(exercise.metres, 0).barBeats).toBe(0);
      } else if (event.kind === 'ramp') {
        expect(event.fromBeat % metreAt(exercise.metres, 0).barBeats).toBe(0);
        expect(event.toBeat).toBeLessThanOrEqual(exercise.totalBeats);
      } else {
        throw new Error('no holds until stage 3');
      }
    }
    // Ends broaden: the last event is always the closing rit.
    const last = exercise.tempo[exercise.tempo.length - 1];
    expect(last.kind === 'ramp' && last.toBeat).toBe(exercise.totalBeats);
  });

  it('writes nothing with the setting off, and nothing changes but the marks', () => {
    const on = themed({ seed: 9 });
    const off = themed({ seed: 9, variableTempo: false });
    expect(off.tempo).toEqual([]);
    // The plan draws from the rng after stitching is done with it, so the
    // music itself is identical either way.
    expect(off.notes).toEqual(on.notes);
  });

  it('broadens the end of every material kind, joins or none', () => {
    for (const kind of ['drills', 'phrases'] as const) {
      const exercise = generateExercise(
        options({ kind, cycles: 2, tempo: 80, variableTempo: true }),
      );
      expect(exercise.tempo, kind).toHaveLength(1);
      const rit = exercise.tempo[0];
      expect(rit.kind, kind).toBe('ramp');
      if (rit.kind === 'ramp') {
        expect(rit.toBeat, kind).toBe(exercise.totalBeats);
        expect(rit.toBpm, kind).toBeLessThan(80);
      }
    }
  });
});

describe('the horizon', () => {
  it('runs the paper to the cap and keeps the chosen length', () => {
    const exercise = generateExercise(options({ kind: 'phrases', bars: 4, horizonBars: 12 }));
    expect(exercise.totalBeats).toBe(48);
    expect(exercise.chosenBeats).toBe(16);
    // The grey is real music, not padding: notes run into the final bars.
    expect(exercise.notes[exercise.notes.length - 1].startBeat).toBeGreaterThanOrEqual(40);
  });

  it('treats the chosen end as a boundary the tempo plan may use', () => {
    const exercise = generateExercise(
      options({ kind: 'phrases', bars: 4, horizonBars: 12, tempo: 80, variableTempo: true }),
    );
    // A new tempo takes force where the white ends, the way a theme join
    // does; the closing rit belongs to the cap, where the paper truly ends.
    expect(
      exercise.tempo.some((e) => e.kind === 'tempo' && e.atBeat === 16),
    ).toBe(true);
    const last = exercise.tempo[exercise.tempo.length - 1];
    expect(last.kind === 'ramp' && last.toBeat).toBe(48);
  });

  it('fills whole cycles to the cap, the chosen count ending where a cycle does', () => {
    const scales = generateExercise(options({ kind: 'drills', cycles: 2, horizonBars: 15 }));
    expect(scales.totalBeats).toBeGreaterThanOrEqual(60);
    expect(scales.chosenBeats).toBeLessThan(scales.totalBeats);
    /*
     * The white may leave off mid-bar — where the key holds, the next cycle
     * starts at once rather than resting out the bar — but never mid-cycle:
     * the note the grey opens on is a fresh cycle's root. (The earlier version
     * of this test asserted a bar line here, which one seed happened to give
     * it; a single-key pattern has no padding to guarantee one.)
     */
    const opening = scales.notes.find((n) => n.startBeat === scales.chosenBeats);
    expect(opening, 'nothing starts where the grey does').toBeDefined();
    expect(opening!.writtenMidi, 'the grey does not open on the root').toBe(
      scales.notes[0].writtenMidi,
    );
    // Without the cap, nothing changes: the old exact-length path survives.
    const exact = generateExercise(options({ kind: 'drills', cycles: 2 }));
    expect(exact.chosenBeats).toBe(exact.totalBeats);
  });

  it('stitches whole themes to the cap', () => {
    const themes = generateExercise(
      options({ kind: 'themes', themeCount: 2, horizonBars: 30 }),
    );
    expect(themes.totalBeats).toBeGreaterThanOrEqual(120);
    expect(themes.chosenBeats).toBeLessThan(themes.totalBeats);
    expect(themes.chosenBeats % metreAt(themes.metres, 0).barBeats).toBe(0);
  });

  it('changes nothing when the chosen length already reaches the cap', () => {
    const capped = generateExercise(options({ kind: 'phrases', bars: 12, horizonBars: 12 }));
    const plain = generateExercise(options({ kind: 'phrases', bars: 12 }));
    expect(capped.chosenBeats).toBe(capped.totalBeats);
    expect(capped.notes).toEqual(plain.notes);
  });
});

describe('somewhere to put a valve down, past every boundary', () => {
  /*
   * Carrying on playing is how a player takes the offer of more music, and
   * with buttons a valve going down is the only unambiguous way to say so —
   * an open note and an abandoned instrument are the same input. So the few
   * beats past each block boundary keep open notes out of the way where the
   * material is free to answer, and it turns out that even where it is not —
   * a pattern's contour is fixed, a theme's notes are somebody's tune — a
   * whole window is never open by accident.
   */
  const metre = metreFor(4, 4);
  const windows = (kind: 'phrases' | 'drills' | 'themes', seed: number) => {
    const exercise = generateExercise(
      options({ kind, metre, bars: 8, cycles: 2, themeCount: 2, seed, horizonBars: 60 }),
    );
    const block = exercise.chosenBeats;
    const found: Array<typeof exercise.notes> = [];
    for (let beat = block; beat < exercise.totalBeats; beat += block) {
      const inWindow = exercise.notes.filter(
        (n) => n.startBeat >= beat - 1e-9 && n.startBeat < beat + 4 - 1e-9,
      );
      if (inWindow.length > 0) found.push(inWindow);
    }
    return found;
  };

  it('never opens a boundary with nothing but open notes', () => {
    for (const kind of ['phrases', 'drills', 'themes'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        for (const inWindow of windows(kind, seed)) {
          expect(
            inWindow.some((n) => !n.acceptedMasks.includes(0)),
            `${kind} seed ${seed}: a whole window playable open`,
          ).toBe(true);
        }
      }
    }
  });

  /*
   * There was a second test here, and what it measured left with *Random
   * notes* in v2.14.0.
   *
   * It asserted that under a tenth of the notes just past a boundary come out
   * open — a soft preference on top of the hard guarantee above, and one the
   * free walk could keep easily because it could pick any note within its leap
   * and nearly always find a valved one. Sight-reading moves by step: at any
   * moment it has two or three notes to choose between, and whether one of them
   * is valved is mostly luck. Measured with the preference in and out, the rate
   * past a boundary is 0.229 against 0.236 — the steering is very nearly inert
   * for stepwise material, and a test asserting otherwise would be asserting
   * something untrue.
   *
   * **This is a real loss and it is not papered over.** The preference exists so
   * that a player carrying on into the grey can be *seen* to carry on, a valve
   * going down being the only unambiguous thing a set of buttons can say. It
   * still works where the material can answer — themes and patterns choose
   * their own notes — and the hard guarantee above still holds everywhere. What
   * has gone is the margin. Whether to win it back by letting a phrase leap
   * further in those four beats is a live question, and the player has already
   * asked for leaps to be reconsidered against what is plausible per instrument
   * and difficulty; it belongs to that work, not to a test.
   */
});

/**
 * The figures a run opens on, which are the player's and not a derivation.
 *
 * Pinned because they are a judgement about how long one sitting at each of
 * these is worth, made on 2026-08-15 when length stopped being a setting — and
 * a judgement nothing else in the code would notice being changed.
 */
/**
 * The named minor scales, chosen the way a book prints them.
 *
 * The intervals were never the work; the spelling was. `spellInKey` chooses
 * accidentals by the signature's direction, and a minor key takes its relative
 * major's signature — so D harmonic minor is one flat and its raised seventh
 * would have come out as D flat rather than C sharp. A scale is one note per
 * letter, and each drill note now carries its letter step so the spelling
 * follows the letters.
 */
describe('the minor scales', () => {
  const dMinor = -1; // F major's signature, which is how D minor is written.
  const letters = (exercise: ReturnType<typeof generateExercise>) =>
    exercise.notes.map((n) => `${n.pitch.letter}${n.pitch.alter === 1 ? '#' : n.pitch.alter === -1 ? 'b' : ''}`);
  const oneOctave = (drillId: DrillId, fifths: number, seed = 3) =>
    generateExercise(
      options({
        kind: 'drills',
        drillId,
        fifths,
        difficulty: difficultyById('easy'),
        cycles: 1,
        seed,
      }),
    );

  it('writes the harmonic minor with its seventh raised on its own letter', () => {
    // D E F G A Bb C# D, and back — never a D flat.
    const names = letters(oneOctave('harmonic-minor-scale', dMinor));
    expect(names.slice(0, 8)).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C#', 'D']);
    expect(names).not.toContain('Db');
    // And a sharp is drawn on it, since the signature says nothing of the sort.
    const raised = oneOctave('harmonic-minor-scale', dMinor).notes[6];
    expect(raised.pitch).toMatchObject({ letter: 'C', alter: 1 });
    expect(raised.showAccidental).toBe(true);
  });

  it('writes the melodic minor raised on the way up and natural on the way down', () => {
    // Ruled before it was built: ascending melodic, descending natural.
    const names = letters(oneOctave('melodic-minor-scale', dMinor));
    expect(names).toEqual([
      'D', 'E', 'F', 'G', 'A', 'B', 'C#', 'D',
      'C', 'Bb', 'A', 'G', 'F', 'E', 'D',
    ]);
  });

  it('cancels a flat with a natural where the raised note is the flattened letter', () => {
    // C minor is three flats; its raised seventh is B natural, and the natural
    // sign is drawn because the signature says B flat.
    const exercise = oneOctave('harmonic-minor-scale', -3);
    const seventh = exercise.notes[6];
    expect(seventh.pitch).toMatchObject({ letter: 'B', alter: 0 });
    expect(seventh.showAccidental).toBe(true);
  });

  it('starts on the relative minor tonic and takes the major signature', () => {
    for (const fifths of [-6, -3, -1, 0, 2, 4]) {
      for (const drillId of ['harmonic-minor-scale', 'melodic-minor-scale'] as const) {
        const exercise = oneOctave(drillId, fifths);
        expect(exercise.keys).toEqual([{ fromBeat: 0, fifths }]);
        expect(((exercise.notes[0].writtenMidi % 12) + 12) % 12, `${drillId} in ${fifths}`).toBe(
          (tonicPitchClass(fifths) + 9) % 12,
        );
      }
    }
  });

  it('never prints a double accidental, in any drill or key', () => {
    /*
     * The app's rule, and the one place a drill could break it: the raised
     * seventh of G sharp, D sharp and A sharp minor is a double sharp in a
     * book. Here it falls back to the key's own spelling — the natural above,
     * which is what `spellInKey` writes for that sound — and the settings
     * screen says so beside those keys.
     */
    for (const drill of DRILLS) {
      for (const fifths of [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]) {
        const exercise = oneOctave(drill.id, fifths);
        for (const note of exercise.notes) {
          expect(Math.abs(note.pitch.alter), `${drill.id} in ${fifths}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // The fallback, named: G sharp minor's F double-sharp is written G natural.
    const gSharpMinor = oneOctave('harmonic-minor-scale', 5);
    expect(gSharpMinor.notes[6].pitch).toMatchObject({ letter: 'G', alter: 0 });
  });

  it('spells every diatonic drill exactly as the signature would', () => {
    // The letter rule must change nothing for the drills that were right
    // already: their notes are in key, so the letter step lands on the very
    // letter the signature spells them with.
    for (const drill of DIATONIC) {
      for (const fifths of [-5, -3, 0, 2, 4]) {
        const exercise = oneOctave(drill.id, fifths);
        for (const note of exercise.notes) {
          expect(note.pitch, `${drill.id} in ${fifths}`).toEqual(spellInKey(note.writtenMidi, fifths));
        }
      }
    }
  });
});

/**
 * What the Drills box promises, against what the generator actually makes.
 *
 * The player's rule, given on 2026-08-15: *nothing should make a claim of
 * something it doesn't deliver.* The Arpeggios box named five chords for a long
 * time while the generator played the tonic triad alone — the blurb was
 * describing an intention, and nothing connected the two, so nothing noticed.
 * The five chords are real now and the sentence is back; this keeps the two
 * tied together in both directions.
 */
describe('what the Drills box promises', () => {
  const blurb = EXERCISE_KINDS.find((k) => k.id === 'drills')!.blurb.toLowerCase();

  /*
   * Each drill's claim, as a pattern rather than a substring, because the
   * words nest: "dominant" sits inside both "subdominant" and "dominant 7th".
   *
   * Typed over the whole of `DrillId`, which is the forward half of the guard:
   * adding a drill without adding its claim — and so without asking whether
   * the sentence owns it — refuses to compile.
   */
  const CLAIMS: Record<DrillId, RegExp> = {
    'major-scale': /\bmajor\b/,
    'harmonic-minor-scale': /harmonic minor/,
    'melodic-minor-scale': /melodic minor/,
    'tonic-arpeggio': /tonic/,
    'subdominant-arpeggio': /subdominant/,
    'dominant-arpeggio': /(?<!sub)dominant(?! 7)/,
    'dominant-7th': /dominant 7th/,
    'relative-minor-arpeggio': /minor arpeggio/,
  };

  it('promises every drill it plays', () => {
    for (const drill of DRILLS) {
      expect(blurb, `does not own up to ${drill.name}`).toMatch(CLAIMS[drill.id]);
    }
  });

  it('promises nothing it does not play', () => {
    // The backward half: a claim whose drill has gone must leave the sentence.
    for (const [id, claim] of Object.entries(CLAIMS)) {
      if (!DRILLS.some((d) => d.id === id)) {
        expect(blurb, `still promises ${id}`).not.toMatch(claim);
      }
    }
    // And nothing beyond the list: no shape a future step might bring.
    expect(blurb, 'promises a scale it cannot play').not.toMatch(/chromatic|whole.tone|blues/);
  });
});

describe('how long a run is, now that nobody chooses', () => {
  it('opens on the length the player set for each material', () => {
    expect(defaultLengthFor('phrases').bars, 'sixteen bars of reading').toBe(16);
    // Four times through a scale, and twice that through a chord: shorter, so
    // more of them. Which is which is read off the shape, seven notes or fewer.
    for (const drill of DRILLS) {
      const scale = drill.up.length === 7;
      expect(defaultLengthFor('drills', drill.id).cycles, drill.name).toBe(scale ? 4 : 8);
    }
    expect(defaultLengthFor('themes').themeCount, 'four whole tunes').toBe(4);
  });

  it('has a bar count waiting for a pattern that will not fit', () => {
    // A scale too wide for the instrument falls back to free material, which is
    // measured in bars — so every kind carries all three figures, not just its
    // own. Imported music never asks, and is answered anyway rather than thrown at.
    for (const kind of ['drills', 'themes', 'phrases', 'imported'] as const) {
      expect(defaultLengthFor(kind).bars, kind).toBeGreaterThan(0);
    }
  });
});

describe('key changes against the horizon', () => {
  const metre = metreFor(2, 4);
  const withHorizon = (keySet: number[], bars: number) =>
    generateExercise(
      options({ kind: 'phrases', fifths: 0, keySet, bars, metre, seed: 1, horizonBars: 200 }),
    );

  it('changes key inside the length the player asked for', () => {
    /*
     * The regression this exists for: key changes were spread across the
     * whole generated paper, which the horizon grew to two hundred bars. Two
     * keys over sixteen bars put the second one at bar a hundred, so a player
     * who asked for two keys got one — and saw nothing in the grey either,
     * since they would have had to carry on six times over to reach it.
     */
    const exercise = withHorizon([0, 1], 16);
    const chosenBars = exercise.chosenBeats / metre.barBeats;
    const inside = exercise.keys.filter(
      (k) => k.fromBeat > 0 && k.fromBeat < exercise.chosenBeats,
    );
    expect(inside.length, `a change within the chosen ${chosenBars} bars`).toBeGreaterThan(0);
    expect(inside[0].fifths).toBe(1);
  });

  it('keeps touring the set through the grey', () => {
    const exercise = withHorizon([0, 1], 16);
    const used = new Set(exercise.keys.map((k) => k.fifths));
    expect(used).toEqual(new Set([0, 1]));
    // Alternating for as long as the paper lasts, rather than settling.
    expect(exercise.keys.length).toBeGreaterThan(10);
  });

  it('never gives a key less than its minimum stretch', () => {
    for (const [keys, bars] of [[[0, 1], 16], [[0, 1, 2, 3], 16], [[0, 1, 2, 3], 8]] as const) {
      const exercise = withHorizon([...keys], bars);
      for (let i = 1; i < exercise.keys.length; i++) {
        const barsHeld = (exercise.keys[i].fromBeat - exercise.keys[i - 1].fromBeat) / metre.barBeats;
        expect(barsHeld, `${keys.length} keys over ${bars} bars`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('lands every change on a bar line', () => {
    for (const k of withHorizon([0, 1, 2], 16).keys) {
      expect(k.fromBeat % metre.barBeats).toBe(0);
    }
  });
});

describe('compound time', () => {
  const metre = metreFor(6, 8);
  const beatsOf = (d: { value: string; dotted?: boolean }) =>
    ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 })[d.value]! *
    (d.dotted ? 1.5 : 1);

  /**
   * Nothing may straddle the dotted-crotchet beat. That one rule is the whole
   * difference between 6/8 and 3/4 on the page, and both generators — free
   * material and patterns — used to break it, by different routes.
   */
  const straddles = (exercise: ReturnType<typeof generateExercise>) =>
    [...exercise.notes, ...exercise.rests].filter(
      (e) => (e.startBeat % metre.pulseBeats) + beatsOf(e.duration) > metre.pulseBeats + 1e-9,
    );

  it('keeps free material inside the pulse, at every difficulty', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of [1, 2, 3]) {
        const exercise = generateExercise(options({ difficulty, metre, bars: 8, seed }));
        expect(straddles(exercise), `${difficulty.id} seed ${seed}`).toEqual([]);
      }
    }
  });

  it('gives a pattern four-four whatever metre was asked for', () => {
    /*
     * A scale is a shape played against a click rather than a piece with a
     * metre, so it is always in four — which also means the compound rules
     * above never apply to one. The player's own signature is untouched and
     * returns with the next material that has one.
     */
    for (const difficulty of DIFFICULTIES) {
      for (const drillId of SHAPES) {
        const exercise = generateExercise(
          options({ difficulty, metre, kind: 'drills', drillId, cycles: 2, seed: 4 }),
        );
        expect(metreAt(exercise.metres, 0).beatsPerBar, `${drillId} ${difficulty.id}`).toBe(4);
        expect(metreAt(exercise.metres, 0).beatUnit, `${drillId} ${difficulty.id}`).toBe(4);
      }
    }
  });

  it('gives a beginner the beat and nothing shorter', () => {
    // A pool of minims and crotchets cannot fill a dotted-crotchet pulse in
    // any combination, and the beat is what a beginner should be playing.
    const exercise = generateExercise(
      options({ difficulty: difficultyById('beginner'), metre, bars: 4, seed: 1 }),
    );
    expect(exercise.notes.every((n) => beatsOf(n.duration) === 1.5)).toBe(true);
  });

  it('leaves simple time exactly as it was', () => {
    const before = generateExercise(options({ metre: metreFor(4, 4), bars: 8, seed: 9 }));
    expect(before.notes.length).toBeGreaterThan(0);
    // The compound path is entered on the metre alone, so 4/4 never sees it.
    expect(before.notes.some((n) => beatsOf(n.duration) === 1)).toBe(true);
  });
});

describe('where a pattern sits in the instrument', () => {
  const tuba = instrumentById('eb-bass');
  const easy = difficultyById('easy');
  const medium = difficultyById('medium');
  const patternOf = (overrides: Partial<GenerateOptions>) => {
    const exercise = generateExercise(
      options({ instrument: tuba, kind: 'drills', cycles: 1, seed: 2, ...overrides }),
    );
    const written = exercise.notes.map((n) => n.writtenMidi);
    return { low: Math.min(...written), high: Math.max(...written) };
  };

  it('starts an easy pattern where it can be read, not where it merely fits', () => {
    /*
     * A beginner asked for a scale should be reading the scale rather than
     * counting ledger lines to find where it starts. The window is the one a
     * theme's tonic uses — on a treble-clef tuba part, written G below the
     * stave up to the G the clef curls around.
     */
    const [windowLow, windowHigh] = [55, 67];
    for (const fifths of [-3, -1, 0, 2]) {
      const { low } = patternOf({ difficulty: easy, fifths });
      expect(low, `key ${fifths}`).toBeGreaterThanOrEqual(windowLow);
      expect(low, `key ${fifths}`).toBeLessThanOrEqual(windowHigh);
    }
  });

  it('goes where the player asks, window or no window', () => {
    // Asking for a register is asking to leave the comfortable middle.
    const low = patternOf({ difficulty: easy, register: 'low' });
    const middle = patternOf({ difficulty: easy, register: 'middle' });
    const high = patternOf({ difficulty: easy, register: 'high' });

    expect(low.low).toBeLessThan(middle.low);
    expect(high.low).toBeGreaterThanOrEqual(middle.low);
    // And each is still a whole octave of the same shape.
    for (const range of [low, middle, high]) expect(range.high - range.low).toBe(12);
  });

  it('says the same thing three times where there is only one place to go', () => {
    // Two octaves takes most of a brass compass; a register cannot conjure
    // room that is not there, and must not pretend to.
    const spans = (['low', 'middle', 'high'] as const).map((register) =>
      patternOf({ difficulty: medium, register }),
    );
    expect(spans[0]).toEqual(spans[1]);
    expect(spans[1]).toEqual(spans[2]);
  });

  it('reaches the top the raised compass bought it', () => {
    // Two octaves in C used not to fit an Eb bass at all; it now starts on
    // middle C, which is a ledger line rather than four of them.
    const { low, high } = patternOf({ difficulty: medium, fifths: 0 });
    expect(high - low).toBe(24);
    expect(low).toBe(60);
  });
});

describe('a range the player chose', () => {
  /*
   * Ruled on 2026-08-13: a range asked for is taken literally, all of it and
   * none of it favoured. Someone asking for the bottom fifth of the horn has
   * said something specific, and pulling the notes back towards the middle
   * would be the app disagreeing with them about the thing they came to
   * practise. Difficulty keeps everything else it governs — the leaps, the
   * accidentals, the rhythms — and stops governing where the notes sit.
   *
   * Where nothing is asked for, the middle is favoured, which is what the app
   * always did and what an exercise wants when nobody has said otherwise.
   */
  const written = (exercise: ReturnType<typeof generateExercise>) =>
    exercise.notes.map((note) => note.writtenMidi);

  const [lowest, highest] = writtenRange(ebBass, 'treble');

  it('stays inside the notes it was given', () => {
    const range = { low: lowest + 2, high: lowest + 9 };
    for (const kind of ['phrases'] as ExerciseKind[]) {
      for (const seed of [1, 7, 99]) {
        const notes = written(generateExercise(options({ kind, seed, range })));
        expect(Math.min(...notes), `${kind} ${seed}`).toBeGreaterThanOrEqual(range.low);
        expect(Math.max(...notes), `${kind} ${seed}`).toBeLessThanOrEqual(range.high);
      }
    }
  });

  it('uses the low end of the horn when that is what was asked for', () => {
    /*
     * The point of the feature. Left to the difficulty these notes are
     * unreachable at any level below Expert, because the band is centred — so
     * a player who wants to work on the bottom of the instrument could not get
     * there at all.
     */
    const range = { low: lowest, high: lowest + 7 };
    const notes = written(generateExercise(options({ range, difficulty: difficultyById('easy') })));
    expect(Math.max(...notes)).toBeLessThanOrEqual(lowest + 7);

    // And the same request left to the difficulty lands nowhere near it.
    const auto = written(generateExercise(options({ difficulty: difficultyById('easy') })));
    expect(Math.min(...auto)).toBeGreaterThan(lowest + 7);
  });

  it('is not narrowed by an easier level', () => {
    // Difficulty governs the leaps and the rhythm now, not the compass. Two
    // levels, one range, the same ceiling and floor available to both.
    const range = { low: lowest + 4, high: lowest + 28 };
    const reach = (id: string) => {
      const notes = written(generateExercise(options({ range, difficulty: difficultyById(id), bars: 24 })));
      return Math.max(...notes) - Math.min(...notes);
    };
    // Beginner asks for twelve semitones; given a range of twenty-four it may
    // use them all, and over twenty-four bars it does.
    expect(reach('beginner')).toBeGreaterThan(12);
  });

  it('favours the middle when no range is asked for', () => {
    // Unchanged behaviour, which is what every player who never touches this
    // control keeps getting.
    const notes = written(generateExercise(options({ difficulty: difficultyById('easy') })));
    const centre = Math.round((lowest + highest) / 2);
    const half = Math.ceil(difficultyById('easy').rangeSemitones / 2);
    expect(Math.min(...notes)).toBeGreaterThanOrEqual(centre - half);
    expect(Math.max(...notes)).toBeLessThanOrEqual(centre + half);
  });

  it('survives a range given the wrong way round or off the horn', () => {
    // The settings screen clamps, but a stored file can say anything and the
    // generator throwing would take the whole run with it.
    const backwards = generateExercise(options({ range: { low: highest, high: lowest } }));
    expect(backwards.notes.length).toBeGreaterThan(0);

    const beyond = generateExercise(options({ range: { low: lowest - 40, high: highest + 40 } }));
    for (const midi of written(beyond)) {
      expect(midi).toBeGreaterThanOrEqual(lowest);
      expect(midi).toBeLessThanOrEqual(highest);
    }
  });

  it('leaves the drills to their register', () => {
    // A pattern is placed by its root and its span; a range would mean
    // something different there, so it is not asked and not honoured.
    const range = { low: lowest, high: lowest + 7 };
    const scale = generateExercise(options({ kind: 'drills', range }));
    expect(scale.notes.length).toBeGreaterThan(0);
    expect(Math.max(...written(scale))).toBeGreaterThan(lowest + 7);
  });
});
