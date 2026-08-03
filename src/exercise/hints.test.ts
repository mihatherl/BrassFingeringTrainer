import { describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import type { Duration } from '../domain/rhythm';
import type { NoteStats } from '../storage/stats';
import { fingeringHints } from './hints';
import type { Exercise, NoteEvent } from './types';

/**
 * Which notes get their fingering printed over them.
 *
 * The rules are about judgement rather than arithmetic — a hint nobody has time
 * to read is worse than no hint, and a page covered in them teaches reading
 * digits instead of reading notes — so these tests are written as the cases
 * that judgement has to get right.
 */

const SLOW = 60 / 80; // 0.75s a beat
const FAST = 60 / 200; // 0.3s a beat

const LENGTHS: Record<Duration['value'], number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
};

/** An exercise built from bars of (pitch, note value) pairs. */
function exerciseOf(bars: Array<Array<[number, Duration['value']]>>): Exercise {
  const notes: NoteEvent[] = [];
  let beat = 0;

  for (const bar of bars) {
    for (const [midi, value] of bar) {
      notes.push({
        writtenMidi: midi,
        soundingMidi: midi - 21,
        startBeat: beat,
        duration: { value, dotted: false },
        acceptedMasks: [maskOf([1, 2])],
        primaryMask: maskOf([1, 2]),
        beamGroup: -1,
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
    fifths: -3,
    beatsPerBar: 4,
    beatUnit: 4,
    totalBeats: bars.length * 4,
    seed: 1,
    kind: 'random',
  };
}

function statsOf(entries: Record<number, [attempts: number, correct: number]>): NoteStats {
  return new Map(
    Object.entries(entries).map(([midi, [attempts, correct]]) => [Number(midi), { attempts, correct }]),
  );
}

/** Two out of ten: a note that plainly needs help. */
const STRUGGLING: [number, number] = [10, 2];
/** Nine out of ten: a note that does not. */
const FLUENT: [number, number] = [10, 9];

describe('choosing which notes to hint', () => {
  it('hints a note the player keeps getting wrong', () => {
    const exercise = exerciseOf([[[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']]]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: STRUGGLING }),
      secondsPerBeat: SLOW,
    });

    expect(hints.get(0)).toBe('1-2');
  });

  it('leaves alone the notes already known', () => {
    // A fingering over a note the player has is not a reminder; it is something
    // to read past, and it teaches reading digits rather than reading notes.
    const exercise = exerciseOf([[[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']]]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: FLUENT, 69: FLUENT }),
      secondsPerBeat: SLOW,
    });

    expect(hints.size).toBe(0);
  });

  it('waits for evidence before calling a note weak', () => {
    // One miss is an accident. Hinting on it would put digits over half the
    // page for anyone's first run.
    const exercise = exerciseOf([[[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']]]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: [1, 0] }),
      secondsPerBeat: SLOW,
    });

    expect(hints.size).toBe(0);
  });

  it('says nothing about a note that has never been played', () => {
    const exercise = exerciseOf([[[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']]]);
    expect(fingeringHints({ exercise, stats: new Map(), secondsPerBeat: SLOW }).size).toBe(0);
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
      secondsPerBeat: SLOW,
    });

    expect(hints.size).toBe(0);
  });

  it('judges by the clock rather than the note value', () => {
    // The same crotchet: worth hinting at 80, useless at 200. A crotchet at
    // 200bpm is shorter than a quaver at 60.
    const exercise = exerciseOf([[[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']]]);
    const stats = statsOf({ 67: STRUGGLING });

    expect(fingeringHints({ exercise, stats, secondsPerBeat: SLOW }).size).toBe(1);
    expect(fingeringHints({ exercise, stats, secondsPerBeat: FAST }).size).toBe(0);
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
      secondsPerBeat: SLOW,
    });

    expect(hints.has(0)).toBe(false);
  });
});

describe('keeping the page readable', () => {
  it('prints at most one to a bar', () => {
    const exercise = exerciseOf([
      [[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']],
      [[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']],
    ]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: STRUGGLING, 69: STRUGGLING, 71: STRUGGLING, 72: STRUGGLING }),
      secondsPerBeat: SLOW,
    });

    expect(hints.size).toBe(2);
  });

  it('gives the one hint to the worst note in the bar', () => {
    // Two weak notes in a bar, one hint: it should go where it is needed more,
    // rather than to whichever happened to come first.
    const exercise = exerciseOf([[[67, 'quarter'], [69, 'quarter'], [71, 'quarter'], [72, 'quarter']]]);
    const hints = fingeringHints({
      exercise,
      stats: statsOf({ 67: [10, 6], 69: [10, 1] }),
      secondsPerBeat: SLOW,
    });

    expect([...hints.keys()]).toEqual([1]);
  });
});
