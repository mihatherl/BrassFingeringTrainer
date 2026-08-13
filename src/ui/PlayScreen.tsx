/**
 * The play surface: notation, the tempo, and the valve buttons.
 *
 * React mounts the canvas and then stays out of the way — the renderer and the
 * session own the animation and audio loops directly. Nothing in the hot path
 * goes through React state, so a re-render can never cost a frame of timing.
 * The score does re-render, but only once a note has been judged, which is well
 * after anything about it was time-critical.
 *
 * A list of the last few notes played used to sit beside the stave. It is gone,
 * on the player's verdict: *you can never pay enough attention to it to see
 * what the fingering was supposed to be.* Nothing read off to the side survives
 * contact with sight-reading, so the answer moved onto the note itself — see
 * `hints.ts` — and the space went to the tempo, which is the control a player
 * actually reaches for mid-practice.
 */

import { useEffect, useRef, useState } from 'react';
import { ensureRunning, getAudioContext, unlockAudio } from '../audio/context';
import { Sampler, type Voice } from '../audio/sampler';
import { barAt, metreFor } from '../domain/metre';
import { instrumentById } from '../domain/instruments';
import type { Transport } from '../engine/clock';
import { Session } from '../engine/session';
import { fingeringHints, type Hints } from '../exercise/hints';
import { soundingHeads } from '../exercise/ties';
import { loadStats } from '../storage/stats';
import { SCORE_WINDOW_BARS, type NoteJudgement, type SessionSummary, type Verdict } from '../engine/judge';
import { currentTheme, StaveRenderer } from '../render/surface';
import type { Exercise } from '../exercise/types';
import type { Settings } from '../storage/settings';
import { patternFor } from '../render/conductor';
import { ConductorPanel } from './ConductorPanel';
import { TempoSlider } from './TempoSlider';
import { ValvePad } from './ValvePad';

interface PlayScreenProps {
  settings: Settings;
  exercise: Exercise;
  onFinish: (summary: SessionSummary) => void;
  onExit: () => void;
  /**
   * The speed the player settled on, reported when the run ends.
   *
   * Not while it moves: the whole play surface is rebuilt when `settings`
   * changes, so writing the slider back as it slides would restart the exercise
   * under the player's fingers. At the end it is simply the tempo they were
   * last playing at, which is the one they want next time.
   */
  onTempoSettled?: (bpm: number) => void;
}

