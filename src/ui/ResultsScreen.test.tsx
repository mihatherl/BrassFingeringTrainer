// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import { summarise } from '../engine/judge';
import type { NoteJudgement, Verdict } from '../engine/judge';
import { ResultsScreen } from './ResultsScreen';

afterEach(cleanup);

const exercise = generateExercise({
  instrument: instrumentById('eb-bass'),
  clef: 'treble',
  fifths: -3,
  difficulty: difficultyById('easy'),
  kind: 'random',
  bars: 4,
  beatsPerBar: 4,
  beatUnit: 4,
  seed: 3,
});

function summaryFor(pattern: Verdict[], upTo = exercise.notes.length) {
  const judgements: NoteJudgement[] = Array.from({ length: upTo }, (_, index) => ({
    noteIndex: index,
    verdict: pattern[index % pattern.length],
    heldMask: 0,
    timingOffset: null,
  }));
  return summarise(exercise.notes, judgements);
}

const noop = () => undefined;

function renderResults(summary: ReturnType<typeof summaryFor>) {
  render(
    <ResultsScreen
      summary={summary}
      exercise={exercise}
      stats={new Map()}
      onRepeat={noop}
      onNext={noop}
      onSettings={noop}
    />,
  );
}

describe('the results screen', () => {
  /*
   * happy-dom has no 2D canvas, so `getContext` comes back null. The review
   * still has to mount and size itself — a results screen that threw because
   * the browser would not give it a context would take the whole run's feedback
   * with it.
   */
  it('shows the marked exercise', () => {
    expect(() => renderResults(summaryFor(['correct', 'wrong', 'missed']))).not.toThrow();
    expect(screen.getByRole('heading', { name: 'What you played' })).toBeTruthy();
    expect(screen.getByText(/fingering under a note/i)).toBeTruthy();
  });

  it('says so plainly when there was nothing to correct', () => {
    renderResults(summaryFor(['correct']));
    expect(screen.getByText(/nothing to correct/i)).toBeTruthy();
    expect(screen.queryByText(/fingering under a note/i)).toBeNull();
  });

  it('copes with a run that stopped part-way', () => {
    // Stopping early leaves later notes unjudged; they draw as unplayed rather
    // than as mistakes.
    expect(() => renderResults(summaryFor(['correct'], 2))).not.toThrow();
    expect(screen.getByRole('heading', { name: 'What you played' })).toBeTruthy();
  });
});
