import { useCallback, useMemo, useState } from 'react';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { generateExercise } from '../exercise/generate';
import { randomSeed } from '../exercise/rng';
import type { Exercise } from '../exercise/types';
import type { SessionSummary } from '../engine/judge';
import { loadSettings, saveSettings, type Settings } from '../storage/settings';
import { loadStats, noteWeights, recordSession, type NoteStats } from '../storage/stats';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';

type Screen = 'settings' | 'play' | 'results';

interface Finished {
  summary: SessionSummary;
  exercise: Exercise;
  stats: NoteStats;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>('settings');
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);

  const build = useCallback(
    (seed: number): Exercise => {
      const instrument = instrumentById(settings.instrumentId);
      // Weak-note weighting reads the same stats the results screen shows, so
      // what the app says needs work is exactly what it then serves up.
      const weights = settings.weakNoteDrilling
        ? noteWeights(loadStats(settings.instrumentId, settings.clef))
        : undefined;

      return generateExercise({
        instrument,
        clef: settings.clef,
        fifths: settings.fifths,
        difficulty: difficultyById(settings.difficultyId),
        kind: settings.kind,
        bars: settings.bars,
        beatsPerBar: settings.beatsPerBar,
        beatUnit: settings.beatUnit,
        seed,
        noteWeights: weights,
      });
    },
    [settings],
  );

  const startNew = useCallback(() => {
    setExercise(build(randomSeed()));
    setScreen('play');
  }, [build]);

  const repeat = useCallback(() => {
    if (finished) setExercise(build(finished.exercise.seed));
    setScreen('play');
  }, [build, finished]);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const onFinish = useCallback(
    (summary: SessionSummary) => {
      if (!exercise) return;
      const stats = recordSession(exercise.instrumentId, exercise.clef, summary.byNote);
      setFinished({ summary, exercise, stats });
      setScreen('results');
    },
    [exercise],
  );

  const content = useMemo(() => {
    if (screen === 'play' && exercise) {
      return (
        <PlayScreen
          settings={settings}
          exercise={exercise}
          onFinish={onFinish}
          onExit={() => setScreen('settings')}
        />
      );
    }

    if (screen === 'results' && finished) {
      return (
        <ResultsScreen
          summary={finished.summary}
          exercise={finished.exercise}
          stats={finished.stats}
          onRepeat={repeat}
          onNext={startNew}
          onSettings={() => setScreen('settings')}
        />
      );
    }

    return <SettingsScreen settings={settings} onChange={updateSettings} onStart={startNew} />;
  }, [screen, exercise, finished, settings, onFinish, repeat, startNew, updateSettings]);

  return <div className="app">{content}</div>;
}
