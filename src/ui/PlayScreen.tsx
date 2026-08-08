/**
 * The play surface: notation, the last few notes played, and the valve buttons.
 *
 * React mounts the canvas and then stays out of the way — the renderer and the
 * session own the animation and audio loops directly. Nothing in the hot path
 * goes through React state, so a re-render can never cost a frame of timing.
 * The score and the recent-notes list do re-render, but only once a note has
 * been judged, which is well after anything about it was time-critical.
 */

import { useEffect, useRef, useState } from 'react';
import { ensureRunning, getAudioContext, unlockAudio } from '../audio/context';
import { Sampler, type Voice } from '../audio/sampler';
import { formatMask } from '../domain/fingering';
import { instrumentById } from '../domain/instruments';
import { formatPitch } from '../domain/pitch';
import type { Transport } from '../engine/clock';
import { Session } from '../engine/session';
import { fingeringHints } from '../exercise/hints';
import { soundingHeads } from '../exercise/ties';
import { loadStats } from '../storage/stats';
import type { NoteJudgement, SessionSummary, Verdict } from '../engine/judge';
import { currentTheme, StaveRenderer } from '../render/surface';
import type { Exercise } from '../exercise/types';
import type { Settings } from '../storage/settings';
import { ConductorPanel } from './ConductorPanel';
import { RecentNotes, type RecentNote } from './RecentNotes';
import { ValvePad } from './ValvePad';

interface PlayScreenProps {
  settings: Settings;
  exercise: Exercise;
  onFinish: (summary: SessionSummary) => void;
  onExit: () => void;
}

/**
 * How many played notes stay on screen.
 *
 * Enough to cover a phrase's worth of glancing back, few enough to take in at
 * once — and few enough to sit beside the valve pad on a phone held sideways,
 * which is the tightest space it has to fit.
 */
const RECENT_NOTES = 5;

/** Turns a judgement into something readable at a glance. */
function describeNote(exercise: Exercise, judgement: NoteJudgement): RecentNote {
  const note = exercise.notes[judgement.noteIndex];
  return {
    id: judgement.noteIndex,
    name: formatPitch(note.pitch),
    verdict: judgement.verdict,
    // A missed note means nothing was held. Saying "open" would credit the
    // player with a fingering they never chose.
    held: judgement.verdict === 'missed' ? null : formatMask(judgement.heldMask),
    expected: formatMask(note.primaryMask),
  };
}

