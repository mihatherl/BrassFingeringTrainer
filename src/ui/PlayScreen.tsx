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
import { FollowingVoice } from '../audio/following-voice';
import { Sampler, type Voice } from '../audio/sampler';
import { barAt, metreFor } from '../domain/metre';
import { keyAt } from '../domain/keys';
import { instrumentById } from '../domain/instruments';
import type { Transport } from '../engine/clock';
import { Session } from '../engine/session';
import { fingeringHints, type Hints } from '../exercise/hints';
import { soundingHeads } from '../exercise/ties';
import { loadStats } from '../storage/stats';
import { SCORE_WINDOW_BARS, type NoteJudgement, type SessionSummary, type Verdict } from '../engine/judge';
import { currentTheme, StaveRenderer } from '../render/surface';
import type { Exercise } from '../exercise/types';
import { audioLeadFor, type Settings } from '../storage/settings';
import { patternFor } from '../render/conductor';
import { barLabel } from '../render/system';
import { ConductorPanel } from './ConductorPanel';
import { KeyDial } from './KeyDial';
import { PressButton } from './PressButton';
import { TempoDial } from './TempoDial';
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
  /**
   * The same exercise this run is playing, generated in another key.
   *
   * The whole of what the key dial needs from outside, and the reason it is a
   * function rather than a key: writing music is the generator's business, and
   * what the generator wants is the settings — which this screen has a copy of
   * but is not the owner of. The caller builds it from the real ones.
   *
   * Absent means no dial: imported music cannot be regenerated at all, and the
   * free tier is entitled to one key.
   */
  inKey?: (fifths: number) => Exercise;
  /** The key the player settled on, reported when the run ends, as with tempo. */
  onKeySettled?: (fifths: number) => void;
}

