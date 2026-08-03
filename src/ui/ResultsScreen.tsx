import { formatMask, primaryFingering } from '../domain/fingering';
import { instrumentById, soundingFromWritten } from '../domain/instruments';
import { spellInKey } from '../domain/keys';
import { formatPitch } from '../domain/pitch';
import type { SessionSummary } from '../engine/judge';
import type { Exercise } from '../exercise/types';
import { weakestNotes, type NoteStats } from '../storage/stats';

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
  const accuracy = Math.round(summary.accuracy * 100);
  const weakest = weakestNotes(stats, 5);

  const describe = (midi: number) => {
    const spelled = spellInKey(midi, exercise.fifths);
    const sounding = soundingFromWritten(midi, instrument, exercise.clef);
    const fingering = primaryFingering(sounding, instrument);
    return {
      name: formatPitch(spelled),
      fingering: fingering ? formatMask(fingering.mask) : '—',
    };
  };

  return (
    <div className="screen screen--results">
      <header className="masthead">
        <h1>{accuracy}%</h1>
        <p className="muted">
          {summary.correct} of {summary.total} notes, longest run {summary.longestStreak}
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

      {weakest.length > 0 && (
        <section className="panel">
          <h2>Worth drilling</h2>
          <ul className="weak-notes">
            {weakest.map(({ midi, accuracy: noteAccuracy }) => {
              const { name, fingering } = describe(midi);
              return (
                <li key={midi}>
                  <span className="weak-notes__pitch">{name}</span>
                  <span className="weak-notes__fingering">{fingering}</span>
                  <span className="weak-notes__score muted">{Math.round(noteAccuracy * 100)}%</span>
                </li>
              );
            })}
          </ul>
          <p className="field__note muted">
            Accumulated across sessions on {instrument.name} in {exercise.clef} clef.
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
