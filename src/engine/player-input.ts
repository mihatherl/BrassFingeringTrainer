/**
 * The seam between the player and the judge.
 *
 * Everything downstream of this file — the session, the judge, the tone that
 * follows the fingers, the results — asks one question: *did what the player
 * did answer this note, and when*. The valve buttons answer it from a history
 * of held combinations; a microphone would answer the same question from a
 * history of heard pitches. So the question is stated here, once, and the
 * answering is the input's own business.
 *
 * **What lives behind the seam, deliberately.** Whether an open note counts —
 * the engagement rule of v2.21.0 — is a rule about *buttons*, where an open
 * note and an abandoned instrument are the same input. A microphone can hear
 * the difference and would want no such rule. It is therefore inside
 * `ValveInput.answers` rather than in the judge, along with every other
 * question about what a valve combination means.
 *
 * **What stays in front of it.** Timing, tolerance, ties, which notes are
 * asked at all, and *from when* evidence of playing may be counted
 * (`engagedSince` below) are properties of the music and the clock, not of the
 * input, and belong to the session and the judge as before.
 */

import type { NoteEvent } from '../exercise/types';

/** One unbroken stretch of the player doing the same thing. */
export interface InputState {
  /** Audio-clock time this state was entered, clipped to the window asked for. */
  from: number;
  /** Audio-clock time it was left, or the end of the window asked for. */
  to: number;
  /**
   * What the player did, as a valve combination: bit 0 = valve 1, and so on.
   * Zero is open — no valve down, or, from a microphone one day, a pitch whose
   * fingering takes none.
   *
   * A fingering rather than a pitch because that is what the app teaches and
   * what the results screen shows. A microphone hears pitch and would report
   * the fingering it implies; the two questions it can answer that buttons
   * cannot — a cracked partial, an octave — are for the mode that brings it,
   * and are recorded in `v2-design.md` rather than guessed at here.
   */
  mask: number;
  /**
   * Whether the player was *doing* something here, right or wrong — a valve
   * down, or a sound coming out.
   *
   * Carried on the state rather than worked out from `mask` because zero means
   * two different things to two inputs: on the buttons nothing is held, which
   * is exactly what an instrument on a lap looks like, while a microphone
   * hearing an open note knows somebody is playing it. Read where no note is
   * in question — a note nobody attempted is missed rather than wrong, and
   * carrying on past the end of the music takes up the offer of more.
   */
  playing: boolean;
}

export interface PlayerInput {
  /**
   * Told whenever what the player is doing changes, so the tone can answer the
   * fingers on the change rather than at the next tick of the resolve loop.
   */
  subscribe(listener: () => void): () => void;

  /** What the player was doing at one moment. */
  stateAt(time: number): InputState;

  /**
   * Every distinct thing the player did during a window, in order. The first
   * begins at `from` and the last ends at `to`, whatever they were doing before
   * and after.
   */
  statesDuring(from: number, to: number): InputState[];

  /**
   * Whether this state answers the note.
   *
   * `engagedSince` is the moment from which the session is willing to count
   * evidence that somebody is playing — the opening of the window of the
   * earlier of the two judged notes before this one, or null where there is no
   * such note. An input that needs no such evidence ignores it. `asOf` is the
   * moment the question is being asked, which bounds how much of that evidence
   * exists yet: the same note is asked repeatedly as it is played.
   */
  answers(
    state: InputState,
    note: NoteEvent,
    engagedSince: number | null,
    asOf: number,
  ): boolean;

  /** Forgets everything before now; what is happening now still is. */
  clearHistory(): void;

  /** Lets go of everything, as when a run ends or the window loses focus. */
  release(): void;
}
