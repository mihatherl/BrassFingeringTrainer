import { metreFor } from '../domain/metre';
import { describe, expect, it } from 'vitest';
import { isPlayable } from '../domain/fingering';
import { instrumentById, soundingFromWritten, writtenRange } from '../domain/instruments';
import { keyAt, needsAccidental, spellInKey, tonicPitchClass } from '../domain/keys';
import { durationBeats } from '../domain/rhythm';
import { DIFFICULTIES, difficultyById } from './difficulty';
import { generateExercise, patternSpanFor, type GenerateOptions } from './generate';
import { isTieContinuation } from './ties';
import type { ExerciseKind } from './types';

const ebBass = instrumentById('eb-bass');

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    instrument: ebBass,
    clef: 'treble',
    fifths: -3, // Eb major
    difficulty: difficultyById('medium'),
    kind: 'random',
    bars: 8,
    metre: metreFor(4, 4),
    seed: 12345,
    ...overrides,
  };
}

const KINDS: ExerciseKind[] = ['random', 'scales', 'arpeggios', 'phrases'];

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

    for (let bar = 0; bar < 8; bar++) {
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
    const exercise = generateExercise(options({ difficulty, kind: 'random' }));
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

  it.each(['scales', 'arpeggios'] as const)(
    'stays entirely in key, in every key (%s)',
    (kind) => {
      // The whole point of these two modes: a scales drill in Eb contains the
      // notes of Eb and nothing else. A stray accidental means the pattern was
      // built on the wrong degree or borrowed from another mode.
      for (const fifths of KEYS) {
        for (const instrumentId of ['cornet', 'euphonium', 'eb-bass']) {
          const exercise = generateExercise(
            options({ kind, fifths, instrument: instrumentById(instrumentId), seed: fifths + 50 }),
          );

          for (const note of exercise.notes) {
            const spelled = spellInKey(note.writtenMidi, fifths);
            expect(
              needsAccidental(spelled, fifths),
              `${kind} in ${fifths} fifths on ${instrumentId}: ${spelled.letter}${spelled.alter}`,
            ).toBe(false);
            expect(note.showAccidental).toBe(false);
          }
        }
      }
    },
  );

  it('starts a scale on the tonic', () => {
    for (const fifths of KEYS) {
      const exercise = generateExercise(options({ kind: 'scales', fifths, seed: 9 }));
      const first = exercise.notes[0].writtenMidi;
      expect(((first % 12) + 12) % 12, `key with ${fifths} fifths`).toBe(
        tonicPitchClass(fifths),
      );
    }
  });

  it('runs a scale up and back down rather than wandering', () => {
    const exercise = generateExercise(options({ kind: 'scales', fifths: -3, bars: 16, seed: 4 }));
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

  it('uses the tonic triad and nothing else', () => {
    // Choosing "C major" and being handed F-A-C is not a C major arpeggio.
    for (const fifths of KEYS) {
      const tonic = tonicPitchClass(fifths);
      const triad = new Set([tonic, (tonic + 4) % 12, (tonic + 7) % 12]);

      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const exercise = generateExercise(options({ kind: 'arpeggios', fifths, seed }));
        const classes = new Set(exercise.notes.map((n) => ((n.writtenMidi % 12) + 12) % 12));

        for (const pc of classes) {
          expect(triad.has(pc), `key ${fifths} seed ${seed} contained pitch class ${pc}`).toBe(true);
        }
        // And every chord tone should be present, not just the ones that fitted.
        expect(classes.size, `key ${fifths} seed ${seed} was missing chord tones`).toBe(3);
      }
    }
  });

  it('never truncates a pattern against the top of the range', () => {
    // The failure this guards against: a pattern running out of room part-way
    // through its chord, leaving G-B-G-B where an arpeggio should be.
    for (const difficulty of DIFFICULTIES) {
      for (const instrumentId of ['cornet', 'euphonium', 'eb-bass', 'bb-bass', 'tenor-horn']) {
        for (const fifths of KEYS) {
          const exercise = generateExercise(
            options({
              kind: 'arpeggios',
              difficulty,
              fifths,
              instrument: instrumentById(instrumentId),
              seed: fifths + difficulty.id.length,
            }),
          );
          const classes = new Set(exercise.notes.map((n) => ((n.writtenMidi % 12) + 12) % 12));
          expect(
            classes.size,
            `${instrumentId} ${difficulty.id} key ${fifths}: only ${classes.size} chord tones`,
          ).toBe(3);
        }
      }
    }
  });

  it.each(['scales', 'arpeggios'] as const)(
    'uses nothing but plain crotchets at Beginner and Easy (%s)',
    (kind) => {
      // At these levels the exercise is about the fingering, not about reading a
      // rhythm at the same time.
      for (const difficultyId of ['beginner', 'easy']) {
        for (let seed = 1; seed <= 6; seed++) {
          const exercise = generateExercise(
            options({ kind, difficulty: difficultyById(difficultyId), seed, bars: 8 }),
          );

          expect(exercise.rests, `${difficultyId} had rests`).toHaveLength(0);
          for (const note of exercise.notes) {
            expect(note.duration.value, difficultyId).toBe('quarter');
            expect(note.duration.dotted, difficultyId).toBe(false);
          }
        }
      }
    },
  );

  it('mixes the rhythm up again from Medium onwards', () => {
    const values = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const exercise = generateExercise(
        options({ kind: 'scales', difficulty: difficultyById('medium'), seed, bars: 8 }),
      );
      for (const note of exercise.notes) values.add(note.duration.value);
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('reaches a fifth, an octave, then two octaves as difficulty rises', () => {
    // Eb major on an Eb bass, which has the headroom for two octaves.
    const span = (difficultyId: string, kind: 'scales' | 'arpeggios') => {
      const exercise = generateExercise(
        options({ kind, difficulty: difficultyById(difficultyId), fifths: -3, seed: 4, bars: 16 }),
      );
      const pitches = exercise.notes.map((n) => n.writtenMidi);
      return Math.max(...pitches) - Math.min(...pitches);
    };

    for (const kind of ['scales', 'arpeggios'] as const) {
      expect(span('beginner', kind), `beginner ${kind}`).toBe(7);
      expect(span('easy', kind), `easy ${kind}`).toBe(12);
      expect(span('medium', kind), `medium ${kind}`).toBe(24);
      expect(span('hard', kind), `hard ${kind}`).toBe(24);
      expect(span('expert', kind), `expert ${kind}`).toBe(24);
    }
  });

  it('plays only the first five notes at Beginner', () => {
    // A fifth, not an octave: root, second, third, fourth, fifth and back down.
    const exercise = generateExercise(
      options({ kind: 'scales', difficulty: difficultyById('beginner'), fifths: -3, bars: 8 }),
    );
    const distinct = new Set(exercise.notes.map((n) => n.writtenMidi));
    expect(distinct.size).toBe(5);
  });

  it('uses root, third and fifth only for a Beginner arpeggio', () => {
    const exercise = generateExercise(
      options({ kind: 'arpeggios', difficulty: difficultyById('beginner'), fifths: -3, bars: 8 }),
    );
    const distinct = [...new Set(exercise.notes.map((n) => n.writtenMidi))].sort((a, b) => a - b);
    expect(distinct).toHaveLength(3);
    expect(distinct[1] - distinct[0]).toBe(4); // major third
    expect(distinct[2] - distinct[0]).toBe(7); // perfect fifth
  });

  it('shrinks the span where the instrument cannot hold it, and says so', () => {
    // Two octaves needs 24 semitones above the tonic. On an Eb bass, Eb affords
    // that and C does not — so the app has to be honest about which it will get.
    const ebBassInstrument = instrumentById('eb-bass');
    const medium = difficultyById('medium');

    expect(patternSpanFor(ebBassInstrument, 'treble', -3, medium)).toBe(24); // Eb
    expect(patternSpanFor(ebBassInstrument, 'treble', 0, medium)).toBe(12); // C

    // And what it reports must be what it actually generates.
    for (const fifths of [-5, -3, -2, 0, 2, 4]) {
      const exercise = generateExercise(
        options({ kind: 'scales', difficulty: medium, fifths, bars: 16 }),
      );
      const pitches = exercise.notes.map((n) => n.writtenMidi);
      expect(Math.max(...pitches) - Math.min(...pitches), `key ${fifths}`).toBe(
        patternSpanFor(ebBassInstrument, 'treble', fifths, medium),
      );
    }
  });

  it('keeps patterns inside the instrument, shrinking rather than overflowing', () => {
    // Three octaves does not fit most brass; the span has to give way rather
    // than run off the top.
    for (const instrumentId of ['cornet', 'tenor-horn', 'euphonium', 'eb-bass', 'bb-bass']) {
      const instrument = instrumentById(instrumentId);
      const [low, high] = writtenRange(instrument, 'treble');

      for (const difficultyId of ['beginner', 'easy', 'medium', 'hard', 'expert']) {
        const exercise = generateExercise(
          options({
            kind: 'scales',
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
        options({ kind: 'random', difficulty: difficultyById('easy'), seed, bars: 8 }),
      );
      for (const note of exercise.notes) values.add(note.duration.value);
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('spans at least a full octave, root to root', () => {
    for (const kind of ['scales', 'arpeggios'] as const) {
      const exercise = generateExercise(options({ kind, fifths: 0, bars: 16, seed: 3 }));
      const pitches = exercise.notes.map((n) => n.writtenMidi);
      expect(Math.max(...pitches) - Math.min(...pitches), kind).toBeGreaterThanOrEqual(12);
    }
  });

  it('leaps by chord tones in arpeggios, not by step', () => {
    const exercise = generateExercise(options({ kind: 'arpeggios', fifths: 0, bars: 16, seed: 6 }));
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

    for (const kind of ['random', 'phrases'] as const) {
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

  it('leaves scales and arpeggios alone', () => {
    // Their notes are fixed by the pattern; a scale that skipped a degree to
    // vary the fingering would not be a scale.
    for (const kind of ['scales', 'arpeggios'] as const) {
      const exercise = generateExercise(options({ kind, seed: 5, bars: 16 }));
      const steps = exercise.notes
        .slice(1)
        .map((note, i) => Math.abs(note.writtenMidi - exercise.notes[i].writtenMidi));
      expect(Math.max(...steps), kind).toBeLessThanOrEqual(kind === 'scales' ? 2 : 12);
    }
  });

  it('avoids starting on open valves, at the start and after every rest', () => {
    let openStarts = 0;
    let starts = 0;

    for (const kind of ['random', 'phrases'] as const) {
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
      for (const kind of ['random', 'phrases'] as const) {
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
      options({ difficulty: difficultyById('expert'), bars: 16, seed: 777 }),
    );

    // Tracks the alteration currently in force for each letter and octave.
    // Note that an intervening F natural legitimately requires the *next* F
    // sharp to be marked again, so only an unbroken repeat may go unmarked.
    let currentBar = -1;
    let inForce = new Map<string, number>();
    let checked = 0;

    for (const note of exercise.notes) {
      const bar = Math.floor(note.startBeat / exercise.metre.barBeats);
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
      options({ difficulty: difficultyById('expert'), bars: 16, seed: 777 }),
    );

    // The first note of each bar that departs from the key signature must carry
    // an accidental, regardless of what happened in the previous bar. Except a
    // tie continuation, which is not a new note at all: its accidental is on the
    // other side of the bar line, and the sound has never stopped.
    const barsSeen = new Set<number>();
    let checked = 0;

    for (const [index, note] of exercise.notes.entries()) {
      if (isTieContinuation(exercise.notes, index)) continue;
      const bar = Math.floor(note.startBeat / exercise.metre.barBeats);
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
      const bar = Math.floor(note.startBeat / exercise.metre.barBeats);
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
    const exercise = generateExercise(options({ difficulty: difficultyById('expert'), seed: 5 }));
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
