/**
 * The play surface: scrolling notation above, valve buttons below.
 *
 * React mounts the canvas and then stays out of the way — the renderer and the
 * session own the animation and audio loops directly. Nothing in the hot path
 * goes through React state, so a re-render can never cost a frame of timing.
 */

import { useEffect, useRef, useState } from 'react';
import { getAudioContext, unlockAudio } from '../audio/context';
import { Sampler, type Voice } from '../audio/sampler';
import { instrumentById } from '../domain/instruments';
import { Session } from '../engine/session';
import type { NoteJudgement, SessionSummary, Verdict } from '../engine/judge';
import { DARK_THEME, LIGHT_THEME, StaveRenderer } from '../render/surface';
import type { Exercise } from '../exercise/types';
import type { Settings } from '../storage/settings';
import { ValvePad } from './ValvePad';

interface PlayScreenProps {
  settings: Settings;
  exercise: Exercise;
  onFinish: (summary: SessionSummary) => void;
  onExit: () => void;
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function PlayScreen({ settings, exercise, onFinish, onExit }: PlayScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const verdictsRef = useRef<Array<Verdict | undefined>>([]);

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mask, setMask] = useState(0);
  const [progress, setProgress] = useState({ done: 0, correct: 0 });
  // Held across the gate so the session can be handed the loaded voice.
  const voiceRef = useRef<Voice | undefined>(undefined);

  // Kept in a ref so the callback the renderer holds never goes stale.
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    verdictsRef.current = new Array(exercise.notes.length).fill(undefined);

    // The very same context `unlockAudio` resumed — a second one would stay
    // suspended and the exercise would run in silence.
    const session = new Session({
      context: getAudioContext(),
      exercise,
      tempo: settings.tempo,
      countInBars: settings.countInBars,
      metronomeEnabled: settings.metronomeEnabled,
      playbackMode: settings.playbackMode,
      brassVoice: voiceRef.current,
      backingLevel: settings.backingLevel,
      timingTolerance: settings.timingTolerance,
      onJudgement: (judgement: NoteJudgement) => {
        verdictsRef.current[judgement.noteIndex] = judgement.verdict;
        setProgress((current) => ({
          done: current.done + 1,
          correct: current.correct + (judgement.verdict === 'correct' ? 1 : 0),
        }));
      },
      onFinish: (summary) => finishRef.current(summary),
    });
    sessionRef.current = session;

    const renderer = new StaveRenderer({
      canvas,
      exercise,
      transport: session.transport,
      theme: prefersDark() ? DARK_THEME : LIGHT_THEME,
      noteSpacing: settings.noteSpacing,
      readingMode: settings.readingMode,
      verdictFor: (index) => verdictsRef.current[index],
    });

    const unsubscribe = session.input.subscribe(setMask);
    const detachKeyboard = session.input.attachKeyboard();

    const resizeObserver = new ResizeObserver(() => renderer.resize());
    resizeObserver.observe(canvas);

    const colourScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSchemeChange = () => renderer.setTheme(prefersDark() ? DARK_THEME : LIGHT_THEME);
    colourScheme?.addEventListener('change', onSchemeChange);

    renderer.start();
    session.start();

    // Keeps the screen awake mid-exercise; unsupported browsers simply carry on.
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        wakeLock = lock;
      })
      .catch(() => undefined);

    return () => {
      session.stop();
      renderer.stop();
      unsubscribe();
      detachKeyboard();
      resizeObserver.disconnect();
      colourScheme?.removeEventListener('change', onSchemeChange);
      wakeLock?.release().catch(() => undefined);
      sessionRef.current = null;
    };
  }, [started, exercise, settings]);

  if (!started) {
    return (
      <div className="screen screen--centred">
        <div className="start-gate">
          <h2>Ready</h2>
          <p className="muted">
            {settings.readingMode === 'paged'
              ? 'Hold the valve buttons — or keys 1, 2 and 3 — for each note, counting with the metronome. Nothing on screen will tell you when to play.'
              : 'Hold the valve buttons — or keys 1, 2 and 3 — so the right combination is down as each note crosses the line.'}
          </p>
          {settings.readingMode === 'paged' && !settings.metronomeEnabled && (
            <p className="muted">
              The metronome is switched off, so you will have nothing at all to count against.
            </p>
          )}
          <button
            type="button"
            className="button button--primary button--large"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void (async () => {
                const context = await unlockAudio();
                try {
                  // Decoding mid-exercise would drop notes, so the recorded
                  // instrument is loaded here or not at all.
                  voiceRef.current = await Sampler.load(
                    context,
                    instrumentById(exercise.instrumentId).sampleSet,
                  );
                } catch {
                  // Offline before the samples were ever cached, or a bad
                  // response. Synthesis still works, so play on.
                  voiceRef.current = undefined;
                }
                setStarted(true);
              })();
            }}
          >
            {loading ? 'Loading instrument…' : 'Tap to start'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={loading}
            onClick={onExit}
          >
            Back to settings
          </button>
        </div>
      </div>
    );
  }

  const accuracy = progress.done === 0 ? 0 : Math.round((progress.correct / progress.done) * 100);

  return (
    <div className="screen screen--play">
      <div className="play-bar">
        <button type="button" className="button button--quiet" onClick={onExit}>
          Stop
        </button>
        <div className="play-stats">
          <span>
            {progress.done} / {exercise.notes.length}
          </span>
          <span className="play-stats__accuracy">{accuracy}%</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="stave-canvas" />

      <ValvePad
        mask={mask}
        onPress={(pointerId, valve) => sessionRef.current?.input.pointerDown(pointerId, valve)}
        onRelease={(pointerId) => sessionRef.current?.input.pointerUp(pointerId)}
      />
    </div>
  );
}
