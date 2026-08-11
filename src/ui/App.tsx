import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { metreFor } from '../domain/metre';
import { generateExercise, HORIZON_BARS } from '../exercise/generate';
import { exerciseFromTheme } from '../exercise/theme';
import { themeById } from '../exercise/themes';
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
import { ImportScreen } from './ImportScreen';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';

type Screen = 'settings' | 'play' | 'results' | 'import';

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

      /*
       * `?theme=<id>` plays one theme and nothing else.
       *
       * For auditioning the corpus while it is being written — seeing a theme
       * engraved says whether it is correct, and only playing it says whether
       * it is any good. The same shape of hook as `?tier=free`, and as
       * forgiving: an id that names nothing falls through to the ordinary
       * exercise rather than leaving the player with a broken screen.
       */
      const wanted = new URLSearchParams(window.location.search).get('theme');
      const theme = wanted ? themeById(wanted) : undefined;
      if (theme) {
        const one = exerciseFromTheme(theme, {
          instrument,
          clef: settings.clef,
          fifths: settings.fifths,
          metre: metreFor(...theme.metres[0]),
        });
        if (one) return one;
      }

      return generateExercise({
        instrument,
        clef: settings.clef,
        fifths: settings.fifths,
        keySet: settings.keySet,
        difficulty: difficultyById(settings.difficultyId),
        kind: settings.kind,
        bars: settings.bars,
        themeCount: settings.themeCount,
        cycles: settings.cycles,
        register: settings.register,
        metre: metreFor(settings.beatsPerBar, settings.beatUnit),
        seed,
        tempo: settings.tempo,
        variableTempo: settings.variableTempo,
        horizonBars: HORIZON_BARS,
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
    /*
     * Imported music is not regenerated. `build` makes an exercise from the
     * settings and a seed, which is the whole story for generated material and
     * none of it for a part that came out of a file — asking for it again would
     * hand back a random exercise wearing the same seed.
     */
    if (finished && finished.exercise.kind === 'imported') setExercise(finished.exercise);
    else if (finished) setExercise(build(finished.exercise.seed));
    setScreen('play');
  }, [build, finished]);

  const playImported = useCallback((imported: Exercise) => {
    setExercise(imported);
    setScreen('play');
  }, []);

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

    if (screen === 'import') {
      return (
        <ImportScreen
          settings={chosen}
          onPlay={playImported}
          onBack={() => setScreen('settings')}
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

    /*
     * The player's *own* settings, not the constrained copy.
     *
     * Deliberately: a choice made before unlocking should survive it, so that a
     * purchase restores what was picked rather than leaving the substitute in
     * place. The screen is given the entitlements instead, and shows what this
     * copy cannot use — where before it silently accepted the choice and let
     * `constrainToEntitlements` swap it out at build time, which is how asking
     * for Expert in D major produced Easy in C with nothing on screen saying so.
     */
    return (
      <SettingsScreen
        settings={chosen}
        entitlements={entitlements}
        onChange={updateSettings}
        onStart={startNew}
        onImport={() => setScreen('import')}
      />
    );
  }, [screen, exercise, finished, chosen, entitlements, onFinish, repeat, startNew, updateSettings, playImported]);

  return <div className="app">{content}</div>;
}
