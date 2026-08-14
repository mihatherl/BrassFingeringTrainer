import { metreAt, metreFor } from '../domain/metre';
import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { spellInKey } from '../domain/keys';
import { durationBeats, durationFromBeats } from '../domain/rhythm';
import { DIFFICULTIES, difficultyById } from './difficulty';
import { generateExercise, type GenerateOptions } from './generate';
import { isTieContinuation, nextSoundedIndex, soundingHeads, tiedBeats } from './ties';
import { isUnplayable } from './types';
import type { NoteEvent } from './types';

const ebBass = instrumentById('eb-bass');

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    instrument: ebBass,
    clef: 'treble',
    fifths: -3, // Eb major
    difficulty: difficultyById('hard'),
    kind: 'phrases',
    bars: 12,
    cycles: 2,
    themeCount: 2,
    metre: metreFor(4, 4),
    seed: 1,
    ...overrides,
  };
}

/** A bare note, for the helpers — only the tie and the duration matter here. */
function note(startBeat: number, beats: number, tiedToNext = false): NoteEvent {
  return {
    writtenMidi: 60,
    pitch: spellInKey(60, 0),
    soundingMidi: 60,
    startBeat,
    duration: durationFromBeats(beats)!,
    acceptedMasks: [0],
    primaryMask: 0,
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext,
    showAccidental: false,
  };
}

describe('reading a tie', () => {
  it('calls the note after a tie a continuation, and nothing else', () => {
    const notes = [note(0, 1, true), note(1, 1), note(2, 1)];
    expect(notes.map((_, i) => isTieContinuation(notes, i))).toEqual([false, true, false]);
  });

  it('measures a chain of ties end to end', () => {
    // Crotchet tied to a minim tied to a crotchet: one four-beat note, however
    // it happens to be spelled.
    const notes = [note(0, 1, true), note(1, 2, true), note(3, 1), note(4, 1)];
    expect(tiedBeats(notes, 0)).toBe(4);
    expect(tiedBeats(notes, 1)).toBe(3);
    expect(tiedBeats(notes, 3)).toBe(1);
  });

  it('points every note at the one that sounds it', () => {
    const notes = [note(0, 1), note(1, 1, true), note(2, 1), note(3, 1)];
    expect(soundingHeads(notes)).toEqual([0, 1, 1, 3]);
  });

  it('skips the whole of a tie when looking for the next note to play', () => {
    // Three notes, one sound: the next thing the player has to do is note 3.
    const notes = [note(0, 1, true), note(1, 1, true), note(2, 1), note(3, 1)];
    expect(nextSoundedIndex(notes, 0)).toBe(3);
    expect(nextSoundedIndex(notes, 1)).toBe(3);
    expect(nextSoundedIndex(notes, 3)).toBeNull();
  });
});

