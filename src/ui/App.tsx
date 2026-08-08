import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { metreFor } from '../domain/metre';
import { generateExercise } from '../exercise/generate';
import { randomSeed } from '../exercise/rng';
import type { Exercise } from '../exercise/types';
import type { SessionSummary } from '../engine/judge';
import {
  constrainToEntitlements,
  loadSettings,
  saveSettings,
  type Settings,
} from '../storage/settings';
import {
  currentEntitlements,
  refreshEntitlements,
  watchEntitlements,
} from '../licensing/licence';
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
  const [chosen, setChosen] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>('settings');
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);

  /*
   * Applied when the exercise is built, not merely when the settings screen is
   * drawn: settings outlive the screen, and the generator should not be the
   * thing that has to notice a lapsed purchase.
   *
   * Subscribed rather than read once, because the answer can arrive late — a
   * purchase recorded mid-session, or eventually a receipt checked over the
   * network. `currentEntitlements` holds its result, so this is a stable
   * reference until the verdict genuinely changes; see `licence.ts`.
   */
  const entitlements = useSyncExternalStore(watchEntitlements, currentEntitlements);

  // Where a slow check would be kicked off. Costs nothing today.
  useEffect(() => {
    void refreshEntitlements();
  }, []);

  const build = useCallback(
    (seed: number): Exercise => {
      const settings = constrainToEntitlements(chosen, entitlements);
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
        keySet: settings.keySet,
        difficulty: difficultyById(settings.difficultyId),
        kind: settings.kind,
        bars: settings.bars,
        cycles: settings.cycles,
        metre: metreFor(settings.beatsPerBar, settings.beatUnit),
        seed,
        noteWeights: weights,
      });
    },
    [chosen, entitlements],
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
    setChosen(next);
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
          settings={constrainToEntitlements(chosen, entitlements)}
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

    return <SettingsScreen settings={chosen} onChange={updateSettings} onStart={startNew} />;
  }, [screen, exercise, finished, chosen, entitlements, onFinish, repeat, startNew, updateSettings]);

  return <div className="app">{content}</div>;
}
