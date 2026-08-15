// @vitest-environment happy-dom

import { beatOfBar, metreFor, type Metre, type MetreChange } from '../domain/metre';
import { patternFor } from '../render/conductor';
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
    metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
    tempo: [],
    totalBeats: 4,
    chosenBeats: 4,
    seed: 1,
    kind: 'phrases',
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

describe('a note the instrument cannot play', () => {
  /**
   * Four crotchets, the third of which has no fingering at all — which is what
   * an imported part produces when it reaches above what the player is holding.
   * A cornet part read on a tuba is the ordinary way in.
   */
  function beyondReach(): Exercise {
    const notes = [note(0, 1), note(1, 1), note(2, 1), note(3, 1)];
    notes[2] = { ...notes[2], acceptedMasks: [], primaryMask: 0 };
    return {
      notes,
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
      tempo: [],
      totalBeats: 4,
      chosenBeats: 4,
      seed: 1,
      kind: 'imported',
    };
  }

  it('is passed over rather than judged wrong', () => {
    /*
     * Nothing the player holds could ever match an empty accepted list, so a
     * verdict on it is not evidence of anything — the same reason the far end
     * of a tie is passed over. Judged, it would be a wrong answer nobody could
     * have got right, quietly spoiling the score for the whole run.
     */
    const s = session(beyondReach(), 'off');
    s.input.pointerDown(1, 1);
    s.input.pointerDown(2, 2);

    runTo(s, 4);

    expect(s.judgements.map((j) => j.noteIndex)).toEqual([0, 1, 3]);
    expect(s.judgements.every((j) => j.verdict === 'correct')).toBe(true);
  });

  it('is still sounded, because it is what the part says', () => {
    // Not judged is not the same as not there: the note is on the page and in
    // the reference playback, and only the marking passes over it.
    const s = session(beyondReach());
    runTo(s, 4);
    expect(played).toHaveLength(4);
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
      metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
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
      metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
      tempo: [],
      totalBeats: 24,
      chosenBeats,
      seed: 1,
      kind: 'phrases',
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

  it('ends when the offer is let pass, a few beats past the length asked for', () => {
    const { session, ended } = watched(horizonExercise());
    session.start();
    run(0, 16);
    session.stop();

    // Eight beats chosen, four more played on offer, then the tail. The
    // music does not stop dead at the boundary: it waits to be joined.
    expect(ended()).toBeGreaterThanOrEqual(13);
    expect(ended()).toBeLessThan(14);
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

    run(13, 24);
    session.stop();
    // Sixteen committed, four on offer, then the tail.
    expect(ended()).toBeGreaterThanOrEqual(21);
    expect(ended()).toBeLessThan(22);
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

  it('takes the offer from a player who simply carries on', () => {
    /*
     * The button is not the only way to say yes. A player in the middle of a
     * phrase should not have to lift a hand off the instrument to ask for
     * more, so a valve down past the committed end takes the offer exactly
     * as pressing does.
     */
    const { session, ended } = watched(horizonExercise());
    session.input.pointerDown(1, 1);
    session.start();
    run(0, 10);

    expect(session.endBeat, 'playing on bought another block').toBe(16);
    expect(ended(), 'and the run is still going').toBe(0);
    session.stop();
  });

  it('leaves the chosen length alone while the player is inside it', () => {
    // Playing means playing until the music runs out. Reading it as a request
    // for more before then would make the length setting impossible to obey.
    const { session } = watched(horizonExercise());
    session.input.pointerDown(1, 1);
    session.start();
    run(0, 6);
    expect(session.endBeat).toBe(8);
    session.stop();
  });

  it('scores what was asked for, not what was offered and declined', () => {
    /*
     * The music plays on past the committed end while it waits to hear. A
     * player who lets it pass never agreed to those notes, so they are
     * dropped rather than counted as missed — otherwise declining more music
     * would cost you marks for declining it.
     */
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
    run(0, 7.5);
    // Hands off just before the boundary: the offer passes unanswered.
    s.input.releaseAll();
    run(7.5, 20);
    s.stop();

    const finished = summary as unknown as SessionSummary;
    expect(finished, 'the run ended').not.toBeNull();
    // Eight beats of chosen music, all played correctly, and nothing beyond.
    expect(finished.total).toBe(8);
    expect(finished.correct).toBe(8);
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

  /**
   * A rewind out of the offer window, which used to leave the offer standing
   * for ever: the button stayed green, the tone stayed at half volume, and
   * because the flag was never cleared the question could not be asked again.
   */
  it('withdraws the offer when a rewind takes the run out from under it', () => {
    const offers: boolean[] = [];
    const volumes: number[] = [];
    const session = new Session({
      context,
      exercise: horizonExercise(),
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'reference',
      brassVoice: { ...voice, setVolume: (v: number) => volumes.push(v) },
      onOffer: (offering) => offers.push(offering),
    });

    session.start();
    run(0, 5);
    expect(offers, 'the question is standing').toEqual([true]);
    expect(volumes[volumes.length - 1]).toBe(0.5);

    // Back to the top, from inside the window the offer was made in.
    session.rewind(2);
    expect(offers, 'taken back with the pass it belonged to').toEqual([true, false]);
    expect(volumes[volumes.length - 1], 'the tone comes back up with it').toBe(1);
    expect(session.endBeat, 'and the length asked for is left alone').toBe(8);

    // Played back down to the same place and asked again — which only happens
    // if the flag was cleared and not merely the button.
    run(5, 12);
    expect(offers).toEqual([true, false, true]);
    session.stop();
  });

  /**
   * A rewind pressed during the count-in, which is reachable — nothing disables
   * the buttons before the music starts — and had never been played through.
   *
   * There is no pickup case hiding behind it: an imported part that begins
   * part-way through a bar is padded up to the bar line by the importer, so an
   * exercise's beat 0 is always a bar line and the count-in is always whole
   * bars of one. See the pickup handling in `import/part.ts`.
   */
  it('re-counts from the top when rewound during the count-in', () => {
    const judged: number[] = [];
    const session = new Session({
      context,
      exercise: horizonExercise(),
      tempo: 60,
      // Two bars of two-four: four beats of counting before the first note.
      countInBars: 2,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onJudgement: (j) => judged.push(j.noteIndex),
    });

    session.start();
    // Two beats in, still counting: nothing has been asked of the player yet.
    run(0, 2);
    expect(judged, 'the count-in judges nothing').toEqual([]);

    session.rewind(1);
    // A rewind counts in one real bar wherever it lands — a bar of two-four
    // here — so the music starts again two beats later and not before.
    run(2, 3.5);
    expect(judged, 'nor does the bar a rewind counts in').toEqual([]);

    run(3.5, 12);
    expect(judged.slice(0, 4), 'and then from the top, in order').toEqual([0, 1, 2, 3]);
    session.stop();
  });

  /**
   * ◀5 pressed in bar two, which is most of what it is for early in a piece.
   * The buttons are never disabled — asking for more bars than there are is
   * simply a request to go back to the top, and it is granted.
   */
  it('goes to the top when asked for more bars than there are', () => {
    const judged: number[] = [];
    const session = new Session({
      context,
      exercise: horizonExercise(),
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onJudgement: (j) => judged.push(j.noteIndex),
    });

    session.start();
    run(0, 3);
    expect(judged.length, 'a couple of bars in').toBeGreaterThan(0);

    // Only bar two is behind the playhead, and five were asked for.
    const played = judged.length;
    session.rewind(5);
    expect(session.judgements, 'everything played is disowned').toEqual([]);

    // From note 0, after the bar it counts in — not from wherever it gave up.
    run(3, 12);
    expect(judged[played], 'the piece starts again at its first note').toBe(0);
    session.stop();
  });

  /** The same, paused: a rewind while held moves where the run picks up from. */
  it('withdraws the offer on a rewind made while paused', () => {
    const { session, offers } = watched(horizonExercise());
    session.start();
    run(0, 5);
    expect(offers).toEqual([true]);

    session.pause();
    session.rewind(1);
    expect(offers, 'the offer belongs to the moment, not the run').toEqual([true, false]);
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
      metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
      tempo: [],
      totalBeats: 12,
      chosenBeats: 4,
      seed: 1,
      kind: 'phrases',
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

/**
 * Changing key mid-run.
 *
 * The engine's half of the key dial: where a change may land, and what a splice
 * is allowed to disturb. What the music becomes is `exercise/rekey.ts`; this is
 * only about the clock and the run's own state, and the one thing it is really
 * guarding is that a change lands somewhere the player has not been yet.
 */
describe('changing key mid-run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audioTime = 0;
    played = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sixteen crotchets in four bars of 4/4, one key throughout. */
  function paper(fifths: number): Exercise {
    return {
      notes: Array.from({ length: 16 }, (_, i) => note(i, 1)),
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths }],
      metres: [{ fromBeat: 0, metre: metreFor(4, 4) }],
      tempo: [],
      totalBeats: 16,
      chosenBeats: 16,
      seed: 1,
      kind: 'phrases',
    };
  }

  function run(from: number, to: number): void {
    for (let elapsed = from; elapsed <= to; elapsed += 0.025) {
      audioTime = elapsed;
      vi.advanceTimersByTime(25);
    }
  }

  /**
   * A session and the paper it is playing, which the caller keeps hold of.
   *
   * The exercise is spliced *in place*, so the object handed in is the object
   * that changes — which is the whole arrangement the renderer and the play
   * screen rely on, and worth testing through rather than around.
   */
  function playing(over: { countInBars?: number; onKeyChange?: () => void } = {}) {
    const exercise = paper(0);
    const session = new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: over.countInBars ?? 0,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onKeyChange: over.onKeyChange,
    });
    return { session, exercise };
  }

  it('lands on a bar line the player has not reached', () => {
    const { session } = playing();
    session.start();
    run(0, 5);

    // Five beats in — bar two — with a bar of reading room and then the next
    // bar line. Never behind the playhead, and never mid-bar.
    const beat = session.keyChangeBeat;
    expect(beat % 4, 'a bar line').toBe(0);
    expect(beat, 'and one the player has not played yet').toBeGreaterThan(5);
    session.stop();
  });

  /**
   * The whole exercise, when the dial is turned before a note is played. A
   * player doing it during the count-in means the lot, and the arithmetic
   * agrees without a special case: bar zero is a bar line like any other.
   */
  it('takes the whole exercise when turned during the count-in', () => {
    const { session, exercise } = playing({ countInBars: 2 });
    session.start();
    expect(session.keyChangeBeat).toBe(0);

    const done = session.changeKey(paper(3));
    expect(done?.fromNoteIndex, 'from the very first note').toBe(0);
    expect(exercise.keys, 'and the opening key itself is rewritten').toEqual([
      { fromBeat: 0, fifths: 3 },
    ]);
    session.stop();
  });

  it('rewrites the paper without disturbing what has been judged', () => {
    let changed = 0;
    const { session, exercise } = playing({ onKeyChange: () => changed++ });

    session.input.pointerDown(1, 1);
    session.input.pointerDown(2, 2);
    session.start();
    run(0, 5);

    const judged = session.judgements.map((j) => ({ ...j }));
    expect(judged.length, 'some bars are behind us').toBeGreaterThan(0);

    const done = session.changeKey(paper(4));
    expect(done, 'the key changed').not.toBeNull();
    expect(changed, 'and said so once').toBe(1);

    // Every judgement still names the note it named. The splice point is
    // derived from the transport's committed beat, so nothing judged can be
    // at or past it — this is the invariant, checked rather than asserted.
    expect(session.judgements).toEqual(judged);
    for (const judgement of judged) {
      expect(judgement.noteIndex).toBeLessThan(done!.fromNoteIndex);
    }
    expect(exercise.notes.length, 'the paper is still the same length').toBe(16);
    session.stop();
  });

  it('refuses once the run is over', () => {
    const { session } = playing();
    session.start();
    run(0, 1);
    session.finishNow();
    expect(session.changeKey(paper(3))).toBeNull();
  });

  /**
   * Nothing already handed to the audio thread may be rewritten, which is what
   * the scheduling horizon is for. Checked by asking where a change would land
   * against what the transport has committed.
   */
  it('never lands on music already committed to the audio thread', () => {
    const { session } = playing();
    session.start();
    for (let elapsed = 0; elapsed <= 8; elapsed += 0.05) {
      audioTime = elapsed;
      vi.advanceTimersByTime(50);
      expect(session.keyChangeBeat).toBeGreaterThan(session.transport.committedBeat);
    }
    session.stop();
  });
});

/**
 * Every click a session schedules, as beats from the start of the music.
 *
 * The metronome schedules against the audio clock, so the times are read back
 * through the transport rather than counted by hand. Shared by the two blocks
 * below, which ask different questions of the same walk: where the clicks fall
 * within a metre, and which bars get any at all.
 */
function clicksFor(
  metres: MetreChange[],
  bars: number,
  over: { metronomeEnabled?: boolean; needsBeatSounded?: (metre: Metre) => boolean } = {},
): number[] {
  const at: number[] = [];
  const metronome: string[] = [];
  void metronome;
  const exercise: Exercise = {
    notes: [],
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metres,
    tempo: [],
    totalBeats: beatOfBar(metres, bars),
    chosenBeats: beatOfBar(metres, bars),
    seed: 1,
    kind: 'phrases',
  };

  const s = new Session({
    context,
    exercise,
    tempo: 60,
    countInBars: 0,
    metronomeEnabled: true,
    playbackMode: 'off',
    brassVoice: voice,
    ...over,
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

describe('the metronome in compound time', () => {
  /*
   * 6/8 is two clicks to a bar, on the dotted crotchets. Clicking every
   * crotchet — which is what counting in the time unit rather than the pulse
   * gives you — puts three clicks in a bar of 6/8, in places where nobody is
   * counting and very little of the music falls.
   */

  it('clicks twice a bar in 6/8, on the dotted crotchets', () => {
    const clicks = clicksFor([{ fromBeat: 0, metre: metreFor(6, 8) }], 2);
    /*
     * At a setting of 60 the clicks are a second apart, because the number
     * counts the beat that is conducted — sixty dotted crotchets a minute,
     * two to the bar, so a bar lasts two seconds.
     *
     * These used to be 1.5s apart: the setting named the crotchet, so 60 in
     * 6/8 was conducted at 40 and a march was unreachable at any slider
     * position. Same clicks, same places in the music; the rate is what the
     * player asked for now.
     */
    expect(clicks.filter((t) => t >= 0 && t <= 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('still clicks every crotchet in 4/4', () => {
    const clicks = clicksFor([{ fromBeat: 0, metre: metreFor(4, 4) }], 2);
    expect(clicks.filter((t) => t >= 0 && t <= 7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('changes rate where the metre changes', () => {
    /*
     * Two bars of 2/4 and then two of 6/8, which is the case the whole metre
     * list exists for. The clock does not change: the setting names the beat
     * the piece opened in, so a crotchet is a second throughout.
     *
     * What changes is where the clicks fall. Two to a bar in both, but a bar of
     * 2/4 is two crotchets and a bar of 6/8 is three, so the second pair spaces
     * out to a beat and a half — 4 and 5.5, not 4 and 5. A single pulse length
     * taken from the opening metre would click straight through the change and
     * count the second half of the piece in a metre it is no longer in.
     */
    const clicks = clicksFor(
      [
        { fromBeat: 0, metre: metreFor(2, 4) },
        { fromBeat: 4, metre: metreFor(6, 8) },
      ],
      4,
    );
    expect(clicks.filter((t) => t >= 0 && t <= 8.5)).toEqual([0, 1, 2, 3, 4, 5.5, 7, 8.5]);
  });
});

describe('keeping time where the conductor cannot', () => {
  /*
   * The conductor draws nothing for a metre it has no taught pattern for — an
   * imported bar of five, most likely — and `patternFor` has always said the
   * metronome carries on. It only does if the player left it switched on, and
   * plenty do not: counting for yourself is most of what reading is.
   *
   * So for that bar, and only that bar, the clicks come back. The player is
   * given the beat exactly where the app has taken away the one thing that was
   * showing it, and nowhere else.
   */
  const fourFourWithAFive: MetreChange[] = [
    { fromBeat: 0, metre: metreFor(4, 4) },
    { fromBeat: 4, metre: metreFor(5, 4) },
    { fromBeat: 9, metre: metreFor(4, 4) },
  ];

  /** What the play screen passes: the conductor is on, and cannot beat a five. */
  const conducting = (metre: Metre) => patternFor(metre) === null;

  it('clicks through the bar the conductor drops, and no others', () => {
    const clicks = clicksFor(fourFourWithAFive, 3, {
      metronomeEnabled: false,
      needsBeatSounded: conducting,
    });
    // Beats 4 to 8 are the five-four bar. Nothing before it, nothing after.
    expect(clicks.filter((t) => t >= 0 && t < 13)).toEqual([4, 5, 6, 7, 8]);
  });

  it('says nothing anywhere when the conductor can beat the whole piece', () => {
    const clicks = clicksFor([{ fromBeat: 0, metre: metreFor(4, 4) }], 3, {
      metronomeEnabled: false,
      needsBeatSounded: conducting,
    });
    expect(clicks).toEqual([]);
  });

  it('leaves the metronome alone where the player wanted it', () => {
    // Switched on, it clicks the whole piece as it always did — the odd bar
    // included, at five clicks to the bar, which is what its own metre says.
    const clicks = clicksFor(fourFourWithAFive, 3, {
      metronomeEnabled: true,
      needsBeatSounded: conducting,
    });
    expect(clicks.filter((t) => t >= 0 && t < 13)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('says nothing when the conductor is off too, which is the player counting', () => {
    // No predicate is what the play screen passes with the conductor switched
    // off. Nothing has been taken away, so nothing is put back.
    const clicks = clicksFor(fourFourWithAFive, 3, { metronomeEnabled: false });
    expect(clicks).toEqual([]);
  });
});

/**
 * Stopping without stopping, and going back a bar.
 *
 * A practice room runs on both — "hold on", and "take it from the bar before" —
 * and neither existed: the only way to have another go at a passage was to end
 * the run and generate a fresh exercise. The properties that matter are that a
 * pause really *stops* (the audio clock does not, so the transport has to
 * freeze rather than merely stop scheduling), and that a bar gone back to is a
 * bar that can be played again — which means the score has to let go of what it
 * already thought of it.
 */
describe('pausing and rewinding', () => {
  /** Four bars of 2/4, a crotchet a beat, so bars and beats stay legible. */
  function eightNotes(): Exercise {
    return {
      notes: [0, 1, 2, 3, 4, 5, 6, 7].map((beat) => note(beat, 1)),
      rests: [],
      instrumentId: 'eb-bass',
      clef: 'treble',
      keys: [{ fromBeat: 0, fifths: 0 }],
      metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
      tempo: [],
      totalBeats: 8,
      chosenBeats: 8,
      seed: 1,
      kind: 'phrases',
    };
  }

  /** Advances both clocks together, without starting or stopping anything. */
  function advance(seconds: number): void {
    const until = audioTime + seconds;
    for (; audioTime <= until; audioTime += 0.025) vi.advanceTimersByTime(25);
  }

  function running(exercise: Exercise, onRewind?: (from: number) => void): Session {
    const s = new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'off',
      brassVoice: voice,
      onRewind,
    });
    s.start();
    return s;
  }

  it('stands still while paused, however long the clock runs on', () => {
    const s = running(eightNotes());
    advance(2.5);
    const judged = s.judgements.length;

    s.pause();
    const where = s.transport.currentBeat();
    advance(4);

    expect(s.isPaused).toBe(true);
    // The audio clock ran on for four seconds; the music did not.
    expect(s.transport.currentBeat()).toBe(where);
    expect(s.judgements.length).toBe(judged);
    s.stop();
  });

  it('counts a bar in before playing on from where it stopped', () => {
    const s = running(eightNotes());
    advance(2.5);
    s.pause();
    const where = s.transport.currentBeat();
    const judged = s.judgements.length;

    s.resume();
    expect(s.isPaused).toBe(false);
    // A bar of 2/4 back: the run picks up two beats behind where it will play.
    // Loosely, because starting sets the origin a moment ahead so the first
    // scheduling pass has room to run before the music reaches it.
    expect(s.transport.currentBeat()).toBeCloseTo(where - 2, 0);

    // Nothing in the counted-in bar is judged — it has been played already.
    advance(1.9);
    expect(s.judgements.length).toBe(judged);

    // And then the music carries on from where it was left.
    advance(1.5);
    expect(s.judgements.length).toBeGreaterThan(judged);
    s.stop();
  });

  it('takes back the bars it goes back over, so they can be played again', () => {
    let rewoundTo: number | null = null;
    const s = running(eightNotes(), (from) => (rewoundTo = from));
    advance(4.5);
    const judgedBefore = s.judgements.length;
    expect(judgedBefore).toBeGreaterThan(2);

    s.rewind(1);

    // Back to the top of the bar before: beat 4 of 2/4 is bar three.
    expect(rewoundTo).not.toBeNull();
    expect(s.judgements.every((j) => j.noteIndex < rewoundTo!)).toBe(true);
    expect(s.judgements.length).toBeLessThan(judgedBefore);

    // And the notes it gave up are judged again as they come round: a bar of
    // counting in, then the same notes a second time.
    const dropped = judgedBefore - s.judgements.length;
    advance(2 + dropped + 1);
    expect(s.judgements.map((j) => j.noteIndex)).toContain(rewoundTo!);
    expect(s.judgements.length).toBeGreaterThanOrEqual(judgedBefore);
    s.stop();
  });

  it('moves where it will pick up from when rewound while paused', () => {
    const s = running(eightNotes());
    advance(4.5);
    s.pause();

    s.rewind(2);

    // Still paused — a rewind is not a start — and standing at the bar it was
    // sent to, so the player can see where they are about to come in.
    expect(s.isPaused).toBe(true);
    expect(s.transport.currentBeat()).toBe(0);
    s.stop();
  });

  it('will not rewind past the beginning', () => {
    const s = running(eightNotes());
    advance(1);
    s.rewind(9);
    // The count-in bar is behind beat zero; the music itself starts there.
    expect(s.transport.currentBeat()).toBeLessThan(0);
    advance(3);
    expect(s.judgements.length).toBeGreaterThan(0);
    s.stop();
  });
});

/**
 * The output's lead: sound handed to the audio thread early, so it is heard
 * when the clock says.
 *
 * A Bluetooth headset delivers sound a fifth of a second and more after the
 * context does, each device by its own amount, and the player measured three
 * of them. The fix moves one thing — when sound is *sent* — and nothing else:
 * the notation and the judge keep reading the clock as the truth.
 */
describe('a session with an output lead', () => {
  const lead = 0.2;
  const led = (exercise: Exercise) =>
    new Session({
      context,
      exercise,
      tempo: 60,
      countInBars: 0,
      metronomeEnabled: false,
      playbackMode: 'reference',
      brassVoice: voice,
      audioLead: lead,
    });

  it('hands every note to the voice the lead earlier than the beat it is for', () => {
    const s = led(tiedExercise());
    runTo(s, 4);
    // Three sounds; each starts exactly the lead ahead of its beat's clock time.
    expect(played).toHaveLength(3);
    for (const [i, beat] of [0, 1, 3].entries()) {
      expect(played[i].startTime, `note at beat ${beat}`).toBeCloseTo(
        s.timeForNote([0, 1, 3][i]) - lead,
        6,
      );
    }
  });

  it('judges against the clock, not the earlier sound', () => {
    // A press on the beat as the clock has it — where the player sees and now
    // hears it — is right, whatever the lead. Fingers held from the start, so
    // only the timing question is being asked.
    const s = led(tiedExercise());
    s.input.pointerDown(1, 1);
    s.input.pointerDown(2, 2);
    runTo(s, 4);
    expect(s.judgements.map((j) => j.verdict)).toEqual(['correct', 'correct', 'correct']);
  });

  it('is never late with the first note, which is sent the lead earlier still', () => {
    // The clock opens far enough ahead that even the first sound has its
    // whole lead of room: it is handed over at or after the moment of
    // starting, never in the past.
    const s = led(tiedExercise());
    audioTime = 5;
    s.start();
    audioTime = 5.025;
    vi.advanceTimersByTime(25);
    expect(played.length).toBeGreaterThan(0);
    expect(played[0].startTime).toBeGreaterThanOrEqual(5);
    s.stop();
  });
});
