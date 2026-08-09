import { useMemo } from 'react';
import { formatMask, primaryFingering } from '../domain/fingering';
import { instrumentById, soundingFromWritten } from '../domain/instruments';
import { keyAt } from '../domain/keys';
import {
  SCORE_WINDOW_BARS,
  summarise,
  windowJudgements,
  type SessionSummary,
  type Verdict,
} from '../engine/judge';
import { soundingHeads } from '../exercise/ties';
import type { Exercise } from '../exercise/types';
import { weakestNotes, type NoteStats } from '../storage/stats';
import type { ChartNote } from '../render/note-chart';
import { ReviewStave } from './ReviewStave';
import { WeakNoteChart } from './WeakNoteChart';

interface ResultsScreenProps {
  summary: SessionSummary;
  exercise: Exercise;
  stats: NoteStats;
  onRepeat: () => void;
  onNext: () => void;
  onSettings: () => void;
}

export function ResultsScreen({
  summary,
  exercise,
  stats,
  onRepeat,
  onNext,
  onSettings,
}: ResultsScreenProps) {
  const instrument = instrumentById(exercise.instrumentId);

  /*
   * The headline is the scoring window — the last so many bars of what was
   * actually played. On a run no longer than the window the two are the same
   * judgements and the same figure, which is why a short exercise reads
   * exactly as it always did. The tally, the streak and the review stave
   * stay whole-run: where a note went wrong is worth seeing however long ago
   * it was, and weak-note drilling has already been fed the whole session.
   */
  const windowed = useMemo(() => {
    const inWindow = windowJudgements(exercise.notes, summary.judgements, exercise.metre);
    return inWindow.length === summary.judgements.length
      ? null
      : summarise(exercise.notes, inWindow);
  }, [exercise, summary]);
  const accuracy = Math.round((windowed ?? summary).accuracy * 100);
  // Memoised because its identity feeds the chart's draw callback, and a fresh
  // array every render would redraw the canvas every render.
  const weakest = useMemo(() => weakestNotes(stats, 5), [stats]);

  // Judgements arrive in playing order; the stave needs them by note index, and
  // a stopped exercise leaves the rest undefined — which draws them as unplayed.
  //
  // The far end of a tie is never judged, so it takes the verdict of the note it
  // is tied from: one sound gets one colour, and a green head joined to a black
  // tail would read as half a note having gone right.
  const verdicts = useMemo(() => {
    const byIndex: Array<Verdict | undefined> = new Array(exercise.notes.length).fill(undefined);
    for (const judgement of summary.judgements) byIndex[judgement.noteIndex] = judgement.verdict;
    const heads = soundingHeads(exercise.notes);
    return byIndex.map((verdict, index) => verdict ?? byIndex[heads[index]]);
  }, [exercise, summary]);

  const chart: ChartNote[] = useMemo(
    () =>
      weakest.map(({ midi, accuracy: noteAccuracy }) => {
        const sounding = soundingFromWritten(midi, instrument, exercise.clef);
        const fingering = primaryFingering(sounding, instrument);
        return {
          writtenMidi: midi,
          fingering: fingering ? formatMask(fingering.mask) : '—',
          accuracy: noteAccuracy,
        };
      }),
    [weakest, instrument, exercise],
  );

  return (
    <div className="screen screen--results">
      <header className="masthead">
        <h1>{accuracy}%</h1>
        <p className="muted">
          {windowed
            ? `Over the last ${SCORE_WINDOW_BARS} bars — ${Math.round(summary.accuracy * 100)}% across the whole run, longest streak ${summary.longestStreak}`
            : `${summary.correct} of ${summary.total} notes, longest run ${summary.longestStreak}`}
        </p>
      </header>

      <section className="panel">
        <div className="tally">
          <div className="tally__item tally__item--correct">
            <strong>{summary.correct}</strong>
            <span>Correct</span>
          </div>
          <div className="tally__item tally__item--wrong">
            <strong>{summary.wrong}</strong>
            <span>Wrong valves</span>
          </div>
          <div className="tally__item tally__item--missed">
            <strong>{summary.missed}</strong>
            <span>Missed</span>
          </div>
        </div>
        {summary.averageOffset > 0 && (
          <p className="field__note muted">
            Average {Math.round(summary.averageOffset * 1000)} ms late on the notes you got right.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>What you played</h2>
        <ReviewStave exercise={exercise} verdicts={verdicts} />
        <p className="field__note muted">
          {summary.correct === summary.total
            ? 'Every note in green — nothing to correct.'
            : 'The fingering under a note is the one it wanted.'}
        </p>
      </section>

      {weakest.length > 0 && (
        <section className="panel">
          <h2>Worth drilling</h2>
          {/* A tally of pitches rather than a timeline, so it has no beat to
              ask about: it is spelled in the key the exercise opened in. */}
          <WeakNoteChart notes={chart} clef={exercise.clef} fifths={keyAt(exercise.keys, 0)} />
          <p className="field__note muted">
            Accumulated across sessions on {instrument.name} in {exercise.clef} clef, and spelled
            in the key you have just played.
          </p>
        </section>
      )}

      <div className="actions">
        <button type="button" className="button button--primary button--large" onClick={onNext}>
          Another
        </button>
        <button type="button" className="button" onClick={onRepeat}>
          Same again
        </button>
        <button type="button" className="button button--quiet" onClick={onSettings}>
          Settings
        </button>
      </div>
    </div>
  );
}
