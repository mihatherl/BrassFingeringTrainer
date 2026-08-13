import { metreFor } from '../domain/metre';
import { describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import { spellInKey } from '../domain/keys';
import type { Duration } from '../domain/rhythm';
import type { NoteStats } from '../storage/stats';
import { fingeringHints, type Hints } from './hints';
import type { Exercise, NoteEvent } from './types';

/**
 * Which notes get their fingering printed over them.
 *
 * The rules are about judgement rather than arithmetic — a hint nobody has time
 * to read is worse than no hint — so these tests are written as the cases that
 * judgement has to get right. The largest of them is the newest: **a mistake is
 * answered inside the run it was made in**, over the note that went wrong and
 * over every later note of that pitch.
 */

const SLOW = 60 / 80; // 0.75s a beat
const FAST = 60 / 200; // 0.3s a beat

/**
 * A steady tempo, in the form the hints ask for.
 *
 * These cases are all about how much *time* a note has, and a constant tempo is
 * the simplest map that answers that — but the question is asked of a function
 * rather than of a number, so the same tests keep working when the tempo can
 * change part-way through a bar, which it now can.
 */
const at = (secondsPerBeat: number) => (from: number, to: number) => (to - from) * secondsPerBeat;

const LENGTHS: Record<Duration['value'], number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirtySecond: 0.125,
};

/** An exercise built from bars of (pitch, note value) pairs. */
function exerciseOf(bars: Array<Array<[number, Duration['value']]>>): Exercise {
  const notes: NoteEvent[] = [];
  let beat = 0;

  for (const bar of bars) {
    for (const [midi, value] of bar) {
      notes.push({
        writtenMidi: midi,
        pitch: spellInKey(midi, 0),
        soundingMidi: midi - 21,
        startBeat: beat,
        duration: { value, dotted: false },
        acceptedMasks: [maskOf([1, 2])],
        primaryMask: maskOf([1, 2]),
        beamGroup: -1,
        tupletGroup: -1,
        tiedToNext: false,
        showAccidental: false,
      });
      beat += LENGTHS[value];
    }
  }

  return {
    notes,
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: -3 }],
    metres: [{ fromBeat: 0, metre: metreFor(4, 4) }],
    tempo: [],
    totalBeats: bars.length * 4,
    chosenBeats: bars.length * 4,
    seed: 1,
    kind: 'random',
  };
}

function statsOf(entries: Record<number, [attempts: number, correct: number]>): NoteStats {
  return new Map(
    Object.entries(entries).map(([midi, [attempts, correct]]) => [Number(midi), { attempts, correct }]),
  );
}

/** Which notes are carrying a hint, by index. */
function printed(hints: Hints, exercise: Exercise): number[] {
  return exercise.notes.map((_, index) => index).filter((index) => hints.for(index) !== undefined);
}

/** Two out of ten: a note that plainly needs help. */
const STRUGGLING: [number, number] = [10, 2];
/** Nine out of ten: a note that does not. */
const FLUENT: [number, number] = [10, 9];

const FOUR_CROTCHETS: Array<[number, Duration['value']]> = [
  [67, 'quarter'],
  [69, 'quarter'],
  [71, 'quarter'],
  [72, 'quarter'],
];

