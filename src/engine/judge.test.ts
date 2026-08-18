import { beforeEach, describe, expect, it } from 'vitest';
import { maskOf } from '../domain/fingering';
import { spellInKey } from '../domain/keys';
import type { NoteEvent } from '../exercise/types';
import { ValveInput } from './input';
import {
  isAlreadyCorrect,
  judgeNote,
  summarise,
  toleranceFor,
  windowJudgements,
  type NoteJudgement,
} from './judge';
import { metreFor } from '../domain/metre';

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
    pitch: spellInKey(60, 0),
    soundingMidi: 58,
    startBeat,
    duration: { value: 'quarter', dotted: false },
    acceptedMasks: masks,
    primaryMask: masks[0],
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext: false,
    showAccidental: false,
  };
}

/** A crotchet at 120bpm, which is what almost every case below is judging. */
const CROTCHET = 0.5;

function judgeAt(note: NoteEvent, onsetTime: number) {
  return judgeNote(note, 0, onsetTime, CROTCHET, input);
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
    input.release();

    expect(judgeAt(noteExpecting([maskOf([1, 3])]), 1.0).verdict).toBe('missed');
  });

  it('accepts open valves for an open note, at the start of a run', () => {
    // No note before it to look back over: benefit of the doubt.
    expect(judgeAt(noteExpecting([maskOf([])]), 1.0).verdict).toBe('correct');
  });

  /*
   * An open hand from a player who has not touched a valve is an instrument
   * on a lap. Until v2.21.0 a run played by nobody scored every open note
   * correct — a quarter of an E flat bass part for doing nothing. The
   * player's rule: an open note counts if some fingering was played on at
   * least one of the two notes before it.
   */
  describe('an open note asks for evidence the player is playing', () => {
    const open = noteExpecting([maskOf([])]);
    const judgeOpen = (activeSince: number | null) =>
      judgeNote(open, 0, 2.0, CROTCHET, input, 1, activeSince);

    it('is missed for a player who has held nothing since the notes before', () => {
      // Two notes back began at 1.0; nothing has been pressed at all.
      expect(judgeOpen(1.0).verdict).toBe('missed');
    });

    it('is correct for a player who had a valve down within the two notes before', () => {
      now = 1.2;
      input.keyDown(1);
      now = 1.4;
      input.keyUp(1);
      expect(judgeOpen(1.0).verdict).toBe('correct');
      // But not one whose last press was before the window looked at.
      expect(judgeOpen(1.5).verdict).toBe('missed');
    });

    it('accepts an alternate fingering with a valve in it without asking', () => {
      // 1-3 for a G is a deliberate act; nobody presses it by accident.
      now = 1.95;
      input.keyDown(1);
      input.keyDown(3);
      const g = noteExpecting([maskOf([]), maskOf([1, 3])]);
      expect(judgeNote(g, 0, 2.0, CROTCHET, input, 1, 1.0).verdict).toBe('correct');
    });

    it('is not fooled by a valve pressed only after the note', () => {
      now = 2.5;
      input.keyDown(1);
      expect(judgeOpen(1.0).verdict).toBe('missed');
    });
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
    expect(toleranceFor(0.25 * 0.3)).toBeGreaterThanOrEqual(0.06);
  });

  it('never grows wide enough to swallow neighbouring notes', () => {
    expect(toleranceFor(4 * 1.5)).toBeLessThanOrEqual(0.2);
  });

  it('scales by the player’s setting', () => {
    const strict = toleranceFor(CROTCHET, 0.5);
    const normal = toleranceFor(CROTCHET, 1);
    const relaxed = toleranceFor(CROTCHET, 3);

    expect(strict).toBeCloseTo(normal / 2, 6);
    expect(relaxed).toBeCloseTo(normal * 3, 6);
  });

  it('scales the clamps too, not just the middle of the range', () => {
    // A crotchet already sits on the upper clamp at a slow tempo, and a
    // semiquaver on the lower one. If the setting only scaled the unclamped
    // figure it would do nothing at either extreme — which is exactly where
    // someone reaching for the slider is most likely to be.
    const slowCrotchet = 1 * 0.75;
    const fastSemiquaver = 0.25 * 0.5;

    for (const seconds of [slowCrotchet, fastSemiquaver]) {
      const normal = toleranceFor(seconds, 1);
      expect(toleranceFor(seconds, 2)).toBeCloseTo(normal * 2, 6);
      expect(toleranceFor(seconds, 0.5)).toBeCloseTo(normal / 2, 6);
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

    expect(judgeNote(note, 0, 1.0, CROTCHET, input, 1).verdict).toBe('missed');
    expect(judgeNote(note, 0, 1.0, CROTCHET, input, 2).verdict).toBe('correct');
  });

  it('still rejects a fingering that never arrives', () => {
    // Relaxing the window must not turn "did nothing" into a pass.
    const note = noteExpecting([maskOf([1])]);
    expect(judgeNote(note, 0, 1.0, CROTCHET, input, 3).verdict).toBe('missed');
  });

  it('still rejects the wrong valves, however generous the window', () => {
    now = 1.0;
    input.keyDown(3);
    const note = noteExpecting([maskOf([1, 2])]);
    expect(judgeNote(note, 0, 1.0, CROTCHET, input, 3).verdict).toBe('wrong');
  });
});

