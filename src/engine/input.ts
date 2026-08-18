/**
 * Valve input: the buttons, and what a combination of them means.
 *
 * The `PlayerInput` the app has always had, and — until a microphone arrives —
 * the only one. Records a timestamped history of button states rather than
 * exposing only the live state, because judging needs to ask "was this
 * combination held at any point around this note's onset", a question the
 * current state cannot answer. Timestamps come from the audio clock so they are
 * directly comparable with scheduled note times.
 *
 * Touch and keyboard are tracked separately and combined, so a finger and a key
 * holding the same valve do not cancel each other out.
 *
 * Everything the *buttons* make of what they record is here too — see
 * `answers`. That is the seam: a microphone brings its own history and its own
 * reading of it, and nothing downstream changes.
 */

import type { NoteEvent } from '../exercise/types';
import type { InputState, PlayerInput } from './player-input';

export interface ValveChange {
  /** Audio-clock time of the change. */
  time: number;
  /** Bit mask: bit 0 = valve 1, bit 1 = valve 2, bit 2 = valve 3. */
  mask: number;
}

export const VALVE_KEYS: Record<string, number> = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Numpad1: 1,
  Numpad2: 2,
  Numpad3: 3,
  KeyJ: 1,
  KeyK: 2,
  KeyL: 3,
};

export class ValveInput implements PlayerInput {
  /** pointerId -> valve, so a finger sliding off still releases the right one. */
  private readonly pointers = new Map<number, number>();
  private readonly keys = new Set<number>();
  private currentMask = 0;
  private listeners = new Set<(mask: number) => void>();

  readonly history: ValveChange[] = [];

  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
    this.history.push({ time: -Infinity, mask: 0 });
  }

  get mask(): number {
    return this.currentMask;
  }

  subscribe(listener: (mask: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pointerDown(pointerId: number, valve: number): void {
    this.pointers.set(pointerId, valve);
    this.recompute();
  }

  pointerUp(pointerId: number): void {
    if (this.pointers.delete(pointerId)) this.recompute();
  }

  keyDown(valve: number): void {
    if (this.keys.has(valve)) return;
    this.keys.add(valve);
    this.recompute();
  }

  keyUp(valve: number): void {
    if (this.keys.delete(valve)) this.recompute();
  }

  /** Releases everything — used when a run ends or the window loses focus. */
  release(): void {
    this.pointers.clear();
    this.keys.clear();
    this.recompute();
  }

  clearHistory(): void {
    this.history.length = 0;
    this.history.push({ time: -Infinity, mask: this.currentMask });
  }

  /** Installs keyboard handling; returns a function that removes it again. */
  attachKeyboard(target: Window = window): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
      const valve = VALVE_KEYS[event.code];
      if (valve === undefined || event.repeat) return;
      event.preventDefault();
      this.keyDown(valve);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const valve = VALVE_KEYS[event.code];
      if (valve === undefined) return;
      event.preventDefault();
      this.keyUp(valve);
    };
    const onBlur = () => this.release();

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    };
  }

  /** The button state that was held at a given moment. */
  maskAt(time: number): number {
    return this.history[this.indexAt(time)].mask;
  }

  /** Where in the history a moment falls. */
  private indexAt(time: number): number {
    let low = 0;
    let high = this.history.length - 1;
    let found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.history[mid].time <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  /** The button state held at a moment, and how long it lasted either side. */
  stateAt(time: number): InputState {
    const index = this.indexAt(time);
    return this.state(
      this.history[index].mask,
      this.history[index].time,
      this.history[index + 1]?.time ?? Infinity,
    );
  }

  /**
   * Every distinct button state held during a window, in order, with the times
   * it was entered and left. This is what the judge inspects.
   */
  statesDuring(from: number, to: number): InputState[] {
    const states: InputState[] = [];
    let mask = this.maskAt(from);
    let start = from;

    for (const change of this.history) {
      if (change.time <= from || change.time > to) continue;
      states.push(this.state(mask, start, change.time));
      mask = change.mask;
      start = change.time;
    }
    states.push(this.state(mask, start, to));
    return states;
  }

  /**
   * Whether a held button state answers a note.
   *
   * Any accepted fingering that takes a valve — the primary, or an alternate
   * such as 1-3 for a G — is a deliberate act and answers on its own. Open is
   * accepted only from a player who is engaged: it is what an instrument on
   * its owner's lap produces too, and until v2.21.0 a run played by nobody
   * scored every open note correct, which on an E flat bass part was a quarter
   * of the score for doing nothing. The player's rule, on 2026-08-16: an open
   * note counts if some fingering was played on at least one of the two notes
   * before it.
   *
   * **A rule about buttons, and it lives with them for that reason.** With
   * buttons, an open note and an abandoned instrument are the same input, so
   * the evidence has to be borrowed from the notes either side. A microphone
   * hears the difference and will want nothing of the kind — which is why the
   * judge no longer knows this rule exists.
   */
  answers(state: InputState, note: NoteEvent, engagedSince: number | null, asOf: number): boolean {
    if (!note.acceptedMasks.includes(state.mask)) return false;
    return state.mask !== 0 || this.engaged(engagedSince, asOf);
  }

  /**
   * Whether the player has had a valve down at any instant since `since`.
   *
   * The evidence that an open hand is a player playing an open note rather than
   * an instrument on a lap. `null` is no earlier note to look back over — the
   * first note of a run — and is read as engaged: there is no evidence either
   * way, and a player opening on an open note has, rightly, pressed nothing.
   */
  private engaged(since: number | null, until: number): boolean {
    if (since === null) return true;
    return this.statesDuring(since, until).some((state) => state.playing);
  }

  /**
   * One stretch of button state, said in the terms the judge reads.
   *
   * A valve down is somebody playing; nothing held could be a player choosing
   * an open note or an instrument on a lap, and the buttons cannot tell. That
   * is the whole of what `playing` costs the buttons to answer, and the whole
   * of what a microphone would answer differently.
   */
  private state(mask: number, from: number, to: number): InputState {
    return { mask, from, to, playing: mask !== 0 };
  }

  private recompute(): void {
    let mask = 0;
    for (const valve of this.pointers.values()) mask |= 1 << (valve - 1);
    for (const valve of this.keys) mask |= 1 << (valve - 1);
    if (mask === this.currentMask) return;

    this.currentMask = mask;
    this.history.push({ time: this.now(), mask });
    for (const listener of this.listeners) listener(mask);
  }
}