describe('generating ties', () => {
  it('ties over the bar line and nowhere else', () => {
    // The reason ties exist here: a note that crosses a bar line cannot be
    // written any other way. One that fits inside its bar can, and should be.
    let found = 0;

    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 20; seed++) {
        const exercise = generateExercise(options({ difficulty, seed }));
        exercise.notes.forEach((head, index) => {
          if (!head.tiedToNext) return;
          const tail = exercise.notes[index + 1];
          expect(tail, 'a tie must have something to tie to').toBeDefined();

          const bar = Math.floor(head.startBeat / metreAt(exercise.metres, 0).barBeats);
          const tailBar = Math.floor(tail.startBeat / metreAt(exercise.metres, 0).barBeats);
          expect(tailBar, 'ties cross a bar line').toBe(bar + 1);
          expect(tail.startBeat % metreAt(exercise.metres, 0).barBeats, 'the tail lands on a downbeat').toBe(0);
          expect(
            head.startBeat + durationBeats(head.duration),
            'the head fills its bar exactly',
          ).toBe(tail.startBeat);
          found++;
        });
      }
    }

    expect(found, 'no ties were generated at all').toBeGreaterThan(20);
  });

  it('gives both ends the same pitch and the same fingering', () => {
    // A tie is one note. Two pitches joined by a curve is a slur, which means
    // something else entirely and would be judged differently.
    for (let seed = 1; seed <= 30; seed++) {
      const exercise = generateExercise(options({ seed, kind: 'phrases' }));
      exercise.notes.forEach((head, index) => {
        if (!head.tiedToNext) return;
        const tail = exercise.notes[index + 1];
        expect(tail.writtenMidi).toBe(head.writtenMidi);
        expect(tail.soundingMidi).toBe(head.soundingMidi);
        expect(tail.primaryMask).toBe(head.primaryMask);
        expect(tail.acceptedMasks).toEqual(head.acceptedMasks);
      });
    }
  });

  it('writes both halves as real note values', () => {
    // A tie is two notes, not a licence to write an arbitrary length. Anything
    // `durationFromBeats` cannot spell would have no glyph to draw.
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 20; seed++) {
        const exercise = generateExercise(options({ difficulty, seed }));
        for (const n of exercise.notes) {
          expect(durationFromBeats(durationBeats(n.duration)), `${n.startBeat}`).not.toBeNull();
        }
      }
    }
  });

  it('still fills every bar exactly', () => {
    // Letting a note overrun its bar is the one liberty taken here, and it is
    // paid back immediately by the tail. Nothing else may drift.
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 10; seed++) {
        const exercise = generateExercise(options({ difficulty, seed }));
        const filled = new Map<number, number>();
        for (const slot of [...exercise.notes, ...exercise.rests]) {
          const bar = Math.floor(slot.startBeat / metreAt(exercise.metres, 0).barBeats);
          filled.set(bar, (filled.get(bar) ?? 0) + durationBeats(slot.duration));
        }

        // Every bar but the last accounts for exactly its own length; a tie
        // hands the overrun to the bar it lands in rather than losing it.
        const bars = exercise.totalBeats / metreAt(exercise.metres, 0).barBeats;
        let running = 0;
        for (let bar = 0; bar < bars; bar++) {
          running += filled.get(bar) ?? 0;
          const carried = running - (bar + 1) * metreAt(exercise.metres, 0).barBeats;
          expect(carried, `bar ${bar + 1} of ${difficulty.id}`).toBeGreaterThanOrEqual(0);
          expect(carried).toBeLessThan(metreAt(exercise.metres, 0).barBeats);
        }
      }
    }
  });

  it('leaves the easy levels and the patterns alone', () => {
    // Ties arrive at Medium, and never in a scale: that drill is the shape and
    // the fingering, and a tie there is a reading problem laid on top of it.
    for (const difficulty of DIFFICULTIES) {
      for (const kind of ['phrases', 'scales', 'arpeggios'] as const) {
        const quiet = difficulty.tieChance === 0 || kind === 'scales' || kind === 'arpeggios';
        if (!quiet) continue;

        for (let seed = 1; seed <= 15; seed++) {
          const exercise = generateExercise(options({ difficulty, kind, seed }));
          expect(
            exercise.notes.some((n) => n.tiedToNext),
            `${difficulty.id} ${kind}`,
          ).toBe(false);
        }
      }
    }
  });

  it('never ties out of the last bar', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 20; seed++) {
        const exercise = generateExercise(options({ difficulty, seed, bars: 4 }));
        const last = exercise.notes[exercise.notes.length - 1];
        expect(last.tiedToNext, `${difficulty.id} seed ${seed}`).toBe(false);
      }
    }
  });

  it('never writes an accidental on the far end of a tie', () => {
    /*
     * The accidental is on the other side of the bar line, and the sound has
     * never stopped. Repeating it would say the note had been struck again.
     */
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const exercise = generateExercise(
        options({ difficulty: difficultyById('hard'), seed, fifths: 0 }),
      );
      exercise.notes.forEach((n, index) => {
        if (!isTieContinuation(exercise.notes, index)) return;
        expect(n.showAccidental).toBe(false);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('compound time', () => {
  /*
   * Not reachable from the settings screen yet, but the generator can be handed
   * a compound metre directly — and it is the one case where the numerator and
   * the length of a bar disagree, so it is the only way to prove they are no
   * longer being confused.
   */
  it('fills a bar of 6/8 with three crotchets, not six', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const exercise = generateExercise(options({ metre: metreFor(6, 8), seed, bars: 6 }));
      expect(exercise.totalBeats).toBe(18);

      const filled = new Map<number, number>();
      for (const slot of [...exercise.notes, ...exercise.rests]) {
        const bar = Math.floor(slot.startBeat / 3);
        filled.set(bar, (filled.get(bar) ?? 0) + durationBeats(slot.duration));
      }
      // Ties may carry across a bar line, so bars are checked cumulatively.
      let running = 0;
      for (let bar = 0; bar < 6; bar++) {
        running += filled.get(bar) ?? 0;
        expect(running - (bar + 1) * 3, `bar ${bar + 1}`).toBeGreaterThanOrEqual(0);
        expect(running - (bar + 1) * 3).toBeLessThan(3);
      }
    }
  });

  it('beams quavers in threes rather than in twos', () => {
    // The whole visual difference between 6/8 and 3/4. Grouping by crotchet
    // would break every dotted-crotchet group in half.
    let groupsSeen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const exercise = generateExercise(options({ metre: metreFor(6, 8), seed, bars: 8 }));
      const groups = new Map<number, number[]>();
      for (const note of exercise.notes) {
        if (note.beamGroup < 0) continue;
        const group = groups.get(note.beamGroup) ?? [];
        group.push(note.startBeat);
        groups.set(note.beamGroup, group);
      }

      for (const beats of groups.values()) {
        groupsSeen++;
        // Every note of a group belongs to the same dotted crotchet.
        const pulses = new Set(beats.map((b) => Math.floor(b / 1.5 + 1e-9)));
        expect(pulses.size, `group spanning ${beats.join(', ')}`).toBe(1);
      }
    }
    expect(groupsSeen, 'no beam groups to check').toBeGreaterThan(10);
  });
});

/**
 * A note the instrument cannot play is not judged, for the same reason the far
 * end of a tie is not: it asked nothing the player could have answered.
 */
describe('a note with no fingering', () => {
  const noteWith = (acceptedMasks: number[]): NoteEvent => ({
    writtenMidi: 67,
    soundingMidi: 46,
    pitch: spellInKey(67, 0),
    startBeat: 0,
    duration: { value: 'quarter', dotted: false },
    acceptedMasks,
    primaryMask: 0,
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext: false,
    showAccidental: false,
  });

  it('is recognisable from the note alone', () => {
    // An empty accepted list is not "no alternate fingerings" — it is no
    // fingering at all, which only an imported part can produce.
    expect(isUnplayable(noteWith([0b011]))).toBe(false);
    expect(isUnplayable(noteWith([]))).toBe(true);
  });
});
