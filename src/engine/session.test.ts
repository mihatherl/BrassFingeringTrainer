// @vitest-environment happy-dom

import { metreFor } from '../domain/metre';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voice } from '../audio/sampler';
import { spellInKey } from '../domain/keys';
import { durationFromBeats } from '../domain/rhythm';
import type { Exercise, NoteEvent } from '../exercise/types';
import type { SessionSummary } from './judge';
import { Session } from './session';

/**
 * What a tie costs the engine, checked against a running session.
 *
 * The whole of the tie rule lives here — the far end of one is not sounded and
 * not judged — and it is not visible from any pure function, so it is driven
 * through a real `Session` with the two clocks it reads faked out: the audio
 * clock advances only when told, and the timers with it.
 */

let audioTime = 0;
let played: Array<{ midi: number; startTime: number; duration: number }> = [];

const context = {
  get currentTime() {
    return audioTime;
  },
  get destination() {
    return {} as AudioNode;
  },
  createGain: () => ({ gain: { value: 0 }, connect: () => {} }),
} as unknown as AudioContext;

const voice: Voice = {
  play: (midi, startTime, duration) => played.push({ midi, startTime, duration }),
  setVolume: () => {},
  stop: () => {},
};

function note(startBeat: number, beats: number, tiedToNext = false): NoteEvent {
  return {
    writtenMidi: 60,
    pitch: spellInKey(60, 0),
    soundingMidi: 60,
    startBeat,
    duration: durationFromBeats(beats)!,
    // Valves 1 and 2, so "nothing held" is distinguishable from the answer.
    acceptedMasks: [0b011],
    primaryMask: 0b011,
    beamGroup: -1,
    tiedToNext,
    showAccidental: false,
  };
}

/**
 * Four crotchets across two bars of 2/4, the second of which is tied over the
 * bar line into the third. Three sounds, four noteheads.
 */
function tiedExercise(): Exercise {
  return {
    notes: [note(0, 1), note(1, 1, true), note(2, 1), note(3, 1)],
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metre: metreFor(2, 4),
    totalBeats: 4,
    seed: 1,
    kind: 'random',
  };
}

function session(exercise: Exercise, playback: 'off' | 'reference' = 'reference'): Session {
  return new Session({
    context,
    exercise,
    // 60bpm: one beat is one second, so the arithmetic below stays legible.
    tempo: 60,
    countInBars: 0,
    metronomeEnabled: false,
    playbackMode: playback,
    brassVoice: voice,
  });
}

/** Runs the session from the start to `toBeat`, ticking both clocks together. */
function runTo(s: Session, toBeat: number): void {
  s.start();
  // 25ms a step, which is the transport's own tick, so nothing is skipped over.
  for (let elapsed = 0; elapsed <= toBeat + 2; elapsed += 0.025) {
    audioTime = elapsed;
    vi.advanceTimersByTime(25);
  }
  s.stop();
}

beforeEach(() => {
  vi.useFakeTimers();
  audioTime = 0;
  played = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a session with a tie in it', () => {
  it('judges the noteheads that were played, and not the one that was held', () => {
    const s = session(tiedExercise(), 'off');
    // The right fingering, held down throughout, so nothing but the tie rule
    // decides how many verdicts come back.
    s.input.pointerDown(1, 1);
    s.input.pointerDown(2, 2);

    runTo(s, 4);

    expect(s.judgements.map((j) => j.noteIndex)).toEqual([0, 1, 3]);
    expect(s.judgements.every((j) => j.verdict === 'correct')).toBe(true);
  });

  it('sounds a tie once, for as long as the whole chain lasts', () => {
    const s = session(tiedExercise());
    runTo(s, 4);

    // Three attacks for four noteheads, and the tied one is two beats long
    // rather than one — which is the only thing that makes it sound tied.
    expect(played.map((p) => Math.round(p.duration * 100) / 100)).toEqual([0.92, 1.84, 0.92]);
  });

  it('leaves nothing tied out of the totals', () => {
    // A note marked right for being held is not evidence of anything, and would
    // quietly inflate both the score and the per-note accuracy behind hints.
    let summary: SessionSummary | null = null;
    const s = new Session({
      context,
      exercise: tiedExercise(),
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onFinish: (result) => {
        summary = result;
      },
    });
    s.input.pointerDown(1, 1);
    s.input.pointerDown(2, 2);

    runTo(s, 4);

    expect(summary).not.toBeNull();
    const finished = summary as unknown as SessionSummary;
    expect(finished.total, 'four noteheads, three notes played').toBe(3);
    expect(finished.correct).toBe(3);
    // Three attempts at the one pitch, not four.
    expect(finished.byNote.get(60)).toEqual({ attempts: 3, correct: 3 });
  });

  it('confirms a tied note once, when it is played rather than when it is held', () => {
    const confirmed: number[] = [];
    const exercise = tiedExercise();
    const s = new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onCorrect: (index) => confirmed.push(index),
    });
    s.input.pointerDown(1, 1);
    s.input.pointerDown(2, 2);

    runTo(s, 4);

    // Note 2 is the far end of the tie. A green flash there would be applause
    // for keeping still.
    expect(confirmed).toEqual([0, 1, 3]);
  });
});

describe('the metronome in compound time', () => {
  /*
   * 6/8 is two clicks to a bar, on the dotted crotchets. Clicking every
   * crotchet — which is what counting in the time unit rather than the pulse
   * gives you — puts three clicks in a bar of 6/8, in places where nobody is
   * counting and very little of the music falls.
   */
  function clicksFor(metre: Exercise['metre'], bars: number): number[] {
    const at: number[] = [];
    const metronome: string[] = [];
    void metronome;
    const exercise: Exercise = {
      notes: [],
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metre,
      totalBeats: bars * metre.barBeats,
      seed: 1,
      kind: 'random',
    };

    const s = new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: true,
      playbackMode: 'off',
      brassVoice: voice,
    });
    // The metronome schedules against the audio clock, so its click times are
    // read back through the transport rather than counted by hand.
    const clickSpy = s as unknown as { metronome: { click: (t: number, a: boolean) => void } };
    const original = clickSpy.metronome.click.bind(clickSpy.metronome);
    void original;
    clickSpy.metronome.click = (time: number) => {
      at.push(Math.round((time - s.transport.timeForBeat(0)) * 1000) / 1000);
    };

    runTo(s, exercise.totalBeats);
    return at;
  }

  it('clicks twice a bar in 6/8, on the dotted crotchets', () => {
    const clicks = clicksFor(metreFor(6, 8), 2);
    // Two bars of three crotchets: beats 0, 1.5, 3, 4.5.
    expect(clicks.filter((t) => t >= 0 && t <= 4.5)).toEqual([0, 1.5, 3, 4.5]);
  });

  it('still clicks every crotchet in 4/4', () => {
    const clicks = clicksFor(metreFor(4, 4), 2);
    expect(clicks.filter((t) => t >= 0 && t <= 7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