export function PlayScreen({
  settings,
  exercise,
  onFinish,
  onExit,
  onTempoSettled,
}: PlayScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const rendererRef = useRef<StaveRenderer | null>(null);
  const verdictsRef = useRef<Array<Verdict | undefined>>([]);
  const hintsRef = useRef<Hints | null>(null);

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [mask, setMask] = useState(0);
  const [progress, setProgress] = useState({ done: 0, accuracy: 0 });
  /**
   * The speed this run is being played at, which the player can move.
   *
   * Deliberately *not* `settings.tempo`: the effect below is keyed on the
   * settings object, so a change there tears the session down and starts the
   * exercise again. This is the run's own tempo, reported back once at the end.
   */
  const [tempo, setTempo] = useState(settings.tempo);
  /*
   * State rather than a ref, unlike the session and renderer beside it.
   * Those are only ever reached from callbacks; the conductor is a child that
   * has to be *rendered* with it, and a ref assigned inside the effect would
   * never trigger the render that mounts it.
   */
  const [transport, setTransport] = useState<Transport | null>(null);
  /** Whether the music is about to run out and more may be asked for. */
  const [offering, setOffering] = useState(false);
  /** How much music this run is committed to, which Continue extends. */
  const [committedBeats, setCommittedBeats] = useState(exercise.chosenBeats);
  // Held across the gate so the session can be handed the loaded voice.
  const voiceRef = useRef<Voice | undefined>(undefined);

  // Kept in refs so the callbacks the session holds never go stale.
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const settledRef = useRef(onTempoSettled);
  settledRef.current = onTempoSettled;

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setOffering(false);
    setCommittedBeats(exercise.chosenBeats);
    verdictsRef.current = new Array(exercise.notes.length).fill(undefined);
    // Which note actually sounds each written one, so the renderer can look a
    // verdict up through a tie. Fixed by the exercise, so settled once here
    // rather than walked on every note of every frame.
    const heads = soundingHeads(exercise.notes);
    setTempo(settings.tempo);

    // The very same context `unlockAudio` resumed — a second one would stay
    // suspended and the exercise would run in silence.
    const session = new Session({
      context: getAudioContext(),
      exercise,
      tempo: settings.tempo,
      countInBars: settings.countInBars,
      metronomeEnabled: settings.metronomeEnabled,
      /*
       * Where the conductor has no pattern for a metre it draws nothing, and
       * the comment on `patternFor` has always said the metronome carries on.
       * It only does if the player left it on — so with it off, an imported bar
       * of five would have had the gesture stop and nothing take its place.
       *
       * Only worth asking when the conductor is the thing keeping time. With it
       * switched off too, the player is counting for themselves everywhere and
       * a bar that suddenly clicked would be the surprise.
       *
       * No tempo passed: whether a metre has a pattern at all does not depend
       * on the speed, only which of its patterns is chosen does.
       */
      needsBeatSounded: settings.conductorEnabled
        ? (metre) => patternFor(metre) === null
        : undefined,
      playbackMode: settings.playbackMode,
      brassVoice: voiceRef.current,
      timingTolerance: settings.timingTolerance,
      // Fires as the fingers arrive, not when the note is finally judged, so
      // the green reads as confirmation of what was just played.
      onCorrect: () => rendererRef.current?.flashCorrect(),
      onJudgement: (judgement: NoteJudgement) => {
        verdictsRef.current[judgement.noteIndex] = judgement.verdict;
        /*
         * The live percentage reads the scoring window, not the whole run: a
         * bad patch scrolls out of it, which is what makes the figure worth
         * glancing at late in a long session. Recomputed from the verdicts
         * on each judgement — one pass per note judged, nowhere near a frame.
         */
        const { metres, notes } = exercise;
        let done = 0;
        let lastBar = 0;
        verdictsRef.current.forEach((verdict, index) => {
          if (!verdict) return;
          done++;
          lastBar = Math.max(lastBar, barAt(metres, notes[index].startBeat));
        });
        let inWindow = 0;
        let correct = 0;
        verdictsRef.current.forEach((verdict, index) => {
          if (!verdict) return;
          if (barAt(metres, notes[index].startBeat) <= lastBar - SCORE_WINDOW_BARS) return;
          inWindow++;
          if (verdict === 'correct') correct++;
        });
        setProgress({ done, accuracy: inWindow === 0 ? 0 : correct / inWindow });

        /*
         * A mistake is answered on the note, immediately: the fingering appears
         * over the note that went wrong and over every later note of that
         * pitch. This is the whole reason the hints stopped being settled once
         * from stored history — an answer that arrives next session is not
         * teaching anybody anything.
         */
        if (judgement.verdict !== 'correct') hintsRef.current?.wentWrong(judgement.noteIndex);
      },
      onFinish: (summary) => {
        // The speed they ended up playing at is the one they want next time.
        if (tempoRef.current !== settings.tempo) settledRef.current?.(tempoRef.current);
        finishRef.current(summary);
      },
      /*
       * The offer opening and closing is also when the committed length can
       * have moved — the player may have taken it by playing on rather than
       * by pressing, and the counter has to follow either way.
       */
      onOffer: (open) => {
        setOffering(open);
        setCommittedBeats(session.endBeat);
      },
    });
    sessionRef.current = session;
    setTransport(session.transport);

    /*
     * Which notes get their fingering printed.
     *
     * Opened from the history the player brings and added to as the run goes:
     * the object is live, so a note that goes wrong in bar three is answered in
     * bar three. Asked after the session exists so that how much time a note
     * has is answered by the transport, which is the one thing that knows —
     * rather than by dividing the tempo here and hoping the two agree.
     */
    hintsRef.current = settings.fingeringHints
      ? fingeringHints({
          exercise,
          stats: loadStats(exercise.instrumentId, exercise.clef),
          secondsBetween: (from, to) => session.transport.secondsBetween(from, to),
        })
      : null;

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
      hintFor: (index) => hintsRef.current?.for(index),
      // White as far as the run is committed, and grey beyond — read per
      // frame, so accepting the offer turns the next block white at once.
      whiteUntil: () => session.endBeat,
      /*
       * The notation's own scale, handed to the stylesheet so the conductor
       * and the tempo slider can be measured in it too — see
       * `--stave-unit` in `index.css`. Without this they were sized by an
       * unrelated rule of their own, and on a tablet the notation grew past
       * them until the conductor looked like an afterthought.
       */
      onLayout: (staveUnit) =>
        screenRef.current?.style.setProperty('--stave-unit', `${staveUnit}px`),
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
      hintsRef.current = null;
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
              ? `Hold the valve buttons — or keys 1, 2 and 3 — for each note, counting with the ${
                  settings.conductorEnabled && !settings.metronomeEnabled
                    ? 'conductor'
                    : 'metronome'
                }. Nothing in the music will tell you when to play.`
              : 'Hold the valve buttons — or keys 1, 2 and 3 — so the right combination is down as each note crosses the line.'}
          </p>
          {/* Only when there is genuinely nothing keeping time. The conductor
              does that job as well as the metronome. */}
          {settings.readingMode === 'paged' &&
            !settings.metronomeEnabled &&
            !settings.conductorEnabled && (
              <p className="muted">
                The metronome and the conductor are both off, so you will have nothing at all to
                count against.
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

  const accuracy = Math.round(progress.accuracy * 100);

  /*
   * Stopping ends the run and reports it, rather than discarding it.
   *
   * It used to walk back to the settings screen with the score in its
   * pocket, which was a small loss when an exercise always ran to a fixed
   * end and is a real one now that stopping is how a session of any length
   * is meant to finish. A run with nothing judged in it has nothing to
   * report, so that one still simply leaves.
   */
  /**
   * What the one button does, whichever job it is currently doing.
   *
   * Safe to call twice: `continuePlaying` withdraws the offer as it takes it
   * and `finishNow` returns once finished, so a browser that manages to fire
   * both a pointer press and a click buys one block and ends one run.
   */
  const press = () => {
    const session = sessionRef.current;
    if (!offering || !session) {
      stopNow();
      return;
    }
    session.continuePlaying();
    setCommittedBeats(session.endBeat);
  };

  const stopNow = () => {
    const session = sessionRef.current;
    if (!session || session.judgements.length === 0) {
      onExit();
      return;
    }
    session.finishNow();
  };
  // Against what this run has committed to rather than what was first asked
  // for: taking the offer moves the target, and a target is the point of one.
  const targetNotes = exercise.notes.filter((n) => n.startBeat < committedBeats - 1e-9).length;

  return (
    <div className="screen screen--play" ref={screenRef}>
      <div className="play-bar">
        {/*
          One button, thumb-sized, doing whatever the moment asks of it: red
          to finish, and green to carry on in the last beats before the music
          runs out. There is no third state and no way to be caught out —
          letting the green one pass simply ends the run, which is what not
          answering an offer means.
        */}
        <button
          type="button"
          className={`button play-action ${offering ? 'play-action--continue' : 'play-action--stop'}`}
          /*
           * Pressed on pointerdown, not on click.
           *
           * A touchscreen only raises `click` for the *primary* pointer — the
           * first finger down — so a player already holding valves reaches for
           * this button with a second finger and no click is ever generated.
           * The button looked broken exactly when it was most needed, which is
           * while playing, since that is the only time a hand is already on
           * the screen. Pointerdown arrives for every finger, and answering it
           * is also the right feel for a control pressed mid-bar.
           */
          onPointerDown={(event) => {
            event.preventDefault();
            press();
          }}
          /* Keyboard activation still arrives as a click, with no pointer
             behind it — `detail` is zero for those and non-zero for the
             compatibility click a mouse would otherwise double up with. */
          onClick={(event) => {
            if (event.detail === 0) press();
          }}
        >
          {offering ? 'Continue' : 'Stop'}
        </button>
        <div className="play-stats">
          <span>
            {progress.done} / {targetNotes}
          </span>
          <span className="play-stats__accuracy">{accuracy}%</span>
        </div>
      </div>

      <div className="play-aside">
        <TempoSlider
          tempo={tempo}
          compound={metreFor(settings.beatsPerBar, settings.beatUnit).isCompound}
          onChange={(bpm) => {
            setTempo(bpm);
            // The clock takes it at the next beat it has not committed to;
            // the hints re-measure, since what there is time to read is a
            // question about seconds and the seconds have just changed.
            sessionRef.current?.transport.changeTempo(bpm);
            hintsRef.current?.retime();
          }}
        />
        {settings.conductorEnabled && transport && (
          <ConductorPanel
            transport={transport}
            metres={exercise.metres}
            style={settings.conductorStyle}
            /* The live one: the conductor chooses its pattern by tempo, and a
               hand still beating the speed the player has just left would be
               the one thing on screen disagreeing with the clock. */
            tempo={tempo}
            tempoEvents={exercise.tempo}
          />
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
