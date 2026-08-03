import { beforeEach, describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import type { NoteEvent } from '../exercise/types';
import { ValveInput } from './input';
import { judgeNote, summarise, toleranceFor } from './judge';

/**
 * The clock is driven by hand so these tests exercise real timing behaviour
 * without waiting for real time to pass.
 */
let now = 0;
let input: ValveInput;

beforeEach(() => {
  now = 0;
  input = new ValveInput(() => now);
});

function noteExpecting(masks: number[], startBeat = 0): NoteEvent {
  return {
    writtenMidi: 60,
    soundingMidi: 58,
    startBeat,
    duration: { value: 'quarter', dotted: false },
    acceptedMasks: masks,
    primaryMask: masks[0],
    beamGroup: -1,
    showAccidental: false,
  };
}

const SECONDS_PER_BEAT = 0.5; // 120 bpm

function judgeAt(note: NoteEvent, onsetTime: number) {
  return judgeNote(note, 0, onsetTime, 1, SECONDS_PER_BEAT, input);
}

describe('judging', () => {
  it('accepts a fingering held exactly on the beat', () => {
    now = 1.0;
    input.keyDown(1);
    input.keyDown(2);
    expect(judgeAt(noteExpecting([maskOf([1, 2])]), 1.0).verdict).toBe('correct');
  });

  it('accepts a fingering set slightly early', () => {
    now = 0.94;
    input.keyDown(1);
    const result = judgeAt(noteExpecting([maskOf([1])]), 1.0);
    expect(result.verdict).toBe('correct');
    // Already down when the note arrived, so on time rather than early.
    expect(result.timingOffset).toBe(0);
  });

  it('accepts a fingering set slightly late, and says how late', () => {
    now = 1.05;
    input.keyDown(1);
    const result = judgeAt(noteExpecting([maskOf([1])]), 1.0);
    expect(result.verdict).toBe('correct');
    expect(result.timingOffset).toBeCloseTo(0.05, 5);
  });

  it('rejects a fingering set far too late', () => {
    now = 1.4;
    input.keyDown(1);
    expect(judgeAt(noteExpecting([maskOf([1])]), 1.0).verdict).toBe('missed');
  });

  it('marks the wrong valves as wrong rather than missed', () => {
    now = 0.9;
    input.keyDown(3);
    const result = judgeAt(noteExpecting([maskOf([1, 2])]), 1.0);
    expect(result.verdict).toBe('wrong');
    expect(result.heldMask).toBe(maskOf([3]));
  });

  it('marks doing nothing as missed', () => {
    expect(judgeAt(noteExpecting([maskOf([1, 2])]), 1.0).verdict).toBe('missed');
  });

  it('treats an open hand as absent rather than wrong', () => {
    // Every other fingering takes a deliberate act. Open is also what an
    // instrument resting on a lap produces, so it is not evidence of an attempt.
    now = 0.7;
    input.keyDown(1);
    input.keyUp(1); // reached for something, then let go well before the beat

    const result = judgeAt(noteExpecting([maskOf([1, 2])]), 1.0);
    expect(result.heldMask).toBe(maskOf([]));
    expect(result.verdict).toBe('missed');
  });

  it('still marks a wrong fingering held at the beat as wrong', () => {
    // The exception is only for open; anything else is a real attempt.
    now = 0.98;
    input.keyDown(3);
    expect(judgeAt(noteExpecting([maskOf([1, 2])]), 1.0).verdict).toBe('wrong');
  });

  it('marks releasing into the beat as missed, not wrong', () => {
    // Valves down for the previous note, lifted just before this one: at the
    // beat there is nothing there, so nothing was played.
    now = 0.9;
    input.keyDown(1);
    input.keyDown(2);
    now = 0.95;
    input.releaseAll();

    expect(judgeAt(noteExpecting([maskOf([1, 3])]), 1.0).verdict).toBe('missed');
  });

  it('accepts open valves for an open note', () => {
    expect(judgeAt(noteExpecting([maskOf([])]), 1.0).verdict).toBe('correct');
  });

  it('rejects held valves on an open note', () => {
    now = 0.5;
    input.keyDown(2);
    expect(judgeAt(noteExpecting([maskOf([])]), 1.0).verdict).toBe('wrong');
  });

  it('accepts any of a note’s alternate fingerings', () => {
    now = 0.95;
    input.keyDown(3);
    // Written A is normally 1-2, but 3 is a genuine alternate.
    const note = noteExpecting([maskOf([1, 2]), maskOf([3])]);
    expect(judgeAt(note, 1.0).verdict).toBe('correct');
  });

  it('does not require a release between notes sharing a fingering', () => {
    // The player sets 1-2 once and holds it across four notes, which is what a
    // real player would do. Every one of them must count.
    now = 0.9;
    input.keyDown(1);
    input.keyDown(2);

    const mask = maskOf([1, 2]);
    for (const onset of [1.0, 1.5, 2.0, 2.5]) {
      expect(judgeAt(noteExpecting([mask]), onset).verdict).toBe('correct');
    }
  });
});

describe('tolerance', () => {
  it('is tighter for short notes than long ones', () => {
    const semiquaver = toleranceFor(0.25, 0.5);
    const minim = toleranceFor(2, 0.5);
    expect(semiquaver).toBeLessThan(minim);
  });

  it('never becomes unfairly tight, however fast the tempo', () => {
    // Semiquavers at 200bpm.
    expect(toleranceFor(0.25, 0.3)).toBeGreaterThanOrEqual(0.06);
  });

  it('never grows wide enough to swallow neighbouring notes', () => {
    expect(toleranceFor(4, 1.5)).toBeLessThanOrEqual(0.2);
  });

  it('scales by the player’s setting', () => {
    const strict = toleranceFor(1, 0.5, 0.5);
    const normal = toleranceFor(1, 0.5, 1);
    const relaxed = toleranceFor(1, 0.5, 3);

    expect(strict).toBeCloseTo(normal / 2, 6);
    expect(relaxed).toBeCloseTo(normal * 3, 6);
  });

  it('scales the clamps too, not just the middle of the range', () => {
    // A crotchet already sits on the upper clamp at a slow tempo, and a
    // semiquaver on the lower one. If the setting only scaled the unclamped
    // figure it would do nothing at either extreme — which is exactly where
    // someone reaching for the slider is most likely to be.
    const slowCrotchet = { beats: 1, secondsPerBeat: 0.75 };
    const fastSemiquaver = { beats: 0.25, secondsPerBeat: 0.5 };

    for (const { beats, secondsPerBeat } of [slowCrotchet, fastSemiquaver]) {
      const normal = toleranceFor(beats, secondsPerBeat, 1);
      expect(toleranceFor(beats, secondsPerBeat, 2)).toBeCloseTo(normal * 2, 6);
      expect(toleranceFor(beats, secondsPerBeat, 0.5)).toBeCloseTo(normal / 2, 6);
    }
  });
});

describe('judging with a relaxed window', () => {
  it('accepts a fingering that the strict window would reject', () => {
    // 180ms after the beat: ordinary reaction time for reading a note and then
    // moving, and outside the ±150ms the default gives a crotchet at 120bpm.
    now = 1.18;
    input.keyDown(1);
    const note = noteExpecting([maskOf([1])]);

    expect(judgeNote(note, 0, 1.0, 1, SECONDS_PER_BEAT, input, 1).verdict).toBe('missed');
    expect(judgeNote(note, 0, 1.0, 1, SECONDS_PER_BEAT, input, 2).verdict).toBe('correct');
  });

  it('still rejects a fingering that never arrives', () => {
    // Relaxing the window must not turn "did nothing" into a pass.
    const note = noteExpecting([maskOf([1])]);
    expect(judgeNote(note, 0, 1.0, 1, SECONDS_PER_BEAT, input, 3).verdict).toBe('missed');
  });

  it('still rejects the wrong valves, however generous the window', () => {
    now = 1.0;
    input.keyDown(3);
    const note = noteExpecting([maskOf([1, 2])]);
    expect(judgeNote(note, 0, 1.0, 1, SECONDS_PER_BEAT, input, 3).verdict).toBe('wrong');
  });
});

describe('summarising a run', () => {
  it('counts verdicts, tracks streaks and totals accuracy per note', () => {
    const notes = [
      { ...noteExpecting([0]), writtenMidi: 60 },
      { ...noteExpecting([0]), writtenMidi: 62 },
      { ...noteExpecting([0]), writtenMidi: 60 },
      { ...noteExpecting([0]), writtenMidi: 60 },
    ];
    const summary = summarise(notes, [
      { noteIndex: 0, verdict: 'correct', heldMask: 0, timingOffset: 0 },
      { noteIndex: 1, verdict: 'wrong', heldMask: 1, timingOffset: null },
      { noteIndex: 2, verdict: 'correct', heldMask: 0, timingOffset: 0 },
      { noteIndex: 3, verdict: 'correct', heldMask: 0, timingOffset: 0 },
    ]);

    expect(summary.correct).toBe(3);
    expect(summary.wrong).toBe(1);
    expect(summary.accuracy).toBeCloseTo(0.75);
    expect(summary.longestStreak).toBe(2);
    expect(summary.byNote.get(60)).toEqual({ attempts: 3, correct: 3 });
    expect(summary.byNote.get(62)).toEqual({ attempts: 1, correct: 0 });
  });

  it('keeps the individual verdicts, not only the totals', () => {
    // The results screen puts the exercise back on a stave with each note in
    // its own colour. Totals cannot say which note went wrong.
    const notes = [noteExpecting([0]), noteExpecting([0])];
    const judgements = [
      { noteIndex: 0, verdict: 'correct' as const, heldMask: 0, timingOffset: 0 },
      { noteIndex: 1, verdict: 'missed' as const, heldMask: 0, timingOffset: null },
    ];

    expect(summarise(notes, judgements).judgements).toEqual(judgements);
  });
});
