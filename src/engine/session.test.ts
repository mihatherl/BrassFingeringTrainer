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
    tupletGroup: -1,
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
    tempo: [],
    totalBeats: 4,
    chosenBeats: 4,
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

describe('a session across a step change', () => {
  /*
   * The one assertion that matters end to end: an exercise carrying a tempo
   * event is *scheduled* to it. Everything else about the map is proven in
   * domain tests; this drives a real session and reads back where the sounds
   * and clicks actually landed.
   */
  function steppedExercise(): Exercise {
    return {
      notes: [note(0, 1), note(1, 1), note(2, 1), note(3, 1)],
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metre: metreFor(2, 4),
      // Doubling at the second bar line, so every figure below is legible.
      tempo: [{ kind: 'tempo', atBeat: 2, bpm: 120 }],
      totalBeats: 4,
      chosenBeats: 4,
      seed: 1,
      kind: 'themes',
    };
  }

  it('sounds the notes where the map puts them, not where the slider points', () => {
    const s = session(steppedExercise());
    runTo(s, 4);

    const openingTime = s.transport.timeForBeat(0);
    const onsets = played.map((p) => Math.round((p.startTime - openingTime) * 100) / 100);
    // Crotchets at 60 then at 120: a second apart, then half a second.
    expect(onsets).toEqual([0, 1, 2, 2.5]);
    // And each note's sounding length follows the tempo it falls under.
    expect(played.map((p) => Math.round(p.duration * 100) / 100)).toEqual([
      0.92, 0.92, 0.46, 0.46,
    ]);
  });

  it('moves the metronome with the music, which is what makes it followable', () => {
    const at: number[] = [];
    const s = new Session({
      context,
      exercise: steppedExercise(),
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: true,
      playbackMode: 'off',
      brassVoice: voice,
    });
    const clickSpy = s as unknown as { metronome: { click: (t: number, a: boolean) => void } };
    clickSpy.metronome.click = (time: number) => {
      at.push(Math.round((time - s.transport.timeForBeat(0)) * 1000) / 1000);
    };

    runTo(s, 4);
    expect(at.filter((t) => t >= 0 && t <= 2.5)).toEqual([0, 1, 2, 2.5]);
  });
});