export function PlayScreen({ settings, exercise, onFinish, onExit }: PlayScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const rendererRef = useRef<StaveRenderer | null>(null);
  const verdictsRef = useRef<Array<Verdict | undefined>>([]);

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [mask, setMask] = useState(0);
  const [progress, setProgress] = useState({ done: 0, correct: 0 });
  const [recent, setRecent] = useState<RecentNote[]>([]);
  /*
   * State rather than a ref, unlike the session and renderer beside it.
   * Those are only ever reached from callbacks; the conductor is a child that
   * has to be *rendered* with it, and a ref assigned inside the effect would
   * never trigger the render that mounts it.
   */
  const [transport, setTransport] = useState<Transport | null>(null);
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
    // Which note actually sounds each written one, so the renderer can look a
    // verdict up through a tie. Fixed by the exercise, so settled once here
    // rather than walked on every note of every frame.
    const heads = soundingHeads(exercise.notes);
    setRecent([]);

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
      timingTolerance: settings.timingTolerance,
      // Fires as the fingers arrive, not when the note is finally judged, so
      // the green reads as confirmation of what was just played.
      onCorrect: () => rendererRef.current?.flashCorrect(),
      onJudgement: (judgement: NoteJudgement) => {
        verdictsRef.current[judgement.noteIndex] = judgement.verdict;
        setProgress((current) => ({
          done: current.done + 1,
          correct: current.correct + (judgement.verdict === 'correct' ? 1 : 0),
        }));
        setRecent((current) => [describeNote(exercise, judgement), ...current].slice(0, RECENT_NOTES));
      },
      onFinish: (summary) => finishRef.current(summary),
    });
    sessionRef.current = session;
    setTransport(session.transport);

    // Which notes get their fingering printed. Settled once per run: the
    // history behind it does not change mid-exercise, and a hint that came and
    // went would be worse than none.
    //
    // Asked after the session exists so that how much time a note has is
    // answered by the transport, which is the one thing that knows — rather
    // than by dividing the tempo here and hoping the two agree.
    const hints = settings.fingeringHints
      ? fingeringHints({
          exercise,
          stats: loadStats(exercise.instrumentId, exercise.clef),
          secondsBetween: (from, to) => session.transport.secondsBetween(from, to),
        })
      : new Map<number, string>();

    const renderer = new StaveRenderer({
      canvas,
      exercise,
      transport: session.transport,
      theme: currentTheme(),
      scrollSpeed: settings.scrollSpeed,
      readingMode: settings.readingMode,
      // Through the tie: its far end is never judged, so it wears the verdict of
      // the note it is tied from rather than staying unmarked beside it.
      verdictFor: (index) => verdictsRef.current[heads[index]],
      hintFor: (index) => hints.get(index),
    });
    rendererRef.current = renderer;

    const unsubscribe = session.input.subscribe(setMask);
    const detachKeyboard = session.input.attachKeyboard();

    const resizeObserver = new ResizeObserver(() => renderer.resize());
    resizeObserver.observe(canvas);

    const colourScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSchemeChange = () => renderer.setTheme(currentTheme());
    colourScheme?.addEventListener('change', onSchemeChange);

    renderer.start();
    session.start();

    /*
     * A last line of defence.
     *
     * If the context is stopped despite everything above, the clock never moves
     * and the exercise freezes on the first count with no error anywhere. That
     * is far worse than an honest failure, so the clock is checked once shortly
     * after starting and the player is offered a way out.
     */
    const startedAt = getAudioContext().currentTime;
    const stallCheck = window.setTimeout(() => {
      if (getAudioContext().currentTime === startedAt) setStalled(true);
    }, 600);

    // Keeps the screen awake mid-exercise; unsupported browsers simply carry on.
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        wakeLock = lock;
      })
      .catch(() => undefined);

    return () => {
      window.clearTimeout(stallCheck);
      session.stop();
      renderer.stop();
      unsubscribe();
      detachKeyboard();
      resizeObserver.disconnect();
      colourScheme?.removeEventListener('change', onSchemeChange);
      wakeLock?.release().catch(() => undefined);
      sessionRef.current = null;
      rendererRef.current = null;
      setTransport(null);
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

                // Loading the samples takes long enough that the context can
                // have been suspended again since the tap, and a suspended
                // context has a clock that never advances — which would start
                // the exercise against a frozen count-in and no metronome.
                await ensureRunning();
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

  if (stalled) {
    return (
      <div className="screen screen--centred">
        <div className="start-gate">
          <h2>Audio didn’t start</h2>
          <p className="muted">
            The browser stopped the sound before the exercise got going, which leaves the count-in
            stuck. Tapping again almost always sorts it.
          </p>
          <button
            type="button"
            className="button button--primary button--large"
            onClick={() => {
              void ensureRunning().then((running) => {
                if (!running) return;
                // Unmounting and remounting the play surface is what restarts
                // the transport against a clock that is now moving.
                setStalled(false);
                setStarted(false);
              });
            }}
          >
            Try again
          </button>
          <button type="button" className="button button--quiet" onClick={onExit}>
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

      <div className="play-aside">
        <RecentNotes notes={recent} />
        {settings.conductorEnabled && transport && (
          <ConductorPanel transport={transport} metre={exercise.metre} />
        )}
      </div>

      {/* The canvas is positioned inside a frame rather than being the grid
          item itself; see `.stave-frame`. */}
      <div className="stave-frame">
        <canvas ref={canvasRef} className="stave-canvas" />
      </div>

      <ValvePad
        mask={mask}
        onPress={(pointerId, valve) => sessionRef.current?.input.pointerDown(pointerId, valve)}
        onRelease={(pointerId) => sessionRef.current?.input.pointerUp(pointerId)}
      />
    </div>
  );
}