describe('choosing which notes to hint', () => {
  it('hints a note the player keeps getting wrong', () => {
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: STRUGGLING }),
      secondsBetween: at(SLOW),
    });

    expect(hints.for(0)).toBe('1-2');
  });

  it('leaves alone the notes already known', () => {
    // A fingering over a note the player has is not a reminder; it is something
    // to read past, and it teaches reading digits rather than reading notes.
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: FLUENT, 69: FLUENT }),
      secondsBetween: at(SLOW),
    });

    expect(printed(hints, exercise)).toEqual([]);
  });

  it('waits for evidence before calling a note weak', () => {
    // One miss is an accident. Hinting on it would put digits over half the
    // page for anyone's first run.
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: [1, 0] }),
      secondsBetween: at(SLOW),
    });

    expect(printed(hints, exercise)).toEqual([]);
  });

  it('says nothing about a note that has never been played', () => {
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    const hints = fingeringHints({ exercise, stats: new Map(), secondsBetween: at(SLOW) });
    expect(printed(hints, exercise)).toEqual([]);
  });

  it('hints every note that has earned one, not one a bar', () => {
    /*
     * There used to be a cap of one a bar, and the worst note in each bar took
     * it. The player asked for it gone: fingerings are the thing this app
     * teaches, a hint only ever appears where something has actually gone
     * wrong, and a run that has earned eight of them should be given eight.
     */
    const exercise = exerciseOf([FOUR_CROTCHETS, FOUR_CROTCHETS]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: STRUGGLING, 69: STRUGGLING, 71: STRUGGLING, 72: STRUGGLING }),
      secondsBetween: at(SLOW),
    });

    expect(printed(hints, exercise)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('leaving time to read one', () => {
  it('skips a note inside a run', () => {
    // Eight quavers to the bar at 80: a hint arrives and is gone in under the
    // time it takes to read it and move, so the player is already committed.
    const exercise = exerciseOf([new Array(8).fill([67, 'eighth'] as [number, Duration['value']])]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: STRUGGLING }),
      secondsBetween: at(SLOW),
    });

    expect(printed(hints, exercise)).toEqual([]);
  });

  it('judges by the clock rather than the note value', () => {
    // The same crotchet: worth hinting at 80, useless at 200. A crotchet at
    // 200bpm is shorter than a quaver at 60.
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    const stats = statsOf({ 67: STRUGGLING });

    expect(printed(fingeringHints({ exercise, stats, secondsBetween: at(SLOW) }), exercise)).toEqual([0]);
    expect(printed(fingeringHints({ exercise, stats, secondsBetween: at(FAST) }), exercise)).toEqual([]);
  });

  it('measures the room to the next note, not the note itself', () => {
    // A crotchet followed immediately by a run has no more room above it than
    // the run does. The note's written value says otherwise.
    const crowded = exerciseOf([
      [
        [67, 'quarter'],
        [69, 'sixteenth'],
        [71, 'sixteenth'],
        [72, 'sixteenth'],
        [74, 'sixteenth'],
        [76, 'quarter'],
        [77, 'quarter'],
      ],
    ]);
    // The written crotchet at index 0 lasts a beat, but the next note arrives
    // in a quarter of one.
    crowded.notes[1].startBeat = 0.25;

    const hints = fingeringHints({
      exercise: crowded,
      stats: statsOf({ 67: STRUGGLING }),
      secondsBetween: at(SLOW),
    });

    expect(hints.for(0)).toBeUndefined();
  });

  it('measures again when the player changes the tempo', () => {
    // The slider on the play screen is a tempo the hints have to follow: a note
    // with no time to read at 200 has plenty at 80, and slowing down is exactly
    // what a player does when they want the help.
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    let secondsPerBeat = FAST;
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: STRUGGLING }),
      secondsBetween: (from, to) => (to - from) * secondsPerBeat,
    });

    expect(hints.for(0)).toBeUndefined();

    secondsPerBeat = SLOW;
    hints.retime();
    expect(hints.for(0)).toBe('1-2');
  });
});

describe('answering a mistake as it happens', () => {
  const noHistory = () => new Map<number, { attempts: number; correct: number }>();

  it('answers the note that went wrong, where it stands', () => {
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    const hints = fingeringHints({ exercise, stats: noHistory(), secondsBetween: at(SLOW) });

    expect(hints.for(1)).toBeUndefined();
    hints.wentWrong(1);
    expect(hints.for(1)).toBe('1-2');
  });

  it('answers it even where there was no time to read one', () => {
    /*
     * The exemption that makes this instructional rather than decorative. The
     * reading rule asks whether a hint arrives in time to be *used*; this note
     * is behind the player and nothing is going to be played to it. What it is
     * doing is telling them what they should have held — which is the job the
     * list of recent notes was doing badly.
     */
    const exercise = exerciseOf([new Array(8).fill([67, 'eighth'] as [number, Duration['value']])]);
    const hints = fingeringHints({ exercise, stats: noHistory(), secondsBetween: at(SLOW) });

    hints.wentWrong(3);
    expect(hints.for(3)).toBe('1-2');
    // And only that one: the rest of the run is still unreadable at this speed.
    expect(printed(hints, exercise)).toEqual([3]);
  });

  it('prompts every later note of the pitch that went wrong', () => {
    // The mistake is about the pitch, not about the one place it appeared.
    const exercise = exerciseOf([
      [[67, 'quarter'], [69, 'quarter'], [67, 'quarter'], [72, 'quarter']],
      [[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [67, 'quarter']],
    ]);
    const hints = fingeringHints({ exercise, stats: noHistory(), secondsBetween: at(SLOW) });

    hints.wentWrong(2);

    // Not the G before it — that one went by, and a hint appearing over music
    // already read is noise on the paged screen, where it stays on the page.
    expect(printed(hints, exercise)).toEqual([2, 4, 7]);
  });

  it('says nothing at the far end of a tie, which was never played', () => {
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    exercise.notes[0].tiedToNext = true;
    exercise.notes[1].writtenMidi = exercise.notes[0].writtenMidi;
    const hints = fingeringHints({ exercise, stats: noHistory(), secondsBetween: at(SLOW) });

    hints.wentWrong(0);

    // The head is answered; the continuation asked nothing of the player and a
    // fingering over it would be an instruction to move during a tied note.
    expect(hints.for(0)).toBe('1-2');
    expect(hints.for(1)).toBeUndefined();
  });

  it('leaves the space at a tempo mark to the mark', () => {
    // Two things printed in the same air read as neither, and of the two the
    // mark is the one the player cannot do without.
    const exercise = exerciseOf([FOUR_CROTCHETS]);
    exercise.tempo = [{ kind: 'tempo', atBeat: 2, bpm: 96 }];
    const hints = fingeringHints({ exercise, stats: noHistory(), secondsBetween: at(SLOW) });

    hints.wentWrong(2);
    expect(hints.for(2)).toBeUndefined();
  });
});
