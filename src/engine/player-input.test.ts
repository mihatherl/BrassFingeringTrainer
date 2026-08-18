// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voice } from '../audio/sampler';
import { spellInKey } from '../domain/keys';
import { metreFor } from '../domain/metre';
import { durationFromBeats } from '../domain/rhythm';
import type { Exercise, NoteEvent } from '../exercise/types';
import { ValveInput } from './input';
import type { InputState, PlayerInput } from './player-input';
import { Session } from './session';

/**
 * The seam, driven by something that is not the buttons.
 *
 * The point of `PlayerInput` is that the microphone will be a new *input* and
 * nothing else: the same session, the same judge, the same tone following the
 * same answers. That claim is worth an implementation to test it with, so this
 * file has one — a listening input that reports stretches of heard sound
 * instead of held buttons — and runs whole sessions off it.
 *
 * `HeardInput` is not the microphone and is not trying to be: it has no
 * detector, no onset measurement and no pitch. It is the smallest thing that
 * is *not the buttons*, which is all that is needed to prove that nothing
 * downstream of the seam knows which side of it the answers came from.
 */

let audioTime = 0;

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
  play: () => {},
  setVolume: () => {},
  stop: () => {},
};

/** One stretch of sound the input heard, and the fingering it implies. */
interface Heard {
  from: number;
  to: number;
  mask: number;
}

class HeardInput implements PlayerInput {
  private readonly heard: readonly Heard[];

  constructor(heard: readonly Heard[]) {
    this.heard = heard;
  }

  subscribe(): () => void {
    return () => {};
  }

  clearHistory(): void {}

  release(): void {}

  stateAt(time: number): InputState {
    const sound = this.heard.find((h) => h.from <= time && time < h.to);
    if (sound) return { from: sound.from, to: sound.to, mask: sound.mask, playing: true };
    const before = this.heard.filter((h) => h.to <= time).map((h) => h.to);
    const after = this.heard.filter((h) => h.from > time).map((h) => h.from);
    return {
      from: before.length ? Math.max(...before) : -Infinity,
      to: after.length ? Math.min(...after) : Infinity,
      mask: 0,
      playing: false,
    };
  }

  statesDuring(from: number, to: number): InputState[] {
    const edges = [from, to];
    for (const sound of this.heard) {
      if (sound.from > from && sound.from < to) edges.push(sound.from);
      if (sound.to > from && sound.to < to) edges.push(sound.to);
    }
    const bounds = [...new Set(edges)].sort((a, b) => a - b);
    const states: InputState[] = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const state = this.stateAt((bounds[i] + bounds[i + 1]) / 2);
      states.push({ ...state, from: bounds[i], to: bounds[i + 1] });
    }
    return states;
  }

  /**
   * No look-back, and that is the whole point.
   *
   * The buttons need one for an open note — see `ValveInput.answers` — because
   * an open note and an abandoned instrument are the same input to them. This
   * one hears the difference, so `engagedSince` goes unread.
   */
  answers(state: InputState, note: NoteEvent): boolean {
    return state.playing && note.acceptedMasks.includes(state.mask);
  }
}

function note(startBeat: number, masks: number[]): NoteEvent {
  return {
    writtenMidi: 60,
    pitch: spellInKey(60, 0),
    soundingMidi: 60,
    startBeat,
    duration: durationFromBeats(1)!,
    acceptedMasks: masks,
    primaryMask: masks[0],
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext: false,
    showAccidental: false,
  };
}

/** `count` crotchets, all asking for the same fingering. */
function run(count: number, masks: number[], totalBeats = count): Exercise {
  return {
    notes: Array.from({ length: count }, (_, i) => note(i, masks)),
    rests: [],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metres: [{ fromBeat: 0, metre: metreFor(2, 4) }],
    tempo: [],
    totalBeats,
    chosenBeats: count,
    seed: 1,
    kind: 'phrases',
  };
}