describe('confirming a note as it is played', () => {
  /*
   * The display confirms a note the moment it comes right, because a verdict
   * cannot be known until the window closes — most of a note after the act that
   * earned it, and close enough to the next note to be taken for a cue.
   */
  const ONSET = 1.0;
  const TOLERANCE = toleranceFor(CROTCHET);

  const correctYet = (note: NoteEvent) =>
    isAlreadyCorrect(note, ONSET, TOLERANCE, input, now);

  it('says nothing until the right fingering arrives', () => {
    const note = noteExpecting([maskOf([1, 2])]);

    now = ONSET - TOLERANCE;
    expect(correctYet(note)).toBe(false);

    now = ONSET;
    input.keyDown(1);
    expect(correctYet(note)).toBe(false);

    input.keyDown(2);
    expect(correctYet(note)).toBe(true);
  });

  it('confirms within the tick the fingering lands, not at the end of the window', () => {
    const note = noteExpecting([maskOf([1])]);

    now = ONSET - TOLERANCE;
    input.keyDown(1);

    // A hundredth of a second later, which is one turn of the session loop.
    now = ONSET - TOLERANCE + 0.01;
    expect(correctYet(note)).toBe(true);
    // The verdict itself is still the better part of half a second away.
    expect(ONSET + TOLERANCE - now).toBeGreaterThan(0.2);
  });

  it('does not confirm an open note for a player who has held nothing', () => {
    // The green would be applause for an instrument on a lap.
    const open = noteExpecting([maskOf([])]);
    now = ONSET;
    expect(isAlreadyCorrect(open, ONSET, TOLERANCE, input, now, 0)).toBe(false);
    // With no earlier note to look at, it stands.
    expect(isAlreadyCorrect(open, ONSET, TOLERANCE, input, now, null)).toBe(true);
  });

  it('does not take it back once given', () => {
    // Nothing later can undo a note that was played correctly, so the
    // confirmation stands even after the fingers have moved on.
    const note = noteExpecting([maskOf([1])]);

    now = ONSET;
    input.keyDown(1);
    now = ONSET + 0.02;
    input.keyUp(1);
    input.keyDown(3);

    now = ONSET + TOLERANCE;
    expect(correctYet(note)).toBe(true);
  });

  it('ignores a fingering that came and went before the window opened', () => {
    const note = noteExpecting([maskOf([2])]);

    now = ONSET - TOLERANCE - 0.5;
    input.keyDown(2);
    now = ONSET - TOLERANCE - 0.1;
    input.keyUp(2);

    now = ONSET;
    expect(correctYet(note)).toBe(false);
  });

  it('agrees with the verdict once the window has closed', () => {
    // Two ways of asking the same question; they must never disagree.
    for (const held of [[1, 2], [1], [3], []]) {
      now = 0;
      input = new ValveInput(() => now);
      const note = noteExpecting([maskOf([1, 2])]);

      now = ONSET;
      for (const valve of held) input.keyDown(valve);

      now = ONSET + TOLERANCE;
      const verdict = judgeNote(note, 0, ONSET, CROTCHET, input).verdict;
      expect(correctYet(note), `holding ${held.join('-') || 'nothing'}`).toBe(
        verdict === 'correct',
      );
    }
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

describe('the scoring window', () => {
  const metres = [{ fromBeat: 0, metre: metreFor(4, 4) }];

  /** One crotchet per bar, which keeps bar arithmetic legible. */
  const noteInBar = (bar: number) => noteExpecting([0b001], bar * 4);
  const judged = (noteIndex: number, verdict: 'correct' | 'wrong'): NoteJudgement => ({
    noteIndex,
    verdict,
    heldMask: 0b001,
    timingOffset: 0,
  });

  it('returns a short run whole, so nothing about small exercises changes', () => {
    const notes = [0, 1, 2, 3].map(noteInBar);
    const judgements = notes.map((_, i) => judged(i, 'correct'));
    expect(windowJudgements(notes, judgements, metres)).toEqual(judgements);
  });

  it('rolls: only the last window of bars is scored', () => {
    const notes = Array.from({ length: 40 }, (_, bar) => noteInBar(bar));
    const judgements = notes.map((_, i) => judged(i, i < 24 ? 'wrong' : 'correct'));

    const inWindow = windowJudgements(notes, judgements, metres);
    // Bars 24–39: the sixteen ending at the last judged bar.
    expect(inWindow).toHaveLength(16);
    expect(inWindow.every((j) => j.verdict === 'correct')).toBe(true);
    // And the figure the player sees recovers, though the run's early half
    // was all wrong — which is the point of a window.
    expect(summarise(notes, inWindow).accuracy).toBe(1);
  });

  it('anchors to what was played, not to the length of the page', () => {
    // A forty-bar exercise stopped after bar 19: the window is bars 4–19,
    // not the empty sixteen at the end of the paper.
    const notes = Array.from({ length: 40 }, (_, bar) => noteInBar(bar));
    const judgements = notes.slice(0, 20).map((_, i) => judged(i, 'correct'));

    const inWindow = windowJudgements(notes, judgements, metres);
    expect(inWindow).toHaveLength(16);
    expect(inWindow[0].noteIndex).toBe(4);
    expect(inWindow[inWindow.length - 1].noteIndex).toBe(19);
  });
});
