/**
 * Valve input.
 *
 * Records a timestamped history of button states rather than exposing only the
 * live state, because judging needs to ask "was this combination held at any
 * point around this note's onset" — a question the current state cannot answer.
 * Timestamps come from the audio clock so they are directly comparable with
 * scheduled note times.
 *
 * Touch and keyboard are tracked separately and combined, so a finger and a key
 * holding the same valve do not cancel each other out.
 */

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

export class ValveInput {
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
  releaseAll(): void {
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
    const onBlur = () => this.releaseAll();

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
    return this.history[found].mask;
  }

  /**
   * Every distinct button state held during a window, in order, with the times
   * it was entered and left. This is what the judge inspects.
   */
  statesDuring(from: number, to: number): Array<{ mask: number; from: number; to: number }> {
    const states: Array<{ mask: number; from: number; to: number }> = [];
    let mask = this.maskAt(from);
    let start = from;

    for (const change of this.history) {
      if (change.time <= from || change.time > to) continue;
      states.push({ mask, from: start, to: change.time });
      mask = change.mask;
      start = change.time;
    }
    states.push({ mask, from: start, to });
    return states;
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
