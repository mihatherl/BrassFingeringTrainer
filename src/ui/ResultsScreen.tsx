import { useMemo } from 'react';
import { formatMask, primaryFingering } from '../domain/fingering';
import { barAt } from '../domain/metre';
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

  /*
   * How far the run reached, when there was grey to reach into. Counted from
   * what was judged rather than from the clock, so the silent bar that ended
   * the run does not count as having been played.
   */
  const beyondBars = useMemo(() => {
    if (exercise.chosenBeats >= exercise.totalBeats || summary.judgements.length === 0) return 0;
    const lastBeat = Math.max(
      ...summary.judgements.map((j) => exercise.notes[j.noteIndex].startBeat),
    );
    const chosenBar = Math.ceil(exercise.chosenBeats / exercise.metre.barBeats);
    return Math.max(0, barAt(exercise.metre, lastBeat) + 1 - chosenBar);
  }, [exercise, summary]);

  /*
   * The review covers the run, not the paper. An exercise with a horizon
   * holds two hundred bars of material; engraving the hundred and ninety
   * nobody met would bury the bars that matter under a wall of unplayed ink.
   * Notes are in beat order, so the slice is a prefix and the verdicts below
   * line up with it unchanged.
   */
  const shown = useMemo(() => {
    if (exercise.chosenBeats >= exercise.totalBeats) return exercise;
    const { barBeats } = exercise.metre;
    const lastBeat = summary.judgements.length
      ? Math.max(...summary.judgements.map((j) => exercise.notes[j.noteIndex].startBeat))
      : exercise.chosenBeats - 1e-9;
    const end = Math.min(
      exercise.totalBeats,
      Math.max(exercise.chosenBeats, (barAt(exercise.metre, lastBeat) + 1) * barBeats),
    );
    return {
      ...exercise,
      notes: exercise.notes.filter((n) => n.startBeat < end - 1e-9),
      rests: exercise.rests.filter((r) => r.startBeat < end - 1e-9),
      totalBeats: end,
      chosenBeats: end,
    };
  }, [exercise, summary]);
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
        {beyondBars > 0 && (
          <p className="muted">
            {beyondBars} bar{beyondBars === 1 ? '' : 's'} beyond the length you chose — the music
            kept going, and so did you.
          </p>
        )}
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


      {/*
        What to do next, above the reading rather than below it.
        
        The review and the weak-note chart are worth the room they take and
        are worth scrolling for; they are not worth scrolling *past* every
        single time to reach the button that starts another go, which is what
        most people want within a second of seeing the score.
      */}
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

      <section className="panel">
        <h2>What you played</h2>
        <ReviewStave exercise={shown} verdicts={verdicts} />
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

    </div>
  );
}
