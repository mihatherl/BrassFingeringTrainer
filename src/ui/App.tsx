import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { instrumentById } from '../domain/instruments';
import { difficultyById } from '../exercise/difficulty';
import { metreFor } from '../domain/metre';
import { defaultLengthFor, generateExercise, HORIZON_BARS } from '../exercise/generate';
import { exerciseFromTheme } from '../exercise/theme';
import { themeById } from '../exercise/themes';
import { canRekeyKind } from '../exercise/rekey';
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
import { horizonBarsFor } from '../licensing/entitlements';
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

  /**
   * The exercise the settings describe, from a seed — and optionally in a key
   * other than the one they name.
   *
   * The override is what the play screen's key dial is built on: the same
   * settings, the same length, a different key. It goes here rather than in the
   * dial because writing music is the generator's business and what the
   * generator wants is the settings, which this owns and the play screen only
   * has a copy of.
   */
  const build = useCallback(
    (seed: number, fifths?: number): Exercise => {
      /*
       * The set as well as the key, and this is where a key tour ends.
       *
       * `fifths` is derived from `keySet[0]` everywhere else in the app, so
       * setting one without the other would leave the generator touring the old
       * set from the new key. Ruled by the player on 2026-08-14: naming your own
       * key ends the tour, because a tour is a sequence and re-entering one
       * partway into a key nobody chose would be the app arguing with the dial.
       */
      const chosenSettings =
        fifths === undefined ? chosen : { ...chosen, fifths, keySet: [fifths] };
      const settings = constrainToEntitlements(chosenSettings, entitlements);
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

    const length = defaultLengthFor(settings.kind);
      return generateExercise({
        instrument,
        clef: settings.clef,
        fifths: settings.fifths,
        keySet: settings.keySet,
        difficulty: difficultyById(settings.difficultyId),
        kind: settings.kind,
        bars: length.bars,
        themeCount: length.themeCount,
        cycles: length.cycles,
        register: settings.register,
        range: settings.range ?? undefined,
        metre: metreFor(settings.beatsPerBar, settings.beatUnit),
        seed,
        tempo: settings.tempo,
        variableTempo: settings.variableTempo,
        /*
         * The paper past the committed end — and the whole of what the paid
         * tier now buys.
         *
         * Without it the exercise is exactly the length it was asked for, so
         * `Session.canContinue` is false, the offer is never made and the run
         * ends where the music does. Refusing by not generating rather than by
         * declining: there is no moment where the app has to say no, and no
         * green button that turns out to be a shop.
         */
        horizonBars: horizonBarsFor(entitlements, HORIZON_BARS),
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
          /* A tempo settled on while playing is the tempo to open with next
             time — written back once the run is over, never during it. */
          onTempoSettled={(tempo) => updateSettings({ ...chosen, tempo })}
          /*
           * The key dial, where the music can be rewritten to answer it.
           *
           * Three conditions, and each of them is a hard one rather than a
           * preference. `canRekeyKind` is about the material: a scale's length
           * falls out of how many cycles fit and a stitched theme's out of which
           * tunes were chosen, so in those a change of key is a change of the
           * length of the paper. Imported music has no generator behind it at
           * all — `build` makes an exercise from the settings and a seed, which
           * is the whole story for generated material and none of it for a part
           * that came out of a file. And keys are an entitlement.
           *
           * A fresh seed each time, deliberately: a new key played to the same
           * random walk would be the same exercise transposed, which is not
           * what a player turning to a new key is asking to practise.
           */
          inKey={
            entitlements.allKeys && canRekeyKind(exercise.kind)
              ? (fifths) => build(randomSeed(), fifths)
              : undefined
          }
          /*
           * And the key they settled in, the same way — as the set, not just the
           * opening key. `sanitise` derives `fifths` from `keySet[0]` when
           * settings are next loaded, so writing one without the other would
           * quietly hand the dialled key back on the next launch.
           */
          onKeySettled={(fifths) => updateSettings({ ...chosen, fifths, keySet: [fifths] })}
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
  }, [screen, exercise, finished, chosen, entitlements, onFinish, repeat, startNew, updateSettings, playImported, build]);

  return <div className="app">{content}</div>;
}