function session(exercise: Exercise, input: PlayerInput, onOffer?: (offering: boolean) => void) {
  return new Session({
    context,
    input,
    exercise,
    // 60bpm, so a beat is a second and the times below read as beats.
    tempo: 60,
    countInBars: 0,
    metronomeEnabled: false,
    playbackMode: 'off',
    brassVoice: voice,
    onOffer,
  });
}

function runTo(s: Session, toBeat: number): void {
  // From the top of the clock every time, so a test that runs two sessions
  // does not start the second one in the first one's past.
  audioTime = 0;
  s.start();
  for (let elapsed = 0; elapsed <= toBeat + 2; elapsed += 0.025) {
    audioTime = elapsed;
    vi.advanceTimersByTime(25);
  }
  s.stop();
}

beforeEach(() => {
  vi.useFakeTimers();
  audioTime = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a session driven by an input that is not the buttons', () => {
  it('judges a whole run from what the input reports', () => {
    const heard = new HeardInput([{ from: -0.1, to: 3.9, mask: 0b011 }]);
    const s = session(run(4, [0b011]), heard);
    runTo(s, 4);
    expect(s.judgements.map((j) => j.verdict)).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
    ]);
  });

  it('reads silence as notes nobody attempted, and the wrong sound as wrong', () => {
    const silent = session(run(3, [0b011]), new HeardInput([]));
    runTo(silent, 3);
    expect(silent.judgements.map((j) => j.verdict)).toEqual(['missed', 'missed', 'missed']);

    const wrong = session(run(3, [0b011]), new HeardInput([{ from: -0.1, to: 2.9, mask: 0b100 }]));
    runTo(wrong, 3);
    expect(wrong.judgements.map((j) => j.verdict)).toEqual(['wrong', 'wrong', 'wrong']);
  });

  /**
   * The rule the microphone is not to inherit.
   *
   * On the buttons, an open note counts only from a player who had a valve
   * down within the two notes before, because open and absent are the same
   * input there. An input that can hear a player playing an open note has no
   * such problem, and — since the rule lives inside `ValveInput` rather than
   * in the judge — is not asked to pretend otherwise.
   */
  it('does not inherit the buttons’ rule about open notes', () => {
    const open = () => run(6, [0]);

    const heard = session(open(), new HeardInput([{ from: -0.1, to: 5.9, mask: 0 }]));
    runTo(heard, 6);
    expect(heard.judgements.map((j) => j.verdict)).toEqual(
      ['correct', 'correct', 'correct', 'correct', 'correct', 'correct'],
    );

    // The same six notes, the same session, the buttons untouched: one note
    // scored, on the evidence rule of v2.21.0.
    const pressed = session(open(), new ValveInput(() => audioTime));
    runTo(pressed, 6);
    expect(pressed.judgements.filter((j) => j.verdict === 'correct')).toHaveLength(1);
  });

  /**
   * Carrying on takes the offer, and "carrying on" is the input's word.
   *
   * The buttons can only say it with a valve down, which is why the generator
   * keeps open notes out of the stretch where the offer stands. An input that
   * hears the player says it by sounding at all — including on an open note —
   * and the session, which asks the state rather than the fingering, takes it.
   */
  it('takes up the offer from a player who is heard carrying on', () => {
    const offers: boolean[] = [];
    // Four beats committed of twelve written, all of them open.
    const exercise = run(12, [0], 12);
    exercise.chosenBeats = 4;
    const heard = new HeardInput([{ from: -0.1, to: 11.9, mask: 0 }]);
    const s = session(exercise, heard, (offering) => offers.push(offering));

    runTo(s, 12);

    expect(offers[0]).toBe(true);
    // The music was carried past the four beats that were asked for, without
    // a button being pressed or a valve going down.
    expect(s.endBeat).toBeGreaterThan(4);
    expect(s.judgements.length).toBeGreaterThan(4);
  });
});