export function PlayScreen({
  settings,
  exercise,
  onFinish,
  onExit,
  onTempoSettled,
  inKey,
  onKeySettled,
}: PlayScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const rendererRef = useRef<StaveRenderer | null>(null);
  const verdictsRef = useRef<Array<Verdict | undefined>>([]);
  const hintsRef = useRef<Hints | null>(null);
  const headsRef = useRef<number[]>([]);

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
  /**
   * The key the dial is pointing at, which is not the same as the key of the
   * music while a finger is on it.
   *
   * The dial's own state: it moves at every detent so the face and the callout
   * follow the finger, and the music is rewritten only when the finger comes
   * off. Opens on the key the exercise opens in — the settings key, honoured
   * until the dial is touched.
   */
  const [dialKey, setDialKey] = useState(() => keyAt(exercise.keys, 0));
  /** Which bar a change would land in, read off the session while turning. */
  const [changeBar, setChangeBar] = useState<string | null>(null);
  /*
   * State rather than a ref, unlike the session and renderer beside it.
   * Those are only ever reached from callbacks; the conductor is a child that
   * has to be *rendered* with it, and a ref assigned inside the effect would
   * never trigger the render that mounts it.
   */
  const [transport, setTransport] = useState<Transport | null>(null);
  /** Whether the music is about to run out and more may be asked for. */
  const [offering, setOffering] = useState(false);
  /** Whether the run is being held, which is what the second button says. */
  const [paused, setPaused] = useState(false);
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
  const keySettledRef = useRef(onKeySettled);
  keySettledRef.current = onKeySettled;
  const dialKeyRef = useRef(dialKey);
  dialKeyRef.current = dialKey;

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setOffering(false);
    setPaused(false);
    setCommittedBeats(exercise.chosenBeats);
    verdictsRef.current = new Array(exercise.notes.length).fill(undefined);
    /*
     * Which note actually sounds each written one, so the renderer can look a
     * verdict up through a tie. Walked once rather than on every note of every
     * frame — and in a ref rather than a const, because a key change rewrites
     * the note list and its ties with it.
     */
    headsRef.current = soundingHeads(exercise.notes);
    setTempo(settings.tempo);
    /*
     * The key this run opens in, kept for the whole run.
     *
     * Read now rather than at the end, because a key change lands at beat 0
     * when it is asked for during the count-in — which rewrites the opening key
     * itself, and would leave nothing to compare the dial against.
     */
    const openedIn = keyAt(exercise.keys, 0);
    setDialKey(openedIn);

    /*
     * The counter and the live percentage, recomputed from the verdicts.
     *
     * The percentage reads the scoring window rather than the whole run: a bad
     * patch scrolls out of it, which is what makes the figure worth glancing at
     * late in a long session. One pass per note judged, nowhere near a frame —
     * and the same pass after a rewind, which takes verdicts away again.
     */
    const report = () => {
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
    };

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
      // The output in the player's ears, and how far behind the clock it is
      // heard; zero for the phone's own speaker.
      audioLead: audioLeadFor(settings),
      // Fires as the fingers arrive, not when the note is finally judged, so
      // the green reads as confirmation of what was just played.
      onCorrect: () => rendererRef.current?.flashCorrect(),
      onJudgement: (judgement: NoteJudgement) => {
        verdictsRef.current[judgement.noteIndex] = judgement.verdict;
        report();

        /*
         * Every verdict, not only the bad ones: a mistake is answered on the
         * note immediately, and two right in a row take the prompting away
         * again. This is the whole reason the hints stopped being settled once
         * from stored history — an answer that arrives next session is not
         * teaching anybody anything, and a prompt that never stops is not
         * either.
         */
        hintsRef.current?.judged(judgement.noteIndex, judgement.verdict);
      },
      /*
       * A rewind takes its bars back out of the score.
       *
       * The session has already dropped their judgements — a bar gone back to
       * is a bar to be played again, and scoring both attempts would score the
       * one the player went back to disown. The colours on the page are this
       * screen's copy of the same thing, so they go with them, and the counter
       * is recomputed from what is left.
       */
      onRewind: (from: number) => {
        for (let index = from; index < verdictsRef.current.length; index++) {
          verdictsRef.current[index] = undefined;
        }
        report();
      },
      onFinish: (summary) => {
        // The speed they ended up playing at is the one they want next time, and
        // the key they ended up in for the same reason: the dial is what the
        // player has said about this practice, and saying it once is enough.
        if (tempoRef.current !== settings.tempo) settledRef.current?.(tempoRef.current);
        if (dialKeyRef.current !== openedIn) keySettledRef.current?.(dialKeyRef.current);
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
      /*
       * The paper past the change has been rewritten, so everything this screen
       * keeps *about* the paper by note index has to be rewritten with it.
       *
       * The exercise object is the same one — it was spliced in place, which is
       * exactly why each of these has to be told rather than simply re-read.
       * Below `fromNoteIndex` nothing has moved and nothing here is touched:
       * that is the invariant the splice point is chosen to guarantee, and the
       * reason a run can change key without losing what the player has played.
       */
      onKeyChange: ({ fromNoteIndex }) => {
        const verdicts = verdictsRef.current;
        verdicts.length = exercise.notes.length;
        for (let index = fromNoteIndex; index < verdicts.length; index++) {
          verdicts[index] = undefined;
        }
        headsRef.current = soundingHeads(exercise.notes);
        // Which notes may carry a hint at all is read off the note list; what the
        // run has learned is filed under the written pitch and survives untouched.
        hintsRef.current?.reread();
        rendererRef.current?.rekeyed();
        report();
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
    hintsRef.current = fingeringHints({
      exercise,
      stats: loadStats(exercise.instrumentId, exercise.clef),
      mode: settings.fingerings,
      secondsBetween: (from, to) => session.transport.secondsBetween(from, to),
    });

    const renderer = new StaveRenderer({
      canvas,
      exercise,
      transport: session.transport,
      theme: currentTheme(),
      scrollSpeed: settings.scrollSpeed,
      readingMode: settings.readingMode,
      // Through the tie: its far end is never judged, so it wears the verdict of
      // the note it is tied from rather than staying unmarked beside it.
      verdictFor: (index) => verdictsRef.current[headsRef.current[index]],
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
                  const set = instrumentById(exercise.instrumentId).sampleSet;
                  // `?voice=pad` is a trial: a synth pad until the fingers
                  // are right, the instrument once they are. See
                  // `FollowingVoice`.
                  voiceRef.current =
                    new URLSearchParams(window.location.search).get('voice') === 'pad'
                      ? await FollowingVoice.load(context, set)
                      : await Sampler.load(context, set);
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

  /*
   * The three transport buttons, all pressed the same way as the big one and
   * for the same reason: a touchscreen raises `click` only for the first
   * finger down, and every one of these is reached for with a second.
   */
  const holdOrPlay = () => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.isPaused) session.resume();
    else session.pause();
    setPaused(session.isPaused);
  };

  const goBack = (bars: number) => {
    const session = sessionRef.current;
    session?.rewind(bars);
  };

  /*
   * Turning the key dial: the face moves now, the music moves on release.
   *
   * Every detent updates the shown key and asks the session where a change made
   * at this moment would land, so the callout can say which bar. Asking per
   * detent rather than once at the start because the playhead is moving while
   * the finger is: a slow turn through five keys can cross the bar the first
   * detent would have landed in.
   */
  const turnKey = (fifths: number) => {
    setDialKey(fifths);
    const session = sessionRef.current;
    setChangeBar(session ? barLabel(exercise, barAt(exercise.metres, session.keyChangeBeat)) : null);
  };

  const commitKey = (fifths: number) => {
    const session = sessionRef.current;
    if (!session || !inKey) return;
    /*
     * The music is rewritten from a bar line ahead of the playhead, or not at
     * all — `changeKey` refuses a change that would land past the end of the
     * paper, and the dial is left showing the key the player chose either way.
     * Putting the face back would be arguing with them about a choice that was
     * theirs, over an outcome they cannot see.
     */
    session.changeKey(inKey(fifths));
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
        <PressButton
          className={`button play-action ${offering ? 'play-action--continue' : 'play-action--stop'}`}
          onPress={press}
        >
          {offering ? 'Continue' : 'Stop'}
        </PressButton>

        {/*
          Hold it, and take it from a bar or five back — the two things said
          most often in a practice room, and neither of them possible until now
          without ending the run and generating a different exercise.
        */}
        <div className="play-transport">
          <PressButton className="button play-step" onPress={holdOrPlay}>
            {paused ? 'Start' : 'Pause'}
          </PressButton>
          <PressButton
            className="button play-step play-step--back"
            onPress={() => goBack(1)}
            label="Back one bar"
          >
            <span aria-hidden="true">◀1</span>
          </PressButton>
          <PressButton
            className="button play-step play-step--back"
            onPress={() => goBack(5)}
            label="Back five bars"
          >
            <span aria-hidden="true">◀5</span>
          </PressButton>
        </div>
        <div className="play-stats">
          <span>
            {progress.done} / {targetNotes}
          </span>
          <span className="play-stats__accuracy">{accuracy}%</span>
        </div>
      </div>

      <div className="play-aside">
        <TempoDial
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
        {/* Only where the music can be rewritten: not for an imported part,
            which has no generator behind it, and not on the free tier, which is
            entitled to one key. */}
        {inKey && (
          <KeyDial
            fifths={dialKey}
            onChange={turnKey}
            onCommit={commitKey}
            fromBar={changeBar}
          />
        )}
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