describe('the offer to carry on', () => {
  /*
   * Nothing is inferred from playing or silence any more. The music runs to
   * the length the player asked for; a few beats before it does, the session
   * offers more, and the offer is answered by a call or not at all.
   */
  function horizonExercise(chosenBeats = 8): Exercise {
    return {
      notes: Array.from({ length: 24 }, (_, i) => note(i, 1)),
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metre: metreFor(2, 4),
      tempo: [],
      totalBeats: 24,
      chosenBeats,
      seed: 1,
      kind: 'random',
    };
  }

  function run(from: number, to: number): void {
    for (let elapsed = from; elapsed <= to; elapsed += 0.025) {
      audioTime = elapsed;
      vi.advanceTimersByTime(25);
    }
  }

  interface Watched {
    session: Session;
    offers: boolean[];
    ended: () => number;
  }

  /** A session at 60bpm, where one second of audio time is one beat. */
  function watched(exercise: Exercise, playback: 'off' | 'reference' = 'off'): Watched {
    const offers: boolean[] = [];
    let endedAt = 0;
    const session = new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: playback,
      brassVoice: voice,
      onOffer: (offering) => offers.push(offering),
      onFinish: () => {
        endedAt = audioTime;
      },
    });
    return { session, offers, ended: () => endedAt };
  }

  it('ends at the length asked for when the offer is let pass', () => {
    const { session, ended } = watched(horizonExercise());
    session.start();
    run(0, 14);
    session.stop();

    // Eight beats chosen out of twenty-four on the paper, plus the tail.
    expect(ended()).toBeGreaterThanOrEqual(9);
    expect(ended()).toBeLessThan(10);
  });

  it('offers a few beats before the music runs out, once', () => {
    const { session, offers } = watched(horizonExercise());
    session.start();
    run(0, 3);
    expect(offers, 'nothing offered in the body of the run').toEqual([]);
    run(3, 5);
    expect(offers, 'offered four beats out, and only once').toEqual([true]);
    session.stop();
  });

  it('plays on when the offer is taken, and offers again next time', () => {
    const { session, offers, ended } = watched(horizonExercise());
    session.start();
    run(0, 5);
    expect(offers).toEqual([true]);

    session.continuePlaying();
    expect(offers, 'accepting withdraws the offer').toEqual([true, false]);
    expect(session.endBeat).toBe(16);

    run(5, 13);
    expect(offers, 'the next block asks for itself in its own last beats').toEqual([
      true,
      false,
      true,
    ]);
    expect(ended(), 'still going').toBe(0);

    run(13, 20);
    session.stop();
    expect(ended()).toBeGreaterThanOrEqual(17);
    expect(ended()).toBeLessThan(18);
  });

  it('sounds nothing that has not been asked for, then sounds it when it is', () => {
    const { session } = watched(horizonExercise(), 'reference');
    session.start();
    run(0, 5);
    // Eight beats committed: the notes at beats 8 and beyond are not ours.
    expect(played.every((p) => p.startTime < session.transport.timeForBeat(8))).toBe(true);
    const before = played.length;

    session.continuePlaying();
    run(5, 9);
    expect(played.length, 'the next block sounds once it is taken').toBeGreaterThan(before);
    session.stop();
  });

  it('refuses to be pressed twice for one block, or past the paper', () => {
    const { session } = watched(horizonExercise());
    session.start();
    run(0, 5);

    session.continuePlaying();
    session.continuePlaying();
    expect(session.endBeat, 'one press, one block').toBe(16);

    run(5, 13);
    session.continuePlaying();
    expect(session.endBeat, 'clamped to what was generated').toBe(24);
    expect(session.canContinue).toBe(false);

    session.continuePlaying();
    expect(session.endBeat).toBe(24);
    session.stop();
  });

  it('says nothing at all when the exercise has no horizon', () => {
    const { session, offers } = watched(horizonExercise(24));
    session.start();
    run(0, 26);
    session.stop();
    expect(offers).toEqual([]);
    expect(session.canContinue).toBe(false);
  });

  it('drops the reference tone while the offer stands, and restores it', () => {
    const volumes: number[] = [];
    const listening = { ...voice, setVolume: (v: number) => volumes.push(v) };
    const session = new Session({
      context,
      exercise: horizonExercise(),
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'reference',
      brassVoice: listening,
    });

    session.start();
    expect(volumes, 'a run starts at full voice').toEqual([1]);
    run(0, 5);
    expect(volumes[volumes.length - 1], 'quiet while the question stands').toBe(0.5);

    session.continuePlaying();
    expect(volumes[volumes.length - 1], 'answered, so back to full').toBe(1);
    session.stop();
  });

  it('stops on the spot when asked, reporting what was played', () => {
    let summary: SessionSummary | null = null;
    const s = new Session({
      context,
      exercise: horizonExercise(),
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
    s.start();
    run(0, 3);
    s.finishNow();

    const finished = summary as unknown as SessionSummary;
    expect(finished, 'the run is reported, not discarded').not.toBeNull();
    expect(finished.total).toBeGreaterThan(0);
    expect(finished.correct).toBe(finished.total);
    // And it is over: nothing more is judged after the fact.
    const judged = finished.total;
    run(3, 12);
    expect(s.judgements).toHaveLength(judged);
  });
});

describe('reaching the end of the paper', () => {
  /*
   * The horizon is generous, not infinite. A player who takes every offer
   * must be finished cleanly at the end of it rather than left running
   * against music that has run out — the one way an endless session could
   * hang.
   */
  it('finishes decisively when the last block is played', () => {
    let summary: SessionSummary | null = null;
    let endedAt = 0;
    const exercise: Exercise = {
      notes: Array.from({ length: 24 }, (_, i) => note(i * 0.5, 0.5)),
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metre: metreFor(2, 4),
      tempo: [],
      totalBeats: 12,
      chosenBeats: 4,
      seed: 1,
      kind: 'random',
    };

    // A player who says yes every time, until there is nothing left to say
    // yes to: four beats, then eight, then the whole twelve.
    const holder: { session?: Session } = {};
    holder.session = new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onOffer: (offering) => {
        if (offering) holder.session?.continuePlaying();
      },
      onFinish: (result) => {
        summary = result;
        endedAt = audioTime;
      },
    });
    const s = holder.session;

    s.input.pointerDown(1, 1);
    s.input.pointerDown(2, 2);
    s.start();
    for (let elapsed = 0; elapsed <= 20; elapsed += 0.025) {
      audioTime = elapsed;
      vi.advanceTimersByTime(25);
    }
    s.stop();

    expect(summary, 'the run must end, not hang').not.toBeNull();
    const finished = summary as unknown as SessionSummary;
    expect(finished.total, 'every note on the paper').toBe(24);
    expect(finished.correct).toBe(24);
    expect(s.canContinue, 'nothing left to offer').toBe(false);
    // At the paper's end plus the tail, and nowhere later.
    expect(endedAt).toBeGreaterThanOrEqual(12);
    expect(endedAt).toBeLessThan(14);
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
      tempo: [],
      totalBeats: bars * metre.barBeats,
      chosenBeats: bars * metre.barBeats,
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
